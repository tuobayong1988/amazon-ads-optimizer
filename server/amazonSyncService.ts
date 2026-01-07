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
  private client: AmazonAdsApiClient;
  private accountId: number;
  private userId: number;

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
  }> {
    const results = {
      campaigns: 0,
      adGroups: 0,
      keywords: 0,
      targets: 0,
      performance: 0,
    };

    // 同步SP广告活动
    results.campaigns += await this.syncSpCampaigns();
    
    // 同步广告组
    results.adGroups += await this.syncSpAdGroups();
    
    // 同步关键词
    results.keywords += await this.syncSpKeywords();
    
    // 同步商品定位
    results.targets += await this.syncSpProductTargets();
    
    // 同步绩效数据（最近30天）
    results.performance += await this.syncPerformanceData(30);

    return results;
  }

  /**
   * 同步SP广告活动
   */
  async syncSpCampaigns(): Promise<number> {
    const db = await getDb();
    if (!db) return 0;

    try {
      const apiCampaigns = await this.client.listSpCampaigns();
      let synced = 0;

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
          updatedAt: new Date(),
        };

        if (existing) {
          await db
            .update(campaigns)
            .set(campaignData)
            .where(eq(campaigns.id, existing.id));
        } else {
          await db.insert(campaigns).values({
            ...campaignData,
            createdAt: new Date(),
          });
        }
        synced++;
      }

      return synced;
    } catch (error) {
      console.error('Error syncing SP campaigns:', error);
      return 0;
    }
  }

  /**
   * 同步SP广告组
   */
  async syncSpAdGroups(): Promise<number> {
    const db = await getDb();
    if (!db) return 0;

    try {
      const apiAdGroups = await this.client.listSpAdGroups();
      let synced = 0;

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

        const adGroupData = {
          campaignId: campaign.id,
          adGroupId: String(apiAdGroup.adGroupId),
          adGroupName: apiAdGroup.name,
          status: apiAdGroup.state as 'enabled' | 'paused' | 'archived',
          defaultBid: String(apiAdGroup.defaultBid),
          updatedAt: new Date(),
        };

        if (existing) {
          await db
            .update(adGroups)
            .set(adGroupData)
            .where(eq(adGroups.id, existing.id));
        } else {
          await db.insert(adGroups).values({
            ...adGroupData,
            createdAt: new Date(),
          });
        }
        synced++;
      }

      return synced;
    } catch (error) {
      console.error('Error syncing SP ad groups:', error);
      return 0;
    }
  }

  /**
   * 同步SP关键词
   */
  async syncSpKeywords(): Promise<number> {
    const db = await getDb();
    if (!db) return 0;

    try {
      const apiKeywords = await this.client.listSpKeywords();
      let synced = 0;

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

        const keywordData = {
          adGroupId: adGroup.id,
          keywordId: String(apiKeyword.keywordId),
          keywordText: apiKeyword.keywordText,
          matchType: apiKeyword.matchType as 'broad' | 'phrase' | 'exact',
          status: apiKeyword.state as 'enabled' | 'paused' | 'archived',
          bid: String(apiKeyword.bid),
          updatedAt: new Date(),
        };

        if (existing) {
          await db
            .update(keywords)
            .set(keywordData)
            .where(eq(keywords.id, existing.id));
        } else {
          await db.insert(keywords).values({
            ...keywordData,
            createdAt: new Date(),
          });
        }
        synced++;
      }

      return synced;
    } catch (error) {
      console.error('Error syncing SP keywords:', error);
      return 0;
    }
  }

  /**
   * 同步SP商品定位
   */
  async syncSpProductTargets(): Promise<number> {
    const db = await getDb();
    if (!db) return 0;

    try {
      const apiTargets = await this.client.listSpProductTargets();
      let synced = 0;

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

        const targetData = {
          adGroupId: adGroup.id,
          targetId: String(apiTarget.targetId),
          targetType: targetType as 'asin' | 'category',
          targetValue,
          targetExpression: JSON.stringify(apiTarget.expression),
          status: apiTarget.state as 'enabled' | 'paused' | 'archived',
          bid: String(apiTarget.bid),
          updatedAt: new Date(),
        };

        if (existing) {
          await db
            .update(productTargets)
            .set(targetData)
            .where(eq(productTargets.id, existing.id));
        } else {
          await db.insert(productTargets).values({
            ...targetData,
            createdAt: new Date(),
          });
        }
        synced++;
      }

      return synced;
    } catch (error) {
      console.error('Error syncing SP product targets:', error);
      return 0;
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
          date: reportDate,
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
            createdAt: new Date(),
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
          .set({ bid: String(newBid), updatedAt: new Date() })
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
          .set({ bid: String(newBid), updatedAt: new Date() })
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
        targetType: targetType === 'keyword' ? 'keyword' : 'product_target',
        targetId,
        targetName,
        actionType: actionType as 'increase' | 'decrease' | 'set',
        previousBid: String(oldBid),
        newBid: String(newBid),
        bidChangePercent: String(bidChangePercent),
        reason,
        algorithmVersion: 'v1.0',
        isIntradayAdjustment: false,
        createdAt: new Date(),
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
  private getPlacementMultiplier(campaign: SpCampaign, placement: string): string {
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
    .where(eq(keywords.status, 'enabled'))
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
