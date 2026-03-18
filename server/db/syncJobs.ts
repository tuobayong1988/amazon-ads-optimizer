/**
 * v361: 数据同步任务管理
 * 从db.ts拆分的子模块
 */

import { and, count, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { InsertSyncChangeRecord, InsertSyncChangeSummary, InsertSyncConflict, InsertSyncTaskQueue, SyncTaskQueue, dataSyncJobs, dataSyncLogs, syncChangeRecords, syncChangeSummary, syncConflicts, syncTaskQueue } from '../../drizzle/schema';
import { getDb } from './connection';

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
  triggerSource?: 'auto' | 'manual' | 'scheduled';  // v445: 区分同步触发来源
}) {
  const db = await getDb();
  if (!db) return null;
  
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  // v445: 使用raw SQL设置trigger_source，因为drizzle schema中还没有这个字段
  const [result] = await db.insert(dataSyncJobs).values({
    userId: data.userId,
    accountId: data.accountId,
    syncType: data.syncType || 'all',
    status: 'running',
    isIncremental: data.isIncremental ? 1 : 0,
    maxRetries: data.maxRetries || 3,
    startedAt: now,
    createdAt: now,
  });
  
  // v445: 单独更新trigger_source字段（绕过drizzle schema限制）
  if (data.triggerSource && result.insertId) {
    try {
      await db.execute(sql`UPDATE data_sync_jobs SET trigger_source = ${data.triggerSource} WHERE id = ${result.insertId}`);
    } catch (e) {
      // trigger_source列可能还不存在，忽略错误
    }
  }
  
  return result.insertId;
}

/**
 * 更新同步任务状态
 */

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

/**
 * 获取同步变更记录
 */
export async function getSyncChangeRecords(syncJobId: number, entityType?: string) {
  const db = await getDb();
  if (!db) return [];
  
  const conditions = [eq(syncChangeRecords.syncJobId, syncJobId)];
  if (entityType) {
    // @ts-expect-error - type assertion
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

/**
 * 获取同步冲突列表
 */
export async function getSyncConflicts(accountId: number, status?: string) {
  const db = await getDb();
  if (!db) return [];
  
  const conditions = [eq(syncConflicts.accountId, accountId)];
  if (status) {
    // @ts-expect-error - string type assertion
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

/**
 * 获取队列中的任务
 */
export async function getSyncQueue(userId: number, status?: string) {
  const db = await getDb();
  if (!db) return [];
  
  const conditions = [eq(syncTaskQueue.userId, userId)];
  if (status) {
    // @ts-expect-error - string type assertion
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
  
  // @ts-expect-error - MySQL affectedRows
  return (result as Record<string, number>).affectedRows || 0;
}


// ==================== 定时同步调度相关函数 ====================

import { dataSyncSchedules } from '../../drizzle/schema';

export type DataSyncSchedule = typeof dataSyncSchedules.$inferSelect;

export type InsertDataSyncSchedule = typeof dataSyncSchedules.$inferInsert;

/**
 * 获取所有启用的定时同步配置
 */

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
      // @ts-expect-error - Dynamic data property access
      userId: data.userId,
      accountId: data.accountId,
      syncType: data.syncType as unknown,
      frequency: data.frequency as unknown,
      preferredTime: data.preferredTime,
      preferredDayOfWeek: data.preferredDayOfWeek,
      isEnabled: data.isEnabled ? 1 : 0,
      nextRunAt: nextRunAt.toISOString().slice(0, 19).replace('T', ' '),
    });
  
  // @ts-expect-error - type assertion
  return (result as Record<string, number>).insertId;
}

/**
 * 更新定时同步配置
 */

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
      // @ts-expect-error - Dynamic data property access
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
  
  // @ts-expect-error - type assertion
  return (result as Record<string, number>).insertId;
}


// 获取本地数据统计
