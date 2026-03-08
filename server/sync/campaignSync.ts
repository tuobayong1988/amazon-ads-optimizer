/**
 * 广告活动同步模块
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

const log = createModuleLogger('campaignSync');

/**
 * 同步SB品牌广告活动
 * @param lastSyncTime 上次同步时间，用于增量同步
 */
export async function syncSbCampaigns(service: SyncContext,lastSyncTime?: string | null): Promise<number | { synced: number; skipped: number }> {
  const db = await getDb();
  if (!db) return { synced: 0, skipped: 0 };

  try {
    const apiCampaigns = await service.client.listSbCampaigns();
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
            eq(campaigns.accountId, service.accountId),
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
      const sbPortfolioId = (apiCampaign as any).portfolioId ? String((apiCampaign as any).portfolioId) : null;

      // 获取SB广告的竞价策略
      const sbBiddingStrategy = (apiCampaign as any).bidding?.strategy || 
                                (apiCampaign as any).biddingStrategy || 
                                'legacyForSales';

      // ✅ 根据SB广告的Campaign Goal确定计费方式
      // SB v4 API返回的goal字段决定计费模式:
      //   - DRIVE_PAGE_VISITS → CPC计费（按点击付费）
      //   - GROW_BRAND_IMPRESSION_SHARE → vCPM计费（按千次可见展示付费）
      //   - PROMOTE_PRODUCTS → CPC计费（推广产品）
      // 注意：同一种SB广告格式（Video/Product Collection/Store Spotlight）
      //       既可以是CPC也可以是vCPM，完全取决于创建时选择的Goal
      const sbGoal = (apiCampaign as any).goal || (apiCampaign as any).campaignGoal || '';
      let sbCostType: 'cpc' | 'vcpm' | 'cpm' = 'cpc'; // 默认CPC
      if (sbGoal === 'GROW_BRAND_IMPRESSION_SHARE' || sbGoal === 'growBrandImpressionShare') {
        sbCostType = 'vcpm';
      }
      // 也检查API是否直接返回了costType字段（某些API版本可能直接返回）
      if ((apiCampaign as any).costType) {
        const apiCostType = String((apiCampaign as any).costType).toLowerCase();
        if (apiCostType === 'vcpm' || apiCostType === 'cpm') {
          sbCostType = apiCostType as 'vcpm' | 'cpm';
        }
      }

      // 获取SB广告格式
      const sbAdFormat = (apiCampaign as any).adFormat || (apiCampaign as any).creative?.adFormat || null;
      const validAdFormats = ['productCollection', 'video', 'storeSpotlight', 'brandVideo'];
      const normalizedAdFormat = validAdFormats.includes(sbAdFormat) ? sbAdFormat : null;

      // 获取SB广告的竞价优化目标
      const sbBidOptimization = (apiCampaign as any).bidOptimization || null;
      const validBidOpts = ['reach', 'pageVisits', 'conversions'];
      const normalizedBidOpt = validBidOpts.includes(sbBidOptimization) ? sbBidOptimization : null;

      // 获取SB广告的landing page信息
      const sbLandingPageType = (apiCampaign as any).landingPage?.pageType || (apiCampaign as any).landingPageType || null;
      const sbLandingPageUrl = (apiCampaign as any).landingPage?.url || (apiCampaign as any).landingPageUrl || null;
      const sbBrandEntityId = (apiCampaign as any).brandEntityId || null;

      log.debug(`SB广告 ${apiCampaign.name}: goal=${sbGoal}, costType=${sbCostType}, adFormat=${normalizedAdFormat}`);

      const campaignData = {
        accountId: service.accountId,
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
          delete (campaignData as Record<string, unknown>[]).dailyBudget;
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
}


/**
 * 同步SD展示广告活动
 * @param lastSyncTime 上次同步时间，用于增量同步
 */
export async function syncSdCampaigns(service: SyncContext,lastSyncTime?: string | null): Promise<number | { synced: number; skipped: number }> {
  const db = await getDb();
  if (!db) return { synced: 0, skipped: 0 };

  try {
    const apiCampaigns = await service.client.listSdCampaigns();
    let synced = 0;
    let skipped = 0;
    
    // 输出第一个广告活动的结构用于调试
    if (apiCampaigns.length > 0) {
      log.debug('SD广告活动API返回结构示例:', JSON.stringify(apiCampaigns[0], null, 2));
    }
    log.debug(`获取到 ${apiCampaigns.length} 个SD广告活动`);

    for (const apiCampaign of apiCampaigns) {
      // 检查是否已存在
      const [existing] = await db
        .select()
        .from(campaigns)
        .where(
          and(
            eq(campaigns.accountId, service.accountId),
            eq(campaigns.campaignId, String(apiCampaign.campaignId))
          )
        )
        .limit(1);

      // 增量同步：如果有上次同步时间且记录已存在，检查是否需要更新
      // v215修复: 移除错误的updatedAt跳过逻辑
      // 始终使用Amazon API返回的最新数据更新本地记录

      // SD API 返回的预算结构可能是:
      // 1. budget (直接数字，可能是daily或lifetime)
      // 2. budget.budget
      // 3. dailyBudget
      let dailyBudget = 0;
      let budgetType: 'daily' | 'lifetime' = 'daily';
      
      if (apiCampaign.budget) {
        if (typeof apiCampaign.budget === 'number') {
          dailyBudget = apiCampaign.budget;
        } else if (typeof apiCampaign.budget === 'object') {
          dailyBudget = apiCampaign.budget.budget || apiCampaign.budget.dailyBudget || 0;
          budgetType = apiCampaign.budget.budgetType || 'daily';
        }
      } else if (apiCampaign.dailyBudget) {
        dailyBudget = apiCampaign.dailyBudget;
      }
      
      // SD API 的状态字段可能是 state 或 status
      const campaignState = apiCampaign.state || apiCampaign.status || 'enabled';
      const validStates = ['enabled', 'paused', 'archived'];
      const normalizedState = validStates.includes(campaignState.toLowerCase()) 
        ? campaignState.toLowerCase() as 'enabled' | 'paused' | 'archived'
        : 'enabled';

      // 解析SD广告活动的startDate和endDate
      let sdStartDate: string | null = null;
      if (apiCampaign.startDate) {
        const dateStr = String(apiCampaign.startDate);
        if (dateStr.includes('-')) {
          sdStartDate = dateStr;
        } else if (dateStr.length === 8) {
          sdStartDate = `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
        }
      }

      let sdEndDate: string | null = null;
      if (apiCampaign.endDate) {
        const dateStr = String(apiCampaign.endDate);
        if (dateStr.includes('-')) {
          sdEndDate = dateStr;
        } else if (dateStr.length === 8) {
          sdEndDate = `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
        }
      }

      // 获取SD广告的计费类型
      const sdCostType = (apiCampaign as any).costType?.toLowerCase() || 'cpc';
      const validCostTypes = ['cpc', 'vcpm', 'cpm'];
      const normalizedCostType = validCostTypes.includes(sdCostType) ? sdCostType : 'cpc';

      // 获取组合ID
      const sdPortfolioId = (apiCampaign as any).portfolioId ? String((apiCampaign as any).portfolioId) : null;

      // ✅ 获取SD广告的Campaign Goal（广告目标）
      // SD API返回的goal/optimizationGoal字段决定广告目标:
      //   - reach → 触达用户（通常配合vCPM计费）
      //   - page_visits / pageVisits → 驱动页面访问（通常配合CPC计费）
      //   - conversions → 促进转化（通常配合CPC计费）
      // 注意：SD的costType由API直接返回，不goal共同决定广告的计费和优化方式
      const sdGoal = (apiCampaign as any).goal || 
                     (apiCampaign as any).optimizationGoal || 
                     (apiCampaign as any).bidOptimization || '';
      
      // 获取SD广告的tactic（定向策略）
      // T00020 = 受众定向(Audiences), T00030 = 商品定向(Contextual)
      // remarketing = 再营销, contextual = 上下文定向
      const sdTactic = (apiCampaign as any).tactic || null;
      
      // 根据goal和costType的组合确定实际计费方式
      // SD的costType由API直接返回，但也可以通过goal推断
      let finalCostType = normalizedCostType;
      if (sdGoal === 'reach' && normalizedCostType === 'cpc') {
        // reach目标通常使用vCPM，但以API返回的costType为准
        log.debug(`SD广告 ${apiCampaign.name}: goal=reach 但 costType=cpc，以API返回为准`);
      }

      // 获取SD广告的竞价优化目标
      const sdBidOptimization = (apiCampaign as any).bidOptimization || null;
      const validBidOpts = ['reach', 'pageVisits', 'conversions'];
      const normalizedBidOpt = validBidOpts.includes(sdBidOptimization) ? sdBidOptimization : null;

      log.debug(`SD广告 ${apiCampaign.name}: goal=${sdGoal}, costType=${finalCostType}, tactic=${sdTactic}`);

      const campaignData = {
        accountId: service.accountId,
        campaignId: String(apiCampaign.campaignId),
        campaignName: apiCampaign.name,
        campaignType: 'sd' as const,
        targetingType: 'manual' as const,
        dailyBudget: String(dailyBudget),
        campaignStatus: normalizedState,
        state: normalizedState as 'enabled' | 'paused' | 'archived' | 'pending' | 'other',
        startDate: sdStartDate,
        endDate: sdEndDate,
        costType: finalCostType as 'cpc' | 'vcpm' | 'cpm',
        campaignGoal: sdGoal || null, // ✅ 存储SD广告目标
        bidOptimization: normalizedBidOpt, // ✅ 存储竞价优化目标
        tactic: sdTactic, // ✅ 存储定向策略
        portfolioId: sdPortfolioId,
        amazonCreatedDate: sdStartDate, // Amazon侧创建日期
        updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      };

      if (existing) {
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
    log.error('Error syncing SD campaigns:', error);
    return { synced: 0, skipped: 0 };
  }
}


/**
 * 同步SP广告活动
 * @param lastSyncTime 上次同步时间，用于增量同步
 */
export async function syncSpCampaigns(service: SyncContext,lastSyncTime?: string | null): Promise<number | { synced: number; skipped: number }> {
  log.info('[同步] ========== 开始同步SP广告活动 ==========');
  log.info('[同步] 参数:', { accountId: service.accountId, lastSyncTime, marketplace: service.marketplace });
  
  const db = await getDb();
  if (!db) {
    log.error('[同步] ❌ 数据库连接失败 - getDb()返回null');
    return { synced: 0, skipped: 0 };
  }
  log.info('[同步] ✅ 数据库连接成功');

  try {
    log.info('[同步] 正在调用Amazon API: listSpCampaigns()...');
    const apiCampaigns = await service.client.listSpCampaigns();
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
        .where(and(eq(campaigns.accountId, service.accountId), eq(campaigns.campaignId, String(ac.campaignId))))
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
            eq(campaigns.accountId, service.accountId),
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
      const budgetField = (apiCampaign as any).budget;
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
        // @ts-expect-error - extra arguments handled by implementation
        log.warn(`v168: SP广告 ${apiCampaign.name} budget解析为0, 原始budget字段:`, JSON.stringify(budgetField), 'dailyBudget:', apiCampaign.dailyBudget);
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
      const biddingStrategy = (apiCampaign as any).dynamicBidding?.strategy || 
                             (apiCampaign as any).bidding?.strategy || 
                             'legacyForSales';

      // 获取组合信息
      const portfolioId = (apiCampaign as any).portfolioId ? String((apiCampaign as any).portfolioId) : null;

      const campaignData = {
        accountId: service.accountId,
        campaignId: String(apiCampaign.campaignId),
        campaignName: apiCampaign.name,
        campaignType: campaignType as 'sp_auto' | 'sp_manual' | 'sb' | 'sd',
        targetingType: normalizedTargetingType,
        dailyBudget: String(dailyBudgetValue),
        campaignStatus: (apiCampaign.state?.toLowerCase() || 'enabled') as 'enabled' | 'paused' | 'archived',
        state: (apiCampaign.state?.toLowerCase() || 'enabled') as 'enabled' | 'paused' | 'archived' | 'pending' | 'other',
        startDate: startDateValue,
        endDate: endDateValue,
        placementTopSearchBidAdjustment: service.getPlacementMultiplier(apiCampaign, 'placementTop'),
        placementProductPageBidAdjustment: service.getPlacementMultiplier(apiCampaign, 'placementProductPage'),
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
            delete (campaignData as Record<string, unknown>[]).dailyBudget;
            protectionStats.budgetProtected++;
            protectionStats.protectedEntities.push(`camp:${existing.campaignName}`);
          } else {
            log.debug(`v150: 预算差异 - campaign=${existing.campaignName}, local=$${localBudget}, api=$${apiBudget}, 以API为准`);
            protectionStats.budgetOverwritten++;
          }
        }
        
        // v245: 预算同步状态自动确认
        // 当campaign处于pending_confirmation状态时，检查Amazon API返回的budget是否与pendingBudget一致
        // 如果一致，说明Amazon已采纳我们的预算调整，自动将状态更新为synced
        if (existing.budgetSyncStatus === 'pending_confirmation' && existing.pendingBudget) {
          const pendingBudgetVal = parseFloat(String(existing.pendingBudget));
          if (apiBudget > 0 && Math.abs(apiBudget - pendingBudgetVal) < 0.01) {
            // Amazon已确认预算调整
            (campaignData as Record<string, unknown>[]).budgetSyncStatus = 'synced';
            (campaignData as Record<string, unknown>[]).pendingBudget = null;
            log.info(`v245: 预算同步确认 - campaign=${existing.campaignName}, pending=$${pendingBudgetVal}, api=$${apiBudget}, 状态→synced`);
          } else if (apiBudget > 0 && Math.abs(apiBudget - pendingBudgetVal) >= 0.01) {
            // Amazon返回的budget与pendingBudget不一致，标记为conflict
            (campaignData as Record<string, unknown>[]).budgetSyncStatus = 'conflict';
            log.warn(`v245: 预算同步冲突 - campaign=${existing.campaignName}, pending=$${pendingBudgetVal}, api=$${apiBudget}, 状态→conflict`);
          }
        }
        
        // 同样处理位置倾斜同步状态
        if (existing.placementSyncStatus === 'pending_confirmation') {
          const apiTop = (campaignData as Record<string, unknown>[]).placementTopSearchBidAdjustment || 0;
          const apiProduct = (campaignData as Record<string, unknown>[]).placementProductPageBidAdjustment || 0;
          // 如果API返回了有效的位置倾斜数据，确认同步成功
          if (apiTop > 0 || apiProduct > 0) {
            (campaignData as Record<string, unknown>[]).placementSyncStatus = 'synced';
            log.info(`v245: 位置倾斜同步确认 - campaign=${existing.campaignName}, top=${apiTop}%, product=${apiProduct}%, 状态→synced`);
          }
        }

        // v165: 位置倾斜比例保护逻辑
        const localTopPlacement1 = existing.placementTopSearchBidAdjustment || 0;
        const apiTopPlacement1 = (campaignData as Record<string, unknown>[]).placementTopSearchBidAdjustment || 0;
        const localProductPlacement1 = existing.placementProductPageBidAdjustment || 0;
        const apiProductPlacement1 = (campaignData as Record<string, unknown>[]).placementProductPageBidAdjustment || 0;
        const hasPlacementDiff1 = localTopPlacement1 !== apiTopPlacement1 || localProductPlacement1 !== apiProductPlacement1;
        if (hasPlacementDiff1 && protectedCampaignIds.has(existing.id)) {
          log.debug(`v165: 位置倾斜保护生效 - campaign=${existing.campaignName}, localTop=${localTopPlacement1}%, apiTop=${apiTopPlacement1}%, localProduct=${localProductPlacement1}%, apiProduct=${apiProductPlacement1}%`);
          delete (campaignData as Record<string, unknown>[]).placementTopSearchBidAdjustment;
          delete (campaignData as Record<string, unknown>[]).placementProductPageBidAdjustment;
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
    log.error('[同步] ❌ SP广告活动同步失败');
    log.error('[同步] 错误类型:', error.constructor.name);
    log.error('[同步] 错误消息:', (error as Error).message);
    log.error('[同步] 错误堆栈:', (error as Error).stack);
    if ((error as Error & { response?: unknown }).response) {
      log.error('[同步] API响应状态:', (error as Error & { response?: unknown }).response.status);
      log.error('[同步] API响应数据:', JSON.stringify((error as Error & { response?: unknown }).response.data, null, 2));
    }
    return { synced: 0, skipped: 0 };
  }
}


/**
 * 仅同步广告活动（高频同步）
 * 用于快速获取广告活动状态和预算变化
 */
export async function syncCampaignsOnly(service: SyncContext,): Promise<{
  campaigns: number;
  spCampaigns: number;
  sbCampaigns: number;
  sdCampaigns: number;
}> {
  const results = {
    campaigns: 0,
    spCampaigns: 0,
    sbCampaigns: 0,
    sdCampaigns: 0,
  };

  // v190: 每种广告类型独立try-catch，一个失败不影响其他
  try {
    const spResult = await service.syncSpCampaigns();
    results.spCampaigns = typeof spResult === 'number' ? spResult : spResult.synced;
    results.campaigns += results.spCampaigns;
  } catch (error: unknown) {
    log.error('SP广告活动同步失败:', (error as Error).message);
  }
  
  try {
    const sbResult = await service.syncSbCampaigns();
    results.sbCampaigns = typeof sbResult === 'number' ? sbResult : sbResult.synced;
    results.campaigns += results.sbCampaigns;
  } catch (error: unknown) {
    log.error('SB广告活动同步失败:', (error as Error).message);
  }
  
  try {
    const sdResult = await service.syncSdCampaigns();
    results.sdCampaigns = typeof sdResult === 'number' ? sdResult : sdResult.synced;
    results.campaigns += results.sdCampaigns;
  } catch (error: unknown) {
    log.error('SD广告活动同步失败:', (error as Error).message);
  }
  
  log.info(`广告活动同步完成: SP=${results.spCampaigns}, SB=${results.sbCampaigns}, SD=${results.sdCampaigns}`);

  return results;
}


