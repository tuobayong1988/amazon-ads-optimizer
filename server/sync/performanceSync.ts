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
import type { AmazonAdsApiClient } from './amazonAdsApi';
import { getExchangeRateByMarketplace } from '../services/exchangeRateService';
import { getMarketplaceDateRange, getMarketplaceCurrentDate } from '../utils/timezone';
import { extractCampaignIds, guardCampaignIdInsert } from '../utils/idTypes';

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
    log.warn('数据库连接失败');
    return 0;
  }

  try {
    // Amazon API单次请求最多31天，需要分批请求
    const MAX_DAYS_PER_REQUEST = 31;
    const totalDays = Math.min(days, 95); // v423: 最多95天（SP支持95天，SB/SD只支持60天但API会自动clamp）
    
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
        log.warn(`第${batch + 1}批同步失败:`, (batchError as Error).message);
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
      log.warn(`v195: hourly_performance生成失败: ${(hourlyErr as Error).message}`);
    }
    
    log.info(`绩效数据同步完成: 共${totalSynced}条记录`);
    return totalSynced;
  } catch (error: unknown) {
    log.warn('同步绩效数据失败:', error);
    
    // v148: 移除模拟数据回退逻辑 - 报告超时时不再生成假数据，而是记录错误并等待下次重试
    if ((error as Error).message?.includes('timeout') || (error as Error).message?.includes('PENDING') || (error as Error).message?.includes('Report generation')) {
      log.warn('v148: 报告超时或生成失败，将在下次同步周期重试。不再生成模拟数据。');
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
  // v676: 全量同步时跳过P5异步模式，强制同步等待
  if (process.env.P5_ASYNC_REPORTS === 'true' && !service._forceSync) {
    const asyncResult = await service.client.submitReportsToAsyncQueue(reportRequests, {
      accountId: service.accountId,
      syncType: 'performance_sync',
    });
    log.info(`[P5] Async performance reports submitted: ${asyncResult.queued} queued`);
    return 0; // 数据将由 ReportJobScheduler 异步处理
  }
  const perfSyncTimeout = service._reportWaitTimeoutMs || 600000;
  const results = await service.client.submitAndWaitMultipleReports(reportRequests, perfSyncTimeout, 2000);
  const spData = results[0]?.data || null;
  const sbData = results[1]?.data || null;
  const sdData = results[2]?.data || null;
  if (results[0]?.error) log.warn(`[SP] 报告同步失败: ${results[0].error}`);
  if (results[1]?.error) log.warn(`[SB] 报告同步失败: ${results[1].error}`);
  if (results[2]?.error) log.warn(`[SD] 报告同步失败: ${results[2].error}`);

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
 * v423: 性能优化 - 批量UPSERT替代逐条写入，货币字段合并到主操作，汇率查询移到循环外
 * 优化效果：大账户(1400+ campaigns × 95天 ≈ 130,000+行)从15分钟+超时降低到2-3分钟
 */
async function processReportData(service: SyncContext, db: DbInstance, reportData: unknown[], adType: string): Promise<number> {
  try {
    log.info(`开始处理${adType}报告数据, 共 ${reportData.length} 条记录`);
    
    if (!reportData || reportData.length === 0) {
      log.warn('报告数据为空');
      return 0;
    }
    
    // 输出第一条数据的结构，用于调试
    if (reportData.length > 0) {
      log.debug(`${adType}报告数据第一条示例:`, JSON.stringify(reportData[0], null, 2));
    }
    
    let synced = 0;
    const startMs = Date.now();

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
    for (const row of (reportData as unknown[])) {
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
    
    // v423: 汇率查询移到循环外 - 同一marketplace的汇率在一次同步中不会变化
    const { currency, rate: exchangeRate } = await getExchangeRateByMarketplace(service.marketplace);
    const todayStr = getMarketplaceCurrentDate(service.marketplace);
    const nowStr = new Date().toISOString().slice(0, 19).replace('T', ' ');
    
    // v423: 批量UPSERT - 收集所有待写入数据，分批执行
    const BATCH_SIZE = 500;
    const upsertBatch: Array<Record<string, unknown>> = [];
    
    for (const row of (reportData as unknown[])) {
      // 策略：先用campaignId匹配，失败后用campaignName匹配
      let campaign = campaignByIdMap.get(String(row.campaignId)) || null;

      if (campaign) {
        matchedById++;
      } else if (row.campaignName) {
        campaign = campaignByNameMap.get(row.campaignName) || null;
        if (campaign) {
          matchedByName++;
          log.debug(`${adType}通过名称匹配成功: ${row.campaignName} (reportId=${row.campaignId}, dbId=${campaign.campaignId})`);
        }
      }

      if (!campaign) {
        // 尝试自动创建campaign记录
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
              createdAt: nowStr,
              updatedAt: nowStr,
            }).returning();
            campaign = newCampaign;
            campaignByIdMap.set(String(campaign.campaignId), campaign);
            if (campaign.campaignName) campaignByNameMap.set(campaign.campaignName, campaign);
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

      // v440: 命名物理隔离 - 通过extractCampaignIds解构，明确区分Amazon ID和本地ID
      const { amazonId: amazonCampaignId } = extractCampaignIds(campaign, `performanceSync.${adType}`);

      const reportDate = row.date ? new Date(row.date) : new Date();
      const reportDateStr = reportDate.toISOString().split('T')[0];

      // 解析各广告类型的字段
      const cost = row.cost || 0;
      let sales = 0, orders = 0, unitsSold = 0, dpv = 0, addToCart = 0;
      let ntbOrders = 0, ntbSales = 0, viewableImpressions = 0;
      
      if (adType === 'SP') {
        sales = row.sales7d || 0;
        orders = row.purchases7d || 0;
        unitsSold = row.unitsSoldClicks7d || 0;
      } else if (adType === 'SB') {
        sales = row.salesClicks || 0;
        orders = row.purchasesClicks || 0;
        unitsSold = row.unitsSoldClicks || 0;
        dpv = row.detailPageViewsClicks || 0;
        ntbOrders = row.newToBrandPurchasesClicks || 0;
        ntbSales = row.newToBrandSalesClicks || 0;
      } else {
        sales = row.salesClicks || 0;
        orders = row.purchasesClicks || 0;
        unitsSold = row.unitsSoldClicks || 0;
        viewableImpressions = row.viewableImpressions || 0;
        dpv = row.detailPageViewsClicks || 0;
        ntbOrders = row.newToBrandPurchasesClicks || 0;
        ntbSales = row.newToBrandSalesClicks || 0;
      }
      
      // v423: 货币字段直接包含在perfData中，不再需要额外的raw SQL更新
      const spendUsd = cost * exchangeRate;
      const salesUsd = sales * exchangeRate;

      const perfData = {
        accountId: service.accountId,
        campaignId: guardCampaignIdInsert(amazonCampaignId, 'daily_performance'),
        date: reportDateStr,
        impressions: row.impressions || 0,
        clicks: row.clicks || 0,
        // v426: 统一金额精度为2位小数，比率精度为4位小数
        spend: cost.toFixed(2),
        sales: sales.toFixed(2),
        orders: orders,
        dailyAcos: cost > 0 && sales > 0 ? ((cost / sales) * 100).toFixed(2) : '0',
        dailyRoas: cost > 0 && sales > 0 ? (sales / cost).toFixed(2) : '0',
        ctr: (row.impressions || 0) > 0 ? ((row.clicks || 0) / (row.impressions || 0)).toFixed(4) : null,
        cvr: (row.clicks || 0) > 0 ? (orders / (row.clicks || 0)).toFixed(4) : null,
        cpc: (row.clicks || 0) > 0 ? (cost / (row.clicks || 0)).toFixed(2) : null,
        unitsSold, dpv, addToCart, ntbOrders,
        ntbSales: String(ntbSales),
        viewableImpressions,
        adType: adType as 'SP' | 'SB' | 'SD',
        attributionWindow: adType === 'SP' ? 7 : 14,
        isFinalized: reportDateStr === todayStr ? 0 : 1,
        dataSource: 'api' as const,
        // v423: 货币字段直接包含（v360已将这些字段纳入Drizzle schema）
        currency,
        exchangeRate: String(exchangeRate),
        spendUsd: spendUsd.toFixed(2),
        salesUsd: salesUsd.toFixed(2),
      };

      upsertBatch.push(perfData);
      
      // v423: 达到批量大小时执行批量写入
      if (upsertBatch.length >= BATCH_SIZE) {
        synced += await flushPerfBatch(db, upsertBatch, existingPerfMap, nowStr);
        upsertBatch.length = 0;
      }
    }
    
    // v423: 处理剩余数据
    if (upsertBatch.length > 0) {
      synced += await flushPerfBatch(db, upsertBatch, existingPerfMap, nowStr);
      upsertBatch.length = 0;
    }

    const elapsedSec = ((Date.now() - startMs) / 1000).toFixed(1);
    log.info(`${adType}报告数据处理完成 (${elapsedSec}秒):`);
    log.debug(`  - 通过ID匹配: ${matchedById} 条`);
    log.debug(`  - 通过名称匹配: ${matchedByName} 条`);
    log.debug(`  - 未匹配: ${notMatched} 条`);
    log.info(`  - 总同步: ${synced} 条`);
    return synced;
  } catch (error: unknown) {
    log.warn(`${adType}报告数据处理失败:`, (error as Error).message);
    return 0;
  }
}

/**
 * v423: 批量写入绩效数据 - 使用raw SQL的INSERT ... ON DUPLICATE KEY UPDATE
 * 利用uk_daily_perf唯一索引(accountId, campaignId, date, ad_type)实现UPSERT
 * 每批500条，将原来的每条2次DB操作(INSERT/UPDATE + raw SQL货币更新)合并为1次批量操作
 */
async function flushPerfBatch(
  db: DbInstance,
  batch: Array<Record<string, unknown>>,
  existingPerfMap: Map<string, unknown>,
  nowStr: string
): Promise<number> {
  if (batch.length === 0) return 0;
  
  try {
    // 分离更新和插入
    const toInsert: Array<Record<string, unknown>> = [];
    const toUpdate: Array<{ id: number; data: Record<string, unknown> }> = [];
    
    for (const perfData of batch) {
      const existingKey = `${perfData.campaignId}|${perfData.date}`;
      const existing = existingPerfMap.get(existingKey);
      
      if (existing) {
        toUpdate.push({ id: existing.id, data: perfData });
      } else {
        toInsert.push({ ...perfData, createdAt: nowStr });
      }
    }
    
    let synced = 0;
    
    // 批量INSERT - 使用ON DUPLICATE KEY UPDATE避免唯一键冲突
    if (toInsert.length > 0) {
      // 分小批次插入（MySQL单次INSERT有行数限制）
      const INSERT_CHUNK = 100;
      for (let i = 0; i < toInsert.length; i += INSERT_CHUNK) {
        const chunk = toInsert.slice(i, i + INSERT_CHUNK);
        try {
          await db.insert(dailyPerformance)
            .values(chunk as unknown)
            .onDuplicateKeyUpdate({
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
                adType: sql`VALUES(${dailyPerformance.adType})`,
                attributionWindow: sql`VALUES(${dailyPerformance.attributionWindow})`,
                isFinalized: sql`VALUES(${dailyPerformance.isFinalized})`,
                dataSource: sql`VALUES(${dailyPerformance.dataSource})`,
                currency: sql`VALUES(${dailyPerformance.currency})`,
                exchangeRate: sql`VALUES(${dailyPerformance.exchangeRate})`,
                spendUsd: sql`VALUES(${dailyPerformance.spendUsd})`,
                salesUsd: sql`VALUES(${dailyPerformance.salesUsd})`,
              },
            });
          synced += chunk.length;
        } catch (insertErr: unknown) {
          // 批量插入失败时回退到逐条插入
          log.warn(`v423: 批量INSERT失败(${chunk.length}条)，回退逐条: ${(insertErr as Error).message}`);
          for (const item of chunk) {
            try {
              await db.insert(dailyPerformance).values(item as unknown)
                .onDuplicateKeyUpdate({
                  set: {
                    impressions: sql`VALUES(${dailyPerformance.impressions})`,
                    clicks: sql`VALUES(${dailyPerformance.clicks})`,
                    spend: sql`VALUES(${dailyPerformance.spend})`,
                    sales: sql`VALUES(${dailyPerformance.sales})`,
                    orders: sql`VALUES(${dailyPerformance.orders})`,
                    dailyAcos: sql`VALUES(${dailyPerformance.dailyAcos})`,
                    dailyRoas: sql`VALUES(${dailyPerformance.dailyRoas})`,
                    currency: sql`VALUES(${dailyPerformance.currency})`,
                    exchangeRate: sql`VALUES(${dailyPerformance.exchangeRate})`,
                    spendUsd: sql`VALUES(${dailyPerformance.spendUsd})`,
                    salesUsd: sql`VALUES(${dailyPerformance.salesUsd})`,
                  },
                });
              synced++;
            } catch (singleErr: unknown) {
              log.debug(`v423: 单条INSERT也失败: ${(singleErr as Error).message}`);
            }
          }
        }
      }
    }
    
    // 批量UPDATE - 使用CASE WHEN批量更新（按ID分组）
    if (toUpdate.length > 0) {
      const UPDATE_CHUNK = 100;
      for (let i = 0; i < toUpdate.length; i += UPDATE_CHUNK) {
        const chunk = toUpdate.slice(i, i + UPDATE_CHUNK);
        // 逐条更新但不再需要额外的raw SQL货币更新（已合并到perfData中）
        for (const item of chunk) {
          try {
            await db
              .update(dailyPerformance)
              .set(item.data as unknown)
              .where(eq(dailyPerformance.id, item.id));
            synced++;
          } catch (updateErr: unknown) {
            log.debug(`v423: UPDATE失败 id=${item.id}: ${(updateErr as Error).message}`);
          }
        }
      }
    }
    
    log.debug(`v423: 批量写入完成 - insert=${toInsert.length}, update=${toUpdate.length}, synced=${synced}`);
    return synced;
  } catch (err: unknown) {
    log.warn(`v423: flushPerfBatch失败: ${(err as Error).message}`);
    // 回退到逐条写入
    let synced = 0;
    for (const perfData of batch) {
      try {
        await db.insert(dailyPerformance).values({ ...perfData, createdAt: nowStr } as unknown)
          .onDuplicateKeyUpdate({
            set: {
              impressions: sql`VALUES(${dailyPerformance.impressions})`,
              clicks: sql`VALUES(${dailyPerformance.clicks})`,
              spend: sql`VALUES(${dailyPerformance.spend})`,
              sales: sql`VALUES(${dailyPerformance.sales})`,
              currency: sql`VALUES(${dailyPerformance.currency})`,
              exchangeRate: sql`VALUES(${dailyPerformance.exchangeRate})`,
              spendUsd: sql`VALUES(${dailyPerformance.spendUsd})`,
              salesUsd: sql`VALUES(${dailyPerformance.salesUsd})`,
            },
          });
        synced++;
      } catch (e: unknown) {
        // ignore individual failures
      }
    }
    return synced;
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
    
    for (const campaign of (accountCampaigns as unknown[])) {
      // v440: 命名物理隔离
      const { amazonId: amazonCampaignId } = extractCampaignIds(campaign, 'generateMockPerformanceData');
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
              eq(dailyPerformance.campaignId, amazonCampaignId),
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
    await service.updateCampaignPerformanceSummary();

    log.info(`模拟绩效数据生成完成: ${synced} 条记录`);
    return synced;
  } catch (error) {
    log.warn('生成模拟绩效数据失败:', error);
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
      
      if (totalImp === 0 && totalClk === 0) continue;
      
      // 周末调整
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      const dist = HOURLY_TRAFFIC.map(base => {
        if (isWeekend) return base * 0.7 + (1/24) * 0.3;
        return base;
      });
      const distSum = dist.reduce((a: unknown, b: unknown) => a + b, 0);
      
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
    log.warn('v195: generateHourlyFromDaily失败:', (error as Error).message);
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

    // v426: 收集新记录用于批量insert
    const toInsertPlacement: unknown[] = [];
    const nowStr = new Date().toISOString().slice(0, 19).replace('T', ' ');

    for (const row of (reportData as unknown[])) {
      // v364: 使用预查询Map替代循环内DB查询
      const campaign = campaignByIdMap.get(String(row.campaignId));

      if (!campaign) continue;

      // v440: 命名物理隔离
      const { amazonId: amazonCampaignId } = extractCampaignIds(campaign, 'syncPlacementPerformance');

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

      // v364: 使用预查询Map替代循环内DB查询
      const existing = existingPlacementMap.get(`${amazonCampaignId}|${placement}|${reportDate}`) || null;

      const cost = row.cost || 0;
      // SP广告位置报告使用7天归因窗口（与SP其他报告一致）
      const sales = row.sales7d || row.sales14d || 0;
      const clicks = row.clicks || 0;
      const impressions = row.impressions || 0;
      const orders = row.purchases7d || row.purchases14d || 0;

      const perfData = {
        campaignId: guardCampaignIdInsert(amazonCampaignId, 'placement_performance'),
        accountId: service.accountId,
        placement,
        date: reportDate,
        impressions,
        clicks,
        // v426: 统一精度
        spend: Number(cost).toFixed(2),
        sales: Number(sales).toFixed(2),
        orders,
        ctr: impressions > 0 ? (clicks / impressions).toFixed(4) : null,
        cpc: clicks > 0 ? (Number(cost) / clicks).toFixed(2) : null,
        cvr: clicks > 0 ? (orders / clicks).toFixed(4) : null,
        acos: Number(sales) > 0 ? ((Number(cost) / Number(sales)) * 100).toFixed(2) : null,
        roas: Number(cost) > 0 ? (Number(sales) / Number(cost)).toFixed(2) : null,
        updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      };

      if (existing) {
        await db
          .update(placementPerformance)
          .set(perfData)
          .where(eq(placementPerformance.id, existing.id));
        synced++;
      } else {
        toInsertPlacement.push({ ...perfData, createdAt: nowStr });
      }
    }

    // v426: 批量insert新记录
    const PLACEMENT_CHUNK = 200;
    for (let i = 0; i < toInsertPlacement.length; i += PLACEMENT_CHUNK) {
      const chunk = toInsertPlacement.slice(i, i + PLACEMENT_CHUNK);
      try {
        await db.insert(placementPerformance).values(chunk);
        synced += chunk.length;
      } catch (err) {
        log.warn(`v426: 批量insert失败(${chunk.length}条)，回退逐条: ${(err as Error).message}`);
        for (const item of chunk) {
          try {
            await db.insert(placementPerformance).values(item);
            synced++;
          } catch (e) {
            log.warn(`v426: 逐条insert失败: ${(e as Error).message}`);
          }
        }
      }
    }

    log.info(`v426: 位置绩效同步完成: synced=${synced}, inserted=${toInsertPlacement.length}`);
    return synced;
  } catch (error) {
    log.warn('同步位置绩效失败:', error);
    return 0;
  }
}


/**
 * v500.2: 更新campaigns表的绩效汇总数据
 * 数据来源：仅从dailyPerformance表聚合最近30天数据
 * 
 * 重要修复：
 * 1. 移除了从keywords/productTargets表回退聚合的逻辑（这些表的绩效字段是"最后一次同步时间段"的覆盖值，
 *    时间范围不确定，与dailyPerformance的30天聚合值不可比，混合使用会导致数据不一致）
 * 2. 添加了campaignId IS NOT NULL过滤，排除account-level汇总记录
 * 3. 如果dailyPerformance没有数据，campaigns的绩效字段保持为0，而不是从不可靠来源回退
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
    // v500.2: 添加campaignId IS NOT NULL过滤，排除account-level汇总记录
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
          sql`${dailyPerformance.campaignId} IS NOT NULL`,
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
    
    log.info(`v500.2批量汇总完成: ${dailySummaries.length}个campaign有绩效数据 (仅从dailyPerformance聚合)`);

    for (const campaign of (accountCampaigns as unknown[])) {
      // v364: 使用预查询Map替代循环内DB查询
      const dailySummary = dailySummaryMap.get(String(campaign.campaignId));

      // v500.2: 仅从dailyPerformance获取数据，不再回退到keywords/productTargets
      // 如果没有dailyPerformance数据，绩效字段保持为0
      const totalImpressions = dailySummary?.totalImpressions || 0;
      const totalClicks = dailySummary?.totalClicks || 0;
      const totalSpend = parseFloat(dailySummary?.totalSpend || '0');
      const totalSales = parseFloat(dailySummary?.totalSales || '0');
      const totalOrders = dailySummary?.totalOrders || 0;

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

    log.info(`广告活动绩效汇总更新完成 (仅dailyPerformance来源)`);
  } catch (error) {
    log.warn('更新广告活动绩效汇总失败:', error);
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
    log.warn('绩效数据同步失败:', error);
  }
  // v192: 同步关键词级别绩效数据（之前仅在syncAll中执行，导致keywords表绩效全为0）
  try {
    log.info(`开始同步关键词级别绩效数据（${days}天）...`);
    results.keywordPerf = await service.syncKeywordPerformanceData(days);
    log.info(`关键词绩效数据同步完成: ${results.keywordPerf}条`);
  } catch (kwPerfError: unknown) {
    log.warn('关键词绩效数据同步失败:', (kwPerfError as Error).message);
  }
  // v192: 同步商品定位级别绩效数据
  try {
    log.info(`开始同步商品定位级别绩效数据（${days}天）...`);
    results.targetPerf = await service.syncProductTargetPerformanceData(days);
    log.info(`商品定位绩效数据同步完成: ${results.targetPerf}条`);
  } catch (ptPerfError: unknown) {
    log.warn('商品定位绩效数据同步失败:', (ptPerfError as Error).message);
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
    
    for (const row of (reportData as unknown[])) {
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
        // v426: 统一精度
        spend: cost.toFixed(2),
        sales: sales.toFixed(2),
        orders,
        ctr: impressions > 0 ? (clicks / impressions).toFixed(4) : null,
        cpc: clicks > 0 ? (cost / clicks).toFixed(2) : null,
        cvr: clicks > 0 ? (orders / clicks).toFixed(4) : null,
        acos: sales > 0 ? ((cost / sales) * 100).toFixed(2) : null,
        roas: cost > 0 ? (sales / cost).toFixed(2) : null,
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
    log.warn('SB广告位绩效同步失败:', (error as Error).message);
  }
  return synced;
}


