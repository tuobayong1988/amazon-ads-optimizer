import { eq, and, desc, gte, lte, sql, isNull, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from 'mysql2/promise';
import { 
  InsertUser, users, 
  adAccounts, InsertAdAccount, AdAccount,
  dataSyncJobs, dataSyncLogs,
  performanceGroups, InsertPerformanceGroup, PerformanceGroup,
  campaigns, InsertCampaign, Campaign,
  adGroups, InsertAdGroup, AdGroup,
  keywords, InsertKeyword, Keyword,
  productTargets, InsertProductTarget, ProductTarget,
  biddingLogs, InsertBiddingLog, BiddingLog,
  dailyPerformance, InsertDailyPerformance, DailyPerformance,
  marketCurveData, InsertMarketCurveData,
  importJobs, InsertImportJob, ImportJob,
  negativeKeywords, InsertNegativeKeyword, NegativeKeyword,
  notificationSettings, NotificationSetting, InsertNotificationSetting,
  notificationHistory, NotificationHistoryRecord, InsertNotificationHistory,
  scheduledTasks, ScheduledTask, InsertScheduledTask,
  taskExecutionLog, TaskExecutionLogRecord, InsertTaskExecutionLog,
  batchOperations, BatchOperation, InsertBatchOperation,
  batchOperationItems, BatchOperationItem, InsertBatchOperationItem,
  attributionCorrectionRecords, AttributionCorrectionRecord, InsertAttributionCorrectionRecord,
  correctionReviewSessions, CorrectionReviewSession, InsertCorrectionReviewSession,
  teamMembers, TeamMember, InsertTeamMember,
  accountPermissions, AccountPermission, InsertAccountPermission,
  emailReportSubscriptions, EmailReportSubscription, InsertEmailReportSubscription,
  emailSendLogs, EmailSendLog, InsertEmailSendLog,
  searchTerms, SearchTerm, InsertSearchTerm,
  aiOptimizationExecutions, AiOptimizationExecution, InsertAiOptimizationExecution,
  aiOptimizationActions, AiOptimizationAction, InsertAiOptimizationAction,
  aiOptimizationPredictions, AiOptimizationPrediction, InsertAiOptimizationPrediction,
  aiOptimizationReviews, AiOptimizationReview, InsertAiOptimizationReview,
  bidAdjustmentHistory,
  syncChangeRecords, SyncChangeRecord, InsertSyncChangeRecord,
  syncConflicts, SyncConflict, InsertSyncConflict,
  syncTaskQueue, SyncTaskQueue, InsertSyncTaskQueue,
  syncChangeSummary, SyncChangeSummary, InsertSyncChangeSummary,
  optimizationLogs, OptimizationLog, InsertOptimizationLog,
  optimizationEvents, OptimizationEvent, InsertOptimizationEvent
} from "../drizzle/schema";
import { ENV } from './_core/env';
import { createModuleLogger } from './utils/logger';
import { guardCampaignIdParam, guardCampaignIdInsert, assertLocalId } from './utils/idTypes';
import { registerDbQueryProviders } from './utils/dbQueryProvider';
const log = createModuleLogger('Database');

/** v360: 统一的数据库实例类型别名，用于替代各处的 ReturnType<typeof getDb> */
export type DbInstance = Awaited<ReturnType<typeof getDb>>;
/** v360: 非空数据库实例类型 */
export type DbInstanceNonNull = NonNullable<DbInstance>;

let _db: ReturnType<typeof drizzle> | null = null;
let _pool: mysql.Pool | null = null;
let _lastHealthCheck = 0;
let _poolStats = { created: 0, healthChecksFailed: 0, rebuilds: 0, directConnBorrowed: 0, directConnReturned: 0 };
const HEALTH_CHECK_INTERVAL = 30_000; // v350: 30秒检查一次连接健康（从60秒缩短）
const POOL_REBUILD_COOLDOWN = 5_000; // v350: 连接池重建冷却期5秒，防止频繁重建
let _lastPoolRebuild = 0;

/**
 * v350: 彻底重写数据库连接管理 — 一次性解决ETIMEDOUT
 * 
 * 根因分析:
 * 1. db.t4g.micro实例1GB内存，27MB缓冲池无法缓存750MB数据 → 已升级到db.t4g.small
 * 2. 11处独立createConnection绕过连接池，存在连接泄漏 → 提供getDirectConnection统一管理
 * 3. connectionLimit=10太小，并发优化任务时连接不够 → 提升到20
 * 4. 没有查询超时保护，慢查询无限期占用连接 → 添加30秒查询超时
 * 5. 健康检查间隔60秒太长 → 缩短到30秒
 * 6. 连接池重建没有冷却期 → 添加5秒冷却期防止雪崩
 * 
 * 设计原则:
 * - 所有数据库操作必须通过连接池，禁止独立createConnection
 * - 需要直接SQL的场景使用getDirectConnection()从池中借用
 * - 连接池自动处理断线重连、超时、keepalive
 * - 添加连接池监控指标，便于诊断
 */
export async function getDb() {
  if (!process.env.DATABASE_URL) return null;
  
  // v350: 定期健康检查 + 冷却期保护
  const now = Date.now();
  if (_db && _pool && (now - _lastHealthCheck > HEALTH_CHECK_INTERVAL)) {
    try {
      const conn = await Promise.race([
        _pool.getConnection(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Health check getConnection timeout')), 5000))
      ]);
      await Promise.race([
        conn.ping(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Health check ping timeout')), 3000))
      ]);
      conn.release();
      _lastHealthCheck = now;
    } catch (error: unknown) {
      _poolStats.healthChecksFailed++;
      log.warn(`[Database] v350: 连接健康检查失败(#${_poolStats.healthChecksFailed}):`, (error as Error).message);
      
      // 冷却期保护：防止频繁重建连接池
      if (now - _lastPoolRebuild > POOL_REBUILD_COOLDOWN) {
        try { await _pool.end(); } catch (e) { /* ignore */ }
        _db = null;
        _pool = null;
        _lastPoolRebuild = now;
        _poolStats.rebuilds++;
        log.info(`[Database] v350: 连接池已销毁，将在下次getDb()时重建 (重建次数: ${_poolStats.rebuilds})`);
      } else {
        log.info(`[Database] v350: 跳过连接池重建（冷却期内，距上次重建${now - _lastPoolRebuild}ms）`);
      }
    }
  }
  
  if (!_db) {
    try {
      // v350: 增强连接池配置 — 彻底解决ETIMEDOUT
      _pool = mysql.createPool({
        uri: process.env.DATABASE_URL,
        waitForConnections: true,
        connectionLimit: 20,          // v350: 从10提升到20，支持并发优化任务
        maxIdle: 10,                  // v350: 从5提升到10，减少连接创建开销
        idleTimeout: 120_000,         // v350: 从60秒提升到120秒，减少频繁断开重连
        connectTimeout: 15_000,       // v350: 从10秒提升到15秒，给RDS更多响应时间
        enableKeepAlive: true,        // 保持连接活跃
        keepAliveInitialDelay: 10_000, // v350: 从30秒缩短到10秒，更积极地保持连接
        queueLimit: 50,               // v350: 新增 — 等待队列最大50个请求，防止无限排队
      });
      
      // v350: 注册连接池事件监听，用于诊断
      _pool.on('connection', () => {
        _poolStats.created++;
      });
      
      // @ts-ignore
      _db = drizzle(_pool as unknown, { casing: 'camelCase' });
      _lastHealthCheck = Date.now();
      _lastPoolRebuild = Date.now();
      log.info(`[Database] v350: 连接池已建立 (limit=20, idle=10, connectTimeout=15s, keepAlive=10s, queueLimit=50)`);
    } catch (error) {
      log.warn("[Database] v350: 连接池创建失败:", error);
      _db = null;
      _pool = null;
    }
  }
  return _db;
}

/**
 * v350: 从连接池获取一个直接的mysql2连接
 * 
 * 用途: 替代所有独立createConnection调用，统一通过连接池管理
 * 重要: 调用者必须在finally块中调用conn.release()归还连接
 * 
 * @param timeoutMs 查询超时时间（毫秒），默认30秒
 * @returns mysql2 PoolConnection，使用完毕后必须release()
 * 
 * 使用示例:
 * ```
 * const conn = await getDirectConnection();
 * try {
 *   await conn.execute('UPDATE ...') as any;
 * } finally {
 *   conn.release();
 * }
 * ```
 */
export async function getDirectConnection(timeoutMs: number = 30_000): Promise<mysql.PoolConnection> {
  // 确保连接池已初始化
  await getDb();
  if (!_pool) {
    throw new Error('[Database] v350: 连接池不可用，无法获取直接连接');
  }
  
  _poolStats.directConnBorrowed++;
  
  try {
    const conn = await Promise.race([
      _pool.getConnection(),
      new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error(`v350: 获取连接超时(${timeoutMs}ms)，连接池可能已满`)), timeoutMs)
      )
    ]);
    
    // v350: 设置会话级查询超时，防止单个慢查询无限期占用连接
    const queryTimeoutSec = Math.ceil(timeoutMs / 1000);
    await conn.execute(`SET SESSION max_execution_time = ${queryTimeoutSec * 1000}`) as any;
    
    // v350: 包装release方法以跟踪归还
    const originalRelease = conn.release.bind(conn);
    let released = false;
    conn.release = () => {
      if (!released) {
        released = true;
        _poolStats.directConnReturned++;
        originalRelease();
      }
    };
    
    return conn;
  } catch (error: unknown) {
    log.error(`[Database] v350: 获取直接连接失败: ${(error as Error).message}`);
    throw error;
  }
}

/**
 * v350: 获取连接池监控指标
 */
export function getPoolStats() {
  return {
    ..._poolStats,
    poolExists: !!_pool,
    dbExists: !!_db,
    leakedConnections: _poolStats.directConnBorrowed - _poolStats.directConnReturned,
  };
}

// v223: 注册数据库查询提供者（延迟到模块加载完成后执行）
// 使用 queueMicrotask 确保所有函数定义完成后再注册
queueMicrotask(() => {
  registerDbQueryProviders({
    getAdGroupById: (id: number) => getAdGroupById(id),
    getKeywordById: (id: number) => getKeywordById(id),
    getProductTargetById: (id: number) => getProductTargetById(id),
    getDb: () => getDb(),
  });
});

// ==================== User Functions ====================
export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    log.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, any> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date().toISOString();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date().toISOString();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    log.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    log.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ==================== Ad Account Functions ====================
export async function createAdAccount(account: InsertAdAccount) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(adAccounts).values(account);
  return result[0].insertId;
}

export async function getAdAccountsByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(adAccounts)
    .where(eq(adAccounts.userId, userId))
    .orderBy(adAccounts.sortOrder, adAccounts.createdAt);
}

/**
 * @deprecated v361: 此函数不进行租户隔离，仅限系统级内部任务使用（如数据迁移、全局调度）。
 * 面向用户的查询请使用 getAdAccountsByUserId(userId) 确保数据隔离。
 */
export async function getAdAccounts() {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(adAccounts);
}

export async function getAdAccountById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  
  const result = await db.select().from(adAccounts).where(eq(adAccounts.id, id)).limit(1);
  return result[0];
}

export async function updateAdAccount(id: number, data: Partial<InsertAdAccount>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(adAccounts).set(data).where(eq(adAccounts.id, id));
}

export async function deleteAdAccount(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.delete(adAccounts).where(eq(adAccounts.id, id));
}

export async function setDefaultAdAccount(userId: number, accountId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // 先取消所有默认账号
  await db.update(adAccounts)
    .set({ isDefault: 0 })
    .where(eq(adAccounts.userId, userId));
  
  // 设置新的默认账号
  await db.update(adAccounts)
    .set({ isDefault: 1 })
    .where(eq(adAccounts.id, accountId));
}

export async function getDefaultAdAccount(userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  
  const result = await db.select().from(adAccounts)
    .where(and(eq(adAccounts.userId, userId), eq(adAccounts.isDefault, 1)))
    .limit(1);
  return result[0];
}

export async function updateAdAccountConnectionStatus(
  id: number, 
  status: 'connected' | 'disconnected' | 'error' | 'pending',
  errorMessage?: string
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(adAccounts).set({
    connectionStatus: status,
    lastConnectionCheck: new Date().toISOString(),
    connectionErrorMessage: errorMessage || null,
  }).where(eq(adAccounts.id, id));
}

export async function reorderAdAccounts(userId: number, accountIds: number[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // 批量更新排序顺序
  for (let i = 0; i < accountIds.length; i++) {
    await db.update(adAccounts)
      .set({ sortOrder: i })
      .where(and(eq(adAccounts.id, accountIds[i]), eq(adAccounts.userId, userId)));
  }
}

// ==================== Performance Group Functions ====================
export async function createPerformanceGroup(group: InsertPerformanceGroup) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(performanceGroups).values(group);
  return result[0].insertId;
}

export async function getPerformanceGroupsByAccountId(accountId: number) {
  log.debug('[db.getPerformanceGroupsByAccountId] called with accountId:', accountId);
  try {
    const db = await getDb();
    log.debug('[db.getPerformanceGroupsByAccountId] db obtained:', !!db);
    if (!db) {
      log.debug('[db.getPerformanceGroupsByAccountId] db is null, returning empty array');
      return [];
    }
    
    // 先尝试获取所有记录看看
    const allRecords = await db.select().from(performanceGroups);
    log.debug('[db.getPerformanceGroupsByAccountId] all records count:', allRecords.length);
    
    // 如果accountId为0或未定义，返回所有优化目标
    if (!accountId || accountId === 0) {
      log.debug('[db.getPerformanceGroupsByAccountId] accountId is 0, returning all');
      return allRecords;
    }
    
    // 过滤指定accountId的记录
    const result = allRecords.filter(r => r.accountId === accountId);
    log.debug('[db.getPerformanceGroupsByAccountId] filtered result count:', result.length);
    return result;
  } catch (error) {
    log.error('[db.getPerformanceGroupsByAccountId] error:', error);
    return [];
  }
}

export async function getPerformanceGroupById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  
  const result = await db.select().from(performanceGroups).where(eq(performanceGroups.id, id)).limit(1);
  return result[0];
}

export async function updatePerformanceGroup(id: number, data: Partial<InsertPerformanceGroup>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(performanceGroups).set(data).where(eq(performanceGroups.id, id));
}

export async function deletePerformanceGroup(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.delete(performanceGroups).where(eq(performanceGroups.id, id));
}

// ==================== Campaign Functions ====================
export async function createCampaign(campaign: InsertCampaign) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(campaigns).values(campaign);
  return result[0].insertId;
}

export async function getCampaignsByAccountId(accountId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(campaigns).where(eq(campaigns.accountId, accountId));
}

// 获取带时间范围绩效数据的广告活动列表
export async function getCampaignsWithPerformance(
  accountId: number,
  startDate: string,
  endDate: string,
  todayDate?: string  // v122h: 站点本地时间的"今天"，用于单独查询今日数据
) {
  const db = await getDb();
  if (!db) return [];
  
  // 获取广告活动基本信息
  const campaignList = await db.select().from(campaigns).where(eq(campaigns.accountId, accountId));
  
  // 获取时间范围内的绩效数据汇总
  // ✅ 只汇总campaign级别的记录，排除账户级汇总记录
  const perfData = await db.select({
    campaignId: dailyPerformance.campaignId,
    totalImpressions: sql<number>`COALESCE(SUM(${dailyPerformance.impressions}), 0)`,
    totalClicks: sql<number>`COALESCE(SUM(${dailyPerformance.clicks}), 0)`,
    totalSpend: sql<string>`COALESCE(SUM(${dailyPerformance.spend}), '0')`,
    totalSales: sql<string>`COALESCE(SUM(${dailyPerformance.sales}), '0')`,
    totalOrders: sql<number>`COALESCE(SUM(${dailyPerformance.orders}), 0)`,
  })
    .from(dailyPerformance)
    .where(and(
      eq(dailyPerformance.accountId, accountId),
      sql`${dailyPerformance.campaignId} IS NOT NULL`,
      sql`DATE(${dailyPerformance.date}) >= ${startDate}`,
      sql`DATE(${dailyPerformance.date}) <= ${endDate}`
    ))
    .groupBy(dailyPerformance.campaignId);
  
  // v122h: 单独查询今日数据（站点本地时间的今天）
  const effectiveTodayDate = todayDate || endDate;
  const todayPerfData = await db.select({
    campaignId: dailyPerformance.campaignId,
    todayImpressions: sql<number>`COALESCE(SUM(${dailyPerformance.impressions}), 0)`,
    todayClicks: sql<number>`COALESCE(SUM(${dailyPerformance.clicks}), 0)`,
    todaySpend: sql<string>`COALESCE(SUM(${dailyPerformance.spend}), '0')`,
    todaySales: sql<string>`COALESCE(SUM(${dailyPerformance.sales}), '0')`,
    todayOrders: sql<number>`COALESCE(SUM(${dailyPerformance.orders}), 0)`,
  })
    .from(dailyPerformance)
    .where(and(
      eq(dailyPerformance.accountId, accountId),
      sql`${dailyPerformance.campaignId} IS NOT NULL`,
      sql`DATE(${dailyPerformance.date}) = ${effectiveTodayDate}`
    ))
    .groupBy(dailyPerformance.campaignId);
  
  // 创建绩效数据映射
  const perfMap = new Map<string, typeof perfData[0]>();
  for (const p of perfData) {
    if (p.campaignId) {
      perfMap.set(p.campaignId, p);
    }
  }
  
  // 创建今日数据映射
  const todayPerfMap = new Map<string, typeof todayPerfData[0]>();
  for (const p of todayPerfData) {
    if (p.campaignId) {
      todayPerfMap.set(p.campaignId, p);
    }
  }
  
  // 获取所有优化目标组名称用于关联展示
  const allGroups = await db.select({
    id: performanceGroups.id,
    name: performanceGroups.name,
    strategyTemplateId: performanceGroups.strategyTemplateId,
    strategyTemplateName: performanceGroups.strategyTemplateName,
  }).from(performanceGroups);
  const groupMap = new Map<number, typeof allGroups[0]>();
  for (const g of allGroups) {
    groupMap.set(g.id, g);
  }
  
  // 合并数据 - 包含优化目标组名称和策略模板推荐
  return campaignList.map(campaign => {
    const perf = perfMap.get(campaign.campaignId);
    const impressions = perf?.totalImpressions || 0;
    const clicks = perf?.totalClicks || 0;
    const spend = parseFloat(perf?.totalSpend || '0');
    const sales = parseFloat(perf?.totalSales || '0');
    const orders = perf?.totalOrders || 0;
    
    // 获取优化目标组信息
    const group = campaign.performanceGroupId ? groupMap.get(campaign.performanceGroupId) : null;
    
    // v122h: 获取今日数据
    const todayPerf = todayPerfMap.get(campaign.campaignId);
    const dailySpend = parseFloat(todayPerf?.todaySpend || '0');
    const dailySales = parseFloat(todayPerf?.todaySales || '0');
    const dailyImpressions = todayPerf?.todayImpressions || 0;
    const dailyClicks = todayPerf?.todayClicks || 0;
    const dailyOrders = todayPerf?.todayOrders || 0;
    
    return {
      ...campaign,
      impressions,
      clicks,
      spend: spend.toFixed(2),
      sales: sales.toFixed(2),
      orders,
      acos: sales > 0 ? ((spend / sales) * 100).toFixed(2) : null,
      roas: spend > 0 ? (sales / spend).toFixed(2) : null,
      ctr: impressions > 0 ? ((clicks / impressions) * 100).toFixed(4) : null,
      cvr: clicks > 0 ? ((orders / clicks) * 100).toFixed(4) : null,
      cpc: clicks > 0 ? (spend / clicks).toFixed(2) : null,
      // v122h: 今日数据（站点本地时间）
      dailySpend: dailySpend.toFixed(2),
      dailySales: dailySales.toFixed(2),
      dailyImpressions,
      dailyClicks,
      dailyOrders,
      // 优化目标组信息
      performanceGroupName: group?.name || null,
      performanceGroupStrategyTemplate: group?.strategyTemplateName || null,
      // 策略模板推荐信息（已存储在campaigns表中）
      recommendedStrategyTemplateId: campaign.recommendedStrategyTemplateId || null,
      recommendedStrategyTemplateName: campaign.recommendedStrategyTemplateName || null,
      recommendationReason: campaign.recommendationReason || null,
    };
  });
}

/**
 * @deprecated v361: 此函数不进行租户隔离，仅限系统级内部任务使用。
 * 面向用户的查询请使用 getCampaignsByAccountId(accountId) 确保数据隔离。
 */
export async function getAllCampaigns() {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(campaigns);
}

export async function getCampaignsByPerformanceGroupId(performanceGroupId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(campaigns).where(eq(campaigns.performanceGroupId, performanceGroupId));
}

// 获取未分配到绩效组的广告活动
export async function getUnassignedCampaigns(accountId?: number) {
  const db = await getDb();
  if (!db) return [];
  
  if (accountId) {
    return db.select().from(campaigns).where(
      and(
        eq(campaigns.accountId, accountId),
        isNull(campaigns.performanceGroupId)
      )
    );
  }
  
  return db.select().from(campaigns).where(isNull(campaigns.performanceGroupId));
}

export async function getCampaignById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  
  const result = await db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
  return result[0];
}

/**
 * 通过Amazon广告活动ID和账户ID查找本地广告活动记录
 * 用于AMS数据流中将Amazon campaignId映射到本地数据库ID
 */
export async function getCampaignByAmazonId(accountId: number, amazonCampaignId: string) {
  const db = await getDb();
  if (!db) return undefined;
  
  const result = await db.select()
    .from(campaigns)
    .where(
      and(
        eq(campaigns.accountId, accountId),
        eq(campaigns.campaignId, amazonCampaignId)
      )
    )
    .limit(1);
  return result[0];
}

/**
 * 通过Amazon广告活动ID查找本地广告活动记录（不需要accountId）
 * Amazon campaignId全局唯一，可直接查找
 */
export async function getCampaignByAmazonCampaignId(amazonCampaignId: string) {
  const db = await getDb();
  if (!db) return undefined;
  
  const result = await db.select()
    .from(campaigns)
    .where(eq(campaigns.campaignId, amazonCampaignId))
    .limit(1);
  return result[0];
}

export async function updateCampaign(id: number, data: Partial<InsertCampaign>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(campaigns).set(data).where(eq(campaigns.id, id));
}

export async function assignCampaignToPerformanceGroup(campaignId: number, performanceGroupId: number | null) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(campaigns).set({ performanceGroupId }).where(eq(campaigns.id, campaignId));
}

// 批量分配广告活动到绩效组
export async function batchAssignCampaignsToPerformanceGroup(campaignIds: number[], performanceGroupId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // 批量更新广告活动的performanceGroupId和optimizationStatus
  await db.update(campaigns)
    .set({ 
      performanceGroupId,
      optimizationStatus: "managed"
    })
    .where(inArray(campaigns.id, campaignIds));
}

// ==================== Ad Group Functions ====================
export async function createAdGroup(adGroup: InsertAdGroup) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(adGroups).values(adGroup);
  return result[0].insertId;
}

export async function getAdGroupsByCampaignId(campaignId: number | string) {
  const db = await getDb();
  if (!db) return [];
  
  // v208: 入口守卫 — campaignId必须是Amazon ID（varchar），不能是本地int
  const campaignIdStr = guardCampaignIdParam(campaignId, 'getAdGroupsByCampaignId');
  return db.select().from(adGroups).where(eq(adGroups.campaignId, campaignIdStr));
}

export async function getAdGroupById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  
  const result = await db.select().from(adGroups).where(eq(adGroups.id, id)).limit(1);
  return result[0];
}

export async function updateAdGroupDefaultBid(id: number, defaultBid: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(adGroups).set({ defaultBid }).where(eq(adGroups.id, id));
}

export async function updateAdGroupStatus(id: number, status: 'enabled' | 'paused' | 'archived') {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(adGroups).set({ adGroupStatus: status }).where(eq(adGroups.id, id));
}

// ==================== Keyword Functions ====================
export async function createKeyword(keyword: InsertKeyword) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(keywords).values(keyword);
  return result[0].insertId;
}

// v357: adGroupId参数类型改为string | number，内部转换为string
export async function getKeywordsByAdGroupId(adGroupId: number | string) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(keywords).where(eq(keywords.adGroupId, String(adGroupId)));
}

export async function getKeywordById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  
  const result = await db.select().from(keywords).where(eq(keywords.id, id)).limit(1);
  return result[0];
}

export async function updateKeywordBid(id: number, newBid: number | string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const bidValue = typeof newBid === 'number' ? String(newBid) : newBid;
  await db.update(keywords).set({ bid: bidValue }).where(eq(keywords.id, id));
}

export async function updateKeyword(id: number, data: Partial<InsertKeyword>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(keywords).set(data).where(eq(keywords.id, id));
}

export async function getKeywordsByCampaignId(campaignId: string | number) {
  const db = await getDb();
  if (!db) return [];
  
  // v208: 入口守卫 — campaignId必须是Amazon ID（varchar）
  const campaignIdStr = guardCampaignIdParam(campaignId, 'getKeywordsByCampaignId');
  
  // 先获取该广告活动下的所有广告组
  const adGroupsList = await db.select().from(adGroups).where(eq(adGroups.campaignId, campaignIdStr));
  
  if (adGroupsList.length === 0) return [];
  
  // v357: adGroupId现在是varchar类型，需要转换为string数组
  const adGroupIds = adGroupsList.map(ag => String(ag.id));
  const allKeywords = await db.select().from(keywords).where(inArray(keywords.adGroupId, adGroupIds));
  
  return allKeywords;
}

// ==================== Product Target Functions ====================
export async function createProductTarget(target: InsertProductTarget) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(productTargets).values(target);
  return result[0].insertId;
}

// v357: adGroupId参数类型改为string | number
export async function getProductTargetsByAdGroupId(adGroupId: number | string) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(productTargets).where(eq(productTargets.adGroupId, String(adGroupId)));
}

// v357: 批量获取多个广告组的商品定向 — adGroupId现在是varchar类型
export async function getProductTargetsByAdGroupIds(adGroupIds: (number | string)[]) {
  const db = await getDb();
  if (!db || adGroupIds.length === 0) return [];
  
  return db.select().from(productTargets).where(inArray(productTargets.adGroupId, adGroupIds.map(id => String(id))));
}

export async function getProductTargetById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  
  const result = await db.select().from(productTargets).where(eq(productTargets.id, id)).limit(1);
  return result[0];
}

export async function updateProductTargetBid(id: number, newBid: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(productTargets).set({ bid: newBid }).where(eq(productTargets.id, id));
}

export async function updateProductTarget(id: number, data: Partial<InsertProductTarget>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(productTargets).set(data).where(eq(productTargets.id, id));
}

// ==================== Bidding Log Functions ====================
export async function createBiddingLog(log: InsertBiddingLog) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // v222: 使用统一解析器确保 campaignId 有效
  const { safeCampaignIdForInsert } = await import('./utils/campaignIdResolver');
  const safeCampaignId = await safeCampaignIdForInsert({
    campaignId: log.campaignId,
    targetLocalId: log.targetId ? Number(log.targetId) : undefined,
    // @ts-ignore
    targetType: (log as unknown).logTargetType || 'keyword',
    // @ts-ignore
    adGroupId: (log as unknown).adGroupId ? Number((log as unknown).adGroupId) : undefined,
    caller: 'createBiddingLog',
  });
  // @ts-ignore
  log.campaignId = safeCampaignId as unknown;
  
  const result = await db.insert(biddingLogs).values(log);
  const logId = result[0].insertId;
  
  // v145: 双写到统一优化事件表
  try {
    const bidChange = Number(log.newBid || 0) - Number(log.previousBid || 0);
    await db.insert(optimizationEvents).values({
      accountId: log.accountId || 0,
      eventCategory: 'bid_adjustment',
      actionType: bidChange > 0 ? 'bid_increase' : bidChange < 0 ? 'bid_decrease' : 'bid_set',
      campaignId: Number(safeCampaignId) || null,
      // @ts-ignore
      campaignName: (log as unknown).campaignName as string || null,
      keywordId: log.targetId,
      // @ts-ignore
      keywordText: (log as unknown).keywordText as string || null,
      matchType: log.logMatchType as string || null,
      previousBid: String(log.previousBid || 0),
      newBid: String(log.newBid || 0),
      bidChangePercent: Number(log.previousBid) > 0 ? String(Math.round(bidChange / Number(log.previousBid) * 10000) / 100) : '0',
      changeReason: log.reason as string || null,
      adjustmentType: log.actionType as string || null,
      status: 'success',
      apiSyncStatus: 'not_applicable',
      sourceTable: 'bidding_logs',
      sourceId: Number(logId),
    });
  } catch (e) {
    // @ts-ignore
    (log as unknown).error('[v145] 双写optimization_events失败(biddingLog):', e);
  }
  
  return logId;
}

export async function getBiddingLogsByAccountId(accountId: number, limit = 100, offset = 0) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select()
    .from(biddingLogs)
    .where(eq(biddingLogs.accountId, accountId))
    .orderBy(desc(biddingLogs.createdAt))
    .limit(limit)
    .offset(offset);
}

export async function getBiddingLogsByCampaignId(campaignId: number | string, limit = 100) {
  const db = await getDb();
  if (!db) return [];
  
  // v186: biddingLogs.campaignId在DB中是varchar类型
  return db.select()
    .from(biddingLogs)
    .where(eq(biddingLogs.campaignId, String(campaignId)))
    .orderBy(desc(biddingLogs.createdAt))
    .limit(limit);
}

export async function getBiddingLogsCount(accountId: number) {
  const db = await getDb();
  if (!db) return 0;
  
  const result = await db.select({ count: sql<number>`count(*)` })
    .from(biddingLogs)
    .where(eq(biddingLogs.accountId, accountId));
  return result[0]?.count || 0;
}

// ==================== Daily Performance Functions ====================
/**
 * v361: UPSERT模式 - 基于唯一约束避免重复插入
 */
export async function createDailyPerformance(perf: InsertDailyPerformance) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(dailyPerformance).values(perf).onDuplicateKeyUpdate({
    set: {
      impressions: sql`VALUES(impressions)`,
      clicks: sql`VALUES(clicks)`,
      spend: sql`VALUES(spend)`,
      sales: sql`VALUES(sales)`,
      orders: sql`VALUES(orders)`,
    },
  });
  return result[0].insertId;
}

export async function getDailyPerformanceByDateRange(
  accountId: number,
  startDate: Date,
  endDate: Date,
  campaignId?: number | string
) {
  const db = await getDb();
  if (!db) return [];
  
  const startDateStr = startDate.toISOString().split('T')[0];
  const endDateStr = endDate.toISOString().split('T')[0];
  const conditions = [
    eq(dailyPerformance.accountId, accountId),
    sql`${dailyPerformance.date} >= ${startDateStr}`,
    sql`${dailyPerformance.date} <= ${endDateStr}`
  ];
  
  if (campaignId) {
    // v208: 入口守卫 — campaignId必须是Amazon ID
    const campaignIdStr = guardCampaignIdParam(campaignId, 'getDailyPerformanceByDateRange');
    conditions.push(eq(dailyPerformance.campaignId, campaignIdStr));
  }
  
  return db.select()
    .from(dailyPerformance)
    .where(and(...conditions))
    .orderBy(dailyPerformance.date);
}

/**
 * 按天聚合绩效数据 - 确保每天只有一条汇总记录
 * 
 * ❗ 重要设计原则：
 * 1. 只汇总 campaign 级别的记录（campaignId IS NOT NULL）
 * 2. 按日期 GROUP BY，确保同一天多个campaign的数据被正确汇总而非重复展示
 * 3. 用于趋势图、日历视图等按天展示的场景
 */
export async function getDailyPerformanceAggregatedByDate(
  accountId: number,
  startDate: Date,
  endDate: Date
) {
  const db = await getDb();
  if (!db) return [];
  
  const startDateStr = startDate.toISOString().split('T')[0];
  const endDateStr = endDate.toISOString().split('T')[0];
  
  return db.select({
    date: sql<string>`DATE(${dailyPerformance.date})`.as('date'),
    totalImpressions: sql<number>`COALESCE(SUM(${dailyPerformance.impressions}), 0)`.as('totalImpressions'),
    totalClicks: sql<number>`COALESCE(SUM(${dailyPerformance.clicks}), 0)`.as('totalClicks'),
    totalSpend: sql<string>`COALESCE(SUM(${dailyPerformance.spend}), '0')`.as('totalSpend'),
    totalSales: sql<string>`COALESCE(SUM(${dailyPerformance.sales}), '0')`.as('totalSales'),
    totalOrders: sql<number>`COALESCE(SUM(${dailyPerformance.orders}), 0)`.as('totalOrders'),
  })
    .from(dailyPerformance)
    .where(and(
      eq(dailyPerformance.accountId, accountId),
      // ✅ 只汇总campaign级别的记录
      sql`${dailyPerformance.campaignId} IS NOT NULL`,
      sql`DATE(${dailyPerformance.date}) >= ${startDateStr}`,
      sql`DATE(${dailyPerformance.date}) <= ${endDateStr}`
    ))
    .groupBy(sql`DATE(${dailyPerformance.date})`)
    .orderBy(sql`DATE(${dailyPerformance.date})`);
}

/**
 * 获取指定账号和日期范围的绩效汇总
 * 
 * ❗ 重要设计原则：
 * 1. 只汇总 campaign 级别的记录（campaignId IS NOT NULL），排除账户级汇总记录，避免双重计算
 * 2. 使用 SUM 汇总曝光/点击/花费/销售额/订单数
 * 3. ACoS/RoAS/CTR/CVR 等派生指标由调用方基于汇总值计算（加权计算）
 */
export async function getPerformanceSummary(accountId: number, startDate: Date, endDate: Date) {
  const db = await getDb();
  if (!db) return null;
  
  const result = await db.select({
    totalImpressions: sql<number>`COALESCE(SUM(impressions), 0)`,
    totalClicks: sql<number>`COALESCE(SUM(clicks), 0)`,
    totalSpend: sql<string>`COALESCE(SUM(spend), '0')`,
    totalSales: sql<string>`COALESCE(SUM(sales), '0')`,
    totalOrders: sql<number>`COALESCE(SUM(orders), 0)`,
    totalConversions: sql<number>`COALESCE(SUM(conversions), 0)`,
  })
    .from(dailyPerformance)
    .where(and(
      eq(dailyPerformance.accountId, accountId),
      // ✅ 只汇总campaign级别的记录，排除账户级汇总记录（campaignId IS NULL）
      sql`${dailyPerformance.campaignId} IS NOT NULL`,
      sql`DATE(${dailyPerformance.date}) >= ${startDate.toISOString().split('T')[0]}`,
      sql`DATE(${dailyPerformance.date}) <= ${endDate.toISOString().split('T')[0]}`
    ));
  
  return result[0];
}

// ==================== AMS Data Functions ====================

/**
 * 获取指定日期和账号的绩效数据
 * 注意：当前dailyPerformance表没有adType字段，按账号+日期查询
 */
export async function getDailyPerformanceByAccountAndDate(
  accountId: number,
  date: string,
  campaignId?: number | string | null
): Promise<DailyPerformance | null> {
  const db = await getDb();
  if (!db) return null;
  
  const conditions = [
    eq(dailyPerformance.accountId, accountId),
    sql`DATE(${dailyPerformance.date}) = ${date}`,
  ];
  
  // v186: dailyPerformance.campaignId在DB中是varchar类型
  if (campaignId !== undefined && campaignId !== null) {
    conditions.push(eq(dailyPerformance.campaignId, String(campaignId)));
  } else {
    conditions.push(sql`${dailyPerformance.campaignId} IS NULL`);
  }
  
  const result = await db.select()
    .from(dailyPerformance)
    .where(and(...conditions))
    .limit(1);
  
  return result[0] || null;
}

/**
 * 从SQS/AMS插入或更新绩效数据
 * 
 * ⚠️ 重要设计原则：使用【覆盖写入】而非累加
 * AMS实时数据流会持续推送同一天的最新快照数据，
 * 每次写入都应该用最新值覆盖旧值，而不是累加。
 * 这确保了无论一天内触发多少次同步，数据始终是准确的。
 * 
 * 不覆盖已被API校准的数据（isFinalized=1），
 * 因为API报告数据经过归因窗口校准，比AMS实时数据更准确。
 */
export async function upsertDailyPerformanceFromAms(data: {
  accountId: number;
  date: string;
  impressions: number;
  clicks: number;
  cost: number;
  adType?: string;  // SP, SB, SD
  campaignId?: number | null;  // 广告活动ID（本地数据库ID）
}): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // === 1. 写入campaign维度的记录（如果有campaignId） ===
  if (data.campaignId) {
    const existingCampaign = await getDailyPerformanceByAccountAndDate(
      data.accountId,
      data.date,
      data.campaignId
    );
    
    if (existingCampaign?.isFinalized) {
      // 已校准的campaign级数据不覆盖
      log.info(`[AMS DB] 跳过已校准campaign数据: ${data.date} campaignId=${data.campaignId}`);
    } else if (existingCampaign) {
      // ✅ 覆盖写入：用AMS最新快照数据直接替换旧值
      await db.update(dailyPerformance)
        .set({
          impressions: data.impressions,
          clicks: data.clicks,
          spend: String(data.cost),
          dataSource: 'ams',
        })
        .where(eq(dailyPerformance.id, existingCampaign.id));
    } else {
      // @ts-ignore
      await db.insert(dailyPerformance).values({
        accountId: data.accountId,
        campaignId: data.campaignId,
        date: data.date,
        impressions: data.impressions,
        clicks: data.clicks,
        spend: String(data.cost),
        sales: '0',
        orders: 0,
        conversions: 0,
        dataSource: 'ams',
        isFinalized: 0,
      } as Record<string, any>);
    }
  }
  
  // === 2. 同时维护账户级别汇总记录（campaignId=NULL） ===
  const existingAccount = await getDailyPerformanceByAccountAndDate(
    data.accountId,
    data.date,
    null
  );
  
  if (existingAccount?.isFinalized) {
    log.info(`[AMS DB] 跳过已校准账户汇总数据: ${data.date} accountId=${data.accountId}`);
    return;
  }
  
  if (existingAccount) {
    // ✅ 覆盖写入：用AMS最新快照数据直接替换旧值
    await db.update(dailyPerformance)
      .set({
        impressions: data.impressions,
        clicks: data.clicks,
        spend: String(data.cost),
        dataSource: 'ams',
      })
      .where(eq(dailyPerformance.id, existingAccount.id));
  } else {
    await db.insert(dailyPerformance).values({
      accountId: data.accountId,
      date: data.date,
      impressions: data.impressions,
      clicks: data.clicks,
      spend: String(data.cost),
      sales: '0',
      orders: 0,
      conversions: 0,
      dataSource: 'ams',
      isFinalized: 0,
    });
  }
}

/**
 * 更新转化数据（销售额和订单数）
 * 
 * ⚠️ 重要设计原则：使用【覆盖写入】而非累加
 * AMS转化数据流推送的是归因窗口内的累计快照值，
 * 每次写入都应用最新值覆盖旧值，避免重复触发导致数据翻倍。
 */
export async function updateDailyPerformanceConversion(data: {
  accountId: number;
  date: string;
  sales: number;
  orders: number;
  adType?: string;  // SP, SB, SD
  campaignId?: number | null;  // 广告活动ID（本地数据库ID）
}): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // === 1. 更新campaign维度的转化数据（如果有campaignId） ===
  if (data.campaignId) {
    const existingCampaign = await getDailyPerformanceByAccountAndDate(
      data.accountId,
      data.date,
      data.campaignId
    );
    
    if (existingCampaign && !existingCampaign.isFinalized) {
      // ✅ 覆盖写入：用AMS最新转化快照直接替换旧值
      await db.update(dailyPerformance)
        .set({
          sales: String(data.sales),
          orders: data.orders,
          dataSource: 'ams',
        })
        .where(eq(dailyPerformance.id, existingCampaign.id));
    }
  }
  
  // === 2. 同时更新账户级别汇总记录 ===
  const existing = await getDailyPerformanceByAccountAndDate(
    data.accountId,
    data.date,
    null
  );
  
  if (existing?.isFinalized) {
    log.info(`[AMS DB] 跳过已校准转化数据: ${data.date} accountId=${data.accountId}`);
    return;
  }
  
  if (existing) {
    // ✅ 覆盖写入：用AMS最新转化快照直接替换旧值
    await db.update(dailyPerformance)
      .set({
        sales: String(data.sales),
        orders: data.orders,
        dataSource: 'ams',
      })
      .where(eq(dailyPerformance.id, existing.id));
  }
}

/**
 * 标记数据为已校准（由API数据覆盖后调用）
 */
export async function markDailyPerformanceAsFinalized(
  accountId: number,
  date: string
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(dailyPerformance)
    .set({
      isFinalized: 1,
      dataSource: 'api',
    })
    .where(and(
      eq(dailyPerformance.accountId, accountId),
      sql`DATE(${dailyPerformance.date}) = ${date}`
    ));
}

/**
 * 删除指定账号和日期范围的绩效数据
 * 用于全量同步前清除旧数据，确保覆盖写入而非累积
 * 
 * @param accountId 账号ID
 * @param startDate 开始日期 (YYYY-MM-DD)
 * @param endDate 结束日期 (YYYY-MM-DD)
 * @returns 删除的记录数
 */
export async function deleteDailyPerformanceByDateRange(
  accountId: number,
  startDate: string,
  endDate: string
): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.delete(dailyPerformance)
    .where(and(
      eq(dailyPerformance.accountId, accountId),
      sql`DATE(${dailyPerformance.date}) >= ${startDate}`,
      sql`DATE(${dailyPerformance.date}) <= ${endDate}`
    ));
  
  // @ts-ignore
  return (result as Record<string, any>[][])[0]?.affectedRows || 0;
}

// ==================== Market Curve Data Functions ====================
export async function upsertMarketCurveData(data: InsertMarketCurveData) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.insert(marketCurveData).values(data).onDuplicateKeyUpdate({
    set: {
      estimatedImpressions: data.estimatedImpressions,
      estimatedClicks: data.estimatedClicks,
      estimatedConversions: data.estimatedConversions,
      estimatedSpend: data.estimatedSpend,
      estimatedSales: data.estimatedSales,
      curveMarginalRevenue: data.curveMarginalRevenue,
      curveMarginalCost: data.curveMarginalCost,
      marginalProfit: data.marginalProfit,
      curveTrafficCeiling: data.curveTrafficCeiling,
      optimalBidPoint: data.optimalBidPoint,
    }
  });
}

export async function getMarketCurveData(targetType: "keyword" | "product_target", targetId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select()
    .from(marketCurveData)
    .where(and(
      eq(marketCurveData.curveTargetType, targetType),
      eq(marketCurveData.curveTargetId, targetId)
    ))
    .orderBy(marketCurveData.bidLevel);
}

// ==================== Import Job Functions ====================
export async function createImportJob(job: InsertImportJob) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(importJobs).values(job);
  return result[0].insertId;
}

export async function getImportJobsByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select()
    .from(importJobs)
    .where(eq(importJobs.userId, userId))
    .orderBy(desc(importJobs.createdAt));
}

export async function updateImportJob(id: number, data: Partial<InsertImportJob>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(importJobs).set(data).where(eq(importJobs.id, id));
}

// ==================== Bulk Operations ====================
/**
 * v361: UPSERT模式 - 基于accountId+campaignId自然唯一键，避免重复插入
 */
export async function bulkCreateCampaigns(campaignsData: InsertCampaign[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  if (campaignsData.length === 0) return;
  // v361: 改为UPSERT，基于accountId+campaignId去重，更新关键字段
  await db.insert(campaigns).values(campaignsData).onDuplicateKeyUpdate({
    set: {
      campaignName: sql`VALUES(campaign_name)`,
      campaignStatus: sql`VALUES(campaign_status)`,
      dailyBudget: sql`VALUES(daily_budget)`,
      updatedAt: sql`NOW()`,
    },
  });
}

/**
 * v361: UPSERT模式 - 基于adGroupId自然唯一键
 */
export async function bulkCreateAdGroups(adGroupsData: InsertAdGroup[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  if (adGroupsData.length === 0) return;
  await db.insert(adGroups).values(adGroupsData).onDuplicateKeyUpdate({
    set: {
      adGroupName: sql`VALUES(ad_group_name)`,
      adGroupStatus: sql`VALUES(ad_group_status)`,
      defaultBid: sql`VALUES(default_bid)`,
      updatedAt: sql`NOW()`,
    },
  });
}

/**
 * v361: UPSERT模式 - 基于keywordId自然唯一键
 */
export async function bulkCreateKeywords(keywordsData: InsertKeyword[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  if (keywordsData.length === 0) return;
  await db.insert(keywords).values(keywordsData).onDuplicateKeyUpdate({
    set: {
      keywordText: sql`VALUES(keyword_text)`,
      matchType: sql`VALUES(match_type)`,
      bid: sql`VALUES(bid)`,
      keywordStatus: sql`VALUES(keyword_status)`,
      updatedAt: sql`NOW()`,
    },
  });
}

/**
 * v361: UPSERT模式 - 基于targetId自然唯一键
 */
export async function bulkCreateProductTargets(targetsData: InsertProductTarget[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  if (targetsData.length === 0) return;
  await db.insert(productTargets).values(targetsData).onDuplicateKeyUpdate({
    set: {
      bid: sql`VALUES(bid)`,
      targetStatus: sql`VALUES(target_status)`,
      updatedAt: sql`NOW()`,
    },
  });
}

/**
 * v361: UPSERT模式 - 基于campaignId+adGroupId+date+targetingType唯一约束
 */
export async function bulkCreateDailyPerformance(perfData: InsertDailyPerformance[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  if (perfData.length === 0) return;
  await db.insert(dailyPerformance).values(perfData).onDuplicateKeyUpdate({
    set: {
      impressions: sql`VALUES(impressions)`,
      clicks: sql`VALUES(clicks)`,
      spend: sql`VALUES(spend)`,
      sales: sql`VALUES(sales)`,
      orders: sql`VALUES(orders)`,
    },
  });
}


// ==================== Amazon API Credentials Functions ====================
import { amazonApiCredentials, InsertAmazonApiCredential, AmazonApiCredential } from "../drizzle/schema";

export async function saveAmazonApiCredentials(data: InsertAmazonApiCredential) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // v345: 凭证加密 — 在写入数据库前加密敏感字段
  const { safeEncrypt } = await import('./utils/cryptoService');
  
  // v342: 保护性更新 - 不用空值覆盖已有的有效值
  const updateSet: Record<string, any> = {
    updatedAt: new Date().toISOString(),
  };
  // 只在新值非空时才更新对应字段
  if (data.clientId && data.clientId !== '' && data.clientId !== '__USE_SERVER_SECRET__') {
    updateSet.clientId = data.clientId;
  }
  if (data.clientSecret && data.clientSecret !== '' && data.clientSecret !== '__USE_SERVER_SECRET__') {
    updateSet.clientSecret = safeEncrypt(data.clientSecret);
  }
  if (data.refreshToken && data.refreshToken !== '') {
    updateSet.refreshToken = safeEncrypt(data.refreshToken);
  }
  if (data.profileId && data.profileId !== '') {
    updateSet.profileId = data.profileId;
  }
  if (data.region) {
    updateSet.region = data.region;
  }
  
  // v345: 加密 insert values 中的敏感字段
  const encryptedData = {
    ...data,
    clientSecret: data.clientSecret ? safeEncrypt(data.clientSecret) : data.clientSecret,
    refreshToken: data.refreshToken ? safeEncrypt(data.refreshToken) : data.refreshToken,
  };
  
  await db.insert(amazonApiCredentials).values(encryptedData).onDuplicateKeyUpdate({
    set: updateSet,
  });
  
  log.info(`[db] v345: saveAmazonApiCredentials 完成 (accountId=${data.accountId}, 更新字段=[${Object.keys(updateSet).filter(k => k !== 'updatedAt').join(',')}], 凭证已加密)`);
}

export async function getAmazonApiCredentials(accountId: number): Promise<AmazonApiCredential | null> {
  const db = await getDb();
  if (!db) return null;
  
  const result = await db.select()
    .from(amazonApiCredentials)
    .where(eq(amazonApiCredentials.accountId, accountId))
    .limit(1);
  
  const row = result[0] || null;
  if (!row) return null;
  
  // v345: 自动解密敏感字段（向后兼容明文数据）
  const { safeDecrypt } = await import('./utils/cryptoService');
  return {
    ...row,
    clientSecret: safeDecrypt(row.clientSecret),
    refreshToken: safeDecrypt(row.refreshToken as string),
  };
}

export async function updateAmazonApiCredentials(accountId: number, data: Partial<InsertAmazonApiCredential>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // v345: 加密敏感字段
  const { safeEncrypt } = await import('./utils/cryptoService');
  const encryptedData: Record<string, any> = { ...data, updatedAt: new Date().toISOString() };
  if (encryptedData.clientSecret) {
    encryptedData.clientSecret = safeEncrypt(encryptedData.clientSecret);
  }
  if (encryptedData.refreshToken) {
    encryptedData.refreshToken = safeEncrypt(encryptedData.refreshToken);
  }
  
  await db.update(amazonApiCredentials)
    .set(encryptedData)
    .where(eq(amazonApiCredentials.accountId, accountId));
}

export async function deleteAmazonApiCredentials(accountId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.delete(amazonApiCredentials)
    .where(eq(amazonApiCredentials.accountId, accountId));
}

export async function updateAmazonApiCredentialsLastSync(accountId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(amazonApiCredentials)
    .set({ lastSyncAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
    .where(eq(amazonApiCredentials.accountId, accountId));
}

/**
 * 更新账户的时区和货币信息
 * 从 Amazon Advertising API 的 GET /v2/profiles 获取
 */
export async function updateAmazonApiCredentialsTimezone(
  accountId: number,
  timezone: string,
  currencyCode: string
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(amazonApiCredentials)
    .set({ 
      timezone,
      currencyCode,
      updatedAt: new Date().toISOString() 
    })
    .where(eq(amazonApiCredentials.accountId, accountId));
}

// ==================== Ad Automation Functions ====================

// 获取搜索词数据用于N-Gram分析 - 使用keywords表的数据
export async function getSearchTermsForAnalysis(accountId: number, _days: number = 30) {
  const db = await getDb();
  if (!db) return [];
  
  // 使用keywords表自带的绩效数据
  const result = await db.select({
    searchTerm: keywords.keywordText,
    clicks: keywords.clicks,
    orders: keywords.orders,
    spend: keywords.spend,
    sales: keywords.sales,
    impressions: keywords.impressions,
  })
  .from(keywords)
  .innerJoin(adGroups, eq(keywords.adGroupId, adGroups.id))
  .innerJoin(campaigns, eq(adGroups.campaignId, campaigns.campaignId))
  .where(eq(campaigns.accountId, accountId));
  
  return result.map(r => ({
    searchTerm: r.searchTerm || '',
    clicks: Number(r.clicks) || 0,
    conversions: Number(r.orders) || 0,
    spend: parseFloat(r.spend || '0'),
    sales: parseFloat(r.sales || '0'),
    impressions: Number(r.impressions) || 0,
  }));
}

// 获取广告活动搜索词数据用于漏斗迁移和冲突检测
export async function getCampaignSearchTerms(accountId: number) {
  const db = await getDb();
  if (!db) return [];
  
  // 使用keywords表自带的绩效数据
  const result = await db.select({
    searchTerm: keywords.keywordText,
    campaignId: campaigns.campaignId,
    campaignName: campaigns.campaignName,
    matchType: keywords.matchType,
    clicks: keywords.clicks,
    spend: keywords.spend,
    sales: keywords.sales,
    orders: keywords.orders,
    bid: keywords.bid,
  })
  .from(keywords)
  .innerJoin(adGroups, eq(keywords.adGroupId, adGroups.id))
  .innerJoin(campaigns, eq(adGroups.campaignId, campaigns.campaignId))
  .where(eq(campaigns.accountId, accountId));
  
  return result.map(r => {
    const clicks = Number(r.clicks) || 0;
    const orders = Number(r.orders) || 0;
    const spend = parseFloat(r.spend || '0');
    const sales = parseFloat(r.sales || '0');
    const roas = spend > 0 ? sales / spend : 0;
    const acos = sales > 0 ? (spend / sales) * 100 : 0;
    const cpc = clicks > 0 ? spend / clicks : 0;
    
    return {
      searchTerm: r.searchTerm || '',
      campaignId: r.campaignId,
      campaignName: r.campaignName || '',
      campaignType: 'sp_manual' as const, // 默认为SP手动广告
      targetingType: 'keyword' as const, // 关键词定位
      matchType: (r.matchType || 'broad') as 'broad' | 'phrase' | 'exact' | 'auto' | 'product',
      clicks,
      conversions: orders,
      spend,
      sales,
      roas,
      acos,
      cpc,
    };
  });
}

// 获取竞价目标数据用于智能竞价分析
export async function getBidTargets(accountId: number) {
  const db = await getDb();
  if (!db) return [];
  
  // 获取关键词目标 - 使用keywords表自带的绩效数据
  const keywordTargets = await db.select({
    id: keywords.id,
    name: keywords.keywordText,
    campaignId: campaigns.campaignId,
    campaignName: campaigns.campaignName,
    currentBid: keywords.bid,
    impressions: keywords.impressions,
    clicks: keywords.clicks,
    spend: keywords.spend,
    sales: keywords.sales,
    orders: keywords.orders,
  })
  .from(keywords)
  .innerJoin(adGroups, eq(keywords.adGroupId, adGroups.id))
  .innerJoin(campaigns, eq(adGroups.campaignId, campaigns.campaignId))
  .where(eq(campaigns.accountId, accountId));
  
  // 获取商品定位目标 - 使用productTargets表自带的绩效数据
  const productTargetResults = await db.select({
    id: productTargets.id,
    name: productTargets.targetValue,
    campaignId: campaigns.campaignId,
    campaignName: campaigns.campaignName,
    currentBid: productTargets.bid,
    impressions: productTargets.impressions,
    clicks: productTargets.clicks,
    spend: productTargets.spend,
    sales: productTargets.sales,
    orders: productTargets.orders,
  })
  .from(productTargets)
  .innerJoin(adGroups, eq(productTargets.adGroupId, adGroups.id))
  .innerJoin(campaigns, eq(adGroups.campaignId, campaigns.campaignId))
  .where(eq(campaigns.accountId, accountId));
  
  const results = [
    ...keywordTargets.map(r => ({
      id: r.id,
      type: 'keyword' as const,
      name: r.name || '',
      campaignId: r.campaignId,
      campaignName: r.campaignName || '',
      currentBid: parseFloat(r.currentBid || '0'),
      impressions: Number(r.impressions) || 0,
      clicks: Number(r.clicks) || 0,
      conversions: Number(r.orders) || 0,
      spend: parseFloat(r.spend || '0'),
      sales: parseFloat(r.sales || '0'),
    })),
    ...productTargetResults.map(r => ({
      id: r.id,
      type: 'product_target' as const,
      name: r.name || '',
      campaignId: r.campaignId,
      campaignName: r.campaignName || '',
      currentBid: parseFloat(r.currentBid || '0'),
      impressions: Number(r.impressions) || 0,
      clicks: Number(r.clicks) || 0,
      conversions: Number(r.orders) || 0,
      spend: parseFloat(r.spend || '0'),
      sales: parseFloat(r.sales || '0'),
    })),
  ];
  
  return results;
}

// 获取唯一搜索词列表用于分类
export async function getUniqueSearchTerms(accountId: number): Promise<string[]> {
  const db = await getDb();
  if (!db) return [];
  
  const result = await db.selectDistinct({
    searchTerm: keywords.keywordText,
  })
  .from(keywords)
  .innerJoin(adGroups, eq(keywords.adGroupId, adGroups.id))
  .innerJoin(campaigns, eq(adGroups.campaignId, campaigns.campaignId))
  .where(eq(campaigns.accountId, accountId));
  
  return result.map(r => r.searchTerm || '').filter(t => t.length > 0);
}

// 添加否定关键词
// addNegativeKeyword函数已移至文件末尾的批量操作扩展部分

// 记录漏斗迁移操作
export async function recordMigration(data: {
  accountId: number;
  searchTerm: string;
  fromCampaignId: number | string;  // v207: Amazon campaignId (varchar)
  toMatchType: 'phrase' | 'exact';
  suggestedBid: number;
  status: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // 记录到bidding_logs
  await db.insert(biddingLogs).values({
    accountId: data.accountId,
    campaignId: guardCampaignIdInsert(data.fromCampaignId, 'biddingLogs'),  // v208: 写入守卫
    logTargetType: 'keyword',
    targetId: 0,
    targetName: data.searchTerm,
    logMatchType: data.toMatchType,
    actionType: 'set',
    previousBid: '0',
    newBid: data.suggestedBid.toString(),
    reason: `漏斗迁移: 升级到${data.toMatchType}匹配`,
  });
}


// ==================== Ad Automation Functions ====================


// ==================== 半月纠错复盘 ====================

export interface BidChangeRecord {
  id: number;
  targetId: number;
  targetName: string;
  targetType: 'keyword' | 'product_target' | 'placement';
  campaignId: number;
  campaignName: string;
  oldBid: number;
  newBid: number;
  changeDate: string;
  changeReason: string;
  performanceAfter?: {
    clicks: number;
    conversions: number;
    spend: number;
    sales: number;
    roas: number;
    acos: number;
  };
}

export async function getBidChangeRecords(accountId: number, days: number): Promise<BidChangeRecord[]> {
  const db = await getDb();
  if (!db) return [];
  
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  
  // 从bidding_logs获取出价变更记录
  const logs = await db.select()
    .from(biddingLogs)
    .where(eq(biddingLogs.accountId, accountId))
    .orderBy(desc(biddingLogs.createdAt))
    .limit(500);
  
  // 转换为BidChangeRecord格式
  const records: BidChangeRecord[] = [];
  for (const bidRecord of logs) {
    if (bidRecord.actionType !== 'increase' && bidRecord.actionType !== 'decrease' && bidRecord.actionType !== 'set') {
      continue;
    }
    
    const oldBid = parseFloat(bidRecord.previousBid || '0');
    const newBid = parseFloat(bidRecord.newBid || '0');
    
    if (oldBid === 0 || newBid === 0) continue;
    
    // v187: 使用真实数据库数据代替模拟数据
    // 从日绩效表获取出价变更后7天的平均绩效
    let performanceAfter = {
      clicks: 0,
      conversions: 0,
      spend: 0,
      sales: 0,
      roas: 0,
      acos: 0,
    };
    try {
      if (bidRecord.campaignId) {
        const changeDate = new Date(bidRecord.createdAt || Date.now());
        const endDate = new Date(changeDate);
        endDate.setDate(endDate.getDate() + 7);
        const perfRows = await db.select()
          .from(dailyPerformance)
          .where(and(
            // @ts-ignore
            eq(dailyPerformance.campaignId, String((log as unknown).campaignId)),
            sql`DATE(${dailyPerformance.date}) >= ${changeDate.toISOString().split('T')[0]}`,
            sql`DATE(${dailyPerformance.date}) <= ${endDate.toISOString().split('T')[0]}`
          ));
        if (perfRows.length > 0) {
          const totalClicks = perfRows.reduce((s: any, r: any) => s + (r.clicks || 0), 0);
          const totalSpend = perfRows.reduce((s: any, r: any) => s + parseFloat(String(r.spend || '0')), 0);
          const totalSales = perfRows.reduce((s: any, r: any) => s + parseFloat(String(r.sales || '0')), 0);
          const totalOrders = perfRows.reduce((s: any, r: any) => s + (r.orders || 0), 0);
          performanceAfter = {
            clicks: totalClicks,
            conversions: totalOrders,
            spend: totalSpend,
            sales: totalSales,
            roas: totalSpend > 0 ? totalSales / totalSpend : 0,
            acos: totalSales > 0 ? (totalSpend / totalSales) * 100 : 0,
          };
        }
      }
    } catch (e) {
      // 查询失败时使用零值，不使用模拟数据
    }
    
    records.push({
      id: bidRecord.id,
      targetId: bidRecord.targetId || 0,
      targetName: bidRecord.targetName || '',
      targetType: bidRecord.logTargetType as 'keyword' | 'product_target' | 'placement',
      // @ts-ignore
      campaignId: bidRecord.campaignId || 0 as unknown,
      campaignName: '',
      oldBid,
      newBid,
      changeDate: bidRecord.createdAt || new Date().toISOString(),
      changeReason: bidRecord.reason || '',
      performanceAfter,
    });
  }
  
  return records;
}

export async function recordBidChange(data: {
  accountId: number;
  targetId: number;
  targetType: 'keyword' | 'product';
  oldBid: number;
  newBid: number;
  reason: string;
  campaignId?: number | string;  // v207: Amazon campaignId (varchar)
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // 将'product'转换为'product_target'以匹配数据库枚举值
  const dbTargetType = data.targetType === 'product' ? 'product_target' : 'keyword';
  
  await db.insert(biddingLogs).values({
    accountId: data.accountId,
    campaignId: data.campaignId ? guardCampaignIdInsert(data.campaignId, 'biddingLogs') : '',  // v208: 写入守卫
    logTargetType: dbTargetType,
    targetId: data.targetId,
    targetName: '',
    logMatchType: 'exact',
    actionType: data.newBid > data.oldBid ? 'increase' : 'decrease',
    previousBid: data.oldBid.toString(),
    newBid: data.newBid.toString(),
    reason: data.reason,
  });
}

// ==================== 广告活动健康度监控 ====================

export interface CampaignHealthMetrics {
  campaignId: number;
  campaignName: string;
  campaignType: 'sp_auto' | 'sp_manual' | 'sb' | 'sd';
  currentMetrics: {
    impressions: number;
    clicks: number;
    spend: number;
    sales: number;
    orders: number;
    ctr: number;
    cvr: number;
    acos: number;
    roas: number;
    cpc: number;
  };
  historicalAverage: {
    impressions: number;
    clicks: number;
    spend: number;
    sales: number;
    orders: number;
    ctr: number;
    cvr: number;
    acos: number;
    roas: number;
    cpc: number;
  };
  changes: {
    impressions: number;
    clicks: number;
    spend: number;
    sales: number;
    orders: number;
    ctr: number;
    cvr: number;
    acos: number;
    roas: number;
    cpc: number;
  };
}

export async function getCampaignHealthMetrics(accountId: number): Promise<CampaignHealthMetrics[]> {
  const db = await getDb();
  if (!db) return [];
  
  // 获取所有广告活动
  const campaignList = await db.select()
    .from(campaigns)
    .where(eq(campaigns.accountId, accountId));
  
  const results: CampaignHealthMetrics[] = [];
  
  for (const campaign of (campaignList as any[])) {
    // 获取最近7天的绩效数据
    const recentPerf = await db.select()
      .from(dailyPerformance)
      .where(eq(dailyPerformance.campaignId, String(campaign.campaignId)))
      .orderBy(desc(dailyPerformance.date))
      .limit(7);
    
    // 获取历史30天的绩效数据
    const historicalPerf = await db.select()
      .from(dailyPerformance)
      .where(eq(dailyPerformance.campaignId, String(campaign.campaignId)))
      .orderBy(desc(dailyPerformance.date))
      .limit(30);
    
    // 计算当前指标（最近7天平均）
    const currentMetrics = calculateAverageMetrics(recentPerf);
    
    // 计算历史平均（30天）
    const historicalAverage = calculateAverageMetrics(historicalPerf);
    
    // 计算变化百分比
    const changes = calculateMetricChanges(currentMetrics, historicalAverage);
    
    results.push({
      // @ts-ignore
      campaignId: campaign.campaignId as string,
      campaignName: campaign.campaignName,
      campaignType: campaign.campaignType as 'sp_auto' | 'sp_manual' | 'sb' | 'sd',
      currentMetrics,
      historicalAverage,
      changes,
    });
  }
  
  return results;
}

function calculateAverageMetrics(perfData: unknown[]): CampaignHealthMetrics['currentMetrics'] {
  if (perfData.length === 0) {
    return {
      impressions: 0,
      clicks: 0,
      spend: 0,
      sales: 0,
      orders: 0,
      ctr: 0,
      cvr: 0,
      acos: 0,
      roas: 0,
      cpc: 0,
    };
  }
  
  const totals = perfData.reduce((acc: any, p: any) => ({
    impressions: acc.impressions + (p.impressions || 0),
    clicks: acc.clicks + (p.clicks || 0),
    spend: acc.spend + parseFloat(p.spend || '0'),
    sales: acc.sales + parseFloat(p.sales || '0'),
    orders: acc.orders + (p.orders || 0),
  }), { impressions: 0, clicks: 0, spend: 0, sales: 0, orders: 0 });
  
  // @ts-ignore
  const ctr = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0;
  // @ts-ignore
  const cvr = totals.clicks > 0 ? (totals.orders / totals.clicks) * 100 : 0;
  // @ts-ignore
  const acos = totals.sales > 0 ? (totals.spend / totals.sales) * 100 : 0;
  // @ts-ignore
  const roas = totals.spend > 0 ? totals.sales / totals.spend : 0;
  // @ts-ignore
  const cpc = totals.clicks > 0 ? totals.spend / totals.clicks : 0;
  
  return {
    // @ts-ignore
    impressions: Math.round(totals.impressions / perfData.length),
    // @ts-ignore
    clicks: Math.round(totals.clicks / perfData.length),
    // @ts-ignore
    spend: totals.spend / perfData.length,
    // @ts-ignore
    sales: totals.sales / perfData.length,
    // @ts-ignore
    orders: Math.round(totals.orders / perfData.length),
    ctr,
    cvr,
    acos,
    roas,
    cpc,
  };
}

function calculateMetricChanges(
  current: CampaignHealthMetrics['currentMetrics'],
  historical: CampaignHealthMetrics['historicalAverage']
): CampaignHealthMetrics['changes'] {
  const calcChange = (curr: number, hist: number) => {
    if (hist === 0) return curr > 0 ? 100 : 0;
    return ((curr - hist) / hist) * 100;
  };
  
  return {
    impressions: calcChange(current.impressions, historical.impressions),
    clicks: calcChange(current.clicks, historical.clicks),
    spend: calcChange(current.spend, historical.spend),
    sales: calcChange(current.sales, historical.sales),
    orders: calcChange(current.orders, historical.orders),
    ctr: calcChange(current.ctr, historical.ctr),
    cvr: calcChange(current.cvr, historical.cvr),
    acos: calcChange(current.acos, historical.acos),
    roas: calcChange(current.roas, historical.roas),
    cpc: calcChange(current.cpc, historical.cpc),
  };
}

// ==================== 批量操作扩展 ====================

export async function addNegativeKeyword(data: {
  campaignId: string | number;
  adGroupId?: number;
  keyword: string;
  matchType: 'phrase' | 'exact';
  level?: 'ad_group' | 'campaign';
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // 记录到negativeKeywords表
  // @ts-ignore
  await db.insert(negativeKeywords).values({
    accountId: 1, // 默认账号
    campaignId: data.campaignId,
    adGroupId: data.adGroupId || null,
    negativeLevel: data.level || (data.adGroupId ? 'ad_group' : 'campaign'),
    negativeType: 'keyword',
    negativeText: data.keyword,
    negativeMatchType: data.matchType === 'phrase' ? 'negative_phrase' : 'negative_exact',
    negativeSource: 'manual',
  } as Record<string, any>);
}


// 获取广告活动的否定关键词列表
export async function getNegativeKeywordsByCampaignId(campaignId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(negativeKeywords).where(eq(negativeKeywords.campaignId, String(campaignId)));
}

// 获取账号的所有否定关键词列表
export async function getNegativeKeywordsByAccountId(accountId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(negativeKeywords).where(eq(negativeKeywords.accountId, accountId));
}

// ==================== Notification Functions ====================

export async function getNotificationSettingsByUserId(userId: number) {
  const db = await getDb();
  if (!db) return null;
  
  const result = await db.select()
    .from(notificationSettings)
    .where(eq(notificationSettings.userId, userId))
    .limit(1);
  
  return result[0] || null;
}

export async function updateNotificationSettingsByUserId(userId: number, data: {
  emailEnabled?: boolean;
  inAppEnabled?: boolean;
  acosThreshold?: number;
  ctrDropThreshold?: number;
  conversionDropThreshold?: number;
  spendSpikeThreshold?: number;
  frequency?: 'immediate' | 'hourly' | 'daily' | 'weekly';
  quietHoursStart?: number;
  quietHoursEnd?: number;
}) {
  const db = await getDb();
  if (!db) return;
  
  const existing = await getNotificationSettingsByUserId(userId);
  
  if (existing) {
    const updateData: Record<string, any> = { updatedAt: new Date() };
    if (data.emailEnabled !== undefined) updateData.emailEnabled = data.emailEnabled;
    if (data.inAppEnabled !== undefined) updateData.inAppEnabled = data.inAppEnabled;
    if (data.acosThreshold !== undefined) updateData.acosThreshold = String(data.acosThreshold);
    if (data.ctrDropThreshold !== undefined) updateData.ctrDropThreshold = String(data.ctrDropThreshold);
    if (data.conversionDropThreshold !== undefined) updateData.conversionDropThreshold = String(data.conversionDropThreshold);
    if (data.spendSpikeThreshold !== undefined) updateData.spendSpikeThreshold = String(data.spendSpikeThreshold);
    if (data.frequency !== undefined) updateData.frequency = data.frequency;
    if (data.quietHoursStart !== undefined) updateData.quietHoursStart = data.quietHoursStart;
    if (data.quietHoursEnd !== undefined) updateData.quietHoursEnd = data.quietHoursEnd;
    
    await db.update(notificationSettings)
      .set(updateData)
      .where(eq(notificationSettings.id, existing.id));
  } else {
    await db.insert(notificationSettings).values({
      userId,
      emailEnabled: data.emailEnabled ? 1 : 0,
      inAppEnabled: data.inAppEnabled ? 1 : 0,
      acosThreshold: data.acosThreshold !== undefined ? String(data.acosThreshold) : '50.00',
      ctrDropThreshold: data.ctrDropThreshold !== undefined ? String(data.ctrDropThreshold) : '30.00',
      conversionDropThreshold: data.conversionDropThreshold !== undefined ? String(data.conversionDropThreshold) : '30.00',
      spendSpikeThreshold: data.spendSpikeThreshold !== undefined ? String(data.spendSpikeThreshold) : '50.00',
      frequency: data.frequency ?? 'daily',
      quietHoursStart: data.quietHoursStart ?? 22,
      quietHoursEnd: data.quietHoursEnd ?? 8,
    });
  }
}

export async function getNotificationHistoryByUserId(userId: number, limit: number = 50) {
  const db = await getDb();
  if (!db) return [];
  
  const result = await db.select()
    .from(notificationHistory)
    .where(eq(notificationHistory.userId, userId))
    .orderBy(desc(notificationHistory.createdAt))
    .limit(limit);
  
  return result;
}

export async function createNotificationRecord(data: {
  userId: number;
  accountId?: number;
  type: 'alert' | 'report' | 'system';
  severity?: 'info' | 'warning' | 'critical';
  title: string;
  message: string;
  channel?: 'email' | 'in_app' | 'both';
  relatedEntityType?: string;
  relatedEntityId?: number;
}) {
  const db = await getDb();
  if (!db) return;
  
  await db.insert(notificationHistory).values({
    userId: data.userId,
    accountId: data.accountId || null,
    type: data.type,
    severity: data.severity ?? 'info',
    title: data.title,
    message: data.message,
    channel: data.channel ?? 'in_app',
    status: 'pending',
    relatedEntityType: data.relatedEntityType || null,
    relatedEntityId: data.relatedEntityId || null,
  });
}

export async function markNotificationAsRead(notificationId: number) {
  const db = await getDb();
  if (!db) return;
  
  await db.update(notificationHistory)
    .set({ status: 'read', readAt: new Date().toISOString() })
    .where(eq(notificationHistory.id, notificationId));
}

// ==================== Scheduler Functions ====================

export async function getScheduledTasksByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];
  
  const result = await db.select()
    .from(scheduledTasks)
    .where(eq(scheduledTasks.userId, userId))
    .orderBy(scheduledTasks.createdAt);
  
  return result;
}

export async function getScheduledTaskById(id: number) {
  const db = await getDb();
  if (!db) return null;
  
  const result = await db.select()
    .from(scheduledTasks)
    .where(eq(scheduledTasks.id, id))
    .limit(1);
  
  return result[0] || null;
}

export async function createScheduledTask(data: {
  userId: number;
  accountId?: number;
  taskType: 'ngram_analysis' | 'funnel_migration' | 'traffic_conflict' | 'smart_bidding' | 'health_check' | 'data_sync' | 'traffic_isolation_full';
  name: string;
  description?: string;
  schedule?: 'hourly' | 'daily' | 'weekly' | 'monthly';
  runTime?: string;
  dayOfWeek?: number;
  dayOfMonth?: number;
  enabled?: boolean;
  autoApply?: boolean;
  requireApproval?: boolean;
  parameters?: Record<string, any>;
}) {
  const db = await getDb();
  if (!db) return 0;
  
  const result = await db.insert(scheduledTasks).values({
    userId: data.userId,
    accountId: data.accountId || null,
    taskType: data.taskType,
    name: data.name,
    description: data.description || null,
    schedule: data.schedule ?? 'daily',
    runTime: data.runTime ?? '06:00',
    dayOfWeek: data.dayOfWeek || null,
    dayOfMonth: data.dayOfMonth || null,
    enabled: data.enabled ? 1 : 0,
    autoApply: data.autoApply ? 1 : 0,
    requireApproval: data.requireApproval !== false ? 1 : 0,
    parameters: data.parameters ? JSON.stringify(data.parameters) : null,
  });
  
  return result[0]?.insertId || 0;
}

export async function updateScheduledTask(id: number, data: {
  name?: string;
  description?: string;
  schedule?: 'hourly' | 'daily' | 'weekly' | 'monthly';
  runTime?: string;
  dayOfWeek?: number;
  dayOfMonth?: number;
  enabled?: boolean;
  autoApply?: boolean;
  requireApproval?: boolean;
  parameters?: Record<string, any>;
}) {
  const db = await getDb();
  if (!db) return;
  
  const updateData: Record<string, any> = { updatedAt: new Date() };
  if (data.name !== undefined) updateData.name = data.name;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.schedule !== undefined) updateData.schedule = data.schedule;
  if (data.runTime !== undefined) updateData.runTime = data.runTime;
  if (data.dayOfWeek !== undefined) updateData.dayOfWeek = data.dayOfWeek;
  if (data.dayOfMonth !== undefined) updateData.dayOfMonth = data.dayOfMonth;
  if (data.enabled !== undefined) updateData.enabled = data.enabled;
  if (data.autoApply !== undefined) updateData.autoApply = data.autoApply;
  if (data.requireApproval !== undefined) updateData.requireApproval = data.requireApproval;
  if (data.parameters !== undefined) updateData.parameters = JSON.stringify(data.parameters);
  
  await db.update(scheduledTasks)
    .set(updateData)
    .where(eq(scheduledTasks.id, id));
}

export async function deleteScheduledTask(id: number) {
  const db = await getDb();
  if (!db) return;
  
  await db.delete(scheduledTasks).where(eq(scheduledTasks.id, id));
}

export async function recordTaskExecution(data: {
  taskId: number;
  userId: number;
  accountId?: number;
  taskType: string;
  status: 'running' | 'success' | 'failed' | 'cancelled';
  startedAt: Date | string;
  completedAt?: Date;
  duration?: number;
  itemsProcessed?: number;
  suggestionsGenerated?: number;
  suggestionsApplied?: number;
  errorMessage?: string;
  resultSummary?: Record<string, any>;
}) {
  const db = await getDb();
  if (!db) return;
  
  await db.insert(taskExecutionLog).values({
    taskId: data.taskId,
    userId: data.userId,
    accountId: data.accountId || null,
    taskType: data.taskType,
    status: data.status,
    startedAt: typeof data.startedAt === 'string' ? data.startedAt : data.startedAt.toISOString(),
    completedAt: data.completedAt ? (typeof data.completedAt === 'string' ? data.completedAt : data.completedAt.toISOString()) : null,
    duration: data.duration || null,
    itemsProcessed: data.itemsProcessed ?? 0,
    suggestionsGenerated: data.suggestionsGenerated ?? 0,
    suggestionsApplied: data.suggestionsApplied ?? 0,
    errorMessage: data.errorMessage || null,
    resultSummary: data.resultSummary ? JSON.stringify(data.resultSummary) : null,
  });
  
  // Update last run time on the task
  // Map 'cancelled' to 'failed' for lastRunStatus since schema only supports success/failed/running/skipped
  const mappedStatus = data.status === 'cancelled' ? 'failed' : data.status;
  await db.update(scheduledTasks)
    .set({ 
      lastRunAt: typeof data.startedAt === 'string' ? data.startedAt : new Date(data.startedAt).toISOString(), 
      lastRunStatus: mappedStatus as 'success' | 'failed' | 'running' | 'skipped',
      updatedAt: new Date().toISOString() 
    })
    .where(eq(scheduledTasks.id, data.taskId));
}

export async function getTaskExecutionHistory(taskId: number, limit: number = 20) {
  const db = await getDb();
  if (!db) return [];
  
  const result = await db.select()
    .from(taskExecutionLog)
    .where(eq(taskExecutionLog.taskId, taskId))
    .orderBy(desc(taskExecutionLog.startedAt))
    .limit(limit);
  
  return result;
}


// ==================== Batch Operations Functions ====================

// Create a new batch operation
export async function createBatchOperation(data: {
  userId: number;
  accountId?: number;
  operationType: 'negative_keyword' | 'bid_adjustment' | 'keyword_migration' | 'campaign_status';
  name: string;
  description?: string;
  requiresApproval?: boolean;
  sourceType?: string;
  sourceTaskId?: number;
}): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(batchOperations).values({
    userId: data.userId,
    accountId: data.accountId || null,
    operationType: data.operationType,
    name: data.name,
    description: data.description || null,
    requiresApproval: data.requiresApproval !== false ? 1 : 0,
    sourceType: data.sourceType || null,
    sourceTaskId: data.sourceTaskId || null,
    batchStatus: 'pending',
    totalItems: 0,
    processedItems: 0,
    successItems: 0,
    failedItems: 0,
  });
  
  return result[0].insertId;
}

// Add items to a batch operation
export async function addBatchOperationItems(batchId: number, items: Array<{
  entityType: 'keyword' | 'product_target' | 'campaign' | 'ad_group';
  entityId: number;
  entityName?: string;
  negativeKeyword?: string;
  negativeMatchType?: 'negative_phrase' | 'negative_exact';
  negativeLevel?: 'ad_group' | 'campaign';
  currentBid?: number;
  newBid?: number;
  bidChangeReason?: string;
  previousValue?: string;
}>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // Insert items
  for (const item of items) {
    const bidChangePercent = item.currentBid && item.newBid 
      ? ((item.newBid - item.currentBid) / item.currentBid * 100)
      : null;
      
    await db.insert(batchOperationItems).values({
      batchId,
      entityType: item.entityType,
      entityId: item.entityId,
      entityName: item.entityName || null,
      negativeKeyword: item.negativeKeyword || null,
      negativeMatchType: item.negativeMatchType || null,
      negativeLevel: item.negativeLevel || null,
      currentBid: item.currentBid?.toString() || null,
      newBid: item.newBid?.toString() || null,
      bidChangePercent: bidChangePercent?.toFixed(2) || null,
      bidChangeReason: item.bidChangeReason || null,
      previousValue: item.previousValue || null,
      itemStatus: 'pending',
    });
  }
  
  // Update total count
  await db.update(batchOperations)
    .set({ totalItems: items.length })
    .where(eq(batchOperations.id, batchId));
}

// Get batch operation by ID
export async function getBatchOperation(id: number): Promise<BatchOperation | null> {
  const db = await getDb();
  if (!db) return null;
  
  const result = await db.select()
    .from(batchOperations)
    .where(eq(batchOperations.id, id))
    .limit(1);
  
  return result[0] || null;
}

// Get batch operation items
export async function getBatchOperationItems(batchId: number): Promise<BatchOperationItem[]> {
  const db = await getDb();
  if (!db) return [];
  
  return await db.select()
    .from(batchOperationItems)
    .where(eq(batchOperationItems.batchId, batchId));
}

// List batch operations for a user
export async function listBatchOperations(userId: number, options?: {
  accountId?: number;
  status?: string;
  operationType?: string;
  limit?: number;
  offset?: number;
}): Promise<BatchOperation[]> {
  const db = await getDb();
  if (!db) return [];
  
  let query = db.select()
    .from(batchOperations)
    .where(eq(batchOperations.userId, userId))
    .orderBy(desc(batchOperations.createdAt))
    .limit(options?.limit || 50);
  
  return await query;
}

// Approve batch operation
export async function approveBatchOperation(id: number, approvedBy: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(batchOperations)
    .set({
      batchStatus: 'approved',
      approvedBy,
      approvedAt: new Date().toISOString(),
    })
    .where(eq(batchOperations.id, id));
}

// Update batch operation status
export async function updateBatchOperationStatus(id: number, data: {
  status: 'pending' | 'approved' | 'executing' | 'completed' | 'failed' | 'cancelled' | 'rolled_back';
  processedItems?: number;
  successItems?: number;
  failedItems?: number;
  executedBy?: number;
  executedAt?: Date;
  completedAt?: Date;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const updateData: Record<string, any> = { batchStatus: data.status };
  if (data.processedItems !== undefined) updateData.processedItems = data.processedItems;
  if (data.successItems !== undefined) updateData.successItems = data.successItems;
  if (data.failedItems !== undefined) updateData.failedItems = data.failedItems;
  if (data.executedBy !== undefined) updateData.executedBy = data.executedBy;
  if (data.executedAt !== undefined) updateData.executedAt = data.executedAt;
  if (data.completedAt !== undefined) updateData.completedAt = data.completedAt;
  
  await db.update(batchOperations)
    .set(updateData)
    .where(eq(batchOperations.id, id));
}

// Update batch operation item status
export async function updateBatchOperationItemStatus(itemId: number, data: {
  status: 'pending' | 'success' | 'failed' | 'skipped' | 'rolled_back';
  errorMessage?: string;
  executedAt?: Date;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(batchOperationItems)
    .set({
      itemStatus: data.status,
      errorMessage: data.errorMessage || null,
      itemExecutedAt: data.executedAt?.toISOString() || new Date().toISOString(),
    })
    .where(eq(batchOperationItems.id, itemId));
}

// Rollback batch operation
export async function rollbackBatchOperation(id: number, rolledBackBy: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(batchOperations)
    .set({
      batchStatus: 'rolled_back',
      rolledBackBy,
      rolledBackAt: new Date().toISOString(),
    })
    .where(eq(batchOperations.id, id));
}

// ==================== Attribution Correction Functions ====================

// Create correction review session
export async function createCorrectionReviewSession(data: {
  userId: number;
  accountId: number;
  periodStart: Date;
  periodEnd: Date;
}): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(correctionReviewSessions).values({
    userId: data.userId,
    accountId: data.accountId,
    periodStart: data.periodStart.toISOString(),
    periodEnd: data.periodEnd.toISOString(),
    sessionStatus: 'analyzing',
    totalAdjustmentsReviewed: 0,
    incorrectAdjustments: 0,
    overDecreasedCount: 0,
    overIncreasedCount: 0,
    correctCount: 0,
  });
  
  return result[0].insertId;
}

// Add attribution correction record
export async function addAttributionCorrectionRecord(data: {
  userId: number;
  accountId: number;
  biddingLogId: number;
  campaignId: number;
  targetType: 'keyword' | 'product_target';
  targetId: number;
  targetName?: string;
  originalAdjustmentDate: Date | string;
  originalBid: number;
  adjustedBid: number;
  adjustmentReason?: string;
  metricsAtAdjustment?: Record<string, any>;
  metricsAfterAttribution?: Record<string, any>;
  wasIncorrect?: boolean;
  correctionType?: 'over_decreased' | 'over_increased' | 'correct';
  suggestedBid?: number;
  confidenceScore?: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // @ts-ignore
  await db.insert(attributionCorrectionRecords).values({
    userId: data.userId,
    accountId: data.accountId,
    biddingLogId: data.biddingLogId,
    campaignId: data.campaignId,
    correctionTargetType: data.targetType,
    targetId: data.targetId,
    targetName: data.targetName || null,
    originalAdjustmentDate: typeof data.originalAdjustmentDate === 'string' 
      ? data.originalAdjustmentDate 
      : data.originalAdjustmentDate.toISOString().slice(0, 19).replace('T', ' '),
    originalBid: data.originalBid.toString(),
    adjustedBid: data.adjustedBid.toString(),
    adjustmentReason: data.adjustmentReason || null,
    metricsAtAdjustment: data.metricsAtAdjustment ? JSON.stringify(data.metricsAtAdjustment) : null,
    metricsAfterAttribution: data.metricsAfterAttribution ? JSON.stringify(data.metricsAfterAttribution) : null,
    wasIncorrect: data.wasIncorrect ? 1 : 0,
    correctionType: data.correctionType || null,
    suggestedBid: data.suggestedBid?.toString() || null,
    confidenceScore: data.confidenceScore?.toString() || null,
    correctionStatus: 'pending_review',
  } as Record<string, any>);
}

// Get correction review session
export async function getCorrectionReviewSession(id: number): Promise<CorrectionReviewSession | null> {
  const db = await getDb();
  if (!db) return null;
  
  const result = await db.select()
    .from(correctionReviewSessions)
    .where(eq(correctionReviewSessions.id, id))
    .limit(1);
  
  return result[0] || null;
}

// List correction review sessions
export async function listCorrectionReviewSessions(userId: number, accountId?: number): Promise<CorrectionReviewSession[]> {
  const db = await getDb();
  if (!db) return [];
  
  let conditions = [eq(correctionReviewSessions.userId, userId)];
  if (accountId) {
    conditions.push(eq(correctionReviewSessions.accountId, accountId));
  }
  
  return await db.select()
    .from(correctionReviewSessions)
    .where(and(...conditions))
    .orderBy(desc(correctionReviewSessions.createdAt))
    .limit(50);
}

// Get correction records for a session
export async function getCorrectionRecordsForSession(sessionId: number): Promise<AttributionCorrectionRecord[]> {
  const db = await getDb();
  if (!db) return [];
  
  // Get session to find the period
  const session = await getCorrectionReviewSession(sessionId);
  if (!session) return [];
  
  return await db.select()
    .from(attributionCorrectionRecords)
    .where(and(
      eq(attributionCorrectionRecords.userId, session.userId),
      eq(attributionCorrectionRecords.accountId, session.accountId)
    ))
    .orderBy(desc(attributionCorrectionRecords.originalAdjustmentDate));
}

// Update correction review session
export async function updateCorrectionReviewSession(id: number, data: {
  status?: 'analyzing' | 'ready_for_review' | 'reviewed' | 'corrections_applied';
  totalAdjustmentsReviewed?: number;
  incorrectAdjustments?: number;
  overDecreasedCount?: number;
  overIncreasedCount?: number;
  correctCount?: number;
  estimatedLostRevenue?: number;
  estimatedWastedSpend?: number;
  potentialRecovery?: number;
  reviewedAt?: Date;
  reviewedBy?: number;
  correctionBatchId?: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const updateData: Record<string, any> = {};
  if (data.status !== undefined) updateData.status = data.status;
  if (data.totalAdjustmentsReviewed !== undefined) updateData.totalAdjustmentsReviewed = data.totalAdjustmentsReviewed;
  if (data.incorrectAdjustments !== undefined) updateData.incorrectAdjustments = data.incorrectAdjustments;
  if (data.overDecreasedCount !== undefined) updateData.overDecreasedCount = data.overDecreasedCount;
  if (data.overIncreasedCount !== undefined) updateData.overIncreasedCount = data.overIncreasedCount;
  if (data.correctCount !== undefined) updateData.correctCount = data.correctCount;
  if (data.estimatedLostRevenue !== undefined) updateData.estimatedLostRevenue = data.estimatedLostRevenue.toString();
  if (data.estimatedWastedSpend !== undefined) updateData.estimatedWastedSpend = data.estimatedWastedSpend.toString();
  if (data.potentialRecovery !== undefined) updateData.potentialRecovery = data.potentialRecovery.toString();
  if (data.reviewedAt !== undefined) updateData.reviewedAt = data.reviewedAt;
  if (data.reviewedBy !== undefined) updateData.reviewedBy = data.reviewedBy;
  if (data.correctionBatchId !== undefined) updateData.correctionBatchId = data.correctionBatchId;
  
  await db.update(correctionReviewSessions)
    .set(updateData)
    .where(eq(correctionReviewSessions.id, id));
}

// Update attribution correction record status
export async function updateAttributionCorrectionStatus(id: number, data: {
  status: 'pending_review' | 'approved' | 'applied' | 'dismissed';
  appliedAt?: Date;
  appliedBy?: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(attributionCorrectionRecords)
    .set({
      correctionStatus: data.status,
      appliedAt: data.appliedAt?.toISOString() || null,
      appliedBy: data.appliedBy || null,
    })
    .where(eq(attributionCorrectionRecords.id, id));
}


// ==================== Team Member Functions ====================

export async function createTeamMember(data: InsertTeamMember): Promise<TeamMember | null> {
  const db = await getDb();
  if (!db) return null;
  
  const result = await db.insert(teamMembers).values(data);
  const insertId = result[0].insertId;
  const [member] = await db.select().from(teamMembers).where(eq(teamMembers.id, insertId));
  return member || null;
}

export async function getTeamMembersByOwner(ownerId: number): Promise<TeamMember[]> {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(teamMembers)
    .where(eq(teamMembers.ownerId, ownerId))
    .orderBy(desc(teamMembers.createdAt));
}

export async function getTeamMemberById(id: number): Promise<TeamMember | null> {
  const db = await getDb();
  if (!db) return null;
  
  const [member] = await db.select().from(teamMembers).where(eq(teamMembers.id, id));
  return member || null;
}

export async function getTeamMemberByToken(token: string): Promise<TeamMember | null> {
  const db = await getDb();
  if (!db) return null;
  
  const [member] = await db.select().from(teamMembers)
    .where(eq(teamMembers.inviteToken, token));
  return member || null;
}

export async function getTeamMemberByEmail(ownerId: number, email: string): Promise<TeamMember | null> {
  const db = await getDb();
  if (!db) return null;
  
  const [member] = await db.select().from(teamMembers)
    .where(and(eq(teamMembers.ownerId, ownerId), eq(teamMembers.email, email)));
  return member || null;
}

export async function updateTeamMember(id: number, data: Partial<InsertTeamMember>): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  
  await db.update(teamMembers).set(data).where(eq(teamMembers.id, id));
  return true;
}

export async function deleteTeamMember(id: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  
  // 同时删除该成员的所有权限
  await db.delete(accountPermissions).where(eq(accountPermissions.teamMemberId, id));
  await db.delete(teamMembers).where(eq(teamMembers.id, id));
  return true;
}

export async function getTeamMembershipsForUser(userId: number): Promise<TeamMember[]> {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(teamMembers)
    .where(and(eq(teamMembers.memberId, userId), eq(teamMembers.status, "active")));
}

// ==================== Account Permission Functions ====================

export async function createAccountPermission(data: InsertAccountPermission): Promise<AccountPermission | null> {
  const db = await getDb();
  if (!db) return null;
  
  const result = await db.insert(accountPermissions).values(data);
  const insertId = result[0].insertId;
  const [permission] = await db.select().from(accountPermissions).where(eq(accountPermissions.id, insertId));
  return permission || null;
}

export async function getPermissionsByTeamMember(teamMemberId: number): Promise<AccountPermission[]> {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(accountPermissions)
    .where(eq(accountPermissions.teamMemberId, teamMemberId));
}

export async function getPermissionsByAccount(accountId: number): Promise<AccountPermission[]> {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(accountPermissions)
    .where(eq(accountPermissions.accountId, accountId));
}

export async function getPermission(teamMemberId: number, accountId: number): Promise<AccountPermission | null> {
  const db = await getDb();
  if (!db) return null;
  
  const [permission] = await db.select().from(accountPermissions)
    .where(and(
      eq(accountPermissions.teamMemberId, teamMemberId),
      eq(accountPermissions.accountId, accountId)
    ));
  return permission || null;
}

export async function updateAccountPermission(id: number, data: Partial<InsertAccountPermission>): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  
  await db.update(accountPermissions).set(data).where(eq(accountPermissions.id, id));
  return true;
}

export async function deleteAccountPermission(id: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  
  await db.delete(accountPermissions).where(eq(accountPermissions.id, id));
  return true;
}

export async function deletePermissionsByTeamMember(teamMemberId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  
  await db.delete(accountPermissions).where(eq(accountPermissions.teamMemberId, teamMemberId));
  return true;
}

export async function setAccountPermissions(teamMemberId: number, permissions: Array<{ accountId: number; permissionLevel: "full" | "edit" | "view"; canExport?: boolean; canManageCampaigns?: boolean; canAdjustBids?: boolean; canManageNegatives?: boolean }>): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  
  // 删除现有权限
  await db.delete(accountPermissions).where(eq(accountPermissions.teamMemberId, teamMemberId));
  
  // 添加新权限
  if (permissions.length > 0) {
    await db.insert(accountPermissions).values(
      permissions.map(p => ({
        teamMemberId,
        accountId: p.accountId,
        permissionLevel: p.permissionLevel,
        canExport: (p.canExport ?? true) ? 1 : 0,
        canManageCampaigns: (p.canManageCampaigns ?? (p.permissionLevel !== "view")) ? 1 : 0,
        canAdjustBids: (p.canAdjustBids ?? (p.permissionLevel !== "view")) ? 1 : 0,
        canManageNegatives: (p.canManageNegatives ?? (p.permissionLevel !== "view")) ? 1 : 0,
      }))
    );
  }
  
  return true;
}

// ==================== Email Report Subscription Functions ====================

export async function createEmailSubscription(data: InsertEmailReportSubscription): Promise<EmailReportSubscription | null> {
  const db = await getDb();
  if (!db) return null;
  
  const result = await db.insert(emailReportSubscriptions).values(data);
  const insertId = result[0].insertId;
  const [subscription] = await db.select().from(emailReportSubscriptions).where(eq(emailReportSubscriptions.id, insertId));
  return subscription || null;
}

export async function getEmailSubscriptionsByUser(userId: number): Promise<EmailReportSubscription[]> {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(emailReportSubscriptions)
    .where(eq(emailReportSubscriptions.userId, userId))
    .orderBy(desc(emailReportSubscriptions.createdAt));
}

export async function getEmailSubscriptionById(id: number): Promise<EmailReportSubscription | null> {
  const db = await getDb();
  if (!db) return null;
  
  const [subscription] = await db.select().from(emailReportSubscriptions).where(eq(emailReportSubscriptions.id, id));
  return subscription || null;
}

export async function getActiveEmailSubscriptions(): Promise<EmailReportSubscription[]> {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(emailReportSubscriptions)
    .where(eq(emailReportSubscriptions.isActive, 1));
}

export async function getDueEmailSubscriptions(): Promise<EmailReportSubscription[]> {
  const db = await getDb();
  if (!db) return [];
  
  const now = new Date();
  return db.select().from(emailReportSubscriptions)
    .where(and(
      eq(emailReportSubscriptions.isActive, 1),
      sql`${emailReportSubscriptions.nextSendAt} <= ${now.toISOString()}`
    ));
}

export async function updateEmailSubscription(id: number, data: Partial<InsertEmailReportSubscription>): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  
  await db.update(emailReportSubscriptions).set(data).where(eq(emailReportSubscriptions.id, id));
  return true;
}

export async function deleteEmailSubscription(id: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  
  await db.delete(emailReportSubscriptions).where(eq(emailReportSubscriptions.id, id));
  return true;
}

// ==================== Email Send Log Functions ====================

export async function createEmailSendLog(data: InsertEmailSendLog): Promise<EmailSendLog | null> {
  const db = await getDb();
  if (!db) return null;
  
  const result = await db.insert(emailSendLogs).values(data);
  const insertId = result[0].insertId;
  const [log] = await db.select().from(emailSendLogs).where(eq(emailSendLogs.id, insertId));
  return log || null;
}

export async function getEmailSendLogsBySubscription(subscriptionId: number, limit = 20): Promise<EmailSendLog[]> {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(emailSendLogs)
    .where(eq(emailSendLogs.subscriptionId, subscriptionId))
    .orderBy(desc(emailSendLogs.sentAt))
    .limit(limit);
}

export async function getRecentEmailSendLogs(userId: number, limit = 50): Promise<EmailSendLog[]> {
  const db = await getDb();
  if (!db) return [];
  
  // 获取用户的所有订阅ID
  const subscriptions = await db.select({ id: emailReportSubscriptions.id })
    .from(emailReportSubscriptions)
    .where(eq(emailReportSubscriptions.userId, userId));
  
  if (subscriptions.length === 0) return [];
  
  const subscriptionIds = subscriptions.map(s => s.id);
  
  return db.select().from(emailSendLogs)
    .where(sql`${emailSendLogs.subscriptionId} IN (${sql.join(subscriptionIds.map(id => sql`${id}`), sql`, `)})`)
    .orderBy(desc(emailSendLogs.sentAt))
    .limit(limit);
}


// ==================== Search Terms Functions ====================
export async function getSearchTermsByCampaignId(campaignId: number) {
  const db = await getDb();
  if (!db) return [];
  
  // v208: 入口守卫 — campaignId必须是Amazon ID
  const campaignIdStr = guardCampaignIdParam(campaignId, 'getSearchTermsByCampaignId');
  return db.select().from(searchTerms).where(eq(searchTerms.campaignId, campaignIdStr));
}

// v357: adGroupId参数类型改为string | number
export async function getSearchTermsByAdGroupId(adGroupId: number | string) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(searchTerms).where(eq(searchTerms.adGroupId, String(adGroupId)));
}

export async function createSearchTerm(data: InsertSearchTerm) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(searchTerms).values(data);
  return result[0].insertId;
}

/**
 * v361: UPSERT模式 - 避免搜索词重复插入
 */
export async function bulkCreateSearchTerms(data: InsertSearchTerm[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  if (data.length === 0) return;
  await db.insert(searchTerms).values(data).onDuplicateKeyUpdate({
    set: {
      impressions: sql`VALUES(impressions)`,
      clicks: sql`VALUES(clicks)`,
      spend: sql`VALUES(spend)`,
      sales: sql`VALUES(sales)`,
      orders: sql`VALUES(orders)`,
    },
  });
}

// ==================== Campaign Detail Functions ====================
export async function getCampaignDetailWithStats(campaignId: number) {
  const db = await getDb();
  if (!db) return null;
  
  // 获取广告活动基本信息
  const campaign = await db.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
  if (!campaign[0]) return null;
  
  // 获取广告组列表
  const adGroupList = await db.select().from(adGroups).where(eq(adGroups.campaignId, String(campaignId)));
  
  // 获取广告组ID列表
  const adGroupIds = adGroupList.map(ag => ag.id);
  
  // 获取所有关键词
  let keywordList: Keyword[] = [];
  if (adGroupIds.length > 0) {
    keywordList = await db.select().from(keywords)
      .where(sql`${keywords.adGroupId} IN (${sql.join(adGroupIds.map(id => sql`${id}`), sql`, `)})`);
  }
  
  // 获取所有商品定向
  let productTargetList: ProductTarget[] = [];
  if (adGroupIds.length > 0) {
    productTargetList = await db.select().from(productTargets)
      .where(sql`${productTargets.adGroupId} IN (${sql.join(adGroupIds.map(id => sql`${id}`), sql`, `)})`);
  }
  
  // 获取搜索词报告
  const searchTermList = await db.select().from(searchTerms).where(eq(searchTerms.campaignId, String(campaignId)));
  
  return {
    campaign: campaign[0],
    adGroups: adGroupList,
    keywords: keywordList,
    productTargets: productTargetList,
    searchTerms: searchTermList,
  };
}

// 获取广告活动的广告位表现数据
export async function getCampaignPlacementStats(campaignId: number) {
  const db = await getDb();
  if (!db) return [];
  
  const campaign = await db.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
  if (!campaign[0]) return [];
  
  // 返回广告位数据（从campaigns表的placement字段获取）
  const placementData = [
    {
      placement: "top_of_search",
      placementLabel: "搜索结果顶部",
      bidAdjustment: campaign[0].placementTopSearchBidAdjustment || 0,
      // 模拟数据，实际应从daily_performance或专门的placement表获取
      impressions: Math.floor((campaign[0].impressions || 0) * 0.3),
      clicks: Math.floor((campaign[0].clicks || 0) * 0.35),
      spend: parseFloat(campaign[0].spend || "0") * 0.35,
      sales: parseFloat(campaign[0].sales || "0") * 0.4,
      orders: Math.floor((campaign[0].orders || 0) * 0.4),
    },
    {
      placement: "product_page",
      placementLabel: "商品页面",
      bidAdjustment: campaign[0].placementProductPageBidAdjustment || 0,
      impressions: Math.floor((campaign[0].impressions || 0) * 0.5),
      clicks: Math.floor((campaign[0].clicks || 0) * 0.45),
      spend: parseFloat(campaign[0].spend || "0") * 0.45,
      sales: parseFloat(campaign[0].sales || "0") * 0.4,
      orders: Math.floor((campaign[0].orders || 0) * 0.4),
    },
    {
      placement: "rest_of_search",
      placementLabel: "搜索结果其他位置",
      bidAdjustment: campaign[0].placementRestBidAdjustment || 0,
      impressions: Math.floor((campaign[0].impressions || 0) * 0.2),
      clicks: Math.floor((campaign[0].clicks || 0) * 0.2),
      spend: parseFloat(campaign[0].spend || "0") * 0.2,
      sales: parseFloat(campaign[0].sales || "0") * 0.2,
      orders: Math.floor((campaign[0].orders || 0) * 0.2),
    },
  ];
  
  return placementData;
}

// 获取广告活动下所有投放词（关键词+商品定向）
export async function getCampaignTargets(campaignId: number) {
  const db = await getDb();
  if (!db) return { keywords: [], productTargets: [] };
  
  // 获取广告组ID列表
  const adGroupList = await db.select({ id: adGroups.id, adGroupName: adGroups.adGroupName })
    .from(adGroups)
    .where(eq(adGroups.campaignId, String(campaignId)));
  
  if (adGroupList.length === 0) {
    return { keywords: [], productTargets: [] };
  }
  
  const adGroupIds = adGroupList.map(ag => ag.id);
  const adGroupMap = new Map(adGroupList.map(ag => [ag.id, ag.adGroupName]));
  
  // 获取所有关键词
  const keywordList = await db.select().from(keywords)
    .where(sql`${keywords.adGroupId} IN (${sql.join(adGroupIds.map(id => sql`${id}`), sql`, `)})`);
  
  // 获取所有商品定向
  const productTargetList = await db.select().from(productTargets)
    .where(sql`${productTargets.adGroupId} IN (${sql.join(adGroupIds.map(id => sql`${id}`), sql`, `)})`);
  
  // v357: adGroupId现在是string类型，需要转换为number才能匹配map key
  const keywordsWithAdGroup = keywordList.map(k => ({
    ...k,
    adGroupName: adGroupMap.get(Number(k.adGroupId)) || "未知广告组"
  }));
  
  const productTargetsWithAdGroup = productTargetList.map(pt => ({
    ...pt,
    adGroupName: adGroupMap.get(Number(pt.adGroupId)) || "未知广告组"
  }));
  
  return {
    keywords: keywordsWithAdGroup,
    productTargets: productTargetsWithAdGroup
  };
}


// ==================== AI Optimization Execution Functions ====================

// 创建AI优化执行记录
export async function createAiOptimizationExecution(data: InsertAiOptimizationExecution): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(aiOptimizationExecutions).values(data);
  return result[0].insertId;
}

// 获取AI优化执行记录
export async function getAiOptimizationExecution(id: number): Promise<AiOptimizationExecution | null> {
  const db = await getDb();
  if (!db) return null;
  
  const results = await db.select().from(aiOptimizationExecutions).where(eq(aiOptimizationExecutions.id, id));
  return results[0] || null;
}

// 获取广告活动的AI优化执行历史
export async function getAiOptimizationExecutionsByCampaign(campaignId: number, limit: number = 50): Promise<AiOptimizationExecution[]> {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(aiOptimizationExecutions)
    .where(eq(aiOptimizationExecutions.campaignId, String(campaignId)))
    .orderBy(desc(aiOptimizationExecutions.executedAt))
    .limit(limit);
}

// 获取账号的AI优化执行历史
export async function getAiOptimizationExecutionsByAccount(accountId: number, limit: number = 100): Promise<AiOptimizationExecution[]> {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(aiOptimizationExecutions)
    .where(eq(aiOptimizationExecutions.accountId, accountId))
    .orderBy(desc(aiOptimizationExecutions.executedAt))
    .limit(limit);
}

// 更新AI优化执行状态
export async function updateAiOptimizationExecution(id: number, data: Partial<InsertAiOptimizationExecution>): Promise<void> {
  const db = await getDb();
  if (!db) return;
  
  await db.update(aiOptimizationExecutions).set(data).where(eq(aiOptimizationExecutions.id, id));
}

// 创建AI优化操作记录
export async function createAiOptimizationAction(data: InsertAiOptimizationAction): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(aiOptimizationActions).values(data);
  return result[0].insertId;
}

// 批量创建AI优化操作记录
export async function createAiOptimizationActions(dataList: InsertAiOptimizationAction[]): Promise<void> {
  const db = await getDb();
  if (!db) return;
  
  if (dataList.length > 0) {
    await db.insert(aiOptimizationActions).values(dataList);
  }
}

// 获取执行的所有操作
export async function getAiOptimizationActionsByExecution(executionId: number): Promise<AiOptimizationAction[]> {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(aiOptimizationActions)
    .where(eq(aiOptimizationActions.executionId, executionId))
    .orderBy(aiOptimizationActions.id);
}

// 更新AI优化操作状态
export async function updateAiOptimizationAction(id: number, data: Partial<InsertAiOptimizationAction>): Promise<void> {
  const db = await getDb();
  if (!db) return;
  
  await db.update(aiOptimizationActions).set(data).where(eq(aiOptimizationActions.id, id));
}

// 创建AI优化效果预测
export async function createAiOptimizationPrediction(data: InsertAiOptimizationPrediction): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(aiOptimizationPredictions).values(data);
  return result[0].insertId;
}

// 批量创建AI优化效果预测
export async function createAiOptimizationPredictions(dataList: InsertAiOptimizationPrediction[]): Promise<void> {
  const db = await getDb();
  if (!db) return;
  
  if (dataList.length > 0) {
    await db.insert(aiOptimizationPredictions).values(dataList);
  }
}

// 获取执行的所有预测
export async function getAiOptimizationPredictionsByExecution(executionId: number): Promise<AiOptimizationPrediction[]> {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(aiOptimizationPredictions)
    .where(eq(aiOptimizationPredictions.executionId, executionId));
}

// 创建AI优化复盘记录
export async function createAiOptimizationReview(data: InsertAiOptimizationReview): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(aiOptimizationReviews).values(data);
  return result[0].insertId;
}

// 获取执行的所有复盘记录
export async function getAiOptimizationReviewsByExecution(executionId: number): Promise<AiOptimizationReview[]> {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(aiOptimizationReviews)
    .where(eq(aiOptimizationReviews.executionId, executionId));
}

// 获取待复盘的记录
export async function getPendingAiOptimizationReviews(): Promise<AiOptimizationReview[]> {
  const db = await getDb();
  if (!db) return [];
  
  const now = new Date();
  return db.select().from(aiOptimizationReviews)
    .where(and(
      eq(aiOptimizationReviews.reviewStatus, "pending"),
      lte(aiOptimizationReviews.scheduledAt, now.toISOString())
    ))
    .orderBy(aiOptimizationReviews.scheduledAt);
}

// 更新AI优化复盘记录
export async function updateAiOptimizationReview(id: number, data: Partial<InsertAiOptimizationReview>): Promise<void> {
  const db = await getDb();
  if (!db) return;
  
  await db.update(aiOptimizationReviews).set(data).where(eq(aiOptimizationReviews.id, id));
}

// 获取AI优化执行详情（包含操作、预测、复盘）
export async function getAiOptimizationExecutionDetail(executionId: number) {
  const execution = await getAiOptimizationExecution(executionId);
  if (!execution) return null;
  
  const [actions, predictions, reviews] = await Promise.all([
    getAiOptimizationActionsByExecution(executionId),
    getAiOptimizationPredictionsByExecution(executionId),
    getAiOptimizationReviewsByExecution(executionId)
  ]);
  
  return {
    execution,
    actions,
    predictions,
    reviews
  };
}


// ==================== 历史趋势数据查询 ====================
// 获取关键词历史数据
// 注意：当前 dailyPerformance 表没有 targetType 和 targetId 字段
// 返回空数组，让前端使用模拟数据
export async function getKeywordHistoryData(keywordId: number, days: number) {
  // TODO: 待数据库表结构更新后实现真实数据查询
  return [];
}

// 获取商品定向历史数据
// 注意：当前 dailyPerformance 表没有 targetType 和 targetId 字段
// 返回空数组，让前端使用模拟数据
export async function getProductTargetHistoryData(targetId: number, days: number) {
  // TODO: 待数据库表结构更新后实现真实数据查询
  return [];
}


// ==================== 出价调整历史记录 ====================

// 记录出价调整历史
export async function recordBidAdjustment(data: {
  accountId: number;
  campaignId?: number;
  campaignName?: string;
  performanceGroupId?: number;
  performanceGroupName?: string;
  keywordId?: number;
  keywordText?: string;
  matchType?: string;
  previousBid: number;
  newBid: number;
  adjustmentType: 'manual' | 'auto_optimal' | 'auto_dayparting' | 'auto_placement' | 'batch_campaign' | 'batch_group';
  adjustmentReason?: string;
  expectedProfitIncrease?: number;
  optimizationScore?: number;
  appliedBy?: string;
  status?: 'applied' | 'pending' | 'failed' | 'rolled_back';
  errorMessage?: string;
}) {
  const db = await getDb();
  if (!db) return null;
  
  const bidChangePercent = data.previousBid > 0 
    ? ((data.newBid - data.previousBid) / data.previousBid * 100)
    : 100;
  
  // @ts-ignore
  const result = await db.insert(bidAdjustmentHistory).values({
    accountId: data.accountId,
    campaignId: data.campaignId,
    campaignName: data.campaignName,
    performanceGroupId: data.performanceGroupId,
    performanceGroupName: data.performanceGroupName,
    keywordId: data.keywordId,
    keywordText: data.keywordText,
    matchType: data.matchType,
    previousBid: String(data.previousBid),
    newBid: String(data.newBid),
    bidChangePercent: String(Math.round(bidChangePercent * 100) / 100),
    adjustmentType: data.adjustmentType,
    adjustmentReason: data.adjustmentReason,
    expectedProfitIncrease: data.expectedProfitIncrease ? String(data.expectedProfitIncrease) : null,
    optimizationScore: data.optimizationScore,
    appliedBy: data.appliedBy,
    status: data.status || 'applied',
    errorMessage: data.errorMessage,
  } as Record<string, any>);
  
  // v145: 双写到统一优化事件表
  try {
    const bidChange = data.newBid - data.previousBid;
    const statusMap: Record<string, string> = {
      'applied': 'success', 'pending': 'pending', 'failed': 'failed', 'rolled_back': 'rolled_back'
    };
    // @ts-ignore
    await db.insert(optimizationEvents).values({
      performanceGroupId: data.performanceGroupId,
      performanceGroupName: data.performanceGroupName,
      accountId: data.accountId,
      eventCategory: 'bid_adjustment',
      actionType: bidChange > 0 ? 'bid_increase' : bidChange < 0 ? 'bid_decrease' : 'bid_set',
      campaignId: data.campaignId,
      campaignName: data.campaignName,
      keywordId: data.keywordId,
      keywordText: data.keywordText,
      matchType: data.matchType,
      previousBid: String(data.previousBid),
      newBid: String(data.newBid),
      bidChangePercent: String(Math.round(bidChangePercent * 100) / 100),
      changeReason: data.adjustmentReason,
      adjustmentType: data.adjustmentType,
      algorithmVersion: undefined,
      optimizationScore: data.optimizationScore,
      expectedProfitIncrease: data.expectedProfitIncrease ? String(data.expectedProfitIncrease) : undefined,
      status: (statusMap[data.status || 'applied'] || 'success') as unknown,
      apiSyncStatus: 'synced',
      errorMessage: data.errorMessage,
      sourceTable: 'bid_adjustment_history',
      sourceId: Number(result[0]?.insertId || 0),
    });
  } catch (e) {
    log.error('[v145] 双写optimization_events失败(bidAdjustment):', e);
  }
  
  return result;
}

// 批量记录出价调整历史
export async function recordBidAdjustmentBatch(records: Array<{
  accountId: number;
  campaignId?: number;
  campaignName?: string;
  performanceGroupId?: number;
  performanceGroupName?: string;
  keywordId?: number;
  keywordText?: string;
  matchType?: string;
  previousBid: number;
  newBid: number;
  adjustmentType: 'manual' | 'auto_optimal' | 'auto_dayparting' | 'auto_placement' | 'batch_campaign' | 'batch_group';
  adjustmentReason?: string;
  expectedProfitIncrease?: number;
  optimizationScore?: number;
  appliedBy?: string;
  status?: 'applied' | 'pending' | 'failed' | 'rolled_back';
  errorMessage?: string;
}>) {
  const db = await getDb();
  if (!db || records.length === 0) return null;
  
  const values = records.map(data => {
    const bidChangePercent = data.previousBid > 0 
      ? ((data.newBid - data.previousBid) / data.previousBid * 100)
      : 100;
    
    return {
      accountId: data.accountId,
      campaignId: data.campaignId,
      campaignName: data.campaignName,
      performanceGroupId: data.performanceGroupId,
      performanceGroupName: data.performanceGroupName,
      keywordId: data.keywordId,
      keywordText: data.keywordText,
      matchType: data.matchType,
      previousBid: String(data.previousBid),
      newBid: String(data.newBid),
      bidChangePercent: String(Math.round(bidChangePercent * 100) / 100),
      adjustmentType: data.adjustmentType,
      adjustmentReason: data.adjustmentReason,
      expectedProfitIncrease: data.expectedProfitIncrease ? String(data.expectedProfitIncrease) : null,
      optimizationScore: data.optimizationScore,
      appliedBy: data.appliedBy,
      status: data.status || 'applied',
      errorMessage: data.errorMessage,
    };
  });
  
  // @ts-ignore
  const result = await db.insert(bidAdjustmentHistory).values(values as unknown);
  return result;
}

// 获取出价调整历史记录（支持筛选和分页）
export async function getBidAdjustmentHistory(params: {
  accountId: number;
  campaignId?: number;
  performanceGroupId?: number;
  adjustmentType?: 'manual' | 'auto_optimal' | 'auto_dayparting' | 'auto_placement' | 'batch_campaign' | 'batch_group';
  startDate?: string;
  endDate?: string;
  page?: number;
  pageSize?: number;
}) {
  const db = await getDb();
  if (!db) return { records: [], total: 0, page: 1, pageSize: 50 };
  
  const page = params.page || 1;
  const pageSize = params.pageSize || 50;
  const offset = (page - 1) * pageSize;
  
  // 构建查询条件
  const conditions = [eq(bidAdjustmentHistory.accountId, params.accountId)];
  
  if (params.campaignId) {
    conditions.push(eq(bidAdjustmentHistory.campaignId, String(params.campaignId)));
  }
  
  if (params.performanceGroupId) {
    conditions.push(eq(bidAdjustmentHistory.performanceGroupId, params.performanceGroupId));
  }
  
  if (params.adjustmentType) {
    conditions.push(eq(bidAdjustmentHistory.adjustmentType, params.adjustmentType));
  }
  
  if (params.startDate) {
    conditions.push(gte(bidAdjustmentHistory.appliedAt, params.startDate));
  }
  
  if (params.endDate) {
    conditions.push(lte(bidAdjustmentHistory.appliedAt, params.endDate));
  }
  
  // 获取总数
  const countResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(bidAdjustmentHistory)
    .where(and(...conditions));
  
  const total = countResult[0]?.count || 0;
  
  // 获取记录
  const records = await db
    .select()
    .from(bidAdjustmentHistory)
    .where(and(...conditions))
    .orderBy(desc(bidAdjustmentHistory.appliedAt))
    .limit(pageSize)
    .offset(offset);
  
  return {
    records,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

// 获取出价调整统计数据
export async function getBidAdjustmentStats(accountId: number, days: number = 30) {
  const db = await getDb();
  if (!db) return null;
  
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const startDateStr = startDate.toISOString().slice(0, 19).replace('T', ' ');
  
  // 获取各类型调整数量
  const typeStats = await db
    .select({
      adjustmentType: bidAdjustmentHistory.adjustmentType,
      count: sql<number>`count(*)`,
      totalProfitIncrease: sql<number>`COALESCE(SUM(expected_profit_increase), 0)`,
    })
    .from(bidAdjustmentHistory)
    .where(and(
      eq(bidAdjustmentHistory.accountId, accountId),
      gte(bidAdjustmentHistory.appliedAt, startDateStr)
    ))
    .groupBy(bidAdjustmentHistory.adjustmentType);
  
  // 获取每日调整数量趋势
  const dailyTrend = await db
    .select({
      date: sql<string>`DATE(applied_at)`,
      count: sql<number>`count(*)`,
      avgBidChange: sql<number>`AVG(bid_change_percent)`,
    })
    .from(bidAdjustmentHistory)
    .where(and(
      eq(bidAdjustmentHistory.accountId, accountId),
      gte(bidAdjustmentHistory.appliedAt, startDateStr)
    ))
    .groupBy(sql`DATE(applied_at)`)
    .orderBy(sql`DATE(applied_at)`);
  
  // 获取总体统计
  const overallStats = await db
    .select({
      totalAdjustments: sql<number>`count(*)`,
      totalProfitIncrease: sql<number>`COALESCE(SUM(expected_profit_increase), 0)`,
      avgBidChange: sql<number>`AVG(bid_change_percent)`,
      increasedCount: sql<number>`SUM(CASE WHEN bid_change_percent > 0 THEN 1 ELSE 0 END)`,
      decreasedCount: sql<number>`SUM(CASE WHEN bid_change_percent < 0 THEN 1 ELSE 0 END)`,
    })
    .from(bidAdjustmentHistory)
    .where(and(
      eq(bidAdjustmentHistory.accountId, accountId),
      gte(bidAdjustmentHistory.appliedAt, startDateStr)
    ));
  
  return {
    typeStats,
    dailyTrend,
    overall: overallStats[0] || {
      totalAdjustments: 0,
      totalProfitIncrease: 0,
      avgBidChange: 0,
      increasedCount: 0,
      decreasedCount: 0,
    },
    period: {
      days,
      startDate: startDateStr,
      endDate: new Date().toISOString().slice(0, 19).replace('T', ' '),
    },
  };
}


// 回滚出价调整
export async function rollbackBidAdjustment(adjustmentId: number, userId: string) {
  const db = await getDb();
  if (!db) return null;
  
  // 获取原始调整记录
  const [adjustment] = await db.select().from(bidAdjustmentHistory).where(eq(bidAdjustmentHistory.id, adjustmentId));
  if (!adjustment) return null;
  
  // 更新关键词出价为之前的值
  if (adjustment.keywordId) {
    await db.update(keywords)
      .set({ bid: adjustment.previousBid })
      .where(eq(keywords.id, adjustment.keywordId));
  }
  
  // 更新调整记录状态为已回滚
  await db.update(bidAdjustmentHistory)
    .set({
      status: 'rolled_back',
      rolledBackAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      rolledBackBy: userId,
    })
    .where(eq(bidAdjustmentHistory.id, adjustmentId));
  
  // 记录一条新的回滚操作历史
  await db.insert(bidAdjustmentHistory).values({
    accountId: adjustment.accountId,
    campaignId: adjustment.campaignId,
    campaignName: adjustment.campaignName,
    performanceGroupId: adjustment.performanceGroupId,
    performanceGroupName: adjustment.performanceGroupName,
    keywordId: adjustment.keywordId,
    keywordText: adjustment.keywordText,
    matchType: adjustment.matchType,
    previousBid: adjustment.newBid, // 回滚前是新出价
    newBid: adjustment.previousBid, // 回滚后是原出价
    bidChangePercent: String(-Number(adjustment.bidChangePercent || 0)),
    adjustmentType: 'manual',
    adjustmentReason: `回滚调整 #${adjustmentId}`,
    appliedBy: userId,
    status: 'applied',
  });
  
  return { success: true, adjustmentId };
}

// 获取单条调整记录详情
export async function getBidAdjustmentById(adjustmentId: number) {
  const db = await getDb();
  if (!db) return null;
  
  const [adjustment] = await db.select().from(bidAdjustmentHistory).where(eq(bidAdjustmentHistory.id, adjustmentId));
  return adjustment || null;
}

// 更新效果追踪数据
export async function updateBidAdjustmentTracking(adjustmentId: number, trackingData: {
  actualProfit7D?: number;
  actualProfit14D?: number;
  actualProfit30D?: number;
  actualImpressions7D?: number;
  actualClicks7D?: number;
  actualConversions7D?: number;
  actualSpend7D?: number;
  actualRevenue7D?: number;
}) {
  const db = await getDb();
  if (!db) return null;
  
  await db.update(bidAdjustmentHistory)
    .set({
      actualProfit7D: trackingData.actualProfit7D !== undefined ? String(trackingData.actualProfit7D) : undefined,
      actualProfit14D: trackingData.actualProfit14D !== undefined ? String(trackingData.actualProfit14D) : undefined,
      actualProfit30D: trackingData.actualProfit30D !== undefined ? String(trackingData.actualProfit30D) : undefined,
      actualImpressions7D: trackingData.actualImpressions7D,
      actualClicks7D: trackingData.actualClicks7D,
      actualConversions7D: trackingData.actualConversions7D,
      actualSpend7D: trackingData.actualSpend7D !== undefined ? String(trackingData.actualSpend7D) : undefined,
      actualRevenue7D: trackingData.actualRevenue7D !== undefined ? String(trackingData.actualRevenue7D) : undefined,
      trackingUpdatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
    })
    .where(eq(bidAdjustmentHistory.id, adjustmentId));
  
  return { success: true };
}

// 获取需要效果追踪的调整记录（7天前的记录且未追踪）
export async function getAdjustmentsNeedingTracking(daysAgo: number = 7) {
  const db = await getDb();
  if (!db) return [];
  
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysAgo);
  const cutoffDateStr = cutoffDate.toISOString().slice(0, 19).replace('T', ' ');
  
  const results = await db.select()
    .from(bidAdjustmentHistory)
    .where(
      and(
        eq(bidAdjustmentHistory.status, 'applied'),
        sql`${bidAdjustmentHistory.appliedAt} <= ${cutoffDateStr}`,
        sql`${bidAdjustmentHistory.trackingUpdatedAt} IS NULL OR DATE(${bidAdjustmentHistory.trackingUpdatedAt}) < DATE(NOW())`
      )
    )
    .limit(100);
  
  return results;
}

// 批量导入出价调整历史
export async function importBidAdjustmentHistory(records: Array<{
  accountId: number;
  campaignId?: number;
  campaignName?: string;
  performanceGroupId?: number;
  performanceGroupName?: string;
  keywordId?: number;
  keywordText?: string;
  matchType?: string;
  previousBid: number;
  newBid: number;
  adjustmentType: 'manual' | 'auto_optimal' | 'auto_dayparting' | 'auto_placement' | 'batch_campaign' | 'batch_group';
  adjustmentReason?: string;
  expectedProfitIncrease?: number;
  appliedBy?: string;
  appliedAt?: string;
  status?: 'applied' | 'pending' | 'failed' | 'rolled_back';
}>) {
  const db = await getDb();
  if (!db || records.length === 0) return { success: false, imported: 0, errors: [] };
  
  const errors: Array<{ row: number; error: string }> = [];
  const validRecords: any[] = [];
  
  records.forEach((record: any, index: any) => {
    // 验证必填字段
    if (!record.accountId) {
      errors.push({ row: index + 1, error: '缺少账号ID' });
      return;
    }
    if (record.previousBid === undefined || record.newBid === undefined) {
      errors.push({ row: index + 1, error: '缺少出价数据' });
      return;
    }
    
    const bidChangePercent = record.previousBid > 0 
      ? ((record.newBid - record.previousBid) / record.previousBid * 100)
      : 100;
    
    validRecords.push({
      accountId: record.accountId,
      campaignId: record.campaignId,
      campaignName: record.campaignName,
      performanceGroupId: record.performanceGroupId,
      performanceGroupName: record.performanceGroupName,
      keywordId: record.keywordId,
      keywordText: record.keywordText,
      matchType: record.matchType,
      previousBid: String(record.previousBid),
      newBid: String(record.newBid),
      bidChangePercent: String(Math.round(bidChangePercent * 100) / 100),
      adjustmentType: record.adjustmentType || 'manual',
      adjustmentReason: record.adjustmentReason || '批量导入',
      expectedProfitIncrease: record.expectedProfitIncrease ? String(record.expectedProfitIncrease) : null,
      appliedBy: record.appliedBy || 'import',
      appliedAt: record.appliedAt || new Date().toISOString().slice(0, 19).replace('T', ' '),
      status: record.status || 'applied',
    });
  });
  
  if (validRecords.length > 0) {
    await db.insert(bidAdjustmentHistory).values(validRecords);
  }
  
  return {
    success: true,
    imported: validRecords.length,
    skipped: errors.length,
    errors,
  };
}

// 获取效果追踪统计
export async function getBidAdjustmentTrackingStats(accountId: number, days: number = 30) {
  const db = await getDb();
  if (!db) return null;
  
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  const cutoffDateStr = cutoffDate.toISOString().slice(0, 19).replace('T', ' ');
  
  const results = await db.select()
    .from(bidAdjustmentHistory)
    .where(
      and(
        eq(bidAdjustmentHistory.accountId, accountId),
        eq(bidAdjustmentHistory.status, 'applied'),
        sql`${bidAdjustmentHistory.appliedAt} >= ${cutoffDateStr}`,
        sql`${bidAdjustmentHistory.actualProfit7D} IS NOT NULL`
      )
    );
  
  // 计算统计数据
  let totalExpectedProfit = 0;
  let totalActualProfit7d = 0;
  let totalActualProfit14d = 0;
  let totalActualProfit30d = 0;
  let trackedCount = 0;
  
  results.forEach(r => {
    totalExpectedProfit += Number(r.expectedProfitIncrease || 0);
    totalActualProfit7d += Number(r.actualProfit7D || 0);
    totalActualProfit14d += Number(r.actualProfit14D || 0);
    totalActualProfit30d += Number(r.actualProfit30D || 0);
    trackedCount++;
  });
  
  return {
    trackedCount,
    totalExpectedProfit: Math.round(totalExpectedProfit * 100) / 100,
    totalActualProfit7d: Math.round(totalActualProfit7d * 100) / 100,
    totalActualProfit14d: Math.round(totalActualProfit14d * 100) / 100,
    totalActualProfit30d: Math.round(totalActualProfit30d * 100) / 100,
    accuracy7d: trackedCount > 0 && totalExpectedProfit > 0 
      ? Math.round((totalActualProfit7d / totalExpectedProfit) * 100) 
      : 0,
  };
}


// ==================== 同步历史记录相关函数 ====================

/**
 * 创建同步任务记录
 */
export async function createSyncJob(data: {
  userId: number;
  accountId: number;
  syncType?: 'campaigns' | 'keywords' | 'performance' | 'all';
  isIncremental?: boolean;
  maxRetries?: number;
}) {
  const db = await getDb();
  if (!db) return null;
  
  const [result] = await db.insert(dataSyncJobs).values({
    userId: data.userId,
    accountId: data.accountId,
    syncType: data.syncType || 'all',
    status: 'running',
    isIncremental: data.isIncremental ? 1 : 0,
    maxRetries: data.maxRetries || 3,
    startedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
    createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
  });
  
  return result.insertId;
}

/**
 * 更新同步任务状态
 */
export async function updateSyncJob(jobId: number, data: {
  status?: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  recordsSynced?: number;
  recordsSkipped?: number;
  errorMessage?: string;
  retryCount?: number;
  durationMs?: number;
  spCampaigns?: number;
  sbCampaigns?: number;
  sdCampaigns?: number;
  adGroupsSynced?: number;
  keywordsSynced?: number;
  targetsSynced?: number;
  // 进度相关字段
  currentStep?: string;
  totalSteps?: number;
  currentStepIndex?: number;
  progressPercent?: number;
  siteProgress?: unknown;
}) {
  const db = await getDb();
  if (!db) return;
  
  const updateData: Record<string, any> = { ...data };
  if (data.status === 'completed' || data.status === 'failed') {
    updateData.completedAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
  }
  // 更新时间戳
  updateData.updatedAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
  
  await db.update(dataSyncJobs)
    .set(updateData)
    .where(eq(dataSyncJobs.id, jobId));
}

/**
 * 获取同步任务详情
 */
export async function getSyncJob(jobId: number) {
  const db = await getDb();
  if (!db) return null;
  
  const [job] = await db.select().from(dataSyncJobs).where(eq(dataSyncJobs.id, jobId));
  return job || null;
}

/**
 * 获取用户正在进行的同步任务
 */
export async function getActiveSyncJobs(userId: number) {
  const db = await getDb();
  if (!db) return [];
  
  const jobs = await db.select()
    .from(dataSyncJobs)
    .where(
      and(
        eq(dataSyncJobs.userId, userId),
        inArray(dataSyncJobs.status, ['pending', 'running'])
      )
    )
    .orderBy(desc(dataSyncJobs.createdAt));
  
  return jobs;
}

/**
 * 获取账户正在进行的同步任务
 */
export async function getAccountActiveSyncJob(accountId: number) {
  const db = await getDb();
  if (!db) return null;
  
  const [job] = await db.select()
    .from(dataSyncJobs)
    .where(
      and(
        eq(dataSyncJobs.accountId, accountId),
        inArray(dataSyncJobs.status, ['pending', 'running'])
      )
    )
    .orderBy(desc(dataSyncJobs.createdAt))
    .limit(1);
  
  return job || null;
}

/**
 * 获取账号的同步历史记录
 */
export async function getSyncHistory(accountId: number, limit: number = 20) {
  const db = await getDb();
  if (!db) return { jobs: [], total: 0 };
  
  const jobs = await db.select()
    .from(dataSyncJobs)
    .where(eq(dataSyncJobs.accountId, accountId))
    .orderBy(desc(dataSyncJobs.createdAt))
    .limit(limit);
  
  const [countResult] = await db.select({ count: sql<number>`count(*)` })
    .from(dataSyncJobs)
    .where(eq(dataSyncJobs.accountId, accountId));
  
  return {
    jobs,
    total: countResult?.count || 0,
  };
}

/**
 * 获取最后成功同步时间
 */
export async function getLastSuccessfulSync(accountId: number): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  
  const [lastJob] = await db.select()
    .from(dataSyncJobs)
    .where(and(
      eq(dataSyncJobs.accountId, accountId),
      eq(dataSyncJobs.status, 'completed')
    ))
    .orderBy(desc(dataSyncJobs.completedAt))
    .limit(1);
  
  return lastJob?.completedAt || null;
}

/**
 * 获取上次成功同步的数据统计
 */
export async function getLastSyncData(accountId: number) {
  const db = await getDb();
  if (!db) return null;
  
  const [lastJob] = await db.select()
    .from(dataSyncJobs)
    .where(and(
      eq(dataSyncJobs.accountId, accountId),
      eq(dataSyncJobs.status, 'completed')
    ))
    .orderBy(desc(dataSyncJobs.completedAt))
    .limit(1);
  
  if (!lastJob) return null;
  
  return {
    sp: lastJob.spCampaigns || 0,
    sb: lastJob.sbCampaigns || 0,
    sd: lastJob.sdCampaigns || 0,
    adGroups: lastJob.adGroupsSynced || 0,
    keywords: lastJob.keywordsSynced || 0,
    targets: lastJob.targetsSynced || 0,
    syncedAt: lastJob.completedAt,
  };
}

/**
 * 获取同步统计信息
 */
export async function getSyncStats(accountId: number, days: number = 30) {
  const db = await getDb();
  if (!db) return null;
  
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  const cutoffDateStr = cutoffDate.toISOString().slice(0, 19).replace('T', ' ');
  
  const [stats] = await db.select({
    totalSyncs: sql<number>`count(*)`,
    successfulSyncs: sql<number>`SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END)`,
    failedSyncs: sql<number>`SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END)`,
    totalRecordsSynced: sql<number>`COALESCE(SUM(records_synced), 0)`,
    avgDurationMs: sql<number>`AVG(duration_ms)`,
    totalRetries: sql<number>`COALESCE(SUM(retry_count), 0)`,
  })
  .from(dataSyncJobs)
  .where(and(
    eq(dataSyncJobs.accountId, accountId),
    gte(dataSyncJobs.createdAt, cutoffDateStr)
  ));
  
  return stats || {
    totalSyncs: 0,
    successfulSyncs: 0,
    failedSyncs: 0,
    totalRecordsSynced: 0,
    avgDurationMs: 0,
    totalRetries: 0,
  };
}

/**
 * 获取同步任务日志
 */
export async function getSyncLogs(jobId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select()
    .from(dataSyncLogs)
    .where(eq(dataSyncLogs.jobId, jobId))
    .orderBy(desc(dataSyncLogs.createdAt));
}


// ==================== 同步变更记录相关函数 ====================

/**
 * 创建同步变更记录
 */
export async function createSyncChangeRecord(data: InsertSyncChangeRecord): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;
  
  const [result] = await db.insert(syncChangeRecords).values(data);
  return result.insertId;
}

/**
 * 批量创建同步变更记录
 */
export async function createSyncChangeRecordsBatch(records: InsertSyncChangeRecord[]): Promise<number> {
  const db = await getDb();
  if (!db || records.length === 0) return 0;
  
  await db.insert(syncChangeRecords).values(records);
  return records.length;
}

/**
 * 获取同步变更记录
 */
export async function getSyncChangeRecords(syncJobId: number, entityType?: string) {
  const db = await getDb();
  if (!db) return [];
  
  const conditions = [eq(syncChangeRecords.syncJobId, syncJobId)];
  if (entityType) {
    // @ts-ignore
    conditions.push(eq(syncChangeRecords.entityType, entityType as unknown));
  }
  
  return db.select()
    .from(syncChangeRecords)
    .where(and(...conditions))
    .orderBy(desc(syncChangeRecords.createdAt));
}

/**
 * 获取同步变更摘要
 */
export async function getSyncChangeSummary(syncJobId: number) {
  const db = await getDb();
  if (!db) return null;
  
  const [summary] = await db.select()
    .from(syncChangeSummary)
    .where(eq(syncChangeSummary.syncJobId, syncJobId));
  
  return summary;
}

/**
 * 创建或更新同步变更摘要
 */
export async function upsertSyncChangeSummary(data: InsertSyncChangeSummary): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;
  
  // 检查是否已存在
  const [existing] = await db.select()
    .from(syncChangeSummary)
    .where(eq(syncChangeSummary.syncJobId, data.syncJobId));
  
  if (existing) {
    await db.update(syncChangeSummary)
      .set(data)
      .where(eq(syncChangeSummary.id, existing.id));
    return existing.id;
  } else {
    const [result] = await db.insert(syncChangeSummary).values(data);
    return result.insertId;
  }
}

// ==================== 同步冲突检测相关函数 ====================

/**
 * 创建同步冲突记录
 */
export async function createSyncConflict(data: InsertSyncConflict): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;
  
  const [result] = await db.insert(syncConflicts).values(data);
  return result.insertId;
}

/**
 * 批量创建同步冲突记录
 */
export async function createSyncConflictsBatch(conflicts: InsertSyncConflict[]): Promise<number> {
  const db = await getDb();
  if (!db || conflicts.length === 0) return 0;
  
  await db.insert(syncConflicts).values(conflicts);
  return conflicts.length;
}

/**
 * 获取同步冲突列表
 */
export async function getSyncConflicts(accountId: number, status?: string) {
  const db = await getDb();
  if (!db) return [];
  
  const conditions = [eq(syncConflicts.accountId, accountId)];
  if (status) {
    // @ts-ignore
    conditions.push(eq(syncConflicts.resolutionStatus, status as string));
  }
  
  return db.select()
    .from(syncConflicts)
    .where(and(...conditions))
    .orderBy(desc(syncConflicts.createdAt));
}

/**
 * 获取待处理冲突数量
 */
export async function getPendingConflictsCount(accountId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  
  const [result] = await db.select({ count: sql<number>`count(*)` })
    .from(syncConflicts)
    .where(and(
      eq(syncConflicts.accountId, accountId),
      eq(syncConflicts.resolutionStatus, 'pending')
    ));
  
  return result?.count || 0;
}

/**
 * 解决同步冲突
 */
export async function resolveSyncConflict(
  conflictId: number, 
  resolution: 'use_local' | 'use_remote' | 'merge' | 'manual',
  resolvedBy: number,
  notes?: string
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  
  await db.update(syncConflicts)
    .set({
      resolutionStatus: 'resolved',
      suggestedResolution: resolution,
      resolvedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      resolvedBy,
      resolutionNotes: notes,
    })
    .where(eq(syncConflicts.id, conflictId));
  
  return true;
}

/**
 * 批量解决同步冲突
 */
export async function resolveSyncConflictsBatch(
  conflictIds: number[], 
  resolution: 'use_local' | 'use_remote' | 'merge' | 'manual',
  resolvedBy: number
): Promise<number> {
  const db = await getDb();
  if (!db || conflictIds.length === 0) return 0;
  
  await db.update(syncConflicts)
    .set({
      resolutionStatus: 'resolved',
      suggestedResolution: resolution,
      resolvedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      resolvedBy,
    })
    .where(inArray(syncConflicts.id, conflictIds));
  
  return conflictIds.length;
}

/**
 * 忽略同步冲突
 */
export async function ignoreSyncConflict(conflictId: number, resolvedBy: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  
  await db.update(syncConflicts)
    .set({
      resolutionStatus: 'ignored',
      resolvedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      resolvedBy,
    })
    .where(eq(syncConflicts.id, conflictId));
  
  return true;
}

// ==================== 同步任务队列相关函数 ====================

/**
 * 添加同步任务到队列
 */
export async function addToSyncQueue(data: InsertSyncTaskQueue): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;
  
  const [result] = await db.insert(syncTaskQueue).values(data);
  return result.insertId;
}

/**
 * 批量添加同步任务到队列
 */
export async function addToSyncQueueBatch(tasks: InsertSyncTaskQueue[]): Promise<number[]> {
  const db = await getDb();
  if (!db || tasks.length === 0) return [];
  
  const ids: number[] = [];
  for (const task of tasks) {
    const [result] = await db.insert(syncTaskQueue).values(task);
    ids.push(result.insertId);
  }
  return ids;
}

/**
 * 获取队列中的任务
 */
export async function getSyncQueue(userId: number, status?: string) {
  const db = await getDb();
  if (!db) return [];
  
  const conditions = [eq(syncTaskQueue.userId, userId)];
  if (status) {
    // @ts-ignore
    conditions.push(eq(syncTaskQueue.status, status as string));
  }
  
  return db.select()
    .from(syncTaskQueue)
    .where(and(...conditions))
    .orderBy(desc(syncTaskQueue.priority), syncTaskQueue.createdAt);
}

/**
 * 获取下一个待执行的任务
 */
export async function getNextQueuedTask(): Promise<SyncTaskQueue | null> {
  const db = await getDb();
  if (!db) return null;
  
  const [task] = await db.select()
    .from(syncTaskQueue)
    .where(eq(syncTaskQueue.status, 'queued'))
    .orderBy(desc(syncTaskQueue.priority), syncTaskQueue.createdAt)
    .limit(1);
  
  return task || null;
}

/**
 * 更新任务状态
 */
export async function updateSyncTaskStatus(
  taskId: number, 
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled',
  updates?: Partial<{
    progress: number;
    currentStep: string;
    completedSteps: number;
    estimatedTimeMs: number;
    errorMessage: string;
    resultSummary: unknown;
    startedAt: string;
    completedAt: string;
  }>
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  
  const updateData: Record<string, any> = { status };
  
  if (status === 'running' && !updates?.startedAt) {
    updateData.startedAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
  }
  
  if (status === 'completed' || status === 'failed') {
    updateData.completedAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
  }
  
  if (updates) {
    Object.assign(updateData, updates);
  }
  
  await db.update(syncTaskQueue)
    .set(updateData)
    .where(eq(syncTaskQueue.id, taskId));
  
  return true;
}

/**
 * 更新任务进度
 */
export async function updateSyncTaskProgress(
  taskId: number,
  progress: number,
  currentStep: string,
  completedSteps: number,
  estimatedTimeMs?: number
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  
  await db.update(syncTaskQueue)
    .set({
      progress,
      currentStep,
      completedSteps,
      estimatedTimeMs,
    })
    .where(eq(syncTaskQueue.id, taskId));
  
  return true;
}

/**
 * 取消队列中的任务
 */
export async function cancelSyncTask(taskId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  
  await db.update(syncTaskQueue)
    .set({
      status: 'cancelled',
      completedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
    })
    .where(and(
      eq(syncTaskQueue.id, taskId),
      inArray(syncTaskQueue.status, ['queued', 'running'])
    ));
  
  return true;
}

/**
 * 获取队列统计信息
 */
export async function getSyncQueueStats(userId: number) {
  const db = await getDb();
  if (!db) return null;
  
  const [stats] = await db.select({
    totalTasks: sql<number>`count(*)`,
    queuedTasks: sql<number>`SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END)`,
    runningTasks: sql<number>`SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END)`,
    completedTasks: sql<number>`SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END)`,
    failedTasks: sql<number>`SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END)`,
    totalEstimatedTimeMs: sql<number>`COALESCE(SUM(CASE WHEN status IN ('queued', 'running') THEN estimated_time_ms ELSE 0 END), 0)`,
  })
  .from(syncTaskQueue)
  .where(eq(syncTaskQueue.userId, userId));
  
  return stats || {
    totalTasks: 0,
    queuedTasks: 0,
    runningTasks: 0,
    completedTasks: 0,
    failedTasks: 0,
    totalEstimatedTimeMs: 0,
  };
}

/**
 * 清理已完成的任务（保留最近N天）
 */
export async function cleanupOldSyncTasks(userId: number, retainDays: number = 7): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retainDays);
  const cutoffDateStr = cutoffDate.toISOString().slice(0, 19).replace('T', ' ');
  
  const [result] = await db.delete(syncTaskQueue)
    .where(and(
      eq(syncTaskQueue.userId, userId),
      inArray(syncTaskQueue.status, ['completed', 'failed', 'cancelled']),
      lte(syncTaskQueue.completedAt, cutoffDateStr)
    ));
  
  // @ts-ignore
  return (result as Record<string, number>).affectedRows || 0;
}


// ==================== 定时同步调度相关函数 ====================

import { dataSyncSchedules } from '../drizzle/schema';

export type DataSyncSchedule = typeof dataSyncSchedules.$inferSelect;
export type InsertDataSyncSchedule = typeof dataSyncSchedules.$inferInsert;

/**
 * 获取所有启用的定时同步配置
 */
export async function getEnabledSyncSchedules(): Promise<DataSyncSchedule[]> {
  const db = await getDb();
  if (!db) return [];
  
  const schedules = await db.select()
    .from(dataSyncSchedules)
    .where(eq(dataSyncSchedules.isEnabled, 1));
  
  return schedules;
}

/**
 * 根据账号ID获取定时同步配置
 */
export async function getSyncScheduleByAccountId(userId: number, accountId: number): Promise<DataSyncSchedule | null> {
  const db = await getDb();
  if (!db) return null;
  
  const [schedule] = await db.select()
    .from(dataSyncSchedules)
    .where(and(
      eq(dataSyncSchedules.userId, userId),
      eq(dataSyncSchedules.accountId, accountId)
    ))
    .limit(1);
  
  return schedule || null;
}

/**
 * 创建定时同步配置
 */
export async function createSyncSchedule(data: {
  userId: number;
  accountId: number;
  syncType: string;
  frequency: string;
  preferredTime?: string;
  preferredDayOfWeek?: number;
  isEnabled: boolean;
}): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  
  // 计算下次运行时间
  const nextRunAt = calculateNextRunTime(data.frequency, data.preferredTime, data.preferredDayOfWeek);
  
  const [result] = await db.insert(dataSyncSchedules)
    .values({
      // @ts-ignore
      userId: data.userId,
      accountId: data.accountId,
      syncType: data.syncType as unknown,
      frequency: data.frequency as unknown,
      preferredTime: data.preferredTime,
      preferredDayOfWeek: data.preferredDayOfWeek,
      isEnabled: data.isEnabled ? 1 : 0,
      nextRunAt: nextRunAt.toISOString().slice(0, 19).replace('T', ' '),
    });
  
  // @ts-ignore
  return (result as Record<string, number>).insertId;
}

/**
 * 更新定时同步配置
 */
export async function updateSyncSchedule(scheduleId: number, data: {
  syncType?: string;
  frequency?: string;
  preferredTime?: string;
  preferredDayOfWeek?: number;
  isEnabled?: boolean;
}): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  
  const updateData: Record<string, any> = {
    updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
  };
  
  if (data.syncType !== undefined) updateData.syncType = data.syncType;
  if (data.frequency !== undefined) updateData.frequency = data.frequency;
  if (data.preferredTime !== undefined) updateData.preferredTime = data.preferredTime;
  if (data.preferredDayOfWeek !== undefined) updateData.preferredDayOfWeek = data.preferredDayOfWeek;
  if (data.isEnabled !== undefined) updateData.isEnabled = data.isEnabled ? 1 : 0;
  
  // 如果更新了频率或时间，重新计算下次运行时间
  if (data.frequency || data.preferredTime) {
    const nextRunAt = calculateNextRunTime(
      data.frequency || 'daily',
      data.preferredTime,
      data.preferredDayOfWeek
    );
    updateData.nextRunAt = nextRunAt.toISOString().slice(0, 19).replace('T', ' ');
  }
  
  await db.update(dataSyncSchedules)
    .set(updateData)
    .where(eq(dataSyncSchedules.id, scheduleId));
  
  return true;
}

/**
 * 更新上次运行时间
 */
export async function updateSyncScheduleLastRun(scheduleId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  
  // 获取当前配置
  const [schedule] = await db.select()
    .from(dataSyncSchedules)
    .where(eq(dataSyncSchedules.id, scheduleId))
    .limit(1);
  
  if (!schedule) return false;
  
  // 计算下次运行时间
  const nextRunAt = calculateNextRunTime(
    schedule.frequency || 'daily',
    schedule.preferredTime || undefined,
    schedule.preferredDayOfWeek || undefined
  );
  
  await db.update(dataSyncSchedules)
    .set({
      lastRunAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      nextRunAt: nextRunAt.toISOString().slice(0, 19).replace('T', ' '),
      updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
    })
    .where(eq(dataSyncSchedules.id, scheduleId));
  
  return true;
}

/**
 * 删除定时同步配置
 */
export async function deleteSyncSchedule(scheduleId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  
  await db.delete(dataSyncSchedules)
    .where(eq(dataSyncSchedules.id, scheduleId));
  
  return true;
}

/**
 * 获取用户的所有定时同步配置
 */
export async function getSyncSchedulesByUserId(userId: number): Promise<DataSyncSchedule[]> {
  const db = await getDb();
  if (!db) return [];
  
  const schedules = await db.select()
    .from(dataSyncSchedules)
    .where(eq(dataSyncSchedules.userId, userId))
    .orderBy(desc(dataSyncSchedules.createdAt));
  
  return schedules;
}

/**
 * 计算下次运行时间
 */
function calculateNextRunTime(
  frequency: string,
  preferredTime?: string,
  preferredDayOfWeek?: number
): Date {
  const now = new Date();
  const next = new Date(now);
  
  // 设置首选时间（如果有）
  if (preferredTime) {
    const [hours, minutes] = preferredTime.split(':').map(Number);
    next.setHours(hours, minutes, 0, 0);
  }
  
  // 根据频率计算下次运行时间
  switch (frequency) {
    case 'hourly':
      next.setHours(next.getHours() + 1);
      next.setMinutes(0, 0, 0);
      break;
    case 'every_2_hours':
      next.setHours(next.getHours() + 2);
      next.setMinutes(0, 0, 0);
      break;
    case 'every_4_hours':
      next.setHours(next.getHours() + 4);
      next.setMinutes(0, 0, 0);
      break;
    case 'every_6_hours':
      next.setHours(next.getHours() + 6);
      next.setMinutes(0, 0, 0);
      break;
    case 'every_12_hours':
      next.setHours(next.getHours() + 12);
      next.setMinutes(0, 0, 0);
      break;
    case 'daily':
      if (next <= now) {
        next.setDate(next.getDate() + 1);
      }
      break;
    case 'weekly':
      if (preferredDayOfWeek !== undefined) {
        const currentDay = next.getDay();
        let daysUntilTarget = preferredDayOfWeek - currentDay;
        if (daysUntilTarget <= 0 || (daysUntilTarget === 0 && next <= now)) {
          daysUntilTarget += 7;
        }
        next.setDate(next.getDate() + daysUntilTarget);
      } else {
        next.setDate(next.getDate() + 7);
      }
      break;
    default:
      next.setDate(next.getDate() + 1);
  }
  
  return next;
}

/**
 * 创建同步日志
 */
export async function createSyncLog(data: {
  userId: number;
  accountId: number;
  syncType: string;
  status: string;
  recordsSynced: number;
  startedAt: string;
  completedAt: string;
  isIncremental?: boolean;
  spCampaigns?: number;
  sbCampaigns?: number;
  sdCampaigns?: number;
  adGroupsSynced?: number;
  keywordsSynced?: number;
  targetsSynced?: number;
  errorMessage?: string;
}): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  
  const [result] = await db.insert(dataSyncJobs)
    .values({
      // @ts-ignore
      userId: data.userId,
      accountId: data.accountId,
      syncType: data.syncType as unknown,
      status: data.status as string,
      recordsSynced: data.recordsSynced,
      startedAt: data.startedAt,
      completedAt: data.completedAt,
      isIncremental: data.isIncremental ? 1 : 0,
      spCampaigns: data.spCampaigns || 0,
      sbCampaigns: data.sbCampaigns || 0,
      sdCampaigns: data.sdCampaigns || 0,
      adGroupsSynced: data.adGroupsSynced || 0,
      keywordsSynced: data.keywordsSynced || 0,
      targetsSynced: data.targetsSynced || 0,
      errorMessage: data.errorMessage,
    });
  
  // @ts-ignore
  return (result as Record<string, number>).insertId;
}


// 获取本地数据统计
export async function getLocalDataStats(accountId: number) {
  const db = await getDb();
  if (!db) {
    return {
      spCampaigns: 0,
      sbCampaigns: 0,
      sdCampaigns: 0,
      adGroups: 0,
      keywords: 0,
      productTargets: 0,
    };
  }

  // 统计各类数据的数量 - 使用原生SQL查询避免类型问题
  const [spCampaignsResult] = await db.select({ count: sql<number>`count(*)` })
    .from(campaigns)
    .where(sql`${campaigns.accountId} = ${accountId} AND (${campaigns.campaignType} = 'sp_auto' OR ${campaigns.campaignType} = 'sp_manual')`);
  
  const [sbCampaignsResult] = await db.select({ count: sql<number>`count(*)` })
    .from(campaigns)
    .where(sql`${campaigns.accountId} = ${accountId} AND ${campaigns.campaignType} = 'sb'`);
  
  const [sdCampaignsResult] = await db.select({ count: sql<number>`count(*)` })
    .from(campaigns)
    .where(sql`${campaigns.accountId} = ${accountId} AND ${campaigns.campaignType} = 'sd'`);
  
  const [adGroupsResult] = await db.select({ count: sql<number>`count(*)` })
    .from(adGroups)
    .innerJoin(campaigns, eq(adGroups.campaignId, campaigns.campaignId))
    .where(eq(campaigns.accountId, accountId));
  
  const [keywordsResult] = await db.select({ count: sql<number>`count(*)` })
    .from(keywords)
    .innerJoin(adGroups, eq(keywords.adGroupId, adGroups.id))
    .innerJoin(campaigns, eq(adGroups.campaignId, campaigns.campaignId))
    .where(eq(campaigns.accountId, accountId));
  
  const [productTargetsResult] = await db.select({ count: sql<number>`count(*)` })
    .from(productTargets)
    .innerJoin(adGroups, eq(productTargets.adGroupId, adGroups.id))
    .innerJoin(campaigns, eq(adGroups.campaignId, campaigns.campaignId))
    .where(eq(campaigns.accountId, accountId));

  return {
    spCampaigns: Number(spCampaignsResult?.count || 0),
    sbCampaigns: Number(sbCampaignsResult?.count || 0),
    sdCampaigns: Number(sdCampaignsResult?.count || 0),
    adGroups: Number(adGroupsResult?.count || 0),
    keywords: Number(keywordsResult?.count || 0),
    productTargets: Number(productTargetsResult?.count || 0),
  };
}


// 获取账户绩效汇总
export async function getAccountPerformanceSummary(
  accountId: number,
  startDate?: Date,
  endDate?: Date
): Promise<{
  totalSpend: number;
  totalSales: number;
  totalOrders: number;
  totalImpressions: number;
  totalClicks: number;
} | null> {
  const db = await getDb();
  if (!db) return null;
  
  try {
    // 如果有时间范围，从日报表查询；否则从 campaigns 表查询累计数据
    if (startDate && endDate) {
      // 将Date对象转换为YYYY-MM-DD格式字符串，与数据库中的日期格式匹配
      const startDateStr = startDate.toISOString().split('T')[0];
      const endDateStr = endDate.toISOString().split('T')[0];
      
      // v104: 从daily_performance表查询指定时间范围的数据
      // 使用 spend_usd/sales_usd（如果有）进行USD汇总，否则回退到 spend/sales
      const [result] = await db.select({
        totalSpend: sql<number>`COALESCE(SUM(CASE WHEN spend_usd > 0 THEN spend_usd ELSE ${dailyPerformance.spend} END), 0)`,
        totalSales: sql<number>`COALESCE(SUM(CASE WHEN sales_usd > 0 THEN sales_usd ELSE ${dailyPerformance.sales} END), 0)`,
        totalOrders: sql<number>`COALESCE(SUM(${dailyPerformance.orders}), 0)`,
        totalImpressions: sql<number>`COALESCE(SUM(${dailyPerformance.impressions}), 0)`,
        totalClicks: sql<number>`COALESCE(SUM(${dailyPerformance.clicks}), 0)`,
      })
      .from(dailyPerformance)
      .where(and(
        eq(dailyPerformance.accountId, accountId),
        sql`DATE(${dailyPerformance.date}) >= ${startDateStr}`,
        sql`DATE(${dailyPerformance.date}) <= ${endDateStr}`
      ));
      
      return {
        totalSpend: Number(result?.totalSpend || 0),
        totalSales: Number(result?.totalSales || 0),
        totalOrders: Number(result?.totalOrders || 0),
        totalImpressions: Number(result?.totalImpressions || 0),
        totalClicks: Number(result?.totalClicks || 0),
      };
    }
    
    // 无时间范围时，从campaigns表查询累计数据
    const [result] = await db.select({
      totalSpend: sql<number>`COALESCE(SUM(${campaigns.spend}), 0)`,
      totalSales: sql<number>`COALESCE(SUM(${campaigns.sales}), 0)`,
      totalOrders: sql<number>`COALESCE(SUM(${campaigns.orders}), 0)`,
      totalImpressions: sql<number>`COALESCE(SUM(${campaigns.impressions}), 0)`,
      totalClicks: sql<number>`COALESCE(SUM(${campaigns.clicks}), 0)`,
    })
    .from(campaigns)
    .where(eq(campaigns.accountId, accountId));
    
    return {
      totalSpend: Number(result?.totalSpend || 0),
      totalSales: Number(result?.totalSales || 0),
      totalOrders: Number(result?.totalOrders || 0),
      totalImpressions: Number(result?.totalImpressions || 0),
      totalClicks: Number(result?.totalClicks || 0),
    };
  } catch (error) {
    log.error('[getAccountPerformanceSummary] Error:', error);
    return null;
  }
}


// 获取每日趋势数据
export async function getDailyTrendData(accountIds: number[], days: number, timeRange?: string, customStartDate?: string, customEndDate?: string): Promise<{
  date: string;
  spend: number;
  sales: number;
  orders: number;
  acos: number;
}[]> {
  const db = await getDb();
  if (!db) return [];
  
  try {
    // 优先使用前端传入的日期字符串（已根据站点时区计算）
    let startDateStr: string;
    let endDateStr: string;
    
    if (customStartDate && customEndDate) {
      // 前端传入的日期已经是YYYY-MM-DD格式
      startDateStr = customStartDate;
      endDateStr = customEndDate;
    } else {
      // 如果没有传入日期，使用默认计算（回退方案）
      let endDate = new Date();
      let startDate = new Date();
      
      if (timeRange === 'yesterday') {
        endDate.setDate(endDate.getDate() - 1);
        startDate = new Date(endDate);
      } else if (timeRange === 'today') {
        // startDate和endDate都是今天
      } else {
        startDate.setDate(startDate.getDate() - days);
      }
      
      startDateStr = startDate.toISOString().split('T')[0];
      endDateStr = endDate.toISOString().split('T')[0];
    }
    
    // v104: 使用 spend_usd/sales_usd 进行USD汇总
    const results = await db.execute(sql`
      SELECT 
        DATE(date) as report_date,
        COALESCE(SUM(CASE WHEN spend_usd > 0 THEN spend_usd ELSE spend END), 0) as spend,
        COALESCE(SUM(CASE WHEN sales_usd > 0 THEN sales_usd ELSE sales END), 0) as sales,
        COALESCE(SUM(orders), 0) as orders
      FROM daily_performance
      WHERE accountId IN (${sql.raw(accountIds.map(Number).filter(n => !isNaN(n)).join(","))})
        AND DATE(date) >= ${startDateStr}
        AND DATE(date) <= ${endDateStr}
      GROUP BY DATE(date)
      ORDER BY DATE(date)
    `) as unknown;
    
    // @ts-ignore
    const rows = results[0] || results;
    
    return (rows as any[]).map((r: Record<string, any>) => {
      const spend = Number(r.spend) || 0;
      const sales = Number(r.sales) || 0;
      const acos = spend > 0 && sales > 0 ? (spend / sales) * 100 : 0;
      
      // 格式化日期为 M/D 格式，使用report_date字段
      let dateStr = 'N/A';
      const dateValue = r.report_date || r.date;
      if (dateValue) {
        const dateObj = new Date(dateValue);
        if (!isNaN(dateObj.getTime())) {
          dateStr = `${dateObj.getMonth() + 1}/${dateObj.getDate()}`;
        }
      }
      
      return {
        date: dateStr,
        spend: parseFloat(spend.toFixed(0)),
        sales: parseFloat(sales.toFixed(0)),
        orders: Number(r.orders) || 0,
        acos: parseFloat(acos.toFixed(1)),
      };
    });
  } catch (error) {
    log.error('[getDailyTrendData] Error:', error);
    return [];
  }
}


// 获取数据可用日期范围和最后同步时间
export async function getDataDateRange(accountIds: number[]): Promise<{
  minDate: string;
  maxDate: string;
  hasData: boolean;
  lastSyncAt?: string; // 最后同步时间
}> {
  const db = await getDb();
  if (!db) {
    const now = new Date();
    const minDate = new Date(now);
    minDate.setDate(minDate.getDate() - 90);
    return {
      minDate: minDate.toISOString().split('T')[0],
      maxDate: now.toISOString().split('T')[0],
      hasData: false,
    };
  }
  
  try {
    // 从daily_performance表获取最早和最晚的数据日期
    const results = await db.execute(sql`
      SELECT 
        MIN(DATE(date)) as min_date,
        MAX(DATE(date)) as max_date
      FROM daily_performance
      WHERE accountId IN (${sql.raw(accountIds.map(Number).filter(n => !isNaN(n)).join(","))})
    `) as unknown;
    
    // @ts-ignore
    const rows = results[0] || results;
    const row = Array.isArray(rows) ? rows[0] : rows;
    
    if (row && row.min_date && row.max_date) {
      // 获取最后同步时间
      const syncResults = await db.execute(sql`
        SELECT MAX(lastSyncAt) as last_sync
        FROM amazon_api_credentials
        WHERE accountId IN (${sql.raw(accountIds.map(Number).filter(n => !isNaN(n)).join(","))})
      `) as unknown;
      // @ts-ignore
      const syncRows = syncResults[0] || syncResults;
      const syncRow = Array.isArray(syncRows) ? syncRows[0] : syncRows;
      
      return {
        minDate: row.min_date,
        maxDate: row.max_date,
        hasData: true,
        lastSyncAt: syncRow?.last_sync || undefined,
      };
    }
    
    // 如果daily_performance没有数据，尝试从campaigns表获取
    const campaignResults = await db.execute(sql`
      SELECT 
        MIN(DATE(createdAt)) as min_date,
        MAX(DATE(updatedAt)) as max_date
      FROM campaigns
      WHERE accountId IN (${sql.raw(accountIds.map(Number).filter(n => !isNaN(n)).join(","))})
    `) as unknown;
    
    // @ts-ignore
    const campaignRows = campaignResults[0] || campaignResults;
    const campaignRow = Array.isArray(campaignRows) ? campaignRows[0] : campaignRows;
    
    if (campaignRow && campaignRow.min_date && campaignRow.max_date) {
      return {
        minDate: campaignRow.min_date,
        maxDate: campaignRow.max_date,
        hasData: true,
      };
    }
    
    // 没有数据时返回默认90天范围
    const now = new Date();
    const minDate = new Date(now);
    minDate.setDate(minDate.getDate() - 90);
    return {
      minDate: minDate.toISOString().split('T')[0],
      maxDate: now.toISOString().split('T')[0],
      hasData: false,
    };
  } catch (error) {
    log.error('[getDataDateRange] Error:', error);
    const now = new Date();
    const minDate = new Date(now);
    minDate.setDate(minDate.getDate() - 90);
    return {
      minDate: minDate.toISOString().split('T')[0],
      maxDate: now.toISOString().split('T')[0],
      hasData: false,
    };
  }
}

// 获取广告活动的位置绩效数据
export async function getPlacementPerformanceByCampaignId(campaignId: number) {
  const db = await getDb();
  if (!db) return [];
  
  try {
    // v165: 修复SQL列名错误 - 实际列名是campaignId/placement/date（非campaign_id/placement_type/report_date）
    // 聚合所有日期的数据，按位置类型汇总，展示累计绩效
    const result = await db.execute(sql`
      SELECT 
        MIN(id) as id,
        campaignId,
        placement as placementType,
        SUM(impressions) as impressions,
        SUM(clicks) as clicks,
        SUM(spend) as spend,
        SUM(sales) as sales,
        SUM(orders) as orders,
        CASE WHEN SUM(sales) > 0 THEN ROUND(SUM(spend) / SUM(sales) * 100, 2) ELSE NULL END as acos,
        CASE WHEN SUM(spend) > 0 THEN ROUND(SUM(sales) / SUM(spend), 2) ELSE 0 END as roas,
        CASE WHEN SUM(impressions) > 0 THEN ROUND(SUM(clicks) / SUM(impressions), 6) ELSE 0 END as ctr,
        CASE WHEN SUM(clicks) > 0 THEN ROUND(SUM(orders) / SUM(clicks), 6) ELSE 0 END as cvr,
        CASE WHEN SUM(clicks) > 0 THEN ROUND(SUM(spend) / SUM(clicks), 2) ELSE NULL END as cpc,
        MAX(date) as reportDate,
        MIN(createdAt) as createdAt
      FROM placement_performance
      WHERE campaignId = ${campaignId}
      GROUP BY campaignId, placement
      ORDER BY placement
    `);
    
    return (result as unknown) || [];
  } catch (error) {
    log.error('[getPlacementPerformanceByCampaignId] Error:', error);
    return [];
  }
}


/**
 * 更新广告活动的预算使用情况（快照模式，直接覆盖）
 * 用于处理AMS的budget-usage消息
 * 
 * ⚠️ 重要: 预算数据是快照(Snapshot)，不是累加!
 * 参考文档: https://advertising.amazon.com/API/docs/en-us/guides/amazon-marketing-stream/overview
 */
export async function updateCampaignBudgetUsage(
  campaignId: string,
  data: {
    budgetUsage: number;
    budgetUsagePercentage: number;
    lastBudgetUpdateAt: string;
  }
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(campaigns)
    .set({
      budgetUsagePercent: String(data.budgetUsagePercentage),
    })
    .where(eq(campaigns.campaignId, campaignId));
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
      } catch (parseErr) {
        // action_detail可能不是有效JSON，忽略解析错误
      }
    }
    
    const resolvedCategory = categoryMap[data.logCategory || ''] || 'settings_change';
    const resolvedActionType = actionTypeMap[data.actionType || ''] || 'settings_update';
    
    // v212: 使用提取的apiSyncStatus（优先级：action_detail > data字段）
    const finalApiSyncStatus = extractedApiSyncStatus || data.apiSyncStatus || 'pending';
    const finalApiSyncDetail = extractedApiSyncDetail || data.apiSyncDetail;
    
    // v333: 今action_detail中提取apiResponseId
    let extractedApiResponseId: string | undefined;
    if (data.actionDetail) {
      try {
        const detailObj = typeof data.actionDetail === 'string' ? JSON.parse(data.actionDetail) : data.actionDetail;
        extractedApiResponseId = detailObj.apiResponseId || undefined;
      } catch { /* ignore */ }
    }
    
    await db.insert(optimizationEvents).values({
      // @ts-ignore
      performanceGroupId: data.performanceGroupId,
      performanceGroupName: data.performanceGroupName,
      accountId: data.accountId || 0,
      accountName: data.accountName,
      userId: data.userId,
      userName: data.userName,
      eventCategory: resolvedCategory as unknown,
      actionType: resolvedActionType as unknown,
      strategyTemplateId: data.strategyTemplateId,
      strategyTemplateName: data.strategyTemplateName,
      campaignId: data.campaignId,
      campaignName: data.campaignName,
      // v212: 从 action_detail中提取的关键字段
      keywordId: extractedKeywordId,
      keywordText: extractedKeywordText,
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
      // @ts-ignore
      apiResponseId: extractedApiResponseId || (data as unknown).apiResponseId || null,
      // @ts-ignore
      apiSyncedAt: (data as unknown).apiSyncedAt || (finalApiSyncStatus === 'synced' ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null),
      errorMessage: data.errorMessage,
      sourceTable: 'optimization_logs',
      sourceId: logId,
      executedAt: data.executedAt,
      // v258: 写入结构化归因和护栏信息
      // @ts-ignore
      reasonDetails: (data as unknown).reasonDetails || undefined,
      // @ts-ignore
      guardrailInfo: (data as unknown).guardrailInfo || undefined,
      // @ts-ignore
      relatedEventId: (data as unknown).relatedEventId || undefined,
      // v274: 写入算法决策元数据（预算分池、因果推断、GTO修正等）
      performanceData: (() => {
        try {
          if (!data.actionDetail) return undefined;
          const detail = typeof data.actionDetail === 'string' ? JSON.parse(data.actionDetail) : data.actionDetail;
          const meta: Record<string, any> = {};
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
    });
    log.info(`[v274] 双写optimization_events成功: logId=${logId}, category=${resolvedCategory}, keywordId=${extractedKeywordId || 'N/A'}, apiSyncStatus=${finalApiSyncStatus}`);
  } catch (e) {
    log.error('[v212] 双写optimization_events失败:', (e instanceof Error ? (e as Error).message : String(e)) || e);
    log.error(`[v212] 双写失败详情: logCategory=${data.logCategory} actionType=${data.actionType}`);
  }
  
  return logId;
}

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
    // @ts-ignore
    conditions.push(eq(optimizationLogs.logCategory, category as unknown));
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
export async function insertOptimizationEvent(event: InsertOptimizationEvent): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // v222: campaignId 安全守卫
  if (event.campaignId != null) {
    const { quickValidateCampaignId } = await import('./utils/campaignIdResolver');
    // @ts-ignore
    event.campaignId = quickValidateCampaignId(event.campaignId, 'insertOptimizationEvent') as unknown;
  }
  
  const result = await db.insert(optimizationEvents).values(event);
  return result[0].insertId;
}

/**
 * 批量插入优化事件
 * v222: 自动验证并解析 campaignId
 */
export async function batchInsertOptimizationEvents(events: InsertOptimizationEvent[]): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (events.length === 0) return 0;
  
  // v222: 批量 campaignId 安全守卫
  const { quickValidateCampaignId } = await import('./utils/campaignIdResolver');
  for (const event of events) {
    if (event.campaignId != null) {
      // @ts-ignore
      event.campaignId = quickValidateCampaignId(event.campaignId, 'batchInsertOptimizationEvents') as unknown;
    }
  }
  
  await db.insert(optimizationEvents).values(events);
  return events.length;
}

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
  if (params.campaignId) conditions.push(eq(optimizationEvents.campaignId, params.campaignId));
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
export async function migrateFromBiddingLogs(accountId: number): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const oldLogs = await db.select().from(biddingLogs)
    .where(eq(biddingLogs.accountId, accountId))
    .orderBy(desc(biddingLogs.createdAt));
  
  if (oldLogs.length === 0) return 0;
  
  // @ts-ignore
  const events: InsertOptimizationEvent[] = oldLogs.map(log => ({
    accountId: log.accountId,
    eventCategory: 'bid_adjustment' as const,
    actionType: log.actionType === 'increase' ? 'bid_increase' as const : 
                log.actionType === 'decrease' ? 'bid_decrease' as const : 'bid_set' as const,
    campaignId: log.campaignId,
    adGroupId: log.adGroupId,
    keywordId: log.targetId,
    targetName: log.targetName,
    previousBid: log.previousBid,
    newBid: log.newBid,
    bidChangePercent: log.bidChangePercent,
    changeReason: log.reason,
    status: log.executionStatus === 'success' ? 'success' as const : 
            log.executionStatus === 'failed' ? 'failed' as const : 'pending' as const,
    apiSyncStatus: log.executionStatus === 'success' ? 'synced' as const :
                   log.executionStatus === 'failed' ? 'failed' as const : 'pending' as const,
    apiResponseId: log.apiResponseId,
    errorMessage: log.errorMessage,
    sourceTable: 'bidding_logs',
    sourceId: log.id,
    createdAt: log.createdAt,
  } as Record<string, any>));
  
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
  
  // @ts-ignore
  await db.insert(optimizationEvents).values(events as unknown);
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
  
  // @ts-ignore
  const events: InsertOptimizationEvent[] = oldLogs.map(log => {
    const mappedCategory = categoryMap[log.logCategory || ''] || 'settings_change';
    const mappedAction = actionTypeMap[log.actionType || ''] || 'settings_update';
    
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
    await db.insert(optimizationEvents).values(batch);
    migrated += batch.length;
  }
  
  return migrated;
}

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
        let totalBiddingLogs = 0;
        for (const account of (accounts as any[])) {
          totalBiddingLogs += await migrateFromBiddingLogs(account.id);
        }
        migrated.biddingLogs = totalBiddingLogs;
      } catch (err: unknown) {
        log.error('[AutoMigration] bidding_logs migration error:', (err as Error).message);
        skipped.push(`bidding_logs (error: ${(err as Error).message})`);
      }
    }
    
    // 2. 迁移 bid_adjustment_history
    if (migratedSources.has('bid_adjustment_history')) {
      skipped.push('bid_adjustment_history (already migrated)');
    } else {
      try {
        const accounts = await getAdAccounts();
        let totalBidHistory = 0;
        for (const account of (accounts as any[])) {
          totalBidHistory += await migrateFromBidAdjustmentHistory(account.id);
        }
        migrated.bidAdjustmentHistory = totalBidHistory;
      } catch (err: unknown) {
        log.error('[AutoMigration] bid_adjustment_history migration error:', (err as Error).message);
        skipped.push(`bid_adjustment_history (error: ${(err as Error).message})`);
      }
    }
    
    // 3. 迁移 optimization_logs（按 performance group）
    if (migratedSources.has('optimization_logs')) {
      skipped.push('optimization_logs (already migrated)');
    } else {
      try {
        const accounts = await getAdAccounts();
        let totalOptLogs = 0;
        for (const account of (accounts as any[])) {
          const groups = await getPerformanceGroupsByAccountId(account.id);
          for (const group of groups) {
            totalOptLogs += await migrateFromOptimizationLogs(group.id);
          }
        }
        migrated.optimizationLogs = totalOptLogs;
      } catch (err: unknown) {
        log.error('[AutoMigration] optimization_logs migration error:', (err as Error).message);
        skipped.push(`optimization_logs (error: ${(err as Error).message})`);
      }
    }
    
    const totalMigrated = Object.values(migrated).reduce((a: any, b: any) => a + b, 0);
    log.info(`[AutoMigration] 完成: 共迁移 ${totalMigrated} 条记录`, { migrated, skipped });
    
    return { success: true, migrated, skipped };
  } catch (err: unknown) {
    log.error('[AutoMigration] 全局迁移失败:', (err as Error).message);
    return { success: false, migrated, skipped: [...skipped, (err as Error).message] };
  }
}


/**
 * 获取优化目标的趋势对比数据（加入前 vs 加入后）
 * 用于科学计算目标达成度
 */
export async function getGoalProgressTrendData(performanceGroupId: number, groupCreatedAt: string) {
  const db = await getDb();
  if (!db) return { before: null, after: null };
  
  const createdDate = new Date(groupCreatedAt).toISOString().split('T')[0];
  
  try {
    // 获取该优化目标关联的所有广告活动的内部ID
    // v263: 修复关键Bug — 必须同时select campaignId字段，之前只select了id导致campaignIds全为undefined
    const groupCampaigns = await db.select({ id: campaigns.id, campaignId: campaigns.campaignId })
      .from(campaigns)
      .where(eq(campaigns.performanceGroupId, performanceGroupId));
    
    if (groupCampaigns.length === 0) return { before: null, after: null };
    
    const campaignIds = groupCampaigns.map(c => c.campaignId);
    
    // 加入前的数据（优化目标创建日期之前）
    const beforeData = await db.select({
      days: sql<number>`COUNT(DISTINCT ${dailyPerformance.date})`,
      totalSpend: sql<number>`COALESCE(SUM(${dailyPerformance.spend}), 0)`,
      totalSales: sql<number>`COALESCE(SUM(${dailyPerformance.sales}), 0)`,
      totalOrders: sql<number>`COALESCE(SUM(${dailyPerformance.orders}), 0)`,
      totalClicks: sql<number>`COALESCE(SUM(${dailyPerformance.clicks}), 0)`,
      totalImpressions: sql<number>`COALESCE(SUM(${dailyPerformance.impressions}), 0)`,
    })
    .from(dailyPerformance)
    .where(and(
      inArray(dailyPerformance.campaignId, campaignIds),
      sql`${dailyPerformance.date} < ${createdDate}`
    ));
    
    // 加入后的数据（优化目标创建日期及之后）
    const afterData = await db.select({
      days: sql<number>`COUNT(DISTINCT ${dailyPerformance.date})`,
      totalSpend: sql<number>`COALESCE(SUM(${dailyPerformance.spend}), 0)`,
      totalSales: sql<number>`COALESCE(SUM(${dailyPerformance.sales}), 0)`,
      totalOrders: sql<number>`COALESCE(SUM(${dailyPerformance.orders}), 0)`,
      totalClicks: sql<number>`COALESCE(SUM(${dailyPerformance.clicks}), 0)`,
      totalImpressions: sql<number>`COALESCE(SUM(${dailyPerformance.impressions}), 0)`,
    })
    .from(dailyPerformance)
    .where(and(
      inArray(dailyPerformance.campaignId, campaignIds),
      sql`${dailyPerformance.date} >= ${createdDate}`
    ));
    
    const before = beforeData[0] || null;
    const after = afterData[0] || null;
    
    return { before, after };
  } catch (error) {
    log.error(`[getGoalProgressTrendData] Error for group ${performanceGroupId}:`, error);
    return { before: null, after: null };
  }
}


/**
 * v164: 获取多时间窗口趋势数据，用于渐进式优化进度评估
 * 返回7天、14天、30天、60天、90天以及优化前的分别汇总数据
 */
export async function getMultiWindowTrendData(performanceGroupId: number, groupCreatedAt: string) {
  const db = await getDb();
  if (!db) return null;
  
  try {
    // v263: 修复关键Bug — 必须同时select campaignId字段，之前只select了id导致campaignIds全为undefined
    const groupCampaigns = await db.select({ id: campaigns.id, campaignId: campaigns.campaignId })
      .from(campaigns)
      .where(eq(campaigns.performanceGroupId, performanceGroupId));
    
    if (groupCampaigns.length === 0) return null;
    
    const campaignIds = groupCampaigns.map(c => c.campaignId);
    const createdDate = new Date(groupCreatedAt).toISOString().split('T')[0];
    const now = new Date();
    
    const getWindowData = async (daysBack: number) => {
      const startDate = new Date(now);
      startDate.setDate(startDate.getDate() - daysBack);
      const startStr = startDate.toISOString().split('T')[0];
      
      const result = await db.select({
        days: sql<number>`COUNT(DISTINCT ${dailyPerformance.date})`,
        totalSpend: sql<number>`COALESCE(SUM(${dailyPerformance.spend}), 0)`,
        totalSales: sql<number>`COALESCE(SUM(${dailyPerformance.sales}), 0)`,
        totalOrders: sql<number>`COALESCE(SUM(${dailyPerformance.orders}), 0)`,
        totalClicks: sql<number>`COALESCE(SUM(${dailyPerformance.clicks}), 0)`,
        totalImpressions: sql<number>`COALESCE(SUM(${dailyPerformance.impressions}), 0)`,
      })
      .from(dailyPerformance)
      .where(and(
        inArray(dailyPerformance.campaignId, campaignIds),
        sql`${dailyPerformance.date} >= ${startStr}`
      ));
      
      return result[0] || null;
    };
    
    // 获取优化前数据
    const preOptData = await db.select({
      days: sql<number>`COUNT(DISTINCT ${dailyPerformance.date})`,
      totalSpend: sql<number>`COALESCE(SUM(${dailyPerformance.spend}), 0)`,
      totalSales: sql<number>`COALESCE(SUM(${dailyPerformance.sales}), 0)`,
      totalOrders: sql<number>`COALESCE(SUM(${dailyPerformance.orders}), 0)`,
      totalClicks: sql<number>`COALESCE(SUM(${dailyPerformance.clicks}), 0)`,
      totalImpressions: sql<number>`COALESCE(SUM(${dailyPerformance.impressions}), 0)`,
    })
    .from(dailyPerformance)
    .where(and(
      inArray(dailyPerformance.campaignId, campaignIds),
      sql`${dailyPerformance.date} < ${createdDate}`
    ));
    
    const [recent7d, recent14d, recent30d, recent60d, recent90d] = await Promise.all([
      getWindowData(7),
      getWindowData(14),
      getWindowData(30),
      getWindowData(60),
      getWindowData(90),
    ]);
    
    return {
      recent7d,
      recent14d,
      recent30d,
      recent60d,
      recent90d,
      preOptimization: preOptData[0] || null,
    };
  } catch (error) {
    log.error(`[getMultiWindowTrendData] Error for group ${performanceGroupId}:`, error);
    return null;
  }
}

/**
 * v164: 获取时间衰减加权指标，用于目标达成度评估
 * 从dailyPerformance表获取90天数据，按时间衰减加权计算
 */
export async function getTimeWeightedMetricsForGoalProgress(performanceGroupId: number) {
  const db = await getDb();
  if (!db) return null;
  
  try {
    // v263: 修复关键Bug — 必须同时select campaignId字段，之前只select了id导致campaignIds全为undefined
    const groupCampaigns = await db.select({ id: campaigns.id, campaignId: campaigns.campaignId })
      .from(campaigns)
      .where(eq(campaigns.performanceGroupId, performanceGroupId));
    
    if (groupCampaigns.length === 0) return null;
    
    const campaignIds = groupCampaigns.map(c => c.campaignId);
    const now = new Date();
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - 90);
    const startStr = startDate.toISOString().split('T')[0];
    
    // 获取每日汇总数据
    const dailyData = await db.select({
      date: dailyPerformance.date,
      spend: sql<number>`COALESCE(SUM(${dailyPerformance.spend}), 0)`,
      sales: sql<number>`COALESCE(SUM(${dailyPerformance.sales}), 0)`,
      orders: sql<number>`COALESCE(SUM(${dailyPerformance.orders}), 0)`,
      clicks: sql<number>`COALESCE(SUM(${dailyPerformance.clicks}), 0)`,
      impressions: sql<number>`COALESCE(SUM(${dailyPerformance.impressions}), 0)`,
    })
    .from(dailyPerformance)
    .where(and(
      inArray(dailyPerformance.campaignId, campaignIds),
      sql`${dailyPerformance.date} >= ${startStr}`
    ))
    .groupBy(dailyPerformance.date)
    .orderBy(dailyPerformance.date);
    
    if (dailyData.length === 0) return null;
    
    // 时间衰减权重计算
    const TIME_DECAY_WEIGHTS = [
      { maxDaysAgo: 3, weight: 1.0 },
      { maxDaysAgo: 7, weight: 0.85 },
      { maxDaysAgo: 14, weight: 0.65 },
      { maxDaysAgo: 30, weight: 0.40 },
      { maxDaysAgo: 60, weight: 0.20 },
      { maxDaysAgo: 90, weight: 0.08 },
    ];
    
    // 归因修正系数（最近7天数据可能不完整）
    const ATTRIBUTION_CORRECTION = [
      { daysAgo: 1, factor: 1.80 },
      { daysAgo: 2, factor: 1.50 },
      { daysAgo: 3, factor: 1.30 },
      { daysAgo: 4, factor: 1.20 },
      { daysAgo: 5, factor: 1.15 },
      { daysAgo: 6, factor: 1.10 },
      { daysAgo: 7, factor: 1.05 },
    ];
    
    let weightedSpend = 0;
    let weightedSales = 0;
    let weightedOrders = 0;
    let weightedClicks = 0;
    let weightedImpressions = 0;
    let totalWeight = 0;
    let effectiveDataDays = 0;
    let totalClicksRaw = 0;
    
    // 近7天和近30天分别汇总（用于趋势判断）
    let recent7dSpend = 0, recent7dSales = 0;
    let recent30dSpend = 0, recent30dSales = 0;
    
    for (const day of dailyData) {
      const dayDate = new Date(day.date as string);
      const daysAgo = Math.floor((now.getTime() - dayDate.getTime()) / (1000 * 60 * 60 * 24));
      
      // 确定时间衰减权重
      let weight = 0.08;
      for (const tw of TIME_DECAY_WEIGHTS) {
        if (daysAgo <= tw.maxDaysAgo) {
          weight = tw.weight;
          break;
        }
      }
      
      // 归因修正
      let attributionFactor = 1.0;
      for (const ac of ATTRIBUTION_CORRECTION) {
        if (daysAgo <= ac.daysAgo) {
          attributionFactor = ac.factor;
          break;
        }
      }
      
      const spend = Number(day.spend) || 0;
      const sales = (Number(day.sales) || 0) * attributionFactor;
      const orders = (Number(day.orders) || 0) * attributionFactor;
      const clicks = Number(day.clicks) || 0;
      const impressions = Number(day.impressions) || 0;
      
      weightedSpend += spend * weight;
      weightedSales += sales * weight;
      weightedOrders += orders * weight;
      weightedClicks += clicks * weight;
      weightedImpressions += impressions * weight;
      totalWeight += weight;
      totalClicksRaw += clicks;
      
      if (spend > 0 || clicks > 0) effectiveDataDays++;
      
      if (daysAgo <= 7) { recent7dSpend += spend; recent7dSales += sales; }
      if (daysAgo <= 30) { recent30dSpend += spend; recent30dSales += sales; }
    }
    
    if (totalWeight === 0) return null;
    
    const weightedDailySpend = weightedSpend / totalWeight;
    const weightedDailySales = weightedSales / totalWeight;
    const weightedDailyOrders = weightedOrders / totalWeight;
    const weightedAcos = weightedSales > 0 ? (weightedSpend / weightedSales) * 100 : 0;
    const weightedRoas = weightedSpend > 0 ? weightedSales / weightedSpend : 0;
    const weightedCvr = weightedClicks > 0 ? (weightedOrders / weightedClicks) * 100 : 0;
    const weightedCpc = weightedClicks > 0 ? weightedSpend / weightedClicks : 0;
    
    // 数据置信度
    let dataConfidence: 'high' | 'medium' | 'low' | 'very_low';
    if (effectiveDataDays >= 30 && totalClicksRaw >= 200) dataConfidence = 'high';
    else if (effectiveDataDays >= 14 && totalClicksRaw >= 50) dataConfidence = 'medium';
    else if (effectiveDataDays >= 7 && totalClicksRaw >= 10) dataConfidence = 'low';
    else dataConfidence = 'very_low';
    
    // 趋势方向
    let trendDirection: 'improving' | 'stable' | 'declining';
    const recent7dRoas = recent7dSpend > 0 ? recent7dSales / recent7dSpend : 0;
    const recent30dRoas = recent30dSpend > 0 ? recent30dSales / recent30dSpend : 0;
    
    if (recent30dRoas > 0) {
      const roasChange = (recent7dRoas - recent30dRoas) / recent30dRoas;
      if (roasChange > 0.05) trendDirection = 'improving';
      else if (roasChange < -0.05) trendDirection = 'declining';
      else trendDirection = 'stable';
    } else {
      trendDirection = recent7dRoas > 0 ? 'improving' : 'stable';
    }
    
    return {
      weightedAcos,
      weightedRoas,
      weightedDailySpend,
      weightedDailySales,
      weightedDailyOrders,
      weightedCvr,
      weightedCpc,
      dataConfidence,
      trendDirection,
      effectiveDataDays,
    };
  } catch (error) {
    log.error(`[getTimeWeightedMetricsForGoalProgress] Error for group ${performanceGroupId}:`, error);
    return null;
  }
}


/**
 * v330: 冷启动出价优化 R-02第二步 — 获取账户级别平均指标
 * 计算过去30天该账户下所有营销活动的总订单数和总点击数，
 * 得出一个真实的账户级别平均CVR，比固定的全局默认值更具代表性。
 */
export async function getAccountLevelMetrics(accountId: number): Promise<{
  totalClicks: number;
  totalOrders: number;
  totalSpend: number;
  totalSales: number;
  accountAvgCvr: number;
  accountAvgCpc: number;
  accountAvgAov: number;
} | null> {
  try {
    const dbConn = await getDb();
    if (!dbConn) return null;
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const result = await dbConn
      .select({
        totalClicks: sql<number>`COALESCE(SUM(${dailyPerformance.clicks}), 0)`,
        totalOrders: sql<number>`COALESCE(SUM(${dailyPerformance.orders}), 0)`,
        totalSpend: sql<string>`COALESCE(SUM(${dailyPerformance.spend}), '0')`,
        totalSales: sql<string>`COALESCE(SUM(${dailyPerformance.sales}), '0')`,
      })
      .from(dailyPerformance)
      .where(
        and(
          eq(dailyPerformance.accountId, accountId),
          gte(dailyPerformance.date, thirtyDaysAgo.toISOString().split('T')[0])
        )
      );
    
    const row = result[0] as any;
    if (!row || row.totalClicks === 0) return null;
    
    const totalClicks = Number(row.totalClicks);
    const totalOrders = Number(row.totalOrders);
    const totalSpend = parseFloat(row.totalSpend as string);
    const totalSales = parseFloat(row.totalSales as string);
    
    return {
      totalClicks,
      totalOrders,
      totalSpend,
      totalSales,
      accountAvgCvr: totalClicks > 0 ? totalOrders / totalClicks : 0,
      accountAvgCpc: totalClicks > 0 ? totalSpend / totalClicks : 0,
      accountAvgAov: totalOrders > 0 ? totalSales / totalOrders : 0,
    };
  } catch (error) {
    log.error(`[getAccountLevelMetrics] Error for account ${accountId}:`, error);
    return null;
  }
}

/**
 * v330: 冷启动出价优化 R-03 — 获取跨活动品类平均CVR
 * 查询该账户下所有属于同一品类的其他营销活动的近期(过去30天)表现，
 * 使用这些活动的聚合数据来计算一个"跨活动品类平均CVR"作为先验值。
 */
export async function getCrossCampaignCategoryMetrics(
  accountId: number,
  excludePerformanceGroupId?: number
): Promise<{
  totalClicks: number;
  totalOrders: number;
  crossCampaignCvr: number;
} | null> {
  try {
    const dbConn = await getDb();
    if (!dbConn) return null;
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    // 查询该账户下所有营销活动的近30天聚合表现
    const result = await dbConn
      .select({
        totalClicks: sql<number>`COALESCE(SUM(${dailyPerformance.clicks}), 0)`,
        totalOrders: sql<number>`COALESCE(SUM(${dailyPerformance.orders}), 0)`,
      })
      .from(dailyPerformance)
      .where(
        and(
          eq(dailyPerformance.accountId, accountId),
          gte(dailyPerformance.date, thirtyDaysAgo.toISOString().split('T')[0]),
          // 排除当前优化目标的数据，避免自引用
          excludePerformanceGroupId
            ? sql`${dailyPerformance.performanceGroupId} != ${excludePerformanceGroupId}`
            : sql`1=1`
        )
      );
    
    const row = result[0] as any;
    if (!row || Number(row.totalClicks) === 0) return null;
    
    const totalClicks = Number(row.totalClicks);
    const totalOrders = Number(row.totalOrders);
    
    return {
      totalClicks,
      totalOrders,
      crossCampaignCvr: totalClicks > 0 ? totalOrders / totalClicks : 0,
    };
  } catch (error) {
    log.error(`[getCrossCampaignCategoryMetrics] Error for account ${accountId}:`, error);
    return null;
  }
}
