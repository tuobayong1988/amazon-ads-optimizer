/**
 * Amazon API 辅助模块 (v123)
 * 
 * 提供统一的方式获取 AmazonSyncService 实例，
 * 供优化引擎各模块调用 Amazon Ads API
 * 
 * v123更新:
 * - 添加 syncNewKeywordsToAmazon: 创建新关键词并获取Amazon keywordId
 * - 增强 syncBidAdjustmentsToAmazon: 更详细的错误日志和API同步状态追踪
 * - 增强 applyBidAdjustment 的错误处理
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
    
    // 验证凭证完整性
    if (!credentials.clientId || !credentials.clientSecret || !credentials.refreshToken) {
      console.error(`[AmazonApiHelper] 账号 ${accountId} API凭证不完整: clientId=${!!credentials.clientId}, clientSecret=${!!credentials.clientSecret}, refreshToken=${!!credentials.refreshToken}`);
      return null;
    }
    
    if (!account.profileId) {
      console.error(`[AmazonApiHelper] 账号 ${accountId} 缺少profileId`);
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
 * 
 * v123增强: 更详细的错误日志，区分不同失败原因
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
  
  console.log(`[AmazonApiHelper] 开始同步出价调整: accountId=${accountId}, 总计=${adjustments.length}条`);
  
  const syncService = await getAmazonSyncService(accountId);
  if (!syncService) {
    const errorMsg = `无法获取账号 ${accountId} 的API服务（凭证缺失或无效）`;
    console.error(`[AmazonApiHelper] ${errorMsg}`);
    result.errors.push(errorMsg);
    result.failed = adjustments.length;
    return result;
  }
  
  console.log(`[AmazonApiHelper] API服务创建成功，开始逐条同步出价调整`);
  
  // v125c: 添加限流延迟和重试逻辑
  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  let consecutiveThrottles = 0;
  
  for (let i = 0; i < adjustments.length; i++) {
    const adj = adjustments[i];
    const maxRetries = 2;
    let retryCount = 0;
    let success = false;
    
    while (retryCount <= maxRetries && !success) {
      try {
        const targetType = adj.isProductTarget ? 'product_target' : 'keyword';
        if (retryCount === 0) {
          console.log(`[AmazonApiHelper] [${i+1}/${adjustments.length}] 同步出价: ${targetType} id=${adj.keywordId}, newBid=${adj.newBid}`);
        } else {
          console.log(`[AmazonApiHelper] [${i+1}/${adjustments.length}] 重试#${retryCount}: ${targetType} id=${adj.keywordId}`);
        }
        
        const apiResult = await syncService.applyBidAdjustment(
          targetType,
          adj.keywordId,
          adj.newBid,
          adj.reason,
          adj.campaignId
        );
        
        if (apiResult) {
          result.success++;
          consecutiveThrottles = 0;
          success = true;
        } else {
          // applyBidAdjustment返回false可能是限流或其他原因
          retryCount++;
          if (retryCount <= maxRetries) {
            const waitTime = 2000 * retryCount; // 递增等待时间
            console.log(`[AmazonApiHelper] ℹ️ 等待${waitTime}ms后重试...`);
            await delay(waitTime);
          } else {
            result.failed++;
            const errorMsg = `出价调整失败(重试${maxRetries}次后): ${targetType} ${adj.keywordId}`;
            result.errors.push(errorMsg);
            console.error(`[AmazonApiHelper] ❌ ${errorMsg}`);
          }
        }
      } catch (error: any) {
        const isThrottle = error.message?.includes('请求过于频繁') || error.status === 429;
        retryCount++;
        
        if (isThrottle && retryCount <= maxRetries) {
          consecutiveThrottles++;
          const waitTime = Math.min(3000 * consecutiveThrottles, 15000);
          console.log(`[AmazonApiHelper] ⚠️ 限流，等待${waitTime}ms后重试...`);
          await delay(waitTime);
        } else {
          result.failed++;
          const targetType = adj.isProductTarget ? 'product_target' : 'keyword';
          const errorMsg = `出价调整异常: ${targetType} ${adj.keywordId} - ${error.message}`;
          result.errors.push(errorMsg);
          console.error(`[AmazonApiHelper] ❌ ${errorMsg}`);
          break; // 跳出重试循环
        }
      }
    }
    
    // 每5个调用后添加小延迟，避免触发限流
    if ((i + 1) % 5 === 0 && i < adjustments.length - 1) {
      await delay(500);
    }
  }
  
  console.log(`[AmazonApiHelper] 出价同步完成: 成功=${result.success}, 失败=${result.failed}, 错误数=${result.errors.length}`);
  if (result.errors.length > 0) {
    console.error(`[AmazonApiHelper] 错误详情:`, result.errors.slice(0, 5).join('; '));
  }
  return result;
}

/**
 * 同步新关键词到 Amazon (v123新增)
 * 通过 createSpKeywords API 在Amazon中创建关键词，获取keywordId后更新本地数据库
 * 
 * @param accountId - 账号ID
 * @param newKeywords - 新关键词列表
 * @returns 创建结果，包含成功数、失败数和每个关键词的Amazon keywordId
 */
export async function syncNewKeywordsToAmazon(
  accountId: number,
  newKeywords: Array<{
    localKeywordId?: number;  // 本地数据库的keyword ID（如果已插入）
    adGroupId: number;        // Amazon AdGroup ID (数字)
    campaignId: number;       // Amazon Campaign ID (数字)
    keywordText: string;
    matchType: 'exact' | 'phrase' | 'broad';
    bid: number;
  }>
): Promise<{ success: number; failed: number; errors: string[]; createdKeywords: Array<{ localId?: number; amazonKeywordId: number; keywordText: string }> }> {
  const result = { 
    success: 0, 
    failed: 0, 
    errors: [] as string[], 
    createdKeywords: [] as Array<{ localId?: number; amazonKeywordId: number; keywordText: string }>
  };
  
  if (newKeywords.length === 0) return result;
  
  console.log(`[AmazonApiHelper] 开始同步新关键词到Amazon: accountId=${accountId}, 总计=${newKeywords.length}个`);
  
  const syncService = await getAmazonSyncService(accountId);
  if (!syncService) {
    const errorMsg = `无法获取账号 ${accountId} 的API服务`;
    result.errors.push(errorMsg);
    result.failed = newKeywords.length;
    return result;
  }
  
  try {
    // 批量调用Amazon API创建关键词
    const apiResult = await syncService.client.createSpKeywords(
      newKeywords.map(k => ({
        adGroupId: k.adGroupId,
        campaignId: k.campaignId,
        keywordText: k.keywordText,
        matchType: k.matchType,
        bid: k.bid,
        state: 'enabled' as const,
      }))
    );
    
    // 处理API返回结果
    for (let i = 0; i < apiResult.createdKeywords.length; i++) {
      const created = apiResult.createdKeywords[i];
      const original = newKeywords[i];
      
      if (created.code === 'SUCCESS' && created.keywordId) {
        result.success++;
        result.createdKeywords.push({
          localId: original.localKeywordId,
          amazonKeywordId: created.keywordId,
          keywordText: created.keywordText || original.keywordText,
        });
        
        // 如果有本地ID，更新本地数据库的keywordId
        if (original.localKeywordId) {
          try {
            const dbInstance = await db.getDb();
            if (dbInstance) {
              const { keywords } = await import('../../drizzle/schema');
              const { eq } = await import('drizzle-orm');
              await dbInstance.update(keywords)
                .set({ 
                  keywordId: String(created.keywordId),
                  updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
                })
                .where(eq(keywords.id, original.localKeywordId));
              console.log(`[AmazonApiHelper] ✅ 关键词已同步: "${original.keywordText}" -> Amazon keywordId=${created.keywordId}`);
            }
          } catch (dbError: any) {
            console.error(`[AmazonApiHelper] 更新本地keywordId失败:`, dbError.message);
          }
        }
      } else {
        result.failed++;
        result.errors.push(`关键词创建失败: "${original.keywordText}" - code=${created.code}`);
        console.error(`[AmazonApiHelper] ❌ 关键词创建失败: "${original.keywordText}", code=${created.code}`);
      }
    }
  } catch (error: any) {
    result.failed += newKeywords.length;
    result.errors.push(`批量创建关键词API调用失败: ${error.message}`);
    console.error(`[AmazonApiHelper] ❌ 批量创建关键词失败:`, error.response?.data || error.message);
  }
  
  console.log(`[AmazonApiHelper] 新关键词同步完成: 成功=${result.success}, 失败=${result.failed}`);
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
    // v125: Amazon SP API v3 要求campaignId为字符串类型
    await syncService.client.updateSpCampaign(String(campaignId), {
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
    // v125: Amazon SP API v3 要求campaignId为字符串类型
    await syncService.client.updateSpCampaign(String(campaignId), {
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
