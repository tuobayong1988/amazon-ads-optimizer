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
import { AmazonSyncService } from '../sync/amazonSyncService';
import * as db from '../db';
import { sql } from 'drizzle-orm';
import { createModuleLogger } from '../utils/logger';
// v359: 分端点限流服务
import { acquireApiPermit, classifyEndpoint, getApiRateLimitService } from './apiRateLimitService';
// v223: getAmazonSyncService 从 syncServiceProvider re-export
import { getAmazonSyncService as _getAmazonSyncService } from '../sync/scheduling/syncServiceProvider';

// v223: 类型安全的包装器
export async function getAmazonSyncService(accountId: number): Promise<AmazonSyncService | null> {
  return _getAmazonSyncService(accountId) as Promise<AmazonSyncService | null>;
}

const log = createModuleLogger('ApiHelper');

// v189+v369: 统一的API调用重试工具函数
async function withRetry<T>(
  fn: () => Promise<T>,
  options: { maxRetries?: number; baseDelayMs?: number; label?: string; accountId?: number } = {}
): Promise<T> {
  const { maxRetries = 4, baseDelayMs = 3000, label = 'API', accountId = 0 } = options;  // v248+v369: 增强429限流重试，支持按账户限流
  let lastError: Error | null = null;
  // v360: 真正集成限流服务 - 在每次API调用前获取令牌
  const endpointType = classifyEndpoint(label);
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // v360+v369: 调用前获取限流许可，使用真实accountId
      try {
        await acquireApiPermit(accountId, endpointType);
      } catch (_) { /* 限流服务异常不影响主流程 */ }
      return await fn();
    } catch (error: unknown) {
      lastError = error;
      const isThrottle = (error as Record<string, unknown>).response?.status === 429 || (error as Error).message?.includes('请求过于频繁') || (error as Error).message?.includes('Too Many Requests');
      // @ts-expect-error - Axios error response access
      const isServerError = (error as Error & { response?: unknown }).response?.status >= 500;
      const isRetryable = isThrottle || isServerError || (error as Error & { code?: string }).code === 'ECONNRESET' || (error as Error & { code?: string }).code === 'ETIMEDOUT';
      
      // v360+v369: 通知分端点限流服务，触发自适应降速，使用真实accountId
      if (isThrottle) {
        try {
          getApiRateLimitService().recordExternalThrottle(accountId, endpointType);
        } catch (_) { /* 限流服务异常不影响主流程 */ }
      }
      
      if (!isRetryable || attempt >= maxRetries) {
        throw error;
      }
      
      const delay = isThrottle 
        ? Math.min(baseDelayMs * Math.pow(2, attempt), 30000)  // v248: 最大退避15s→30s
        : baseDelayMs * (attempt + 1);
      log.warn(`[AmazonApiHelper] ${label} 第${attempt + 1}次重试，等待${delay}ms... (${(error as Error).message?.substring(0, 80)})`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

// v223: getAmazonSyncService 已在上方定义（从 syncServiceProvider 包装）

/**
 * v359: 批量同步出价调整到 Amazon
 * 重构为真正的批量API调用模式，将逐条applyBidAdjustment改为批量updateKeywordBids/updateProductTargetBids
 * 将API调用次数降低90%以上
 * 
 * v123增强: 更详细的错误日志，区分不同失败原因
 */
export async function syncBidAdjustmentsToAmazon(
  accountId: number,
  adjustments: Array<{
    keywordId: number;
    productTargetId?: number;
    newBid: number;
    campaignId?: number | string;
    localCampaignId?: number;
    amazonCampaignId?: string;
    reason: string;
    isProductTarget?: boolean;
    algorithmUsed?: string;
  }>
): Promise<{ success: number; failed: number; errors: string[]; itemResults: Map<number, { status: 'synced' | 'failed'; error?: string; apiResponseId?: string }> }> {
  const result = { success: 0, failed: 0, errors: [] as string[], itemResults: new Map<number, { status: 'synced' | 'failed'; error?: string; apiResponseId?: string }>() };
  
  if (adjustments.length === 0) return result;
  
  log.info(`[AmazonApiHelper] v359: 开始批量同步出价调整: accountId=${accountId}, 总计=${adjustments.length}条`);
  
  const syncService = await getAmazonSyncService(accountId);
  if (!syncService) {
    const errorMsg = `无法获取账号 ${accountId} 的API服务（凭证缺失或无效）`;
    log.error(`[AmazonApiHelper] ${errorMsg}`);
    result.errors.push(errorMsg);
    result.failed = adjustments.length;
    for (const adj of adjustments) {
      result.itemResults.set(adj.keywordId, { status: 'failed', error: errorMsg });
    }
    return result;
  }
  
  // v149: 幂等性保障 - 同一批次内去重
  const deduped = new Map<number, typeof adjustments[0]>();
  for (const adj of adjustments) {
    deduped.set(adj.keywordId, adj);
  }
  const uniqueAdjustments = Array.from(deduped.values());
  if (uniqueAdjustments.length < adjustments.length) {
    log.debug(`[AmazonApiHelper] 幂等性去重: ${adjustments.length}条 -> ${uniqueAdjustments.length}条`);
  }
  
  // v359: 分离关键词和商品定向，分别进行批量API调用
  const keywordAdjustments = uniqueAdjustments.filter(a => !a.isProductTarget);
  const productTargetAdjustments = uniqueAdjustments.filter(a => a.isProductTarget);
  
  // === 第一步: 批量解析Amazon ID ===
  const dbInstance = await db.getDb();
  if (!dbInstance) {
    const errorMsg = '数据库连接失败';
    result.errors.push(errorMsg);
    result.failed = uniqueAdjustments.length;
    for (const adj of uniqueAdjustments) {
      result.itemResults.set(adj.keywordId, { status: 'failed', error: errorMsg });
    }
    return result;
  }
  
  const { keywords, productTargets } = await import('../../drizzle/schema');
  const { eq } = await import('drizzle-orm');
  
  // v391: 批量IN查询解析关键词Amazon ID，消除N+1查询
  const resolvedKeywordBids: Array<{ keywordId: string; bid: number; localId: number }> = [];
  if (keywordAdjustments.length > 0) {
    const { inArray } = await import('drizzle-orm');
    const kwLocalIds = keywordAdjustments.map(a => a.keywordId);
    
    // v391: 一次性查询所有keyword的Amazon ID
    const kwResults = await dbInstance
      .select({ id: keywords.id, keywordId: keywords.keywordId })
      .from(keywords)
      .where(inArray(keywords.id, kwLocalIds));
    
    const kwIdMap = new Map<number, string>();
    for (const kw of kwResults) {
      if (kw.keywordId && kw.keywordId !== '0' && kw.keywordId !== '') {
        kwIdMap.set(kw.id, kw.keywordId);
      }
    }
    log.info(`[v391] 批量解析关键词Amazon ID: ${kwLocalIds.length}个请求, ${kwIdMap.size}个已解析`);
    
    // 处理每个keyword的解析结果
    for (const adj of keywordAdjustments) {
      let amazonKeywordId = kwIdMap.get(adj.keywordId);
      
      // v429: entityIdResolver优先，amazonIdResolver降级
      if (!amazonKeywordId) {
        try {
          const { resolveKeywordId } = await import('./entityIdResolver');
          const resolved = await resolveKeywordId(adj.keywordId);
          if (resolved && resolved.amazonId) {
            amazonKeywordId = resolved.amazonId;
          }
        } catch (_) { /* entityIdResolver未初始化 */ }
      }
      if (!amazonKeywordId) {
        try {
          const { resolveKeywordIdOnDemand } = await import('./amazonIdResolver');
          // @ts-expect-error - runtime type mismatch
          amazonKeywordId = await resolveKeywordIdOnDemand(accountId, adj.keywordId) || undefined;
        } catch (resolveErr: unknown) {
          log.error(`[AmazonApiHelper] v429: 即时回填异常: ${(resolveErr as Error).message}`);
        }
      }
      
      if (amazonKeywordId && amazonKeywordId !== '0' && amazonKeywordId !== '') {
        resolvedKeywordBids.push({
          keywordId: String(amazonKeywordId),
          bid: Number(adj.newBid.toFixed(2)),
          localId: adj.keywordId,
        });
      } else {
        result.failed++;
        const errMsg = `keyword ${adj.keywordId}: 缺少Amazon ID（可重试）`;
        result.errors.push(errMsg);
        result.itemResults.set(adj.keywordId, { status: 'failed', error: '缺少Amazon ID（可重试）' });
      }
    }
  }
  
  // v391: 批量IN查询解析商品定向Amazon ID，消除N+1查询
  const resolvedTargetBids: Array<{ targetId: string; bid: number; localId: number }> = [];
  if (productTargetAdjustments.length > 0) {
    const { inArray } = await import('drizzle-orm');
    const ptLocalIds = productTargetAdjustments.map(a => a.productTargetId || a.keywordId);
    
    // v391: 一次性查询所有productTarget的Amazon ID
    const ptResults = await dbInstance
      .select({ id: productTargets.id, targetId: productTargets.targetId })
      .from(productTargets)
      .where(inArray(productTargets.id, ptLocalIds));
    
    const ptIdMap = new Map<number, string>();
    for (const pt of ptResults) {
      if (pt.targetId && pt.targetId !== '0' && pt.targetId !== '') {
        ptIdMap.set(pt.id, pt.targetId);
      }
    }
    log.info(`[v391] 批量解析商品定向Amazon ID: ${ptLocalIds.length}个请求, ${ptIdMap.size}个已解析`);
    
    for (const adj of productTargetAdjustments) {
      const actualId = adj.productTargetId || adj.keywordId;
      let amazonTargetId = ptIdMap.get(actualId);
      
      // v429: entityIdResolver优先，amazonIdResolver降级
      if (!amazonTargetId) {
        try {
          const { resolveProductTargetId } = await import('./entityIdResolver');
          const resolved = await resolveProductTargetId(actualId);
          if (resolved && resolved.amazonId) {
            amazonTargetId = resolved.amazonId;
          }
        } catch (_) { /* entityIdResolver未初始化 */ }
      }
      if (!amazonTargetId) {
        try {
          const { resolveProductTargetIdOnDemand } = await import('./amazonIdResolver');
          // @ts-expect-error - runtime type mismatch
          amazonTargetId = await resolveProductTargetIdOnDemand(accountId, actualId) || undefined;
        } catch (resolveErr: unknown) {
          log.error(`[AmazonApiHelper] v429: 商品定向即时回填异常: ${(resolveErr as Error).message}`);
        }
      }
      
      if (amazonTargetId && amazonTargetId !== '0' && amazonTargetId !== '') {
        resolvedTargetBids.push({
          targetId: String(amazonTargetId),
          bid: Number(adj.newBid.toFixed(2)),
          localId: adj.keywordId,
        });
      } else {
        result.failed++;
        const errMsg = `product_target ${actualId}: 缺少Amazon ID（可重试）`;
        result.errors.push(errMsg);
        result.itemResults.set(adj.keywordId, { status: 'failed', error: '缺少Amazon ID（可重试）' });
      }
    }
  }
  
  // === 第二步: 批量发送到Amazon API ===
  
  // v359: 批量更新关键词出价（每批最多1000条，与底层API一致）
  if (resolvedKeywordBids.length > 0) {
    log.info(`[AmazonApiHelper] v359: 批量发送 ${resolvedKeywordBids.length} 个关键词出价更新到Amazon`);
    try {
      const apiResult: unknown = await withRetry(
        () => (syncService as Record<string, unknown>).client.updateKeywordBids(
          resolvedKeywordBids.map(r => ({ keywordId: r.keywordId, bid: r.bid }))
        ),
        { maxRetries: 3, baseDelayMs: 3000, label: `batchUpdateKeywordBids-${resolvedKeywordBids.length}`, accountId }
      );
      
      // 处理成功的
      const successCount = resolvedKeywordBids.length - (apiResult.errors?.length || 0);
      result.success += successCount;
      const requestId = apiResult.requestIds?.[0] || '';
      
      // 标记成功的条目
      const failedKeywordIds = new Set((apiResult.errors || []).map((e: Record<string, unknown>) => String(e.keywordId)));
      for (const item of resolvedKeywordBids) {
        if (!failedKeywordIds.has(item.keywordId)) {
          result.itemResults.set(item.localId, { status: 'synced', apiResponseId: requestId });
        }
      }
      
      // 处理失败的
      const entityNotFoundKeywordIds: string[] = [];  // v454: 收集entityNotFoundError的keyword
      if (apiResult.errors && apiResult.errors.length > 0) {
        result.failed += apiResult.errors.length;
        for (const err of apiResult.errors as Array<Record<string, unknown>>) {
          const localItem = resolvedKeywordBids.find(r => r.keywordId === String(err.keywordId));
          const errMsg = `keyword ${err.keywordId}: ${err.details || (err as Record<string, unknown>).code || 'unknown'}`;
          result.errors.push(errMsg);
          if (localItem) {
            result.itemResults.set(localItem.localId, { status: 'failed', error: String(err.details || (err as Record<string, unknown>).code) });
          }
          // v454: 检测entityNotFoundError，标记过期实体
          const errStr = JSON.stringify(err).toLowerCase();
          if (errStr.includes('entitynotfounderror') || errStr.includes('entity_not_found') || errStr.includes('could not find')) {
            if (err.keywordId) entityNotFoundKeywordIds.push(String(err.keywordId));
          }
        }
      }
      
      // v454: 自动标记Amazon端已不存在的关键词，避免后续重复同步失败
      if (entityNotFoundKeywordIds.length > 0) {
        try {
          // 将这些关键词标记为amazon_deleted，后续优化引擎将跳过它们
          const idList = entityNotFoundKeywordIds.map(id => `'${String(id).replace(/'/g, "''")}'`).join(',');
          await dbInstance.execute(
            sql.raw(`UPDATE keywords SET keywordStatus = 'amazon_deleted' WHERE keywordId IN (${idList})`)
          );
          log.warn(`[AmazonApiHelper] v454: 已标记${entityNotFoundKeywordIds.length}个关键词为amazon_deleted（Amazon端已不存在）: ${entityNotFoundKeywordIds.slice(0, 5).join(', ')}`);
        } catch (markErr: unknown) {
          log.error(`[AmazonApiHelper] v454: 标记过期关键词失败: ${(markErr as Error).message}`);
        }
      }
      
      log.info(`[AmazonApiHelper] v359: 关键词出价批量更新完成: 成功=${successCount}, 失败=${apiResult.errors?.length || 0}, entityNotFound=${entityNotFoundKeywordIds.length}`);
    } catch (batchErr: unknown) {
      log.error(`[AmazonApiHelper] v359: 关键词出价批量更新异常: ${(batchErr as Error).message}`);
      result.failed += resolvedKeywordBids.length;
      for (const item of resolvedKeywordBids) {
        result.itemResults.set(item.localId, { status: 'failed', error: (batchErr as Error).message });
      }
      result.errors.push(`关键词出价批量更新异常: ${(batchErr as Error).message}`);
    }
  }
  
  // v359: 批量更新商品定向出价
  if (resolvedTargetBids.length > 0) {
    log.info(`[AmazonApiHelper] v359: 批量发送 ${resolvedTargetBids.length} 个商品定向出价更新到Amazon`);
    try {
      const apiResult: unknown = await withRetry(
        () => (syncService as Record<string, unknown>).client.updateProductTargetBids(
          resolvedTargetBids.map(r => ({ targetId: r.targetId, bid: r.bid }))
        ),
        { maxRetries: 3, baseDelayMs: 3000, label: `batchUpdateProductTargetBids-${resolvedTargetBids.length}`, accountId }
      );
      
      const successCount = resolvedTargetBids.length - (apiResult.errors?.length || 0);
      result.success += successCount;
      const requestId = apiResult.requestIds?.[0] || '';
      
      const failedTargetIds = new Set((apiResult.errors || []).map((e: Record<string, unknown>) => String(e.targetId)));
      for (const item of resolvedTargetBids) {
        if (!failedTargetIds.has(item.targetId)) {
          result.itemResults.set(item.localId, { status: 'synced', apiResponseId: requestId });
        }
      }
      
      const entityNotFoundTargetIds: string[] = [];  // v454: 收集entityNotFoundError的target
      if (apiResult.errors && apiResult.errors.length > 0) {
        result.failed += apiResult.errors.length;
        for (const err of apiResult.errors as Array<Record<string, unknown>>) {
          const localItem = resolvedTargetBids.find(r => r.targetId === String(err.targetId));
          const errMsg = `product_target ${err.targetId}: ${err.details || (err as Record<string, unknown>).code || 'unknown'}`;
          result.errors.push(errMsg);
          if (localItem) {
            result.itemResults.set(localItem.localId, { status: 'failed', error: String(err.details || (err as Record<string, unknown>).code) });
          }
          // v454: 检测entityNotFoundError
          const errStr = JSON.stringify(err).toLowerCase();
          if (errStr.includes('entitynotfounderror') || errStr.includes('entity_not_found') || errStr.includes('could not find')) {
            if (err.targetId) entityNotFoundTargetIds.push(String(err.targetId));
          }
        }
      }
      
      // v454: 自动标记Amazon端已不存在的商品定向
      if (entityNotFoundTargetIds.length > 0) {
        try {
          await dbInstance.execute(
            `UPDATE product_targets SET targetStatus = 'amazon_deleted' WHERE targetId IN (${entityNotFoundTargetIds.map(() => '?').join(',')})`,
            entityNotFoundTargetIds
          );
          log.warn(`[AmazonApiHelper] v454: 已标记${entityNotFoundTargetIds.length}个商品定向为amazon_deleted`);
        } catch (markErr: unknown) {
          log.error(`[AmazonApiHelper] v454: 标记过期商品定向失败: ${(markErr as Error).message}`);
        }
      }
      
      log.info(`[AmazonApiHelper] v359: 商品定向出价批量更新完成: 成功=${successCount}, 失败=${apiResult.errors?.length || 0}, entityNotFound=${entityNotFoundTargetIds.length}`);
    } catch (batchErr: unknown) {
      log.error(`[AmazonApiHelper] v359: 商品定向出价批量更新异常: ${(batchErr as Error).message}`);
      result.failed += resolvedTargetBids.length;
      for (const item of resolvedTargetBids) {
        result.itemResults.set(item.localId, { status: 'failed', error: (batchErr as Error).message });
      }
      result.errors.push(`商品定向出价批量更新异常: ${(batchErr as Error).message}`);
    }
  }
  
  const totalAttempts = result.success + result.failed;
  const failureRate = totalAttempts > 0 ? (result.failed / totalAttempts) * 100 : 0;
  log.warn(`[AmazonApiHelper] 出价同步完成: 成功=${result.success}, 失败=${result.failed}, 成功率=${(100 - failureRate).toFixed(1)}%`);
  if (result.errors.length > 0) {
    log.error(`[AmazonApiHelper] 错误详情: ${result.errors.slice(0, 5).join('; ')}`);
  }
  
  // v454: 记录同步统计到日志，便于追踪失败率趋势
  log.info(`[AmazonApiHelper] v454: 出价同步统计 accountId=${accountId}: 总计=${totalAttempts}, 成功=${result.success}, 失败=${result.failed}, 成功率=${totalAttempts > 0 ? ((result.success / totalAttempts) * 100).toFixed(1) : 0}%`);
  
  // v126: API同步失败率监控告警
  const FAILURE_RATE_THRESHOLD = 20; // 失败率超过20%触发告警
  if (failureRate > FAILURE_RATE_THRESHOLD && totalAttempts >= 5) {
    log.error(`[ALERT] ⚠️ Amazon API同步失败率过高! 失败率=${failureRate.toFixed(1)}% (阈值=${FAILURE_RATE_THRESHOLD}%), 成功=${result.success}, 失败=${result.failed}`);
    log.error(`[ALERT] 请检查Amazon API凭证、配额和网络状态`);
    
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
    } catch (alertErr: unknown) {
      // system_alerts表可能不存在，忽略错误
      log.warn(`[ALERT] 告警写入数据库失败（表可能不存在）: ${(alertErr as Error).message}`);
    }
  }
  
  // v333: 401/403认证失败专项检测
  // 检查错误列表中是否包含认证相关错误，即使总体失败率未超阈值也要告警
  const authErrors = result.errors.filter(e => 
    e.includes('401') || e.includes('Unauthorized') || 
    e.includes('403') || e.includes('Forbidden') ||
    e.includes('Token已过期') || e.includes('token expired')
  );
  if (authErrors.length > 0) {
    log.error(`[ALERT] v333: ⚠️ 发现${authErrors.length}条认证相关错误! 请立即检查accountId=${accountId}的API凭证有效性`);
    log.error(`[ALERT] v333: 认证错误详情: ${authErrors.slice(0, 3).join('; ')}`);
    
    try {
      const dbInstance = await db.getDb();
      if (dbInstance) {
        const { sql } = await import('drizzle-orm');
        await dbInstance.execute(sql`
          INSERT INTO anomaly_alert_logs (accountId, anomalyType, detectedValue, actionTaken, createdAt)
          VALUES (
            ${accountId},
            ${'AUTH_FAILURE_SYNC'},
            ${'critical'},
            ${JSON.stringify({
              source: 'syncBidAdjustmentsToAmazon',
              authErrorCount: authErrors.length,
              totalAttempts,
              errors: authErrors.slice(0, 5),
              alertMessage: `出价同步过程中发现${authErrors.length}条认证失败错误，请立即检查accountId=${accountId}的OAuth Token有效性`,
            })},
            NOW()
          )
        `);
        log.warn(`[ALERT] v333: 认证失败告警已写入anomaly_alert_logs: accountId=${accountId}, authErrors=${authErrors.length}`);
      }
    } catch (authAlertErr: unknown) {
      log.warn(`[ALERT] v333: 认证失败告警写入失败: ${(authAlertErr as Error).message}`);
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
    adGroupId: number | string;  // v201: Amazon AdGroup ID (支持string避免精度丢失)
    campaignId: number | string;  // v201: Amazon Campaign ID (支持string避免精度丢失)
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
  
  log.info(`[AmazonApiHelper] 开始同步新关键词到Amazon: accountId=${accountId}, 总计=${newKeywords.length}个`);
  
  const syncService = await getAmazonSyncService(accountId);
  if (!syncService) {
    const errorMsg = `无法获取账号 ${accountId} 的API服务`;
    result.errors.push(errorMsg);
    result.failed = newKeywords.length;
    return result;
  }
  
  // v337: Amazon端存在性检查 - 在创建前检查关键词是否已存在于Amazon
  // 按adGroupId分组，批量查询已存在的关键词
  let keywordsToCreate = [...newKeywords]; // v337: 使用副本避免修改原始参数
  const existingKeywordsMap = new Map<string, Set<string>>(); // adGroupId -> Set<"keywordText::matchType">
  try {
    const adGroupIds = [...new Set(newKeywords.map(k => String(k.adGroupId)))];
    for (const agId of adGroupIds) {
      try {
        const existingKws = await (syncService as Record<string, unknown>).client.listSpKeywords(Number(agId));
        const keySet = new Set<string>();
        for (const kw of (existingKws as unknown[])) {
          const text = (kw.keywordText || '').toLowerCase().trim();
          const mt = (kw.matchType || '').toLowerCase();
          if (text) keySet.add(`${text}::${mt}`);
        }
        existingKeywordsMap.set(agId, keySet);
        log.debug(`[AmazonApiHelper] v337: AdGroup ${agId} 已有 ${keySet.size} 个关键词`);
      } catch (listErr: unknown) {
        log.warn(`[AmazonApiHelper] v337: 查询AdGroup ${agId} 关键词列表失败(继续创建): ${(listErr as Error).message}`);
      }
    }
    
    // 过滤掉已存在的关键词
    const filteredKeywords: typeof newKeywords = [];
    for (const kw of (newKeywords as unknown[])) {
      const agKeySet = existingKeywordsMap.get(String(kw.adGroupId));
      const lookupKey = `${kw.keywordText.toLowerCase().trim()}::${kw.matchType.toLowerCase()}`;
      if (agKeySet && agKeySet.has(lookupKey)) {
        result.success++; // 已存在视为成功（幂等）
        result.createdKeywords.push({
          localId: kw.localKeywordId,
          amazonKeywordId: 0,
          keywordText: kw.keywordText,
        });
        log.info(`[AmazonApiHelper] v337: 关键词已存在于Amazon，跳过创建: "${kw.keywordText}" [${kw.matchType}] in adGroup ${kw.adGroupId}`);
      } else {
        filteredKeywords.push(kw);
      }
    }
    
    if (filteredKeywords.length < newKeywords.length) {
      log.info(`[AmazonApiHelper] v337: Amazon端去重: ${newKeywords.length}个 -> ${filteredKeywords.length}个 (${newKeywords.length - filteredKeywords.length}个已存在)`);
    }
    
    // 使用过滤后的列表继续
    keywordsToCreate = filteredKeywords;
    if (keywordsToCreate.length === 0) {
      log.info(`[AmazonApiHelper] v337: 所有关键词已存在于Amazon，无需创建`);
      return result;
    }
  } catch (checkErr: unknown) {
    log.warn(`[AmazonApiHelper] v337: Amazon端存在性检查失败(继续正常创建): ${(checkErr as Error).message}`);
  }
  
  // v127: 分批处理机制 - 每批最多50个关键词，批间延迟1秒避免限流
  const BATCH_SIZE = 50;
  const BATCH_DELAY_MS = 2000;  // v248: 从1000增加到2000ms，减少Amazon API 429限流
  const totalBatches = Math.ceil(keywordsToCreate.length / BATCH_SIZE);
  log.info(`[AmazonApiHelper] 分批处理: 总计${keywordsToCreate.length}个关键词, 分${totalBatches}批, 每批最多${BATCH_SIZE}个`);
  
  for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
    const batchStart = batchIdx * BATCH_SIZE;
    const batchEnd = Math.min(batchStart + BATCH_SIZE, keywordsToCreate.length);
    const batch = keywordsToCreate.slice(batchStart, batchEnd);
    
    log.info(`[AmazonApiHelper] 处理第${batchIdx + 1}/${totalBatches}批: ${batch.length}个关键词 (索引 ${batchStart}-${batchEnd - 1})`);
    
    try {
      // v190: 添加withRetry包装批次API调用，自动重试限流和服务器错误
      const apiResult: unknown = await withRetry(
        () => (syncService as Record<string, unknown>).client.createSpKeywords(
          (batch as unknown[]).map((k: Record<string, unknown>) => ({
            adGroupId: k.adGroupId,
            campaignId: k.campaignId,
            keywordText: k.keywordText,
            matchType: k.matchType,
            bid: k.bid,
            state: 'enabled' as const,
          }))
        ),
        { maxRetries: 2, baseDelayMs: 3000, label: `createSpKeywords-batch${batchIdx + 1}`, accountId }
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
          
          // v357: 更新本地数据库的keywordId，同时回填accountId和campaignId
          if (original.localKeywordId) {
            try {
              // v357: 使用连接池直接连接，同时回填完整ID信息
              const rawConn = await db.getDirectConnection();
              try {
                await rawConn.execute(
                  `UPDATE keywords SET keywordId = ?,
                   accountId = COALESCE(accountId, ?),
                   campaignId = COALESCE(campaignId, ?)
                   WHERE id = ?`,
                  [String(created.keywordId), accountId, String(original.campaignId || ''), original.localKeywordId]
                );
                log.info(`[AmazonApiHelper] ✅ v357: 关键词已同步: "${original.keywordText}" -> amazonKeywordId=${created.keywordId}, accountId=${accountId}`);
              } finally {
                rawConn.release();
              }
            } catch (dbError: unknown) {
              log.error(`[AmazonApiHelper] v357: 更新本地keywordId失败:`, (dbError as Error).message);
            }
          }
        } else {
          result.failed++;
          const errorCode = created.code || 'UNKNOWN';
          // @ts-expect-error - dynamic property access
          const errorDetail = (created as Record<string, unknown>).details || (created as Record<string, unknown>).description || '';
          result.errors.push(`关键词创建失败: "${original.keywordText}" - code=${errorCode}`);
          log.error(`[AmazonApiHelper] ❌ 关键词创建失败: "${original.keywordText}", code=${errorCode}, detail=${errorDetail}`);
          
          // v350: 增强永久性错误识别 - 包含Amazon返回的通用ERROR码
          // 原因: 大量code=ERROR的关键词反复重试浪费API配额
          const isPermanentError = (
            errorCode === 'INVALID_VALUE' ||
            errorCode === 'INVALID_ARGUMENT' ||
            errorCode === 'ERROR' || // v350: Amazon通用拒绝码，通常为品牌词/受限词
            errorDetail.toLowerCase().includes('trademark') ||
            errorDetail.toLowerCase().includes('brand') ||
            errorDetail.toLowerCase().includes('restricted') ||
            errorDetail.toLowerCase().includes('not eligible') ||
            errorDetail.toLowerCase().includes('duplicate')
          );
          // v351: 移除localKeywordId前提条件，确保所有永久性失败都被标记
          // 原来的问题: localKeywordId在搜索词收割场景中经常为空，导致239/276个失败未被标记
          if (isPermanentError) {
            try {
              const dbInstance = await db.getDb();
              if (dbInstance) {
                const { sql: sqlTag } = await import('drizzle-orm');
                // 将该关键词在optimization_logs中的所有failed记录标记为permanently_failed
                await dbInstance.execute(sqlTag`
                  UPDATE optimization_logs 
                  SET api_sync_status = 'permanently_failed',
                      api_sync_detail = ${JSON.stringify({ code: errorCode, detail: errorDetail, reason: 'v351: Amazon永久性拒绝' })}
                  WHERE action_type = 'keyword_create'
                    AND JSON_UNQUOTE(JSON_EXTRACT(action_detail, '$.searchTerm')) = ${original.keywordText}
                    AND api_sync_status = 'failed'
                `);
                log.warn(`[AmazonApiHelper] v351: 关键词"${original.keywordText}"已标记为永久失败 (${errorCode})`);
              }
            } catch (markErr: unknown) {
              log.error(`[AmazonApiHelper] v351: 标记永久失败异常: ${(markErr as Error).message}`);
            }
          }
        }
      }
      
      // @ts-expect-error - error code check
      log.info(`[AmazonApiHelper] 第${batchIdx + 1}批完成: 本批成功=${apiResult.createdKeywords.filter(k => k.code === 'SUCCESS').length}, 累计成功=${result.success}`);
    } catch (error: unknown) {
      // 单批失败不影响其他批次
      const batchFailCount = batch.length;
      result.failed += batchFailCount;
      const errorMsg = `第${batchIdx + 1}批创建关键词API调用失败: ${(error as Error).message}`;
      result.errors.push(errorMsg);
      // @ts-expect-error - Axios error response access
      log.error(`[AmazonApiHelper] ❌ ${errorMsg}`, (error as Error & { response?: unknown }).response?.data || '');
      
      // 如果是限流错误，增加等待时间
      // @ts-expect-error - Axios error response access
      if ((error as Error & { response?: unknown }).response?.status === 429) {
        const throttleWait = BATCH_DELAY_MS * 5;
        log.debug(`[AmazonApiHelper] ⚠️ 限流，等待${throttleWait}ms后继续下一批...`);
        await new Promise(resolve => setTimeout(resolve, throttleWait));
      }
    }
    
    // 批间延迟，避免触发限流
    if (batchIdx < totalBatches - 1) {
      await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }
  
  log.warn(`[AmazonApiHelper] 新关键词同步完成: 成功=${result.success}, 失败=${result.failed}, 总计=${newKeywords.length}`);
  return result;
}

/**
 * v310: 同步新商品定向(Product Target)到 Amazon
 * 通过 POST /sp/targets API 创建商品定向
 */
export async function syncNewProductTargetsToAmazon(
  accountId: number,
  newTargets: Array<{
    localTargetId?: number;
    adGroupId: number | string;
    campaignId: number | string;
    asin: string;
    targetingType: 'exact' | 'expanded';
    bid: number;
  }>
): Promise<{ success: number; failed: number; errors: string[]; targetIdMap: Map<string, number> }> {
  const result = { success: 0, failed: 0, errors: [] as string[], targetIdMap: new Map<string, number>() };
  if (!newTargets.length) return result;
  
  const syncService = await getAmazonSyncService(accountId);
  if (!syncService) {
    result.errors.push('No sync service available');
    result.failed = newTargets.length;
    return result;
  }
  
  const BATCH_SIZE = 50;
  const BATCH_DELAY_MS = 500;
  
  for (let i = 0; i < newTargets.length; i += BATCH_SIZE) {
    const batch = newTargets.slice(i, i + BATCH_SIZE);
    
    try {
      const apiTargets = batch.map(t => {
        // 根据定向类型构建 expression
        const expression = t.targetingType === 'exact'
          ? [{ type: 'asinSameAs', value: t.asin }]
          : [{ type: 'asinExpandedFrom', value: t.asin }];
        return {
          adGroupId: t.adGroupId,
          campaignId: t.campaignId,
          expression,
          expressionType: 'manual' as const,
          bid: t.bid,
          state: 'enabled' as const,
        };
      });
      
      // v350: 修复API调用路径 - 应通过syncService.client调用而非syncService
      // @ts-expect-error - dynamic property access
      const apiResult: unknown = await (syncService.client as Record<string, unknown>).createSpProductTargets(apiTargets);
      
      for (let j = 0; j < apiResult.createdTargets.length; j++) {
        const created = apiResult.createdTargets[j];
        if (created.code === 'SUCCESS' && created.targetId) {
          result.success++;
          const mapKey = `${batch[j].adGroupId}:${batch[j].asin}`;
          result.targetIdMap.set(mapKey, created.targetId);
        } else {
          result.failed++;
          const errMsg = `ASIN ${batch[j].asin}: ${created.code}`;
          result.errors.push(errMsg);
          log.error(`[AmazonApiHelper] v310: 商品定向创建失败: ${errMsg}`);
        }
      }
    } catch (batchErr: unknown) {
      log.error(`[AmazonApiHelper] v310: 商品定向批次同步失败: ${(batchErr as Error).message}`);
      result.failed += batch.length;
      result.errors.push(`Batch error: ${(batchErr as Error).message}`);
    }
    
    if (i + BATCH_SIZE < newTargets.length) {
      await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }
  
  log.warn(`[AmazonApiHelper] v310: 商品定向同步完成: 成功=${result.success}, 失败=${result.failed}, 总计=${newTargets.length}`);
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
        // v323: SB v4 API budget是直接的数字，不是嵌套对象
        await (syncService as Record<string, unknown>).client.updateSbCampaign(String(campaignId), {
          budget: newBudget,
        });
      } else if (type === 'sd') {
        await (syncService as Record<string, unknown>).client.updateSdCampaign(String(campaignId), {  // v356: 统一使用String类型传递Amazon ID
          budget: newBudget,
        });
      } else {
        await (syncService as Record<string, unknown>).client.updateSpCampaign(String(campaignId), {
          dailyBudget: newBudget,
        });
      }
    }, { label: `预算同步 Campaign ${campaignId}`, accountId });
    
    log.info(`[AmazonApiHelper] 预算同步成功: Campaign ${campaignId} (${type}), 新预算=$${newBudget}`);
    return true;
  } catch (error: unknown) {
    log.error(`[AmazonApiHelper] 预算同步失败(含重试): Campaign ${campaignId} (${campaignType}):`, (error as Error).message);
    return false;
  }
}

/**
 * 同步位置倾斜调整到 Amazon
 * v423: 使用API v3的dynamicBidding.placementBidding格式
 */
export async function syncPlacementAdjustmentToAmazon(
  accountId: number,
  campaignId: string,  // Amazon Campaign ID
  topOfSearchPercent: number,
  productPagePercent: number,
  reason: string,
  campaignType?: string  // v471: 新增参数，支持SP/SB路由
): Promise<boolean> {
  const syncService = await getAmazonSyncService(accountId);
  if (!syncService) return false;
  
  const cType = (campaignType || 'sp_manual').toLowerCase();
  
  try {
    if (cType === 'sb') {
      // v471: SB广告位置倾斜 — 使用 updateSbCampaign (PUT /sb/v4/campaigns)
      // SB v4格式: bidding.bidAdjustments[{predicate, percentage}]
      await withRetry(async () => {
        const bidAdjustments: Array<{ predicate: string; percentage: number }> = [];
        if (Math.round(topOfSearchPercent) > 0) {
          bidAdjustments.push({ predicate: 'placementTop', percentage: Math.round(topOfSearchPercent) });
        }
        if (Math.round(productPagePercent) > 0) {
          bidAdjustments.push({ predicate: 'placementProductPage', percentage: Math.round(productPagePercent) });
        }
        await (syncService as Record<string, unknown>).client.updateSbCampaign(String(campaignId), {
          bidding: { bidAdjustments },
        } as Record<string, unknown>);
      }, { label: `SB位置倾斜同步 Campaign ${campaignId}`, accountId });
      log.info(`[AmazonApiHelper] v471: SB位置倾斜同步成功: Campaign ${campaignId}, Top=${topOfSearchPercent}%, ProductPage=${productPagePercent}%`);
    } else if (cType === 'sd') {
      // v471: SD不支持位置倾斜
      log.warn(`[AmazonApiHelper] v471: SD广告不支持位置倾斜调整，跳过: Campaign ${campaignId}`);
      return false;
    } else {
      // SP: 使用 updateSpCampaign (PUT /sp/campaigns)
      await withRetry(async () => {
        const placementBidding: Array<{ placement: string; percentage: number }> = [];
        if (Math.round(topOfSearchPercent) > 0) {
          placementBidding.push({ placement: 'PLACEMENT_TOP', percentage: Math.round(topOfSearchPercent) });
        }
        if (Math.round(productPagePercent) > 0) {
          placementBidding.push({ placement: 'PLACEMENT_PRODUCT_PAGE', percentage: Math.round(productPagePercent) });
        }
        await (syncService as Record<string, unknown>).client.updateSpCampaign(String(campaignId), {
          dynamicBidding: {
            placementBidding,
          },
        } as Record<string, unknown>);
      }, { label: `SP位置倾斜同步 Campaign ${campaignId}`, accountId });
      log.info(`[AmazonApiHelper] SP位置倾斜同步成功: Campaign ${campaignId}, Top=${topOfSearchPercent}%, ProductPage=${productPagePercent}%`);
    }
    return true;
  } catch (error: unknown) {
    log.error(`[AmazonApiHelper] 位置倾斜同步失败(含重试): Campaign ${campaignId}:`, (error as Error).message);
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
    campaignId: string;  // v356: 统一Amazon Campaign ID为string类型
    adGroupId?: string;  // v356: 统一Amazon AdGroup ID为string类型
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
          const existing = await (syncService as Record<string, unknown>).client.listSpCampaignNegativeKeywords(String(cid));  // v356: 确保string类型
          for (const e of existing) {
            const key = `${e.campaignId}:${(e.keywordText || '').toLowerCase()}:${normalizeMatchTypeForComparison(e.matchType)}`;
            existingNegatives.add(key);
          }
        } catch (listErr: unknown) {
          log.warn(`[AmazonApiHelper] 查询campaign ${cid} 已有否定词失败: ${(listErr as Error).message}`);
        }
      }
      
      // 过滤掉已存在的否定词 (v176: 使用标准化matchType比较)
      const newCampaignNegatives = campaignLevel.filter(n => {
        const key = `${n.campaignId}:${n.keywordText.toLowerCase()}:${normalizeMatchTypeForComparison(n.matchType)}`;
        return !existingNegatives.has(key);
      });
      
      const skippedCount = campaignLevel.length - newCampaignNegatives.length;
      if (skippedCount > 0) {
        log.info(`[AmazonApiHelper] 幂等性去重: 跳过${skippedCount}个已存在的campaign级否定词`);
        result.success += skippedCount; // 已存在视为成功
      }
      
      if (newCampaignNegatives.length > 0) {
        // v189: 使用withRetry包装API调用
        const results = await withRetry(() => (syncService as Record<string, unknown>).client.createSpCampaignNegativeKeywords(
          newCampaignNegatives.map(n => ({
            campaignId: n.campaignId,
            keywordText: n.keywordText,
            matchType: n.matchType,
          }))
        ), { label: 'Campaign否定词创建', accountId });
        
        // v175b: 正确处理部分成功的响应 - 通过index关联回原始请求
        // @ts-expect-error - runtime type mismatch
        for (let ri = 0; ri < results.length; ri++) {
          const r = results[ri] as Record<string, unknown>;
          if (r.code === 'SUCCESS' || r.code === 'SUCCESS_DUPLICATE' || r.keywordId) {
            result.success++;
            // v195: 记录成功创建的否定词ID，用于回写amazon_negative_keyword_id
            const idx = r.index !== undefined ? r.index : ri;
            if (idx < newCampaignNegatives.length) {
              const neg = newCampaignNegatives[idx];
              const mapKey = `campaign:${neg.campaignId}:${neg.keywordText.toLowerCase()}`;
              if (r.keywordId) {
                result.keywordIdMap.set(mapKey, String(r.keywordId));
              }
              // v449: 区分新创建和重复的日志
              const dupTag = r.code === 'SUCCESS_DUPLICATE' ? ' (duplicate, 已存在)' : '';
              log.info(`[AmazonApiHelper] 否定词创建成功${dupTag}: "${neg.keywordText}" -> keywordId=${r.keywordId}`);
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
    } catch (error: unknown) {
      result.failed += campaignLevel.length;
      result.errors.push(`Campaign否定词批量创建失败: ${(error as Error).message}`);
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
          const existing = await (syncService as Record<string, unknown>).client.listSpNegativeKeywords(agId as unknown);
          for (const e of existing) {
            const key = `${e.adGroupId}:${(e.keywordText || '').toLowerCase()}:${normalizeMatchTypeForComparison(e.matchType)}`;
            existingNegatives.add(key);
          }
        } catch (listErr: unknown) {
          log.warn(`[AmazonApiHelper] 查询adGroup ${agId} 已有否定词失败: ${(listErr as Error).message}`);
        }
      }
      
      // 过滤掉已存在的否定词 (v176: 使用标准化matchType比较)
      const newAdGroupNegatives = adGroupLevel.filter(n => {
        const key = `${n.adGroupId}:${n.keywordText.toLowerCase()}:${normalizeMatchTypeForComparison(n.matchType)}`;
        return !existingNegatives.has(key);
      });
      
      const skippedCount = adGroupLevel.length - newAdGroupNegatives.length;
      if (skippedCount > 0) {
        log.info(`[AmazonApiHelper] 幂等性去重: 跳过${skippedCount}个已存在的adGroup级否定词`);
        result.success += skippedCount; // 已存在视为成功
      }
      
      if (newAdGroupNegatives.length > 0) {
        // v189: 使用withRetry包装API调用
        const results = await withRetry(() => (syncService as Record<string, unknown>).client.createSpNegativeKeywords(
          (newAdGroupNegatives as unknown[]).map((n: Record<string, unknown>) => ({
            adGroupId: n.adGroupId!,
            campaignId: n.campaignId,
            keywordText: n.keywordText,
            matchType: n.matchType,
          }))
        ), { label: 'AdGroup否定词创建', accountId });
        
        // @ts-expect-error - runtime type mismatch
        for (let ri = 0; ri < results.length; ri++) {
          const r = results[ri] as Record<string, unknown>;
          if (r.code === 'SUCCESS' || r.code === 'SUCCESS_DUPLICATE' || r.keywordId) {
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
    } catch (error: unknown) {
      result.failed += adGroupLevel.length;
      result.errors.push(`AdGroup否定词批量创建失败: ${(error as Error).message}`);
    }
  }
  
  log.warn(`[AmazonApiHelper] 否定词同步完成: 成功=${result.success}, 失败=${result.failed}`);
  return result;
}


/**
 * v2: 同步否定产品定向到 Amazon
 * 
 * 根据campaignType和negativeScope调用不同的API端点:
 * - SP + campaign级: createSpCampaignNegativeTargets
 * - SP + ad_group级: createSpNegativeTargets  
 * - SB + ad_group级: createSbNegativeTargets
 * - SD + ad_group级: createSdNegativeTargets
 */
export async function syncNegativeProductTargetsToAmazon(
  accountId: number,
  negatives: Array<{
    campaignId: string;
    adGroupId?: string;
    asin: string;
    campaignType: 'sp' | 'sb' | 'sd';
    negativeScope: 'campaign' | 'ad_group';
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
  
  // 按campaignType和negativeScope分组处理
  const spCampaignLevel = negatives.filter(n => n.campaignType === 'sp' && n.negativeScope === 'campaign');
  const spAdGroupLevel = negatives.filter(n => n.campaignType === 'sp' && n.negativeScope === 'ad_group');
  const sbAdGroupLevel = negatives.filter(n => n.campaignType === 'sb');
  const sdAdGroupLevel = negatives.filter(n => n.campaignType === 'sd');
  
  // SP Campaign级否定产品定向
  if (spCampaignLevel.length > 0) {
    try {
      const apiResults = await withRetry(() => (syncService as Record<string, unknown>).client.createSpCampaignNegativeTargets(
        spCampaignLevel.map(n => ({
          campaignId: n.campaignId,
          expression: [{ type: 'asinSameAs', value: n.asin }],
          expressionType: 'manual',
        }))
      ), { label: 'SP Campaign否定产品定向', accountId });
      
      // @ts-expect-error - runtime type mismatch
      for (const r of apiResults) {
        if ((r as Record<string, unknown>).code === 'SUCCESS' || (r as Record<string, unknown>).targetId) {
          result.success++;
        } else {
          result.failed++;
          result.errors.push(`SP Campaign否定产品失败: ${(r as Record<string, unknown>).details || 'unknown'}`);
        }
      }
    } catch (err: unknown) {
      result.failed += spCampaignLevel.length;
      result.errors.push(`SP Campaign否定产品批量失败: ${(err as Error).message}`);
    }
  }
  
  // SP AdGroup级否定产品定向
  if (spAdGroupLevel.length > 0) {
    try {
      const apiResults = await withRetry(() => (syncService as Record<string, unknown>).client.createSpNegativeTargets(
        spAdGroupLevel.map(n => ({
          campaignId: n.campaignId,
          adGroupId: n.adGroupId || '',
          expression: [{ type: 'asinSameAs', value: n.asin }],
          expressionType: 'manual',
        }))
      ), { label: 'SP AdGroup否定产品定向', accountId });
      
      // @ts-expect-error - runtime type mismatch
      for (const r of apiResults) {
        if ((r as Record<string, unknown>).code === 'SUCCESS' || (r as Record<string, unknown>).targetId) {
          result.success++;
        } else {
          result.failed++;
          result.errors.push(`SP AdGroup否定产品失败: ${(r as Record<string, unknown>).details || 'unknown'}`);
        }
      }
    } catch (err: unknown) {
      result.failed += spAdGroupLevel.length;
      result.errors.push(`SP AdGroup否定产品批量失败: ${(err as Error).message}`);
    }
  }
  
  // SB AdGroup级否定产品定向
  if (sbAdGroupLevel.length > 0) {
    try {
      const apiResults = await (syncService as Record<string, unknown>).client.createSbNegativeTargets(
        sbAdGroupLevel.map(n => ({
          campaignId: n.campaignId,
          adGroupId: n.adGroupId || '',
          expression: [{ type: 'asinSameAs', value: n.asin }],
        }))
      );
      result.success += apiResults.length;
      log.info(`[AmazonApiHelper] v2: SB否定产品定向同步成功: ${apiResults.length}个`);
    } catch (err: unknown) {
      result.failed += sbAdGroupLevel.length;
      result.errors.push(`SB否定产品批量失败: ${(err as Error).message}`);
    }
  }
  
  // SD AdGroup级否定产品定向
  if (sdAdGroupLevel.length > 0) {
    try {
      const apiResults = await (syncService as Record<string, unknown>).client.createSdNegativeTargets(
        sdAdGroupLevel.map(n => ({
          adGroupId: n.adGroupId || '',
          expression: [{ type: 'asinSameAs', value: n.asin }],
        }))
      );
      result.success += apiResults.length;
      log.info(`[AmazonApiHelper] v2: SD否定产品定向同步成功: ${apiResults.length}个`);
    } catch (err: unknown) {
      result.failed += sdAdGroupLevel.length;
      result.errors.push(`SD否定产品批量失败: ${(err as Error).message}`);
    }
  }
  
  log.warn(`[AmazonApiHelper] v2: 否定产品定向同步完成: 成功=${result.success}, 失败=${result.failed}`);
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
    campaignId?: number;
    localCampaignId?: number;  // 本地数据库campaign ID
    amazonCampaignId?: string; // Amazon Campaign ID
    reason: string;
    isProductTarget?: boolean;
  }>
): Promise<{ success: number; failed: number; errors: string[] }> {
  const result = { success: 0, failed: 0, errors: [] as string[] };
  
  if (statusChanges.length === 0) return result;
  
  log.info(`[AmazonApiHelper] 开始同步关键词状态变更: accountId=${accountId}, 总计=${statusChanges.length}条`);
  
  const syncService = await getAmazonSyncService(accountId);
  if (!syncService) {
    const errorMsg = `无法获取账号 ${accountId} 的API服务（凭证缺失或无效）`;
    log.error(`[AmazonApiHelper] ${errorMsg}`);
    result.errors.push(errorMsg);
    result.failed = statusChanges.length;
    return result;
  }
  
  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  
  // 分离关键词和商品定向
  const keywordChanges = statusChanges.filter(s => !s.isProductTarget);
  const productTargetChanges = statusChanges.filter(s => s.isProductTarget);
  
  // v199: 批量处理关键词状态变更（而非逐条发送）
  if (keywordChanges.length > 0) {
    log.info(`[AmazonApiHelper] v199: 批量处理 ${keywordChanges.length} 个关键词状态变更`);
    
    // 第一步：批量解析Amazon keywordId
    const dbInstance = await db.getDb();
    const resolvedKeywordUpdates: Array<{ keywordId: string; state: 'enabled' | 'paused' | 'archived' }> = [];
    
    if (dbInstance) {
      const { keywords } = await import('../../drizzle/schema');
      const { eq } = await import('drizzle-orm');
      
      for (const change of keywordChanges) {
        let [kw] = await dbInstance.select({ keywordId: keywords.keywordId })
          .from(keywords)
          .where(eq(keywords.id, change.keywordId))
          .limit(1);
        
        if (!kw || !kw.keywordId || kw.keywordId === '0' || kw.keywordId === '') {
          // v429: entityIdResolver优先，amazonIdResolver降级
          try {
            const { resolveKeywordId } = await import('./entityIdResolver');
            const resolved = await resolveKeywordId(change.keywordId);
            if (resolved && resolved.amazonId) {
              kw = { keywordId: resolved.amazonId };
            }
          } catch (_) { /* entityIdResolver未初始化 */ }
          
          if (!kw || !kw.keywordId || kw.keywordId === '0' || kw.keywordId === '') {
            try {
              const { resolveKeywordIdOnDemand } = await import('./amazonIdResolver');
              const resolvedId = await resolveKeywordIdOnDemand(accountId, change.keywordId);
              if (resolvedId) {
                kw = { keywordId: resolvedId };
              }
            } catch (resolveErr: unknown) {
              log.error(`[AmazonApiHelper] v429: 即时回填异常: ${(resolveErr as Error).message}`);
            }
          }
          
          if (!kw || !kw.keywordId || kw.keywordId === '0' || kw.keywordId === '') {
            result.failed++;
            result.errors.push(`关键词 ${change.keywordId} 缺少Amazon keywordId`);
            continue;
          }
        }
        
        resolvedKeywordUpdates.push({
          keywordId: String(kw.keywordId),
          state: change.newStatus,
        });
      }
    } else {
      result.failed += keywordChanges.length;
      result.errors.push('数据库连接失败');
    }
    
    // 第二步：批量发送到Amazon（updateKeywordStatus已有分批逻辑）
    if (resolvedKeywordUpdates.length > 0) {
      try {
        log.info(`[AmazonApiHelper] v199: 批量发送 ${resolvedKeywordUpdates.length} 个关键词状态更新到Amazon`);
        const apiResult: unknown = await withRetry(
          () => (syncService as Record<string, unknown>).client.updateKeywordStatus(resolvedKeywordUpdates),
          { maxRetries: 2, baseDelayMs: 2000, label: `batchUpdateKeywordStatus-${resolvedKeywordUpdates.length}`, accountId }
        );
        
        result.success += apiResult.successCount;
        if (apiResult.errors.length > 0) {
          result.failed += apiResult.errors.length;
          for (const err of apiResult.errors) {
            result.errors.push(`关键词 ${err.keywordId} 状态更新失败: ${err.details || (err as Record<string, unknown>).code}`);
          }
        }
        log.warn(`[AmazonApiHelper] v199: 关键词状态批量更新完成: 成功=${apiResult.successCount}, 失败=${apiResult.errors.length}`);
      } catch (batchErr: unknown) {
        log.error(`[AmazonApiHelper] v199: 关键词状态批量更新异常: ${(batchErr as Error).message}`);
        result.failed += resolvedKeywordUpdates.length;
        result.errors.push(`关键词状态批量更新异常: ${(batchErr as Error).message}`);
      }
    }
  }
  
  // v199: 批量处理商品定向状态变更
  if (productTargetChanges.length > 0) {
    log.info(`[AmazonApiHelper] v199: 批量处理 ${productTargetChanges.length} 个商品定向状态变更`);
    
    const ptDbInstance = await db.getDb();
    const resolvedTargetUpdates: Array<{ targetId: string; state: 'enabled' | 'paused' | 'archived' }> = [];
    
    if (ptDbInstance) {
      const { productTargets } = await import('../../drizzle/schema');
      const { eq } = await import('drizzle-orm');
      
      for (const change of productTargetChanges) {
        const [pt] = await ptDbInstance.select({ targetId: productTargets.targetId })
          .from(productTargets)
          .where(eq(productTargets.id, change.keywordId))
          .limit(1);
        
        let resolvedTargetId: string | null = pt?.targetId && pt.targetId !== '0' && pt.targetId !== '' ? String(pt.targetId) : null;
        
        if (!resolvedTargetId) {
          // v429: entityIdResolver优先，amazonIdResolver降级
          try {
            const { resolveProductTargetId } = await import('./entityIdResolver');
            const resolved = await resolveProductTargetId(change.keywordId);
            if (resolved && resolved.amazonId) {
              resolvedTargetId = resolved.amazonId;
            }
          } catch (_) { /* entityIdResolver未初始化 */ }
        }
        if (!resolvedTargetId) {
          try {
            const { resolveProductTargetIdOnDemand } = await import('./amazonIdResolver');
            resolvedTargetId = await resolveProductTargetIdOnDemand(accountId, change.keywordId);
          } catch (resolveErr: unknown) {
            log.error(`[AmazonApiHelper] v429: 商品定向即时回填异常: ${(resolveErr as Error).message}`);
          }
        }
        
        if (resolvedTargetId) {
          resolvedTargetUpdates.push({
            targetId: resolvedTargetId,
            state: change.newStatus,
          });
        } else {
          result.failed++;
          result.errors.push(`商品定向 ${change.keywordId} 缺少Amazon targetId且回填失败`);
        }
      }
    } else {
      result.failed += productTargetChanges.length;
      result.errors.push('数据库连接失败');
    }
    
    // 批量发送到Amazon（updateProductTargetStatus已有分批逻辑）
    if (resolvedTargetUpdates.length > 0) {
      try {
        log.info(`[AmazonApiHelper] v199: 批量发送 ${resolvedTargetUpdates.length} 个商品定向状态更新到Amazon`);
        const apiResult: unknown = await withRetry(
          () => (syncService as Record<string, unknown>).client.updateProductTargetStatus(resolvedTargetUpdates),
          { maxRetries: 2, baseDelayMs: 2000, label: `batchUpdateProductTargetStatus-${resolvedTargetUpdates.length}`, accountId }
        );
        
        result.success += apiResult.successCount;
        if (apiResult.errors.length > 0) {
          result.failed += apiResult.errors.length;
          for (const err of apiResult.errors) {
            result.errors.push(`商品定向 ${err.targetId} 状态更新失败: ${err.details || (err as Record<string, unknown>).code}`);
          }
        }
        log.warn(`[AmazonApiHelper] v199: 商品定向状态批量更新完成: 成功=${apiResult.successCount}, 失败=${apiResult.errors.length}`);
      } catch (batchErr: unknown) {
        log.error(`[AmazonApiHelper] v199: 商品定向状态批量更新异常: ${(batchErr as Error).message}`);
        result.failed += resolvedTargetUpdates.length;
        result.errors.push(`商品定向状态批量更新异常: ${(batchErr as Error).message}`);
      }
    }
  }
  
  log.warn(`[AmazonApiHelper] 关键词状态同步完成: 成功=${result.success}, 失败=${result.failed}`);
  return result;
}

/**
 * v359: 同步广告活动状态变更到 Amazon
 * 重构为按类型分组的并发模式，同类型的campaign并发发送（最多5个并发）
 * 原来: N个campaign = N次串行API调用
 * 现在: N个campaign = ceil(N/5)次并发批次
 */
export async function syncCampaignStatusToAmazon(
  accountId: number,
  statusChanges: Array<{
    campaignId?: number;
    localCampaignId?: number;
    amazonCampaignId: string;
    newStatus: 'enabled' | 'paused' | 'archived';
    campaignName: string;
    campaignType?: string;
    reason: string;
  }>
): Promise<{ success: number; failed: number; errors: string[] }> {
  const result = { success: 0, failed: 0, errors: [] as string[] };
  
  if (statusChanges.length === 0) return result;
  
  log.info(`[AmazonApiHelper] v359: 开始批量同步广告活动状态变更: accountId=${accountId}, 总计=${statusChanges.length}条`);
  
  const syncService = await getAmazonSyncService(accountId);
  if (!syncService) {
    const errorMsg = `无法获取账号 ${accountId} 的API服务（凭证缺失或无效）`;
    log.error(`[AmazonApiHelper] ${errorMsg}`);
    result.errors.push(errorMsg);
    result.failed = statusChanges.length;
    return result;
  }
  
  // v359: 验证并过滤无效的campaign
  const validChanges: typeof statusChanges = [];
  for (const change of statusChanges) {
    if (!change.amazonCampaignId || change.amazonCampaignId === '0' || change.amazonCampaignId === '') {
      result.failed++;
      result.errors.push(`广告活动 "${change.campaignName}" 缺少Amazon Campaign ID，无法同步状态`);
    } else {
      validChanges.push(change);
    }
  }
  
  // v359: 按类型分组，同类型内并发执行
  const CONCURRENCY = 5;
  
  async function processCampaignUpdate(change: typeof statusChanges[0]): Promise<{ success: boolean; error?: string }> {
    const campaignType = (change.campaignType || 'sp_manual').toLowerCase();
    try {
      await withRetry(async () => {
        if (campaignType === 'sb') {
          await (syncService as Record<string, unknown>).client.updateSbCampaign(change.amazonCampaignId, { state: change.newStatus.toUpperCase() });
        } else if (campaignType === 'sd') {
          await (syncService as Record<string, unknown>).client.updateSdCampaign(String(change.amazonCampaignId), { state: change.newStatus.toUpperCase() });
        } else {
          await (syncService as Record<string, unknown>).client.updateSpCampaign(change.amazonCampaignId, { state: change.newStatus.toUpperCase() } as Record<string, unknown>);
        }
      }, { maxRetries: 2, baseDelayMs: 2000, label: `campaignStatus-${change.amazonCampaignId}`, accountId });
      
      log.info(`[AmazonApiHelper] ✅ 广告活动状态更新成功: "${change.campaignName}" (${campaignType}) -> ${change.newStatus}`);
      return { success: true };
    } catch (error: unknown) {
      const errorMsg = `广告活动 "${change.campaignName}" (${change.amazonCampaignId}, ${campaignType}) 状态同步失败: ${(error as Error).message}`;
      log.error(`[AmazonApiHelper] ❌ ${errorMsg}`);
      
      // 记录同步失败到数据库
      try {
        const dbInstance = await db.getDb();
        if (dbInstance) {
          const { sql } = await import('drizzle-orm');
          await dbInstance.execute(sql`
            INSERT INTO sync_failures (entity_type, entity_id, amazon_id, operation, error_message, account_id, created_at) 
            VALUES ('campaign', ${change.campaignId || 0}, ${change.amazonCampaignId}, ${'status_change_' + change.newStatus}, ${((error as Error).message || '').substring(0, 1000)}, ${accountId}, NOW())
          `);
        }
      } catch (logError: unknown) {
        log.warn(`[AmazonApiHelper] 无法记录同步失败日志: ${(logError as Error).message}`);
      }
      
      return { success: false, error: errorMsg };
    }
  }
  
  // v359: 并发执行，每批最多CONCURRENCY个
  for (let i = 0; i < validChanges.length; i += CONCURRENCY) {
    const batch = validChanges.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.allSettled(batch.map(c => processCampaignUpdate(c)));
    
    for (const br of batchResults) {
      if (br.status === 'fulfilled' && br.value.success) {
        result.success++;
      } else {
        result.failed++;
        const errMsg = br.status === 'fulfilled' ? br.value.error : (br.reason as Error).message;
        if (errMsg) result.errors.push(errMsg);
      }
    }
    
    // 批间延迟避免限流
    if (i + CONCURRENCY < validChanges.length) {
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }
  
  log.warn(`[AmazonApiHelper] v359: 广告活动状态同步完成: 成功=${result.success}, 失败=${result.failed}`);
  return result;
}

/**
 * v359: 同步广告组状态变更到 Amazon
 * 重构为按类型分组的批量API调用
 * 原来: N个adGroup = N次串行API调用（每次只包含1个）
 * 现在: SP类型合并为1次批量API调用，SD类型合并为1次批量API调用
 */
export async function syncAdGroupStatusToAmazon(
  accountId: number,
  statusChanges: Array<{
    adGroupId: number;
    amazonAdGroupId: string;
    newStatus: 'enabled' | 'paused' | 'archived';
    adGroupName: string;
    campaignName: string;
    reason: string;
    campaignType?: string;
  }>
): Promise<{ success: number; failed: number; errors: string[] }> {
  const result = { success: 0, failed: 0, errors: [] as string[] };
  
  if (statusChanges.length === 0) return result;
  
  log.info(`[AmazonApiHelper] v359: 开始批量同步广告组状态变更: accountId=${accountId}, 总计=${statusChanges.length}条`);
  
  const syncService = await getAmazonSyncService(accountId);
  if (!syncService) {
    const errorMsg = `无法获取账号 ${accountId} 的API服务（凭证缺失或无效）`;
    log.error(`[AmazonApiHelper] ${errorMsg}`);
    result.errors.push(errorMsg);
    result.failed = statusChanges.length;
    return result;
  }
  
  // v359: 验证并过滤无效的adGroup
  const validChanges = statusChanges.filter(c => c.amazonAdGroupId && c.amazonAdGroupId !== '0' && c.amazonAdGroupId !== '');
  const invalidChanges = statusChanges.filter(c => !c.amazonAdGroupId || c.amazonAdGroupId === '0' || c.amazonAdGroupId === '');
  
  for (const invalid of invalidChanges) {
    result.failed++;
    result.errors.push(`广告组 "${invalid.adGroupName}" 缺少Amazon AdGroup ID，无法同步状态`);
  }
  
  // v359: 按广告类型分组，合并为批量API调用
  const spChanges = validChanges.filter(c => {
    const ct = (c.campaignType || '').toLowerCase();
    return ct !== 'sd' && ct !== 'sponsoreddisplay';
  });
  const sdChanges = validChanges.filter(c => {
    const ct = (c.campaignType || '').toLowerCase();
    return ct === 'sd' || ct === 'sponsoreddisplay';
  });
  
  // v359: SP类型批量更新
  if (spChanges.length > 0) {
    log.info(`[AmazonApiHelper] v359: 批量发送 ${spChanges.length} 个SP广告组状态更新`);
    try {
      const apiResult: unknown = await withRetry(
        () => (syncService as Record<string, unknown>).client.updateSpAdGroupStatus(
          spChanges.map(c => ({ adGroupId: c.amazonAdGroupId, state: c.newStatus }))
        ),
        { maxRetries: 2, baseDelayMs: 2000, label: `batchUpdateSpAdGroupStatus-${spChanges.length}`, accountId }
      );
      
      result.success += apiResult.successCount || 0;
      if (apiResult.errors && apiResult.errors.length > 0) {
        result.failed += apiResult.errors.length;
        for (const err of apiResult.errors) {
          result.errors.push(`SP广告组 ${(err as Record<string, unknown>).adGroupId}: ${(err as Record<string, unknown>).details || (err as Record<string, unknown>).code || 'unknown'}`);
        }
      }
      // 如果successCount未返回，通过总数减去失败数推算
      if (apiResult.successCount === undefined) {
        result.success += spChanges.length - (apiResult.errors?.length || 0);
      }
      log.info(`[AmazonApiHelper] v359: SP广告组状态批量更新完成`);
    } catch (batchErr: unknown) {
      log.error(`[AmazonApiHelper] v359: SP广告组状态批量更新异常: ${(batchErr as Error).message}`);
      result.failed += spChanges.length;
      result.errors.push(`SP广告组状态批量更新异常: ${(batchErr as Error).message}`);
    }
  }
  
  // v359: SD类型批量更新
  if (sdChanges.length > 0) {
    log.info(`[AmazonApiHelper] v359: 批量发送 ${sdChanges.length} 个SD广告组状态更新`);
    try {
      const apiResult: unknown = await withRetry(
        () => (syncService as Record<string, unknown>).client.updateSdAdGroupStatus(
          sdChanges.map(c => ({ adGroupId: c.amazonAdGroupId, state: c.newStatus }))
        ),
        { maxRetries: 2, baseDelayMs: 2000, label: `batchUpdateSdAdGroupStatus-${sdChanges.length}`, accountId }
      );
      
      result.success += apiResult.successCount || 0;
      if (apiResult.errors && apiResult.errors.length > 0) {
        result.failed += apiResult.errors.length;
        for (const err of apiResult.errors) {
          result.errors.push(`SD广告组 ${(err as Record<string, unknown>).adGroupId}: ${(err as Record<string, unknown>).details || (err as Record<string, unknown>).code || 'unknown'}`);
        }
      }
      if (apiResult.successCount === undefined) {
        result.success += sdChanges.length - (apiResult.errors?.length || 0);
      }
      log.info(`[AmazonApiHelper] v359: SD广告组状态批量更新完成`);
    } catch (batchErr: unknown) {
      log.error(`[AmazonApiHelper] v359: SD广告组状态批量更新异常: ${(batchErr as Error).message}`);
      result.failed += sdChanges.length;
      result.errors.push(`SD广告组状态批量更新异常: ${(batchErr as Error).message}`);
    }
  }
  
  log.warn(`[AmazonApiHelper] v359: 广告组状态同步完成: 成功=${result.success}, 失败=${result.failed}`);
  return result;
}
