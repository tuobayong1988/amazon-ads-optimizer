/**
 * 关键词同步模块
 * 从 amazonSyncService.ts 拆分的独立模块
 */
import { eq, and, sql, gte, inArray } from 'drizzle-orm';
import { getDb } from '../db';
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
import { getDb } from '../db';
import { createModuleLogger } from '../utils/logger';
import { forwardAlign, markEntitiesVerified, nextSyncVersion } from './entityStateAlignment';
import type { AmazonAdsApiClient } from './amazonAdsApi';

/** 同步服务上下文 - 从AmazonSyncService传入 */
export interface SyncContext {
  client: AmazonAdsApiClient;
  accountId: number;
  userId: number;
  marketplace: string;
}

const log = createModuleLogger('keywordSync');

/**
 * v242: 结构化错误日志辅助函数 - 确保错误信息不被截断
 */
function serializeError(error: Error): string {
  try {
    const info: Record<string, unknown> = {
      message: (error as Error).message || 'Unknown error',
      code: (error as Record<string, unknown>).code,
      status: error.status || (error as Record<string, unknown>).response?.status,
      statusText: (error as Record<string, unknown>).response?.statusText,
      url: error.config?.url,
      method: error.config?.method,
      retryCount: error.retryCount,
    };
    // 记录API响应体（截断到500字符避免日志爆炸）
    if (error.response?.data) {
      const dataStr = typeof (error as Record<string, unknown>).response.data === 'string' 
        ? (error as Record<string, unknown>).response.data 
        : JSON.stringify(error.response.data);
      info.responseData = dataStr.substring(0, 500);
    }
    // 过滤掉undefined值
    return JSON.stringify(Object.fromEntries(Object.entries(info).filter(([_, v]) => v !== undefined)));
  } catch {
    return error?.message || String(error);
  }
}

/**
 * v242: 通用重试包装器 - 用于关键词同步的各个阶段
 */
async function withRetry<T>(
  operation: () => Promise<T>,
  operationName: string,
  maxRetries: number = 2,
  baseDelayMs: number = 3000
): Promise<T> {
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      return await operation();
    } catch (error: unknown) {
      lastError = error;
      const isThrottle = error.status === 429 || (error as Error).message?.includes('429') || (error as Error).message?.includes('限流');
      const isRetryable = isThrottle || error.status >= 500 || (error as Error & { code?: string }).code === 'ECONNRESET' || (error as Error & { code?: string }).code === 'ETIMEDOUT';
      
      if (isRetryable && attempt <= maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * 1000;
        log.warn(`[v242] ${operationName} 第${attempt}次失败(可重试): ${serializeError(error)}, ${Math.round(delay)}ms后重试...`);
        await new Promise(r => setTimeout(r, delay));
      } else {
        log.warn(`[v242] ${operationName} 最终失败(尝试${attempt}次): ${serializeError(error)}`);
        throw error;
      }
    }
  }
  throw lastError;
}

/**
 * 同步SB关键词投放
 * 从SB API获取关键词列表并同步到本地数据库
 * v242: 增强错误处理和重试机制
 */
export async function syncSbKeywords(service: SyncContext,): Promise<{ synced: number; skipped: number }> {
  const db = await getDb();
  if (!db) return { synced: 0, skipped: 0 };

  try {
    // v242: 使用重试包装器获取SB关键词列表
    const apiKeywords = await withRetry(
      () => service.client.listSbKeywords(),
      `SB关键词列表获取(account=${service.accountId})`,
      2, 3000
    );
    let synced = 0;
    let skipped = 0;

    log.debug(`获取到 ${apiKeywords.length} 个SB关键词`);

    // v681: 批量预加载 — 消除N+1查询问题
    // 1. 预加载所有adGroups的 adGroupId -> record 映射
    const allAdGroups = await db.select().from(adGroups);
    const adGroupByAmazonId = new Map<string, typeof allAdGroups[0]>();
    for (const ag of allAdGroups) {
      if (ag.adGroupId) adGroupByAmazonId.set(String(ag.adGroupId), ag);
    }
    // 2. 预加载所有keywords，建立多维索引
    const allKeywords = await db.select().from(keywords);
    // 索引1: internalAdGroupId + keywordId -> record
    const kwByAgIdAndKwId = new Map<string, typeof allKeywords[0]>();
    // 索引2: internalAdGroupId + keywordText + matchType -> record (v647二次匹配)
    const kwByAgIdTextMatch = new Map<string, typeof allKeywords[0]>();
    for (const kw of allKeywords) {
      if (kw.internalAdGroupId && kw.keywordId) {
        kwByAgIdAndKwId.set(`${kw.internalAdGroupId}_${kw.keywordId}`, kw);
      }
      if (kw.internalAdGroupId && kw.keywordText && kw.matchType) {
        kwByAgIdTextMatch.set(`${kw.internalAdGroupId}_${kw.keywordText.toLowerCase()}_${kw.matchType.toLowerCase()}`, kw);
      }
    }
    log.info(`v681: SB关键词批量预加载完成 — ${allAdGroups.length}个广告组, ${allKeywords.length}个关键词, API返回${apiKeywords.length}个`);

    for (const apiKeyword of apiKeywords) {
      // v681: 使用Map查找替代DB查询
      const adGroup = adGroupByAmazonId.get(String(apiKeyword.adGroupId));
      if (!adGroup) continue;

      // v681: 使用Map查找existing keyword
      let existing = kwByAgIdAndKwId.get(`${adGroup.id}_${String(apiKeyword.keywordId)}`);
      
      // v647: 二次匹配 — 通过adGroupId+keywordText+matchType修复被污染的keywordId
      if (!existing && (apiKeyword.keywordText || apiKeyword.keyword)) {
        const kwText = apiKeyword.keywordText || apiKeyword.keyword || '';
        const normalizedMatch = (apiKeyword.matchType || 'broad').toLowerCase();
        const textMatched = kwByAgIdTextMatch.get(`${adGroup.id}_${kwText.toLowerCase()}_${normalizedMatch}`);
        if (textMatched) {
          const oldKwId = textMatched.keywordId || '';
          if (oldKwId !== String(apiKeyword.keywordId)) {
            log.info(`[v647] 修复SB keywordId(keywordSync): keyword="${kwText.substring(0, 40)}" 旧ID="${oldKwId.substring(0, 50)}" → 新ID="${String(apiKeyword.keywordId)}"`);
          }
          existing = textMatched;
        }
      }

      const normalizedMatchType = (apiKeyword.matchType || 'broad').toLowerCase() as 'broad' | 'phrase' | 'exact';
      const normalizedState = (apiKeyword.state || 'enabled').toLowerCase() as 'enabled' | 'paused' | 'archived';

      const keywordData = {
        internalAdGroupId: adGroup.id,
        accountId: service.accountId,
        campaignId: adGroup.campaignId,
        keywordId: String(apiKeyword.keywordId),
        keywordText: apiKeyword.keywordText || apiKeyword.keyword || '',
        matchType: normalizedMatchType,
        bid: String(apiKeyword.bid && apiKeyword.bid !== 'undefined' ? apiKeyword.bid : 0),
        keywordStatus: normalizedState,
        updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      };

      if (existing) {
        // v523.2: 保护 amazon_deleted 状态不被同步覆盖
        if (existing.keywordStatus === 'amazon_deleted' && normalizedState !== 'archived') {
          log.debug(`v523.2: 保护SB amazon_deleted状态 - keyword=${existing.keywordText}(id=${existing.id})`);
          delete (keywordData as Record<string, unknown>).keywordStatus;
        }
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

    log.info(`SB关键词同步完成: synced=${synced}, skipped=${skipped}`);

    // v525: 正向对齐 - SB关键词
    try {
      const syncVer = nextSyncVersion();
      const amazonKeywordIds = apiKeywords.map((k: any) => String(k.keywordId)).filter(Boolean);
      markEntitiesVerified('keyword', apiKeywords.map((k: any) => Number(k.keywordId)).filter(Boolean), syncVer);
      await forwardAlign(service.accountId, 'keyword', amazonKeywordIds);
    } catch (alignErr: unknown) {
      log.debug(`[v525] SB关键词正向对齐失败: ${(alignErr as Error).message}`);
    }

    return { synced, skipped };
  } catch (error: unknown) {
    log.warn(`[v242] SB关键词同步失败(account=${service.accountId}, marketplace=${service.marketplace}): ${serializeError(error)}`);
    return { synced: 0, skipped: 0 };
  }
}


/**
 * 同步SP关键词
 * @param lastSyncTime 上次同步时间，用于增量同步
 */
export async function syncSpKeywords(service: SyncContext,lastSyncTime?: string | null): Promise<number | { synced: number; skipped: number }> {
  const db = await getDb();
  if (!db) return { synced: 0, skipped: 0 };

  try {
    // v242: 使用重试包装器获取SP关键词列表
    const apiKeywords = await withRetry(
      () => service.client.listSpKeywords(),
      `SP关键词列表获取(account=${service.accountId})`,
      2, 3000
    );
    let synced = 0;
    let skipped = 0;

    // v681: 批量预加载 — 消除N+1查询问题（原先循环内每个关键词2-4次DB查询，现在只需要2次批量查询）
    // 1. 预加载所有adGroups的 adGroupId -> record 映射
    const allAdGroups = await db.select().from(adGroups);
    const adGroupByAmazonId = new Map<string, typeof allAdGroups[0]>();
    for (const ag of allAdGroups) {
      if (ag.adGroupId) adGroupByAmazonId.set(String(ag.adGroupId), ag);
    }
    // 2. 预加载所有keywords，建立多维索引
    const allKeywords = await db.select().from(keywords);
    // 索引1: internalAdGroupId + keywordId -> record
    const kwByAgIdAndKwId = new Map<string, typeof allKeywords[0]>();
    // 索引2: internalAdGroupId + keywordText + matchType -> record (v647二次匹配)
    const kwByAgIdTextMatch = new Map<string, typeof allKeywords[0]>();
    for (const kw of allKeywords) {
      if (kw.internalAdGroupId && kw.keywordId) {
        kwByAgIdAndKwId.set(`${kw.internalAdGroupId}_${kw.keywordId}`, kw);
      }
      if (kw.internalAdGroupId && kw.keywordText && kw.matchType) {
        kwByAgIdTextMatch.set(`${kw.internalAdGroupId}_${kw.keywordText.toLowerCase()}_${kw.matchType.toLowerCase()}`, kw);
      }
    }
    log.info(`v681: SP关键词批量预加载完成 — ${allAdGroups.length}个广告组, ${allKeywords.length}个关键词, API返回${apiKeywords.length}个`);

    // v150.1: 使用预加载的Map批量收集existing keyword IDs（不再逐条DB查询）
    const allExistingKeywordIds: number[] = [];
    for (const ak of apiKeywords) {
      const ag = adGroupByAmazonId.get(String(ak.adGroupId));
      if (!ag) continue;
      const ex = kwByAgIdAndKwId.get(`${ag.id}_${String(ak.keywordId)}`);
      if (ex) allExistingKeywordIds.push(ex.id);
    }
    const protectedKeywordIds = await getRecentlyOptimizedKeywordIds(allExistingKeywordIds, SYNC_PROTECTION_CONFIG.BID_PROTECTION_HOURS);
    const protectionStats = createSyncProtectionStats();
    log.info(`syncSpKeywords: 批量查询完成, ${protectedKeywordIds.size}个关键词有近期出价优化事件`);

    for (const apiKeyword of apiKeywords) {
      // v681: 使用Map查找替代DB查询
      const adGroup = adGroupByAmazonId.get(String(apiKeyword.adGroupId));
      if (!adGroup) continue;

      // v681: 使用Map查找existing keyword
      let existing = kwByAgIdAndKwId.get(`${adGroup.id}_${String(apiKeyword.keywordId)}`);
      
      // v647: 二次匹配 — 通过adGroupId+keywordText+matchType修复被污染的keywordId
      if (!existing && apiKeyword.keywordText) {
        const normalizedMatch = (apiKeyword.matchType || 'broad').toLowerCase();
        const textMatched = kwByAgIdTextMatch.get(`${adGroup.id}_${apiKeyword.keywordText.toLowerCase()}_${normalizedMatch}`);
        if (textMatched) {
          const oldKwId = textMatched.keywordId || '';
          if (oldKwId !== String(apiKeyword.keywordId)) {
            log.info(`[v647] 修复SP keywordId(keywordSync): keyword="${apiKeyword.keywordText?.substring(0, 40)}" 旧ID="${oldKwId.substring(0, 50)}" → 新ID="${String(apiKeyword.keywordId)}"`);
          }
          existing = textMatched;
        }
      }

      // 增量同步：如果有上次同步时间且记录已存在，检查是否需要更新
      // v215修复: 移除错误的updatedAt跳过逻辑
      // 始终使用Amazon API返回的最新数据更新本地记录

      const normalizedApiStatus = (apiKeyword.state || 'enabled').toLowerCase() as 'enabled' | 'paused' | 'archived';

      const keywordData: Record<string, unknown> = {
        internalAdGroupId: adGroup.id,
        accountId: service.accountId,
        campaignId: adGroup.campaignId,
        keywordId: String(apiKeyword.keywordId),
        keywordText: apiKeyword.keywordText,
        matchType: (apiKeyword.matchType || 'broad').toLowerCase() as 'broad' | 'phrase' | 'exact',
        keywordStatus: normalizedApiStatus,  // v311: 修复字段名 status → keywordStatus，与Drizzle schema一致
        bid: String(apiKeyword.bid && apiKeyword.bid !== 'undefined' ? apiKeyword.bid : (apiKeyword.defaultBid && apiKeyword.defaultBid !== 'undefined' ? apiKeyword.defaultBid : 0)),
        updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      };

      if (existing) {
        // v523.2: 保护 amazon_deleted 状态不被同步覆盖
        // 当本地已标记为 amazon_deleted 时，如果 Amazon API 仍返回 enabled/paused，
        // 说明 List API 缓存延迟，不应覆盖本地的删除标记
        if (existing.keywordStatus === 'amazon_deleted' && normalizedApiStatus !== 'archived') {
          log.debug(`v523.2: 保护amazon_deleted状态 - keyword=${existing.keywordText}(id=${existing.id}), API返回${normalizedApiStatus}，保留本地amazon_deleted`);
          delete keywordData.keywordStatus;
        }
        // v150: 智能出价保护策略
        // 检查optimization_events表，如果该关键词有24小时内成功同步到Amazon的出价优化事件，
        // 则保留本地出价不被覆盖（因为Amazon API数据可能有延迟）
        const localBid = parseFloat(existing.bid || '0');
        const apiBid = parseFloat(String(apiKeyword.bid || '0'));
        
        if (Math.abs(localBid - apiBid) > SYNC_PROTECTION_CONFIG.BID_THRESHOLD && localBid > 0) {
          // 出价不一致，检查是否有近期优化事件（使用批量查询结果）
          const hasRecentOpt = protectedKeywordIds.has(existing.id);
          if (hasRecentOpt) {
            // 有近期优化事件，保留本地出价，只更新其他字段
            log.debug(`v150: 出价保护生效 - keyword=${existing.keywordText}, local=$${localBid}, api=$${apiBid}, 保留本地优化出价`);
            delete keywordData.bid;
            protectionStats.bidProtected++;
            protectionStats.protectedEntities.push(`kw:${existing.keywordText}`);
          } else {
            log.debug(`v150: 出价差异 - keyword=${existing.keywordText}, local=$${localBid}, api=$${apiBid}, 以API为准`);
            protectionStats.bidOverwritten++;
          }
        }
        
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

    logSyncProtectionSummary('syncSpKeywords', protectionStats);

    // v525: 正向对齐 - 比对 Amazon 返回的关键词列表与本地数据库
    try {
      const syncVer = nextSyncVersion();
      const amazonKeywordIds = apiKeywords.map((k: any) => String(k.keywordId)).filter(Boolean);
      markEntitiesVerified('keyword', apiKeywords.map((k: any) => Number(k.keywordId)).filter(Boolean), syncVer);
      await forwardAlign(service.accountId, 'keyword', amazonKeywordIds);
    } catch (alignErr: unknown) {
      log.debug(`[v525] SP关键词正向对齐失败: ${(alignErr as Error).message}`);
    }

    return { synced, skipped };
  } catch (error: unknown) {
    log.warn(`[v242] SP关键词同步失败(account=${service.accountId}, marketplace=${service.marketplace}): ${serializeError(error)}`);
    return { synced: 0, skipped: 0 };
  }
}


/**
 * 同步关键词绩效数据
 * 从Amazon Reporting API获取关键词级别的绩效数据并更新到keywords表
 */
export async function syncKeywordPerformanceData(service: SyncContext,days: number = 7): Promise<number> {
  const db = await getDb();
  if (!db) {
    log.warn('数据库连接失败');
    return 0;
  }

  try {
    // 使用站点时区计算日期范围
    const { startDate: startDateStr, endDate: endDateStr } = getMarketplaceDateRange(service.marketplace, days);

    log.info(`v196: 开始同步关键词绩效数据: ${startDateStr} - ${endDateStr} (站点: ${service.marketplace})`);

    // v686: 子进度 — 请求报告阶段
    if (service._subProgressCallback) {
      service._subProgressCallback({ phase: '请求报告', current: 1, total: 3, detail: `SP关键词报告 ${startDateStr}~${endDateStr}` });
    }
    
    // v242: 报告请求阶段 - 使用重试包装器
    const reportId = await withRetry(
      () => service.client.requestSpKeywordReport(startDateStr, endDateStr),
      `SP关键词报告请求(account=${service.accountId}, ${startDateStr}~${endDateStr})`,
      2, 5000
    );
    log.info(`v242: 关键词报告请求成功, reportId: ${reportId}`);
    
    // v242: 报告下载阶段 - 使用重试包装器
    const reportData = await withRetry(
      () => service.client.waitAndDownloadReport(reportId, 300000), // v413: 15分钟→5分钟
      `SP关键词报告下载(reportId=${reportId})`,
      1, 10000
    );
    log.info(`v242: 关键词报告下载完成, 数据条数: ${reportData?.length || 0}`);
    
    // v686: 子进度 — 报告下载完成
    if (service._subProgressCallback) {
      service._subProgressCallback({ phase: '处理数据', current: 2, total: 3, detail: `${reportData?.length || 0}条数据待匹配入库` });
    }
    
    if (!reportData || reportData.length === 0) {
      log.warn('v196: 关键词报告数据为空');
      return 0;
    }
    
    log.debug('v196: 关键词报告数据第一条示例:', JSON.stringify(reportData[0], null, 2));
    
    // ==================== v196: 批量预加载本地数据，避免N+1查询 ====================
    // 1. 预加载所有adGroups的Amazon ID -> 本地ID映射
    const allAdGroups = await db.select({ id: adGroups.id, adGroupId: adGroups.adGroupId }).from(adGroups);
    const adGroupAmazonToLocal = new Map<string, number>();
    for (const ag of allAdGroups) {
      if (ag.adGroupId) adGroupAmazonToLocal.set(String(ag.adGroupId), ag.id);
    }
    
    // 2. 预加载所有keywords，建立多维索引
    const allKeywords = await db.select({
      id: keywords.id, keywordId: keywords.keywordId, keywordText: keywords.keywordText,
      matchType: keywords.matchType, adGroupId: keywords.internalAdGroupId
    }).from(keywords);
    
    const kwByKeywordId = new Map<string, typeof allKeywords[0]>();
    // 复合键: adGroupId_keywordText_matchType
    const kwByAdGroupTextMatch = new Map<string, typeof allKeywords[0]>();
    // 复合键: adGroupId_keywordText
    const kwByAdGroupText = new Map<string, typeof allKeywords[0]>();
    // 纯文本键: keywordText (最后兜底)
    const kwByText = new Map<string, typeof allKeywords[0]>();
    
    for (const kw of (allKeywords as unknown[])) {
      if (kw.keywordId) kwByKeywordId.set(kw.keywordId, kw);
      if (kw.internalAdGroupId && kw.keywordText && kw.matchType) {
        kwByAdGroupTextMatch.set(`${kw.internalAdGroupId}_${kw.keywordText.toLowerCase()}_${kw.matchType.toLowerCase()}`, kw);
      }
      if (kw.internalAdGroupId && kw.keywordText) {
        kwByAdGroupText.set(`${kw.internalAdGroupId}_${kw.keywordText.toLowerCase()}`, kw);
      }
      if (kw.keywordText) {
        kwByText.set(kw.keywordText.toLowerCase(), kw);
      }
    }
    
    // 3. 预加载所有product_targets，建立多维索引
    const allTargets = await db.select({
      id: productTargets.id, targetId: productTargets.targetId,
      targetExpression: productTargets.targetExpression, adGroupId: productTargets.internalAdGroupId
    }).from(productTargets);
    
    const ptByTargetId = new Map<string, typeof allTargets[0]>();
    const ptByExpression = new Map<string, typeof allTargets[0]>();
    
    for (const pt of allTargets) {
      if (pt.targetId) ptByTargetId.set(pt.targetId, pt);
      if (pt.targetExpression) ptByExpression.set(pt.targetExpression.toLowerCase(), pt);
    }
    
    log.info(`v196: 预加载完成 - ${allKeywords.length}个关键词, ${allTargets.length}个商品投放, ${allAdGroups.length}个广告组`);
    
    // ==================== v196: 四层匹配策略 ====================
    let synced = 0;
    let notMatched = 0;
    let matchStats = { byKeywordId: 0, byAdGroupTextMatch: 0, byAdGroupText: 0, byText: 0, byTargetId: 0, byExpression: 0 };
    
    // 批量更新缓冲
    const kwUpdates: { id: number; data: Record<string, unknown> }[] = [];
    const ptUpdates: { id: number; data: Record<string, unknown> }[] = [];
    
    for (const row of (reportData as unknown[])) {
      // v242: 字段兼容层 - spTargeting报告API返回keyword/keywordId/targeting，映射到旧字段名
      if (!row.targetId && row.keywordId) row.targetId = row.keywordId;
      if (!row.targetingText && row.keyword) row.targetingText = row.keyword;
      if (!row.targetingExpression && row.targeting) row.targetingExpression = row.targeting;
      
      const reportTargetId = String(row.targetId || row.keywordId || '');
      if (!reportTargetId) continue;
      
      const cost = row.cost || 0;
      const sales = row.sales7d || row.sales14d || 0;
      const orders = row.purchases7d || row.purchases14d || 0;
      const impressions = row.impressions || 0;
      const clicks = row.clicks || 0;
      
      // v733: entity type 校验 - 防止 product_target 数据被错误写入 keyword 表
      // spTargeting 报告中 keyword 和 product_target 混在一起，
      // 通过 targeting 表达式和 keywordType 字段判断真实类型
      const _targetingExpr = String(row.targetingExpression || row.targeting || '').toLowerCase();
      const _keywordTypeVal = String(row.keywordType || '').toUpperCase();
      const _isProductTargetRow = 
        _targetingExpr.startsWith('asin=') ||
        _targetingExpr.startsWith('asin"') ||
        _targetingExpr.startsWith('category=') ||
        _targetingExpr.includes('asin-') ||
        _keywordTypeVal === 'TARGETING';
      
      // 层1: 通过keywordId精确匹配（仅当不是product_target时）
      let kw = _isProductTargetRow ? undefined : kwByKeywordId.get(reportTargetId);
      if (kw) { matchStats.byKeywordId++; }
      
      // 层2: 通过adGroupId + keywordText + matchType三元组匹配（仅当不是product_target时）
      if (!_isProductTargetRow && !kw && row.targetingText && row.adGroupId) {
        const localAgId = adGroupAmazonToLocal.get(String(row.adGroupId));
        if (localAgId) {
          const matchType = row.matchType || row.keywordType || '';
          if (matchType) {
            kw = kwByAdGroupTextMatch.get(`${localAgId}_${row.targetingText.toLowerCase()}_${matchType.toLowerCase()}`);
            if (kw) matchStats.byAdGroupTextMatch++;
          }
          // 层3: 通过adGroupId + keywordText二元组匹配
          if (!kw) {
            kw = kwByAdGroupText.get(`${localAgId}_${row.targetingText.toLowerCase()}`);
            if (kw) matchStats.byAdGroupText++;
          }
        }
      }
      
      // 层4: 通过纯keywordText匹配（兜底，仅当不是product_target时）
      if (!_isProductTargetRow && !kw && row.targetingText) {
        kw = kwByText.get(row.targetingText.toLowerCase());
        if (kw) matchStats.byText++;
      }
      
      if (kw) {
        kwUpdates.push({
          id: kw.id,
          data: {
            impressions, clicks,
            spend: String(cost), sales: String(sales), orders,
            keywordAcos: cost > 0 && sales > 0 ? String(((cost / sales) * 100).toFixed(2)) : null,
            keywordCtr: impressions > 0 ? String((clicks / impressions).toFixed(4)) : null,
            keywordCvr: clicks > 0 ? String((orders / clicks).toFixed(4)) : null,
            keywordCpc: clicks > 0 ? String((cost / clicks).toFixed(2)) : null,
            keywordRoas: cost > 0 && sales > 0 ? String((sales / cost).toFixed(2)) : null,
            updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
          }
        });
        synced++;
        continue;
      }
      
      // 尝试匹配product_targets
      let pt = ptByTargetId.get(reportTargetId);
      if (pt) { matchStats.byTargetId++; }
      
      if (!pt && row.targetingExpression) {
        pt = ptByExpression.get(row.targetingExpression.toLowerCase());
        if (pt) matchStats.byExpression++;
      }
      
      if (pt) {
        ptUpdates.push({
          id: pt.id,
          data: {
            impressions, clicks,
            spend: String(cost), sales: String(sales), orders,
            targetAcos: cost > 0 && sales > 0 ? String(((cost / sales) * 100).toFixed(2)) : null,
            targetRoas: cost > 0 && sales > 0 ? String((sales / cost).toFixed(2)) : null,
            targetCtr: impressions > 0 ? String((clicks / impressions).toFixed(4)) : null,
            targetCvr: clicks > 0 ? String((orders / clicks).toFixed(4)) : null,
            targetCpc: clicks > 0 ? String((cost / clicks).toFixed(2)) : null,
            updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
          }
        });
        synced++;
        continue;
      }
      
      notMatched++;
      if (notMatched <= 5) {
        log.warn(`v196: 未匹配: targetId=${reportTargetId}, text=${row.targetingText || 'N/A'}, expr=${row.targetingExpression || 'N/A'}`);
      }
    }
    
    // ==================== v196: 批量写入数据库 ====================
    let dbWritten = 0;
    for (const upd of kwUpdates) {
      try {
        await db.update(keywords).set(upd.data).where(eq(keywords.id, upd.id));
        dbWritten++;
      } catch (e: unknown) {
        log.warn(`v196: 更新keyword ${upd.id} 失败: ${(e as Error).message}`);
      }
    }
    for (const upd of ptUpdates) {
      try {
        await db.update(productTargets).set(upd.data).where(eq(productTargets.id, upd.id));
        dbWritten++;
      } catch (e: unknown) {
        log.warn(`v196: 更新product_target ${upd.id} 失败: ${(e as Error).message}`);
      }
    }
    
    log.info(`v196: 关键词绩效同步完成 - 匹配${synced}条, 未匹配${notMatched}条, 写入${dbWritten}条`);
    log.debug(`v196: 匹配统计 - keywordId:${matchStats.byKeywordId}, adGroup+text+match:${matchStats.byAdGroupTextMatch}, adGroup+text:${matchStats.byAdGroupText}, text:${matchStats.byText}, targetId:${matchStats.byTargetId}, expression:${matchStats.byExpression}`);
    
    // v196+v647: 同步时顺便回填keywordId（如果通过文本匹配到了但keywordId不一致）
    // v647: 只允许纯数字ID回填，防止text:前缀表达式或ASIN表达式污染keywordId字段
    let backfilled = 0;
    let backfillSkipped = 0;
    for (const row of (reportData as unknown[])) {
      const reportTargetId = String(row.targetId || row.keywordId || '');
      if (!reportTargetId || !row.targetingText) continue;
      
      // v647: 严格验证 - 只有纯数字的reportTargetId才能回填到keywordId
      // 防止text:前缀关键词表达式（如"text:+ski +jumpsuit"）和ASIN表达式（如"asin=B0FM8LDVTD"）污染keywordId
      if (!/^\d+$/.test(reportTargetId.trim())) {
        backfillSkipped++;
        if (backfillSkipped <= 3) {
          log.info(`[v647] 跳过非数字keywordId回填: reportTargetId="${reportTargetId.substring(0, 60)}", text="${(row.targetingText || '').substring(0, 40)}"`);
        }
        continue;
      }
      
      // 检查是否有通过文本匹配到的keyword缺少keywordId
      const kw = kwByText.get(row.targetingText.toLowerCase());
      if (kw && (!kw.keywordId || kw.keywordId.startsWith('SKIP_'))) {
        try {
          await db.update(keywords).set({ keywordId: reportTargetId }).where(eq(keywords.id, kw.id));
          backfilled++;
        } catch (e: unknown) {
          // 忽略重复键错误
        }
      }
    }
    if (backfilled > 0) {
      log.debug(`v647: 回填了${backfilled}个关键词的keywordId`);
    }
    if (backfillSkipped > 0) {
      log.info(`[v647] 回填时跳过了${backfillSkipped}个非数字reportTargetId，防止keywordId字段污染`);
    }
    
    return synced;
  } catch (error: unknown) {
    log.warn(`[v242] 关键词绩效同步失败(account=${service.accountId}, marketplace=${service.marketplace}): ${serializeError(error)}`);
    return 0;
  }
}


