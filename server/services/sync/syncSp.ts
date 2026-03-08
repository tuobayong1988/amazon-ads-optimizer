/**
 * SP (Sponsored Products) 广告数据同步方法
 * 
 * 从 amazonSyncService.ts 中提取的 syncSp 子模块。
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

const log = createModuleLogger('syncSp');

// ==================== 类型声明（模块扩展） ====================

declare module '../../amazonSyncService' {
  interface AmazonSyncService {
    syncSpCampaigns(...args: unknown[]): unknown;
    syncSpAdGroups(...args: unknown[]): unknown;
    syncSpKeywords(...args: unknown[]): unknown;
    syncSpProductTargets(...args: unknown[]): unknown;
    syncSpNegativeKeywords(...args: unknown[]): unknown;
    syncSpNegativeProductTargets(...args: unknown[]): unknown;
  }
}

// ==================== 方法实现 ====================

/**
 * 同步SP广告活动
 * @param lastSyncTime 上次同步时间，用于增量同步
 */
AmazonSyncService.prototype.syncSpCampaigns = async function(this: AmazonSyncService, lastSyncTime?: string | null): Promise<number | { synced: number; skipped: number }> {
  log.info('[同步] ========== 开始同步SP广告活动 ==========');
  log.info('[同步] 参数:', { accountId: this.accountId, lastSyncTime, marketplace: this.marketplace });
  
  const db = await getDb();
  if (!db) {
    log.error('[同步] ❌ 数据库连接失败 - getDb()返回null');
    return { synced: 0, skipped: 0 };
  }
  log.info('[同步] ✅ 数据库连接成功');

  try {
    log.info('[同步] 正在调用Amazon API: listSpCampaigns()...');
    const apiCampaigns = await this.client.listSpCampaigns();
    log.info(`[同步] ✅ API调用成功,返回 ${apiCampaigns.length} 个SP广告活动`);
    let synced = 0;
    let skipped = 0;
    
    // 输出第一个广告活动的结构用于调试
    if (apiCampaigns.length > 0) {
      log.debug('SP广告活动API返回结构示例:', JSON.stringify(apiCampaigns[0], null, 2));
    }
    log.debug(`获取到 ${apiCampaigns.length} 个SP广告活动`);

    // 调试：输出第一个广告活动的完整结构
    if (apiCampaigns.length > 0) {
      log.debug('[SP Sync Debug] 第一个广告活动的完整结构:', JSON.stringify(apiCampaigns[0], null, 2));
      log.debug('[SP Sync Debug] startDate字段:', apiCampaigns[0].startDate);
      log.debug('[SP Sync Debug] endDate字段:', apiCampaigns[0].endDate);
    }

    // v150.1: 批量预查询所有需要保护的广告活动ID（减少循环内DB查询）
    const allExistingCampaignIds: number[] = [];
    for (const ac of apiCampaigns) {
      const [ex] = await db.select({ id: campaigns.id }).from(campaigns)
        .where(and(eq(campaigns.accountId, this.accountId), eq(campaigns.campaignId, String(ac.campaignId))))
        .limit(1);
      if (ex) allExistingCampaignIds.push(ex.id);
    }
    const protectedCampaignIds = await getRecentlyOptimizedCampaignIds(allExistingCampaignIds, SYNC_PROTECTION_CONFIG.BUDGET_PROTECTION_HOURS);
    const protectionStats = createSyncProtectionStats();
    log.info(`syncSpCampaigns: 批量查询完成, ${protectedCampaignIds.size}个广告活动有近期预算优化事件`);

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
      if (lastSyncTime && existing) {
        // v215修复: 移除错误的updatedAt跳过逻辑
        // 始终使用Amazon API返回的最新数据更新本地记录
      }

      // Amazon API返回的targetingType是大写的AUTO/MANUAL，需要转换为小写
      const normalizedTargetingType = (apiCampaign.targetingType || 'manual').toLowerCase() as 'auto' | 'manual';
      const campaignType = normalizedTargetingType === 'auto' ? 'sp_auto' : 'sp_manual';
      
      // v168: SP API v3的dailyBudget可能嵌套在多种结构中
      // 常见结构: { budget: { budget: 30 } }, { budget: { dailyBudget: 30 } }, { dailyBudget: 30 }, { budget: 30 }
      let dailyBudgetValue = 0;
      const budgetField = (apiCampaign as Record<string, any>).budget;
      if (budgetField !== undefined && budgetField !== null) {
        if (typeof budgetField === 'number') {
          dailyBudgetValue = budgetField;
        } else if (typeof budgetField === 'object') {
          dailyBudgetValue = budgetField.budget || budgetField.dailyBudget || budgetField.amount || 0;
        }
      }
      if (dailyBudgetValue === 0 && apiCampaign.dailyBudget) {
        dailyBudgetValue = Number(apiCampaign.dailyBudget) || 0;
      }
      // v168: 零值防护 - 如果解析出的budget为0但广告活动状态为enabled，记录警告
      if (dailyBudgetValue === 0) {
        log.warn(`v168: SP广告 ${apiCampaign.name} budget解析为0, 原始budget字段: ${JSON.stringify(budgetField)} dailyBudget: ${apiCampaign.dailyBudget}`);
      }

      // 调试日志：打印第一个广告活动的完整结构
      if (synced === 0 && skipped === 0) {
        log.debug('[SP Sync Debug] 第一个广告活动的完整结构:');
        log.debug(JSON.stringify(apiCampaign, null, 2));
        log.debug('[SP Sync Debug] startDate字段:', apiCampaign.startDate);
        log.debug('[SP Sync Debug] endDate字段:', apiCampaign.endDate);
      }

      // 解析Amazon API返回的startDate（格式可能是YYYY-MM-DD或YYYYMMDD）
      let startDateValue: string | null = null;
      if (apiCampaign.startDate) {
        const dateStr = String(apiCampaign.startDate);
        if (dateStr.includes('-')) {
          // YYYY-MM-DD格式
          startDateValue = dateStr;
        } else if (dateStr.length === 8) {
          // YYYYMMDD格式
          startDateValue = `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
        }
      }

      // 解析endDate
      let endDateValue: string | null = null;
      if (apiCampaign.endDate) {
        const dateStr = String(apiCampaign.endDate);
        if (dateStr.includes('-')) {
          endDateValue = dateStr;
        } else if (dateStr.length === 8) {
          endDateValue = `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
        }
      }

      // 获取竞价策略
      const biddingStrategy = (apiCampaign as Record<string, any>).dynamicBidding?.strategy || 
                             (apiCampaign as Record<string, any>).bidding?.strategy || 
                             'legacyForSales';

      // 获取组合信息
      const portfolioId = (apiCampaign as Record<string, any>).portfolioId ? String((apiCampaign as Record<string, any>).portfolioId) : null;

      const campaignData = {
        accountId: this.accountId,
        campaignId: String(apiCampaign.campaignId),
        campaignName: apiCampaign.name,
        campaignType: campaignType as 'sp_auto' | 'sp_manual' | 'sb' | 'sd',
        targetingType: normalizedTargetingType,
        dailyBudget: String(dailyBudgetValue),
        campaignStatus: (apiCampaign.state?.toLowerCase() || 'enabled') as 'enabled' | 'paused' | 'archived',
        state: (apiCampaign.state?.toLowerCase() || 'enabled') as 'enabled' | 'paused' | 'archived' | 'pending' | 'other',
        startDate: startDateValue,
        endDate: endDateValue,
        placementTopSearchBidAdjustment: this.getPlacementMultiplier(apiCampaign, 'placementTop'),
        placementProductPageBidAdjustment: this.getPlacementMultiplier(apiCampaign, 'placementProductPage'),
        biddingStrategy: biddingStrategy as 'legacyForSales' | 'autoForSales' | 'manual' | 'ruleBasedBidding',
        portfolioId: portfolioId,
        costType: 'cpc' as 'cpc' | 'vcpm' | 'cpm', // SP广告都是CPC
        amazonCreatedDate: startDateValue, // 使用广告活动的startDate作为Amazon侧创建日期
        updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      };

      if (existing) {
        // v168: 零值预算防护 - 如果API返回budget=0但本地有非零值，保留本地值
        const localBudget = parseFloat(existing.dailyBudget || '0');
        const apiBudget = parseFloat(String(dailyBudgetValue || '0'));
        if (apiBudget === 0 && localBudget > 0) {
          log.warn(`v168: 零值预算防护生效 - campaign=${existing.campaignName}, local=$${localBudget}, api=$${apiBudget}, 保留本地预算`);
          // @ts-ignore
          delete (campaignData as Record<string, any>[]).dailyBudget;
        }
        
        // v150: 智能预算保护策略
        // 检查optimization_events表，如果该广告活动有24小时内成功同步的预算优化事件，
        // 则保留本地dailyBudget不被覆盖
        
        if (Math.abs(localBudget - apiBudget) > SYNC_PROTECTION_CONFIG.BID_THRESHOLD && localBudget > 0) {
          // 预算不一致，检查是否有近期预算优化事件（使用批量查询结果）
          const hasRecentOpt = protectedCampaignIds.has(existing.id);
          if (hasRecentOpt) {
            // 有近期优化事件，保留本地预算
            log.debug(`v150: 预算保护生效 - campaign=${existing.campaignName}, local=$${localBudget}, api=$${apiBudget}, 保留本地优化预算`);
            // @ts-ignore
            delete (campaignData as Record<string, any>[]).dailyBudget;
            protectionStats.budgetProtected++;
            protectionStats.protectedEntities.push(`camp:${existing.campaignName}`);
          } else {
            log.debug(`v150: 预算差异 - campaign=${existing.campaignName}, local=$${localBudget}, api=$${apiBudget}, 以API为准`);
            protectionStats.budgetOverwritten++;
          }
        }
        
        // v165: 位置倾斜比例保护逻辑
        const localTopPlacement1 = existing.placementTopSearchBidAdjustment || 0;
        // @ts-ignore
        const apiTopPlacement1 = (campaignData as Record<string, any>[]).placementTopSearchBidAdjustment || 0;
        const localProductPlacement1 = existing.placementProductPageBidAdjustment || 0;
        // @ts-ignore
        const apiProductPlacement1 = (campaignData as Record<string, any>[]).placementProductPageBidAdjustment || 0;
        const hasPlacementDiff1 = localTopPlacement1 !== apiTopPlacement1 || localProductPlacement1 !== apiProductPlacement1;
        if (hasPlacementDiff1 && protectedCampaignIds.has(existing.id)) {
          log.debug(`v165: 位置倾斜保护生效 - campaign=${existing.campaignName}, localTop=${localTopPlacement1}%, apiTop=${apiTopPlacement1}%, localProduct=${localProductPlacement1}%, apiProduct=${apiProductPlacement1}%`);
          // @ts-ignore
          delete (campaignData as Record<string, any>[]).placementTopSearchBidAdjustment;
          // @ts-ignore
          delete (campaignData as Record<string, any>[]).placementProductPageBidAdjustment;
          protectionStats.protectedEntities.push(`placement:${existing.campaignName}`);
        }
        
        await db
          .update(campaigns)
          // @ts-ignore
          .set(campaignData)
          .where(eq(campaigns.id, existing.id));
      } else {
        // @ts-ignore
        await db.insert(campaigns).values({
          ...campaignData,
          createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
        });
      }
      synced++;
      if (synced === 1 || synced % 10 === 0) {
        log.info(`[同步] 进度: 已同步 ${synced}/${apiCampaigns.length} 个广告活动`);
      }
    }

    log.info(`[同步] ========== SP广告活动同步完成 ==========`);
    log.info(`[同步] 结果: 同步 ${synced} 个, 跳过 ${skipped} 个`);
    logSyncProtectionSummary('syncSpCampaigns', protectionStats);
    return { synced, skipped };
  } catch (error: unknown) {
    log.error('[同步] ❌ SP广告活动同步失败');
    // @ts-ignore
    log.error('[同步] 错误类型:', error.constructor.name);
    log.error('[同步] 错误消息:', (error as Error).message);
    log.error('[同步] 错误堆栈:', (error as Error).stack);
    if ((error as Error & { response?: unknown }).response) {
      // @ts-ignore
      log.error('[同步] API响应状态:', (error as Error & { response?: unknown }).response.status);
      // @ts-ignore
      log.error('[同步] API响应数据:', JSON.stringify((error as Error & { response?: unknown }).response.data, null, 2));
    }
    return { synced: 0, skipped: 0 };
  }
};

/**
 * 同步SP广告组
 * @param lastSyncTime 上次同步时间，用于增量同步
 */
AmazonSyncService.prototype.syncSpAdGroups = async function(this: AmazonSyncService, lastSyncTime?: string | null): Promise<number | { synced: number; skipped: number }> {
  const db = await getDb();
  if (!db) return { synced: 0, skipped: 0 };

  try {
    const apiAdGroups = await this.client.listSpAdGroups();
    let synced = 0;
    let skipped = 0;

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

      // 增量同步：如果有上次同步时间且记录已存在，检查是否需要更新
      // v215修复: 移除错误的updatedAt跳过逻辑
      // 始终使用Amazon API返回的最新数据更新本地记录

      // Amazon API返回的state可能是大写的ENABLED/PAUSED/ARCHIVED，需要转换为小写
      const normalizedState = (apiAdGroup.state || 'enabled').toLowerCase() as 'enabled' | 'paused' | 'archived';
      
      const adGroupData = {
        campaignId: campaign.campaignId,
        accountId: this.accountId,
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
};

/**
 * 同步SP关键词
 * @param lastSyncTime 上次同步时间，用于增量同步
 */
AmazonSyncService.prototype.syncSpKeywords = async function(this: AmazonSyncService, lastSyncTime?: string | null): Promise<number | { synced: number; skipped: number }> {
  const db = await getDb();
  if (!db) return { synced: 0, skipped: 0 };

  try {
    const apiKeywords = await this.client.listSpKeywords();
    let synced = 0;
    let skipped = 0;

    // v150.1: 批量预查询所有需要保护的关键词ID（减少循环内DB查询）
    const allExistingKeywordIds: number[] = [];
    for (const ak of apiKeywords) {
      const [ag] = await db.select({ id: adGroups.id }).from(adGroups)
        .where(eq(adGroups.adGroupId, String(ak.adGroupId))).limit(1);
      if (!ag) continue;
      const [ex] = await db.select({ id: keywords.id }).from(keywords)
        .where(and(eq(keywords.adGroupId, String(ag.id)), eq(keywords.keywordId, String(ak.keywordId)))).limit(1);
      if (ex) allExistingKeywordIds.push(ex.id);
    }
    const protectedKeywordIds = await getRecentlyOptimizedKeywordIds(allExistingKeywordIds, SYNC_PROTECTION_CONFIG.BID_PROTECTION_HOURS);
    const protectionStats = createSyncProtectionStats();
    log.info(`syncSpKeywords: 批量查询完成, ${protectedKeywordIds.size}个关键词有近期出价优化事件`);

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

      // 增量同步：如果有上次同步时间且记录已存在，检查是否需要更新
      // v215修复: 移除错误的updatedAt跳过逻辑
      // 始终使用Amazon API返回的最新数据更新本地记录

      const keywordData: Record<string, any> = {
        adGroupId: String(adGroup.id),  // v357
        accountId: this.accountId,
        campaignId: adGroup.campaignId || '',  // v357
        keywordId: String(apiKeyword.keywordId),
        keywordText: apiKeyword.keywordText,
        matchType: apiKeyword.matchType as 'broad' | 'phrase' | 'exact',
        status: apiKeyword.state as 'enabled' | 'paused' | 'archived',
        bid: String(apiKeyword.bid),
        updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      };

      if (existing) {
        // v150: 智能出价保护策略
        // 检查optimization_events表，如果该关键词有24小时内成功同步到Amazon的出价优化事件，
        // 则保留本地出价不被覆盖（因为Amazon API数据可能有延迟）
        const localBid = parseFloat(existing.bid || '0');
        const apiBid = parseFloat(String(apiKeyword.bid || '0'));
        
        if (Math.abs(localBid - apiBid) > SYNC_PROTECTION_CONFIG.BID_THRESHOLD && localBid > 0) {
          // 出价不一致，检查是否有近期优化事件（使用批量查询结果）
          const hasRecentOpt = protectedKeywordIds.has(existing.id);
          if (hasRecentOpt) {
            // 有近期优化事件，保留本地出价，只更新其他字段
            log.debug(`v150: 出价保护生效 - keyword=${existing.keywordText}, local=$${localBid}, api=$${apiBid}, 保留本地优化出价`);
            delete keywordData.bid;
            protectionStats.bidProtected++;
            protectionStats.protectedEntities.push(`kw:${existing.keywordText}`);
          } else {
            log.debug(`v150: 出价差异 - keyword=${existing.keywordText}, local=$${localBid}, api=$${apiBid}, 以API为准`);
            protectionStats.bidOverwritten++;
          }
        }
        
        await db
          .update(keywords)
          .set(keywordData)
          .where(eq(keywords.id, existing.id));
      } else {
        // @ts-ignore
        await db.insert(keywords).values({
          ...keywordData,
          createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
        });
      }
      synced++;
    }

    logSyncProtectionSummary('syncSpKeywords', protectionStats);
    return { synced, skipped };
  } catch (error) {
    log.error('Error syncing SP keywords:', error);
    return { synced: 0, skipped: 0 };
  }
};

/**
 * 同步SP商品定位
 * @param lastSyncTime 上次同步时间，用于增量同步
 */
AmazonSyncService.prototype.syncSpProductTargets = async function(this: AmazonSyncService, lastSyncTime?: string | null): Promise<number | { synced: number; skipped: number }> {
  const db = await getDb();
  if (!db) return { synced: 0, skipped: 0 };

  try {
    const apiTargets = await this.client.listSpProductTargets();
    let synced = 0;
    let skipped = 0;

    // v150.1: 批量预查询所有需要保护的产品定向ID（减少循环内DB查询）
    const allExistingTargetIds: number[] = [];
    for (const at of apiTargets) {
      const [ag] = await db.select({ id: adGroups.id }).from(adGroups)
        .where(eq(adGroups.adGroupId, String(at.adGroupId))).limit(1);
      if (!ag) continue;
      const [ex] = await db.select({ id: productTargets.id }).from(productTargets)
        .where(and(eq(productTargets.adGroupId, String(ag.id)), eq(productTargets.targetId, String(at.targetId)))).limit(1);
      if (ex) allExistingTargetIds.push(ex.id);
    }
    const protectedTargetIds = await getRecentlyOptimizedKeywordIds(allExistingTargetIds, SYNC_PROTECTION_CONFIG.BID_PROTECTION_HOURS);
    const protectionStats = createSyncProtectionStats();
    log.info(`syncSpProductTargets: 批量查询完成, ${protectedTargetIds.size}个产品定向有近期出价优化事件`);

    for (const apiTarget of apiTargets) {
      // 查找对应的ad group
      const [adGroup] = await db
        .select()
        .from(adGroups)
        .where(eq(adGroups.adGroupId, String(apiTarget.adGroupId)))
        .limit(1);

      if (!adGroup) continue;

      // ============================================================
      // 解析定向表达式 - 支持ASIN定向和品类定向两种模式
      // ============================================================
      // Amazon SP API expression数组可能包含以下type:
      // ASIN定向: asinSameAs(精准), asinExpandedFrom(拓展)
      // 品类定向: asinCategorySameAs(品类精准+品类ID)
      // 品牌定向: asinBrandSameAs(品牌精准)
      // 自动定向: queryBroadRelMatches(广泛/loose), queryHighRelMatches(紧密/close)
      //          asinSubstituteSameAs(替代品), asinAccessorySameAs(配件)
      // 品类细化: asinPriceBetween(价格范围), asinReviewRatingBetween(星级范围)
      
      let targetType: 'asin' | 'category' = 'asin';
      let targetValue = '';
      let targetMatchType: 'exact' | 'expanded' | 'category_exact' | 'brand_exact' | 'substitute' | 'accessory' | 'loose' | 'close' = 'exact';
      let categoryName: string | null = null;
      let categoryRefinements: string | null = null;
      
      // 收集品类细化条件
      const refinements: Record<string, any> = {};
      
      for (const expr of (apiTarget.expression || [])) {
        const et = (expr.type || '').toLowerCase();
        
        if (et.includes('categorysame') || et === 'asincategorysameAs' || et === 'asincategorysame') {
          // 品类定向
          targetType = 'category';
          targetValue = expr.value || '';
          targetMatchType = 'category_exact';
        } else if (et.includes('brandsame') || et === 'asinbrandsameAs' || et === 'asinbrandsame') {
          // 品牌定向（属于品类定向的子类型）
          targetType = 'category';
          targetValue = expr.value || '';
          targetMatchType = 'brand_exact';
        } else if (et.includes('pricebetween') || et.includes('price')) {
          // 价格范围细化
          refinements.priceRange = expr.value;
        } else if (et.includes('reviewrating') || et.includes('star') || et.includes('rating')) {
          // 星级范围细化
          refinements.starRating = expr.value;
        } else if (et.includes('isprime')) {
          // Prime筛选
          refinements.isPrime = expr.value;
        } else if (et.includes('expanded') || et.includes('expandedfrom')) {
          // ASIN拓展匹配
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
        } else if (et.includes('broadrel') || et.includes('loose')) {
          targetValue = expr.value || 'AUTO_LOOSE';
          targetMatchType = 'loose';
        } else if (et.includes('highrel') || et.includes('close')) {
          targetValue = expr.value || 'AUTO_CLOSE';
          targetMatchType = 'close';
        } else if (et.includes('asin') && et.includes('same')) {
          // ASIN精准匹配 (asinSameAs)
          targetType = 'asin';
          targetValue = expr.value || '';
          targetMatchType = 'exact';
        } else if (expr.value && !targetValue) {
          // 兜底：取第一个有值的expression
          targetValue = expr.value;
        }
      }
      
      // 如果没有从expression中提取到值，尝试从resolvedExpression获取
      if (!targetValue && (apiTarget as Record<string, any>).resolvedExpression) {
        const resolved = (apiTarget as Record<string, any>).resolvedExpression;
        if (Array.isArray(resolved)) {
          for (const re of resolved) {
            const ret = (re.type || '').toLowerCase();
            if (ret.includes('category')) {
              targetType = 'category';
              targetValue = re.value || '';
              targetMatchType = 'category_exact';
              categoryName = re.name || null;
            } else if (re.value) {
              targetValue = re.value;
            }
          }
        }
      }
      
      // 构建品类细化条件JSON
      if (Object.keys(refinements).length > 0) {
        categoryRefinements = JSON.stringify(refinements);
      }
      
      // Amazon API返回的state可能是大写，需要转换为小写
      const normalizedState = (apiTarget.state || 'enabled').toLowerCase() as 'enabled' | 'paused' | 'archived';

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

      // 增量同步：如果有上次同步时间且记录已存在，检查是否需要更新
      // v215修复: 移除错误的updatedAt跳过逻辑
      // 始终使用Amazon API返回的最新数据更新本地记录

      const targetData = {
        adGroupId: String(adGroup.id),  // v357
        campaignId: adGroup.campaignId || '',  // v357
        targetId: String(apiTarget.targetId),
        targetType: targetType as 'asin' | 'category',
        targetValue,
        targetExpression: JSON.stringify(apiTarget.expression),
        targetMatchType,
        targetStatus: normalizedState,
        bid: String(apiTarget.bid || 0),
        categoryName: categoryName,
        categoryRefinements: categoryRefinements,
        updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      };

      if (synced === 0) {
        log.debug(`SP产品定向示例: type=${targetType}, value=${targetValue}, matchType=${targetMatchType}, categoryName=${categoryName}`);
      }

      if (existing) {
        // v150: 智能出价保护策略
        // 检查optimization_events表，如果该产品定向有24小时内成功同步的出价优化事件，
        // 则保留本地bid不被覆盖
        const localBid = parseFloat(existing.bid || '0');
        const apiBid = parseFloat(String(apiTarget.bid || '0'));
        
        if (Math.abs(localBid - apiBid) > SYNC_PROTECTION_CONFIG.BID_THRESHOLD && localBid > 0) {
          // 出价不一致，检查是否有近期优化事件（使用批量查询结果）
          const hasRecentOpt = protectedTargetIds.has(existing.id);
          if (hasRecentOpt) {
            log.debug(`v150: 出价保护生效 - target=${existing.targetValue}, local=$${localBid}, api=$${apiBid}, 保留本地优化出价`);
            // @ts-ignore
            delete (targetData as Record<string, any>[]).bid;
            protectionStats.bidProtected++;
            protectionStats.protectedEntities.push(`tgt:${existing.targetValue}`);
          } else {
            log.debug(`v150: 出价差异 - target=${existing.targetValue}, local=$${localBid}, api=$${apiBid}, 以API为准`);
            protectionStats.bidOverwritten++;
          }
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

    log.info(`SP产品定向同步完成: synced=${synced}, skipped=${skipped}`);
    logSyncProtectionSummary('syncSpProductTargets', protectionStats);
    return { synced, skipped };
  } catch (error) {
    log.error('Error syncing SP product targets:', error);
    return { synced: 0, skipped: 0 };
  }
};

/**
 * 同步SP否定关键词（活动级别 + 广告组级别）
 * 从Amazon API获取否定关键词并同步到本地negativeKeywords表
 */
AmazonSyncService.prototype.syncSpNegativeKeywords = async function(this: AmazonSyncService): Promise<{ synced: number; updated: number }> {
  const db = await getDb();
  if (!db) return { synced: 0, updated: 0 };

  try {
    let synced = 0;
    let updated = 0;

    // 1. 同步活动级别否定关键词
    log.info(`开始同步SP活动级别否定关键词...`);
    const campaignNegatives = await this.client.listSpCampaignNegativeKeywords();
    log.debug(`获取到 ${campaignNegatives.length} 个活动级别否定关键词`);

    for (const neg of campaignNegatives) {
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
      const negState = (neg.state || 'enabled').toLowerCase();
      if (negState === 'archived') continue;
      const matchType = (neg.matchType || '').toLowerCase().includes('phrase') 
        ? 'negative_phrase' as const 
        : 'negative_exact' as const;
      const amazonKeywordId = String(neg.keywordId || neg.campaignNegativeKeywordId || '');
      const [existing] = await db
        .select()
        .from(negativeKeywords)
        .where(
          and(
            eq(negativeKeywords.accountId, this.accountId),
            eq(negativeKeywords.campaignId, String(campaign.campaignId)),
            eq(negativeKeywords.negativeLevel, 'campaign'),
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
          negativeLevel: 'campaign',
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

    // 2. 同步广告组级别否定关键词
    log.info(`开始同步SP广告组级别否定关键词...`);
    const adGroupNegatives = await this.client.listSpNegativeKeywords();
    log.debug(`获取到 ${adGroupNegatives.length} 个广告组级别否定关键词`);

    for (const neg of adGroupNegatives) {
      const negState = (neg.state || 'enabled').toLowerCase();
      if (negState === 'archived') continue;
      const [adGroup] = await db
        .select()
        .from(adGroups)
        .where(eq(adGroups.adGroupId, String(neg.adGroupId)))
        .limit(1);
      if (!adGroup) continue;
      const [campaign] = await db
        .select()
        .from(campaigns)
        .where(eq(campaigns.campaignId, adGroup.campaignId))
        .limit(1);
      if (!campaign) continue;
      const matchType = (neg.matchType || '').toLowerCase().includes('phrase') 
        ? 'negative_phrase' as const 
        : 'negative_exact' as const;
      const amazonKeywordId = String(neg.keywordId || neg.negativeKeywordId || '');
      const [existing] = await db
        .select()
        .from(negativeKeywords)
        .where(
          and(
            eq(negativeKeywords.accountId, this.accountId),
            eq(negativeKeywords.campaignId, String(campaign.campaignId)),
            eq(negativeKeywords.adGroupId, String(adGroup.id)),
            eq(negativeKeywords.negativeLevel, 'ad_group'),
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
          adGroupId: String(adGroup.id),  // v357
          negativeLevel: 'ad_group',
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

    log.info(`SP否定关键词同步完成: ${synced} 条新记录, ${updated} 条更新`);
    return { synced, updated };
  } catch (error) {
    log.error('Error syncing SP negative keywords:', error);
    return { synced: 0, updated: 0 };
  }
};

/**
 * 同步SP否定商品定向
 * 从Amazon API获取否定商品定向并同步到本地negativeKeywords表
 */
AmazonSyncService.prototype.syncSpNegativeProductTargets = async function(this: AmazonSyncService): Promise<{ synced: number; updated: number }> {
  const db = await getDb();
  if (!db) return { synced: 0, updated: 0 };
  try {
    let synced = 0;
    let updated = 0;
    // 1. 同步活动级别否定商品定向
    log.info(`开始同步SP活动级别否定商品定向...`);
    const campaignNegTargets = await this.client.listSpCampaignNegativeTargets();
    log.debug(`获取到 ${campaignNegTargets.length} 个活动级别否定商品定向`);
    for (const neg of campaignNegTargets) {
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
      const negState = (neg.state || 'enabled').toLowerCase();
      if (negState === 'archived') continue;
      const expression = neg.expression || [];
      const asinExpr = expression.find((e: Record<string, any>) => e.type?.toLowerCase().includes('asin'));
      const negativeText = asinExpr?.value || JSON.stringify(expression);
      const amazonTargetId = String(neg.targetId || '');
      const [existing] = await db
        .select()
        .from(negativeKeywords)
        .where(
          and(
            eq(negativeKeywords.accountId, this.accountId),
            eq(negativeKeywords.campaignId, String(campaign.campaignId)),
            eq(negativeKeywords.negativeLevel, 'campaign'),
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
          negativeLevel: 'campaign',
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
    // 2. 同步广告组级别否定商品定向
    log.info(`开始同步SP广告组级别否定商品定向...`);
    const adGroupNegTargets = await this.client.listSpNegativeTargets();
    log.debug(`获取到 ${adGroupNegTargets.length} 个广告组级别否定商品定向`);
    for (const neg of adGroupNegTargets) {
      const negState = (neg.state || 'enabled').toLowerCase();
      if (negState === 'archived') continue;
      const [adGroup] = await db
        .select()
        .from(adGroups)
        .where(eq(adGroups.adGroupId, String(neg.adGroupId)))
        .limit(1);
      if (!adGroup) continue;
      const [campaign] = await db
        .select()
        .from(campaigns)
        .where(eq(campaigns.campaignId, adGroup.campaignId))
        .limit(1);
      if (!campaign) continue;
      const expression = neg.expression || [];
      const asinExpr = expression.find((e: Record<string, any>) => e.type?.toLowerCase().includes('asin'));
      const negativeText = asinExpr?.value || JSON.stringify(expression);
      const amazonTargetId = String(neg.targetId || '');
      const [existing] = await db
        .select()
        .from(negativeKeywords)
        .where(
          and(
            eq(negativeKeywords.accountId, this.accountId),
            eq(negativeKeywords.campaignId, String(campaign.campaignId)),
            eq(negativeKeywords.adGroupId, String(adGroup.id)),
            eq(negativeKeywords.negativeLevel, 'ad_group'),
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
          adGroupId: String(adGroup.id),  // v357
          negativeLevel: 'ad_group',
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
    log.info(`SP否定商品定向同步完成: ${synced} 条新记录, ${updated} 条更新`);
    return { synced, updated };
  } catch (error) {
    log.error('Error syncing SP negative product targets:', error);
    return { synced: 0, updated: 0 };
  }
};

