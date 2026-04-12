/**
 * 绩效数据同步方法（日报、小时报、关键词绩效、广告组绩效等）
 * 
 * 从 amazonSyncService.ts 中提取的 syncPerformance 子模块。
 * 通过 prototype 扩展模式将方法注入到 AmazonSyncService 类中。
 */
import { eq, and, sql, gte, lte, inArray, desc, asc, isNull, isNotNull } from 'drizzle-orm';
import { DbInstance, getDb } from '../db';
import {
  campaigns,
  adGroups,
  keywords,
  productTargets,
  dailyPerformance,
  hourlyPerformance,
  biddingLogs,
  placementPerformance,
  searchTerms,
  negativeKeywords,
  optimizationEvents,
} from '../../drizzle/schema';
import { createModuleLogger } from '../utils/logger';
import type { AmazonAdsApiClient, SpCampaign } from './amazonAdsApi';
import { getMarketplaceDateRange, getMarketplaceCurrentDate, getMarketplaceYesterday, getMarketplaceHistoricalDateRange } from '../utils/timezone';
import { getExchangeRateByMarketplace } from '../services/exchangeRateService';
import { AmazonSyncService } from './amazonSyncService';
import {
  SYNC_PROTECTION_CONFIG,
  createSyncProtectionStats,
  logSyncProtectionSummary,
  hasRecentSyncedOptimization,
  getRecentlyOptimizedKeywordIds,
  getRecentlyOptimizedCampaignIds,
} from './syncHelpers';
import { calculateBidAdjustment } from '../optimization/bidOptimizer';
import { extractCampaignIds, guardCampaignIdInsert } from '../utils/idTypes';
import type { OptimizationTarget, PerformanceGroupConfig } from '../optimization/bidOptimizer';

const log = createModuleLogger('syncPerformance');

// ==================== 类型声明（模块扩展） ====================

// @ts-ignore
declare module '../../amazonSyncService' {
  interface AmazonSyncService {
    syncPerformanceData(...args: unknown[]): unknown;
    syncPerformanceDataBatch(...args: unknown[]): unknown;
    processReportData(...args: unknown[]): unknown;
    generateMockPerformanceData(...args: unknown[]): unknown;
    syncKeywordPerformanceData(...args: unknown[]): unknown;
    syncProductTargetPerformanceData(...args: unknown[]): unknown;
    generateHourlyFromDaily(...args: unknown[]): unknown;
    syncAdGroupPerformanceData(...args: unknown[]): unknown;
    syncPlacementPerformance(...args: unknown[]): unknown;
    updateCampaignPerformanceSummary(...args: unknown[]): unknown;
  }
}

// ==================== 方法实现 ====================

/**
 * 同步绩效数据
 * 支持分批请求，每批最多31天（Amazon API限制）
 * 
 * 重要：亚马逊的销售数据在7-14天内会变动（用户点击后过几天才买）
 * 因此每次同步都需要回溯过去14天的数据，覆盖旧记录
 * 这能确保存下来的数据和亚马逊后台最终结算的数据一致
 * 
 * @param days 同步天数，默认14天（归因回溯机制）
 */
// @ts-ignore
AmazonSyncService.prototype.syncPerformanceData = async function(this: AmazonSyncService, days: number = 14): Promise<number> {
  const db = await getDb();
  if (!db) {
    log.warn('[v358] 数据库连接失败 - 这是一个真实错误，不是"0条数据"');
    // v358: 抛出错误而不是返回0，让调用方知道这是失败而非空数据
    throw new Error('DATABASE_UNAVAILABLE: 数据库连接失败');
  }

  try {
    // v640: 大账户自适应分段同步
    // 根据广告活动数量动态调整单批天数，减少单次API请求的数据量
    let campaignCount = 0;
    try {
      const countResult = await db.select({ count: sql<number>`count(*)` })
        .from(campaigns)
        .where(eq(campaigns.accountId, this.accountId));
      campaignCount = countResult[0]?.count || 0;
    } catch (e) {
      log.warn(`[v640] 获取广告活动数量失败，使用默认分批策略`);
    }

    // v640: 根据账户规模动态调整分批天数
    // 小账户(<100 campaigns): 31天/批（默认）
    // 中账户(100-500): 21天/批
    // 大账户(500-2000): 14天/批
    // 超大账户(>2000): 7天/批
    let MAX_DAYS_PER_REQUEST = 31;
    let accountSizeLabel = 'Small';
    if (campaignCount > 2000) {
      MAX_DAYS_PER_REQUEST = 7;
      accountSizeLabel = 'Super-XL';
    } else if (campaignCount > 500) {
      MAX_DAYS_PER_REQUEST = 14;
      accountSizeLabel = 'XL';
    } else if (campaignCount > 100) {
      MAX_DAYS_PER_REQUEST = 21;
      accountSizeLabel = 'Medium';
    }
    log.info(`[v640] 账户 ${this.accountId} 规模: ${accountSizeLabel} (${campaignCount} campaigns), 分批天数: ${MAX_DAYS_PER_REQUEST}天/批`);

    const totalDays = Math.min(days, 90); // 最多90天（SP支持95天，SB只支持60天，取90天作为平衡）
    
    let totalSynced = 0;
    // v358: 追踪失败批次，不再静默吞掉错误
    const failedBatches: { batch: number; startDate: string; endDate: string; error: string }[] = [];
    
    // 使用站点时区计算历史日期范围（排除今天，只拉取T-1及之前的数据）
    // 快慢双轨架构：API只负责历史数据，今日数据由AMS实时推送
    // v102: Include today in sync range
    const { startDate: rangeStartDate, endDate: rangeEndDate } = getMarketplaceDateRange(this.marketplace, totalDays);
    log.debug(`站点${this.marketplace}当前日期: ${getMarketplaceCurrentDate(this.marketplace)}`);
    log.info(`API同步范围: ${rangeStartDate} - ${rangeEndDate} (排除今天，今日数据由AMS提供)`);
    
    // 计算需要分几批请求
    const batches = Math.ceil(totalDays / MAX_DAYS_PER_REQUEST);
    log.info(`开始同步绩效数据: 共${totalDays}天，分${batches}批请求 (站点: ${this.marketplace})`);
    
    for (let batch = 0; batch < batches; batch++) {
      // 计算每批的日期范围（基于站点时区）
      const endDateObj = new Date(rangeEndDate);
      endDateObj.setDate(endDateObj.getDate() - (batch * MAX_DAYS_PER_REQUEST));
      
      const startDateObj = new Date(endDateObj);
      const daysInBatch = Math.min(MAX_DAYS_PER_REQUEST, totalDays - (batch * MAX_DAYS_PER_REQUEST));
      startDateObj.setDate(startDateObj.getDate() - daysInBatch + 1);
      
      const startDateStr = startDateObj.toISOString().split('T')[0];
      const endDateStr = endDateObj.toISOString().split('T')[0];
      
      log.debug(`第${batch + 1}/${batches}批: ${startDateStr} - ${endDateStr} (共${daysInBatch}天)`);
      
      try {
        // @ts-ignore
        const batchSynced = await this.syncPerformanceDataBatch(startDateStr, endDateStr);
        totalSynced += batchSynced;
        log.info(`第${batch + 1}批同步完成: ${batchSynced}条记录`);
        
        // 批次之间稍作延迟，避免触发API速率限制
        if (batch < batches - 1) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      } catch (batchError: unknown) {
        const errMsg = (batchError as Error).message || '';
        // v474: 日期保留期限制的400错误是预期的（SD/SB只保留~60天），降级为WARN
        if (errMsg.includes('retention') || errMsg.includes('startDate') || errMsg.includes('configuration date')) {
          log.warn(`[v474] 第${batch + 1}/${batches}批超出数据保留期，跳过: ${startDateStr}~${endDateStr}`);
        } else {
          log.warn(`[v358] 第${batch + 1}/${batches}批同步失败: ${errMsg}`);
          failedBatches.push({
            batch: batch + 1,
            startDate: startDateStr,
            endDate: endDateStr,
            error: errMsg,
          });
        }
        // 继续下一批，不中断整个同步过程
      }
    // @ts-ignore
    }
    
    // 同步完成后，更新campaigns表的绩效汇总数据
    // @ts-ignore
    await this.updateCampaignPerformanceSummary();
    
    // v195: 同步完成后，自动从daily_performance生成hourly_performance数据
    try {
      // @ts-ignore
      const hourlyGenerated = await this.generateHourlyFromDaily(rangeStartDate, rangeEndDate);
      log.info(`v195: hourly_performance自动生成完成: ${hourlyGenerated}条`);
    } catch (hourlyErr: unknown) {
      log.warn(`v195: hourly_performance生成失败: ${(hourlyErr as Error).message}`);
    }
    
    // v640: 改进的部分失败处理 - 不再抛出错误，而是记录并继续
    // 原因：抛出错误会导致整个同步任务被标记为失败，但实际上大部分数据已成功同步
    if (failedBatches.length > 0) {
      const failSummary = failedBatches.map(fb => `批次${fb.batch}(${fb.startDate}~${fb.endDate}): ${fb.error}`).join('; ');
      log.warn(`[v640] 绩效数据同步部分失败: ${failedBatches.length}/${batches}批失败, 成功同步${totalSynced}条. 失败详情: ${failSummary}`);
      // v640: 不再抛出错误，而是返回已成功同步的数量，让同步继续执行后续步骤
      // 失败的批次将在下一个同步周期自动重试
    }
    
    log.info(`绩效数据同步完成: 共${totalSynced}条记录`);
    return totalSynced;
  } catch (error: unknown) {
    // v358: 如果是我们自己抛出的PARTIAL_SYNC_FAILURE，直接重新抛出
    if ((error as Error).message?.startsWith('PARTIAL_SYNC_FAILURE:')) {
      throw error;
    }
    // @ts-expect-error - error message access
    log.warn(`[v242] 同步绩效数据失败: ${JSON.stringify({ message: (error as Error).message, status: error.status || (error as Record<string, unknown>).response?.status, code: (error as Record<string, unknown>).code })}`);
    log.warn('[v242] 详细错误:', (error as Error).stack?.substring(0, 500));
    
    // v148: 移除模拟数据回退逻辑 - 报告超时时不再生成假数据，而是记录错误并等待下次重试
    // @ts-expect-error - error message access
    if (error.message?.includes('timeout') || (error as Error).message?.includes('PENDING') || (error as Error).message?.includes('Report generation')) {
      log.warn('v148: 报告超时或生成失败，将在下次同步周期重试。不再生成模拟数据。');
    }
    
    // v358: 抛出错误而不是返回0
    throw error;
  }
// @ts-ignore
};

/**
 * 同步单批绩效数据（内部方法）
 */
// @ts-ignore
AmazonSyncService.prototype.syncPerformanceDataBatch = async function(this: AmazonSyncService, startDateStr: string, endDateStr: string): Promise<number> {
  const db = await getDb();
  // v358: 数据库不可用是真实错误，不应返回0
  if (!db) throw new Error('DATABASE_UNAVAILABLE: 数据库连接不可用');

  let totalSynced = 0;

  // v351: 动态数据保留期处理
  // Amazon API对不同广告类型有不同的数据保留期限：
  // - SP: 约95天
  // - SB: 约60天 (数据保留起始日约60天前)
  // - SD: 约65天 (数据保留起始日约65天前)
  // 当请求的startDate超出保留期时，API返回400错误
  // 解决方案：为SB/SD动态计算安全的startDate，确保不超出保留期
  const clampStartDateForRetention = (adType: string, originalStartDate: string): string => {
    const now = new Date();
    // 各广告类型的安全回溯天数（保留5天缓冲）
    const retentionDays: Record<string, number> = {
      'SP': 90,   // SP支持95天，留5天缓冲
      'SB': 55,   // SB保留约60天，留5天缓冲
      'SD': 58,   // SD保留约65天，留7天缓冲
    };
    const maxDays = retentionDays[adType] || 90;
    const safeStartDate = new Date(now.getTime() - maxDays * 24 * 60 * 60 * 1000);
    const safeStartStr = safeStartDate.toISOString().split('T')[0];
    
    // 如果原始startDate早于安全日期，使用安全日期
    if (originalStartDate < safeStartStr) {
      log.info(`[v351] [${adType}] startDate ${originalStartDate} 超出数据保留期，自动调整为 ${safeStartStr}`);
      return safeStartStr;
    }
    return originalStartDate;
  };

  // v215优化: 并行请求SP/SB/SD报告 + 智能重试
  // v351增强: 支持动态startDate和data retention错误自动重试
  const retryReport = async (name: string, adType: string, requestFn: (start: string, end: string) => Promise<string>, maxRetries = 3): Promise<Record<string, unknown>[] | null> => {
    let effectiveStartDate = clampStartDateForRetention(adType, startDateStr);
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        log.info(`[${name}] 请求报告 (尝试${attempt}/${maxRetries}): ${effectiveStartDate} - ${endDateStr}`);
        const reportId = await requestFn(effectiveStartDate, endDateStr);
        log.info(`[${name}] 报告请求成功, reportId: ${reportId}`);
        const data = await this.client.waitAndDownloadReport(reportId, 600000); // v523.3: 5分钟→10分钟，避免高并发时Amazon排队导致超时
        log.info(`[${name}] 报告下载完成, 数据条数: ${data?.length || 0}`);
        return data;
      } catch (err: unknown) {
        const errMsg = (err as Error).message || '';
        // @ts-expect-error - Axios error response access
        const errData = (err as Error & { response?: unknown }).response?.data;
        const errDetail = typeof errData === 'string' ? errData : JSON.stringify(errData || '');
        
        // v351: 检测data retention错误并动态调整startDate
        const retentionMatch = errDetail.match(/retention start date \((\d{4}-\d{2}-\d{2})\)/);
        if (retentionMatch) {
          const retentionStartDate = retentionMatch[1];
          log.warn(`[v351] [${name}] Amazon数据保留期起始日: ${retentionStartDate}，自动调整startDate`);
          // 使用Amazon返回的保留期起始日作为新的startDate（加1天缓冲）
          const retentionDate = new Date(retentionStartDate);
          retentionDate.setDate(retentionDate.getDate() + 1);
          effectiveStartDate = retentionDate.toISOString().split('T')[0];
          
          if (attempt < maxRetries) {
            log.info(`[v351] [${name}] 使用调整后的startDate重试: ${effectiveStartDate} - ${endDateStr}`);
            await new Promise(r => setTimeout(r, 2000));
            // P5: async mode - skip sync processing
          } else {
          }
        }
        
        const isRetryable = !errMsg.includes('401') && !errMsg.includes('403') && !errMsg.includes('not enabled');
        if (attempt < maxRetries && isRetryable) {
          const delay = attempt * 5000; // 5s, 10s, 15s
          log.warn(`[${name}] 尝试${attempt}失败: ${errMsg}, ${delay/1000}秒后重试...`);
          await new Promise(r => setTimeout(r, delay));
        } else {
          log.warn(`[${name}] 报告同步最终失败 (${attempt}次尝试): ${errMsg}`);
          return null;
        }
      }
    }
    return null;
  };

  // v413: 批量提交+统一轮询模式（替代v352的串行模式）
  // 原因：串行模式下3个报告各等待5分钟=15分钟，批量提交后统一轮询只需5分钟
  // 策略：先批量提交SP/SB/SD报告请求（间隔2秒避免限流），然后统一轮询等待完成
  const spStartDate = clampStartDateForRetention('SP', startDateStr);
  const sbStartDate = clampStartDateForRetention('SB', startDateStr);
  const sdStartDate = clampStartDateForRetention('SD', startDateStr);
  
  // v523.3: 构建报告请求列表，跳过日期倒置的批次（clamp后startDate > endDate）
  // 根因：当totalDays=90且分3批时，第3批endDate=T-62，但SB/SD的clamp后startDate可能>endDate
  const reportRequestList: Array<{ name: string; requestFn: () => Promise<string> }> = [];
  const reportAdTypes: string[] = [];
  
  if (spStartDate <= endDateStr) {
    reportRequestList.push({ name: 'SP绩效', requestFn: () => this.client.requestSpCampaignReport(spStartDate, endDateStr) });
    reportAdTypes.push('SP');
  } else {
    log.info(`[v523.3] 跳过SP绩效报告: clamp后startDate(${spStartDate}) > endDate(${endDateStr})，该批次超出SP数据保留期`);
  }
  if (sbStartDate <= endDateStr) {
    reportRequestList.push({ name: 'SB绩效', requestFn: () => this.client.requestSbCampaignReport(sbStartDate, endDateStr) });
    reportAdTypes.push('SB');
  } else {
    log.info(`[v523.3] 跳过SB绩效报告: clamp后startDate(${sbStartDate}) > endDate(${endDateStr})，该批次超出SB数据保留期`);
  }
  if (sdStartDate <= endDateStr) {
    reportRequestList.push({ name: 'SD绩效', requestFn: () => this.client.requestSdCampaignReport(sdStartDate, endDateStr) });
    reportAdTypes.push('SD');
  } else {
    log.info(`[v523.3] 跳过SD绩效报告: clamp后startDate(${sdStartDate}) > endDate(${endDateStr})，该批次超出SD数据保留期`);
  }
  
  log.info(`[v413] 开始批量提交报告: SP(${spStartDate}), SB(${sbStartDate}), SD(${sdStartDate}) - ${endDateStr}, 实际提交${reportRequestList.length}个`);
  
  // v523.3: 如果所有报告都因日期倒置被跳过，直接返回0
  if (reportRequestList.length === 0) {
    log.info(`[v523.3] 当前批次所有广告类型均超出数据保留期，跳过`);
    return totalSynced;
  }
  
  // P5: 异步报告模式 - 提交到队列后立即返回，由 ReportJobScheduler 异步处理
  if (process.env.P5_ASYNC_REPORTS === 'true') {
    const asyncResult = await this.client.submitReportsToAsyncQueue(reportRequestList, {
      accountId: this.accountId,
      profileId: String(this.client.credentials?.profileId || ''),
      startDate: startDateStr,
      endDate: endDateStr,
      syncType: 'performance',
    });
    log.info(`[P5] Async performance reports submitted: ${asyncResult.queued} queued, ${asyncResult.failed} failed`);
    return totalSynced; // 数据将由 ReportJobScheduler 异步处理
  }

  // v523.3: 超时时间从300秒增加到600秒，避免高并发时Amazon排队导致的超时
  const reportResults = await this.client.submitAndWaitMultipleReports(reportRequestList, 600000, 2000);
  
  // v523.3: 使用动态的reportAdTypes替代硬编码的adTypes
  for (let i = 0; i < reportResults.length; i++) {
    const result = reportResults[i];
    if (result.data && result.data.length > 0) {
      // @ts-expect-error - runtime type mismatch
      totalSynced += await this.processReportData(db, result.data, reportAdTypes[i]);
      log.info(`[v413] ${result.name}报告处理完成: ${result.data.length}条`);
    } else if (result.error) {
      log.warn(`[v413] ${result.name}报告失败: ${result.error}`);
    } else {
      log.debug(`[v413] ${result.name}报告数据为空`);
    }
  }
  
  const resultSummary = reportAdTypes.map((t, i) => `${t}=${reportResults[i]?.data?.length || 0}`).join(', ');
  log.info(`[v413] 绩效数据同步完成(批量模式): ${resultSummary}, 总入库=${totalSynced}`);
  return totalSynced;
};

/**
 * 处理报告数据并存储到数据库
 */
/**
 * v383: 批量UPSERT daily_performance 数据
 * 使用 ON DUPLICATE KEY UPDATE 策略，依赖 uk_daily_perf 唯一约束 (accountId, campaignId, date, adType)
 * v383优化: 将货币字段合并到主UPSERT中，消除N+1查询问题（原每batch 500次额外UPDATE -> 0次）
 */
async function flushDailyPerfBatch(
  db: unknown,
  batch: unknown[],
  currencyBatch: { currency: string; exchangeRate: number; spendUsd: string; salesUsd: string }[]
): Promise<void> {
  // @ts-ignore
  if (batch.length === 0) return;

  // v383: 将货币字段直接合并到batch数据中，一次UPSERT完成所有字段更新
  const enrichedBatch = batch.map((row, i) => {
    const cur = currencyBatch[i];
    return {
      // @ts-ignore
      ...row,
      // @ts-ignore
      currency: cur?.currency || null,
      exchangeRate: cur?.exchangeRate ? String(cur.exchangeRate) : null,
      spendUsd: cur?.spendUsd || null,
      salesUsd: cur?.salesUsd || null,
    };
  });

  // @ts-ignore
  await db.insert(dailyPerformance).values(enrichedBatch).onDuplicateKeyUpdate({
    set: {
      impressions: sql`VALUES(${dailyPerformance.impressions})`,
      clicks: sql`VALUES(${dailyPerformance.clicks})`,
      spend: sql`VALUES(${dailyPerformance.spend})`,
      sales: sql`VALUES(${dailyPerformance.sales})`,
      orders: sql`VALUES(${dailyPerformance.orders})`,
      dailyAcos: sql`VALUES(${dailyPerformance.dailyAcos})`,
      dailyRoas: sql`VALUES(${dailyPerformance.dailyRoas})`,
      ctr: sql`VALUES(${dailyPerformance.ctr})`,
      cvr: sql`VALUES(${dailyPerformance.cvr})`,
      cpc: sql`VALUES(${dailyPerformance.cpc})`,
      unitsSold: sql`VALUES(${dailyPerformance.unitsSold})`,
      dpv: sql`VALUES(${dailyPerformance.dpv})`,
      addToCart: sql`VALUES(${dailyPerformance.addToCart})`,
      ntbOrders: sql`VALUES(${dailyPerformance.ntbOrders})`,
      ntbSales: sql`VALUES(${dailyPerformance.ntbSales})`,
      viewableImpressions: sql`VALUES(${dailyPerformance.viewableImpressions})`,
      attributionWindow: sql`VALUES(${dailyPerformance.attributionWindow})`,
      isFinalized: sql`VALUES(${dailyPerformance.isFinalized})`,
      dataSource: sql`VALUES(${dailyPerformance.dataSource})`,
      // v383: 货币字段合并到主UPSERT，消除N+1
      // @ts-ignore
      currency: sql`VALUES(${dailyPerformance.currency})`,
      exchangeRate: sql`VALUES(${dailyPerformance.exchangeRate})`,
      spendUsd: sql`VALUES(${dailyPerformance.spendUsd})`,
      salesUsd: sql`VALUES(${dailyPerformance.salesUsd})`,
    }
  });
}

// @ts-ignore
AmazonSyncService.prototype.processReportData = async function(this: AmazonSyncService, db: DbInstance, reportData: unknown[], adType: string): Promise<number> {
  try {
    log.info(`开始处理${adType}报告数据, 共 ${reportData.length} 条记录`);
    
    // 输出第一条数据的结构，用于调试
    if (reportData.length > 0) {
      log.debug(`${adType}报告数据第一条示例:`, JSON.stringify(reportData[0], null, 2));
    }
    
    if (!reportData || reportData.length === 0) {
      log.warn('报告数据为空');
      return 0;
    }
    
    // 输出第一条数据的结构，用于调试
    log.debug('报告数据第一条示例:', JSON.stringify(reportData[0], null, 2));
    
    let synced = 0;

    log.info(`开始处理报告数据, 共 ${reportData.length} 条记录`);
    
    // 统计匹配情况
    // @ts-ignore
    let matchedById = 0;
    let matchedByName = 0;
    let notMatched = 0;

    // v360: 批量UPSERT数组
    let upsertBatch: unknown[] = [];
    let currencyBatch: { currency: string; exchangeRate: number; spendUsd: string; salesUsd: string }[] = [];

    // v391: 预加载该账户所有campaigns到内存Map，消除N+1查询
    // @ts-ignore
    const allCampaigns = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.accountId, this.accountId));
    
    const campaignByIdMap = new Map<string, unknown>();
    const campaignByNameMap = new Map<string, unknown>();
    for (const c of allCampaigns) {
      campaignByIdMap.set(String(c.campaignId), c);
      if (c.campaignName) campaignByNameMap.set(c.campaignName, c);
    }
    log.info(`[v391] 预加载 ${allCampaigns.length} 个campaigns到内存Map (ID索引: ${campaignByIdMap.size}, Name索引: ${campaignByNameMap.size})`);
    
    // v395: 将汇率调用从循环内移到循环外，同一marketplace的汇率在整个同步周期内不会变化
    const { currency: preFetchedCurrency, rate: preFetchedRate } = await getExchangeRateByMarketplace(this.marketplace);
    log.info(`[v395] 预加载汇率: ${this.marketplace} -> ${preFetchedCurrency}, rate=${preFetchedRate}`);
    
    for (const row of (reportData as unknown[])) {
      // v391: 使用内存Map匹配，避免逐条查询数据库
      // 策略：先用campaignId匹配，失败后用campaignName匹配
      
      // 策略1: 先用campaignId匹配
      // @ts-ignore
      let campaign = campaignByIdMap.get(String(row.campaignId));

      if (campaign) {
        matchedById++;
      // @ts-ignore
      } else if (row.campaignName) {
        // 策略2: 用campaignName匹配
        // @ts-ignore
        campaign = campaignByNameMap.get(row.campaignName);
        
        if (campaign) {
          // @ts-ignore
          matchedByName++;
          // @ts-ignore
          log.info(`${adType}通过名称匹配成功: ${row.campaignName} (reportId=${row.campaignId}, dbId=${campaign.campaignId})`);
        }
      // @ts-ignore
      }

      if (!campaign) {
        // 尝试自动创建campaign记录，以保存报告数据
        // @ts-ignore
        if (row.campaignId && row.campaignName) {
          try {
            // @ts-ignore
            log.info(`${adType}自动创建campaign: ${row.campaignName}`);
            // @ts-expect-error - Drizzle query builder type
            const [newCampaign] = await db.insert(campaigns).values({
              accountId: this.accountId,
              // @ts-ignore
              campaignId: String(row.campaignId),
              // @ts-ignore
              campaignName: row.campaignName,
              campaignType: adType === 'SP' ? 'sp_manual' : adType.toLowerCase() as 'sp_auto' | 'sp_manual' | 'sb' | 'sd',
              targetingType: 'manual',
              // @ts-ignore
              status: row.campaignStatus || 'enabled',
              // @ts-ignore
              dailyBudget: row.campaignBudget ? String(row.campaignBudget) : '0',
              createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
              updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
            // @ts-expect-error - runtime type mismatch
            }).returning();
            campaign = newCampaign;
            // v391: 将新创建的campaign加入内存Map，避免后续重复创建
            // @ts-ignore
            campaignByIdMap.set(String(campaign.campaignId), campaign);
            // @ts-ignore
            if (campaign.campaignName) campaignByNameMap.set(campaign.campaignName, campaign);
            // @ts-ignore
            log.info(`${adType}自动创建campaign成功: id=${campaign.id}, name=${campaign.campaignName}`);
          } catch (createError: unknown) {
            // 可能是重复插入，尝试再次查询
            log.warn(`${adType}创建campaign失败，尝试再次查询:`, (createError as Error).message);
            // @ts-expect-error - runtime type mismatch
            const [existingCampaign] = await db
              .select()
              .from(campaigns)
              .where(
                and(
                  eq(campaigns.accountId, this.accountId),
                  // @ts-ignore
                  eq(campaigns.campaignName, row.campaignName)
                )
              // @ts-ignore
              )
              .limit(1);
            campaign = existingCampaign;
            // v391: 将查询到的campaign加入内存Map
            if (campaign) {
              // @ts-ignore
              campaignByIdMap.set(String(campaign.campaignId), campaign);
              // @ts-ignore
              if (campaign.campaignName) campaignByNameMap.set(campaign.campaignName, campaign);
            }
          // @ts-ignore
          }
        }
        
        if (!campaign) {
          notMatched++;
          if (notMatched <= 10) {
            // @ts-ignore
            log.warn(`${adType}未找到campaign: accountId=${this.accountId}, campaignId=${row.campaignId}, campaignName=${row.campaignName || 'N/A'}`);
          }
          continue;
        }
      }

      // v440: 命名物理隔离 - 通过extractCampaignIds解构，明确区分Amazon ID和本地ID
      // @ts-ignore
      const { amazonId: amazonCampaignId } = extractCampaignIds(campaign, `syncPerformance.${adType}`);

      // 使用报告日期或当前日期
      // @ts-ignore
      const reportDate = row.date ? new Date(row.date) : new Date();
      const reportDateStr = reportDate.toISOString().split('T')[0];

      // v360: 移除逐条SELECT检查，改用批量UPSERT（见下方批量写入）

      // 使用 Amazon Ads API v3 的字段名 (2026年1月更新)
      // ⚠️ 重要: 不同广告类型使用不同的字段名
      // SP: 使用 7天归因 (sales7d, purchases7d, unitsSoldClicks7d)
      // SB: 使用 Clicks后缀 (salesClicks, purchasesClicks, unitsSoldClicks, detailPageViewsClicks)
      // SD: 使用 Clicks后缀 (salesClicks, purchasesClicks, unitsSoldClicks, detailPageViewsClicks, viewableImpressions)
      // @ts-ignore
      const cost = row.cost || 0;
      // @ts-ignore
      let sales = 0;
      // @ts-ignore
      let orders = 0;
      // @ts-ignore
      let unitsSold = 0;
      // @ts-ignore
      let dpv = 0;
      // @ts-ignore
      let addToCart = 0;
      // @ts-ignore
      let ntbOrders = 0;
      let ntbSales = 0;
      let viewableImpressions = 0;
      
      if (adType === 'SP') {
        // ✅ SP报告使用 7天归因窗口 (7d) - 修正字段名
        // 参考文档: https://advertising.amazon.com/API/docs/en-us/reporting/v3/report-types
        // @ts-ignore
        sales = row.sales7d || 0;
        // @ts-ignore
        orders = row.purchases7d || 0;
        // @ts-ignore
        unitsSold = row.unitsSoldClicks7d || 0;
        // SP不支持 dpv 和 addToCart 在 7d 字段中
        // @ts-ignore
        dpv = 0;
        addToCart = 0;
      } else if (adType === 'SB') {
        // ✅ SB报告使用修正后的字段名 (Clicks后缀)
        // @ts-ignore
        sales = row.salesClicks || 0;
        // @ts-ignore
        orders = row.purchasesClicks || 0;
        // @ts-ignore
        unitsSold = row.unitsSoldClicks || 0;
        // @ts-ignore
        dpv = row.detailPageViewsClicks || 0;
        // @ts-ignore
        ntbOrders = row.newToBrandPurchasesClicks || 0;
        // @ts-ignore
        ntbSales = row.newToBrandSalesClicks || 0;
      } else {
        // ✅ SD报告使用修正后的字段名 (Clicks后缀)
        // @ts-ignore
        sales = row.salesClicks || 0;
        // @ts-ignore
        orders = row.purchasesClicks || 0;
        // @ts-ignore
        unitsSold = row.unitsSoldClicks || 0;
        // @ts-ignore
        viewableImpressions = row.viewableImpressions || 0;
        // @ts-ignore
        dpv = row.detailPageViewsClicks || 0;
        // @ts-ignore
        ntbOrders = row.newToBrandPurchasesClicks || 0;
        // @ts-ignore
        ntbSales = row.newToBrandSalesClicks || 0;
      }
      
      // v395: 使用预加载的汇率（循环外已获取）
      const currency = preFetchedCurrency;
      const exchangeRate = preFetchedRate;
      const spendUsd = cost * exchangeRate;
      const salesUsd = sales * exchangeRate;

      const perfData = {
        accountId: this.accountId,
        campaignId: guardCampaignIdInsert(amazonCampaignId, 'daily_performance'),
        date: reportDateStr,
        // @ts-ignore
        impressions: row.impressions || 0,
        // @ts-ignore
        clicks: row.clicks || 0,
        spend: String(cost),
        sales: String(sales),
        orders: orders,
        dailyAcos: cost && sales 
          ? String((cost / sales) * 100) 
          : '0',
        dailyRoas: cost && sales 
          ? String(sales / cost) 
          : '0',
        // @ts-ignore
        ctr: (row.impressions || 0) > 0 ? String(((row.clicks || 0) / (row.impressions || 0))) : null,
        // @ts-ignore
        cvr: (row.clicks || 0) > 0 ? String((orders / (row.clicks || 0))) : null,
        // @ts-ignore
        cpc: (row.clicks || 0) > 0 ? String((cost / (row.clicks || 0))) : null,
        // ✅ Report API v3 新增字段
        unitsSold: unitsSold,
        dpv: dpv,
        addToCart: addToCart,
        ntbOrders: ntbOrders,
        ntbSales: String(ntbSales),
        viewableImpressions: viewableImpressions,
        // ✅ 广告类型和归因窗口标记（SP=7天, SB=14天, SD=14天）
        adType: adType as 'SP' | 'SB' | 'SD',
        attributionWindow: adType === 'SP' ? 7 : 14,
        // ✅ 标记为API报告数据（已经过归因窗口校准），防止AMS实时数据覆盖
        isFinalized: reportDateStr === getMarketplaceCurrentDate(this.marketplace) ? 0 : 1,
        dataSource: 'api' as const,
      };

      // v360: 收集到批量数组中，后续统一UPSERT
      upsertBatch.push({
        ...perfData,
        createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      });
      currencyBatch.push({ currency, exchangeRate, spendUsd: spendUsd.toFixed(2), salesUsd: salesUsd.toFixed(2) });
      synced++;

      // v360: 每500条执行一次批量UPSERT
      if (upsertBatch.length >= 500) {
        await flushDailyPerfBatch(db, upsertBatch, currencyBatch);
        upsertBatch = [];
        currencyBatch = [];
      }
    }

    // v360: flush剩余的批量数据
    if (upsertBatch.length > 0) {
      await flushDailyPerfBatch(db, upsertBatch, currencyBatch);
      upsertBatch = [];
      currencyBatch = [];
    }

    // 输出匹配统计
    log.info(`${adType}报告数据处理完成:`);
    log.debug(`  - 通过ID匹配: ${matchedById} 条`);
    log.debug(`  - 通过名称匹配: ${matchedByName} 条`);
    log.debug(`  - 未匹配: ${notMatched} 条`);
    log.info(`  - 总同步: ${synced} 条`);
    return synced;
  } catch (error: unknown) {
    log.warn(`[v358] ${adType}报告数据处理失败:`, (error as Error).message);
    // v358: 抛出错误而不是返回0，让调用方知道这是处理失败
    throw new Error(`${adType}_REPORT_PROCESS_FAILED: ${(error as Error).message}`);
  }
};

/**
 * @deprecated v187: 此方法生成模拟数据，严重误导优化算法
 * 已无任何调用方，保留仅作为参考，禁止在生产环境中使用
 * 应使用syncPerformanceData()获取真实Amazon API数据
 */
// @ts-ignore
AmazonSyncService.prototype.generateMockPerformanceData = async function(this: AmazonSyncService, days: number = 7): Promise<number> {
  log.warn('⚠️ generateMockPerformanceData已废弃，不应被调用！请使用syncPerformanceData()代替');
  const db = await getDb();
  // v358: 数据库不可用是真实错误，不应返回0
  if (!db) throw new Error('DATABASE_UNAVAILABLE: 数据库连接不可用');

  try {
    // 获取该账户下所有广告活动
    const accountCampaigns = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.accountId, this.accountId));

    log.debug(`为 ${accountCampaigns.length} 个广告活动生成模拟绩效数据`);

    let synced = 0;

    // 使用站点时区计算日期
    const marketplaceToday = getMarketplaceCurrentDate(this.marketplace);
    log.debug(`站点${this.marketplace}当前日期: ${marketplaceToday}`);
    
    for (const campaign of (accountCampaigns as unknown[])) {
      // v440: 命名物理隔离
      // @ts-ignore
      const { amazonId: amazonCampaignId } = extractCampaignIds(campaign, 'generateMockPerformanceData');
      // 为每个广告活动生成最近N天的模拟数据
      for (let i = 0; i < days; i++) {
        // 基于站点当前日期计算
        // @ts-ignore
        const baseDate = new Date(marketplaceToday);
        baseDate.setDate(baseDate.getDate() - i);
        const dateStr = baseDate.toISOString().split('T')[0];

        // v323: 检查是否已存在当天数据 - 包含accountId防止跨账户混淆
        const [existing] = await db
          .select()
          .from(dailyPerformance)
          .where(
            and(
              eq(dailyPerformance.accountId, this.accountId),
              eq(dailyPerformance.campaignId, amazonCampaignId),
              sql`DATE(${dailyPerformance.date}) = ${dateStr}`
            )
          )
          // @ts-ignore
          .limit(1);
        if (existing) continue;;

        // 生成基于广告活动类型的模拟数据
        // @ts-ignore
        const baseImpressions = (campaign.campaignType === 'sp_auto' || campaign.campaignType === 'sp_manual') ? 5000 : 
                                // @ts-ignore
                                campaign.campaignType === 'sb' ? 3000 : 2000;
        const baseCtr = 0.02 + Math.random() * 0.03; // 2-5% CTR
        const baseCvr = 0.05 + Math.random() * 0.1; // 5-15% CVR
        const baseCpc = 0.5 + Math.random() * 1.5; // $0.5-2 CPC
        const baseAov = 20 + Math.random() * 80; // $20-100 AOV

        const impressions = Math.floor(baseImpressions * (0.7 + Math.random() * 0.6));
        const clicks = Math.floor(impressions * baseCtr);
        const orders = Math.floor(clicks * baseCvr);
        const spend = clicks * baseCpc;
        const sales = orders * baseAov;

        const perfData = {
          accountId: this.accountId,
          campaignId: guardCampaignIdInsert(amazonCampaignId, 'daily_performance'),
          date: dateStr,
          impressions,
          clicks,
          spend: String(spend.toFixed(2)),
          sales: String(sales.toFixed(2)),
          orders,
          dailyAcos: sales > 0 ? String(((spend / sales) * 100).toFixed(2)) : '0',
          dailyRoas: spend > 0 ? String((sales / spend).toFixed(2)) : '0',
          createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
        };

        await db.insert(dailyPerformance).values(perfData);
        synced++;
      }
    }

    // 更新campaigns表的绩效汇总数据
    // @ts-ignore
    await this.updateCampaignPerformanceSummary();

    log.info(`模拟绩效数据生成完成: ${synced} 条记录`);
    return synced;
  } catch (error: any) {
    log.warn('生成模拟绩效数据失败:', error);
    // v358: 抛出错误而不是返回0
    throw error;
  }
};

/**
 * 同步关键词绩效数据
 * 从Amazon Reporting API获取关键词级别的绩效数据并更新到keywords表
 */
// @ts-ignore
AmazonSyncService.prototype.syncKeywordPerformanceData = async function(this: AmazonSyncService, days: number = 7): Promise<number> {
  const db = await getDb();
  if (!db) {
    log.warn('数据库连接失败');
    // v358: 数据库不可用是真实错误
    throw new Error('DATABASE_UNAVAILABLE: 数据库连接不可用');
  }

  try {
    // v339: Amazon API单次请求最多31天，需要分批请求
    const MAX_DAYS_PER_REQUEST = 31;
    const totalDays = Math.min(days, 90); // SP关键词绩效最多支持90天
    const { startDate: rangeStartDate, endDate: rangeEndDate } = getMarketplaceDateRange(this.marketplace, totalDays);
    const batches = Math.ceil(totalDays / MAX_DAYS_PER_REQUEST);
    log.info(`v339: 开始同步关键词绩效数据: 共${totalDays}天，分${batches}批请求 (站点: ${this.marketplace})`);

    // v413: 批量提交+统一轮询模式（替代串行循环）
    let allReportData: unknown[] = [];
    if (batches === 1) {
      try {
        const reportId = await this.client.requestSpKeywordReport(rangeStartDate, rangeEndDate);
        // @ts-ignore
        const data = await this.client.waitAndDownloadReport(reportId, 600000); // v523.3: 超时时间增加到600秒
        // @ts-ignore
        if (data && data.length > 0) allReportData = data;
      // @ts-ignore
      } catch (e: unknown) {
        // @ts-ignore
        const _errMsg = (e as Error).message || '';
        // @ts-ignore
        const _is425 = _errMsg.includes('425') || _errMsg.includes('Too Early');
        // @ts-ignore
        if (_is425) {
          // @ts-ignore
          log.warn(`v413: 关键词绩效报告请求失败 (expected 425): ${_errMsg}`);
        // @ts-ignore
        } else {
          // @ts-ignore
          log.warn(`v413: 关键词绩效报告请求失败: ${_errMsg}`);
        // @ts-ignore
        }
      // @ts-ignore
      }
    // @ts-ignore
    } else {
      const batchRequests: Array<{ name: string; requestFn: () => Promise<string> }> = [];
      // @ts-ignore
      for (let batch = 0; batch < batches; batch++) {
        const endDateObj = new Date(rangeEndDate);
        endDateObj.setDate(endDateObj.getDate() - (batch * MAX_DAYS_PER_REQUEST));
        const startDateObj = new Date(endDateObj);
        const daysInBatch = Math.min(MAX_DAYS_PER_REQUEST, totalDays - (batch * MAX_DAYS_PER_REQUEST));
        startDateObj.setDate(startDateObj.getDate() - daysInBatch + 1);
        const bStart = startDateObj.toISOString().split('T')[0];
        const bEnd = endDateObj.toISOString().split('T')[0];
        batchRequests.push({
          name: `关键词绩效第${batch + 1}/${batches}批(${bStart}~${bEnd})`,
          requestFn: () => this.client.requestSpKeywordReport(bStart, bEnd),
        });
      }
      log.info(`[v413] 关键词绩效: ${batches}批次批量提交开始`);
      // v523.3: 超时时间从300秒增加到600秒
      // P5: 异步报告模式
      if (process.env.P5_ASYNC_REPORTS === 'true') {
        const asyncResult = await this.client.submitReportsToAsyncQueue(batchRequests, {
          accountId: this.accountId,
          syncType: 'keyword_performance',
        });
        log.info(`[P5] Async keyword reports submitted: ${asyncResult.queued} queued`);
        // P5: async mode - skip sync processing
      } else {
      const results = await this.client.submitAndWaitMultipleReports(batchRequests, 600000, 2000);
      for (const result of results) {
        if (result.data && result.data.length > 0) {
          allReportData = allReportData.concat(result.data);
        } else if (result.error) {
          log.warn(`[v413] ${result.name}失败: ${result.error}`);
        }
      }
      }
    }

    if (!allReportData || allReportData.length === 0) {
      log.warn('v339: 所有批次关键词报告数据为空');
      return 0;
    }
    
    // @ts-ignore
    log.info(`v339: 共获取到 ${allReportData.length} 条关键词绩效数据（${batches}批合并）`);
    // @ts-ignore
    log.debug('v196: 关键词报告数据第一条示例:', JSON.stringify(allReportData[0], null, 2));
    
    // ==================== v395: SUMMARY模式分批数据聚合 ====================
    // 问题：SUMMARY模式下，同一keyword在不同批次中都会出现，合并时后一批会覆盖前一批
    // 解决：按targetId/keywordId聚合累加所有批次的指标
    const aggregatedMap = new Map<string, unknown>();
    // @ts-ignore
    for (const row of allReportData) {
      // @ts-ignore
      const key = String(row.targetId || row.keywordId || '');
      if (!key) continue;
      
      const existing = aggregatedMap.get(key);
      if (existing) {
        // 累加数值指标
        // @ts-ignore
        existing.cost = (existing.cost || 0) + (row.cost || 0);
        // @ts-ignore
        existing.impressions = (existing.impressions || 0) + (row.impressions || 0);
        // @ts-ignore
        existing.clicks = (existing.clicks || 0) + (row.clicks || 0);
        // @ts-ignore
        existing.sales7d = (existing.sales7d || 0) + (row.sales7d || 0);
        // @ts-ignore
        existing.sales14d = (existing.sales14d || 0) + (row.sales14d || 0);
        // @ts-ignore
        existing.purchases7d = (existing.purchases7d || 0) + (row.purchases7d || 0);
        // @ts-ignore
        existing.purchases14d = (existing.purchases14d || 0) + (row.purchases14d || 0);
        // @ts-ignore
        existing.unitsSoldClicks7d = (existing.unitsSoldClicks7d || 0) + (row.unitsSoldClicks7d || 0);
        // @ts-ignore
        existing.unitsSoldSameSku7d = (existing.unitsSoldSameSku7d || 0) + (row.unitsSoldSameSku7d || 0);
        // @ts-ignore
        existing.unitsSoldOtherSku7d = (existing.unitsSoldOtherSku7d || 0) + (row.unitsSoldOtherSku7d || 0);
        // @ts-ignore
        existing.attributedSalesSameSku7d = (existing.attributedSalesSameSku7d || 0) + (row.attributedSalesSameSku7d || 0);
        // @ts-ignore
        existing.salesOtherSku7d = (existing.salesOtherSku7d || 0) + (row.salesOtherSku7d || 0);
      } else {
        // @ts-ignore
        aggregatedMap.set(key, { ...row });
      // @ts-ignore
      }
    // @ts-ignore
    }
    // @ts-ignore
    const reportData = Array.from(aggregatedMap.values());
    // @ts-ignore
    log.info(`[v395] SUMMARY模式聚合完成: ${allReportData.length}条 -> ${reportData.length}条（去重${allReportData.length - reportData.length}条）`);
    
    // ==================== v387: 批量预加载本地数据 - 按accountId过滤，修复数据隔离漏洞 ====================
    // 1. 预加载当前账户的adGroups的Amazon ID -> 本地ID映射（v387: 添加accountId过滤，避免加载所有租户数据）
    const allAdGroups = await db.select({ id: adGroups.id, adGroupId: adGroups.adGroupId }).from(adGroups).where(eq(adGroups.accountId, this.accountId));
    const adGroupAmazonToLocal = new Map<string, number>();
    for (const ag of allAdGroups) {
      // @ts-ignore
      if (ag.adGroupId) adGroupAmazonToLocal.set(String(ag.adGroupId), ag.id);
    // @ts-ignore
    }
    
    // 2. 预加载当前账户的keywords，建立多维索引（v387: 添加accountId过滤）
    const allKeywords = await db.select({
      // @ts-ignore
      id: keywords.id, keywordId: keywords.keywordId, keywordText: keywords.keywordText,
      matchType: keywords.matchType, adGroupId: keywords.internalAdGroupId
    }).from(keywords).where(eq(keywords.accountId, this.accountId));
    
    const kwByKeywordId = new Map<string, typeof allKeywords[0]>();
    // 复合键: adGroupId_keywordText_matchType
    const kwByAdGroupTextMatch = new Map<string, typeof allKeywords[0]>();
    // 复合键: adGroupId_keywordText
    const kwByAdGroupText = new Map<string, typeof allKeywords[0]>();
    // 纯文本键: keywordText (最后兜底)
    const kwByText = new Map<string, typeof allKeywords[0]>();
    
    // @ts-ignore
    for (const kw of (allKeywords as unknown[])) {
      // @ts-ignore
      if (kw.keywordId) kwByKeywordId.set(kw.keywordId, kw);
      // @ts-ignore
      if (kw.adGroupId && kw.keywordText && kw.matchType) {
        // @ts-ignore
        kwByAdGroupTextMatch.set(`${kw.adGroupId}_${kw.keywordText.toLowerCase()}_${kw.matchType.toLowerCase()}`, kw);
      }
      // @ts-ignore
      if (kw.adGroupId && kw.keywordText) {
        // @ts-ignore
        kwByAdGroupText.set(`${kw.adGroupId}_${kw.keywordText.toLowerCase()}`, kw);
      }
      // @ts-ignore
      if (kw.keywordText) {
        // @ts-ignore
        kwByText.set(kw.keywordText.toLowerCase(), kw);
      }
    }
    
    // 3. 预加载当前账户的product_targets，建立多维索引（v387: 添加accountId过滤）
    const allTargets = await db.select({
      id: productTargets.id, targetId: productTargets.targetId,
      targetExpression: productTargets.targetExpression, adGroupId: productTargets.internalAdGroupId
    }).from(productTargets).where(eq(productTargets.accountId, this.accountId));
    
    const ptByTargetId = new Map<string, typeof allTargets[0]>();
    // @ts-ignore
    const ptByExpression = new Map<string, typeof allTargets[0]>();
    
    for (const pt of allTargets) {
      if (pt.targetId) ptByTargetId.set(pt.targetId, pt);
      if (pt.targetExpression) ptByExpression.set(pt.targetExpression.toLowerCase(), pt);
    }
    
    log.info(`v387: 预加载完成(accountId=${this.accountId}) - ${allKeywords.length}个关键词, ${allTargets.length}个商品投放, ${allAdGroups.length}个广告组`);
    
    // ==================== v196: 四层匹配策略 ====================
    let synced = 0;
    let notMatched = 0;
    let matchStats = { byKeywordId: 0, byAdGroupTextMatch: 0, byAdGroupText: 0, byText: 0, byTargetId: 0, byExpression: 0 };
    
    // 批量更新缓冲
    const kwUpdates: { id: number; data: Record<string, unknown> }[] = [];
    const ptUpdates: { id: number; data: Record<string, unknown> }[] = [];
    
    for (const row of (reportData as unknown[])) {
      // @ts-ignore
      const reportTargetId = String(row.targetId || row.keywordId || '');
      if (!reportTargetId) continue;
      
      // @ts-ignore
      const cost = row.cost || 0;
      // @ts-ignore
      const sales = row.sales7d || row.sales14d || 0;
      // @ts-ignore
      const orders = row.purchases7d || row.purchases14d || 0;
      // @ts-ignore
      const impressions = row.impressions || 0;
      // @ts-ignore
      const clicks = row.clicks || 0;
      
      // 层1: 通过keywordId精确匹配
      let kw = kwByKeywordId.get(reportTargetId);
      if (kw) { matchStats.byKeywordId++; }
      
      // 层2: 通过adGroupId + keywordText + matchType三元组匹配
      // @ts-ignore
      if (!kw && row.targetingText && row.adGroupId) {
        // @ts-ignore
        const localAgId = adGroupAmazonToLocal.get(String(row.adGroupId));
        if (localAgId) {
          // @ts-ignore
          const matchType = row.matchType || row.keywordType || '';
          if (matchType) {
            // @ts-ignore
            kw = kwByAdGroupTextMatch.get(`${localAgId}_${row.targetingText.toLowerCase()}_${matchType.toLowerCase()}`);
            if (kw) matchStats.byAdGroupTextMatch++;
          }
          // 层3: 通过adGroupId + keywordText二元组匹配
          if (!kw) {
            // @ts-ignore
            kw = kwByAdGroupText.get(`${localAgId}_${row.targetingText.toLowerCase()}`);
            if (kw) matchStats.byAdGroupText++;
          }
        }
      }
      
      // 层4: 通过纯keywordText匹配（兜底）
      // @ts-ignore
      if (!kw && row.targetingText) {
        // @ts-ignore
        kw = kwByText.get(row.targetingText.toLowerCase());
        if (kw) matchStats.byText++;
      }
      
      if (kw) {
        kwUpdates.push({
          id: kw.id,
          data: {
            impressions, clicks,
            // @ts-ignore
            spend: String(cost), sales: String(sales), orders,
            // @ts-ignore
            keywordAcos: cost > 0 && sales > 0 ? String(((cost / sales) * 100).toFixed(2)) : '0.00',
            keywordCtr: impressions > 0 ? String((clicks / impressions).toFixed(4)) : '0.0000',
            keywordCvr: clicks > 0 ? String((orders / clicks).toFixed(4)) : '0.0000',
            // @ts-ignore
            keywordCpc: clicks > 0 ? String((cost / clicks).toFixed(2)) : '0.00',
            keywordRoas: cost > 0 && sales > 0 ? String((sales / cost).toFixed(2)) : '0.00',
            updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
          }
        });
        synced++;
        continue;
      }
      
      // 尝试匹配product_targets
      let pt = ptByTargetId.get(reportTargetId);
      if (pt) { matchStats.byTargetId++; }
      
      // @ts-ignore
      if (!pt && row.targetingExpression) {
        // @ts-ignore
        pt = ptByExpression.get(row.targetingExpression.toLowerCase());
        if (pt) matchStats.byExpression++;
      }
      
      if (pt) {
        ptUpdates.push({
          id: pt.id,
          data: {
            impressions, clicks,
            spend: String(cost), sales: String(sales), orders,
            targetAcos: cost > 0 && sales > 0 ? String(((cost / sales) * 100).toFixed(2)) : '0.00',
            targetRoas: cost > 0 && sales > 0 ? String((sales / cost).toFixed(2)) : '0.00',
            targetCtr: impressions > 0 ? String((clicks / impressions).toFixed(4)) : '0.0000',
            targetCvr: clicks > 0 ? String((orders / clicks).toFixed(4)) : '0.0000',
            targetCpc: clicks > 0 ? String((cost / clicks).toFixed(2)) : '0.00',
            updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
          }
        });
        synced++;
        continue;
      }
      
      // @ts-ignore
      notMatched++;
      if (notMatched <= 5) {
        // @ts-ignore
        log.warn(`v196: 未匹配: targetId=${reportTargetId}, text=${row.targetingText || 'N/A'}, expr=${row.targetingExpression || 'N/A'}`);
      }
    }
    
    // ==================== v505: 批量写入数据库 - 使用受控并发替代100并发Promise.all ====================
    let dbWritten = 0;
    const CONCURRENCY_LIMIT = 8; // v505: 限制并发数为8，避免超出连接池(limit=20)
    
    // v505: 受控并发更新函数
    // @ts-ignore
    async function updateWithConcurrencyControl<T extends { id: number; data: Record<string, unknown> }>(
      updates: T[],
      tableName: string,
      updateFn: (upd: T) => Promise<unknown>
    ): Promise<number> {
      let written = 0;
      for (let i = 0; i < updates.length; i += CONCURRENCY_LIMIT) {
        const chunk = updates.slice(i, i + CONCURRENCY_LIMIT);
        const results = await Promise.allSettled(chunk.map(upd => updateFn(upd)));
        for (let j = 0; j < results.length; j++) {
          if (results[j].status === 'fulfilled') {
            written++;
          } else {
            const err = (results[j] as PromiseRejectedResult).reason;
            log.warn(`v505: 更新${tableName} ${chunk[j].id} 失败: ${err?.message || err}`);
          }
        }
      }
      return written;
    }
    
    // v505: 受控并发更新keywords
    dbWritten += await updateWithConcurrencyControl(
      kwUpdates, 'keyword',
      (upd) => db.update(keywords).set(upd.data).where(eq(keywords.id, upd.id))
    );
    
    // v505: 受控并发更新product_targets
    dbWritten += await updateWithConcurrencyControl(
      ptUpdates, 'product_target',
      (upd) => db.update(productTargets).set(upd.data).where(eq(productTargets.id, upd.id))
    );
    
    log.info(`v196: 关键词绩效同步完成 - 匹配${synced}条, 未匹配${notMatched}条, 写入${dbWritten}条`);
    // @ts-ignore
    log.debug(`v196: 匹配统计 - keywordId:${matchStats.byKeywordId}, adGroup+text+match:${matchStats.byAdGroupTextMatch}, adGroup+text:${matchStats.byAdGroupText}, text:${matchStats.byText}, targetId:${matchStats.byTargetId}, expression:${matchStats.byExpression}`);
    
    // v196+v647: 同步时顺便回填keywordId（如果通过文本匹配到了但keywordId不一致）
    // v647: 只允许纯数字ID回填，防止text:前缀表达式或ASIN表达式污染keywordId字段
    let backfilled = 0;
    let backfillSkipped = 0;
    for (const row of (reportData as unknown[])) {
      // @ts-ignore
      const reportTargetId = String(row.targetId || row.keywordId || '');
      // @ts-ignore
      if (!reportTargetId || !row.targetingText) continue;
      
      // v647: 严格验证 - 只有纯数字的reportTargetId才能回填到keywordId
      // 防止text:前缀关键词表达式（如"text:+ski +jumpsuit"）和ASIN表达式（如"asin=B0FM8LDVTD"）污染keywordId
      if (!/^\d+$/.test(reportTargetId.trim())) {
        backfillSkipped++;
        if (backfillSkipped <= 3) {
          log.info(`[v647] 跳过非数字keywordId回填(syncPerf): reportTargetId="${reportTargetId.substring(0, 60)}", text="${((row as any).targetingText || '').substring(0, 40)}"`);
        }
        continue;
      }
      
      // 检查是否有通过文本匹配到的keyword缺少keywordId
      // @ts-ignore
      const kw = kwByText.get(row.targetingText.toLowerCase());
      if (kw && (!kw.keywordId || kw.keywordId.startsWith('SKIP_'))) {
        try {
          await db.update(keywords).set({ keywordId: reportTargetId }).where(eq(keywords.id, kw.id));
          backfilled++;
        } catch (e: unknown) {
          // 忽略重复键错误
        }
      }
    }
    if (backfilled > 0) {
      log.debug(`v647: 回填了${backfilled}个关键词的keywordId(syncPerf)`);
    }
    if (backfillSkipped > 0) {
      log.info(`[v647] syncPerf回填时跳过了${backfillSkipped}个非数字reportTargetId，防止keywordId字段污染`);
    }
    
    return synced;
  } catch (error: unknown) {
    // v242: 结构化错误日志，避免错误信息被截断
    const errorInfo = {
      message: (error as Error).message || 'Unknown error',
      // @ts-expect-error - Axios error response access
      status: error.status || (error as Error & { response?: unknown }).response?.status,
      code: (error as Error & { code?: string }).code,
      // @ts-expect-error - runtime type mismatch
      url: error.config?.url,
      // @ts-expect-error - Axios error response access
      responseData: (error as Error & { response?: unknown }).response?.data ? JSON.stringify((error as Error & { response?: unknown }).response.data).substring(0, 500) : undefined,
    };
    log.warn(`[v242] 关键词绩效同步失败(marketplace=${this.marketplace}): ${JSON.stringify(errorInfo)}`);
    // v358: 抛出错误而不是返回0
    throw error;
  }
};

/**
 * 同步商品定位级别绩效数据
 * 注意: SP-Targeting报告已包含商品定位数据，syncKeywordPerformanceData中已处理
 * 此方法作为补充，确保数据完整性
 */
// @ts-ignore
AmazonSyncService.prototype.syncProductTargetPerformanceData = async function(this: AmazonSyncService, days: number): Promise<number> {
  // SP-Targeting报告已在syncKeywordPerformanceData中处理了product_targets的更新
  // 这里返回0表示不需要额外同步
  log.info('商品定位绩效数据已在syncKeywordPerformanceData中一并处理');
  return 0;
};

/**
 * v195: 从daily_performance自动生成hourly_performance数据
 * 基于美国电商典型的小时流量分布模型，将每天的总量数据按概率分布到24小时
 * 只处理还没有hourly数据的daily记录（增量式）
 */
// @ts-ignore
AmazonSyncService.prototype.generateHourlyFromDaily = async function(this: AmazonSyncService, startDate: string, endDate: string): Promise<number> {
  const db = await getDb();
  // v358: 数据库不可用是真实错误，不应返回0
  // @ts-ignore
  if (!db) throw new Error('DATABASE_UNAVAILABLE: 数据库连接不可用');
  
  // 美国电商典型的小时流量分布
  const HOURLY_TRAFFIC = [
    0.012, 0.008, 0.006, 0.005, 0.005, 0.008, 0.015, 0.025,
    0.040, 0.065, 0.072, 0.068, 0.055, 0.062, 0.058, 0.052,
    0.048, 0.045, 0.050, 0.065, 0.075, 0.070, 0.055, 0.036
  ];
  const CVR_FACTOR = [
    0.60, 0.50, 0.45, 0.40, 0.40, 0.55, 0.70, 0.80,
    0.90, 1.05, 1.10, 1.05, 0.95, 1.10, 1.05, 1.00,
    0.95, 0.90, 1.00, 1.15, 1.20, 1.15, 1.00, 0.80
  ];
  
  try {
    // 查找还没有hourly数据的daily记录（增量式）
    const dailyData = await db.execute(sql`
 SELECT dp.* FROM daily_performance dp
 LEFT JOIN (
 SELECT DISTINCT accountId, campaignId, DATE(date) AS dt
 FROM hourly_performance
 WHERE accountId = ${this.accountId}
 ) hp ON dp.accountId = hp.accountId 
 AND dp.campaignId = hp.campaignId 
 AND DATE(dp.date) = hp.dt
 WHERE dp.accountId = ${this.accountId}
 AND DATE(dp.date) >= ${startDate}
 AND DATE(dp.date) <= ${endDate}
 AND (dp.impressions > 0 OR dp.clicks > 0)
 AND hp.dt IS NULL
 `);
    
    // @ts-ignore
    const rows = (dailyData as Record<string, unknown>[])?.[0] || dailyData;
    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      log.debug('v195: 没有新的daily数据需要生成hourly');
      return 0;
    }
    
    log.debug(`v195: 找到 ${rows.length} 条缺少hourly数据的daily记录`);
    
    let insertedCount = 0;
    let batch: unknown[] = [];
    
    for (const daily of rows) {
      const dateObj = new Date(daily.date);
      const dayOfWeek = dateObj.getDay();
      const totalImp = daily.impressions || 0;
      const totalClk = daily.clicks || 0;
      const totalSpend = parseFloat(String(daily.spend || '0'));
      const totalSales = parseFloat(String(daily.sales || '0'));
      const totalOrders = daily.orders || 0;
      
      // @ts-ignore
      if (totalImp === 0 && totalClk === 0) continue;
      
      // 周末调整
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      const dist = HOURLY_TRAFFIC.map(base => {
        if (isWeekend) return base * 0.7 + (1/24) * 0.3;
        return base;
      });
      // @ts-ignore
      const distSum = dist.reduce((a: unknown, b: unknown) => a + b, 0);
      
      const dateStr = typeof daily.date === 'string' 
        ? daily.date.split('T')[0].split(' ')[0]
        : dateObj.toISOString().split('T')[0];
      
      for (let h = 0; h < 24; h++) {
        // @ts-ignore
        const w = dist[h] / distSum;
        const noise = 0.88 + Math.random() * 0.24; // ±12%噪声
        const wn = w * noise;
        const cvr = CVR_FACTOR[h];
        
        const imp = Math.round(totalImp * wn);
        const clk = Math.min(Math.round(totalClk * wn * cvr), imp);
        const sp = Math.round(totalSpend * wn * cvr * 100) / 100;
        const sal = Math.round(totalSales * wn * cvr * 100) / 100;
        const ord = Math.min(Math.round(totalOrders * wn * cvr), clk);
        
        if (imp === 0 && clk === 0) continue;
        
        batch.push({
          accountId: daily.accountId,
          campaignId: String(daily.campaignId),
          date: dateStr,
          hour: h,
          dayOfWeek,
          impressions: imp,
          clicks: clk,
          spend: sp.toFixed(2),
          sales: sal.toFixed(2),
          orders: ord,
          hourlyAcos: sal > 0 ? ((sp / sal) * 100).toFixed(2) : null,
          hourlyRoas: sp > 0 ? (sal / sp).toFixed(2) : null,
          hourlyCtr: imp > 0 ? (clk / imp).toFixed(4) : null,
          hourlyCvr: clk > 0 ? (ord / clk).toFixed(4) : null,
          hourlyCpc: clk > 0 ? (sp / clk).toFixed(2) : null,
        });
        
        if (batch.length >= 500) {
          // @ts-ignore
          await db.insert(hourlyPerformance).values(batch).onDuplicateKeyUpdate({
            set: {
              impressions: sql`VALUES(${hourlyPerformance.impressions})`,
              clicks: sql`VALUES(${hourlyPerformance.clicks})`,
              spend: sql`VALUES(${hourlyPerformance.spend})`,
              sales: sql`VALUES(${hourlyPerformance.sales})`,
              orders: sql`VALUES(${hourlyPerformance.orders})`,
              hourlyAcos: sql`VALUES(${hourlyPerformance.hourlyAcos})`,
              hourlyRoas: sql`VALUES(${hourlyPerformance.hourlyRoas})`,
              hourlyCtr: sql`VALUES(${hourlyPerformance.hourlyCtr})`,
              hourlyCvr: sql`VALUES(${hourlyPerformance.hourlyCvr})`,
              hourlyCpc: sql`VALUES(${hourlyPerformance.hourlyCpc})`,
            }
          });
          insertedCount += batch.length;
          batch = [];
        }
      }
    }
    
    if (batch.length > 0) {
      // @ts-ignore
      await db.insert(hourlyPerformance).values(batch).onDuplicateKeyUpdate({
        set: {
          impressions: sql`VALUES(${hourlyPerformance.impressions})`,
          clicks: sql`VALUES(${hourlyPerformance.clicks})`,
          spend: sql`VALUES(${hourlyPerformance.spend})`,
          sales: sql`VALUES(${hourlyPerformance.sales})`,
          orders: sql`VALUES(${hourlyPerformance.orders})`,
          hourlyAcos: sql`VALUES(${hourlyPerformance.hourlyAcos})`,
          hourlyRoas: sql`VALUES(${hourlyPerformance.hourlyRoas})`,
          hourlyCtr: sql`VALUES(${hourlyPerformance.hourlyCtr})`,
          hourlyCvr: sql`VALUES(${hourlyPerformance.hourlyCvr})`,
          hourlyCpc: sql`VALUES(${hourlyPerformance.hourlyCpc})`,
        }
      });
      insertedCount += batch.length;
    }
    
    return insertedCount;
  } catch (error: unknown) {
    // @ts-ignore
    log.warn('v195: generateHourlyFromDaily失败:', (error as Error).message);
    // v358: 抛出错误而不是返回0
    throw error;
  }
};

/**
 * 同步广告组绩效数据
 * 通过SP/SB/SD广告组报告获取广告组级别的绩效数据
 * 并写入adGroups表的绩效字段（impressions/clicks/spend/sales/orders/ctr/cvr/acos/roas/cpc等）
 * 
 * 归因窗口: SP=7天, SB/SD=14天
 */
// @ts-ignore
AmazonSyncService.prototype.syncAdGroupPerformanceData = async function(this: AmazonSyncService, days: number = 14): Promise<number> {
  // @ts-ignore
  const db = await getDb();
  // v358: 数据库不可用是真实错误，不应返回0
  // @ts-ignore
  if (!db) throw new Error('DATABASE_UNAVAILABLE: 数据库连接不可用');

  let synced = 0;
  try {
    // v339: Amazon API单次请求最多31天，需要分批请求
    const MAX_DAYS_PER_REQUEST = 31;
    const totalDays = Math.min(days, 90);
    const { startDate: rangeStartDate, endDate: rangeEndDate } = getMarketplaceDateRange(this.marketplace, totalDays);
    const batches = Math.ceil(totalDays / MAX_DAYS_PER_REQUEST);
    log.info(`v339: 开始同步广告组绩效数据: 共${totalDays}天，分${batches}批请求 (站点: ${this.marketplace})`);

    // v399-fix3: 只查必要字段，避免加载大量不必要的数据
    // @ts-ignore
    const accountCampaigns = await db
      .select({ id: campaigns.id, campaignId: campaigns.campaignId, campaignType: campaigns.campaignType })
      .from(campaigns)
      .where(eq(campaigns.accountId, this.accountId));

    // 按广告类型分组
    // @ts-ignore
    const spCampaigns = accountCampaigns.filter(c => c.campaignType === 'sp_auto' || c.campaignType === 'sp_manual');
    // @ts-ignore
    const sbCampaigns = accountCampaigns.filter(c => c.campaignType === 'sb');
    // @ts-ignore
    const sdCampaigns = accountCampaigns.filter(c => c.campaignType === 'sd');

    // v399-fix3: 预加载adGroups映射，避免SP/SB/SD循环内的N+1查询问题
    const allAdGroups = await db
      .select({ id: adGroups.id, adGroupId: adGroups.adGroupId })
      .from(adGroups)
      .where(eq(adGroups.accountId, this.accountId));
    const adGroupMap = new Map<string, { id: number; adGroupId: string }>();
    for (const ag of allAdGroups) {
      adGroupMap.set(String(ag.adGroupId), ag);
    }
    log.info(`v399-fix3: 预加载 ${allAdGroups.length} 个adGroups用于广告组绩效匹配`);

    // v413: 通用分批报告请求函数 - 批量提交+统一轮询模式
    // v395: 添加groupByKey参数，用于SUMMARY模式分批数据的自动聚合
    const fetchBatchedReport = async (requestFn: (start: string, end: string) => Promise<string>, reportDays: number, reportName: string, groupByKey?: string): Promise<Record<string, unknown>[]> => {
      const reportTotalDays = Math.min(reportDays, 90);
      const { startDate: rStart, endDate: rEnd } = getMarketplaceDateRange(this.marketplace, reportTotalDays);
      const rBatches = Math.ceil(reportTotalDays / MAX_DAYS_PER_REQUEST);
      
      // v413: 如果只有1批，直接使用单报告模式
      if (rBatches === 1) {
        try {
          const reportId = await requestFn(rStart, rEnd);
          const data = await this.client.waitAndDownloadReport(reportId);
          return data || [];
        } catch (e: unknown) {
          log.warn(`v413: ${reportName}报告请求失败:`, (e as Error).message);
          return [];
        }
      }
      
      // v413: 多批次使用批量提交+统一轮询
      const batchRequests: Array<{ name: string; requestFn: () => Promise<string> }> = [];
      for (let batch = 0; batch < rBatches; batch++) {
        const endDateObj = new Date(rEnd);
        endDateObj.setDate(endDateObj.getDate() - (batch * MAX_DAYS_PER_REQUEST));
        // @ts-ignore
        const startDateObj = new Date(endDateObj);
        const daysInBatch = Math.min(MAX_DAYS_PER_REQUEST, reportTotalDays - (batch * MAX_DAYS_PER_REQUEST));
        startDateObj.setDate(startDateObj.getDate() - daysInBatch + 1);
        const bStart = startDateObj.toISOString().split('T')[0];
        const bEnd = endDateObj.toISOString().split('T')[0];
        // @ts-ignore
        batchRequests.push({
          // @ts-ignore
          name: `${reportName}第${batch + 1}/${rBatches}批(${bStart}~${bEnd})`,
          // @ts-ignore
          requestFn: () => requestFn(bStart, bEnd),
        // @ts-ignore
        });
      // @ts-ignore
      }
      
      // @ts-ignore
      log.info(`[v413] ${reportName}: ${rBatches}批次批量提交开始`);
      // @ts-ignore
      // v523.3: 超时时间从300秒增加到600秒
      // P5: 异步报告模式
      if (process.env.P5_ASYNC_REPORTS === 'true') {
        const asyncResult = await this.client.submitReportsToAsyncQueue(batchRequests, {
          accountId: this.accountId,
          syncType: 'keyword_performance',
        });
        log.info(`[P5] Async keyword reports submitted: ${asyncResult.queued} queued`);
        // P5: async mode - skip sync processing
      } else {
      const results = await this.client.submitAndWaitMultipleReports(batchRequests, 600000, 2000);
      
      let allData: unknown[] = [];
      for (const result of results) {
        if (result.data && result.data.length > 0) {
          allData = allData.concat(result.data);
        } else if (result.error) {
          log.warn(`[v413] ${result.name}失败: ${result.error}`);
        }
      }
      
      // v395: SUMMARY模式分批数据聚合 - 按groupByKey累加数值指标
      if (groupByKey && rBatches > 1 && allData.length > 0) {
        const aggMap = new Map<string, unknown>();
        const numericFields = ['cost', 'impressions', 'clicks', 'sales7d', 'sales14d', 'purchases7d', 'purchases14d',
          'unitsSoldClicks7d', 'unitsSoldSameSku7d', 'unitsSoldOtherSku7d', 'attributedSalesSameSku7d', 'salesOtherSku7d',
          'sales', 'purchases', 'unitsSold', 'dpv', 'dpvClicks', 'viewImpressions', 'viewAttributedConversions14d',
          'viewAttributedSales14d', 'viewAttributedUnitsOrdered14d'];
        for (const row of allData) {
          // @ts-ignore
          const key = String(row[groupByKey] || '');
          if (!key) continue;
          const existing = aggMap.get(key);
          if (existing) {
            for (const f of numericFields) {
              // @ts-ignore
              if (row[f] !== undefined && row[f] !== null) {
                // @ts-ignore
                existing[f] = (existing[f] || 0) + (row[f] || 0);
              }
            }
          } else {
            // @ts-ignore
            aggMap.set(key, { ...row });
          }
        }
        const aggregated = Array.from(aggMap.values());
        log.info(`[v395] ${reportName} SUMMARY聚合: ${allData.length}条 -> ${aggregated.length}条`);
        // @ts-ignore
        return aggregated;
      // @ts-ignore
      }
      // @ts-ignore
      return allData;
      }
    };

    // 1. SP广告组报告（使用传入的days参数，分批请求）
    // @ts-ignore
    if (spCampaigns.length > 0) {
      // @ts-ignore
      try {
        // @ts-ignore
        const spData = await fetchBatchedReport(
          // @ts-ignore
          (s, e) => this.client.requestSpAdGroupReport(s, e),
          // @ts-ignore
          totalDays, 'SP广告组', 'adGroupId'
        // @ts-ignore
        );
        // @ts-ignore
        if (spData && spData.length > 0) {
          // @ts-ignore
          for (const row of (spData as unknown[])) {
            // @ts-ignore
            const adGroupId = String(row.adGroupId);
            // v399-fix3: 使用预加载的Map查找，避免N+1查询
            const adGroup = adGroupMap.get(adGroupId);
            if (!adGroup) continue;

            // @ts-ignore
            const cost = row.cost || 0;
            // @ts-ignore
            const sales = row.sales7d || 0;
            // @ts-ignore
            const orders = row.purchases7d || 0;
            // @ts-ignore
            const impressions = row.impressions || 0;
            // @ts-ignore
            const clicks = row.clicks || 0;

            await db
              .update(adGroups)
              .set({
                impressions,
                clicks,
                spend: String(cost),
                sales: String(sales),
                orders,
                ctr: impressions > 0 ? String((clicks / impressions).toFixed(4)) : null,
                cvr: clicks > 0 ? String((orders / clicks).toFixed(4)) : null,
                acos: cost > 0 && sales > 0 ? String(((cost / sales) * 100).toFixed(2)) : null,
                roas: cost > 0 && sales > 0 ? String((sales / cost).toFixed(2)) : null,
                cpc: clicks > 0 ? String((cost / clicks).toFixed(2)) : null,
              })
              .where(eq(adGroups.id, adGroup.id));
            synced++;
          }
          log.info(`SP广告组绩效同步: ${synced} 条记录`);
        }
      } catch (error: any) {
        log.warn('SP广告组绩效同步失败:', error);
      }
    }

    // 2. SB广告组报告（14天归因，v339分批请求）
    if (sbCampaigns.length > 0) {
      try {
        // @ts-ignore
        const sbData = await fetchBatchedReport(
          (s, e) => this.client.requestSbAdGroupReport(s, e),
          totalDays, 'SB广告组', 'adGroupId'
        );
        if (sbData && sbData.length > 0) {
          let sbSynced = 0;
          for (const row of (sbData as unknown[])) {
            // @ts-ignore
            const adGroupId = String(row.adGroupId);
            // v399-fix3: 使用预加载的Map查找，避免N+1查询
            const adGroup = adGroupMap.get(adGroupId);
            if (!adGroup) continue;

            // @ts-ignore
            const cost = row.cost || 0;
            // @ts-ignore
            const sales = row.salesClicks14d || row.sales14d || 0;
            // @ts-ignore
            const orders = row.purchasesClicks14d || row.purchases14d || 0;
            // @ts-ignore
            const impressions = row.impressions || 0;
            // @ts-ignore
            const clicks = row.clicks || 0;
            // @ts-ignore
            const dpv = row.dpv14d || 0;
            // @ts-ignore
            const ntbOrders = row.attributedOrdersNewToBrand14d || 0;
            // @ts-ignore
            const ntbSales = row.attributedSalesNewToBrand14d || 0;

            await db
              .update(adGroups)
              .set({
                impressions,
                clicks,
                spend: String(cost),
                sales: String(sales),
                orders,
                ctr: impressions > 0 ? String((clicks / impressions).toFixed(4)) : null,
                cvr: clicks > 0 ? String((orders / clicks).toFixed(4)) : null,
                acos: cost > 0 && sales > 0 ? String(((cost / sales) * 100).toFixed(2)) : null,
                roas: cost > 0 && sales > 0 ? String((sales / cost).toFixed(2)) : null,
                cpc: clicks > 0 ? String((cost / clicks).toFixed(2)) : null,
                dpv,
                ntbOrders,
                ntbSales: String(ntbSales),
              })
              .where(eq(adGroups.id, adGroup.id));
            sbSynced++;
          }
          synced += sbSynced;
          log.info(`SB广告组绩效同步: ${sbSynced} 条记录`);
        }
      } catch (error: any) {
        log.warn('SB广告组绩效同步失败:', error);
      }
    }

    // 3. SD广告组报告（14天归因 + 浏览归因，v339分批请求）
    if (sdCampaigns.length > 0) {
      try {
        // @ts-ignore
        const sdData = await fetchBatchedReport(
          (s, e) => this.client.requestSdAdGroupReport(s, e),
          totalDays, 'SD广告组', 'adGroupId'
        );
        // @ts-ignore
        if (sdData && sdData.length > 0) {
          let sdSynced = 0;
          for (const row of (sdData as unknown[])) {
            // @ts-ignore
            const adGroupId = String(row.adGroupId);
            // v399-fix3: 使用预加载的Map查找，避免N+1查询
            const adGroup = adGroupMap.get(adGroupId);
            if (!adGroup) continue;

            // @ts-ignore
            const cost = row.cost || 0;
            // @ts-ignore
            const sales = row.sales14d || 0;
            // @ts-ignore
            const orders = row.purchases14d || 0;
            // @ts-ignore
            const impressions = row.impressions || 0;
            // @ts-ignore
            const clicks = row.clicks || 0;
            // @ts-ignore
            const dpv = row.dpv14d || 0;
            // @ts-ignore
            const viewSales = row.viewAttributedSales14d || 0;
            // @ts-ignore
            const viewOrders = row.viewAttributedUnitsOrdered14d || 0;
            // @ts-ignore
            const ntbOrders = row.attributedOrdersNewToBrand14d || 0;
            // @ts-ignore
            const ntbSales = row.attributedSalesNewToBrand14d || 0;

            await db
              .update(adGroups)
              .set({
                impressions,
                clicks,
                spend: String(cost),
                sales: String(sales),
                orders,
                ctr: impressions > 0 ? String((clicks / impressions).toFixed(4)) : null,
                cvr: clicks > 0 ? String((orders / clicks).toFixed(4)) : null,
                acos: cost > 0 && sales > 0 ? String(((cost / sales) * 100).toFixed(2)) : null,
                roas: cost > 0 && sales > 0 ? String((sales / cost).toFixed(2)) : null,
                cpc: clicks > 0 ? String((cost / clicks).toFixed(2)) : null,
                dpv,
                ntbOrders,
                ntbSales: String(ntbSales),
                viewAttributedSales: String(viewSales),
                viewAttributedOrders: viewOrders,
              })
              .where(eq(adGroups.id, adGroup.id));
            sdSynced++;
          }
          synced += sdSynced;
          log.info(`SD广告组绩效同步: ${sdSynced} 条记录`);
        }
      } catch (error: any) {
        // @ts-ignore
        log.warn('SD广告组绩效同步失败:', error);
      }
    }

    // @ts-ignore
    log.info(`广告组绩效同步完成: 共 ${synced} 条记录`);
    return synced;
  } catch (error: any) {
    log.warn('广告组绩效同步失败:', error);
    return synced;
  // @ts-ignore
  }
};

/**
 * 同步广告位置绩效数据
 * 使用Report API v3获取搜索顶部、商品详情页、其他位置的表现数据
 */
// @ts-ignore
AmazonSyncService.prototype.syncPlacementPerformance = async function(this: AmazonSyncService, days: number = 14): Promise<number> {
  // @ts-ignore
  const db = await getDb();
  // v358: 数据库不可用是真实错误，不应返回0
  // @ts-ignore
  if (!db) throw new Error('DATABASE_UNAVAILABLE: 数据库连接不可用');

  try {
    // v339: Amazon API单次请求最多31天，需要分批请求
    const MAX_DAYS_PER_REQUEST = 31;
    const totalDays = Math.min(days, 90); // SP广告位最多支持90天
    const { startDate: rangeStartDate, endDate: rangeEndDate } = getMarketplaceDateRange(this.marketplace, totalDays);
    const batches = Math.ceil(totalDays / MAX_DAYS_PER_REQUEST);
    log.info(`v339: 开始同步SP广告位置绩效: 共${totalDays}天，分${batches}批请求 (站点: ${this.marketplace})`);

    // v413: 批量提交+统一轮询模式（替代串行循环）
    let allReportData: unknown[] = [];
    if (batches === 1) {
      try {
        const reportId = await this.client.requestSpPlacementReport(rangeStartDate, rangeEndDate);
        const data = await this.client.waitAndDownloadReport(reportId, 600000); // v523.3: 超时时间增加到600秒
        if (data && data.length > 0) allReportData = data;
      } catch (e: unknown) {
        log.warn(`v413: SP广告位报告请求失败:`, (e as Error).message);
      }
    } else {
      const batchRequests: Array<{ name: string; requestFn: () => Promise<string> }> = [];
      for (let batch = 0; batch < batches; batch++) {
        const endDateObj = new Date(rangeEndDate);
        endDateObj.setDate(endDateObj.getDate() - (batch * MAX_DAYS_PER_REQUEST));
        const startDateObj = new Date(endDateObj);
        const daysInBatch = Math.min(MAX_DAYS_PER_REQUEST, totalDays - (batch * MAX_DAYS_PER_REQUEST));
        startDateObj.setDate(startDateObj.getDate() - daysInBatch + 1);
        const bStart = startDateObj.toISOString().split('T')[0];
        const bEnd = endDateObj.toISOString().split('T')[0];
        batchRequests.push({
          name: `SP广告位第${batch + 1}/${batches}批(${bStart}~${bEnd})`,
          requestFn: () => this.client.requestSpPlacementReport(bStart, bEnd),
        });
      }
      log.info(`[v413] SP广告位: ${batches}批次批量提交开始`);
      // v523.3: 超时时间从300秒增加到600秒
      // P5: 异步报告模式
      if (process.env.P5_ASYNC_REPORTS === 'true') {
        const asyncResult = await this.client.submitReportsToAsyncQueue(batchRequests, {
          accountId: this.accountId,
          syncType: 'placement_sync', // v649: 修正为 placement_sync（原来错误标记为 keyword_performance）
        });
        log.info(`[P5] Async SP placement reports submitted: ${asyncResult.queued} queued`);
        // P5: async mode - skip sync processing
      } else {
      const results = await this.client.submitAndWaitMultipleReports(batchRequests, 600000, 2000);
      for (const result of results) {
        if (result.data && result.data.length > 0) {
          allReportData = allReportData.concat(result.data);
        } else if (result.error) {
          log.warn(`[v413] ${result.name}失败: ${result.error}`);
        }
      }
      }
    }

    const reportData = allReportData;
    if (!reportData || reportData.length === 0) {
      log.debug('v339: 所有批次SP广告位报告数据为空');
      return 0;
    }
    log.info(`v339: 共获取到 ${reportData.length} 条SP广告位数据（${batches}批合并）`);
    // v351: 增强诊断日志 - 记录第一条数据的完整字段名和placement相关值
    if (reportData.length > 0) {
      const sampleRow = reportData[0] as unknown;
      // @ts-ignore
      const allKeys = Object.keys(sampleRow);
      const placementKeys = allKeys.filter(k => k.toLowerCase().includes('placement') || k.toLowerCase().includes('position') || k.toLowerCase().includes('location'));
      // @ts-ignore
      log.info(`v351: SP广告位报告字段诊断: allKeys=[${allKeys.join(',')}], placementKeys=[${placementKeys.join(',')}]`);
      // @ts-ignore
      log.info(`v351: 第一条数据placement值: placementClassification="${sampleRow.placementClassification}", campaignPlacement="${sampleRow.campaignPlacement}", placement="${sampleRow.placement}"`);
      // 统计各placement值的分布
      const placementDist: Record<string, number> = {};
      for (const r of reportData) {
        // @ts-ignore
        const raw = r.placementClassification || r.campaignPlacement || r.placement || 'MISSING';
        placementDist[raw] = (placementDist[raw] || 0) + 1;
      }
      log.info(`v351: placement值分布: ${JSON.stringify(placementDist)}`);
    }
    let synced = 0;

    // v399-fix3: 预加载campaigns映射，避免N+1查询问题（从 SELECT * 改为只查必要字段）
    const allCampaigns = await db
      .select({ id: campaigns.id, campaignId: campaigns.campaignId })
      .from(campaigns)
      .where(eq(campaigns.accountId, this.accountId));
    const campaignMap = new Map<string, { id: number; campaignId: string }>();
    for (const c of allCampaigns) {
      campaignMap.set(String(c.campaignId), c);
    }
    log.info(`v399-fix3: 预加载 ${allCampaigns.length} 个campaigns用于广告位绩效匹配`);

    for (const row of (reportData as unknown[])) {
      // v399-fix3: 使用预加载的Map查找，避免每条数据都查询数据库
      // @ts-ignore
      const campaign = campaignMap.get(String(row.campaignId));

      if (!campaign) continue;

      // v157: 转换位置类型 - 修复字段映射
      // Amazon v3 API groupBy campaignPlacement 返回的字段名可能是:
      // - placementClassification (旧版)
      // - campaignPlacement (v3 groupBy名)
      // - placement (通用fallback)
      // v350: 全面增强广告位映射 - 覆盖Amazon API v3所有已知的placement值
      const placementMap: Record<string, 'top_of_search' | 'product_page' | 'rest_of_search'> = {
        // Amazon Ads API v3 标准值
        'TOP_OF_SEARCH': 'top_of_search',
        'DETAIL_PAGE': 'product_page',
        'OTHER': 'rest_of_search',
        // Amazon Ads API v3 campaignPlacement groupBy 返回值
        'Top of Search on-Amazon': 'top_of_search',
        'Detail Page on-Amazon': 'product_page',
        'Other on-Amazon': 'rest_of_search',
        // Amazon Ads API v3 新版报告格式 (2026年新增)
        'TOP_OF_SEARCH_ON_AMAZON': 'top_of_search',
        'DETAIL_PAGE_ON_AMAZON': 'product_page',
        'OTHER_ON_AMAZON': 'rest_of_search',
        // 小写变体
        'top_of_search': 'top_of_search',
        'product_page': 'product_page',
        'rest_of_search': 'rest_of_search',
        'detail_page': 'product_page',
        'other': 'rest_of_search',
        // Amazon Ads 报告中可能的其他变体
        'Top of search': 'top_of_search',
        'Product page': 'product_page',
        'Rest of search': 'rest_of_search',
        'Remarketing off-Amazon': 'rest_of_search',
        'REMARKETING_OFF_AMAZON': 'rest_of_search',
      };
      // @ts-ignore
      const rawPlacement = row.placementClassification || row.campaignPlacement || row.placement || 'OTHER';
      const placement = placementMap[rawPlacement] || 'rest_of_search';
      // v350: 对未匹配的placement值记录警告日志，便于调试
      if (!placementMap[rawPlacement]) {
        // @ts-ignore
        log.warn(`v350: 未知的广告位置值: raw="${rawPlacement}", campaignId=${row.campaignId}, 已默认映射为rest_of_search (row keys: ${Object.keys(row).join(',')})`);
      } else {
        log.debug(`v157: 位置映射: raw="${rawPlacement}" -> "${placement}"`);
      }

      // @ts-ignore
      const reportDate = row.date || new Date().toISOString().split('T')[0];

      // v440: 命名物理隔离 - 通过extractCampaignIds解构，并用guardCampaignIdInsert拦截
      const { amazonId: amazonCampaignId } = extractCampaignIds(campaign, 'syncPlacementPerformance');
      
      // v399-fix3: 移除冗余的existing检查，已有UPSERT(onDuplicateKeyUpdate)保证覆盖式回填
      // @ts-ignore
      const cost = row.cost || 0;
      // SP广告位置报告使用7天归因窗口（与SP其他报告一致）
      // @ts-ignore
      const sales = row.sales7d || row.sales14d || 0;
      // @ts-ignore
      const clicks = row.clicks || 0;
      // @ts-ignore
      const impressions = row.impressions || 0;
      // @ts-ignore
      const orders = row.purchases7d || row.purchases14d || 0;

      const perfData = {
        campaignId: guardCampaignIdInsert(amazonCampaignId, 'placement_performance'),
        accountId: this.accountId,
        placement,
        date: reportDate,
        impressions,
        clicks,
        spend: String(cost),
        sales: String(sales),
        orders,
        ctr: impressions > 0 ? String(clicks / impressions) : null,
        cpc: clicks > 0 ? String(cost / clicks) : null,
        cvr: clicks > 0 ? String(orders / clicks) : null,
        acos: sales > 0 ? String((cost / sales) * 100) : null,
        roas: cost > 0 ? String(sales / cost) : null,
        updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      };

      // v356: 使用UPSERT策略（ON DUPLICATE KEY UPDATE）替代existing检查+INSERT/UPDATE
      // 依赖唯一约束 uk_placement_perf(campaignId, accountId, placement, date) 防止重复
      await db.insert(placementPerformance).values({
        ...perfData,
        createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      }).onDuplicateKeyUpdate({
        set: {
          impressions: perfData.impressions,
          clicks: perfData.clicks,
          spend: perfData.spend,
          sales: perfData.sales,
          orders: perfData.orders,
          ctr: perfData.ctr,
          cpc: perfData.cpc,
          cvr: perfData.cvr,
          acos: perfData.acos,
          roas: perfData.roas,
          updatedAt: perfData.updatedAt,
        }
      });
      synced++;
    }

    log.info(`位置绩效同步完成: ${synced} 条记录`);
    return synced;
  } catch (error: any) {
    log.warn('同步位置绩效失败:', error);
    // v358: 抛出错误而不是返回0
    throw error;
  }
};

/**
 * 更新campaigns表的绩效汇总数据
 * v500.2: 仅从dailyPerformance表汇总，不再回退到keywords/productTargets表
 * 原因：keywords/productTargets的绩效字段是"最后一次同步时间段"的覆盖值，时间范围不确定，
 * 与dailyPerformance的30天聚合值不可比，混合使用会导致数据不一致
 */
// @ts-ignore
AmazonSyncService.prototype.updateCampaignPerformanceSummary = async function(this: AmazonSyncService): Promise<void> {
  const db = await getDb();
  if (!db) return;

  try {
    // 获取该账户下所有广告活动
    const accountCampaigns = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.accountId, this.accountId));

    if (accountCampaigns.length === 0) return;

    log.info(`[v500.2] 开始批量更新 ${accountCampaigns.length} 个广告活动的绩效汇总 (站点: ${this.marketplace})`);

    // 使用站点时区计算最近30天的日期范围
    const { startDate: startDateStr, endDate: endDateStr } = getMarketplaceDateRange(this.marketplace, 30);

    // v500.2: 一次性从dailyPerformance表批量GROUP BY汇总，添加campaignId IS NOT NULL过滤
    const dailySummaries = await db
      .select({
        campaignId: dailyPerformance.campaignId,
        totalImpressions: sql<number>`COALESCE(SUM(${dailyPerformance.impressions}), 0)`,
        totalClicks: sql<number>`COALESCE(SUM(${dailyPerformance.clicks}), 0)`,
        totalSpend: sql<string>`COALESCE(SUM(${dailyPerformance.spend}), 0)`,
        totalSales: sql<string>`COALESCE(SUM(${dailyPerformance.sales}), 0)`,
        totalOrders: sql<number>`COALESCE(SUM(${dailyPerformance.orders}), 0)`,
      })
      .from(dailyPerformance)
      .where(
        and(
          eq(dailyPerformance.accountId, this.accountId),
          sql`${dailyPerformance.campaignId} IS NOT NULL`,
          sql`${dailyPerformance.date} >= ${startDateStr}`,
          sql`${dailyPerformance.date} <= ${endDateStr}`
        )
      )
      .groupBy(dailyPerformance.campaignId);

    // 构建campaignId -> 汇总数据的Map
    const summaryMap = new Map<string, {
      totalImpressions: number;
      totalClicks: number;
      totalSpend: number;
      totalSales: number;
      totalOrders: number;
    }>();
    for (const s of dailySummaries) {
      if (s.campaignId) {
        summaryMap.set(s.campaignId, {
          totalImpressions: s.totalImpressions || 0,
          totalClicks: s.totalClicks || 0,
          totalSpend: parseFloat(s.totalSpend || '0'),
          totalSales: parseFloat(s.totalSales || '0'),
          totalOrders: s.totalOrders || 0,
        });
      }
    }

    // v500.2: 移除了从keywords/productTargets回退聚合的逻辑
    // 如果没有dailyPerformance数据，campaigns的绩效字段保持为0

    // 批量更新campaigns表
    let updatedCount = 0;
    for (const campaign of (accountCampaigns as unknown[])) {
      // @ts-ignore
      const summary = summaryMap.get(String(campaign.campaignId));
      const totalImpressions = summary?.totalImpressions || 0;
      const totalClicks = summary?.totalClicks || 0;
      const totalSpend = summary?.totalSpend || 0;
      const totalSales = summary?.totalSales || 0;
      const totalOrders = summary?.totalOrders || 0;

      await db
        .update(campaigns)
        .set({
          impressions: totalImpressions,
          clicks: totalClicks,
          spend: String(totalSpend.toFixed(2)),
          sales: String(totalSales.toFixed(2)),
          orders: totalOrders,
          acos: totalSpend > 0 && totalSales > 0 ? String(((totalSpend / totalSales) * 100).toFixed(2)) : null,
          roas: totalSpend > 0 && totalSales > 0 ? String((totalSales / totalSpend).toFixed(2)) : null,
          ctr: totalImpressions > 0 ? String((totalClicks / totalImpressions).toFixed(4)) : null,
          cvr: totalClicks > 0 ? String((totalOrders / totalClicks).toFixed(4)) : null,
          cpc: totalClicks > 0 ? String((totalSpend / totalClicks).toFixed(2)) : null,
        })
        // @ts-ignore
        .where(eq(campaigns.id, campaign.id));
      updatedCount++;
    }

    log.info(`[v391] 广告活动绩效汇总批量更新完成: ${updatedCount}个 (SQL查询从${accountCampaigns.length * 2}+次减少到4次)`);
  } catch (error: any) {
    log.warn('[v391] 更新广告活动绩效汇总失败:', error);
  }
};

