/**
 * 搜索词同步模块
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

const log = createModuleLogger('searchTermSync');

/**
 * 同步SB搜索词报告
 * 从Amazon SB搜索词报告获取数据并同步到searchTerms表
 */
export async function syncSbSearchTerms(service: SyncContext,days: number = 14): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  try {
    const { startDate, endDate } = getMarketplaceDateRange(service.marketplace, days);
    log.info(`开始同步SB搜索词数据: ${startDate} - ${endDate}`);

    // 请求SB搜索词报告
    const reportId = await service.client.requestSbSearchTermReport(startDate, endDate);
    const reportData = await service.client.waitAndDownloadReport(reportId, 300000);

    if (!reportData || reportData.length === 0) {
      log.debug('SB搜索词报告数据为空');
      return 0;
    }

    log.debug(`获取到 ${reportData.length} 条SB搜索词数据`);
    let synced = 0;

    for (const row of (reportData as any[])) {
      // 查找对应的campaign
      const [campaign] = await db
        .select()
        .from(campaigns)
        .where(
          and(
            eq(campaigns.accountId, service.accountId),
            eq(campaigns.campaignId, String(row.campaignId))
          )
        )
        .limit(1);

      if (!campaign) continue;

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
        .from(searchTerms)
        .where(
          and(
            eq(searchTerms.accountId, service.accountId),
            eq(searchTerms.campaignId, String(campaign.campaignId)),
            eq(searchTerms.internalAdGroupId, adGroup.id),
            eq(searchTerms.searchTerm, row.searchTerm || '')
          )
        )
        .limit(1);

      const cost = row.cost || 0;
      const sales = row.sales || row.salesClicks || 0;
      const clicks = row.clicks || 0;
      const impressions = row.impressions || 0;
      const orders = row.purchases || row.purchasesClicks || 0;

      // SB搜索词报告字段映射：
      // keywordText = 投放词文本, matchType = 匹配类型
      const targetingText = row.keywordText || row.targeting || '';
      const matchType = (row.matchType || '').toLowerCase();
      const isProductTarget = matchType === 'targeting';

      // 尝试关联到本地数据库中的投放词/投放ASIN记录
      let searchTermTargetId: number | null = null;
      let resolvedMatchType = matchType; // 默认使用报告中的匹配类型
      if (!isProductTarget) {
        const [matchedKeyword] = await db
          .select({ id: keywords.id, matchType: keywords.matchType })
          .from(keywords)
          .where(
            and(
              eq(keywords.internalAdGroupId, adGroup.id),
              eq(keywords.keywordText, targetingText)
            )
          )
          .limit(1);
        if (matchedKeyword) {
          searchTermTargetId = matchedKeyword.id;
          // 使用数据库中存储的精确匹配类型（broad/phrase/exact）
          resolvedMatchType = matchedKeyword.matchType || matchType;
        }
      } else {
        const [matchedTarget] = await db
          .select({ id: productTargets.id, targetMatchType: productTargets.targetMatchType })
          .from(productTargets)
          .where(
            and(
              eq(productTargets.internalAdGroupId, adGroup.id),
              eq(productTargets.targetValue, targetingText)
            )
          )
          .limit(1);
        if (matchedTarget) {
          searchTermTargetId = matchedTarget.id;
          // 使用productTarget的具体匹配类型（exact/expanded/loose/close等）
          resolvedMatchType = matchedTarget.targetMatchType || 'targeting';
        }
      }

      // 判断搜索词类型：是关键词搜索词还是ASIN搜索词
      const searchTermText = row.searchTerm || '';
      const isAsinSearchTerm = /^[Bb]0[A-Za-z0-9]{8,}$/.test(searchTermText.trim());
      const searchTermType = isAsinSearchTerm ? 'asin' : 'keyword';
      const sourceMatchType = resolvedMatchType;
      const sourceTargetType = isProductTarget ? 'product_target' : 'keyword';
      const unitsOrdered = row.unitsSold7d || row.unitsSold14d || row.unitsSold || row.unitsSoldClicks || 0;

      const searchTermData = {
        accountId: service.accountId,
        campaignId: campaign.campaignId,
        internalAdGroupId: adGroup.id,
        searchTerm: searchTermText,
        searchTermTargetType: isProductTarget ? 'product_target' as const : 'keyword' as const,
        searchTermTargetId,
        targetText: targetingText,
        searchTermMatchType: resolvedMatchType,
        searchTermImpressions: impressions,
        searchTermClicks: clicks,
        searchTermSpend: String(cost),
        searchTermSales: String(sales),
        searchTermOrders: orders,
        searchTermAcos: sales > 0 ? String((cost / sales) * 100) : null,
        searchTermRoas: cost > 0 ? String(sales / cost) : null,
        searchTermCtr: impressions > 0 ? String(clicks / impressions) : null,
        searchTermCvr: clicks > 0 ? String(orders / clicks) : null,
        searchTermCpc: clicks > 0 ? String(cost / clicks) : null,
        reportStartDate: startDate,
        reportEndDate: endDate,
        sourceMatchType: sourceMatchType,
        sourceTargetType: sourceTargetType,
        searchTermType: searchTermType,
        searchTermUnitsOrdered: unitsOrdered,
        updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      };

      if (existing) {
        await db
          .update(searchTerms)
          .set(searchTermData)
          .where(eq(searchTerms.id, existing.id));
      } else {
        await db.insert(searchTerms).values({
          ...searchTermData,
          createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
        });
      }
      synced++;
    }

    log.info(`SB搜索词同步完成: ${synced} 条记录`);
    return synced;
  } catch (error) {
    log.error('同步SB搜索词失败:', error);
    return 0;
  }
}


/**
 * 同步搜索词数据
 * 使用Report API v3获取客户搜索词和绩效数据
 */
export async function syncSearchTerms(service: SyncContext,days: number = 14): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  try {
    const { startDate, endDate } = getMarketplaceDateRange(service.marketplace, days);
    log.info(`v196: 开始同步搜索词数据: ${startDate} - ${endDate}`);

    // 请求SP搜索词报告
    const reportId = await service.client.requestSpSearchTermReport(startDate, endDate);
    const reportData = await service.client.waitAndDownloadReport(reportId, 300000);

    if (!reportData || reportData.length === 0) {
      log.debug('v196: 搜索词报告数据为空');
      return 0;
    }

    log.info(`v196: 获取到 ${reportData.length} 条搜索词数据，开始批量预加载...`);

    // v196: 批量预加载所有关联数据，避免逐行查询
    // 1. 预加载campaigns: amazonCampaignId -> localCampaign
    const allCampaigns = await db
      .select({ id: campaigns.id, campaignId: campaigns.campaignId })
      .from(campaigns)
      .where(eq(campaigns.accountId, service.accountId));
    const campaignMap = new Map<string, { id: number }>();
    for (const c of (allCampaigns as any[])) {
      campaignMap.set(String(c.campaignId), { id: c.id });
    }

    // 2. 预加载adGroups: amazonAdGroupId -> localAdGroup
    const allAdGroups = await db
      .select({ id: adGroups.id, adGroupId: adGroups.adGroupId })
      .from(adGroups)
      // @ts-expect-error - property exists at runtime
      .where(eq(adGroups.accountId, service.accountId));
    const adGroupMap = new Map<string, { id: number }>();
    for (const ag of allAdGroups) {
      adGroupMap.set(String(ag.adGroupId), { id: ag.id });
    }

    // 3. 预加载keywords: adGroupId:keywordText -> keyword
    const allKeywords = await db
      .select({ id: keywords.id, adGroupId: keywords.internalAdGroupId, keywordText: keywords.keywordText, matchType: keywords.matchType })
      .from(keywords)
      // @ts-expect-error - property exists at runtime
      .where(eq(keywords.accountId, service.accountId));
    const keywordMap = new Map<string, { id: number; matchType: string | null }>();
    for (const kw of (allKeywords as any[])) {
      const key = `${kw.adGroupId}:${(kw.keywordText || '').toLowerCase()}`;
      keywordMap.set(key, { id: kw.id, matchType: kw.matchType });
    }

    // 4. 预加载productTargets: adGroupId:targetValue -> target
    const allTargets = await db
      .select({ id: productTargets.id, adGroupId: productTargets.internalAdGroupId, targetValue: productTargets.targetValue, targetMatchType: productTargets.targetMatchType })
      .from(productTargets)
      // @ts-expect-error - property exists at runtime
      .where(eq(productTargets.accountId, service.accountId));
    const targetMap = new Map<string, { id: number; targetMatchType: string | null }>();
    for (const t of allTargets) {
      const key = `${t.adGroupId}:${(t.targetValue || '').toLowerCase()}`;
      targetMap.set(key, { id: t.id, targetMatchType: t.targetMatchType });
    }

    // 5. 预加载已有搜索词: accountId:campaignLocalId:adGroupLocalId:searchTerm -> existing
    const allSearchTerms = await db
      .select({ id: searchTerms.id, campaignId: searchTerms.campaignId, adGroupId: searchTerms.internalAdGroupId, searchTerm: searchTerms.searchTerm })
      .from(searchTerms)
      .where(eq(searchTerms.accountId, service.accountId));
    const existingMap = new Map<string, number>();
    for (const st of allSearchTerms) {
      const key = `${st.campaignId}:${st.adGroupId}:${(st.searchTerm || '').toLowerCase()}`;
      existingMap.set(key, st.id);
    }

    log.info(`v196: 预加载完成 - campaigns=${allCampaigns.length}, adGroups=${allAdGroups.length}, keywords=${allKeywords.length}, targets=${allTargets.length}, existingSearchTerms=${allSearchTerms.length}`);

    let synced = 0;
    let skipped = 0;

    for (const row of (reportData as any[])) {
      // 查找对应的campaign（从Map查找，O(1)）
      const campaign = campaignMap.get(String(row.campaignId));
      if (!campaign) { skipped++; continue; }

      // 查找对应的adGroup（从Map查找，O(1)）
      const adGroup = adGroupMap.get(String(row.adGroupId));
      if (!adGroup) { skipped++; continue; }

      const cost = row.cost || 0;
      const sales = row.sales7d || row.sales14d || 0;
      const clicks = row.clicks || 0;
      const impressions = row.impressions || 0;
      const orders = row.purchases7d || row.purchases14d || 0;

      const targetingText = row.targeting || row.keyword || '';
      const keywordType = (row.keywordType || row.matchType || '').toLowerCase();
      const isProductTarget = keywordType === 'targeting';
      
      // 尝试关联到本地投放词记录（从Map查找，O(1)）
      let searchTermTargetId: number | null = null;
      let resolvedMatchType = keywordType;
      if (!isProductTarget) {
        const kwKey = `${adGroup.id}:${targetingText.toLowerCase()}`;
        const matchedKeyword = keywordMap.get(kwKey);
        if (matchedKeyword) {
          searchTermTargetId = matchedKeyword.id;
          resolvedMatchType = matchedKeyword.matchType || keywordType;
        }
      } else {
        const tKey = `${adGroup.id}:${targetingText.toLowerCase()}`;
        const matchedTarget = targetMap.get(tKey);
        if (matchedTarget) {
          searchTermTargetId = matchedTarget.id;
          resolvedMatchType = matchedTarget.targetMatchType || 'targeting';
        }
      }

      const searchTermText = row.searchTerm || '';
      const isAsinSearchTerm = /^[Bb]0[A-Za-z0-9]{8,}$/.test(searchTermText.trim());
      const searchTermType = isAsinSearchTerm ? 'asin' : 'keyword';
      const sourceMatchType = resolvedMatchType;
      const sourceTargetType = isProductTarget ? 'product_target' : 'keyword';
      const unitsOrdered = row.unitsSold7d || row.unitsSold14d || row.unitsSold || row.unitsSoldClicks || 0;

      const searchTermData = {
        accountId: service.accountId,
        // @ts-expect-error - property exists at runtime
        campaignId: campaign.campaignId,
        internalAdGroupId: adGroup.id,
        searchTerm: searchTermText,
        searchTermTargetType: isProductTarget ? 'product_target' as const : 'keyword' as const,
        searchTermTargetId,
        targetText: targetingText,
        searchTermMatchType: resolvedMatchType,
        searchTermImpressions: impressions,
        searchTermClicks: clicks,
        searchTermSpend: String(cost),
        searchTermSales: String(sales),
        searchTermOrders: orders,
        searchTermAcos: sales > 0 ? String((cost / sales) * 100) : null,
        searchTermRoas: cost > 0 ? String(sales / cost) : null,
        searchTermCtr: impressions > 0 ? String(clicks / impressions) : null,
        searchTermCvr: clicks > 0 ? String(orders / clicks) : null,
        searchTermCpc: clicks > 0 ? String(cost / clicks) : null,
        reportStartDate: startDate,
        reportEndDate: endDate,
        sourceMatchType: sourceMatchType,
        sourceTargetType: sourceTargetType,
        searchTermType: searchTermType,
        searchTermUnitsOrdered: unitsOrdered,
        updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      };

      // 检查是否已存在（从Map查找，O(1)）
      const existingKey = `${campaign.id}:${adGroup.id}:${searchTermText.toLowerCase()}`;
      const existingId = existingMap.get(existingKey);

      if (existingId) {
        await db
          .update(searchTerms)
          .set(searchTermData)
          .where(eq(searchTerms.id, existingId));
      } else {
        await db.insert(searchTerms).values({
          ...searchTermData,
          createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
        });
      }
      synced++;
    }

    log.info(`v196: 搜索词同步完成: 同步=${synced}, 跳过=${skipped} (无匹配campaign/adGroup)`);
    return synced;
  } catch (error) {
    log.error('v196: 同步搜索词失败:', error);
    return 0;
  }
}


