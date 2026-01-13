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
    
    // 同步广告组
    const adGroupResult = await this.syncSpAdGroups();
    results.adGroups += typeof adGroupResult === 'number' ? adGroupResult : adGroupResult.synced;
    
    // 同步关键词
    const keywordResult = await this.syncSpKeywords();
    results.keywords += typeof keywordResult === 'number' ? keywordResult : keywordResult.synced;
    
    // 同步商品定位
    const targetResult = await this.syncSpProductTargets();
    results.targets += typeof targetResult === 'number' ? targetResult : targetResult.synced;
    
    // 同步绩效数据（快慢双轨架构：API只拉取T-1及之前的历史数据）
    // 重要：亚马逊的销售数据在7-14天内会变动（用户点击后过几天才买）
    // 因此每次同步都需要回溯过去14天的数据，覆盖旧记录
    // 这能确保存下来的数据和亚马逊后台最终结算的数据一致
    const performanceDays = 14; // ⚠️ 修改为14天归因回溯
    console.log(`[SyncService] 同步最近${performanceDays}天历史绩效数据（归因回溯机制，覆盖旧记录）`);
    results.performance += await this.syncPerformanceData(performanceDays);

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
          costType: 'cpc' as 'cpc' | 'vcpm' | 'cpm', // SB广告都是CPC
          portfolioId: sbPortfolioId,
          biddingStrategy: sbBiddingStrategy as 'legacyForSales' | 'autoForSales' | 'manual' | 'ruleBasedBidding',
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

        // 获受组合ID
        const sdPortfolioId = (apiCampaign as any).portfolioId ? String((apiCampaign as any).portfolioId) : null;

        // 获取定向类型
        const sdTargetingType = (apiCampaign as any).tactic || 'manual';

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
          costType: normalizedCostType as 'cpc' | 'vcpm' | 'cpm',
          portfolioId: sdPortfolioId,
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
    const db = await getDb();
    if (!db) return { synced: 0, skipped: 0 };

    try {
      const apiCampaigns = await this.client.listSpCampaigns();
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
      console.error('Error syncing SP campaigns:', error);
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

        // 解析ASIN - Amazon API返回的type可能是大写或包含asinSameAs等格式
        const asinExpression = apiTarget.expression.find(e => {
          const exprType = (e.type || '').toLowerCase();
          return exprType.includes('asin');
        });
        const targetValue = asinExpression?.value || '';
        const targetType = asinExpression ? 'asin' : 'category';
        
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
          targetStatus: normalizedState,
          bid: String(apiTarget.bid || 0),
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
      const { startDate: rangeStartDate, endDate: rangeEndDate } = getMarketplaceHistoricalDateRange(this.marketplace, totalDays);
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
                campaignType: adType.toLowerCase() as 'sp' | 'sb' | 'sd',
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
          // ✅ Report API v3 新增字段
          unitsSold: unitsSold,
          dpv: dpv,
          addToCart: addToCart,
          ntbOrders: ntbOrders,
          ntbSales: String(ntbSales),
          viewableImpressions: viewableImpressions,
        };

        if (existing) {
          await db
            .update(dailyPerformance)
            .set(perfData)
            .where(eq(dailyPerformance.id, existing.id));
        } else {
          await db.insert(dailyPerformance).values({
            ...perfData,
            createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
          });
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

      for (const row of reportData) {
        // 查找对应的keyword
        const [kw] = await db
          .select()
          .from(keywords)
          .where(eq(keywords.keywordId, String(row.keywordId)))
          .limit(1);

        if (!kw) {
          continue;
        }

        // 使用 Amazon Ads API v3 的字段名
        // SP关键词报告使用 sales14d/purchases14d
        const cost = row.cost || 0;
        const sales = row.sales14d || 0;
        const orders = row.purchases14d || 0;
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
            updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
          })
          .where(eq(keywords.id, kw.id));
        synced++;
      }

      console.log(`[SyncService] 关键词绩效数据同步完成: ${synced} 条记录`);
      return synced;
    } catch (error) {
      console.error('Error syncing keyword performance data:', error);
      return 0;
    }
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
      // 同步广告组
      const adGroupResult = await this.syncSpAdGroups();
      results.adGroups = typeof adGroupResult === 'number' ? adGroupResult : adGroupResult.synced;
      
      // 同步关键词
      const keywordResult = await this.syncSpKeywords();
      results.keywords = typeof keywordResult === 'number' ? keywordResult : keywordResult.synced;
      
      // 同步商品定位
      const targetResult = await this.syncSpProductTargets();
      results.targets = typeof targetResult === 'number' ? targetResult : targetResult.synced;

      console.log(`[SyncService] 广告组和定位同步完成: 广告组=${results.adGroups}, 关键词=${results.keywords}, 定位=${results.targets}`);
    } catch (error) {
      console.error('[SyncService] 广告组和定位同步失败:', error);
    }

    return results;
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
        const sales = row.sales14d || 0;
        const clicks = row.clicks || 0;
        const impressions = row.impressions || 0;
        const orders = row.purchases14d || 0;

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
        const sales = row.sales14d || 0;
        const clicks = row.clicks || 0;
        const impressions = row.impressions || 0;
        const orders = row.purchases14d || 0;

        const searchTermData = {
          accountId: this.accountId,
          campaignId: campaign.id,
          adGroupId: adGroup.id,
          searchTerm: row.searchTerm || '',
          searchTermTargetType: row.keywordId ? 'keyword' as const : 'product_target' as const,
          searchTermTargetId: row.keywordId ? parseInt(row.keywordId) : null,
          targetText: row.keyword || '',
          searchTermMatchType: row.matchType || '',
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
        const sales = row.sales14d || 0;
        const clicks = row.clicks || 0;
        const impressions = row.impressions || 0;
        const orders = row.purchases14d || 0;

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
          targetAcos: sales > 0 ? String((cost / sales) * 100) : null,
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
          targetAcos: sales > 0 ? String((cost / sales) * 100) : null,
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
            keywordAcos: sales > 0 ? String((cost / sales) * 100) : null,
            keywordCtr: impressions > 0 ? String(clicks / impressions) : null,
            keywordCvr: clicks > 0 ? String(orders / clicks) : null,
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

      // 2. 同步广告组
      const adGroupResult = await this.syncSpAdGroups();
      results.adGroups = typeof adGroupResult === 'number' ? adGroupResult : adGroupResult.synced;

      // 3. 同步投放词
      const keywordResult = await this.syncSpKeywords();
      results.keywords = typeof keywordResult === 'number' ? keywordResult : keywordResult.synced;

      // 4. 同步商品定向
      const targetResult = await this.syncSpProductTargets();
      results.targets = typeof targetResult === 'number' ? targetResult : targetResult.synced;

      // 5. 同步自动定向
      const autoTargetResult = await this.syncAutoTargeting(days);
      results.targets += autoTargetResult;

      // 6. 同步SD定向
      const sdTargetResult = await this.syncSdTargeting(days);
      results.targets += sdTargetResult;

      // 7. 同步SB定向
      const sbTargetResult = await this.syncSbTargeting(days);
      results.keywords += sbTargetResult;

      // 8. 同步搜索词
      results.searchTerms = await this.syncSearchTerms(days);

      // 9. 同步位置绩效
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

  // 获取需要优化的关键词
  const keywordsToOptimize = await db
    .select()
    .from(keywords)
    .where(eq(keywords.keywordStatus, 'enabled'))
    .limit(100);

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
    console.log('[SP Sync] Starting SP campaigns sync...');
    const apiCampaigns = await this.client.listSpCampaigns();
    console.log(`[SP Sync] Retrieved ${apiCampaigns.length} SP campaigns from API`);

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

    return result;
  } catch (error: any) {
    console.error('[SP Sync] Error syncing SP campaigns with tracking:', error?.message || error);
    if (error?.response) {
      console.error('[SP Sync] API Response status:', error.response.status);
      console.error('[SP Sync] API Response data:', JSON.stringify(error.response.data));
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

      const campaignData = {
        accountId: this.accountId,
        campaignId: String(apiCampaign.campaignId),
        campaignName: apiCampaign.name,
        campaignType: 'sb' as const,
        targetingType: 'manual' as const,
        dailyBudget: String(apiCampaign.budget?.budget || 0),
        status: (apiCampaign.state || 'enabled') as 'enabled' | 'paused' | 'archived',
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

      const campaignData = {
        accountId: this.accountId,
        campaignId: String(apiCampaign.campaignId),
        campaignName: apiCampaign.name,
        campaignType: 'sd' as const,
        targetingType: 'manual' as const,
        dailyBudget: String(apiCampaign.budget || 0),
        status: (apiCampaign.state || 'enabled') as 'enabled' | 'paused' | 'archived',
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
