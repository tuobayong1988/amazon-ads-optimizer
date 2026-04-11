// Extracted from production dist/index.js
// Original module: server/db/syncJobs.ts
// Lines: 580

var syncJobs_exports = {};
__export(syncJobs_exports, {
  addToSyncQueue: () => addToSyncQueue,
  addToSyncQueueBatch: () => addToSyncQueueBatch,
  cancelSyncTask: () => cancelSyncTask,
  cleanupOldSyncTasks: () => cleanupOldSyncTasks,
  createSyncChangeRecord: () => createSyncChangeRecord,
  createSyncChangeRecordsBatch: () => createSyncChangeRecordsBatch,
  createSyncConflict: () => createSyncConflict,
  createSyncConflictsBatch: () => createSyncConflictsBatch,
  createSyncJob: () => createSyncJob,
  createSyncLog: () => createSyncLog,
  createSyncSchedule: () => createSyncSchedule,
  deleteSyncSchedule: () => deleteSyncSchedule,
  getAccountActiveSyncJob: () => getAccountActiveSyncJob,
  getActiveSyncJobs: () => getActiveSyncJobs,
  getEnabledSyncSchedules: () => getEnabledSyncSchedules,
  getLastSuccessfulSync: () => getLastSuccessfulSync,
  getLastSyncData: () => getLastSyncData,
  getNextQueuedTask: () => getNextQueuedTask,
  getPendingConflictsCount: () => getPendingConflictsCount,
  getSyncChangeRecords: () => getSyncChangeRecords,
  getSyncChangeSummary: () => getSyncChangeSummary,
  getSyncConflicts: () => getSyncConflicts,
  getSyncHistory: () => getSyncHistory,
  getSyncJob: () => getSyncJob,
  getSyncLogs: () => getSyncLogs,
  getSyncQueue: () => getSyncQueue,
  getSyncQueueStats: () => getSyncQueueStats,
  getSyncScheduleByAccountId: () => getSyncScheduleByAccountId,
  getSyncSchedulesByUserId: () => getSyncSchedulesByUserId,
  getSyncStats: () => getSyncStats,
  ignoreSyncConflict: () => ignoreSyncConflict,
  resolveSyncConflict: () => resolveSyncConflict,
  resolveSyncConflictsBatch: () => resolveSyncConflictsBatch,
  updateSyncJob: () => updateSyncJob,
  updateSyncSchedule: () => updateSyncSchedule,
  updateSyncScheduleLastRun: () => updateSyncScheduleLastRun,
  updateSyncTaskProgress: () => updateSyncTaskProgress,
  updateSyncTaskStatus: () => updateSyncTaskStatus,
  upsertSyncChangeSummary: () => upsertSyncChangeSummary
});
async function createSyncJob(data) {
  const db = await getDb();
  if (!db) return null;
  const now = (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ");
  const [result] = await db.insert(dataSyncJobs).values({
    userId: data.userId,
    accountId: data.accountId,
    syncType: data.syncType || "all",
    status: "running",
    isIncremental: data.isIncremental ? 1 : 0,
    maxRetries: data.maxRetries || 3,
    startedAt: now,
    createdAt: now
  });
  if (data.triggerSource && result.insertId) {
    try {
      await db.execute(sql`UPDATE data_sync_jobs SET trigger_source = ${data.triggerSource} WHERE id = ${result.insertId}`);
    } catch (e) {
    }
  }
  return result.insertId;
}
async function updateSyncJob(jobId, data) {
  const db = await getDb();
  if (!db) return;
  const updateData = { ...data };
  if (data.status === "completed" || data.status === "failed") {
    updateData.completedAt = (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ");
  }
  updateData.updatedAt = (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ");
  await db.update(dataSyncJobs).set(updateData).where(eq(dataSyncJobs.id, jobId));
}
async function getSyncJob(jobId) {
  const db = await getDb();
  if (!db) return null;
  const [job] = await db.select().from(dataSyncJobs).where(eq(dataSyncJobs.id, jobId));
  return job || null;
}
async function getActiveSyncJobs(userId) {
  const db = await getDb();
  if (!db) return [];
  const jobs = await db.select().from(dataSyncJobs).where(
    and(
      eq(dataSyncJobs.userId, userId),
      inArray(dataSyncJobs.status, ["pending", "running"])
    )
  ).orderBy(desc(dataSyncJobs.createdAt));
  return jobs;
}
async function getAccountActiveSyncJob(accountId) {
  const db = await getDb();
  if (!db) return null;
  const [job] = await db.select().from(dataSyncJobs).where(
    and(
      eq(dataSyncJobs.accountId, accountId),
      inArray(dataSyncJobs.status, ["pending", "running"])
    )
  ).orderBy(desc(dataSyncJobs.createdAt)).limit(1);
  return job || null;
}
async function getSyncHistory(accountId, limit = 20) {
  const db = await getDb();
  if (!db) return { jobs: [], total: 0 };
  const jobs = await db.select().from(dataSyncJobs).where(eq(dataSyncJobs.accountId, accountId)).orderBy(desc(dataSyncJobs.createdAt)).limit(limit);
  const [countResult] = await db.select({ count: sql`count(*)` }).from(dataSyncJobs).where(eq(dataSyncJobs.accountId, accountId));
  return {
    jobs,
    total: countResult?.count || 0
  };
}
async function getLastSuccessfulSync(accountId) {
  const db = await getDb();
  if (!db) return null;
  const [lastJob] = await db.select().from(dataSyncJobs).where(and(
    eq(dataSyncJobs.accountId, accountId),
    eq(dataSyncJobs.status, "completed")
  )).orderBy(desc(dataSyncJobs.completedAt)).limit(1);
  return lastJob?.completedAt || null;
}
async function getLastSyncData(accountId) {
  const db = await getDb();
  if (!db) return null;
  const [lastJob] = await db.select().from(dataSyncJobs).where(and(
    eq(dataSyncJobs.accountId, accountId),
    eq(dataSyncJobs.status, "completed")
  )).orderBy(desc(dataSyncJobs.completedAt)).limit(1);
  if (!lastJob) return null;
  return {
    sp: lastJob.spCampaigns || 0,
    sb: lastJob.sbCampaigns || 0,
    sd: lastJob.sdCampaigns || 0,
    adGroups: lastJob.adGroupsSynced || 0,
    keywords: lastJob.keywordsSynced || 0,
    targets: lastJob.targetsSynced || 0,
    syncedAt: lastJob.completedAt
  };
}
async function getSyncStats(accountId, days = 30) {
  const db = await getDb();
  if (!db) return null;
  const cutoffDate = /* @__PURE__ */ new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  const cutoffDateStr = cutoffDate.toISOString().slice(0, 19).replace("T", " ");
  const [stats4] = await db.select({
    totalSyncs: sql`count(*)`,
    successfulSyncs: sql`SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END)`,
    failedSyncs: sql`SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END)`,
    totalRecordsSynced: sql`COALESCE(SUM(records_synced), 0)`,
    avgDurationMs: sql`AVG(duration_ms)`,
    totalRetries: sql`COALESCE(SUM(retry_count), 0)`
  }).from(dataSyncJobs).where(and(
    eq(dataSyncJobs.accountId, accountId),
    gte(dataSyncJobs.createdAt, cutoffDateStr)
  ));
  return stats4 || {
    totalSyncs: 0,
    successfulSyncs: 0,
    failedSyncs: 0,
    totalRecordsSynced: 0,
    avgDurationMs: 0,
    totalRetries: 0
  };
}
async function getSyncLogs(jobId) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(dataSyncLogs).where(eq(dataSyncLogs.jobId, jobId)).orderBy(desc(dataSyncLogs.createdAt));
}
async function createSyncChangeRecord(data) {
  const db = await getDb();
  if (!db) return null;
  const [result] = await db.insert(syncChangeRecords).values(data);
  return result.insertId;
}
async function createSyncChangeRecordsBatch(records) {
  const db = await getDb();
  if (!db || records.length === 0) return 0;
  await db.insert(syncChangeRecords).values(records);
  return records.length;
}
async function getSyncChangeRecords(syncJobId, entityType) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [eq(syncChangeRecords.syncJobId, syncJobId)];
  if (entityType) {
    conditions.push(eq(syncChangeRecords.entityType, entityType));
  }
  return db.select().from(syncChangeRecords).where(and(...conditions)).orderBy(desc(syncChangeRecords.createdAt));
}
async function getSyncChangeSummary(syncJobId) {
  const db = await getDb();
  if (!db) return null;
  const [summary] = await db.select().from(syncChangeSummary).where(eq(syncChangeSummary.syncJobId, syncJobId));
  return summary;
}
async function upsertSyncChangeSummary(data) {
  const db = await getDb();
  if (!db) return null;
  const [existing] = await db.select().from(syncChangeSummary).where(eq(syncChangeSummary.syncJobId, data.syncJobId));
  if (existing) {
    await db.update(syncChangeSummary).set(data).where(eq(syncChangeSummary.id, existing.id));
    return existing.id;
  } else {
    const [result] = await db.insert(syncChangeSummary).values(data);
    return result.insertId;
  }
}
async function createSyncConflict(data) {
  const db = await getDb();
  if (!db) return null;
  const [result] = await db.insert(syncConflicts).values(data);
  return result.insertId;
}
async function createSyncConflictsBatch(conflicts) {
  const db = await getDb();
  if (!db || conflicts.length === 0) return 0;
  await db.insert(syncConflicts).values(conflicts);
  return conflicts.length;
}
async function getSyncConflicts(accountId, status) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [eq(syncConflicts.accountId, accountId)];
  if (status) {
    conditions.push(eq(syncConflicts.resolutionStatus, status));
  }
  return db.select().from(syncConflicts).where(and(...conditions)).orderBy(desc(syncConflicts.createdAt));
}
async function getPendingConflictsCount(accountId) {
  const db = await getDb();
  if (!db) return 0;
  const [result] = await db.select({ count: sql`count(*)` }).from(syncConflicts).where(and(
    eq(syncConflicts.accountId, accountId),
    eq(syncConflicts.resolutionStatus, "pending")
  ));
  return result?.count || 0;
}
async function resolveSyncConflict(conflictId, resolution, resolvedBy, notes) {
  const db = await getDb();
  if (!db) return false;
  await db.update(syncConflicts).set({
    resolutionStatus: "resolved",
    suggestedResolution: resolution,
    resolvedAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " "),
    resolvedBy,
    resolutionNotes: notes
  }).where(eq(syncConflicts.id, conflictId));
  return true;
}
async function resolveSyncConflictsBatch(conflictIds, resolution, resolvedBy) {
  const db = await getDb();
  if (!db || conflictIds.length === 0) return 0;
  await db.update(syncConflicts).set({
    resolutionStatus: "resolved",
    suggestedResolution: resolution,
    resolvedAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " "),
    resolvedBy
  }).where(inArray(syncConflicts.id, conflictIds));
  return conflictIds.length;
}
async function ignoreSyncConflict(conflictId, resolvedBy) {
  const db = await getDb();
  if (!db) return false;
  await db.update(syncConflicts).set({
    resolutionStatus: "ignored",
    resolvedAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " "),
    resolvedBy
  }).where(eq(syncConflicts.id, conflictId));
  return true;
}
async function addToSyncQueue(data) {
  const db = await getDb();
  if (!db) return null;
  const [result] = await db.insert(syncTaskQueue).values(data);
  return result.insertId;
}
async function addToSyncQueueBatch(tasks) {
  const db = await getDb();
  if (!db || tasks.length === 0) return [];
  const ids = [];
  for (const task of tasks) {
    const [result] = await db.insert(syncTaskQueue).values(task);
    ids.push(result.insertId);
  }
  return ids;
}
async function getSyncQueue(userId, status) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [eq(syncTaskQueue.userId, userId)];
  if (status) {
    conditions.push(eq(syncTaskQueue.status, status));
  }
  return db.select().from(syncTaskQueue).where(and(...conditions)).orderBy(desc(syncTaskQueue.priority), syncTaskQueue.createdAt);
}
async function getNextQueuedTask() {
  const db = await getDb();
  if (!db) return null;
  const [task] = await db.select().from(syncTaskQueue).where(eq(syncTaskQueue.status, "queued")).orderBy(desc(syncTaskQueue.priority), syncTaskQueue.createdAt).limit(1);
  return task || null;
}
async function updateSyncTaskStatus(taskId, status, updates) {
  const db = await getDb();
  if (!db) return false;
  const updateData = { status };
  if (status === "running" && !updates?.startedAt) {
    updateData.startedAt = (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ");
  }
  if (status === "completed" || status === "failed") {
    updateData.completedAt = (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ");
  }
  if (updates) {
    Object.assign(updateData, updates);
  }
  await db.update(syncTaskQueue).set(updateData).where(eq(syncTaskQueue.id, taskId));
  return true;
}
async function updateSyncTaskProgress(taskId, progress, currentStep, completedSteps, estimatedTimeMs) {
  const db = await getDb();
  if (!db) return false;
  await db.update(syncTaskQueue).set({
    progress,
    currentStep,
    completedSteps,
    estimatedTimeMs
  }).where(eq(syncTaskQueue.id, taskId));
  return true;
}
async function cancelSyncTask(taskId) {
  const db = await getDb();
  if (!db) return false;
  await db.update(syncTaskQueue).set({
    status: "cancelled",
    completedAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ")
  }).where(and(
    eq(syncTaskQueue.id, taskId),
    inArray(syncTaskQueue.status, ["queued", "running"])
  ));
  return true;
}
async function getSyncQueueStats(userId) {
  const db = await getDb();
  if (!db) return null;
  const [stats4] = await db.select({
    totalTasks: sql`count(*)`,
    queuedTasks: sql`SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END)`,
    runningTasks: sql`SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END)`,
    completedTasks: sql`SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END)`,
    failedTasks: sql`SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END)`,
    totalEstimatedTimeMs: sql`COALESCE(SUM(CASE WHEN status IN ('queued', 'running') THEN estimated_time_ms ELSE 0 END), 0)`
  }).from(syncTaskQueue).where(eq(syncTaskQueue.userId, userId));
  return stats4 || {
    totalTasks: 0,
    queuedTasks: 0,
    runningTasks: 0,
    completedTasks: 0,
    failedTasks: 0,
    totalEstimatedTimeMs: 0
  };
}
async function cleanupOldSyncTasks(userId, retainDays = 7) {
  const db = await getDb();
  if (!db) return 0;
  const cutoffDate = /* @__PURE__ */ new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retainDays);
  const cutoffDateStr = cutoffDate.toISOString().slice(0, 19).replace("T", " ");
  const [result] = await db.delete(syncTaskQueue).where(and(
    eq(syncTaskQueue.userId, userId),
    inArray(syncTaskQueue.status, ["completed", "failed", "cancelled"]),
    lte(syncTaskQueue.completedAt, cutoffDateStr)
  ));
  return result.affectedRows || 0;
}
async function getEnabledSyncSchedules() {
  const db = await getDb();
  if (!db) return [];
  const schedules = await db.select().from(dataSyncSchedules).where(eq(dataSyncSchedules.isEnabled, 1));
  return schedules;
}
async function getSyncScheduleByAccountId(userId, accountId) {
  const db = await getDb();
  if (!db) return null;
  const [schedule] = await db.select().from(dataSyncSchedules).where(and(
    eq(dataSyncSchedules.userId, userId),
    eq(dataSyncSchedules.accountId, accountId)
  )).limit(1);
  return schedule || null;
}
async function createSyncSchedule(data) {
  const db = await getDb();
  if (!db) return 0;
  const nextRunAt = calculateNextRunTime(data.frequency, data.preferredTime, data.preferredDayOfWeek);
  const [result] = await db.insert(dataSyncSchedules).values({
    // @ts-expect-error - Dynamic data property access
    userId: data.userId,
    accountId: data.accountId,
    syncType: data.syncType,
    frequency: data.frequency,
    preferredTime: data.preferredTime,
    preferredDayOfWeek: data.preferredDayOfWeek,
    isEnabled: data.isEnabled ? 1 : 0,
    nextRunAt: nextRunAt.toISOString().slice(0, 19).replace("T", " ")
  });
  return result.insertId;
}
async function updateSyncSchedule(scheduleId, data) {
  const db = await getDb();
  if (!db) return false;
  const updateData = {
    updatedAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ")
  };
  if (data.syncType !== void 0) updateData.syncType = data.syncType;
  if (data.frequency !== void 0) updateData.frequency = data.frequency;
  if (data.preferredTime !== void 0) updateData.preferredTime = data.preferredTime;
  if (data.preferredDayOfWeek !== void 0) updateData.preferredDayOfWeek = data.preferredDayOfWeek;
  if (data.isEnabled !== void 0) updateData.isEnabled = data.isEnabled ? 1 : 0;
  if (data.frequency || data.preferredTime) {
    const nextRunAt = calculateNextRunTime(
      data.frequency || "daily",
      data.preferredTime,
      data.preferredDayOfWeek
    );
    updateData.nextRunAt = nextRunAt.toISOString().slice(0, 19).replace("T", " ");
  }
  await db.update(dataSyncSchedules).set(updateData).where(eq(dataSyncSchedules.id, scheduleId));
  return true;
}
async function updateSyncScheduleLastRun(scheduleId) {
  const db = await getDb();
  if (!db) return false;
  const [schedule] = await db.select().from(dataSyncSchedules).where(eq(dataSyncSchedules.id, scheduleId)).limit(1);
  if (!schedule) return false;
  const nextRunAt = calculateNextRunTime(
    schedule.frequency || "daily",
    schedule.preferredTime || void 0,
    schedule.preferredDayOfWeek || void 0
  );
  await db.update(dataSyncSchedules).set({
    lastRunAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " "),
    nextRunAt: nextRunAt.toISOString().slice(0, 19).replace("T", " "),
    updatedAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ")
  }).where(eq(dataSyncSchedules.id, scheduleId));
  return true;
}
async function deleteSyncSchedule(scheduleId) {
  const db = await getDb();
  if (!db) return false;
  await db.delete(dataSyncSchedules).where(eq(dataSyncSchedules.id, scheduleId));
  return true;
}
async function getSyncSchedulesByUserId(userId) {
  const db = await getDb();
  if (!db) return [];
  const schedules = await db.select().from(dataSyncSchedules).where(eq(dataSyncSchedules.userId, userId)).orderBy(desc(dataSyncSchedules.createdAt));
  return schedules;
}
function calculateNextRunTime(frequency, preferredTime, preferredDayOfWeek) {
  const now = /* @__PURE__ */ new Date();
  const next = new Date(now);
  if (preferredTime) {
    const [hours, minutes] = preferredTime.split(":").map(Number);
    next.setHours(hours, minutes, 0, 0);
  }
  switch (frequency) {
    case "hourly":
      next.setHours(next.getHours() + 1);
      next.setMinutes(0, 0, 0);
      break;
    case "every_2_hours":
      next.setHours(next.getHours() + 2);
      next.setMinutes(0, 0, 0);
      break;
    case "every_4_hours":
      next.setHours(next.getHours() + 4);
      next.setMinutes(0, 0, 0);
      break;
    case "every_6_hours":
      next.setHours(next.getHours() + 6);
      next.setMinutes(0, 0, 0);
      break;
    case "every_12_hours":
      next.setHours(next.getHours() + 12);
      next.setMinutes(0, 0, 0);
      break;
    case "daily":
      if (next <= now) {
        next.setDate(next.getDate() + 1);
      }
      break;
    case "weekly":
      if (preferredDayOfWeek !== void 0) {
        const currentDay = next.getDay();
        let daysUntilTarget = preferredDayOfWeek - currentDay;
        if (daysUntilTarget <= 0 || daysUntilTarget === 0 && next <= now) {
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
async function createSyncLog(data) {
  const db = await getDb();
  if (!db) return 0;
  const [result] = await db.insert(dataSyncJobs).values({
    // @ts-expect-error - Dynamic data property access
    userId: data.userId,
    accountId: data.accountId,
    syncType: data.syncType,
    status: data.status,
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
    errorMessage: data.errorMessage
  });
  return result.insertId;
}
var init_syncJobs = __esm({
  "server/db/syncJobs.ts"() {
    "use strict";
    init_drizzle_orm();
    init_schema2();
    init_connection();
    __name(createSyncJob, "createSyncJob");
    __name(updateSyncJob, "updateSyncJob");
    __name(getSyncJob, "getSyncJob");
    __name(getActiveSyncJobs, "getActiveSyncJobs");
    __name(getAccountActiveSyncJob, "getAccountActiveSyncJob");
    __name(getSyncHistory, "getSyncHistory");
    __name(getLastSuccessfulSync, "getLastSuccessfulSync");
    __name(getLastSyncData, "getLastSyncData");
    __name(getSyncStats, "getSyncStats");
    __name(getSyncLogs, "getSyncLogs");
    __name(createSyncChangeRecord, "createSyncChangeRecord");
    __name(createSyncChangeRecordsBatch, "createSyncChangeRecordsBatch");
    __name(getSyncChangeRecords, "getSyncChangeRecords");
    __name(getSyncChangeSummary, "getSyncChangeSummary");
    __name(upsertSyncChangeSummary, "upsertSyncChangeSummary");
    __name(createSyncConflict, "createSyncConflict");
    __name(createSyncConflictsBatch, "createSyncConflictsBatch");
    __name(getSyncConflicts, "getSyncConflicts");
    __name(getPendingConflictsCount, "getPendingConflictsCount");
    __name(resolveSyncConflict, "resolveSyncConflict");
    __name(resolveSyncConflictsBatch, "resolveSyncConflictsBatch");
    __name(ignoreSyncConflict, "ignoreSyncConflict");
    __name(addToSyncQueue, "addToSyncQueue");
    __name(addToSyncQueueBatch, "addToSyncQueueBatch");
    __name(getSyncQueue, "getSyncQueue");
    __name(getNextQueuedTask, "getNextQueuedTask");
    __name(updateSyncTaskStatus, "updateSyncTaskStatus");
    __name(updateSyncTaskProgress, "updateSyncTaskProgress");
    __name(cancelSyncTask, "cancelSyncTask");
    __name(getSyncQueueStats, "getSyncQueueStats");
    __name(cleanupOldSyncTasks, "cleanupOldSyncTasks");
    __name(getEnabledSyncSchedules, "getEnabledSyncSchedules");
    __name(getSyncScheduleByAccountId, "getSyncScheduleByAccountId");
    __name(createSyncSchedule, "createSyncSchedule");
    __name(updateSyncSchedule, "updateSyncSchedule");
    __name(updateSyncScheduleLastRun, "updateSyncScheduleLastRun");
    __name(deleteSyncSchedule, "deleteSyncSchedule");
    __name(getSyncSchedulesByUserId, "getSyncSchedulesByUserId");
    __name(calculateNextRunTime, "calculateNextRunTime");
    __name(createSyncLog, "createSyncLog");
  }
});

