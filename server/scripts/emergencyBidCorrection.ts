/**
 * v717: 紧急全量出价修复脚本
 * 
 * 功能：
 * 1. 遍历所有租户 → 所有店铺 → 所有站点 → 所有优化目标
 * 2. 通过Amazon Advertising API拉取过去90天的DAILY级别keyword/target绩效报告
 * 3. 将数据写入keyword_daily_performance表
 * 4. 执行多时间窗口锚点分析
 * 5. 对被错误调高/调低的投放词和投放ASIN生成修正出价
 * 6. 通过Amazon API批量推送修正后的出价
 * 
 * 使用方式：
 * npx tsx server/scripts/emergencyBidCorrection.ts [--dry-run] [--account-id=123]
 */

import { createModuleLogger } from '../utils/logger';
import { getDb } from '../db';
import { sql, eq, and, isNotNull } from 'drizzle-orm';
import {
  adAccounts,
  campaigns,
  keywords,
  productTargets,
  keywordDailyPerformance,
  bidAnchorAnalysis,
  optimizationTargets,
} from '../../drizzle/schema';
import {
  analyzeEntityBidAnchor,
  saveAnchorAnalysis,
  type AnchorAnalysisResult,
} from '../optimization/multiWindowBidAnchor';

const log = createModuleLogger('EmergencyBidCorrection');

// ==================== 配置 ====================

const CONFIG = {
  /** 拉取历史数据的天数 */
  historyDays: 90,
  /** 排除最近N天（归因延迟） */
  excludeRecentDays: 2,
  /** 每次API请求的报告天数范围 */
  reportBatchDays: 30,
  /** API调用之间的延迟(ms) */
  apiDelayMs: 500,
  /** 批量出价更新的批次大小 */
  bidUpdateBatchSize: 100,
  /** 最大并发账户数 */
  maxConcurrentAccounts: 3,
  /** 是否只分析不执行 */
  dryRun: false,
  /** 限定账户ID（null=全部） */
  targetAccountId: null as number | null,
};

// ==================== 类型 ====================

interface DailyPerformanceRow {
  accountId: number;
  campaignId: string;
  entityId: number;
  entityType: 'keyword' | 'product_target';
  internalAdGroupId: number | null;
  date: string;
  impressions: number;
  clicks: number;
  spend: number;
  sales: number;
  orders: number;
}

interface CorrectionItem {
  entityId: number;
  entityType: 'keyword' | 'product_target';
  amazonId: string;
  currentBid: number;
  suggestedBid: number;
  anchorBid: number;
  correctionAction: string;
  reason: string;
  campaignId: string;
  isProductTarget: boolean;
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
 * 从Amazon API拉取keyword级别的每日绩效数据并写入数据库
 */
async function fetchAndStoreKeywordDailyPerformance(
  accountId: number,
  syncService: any,
  campaignList: Array<{ campaignId: string; localId: number; campaignType: string }>
): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error('DATABASE_UNAVAILABLE');
  
  let totalRows = 0;
  const endDate = new Date();
  endDate.setDate(endDate.getDate() - CONFIG.excludeRecentDays);
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - CONFIG.historyDays);
  
  log.info(`[fetchDaily] 账户${accountId}: 拉取 ${startDate.toISOString().split('T')[0]} ~ ${endDate.toISOString().split('T')[0]} 的keyword每日数据`);
  
  // 按30天分批拉取报告
  let batchStart = new Date(startDate);
  while (batchStart < endDate) {
    const batchEnd = new Date(batchStart);
    batchEnd.setDate(batchEnd.getDate() + CONFIG.reportBatchDays);
    if (batchEnd > endDate) batchEnd.setTime(endDate.getTime());
    
    const startStr = batchStart.toISOString().split('T')[0];
    const endStr = batchEnd.toISOString().split('T')[0];
    
    try {
      // 调用Amazon SP API获取keyword绩效报告(DAILY粒度)
      // 使用v3 Reporting API: POST /reporting/reports
      const reportData = await requestKeywordDailyReport(
        syncService, accountId, startStr, endStr, 'SP'
      );
      
      if (reportData && reportData.length > 0) {
        // 批量写入数据库
        const batchRows = await writePerformanceData(db, accountId, reportData, campaignList);
        totalRows += batchRows;
        log.info(`[fetchDaily] 账户${accountId}: ${startStr}~${endStr} 写入 ${batchRows} 条keyword每日数据`);
      }
    } catch (err: unknown) {
      log.warn(`[fetchDaily] 账户${accountId} ${startStr}~${endStr} 报告拉取失败: ${(err as Error).message}`);
    }
    
    // 延迟避免API限流
    await sleep(CONFIG.apiDelayMs);
    batchStart = new Date(batchEnd);
  }
  
  log.info(`[fetchDaily] 账户${accountId}: 共写入 ${totalRows} 条keyword每日数据`);
  return totalRows;
}

/**
 * 通过Amazon Advertising API v3 Reporting请求keyword级别的每日报告
 */
async function requestKeywordDailyReport(
  syncService: any,
  accountId: number,
  startDate: string,
  endDate: string,
  adType: 'SP' | 'SB' | 'SD'
): Promise<DailyPerformanceRow[]> {
  const results: DailyPerformanceRow[] = [];
  
  try {
    // 使用syncService的client来调用报告API
    // Amazon SP API v3: POST /sp/keywords/report
    const client = syncService.client;
    if (!client) {
      log.warn(`[requestReport] 账户${accountId}的API客户端不可用`);
      return results;
    }
    
    // 构建报告请求 — 使用Amazon Ads API v3 Reporting
    const reportConfig = {
      reportDate: startDate,
      // 对于keyword报告，使用keywords端点
      metrics: ['impressions', 'clicks', 'spend', 'sales14d', 'orders14d', 'unitsSold14d'],
      segment: 'date',
      groupBy: ['keyword'],
      startDate,
      endDate,
    };
    
    // 尝试使用client的getKeywordReport方法（如果存在）
    if (typeof client.getKeywordPerformanceReport === 'function') {
      const reportRows = await client.getKeywordPerformanceReport(reportConfig);
      if (Array.isArray(reportRows)) {
        for (const row of reportRows) {
          results.push({
            accountId,
            campaignId: String(row.campaignId || ''),
            entityId: Number(row.keywordId || row.targetId || 0),
            entityType: row.targetId ? 'product_target' : 'keyword',
            internalAdGroupId: null,
            date: String(row.date || row.reportDate || startDate),
            impressions: Number(row.impressions || 0),
            clicks: Number(row.clicks || 0),
            spend: Number(row.spend || row.cost || 0),
            sales: Number(row.sales14d || row.sales || 0),
            orders: Number(row.orders14d || row.orders || row.purchases14d || 0),
          });
        }
      }
    } else {
      // 降级方案：使用通用的报告API
      // 通过 POST /reporting/reports 创建异步报告
      log.debug(`[requestReport] 账户${accountId}: 使用通用报告API拉取 ${startDate}~${endDate}`);
      
      // 如果client有requestReport方法
      if (typeof client.requestReport === 'function') {
        const report = await client.requestReport({
          recordType: adType === 'SP' ? 'spKeywords' : 'sbKeywords',
          reportDate: startDate,
          metrics: ['impressions', 'clicks', 'cost', 'attributedSales14d', 'attributedConversions14d'],
        });
        
        if (report && Array.isArray(report.data)) {
          for (const row of report.data) {
            results.push({
              accountId,
              campaignId: String(row.campaignId || ''),
              entityId: Number(row.keywordId || 0),
              entityType: 'keyword',
              internalAdGroupId: null,
              date: startDate,
              impressions: Number(row.impressions || 0),
              clicks: Number(row.clicks || 0),
              spend: Number(row.cost || 0),
              sales: Number(row.attributedSales14d || 0),
              orders: Number(row.attributedConversions14d || 0),
            });
          }
        }
      }
    }
    
    // 同时拉取product_target报告
    if (typeof client.getTargetPerformanceReport === 'function') {
      const targetReportRows = await client.getTargetPerformanceReport(reportConfig);
      if (Array.isArray(targetReportRows)) {
        for (const row of targetReportRows) {
          results.push({
            accountId,
            campaignId: String(row.campaignId || ''),
            entityId: Number(row.targetId || 0),
            entityType: 'product_target',
            internalAdGroupId: null,
            date: String(row.date || row.reportDate || startDate),
            impressions: Number(row.impressions || 0),
            clicks: Number(row.clicks || 0),
            spend: Number(row.spend || row.cost || 0),
            sales: Number(row.sales14d || row.sales || 0),
            orders: Number(row.orders14d || row.orders || row.purchases14d || 0),
          });
        }
      }
    }
    
  } catch (err: unknown) {
    log.warn(`[requestReport] 账户${accountId} ${adType}报告请求失败: ${(err as Error).message}`);
  }
  
  return results;
}

/**
 * 将每日绩效数据批量写入keyword_daily_performance表
 */
async function writePerformanceData(
  db: any,
  accountId: number,
  rows: DailyPerformanceRow[],
  campaignList: Array<{ campaignId: string; localId: number; campaignType: string }>
): Promise<number> {
  if (rows.length === 0) return 0;
  
  // 构建campaignId到localId的映射
  const campaignMap = new Map(campaignList.map(c => [c.campaignId, c]));
  
  let written = 0;
  const batchSize = 500;
  
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const values = batch.map(row => {
      const spend = row.spend;
      const sales = row.sales;
      const clicks = row.clicks;
      const orders = row.orders;
      const impressions = row.impressions;
      
      return {
        accountId: row.accountId,
        campaignId: row.campaignId,
        internalAdGroupId: row.internalAdGroupId,
        keywordId: row.entityType === 'keyword' ? row.entityId : null,
        targetId: row.entityType === 'product_target' ? row.entityId : null,
        entityType: row.entityType,
        date: row.date,
        impressions,
        clicks,
        spend: String(spend.toFixed(4)),
        sales: String(sales.toFixed(2)),
        orders,
        unitsSold: 0,
        cpc: clicks > 0 ? String((spend / clicks).toFixed(4)) : null,
        acos: sales > 0 ? String((spend / sales).toFixed(4)) : null,
        roas: spend > 0 ? String((sales / spend).toFixed(2)) : null,
        ctr: impressions > 0 ? String((clicks / impressions).toFixed(6)) : null,
        cvr: clicks > 0 ? String((orders / clicks).toFixed(6)) : null,
        dataSource: 'api_report' as const,
      };
    });
    
    try {
      // 使用INSERT ... ON DUPLICATE KEY UPDATE实现UPSERT
      for (const val of values) {
        await db.insert(keywordDailyPerformance)
          .values(val)
          .onDuplicateKeyUpdate({
            set: {
              impressions: val.impressions,
              clicks: val.clicks,
              spend: val.spend,
              sales: val.sales,
              orders: val.orders,
              cpc: val.cpc,
              acos: val.acos,
              roas: val.roas,
              ctr: val.ctr,
              cvr: val.cvr,
              updatedAt: sql`CURRENT_TIMESTAMP`,
            }
          });
      }
      written += values.length;
    } catch (err: unknown) {
      log.warn(`[writePerformance] 批量写入失败(batch ${i}~${i + batch.length}): ${(err as Error).message}`);
    }
  }
  
  return written;
}

/**
 * 执行出价修正并通过Amazon API推送
 */
async function applyCorrectionsBatch(
  accountId: number,
  corrections: CorrectionItem[],
  syncService: any
): Promise<{ applied: number; failed: number; errors: string[] }> {
  const result = { applied: 0, failed: 0, errors: [] as string[] };
  
  if (CONFIG.dryRun) {
    log.info(`[applyCorrections] DRY RUN模式: 跳过${corrections.length}条出价修正的API推送`);
    result.applied = corrections.length;
    return result;
  }
  
  // 分离keyword和product_target
  const kwCorrections = corrections.filter(c => !c.isProductTarget);
  const ptCorrections = corrections.filter(c => c.isProductTarget);
  
  // 批量推送keyword出价修正
  if (kwCorrections.length > 0) {
    const { syncBidAdjustmentsToAmazon } = await import('../services/amazonApiHelper');
    
    const adjustments = kwCorrections.map(c => ({
      keywordId: c.entityId,
      newBid: Number(c.suggestedBid.toFixed(2)),
      campaignId: c.campaignId,
      reason: `[v717紧急修复] ${c.reason}`,
      isProductTarget: false,
      algorithmUsed: 'multi_window_anchor',
    }));
    
    try {
      const apiResult = await syncBidAdjustmentsToAmazon(accountId, adjustments);
      result.applied += apiResult.success;
      result.failed += apiResult.failed;
      if (apiResult.errors.length > 0) {
        result.errors.push(...apiResult.errors.slice(0, 10));
      }
      log.info(`[applyCorrections] 账户${accountId} keyword出价修正: 成功${apiResult.success}, 失败${apiResult.failed}`);
    } catch (err: unknown) {
      log.error(`[applyCorrections] 账户${accountId} keyword批量推送异常: ${(err as Error).message}`);
      result.failed += kwCorrections.length;
      result.errors.push((err as Error).message);
    }
  }
  
  // 批量推送product_target出价修正
  if (ptCorrections.length > 0) {
    const { syncBidAdjustmentsToAmazon } = await import('../services/amazonApiHelper');
    
    const adjustments = ptCorrections.map(c => ({
      keywordId: c.entityId,
      newBid: Number(c.suggestedBid.toFixed(2)),
      campaignId: c.campaignId,
      reason: `[v717紧急修复] ${c.reason}`,
      isProductTarget: true,
      algorithmUsed: 'multi_window_anchor',
    }));
    
    try {
      const apiResult = await syncBidAdjustmentsToAmazon(accountId, adjustments);
      result.applied += apiResult.success;
      result.failed += apiResult.failed;
      if (apiResult.errors.length > 0) {
        result.errors.push(...apiResult.errors.slice(0, 10));
      }
      log.info(`[applyCorrections] 账户${accountId} product_target出价修正: 成功${apiResult.success}, 失败${apiResult.failed}`);
    } catch (err: unknown) {
      log.error(`[applyCorrections] 账户${accountId} product_target批量推送异常: ${(err as Error).message}`);
      result.failed += ptCorrections.length;
      result.errors.push((err as Error).message);
    }
  }
  
  return result;
}

/**
 * 处理单个账户的紧急出价修复
 */
async function processAccount(accountId: number, marketplace: string): Promise<ExecutionSummary> {
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
    const db = await getDb();
    if (!db) throw new Error('DATABASE_UNAVAILABLE');
    
    log.info(`\n${'='.repeat(60)}`);
    log.info(`[processAccount] 开始处理账户 ${accountId} (${marketplace})`);
    log.info(`${'='.repeat(60)}`);
    
    // Step 1: 获取API服务
    const { getAmazonSyncService } = await import('../services/amazonApiHelper');
    const syncService = await getAmazonSyncService(accountId);
    if (!syncService) {
      summary.errors.push('无法获取API服务（凭证缺失或过期）');
      log.warn(`[processAccount] 账户${accountId}: API服务不可用，跳过`);
      return summary;
    }
    
    // Step 2: 获取该账户的所有活跃campaign
    const activeCampaigns = await db
      .select({
        campaignId: campaigns.campaignId,
        localId: campaigns.id,
        campaignType: campaigns.campaignType,
        campaignName: campaigns.campaignName,
      })
      .from(campaigns)
      .where(and(
        eq(campaigns.accountId, accountId),
        eq(campaigns.campaignStatus, 'enabled')
      ));
    
    log.info(`[processAccount] 账户${accountId}: ${activeCampaigns.length}个活跃campaign`);
    
    // Step 3: 拉取90天keyword每日绩效数据
    log.info(`[processAccount] 账户${accountId}: 开始拉取90天keyword每日绩效数据...`);
    const totalDataRows = await fetchAndStoreKeywordDailyPerformance(
      accountId, syncService,
      activeCampaigns.map(c => ({
        campaignId: c.campaignId,
        localId: c.localId,
        campaignType: c.campaignType || 'SP',
      }))
    );
    log.info(`[processAccount] 账户${accountId}: 共写入 ${totalDataRows} 条每日绩效数据`);
    
    // Step 4: 获取所有enabled的keywords和product_targets
    const enabledKeywords = await db
      .select({
        id: keywords.id,
        bid: keywords.bid,
        campaignId: keywords.campaignId,
        keywordId: keywords.keywordId,
        keywordText: keywords.keywordText,
        suggestedBid: keywords.suggestedBid,
        suggestedBidLow: keywords.suggestedBidLow,
        suggestedBidHigh: keywords.suggestedBidHigh,
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
        suggestedBid: productTargets.suggestedBid,
        suggestedBidLow: productTargets.suggestedBidLow,
        suggestedBidHigh: productTargets.suggestedBidHigh,
      })
      .from(productTargets)
      .where(and(
        eq(productTargets.accountId, accountId),
        eq(productTargets.targetStatus, 'enabled')
      ));
    
    summary.totalEntities = enabledKeywords.length + enabledTargets.length;
    log.info(`[processAccount] 账户${accountId}: ${enabledKeywords.length}个keyword + ${enabledTargets.length}个product_target = ${summary.totalEntities}个实体`);
    
    // Step 5: 逐个分析并收集需要修正的实体
    const corrections: CorrectionItem[] = [];
    let bidChangeSum = 0;
    
    // 分析keywords
    for (const kw of enabledKeywords) {
      try {
        const currentBid = parseFloat(kw.bid || '0');
        if (currentBid <= 0) continue;
        
        const result = await analyzeEntityBidAnchor(
          accountId, kw.id, 'keyword', currentBid, kw.campaignId,
          kw.suggestedBid ? parseFloat(String(kw.suggestedBid)) : undefined,
          kw.suggestedBidLow ? parseFloat(String(kw.suggestedBidLow)) : undefined,
          kw.suggestedBidHigh ? parseFloat(String(kw.suggestedBidHigh)) : undefined
        );
        
        summary.entitiesAnalyzed++;
        
        // 保存分析结果
        await saveAnchorAnalysis(result);
        
        if (result.correctionAction !== 'maintain' && result.dataConfidence !== 'insufficient') {
          summary.entitiesNeedCorrection++;
          
          const bidChange = result.suggestedBid - currentBid;
          bidChangeSum += Math.abs(bidChange / currentBid) * 100;
          
          if (bidChange > 0) summary.bidIncreases++;
          else summary.bidDecreases++;
          
          corrections.push({
            entityId: kw.id,
            entityType: 'keyword',
            amazonId: kw.keywordId || '',
            currentBid,
            suggestedBid: result.suggestedBid,
            anchorBid: result.anchorBid,
            correctionAction: result.correctionAction,
            reason: result.correctionReason,
            campaignId: kw.campaignId,
            isProductTarget: false,
          });
          
          log.info(`[correction] keyword ${kw.id} "${kw.keywordText}": $${currentBid.toFixed(2)} → $${result.suggestedBid.toFixed(2)} (${result.correctionAction}) | ${result.correctionReason}`);
        }
        
        if (summary.entitiesAnalyzed % 50 === 0) {
          log.info(`[processAccount] 进度: ${summary.entitiesAnalyzed}/${summary.totalEntities}, 需修正: ${summary.entitiesNeedCorrection}`);
        }
      } catch (err: unknown) {
        log.warn(`[processAccount] 分析keyword ${kw.id} 失败: ${(err as Error).message}`);
      }
    }
    
    // 分析product_targets
    for (const pt of enabledTargets) {
      try {
        const currentBid = parseFloat(pt.bid || '0');
        if (currentBid <= 0) continue;
        
        const result = await analyzeEntityBidAnchor(
          accountId, pt.id, 'product_target', currentBid, pt.campaignId,
          pt.suggestedBid ? parseFloat(String(pt.suggestedBid)) : undefined,
          pt.suggestedBidLow ? parseFloat(String(pt.suggestedBidLow)) : undefined,
          pt.suggestedBidHigh ? parseFloat(String(pt.suggestedBidHigh)) : undefined
        );
        
        summary.entitiesAnalyzed++;
        await saveAnchorAnalysis(result);
        
        if (result.correctionAction !== 'maintain' && result.dataConfidence !== 'insufficient') {
          summary.entitiesNeedCorrection++;
          
          const bidChange = result.suggestedBid - currentBid;
          bidChangeSum += Math.abs(bidChange / currentBid) * 100;
          
          if (bidChange > 0) summary.bidIncreases++;
          else summary.bidDecreases++;
          
          corrections.push({
            entityId: pt.id,
            entityType: 'product_target',
            amazonId: pt.targetId || '',
            currentBid,
            suggestedBid: result.suggestedBid,
            anchorBid: result.anchorBid,
            correctionAction: result.correctionAction,
            reason: result.correctionReason,
            campaignId: pt.campaignId,
            isProductTarget: true,
          });
          
          log.info(`[correction] product_target ${pt.id} "${pt.targetValue}": $${currentBid.toFixed(2)} → $${result.suggestedBid.toFixed(2)} (${result.correctionAction})`);
        }
      } catch (err: unknown) {
        log.warn(`[processAccount] 分析product_target ${pt.id} 失败: ${(err as Error).message}`);
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
    if (corrections.length > 0) {
      log.info(`[processAccount] 账户${accountId}: 开始推送 ${corrections.length} 条出价修正...`);
      
      // 分批推送
      for (let i = 0; i < corrections.length; i += CONFIG.bidUpdateBatchSize) {
        const batch = corrections.slice(i, i + CONFIG.bidUpdateBatchSize);
        const batchResult = await applyCorrectionsBatch(accountId, batch, syncService);
        
        summary.correctionsApplied += batchResult.applied;
        summary.correctionsFailed += batchResult.failed;
        summary.errors.push(...batchResult.errors);
        
        // 批次间延迟
        if (i + CONFIG.bidUpdateBatchSize < corrections.length) {
          await sleep(1000);
        }
      }
      
      log.info(`[processAccount] 账户${accountId} 出价修正推送完成: 成功${summary.correctionsApplied}, 失败${summary.correctionsFailed}`);
    }
    
    // Step 7: 更新bid_anchor_analysis表的执行状态
    if (!CONFIG.dryRun && corrections.length > 0) {
      const appliedIds = corrections.map(c => c.entityId);
      // 批量更新状态为applied
      for (const correction of corrections) {
        try {
          const condition = correction.entityType === 'keyword'
            ? and(
                eq(bidAnchorAnalysis.accountId, accountId),
                eq(bidAnchorAnalysis.keywordId, correction.entityId)
              )
            : and(
                eq(bidAnchorAnalysis.accountId, accountId),
                eq(bidAnchorAnalysis.targetId, correction.entityId)
              );
          
          await db.update(bidAnchorAnalysis)
            .set({
              correctionStatus: 'applied',
              appliedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
            })
            .where(condition);
        } catch (_: unknown) { /* 状态更新失败不影响主流程 */ }
      }
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
  log.info(`# 模式: ${CONFIG.dryRun ? 'DRY RUN (只分析不执行)' : '🔴 LIVE (实际推送出价修正)'}`);
  if (CONFIG.targetAccountId) log.info(`# 限定账户: ${CONFIG.targetAccountId}`);
  log.info(`${'#'.repeat(70)}\n`);
  
  const db = await getDb();
  if (!db) throw new Error('DATABASE_UNAVAILABLE');
  
  // 执行数据库迁移（创建新表）
  try {
    log.info('[migration] 检查并创建v717新表...');
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
        INDEX idx_kdp_target_date (target_id, date),
        INDEX idx_kdp_campaign_date (campaign_id, date),
        INDEX idx_kdp_entity_type (entity_type, date)
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
        correction_action ENUM('maintain', 'gradual_restore', 'restore_to_anchor', 'update_anchor', 'emergency_restore') DEFAULT 'maintain',
        suggested_bid DECIMAL(10, 4) DEFAULT NULL,
        correction_reason TEXT DEFAULT NULL,
        window_metrics JSON DEFAULT NULL,
        data_confidence ENUM('high', 'medium', 'low', 'insufficient') DEFAULT 'insufficient',
        total_data_points INT DEFAULT 0,
        correction_status ENUM('pending', 'applied', 'skipped', 'failed') DEFAULT 'pending',
        applied_at TIMESTAMP NULL DEFAULT NULL,
        api_response_id VARCHAR(128) DEFAULT NULL,
        analyzed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL,
        UNIQUE KEY uk_baa_entity (account_id, keyword_id, target_id),
        INDEX idx_baa_account (account_id),
        INDEX idx_baa_campaign (campaign_id),
        INDEX idx_baa_degradation (degradation_level),
        INDEX idx_baa_correction (correction_action, correction_status),
        INDEX idx_baa_analyzed (analyzed_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    log.info('[migration] v717新表创建/验证完成');
  } catch (migErr: unknown) {
    log.warn(`[migration] 表创建警告(可能已存在): ${(migErr as Error).message}`);
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
    // 获取所有有活跃优化目标的账户
    const activeAccounts = await db
      .select({
        id: adAccounts.id,
        marketplace: adAccounts.marketplace,
      })
      .from(adAccounts)
      .where(eq(adAccounts.authStatus, 'active'));
    
    accountsToProcess = activeAccounts.map(a => ({
      id: a.id,
      marketplace: a.marketplace || 'US',
    }));
  }
  
  log.info(`[main] 共 ${accountsToProcess.length} 个账户需要处理`);
  
  // 逐个处理账户（避免API限流）
  const allSummaries: ExecutionSummary[] = [];
  
  for (const account of accountsToProcess) {
    const summary = await processAccount(account.id, account.marketplace);
    allSummaries.push(summary);
    
    // 账户间延迟
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

// ==================== CLI入口 ====================

// 如果直接运行此脚本
const isDirectRun = process.argv[1]?.includes('emergencyBidCorrection');
if (isDirectRun) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const accountIdArg = args.find(a => a.startsWith('--account-id='));
  const accountId = accountIdArg ? parseInt(accountIdArg.split('=')[1]) : undefined;
  
  runEmergencyBidCorrection({ dryRun, accountId })
    .then(summaries => {
      console.log('\n紧急出价修复完成');
      process.exit(0);
    })
    .catch(err => {
      console.error('紧急出价修复失败:', err);
      process.exit(1);
    });
}
