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

// v189: 统一的API调用重试工具函数
async function withRetry<T>(
  fn: () => Promise<T>,
  options: { maxRetries?: number; baseDelayMs?: number; label?: string } = {}
): Promise<T> {
  const { maxRetries = 2, baseDelayMs = 2000, label = 'API' } = options;
  let lastError: any;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      const isThrottle = error.response?.status === 429 || error.message?.includes('请求过于频繁') || error.message?.includes('Too Many Requests');
      const isServerError = error.response?.status >= 500;
      const isRetryable = isThrottle || isServerError || error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT';
      
      if (!isRetryable || attempt >= maxRetries) {
        throw error;
      }
      
      const delay = isThrottle 
        ? Math.min(baseDelayMs * Math.pow(2, attempt), 15000) 
        : baseDelayMs * (attempt + 1);
      console.log(`[AmazonApiHelper] ${label} 第${attempt + 1}次重试，等待${delay}ms... (${error.message?.substring(0, 80)})`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

/**
 * 根据 accountId 创建 AmazonSyncService 实例
 * 自动从数据库加载 API 凭证和账号信息
 */
export async function getAmazonSyncService(accountId: number): Promise<AmazonSyncService | null> {
  // v190: 添加重试机制 - DB临时中断或网络波动时自动重试
  const MAX_RETRIES = 2;
  const RETRY_DELAY_MS = 3000;
  
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      // 获取账号信息
      const account = await db.getAdAccountById(accountId);
      if (!account) {
        console.error(`[AmazonApiHelper] 账号 ${accountId} 不存在`);
        return null; // 账号不存在是确定性错误，不重试
      }
      
      // 获取API凭证
      const credentials = await db.getAmazonApiCredentials(accountId);
      if (!credentials) {
        console.error(`[AmazonApiHelper] 账号 ${accountId} 未配置API凭证`);
        return null; // 凭证未配置是确定性错误，不重试
      }
      
      // 验证凭证完整性
      if (!credentials.clientId || !credentials.clientSecret || !credentials.refreshToken) {
        console.error(`[AmazonApiHelper] 账号 ${accountId} API凭证不完整: clientId=${!!credentials.clientId}, clientSecret=${!!credentials.clientSecret}, refreshToken=${!!credentials.refreshToken}`);
        return null; // 凭证不完整是确定性错误，不重试
      }
      
      if (!account.profileId) {
        console.error(`[AmazonApiHelper] 账号 ${accountId} 缺少profileId`);
        return null; // profileId缺失是确定性错误，不重试
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
      const isRetryable = error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || 
                          error.code === 'ECONNREFUSED' || error.code === 'PROTOCOL_CONNECTION_LOST' ||
                          error.message?.includes('Connection lost') || error.message?.includes('ECONNRESET');
      
      if (isRetryable && attempt < MAX_RETRIES) {
        const waitTime = RETRY_DELAY_MS * (attempt + 1);
        console.warn(`[AmazonApiHelper] 创建SyncService失败(可重试), 第${attempt + 1}次重试, 等待${waitTime}ms... (accountId=${accountId}): ${error.message}`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }
      
      console.error(`[AmazonApiHelper] 创建SyncService失败 (accountId=${accountId}, 已重试${attempt}次):`, error.message);
      return null;
    }
  }
  return null;
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
): Promise<{ success: number; failed: number; errors: string[]; itemResults: Map<number, { status: 'synced' | 'failed'; error?: string }> }> {
  const result = { success: 0, failed: 0, errors: [] as string[], itemResults: new Map<number, { status: 'synced' | 'failed'; error?: string }>() };
  
  if (adjustments.length === 0) return result;
  
  console.log(`[AmazonApiHelper] 开始同步出价调整: accountId=${accountId}, 总计=${adjustments.length}条`);
  
  const syncService = await getAmazonSyncService(accountId);
  if (!syncService) {
    const errorMsg = `无法获取账号 ${accountId} 的API服务（凭证缺失或无效）`;
    console.error(`[AmazonApiHelper] ${errorMsg}`);
    result.errors.push(errorMsg);
    result.failed = adjustments.length;
    // v140: 标记所有条目为失败
    for (const adj of adjustments) {
      result.itemResults.set(adj.keywordId, { status: 'failed', error: errorMsg });
    }
    return result;
  }
  
  console.log(`[AmazonApiHelper] API服务创建成功，开始同步出价调整`);
  
  // v149: 幂等性保障 - 同一批次内去重（同一关键词只保留最后一次调整）
  const deduped = new Map<number, typeof adjustments[0]>();
  for (const adj of adjustments) {
    deduped.set(adj.keywordId, adj); // 后出现的覆盖先出现的
  }
  const uniqueAdjustments = Array.from(deduped.values());
  if (uniqueAdjustments.length < adjustments.length) {
    console.log(`[AmazonApiHelper] 幂等性去重: ${adjustments.length}条 -> ${uniqueAdjustments.length}条（去除${adjustments.length - uniqueAdjustments.length}个重复关键词）`);
  }
  
  // v125c: 添加限流延迟和重试逻辑
  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  let consecutiveThrottles = 0;
  
  for (let i = 0; i < uniqueAdjustments.length; i++) {
    const adj = uniqueAdjustments[i];
    const maxRetries = 2;
    let retryCount = 0;
    let success = false;
    
    while (retryCount <= maxRetries && !success) {
      try {
        const targetType = adj.isProductTarget ? 'product_target' : 'keyword';
        if (retryCount === 0) {
          console.log(`[AmazonApiHelper] [${i+1}/${uniqueAdjustments.length}] 同步出价: ${targetType} id=${adj.keywordId}, newBid=${adj.newBid}`);
        } else {
          console.log(`[AmazonApiHelper] [${i+1}/${uniqueAdjustments.length}] 重试#${retryCount}: ${targetType} id=${adj.keywordId}`);
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
          result.itemResults.set(adj.keywordId, { status: 'synced' });
        } else {
          result.failed++;
          const targetType2 = adj.isProductTarget ? 'product_target' : 'keyword';
          const errorMsg = `出价调整失败: ${targetType2} ${adj.keywordId}`;
          result.errors.push(errorMsg);
          console.error(`[AmazonApiHelper] ❌ ${errorMsg}`);
          result.itemResults.set(adj.keywordId, { status: 'failed', error: '记录不存在或Amazon ID无效' });
          // v155: 不再 break，继续处理下一个关键词，避免一个失败导致整个批次中断
          break; // break inner while loop only
        }
      } catch (error: any) {
        const isMissingId = error.message?.includes('MISSING_AMAZON_ID');
        const isThrottle = error.message?.includes('请求过于频繁') || error.status === 429;
        
        if (isMissingId) {
          // v190: MISSING_AMAZON_ID不在即时重试中重试（因为ID不会在几秒内出现）
          // 但标记为可重试失败，让其进入重试队列，在下次ID回填后自动重新执行
          result.failed++;
          const targetType = adj.isProductTarget ? 'product_target' : 'keyword';
          const errMsg = `${targetType} ${adj.keywordId}: 缺少Amazon ID（将通过重试队列自动重试）`;
          result.errors.push(errMsg);
          result.itemResults.set(adj.keywordId, { status: 'failed', error: '缺少Amazon ID（可重试）' });
          break; // break while但继续 for循环
        }
        
        retryCount++;
        if (isThrottle && retryCount <= maxRetries) {
          consecutiveThrottles++;
          const waitTime = Math.min(3000 * consecutiveThrottles, 15000);
          console.log(`[AmazonApiHelper] ⚠️ 限流，等待${waitTime}ms后重试...`);
          await delay(waitTime);
        } else if (retryCount <= maxRetries) {
          const waitTime = 2000 * retryCount;
          console.log(`[AmazonApiHelper] ℹ️ API错误，等待${waitTime}ms后重试...`);
          await delay(waitTime);
        } else {
          result.failed++;
          const targetType = adj.isProductTarget ? 'product_target' : 'keyword';
          const errorMsg = `出价调整异常(重试${maxRetries}次后): ${targetType} ${adj.keywordId} - ${error.message}`;
          result.errors.push(errorMsg);
          console.error(`[AmazonApiHelper] ❌ ${errorMsg}`);
          result.itemResults.set(adj.keywordId, { status: 'failed', error: `API异常: ${error.message?.substring(0, 100)}` });
          break;
        }
      }
    }
    
    // 每5个调用后添加小延迟，避免触发限流
    if ((i + 1) % 5 === 0 && i < uniqueAdjustments.length - 1) {
      await delay(500);
    }
  }
  
  const totalAttempts = result.success + result.failed;
  const failureRate = totalAttempts > 0 ? (result.failed / totalAttempts) * 100 : 0;
  console.log(`[AmazonApiHelper] 出价同步完成: 成功=${result.success}, 失败=${result.failed}, 成功率=${(100 - failureRate).toFixed(1)}%`);
  if (result.errors.length > 0) {
    console.error(`[AmazonApiHelper] 错误详情:`, result.errors.slice(0, 5).join('; '));
  }
  
  // v126: API同步失败率监控告警
  const FAILURE_RATE_THRESHOLD = 20; // 失败率超过20%触发告警
  if (failureRate > FAILURE_RATE_THRESHOLD && totalAttempts >= 5) {
    console.error(`[ALERT] ⚠️ Amazon API同步失败率过高! 失败率=${failureRate.toFixed(1)}% (阈值=${FAILURE_RATE_THRESHOLD}%), 成功=${result.success}, 失败=${result.failed}`);
    console.error(`[ALERT] 请检查Amazon API凭证、配额和网络状态`);
    
    // 将告警信息写入数据库，便于前端展示
    try {
      const dbInstance = await db.getDb();
      if (dbInstance) {
        const { sql } = await import('drizzle-orm');
        const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
        const alertMsg = `Amazon API出价同步失败率${failureRate.toFixed(1)}%（成功${result.success}/失败${result.failed}），超过${FAILURE_RATE_THRESHOLD}%阈值`;
        const errorSummary = result.errors.slice(0, 3).join('; ');
        await dbInstance.execute(sql`INSERT INTO system_alerts (alert_type, alert_level, alert_message, alert_details, account_id, created_at) VALUES (${'api_sync_failure'}, ${'warning'}, ${alertMsg}, ${errorSummary}, ${accountId}, ${now}) ON DUPLICATE KEY UPDATE alert_message = VALUES(alert_message), created_at = VALUES(created_at)`);
      }
    } catch (alertErr: any) {
      // system_alerts表可能不存在，忽略错误
      console.warn(`[ALERT] 告警写入数据库失败（表可能不存在）: ${alertErr.message}`);
    }
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
  
  // v127: 分批处理机制 - 每批最多50个关键词，批间延迟1秒避免限流
  const BATCH_SIZE = 50;
  const BATCH_DELAY_MS = 1000;
  const totalBatches = Math.ceil(newKeywords.length / BATCH_SIZE);
  console.log(`[AmazonApiHelper] 分批处理: 总计${newKeywords.length}个关键词, 分${totalBatches}批, 每批最多${BATCH_SIZE}个`);
  
  for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
    const batchStart = batchIdx * BATCH_SIZE;
    const batchEnd = Math.min(batchStart + BATCH_SIZE, newKeywords.length);
    const batch = newKeywords.slice(batchStart, batchEnd);
    
    console.log(`[AmazonApiHelper] 处理第${batchIdx + 1}/${totalBatches}批: ${batch.length}个关键词 (索引 ${batchStart}-${batchEnd - 1})`);
    
    try {
      // v190: 添加withRetry包装批次API调用，自动重试限流和服务器错误
      const apiResult = await withRetry(
        () => syncService.client.createSpKeywords(
          batch.map(k => ({
            adGroupId: k.adGroupId,
            campaignId: k.campaignId,
            keywordText: k.keywordText,
            matchType: k.matchType,
            bid: k.bid,
            state: 'enabled' as const,
          }))
        ),
        { maxRetries: 2, baseDelayMs: 3000, label: `createSpKeywords-batch${batchIdx + 1}` }
      );
      
      // 处理API返回结果
      for (let i = 0; i < apiResult.createdKeywords.length; i++) {
        const created = apiResult.createdKeywords[i];
        const original = batch[i];
        
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
              // v132: 使用mysql2直接连接更新keywordId，绕过Drizzle ORM的casing问题
              const dbInstance = await db.getDb();
              if (dbInstance) {
                const { sql: sqlTag } = await import('drizzle-orm');
                try {
                  await dbInstance.execute(sqlTag`UPDATE keywords SET keywordId = ${String(created.keywordId)} WHERE id = ${original.localKeywordId}`);
                  console.log(`[AmazonApiHelper] ✅ 关键词已同步: "${original.keywordText}" -> Amazon keywordId=${created.keywordId}`);
                } catch (updateErr: any) {
                  // 如果Drizzle execute也失败，尝试使用底层mysql2连接
                  console.warn(`[AmazonApiHelper] Drizzle execute失败，尝试底层连接:`, updateErr.message);
                  const mysql = await import('mysql2/promise');
                  const rawConn = await mysql.createConnection({
                    host: process.env.DB_HOST || process.env.DATABASE_HOST,
                    port: Number(process.env.DB_PORT || process.env.DATABASE_PORT || 3306),
                    user: process.env.DB_USER || process.env.DATABASE_USER || 'admin',
                    password: process.env.DB_PASSWORD || process.env.DATABASE_PASSWORD,
                    database: process.env.DB_NAME || process.env.DATABASE_NAME || 'amazon_ads_optimizer',
                  });
                  await rawConn.execute('UPDATE keywords SET keywordId = ? WHERE id = ?', [String(created.keywordId), original.localKeywordId]);
                  await rawConn.end();
                  console.log(`[AmazonApiHelper] ✅ (底层连接) 关键词已同步: "${original.keywordText}" -> Amazon keywordId=${created.keywordId}`);
                }
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
      
      console.log(`[AmazonApiHelper] 第${batchIdx + 1}批完成: 本批成功=${apiResult.createdKeywords.filter(k => k.code === 'SUCCESS').length}, 累计成功=${result.success}`);
    } catch (error: any) {
      // 单批失败不影响其他批次
      const batchFailCount = batch.length;
      result.failed += batchFailCount;
      const errorMsg = `第${batchIdx + 1}批创建关键词API调用失败: ${error.message}`;
      result.errors.push(errorMsg);
      console.error(`[AmazonApiHelper] ❌ ${errorMsg}`, error.response?.data || '');
      
      // 如果是限流错误，增加等待时间
      if (error.response?.status === 429) {
        const throttleWait = BATCH_DELAY_MS * 5;
        console.log(`[AmazonApiHelper] ⚠️ 限流，等待${throttleWait}ms后继续下一批...`);
        await new Promise(resolve => setTimeout(resolve, throttleWait));
      }
    }
    
    // 批间延迟，避免触发限流
    if (batchIdx < totalBatches - 1) {
      await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }
  
  console.log(`[AmazonApiHelper] 新关键词同步完成: 成功=${result.success}, 失败=${result.failed}, 总计=${newKeywords.length}`);
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
  reason: string,
  campaignType?: string  // v159: campaign类型，用于选择正确的API
): Promise<boolean> {
  const syncService = await getAmazonSyncService(accountId);
  if (!syncService) return false;
  
  try {
    const type = (campaignType || 'sp_manual').toLowerCase();
    
    // v189: 使用withRetry包装API调用，自动重试限流和服务器错误
    await withRetry(async () => {
      if (type === 'sb') {
        await syncService.client.updateSbCampaign(String(campaignId), {
          budget: { budget: newBudget, budgetType: 'DAILY' },
        });
      } else if (type === 'sd') {
        await syncService.client.updateSdCampaign(Number(campaignId), {
          budget: newBudget,
        });
      } else {
        await syncService.client.updateSpCampaign(String(campaignId), {
          dailyBudget: newBudget,
        });
      }
    }, { label: `预算同步 Campaign ${campaignId}` });
    
    console.log(`[AmazonApiHelper] 预算同步成功: Campaign ${campaignId} (${type}), 新预算=$${newBudget}`);
    return true;
  } catch (error: any) {
    console.error(`[AmazonApiHelper] 预算同步失败(含重试): Campaign ${campaignId} (${campaignType}):`, error.message);
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
    // v189: 使用withRetry包装API调用
    await withRetry(async () => {
      await syncService.client.updateSpCampaign(String(campaignId), {
        bidding: {
          adjustments: [
            { predicate: 'placementTop', percentage: Math.round(topOfSearchPercent) },
            { predicate: 'placementProductPage', percentage: Math.round(productPagePercent) },
          ],
        },
      } as any);
    }, { label: `位置倾斜同步 Campaign ${campaignId}` });
    console.log(`[AmazonApiHelper] 位置倾斜同步成功: Campaign ${campaignId}, ` +
      `Top=${topOfSearchPercent}%, ProductPage=${productPagePercent}%`);
    return true;
  } catch (error: any) {
    console.error(`[AmazonApiHelper] 位置倾斜同步失败(含重试): Campaign ${campaignId}:`, error.message);
    return false;
  }
}

/**
 * v176: 标准化matchType格式用于比较
 * Amazon API返回 NEGATIVE_PHRASE/NEGATIVE_EXACT
 * 本地使用 negativePhrase/negativeExact
 * 统一转换为 negative_phrase/negative_exact 进行比较
 */
function normalizeMatchTypeForComparison(matchType: string): string {
  const lower = (matchType || '').toLowerCase();
  // NEGATIVE_PHRASE -> negative_phrase (已经是)
  // negativePhrase -> negativephrase -> 需要转换
  // negative_phrase -> negative_phrase (已经是)
  if (lower === 'negativephrase' || lower === 'negative_phrase') return 'negative_phrase';
  if (lower === 'negativeexact' || lower === 'negative_exact') return 'negative_exact';
  return lower;
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
): Promise<{ success: number; failed: number; errors: string[]; keywordIdMap: Map<string, string> }> {
  const result = { success: 0, failed: 0, errors: [] as string[], keywordIdMap: new Map<string, string>() };
  
  if (negatives.length === 0) return result;
  
  const syncService = await getAmazonSyncService(accountId);
  if (!syncService) {
    result.errors.push(`无法获取账号 ${accountId} 的API服务`);
    result.failed = negatives.length;
    return result;
  }
  
  // v149: 幂等性保障 - 创建前先查询已有否定词，去除重复
  // 分组: campaign级别 vs adgroup级别
  const campaignLevel = negatives.filter(n => n.level === 'campaign');
  const adGroupLevel = negatives.filter(n => n.level === 'adgroup' && n.adGroupId);
  
  // 批量创建campaign级别否定关键词（带去重）
  if (campaignLevel.length > 0) {
    try {
      // v149: 幂等性 - 获取已有的campaign级否定词进行去重
      // v176: 修复matchType格式标准化 - Amazon返回NEGATIVE_PHRASE，本地用negativePhrase
      const uniqueCampaignIds = [...new Set(campaignLevel.map(n => n.campaignId))];
      const existingNegatives = new Set<string>();
      for (const cid of uniqueCampaignIds) {
        try {
          const existing = await syncService.client.listSpCampaignNegativeKeywords(cid);
          for (const e of existing) {
            const key = `${e.campaignId}:${(e.keywordText || '').toLowerCase()}:${normalizeMatchTypeForComparison(e.matchType)}`;
            existingNegatives.add(key);
          }
        } catch (listErr: any) {
          console.warn(`[AmazonApiHelper] 查询campaign ${cid} 已有否定词失败: ${listErr.message}`);
        }
      }
      
      // 过滤掉已存在的否定词 (v176: 使用标准化matchType比较)
      const newCampaignNegatives = campaignLevel.filter(n => {
        const key = `${n.campaignId}:${n.keywordText.toLowerCase()}:${normalizeMatchTypeForComparison(n.matchType)}`;
        return !existingNegatives.has(key);
      });
      
      const skippedCount = campaignLevel.length - newCampaignNegatives.length;
      if (skippedCount > 0) {
        console.log(`[AmazonApiHelper] 幂等性去重: 跳过${skippedCount}个已存在的campaign级否定词`);
        result.success += skippedCount; // 已存在视为成功
      }
      
      if (newCampaignNegatives.length > 0) {
        // v189: 使用withRetry包装API调用
        const results = await withRetry(() => syncService.client.createSpCampaignNegativeKeywords(
          newCampaignNegatives.map(n => ({
            campaignId: n.campaignId,
            keywordText: n.keywordText,
            matchType: n.matchType,
          }))
        ), { label: 'Campaign否定词创建' });
        
        // v175b: 正确处理部分成功的响应 - 通过index关联回原始请求
        for (let ri = 0; ri < results.length; ri++) {
          const r = results[ri] as any;
          if (r.code === 'SUCCESS' || r.keywordId) {
            result.success++;
            // v195: 记录成功创建的否定词ID，用于回写amazon_negative_keyword_id
            const idx = r.index !== undefined ? r.index : ri;
            if (idx < newCampaignNegatives.length) {
              const neg = newCampaignNegatives[idx];
              const mapKey = `campaign:${neg.campaignId}:${neg.keywordText.toLowerCase()}`;
              if (r.keywordId) {
                result.keywordIdMap.set(mapKey, String(r.keywordId));
              }
              console.log(`[AmazonApiHelper] 否定词创建成功: "${neg.keywordText}" -> keywordId=${r.keywordId}`);
            }
          } else {
            result.failed++;
            // v175b: 记录失败的具体关键词信息
            const idx = r.index !== undefined ? r.index : ri;
            const failedKeyword = idx < newCampaignNegatives.length 
              ? newCampaignNegatives[idx].keywordText : 'unknown';
            result.errors.push(`Campaign否定词失败[${failedKeyword}]: ${r.details}`);
          }
        }
      }
    } catch (error: any) {
      result.failed += campaignLevel.length;
      result.errors.push(`Campaign否定词批量创建失败: ${error.message}`);
    }
  }
  
  // 批量创建adgroup级别否定关键词（带去重）
  if (adGroupLevel.length > 0) {
    try {
      // v149: 幂等性 - 获取已有的adgroup级否定词进行去重
      // v176: 修复matchType格式标准化
      const uniqueAdGroupIds = [...new Set(adGroupLevel.map(n => n.adGroupId!))];
      const existingNegatives = new Set<string>();
      for (const agId of uniqueAdGroupIds) {
        try {
          const existing = await syncService.client.listSpNegativeKeywords(agId);
          for (const e of existing) {
            const key = `${e.adGroupId}:${(e.keywordText || '').toLowerCase()}:${normalizeMatchTypeForComparison(e.matchType)}`;
            existingNegatives.add(key);
          }
        } catch (listErr: any) {
          console.warn(`[AmazonApiHelper] 查询adGroup ${agId} 已有否定词失败: ${listErr.message}`);
        }
      }
      
      // 过滤掉已存在的否定词 (v176: 使用标准化matchType比较)
      const newAdGroupNegatives = adGroupLevel.filter(n => {
        const key = `${n.adGroupId}:${n.keywordText.toLowerCase()}:${normalizeMatchTypeForComparison(n.matchType)}`;
        return !existingNegatives.has(key);
      });
      
      const skippedCount = adGroupLevel.length - newAdGroupNegatives.length;
      if (skippedCount > 0) {
        console.log(`[AmazonApiHelper] 幂等性去重: 跳过${skippedCount}个已存在的adGroup级否定词`);
        result.success += skippedCount; // 已存在视为成功
      }
      
      if (newAdGroupNegatives.length > 0) {
        // v189: 使用withRetry包装API调用
        const results = await withRetry(() => syncService.client.createSpNegativeKeywords(
          newAdGroupNegatives.map(n => ({
            adGroupId: n.adGroupId!,
            campaignId: n.campaignId,
            keywordText: n.keywordText,
            matchType: n.matchType,
          }))
        ), { label: 'AdGroup否定词创建' });
        
        for (let ri = 0; ri < results.length; ri++) {
          const r = results[ri] as any;
          if (r.code === 'SUCCESS' || r.keywordId) {
            result.success++;
            // v195: 记录adGroup级否定词的keywordId
            const idx = r.index !== undefined ? r.index : ri;
            if (idx < newAdGroupNegatives.length) {
              const neg = newAdGroupNegatives[idx];
              const mapKey = `adgroup:${neg.adGroupId}:${neg.keywordText.toLowerCase()}`;
              if (r.keywordId) {
                result.keywordIdMap.set(mapKey, String(r.keywordId));
              }
            }
          } else {
            result.failed++;
            result.errors.push(`AdGroup否定词失败: ${r.details}`);
          }
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


/**
 * 同步关键词状态变更到 Amazon (v134新增)
 * 通过 PUT /sp/keywords API 更新关键词的 state 字段（enabled/paused/archived）
 * 
 * 这是修复的关键函数 - 之前系统只更新本地数据库的关键词状态，
 * 没有同步到Amazon，导致Amazon平台上的关键词状态不一致
 * 
 * @param accountId - 账号ID
 * @param statusChanges - 关键词状态变更列表
 * @returns 同步结果
 */
export async function syncKeywordStatusToAmazon(
  accountId: number,
  statusChanges: Array<{
    keywordId: number;       // 本地数据库的keyword ID
    newStatus: 'enabled' | 'paused' | 'archived';
    campaignId: number;
    reason: string;
    isProductTarget?: boolean;
  }>
): Promise<{ success: number; failed: number; errors: string[] }> {
  const result = { success: 0, failed: 0, errors: [] as string[] };
  
  if (statusChanges.length === 0) return result;
  
  console.log(`[AmazonApiHelper] 开始同步关键词状态变更: accountId=${accountId}, 总计=${statusChanges.length}条`);
  
  const syncService = await getAmazonSyncService(accountId);
  if (!syncService) {
    const errorMsg = `无法获取账号 ${accountId} 的API服务（凭证缺失或无效）`;
    console.error(`[AmazonApiHelper] ${errorMsg}`);
    result.errors.push(errorMsg);
    result.failed = statusChanges.length;
    return result;
  }
  
  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  
  // 分离关键词和商品定向
  const keywordChanges = statusChanges.filter(s => !s.isProductTarget);
  const productTargetChanges = statusChanges.filter(s => s.isProductTarget);
  
  // 处理关键词状态变更
  for (let i = 0; i < keywordChanges.length; i++) {
    const change = keywordChanges[i];
    try {
      // 获取Amazon keywordId
      const dbInstance = await db.getDb();
      if (!dbInstance) {
        result.failed++;
        result.errors.push(`数据库连接失败`);
        continue;
      }
      
      const { keywords } = await import('../../drizzle/schema');
      const { eq } = await import('drizzle-orm');
      let [kw] = await dbInstance.select({ keywordId: keywords.keywordId })
        .from(keywords)
        .where(eq(keywords.id, change.keywordId))
        .limit(1);
      
      if (!kw || !kw.keywordId || kw.keywordId === '0' || kw.keywordId === '') {
        // v141: 即时回填机制
        console.log(`[AmazonApiHelper] keyword id=${change.keywordId} 缺少keywordId，尝试即时回填...`);
        try {
          const { resolveKeywordIdOnDemand } = await import('./amazonIdResolver');
          const resolvedId = await resolveKeywordIdOnDemand(accountId, change.keywordId);
          if (resolvedId) {
            kw = { keywordId: resolvedId };
            console.log(`[AmazonApiHelper] ✅ 即时回填成功: keyword id=${change.keywordId} -> keywordId=${resolvedId}`);
          }
        } catch (resolveErr: any) {
          console.error(`[AmazonApiHelper] 即时回填异常: ${resolveErr.message}`);
        }
        
        if (!kw || !kw.keywordId || kw.keywordId === '0' || kw.keywordId === '') {
          result.failed++;
          const errorMsg = `关键词 ${change.keywordId} 缺少Amazon keywordId，无法同步状态`;
          result.errors.push(errorMsg);
          console.error(`[AmazonApiHelper] ❌ ${errorMsg}`);
          continue;
        }
      }
      
      const amazonKeywordId = String(kw.keywordId);
      console.log(`[AmazonApiHelper] [${i+1}/${keywordChanges.length}] 同步关键词状态: keywordId="${amazonKeywordId}", newState=${change.newStatus}`);
      
      // v190: 使用withRetry包装API调用，自动重试限流和服务器错误
      const apiResult = await withRetry(
        () => syncService.client.updateKeywordStatus([{
          keywordId: amazonKeywordId,
          state: change.newStatus,
        }]),
        { maxRetries: 2, baseDelayMs: 2000, label: `updateKeywordStatus-${amazonKeywordId}` }
      );
      
      if (apiResult.successCount > 0) {
        result.success++;
        console.log(`[AmazonApiHelper] ✅ 关键词状态更新成功: keywordId=${amazonKeywordId}, state=${change.newStatus}`);
      } else if (apiResult.errors.length > 0) {
        result.failed++;
        const errorDetail = apiResult.errors[0]?.details || 'Unknown error';
        result.errors.push(`关键词 ${amazonKeywordId} 状态更新失败: ${errorDetail}`);
        console.error(`[AmazonApiHelper] ❌ 关键词状态更新失败: keywordId=${amazonKeywordId}, error=${errorDetail}`);
      } else {
        result.success++;
        console.log(`[AmazonApiHelper] ✅ 关键词状态更新完成（无错误返回）: keywordId=${amazonKeywordId}`);
      }
    } catch (error: any) {
      result.failed++;
      const errorMsg = `关键词 ${change.keywordId} 状态同步异常: ${error.message}`;
      result.errors.push(errorMsg);
      console.error(`[AmazonApiHelper] ❌ ${errorMsg}`);
    }
    
    // 每5个调用后添加小延迟
    if ((i + 1) % 5 === 0 && i < keywordChanges.length - 1) {
      await delay(500);
    }
  }
  
  // 处理商品定向状态变更
  for (let i = 0; i < productTargetChanges.length; i++) {
    const change = productTargetChanges[i];
    try {
      const dbInstance = await db.getDb();
      if (!dbInstance) {
        result.failed++;
        result.errors.push(`数据库连接失败`);
        continue;
      }
      
      const { productTargets } = await import('../../drizzle/schema');
      const { eq } = await import('drizzle-orm');
      const [pt] = await dbInstance.select({ targetId: productTargets.targetId })
        .from(productTargets)
        .where(eq(productTargets.id, change.keywordId))
        .limit(1);
      
      if (!pt || !pt.targetId || pt.targetId === '0' || pt.targetId === '') {
        // v190: 添加商品定向的即时ID回填机制
        console.log(`[AmazonApiHelper] product_target id=${change.keywordId} 缺少targetId，尝试即时回填...`);
        try {
          const { resolveProductTargetIdOnDemand } = await import('./amazonIdResolver');
          const resolvedId = await resolveProductTargetIdOnDemand(accountId, change.keywordId);
          if (resolvedId) {
            console.log(`[AmazonApiHelper] ✅ 商品定向即时回填成功: product_target id=${change.keywordId} -> targetId=${resolvedId}`);
            // 继续执行同步
            const amazonTargetId = resolvedId;
            const apiResult = await withRetry(
              () => syncService.client.updateProductTargetStatus([{
                targetId: amazonTargetId,
                state: change.newStatus,
              }]),
              { maxRetries: 2, baseDelayMs: 2000, label: `updateProductTargetStatus-${amazonTargetId}` }
            );
            if (apiResult.successCount > 0) {
              result.success++;
              console.log(`[AmazonApiHelper] ✅ 商品定向状态更新成功: targetId=${amazonTargetId}`);
            } else {
              result.failed++;
              result.errors.push(`商品定向 ${amazonTargetId} 状态更新失败: ${apiResult.errors[0]?.details || 'Unknown error'}`);
            }
            continue;
          }
        } catch (resolveErr: any) {
          console.error(`[AmazonApiHelper] 商品定向即时回填异常: ${resolveErr.message}`);
        }
        result.failed++;
        result.errors.push(`商品定向 ${change.keywordId} 缺少Amazon targetId且回填失败`);
        continue;
      }
      
      const amazonTargetId = String(pt.targetId);
      console.log(`[AmazonApiHelper] [${i+1}/${productTargetChanges.length}] 同步商品定向状态: targetId="${amazonTargetId}", newState=${change.newStatus}`);
      
      // v190: 使用withRetry包装API调用
      const apiResult = await withRetry(
        () => syncService.client.updateProductTargetStatus([{
          targetId: amazonTargetId,
          state: change.newStatus,
        }]),
        { maxRetries: 2, baseDelayMs: 2000, label: `updateProductTargetStatus-${amazonTargetId}` }
      );
      
      if (apiResult.successCount > 0) {
        result.success++;
        console.log(`[AmazonApiHelper] ✅ 商品定向状态更新成功: targetId=${amazonTargetId}`);
      } else if (apiResult.errors.length > 0) {
        result.failed++;
        result.errors.push(`商品定向 ${amazonTargetId} 状态更新失败: ${apiResult.errors[0]?.details || 'Unknown error'}`);
      } else {
        result.success++;
      }
    } catch (error: any) {
      result.failed++;
      result.errors.push(`商品定向 ${change.keywordId} 状态同步异常: ${error.message}`);
    }
    
    if ((i + 1) % 5 === 0 && i < productTargetChanges.length - 1) {
      await delay(500);
    }
  }
  
  console.log(`[AmazonApiHelper] 关键词状态同步完成: 成功=${result.success}, 失败=${result.failed}`);
  return result;
}

/**
 * v135: 同步广告活动状态变更到 Amazon
 * 通过 updateSpCampaign API 更新 Campaign 的 state 字段
 */
export async function syncCampaignStatusToAmazon(
  accountId: number,
  statusChanges: Array<{
    campaignId: number;       // 本地数据库的campaign ID
    amazonCampaignId: string; // Amazon Campaign ID
    newStatus: 'enabled' | 'paused' | 'archived';
    campaignName: string;
    campaignType?: string;    // v159: campaign类型，用于选择正确的API
    reason: string;
  }>
): Promise<{ success: number; failed: number; errors: string[] }> {
  const result = { success: 0, failed: 0, errors: [] as string[] };
  
  if (statusChanges.length === 0) return result;
  
  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  
  console.log(`[AmazonApiHelper] 开始同步广告活动状态变更: accountId=${accountId}, 总计=${statusChanges.length}条`);
  
  const syncService = await getAmazonSyncService(accountId);
  if (!syncService) {
    const errorMsg = `无法获取账号 ${accountId} 的API服务（凭证缺失或无效）`;
    console.error(`[AmazonApiHelper] ${errorMsg}`);
    result.errors.push(errorMsg);
    result.failed = statusChanges.length;
    return result;
  }
  
  for (const change of statusChanges) {
    try {
      if (!change.amazonCampaignId || change.amazonCampaignId === '0' || change.amazonCampaignId === '') {
        result.failed++;
        result.errors.push(`广告活动 "${change.campaignName}" 缺少Amazon Campaign ID，无法同步状态`);
        continue;
      }
      
      const campaignType = (change.campaignType || 'sp_manual').toLowerCase();
      console.log(`[AmazonApiHelper] 同步广告活动状态: "${change.campaignName}" (${change.amazonCampaignId}, type=${campaignType}) -> ${change.newStatus}`);
      
      // v159: 带重试的API调用 - 最多重试2次
      const maxRetries = 2;
      let lastError: any = null;
      let success = false;
      
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          if (attempt > 0) {
            const waitTime = 2000 * attempt;
            console.log(`[AmazonApiHelper] 重试#${attempt}: "${change.campaignName}", 等待${waitTime}ms`);
            await delay(waitTime);
          }
          
          // v159: 根据campaign类型选择正确的API
          if (campaignType === 'sb') {
            await syncService.client.updateSbCampaign(change.amazonCampaignId, {
              state: change.newStatus.toUpperCase(),
            });
          } else if (campaignType === 'sd') {
            await syncService.client.updateSdCampaign(Number(change.amazonCampaignId), {
              state: change.newStatus.toUpperCase(),
            });
          } else {
            await syncService.client.updateSpCampaign(change.amazonCampaignId, {
              state: change.newStatus.toUpperCase(),
            } as any);
          }
          
          success = true;
          break;
        } catch (e: any) {
          lastError = e;
          // 不可重试的错误立即跳出
          if (e.response?.status === 400 || e.response?.status === 404 || e.response?.status === 422) {
            break;
          }
        }
      }
      
      if (success) {
        result.success++;
        console.log(`[AmazonApiHelper] ✅ 广告活动状态更新成功: "${change.campaignName}" (${campaignType}) -> ${change.newStatus}`);
      } else {
        result.failed++;
        const errorMsg = `广告活动 "${change.campaignName}" (${change.amazonCampaignId}, type=${campaignType}) 状态同步失败(已重试${maxRetries}次): ${lastError?.message}`;
        result.errors.push(errorMsg);
        console.error(`[AmazonApiHelper] ❌ ${errorMsg}`);
        
        // v159: 记录同步失败到数据库，便于后续排查和重试
        try {
          const { getDb } = await import('../db');
          const dbInstance = await getDb();
          if (dbInstance) {
            const { sql } = await import('drizzle-orm');
            await dbInstance.execute(sql`
              INSERT INTO sync_failures (entity_type, entity_id, amazon_id, operation, error_message, account_id, created_at) 
              VALUES ('campaign', ${change.campaignId}, ${change.amazonCampaignId}, ${'status_change_' + change.newStatus}, ${(lastError?.message || '').substring(0, 1000)}, ${accountId}, NOW())
            `);
          }
        } catch (logError) {
          // 记录失败不影响主流程
          console.warn(`[AmazonApiHelper] 无法记录同步失败日志:`, (logError as any).message);
        }
      }
    } catch (error: any) {
      result.failed++;
      const errorMsg = `广告活动 "${change.campaignName}" (${change.amazonCampaignId}, type=${change.campaignType}) 状态同步异常: ${error.message}`;
      result.errors.push(errorMsg);
      console.error(`[AmazonApiHelper] ❌ ${errorMsg}`);
    }
    
    // 每5个campaign后省略等待，避免触发限流
    if (statusChanges.indexOf(change) % 5 === 4) {
      await delay(500);
    }
  }
  
  console.log(`[AmazonApiHelper] 广告活动状态同步完成: 成功=${result.success}, 失败=${result.failed}`);
  return result;
}

/**
 * v135: 同步广告组状态变更到 Amazon
 * 通过 updateSpAdGroupStatus API 更新 AdGroup 的 state 字段
 */
export async function syncAdGroupStatusToAmazon(
  accountId: number,
  statusChanges: Array<{
    adGroupId: number;        // 本地数据库的adGroup ID
    amazonAdGroupId: string;  // Amazon AdGroup ID
    newStatus: 'enabled' | 'paused' | 'archived';
    adGroupName: string;
    campaignName: string;
    reason: string;
  }>
): Promise<{ success: number; failed: number; errors: string[] }> {
  const result = { success: 0, failed: 0, errors: [] as string[] };
  
  if (statusChanges.length === 0) return result;
  
  console.log(`[AmazonApiHelper] 开始同步广告组状态变更: accountId=${accountId}, 总计=${statusChanges.length}条`);
  
  const syncService = await getAmazonSyncService(accountId);
  if (!syncService) {
    const errorMsg = `无法获取账号 ${accountId} 的API服务（凭证缺失或无效）`;
    console.error(`[AmazonApiHelper] ${errorMsg}`);
    result.errors.push(errorMsg);
    result.failed = statusChanges.length;
    return result;
  }
  
  // 批量处理广告组状态变更
  const validChanges = statusChanges.filter(c => c.amazonAdGroupId && c.amazonAdGroupId !== '0' && c.amazonAdGroupId !== '');
  const invalidChanges = statusChanges.filter(c => !c.amazonAdGroupId || c.amazonAdGroupId === '0' || c.amazonAdGroupId === '');
  
  for (const invalid of invalidChanges) {
    result.failed++;
    result.errors.push(`广告组 "${invalid.adGroupName}" 缺少Amazon AdGroup ID，无法同步状态`);
  }
  
  // 逐个同步（避免批量失败影响全部）
  for (const change of validChanges) {
    try {
      console.log(`[AmazonApiHelper] 同步广告组状态: "${change.adGroupName}" (${change.amazonAdGroupId}) -> ${change.newStatus}`);
      
      // v190: 使用withRetry包装API调用
      const apiResult = await withRetry(
        () => syncService.client.updateSpAdGroupStatus([{
          adGroupId: change.amazonAdGroupId,
          state: change.newStatus,
        }]),
        { maxRetries: 2, baseDelayMs: 2000, label: `updateSpAdGroupStatus-${change.amazonAdGroupId}` }
      );
      
      if (apiResult.successCount > 0) {
        result.success++;
        console.log(`[AmazonApiHelper] ✅ 广告组状态更新成功: "${change.adGroupName}" -> ${change.newStatus}`);
      } else if (apiResult.errors.length > 0) {
        result.failed++;
        const errorDetail = apiResult.errors[0]?.details || 'Unknown error';
        result.errors.push(`广告组 "${change.adGroupName}" (${change.amazonAdGroupId}) 状态更新失败: ${errorDetail}`);
      } else {
        result.success++;
      }
    } catch (error: any) {
      result.failed++;
      const errorMsg = `广告组 "${change.adGroupName}" (${change.amazonAdGroupId}) 状态同步异常: ${error.message}`;
      result.errors.push(errorMsg);
      console.error(`[AmazonApiHelper] ❌ ${errorMsg}`);
    }
  }
  
  console.log(`[AmazonApiHelper] 广告组状态同步完成: 成功=${result.success}, 失败=${result.failed}`);
  return result;
}
