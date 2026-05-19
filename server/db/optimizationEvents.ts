/**
 * v361: 优化事件管理
 * 从db.ts拆分的子模块
 */

import { and, count, desc, eq, gte, lte, not, sql } from 'drizzle-orm';
import { InsertOptimizationEvent, InsertOptimizationLog, OptimizationEvent, OptimizationLog, bidAdjustmentHistory, biddingLogs, optimizationEvents, optimizationLogs } from '../../drizzle/schema';
import { getDb } from './connection';
import { createModuleLogger } from '../utils/logger';
import { guardCampaignIdInsert } from '../utils/idTypes';
import { getAdAccounts, getPerformanceGroupsByAccountId } from './accounts';

const log = createModuleLogger('DB:optimizationEvents');

const EVENT_CATEGORIES_REQUIRING_CAMPAIGN = new Set([
  'bid_adjustment',
  'placement_adjustment',
  'budget_adjustment',
  'search_term_action',
  'keyword_action',
  'campaign_action',
  'adgroup_action',
  'target_management',
]);

function toPositiveNumber(value: unknown): number | undefined {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : undefined;
}

// ==================== 优化日志函数 ====================

/**
 * 创建优化日志
 */
export async function createOptimizationLog(data: InsertOptimizationLog): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(optimizationLogs).values(data);
  const logId = Number(result[0].insertId);
  
  // v145+v212: 双写到统一优化事件表
  // v212修复: 1) categoryMap键名与实际log_category值对齐
  //          2) 从action_detail JSON中提取keywordId/previousBid/newBid
  //          3) 增强错误日志
  try {
    const categoryMap: Record<string, string> = {
      // v212: 修正映射 - 键名必须与optimization_logs.log_category实际值一致
      'bid_adjustment': 'bid_adjustment',
      'placement_adjustment': 'placement_adjustment',
      'budget_adjustment': 'budget_adjustment',
      'optimization_settings': 'settings_change',
      // 保留旧映射以兼容可能的历史数据
      'bid_optimization': 'bid_adjustment',
      'placement_optimization': 'placement_adjustment',
      'budget_optimization': 'budget_adjustment',
      'search_term_optimization': 'search_term_action',
      'keyword_management': 'keyword_action',
      'campaign_management': 'campaign_action',
      'target_management': 'target_management',
      'settings': 'settings_change',
    };
    const actionTypeMap: Record<string, string> = {
      'bid_increase': 'bid_increase', 'bid_decrease': 'bid_decrease', 'bid_set': 'bid_set',
      'bid_auto_adjust': 'bid_auto_adjust', 'dayparting_bid': 'dayparting_bid',
      'budget_increase': 'budget_increase', 'budget_decrease': 'budget_decrease',
      'budget_set': 'budget_set', 'budget_adjustment': 'budget_adjustment',
      'placement_adjust': 'placement_adjust',
      'search_term_harvest': 'search_term_harvest', 'negative_keyword_add': 'negative_keyword_add',
      'negative_keyword_remove': 'negative_keyword_remove', 'keyword_create': 'keyword_create',
      'target_pause': 'target_pause', 'target_enable': 'target_enable',
      'campaign_pause': 'campaign_pause', 'campaign_enable': 'campaign_enable',
      'create_target': 'create_target', 'update_target': 'update_target',
      'delete_target': 'delete_target', 'pause_target': 'pause_target', 'resume_target': 'resume_target',
      'add_campaign': 'add_campaign', 'remove_campaign': 'remove_campaign',
      'settings_update': 'settings_update', 'strategy_change': 'strategy_change',
    };
    
    // v212: 从action_detail JSON中提取关键字段（optimization_logs表没有这些列）
    let extractedKeywordId: number | undefined;
    let extractedKeywordText: string | undefined;
    let extractedPreviousBid: string | undefined;
    let extractedNewBid: string | undefined;
    let extractedBidChangePercent: string | undefined;
    let extractedApiSyncStatus: string | undefined;
    let extractedApiSyncDetail: string | undefined;
    let extractedInternalAdGroupId: number | undefined;
    let extractedAdGroupName: string | undefined;
    let extractedMatchType: string | undefined;
    let extractedTargetId: string | undefined;
    let extractedTargetName: string | undefined;
    
    if (data.actionDetail) {
      try {
        const detail = typeof data.actionDetail === 'string' ? JSON.parse(data.actionDetail) : data.actionDetail;
        extractedKeywordId = detail.keywordId ? Number(detail.keywordId) : undefined;
        extractedKeywordText = detail.keywordText || undefined;
        extractedPreviousBid = detail.currentBid != null ? String(detail.currentBid) : undefined;
        extractedNewBid = detail.newBid != null ? String(detail.newBid) : undefined;
        extractedBidChangePercent = detail.changePercent != null ? String(detail.changePercent) : undefined;
        extractedApiSyncStatus = detail.apiSyncStatus || undefined;
        extractedApiSyncDetail = detail.apiSyncDetail || undefined;
        extractedInternalAdGroupId = toPositiveNumber(detail.internalAdGroupId || detail.adGroupId);
        extractedAdGroupName = detail.adGroupName || undefined;
        extractedMatchType = detail.matchType || undefined;
        extractedTargetId = detail.targetId != null ? String(detail.targetId) : (detail.productTargetId != null ? String(detail.productTargetId) : undefined);
        extractedTargetName = detail.targetName || detail.targetText || detail.targetValue || undefined;
      } catch (parseErr: any) {
        // action_detail可能不是有效JSON，忽略解析错误
      }
    }
    
    const resolvedCategory = categoryMap[data.logCategory || ''] || 'settings_change';
    const resolvedActionType = actionTypeMap[data.actionType || ''] || 'settings_update';
    
    // v212: 使用提取的apiSyncStatus（优先级：action_detail > data字段）
    const finalApiSyncStatus = extractedApiSyncStatus || data.apiSyncStatus || 'pending';
    const finalApiSyncDetail = extractedApiSyncDetail || data.apiSyncDetail;
    const eventPerformanceGroupId = toPositiveNumber((data as Record<string, unknown>).performanceGroupId);
    const eventAccountId = toPositiveNumber(data.accountId);
    const eventCampaignId = data.campaignId ? guardCampaignIdInsert(data.campaignId, 'optimization_events') : null;

    if (!eventAccountId || !eventPerformanceGroupId) {
      throw new Error(`optimization_events缺少必要范围字段: accountId=${data.accountId || 'N/A'}, performanceGroupId=${String((data as Record<string, unknown>).performanceGroupId || 'N/A')}`);
    }
    if (EVENT_CATEGORIES_REQUIRING_CAMPAIGN.has(resolvedCategory) && !eventCampaignId) {
      throw new Error(`optimization_events缺少campaignId: category=${resolvedCategory}, actionType=${resolvedActionType}`);
    }
    
    // v333: 今action_detail中提取apiResponseId
    let extractedApiResponseId: string | undefined;
    if (data.actionDetail) {
      try {
        const detailObj = typeof data.actionDetail === 'string' ? JSON.parse(data.actionDetail) : data.actionDetail;
        extractedApiResponseId = detailObj.apiResponseId || undefined;
      } catch { /* ignore */ }
    }
    
    const optimizationEventPayload = {
      performanceGroupId: eventPerformanceGroupId,
      performanceGroupName: data.performanceGroupName,
      accountId: eventAccountId,
      accountName: data.accountName,
      userId: data.userId,
      userName: data.userName,
      eventCategory: resolvedCategory as unknown,
      actionType: resolvedActionType as unknown,
      strategyTemplateId: data.strategyTemplateId,
      strategyTemplateName: data.strategyTemplateName,
      campaignId: eventCampaignId,
      campaignName: data.campaignName,
      internalAdGroupId: extractedInternalAdGroupId,
      adGroupName: extractedAdGroupName,
      // v212: 从 action_detail中提取的关键字段
      keywordId: extractedKeywordId,
      keywordText: extractedKeywordText,
      matchType: extractedMatchType,
      targetId: extractedTargetId,
      targetName: extractedTargetName,
      previousBid: extractedPreviousBid,
      newBid: extractedNewBid,
      bidChangePercent: extractedBidChangePercent,
      previousValue: data.previousValue,
      newValue: data.newValue,
      changeReason: data.changeReason,
      actionDetail: data.actionDetail,
      status: (data.status as string) || 'success',
      apiSyncStatus: (finalApiSyncStatus === 'partial' ? 'synced' : finalApiSyncStatus) as unknown,
      apiSyncDetail: finalApiSyncDetail,
      // v333: 传递apiResponseId和apiSyncedAt到optimization_events表
      apiResponseId: extractedApiResponseId || (data as Record<string, unknown>).apiResponseId as string || null,
      apiSyncedAt: (data as Record<string, unknown>).apiSyncedAt as string || (finalApiSyncStatus === 'synced' ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null),
      errorMessage: data.errorMessage,
      sourceTable: 'optimization_logs',
      sourceId: logId,
      executedAt: data.executedAt,
      // v258: 写入结构化归因和护栏信息
      reasonDetails: (data as Record<string, unknown>).reasonDetails as string || undefined,
      guardrailInfo: (data as Record<string, unknown>).guardrailInfo as string || undefined,
      relatedEventId: (data as Record<string, unknown>).relatedEventId as number || undefined,
      // v274: 写入算法决策元数据（预算分池、因果推断、GTO修正等）
      performanceData: (() => {
        try {
          if (!data.actionDetail) return undefined;
          const detail = typeof data.actionDetail === 'string' ? JSON.parse(data.actionDetail) : data.actionDetail;
          const meta: Record<string, unknown> = {};
          if (detail.gtoModifier) {
            meta.gto = {
              composite: detail.gtoModifier.compositeModifier,
              budgetPool: detail.gtoModifier.decisions?.budget?.pool,
              budgetModifier: detail.gtoModifier.decisions?.budget?.budgetModifier,
              isFrozen: detail.gtoModifier.decisions?.budget?.isFrozen,
              keywordRole: detail.gtoModifier.decisions?.portfolio?.role,
              competitorType: detail.gtoModifier.decisions?.competition?.dominantCompetitorType,
            };
          }
          if (detail.causalAdjustment) {
            meta.causal = detail.causalAdjustment;
          }
          // v337: 提取修正层标记
          if (detail.correctionLayers) {
            meta.correctionLayers = detail.correctionLayers;
          }
          // v337: 提取Meta-Learning决策详情
          if (detail.metaLearningDetail) {
            meta.metaLearning = {
              candidateAlgorithms: detail.metaLearningDetail.candidateAlgorithms,
              selectedAlgorithm: detail.metaLearningDetail.selectedAlgorithm,
              selectionReason: detail.metaLearningDetail.selectionReason,
              fusionMode: detail.metaLearningDetail.fusionMode,
              fusionDetail: detail.metaLearningDetail.fusionDetail,
            };
          }
          if (detail.algorithmTier) meta.algorithmTier = detail.algorithmTier;
          if (detail.algorithmUsed) meta.algorithmUsed = detail.algorithmUsed;
          return Object.keys(meta).length > 0 ? JSON.stringify(meta) : undefined;
        } catch { return undefined; }
      })(),
    } as InsertOptimizationEvent;

    await db.insert(optimizationEvents).values(optimizationEventPayload);
    log.info(`[v274] 双写optimization_events成功: logId=${logId}, category=${resolvedCategory}, keywordId=${extractedKeywordId || 'N/A'}, apiSyncStatus=${finalApiSyncStatus}`);
  } catch (e: any) {
    log.warn('[v212] 双写optimization_events失败:', (e instanceof Error ? (e as Error).message : String(e)) || e);
    log.warn(`[v212] 双写失败详情: logCategory=${data.logCategory} actionType=${data.actionType}`);
  }
  
  return logId;
}

/**
 * 获取优化日志列表
 */

/**
 * 获取优化日志列表
 */
export async function getOptimizationLogs(params: {
  performanceGroupId: number;
  category?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  pageSize?: number;
}): Promise<{ logs: OptimizationLog[]; total: number; page: number; pageSize: number }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const { performanceGroupId, category = 'all', startDate, endDate, page = 1, pageSize = 50 } = params;
  const offset = (page - 1) * pageSize;
  
  // 构建查询条件
  let conditions = [eq(optimizationLogs.performanceGroupId, performanceGroupId)];
  
  if (category && category !== 'all') {
    // @ts-ignore - category is dynamically typed from user input
    conditions.push(eq(optimizationLogs.logCategory, category));
  }
  
  if (startDate) {
    conditions.push(gte(optimizationLogs.createdAt, startDate));
  }
  
  if (endDate) {
    conditions.push(lte(optimizationLogs.createdAt, endDate));
  }
  
  // 获取总数
  const countResult = await db.select({ count: sql<number>`count(*)` })
    .from(optimizationLogs)
    .where(and(...conditions));
  const total = countResult[0]?.count || 0;
  
  // 获取日志列表
  const logs = await db.select()
    .from(optimizationLogs)
    .where(and(...conditions))
    .orderBy(desc(optimizationLogs.createdAt))
    .limit(pageSize)
    .offset(offset);
  
  return { logs, total, page, pageSize };
}

/**
 * 获取优化日志统计信息
 */

/**
 * 获取优化日志统计信息
 */
export async function getOptimizationLogStats(performanceGroupId: number, days: number = 30): Promise<{
  totalLogs: number;
  byCategory: { category: string; count: number }[];
  byActionType: { actionType: string; count: number }[];
  recentActivity: { date: string; count: number }[];
}> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const startDateStr = startDate.toISOString().slice(0, 19).replace('T', ' ');
  
  // 总日志数
  const totalResult = await db.select({ count: sql<number>`count(*)` })
    .from(optimizationLogs)
    .where(and(
      eq(optimizationLogs.performanceGroupId, performanceGroupId),
      gte(optimizationLogs.createdAt, startDateStr)
    ));
  const totalLogs = totalResult[0]?.count || 0;
  
  // 按分类统计
  const byCategoryResult = await db.select({
    category: optimizationLogs.logCategory,
    count: sql<number>`count(*)`
  })
    .from(optimizationLogs)
    .where(and(
      eq(optimizationLogs.performanceGroupId, performanceGroupId),
      gte(optimizationLogs.createdAt, startDateStr)
    ))
    .groupBy(optimizationLogs.logCategory);
  
  // 按操作类型统计
  const byActionTypeResult = await db.select({
    actionType: optimizationLogs.actionType,
    count: sql<number>`count(*)`
  })
    .from(optimizationLogs)
    .where(and(
      eq(optimizationLogs.performanceGroupId, performanceGroupId),
      gte(optimizationLogs.createdAt, startDateStr)
    ))
    .groupBy(optimizationLogs.actionType);
  
  // 最近活动趋势（按天）
  const recentActivityResult = await db.select({
    date: sql<string>`DATE(created_at)`,
    count: sql<number>`count(*)`
  })
    .from(optimizationLogs)
    .where(and(
      eq(optimizationLogs.performanceGroupId, performanceGroupId),
      gte(optimizationLogs.createdAt, startDateStr)
    ))
    .groupBy(sql`DATE(created_at)`)
    .orderBy(sql`DATE(created_at)`);
  
  return {
    totalLogs,
    byCategory: byCategoryResult.map(r => ({ category: r.category, count: r.count })),
    byActionType: byActionTypeResult.map(r => ({ actionType: r.actionType, count: r.count })),
    recentActivity: recentActivityResult.map(r => ({ date: r.date, count: r.count }))
  };
}

/**
 * 批量创建优化日志
 */

/**
 * 批量创建优化日志
 */
export async function batchCreateOptimizationLogs(logs: InsertOptimizationLog[]): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  if (logs.length === 0) return 0;
  
  await db.insert(optimizationLogs).values(logs);
  return logs.length;
}


// ============================================================
// 统一优化事件表 (optimization_events) CRUD 函数
// ============================================================

/**
 * 插入单条优化事件
 * v222: 自动验证并解析 campaignId
 */

// ============================================================
// 统一优化事件表 (optimization_events) CRUD 函数
// ============================================================

/**
 * 插入单条优化事件
 * v222: 自动验证并解析 campaignId
 */
export async function insertOptimizationEvent(event: InsertOptimizationEvent): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // v222: campaignId 安全守卫
  if (event.campaignId != null) {
    const { quickValidateCampaignId } = await import('../utils/campaignIdResolver');
    (event as Record<string, unknown>).campaignId = quickValidateCampaignId(String(event.campaignId), 'insertOptimizationEvent');
  }
  
  const result = await db.insert(optimizationEvents).values(event);
  return result[0].insertId;
}

/**
 * 批量插入优化事件
 * v222: 自动验证并解析 campaignId
 */

/**
 * 批量插入优化事件
 * v222: 自动验证并解析 campaignId
 */
export async function batchInsertOptimizationEvents(events: InsertOptimizationEvent[]): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (events.length === 0) return 0;
  
  // v222: 批量 campaignId 安全守卫
  const { quickValidateCampaignId } = await import('../utils/campaignIdResolver');
  for (const event of events) {
    if (event.campaignId != null) {
      (event as Record<string, unknown>).campaignId = quickValidateCampaignId(String(event.campaignId), 'batchInsertOptimizationEvents');
    }
  }
  
  await db.insert(optimizationEvents).values(events);
  return events.length;
}

/**
 * 查询优化事件 - 统一查询接口，支持多维度过滤
 */

/**
 * 查询优化事件 - 统一查询接口，支持多维度过滤
 */
export async function getOptimizationEvents(params: {
  performanceGroupId?: number;
  accountId?: number;
  eventCategory?: string;
  actionType?: string;
  status?: string;
  campaignId?: number;
  keywordId?: number;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}): Promise<{ events: OptimizationEvent[]; total: number }> {
  const db = await getDb();
  if (!db) return { events: [], total: 0 };
  
  const conditions = [];
  if (params.performanceGroupId) conditions.push(eq(optimizationEvents.performanceGroupId, params.performanceGroupId));
  if (params.accountId) conditions.push(eq(optimizationEvents.accountId, params.accountId));
  if (params.eventCategory) conditions.push(sql`${optimizationEvents.eventCategory} = ${params.eventCategory}`);
  if (params.actionType) conditions.push(sql`${optimizationEvents.actionType} = ${params.actionType}`);
  if (params.status) conditions.push(sql`${optimizationEvents.status} = ${params.status}`);
  // @ts-ignore Conditional type narrowing
  if (params.campaignId) conditions.push(eq(optimizationEvents.campaignId, params.campaignId));
  // @ts-ignore Conditional type narrowing
  if (params.keywordId) conditions.push(eq(optimizationEvents.keywordId, params.keywordId));
  if (params.startDate) conditions.push(gte(optimizationEvents.createdAt, params.startDate));
  if (params.endDate) conditions.push(lte(optimizationEvents.createdAt, params.endDate));
  
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  
  const [events, countResult] = await Promise.all([
    db.select()
      .from(optimizationEvents)
      .where(whereClause)
      .orderBy(desc(optimizationEvents.createdAt))
      .limit(params.limit || 50)
      .offset(params.offset || 0),
    db.select({ count: sql<number>`count(*)` })
      .from(optimizationEvents)
      .where(whereClause)
  ]);
  
  return { events, total: countResult[0]?.count || 0 };
}

/**
 * 获取优化事件统计 - 按事件类别和状态汇总
 */

/**
 * 获取优化事件统计 - 按事件类别和状态汇总
 */
export async function getOptimizationEventStats(params: {
  performanceGroupId?: number;
  accountId?: number;
  days?: number;
}): Promise<{
  totalEvents: number;
  byCategory: { category: string; count: number }[];
  byStatus: { status: string; count: number }[];
  successRate: number;
  recentTrend: { date: string; count: number }[];
}> {
  const db = await getDb();
  if (!db) return { totalEvents: 0, byCategory: [], byStatus: [], successRate: 0, recentTrend: [] };
  
  const days = params.days || 30;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const startDateStr = startDate.toISOString().slice(0, 19).replace('T', ' ');
  
  const conditions = [gte(optimizationEvents.createdAt, startDateStr)];
  if (params.performanceGroupId) conditions.push(eq(optimizationEvents.performanceGroupId, params.performanceGroupId));
  if (params.accountId) conditions.push(eq(optimizationEvents.accountId, params.accountId));
  
  const whereClause = and(...conditions);
  
  const [totalResult, byCategoryResult, byStatusResult, trendResult] = await Promise.all([
    db.select({ count: sql<number>`count(*)` })
      .from(optimizationEvents).where(whereClause),
    db.select({
      category: optimizationEvents.eventCategory,
      count: sql<number>`count(*)`
    }).from(optimizationEvents).where(whereClause)
      .groupBy(optimizationEvents.eventCategory),
    db.select({
      status: optimizationEvents.status,
      count: sql<number>`count(*)`
    }).from(optimizationEvents).where(whereClause)
      .groupBy(optimizationEvents.status),
    db.select({
      date: sql<string>`DATE(created_at)`,
      count: sql<number>`count(*)`
    }).from(optimizationEvents).where(whereClause)
      .groupBy(sql`DATE(created_at)`)
      .orderBy(sql`DATE(created_at)`)
  ]);
  
  const totalEvents = totalResult[0]?.count || 0;
  const successCount = byStatusResult.find(r => r.status === 'success')?.count || 0;
  const failedCount = byStatusResult.find(r => r.status === 'failed')?.count || 0;
  const executedCount = successCount + failedCount;
  
  return {
    totalEvents,
    byCategory: byCategoryResult.map(r => ({ category: r.category || '', count: r.count })),
    byStatus: byStatusResult.map(r => ({ status: r.status || '', count: r.count })),
    successRate: executedCount > 0 ? Math.round((successCount / executedCount) * 100) : 0,
    recentTrend: trendResult.map(r => ({ date: r.date, count: r.count }))
  };
}

/**
 * 获取出价调整事件（含效果追踪数据）
 */

/**
 * 获取出价调整事件（含效果追踪数据）
 */
export async function getBidAdjustmentEvents(params: {
  performanceGroupId?: number;
  accountId?: number;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}): Promise<{ events: OptimizationEvent[]; total: number }> {
  return getOptimizationEvents({
    ...params,
    eventCategory: 'bid_adjustment',
  });
}

/**
 * 回滚优化事件
 */

/**
 * 回滚优化事件
 */
export async function rollbackOptimizationEvent(eventId: number, rolledBackBy: string): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.update(optimizationEvents)
    .set({
      status: 'rolled_back',
      rolledBackAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      rolledBackBy,
    })
    .where(eq(optimizationEvents.id, eventId));
  
  return true;
}

/**
 * 更新优化事件的效果追踪数据
 */

/**
 * 更新优化事件的效果追踪数据
 */
export async function updateOptimizationEventTracking(eventId: number, trackingData: {
  actualProfit7D?: string;
  actualProfit14D?: string;
  actualProfit30D?: string;
  actualImpressions7D?: number;
  actualClicks7D?: number;
  actualConversions7D?: number;
  actualSpend7D?: string;
  actualRevenue7D?: string;
}): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(optimizationEvents)
    .set({
      ...trackingData,
      trackingUpdatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
    })
    .where(eq(optimizationEvents.id, eventId));
}

/**
 * 数据迁移辅助函数 - 从旧表迁移到optimization_events
 * 用于一次性数据迁移，迁移完成后可删除
 */

/**
 * 数据迁移辅助函数 - 从旧表迁移到optimization_events
 * 用于一次性数据迁移，迁移完成后可删除
 */
export async function migrateFromBiddingLogs(accountId: number): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const oldLogs = await db.select().from(biddingLogs)
    .where(eq(biddingLogs.accountId, accountId))
    .orderBy(desc(biddingLogs.createdAt));
  
  if (oldLogs.length === 0) return 0;
  
  const events = oldLogs.map((log) => ({
    accountId: (log as Record<string, unknown>).accountId as number,
    eventCategory: 'bid_adjustment' as const,
    actionType: (log as Record<string, unknown>).actionType === 'increase' ? 'bid_increase' as const : 
                (log as Record<string, unknown>).actionType === 'decrease' ? 'bid_decrease' as const : 'bid_set' as const,
    campaignId: log.campaignId,
    internalAdGroupId: log.internalAdGroupId,
    keywordId: log.targetId,
    targetName: log.targetName,
    previousBid: log.previousBid,
    newBid: log.newBid,
    bidChangePercent: log.bidChangePercent,
    changeReason: log.reason,
    status: log.executionStatus === 'success' ? 'success' as const : 
            log.executionStatus === 'failed' ? 'failed' as const : 'pending' as const,
    // v648: bid_set事件标记为not_applicable，避免积压
    apiSyncStatus: ((log as Record<string, unknown>).actionType !== 'increase' && (log as Record<string, unknown>).actionType !== 'decrease')
                   ? 'not_applicable' as const
                   : log.executionStatus === 'success' ? 'synced' as const :
                     log.executionStatus === 'failed' ? 'failed' as const : 'pending' as const,
    apiResponseId: log.apiResponseId,
    errorMessage: log.errorMessage,
    sourceTable: 'bidding_logs',
    sourceId: log.id,
    createdAt: log.createdAt,
  } as Record<string, unknown>));
  
  // @ts-ignore - events mapped from legacy biddingLogs schema
  await db.insert(optimizationEvents).values(events);
  return events.length;
}

export async function migrateFromBidAdjustmentHistory(accountId: number): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const oldRecords = await db.select().from(bidAdjustmentHistory)
    .where(eq(bidAdjustmentHistory.accountId, accountId))
    .orderBy(desc(bidAdjustmentHistory.appliedAt));
  
  if (oldRecords.length === 0) return 0;
  
  const events = oldRecords.map(record => ({
    performanceGroupId: record.performanceGroupId,
    accountId: record.accountId,
    eventCategory: 'bid_adjustment' as const,
    actionType: record.adjustmentType?.includes('increase') ? 'bid_increase' as const :
                record.adjustmentType?.includes('decrease') ? 'bid_decrease' as const : 'bid_auto_adjust' as const,
    campaignId: record.campaignId,
    keywordId: record.keywordId,
    keywordText: record.keywordText,
    matchType: record.matchType,
    previousBid: record.previousBid,
    newBid: record.newBid,
    changeReason: record.adjustmentReason,
    adjustmentType: record.adjustmentType,
    status: record.status === 'applied' ? 'success' as const :
            record.status === 'rolled_back' ? 'rolled_back' as const :
            record.status === 'failed' ? 'failed' as const : 'pending' as const,
    apiSyncStatus: record.status === 'applied' ? 'synced' as const :
                   record.status === 'rolled_back' ? 'rolled_back' as const :
                   record.status === 'failed' ? 'failed' as const : 'pending' as const,
    expectedProfitIncrease: record.expectedProfitIncrease,
    actualProfit7D: record.actualProfit7D,
    actualProfit14D: record.actualProfit14D,
    actualProfit30D: record.actualProfit30D,
    actualImpressions7D: record.actualImpressions7D,
    actualClicks7D: record.actualClicks7D,
    actualConversions7D: record.actualConversions7D,
    actualSpend7D: record.actualSpend7D,
    actualRevenue7D: record.actualRevenue7D,
    trackingUpdatedAt: record.trackingUpdatedAt,
    rolledBackAt: record.rolledBackAt,
    rolledBackBy: record.rolledBackBy,
    sourceTable: 'bid_adjustment_history',
    sourceId: record.id,
    createdAt: record.appliedAt,
  }));
  
  await db.insert(optimizationEvents).values(events as InsertOptimizationEvent[]);
  return events.length;
}

export async function migrateFromOptimizationLogs(performanceGroupId: number): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const oldLogs = await db.select().from(optimizationLogs)
    .where(eq(optimizationLogs.performanceGroupId, performanceGroupId))
    .orderBy(desc(optimizationLogs.createdAt));
  
  if (oldLogs.length === 0) return 0;
  
  // 映射logCategory到eventCategory
  const categoryMap: Record<string, string> = {
    'bid_optimization': 'bid_adjustment',
    'placement_optimization': 'placement_adjustment',
    'budget_optimization': 'budget_adjustment',
    'search_term_optimization': 'search_term_action',
    'keyword_management': 'keyword_action',
    'campaign_management': 'campaign_action',
    'target_management': 'target_management',
    'settings': 'settings_change',
  };
  
  // 映射actionType
  const actionTypeMap: Record<string, string> = {
    'bid_increase': 'bid_increase',
    'bid_decrease': 'bid_decrease',
    'bid_set': 'bid_set',
    'bid_auto_adjust': 'bid_auto_adjust',
    'dayparting_bid': 'dayparting_bid',
    'budget_increase': 'budget_increase',
    'budget_decrease': 'budget_decrease',
    'budget_set': 'budget_set',
    'budget_adjustment': 'budget_adjustment',
    'placement_adjust': 'placement_adjust',
    'search_term_harvest': 'search_term_harvest',
    'negative_keyword_add': 'negative_keyword_add',
    'negative_keyword_remove': 'negative_keyword_remove',
    'keyword_create': 'keyword_create',
    'target_pause': 'target_pause',
    'target_enable': 'target_enable',
    'campaign_pause': 'campaign_pause',
    'campaign_enable': 'campaign_enable',
    'create_target': 'create_target',
    'update_target': 'update_target',
    'delete_target': 'delete_target',
    'pause_target': 'pause_target',
    'resume_target': 'resume_target',
    'add_campaign': 'add_campaign',
    'remove_campaign': 'remove_campaign',
    'settings_update': 'settings_update',
    'strategy_change': 'strategy_change',
  };
  
  const events = oldLogs.map((log) => {
    const logData = log as Record<string, unknown>;
    const mappedCategory = categoryMap[String(logData.logCategory || '')] || 'settings_change';
    const mappedAction = actionTypeMap[String(logData.actionType || '')] || 'settings_update';
    
    return {
      performanceGroupId: log.performanceGroupId,
      performanceGroupName: log.performanceGroupName,
      accountId: log.accountId,
      accountName: log.accountName,
      userId: log.userId,
      userName: log.userName,
      eventCategory: mappedCategory as unknown,
      actionType: mappedAction as unknown,
      strategyTemplateId: log.strategyTemplateId,
      strategyTemplateName: log.strategyTemplateName,
      campaignId: log.campaignId,
      campaignName: log.campaignName,
      previousValue: log.previousValue,
      newValue: log.newValue,
      changeReason: log.changeReason,
      actionDetail: log.actionDetail,
      status: log.status as string || 'success',
      apiSyncStatus: log.apiSyncStatus as unknown,
      apiSyncDetail: log.apiSyncDetail,
      errorMessage: log.errorMessage,
      sourceTable: 'optimization_logs',
      sourceId: log.id,
      createdAt: log.createdAt,
      executedAt: log.executedAt,
    };
  });
  
  // 分批插入（避免一次性插入太多）
  const batchSize = 500;
  let migrated = 0;
  for (let i = 0; i < events.length; i += batchSize) {
    const batch = events.slice(i, i + batchSize);
    // @ts-ignore - events mapped from legacy optimizationLogs schema
    await db.insert(optimizationEvents).values(batch);
    migrated += batch.length;
  }
  
  return migrated;
}

/**
 * v146: 全局自动数据迁移 - 将所有旧表数据迁移到 optimization_events
 * 启动时自动执行，通过检查 optimization_events 中是否已有 source_table 记录来防止重复迁移
 */

/**
 * v146: 全局自动数据迁移 - 将所有旧表数据迁移到 optimization_events
 * 启动时自动执行，通过检查 optimization_events 中是否已有 source_table 记录来防止重复迁移
 */
export async function runAutoMigration(): Promise<{ success: boolean; migrated: Record<string, number>; skipped: string[] }> {
  const db = await getDb();
  if (!db) return { success: false, migrated: {}, skipped: ['Database not available'] };
  
  const migrated: Record<string, number> = {};
  const skipped: string[] = [];
  
  try {
    // 检查是否已迁移过（通过 source_table 字段判断）
    const existingMigrations = await db.select({
      sourceTable: optimizationEvents.sourceTable,
      count: sql<number>`count(*)`
    })
      .from(optimizationEvents)
      .where(sql`${optimizationEvents.sourceTable} IS NOT NULL`)
      .groupBy(optimizationEvents.sourceTable);
    
    const migratedSources = new Set(existingMigrations.map(m => m.sourceTable));
    
    // 1. 迁移 bidding_logs
    if (migratedSources.has('bidding_logs')) {
      skipped.push('bidding_logs (already migrated)');
    } else {
      try {
        const accounts = await getAdAccounts();
        // @ts-ignore Type inference limitation
        let totalBiddingLogs = 0;
        for (const account of (accounts as unknown[])) {
          // @ts-ignore Async operation type inference
          totalBiddingLogs += await migrateFromBiddingLogs(account.id);
        }
        migrated.biddingLogs = totalBiddingLogs;
      } catch (err: unknown) {
        log.warn('[AutoMigration] bidding_logs migration error:', (err as Error).message);
        skipped.push(`bidding_logs (error: ${(err as Error).message})`);
      }
    }
    
    // 2. 迁移 bid_adjustment_history
    if (migratedSources.has('bid_adjustment_history')) {
      skipped.push('bid_adjustment_history (already migrated)');
    } else {
      try {
        // @ts-ignore Type inference limitation
        const accounts = await getAdAccounts();
        let totalBidHistory = 0;
        for (const account of (accounts as unknown[])) {
          // @ts-ignore Async operation type inference
          totalBidHistory += await migrateFromBidAdjustmentHistory(account.id);
        }
        migrated.bidAdjustmentHistory = totalBidHistory;
      } catch (err: unknown) {
        log.warn('[AutoMigration] bid_adjustment_history migration error:', (err as Error).message);
        skipped.push(`bid_adjustment_history (error: ${(err as Error).message})`);
      }
    }
    
    // 3. 迁移 optimization_logs（按 performance group）
    if (migratedSources.has('optimization_logs')) {
      skipped.push('optimization_logs (already migrated)');
    } else {
      // @ts-ignore Legacy code type compatibility
      try {
        const accounts = await getAdAccounts();
        let totalOptLogs = 0;
        for (const account of (accounts as unknown[])) {
          // @ts-ignore Type inference limitation
          const groups = await getPerformanceGroupsByAccountId(account.id);
          for (const group of groups) {
            totalOptLogs += await migrateFromOptimizationLogs(group.id);
          }
        }
        migrated.optimizationLogs = totalOptLogs;
      } catch (err: unknown) {
        // @ts-ignore Legacy code type compatibility
        log.warn('[AutoMigration] optimization_logs migration error:', (err as Error).message);
        skipped.push(`optimization_logs (error: ${(err as Error).message})`);
      }
    }
    
    // @ts-ignore DB query type inference limitation
    const totalMigrated = Object.values(migrated).reduce((a: unknown, b: unknown) => a + b, 0);
    log.info(`[AutoMigration] 完成: 共迁移 ${totalMigrated} 条记录`, { migrated, skipped });
    
    return { success: true, migrated, skipped };
  } catch (err: unknown) {
    log.warn('[AutoMigration] 全局迁移失败:', (err as Error).message);
    return { success: false, migrated, skipped: [...skipped, (err as Error).message] };
  }
}


/**
 * 获取优化目标的趋势对比数据（加入前 vs 加入后）
 * 用于科学计算目标达成度
 */
