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
} from '../drizzle/schema';
import {
  AmazonAdsApiClient,
  createAmazonAdsClient,
  AmazonApiCredentials,
  SpCampaign,
} from './amazonAdsApi';
import { calculateBidAdjustment, OptimizationTarget, PerformanceGroupConfig } from './bidOptimizer';

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

  constructor(client: AmazonAdsApiClient, accountId: number, userId: number) {
    this.client = client;
    this.accountId = accountId;
    this.userId = userId;
  }

  /**
   * 从数据库加载API凭证并创建同步服务
   */
  static async createFromCredentials(
    credentials: StoredApiCredentials,
    accountId: number,
    userId: number
  ): Promise<AmazonSyncService> {
    const apiCredentials: AmazonApiCredentials = {
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
      refreshToken: credentials.refreshToken,
      profileId: credentials.profileId,
      region: credentials.region,
    };

    const client = createAmazonAdsClient(apiCredentials);
    return new AmazonSyncService(client, accountId, userId);
  }

  /**
   * 完整同步所有数据
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
    
    // 同步绩效数据（最近30天）
    results.performance += await this.syncPerformanceData(30);

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

        // 确定广告活动类型
        const campaignType = apiCampaign.targetingType === 'auto' ? 'sp_auto' : 'sp_manual';

        const campaignData = {
          accountId: this.accountId,
          campaignId: String(apiCampaign.campaignId),
          campaignName: apiCampaign.name,
          campaignType: campaignType as 'sp_auto' | 'sp_manual' | 'sb' | 'sd',
          targetingType: apiCampaign.targetingType as 'auto' | 'manual',
          dailyBudget: String(apiCampaign.dailyBudget),
          status: apiCampaign.state as 'enabled' | 'paused' | 'archived',
          placementTopMultiplier: this.getPlacementMultiplier(apiCampaign, 'placementTop'),
          placementProductPageMultiplier: this.getPlacementMultiplier(apiCampaign, 'placementProductPage'),
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

        const adGroupData = {
          campaignId: campaign.id,
          adGroupId: String(apiAdGroup.adGroupId),
          adGroupName: apiAdGroup.name,
          status: apiAdGroup.state as 'enabled' | 'paused' | 'archived',
          defaultBid: String(apiAdGroup.defaultBid),
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

        // 解析ASIN
        const asinExpression = apiTarget.expression.find(e => e.type === 'asinSameAs');
        const targetValue = asinExpression?.value || '';
        const targetType = asinExpression ? 'asin' : 'category';

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
          status: apiTarget.state as 'enabled' | 'paused' | 'archived',
          bid: String(apiTarget.bid),
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
   */
  async syncPerformanceData(days: number = 30): Promise<number> {
    const db = await getDb();
    if (!db) return 0;

    try {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const startDateStr = startDate.toISOString().split('T')[0];
      const endDateStr = endDate.toISOString().split('T')[0];

      // 请求报告
      const reportId = await this.client.requestSpCampaignReport(startDateStr, endDateStr);
      
      // 等待并下载报告
      const reportData = await this.client.waitAndDownloadReport(reportId);
      
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

        const perfData = {
          accountId: this.accountId,
          campaignId: campaign.id,
          date: reportDateStr,
          impressions: row.impressions || 0,
          clicks: row.clicks || 0,
          spend: String(row.cost || 0),
          sales: String(row.attributedSales14d || 0),
          orders: row.attributedConversions14d || 0,
          acos: row.cost && row.attributedSales14d 
            ? String((row.cost / row.attributedSales14d) * 100) 
            : '0',
          roas: row.cost && row.attributedSales14d 
            ? String(row.attributedSales14d / row.cost) 
            : '0',
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

      return synced;
    } catch (error) {
      console.error('Error syncing performance data:', error);
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
  public getPlacementMultiplier(campaign: SpCampaign, placement: string): string {
    const adjustment = campaign.bidding?.adjustments?.find(
      a => a.predicate === placement
    );
    return adjustment ? String(adjustment.percentage) : '0';
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
 */
function detectConflict(
  existing: any,
  newData: any,
  fieldsToCheck: string[]
): { hasConflict: boolean; conflictFields: string[] } {
  const conflictFields: string[] = [];
  
  for (const field of fieldsToCheck) {
    const existingValue = existing[field];
    const newValue = newData[field];
    
    // 如果两个值都存在且不相等，可能是冲突
    if (existingValue !== undefined && newValue !== undefined) {
      // 转换为字符串进行比较
      const existingStr = String(existingValue);
      const newStr = String(newValue);
      
      if (existingStr !== newStr) {
        conflictFields.push(field);
      }
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
export async function syncSpCampaignsWithTracking(
  service: AmazonSyncService,
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
    const apiCampaigns = await service.client.listSpCampaigns();

    for (const apiCampaign of apiCampaigns) {
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

      // 增量同步检查
      if (lastSyncTime && existing) {
        const existingUpdated = existing.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
        const lastSync = new Date(lastSyncTime).getTime();
        if (existingUpdated >= lastSync) {
          result.skipped++;
          continue;
        }
      }

      const campaignType = apiCampaign.targetingType === 'auto' ? 'sp_auto' : 'sp_manual';
      const campaignData = {
        accountId: service.accountId,
        campaignId: String(apiCampaign.campaignId),
        campaignName: apiCampaign.name,
        campaignType: campaignType as 'sp_auto' | 'sp_manual' | 'sb' | 'sd',
        targetingType: apiCampaign.targetingType as 'auto' | 'manual',
        dailyBudget: String(apiCampaign.dailyBudget),
        status: apiCampaign.state as 'enabled' | 'paused' | 'archived',
        placementTopMultiplier: service.getPlacementMultiplier(apiCampaign, 'placementTop'),
        placementProductPageMultiplier: service.getPlacementMultiplier(apiCampaign, 'placementProductPage'),
        updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      };

      if (existing) {
        // 检测冲突
        const conflictCheck = detectConflict(existing, campaignData, ['dailyBudget', 'status']);
        if (conflictCheck.hasConflict && syncJobId) {
          conflictRecords.push({
            syncJobId,
            accountId: service.accountId,
            userId: service.userId,
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
            accountId: service.accountId,
            userId: service.userId,
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
            accountId: service.accountId,
            userId: service.userId,
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
  } catch (error) {
    console.error('Error syncing SP campaigns with tracking:', error);
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

      const adGroupData = {
        campaignId: campaign.id,
        adGroupId: String(apiAdGroup.adGroupId),
        adGroupName: apiAdGroup.name,
        defaultBid: String(apiAdGroup.defaultBid),
        adGroupStatus: apiAdGroup.state as 'enabled' | 'paused' | 'archived',
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

      const keywordData = {
        adGroupId: adGroup.id,
        keywordId: String(apiKeyword.keywordId),
        keywordText: apiKeyword.keywordText,
        matchType: apiKeyword.matchType as 'broad' | 'phrase' | 'exact',
        bid: String(apiKeyword.bid),
        keywordStatus: apiKeyword.state as 'enabled' | 'paused' | 'archived',
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
        targetType = expr.type || 'asin';
        targetValue = expr.value || '';
      }

      const targetData = {
        adGroupId: adGroup.id,
        targetId: String(apiTarget.targetId),
        targetType: targetType as 'asin' | 'category',
        targetValue,
        bid: String(apiTarget.bid),
        targetStatus: apiTarget.state as 'enabled' | 'paused' | 'archived',
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
