/**
 * 定位同步模块
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
import type { AmazonAdsApiClient } from './amazonAdsApi';

/** 同步服务上下文 - 从AmazonSyncService传入 */
export interface SyncContext {
  client: AmazonAdsApiClient;
  accountId: number;
  userId: number;
  marketplace: string;
}

const log = createModuleLogger('targetingSync');

/**
 * 同步SP自动定向数据
 * 获取自动广告的匹配组数据（紧密匹配、宽泛匹配、同类商品、关联商品）
 */
export async function syncAutoTargeting(service: SyncContext,days: number = 14): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  try {
    const { startDate, endDate } = getMarketplaceDateRange(service.marketplace, days);
    log.info(`开始同步自动定向数据: ${startDate} - ${endDate}`);

    // 请求SP自动定向报告
    const reportId = await service.client.requestSpAutoTargetingReport(startDate, endDate);
    const reportData = await service.client.waitAndDownloadReport(reportId, 300000);

    if (!reportData || reportData.length === 0) {
      log.debug('自动定向报告数据为空');
      return 0;
    }

    log.debug(`获取到 ${reportData.length} 条自动定向数据`);
    let synced = 0;

    for (const row of (reportData as unknown[])) {
      // 只处理自动定向数据
      if (row.targetingType !== 'AUTO') continue;

      // 查找对应的adGroup
      const [adGroup] = await db
        .select()
        .from(adGroups)
        .where(eq(adGroups.adGroupId, String(row.adGroupId)))
        .limit(1);

      if (!adGroup) continue;

      // 检查是否已存在
      const [existing] = await db
        .select()
        .from(productTargets)
        .where(
          and(
            eq(productTargets.internalAdGroupId, adGroup.id),
            eq(productTargets.targetId, String(row.targetId))
          )
        )
        .limit(1);

      const cost = row.cost || 0;
      // 自动定向报告使用14天归因窗口（SB/SD类型）
      const sales = row.sales14d || row.salesClicks14d || 0;
      const clicks = row.clicks || 0;
      const impressions = row.impressions || 0;
      const orders = row.purchases14d || row.purchasesClicks14d || 0;

      // 解析自动定向类型
      const targetingExpression = row.targetingExpression || '';
      let targetType: 'asin' | 'category' = 'category';
      let targetValue = targetingExpression;
      
      // 自动定向类型: close-match, loose-match, substitutes, complements
      if (targetingExpression.includes('close-match')) {
        targetValue = 'CLOSE_MATCH';
      } else if (targetingExpression.includes('loose-match')) {
        targetValue = 'LOOSE_MATCH';
      } else if (targetingExpression.includes('substitutes')) {
        targetValue = 'SUBSTITUTES';
      } else if (targetingExpression.includes('complements')) {
        targetValue = 'COMPLEMENTS';
      }

      const targetData = {
        internalAdGroupId: adGroup.id,
        campaignId: adGroup.campaignId,
        targetId: String(row.targetId),
        targetType,
        targetValue,
        targetExpression: targetingExpression,
        bid: '0.00', // 自动定向没有单独的出价
        impressions,
        clicks,
        spend: String(cost),
        sales: String(sales),
        orders,
        targetAcos: sales > 0 ? String(((cost / sales) * 100).toFixed(2)) : null,
        targetRoas: cost > 0 && sales > 0 ? String((sales / cost).toFixed(2)) : null,
        targetCtr: impressions > 0 ? String((clicks / impressions).toFixed(4)) : null,
        targetCvr: clicks > 0 ? String((orders / clicks).toFixed(4)) : null,
        targetCpc: clicks > 0 ? String((cost / clicks).toFixed(2)) : null,
        targetStatus: 'enabled' as const,
        updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      };

      if (existing) {
        await db
          .update(productTargets)
          .set(targetData)
          .where(eq(productTargets.id, existing.id));
      } else {
        await db.insert(productTargets).values({
          ...targetData,
          createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
        });
      }
      synced++;
    }

    log.info(`自动定向同步完成: ${synced} 条记录`);

    // v512: 通过SP Targeting List API获取自动广告匹配对象的真实bid
    // 报告API不返回bid，但List API返回真实的bid值
    try {
      log.info('[v512] 开始通过SP Targeting List API回填自动广告匹配对象的真实bid...');
      let bidUpdated = 0;
      
      // 获取所有自动广告活动的adGroup
      const autoCampaigns = await db
        .select({ campaignId: campaigns.campaignId })
        .from(campaigns)
        .where(
          and(
            eq(campaigns.accountId, service.accountId),
            sql`${campaigns.campaignType} LIKE '%auto%'`
          )
        );
      
      for (const camp of autoCampaigns) {
        const campAdGroups = await db
          .select({ id: adGroups.id, adGroupId: adGroups.adGroupId })
          .from(adGroups)
          .where(eq(adGroups.campaignId, camp.campaignId));
        
        for (const ag of campAdGroups) {
          try {
            // 调用SP Targeting List API获取该adGroup下所有targets的真实bid
            const apiTargets = await service.client.listSpProductTargets(Number(ag.adGroupId));
            
            for (const apiTarget of apiTargets) {
              // 只处理自动定向类型(expressionType === 'auto')
              if (apiTarget.expressionType !== 'auto') continue;
              if (apiTarget.bid <= 0) continue;
              
              // 通过targetId匹配本地记录并更新bid
              const [localTarget] = await db
                .select()
                .from(productTargets)
                .where(
                  and(
                    eq(productTargets.internalAdGroupId, ag.id),
                    eq(productTargets.targetId, String(apiTarget.targetId))
                  )
                )
                .limit(1);
              
              if (localTarget && (localTarget.bid === '0.00' || localTarget.bid === '0' || !localTarget.bid)) {
                await db
                  .update(productTargets)
                  .set({ bid: apiTarget.bid.toFixed(2) })
                  .where(eq(productTargets.id, localTarget.id));
                bidUpdated++;
              }
            }
          } catch (agErr) {
            log.debug(`[v512] 获取adGroup ${ag.adGroupId} 的自动定向bid失败: ${(agErr as Error).message}`);
          }
        }
      }
      
      log.info(`[v512] 自动广告匹配对象bid回填完成: ${bidUpdated} 条更新`);
    } catch (bidErr) {
      log.warn(`[v512] 自动广告bid回填失败(不影响主流程): ${(bidErr as Error).message}`);
    }

    return synced;
  } catch (error) {
    log.warn('同步自动定向失败:', error);
    return 0;
  }
}


/**
 * 同步SD定向数据
 * 获取SD广告的受众定向和商品定向数据
 */
export async function syncSdTargeting(service: SyncContext,days: number = 14): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  try {
    const { startDate, endDate } = getMarketplaceDateRange(service.marketplace, days);
    log.info(`开始同步SD定向数据: ${startDate} - ${endDate}`);

    // 请求SD定向报告
    const reportId = await service.client.requestSdTargetingReport(startDate, endDate);
    const reportData = await service.client.waitAndDownloadReport(reportId, 300000);

    if (!reportData || reportData.length === 0) {
      log.debug('SD定向报告数据为空');
      return 0;
    }

    log.debug(`获取到 ${reportData.length} 条SD定向数据`);
    let synced = 0;

    // v422: 修复 - SD报告中没有targetId字段，只有targetingText
    // 需要通过adGroupId+targetingText匹配已有记录
    for (const row of (reportData as unknown[])) {
      // 查找对应的adGroup
      const [adGroup] = await db
        .select()
        .from(adGroups)
        .where(eq(adGroups.adGroupId, String(row.adGroupId)))
        .limit(1);

      if (!adGroup) continue;

      // v422: 修复字段名 - SD报告返回的是targetingText，不是targetingExpression
      const targetingText = row.targetingText || '';

      // v422: 通过targetExpression或targetValue匹配已有记录
      let targetType: 'asin' | 'category' = 'category';
      let targetValue = targetingText;
      if (targetingText.includes('asin')) {
        targetType = 'asin';
        const asinMatch = targetingText.match(/asin="([^"]+)"/);
        if (asinMatch) targetValue = asinMatch[1];
      }

      // v422: 通过targetExpression或targetValue查找已有记录
      const existingRows = await db
        .select()
        .from(productTargets)
        .where(
          and(
            eq(productTargets.internalAdGroupId, adGroup.id),
            eq(productTargets.targetExpression, targetingText)
          )
        )
        .limit(1);
      const existing = existingRows[0] || null;

      const clickSales = row.salesClicks || 0;
      const viewSales = 0;
      const clickOrders = row.purchasesClicks || 0;
      const viewOrders = 0;
      const cost = row.cost || 0;
      const sales = clickSales + viewSales;
      const orders = clickOrders + viewOrders;
      const clicks = row.clicks || 0;
      const impressions = row.impressions || 0;

       const targetData = {
        internalAdGroupId: adGroup.id,
        campaignId: adGroup.campaignId,
        targetId: existing?.targetId || `text:${targetingText}`,
        targetType,
        targetValue,
        targetExpression: targetingText,
        bid: '0.00',
        impressions,
        clicks,
        spend: String(cost),
        sales: String(sales),
        orders,
        targetAcos: sales > 0 ? String(((cost / sales) * 100).toFixed(2)) : null,
        targetRoas: cost > 0 && sales > 0 ? String((sales / cost).toFixed(2)) : null,
        targetCtr: impressions > 0 ? String((clicks / impressions).toFixed(4)) : null,
        targetCvr: clicks > 0 ? String((orders / clicks).toFixed(4)) : null,
        targetCpc: clicks > 0 ? String((cost / clicks).toFixed(2)) : null,
        targetStatus: 'enabled' as const,
        updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      };
      if (existing) {
        await db
          .update(productTargets)
          .set(targetData)
          .where(eq(productTargets.id, existing.id));
      } else {
        await db.insert(productTargets).values({
          ...targetData,
          createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
        });
      }
      synced++;
    }

    log.info(`SD定向同步完成: ${synced} 条记录`);

    // v512: 通过SD Targeting List API获取SD定向的真实bid
    try {
      log.info('[v512] 开始通过SD Targeting List API回填SD定向bid...');
      let bidUpdated = 0;
      
      // 获取所有SD广告活动的adGroup
      const sdCampaigns = await db
        .select({ campaignId: campaigns.campaignId })
        .from(campaigns)
        .where(
          and(
            eq(campaigns.accountId, service.accountId),
            sql`${campaigns.adType} = 'sd'`
          )
        );
      
      for (const camp of sdCampaigns) {
        const campAdGroups = await db
          .select({ id: adGroups.id, adGroupId: adGroups.adGroupId })
          .from(adGroups)
          .where(eq(adGroups.campaignId, camp.campaignId));
        
        for (const ag of campAdGroups) {
          try {
            const apiTargets = await service.client.listSdTargets(Number(ag.adGroupId));
            
            for (const apiTarget of (apiTargets as Record<string, unknown>[])) {
              const bid = Number(apiTarget.bid || 0);
              if (bid <= 0) continue;
              
              const targetIdStr = String(apiTarget.targetId || '');
              if (!targetIdStr) continue;
              
              // 通过targetId或targetExpression匹配本地记录
              const [localTarget] = await db
                .select()
                .from(productTargets)
                .where(
                  and(
                    eq(productTargets.internalAdGroupId, ag.id),
                    eq(productTargets.targetId, targetIdStr)
                  )
                )
                .limit(1);
              
              if (localTarget && (localTarget.bid === '0.00' || localTarget.bid === '0' || !localTarget.bid)) {
                await db
                  .update(productTargets)
                  .set({ bid: bid.toFixed(2) })
                  .where(eq(productTargets.id, localTarget.id));
                bidUpdated++;
              }
            }
          } catch (agErr) {
            log.debug(`[v512] 获取SD adGroup ${ag.adGroupId} 的定向bid失败: ${(agErr as Error).message}`);
          }
        }
      }
      
      log.info(`[v512] SD定向bid回填完成: ${bidUpdated} 条更新`);
    } catch (bidErr) {
      log.warn(`[v512] SD定向bid回填失败(不影响主流程): ${(bidErr as Error).message}`);
    }

    return synced;
  } catch (error) {
    log.warn('同步SD定向失败:', error);
    return 0;
  }
}


/**
 * 同步SB定向数据
 * 获取SB广告的关键词和商品定向数据
 */
export async function syncSbTargeting(service: SyncContext,days: number = 14): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  try {
    const { startDate, endDate } = getMarketplaceDateRange(service.marketplace, days);
    log.info(`开始同步SB定向数据: ${startDate} - ${endDate}`);

    // 请求SB定向报告
    const reportId = await service.client.requestSbTargetingReport(startDate, endDate);
    const reportData = await service.client.waitAndDownloadReport(reportId, 300000);

    if (!reportData || reportData.length === 0) {
      log.debug('SB定向报告数据为空');
      return 0;
    }

    log.debug(`获取到 ${reportData.length} 条SB定向数据`);
    let synced = 0;

    // v422: 修复 - SB报告中没有keywordId字段，只有targetingText和matchType
    for (const row of (reportData as unknown[])) {
      // 查找对应的adGroup
      const [adGroup] = await db
        .select()
        .from(adGroups)
        .where(eq(adGroups.adGroupId, String(row.adGroupId)))
        .limit(1);

      if (!adGroup) continue;

      // v422: 修复字段名 - SB报告返回的是targetingText，不是keyword或keywordId
      const targetingText = row.targetingText || '';
      const matchType = (row.matchType || 'broad').toLowerCase();
      if (!targetingText) continue;

      {
        // v422: 通过targetingText+matchType匹配已有关键词记录
        const existingRows = await db
          .select()
          .from(keywords)
          .where(
            and(
              eq(keywords.internalAdGroupId, adGroup.id),
              eq(keywords.keywordText, targetingText)
            )
          )
          .limit(1);
        const existing = existingRows[0] || null;

        const cost = row.cost || 0;
        const sales = row.salesClicks || 0;
        const clicks = row.clicks || 0;
        const impressions = row.impressions || 0;
        const orders = row.purchasesClicks || 0;

        const keywordData = {
          internalAdGroupId: adGroup.id,
          accountId: service.accountId,
          campaignId: adGroup.campaignId,
          keywordId: existing?.keywordId || `text:${targetingText}`,
          keywordText: targetingText,
          matchType: matchType as 'broad' | 'phrase' | 'exact',
          bid: '0.00',
          impressions,
          clicks,
          spend: String(cost),
          sales: String(sales),
          orders,
          keywordAcos: sales > 0 ? String(((cost / sales) * 100).toFixed(2)) : null,
          keywordCtr: impressions > 0 ? String((clicks / impressions).toFixed(4)) : null,
          keywordCvr: clicks > 0 ? String((orders / clicks).toFixed(4)) : null,
          keywordCpc: clicks > 0 ? String((cost / clicks).toFixed(2)) : null,
          keywordRoas: cost > 0 && sales > 0 ? String((sales / cost).toFixed(2)) : null,
          keywordStatus: 'enabled' as const,
          updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
        };

        if (existing) {
          await db
            .update(keywords)
            .set(keywordData)
            .where(eq(keywords.id, existing.id));
        } else {
          await db.insert(keywords).values({
            ...keywordData,
            createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
          });
        }
        synced++;
      }  // v422: end block
    }

    log.info(`SB定向同步完成: ${synced} 条记录`);

    // v512: 通过SB Keywords/Targets List API获取SB定向的真实bid
    try {
      log.info('[v512] 开始通过SB List API回填SB定向bid...');
      let bidUpdated = 0;
      
      // 获取所有SB广告活动的adGroup
      const sbCampaigns = await db
        .select({ campaignId: campaigns.campaignId })
        .from(campaigns)
        .where(
          and(
            eq(campaigns.accountId, service.accountId),
            sql`${campaigns.adType} = 'sb'`
          )
        );
      
      for (const camp of sbCampaigns) {
        const campAdGroups = await db
          .select({ id: adGroups.id, adGroupId: adGroups.adGroupId })
          .from(adGroups)
          .where(eq(adGroups.campaignId, camp.campaignId));
        
        for (const ag of campAdGroups) {
          try {
            // SB关键词的bid回填
            const apiKeywords = await service.client.listSbKeywords(String(ag.adGroupId));
            for (const apiKw of apiKeywords) {
              const bid = Number(apiKw.bid || 0);
              if (bid <= 0) continue;
              
              const kwText = String(apiKw.keywordText || apiKw.keyword || '');
              if (!kwText) continue;
              
              // 通过keywordText匹配本地记录
              const [localKw] = await db
                .select()
                .from(keywords)
                .where(
                  and(
                    eq(keywords.internalAdGroupId, ag.id),
                    eq(keywords.keywordText, kwText)
                  )
                )
                .limit(1);
              
              if (localKw && (localKw.bid === '0.00' || localKw.bid === '0' || !localKw.bid)) {
                await db
                  .update(keywords)
                  .set({ bid: bid.toFixed(2) })
                  .where(eq(keywords.id, localKw.id));
                bidUpdated++;
              }
            }
          } catch (agErr) {
            log.debug(`[v512] 获取SB adGroup ${ag.adGroupId} 的关键词bid失败: ${(agErr as Error).message}`);
          }
          
          try {
            // SB商品定向的bid回填
            const apiTargets = await service.client.listSbTargets(String(ag.adGroupId));
            for (const apiTarget of apiTargets) {
              const bid = Number(apiTarget.bid || 0);
              if (bid <= 0) continue;
              
              const targetIdStr = String(apiTarget.targetId || '');
              if (!targetIdStr) continue;
              
              const [localTarget] = await db
                .select()
                .from(productTargets)
                .where(
                  and(
                    eq(productTargets.internalAdGroupId, ag.id),
                    eq(productTargets.targetId, targetIdStr)
                  )
                )
                .limit(1);
              
              if (localTarget && (localTarget.bid === '0.00' || localTarget.bid === '0' || !localTarget.bid)) {
                await db
                  .update(productTargets)
                  .set({ bid: bid.toFixed(2) })
                  .where(eq(productTargets.id, localTarget.id));
                bidUpdated++;
              }
            }
          } catch (agErr) {
            log.debug(`[v512] 获取SB adGroup ${ag.adGroupId} 的商品定向bid失败: ${(agErr as Error).message}`);
          }
        }
      }
      
      log.info(`[v512] SB定向bid回填完成: ${bidUpdated} 条更新`);
    } catch (bidErr) {
      log.warn(`[v512] SB定向bid回填失败(不影响主流程): ${(bidErr as Error).message}`);
    }

    return synced;
  } catch (error) {
    log.warn('同步SB定向失败:', error);
    return 0;
  }
}


