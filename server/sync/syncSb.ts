/**
 * SB (Sponsored Brands) 广告数据同步方法
 * 
 * 从 amazonSyncService.ts 中提取的 syncSb 子模块。
 * 通过 prototype 扩展模式将方法注入到 AmazonSyncService 类中。
 */
import { eq, and, sql, gte, lte, inArray, desc, asc, isNull, isNotNull } from 'drizzle-orm';
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
import type { AmazonAdsApiClient, SpCampaign } from './amazonAdsApi';
import { getMarketplaceDateRange, getMarketplaceCurrentDate, getMarketplaceYesterday, getMarketplaceHistoricalDateRange } from '../utils/timezone';
import { getExchangeRateByMarketplace } from '../services/exchangeRateService';
import { AmazonSyncService, flushSearchTermBatch } from './amazonSyncService';
import {
  SYNC_PROTECTION_CONFIG,
  createSyncProtectionStats,
  logSyncProtectionSummary,
  hasRecentSyncedOptimization,
  getRecentlyOptimizedKeywordIds,
  getRecentlyOptimizedCampaignIds,
} from './syncHelpers';
import { getLocalKeywordBidRecommendation, getLocalTargetBidRecommendation } from '../optimization/localBidRecommendationEngine';

const log = createModuleLogger('syncSb');

// ==================== 类型声明（模块扩展） ====================

// @ts-expect-error Legacy code type compatibility
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
    syncSbBidRecommendations(...args: unknown[]): unknown;
  }
}

// ==================== 方法实现 ====================

/**
 * 同步SB品牌广告活动
 * @param lastSyncTime 上次同步时间，用于增量同步
 */
// @ts-expect-error Dynamic property access
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
      // @ts-expect-error Dynamic property access
      } else if (apiCampaign.budget && typeof apiCampaign.budget === 'object') {
        // 兑容旧版本的对象格式
        // @ts-expect-error Legacy code type compatibility
        dailyBudget = apiCampaign.budget.budget || apiCampaign.budget.dailyBudget || 0;
      } else if (apiCampaign.dailyBudget) {
        // @ts-expect-error Legacy code type compatibility
        dailyBudget = apiCampaign.dailyBudget;
      }
      
      // budgetType 是独立字段
      // @ts-expect-error Type inference limitation
      const budgetType = (apiCampaign.budgetType || 'DAILY').toLowerCase() as 'daily' | 'lifetime';
      
      // SB API v4 的状态字段可能是 state 或 status
      const campaignState = apiCampaign.state || apiCampaign.status || 'enabled';
      // 确保状态值是有效的枚举值
      const validStates = ['enabled', 'paused', 'archived'];
      // @ts-expect-error Type inference limitation
      const normalizedState = validStates.includes(campaignState.toLowerCase()) 
        // @ts-expect-error Conditional type narrowing
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
        // @ts-expect-error Legacy code type compatibility
        }
      }

      // 获取SB广告的组合ID
      const sbPortfolioId = (apiCampaign as Record<string, unknown>).portfolioId ? String((apiCampaign as Record<string, unknown>).portfolioId) : null;

      // 获取SB广告的竞价策略
      // @ts-expect-error Amazon API response type flexibility
      const sbBiddingStrategy = (apiCampaign as Record<string, unknown>).bidding?.strategy || 
                                (apiCampaign as Record<string, unknown>).biddingStrategy || 
                                'legacyForSales';

      // ✅ 根据SB广告的Campaign Goal确定计费方式
      // SB v4 API返回的goal字段决定计费模式:
      //   - DRIVE_PAGE_VISITS → CPC计费（按点击付费）
      //   - GROW_BRAND_IMPRESSION_SHARE → vCPM计费（按千次可见展示付费）
      //   - PROMOTE_PRODUCTS → CPC计费（推广产品）
      // 注意：同一种SB广告格式（Video/Product Collection/Store Spotlight）
      //       既可以是CPC也可以是vCPM，完全取决于创建时选择的Goal
      const sbGoal = (apiCampaign as Record<string, unknown>).goal || (apiCampaign as Record<string, unknown>).campaignGoal || '';
      let sbCostType: 'cpc' | 'vcpm' | 'cpm' = 'cpc'; // 默认CPC
      if (sbGoal === 'GROW_BRAND_IMPRESSION_SHARE' || sbGoal === 'growBrandImpressionShare') {
        sbCostType = 'vcpm';
      }
      // v500: Reserve SOV使用固定价格（非竞价模式），以vCPM记录
      if (sbGoal === 'RESERVE_SHARE_OF_VOICE' || sbGoal === 'reserveShareOfVoice') {
        sbCostType = 'vcpm';
      }
      // 也检查API是否直接返回了costType字段（某些API版本可能直接返回）
      if ((apiCampaign as Record<string, unknown>).costType) {
        // @ts-expect-error Dynamic type assertion
        const apiCostType = String((apiCampaign as Record<string, unknown>).costType).toLowerCase();
        if (apiCostType === 'vcpm' || apiCostType === 'cpm') {
          // @ts-expect-error Legacy code type compatibility
          sbCostType = apiCostType as 'vcpm' | 'cpm';
        }
      }

      // v436: 增强SB广告格式获取逻辑 — 尝试多个字段路径和campaign名称推断
      const rawAdFormat = (apiCampaign as Record<string, unknown>).adFormat 
        // @ts-expect-error Dynamic type assertion
        || (apiCampaign as Record<string, unknown>).creative?.adFormat
        || (apiCampaign as Record<string, unknown>).creativeType
        // @ts-expect-error Dynamic type assertion
        || (apiCampaign as Record<string, unknown>).creative?.type
        || (apiCampaign as Record<string, unknown>).format
        || null;
      const validAdFormats = ['productCollection', 'video', 'storeSpotlight', 'brandVideo'];
      let normalizedAdFormat: string | null = validAdFormats.includes(rawAdFormat) ? rawAdFormat : null;
      // v436: 如果API未返回adFormat，从campaign名称推断
      if (!normalizedAdFormat && apiCampaign.name) {
        // @ts-expect-error Type inference limitation
        const campNameUpper = apiCampaign.name.toUpperCase();
        if (campNameUpper.includes('SBV') || campNameUpper.includes('VIDEO') || campNameUpper.includes('BRAND VIDEO')) {
          // @ts-expect-error Legacy code type compatibility
          normalizedAdFormat = 'video';
          log.debug(`v436: 从campaign名称推断 adFormat=video: ${apiCampaign.name}`);
        } else if (campNameUpper.includes('STORE SPOTLIGHT') || campNameUpper.includes('SPOTLIGHT')) {
          // @ts-expect-error Legacy code type compatibility
          normalizedAdFormat = 'storeSpotlight';
        // @ts-expect-error Legacy code type compatibility
        }
      }
      log.debug(`v436: SB campaign ${apiCampaign.name} adFormat: raw=${rawAdFormat}, normalized=${normalizedAdFormat}`);

      // 获取SB广告的竞价优化目标
      const sbBidOptimization = (apiCampaign as Record<string, unknown>).bidOptimization || null;
      const validBidOpts = ['reach', 'pageVisits', 'conversions'];
      // @ts-expect-error Type inference limitation
      const normalizedBidOpt = validBidOpts.includes(sbBidOptimization) ? sbBidOptimization : null;

      // 获取SB广告的landing page信息
      // @ts-expect-error Dynamic type assertion
      const sbLandingPageType = (apiCampaign as Record<string, unknown>).landingPage?.pageType || (apiCampaign as Record<string, unknown>).landingPageType || null;
      // @ts-expect-error Dynamic type assertion
      const sbLandingPageUrl = (apiCampaign as Record<string, unknown>).landingPage?.url || (apiCampaign as Record<string, unknown>).landingPageUrl || null;
      const sbBrandEntityId = (apiCampaign as Record<string, unknown>).brandEntityId || null;

      // v500: 提取SB广告的Placement Bid Adjustments（版位竞价调整）
      // SB v4 API返回的bidding.adjustments数组包含版位竞价调整
      // 格式: { predicate: 'placementTop'|'placementProductPage'|'placementRestOfSearch', percentage: number }
      const biddingObj = (apiCampaign as Record<string, unknown>).bidding as Record<string, unknown> | undefined;
      const bidAdjustments = (biddingObj?.adjustments || []) as Array<{ predicate?: string; percentage?: number }>;
      let sbPlacementTopAdj = 0;
      let sbPlacementProductAdj = 0;
      let sbPlacementRestAdj = 0;
      let sbAudienceBidAdj = 0;
      for (const adj of bidAdjustments) {
        const pred = (adj.predicate || '').toLowerCase();
        const pct = adj.percentage || 0;
        if (pred.includes('top') || pred === 'placementtop') {
          sbPlacementTopAdj = pct;
        } else if (pred.includes('product') || pred === 'placementproductpage') {
          sbPlacementProductAdj = pct;
        } else if (pred.includes('rest') || pred === 'placementrestofsearch') {
          sbPlacementRestAdj = pct;
        } else if (pred.includes('audience') || pred === 'audiences') {
          sbAudienceBidAdj = pct;
        }
      }
      // 也尝试从bidding对象的直接字段中获取（某些API版本）
      if (sbPlacementTopAdj === 0 && biddingObj?.placementTop) {
        sbPlacementTopAdj = Number(biddingObj.placementTop) || 0;
      }
      if (sbAudienceBidAdj === 0 && biddingObj?.audienceBidAdjustment) {
        sbAudienceBidAdj = Number(biddingObj.audienceBidAdjustment) || 0;
      }

      // v500: 提取Reserve SOV特有字段
      let sbReserveSovBudget: string | null = null;
      let sbCampaignDurationDays: number | null = null;
      if (sbGoal === 'RESERVE_SHARE_OF_VOICE' || sbGoal === 'reserveShareOfVoice') {
        // Reserve SOV使用固定预算（非竞价模式）
        const sovBudget = (apiCampaign as Record<string, unknown>).reservedBudget || 
                          (apiCampaign as Record<string, unknown>).fixedBudget || null;
        if (sovBudget) sbReserveSovBudget = String(sovBudget);
        // 活动持续天数
        if (sbStartDate && sbEndDate) {
          const start = new Date(sbStartDate);
          const end = new Date(sbEndDate);
          sbCampaignDurationDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
        }
      }

      log.debug(`SB广告 ${apiCampaign.name}: goal=${sbGoal}, costType=${sbCostType}, adFormat=${normalizedAdFormat}, placementTop=${sbPlacementTopAdj}%, audienceAdj=${sbAudienceBidAdj}%`);

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
        // v500: SB版位竞价调整
        placementTopSearchBidAdjustment: sbPlacementTopAdj,
        placementProductPageBidAdjustment: sbPlacementProductAdj,
        placementRestBidAdjustment: sbPlacementRestAdj,
        // v500: SB受众竞价调整
        sbAudienceBidAdjustment: sbAudienceBidAdj,
        // @ts-expect-error Conditional type narrowing
        sbPlacementTopMultiplier: sbPlacementTopAdj > 0 ? String(1 + sbPlacementTopAdj / 100) : null,
        sbPlacementProductMultiplier: sbPlacementProductAdj > 0 ? String(1 + sbPlacementProductAdj / 100) : null,
        sbPlacementRestMultiplier: sbPlacementRestAdj > 0 ? String(1 + sbPlacementRestAdj / 100) : null,
        // v500: Reserve SOV特有字段
        // @ts-expect-error Legacy code type compatibility
        sbReserveSovBudget: sbReserveSovBudget,
        sbCampaignDurationDays: sbCampaignDurationDays,
        updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      // @ts-expect-error Legacy code type compatibility
      };

      if (existing) {
        // v168: 零值预算防护 - 如果API返回budget=0但本地有非零值，保留本地值
        const localBudgetSb = parseFloat(existing.dailyBudget || '0');
        if (dailyBudget === 0 && localBudgetSb > 0) {
          log.warn(`v168: SB零值预算防护生效 - campaign=${existing.campaignName}, local=$${localBudgetSb}, api=$${dailyBudget}, 保留本地预算`);
          // @ts-expect-error Dynamic type assertion
          delete (campaignData as Record<string, unknown>[]).dailyBudget;
        }
        await db
          .update(campaigns)
          // @ts-expect-error DB query type inference limitation
          .set(campaignData)
          .where(eq(campaigns.id, existing.id));
      } else {
        // @ts-expect-error DB query type inference limitation
        await db.insert(campaigns).values({
          ...campaignData,
          // @ts-expect-error Legacy code type compatibility
          createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
        });
      }
      synced++;
    }

    return { synced, skipped };
  } catch (error: any) {
    log.warn(`Error syncing SB campaigns: ${(error as Error).message || JSON.stringify(error)}`);
    return { synced: 0, skipped: 0 };
  }
};

/**
 * 同步SB品牌广告组
 * 从Amazon SB API获取广告组列表并同步到本地数据库
 */
// @ts-expect-error Dynamic property access
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
    // @ts-expect-error Dynamic property access
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
      // @ts-expect-error Amazon API response type flexibility
      const existing = existingSbAdGroupMap.get(`${campaign.campaignId}:${String(apiAdGroup.adGroupId)}`) || null;

      // @ts-expect-error Type inference limitation
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
          // @ts-expect-error DB query type inference limitation
          .set(adGroupData)
          .where(eq(adGroups.id, existing.id));
      } else {
        // @ts-expect-error DB query type inference limitation
        await db.insert(adGroups).values({
          ...adGroupData,
          createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
        });
      }
      synced++;
    }

    log.info(`SB广告组同步完成: synced=${synced}, skipped=${skipped}`);
    return { synced, skipped };
  } catch (error: any) {
    log.warn(`Error syncing SB ad groups: ${(error as Error).message || JSON.stringify(error)}`);
    return { synced: 0, skipped: 0 };
  }
};

/**
 * 同步SB关键词投放
 * 从Amazon SB API获取关键词列表并同步到本地数据库
 */
// @ts-expect-error Dynamic property access
AmazonSyncService.prototype.syncSbKeywords = async function(this: AmazonSyncService): Promise<{ synced: number; skipped: number }> {
  const db = await getDb();
  if (!db) return { synced: 0, skipped: 0 };

  try {
    const apiKeywords = await this.client.listSbKeywords();
    let synced = 0;
    // @ts-expect-error Type inference limitation
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
    const existingSbKwMap = new Map(existingSbKwRows.map(r => [`${r.internalAdGroupId}:${r.keywordId}`, r]));  // v421: 使用internalAdGroupId
    
    // v647: 二次匹配索引 — 通过 adGroupId+keywordText+matchType 匹配已有记录
    // 用于修复已有记录的keywordId字段被污染为text:前缀表达式的情况
    const sbAdGroupInternalIds = sbKwAdGroupRows.map(r => r.id);
    const allSbAccountKwRows = sbAdGroupInternalIds.length > 0
      ? await db.select().from(keywords).where(and(eq(keywords.accountId, this.accountId), inArray(keywords.internalAdGroupId, sbAdGroupInternalIds)))
      : [];
    const sbTextMatchMap = new Map<string, typeof allSbAccountKwRows[0]>();
    let sbCorruptedCount = 0;
    for (const r of allSbAccountKwRows) {
      if (r.keywordText && r.internalAdGroupId && r.matchType) {
        const key = `${r.internalAdGroupId}:${r.keywordText.toLowerCase().trim()}:${r.matchType.toLowerCase()}`;
        sbTextMatchMap.set(key, r);
      }
      if (r.keywordId && !/^\d+$/.test(r.keywordId.trim())) {
        sbCorruptedCount++;
      }
    }
    if (sbCorruptedCount > 0) {
      log.warn(`[v647] SB关键词发现${sbCorruptedCount}个非数字keywordId记录，将在同步时修复`);
    }
    let sbKeywordIdRepaired = 0;

    for (const apiKeyword of apiKeywords) {
      // v363: 使用批量预查询结果
      // @ts-expect-error Type inference limitation
      const adGroup = sbKwAdGroupMap.get(String(apiKeyword.adGroupId));
      if (!adGroup) continue;
      let existing = existingSbKwMap.get(`${String(adGroup.id)}:${String(apiKeyword.keywordId)}`) || null;
      
      // v647: 二次匹配 — 当通过keywordId匹配不到时，通过adGroupId+keywordText+matchType匹配
      if (!existing) {
        const kwText = apiKeyword.keywordText || apiKeyword.keyword || '';
        const normalizedMatch = (apiKeyword.matchType || 'broad').toLowerCase();
        if (kwText) {
          const textKey = `${adGroup.id}:${kwText.toLowerCase().trim()}:${normalizedMatch}`;
          const textMatched = sbTextMatchMap.get(textKey);
          if (textMatched) {
            const oldKwId = textMatched.keywordId || '';
            const newKwId = String(apiKeyword.keywordId);
            if (oldKwId !== newKwId) {
              log.info(`[v647] 修复SB keywordId: keyword="${kwText.substring(0, 40)}" 旧ID="${oldKwId.substring(0, 50)}" → 新ID="${newKwId}"`);
              sbKeywordIdRepaired++;
            }
            existing = textMatched;
          }
        }
      }

      // @ts-expect-error Type inference limitation
      const normalizedMatchType = (apiKeyword.matchType || 'broad').toLowerCase() as 'broad' | 'phrase' | 'exact';
      // @ts-expect-error Type inference limitation
      const normalizedState = (apiKeyword.state || 'enabled').toLowerCase() as 'enabled' | 'paused' | 'archived';

      const keywordData = {
        internalAdGroupId: adGroup.id,  // v418: ID体系重构
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
        // v523.2: 保护 amazon_deleted 状态不被同步覆盖
        if (existing.keywordStatus === 'amazon_deleted' && normalizedState !== 'archived') {
          log.debug(`v523.2: 保护SB(syncSb) keyword amazon_deleted状态 - keyword=${existing.keywordText}(id=${existing.id})`);
          delete (keywordData as Record<string, unknown>).keywordStatus;
        }
        await db
          .update(keywords)
          // @ts-expect-error DB query type inference limitation
          .set(keywordData)
          .where(eq(keywords.id, existing.id));
      } else {
        // @ts-expect-error DB query type inference limitation
        await db.insert(keywords).values({
          ...keywordData,
          // @ts-expect-error Legacy code type compatibility
          createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
        });
      }
      synced++;
    }

    log.info(`SB关键词同步完成: synced=${synced}, skipped=${skipped}`);
    if (sbKeywordIdRepaired > 0) {
      log.info(`[v647] SB关键词同步完成: 修复了${sbKeywordIdRepaired}个被污染的keywordId`);
    }
    return { synced, skipped };
  } catch (error: unknown) {
    // v332: 增强SB错误日志，记录详细的HTTP状态码和错误信息
    // @ts-expect-error - Axios error response access
    const statusCode = error?.response?.status || 'unknown';
    // @ts-expect-error - error message access
    const errorMsg = error?.response?.data?.message || error?.message || 'unknown error';
    log.warn(`Error syncing SB keywords: HTTP ${statusCode} - ${errorMsg}`);
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
// @ts-expect-error Dynamic property access
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
    const existingSbTgtMap = new Map(existingSbTgtRows.map(r => [`${r.internalAdGroupId}:${r.targetId}`, r]));  // v421: 使用internalAdGroupId

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
      const refinements: Record<string, unknown> = {};

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
            // @ts-expect-error Legacy code type compatibility
            targetValue = expr.value || 'AUTO_COMPLEMENTS';
            targetMatchType = 'accessory';
          } else if (et.includes('asin') && et.includes('same')) {
            targetType = 'asin';
            targetValue = expr.value || '';
            targetMatchType = 'exact';
          } else if (et.includes('broadrel') || et.includes('broad_rel') || et.includes('loose')) {
            targetValue = expr.value || 'AUTO_LOOSE';
            targetMatchType = 'loose';
          } else if (et.includes('highrel') || et.includes('high_rel') || et.includes('close')) {
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

      // @ts-expect-error Type inference limitation
      const normalizedState = (apiTarget.state || 'enabled').toLowerCase() as 'enabled' | 'paused' | 'archived';

      // v474: 安全处理 - 如果targetValue仍然为空，使用expression类型作为回退值
      if (!targetValue) {
        const exprTypes = Array.isArray(exprArray) ? exprArray.map((e: Record<string, unknown>) => e.type || '').join(',') : '';
        targetValue = exprTypes || `AUTO_${String(apiTarget.targetId)}`;
      }

       const targetData = {
        accountId: this.accountId,
        internalAdGroupId: adGroup.id,  // v418: ID体系重构
        campaignId: adGroup.campaignId || '',  // v357
        targetId: String(apiTarget.targetId),
        targetType,
        targetValue,
        targetExpression,
        targetMatchType,
        bid: String(typeof apiTarget.bid === 'object' && apiTarget.bid !== null ? (apiTarget.bid as Record<string, unknown>).amount || 0 : (apiTarget.bid || 0)),
        targetStatus: normalizedState,
        categoryName: categoryName,
        categoryRefinements: categoryRefinements,
        updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      };
      if (synced === 0) {
        log.debug(`SB产品定向示例: type=${targetType}, value=${targetValue}, matchType=${targetMatchType}, categoryName=${categoryName}`);
      }

      if (existing) {
        // v523.2: 保护 amazon_deleted 状态不被同步覆盖
        if (existing.targetStatus === 'amazon_deleted' && normalizedState !== 'archived') {
          log.debug(`v523.2: 保护SB(syncSb) target amazon_deleted状态 - target=${existing.targetValue}(id=${existing.id})`);
          delete (targetData as Record<string, unknown>).targetStatus;
        }
        await db
          .update(productTargets)
          .set(targetData)
          .where(eq(productTargets.id, existing.id));
      } else {
        // @ts-expect-error DB query type inference limitation
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
    // @ts-expect-error - Axios error response access
    const statusCode = error?.response?.status || 'unknown';
    // @ts-expect-error - error message access
    const errorMsg = error?.response?.data?.message || error?.message || 'unknown error';
    log.warn(`Error syncing SB product targets: HTTP ${statusCode} - ${errorMsg}`);
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
// @ts-expect-error Dynamic property access
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
    let allReportData: unknown[] = [];
    if (batches === 1) {
      try {
        const reportId = await this.client.requestSbSearchTermReport(rangeStartDate, rangeEndDate);
        const data = await this.client.waitAndDownloadReport(reportId, 600000); // v449: SB搜索词超时从5分钟增加到10分钟
        if (data && data.length > 0) allReportData = data;
      } catch (e: unknown) {
        log.warn(`v449: SB搜索词报告请求失败:`, (e as Error).message);
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
        // @ts-expect-error Legacy code type compatibility
        });
      }
      log.info(`[v413] SB搜索词: ${batches}批次批量提交开始`);
      // P5: 异步报告模式
      if (process.env.P5_ASYNC_REPORTS === 'true') {
        const asyncResult = await this.client.submitReportsToAsyncQueue(batchRequests, {
          accountId: this.accountId,
          syncType: 'sb_sync',
        });
        log.info(`[P5] Async SB reports submitted: ${asyncResult.queued} queued`);
        // P5: async mode
      } else {
      const results = await this.client.submitAndWaitMultipleReports(batchRequests, 600000, 2000); // v449: SB报告超时从5分钟增加到10分钟
      for (const result of results) {
        if (result.data && result.data.length > 0) {
          allReportData = allReportData.concat(result.data);
        } else if (result.error) {
          log.warn(`[v413] ${result.name}失败: ${result.error}`);
        }
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
    // @ts-expect-error Complex function parameter types
    log.info(`v339: 共获取到 ${reportData.length} 条SB搜索词数据（${batches}批合并）`);
    
    // v395: 批量预加载所有关联数据，避免逐行N+1查询
    const allCampaigns = await db
      .select({ id: campaigns.id, campaignId: campaigns.campaignId })
      .from(campaigns)
      .where(eq(campaigns.accountId, this.accountId));
    const campaignMap = new Map<string, { id: number; campaignId: string }>();
    for (const c of (allCampaigns as unknown[])) {
      // @ts-expect-error DB query type inference limitation
      campaignMap.set(String(c.campaignId), { id: c.id, campaignId: c.campaignId });
    }

    const allAdGroups = await db
      .select({ id: adGroups.id, adGroupId: adGroups.adGroupId })
      .from(adGroups)
      // @ts-expect-error - dynamic property access
      .where(eq((adGroups as Record<string, unknown>).accountId, this.accountId));
    const adGroupMap = new Map<string, { id: number }>();
    for (const ag of allAdGroups) {
      adGroupMap.set(String(ag.adGroupId), { id: ag.id });
    }

    const allKeywords = await db
      // @ts-expect-error DB query type inference limitation
      .select({ id: keywords.id, adGroupId: keywords.internalAdGroupId, keywordText: keywords.keywordText, matchType: keywords.matchType })
      .from(keywords)
      // @ts-expect-error - dynamic property access
      .where(eq((keywords as Record<string, unknown>).accountId, this.accountId));
    const keywordMap = new Map<string, { id: number; matchType: string | null }>();
    for (const kw of (allKeywords as unknown[])) {
      // @ts-expect-error Type inference limitation
      const key = `${kw.adGroupId}:${(kw.keywordText || '').toLowerCase()}`;
      // @ts-expect-error DB query type inference limitation
      keywordMap.set(key, { id: kw.id, matchType: kw.matchType });
    // @ts-expect-error Legacy code type compatibility
    }

    // @ts-expect-error Type inference limitation
    const allTargets = await db
      // @ts-expect-error DB query type inference limitation
      .select({ id: productTargets.id, adGroupId: productTargets.internalAdGroupId, targetValue: productTargets.targetValue, targetMatchType: productTargets.targetMatchType })
      .from(productTargets)
      // @ts-expect-error - dynamic property access
      .where(eq((productTargets as Record<string, unknown>).accountId, this.accountId));
    const targetMap = new Map<string, { id: number; targetMatchType: string | null }>();
    for (const t of allTargets) {
      const key = `${t.adGroupId}:${(t.targetValue || '').toLowerCase()}`;
      targetMap.set(key, { id: t.id, targetMatchType: t.targetMatchType });
    }

    log.info(`[v395] SB搜索词预加载完成: campaigns=${allCampaigns.length}, adGroups=${allAdGroups.length}, keywords=${allKeywords.length}, targets=${allTargets.length}`);

    let synced = 0;
    let skipped = 0;
    const BATCH_SIZE = 500;
    let upsertBatch: unknown[] = [];
    const nowStr = new Date().toISOString().slice(0, 19).replace('T', ' ');

    for (const row of (reportData as unknown[])) {
      // @ts-expect-error Type inference limitation
      const campaign = campaignMap.get(String(row.campaignId));
      // @ts-expect-error Conditional type narrowing
      if (!campaign) { skipped++; continue; }

      // @ts-expect-error Type inference limitation
      const adGroup = adGroupMap.get(String(row.adGroupId));
      if (!adGroup) { skipped++; continue; }

      // @ts-expect-error Type inference limitation
      const cost = row.cost || 0;
      // @ts-expect-error Type inference limitation
      const sales = row.sales || row.salesClicks || 0;
      // @ts-expect-error Type inference limitation
      const clicks = row.clicks || 0;
      // @ts-expect-error Type inference limitation
      const impressions = row.impressions || 0;
      // @ts-expect-error Type inference limitation
      const orders = row.purchases || row.purchasesClicks || 0;

      // @ts-expect-error Type inference limitation
      const targetingText = row.keywordText || row.targeting || '';
      // @ts-expect-error Type inference limitation
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

      // @ts-expect-error Type inference limitation
      const searchTermText = row.searchTerm || '';
      const isAsinSearchTerm = /^[Bb]0[A-Za-z0-9]{8,}$/.test(searchTermText.trim());
      const searchTermType = isAsinSearchTerm ? 'asin' : 'keyword';
      const sourceMatchType = resolvedMatchType;
      const sourceTargetType = isProductTarget ? 'product_target' : 'keyword';
      // @ts-expect-error Type inference limitation
      const unitsOrdered = row.unitsSold7d || row.unitsSold14d || row.unitsSold || row.unitsSoldClicks || 0;

      // v395: 使用行级date字段（SB报告也是DAILY模式），而非整个范围的startDate
      // @ts-expect-error Type inference limitation
      const rowDate = row.date || startDate;

      upsertBatch.push({
        accountId: this.accountId,
        campaignId: campaign.campaignId,
        internalAdGroupId: adGroup.id,  // v418: ID体系重构
        searchTerm: searchTermText,
        searchTermTargetType: isProductTarget ? 'product_target' as const : 'keyword' as const,
        searchTermTargetId,
        targetText: targetingText,
        searchTermMatchType: resolvedMatchType,
        searchTermImpressions: impressions,
        searchTermClicks: clicks,
        // @ts-expect-error Legacy code type compatibility
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
  } catch (error: any) {
    log.warn(`同步SB搜索词失败: ${(error as Error).message || JSON.stringify(error)}`);
    // v358: 抛出错误而不是返回0
    throw error;
  }
};

/**
 * 同步SB定向数据
 * 获取SB广告的关键词和商品定向数据
 */
// @ts-expect-error Dynamic property access
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
    let allReportData: unknown[] = [];
    // @ts-expect-error Conditional type narrowing
    if (batches === 1) {
      try {
        const reportId = await this.client.requestSbTargetingReport(rangeStartDate, rangeEndDate);
        const data = await this.client.waitAndDownloadReport(reportId, 600000); // v449: SB定向超时从5分钟增加到10分钟
        if (data && data.length > 0) allReportData = data;
      } catch (e: unknown) {
        log.warn(`v449: SB定向报告请求失败:`, (e as Error).message);
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
      // P5: 异步报告模式
      if (process.env.P5_ASYNC_REPORTS === 'true') {
        const asyncResult = await this.client.submitReportsToAsyncQueue(batchRequests, {
          accountId: this.accountId,
          syncType: 'sb_sync',
        });
        log.info(`[P5] Async SB reports submitted: ${asyncResult.queued} queued`);
        // P5: async mode
      } else {
      const results = await this.client.submitAndWaitMultipleReports(batchRequests, 600000, 2000); // v449: SB报告超时从5分钟增加到10分钟
      for (const result of results) {
        if (result.data && result.data.length > 0) {
          // @ts-expect-error Legacy code type compatibility
          allReportData = allReportData.concat(result.data);
        } else if (result.error) {
          log.warn(`[v413] ${result.name}失败: ${result.error}`);
        }
      // @ts-expect-error Legacy code type compatibility
      }
    // @ts-expect-error Legacy code type compatibility
      }
    }

    const reportData = allReportData;
    if (!reportData || reportData.length === 0) {
      log.debug('v339: 所有批次SB定向报告数据为空');
      return 0;
    }
    log.info(`v339: 共获取到 ${reportData.length} 条SB定向数据（${batches}批合并）`);
    let synced = 0;

    // v422: 修复SB定向报告字段映射 - 报告中没有keywordId字段，只有targetingText和matchType
    // 需要通过adGroupId+targetingText+matchType匹配已有关键词记录
    // 批量预查询所有相关adGroup和keywords（消除N+1查询）
    // @ts-expect-error Dynamic type assertion
    const sbRptAdGroupIds = [...new Set((reportData as unknown[]).map(r => String(r.adGroupId)))];
    const sbRptAdGroupRows = sbRptAdGroupIds.length > 0
      ? await db.select().from(adGroups).where(and(eq(adGroups.accountId, this.accountId), inArray(adGroups.adGroupId, sbRptAdGroupIds)))
      : [];
    const sbRptAdGroupMap = new Map(sbRptAdGroupRows.map(r => [r.adGroupId, r]));
    
    // 预查询所有SB keywords（按internalAdGroupId）
    const sbRptInternalAgIds = sbRptAdGroupRows.map(r => r.id);
    const existingSbKwRows = sbRptInternalAgIds.length > 0
      ? await db.select().from(keywords).where(and(
          eq(keywords.accountId, this.accountId),
          inArray(keywords.internalAdGroupId, sbRptInternalAgIds)
        ))
      : [];
    // 构建多种匹配索引: keywordText+matchType 和 纯 keywordText
    const existingSbKwByTextMatch = new Map<string, typeof existingSbKwRows[0]>();
    const existingSbKwByText = new Map<string, typeof existingSbKwRows[0]>();
    for (const r of existingSbKwRows) {
      if (r.keywordText && r.matchType) {
        existingSbKwByTextMatch.set(`${r.internalAdGroupId}:${r.keywordText.toLowerCase()}:${r.matchType.toLowerCase()}`, r);
      }
      if (r.keywordText) {
        existingSbKwByText.set(`${r.internalAdGroupId}:${r.keywordText.toLowerCase()}`, r);
      }
    }

    for (const row of (reportData as unknown[])) {
      // @ts-expect-error Type inference limitation
      const adGroup = sbRptAdGroupMap.get(String(row.adGroupId));
      if (!adGroup) continue;

      // v422: 修复字段名 - SB报告返回的是targetingText，不是keyword或keywordId
      // @ts-expect-error Type inference limitation
      const targetingText = row.targetingText || '';
      // @ts-expect-error Type inference limitation
      const matchType = (row.matchType || 'broad').toLowerCase();
      
      // 跳过空的targetingText
      if (!targetingText) continue;

      // v422: 通过targetingText+matchType匹配已有关键词记录
      const existing = existingSbKwByTextMatch.get(`${adGroup.id}:${targetingText.toLowerCase()}:${matchType}`)
        || existingSbKwByText.get(`${adGroup.id}:${targetingText.toLowerCase()}`)
        || null;

      // @ts-expect-error Type inference limitation
      const cost = row.cost || 0;
      // @ts-expect-error Type inference limitation
      const sales = row.salesClicks || 0;
      // @ts-expect-error Type inference limitation
      const clicks = row.clicks || 0;
      // @ts-expect-error Type inference limitation
      const impressions = row.impressions || 0;
      // @ts-expect-error Type inference limitation
      const orders = row.purchasesClicks || 0;

      const keywordData = {
        internalAdGroupId: adGroup.id,
        accountId: this.accountId,
        campaignId: adGroup.campaignId || '',
        // v422: 如果匹配到已有记录，保留其keywordId；否则用targetingText作为临时标识
        keywordId: existing?.keywordId || `text:${targetingText}`,
        keywordText: targetingText,
        matchType: matchType as 'broad' | 'phrase' | 'exact',
        bid: existing?.bid || '0.00',  // 保留已有的bid
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
        // v523.2: 保护 amazon_deleted 状态不被绩效同步覆盖
        if (existing.keywordStatus === 'amazon_deleted') {
          log.debug(`v523.2: 保护SB绩效同步 keyword amazon_deleted状态 - id=${existing.id}`);
          delete (keywordData as Record<string, unknown>).keywordStatus;
        }
        await db
          .update(keywords)
          .set(keywordData)
          .where(eq(keywords.id, existing.id));
      } else {
        await db.insert(keywords).values({
          // @ts-expect-error Spread operator type compatibility
          ...keywordData,
          // @ts-expect-error Legacy code type compatibility
          createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
        // @ts-expect-error Legacy code type compatibility
        });
      // @ts-expect-error Legacy code type compatibility
      }
      // @ts-expect-error Legacy code type compatibility
      synced++;
    // @ts-expect-error Legacy code type compatibility
    }

    log.info(`SB定向同步完成: ${synced} 条记录`);
    return synced;
  } catch (error: any) {
    log.warn(`同步SB定向失败: ${(error as Error).message || JSON.stringify(error)}`);
    // v358: 抛出错误而不是返回0
    throw error;
  }
};

/**
 * 同步SB广告素材（品牌广告的创意素材详情）
 * 包含: headline, brandLogo, customImage, video, brandName等
 * 写入ad_groups表的creative字段
 */
// @ts-expect-error Dynamic property access
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
      // @ts-expect-error Type inference limitation
      const headline = creative.headline || ad.headline || null;
      // @ts-expect-error Type inference limitation
      const brandLogoAssetId = creative.brandLogoAssetID || creative.brandLogoAssetId || 
                              // @ts-expect-error Conditional type narrowing
                              creative.brandLogo?.assetId || null;
      // @ts-expect-error Type inference limitation
      const customImageAssetId = creative.customImageAssetID || creative.customImageAssetId || 
                                // @ts-expect-error Conditional type narrowing
                                creative.customImage?.assetId || null;
      // @ts-expect-error Type inference limitation
      const videoAssetId = creative.video?.assetId || creative.videoAssetId || null;
      // @ts-expect-error Type inference limitation
      const creativeType = ad.creativeType || creative.type || null;
      
      // 更新广告组的素材字段
      const updateData: Record<string, unknown> = {
        updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      };
      // @ts-expect-error Dynamic property access
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
  // @ts-expect-error Legacy code type compatibility
  } catch (error: unknown) {
    log.warn('SB广告素材同步失败:', (error as Error).message);
    return { synced: 0, skipped: 0 };
  }
};

/**
 * 同步SB否定关键词
 * 从SB API获取否定关键词并同步到negative_keywords表
 */
// @ts-expect-error Dynamic property access
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
      // @ts-expect-error Type inference limitation
      const negState = (neg.state || 'enabled').toLowerCase();
      if (negState === 'archived') continue;
      
      // v363: 使用批量预查询结果
      const campaign = sbNegCampaignMap.get(String(neg.campaignId));
      if (!campaign) continue;
      
      // v363: 使用批量预查询结果
      let internalAdGroupId: number | null = null;  // v418: ID体系重构
      if (neg.adGroupId) {
        const adGroup = sbNegAdGroupMap.get(String(neg.adGroupId));
        if (adGroup) internalAdGroupId = adGroup.id;
      }
      
      // @ts-expect-error Type inference limitation
      const matchType = (neg.matchType || '').toLowerCase().includes('phrase') 
        ? 'negative_phrase' as const 
        : 'negative_exact' as const;
      const amazonKeywordId = String(neg.keywordId || neg.negativeKeywordId || '');
      const negLevel = internalAdGroupId ? 'ad_group' as const : 'campaign' as const;
      
      const [existing] = await db
        .select()
        .from(negativeKeywords)
        .where(
          and(
            // @ts-expect-error Legacy code type compatibility
            eq(negativeKeywords.accountId, this.accountId),
            eq(negativeKeywords.campaignId, String(campaign.campaignId)),
            eq(negativeKeywords.negativeLevel, negLevel),
            // @ts-expect-error Legacy code type compatibility
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
        // @ts-expect-error Legacy code type compatibility
        // v529: 添加onDuplicateKeyUpdate处理竞态条件下的DUP_ENTRY错误
        await db.insert(negativeKeywords).values({
          accountId: this.accountId,
          campaignId: String(campaign.campaignId),
          internalAdGroupId: internalAdGroupId,
          negativeLevel: negLevel,
          negativeType: 'keyword',
          negativeText: neg.keywordText || '',
          negativeMatchType: matchType,
          amazonNegativeKeywordId: amazonKeywordId || null,
          negativeSource: 'manual',
          negativeStatus: 'active',
        }).onDuplicateKeyUpdate({
          set: { negativeStatus: sql`VALUES(negativeStatus)`, amazonNegativeKeywordId: sql`VALUES(amazonNegativeKeywordId)` }
        });
        synced++;
      }
    }
    
    log.info(`SB否定关键词同步完成: ${synced}条新增, ${updated}条更新`);
    return { synced, updated };
  } catch (error: unknown) {
    log.warn('SB否定关键词同步失败:', (error as Error).message);
    return { synced: 0, updated: 0 };
  }
};

/**
 * 同步SB否定商品定向
 */
// @ts-expect-error Dynamic property access
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
      // @ts-expect-error Type inference limitation
      const negState = (neg.state || 'enabled').toLowerCase();
      if (negState === 'archived') continue;
      
      // v363: 使用批量预查询结果
      const campaign = sbNegTgtCampaignMap.get(String(neg.campaignId));
      if (!campaign) continue;
      
      // v363: 使用批量预查询结果
      let internalAdGroupId: number | null = null;  // v418: ID体系重构
      if (neg.adGroupId) {
        const adGroup = sbNegTgtAdGroupMap.get(String(neg.adGroupId));
        if (adGroup) internalAdGroupId = adGroup.id;
      }
      
      const expression = neg.expression || [];
      // @ts-expect-error Type inference limitation
      const asinExpr = expression.find((e: Record<string, unknown>) => e.type?.toLowerCase().includes('asin'));
      const negativeText = asinExpr?.value || JSON.stringify(expression);
      const amazonTargetId = String(neg.targetId || '');
      const negLevel = internalAdGroupId ? 'ad_group' as const : 'campaign' as const;
      
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
        // v529: 添加onDuplicateKeyUpdate处理竞态条件下的DUP_ENTRY错误
        await db.insert(negativeKeywords).values({
          accountId: this.accountId,
          campaignId: String(campaign.campaignId),
          internalAdGroupId: internalAdGroupId,
          negativeLevel: negLevel,
          negativeType: 'product',
          negativeText: negativeText,
          negativeMatchType: 'negative_exact',
          amazonNegativeKeywordId: amazonTargetId || null,
          negativeSource: 'manual',
          negativeStatus: 'active',
        }).onDuplicateKeyUpdate({
          set: { negativeStatus: sql`VALUES(negativeStatus)`, amazonNegativeKeywordId: sql`VALUES(amazonNegativeKeywordId)` }
        });
        synced++;
      }
    }
    
    log.info(`SB否定商品定向同步完成: ${synced}条新增, ${updated}条更新`);
    return { synced, updated };
  } catch (error: unknown) {
    log.warn('SB否定商品定向同步失败:', (error as Error).message);
    return { synced: 0, updated: 0 };
  }
};

/**
 * 同步SB广告位绩效数据
 * 通过SB Placement报告获取广告位级别的绩效数据
 */
// @ts-expect-error Dynamic property access
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
    let allReportData: unknown[] = [];
    if (batches === 1) {
      try {
        const reportId = await this.client.requestSbCampaignPlacementReport(rangeStartDate, rangeEndDate);
        const data = await this.client.waitAndDownloadReport(reportId);
        if (data && data.length > 0) allReportData = data;
      } catch (e: unknown) {
        log.warn(`v413: SB广告位报告请求失败:`, (e as Error).message);
      }
    } else {
      const batchRequests: Array<{ name: string; requestFn: () => Promise<string> }> = [];
      for (let batch = 0; batch < batches; batch++) {
        // @ts-expect-error Type inference limitation
        const endDateObj = new Date(rangeEndDate);
        // @ts-expect-error Legacy code type compatibility
        endDateObj.setDate(endDateObj.getDate() - (batch * MAX_DAYS_PER_REQUEST));
        // @ts-expect-error Type inference limitation
        const startDateObj = new Date(endDateObj);
        // @ts-expect-error Type inference limitation
        const daysInBatch = Math.min(MAX_DAYS_PER_REQUEST, totalDays - (batch * MAX_DAYS_PER_REQUEST));
        // @ts-expect-error Legacy code type compatibility
        startDateObj.setDate(startDateObj.getDate() - daysInBatch + 1);
        const bStart = startDateObj.toISOString().split('T')[0];
        const bEnd = endDateObj.toISOString().split('T')[0];
        batchRequests.push({
          name: `SB广告位第${batch + 1}/${batches}批(${bStart}~${bEnd})`,
          requestFn: () => this.client.requestSbCampaignPlacementReport(bStart, bEnd),
        });
      }
      log.info(`[v413] SB广告位: ${batches}批次批量提交开始`);
      // P5: 异步报告模式
      if (process.env.P5_ASYNC_REPORTS === 'true') {
        const asyncResult = await this.client.submitReportsToAsyncQueue(batchRequests, {
          accountId: this.accountId,
          syncType: 'sb_sync',
        });
        log.info(`[P5] Async SB reports submitted: ${asyncResult.queued} queued`);
        // P5: async mode
      } else {
      const results = await this.client.submitAndWaitMultipleReports(batchRequests, 600000, 2000); // v449: SB报告超时从5分钟增加到10分钟
      for (const result of results) {
        if (result.data && result.data.length > 0) {
          allReportData = allReportData.concat(result.data);
        } else if (result.error) {
          log.warn(`[v413] ${result.name}失败: ${result.error}`);
        }
      }
      }
    }

    const reportData = allReportData;
    if (!reportData || reportData.length === 0) {
      log.debug('v339: 所有批次SB广告位报告数据为空');
      return 0;
    }
    log.info(`v339: 共获取到 ${reportData.length} 条SB广告位数据（${batches}批合并）`);
    
    for (const row of (reportData as unknown[])) {
      // @ts-expect-error Type inference limitation
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
      
      // @ts-expect-error Type inference limitation
      const dateStr = row.date || rangeStartDate;
      // @ts-expect-error Type inference limitation
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
          // @ts-expect-error Legacy code type compatibility
          and(
            eq(placementPerformance.campaignId, localCampaignId2),
            eq(placementPerformance.accountId, this.accountId),
            eq(placementPerformance.placement, placement),
            eq(placementPerformance.date, dateStr)
          )
        )
        .limit(1);
      
      // @ts-expect-error Type inference limitation
      const cost = parseFloat(row.cost || row.spend || '0');
      // @ts-expect-error Type inference limitation
      const sales = parseFloat(row.sales || row.attributedSales14d || '0');
      // @ts-expect-error Type inference limitation
      const clicks = parseInt(row.clicks || '0');
      // @ts-expect-error Type inference limitation
      const impressions = parseInt(row.impressions || '0');
      // @ts-expect-error Type inference limitation
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
    log.warn('SB广告位绩效同步失败:', (error as Error).message);
  }
  return synced;
};


/**
 * v417: 同步SB关键词和商品定位的建议竞价
 * 
 * SB广告的建议竞价通过 POST /sb/recommendations/bids 获取
 * 支持两种模式：
 * 1. 关键词模式：传入 campaignId + keywords
 * 2. 商品定位模式：传入 campaignId + targets
 * 
 * 建议竞价写入 keywords.suggestedBid 和 productTargets.suggestedBid
 */
// @ts-expect-error Dynamic property access
AmazonSyncService.prototype.syncSbBidRecommendations = async function(this: AmazonSyncService): Promise<{ synced: number; skipped: number }> {
  const db = await getDb();
  if (!db) return { synced: 0, skipped: 0 };

  let keywordBidsUpdated = 0;
  let targetBidsUpdated = 0;
  let errors = 0;

  try {
    // ========== 第一部分：SB关键词建议竞价 ==========
    log.info('[v417] ========== 开始同步SB关键词建议竞价 ==========');

    // v515: 查询所有SB关键词（enabled状态），按campaign分组，同时获取Amazon adGroupId用于本地推荐回退
    const sbKeywordRows = await db.select({
      id: keywords.id,
      campaignId: keywords.campaignId,
      internalAdGroupId: keywords.internalAdGroupId,
      amazonAdGroupId: adGroups.adGroupId,
      keywordText: keywords.keywordText,
      matchType: keywords.matchType,
    }).from(keywords)
      .innerJoin(adGroups, eq(keywords.internalAdGroupId, adGroups.id))  // v420: 修复 - 两者都是int类型，无需CAST
      .innerJoin(campaigns, eq(adGroups.campaignId, campaigns.campaignId))
      .where(and(
        eq(keywords.accountId, this.accountId),
        eq(campaigns.campaignType, 'sb'),
        eq(keywords.keywordStatus, 'enabled'),
      ));

    log.info(`[v515] 查询到 ${sbKeywordRows.length} 个SB关键词需要获取建议竞价`);

    // 按campaignId分组（SB API使用campaignId而非adGroupId）
    const kwByCampaign = new Map<string, Array<{ id: number; keywordText: string; matchType: string; amazonAdGroupId: string }>>();
    for (const row of sbKeywordRows) {
      const cId = row.campaignId || '';
      if (!kwByCampaign.has(cId)) kwByCampaign.set(cId, []);
      kwByCampaign.get(cId)!.push({ id: row.id, keywordText: row.keywordText, matchType: row.matchType, amazonAdGroupId: row.amazonAdGroupId || '' });
    }

    // 查询campaign的Amazon campaignId映射
    const internalCampaignIds = [...kwByCampaign.keys()];
    const campaignMappingRows = internalCampaignIds.length > 0
      ? await db.select({ id: campaigns.id, campaignId: campaigns.campaignId }).from(campaigns)
          .where(and(eq(campaigns.accountId, this.accountId), inArray(campaigns.campaignId, internalCampaignIds)))
      : [];
    const campaignIdMap = new Map(campaignMappingRows.map(r => [r.campaignId, r.campaignId]));

    // 按campaign批量请求建议竞价
    for (const [campaignId, kwList] of kwByCampaign) {
      const amazonCampaignId = campaignIdMap.get(campaignId);
      if (!amazonCampaignId) {
        log.debug(`[v515] campaign ${campaignId} 无映射，跳过`);
        continue;
      }

      let apiSucceeded = false;
      try {
        // 每批最多100个关键词
        const batchSize = 100;
        for (let i = 0; i < kwList.length; i += batchSize) {
          const batch = kwList.slice(i, i + batchSize);
          const apiKeywords = batch.map(kw => ({
            keyword: kw.keywordText,
            matchType: kw.matchType.toUpperCase(),
          }));

          const recommendations = await this.client.getSbBidRecommendations(amazonCampaignId, apiKeywords);

          // v515: 增强日志 — 记录API返回的原始数据量，帮助诊断空返回问题
          log.info(`[v515] SB关键词建议竞价API返回: campaignId=${amazonCampaignId}, 请求=${batch.length}, 返回=${recommendations?.length || 0}`);

          if (recommendations && recommendations.length > 0) {
            apiSucceeded = true;
            // v436: 升级为包含bid range的对象
            const recMap = new Map<string, { suggestedBid: number; rangeLow: number; rangeHigh: number }>();
            for (const rec of recommendations) {
              if (rec.keyword && rec.suggestedBid) {
                const bidData = {
                  suggestedBid: rec.suggestedBid,
                  rangeLow: rec.rangeStart || 0,
                  rangeHigh: rec.rangeEnd || 0,
                };
                recMap.set(`${rec.keyword.toLowerCase()}:${(rec.matchType || '').toLowerCase()}`, bidData);
                recMap.set(rec.keyword.toLowerCase(), bidData);
              }
            }

            for (const kw of batch) {
              const bidData = recMap.get(`${kw.keywordText.toLowerCase()}:${kw.matchType.toLowerCase()}`)
                || recMap.get(kw.keywordText.toLowerCase());
              if (bidData && bidData.suggestedBid > 0) {
                await db.update(keywords)
                  .set({
                    suggestedBid: String(bidData.suggestedBid),
                    suggestedBidLow: bidData.rangeLow > 0 ? String(bidData.rangeLow) : null,
                    suggestedBidHigh: bidData.rangeHigh > 0 ? String(bidData.rangeHigh) : null,
                  })
                  .where(eq(keywords.id, kw.id));
                keywordBidsUpdated++;
              }
            }
          }
        }
      } catch (err: unknown) {
        errors++;
        const errMsg = (err as Error).message || JSON.stringify(err);
        log.warn(`[v515] campaign ${campaignId} SB关键词建议竞价API获取失败: ${errMsg}`);
      }

      // v515: Amazon API失败或返回空时，使用本地历史数据推荐引擎为该campaign的关键词提供建议竞价
      if (!apiSucceeded && kwList.length > 0) {
        try {
          // 使用第一个关键词的adGroupId作为本地推荐的参考
          const refAdGroupId = kwList[0].amazonAdGroupId;
          if (refAdGroupId) {
            const localRec = await getLocalKeywordBidRecommendation(
              this.accountId, refAdGroupId, amazonCampaignId, 'sb', 0.30
            );
            if (localRec.source !== 'minimum_default' && localRec.suggestedBid > 0) {
              for (const kw of kwList) {
                await db.update(keywords)
                  .set({
                    suggestedBid: String(localRec.suggestedBid),
                    suggestedBidLow: String(localRec.rangeStart),
                    suggestedBidHigh: String(localRec.rangeEnd),
                  })
                  .where(eq(keywords.id, kw.id));
                keywordBidsUpdated++;
              }
              log.info(`[v515] 本地推荐引擎为SB campaign ${campaignId} 的 ${kwList.length} 个关键词提供建议竞价 $${localRec.suggestedBid.toFixed(2)} (${localRec.source})`);
            } else {
              log.warn(`[v515] 本地推荐引擎对SB campaign ${campaignId} 无足够数据，${kwList.length}个关键词建议竞价未更新`);
            }
          }
        } catch (localErr: unknown) {
          log.debug(`[v515] SB关键词本地推荐引擎异常: ${(localErr as Error).message}`);
        }
      }
    }

    log.info(`[v417] SB关键词建议竞价同步完成: ${keywordBidsUpdated} 个关键词已更新`);

    // ========== 第二部分：SB商品定位建议竞价 ==========
    log.info('[v417] ========== 开始同步SB商品定位建议竞价 ==========');

    // v515: 查询SB商品定位，同时获取Amazon adGroupId用于本地推荐回退
    const sbTargetRows = await db.select({
      id: productTargets.id,
      campaignId: productTargets.campaignId,
      internalAdGroupId: productTargets.internalAdGroupId,
      amazonAdGroupId: adGroups.adGroupId,
      targetExpression: productTargets.targetExpression,
      targetType: productTargets.targetType,
      targetValue: productTargets.targetValue,
    }).from(productTargets)
      .innerJoin(adGroups, eq(productTargets.internalAdGroupId, adGroups.id))  // v420: 修复 - 两者都是int类型，无需CAST
      .innerJoin(campaigns, eq(adGroups.campaignId, campaigns.campaignId))
      .where(and(
        eq(productTargets.accountId, this.accountId),
        eq(campaigns.campaignType, 'sb'),
        eq(productTargets.targetStatus, 'enabled'),
      ));

    log.info(`[v515] 查询到 ${sbTargetRows.length} 个SB商品定位需要获取建议竞价`);

    // 按campaignId分组
    const tgtByCampaign = new Map<string, Array<{ id: number; targetExpression: string | null; targetType: string; targetValue: string; amazonAdGroupId: string }>>();
    for (const row of sbTargetRows) {
      const cId = row.campaignId || '';
      if (!tgtByCampaign.has(cId)) tgtByCampaign.set(cId, []);
      tgtByCampaign.get(cId)!.push({
        id: row.id,
        targetExpression: row.targetExpression,
        targetType: row.targetType,
        targetValue: row.targetValue,
        amazonAdGroupId: row.amazonAdGroupId || '',
      });
    }

    for (const [campaignId, tgtList] of tgtByCampaign) {
      const amazonCampaignId = campaignIdMap.get(campaignId);
      if (!amazonCampaignId) continue;

      let tgtApiSucceeded = false;
      try {
        const batchSize = 100;
        for (let i = 0; i < tgtList.length; i += batchSize) {
          const batch = tgtList.slice(i, i + batchSize);

          const targets: Array<{ type: string; value?: string }> = [];
          for (const tgt of batch) {
            if (tgt.targetExpression) {
              try {
                const expr = JSON.parse(tgt.targetExpression);
                if (Array.isArray(expr) && expr.length > 0) {
                  targets.push(expr[0]);
                }
              } catch {
                if (tgt.targetType === 'asin') {
                  targets.push({ type: 'asinSameAs', value: tgt.targetValue });
                } else {
                  targets.push({ type: 'asinCategorySameAs', value: tgt.targetValue });
                }
              }
            } else {
              if (tgt.targetType === 'asin') {
                targets.push({ type: 'asinSameAs', value: tgt.targetValue });
              } else {
                targets.push({ type: 'asinCategorySameAs', value: tgt.targetValue });
              }
            }
          }

          if (targets.length === 0) continue;

          const recommendations = await this.client.getSbTargetBidRecommendations(amazonCampaignId, targets);

          // v515: 增强日志
          log.info(`[v515] SB商品定位建议竞价API返回: campaignId=${amazonCampaignId}, 请求=${targets.length}, 返回=${recommendations?.length || 0}`);

          // v436: 更新建议竞价（包含low/median/high）
          if (recommendations && recommendations.length > 0) {
            tgtApiSucceeded = true;
            for (let j = 0; j < Math.min(recommendations.length, batch.length); j++) {
              const rec = recommendations[j];
              if (rec && rec.suggestedBid && rec.suggestedBid > 0) {
                await db.update(productTargets)
                  .set({
                    suggestedBid: String(rec.suggestedBid),
                    suggestedBidLow: rec.rangeStart > 0 ? String(rec.rangeStart) : null,
                    suggestedBidHigh: rec.rangeEnd > 0 ? String(rec.rangeEnd) : null,
                  })
                  .where(eq(productTargets.id, batch[j].id));
                targetBidsUpdated++;
              }
            }
          }
        }
      } catch (err: unknown) {
        errors++;
        const errMsg = (err as Error).message || JSON.stringify(err);
        log.warn(`[v515] campaign ${campaignId} SB商品定位建议竞价API获取失败: ${errMsg}`);
      }

      // v515: Amazon API失败或返回空时，使用本地历史数据推荐引擎
      if (!tgtApiSucceeded && tgtList.length > 0) {
        try {
          const refAdGroupId = tgtList[0].amazonAdGroupId;
          if (refAdGroupId) {
            const localRec = await getLocalTargetBidRecommendation(
              this.accountId, refAdGroupId, amazonCampaignId, 'sb', 0.30
            );
            if (localRec.source !== 'minimum_default' && localRec.suggestedBid > 0) {
              for (const tgt of tgtList) {
                await db.update(productTargets)
                  .set({
                    suggestedBid: String(localRec.suggestedBid),
                    suggestedBidLow: String(localRec.rangeStart),
                    suggestedBidHigh: String(localRec.rangeEnd),
                  })
                  .where(eq(productTargets.id, tgt.id));
                targetBidsUpdated++;
              }
              log.info(`[v515] 本地推荐引擎为SB campaign ${campaignId} 的 ${tgtList.length} 个商品定位提供建议竞价 $${localRec.suggestedBid.toFixed(2)} (${localRec.source})`);
            } else {
              log.warn(`[v515] 本地推荐引擎对SB campaign ${campaignId} 无足够数据，${tgtList.length}个商品定位建议竞价未更新`);
            }
          }
        } catch (localErr: unknown) {
          log.debug(`[v515] SB商品定位本地推荐引擎异常: ${(localErr as Error).message}`);
        }
      }
    }

    log.info(`[v515] SB商品定位建议竞价同步完成: ${targetBidsUpdated} 个定位已更新`);
    log.info(`[v515] ========== SB建议竞价同步总结: 关键词=${keywordBidsUpdated}, 定位=${targetBidsUpdated}, 错误=${errors} ==========`);

    return { synced: keywordBidsUpdated + targetBidsUpdated, skipped: errors };
  } catch (error: any) {
    log.warn(`[v417] Error syncing SB bid recommendations: ${(error as Error).message || JSON.stringify(error)}`);
    return { synced: keywordBidsUpdated + targetBidsUpdated, skipped: errors };
  }
};
