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
import type { AmazonAdsApiClient } from '../amazonAdsApi';

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

    for (const row of (reportData as any[])) {
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
            eq(productTargets.adGroupId, adGroup.id),
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
        adGroupId: adGroup.id,
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
    return synced;
  } catch (error) {
    log.error('同步自动定向失败:', error);
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

    for (const row of (reportData as any[])) {
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
            eq(productTargets.adGroupId, adGroup.id),
            eq(productTargets.targetId, String(row.targetId))
          )
        )
        .limit(1);

      // SD的销售额 - 使用修正后的字段名 (Clicks后缀)
      const clickSales = row.salesClicks || 0;
      const viewSales = 0; // 浏览归因已合并到salesClicks字段
      const clickOrders = row.purchasesClicks || 0;
      const viewOrders = 0; // 浏览归因已合并到purchasesClicks字段
      const cost = row.cost || 0;
      const sales = clickSales + viewSales;
      const orders = clickOrders + viewOrders;
      const clicks = row.clicks || 0;
      const impressions = row.impressions || 0;

      // 解析定向类型
      const targetingExpression = row.targetingExpression || '';
      let targetType: 'asin' | 'category' = 'category';
      let targetValue = targetingExpression;
      
      // SD定向类型可能是受众或商品
      if (targetingExpression.includes('asin')) {
        targetType = 'asin';
        // 提取ASIN
        const asinMatch = targetingExpression.match(/asin="([^"]+)"/);
        if (asinMatch) targetValue = asinMatch[1];
      }

       const targetData = {
        adGroupId: adGroup.id,
        campaignId: adGroup.campaignId,
        targetId: String(row.targetId),
        targetType,
        targetValue,
        targetExpression: targetingExpression,
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
    return synced;
  } catch (error) {
    log.error('同步SD定向失败:', error);
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

    for (const row of (reportData as any[])) {
      // 查找对应的adGroup
      const [adGroup] = await db
        .select()
        .from(adGroups)
        .where(eq(adGroups.adGroupId, String(row.adGroupId)))
        .limit(1);

      if (!adGroup) continue;

      // SB主要是关键词定向
      if (row.keywordId) {
        // 检查关键词是否已存在
        const [existing] = await db
          .select()
          .from(keywords)
          .where(
            and(
              eq(keywords.adGroupId, adGroup.id),
              eq(keywords.keywordId, String(row.keywordId))
            )
          )
          .limit(1);

        const cost = row.cost || 0;
        const sales = row.salesClicks || 0;  // 修正字段名 (Clicks后缀)
        const clicks = row.clicks || 0;
        const impressions = row.impressions || 0;
        const orders = row.purchasesClicks || 0;  // 修正字段名 (Clicks后缀)

        const keywordData = {
          adGroupId: adGroup.id,
          accountId: service.accountId,
          campaignId: adGroup.campaignId,
          keywordId: String(row.keywordId),
          keywordText: row.keyword || '',
          matchType: (row.matchType || 'broad').toLowerCase() as 'broad' | 'phrase' | 'exact',
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
      }
    }

    log.info(`SB定向同步完成: ${synced} 条记录`);
    return synced;
  } catch (error) {
    log.error('同步SB定向失败:', error);
    return 0;
  }
}


