/**
 * v717-fix6: 紧急全量出价修复脚本
 * 
 * 核心修复：
 * 1. 报告数据解析采用与生产代码(keywordSync.ts)相同的字段标准化策略
 *    - Amazon spTargeting报告中所有实体都使用keywordId字段
 *    - 需要先标准化: row.targetId = row.targetId || row.keywordId
 *    - 然后通过本地数据库映射区分keyword和product_target
 * 2. 使用submitAndWaitMultipleReports批量提交报告
 * 3. 进度持久化到bid_anchor_analysis表
 */

import { createModuleLogger } from '../utils/logger';
import { getDb } from '../db';
import { sql, eq, and } from 'drizzle-orm';
import {
  adAccounts,
  campaigns,
  keywords,
  productTargets,
  bidAnchorAnalysis,
} from '../../drizzle/schema';
import { getAmazonSyncService } from '../services/amazonApiHelper';

const log = createModuleLogger('EmergencyBidCorrection');

// ==================== 配置 ====================

const CONFIG = {
  excludeRecentDays: 2,
  batchReportTimeoutMs: 600000,
  reportSubmitDelayMs: 2000,
  bidUpdateBatchSize: 500,
  dryRun: false,
  targetAccountId: null as number | null,
  bidDriftThresholdPercent: 15,
  minClicksForValidWindow: 3,
  minOrdersForAnchor: 1,
  maxAdjustmentPercent: 40,
  accountDelayMs: 3000,
};

// ==================== 时间窗口定义 ====================

interface TimeWindow {
  name: string;
  label: string;
  startDaysAgo: number;
  endDaysAgo: number;
}

const TIME_WINDOWS: TimeWindow[] = [
  { name: 'W1_90_60', label: '90-60天', startDaysAgo: 90, endDaysAgo: 60 },
  { name: 'W2_60_30', label: '60-30天', startDaysAgo: 60, endDaysAgo: 30 },
  { name: 'W3_30_14', label: '30-14天', startDaysAgo: 30, endDaysAgo: 14 },
  { name: 'W4_14_7', label: '14-7天', startDaysAgo: 14, endDaysAgo: 7 },
  { name: 'W5_7_3', label: '7-3天', startDaysAgo: 7, endDaysAgo: 3 },
];

// ==================== 类型 ====================

interface WindowMetrics {
  windowName: string;
  impressions: number;
  clicks: number;
  spend: number;
  sales: number;
  orders: number;
  cpc: number;
  acos: number;
  roas: number;
}

interface EntityAnalysis {
  entityId: number;
  entityType: 'keyword' | 'product_target';
  amazonId: string;
  campaignId: string;
  currentBid: number;
  windowMetrics: WindowMetrics[];
  bestWindow: WindowMetrics | null;
  anchorBid: number;
  suggestedBid: number;
  correctionAction: 'maintain' | 'gradual_restore' | 'restore_to_anchor' | 'update_anchor' | 'emergency_restore';
  correctionReason: string;
  bidDriftPercent: number;
  dataConfidence: 'high' | 'medium' | 'low' | 'insufficient';
}

interface ExecutionSummary {
  accountId: number;
  marketplace: string;
  totalEntities: number;
  entitiesAnalyzed: number;
  entitiesNeedCorrection: number;
  correctionsApplied: number;
  correctionsFailed: number;
  bidIncreases: number;
  bidDecreases: number;
  avgBidChangePercent: number;
  errors: string[];
}

// ==================== 辅助函数 ====================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

function getWindowDates(window: TimeWindow): { startStr: string; endStr: string } {
  const today = new Date();
  const endDate = new Date(today);
  endDate.setDate(endDate.getDate() - window.endDaysAgo);
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - window.startDaysAgo);
  return { startStr: formatDate(startDate), endStr: formatDate(endDate) };
}

// ==================== 核心函数 ====================

/**
 * 使用批量报告提交方式获取5个时间窗口的数据
 * 
 * 关键修复(v717-fix6): 
 * - Amazon spTargeting报告中，keyword和product_target都使用keywordId字段返回
 * - 需要预先加载本地数据库中的keyword和product_target映射表
 * - 通过reportTargetId先匹配keyword，匹配不到再匹配product_target
 */
async function fetchWindowReportsBatch(
  client: any,
  accountId: number,
  kwByAmazonId: Map<string, any>,
  ptByAmazonId: Map<string, any>
): Promise<Map<string, WindowMetrics[]>> {
  const entityWindowMap = new Map<string, WindowMetrics[]>();

  // 构建所有报告请求 - 只需要requestSpKeywordReport
  // 因为spTargeting报告同时包含keyword和product_target数据
  const reportRequests: Array<{ name: string; requestFn: () => Promise<string> }> = [];

  for (const window of TIME_WINDOWS) {
    const { startStr, endStr } = getWindowDates(window);
    log.info(`[fetchWindowReportsBatch] 窗口 ${window.label}: ${startStr} ~ ${endStr}`);
    reportRequests.push({
      name: `sp_targeting_${window.name}_${accountId}`,
      requestFn: () => client.requestSpKeywordReport(startStr, endStr),
    });
  }

  log.info(`[fetchWindowReportsBatch] 账户${accountId}: 批量提交 ${reportRequests.length} 个报告请求...`);

  // 使用批量提交+统一轮询
  let results: Array<{ name: string; data: any[] | null; error?: string }>;
  try {
    results = await client.submitAndWaitMultipleReports(
      reportRequests,
      CONFIG.batchReportTimeoutMs,
      CONFIG.reportSubmitDelayMs
    );
    log.info(`[fetchWindowReportsBatch] 账户${accountId}: 批量报告返回 ${results?.length || 0} 个结果`);
  } catch (err: unknown) {
    log.warn(`[fetchWindowReportsBatch] 账户${accountId}: 批量报告失败: ${(err as Error).message}`);
    return entityWindowMap;
  }

  if (!results || !Array.isArray(results)) {
    log.warn(`[fetchWindowReportsBatch] 账户${accountId}: results不是数组: ${typeof results}`);
    return entityWindowMap;
  }

  let totalRows = 0;
  let matchedKw = 0;
  let matchedPt = 0;
  let unmatched = 0;

  // 解析每个窗口的结果
  for (let i = 0; i < TIME_WINDOWS.length; i++) {
    const window = TIME_WINDOWS[i];
    const result = results[i];

    if (!result) {
      log.warn(`[fetchWindowReportsBatch] 账户${accountId} ${window.label}: result为null/undefined`);
      continue;
    }

    if (result.error) {
      log.warn(`[fetchWindowReportsBatch] 账户${accountId} ${window.label}: 报告错误: ${result.error}`);
      continue;
    }

    if (!result.data || !Array.isArray(result.data)) {
      log.warn(`[fetchWindowReportsBatch] 账户${accountId} ${window.label}: data不是数组: ${typeof result.data}, name=${result.name || 'N/A'}`);
      continue;
    }

    log.info(`[fetchWindowReportsBatch] 账户${accountId} ${window.label}: 获取 ${result.data.length} 条记录`);

    for (const row of result.data) {
      totalRows++;

      // ===== 关键修复: 采用与keywordSync.ts相同的字段标准化策略 =====
      // Amazon spTargeting报告中:
      // - keywordId: 所有实体的ID（keyword和product_target都用这个字段）
      // - keyword: 对应targetingText
      // - targeting: 对应targetingExpression
      // - keywordType: 对应matchType
      if (!row.targetId && row.keywordId) row.targetId = row.keywordId;
      if (!row.targetingText && row.keyword) row.targetingText = row.keyword;
      if (!row.targetingExpression && row.targeting) row.targetingExpression = row.targeting;

      const reportTargetId = String(row.targetId || row.keywordId || '');
      if (!reportTargetId) continue;

      // 先尝试匹配keyword
      let entityKey = '';
      if (kwByAmazonId.has(reportTargetId)) {
        entityKey = `kw_${reportTargetId}`;
        matchedKw++;
      } else if (ptByAmazonId.has(reportTargetId)) {
        // 再尝试匹配product_target
        entityKey = `pt_${reportTargetId}`;
        matchedPt++;
      } else {
        // 都匹配不到，跳过
        unmatched++;
        continue;
      }

      const cost = Number(row.cost || 0);
      const sales = Number(row.sales7d || row.sales14d || 0);
      const clicks = Number(row.clicks || 0);
      const orders = Number(row.purchases7d || row.purchases14d || 0);
      const impressions = Number(row.impressions || 0);

      const metrics: WindowMetrics = {
        windowName: window.name,
        impressions,
        clicks,
        spend: cost,
        sales,
        orders,
        cpc: clicks > 0 ? cost / clicks : 0,
        acos: sales > 0 ? cost / sales : 999,
        roas: cost > 0 ? sales / cost : 0,
      };

      if (!entityWindowMap.has(entityKey)) {
        entityWindowMap.set(entityKey, []);
      }
      entityWindowMap.get(entityKey)!.push(metrics);
    }
  }

  log.info(`[fetchWindowReportsBatch] 账户${accountId} 汇总: 总行数=${totalRows}, 匹配keyword=${matchedKw}, 匹配target=${matchedPt}, 未匹配=${unmatched}, 唯一实体=${entityWindowMap.size}`);

  return entityWindowMap;
}

/**
 * 分析单个实体的多时间窗口数据，找出最佳锚点
 */
function analyzeEntity(
  entityId: number,
  entityType: 'keyword' | 'product_target',
  amazonId: string,
  campaignId: string,
  currentBid: number,
  windowMetrics: WindowMetrics[]
): EntityAnalysis {
  const result: EntityAnalysis = {
    entityId,
    entityType,
    amazonId,
    campaignId,
    currentBid,
    windowMetrics,
    bestWindow: null,
    anchorBid: currentBid,
    suggestedBid: currentBid,
    correctionAction: 'maintain',
    correctionReason: '',
    bidDriftPercent: 0,
    dataConfidence: 'insufficient',
  };

  // 过滤有效窗口
  const validWindows = windowMetrics.filter(w => w.clicks >= CONFIG.minClicksForValidWindow);

  if (validWindows.length === 0) {
    result.correctionReason = '所有时间窗口数据不足';
    return result;
  }

  // 设置数据置信度
  const totalClicks = validWindows.reduce((sum, w) => sum + w.clicks, 0);
  if (totalClicks >= 50) result.dataConfidence = 'high';
  else if (totalClicks >= 20) result.dataConfidence = 'medium';
  else result.dataConfidence = 'low';

  // 策略1: 优先找有出单且ROAS最好的窗口
  const windowsWithOrders = validWindows.filter(w => w.orders >= CONFIG.minOrdersForAnchor);

  let bestWindow: WindowMetrics | null = null;

  if (windowsWithOrders.length > 0) {
    bestWindow = windowsWithOrders.sort((a, b) => b.roas - a.roas)[0];
  } else {
    // 没有出单窗口，找CPC最低的
    bestWindow = validWindows.sort((a, b) => a.cpc - b.cpc)[0];
  }

  if (!bestWindow || bestWindow.cpc <= 0) {
    result.correctionReason = '无法确定有效的锚定CPC';
    return result;
  }

  result.bestWindow = bestWindow;
  result.anchorBid = parseFloat(bestWindow.cpc.toFixed(2));

  // 计算偏离度
  const drift = ((currentBid - result.anchorBid) / result.anchorBid) * 100;
  result.bidDriftPercent = parseFloat(drift.toFixed(2));

  const absDrift = Math.abs(drift);

  if (absDrift <= CONFIG.bidDriftThresholdPercent) {
    result.correctionAction = 'maintain';
    result.suggestedBid = currentBid;
    result.correctionReason = `偏离${drift.toFixed(1)}%，在${CONFIG.bidDriftThresholdPercent}%阈值内`;
    return result;
  }

  // 检查最近窗口是否恶化
  const recentWindow = windowMetrics.find(w => w.name === 'W5_7_3');
  const isRecentDegraded = recentWindow && bestWindow.name !== 'W5_7_3' &&
    recentWindow.clicks >= CONFIG.minClicksForValidWindow &&
    (recentWindow.roas < bestWindow.roas * 0.5 || recentWindow.acos > bestWindow.acos * 2);

  if (drift > 0) {
    if (absDrift > 50 || isRecentDegraded) {
      result.correctionAction = 'emergency_restore';
      result.correctionReason = `出价被错误调高${drift.toFixed(1)}%（$${currentBid} vs 锚定$${result.anchorBid}），紧急回调`;
    } else {
      result.correctionAction = 'restore_to_anchor';
      result.correctionReason = `出价偏高${drift.toFixed(1)}%，向下修正至锚定`;
    }
  } else {
    if (absDrift > 50) {
      result.correctionAction = 'emergency_restore';
      result.correctionReason = `出价被错误调低${Math.abs(drift).toFixed(1)}%（$${currentBid} vs 锚定$${result.anchorBid}），紧急恢复`;
    } else {
      result.correctionAction = 'gradual_restore';
      result.correctionReason = `出价偏低${Math.abs(drift).toFixed(1)}%，向上修正至锚定`;
    }
  }

  // 计算建议出价（限制单次调整幅度）
  let targetBid = result.anchorBid;
  const maxChange = currentBid * (CONFIG.maxAdjustmentPercent / 100);

  if (Math.abs(targetBid - currentBid) > maxChange) {
    targetBid = drift > 0
      ? currentBid - maxChange
      : currentBid + maxChange;
  }

  targetBid = Math.max(0.02, Math.min(targetBid, 100));
  result.suggestedBid = parseFloat(targetBid.toFixed(2));

  return result;
}

/**
 * 处理单个账户的紧急修复
 */
async function processAccount(
  accountId: number,
  marketplace: string,
  dryRun: boolean
): Promise<ExecutionSummary> {
  const summary: ExecutionSummary = {
    accountId,
    marketplace,
    totalEntities: 0,
    entitiesAnalyzed: 0,
    entitiesNeedCorrection: 0,
    correctionsApplied: 0,
    correctionsFailed: 0,
    bidIncreases: 0,
    bidDecreases: 0,
    avgBidChangePercent: 0,
    errors: [],
  };

  try {
    log.info(`\n[processAccount] ========== 开始处理账户 ${accountId} (${marketplace}) ==========`);

    const db = await getDb();
    if (!db) throw new Error('DATABASE_UNAVAILABLE');

    // Step 1: 获取Amazon API客户端
    let syncService: any;
    try {
      syncService = await getAmazonSyncService(accountId);
      if (!syncService || !syncService.client) {
        log.warn(`[processAccount] 账户${accountId}: API客户端不可用，跳过`);
        summary.errors.push('API客户端不可用');
        return summary;
      }
      log.info(`[processAccount] 账户${accountId}: API客户端初始化成功`);
    } catch (err: unknown) {
      log.warn(`[processAccount] 账户${accountId}: 获取API客户端失败: ${(err as Error).message}`);
      summary.errors.push(`API客户端失败: ${(err as Error).message}`);
      return summary;
    }

    // Step 2: 获取所有enabled的keywords和product_targets
    const enabledKeywords = await db
      .select({
        id: keywords.id,
        bid: keywords.bid,
        campaignId: keywords.campaignId,
        keywordId: keywords.keywordId,
        keywordText: keywords.keywordText,
      })
      .from(keywords)
      .where(and(
        eq(keywords.accountId, accountId),
        eq(keywords.keywordStatus, 'enabled')
      ));

    const enabledTargets = await db
      .select({
        id: productTargets.id,
        bid: productTargets.bid,
        campaignId: productTargets.campaignId,
        targetId: productTargets.targetId,
        targetValue: productTargets.targetValue,
      })
      .from(productTargets)
      .where(and(
        eq(productTargets.accountId, accountId),
        eq(productTargets.targetStatus, 'enabled')
      ));

    summary.totalEntities = enabledKeywords.length + enabledTargets.length;
    log.info(`[processAccount] 账户${accountId}: ${enabledKeywords.length}个keyword + ${enabledTargets.length}个target = ${summary.totalEntities}个实体`);

    if (summary.totalEntities === 0) {
      log.info(`[processAccount] 账户${accountId}: 无活跃实体，跳过`);
      return summary;
    }

    // Step 3: 构建本地映射（用于报告数据匹配）
    const kwByAmazonId = new Map<string, typeof enabledKeywords[0]>();
    for (const kw of enabledKeywords) {
      if (kw.keywordId) kwByAmazonId.set(kw.keywordId, kw);
    }

    const ptByAmazonId = new Map<string, typeof enabledTargets[0]>();
    for (const pt of enabledTargets) {
      if (pt.targetId) ptByAmazonId.set(pt.targetId, pt);
    }

    log.info(`[processAccount] 账户${accountId}: keyword映射=${kwByAmazonId.size}, target映射=${ptByAmazonId.size}`);

    // Step 4: 批量请求5个时间窗口的报告数据（传入映射表用于匹配）
    log.info(`[processAccount] 账户${accountId}: 批量请求5个时间窗口报告...`);
    const entityWindowMap = await fetchWindowReportsBatch(
      syncService.client,
      accountId,
      kwByAmazonId,
      ptByAmazonId
    );
    log.info(`[processAccount] 账户${accountId}: 获取到 ${entityWindowMap.size} 个实体的多窗口数据`);

    if (entityWindowMap.size === 0) {
      log.warn(`[processAccount] 账户${accountId}: 所有窗口报告数据为空，跳过`);
      summary.errors.push('所有窗口报告数据为空');
      return summary;
    }

    // Step 5: 分析每个实体
    const corrections: EntityAnalysis[] = [];
    let bidChangeSum = 0;

    for (const [entityKey, windowMetrics] of entityWindowMap) {
      const isKeyword = entityKey.startsWith('kw_');
      const amazonId = entityKey.replace(/^(kw_|pt_)/, '');

      let localEntity: any = null;
      let entityType: 'keyword' | 'product_target';
      let currentBid: number;
      let campaignId: string;
      let entityId: number;

      if (isKeyword) {
        localEntity = kwByAmazonId.get(amazonId);
        if (!localEntity) continue;
        entityType = 'keyword';
        currentBid = parseFloat(localEntity.bid || '0');
        campaignId = localEntity.campaignId;
        entityId = localEntity.id;
      } else {
        localEntity = ptByAmazonId.get(amazonId);
        if (!localEntity) continue;
        entityType = 'product_target';
        currentBid = parseFloat(localEntity.bid || '0');
        campaignId = localEntity.campaignId;
        entityId = localEntity.id;
      }

      if (currentBid <= 0) continue;

      const analysis = analyzeEntity(
        entityId, entityType, amazonId, campaignId, currentBid, windowMetrics
      );

      summary.entitiesAnalyzed++;

      if (analysis.correctionAction !== 'maintain' && analysis.dataConfidence !== 'insufficient') {
        summary.entitiesNeedCorrection++;

        const bidChange = analysis.suggestedBid - currentBid;
        bidChangeSum += Math.abs(bidChange / currentBid) * 100;

        if (bidChange > 0) summary.bidIncreases++;
        else summary.bidDecreases++;

        corrections.push(analysis);

        // 只记录前50个修正详情
        if (corrections.length <= 50) {
          const entityLabel = isKeyword
            ? `kw ${entityId} "${localEntity.keywordText?.slice(0, 25)}"`
            : `pt ${entityId} "${localEntity.targetValue?.slice(0, 25)}"`;
          log.info(`[correction] ${entityLabel}: $${currentBid.toFixed(2)} → $${analysis.suggestedBid.toFixed(2)} (${analysis.correctionAction}) | 最佳: ${analysis.bestWindow?.windowName} ROAS=${analysis.bestWindow?.roas.toFixed(2)}`);
        }
      }

      if (summary.entitiesAnalyzed % 1000 === 0) {
        log.info(`[processAccount] 进度: ${summary.entitiesAnalyzed}/${summary.totalEntities}, 需修正: ${summary.entitiesNeedCorrection}`);
      }
    }

    summary.avgBidChangePercent = summary.entitiesNeedCorrection > 0
      ? bidChangeSum / summary.entitiesNeedCorrection
      : 0;

    log.info(`\n[processAccount] 账户${accountId} 分析完成:`);
    log.info(`  总实体: ${summary.totalEntities}`);
    log.info(`  已分析: ${summary.entitiesAnalyzed}`);
    log.info(`  需修正: ${summary.entitiesNeedCorrection} (上调${summary.bidIncreases}, 下调${summary.bidDecreases})`);
    log.info(`  平均调整幅度: ${summary.avgBidChangePercent.toFixed(1)}%`);

    // Step 6: 保存分析结果到数据库
    if (corrections.length > 0) {
      try {
        const batchSize = 100;
        for (let i = 0; i < corrections.length; i += batchSize) {
          const batch = corrections.slice(i, i + batchSize);
          const insertValues = batch.map(c => ({
            accountId,
            entityType: c.entityType,
            keywordId: c.entityType === 'keyword' ? c.entityId : null,
            targetId: c.entityType === 'product_target' ? c.entityId : null,
            campaignId: c.campaignId,
            currentBid: String(c.currentBid),
            anchorBid: String(c.anchorBid),
            suggestedBid: String(c.suggestedBid),
            bestWindow: (c.bestWindow?.windowName || 'W3_30_14') as 'W1_90_60' | 'W2_60_30' | 'W3_30_14' | 'W4_14_7' | 'W5_7_3',
            bestWindowRoas: String(c.bestWindow?.roas.toFixed(2) || '0'),
            bestWindowCpc: String(c.bestWindow?.cpc.toFixed(4) || '0'),
            bestWindowClicks: c.bestWindow?.clicks || 0,
            bestWindowOrders: c.bestWindow?.orders || 0,
            bidDriftPercent: String(c.bidDriftPercent),
            correctionAction: c.correctionAction,
            correctionReason: c.correctionReason,
            dataConfidence: c.dataConfidence,
            windowMetrics: c.windowMetrics,
            correctionStatus: dryRun ? 'pending' as const : 'applied' as const,
            appliedAt: dryRun ? null : new Date().toISOString(),
          }));
          await db.insert(bidAnchorAnalysis).values(insertValues);
        }
        log.info(`[processAccount] 账户${accountId}: 已保存 ${corrections.length} 条分析结果到数据库`);
      } catch (dbErr: unknown) {
        log.warn(`[processAccount] 账户${accountId}: 保存分析结果失败: ${(dbErr as Error).message}`);
      }
    }

    // Step 7: 批量推送出价修正到Amazon API
    if (!dryRun && corrections.length > 0) {
      log.info(`[processAccount] 账户${accountId}: 开始推送 ${corrections.length} 条出价修正...`);

      // keyword出价修正
      const kwCorrections = corrections.filter(c => c.entityType === 'keyword');
      if (kwCorrections.length > 0) {
        for (let i = 0; i < kwCorrections.length; i += CONFIG.bidUpdateBatchSize) {
          const batch = kwCorrections.slice(i, i + CONFIG.bidUpdateBatchSize);
          try {
            const updates = batch.map(c => ({
              keywordId: c.amazonId,
              bid: c.suggestedBid,
            }));
            const result = await syncService.client.updateKeywordBids(updates);
            const batchSuccess = result?.success ? batch.length : 0;
            summary.correctionsApplied += batchSuccess;
            log.info(`[processAccount] 账户${accountId}: keyword出价批次 ${Math.floor(i / CONFIG.bidUpdateBatchSize) + 1} 推送完成: ${batchSuccess}/${batch.length}`);
          } catch (apiErr: unknown) {
            summary.correctionsFailed += batch.length;
            log.warn(`[processAccount] 账户${accountId}: keyword出价推送失败: ${(apiErr as Error).message}`);
          }
          await sleep(1000);
        }
      }

      // product_target出价修正 - 使用keyword API（因为SP targeting报告返回的是keywordId）
      const ptCorrections = corrections.filter(c => c.entityType === 'product_target');
      if (ptCorrections.length > 0) {
        for (let i = 0; i < ptCorrections.length; i += CONFIG.bidUpdateBatchSize) {
          const batch = ptCorrections.slice(i, i + CONFIG.bidUpdateBatchSize);
          try {
            const updates = batch.map(c => ({
              keywordId: c.amazonId,
              bid: c.suggestedBid,
            }));
            const result = await syncService.client.updateKeywordBids(updates);
            const batchSuccess = result?.success ? batch.length : 0;
            summary.correctionsApplied += batchSuccess;
            log.info(`[processAccount] 账户${accountId}: target出价批次 ${Math.floor(i / CONFIG.bidUpdateBatchSize) + 1} 推送完成: ${batchSuccess}/${batch.length}`);
          } catch (apiErr: unknown) {
            summary.correctionsFailed += batch.length;
            log.warn(`[processAccount] 账户${accountId}: target出价推送失败: ${(apiErr as Error).message}`);
          }
          await sleep(1000);
        }
      }

      // 同步更新本地数据库中的出价
      try {
        for (const c of corrections) {
          if (c.entityType === 'keyword') {
            await db.update(keywords)
              .set({ bid: String(c.suggestedBid) })
              .where(eq(keywords.id, c.entityId));
          } else {
            await db.update(productTargets)
              .set({ bid: String(c.suggestedBid) })
              .where(eq(productTargets.id, c.entityId));
          }
        }
        log.info(`[processAccount] 账户${accountId}: 本地数据库出价已同步更新`);
      } catch (dbErr: unknown) {
        log.warn(`[processAccount] 账户${accountId}: 本地数据库更新失败: ${(dbErr as Error).message}`);
      }
    }

    log.info(`[processAccount] ========== 账户 ${accountId} 处理完成 ==========\n`);

  } catch (err: unknown) {
    log.warn(`[processAccount] 账户${accountId} 处理异常: ${(err as Error).message}`);
    summary.errors.push(`处理异常: ${(err as Error).message}`);
  }

  return summary;
}

// ==================== 主入口 ====================

export async function runEmergencyBidCorrection(options: {
  dryRun?: boolean;
  targetAccountId?: number | null;
}): Promise<{
  totalAccounts: number;
  processedAccounts: number;
  totalCorrections: number;
  totalApplied: number;
  totalFailed: number;
  summaries: ExecutionSummary[];
  duration: string;
}> {
  const startTime = Date.now();
  const dryRun = options.dryRun ?? CONFIG.dryRun;
  const targetAccountId = options.targetAccountId ?? CONFIG.targetAccountId;

  log.info('╔══════════════════════════════════════════════════════════════╗');
  log.info('║      v717-fix6 紧急全量出价修复 - 多时间窗口锚定             ║');
  log.info('╚══════════════════════════════════════════════════════════════╝');
  log.info(`模式: ${dryRun ? 'DRY RUN（仅分析）' : 'LIVE（实际修复）'}`);
  log.info(`目标账户: ${targetAccountId || '全部'}`);

  const db = await getDb();
  if (!db) throw new Error('DATABASE_UNAVAILABLE');

  // 获取所有活跃账户
  const accounts = await db
    .select({
      id: adAccounts.id,
      marketplace: adAccounts.marketplace,
      accountName: adAccounts.accountName,
      status: adAccounts.status,
    })
    .from(adAccounts)
    .where(eq(adAccounts.status, 'active'));

  // 如果指定了目标账户，过滤
  const targetAccounts = targetAccountId
    ? accounts.filter(a => a.id === targetAccountId)
    : accounts;

  log.info(`找到 ${targetAccounts.length} 个活跃账户需要处理`);

  const summaries: ExecutionSummary[] = [];
  let totalCorrections = 0;
  let totalApplied = 0;
  let totalFailed = 0;

  for (let i = 0; i < targetAccounts.length; i++) {
    const account = targetAccounts[i];
    log.info(`\n[${i + 1}/${targetAccounts.length}] 处理账户 ${account.id} (${account.accountName} ${account.marketplace})`);

    try {
      const summary = await processAccount(
        account.id,
        account.marketplace || 'US',
        dryRun
      );
      summaries.push(summary);
      totalCorrections += summary.entitiesNeedCorrection;
      totalApplied += summary.correctionsApplied;
      totalFailed += summary.correctionsFailed;
    } catch (err: unknown) {
      log.warn(`[main] 账户${account.id}处理失败: ${(err as Error).message}`);
      summaries.push({
        accountId: account.id,
        marketplace: account.marketplace || 'US',
        totalEntities: 0,
        entitiesAnalyzed: 0,
        entitiesNeedCorrection: 0,
        correctionsApplied: 0,
        correctionsFailed: 0,
        bidIncreases: 0,
        bidDecreases: 0,
        avgBidChangePercent: 0,
        errors: [(err as Error).message],
      });
    }

    // 账户间延迟
    if (i < targetAccounts.length - 1) {
      await sleep(CONFIG.accountDelayMs);
    }
  }

  const duration = `${Math.round((Date.now() - startTime) / 1000)}秒`;

  log.info('\n╔══════════════════════════════════════════════════════════════╗');
  log.info('║                    紧急修复执行总结                          ║');
  log.info('╚══════════════════════════════════════════════════════════════╝');
  log.info(`总账户: ${targetAccounts.length}`);
  log.info(`已处理: ${summaries.length}`);
  log.info(`总需修正: ${totalCorrections}`);
  log.info(`已推送: ${totalApplied}`);
  log.info(`推送失败: ${totalFailed}`);
  log.info(`总耗时: ${duration}`);
  log.info(`模式: ${dryRun ? 'DRY RUN' : 'LIVE'}`);

  return {
    totalAccounts: targetAccounts.length,
    processedAccounts: summaries.length,
    totalCorrections,
    totalApplied,
    totalFailed,
    summaries,
    duration,
  };
}
