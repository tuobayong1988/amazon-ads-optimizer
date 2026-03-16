/**
 * SB (Sponsored Brands) 广告数据同步方法
 * 
 * 从 amazonSyncService.ts 中提取的 syncSb 子模块。
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
import type { AmazonAdsApiClient, SpCampaign } from '../../sync/amazonAdsApi';
import { getMarketplaceDateRange, getMarketplaceCurrentDate, getMarketplaceYesterday, getMarketplaceHistoricalDateRange } from '../../utils/timezone';
import { getExchangeRateByMarketplace } from '../exchangeRateService';
import { AmazonSyncService, flushSearchTermBatch } from '../../sync/amazonSyncService';
import {
  SYNC_PROTECTION_CONFIG,
  createSyncProtectionStats,
  logSyncProtectionSummary,
  hasRecentSyncedOptimization,
  getRecentlyOptimizedKeywordIds,
  getRecentlyOptimizedCampaignIds,
} from './syncHelpers';

const log = createModuleLogger('syncSb');

// ==================== 类型声明（模块扩展） ====================

declare module '../../amazonSyncService' {
  interface AmazonSyncService {
    syncSbCampaigns(...args: unknown[]): unknown;
    syncSbAdGroups(...args: unknown[]): unknown;
    syncSbKeywords(...args: unknown[]): unknown;
    syncSbProductTargets(...args: unknown[]): unknown;
    syncSbSearchTerms(...args: unknown[]): unknown;
    syncSbTargeting(...args: unknown[]): unknown;
    syncSbAds(...args: unknown[]): unknown;
    syncSbNegativeKeywords(...args: unknown[]): unknown;
    syncSbNegativeTargets(...args: unknown[]): unknown;
    syncSbPlacementPerformance(...args: unknown[]): unknown;
  }
}

// ==================== 方法实现 ====================

/**
 * 同步SB品牌广告活动
 * @param lastSyncTime 上次同步时间，用于增量同步
 */
AmazonSyncService.prototype.syncSbCampaigns = async function(this: AmazonSyncService, lastSyncTime?: string | null): Promise<number | { synced: number; skipped: number }> {
  const db = await getDb();
  if (!db) return { synced: 0, skipped: 0 };

  try {
    const apiCampaigns = await this.client.listSbCampaigns();
    let synced = 0;
    let skipped = 0;
    
    // 输出第一个广告活动的结构用于调试
    if (apiCampaigns.length > 0) {
      log.debug('SB广告活动API返回结构示例:', JSON.stringify(apiCampaigns[0], null, 2));
    }
    log.debug(`获取到 ${apiCampaigns.length} 个SB广告活动`);

    // v363: 批量预查询所有已存在的SB campaign（消除N+1查询）
    const sbCampaignIds = apiCampaigns.map(c => String(c.campaignId));
    const existingSbCampaignRows = sbCampaignIds.length > 0
      ? await db.select().from(campaigns)
          .where(and(eq(campaigns.accountId, this.accountId), inArray(campaigns.campaignId, sbCampaignIds)))
      : [];
    const existingSbCampaignMap = new Map(existingSbCampaignRows.map(r => [r.campaignId, r]));

    for (const apiCampaign of apiCampaigns) {
      // v363: 使用批量预查询结果
      const existing = existingSbCampaignMap.get(String(apiCampaign.campaignId)) || null;

      // 增量同步：如果有上次同步时间且记录已存在，检查是否需要更新
      // v215修复: 移除错误的updatedAt跳过逻辑
      // 始终使用Amazon API返回的最新数据更新本地记录

      // SB API v4 返回的预算结构:
      // - budget: 直接是数字（如 30）
      // - budgetType: 独立字段（"DAILY" 或 "LIFETIME"）
      let dailyBudget = 0;
      if (typeof apiCampaign.budget === 'number') {
        dailyBudget = apiCampaign.budget;
      } else if (apiCampaign.budget && typeof apiCampaign.budget === 'object') {
        // 兑容旧版本的对象格式
        dailyBudget = apiCampaign.budget.budget || apiCampaign.budget.dailyBudget || 0;
      } else if (apiCampaign.dailyBudget) {
        dailyBudget = apiCampaign.dailyBudget;
      }
      
      // budgetType 是独立字段
      const budgetType = (apiCampaign.budgetType || 'DAILY').toLowerCase() as 'daily' | 'lifetime';
      
      // SB API v4 的状态字段可能是 state 或 status
      const campaignState = apiCampaign.state || apiCampaign.status || 'enabled';
      // 确保状态值是有效的枚举值
      const validStates = ['enabled', 'paused', 'archived'];
      const normalizedState = validStates.includes(campaignState.toLowerCase()) 
        ? campaignState.toLowerCase() as 'enabled' | 'paused' | 'archived'
        : 'enabled';

      // 解析SB广告活动的startDate和endDate
      let sbStartDate: string | null = null;
      if (apiCampaign.startDate) {
        const dateStr = String(apiCampaign.startDate);
        if (dateStr.includes('-')) {
          sbStartDate = dateStr;
        } else if (dateStr.length === 8) {
          sbStartDate = `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
        }
      }

      let sbEndDate: string | null = null;
      if (apiCampaign.endDate) {
        const dateStr = String(apiCampaign.endDate);
        if (dateStr.includes('-')) {
          sbEndDate = dateStr;
        } else if (dateStr.length === 8) {
          sbEndDate = `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
        }
      }

      // 获取SB广告的组合ID
      const sbPortfolioId = (apiCampaign as Record<string, any>).portfolioId ? String((apiCampaign as Record<string, any>).portfolioId) : null;

      // 获取SB广告的竞价策略
      const sbBiddingStrategy = (apiCampaign as Record<string, any>).bidding?.strategy || 
                                (apiCampaign as Record<string, any>).biddingStrategy || 
                                'legacyForSales';

      // ✅ 根据SB广告的Campaign Goal确定计费方式
      // SB v4 API返回的goal字段决定计费模式:
      //   - DRIVE_PAGE_VISITS → CPC计费（按点击付费）
      //   - GROW_BRAND_IMPRESSION_SHARE → vCPM计费（按千次可见展示付费）
      //   - PROMOTE_PRODUCTS → CPC计费（推广产品）
      // 注意：同一种SB广告格式（Video/Product Collection/Store Spotlight）
      //       既可以是CPC也可以是vCPM，完全取决于创建时选择的Goal
      const sbGoal = (apiCampaign as Record<string, any>).goal || (apiCampaign as Record<string, any>).campaignGoal || '';
      let sbCostType: 'cpc' | 'vcpm' | 'cpm' = 'cpc'; // 默认CPC
      if (sbGoal === 'GROW_BRAND_IMPRESSION_SHARE' || sbGoal === 'growBrandImpressionShare') {
        sbCostType = 'vcpm';
      }
      // 也检查API是否直接返回了costType字段（某些API版本可能直接返回）
      if ((apiCampaign as Record<string, any>).costType) {
        const apiCostType = String((apiCampaign as Record<string, any>).costType).toLowerCase();
        if (apiCostType === 'vcpm' || apiCostType === 'cpm') {
          sbCostType = apiCostType as 'vcpm' | 'cpm';
        }
      }

      // 获取SB广告格式
      const sbAdFormat = (apiCampaign as Record<string, any>).adFormat || (apiCampaign as Record<string, any>).creative?.adFormat || null;
      const validAdFormats = ['productCollection', 'video', 'storeSpotlight', 'brandVideo'];
      const normalizedAdFormat = validAdFormats.includes(sbAdFormat) ? sbAdFormat : null;

      // 获取SB广告的竞价优化目标
      const sbBidOptimization = (apiCampaign as Record<string, any>).bidOptimization || null;
      const validBidOpts = ['reach', 'pageVisits', 'conversions'];
      const normalizedBidOpt = validBidOpts.includes(sbBidOptimization) ? sbBidOptimization : null;

      // 获取SB广告的landing page信息
      const sbLandingPageType = (apiCampaign as Record<string, any>).landingPage?.pageType || (apiCampaign as Record<string, any>).landingPageType || null;
      const sbLandingPageUrl = (apiCampaign as Record<string, any>).landingPage?.url || (apiCampaign as Record<string, any>).landingPageUrl || null;
      const sbBrandEntityId = (apiCampaign as Record<string, any>).brandEntityId || null;

      log.debug(`SB广告 ${apiCampaign.name}: goal=${sbGoal}, costType=${sbCostType}, adFormat=${normalizedAdFormat}`);

      const campaignData = {
        accountId: this.accountId,
        campaignId: String(apiCampaign.campaignId),
        campaignName: apiCampaign.name,
        campaignType: 'sb' as const,
        targetingType: 'manual' as const,
        dailyBudget: String(dailyBudget),
        campaignStatus: normalizedState,
        state: normalizedState as 'enabled' | 'paused' | 'archived' | 'pending' | 'other',
        startDate: sbStartDate,
        endDate: sbEndDate,
        costType: sbCostType, // ✅ 根据Goal动态设置，而非硬编码CPC
        campaignGoal: sbGoal || null, // ✅ 存储原始Goal值
        adFormat: normalizedAdFormat, // ✅ 存储广告格式
        bidOptimization: normalizedBidOpt, // ✅ 存储竞价优化目标
        landingPageType: sbLandingPageType,
        landingPageUrl: sbLandingPageUrl,
        brandEntityId: sbBrandEntityId,
        portfolioId: sbPortfolioId,
        biddingStrategy: sbBiddingStrategy as 'legacyForSales' | 'autoForSales' | 'manual' | 'ruleBasedBidding',
        amazonCreatedDate: sbStartDate, // Amazon侧创建日期
        updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      };

      if (existing) {
        // v168: 零值预算防护 - 如果API返回budget=0但本地有非零值，保留本地值
        const localBudgetSb = parseFloat(existing.dailyBudget || '0');
        if (dailyBudget === 0 && localBudgetSb > 0) {
          log.warn(`v168: SB零值预算防护生效 - campaign=${existing.campaignName}, local=$${localBudgetSb}, api=$${dailyBudget}, 保留本地预算`);
          // @ts-ignore
          delete (campaignData as Record<string, any>[]).dailyBudget;
        }
        await db
          .update(campaigns)
          .set(campaignData)
          .where(eq(campaigns.id, existing.id));
      } else {
        await db.insert(campaigns).values({
          ...campaignData,
          createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
        });
      }
      synced++;
    }

    return { synced, skipped };
  } catch (error) {
    log.error('Error syncing SB campaigns:', error);
    return { synced: 0, skipped: 0 };
  }
};

/**
 * 同步SB品牌广告组
 * 从Amazon SB API获取广告组列表并同步到本地数据库
 */
AmazonSyncService.prototype.syncSbAdGroups = async function(this: AmazonSyncService): Promise<{ synced: number; skipped: number }> {
  const db = await getDb();
  if (!db) return { synced: 0, skipped: 0 };

  try {
    const apiAdGroups = await this.client.listSbAdGroups();
    let synced = 0;
    let skipped = 0;

       log.debug(`获取到 ${apiAdGroups.length} 个SB广告组`);

    // v363: 批量预查询所有相关campaign和adGroup（消除N+1查询）
    const sbAdGroupCampaignIds = [...new Set(apiAdGroups.map(ag => String(ag.campaignId)))];
    const sbCampaignRows = sbAdGroupCampaignIds.length > 0
      ? await db.select().from(campaigns)
          .where(and(eq(campaigns.accountId, this.accountId), inArray(campaigns.campaignId, sbAdGroupCampaignIds)))
      : [];
    const sbCampaignMap = new Map(sbCampaignRows.map(r => [r.campaignId, r]));
    const sbAdGroupIds = apiAdGroups.map(ag => String(ag.adGroupId));
    const existingSbAdGroupRows = sbAdGroupIds.length > 0
      ? await db.select().from(adGroups)
          .where(and(eq(adGroups.accountId, this.accountId), inArray(adGroups.adGroupId, sbAdGroupIds)))
      : [];
    const existingSbAdGroupMap = new Map(existingSbAdGroupRows.map(r => [`${r.campaignId}:${r.adGroupId}`, r]));

    for (const apiAdGroup of apiAdGroups) {
      // v363: 使用批量预查询结果
      const campaign = sbCampaignMap.get(String(apiAdGroup.campaignId));
      if (!campaign) continue;
      const existing = existingSbAdGroupMap.get(`${campaign.campaignId}:${String(apiAdGroup.adGroupId)}`) || null;

      const normalizedState = (apiAdGroup.state || 'enabled').toLowerCase() as 'enabled' | 'paused' | 'archived';

      const adGroupData = {
        campaignId: campaign.campaignId,
        accountId: this.accountId,
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
};

/**
 * 同步SB关键词投放
 * 从Amazon SB API获取关键词列表并同步到本地数据库
 */
AmazonSyncService.prototype.syncSbKeywords = async function(this: AmazonSyncService): Promise<{ synced: number; skipped: number }> {
  const db = await getDb();
  if (!db) return { synced: 0, skipped: 0 };

  try {
    const apiKeywords = await this.client.listSbKeywords();
    let synced = 0;
    let skipped = 0;

     log.debug(`获取到 ${apiKeywords.length} 个SB关键词`);

    // v363: 批量预查询所有相关adGroup和keyword（消除N+1查询）
    const sbKwAdGroupIds = [...new Set(apiKeywords.map(k => String(k.adGroupId)))];
    const sbKwAdGroupRows = sbKwAdGroupIds.length > 0
      ? await db.select().from(adGroups).where(and(eq(adGroups.accountId, this.accountId), inArray(adGroups.adGroupId, sbKwAdGroupIds)))
      : [];
    const sbKwAdGroupMap = new Map(sbKwAdGroupRows.map(r => [r.adGroupId, r]));
    const sbKwIds = apiKeywords.map(k => String(k.keywordId));
    const existingSbKwRows = sbKwIds.length > 0
      ? await db.select().from(keywords).where(and(eq(keywords.accountId, this.accountId), inArray(keywords.keywordId, sbKwIds)))
      : [];
    const existingSbKwMap = new Map(existingSbKwRows.map(r => [`${r.adGroupId}:${r.keywordId}`, r]));

    for (const apiKeyword of apiKeywords) {
      // v363: 使用批量预查询结果
      const adGroup = sbKwAdGroupMap.get(String(apiKeyword.adGroupId));
      if (!adGroup) continue;
      const existing = existingSbKwMap.get(`${String(adGroup.id)}:${String(apiKeyword.keywordId)}`) || null;

      const normalizedMatchType = (apiKeyword.matchType || 'broad').toLowerCase() as 'broad' | 'phrase' | 'exact';
      const normalizedState = (apiKeyword.state || 'enabled').toLowerCase() as 'enabled' | 'paused' | 'archived';

      const keywordData = {
        adGroupId: String(adGroup.id),  // v357
        accountId: this.accountId,
        campaignId: adGroup.campaignId || '',  // v357
        keywordId: String(apiKeyword.keywordId),
        keywordText: apiKeyword.keywordText || apiKeyword.keyword || '',
        matchType: normalizedMatchType,
        bid: String(apiKeyword.bid || 0),
        keywordStatus: normalizedState,
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

    log.info(`SB关键词同步完成: synced=${synced}, skipped=${skipped}`);
    return { synced, skipped };
  } catch (error: unknown) {
    // v332: 增强SB错误日志，记录详细的HTTP状态码和错误信息
    // @ts-ignore
    const statusCode = error?.response?.status || 'unknown';
    // @ts-ignore
    const errorMsg = error?.response?.data?.message || error?.message || 'unknown error';
    log.error(`Error syncing SB keywords: HTTP ${statusCode} - ${errorMsg}`);
    if (statusCode === 404) {
      log.warn('[SB Sync] v332: SB keywords API返回404，该账户可能未开通SB关键词定向或API端点已变更');
    }
    return { synced: 0, skipped: 0 };
  }
};

/**
 * 同步SB商品定位
 * 从Amazon SB API获取商品定位列表并同步到本地数据库
 */
AmazonSyncService.prototype.syncSbProductTargets = async function(this: AmazonSyncService): Promise<{ synced: number; skipped: number }> {
  const db = await getDb();
  if (!db) return { synced: 0, skipped: 0 };

  try {
    const apiTargets = await this.client.listSbTargets();
    let synced = 0;
    let skipped = 0;

      log.debug(`获取到 ${apiTargets.length} 个SB商品定位`);

    // v363: 批量预查询所有相关adGroup和productTarget（消除N+1查询）
    const sbTgtAdGroupIds = [...new Set(apiTargets.map(t => String(t.adGroupId)))];
    const sbTgtAdGroupRows = sbTgtAdGroupIds.length > 0
      ? await db.select().from(adGroups).where(and(eq(adGroups.accountId, this.accountId), inArray(adGroups.adGroupId, sbTgtAdGroupIds)))
      : [];
    const sbTgtAdGroupMap = new Map(sbTgtAdGroupRows.map(r => [r.adGroupId, r]));
    const sbTgtIds = apiTargets.map(t => String(t.targetId));
    const existingSbTgtRows = sbTgtIds.length > 0
      ? await db.select().from(productTargets).where(and(eq(productTargets.accountId, this.accountId), inArray(productTargets.targetId, sbTgtIds)))
      : [];
    const existingSbTgtMap = new Map(existingSbTgtRows.map(r => [`${r.adGroupId}:${r.targetId}`, r]));

    for (const apiTarget of apiTargets) {
      // v363: 使用批量预查询结果
      const adGroup = sbTgtAdGroupMap.get(String(apiTarget.adGroupId));
      if (!adGroup) continue;

      // 解析定向表达式和匹配类型 - 支持ASIN定向和品类定向
      let targetType: 'asin' | 'category' = 'category';
      let targetValue = '';
      let targetExpression = '';
      let targetMatchType: 'exact' | 'expanded' | 'category_exact' | 'brand_exact' | 'substitute' | 'accessory' | 'loose' | 'close' = 'exact';
      let categoryName: string | null = null;
      let categoryRefinements: string | null = null;
      const refinements: Record<string, any> = {};

      const exprArray = apiTarget.expression || apiTarget.expressions || [];
      if (Array.isArray(exprArray) && exprArray.length > 0) {
        targetExpression = JSON.stringify(exprArray);
        
        for (const expr of exprArray) {
          const et = (expr.type || '').toLowerCase();
          
          if (et.includes('categorysame') || et.includes('category')) {
            targetType = 'category';
            targetValue = expr.value || '';
            targetMatchType = 'category_exact';
          } else if (et.includes('brandsame')) {
            targetType = 'category';
            targetValue = expr.value || '';
            targetMatchType = 'brand_exact';
          } else if (et.includes('pricebetween') || et.includes('price')) {
            refinements.priceRange = expr.value;
          } else if (et.includes('reviewrating') || et.includes('star') || et.includes('rating')) {
            refinements.starRating = expr.value;
          } else if (et.includes('expanded') || et.includes('expandedfrom')) {
            targetType = 'asin';
            targetValue = expr.value || '';
            targetMatchType = 'expanded';
          } else if (et.includes('substitute')) {
            targetType = 'asin';
            targetValue = expr.value || 'AUTO_SUBSTITUTES';
            targetMatchType = 'substitute';
          } else if (et.includes('accessory') || et.includes('complement')) {
            targetType = 'asin';
            targetValue = expr.value || 'AUTO_COMPLEMENTS';
            targetMatchType = 'accessory';
          } else if (et.includes('asin') && et.includes('same')) {
            targetType = 'asin';
            targetValue = expr.value || '';
            targetMatchType = 'exact';
          } else if (et.includes('broadrel') || et.includes('loose')) {
            targetValue = expr.value || 'AUTO_LOOSE';
            targetMatchType = 'loose';
          } else if (et.includes('highrel') || et.includes('close')) {
            targetValue = expr.value || 'AUTO_CLOSE';
            targetMatchType = 'close';
          } else if (expr.value && !targetValue) {
            targetValue = expr.value;
          }
        }
        
        if (Object.keys(refinements).length > 0) {
          categoryRefinements = JSON.stringify(refinements);
        }
      } else if (typeof exprArray === 'string') {
        targetExpression = exprArray;
      }

      // v363: 使用批量预查询结果
      const existing = existingSbTgtMap.get(`${String(adGroup.id)}:${String(apiTarget.targetId)}`) || null;

      const normalizedState = (apiTarget.state || 'enabled').toLowerCase() as 'enabled' | 'paused' | 'archived';

       const targetData = {
        adGroupId: String(adGroup.id),  // v357
        campaignId: adGroup.campaignId || '',  // v357
        targetId: String(apiTarget.targetId),
        targetType,
        targetValue,
        targetExpression,
        targetMatchType,
        bid: String(apiTarget.bid || 0),
        targetStatus: normalizedState,
        categoryName: categoryName,
        categoryRefinements: categoryRefinements,
        updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      };
      if (synced === 0) {
        log.debug(`SB产品定向示例: type=${targetType}, value=${targetValue}, matchType=${targetMatchType}, categoryName=${categoryName}`);
      }

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

    log.info(`SB商品定位同步完成: synced=${synced}, skipped=${skipped}`);
    return { synced, skipped };
  } catch (error: unknown) {
    // v332: 增强SB错误日志，记录详细的HTTP状态码和错误信息
    // @ts-ignore
    const statusCode = error?.response?.status || 'unknown';
    // @ts-ignore
    const errorMsg = error?.response?.data?.message || error?.message || 'unknown error';
    log.error(`Error syncing SB product targets: HTTP ${statusCode} - ${errorMsg}`);
    if (statusCode === 404) {
      log.warn('[SB Sync] v332: SB targets API返回404，该账户可能未开通SB商品定向或API端点已变更');
    }
    return { synced: 0, skipped: 0 };
  }
};

/**
 * 同步SB搜索词报告
 * 从Amazon SB搜索词报告获取数据并同步到searchTerms表
 */
AmazonSyncService.prototype.syncSbSearchTerms = async function(this: AmazonSyncService, days: number = 14): Promise<number> {
  const db = await getDb();
  // v358: 数据库不可用是真实错误，不应返回0
  if (!db) throw new Error('DATABASE_UNAVAILABLE: 数据库连接不可用');

  try {
    // v339: Amazon API单次请求最多31天，需要分批请求
    const MAX_DAYS_PER_REQUEST = 31;
    const totalDays = Math.min(days, 60); // SB搜索词最多支持60天
    const { startDate: rangeStartDate, endDate: rangeEndDate } = getMarketplaceDateRange(this.marketplace, totalDays);
    const batches = Math.ceil(totalDays / MAX_DAYS_PER_REQUEST);
    log.info(`v339: 开始同步SB搜索词数据: 共${totalDays}天，分${batches}批请求 (站点: ${this.marketplace})`);

    // v413: 批量提交+统一轮询模式（替代串行循环）
    let allReportData: any[] = [];
    if (batches === 1) {
      try {
        const reportId = await this.client.requestSbSearchTermReport(rangeStartDate, rangeEndDate);
        const data = await this.client.waitAndDownloadReport(reportId, 300000);
        if (data && data.length > 0) allReportData = data;
      } catch (e: unknown) {
        log.error(`v413: SB搜索词报告请求失败:`, (e as Error).message);
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
          name: `SB搜索词第${batch + 1}/${batches}批(${bStart}~${bEnd})`,
          requestFn: () => this.client.requestSbSearchTermReport(bStart, bEnd),
        });
      }
      log.info(`[v413] SB搜索词: ${batches}批次批量提交开始`);
      const results = await this.client.submitAndWaitMultipleReports(batchRequests, 300000, 2000);
      for (const result of results) {
        if (result.data && result.data.length > 0) {
          allReportData = allReportData.concat(result.data);
        } else if (result.error) {
          log.warn(`[v413] ${result.name}失败: ${result.error}`);
        }
      }
    }

    const startDate = rangeStartDate;
    const endDate = rangeEndDate;
    const reportData = allReportData;
    if (!reportData || reportData.length === 0) {
      log.debug('v339: 所有批次SB搜索词报告数据为空');
      return 0;
    }
    log.info(`v339: 共获取到 ${reportData.length} 条SB搜索词数据（${batches}批合并）`);
    
    // v395: 批量预加载所有关联数据，避免逐行N+1查询
    const allCampaigns = await db
      .select({ id: campaigns.id, campaignId: campaigns.campaignId })
      .from(campaigns)
      .where(eq(campaigns.accountId, this.accountId));
    const campaignMap = new Map<string, { id: number; campaignId: string }>();
    for (const c of (allCampaigns as any[])) {
      campaignMap.set(String(c.campaignId), { id: c.id, campaignId: c.campaignId });
    }

    const allAdGroups = await db
      .select({ id: adGroups.id, adGroupId: adGroups.adGroupId })
      .from(adGroups)
      // @ts-ignore
      .where(eq((adGroups as unknown).accountId, this.accountId));
    const adGroupMap = new Map<string, { id: number }>();
    for (const ag of allAdGroups) {
      adGroupMap.set(String(ag.adGroupId), { id: ag.id });
    }

    const allKeywords = await db
      .select({ id: keywords.id, adGroupId: keywords.adGroupId, keywordText: keywords.keywordText, matchType: keywords.matchType })
      .from(keywords)
      // @ts-ignore
      .where(eq((keywords as unknown).accountId, this.accountId));
    const keywordMap = new Map<string, { id: number; matchType: string | null }>();
    for (const kw of (allKeywords as any[])) {
      const key = `${kw.adGroupId}:${(kw.keywordText || '').toLowerCase()}`;
      keywordMap.set(key, { id: kw.id, matchType: kw.matchType });
    }

    const allTargets = await db
      .select({ id: productTargets.id, adGroupId: productTargets.adGroupId, targetValue: productTargets.targetValue, targetMatchType: productTargets.targetMatchType })
      .from(productTargets)
      // @ts-ignore
      .where(eq((productTargets as unknown).accountId, this.accountId));
    const targetMap = new Map<string, { id: number; targetMatchType: string | null }>();
    for (const t of allTargets) {
      const key = `${t.adGroupId}:${(t.targetValue || '').toLowerCase()}`;
      targetMap.set(key, { id: t.id, targetMatchType: t.targetMatchType });
    }

    log.info(`[v395] SB搜索词预加载完成: campaigns=${allCampaigns.length}, adGroups=${allAdGroups.length}, keywords=${allKeywords.length}, targets=${allTargets.length}`);

    let synced = 0;
    let skipped = 0;
    const BATCH_SIZE = 500;
    let upsertBatch: any[] = [];
    const nowStr = new Date().toISOString().slice(0, 19).replace('T', ' ');

    for (const row of (reportData as any[])) {
      const campaign = campaignMap.get(String(row.campaignId));
      if (!campaign) { skipped++; continue; }

      const adGroup = adGroupMap.get(String(row.adGroupId));
      if (!adGroup) { skipped++; continue; }

      const cost = row.cost || 0;
      const sales = row.sales || row.salesClicks || 0;
      const clicks = row.clicks || 0;
      const impressions = row.impressions || 0;
      const orders = row.purchases || row.purchasesClicks || 0;

      const targetingText = row.keywordText || row.targeting || '';
      const matchType = (row.matchType || '').toLowerCase();
      const isProductTarget = matchType === 'targeting';

      let searchTermTargetId: number | null = null;
      let resolvedMatchType = matchType;
      if (!isProductTarget) {
        const kwKey = `${adGroup.id}:${targetingText.toLowerCase()}`;
        const matchedKeyword = keywordMap.get(kwKey);
        if (matchedKeyword) {
          searchTermTargetId = matchedKeyword.id;
          resolvedMatchType = matchedKeyword.matchType || matchType;
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

      // v395: 使用行级date字段（SB报告也是DAILY模式），而非整个范围的startDate
      const rowDate = row.date || startDate;

      upsertBatch.push({
        accountId: this.accountId,
        campaignId: campaign.campaignId,
        adGroupId: String(adGroup.id),
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
        reportStartDate: rowDate,
        reportEndDate: rowDate,
        sourceMatchType,
        sourceTargetType,
        searchTermType,
        searchTermUnitsOrdered: unitsOrdered,
        createdAt: nowStr,
        updatedAt: nowStr,
      });

      if (upsertBatch.length >= BATCH_SIZE) {
        await flushSearchTermBatch(db, upsertBatch);
        synced += upsertBatch.length;
        upsertBatch = [];
      }
    }

    if (upsertBatch.length > 0) {
      await flushSearchTermBatch(db, upsertBatch);
      synced += upsertBatch.length;
      upsertBatch = [];
    }

    log.info(`[v395] SB搜索词同步完成: 同步=${synced}, 跳过=${skipped}`);
    return synced;
  } catch (error) {
    log.error('同步SB搜索词失败:', error);
    // v358: 抛出错误而不是返回0
    throw error;
  }
};

/**
 * 同步SB定向数据
 * 获取SB广告的关键词和商品定向数据
 */
AmazonSyncService.prototype.syncSbTargeting = async function(this: AmazonSyncService, days: number = 14): Promise<number> {
  const db = await getDb();
  // v358: 数据库不可用是真实错误，不应返回0
  if (!db) throw new Error('DATABASE_UNAVAILABLE: 数据库连接不可用');

  try {
    // v339: Amazon API单次请求最多31天，需要分批请求
    const MAX_DAYS_PER_REQUEST = 31;
    const totalDays = Math.min(days, 60); // SB定向最多支持60天
    const { startDate: rangeStartDate, endDate: rangeEndDate } = getMarketplaceDateRange(this.marketplace, totalDays);
    const batches = Math.ceil(totalDays / MAX_DAYS_PER_REQUEST);
    log.info(`v339: 开始同步SB定向数据: 共${totalDays}天，分${batches}批请求 (站点: ${this.marketplace})`);

    // v413: 批量提交+统一轮询模式（替代串行循环）
    let allReportData: any[] = [];
    if (batches === 1) {
      try {
        const reportId = await this.client.requestSbTargetingReport(rangeStartDate, rangeEndDate);
        const data = await this.client.waitAndDownloadReport(reportId, 300000);
        if (data && data.length > 0) allReportData = data;
      } catch (e: unknown) {
        log.error(`v413: SB定向报告请求失败:`, (e as Error).message);
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
          name: `SB定向第${batch + 1}/${batches}批(${bStart}~${bEnd})`,
          requestFn: () => this.client.requestSbTargetingReport(bStart, bEnd),
        });
      }
      log.info(`[v413] SB定向: ${batches}批次批量提交开始`);
      const results = await this.client.submitAndWaitMultipleReports(batchRequests, 300000, 2000);
      for (const result of results) {
        if (result.data && result.data.length > 0) {
          allReportData = allReportData.concat(result.data);
        } else if (result.error) {
          log.warn(`[v413] ${result.name}失败: ${result.error}`);
        }
      }
    }

    const reportData = allReportData;
    if (!reportData || reportData.length === 0) {
      log.debug('v339: 所有批次SB定向报告数据为空');
      return 0;
    }
    log.info(`v339: 共获取到 ${reportData.length} 条SB定向数据（${batches}批合并）`);
    let synced = 0;

    for (const row of (reportData as any[])) {
       // v387: 查找对应的adGroup（添加accountId过滤）
      const [adGroup] = await db
        .select()
        .from(adGroups)
        .where(and(eq(adGroups.accountId, this.accountId), eq(adGroups.adGroupId, String(row.adGroupId))))
        .limit(1);
      if (!adGroup) continue;
      // SB主要是关键词定向向
      if (row.keywordId) {
        // 检查关键词是否已存在
        const [existing] = await db
          .select()
          .from(keywords)
          .where(
            and(
              eq(keywords.adGroupId, String(adGroup.id)),
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
          adGroupId: String(adGroup.id),  // v357
          accountId: this.accountId,
          campaignId: adGroup.campaignId || '',  // v357
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
    // v358: 抛出错误而不是返回0
    throw error;
  }
};

/**
 * 同步SB广告素材（品牌广告的创意素材详情）
 * 包含: headline, brandLogo, customImage, video, brandName等
 * 写入ad_groups表的creative字段
 */
AmazonSyncService.prototype.syncSbAds = async function(this: AmazonSyncService): Promise<{ synced: number; skipped: number }> {
  const db = await getDb();
  if (!db) return { synced: 0, skipped: 0 };
  try {
    const apiAds = await this.client.listSbAds();
    let synced = 0;
    let skipped = 0;
    log.debug(`获取到 ${apiAds.length} 个SB广告素材`);
    
    // 调试：输出第一个广告素材的完整结构
    if (apiAds.length > 0) {
      log.debug('SB广告素材API返回结构示例:', JSON.stringify(apiAds[0], null, 2));
    }
    
    // v363: 批量预查询所有相关adGroup（消除N+1查询）
    const sbAdAdGroupIds = [...new Set(apiAds.map(a => String(a.adGroupId)))];
    const sbAdAdGroupRows = sbAdAdGroupIds.length > 0
      ? await db.select().from(adGroups).where(and(eq(adGroups.accountId, this.accountId), inArray(adGroups.adGroupId, sbAdAdGroupIds)))
      : [];
    const sbAdAdGroupMap = new Map(sbAdAdGroupRows.map(r => [r.adGroupId, r]));

    for (const ad of apiAds) {
      // v363: 使用批量预查询结果
      const adGroupIdStr = String(ad.adGroupId);
      const adGroup = sbAdAdGroupMap.get(adGroupIdStr) || null;
      
      if (!adGroup) {
        skipped++;
        continue;
      }
      
      // 提取素材信息
      const creative = ad.creative || ad;
      const headline = creative.headline || ad.headline || null;
      const brandLogoAssetId = creative.brandLogoAssetID || creative.brandLogoAssetId || 
                              creative.brandLogo?.assetId || null;
      const customImageAssetId = creative.customImageAssetID || creative.customImageAssetId || 
                                creative.customImage?.assetId || null;
      const videoAssetId = creative.video?.assetId || creative.videoAssetId || null;
      const creativeType = ad.creativeType || creative.type || null;
      
      // 更新广告组的素材字段
      const updateData: Record<string, any> = {
        updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      };
      if (headline) updateData.headline = headline;
      if (brandLogoAssetId) updateData.brandLogoAssetId = brandLogoAssetId;
      if (customImageAssetId) updateData.customImageAssetId = customImageAssetId;
      if (videoAssetId) updateData.videoAssetId = videoAssetId;
      if (creativeType) updateData.creativeType = creativeType;
      
      await db.update(adGroups)
        .set(updateData)
        .where(eq(adGroups.id, adGroup.id));
      synced++;
    }
    
    log.info(`SB广告素材同步完成: synced=${synced}, skipped=${skipped}`);
    return { synced, skipped };
  } catch (error: unknown) {
    log.error('SB广告素材同步失败:', (error as Error).message);
    return { synced: 0, skipped: 0 };
  }
};

/**
 * 同步SB否定关键词
 * 从SB API获取否定关键词并同步到negative_keywords表
 */
AmazonSyncService.prototype.syncSbNegativeKeywords = async function(this: AmazonSyncService): Promise<{ synced: number; updated: number }> {
  const db = await getDb();
  if (!db) return { synced: 0, updated: 0 };
  try {
    let synced = 0;
    let updated = 0;
    
    const sbNegatives = await this.client.listSbNegativeKeywords();
    log.debug(`获取到 ${sbNegatives.length} 个SB否定关键词`);
    
    // v363: 批量预查询所有相关campaign和adGroup（消除N+1查询）
    const sbNegCampaignIds = [...new Set(sbNegatives.map(n => String(n.campaignId)))];
    const sbNegCampaignRows = sbNegCampaignIds.length > 0
      ? await db.select().from(campaigns)
          .where(and(eq(campaigns.accountId, this.accountId), inArray(campaigns.campaignId, sbNegCampaignIds)))
      : [];
    const sbNegCampaignMap = new Map(sbNegCampaignRows.map(r => [r.campaignId, r]));
    const sbNegAdGroupIds = [...new Set(sbNegatives.filter(n => n.adGroupId).map(n => String(n.adGroupId)))];
    const sbNegAdGroupRows = sbNegAdGroupIds.length > 0
      ? await db.select().from(adGroups).where(and(eq(adGroups.accountId, this.accountId), inArray(adGroups.adGroupId, sbNegAdGroupIds)))
      : [];
    const sbNegAdGroupMap = new Map(sbNegAdGroupRows.map(r => [r.adGroupId, r]));

    for (const neg of sbNegatives) {
      const negState = (neg.state || 'enabled').toLowerCase();
      if (negState === 'archived') continue;
      
      // v363: 使用批量预查询结果
      const campaign = sbNegCampaignMap.get(String(neg.campaignId));
      if (!campaign) continue;
      
      // v363: 使用批量预查询结果
      let adGroupId: string | null = null;
      if (neg.adGroupId) {
        const adGroup = sbNegAdGroupMap.get(String(neg.adGroupId));
        if (adGroup) adGroupId = String(adGroup.id);
      }
      
      const matchType = (neg.matchType || '').toLowerCase().includes('phrase') 
        ? 'negative_phrase' as const 
        : 'negative_exact' as const;
      const amazonKeywordId = String(neg.keywordId || neg.negativeKeywordId || '');
      const negLevel = adGroupId ? 'ad_group' as const : 'campaign' as const;
      
      const [existing] = await db
        .select()
        .from(negativeKeywords)
        .where(
          and(
            eq(negativeKeywords.accountId, this.accountId),
            eq(negativeKeywords.campaignId, String(campaign.campaignId)),
            eq(negativeKeywords.negativeLevel, negLevel),
            eq(negativeKeywords.negativeText, neg.keywordText || '')
          )
        )
        .limit(1);
      
      if (existing) {
        await db.update(negativeKeywords)
          .set({ negativeMatchType: matchType, amazonNegativeKeywordId: amazonKeywordId || null, negativeStatus: 'active' as const })
          .where(eq(negativeKeywords.id, existing.id));
        updated++;
      } else {
        await db.insert(negativeKeywords).values({
          accountId: this.accountId,
          campaignId: String(campaign.campaignId),
          adGroupId: adGroupId,
          negativeLevel: negLevel,
          negativeType: 'keyword',
          negativeText: neg.keywordText || '',
          negativeMatchType: matchType,
          amazonNegativeKeywordId: amazonKeywordId || null,
          negativeSource: 'manual',
          negativeStatus: 'active',
        });
        synced++;
      }
    }
    
    log.info(`SB否定关键词同步完成: ${synced}条新增, ${updated}条更新`);
    return { synced, updated };
  } catch (error: unknown) {
    log.error('SB否定关键词同步失败:', (error as Error).message);
    return { synced: 0, updated: 0 };
  }
};

/**
 * 同步SB否定商品定向
 */
AmazonSyncService.prototype.syncSbNegativeTargets = async function(this: AmazonSyncService): Promise<{ synced: number; updated: number }> {
  const db = await getDb();
  if (!db) return { synced: 0, updated: 0 };
  try {
    let synced = 0;
    let updated = 0;
    
    const sbNegTargets = await this.client.listSbNegativeTargets();
    log.debug(`获取到 ${sbNegTargets.length} 个SB否定商品定向`);
    
    // v363: 批量预查询所有相关campaign和adGroup（消除N+1查询）
    const sbNegTgtCampaignIds = [...new Set(sbNegTargets.map(n => String(n.campaignId)))];
    const sbNegTgtCampaignRows = sbNegTgtCampaignIds.length > 0
      ? await db.select().from(campaigns)
          .where(and(eq(campaigns.accountId, this.accountId), inArray(campaigns.campaignId, sbNegTgtCampaignIds)))
      : [];
    const sbNegTgtCampaignMap = new Map(sbNegTgtCampaignRows.map(r => [r.campaignId, r]));
    const sbNegTgtAdGroupIds = [...new Set(sbNegTargets.filter(n => n.adGroupId).map(n => String(n.adGroupId)))];
    const sbNegTgtAdGroupRows = sbNegTgtAdGroupIds.length > 0
      ? await db.select().from(adGroups).where(and(eq(adGroups.accountId, this.accountId), inArray(adGroups.adGroupId, sbNegTgtAdGroupIds)))
      : [];
    const sbNegTgtAdGroupMap = new Map(sbNegTgtAdGroupRows.map(r => [r.adGroupId, r]));

    for (const neg of sbNegTargets) {
      const negState = (neg.state || 'enabled').toLowerCase();
      if (negState === 'archived') continue;
      
      // v363: 使用批量预查询结果
      const campaign = sbNegTgtCampaignMap.get(String(neg.campaignId));
      if (!campaign) continue;
      
      // v363: 使用批量预查询结果
      let adGroupId: string | null = null;
      if (neg.adGroupId) {
        const adGroup = sbNegTgtAdGroupMap.get(String(neg.adGroupId));
        if (adGroup) adGroupId = String(adGroup.id);
      }
      
      const expression = neg.expression || [];
      const asinExpr = expression.find((e: Record<string, any>) => e.type?.toLowerCase().includes('asin'));
      const negativeText = asinExpr?.value || JSON.stringify(expression);
      const amazonTargetId = String(neg.targetId || '');
      const negLevel = adGroupId ? 'ad_group' as const : 'campaign' as const;
      
      const [existing] = await db
        .select()
        .from(negativeKeywords)
        .where(
          and(
            eq(negativeKeywords.accountId, this.accountId),
            eq(negativeKeywords.campaignId, String(campaign.campaignId)),
            eq(negativeKeywords.negativeLevel, negLevel),
            eq(negativeKeywords.negativeType, 'product'),
            eq(negativeKeywords.negativeText, negativeText)
          )
        )
        .limit(1);
      
      if (existing) {
        await db.update(negativeKeywords)
          .set({ amazonNegativeKeywordId: amazonTargetId || null, negativeStatus: 'active' as const })
          .where(eq(negativeKeywords.id, existing.id));
        updated++;
      } else {
        await db.insert(negativeKeywords).values({
          accountId: this.accountId,
          campaignId: String(campaign.campaignId),
          adGroupId: adGroupId,
          negativeLevel: negLevel,
          negativeType: 'product',
          negativeText: negativeText,
          negativeMatchType: 'negative_exact',
          amazonNegativeKeywordId: amazonTargetId || null,
          negativeSource: 'manual',
          negativeStatus: 'active',
        });
        synced++;
      }
    }
    
    log.info(`SB否定商品定向同步完成: ${synced}条新增, ${updated}条更新`);
    return { synced, updated };
  } catch (error: unknown) {
    log.error('SB否定商品定向同步失败:', (error as Error).message);
    return { synced: 0, updated: 0 };
  }
};

/**
 * 同步SB广告位绩效数据
 * 通过SB Placement报告获取广告位级别的绩效数据
 */
AmazonSyncService.prototype.syncSbPlacementPerformance = async function(this: AmazonSyncService, days: number = 14): Promise<number> {
  const db = await getDb();
  // v358: 数据库不可用是真实错误，不应返回0
  if (!db) throw new Error('DATABASE_UNAVAILABLE: 数据库连接不可用');
  let synced = 0;
  try {
    // v339: Amazon API单次请求最多31天，需要分批请求
    const MAX_DAYS_PER_REQUEST = 31;
    const totalDays = Math.min(days, 60); // SB广告位最多支持60天
    const { startDate: rangeStartDate, endDate: rangeEndDate } = getMarketplaceDateRange(this.marketplace, totalDays);
    const batches = Math.ceil(totalDays / MAX_DAYS_PER_REQUEST);
    log.info(`v339: 开始同步SB广告位绩效: 共${totalDays}天，分${batches}批请求 (站点: ${this.marketplace})`);

    // v413: 批量提交+统一轮询模式（替代串行循环）
    let allReportData: any[] = [];
    if (batches === 1) {
      try {
        const reportId = await this.client.requestSbCampaignPlacementReport(rangeStartDate, rangeEndDate);
        const data = await this.client.waitAndDownloadReport(reportId);
        if (data && data.length > 0) allReportData = data;
      } catch (e: unknown) {
        log.error(`v413: SB广告位报告请求失败:`, (e as Error).message);
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
          name: `SB广告位第${batch + 1}/${batches}批(${bStart}~${bEnd})`,
          requestFn: () => this.client.requestSbCampaignPlacementReport(bStart, bEnd),
        });
      }
      log.info(`[v413] SB广告位: ${batches}批次批量提交开始`);
      const results = await this.client.submitAndWaitMultipleReports(batchRequests, 300000, 2000);
      for (const result of results) {
        if (result.data && result.data.length > 0) {
          allReportData = allReportData.concat(result.data);
        } else if (result.error) {
          log.warn(`[v413] ${result.name}失败: ${result.error}`);
        }
      }
    }

    const reportData = allReportData;
    if (!reportData || reportData.length === 0) {
      log.debug('v339: 所有批次SB广告位报告数据为空');
      return 0;
    }
    log.info(`v339: 共获取到 ${reportData.length} 条SB广告位数据（${batches}批合并）`);
    
    for (const row of (reportData as any[])) {
      const campaignIdStr = String(row.campaignId);
      const [campaign] = await db
        .select()
        .from(campaigns)
        .where(
          and(
            eq(campaigns.accountId, this.accountId),
            eq(campaigns.campaignId, campaignIdStr)
          )
        )
        .limit(1);
      if (!campaign) continue;
      
      const dateStr = row.date || rangeStartDate;
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
            eq(placementPerformance.accountId, this.accountId),
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
        accountId: this.accountId,
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
    
    log.info(`SB广告位绩效同步完成: ${synced}条`);
  } catch (error: unknown) {
    log.error('SB广告位绩效同步失败:', (error as Error).message);
  }
  return synced;
};

