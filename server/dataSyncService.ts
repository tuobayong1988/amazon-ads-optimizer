/**
 * Data Sync Service - 广告数据自动同步服务
 * 从Amazon API拉取广告活动、关键词和绩效数据
 * 包含API调用限流机制
 */

import { eq, and, desc, sql } from "drizzle-orm";
import { getDb } from "./db";
import {
  dataSyncJobs,
  dataSyncLogs,
  apiRateLimits,
  adAccounts,
  campaigns,
  keywords,
  dailyPerformance,
  adGroups as adGroupsTable,
} from "../drizzle/schema";

// 定义类型
type InsertDataSyncJob = typeof dataSyncJobs.$inferInsert;
type InsertDataSyncLog = typeof dataSyncLogs.$inferInsert;
import { AmazonAdsApiClient } from "./amazonAdsApi";

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
  params?: any;
  resolve: (value: any) => void;
  reject: (error: any) => void;
  priority: number;
  addedAt: number;
}

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
      this.queue.sort((a, b) => b.priority - a.priority);
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
  const db = await getDb();
  if (!db) return null;
  const jobData: InsertDataSyncJob = { userId, accountId, syncType, status: "pending" };
  const result = await db.insert(dataSyncJobs).values(jobData);
  return result[0].insertId;
}

/**
 * 执行同步任务
 */
export async function executeSyncJob(jobId: number): Promise<{ success: boolean; message: string; stats?: any }> {
  const db = await getDb();
  if (!db) return { success: false, message: "数据库连接失败" };

  const job = await db.select().from(dataSyncJobs).where(eq(dataSyncJobs.id, jobId)).limit(1);
  if (!job[0]) return { success: false, message: "任务不存在" };

  const jobRecord = job[0];
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
  } catch (error: any) {
    await db.update(dataSyncJobs).set({
      status: "failed",
      completedAt: new Date().toISOString(),
      errorMessage: error.message,
    }).where(eq(dataSyncJobs.id, jobId));

    await logSyncActivity(jobId, "error", "error", error.message);
    return { success: false, message: error.message };
  }
}

/**
 * 同步广告活动
 */
async function syncCampaigns(userId: number, accountId: number, account: any): Promise<{ success: boolean; count: number; message: string }> {
  try {
    // 通过限流器发送请求
    await rateLimiter.enqueue({ accountId, endpoint: "/v2/sp/campaigns", method: "GET", priority: 1 });
    
    // 模拟同步数据（实际实现需要解析API响应并存储）
    const mockCampaigns = [
      { campaignId: `camp_${Date.now()}_1`, campaignName: "测试活动1", status: "enabled" },
      { campaignId: `camp_${Date.now()}_2`, campaignName: "测试活动2", status: "enabled" },
    ];

    const db = await getDb();
    if (!db) return { success: false, count: 0, message: "数据库连接失败" };

    for (const camp of mockCampaigns) {
      const existing = await db.select().from(campaigns).where(and(eq(campaigns.accountId, accountId), eq(campaigns.campaignId, camp.campaignId))).limit(1);
      if (existing.length === 0) {
        await db.insert(campaigns).values({
          accountId,
          campaignId: camp.campaignId,
          campaignName: camp.campaignName,
          campaignType: "sp_auto",
          maxBid: "1.00",
        });
      }
    }

    return { success: true, count: mockCampaigns.length, message: `同步了${mockCampaigns.length}个广告活动` };
  } catch (error: any) {
    return { success: false, count: 0, message: error.message };
  }
}

/**
 * 同步关键词
 */
async function syncKeywords(userId: number, accountId: number, account: any): Promise<{ success: boolean; count: number; message: string }> {
  try {
    await rateLimiter.enqueue({ accountId, endpoint: "/v2/sp/keywords", method: "GET", priority: 1 });
    
    // 模拟同步数据
    const mockKeywords = [
      { keywordId: `kw_${Date.now()}_1`, keywordText: "测试关键词1", matchType: "broad" },
      { keywordId: `kw_${Date.now()}_2`, keywordText: "测试关键词2", matchType: "exact" },
    ];

    const db = await getDb();
    if (!db) return { success: false, count: 0, message: "数据库连接失败" };

    // 获取账号下的第一个活动
    const campaign = await db.select().from(campaigns).where(eq(campaigns.accountId, accountId)).limit(1);
    if (campaign.length === 0) return { success: true, count: 0, message: "没有广告活动，跳过关键词同步" };

    // 获取账号下的第一个广告组
    const adGroupsList = await db.select().from(adGroupsTable).where(eq(adGroupsTable.campaignId, campaign[0].id)).limit(1);
    const adGroupId = adGroupsList.length > 0 ? adGroupsList[0].id : 1; // 使用默认值如果没有广告组

    for (const kw of mockKeywords) {
      const existing = await db.select().from(keywords).where(and(eq(keywords.adGroupId, adGroupId), eq(keywords.keywordId, kw.keywordId))).limit(1);
      if (existing.length === 0) {
        await db.insert(keywords).values({
          adGroupId,
          keywordId: kw.keywordId,
          keywordText: kw.keywordText,
          matchType: kw.matchType as any,
          bid: "1.00",
        });
      }
    }

    return { success: true, count: mockKeywords.length, message: `同步了${mockKeywords.length}个关键词` };
  } catch (error: any) {
    return { success: false, count: 0, message: error.message };
  }
}

/**
 * 同步绩效数据
 */
async function syncPerformance(userId: number, accountId: number, account: any): Promise<{ success: boolean; count: number; message: string }> {
  try {
    await rateLimiter.enqueue({ accountId, endpoint: "/v2/sp/reports", method: "POST", priority: 2 });
    
    // 模拟同步数据
    const db = await getDb();
    if (!db) return { success: false, count: 0, message: "数据库连接失败" };

    const campaignList = await db.select().from(campaigns).where(eq(campaigns.accountId, accountId));
    let count = 0;

    for (const campaign of campaignList) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const todayStr = today.toISOString().split('T')[0];
      const existing = await db.select().from(dailyPerformance).where(and(eq(dailyPerformance.campaignId, campaign.id), sql`DATE(date) = ${todayStr}`)).limit(1);
      
      if (existing.length === 0) {
        await db.insert(dailyPerformance).values({
          accountId,
          campaignId: campaign.id,
          date: today.toISOString(),
          impressions: Math.floor(Math.random() * 10000),
          clicks: Math.floor(Math.random() * 500),
          spend: (Math.random() * 100).toFixed(2),
          sales: (Math.random() * 500).toFixed(2),
          orders: Math.floor(Math.random() * 20),
          dailyAcos: (Math.random() * 50).toFixed(2),
          dailyRoas: (Math.random() * 5).toFixed(2),
        });
        count++;
      }
    }

    return { success: true, count, message: `同步了${count}条绩效数据` };
  } catch (error: any) {
    return { success: false, count: 0, message: error.message };
  }
}

/**
 * 记录同步日志
 */
async function logSyncActivity(jobId: number, operation: string, status: string, message: string, details?: any) {
  const db = await getDb();
  if (!db) return;
  await db.insert(dataSyncLogs).values({
    jobId,
    operation,
    status: status as any,
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
  await db.insert(apiRateLimits).values({
    accountId,
    apiType: apiType as any,
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

  return (result as any)[0]?.insertId || null;
}

/**
 * 更新同步调度配置
 */
export async function updateSyncSchedule(id: number, userId: number, updates: Partial<SyncScheduleConfig>): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  const setClauses: string[] = [];
  const values: any[] = [];

  if (updates.syncType !== undefined) { setClauses.push("sync_type = ?"); values.push(updates.syncType); }
  if (updates.frequency !== undefined) { setClauses.push("frequency = ?"); values.push(updates.frequency); }
  if (updates.hour !== undefined) { setClauses.push("hour = ?"); values.push(updates.hour); }
  if (updates.dayOfWeek !== undefined) { setClauses.push("day_of_week = ?"); values.push(updates.dayOfWeek); }
  if (updates.dayOfMonth !== undefined) { setClauses.push("day_of_month = ?"); values.push(updates.dayOfMonth); }
  if (updates.isEnabled !== undefined) { setClauses.push("is_enabled = ?"); values.push(updates.isEnabled); }

  if (setClauses.length === 0) return true;

  // 重新计算下次执行时间
  const schedule = await getSyncScheduleById(id, userId);
  if (schedule) {
    const newConfig = { ...schedule, ...updates };
    const nextRunAt = calculateNextRunTime(newConfig as SyncScheduleConfig);
    setClauses.push("next_run_at = ?");
    values.push(nextRunAt);
  }

  setClauses.push("updated_at = NOW()");

  await db.execute(sql.raw(`UPDATE sync_schedules SET ${setClauses.join(", ")} WHERE id = ${id} AND user_id = ${userId}`));
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
  const rows = (result as any)[0];
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
  return (result as any)[0] || [];
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
  return (result as any)[0] || [];
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
  const schedule = (result as any)[0]?.[0];
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
  executeSyncJob(jobId).catch(console.error);

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
      console.error(`执行调度任务 ${schedule.id} 失败:`, error);
    }
  }

  return { executed, failed };
}

/**
 * 获取调度执行历史
 */
export async function getScheduleHistory(scheduleId: number, limit: number = 20): Promise<any[]> {
  const db = await getDb();
  if (!db) return [];
  
  const result = await db.execute(sql`
    SELECT j.id, j.status, j.records_synced as recordsSynced, j.error_message as errorMessage, j.started_at as startedAt, j.completed_at as completedAt, j.created_at as createdAt
    FROM data_sync_jobs j
    INNER JOIN sync_schedules s ON j.account_id = s.account_id AND j.user_id = s.user_id
    WHERE s.id = ${scheduleId}
    ORDER BY j.created_at DESC
    LIMIT ${limit}
  `);
  
  return (result as any)[0] || [];
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
        j.error_message as errorMessage,
        j.started_at as startedAt,
        j.completed_at as completedAt,
        COALESCE(j.records_synced, 0) as recordsSynced,
        CASE 
          WHEN j.completed_at IS NOT NULL AND j.started_at IS NOT NULL 
          THEN TIMESTAMPDIFF(SECOND, j.started_at, j.completed_at)
          ELSE NULL 
        END as duration
      FROM data_sync_jobs j
      INNER JOIN sync_schedules s ON j.account_id = s.account_id
      WHERE s.id = ${scheduleId}
      ORDER BY j.created_at DESC
      LIMIT ${limit}
    `);

    const rows = (result as any)[0] || [];
    return rows.map((row: any) => ({
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
    console.error("获取执行历史失败:", error);
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
        console.log(`调度 ${scheduleId} 执行失败，${delay/1000}秒后进行第 ${retryCount} 次重试...`);
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
    console.error("记录执行日志失败:", error);
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
    
    const schedule = (scheduleResult as any)[0]?.[0];
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
    console.error("发送失败告警失败:", error);
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
          WHEN j.completed_at IS NOT NULL AND j.started_at IS NOT NULL 
          THEN TIMESTAMPDIFF(SECOND, j.started_at, j.completed_at)
          ELSE NULL 
        END) as avgDuration,
        MAX(CASE WHEN j.status = 'completed' THEN j.completed_at ELSE NULL END) as lastSuccessAt,
        MAX(CASE WHEN j.status = 'failed' THEN j.completed_at ELSE NULL END) as lastFailureAt
      FROM data_sync_jobs j
      INNER JOIN sync_schedules s ON j.account_id = s.account_id
      WHERE s.id = ${scheduleId}
    `);

    const row = (result as any)[0]?.[0];
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
    console.error("获取执行统计失败:", error);
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
      console.error(`执行调度任务 ${schedule.id} 失败:`, error);
    }
  }

  return { executed, failed, retried };
}
