/**
 * 广告组同步模块
 * 从 amazonSyncService.ts 拆分的独立模块
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
import type { AmazonAdsApiClient } from '../amazonAdsApi';

/** 同步服务上下文 - 从AmazonSyncService传入 */
export interface SyncContext {
  client: AmazonAdsApiClient;
  accountId: number;
  userId: number;
  marketplace: string;
}

const log = createModuleLogger('adGroupSync');

/**
 * 同步SP广告组
 * @param lastSyncTime 上次同步时间，用于增量同步
 */
export async function syncSpAdGroups(service: SyncContext,lastSyncTime?: string | null): Promise<number | { synced: number; skipped: number }> {
  const db = await getDb();
  if (!db) return { synced: 0, skipped: 0 };

  try {
    const apiAdGroups = await service.client.listSpAdGroups();
    let synced = 0;
    let skipped = 0;

    for (const apiAdGroup of apiAdGroups) {
      // 查找对应的campaign
      const [campaign] = await db
        .select()
        .from(campaigns)
        .where(
          and(
            eq(campaigns.accountId, service.accountId),
            eq(campaigns.campaignId, String(apiAdGroup.campaignId))
          )
        )
        .limit(1);

      if (!campaign) continue;

      // 检查是否已存在
      const [existing] = await db
        .select()
        .from(adGroups)
        .where(
          and(
            eq(adGroups.campaignId, String(campaign.campaignId)),
            eq(adGroups.adGroupId, String(apiAdGroup.adGroupId))
          )
        )
        .limit(1);

      // 增量同步：如果有上次同步时间且记录已存在，检查是否需要更新
      // v215修复: 移除错误的updatedAt跳过逻辑
      // 始终使用Amazon API返回的最新数据更新本地记录

      // Amazon API返回的state可能是大写的ENABLED/PAUSED/ARCHIVED，需要转换为小写
      const normalizedState = (apiAdGroup.state || 'enabled').toLowerCase() as 'enabled' | 'paused' | 'archived';
      
      const adGroupData = {
        campaignId: campaign.campaignId,
        accountId: service.accountId,
        adGroupId: String(apiAdGroup.adGroupId),
        adGroupName: apiAdGroup.name,
        adGroupStatus: normalizedState,
        defaultBid: String(apiAdGroup.defaultBid || 0),
        updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      };

      if (existing) {
        await db
          .update(adGroups)
          .set(adGroupData)
          .where(eq(adGroups.id, existing.id));
      } else {
        await db.insert(adGroups).values({
          ...adGroupData,
          createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
        });
      }
      synced++;
    }

    return { synced, skipped };
  } catch (error) {
    log.error('Error syncing SP ad groups:', error);
    return { synced: 0, skipped: 0 };
  }
}


/**
 * 同步SB品牌广告组
 * 从Amazon SB API获取广告组列表并同步到本地数据库
 */
export async function syncSbAdGroups(service: SyncContext,): Promise<{ synced: number; skipped: number }> {
  const db = await getDb();
  if (!db) return { synced: 0, skipped: 0 };

  try {
    const apiAdGroups = await service.client.listSbAdGroups();
    let synced = 0;
    let skipped = 0;

    log.debug(`获取到 ${apiAdGroups.length} 个SB广告组`);

    for (const apiAdGroup of apiAdGroups) {
      // 查找对应的campaign
      const [campaign] = await db
        .select()
        .from(campaigns)
        .where(
          and(
            eq(campaigns.accountId, service.accountId),
            eq(campaigns.campaignId, String(apiAdGroup.campaignId))
          )
        )
        .limit(1);

      if (!campaign) continue;

      // 检查是否已存在
      const [existing] = await db
        .select()
        .from(adGroups)
        .where(
          and(
            eq(adGroups.campaignId, String(campaign.campaignId)),
            eq(adGroups.adGroupId, String(apiAdGroup.adGroupId))
          )
        )
        .limit(1);

      const normalizedState = (apiAdGroup.state || 'enabled').toLowerCase() as 'enabled' | 'paused' | 'archived';

      const adGroupData = {
        campaignId: campaign.campaignId,
        accountId: service.accountId,
        adGroupId: String(apiAdGroup.adGroupId),
        adGroupName: apiAdGroup.name || apiAdGroup.adGroupName || 'SB Ad Group',
        adGroupStatus: normalizedState,
        defaultBid: String(apiAdGroup.bid || apiAdGroup.defaultBid || 0),
        creativeType: apiAdGroup.creativeType || null,
        updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      };

      if (existing) {
        await db
          .update(adGroups)
          .set(adGroupData)
          .where(eq(adGroups.id, existing.id));
      } else {
        await db.insert(adGroups).values({
          ...adGroupData,
          createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
        });
      }
      synced++;
    }

    log.info(`SB广告组同步完成: synced=${synced}, skipped=${skipped}`);
    return { synced, skipped };
  } catch (error) {
    log.error('Error syncing SB ad groups:', error);
    return { synced: 0, skipped: 0 };
  }
}


/**
 * 同步SD展示广告组
 * 从Amazon SD API获取广告组列表并同步到本地数据库
 */
export async function syncSdAdGroups(service: SyncContext,): Promise<{ synced: number; skipped: number }> {
  const db = await getDb();
  if (!db) return { synced: 0, skipped: 0 };

  try {
    const apiAdGroups = await service.client.listSdAdGroups();
    let synced = 0;
    let skipped = 0;

    log.debug(`获取到 ${apiAdGroups.length} 个SD广告组`);

    for (const apiAdGroup of apiAdGroups) {
      // 查找对应的campaign
      const [campaign] = await db
        .select()
        .from(campaigns)
        .where(
          and(
            eq(campaigns.accountId, service.accountId),
            eq(campaigns.campaignId, String(apiAdGroup.campaignId))
          )
        )
        .limit(1);

      if (!campaign) continue;

      // 检查是否已存在
      const [existing] = await db
        .select()
        .from(adGroups)
        .where(
          and(
            eq(adGroups.campaignId, String(campaign.campaignId)),
            eq(adGroups.adGroupId, String(apiAdGroup.adGroupId))
          )
        )
        .limit(1);

      const normalizedState = (apiAdGroup.state || 'enabled').toLowerCase() as 'enabled' | 'paused' | 'archived';

      // SD广告组可能有tactic字段（如T00020 = 受众定向, T00030 = 商品定向）
      const tactic = apiAdGroup.tactic || null;

      const adGroupData = {
        campaignId: campaign.campaignId,
        accountId: service.accountId,
        adGroupId: String(apiAdGroup.adGroupId),
        adGroupName: apiAdGroup.name || apiAdGroup.adGroupName || 'SD Ad Group',
        adGroupStatus: normalizedState,
        defaultBid: String(apiAdGroup.defaultBid || apiAdGroup.bid || 0),
        tactic: tactic,
        updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      };

      if (existing) {
        await db
          .update(adGroups)
          .set(adGroupData)
          .where(eq(adGroups.id, existing.id));
      } else {
        await db.insert(adGroups).values({
          ...adGroupData,
          createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
        });
      }
      synced++;
    }

    log.info(`SD广告组同步完成: synced=${synced}, skipped=${skipped}`);
    return { synced, skipped };
  } catch (error) {
    log.error('Error syncing SD ad groups:', error);
    return { synced: 0, skipped: 0 };
  }
}


/**
 * 同步广告组和定位数据（中频同步）
 * 用于获取广告组、关键词和商品定位的变化
 */
export async function syncAdGroupsAndTargeting(service: SyncContext,): Promise<{
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
    log.error('SP广告组同步失败:', (e as Error).message);
  }

  try {
    const sbAdGroupResult = await service.syncSbAdGroups();
    results.adGroups += sbAdGroupResult.synced;
  } catch (e: unknown) {
    log.error('SB广告组同步失败:', (e as Error).message);
  }

  try {
    const sdAdGroupResult = await service.syncSdAdGroups();
    results.adGroups += sdAdGroupResult.synced;
  } catch (e: unknown) {
    log.error('SD广告组同步失败:', (e as Error).message);
  }
  
  // ==================== 同步关键词投放（SP + SB） ====================
  try {
    const spKeywordResult = await service.syncSpKeywords();
    results.keywords += typeof spKeywordResult === 'number' ? spKeywordResult : spKeywordResult.synced;
  } catch (e: unknown) {
    log.error('SP关键词同步失败:', (e as Error).message);
  }

  try {
    const sbKeywordResult = await service.syncSbKeywords();
    results.keywords += sbKeywordResult.synced;
  } catch (e: unknown) {
    log.error('SB关键词同步失败:', (e as Error).message);
  }
  
  // ==================== 同步商品定位（SP + SB + SD） ====================
  try {
    const spTargetResult = await service.syncSpProductTargets();
    results.targets += typeof spTargetResult === 'number' ? spTargetResult : spTargetResult.synced;
  } catch (e: unknown) {
    log.error('SP商品定位同步失败:', (e as Error).message);
  }

  try {
    const sbTargetResult = await service.syncSbProductTargets();
    results.targets += sbTargetResult.synced;
  } catch (e: unknown) {
    log.error('SB商品定位同步失败:', (e as Error).message);
  }

  try {
    const sdTargetResult = await service.syncSdProductTargets();
    results.targets += sdTargetResult.synced;
  } catch (e: unknown) {
    log.error('SD商品定位同步失败:', (e as Error).message);
  }

  // v196: 中频同步时同时同步搜索词数据（7天窗口），确保搜索词数据不滞后
  try {
    log.info(`v196: 中频同步 - 开始同步SP搜索词数据(7天)...`);
    const spSearchTermSynced = await service.syncSearchTerms(7);
    log.info(`v196: 中频同步 - SP搜索词同步完成: ${spSearchTermSynced}条`);
  } catch (e: unknown) {
    log.error('v196: 中频同步 - SP搜索词同步失败:', (e as Error).message);
  }

  log.info(`全渠道广告组和定位同步完成: 广告组=${results.adGroups}, 关键词=${results.keywords}, 定位=${results.targets}`);

  return results;
}


/**
 * 同步广告组绩效数据
 * 通过SP/SB/SD广告组报告获取广告组级别的绩效数据
 * 并写入adGroups表的绩效字段（impressions/clicks/spend/sales/orders/ctr/cvr/acos/roas/cpc等）
 * 
 * 归因窗口: SP=7天, SB/SD=14天
 */
export async function syncAdGroupPerformanceData(service: SyncContext,days: number = 14): Promise<number> {
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

    // 1. SP广告组报告（7天归因）
    if (spCampaigns.length > 0) {
      try {
        const { startDate: spStart, endDate: spEnd } = getMarketplaceDateRange(service.marketplace, 7);
        const spReportId = await service.client.requestSpAdGroupReport(spStart, spEnd);
        const spData = await service.client.waitAndDownloadReport(spReportId);
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
        const sbReportId = await service.client.requestSbAdGroupReport(startDate, endDate);
        const sbData = await service.client.waitAndDownloadReport(sbReportId);
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
        const sdReportId = await service.client.requestSdAdGroupReport(startDate, endDate);
        const sdData = await service.client.waitAndDownloadReport(sdReportId);
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
}


