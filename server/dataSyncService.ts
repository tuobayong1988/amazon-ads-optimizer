import { createModuleLogger } from "./utils/logger";
const log = createModuleLogger("DataSync");
/**
 * @deprecated v361: 此模块已废弃，功能已被AmazonSyncService和dataSyncScheduler完全覆盖。
 * 请使用 server/amazonSyncService.ts 作为统一的同步入口。
 * 计划在v362中删除此文件。
 * 
 * Data Sync Service - 广告数据自动同步服务
 * 今Amazon API拉取广告活动、关键词和绩效数据
 * 包含API调用限流机制
 */

import { eq, and, desc, sql } from "drizzle-orm";
import { getDb } from "./db";
import {
  dataSyncJobs,
  dataSyncLogs,
  apiRateLimits,
  adAccounts,
} from "../drizzle/schema";

// 定义类型
type InsertDataSyncJob = typeof dataSyncJobs.$inferInsert;
type InsertDataSyncLog = typeof dataSyncLogs.$inferInsert;
// v187: AmazonAdsApiClient不再直接使用，同步逻辑已委托给AmazonSyncService

export type SyncType = "campaigns" | "keywords" | "performance" | "all";
export type SyncStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

// API限流配置
const RATE_LIMITS = {
  requestsPerSecond: 5,
  requestsPerMinute: 100,
  requestsPerHour: 1000,
  burstLimit: 10,
};

// 请求队列
interface QueuedRequest {
  id: string;
  accountId: number;
  endpoint: string;
  method: string;
  params?: unknown;
  resolve: (value: Record<string, any>) => void;
  reject: (error: Error) => void;
  priority: number;
  addedAt: number;
}

/** @deprecated v360: 已废弃，统一使用 apiRateLimitService.ts 中的 ApiRateLimitService。保留代码仅为向后兼容，实际限流已由统一服务处理 */
class RateLimiter {
  private queue: QueuedRequest[] = [];
  private requestCounts = { second: 0, minute: 0, hour: 0 };
  private lastReset = { second: Date.now(), minute: Date.now(), hour: Date.now() };
  private processing = false;

  async enqueue(request: Omit<QueuedRequest, "id" | "addedAt" | "resolve" | "reject">): Promise<any> {
    return new Promise((resolve, reject) => {
      this.queue.push({
        ...request,
        id: `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        addedAt: Date.now(),
        resolve,
        reject,
      });
      this.queue.sort((a: any, b: any) => b.priority - a.priority);
      this.processQueue();
    });
  }

  private async processQueue() {
    if (this.processing || this.queue.length === 0) return;
    this.processing = true;
    while (this.queue.length > 0) {
      this.resetCountersIfNeeded();
      if (!this.canMakeRequest()) {
        await this.waitForSlot();
        continue;
      }
      const request = this.queue.shift();
      if (!request) continue;
      try {
        this.incrementCounters();
        const result = await this.executeRequest(request);
        request.resolve(result);
      } catch (error) {
        // @ts-ignore
        request.reject(error);
      }
      await this.delay(200);
    }
    this.processing = false;
  }

  private resetCountersIfNeeded() {
    const now = Date.now();
    if (now - this.lastReset.second >= 1000) { this.requestCounts.second = 0; this.lastReset.second = now; }
    if (now - this.lastReset.minute >= 60000) { this.requestCounts.minute = 0; this.lastReset.minute = now; }
    if (now - this.lastReset.hour >= 3600000) { this.requestCounts.hour = 0; this.lastReset.hour = now; }
  }

  private canMakeRequest(): boolean {
    return this.requestCounts.second < RATE_LIMITS.requestsPerSecond &&
           this.requestCounts.minute < RATE_LIMITS.requestsPerMinute &&
           this.requestCounts.hour < RATE_LIMITS.requestsPerHour;
  }

  private incrementCounters() {
    this.requestCounts.second++;
    this.requestCounts.minute++;
    this.requestCounts.hour++;
  }

  private async waitForSlot(): Promise<void> {
    const waitTime = this.requestCounts.second >= RATE_LIMITS.requestsPerSecond ? 1000 - (Date.now() - this.lastReset.second) :
                     this.requestCounts.minute >= RATE_LIMITS.requestsPerMinute ? 60000 - (Date.now() - this.lastReset.minute) :
                     3600000 - (Date.now() - this.lastReset.hour);
    await this.delay(Math.max(waitTime, 100));
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async executeRequest(request: QueuedRequest): Promise<any> {
    // 模拟API调用（实际实现需要调用Amazon API）
    return { success: true, endpoint: request.endpoint, timestamp: Date.now() };
  }

  getQueueStatus() {
    return { queueLength: this.queue.length, requestCounts: { ...this.requestCounts }, limits: RATE_LIMITS };
  }
}

const rateLimiter = new RateLimiter();

/**
 * 创建同步任务
 */
export async function createSyncJob(userId: number, accountId: number, syncType: SyncType = "all"): Promise<number | null> {
  log.warn(`[DEPRECATED] dataSyncService.createSyncJob已废弃，请使用amazonSyncService替代`);
  const db = await getDb();
  if (!db) return null;
  const jobData: InsertDataSyncJob = { userId, accountId, syncType, status: "pending" };
  const result = await db.insert(dataSyncJobs).values(jobData);
  return result[0].insertId;
}

/**
 * 执行同步任务
 */
export async function executeSyncJob(jobId: number): Promise<{ success: boolean; message: string; stats?: unknown }> {
  log.warn(`[DEPRECATED] dataSyncService.executeSyncJob已废弃，请使用amazonSyncService替代`);
  const db = await getDb();
  if (!db) return { success: false, message: "数据库连接失败" };

  const job = await db.select().from(dataSyncJobs).where(eq(dataSyncJobs.id, jobId)).limit(1);
  if (!job[0]) return { success: false, message: "任务不存在" };

  const jobRecord = job[0] as any;
  await db.update(dataSyncJobs).set({ status: "running", startedAt: new Date().toISOString() }).where(eq(dataSyncJobs.id, jobId));

  const stats = { campaigns: 0, keywords: 0, performance: 0, errors: 0 };

  try {
    // 获取账号信息
    const account = await db.select().from(adAccounts).where(eq(adAccounts.id, jobRecord.accountId)).limit(1);
    if (!account[0]) throw new Error("账号不存在");

    // 根据同步类型执行不同的同步操作
    if (jobRecord.syncType === "campaigns" || jobRecord.syncType === "all") {
      const campaignResult = await syncCampaigns(jobRecord.userId, jobRecord.accountId, account[0]);
      stats.campaigns = campaignResult.count;
      await logSyncActivity(jobId, "campaigns", campaignResult.success ? "success" : "error", campaignResult.message);
    }

    if (jobRecord.syncType === "keywords" || jobRecord.syncType === "all") {
      const keywordResult = await syncKeywords(jobRecord.userId, jobRecord.accountId, account[0]);
      stats.keywords = keywordResult.count;
      await logSyncActivity(jobId, "keywords", keywordResult.success ? "success" : "error", keywordResult.message);
    }

    if (jobRecord.syncType === "performance" || jobRecord.syncType === "all") {
      const perfResult = await syncPerformance(jobRecord.userId, jobRecord.accountId, account[0]);
      stats.performance = perfResult.count;
      await logSyncActivity(jobId, "performance", perfResult.success ? "success" : "error", perfResult.message);
    }

    await db.update(dataSyncJobs).set({
      status: "completed",
      completedAt: new Date().toISOString(),
      recordsSynced: stats.campaigns + stats.keywords + stats.performance,
    }).where(eq(dataSyncJobs.id, jobId));

    return { success: true, message: "同步完成", stats };
  } catch (error: unknown) {
    await db.update(dataSyncJobs).set({
      status: "failed",
      completedAt: new Date().toISOString(),
      errorMessage: (error as Error).message,
    }).where(eq(dataSyncJobs.id, jobId));

    await logSyncActivity(jobId, "error", "error", (error as Error).message);
    return { success: false, message: (error as Error).message };
  }
}

/**
 * 同步广告活动
 * v187: 已移除mock数据，委托给AmazonSyncService执行真实API同步
 * 此函数作为轻量级封装，实际同步逻辑在amazonSyncService.ts中
 */
async function syncCampaigns(userId: number, accountId: number, account: any): Promise<{ success: boolean; count: number; message: string }> {
  try {
    const { AmazonSyncService } = await import('./amazonSyncService');
    // 从账号信息创建SyncService实例
    const syncService = await AmazonSyncService.createFromCredentials(
      {
        clientId: account.clientId,
        clientSecret: account.clientSecret,
        refreshToken: account.refreshToken,
        profileId: account.profileId,
        region: account.region || 'NA',
      },
      accountId,
      userId,
      account.marketplace || 'US'
    );
    const result = await syncService.syncCampaignsOnly();
    return { 
      success: true, 
      count: result?.campaigns || 0, 
      message: `通过Amazon API同步了${result?.campaigns || 0}个广告活动` 
    };
  } catch (error: unknown) {
    log.error(`[dataSyncService] syncCampaigns失败 accountId=${accountId}:`, (error as Error).message);
    return { success: false, count: 0, message: (error as Error).message };
  }
}

/**
 * 同步关键词
 * v187: 已移除mock数据，委托给AmazonSyncService执行真实API同步
 * 关键词同步包含在syncAll流程中，这里执行完整同步并返回关键词数量
 */
async function syncKeywords(userId: number, accountId: number, account: any): Promise<{ success: boolean; count: number; message: string }> {
  try {
    const { AmazonSyncService } = await import('./amazonSyncService');
    const syncService = await AmazonSyncService.createFromCredentials(
      {
        clientId: account.clientId,
        clientSecret: account.clientSecret,
        refreshToken: account.refreshToken,
        profileId: account.profileId,
        region: account.region || 'NA',
      },
      accountId,
      userId,
      account.marketplace || 'US'
    );
    // syncAll包含关键词同步，返回关键词数量
    const result = await syncService.syncAll({ syncMode: 'daily' });
    return { 
      success: true, 
      count: result?.keywords || 0, 
      message: `通过Amazon API同步了${result?.keywords || 0}个关键词` 
    };
  } catch (error: unknown) {
    log.error(`[dataSyncService] syncKeywords失败 accountId=${accountId}:`, (error as Error).message);
    return { success: false, count: 0, message: (error as Error).message };
  }
}

/**
 * 同步绩效数据
 * v187: 已移除mock数据，委托给AmazonSyncService执行真实API同步
 */
async function syncPerformance(userId: number, accountId: number, account: any): Promise<{ success: boolean; count: number; message: string }> {
  try {
    const { AmazonSyncService } = await import('./amazonSyncService');
    const syncService = await AmazonSyncService.createFromCredentials(
      {
        clientId: account.clientId,
        clientSecret: account.clientSecret,
        refreshToken: account.refreshToken,
        profileId: account.profileId,
        region: account.region || 'NA',
      },
      accountId,
      userId,
      account.marketplace || 'US'
    );
    const result = await syncService.syncPerformanceOnly();
    return { 
      success: true, 
      count: result?.performance || 0, 
      message: `通过Amazon API同步了${result?.performance || 0}条绩效数据` 
    };
  } catch (error: unknown) {
    log.error(`[dataSyncService] syncPerformance失败 accountId=${accountId}:`, (error as Error).message);
    return { success: false, count: 0, message: (error as Error).message };
  }
}

/**
 * 记录同步日志
 */
async function logSyncActivity(jobId: number, operation: string, status: string, message: string, details?: any) {
  const db = await getDb();
  if (!db) return;
  // @ts-ignore
  await db.insert(dataSyncLogs).values({
    jobId,
    operation,
    status: status as string,
    message,
    details: details ? JSON.stringify(details) : null,
  });
}

/**
 * 获取同步任务列表
 */
export async function getSyncJobs(userId: number, options: { accountId?: number; status?: SyncStatus; limit?: number; offset?: number } = {}) {
  const db = await getDb();
  if (!db) return { jobs: [], total: 0 };
  const conditions = [eq(dataSyncJobs.userId, userId)];
  if (options.accountId) conditions.push(eq(dataSyncJobs.accountId, options.accountId));
  if (options.status) conditions.push(eq(dataSyncJobs.status, options.status));
  const jobs = await db.select().from(dataSyncJobs).where(and(...conditions)).orderBy(desc(dataSyncJobs.createdAt)).limit(options.limit || 50).offset(options.offset || 0);
  const countResult = await db.select({ count: sql<number>`count(*)` }).from(dataSyncJobs).where(and(...conditions));
  return { jobs, total: countResult[0]?.count || 0 };
}

/**
 * 获取同步任务日志
 */
export async function getSyncLogs(jobId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(dataSyncLogs).where(eq(dataSyncLogs.jobId, jobId)).orderBy(dataSyncLogs.createdAt);
}

/**
 * 取消同步任务
 */
export async function cancelSyncJob(jobId: number, userId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  await db.update(dataSyncJobs).set({ status: "cancelled" }).where(and(eq(dataSyncJobs.id, jobId), eq(dataSyncJobs.userId, userId), eq(dataSyncJobs.status, "pending")));
  return true;
}

/**
 * 获取API限流状态
 */
export function getRateLimitStatus() {
  return rateLimiter.getQueueStatus();
}

/**
 * 记录API调用限流信息
 */
export async function recordApiRateLimit(accountId: number, apiType: string, requestCount: number, _limitReached: boolean) {
  const db = await getDb();
  if (!db) return;
  // @ts-ignore
  await db.insert(apiRateLimits).values({
    accountId,
    apiType: apiType as unknown,
    currentSecondCount: requestCount,
    currentMinuteCount: requestCount,
    currentDayCount: requestCount,
  });
}

/**
 * 获取账号的API调用统计
 */
export async function getApiUsageStats(accountId: number) {
  const db = await getDb();
  if (!db) return null;
  const oneHourAgo = new Date(Date.now() - 3600000);
  const stats = await db.select({
    totalRequests: sql<number>`SUM(${apiRateLimits.currentDayCount})`,
    recordCount: sql<number>`COUNT(*)`,
  }).from(apiRateLimits).where(and(eq(apiRateLimits.accountId, accountId), sql`${apiRateLimits.updatedAt} >= ${oneHourAgo}`));
  return { totalRequests: stats[0]?.totalRequests || 0, recordCount: stats[0]?.recordCount || 0, limits: RATE_LIMITS };
}


// ==================== 定时调度功能 ====================

export type ScheduleFrequency = "hourly" | "every_2_hours" | "every_4_hours" | "every_6_hours" | "every_12_hours" | "daily" | "weekly" | "monthly";

export interface SyncScheduleConfig {
  id?: number;
  userId: number;
  accountId: number;
  syncType: SyncType;
  frequency: ScheduleFrequency;
  hour?: number; // 0-23，每日/每周/每月执行的小时
  dayOfWeek?: number; // 0-6，每周执行的星期几（0=周日）
  dayOfMonth?: number; // 1-31，每月执行的日期
  isEnabled: boolean;
  lastRunAt?: Date;
  nextRunAt?: Date;
}

/**
 * 创建同步调度配置
 */
export async function createSyncSchedule(config: SyncScheduleConfig): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;

  // 计算下次执行时间
  const nextRunAt = calculateNextRunTime(config);

  const result = await db.execute(sql`
    INSERT INTO sync_schedules (user_id, account_id, sync_type, frequency, hour, day_of_week, day_of_month, is_enabled, next_run_at)
    VALUES (${config.userId}, ${config.accountId}, ${config.syncType}, ${config.frequency}, ${config.hour ?? 0}, ${config.dayOfWeek ?? null}, ${config.dayOfMonth ?? null}, ${config.isEnabled}, ${nextRunAt})
  `);

  // @ts-ignore
  return (result as Record<string, any>[][])[0]?.insertId || null;
}

/**
 * 更新同步调度配置
 */
export async function updateSyncSchedule(id: number, userId: number, updates: Partial<SyncScheduleConfig>): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  // v361: 使用参数化查询替代sql.raw，彻底消除SQL注入风险
  const setParts: ReturnType<typeof sql>[] = [];
  if (updates.syncType !== undefined) setParts.push(sql`sync_type = ${updates.syncType}`);
  if (updates.frequency !== undefined) setParts.push(sql`frequency = ${updates.frequency}`);
  if (updates.hour !== undefined) setParts.push(sql`hour = ${updates.hour}`);
  if (updates.dayOfWeek !== undefined) setParts.push(sql`day_of_week = ${updates.dayOfWeek}`);
  if (updates.dayOfMonth !== undefined) setParts.push(sql`day_of_month = ${updates.dayOfMonth}`);
  if (updates.isEnabled !== undefined) setParts.push(sql`is_enabled = ${updates.isEnabled}`);
  if (setParts.length === 0) return true;
  const schedule = await getSyncScheduleById(id, userId);
  if (schedule) {
    const newConfig = { ...schedule, ...updates };
    const nextRunAt = calculateNextRunTime(newConfig as SyncScheduleConfig);
    setParts.push(sql`next_run_at = ${nextRunAt}`);
  }
  setParts.push(sql`updated_at = NOW()`);
  await db.execute(
    sql`UPDATE sync_schedules SET ${sql.join(setParts, sql`, `)} WHERE id = ${id} AND user_id = ${userId}`
  );
  return true;
}

/**
 * 删除同步调度配置
 */
export async function deleteSyncSchedule(id: number, userId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  await db.execute(sql`DELETE FROM sync_schedules WHERE id = ${id} AND user_id = ${userId}`);
  return true;
}

/**
 * 获取单个调度配置
 */
export async function getSyncScheduleById(id: number, userId: number): Promise<SyncScheduleConfig | null> {
  const db = await getDb();
  if (!db) return null;
  const result = await db.execute(sql`
    SELECT id, user_id as userId, account_id as accountId, sync_type as syncType, frequency, hour, day_of_week as dayOfWeek, day_of_month as dayOfMonth, is_enabled as isEnabled, last_run_at as lastRunAt, next_run_at as nextRunAt
    FROM sync_schedules WHERE id = ${id} AND user_id = ${userId}
  `);
  const rows = (result as Record<string, any>[][])[0];
  // @ts-ignore
  return rows?.[0] || null;
}

/**
 * 获取用户的所有调度配置
 */
export async function getSyncSchedules(userId: number, accountId?: number): Promise<SyncScheduleConfig[]> {
  const db = await getDb();
  if (!db) return [];
  
  let query = sql`
    SELECT id, user_id as userId, account_id as accountId, sync_type as syncType, frequency, hour, day_of_week as dayOfWeek, day_of_month as dayOfMonth, is_enabled as isEnabled, last_run_at as lastRunAt, next_run_at as nextRunAt
    FROM sync_schedules WHERE user_id = ${userId}
  `;
  
  if (accountId) {
    query = sql`
      SELECT id, user_id as userId, account_id as accountId, sync_type as syncType, frequency, hour, day_of_week as dayOfWeek, day_of_month as dayOfMonth, is_enabled as isEnabled, last_run_at as lastRunAt, next_run_at as nextRunAt
      FROM sync_schedules WHERE user_id = ${userId} AND account_id = ${accountId}
    `;
  }
  
  const result = await db.execute(query);
  // @ts-ignore
  return (result as Record<string, any>[][])[0] || [];
}

/**
 * 获取需要执行的调度任务
 */
export async function getDueSchedules(): Promise<SyncScheduleConfig[]> {
  const db = await getDb();
  if (!db) return [];
  const now = new Date();
  const result = await db.execute(sql`
    SELECT id, user_id as userId, account_id as accountId, sync_type as syncType, frequency, hour, day_of_week as dayOfWeek, day_of_month as dayOfMonth, is_enabled as isEnabled, last_run_at as lastRunAt, next_run_at as nextRunAt
    FROM sync_schedules WHERE is_enabled = true AND next_run_at <= ${now}
  `);
  // @ts-ignore
  return (result as Record<string, any>[][])[0] || [];
}

/**
 * 执行调度任务
 */
export async function executeScheduledSync(scheduleId: number): Promise<{ success: boolean; jobId?: number; message: string }> {
  const db = await getDb();
  if (!db) return { success: false, message: "数据库连接失败" };

  const result = await db.execute(sql`
    SELECT id, user_id as userId, account_id as accountId, sync_type as syncType, frequency, hour, day_of_week as dayOfWeek, day_of_month as dayOfMonth
    FROM sync_schedules WHERE id = ${scheduleId}
  `);
  const schedule = (result as Record<string, any>[][])[0]?.[0];
  if (!schedule) return { success: false, message: "调度配置不存在" };

  // 创建同步任务
  const jobId = await createSyncJob(schedule.userId, schedule.accountId, schedule.syncType);
  if (!jobId) return { success: false, message: "创建同步任务失败" };

  // 更新调度状态
  const nextRunAt = calculateNextRunTime(schedule as SyncScheduleConfig);
  await db.execute(sql`
    UPDATE sync_schedules SET last_run_at = NOW(), next_run_at = ${nextRunAt}, updated_at = NOW()
    WHERE id = ${scheduleId}
  `);

  // 异步执行同步任务
  executeSyncJob(jobId).catch((err) => log.error("[DataSync] executeSyncJob failed:", err));

  return { success: true, jobId, message: "同步任务已启动" };
}

/**
 * 计算下次执行时间
 */
export function calculateNextRunTime(config: SyncScheduleConfig): Date {
  const now = new Date();
  const next = new Date(now);
  const hour = config.hour ?? 0;

  switch (config.frequency) {
    case "hourly":
      next.setHours(next.getHours() + 1, 0, 0, 0);
      break;

    case "every_2_hours":
      next.setHours(next.getHours() + 2, 0, 0, 0);
      break;

    case "every_4_hours":
      next.setHours(next.getHours() + 4, 0, 0, 0);
      break;

    case "every_6_hours":
      next.setHours(next.getHours() + 6, 0, 0, 0);
      break;

    case "every_12_hours":
      next.setHours(next.getHours() + 12, 0, 0, 0);
      break;

    case "daily":
      next.setHours(hour, 0, 0, 0);
      if (next <= now) next.setDate(next.getDate() + 1);
      break;

    case "weekly":
      const dayOfWeek = config.dayOfWeek ?? 0;
      next.setHours(hour, 0, 0, 0);
      const daysUntilTarget = (dayOfWeek - next.getDay() + 7) % 7;
      next.setDate(next.getDate() + (daysUntilTarget === 0 && next <= now ? 7 : daysUntilTarget));
      break;

    case "monthly":
      const dayOfMonth = config.dayOfMonth ?? 1;
      next.setDate(dayOfMonth);
      next.setHours(hour, 0, 0, 0);
      if (next <= now) next.setMonth(next.getMonth() + 1);
      break;
  }

  return next;
}

/**
 * 运行调度检查（由外部定时器调用）
 */
export async function runScheduleCheck(): Promise<{ executed: number; failed: number }> {
  const dueSchedules = await getDueSchedules();
  let executed = 0;
  let failed = 0;

  for (const schedule of dueSchedules) {
    try {
      const result = await executeScheduledSync(schedule.id!);
      if (result.success) executed++;
      else failed++;
    } catch (error) {
      failed++;
      log.error(`执行调度任务 ${schedule.id} 失败:`, error);
    }
  }

  return { executed, failed };
}

/**
 * 获取调度执行历史
 */
export async function getScheduleHistory(scheduleId: number, limit: number = 20): Promise<Record<string, any>[]> {
  const db = await getDb();
  if (!db) return [];
  
  const result = await db.execute(sql`
    SELECT j.id, j.status, j.recordsSynced, j.errorMessage, j.startedAt, j.completedAt, j.createdAt
    FROM data_sync_jobs j
    INNER JOIN sync_schedules s ON j.accountId = s.account_id AND j.userId = s.user_id
    WHERE s.id = ${scheduleId}
    ORDER BY j.createdAt DESC
    LIMIT ${limit}
  `);
  
  return (result as Record<string, any>[][])[0] || [];
}


/**
 * 调度执行历史记录类型
 */
export interface ScheduleExecutionHistory {
  id: number;
  scheduleId: number;
  jobId: number | null;
  status: "success" | "failed" | "retrying";
  retryCount: number;
  errorMessage: string | null;
  startedAt: Date;
  completedAt: Date | null;
  recordsSynced: number;
  duration: number | null; // 秒
}

/**
 * 重试配置
 */
const RETRY_CONFIG = {
  maxRetries: 3,
  retryDelayMs: 30000, // 30秒
  backoffMultiplier: 2, // 指数退避
};

/**
 * 获取调度的详细执行历史
 */
export async function getScheduleExecutionHistory(
  scheduleId: number,
  limit: number = 50
): Promise<ScheduleExecutionHistory[]> {
  const db = await getDb();
  if (!db) return [];

  try {
    const result = await db.execute(sql`
      SELECT 
        j.id,
        ${scheduleId} as scheduleId,
        j.id as jobId,
        j.status,
        COALESCE(j.retry_count, 0) as retryCount,
        j.errorMessage,
        j.startedAt,
        j.completedAt,
        COALESCE(j.recordsSynced, 0) as recordsSynced,
        CASE 
          WHEN j.completedAt IS NOT NULL AND j.startedAt IS NOT NULL 
          THEN TIMESTAMPDIFF(SECOND, j.startedAt, j.completedAt)
          ELSE NULL 
        END as duration
      FROM data_sync_jobs j
      INNER JOIN sync_schedules s ON j.accountId = s.account_id
      WHERE s.id = ${scheduleId}
      ORDER BY j.createdAt DESC
      LIMIT ${limit}
    `);

    const rows = (result as Record<string, any>[][])[0] || [];
    return rows.map((row: Record<string, any>) => ({
      id: row.id,
      scheduleId: row.scheduleId,
      jobId: row.jobId,
      status: row.status === "completed" ? "success" : row.status === "failed" ? "failed" : "retrying",
      retryCount: row.retryCount || 0,
      errorMessage: row.errorMessage,
      startedAt: row.startedAt ? new Date(row.startedAt) : new Date(),
      completedAt: row.completedAt ? new Date(row.completedAt) : null,
      recordsSynced: row.recordsSynced || 0,
      duration: row.duration,
    }));
  } catch (error) {
    log.error("获取执行历史失败:", error);
    return [];
  }
}

/**
 * 带重试机制的调度执行
 */
export async function executeScheduledSyncWithRetry(
  scheduleId: number
): Promise<{ success: boolean; jobId?: number; message?: string; retryCount: number }> {
  let retryCount = 0;
  let lastError: Error | null = null;

  while (retryCount <= RETRY_CONFIG.maxRetries) {
    try {
      const result = await executeScheduledSync(scheduleId);
      
      if (result.success) {
        // 成功，记录执行
        await logScheduleExecution(scheduleId, result.jobId!, "success", retryCount);
        return { ...result, retryCount };
      } else {
        // 业务逻辑失败，不重试
        await logScheduleExecution(scheduleId, result.jobId, "failed", retryCount, result.message);
        return { ...result, retryCount };
      }
    } catch (error) {
      lastError = error as Error;
      retryCount++;
      
      if (retryCount <= RETRY_CONFIG.maxRetries) {
        // 计算退避延迟
        const delay = RETRY_CONFIG.retryDelayMs * Math.pow(RETRY_CONFIG.backoffMultiplier, retryCount - 1);
        log.info(`调度 ${scheduleId} 执行失败，${delay/1000}秒后进行第 ${retryCount} 次重试...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  // 所有重试都失败
  const errorMessage = lastError?.message || "未知错误";
  await logScheduleExecution(scheduleId, null, "failed", retryCount, errorMessage);
  
  // 发送失败告警通知
  await sendScheduleFailureAlert(scheduleId, errorMessage, retryCount);
  
  return {
    success: false,
    message: `执行失败，已重试 ${retryCount} 次: ${errorMessage}`,
    retryCount,
  };
}

/**
 * 记录调度执行日志
 */
async function logScheduleExecution(
  scheduleId: number,
  jobId: number | null | undefined,
  status: "success" | "failed",
  retryCount: number,
  errorMessage?: string
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  try {
    // 如果有jobId，更新job记录
    if (jobId) {
      await db.execute(sql`
        UPDATE data_sync_jobs 
        SET retry_count = ${retryCount}
        WHERE id = ${jobId}
      `);
    }

    // 记录到日志表
    await db.insert(dataSyncLogs).values({
      jobId: jobId || 0,
      operation: `schedule_execution_${scheduleId}`,
      status: status === "success" ? "success" : "error",
      message: errorMessage || (status === "success" ? "执行成功" : "执行失败"),
      details: { scheduleId, retryCount, timestamp: new Date().toISOString() },
    });
  } catch (error) {
    log.error("记录执行日志失败:", error);
  }
}

/**
 * 发送调度失败告警通知
 */
async function sendScheduleFailureAlert(
  scheduleId: number,
  errorMessage: string,
  retryCount: number
): Promise<void> {
  try {
    // 获取调度信息
    const db = await getDb();
    if (!db) return;

    const scheduleResult = await db.execute(sql`
      SELECT s.*, a.account_name as accountName
      FROM sync_schedules s
      LEFT JOIN ad_accounts a ON s.account_id = a.id
      WHERE s.id = ${scheduleId}
    `);
    
    const schedule = (scheduleResult as Record<string, any>[])[0]?.[0];
    if (!schedule) return;

    // 使用通知服务发送告警
    const { notifyOwner } = await import("./_core/notification");
    
    const syncTypeNames: Record<string, string> = {
      campaigns: "广告活动",
      keywords: "关键词",
      performance: "绩效数据",
      all: "全量同步",
    };

    await notifyOwner({
      title: "数据同步调度执行失败",
      content: `
调度任务执行失败告警

账号: ${schedule.accountName || "未知"}
同步类型: ${syncTypeNames[schedule.syncType] || schedule.syncType}
重试次数: ${retryCount}/${RETRY_CONFIG.maxRetries}
错误信息: ${errorMessage}

请检查Amazon API连接状态和账号授权是否正常。
      `.trim(),
    });
  } catch (error) {
    log.error("发送失败告警失败:", error);
  }
}

/**
 * 获取调度执行统计
 */
export async function getScheduleExecutionStats(scheduleId: number): Promise<{
  totalExecutions: number;
  successCount: number;
  failureCount: number;
  avgDuration: number | null;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
}> {
  const db = await getDb();
  if (!db) {
    return {
      totalExecutions: 0,
      successCount: 0,
      failureCount: 0,
      avgDuration: null,
      lastSuccessAt: null,
      lastFailureAt: null,
    };
  }

  try {
    const result = await db.execute(sql`
      SELECT 
        COUNT(*) as totalExecutions,
        SUM(CASE WHEN j.status = 'completed' THEN 1 ELSE 0 END) as successCount,
        SUM(CASE WHEN j.status = 'failed' THEN 1 ELSE 0 END) as failureCount,
        AVG(CASE 
          WHEN j.completedAt IS NOT NULL AND j.startedAt IS NOT NULL 
          THEN TIMESTAMPDIFF(SECOND, j.startedAt, j.completedAt)
          ELSE NULL 
        END) as avgDuration,
        MAX(CASE WHEN j.status = 'completed' THEN j.completedAt ELSE NULL END) as lastSuccessAt,
        MAX(CASE WHEN j.status = 'failed' THEN j.completedAt ELSE NULL END) as lastFailureAt
      FROM data_sync_jobs j
      INNER JOIN sync_schedules s ON j.accountId = s.account_id
      WHERE s.id = ${scheduleId}
    `);

    const row = (result as Record<string, any>[][])[0]?.[0];
    if (!row) {
      return {
        totalExecutions: 0,
        successCount: 0,
        failureCount: 0,
        avgDuration: null,
        lastSuccessAt: null,
        lastFailureAt: null,
      };
    }

    return {
      totalExecutions: Number(row.totalExecutions) || 0,
      successCount: Number(row.successCount) || 0,
      failureCount: Number(row.failureCount) || 0,
      avgDuration: row.avgDuration ? Number(row.avgDuration) : null,
      lastSuccessAt: row.lastSuccessAt ? new Date(row.lastSuccessAt) : null,
      lastFailureAt: row.lastFailureAt ? new Date(row.lastFailureAt) : null,
    };
  } catch (error) {
    log.error("获取执行统计失败:", error);
    return {
      totalExecutions: 0,
      successCount: 0,
      failureCount: 0,
      avgDuration: null,
      lastSuccessAt: null,
      lastFailureAt: null,
    };
  }
}

/**
 * 运行带重试的调度检查
 */
export async function runScheduleCheckWithRetry(): Promise<{ executed: number; failed: number; retried: number }> {
  const dueSchedules = await getDueSchedules();
  let executed = 0;
  let failed = 0;
  let retried = 0;

  for (const schedule of dueSchedules) {
    try {
      const result = await executeScheduledSyncWithRetry(schedule.id!);
      if (result.success) {
        executed++;
      } else {
        failed++;
      }
      if (result.retryCount > 0) {
        retried += result.retryCount;
      }
    } catch (error) {
      failed++;
      log.error(`执行调度任务 ${schedule.id} 失败:`, error);
    }
  }

  return { executed, failed, retried };
}


// ==================== v334: 卡死任务清理 ====================

/**
 * v334: 清理卡死的同步任务
 * 当进程重启时，内存中的activeSyncs被清空，但DB中的running状态永远不会被更新
 * 此函数检测超过maxRunningMinutes的running任务，将其标记为failed
 * 
 * @param maxRunningMinutes 最大允许运行时间（分钟），默认120分钟
 * @returns 清理的任务数量
 */
export async function cleanupStaleJobs(maxRunningMinutes: number = 120): Promise<{ cleaned: number; jobIds: number[] }> {
  const db = await getDb();
  if (!db) return { cleaned: 0, jobIds: [] };

  try {
    const cutoffTime = new Date(Date.now() - maxRunningMinutes * 60 * 1000);
    const cutoffStr = cutoffTime.toISOString().slice(0, 19).replace('T', ' ');

    // 查找所有卡死的running任务
    const staleJobs = await db.select({
      id: dataSyncJobs.id,
      accountId: dataSyncJobs.accountId,
      startedAt: dataSyncJobs.startedAt,
      syncType: dataSyncJobs.syncType,
    }).from(dataSyncJobs)
      .where(and(
        eq(dataSyncJobs.status, 'running'),
        sql`${dataSyncJobs.startedAt} < ${cutoffStr}`
      ));

    if (staleJobs.length === 0) {
      return { cleaned: 0, jobIds: [] };
    }

    const jobIds = staleJobs.map(j => j.id);

    // 批量更新为failed状态
    await db.update(dataSyncJobs)
      .set({
        status: 'failed',
        completedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
        errorMessage: `v334: 任务超时（超过${maxRunningMinutes}分钟），由卡死任务清理机制自动标记为失败`,
      })
      .where(and(
        eq(dataSyncJobs.status, 'running'),
        sql`${dataSyncJobs.startedAt} < ${cutoffStr}`
      ));

    // 记录清理日志
    for (const job of staleJobs) {
      log.warn(`[DataSync] v334: 清理卡死任务 Job#${job.id} (账户${job.accountId}, 类型${job.syncType}, 启动时间${job.startedAt})`);
      await logSyncActivity(0, 'cleanup_stale', 'success', 
        `v334: 清理卡死任务 Job#${job.id}, 账户${job.accountId}, 运行超过${maxRunningMinutes}分钟`);
    }

    log.info(`[DataSync] v334: 卡死任务清理完成，共清理 ${staleJobs.length} 个任务: ${jobIds.join(', ')}`);
    return { cleaned: staleJobs.length, jobIds };
  } catch (error: unknown) {
    log.error(`[DataSync] v334: 卡死任务清理失败: ${(error as Error).message}`);
    return { cleaned: 0, jobIds: [] };
  }
}

/**
 * v334: 清理所有pending状态超过1小时的任务（可能是创建后未被执行的孤儿任务）
 */
export async function cleanupOrphanedPendingJobs(maxPendingMinutes: number = 60): Promise<{ cleaned: number }> {
  const db = await getDb();
  if (!db) return { cleaned: 0 };

  try {
    const cutoffTime = new Date(Date.now() - maxPendingMinutes * 60 * 1000);
    const cutoffStr = cutoffTime.toISOString().slice(0, 19).replace('T', ' ');

    const result = await db.update(dataSyncJobs)
      .set({
        status: 'cancelled',
        completedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
        errorMessage: `v334: 任务在pending状态超过${maxPendingMinutes}分钟，自动取消`,
      })
      .where(and(
        eq(dataSyncJobs.status, 'pending'),
        sql`${dataSyncJobs.createdAt} < ${cutoffStr}`
      ));

    // @ts-ignore
    const cleaned = (result as Record<string, any>[][])[0]?.affectedRows || 0;
    if (cleaned > 0) {
      log.info(`[DataSync] v334: 清理了 ${cleaned} 个孤儿pending任务`);
    }
    return { cleaned };
  } catch (error: unknown) {
    log.error(`[DataSync] v334: 孤儿pending任务清理失败: ${(error as Error).message}`);
    return { cleaned: 0 };
  }
}
