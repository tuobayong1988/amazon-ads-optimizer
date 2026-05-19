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
import { getMarketplaceDateRange } from '../utils/timezone';
import type { AmazonAdsApiClient } from './amazonAdsApi';

/** 同步服务上下文 - 从AmazonSyncService传入 */
export interface SyncContext {
  client: AmazonAdsApiClient;
  accountId: number;
  userId: number;
  marketplace: string;
}

const log = createModuleLogger('targetingSync');

type KeywordMatchType = 'broad' | 'phrase' | 'exact';
type ProductTargetType = 'asin' | 'category';
type ProductTargetMatchType = 'exact' | 'expanded' | 'category_exact' | 'brand_exact' | 'substitute' | 'accessory' | 'loose' | 'close';

function normalizeKeywordMatchType(raw: unknown): KeywordMatchType | null {
  const value = String(raw || '').trim().toLowerCase().replace(/_/g, ' ');
  if (value === 'broad') return 'broad';
  if (value === 'phrase') return 'phrase';
  if (value === 'exact') return 'exact';
  return null;
}

function getStringField(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim();
    }
  }
  return '';
}

function makeSyntheticId(prefix: string, value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  }
  return `${prefix}:${Math.abs(hash).toString(36)}`.slice(0, 64);
}

function parseSbTargetExpression(raw: string): { targetType: ProductTargetType; targetValue: string; targetMatchType: ProductTargetMatchType } | null {
  const expression = raw.trim();
  if (!expression) return null;
  const lower = expression.toLowerCase();

  const asinMatch = expression.match(/asin\s*[=:]\s*[\"']?([A-Z0-9]{10})[\"']?/i) || expression.match(/\b(B[A-Z0-9]{9})\b/i);
  if (asinMatch?.[1]) {
    const targetMatchType: ProductTargetMatchType = lower.includes('expanded') || lower.includes('asinexpanded') ? 'expanded' : 'exact';
    return { targetType: 'asin', targetValue: asinMatch[1].toUpperCase(), targetMatchType };
  }

  const categoryMatch = expression.match(/category\s*[=:]\s*[\"']?([^\"'\),;]+)[\"']?/i) || expression.match(/categorysameas\s*\(([^\)]+)\)/i);
  if (categoryMatch?.[1]) {
    return { targetType: 'category', targetValue: categoryMatch[1].trim().slice(0, 64), targetMatchType: 'category_exact' };
  }

  return null;
}

function normalizeSbTargetingRow(row: Record<string, unknown>):
  | { kind: 'keyword'; keywordText: string; matchType: KeywordMatchType; targetId: string }
  | { kind: 'product_target'; targetId: string; targetType: ProductTargetType; targetValue: string; targetExpression: string; targetMatchType: ProductTargetMatchType }
  | null {
  const rawMatchType = getStringField(row, ['matchType', 'keywordMatchType']);
  const keywordMatchType = normalizeKeywordMatchType(rawMatchType);
  const targetingText = getStringField(row, ['targetingText', 'keywordText', 'keyword']);
  const targetExpression = getStringField(row, ['targetingExpression', 'resolvedExpression', 'expression', 'targetingText']);
  const rawTargetingType = getStringField(row, ['targetingType', 'targetingExpressionType', 'type']).toUpperCase();
  const targetId = getStringField(row, ['targetId', 'keywordId']);

  const productExpression = parseSbTargetExpression(targetExpression);
  const looksLikeProductTarget = !!productExpression || rawMatchType.toUpperCase().includes('TARGETING_EXPRESSION') || rawTargetingType.includes('TARGETING_EXPRESSION') || rawTargetingType.includes('PRODUCT');

  if (looksLikeProductTarget && productExpression) {
    return {
      kind: 'product_target',
      targetId: targetId || makeSyntheticId(`expr:${productExpression.targetType}`, productExpression.targetValue),
      targetType: productExpression.targetType,
      targetValue: productExpression.targetValue,
      targetExpression: targetExpression || targetingText,
      targetMatchType: productExpression.targetMatchType,
    };
  }

  if (!keywordMatchType || !targetingText) {
    return null;
  }

  return {
    kind: 'keyword',
    keywordText: targetingText,
    matchType: keywordMatchType,
    targetId: targetId || makeSyntheticId('text', `${targetingText}:${keywordMatchType}`),
  };
}

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

    // v649: P5 异步报告模式 — 提交到队列后立即返回
    if (process.env.P5_ASYNC_REPORTS === 'true' && !this._forceSync) { // v676
      const asyncResult = await service.client.submitReportsToAsyncQueue(
        [{ name: `SP自动定向(${startDate}~${endDate})`, requestFn: () => service.client.requestSpAutoTargetingReport(startDate, endDate) }],
        { accountId: service.accountId, syncType: 'targeting_sync', startDate, endDate }
      );
      log.info(`[v649:P5] Async SP auto targeting report submitted: ${asyncResult.queued} queued, ${asyncResult.failed} failed`);
      return 0; // 异步模式下由 ReportJobScheduler 处理数据
    }

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
        // v523.2: 保护 amazon_deleted 状态不被绩效同步覆盖
        if (existing.targetStatus === 'amazon_deleted') {
          delete (targetData as Record<string, unknown>).targetStatus;
        }
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

    // v649: P5 异步报告模式 — 提交到队列后立即返回
    if (process.env.P5_ASYNC_REPORTS === 'true' && !this._forceSync) { // v676
      const asyncResult = await service.client.submitReportsToAsyncQueue(
        [{ name: `SD定向(${startDate}~${endDate})`, requestFn: () => service.client.requestSdTargetingReport(startDate, endDate) }],
        { accountId: service.accountId, syncType: 'sd_sync', startDate, endDate }
      );
      log.info(`[v649:P5] Async SD targeting report submitted: ${asyncResult.queued} queued, ${asyncResult.failed} failed`);
      return 0; // 异步模式下由 ReportJobScheduler 处理数据
    }

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
        // v523.2: 保护 amazon_deleted 状态不被绩效同步覆盖
        if (existing.targetStatus === 'amazon_deleted') {
          delete (targetData as Record<string, unknown>).targetStatus;
        }
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

    // v649: P5 异步报告模式 — 提交到队列后立即返回
    if (process.env.P5_ASYNC_REPORTS === 'true' && !this._forceSync) { // v676
      const asyncResult = await service.client.submitReportsToAsyncQueue(
        [{ name: `SB定向(${startDate}~${endDate})`, requestFn: () => service.client.requestSbTargetingReport(startDate, endDate) }],
        { accountId: service.accountId, syncType: 'sb_sync', startDate, endDate }
      );
      log.info(`[v649:P5] Async SB targeting report submitted: ${asyncResult.queued} queued, ${asyncResult.failed} failed`);
      return 0; // 异步模式下由 ReportJobScheduler 处理数据
    }

    // 请求SB定向报告
    const reportId = await service.client.requestSbTargetingReport(startDate, endDate);
    const reportData = await service.client.waitAndDownloadReport(reportId, 300000);

    if (!reportData || reportData.length === 0) {
      log.debug('SB定向报告数据为空');
      return 0;
    }

    log.debug(`获取到 ${reportData.length} 条SB定向数据`);
    let synced = 0;

    // v738: SB targeting 报表会同时返回关键词定向与商品/类目定向。
    // 这里先归一化 Amazon 原始字段，再分别写入 keywords / product_targets，避免 TARGETING_EXPRESSION 等 API 枚举误写入本地枚举列。
    let skipped = 0;
    for (const rawRow of (reportData as unknown[])) {
      const row = rawRow as Record<string, unknown>;

      // 查找对应的adGroup
      const adGroupId = getStringField(row, ['adGroupId']);
      if (!adGroupId) { skipped++; continue; }
      const [adGroup] = await db
        .select()
        .from(adGroups)
        .where(eq(adGroups.adGroupId, adGroupId))
        .limit(1);

      if (!adGroup) { skipped++; continue; }

      const normalizedTarget = normalizeSbTargetingRow(row);
      if (!normalizedTarget) { skipped++; continue; }

      const cost = Number(row.cost || row.spend || 0) || 0;
      const sales = Number(row.salesClicks || row.salesClicks14d || row.sales || 0) || 0;
      const clicks = Number(row.clicks || 0) || 0;
      const impressions = Number(row.impressions || 0) || 0;
      const orders = Number(row.purchasesClicks || row.purchasesClicks14d || row.purchases || 0) || 0;
      const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

      if (normalizedTarget.kind === 'keyword') {
        const existingRows = await db
          .select()
          .from(keywords)
          .where(
            and(
              eq(keywords.internalAdGroupId, adGroup.id),
              eq(keywords.keywordText, normalizedTarget.keywordText),
              eq(keywords.matchType, normalizedTarget.matchType)
            )
          )
          .limit(1);
        const existing = existingRows[0] || null;

        const keywordData = {
          internalAdGroupId: adGroup.id,
          accountId: service.accountId,
          campaignId: adGroup.campaignId,
          keywordId: existing?.keywordId || normalizedTarget.targetId,
          keywordText: normalizedTarget.keywordText,
          matchType: normalizedTarget.matchType,
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
          updatedAt: now,
        };

        if (existing) {
          // v523.2: 保护 amazon_deleted 状态不被绩效同步覆盖
          if (existing.keywordStatus === 'amazon_deleted') {
            delete (keywordData as Record<string, unknown>).keywordStatus;
          }
          await db
            .update(keywords)
            .set(keywordData)
            .where(eq(keywords.id, existing.id));
        } else {
          await db.insert(keywords).values({
            ...keywordData,
            createdAt: now,
          });
        }
        synced++;
        continue;
      }

      const existingRows = await db
        .select()
        .from(productTargets)
        .where(
          and(
            eq(productTargets.internalAdGroupId, adGroup.id),
            eq(productTargets.targetId, normalizedTarget.targetId)
          )
        )
        .limit(1);
      const existing = existingRows[0] || null;

      const targetData = {
        internalAdGroupId: adGroup.id,
        accountId: service.accountId,
        campaignId: adGroup.campaignId,
        targetId: normalizedTarget.targetId,
        targetType: normalizedTarget.targetType,
        targetValue: normalizedTarget.targetValue,
        targetExpression: normalizedTarget.targetExpression,
        targetMatchType: normalizedTarget.targetMatchType,
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
        updatedAt: now,
      };

      if (existing) {
        // v523.2: 保护 amazon_deleted 状态不被绩效同步覆盖
        if (existing.targetStatus === 'amazon_deleted') {
          delete (targetData as Record<string, unknown>).targetStatus;
        }
        await db
          .update(productTargets)
          .set(targetData)
          .where(eq(productTargets.id, existing.id));
      } else {
        await db.insert(productTargets).values({
          ...targetData,
          createdAt: now,
        });
      }
      synced++;
    }

    if (skipped > 0) {
      log.info(`[v738] SB定向同步跳过 ${skipped} 条无法归一化或缺少adGroup的记录`);
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


