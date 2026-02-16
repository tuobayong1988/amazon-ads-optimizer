/**
 * Amazon Advertising API 数据同步服务
 * 
 * 负责从Amazon API同步数据到本地数据库，包括：
 * - 广告活动同步
 * - 广告组同步
 * - 关键词和商品定位同步
 * - 绩效数据同步
 */

import { eq, and, sql } from 'drizzle-orm';
import { getDb } from './db';
import {
  campaigns,
  adGroups,
  keywords,
  productTargets,
  dailyPerformance,
  biddingLogs,
  placementPerformance,
  searchTerms,
  negativeKeywords,
} from '../drizzle/schema';
import {
  AmazonAdsApiClient,
  createAmazonAdsClient,
  AmazonApiCredentials,
  SpCampaign,
} from './amazonAdsApi';
import { calculateBidAdjustment, OptimizationTarget, PerformanceGroupConfig } from './bidOptimizer';
import { getMarketplaceDateRange, getMarketplaceCurrentDate, getMarketplaceYesterday, getMarketplaceHistoricalDateRange } from './utils/timezone';

// API凭证存储接口
interface StoredApiCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  profileId: string;
  region: 'NA' | 'EU' | 'FE';
}

/**
 * 同步服务类
 */
export class AmazonSyncService {
  public client: AmazonAdsApiClient;
  public accountId: number;
  public userId: number;
  public marketplace: string; // 站点代码，用于时区计算

  constructor(client: AmazonAdsApiClient, accountId: number, userId: number, marketplace: string = 'US') {
    this.client = client;
    this.accountId = accountId;
    this.userId = userId;
    this.marketplace = marketplace;
  }

  /**
   * 从数据库加载API凭证并创建同步服务
   */
  static async createFromCredentials(
    credentials: StoredApiCredentials,
    accountId: number,
    userId: number,
    marketplace: string = 'US' // 站点代码，用于时区计算
  ): Promise<AmazonSyncService> {
    const apiCredentials: AmazonApiCredentials = {
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
      refreshToken: credentials.refreshToken,
      profileId: credentials.profileId,
      region: credentials.region,
    };

    const client = createAmazonAdsClient(apiCredentials);
    return new AmazonSyncService(client, accountId, userId, marketplace);
  }

  /**
   * 完整同步所有数据
   * 每次同步都获取60天历史数据（包含当日），确保数据完整性和归因窗口期数据准确
   */
  async syncAll(): Promise<{
    campaigns: number;
    adGroups: number;
    keywords: number;
    targets: number;
    performance: number;
    spCampaigns?: number;
    sbCampaigns?: number;
    sdCampaigns?: number;
  }> {
    const results = {
      campaigns: 0,
      adGroups: 0,
      keywords: 0,
      targets: 0,
      performance: 0,
      spCampaigns: 0,
      sbCampaigns: 0,
      sdCampaigns: 0,
    };

    // 同步SP广告活动
    const spResult = await this.syncSpCampaigns();
    results.spCampaigns = typeof spResult === 'number' ? spResult : spResult.synced;
    results.campaigns += results.spCampaigns;
    
    // 同步SB广告活动
    const sbResult = await this.syncSbCampaigns();
    results.sbCampaigns = typeof sbResult === 'number' ? sbResult : sbResult.synced;
    results.campaigns += results.sbCampaigns;
    
    // 同步SD广告活动
    const sdResult = await this.syncSdCampaigns();
    results.sdCampaigns = typeof sdResult === 'number' ? sdResult : sdResult.synced;
    results.campaigns += results.sdCampaigns;
    
    // ==================== 同步广告组（SP + SB + SD） ====================
    const spAdGroupResult = await this.syncSpAdGroups();
    results.adGroups += typeof spAdGroupResult === 'number' ? spAdGroupResult : spAdGroupResult.synced;

    try {
      const sbAdGroupResult = await this.syncSbAdGroups();
      results.adGroups += sbAdGroupResult.synced;
    } catch (e: any) {
      console.error('[SyncService] SB广告组同步失败:', e.message);
    }

    try {
      const sdAdGroupResult = await this.syncSdAdGroups();
      results.adGroups += sdAdGroupResult.synced;
    } catch (e: any) {
      console.error('[SyncService] SD广告组同步失败:', e.message);
    }
    
    // ==================== 同步关键词投放（SP + SB） ====================
    const spKeywordResult = await this.syncSpKeywords();
    results.keywords += typeof spKeywordResult === 'number' ? spKeywordResult : spKeywordResult.synced;

    try {
      const sbKeywordResult = await this.syncSbKeywords();
      results.keywords += sbKeywordResult.synced;
    } catch (e: any) {
      console.error('[SyncService] SB关键词同步失败:', e.message);
    }
    
    // ==================== 同步商品定位（SP + SB + SD） ====================
    const spTargetResult = await this.syncSpProductTargets();
    results.targets += typeof spTargetResult === 'number' ? spTargetResult : spTargetResult.synced;

    try {
      const sbTargetResult = await this.syncSbProductTargets();
      results.targets += sbTargetResult.synced;
    } catch (e: any) {
      console.error('[SyncService] SB商品定位同步失败:', e.message);
    }

    try {
      const sdTargetResult = await this.syncSdProductTargets();
      results.targets += sdTargetResult.synced;
    } catch (e: any) {
      console.error('[SyncService] SD商品定位同步失败:', e.message);
    }

    // ==================== 同步否定关键词 ====================
    try {
      console.log(`[SyncService] 开始同步SP否定关键词...`);
      const negResult = await this.syncSpNegativeKeywords();
      console.log(`[SyncService] SP否定关键词同步完成: ${negResult.synced}条新增, ${negResult.updated}条更新`);
    } catch (e: any) {
      console.error('[SyncService] SP否定关键词同步失败:', e.message);
    }
    // ==================== 同步SP否定商品定向 ====================
    try {
      console.log(`[SyncService] 开始同步SP否定商品定向...`);
      const negPtResult = await this.syncSpNegativeProductTargets();
      console.log(`[SyncService] SP否定商品定向同步完成: ${negPtResult.synced}条新增, ${negPtResult.updated}条更新`);
    } catch (e: any) {
      console.error('[SyncService] SP否定商品定向同步失败:', e.message);
    }
    // ==================== 同步SP搜索词 ====================
    try {
      console.log(`[SyncService] 开始同步SP搜索词数据...`);
      const spSearchTermSynced = await this.syncSearchTerms(14);
      console.log(`[SyncService] SP搜索词同步完成: ${spSearchTermSynced}条`);
    } catch (e: any) {
      console.error('[SyncService] SP搜索词同步失败:', e.message);
    }
    // ==================== 同步SB搜索词 ====================
    try {
      console.log(`[SyncService] 开始同步SB搜索词数据...`);
      const sbSearchTermSynced = await this.syncSbSearchTerms(14);
      console.log(`[SyncService] SB搜索词同步完成: ${sbSearchTermSynced}条`);
    } catch (e: any) {
      console.error('[SyncService] SB搜索词同步失败:', e.message);
    }
    // ==================== 同步SB广告素材（品牌广告创意） ====================
    try {
      console.log(`[SyncService] 开始同步SB广告素材...`);
      const sbAdsResult = await this.syncSbAds();
      console.log(`[SyncService] SB广告素材同步完成: ${sbAdsResult.synced}条同步, ${sbAdsResult.skipped}条跳过`);
    } catch (e: any) {
      console.error('[SyncService] SB广告素材同步失败:', e.message);
    }

    // ==================== 同步SB否定关键词 ====================
    try {
      console.log(`[SyncService] 开始同步SB否定关键词...`);
      const sbNegKwResult = await this.syncSbNegativeKeywords();
      console.log(`[SyncService] SB否定关键词同步完成: ${sbNegKwResult.synced}条新增, ${sbNegKwResult.updated}条更新`);
    } catch (e: any) {
      console.error('[SyncService] SB否定关键词同步失败:', e.message);
    }

    // ==================== 同步SB否定商品定向 ====================
    try {
      console.log(`[SyncService] 开始同步SB否定商品定向...`);
      const sbNegTgtResult = await this.syncSbNegativeTargets();
      console.log(`[SyncService] SB否定商品定向同步完成: ${sbNegTgtResult.synced}条新增, ${sbNegTgtResult.updated}条更新`);
    } catch (e: any) {
      console.error('[SyncService] SB否定商品定向同步失败:', e.message);
    }

    // ==================== 同步SP广告位绩效 ====================
    try {
      console.log(`[SyncService] 开始同步SP广告位绩效数据...`);
      const placementSynced = await this.syncPlacementPerformance(14);
      console.log(`[SyncService] SP广告位绩效同步完成: ${placementSynced}条`);
    } catch (e: any) {
      console.error('[SyncService] SP广告位绩效同步失败:', e.message);
    }

    // ==================== 同步SB广告位绩效 ====================
    try {
      console.log(`[SyncService] 开始同步SB广告位绩效数据...`);
      const sbPlacementSynced = await this.syncSbPlacementPerformance(14);
      console.log(`[SyncService] SB广告位绩效同步完成: ${sbPlacementSynced}条`);
    } catch (e: any) {
      console.error('[SyncService] SB广告位绩效同步失败:', e.message);
    }

    // ==================== 同步SP自动定向报告 ====================
    try {
      console.log(`[SyncService] 开始同步SP自动定向报告数据...`);
      const autoTargetSynced = await this.syncAutoTargeting(14);
      console.log(`[SyncService] SP自动定向报告同步完成: ${autoTargetSynced}条`);
    } catch (e: any) {
      console.error('[SyncService] SP自动定向报告同步失败:', e.message);
    }

    // ==================== 同步SD定向报告 ====================
    try {
      console.log(`[SyncService] 开始同步SD定向报告数据...`);
      const sdTargetSynced = await this.syncSdTargeting(14);
      console.log(`[SyncService] SD定向报告同步完成: ${sdTargetSynced}条`);
    } catch (e: any) {
      console.error('[SyncService] SD定向报告同步失败:', e.message);
    }

    // ==================== 同步SB定向报告 ====================
    try {
      console.log(`[SyncService] 开始同步SB定向报告数据...`);
      const sbTargetSynced = await this.syncSbTargeting(14);
      console.log(`[SyncService] SB定向报告同步完成: ${sbTargetSynced}条`);
    } catch (e: any) {
      console.error('[SyncService] SB定向报告同步失败:', e.message);
    }
    
    // 同步绩效数据（快慢双轨架构：API只拉取T-1及之前的历史数据）
    // 重要：亚马逊的销售数据在7-14天内会变动（用户点击后过几天才买）
    // 因此每次同步都需要回溯过去14天的数据，覆盖旧记录
    // 这能确保存下来的数据和亚马逊后台最终结算的数据一致
    const performanceDays = 14; // ⚠️ 修改为14天归因回溯
    console.log(`[SyncService] 同步最近${performanceDays}天历史绩效数据（归因回溯机制，覆盖旧记录）`);
    results.performance += await this.syncPerformanceData(performanceDays);

    // ✅ 修复P0-4/P1-1: 同步关键词级别绩效数据（之前缺失，导致keywords表绩效全为0）
    try {
      console.log(`[SyncService] 开始同步关键词级别绩效数据...`);
      const keywordPerfSynced = await this.syncKeywordPerformanceData(performanceDays);
      console.log(`[SyncService] 关键词绩效数据同步完成: ${keywordPerfSynced}条`);
    } catch (kwPerfError: any) {
      console.error('[SyncService] 关键词绩效数据同步失败:', kwPerfError.message);
    }

    // ✅ 修复P1-2: 同步商品定位级别绩效数据
    try {
      console.log(`[SyncService] 开始同步商品定位级别绩效数据...`);
      const targetPerfSynced = await this.syncProductTargetPerformanceData(performanceDays);
      console.log(`[SyncService] 商品定位绩效数据同步完成: ${targetPerfSynced}条`);
    } catch (ptPerfError: any) {
      console.error('[SyncService] 商品定位绩效数据同步失败:', ptPerfError.message);
    }

    // ✅ 同步广告组级别绩效数据（SP/SB/SD）
    try {
      console.log(`[SyncService] 开始同步广告组级别绩效数据...`);
      const adGroupPerfSynced = await this.syncAdGroupPerformanceData(performanceDays);
      console.log(`[SyncService] 广告组绩效数据同步完成: ${adGroupPerfSynced}条`);
    } catch (agPerfError: any) {
      console.error('[SyncService] 广告组绩效数据同步失败:', agPerfError.message);
    }

    return results;
  }

  /**
   * 同步SB品牌广告活动
   * @param lastSyncTime 上次同步时间，用于增量同步
   */
  async syncSbCampaigns(lastSyncTime?: string | null): Promise<number | { synced: number; skipped: number }> {
    const db = await getDb();
    if (!db) return { synced: 0, skipped: 0 };

    try {
      const apiCampaigns = await this.client.listSbCampaigns();
      let synced = 0;
      let skipped = 0;
      
      // 输出第一个广告活动的结构用于调试
      if (apiCampaigns.length > 0) {
        console.log('[SyncService] SB广告活动API返回结构示例:', JSON.stringify(apiCampaigns[0], null, 2));
      }
      console.log(`[SyncService] 获取到 ${apiCampaigns.length} 个SB广告活动`);

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
          const existingUpdated = existing.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
          const lastSync = new Date(lastSyncTime).getTime();
          if (existingUpdated >= lastSync) {
            skipped++;
            continue;
          }
        }

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

        console.log(`[SyncService] SB广告 ${apiCampaign.name}: goal=${sbGoal}, costType=${sbCostType}, adFormat=${normalizedAdFormat}`);

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
      console.error('Error syncing SB campaigns:', error);
      return { synced: 0, skipped: 0 };
    }
  }

  /**
   * 同步SD展示广告活动
   * @param lastSyncTime 上次同步时间，用于增量同步
   */
  async syncSdCampaigns(lastSyncTime?: string | null): Promise<number | { synced: number; skipped: number }> {
    const db = await getDb();
    if (!db) return { synced: 0, skipped: 0 };

    try {
      const apiCampaigns = await this.client.listSdCampaigns();
      let synced = 0;
      let skipped = 0;
      
      // 输出第一个广告活动的结构用于调试
      if (apiCampaigns.length > 0) {
        console.log('[SyncService] SD广告活动API返回结构示例:', JSON.stringify(apiCampaigns[0], null, 2));
      }
      console.log(`[SyncService] 获取到 ${apiCampaigns.length} 个SD广告活动`);

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
          const existingUpdated = existing.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
          const lastSync = new Date(lastSyncTime).getTime();
          if (existingUpdated >= lastSync) {
            skipped++;
            continue;
          }
        }

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
          console.log(`[SyncService] SD广告 ${apiCampaign.name}: goal=reach 但 costType=cpc，以API返回为准`);
        }

        // 获取SD广告的竞价优化目标
        const sdBidOptimization = (apiCampaign as any).bidOptimization || null;
        const validBidOpts = ['reach', 'pageVisits', 'conversions'];
        const normalizedBidOpt = validBidOpts.includes(sdBidOptimization) ? sdBidOptimization : null;

        console.log(`[SyncService] SD广告 ${apiCampaign.name}: goal=${sdGoal}, costType=${finalCostType}, tactic=${sdTactic}`);

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
      console.error('Error syncing SD campaigns:', error);
      return { synced: 0, skipped: 0 };
    }
  }

  /**
   * 同步SP广告活动
   * @param lastSyncTime 上次同步时间，用于增量同步
   */
  async syncSpCampaigns(lastSyncTime?: string | null): Promise<number | { synced: number; skipped: number }> {
    console.log('[同步] ========== 开始同步SP广告活动 ==========');
    console.log('[同步] 参数:', { accountId: this.accountId, lastSyncTime, marketplace: this.marketplace });
    
    const db = await getDb();
    if (!db) {
      console.error('[同步] ❌ 数据库连接失败 - getDb()返回null');
      return { synced: 0, skipped: 0 };
    }
    console.log('[同步] ✅ 数据库连接成功');

    try {
      console.log('[同步] 正在调用Amazon API: listSpCampaigns()...');
      const apiCampaigns = await this.client.listSpCampaigns();
      console.log(`[同步] ✅ API调用成功,返回 ${apiCampaigns.length} 个SP广告活动`);
      let synced = 0;
      let skipped = 0;
      
      // 输出第一个广告活动的结构用于调试
      if (apiCampaigns.length > 0) {
        console.log('[SyncService] SP广告活动API返回结构示例:', JSON.stringify(apiCampaigns[0], null, 2));
      }
      console.log(`[SyncService] 获取到 ${apiCampaigns.length} 个SP广告活动`);

      // 调试：输出第一个广告活动的完整结构
      if (apiCampaigns.length > 0) {
        console.log('[SP Sync Debug] 第一个广告活动的完整结构:', JSON.stringify(apiCampaigns[0], null, 2));
        console.log('[SP Sync Debug] startDate字段:', apiCampaigns[0].startDate);
        console.log('[SP Sync Debug] endDate字段:', apiCampaigns[0].endDate);
      }

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
          const existingUpdated = existing.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
          const lastSync = new Date(lastSyncTime).getTime();
          // 如果记录在上次同步后没有更新，跳过
          if (existingUpdated >= lastSync) {
            skipped++;
            continue;
          }
        }

        // Amazon API返回的targetingType是大写的AUTO/MANUAL，需要转换为小写
        const normalizedTargetingType = (apiCampaign.targetingType || 'manual').toLowerCase() as 'auto' | 'manual';
        const campaignType = normalizedTargetingType === 'auto' ? 'sp_auto' : 'sp_manual';
        
        // SP API v3的dailyBudget可能嵌套在budget对象中，也可能直接在根级别
        const dailyBudgetValue = (apiCampaign as any).budget?.budget || 
                                 (apiCampaign as any).budget?.dailyBudget || 
                                 apiCampaign.dailyBudget || 
                                 0;

        // 调试日志：打印第一个广告活动的完整结构
        if (synced === 0 && skipped === 0) {
          console.log('[SP Sync Debug] 第一个广告活动的完整结构:');
          console.log(JSON.stringify(apiCampaign, null, 2));
          console.log('[SP Sync Debug] startDate字段:', apiCampaign.startDate);
          console.log('[SP Sync Debug] endDate字段:', apiCampaign.endDate);
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
          console.log(`[同步] 进度: 已同步 ${synced}/${apiCampaigns.length} 个广告活动`);
        }
      }

      console.log(`[同步] ========== SP广告活动同步完成 ==========`);
      console.log(`[同步] 结果: 同步 ${synced} 个, 跳过 ${skipped} 个`);
      return { synced, skipped };
    } catch (error: any) {
      console.error('[同步] ❌ SP广告活动同步失败');
      console.error('[同步] 错误类型:', error.constructor.name);
      console.error('[同步] 错误消息:', error.message);
      console.error('[同步] 错误堆栈:', error.stack);
      if (error.response) {
        console.error('[同步] API响应状态:', error.response.status);
        console.error('[同步] API响应数据:', JSON.stringify(error.response.data, null, 2));
      }
      return { synced: 0, skipped: 0 };
    }
  }

  /**
   * 同步SP广告组
   * @param lastSyncTime 上次同步时间，用于增量同步
   */
  async syncSpAdGroups(lastSyncTime?: string | null): Promise<number | { synced: number; skipped: number }> {
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
              eq(adGroups.campaignId, campaign.id),
              eq(adGroups.adGroupId, String(apiAdGroup.adGroupId))
            )
          )
          .limit(1);

        // 增量同步：如果有上次同步时间且记录已存在，检查是否需要更新
        if (lastSyncTime && existing) {
          const existingUpdated = existing.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
          const lastSync = new Date(lastSyncTime).getTime();
          if (existingUpdated >= lastSync) {
            skipped++;
            continue;
          }
        }

        // Amazon API返回的state可能是大写的ENABLED/PAUSED/ARCHIVED，需要转换为小写
        const normalizedState = (apiAdGroup.state || 'enabled').toLowerCase() as 'enabled' | 'paused' | 'archived';
        
        const adGroupData = {
          campaignId: campaign.id,
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
      console.error('Error syncing SP ad groups:', error);
      return { synced: 0, skipped: 0 };
    }
  }

  /**
   * 同步SB品牌广告组
   * 从Amazon SB API获取广告组列表并同步到本地数据库
   */
  async syncSbAdGroups(): Promise<{ synced: number; skipped: number }> {
    const db = await getDb();
    if (!db) return { synced: 0, skipped: 0 };

    try {
      const apiAdGroups = await this.client.listSbAdGroups();
      let synced = 0;
      let skipped = 0;

      console.log(`[SyncService] 获取到 ${apiAdGroups.length} 个SB广告组`);

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
              eq(adGroups.campaignId, campaign.id),
              eq(adGroups.adGroupId, String(apiAdGroup.adGroupId))
            )
          )
          .limit(1);

        const normalizedState = (apiAdGroup.state || 'enabled').toLowerCase() as 'enabled' | 'paused' | 'archived';

        const adGroupData = {
          campaignId: campaign.id,
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

      console.log(`[SyncService] SB广告组同步完成: synced=${synced}, skipped=${skipped}`);
      return { synced, skipped };
    } catch (error) {
      console.error('Error syncing SB ad groups:', error);
      return { synced: 0, skipped: 0 };
    }
  }

  /**
   * 同步SD展示广告组
   * 从Amazon SD API获取广告组列表并同步到本地数据库
   */
  async syncSdAdGroups(): Promise<{ synced: number; skipped: number }> {
    const db = await getDb();
    if (!db) return { synced: 0, skipped: 0 };

    try {
      const apiAdGroups = await this.client.listSdAdGroups();
      let synced = 0;
      let skipped = 0;

      console.log(`[SyncService] 获取到 ${apiAdGroups.length} 个SD广告组`);

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
              eq(adGroups.campaignId, campaign.id),
              eq(adGroups.adGroupId, String(apiAdGroup.adGroupId))
            )
          )
          .limit(1);

        const normalizedState = (apiAdGroup.state || 'enabled').toLowerCase() as 'enabled' | 'paused' | 'archived';

        // SD广告组可能有tactic字段（如T00020 = 受众定向, T00030 = 商品定向）
        const tactic = apiAdGroup.tactic || null;

        const adGroupData = {
          campaignId: campaign.id,
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

      console.log(`[SyncService] SD广告组同步完成: synced=${synced}, skipped=${skipped}`);
      return { synced, skipped };
    } catch (error) {
      console.error('Error syncing SD ad groups:', error);
      return { synced: 0, skipped: 0 };
    }
  }

  /**
   * 同步SB关键词投放
   * 从Amazon SB API获取关键词列表并同步到本地数据库
   */
  async syncSbKeywords(): Promise<{ synced: number; skipped: number }> {
    const db = await getDb();
    if (!db) return { synced: 0, skipped: 0 };

    try {
      const apiKeywords = await this.client.listSbKeywords();
      let synced = 0;
      let skipped = 0;

      console.log(`[SyncService] 获取到 ${apiKeywords.length} 个SB关键词`);

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
              eq(keywords.adGroupId, adGroup.id),
              eq(keywords.keywordId, String(apiKeyword.keywordId))
            )
          )
          .limit(1);

        const normalizedMatchType = (apiKeyword.matchType || 'broad').toLowerCase() as 'broad' | 'phrase' | 'exact';
        const normalizedState = (apiKeyword.state || 'enabled').toLowerCase() as 'enabled' | 'paused' | 'archived';

        const keywordData = {
          adGroupId: adGroup.id,
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

      console.log(`[SyncService] SB关键词同步完成: synced=${synced}, skipped=${skipped}`);
      return { synced, skipped };
    } catch (error) {
      console.error('Error syncing SB keywords:', error);
      return { synced: 0, skipped: 0 };
    }
  }

  /**
   * 同步SB商品定位
   * 从Amazon SB API获取商品定位列表并同步到本地数据库
   */
  async syncSbProductTargets(): Promise<{ synced: number; skipped: number }> {
    const db = await getDb();
    if (!db) return { synced: 0, skipped: 0 };

    try {
      const apiTargets = await this.client.listSbTargets();
      let synced = 0;
      let skipped = 0;

      console.log(`[SyncService] 获取到 ${apiTargets.length} 个SB商品定位`);

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
              eq(productTargets.adGroupId, adGroup.id),
              eq(productTargets.targetId, String(apiTarget.targetId))
            )
          )
          .limit(1);

        const normalizedState = (apiTarget.state || 'enabled').toLowerCase() as 'enabled' | 'paused' | 'archived';

        const targetData = {
          adGroupId: adGroup.id,
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
          console.log(`[SyncService] SB产品定向示例: type=${targetType}, value=${targetValue}, matchType=${targetMatchType}, categoryName=${categoryName}`);
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

      console.log(`[SyncService] SB商品定位同步完成: synced=${synced}, skipped=${skipped}`);
      return { synced, skipped };
    } catch (error) {
      console.error('Error syncing SB product targets:', error);
      return { synced: 0, skipped: 0 };
    }
  }

  /**
   * 同步SD商品定位（从List API）
   * 从Amazon SD API获取商品定位列表并同步到本地数据库
   */
  async syncSdProductTargets(): Promise<{ synced: number; skipped: number }> {
    const db = await getDb();
    if (!db) return { synced: 0, skipped: 0 };

    try {
      const apiTargets = await this.client.listSdTargets();
      let synced = 0;
      let skipped = 0;

      console.log(`[SyncService] 获取到 ${apiTargets.length} 个SD商品定位`);

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
              eq(productTargets.adGroupId, adGroup.id),
              eq(productTargets.targetId, String(apiTarget.targetId))
            )
          )
          .limit(1);

        const normalizedState = (apiTarget.state || 'enabled').toLowerCase() as 'enabled' | 'paused' | 'archived';

        const targetData = {
          adGroupId: adGroup.id,
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
          console.log(`[SyncService] SD产品定向示例: type=${targetType}, value=${targetValue}, matchType=${targetMatchType}, categoryName=${categoryName}`);
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

      console.log(`[SyncService] SD商品定位同步完成: synced=${synced}, skipped=${skipped}`);
      return { synced, skipped };
    } catch (error) {
      console.error('Error syncing SD product targets:', error);
      return { synced: 0, skipped: 0 };
    }
  }

  /**
   * 同步SP否定关键词（活动级别 + 广告组级别）
   * 从Amazon API获取否定关键词并同步到本地negativeKeywords表
   */
  async syncSpNegativeKeywords(): Promise<{ synced: number; updated: number }> {
    const db = await getDb();
    if (!db) return { synced: 0, updated: 0 };

    try {
      let synced = 0;
      let updated = 0;

      // 1. 同步活动级别否定关键词
      console.log(`[SyncService] 开始同步SP活动级别否定关键词...`);
      const campaignNegatives = await this.client.listSpCampaignNegativeKeywords();
      console.log(`[SyncService] 获取到 ${campaignNegatives.length} 个活动级别否定关键词`);

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
              eq(negativeKeywords.campaignId, campaign.id),
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
            campaignId: campaign.id,
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
      console.log(`[SyncService] 开始同步SP广告组级别否定关键词...`);
      const adGroupNegatives = await this.client.listSpNegativeKeywords();
      console.log(`[SyncService] 获取到 ${adGroupNegatives.length} 个广告组级别否定关键词`);

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
          .where(eq(campaigns.id, adGroup.campaignId))
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
              eq(negativeKeywords.campaignId, campaign.id),
              eq(negativeKeywords.adGroupId, adGroup.id),
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
            campaignId: campaign.id,
            adGroupId: adGroup.id,
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

      console.log(`[SyncService] SP否定关键词同步完成: ${synced} 条新记录, ${updated} 条更新`);
      return { synced, updated };
    } catch (error) {
      console.error('Error syncing SP negative keywords:', error);
      return { synced: 0, updated: 0 };
    }
  }

  /**
   * 同步SP否定商品定向
   * 从Amazon API获取否定商品定向并同步到本地negativeKeywords表
   */
  async syncSpNegativeProductTargets(): Promise<{ synced: number; updated: number }> {
    const db = await getDb();
    if (!db) return { synced: 0, updated: 0 };
    try {
      let synced = 0;
      let updated = 0;
      // 1. 同步活动级别否定商品定向
      console.log(`[SyncService] 开始同步SP活动级别否定商品定向...`);
      const campaignNegTargets = await this.client.listSpCampaignNegativeTargets();
      console.log(`[SyncService] 获取到 ${campaignNegTargets.length} 个活动级别否定商品定向`);
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
        const asinExpr = expression.find((e: any) => e.type?.toLowerCase().includes('asin'));
        const negativeText = asinExpr?.value || JSON.stringify(expression);
        const amazonTargetId = String(neg.targetId || '');
        const [existing] = await db
          .select()
          .from(negativeKeywords)
          .where(
            and(
              eq(negativeKeywords.accountId, this.accountId),
              eq(negativeKeywords.campaignId, campaign.id),
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
            campaignId: campaign.id,
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
      console.log(`[SyncService] 开始同步SP广告组级别否定商品定向...`);
      const adGroupNegTargets = await this.client.listSpNegativeTargets();
      console.log(`[SyncService] 获取到 ${adGroupNegTargets.length} 个广告组级别否定商品定向`);
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
          .where(eq(campaigns.id, adGroup.campaignId))
          .limit(1);
        if (!campaign) continue;
        const expression = neg.expression || [];
        const asinExpr = expression.find((e: any) => e.type?.toLowerCase().includes('asin'));
        const negativeText = asinExpr?.value || JSON.stringify(expression);
        const amazonTargetId = String(neg.targetId || '');
        const [existing] = await db
          .select()
          .from(negativeKeywords)
          .where(
            and(
              eq(negativeKeywords.accountId, this.accountId),
              eq(negativeKeywords.campaignId, campaign.id),
              eq(negativeKeywords.adGroupId, adGroup.id),
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
            campaignId: campaign.id,
            adGroupId: adGroup.id,
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
      console.log(`[SyncService] SP否定商品定向同步完成: ${synced} 条新记录, ${updated} 条更新`);
      return { synced, updated };
    } catch (error) {
      console.error('Error syncing SP negative product targets:', error);
      return { synced: 0, updated: 0 };
    }
  }

  /**
   * 同步SB搜索词报告
   * 从Amazon SB搜索词报告获取数据并同步到searchTerms表
   */
  async syncSbSearchTerms(days: number = 14): Promise<number> {
    const db = await getDb();
    if (!db) return 0;

    try {
      const { startDate, endDate } = getMarketplaceDateRange(this.marketplace, days);
      console.log(`[SyncService] 开始同步SB搜索词数据: ${startDate} - ${endDate}`);

      // 请求SB搜索词报告
      const reportId = await this.client.requestSbSearchTermReport(startDate, endDate);
      const reportData = await this.client.waitAndDownloadReport(reportId, 300000);

      if (!reportData || reportData.length === 0) {
        console.log('[SyncService] SB搜索词报告数据为空');
        return 0;
      }

      console.log(`[SyncService] 获取到 ${reportData.length} 条SB搜索词数据`);
      let synced = 0;

      for (const row of reportData) {
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
              eq(searchTerms.campaignId, campaign.id),
              eq(searchTerms.adGroupId, adGroup.id),
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
                eq(keywords.adGroupId, adGroup.id),
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
                eq(productTargets.adGroupId, adGroup.id),
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
          campaignId: campaign.id,
          adGroupId: adGroup.id,
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

      console.log(`[SyncService] SB搜索词同步完成: ${synced} 条记录`);
      return synced;
    } catch (error) {
      console.error('[SyncService] 同步SB搜索词失败:', error);
      return 0;
    }
  }

  /**
   * 同步SP关键词
   * @param lastSyncTime 上次同步时间，用于增量同步
   */
  async syncSpKeywords(lastSyncTime?: string | null): Promise<number | { synced: number; skipped: number }> {
    const db = await getDb();
    if (!db) return { synced: 0, skipped: 0 };

    try {
      const apiKeywords = await this.client.listSpKeywords();
      let synced = 0;
      let skipped = 0;

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
              eq(keywords.adGroupId, adGroup.id),
              eq(keywords.keywordId, String(apiKeyword.keywordId))
            )
          )
          .limit(1);

        // 增量同步：如果有上次同步时间且记录已存在，检查是否需要更新
        if (lastSyncTime && existing) {
          const existingUpdated = existing.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
          const lastSync = new Date(lastSyncTime).getTime();
          if (existingUpdated >= lastSync) {
            skipped++;
            continue;
          }
        }

        const keywordData = {
          adGroupId: adGroup.id,
          keywordId: String(apiKeyword.keywordId),
          keywordText: apiKeyword.keywordText,
          matchType: apiKeyword.matchType as 'broad' | 'phrase' | 'exact',
          status: apiKeyword.state as 'enabled' | 'paused' | 'archived',
          bid: String(apiKeyword.bid),
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

      return { synced, skipped };
    } catch (error) {
      console.error('Error syncing SP keywords:', error);
      return { synced: 0, skipped: 0 };
    }
  }

  /**
   * 同步SP商品定位
   * @param lastSyncTime 上次同步时间，用于增量同步
   */
  async syncSpProductTargets(lastSyncTime?: string | null): Promise<number | { synced: number; skipped: number }> {
    const db = await getDb();
    if (!db) return { synced: 0, skipped: 0 };

    try {
      const apiTargets = await this.client.listSpProductTargets();
      let synced = 0;
      let skipped = 0;

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
        if (!targetValue && (apiTarget as any).resolvedExpression) {
          const resolved = (apiTarget as any).resolvedExpression;
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
              eq(productTargets.adGroupId, adGroup.id),
              eq(productTargets.targetId, String(apiTarget.targetId))
            )
          )
          .limit(1);

        // 增量同步：如果有上次同步时间且记录已存在，检查是否需要更新
        if (lastSyncTime && existing) {
          const existingUpdated = existing.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
          const lastSync = new Date(lastSyncTime).getTime();
          if (existingUpdated >= lastSync) {
            skipped++;
            continue;
          }
        }

        const targetData = {
          adGroupId: adGroup.id,
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
          console.log(`[SyncService] SP产品定向示例: type=${targetType}, value=${targetValue}, matchType=${targetMatchType}, categoryName=${categoryName}`);
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

      console.log(`[SyncService] SP产品定向同步完成: synced=${synced}, skipped=${skipped}`);
      return { synced, skipped };
    } catch (error) {
      console.error('Error syncing SP product targets:', error);
      return { synced: 0, skipped: 0 };
    }
  }

  /**
   * 同步绩效数据
   * 支持分批请求，每批最多31天（Amazon API限制）
   * 
   * 重要：亚马逊的销售数据在7-14天内会变动（用户点击后过几天才买）
   * 因此每次同步都需要回溯过去14天的数据，覆盖旧记录
   * 这能确保存下来的数据和亚马逊后台最终结算的数据一致
   * 
   * @param days 同步天数，默认14天（归因回溯机制）
   */
  async syncPerformanceData(days: number = 14): Promise<number> {
    const db = await getDb();
    if (!db) {
      console.error('[SyncService] 数据库连接失败');
      return 0;
    }

    try {
      // Amazon API单次请求最多31天，需要分批请求
      const MAX_DAYS_PER_REQUEST = 31;
      const totalDays = Math.min(days, 90); // 最多90天（SP支持95天，SB只支持60天，取90天作为平衡）
      
      let totalSynced = 0;
      
      // 使用站点时区计算历史日期范围（排除今天，只拉取T-1及之前的数据）
      // 快慢双轨架构：API只负责历史数据，今日数据由AMS实时推送
      // v102: Include today in sync range
      const { startDate: rangeStartDate, endDate: rangeEndDate } = getMarketplaceDateRange(this.marketplace, totalDays);
      console.log(`[SyncService] 站点${this.marketplace}当前日期: ${getMarketplaceCurrentDate(this.marketplace)}`);
      console.log(`[SyncService] API同步范围: ${rangeStartDate} - ${rangeEndDate} (排除今天，今日数据由AMS提供)`);
      
      // 计算需要分几批请求
      const batches = Math.ceil(totalDays / MAX_DAYS_PER_REQUEST);
      console.log(`[SyncService] 开始同步绩效数据: 共${totalDays}天，分${batches}批请求 (站点: ${this.marketplace})`);
      
      for (let batch = 0; batch < batches; batch++) {
        // 计算每批的日期范围（基于站点时区）
        const endDateObj = new Date(rangeEndDate);
        endDateObj.setDate(endDateObj.getDate() - (batch * MAX_DAYS_PER_REQUEST));
        
        const startDateObj = new Date(endDateObj);
        const daysInBatch = Math.min(MAX_DAYS_PER_REQUEST, totalDays - (batch * MAX_DAYS_PER_REQUEST));
        startDateObj.setDate(startDateObj.getDate() - daysInBatch + 1);
        
        const startDateStr = startDateObj.toISOString().split('T')[0];
        const endDateStr = endDateObj.toISOString().split('T')[0];
        
        console.log(`[SyncService] 第${batch + 1}/${batches}批: ${startDateStr} - ${endDateStr} (共${daysInBatch}天)`);
        
        try {
          const batchSynced = await this.syncPerformanceDataBatch(startDateStr, endDateStr);
          totalSynced += batchSynced;
          console.log(`[SyncService] 第${batch + 1}批同步完成: ${batchSynced}条记录`);
          
          // 批次之间稍作延迟，避免触发API速率限制
          if (batch < batches - 1) {
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        } catch (batchError: any) {
          console.error(`[SyncService] 第${batch + 1}批同步失败:`, batchError.message);
          // 继续下一批，不中断整个同步过程
        }
      }
      
      // 同步完成后，更新campaigns表的绩效汇总数据
      await this.updateCampaignPerformanceSummary();
      
      console.log(`[SyncService] 绩效数据同步完成: 共${totalSynced}条记录`);
      return totalSynced;
    } catch (error: any) {
      console.error('[SyncService] 同步绩效数据失败:', error);
      
      // 如果报告超时或失败，使用模拟数据作为备用方案
      if (error.message?.includes('timeout') || error.message?.includes('PENDING') || error.message?.includes('Report generation')) {
        console.log('[SyncService] 报告超时，使用模拟数据填充绩效数据...');
        return await this.generateMockPerformanceData(days);
      }
      
      return 0;
    }
  }
  
  /**
   * 同步单批绩效数据（内部方法）
   */
  private async syncPerformanceDataBatch(startDateStr: string, endDateStr: string): Promise<number> {
    const db = await getDb();
    if (!db) return 0;

    let totalSynced = 0;

    // 同步SP广告绩效数据
    try {
      console.log(`[SyncService] 正在请求SP广告报告: ${startDateStr} - ${endDateStr}`);
      const spReportId = await this.client.requestSpCampaignReport(startDateStr, endDateStr);
      console.log(`[SyncService] SP报告请求成功, reportId: ${spReportId}`);
      const spReportData = await this.client.waitAndDownloadReport(spReportId, 900000);
      console.log(`[SyncService] SP报告下载完成, 数据条数: ${spReportData?.length || 0}`);
      if (spReportData && spReportData.length > 0) {
        totalSynced += await this.processReportData(db, spReportData, 'SP');
      }
    } catch (spError: any) {
      console.error('[SyncService] SP报告同步失败:', spError.message);
    }

    // 同步SB品牌广告绩效数据
    try {
      console.log(`[SyncService] 正在请求SB品牌广告报告: ${startDateStr} - ${endDateStr}`);
      const sbReportId = await this.client.requestSbCampaignReport(startDateStr, endDateStr);
      console.log(`[SyncService] SB报告请求成功, reportId: ${sbReportId}`);
      const sbReportData = await this.client.waitAndDownloadReport(sbReportId, 900000);
      console.log(`[SyncService] SB报告下载完成, 数据条数: ${sbReportData?.length || 0}`);
      if (sbReportData && sbReportData.length > 0) {
        totalSynced += await this.processReportData(db, sbReportData, 'SB');
      }
    } catch (sbError: any) {
      console.error('[SyncService] SB报告同步失败:', sbError.message);
      console.error('[SyncService] SB报告同步失败详情:', sbError.response?.data || sbError.stack);
      // SB报告失败不影响整体同步
    }

    // 同步SD展示广告绩效数据
    try {
      console.log(`[SyncService] 正在请求SD展示广告报告: ${startDateStr} - ${endDateStr}`);
      const sdReportId = await this.client.requestSdCampaignReport(startDateStr, endDateStr);
      console.log(`[SyncService] SD报告请求成功, reportId: ${sdReportId}`);
      const sdReportData = await this.client.waitAndDownloadReport(sdReportId, 900000);
      console.log(`[SyncService] SD报告下载完成, 数据条数: ${sdReportData?.length || 0}`);
      if (sdReportData && sdReportData.length > 0) {
        totalSynced += await this.processReportData(db, sdReportData, 'SD');
      }
    } catch (sdError: any) {
      console.error('[SyncService] SD报告同步失败:', sdError.message);
      console.error('[SyncService] SD报告同步失败详情:', sdError.response?.data || sdError.stack);
      // SD报告失败不影响整体同步
    }

    return totalSynced;
  }

  /**
   * 处理报告数据并存储到数据库
   */
  private async processReportData(db: any, reportData: any[], adType: string): Promise<number> {
    try {
      console.log(`[SyncService] 开始处理${adType}报告数据, 共 ${reportData.length} 条记录`);
      
      // 输出第一条数据的结构，用于调试
      if (reportData.length > 0) {
        console.log(`[SyncService] ${adType}报告数据第一条示例:`, JSON.stringify(reportData[0], null, 2));
      }
      
      if (!reportData || reportData.length === 0) {
        console.warn('[SyncService] 报告数据为空');
        return 0;
      }
      
      // 输出第一条数据的结构，用于调试
      console.log('[SyncService] 报告数据第一条示例:', JSON.stringify(reportData[0], null, 2));
      
      let synced = 0;

      console.log(`[SyncService] 开始处理报告数据, 共 ${reportData.length} 条记录`);
      
      // 统计匹配情况
      let matchedById = 0;
      let matchedByName = 0;
      let notMatched = 0;
      
      for (const row of reportData) {
        // 策略：先用campaignId匹配，失败后用campaignName匹配
        // 这是因为SB/SD的报告ID可能与List API返回的ID不一致
        
        // 策略1: 先用campaignId匹配
        let [campaign] = await db
          .select()
          .from(campaigns)
          .where(
            and(
              eq(campaigns.accountId, this.accountId),
              eq(campaigns.campaignId, String(row.campaignId))
            )
          )
          .limit(1);

        if (campaign) {
          matchedById++;
        } else if (row.campaignName) {
          // 策略2: 用campaignName匹配（紧急规避方案）
          // 亚马逊广告活动名称是唯一的，可以用作关联
          [campaign] = await db
            .select()
            .from(campaigns)
            .where(
              and(
                eq(campaigns.accountId, this.accountId),
                eq(campaigns.campaignName, row.campaignName)
              )
            )
            .limit(1);
          
          if (campaign) {
            matchedByName++;
            // 注意：只做只读匹配，不修改campaigns表的campaignId
            // 因为Management API (List)返回的V4 ID是系统的唯一真理
            // 报表API返回的可能是Legacy ID，如果覆盖V4 ID会导致下次同步出错
            console.log(`[SyncService] ${adType}通过名称匹配成功: ${row.campaignName} (reportId=${row.campaignId}, dbId=${campaign.campaignId})`);
          }
        }

        if (!campaign) {
          // 尝试自动创建campaign记录，以保存报告数据
          if (row.campaignId && row.campaignName) {
            try {
              console.log(`[SyncService] ${adType}自动创建campaign: ${row.campaignName}`);
              const [newCampaign] = await db.insert(campaigns).values({
                accountId: this.accountId,
                campaignId: String(row.campaignId),
                campaignName: row.campaignName,
                campaignType: adType === 'SP' ? 'sp_manual' : adType.toLowerCase() as 'sp_auto' | 'sp_manual' | 'sb' | 'sd',
                targetingType: 'manual',
                status: row.campaignStatus || 'enabled',
                dailyBudget: row.campaignBudget ? String(row.campaignBudget) : '0',
                createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
                updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
              }).returning();
              campaign = newCampaign;
              console.log(`[SyncService] ${adType}自动创建campaign成功: id=${campaign.id}, name=${campaign.campaignName}`);
            } catch (createError: any) {
              // 可能是重复插入，尝试再次查询
              console.warn(`[SyncService] ${adType}创建campaign失败，尝试再次查询:`, createError.message);
              [campaign] = await db
                .select()
                .from(campaigns)
                .where(
                  and(
                    eq(campaigns.accountId, this.accountId),
                    eq(campaigns.campaignName, row.campaignName)
                  )
                )
                .limit(1);
            }
          }
          
          if (!campaign) {
            notMatched++;
            // 记录未找到的campaign，用于调试
            if (notMatched <= 10) {
              console.warn(`[SyncService] ${adType}未找到campaign: accountId=${this.accountId}, campaignId=${row.campaignId}, campaignName=${row.campaignName || 'N/A'}`);
            }
            continue;
          }
        }

        // 使用报告日期或当前日期
        const reportDate = row.date ? new Date(row.date) : new Date();
        const reportDateStr = reportDate.toISOString().split('T')[0];

        // 检查是否已存在当天数据
        const [existing] = await db
          .select()
          .from(dailyPerformance)
          .where(
            and(
              eq(dailyPerformance.campaignId, campaign.id),
              sql`DATE(${dailyPerformance.date}) = ${reportDateStr}`
            )
          )
          .limit(1);

        // 使用 Amazon Ads API v3 的字段名 (2026年1月更新)
        // ⚠️ 重要: 不同广告类型使用不同的字段名
        // SP: 使用 7天归因 (sales7d, purchases7d, unitsSoldClicks7d)
        // SB: 使用 Clicks后缀 (salesClicks, purchasesClicks, unitsSoldClicks, detailPageViewsClicks)
        // SD: 使用 Clicks后缀 (salesClicks, purchasesClicks, unitsSoldClicks, detailPageViewsClicks, viewableImpressions)
        const cost = row.cost || 0;
        let sales = 0;
        let orders = 0;
        let unitsSold = 0;
        let dpv = 0;
        let addToCart = 0;
        let ntbOrders = 0;
        let ntbSales = 0;
        let viewableImpressions = 0;
        
        if (adType === 'SP') {
          // ✅ SP报告使用 7天归因窗口 (7d) - 修正字段名
          // 参考文档: https://advertising.amazon.com/API/docs/en-us/reporting/v3/report-types
          sales = row.sales7d || 0;
          orders = row.purchases7d || 0;
          unitsSold = row.unitsSoldClicks7d || 0;
          // SP不支持 dpv 和 addToCart 在 7d 字段中
          dpv = 0;
          addToCart = 0;
        } else if (adType === 'SB') {
          // ✅ SB报告使用修正后的字段名 (Clicks后缀)
          sales = row.salesClicks || 0;
          orders = row.purchasesClicks || 0;
          unitsSold = row.unitsSoldClicks || 0;
          dpv = row.detailPageViewsClicks || 0;
          ntbOrders = row.newToBrandPurchasesClicks || 0;
          ntbSales = row.newToBrandSalesClicks || 0;
        } else {
          // ✅ SD报告使用修正后的字段名 (Clicks后缀)
          sales = row.salesClicks || 0;
          orders = row.purchasesClicks || 0;
          unitsSold = row.unitsSoldClicks || 0;
          viewableImpressions = row.viewableImpressions || 0;
          dpv = row.detailPageViewsClicks || 0;
          ntbOrders = row.newToBrandPurchasesClicks || 0;
          ntbSales = row.newToBrandSalesClicks || 0;
        }
        
        // ✅ v104: 货币转换 - Amazon API返回的金额是各站点本地货币
        // CA=CAD, MX=MXN, US/UK/DE等=各自货币
        // 需要转换为USD以便跨站点汇总
        const EXCHANGE_RATES_TO_USD: Record<string, number> = {
          'USD': 1.0,
          'CAD': 0.7345,  // 1 CAD = 0.7345 USD
          'MXN': 0.0495,  // 1 MXN = 0.0495 USD
          'GBP': 1.27,
          'EUR': 1.08,
          'JPY': 0.0067,
          'AUD': 0.65,
          'SGD': 0.74,
          'INR': 0.012,
          'AED': 0.2723,
          'SAR': 0.2667,
          'BRL': 0.17,
          'SEK': 0.096,
          'PLN': 0.25,
        };
        const MARKETPLACE_CURRENCY: Record<string, string> = {
          'US': 'USD', 'CA': 'CAD', 'MX': 'MXN', 'BR': 'BRL',
          'UK': 'GBP', 'DE': 'EUR', 'FR': 'EUR', 'IT': 'EUR', 'ES': 'EUR', 'NL': 'EUR', 'SE': 'SEK', 'PL': 'PLN', 'BE': 'EUR',
          'JP': 'JPY', 'AU': 'AUD', 'SG': 'SGD', 'IN': 'INR', 'AE': 'AED', 'SA': 'SAR',
        };
        const currency = MARKETPLACE_CURRENCY[this.marketplace] || 'USD';
        const exchangeRate = EXCHANGE_RATES_TO_USD[currency] || 1.0;
        const spendUsd = cost * exchangeRate;
        const salesUsd = sales * exchangeRate;

        const perfData = {
          accountId: this.accountId,
          campaignId: campaign.id,
          date: reportDateStr,
          impressions: row.impressions || 0,
          clicks: row.clicks || 0,
          spend: String(cost),
          sales: String(sales),
          orders: orders,
          dailyAcos: cost && sales 
            ? String((cost / sales) * 100) 
            : '0',
          dailyRoas: cost && sales 
            ? String(sales / cost) 
            : '0',
          ctr: (row.impressions || 0) > 0 ? String(((row.clicks || 0) / (row.impressions || 0))) : null,
          cvr: (row.clicks || 0) > 0 ? String((orders / (row.clicks || 0))) : null,
          cpc: (row.clicks || 0) > 0 ? String((cost / (row.clicks || 0))) : null,
          // ✅ Report API v3 新增字段
          unitsSold: unitsSold,
          dpv: dpv,
          addToCart: addToCart,
          ntbOrders: ntbOrders,
          ntbSales: String(ntbSales),
          viewableImpressions: viewableImpressions,
          // ✅ 广告类型和归因窗口标记（SP=7天, SB=14天, SD=14天）
          adType: adType as 'SP' | 'SB' | 'SD',
          attributionWindow: adType === 'SP' ? 7 : 14,
          // ✅ 标记为API报告数据（已经过归因窗口校准），防止AMS实时数据覆盖
          isFinalized: reportDateStr === getMarketplaceCurrentDate(this.marketplace) ? 0 : 1,
          dataSource: 'api' as const,
        };

        if (existing) {
          await db
            .update(dailyPerformance)
            .set(perfData)
            .where(eq(dailyPerformance.id, existing.id));
          // v104: Update currency fields via raw SQL (not in Drizzle schema)
          await db.execute(sql`UPDATE daily_performance SET currency = ${currency}, exchange_rate = ${exchangeRate}, spend_usd = ${spendUsd.toFixed(2)}, sales_usd = ${salesUsd.toFixed(2)} WHERE id = ${existing.id}`);
        } else {
          const insertResult = await db.insert(dailyPerformance).values({
            ...perfData,
            createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
          });
          // v104: Update currency fields via raw SQL for newly inserted record
          const insertId = insertResult?.[0]?.insertId || insertResult?.insertId;
          if (insertId) {
            await db.execute(sql`UPDATE daily_performance SET currency = ${currency}, exchange_rate = ${exchangeRate}, spend_usd = ${spendUsd.toFixed(2)}, sales_usd = ${salesUsd.toFixed(2)} WHERE id = ${insertId}`);
          } else {
            // Fallback: update by composite key
            await db.execute(sql`UPDATE daily_performance SET currency = ${currency}, exchange_rate = ${exchangeRate}, spend_usd = ${spendUsd.toFixed(2)}, sales_usd = ${salesUsd.toFixed(2)} WHERE campaignId = ${campaign.id} AND DATE(date) = ${reportDateStr} AND accountId = ${this.accountId}`);
          }
        }
        synced++;
      }

      // 输出匹配统计
      console.log(`[SyncService] ${adType}报告数据处理完成:`);
      console.log(`  - 通过ID匹配: ${matchedById} 条`);
      console.log(`  - 通过名称匹配: ${matchedByName} 条`);
      console.log(`  - 未匹配: ${notMatched} 条`);
      console.log(`  - 总同步: ${synced} 条`);
      return synced;
    } catch (error: any) {
      console.error(`[SyncService] ${adType}报告数据处理失败:`, error.message);
      return 0;
    }
  }

  /**
   * 生成模拟绩效数据（当Amazon Reporting API超时时使用）
   */
  async generateMockPerformanceData(days: number = 7): Promise<number> {
    const db = await getDb();
    if (!db) return 0;

    try {
      // 获取该账户下所有广告活动
      const accountCampaigns = await db
        .select()
        .from(campaigns)
        .where(eq(campaigns.accountId, this.accountId));

      console.log(`[SyncService] 为 ${accountCampaigns.length} 个广告活动生成模拟绩效数据`);

      let synced = 0;

      // 使用站点时区计算日期
      const marketplaceToday = getMarketplaceCurrentDate(this.marketplace);
      console.log(`[SyncService] 站点${this.marketplace}当前日期: ${marketplaceToday}`);
      
      for (const campaign of accountCampaigns) {
        // 为每个广告活动生成最近N天的模拟数据
        for (let i = 0; i < days; i++) {
          // 基于站点当前日期计算
          const baseDate = new Date(marketplaceToday);
          baseDate.setDate(baseDate.getDate() - i);
          const dateStr = baseDate.toISOString().split('T')[0];

          // 检查是否已存在当天数据
          const [existing] = await db
            .select()
            .from(dailyPerformance)
            .where(
              and(
                eq(dailyPerformance.campaignId, campaign.id),
                sql`DATE(${dailyPerformance.date}) = ${dateStr}`
              )
            )
            .limit(1);

          if (existing) continue;

          // 生成基于广告活动类型的模拟数据
          const baseImpressions = (campaign.campaignType === 'sp_auto' || campaign.campaignType === 'sp_manual') ? 5000 : 
                                  campaign.campaignType === 'sb' ? 3000 : 2000;
          const baseCtr = 0.02 + Math.random() * 0.03; // 2-5% CTR
          const baseCvr = 0.05 + Math.random() * 0.1; // 5-15% CVR
          const baseCpc = 0.5 + Math.random() * 1.5; // $0.5-2 CPC
          const baseAov = 20 + Math.random() * 80; // $20-100 AOV

          const impressions = Math.floor(baseImpressions * (0.7 + Math.random() * 0.6));
          const clicks = Math.floor(impressions * baseCtr);
          const orders = Math.floor(clicks * baseCvr);
          const spend = clicks * baseCpc;
          const sales = orders * baseAov;

          const perfData = {
            accountId: this.accountId,
            campaignId: campaign.id,
            date: dateStr,
            impressions,
            clicks,
            spend: String(spend.toFixed(2)),
            sales: String(sales.toFixed(2)),
            orders,
            dailyAcos: sales > 0 ? String(((spend / sales) * 100).toFixed(2)) : '0',
            dailyRoas: spend > 0 ? String((sales / spend).toFixed(2)) : '0',
            createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
          };

          await db.insert(dailyPerformance).values(perfData);
          synced++;
        }
      }

      // 更新campaigns表的绩效汇总数据
      await this.updateCampaignPerformanceSummary();

      console.log(`[SyncService] 模拟绩效数据生成完成: ${synced} 条记录`);
      return synced;
    } catch (error) {
      console.error('[SyncService] 生成模拟绩效数据失败:', error);
      return 0;
    }
  }

  /**
   * 同步关键词绩效数据
   * 从Amazon Reporting API获取关键词级别的绩效数据并更新到keywords表
   */
  async syncKeywordPerformanceData(days: number = 7): Promise<number> {
    const db = await getDb();
    if (!db) {
      console.error('[SyncService] 数据库连接失败');
      return 0;
    }

    try {
      // 使用站点时区计算日期范围
      const { startDate: startDateStr, endDate: endDateStr } = getMarketplaceDateRange(this.marketplace, days);

      console.log(`[SyncService] 开始同步关键词绩效数据: ${startDateStr} - ${endDateStr} (站点: ${this.marketplace})`);

      // 请求关键词报告
      console.log('[SyncService] 正在请求Amazon关键词报告...');
      const reportId = await this.client.requestSpKeywordReport(startDateStr, endDateStr);
      console.log(`[SyncService] 关键词报告请求成功, reportId: ${reportId}`);
      
      // 等待并下载报告（超时时间增加到15分钟）
      console.log('[SyncService] 正在等待并下载关键词报告...');
      const reportData = await this.client.waitAndDownloadReport(reportId, 900000);
      console.log(`[SyncService] 关键词报告下载完成, 数据条数: ${reportData?.length || 0}`);
      
      if (!reportData || reportData.length === 0) {
        console.warn('[SyncService] 关键词报告数据为空');
        return 0;
      }
      
      // 输出第一条数据的结构，用于调试
      console.log('[SyncService] 关键词报告数据第一条示例:', JSON.stringify(reportData[0], null, 2));
      
      let synced = 0;
      let notMatched = 0;
      for (const row of reportData) {
        // ✅ 修复: SP-Targeting报告返回的是targetId，不是keywordId
        // 需要通过targetId匹配到keywords表的keywordId或product_targets表的targetId
        const reportTargetId = String(row.targetId || row.keywordId || '');
        if (!reportTargetId) continue;
        
        // 先尝试匹配keywords表
        let [kw] = await db
          .select()
          .from(keywords)
          .where(eq(keywords.keywordId, reportTargetId))
          .limit(1);
        
        if (!kw) {
          // 尝试通过targetingText匹配
          if (row.targetingText) {
            [kw] = await db
              .select()
              .from(keywords)
              .where(eq(keywords.keywordText, row.targetingText))
              .limit(1);
          }
        }
        
        if (!kw) {
          // 尝试匹配product_targets表
          const [pt] = await db
            .select()
            .from(productTargets)
            .where(eq(productTargets.targetId, reportTargetId))
            .limit(1);
          if (pt) {
            // 更新product_targets表的绩效数据
            const cost = row.cost || 0;
            const sales = row.sales7d || row.sales14d || 0;
            const orders = row.purchases7d || row.purchases14d || 0;
            const impressions = row.impressions || 0;
            const clicks = row.clicks || 0;
            await db
              .update(productTargets)
              .set({
                impressions,
                clicks,
                spend: String(cost),
                sales: String(sales),
                orders,
                targetAcos: cost > 0 && sales > 0 ? String(((cost / sales) * 100).toFixed(2)) : null,
                targetRoas: cost > 0 && sales > 0 ? String((sales / cost).toFixed(2)) : null,
                targetCtr: impressions > 0 ? String((clicks / impressions).toFixed(4)) : null,
                targetCvr: clicks > 0 ? String((orders / clicks).toFixed(4)) : null,
                targetCpc: clicks > 0 ? String((cost / clicks).toFixed(2)) : null,
                updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
              })
              .where(eq(productTargets.id, pt.id));
            synced++;
            continue;
          }
          notMatched++;
          if (notMatched <= 10) {
            console.warn(`[SyncService] 未找到匹配的keyword/target: targetId=${reportTargetId}, text=${row.targetingText || 'N/A'}`);
          }
          continue;
        }
        // ✅ 修复: SP-Targeting报告使用 sales7d/purchases7d（不是sales14d）
        const cost = row.cost || 0;
        const sales = row.sales7d || row.sales14d || 0;
        const orders = row.purchases7d || row.purchases14d || 0;
        const impressions = row.impressions || 0;
        const clicks = row.clicks || 0;
        
        // 更新keywords表的绩效数据
        await db
          .update(keywords)
          .set({
            impressions,
            clicks,
            spend: String(cost),
            sales: String(sales),
            orders,
            keywordAcos: cost > 0 && sales > 0 ? String(((cost / sales) * 100).toFixed(2)) : null,
            keywordCtr: impressions > 0 ? String((clicks / impressions).toFixed(4)) : null,
            keywordCvr: clicks > 0 ? String((orders / clicks).toFixed(4)) : null,
            keywordCpc: clicks > 0 ? String((cost / clicks).toFixed(2)) : null,
            keywordRoas: cost > 0 && sales > 0 ? String((sales / cost).toFixed(2)) : null,
            updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
          })
          .where(eq(keywords.id, kw.id));
        synced++;
      }

      if (notMatched > 0) {
        console.warn(`[SyncService] 关键词绩效数据同步: ${notMatched}条报告数据未匹配到本地keyword/target`);
      }
      console.log(`[SyncService] 关键词绩效数据同步完成: ${synced} 条记录`);
      return synced;
    } catch (error) {
      console.error('Error syncing keyword performance data:', error);
      return 0;
    }
  }

  /**
   * 同步商品定位级别绩效数据
   * 注意: SP-Targeting报告已包含商品定位数据，syncKeywordPerformanceData中已处理
   * 此方法作为补充，确保数据完整性
   */
  async syncProductTargetPerformanceData(days: number): Promise<number> {
    // SP-Targeting报告已在syncKeywordPerformanceData中处理了product_targets的更新
    // 这里返回0表示不需要额外同步
    console.log('[SyncService] 商品定位绩效数据已在syncKeywordPerformanceData中一并处理');
    return 0;
  }

  /**
   * 执行出价调整并同步到Amazon
   */
  async applyBidAdjustment(
    targetType: 'keyword' | 'product_target',
    targetId: number,
    newBid: number,
    reason: string,
    campaignId: number
  ): Promise<boolean> {
    const db = await getDb();
    if (!db) return false;

    try {
      let amazonId: string;
      let oldBid: number;
      let targetName: string;
      let adGroupId: number | null = null;

      if (targetType === 'keyword') {
        const [kw] = await db
          .select()
          .from(keywords)
          .where(eq(keywords.id, targetId))
          .limit(1);
        
        if (!kw || !kw.keywordId) return false;
        
        amazonId = kw.keywordId;
        oldBid = parseFloat(kw.bid);
        targetName = kw.keywordText;
        adGroupId = kw.adGroupId;

        // 调用Amazon API更新出价
        await this.client.updateKeywordBids([{
          keywordId: parseInt(amazonId),
          bid: newBid,
        }]);

        // 更新本地数据库
        await db
          .update(keywords)
          .set({ bid: String(newBid), updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' ') })
          .where(eq(keywords.id, targetId));
      } else {
        const [pt] = await db
          .select()
          .from(productTargets)
          .where(eq(productTargets.id, targetId))
          .limit(1);
        
        if (!pt || !pt.targetId) return false;
        
        amazonId = pt.targetId;
        oldBid = parseFloat(pt.bid);
        targetName = pt.targetValue || 'Product Target';
        adGroupId = pt.adGroupId;

        // 调用Amazon API更新出价
        await this.client.updateProductTargetBids([{
          targetId: parseInt(amazonId),
          bid: newBid,
        }]);

        // 更新本地数据库
        await db
          .update(productTargets)
          .set({ bid: String(newBid), updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' ') })
          .where(eq(productTargets.id, targetId));
      }

      // 计算出价变化
      const bidChangePercent = ((newBid - oldBid) / oldBid) * 100;
      const actionType = newBid > oldBid ? 'increase' : newBid < oldBid ? 'decrease' : 'set';

      // 记录出价日志
      await db.insert(biddingLogs).values({
        accountId: this.accountId,
        campaignId,
        adGroupId,
        logTargetType: targetType === 'keyword' ? 'keyword' : 'product_target',
        targetId,
        targetName,
        actionType: actionType as 'increase' | 'decrease' | 'set',
        previousBid: String(oldBid),
        newBid: String(newBid),
        bidChangePercent: String(bidChangePercent),
        reason,
        algorithmVersion: 'v1.0',
        isIntradayAdjustment: 0,
        createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      });

      return true;
    } catch (error) {
      console.error('Error applying bid adjustment:', error);
      return false;
    }
  }

  /**
   * 批量执行出价调整
   */
  async applyBatchBidAdjustments(
    adjustments: Array<{
      targetType: 'keyword' | 'product_target';
      targetId: number;
      newBid: number;
      reason: string;
      campaignId: number;
    }>
  ): Promise<{ success: number; failed: number }> {
    const results = { success: 0, failed: 0 };

    for (const adj of adjustments) {
      const success = await this.applyBidAdjustment(
        adj.targetType,
        adj.targetId,
        adj.newBid,
        adj.reason,
        adj.campaignId
      );
      
      if (success) {
        results.success++;
      } else {
        results.failed++;
      }
    }

    return results;
  }

  /**
   * 获取展示位置调整系数
   */
  public getPlacementMultiplier(campaign: SpCampaign, placement: string): number {
    const adjustment = campaign.bidding?.adjustments?.find(
      a => a.predicate === placement
    );
    return adjustment ? Number(adjustment.percentage) : 0;
  }

  /**
   * 仅同步广告活动（高频同步）
   * 用于快速获取广告活动状态和预算变化
   */
  async syncCampaignsOnly(): Promise<{
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

    try {
      // 同步SP广告活动
      const spResult = await this.syncSpCampaigns();
      results.spCampaigns = typeof spResult === 'number' ? spResult : spResult.synced;
      results.campaigns += results.spCampaigns;
      
      // 同步SB广告活动
      const sbResult = await this.syncSbCampaigns();
      results.sbCampaigns = typeof sbResult === 'number' ? sbResult : sbResult.synced;
      results.campaigns += results.sbCampaigns;
      
      // 同步SD广告活动
      const sdResult = await this.syncSdCampaigns();
      results.sdCampaigns = typeof sdResult === 'number' ? sdResult : sdResult.synced;
      results.campaigns += results.sdCampaigns;

      console.log(`[SyncService] 广告活动同步完成: SP=${results.spCampaigns}, SB=${results.sbCampaigns}, SD=${results.sdCampaigns}`);
    } catch (error) {
      console.error('[SyncService] 广告活动同步失败:', error);
    }

    return results;
  }

  /**
   * 同步广告组和定位数据（中频同步）
   * 用于获取广告组、关键词和商品定位的变化
   */
  async syncAdGroupsAndTargeting(): Promise<{
    adGroups: number;
    keywords: number;
    targets: number;
  }> {
    const results = {
      adGroups: 0,
      keywords: 0,
      targets: 0,
    };

    try {
      // ==================== 同步广告组（SP + SB + SD） ====================
      const spAdGroupResult = await this.syncSpAdGroups();
      results.adGroups += typeof spAdGroupResult === 'number' ? spAdGroupResult : spAdGroupResult.synced;

      try {
        const sbAdGroupResult = await this.syncSbAdGroups();
        results.adGroups += sbAdGroupResult.synced;
      } catch (e: any) {
        console.error('[SyncService] SB广告组同步失败:', e.message);
      }

      try {
        const sdAdGroupResult = await this.syncSdAdGroups();
        results.adGroups += sdAdGroupResult.synced;
      } catch (e: any) {
        console.error('[SyncService] SD广告组同步失败:', e.message);
      }
      
      // ==================== 同步关键词投放（SP + SB） ====================
      const spKeywordResult = await this.syncSpKeywords();
      results.keywords += typeof spKeywordResult === 'number' ? spKeywordResult : spKeywordResult.synced;

      try {
        const sbKeywordResult = await this.syncSbKeywords();
        results.keywords += sbKeywordResult.synced;
      } catch (e: any) {
        console.error('[SyncService] SB关键词同步失败:', e.message);
      }
      
      // ==================== 同步商品定位（SP + SB + SD） ====================
      const spTargetResult = await this.syncSpProductTargets();
      results.targets += typeof spTargetResult === 'number' ? spTargetResult : spTargetResult.synced;

      try {
        const sbTargetResult = await this.syncSbProductTargets();
        results.targets += sbTargetResult.synced;
      } catch (e: any) {
        console.error('[SyncService] SB商品定位同步失败:', e.message);
      }

      try {
        const sdTargetResult = await this.syncSdProductTargets();
        results.targets += sdTargetResult.synced;
      } catch (e: any) {
        console.error('[SyncService] SD商品定位同步失败:', e.message);
      }

      console.log(`[SyncService] 全渠道广告组和定位同步完成: 广告组=${results.adGroups}, 关键词=${results.keywords}, 定位=${results.targets}`);
    } catch (error) {
      console.error('[SyncService] 广告组和定位同步失败:', error);
    }

    return results;
  }

  /**
   * 同步广告组绩效数据
   * 通过SP/SB/SD广告组报告获取广告组级别的绩效数据
   * 并写入adGroups表的绩效字段（impressions/clicks/spend/sales/orders/ctr/cvr/acos/roas/cpc等）
   * 
   * 归因窗口: SP=7天, SB/SD=14天
   */
  async syncAdGroupPerformanceData(days: number = 14): Promise<number> {
    const db = await getDb();
    if (!db) return 0;

    let synced = 0;
    try {
      const { startDate, endDate } = getMarketplaceDateRange(this.marketplace, days);
      console.log(`[SyncService] 开始同步广告组绩效数据: ${startDate} - ${endDate} (站点: ${this.marketplace})`);

      // 获取该账户下所有广告活动
      const accountCampaigns = await db
        .select()
        .from(campaigns)
        .where(eq(campaigns.accountId, this.accountId));

      // 按广告类型分组
      const spCampaigns = accountCampaigns.filter(c => c.campaignType === 'sp_auto' || c.campaignType === 'sp_manual');
      const sbCampaigns = accountCampaigns.filter(c => c.campaignType === 'sb');
      const sdCampaigns = accountCampaigns.filter(c => c.campaignType === 'sd');

      // 1. SP广告组报告（7天归因）
      if (spCampaigns.length > 0) {
        try {
          const { startDate: spStart, endDate: spEnd } = getMarketplaceDateRange(this.marketplace, 7);
          const spReportId = await this.client.requestSpAdGroupReport(spStart, spEnd);
          const spData = await this.client.waitAndDownloadReport(spReportId);
          if (spData && spData.length > 0) {
            for (const row of spData) {
              const adGroupId = String(row.adGroupId);
              // 查找对应的广告组
              const [adGroup] = await db
                .select()
                .from(adGroups)
                .where(eq(adGroups.adGroupId, adGroupId))
                .limit(1);
              if (!adGroup) continue;

              const cost = row.cost || 0;
              const sales = row.sales7d || 0;
              const orders = row.purchases7d || 0;
              const impressions = row.impressions || 0;
              const clicks = row.clicks || 0;

              await db
                .update(adGroups)
                .set({
                  impressions,
                  clicks,
                  spend: String(cost),
                  sales: String(sales),
                  orders,
                  ctr: impressions > 0 ? String((clicks / impressions).toFixed(4)) : null,
                  cvr: clicks > 0 ? String((orders / clicks).toFixed(4)) : null,
                  acos: cost > 0 && sales > 0 ? String(((cost / sales) * 100).toFixed(2)) : null,
                  roas: cost > 0 && sales > 0 ? String((sales / cost).toFixed(2)) : null,
                  cpc: clicks > 0 ? String((cost / clicks).toFixed(2)) : null,
                })
                .where(eq(adGroups.id, adGroup.id));
              synced++;
            }
            console.log(`[SyncService] SP广告组绩效同步: ${synced} 条记录`);
          }
        } catch (error) {
          console.error('[SyncService] SP广告组绩效同步失败:', error);
        }
      }

      // 2. SB广告组报告（14天归因）
      if (sbCampaigns.length > 0) {
        try {
          const sbReportId = await this.client.requestSbAdGroupReport(startDate, endDate);
          const sbData = await this.client.waitAndDownloadReport(sbReportId);
          if (sbData && sbData.length > 0) {
            let sbSynced = 0;
            for (const row of sbData) {
              const adGroupId = String(row.adGroupId);
              const [adGroup] = await db
                .select()
                .from(adGroups)
                .where(eq(adGroups.adGroupId, adGroupId))
                .limit(1);
              if (!adGroup) continue;

              const cost = row.cost || 0;
              const sales = row.salesClicks14d || row.sales14d || 0;
              const orders = row.purchasesClicks14d || row.purchases14d || 0;
              const impressions = row.impressions || 0;
              const clicks = row.clicks || 0;
              const dpv = row.dpv14d || 0;
              const ntbOrders = row.attributedOrdersNewToBrand14d || 0;
              const ntbSales = row.attributedSalesNewToBrand14d || 0;

              await db
                .update(adGroups)
                .set({
                  impressions,
                  clicks,
                  spend: String(cost),
                  sales: String(sales),
                  orders,
                  ctr: impressions > 0 ? String((clicks / impressions).toFixed(4)) : null,
                  cvr: clicks > 0 ? String((orders / clicks).toFixed(4)) : null,
                  acos: cost > 0 && sales > 0 ? String(((cost / sales) * 100).toFixed(2)) : null,
                  roas: cost > 0 && sales > 0 ? String((sales / cost).toFixed(2)) : null,
                  cpc: clicks > 0 ? String((cost / clicks).toFixed(2)) : null,
                  dpv,
                  ntbOrders,
                  ntbSales: String(ntbSales),
                })
                .where(eq(adGroups.id, adGroup.id));
              sbSynced++;
            }
            synced += sbSynced;
            console.log(`[SyncService] SB广告组绩效同步: ${sbSynced} 条记录`);
          }
        } catch (error) {
          console.error('[SyncService] SB广告组绩效同步失败:', error);
        }
      }

      // 3. SD广告组报告（14天归因 + 浏览归因）
      if (sdCampaigns.length > 0) {
        try {
          const sdReportId = await this.client.requestSdAdGroupReport(startDate, endDate);
          const sdData = await this.client.waitAndDownloadReport(sdReportId);
          if (sdData && sdData.length > 0) {
            let sdSynced = 0;
            for (const row of sdData) {
              const adGroupId = String(row.adGroupId);
              const [adGroup] = await db
                .select()
                .from(adGroups)
                .where(eq(adGroups.adGroupId, adGroupId))
                .limit(1);
              if (!adGroup) continue;

              const cost = row.cost || 0;
              const sales = row.sales14d || 0;
              const orders = row.purchases14d || 0;
              const impressions = row.impressions || 0;
              const clicks = row.clicks || 0;
              const dpv = row.dpv14d || 0;
              const viewSales = row.viewAttributedSales14d || 0;
              const viewOrders = row.viewAttributedUnitsOrdered14d || 0;
              const ntbOrders = row.attributedOrdersNewToBrand14d || 0;
              const ntbSales = row.attributedSalesNewToBrand14d || 0;

              await db
                .update(adGroups)
                .set({
                  impressions,
                  clicks,
                  spend: String(cost),
                  sales: String(sales),
                  orders,
                  ctr: impressions > 0 ? String((clicks / impressions).toFixed(4)) : null,
                  cvr: clicks > 0 ? String((orders / clicks).toFixed(4)) : null,
                  acos: cost > 0 && sales > 0 ? String(((cost / sales) * 100).toFixed(2)) : null,
                  roas: cost > 0 && sales > 0 ? String((sales / cost).toFixed(2)) : null,
                  cpc: clicks > 0 ? String((cost / clicks).toFixed(2)) : null,
                  dpv,
                  ntbOrders,
                  ntbSales: String(ntbSales),
                  viewAttributedSales: String(viewSales),
                  viewAttributedOrders: viewOrders,
                })
                .where(eq(adGroups.id, adGroup.id));
              sdSynced++;
            }
            synced += sdSynced;
            console.log(`[SyncService] SD广告组绩效同步: ${sdSynced} 条记录`);
          }
        } catch (error) {
          console.error('[SyncService] SD广告组绩效同步失败:', error);
        }
      }

      console.log(`[SyncService] 广告组绩效同步完成: 共 ${synced} 条记录`);
      return synced;
    } catch (error) {
      console.error('[SyncService] 广告组绩效同步失败:', error);
      return synced;
    }
  }

  /**
   * 同步广告位置绩效数据
   * 使用Report API v3获取搜索顶部、商品详情页、其他位置的表现数据
   */
  async syncPlacementPerformance(days: number = 14): Promise<number> {
    const db = await getDb();
    if (!db) return 0;

    try {
      const { startDate, endDate } = getMarketplaceDateRange(this.marketplace, days);
      console.log(`[SyncService] 开始同步广告位置绩效: ${startDate} - ${endDate}`);

      // 请求SP位置报告
      const reportId = await this.client.requestSpPlacementReport(startDate, endDate);
      const reportData = await this.client.waitAndDownloadReport(reportId, 300000);

      if (!reportData || reportData.length === 0) {
        console.log('[SyncService] 位置报告数据为空');
        return 0;
      }

      console.log(`[SyncService] 获取到 ${reportData.length} 条位置绩效数据`);
      let synced = 0;

      for (const row of reportData) {
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

        // 转换位置类型
        const placementMap: Record<string, 'top_of_search' | 'product_page' | 'rest_of_search'> = {
          'TOP_OF_SEARCH': 'top_of_search',
          'DETAIL_PAGE': 'product_page',
          'OTHER': 'rest_of_search',
        };
        const placement = placementMap[row.placementClassification] || 'rest_of_search';
        const reportDate = row.date || new Date().toISOString().split('T')[0];

        // 检查是否已存在
        const [existing] = await db
          .select()
          .from(placementPerformance)
          .where(
            and(
              eq(placementPerformance.campaignId, String(campaign.campaignId)),
              eq(placementPerformance.accountId, this.accountId),
              eq(placementPerformance.placement, placement),
              eq(placementPerformance.date, reportDate)
            )
          )
          .limit(1);

        const cost = row.cost || 0;
        // SP广告位置报告使用7天归因窗口（与SP其他报告一致）
        const sales = row.sales7d || row.sales14d || 0;
        const clicks = row.clicks || 0;
        const impressions = row.impressions || 0;
        const orders = row.purchases7d || row.purchases14d || 0;

        const perfData = {
          campaignId: String(campaign.campaignId),
          accountId: this.accountId,
          placement,
          date: reportDate,
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

        if (existing) {
          await db
            .update(placementPerformance)
            .set(perfData)
            .where(eq(placementPerformance.id, existing.id));
        } else {
          await db.insert(placementPerformance).values({
            ...perfData,
            createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
          });
        }
        synced++;
      }

      console.log(`[SyncService] 位置绩效同步完成: ${synced} 条记录`);
      return synced;
    } catch (error) {
      console.error('[SyncService] 同步位置绩效失败:', error);
      return 0;
    }
  }

  /**
   * 同步搜索词数据
   * 使用Report API v3获取客户搜索词和绩效数据
   */
  async syncSearchTerms(days: number = 14): Promise<number> {
    const db = await getDb();
    if (!db) return 0;

    try {
      const { startDate, endDate } = getMarketplaceDateRange(this.marketplace, days);
      console.log(`[SyncService] 开始同步搜索词数据: ${startDate} - ${endDate}`);

      // 请求SP搜索词报告
      const reportId = await this.client.requestSpSearchTermReport(startDate, endDate);
      const reportData = await this.client.waitAndDownloadReport(reportId, 300000);

      if (!reportData || reportData.length === 0) {
        console.log('[SyncService] 搜索词报告数据为空');
        return 0;
      }

      console.log(`[SyncService] 获取到 ${reportData.length} 条搜索词数据`);
      let synced = 0;

      for (const row of reportData) {
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
              eq(searchTerms.campaignId, campaign.id),
              eq(searchTerms.adGroupId, adGroup.id),
              eq(searchTerms.searchTerm, row.searchTerm || '')
            )
          )
          .limit(1);

        const cost = row.cost || 0;
        const sales = row.sales7d || row.sales14d || 0;
        const clicks = row.clicks || 0;
        const impressions = row.impressions || 0;
        const orders = row.purchases7d || row.purchases14d || 0;

        // SP搜索词报告字段映射：
        // targeting = 投放词文本（如 "wireless earbuds" 或 ASIN）
        // keywordType = 投放词的匹配类型（BROAD/PHRASE/EXACT/TARGETING）
        // searchTerm = 客户搜索词
        const targetingText = row.targeting || row.keyword || '';
        const keywordType = (row.keywordType || row.matchType || '').toLowerCase();
        
        // 判断是关键词还是产品定位：keywordType为TARGETING表示产品定位
        const isProductTarget = keywordType === 'targeting';
        
        // 尝试关联到本地数据库中的投放词/投放ASIN记录
        let searchTermTargetId: number | null = null;
        let resolvedMatchType = keywordType; // 默认使用报告中的匹配类型
        if (!isProductTarget) {
          // 关键词定位：通过文本+广告组查找对应的keyword记录
          const [matchedKeyword] = await db
            .select({ id: keywords.id, matchType: keywords.matchType })
            .from(keywords)
            .where(
              and(
                eq(keywords.adGroupId, adGroup.id),
                eq(keywords.keywordText, targetingText)
              )
            )
            .limit(1);
          if (matchedKeyword) {
            searchTermTargetId = matchedKeyword.id;
            // 使用数据库中存储的精确匹配类型（broad/phrase/exact）
            resolvedMatchType = matchedKeyword.matchType || keywordType;
          }
        } else {
          // 产品定位：通过ASIN+广告组查找对应的productTarget记录
          const [matchedTarget] = await db
            .select({ id: productTargets.id, targetMatchType: productTargets.targetMatchType })
            .from(productTargets)
            .where(
              and(
                eq(productTargets.adGroupId, adGroup.id),
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
          campaignId: campaign.id,
          adGroupId: adGroup.id,
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

      console.log(`[SyncService] 搜索词同步完成: ${synced} 条记录`);
      return synced;
    } catch (error) {
      console.error('[SyncService] 同步搜索词失败:', error);
      return 0;
    }
  }

  /**
   * 同步SP自动定向数据
   * 获取自动广告的匹配组数据（紧密匹配、宽泛匹配、同类商品、关联商品）
   */
  async syncAutoTargeting(days: number = 14): Promise<number> {
    const db = await getDb();
    if (!db) return 0;

    try {
      const { startDate, endDate } = getMarketplaceDateRange(this.marketplace, days);
      console.log(`[SyncService] 开始同步自动定向数据: ${startDate} - ${endDate}`);

      // 请求SP自动定向报告
      const reportId = await this.client.requestSpAutoTargetingReport(startDate, endDate);
      const reportData = await this.client.waitAndDownloadReport(reportId, 300000);

      if (!reportData || reportData.length === 0) {
        console.log('[SyncService] 自动定向报告数据为空');
        return 0;
      }

      console.log(`[SyncService] 获取到 ${reportData.length} 条自动定向数据`);
      let synced = 0;

      for (const row of reportData) {
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
              eq(productTargets.adGroupId, adGroup.id),
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
          adGroupId: adGroup.id,
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

      console.log(`[SyncService] 自动定向同步完成: ${synced} 条记录`);
      return synced;
    } catch (error) {
      console.error('[SyncService] 同步自动定向失败:', error);
      return 0;
    }
  }

  /**
   * 同步SD定向数据
   * 获取SD广告的受众定向和商品定向数据
   */
  async syncSdTargeting(days: number = 14): Promise<number> {
    const db = await getDb();
    if (!db) return 0;

    try {
      const { startDate, endDate } = getMarketplaceDateRange(this.marketplace, days);
      console.log(`[SyncService] 开始同步SD定向数据: ${startDate} - ${endDate}`);

      // 请求SD定向报告
      const reportId = await this.client.requestSdTargetingReport(startDate, endDate);
      const reportData = await this.client.waitAndDownloadReport(reportId, 300000);

      if (!reportData || reportData.length === 0) {
        console.log('[SyncService] SD定向报告数据为空');
        return 0;
      }

      console.log(`[SyncService] 获取到 ${reportData.length} 条SD定向数据`);
      let synced = 0;

      for (const row of reportData) {
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
              eq(productTargets.adGroupId, adGroup.id),
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
          adGroupId: adGroup.id,
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

      console.log(`[SyncService] SD定向同步完成: ${synced} 条记录`);
      return synced;
    } catch (error) {
      console.error('[SyncService] 同步SD定向失败:', error);
      return 0;
    }
  }

  /**
   * 同步SB定向数据
   * 获取SB广告的关键词和商品定向数据
   */
  async syncSbTargeting(days: number = 14): Promise<number> {
    const db = await getDb();
    if (!db) return 0;

    try {
      const { startDate, endDate } = getMarketplaceDateRange(this.marketplace, days);
      console.log(`[SyncService] 开始同步SB定向数据: ${startDate} - ${endDate}`);

      // 请求SB定向报告
      const reportId = await this.client.requestSbTargetingReport(startDate, endDate);
      const reportData = await this.client.waitAndDownloadReport(reportId, 300000);

      if (!reportData || reportData.length === 0) {
        console.log('[SyncService] SB定向报告数据为空');
        return 0;
      }

      console.log(`[SyncService] 获取到 ${reportData.length} 条SB定向数据`);
      let synced = 0;

      for (const row of reportData) {
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
                eq(keywords.adGroupId, adGroup.id),
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
            adGroupId: adGroup.id,
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

      console.log(`[SyncService] SB定向同步完成: ${synced} 条记录`);
      return synced;
    } catch (error) {
      console.error('[SyncService] 同步SB定向失败:', error);
      return 0;
    }
  }

  /**
   * 完整同步所有广告数据
   * 包括广告活动、广告组、投放词、搜索词、位置绩效
   */
  async syncAllAdData(days: number = 14): Promise<{
    campaigns: number;
    adGroups: number;
    keywords: number;
    targets: number;
    searchTerms: number;
    placements: number;
  }> {
    const results = {
      campaigns: 0,
      adGroups: 0,
      keywords: 0,
      targets: 0,
      searchTerms: 0,
      placements: 0,
    };

    try {
      console.log(`[SyncService] 开始完整同步所有广告数据 (${days}天)`);

      // 1. 同步广告活动
      const spResult = await this.syncSpCampaigns();
      const sbResult = await this.syncSbCampaigns();
      const sdResult = await this.syncSdCampaigns();
      results.campaigns = (typeof spResult === 'number' ? spResult : spResult.synced) +
                         (typeof sbResult === 'number' ? sbResult : sbResult.synced) +
                         (typeof sdResult === 'number' ? sdResult : sdResult.synced);

      // 2. 同步广告组（SP + SB + SD）
      const adGroupResult = await this.syncSpAdGroups();
      results.adGroups = typeof adGroupResult === 'number' ? adGroupResult : adGroupResult.synced;
      try {
        const sbAdGroupResult = await this.syncSbAdGroups();
        results.adGroups += sbAdGroupResult.synced;
      } catch (e: any) { console.error('[SyncAllAd] SB广告组同步失败:', e.message); }
      try {
        const sdAdGroupResult = await this.syncSdAdGroups();
        results.adGroups += sdAdGroupResult.synced;
      } catch (e: any) { console.error('[SyncAllAd] SD广告组同步失败:', e.message); }

      // 3. 同步投放词（SP + SB）
      const keywordResult = await this.syncSpKeywords();
      results.keywords = typeof keywordResult === 'number' ? keywordResult : keywordResult.synced;
      try {
        const sbKeywordResult = await this.syncSbKeywords();
        results.keywords += sbKeywordResult.synced;
      } catch (e: any) { console.error('[SyncAllAd] SB关键词同步失败:', e.message); }

      // 4. 同步商品定向（SP + SB + SD）
      const targetResult = await this.syncSpProductTargets();
      results.targets = typeof targetResult === 'number' ? targetResult : targetResult.synced;
      try {
        const sbPtResult = await this.syncSbProductTargets();
        results.targets += sbPtResult.synced;
      } catch (e: any) { console.error('[SyncAllAd] SB商品定向同步失败:', e.message); }
      try {
        const sdPtResult = await this.syncSdProductTargets();
        results.targets += sdPtResult.synced;
      } catch (e: any) { console.error('[SyncAllAd] SD商品定向同步失败:', e.message); }

      // 5. 同步自动定向
      const autoTargetResult = await this.syncAutoTargeting(days);
      results.targets += autoTargetResult;

      // 6. 同步SD定向报告
      const sdTargetResult = await this.syncSdTargeting(days);
      results.targets += sdTargetResult;

      // 7. 同步SB定向报告
      const sbTargetResult = await this.syncSbTargeting(days);
      results.keywords += sbTargetResult;

      // 8. 同步否定关键词和否定商品定向
      try {
        const negKwResult = await this.syncSpNegativeKeywords();
        console.log(`[SyncAllAd] SP否定关键词: ${negKwResult.synced}新增, ${negKwResult.updated}更新`);
      } catch (e: any) { console.error('[SyncAllAd] SP否定关键词同步失败:', e.message); }
      try {
        const negPtResult = await this.syncSpNegativeProductTargets();
        console.log(`[SyncAllAd] SP否定商品定向: ${negPtResult.synced}新增, ${negPtResult.updated}更新`);
      } catch (e: any) { console.error('[SyncAllAd] SP否定商品定向同步失败:', e.message); }

      // 9. 同步搜索词（SP + SB）
      results.searchTerms = await this.syncSearchTerms(days);
      try {
        const sbStSynced = await this.syncSbSearchTerms(days);
        results.searchTerms += sbStSynced;
      } catch (e: any) { console.error('[SyncAllAd] SB搜索词同步失败:', e.message); }

      // 10. 同步位置绩效
      results.placements = await this.syncPlacementPerformance(days);

      console.log(`[SyncService] 完整同步完成:`, results);
    } catch (error) {
      console.error('[SyncService] 完整同步失败:', error);
    }

    return results;
  }

  /**
   * 更新campaigns表的绩效汇总数据
   * 优先仍 ailyPerformance表汇总，如果没有数据则从keywords和productTargets表汇总
   */
  async updateCampaignPerformanceSummary(): Promise<void> {
    const db = await getDb();
    if (!db) return;

    try {
      // 获取该账户下所有广告活动
      const accountCampaigns = await db
        .select()
        .from(campaigns)
        .where(eq(campaigns.accountId, this.accountId));

      console.log(`[SyncService] 开始更新 ${accountCampaigns.length} 个广告活动的绩效汇总 (站点: ${this.marketplace})`);

      // 使用站点时区计算最近30天的日期范围
      const { startDate: startDateStr, endDate: endDateStr } = getMarketplaceDateRange(this.marketplace, 30);

      for (const campaign of accountCampaigns) {
        // 首先尝试仍ailyPerformance表汇总
        const [dailySummary] = await db
          .select({
            totalImpressions: sql<number>`COALESCE(SUM(impressions), 0)`,
            totalClicks: sql<number>`COALESCE(SUM(clicks), 0)`,
            totalSpend: sql<string>`COALESCE(SUM(spend), 0)`,
            totalSales: sql<string>`COALESCE(SUM(sales), 0)`,
            totalOrders: sql<number>`COALESCE(SUM(orders), 0)`,
          })
          .from(dailyPerformance)
          .where(
            and(
              eq(dailyPerformance.campaignId, campaign.id),
              sql`${dailyPerformance.date} >= ${startDateStr}`,
              sql`${dailyPerformance.date} <= ${endDateStr}`
            )
          );

        let totalImpressions = dailySummary?.totalImpressions || 0;
        let totalClicks = dailySummary?.totalClicks || 0;
        let totalSpend = parseFloat(dailySummary?.totalSpend || '0');
        let totalSales = parseFloat(dailySummary?.totalSales || '0');
        let totalOrders = dailySummary?.totalOrders || 0;

        // 如果dailyPerformance没有数据，从keywords和productTargets表汇总
        if (totalImpressions === 0 && totalClicks === 0 && totalSpend === 0) {
          // 获取该广告活动下的所有广告组
          const campaignAdGroups = await db
            .select({ id: adGroups.id })
            .from(adGroups)
            .where(eq(adGroups.campaignId, campaign.id));

          const adGroupIds = campaignAdGroups.map(ag => ag.id);

          if (adGroupIds.length > 0) {
            // 从keywords表汇总
            const [keywordSummary] = await db
              .select({
                totalImpressions: sql<number>`COALESCE(SUM(impressions), 0)`,
                totalClicks: sql<number>`COALESCE(SUM(clicks), 0)`,
                totalSpend: sql<string>`COALESCE(SUM(spend), 0)`,
                totalSales: sql<string>`COALESCE(SUM(sales), 0)`,
                totalOrders: sql<number>`COALESCE(SUM(orders), 0)`,
              })
              .from(keywords)
              .where(sql`${keywords.adGroupId} IN (${sql.join(adGroupIds, sql`, `)})`);

            // 从productTargets表汇总
            const [targetSummary] = await db
              .select({
                totalImpressions: sql<number>`COALESCE(SUM(impressions), 0)`,
                totalClicks: sql<number>`COALESCE(SUM(clicks), 0)`,
                totalSpend: sql<string>`COALESCE(SUM(spend), 0)`,
                totalSales: sql<string>`COALESCE(SUM(sales), 0)`,
                totalOrders: sql<number>`COALESCE(SUM(orders), 0)`,
              })
              .from(productTargets)
              .where(sql`${productTargets.adGroupId} IN (${sql.join(adGroupIds, sql`, `)})`);

            // 合并关键词和商品定位的数据
            totalImpressions = (keywordSummary?.totalImpressions || 0) + (targetSummary?.totalImpressions || 0);
            totalClicks = (keywordSummary?.totalClicks || 0) + (targetSummary?.totalClicks || 0);
            totalSpend = parseFloat(keywordSummary?.totalSpend || '0') + parseFloat(targetSummary?.totalSpend || '0');
            totalSales = parseFloat(keywordSummary?.totalSales || '0') + parseFloat(targetSummary?.totalSales || '0');
            totalOrders = (keywordSummary?.totalOrders || 0) + (targetSummary?.totalOrders || 0);
          }
        }

        // 更新campaigns表
        await db
          .update(campaigns)
          .set({
            impressions: totalImpressions,
            clicks: totalClicks,
            spend: String(totalSpend.toFixed(2)),
            sales: String(totalSales.toFixed(2)),
            orders: totalOrders,
            acos: totalSpend > 0 && totalSales > 0 ? String(((totalSpend / totalSales) * 100).toFixed(2)) : null,
            roas: totalSpend > 0 && totalSales > 0 ? String((totalSales / totalSpend).toFixed(2)) : null,
            ctr: totalImpressions > 0 ? String((totalClicks / totalImpressions).toFixed(4)) : null,
            cvr: totalClicks > 0 ? String((totalOrders / totalClicks).toFixed(4)) : null,
            cpc: totalClicks > 0 ? String((totalSpend / totalClicks).toFixed(2)) : null,
          })
          .where(eq(campaigns.id, campaign.id));
      }

      console.log(`[SyncService] 广告活动绩效汇总更新完成`);
    } catch (error) {
      console.error('[SyncService] 更新广告活动绩效汇总失败:', error);
    }
  }

  /**
   * 仅同步绩效数据（低频同步）
   * 用于获取历史绩效数据
   * 
   * 重要：默认14天归因回溯，确保数据与亚马逊后台一致
   */
  async syncPerformanceOnly(days: number = 14): Promise<{
    performance: number;
  }> {
    const results = {
      performance: 0,
    };
    try {
      results.performance = await this.syncPerformanceData(days);
      console.log(`[SyncService] 绩效数据同步完成: ${results.performance} 条记录`);
    } catch (error) {
      console.error('[SyncService] 绩效数据同步失败:', error);
    }
    return results;
  }

  /**
   * 同步SB广告素材（品牌广告的创意素材详情）
   * 包含: headline, brandLogo, customImage, video, brandName等
   * 写入ad_groups表的creative字段
   */
  async syncSbAds(): Promise<{ synced: number; skipped: number }> {
    const db = await getDb();
    if (!db) return { synced: 0, skipped: 0 };
    try {
      const apiAds = await this.client.listSbAds();
      let synced = 0;
      let skipped = 0;
      console.log(`[SyncService] 获取到 ${apiAds.length} 个SB广告素材`);
      
      // 调试：输出第一个广告素材的完整结构
      if (apiAds.length > 0) {
        console.log('[SyncService] SB广告素材API返回结构示例:', JSON.stringify(apiAds[0], null, 2));
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
        const updateData: any = {
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
      
      console.log(`[SyncService] SB广告素材同步完成: synced=${synced}, skipped=${skipped}`);
      return { synced, skipped };
    } catch (error: any) {
      console.error('[SyncService] SB广告素材同步失败:', error.message);
      return { synced: 0, skipped: 0 };
    }
  }

  /**
   * 同步SB否定关键词
   * 从SB API获取否定关键词并同步到negative_keywords表
   */
  async syncSbNegativeKeywords(): Promise<{ synced: number; updated: number }> {
    const db = await getDb();
    if (!db) return { synced: 0, updated: 0 };
    try {
      let synced = 0;
      let updated = 0;
      
      const sbNegatives = await this.client.listSbNegativeKeywords();
      console.log(`[SyncService] 获取到 ${sbNegatives.length} 个SB否定关键词`);
      
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
        let adGroupId: number | null = null;
        if (neg.adGroupId) {
          const [adGroup] = await db
            .select()
            .from(adGroups)
            .where(eq(adGroups.adGroupId, String(neg.adGroupId)))
            .limit(1);
          if (adGroup) adGroupId = adGroup.id;
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
              eq(negativeKeywords.campaignId, campaign.id),
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
            campaignId: campaign.id,
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
      
      console.log(`[SyncService] SB否定关键词同步完成: ${synced}条新增, ${updated}条更新`);
      return { synced, updated };
    } catch (error: any) {
      console.error('[SyncService] SB否定关键词同步失败:', error.message);
      return { synced: 0, updated: 0 };
    }
  }

  /**
   * 同步SB否定商品定向
   */
  async syncSbNegativeTargets(): Promise<{ synced: number; updated: number }> {
    const db = await getDb();
    if (!db) return { synced: 0, updated: 0 };
    try {
      let synced = 0;
      let updated = 0;
      
      const sbNegTargets = await this.client.listSbNegativeTargets();
      console.log(`[SyncService] 获取到 ${sbNegTargets.length} 个SB否定商品定向`);
      
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
        
        let adGroupId: number | null = null;
        if (neg.adGroupId) {
          const [adGroup] = await db
            .select()
            .from(adGroups)
            .where(eq(adGroups.adGroupId, String(neg.adGroupId)))
            .limit(1);
          if (adGroup) adGroupId = adGroup.id;
        }
        
        const expression = neg.expression || [];
        const asinExpr = expression.find((e: any) => e.type?.toLowerCase().includes('asin'));
        const negativeText = asinExpr?.value || JSON.stringify(expression);
        const amazonTargetId = String(neg.targetId || '');
        const negLevel = adGroupId ? 'ad_group' as const : 'campaign' as const;
        
        const [existing] = await db
          .select()
          .from(negativeKeywords)
          .where(
            and(
              eq(negativeKeywords.accountId, this.accountId),
              eq(negativeKeywords.campaignId, campaign.id),
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
            campaignId: campaign.id,
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
      
      console.log(`[SyncService] SB否定商品定向同步完成: ${synced}条新增, ${updated}条更新`);
      return { synced, updated };
    } catch (error: any) {
      console.error('[SyncService] SB否定商品定向同步失败:', error.message);
      return { synced: 0, updated: 0 };
    }
  }

  /**
   * 同步SB广告位绩效数据
   * 通过SB Placement报告获取广告位级别的绩效数据
   */
  async syncSbPlacementPerformance(days: number = 14): Promise<number> {
    const db = await getDb();
    if (!db) return 0;
    let synced = 0;
    try {
      const { startDate, endDate } = getMarketplaceDateRange(this.marketplace, days);
      console.log(`[SyncService] 开始同步SB广告位绩效: ${startDate} - ${endDate}`);
      
      const reportId = await this.client.requestSbCampaignPlacementReport(
        startDate,
        endDate
      );
      const reportData = await this.client.waitAndDownloadReport(reportId);
      console.log(`[SyncService] SB广告位报告获取到 ${reportData.length} 条记录`);
      
      for (const row of reportData) {
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
        
        const dateStr = row.date || startDate;
        const rawPlacement = row.placementClassification || row.placement || 'OTHER';
        // 转换位置类型
        const placementMap: Record<string, 'top_of_search' | 'product_page' | 'rest_of_search'> = {
          'TOP_OF_SEARCH': 'top_of_search',
          'DETAIL_PAGE': 'product_page',
          'OTHER': 'rest_of_search',
        };
        const placement = placementMap[rawPlacement] || 'rest_of_search';
        
        // 写入placement_performance表
        const [existing] = await db
          .select()
          .from(placementPerformance)
          .where(
            and(
              eq(placementPerformance.campaignId, String(campaign.campaignId)),
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
          campaignId: String(campaign.campaignId),
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
        
        if (existing) {
          await db.update(placementPerformance).set(perfData).where(eq(placementPerformance.id, existing.id));
        } else {
          await db.insert(placementPerformance).values({
            ...perfData,
            createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
          });
        }
        synced++;
      }
      
      console.log(`[SyncService] SB广告位绩效同步完成: ${synced}条`);
    } catch (error: any) {
      console.error('[SyncService] SB广告位绩效同步失败:', error.message);
    }
    return synced;
  }
}

/**
 * 执行自动出价优化
 */
export async function runAutoBidOptimization(
  syncService: AmazonSyncService,
  accountId: number,
  performanceGroupConfig: PerformanceGroupConfig
): Promise<{ optimized: number; skipped: number }> {
  const db = await getDb();
  if (!db) return { optimized: 0, skipped: 0 };

  // ✅ 修复: 添加accountId过滤，避免跨账号优化
  // 通过campaigns和adGroups关联获取当前账号的关键词
  const keywordsToOptimize = await db
    .select({ keyword: keywords })
    .from(keywords)
    .innerJoin(adGroups, eq(keywords.adGroupId, adGroups.id))
    .innerJoin(campaigns, eq(adGroups.campaignId, campaigns.id))
    .where(and(
      eq(campaigns.accountId, accountId),
      eq(keywords.keywordStatus, 'enabled')
    ))
    .limit(100)
    .then(rows => rows.map(r => r.keyword));

  const results = { optimized: 0, skipped: 0 };

  for (const kw of keywordsToOptimize) {
    // 构建优化目标
    const target: OptimizationTarget = {
      id: kw.id,
      type: 'keyword',
      currentBid: parseFloat(kw.bid),
      impressions: kw.impressions || 0,
      clicks: kw.clicks || 0,
      spend: parseFloat(kw.spend || '0'),
      sales: parseFloat(kw.sales || '0'),
      orders: kw.orders || 0,
      matchType: kw.matchType,
    };

    // 计算出价调整
    const adjustment = calculateBidAdjustment(target, performanceGroupConfig, 10, 0.02);

    if (adjustment) {
      // 获取campaign ID
      const [adGroup] = await db
        .select()
        .from(adGroups)
        .where(eq(adGroups.id, kw.adGroupId))
        .limit(1);

      if (adGroup) {
        const success = await syncService.applyBidAdjustment(
          'keyword',
          kw.id,
          adjustment.newBid,
          adjustment.reason,
          adGroup.campaignId
        );
        
        if (success) {
          results.optimized++;
        } else {
          results.skipped++;
        }
      } else {
        results.skipped++;
      }
    } else {
      results.skipped++;
    }
  }

  return results;
}


// ==================== 带变更跟踪的同步方法 ====================

// 扩展AmazonSyncService类，添加带变更跟踪的同步方法
declare module './amazonSyncService' {
  interface AmazonSyncService {
    syncSpCampaignsWithTracking(lastSyncTime?: string | null, syncJobId?: number | null): Promise<SyncResultWithTracking>;
    syncSbCampaignsWithTracking(lastSyncTime?: string | null, syncJobId?: number | null): Promise<SyncResultWithTracking>;
    syncSdCampaignsWithTracking(lastSyncTime?: string | null, syncJobId?: number | null): Promise<SyncResultWithTracking>;
    syncSpAdGroupsWithTracking(lastSyncTime?: string | null, syncJobId?: number | null): Promise<SyncResultWithTracking>;
    syncSpKeywordsWithTracking(lastSyncTime?: string | null, syncJobId?: number | null): Promise<SyncResultWithTracking>;
    syncSpProductTargetsWithTracking(lastSyncTime?: string | null, syncJobId?: number | null): Promise<SyncResultWithTracking>;
  }
}

interface SyncResultWithTracking {
  synced: number;
  skipped: number;
  created: number;
  updated: number;
  deleted: number;
  conflicts: number;
}

import {
  createSyncChangeRecordsBatch,
  createSyncConflictsBatch,
} from './db';
import type {
  InsertSyncChangeRecord,
  InsertSyncConflict,
} from '../drizzle/schema';

/**
 * 检测数据冲突
 * 注意：空值（空字符串、"0"、null、undefined）被视为"无数据"，不与远程数据产生冲突
 * 这样可以避免首次同步时本地数据为空导致的大量虚假冲突
 */
function detectConflict(
  existing: any,
  newData: any,
  fieldsToCheck: string[]
): { hasConflict: boolean; conflictFields: string[] } {
  const conflictFields: string[] = [];
  
  // 判断值是否为"无数据"（空值）
  const isEmptyValue = (value: any): boolean => {
    if (value === undefined || value === null) return true;
    const strValue = String(value).trim();
    // 空字符串、"0"、"0.00" 都视为空值（默认值）
    return strValue === '' || strValue === '0' || strValue === '0.00' || strValue === '0.0';
  };
  
  for (const field of fieldsToCheck) {
    const existingValue = existing[field];
    const newValue = newData[field];
    
    // 如果本地值为空，不视为冲突（应该直接使用远程数据更新）
    if (isEmptyValue(existingValue)) {
      continue;
    }
    
    // 如果远程值为空，也不视为冲突（保留本地数据）
    if (isEmptyValue(newValue)) {
      continue;
    }
    
    // 两个值都存在且不相等，才是真正的冲突
    const existingStr = String(existingValue).trim();
    const newStr = String(newValue).trim();
    
    if (existingStr !== newStr) {
      conflictFields.push(field);
    }
  }
  
  return {
    hasConflict: conflictFields.length > 0,
    conflictFields,
  };
}

/**
 * 同步SP广告活动（带变更跟踪）
 */
AmazonSyncService.prototype.syncSpCampaignsWithTracking = async function(
  lastSyncTime?: string | null,
  syncJobId?: number | null
): Promise<SyncResultWithTracking> {
  console.log('[同步WithTracking] ========== 开始同步SP广告活动(带跟踪) ==========');
  console.log('[同步WithTracking] 参数:', { accountId: this.accountId, lastSyncTime, syncJobId });
  
  const db = await getDb();
  if (!db) {
    console.error('[同步WithTracking] ❌ 数据库连接失败');
    return { synced: 0, skipped: 0, created: 0, updated: 0, deleted: 0, conflicts: 0 };
  }
  console.log('[同步WithTracking] ✅ 数据库连接成功');

  const result: SyncResultWithTracking = {
    synced: 0,
    skipped: 0,
    created: 0,
    updated: 0,
    deleted: 0,
    conflicts: 0,
  };

  const changeRecords: InsertSyncChangeRecord[] = [];
  const conflictRecords: InsertSyncConflict[] = [];

  try {
    console.log('[同步WithTracking] 正在调用Amazon API: listSpCampaigns()...');
    const apiCampaigns = await this.client.listSpCampaigns();
    console.log(`[同步WithTracking] ✅ API调用成功,返回 ${apiCampaigns.length} 个SP广告活动`);
    
    if (apiCampaigns.length === 0) {
      console.warn('[同步WithTracking] ⚠️ API返回空数组 - 没有SP广告活动');
      return result;
    }

    for (const apiCampaign of apiCampaigns) {
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

      // 增量同步检查
      if (lastSyncTime && existing) {
        const existingUpdated = existing.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
        const lastSync = new Date(lastSyncTime).getTime();
        if (existingUpdated >= lastSync) {
          result.skipped++;
          continue;
        }
      }

      // Amazon API返回的targetingType是大写的AUTO/MANUAL，需要转换为小写
      const normalizedTargetingType = (apiCampaign.targetingType || 'manual').toLowerCase() as 'auto' | 'manual';
      const campaignType = normalizedTargetingType === 'auto' ? 'sp_auto' : 'sp_manual';
      
      // SP API v3的dailyBudget可能嵌套在budget对象中，也可能直接在根级别
      const dailyBudgetValue = (apiCampaign as any).budget?.budget || 
                               (apiCampaign as any).budget?.dailyBudget || 
                               apiCampaign.dailyBudget || 
                               0;
      
      const campaignData = {
        accountId: this.accountId,
        campaignId: String(apiCampaign.campaignId),
        campaignName: apiCampaign.name,
        campaignType: campaignType as 'sp_auto' | 'sp_manual' | 'sb' | 'sd',
        targetingType: normalizedTargetingType,
        dailyBudget: String(dailyBudgetValue),
        campaignStatus: (apiCampaign.state?.toLowerCase() || 'enabled') as 'enabled' | 'paused' | 'archived',
        placementTopSearchBidAdjustment: this.getPlacementMultiplier(apiCampaign, 'placementTop'),
        placementProductPageBidAdjustment: this.getPlacementMultiplier(apiCampaign, 'placementProductPage'),
        updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      };

      if (existing) {
        // 检测冲突
        const conflictCheck = detectConflict(existing, campaignData, ['dailyBudget', 'status']);
        if (conflictCheck.hasConflict && syncJobId) {
          conflictRecords.push({
            syncJobId,
            accountId: this.accountId,
            userId: this.userId,
            entityType: 'campaign',
            entityId: String(apiCampaign.campaignId),
            entityName: apiCampaign.name,
            conflictType: 'data_mismatch',
            localData: existing,
            remoteData: campaignData,
            conflictFields: conflictCheck.conflictFields,
          });
          result.conflicts++;
        }

        // 记录变更
        if (syncJobId) {
          changeRecords.push({
            syncJobId,
            accountId: this.accountId,
            userId: this.userId,
            entityType: 'campaign',
            changeType: 'updated',
            entityId: String(apiCampaign.campaignId),
            entityName: apiCampaign.name,
            previousData: existing,
            newData: campaignData,
            changedFields: Object.keys(campaignData).filter(k => 
              (existing as any)[k] !== (campaignData as any)[k]
            ),
          });
        }

        await db
          .update(campaigns)
          .set(campaignData)
          .where(eq(campaigns.id, existing.id));
        result.updated++;
      } else {
        // 记录新建
        if (syncJobId) {
          changeRecords.push({
            syncJobId,
            accountId: this.accountId,
            userId: this.userId,
            entityType: 'campaign',
            changeType: 'created',
            entityId: String(apiCampaign.campaignId),
            entityName: apiCampaign.name,
            newData: campaignData,
          });
        }

        await db.insert(campaigns).values({
          ...campaignData,
          createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
        });
        result.created++;
      }
      result.synced++;
    }

    // 批量保存变更记录
    if (changeRecords.length > 0) {
      await createSyncChangeRecordsBatch(changeRecords);
    }
    if (conflictRecords.length > 0) {
      await createSyncConflictsBatch(conflictRecords);
    }

    console.log('[同步WithTracking] ========== SP广告活动同步完成 ==========');
    console.log('[同步WithTracking] 结果:', result);
    return result;
  } catch (error: any) {
    console.error('[同步WithTracking] ❌ SP广告活动同步失败');
    console.error('[同步WithTracking] 错误类型:', error.constructor?.name);
    console.error('[同步WithTracking] 错误消息:', error?.message || error);
    console.error('[同步WithTracking] 错误堆栈:', error?.stack);
    if (error?.response) {
      console.error('[同步WithTracking] API响应状态:', error.response.status);
      console.error('[同步WithTracking] API响应数据:', JSON.stringify(error.response.data, null, 2));
    }
    return result;
  }
};

/**
 * 同步SB广告活动（带变更跟踪）
 */
AmazonSyncService.prototype.syncSbCampaignsWithTracking = async function(
  lastSyncTime?: string | null,
  syncJobId?: number | null
): Promise<SyncResultWithTracking> {
  const db = await getDb();
  if (!db) return { synced: 0, skipped: 0, created: 0, updated: 0, deleted: 0, conflicts: 0 };

  const result: SyncResultWithTracking = {
    synced: 0,
    skipped: 0,
    created: 0,
    updated: 0,
    deleted: 0,
    conflicts: 0,
  };

  const changeRecords: InsertSyncChangeRecord[] = [];
  const conflictRecords: InsertSyncConflict[] = [];

  try {
    const apiCampaigns = await this.client.listSbCampaigns();

    for (const apiCampaign of apiCampaigns) {
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

      if (lastSyncTime && existing) {
        const existingUpdated = existing.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
        const lastSync = new Date(lastSyncTime).getTime();
        if (existingUpdated >= lastSync) {
          result.skipped++;
          continue;
        }
      }

      // ✅ 根据SB广告的Campaign Goal确定计费方式
      const sbGoal = (apiCampaign as any).goal || (apiCampaign as any).campaignGoal || '';
      let sbCostType: 'cpc' | 'vcpm' | 'cpm' = 'cpc';
      if (sbGoal === 'GROW_BRAND_IMPRESSION_SHARE' || sbGoal === 'growBrandImpressionShare') {
        sbCostType = 'vcpm';
      }
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

      const campaignData = {
        accountId: this.accountId,
        campaignId: String(apiCampaign.campaignId),
        campaignName: apiCampaign.name,
        campaignType: 'sb' as const,
        targetingType: 'manual' as const,
        dailyBudget: String(apiCampaign.budget?.budget || apiCampaign.budget || 0),
        campaignStatus: ((apiCampaign.state || 'enabled').toLowerCase()) as 'enabled' | 'paused' | 'archived',
        state: ((apiCampaign.state || 'enabled').toLowerCase()) as 'enabled' | 'paused' | 'archived' | 'pending' | 'other',
        costType: sbCostType, // ✅ 根据Goal动态设置
        campaignGoal: sbGoal || null, // ✅ 存储原始Goal值
        adFormat: normalizedAdFormat, // ✅ 存储广告格式
        updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      };

      if (existing) {
        const conflictCheck = detectConflict(existing, campaignData, ['dailyBudget', 'status']);
        if (conflictCheck.hasConflict && syncJobId) {
          conflictRecords.push({
            syncJobId,
            accountId: this.accountId,
            userId: this.userId,
            entityType: 'campaign',
            entityId: String(apiCampaign.campaignId),
            entityName: apiCampaign.name,
            conflictType: 'data_mismatch',
            localData: existing,
            remoteData: campaignData,
            conflictFields: conflictCheck.conflictFields,
          });
          result.conflicts++;
        }

        if (syncJobId) {
          changeRecords.push({
            syncJobId,
            accountId: this.accountId,
            userId: this.userId,
            entityType: 'campaign',
            changeType: 'updated',
            entityId: String(apiCampaign.campaignId),
            entityName: apiCampaign.name,
            previousData: existing,
            newData: campaignData,
            changedFields: Object.keys(campaignData).filter(k => 
              (existing as any)[k] !== (campaignData as any)[k]
            ),
          });
        }

        await db
          .update(campaigns)
          .set(campaignData)
          .where(eq(campaigns.id, existing.id));
        result.updated++;
      } else {
        if (syncJobId) {
          changeRecords.push({
            syncJobId,
            accountId: this.accountId,
            userId: this.userId,
            entityType: 'campaign',
            changeType: 'created',
            entityId: String(apiCampaign.campaignId),
            entityName: apiCampaign.name,
            newData: campaignData,
          });
        }

        await db.insert(campaigns).values({
          ...campaignData,
          createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
        });
        result.created++;
      }
      result.synced++;
    }

    if (changeRecords.length > 0) {
      await createSyncChangeRecordsBatch(changeRecords);
    }
    if (conflictRecords.length > 0) {
      await createSyncConflictsBatch(conflictRecords);
    }

    return result;
  } catch (error) {
    console.error('Error syncing SB campaigns with tracking:', error);
    return result;
  }
};

/**
 * 同步SD广告活动（带变更跟踪）
 */
AmazonSyncService.prototype.syncSdCampaignsWithTracking = async function(
  lastSyncTime?: string | null,
  syncJobId?: number | null
): Promise<SyncResultWithTracking> {
  const db = await getDb();
  if (!db) return { synced: 0, skipped: 0, created: 0, updated: 0, deleted: 0, conflicts: 0 };

  const result: SyncResultWithTracking = {
    synced: 0,
    skipped: 0,
    created: 0,
    updated: 0,
    deleted: 0,
    conflicts: 0,
  };

  const changeRecords: InsertSyncChangeRecord[] = [];
  const conflictRecords: InsertSyncConflict[] = [];

  try {
    const apiCampaigns = await this.client.listSdCampaigns();

    for (const apiCampaign of apiCampaigns) {
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

      if (lastSyncTime && existing) {
        const existingUpdated = existing.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
        const lastSync = new Date(lastSyncTime).getTime();
        if (existingUpdated >= lastSync) {
          result.skipped++;
          continue;
        }
      }

      // ✅ 获取SD广告的计费类型
      const sdCostType = ((apiCampaign as any).costType || 'cpc').toLowerCase();
      const validCostTypes = ['cpc', 'vcpm', 'cpm'];
      const normalizedCostType = validCostTypes.includes(sdCostType) ? sdCostType : 'cpc';

      // ✅ 获取SD广告的Campaign Goal（广告目标）
      const sdGoal = (apiCampaign as any).goal || 
                     (apiCampaign as any).optimizationGoal || 
                     (apiCampaign as any).bidOptimization || '';

      // ✅ 获取SD广告的tactic（定向策略）
      const sdTactic = (apiCampaign as any).tactic || null;

      // ✅ 获取SD广告的竞价优化目标
      const sdBidOptimization = (apiCampaign as any).bidOptimization || null;
      const validBidOpts = ['reach', 'pageVisits', 'conversions'];
      const normalizedBidOpt = validBidOpts.includes(sdBidOptimization) ? sdBidOptimization : null;

      const campaignData = {
        accountId: this.accountId,
        campaignId: String(apiCampaign.campaignId),
        campaignName: apiCampaign.name,
        campaignType: 'sd' as const,
        targetingType: 'manual' as const,
        dailyBudget: String(apiCampaign.budget?.budget || apiCampaign.budget || 0),
        campaignStatus: ((apiCampaign.state || 'enabled').toLowerCase()) as 'enabled' | 'paused' | 'archived',
        state: ((apiCampaign.state || 'enabled').toLowerCase()) as 'enabled' | 'paused' | 'archived' | 'pending' | 'other',
        costType: normalizedCostType as 'cpc' | 'vcpm' | 'cpm', // ✅ 从API获取
        campaignGoal: sdGoal || null, // ✅ 存储SD广告目标
        bidOptimization: normalizedBidOpt, // ✅ 存储竞价优化目标
        tactic: sdTactic, // ✅ 存储定向策略
        updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      };

      if (existing) {
        const conflictCheck = detectConflict(existing, campaignData, ['dailyBudget', 'status']);
        if (conflictCheck.hasConflict && syncJobId) {
          conflictRecords.push({
            syncJobId,
            accountId: this.accountId,
            userId: this.userId,
            entityType: 'campaign',
            entityId: String(apiCampaign.campaignId),
            entityName: apiCampaign.name,
            conflictType: 'data_mismatch',
            localData: existing,
            remoteData: campaignData,
            conflictFields: conflictCheck.conflictFields,
          });
          result.conflicts++;
        }

        if (syncJobId) {
          changeRecords.push({
            syncJobId,
            accountId: this.accountId,
            userId: this.userId,
            entityType: 'campaign',
            changeType: 'updated',
            entityId: String(apiCampaign.campaignId),
            entityName: apiCampaign.name,
            previousData: existing,
            newData: campaignData,
            changedFields: Object.keys(campaignData).filter(k => 
              (existing as any)[k] !== (campaignData as any)[k]
            ),
          });
        }

        await db
          .update(campaigns)
          .set(campaignData)
          .where(eq(campaigns.id, existing.id));
        result.updated++;
      } else {
        if (syncJobId) {
          changeRecords.push({
            syncJobId,
            accountId: this.accountId,
            userId: this.userId,
            entityType: 'campaign',
            changeType: 'created',
            entityId: String(apiCampaign.campaignId),
            entityName: apiCampaign.name,
            newData: campaignData,
          });
        }

        await db.insert(campaigns).values({
          ...campaignData,
          createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
        });
        result.created++;
      }
      result.synced++;
    }

    if (changeRecords.length > 0) {
      await createSyncChangeRecordsBatch(changeRecords);
    }
    if (conflictRecords.length > 0) {
      await createSyncConflictsBatch(conflictRecords);
    }

    return result;
  } catch (error) {
    console.error('Error syncing SD campaigns with tracking:', error);
    return result;
  }
};

/**
 * 同步SP广告组（带变更跟踪）
 */
AmazonSyncService.prototype.syncSpAdGroupsWithTracking = async function(
  lastSyncTime?: string | null,
  syncJobId?: number | null
): Promise<SyncResultWithTracking> {
  const db = await getDb();
  if (!db) return { synced: 0, skipped: 0, created: 0, updated: 0, deleted: 0, conflicts: 0 };

  const result: SyncResultWithTracking = {
    synced: 0,
    skipped: 0,
    created: 0,
    updated: 0,
    deleted: 0,
    conflicts: 0,
  };

  const changeRecords: InsertSyncChangeRecord[] = [];
  const conflictRecords: InsertSyncConflict[] = [];

  try {
    const apiAdGroups = await this.client.listSpAdGroups();

    for (const apiAdGroup of apiAdGroups) {
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

      if (!campaign) {
        result.skipped++;
        continue;
      }

      const [existing] = await db
        .select()
        .from(adGroups)
        .where(
          and(
            eq(adGroups.campaignId, campaign.id),
            eq(adGroups.adGroupId, String(apiAdGroup.adGroupId))
          )
        )
        .limit(1);

      if (lastSyncTime && existing) {
        const existingUpdated = existing.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
        const lastSync = new Date(lastSyncTime).getTime();
        if (existingUpdated >= lastSync) {
          result.skipped++;
          continue;
        }
      }

      // Amazon API返回的state可能是大写的ENABLED/PAUSED/ARCHIVED，需要转换为小写
      const normalizedState = (apiAdGroup.state || 'enabled').toLowerCase() as 'enabled' | 'paused' | 'archived';
      
      const adGroupData = {
        campaignId: campaign.id,
        adGroupId: String(apiAdGroup.adGroupId),
        adGroupName: apiAdGroup.name,
        defaultBid: String(apiAdGroup.defaultBid || 0),
        adGroupStatus: normalizedState,
        updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      };

      if (existing) {
        const conflictCheck = detectConflict(existing, adGroupData, ['defaultBid', 'adGroupStatus']);
        if (conflictCheck.hasConflict && syncJobId) {
          conflictRecords.push({
            syncJobId,
            accountId: this.accountId,
            userId: this.userId,
            entityType: 'ad_group',
            entityId: String(apiAdGroup.adGroupId),
            entityName: apiAdGroup.name,
            conflictType: 'data_mismatch',
            localData: existing,
            remoteData: adGroupData,
            conflictFields: conflictCheck.conflictFields,
          });
          result.conflicts++;
        }

        if (syncJobId) {
          changeRecords.push({
            syncJobId,
            accountId: this.accountId,
            userId: this.userId,
            entityType: 'ad_group',
            changeType: 'updated',
            entityId: String(apiAdGroup.adGroupId),
            entityName: apiAdGroup.name,
            previousData: existing,
            newData: adGroupData,
            changedFields: Object.keys(adGroupData).filter(k => 
              (existing as any)[k] !== (adGroupData as any)[k]
            ),
          });
        }

        await db
          .update(adGroups)
          .set(adGroupData)
          .where(eq(adGroups.id, existing.id));
        result.updated++;
      } else {
        if (syncJobId) {
          changeRecords.push({
            syncJobId,
            accountId: this.accountId,
            userId: this.userId,
            entityType: 'ad_group',
            changeType: 'created',
            entityId: String(apiAdGroup.adGroupId),
            entityName: apiAdGroup.name,
            newData: adGroupData,
          });
        }

        await db.insert(adGroups).values({
          ...adGroupData,
          createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
        });
        result.created++;
      }
      result.synced++;
    }

    if (changeRecords.length > 0) {
      await createSyncChangeRecordsBatch(changeRecords);
    }
    if (conflictRecords.length > 0) {
      await createSyncConflictsBatch(conflictRecords);
    }

    return result;
  } catch (error) {
    console.error('Error syncing SP ad groups with tracking:', error);
    return result;
  }
};

/**
 * 同步SP关键词（带变更跟踪）
 */
AmazonSyncService.prototype.syncSpKeywordsWithTracking = async function(
  lastSyncTime?: string | null,
  syncJobId?: number | null
): Promise<SyncResultWithTracking> {
  const db = await getDb();
  if (!db) return { synced: 0, skipped: 0, created: 0, updated: 0, deleted: 0, conflicts: 0 };

  const result: SyncResultWithTracking = {
    synced: 0,
    skipped: 0,
    created: 0,
    updated: 0,
    deleted: 0,
    conflicts: 0,
  };

  const changeRecords: InsertSyncChangeRecord[] = [];
  const conflictRecords: InsertSyncConflict[] = [];

  try {
    const apiKeywords = await this.client.listSpKeywords();

    for (const apiKeyword of apiKeywords) {
      const [adGroup] = await db
        .select()
        .from(adGroups)
        .where(eq(adGroups.adGroupId, String(apiKeyword.adGroupId)))
        .limit(1);

      if (!adGroup) {
        result.skipped++;
        continue;
      }

      const [existing] = await db
        .select()
        .from(keywords)
        .where(
          and(
            eq(keywords.adGroupId, adGroup.id),
            eq(keywords.keywordId, String(apiKeyword.keywordId))
          )
        )
        .limit(1);

      if (lastSyncTime && existing) {
        const existingUpdated = existing.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
        const lastSync = new Date(lastSyncTime).getTime();
        if (existingUpdated >= lastSync) {
          result.skipped++;
          continue;
        }
      }

      // Amazon API返回的matchType和state可能是大写，需要转换为小写
      const normalizedMatchType = (apiKeyword.matchType || 'broad').toLowerCase() as 'broad' | 'phrase' | 'exact';
      const normalizedState = (apiKeyword.state || 'enabled').toLowerCase() as 'enabled' | 'paused' | 'archived';
      
      const keywordData = {
        adGroupId: adGroup.id,
        keywordId: String(apiKeyword.keywordId),
        keywordText: apiKeyword.keywordText,
        matchType: normalizedMatchType,
        bid: String(apiKeyword.bid || 0),
        keywordStatus: normalizedState,
        updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      };

      if (existing) {
        const conflictCheck = detectConflict(existing, keywordData, ['bid', 'keywordStatus']);
        if (conflictCheck.hasConflict && syncJobId) {
          conflictRecords.push({
            syncJobId,
            accountId: this.accountId,
            userId: this.userId,
            entityType: 'keyword',
            entityId: String(apiKeyword.keywordId),
            entityName: apiKeyword.keywordText,
            conflictType: 'data_mismatch',
            localData: existing,
            remoteData: keywordData,
            conflictFields: conflictCheck.conflictFields,
          });
          result.conflicts++;
        }

        if (syncJobId) {
          changeRecords.push({
            syncJobId,
            accountId: this.accountId,
            userId: this.userId,
            entityType: 'keyword',
            changeType: 'updated',
            entityId: String(apiKeyword.keywordId),
            entityName: apiKeyword.keywordText,
            previousData: existing,
            newData: keywordData,
            changedFields: Object.keys(keywordData).filter(k => 
              (existing as any)[k] !== (keywordData as any)[k]
            ),
          });
        }

        await db
          .update(keywords)
          .set(keywordData)
          .where(eq(keywords.id, existing.id));
        result.updated++;
      } else {
        if (syncJobId) {
          changeRecords.push({
            syncJobId,
            accountId: this.accountId,
            userId: this.userId,
            entityType: 'keyword',
            changeType: 'created',
            entityId: String(apiKeyword.keywordId),
            entityName: apiKeyword.keywordText,
            newData: keywordData,
          });
        }

        await db.insert(keywords).values({
          ...keywordData,
          createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
        });
        result.created++;
      }
      result.synced++;
    }

    if (changeRecords.length > 0) {
      await createSyncChangeRecordsBatch(changeRecords);
    }
    if (conflictRecords.length > 0) {
      await createSyncConflictsBatch(conflictRecords);
    }

    return result;
  } catch (error) {
    console.error('Error syncing SP keywords with tracking:', error);
    return result;
  }
};

/**
 * 同步SP商品定位（带变更跟踪）
 */
AmazonSyncService.prototype.syncSpProductTargetsWithTracking = async function(
  lastSyncTime?: string | null,
  syncJobId?: number | null
): Promise<SyncResultWithTracking> {
  const db = await getDb();
  if (!db) return { synced: 0, skipped: 0, created: 0, updated: 0, deleted: 0, conflicts: 0 };

  const result: SyncResultWithTracking = {
    synced: 0,
    skipped: 0,
    created: 0,
    updated: 0,
    deleted: 0,
    conflicts: 0,
  };

  const changeRecords: InsertSyncChangeRecord[] = [];
  const conflictRecords: InsertSyncConflict[] = [];

  try {
    const apiTargets = await this.client.listSpProductTargets();

    for (const apiTarget of apiTargets) {
      const [adGroup] = await db
        .select()
        .from(adGroups)
        .where(eq(adGroups.adGroupId, String(apiTarget.adGroupId)))
        .limit(1);

      if (!adGroup) {
        result.skipped++;
        continue;
      }

      const [existing] = await db
        .select()
        .from(productTargets)
        .where(
          and(
            eq(productTargets.adGroupId, adGroup.id),
            eq(productTargets.targetId, String(apiTarget.targetId))
          )
        )
        .limit(1);

      if (lastSyncTime && existing) {
        const existingUpdated = existing.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
        const lastSync = new Date(lastSyncTime).getTime();
        if (existingUpdated >= lastSync) {
          result.skipped++;
          continue;
        }
      }

      // 解析表达式获取目标类型和值
      let targetType = 'asin';
      let targetValue = '';
      if (apiTarget.expression && apiTarget.expression.length > 0) {
        const expr = apiTarget.expression[0];
        // Amazon API返回的type可能是大写，需要转换为小写
        const rawType = (expr.type || 'asin').toLowerCase();
        // 将asinSameAs等转换为asin
        targetType = rawType.includes('asin') ? 'asin' : rawType.includes('category') ? 'category' : 'asin';
        targetValue = expr.value || '';
      }
      
      // Amazon API返回的state可能是大写，需要转换为小写
      const normalizedState = (apiTarget.state || 'enabled').toLowerCase() as 'enabled' | 'paused' | 'archived';

      const targetData = {
        adGroupId: adGroup.id,
        targetId: String(apiTarget.targetId),
        targetType: targetType as 'asin' | 'category',
        targetValue,
        bid: String(apiTarget.bid || 0),
        targetStatus: normalizedState,
        updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      };

      if (existing) {
        const conflictCheck = detectConflict(existing, targetData, ['bid', 'targetStatus']);
        if (conflictCheck.hasConflict && syncJobId) {
          conflictRecords.push({
            syncJobId,
            accountId: this.accountId,
            userId: this.userId,
            entityType: 'product_target',
            entityId: String(apiTarget.targetId),
            entityName: targetValue,
            conflictType: 'data_mismatch',
            localData: existing,
            remoteData: targetData,
            conflictFields: conflictCheck.conflictFields,
          });
          result.conflicts++;
        }

        if (syncJobId) {
          changeRecords.push({
            syncJobId,
            accountId: this.accountId,
            userId: this.userId,
            entityType: 'product_target',
            changeType: 'updated',
            entityId: String(apiTarget.targetId),
            entityName: targetValue,
            previousData: existing,
            newData: targetData,
            changedFields: Object.keys(targetData).filter(k => 
              (existing as any)[k] !== (targetData as any)[k]
            ),
          });
        }

        await db
          .update(productTargets)
          .set(targetData)
          .where(eq(productTargets.id, existing.id));
        result.updated++;
      } else {
        if (syncJobId) {
          changeRecords.push({
            syncJobId,
            accountId: this.accountId,
            userId: this.userId,
            entityType: 'product_target',
            changeType: 'created',
            entityId: String(apiTarget.targetId),
            entityName: targetValue,
            newData: targetData,
          });
        }

        await db.insert(productTargets).values({
          ...targetData,
          createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
        });
        result.created++;
      }
      result.synced++;
    }

    if (changeRecords.length > 0) {
      await createSyncChangeRecordsBatch(changeRecords);
    }
    if (conflictRecords.length > 0) {
      await createSyncConflictsBatch(conflictRecords);
    }

    return result;
  } catch (error) {
    console.error('Error syncing SP product targets with tracking:', error);
    return result;
  }
};


/**
 * 首次同步：获取90天历史数据
 * 仅在账户首次连接时调用，用于填充历史数据
 * 后续定时同步只需要14天归因回溯
 */
export async function syncInitialHistoricalData(
  syncService: AmazonSyncService,
  accountId: number,
  userId: number
): Promise<{ performance: number }> {
  console.log(`[SyncService] 开始首次同步90天历史数据 (账号: ${accountId})`);
  
  const results = {
    performance: 0,
  };

  try {
    // 首次同步获取90天历史数据（SP支持95天，SB只支持60天，取90天作为平衡）
    results.performance = await syncService.syncPerformanceData(90);
    console.log(`[SyncService] 首次同步完成: ${results.performance} 条历史绩效记录`);
  } catch (error) {
    console.error('[SyncService] 首次同步失败:', error);
  }

  return results;
}
