/**
 * Amazon API 辅助模块 (v122)
 * 
 * 提供统一的方式获取 AmazonSyncService 实例，
 * 供优化引擎各模块调用 Amazon Ads API
 */
import { AmazonSyncService } from '../amazonSyncService';
import * as db from '../db';

/**
 * 根据 accountId 创建 AmazonSyncService 实例
 * 自动从数据库加载 API 凭证和账号信息
 */
export async function getAmazonSyncService(accountId: number): Promise<AmazonSyncService | null> {
  try {
    // 获取账号信息
    const account = await db.getAdAccountById(accountId);
    if (!account) {
      console.error(`[AmazonApiHelper] 账号 ${accountId} 不存在`);
      return null;
    }
    
    // 获取API凭证
    const credentials = await db.getAmazonApiCredentials(accountId);
    if (!credentials) {
      console.error(`[AmazonApiHelper] 账号 ${accountId} 未配置API凭证`);
      return null;
    }
    
    // 创建SyncService实例
    const syncService = await AmazonSyncService.createFromCredentials(
      {
        clientId: credentials.clientId || '',
        clientSecret: credentials.clientSecret || '',
        refreshToken: credentials.refreshToken || '',
        profileId: account.profileId || '',
        region: (credentials.region as 'NA' | 'EU' | 'FE') || 'NA'
      },
      accountId,
      account.userId,
      account.marketplace || 'US'
    );
    
    return syncService;
  } catch (error: any) {
    console.error(`[AmazonApiHelper] 创建SyncService失败 (accountId=${accountId}):`, error.message);
    return null;
  }
}

/**
 * 批量同步出价调整到 Amazon
 * 将本地数据库的出价变更推送到 Amazon Ads API
 */
export async function syncBidAdjustmentsToAmazon(
  accountId: number,
  adjustments: Array<{
    keywordId: number;
    newBid: number;
    campaignId: number;
    reason: string;
    isProductTarget?: boolean;
  }>
): Promise<{ success: number; failed: number; errors: string[] }> {
  const result = { success: 0, failed: 0, errors: [] as string[] };
  
  if (adjustments.length === 0) return result;
  
  const syncService = await getAmazonSyncService(accountId);
  if (!syncService) {
    result.errors.push(`无法获取账号 ${accountId} 的API服务`);
    result.failed = adjustments.length;
    return result;
  }
  
  for (const adj of adjustments) {
    try {
      const targetType = adj.isProductTarget ? 'product_target' : 'keyword';
      const success = await syncService.applyBidAdjustment(
        targetType,
        adj.keywordId,
        adj.newBid,
        adj.reason,
        adj.campaignId
      );
      
      if (success) {
        result.success++;
      } else {
        result.failed++;
        result.errors.push(`出价调整失败: ${targetType} ${adj.keywordId}`);
      }
    } catch (error: any) {
      result.failed++;
      result.errors.push(`出价调整异常: ${adj.keywordId} - ${error.message}`);
    }
  }
  
  console.log(`[AmazonApiHelper] 出价同步完成: 成功=${result.success}, 失败=${result.failed}`);
  return result;
}

/**
 * 同步预算调整到 Amazon
 * 通过 updateSpCampaign API 更新 Campaign 的 dailyBudget
 */
export async function syncBudgetAdjustmentToAmazon(
  accountId: number,
  campaignId: string,  // Amazon Campaign ID
  newBudget: number,
  reason: string
): Promise<boolean> {
  const syncService = await getAmazonSyncService(accountId);
  if (!syncService) return false;
  
  try {
    await syncService.client.updateSpCampaign(parseInt(campaignId), {
      dailyBudget: newBudget,
    });
    console.log(`[AmazonApiHelper] 预算同步成功: Campaign ${campaignId}, 新预算=$${newBudget}`);
    return true;
  } catch (error: any) {
    console.error(`[AmazonApiHelper] 预算同步失败: Campaign ${campaignId}:`, error.message);
    return false;
  }
}

/**
 * 同步位置倾斜调整到 Amazon
 * 通过 updateSpCampaign API 更新 Campaign 的 bidding.adjustments
 */
export async function syncPlacementAdjustmentToAmazon(
  accountId: number,
  campaignId: string,  // Amazon Campaign ID
  topOfSearchPercent: number,
  productPagePercent: number,
  reason: string
): Promise<boolean> {
  const syncService = await getAmazonSyncService(accountId);
  if (!syncService) return false;
  
  try {
    await syncService.client.updateSpCampaign(parseInt(campaignId), {
      bidding: {
        adjustments: [
          { predicate: 'placementTop', percentage: Math.round(topOfSearchPercent) },
          { predicate: 'placementProductPage', percentage: Math.round(productPagePercent) },
        ],
      },
    } as any);
    console.log(`[AmazonApiHelper] 位置倾斜同步成功: Campaign ${campaignId}, ` +
      `Top=${topOfSearchPercent}%, ProductPage=${productPagePercent}%`);
    return true;
  } catch (error: any) {
    console.error(`[AmazonApiHelper] 位置倾斜同步失败: Campaign ${campaignId}:`, error.message);
    return false;
  }
}

/**
 * 同步否定关键词到 Amazon
 * 通过 createSpCampaignNegativeKeywords 或 createSpNegativeKeywords API
 */
export async function syncNegativeKeywordsToAmazon(
  accountId: number,
  negatives: Array<{
    campaignId: number;  // Amazon Campaign ID (numeric)
    adGroupId?: number;  // Amazon AdGroup ID (numeric, optional for campaign-level)
    keywordText: string;
    matchType: 'negativeExact' | 'negativePhrase';
    level: 'campaign' | 'adgroup';
  }>
): Promise<{ success: number; failed: number; errors: string[] }> {
  const result = { success: 0, failed: 0, errors: [] as string[] };
  
  if (negatives.length === 0) return result;
  
  const syncService = await getAmazonSyncService(accountId);
  if (!syncService) {
    result.errors.push(`无法获取账号 ${accountId} 的API服务`);
    result.failed = negatives.length;
    return result;
  }
  
  // 分组: campaign级别 vs adgroup级别
  const campaignLevel = negatives.filter(n => n.level === 'campaign');
  const adGroupLevel = negatives.filter(n => n.level === 'adgroup' && n.adGroupId);
  
  // 批量创建campaign级别否定关键词
  if (campaignLevel.length > 0) {
    try {
      const results = await syncService.client.createSpCampaignNegativeKeywords(
        campaignLevel.map(n => ({
          campaignId: n.campaignId,
          keywordText: n.keywordText,
          matchType: n.matchType,
        }))
      );
      
      for (const r of results) {
        if (r.code === 'SUCCESS' || r.keywordId) {
          result.success++;
        } else {
          result.failed++;
          result.errors.push(`Campaign否定词失败: ${r.details}`);
        }
      }
    } catch (error: any) {
      result.failed += campaignLevel.length;
      result.errors.push(`Campaign否定词批量创建失败: ${error.message}`);
    }
  }
  
  // 批量创建adgroup级别否定关键词
  if (adGroupLevel.length > 0) {
    try {
      const results = await syncService.client.createSpNegativeKeywords(
        adGroupLevel.map(n => ({
          adGroupId: n.adGroupId!,
          campaignId: n.campaignId,
          keywordText: n.keywordText,
          matchType: n.matchType,
        }))
      );
      
      for (const r of results) {
        if (r.code === 'SUCCESS' || r.keywordId) {
          result.success++;
        } else {
          result.failed++;
          result.errors.push(`AdGroup否定词失败: ${r.details}`);
        }
      }
    } catch (error: any) {
      result.failed += adGroupLevel.length;
      result.errors.push(`AdGroup否定词批量创建失败: ${error.message}`);
    }
  }
  
  console.log(`[AmazonApiHelper] 否定词同步完成: 成功=${result.success}, 失败=${result.failed}`);
  return result;
}
