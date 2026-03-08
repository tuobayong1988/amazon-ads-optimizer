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
import type { AmazonAdsApiClient, SpCampaign } from '../../amazonAdsApi';
import { getMarketplaceDateRange, getMarketplaceCurrentDate, getMarketplaceYesterday, getMarketplaceHistoricalDateRange } from '../../utils/timezone';
import { getExchangeRateByMarketplace } from '../exchangeRateService';
import { AmazonSyncService } from '../../amazonSyncService';
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

    for (const apiCampaign of apiCampaigns) {
      // 检查是否已存在
      const [existing] = await db
        .select()
        .from(campaigns)
        .where(
          and(
            eq(campaigns.accountId, this.accountId),
            eq(campaigns.campaignId, String(apiCampaign.campaignId))
          )
        )
        .limit(1);

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

    for (const apiAdGroup of apiAdGroups) {
      // 查找对应的campaign
      const [campaign] = await db
        .select()
        .from(campaigns)
        .where(
          and(
            eq(campaigns.accountId, this.accountId),
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

    for (const apiKeyword of apiKeywords) {
      // 查找对应的ad group
      const [adGroup] = await db
        .select()
        .from(adGroups)
        .where(eq(adGroups.adGroupId, String(apiKeyword.adGroupId)))
        .limit(1);

      if (!adGroup) continue;

      // 检查是否已存在
      const [existing] = await db
        .select()
        .from(keywords)
        .where(
          and(
            eq(keywords.adGroupId, String(adGroup.id)),
            eq(keywords.keywordId, String(apiKeyword.keywordId))
          )
        )
        .limit(1);

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

    for (const apiTarget of apiTargets) {
      // 查找对应的ad group
      const [adGroup] = await db
        .select()
        .from(adGroups)
        .where(eq(adGroups.adGroupId, String(apiTarget.adGroupId)))
        .limit(1);

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

      // 检查是否已存在
      const [existing] = await db
        .select()
        .from(productTargets)
        .where(
          and(
            eq(productTargets.adGroupId, String(adGroup.id)),
            eq(productTargets.targetId, String(apiTarget.targetId))
          )
        )
        .limit(1);

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

    let allReportData: any[] = [];
    for (let batch = 0; batch < batches; batch++) {
      const endDateObj = new Date(rangeEndDate);
      endDateObj.setDate(endDateObj.getDate() - (batch * MAX_DAYS_PER_REQUEST));
      const startDateObj = new Date(endDateObj);
      const daysInBatch = Math.min(MAX_DAYS_PER_REQUEST, totalDays - (batch * MAX_DAYS_PER_REQUEST));
      startDateObj.setDate(startDateObj.getDate() - daysInBatch + 1);
      const batchStartDate = startDateObj.toISOString().split('T')[0];
      const batchEndDate = endDateObj.toISOString().split('T')[0];
      log.info(`v339: SB搜索词第${batch + 1}/${batches}批: ${batchStartDate} - ${batchEndDate} (共${daysInBatch}天)`);
      try {
        const reportId = await this.client.requestSbSearchTermReport(batchStartDate, batchEndDate);
        const batchData = await this.client.waitAndDownloadReport(reportId, 300000);
        if (batchData && batchData.length > 0) {
          allReportData = allReportData.concat(batchData);
          log.info(`v339: 第${batch + 1}批获取到 ${batchData.length} 条数据`);
        }
        if (batch < batches - 1) await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (batchError: unknown) {
        log.error(`v339: SB搜索词第${batch + 1}批请求失败:`, (batchError as Error).message);
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
    let synced = 0;

    for (const row of (reportData as any[])) {
      // 查找对应的campaign
      const [campaign] = await db
        .select()
        .from(campaigns)
        .where(
          and(
            eq(campaigns.accountId, this.accountId),
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
            eq(searchTerms.accountId, this.accountId),
            eq(searchTerms.campaignId, String(campaign.campaignId)),
            eq(searchTerms.adGroupId, String(adGroup.id)),
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
              eq(keywords.adGroupId, String(adGroup.id)),
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
              eq(productTargets.adGroupId, String(adGroup.id)),
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
        accountId: this.accountId,
        campaignId: campaign.campaignId,
        adGroupId: String(adGroup.id),  // v357
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

    let allReportData: any[] = [];
    for (let batch = 0; batch < batches; batch++) {
      const endDateObj = new Date(rangeEndDate);
      endDateObj.setDate(endDateObj.getDate() - (batch * MAX_DAYS_PER_REQUEST));
      const startDateObj = new Date(endDateObj);
      const daysInBatch = Math.min(MAX_DAYS_PER_REQUEST, totalDays - (batch * MAX_DAYS_PER_REQUEST));
      startDateObj.setDate(startDateObj.getDate() - daysInBatch + 1);
      const batchStartDate = startDateObj.toISOString().split('T')[0];
      const batchEndDate = endDateObj.toISOString().split('T')[0];
      log.info(`v339: SB定向第${batch + 1}/${batches}批: ${batchStartDate} - ${batchEndDate} (共${daysInBatch}天)`);
      try {
        const reportId = await this.client.requestSbTargetingReport(batchStartDate, batchEndDate);
        const batchData = await this.client.waitAndDownloadReport(reportId, 300000);
        if (batchData && batchData.length > 0) {
          allReportData = allReportData.concat(batchData);
          log.info(`v339: 第${batch + 1}批获取到 ${batchData.length} 条数据`);
        }
        if (batch < batches - 1) await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (batchError: unknown) {
        log.error(`v339: SB定向第${batch + 1}批请求失败:`, (batchError as Error).message);
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
    
    for (const ad of apiAds) {
      // 查找对应的广告组
      const adGroupIdStr = String(ad.adGroupId);
      const [adGroup] = await db
        .select()
        .from(adGroups)
        .where(eq(adGroups.adGroupId, adGroupIdStr))
        .limit(1);
      
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
    
    for (const neg of sbNegatives) {
      const negState = (neg.state || 'enabled').toLowerCase();
      if (negState === 'archived') continue;
      
      // 查找对应的campaign
      const [campaign] = await db
        .select()
        .from(campaigns)
        .where(
          and(
            eq(campaigns.accountId, this.accountId),
            eq(campaigns.campaignId, String(neg.campaignId))
          )
        )
        .limit(1);
      if (!campaign) continue;
      
      // 查找对应的广告组（如果有）
      // v357: adGroupId现在是varchar类型
      let adGroupId: string | null = null;
      if (neg.adGroupId) {
        const [adGroup] = await db
          .select()
          .from(adGroups)
          .where(eq(adGroups.adGroupId, String(neg.adGroupId)))
          .limit(1);
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
    
    for (const neg of sbNegTargets) {
      const negState = (neg.state || 'enabled').toLowerCase();
      if (negState === 'archived') continue;
      
      const [campaign] = await db
        .select()
        .from(campaigns)
        .where(
          and(
            eq(campaigns.accountId, this.accountId),
            eq(campaigns.campaignId, String(neg.campaignId))
          )
        )
        .limit(1);
      if (!campaign) continue;
      
      // v357: adGroupId现在是varchar类型
      let adGroupId: string | null = null;
      if (neg.adGroupId) {
        const [adGroup] = await db
          .select()
          .from(adGroups)
          .where(eq(adGroups.adGroupId, String(neg.adGroupId)))
          .limit(1);
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

    let allReportData: any[] = [];
    for (let batch = 0; batch < batches; batch++) {
      const endDateObj = new Date(rangeEndDate);
      endDateObj.setDate(endDateObj.getDate() - (batch * MAX_DAYS_PER_REQUEST));
      const startDateObj = new Date(endDateObj);
      const daysInBatch = Math.min(MAX_DAYS_PER_REQUEST, totalDays - (batch * MAX_DAYS_PER_REQUEST));
      startDateObj.setDate(startDateObj.getDate() - daysInBatch + 1);
      const batchStartDate = startDateObj.toISOString().split('T')[0];
      const batchEndDate = endDateObj.toISOString().split('T')[0];
      log.info(`v339: SB广告位第${batch + 1}/${batches}批: ${batchStartDate} - ${batchEndDate} (共${daysInBatch}天)`);
      try {
        const reportId = await this.client.requestSbCampaignPlacementReport(batchStartDate, batchEndDate);
        const batchData = await this.client.waitAndDownloadReport(reportId);
        if (batchData && batchData.length > 0) {
          allReportData = allReportData.concat(batchData);
          log.info(`v339: 第${batch + 1}批获取到 ${batchData.length} 条数据`);
        }
        if (batch < batches - 1) await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (batchError: unknown) {
        log.error(`v339: SB广告位第${batch + 1}批请求失败:`, (batchError as Error).message);
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

