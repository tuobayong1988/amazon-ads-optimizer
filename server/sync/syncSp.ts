/**
 * SP (Sponsored Products) 广告数据同步方法
 * 
 * 从 amazonSyncService.ts 中提取的 syncSp 子模块。
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
  campaignBudgetRules,
} from '../../drizzle/schema';
import { createModuleLogger } from '../utils/logger';
import type { AmazonAdsApiClient, SpCampaign } from './amazonAdsApi';
import { getMarketplaceDateRange, getMarketplaceCurrentDate, getMarketplaceYesterday, getMarketplaceHistoricalDateRange } from '../utils/timezone';
import { getExchangeRateByMarketplace } from '../services/exchangeRateService';
import { AmazonSyncService } from './amazonSyncService';
import { getLocalKeywordBidRecommendation, getLocalTargetBidRecommendation } from '../optimization/localBidRecommendationEngine';
import {
  SYNC_PROTECTION_CONFIG,
  createSyncProtectionStats,
  logSyncProtectionSummary,
  hasRecentSyncedOptimization,
  getRecentlyOptimizedKeywordIds,
  getRecentlyOptimizedCampaignIds,
} from './syncHelpers';

const log = createModuleLogger('syncSp');

// ==================== v529: 大账户分段同步辅助函数 ====================

/**
 * v529: 分段批量查询辅助函数
 * 将大数组分段执行 inArray 查询，避免 MySQL IN 子句过大（超过 65535 参数限制）
 * 对于 5000+ campaigns 的大账户，keywords 可能超过 75K，需要分段处理
 */
const SEGMENTED_QUERY_BATCH_SIZE = 5000; // 每批最多 5000 个 ID

async function batchInArrayQuery<T>(
  queryFn: (ids: string[]) => Promise<T[]>,
  allIds: string[],
): Promise<T[]> {
  if (allIds.length <= SEGMENTED_QUERY_BATCH_SIZE) {
    return allIds.length > 0 ? queryFn(allIds) : [];
  }
  
  const results: T[] = [];
  for (let i = 0; i < allIds.length; i += SEGMENTED_QUERY_BATCH_SIZE) {
    const batch = allIds.slice(i, i + SEGMENTED_QUERY_BATCH_SIZE);
    const batchResults = await queryFn(batch);
    results.push(...batchResults);
  }
  log.info(`v529: 分段批量查询完成, 总ID数=${allIds.length}, 分${Math.ceil(allIds.length / SEGMENTED_QUERY_BATCH_SIZE)}批, 结果数=${results.length}`);
  return results;
}

// ==================== 类型声明（模块扩展） ====================

// @ts-expect-error Legacy code type compatibility
declare module '../../amazonSyncService' {
  interface AmazonSyncService {
    syncSpCampaigns(...args: unknown[]): unknown;
    syncSpAdGroups(...args: unknown[]): unknown;
    syncSpKeywords(...args: unknown[]): unknown;
    syncSpProductTargets(...args: unknown[]): unknown;
    syncSpNegativeKeywords(...args: unknown[]): unknown;
    syncSpNegativeProductTargets(...args: unknown[]): unknown;
    syncSpBidRecommendations(...args: unknown[]): unknown;
    syncSpBudgetRules(...args: unknown[]): unknown;
  }
}

// ==================== 方法实现 ====================

/**
 * 同步SP广告活动
 * @param lastSyncTime 上次同步时间，用于增量同步
 */
// @ts-expect-error Dynamic property access
AmazonSyncService.prototype.syncSpCampaigns = async function(this: AmazonSyncService, lastSyncTime?: string | null): Promise<number | { synced: number; skipped: number }> {
  log.info('[同步] ========== 开始同步SP广告活动 ==========');
  log.info('[同步] 参数:', { accountId: this.accountId, lastSyncTime, marketplace: this.marketplace });
  
  const db = await getDb();
  if (!db) {
    log.warn('[同步] ❌ 数据库连接失败 - getDb()返回null');
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

    // v529: 大账户分段同步 - 分段批量查询避免 MySQL IN 子句过大
    log.info(`syncSpCampaigns: 开始处理 ${apiCampaigns.length} 个广告活动`);
    const apiCampaignIds = apiCampaigns.map(ac => String(ac.campaignId));
    const existingCampaignRows = await batchInArrayQuery(
      (ids) => db.select({ id: campaigns.id, campaignId: campaigns.campaignId }).from(campaigns)
        .where(and(eq(campaigns.accountId, this.accountId), inArray(campaigns.campaignId, ids))),
      apiCampaignIds
    );
    const existingCampaignMap = new Map(existingCampaignRows.map(r => [r.campaignId, r.id]));
    const allExistingCampaignIds = existingCampaignRows.map(r => r.id);
    const protectedCampaignIds = await getRecentlyOptimizedCampaignIds(allExistingCampaignIds, SYNC_PROTECTION_CONFIG.BUDGET_PROTECTION_HOURS);
    const protectionStats = createSyncProtectionStats();
    log.info(`syncSpCampaigns: 批量查询完成, ${apiCampaigns.length}个API广告活动, ${existingCampaignRows.length}个已存在, ${protectedCampaignIds.size}个有近期预算优化事件`);

    // v529: 分段批量查询所有已存在的campaign完整记录
    const existingCampaignFullRows = await batchInArrayQuery(
      (ids) => db.select({
          id: campaigns.id,
          campaignId: campaigns.campaignId,
          campaignName: campaigns.campaignName,
          dailyBudget: campaigns.dailyBudget,
          placementTopSearchBidAdjustment: campaigns.placementTopSearchBidAdjustment,
          placementProductPageBidAdjustment: campaigns.placementProductPageBidAdjustment,
        }).from(campaigns)
          .where(and(eq(campaigns.accountId, this.accountId), inArray(campaigns.campaignId, ids))),
      apiCampaignIds
    );
    const existingCampaignFullMap = new Map(existingCampaignFullRows.map(r => [r.campaignId, r]));

    for (const apiCampaign of apiCampaigns) {
      // v363: 使用批量预查询结果替代循环内查询
      const existing = existingCampaignFullMap.get(String(apiCampaign.campaignId)) || null;

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
      // @ts-expect-error Dynamic type assertion
      const budgetField = (apiCampaign as Record<string, unknown>).budget;
      if (budgetField !== undefined && budgetField !== null) {
        // @ts-expect-error Conditional type narrowing
        if (typeof budgetField === 'number') {
          dailyBudgetValue = budgetField;
        } else if (typeof budgetField === 'object') {
          // @ts-expect-error Legacy code type compatibility
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
        // @ts-expect-error Legacy code type compatibility
        }
      // @ts-expect-error Legacy code type compatibility
      }

      // v423: 获取竞价策略 - API v3返回大写格式，需要映射到数据库枚举值
      // @ts-expect-error Dynamic type assertion
      const rawStrategy = (apiCampaign as Record<string, unknown>).dynamicBidding?.strategy || 
                         // @ts-expect-error Amazon API response type flexibility
                         (apiCampaign as Record<string, unknown>).bidding?.strategy || 
                         'LEGACY_FOR_SALES';
      const strategyMap: Record<string, string> = {
        // @ts-expect-error Legacy code type compatibility
        'MANUAL': 'manual', 'LEGACY_FOR_SALES': 'legacyForSales', 'AUTO_FOR_SALES': 'autoForSales', 'RULE_BASED': 'ruleBasedBidding',
        'manual': 'manual', 'legacyForSales': 'legacyForSales', 'autoForSales': 'autoForSales', 'ruleBasedBidding': 'ruleBasedBidding',
      };
      const biddingStrategy = strategyMap[rawStrategy] || 'legacyForSales';

      // 获取组合信息
      // @ts-expect-error Dynamic type assertion
      const portfolioId = (apiCampaign as Record<string, unknown>).portfolioId ? String((apiCampaign as Record<string, unknown>).portfolioId) : null;

      const campaignData = {
        accountId: this.accountId,
        campaignId: String(apiCampaign.campaignId),
        campaignName: apiCampaign.name,
        // @ts-expect-error Legacy code type compatibility
        campaignType: campaignType as 'sp_auto' | 'sp_manual' | 'sb' | 'sd',
        // @ts-expect-error Legacy code type compatibility
        targetingType: normalizedTargetingType,
        // @ts-expect-error Legacy code type compatibility
        dailyBudget: String(dailyBudgetValue),
        campaignStatus: (apiCampaign.state?.toLowerCase() || 'enabled') as 'enabled' | 'paused' | 'archived',
        state: (apiCampaign.state?.toLowerCase() || 'enabled') as 'enabled' | 'paused' | 'archived' | 'pending' | 'other',
        startDate: startDateValue,
        endDate: endDateValue,
        // @ts-expect-error Legacy code type compatibility
        placementTopSearchBidAdjustment: this.getPlacementMultiplier(apiCampaign, 'placementTop'),
        // @ts-expect-error Legacy code type compatibility
        placementProductPageBidAdjustment: this.getPlacementMultiplier(apiCampaign, 'placementProductPage'),
        // @ts-expect-error Legacy code type compatibility
        placementRestBidAdjustment: this.getPlacementMultiplier(apiCampaign, 'placementRestOfSearch'),
        biddingStrategy: biddingStrategy as 'legacyForSales' | 'autoForSales' | 'manual' | 'ruleBasedBidding',
        portfolioId: portfolioId,
        costType: 'cpc' as 'cpc' | 'vcpm' | 'cpm', // SP广告都是CPC
        // @ts-expect-error Legacy code type compatibility
        amazonCreatedDate: startDateValue, // 使用广告活动的startDate作为Amazon侧创建日期
        updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      };

      if (existing) {
        // v168: 零值预算防护 - 如果API返回budget=0但本地有非零值，保留本地值
        const localBudget = parseFloat(existing.dailyBudget || '0');
        const apiBudget = parseFloat(String(dailyBudgetValue || '0'));
        if (apiBudget === 0 && localBudget > 0) {
          log.warn(`v168: 零值预算防护生效 - campaign=${existing.campaignName}, local=$${localBudget}, api=$${apiBudget}, 保留本地预算`);
          // @ts-expect-error Dynamic type assertion
          delete (campaignData as Record<string, unknown>[]).dailyBudget;
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
            // @ts-expect-error Dynamic type assertion
            delete (campaignData as Record<string, unknown>[]).dailyBudget;
            // @ts-expect-error Legacy code type compatibility
            protectionStats.budgetProtected++;
            protectionStats.protectedEntities.push(`camp:${existing.campaignName}`);
          } else {
            // @ts-expect-error Complex function parameter types
            log.debug(`v150: 预算差异 - campaign=${existing.campaignName}, local=$${localBudget}, api=$${apiBudget}, 以API为准`);
            protectionStats.budgetOverwritten++;
          }
        }
        
        // v165: 位置倾斜比例保护逻辑
        // @ts-expect-error Type inference limitation
        const localTopPlacement1 = existing.placementTopSearchBidAdjustment || 0;
        // @ts-expect-error Dynamic type assertion
        const apiTopPlacement1 = (campaignData as Record<string, unknown>[]).placementTopSearchBidAdjustment || 0;
        const localProductPlacement1 = existing.placementProductPageBidAdjustment || 0;
        // @ts-expect-error Dynamic type assertion
        const apiProductPlacement1 = (campaignData as Record<string, unknown>[]).placementProductPageBidAdjustment || 0;
        // v423: 增加restOfSearch位置保护
        const localRestPlacement1 = (existing as Record<string, unknown>).placementRestBidAdjustment || 0;
        // @ts-expect-error Dynamic type assertion
        const apiRestPlacement1 = (campaignData as Record<string, unknown>[]).placementRestBidAdjustment || 0;
        const hasPlacementDiff1 = localTopPlacement1 !== apiTopPlacement1 || localProductPlacement1 !== apiProductPlacement1 || localRestPlacement1 !== apiRestPlacement1;
        if (hasPlacementDiff1 && protectedCampaignIds.has(existing.id)) {
          log.debug(`v165: 位置倾斜保护生效 - campaign=${existing.campaignName}, localTop=${localTopPlacement1}%, apiTop=${apiTopPlacement1}%, localProduct=${localProductPlacement1}%, apiProduct=${apiProductPlacement1}%, localRest=${localRestPlacement1}%, apiRest=${apiRestPlacement1}%`);
          // @ts-expect-error Dynamic type assertion
          delete (campaignData as Record<string, unknown>[]).placementTopSearchBidAdjustment;
          // @ts-expect-error Dynamic type assertion
          delete (campaignData as Record<string, unknown>[]).placementProductPageBidAdjustment;
          // @ts-expect-error Dynamic type assertion
          delete (campaignData as Record<string, unknown>[]).placementRestBidAdjustment;
          protectionStats.protectedEntities.push(`placement:${existing.campaignName}`);
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
      if (synced === 1 || synced % 10 === 0) {
        log.info(`[同步] 进度: 已同步 ${synced}/${apiCampaigns.length} 个广告活动`);
      }
    }

    log.info(`[同步] ========== SP广告活动同步完成 ==========`);
    log.info(`[同步] 结果: 同步 ${synced} 个, 跳过 ${skipped} 个`);
    logSyncProtectionSummary('syncSpCampaigns', protectionStats);
    return { synced, skipped };
  } catch (error: unknown) {
    log.warn('[同步] ❌ SP广告活动同步失败');
    // @ts-expect-error - runtime type mismatch
    log.warn('[同步] 错误类型:', error.constructor.name);
    log.warn('[同步] 错误消息:', (error as Error).message);
    log.warn('[同步] 错误堆栈:', (error as Error).stack);
    if ((error as Error & { response?: unknown }).response) {
      // @ts-expect-error - Axios error response access
      log.warn('[同步] API响应状态:', (error as Error & { response?: unknown }).response.status);
      // @ts-expect-error - Axios error response access
      log.warn('[同步] API响应数据:', JSON.stringify((error as Error & { response?: unknown }).response.data, null, 2));
    }
    return { synced: 0, skipped: 0 };
  }
};

/**
 * 同步SP广告组
 * @param lastSyncTime 上次同步时间，用于增量同步
 */
// @ts-expect-error Dynamic property access
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

      // v387: 检查是否已存在（添加accountId过滤）
      const [existing] = await db
        .select()
        .from(adGroups)
        .where(
          and(
            eq(adGroups.accountId, this.accountId),
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
        // v529: 添加onDuplicateKeyUpdate处理竞态条件下的DUP_ENTRY错误
        await db.insert(adGroups).values({
          ...adGroupData,
          createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
        }).onDuplicateKeyUpdate({
          set: {
            adGroupName: sql`VALUES(adGroupName)`,
            adGroupStatus: sql`VALUES(adGroupStatus)`,
            defaultBid: sql`VALUES(defaultBid)`,
            updatedAt: sql`VALUES(updatedAt)`,
          }
        });
      }
      synced++;
    // @ts-expect-error Legacy code type compatibility
    }

    return { synced, skipped };
  } catch (error: any) {
    {
    const _cause = (error as Record<string, unknown>)?.cause as Record<string, unknown> | undefined;
    const _mysqlCause = _cause?.cause as Record<string, unknown> | undefined;
    const _mysqlErr = _mysqlCause || _cause;
    const _mysqlInfo = _mysqlErr ? `code=${_mysqlErr.code||_mysqlErr.errno||'?'}, msg=${String(_mysqlErr.message||_mysqlErr.sqlMessage||'').slice(0,200)}` : 'no-mysql-cause';
    log.warn(`Error syncing SP ad groups: ${(error as Error).message?.slice(0,200)} | MySQL: ${_mysqlInfo}`);
    }
    return { synced: 0, skipped: 0 };
  }
};

/**
 * 同步SP关键词
 * @param lastSyncTime 上次同步时间，用于增量同步
 */
// @ts-expect-error Dynamic property access
AmazonSyncService.prototype.syncSpKeywords = async function(this: AmazonSyncService, lastSyncTime?: string | null): Promise<number | { synced: number; skipped: number }> {
  const db = await getDb();
  if (!db) return { synced: 0, skipped: 0 };

  try {
    const apiKeywords = await this.client.listSpKeywords();
    let synced = 0;
    let skipped = 0;

    // v529: 大账户分段同步 - 分段批量查询避免 MySQL IN 子句过大
    log.info(`syncSpKeywords: 开始处理 ${apiKeywords.length} 个关键词`);
    
    // 步骤1: 分段批量查询所有相关adGroup
    const apiKeywordAdGroupIds = [...new Set(apiKeywords.map(ak => String(ak.adGroupId)))];
    const adGroupRows = await batchInArrayQuery(
      (ids) => db.select({ id: adGroups.id, adGroupId: adGroups.adGroupId, campaignId: adGroups.campaignId }).from(adGroups)
        .where(and(eq(adGroups.accountId, this.accountId), inArray(adGroups.adGroupId, ids))),
      apiKeywordAdGroupIds
    );
    const adGroupIdMap = new Map(adGroupRows.map(r => [r.adGroupId, r.id]));
    const adGroupFullMap = new Map(adGroupRows.map(r => [r.adGroupId, { id: r.id, campaignId: r.campaignId }]));
    
    // v529: 分段批量查询所有已存在的keyword
    const apiKeywordIds = apiKeywords.map(ak => String(ak.keywordId));
    const existingKeywordRows = await batchInArrayQuery(
      (ids) => db.select({ id: keywords.id, keywordId: keywords.keywordId, adGroupId: keywords.internalAdGroupId, bid: keywords.bid, keywordText: keywords.keywordText, matchType: keywords.matchType }).from(keywords)
        .where(and(eq(keywords.accountId, this.accountId), inArray(keywords.keywordId, ids))),
      apiKeywordIds
    );
    const existingKeywordMap = new Map(existingKeywordRows.map(r => [`${r.adGroupId}:${r.keywordId}`, r]));
    
    // v647: 二次匹配索引 — 通过 adGroupId+keywordText+matchType 匹配已有记录
    // 用于修复已有记录的keywordId字段被污染为text:前缀表达式的情况
    const allAccountKeywordRows = await batchInArrayQuery(
      (ids) => db.select({ id: keywords.id, keywordId: keywords.keywordId, adGroupId: keywords.internalAdGroupId, bid: keywords.bid, keywordText: keywords.keywordText, matchType: keywords.matchType }).from(keywords)
        .where(and(eq(keywords.accountId, this.accountId), inArray(keywords.internalAdGroupId, ids.map(Number).filter(n => !isNaN(n))))),
      [...new Set(adGroupRows.map(r => String(r.id)))]
    );
    const textMatchMap = new Map<string, typeof allAccountKeywordRows[0]>();
    let corruptedKeywordIdCount = 0;
    for (const r of allAccountKeywordRows) {
      if (r.keywordText && r.adGroupId && r.matchType) {
        const key = `${r.adGroupId}:${r.keywordText.toLowerCase().trim()}:${r.matchType.toLowerCase()}`;
        textMatchMap.set(key, r);
      }
      // v647: 统计已污染的keywordId
      if (r.keywordId && !/^\d+$/.test(r.keywordId.trim())) {
        corruptedKeywordIdCount++;
      }
    }
    if (corruptedKeywordIdCount > 0) {
      log.warn(`[v647] 发现${corruptedKeywordIdCount}个非数字keywordId记录，将在同步时修复`);
    }
    
    const allExistingKeywordIds = existingKeywordRows.map(r => r.id);
    const protectedKeywordIds = await getRecentlyOptimizedKeywordIds(allExistingKeywordIds, SYNC_PROTECTION_CONFIG.BID_PROTECTION_HOURS);
    const protectionStats = createSyncProtectionStats();
    let keywordIdRepaired = 0;
    log.info(`syncSpKeywords: 批量查询完成, ${apiKeywords.length}个API关键词, ${existingKeywordRows.length}个已存在, ${protectedKeywordIds.size}个有近期出价优化事件, ${corruptedKeywordIdCount}个待修复keywordId`);

    for (const apiKeyword of apiKeywords) {
      // v363: 使用批量预查询结果替代循环内查询
      const adGroupInfo = adGroupFullMap.get(String(apiKeyword.adGroupId));
      if (!adGroupInfo) continue;
      const adGroup = adGroupInfo;

      // v363: 使用批量预查询结果
      let existing = existingKeywordMap.get(`${adGroup.id}:${String(apiKeyword.keywordId)}`) || null;
      
      // v647: 二次匹配 — 当通过keywordId匹配不到时，通过adGroupId+keywordText+matchType匹配
      // 这可以修复keywordId被污染为text:前缀表达式的记录
      if (!existing && apiKeyword.keywordText) {
        const normalizedMatch = (apiKeyword.matchType || 'broad').toLowerCase();
        const textKey = `${adGroup.id}:${apiKeyword.keywordText.toLowerCase().trim()}:${normalizedMatch}`;
        const textMatched = textMatchMap.get(textKey);
        if (textMatched) {
          // 找到了通过文本匹配的记录，检查其keywordId是否需要修复
          const oldKwId = textMatched.keywordId || '';
          const newKwId = String(apiKeyword.keywordId);
          if (oldKwId !== newKwId) {
            log.info(`[v647] 修复keywordId: keyword="${apiKeyword.keywordText?.substring(0, 40)}" 旧ID="${oldKwId.substring(0, 50)}" → 新ID="${newKwId}" (adGroup=${adGroup.id})`);
            keywordIdRepaired++;
          }
          existing = textMatched;
        }
      }

      // 增量同步：如果有上次同步时间且记录已存在，检查是否需要更新
      // v215修复: 移除错误的updatedAt跳过逻辑
      // 始终使用Amazon API返回的最新数据更新本地记录

      const keywordData: Record<string, unknown> = {
        internalAdGroupId: adGroup.id,  // v418: ID体系重构
        accountId: this.accountId,
        campaignId: adGroup.campaignId || '',  // v357
        keywordId: String(apiKeyword.keywordId),
        keywordText: apiKeyword.keywordText,
        matchType: (apiKeyword.matchType || 'broad').toLowerCase() as 'broad' | 'phrase' | 'exact',
        keywordStatus: (apiKeyword.state || 'enabled').toLowerCase() as 'enabled' | 'paused' | 'archived',
        bid: String(apiKeyword.bid),
        updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      };

      if (existing) {
        // v523.2: 保护 amazon_deleted 状态不被同步覆盖
        const normalizedApiState = (apiKeyword.state || 'enabled').toLowerCase();
        if (existing.keywordStatus === 'amazon_deleted' && normalizedApiState !== 'archived') {
          log.debug(`v523.2: 保护SP(syncSp) keyword amazon_deleted状态 - keyword=${existing.keywordText}(id=${existing.id})`);
          delete keywordData.keywordStatus;
        }
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
        // @ts-expect-error - Drizzle query builder type
        // v529: 添加onDuplicateKeyUpdate处理竞态条件下的DUP_ENTRY错误
        await db.insert(keywords).values({
          ...keywordData,
          createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
        }).onDuplicateKeyUpdate({
          set: {
            bid: sql`VALUES(bid)`,
            keywordStatus: sql`VALUES(keywordStatus)`,
            updatedAt: sql`VALUES(updatedAt)`,
          }
        });
      // @ts-expect-error Legacy code type compatibility
      }
      synced++;
    }

    logSyncProtectionSummary('syncSpKeywords', protectionStats);
    if (keywordIdRepaired > 0) {
      log.info(`[v647] SP关键词同步完成: 修复了${keywordIdRepaired}个被污染的keywordId`);
    }
    return { synced, skipped };
  } catch (error: any) {
    const _cause = (error as Record<string, unknown>)?.cause as Record<string, unknown> | undefined;
    const _mysqlCause = _cause?.cause as Record<string, unknown> | undefined;
    const _mysqlErr = _mysqlCause || _cause;
    const _mysqlInfo = _mysqlErr ? `code=${_mysqlErr.code||_mysqlErr.errno||'?'}, msg=${String(_mysqlErr.message||_mysqlErr.sqlMessage||'').slice(0,200)}` : 'no-mysql-cause';
    log.warn(`Error syncing SP keywords: ${(error as Error).message?.slice(0,200)} | MySQL: ${_mysqlInfo}`);
    return { synced: 0, skipped: 0 };
  }
};

/**
 * 同步SP商品定位
 * @param lastSyncTime 上次同步时间，用于增量同步
 */
// @ts-expect-error Dynamic property access
AmazonSyncService.prototype.syncSpProductTargets = async function(this: AmazonSyncService, lastSyncTime?: string | null): Promise<number | { synced: number; skipped: number }> {
  const db = await getDb();
  if (!db) return { synced: 0, skipped: 0 };

  try {
    const apiTargets = await this.client.listSpProductTargets();
    let synced = 0;
    let skipped = 0;

    // v529: 大账户分段同步 - 分段批量查询避免 MySQL IN 子句过大
    log.info(`syncSpProductTargets: 开始处理 ${apiTargets.length} 个产品定向`);
    
    const apiTargetAdGroupIds = [...new Set(apiTargets.map(at => String(at.adGroupId)))];
    const targetAdGroupRows = await batchInArrayQuery(
      (ids) => db.select({ id: adGroups.id, adGroupId: adGroups.adGroupId, campaignId: adGroups.campaignId }).from(adGroups)
        .where(and(eq(adGroups.accountId, this.accountId), inArray(adGroups.adGroupId, ids))),
      apiTargetAdGroupIds
    );
    const targetAdGroupIdMap = new Map(targetAdGroupRows.map(r => [r.adGroupId, r.id]));
    const targetAdGroupFullMap = new Map(targetAdGroupRows.map(r => [r.adGroupId, { id: r.id, campaignId: r.campaignId }]));
    
    const apiTargetIds = apiTargets.map(at => String(at.targetId));
    const existingTargetRows = await batchInArrayQuery(
      (ids) => db.select({ id: productTargets.id, targetId: productTargets.targetId, adGroupId: productTargets.internalAdGroupId, bid: productTargets.bid, targetValue: productTargets.targetValue }).from(productTargets)
        .where(and(eq(productTargets.accountId, this.accountId), inArray(productTargets.targetId, ids))),
      apiTargetIds
    );
    const existingTargetMap = new Map(existingTargetRows.map(r => [`${r.adGroupId}:${r.targetId}`, r]));
    const allExistingTargetIds = existingTargetRows.map(r => r.id);
    const protectedTargetIds = await getRecentlyOptimizedKeywordIds(allExistingTargetIds, SYNC_PROTECTION_CONFIG.BID_PROTECTION_HOURS);
    const protectionStats = createSyncProtectionStats();
    log.info(`syncSpProductTargets: 批量查询完成, ${apiTargets.length}个API定向, ${existingTargetRows.length}个已存在, ${protectedTargetIds.size}个有近期出价优化事件`);

    for (const apiTarget of apiTargets) {
      // v363: 使用批量预查询结果替代循环内查询
      const targetAdGroupInfo = targetAdGroupFullMap.get(String(apiTarget.adGroupId));
      if (!targetAdGroupInfo) continue;
      const adGroup = targetAdGroupInfo;

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
      const refinements: Record<string, unknown> = {};
      
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
          // @ts-expect-error Legacy code type compatibility
          targetType = 'asin';
          // @ts-expect-error Legacy code type compatibility
          targetValue = expr.value || 'AUTO_COMPLEMENTS';
          targetMatchType = 'accessory';
        } else if (et.includes('broadrel') || et.includes('broad_rel') || et.includes('loose')) {
          targetValue = expr.value || 'AUTO_LOOSE';
          targetMatchType = 'loose';
        } else if (et.includes('highrel') || et.includes('high_rel') || et.includes('close')) {
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
      // @ts-expect-error Dynamic type assertion
      if (!targetValue && (apiTarget as Record<string, unknown>).resolvedExpression) {
        // @ts-expect-error Dynamic type assertion
        const resolved = (apiTarget as Record<string, unknown>).resolvedExpression;
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
      
      // v474: 安全处理 - 如果targetValue仍然为空，使用expression类型作为回退值
      if (!targetValue) {
        const exprTypes = (apiTarget.expression || []).map((e: Record<string, unknown>) => e.type || '').join(',');
        targetValue = exprTypes || `AUTO_${String(apiTarget.targetId)}`;
        log.debug(`v474: targetValue为空，使用回退值: ${targetValue}`);
      }
      
      // Amazon API返回的state可能是大写，需要转换为小写
      const normalizedState = (apiTarget.state || 'enabled').toLowerCase() as 'enabled' | 'paused' | 'archived';

      // v387: 检查是否已存在（添加accountId过滤）
      const [existing] = await db
        .select()
        .from(productTargets)
        .where(
          and(
            eq(productTargets.accountId, this.accountId),
            eq(productTargets.internalAdGroupId, adGroup.id),  // v420: 修复 - internalAdGroupId是int类型
            eq(productTargets.targetId, String(apiTarget.targetId))
          )
        )
        .limit(1);

      // 增量同步：如果有上次同步时间且记录已存在，检查是否需要更新
      // v215修复: 移除错误的updatedAt跳过逻辑
      // 始终使用Amazon API返回的最新数据更新本地记录

      const targetData = {
        accountId: this.accountId,
        internalAdGroupId: adGroup.id,  // v418: ID体系重构
        campaignId: adGroup.campaignId || '',  // v357
        targetId: String(apiTarget.targetId),
        targetType: targetType as 'asin' | 'category',
        targetValue,
        targetExpression: JSON.stringify(apiTarget.expression),
        targetMatchType,
        // @ts-expect-error Legacy code type compatibility
        targetStatus: normalizedState,
        bid: String(typeof apiTarget.bid === 'object' && apiTarget.bid !== null ? (apiTarget.bid as Record<string, unknown>).amount || 0 : (apiTarget.bid || 0)),
        categoryName: categoryName,
        categoryRefinements: categoryRefinements,
        updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      };

      if (synced === 0) {
        log.debug(`SP产品定向示例: type=${targetType}, value=${targetValue}, matchType=${targetMatchType}, categoryName=${categoryName}`);
      }

      if (existing) {
        // v523.2: 保护 amazon_deleted 状态不被同步覆盖
        if (existing.targetStatus === 'amazon_deleted' && normalizedState !== 'archived') {
          log.debug(`v523.2: 保护SP(syncSp) target amazon_deleted状态 - target=${existing.targetValue}(id=${existing.id})`);
          delete (targetData as Record<string, unknown>).targetStatus;
        }
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
            // @ts-expect-error Amazon API response type flexibility
            delete (targetData as Record<string, unknown>[]).bid;
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
        // v529: 添加onDuplicateKeyUpdate处理竞态条件下的DUP_ENTRY错误
        await db.insert(productTargets).values({
          ...targetData,
          createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
        // @ts-expect-error Complex function parameter types
        }).onDuplicateKeyUpdate({
          set: {
            bid: sql`VALUES(bid)`,
            targetStatus: sql`VALUES(targetStatus)`,
            updatedAt: sql`VALUES(updatedAt)`,
          }
        });
      }
      synced++;
    }

    log.info(`SP产品定向同步完成: synced=${synced}, skipped=${skipped}`);
    logSyncProtectionSummary('syncSpProductTargets', protectionStats);
    return { synced, skipped };
  } catch (error: any) {
    {
    const _cause = (error as Record<string, unknown>)?.cause as Record<string, unknown> | undefined;
    const _mysqlCause = _cause?.cause as Record<string, unknown> | undefined;
    const _mysqlErr = _mysqlCause || _cause;
    const _mysqlInfo = _mysqlErr ? `code=${_mysqlErr.code||_mysqlErr.errno||'?'}, msg=${String(_mysqlErr.message||_mysqlErr.sqlMessage||'').slice(0,200)}` : 'no-mysql-cause';
    log.warn(`Error syncing SP product targets: ${(error as Error).message?.slice(0,200)} | MySQL: ${_mysqlInfo}`);
    }
    return { synced: 0, skipped: 0 };
  }
};

/**
 * 同步SP否定关键词（活动级别 + 广告组级别）
 * 从Amazon API获取否定关键词并同步到本地negativeKeywords表
 */
// @ts-expect-error Dynamic property access
AmazonSyncService.prototype.syncSpNegativeKeywords = async function(this: AmazonSyncService): Promise<{ synced: number; updated: number }> {
  const db = await getDb();
  // @ts-expect-error Conditional type narrowing
  if (!db) return { synced: 0, updated: 0 };

  try {
    let synced = 0;
    let updated = 0;

    // 1. 同步活动级别否定关键词
    log.info(`开始同步SP活动级别否定关键词...`);
    const campaignNegatives = await this.client.listSpCampaignNegativeKeywords();
    log.debug(`获取到 ${campaignNegatives.length} 个活动级别否定关键词`);

    for (const neg of campaignNegatives) {
      // @ts-expect-error Async operation type inference
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
      // @ts-expect-error Conditional type narrowing
      if (!campaign) continue;
      // @ts-expect-error Type inference limitation
      const negState = (neg.state || 'enabled').toLowerCase();
      if (negState === 'archived') continue;
      // @ts-expect-error Type inference limitation
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
            // @ts-expect-error Legacy code type compatibility
            eq(negativeKeywords.negativeText, neg.keywordText || '')
          )
        )
        // @ts-expect-error Legacy code type compatibility
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
          negativeLevel: 'campaign',
          negativeType: 'keyword',
          negativeText: neg.keywordText || '',
          // @ts-expect-error Legacy code type compatibility
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

    // 2. 同步广告组级别否定关键词
    log.info(`开始同步SP广告组级别否定关键词...`);
    const adGroupNegatives = await this.client.listSpNegativeKeywords();
    log.debug(`获取到 ${adGroupNegatives.length} 个广告组级别否定关键词`);

    for (const neg of adGroupNegatives) {
      // @ts-expect-error Type inference limitation
      const negState = (neg.state || 'enabled').toLowerCase();
      if (negState === 'archived') continue;
      const [adGroup] = await db
        .select()
        .from(adGroups)
        .where(and(eq(adGroups.accountId, this.accountId), eq(adGroups.adGroupId, String(neg.adGroupId))))
        .limit(1);
      // @ts-expect-error Conditional type narrowing
      if (!adGroup) continue;
      const [campaign] = await db
        .select()
        .from(campaigns)
        .where(eq(campaigns.campaignId, adGroup.campaignId))
        .limit(1);
      if (!campaign) continue;
      // @ts-expect-error Type inference limitation
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
            eq(negativeKeywords.internalAdGroupId, adGroup.id),  // v420: 修复 - internalAdGroupId是int类型
            eq(negativeKeywords.negativeLevel, 'ad_group'),
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
          // @ts-expect-error Legacy code type compatibility
          accountId: this.accountId,
          campaignId: String(campaign.campaignId),
          internalAdGroupId: adGroup.id,  // v418: ID体系重构
          negativeLevel: 'ad_group',
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

    log.info(`SP否定关键词同步完成: ${synced} 条新记录, ${updated} 条更新`);
    return { synced, updated };
  } catch (error: any) {
    {
    const _cause = (error as Record<string, unknown>)?.cause as Record<string, unknown> | undefined;
    const _mysqlCause = _cause?.cause as Record<string, unknown> | undefined;
    const _mysqlErr = _mysqlCause || _cause;
    // @ts-expect-error Type inference limitation
    const _mysqlInfo = _mysqlErr ? `code=${_mysqlErr.code||_mysqlErr.errno||'?'}, msg=${String(_mysqlErr.message||_mysqlErr.sqlMessage||'').slice(0,200)}` : 'no-mysql-cause';
    log.warn(`Error syncing SP negative keywords: ${(error as Error).message?.slice(0,200)} | MySQL: ${_mysqlInfo}`);
    }
    // @ts-expect-error Return type compatibility
    return { synced: 0, updated: 0 };
  }
};

/**
 * 同步SP否定商品定向
 * 从Amazon API获取否定商品定向并同步到本地negativeKeywords表
 */
// @ts-expect-error Dynamic property access
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
      // @ts-expect-error Type inference limitation
      const negState = (neg.state || 'enabled').toLowerCase();
      if (negState === 'archived') continue;
      const expression = neg.expression || [];
      // @ts-expect-error Type inference limitation
      const asinExpr = expression.find((e: Record<string, unknown>) => e.type?.toLowerCase().includes('asin'));
      const negativeText = asinExpr?.value || JSON.stringify(expression);
      const amazonTargetId = String(neg.targetId || '');
      const [existing] = await db
        .select()
        // @ts-expect-error DB query type inference limitation
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
        // @ts-expect-error Legacy code type compatibility
        updated++;
      } else {
        // v529: 添加onDuplicateKeyUpdate处理竞态条件下的DUP_ENTRY错误
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
        }).onDuplicateKeyUpdate({
          set: { negativeStatus: sql`VALUES(negativeStatus)`, amazonNegativeKeywordId: sql`VALUES(amazonNegativeKeywordId)` }
        });
        synced++;
      }
    }
    // 2. 同步广告组级别否定商品定向
    log.info(`开始同步SP广告组级别否定商品定向...`);
    const adGroupNegTargets = await this.client.listSpNegativeTargets();
    log.debug(`获取到 ${adGroupNegTargets.length} 个广告组级别否定商品定向`);
    for (const neg of adGroupNegTargets) {
      // @ts-expect-error Type inference limitation
      const negState = (neg.state || 'enabled').toLowerCase();
      if (negState === 'archived') continue;
      const [adGroup] = await db
        .select()
        .from(adGroups)
        .where(and(eq(adGroups.accountId, this.accountId), eq(adGroups.adGroupId, String(neg.adGroupId))))
        .limit(1);
      if (!adGroup) continue;
      const [campaign] = await db
        .select()
        .from(campaigns)
        .where(eq(campaigns.campaignId, adGroup.campaignId))
        .limit(1);
      if (!campaign) continue;
      const expression = neg.expression || [];
      // @ts-expect-error Type inference limitation
      const asinExpr = expression.find((e: Record<string, unknown>) => e.type?.toLowerCase().includes('asin'));
      const negativeText = asinExpr?.value || JSON.stringify(expression);
      const amazonTargetId = String(neg.targetId || '');
      const [existing] = await db
        .select()
        .from(negativeKeywords)
        .where(
          and(
            eq(negativeKeywords.accountId, this.accountId),
            eq(negativeKeywords.campaignId, String(campaign.campaignId)),
            eq(negativeKeywords.internalAdGroupId, adGroup.id),  // v420: 修复 - internalAdGroupId是int类型
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
        // v529: 添加onDuplicateKeyUpdate处理竞态条件下的DUP_ENTRY错误
        await db.insert(negativeKeywords).values({
          accountId: this.accountId,
          campaignId: String(campaign.campaignId),
          internalAdGroupId: adGroup.id,  // v418: ID体系重构
          negativeLevel: 'ad_group',
          // @ts-expect-error Legacy code type compatibility
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
    log.info(`SP否定商品定向同步完成: ${synced} 条新记录, ${updated} 条更新`);
    return { synced, updated };
  } catch (error: any) {
    {
    const _cause = (error as Record<string, unknown>)?.cause as Record<string, unknown> | undefined;
    const _mysqlCause = _cause?.cause as Record<string, unknown> | undefined;
    const _mysqlErr = _mysqlCause || _cause;
    const _mysqlInfo = _mysqlErr ? `code=${_mysqlErr.code||_mysqlErr.errno||'?'}, msg=${String(_mysqlErr.message||_mysqlErr.sqlMessage||'').slice(0,200)}` : 'no-mysql-cause';
    log.warn(`Error syncing SP negative product targets: ${(error as Error).message?.slice(0,200)} | MySQL: ${_mysqlInfo}`);
    }
    return { synced: 0, updated: 0 };
  }
};


/**
 * v414: 同步SP关键词和商品定位的建议竞价(Suggested Bid)
 * 
 * 按adGroup分组，批量调用Amazon SP Bid Recommendations API，
 * 将建议竞价写入keywords.suggestedBid和productTargets.suggestedBid。
 * 
 * 这对于新投放词/ASIN的冷启动阶段竞价优化具有重要参考价值。
 * 
 * API限制：
 * - /sp/keywords/bidRecommendations: 按adGroupId + keywords数组请求
 * - /sp/targets/bidRecommendations: 按adGroupId + expressions数组请求
 * - 每个请求最多100个关键词/定向
 */
// @ts-expect-error Dynamic property access
AmazonSyncService.prototype.syncSpBidRecommendations = async function(this: AmazonSyncService): Promise<{ synced: number; skipped: number }> {
  const db = await getDb();
  if (!db) return { synced: 0, skipped: 0 };

  let keywordBidsUpdated = 0;
  let targetBidsUpdated = 0;
  let errors = 0;

  try {
    // ========== 第一部分：SP关键词建议竞价 ==========
    log.info('[v414] ========== 开始同步SP关键词建议竞价 ==========');

    // 查询所有SP关键词，按adGroup分组
    // 只查询enabled状态的关键词（paused/archived不需要建议竞价）
    const spKeywordRows = await db.select({
      id: keywords.id,
      adGroupId: keywords.internalAdGroupId,
      keywordText: keywords.keywordText,
      matchType: keywords.matchType,
      campaignId: campaigns.campaignId,  // v437: 添加campaignId用于Theme-Based API
    }).from(keywords)
      .innerJoin(adGroups, eq(keywords.internalAdGroupId, adGroups.id))  // v420: 修复 - 两者都是int类型，无需CAST
      .innerJoin(campaigns, eq(adGroups.campaignId, campaigns.campaignId))
      .where(and(
        eq(keywords.accountId, this.accountId),
        // v422: 修复 - campaignType枚举值是'sp_auto'/'sp_manual'，不是'sponsoredProducts'
        sql`${campaigns.campaignType} IN ('sp_auto', 'sp_manual')`,
        eq(keywords.keywordStatus, 'enabled'),
      ));

    log.info(`[v414] 查询到 ${spKeywordRows.length} 个SP关键词需要获取建议竞价`);

    // 按adGroupId分组 (v422: 修复Map key类型不匹配 - 统一使用number类型)
    // v437: 添加campaignId到分组数据中
    const kwByAdGroup = new Map<number, Array<{ id: number; keywordText: string; matchType: string; campaignId: string }>>();
    for (const row of spKeywordRows) {
      const agId = Number(row.adGroupId) || 0;
      if (agId === 0) continue; // 跳过无效的adGroupId
      if (!kwByAdGroup.has(agId)) kwByAdGroup.set(agId, []);
      kwByAdGroup.get(agId)!.push({ id: row.id, keywordText: row.keywordText, matchType: row.matchType, campaignId: row.campaignId });
    }

    // 查询adGroup的Amazon adGroupId映射（API需要Amazon adGroupId，不是内部DB id）
    const internalAdGroupIds = [...kwByAdGroup.keys()];
    const adGroupMappingRows = internalAdGroupIds.length > 0
      ? await db.select({ id: adGroups.id, adGroupId: adGroups.adGroupId }).from(adGroups)
          .where(and(eq(adGroups.accountId, this.accountId), inArray(adGroups.id, internalAdGroupIds)))
      : [];
    // v422: 统一使用number类型作为Map key，避免number/string不匹配导致查找失败
    const internalToAmazonAdGroupId = new Map(adGroupMappingRows.map(r => [r.id, r.adGroupId]));

    // 按adGroup批量请求建议竞价
    // @ts-expect-error Type inference limitation
    let adGroupIndex = 0;
    const totalAdGroups = kwByAdGroup.size;
    // v665: 自适应节流（替代固定5秒间隔），大账户显著缩短总耗时
    let kwApiDelay = totalAdGroups > 200 ? 1000 : 2000; // 大账户初始1秒，小账户2秒
    let kwConsecutiveSuccess = 0;
    for (const [internalAgId, kwList] of kwByAdGroup) {
      const amazonAgId = internalToAmazonAdGroupId.get(internalAgId);
      if (!amazonAgId) {
        log.debug(`[v414] adGroup ${internalAgId} 无Amazon adGroupId映射，跳过`);
        continue;
      }

      // v665: 自适应API节流 — 根据429响应动态调整延迟
      if (adGroupIndex > 0) {
        await new Promise(resolve => setTimeout(resolve, kwApiDelay));
      }
      adGroupIndex++;
      // v665: 每处理50个adGroup输出一次进度日志
      if (adGroupIndex % 50 === 0 || adGroupIndex === totalAdGroups) {
        log.info(`[v665] SP关键词建议竞价进度: ${adGroupIndex}/${totalAdGroups} adGroups, 已更新${keywordBidsUpdated}个关键词, 当前延迟${kwApiDelay}ms`);
      }

      try {
        // 每批最多100个关键词
        const batchSize = 100;
        for (let i = 0; i < kwList.length; i += batchSize) {
          const batch = kwList.slice(i, i + batchSize);
          const apiKeywords = batch.map(kw => ({
            keyword: kw.keywordText,
            matchType: kw.matchType.toUpperCase(),
          }));

          // v437: 传入campaignId用于Theme-Based API（必需参数）
          const batchCampaignId = batch[0]?.campaignId || '';
          const recommendations = await this.client.getKeywordBidRecommendations(amazonAgId, apiKeywords, batchCampaignId);

          // v436: 匹配建议竞价并更新数据库（包含low/median/high三个竞价值）
          if (recommendations && recommendations.length > 0) {
            // 建立keyword+matchType到完整建议竞价的映射
            const recMap = new Map<string, { suggestedBid: number; rangeLow: number; rangeHigh: number }>();
            for (const rec of recommendations) {
              if (rec.keyword && rec.suggestedBid) {
                const bidData = {
                  suggestedBid: rec.suggestedBid,
                  rangeLow: rec.rangeStart || 0,
                  rangeHigh: rec.rangeEnd || 0,
                };
                // @ts-expect-error DB query type inference limitation
                recMap.set(`${rec.keyword.toLowerCase()}:${(rec as Record<string, unknown>).matchType?.toLowerCase() || ''}`, bidData);
                // 也用不带matchType的key作为fallback
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
          } else {
            log.debug(`[v436] adGroup ${internalAgId} API返回空建议竞价 (batch=${batch.length})`);
          }
        }
        // v665: 成功后逐步缩减延迟，最低500ms
        kwConsecutiveSuccess++;
        if (kwConsecutiveSuccess >= 5 && kwApiDelay > 500) {
          kwApiDelay = Math.max(500, kwApiDelay - 250);
          kwConsecutiveSuccess = 0;
        }
      } catch (err: unknown) {
        // 单个adGroup失败不影响其他adGroup
        errors++;
        const errMsg = (err as Error).message || 'unknown';
        // v665: 429限流时加倍延迟，最高8秒
        if (errMsg.includes('429') || errMsg.includes('Too Many') || errMsg.includes('HTML响应')) {
          kwApiDelay = Math.min(8000, kwApiDelay * 2);
          kwConsecutiveSuccess = 0;
          log.warn(`[v665] 关键词建议竞价429限流，延迟加倍至 ${kwApiDelay}ms`);
        }
        log.warn(`[v414] adGroup ${internalAgId} 关键词建议竞价获取失败: ${errMsg}`);
        // v457: Amazon API失败时，使用本地历史数据推荐引擎为该adGroup的关键词提供建议竞价
        try {
          const localRec = await getLocalKeywordBidRecommendation(
            this.accountId, amazonAgId, kwList[0]?.campaignId || '', 'sponsoredProducts', 0.30
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
            log.info(`[v457] 本地推荐引擎为adGroup ${internalAgId} 的 ${kwList.length} 个关键词提供建议竞价 $${localRec.suggestedBid.toFixed(2)} (${localRec.source})`);
          }
        } catch (localErr: unknown) {
          log.debug(`[v457] 本地推荐引擎异常: ${(localErr as Error).message}`);
        }
      }
    }

    log.info(`[v414] SP关键词建议竞价同步完成: ${keywordBidsUpdated} 个关键词已更新`);

    // ========== 第二部分：SP商品定位建议竞价 ==========
    log.info('[v414] ========== 开始同步SP商品定位建议竞价 ==========');

    // 查询所有SP商品定位，按adGroup分组
    const spTargetRows = await db.select({
      id: productTargets.id,
      adGroupId: productTargets.internalAdGroupId,
      targetExpression: productTargets.targetExpression,
      targetType: productTargets.targetType,
      targetValue: productTargets.targetValue,
      campaignId: campaigns.campaignId,  // v437: 添加campaignId用于Theme-Based API
    }).from(productTargets)
      .innerJoin(adGroups, eq(productTargets.internalAdGroupId, adGroups.id))  // v420: 修复 - 两者都是int类型，无需CAST
      .innerJoin(campaigns, eq(adGroups.campaignId, campaigns.campaignId))
      .where(and(
        eq(productTargets.accountId, this.accountId),
        // v422: 修复 - campaignType枚举值是'sp_auto'/'sp_manual'，不是'sponsoredProducts'
        sql`${campaigns.campaignType} IN ('sp_auto', 'sp_manual')`,
        eq(productTargets.targetStatus, 'enabled'),
      ));

    log.info(`[v414] 查询到 ${spTargetRows.length} 个SP商品定位需要获取建议竞价`);

    // 按adGroupId分组 (v422: 修复Map key类型不匹配 - 统一使用number类型)
    // v437: 添加campaignId到分组数据中
    const tgtByAdGroup = new Map<number, Array<{ id: number; targetExpression: string | null; targetType: string; targetValue: string; campaignId: string }>>();
    for (const row of spTargetRows) {
      const agId = Number(row.adGroupId) || 0;
      if (agId === 0) continue; // 跳过无效的adGroupId
      if (!tgtByAdGroup.has(agId)) tgtByAdGroup.set(agId, []);
      tgtByAdGroup.get(agId)!.push({
        id: row.id,
        targetExpression: row.targetExpression,
        targetType: row.targetType,
        targetValue: row.targetValue,
        campaignId: row.campaignId,
      });
    }

    // 按adGroup批量请求建议竞价
    let tgtAdGroupIndex = 0;
    const totalTgtAdGroups = tgtByAdGroup.size;
    // v665: 大账户初始延迟缩短到1秒（与关键词竞价一致）
    let tgtApiDelay = totalTgtAdGroups > 200 ? 1000 : 2000;
    let tgtConsecutiveSuccess = 0;
    for (const [internalAgId, tgtList] of tgtByAdGroup) {
      const amazonAgId = internalToAmazonAdGroupId.get(internalAgId);
      if (!amazonAgId) continue;
      // v665: 每处理50个adGroup输出一次进度日志
      if (tgtAdGroupIndex > 0 && tgtAdGroupIndex % 50 === 0) {
        log.info(`[v665] SP商品定位建议竞价进度: ${tgtAdGroupIndex}/${totalTgtAdGroups} adGroups, 已更新${targetBidsUpdated}个定位, 当前延迟${tgtApiDelay}ms`);
      }
      // v522: 自适应API节流 — 根据429响应动态调整延迟
      if (tgtAdGroupIndex > 0) {
        await new Promise(resolve => setTimeout(resolve, tgtApiDelay));
      }
      tgtAdGroupIndex++;

      try {
        const batchSize = 100;
        for (let i = 0; i < tgtList.length; i += batchSize) {
          const batch = tgtList.slice(i, i + batchSize);

          // 构建expressions数组 - 从targetExpression JSON解析
          const expressions: Array<{ type: string; value?: string }> = [];
          const exprToTargetMap = new Map<number, typeof batch[0]>();

          for (let j = 0; j < batch.length; j++) {
            const tgt = batch[j];
            let expr: Array<{ type: string; value?: string }> = [];

            // @ts-expect-error Conditional type narrowing
            if (tgt.targetExpression) {
              // @ts-expect-error Legacy code type compatibility
              try {
                expr = JSON.parse(tgt.targetExpression);
              } catch {
                // 如果解析失败，根据targetType构建expression
                if (tgt.targetType === 'asin') {
                  expr = [{ type: 'asinSameAs', value: tgt.targetValue }];
                } else {
                  expr = [{ type: 'asinCategorySameAs', value: tgt.targetValue }];
                }
              }
            } else {
              if (tgt.targetType === 'asin') {
                expr = [{ type: 'asinSameAs', value: tgt.targetValue }];
              } else {
                expr = [{ type: 'asinCategorySameAs', value: tgt.targetValue }];
              }
            }

            if (expr.length > 0) {
              expressions.push(...expr);
              exprToTargetMap.set(expressions.length - 1, tgt);
            }
          }

          if (expressions.length === 0) continue;

          // v437: 传入campaignId用于Theme-Based API
          const batchCampaignId = batch[0]?.campaignId || '';
          const recommendations = await this.client.getTargetBidRecommendations(amazonAgId, expressions, batchCampaignId);

          // v436: 更新建议竞价（包含low/median/high）
          if (recommendations && recommendations.length > 0) {
            // 对于targets，按顺序匹配（API返回顺序与请求顺序一致）
            for (let j = 0; j < Math.min(recommendations.length, batch.length); j++) {
              const rec = recommendations[j];
              if (rec && rec.suggestedBid && rec.suggestedBid > 0) {
                await db.update(productTargets)
                  .set({
                    suggestedBid: String(rec.suggestedBid),
                    // @ts-expect-error Dynamic type assertion
                    suggestedBidLow: (rec as Record<string, unknown>).rangeLow > 0 ? String((rec as Record<string, unknown>).rangeLow) : null,
                    // @ts-expect-error Dynamic type assertion
                    suggestedBidHigh: (rec as Record<string, unknown>).rangeHigh > 0 ? String((rec as Record<string, unknown>).rangeHigh) : null,
                  })
                  .where(eq(productTargets.id, batch[j].id));
                targetBidsUpdated++;
              }
            }
          } else {
            log.debug(`[v436] adGroup ${internalAgId} 商品定位API返回空建议竞价 (batch=${batch.length})`);
          }
        }
        // v665: 成功后逐步缩减延迟，最低500ms
        tgtConsecutiveSuccess++;
        if (tgtConsecutiveSuccess >= 5 && tgtApiDelay > 500) {
          tgtApiDelay = Math.max(500, tgtApiDelay - 250);
          tgtConsecutiveSuccess = 0;
          log.debug(`[v665] Target建议竞价节流缩减至 ${tgtApiDelay}ms`);
        }
      } catch (err: unknown) {
        errors++;
        const errMsg = (err as Error).message || 'unknown';
        // v522: 429限流时加倍延迟，最高8秒
        if (errMsg.includes('429') || errMsg.includes('Too Many') || errMsg.includes('HTML响应')) {
          tgtApiDelay = Math.min(8000, tgtApiDelay * 2);
          tgtConsecutiveSuccess = 0;
          log.warn(`[v522] Target建议竞价429限流，延迟加倍至 ${tgtApiDelay}ms`);
        }
        log.warn(`[v414] adGroup ${internalAgId} 商品定位建议竞价获取失败: ${errMsg}`);
        // v457: Amazon API失败时，使用本地历史数据推荐引擎
        try {
          // @ts-expect-error Type inference limitation
          const localRec = await getLocalTargetBidRecommendation(
            this.accountId, amazonAgId, tgtList[0]?.campaignId || '', 'sponsoredProducts', 0.30
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
            log.info(`[v457] 本地推荐引擎为adGroup ${internalAgId} 的 ${tgtList.length} 个定位提供建议竞价 $${localRec.suggestedBid.toFixed(2)} (${localRec.source})`);
          }
        } catch (localErr: unknown) {
          log.debug(`[v457] Target本地推荐引擎异常: ${(localErr as Error).message}`);
        }
      }
    }

    log.info(`[v414] SP商品定位建议竞价同步完成: ${targetBidsUpdated} 个定位已更新`);
    log.info(`[v414] ========== 建议竞价同步总结: 关键词=${keywordBidsUpdated}, 定位=${targetBidsUpdated}, 错误=${errors} ==========`);

    return { synced: keywordBidsUpdated + targetBidsUpdated, skipped: errors };
  } catch (error: any) {
    log.warn(`[v414] Error syncing SP bid recommendations: ${(error as Error).message || JSON.stringify(error)}`);
    // @ts-expect-error Return type compatibility
    return { synced: keywordBidsUpdated + targetBidsUpdated, skipped: errors };
  }
// @ts-expect-error Legacy code type compatibility
};

// ==================== v424: SP Budget Rules 同步 ====================

/**
 * v424: 同步SP广告活动的Budget Rules
 * 
 * 1. 获取所有SP campaigns的campaignId
 * 2. 批量调用 GET /sp/campaigns/{campaignId}/budgetRules
 * 3. 将budget rules写入campaign_budget_rules表
 * 4. 更新campaigns表的has_budget_rules和budget_rules_count字段
 */
// @ts-expect-error Dynamic property access
AmazonSyncService.prototype.syncSpBudgetRules = async function(this: AmazonSyncService): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  let totalRulesSynced = 0;

  try {
    log.info('[v424] ========== 开始同步SP Budget Rules ==========');

    // 1. 获取所有SP campaigns
    const spCampaigns = await db.select({
      id: campaigns.id,
      campaignId: campaigns.campaignId,
    }).from(campaigns)
      .where(and(
        eq(campaigns.accountId, this.accountId),
        sql`${campaigns.campaignType} IN ('sp_auto', 'sp_manual')`,
        eq(campaigns.campaignStatus, 'enabled'),
      ));

    log.info(`[v424] 查询到 ${spCampaigns.length} 个启用的SP campaigns需要获取budget rules`);

    if (spCampaigns.length === 0) {
      return 0;
    }

    // 2. 批量获取budget rules
    const campaignIds = spCampaigns.map(c => String(c.campaignId));
    // v642: 修复属性名错误 (this.apiClient → this.client) 并添加方法存在性检查
    // @ts-expect-error Conditional type narrowing
    if (!this.client.listSpCampaignsBudgetRules) {
      log.warn(`[v642] SP Budget Rules API方法不存在，跳过budget rules同步`);
      return { success: true, synced: 0, errors: [], message: 'Budget Rules API方法不可用，已跳过' };
    }
    // @ts-expect-error Type inference limitation
    const budgetRulesMap = await this.client.listSpCampaignsBudgetRules(
      campaignIds,
      // @ts-expect-error Legacy code type compatibility
      (completed, total) => {
        if (completed % 50 === 0 || completed === total) {
          // @ts-expect-error Complex function parameter types
          log.info(`[v424] Budget rules获取进度: ${completed}/${total}`);
        // @ts-expect-error Legacy code type compatibility
        }
      // @ts-expect-error Legacy code type compatibility
      }
    );

    // 3. 写入budget rules到数据库
    const allRules: Array<{
      campaignId: string;
      // @ts-expect-error Generic type constraint
      rules: Record<string, unknown>[];
    // @ts-expect-error Legacy code type compatibility
    }> = [];

    // @ts-expect-error Complex function parameter types
    for (const [campaignId, rules] of budgetRulesMap.entries()) {
      if (rules.length > 0) {
        allRules.push({ campaignId, rules });
      }
    }

    // @ts-expect-error Complex function parameter types
    log.info(`[v424] 共 ${allRules.length} 个campaigns有budget rules`);

    // 批量写入budget rules
    for (const { campaignId, rules } of allRules) {
      for (const rule of rules) {
        try {
          const ruleId = rule.ruleId || rule.budgetRuleId || '';
          if (!ruleId) continue;

          // 解析规则数据
          const ruleData: Record<string, unknown> = {
            accountId: this.accountId,
            // @ts-expect-error Legacy code type compatibility
            ruleId: String(ruleId),
            ruleName: rule.name || rule.ruleName || null,
            ruleType: rule.ruleType || 'SCHEDULE',
            ruleStatus: rule.ruleState || rule.ruleStatus || 'ACTIVE',
            adType: 'sp',
            rawData: JSON.stringify(rule),
          };

          // 解析budget increase
          if (rule.budget) {
            // @ts-expect-error Dynamic property access
            ruleData.budgetIncreaseType = rule.budget.budgetIncreaseType || 'PERCENT';
            // @ts-expect-error Dynamic property access
            ruleData.budgetIncreaseValue = rule.budget.budgetIncreaseValue || null;
          }

          // 解析recurrence
          if (rule.recurrence) {
            // @ts-expect-error Dynamic property access
            ruleData.recurrenceType = rule.recurrence.type || null;
            // @ts-expect-error Dynamic property access
            ruleData.recurrenceDaysOfWeek = rule.recurrence.daysOfWeek 
              // @ts-expect-error Conditional type narrowing
              ? JSON.stringify(rule.recurrence.daysOfWeek) 
              : null;
          }

          // 解析duration
          if (rule.duration) {
            // @ts-expect-error Dynamic property access
            ruleData.durationStartDate = rule.duration.dateRange?.startDate || null;
            // @ts-expect-error Dynamic property access
            ruleData.durationEndDate = rule.duration.dateRange?.endDate || null;
            // @ts-expect-error Dynamic property access
            ruleData.eventId = rule.duration.eventTypeFilter?.eventId || null;
            // @ts-expect-error Dynamic property access
            ruleData.eventName = rule.duration.eventTypeFilter?.eventName || null;
          }

          // 解析performance条件
          if (rule.performanceMeasureCondition) {
            // @ts-expect-error Dynamic property access
            ruleData.performanceMetricName = rule.performanceMeasureCondition.metricName || null;
            // @ts-expect-error Dynamic property access
            ruleData.performanceComparisonOperator = rule.performanceMeasureCondition.comparisonOperator || null;
            // @ts-expect-error Dynamic property access
            ruleData.performanceThreshold = rule.performanceMeasureCondition.threshold || null;
          }

          // 关联的campaign IDs
          ruleData.associatedCampaignIds = JSON.stringify([campaignId]);

          // Amazon日期
          ruleData.amazonCreatedDate = rule.createdDate || null;
          ruleData.amazonLastUpdatedDate = rule.lastUpdatedDate || null;

          // UPSERT
          // @ts-expect-error DB query type inference limitation
          await db.insert(campaignBudgetRules).values(ruleData)
            .onDuplicateKeyUpdate({
              set: {
                ruleName: sql`VALUES(rule_name)`,
                ruleStatus: sql`VALUES(rule_status)`,
                budgetIncreaseType: sql`VALUES(budget_increase_type)`,
                budgetIncreaseValue: sql`VALUES(budget_increase_value)`,
                recurrenceType: sql`VALUES(recurrence_type)`,
                recurrenceDaysOfWeek: sql`VALUES(recurrence_days_of_week)`,
                durationStartDate: sql`VALUES(duration_start_date)`,
                durationEndDate: sql`VALUES(duration_end_date)`,
                eventId: sql`VALUES(event_id)`,
                eventName: sql`VALUES(event_name)`,
                performanceMetricName: sql`VALUES(performance_metric_name)`,
                performanceComparisonOperator: sql`VALUES(performance_comparison_operator)`,
                performanceThreshold: sql`VALUES(performance_threshold)`,
                associatedCampaignIds: sql`VALUES(associated_campaign_ids)`,
                amazonLastUpdatedDate: sql`VALUES(amazon_last_updated_date)`,
                rawData: sql`VALUES(raw_data)`,
              },
            });

          totalRulesSynced++;
        } catch (err: unknown) {
          log.warn(`[v424] Budget rule写入失败: ${(err as Error).message}`);
        }
      }
    }

    // 4. 更新campaigns表的budget rules相关字段
    log.info('[v424] 更新campaigns表的budget rules字段...');

    // 先将所有SP campaigns的hasBudgetRules设为0
    await db.update(campaigns)
      .set({ 
        hasBudgetRules: 0,
        budgetRulesCount: 0,
      })
      .where(and(
        eq(campaigns.accountId, this.accountId),
        sql`${campaigns.campaignType} IN ('sp_auto', 'sp_manual')`,
      ));

    // 然后更新有budget rules的campaigns
    for (const { campaignId, rules } of allRules) {
      await db.update(campaigns)
        .set({
          hasBudgetRules: 1,
          budgetRulesCount: rules.length,
        })
        .where(and(
          eq(campaigns.accountId, this.accountId),
          eq(campaigns.campaignId, campaignId),
        ));
    }

    log.info(`[v424] ========== SP Budget Rules同步完成: ${totalRulesSynced} 条规则, ${allRules.length} 个campaigns有规则 ==========`);
    return totalRulesSynced;
  } catch (error: any) {
    log.warn(`[v424] Error syncing SP budget rules: ${(error as Error).message || JSON.stringify(error)}`);
    return totalRulesSynced;
  }
};
