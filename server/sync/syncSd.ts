/**
 * SD (Sponsored Display) 广告数据同步方法
 * 
 * 从 amazonSyncService.ts 中提取的 syncSd 子模块。
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
  sdAudiences,
} from '../../drizzle/schema';
import { createModuleLogger } from '../utils/logger';
import type { AmazonAdsApiClient, SpCampaign } from './amazonAdsApi';
import { getMarketplaceDateRange, getMarketplaceCurrentDate, getMarketplaceYesterday, getMarketplaceHistoricalDateRange } from '../utils/timezone';
import { getExchangeRateByMarketplace } from '../services/exchangeRateService';
import { AmazonSyncService } from './amazonSyncService';
import {
  SYNC_PROTECTION_CONFIG,
  createSyncProtectionStats,
  logSyncProtectionSummary,
  hasRecentSyncedOptimization,
  getRecentlyOptimizedKeywordIds,
  getRecentlyOptimizedCampaignIds,
} from './syncHelpers';
import { getLocalKeywordBidRecommendation, getLocalTargetBidRecommendation } from '../optimization/localBidRecommendationEngine';

const log = createModuleLogger('syncSd');

// ==================== 类型声明（模块扩展） ====================

// @ts-ignore
declare module '../../amazonSyncService' {
  interface AmazonSyncService {
    syncSdCampaigns(...args: unknown[]): unknown;
    syncSdAdGroups(...args: unknown[]): unknown;
    syncSdProductTargets(...args: unknown[]): unknown;
    syncSdAudiences(...args: unknown[]): unknown;
    syncSdTargeting(...args: unknown[]): unknown;
    syncSdNegativeTargets(...args: unknown[]): unknown;
    syncSdBidRecommendations(...args: unknown[]): unknown;
  }
}

// ==================== 方法实现 ====================

/**
 * 同步SD展示广告活动
 * @param lastSyncTime 上次同步时间，用于增量同步
 */
// @ts-ignore
AmazonSyncService.prototype.syncSdCampaigns = async function(this: AmazonSyncService, lastSyncTime?: string | null): Promise<number | { synced: number; skipped: number }> {
  const db = await getDb();
  if (!db) return { synced: 0, skipped: 0 };

  try {
    const apiCampaigns = await this.client.listSdCampaigns();
    let synced = 0;
    let skipped = 0;
    
    // 输出第一个广告活动的结构用于调试
    if (apiCampaigns.length > 0) {
      log.debug('SD广告活动API返回结构示例:', JSON.stringify(apiCampaigns[0], null, 2));
    }
    log.debug(`获取到 ${apiCampaigns.length} 个SD广告活动`);

    // v363: 批量预查询所有已存在的SD campaign（消除N+1查询）
    const sdCampaignIds = apiCampaigns.map(c => String(c.campaignId));
    const existingSdCampaignRows = sdCampaignIds.length > 0
      ? await db.select().from(campaigns)
          .where(and(eq(campaigns.accountId, this.accountId), inArray(campaigns.campaignId, sdCampaignIds)))
      : [];
    const existingSdCampaignMap = new Map(existingSdCampaignRows.map(r => [r.campaignId, r]));

    for (const apiCampaign of apiCampaigns) {
      // v363: 使用批量预查询结果
      const existing = existingSdCampaignMap.get(String(apiCampaign.campaignId)) || null;

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
          // @ts-ignore
          dailyBudget = apiCampaign.budget;
        // @ts-ignore
        } else if (typeof apiCampaign.budget === 'object') {
          // @ts-ignore
          dailyBudget = apiCampaign.budget.budget || apiCampaign.budget.dailyBudget || 0;
          // @ts-ignore
          budgetType = apiCampaign.budget.budgetType || 'daily';
        }
      } else if (apiCampaign.dailyBudget) {
        // @ts-ignore
        dailyBudget = apiCampaign.dailyBudget;
      // @ts-ignore
      }
      
      // SD API 的状态字段可能是 state 或 status
      const campaignState = apiCampaign.state || apiCampaign.status || 'enabled';
      const validStates = ['enabled', 'paused', 'archived'];
      // @ts-ignore
      const normalizedState = validStates.includes(campaignState.toLowerCase()) 
        // @ts-ignore
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
          // @ts-ignore
          sdEndDate = dateStr;
        } else if (dateStr.length === 8) {
          sdEndDate = `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
        }
      }

      // 获取SD广告的计费类型
      // @ts-ignore
      const sdCostType = (apiCampaign as Record<string, unknown>).costType?.toLowerCase() || 'cpc';
      const validCostTypes = ['cpc', 'vcpm', 'cpm'];
      const normalizedCostType = validCostTypes.includes(sdCostType) ? sdCostType : 'cpc';

      // 获取组合ID
      const sdPortfolioId = (apiCampaign as Record<string, unknown>).portfolioId ? String((apiCampaign as Record<string, unknown>).portfolioId) : null;

      // ✅ 获取SD广告的Campaign Goal（广告目标）
      // SD API返回的goal/optimizationGoal字段决定广告目标:
      //   - reach → 触达用户（通常配合vCPM计费）
      //   - page_visits / pageVisits → 驱动页面访问（通常配合CPC计费）
      //   - conversions → 促进转化（通常配合CPC计费）
      // 注意：SD的costType由API直接返回，不goal共同决定广告的计费和优化方式
      const sdGoal = (apiCampaign as Record<string, unknown>).goal || 
                     (apiCampaign as Record<string, unknown>).optimizationGoal || 
                     (apiCampaign as Record<string, unknown>).bidOptimization || '';
      
      // 获取SD广告的tactic（定向策略）
      // T00020 = 受众定向(Audiences), T00030 = 商品定向(Contextual)
      // remarketing = 再营销, contextual = 上下文定向
      const sdTactic = (apiCampaign as Record<string, unknown>).tactic || null;
      
      // 根据goal和costType的组合确定实际计费方式
      // SD的costType由API直接返回，但也可以通过goal推断
      let finalCostType = normalizedCostType;
      // @ts-ignore
      if (sdGoal === 'reach' && normalizedCostType === 'cpc') {
        // reach目标通常使用vCPM，但以API返回的costType为准
        log.debug(`SD广告 ${apiCampaign.name}: goal=reach 但 costType=cpc，以API返回为准`);
      }

      // 获取SD广告的竞价优化目标
      const sdBidOptimization = (apiCampaign as Record<string, unknown>).bidOptimization || null;
      const validBidOpts = ['reach', 'pageVisits', 'conversions', 'leads'];
      // @ts-ignore
      const normalizedBidOpt = validBidOpts.includes(sdBidOptimization) ? sdBidOptimization : null;

      // v500: 提取SD广告的优化策略（Optimization Strategy）
      // SD广告的4种优化策略决定了计费和竞价模式:
      //   - reach → vCPM计费，优化触达
      //   - page_visits / drive_page_visits → CPC计费，优化页面访问
      //   - conversions → CPC计费，优化转化
      //   - leads → CPC计费，优化线索收集
      const sdOptimizationStrategy = String(sdGoal || sdBidOptimization || 'conversions').toLowerCase();

      log.debug(`SD广告 ${apiCampaign.name}: goal=${sdGoal}, costType=${finalCostType}, tactic=${sdTactic}, strategy=${sdOptimizationStrategy}`);

      const campaignData = {
        accountId: this.accountId,
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
        // @ts-ignore
        amazonCreatedDate: sdStartDate, // Amazon侧创建日期
        // v500: SD优化策略
        sdOptimizationStrategy: sdOptimizationStrategy,
        // @ts-ignore
        updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      };

      if (existing) {
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
    }

    // @ts-ignore
    return { synced, skipped };
  } catch (error: any) {
    log.warn(`Error syncing SD campaigns: ${(error as Error).message || JSON.stringify(error)}`);
    return { synced: 0, skipped: 0 };
  }
};

/**
 * 同步SD展示广告组
 * 从Amazon SD API获取广告组列表并同步到本地数据库
 */
// @ts-ignore
AmazonSyncService.prototype.syncSdAdGroups = async function(this: AmazonSyncService): Promise<{ synced: number; skipped: number }> {
  const db = await getDb();
  if (!db) return { synced: 0, skipped: 0 };

  try {
    const apiAdGroups = await this.client.listSdAdGroups();
    let synced = 0;
    let skipped = 0;

      log.debug(`获取到 ${apiAdGroups.length} 个SD广告组`);

    // v363: 批量预查询所有相关campaign和adGroup（消除N+1查询）
    const sdAdGroupCampaignIds = [...new Set(apiAdGroups.map(ag => String(ag.campaignId)))];
    const sdCampaignRows = sdAdGroupCampaignIds.length > 0
      ? await db.select().from(campaigns)
          .where(and(eq(campaigns.accountId, this.accountId), inArray(campaigns.campaignId, sdAdGroupCampaignIds)))
      : [];
    const sdCampaignMap = new Map(sdCampaignRows.map(r => [r.campaignId, r]));
    // @ts-ignore
    const sdAdGroupIds = apiAdGroups.map(ag => String(ag.adGroupId));
    const existingSdAdGroupRows = sdAdGroupIds.length > 0
      ? await db.select().from(adGroups).where(and(eq(adGroups.accountId, this.accountId), inArray(adGroups.adGroupId, sdAdGroupIds)))
      : [];
    const existingSdAdGroupMap = new Map(existingSdAdGroupRows.map(r => [`${r.campaignId}:${r.adGroupId}`, r]));

    for (const apiAdGroup of apiAdGroups) {
      // v363: 使用批量预查询结果
      const campaign = sdCampaignMap.get(String(apiAdGroup.campaignId));
      if (!campaign) continue;
      const existing = existingSdAdGroupMap.get(`${campaign.campaignId}:${String(apiAdGroup.adGroupId)}`) || null;

      // @ts-ignore
      const normalizedState = (apiAdGroup.state || 'enabled').toLowerCase() as 'enabled' | 'paused' | 'archived';

      // SD广告组可能有tactic字段（如T00020 = 受众定向, T00030 = 商品定向）
      const tactic = apiAdGroup.tactic || null;

      const adGroupData = {
        // @ts-ignore
        campaignId: campaign.campaignId,
        accountId: this.accountId,
        adGroupId: String(apiAdGroup.adGroupId),
        // @ts-ignore
        adGroupName: apiAdGroup.name || apiAdGroup.adGroupName || 'SD Ad Group',
        adGroupStatus: normalizedState,
        defaultBid: String(apiAdGroup.defaultBid || apiAdGroup.bid || 0),
        tactic: tactic,
        updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      };

      if (existing) {
        await db
          .update(adGroups)
          // @ts-ignore
          .set(adGroupData)
          .where(eq(adGroups.id, existing.id));
      } else {
        // @ts-ignore
        await db.insert(adGroups).values({
          ...adGroupData,
          createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
        });
      }
      // @ts-ignore
      synced++;
    }

    log.info(`SD广告组同步完成: synced=${synced}, skipped=${skipped}`);
    return { synced, skipped };
  } catch (error: any) {
    log.warn(`Error syncing SD ad groups: ${(error as Error).message || JSON.stringify(error)}`);
    return { synced: 0, skipped: 0 };
  }
};

/**
 * 同步SD商品定位（从List API）
 * 从Amazon SD API获取商品定位列表并同步到本地数据库
 */
// @ts-ignore
AmazonSyncService.prototype.syncSdProductTargets = async function(this: AmazonSyncService): Promise<{ synced: number; skipped: number }> {
  const db = await getDb();
  if (!db) return { synced: 0, skipped: 0 };

  try {
    const apiTargets = await this.client.listSdTargets();
    let synced = 0;
    let skipped = 0;

    log.debug(`获取到 ${apiTargets.length} 个SD商品定位`);

    // v363: 批量预查询所有相关adGroup（消除N+1查询）
    const sdTgtAdGroupIds = [...new Set(apiTargets.map(t => String(t.adGroupId)))];
    const sdTgtAdGroupRows = sdTgtAdGroupIds.length > 0
      ? await db.select().from(adGroups).where(and(eq(adGroups.accountId, this.accountId), inArray(adGroups.adGroupId, sdTgtAdGroupIds)))
      : [];
    const sdTgtAdGroupMap = new Map(sdTgtAdGroupRows.map(r => [r.adGroupId, r]));
    const sdTgtIds = apiTargets.map(t => String(t.targetId));
    const existingSdTgtRows = sdTgtIds.length > 0
      ? await db.select().from(productTargets).where(and(eq(productTargets.accountId, this.accountId), inArray(productTargets.targetId, sdTgtIds)))
      : [];
    const existingSdTgtMap = new Map(existingSdTgtRows.map(r => [`${r.internalAdGroupId}:${r.targetId}`, r]));  // v421: 使用internalAdGroupId

    for (const apiTarget of apiTargets) {
      // v363: 使用批量预查询结果
      const adGroup = sdTgtAdGroupMap.get(String(apiTarget.adGroupId));
      if (!adGroup) continue;

      // 解析定向表达式和匹配类型 - 支持ASIN定向和品类定向
      let targetType: 'asin' | 'category' = 'category';
      let targetValue = '';
      let targetExpression = '';
      let targetMatchType: 'exact' | 'expanded' | 'category_exact' | 'brand_exact' | 'substitute' | 'accessory' | 'loose' | 'close' = 'exact';
      let categoryName: string | null = null;
      let categoryRefinements: string | null = null;
      const refinements: Record<string, unknown> = {};

      const exprArray = apiTarget.expression || [];
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
            // @ts-ignore
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
      // @ts-ignore
      } else if (apiTarget.expressionType) {
        // @ts-ignore
        targetExpression = apiTarget.expressionType;
        if (apiTarget.expressionType === 'auto') {
          targetValue = 'AUTO';
          targetMatchType = 'loose';
        }
      }

      // v474: 安全处理 - 如果targetValue仍然为空，使用expression类型作为回退值
      if (!targetValue) {
        const exprTypes = Array.isArray(apiTarget.expression) ? apiTarget.expression.map((e: Record<string, unknown>) => e.type || '').join(',') : '';
        targetValue = exprTypes || `AUTO_${String(apiTarget.targetId)}`;
      }

       // v363: 使用批量预查询结果
      const existing = existingSdTgtMap.get(`${String(adGroup.id)}:${String(apiTarget.targetId)}`) || null;
      // @ts-ignore
      const normalizedState = (apiTarget.state || 'enabled').toLowerCase() as 'enabled' | 'paused' | 'archived';
      // v473: SD API的bid可能是对象格式 {amount: number} 或直接数字
      const rawBid = apiTarget.bid;
      const bidValue = typeof rawBid === 'object' && rawBid !== null ? (rawBid as Record<string, unknown>).amount || 0 : rawBid || 0;
      const targetData = {
        accountId: this.accountId,
        internalAdGroupId: adGroup.id,  // v418: ID体系重构
        campaignId: adGroup.campaignId || '',  // v3577
        targetId: String(apiTarget.targetId),
        targetType,
        targetValue,
        targetExpression,
        targetMatchType,
        bid: String(bidValue),
        targetStatus: normalizedState,
        categoryName: categoryName,
        categoryRefinements: categoryRefinements,
        updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      };
      if (synced === 0) {
        log.debug(`SD产品定向示例: type=${targetType}, value=${targetValue}, matchType=${targetMatchType}, categoryName=${categoryName}`);;
      }

      if (existing) {
        await db
          .update(productTargets)
          .set(targetData)
          .where(eq(productTargets.id, existing.id));
      } else {
        await db.insert(productTargets).values({
          ...targetData,
          // @ts-ignore
          createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
        });
      }
      synced++;
    }

    log.info(`SD商品定位同步完成: synced=${synced}, skipped=${skipped}`);
    return { synced, skipped };
  } catch (error: any) {
    log.warn(`Error syncing SD product targets: ${(error as Error).message || JSON.stringify(error)}`);
    return { synced: 0, skipped: 0 };
  }
};

/**
 * 同步SD定向数据
 * 获取SD广告的受众定向和商品定向数据
 */
// @ts-ignore
AmazonSyncService.prototype.syncSdTargeting = async function(this: AmazonSyncService, days: number = 14): Promise<number> {
  const db = await getDb();
  // v358: 数据库不可用是真实错误，不应返回0
  if (!db) throw new Error('DATABASE_UNAVAILABLE: 数据库连接不可用');

  try {
    // v339: Amazon API单次请求最多31天，需要分批请求
    const MAX_DAYS_PER_REQUEST = 31;
    const totalDays = Math.min(days, 90); // SD定向最多支持90天
    const { startDate: rangeStartDate, endDate: rangeEndDate } = getMarketplaceDateRange(this.marketplace, totalDays);
    const batches = Math.ceil(totalDays / MAX_DAYS_PER_REQUEST);
    log.info(`v339: 开始同步SD定向数据: 共${totalDays}天，分${batches}批请求 (站点: ${this.marketplace})`);

    // v413: 批量提交+统一轮询模式（替代串行循环）
    let allReportData: unknown[] = [];
    if (batches === 1) {
      try {
        const reportId = await this.client.requestSdTargetingReport(rangeStartDate, rangeEndDate);
        const data = await this.client.waitAndDownloadReport(reportId, 300000);
        if (data && data.length > 0) allReportData = data;
      } catch (e: unknown) {
        log.warn(`v413: SD定向报告请求失败:`, (e as Error).message);
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
          name: `SD定向第${batch + 1}/${batches}批(${bStart}~${bEnd})`,
          requestFn: () => this.client.requestSdTargetingReport(bStart, bEnd),
        });
      }
      log.info(`[v413] SD定向: ${batches}批次批量提交开始`);
      const results = await this.client.submitAndWaitMultipleReports(batchRequests, 300000, 2000);
      // @ts-ignore
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
      log.debug('v339: 所有批次SD定向报告数据为空');
      return 0;
    }
    log.info(`v339: 共获取到 ${reportData.length} 条SD定向数据（${batches}批合并）`);
       let synced = 0;

    // v422: 修复SD定向报告字段映射 - 报告中没有targetId字段，只有targetingText
    // 需要通过adGroupId+targetingText匹配已有记录（targetId由listSdTargets API同步）
    // @ts-ignore
    const sdRptAdGroupIds = [...new Set((reportData as unknown[]).map(r => String(r.adGroupId)))];
    const sdRptAdGroupRows = sdRptAdGroupIds.length > 0
      ? await db.select().from(adGroups).where(and(eq(adGroups.accountId, this.accountId), inArray(adGroups.adGroupId, sdRptAdGroupIds)))
      : [];
    const sdRptAdGroupMap = new Map(sdRptAdGroupRows.map(r => [r.adGroupId, r]));
    
    // v422: 预查询所有SD productTargets（按internalAdGroupId），用于通过targetExpression匹配
    // @ts-ignore
    const sdRptInternalAgIds = sdRptAdGroupRows.map(r => r.id);
    const existingSdRptTgtRows = sdRptInternalAgIds.length > 0
      ? await db.select().from(productTargets).where(and(
          eq(productTargets.accountId, this.accountId),
          // @ts-ignore
          inArray(productTargets.internalAdGroupId, sdRptInternalAgIds)
        ))
      // @ts-ignore
      : [];
    // v422: 构建多种匹配索引 - targetExpression和targetValue都可能匹配targetingText
    // @ts-ignore
    const existingSdRptTgtByExpr = new Map<string, typeof existingSdRptTgtRows[0]>();
    const existingSdRptTgtByValue = new Map<string, typeof existingSdRptTgtRows[0]>();
    for (const r of existingSdRptTgtRows) {
      // @ts-ignore
      if (r.targetExpression) {
        // @ts-ignore
        existingSdRptTgtByExpr.set(`${r.internalAdGroupId}:${r.targetExpression}`, r);
      }
      if (r.targetValue) {
        // @ts-ignore
        existingSdRptTgtByValue.set(`${r.internalAdGroupId}:${r.targetValue}`, r);
      }
    }

    for (const row of (reportData as unknown[])) {
      // @ts-ignore
      const adGroup = sdRptAdGroupMap.get(String(row.adGroupId));
      if (!adGroup) continue;

      // SD的销售额 - 使用修正后的字段名 (Clicks后缀)
      // @ts-ignore
      const clickSales = row.salesClicks || 0;
      const viewSales = 0; // 浏览归因已合并到salesClicks字段
      // @ts-ignore
      const clickOrders = row.purchasesClicks || 0;
      const viewOrders = 0; // 浏览归因已合并到purchasesClicks字段
      // @ts-ignore
      const cost = row.cost || 0;
      const sales = clickSales + viewSales;
      // @ts-ignore
      const orders = clickOrders + viewOrders;
      // @ts-ignore
      const clicks = row.clicks || 0;
      // @ts-ignore
      const impressions = row.impressions || 0;

      // v422: 修复字段名 - SD报告返回的是targetingText，不是targetingExpression
      // @ts-ignore
      const targetingText = row.targetingText || '';
      let targetType: 'asin' | 'category' = 'category';
      let targetValue = targetingText;
      
      // SD定向类型可能是受众或商品
      if (targetingText.includes('asin')) {
        targetType = 'asin';
        // 提取ASIN
        const asinMatch = targetingText.match(/asin="([^"]+)"/);
        if (asinMatch) targetValue = asinMatch[1];
      }

      // v422: 通过targetExpression或targetValue匹配已有记录
      const existing = existingSdRptTgtByExpr.get(`${adGroup.id}:${targetingText}`)
        || existingSdRptTgtByValue.get(`${adGroup.id}:${targetValue}`)
        || null;

      // v428: P2修复 - 当targetingText为空且没有匹配到已有记录时跳过，避免targetId=undefined导致insert失败
      if (!targetingText && !existing) {
        // @ts-ignore
        log.debug(`v428: SD定向报告跳过空targetingText记录: adGroupId=${row.adGroupId}`);
        continue;
      }

      const targetData = {
        // @ts-ignore
        internalAdGroupId: adGroup.id,
        campaignId: adGroup.campaignId || '',
        // v422: 如果匹配到已有记录，保留其targetId；否则用targetingText作为临时标识
        // v428: 确保targetId永远不为空字符串
        targetId: existing?.targetId || (targetingText ? `text:${targetingText}` : `unknown:${adGroup.id}:${Date.now()}`),
        targetType,
        targetValue,
        targetExpression: targetingText,
        bid: existing?.bid || '0.00',  // 保留已有的bid
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
        // @ts-ignore
        await db
          .update(productTargets)
          .set(targetData)
          .where(eq(productTargets.id, existing.id));
      } else {
        // @ts-ignore
        await db.insert(productTargets).values({
          ...targetData,
          createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
        });
      }
      synced++;
    }

    log.info(`SD定向同步完成: ${synced} 条记录`);
    return synced;
  } catch (error: any) {
    log.warn(`同步SD定向失败: ${(error as Error).message || JSON.stringify(error)}`);
    // v358: 抛出错误而不是返回0
    throw error;
  }
};


/**
 * v382: 同步SD否定产品定向
 * SD不支持否定关键词，仅支持否定产品定向（仅Ad Group级，仅限上下文定向）
 * 使用 listSdNegativeTargets API方法获取数据，存储到 negativeKeywords 表
 */
// @ts-ignore
AmazonSyncService.prototype.syncSdNegativeTargets = async function(this: AmazonSyncService): Promise<{ synced: number; updated: number }> {
  const db = await getDb();
  if (!db) return { synced: 0, updated: 0 };
  try {
    let synced = 0;
    let updated = 0;
    
    const sdNegTargets = await this.client.listSdNegativeTargets();
    log.debug(`获取到 ${sdNegTargets.length} 个SD否定产品定向`);
    
    if (sdNegTargets.length === 0) {
      return { synced: 0, updated: 0 };
    }
    
    // 批量预查询所有相关campaign和adGroup（消除N+1查询）
    // @ts-ignore
    const sdNegCampaignIds = [...new Set(sdNegTargets.map(n => String(n.campaignId)))];
    const sdNegCampaignRows = sdNegCampaignIds.length > 0
      ? await db.select().from(campaigns)
          .where(and(eq(campaigns.accountId, this.accountId), inArray(campaigns.campaignId, sdNegCampaignIds)))
      : [];
    const sdNegCampaignMap = new Map(sdNegCampaignRows.map(r => [r.campaignId, r]));
    
    const sdNegAdGroupIds = [...new Set(sdNegTargets.filter(n => n.adGroupId).map(n => String(n.adGroupId)))];
    const sdNegAdGroupRows = sdNegAdGroupIds.length > 0
      ? await db.select().from(adGroups).where(and(eq(adGroups.accountId, this.accountId), inArray(adGroups.adGroupId, sdNegAdGroupIds)))
      : [];
    const sdNegAdGroupMap = new Map(sdNegAdGroupRows.map(r => [r.adGroupId, r]));
    
    for (const neg of sdNegTargets) {
      // @ts-ignore
      const negState = (neg.state || 'enabled').toLowerCase();
      if (negState === 'archived') continue;
      
      const campaign = sdNegCampaignMap.get(String(neg.campaignId));
      if (!campaign) continue;
      
      // SD否定定向仅在Ad Group级别
      let internalAdGroupId: number | null = null;  // v418: ID体系重构
      if (neg.adGroupId) {
        const adGroup = sdNegAdGroupMap.get(String(neg.adGroupId));
        if (adGroup) internalAdGroupId = adGroup.id;
      }
      
      // 解析expression获取否定的ASIN或品牌
      const expression = neg.expression || [];
      // @ts-ignore
      const asinExpr = expression.find((e: Record<string, unknown>) => 
        // @ts-ignore
        e.type?.toLowerCase().includes('asin') || e.type?.toLowerCase().includes('brand')
      );
      const negativeText = asinExpr?.value || JSON.stringify(expression);
      const amazonTargetId = String(neg.targetId || '');
      const negLevel = 'ad_group' as const; // SD否定定向仅在Ad Group级别
      
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
          .set({ 
            amazonNegativeKeywordId: amazonTargetId || null, 
            negativeStatus: negState === 'enabled' ? 'active' as const : 'removed' as const,
            campaignType: 'sd' as const,
            negativeScope: 'ad_group' as const,
          })
          .where(eq(negativeKeywords.id, existing.id));
        updated++;
      } else {
        // v529: 添加onDuplicateKeyUpdate处理竞态条件下的DUP_ENTRY错误
        await db.insert(negativeKeywords).values({
          // @ts-ignore
          accountId: this.accountId,
          campaignId: String(campaign.campaignId),
          internalAdGroupId: internalAdGroupId,
          campaignType: 'sd',
          negativeScope: 'ad_group',
          negativeLevel: negLevel,
          negativeType: 'product',
          negativeText: negativeText,
          negativeMatchType: 'negative_exact',
          amazonNegativeKeywordId: amazonTargetId || null,
          negativeSource: 'manual',
          negativeStatus: negState === 'enabled' ? 'active' as const : 'removed' as const,
        }).onDuplicateKeyUpdate({
          set: { negativeStatus: sql`VALUES(negativeStatus)`, amazonNegativeKeywordId: sql`VALUES(amazonNegativeKeywordId)` }
        });
        synced++;
      }
    }
    
    log.info(`SD否定产品定向同步完成: ${synced}条新增, ${updated}条更新`);
    return { synced, updated };
  } catch (error: unknown) {
    log.warn('SD否定产品定向同步失败:', (error as Error).message);
    return { synced: 0, updated: 0 };
  }
};

/**
 * v519: 同步SD投放对象的建议竞价（增强版）
 * 
 * SD广告的建议竞价通过 POST /sd/targets/bid/recommendations 获取
 * 传入 targetingClauses（targetId + adGroupId），最多100个
 * 
 * v519增强:
 * - 添加本地推荐引擎回退（与V515 SB修复一致）
 * - 增强API响应日志记录
 * - 按adGroup分组进行本地推荐回退
 * - 支持跨类型数据回退（SD → SP/SB账户级数据）
 * 
 * 建议竞价写入 productTargets.suggestedBid
 */
// @ts-ignore
AmazonSyncService.prototype.syncSdBidRecommendations = async function(this: AmazonSyncService): Promise<{ synced: number; skipped: number }> {
  const db = await getDb();
  if (!db) return { synced: 0, skipped: 0 };

  let targetBidsUpdated = 0;
  let localEngineBidsUpdated = 0;
  let errors = 0;

  try {
    log.info('[v519] ========== 开始同步SD投放对象建议竞价 ==========');

    // v519: 查询所有SD投放对象（enabled状态），同时获取Amazon adGroupId用于本地推荐回退
    const sdTargetRows = await db.select({
      id: productTargets.id,
      targetId: productTargets.targetId,
      adGroupId: productTargets.internalAdGroupId,
      amazonAdGroupId: adGroups.adGroupId,
      campaignId: productTargets.campaignId,
    }).from(productTargets)
      .innerJoin(adGroups, eq(productTargets.internalAdGroupId, adGroups.id))
      .innerJoin(campaigns, eq(adGroups.campaignId, campaigns.campaignId))
      .where(and(
        eq(productTargets.accountId, this.accountId),
        eq(campaigns.campaignType, 'sd'),
        eq(productTargets.targetStatus, 'enabled'),
      ));

    log.info(`[v519] 查询到 ${sdTargetRows.length} 个SD投放对象需要获取建议竞价`);

    if (sdTargetRows.length === 0) {
      return { synced: 0, skipped: 0 };
    }

    // 查询adGroup的Amazon adGroupId映射
    const internalAdGroupIds = [...new Set(sdTargetRows.map(r => Number(r.adGroupId) || 0).filter(id => id > 0))];
    const adGroupMappingRows = internalAdGroupIds.length > 0
      ? await db.select({ id: adGroups.id, adGroupId: adGroups.adGroupId }).from(adGroups)
          .where(and(eq(adGroups.accountId, this.accountId), inArray(adGroups.id, internalAdGroupIds)))
      : [];
    const internalToAmazonAdGroupId = new Map(adGroupMappingRows.map(r => [r.id, r.adGroupId]));

    // v519: 按adGroup分组，便于本地推荐引擎回退
    const targetsByAdGroup = new Map<number, Array<typeof sdTargetRows[0]>>();
    for (const row of sdTargetRows) {
      const agId = Number(row.adGroupId) || 0;
      if (!targetsByAdGroup.has(agId)) targetsByAdGroup.set(agId, []);
      targetsByAdGroup.get(agId)!.push(row);
    }

    // 按批次请求建议竞价（每批最多100个）
    let apiSucceeded = false;
    const batchSize = 100;
    for (let i = 0; i < sdTargetRows.length; i += batchSize) {
      const batch = sdTargetRows.slice(i, i + batchSize);

      try {
        // 构建targetingClauses
        const targetingClauses: Array<{ targetId: string; adGroupId: string }> = [];
        const clauseToTarget = new Map<number, typeof batch[0]>();

        for (const tgt of batch) {
          if (!tgt.targetId) continue;
          const amazonAdGroupId = internalToAmazonAdGroupId.get(Number(tgt.adGroupId) || 0);
          if (!amazonAdGroupId) continue;

          clauseToTarget.set(targetingClauses.length, tgt);
          targetingClauses.push({
            targetId: tgt.targetId,
            adGroupId: amazonAdGroupId,
          });
        }

        if (targetingClauses.length === 0) continue;

        const recommendations = await this.client.getSdTargetBidRecommendations(targetingClauses);

        // v519: 增强日志 — 记录API返回的原始数据量
        log.info(`[v519] SD建议竞价API返回: 请求=${targetingClauses.length}, 返回=${recommendations?.length || 0}`);

        if (recommendations && recommendations.length > 0) {
          // 尝试按targetId匹配
          const recByTargetId = new Map<string, { suggestedBid: number; bidRangeLow: number; bidRangeHigh: number }>();
          for (const rec of recommendations) {
            if (rec.targetId && rec.suggestedBid && rec.suggestedBid > 0) {
              recByTargetId.set(rec.targetId, {
                suggestedBid: rec.suggestedBid,
                bidRangeLow: rec.bidRangeLow || 0,
                bidRangeHigh: rec.bidRangeHigh || 0,
              });
            }
          }

          let batchUpdated = 0;
          for (const tgt of batch) {
            if (!tgt.targetId) continue;
            const bidData = recByTargetId.get(tgt.targetId);
            if (bidData && bidData.suggestedBid > 0) {
              await db.update(productTargets)
                .set({
                  suggestedBid: String(bidData.suggestedBid),
                  suggestedBidLow: bidData.bidRangeLow > 0 ? String(bidData.bidRangeLow) : null,
                  suggestedBidHigh: bidData.bidRangeHigh > 0 ? String(bidData.bidRangeHigh) : null,
                })
                .where(eq(productTargets.id, tgt.id));
              targetBidsUpdated++;
              batchUpdated++;
            }
          }

          // 如果按targetId匹配不到，尝试按顺序匹配
          if (batchUpdated === 0 && recommendations.length > 0) {
            const orderedTargets = [...clauseToTarget.entries()].sort((a, b) => a[0] - b[0]);
            for (let j = 0; j < Math.min(recommendations.length, orderedTargets.length); j++) {
              const rec = recommendations[j];
              const tgt = orderedTargets[j][1];
              if (rec && rec.suggestedBid && rec.suggestedBid > 0) {
                await db.update(productTargets)
                  .set({
                    suggestedBid: String(rec.suggestedBid),
                    suggestedBidLow: rec.bidRangeLow > 0 ? String(rec.bidRangeLow) : null,
                    suggestedBidHigh: rec.bidRangeHigh > 0 ? String(rec.bidRangeHigh) : null,
                  })
                  .where(eq(productTargets.id, tgt.id));
                targetBidsUpdated++;
                batchUpdated++;
              }
            }
          }

          if (batchUpdated > 0) apiSucceeded = true;
        }
      } catch (err: unknown) {
        errors++;
        log.warn(`[v519] SD投放对象建议竞价批次获取失败: ${(err as Error).message}`);
      }
    }

    // v519: Amazon API失败或返回空时，使用本地历史数据推荐引擎为SD targets提供建议竞价
    // 按adGroup分组进行本地推荐回退
    if (!apiSucceeded && sdTargetRows.length > 0) {
      log.info(`[v519] SD API未返回有效建议竞价，启动本地推荐引擎回退 (${targetsByAdGroup.size}个广告组)`);

      for (const [internalAgId, targets] of targetsByAdGroup) {
        try {
          const amazonAdGroupId = internalToAmazonAdGroupId.get(internalAgId);
          if (!amazonAdGroupId) continue;

          const refCampaignId = targets[0]?.campaignId || '';
          const localRec = await getLocalTargetBidRecommendation(
            this.accountId, amazonAdGroupId, refCampaignId, 'sd', 0.30
          );

          if (localRec.source !== 'minimum_default' && localRec.suggestedBid > 0) {
            for (const tgt of targets) {
              await db.update(productTargets)
                .set({
                  suggestedBid: String(localRec.suggestedBid),
                  suggestedBidLow: String(localRec.rangeStart),
                  suggestedBidHigh: String(localRec.rangeEnd),
                })
                .where(eq(productTargets.id, tgt.id));
              localEngineBidsUpdated++;
            }
            log.info(`[v519] 本地推荐引擎为SD adGroup ${amazonAdGroupId} 的 ${targets.length} 个定位提供建议竞价 $${localRec.suggestedBid.toFixed(2)} (${localRec.source})`);
          } else {
            log.debug(`[v519] 本地推荐引擎对SD adGroup ${amazonAdGroupId} 无足够数据 (source=${localRec.source})`);
          }
        } catch (localErr: unknown) {
          log.debug(`[v519] SD定位本地推荐引擎异常: ${(localErr as Error).message}`);
        }
      }
    }

    const totalUpdated = targetBidsUpdated + localEngineBidsUpdated;
    log.info(`[v519] ========== SD建议竞价同步总结: API=${targetBidsUpdated}, 本地引擎=${localEngineBidsUpdated}, 总计=${totalUpdated}, 错误=${errors} ==========`);
    return { synced: totalUpdated, skipped: errors };
  } catch (error: any) {
    log.warn(`[v519] Error syncing SD bid recommendations: ${(error as Error).message || JSON.stringify(error)}`);
    return { synced: targetBidsUpdated + localEngineBidsUpdated, skipped: errors };
  }
};


/**
 * v500: 同步SD受众定向数据
 * 从Amazon SD API获取受众定向列表并同步到sdAudiences表
 * 
 * SD广告的受众定向（Audience Targeting）是SD广告最核心的定向方式之一，包括：
 * - Remarketing: views（浏览再营销）、purchases（购买再营销）、similarProducts（相似商品）
 * - In-market: 基于购买意向的受众
 * - Lifestyle: 基于兴趣和生活方式的受众
 * - Custom: 自定义受众
 * 
 * SD API使用 /sd/targets 端点，受众定向和商品定向共用同一个端点，
 * 通过 expression 中的 type 字段区分：
 * - 商品定向: asinSameAs, asinCategorySameAs, asinBrandSameAs 等
 * - 受众定向: views, purchases, audiences 等
 */
// @ts-ignore
AmazonSyncService.prototype.syncSdAudiences = async function(this: AmazonSyncService): Promise<{ synced: number; skipped: number }> {
  const db = await getDb();
  if (!db) return { synced: 0, skipped: 0 };

  try {
    // SD API的targets端点同时返回商品定向和受众定向
    // 我们需要从中筛选出受众定向类型的targets
    const apiTargets = await this.client.listSdTargets();
    let synced = 0;
    let skipped = 0;

    log.debug(`[v500] 获取到 ${apiTargets.length} 个SD targets，开始筛选受众定向`);

    // v500: 批量预查询所有相关adGroup（消除N+1查询）
    const sdAudAdGroupIds = [...new Set(apiTargets.map(t => String(t.adGroupId)))];
    const sdAudAdGroupRows = sdAudAdGroupIds.length > 0
      ? await db.select().from(adGroups).where(and(eq(adGroups.accountId, this.accountId), inArray(adGroups.adGroupId, sdAudAdGroupIds)))
      : [];
    const sdAudAdGroupMap = new Map(sdAudAdGroupRows.map(r => [r.adGroupId, r]));

    // 预查询已存在的sdAudiences记录
    const sdAudInternalAgIds = sdAudAdGroupRows.map(r => r.id);
    const existingSdAudRows = sdAudInternalAgIds.length > 0
      ? await db.select().from(sdAudiences).where(and(
          eq(sdAudiences.accountId, this.accountId),
          inArray(sdAudiences.internalAdGroupId, sdAudInternalAgIds)
        ))
      : [];
    const existingSdAudMap = new Map(existingSdAudRows.map(r => [`${r.internalAdGroupId}:${r.audienceId}`, r]));

    // 受众定向的expression type关键字
    const AUDIENCE_EXPRESSION_TYPES = [
      'views', 'purchases', 'audience', 'audiences',
      'similar', 'similarproduct', 'lookback',
      'inmarket', 'in-market', 'in_market',
      'lifestyle', 'interest',
      'custom',
    ];

    for (const apiTarget of apiTargets) {
      // 解析expression判断是否为受众定向
      const exprArray = apiTarget.expression || apiTarget.expressions || [];
      if (!Array.isArray(exprArray) || exprArray.length === 0) {
        continue;
      }

      // 检查expression类型是否为受众定向
      let isAudienceTarget = false;
      let audienceType: 'views' | 'purchases' | 'inMarket' | 'lifestyle' | 'custom' | 'similarProducts' | 'lookback' = 'views';
      let audienceCategory = '';
      let audienceSubCategory = '';
      let amazonAudienceId: string | null = null;

      for (const expr of exprArray) {
        const et = String(expr.type || '').toLowerCase();
        
        // 判断是否为受众定向类型
        if (AUDIENCE_EXPRESSION_TYPES.some(aud => et.includes(aud))) {
          isAudienceTarget = true;
          
          // 分类受众类型
          if (et.includes('views') || et.includes('view')) {
            audienceType = 'views';
            audienceCategory = 'remarketing';
            audienceSubCategory = 'Product Views';
          } else if (et.includes('purchases') || et.includes('purchase')) {
            audienceType = 'purchases';
            audienceCategory = 'remarketing';
            audienceSubCategory = 'Product Purchases';
          } else if (et.includes('similar')) {
            audienceType = 'similarProducts';
            audienceCategory = 'remarketing';
            audienceSubCategory = 'Similar Products';
          } else if (et.includes('lookback')) {
            audienceType = 'lookback';
            audienceCategory = 'remarketing';
            audienceSubCategory = `Lookback ${expr.value || '30'} days`;
          } else if (et.includes('inmarket') || et.includes('in-market') || et.includes('in_market')) {
            audienceType = 'inMarket';
            audienceCategory = 'in_market';
            // @ts-ignore
            audienceSubCategory = expr.value || 'In-Market Audience';
          } else if (et.includes('lifestyle') || et.includes('interest')) {
            audienceType = 'lifestyle';
            audienceCategory = 'lifestyle';
            audienceSubCategory = expr.value || 'Lifestyle Audience';
          } else if (et.includes('audience')) {
            // 通用audience类型 - 可能是Amazon预定义受众
            audienceType = 'custom';
            audienceCategory = 'custom';
            audienceSubCategory = expr.value || 'Custom Audience';
            amazonAudienceId = expr.value || null;
          } else if (et.includes('custom')) {
            audienceType = 'custom';
            audienceCategory = 'custom';
            audienceSubCategory = expr.value || 'Custom Audience';
          }
          
          break; // 找到第一个受众类型即可
        }
      }

      // 如果不是受众定向，跳过（由syncSdProductTargets处理）
      if (!isAudienceTarget) {
        continue;
      }

      // 查找对应的adGroup
      const adGroup = sdAudAdGroupMap.get(String(apiTarget.adGroupId));
      if (!adGroup) {
        skipped++;
        continue;
      }

      const targetId = String(apiTarget.targetId);
      const existing = existingSdAudMap.get(`${adGroup.id}:${targetId}`) || null;
      // @ts-ignore
      const normalizedState = (apiTarget.state || 'enabled').toLowerCase() as 'enabled' | 'paused' | 'archived';

      // 提取lookback天数
      // @ts-ignore
      let lookbackDays = 30; // 默认30天
      for (const expr of exprArray) {
        if (expr.lookbackDays || expr.lookback) {
          lookbackDays = Number(expr.lookbackDays || expr.lookback) || 30;
          break;
        }
      }

      const audienceData = {
        accountId: this.accountId,
        internalAdGroupId: adGroup.id,
        audienceId: targetId,
        audienceName: apiTarget.name || `${audienceCategory} - ${audienceSubCategory}`,
        audienceType,
        lookbackDays,
        audienceCategory,
        audienceSubCategory,
        audienceExpression: JSON.stringify(exprArray),
        amazonAudienceId,
        bid: String(typeof apiTarget.bid === 'object' && apiTarget.bid !== null 
          ? (apiTarget.bid as Record<string, unknown>).amount || 0 
          : (apiTarget.bid || 0)),
        state: normalizedState,
        updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      };

      if (synced === 0) {
        log.debug(`[v500] SD受众定向示例: type=${audienceType}, category=${audienceCategory}, sub=${audienceSubCategory}, bid=${audienceData.bid}`);
      }

      if (existing) {
        await db
          .update(sdAudiences)
          // @ts-ignore
          .set(audienceData)
          .where(eq(sdAudiences.id, existing.id));
      } else {
        // @ts-ignore
        await db.insert(sdAudiences).values({
          ...audienceData,
          createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
        });
      }
      synced++;
    }

    log.info(`[v500] SD受众定向同步完成: synced=${synced}, skipped=${skipped}`);
    return { synced, skipped };
  } catch (error: unknown) {
    // @ts-expect-error - Axios error response access
    const statusCode = error?.response?.status || 'unknown';
    // @ts-expect-error - error message access
    const errorMsg = error?.response?.data?.message || error?.message || 'unknown error';
    log.warn(`[v500] Error syncing SD audiences: HTTP ${statusCode} - ${errorMsg}`);
    if (statusCode === 403) {
      log.warn('[v500] SD audiences API返回403，Profile缺少SD权限，跳过');
    }
    return { synced: 0, skipped: 0 };
  }
};

/**
 * v519: 同步SD受众定向的建议竞价
 * 
 * SD受众定向（sd_audiences表）之前没有suggestedBid列，
 * v519新增了suggested_bid/suggested_bid_low/suggested_bid_high三列。
 * 
 * SD受众定向的建议竞价获取策略：
 * 1. 尝试通过Amazon SD API获取（如果API支持受众级别的竞价建议）
 * 2. 回退到本地推荐引擎：使用同广告组/同广告活动/同账户的历史数据
 * 
 * 注：Amazon SD API目前不提供受众级别的竞价建议端点，
 * 因此主要依赖本地推荐引擎基于历史表现数据计算建议竞价。
 */
// @ts-ignore
AmazonSyncService.prototype.syncSdAudienceBidRecommendations = async function(this: AmazonSyncService): Promise<{ synced: number; skipped: number }> {
  const db = await getDb();
  if (!db) return { synced: 0, skipped: 0 };

  let audienceBidsUpdated = 0;
  let errors = 0;

  try {
    log.info('[v519] ========== 开始同步SD受众定向建议竞价 ==========');

    // 查询所有SD受众定向（enabled状态），同时获取adGroup和campaign信息
    const sdAudienceRows = await db.select({
      id: sdAudiences.id,
      internalAdGroupId: sdAudiences.internalAdGroupId,
      audienceId: sdAudiences.audienceId,
      audienceType: sdAudiences.audienceType,
      bid: sdAudiences.bid,
      amazonAdGroupId: adGroups.adGroupId,
      campaignId: adGroups.campaignId,
    }).from(sdAudiences)
      .innerJoin(adGroups, eq(sdAudiences.internalAdGroupId, adGroups.id))
      .where(and(
        eq(sdAudiences.accountId, this.accountId),
        eq(sdAudiences.state, 'enabled'),
      ));

    log.info(`[v519] 查询到 ${sdAudienceRows.length} 个SD受众定向需要获取建议竞价`);

    if (sdAudienceRows.length === 0) {
      return { synced: 0, skipped: 0 };
    }

    // 按adGroup分组
    const audiencesByAdGroup = new Map<string, Array<typeof sdAudienceRows[0]>>();
    for (const row of sdAudienceRows) {
      const agId = row.amazonAdGroupId || '';
      if (!audiencesByAdGroup.has(agId)) audiencesByAdGroup.set(agId, []);
      audiencesByAdGroup.get(agId)!.push(row);
    }

    // 使用本地推荐引擎为每个adGroup的受众提供建议竞价
    for (const [amazonAdGroupId, audiences] of audiencesByAdGroup) {
      if (!amazonAdGroupId) continue;

      try {
        const refCampaignId = audiences[0]?.campaignId || '';
        // 使用Target级别的本地推荐（SD受众和Target共用同一个广告组的历史数据）
        const localRec = await getLocalTargetBidRecommendation(
          this.accountId, amazonAdGroupId, refCampaignId, 'sd', 0.30
        );

        if (localRec.source !== 'minimum_default' && localRec.suggestedBid > 0) {
          for (const aud of audiences) {
            await db.update(sdAudiences)
              .set({
                suggestedBid: String(localRec.suggestedBid),
                suggestedBidLow: String(localRec.rangeStart),
                suggestedBidHigh: String(localRec.rangeEnd),
              })
              .where(eq(sdAudiences.id, aud.id));
            audienceBidsUpdated++;
          }
          log.info(`[v519] 本地推荐引擎为SD adGroup ${amazonAdGroupId} 的 ${audiences.length} 个受众提供建议竞价 $${localRec.suggestedBid.toFixed(2)} (${localRec.source}, confidence=${localRec.confidence.toFixed(2)})`);
        } else {
          // v522: 本地推荐引擎无数据时，使用adGroup的defaultBid作为基线建议竞价
          const refAudience = audiences[0];
          if (refAudience && refAudience.bid && Number(refAudience.bid) > 0) {
            const baseBid = Number(refAudience.bid);
            const sugBid = Math.max(baseBid, 0.10); // 最低0.10美元
            for (const aud of audiences) {
              await db.update(sdAudiences)
                .set({
                  suggestedBid: String(sugBid.toFixed(2)),
                  suggestedBidLow: String(Math.max(sugBid * 0.5, 0.05).toFixed(2)),
                  suggestedBidHigh: String((sugBid * 2.0).toFixed(2)),
                })
                .where(eq(sdAudiences.id, aud.id));
              audienceBidsUpdated++;
            }
            log.info(`[v522] SD adGroup ${amazonAdGroupId} 使用当前出价$${sugBid.toFixed(2)}作为建议竞价基线 (${audiences.length}个受众)`);
          } else {
            log.debug(`[v519] 本地推荐引擎对SD adGroup ${amazonAdGroupId} 无足够数据 (source=${localRec.source})`);
          }
        }
      } catch (localErr: unknown) {
        errors++;
        log.debug(`[v519] SD受众本地推荐引擎异常: ${(localErr as Error).message}`);
      }
    }

    log.info(`[v519] ========== SD受众建议竞价同步总结: 更新=${audienceBidsUpdated}, 错误=${errors} ==========`);
    return { synced: audienceBidsUpdated, skipped: errors };
  } catch (error: any) {
    log.warn(`[v519] Error syncing SD audience bid recommendations: ${(error as Error).message || JSON.stringify(error)}`);
    return { synced: audienceBidsUpdated, skipped: errors };
  }
};
