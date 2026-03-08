/**
 * SD (Sponsored Display) 广告数据同步方法
 * 
 * 从 amazonSyncService.ts 中提取的 syncSd 子模块。
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

const log = createModuleLogger('syncSd');

// ==================== 类型声明（模块扩展） ====================

declare module '../../amazonSyncService' {
  interface AmazonSyncService {
    syncSdCampaigns(...args: unknown[]): unknown;
    syncSdAdGroups(...args: unknown[]): unknown;
    syncSdProductTargets(...args: unknown[]): unknown;
    syncSdTargeting(...args: unknown[]): unknown;
  }
}

// ==================== 方法实现 ====================

/**
 * 同步SD展示广告活动
 * @param lastSyncTime 上次同步时间，用于增量同步
 */
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
      const sdCostType = (apiCampaign as Record<string, any>).costType?.toLowerCase() || 'cpc';
      const validCostTypes = ['cpc', 'vcpm', 'cpm'];
      const normalizedCostType = validCostTypes.includes(sdCostType) ? sdCostType : 'cpc';

      // 获取组合ID
      const sdPortfolioId = (apiCampaign as Record<string, any>).portfolioId ? String((apiCampaign as Record<string, any>).portfolioId) : null;

      // ✅ 获取SD广告的Campaign Goal（广告目标）
      // SD API返回的goal/optimizationGoal字段决定广告目标:
      //   - reach → 触达用户（通常配合vCPM计费）
      //   - page_visits / pageVisits → 驱动页面访问（通常配合CPC计费）
      //   - conversions → 促进转化（通常配合CPC计费）
      // 注意：SD的costType由API直接返回，不goal共同决定广告的计费和优化方式
      const sdGoal = (apiCampaign as Record<string, any>).goal || 
                     (apiCampaign as Record<string, any>).optimizationGoal || 
                     (apiCampaign as Record<string, any>).bidOptimization || '';
      
      // 获取SD广告的tactic（定向策略）
      // T00020 = 受众定向(Audiences), T00030 = 商品定向(Contextual)
      // remarketing = 再营销, contextual = 上下文定向
      const sdTactic = (apiCampaign as Record<string, any>).tactic || null;
      
      // 根据goal和costType的组合确定实际计费方式
      // SD的costType由API直接返回，但也可以通过goal推断
      let finalCostType = normalizedCostType;
      if (sdGoal === 'reach' && normalizedCostType === 'cpc') {
        // reach目标通常使用vCPM，但以API返回的costType为准
        log.debug(`SD广告 ${apiCampaign.name}: goal=reach 但 costType=cpc，以API返回为准`);
      }

      // 获取SD广告的竞价优化目标
      const sdBidOptimization = (apiCampaign as Record<string, any>).bidOptimization || null;
      const validBidOpts = ['reach', 'pageVisits', 'conversions'];
      const normalizedBidOpt = validBidOpts.includes(sdBidOptimization) ? sdBidOptimization : null;

      log.debug(`SD广告 ${apiCampaign.name}: goal=${sdGoal}, costType=${finalCostType}, tactic=${sdTactic}`);

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
};

/**
 * 同步SD展示广告组
 * 从Amazon SD API获取广告组列表并同步到本地数据库
 */
AmazonSyncService.prototype.syncSdAdGroups = async function(this: AmazonSyncService): Promise<{ synced: number; skipped: number }> {
  const db = await getDb();
  if (!db) return { synced: 0, skipped: 0 };

  try {
    const apiAdGroups = await this.client.listSdAdGroups();
    let synced = 0;
    let skipped = 0;

    log.debug(`获取到 ${apiAdGroups.length} 个SD广告组`);

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

      // SD广告组可能有tactic字段（如T00020 = 受众定向, T00030 = 商品定向）
      const tactic = apiAdGroup.tactic || null;

      const adGroupData = {
        campaignId: campaign.campaignId,
        accountId: this.accountId,
        adGroupId: String(apiAdGroup.adGroupId),
        adGroupName: apiAdGroup.name || apiAdGroup.adGroupName || 'SD Ad Group',
        adGroupStatus: normalizedState,
        defaultBid: String(apiAdGroup.defaultBid || apiAdGroup.bid || 0),
        tactic: tactic,
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

    log.info(`SD广告组同步完成: synced=${synced}, skipped=${skipped}`);
    return { synced, skipped };
  } catch (error) {
    log.error('Error syncing SD ad groups:', error);
    return { synced: 0, skipped: 0 };
  }
};

/**
 * 同步SD商品定位（从List API）
 * 从Amazon SD API获取商品定位列表并同步到本地数据库
 */
AmazonSyncService.prototype.syncSdProductTargets = async function(this: AmazonSyncService): Promise<{ synced: number; skipped: number }> {
  const db = await getDb();
  if (!db) return { synced: 0, skipped: 0 };

  try {
    const apiTargets = await this.client.listSdTargets();
    let synced = 0;
    let skipped = 0;

    log.debug(`获取到 ${apiTargets.length} 个SD商品定位`);

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
      } else if (apiTarget.expressionType) {
        targetExpression = apiTarget.expressionType;
        if (apiTarget.expressionType === 'auto') {
          targetValue = 'AUTO';
          targetMatchType = 'loose';
        }
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
          createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
        });
      }
      synced++;
    }

    log.info(`SD商品定位同步完成: synced=${synced}, skipped=${skipped}`);
    return { synced, skipped };
  } catch (error) {
    log.error('Error syncing SD product targets:', error);
    return { synced: 0, skipped: 0 };
  }
};

/**
 * 同步SD定向数据
 * 获取SD广告的受众定向和商品定向数据
 */
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

    let allReportData: any[] = [];
    for (let batch = 0; batch < batches; batch++) {
      const endDateObj = new Date(rangeEndDate);
      endDateObj.setDate(endDateObj.getDate() - (batch * MAX_DAYS_PER_REQUEST));
      const startDateObj = new Date(endDateObj);
      const daysInBatch = Math.min(MAX_DAYS_PER_REQUEST, totalDays - (batch * MAX_DAYS_PER_REQUEST));
      startDateObj.setDate(startDateObj.getDate() - daysInBatch + 1);
      const batchStartDate = startDateObj.toISOString().split('T')[0];
      const batchEndDate = endDateObj.toISOString().split('T')[0];
      log.info(`v339: SD定向第${batch + 1}/${batches}批: ${batchStartDate} - ${batchEndDate} (共${daysInBatch}天)`);
      try {
        const reportId = await this.client.requestSdTargetingReport(batchStartDate, batchEndDate);
        const batchData = await this.client.waitAndDownloadReport(reportId, 300000);
        if (batchData && batchData.length > 0) {
          allReportData = allReportData.concat(batchData);
          log.info(`v339: 第${batch + 1}批获取到 ${batchData.length} 条数据`);
        }
        if (batch < batches - 1) await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (batchError: unknown) {
        log.error(`v339: SD定向第${batch + 1}批请求失败:`, (batchError as Error).message);
      }
    }

    const reportData = allReportData;
    if (!reportData || reportData.length === 0) {
      log.debug('v339: 所有批次SD定向报告数据为空');
      return 0;
    }
    log.info(`v339: 共获取到 ${reportData.length} 条SD定向数据（${batches}批合并）`);
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
            eq(productTargets.adGroupId, String(adGroup.id)),
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
        adGroupId: String(adGroup.id),  // v357
        campaignId: adGroup.campaignId || '',  // v357
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
    // v358: 抛出错误而不是返回0
    throw error;
  }
};

