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
} from '../../drizzle/schema';
import { createModuleLogger } from '../utils/logger';
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
    const info: Record<string, any> = {
      message: (error as Error).message || 'Unknown error',
      code: (error as any).code,
      status: error.status || (error as any).response?.status,
      statusText: (error as any).response?.statusText,
      url: error.config?.url,
      method: error.config?.method,
      retryCount: error.retryCount,
    };
    // 记录API响应体（截断到500字符避免日志爆炸）
    if (error.response?.data) {
      const dataStr = typeof (error as any).response.data === 'string' 
        ? (error as any).response.data 
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
        log.error(`[v242] ${operationName} 最终失败(尝试${attempt}次): ${serializeError(error)}`);
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
        accountId: service.accountId,
        campaignId: adGroup.campaignId,
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

    log.info(`SB关键词同步完成: synced=${synced}, skipped=${skipped}`);
    return { synced, skipped };
  } catch (error: unknown) {
    log.error(`[v242] SB关键词同步失败(account=${service.accountId}, marketplace=${service.marketplace}): ${serializeError(error)}`);
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

    // v150.1: 批量预查询所有需要保护的关键词ID（减少循环内DB查询）
    const allExistingKeywordIds: number[] = [];
    for (const ak of apiKeywords) {
      const [ag] = await db.select({ id: adGroups.id }).from(adGroups)
        .where(eq(adGroups.adGroupId, String(ak.adGroupId))).limit(1);
      if (!ag) continue;
      const [ex] = await db.select({ id: keywords.id }).from(keywords)
        .where(and(eq(keywords.adGroupId, ag.id), eq(keywords.keywordId, String(ak.keywordId)))).limit(1);
      if (ex) allExistingKeywordIds.push(ex.id);
    }
    const protectedKeywordIds = await getRecentlyOptimizedKeywordIds(allExistingKeywordIds, SYNC_PROTECTION_CONFIG.BID_PROTECTION_HOURS);
    const protectionStats = createSyncProtectionStats();
    log.info(`syncSpKeywords: 批量查询完成, ${protectedKeywordIds.size}个关键词有近期出价优化事件`);

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
      // v215修复: 移除错误的updatedAt跳过逻辑
      // 始终使用Amazon API返回的最新数据更新本地记录

      const keywordData: Record<string, any> = {
        adGroupId: adGroup.id,
        accountId: service.accountId,
        campaignId: adGroup.campaignId,
        keywordId: String(apiKeyword.keywordId),
        keywordText: apiKeyword.keywordText,
        matchType: apiKeyword.matchType as 'broad' | 'phrase' | 'exact',
        keywordStatus: apiKeyword.state as 'enabled' | 'paused' | 'archived',  // v311: 修复字段名 status → keywordStatus，与Drizzle schema一致
        bid: String(apiKeyword.bid),
        updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      };

      if (existing) {
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
    return { synced, skipped };
  } catch (error: unknown) {
    log.error(`[v242] SP关键词同步失败(account=${service.accountId}, marketplace=${service.marketplace}): ${serializeError(error)}`);
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
    log.error('数据库连接失败');
    return 0;
  }

  try {
    // 使用站点时区计算日期范围
    const { startDate: startDateStr, endDate: endDateStr } = getMarketplaceDateRange(service.marketplace, days);

    log.info(`v196: 开始同步关键词绩效数据: ${startDateStr} - ${endDateStr} (站点: ${service.marketplace})`);

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
      matchType: keywords.matchType, adGroupId: keywords.adGroupId
    }).from(keywords);
    
    const kwByKeywordId = new Map<string, typeof allKeywords[0]>();
    // 复合键: adGroupId_keywordText_matchType
    const kwByAdGroupTextMatch = new Map<string, typeof allKeywords[0]>();
    // 复合键: adGroupId_keywordText
    const kwByAdGroupText = new Map<string, typeof allKeywords[0]>();
    // 纯文本键: keywordText (最后兜底)
    const kwByText = new Map<string, typeof allKeywords[0]>();
    
    for (const kw of (allKeywords as any[])) {
      if (kw.keywordId) kwByKeywordId.set(kw.keywordId, kw);
      if (kw.adGroupId && kw.keywordText && kw.matchType) {
        kwByAdGroupTextMatch.set(`${kw.adGroupId}_${kw.keywordText.toLowerCase()}_${kw.matchType.toLowerCase()}`, kw);
      }
      if (kw.adGroupId && kw.keywordText) {
        kwByAdGroupText.set(`${kw.adGroupId}_${kw.keywordText.toLowerCase()}`, kw);
      }
      if (kw.keywordText) {
        kwByText.set(kw.keywordText.toLowerCase(), kw);
      }
    }
    
    // 3. 预加载所有product_targets，建立多维索引
    const allTargets = await db.select({
      id: productTargets.id, targetId: productTargets.targetId,
      targetExpression: productTargets.targetExpression, adGroupId: productTargets.adGroupId
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
    const kwUpdates: { id: number; data: Record<string, any> }[] = [];
    const ptUpdates: { id: number; data: Record<string, any> }[] = [];
    
    for (const row of (reportData as any[])) {
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
      
      // 层1: 通过keywordId精确匹配
      let kw = kwByKeywordId.get(reportTargetId);
      if (kw) { matchStats.byKeywordId++; }
      
      // 层2: 通过adGroupId + keywordText + matchType三元组匹配
      if (!kw && row.targetingText && row.adGroupId) {
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
      
      // 层4: 通过纯keywordText匹配（兜底）
      if (!kw && row.targetingText) {
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
        log.error(`v196: 更新keyword ${upd.id} 失败: ${(e as Error).message}`);
      }
    }
    for (const upd of ptUpdates) {
      try {
        await db.update(productTargets).set(upd.data).where(eq(productTargets.id, upd.id));
        dbWritten++;
      } catch (e: unknown) {
        log.error(`v196: 更新product_target ${upd.id} 失败: ${(e as Error).message}`);
      }
    }
    
    log.info(`v196: 关键词绩效同步完成 - 匹配${synced}条, 未匹配${notMatched}条, 写入${dbWritten}条`);
    log.debug(`v196: 匹配统计 - keywordId:${matchStats.byKeywordId}, adGroup+text+match:${matchStats.byAdGroupTextMatch}, adGroup+text:${matchStats.byAdGroupText}, text:${matchStats.byText}, targetId:${matchStats.byTargetId}, expression:${matchStats.byExpression}`);
    
    // v196: 同步时顺便回填keywordId（如果通过文本匹配到了但keywordId不一致）
    let backfilled = 0;
    for (const row of (reportData as any[])) {
      const reportTargetId = String(row.targetId || row.keywordId || '');
      if (!reportTargetId || !row.targetingText) continue;
      
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
      log.debug(`v196: 回填了${backfilled}个关键词的keywordId`);
    }
    
    return synced;
  } catch (error: unknown) {
    log.error(`[v242] 关键词绩效同步失败(account=${service.accountId}, marketplace=${service.marketplace}): ${serializeError(error)}`);
    return 0;
  }
}


