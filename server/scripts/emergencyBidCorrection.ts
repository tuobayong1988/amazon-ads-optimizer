/**
 * v717: 紧急全量出价修复脚本
 * 
 * 核心策略：
 * 1. 遍历所有租户 → 所有店铺 → 所有站点 → 所有优化目标
 * 2. 对每个账户，分别请求5个时间窗口的SP Keyword SUMMARY报告：
 *    W1(90-60天), W2(60-30天), W3(30-14天), W4(14-7天), W5(7-3天)
 * 3. 对每个投放词/ASIN，找出ROAS最好的时间窗口，取其CPC作为锚定出价
 * 4. 对比当前出价，生成修正指令并通过Amazon API批量推送
 * 
 * 使用方式：通过管理后台API触发
 */

import { createModuleLogger } from '../utils/logger';
import { getDb } from '../db';
import { sql, eq, and } from 'drizzle-orm';
import {
  adAccounts,
  campaigns,
  keywords,
  productTargets,
  keywordDailyPerformance,
  bidAnchorAnalysis,
} from '../../drizzle/schema';
import { getAmazonSyncService } from '../services/amazonApiHelper';

const log = createModuleLogger('EmergencyBidCorrection');

// ==================== 配置 ====================

const CONFIG = {
  /** 排除最近N天（归因延迟） */
  excludeRecentDays: 2,
  /** API调用之间的延迟(ms) */
  apiDelayMs: 1000,
  /** 报告等待超时(ms) */
  reportTimeoutMs: 600000,
  /** 批量出价更新的批次大小 */
  bidUpdateBatchSize: 100,
  /** 是否只分析不执行 */
  dryRun: false,
  /** 限定账户ID（null=全部） */
  targetAccountId: null as number | null,
  /** 出价偏离阈值 - 超过此百分比才触发修正 */
  bidDriftThresholdPercent: 15,
  /** 最小数据量要求 - 至少N次点击才认为窗口有效 */
  minClicksForValidWindow: 3,
  /** 最小订单量要求 - 至少N个订单才认为窗口有出单数据 */
  minOrdersForAnchor: 1,
  /** 单次最大调整幅度 */
  maxAdjustmentPercent: 40,
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
  correctionAction: 'maintain' | 'restore_down' | 'restore_up' | 'emergency_restore';
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

// ==================== 核心函数 ====================

/**
 * 为一个账户请求5个时间窗口的keyword报告并返回按entity聚合的数据
 */
async function fetchWindowReports(
  client: any,
  accountId: number
): Promise<Map<string, WindowMetrics[]>> {
  const entityWindowMap = new Map<string, WindowMetrics[]>();
  const today = new Date();
  
  for (const window of TIME_WINDOWS) {
    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() - window.endDaysAgo);
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - window.startDaysAgo);
    
    const startStr = startDate.toISOString().split('T')[0];
    const endStr = endDate.toISOString().split('T')[0];
    
    log.info(`[fetchWindowReports] 账户${accountId}: 请求 ${window.label} (${startStr} ~ ${endStr}) 报告...`);
    
    try {
      // 使用现有的requestSpKeywordReport方法（SUMMARY模式）
      const reportId = await client.requestSpKeywordReport(startStr, endStr);
      await sleep(CONFIG.apiDelayMs);
      
      const data = await client.waitAndDownloadReport(reportId, CONFIG.reportTimeoutMs);
      
      if (data && Array.isArray(data) && data.length > 0) {
        log.info(`[fetchWindowReports] 账户${accountId} ${window.label}: 获取 ${data.length} 条记录`);
        
        for (const row of data) {
          const keywordId = String(row.keywordId || '');
          const targetId = String(row.targetId || '');
          const entityKey = keywordId ? `kw_${keywordId}` : (targetId ? `pt_${targetId}` : '');
          if (!entityKey) continue;
          
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
      } else {
        log.warn(`[fetchWindowReports] 账户${accountId} ${window.label}: 报告数据为空`);
      }
    } catch (err: unknown) {
      log.warn(`[fetchWindowReports] 账户${accountId} ${window.label} 报告失败: ${(err as Error).message}`);
    }
    
    // 窗口间延迟避免API限流
    await sleep(CONFIG.apiDelayMs * 2);
  }
  
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
  
  // 过滤有效窗口（至少有最低点击量）
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
    // 按ROAS降序排列，找出表现最好的窗口
    bestWindow = windowsWithOrders.sort((a, b) => b.roas - a.roas)[0];
  } else {
    // 没有出单窗口，找花费效率最高的（CPC最低且有一定曝光的）
    bestWindow = validWindows.sort((a, b) => a.cpc - b.cpc)[0];
  }
  
  if (!bestWindow || bestWindow.cpc <= 0) {
    result.correctionReason = '无法确定有效的锚定CPC';
    return result;
  }
  
  result.bestWindow = bestWindow;
  result.anchorBid = parseFloat(bestWindow.cpc.toFixed(2));
  
  // 计算当前出价与锚定出价的偏离度
  const drift = ((currentBid - result.anchorBid) / result.anchorBid) * 100;
  result.bidDriftPercent = parseFloat(drift.toFixed(2));
  
  // 判断是否需要修正
  const absDrift = Math.abs(drift);
  
  if (absDrift <= CONFIG.bidDriftThresholdPercent) {
    result.correctionAction = 'maintain';
    result.suggestedBid = currentBid;
    result.correctionReason = `出价偏离${drift.toFixed(1)}%，在${CONFIG.bidDriftThresholdPercent}%阈值内，无需修正`;
    return result;
  }
  
  // 检查最近窗口(W5)是否恶化
  const recentWindow = windowMetrics.find(w => w.name === 'W5_7_3');
  const isRecentDegraded = recentWindow && bestWindow.name !== 'W5_7_3' && 
    recentWindow.clicks >= CONFIG.minClicksForValidWindow &&
    (recentWindow.roas < bestWindow.roas * 0.5 || recentWindow.acos > bestWindow.acos * 2);
  
  if (drift > 0) {
    // 当前出价高于锚定 - 被错误调高
    if (absDrift > 50 || isRecentDegraded) {
      result.correctionAction = 'emergency_restore';
      result.correctionReason = `出价被错误调高${drift.toFixed(1)}%（当前$${currentBid} vs 最佳窗口CPC $${result.anchorBid}），紧急回调`;
    } else {
      result.correctionAction = 'restore_down';
      result.correctionReason = `出价偏高${drift.toFixed(1)}%（当前$${currentBid} vs ${bestWindow.windowName}窗口CPC $${result.anchorBid}），向下修正`;
    }
  } else {
    // 当前出价低于锚定 - 被错误调低
    if (absDrift > 50) {
      result.correctionAction = 'emergency_restore';
      result.correctionReason = `出价被错误调低${Math.abs(drift).toFixed(1)}%（当前$${currentBid} vs 最佳窗口CPC $${result.anchorBid}），紧急恢复`;
    } else {
      result.correctionAction = 'restore_up';
      result.correctionReason = `出价偏低${Math.abs(drift).toFixed(1)}%（当前$${currentBid} vs ${bestWindow.windowName}窗口CPC $${result.anchorBid}），向上修正`;
    }
  }
  
  // 计算建议出价（限制单次调整幅度）
  let targetBid = result.anchorBid;
  const maxChange = currentBid * (CONFIG.maxAdjustmentPercent / 100);
  
  if (Math.abs(targetBid - currentBid) > maxChange) {
    // 限制单次调整幅度
    targetBid = drift > 0 
      ? currentBid - maxChange  // 调低
      : currentBid + maxChange; // 调高
  }
  
  // 确保出价在合理范围内
  targetBid = Math.max(0.02, Math.min(targetBid, 100));
  result.suggestedBid = parseFloat(targetBid.toFixed(2));
  
  return result;
}

/**
 * 处理单个账户的紧急修复
 */
async function processAccount(
  accountId: number,
  marketplace: string
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
    log.info(`\n[processAccount] 开始处理账户 ${accountId} (${marketplace})`);
    log.info('============================================================');
    
    const db = await getDb();
    if (!db) throw new Error('DATABASE_UNAVAILABLE');
    
    // Step 1: 获取Amazon API客户端
    let syncService: any;
    try {
      syncService = await getAmazonSyncService(accountId);
      if (!syncService || !syncService.client) {
        log.warn(`[processAccount] 账户${accountId}: 无法获取API客户端，跳过`);
        summary.errors.push('API客户端不可用');
        return summary;
      }
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
    log.info(`[processAccount] 账户${accountId}: ${enabledKeywords.length}个keyword + ${enabledTargets.length}个product_target = ${summary.totalEntities}个实体`);
    
    if (summary.totalEntities === 0) {
      log.info(`[processAccount] 账户${accountId}: 无活跃实体，跳过`);
      return summary;
    }
    
    // Step 3: 请求5个时间窗口的报告数据
    log.info(`[processAccount] 账户${accountId}: 开始请求5个时间窗口报告...`);
    const entityWindowMap = await fetchWindowReports(syncService.client, accountId);
    log.info(`[processAccount] 账户${accountId}: 获取到 ${entityWindowMap.size} 个实体的多窗口数据`);
    
    if (entityWindowMap.size === 0) {
      log.warn(`[processAccount] 账户${accountId}: 所有窗口报告数据为空，跳过分析`);
      summary.errors.push('所有窗口报告数据为空');
      return summary;
    }
    
    // Step 4: 构建Amazon ID到本地ID的映射
    const kwByAmazonId = new Map<string, typeof enabledKeywords[0]>();
    for (const kw of enabledKeywords) {
      if (kw.keywordId) kwByAmazonId.set(kw.keywordId, kw);
    }
    
    const ptByAmazonId = new Map<string, typeof enabledTargets[0]>();
    for (const pt of enabledTargets) {
      if (pt.targetId) ptByAmazonId.set(pt.targetId, pt);
    }
    
    // Step 5: 分析每个实体并收集需要修正的
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
        
        const entityLabel = isKeyword 
          ? `keyword ${entityId} "${localEntity.keywordText?.slice(0, 30)}"`
          : `target ${entityId} "${localEntity.targetValue?.slice(0, 30)}"`;
        log.info(`[correction] ${entityLabel}: $${currentBid.toFixed(2)} → $${analysis.suggestedBid.toFixed(2)} (${analysis.correctionAction}) | 最佳窗口: ${analysis.bestWindow?.windowName} ROAS=${analysis.bestWindow?.roas.toFixed(2)} | ${analysis.correctionReason}`);
      }
      
      // 进度报告
      if (summary.entitiesAnalyzed % 500 === 0) {
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
    
    // Step 6: 批量推送出价修正到Amazon API
    if (!CONFIG.dryRun && corrections.length > 0) {
      log.info(`[processAccount] 账户${accountId}: 开始推送 ${corrections.length} 条出价修正...`);
      
      // 分离keyword和product_target修正
      const kwCorrections = corrections.filter(c => c.entityType === 'keyword');
      const ptCorrections = corrections.filter(c => c.entityType === 'product_target');
      
      // 批量推送keyword出价修正
      if (kwCorrections.length > 0) {
        for (let i = 0; i < kwCorrections.length; i += CONFIG.bidUpdateBatchSize) {
          const batch = kwCorrections.slice(i, i + CONFIG.bidUpdateBatchSize);
          try {
            const updates = batch.map(c => ({
              keywordId: c.amazonId,
              bid: c.suggestedBid,
            }));
            
            const result = await syncService.client.updateKeywordBids(updates);
            const applied = result.success ? batch.length : 0;
            summary.correctionsApplied += applied;
            if (!result.success) {
              summary.correctionsFailed += batch.length;
              summary.errors.push(`keyword批次${Math.floor(i / CONFIG.bidUpdateBatchSize) + 1}推送失败`);
            }
            
            log.info(`[pushBids] keyword批次${Math.floor(i / CONFIG.bidUpdateBatchSize) + 1}: ${applied}/${batch.length}成功`);
          } catch (err: unknown) {
            summary.correctionsFailed += batch.length;
            summary.errors.push(`keyword批次推送异常: ${(err as Error).message}`);
            log.warn(`[pushBids] keyword批次推送异常: ${(err as Error).message}`);
          }
          
          await sleep(CONFIG.apiDelayMs);
        }
      }
      
      // 批量推送product_target出价修正
      if (ptCorrections.length > 0) {
        for (let i = 0; i < ptCorrections.length; i += CONFIG.bidUpdateBatchSize) {
          const batch = ptCorrections.slice(i, i + CONFIG.bidUpdateBatchSize);
          try {
            const updates = batch.map(c => ({
              targetId: c.amazonId,
              bid: c.suggestedBid,
            }));
            
            const result = await syncService.client.updateProductTargetBids(updates);
            const applied = result.success ? batch.length : 0;
            summary.correctionsApplied += applied;
            if (!result.success) {
              summary.correctionsFailed += batch.length;
              summary.errors.push(`target批次${Math.floor(i / CONFIG.bidUpdateBatchSize) + 1}推送失败`);
            }
            
            log.info(`[pushBids] target批次${Math.floor(i / CONFIG.bidUpdateBatchSize) + 1}: ${applied}/${batch.length}成功`);
          } catch (err: unknown) {
            summary.correctionsFailed += batch.length;
            summary.errors.push(`target批次推送异常: ${(err as Error).message}`);
            log.warn(`[pushBids] target批次推送异常: ${(err as Error).message}`);
          }
          
          await sleep(CONFIG.apiDelayMs);
        }
      }
      
      log.info(`[processAccount] 账户${accountId} 出价修正推送完成: 成功${summary.correctionsApplied}, 失败${summary.correctionsFailed}`);
      
      // Step 7: 更新本地数据库中的出价记录
      for (const correction of corrections) {
        try {
          if (correction.entityType === 'keyword') {
            await db.update(keywords)
              .set({ bid: String(correction.suggestedBid.toFixed(2)) })
              .where(eq(keywords.id, correction.entityId));
          } else {
            await db.update(productTargets)
              .set({ bid: String(correction.suggestedBid.toFixed(2)) })
              .where(eq(productTargets.id, correction.entityId));
          }
        } catch (_: unknown) { /* 本地更新失败不影响主流程 */ }
      }
    } else if (CONFIG.dryRun && corrections.length > 0) {
      log.info(`[processAccount] DRY RUN模式 - 以下修正将不会实际推送:`);
      for (const c of corrections.slice(0, 20)) {
        log.info(`  ${c.entityType} ${c.entityId}: $${c.currentBid.toFixed(2)} → $${c.suggestedBid.toFixed(2)} (${c.correctionAction})`);
      }
      if (corrections.length > 20) {
        log.info(`  ... 还有 ${corrections.length - 20} 条修正`);
      }
    }
    
    // Step 8: 保存分析结果到bid_anchor_analysis表
    try {
      for (const c of corrections) {
        await db.insert(bidAnchorAnalysis).values({
          accountId,
          campaignId: c.campaignId,
          keywordId: c.entityType === 'keyword' ? c.entityId : null,
          targetId: c.entityType === 'product_target' ? c.entityId : null,
          entityType: c.entityType,
          bestWindow: c.bestWindow?.windowName as any || null,
          bestWindowRoas: c.bestWindow ? String(c.bestWindow.roas.toFixed(2)) : null,
          bestWindowAcos: c.bestWindow ? String(c.bestWindow.acos.toFixed(4)) : null,
          bestWindowCpc: c.bestWindow ? String(c.bestWindow.cpc.toFixed(4)) : null,
          bestWindowClicks: c.bestWindow?.clicks || 0,
          bestWindowOrders: c.bestWindow?.orders || 0,
          anchorBid: String(c.anchorBid.toFixed(4)),
          currentBid: String(c.currentBid.toFixed(4)),
          bidDriftPercent: String(c.bidDriftPercent.toFixed(4)),
          degradationLevel: Math.abs(c.bidDriftPercent) > 50 ? 'critical' : (Math.abs(c.bidDriftPercent) > 30 ? 'severe' : 'mild'),
          correctionAction: c.correctionAction as any,
          suggestedBid: String(c.suggestedBid.toFixed(4)),
          correctionReason: c.correctionReason,
          windowMetrics: JSON.stringify(c.windowMetrics),
          dataConfidence: c.dataConfidence,
          correctionStatus: CONFIG.dryRun ? 'pending' : 'applied',
          analyzedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
          appliedAt: CONFIG.dryRun ? null : new Date().toISOString().slice(0, 19).replace('T', ' '),
        }).onDuplicateKeyUpdate({
          set: {
            bestWindow: c.bestWindow?.windowName as any || null,
            bestWindowRoas: c.bestWindow ? String(c.bestWindow.roas.toFixed(2)) : null,
            anchorBid: String(c.anchorBid.toFixed(4)),
            currentBid: String(c.currentBid.toFixed(4)),
            bidDriftPercent: String(c.bidDriftPercent.toFixed(4)),
            correctionAction: c.correctionAction as any,
            suggestedBid: String(c.suggestedBid.toFixed(4)),
            correctionReason: c.correctionReason,
            correctionStatus: CONFIG.dryRun ? 'pending' : 'applied',
            analyzedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
          },
        });
      }
      log.info(`[processAccount] 账户${accountId}: ${corrections.length}条分析结果已保存到bid_anchor_analysis表`);
    } catch (saveErr: unknown) {
      log.warn(`[processAccount] 保存分析结果失败: ${(saveErr as Error).message}`);
    }
    
  } catch (err: unknown) {
    const errorMsg = `账户${accountId}处理异常: ${(err as Error).message}`;
    log.error(`[processAccount] ${errorMsg}`);
    summary.errors.push(errorMsg);
  }
  
  return summary;
}

// ==================== 主入口 ====================

export async function runEmergencyBidCorrection(options?: {
  dryRun?: boolean;
  accountId?: number;
}): Promise<ExecutionSummary[]> {
  if (options?.dryRun !== undefined) CONFIG.dryRun = options.dryRun;
  if (options?.accountId) CONFIG.targetAccountId = options.accountId;
  
  log.info(`\n${'#'.repeat(70)}`);
  log.info(`# v717 紧急全量出价修复 - ${new Date().toISOString()}`);
  log.info(`# 模式: ${CONFIG.dryRun ? 'DRY RUN (只分析不执行)' : 'LIVE (实际推送出价修正)'}`);
  if (CONFIG.targetAccountId) log.info(`# 限定账户: ${CONFIG.targetAccountId}`);
  log.info(`${'#'.repeat(70)}\n`);
  
  const db = await getDb();
  if (!db) throw new Error('DATABASE_UNAVAILABLE');
  
  // 确保新表存在
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS keyword_daily_performance (
        id INT AUTO_INCREMENT PRIMARY KEY,
        account_id INT NOT NULL,
        campaign_id VARCHAR(64) NOT NULL,
        internal_ad_group_id INT DEFAULT NULL,
        keyword_id INT DEFAULT NULL,
        target_id INT DEFAULT NULL,
        entity_type ENUM('keyword', 'product_target') NOT NULL,
        date DATE NOT NULL,
        impressions INT DEFAULT 0,
        clicks INT DEFAULT 0,
        spend DECIMAL(12, 4) DEFAULT 0.0000,
        sales DECIMAL(12, 2) DEFAULT 0.00,
        orders INT DEFAULT 0,
        units_sold INT DEFAULT 0,
        cpc DECIMAL(10, 4) DEFAULT NULL,
        acos DECIMAL(8, 4) DEFAULT NULL,
        roas DECIMAL(10, 2) DEFAULT NULL,
        ctr DECIMAL(8, 6) DEFAULT NULL,
        cvr DECIMAL(8, 6) DEFAULT NULL,
        data_source ENUM('api_report', 'ams_stream', 'calculated') DEFAULT 'api_report',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL,
        UNIQUE KEY uk_kdp_entity_date (account_id, keyword_id, target_id, date),
        INDEX idx_kdp_account_date (account_id, date),
        INDEX idx_kdp_keyword_date (keyword_id, date),
        INDEX idx_kdp_target_date (target_id, date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS bid_anchor_analysis (
        id INT AUTO_INCREMENT PRIMARY KEY,
        account_id INT NOT NULL,
        campaign_id VARCHAR(64) NOT NULL,
        keyword_id INT DEFAULT NULL,
        target_id INT DEFAULT NULL,
        entity_type ENUM('keyword', 'product_target') NOT NULL,
        best_window ENUM('W1_90_60', 'W2_60_30', 'W3_30_14', 'W4_14_7', 'W5_7_3') DEFAULT NULL,
        best_window_roas DECIMAL(10, 2) DEFAULT NULL,
        best_window_acos DECIMAL(8, 4) DEFAULT NULL,
        best_window_cpc DECIMAL(10, 4) DEFAULT NULL,
        best_window_clicks INT DEFAULT 0,
        best_window_orders INT DEFAULT 0,
        anchor_bid DECIMAL(10, 4) NOT NULL,
        current_bid DECIMAL(10, 4) DEFAULT NULL,
        bid_drift_percent DECIMAL(8, 4) DEFAULT NULL,
        degradation_level ENUM('none', 'mild', 'severe', 'critical') DEFAULT 'none',
        degradation_detail JSON DEFAULT NULL,
        correction_action ENUM('maintain', 'gradual_restore', 'restore_to_anchor', 'update_anchor', 'emergency_restore', 'restore_down', 'restore_up') DEFAULT 'maintain',
        suggested_bid DECIMAL(10, 4) DEFAULT NULL,
        correction_reason TEXT DEFAULT NULL,
        window_metrics JSON DEFAULT NULL,
        data_confidence ENUM('high', 'medium', 'low', 'insufficient') DEFAULT 'insufficient',
        correction_status ENUM('pending', 'applied', 'failed', 'skipped') DEFAULT 'pending',
        analyzed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        applied_at TIMESTAMP DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL,
        UNIQUE KEY uk_baa_entity (account_id, keyword_id, target_id),
        INDEX idx_baa_account (account_id),
        INDEX idx_baa_correction (correction_action, correction_status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    log.info('[migration] v717新表验证完成');
  } catch (migErr: unknown) {
    log.warn(`[migration] 表创建警告: ${(migErr as Error).message}`);
  }
  
  // 获取所有需要处理的账户
  let accountsToProcess: Array<{ id: number; marketplace: string }>;
  
  if (CONFIG.targetAccountId) {
    const [acct] = await db
      .select({ id: adAccounts.id, marketplace: adAccounts.marketplace })
      .from(adAccounts)
      .where(eq(adAccounts.id, CONFIG.targetAccountId));
    accountsToProcess = acct ? [{ id: acct.id, marketplace: acct.marketplace || 'US' }] : [];
  } else {
    const activeAccounts = await db
      .select({
        id: adAccounts.id,
        marketplace: adAccounts.marketplace,
      })
      .from(adAccounts)
      .where(eq(adAccounts.status, 'active'));
    
    accountsToProcess = activeAccounts.map(a => ({
      id: a.id,
      marketplace: a.marketplace || 'US',
    }));
  }
  
  log.info(`[main] 共 ${accountsToProcess.length} 个账户需要处理`);
  
  // 逐个处理账户
  const allSummaries: ExecutionSummary[] = [];
  
  for (const account of accountsToProcess) {
    const summary = await processAccount(account.id, account.marketplace);
    allSummaries.push(summary);
    await sleep(2000);
  }
  
  // 输出总结报告
  log.info(`\n${'='.repeat(70)}`);
  log.info(`v717 紧急出价修复 - 执行总结`);
  log.info(`${'='.repeat(70)}`);
  
  let grandTotal = { entities: 0, analyzed: 0, corrections: 0, applied: 0, failed: 0, increases: 0, decreases: 0 };
  
  for (const s of allSummaries) {
    grandTotal.entities += s.totalEntities;
    grandTotal.analyzed += s.entitiesAnalyzed;
    grandTotal.corrections += s.entitiesNeedCorrection;
    grandTotal.applied += s.correctionsApplied;
    grandTotal.failed += s.correctionsFailed;
    grandTotal.increases += s.bidIncreases;
    grandTotal.decreases += s.bidDecreases;
    
    log.info(`  账户${s.accountId} (${s.marketplace}): ${s.totalEntities}实体, ${s.entitiesNeedCorrection}需修正, ${s.correctionsApplied}已推送, ${s.correctionsFailed}失败`);
    if (s.errors.length > 0) {
      log.warn(`    错误: ${s.errors.slice(0, 3).join('; ')}`);
    }
  }
  
  log.info(`\n  总计: ${grandTotal.entities}实体, ${grandTotal.analyzed}已分析, ${grandTotal.corrections}需修正`);
  log.info(`  推送: ${grandTotal.applied}成功, ${grandTotal.failed}失败`);
  log.info(`  方向: ${grandTotal.increases}上调, ${grandTotal.decreases}下调`);
  log.info(`${'='.repeat(70)}\n`);
  
  return allSummaries;
}

// ==================== 工具函数 ====================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
