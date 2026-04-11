// Extracted from production dist/index.js
// Original module: server/sync/dataSyncService.ts
// Lines: 825

var dataSyncService_exports = {};
__export(dataSyncService_exports, {
  calculateNextRunTime: () => calculateNextRunTime2,
  cancelSyncJob: () => cancelSyncJob,
  cleanupOrphanedPendingJobs: () => cleanupOrphanedPendingJobs,
  cleanupStaleJobs: () => cleanupStaleJobs,
  createSyncJob: () => createSyncJob2,
  createSyncSchedule: () => createSyncSchedule2,
  deleteSyncSchedule: () => deleteSyncSchedule2,
  executeScheduledSync: () => executeScheduledSync,
  executeScheduledSyncWithRetry: () => executeScheduledSyncWithRetry,
  executeSyncJob: () => executeSyncJob,
  getApiUsageStats: () => getApiUsageStats,
  getDueSchedules: () => getDueSchedules,
  getRateLimitStatus: () => getRateLimitStatus,
  getScheduleExecutionHistory: () => getScheduleExecutionHistory,
  getScheduleExecutionStats: () => getScheduleExecutionStats,
  getScheduleHistory: () => getScheduleHistory,
  getSyncJobs: () => getSyncJobs,
  getSyncLogs: () => getSyncLogs2,
  getSyncScheduleById: () => getSyncScheduleById,
  getSyncSchedules: () => getSyncSchedules,
  recordApiRateLimit: () => recordApiRateLimit,
  runScheduleCheck: () => runScheduleCheck,
  runScheduleCheckWithRetry: () => runScheduleCheckWithRetry,
  updateSyncSchedule: () => updateSyncSchedule2
});
async function createSyncJob2(userId, accountId, syncType = "all") {
  log139.warn(`[DEPRECATED] dataSyncService.createSyncJob\u5DF2\u5E9F\u5F03\uFF0C\u8BF7\u4F7F\u7528amazonSyncService\u66FF\u4EE3`);
  const db = await getDb();
  if (!db) return null;
  const jobData = { userId, accountId, syncType, status: "pending" };
  const result = await db.insert(dataSyncJobs).values(jobData);
  return result[0].insertId;
}
async function executeSyncJob(jobId) {
  log139.warn(`[DEPRECATED] dataSyncService.executeSyncJob\u5DF2\u5E9F\u5F03\uFF0C\u8BF7\u4F7F\u7528amazonSyncService\u66FF\u4EE3`);
  const db = await getDb();
  if (!db) return { success: false, message: "\u6570\u636E\u5E93\u8FDE\u63A5\u5931\u8D25" };
  const job = await db.select().from(dataSyncJobs).where(eq(dataSyncJobs.id, jobId)).limit(1);
  if (!job[0]) return { success: false, message: "\u4EFB\u52A1\u4E0D\u5B58\u5728" };
  const jobRecord = job[0];
  await db.update(dataSyncJobs).set({ status: "running", startedAt: (/* @__PURE__ */ new Date()).toISOString() }).where(eq(dataSyncJobs.id, jobId));
  const stats4 = { campaigns: 0, keywords: 0, performance: 0, errors: 0 };
  try {
    const account = await db.select().from(adAccounts).where(eq(adAccounts.id, jobRecord.accountId)).limit(1);
    if (!account[0]) throw new Error("\u8D26\u53F7\u4E0D\u5B58\u5728");
    if (jobRecord.syncType === "campaigns" || jobRecord.syncType === "all") {
      const campaignResult = await syncCampaigns(jobRecord.userId, jobRecord.accountId, account[0]);
      stats4.campaigns = campaignResult.count;
      await logSyncActivity(jobId, "campaigns", campaignResult.success ? "success" : "error", campaignResult.message);
    }
    if (jobRecord.syncType === "keywords" || jobRecord.syncType === "all") {
      const keywordResult = await syncKeywords(jobRecord.userId, jobRecord.accountId, account[0]);
      stats4.keywords = keywordResult.count;
      await logSyncActivity(jobId, "keywords", keywordResult.success ? "success" : "error", keywordResult.message);
    }
    if (jobRecord.syncType === "performance" || jobRecord.syncType === "all") {
      const perfResult = await syncPerformance(jobRecord.userId, jobRecord.accountId, account[0]);
      stats4.performance = perfResult.count;
      await logSyncActivity(jobId, "performance", perfResult.success ? "success" : "error", perfResult.message);
    }
    await db.update(dataSyncJobs).set({
      status: "completed",
      completedAt: (/* @__PURE__ */ new Date()).toISOString(),
      recordsSynced: stats4.campaigns + stats4.keywords + stats4.performance
    }).where(eq(dataSyncJobs.id, jobId));
    return { success: true, message: "\u540C\u6B65\u5B8C\u6210", stats: stats4 };
  } catch (error48) {
    await db.update(dataSyncJobs).set({
      status: "failed",
      completedAt: (/* @__PURE__ */ new Date()).toISOString(),
      errorMessage: error48.message
    }).where(eq(dataSyncJobs.id, jobId));
    await logSyncActivity(jobId, "error", "error", error48.message);
    return { success: false, message: error48.message };
  }
}
async function syncCampaigns(userId, accountId, account) {
  try {
    const { AmazonSyncService: AmazonSyncService2 } = await Promise.resolve().then(() => (init_amazonSyncService(), amazonSyncService_exports));
    const syncService = await AmazonSyncService2.createFromCredentials(
      {
        // @ts-ignore
        clientId: account.clientId,
        // @ts-ignore
        clientSecret: account.clientSecret,
        // @ts-ignore
        refreshToken: account.refreshToken,
        // @ts-ignore
        profileId: account.profileId,
        // @ts-ignore
        region: account.region || "NA"
      },
      accountId,
      userId,
      // @ts-ignore
      account.marketplace || "US"
    );
    const result = await syncService.syncCampaignsOnly();
    return {
      success: true,
      count: result?.campaigns || 0,
      message: `\u901A\u8FC7Amazon API\u540C\u6B65\u4E86${result?.campaigns || 0}\u4E2A\u5E7F\u544A\u6D3B\u52A8`
    };
  } catch (error48) {
    log139.warn(`[dataSyncService] syncCampaigns\u5931\u8D25 accountId=${accountId}:`, error48.message);
    return { success: false, count: 0, message: error48.message };
  }
}
async function syncKeywords(userId, accountId, account) {
  try {
    const { AmazonSyncService: AmazonSyncService2 } = await Promise.resolve().then(() => (init_amazonSyncService(), amazonSyncService_exports));
    const syncService = await AmazonSyncService2.createFromCredentials(
      {
        // @ts-ignore
        clientId: account.clientId,
        // @ts-ignore
        clientSecret: account.clientSecret,
        // @ts-ignore
        refreshToken: account.refreshToken,
        // @ts-ignore
        profileId: account.profileId,
        // @ts-ignore
        region: account.region || "NA"
      },
      accountId,
      userId,
      // @ts-ignore
      account.marketplace || "US"
    );
    const result = await syncService.syncAll({ syncMode: "daily" });
    return {
      // @ts-ignore
      success: true,
      // @ts-ignore
      count: result?.keywords || 0,
      // @ts-ignore
      message: `\u901A\u8FC7Amazon API\u540C\u6B65\u4E86${result?.keywords || 0}\u4E2A\u5173\u952E\u8BCD`
      // @ts-ignore
    };
  } catch (error48) {
    log139.warn(`[dataSyncService] syncKeywords\u5931\u8D25 accountId=${accountId}:`, error48.message);
    return { success: false, count: 0, message: error48.message };
  }
}
async function syncPerformance(userId, accountId, account) {
  try {
    const { AmazonSyncService: AmazonSyncService2 } = await Promise.resolve().then(() => (init_amazonSyncService(), amazonSyncService_exports));
    const syncService = await AmazonSyncService2.createFromCredentials(
      {
        // @ts-ignore
        clientId: account.clientId,
        // @ts-ignore
        clientSecret: account.clientSecret,
        // @ts-ignore
        refreshToken: account.refreshToken,
        // @ts-ignore
        profileId: account.profileId,
        // @ts-ignore
        region: account.region || "NA"
      },
      accountId,
      userId,
      // @ts-ignore
      account.marketplace || "US"
    );
    const result = await syncService.syncPerformanceOnly();
    return {
      success: true,
      count: result?.performance || 0,
      message: `\u901A\u8FC7Amazon API\u540C\u6B65\u4E86${result?.performance || 0}\u6761\u7EE9\u6548\u6570\u636E`
    };
  } catch (error48) {
    log139.warn(`[dataSyncService] syncPerformance\u5931\u8D25 accountId=${accountId}:`, error48.message);
    return { success: false, count: 0, message: error48.message };
  }
}
async function logSyncActivity(jobId, operation, status, message2, details) {
  const db = await getDb();
  if (!db) return;
  await db.insert(dataSyncLogs).values({
    jobId,
    operation,
    status,
    message: message2,
    details: details ? JSON.stringify(details) : null
  });
}
async function getSyncJobs(userId, options = {}) {
  const db = await getDb();
  if (!db) return { jobs: [], total: 0 };
  const conditions = [eq(dataSyncJobs.userId, userId)];
  if (options.accountId) conditions.push(eq(dataSyncJobs.accountId, options.accountId));
  if (options.status) conditions.push(eq(dataSyncJobs.status, options.status));
  const jobs = await db.select().from(dataSyncJobs).where(and(...conditions)).orderBy(desc(dataSyncJobs.createdAt)).limit(options.limit || 50).offset(options.offset || 0);
  const countResult = await db.select({ count: sql`count(*)` }).from(dataSyncJobs).where(and(...conditions));
  return { jobs, total: countResult[0]?.count || 0 };
}
async function getSyncLogs2(jobId) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(dataSyncLogs).where(eq(dataSyncLogs.jobId, jobId)).orderBy(dataSyncLogs.createdAt);
}
async function cancelSyncJob(jobId, userId) {
  const db = await getDb();
  if (!db) return false;
  await db.update(dataSyncJobs).set({ status: "cancelled" }).where(and(eq(dataSyncJobs.id, jobId), eq(dataSyncJobs.userId, userId), eq(dataSyncJobs.status, "pending")));
  return true;
}
function getRateLimitStatus() {
  return rateLimiter.getQueueStatus();
}
async function recordApiRateLimit(accountId, apiType, requestCount, _limitReached) {
  const db = await getDb();
  if (!db) return;
  await db.insert(apiRateLimits).values({
    accountId,
    apiType,
    currentSecondCount: requestCount,
    currentMinuteCount: requestCount,
    currentDayCount: requestCount
  });
}
async function getApiUsageStats(accountId) {
  const db = await getDb();
  if (!db) return null;
  const oneHourAgo = new Date(Date.now() - 36e5);
  const stats4 = await db.select({
    totalRequests: sql`SUM(${apiRateLimits.currentDayCount})`,
    recordCount: sql`COUNT(*)`
  }).from(apiRateLimits).where(and(eq(apiRateLimits.accountId, accountId), sql`${apiRateLimits.updatedAt} >= ${oneHourAgo}`));
  return { totalRequests: stats4[0]?.totalRequests || 0, recordCount: stats4[0]?.recordCount || 0, limits: RATE_LIMITS };
}
async function createSyncSchedule2(config2) {
  const db = await getDb();
  if (!db) return null;
  const nextRunAt = calculateNextRunTime2(config2);
  const result = await db.execute(sql`
    INSERT INTO sync_schedules (user_id, account_id, sync_type, frequency, hour, day_of_week, day_of_month, is_enabled, next_run_at)
    VALUES (${config2.userId}, ${config2.accountId}, ${config2.syncType}, ${config2.frequency}, ${config2.hour ?? 0}, ${config2.dayOfWeek ?? null}, ${config2.dayOfMonth ?? null}, ${config2.isEnabled}, ${nextRunAt})
  `);
  return result[0]?.insertId || null;
}
async function updateSyncSchedule2(id, userId, updates) {
  const db = await getDb();
  if (!db) return false;
  const setParts = [];
  if (updates.syncType !== void 0) setParts.push(sql`sync_type = ${updates.syncType}`);
  if (updates.frequency !== void 0) setParts.push(sql`frequency = ${updates.frequency}`);
  if (updates.hour !== void 0) setParts.push(sql`hour = ${updates.hour}`);
  if (updates.dayOfWeek !== void 0) setParts.push(sql`day_of_week = ${updates.dayOfWeek}`);
  if (updates.dayOfMonth !== void 0) setParts.push(sql`day_of_month = ${updates.dayOfMonth}`);
  if (updates.isEnabled !== void 0) setParts.push(sql`is_enabled = ${updates.isEnabled}`);
  if (setParts.length === 0) return true;
  const schedule = await getSyncScheduleById(id, userId);
  if (schedule) {
    const newConfig = { ...schedule, ...updates };
    const nextRunAt = calculateNextRunTime2(newConfig);
    setParts.push(sql`next_run_at = ${nextRunAt}`);
  }
  setParts.push(sql`updated_at = NOW()`);
  await db.execute(
    sql`UPDATE sync_schedules SET ${sql.join(setParts, sql`, `)} WHERE id = ${id} AND user_id = ${userId}`
  );
  return true;
}
async function deleteSyncSchedule2(id, userId) {
  const db = await getDb();
  if (!db) return false;
  await db.execute(sql`DELETE FROM sync_schedules WHERE id = ${id} AND user_id = ${userId}`);
  return true;
}
async function getSyncScheduleById(id, userId) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.execute(sql`
 SELECT id, user_id as userId, account_id as accountId, sync_type as syncType, frequency, hour, day_of_week as dayOfWeek, day_of_month as dayOfMonth, is_enabled as isEnabled, last_run_at as lastRunAt, next_run_at as nextRunAt
 FROM sync_schedules WHERE id = ${id} AND user_id = ${userId}
 `);
  const rows = result[0];
  return rows?.[0] || null;
}
async function getSyncSchedules(userId, accountId) {
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
  return result[0] || [];
}
async function getDueSchedules() {
  const db = await getDb();
  if (!db) return [];
  const now = /* @__PURE__ */ new Date();
  const result = await db.execute(sql`
    SELECT id, user_id as userId, account_id as accountId, sync_type as syncType, frequency, hour, day_of_week as dayOfWeek, day_of_month as dayOfMonth, is_enabled as isEnabled, last_run_at as lastRunAt, next_run_at as nextRunAt
    FROM sync_schedules WHERE is_enabled = true AND next_run_at <= ${now}
  `);
  return result[0] || [];
}
async function executeScheduledSync(scheduleId) {
  const db = await getDb();
  if (!db) return { success: false, message: "\u6570\u636E\u5E93\u8FDE\u63A5\u5931\u8D25" };
  const result = await db.execute(sql`
    SELECT id, user_id as userId, account_id as accountId, sync_type as syncType, frequency, hour, day_of_week as dayOfWeek, day_of_month as dayOfMonth
    FROM sync_schedules WHERE id = ${scheduleId}
  `);
  const schedule = result[0]?.[0];
  if (!schedule) return { success: false, message: "\u8C03\u5EA6\u914D\u7F6E\u4E0D\u5B58\u5728" };
  const jobId = await createSyncJob2(schedule.userId, schedule.accountId, schedule.syncType);
  if (!jobId) return { success: false, message: "\u521B\u5EFA\u540C\u6B65\u4EFB\u52A1\u5931\u8D25" };
  const nextRunAt = calculateNextRunTime2(schedule);
  await db.execute(sql`
    UPDATE sync_schedules SET last_run_at = NOW(), next_run_at = ${nextRunAt}, updated_at = NOW()
    WHERE id = ${scheduleId}
  `);
  executeSyncJob(jobId).catch((err) => log139.warn("[DataSync] executeSyncJob failed:", err));
  return { success: true, jobId, message: "\u540C\u6B65\u4EFB\u52A1\u5DF2\u542F\u52A8" };
}
function calculateNextRunTime2(config2) {
  const now = /* @__PURE__ */ new Date();
  const next = new Date(now);
  const hour2 = config2.hour ?? 0;
  switch (config2.frequency) {
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
      next.setHours(hour2, 0, 0, 0);
      if (next <= now) next.setDate(next.getDate() + 1);
      break;
    case "weekly":
      const dayOfWeek = config2.dayOfWeek ?? 0;
      next.setHours(hour2, 0, 0, 0);
      const daysUntilTarget = (dayOfWeek - next.getDay() + 7) % 7;
      next.setDate(next.getDate() + (daysUntilTarget === 0 && next <= now ? 7 : daysUntilTarget));
      break;
    case "monthly":
      const dayOfMonth = config2.dayOfMonth ?? 1;
      next.setDate(dayOfMonth);
      next.setHours(hour2, 0, 0, 0);
      if (next <= now) next.setMonth(next.getMonth() + 1);
      break;
  }
  return next;
}
async function runScheduleCheck() {
  const dueSchedules = await getDueSchedules();
  let executed = 0;
  let failed = 0;
  for (const schedule of dueSchedules) {
    try {
      const result = await executeScheduledSync(schedule.id);
      if (result.success) executed++;
      else failed++;
    } catch (error48) {
      failed++;
      log139.warn(`\u6267\u884C\u8C03\u5EA6\u4EFB\u52A1 ${schedule.id} \u5931\u8D25:`, error48);
    }
  }
  return { executed, failed };
}
async function getScheduleHistory(scheduleId, limit = 20) {
  const db = await getDb();
  if (!db) return [];
  const result = await db.execute(sql`
    SELECT j.id, j.status, j.recordsSynced, j.errorMessage, j.startedAt, j.completedAt, j.createdAt
    FROM data_sync_jobs j
    INNER JOIN sync_schedules s ON j.accountId = s.account_id AND j.userId = s.user_id
    WHERE s.id = ${scheduleId}
    ORDER BY j.createdAt DESC
    LIMIT ${sql.raw(String(limit))}
  `);
  return result[0] || [];
}
async function getScheduleExecutionHistory(scheduleId, limit = 50) {
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
      LIMIT ${sql.raw(String(limit))}
    `);
    const rows = result[0] || [];
    return rows.map((row) => ({
      id: row.id,
      scheduleId: row.scheduleId,
      jobId: row.jobId,
      status: row.status === "completed" ? "success" : row.status === "failed" ? "failed" : "retrying",
      retryCount: row.retryCount || 0,
      errorMessage: row.errorMessage,
      // @ts-ignore
      startedAt: row.startedAt ? new Date(row.startedAt) : /* @__PURE__ */ new Date(),
      // @ts-ignore
      completedAt: row.completedAt ? new Date(row.completedAt) : null,
      recordsSynced: row.recordsSynced || 0,
      duration: row.duration
    }));
  } catch (error48) {
    log139.warn("\u83B7\u53D6\u6267\u884C\u5386\u53F2\u5931\u8D25:", error48);
    return [];
  }
}
async function executeScheduledSyncWithRetry(scheduleId) {
  let retryCount = 0;
  let lastError = null;
  while (retryCount <= RETRY_CONFIG.maxRetries) {
    try {
      const result = await executeScheduledSync(scheduleId);
      if (result.success) {
        await logScheduleExecution(scheduleId, result.jobId, "success", retryCount);
        return { ...result, retryCount };
      } else {
        await logScheduleExecution(scheduleId, result.jobId, "failed", retryCount, result.message);
        return { ...result, retryCount };
      }
    } catch (error48) {
      lastError = error48;
      retryCount++;
      if (retryCount <= RETRY_CONFIG.maxRetries) {
        const delay2 = RETRY_CONFIG.retryDelayMs * Math.pow(RETRY_CONFIG.backoffMultiplier, retryCount - 1);
        log139.info(`\u8C03\u5EA6 ${scheduleId} \u6267\u884C\u5931\u8D25\uFF0C${delay2 / 1e3}\u79D2\u540E\u8FDB\u884C\u7B2C ${retryCount} \u6B21\u91CD\u8BD5...`);
        await new Promise((resolve) => setTimeout(resolve, delay2));
      }
    }
  }
  const errorMessage = lastError?.message || "\u672A\u77E5\u9519\u8BEF";
  await logScheduleExecution(scheduleId, null, "failed", retryCount, errorMessage);
  await sendScheduleFailureAlert(scheduleId, errorMessage, retryCount);
  return {
    success: false,
    message: `\u6267\u884C\u5931\u8D25\uFF0C\u5DF2\u91CD\u8BD5 ${retryCount} \u6B21: ${errorMessage}`,
    retryCount
  };
}
async function logScheduleExecution(scheduleId, jobId, status, retryCount, errorMessage) {
  const db = await getDb();
  if (!db) return;
  try {
    if (jobId) {
      await db.execute(sql`
 UPDATE data_sync_jobs 
 SET retry_count = ${retryCount}
 WHERE id = ${jobId}
 `);
    }
    await db.insert(dataSyncLogs).values({
      jobId: jobId || 0,
      operation: `schedule_execution_${scheduleId}`,
      status: status === "success" ? "success" : "error",
      message: errorMessage || (status === "success" ? "\u6267\u884C\u6210\u529F" : "\u6267\u884C\u5931\u8D25"),
      details: { scheduleId, retryCount, timestamp: (/* @__PURE__ */ new Date()).toISOString() }
    });
  } catch (error48) {
    log139.warn("\u8BB0\u5F55\u6267\u884C\u65E5\u5FD7\u5931\u8D25:", error48);
  }
}
async function sendScheduleFailureAlert(scheduleId, errorMessage, retryCount) {
  try {
    const db = await getDb();
    if (!db) return;
    const scheduleResult = await db.execute(sql`
      SELECT s.*, a.account_name as accountName
      FROM sync_schedules s
      LEFT JOIN ad_accounts a ON s.account_id = a.id
      WHERE s.id = ${scheduleId}
    `);
    const schedule = scheduleResult[0]?.[0];
    if (!schedule) return;
    const { notifyOwner: notifyOwner2 } = await Promise.resolve().then(() => (init_notification(), notification_exports));
    const syncTypeNames = {
      campaigns: "\u5E7F\u544A\u6D3B\u52A8",
      keywords: "\u5173\u952E\u8BCD",
      performance: "\u7EE9\u6548\u6570\u636E",
      all: "\u5168\u91CF\u540C\u6B65"
    };
    await notifyOwner2({
      title: "\u6570\u636E\u540C\u6B65\u8C03\u5EA6\u6267\u884C\u5931\u8D25",
      content: `
\u8C03\u5EA6\u4EFB\u52A1\u6267\u884C\u5931\u8D25\u544A\u8B66

// @ts-ignore
\u8D26\u53F7: ${schedule.accountName || "\u672A\u77E5"}
// @ts-ignore
\u540C\u6B65\u7C7B\u578B: ${syncTypeNames[schedule.syncType] || schedule.syncType}
// @ts-ignore
\u91CD\u8BD5\u6B21\u6570: ${retryCount}/${RETRY_CONFIG.maxRetries}
\u9519\u8BEF\u4FE1\u606F: ${errorMessage}

\u8BF7\u68C0\u67E5Amazon API\u8FDE\u63A5\u72B6\u6001\u548C\u8D26\u53F7\u6388\u6743\u662F\u5426\u6B63\u5E38\u3002
      `.trim()
    });
  } catch (error48) {
    log139.warn("\u53D1\u9001\u5931\u8D25\u544A\u8B66\u5931\u8D25:", error48);
  }
}
async function getScheduleExecutionStats(scheduleId) {
  const db = await getDb();
  if (!db) {
    return {
      totalExecutions: 0,
      // @ts-ignore
      successCount: 0,
      // @ts-ignore
      failureCount: 0,
      avgDuration: null,
      lastSuccessAt: null,
      lastFailureAt: null
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
    const row = result[0]?.[0];
    if (!row) {
      return {
        totalExecutions: 0,
        successCount: 0,
        failureCount: 0,
        avgDuration: null,
        lastSuccessAt: null,
        lastFailureAt: null
      };
    }
    return {
      totalExecutions: Number(row.totalExecutions) || 0,
      successCount: Number(row.successCount) || 0,
      failureCount: Number(row.failureCount) || 0,
      avgDuration: row.avgDuration ? Number(row.avgDuration) : null,
      // @ts-ignore
      lastSuccessAt: row.lastSuccessAt ? new Date(row.lastSuccessAt) : null,
      // @ts-ignore
      lastFailureAt: row.lastFailureAt ? new Date(row.lastFailureAt) : null
    };
  } catch (error48) {
    log139.warn("\u83B7\u53D6\u6267\u884C\u7EDF\u8BA1\u5931\u8D25:", error48);
    return {
      totalExecutions: 0,
      successCount: 0,
      failureCount: 0,
      avgDuration: null,
      lastSuccessAt: null,
      lastFailureAt: null
    };
  }
}
async function runScheduleCheckWithRetry() {
  const dueSchedules = await getDueSchedules();
  let executed = 0;
  let failed = 0;
  let retried = 0;
  for (const schedule of dueSchedules) {
    try {
      const result = await executeScheduledSyncWithRetry(schedule.id);
      if (result.success) {
        executed++;
      } else {
        failed++;
      }
      if (result.retryCount > 0) {
        retried += result.retryCount;
      }
    } catch (error48) {
      failed++;
      log139.warn(`\u6267\u884C\u8C03\u5EA6\u4EFB\u52A1 ${schedule.id} \u5931\u8D25:`, error48);
    }
  }
  return { executed, failed, retried };
}
async function cleanupStaleJobs(maxRunningMinutes = 120) {
  const db = await getDb();
  if (!db) return { cleaned: 0, jobIds: [] };
  try {
    const cutoffTime = new Date(Date.now() - maxRunningMinutes * 60 * 1e3);
    const cutoffStr = cutoffTime.toISOString().slice(0, 19).replace("T", " ");
    const staleJobs = await db.select({
      id: dataSyncJobs.id,
      accountId: dataSyncJobs.accountId,
      startedAt: dataSyncJobs.startedAt,
      syncType: dataSyncJobs.syncType
    }).from(dataSyncJobs).where(and(
      eq(dataSyncJobs.status, "running"),
      sql`${dataSyncJobs.updatedAt} < ${cutoffStr}`
    ));
    if (staleJobs.length === 0) {
      return { cleaned: 0, jobIds: [] };
    }
    const jobIds = staleJobs.map((j) => j.id);
    await db.update(dataSyncJobs).set({
      status: "failed",
      completedAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " "),
      errorMessage: `v334: \u4EFB\u52A1\u8D85\u65F6\uFF08\u8D85\u8FC7${maxRunningMinutes}\u5206\u949F\uFF09\uFF0C\u7531\u5361\u6B7B\u4EFB\u52A1\u6E05\u7406\u673A\u5236\u81EA\u52A8\u6807\u8BB0\u4E3A\u5931\u8D25`
    }).where(and(
      eq(dataSyncJobs.status, "running"),
      sql`${dataSyncJobs.updatedAt} < ${cutoffStr}`
    ));
    for (const job of staleJobs) {
      log139.warn(`[DataSync] v334: \u6E05\u7406\u5361\u6B7B\u4EFB\u52A1 Job#${job.id} (\u8D26\u6237${job.accountId}, \u7C7B\u578B${job.syncType}, \u542F\u52A8\u65F6\u95F4${job.startedAt})`);
      await logSyncActivity(
        0,
        "cleanup_stale",
        "success",
        `v334: \u6E05\u7406\u5361\u6B7B\u4EFB\u52A1 Job#${job.id}, \u8D26\u6237${job.accountId}, \u8FD0\u884C\u8D85\u8FC7${maxRunningMinutes}\u5206\u949F`
      );
    }
    log139.info(`[DataSync] v334: \u5361\u6B7B\u4EFB\u52A1\u6E05\u7406\u5B8C\u6210\uFF0C\u5171\u6E05\u7406 ${staleJobs.length} \u4E2A\u4EFB\u52A1: ${jobIds.join(", ")}`);
    return { cleaned: staleJobs.length, jobIds };
  } catch (error48) {
    log139.warn(`[DataSync] v334: \u5361\u6B7B\u4EFB\u52A1\u6E05\u7406\u5931\u8D25: ${error48.message}`);
    return { cleaned: 0, jobIds: [] };
  }
}
async function cleanupOrphanedPendingJobs(maxPendingMinutes = 60) {
  const db = await getDb();
  if (!db) return { cleaned: 0 };
  try {
    const cutoffTime = new Date(Date.now() - maxPendingMinutes * 60 * 1e3);
    const cutoffStr = cutoffTime.toISOString().slice(0, 19).replace("T", " ");
    const result = await db.update(dataSyncJobs).set({
      status: "cancelled",
      completedAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " "),
      errorMessage: `v334: \u4EFB\u52A1\u5728pending\u72B6\u6001\u8D85\u8FC7${maxPendingMinutes}\u5206\u949F\uFF0C\u81EA\u52A8\u53D6\u6D88`
    }).where(and(
      eq(dataSyncJobs.status, "pending"),
      sql`${dataSyncJobs.createdAt} < ${cutoffStr}`
    ));
    const cleaned = result[0]?.affectedRows || 0;
    if (cleaned > 0) {
      log139.info(`[DataSync] v334: \u6E05\u7406\u4E86 ${cleaned} \u4E2A\u5B64\u513Fpending\u4EFB\u52A1`);
    }
    return { cleaned };
  } catch (error48) {
    log139.warn(`[DataSync] v334: \u5B64\u513Fpending\u4EFB\u52A1\u6E05\u7406\u5931\u8D25: ${error48.message}`);
    return { cleaned: 0 };
  }
}
var log139, RATE_LIMITS, RateLimiter, rateLimiter, RETRY_CONFIG;
var init_dataSyncService = __esm({
  "server/sync/dataSyncService.ts"() {
    "use strict";
    init_logger();
    init_drizzle_orm();
    init_db2();
    init_schema2();
    log139 = createModuleLogger("DataSync");
    RATE_LIMITS = {
      requestsPerSecond: 5,
      requestsPerMinute: 100,
      requestsPerHour: 1e3,
      burstLimit: 10
    };
    RateLimiter = class {
      static {
        __name(this, "RateLimiter");
      }
      queue = [];
      requestCounts = { second: 0, minute: 0, hour: 0 };
      lastReset = { second: Date.now(), minute: Date.now(), hour: Date.now() };
      processing = false;
      async enqueue(request) {
        return new Promise((resolve, reject) => {
          this.queue.push({
            ...request,
            id: `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            addedAt: Date.now(),
            resolve,
            reject
          });
          this.queue.sort((a, b) => b.priority - a.priority);
          this.processQueue();
        });
      }
      async processQueue() {
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
          } catch (error48) {
            request.reject(error48);
          }
          await this.delay(200);
        }
        this.processing = false;
      }
      resetCountersIfNeeded() {
        const now = Date.now();
        if (now - this.lastReset.second >= 1e3) {
          this.requestCounts.second = 0;
          this.lastReset.second = now;
        }
        if (now - this.lastReset.minute >= 6e4) {
          this.requestCounts.minute = 0;
          this.lastReset.minute = now;
        }
        if (now - this.lastReset.hour >= 36e5) {
          this.requestCounts.hour = 0;
          this.lastReset.hour = now;
        }
      }
      canMakeRequest() {
        return this.requestCounts.second < RATE_LIMITS.requestsPerSecond && this.requestCounts.minute < RATE_LIMITS.requestsPerMinute && this.requestCounts.hour < RATE_LIMITS.requestsPerHour;
      }
      incrementCounters() {
        this.requestCounts.second++;
        this.requestCounts.minute++;
        this.requestCounts.hour++;
      }
      async waitForSlot() {
        const waitTime = this.requestCounts.second >= RATE_LIMITS.requestsPerSecond ? 1e3 - (Date.now() - this.lastReset.second) : this.requestCounts.minute >= RATE_LIMITS.requestsPerMinute ? 6e4 - (Date.now() - this.lastReset.minute) : 36e5 - (Date.now() - this.lastReset.hour);
        await this.delay(Math.max(waitTime, 100));
      }
      delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
      }
      async executeRequest(request) {
        return { success: true, endpoint: request.endpoint, timestamp: Date.now() };
      }
      getQueueStatus() {
        return { queueLength: this.queue.length, requestCounts: { ...this.requestCounts }, limits: RATE_LIMITS };
      }
    };
    rateLimiter = new RateLimiter();
    __name(createSyncJob2, "createSyncJob");
    __name(executeSyncJob, "executeSyncJob");
    __name(syncCampaigns, "syncCampaigns");
    __name(syncKeywords, "syncKeywords");
    __name(syncPerformance, "syncPerformance");
    __name(logSyncActivity, "logSyncActivity");
    __name(getSyncJobs, "getSyncJobs");
    __name(getSyncLogs2, "getSyncLogs");
    __name(cancelSyncJob, "cancelSyncJob");
    __name(getRateLimitStatus, "getRateLimitStatus");
    __name(recordApiRateLimit, "recordApiRateLimit");
    __name(getApiUsageStats, "getApiUsageStats");
    __name(createSyncSchedule2, "createSyncSchedule");
    __name(updateSyncSchedule2, "updateSyncSchedule");
    __name(deleteSyncSchedule2, "deleteSyncSchedule");
    __name(getSyncScheduleById, "getSyncScheduleById");
    __name(getSyncSchedules, "getSyncSchedules");
    __name(getDueSchedules, "getDueSchedules");
    __name(executeScheduledSync, "executeScheduledSync");
    __name(calculateNextRunTime2, "calculateNextRunTime");
    __name(runScheduleCheck, "runScheduleCheck");
    __name(getScheduleHistory, "getScheduleHistory");
    RETRY_CONFIG = {
      maxRetries: 3,
      retryDelayMs: 3e4,
      // 30秒
      backoffMultiplier: 2
      // 指数退避
    };
    __name(getScheduleExecutionHistory, "getScheduleExecutionHistory");
    __name(executeScheduledSyncWithRetry, "executeScheduledSyncWithRetry");
    __name(logScheduleExecution, "logScheduleExecution");
    __name(sendScheduleFailureAlert, "sendScheduleFailureAlert");
    __name(getScheduleExecutionStats, "getScheduleExecutionStats");
    __name(runScheduleCheckWithRetry, "runScheduleCheckWithRetry");
    __name(cleanupStaleJobs, "cleanupStaleJobs");
    __name(cleanupOrphanedPendingJobs, "cleanupOrphanedPendingJobs");
  }
});

