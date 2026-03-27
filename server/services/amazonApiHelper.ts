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
import { getCircuitBreaker } from './circuitBreakerService';
import { getAdaptiveTimeout } from './adaptiveTimeoutService';
// v223: getAmazonSyncService 从 syncServiceProvider re-export
import { getAmazonSyncService as _getAmazonSyncService } from '../sync/scheduling/syncServiceProvider';

// v223: 类型安全的包装器
export async function getAmazonSyncService(accountId: number): Promise<AmazonSyncService | null> {
  return _getAmazonSyncService(accountId) as Promise<AmazonSyncService | null>;
}

const log = createModuleLogger('ApiHelper');

// v189+v369+v514: 统一的API调用重试工具函数（指数退避）
async function withRetry<T>(
  fn: () => Promise<T>,
  options: { maxRetries?: number; baseDelayMs?: number; label?: string; accountId?: number } = {}
): Promise<T> {
  const { maxRetries = 5, baseDelayMs = 10000, label = 'API', accountId = 0 } = options;
  let lastError: Error | null = null;
  // v360: 真正集成限流服务 - 在每次API调用前获取令牌
  const endpointType = classifyEndpoint(label);
  // v525: 自适应超时服务
  const adaptiveTimeout = getAdaptiveTimeout();
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // v360+v369: 调用前获取限流许可，使用真实accountId
      try {
        await acquireApiPermit(accountId, endpointType);
      } catch (_: any) { /* 限流服务异常不影响主流程 */ }
      const callStartTime = Date.now();
      const result = await fn();
      const callDurationMs = Date.now() - callStartTime;
      // v525: 记录耗时并通知熔断器
      try {
        adaptiveTimeout.recordLatency(endpointType, callDurationMs);
        getCircuitBreaker().recordSuccess(accountId, endpointType);
      } catch (_: any) {}
      return result;
    } catch (error: unknown) {
      // @ts-ignore
      lastError = error;
      // @ts-ignore
      const isThrottle = (error as unknown as Record<string, unknown>).response?.status === 429 || (error as Error).message?.includes('请求过于频繁') || (error as Error).message?.includes('Too Many Requests');
      // @ts-expect-error - Axios error response access
      const isServerError = (error as Error & { response?: unknown }).response?.status >= 500;
      const isNetworkError = (error as Error & { code?: string }).code === 'ECONNRESET' || 
        (error as Error & { code?: string }).code === 'ETIMEDOUT' ||
        (error as Error & { code?: string }).code === 'ECONNABORTED' ||
        (error as Error & { code?: string }).code === 'EPIPE' ||
        (error as Error).message?.includes('socket hang up') ||
        (error as Error).message?.includes('network timeout');
      const isRetryable = isThrottle || isServerError || isNetworkError;
      
      // v360+v369: 通知分端点限流服务，触发自适应降速，使用真实accountId
      if (isThrottle) {
        try {
          getApiRateLimitService().recordExternalThrottle(accountId, endpointType);
        } catch (_: any) { /* 限流服务异常不影响主流程 */ }
      }
      
      // v525: 非瞬态失败通知熔断器
      if (!isRetryable) {
        try { getCircuitBreaker().recordFailure(accountId, endpointType, false); } catch (_: any) {}
      } else if (isServerError || isNetworkError) {
        try { getCircuitBreaker().recordFailure(accountId, endpointType, true); } catch (_: any) {}
      }

      if (!isRetryable || attempt >= maxRetries) {
        throw error;
      }
      
      // v514: 所有可重试错误统一使用指数退避策略
      // 429限流: baseDelay * 2^attempt, 最大60s
      // 网络超时/服务器错误: baseDelay * 2^attempt, 最大30s
      const maxDelay = isThrottle ? 60000 : 30000;
      const jitter = Math.random() * 1000; // 添加随机抖动避免重试风暴
      const delay = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelay) + jitter;
      log.warn(`[AmazonApiHelper] ${label} 第${attempt + 1}/${maxRetries}次重试(指数退避)，等待${Math.round(delay)}ms... ` +
        `(${isThrottle ? '限流' : isNetworkError ? '网络异常' : '服务器错误'}: ${(error as Error).message?.substring(0, 80)})`);
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
    isSdAudience?: boolean;
    algorithmUsed?: string;
  }>
): Promise<{ success: number; failed: number; errors: string[]; itemResults: Map<number, { status: 'synced' | 'failed'; error?: string; apiResponseId?: string }> }> {
  const result = { success: 0, failed: 0, errors: [] as string[], itemResults: new Map<number, { status: 'synced' | 'failed'; error?: string; apiResponseId?: string }>() };
  
  if (adjustments.length === 0) return result;
  
  log.info(`[AmazonApiHelper] v359: 开始批量同步出价调整: accountId=${accountId}, 总计=${adjustments.length}条`);
  
  const syncService = await getAmazonSyncService(accountId);
  if (!syncService) {
    const errorMsg = `无法获取账号 ${accountId} 的API服务（凭证缺失或无效）`;
    log.warn(`[AmazonApiHelper] ${errorMsg}`);
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
  
  // v359+v512: 分离关键词、商品定向和SD受众，分别进行批量API调用
  const keywordAdjustments = uniqueAdjustments.filter(a => !a.isProductTarget && !a.isSdAudience);
  const productTargetAdjustments = uniqueAdjustments.filter(a => a.isProductTarget && !a.isSdAudience);
  const sdAudienceAdjustments = uniqueAdjustments.filter(a => a.isSdAudience);
  
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
  
  // v502: 批量IN查询解析关键词Amazon ID + campaignType + adGroupId，支持SP/SB/SD分流
  const resolvedKeywordBids: Array<{ keywordId: string; bid: number; localId: number; campaignType: string; adGroupId: string; campaignId: string }> = [];
  if (keywordAdjustments.length > 0) {
    const { inArray } = await import('drizzle-orm');
    const { campaigns: campaignsSchema, adGroups: adGroupsSchema } = await import('../../drizzle/schema');
    const kwLocalIds = keywordAdjustments.map(a => a.keywordId);
    
    // v506: 通过LEFT JOIN ad_groups获取Amazon adGroupId
    // keywords表的adGroupId列在v418迁移中已重命名为internal_ad_group_id(int)
    // 需要通过JOIN ad_groups表获取Amazon adGroupId(varchar)
    const kwResults = await dbInstance
      .select({
        id: keywords.id,
        keywordId: keywords.keywordId,
        keywordStatus: keywords.keywordStatus,
        campaignId: keywords.campaignId,  // Amazon campaign ID (varchar)
        adGroupId: adGroupsSchema.adGroupId,  // v506: 从ad_groups表获取Amazon adGroup ID
      })
      .from(keywords)
      .leftJoin(adGroupsSchema, eq(keywords.internalAdGroupId, adGroupsSchema.id))
      .where(inArray(keywords.id, kwLocalIds));
    
    // v502: 批量查询所有相关campaign的类型
    const uniqueCampaignIds = [...new Set(kwResults.map(kw => kw.campaignId).filter(Boolean))];
    const campaignTypeMap = new Map<string, string>();  // campaignId -> campaignType
    if (uniqueCampaignIds.length > 0) {
      try {
        const campResults = await dbInstance
          // @ts-ignore
          .select({ campaignId: campaignsSchema.campaignId, campaignType: campaignsSchema.campaignType })
          .from(campaignsSchema)
          // @ts-ignore
          .where(inArray(campaignsSchema.campaignId, uniqueCampaignIds));
        for (const camp of campResults) {
          if (camp.campaignId && camp.campaignType) {
            campaignTypeMap.set(camp.campaignId, camp.campaignType);
          }
        }
        log.info(`[v502] 批量查询campaign类型: ${uniqueCampaignIds.length}个campaign, ${campaignTypeMap.size}个已解析`);
      } catch (campErr: unknown) {
        log.warn(`[v502] 批量查询campaign类型失败: ${(campErr as Error).message}，将默认使用SP API`);
      }
    }
    
    // v522: 批量查询adGroup状态，过滤已归档的adGroup
    const adGroupStatusMap = new Map<string, string>();
    try {
      const uniqueAdGroupIds = [...new Set(kwResults.map(kw => kw.adGroupId).filter(Boolean))];
      if (uniqueAdGroupIds.length > 0) {
        const agResults = await dbInstance
          .select({ adGroupId: adGroupsSchema.adGroupId, adGroupStatus: adGroupsSchema.adGroupStatus })
          .from(adGroupsSchema)
          .where(inArray(adGroupsSchema.adGroupId, uniqueAdGroupIds as string[]));
        for (const ag of agResults) {
          if (ag.adGroupId) adGroupStatusMap.set(ag.adGroupId, ag.adGroupStatus || 'enabled');
        }
      }
    } catch (_: any) { /* 查询失败不影响主流程 */ }

    const kwIdMap = new Map<number, { amazonId: string; campaignId: string; adGroupId: string; campaignType: string }>();
    const amazonDeletedKwIds = new Set<number>();
    for (const kw of kwResults) {
      // v513: 增强预检机制 — 扩展实体状态过滤范围
      const kwStatus = String(kw.keywordStatus || '');
      if (kwStatus === 'amazon_deleted' || kwStatus === 'archived' || kwStatus === 'amazon_archived') {
        amazonDeletedKwIds.add(kw.id);
        continue;
      }
      // v522: 检查adGroup状态 — 跳过已归档的adGroup下的关键词
      const agStatus = adGroupStatusMap.get(kw.adGroupId || '');
      if (agStatus === 'archived') {
        amazonDeletedKwIds.add(kw.id);
        continue;
      }
      if (kw.keywordId && kw.keywordId !== '0' && kw.keywordId !== '') {
        // @ts-ignore
        const campType = campaignTypeMap.get(kw.campaignId) || 'sp_manual';
        kwIdMap.set(kw.id, {
          amazonId: kw.keywordId,
          campaignId: kw.campaignId || '',
          adGroupId: kw.adGroupId || '',
          campaignType: campType,
        });
      }
    }
    if (amazonDeletedKwIds.size > 0) {
      log.warn(`[AmazonApiHelper] v477: 预过滤${amazonDeletedKwIds.size}个amazon_deleted/archived关键词，跳过API同步`);
      for (const deletedId of amazonDeletedKwIds) {
        result.failed++;
        result.errors.push(`keyword ${deletedId}: amazon_deleted/archived，跳过同步`);
        result.itemResults.set(deletedId, { status: 'failed', error: 'amazon_deleted/archived，跳过同步' });
      }
    }
    log.info(`[v502] 批量解析关键词: ${kwLocalIds.length}个请求, ${kwIdMap.size}个已解析, ${amazonDeletedKwIds.size}个已过滤`);
    
    for (const adj of keywordAdjustments) {
      if (amazonDeletedKwIds.has(adj.keywordId)) continue;
      
      const kwInfo = kwIdMap.get(adj.keywordId);
      let amazonKeywordId = kwInfo?.amazonId;
      
      if (!amazonKeywordId) {
        try {
          const { resolveKeywordId } = await import('./entityIdResolver');
          const resolved = await resolveKeywordId(adj.keywordId);
          if (resolved && resolved.amazonId) {
            amazonKeywordId = resolved.amazonId;
          }
        } catch (_: any) { /* entityIdResolver未初始化 */ }
      }
      if (!amazonKeywordId) {
        try {
          const { resolveKeywordIdOnDemand } = await import('./amazonIdResolver');
          amazonKeywordId = await resolveKeywordIdOnDemand(accountId, adj.keywordId) || undefined;
        } catch (resolveErr: unknown) {
          log.warn(`[AmazonApiHelper] v429: 即时回填异常: ${(resolveErr as Error).message}`);
        }
      }
      
      if (amazonKeywordId && amazonKeywordId !== '0' && amazonKeywordId !== '' && !amazonKeywordId.startsWith('SKIP_')) {
        resolvedKeywordBids.push({
          keywordId: String(amazonKeywordId),
          bid: Number(adj.newBid.toFixed(2)),
          localId: adj.keywordId,
          campaignType: kwInfo?.campaignType || 'sp_manual',
          adGroupId: kwInfo?.adGroupId || '',
          campaignId: kwInfo?.campaignId || '',
        });
      } else {
        result.failed++;
        const errMsg = `keyword ${adj.keywordId}: 缺少Amazon ID（可重试）`;
        result.errors.push(errMsg);
        result.itemResults.set(adj.keywordId, { status: 'failed', error: '缺少Amazon ID（可重试）' });
      }
    }
  }
  
  // v502: 批量IN查询解析商品定向Amazon ID + campaignType，支持SP/SB/SD分流
  const resolvedTargetBids: Array<{ targetId: string; bid: number; localId: number; campaignType: string }> = [];
  if (productTargetAdjustments.length > 0) {
    const { inArray } = await import('drizzle-orm');
    const { campaigns: campaignsSchema } = await import('../../drizzle/schema');
    const ptLocalIds = productTargetAdjustments.map(a => a.productTargetId || a.keywordId);
    
    // v502: 一次性查询所有productTarget的Amazon ID、targetStatus、campaignId
    const ptResults = await dbInstance
      .select({ id: productTargets.id, targetId: productTargets.targetId, targetStatus: productTargets.targetStatus, campaignId: productTargets.campaignId })
      .from(productTargets)
      .where(inArray(productTargets.id, ptLocalIds));
    
    // v502: 批量查询所有相关campaign的类型
    const ptUniqueCampaignIds = [...new Set(ptResults.map(pt => pt.campaignId).filter(Boolean))] as string[];
    const ptCampaignTypeMap = new Map<string, string>();
    if (ptUniqueCampaignIds.length > 0) {
      try {
        const campResults = await dbInstance
          .select({ campaignId: campaignsSchema.campaignId, campaignType: campaignsSchema.campaignType })
          .from(campaignsSchema)
          .where(inArray(campaignsSchema.campaignId, ptUniqueCampaignIds));
        for (const camp of campResults) {
          if (camp.campaignId && camp.campaignType) {
            ptCampaignTypeMap.set(camp.campaignId, camp.campaignType);
          }
        }
        log.info(`[v502] 商品定向campaign类型查询: ${ptUniqueCampaignIds.length}个campaign, ${ptCampaignTypeMap.size}个已解析`);
      } catch (campErr: unknown) {
        log.warn(`[v502] 商品定向campaign类型查询失败: ${(campErr as Error).message}，将默认使用SP API`);
      }
    }
    
    const ptIdMap = new Map<number, { amazonId: string; campaignType: string }>();
    const amazonDeletedPtIds = new Set<number>();
    for (const pt of ptResults) {
      // v513: 增强预检机制 — 扩展实体状态过滤范围
      const ptStatus = String(pt.targetStatus || '');
      if (ptStatus === 'amazon_deleted' || ptStatus === 'archived' || ptStatus === 'amazon_archived') {
        amazonDeletedPtIds.add(pt.id);
        continue;
      }
      if (pt.targetId && pt.targetId !== '0' && pt.targetId !== '') {
        const campType = pt.campaignId ? (ptCampaignTypeMap.get(pt.campaignId) || 'sp_manual') : 'sp_manual';
        ptIdMap.set(pt.id, { amazonId: pt.targetId, campaignType: campType });
      }
    }
    if (amazonDeletedPtIds.size > 0) {
      log.warn(`[AmazonApiHelper] v477: 预过滤${amazonDeletedPtIds.size}个amazon_deleted/archived商品定向，跳过API同步`);
      for (const deletedId of amazonDeletedPtIds) {
        result.failed++;
        result.errors.push(`product_target ${deletedId}: amazon_deleted/archived，跳过同步`);
        result.itemResults.set(deletedId, { status: 'failed', error: 'amazon_deleted/archived，跳过同步' });
      }
    }
    log.info(`[v502] 批量解析商品定向: ${ptLocalIds.length}个请求, ${ptIdMap.size}个已解析, ${amazonDeletedPtIds.size}个已过滤`);
    
    for (const adj of productTargetAdjustments) {
      const actualId = adj.productTargetId || adj.keywordId;
      if (amazonDeletedPtIds.has(actualId)) continue;
      
      const ptInfo = ptIdMap.get(actualId);
      let amazonTargetId = ptInfo?.amazonId;
      
      if (!amazonTargetId) {
        try {
          const { resolveProductTargetId } = await import('./entityIdResolver');
          const resolved = await resolveProductTargetId(actualId);
          if (resolved && resolved.amazonId) {
            amazonTargetId = resolved.amazonId;
          }
        } catch (_: any) { /* entityIdResolver未初始化 */ }
      }
      if (!amazonTargetId) {
        try {
          const { resolveProductTargetIdOnDemand } = await import('./amazonIdResolver');
          amazonTargetId = await resolveProductTargetIdOnDemand(accountId, actualId) || undefined;
        } catch (resolveErr: unknown) {
          log.warn(`[AmazonApiHelper] v429: 商品定向即时回填异常: ${(resolveErr as Error).message}`);
        }
      }
      
      if (amazonTargetId && amazonTargetId !== '0' && amazonTargetId !== '') {
        resolvedTargetBids.push({
          targetId: String(amazonTargetId),
          bid: Number(adj.newBid.toFixed(2)),
          localId: adj.keywordId,
          campaignType: ptInfo?.campaignType || 'sp_manual',
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
  
  // v502: 去重 + 按campaignType分组
  const deduplicatedKeywordBids = Array.from(
    resolvedKeywordBids.reduce((map, item) => {
      map.set(item.keywordId, item);
      return map;
    }, new Map<string, typeof resolvedKeywordBids[0]>()
  ).values());
  if (deduplicatedKeywordBids.length < resolvedKeywordBids.length) {
    log.warn(`[AmazonApiHelper] v474: 关键词出价去重: ${resolvedKeywordBids.length} -> ${deduplicatedKeywordBids.length}`);
  }
  
  // v502: 按campaignType分组 — SP/SB/SD分别调用不同API端点
  const spKeywordBids = deduplicatedKeywordBids.filter(r => {
    const ct = (r.campaignType || '').toLowerCase();
    return ct.includes('sp') || ct === '' || !ct.includes('sb') && !ct.includes('sd');
  });
  const sbKeywordBids = deduplicatedKeywordBids.filter(r => (r.campaignType || '').toLowerCase().includes('sb'));
  const sdKeywordBids = deduplicatedKeywordBids.filter(r => (r.campaignType || '').toLowerCase().includes('sd'));
  
  log.info(`[v502] 关键词出价按类型分组: SP=${spKeywordBids.length}, SB=${sbKeywordBids.length}, SD=${sdKeywordBids.length}`);
  
  // === SP关键词出价更新 ===
  // @ts-ignore
  if (spKeywordBids.length > 0) {
    log.info(`[v502] 批量发送 ${spKeywordBids.length} 个SP关键词出价更新到Amazon`);
    try {
      const apiResult: unknown = await withRetry(
        // @ts-ignore
        () => (syncService as unknown as Record<string, unknown>).client.updateKeywordBids(
          // @ts-ignore
          spKeywordBids.map(r => ({ keywordId: r.keywordId, bid: r.bid }))
        ),
        // @ts-ignore
        { maxRetries: 5, baseDelayMs: 5000, label: `batchUpdateSpKeywordBids-${spKeywordBids.length}`, accountId }
      // @ts-ignore
      );
      
      // @ts-ignore
      const successCount = spKeywordBids.length - (apiResult.errors?.length || 0);
      result.success += successCount;
      // @ts-ignore
      const requestId = apiResult.requestIds?.[0] || '';
      // @ts-ignore
      const failedKeywordIds = new Set((apiResult.errors || []).map((e: Record<string, unknown>) => String(e.keywordId)));
      // @ts-ignore
      for (const item of spKeywordBids) {
        // @ts-ignore
        if (!failedKeywordIds.has(item.keywordId)) {
          result.itemResults.set(item.localId, { status: 'synced', apiResponseId: requestId });
        }
      }
      
      const entityNotFoundKeywordIds: string[] = [];
      // @ts-ignore
      if (apiResult.errors && apiResult.errors.length > 0) {
        // @ts-ignore
        result.failed += apiResult.errors.length;
        // @ts-ignore
        for (const err of apiResult.errors as Array<Record<string, unknown>>) {
          const localItem = spKeywordBids.find(r => r.keywordId === String(err.keywordId));
          const errMsg = `SP keyword ${err.keywordId}: ${err.details || (err as unknown as Record<string, unknown>).code || 'unknown'}`;
          result.errors.push(errMsg);
          if (localItem) {
            result.itemResults.set(localItem.localId, { status: 'failed', error: String(err.details || (err as unknown as Record<string, unknown>).code) });
          }
          const errStr = JSON.stringify(err).toLowerCase();
          if (errStr.includes('entitynotfounderror') || errStr.includes('entity_not_found') || errStr.includes('could not find') || errStr.includes('entitystateerror') || errStr.includes('archived entity')) {
            if (err.keywordId) entityNotFoundKeywordIds.push(String(err.keywordId));
          }
        }
      }
      
      if (entityNotFoundKeywordIds.length > 0) {
        // @ts-ignore
        try {
          const idList = entityNotFoundKeywordIds.map(id => `'${String(id).replace(/'/g, "''")}'`).join(',');
          await dbInstance.execute(
            sql.raw(`UPDATE keywords SET keywordStatus = 'amazon_deleted' WHERE keywordId IN (${idList})`)
          );
          log.warn(`[v502] 已标记${entityNotFoundKeywordIds.length}个SP关键词为amazon_deleted`);
        } catch (markErr: unknown) {
          log.warn(`[v502] 标记过期SP关键词失败: ${(markErr as Error).message}`);
        }
      }
      
      // @ts-ignore
      log.info(`[v502] SP关键词出价更新完成: 成功=${successCount}, 失败=${apiResult.errors?.length || 0}`);
    } catch (batchErr: unknown) {
      log.warn(`[v502] SP关键词出价批量更新异常: ${(batchErr as Error).message}`);
      result.failed += spKeywordBids.length;
      for (const item of spKeywordBids) {
        result.itemResults.set(item.localId, { status: 'failed', error: (batchErr as Error).message });
      }
      result.errors.push(`SP关键词出价批量更新异常: ${(batchErr as Error).message}`);
    }
  }
  
  // === SB关键词出价更新 — 使用 updateSbKeywordBids ===
  if (sbKeywordBids.length > 0) {
    log.info(`[v502] 批量发送 ${sbKeywordBids.length} 个SB关键词出价更新到Amazon`);
    // v502: SB API需要 keywordId + bid + adGroupId + campaignId
    const sbUpdates = sbKeywordBids.filter(r => r.adGroupId && r.campaignId).map(r => ({
      keywordId: r.keywordId,
      bid: r.bid,
      adGroupId: r.adGroupId,
      campaignId: r.campaignId,
    }));
    const sbSkipped = sbKeywordBids.filter(r => !r.adGroupId || !r.campaignId);
    if (sbSkipped.length > 0) {
      log.warn(`[v502] ${sbSkipped.length}个SB关键词缺少adGroupId/campaignId，跳过`);
      for (const item of sbSkipped) {
        result.failed++;
        // @ts-ignore
        result.errors.push(`SB keyword ${item.keywordId}: 缺少adGroupId或campaignId`);
        result.itemResults.set(item.localId, { status: 'failed', error: '缺少adGroupId或campaignId' });
      }
    }
    
    // @ts-ignore
    if (sbUpdates.length > 0) {
      // @ts-ignore
      try {
        // v502: 批次间节流
        if (spKeywordBids.length > 0) {
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
        const apiResult: unknown = await withRetry(
          // @ts-ignore
          () => (syncService as unknown as Record<string, unknown>).client.updateSbKeywordBids(sbUpdates),
          { maxRetries: 5, baseDelayMs: 5000, label: `batchUpdateSbKeywordBids-${sbUpdates.length}`, accountId }
        );
        
        const sbFailedIds = new Map<string, string>();
        // @ts-ignore
        if (apiResult.errors && apiResult.errors.length > 0) {
          // @ts-ignore
          for (const err of apiResult.errors as Array<Record<string, unknown>>) {
            sbFailedIds.set(String(err.keywordId), String(err.details || err.code || 'SB_API_ERROR'));
          }
        }
        
        for (const item of sbKeywordBids.filter(r => r.adGroupId && r.campaignId)) {
          const failReason = sbFailedIds.get(item.keywordId);
          if (failReason) {
            // DUPLICATE视为成功
            if (failReason.includes('DUPLICATE')) {
              result.success++;
              result.itemResults.set(item.localId, { status: 'synced' });
            } else {
              result.failed++;
              result.errors.push(`SB keyword ${item.keywordId}: ${failReason}`);
              result.itemResults.set(item.localId, { status: 'failed', error: failReason });
              // v507: entityNotFound / KEYWORD_CANNOT_FIND_AD_GROUP 标记
              // 当Amazon返回这些错误时，说明关键词或其所属adGroup在Amazon端已不存在
              // 需要标记为amazon_deleted/archived以防止纠错器反复重试
              const failLower = failReason.toLowerCase();
              if (failLower.includes('entitynotfounderror') || failLower.includes('entity_not_found') || failLower.includes('keyword_cannot_find_ad_group') || failLower.includes('invalid_argument') || failLower.includes('cannot find the adgroup')) {
                try {
                  await dbInstance.execute(sql.raw(`UPDATE keywords SET keywordStatus = 'amazon_archived' WHERE keywordId = '${String(item.keywordId).replace(/'/g, "''")}' LIMIT 1`));
                  log.info(`[v522] SB关键词 ${item.keywordId} 标记为amazon_archived (原因: ${failReason.substring(0, 50)})`);
                } catch (_: any) { /* ignore */ }
                // v522: 同时标记adGroup为amazon_deleted，防止同一adGroup下的其他关键词继续失败
                if (failLower.includes('cannot find the adgroup') && item.adGroupId) {
                  try {
                    await dbInstance.execute(sql.raw(`UPDATE ad_groups SET adGroupStatus = 'archived' WHERE adGroupId = '${String(item.adGroupId).replace(/'/g, "''")}' LIMIT 1`));
                    log.warn(`[v522] SB adGroup ${item.adGroupId} 标记为archived (Amazon端已不存在)`);
                  } catch (_: any) { /* ignore */ }
                }
              }
            }
          } else {
            result.success++;
            result.itemResults.set(item.localId, { status: 'synced' });
          }
        }
        
        log.info(`[v502] SB关键词出价更新完成: 发送=${sbUpdates.length}, 成功=${sbUpdates.length - sbFailedIds.size}, 失败=${sbFailedIds.size}`);
      } catch (batchErr: unknown) {
        const batchErrMsg = (batchErr as Error).message || '';
        log.warn(`[v502] SB关键词出价批量更新异常: ${batchErrMsg}`);
        result.failed += sbUpdates.length;
        for (const item of sbKeywordBids.filter(r => r.adGroupId && r.campaignId)) {
          // @ts-ignore
          result.itemResults.set(item.localId, { status: 'failed', error: batchErrMsg });
        }
        result.errors.push(`SB关键词出价批量更新异常: ${batchErrMsg}`);
        // v522: 批量异常中检测 adGroup 不存在的情况，自动标记关键词和adGroup
        if (batchErrMsg.toLowerCase().includes('cannot find the adgroup')) {
          try {
            // 提取错误消息中的adGroupId
            const adGroupIdMatch = batchErrMsg.match(/(\d{10,})\s*$/);
            if (adGroupIdMatch) {
              await dbInstance.execute(sql.raw(`UPDATE ad_groups SET adGroupStatus = 'archived' WHERE adGroupId = '${adGroupIdMatch[1]}' LIMIT 1`));
              await dbInstance.execute(sql.raw(`UPDATE keywords SET keywordStatus = 'amazon_archived' WHERE internal_ad_group_id IN (SELECT id FROM ad_groups WHERE adGroupId = '${adGroupIdMatch[1]}') AND keywordStatus = 'enabled'`));
              log.warn(`[v522] 批量异常: adGroup ${adGroupIdMatch[1]} 及其关键词已标记为archived/amazon_archived`);
            }
          } catch (_: any) { /* ignore */ }
        }
      }
    }
  }
  
  // === SD关键词出价更新 — 使用 updateSdKeywordBids (如果存在) ===
  // @ts-ignore
  if (sdKeywordBids.length > 0) {
    log.info(`[v502] 批量发送 ${sdKeywordBids.length} 个SD关键词出价更新到Amazon`);
    // @ts-ignore
    try {
      if (sdKeywordBids.length > 0 && (spKeywordBids.length > 0 || sbKeywordBids.length > 0)) {
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
      // SD关键词使用与SP相同的格式（keywordId + bid）
      // @ts-ignore
      const sdApiMethod = (syncService as unknown as Record<string, unknown>).client.updateSdKeywordBids || (syncService as unknown as Record<string, unknown>).client.updateKeywordBids;
      const apiResult: unknown = await withRetry(
        () => sdApiMethod.call((syncService as unknown as Record<string, unknown>).client,
          // @ts-ignore
          sdKeywordBids.map(r => ({ keywordId: r.keywordId, bid: r.bid }))
        ),
        { maxRetries: 5, baseDelayMs: 5000, label: `batchUpdateSdKeywordBids-${sdKeywordBids.length}`, accountId }
      );
      
      // @ts-ignore
      const successCount = sdKeywordBids.length - (apiResult.errors?.length || 0);
      result.success += successCount;
      // @ts-ignore
      const failedIds = new Set((apiResult.errors || []).map((e: Record<string, unknown>) => String(e.keywordId)));
      for (const item of sdKeywordBids) {
        if (!failedIds.has(item.keywordId)) {
          result.itemResults.set(item.localId, { status: 'synced' });
        } else {
          result.failed++;
          result.itemResults.set(item.localId, { status: 'failed', error: 'SD API error' });
        }
      }
      // @ts-ignore
      log.info(`[v502] SD关键词出价更新完成: 成功=${successCount}, 失败=${apiResult.errors?.length || 0}`);
    } catch (batchErr: unknown) {
      log.warn(`[v502] SD关键词出价批量更新异常: ${(batchErr as Error).message}`);
      result.failed += sdKeywordBids.length;
      for (const item of sdKeywordBids) {
        result.itemResults.set(item.localId, { status: 'failed', error: (batchErr as Error).message });
      }
    }
  }
  
  // v476: API批次间节流 — 关键词出价更新完成后等待10秒再发送商品定向出价更新，优先保证100%成功率
  if (deduplicatedKeywordBids.length > 0 && resolvedTargetBids.length > 0) {
    log.info(`[AmazonApiHelper] v476: API批次间节流 - 等待10秒后发送商品定向出价更新...`);
    await new Promise(resolve => setTimeout(resolve, 10000));
  // @ts-ignore
  }
  
  // v502: 商品定向出价按campaignType分组
  const spTargetBids = resolvedTargetBids.filter(r => {
    const ct = (r.campaignType || '').toLowerCase();
    return ct.includes('sp') || ct === '' || (!ct.includes('sb') && !ct.includes('sd'));
  // @ts-ignore
  });
  const sbTargetBids = resolvedTargetBids.filter(r => (r.campaignType || '').toLowerCase().includes('sb'));
  // @ts-ignore
  const sdTargetBids = resolvedTargetBids.filter(r => (r.campaignType || '').toLowerCase().includes('sd'));
  
  // @ts-ignore
  if (resolvedTargetBids.length > 0) {
    log.info(`[v502] 商品定向出价按类型分组: SP=${spTargetBids.length}, SB=${sbTargetBids.length}, SD=${sdTargetBids.length}`);
  }
  
  // === SP商品定向出价更新 ===
  if (spTargetBids.length > 0) {
    log.info(`[v502] 批量发送 ${spTargetBids.length} 个SP商品定向出价更新到Amazon`);
    try {
      // @ts-ignore
      const apiResult: unknown = await withRetry(
        // @ts-ignore
        () => (syncService as unknown as Record<string, unknown>).client.updateProductTargetBids(
          spTargetBids.map(r => ({ targetId: r.targetId, bid: r.bid }))
        ),
        { maxRetries: 5, baseDelayMs: 5000, label: `batchUpdateSpProductTargetBids-${spTargetBids.length}`, accountId }
      );
      
      // @ts-ignore
      const successCount = spTargetBids.length - (apiResult.errors?.length || 0);
      result.success += successCount;
      // @ts-ignore
      const requestId = apiResult.requestIds?.[0] || '';
      
      // @ts-ignore
      const failedTargetIds = new Set((apiResult.errors || []).map((e: Record<string, unknown>) => String(e.targetId)));
      for (const item of spTargetBids) {
        if (!failedTargetIds.has(item.targetId)) {
          result.itemResults.set(item.localId, { status: 'synced', apiResponseId: requestId });
        }
      }
      
      const entityNotFoundTargetIds: string[] = [];
      // @ts-ignore
      if (apiResult.errors && apiResult.errors.length > 0) {
        // @ts-ignore
        result.failed += apiResult.errors.length;
        // @ts-ignore
        for (const err of apiResult.errors as Array<Record<string, unknown>>) {
          const localItem = spTargetBids.find(r => r.targetId === String(err.targetId));
          const errMsg = `SP product_target ${err.targetId}: ${err.details || (err as unknown as Record<string, unknown>).code || 'unknown'}`;
          result.errors.push(errMsg);
          if (localItem) {
            result.itemResults.set(localItem.localId, { status: 'failed', error: String(err.details || (err as unknown as Record<string, unknown>).code) });
          }
          const errStr = JSON.stringify(err).toLowerCase();
          if (errStr.includes('entitynotfounderror') || errStr.includes('entity_not_found') || errStr.includes('could not find') || errStr.includes('entitystateerror') || errStr.includes('archived entity')) {
            if (err.targetId) entityNotFoundTargetIds.push(String(err.targetId));
          }
        }
      }
      
      if (entityNotFoundTargetIds.length > 0) {
        try {
          const idList = entityNotFoundTargetIds.map(id => `'${String(id).replace(/'/g, "''")}'`).join(',');
          await dbInstance.execute(
            // @ts-ignore
            sql.raw(`UPDATE product_targets SET targetStatus = 'amazon_deleted' WHERE targetId IN (${idList})`)
          );
          log.warn(`[v502] 已标记${entityNotFoundTargetIds.length}个SP商品定向为amazon_deleted`);
        } catch (markErr: unknown) {
          log.warn(`[v502] 标记过期SP商品定向失败: ${(markErr as Error).message}`);
        }
      }
      
      // @ts-ignore
      log.info(`[v502] SP商品定向出价更新完成: 成功=${successCount}, 失败=${apiResult.errors?.length || 0}`);
    // @ts-ignore
    } catch (batchErr: unknown) {
      log.warn(`[v502] SP商品定向出价批量更新异常: ${(batchErr as Error).message}`);
      result.failed += spTargetBids.length;
      for (const item of spTargetBids) {
        result.itemResults.set(item.localId, { status: 'failed', error: (batchErr as Error).message });
      }
      result.errors.push(`SP商品定向出价批量更新异常: ${(batchErr as Error).message}`);
    }
  }
  
  // === SB商品定向出价更新 — 使用 updateSbProductTargetBids ===
  if (sbTargetBids.length > 0) {
    log.info(`[v502] 批量发送 ${sbTargetBids.length} 个SB商品定向出价更新到Amazon`);
    try {
      if (spTargetBids.length > 0) {
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
      // @ts-ignore
      const sbApiMethod = (syncService as unknown as Record<string, unknown>).client.updateSbProductTargetBids || (syncService as unknown as Record<string, unknown>).client.updateProductTargetBids;
      const apiResult: unknown = await withRetry(
        () => sbApiMethod.call((syncService as unknown as Record<string, unknown>).client,
          sbTargetBids.map(r => ({ targetId: r.targetId, bid: r.bid }))
        ),
        { maxRetries: 5, baseDelayMs: 5000, label: `batchUpdateSbProductTargetBids-${sbTargetBids.length}`, accountId }
      );
      
      // @ts-ignore
      const successCount = sbTargetBids.length - (apiResult.errors?.length || 0);
      result.success += successCount;
      // @ts-ignore
      const failedIds = new Set((apiResult.errors || []).map((e: Record<string, unknown>) => String(e.targetId)));
      for (const item of sbTargetBids) {
        if (!failedIds.has(item.targetId)) {
          result.itemResults.set(item.localId, { status: 'synced' });
        // @ts-ignore
        } else {
          result.failed++;
          // @ts-ignore
          result.itemResults.set(item.localId, { status: 'failed', error: 'SB API error' });
        }
      }
      // @ts-ignore
      log.info(`[v502] SB商品定向出价更新完成: 成功=${successCount}, 失败=${apiResult.errors?.length || 0}`);
    } catch (batchErr: unknown) {
      log.warn(`[v502] SB商品定向出价批量更新异常: ${(batchErr as Error).message}`);
      result.failed += sbTargetBids.length;
      for (const item of sbTargetBids) {
        // @ts-ignore
        result.itemResults.set(item.localId, { status: 'failed', error: (batchErr as Error).message });
      }
    }
  }
  
  // === SD商品定向出价更新 — 使用 updateSdProductTargetBids ===
  if (sdTargetBids.length > 0) {
    log.info(`[v502] 批量发送 ${sdTargetBids.length} 个SD商品定向出价更新到Amazon`);
    try {
      if (spTargetBids.length > 0 || sbTargetBids.length > 0) {
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
      // @ts-ignore
      const sdApiMethod = (syncService as unknown as Record<string, unknown>).client.updateSdProductTargetBids || (syncService as unknown as Record<string, unknown>).client.updateProductTargetBids;
      const apiResult: unknown = await withRetry(
        () => sdApiMethod.call((syncService as unknown as Record<string, unknown>).client,
          sdTargetBids.map(r => ({ targetId: r.targetId, bid: r.bid }))
        ),
        { maxRetries: 5, baseDelayMs: 5000, label: `batchUpdateSdProductTargetBids-${sdTargetBids.length}`, accountId }
      );
      
      // @ts-ignore
      const successCount = sdTargetBids.length - (apiResult.errors?.length || 0);
      result.success += successCount;
      // @ts-ignore
      const failedIds = new Set((apiResult.errors || []).map((e: Record<string, unknown>) => String(e.targetId)));
      for (const item of sdTargetBids) {
        if (!failedIds.has(item.targetId)) {
          result.itemResults.set(item.localId, { status: 'synced' });
        } else {
          result.failed++;
          result.itemResults.set(item.localId, { status: 'failed', error: 'SD API error' });
        }
      }
      // @ts-ignore
      log.info(`[v502] SD商品定向出价更新完成: 成功=${successCount}, 失败=${apiResult.errors?.length || 0}`);
    } catch (batchErr: unknown) {
      log.warn(`[v502] SD商品定向出价批量更新异常: ${(batchErr as Error).message}`);
      result.failed += sdTargetBids.length;
      for (const item of sdTargetBids) {
        result.itemResults.set(item.localId, { status: 'failed', error: (batchErr as Error).message });
      }
    }
  }
  
  // === v512: SD受众出价更新 — 使用 updateSdTargetBids ===
  // SD受众在Amazon API中也是target，使用audienceId(实际是Amazon targetId)进行更新
  if (sdAudienceAdjustments.length > 0) {
    log.info(`[v512] 批量发送 ${sdAudienceAdjustments.length} 个SD受众出价更新到Amazon`);
    try {
      // v512: 从sd_audiences表解析Amazon targetId
      const { sdAudiences: sdAudiencesSchema } = await import('../../drizzle/schema');
      const { inArray } = await import('drizzle-orm');
      const sdAudLocalIds = sdAudienceAdjustments.map(a => a.keywordId);
      const sdAudRows = await dbInstance
        .select({ id: sdAudiencesSchema.id, audienceId: sdAudiencesSchema.audienceId, state: sdAudiencesSchema.state })
        .from(sdAudiencesSchema)
        .where(inArray(sdAudiencesSchema.id, sdAudLocalIds));
      
      const sdAudIdMap = new Map<number, string>();
      for (const row of sdAudRows) {
        if (row.state !== 'archived' && row.audienceId) {
          sdAudIdMap.set(row.id, row.audienceId); // audienceId is actually Amazon targetId
        }
      }
      
      const sdAudBids: Array<{ targetId: string; bid: number; localId: number }> = [];
      for (const adj of sdAudienceAdjustments) {
        const amazonTargetId = sdAudIdMap.get(adj.keywordId);
        if (amazonTargetId) {
          sdAudBids.push({ targetId: amazonTargetId, bid: Number(adj.newBid.toFixed(2)), localId: adj.keywordId });
        } else {
          result.failed++;
          result.errors.push(`sd_audience ${adj.keywordId}: 缺少Amazon targetId`);
          result.itemResults.set(adj.keywordId, { status: 'failed', error: '缺少Amazon targetId' });
        }
      }
      
      if (sdAudBids.length > 0) {
        // 节流：等待之前的API调用完成
        if (resolvedTargetBids.length > 0 || deduplicatedKeywordBids.length > 0) {
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
        
        const apiResult: unknown = await withRetry(
          // @ts-ignore
          () => (syncService as unknown as Record<string, unknown>).client.updateSdTargetBids(
            sdAudBids.map(r => ({ targetId: r.targetId, bid: r.bid }))
          ),
          { maxRetries: 5, baseDelayMs: 5000, label: `batchUpdateSdAudienceBids-${sdAudBids.length}`, accountId }
        );
        
        // 处理结果
        const failedIds = new Set<string>();
        if (apiResult && typeof apiResult === 'object' && 'errors' in (apiResult as object)) {
          const errors = (apiResult as Record<string, unknown[]>).errors || [];
          for (const err of errors as Array<Record<string, unknown>>) {
            failedIds.add(String(err.targetId));
          }
        }
        
        for (const item of sdAudBids) {
          if (failedIds.has(item.targetId)) {
            result.failed++;
            result.itemResults.set(item.localId, { status: 'failed', error: 'SD audience API error' });
          } else {
            result.success++;
            result.itemResults.set(item.localId, { status: 'synced' });
          }
        }
        
        log.info(`[v512] SD受众出价更新完成: 发送=${sdAudBids.length}, 成功=${sdAudBids.length - failedIds.size}, 失败=${failedIds.size}`);
      }
    } catch (batchErr: unknown) {
      log.warn(`[v512] SD受众出价批量更新异常: ${(batchErr as Error).message}`);
      result.failed += sdAudienceAdjustments.length;
      for (const item of sdAudienceAdjustments) {
        result.itemResults.set(item.keywordId, { status: 'failed', error: (batchErr as Error).message });
      }
    }
  }
  
  const totalAttempts = result.success + result.failed;
  const failureRate = totalAttempts > 0 ? (result.failed / totalAttempts) * 100 : 0;
  log.warn(`[AmazonApiHelper] 出价同步完成: 成功=${result.success}, 失败=${result.failed}, 成功率=${(100 - failureRate).toFixed(1)}%`);
  if (result.errors.length > 0) {
    // v474: 如果所有错误都是entityNotFoundError/entityStateError，降级为WARN
    const hasRealErrors = result.errors.some(e => !e.includes('entityNotFoundError') && !e.includes('entityStateError') && !e.includes('ENTITY_NOT_FOUND'));
    if (hasRealErrors) {
      log.warn(`[AmazonApiHelper] 错误详情: ${result.errors.slice(0, 5).join('; ')}`);
    } else {
      log.warn(`[AmazonApiHelper] v474: 已删除/归档实体错误(${result.errors.length}条): ${result.errors.slice(0, 3).join('; ').slice(0, 200)}`);
    }
  }
  
  // v454: 记录同步统计到日志，便于追踪失败率趋势
  log.info(`[AmazonApiHelper] v454: 出价同步统计 accountId=${accountId}: 总计=${totalAttempts}, 成功=${result.success}, 失败=${result.failed}, 成功率=${totalAttempts > 0 ? ((result.success / totalAttempts) * 100).toFixed(1) : 0}%`);
  
  // v126: API同步失败率监控告警
  const FAILURE_RATE_THRESHOLD = 20; // 失败率超过20%触发告警
  if (failureRate > FAILURE_RATE_THRESHOLD && totalAttempts >= 5) {
    log.warn(`[ALERT] ⚠️ Amazon API同步失败率过高! 失败率=${failureRate.toFixed(1)}% (阈值=${FAILURE_RATE_THRESHOLD}%), 成功=${result.success}, 失败=${result.failed}`);
    log.warn(`[ALERT] 请检查Amazon API凭证、配额和网络状态`);
    
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
  // v474: 排除SB/SD端点的403错误，这些是预期的(账户未开通该广告类型)
  const authErrors = result.errors.filter(e => {
    // v474: 排除非认证错误（entityNotFoundError/entityStateError等）
    if (e.includes('entityNotFoundError') || e.includes('entityStateError') || e.includes('ENTITY_NOT_FOUND')) {
      return false;
    }
    // 排除SB/SD权限不足的403错误
    if ((e.includes('status=403') || e.includes('Forbidden') || e.includes('PERMISSION_DENIED')) && 
        (e.includes('/sb/') || e.includes('/sd/') || e.includes('SB/SD权限不足'))) {
      return false;
    }
    // v474: 使用更精确的匹配模式避免关键词ID中包含'403'的误报
    return e.includes('status=401') || e.includes('HTTP 401') || e.includes('Unauthorized') || 
           e.includes('status=403') || e.includes('HTTP 403') || e.includes('Forbidden') ||
           e.includes('Token已过期') || e.includes('token expired');
  });
  if (authErrors.length > 0) {
    log.warn(`[ALERT] v333: ⚠️ 发现${authErrors.length}条认证相关错误! 请立即检查accountId=${accountId}的API凭证有效性`);
    log.warn(`[ALERT] v333: 认证错误详情: ${authErrors.slice(0, 3).join('; ')}`);
    
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
  // @ts-ignore
  newKeywords: Array<{
    localKeywordId?: number;  // 本地数据库的keyword ID（如果已插入）
    adGroupId: number | string;  // v201: Amazon AdGroup ID (支持string避免精度丢失)
    // @ts-ignore
    campaignId: number | string;  // v201: Amazon Campaign ID (支持string避免精度丢失)
    // @ts-ignore
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
  
  // @ts-ignore
  log.info(`[AmazonApiHelper] 开始同步新关键词到Amazon: accountId=${accountId}, 总计=${newKeywords.length}个`);
  
  const syncService = await getAmazonSyncService(accountId);
  if (!syncService) {
    // @ts-ignore
    const errorMsg = `无法获取账号 ${accountId} 的API服务`;
    result.errors.push(errorMsg);
    // @ts-ignore
    result.failed = newKeywords.length;
    return result;
  // @ts-ignore
  }
  
  // v337: Amazon端存在性检查 - 在创建前检查关键词是否已存在于Amazon
  // 按adGroupId分组，批量查询已存在的关键词
  let keywordsToCreate = [...newKeywords]; // v337: 使用副本避免修改原始参数
  const existingKeywordsMap = new Map<string, Set<string>>(); // adGroupId -> Set<"keywordText::matchType">
  try {
    const adGroupIds = [...new Set(newKeywords.map(k => String(k.adGroupId)))];
    for (const agId of adGroupIds) {
      try {
        // @ts-ignore
        const existingKws = await (syncService as unknown as Record<string, unknown>).client.listSpKeywords(Number(agId));
        const keySet = new Set<string>();
        for (const kw of (existingKws as unknown[])) {
          // @ts-ignore
          const text = (kw.keywordText || '').toLowerCase().trim();
          // @ts-ignore
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
      // @ts-ignore
      const agKeySet = existingKeywordsMap.get(String(kw.adGroupId));
      // @ts-ignore
      const lookupKey = `${kw.keywordText.toLowerCase().trim()}::${kw.matchType.toLowerCase()}`;
      if (agKeySet && agKeySet.has(lookupKey)) {
        result.success++; // 已存在视为成功（幂等）
        // @ts-ignore
        result.createdKeywords.push({
          // @ts-ignore
          localId: kw.localKeywordId,
          amazonKeywordId: 0,
          // @ts-ignore
          keywordText: kw.keywordText,
        });
        // @ts-ignore
        log.info(`[AmazonApiHelper] v337: 关键词已存在于Amazon，跳过创建: "${kw.keywordText}" [${kw.matchType}] in adGroup ${kw.adGroupId}`);
      } else {
        // @ts-ignore
        filteredKeywords.push(kw);
      }
    }
    
    // @ts-ignore
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
        // @ts-ignore
        () => (syncService as unknown as Record<string, unknown>).client.createSpKeywords(
          // @ts-ignore
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
      // @ts-ignore
      for (let i = 0; i < apiResult.createdKeywords.length; i++) {
        // @ts-ignore
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
              log.warn(`[AmazonApiHelper] v357: 更新本地keywordId失败:`, (dbError as Error).message);
            }
          }
        } else {
          result.failed++;
          const errorCode = created.code || 'UNKNOWN';
          const errorDetail = (created as unknown as Record<string, unknown>).details || (created as unknown as Record<string, unknown>).description || '';
          result.errors.push(`关键词创建失败: "${original.keywordText}" - code=${errorCode}`);
          log.warn(`[AmazonApiHelper] ❌ 关键词创建失败: "${original.keywordText}", code=${errorCode}, detail=${errorDetail}`);
          
          // v350: 增强永久性错误识别 - 包含Amazon返回的通用ERROR码
          // 原因: 大量code=ERROR的关键词反复重试浪费API配额
          const isPermanentError = (
            errorCode === 'INVALID_VALUE' ||
            errorCode === 'INVALID_ARGUMENT' ||
            errorCode === 'ERROR' || // v350: Amazon通用拒绝码，通常为品牌词/受限词
            // @ts-ignore
            errorDetail.toLowerCase().includes('trademark') ||
            // @ts-ignore
            errorDetail.toLowerCase().includes('brand') ||
            // @ts-ignore
            errorDetail.toLowerCase().includes('restricted') ||
            // @ts-ignore
            errorDetail.toLowerCase().includes('not eligible') ||
            // @ts-ignore
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
              log.warn(`[AmazonApiHelper] v351: 标记永久失败异常: ${(markErr as Error).message}`);
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
      log.warn(`[AmazonApiHelper] ❌ ${errorMsg}`, (error as Error & { response?: unknown }).response?.data || '');
      
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
  // @ts-ignore
  return result;
// @ts-ignore
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
      
      // @ts-ignore
      for (let j = 0; j < apiResult.createdTargets.length; j++) {
        // @ts-ignore
        const created = apiResult.createdTargets[j];
        if (created.code === 'SUCCESS' && created.targetId) {
          result.success++;
          const mapKey = `${batch[j].adGroupId}:${batch[j].asin}`;
          result.targetIdMap.set(mapKey, created.targetId);
        } else {
          result.failed++;
          const errMsg = `ASIN ${batch[j].asin}: ${created.code}`;
          result.errors.push(errMsg);
          log.warn(`[AmazonApiHelper] v310: 商品定向创建失败: ${errMsg}`);
        }
      }
    } catch (batchErr: unknown) {
      log.warn(`[AmazonApiHelper] v310: 商品定向批次同步失败: ${(batchErr as Error).message}`);
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
        // @ts-ignore
        await (syncService as unknown as Record<string, unknown>).client.updateSbCampaign(String(campaignId), {
          budget: newBudget,
        });
      } else if (type === 'sd') {
        // @ts-ignore
        await (syncService as unknown as Record<string, unknown>).client.updateSdCampaign(String(campaignId), {  // v356: 统一使用String类型传递Amazon ID
          budget: newBudget,
        });
      } else {
        // @ts-ignore
        await (syncService as unknown as Record<string, unknown>).client.updateSpCampaign(String(campaignId), {
          dailyBudget: newBudget,
        });
      // @ts-ignore
      }
    }, { label: `预算同步 Campaign ${campaignId}`, accountId });
    
    log.info(`[AmazonApiHelper] 预算同步成功: Campaign ${campaignId} (${type}), 新预算=$${newBudget}`);
    return true;
  } catch (error: unknown) {
    log.warn(`[AmazonApiHelper] 预算同步失败(含重试): Campaign ${campaignId} (${campaignType}):`, (error as Error).message);
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
        // @ts-ignore
        await (syncService as unknown as Record<string, unknown>).client.updateSbCampaign(String(campaignId), {
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
        // @ts-ignore
        await (syncService as unknown as Record<string, unknown>).client.updateSpCampaign(String(campaignId), {
          dynamicBidding: {
            placementBidding,
          },
        } as Record<string, unknown>);
      }, { label: `SP位置倾斜同步 Campaign ${campaignId}`, accountId });
      log.info(`[AmazonApiHelper] SP位置倾斜同步成功: Campaign ${campaignId}, Top=${topOfSearchPercent}%, ProductPage=${productPagePercent}%`);
    }
    return true;
  // @ts-ignore
  } catch (error: unknown) {
    log.warn(`[AmazonApiHelper] 位置倾斜同步失败(含重试): Campaign ${campaignId}:`, (error as Error).message);
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
// @ts-ignore
): Promise<{ success: number; failed: number; errors: string[]; keywordIdMap: Map<string, string> }> {
  const result = { success: 0, failed: 0, errors: [] as string[], keywordIdMap: new Map<string, string>() };
  
  if (negatives.length === 0) return result;
  
  // @ts-ignore
  const syncService = await getAmazonSyncService(accountId);
  // @ts-ignore
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
    // @ts-ignore
    try {
      // v149: 幂等性 - 获取已有的campaign级否定词进行去重
      // v176: 修复matchType格式标准化 - Amazon返回NEGATIVE_PHRASE，本地用negativePhrase
      const uniqueCampaignIds = [...new Set(campaignLevel.map(n => n.campaignId))];
      const existingNegatives = new Set<string>();
      for (const cid of uniqueCampaignIds) {
        try {
          // @ts-ignore
          const existing = await (syncService as unknown as Record<string, unknown>).client.listSpCampaignNegativeKeywords(String(cid));  // v356: 确保string类型
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
        // @ts-ignore
        return !existingNegatives.has(key);
      });
      
      const skippedCount = campaignLevel.length - newCampaignNegatives.length;
      if (skippedCount > 0) {
        log.info(`[AmazonApiHelper] 幂等性去重: 跳过${skippedCount}个已存在的campaign级否定词`);
        result.success += skippedCount; // 已存在视为成功
      }
      
      if (newCampaignNegatives.length > 0) {
        // v189: 使用withRetry包装API调用
        // @ts-ignore
        const results = await withRetry(() => (syncService as unknown as Record<string, unknown>).client.createSpCampaignNegativeKeywords(
          newCampaignNegatives.map(n => ({
            campaignId: n.campaignId,
            keywordText: n.keywordText,
            matchType: n.matchType,
          }))
        ), { label: 'Campaign否定词创建', accountId });
        
        // v175b: 正确处理部分成功的响应 - 通过index关联回原始请求
        // @ts-expect-error - runtime type mismatch
        for (let ri = 0; ri < results.length; ri++) {
          // @ts-ignore
          const r = results[ri] as Record<string, unknown>;
          // @ts-ignore
          if (r.code === 'SUCCESS' || r.code === 'SUCCESS_DUPLICATE' || r.keywordId) {
            result.success++;
            // v195: 记录成功创建的否定词ID，用于回写amazon_negative_keyword_id
            const idx = r.index !== undefined ? r.index : ri;
            // @ts-ignore
            if (idx < newCampaignNegatives.length) {
              // @ts-ignore
              const neg = newCampaignNegatives[idx];
              const mapKey = `campaign:${neg.campaignId}:${neg.keywordText.toLowerCase()}`;
              if (r.keywordId) {
                // @ts-ignore
                result.keywordIdMap.set(mapKey, String(r.keywordId));
              }
              // v449: 区分新创建和重复的日志
              const dupTag = r.code === 'SUCCESS_DUPLICATE' ? ' (duplicate, 已存在)' : '';
              log.info(`[AmazonApiHelper] 否定词创建成功${dupTag}: "${neg.keywordText}" -> keywordId=${r.keywordId}`);
            // @ts-ignore
            }
          // @ts-ignore
          } else {
            result.failed++;
            // v175b: 记录失败的具体关键词信息
            const idx = r.index !== undefined ? r.index : ri;
            // @ts-ignore
            const failedKeyword = idx < newCampaignNegatives.length 
              // @ts-ignore
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
          // @ts-ignore
          const existing = await (syncService as unknown as Record<string, unknown>).client.listSpNegativeKeywords(agId as unknown);
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
        // @ts-ignore
        const results = await withRetry(() => (syncService as unknown as Record<string, unknown>).client.createSpNegativeKeywords(
          // @ts-ignore
          (newAdGroupNegatives as unknown[]).map((n: Record<string, unknown>) => ({
            adGroupId: n.adGroupId!,
            campaignId: n.campaignId,
            keywordText: n.keywordText,
            matchType: n.matchType,
          }))
        ), { label: 'AdGroup否定词创建', accountId });
        
        // @ts-expect-error - runtime type mismatch
        for (let ri = 0; ri < results.length; ri++) {
          // @ts-ignore
          const r = results[ri] as Record<string, unknown>;
          // @ts-ignore
          if (r.code === 'SUCCESS' || r.code === 'SUCCESS_DUPLICATE' || r.keywordId) {
            result.success++;
            // v195: 记录adGroup级否定词的keywordId
            const idx = r.index !== undefined ? r.index : ri;
            // @ts-ignore
            if (idx < newAdGroupNegatives.length) {
              // @ts-ignore
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
  
  // @ts-ignore
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
      // v478: 幂等性保障 - 查询已有的campaign级否定产品定向，去除重复
      const existingNegTargets = new Set<string>();
      const uniqueCampaignIds = [...new Set(spCampaignLevel.map(n => n.campaignId))];
      for (const cid of uniqueCampaignIds) {
        try {
          // @ts-ignore
          const existing = await (syncService as unknown as Record<string, unknown>).client.listSpCampaignNegativeTargets(cid);
          for (const e of (existing as Record<string, unknown>[])) {
            const expr = (e.expression as Array<{type: string; value?: string}>) || [];
            // @ts-ignore
            for (const ex of expr) {
              if (ex.type === 'asinSameAs' && ex.value) {
                existingNegTargets.add(`${e.campaignId}:${ex.value}`);
              }
            }
          }
        } catch (_listErr: any) {
          log.warn(`[AmazonApiHelper] v478: 查询campaign ${cid} 已有否定产品定向失败`);
        }
      }
      
      const newSpCampaignLevel = spCampaignLevel.filter(n => !existingNegTargets.has(`${n.campaignId}:${n.asin}`));
      const skippedCount = spCampaignLevel.length - newSpCampaignLevel.length;
      if (skippedCount > 0) {
        log.info(`[AmazonApiHelper] v478: 幂等性去重: 跳过${skippedCount}个已存在的campaign级否定产品定向`);
        result.success += skippedCount;
      }
      
      // @ts-ignore
      if (newSpCampaignLevel.length === 0) {
        log.info(`[AmazonApiHelper] v478: 所有SP Campaign否定产品定向已存在，跳过`);
      } else {
      // @ts-ignore
      const apiResults = await withRetry(() => (syncService as unknown as Record<string, unknown>).client.createSpCampaignNegativeTargets(
        newSpCampaignLevel.map(n => ({
          campaignId: n.campaignId,
          expression: [{ type: 'asinSameAs', value: n.asin }],
          expressionType: 'manual',
        }))
      ), { label: 'SP Campaign否定产品定向', accountId });
      
      // @ts-expect-error - runtime type mismatch
      for (const r of apiResults) {
        if ((r as unknown as Record<string, unknown>).code === 'SUCCESS' || (r as unknown as Record<string, unknown>).targetId) {
          result.success++;
        } else {
          result.failed++;
          result.errors.push(`SP Campaign否定产品失败: ${(r as unknown as Record<string, unknown>).details || 'unknown'}`);
        }
      }
      } // v478: 关闭else (newSpCampaignLevel.length > 0)块
    } catch (err: unknown) {
      result.failed += spCampaignLevel.length;
      result.errors.push(`SP Campaign否定产品批量失败: ${(err as Error).message}`);
    }
  }
  
  // SP AdGroup级否定产品定向
  if (spAdGroupLevel.length > 0) {
    try {
      // @ts-ignore
      const apiResults = await withRetry(() => (syncService as unknown as Record<string, unknown>).client.createSpNegativeTargets(
        spAdGroupLevel.map(n => ({
          campaignId: n.campaignId,
          adGroupId: n.adGroupId || '',
          expression: [{ type: 'asinSameAs', value: n.asin }],
          expressionType: 'manual',
        }))
      ), { label: 'SP AdGroup否定产品定向', accountId });
      
      // @ts-expect-error - runtime type mismatch
      for (const r of apiResults) {
        if ((r as unknown as Record<string, unknown>).code === 'SUCCESS' || (r as unknown as Record<string, unknown>).targetId) {
          result.success++;
        } else {
          result.failed++;
          result.errors.push(`SP AdGroup否定产品失败: ${(r as unknown as Record<string, unknown>).details || 'unknown'}`);
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
      // @ts-ignore
      const apiResults = await (syncService as unknown as Record<string, unknown>).client.createSbNegativeTargets(
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
      // @ts-ignore
      const apiResults = await (syncService as unknown as Record<string, unknown>).client.createSdNegativeTargets(
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
  
  // @ts-ignore
  log.info(`[AmazonApiHelper] 开始同步关键词状态变更: accountId=${accountId}, 总计=${statusChanges.length}条`);
  
  const syncService = await getAmazonSyncService(accountId);
  if (!syncService) {
    // @ts-ignore
    const errorMsg = `无法获取账号 ${accountId} 的API服务（凭证缺失或无效）`;
    // @ts-ignore
    log.warn(`[AmazonApiHelper] ${errorMsg}`);
    // @ts-ignore
    result.errors.push(errorMsg);
    // @ts-ignore
    result.failed = statusChanges.length;
    return result;
  }
  
  // @ts-ignore
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
          } catch (_: any) { /* entityIdResolver未初始化 */ }
          
          if (!kw || !kw.keywordId || kw.keywordId === '0' || kw.keywordId === '') {
            try {
              const { resolveKeywordIdOnDemand } = await import('./amazonIdResolver');
              const resolvedId = await resolveKeywordIdOnDemand(accountId, change.keywordId);
              if (resolvedId) {
                kw = { keywordId: resolvedId };
              }
            } catch (resolveErr: unknown) {
              log.warn(`[AmazonApiHelper] v429: 即时回填异常: ${(resolveErr as Error).message}`);
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
        // @ts-ignore
        const apiResult: unknown = await withRetry(
          // @ts-ignore
          () => (syncService as unknown as Record<string, unknown>).client.updateKeywordStatus(resolvedKeywordUpdates),
          { maxRetries: 2, baseDelayMs: 2000, label: `batchUpdateKeywordStatus-${resolvedKeywordUpdates.length}`, accountId }
        // @ts-ignore
        );
        
        // @ts-ignore
        result.success += apiResult.successCount;
        // @ts-ignore
        if (apiResult.errors.length > 0) {
          // @ts-ignore
          result.failed += apiResult.errors.length;
          // @ts-ignore
          for (const err of apiResult.errors) {
            result.errors.push(`关键词 ${err.keywordId} 状态更新失败: ${err.details || (err as unknown as Record<string, unknown>).code}`);
          }
        }
        // @ts-ignore
        log.warn(`[AmazonApiHelper] v199: 关键词状态批量更新完成: 成功=${apiResult.successCount}, 失败=${apiResult.errors.length}`);
      } catch (batchErr: unknown) {
        log.warn(`[AmazonApiHelper] v199: 关键词状态批量更新异常: ${(batchErr as Error).message}`);
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
          } catch (_: any) { /* entityIdResolver未初始化 */ }
        }
        if (!resolvedTargetId) {
          try {
            const { resolveProductTargetIdOnDemand } = await import('./amazonIdResolver');
            resolvedTargetId = await resolveProductTargetIdOnDemand(accountId, change.keywordId);
          } catch (resolveErr: unknown) {
            log.warn(`[AmazonApiHelper] v429: 商品定向即时回填异常: ${(resolveErr as Error).message}`);
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
      // @ts-ignore
      result.failed += productTargetChanges.length;
      result.errors.push('数据库连接失败');
    // @ts-ignore
    }
    
    // 批量发送到Amazon（updateProductTargetStatus已有分批逻辑）
    if (resolvedTargetUpdates.length > 0) {
      try {
        log.info(`[AmazonApiHelper] v199: 批量发送 ${resolvedTargetUpdates.length} 个商品定向状态更新到Amazon`);
        const apiResult: unknown = await withRetry(
          // @ts-ignore
          () => (syncService as unknown as Record<string, unknown>).client.updateProductTargetStatus(resolvedTargetUpdates),
          { maxRetries: 2, baseDelayMs: 2000, label: `batchUpdateProductTargetStatus-${resolvedTargetUpdates.length}`, accountId }
        );
        
        // @ts-ignore
        result.success += apiResult.successCount;
        // @ts-ignore
        if (apiResult.errors.length > 0) {
          // @ts-ignore
          result.failed += apiResult.errors.length;
          // @ts-ignore
          for (const err of apiResult.errors) {
            result.errors.push(`商品定向 ${err.targetId} 状态更新失败: ${err.details || (err as unknown as Record<string, unknown>).code}`);
          }
        }
        // @ts-ignore
        log.warn(`[AmazonApiHelper] v199: 商品定向状态批量更新完成: 成功=${apiResult.successCount}, 失败=${apiResult.errors.length}`);
      } catch (batchErr: unknown) {
        log.warn(`[AmazonApiHelper] v199: 商品定向状态批量更新异常: ${(batchErr as Error).message}`);
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
    log.warn(`[AmazonApiHelper] ${errorMsg}`);
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
          // @ts-ignore
          await (syncService as unknown as Record<string, unknown>).client.updateSbCampaign(change.amazonCampaignId, { state: change.newStatus.toUpperCase() });
        } else if (campaignType === 'sd') {
          // @ts-ignore
          await (syncService as unknown as Record<string, unknown>).client.updateSdCampaign(String(change.amazonCampaignId), { state: change.newStatus.toUpperCase() });
        } else {
          // @ts-ignore
          await (syncService as unknown as Record<string, unknown>).client.updateSpCampaign(change.amazonCampaignId, { state: change.newStatus.toUpperCase() } as Record<string, unknown>);
        }
      }, { maxRetries: 2, baseDelayMs: 2000, label: `campaignStatus-${change.amazonCampaignId}`, accountId });
      
      log.info(`[AmazonApiHelper] ✅ 广告活动状态更新成功: "${change.campaignName}" (${campaignType}) -> ${change.newStatus}`);
      return { success: true };
    } catch (error: unknown) {
      const errorMsg = `广告活动 "${change.campaignName}" (${change.amazonCampaignId}, ${campaignType}) 状态同步失败: ${(error as Error).message}`;
      log.warn(`[AmazonApiHelper] ❌ ${errorMsg}`);
      
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
      // @ts-ignore
      }
      
      // @ts-ignore
      return { success: false, error: errorMsg };
    // @ts-ignore
    }
  }
  
  // v359: 并发执行，每批最多CONCURRENCY个
  for (let i = 0; i < validChanges.length; i += CONCURRENCY) {
    // @ts-ignore
    const batch = validChanges.slice(i, i + CONCURRENCY);
    // @ts-ignore
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
    // @ts-ignore
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
// @ts-ignore
export async function syncAdGroupStatusToAmazon(
  // @ts-ignore
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
    log.warn(`[AmazonApiHelper] ${errorMsg}`);
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
        // @ts-ignore
        () => (syncService as unknown as Record<string, unknown>).client.updateSpAdGroupStatus(
          spChanges.map(c => ({ adGroupId: c.amazonAdGroupId, state: c.newStatus }))
        ),
        { maxRetries: 2, baseDelayMs: 2000, label: `batchUpdateSpAdGroupStatus-${spChanges.length}`, accountId }
      );
      
      // @ts-ignore
      result.success += apiResult.successCount || 0;
      // @ts-ignore
      if (apiResult.errors && apiResult.errors.length > 0) {
        // @ts-ignore
        result.failed += apiResult.errors.length;
        // @ts-ignore
        for (const err of apiResult.errors) {
          result.errors.push(`SP广告组 ${(err as unknown as Record<string, unknown>).adGroupId}: ${(err as unknown as Record<string, unknown>).details || (err as unknown as Record<string, unknown>).code || 'unknown'}`);
        }
      }
      // 如果successCount未返回，通过总数减去失败数推算
      // @ts-ignore
      if (apiResult.successCount === undefined) {
        // @ts-ignore
        result.success += spChanges.length - (apiResult.errors?.length || 0);
      }
      log.info(`[AmazonApiHelper] v359: SP广告组状态批量更新完成`);
    } catch (batchErr: unknown) {
      log.warn(`[AmazonApiHelper] v359: SP广告组状态批量更新异常: ${(batchErr as Error).message}`);
      result.failed += spChanges.length;
      result.errors.push(`SP广告组状态批量更新异常: ${(batchErr as Error).message}`);
    }
  }
  
  // v359: SD类型批量更新
  if (sdChanges.length > 0) {
    log.info(`[AmazonApiHelper] v359: 批量发送 ${sdChanges.length} 个SD广告组状态更新`);
    try {
      const apiResult: unknown = await withRetry(
        // @ts-ignore
        () => (syncService as unknown as Record<string, unknown>).client.updateSdAdGroupStatus(
          sdChanges.map(c => ({ adGroupId: c.amazonAdGroupId, state: c.newStatus }))
        ),
        { maxRetries: 2, baseDelayMs: 2000, label: `batchUpdateSdAdGroupStatus-${sdChanges.length}`, accountId }
      );
      
      // @ts-ignore
      result.success += apiResult.successCount || 0;
      // @ts-ignore
      if (apiResult.errors && apiResult.errors.length > 0) {
        // @ts-ignore
        result.failed += apiResult.errors.length;
        // @ts-ignore
        for (const err of apiResult.errors) {
          result.errors.push(`SD广告组 ${(err as unknown as Record<string, unknown>).adGroupId}: ${(err as unknown as Record<string, unknown>).details || (err as unknown as Record<string, unknown>).code || 'unknown'}`);
        }
      }
      // @ts-ignore
      if (apiResult.successCount === undefined) {
        // @ts-ignore
        result.success += sdChanges.length - (apiResult.errors?.length || 0);
      }
      log.info(`[AmazonApiHelper] v359: SD广告组状态批量更新完成`);
    } catch (batchErr: unknown) {
      log.warn(`[AmazonApiHelper] v359: SD广告组状态批量更新异常: ${(batchErr as Error).message}`);
      result.failed += sdChanges.length;
      result.errors.push(`SD广告组状态批量更新异常: ${(batchErr as Error).message}`);
    }
  }
  
  log.warn(`[AmazonApiHelper] v359: 广告组状态同步完成: 成功=${result.success}, 失败=${result.failed}`);
  return result;
}
