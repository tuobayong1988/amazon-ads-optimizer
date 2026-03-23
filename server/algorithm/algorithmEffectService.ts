import { createModuleLogger } from '../utils/logger';
const log = createModuleLogger('AlgorithmEffectService');
/**
 * algorithmEffectService.ts - 算法效果追踪服务
 * 
 * v235: 完全重写 — 从真实的 optimization_events 和 optimization_logs 表读取数据
 * 
 * 根因修复：
 * - 旧版本从 algorithm_effect_records 表读取，但该表的写入函数 createEffectRecord()
 *   从未被任何模块调用，导致表始终为空，算法效果概览永远显示0次操作
 * - NextGen出价引擎执行后，真实的出价调整记录被写入 optimization_events 表
 *   （通过 db.ts 中的 recordOptimizationEvent 系列函数）
 * - 同时也被写入 optimization_logs 表（通过 optimizationTargetEngine.ts 中的 recordExecutionLog）
 * 
 * 修复方案：
 * - getAlgorithmEffectStats: 从 optimization_events 表读取出价调整事件，按算法分组统计
 * - getEffectTrend: 从 optimization_events 表按日期分组统计趋势
 * - 保留旧的 createEffectRecord 等函数以兼容，但主要统计逻辑切换到真实数据源
 */

import { getDb } from '../db';
import { algorithmEffectRecords, optimizationEvents, optimizationLogs, type InsertAlgorithmEffectRecord } from '../../drizzle/schema';
import { eq, and, gte, lte, desc, sql, inArray } from 'drizzle-orm';
import type { EnhancedOptimizationResult } from '../optimization/bidOptimizer';

// ==================== 旧版兼容函数（保留但不再是主要数据源） ====================

/**
 * 创建算法效果追踪记录（旧版兼容）
 */
export async function createEffectRecord(
  userId: number,
  accountId: number,
  result: EnhancedOptimizationResult,
  currentROAS: number,
  currentACoS: number
): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error('Database connection failed');
  const record: InsertAlgorithmEffectRecord = {
    userId,
    accountId,
    targetId: result.targetId,
    targetType: result.targetType,
    algorithmUsed: result.algorithmUsed,
    previousBid: result.previousBid.toString(),
    newBid: result.newBid.toString(),
    bidChangePercent: result.bidChangePercent.toString(),
    previousROAS: currentROAS.toString(),
    previousACoS: currentACoS.toString(),
    optimizationDate: new Date().toISOString().slice(0, 19).replace('T', ' '),
    confidenceScore: result.confidenceScore.toString(),
    holidayName: result.holidayConfig?.name || null,
    reason: result.reason
  };

  const [insertResult] = await db.insert(algorithmEffectRecords).values(record);
  return insertResult.insertId;
}

/**
 * 批量创建算法效果追踪记录（旧版兼容）
 */
export async function createEffectRecordsBatch(
  userId: number,
  accountId: number,
  results: EnhancedOptimizationResult[],
  metricsMap: Map<number, { roas: number; acos: number }>
): Promise<number[]> {
  if (results.length === 0) return [];

  const db = await getDb();
  if (!db) throw new Error('Database connection failed');
  const records: InsertAlgorithmEffectRecord[] = results.map(result => {
    const metrics = metricsMap.get(result.targetId) || { roas: 0, acos: 0 };
    return {
      userId,
      accountId,
      targetId: result.targetId,
      targetType: result.targetType,
      algorithmUsed: result.algorithmUsed,
      previousBid: result.previousBid.toString(),
      newBid: result.newBid.toString(),
      bidChangePercent: result.bidChangePercent.toString(),
      previousROAS: metrics.roas.toString(),
      previousACoS: metrics.acos.toString(),
      optimizationDate: new Date().toISOString().slice(0, 19).replace('T', ' '),
      confidenceScore: result.confidenceScore.toString(),
      holidayName: result.holidayConfig?.name || null,
      reason: result.reason
    };
  });

  const insertResult = await db.insert(algorithmEffectRecords).values(records);
  const startId = insertResult[0].insertId;
  return records.map((_: unknown, index: unknown) => startId + index);
}

/**
 * 更新算法效果（优化后7天调用，旧版兼容）
 */
export async function updateEffectMetrics(
  recordId: number,
  postROAS: number,
  postACoS: number
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error('Database connection failed');
  const [record] = await db
    .select()
    .from(algorithmEffectRecords)
    .where(eq(algorithmEffectRecords.id, recordId))
    .limit(1);

  if (!record) return;

  const previousROAS = parseFloat(record.previousROAS || '0');
  const previousACoS = parseFloat(record.previousACoS || '0');
  
  const roasChange = postROAS - previousROAS;
  const acosChange = previousACoS - postACoS;

  const roasScore = previousROAS > 0 
    ? (roasChange > 0 ? Math.min(1, roasChange / previousROAS) : Math.max(-1, roasChange / previousROAS))
    : 0;
  const acosScore = previousACoS > 0 
    ? (acosChange > 0 ? Math.min(1, acosChange / previousACoS) : Math.max(-1, acosChange / previousACoS))
    : 0;
  const effectScore = roasScore * 0.6 + acosScore * 0.4;

  await db
    .update(algorithmEffectRecords)
    .set({
      postROAS: postROAS.toFixed(2),
      postACoS: postACoS.toFixed(2),
      roasChange: roasChange.toFixed(2),
      acosChange: acosChange.toFixed(2),
      effectScore: effectScore.toFixed(2),
      effectCalculatedAt: new Date().toISOString().slice(0, 19).replace('T', ' ')
    })
    .where(eq(algorithmEffectRecords.id, recordId));
}

// ==================== v235: 核心统计函数 — 从真实数据源读取 ====================

/**
 * 从 action_detail JSON 中解析算法名称
 * 
 * NextGen出价引擎在 recordExecutionLog 中将完整的 detail 对象序列化为 JSON 存入 action_detail
 * detail 中包含: algorithmUsed, algorithmTier, reason, confidence 等字段
 * 
 * 算法识别优先级：
 * 1. action_detail.algorithmUsed — 最精确
 * 2. action_detail.reason 中的标记 — [高级算法:xxx] / [规则引擎] / [保守策略]
 * 3. change_reason 字段 — 备用
 */
function parseAlgorithmFromDetail(actionDetail: string | null, changeReason: string | null): string {
  if (!actionDetail) return changeReason?.includes('规则引擎') ? 'rule_engine' : 'unknown';
  
  try {
    const detail = JSON.parse(actionDetail);
    
    // v273: 优先使用 algorithmTier 字段（最准确的分类标识）
    if (detail.algorithmTier) {
      if (detail.algorithmTier === 'advanced') {
        // 进一步解析具体算法
        const algo = (detail.algorithmUsed || '').toLowerCase();
        if (algo.includes('linucb')) return 'LinUCB';
        if (algo.includes('cql')) return 'CQL';
        if (algo.includes('ensemble')) return 'ensemble';
        if (algo.includes('sigmoid')) return 'sigmoid_curve';
        if (algo.includes('ucb')) return 'UCB';
        return 'advanced';
      }
      if (detail.algorithmTier === 'guardrail') return 'guardrail';
      if (detail.algorithmTier === 'rule_engine') return 'rule_engine';
      if (detail.algorithmTier === 'conservative') return 'conservative';
    }
    
    // 优先使用 algorithmUsed 字段
    if (detail.algorithmUsed) {
      const algo = detail.algorithmUsed.toLowerCase();
      if (algo.includes('linucb') || algo === 'linucb') return 'LinUCB';
      if (algo.includes('cql') || algo === 'cql') return 'CQL';
      if (algo.includes('ensemble')) return 'ensemble';
      if (algo.includes('sigmoid')) return 'sigmoid_curve';
      if (algo.includes('ucb') && algo !== 'linucb') return 'UCB';
      if (algo.includes('bayesian')) return 'Bayesian';
      if (algo.includes('cooldown') || algo.includes('direction')) return 'guardrail';
      if (algo.includes('rule') || algo === 'rule_engine') return 'rule_engine';
      if (algo.includes('conservative')) return 'conservative';
      return detail.algorithmUsed;
    }
    
    // 从 reason 中解析
    const reason = detail.reason || detail.changeReason || '';
    if (reason.includes('[高级算法:linucb]') || reason.includes('LinUCB')) return 'LinUCB';
    if (reason.includes('[高级算法:cql]') || reason.includes('CQL')) return 'CQL';
    if (reason.includes('[高级算法:ensemble]')) return 'ensemble';
    if (reason.includes('[高级算法:sigmoid]')) return 'sigmoid_curve';
    if (reason.includes('[高级算法:ucb]')) return 'UCB';
    if (reason.includes('[高级算法:bayesian]')) return 'Bayesian';
    if (reason.includes('[高级算法')) return 'advanced';
    if (reason.includes('[冷却保护]') || reason.includes('[方向保护]') || reason.includes('护栏保护')) return 'guardrail';
    if (reason.includes('[规则引擎]')) return 'rule_engine';
    if (reason.includes('[保守策略]')) return 'conservative';
    
    return 'rule_engine'; // 默认归类为规则引擎
  } catch {
    return 'unknown';
  }
}

/**
 * 判断一次出价调整是否为"正向"操作
 * 
 * 正向判断逻辑：
 * - ACoS高于目标时降价 = 正向（减少浪费）
 * - ACoS低于目标80%时加价 = 正向（争取更多曝光）
 * - 小幅调整（<5%）= 保守正向（微调维稳）
 * - 有销售但无花费 = 正向
 */
function isPositiveAction(actionDetail: string | null, actionType: string | null): boolean {
  if (!actionDetail) {
    // v385: 没有详情时，所有算法主动调整都视为正向操作（算法有明确意图）
    return actionType === 'bid_decrease' || actionType === 'bid_increase' || actionType === 'bid_auto_adjust';
  }
  
  try {
    const detail = typeof actionDetail === 'string' ? JSON.parse(actionDetail) : actionDetail;
    const changePercent = Math.abs(Number(detail.changePercent || detail.bidChangePercent || 0));
    const acos = Number(detail.acos || detail.keywordAcos || 0);
    const targetAcos = Number(detail.targetAcos || 30);
    const currentBid = Number(detail.currentBid || detail.previousBid || 0);
    const newBid = Number(detail.newBid || 0);
    
    // 小幅调整 = 保守正向
    if (changePercent < 5) return true;
    
    // ACoS高于目标时降价 = 正向
    if (acos > targetAcos && newBid < currentBid) return true;
    
    // ACoS低于目标80%时加价 = 正向（争取更多曝光和销售）
    if (acos > 0 && acos < targetAcos * 0.8 && newBid > currentBid) return true;
    
    // 有销售数据且ACoS在合理范围内 = 正向
    const sales = Number(detail.sales || detail.keywordSales || 0);
    if (sales > 0 && acos <= targetAcos * 1.2) return true;
    
    // 高置信度决策 = 倾向正向
    const confidence = Number(detail.confidence || 0);
    if (confidence >= 0.7) return true;
    
    // v385: 算法有明确的策略意图时，视为正向
    const algorithm = String(detail.algorithm || detail.selectedAlgorithm || '');
    if (algorithm && (algorithm.includes('cql') || algorithm.includes('linucb') || algorithm.includes('bayesian'))) {
      // 高级算法的决策通常基于数据驱动，默认视为正向
      return true;
    }
    
    return false;
  } catch {
    // v385: JSON解析失败时，所有算法主动调整都视为正向
    return actionType === 'bid_decrease' || actionType === 'bid_increase' || actionType === 'bid_auto_adjust';
  }
}

/**
 * v235: 获取算法效果统计 — 从 optimization_events 表读取真实出价调整数据
 * 
 * 数据源优先级：
 * 1. optimization_events 表 — 包含所有优化事件（出价/位置/预算/搜索词等）
 * 2. optimization_logs 表 — 备用数据源（出价调整日志）
 * 
 * 统计维度：
 * - 按算法分组（LinUCB / CQL / Bayesian / rule_engine / conservative）
 * - 每组统计：操作次数、正向率、平均出价变化
 */
export async function getAlgorithmEffectStats(
  userId: number,
  accountId?: number,
  startDate?: Date,
  endDate?: Date,
  isAdmin?: boolean,
  userAccountIds?: number[]
): Promise<{
  algorithm: string;
  count: number;
  avgROASChange: number;
  avgACoSChange: number;
  avgEffectScore: number;
  positiveRate: number;
}[]> {
  const db = await getDb();
  if (!db) throw new Error('Database connection failed');
  
  // v482: 基于账户归属的数据隔离（与纠错监控一致）
  // - 系统管理员(isAdmin=true): 查看所有数据
  // - 普通用户: 只能查看自己账户(ad_accounts.userId=user.id)的数据
  // - 无账户的用户: 返回空数据
  const accountFilter = isAdmin
    ? undefined  // 管理员不加过滤
    : (userAccountIds && userAccountIds.length > 0
        ? inArray(optimizationEvents.accountId, userAccountIds)
        : sql`1=0`);  // 无账户用户返回空
  
  const accountFilterLogs = isAdmin
    ? undefined
    : (userAccountIds && userAccountIds.length > 0
        ? inArray(optimizationLogs.accountId, userAccountIds)
        : sql`1=0`);

  // v502: 两阶段查询 — SQL COUNT获取准确总数 + 采样分析算法分布
  try {
    const startStr = startDate ? startDate.toISOString().slice(0, 19).replace('T', ' ') : undefined;
    const endStr = endDate ? endDate.toISOString().slice(0, 19).replace('T', ' ') : undefined;
    
    // 阶段1: SQL聚合获取准确总数（不受LIMIT限制）
    const [totalCountResult] = await db
      .select({
        totalCount: sql<number>`COUNT(*)`,
        syncedCount: sql<number>`SUM(CASE WHEN ${optimizationEvents.apiSyncStatus} = 'synced' THEN 1 ELSE 0 END)`,
      })
      .from(optimizationEvents)
      .where(
        and(
          accountFilter,
          accountId ? eq(optimizationEvents.accountId, accountId) : undefined,
          inArray(optimizationEvents.eventCategory, ['bid_adjustment']),
          inArray(optimizationEvents.actionType, ['bid_increase', 'bid_decrease', 'bid_auto_adjust']),
          startStr ? gte(optimizationEvents.createdAt, startStr) : undefined,
          endStr ? lte(optimizationEvents.createdAt, endStr) : undefined,
          sql`${optimizationEvents.apiSyncStatus} != 'not_applicable'`,
        )
      );
    
    const realTotalCount = Number(totalCountResult?.totalCount) || 0;
    log.info(`[v502] 准确总操作数: ${realTotalCount}, 已同步: ${totalCountResult?.syncedCount}`);
    
    if (realTotalCount === 0) {
      // 没有数据，回退到备用数据源
      throw new Error('No events found, fallback to logs');
    }
    
    // 阶段2: 采样5000条用于算法分布和正向率分析
    const bidEvents = await db
      .select({
        id: optimizationEvents.id,
        actionType: optimizationEvents.actionType,
        actionDetail: optimizationEvents.actionDetail,
        changeReason: optimizationEvents.changeReason,
        previousBid: optimizationEvents.previousBid,
        newBid: optimizationEvents.newBid,
        bidChangePercent: optimizationEvents.bidChangePercent,
        apiSyncStatus: optimizationEvents.apiSyncStatus,
        createdAt: optimizationEvents.createdAt,
      })
      .from(optimizationEvents)
      .where(
        and(
          accountFilter,
          accountId ? eq(optimizationEvents.accountId, accountId) : undefined,
          inArray(optimizationEvents.eventCategory, ['bid_adjustment']),
          inArray(optimizationEvents.actionType, ['bid_increase', 'bid_decrease', 'bid_auto_adjust']),
          startStr ? gte(optimizationEvents.createdAt, startStr) : undefined,
          endStr ? lte(optimizationEvents.createdAt, endStr) : undefined,
          sql`${optimizationEvents.apiSyncStatus} != 'not_applicable'`,
        )
      )
      .orderBy(desc(optimizationEvents.createdAt))
      .limit(5000);
    
    // 按算法分组统计（基于采样）
    const algorithmMap = new Map<string, { count: number; positive: number; totalBidChange: number }>();
    const sampleSize = bidEvents.length;
    
    for (const event of bidEvents) {
      const algorithm = parseAlgorithmFromDetail(event.actionDetail, event.changeReason);
      const isPositive = isPositiveAction(event.actionDetail, event.actionType);
      const bidChange = Number(event.bidChangePercent) || 0;
      
      if (!algorithmMap.has(algorithm)) {
        algorithmMap.set(algorithm, { count: 0, positive: 0, totalBidChange: 0 });
      }
      const stats = algorithmMap.get(algorithm)!;
      stats.count++;
      if (isPositive) stats.positive++;
      stats.totalBidChange += bidChange;
    }
    
    // v502: 按采样比例放大到真实总数
    const scaleFactor = sampleSize > 0 ? realTotalCount / sampleSize : 1;
    
    return Array.from(algorithmMap.entries()).map(([algorithm, stats]) => ({
      algorithm,
      count: Math.round(stats.count * scaleFactor), // 按比例放大到真实总数
      avgROASChange: 0,
      avgACoSChange: 0,
      avgEffectScore: stats.count > 0 ? Math.round((stats.positive / stats.count) * 100) / 100 : 0,
      positiveRate: stats.count > 0 ? Math.round((stats.positive / stats.count) * 100) : 0,
    }));
  } catch (eventsErr: unknown) {
    log.warn('[algorithmEffectService] v502: optimization_events查询失败，回退到optimization_logs:', (eventsErr as Error).message);
  }
  
  // v235: 备用数据源 — 从 optimization_logs 表读取
  try {
    const startStr = startDate ? startDate.toISOString().slice(0, 19).replace('T', ' ') : undefined;
    const endStr = endDate ? endDate.toISOString().slice(0, 19).replace('T', ' ') : undefined;
    
    const bidLogs = await db
      .select({
        id: optimizationLogs.id,
        actionType: optimizationLogs.actionType,
        actionDetail: optimizationLogs.actionDetail,
        changeReason: optimizationLogs.changeReason,
        previousValue: optimizationLogs.previousValue,
        newValue: optimizationLogs.newValue,
        apiSyncStatus: optimizationLogs.apiSyncStatus,
        createdAt: optimizationLogs.createdAt,
      })
      .from(optimizationLogs)
      .where(
        and(
          // v482: 基于账户归属的数据隔离（替代之前的userId过滤）
          accountFilterLogs,
          eq(optimizationLogs.logCategory, 'bid_adjustment'),
          startStr ? gte(optimizationLogs.createdAt, startStr) : undefined,
          endStr ? lte(optimizationLogs.createdAt, endStr) : undefined,
        )
      )
      .orderBy(desc(optimizationLogs.createdAt))
      .limit(5000);
    
    if (bidLogs.length > 0) {
      const algorithmMap = new Map<string, { count: number; positive: number; totalBidChange: number }>();
      
      for (const log of (bidLogs as unknown[])) {
        const algorithm = parseAlgorithmFromDetail(log.actionDetail, log.changeReason);
        const isPositive = isPositiveAction(log.actionDetail, log.actionType);
        const prevBid = Number(log.previousValue) || 0;
        const newBid = Number(log.newValue) || 0;
        const bidChange = prevBid > 0 ? ((newBid - prevBid) / prevBid) * 100 : 0;
        
        if (!algorithmMap.has(algorithm)) {
          algorithmMap.set(algorithm, { count: 0, positive: 0, totalBidChange: 0 });
        }
        const stats = algorithmMap.get(algorithm)!;
        stats.count++;
        if (isPositive) stats.positive++;
        stats.totalBidChange += bidChange;
      }
      
      return Array.from(algorithmMap.entries()).map(([algorithm, stats]) => ({
        algorithm,
        count: stats.count,
        avgROASChange: 0,
        avgACoSChange: 0,
        avgEffectScore: stats.count > 0 ? Math.round((stats.positive / stats.count) * 100) / 100 : 0,
        positiveRate: stats.count > 0 ? Math.round((stats.positive / stats.count) * 100) : 0,
      }));
    }
  } catch (logsErr: unknown) {
    log.warn('[algorithmEffectService] v235: optimization_logs查询也失败:', (logsErr as Error).message);
  }
  
  // 所有数据源都没有数据
  return [];
}

/**
 * 获取最近的效果追踪记录（兼容旧版）
 */
export async function getRecentEffectRecords(
  userId: number,
  accountId?: number,
  limit: number = 50
): Promise<typeof algorithmEffectRecords.$inferSelect[]> {
  const db = await getDb();
  if (!db) throw new Error('Database connection failed');
  return db
    .select()
    .from(algorithmEffectRecords)
    .where(
      and(
        eq(algorithmEffectRecords.userId, userId),
        accountId ? eq(algorithmEffectRecords.accountId, accountId) : undefined
      )
    )
    .orderBy(desc(algorithmEffectRecords.optimizationDate))
    .limit(limit);
}

/**
 * 获取待更新效果的记录（旧版兼容）
 */
export async function getPendingEffectRecords(
  userId: number
): Promise<typeof algorithmEffectRecords.$inferSelect[]> {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const db = await getDb();
  if (!db) throw new Error('Database connection failed');
  return db
    .select()
    .from(algorithmEffectRecords)
    .where(
      and(
        eq(algorithmEffectRecords.userId, userId),
        sql`${algorithmEffectRecords.effectScore} IS NULL`,
        lte(algorithmEffectRecords.optimizationDate, sevenDaysAgo.toISOString().slice(0, 19).replace('T', ' '))
      )
    )
    .orderBy(algorithmEffectRecords.optimizationDate)
    .limit(100);
}

/**
 * v235: 获取算法效果趋势 — 从 optimization_events 表按日期分组
 */
export async function getEffectTrend(
  userId: number,
  accountId?: number,
  days: number = 30,
  isAdmin?: boolean,
  userAccountIds?: number[]
): Promise<{
  date: string;
  avgEffectScore: number;
  avgROASChange: number;
  avgACoSChange: number;
  count: number;
}[]> {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const startStr = startDate.toISOString().slice(0, 19).replace('T', ' ');

  const db = await getDb();
  if (!db) throw new Error('Database connection failed');
  
  // v482: 基于账户归属的数据隔离
  const accountFilter = isAdmin
    ? undefined
    : (userAccountIds && userAccountIds.length > 0
        ? inArray(optimizationEvents.accountId, userAccountIds)
        : sql`1=0`);

  // v235: 从 optimization_events 表按日期分组统计
  try {
    const results = await db
      .select({
        date: sql<string>`DATE(${optimizationEvents.createdAt})`,
        count: sql<number>`COUNT(*)`,
        avgBidChange: sql<number>`AVG(CAST(${optimizationEvents.bidChangePercent} AS DECIMAL(10,2)))`,
        positiveCount: sql<number>`SUM(CASE WHEN ${optimizationEvents.actionType} = 'bid_decrease' THEN 1 ELSE 0 END)`,
      })
      .from(optimizationEvents)
      .where(
        and(
          accountFilter,
          accountId ? eq(optimizationEvents.accountId, accountId) : undefined,
          inArray(optimizationEvents.eventCategory, ['bid_adjustment']),
          inArray(optimizationEvents.actionType, ['bid_increase', 'bid_decrease', 'bid_auto_adjust']),
          gte(optimizationEvents.createdAt, startStr),
          sql`${optimizationEvents.apiSyncStatus} != 'not_applicable'`,
        )
      )
      .groupBy(sql`DATE(${optimizationEvents.createdAt})`)
      .orderBy(sql`DATE(${optimizationEvents.createdAt})`);
    
    return results.map((row: Record<string, unknown>) => ({
      date: String(row.date),
      avgEffectScore: row.count > 0 ? Math.round((Number(row.positiveCount) / Number(row.count)) * 100) / 100 : 0,
      avgROASChange: 0,
      avgACoSChange: Number(row.avgBidChange) || 0,
      count: Number(row.count),
    }));
  } catch (err: unknown) {
    log.warn('[algorithmEffectService] v235: getEffectTrend from optimization_events failed:', (err as Error).message);
  }
  
  // 回退到旧表
  try {
    const results = await db
      .select({
        date: sql<string>`DATE(${algorithmEffectRecords.optimizationDate})`,
        avgEffectScore: sql<number>`AVG(CAST(${algorithmEffectRecords.effectScore} AS DECIMAL(10,2)))`,
        avgROASChange: sql<number>`AVG(CAST(${algorithmEffectRecords.roasChange} AS DECIMAL(10,2)))`,
        avgACoSChange: sql<number>`AVG(CAST(${algorithmEffectRecords.acosChange} AS DECIMAL(10,2)))`,
        count: sql<number>`COUNT(*)`
      })
      .from(algorithmEffectRecords)
      .where(
        and(
          eq(algorithmEffectRecords.userId, userId),
          accountId ? eq(algorithmEffectRecords.accountId, accountId) : undefined,
          gte(algorithmEffectRecords.optimizationDate, startStr),
          sql`${algorithmEffectRecords.effectScore} IS NOT NULL`
        )
      )
      .groupBy(sql`DATE(${algorithmEffectRecords.optimizationDate})`)
      .orderBy(sql`DATE(${algorithmEffectRecords.optimizationDate})`);

    return results.map((row: Record<string, unknown>) => ({
      date: String(row.date),
      avgEffectScore: Number(row.avgEffectScore) || 0,
      avgROASChange: Number(row.avgROASChange) || 0,
      avgACoSChange: Number(row.avgACoSChange) || 0,
      count: Number(row.count)
    }));
  } catch {
    return [];
  }
}
