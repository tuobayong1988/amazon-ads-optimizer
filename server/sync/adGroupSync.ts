/**
 * 广告组同步模块
 * 从 amazonSyncService.ts 拆分的独立模块
 * v426: 消除N+1查询瓶颈 — 预加载campaigns和adGroups到Map中
 */
import { eq, and, sql, gte, inArray } from 'drizzle-orm';
import { getDb } from '../db';
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

/** 同步服务上下文 - 从AmazonSyncService传入 */
export interface SyncContext {
  client: AmazonAdsApiClient;
  accountId: number;
  userId: number;
  marketplace: string;
}

const log = createModuleLogger('adGroupSync');

// v426: 批量UPSERT的分块大小
const UPSERT_CHUNK_SIZE = 200;

/**
 * v426: 预加载账户的所有campaigns到Map中（amazonCampaignId -> campaign）
 * 消除循环内逐条查询campaign的N+1问题
 */
async function preloadCampaignMap(db: unknown, accountId: number): Promise<Map<string, { id: number; campaignId: string }>> {
  const allCampaigns = await db
    .select({ id: campaigns.id, campaignId: campaigns.campaignId })
    .from(campaigns)
    .where(eq(campaigns.accountId, accountId));
  
  const map = new Map<string, { id: number; campaignId: string }>();
  for (const c of allCampaigns) {
    map.set(String(c.campaignId), c);
  }
  return map;
}

/**
 * v426: 预加载账户的所有adGroups到Map中（campaignId:adGroupId -> adGroup）
 * 消除循环内逐条查询existing adGroup的N+1问题
 */
async function preloadAdGroupMap(db: unknown, accountId: number): Promise<Map<string, { id: number; campaignId: string; adGroupId: string }>> {
  const allAdGroups = await db
    .select({ id: adGroups.id, campaignId: adGroups.campaignId, adGroupId: adGroups.adGroupId })
    .from(adGroups)
    .where(eq(adGroups.accountId, accountId));
  
  const map = new Map<string, { id: number; campaignId: string; adGroupId: string }>();
  for (const ag of allAdGroups) {
    map.set(`${ag.campaignId}:${ag.adGroupId}`, ag);
  }
  return map;
}

/**
 * 同步SP广告组
 * v426: 消除N+1查询 — 预加载campaigns和adGroups，批量UPSERT
 * @param lastSyncTime 上次同步时间，用于增量同步
 */
export async function syncSpAdGroups(service: SyncContext, lastSyncTime?: string | null): Promise<number | { synced: number; skipped: number }> {
  const db = await getDb();
  if (!db) return { synced: 0, skipped: 0 };

  try {
    const apiAdGroups = await service.client.listSpAdGroups();
    let synced = 0;
    let skipped = 0;

    // v426: 预加载所有campaigns和adGroups（2次查询替代 2*N 次查询）
    const campaignMap = await preloadCampaignMap(db, service.accountId);
    const adGroupMap = await preloadAdGroupMap(db, service.accountId);
    
    const nowStr = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const toInsert: unknown[] = [];
    const toUpdate: Array<{ id: number; data: unknown }> = [];

    for (const apiAdGroup of apiAdGroups) {
      // v426: O(1) Map查找替代数据库查询
      const campaign = campaignMap.get(String(apiAdGroup.campaignId));
      if (!campaign) continue;

      const existingKey = `${campaign.campaignId}:${String(apiAdGroup.adGroupId)}`;
      const existing = adGroupMap.get(existingKey);

      const normalizedState = (apiAdGroup.state || 'enabled').toLowerCase() as 'enabled' | 'paused' | 'archived';
      
      const adGroupData = {
        campaignId: campaign.campaignId,
        accountId: service.accountId,
        adGroupId: String(apiAdGroup.adGroupId),
        adGroupName: apiAdGroup.name,
        adGroupStatus: normalizedState,
        defaultBid: String(apiAdGroup.defaultBid || 0),
        updatedAt: nowStr,
      };

      if (existing) {
        toUpdate.push({ id: existing.id, data: adGroupData });
      } else {
        toInsert.push({
          ...adGroupData,
          createdAt: nowStr,
        });
      }
      synced++;
    }

    // v426: 批量insert
    for (let i = 0; i < toInsert.length; i += UPSERT_CHUNK_SIZE) {
      const chunk = toInsert.slice(i, i + UPSERT_CHUNK_SIZE);
      await db.insert(adGroups).values(chunk);
    }

    // v426: 批量update（逐条但不再有额外的SELECT查询）
    for (const item of toUpdate) {
      await db.update(adGroups).set(item.data).where(eq(adGroups.id, item.id));
    }

    log.info(`SP广告组同步完成: synced=${synced}, inserted=${toInsert.length}, updated=${toUpdate.length}, skipped=${skipped}`);
    return { synced, skipped };
  } catch (error) {
    log.warn('Error syncing SP ad groups:', error);
    return { synced: 0, skipped: 0 };
  }
}


/**
 * 同步SB品牌广告组
 * v426: 消除N+1查询 — 预加载campaigns和adGroups，批量UPSERT
 */
export async function syncSbAdGroups(service: SyncContext): Promise<{ synced: number; skipped: number }> {
  const db = await getDb();
  if (!db) return { synced: 0, skipped: 0 };

  try {
    const apiAdGroups = await service.client.listSbAdGroups();
    let synced = 0;
    let skipped = 0;

    log.debug(`获取到 ${apiAdGroups.length} 个SB广告组`);

    // v426: 预加载
    const campaignMap = await preloadCampaignMap(db, service.accountId);
    const adGroupMap = await preloadAdGroupMap(db, service.accountId);
    
    const nowStr = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const toInsert: unknown[] = [];
    const toUpdate: Array<{ id: number; data: unknown }> = [];

    for (const apiAdGroup of apiAdGroups) {
      const campaign = campaignMap.get(String(apiAdGroup.campaignId));
      if (!campaign) continue;

      const existingKey = `${campaign.campaignId}:${String(apiAdGroup.adGroupId)}`;
      const existing = adGroupMap.get(existingKey);

      const normalizedState = (apiAdGroup.state || 'enabled').toLowerCase() as 'enabled' | 'paused' | 'archived';

      const adGroupData = {
        campaignId: campaign.campaignId,
        accountId: service.accountId,
        adGroupId: String(apiAdGroup.adGroupId),
        adGroupName: apiAdGroup.name || apiAdGroup.adGroupName || 'SB Ad Group',
        adGroupStatus: normalizedState,
        defaultBid: String(apiAdGroup.bid || apiAdGroup.defaultBid || 0),
        creativeType: apiAdGroup.creativeType || null,
        updatedAt: nowStr,
      };

      if (existing) {
        toUpdate.push({ id: existing.id, data: adGroupData });
      } else {
        toInsert.push({
          ...adGroupData,
          createdAt: nowStr,
        });
      }
      synced++;
    }

    // v426: 批量insert
    for (let i = 0; i < toInsert.length; i += UPSERT_CHUNK_SIZE) {
      const chunk = toInsert.slice(i, i + UPSERT_CHUNK_SIZE);
      await db.insert(adGroups).values(chunk);
    }

    for (const item of toUpdate) {
      await db.update(adGroups).set(item.data).where(eq(adGroups.id, item.id));
    }

    log.info(`SB广告组同步完成: synced=${synced}, inserted=${toInsert.length}, updated=${toUpdate.length}, skipped=${skipped}`);
    return { synced, skipped };
  } catch (error) {
    log.warn('Error syncing SB ad groups:', error);
    return { synced: 0, skipped: 0 };
  }
}


/**
 * 同步SD展示广告组
 * v426: 消除N+1查询 — 预加载campaigns和adGroups，批量UPSERT
 */
export async function syncSdAdGroups(service: SyncContext): Promise<{ synced: number; skipped: number }> {
  const db = await getDb();
  if (!db) return { synced: 0, skipped: 0 };

  try {
    const apiAdGroups = await service.client.listSdAdGroups();
    let synced = 0;
    let skipped = 0;

    log.debug(`获取到 ${apiAdGroups.length} 个SD广告组`);

    // v426: 预加载
    const campaignMap = await preloadCampaignMap(db, service.accountId);
    const adGroupMap = await preloadAdGroupMap(db, service.accountId);
    
    const nowStr = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const toInsert: unknown[] = [];
    const toUpdate: Array<{ id: number; data: unknown }> = [];

    for (const apiAdGroup of apiAdGroups) {
      const campaign = campaignMap.get(String(apiAdGroup.campaignId));
      if (!campaign) continue;

      const existingKey = `${campaign.campaignId}:${String(apiAdGroup.adGroupId)}`;
      const existing = adGroupMap.get(existingKey);

      const normalizedState = (apiAdGroup.state || 'enabled').toLowerCase() as 'enabled' | 'paused' | 'archived';
      const tactic = apiAdGroup.tactic || null;

      const adGroupData = {
        campaignId: campaign.campaignId,
        accountId: service.accountId,
        adGroupId: String(apiAdGroup.adGroupId),
        adGroupName: apiAdGroup.name || apiAdGroup.adGroupName || 'SD Ad Group',
        adGroupStatus: normalizedState,
        defaultBid: String(apiAdGroup.defaultBid || apiAdGroup.bid || 0),
        tactic: tactic,
        updatedAt: nowStr,
      };

      if (existing) {
        toUpdate.push({ id: existing.id, data: adGroupData });
      } else {
        toInsert.push({
          ...adGroupData,
          createdAt: nowStr,
        });
      }
      synced++;
    }

    // v426: 批量insert
    for (let i = 0; i < toInsert.length; i += UPSERT_CHUNK_SIZE) {
      const chunk = toInsert.slice(i, i + UPSERT_CHUNK_SIZE);
      await db.insert(adGroups).values(chunk);
    }

    for (const item of toUpdate) {
      await db.update(adGroups).set(item.data).where(eq(adGroups.id, item.id));
    }

    log.info(`SD广告组同步完成: synced=${synced}, inserted=${toInsert.length}, updated=${toUpdate.length}, skipped=${skipped}`);
    return { synced, skipped };
  } catch (error) {
    log.warn('Error syncing SD ad groups:', error);
    return { synced: 0, skipped: 0 };
  }
}


// v426: 导入时区工具
import { getMarketplaceDateRange } from '../utils/timezone';

/**
 * 同步广告组和定位数据（中频同步）
 * 用于获取广告组、关键词和商品定位的变化
 */
export async function syncAdGroupsAndTargeting(service: SyncContext): Promise<{
  adGroups: number;
  keywords: number;
  targets: number;
}> {
  const results = {
    adGroups: 0,
    keywords: 0,
    targets: 0,
  };

  // v190: 每个同步操作独立try-catch，一个失败不影响其他
  // ==================== 同步广告组（SP + SB + SD） ====================
  try {
    const spAdGroupResult = await service.syncSpAdGroups();
    results.adGroups += typeof spAdGroupResult === 'number' ? spAdGroupResult : spAdGroupResult.synced;
  } catch (e: unknown) {
    log.warn('SP广告组同步失败:', (e as Error).message);
  }

  try {
    const sbAdGroupResult = await service.syncSbAdGroups();
    results.adGroups += sbAdGroupResult.synced;
  } catch (e: unknown) {
    log.warn('SB广告组同步失败:', (e as Error).message);
  }

  try {
    const sdAdGroupResult = await service.syncSdAdGroups();
    results.adGroups += sdAdGroupResult.synced;
  } catch (e: unknown) {
    log.warn('SD广告组同步失败:', (e as Error).message);
  }
  
  // ==================== 同步关键词投放（SP + SB） ====================
  try {
    const spKeywordResult = await service.syncSpKeywords();
    results.keywords += typeof spKeywordResult === 'number' ? spKeywordResult : spKeywordResult.synced;
  } catch (e: unknown) {
    log.warn('SP关键词同步失败:', (e as Error).message);
  }

  try {
    const sbKeywordResult = await service.syncSbKeywords();
    results.keywords += sbKeywordResult.synced;
  } catch (e: unknown) {
    log.warn('SB关键词同步失败:', (e as Error).message);
  }
  
  // ==================== 同步商品定位（SP + SB + SD） ====================
  try {
    const spTargetResult = await service.syncSpProductTargets();
    results.targets += typeof spTargetResult === 'number' ? spTargetResult : spTargetResult.synced;
  } catch (e: unknown) {
    log.warn('SP商品定位同步失败:', (e as Error).message);
  }

  try {
    const sbTargetResult = await service.syncSbProductTargets();
    results.targets += sbTargetResult.synced;
  } catch (e: unknown) {
    log.warn('SB商品定位同步失败:', (e as Error).message);
  }

  try {
    const sdTargetResult = await service.syncSdProductTargets();
    results.targets += sdTargetResult.synced;
  } catch (e: unknown) {
    log.warn('SD商品定位同步失败:', (e as Error).message);
  }

  // v196: 中频同步时同时同步搜索词数据（7天窗口），确保搜索词数据不滞后
  try {
    log.info(`v196: 中频同步 - 开始同步SP搜索词数据(7天)...`);
    const spSearchTermSynced = await service.syncSearchTerms(7);
    log.info(`v196: 中频同步 - SP搜索词同步完成: ${spSearchTermSynced}条`);
  } catch (e: unknown) {
    log.warn('v196: 中频同步 - SP搜索词同步失败:', (e as Error).message);
  }

  log.info(`全渠道广告组和定位同步完成: 广告组=${results.adGroups}, 关键词=${results.keywords}, 定位=${results.targets}`);

  return results;
}


/**
 * 同步广告组绩效数据
 * v426: 消除N+1查询 — 预加载adGroups到Map中，使用数值类型存储绩效数据
 * 
 * 归因窗口: SP=7天, SB/SD=14天
 */
export async function syncAdGroupPerformanceData(service: SyncContext, days: number = 14): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  let synced = 0;
  try {
    const { startDate, endDate } = getMarketplaceDateRange(service.marketplace, days);
    log.info(`开始同步广告组绩效数据: ${startDate} - ${endDate} (站点: ${service.marketplace})`);

    // 获取该账户下所有广告活动
    const accountCampaigns = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.accountId, service.accountId));

    // 按广告类型分组
    const spCampaigns = accountCampaigns.filter(c => c.campaignType === 'sp_auto' || c.campaignType === 'sp_manual');
    const sbCampaigns = accountCampaigns.filter(c => c.campaignType === 'sb');
    const sdCampaigns = accountCampaigns.filter(c => c.campaignType === 'sd');

    // v426: 预加载所有adGroups到Map中（adGroupId -> adGroup），消除N+1查询
    const allAdGroups = await db
      .select({ id: adGroups.id, adGroupId: adGroups.adGroupId })
      .from(adGroups)
      .where(eq(adGroups.accountId, service.accountId));
    const adGroupIdMap = new Map<string, { id: number; adGroupId: string }>();
    for (const ag of allAdGroups) {
      adGroupIdMap.set(ag.adGroupId, ag);
    }

    // v413: 批量提交SP/SB/SD广告组报告 + 统一轮询
    const { startDate: spStart, endDate: spEnd } = getMarketplaceDateRange(service.marketplace, 7);
    const reportRequests: Array<{ name: string; requestFn: () => Promise<string> }> = [];
    if (spCampaigns.length > 0) {
      reportRequests.push({ name: 'SP广告组', requestFn: () => service.client.requestSpAdGroupReport(spStart, spEnd) });
    }
    if (sbCampaigns.length > 0) {
      reportRequests.push({ name: 'SB广告组', requestFn: () => service.client.requestSbAdGroupReport(startDate, endDate) });
    }
    if (sdCampaigns.length > 0) {
      reportRequests.push({ name: 'SD广告组', requestFn: () => service.client.requestSdAdGroupReport(startDate, endDate) });
    }
    
    log.info(`[v413] 广告组报告批量提交: ${reportRequests.map(r => r.name).join(', ')}`);
    // v676: 全量同步时跳过P5异步模式，强制同步等待
    const adGroupReportTimeout = service._reportWaitTimeoutMs || 600000;
    const reportResults = reportRequests.length > 0
      ? (process.env.P5_ASYNC_REPORTS === 'true' && !service._forceSync
          ? (await service.client.submitReportsToAsyncQueue(reportRequests, { accountId: service.accountId, syncType: 'ad_group_sync' })).results.map(r => ({ name: r.name, data: r.data as Record<string, unknown>[] | null, error: r.error }))
          : await service.client.submitAndWaitMultipleReports(reportRequests, adGroupReportTimeout, 2000))
      : [];

    /**
     * v426: 统一的绩效数据处理函数
     * 消除了三段重复代码，同时使用预加载的Map消除N+1查询
     */
    function processAdGroupReport(
      data: unknown[],
      adType: 'SP' | 'SB' | 'SD',
      salesField: string,
      ordersField: string,
    ): Array<{ id: number; data: unknown }> {
      const updates: Array<{ id: number; data: unknown }> = [];
      for (const row of data) {
        const adGroupId = String(row.adGroupId);
        // v426: O(1) Map查找替代数据库查询
        const adGroup = adGroupIdMap.get(adGroupId);
        if (!adGroup) continue;

        const cost = Number(row.cost || 0);
        const sales = Number(row[salesField] || 0);
        const orders = Number(row[ordersField] || 0);
        const impressions = Number(row.impressions || 0);
        const clicks = Number(row.clicks || 0);

        const perfData: unknown = {
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
        };

        // SB/SD额外字段
        if (adType === 'SB' || adType === 'SD') {
          perfData.dpv = Number(row.dpv14d || 0);
          perfData.ntbOrders = Number(row.attributedOrdersNewToBrand14d || 0);
          perfData.ntbSales = String(Number(row.attributedSalesNewToBrand14d || 0));
        }
        if (adType === 'SD') {
          perfData.viewAttributedSales = String(Number(row.viewAttributedSales14d || 0));
          perfData.viewAttributedOrders = Number(row.viewAttributedUnitsOrdered14d || 0);
        }

        updates.push({ id: adGroup.id, data: perfData });
      }
      return updates;
    }

    // 处理SP报告结果
    let resultIdx = 0;
    if (spCampaigns.length > 0) {
      const spResult = reportResults[resultIdx++];
      if (spResult?.data && spResult.data.length > 0) {
        const updates = processAdGroupReport(spResult.data, 'SP', 'sales7d', 'purchases7d');
        for (const item of updates) {
          await db.update(adGroups).set(item.data).where(eq(adGroups.id, item.id));
        }
        synced += updates.length;
        log.info(`SP广告组绩效同步: ${updates.length} 条记录`);
      } else if (spResult?.error) {
        log.warn('SP广告组绩效同步失败:', spResult.error);
      }
    }

    // 处理SB报告结果
    if (sbCampaigns.length > 0) {
      const sbResult = reportResults[resultIdx++];
      if (sbResult?.data && sbResult.data.length > 0) {
        const updates = processAdGroupReport(sbResult.data, 'SB', 'salesClicks14d', 'purchasesClicks14d');
        for (const item of updates) {
          await db.update(adGroups).set(item.data).where(eq(adGroups.id, item.id));
        }
        synced += updates.length;
        log.info(`SB广告组绩效同步: ${updates.length} 条记录`);
      } else if (sbResult?.error) {
        log.warn('SB广告组绩效同步失败:', sbResult.error);
      }
    }

    // 处理SD报告结果
    if (sdCampaigns.length > 0) {
      const sdResult = reportResults[resultIdx++];
      if (sdResult?.data && sdResult.data.length > 0) {
        const updates = processAdGroupReport(sdResult.data, 'SD', 'sales14d', 'purchases14d');
        for (const item of updates) {
          await db.update(adGroups).set(item.data).where(eq(adGroups.id, item.id));
        }
        synced += updates.length;
        log.info(`SD广告组绩效同步: ${updates.length} 条记录`);
      } else if (sdResult?.error) {
        log.warn('SD广告组绩效同步失败:', sdResult.error);
      }
    }

    log.info(`广告组绩效同步完成: 共 ${synced} 条记录`);
    return synced;
  } catch (error) {
    log.warn('广告组绩效同步失败:', error);
    return synced;
  }
}
