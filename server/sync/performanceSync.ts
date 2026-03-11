/**
 * 绩效数据同步模块
 * 从 amazonSyncService.ts 拆分的独立模块
 */
import { eq, and, sql, gte, inArray } from 'drizzle-orm';
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
import type { AmazonAdsApiClient } from '../amazonAdsApi';
import { getExchangeRateByMarketplace } from '../services/exchangeRateService';
import { getMarketplaceDateRange, getMarketplaceCurrentDate } from '../utils/timezone';

/** 同步服务上下文 - 从AmazonSyncService传入 */
export interface SyncContext {
  client: AmazonAdsApiClient;
  accountId: number;
  userId: number;
  marketplace: string;
}

const log = createModuleLogger('performanceSync');

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
export async function syncPerformanceData(service: SyncContext,days: number = 14): Promise<number> {
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
    const { startDate: rangeStartDate, endDate: rangeEndDate } = getMarketplaceDateRange(service.marketplace, totalDays);
    log.debug(`站点${service.marketplace}当前日期: ${getMarketplaceCurrentDate(service.marketplace)}`);
    log.info(`API同步范围: ${rangeStartDate} - ${rangeEndDate} (排除今天，今日数据由AMS提供)`);
    
    // 计算需要分几批请求
    const batches = Math.ceil(totalDays / MAX_DAYS_PER_REQUEST);
    log.info(`开始同步绩效数据: 共${totalDays}天，分${batches}批请求 (站点: ${service.marketplace})`);
    
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
        const batchSynced = await syncPerformanceDataBatch(service, startDateStr, endDateStr);
        totalSynced += batchSynced;
        log.info(`第${batch + 1}批同步完成: ${batchSynced}条记录`);
        
        // 批次之间稍作延迟，避免触发API速率限制
        if (batch < batches - 1) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      } catch (batchError: unknown) {
        log.error(`第${batch + 1}批同步失败:`, (batchError as Error).message);
        // 继续下一批，不中断整个同步过程
      }
    }
    
    // 同步完成后，更新campaigns表的绩效汇总数据
    await service.updateCampaignPerformanceSummary();
    
    // v195: 同步完成后，自动从daily_performance生成hourly_performance数据
    try {
      const hourlyGenerated = await service.generateHourlyFromDaily(rangeStartDate, rangeEndDate);
      log.info(`v195: hourly_performance自动生成完成: ${hourlyGenerated}条`);
    } catch (hourlyErr: unknown) {
      log.error(`v195: hourly_performance生成失败: ${(hourlyErr as Error).message}`);
    }
    
    log.info(`绩效数据同步完成: 共${totalSynced}条记录`);
    return totalSynced;
  } catch (error: unknown) {
    log.error('同步绩效数据失败:', error);
    
    // v148: 移除模拟数据回退逻辑 - 报告超时时不再生成假数据，而是记录错误并等待下次重试
    if ((error as Error).message?.includes('timeout') || (error as Error).message?.includes('PENDING') || (error as Error).message?.includes('Report generation')) {
      log.error('v148: 报告超时或生成失败，将在下次同步周期重试。不再生成模拟数据。');
    }
    
    return 0;
  }
}

/**
 * 同步单批绩效数据（内部方法）
 */
async function syncPerformanceDataBatch(service: SyncContext, startDateStr: string, endDateStr: string): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  let totalSynced = 0;

  // v413: 批量提交SP/SB/SD报告 + 统一轮询（替代旧的retryReport+Promise.all模式）
  const reportRequests: Array<{ name: string; requestFn: () => Promise<string> }> = [
    { name: `SP绩效(${startDateStr}~${endDateStr})`, requestFn: () => service.client.requestSpCampaignReport(startDateStr, endDateStr) },
    { name: `SB绩效(${startDateStr}~${endDateStr})`, requestFn: () => service.client.requestSbCampaignReport(startDateStr, endDateStr) },
    { name: `SD绩效(${startDateStr}~${endDateStr})`, requestFn: () => service.client.requestSdCampaignReport(startDateStr, endDateStr) },
  ];
  log.info(`[v413] 绩效报告批量提交: ${startDateStr} - ${endDateStr}`);
  const results = await service.client.submitAndWaitMultipleReports(reportRequests, 300000, 2000);
  const spData = results[0]?.data || null;
  const sbData = results[1]?.data || null;
  const sdData = results[2]?.data || null;
  if (results[0]?.error) log.error(`[SP] 报告同步失败: ${results[0].error}`);
  if (results[1]?.error) log.error(`[SB] 报告同步失败: ${results[1].error}`);
  if (results[2]?.error) log.error(`[SD] 报告同步失败: ${results[2].error}`);

  // 串行处理数据（避免数据库并发冲突）
  if (spData && spData.length > 0) {
    totalSynced += await processReportData(service, db, spData, 'SP');
  }
  if (sbData && sbData.length > 0) {
    totalSynced += await processReportData(service, db, sbData, 'SB');
  }
  if (sdData && sdData.length > 0) {
    totalSynced += await processReportData(service, db, sdData, 'SD');
  }

  log.info(`绩效数据同步完成: SP=${spData?.length||0}, SB=${sbData?.length||0}, SD=${sdData?.length||0}, 总入库=${totalSynced}`);
  return totalSynced;
}

/**
 * 处理报告数据并存储到数据库
 */
async function processReportData(service: SyncContext, db: DbInstance, reportData: unknown[], adType: string): Promise<number> {
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
    
    // v364: 批量预查询消除N+1 - 一次性加载当前账户所有campaigns
    const allCampaigns = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.accountId, service.accountId));
    
    // 构建campaignId和campaignName的Map用于快速查找
    const campaignByIdMap = new Map<string, typeof allCampaigns[0]>();
    const campaignByNameMap = new Map<string, typeof allCampaigns[0]>();
    for (const c of allCampaigns) {
      if (c.campaignId) campaignByIdMap.set(String(c.campaignId), c);
      if (c.campaignName) campaignByNameMap.set(c.campaignName, c);
    }
    
    // v364: 批量预查询已存在的绩效数据 - 收集所有报告日期的数据
    const reportDates = new Set<string>();
    for (const row of (reportData as any[])) {
      const d = row.date ? new Date(row.date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
      reportDates.add(d);
    }
    const existingPerformance = await db
      .select({ id: dailyPerformance.id, accountId: dailyPerformance.accountId, campaignId: dailyPerformance.campaignId, date: dailyPerformance.date })
      .from(dailyPerformance)
      .where(
        and(
          eq(dailyPerformance.accountId, service.accountId),
          sql`DATE(${dailyPerformance.date}) IN (${sql.join([...reportDates].map(d => sql`${d}`), sql`, `)})`
        )
      );
    // 构建复合键 Map: "campaignId|date" -> existing record
    const existingPerfMap = new Map<string, typeof existingPerformance[0]>();
    for (const ep of existingPerformance) {
      const dateStr = ep.date ? (typeof ep.date === 'string' ? ep.date.split('T')[0] : new Date(ep.date).toISOString().split('T')[0]) : '';
      existingPerfMap.set(`${ep.campaignId}|${dateStr}`, ep);
    }
    
    log.info(`v364批量预查询完成: campaigns=${allCampaigns.length}, existingPerf=${existingPerformance.length}, dates=${reportDates.size}`);
    
    for (const row of (reportData as any[])) {
      // 策略：先用campaignId匹配，失败后用campaignName匹配
      // 这是因为SB/SD的报告ID可能与List API返回的ID不一致
      
      // v364: 使用预查询Map替代循环内DB查询
      let campaign = campaignByIdMap.get(String(row.campaignId)) || null;

      if (campaign) {
        matchedById++;
      } else if (row.campaignName) {
        // 策略2: 用campaignName匹配
        campaign = campaignByNameMap.get(row.campaignName) || null;
        
        if (campaign) {
          matchedByName++;
          log.info(`${adType}通过名称匹配成功: ${row.campaignName} (reportId=${row.campaignId}, dbId=${campaign.campaignId})`);
        }
      }

      if (!campaign) {
        // 尝试自动创建campaign记录，以保存报告数据
        if (row.campaignId && row.campaignName) {
          try {
            log.info(`${adType}自动创建campaign: ${row.campaignName}`);
            const [newCampaign] = await db.insert(campaigns).values({
              accountId: service.accountId,
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
            // v364: 更新Map以便后续行可以匹配
            campaignByIdMap.set(String(campaign.campaignId), campaign);
            if (campaign.campaignName) campaignByNameMap.set(campaign.campaignName, campaign);
            log.info(`${adType}自动创建campaign成功: id=${campaign.id}, name=${campaign.campaignName}`);
          } catch (createError: unknown) {
            log.warn(`${adType}创建campaign失败，尝试再次查询:`, (createError as Error).message);
            [campaign] = await db
              .select()
              .from(campaigns)
              .where(
                and(
                  eq(campaigns.accountId, service.accountId),
                  eq(campaigns.campaignName, row.campaignName)
                )
              )
              .limit(1);
            if (campaign) {
              campaignByIdMap.set(String(campaign.campaignId), campaign);
              if (campaign.campaignName) campaignByNameMap.set(campaign.campaignName, campaign);
            }
          }
        }
        
        if (!campaign) {
          notMatched++;
          if (notMatched <= 10) {
            log.warn(`${adType}未找到campaign: accountId=${service.accountId}, campaignId=${row.campaignId}, campaignName=${row.campaignName || 'N/A'}`);
          }
          continue;
        }
      }

      // 使用报告日期或当前日期
      const reportDate = row.date ? new Date(row.date) : new Date();
      const reportDateStr = reportDate.toISOString().split('T')[0];

      // v364: 使用预查询Map替代循环内DB查询
      const existingKey = `${String(campaign.campaignId)}|${reportDateStr}`;
      const existing = existingPerfMap.get(existingKey) || null;

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
      const { currency, rate: exchangeRate } = await getExchangeRateByMarketplace(service.marketplace);
      const spendUsd = cost * exchangeRate;
      const salesUsd = sales * exchangeRate;

      const perfData = {
        accountId: service.accountId,
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
        isFinalized: reportDateStr === getMarketplaceCurrentDate(service.marketplace) ? 0 : 1,
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
          await db.execute(sql`UPDATE daily_performance SET currency = ${currency}, exchange_rate = ${exchangeRate}, spend_usd = ${spendUsd.toFixed(2)}, sales_usd = ${salesUsd.toFixed(2)} WHERE campaignId = ${campaign.campaignId} AND DATE(date) = ${reportDateStr} AND accountId = ${service.accountId}`);
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
  } catch (error: unknown) {
    log.error(`${adType}报告数据处理失败:`, (error as Error).message);
    return 0;
  }
}


/**
 * @deprecated v187: 此方法生成模拟数据，严重误导优化算法
 * 已无任何调用方，保留仅作为参考，禁止在生产环境中使用
 * 应使用syncPerformanceData()获取真实Amazon API数据
 */
export async function generateMockPerformanceData(service: SyncContext,days: number = 7): Promise<number> {
  log.warn('⚠️ generateMockPerformanceData已废弃，不应被调用！请使用syncPerformanceData()代替');
  const db = await getDb();
  if (!db) return 0;

  try {
    // 获取该账户下所有广告活动
    const accountCampaigns = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.accountId, service.accountId));

    log.debug(`为 ${accountCampaigns.length} 个广告活动生成模拟绩效数据`);

    let synced = 0;

    // 使用站点时区计算日期
    const marketplaceToday = getMarketplaceCurrentDate(service.marketplace);
    log.debug(`站点${service.marketplace}当前日期: ${marketplaceToday}`);
    
    for (const campaign of (accountCampaigns as any[])) {
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
              eq(dailyPerformance.accountId, service.accountId),
              eq(dailyPerformance.campaignId, String(campaign.campaignId)),
              sql`DATE(${dailyPerformance.date}) = ${dateStr}`
            )
          )
          .limit(1);

        if (existing) continue;

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
          accountId: service.accountId,
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
    await service.updateCampaignPerformanceSummary();

    log.info(`模拟绩效数据生成完成: ${synced} 条记录`);
    return synced;
  } catch (error) {
    log.error('生成模拟绩效数据失败:', error);
    return 0;
  }
}


/**
 * v195: 从daily_performance自动生成hourly_performance数据
 * 基于美国电商典型的小时流量分布模型，将每天的总量数据按概率分布到24小时
 * 只处理还没有hourly数据的daily记录（增量式）
 */
export async function generateHourlyFromDaily(service: SyncContext,startDate: string, endDate: string): Promise<number> {
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
    
    const rows = (dailyData as Record<string, any>[])?.[0] || dailyData;
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
      const distSum = dist.reduce((a: any, b: any) => a + b, 0);
      
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
  } catch (error: unknown) {
    log.error('v195: generateHourlyFromDaily失败:', (error as Error).message);
    return 0;
  }
}


/**
 * 同步广告位置绩效数据
 * 使用Report API v3获取搜索顶部、商品详情页、其他位置的表现数据
 */
export async function syncPlacementPerformance(service: SyncContext,days: number = 14): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  try {
    const { startDate, endDate } = getMarketplaceDateRange(service.marketplace, days);
    log.info(`开始同步广告位置绩效: ${startDate} - ${endDate}`);

    // 请求SP位置报告
    const reportId = await service.client.requestSpPlacementReport(startDate, endDate);
    const reportData = await service.client.waitAndDownloadReport(reportId, 300000);

    if (!reportData || reportData.length === 0) {
      log.debug('位置报告数据为空');
      return 0;
    }

    log.debug(`获取到 ${reportData.length} 条位置绩效数据`);
    let synced = 0;

    // v364: 批量预查询消除N+1 - campaigns
    const allCampaigns = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.accountId, service.accountId));
    const campaignByIdMap = new Map<string, typeof allCampaigns[0]>();
    for (const c of allCampaigns) {
      if (c.campaignId) campaignByIdMap.set(String(c.campaignId), c);
    }
    
    // v364: 批量预查询已存在的placement绩效数据
    const existingPlacements = await db
      .select({ id: placementPerformance.id, campaignId: placementPerformance.campaignId, accountId: placementPerformance.accountId, placement: placementPerformance.placement, date: placementPerformance.date })
      .from(placementPerformance)
      .where(eq(placementPerformance.accountId, service.accountId));
    const existingPlacementMap = new Map<string, typeof existingPlacements[0]>();
    for (const ep of existingPlacements) {
      existingPlacementMap.set(`${ep.campaignId}|${ep.placement}|${ep.date}`, ep);
    }
    
    log.info(`v364批量预查询完成: campaigns=${allCampaigns.length}, existingPlacements=${existingPlacements.length}`);

    for (const row of (reportData as any[])) {
      // v364: 使用预查询Map替代循环内DB查询
      const campaign = campaignByIdMap.get(String(row.campaignId));

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
      
      // v364: 使用预查询Map替代循环内DB查询
      const existing = existingPlacementMap.get(`${localCampaignId}|${placement}|${reportDate}`) || null;

      const cost = row.cost || 0;
      // SP广告位置报告使用7天归因窗口（与SP其他报告一致）
      const sales = row.sales7d || row.sales14d || 0;
      const clicks = row.clicks || 0;
      const impressions = row.impressions || 0;
      const orders = row.purchases7d || row.purchases14d || 0;

      const perfData = {
        campaignId: localCampaignId,
        accountId: service.accountId,
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
}


/**
 * 更新campaigns表的绩效汇总数据
 * 优先仍 ailyPerformance表汇总，如果没有数据则从keywords和productTargets表汇总
 */
export async function updateCampaignPerformanceSummary(service: SyncContext,): Promise<void> {
  const db = await getDb();
  if (!db) return;

  try {
    // 获取该账户下所有广告活动
    const accountCampaigns = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.accountId, service.accountId));

    log.info(`开始更新 ${accountCampaigns.length} 个广告活动的绩效汇总 (站点: ${service.marketplace})`);

    // 使用站点时区计算最近30天的日期范围
    const { startDate: startDateStr, endDate: endDateStr } = getMarketplaceDateRange(service.marketplace, 30);

    // v364: 批量查询消除N+1 - 一次性汇总所有campaign的绩效数据
    const dailySummaries = await db
      .select({
        campaignId: dailyPerformance.campaignId,
        totalImpressions: sql<number>`COALESCE(SUM(impressions), 0)`,
        totalClicks: sql<number>`COALESCE(SUM(clicks), 0)`,
        totalSpend: sql<string>`COALESCE(SUM(spend), 0)`,
        totalSales: sql<string>`COALESCE(SUM(sales), 0)`,
        totalOrders: sql<number>`COALESCE(SUM(orders), 0)`,
      })
      .from(dailyPerformance)
      .where(
        and(
          eq(dailyPerformance.accountId, service.accountId),
          sql`${dailyPerformance.date} >= ${startDateStr}`,
          sql`${dailyPerformance.date} <= ${endDateStr}`
        )
      )
      .groupBy(dailyPerformance.campaignId);
    
    // 构建campaignId -> summary的Map
    const dailySummaryMap = new Map<string, typeof dailySummaries[0]>();
    for (const ds of dailySummaries) {
      if (ds.campaignId) dailySummaryMap.set(String(ds.campaignId), ds);
    }
    
    log.info(`v364批量汇总完成: ${dailySummaries.length}个campaign有绩效数据`);

    for (const campaign of (accountCampaigns as any[])) {
      // v364: 使用预查询Map替代循环内DB查询
      const dailySummary = dailySummaryMap.get(String(campaign.campaignId));

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
}


/**
 * 仅同步绩效数据（低频同步）
 * 用于获取历史绩效数据
 * 
 * 重要：默认14天归因回溯，确保数据与亚马逊后台一致
 */
export async function syncPerformanceOnly(service: SyncContext,days: number = 14): Promise<{
  performance: number;
  keywordPerf: number;
  targetPerf: number;
}> {
  const results = {
    performance: 0,
    keywordPerf: 0,
    targetPerf: 0,
  };
  try {
    results.performance = await service.syncPerformanceData(days);
    log.info(`绩效数据同步完成: ${results.performance} 条记录`);
  } catch (error) {
    log.error('绩效数据同步失败:', error);
  }
  // v192: 同步关键词级别绩效数据（之前仅在syncAll中执行，导致keywords表绩效全为0）
  try {
    log.info(`开始同步关键词级别绩效数据（${days}天）...`);
    results.keywordPerf = await service.syncKeywordPerformanceData(days);
    log.info(`关键词绩效数据同步完成: ${results.keywordPerf}条`);
  } catch (kwPerfError: unknown) {
    log.error('关键词绩效数据同步失败:', (kwPerfError as Error).message);
  }
  // v192: 同步商品定位级别绩效数据
  try {
    log.info(`开始同步商品定位级别绩效数据（${days}天）...`);
    results.targetPerf = await service.syncProductTargetPerformanceData(days);
    log.info(`商品定位绩效数据同步完成: ${results.targetPerf}条`);
  } catch (ptPerfError: unknown) {
    log.error('商品定位绩效数据同步失败:', (ptPerfError as Error).message);
  }
  return results;
}


/**
 * 同步SB广告位绩效数据
 * 通过SB Placement报告获取广告位级别的绩效数据
 */
export async function syncSbPlacementPerformance(service: SyncContext,days: number = 14): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  let synced = 0;
  try {
    const { startDate, endDate } = getMarketplaceDateRange(service.marketplace, days);
    log.info(`开始同步SB广告位绩效: ${startDate} - ${endDate}`);
    
    const reportId = await service.client.requestSbCampaignPlacementReport(
      startDate,
      endDate
    );
    const reportData = await service.client.waitAndDownloadReport(reportId);
    log.debug(`SB广告位报告获取到 ${reportData.length} 条记录`);
    
    for (const row of (reportData as any[])) {
      const campaignIdStr = String(row.campaignId);
      const [campaign] = await db
        .select()
        .from(campaigns)
        .where(
          and(
            eq(campaigns.accountId, service.accountId),
            eq(campaigns.campaignId, campaignIdStr)
          )
        )
        .limit(1);
      if (!campaign) continue;
      
      const dateStr = row.date || startDate;
      const rawPlacement = row.placementClassification || row.placement || 'OTHER';
      // 转换位置类型
      const placementMap: Record<string, 'top_of_search' | 'product_page' | 'rest_of_search'> = {
        'TOP_OF_SEARCH': 'top_of_search',
        'DETAIL_PAGE': 'product_page',
        'OTHER': 'rest_of_search',
      };
      const placement = placementMap[rawPlacement] || 'rest_of_search';
      
      // v207: 统一使用Amazon campaignId
      const localCampaignId2 = String(campaign.campaignId);
      
      // 写入placement_performance表
      const [existing] = await db
        .select()
        .from(placementPerformance)
        .where(
          and(
            eq(placementPerformance.campaignId, localCampaignId2),
            eq(placementPerformance.accountId, service.accountId),
            eq(placementPerformance.placement, placement),
            eq(placementPerformance.date, dateStr)
          )
        )
        .limit(1);
      
      const cost = parseFloat(row.cost || row.spend || '0');
      const sales = parseFloat(row.sales || row.attributedSales14d || '0');
      const clicks = parseInt(row.clicks || '0');
      const impressions = parseInt(row.impressions || '0');
      const orders = parseInt(row.orders || row.attributedConversions14d || '0');
      
      const perfData = {
        campaignId: localCampaignId2,
        accountId: service.accountId,
        placement: placement,
        date: dateStr,
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
        await db.update(placementPerformance).set(perfData).where(eq(placementPerformance.id, existing.id));
      } else {
        await db.insert(placementPerformance).values({
          ...perfData,
          createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
        });
      }
      synced++;
    }
    
    log.info(`SB广告位绩效同步完成: ${synced}条`);
  } catch (error: unknown) {
    log.error('SB广告位绩效同步失败:', (error as Error).message);
  }
  return synced;
}


