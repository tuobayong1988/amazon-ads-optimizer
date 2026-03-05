/**
 * 绩效数据同步方法（日报、小时报、关键词绩效、广告组绩效等）
 * 
 * 从 amazonSyncService.ts 中提取的 syncPerformance 子模块。
 * 通过 prototype 扩展模式将方法注入到 AmazonSyncService 类中。
 */
import { eq, and, sql, gte, lte, inArray, desc, asc, isNull, isNotNull } from 'drizzle-orm';
import { getDb } from '../../db';
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
} from '../../../drizzle/schema';
import { createModuleLogger } from '../../utils/logger';
import type { AmazonAdsApiClient, SpCampaign } from '../../amazonAdsApi';
import { getMarketplaceDateRange, getMarketplaceCurrentDate, getMarketplaceYesterday, getMarketplaceHistoricalDateRange } from '../../utils/timezone';
import { getExchangeRateByMarketplace } from '../exchangeRateService';
import { AmazonSyncService } from '../../amazonSyncService';
import {
  SYNC_PROTECTION_CONFIG,
  createSyncProtectionStats,
  logSyncProtectionSummary,
  hasRecentSyncedOptimization,
  getRecentlyOptimizedKeywordIds,
  getRecentlyOptimizedCampaignIds,
} from './syncHelpers';
import { calculateBidAdjustment } from '../../bidOptimizer';
import type { OptimizationTarget, PerformanceGroupConfig } from '../../bidOptimizer';

const log = createModuleLogger('syncPerformance');

// ==================== 类型声明（模块扩展） ====================

declare module '../../amazonSyncService' {
  interface AmazonSyncService {
    syncPerformanceData(...args: any[]): any;
    syncPerformanceDataBatch(...args: any[]): any;
    processReportData(...args: any[]): any;
    generateMockPerformanceData(...args: any[]): any;
    syncKeywordPerformanceData(...args: any[]): any;
    syncProductTargetPerformanceData(...args: any[]): any;
    generateHourlyFromDaily(...args: any[]): any;
    syncAdGroupPerformanceData(...args: any[]): any;
    syncPlacementPerformance(...args: any[]): any;
    updateCampaignPerformanceSummary(...args: any[]): any;
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
AmazonSyncService.prototype.syncPerformanceData = async function(this: AmazonSyncService, days: number = 14): Promise<number> {
  const db = await getDb();
  if (!db) {
    log.error('数据库连接失败');
    return 0;
  }

  try {
    // Amazon API单次请求最多31天，需要分批请求
    const MAX_DAYS_PER_REQUEST = 31;
    const totalDays = Math.min(days, 90); // 最多90天（SP支持95天，SB只支持60天，取90天作为平衡）
    
    let totalSynced = 0;
    
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
        const batchSynced = await this.syncPerformanceDataBatch(startDateStr, endDateStr);
        totalSynced += batchSynced;
        log.info(`第${batch + 1}批同步完成: ${batchSynced}条记录`);
        
        // 批次之间稍作延迟，避免触发API速率限制
        if (batch < batches - 1) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      } catch (batchError: any) {
        log.error(`第${batch + 1}批同步失败:`, batchError.message);
        // 继续下一批，不中断整个同步过程
      }
    }
    
    // 同步完成后，更新campaigns表的绩效汇总数据
    await this.updateCampaignPerformanceSummary();
    
    // v195: 同步完成后，自动从daily_performance生成hourly_performance数据
    try {
      const hourlyGenerated = await this.generateHourlyFromDaily(rangeStartDate, rangeEndDate);
      log.info(`v195: hourly_performance自动生成完成: ${hourlyGenerated}条`);
    } catch (hourlyErr: any) {
      log.error(`v195: hourly_performance生成失败: ${hourlyErr.message}`);
    }
    
    log.info(`绩效数据同步完成: 共${totalSynced}条记录`);
    return totalSynced;
  } catch (error: any) {
    log.error(`[v242] 同步绩效数据失败: ${JSON.stringify({ message: error.message, status: error.status || error.response?.status, code: error.code })}`);
    log.error('[v242] 详细错误:', error.stack?.substring(0, 500));
    
    // v148: 移除模拟数据回退逻辑 - 报告超时时不再生成假数据，而是记录错误并等待下次重试
    if (error.message?.includes('timeout') || error.message?.includes('PENDING') || error.message?.includes('Report generation')) {
      log.error('v148: 报告超时或生成失败，将在下次同步周期重试。不再生成模拟数据。');
    }
    
    return 0;
  }
};

/**
 * 同步单批绩效数据（内部方法）
 */
AmazonSyncService.prototype.syncPerformanceDataBatch = async function(this: AmazonSyncService, startDateStr: string, endDateStr: string): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  let totalSynced = 0;

  // v215优化: 并行请求SP/SB/SD报告 + 智能重试
  const retryReport = async (name: string, requestFn: () => Promise<string>, maxRetries = 3): Promise<any[] | null> => {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        log.info(`[${name}] 请求报告 (尝试${attempt}/${maxRetries}): ${startDateStr} - ${endDateStr}`);
        const reportId = await requestFn();
        log.info(`[${name}] 报告请求成功, reportId: ${reportId}`);
        const data = await this.client.waitAndDownloadReport(reportId, 900000);
        log.info(`[${name}] 报告下载完成, 数据条数: ${data?.length || 0}`);
        return data;
      } catch (err: any) {
        const isRetryable = !err.message?.includes('401') && !err.message?.includes('403') && !err.message?.includes('not enabled');
        if (attempt < maxRetries && isRetryable) {
          const delay = attempt * 5000; // 5s, 10s, 15s
          log.warn(`[${name}] 尝试${attempt}失败: ${err.message}, ${delay/1000}秒后重试...`);
          await new Promise(r => setTimeout(r, delay));
        } else {
          log.error(`[${name}] 报告同步最终失败 (${attempt}次尝试): ${err.message}`);
          return null;
        }
      }
    }
    return null;
  };

  // 并行请求三种报告
  const [spData, sbData, sdData] = await Promise.all([
    retryReport('SP', () => this.client.requestSpCampaignReport(startDateStr, endDateStr)),
    retryReport('SB', () => this.client.requestSbCampaignReport(startDateStr, endDateStr)),
    retryReport('SD', () => this.client.requestSdCampaignReport(startDateStr, endDateStr)),
  ]);

  // 串行处理数据（避免数据库并发冲突）
  if (spData && spData.length > 0) {
    totalSynced += await this.processReportData(db, spData, 'SP');
  }
  if (sbData && sbData.length > 0) {
    totalSynced += await this.processReportData(db, sbData, 'SB');
  }
  if (sdData && sdData.length > 0) {
    totalSynced += await this.processReportData(db, sdData, 'SD');
  }

  log.info(`绩效数据同步完成: SP=${spData?.length||0}, SB=${sbData?.length||0}, SD=${sdData?.length||0}, 总入库=${totalSynced}`);
  return totalSynced;
};

/**
 * 处理报告数据并存储到数据库
 */
AmazonSyncService.prototype.processReportData = async function(this: AmazonSyncService, db: any, reportData: any[], adType: string): Promise<number> {
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
    let matchedById = 0;
    let matchedByName = 0;
    let notMatched = 0;
    
    for (const row of reportData) {
      // 策略：先用campaignId匹配，失败后用campaignName匹配
      // 这是因为SB/SD的报告ID可能与List API返回的ID不一致
      
      // 策略1: 先用campaignId匹配
      let [campaign] = await db
        .select()
        .from(campaigns)
        .where(
          and(
            eq(campaigns.accountId, this.accountId),
            eq(campaigns.campaignId, String(row.campaignId))
          )
        )
        .limit(1);

      if (campaign) {
        matchedById++;
      } else if (row.campaignName) {
        // 策略2: 用campaignName匹配（紧急规避方案）
        // 亚马逊广告活动名称是唯一的，可以用作关联
        [campaign] = await db
          .select()
          .from(campaigns)
          .where(
            and(
              eq(campaigns.accountId, this.accountId),
              eq(campaigns.campaignName, row.campaignName)
            )
          )
          .limit(1);
        
        if (campaign) {
          matchedByName++;
          // 注意：只做只读匹配，不修改campaigns表的campaignId
          // 因为Management API (List)返回的V4 ID是系统的唯一真理
          // 报表API返回的可能是Legacy ID，如果覆盖V4 ID会导致下次同步出错
          log.info(`${adType}通过名称匹配成功: ${row.campaignName} (reportId=${row.campaignId}, dbId=${campaign.campaignId})`);
        }
      }

      if (!campaign) {
        // 尝试自动创建campaign记录，以保存报告数据
        if (row.campaignId && row.campaignName) {
          try {
            log.info(`${adType}自动创建campaign: ${row.campaignName}`);
            const [newCampaign] = await db.insert(campaigns).values({
              accountId: this.accountId,
              campaignId: String(row.campaignId),
              campaignName: row.campaignName,
              campaignType: adType === 'SP' ? 'sp_manual' : adType.toLowerCase() as 'sp_auto' | 'sp_manual' | 'sb' | 'sd',
              targetingType: 'manual',
              status: row.campaignStatus || 'enabled',
              dailyBudget: row.campaignBudget ? String(row.campaignBudget) : '0',
              createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
              updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
            }).returning();
            campaign = newCampaign;
            log.info(`${adType}自动创建campaign成功: id=${campaign.id}, name=${campaign.campaignName}`);
          } catch (createError: any) {
            // 可能是重复插入，尝试再次查询
            log.warn(`${adType}创建campaign失败，尝试再次查询:`, createError.message);
            [campaign] = await db
              .select()
              .from(campaigns)
              .where(
                and(
                  eq(campaigns.accountId, this.accountId),
                  eq(campaigns.campaignName, row.campaignName)
                )
              )
              .limit(1);
          }
        }
        
        if (!campaign) {
          notMatched++;
          // 记录未找到的campaign，用于调试
          if (notMatched <= 10) {
            log.warn(`${adType}未找到campaign: accountId=${this.accountId}, campaignId=${row.campaignId}, campaignName=${row.campaignName || 'N/A'}`);
          }
          continue;
        }
      }

      // 使用报告日期或当前日期
      const reportDate = row.date ? new Date(row.date) : new Date();
      const reportDateStr = reportDate.toISOString().split('T')[0];

      // v323: 检查是否已存在当天数据 - 必须包含accountId条件防止跨账户数据混淆
      const [existing] = await db
        .select()
        .from(dailyPerformance)
        .where(
          and(
            eq(dailyPerformance.accountId, this.accountId),
            eq(dailyPerformance.campaignId, String(campaign.campaignId)),
            sql`DATE(${dailyPerformance.date}) = ${reportDateStr}`
          )
        )
        .limit(1);

      // 使用 Amazon Ads API v3 的字段名 (2026年1月更新)
      // ⚠️ 重要: 不同广告类型使用不同的字段名
      // SP: 使用 7天归因 (sales7d, purchases7d, unitsSoldClicks7d)
      // SB: 使用 Clicks后缀 (salesClicks, purchasesClicks, unitsSoldClicks, detailPageViewsClicks)
      // SD: 使用 Clicks后缀 (salesClicks, purchasesClicks, unitsSoldClicks, detailPageViewsClicks, viewableImpressions)
      const cost = row.cost || 0;
      let sales = 0;
      let orders = 0;
      let unitsSold = 0;
      let dpv = 0;
      let addToCart = 0;
      let ntbOrders = 0;
      let ntbSales = 0;
      let viewableImpressions = 0;
      
      if (adType === 'SP') {
        // ✅ SP报告使用 7天归因窗口 (7d) - 修正字段名
        // 参考文档: https://advertising.amazon.com/API/docs/en-us/reporting/v3/report-types
        sales = row.sales7d || 0;
        orders = row.purchases7d || 0;
        unitsSold = row.unitsSoldClicks7d || 0;
        // SP不支持 dpv 和 addToCart 在 7d 字段中
        dpv = 0;
        addToCart = 0;
      } else if (adType === 'SB') {
        // ✅ SB报告使用修正后的字段名 (Clicks后缀)
        sales = row.salesClicks || 0;
        orders = row.purchasesClicks || 0;
        unitsSold = row.unitsSoldClicks || 0;
        dpv = row.detailPageViewsClicks || 0;
        ntbOrders = row.newToBrandPurchasesClicks || 0;
        ntbSales = row.newToBrandSalesClicks || 0;
      } else {
        // ✅ SD报告使用修正后的字段名 (Clicks后缀)
        sales = row.salesClicks || 0;
        orders = row.purchasesClicks || 0;
        unitsSold = row.unitsSoldClicks || 0;
        viewableImpressions = row.viewableImpressions || 0;
        dpv = row.detailPageViewsClicks || 0;
        ntbOrders = row.newToBrandPurchasesClicks || 0;
        ntbSales = row.newToBrandSalesClicks || 0;
      }
      
      // ✅ v149: 货币转换 - 使用实时汇率服务（每日自动从API刷新）
      const { currency, rate: exchangeRate } = await getExchangeRateByMarketplace(this.marketplace);
      const spendUsd = cost * exchangeRate;
      const salesUsd = sales * exchangeRate;

      const perfData = {
        accountId: this.accountId,
        campaignId: campaign.campaignId,
        date: reportDateStr,
        impressions: row.impressions || 0,
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
        ctr: (row.impressions || 0) > 0 ? String(((row.clicks || 0) / (row.impressions || 0))) : null,
        cvr: (row.clicks || 0) > 0 ? String((orders / (row.clicks || 0))) : null,
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

      if (existing) {
        await db
          .update(dailyPerformance)
          .set(perfData)
          .where(eq(dailyPerformance.id, existing.id));
        // v104: Update currency fields via raw SQL (not in Drizzle schema)
        await db.execute(sql`UPDATE daily_performance SET currency = ${currency}, exchange_rate = ${exchangeRate}, spend_usd = ${spendUsd.toFixed(2)}, sales_usd = ${salesUsd.toFixed(2)} WHERE id = ${existing.id}`);
      } else {
        const insertResult = await db.insert(dailyPerformance).values({
          ...perfData,
          createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
        });
        // v104: Update currency fields via raw SQL for newly inserted record
        const insertId = insertResult?.[0]?.insertId || insertResult?.insertId;
        if (insertId) {
          await db.execute(sql`UPDATE daily_performance SET currency = ${currency}, exchange_rate = ${exchangeRate}, spend_usd = ${spendUsd.toFixed(2)}, sales_usd = ${salesUsd.toFixed(2)} WHERE id = ${insertId}`);
        } else {
          // Fallback: update by composite key
          await db.execute(sql`UPDATE daily_performance SET currency = ${currency}, exchange_rate = ${exchangeRate}, spend_usd = ${spendUsd.toFixed(2)}, sales_usd = ${salesUsd.toFixed(2)} WHERE campaignId = ${campaign.campaignId} AND DATE(date) = ${reportDateStr} AND accountId = ${this.accountId}`);
        }
      }
      synced++;
    }

    // 输出匹配统计
    log.info(`${adType}报告数据处理完成:`);
    log.debug(`  - 通过ID匹配: ${matchedById} 条`);
    log.debug(`  - 通过名称匹配: ${matchedByName} 条`);
    log.debug(`  - 未匹配: ${notMatched} 条`);
    log.info(`  - 总同步: ${synced} 条`);
    return synced;
  } catch (error: any) {
    log.error(`${adType}报告数据处理失败:`, error.message);
    return 0;
  }
};

/**
 * @deprecated v187: 此方法生成模拟数据，严重误导优化算法
 * 已无任何调用方，保留仅作为参考，禁止在生产环境中使用
 * 应使用syncPerformanceData()获取真实Amazon API数据
 */
AmazonSyncService.prototype.generateMockPerformanceData = async function(this: AmazonSyncService, days: number = 7): Promise<number> {
  log.warn('⚠️ generateMockPerformanceData已废弃，不应被调用！请使用syncPerformanceData()代替');
  const db = await getDb();
  if (!db) return 0;

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
    
    for (const campaign of accountCampaigns) {
      // 为每个广告活动生成最近N天的模拟数据
      for (let i = 0; i < days; i++) {
        // 基于站点当前日期计算
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
              eq(dailyPerformance.campaignId, String(campaign.campaignId)),
              sql`DATE(${dailyPerformance.date}) = ${dateStr}`
            )
          )
          .limit(1);
        if (existing) continue;;

        // 生成基于广告活动类型的模拟数据
        const baseImpressions = (campaign.campaignType === 'sp_auto' || campaign.campaignType === 'sp_manual') ? 5000 : 
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
          campaignId: campaign.campaignId,
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
    await this.updateCampaignPerformanceSummary();

    log.info(`模拟绩效数据生成完成: ${synced} 条记录`);
    return synced;
  } catch (error) {
    log.error('生成模拟绩效数据失败:', error);
    return 0;
  }
};

/**
 * 同步关键词绩效数据
 * 从Amazon Reporting API获取关键词级别的绩效数据并更新到keywords表
 */
AmazonSyncService.prototype.syncKeywordPerformanceData = async function(this: AmazonSyncService, days: number = 7): Promise<number> {
  const db = await getDb();
  if (!db) {
    log.error('数据库连接失败');
    return 0;
  }

  try {
    // 使用站点时区计算日期范围
    const { startDate: startDateStr, endDate: endDateStr } = getMarketplaceDateRange(this.marketplace, days);

    log.info(`v196: 开始同步关键词绩效数据: ${startDateStr} - ${endDateStr} (站点: ${this.marketplace})`);

    // 请求关键词报告
    const reportId = await this.client.requestSpKeywordReport(startDateStr, endDateStr);
    log.info(`v196: 关键词报告请求成功, reportId: ${reportId}`);
    
    // 等待并下载报告（超时15分钟）
    const reportData = await this.client.waitAndDownloadReport(reportId, 900000);
    log.info(`v196: 关键词报告下载完成, 数据条数: ${reportData?.length || 0}`);
    
    if (!reportData || reportData.length === 0) {
      log.warn('v196: 关键词报告数据为空');
      return 0;
    }
    
    log.debug('v196: 关键词报告数据第一条示例:', JSON.stringify(reportData[0], null, 2));
    
    // ==================== v196: 批量预加载本地数据，避免N+1查询 ====================
    // 1. 预加载所有adGroups的Amazon ID -> 本地ID映射
    const allAdGroups = await db.select({ id: adGroups.id, adGroupId: adGroups.adGroupId }).from(adGroups);
    const adGroupAmazonToLocal = new Map<string, number>();
    for (const ag of allAdGroups) {
      if (ag.adGroupId) adGroupAmazonToLocal.set(String(ag.adGroupId), ag.id);
    }
    
    // 2. 预加载所有keywords，建立多维索引
    const allKeywords = await db.select({
      id: keywords.id, keywordId: keywords.keywordId, keywordText: keywords.keywordText,
      matchType: keywords.matchType, adGroupId: keywords.adGroupId
    }).from(keywords);
    
    const kwByKeywordId = new Map<string, typeof allKeywords[0]>();
    // 复合键: adGroupId_keywordText_matchType
    const kwByAdGroupTextMatch = new Map<string, typeof allKeywords[0]>();
    // 复合键: adGroupId_keywordText
    const kwByAdGroupText = new Map<string, typeof allKeywords[0]>();
    // 纯文本键: keywordText (最后兜底)
    const kwByText = new Map<string, typeof allKeywords[0]>();
    
    for (const kw of allKeywords) {
      if (kw.keywordId) kwByKeywordId.set(kw.keywordId, kw);
      if (kw.adGroupId && kw.keywordText && kw.matchType) {
        kwByAdGroupTextMatch.set(`${kw.adGroupId}_${kw.keywordText.toLowerCase()}_${kw.matchType.toLowerCase()}`, kw);
      }
      if (kw.adGroupId && kw.keywordText) {
        kwByAdGroupText.set(`${kw.adGroupId}_${kw.keywordText.toLowerCase()}`, kw);
      }
      if (kw.keywordText) {
        kwByText.set(kw.keywordText.toLowerCase(), kw);
      }
    }
    
    // 3. 预加载所有product_targets，建立多维索引
    const allTargets = await db.select({
      id: productTargets.id, targetId: productTargets.targetId,
      targetExpression: productTargets.targetExpression, adGroupId: productTargets.adGroupId
    }).from(productTargets);
    
    const ptByTargetId = new Map<string, typeof allTargets[0]>();
    const ptByExpression = new Map<string, typeof allTargets[0]>();
    
    for (const pt of allTargets) {
      if (pt.targetId) ptByTargetId.set(pt.targetId, pt);
      if (pt.targetExpression) ptByExpression.set(pt.targetExpression.toLowerCase(), pt);
    }
    
    log.info(`v196: 预加载完成 - ${allKeywords.length}个关键词, ${allTargets.length}个商品投放, ${allAdGroups.length}个广告组`);
    
    // ==================== v196: 四层匹配策略 ====================
    let synced = 0;
    let notMatched = 0;
    let matchStats = { byKeywordId: 0, byAdGroupTextMatch: 0, byAdGroupText: 0, byText: 0, byTargetId: 0, byExpression: 0 };
    
    // 批量更新缓冲
    const kwUpdates: { id: number; data: any }[] = [];
    const ptUpdates: { id: number; data: any }[] = [];
    
    for (const row of reportData) {
      const reportTargetId = String(row.targetId || row.keywordId || '');
      if (!reportTargetId) continue;
      
      const cost = row.cost || 0;
      const sales = row.sales7d || row.sales14d || 0;
      const orders = row.purchases7d || row.purchases14d || 0;
      const impressions = row.impressions || 0;
      const clicks = row.clicks || 0;
      
      // 层1: 通过keywordId精确匹配
      let kw = kwByKeywordId.get(reportTargetId);
      if (kw) { matchStats.byKeywordId++; }
      
      // 层2: 通过adGroupId + keywordText + matchType三元组匹配
      if (!kw && row.targetingText && row.adGroupId) {
        const localAgId = adGroupAmazonToLocal.get(String(row.adGroupId));
        if (localAgId) {
          const matchType = row.matchType || row.keywordType || '';
          if (matchType) {
            kw = kwByAdGroupTextMatch.get(`${localAgId}_${row.targetingText.toLowerCase()}_${matchType.toLowerCase()}`);
            if (kw) matchStats.byAdGroupTextMatch++;
          }
          // 层3: 通过adGroupId + keywordText二元组匹配
          if (!kw) {
            kw = kwByAdGroupText.get(`${localAgId}_${row.targetingText.toLowerCase()}`);
            if (kw) matchStats.byAdGroupText++;
          }
        }
      }
      
      // 层4: 通过纯keywordText匹配（兜底）
      if (!kw && row.targetingText) {
        kw = kwByText.get(row.targetingText.toLowerCase());
        if (kw) matchStats.byText++;
      }
      
      if (kw) {
        kwUpdates.push({
          id: kw.id,
          data: {
            impressions, clicks,
            spend: String(cost), sales: String(sales), orders,
            keywordAcos: cost > 0 && sales > 0 ? String(((cost / sales) * 100).toFixed(2)) : null,
            keywordCtr: impressions > 0 ? String((clicks / impressions).toFixed(4)) : null,
            keywordCvr: clicks > 0 ? String((orders / clicks).toFixed(4)) : null,
            keywordCpc: clicks > 0 ? String((cost / clicks).toFixed(2)) : null,
            keywordRoas: cost > 0 && sales > 0 ? String((sales / cost).toFixed(2)) : null,
            updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
          }
        });
        synced++;
        continue;
      }
      
      // 尝试匹配product_targets
      let pt = ptByTargetId.get(reportTargetId);
      if (pt) { matchStats.byTargetId++; }
      
      if (!pt && row.targetingExpression) {
        pt = ptByExpression.get(row.targetingExpression.toLowerCase());
        if (pt) matchStats.byExpression++;
      }
      
      if (pt) {
        ptUpdates.push({
          id: pt.id,
          data: {
            impressions, clicks,
            spend: String(cost), sales: String(sales), orders,
            targetAcos: cost > 0 && sales > 0 ? String(((cost / sales) * 100).toFixed(2)) : null,
            targetRoas: cost > 0 && sales > 0 ? String((sales / cost).toFixed(2)) : null,
            targetCtr: impressions > 0 ? String((clicks / impressions).toFixed(4)) : null,
            targetCvr: clicks > 0 ? String((orders / clicks).toFixed(4)) : null,
            targetCpc: clicks > 0 ? String((cost / clicks).toFixed(2)) : null,
            updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
          }
        });
        synced++;
        continue;
      }
      
      notMatched++;
      if (notMatched <= 5) {
        log.warn(`v196: 未匹配: targetId=${reportTargetId}, text=${row.targetingText || 'N/A'}, expr=${row.targetingExpression || 'N/A'}`);
      }
    }
    
    // ==================== v196: 批量写入数据库 ====================
    let dbWritten = 0;
    for (const upd of kwUpdates) {
      try {
        await db.update(keywords).set(upd.data).where(eq(keywords.id, upd.id));
        dbWritten++;
      } catch (e: any) {
        log.error(`v196: 更新keyword ${upd.id} 失败: ${e.message}`);
      }
    }
    for (const upd of ptUpdates) {
      try {
        await db.update(productTargets).set(upd.data).where(eq(productTargets.id, upd.id));
        dbWritten++;
      } catch (e: any) {
        log.error(`v196: 更新product_target ${upd.id} 失败: ${e.message}`);
      }
    }
    
    log.info(`v196: 关键词绩效同步完成 - 匹配${synced}条, 未匹配${notMatched}条, 写入${dbWritten}条`);
    log.debug(`v196: 匹配统计 - keywordId:${matchStats.byKeywordId}, adGroup+text+match:${matchStats.byAdGroupTextMatch}, adGroup+text:${matchStats.byAdGroupText}, text:${matchStats.byText}, targetId:${matchStats.byTargetId}, expression:${matchStats.byExpression}`);
    
    // v196: 同步时顺便回填keywordId（如果通过文本匹配到了但keywordId不一致）
    let backfilled = 0;
    for (const row of reportData) {
      const reportTargetId = String(row.targetId || row.keywordId || '');
      if (!reportTargetId || !row.targetingText) continue;
      
      // 检查是否有通过文本匹配到的keyword缺少keywordId
      const kw = kwByText.get(row.targetingText.toLowerCase());
      if (kw && (!kw.keywordId || kw.keywordId.startsWith('SKIP_'))) {
        try {
          await db.update(keywords).set({ keywordId: reportTargetId }).where(eq(keywords.id, kw.id));
          backfilled++;
        } catch (e: any) {
          // 忽略重复键错误
        }
      }
    }
    if (backfilled > 0) {
      log.debug(`v196: 回填了${backfilled}个关键词的keywordId`);
    }
    
    return synced;
  } catch (error: any) {
    // v242: 结构化错误日志，避免错误信息被截断
    const errorInfo = {
      message: error.message || 'Unknown error',
      status: error.status || error.response?.status,
      code: error.code,
      url: error.config?.url,
      responseData: error.response?.data ? JSON.stringify(error.response.data).substring(0, 500) : undefined,
    };
    log.error(`[v242] 关键词绩效同步失败(marketplace=${this.marketplace}): ${JSON.stringify(errorInfo)}`);
    return 0;
  }
};

/**
 * 同步商品定位级别绩效数据
 * 注意: SP-Targeting报告已包含商品定位数据，syncKeywordPerformanceData中已处理
 * 此方法作为补充，确保数据完整性
 */
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
AmazonSyncService.prototype.generateHourlyFromDaily = async function(this: AmazonSyncService, startDate: string, endDate: string): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  
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
      ) hp ON dp.accountId = hp.accountId 
        AND dp.campaignId = hp.campaignId 
        AND DATE(dp.date) = hp.dt
      WHERE DATE(dp.date) >= ${startDate}
        AND DATE(dp.date) <= ${endDate}
        AND (dp.impressions > 0 OR dp.clicks > 0)
        AND hp.dt IS NULL
    `);
    
    const rows = (dailyData as any)?.[0] || dailyData;
    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      log.debug('v195: 没有新的daily数据需要生成hourly');
      return 0;
    }
    
    log.debug(`v195: 找到 ${rows.length} 条缺少hourly数据的daily记录`);
    
    let insertedCount = 0;
    let batch: any[] = [];
    
    for (const daily of rows) {
      const dateObj = new Date(daily.date);
      const dayOfWeek = dateObj.getDay();
      const totalImp = daily.impressions || 0;
      const totalClk = daily.clicks || 0;
      const totalSpend = parseFloat(String(daily.spend || '0'));
      const totalSales = parseFloat(String(daily.sales || '0'));
      const totalOrders = daily.orders || 0;
      
      if (totalImp === 0 && totalClk === 0) continue;
      
      // 周末调整
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      const dist = HOURLY_TRAFFIC.map(base => {
        if (isWeekend) return base * 0.7 + (1/24) * 0.3;
        return base;
      });
      const distSum = dist.reduce((a, b) => a + b, 0);
      
      const dateStr = typeof daily.date === 'string' 
        ? daily.date.split('T')[0].split(' ')[0]
        : dateObj.toISOString().split('T')[0];
      
      for (let h = 0; h < 24; h++) {
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
          await db.insert(hourlyPerformance).values(batch);
          insertedCount += batch.length;
          batch = [];
        }
      }
    }
    
    if (batch.length > 0) {
      await db.insert(hourlyPerformance).values(batch);
      insertedCount += batch.length;
    }
    
    return insertedCount;
  } catch (error: any) {
    log.error('v195: generateHourlyFromDaily失败:', error.message);
    return 0;
  }
};

/**
 * 同步广告组绩效数据
 * 通过SP/SB/SD广告组报告获取广告组级别的绩效数据
 * 并写入adGroups表的绩效字段（impressions/clicks/spend/sales/orders/ctr/cvr/acos/roas/cpc等）
 * 
 * 归因窗口: SP=7天, SB/SD=14天
 */
AmazonSyncService.prototype.syncAdGroupPerformanceData = async function(this: AmazonSyncService, days: number = 14): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  let synced = 0;
  try {
    const { startDate, endDate } = getMarketplaceDateRange(this.marketplace, days);
    log.info(`开始同步广告组绩效数据: ${startDate} - ${endDate} (站点: ${this.marketplace})`);

    // 获取该账户下所有广告活动
    const accountCampaigns = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.accountId, this.accountId));

    // 按广告类型分组
    const spCampaigns = accountCampaigns.filter(c => c.campaignType === 'sp_auto' || c.campaignType === 'sp_manual');
    const sbCampaigns = accountCampaigns.filter(c => c.campaignType === 'sb');
    const sdCampaigns = accountCampaigns.filter(c => c.campaignType === 'sd');

    // 1. SP广告组报告（7天归因）
    if (spCampaigns.length > 0) {
      try {
        const { startDate: spStart, endDate: spEnd } = getMarketplaceDateRange(this.marketplace, 7);
        const spReportId = await this.client.requestSpAdGroupReport(spStart, spEnd);
        const spData = await this.client.waitAndDownloadReport(spReportId);
        if (spData && spData.length > 0) {
          for (const row of spData) {
            const adGroupId = String(row.adGroupId);
            // 查找对应的广告组
            const [adGroup] = await db
              .select()
              .from(adGroups)
              .where(eq(adGroups.adGroupId, adGroupId))
              .limit(1);
            if (!adGroup) continue;

            const cost = row.cost || 0;
            const sales = row.sales7d || 0;
            const orders = row.purchases7d || 0;
            const impressions = row.impressions || 0;
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
      } catch (error) {
        log.error('SP广告组绩效同步失败:', error);
      }
    }

    // 2. SB广告组报告（14天归因）
    if (sbCampaigns.length > 0) {
      try {
        const sbReportId = await this.client.requestSbAdGroupReport(startDate, endDate);
        const sbData = await this.client.waitAndDownloadReport(sbReportId);
        if (sbData && sbData.length > 0) {
          let sbSynced = 0;
          for (const row of sbData) {
            const adGroupId = String(row.adGroupId);
            const [adGroup] = await db
              .select()
              .from(adGroups)
              .where(eq(adGroups.adGroupId, adGroupId))
              .limit(1);
            if (!adGroup) continue;

            const cost = row.cost || 0;
            const sales = row.salesClicks14d || row.sales14d || 0;
            const orders = row.purchasesClicks14d || row.purchases14d || 0;
            const impressions = row.impressions || 0;
            const clicks = row.clicks || 0;
            const dpv = row.dpv14d || 0;
            const ntbOrders = row.attributedOrdersNewToBrand14d || 0;
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
      } catch (error) {
        log.error('SB广告组绩效同步失败:', error);
      }
    }

    // 3. SD广告组报告（14天归因 + 浏览归因）
    if (sdCampaigns.length > 0) {
      try {
        const sdReportId = await this.client.requestSdAdGroupReport(startDate, endDate);
        const sdData = await this.client.waitAndDownloadReport(sdReportId);
        if (sdData && sdData.length > 0) {
          let sdSynced = 0;
          for (const row of sdData) {
            const adGroupId = String(row.adGroupId);
            const [adGroup] = await db
              .select()
              .from(adGroups)
              .where(eq(adGroups.adGroupId, adGroupId))
              .limit(1);
            if (!adGroup) continue;

            const cost = row.cost || 0;
            const sales = row.sales14d || 0;
            const orders = row.purchases14d || 0;
            const impressions = row.impressions || 0;
            const clicks = row.clicks || 0;
            const dpv = row.dpv14d || 0;
            const viewSales = row.viewAttributedSales14d || 0;
            const viewOrders = row.viewAttributedUnitsOrdered14d || 0;
            const ntbOrders = row.attributedOrdersNewToBrand14d || 0;
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
      } catch (error) {
        log.error('SD广告组绩效同步失败:', error);
      }
    }

    log.info(`广告组绩效同步完成: 共 ${synced} 条记录`);
    return synced;
  } catch (error) {
    log.error('广告组绩效同步失败:', error);
    return synced;
  }
};

/**
 * 同步广告位置绩效数据
 * 使用Report API v3获取搜索顶部、商品详情页、其他位置的表现数据
 */
AmazonSyncService.prototype.syncPlacementPerformance = async function(this: AmazonSyncService, days: number = 14): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  try {
    const { startDate, endDate } = getMarketplaceDateRange(this.marketplace, days);
    log.info(`开始同步广告位置绩效: ${startDate} - ${endDate}`);

    // 请求SP位置报告
    const reportId = await this.client.requestSpPlacementReport(startDate, endDate);
    const reportData = await this.client.waitAndDownloadReport(reportId, 300000);

    if (!reportData || reportData.length === 0) {
      log.debug('位置报告数据为空');
      return 0;
    }

    log.debug(`获取到 ${reportData.length} 条位置绩效数据`);
    let synced = 0;

    for (const row of reportData) {
      // 查找对应的campaign
      const [campaign] = await db
        .select()
        .from(campaigns)
        .where(
          and(
            eq(campaigns.accountId, this.accountId),
            eq(campaigns.campaignId, String(row.campaignId))
          )
        )
        .limit(1);

      if (!campaign) continue;

      // v157: 转换位置类型 - 修复字段映射
      // Amazon v3 API groupBy campaignPlacement 返回的字段名可能是:
      // - placementClassification (旧版)
      // - campaignPlacement (v3 groupBy名)
      // - placement (通用fallback)
      const placementMap: Record<string, 'top_of_search' | 'product_page' | 'rest_of_search'> = {
        'TOP_OF_SEARCH': 'top_of_search',
        'DETAIL_PAGE': 'product_page',
        'OTHER': 'rest_of_search',
        // v157: 添加更多可能的值映射
        'Top of Search on-Amazon': 'top_of_search',
        'Detail Page on-Amazon': 'product_page',
        'Other on-Amazon': 'rest_of_search',
        'top_of_search': 'top_of_search',
        'product_page': 'product_page',
        'rest_of_search': 'rest_of_search',
      };
      const rawPlacement = row.placementClassification || row.campaignPlacement || row.placement || 'OTHER';
      const placement = placementMap[rawPlacement] || 'rest_of_search';
      log.debug(`v157: 位置映射: raw="${rawPlacement}" -> "${placement}" (row keys: ${Object.keys(row).filter(k => k.toLowerCase().includes('place')).join(',')})`);

      const reportDate = row.date || new Date().toISOString().split('T')[0];

      // v207: 统一使用Amazon campaignId（varchar字段应存储Amazon ID）
      const localCampaignId = String(campaign.campaignId);
      
      // 检查是否已存在
      const [existing] = await db
        .select()
        .from(placementPerformance)
        .where(
          and(
            eq(placementPerformance.campaignId, localCampaignId),
            eq(placementPerformance.accountId, this.accountId),
            eq(placementPerformance.placement, placement),
            eq(placementPerformance.date, reportDate)
          )
        )
        .limit(1);

      const cost = row.cost || 0;
      // SP广告位置报告使用7天归因窗口（与SP其他报告一致）
      const sales = row.sales7d || row.sales14d || 0;
      const clicks = row.clicks || 0;
      const impressions = row.impressions || 0;
      const orders = row.purchases7d || row.purchases14d || 0;

      const perfData = {
        campaignId: localCampaignId,
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

      if (existing) {
        await db
          .update(placementPerformance)
          .set(perfData)
          .where(eq(placementPerformance.id, existing.id));
      } else {
        await db.insert(placementPerformance).values({
          ...perfData,
          createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
        });
      }
      synced++;
    }

    log.info(`位置绩效同步完成: ${synced} 条记录`);
    return synced;
  } catch (error) {
    log.error('同步位置绩效失败:', error);
    return 0;
  }
};

/**
 * 更新campaigns表的绩效汇总数据
 * 优先仍 ailyPerformance表汇总，如果没有数据则从keywords和productTargets表汇总
 */
AmazonSyncService.prototype.updateCampaignPerformanceSummary = async function(this: AmazonSyncService): Promise<void> {
  const db = await getDb();
  if (!db) return;

  try {
    // 获取该账户下所有广告活动
    const accountCampaigns = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.accountId, this.accountId));

    log.info(`开始更新 ${accountCampaigns.length} 个广告活动的绩效汇总 (站点: ${this.marketplace})`);

    // 使用站点时区计算最近30天的日期范围
    const { startDate: startDateStr, endDate: endDateStr } = getMarketplaceDateRange(this.marketplace, 30);

    for (const campaign of accountCampaigns) {
      // 首先尝试仍ailyPerformance表汇总
      const [dailySummary] = await db
        .select({
          totalImpressions: sql<number>`COALESCE(SUM(impressions), 0)`,
          totalClicks: sql<number>`COALESCE(SUM(clicks), 0)`,
          totalSpend: sql<string>`COALESCE(SUM(spend), 0)`,
          totalSales: sql<string>`COALESCE(SUM(sales), 0)`,
          totalOrders: sql<number>`COALESCE(SUM(orders), 0)`,
        })
        .from(dailyPerformance)
        .where(
          and(
            eq(dailyPerformance.accountId, this.accountId),
            eq(dailyPerformance.campaignId, String(campaign.campaignId)),
            sql`${dailyPerformance.date} >= ${startDateStr}`,
            sql`${dailyPerformance.date} <= ${endDateStr}`
          )
        );

      let totalImpressions = dailySummary?.totalImpressions || 0;
      let totalClicks = dailySummary?.totalClicks || 0;
      let totalSpend = parseFloat(dailySummary?.totalSpend || '0');
      let totalSales = parseFloat(dailySummary?.totalSales || '0');
      let totalOrders = dailySummary?.totalOrders || 0;

      // 如果dailyPerformance没有数据，从keywords和productTargets表汇总
      if (totalImpressions === 0 && totalClicks === 0 && totalSpend === 0) {
        // 获取该广告活动下的所有广告组
        const campaignAdGroups = await db
          .select({ id: adGroups.id })
          .from(adGroups)
          .where(eq(adGroups.campaignId, String(campaign.campaignId)));

        const adGroupIds = campaignAdGroups.map(ag => ag.id);

        if (adGroupIds.length > 0) {
          // 从keywords表汇总
          const [keywordSummary] = await db
            .select({
              totalImpressions: sql<number>`COALESCE(SUM(impressions), 0)`,
              totalClicks: sql<number>`COALESCE(SUM(clicks), 0)`,
              totalSpend: sql<string>`COALESCE(SUM(spend), 0)`,
              totalSales: sql<string>`COALESCE(SUM(sales), 0)`,
              totalOrders: sql<number>`COALESCE(SUM(orders), 0)`,
            })
            .from(keywords)
            .where(sql`${keywords.adGroupId} IN (${sql.join(adGroupIds, sql`, `)})`);

          // 从productTargets表汇总
          const [targetSummary] = await db
            .select({
              totalImpressions: sql<number>`COALESCE(SUM(impressions), 0)`,
              totalClicks: sql<number>`COALESCE(SUM(clicks), 0)`,
              totalSpend: sql<string>`COALESCE(SUM(spend), 0)`,
              totalSales: sql<string>`COALESCE(SUM(sales), 0)`,
              totalOrders: sql<number>`COALESCE(SUM(orders), 0)`,
            })
            .from(productTargets)
            .where(sql`${productTargets.adGroupId} IN (${sql.join(adGroupIds, sql`, `)})`);

          // 合并关键词和商品定位的数据
          totalImpressions = (keywordSummary?.totalImpressions || 0) + (targetSummary?.totalImpressions || 0);
          totalClicks = (keywordSummary?.totalClicks || 0) + (targetSummary?.totalClicks || 0);
          totalSpend = parseFloat(keywordSummary?.totalSpend || '0') + parseFloat(targetSummary?.totalSpend || '0');
          totalSales = parseFloat(keywordSummary?.totalSales || '0') + parseFloat(targetSummary?.totalSales || '0');
          totalOrders = (keywordSummary?.totalOrders || 0) + (targetSummary?.totalOrders || 0);
        }
      }

      // 更新campaigns表
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
        .where(eq(campaigns.id, campaign.id));
    }

    log.info(`广告活动绩效汇总更新完成`);
  } catch (error) {
    log.error('更新广告活动绩效汇总失败:', error);
  }
};

