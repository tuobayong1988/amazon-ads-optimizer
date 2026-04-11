// Extracted from production dist/index.js
// Original module: server/sync/unifiedSyncEngine.ts
// Lines: 2423

var unifiedSyncEngine_exports = {};
__export(unifiedSyncEngine_exports, {
  MAX_CONCURRENT_ACCOUNTS: () => MAX_CONCURRENT_ACCOUNTS,
  SYNC_STEPS: () => SYNC_STEPS,
  TIER_HIERARCHY: () => TIER_HIERARCHY,
  captureHealthSnapshot: () => captureHealthSnapshot,
  confirmationSync: () => confirmationSync,
  discoverSyncableAccounts: () => discoverSyncableAccounts,
  getAccountSyncStatus: () => getAccountSyncStatus,
  getAllSyncSteps: () => getAllSyncSteps,
  getDistributedWorkerInfo: () => getDistributedWorkerInfo,
  getEngineStatus: () => getEngineStatus,
  getHealthHistory: () => getHealthHistory,
  getRateController: () => getRateController,
  getStepsForTier: () => getStepsForTier,
  isAccountSyncing: () => isAccountSyncing,
  logHealthSnapshot: () => logHealthSnapshot,
  shutdownDistributedWorker: () => shutdownDistributedWorker,
  syncAccount: () => syncAccount,
  syncAllAccounts: () => syncAllAccounts,
  triggerManualFullSync: () => triggerManualFullSync
});
async function v534Init() {
  if (v534Initialized) return;
  v534Initialized = true;
  try {
    const cleaned = await cleanupStaleDbSyncJobs();
    if (cleaned > 0) {
      log135.warn(`[v534] \u8FDB\u7A0B\u542F\u52A8\u521D\u59CB\u5316: \u6E05\u7406\u4E86 ${cleaned} \u4E2A\u50F5\u5C38/\u8D85\u65F6\u4EFB\u52A1`);
    }
    const backfilled = await backfillMissingValues();
    if (backfilled > 0) {
      log135.info(`[v534] \u8FDB\u7A0B\u542F\u52A8\u521D\u59CB\u5316: \u56DE\u586B\u4E86 ${backfilled} \u6761optimization_events`);
    }
    startReconciliationScheduler();
    log135.info("[v534] \u8FDB\u7A0B\u542F\u52A8\u521D\u59CB\u5316\u5B8C\u6210");
  } catch (e) {
    log135.warn(`[v534] \u8FDB\u7A0B\u542F\u52A8\u521D\u59CB\u5316\u5931\u8D25: ${e.message}`);
  }
}
function captureHealthSnapshot() {
  const mem = process.memoryUsage();
  const snapshot = {
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    memoryMB: {
      rss: Math.round(mem.rss / 1024 / 1024),
      heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
      // v393: 使用systemConfigService动态获取堆内存上限，替代硬编码的1400MB
      // 通过v8.getHeapStatistics().heap_size_limit获取真实的--max-old-space-size值
      heapUtilization: calculateHeapUtilization(mem.heapUsed)
    },
    rateControl: rateController.getStatus(),
    syncStats: {
      totalSyncsCompleted: engineStatus.totalSyncsCompleted,
      totalSyncsFailed: engineStatus.totalSyncsFailed,
      activeSyncs: activeSyncs.size,
      discoveredAccounts: engineStatus.discoveredAccounts
    },
    confirmationSyncStats: {
      totalTriggered: confirmationTracker.totalTriggered,
      totalSucceeded: confirmationTracker.totalSucceeded,
      totalFailed: confirmationTracker.totalFailed,
      avgDurationMs: confirmationTracker.totalTriggered > 0 ? Math.round(confirmationTracker.totalDurationMs / confirmationTracker.totalTriggered) : 0,
      lastTriggeredAt: confirmationTracker.lastTriggeredAt,
      triggerSources: { ...confirmationTracker.triggerSources }
    }
  };
  healthHistory.push(snapshot);
  if (healthHistory.length > MAX_HEALTH_HISTORY) {
    healthHistory.shift();
  }
  return snapshot;
}
function logHealthSnapshot() {
  const snapshot = captureHealthSnapshot();
  const memWarning = snapshot.memoryMB.heapUtilization > 90 ? " [WARNING: \u5806\u5185\u5B58>90%]" : "";
  const throttleWarning = snapshot.rateControl.totalThrottleCount > 0 ? ` [\u9650\u6D41: ${snapshot.rateControl.totalThrottleCount}\u6B21]` : "";
  log135.info(
    `[HealthMonitor] v220 \u7CFB\u7EDF\u5065\u5EB7\u5FEB\u7167: \u5185\u5B58=${snapshot.memoryMB.rss}MB(\u5806${snapshot.memoryMB.heapUtilization}%)${memWarning} | API\u8C03\u7528=${snapshot.rateControl.totalApiCalls}(\u5CF0\u503C${snapshot.rateControl.peakCallsPerMinute}/min, \u5229\u7528\u7387${snapshot.rateControl.utilizationPercent}%)${throttleWarning} | \u540C\u6B65=${snapshot.syncStats.totalSyncsCompleted}\u6210\u529F/${snapshot.syncStats.totalSyncsFailed}\u5931\u8D25 | \u786E\u8BA4\u540C\u6B65=${snapshot.confirmationSyncStats.totalTriggered}\u6B21(\u6210\u529F${snapshot.confirmationSyncStats.totalSucceeded}, \u5E73\u5747${snapshot.confirmationSyncStats.avgDurationMs}ms)`
  );
  logSync("HealthMonitor", "v220 \u7CFB\u7EDF\u5065\u5EB7\u5FEB\u7167", snapshot);
  if (healthHistory.length >= 4) {
    const recent4 = healthHistory.slice(-4);
    const isMonotonicallyIncreasing = recent4.every(
      (s, i) => i === 0 || s.memoryMB.rss > recent4[i - 1].memoryMB.rss
    );
    if (isMonotonicallyIncreasing) {
      const growth = recent4[3].memoryMB.rss - recent4[0].memoryMB.rss;
      log135.warn(`[HealthMonitor] \u5185\u5B58\u6CC4\u6F0F\u7591\u4F3C: RSS\u8FDE\u7EED4\u4E2A\u5468\u671F\u589E\u957F, \u589E\u91CF=${growth}MB (${recent4[0].memoryMB.rss}MB \u2192 ${recent4[3].memoryMB.rss}MB)`);
      logSyncWarn("HealthMonitor", "\u5185\u5B58\u6CC4\u6F0F\u7591\u4F3C", {
        growth,
        from: recent4[0].memoryMB.rss,
        to: recent4[3].memoryMB.rss,
        snapshots: recent4.map((s) => ({ time: s.timestamp, rss: s.memoryMB.rss }))
      });
    }
  }
  if (snapshot.memoryMB.heapUtilization > 85) {
    log135.warn(`[HealthMonitor] \u5806\u5185\u5B58\u4F7F\u7528\u7387${snapshot.memoryMB.heapUtilization}%\uFF0C\u89E6\u53D1\u5185\u5B58\u4FDD\u62A4`);
    if (typeof global.gc === "function") {
      global.gc();
      log135.info("[HealthMonitor] \u5DF2\u624B\u52A8\u89E6\u53D1GC");
    }
  }
  const now = /* @__PURE__ */ new Date();
  let zombiesCleaned = 0;
  for (const [key, sync] of activeSyncs.entries()) {
    const heartbeatAge = now.getTime() - sync.lastHeartbeat.getTime();
    const totalRuntime = now.getTime() - sync.startTime.getTime();
    const absoluteTimeout = Math.min(sync.timeoutMs || MAX_ABSOLUTE_TIMEOUT_MS, MAX_ABSOLUTE_TIMEOUT_MS);
    const isHeartbeatDead = heartbeatAge > HEARTBEAT_ZOMBIE_TIMEOUT_MS;
    const isAbsoluteTimeout = totalRuntime > absoluteTimeout;
    if (isHeartbeatDead || isAbsoluteTimeout) {
      const runningMin = (totalRuntime / 6e4).toFixed(1);
      const heartbeatMin = (heartbeatAge / 6e4).toFixed(1);
      const reason = isHeartbeatDead ? `\u5FC3\u8DF3\u8D85\u65F6(${heartbeatMin}\u5206\u949F\u65E0\u5FC3\u8DF3\uFF0C\u9608\u503C${Math.round(HEARTBEAT_ZOMBIE_TIMEOUT_MS / 6e4)}\u5206\u949F)` : `\u7EDD\u5BF9\u8D85\u65F6(\u8FD0\u884C${runningMin}\u5206\u949F\uFF0C\u4E0A\u9650${Math.round(absoluteTimeout / 6e4)}\u5206\u949F)`;
      log135.warn(`[HealthMonitor] v528: \u50F5\u5C38\u6E05\u7406 - ${key} \u5DF2\u8FD0\u884C${runningMin}\u5206\u949F\uFF0C\u539F\u56E0: ${reason}`);
      activeSyncs.delete(key);
      zombiesCleaned++;
    }
  }
  if (zombiesCleaned > 0) {
    engineStatus.currentlyRunning = engineStatus.currentlyRunning.filter((r) => {
      const key = `${r.accountId}:${r.tier}`;
      return activeSyncs.has(key);
    });
    log135.warn(`[HealthMonitor] v528: \u5DF2\u6E05\u7406 ${zombiesCleaned} \u4E2A\u50F5\u5C38\u540C\u6B65\u6761\u76EE`);
  }
}
function getHealthHistory() {
  return [...healthHistory];
}
function getRateController() {
  return rateController;
}
async function discoverSyncableAccounts() {
  try {
    const database = await getDb();
    if (!database) {
      log135.warn("[UnifiedSync] \u6570\u636E\u5E93\u4E0D\u53EF\u7528\uFF0C\u65E0\u6CD5\u53D1\u73B0\u8D26\u6237");
      return [];
    }
    const { adAccounts: adAccounts3, amazonApiCredentials: amazonApiCredentials3 } = await Promise.resolve().then(() => (init_schema2(), schema_exports));
    const results = await database.select({
      accountId: adAccounts3.id,
      userId: adAccounts3.userId,
      accountName: adAccounts3.accountName,
      marketplace: adAccounts3.marketplace,
      profileId: adAccounts3.profileId,
      clientId: amazonApiCredentials3.clientId,
      clientSecret: amazonApiCredentials3.clientSecret,
      refreshToken: amazonApiCredentials3.refreshToken,
      region: amazonApiCredentials3.region,
      lastSyncAt: amazonApiCredentials3.lastSyncAt,
      syncStatus: amazonApiCredentials3.syncStatus,
      accountStatus: adAccounts3.status,
      connectionStatus: adAccounts3.connectionStatus
    }).from(adAccounts3).innerJoin(amazonApiCredentials3, eq(adAccounts3.id, amazonApiCredentials3.accountId));
    const { safeDecrypt: safeDecrypt2 } = await Promise.resolve().then(() => (init_cryptoService(), cryptoService_exports));
    const syncable = results.filter((r) => {
      if (!r.clientId || !r.clientSecret || !r.refreshToken || !r.profileId) {
        return false;
      }
      if (r.accountStatus === "archived" || r.accountStatus === "paused") {
        return false;
      }
      // v620-fix12: 只同步已授权连接的账户，防止对未授权站点同步数据
      if (r.connectionStatus === "disconnected" || r.connectionStatus === "error" || r.connectionStatus === "pending") {
        log135.info(`[UnifiedSync] [v620-fix12] 跳过未授权账户 ${r.accountId} (${r.accountName}), connectionStatus=${r.connectionStatus}`);
        return false;
      }
      return true;
    }).map((r) => ({
      accountId: r.accountId,
      userId: r.userId,
      accountName: r.accountName,
      marketplace: r.marketplace,
      profileId: r.profileId,
      clientId: r.clientId,
      clientSecret: safeDecrypt2(r.clientSecret),
      refreshToken: safeDecrypt2(r.refreshToken),
      region: r.region || "NA",
      lastSyncAt: r.lastSyncAt,
      syncStatus: r.syncStatus
    }));
    engineStatus.discoveredAccounts = syncable.length;
    log135.info(`[UnifiedSync] \u81EA\u52A8\u53D1\u73B0 ${syncable.length} \u4E2A\u53EF\u540C\u6B65\u8D26\u6237\uFF08\u5171 ${results.length} \u4E2A\u8D26\u6237\u8BB0\u5F55\uFF09`);
    return syncable;
  } catch (error48) {
    log135.warn(`[UnifiedSync] \u8D26\u6237\u53D1\u73B0\u5931\u8D25: ${error48.message}`);
    logSyncError("UnifiedSync", "\u8D26\u6237\u53D1\u73B0\u5931\u8D25", { error: error48.message });
    return [];
  }
}
function getStepsForTier(tier2) {
  const includedTiers = TIER_HIERARCHY[tier2];
  return SYNC_STEPS.filter((step) => includedTiers.includes(step.tier));
}
async function syncAccount(account, tier2, options) {
  const startTime = /* @__PURE__ */ new Date();
  const result = {
    accountId: account.accountId,
    userId: account.userId,
    // v336: 传递userId用于同步记录
    accountName: account.accountName,
    tier: tier2,
    success: false,
    startTime,
    endTime: startTime,
    durationMs: 0,
    completedSteps: 0,
    failedSteps: 0,
    totalSteps: 0,
    totalSynced: 0,
    errors: [],
    stepResults: {}
  };
  const lockKey = `${account.accountId}:${tier2}`;
  const accountLocks2 = Array.from(activeSyncs.entries()).filter(([key]) => key.startsWith(`${account.accountId}:`));
  let fullSyncRunning = false;
  for (const [existingKey, existing] of accountLocks2) {
    const existingTier = existingKey.split(":")[1];
    const runningMinutes = (Date.now() - existing.startTime.getTime()) / 6e4;
    const existingTimeoutMin = (existing.timeoutMs || DEFAULT_SYNC_TIMEOUT_MS) / 6e4;
    if (runningMinutes >= existingTimeoutMin) {
      log135.warn(`[UnifiedSync] v518: \u8D26\u6237 ${account.accountId} \u7684${existingTier}\u5C42\u540C\u6B65\u5DF2\u8D85\u65F6\uFF08${runningMinutes.toFixed(1)}\u5206\u949F >= \u52A8\u6001\u9608\u503C${existingTimeoutMin}\u5206\u949F\uFF09\uFF0C\u5F3A\u5236\u91CA\u653E`);
      activeSyncs.delete(existingKey);
      continue;
    }
    if (existingTier === tier2) {
      if (options?.isManual) {
        log135.warn(`[UnifiedSync] v425: \u624B\u52A8\u540C\u6B65\u4F18\u5148 - \u5F3A\u5236\u91CA\u653E\u8D26\u6237 ${account.accountId} \u7684${existingTier}\u5C42\u81EA\u52A8\u540C\u6B65\u9501\uFF08\u5DF2\u8FD0\u884C${runningMinutes.toFixed(1)}\u5206\u949F\uFF09`);
        activeSyncs.delete(existingKey);
        continue;
      }
      log135.info(`[UnifiedSync] \u8D26\u6237 ${account.accountId} \u5DF2\u6709${existingTier}\u5C42\u540C\u6B65\u5728\u8FD0\u884C\uFF08${runningMinutes.toFixed(1)}\u5206\u949F\uFF09\uFF0C\u8DF3\u8FC7`);
      result.errors.push(`\u5DF2\u6709${existingTier}\u5C42\u540C\u6B65\u5728\u8FD0\u884C`);
      return result;
    }
    if (existingTier === "full") {
      if (options?.isManual) {
        log135.warn(`[UnifiedSync] v425: \u624B\u52A8\u540C\u6B65\u4F18\u5148 - \u5F3A\u5236\u91CA\u653E\u8D26\u6237 ${account.accountId} \u7684full\u5C42\u81EA\u52A8\u540C\u6B65\u9501\uFF08\u5DF2\u8FD0\u884C${runningMinutes.toFixed(1)}\u5206\u949F\uFF09`);
        activeSyncs.delete(existingKey);
        continue;
      }
      if (tier2 === "confirmation") {
        fullSyncRunning = true;
        log135.info(`[UnifiedSync] v388: \u8D26\u6237 ${account.accountId} full\u5C42\u540C\u6B65\u5728\u8FD0\u884C\uFF08${runningMinutes.toFixed(1)}\u5206\u949F\uFF09\uFF0Cconfirmation\u5C42\u5141\u8BB8\u5E76\u884C\u6267\u884C`);
        continue;
      }
      log135.info(`[UnifiedSync] \u8D26\u6237 ${account.accountId} \u5DF2\u6709full\u5C42\u540C\u6B65\u5728\u8FD0\u884C\uFF08${runningMinutes.toFixed(1)}\u5206\u949F\uFF09\uFF0C${tier2}\u5C42\u8DF3\u8FC7`);
      result.errors.push(`\u5DF2\u6709full\u5C42\u540C\u6B65\u5728\u8FD0\u884C`);
      return result;
    }
    if (existingTier === "medium" && tier2 === "high") {
      log135.info(`[UnifiedSync] v222: \u8D26\u6237 ${account.accountId} medium\u5C42\u6B63\u5728\u8FD0\u884C\uFF08${runningMinutes.toFixed(1)}\u5206\u949F\uFF09\uFF0Chigh\u5C42\u8DF3\u8FC7\u4EE5\u51CF\u5C11API\u538B\u529B`);
      result.errors.push(`medium\u5C42\u540C\u6B65\u5728\u8FD0\u884C\uFF0Chigh\u5C42\u667A\u80FD\u8DF3\u8FC7`);
      return result;
    }
    if (tier2 === "full" && existingTier !== "full") {
      if (options?.isManual) {
        log135.warn(`[UnifiedSync] v406: \u624B\u52A8\u5168\u91CF\u540C\u6B65\u4F18\u5148 - \u5F3A\u5236\u91CA\u653E\u8D26\u6237 ${account.accountId} \u7684${existingTier}\u5C42\u81EA\u52A8\u540C\u6B65\u9501`);
        activeSyncs.delete(existingKey);
        continue;
      }
      log135.info(`[UnifiedSync] v222: \u8D26\u6237 ${account.accountId} \u6709${existingTier}\u5C42\u540C\u6B65\u5728\u8FD0\u884C\uFF0Cfull\u5C42\u8DF3\u8FC7\u7B49\u4E0B\u4E00\u8F6E`);
      result.errors.push(`${existingTier}\u5C42\u540C\u6B65\u5728\u8FD0\u884C\uFF0Cfull\u5C42\u7B49\u4E0B\u4E00\u8F6E`);
      return result;
    }
  }
  activeSyncs.set(lockKey, { tier: tier2, startTime, lastHeartbeat: /* @__PURE__ */ new Date(), timeoutMs: DEFAULT_SYNC_TIMEOUT_MS });
  engineStatus.currentlyRunning.push({ accountId: account.accountId, tier: tier2, step: "initializing" });
  let redisLockRenewTimer = null;
  try {
    const { precheckToken: precheckToken2, shouldSkipSync: shouldSkipSync2, markTokenUnhealthy: markTokenUnhealthy2 } = await Promise.resolve().then(() => (init_tokenHealthChecker(), tokenHealthChecker_exports));
    const skipCheck = shouldSkipSync2(account.accountId);
    if (skipCheck.skip) {
      log135.warn(`[UnifiedSync] fix24-P0-1: \u8DF3\u8FC7\u8D26\u6237${account.accountId}(${account.accountName})\u540C\u6B65 - ${skipCheck.reason}`);
      result.errors.push(`Token\u5065\u5EB7\u68C0\u67E5: ${skipCheck.reason}`);
      return result;
    }
    const tokenCheck = await precheckToken2(
      {
        clientId: account.clientId,
        clientSecret: account.clientSecret,
        refreshToken: account.refreshToken,
        profileId: account.profileId,
        region: account.region
      },
      account.accountId,
      account.accountName,
      account.marketplace
    );
    if (!tokenCheck.valid) {
      log135.warn(`[UnifiedSync] fix24-P0-1: \u8D26\u6237${account.accountId}(${account.accountName}) Token\u9884\u68C0\u67E5\u5931\u8D25: ${tokenCheck.error}`);
      result.errors.push(`Token\u9884\u68C0\u67E5\u5931\u8D25(${tokenCheck.errorType}): ${tokenCheck.error}`);
      try {
        const database = await getDb();
        if (database) {
          await database.execute(sql`
            UPDATE amazon_api_credentials 
            SET syncStatus = 'token_error', lastSyncError = ${tokenCheck.error?.substring(0, 500) || "Token validation failed"}
            WHERE accountId = ${account.accountId}
          `);
        }
      } catch (dbErr) {
        log135.debug(`[UnifiedSync] fix24-P0-1: \u66F4\u65B0Token\u9519\u8BEF\u72B6\u6001\u5230DB\u5931\u8D25: ${dbErr.message}`);
      }
      return result;
    }
    log135.debug(`[UnifiedSync] fix24-P0-1: \u8D26\u6237${account.accountId}(${account.accountName}) Token\u9884\u68C0\u67E5\u901A\u8FC7`);
    const syncService = await AmazonSyncService.createFromCredentials(
      {
        clientId: account.clientId,
        clientSecret: account.clientSecret,
        refreshToken: account.refreshToken,
        profileId: account.profileId,
        region: account.region
      },
      account.accountId,
      account.userId,
      account.marketplace
    );
    let steps;
    if (options?.specificSteps) {
      steps = SYNC_STEPS.filter((s) => options.specificSteps.includes(s.id));
    } else {
      steps = getStepsForTier(tier2);
    }
    if (options?.skipSteps) {
      steps = steps.filter((s) => !options.skipSteps.includes(s.id));
    }
    result.totalSteps = steps.length;
    let campaignCount = 0;
    let isLargeAccount = false;
    const LARGE_ACCOUNT_THRESHOLD = 1e3;
    const LARGE_ACCOUNT_STEP_DELAY_MS = 1e4;
    let SYNC_TIMEOUT_MS = tier2 === "nightly" ? NIGHTLY_SYNC_TIMEOUT_MS : DEFAULT_SYNC_TIMEOUT_MS;
    try {
      const database = await getDb();
      if (database) {
        const { campaigns: campaignsTable } = await Promise.resolve().then(() => (init_schema2(), schema_exports));
        const countResult = await database.select({ count: sql`COUNT(*)` }).from(campaignsTable).where(eq(campaignsTable.accountId, account.accountId));
        campaignCount = countResult[0]?.count || 0;
        isLargeAccount = campaignCount >= LARGE_ACCOUNT_THRESHOLD;
        if (isLargeAccount && tier2 !== "nightly") {
          for (const t2 of LARGE_ACCOUNT_TIMEOUT_TIERS) {
            if (campaignCount >= t2.threshold) {
              SYNC_TIMEOUT_MS = t2.timeoutMs;
              break;
            }
          }
          const existingSync = activeSyncs.get(lockKey);
          if (existingSync) {
            existingSync.timeoutMs = SYNC_TIMEOUT_MS;
          }
          log135.warn(`[UnifiedSync] v518: \u5927\u8D26\u6237\u68C0\u6D4B! \u8D26\u6237${account.accountId}(${account.accountName})\u62E5\u6709${campaignCount}\u4E2A\u5E7F\u544A\u6D3B\u52A8\uFF0C\u52A8\u6001\u8D85\u65F6=${Math.round(SYNC_TIMEOUT_MS / 6e4)}\u5206\u949F\uFF08\u5DF2\u540C\u6B65\u5230\u50F5\u5C38\u6E05\u7406/\u9501\u8D85\u65F6\uFF09`);
        }
        if (campaignCount >= 3e3 && tier2 !== "nightly") {
          log135.info(`[UnifiedSync] v614i-fix8: \u8D85\u5927\u8D26\u6237(${campaignCount}\u4E2A\u5E7F\u544A\u6D3B\u52A8)\u542F\u7528\u5206\u7247\u540C\u6B65\u7B56\u7565 - \u7EE9\u6548\u62A5\u544A\u6309SP/SB/SD\u5206\u7247\u6267\u884C`);
        }
      }
    } catch (e) {
      log135.debug(`[UnifiedSync] v340: \u67E5\u8BE2\u8D26\u6237\u5E7F\u544A\u6D3B\u52A8\u6570\u5931\u8D25: ${e.message}`);
    }
    // v596: 空账户智能跳过机制 - 基于活跃广告活动数+花费双重预检
    let isEmptyAccount = campaignCount === 0;
    let hasRecentSpend = false;
    let activeCampaignCount = 0;
    if (!isEmptyAccount) {
      // v596: 即使有广告活动，也检查是否有活跃(enabled)的广告活动和近7天花费
      try {
        const database = await getDb();
        if (database) {
          const activeResult = await database.execute(sql`
            SELECT COUNT(*) as cnt FROM campaigns 
            WHERE account_id = ${account.accountId} AND status = 'enabled'
          `);
          const activeRows = Array.isArray(activeResult) ? activeResult[0] : activeResult.rows || activeResult;
          activeCampaignCount = activeRows?.[0]?.cnt || 0;
          
          if (activeCampaignCount === 0) {
            isEmptyAccount = true;
            log135.info(`[UnifiedSync] v596: 账户${account.accountId}(${account.accountName}) 有${campaignCount}个广告活动但0个活跃(enabled)，视为空账户`);
          } else {
            // 检查近7天是否有花费
            const spendResult = await database.execute(sql`
              SELECT COALESCE(SUM(cost), 0) as totalSpend FROM daily_performance 
              WHERE account_id = ${account.accountId} AND date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
            `);
            const spendRows = Array.isArray(spendResult) ? spendResult[0] : spendResult.rows || spendResult;
            const totalSpend = parseFloat(spendRows?.[0]?.totalSpend || 0);
            hasRecentSpend = totalSpend > 0;
            
            if (!hasRecentSpend && activeCampaignCount <= 3) {
              isEmptyAccount = true;
              log135.info(`[UnifiedSync] v596: 账户${account.accountId}(${account.accountName}) 仅${activeCampaignCount}个活跃广告活动且7天花费$0，视为低活跃账户，跳过报告步骤`);
            }
          }
        }
      } catch (emptyCheckErr) {
        log135.debug(`[UnifiedSync] v596: 空账户预检查询失败: ${emptyCheckErr.message}`);
      }
    }
    
    if (isEmptyAccount && tier2 !== "full") {
      const METADATA_STEPS = ["sp_campaigns", "sb_campaigns", "sd_campaigns", "sp_ad_groups", "sb_ad_groups", "sd_ad_groups"];
      const originalStepCount = steps.length;
      steps = steps.filter((s) => METADATA_STEPS.includes(s.id));
      log135.info(`[UnifiedSync] v618: 空账户智能跳过 - 账户${account.accountId}(${account.accountName}) 活跃广告活动=${activeCampaignCount}, 从${originalStepCount}个步骤精简为${steps.length}个元数据步骤(含广告组)`);
      result.totalSteps = steps.length;
      // v596: 记录跳过事件到Redis用于监控
      try {
        const { getRedis: _rds7, isRedisAvailable: _rdsOk7 } = await Promise.resolve().then(() => (init_redisClient(), redisClient_exports));
        if (_rdsOk7() && _rds7()) {
          await _rds7().hincrby("sync:empty_account_skips", account.accountId.toString(), 1);
          await _rds7().expire("sync:empty_account_skips", 86400);
        }
      } catch(_skipErr) {}
    } else if (isEmptyAccount && tier2 === "full") {
      // v596: 全量同步时，空账户仅保留元数据+广告活动步骤，跳过所有报告和绩效步骤
      const REPORT_STEP_PREFIXES = ["perf_", "performance_", "search_term_", "placement_", "keyword_perf", "target_perf", "ad_group_perf", "auto_targeting", "sb_targeting", "sd_targeting"];
      const SKIP_STEP_IDS = new Set(["sp_bid_recommendations", "sp_negative_keywords", "sb_negative_keywords", "sd_negative_product_targets", "sp_negative_product_targets", "sb_asset_urls", "sd_audience_bid_recommendations", "sb_bid_recommendations", "sd_bid_recommendations", "performance_today", "performance_7d", "performance_backfill_95d"]);
      const originalStepCount = steps.length;
      steps = steps.filter((s) => !REPORT_STEP_PREFIXES.some((prefix) => s.id.startsWith(prefix)) && !SKIP_STEP_IDS.has(s.id));
      log135.info(`[UnifiedSync] v596: 空账户全量同步优化 - 账户${account.accountId}(${account.accountName}) 活跃广告活动=${activeCampaignCount}, 跳过${originalStepCount - steps.length}个报告/绩效步骤`);
      result.totalSteps = steps.length;
      // v596: 记录跳过事件到Redis
      try {
        const { getRedis: _rds8, isRedisAvailable: _rdsOk8 } = await Promise.resolve().then(() => (init_redisClient(), redisClient_exports));
        if (_rdsOk8() && _rds8()) {
          await _rds8().hincrby("sync:empty_account_skips", account.accountId.toString(), 1);
          await _rds8().expire("sync:empty_account_skips", 86400);
        }
      } catch(_skipErr2) {}
    } else if (!isEmptyAccount && !hasRecentSpend && tier2 !== "full") {
      // v596: 有活跃广告但无近期花费的账户，跳过搜索词和展示位置报告（这些需要花费数据才有意义）
      const SPEND_DEPENDENT_PREFIXES = ["search_term_", "placement_"];
      const originalStepCount = steps.length;
      const skippedSteps = steps.filter((s) => SPEND_DEPENDENT_PREFIXES.some((prefix) => s.id.startsWith(prefix)));
      if (skippedSteps.length > 0) {
        steps = steps.filter((s) => !SPEND_DEPENDENT_PREFIXES.some((prefix) => s.id.startsWith(prefix)));
        log135.info(`[UnifiedSync] v596: 低花费账户优化 - 账户${account.accountId}(${account.accountName}) 7天花费$0，跳过${skippedSteps.length}个花费依赖步骤(搜索词/展示位置)`);
        result.totalSteps = steps.length;
      }
    }
    const context = {
      accountId: account.accountId,
      userId: account.userId,
      tier: tier2,
      startTime,
      completedSteps: [],
      failedSteps: [],
      currentStep: null,
      totalSynced: 0,
      totalErrors: 0,
      checkpoint: {},
      adTypeCapabilities: { sb: null, sd: null }
    };
    try {
      const _capConn = await getDirectConnection(5e3);
      let capRows;
      try {
        [capRows] = await _capConn.execute(
          "SELECT sbCapability, sdCapability, sbCapabilityCheckedAt, sdCapabilityCheckedAt FROM ad_accounts WHERE id = ?",
          [account.accountId]
        );
      } finally {
        _capConn.release();
      }
      if (capRows && capRows[0]) {
        const cap = capRows[0];
        const CAPABILITY_TTL_MS = 7 * 24 * 60 * 60 * 1e3;
        const now = Date.now();
        if (cap.sbCapability !== null && cap.sbCapabilityCheckedAt) {
          const checkedAt = new Date(cap.sbCapabilityCheckedAt).getTime();
          const ageMs = now - checkedAt;
          if (ageMs < CAPABILITY_TTL_MS) {
            context.adTypeCapabilities.sb = cap.sbCapability === 1;
            if (!context.adTypeCapabilities.sb) {
              const ageDays = (ageMs / (24 * 60 * 60 * 1e3)).toFixed(1);
              log135.info(`[UnifiedSync] v614i-fix23: \u8D26\u6237${account.accountId}\u5DF2\u7F13\u5B58SB\u65E0\u6743\u9650\u72B6\u6001(\u5DF2\u7ECF\u8FC7${ageDays}\u5929/7\u5929TTL)\uFF0C\u8DF3\u8FC7SB\u6B65\u9AA4`);
            }
          } else {
            const ageDays = (ageMs / (24 * 60 * 60 * 1e3)).toFixed(1);
            log135.info(`[UnifiedSync] v614i-fix23-patch: \u8D26\u6237${account.accountId}\u7684SB\u6743\u9650\u7F13\u5B58\u5DF2\u8FC7\u671F(${ageDays}\u5929>\u9608\u503C7\u5929)\uFF0C\u5C06\u91CD\u65B0\u63A2\u6D4B\u5B9E\u9645\u6743\u9650`);
          }
        }
        if (cap.sdCapability !== null && cap.sdCapabilityCheckedAt) {
          const checkedAt = new Date(cap.sdCapabilityCheckedAt).getTime();
          const ageMs = now - checkedAt;
          if (ageMs < CAPABILITY_TTL_MS) {
            context.adTypeCapabilities.sd = cap.sdCapability === 1;
            if (!context.adTypeCapabilities.sd) {
              const ageDays = (ageMs / (24 * 60 * 60 * 1e3)).toFixed(1);
              log135.info(`[UnifiedSync] v614i-fix23: \u8D26\u6237${account.accountId}\u5DF2\u7F13\u5B58SD\u65E0\u6743\u9650\u72B6\u6001(\u5DF2\u7ECF\u8FC7${ageDays}\u5929/7\u5929TTL)\uFF0C\u8DF3\u8FC7SD\u6B65\u9AA4`);
            }
          } else {
            const ageDays = (ageMs / (24 * 60 * 60 * 1e3)).toFixed(1);
            log135.info(`[UnifiedSync] v614i-fix23-patch: \u8D26\u6237${account.accountId}\u7684SD\u6743\u9650\u7F13\u5B58\u5DF2\u8FC7\u671F(${ageDays}\u5929>\u9608\u503C7\u5929)\uFF0C\u5C06\u91CD\u65B0\u63A2\u6D4B\u5B9E\u9645\u6743\u9650`);
          }
        }
      }
    } catch (e) {
      log135.debug(`[UnifiedSync] v614i-fix23: \u52A0\u8F7DSB/SD\u6743\u9650\u7F13\u5B58\u5931\u8D25: ${e.message}`);
    }
    let v548SkipSteps = /* @__PURE__ */ new Set();
    let v548RecordRecovery = {};
    try {
      const savedCheckpoint = await loadSyncCheckpoint(account.accountId, tier2);
      if (savedCheckpoint) {
        const recovery = buildRecoveryStrategy(savedCheckpoint);
        v548SkipSteps = recovery.skipSteps;
        v548RecordRecovery = recovery.recordRecovery;
        context.completedSteps = [...savedCheckpoint.completedSteps];
        context.totalSynced = savedCheckpoint.totalSynced;
        result.completedSteps = savedCheckpoint.completedSteps.length;
        result.totalSynced = savedCheckpoint.totalSynced;
        log135.info(`[UnifiedSync] v548: \u65AD\u70B9\u7EED\u4F20\u6062\u590D - \u8D26\u6237${account.accountId} ${recovery.resumeInfo}`);
      }
    } catch (cpErr) {
      log135.debug(`[UnifiedSync] v548: \u68C0\u67E5\u70B9\u6062\u590D\u5931\u8D25(\u4E0D\u5F71\u54CD\u540C\u6B65): ${cpErr.message}`);
    }
    const taskIdForShards = `task_${account.accountId}_${tier2}`;
    try {
      await createShards(taskIdForShards, steps.length, 1);
      const completedShards = await getCompletedShards(taskIdForShards);
      if (completedShards.size > 0) {
        log135.info(`[UnifiedSync] v614i: \u53D1\u73B0 ${completedShards.size} \u4E2A\u5DF2\u5B8C\u6210\u5206\u7247\uFF0C\u5C06\u5728\u65AD\u70B9\u7EED\u4F20\u4E2D\u8DF3\u8FC7`);
      }
    } catch {
    }
    redisLockRenewTimer = setInterval(async () => {
      try {
        await renewAccountLock(account.accountId);
        log135.debug(`[UnifiedSync] [v614i] Redis\u9501\u7EED\u671F\u6210\u529F - \u8D26\u6237${account.accountId} \u6B65\u9AA4: ${context.currentStep || "initializing"}`);
      } catch {
      }
    }, 60 * 1e3);
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      context.currentStep = step.id;
      const runningEntry = engineStatus.currentlyRunning.find((r) => r.accountId === account.accountId);
      if (runningEntry) {
        runningEntry.step = step.name;
      }
      if (options?.onProgress) {
        try {
          await options.onProgress(step.name, i, steps.length);
        } catch (progressErr) {
          log135.debug(`[UnifiedSync] v406: \u8FDB\u5EA6\u56DE\u8C03\u5931\u8D25: ${progressErr.message}`);
        }
      }
      const syncEntryForStep = activeSyncs.get(lockKey);
      if (syncEntryForStep) {
        syncEntryForStep.lastHeartbeat = /* @__PURE__ */ new Date();
      }
      const isSbStep = step.id.startsWith("sb_");
      const isSdStep = step.id.startsWith("sd_");
      if (isSbStep && context.adTypeCapabilities.sb === false) {
        log135.info(`[UnifiedSync] v473: \u8DF3\u8FC7\u6B65\u9AA4 ${step.name} \u2014 \u8BE5Profile\u4E0D\u652F\u6301SB\u5E7F\u544A`);
        result.stepResults[step.id] = { success: true, synced: 0, errors: [] };
        result.completedSteps++;
        context.completedSteps.push(step.id);
        continue;
      }
      if (isSdStep && context.adTypeCapabilities.sd === false) {
        log135.info(`[UnifiedSync] v473: \u8DF3\u8FC7\u6B65\u9AA4 ${step.name} \u2014 \u8BE5Profile\u4E0D\u652F\u6301SD\u5E7F\u544A`);
        result.stepResults[step.id] = { success: true, synced: 0, errors: [] };
        result.completedSteps++;
        context.completedSteps.push(step.id);
        continue;
      }
      if (v548SkipSteps.has(step.id)) {
        log135.info(`[UnifiedSync] v548: \u8DF3\u8FC7\u5DF2\u5B8C\u6210\u6B65\u9AA4 [${i + 1}/${steps.length}]: ${step.name} (\u65AD\u70B9\u7EED\u4F20)`);
        result.stepResults[step.id] = { success: true, synced: 0, errors: [] };
        continue;
      }
      log135.info(`[UnifiedSync] \u8D26\u6237 ${account.accountId} \u6267\u884C\u6B65\u9AA4 [${i + 1}/${steps.length}]: ${step.name}`);
      const REPORT_INTENSIVE_STEPS = /* @__PURE__ */ new Set(["performance_today", "performance_7d", "performance_30d", "performance_60d", "performance_95d"]);
      const isReportIntensiveStep = REPORT_INTENSIVE_STEPS.has(step.id);
      let semaphoreAcquired = false;
      if (isReportIntensiveStep) {
        const semStatus = getReportSemaphoreStatus();
        log135.info(`[UnifiedSync] v614i-fix10: \u8D26\u6237 ${account.accountId} \u6B65\u9AA4 ${step.name} \u662F\u62A5\u544A\u5BC6\u96C6\u6B65\u9AA4\uFF0C\u5F53\u524D\u4FE1\u53F7\u91CF [${semStatus.activeCount}/${semStatus.maxConcurrent}]\uFF0C\u961F\u5217: ${semStatus.queueLength}`);
        const semaphoreHeartbeat = /* @__PURE__ */ __name(async () => {
          try {
            if (options?.onProgress) {
              await options.onProgress(`\u7B49\u5F85\u62A5\u544A\u4FE1\u53F7\u91CF: ${step.name}`, i, steps.length);
            }
            const syncEntry = activeSyncs.get(lockKey);
            if (syncEntry) {
              syncEntry.lastHeartbeat = /* @__PURE__ */ new Date();
            }
            renewAccountLock(account.accountId).catch(() => {
            });
            log135.debug(`[UnifiedSync] v614i-fix11: \u4FE1\u53F7\u91CF\u7B49\u5F85\u5FC3\u8DF3 - \u8D26\u6237${account.accountId} \u6B65\u9AA4: ${step.name}`);
          } catch (err) {
            const syncEntry = activeSyncs.get(lockKey);
            if (syncEntry) {
              syncEntry.lastHeartbeat = /* @__PURE__ */ new Date();
            }
          }
        }, "semaphoreHeartbeat");
        semaphoreAcquired = await acquireReportSemaphore(
          account.accountId,
          context.totalCampaigns || 0,
          step.name,
          semaphoreHeartbeat
        );
      }
      const CORE_RETRY_STEPS = /* @__PURE__ */ new Set(["performance_today", "performance_7d", "sp_campaigns", "sb_campaigns", "sd_campaigns"]);
      const MAX_STEP_RETRIES = 2;
      const STEP_RETRY_BASE_DELAY_MS = 5e3;
      try {
        const { isShuttingDown: isShuttingDown3 } = await Promise.resolve().then(() => (init_deployLifecycleManager(), deployLifecycleManager_exports));
        if (isShuttingDown3()) {
          const shutdownMsg = `\u8D26\u6237${account.accountId} \u540C\u6B65\u88AB\u7CFB\u7EDF\u5173\u95ED\u4E2D\u65AD\uFF0C\u5DF2\u5B8C\u6210${i}/${steps.length}\u6B65\u9AA4`;
          log135.warn(`[UnifiedSync] v405: ${shutdownMsg}`);
          result.errors.push(shutdownMsg);
          result.stepResults["_interrupted"] = { success: false, synced: 0, errors: [shutdownMsg] };
          try {
            const checkpoint = {
              accountId: account.accountId,
              tier: tier2,
              savedAt: (/* @__PURE__ */ new Date()).toISOString(),
              interruptReason: "shutdown",
              completedSteps: [...context.completedSteps],
              stepCheckpoints: Object.fromEntries(
                context.completedSteps.map((sid) => [sid, {
                  stepId: sid,
                  stepName: sid,
                  status: "completed",
                  recordsSynced: context.checkpoint[sid]?.synced || 0,
                  completedAt: context.checkpoint[sid]?.completedAt || null,
                  durationMs: 0,
                  errorMessage: null
                }])
              ),
              recordCheckpoints: {},
              totalSynced: context.totalSynced,
              elapsedMs: Date.now() - startTime.getTime()
            };
            await saveSyncCheckpoint(account.accountId, tier2, checkpoint);
            log135.info(`[UnifiedSync] v548: SIGTERM\u68C0\u67E5\u70B9\u5DF2\u4FDD\u5B58 - \u8D26\u6237${account.accountId}, ${context.completedSteps.length}\u6B65\u5DF2\u5B8C\u6210`);
          } catch (cpErr) {
            log135.warn(`[UnifiedSync] v548: SIGTERM\u68C0\u67E5\u70B9\u4FDD\u5B58\u5931\u8D25: ${cpErr.message}`);
          }
          break;
        }
      } catch (e) {
      }
      const elapsed = Date.now() - startTime.getTime();
      if (elapsed > SYNC_TIMEOUT_MS) {
        const timeoutMsg = `\u8D26\u6237${account.accountId} \u540C\u6B65\u8D85\u65F6(${Math.round(elapsed / 6e4)}\u5206\u949F>\u9608\u503C${SYNC_TIMEOUT_MS / 6e4}\u5206\u949F)\uFF0C\u5DF2\u5B8C\u6210${i}/${steps.length}\u6B65\u9AA4\uFF0C\u5269\u4F59\u6B65\u9AA4\u8DF3\u8FC7`;
        log135.warn(`[UnifiedSync] v340: ${timeoutMsg}`);
        result.errors.push(timeoutMsg);
        try {
          const checkpoint = {
            accountId: account.accountId,
            tier: tier2,
            savedAt: (/* @__PURE__ */ new Date()).toISOString(),
            interruptReason: "timeout",
            completedSteps: [...context.completedSteps],
            stepCheckpoints: Object.fromEntries(
              context.completedSteps.map((sid) => [sid, {
                stepId: sid,
                stepName: sid,
                status: "completed",
                recordsSynced: context.checkpoint[sid]?.synced || 0,
                completedAt: context.checkpoint[sid]?.completedAt || null,
                durationMs: 0,
                errorMessage: null
              }])
            ),
            recordCheckpoints: {},
            totalSynced: context.totalSynced,
            elapsedMs: elapsed
          };
          await saveSyncCheckpoint(account.accountId, tier2, checkpoint);
          log135.info(`[UnifiedSync] v548: \u8D85\u65F6\u68C0\u67E5\u70B9\u5DF2\u4FDD\u5B58 - \u8D26\u6237${account.accountId}, ${context.completedSteps.length}\u6B65\u5DF2\u5B8C\u6210`);
        } catch (cpErr) {
          log135.warn(`[UnifiedSync] v548: \u8D85\u65F6\u68C0\u67E5\u70B9\u4FDD\u5B58\u5931\u8D25: ${cpErr.message}`);
        }
        break;
      }
      if (i > 0) {
        const baseDelay = rateController.getStepDelay();
        const extraDelay = isLargeAccount ? LARGE_ACCOUNT_STEP_DELAY_MS : 0;
        const totalDelay = baseDelay + extraDelay;
        if (totalDelay > 0) {
          if (isLargeAccount) {
            log135.debug(`[UnifiedSync] v340: \u5927\u8D26\u6237\u6B65\u9AA4\u95F4\u5EF6\u8FDF ${totalDelay}ms (\u57FA\u7840${baseDelay}ms + \u5927\u8D26\u6237\u4FDD\u62A4${extraDelay}ms)`);
          }
          await sleep3(totalDelay);
        }
      }
      try {
        rateController.recordApiCall();
        let heartbeatTimer4 = null;
        heartbeatTimer4 = setInterval(async () => {
          try {
            if (options?.onProgress) {
              await options.onProgress(step.name, i, steps.length);
            }
            const syncEntry = activeSyncs.get(lockKey);
            if (syncEntry) {
              syncEntry.lastHeartbeat = /* @__PURE__ */ new Date();
            }
            renewAccountLock(account.accountId).catch(() => {
            });
            log135.debug(`[UnifiedSync] v614i-P0: \u5FC3\u8DF3\u66F4\u65B0(\u5185\u5B58+Redis${options?.onProgress ? "+DB" : ""}) - \u8D26\u6237${account.accountId} \u6B65\u9AA4[${i + 1}/${steps.length}]: ${step.name}`);
          } catch (hbErr) {
            const syncEntry = activeSyncs.get(lockKey);
            if (syncEntry) {
              syncEntry.lastHeartbeat = /* @__PURE__ */ new Date();
            }
          }
        }, 60 * 1e3);
        let stepResult;
        let retryAttempt = 0;
        const isCoreStep = CORE_RETRY_STEPS.has(step.id);
        while (true) {
          stepResult = await step.execute(syncService, context);
          if (stepResult.success || !isCoreStep || retryAttempt >= MAX_STEP_RETRIES) {
            break;
          }
          retryAttempt++;
          const retryDelay = STEP_RETRY_BASE_DELAY_MS * Math.pow(2, retryAttempt - 1);
          const errPreview = stepResult.errors?.join(", ")?.substring(0, 100) || "unknown";
          log135.warn(`[UnifiedSync] v614i-fix8: \u6838\u5FC3\u6B65\u9AA4 ${step.name} \u5931\u8D25(\u7B2C${retryAttempt}\u6B21\u91CD\u8BD5), \u7B49\u5F85${retryDelay}ms\u540E\u91CD\u8BD5 | \u9519\u8BEF: ${errPreview}`);
          await sleep3(retryDelay);
          const syncEntryRetry = activeSyncs.get(lockKey);
          if (syncEntryRetry) syncEntryRetry.lastHeartbeat = /* @__PURE__ */ new Date();
        }
        if (retryAttempt > 0) {
          log135.info(`[UnifiedSync] v614i-fix8: \u6838\u5FC3\u6B65\u9AA4 ${step.name} \u91CD\u8BD5${retryAttempt}\u6B21\u540E${stepResult.success ? "\u6210\u529F" : "\u4ECD\u7136\u5931\u8D25"}`);
        }
        if (heartbeatTimer4) {
          clearInterval(heartbeatTimer4);
          heartbeatTimer4 = null;
        }
        result.stepResults[step.id] = stepResult;
        const safeSynced = typeof stepResult.synced === "number" ? stepResult.synced : typeof stepResult.synced === "object" && stepResult.synced !== null ? (
          // @ts-expect-error - dynamic property access
          Object.values(stepResult.synced).reduce((s, v) => s + (typeof v === "number" ? v : 0), 0)
        ) : 0;
        stepResult.synced = safeSynced;
        if (stepResult.success) {
          result.completedSteps++;
          context.completedSteps.push(step.id);
          result.totalSynced += safeSynced;
          context.totalSynced += safeSynced;
        } else {
          const errMsg = stepResult.errors.join(", ").toLowerCase();
          const is403 = errMsg.includes("403") || errMsg.includes("permission") || errMsg.includes("forbidden");
          const is401 = errMsg.includes("401") || errMsg.includes("unauthorized") || errMsg.includes("not authorized");
          // v578: 区分401(token问题)和403(真正的权限问题)
          if (step.id === "sb_campaigns" && is401 && !is403) {
            // v578: 401是token问题，不标记为无权限，仅记录警告并继续
            log135.warn(`[UnifiedSync] v578: 账户${account.accountId}的SB同步遇到401(token问题)，不标记为无权限，将在下次同步时重试`);
            result.completedSteps++;
            context.completedSteps.push(step.id);
          } else if (step.id === "sb_campaigns" && is403) {
            context.adTypeCapabilities.sb = false;
            log135.warn(`[UnifiedSync] v473: \u68C0\u6D4B\u5230\u8D26\u6237${account.accountId}\u7684Profile\u4E0D\u652F\u6301SB\u5E7F\u544A(403)\uFF0C\u540E\u7EED\u6240\u6709SB\u6B65\u9AA4\u5C06\u81EA\u52A8\u8DF3\u8FC7`);
            try {
              const _sbConn = await getDirectConnection(5e3);
              try {
                await _sbConn.execute(
                  "UPDATE ad_accounts SET sbCapability = 0, sbCapabilityCheckedAt = NOW() WHERE id = ?",
                  [account.accountId]
                );
              } finally {
                _sbConn.release();
              }
              log135.info(`[UnifiedSync] v614i-fix23: \u5DF2\u6301\u4E45\u5316\u8D26\u6237${account.accountId}\u7684SB\u65E0\u6743\u9650\u72B6\u6001`);
            } catch (pe) {
              log135.debug(`[UnifiedSync] v614i-fix23: \u6301\u4E45\u5316SB\u6743\u9650\u5931\u8D25: ${pe.message}`);
            }
            result.completedSteps++;
            context.completedSteps.push(step.id);
          } else if (step.id === "sd_campaigns" && is401 && !is403) {
            // v578: SD 401也是token问题，不标记为无权限
            log135.warn(`[UnifiedSync] v578: 账户${account.accountId}的SD同步遇到401(token问题)，不标记为无权限，将在下次同步时重试`);
            result.completedSteps++;
            context.completedSteps.push(step.id);
          } else if (step.id === "sd_campaigns" && is403) {
            context.adTypeCapabilities.sd = false;
            try {
              const _sdConn = await getDirectConnection(5e3);
              try {
                await _sdConn.execute(
                  "UPDATE ad_accounts SET sdCapability = 0, sdCapabilityCheckedAt = NOW() WHERE id = ?",
                  [account.accountId]
                );
              } finally {
                _sdConn.release();
              }
              log135.info(`[UnifiedSync] v614i-fix23: \u5DF2\u6301\u4E45\u5316\u8D26\u6237${account.accountId}\u7684SD\u65E0\u6743\u9650\u72B6\u6001`);
            } catch (pe) {
              log135.debug(`[UnifiedSync] v614i-fix23: \u6301\u4E45\u5316SD\u6743\u9650\u5931\u8D25: ${pe.message}`);
            }
            log135.warn(`[UnifiedSync] v473: \u68C0\u6D4B\u5230\u8D26\u6237${account.accountId}\u7684Profile\u4E0D\u652F\u6301SD\u5E7F\u544A(403)\uFF0C\u540E\u7EED\u6240\u6709SD\u6B65\u9AA4\u5C06\u81EA\u52A8\u8DF3\u8FC7`);
            result.completedSteps++;
            context.completedSteps.push(step.id);
          } else {
            // v596: 报告API部分成功机制 - 报告类步骤失败不阻塞后续步骤
            const isReportStep = step.id.startsWith("perf_") || step.id.startsWith("performance_") || 
                                 step.id.startsWith("search_term_") || step.id.startsWith("placement_") ||
                                 step.id.startsWith("keyword_perf") || step.id.startsWith("target_perf") ||
                                 step.id.startsWith("ad_group_perf");
            const errMsgLower = stepResult.errors.join(", ").toLowerCase();
            const isTimeoutError = errMsgLower.includes("timeout") || errMsgLower.includes("pending") || errMsgLower.includes("report generation");
            const isRateLimitError = errMsgLower.includes("429") || errMsgLower.includes("rate limit") || errMsgLower.includes("throttl");
            
            if (isReportStep && (isTimeoutError || isRateLimitError)) {
              // v596: 报告超时/限流 → 标记为部分成功，继续执行后续步骤
              log135.warn(`[UnifiedSync] v596: 报告步骤 ${step.name} 超时/限流，标记为部分成功并继续 | 错误: ${stepResult.errors.join(", ").substring(0, 200)}`);
              result.stepResults[step.id].partialSuccess = true;
              result.completedSteps++;
              context.completedSteps.push(step.id);
              // v596: 将失败的报告步骤加入异步重试队列
              try {
                const { getRedis: _rds9, isRedisAvailable: _rdsOk9 } = await Promise.resolve().then(() => (init_redisClient(), redisClient_exports));
                if (_rdsOk9() && _rds9()) {
                  const retryPayload = JSON.stringify({
                    accountId: account.accountId,
                    stepId: step.id,
                    stepName: step.name,
                    tier: tier2,
                    error: stepResult.errors.join(", ").substring(0, 500),
                    scheduledAt: new Date().toISOString(),
                    retryCount: 0
                  });
                  await _rds9().lpush("sync:report_retry_queue", retryPayload);
                  await _rds9().expire("sync:report_retry_queue", 86400);
                  log135.info(`[UnifiedSync] v596: 报告步骤 ${step.name} 已加入Redis异步重试队列`);
                }
              } catch(_retryErr) {
                log135.debug(`[UnifiedSync] v596: 加入重试队列失败: ${_retryErr.message}`);
              }
            } else if (isReportStep && stepResult.synced > 0) {
              // v596: 报告步骤部分成功（有部分数据同步成功）
              log135.warn(`[UnifiedSync] v596: 报告步骤 ${step.name} 部分成功: ${stepResult.synced}条已同步, 错误: ${stepResult.errors.join(", ").substring(0, 200)}`);
              result.stepResults[step.id].partialSuccess = true;
              result.completedSteps++;
              context.completedSteps.push(step.id);
              result.totalSynced += stepResult.synced;
              context.totalSynced += stepResult.synced;
            } else {
              result.failedSteps++;
              context.failedSteps.push(step.id);
              context.totalErrors++;
              result.errors.push(`${step.name}: ${stepResult.errors.join(", ")}`);
            }
          }
        }
        if (stepResult.success) {
          if (step.id === "sb_campaigns") {
            context.adTypeCapabilities.sb = true;
            try {
              const _sbOkConn = await getDirectConnection(5e3);
              try {
                await _sbOkConn.execute(
                  "UPDATE ad_accounts SET sbCapability = 1, sbCapabilityCheckedAt = NOW() WHERE id = ?",
                  [account.accountId]
                );
              } finally {
                _sbOkConn.release();
              }
            } catch (pe) {
            }
          }
          if (step.id === "sd_campaigns") {
            context.adTypeCapabilities.sd = true;
            try {
              const _sdOkConn = await getDirectConnection(5e3);
              try {
                await _sdOkConn.execute(
                  "UPDATE ad_accounts SET sdCapability = 1, sdCapabilityCheckedAt = NOW() WHERE id = ?",
                  [account.accountId]
                );
              } finally {
                _sdOkConn.release();
              }
            } catch (pe) {
            }
          }
        }
        context.checkpoint[step.id] = {
          completedAt: (/* @__PURE__ */ new Date()).toISOString(),
          success: stepResult.success,
          synced: stepResult.synced
        };
        try {
          const shardId = `${account.accountId}_${tier2}_${step.id}`;
          await updateShardStatus(
            `task_${account.accountId}_${tier2}`,
            shardId,
            stepResult.success ? "completed" : "failed",
            typeof safeSynced === "number" ? safeSynced : 0
          );
        } catch {
        }
        if (isReportIntensiveStep && semaphoreAcquired) {
          const nextStep = i + 1 < steps.length ? steps[i + 1] : null;
          const nextIsReportIntensive = nextStep ? REPORT_INTENSIVE_STEPS.has(nextStep.id) : false;
          if (!nextIsReportIntensive) {
            releaseReportSemaphore(account.accountId);
            log135.info(`[UnifiedSync] v614i-fix10: \u8D26\u6237 ${account.accountId} \u62A5\u544A\u6B65\u9AA4\u5B8C\u6210\uFF0C\u91CA\u653E\u4FE1\u53F7\u91CF`);
          } else {
            log135.debug(`[UnifiedSync] v614i-fix10: \u8D26\u6237 ${account.accountId} \u4E0B\u4E00\u6B65\u9AA4 ${nextStep?.name} \u4ECD\u662F\u62A5\u544A\u6B65\u9AA4\uFF0C\u4FDD\u6301\u4FE1\u53F7\u91CF`);
          }
        }
      } catch (error48) {
        if (isReportIntensiveStep && semaphoreAcquired) {
          releaseReportSemaphore(account.accountId);
        }
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
        result.failedSteps++;
        context.failedSteps.push(step.id);
        context.totalErrors++;
        result.errors.push(`${step.name}: ${error48.message}`);
        result.stepResults[step.id] = { success: false, synced: 0, errors: [error48.message] };
        const isThrottle = error48.message?.includes("429") || error48.message?.includes("\u9650\u6D41") || error48.message?.includes("TooManyRequests") || error48.message?.includes("throttl");
        if (isThrottle) {
          rateController.recordThrottle();
          const throttleDelay2 = rateController.getStepDelay();
          log135.warn(`[UnifiedSync] \u8D26\u6237 ${account.accountId} \u6B65\u9AA4 ${step.name} \u89E6\u53D1\u9650\u6D41\uFF0C\u7B49\u5F85${throttleDelay2}ms\u540E\u7EE7\u7EED`);
          await sleep3(throttleDelay2);
        }
        log135.warn(`[UnifiedSync] \u8D26\u6237 ${account.accountId} \u6B65\u9AA4 ${step.name} \u5F02\u5E38: ${error48.message}`);
      }
    }
    releaseReportSemaphore(account.accountId);
    try {
      await updateAmazonApiCredentials(account.accountId, {
        lastSyncAt: (/* @__PURE__ */ new Date()).toISOString(),
        syncStatus: result.failedSteps === 0 ? "idle" : "error",
        syncErrorMessage: result.errors.length > 0 ? result.errors.slice(0, 3).join("; ") : null
      });
    } catch (e) {
      log135.warn(`[UnifiedSync] \u66F4\u65B0\u8D26\u6237 ${account.accountId} \u540C\u6B65\u72B6\u6001\u5931\u8D25: ${e.message}`);
    }
    result.success = result.failedSteps === 0;
    if (result.success) {
      try {
        await clearSyncCheckpoint(account.accountId, tier2);
      } catch (cpErr) {
        log135.debug(`[UnifiedSync] v548: \u6E05\u9664\u68C0\u67E5\u70B9\u5931\u8D25: ${cpErr.message}`);
      }
    }
    if (result.totalSynced === 0 && result.totalSteps > 0) {
      const alertMsg = `\u26A0\uFE0F \u8D26\u6237${account.accountId}(${account.accountName}) ${tier2}\u5C42\u540C\u6B65\u5B8C\u6210\u4F46\u603B\u8BB0\u5F55\u6570\u4E3A0\uFF01\u6B65\u9AA4=${result.totalSteps}, \u5931\u8D25=${result.failedSteps}, \u9519\u8BEF=${result.errors.slice(0, 3).join("; ")}`;
      if (tier2 === "confirmation") {
        log135.warn(`[UnifiedSync] v474: ${tier2}\u5C42\u540C\u6B650\u6761\u8BB0\u5F55(\u6B63\u5E38): ${alertMsg}`);
      } else {
        log135.warn(`[UnifiedSync] \u{1F6A8} \u540C\u6B65\u5065\u5EB7\u544A\u8B66: ${alertMsg}`);
      }
      logSyncWarn("UnifiedSync", alertMsg, {
        accountId: account.accountId,
        accountName: account.accountName,
        marketplace: account.marketplace,
        tier: tier2,
        totalSteps: result.totalSteps,
        completedSteps: result.completedSteps,
        failedSteps: result.failedSteps,
        errors: result.errors
      });
      try {
        const database = await getDb();
        if (database) {
          const alertType = "SYNC_ZERO_RECORDS";
          const alertSeverity = "critical";
          const alertMessage = JSON.stringify({
            alertMessage: alertMsg,
            tier: tier2,
            totalSteps: result.totalSteps,
            failedSteps: result.failedSteps,
            errors: result.errors.slice(0, 5),
            stepResults: Object.entries(result.stepResults).map(([id, r]) => ({ id, success: r.success, synced: r.synced }))
          });
          await database.execute(sql`
            INSERT INTO anomaly_alert_logs (accountId, anomalyType, detectedValue, actionTaken, createdAt)
            VALUES (${account.accountId}, ${alertType}, ${alertSeverity}, ${alertMessage}, NOW())
          `);
        }
      } catch (alertDbErr) {
        log135.warn(`[UnifiedSync] \u540C\u6B65\u5065\u5EB7\u544A\u8B66\u5199\u5165DB\u5931\u8D25: ${alertDbErr.message}`);
      }
    }
  } catch (error48) {
    result.errors.push(`\u540C\u6B65\u521D\u59CB\u5316\u5931\u8D25: ${error48.message}`);
    log135.warn(`[UnifiedSync] \u8D26\u6237 ${account.accountId} \u540C\u6B65\u521D\u59CB\u5316\u5931\u8D25: ${error48.message}`);
  } finally {
    if (redisLockRenewTimer) {
      clearInterval(redisLockRenewTimer);
      redisLockRenewTimer = null;
    }
    activeSyncs.delete(lockKey);
    engineStatus.currentlyRunning = engineStatus.currentlyRunning.filter(
      (r) => !(r.accountId === account.accountId && r.tier === tier2)
    );
    result.endTime = /* @__PURE__ */ new Date();
    result.durationMs = result.endTime.getTime() - result.startTime.getTime();
    const durationSec = (result.durationMs / 1e3).toFixed(1);
    const stepSummary = Object.entries(result.stepResults).map(([step, r]) => `${step}:${r.synced ?? r.result ?? "?"}`).join(", ");
    const errorSummary = result.errors.length > 0 ? ` | \u9519\u8BEF: ${result.errors.slice(0, 3).join("; ")}` : "";
    log135.info(
      `[v426-SyncSummary] \u8D26\u6237=${account.accountId}(${account.accountName}) \u5C42\u7EA7=${tier2} \u72B6\u6001=${result.success ? "\u2705\u6210\u529F" : "\u274C\u5931\u8D25"} \u8017\u65F6=${durationSec}s \u6B65\u9AA4=${result.completedSteps}/${result.totalSteps} \u540C\u6B65\u6570=${result.totalSynced} \u5931\u8D25\u6B65\u9AA4=${result.failedSteps}${errorSummary} | \u660E\u7EC6: ${stepSummary}`
    );
    if (result.success) {
      engineStatus.totalSyncsCompleted++;
    } else {
      engineStatus.totalSyncsFailed++;
    }
  }
  return result;
}
function interleaveAccountsByUser(accounts) {
  if (accounts.length <= 1) return accounts;
  const groups = /* @__PURE__ */ new Map();
  for (const account of accounts) {
    const userId = account.userId;
    if (!groups.has(userId)) groups.set(userId, []);
    groups.get(userId).push(account);
  }
  const result = [];
  const groupArrays = Array.from(groups.values());
  const maxLen = Math.max(...groupArrays.map((g) => g.length));
  for (let i = 0; i < maxLen; i++) {
    for (const group of groupArrays) {
      if (i < group.length) {
        result.push(group[i]);
      }
    }
  }
  return result;
}
async function syncAllAccounts(tier2) {
  await v534Init();
  const startTime = /* @__PURE__ */ new Date();
  const batchResult = {
    tier: tier2,
    startTime,
    endTime: startTime,
    durationMs: 0,
    totalAccounts: 0,
    successfulAccounts: 0,
    failedAccounts: 0,
    skippedAccounts: 0,
    accountResults: []
  };
  log135.info(`[UnifiedSync] \u5F00\u59CB${tier2}\u5C42\u6279\u91CF\u540C\u6B65...`);
  logSync("UnifiedSync", `\u5F00\u59CB${tier2}\u5C42\u6279\u91CF\u540C\u6B65`, { tier: tier2 });
  const allAccounts = await discoverSyncableAccounts();
  batchResult.totalAccounts = allAccounts.length;
  if (allAccounts.length === 0) {
    log135.info("[UnifiedSync] \u6CA1\u6709\u53D1\u73B0\u53EF\u540C\u6B65\u7684\u8D26\u6237");
    batchResult.endTime = /* @__PURE__ */ new Date();
    batchResult.durationMs = batchResult.endTime.getTime() - startTime.getTime();
    return batchResult;
  }
  let accounts = allAccounts;
  try {
    const { calculateAccountPriorities: calculateAccountPriorities2, getMaxAccountsForTier: getMaxAccountsForTier2 } = await Promise.resolve().then(() => (init_syncPriorityScheduler2(), syncPriorityScheduler_exports2));
    const prioritized = await calculateAccountPriorities2(
      // @ts-ignore
      allAccounts.map((a) => ({ ...a, priorityScore: 0, priorityReasons: [] }))
    );
    const maxAccounts = getMaxAccountsForTier2(tier2);
    if (prioritized.length > maxAccounts) {
      const topAccounts = prioritized.slice(0, maxAccounts);
      const topAccountIds = new Set(topAccounts.map((a) => a.accountId));
      const neverSyncedMissing = prioritized.slice(maxAccounts).filter(
        (a) => !a.lastSyncAt && !topAccountIds.has(a.accountId)
      );
      if (neverSyncedMissing.length > 0) {
        log135.warn(`[UnifiedSync] [v523] \u65B0\u8D26\u53F7\u4FDD\u969C: ${neverSyncedMissing.length}\u4E2A\u4ECE\u672A\u540C\u6B65\u7684\u8D26\u53F7\u88AB\u5F3A\u5236\u52A0\u5165\u672C\u5468\u671F: ${neverSyncedMissing.map((a) => a.accountId).join(", ")}`);
        accounts = [...topAccounts, ...neverSyncedMissing];
      } else {
        accounts = topAccounts;
      }
      log135.info(`[UnifiedSync] [v373] \u4F18\u5148\u7EA7\u8C03\u5EA6: ${allAccounts.length}\u4E2A\u8D26\u53F7\u4E2D\u9009\u53D6${accounts.length}\u4E2A\u8FDB\u884C${tier2}\u5C42\u540C\u6B65`);
      log135.info(`[UnifiedSync] [v373] \u8DF3\u8FC7\u7684${prioritized.length - accounts.length}\u4E2A\u4F4E\u4F18\u5148\u7EA7\u8D26\u53F7\u5C06\u5728\u4E0B\u4E00\u5468\u671F\u540C\u6B65`);
    } else {
      accounts = prioritized;
      log135.info(`[UnifiedSync] [v373] \u4F18\u5148\u7EA7\u8C03\u5EA6: \u5168\u90E8${accounts.length}\u4E2A\u8D26\u53F7\u53C2\u4E0E${tier2}\u5C42\u540C\u6B65`);
    }
  } catch (priErr) {
    log135.warn(`[UnifiedSync] [v373] \u4F18\u5148\u7EA7\u8C03\u5EA6\u5931\u8D25\uFF0C\u4F7F\u7528\u9ED8\u8BA4\u987A\u5E8F: ${priErr.message}`);
  }
  const interleaved = interleaveAccountsByUser(accounts);
  log135.info(`[UnifiedSync] [v373] \u53D1\u73B0 ${allAccounts.length} \u4E2A\u8D26\u6237\uFF0C\u672C\u5468\u671F\u540C\u6B65 ${accounts.length} \u4E2A\uFF08\u6700\u5927\u5E76\u53D1: ${MAX_CONCURRENT_ACCOUNTS}\uFF09`);
  let PARALLEL_USERS;
  let ACCOUNT_DELAY_MS;
  try {
    const { getCurrentConcurrency: getCurrentConcurrency2, getCurrentBatchDelay: getCurrentBatchDelay2 } = await Promise.resolve().then(() => (init_syncPriorityScheduler2(), syncPriorityScheduler_exports2));
    PARALLEL_USERS = Math.min(getCurrentConcurrency2(), 10);
    ACCOUNT_DELAY_MS = Math.max(getCurrentBatchDelay2(), 1e3);
    log135.info(`[UnifiedSync] [v373] \u52A8\u6001\u5E76\u53D1: ${PARALLEL_USERS}\u7528\u6237\u5E76\u884C, \u6279\u6B21\u5EF6\u8FDF${ACCOUNT_DELAY_MS}ms`);
  } catch {
    PARALLEL_USERS = Math.min(MAX_CONCURRENT_ACCOUNTS, 5);
    ACCOUNT_DELAY_MS = 1e4;
  }
  const userGroups = /* @__PURE__ */ new Map();
  for (const account of interleaved) {
    const group = userGroups.get(account.userId) || [];
    group.push(account);
    userGroups.set(account.userId, group);
  }
  log135.info(`[UnifiedSync] [v371] \u53D1\u73B0 ${accounts.length} \u4E2A\u8D26\u6237\uFF0C\u5C5E\u4E8E ${userGroups.size} \u4E2A\u7528\u6237\uFF0C\u6700\u5927\u5E76\u884C\u7528\u6237\u6570: ${PARALLEL_USERS}`);
  const userGroupArray = Array.from(userGroups.entries());
  for (let batchStart = 0; batchStart < userGroupArray.length; batchStart += PARALLEL_USERS) {
    const userBatch = userGroupArray.slice(batchStart, batchStart + PARALLEL_USERS);
    log135.info(`[UnifiedSync] [v371] \u5F00\u59CB\u7528\u6237\u6279\u6B21 [${Math.floor(batchStart / PARALLEL_USERS) + 1}/${Math.ceil(userGroupArray.length / PARALLEL_USERS)}]: ${userBatch.map(([uid]) => `user${uid}`).join(", ")}`);
    const userPromises = userBatch.map(async ([userId, userAccounts]) => {
      for (let i = 0; i < userAccounts.length; i++) {
        const account = userAccounts[i];
        log135.info(`[UnifiedSync] [v371] \u540C\u6B65\u7528\u6237${userId}\u8D26\u6237 [${i + 1}/${userAccounts.length}]: ${account.accountId}(${account.accountName}) ${account.marketplace}`);
        if (tier2 === "high" || tier2 === "full" || tier2 === "nightly") {
          try {
            const database = await getDb();
            if (database) {
              const { campaigns: campaignsTable } = await Promise.resolve().then(() => (init_schema2(), schema_exports));
              const countResult = await database.select({ count: sql`COUNT(*)` }).from(campaignsTable).where(eq(campaignsTable.accountId, account.accountId));
              const totalCampaigns = countResult[0]?.count || 0;
              if (totalCampaigns === 0) {
                log135.info(`[UnifiedSync] [v614i-fix5] \u8D26\u6237 ${account.accountId}(${account.accountName}) \u65E0\u5E7F\u544A\u6D3B\u52A8\uFF08campaigns=0\uFF09\uFF0C\u8DF3\u8FC7${tier2}\u5C42\u540C\u6B65`);
                batchResult.skippedAccounts++;
                batchResult.accountResults.push({
                  accountId: account.accountId,
                  userId: account.userId,
                  accountName: account.accountName,
                  tier: tier2,
                  success: true,
                  startTime: /* @__PURE__ */ new Date(),
                  endTime: /* @__PURE__ */ new Date(),
                  durationMs: 0,
                  completedSteps: 0,
                  failedSteps: 0,
                  totalSteps: 0,
                  totalSynced: 0,
                  errors: [],
                  stepResults: {}
                });
                continue;
              }
            }
          } catch (preCheckErr) {
            log135.debug(`[UnifiedSync] [v614i-fix5] \u7A7A\u8D26\u6237\u9884\u68C0\u5931\u8D25: ${preCheckErr.message}`);
          }
        }
        if (tier2 === "full") {
          try {
            const database = await getDb();
            if (database) {
              const { campaigns: campaignsTable } = await Promise.resolve().then(() => (init_schema2(), schema_exports));
              const countResult = await database.select({ count: sql`COUNT(*)` }).from(campaignsTable).where(eq(campaignsTable.accountId, account.accountId));
              const totalCampaigns = countResult[0]?.count || 0;
              if (totalCampaigns >= 1e3) {
                const lastFullSync = await database.execute(
                  sql`SELECT MAX(completed_at) as lastSync FROM data_sync_jobs 
                      WHERE accountId = ${account.accountId} 
                      AND syncType = 'full' 
                      AND status = 'completed' 
                      AND completed_at IS NOT NULL`
                );
                const lastSyncRow = Array.isArray(lastFullSync) ? lastFullSync[0] : lastFullSync;
                const lastSyncTime = lastSyncRow?.[0]?.lastSync || lastSyncRow?.lastSync;
                if (lastSyncTime) {
                  const hoursSinceLastSync = (Date.now() - new Date(lastSyncTime).getTime()) / (1e3 * 60 * 60);
                  const minIntervalHours = totalCampaigns >= 3e3 ? 12 : 6;
                  if (hoursSinceLastSync < minIntervalHours) {
                    log135.info(`[UnifiedSync] [fix24-P1-7] \u5927\u8D26\u6237\u964D\u9891: \u8D26\u6237${account.accountId}(${account.accountName}) ${totalCampaigns}\u4E2ACampaigns, \u4E0A\u6B21full\u540C\u6B65${hoursSinceLastSync.toFixed(1)}\u5C0F\u65F6\u524D, \u6700\u5C0F\u95F4\u9694${minIntervalHours}\u5C0F\u65F6, \u8DF3\u8FC7`);
                    batchResult.skippedAccounts++;
                    batchResult.accountResults.push({
                      accountId: account.accountId,
                      userId: account.userId,
                      accountName: account.accountName,
                      tier: tier2,
                      success: true,
                      startTime: /* @__PURE__ */ new Date(),
                      endTime: /* @__PURE__ */ new Date(),
                      durationMs: 0,
                      completedSteps: 0,
                      failedSteps: 0,
                      totalSteps: 0,
                      totalSynced: 0,
                      errors: [],
                      stepResults: {}
                    });
                    continue;
                  }
                }
              }
            }
          } catch (freqCheckErr) {
            log135.debug(`[UnifiedSync] [fix24-P1-7] \u5927\u8D26\u6237\u964D\u9891\u68C0\u67E5\u5931\u8D25: ${freqCheckErr.message}`);
          }
        }
        // [fix24-P2-8] Empty account fast skip - check campaigns before acquiring lock
        if (tier2 !== 'full') {
          try {
            const preCheckResult = await database.select({ count: sql`COUNT(*)` }).from(campaignsTable).where(eq(campaignsTable.accountId, account.accountId));
            const totalCampaignsPreCheck = preCheckResult[0]?.count || 0;
            if (totalCampaignsPreCheck === 0) {
              log135.info(`[UnifiedSync] [fix24-P2-8] \u7a7a\u8d26\u6237\u5feb\u901f\u8df3\u8fc7: \u8d26\u6237${account.accountId}(${account.accountName}) 0\u4e2acampaigns, \u8df3\u8fc7${tier2}\u5c42\u540c\u6b65(\u65e0\u9700\u83b7\u53d6\u9501)`);
              batchResult.skippedAccounts++;
              batchResult.accountResults.push({
                accountId: account.accountId,
                userId: account.userId,
                accountName: account.accountName,
                tier: tier2,
                success: true,
                startTime: new Date(),
                endTime: new Date(),
                durationMs: 0,
                completedSteps: 0,
                failedSteps: 0,
                totalSteps: 0,
                totalSynced: 0,
                errors: [],
                stepResults: {}
              });
              continue;
            }
          } catch (preCheckErr) {
            log135.debug(`[UnifiedSync] [fix24-P2-8] \u7a7a\u8d26\u6237\u9884\u68c0\u5931\u8d25: ${preCheckErr.message}, \u7ee7\u7eed\u6b63\u5e38\u6d41\u7a0b`);
          }
        }
        const lockResult = await acquireAccountLock(account.accountId);
        if (!lockResult.acquired) {
          const isSelf = lockResult.holder === getWorkerId();
          log135.info(`[UnifiedSync] [v614i] \u8D26\u6237 ${account.accountId} \u5DF2\u88AB${isSelf ? "\u672C Worker \u5176\u4ED6\u540C\u6B65\u6D41\u7A0B" : "\u5176\u4ED6 Worker"} \u9501\u5B9A (holder=${lockResult.holder}, self=${getWorkerId()})\uFF0C\u8DF3\u8FC7`);
          batchResult.skippedAccounts++;
          batchResult.accountResults.push({
            accountId: account.accountId,
            userId: account.userId,
            accountName: account.accountName,
            tier: tier2,
            success: false,
            startTime: /* @__PURE__ */ new Date(),
            endTime: /* @__PURE__ */ new Date(),
            durationMs: 0,
            completedSteps: 0,
            failedSteps: 0,
            totalSteps: 0,
            totalSynced: 0,
            errors: ["v614i: \u8D26\u6237\u88AB\u5176\u4ED6Worker\u9501\u5B9A\uFF0C\u667A\u80FD\u8DF3\u8FC7"],
            stepResults: {}
          });
          continue;
        }
        let accountResult;
        try {
          accountResult = await syncAccount(account, tier2);
        } catch (syncErr) {
          log135.warn(`[UnifiedSync] [v614i] \u8D26\u6237 ${account.accountId} \u540C\u6B65\u5F02\u5E38: ${syncErr.message}`);
          accountResult = {
            accountId: account.accountId,
            userId: account.userId,
            accountName: account.accountName,
            tier: tier2,
            success: false,
            startTime: /* @__PURE__ */ new Date(),
            endTime: /* @__PURE__ */ new Date(),
            durationMs: 0,
            completedSteps: 0,
            failedSteps: 1,
            totalSteps: 0,
            totalSynced: 0,
            errors: [syncErr.message],
            stepResults: {}
          };
        } finally {
          await releaseAccountLock(account.accountId);
        }
        batchResult.accountResults.push(accountResult);
        if (accountResult.success) {
          batchResult.successfulAccounts++;
        } else if (accountResult.errors.some(
          (e) => e.includes("\u5DF2\u6709") && e.includes("\u5728\u8FD0\u884C") || e.includes("\u5C42\u540C\u6B65\u5728\u8FD0\u884C") || e.includes("\u5C42\u6B63\u5728\u8FD0\u884C") || e.includes("\u5C42\u8DF3\u8FC7") || e.includes("\u5C42\u8DDF\u8FC7") || e.includes("\u667A\u80FD\u8DF3\u8FC7") || e.includes("\u7B49\u4E0B\u4E00\u8F6E") || e.includes("Worker\u9501\u5B9A")
        )) {
          batchResult.skippedAccounts++;
        } else {
          batchResult.failedAccounts++;
        }
        if (i < userAccounts.length - 1) {
          const rateDelay = rateController.getBatchDelay();
          const totalDelay = Math.max(ACCOUNT_DELAY_MS, rateDelay);
          await sleep3(totalDelay);
        }
      }
    });
    await Promise.all(userPromises);
    if (batchStart + PARALLEL_USERS < userGroupArray.length) {
      const rateDelay = rateController.getBatchDelay();
      const batchDelay = Math.max(2e3, rateDelay);
      log135.info(`[UnifiedSync] [v371] \u7528\u6237\u6279\u6B21\u95F4\u5EF6\u8FDF ${batchDelay}ms (\u901F\u7387\u63A7\u5236${rateDelay}ms, \u5229\u7528\u7387: ${rateController.getStatus().utilizationPercent}%)`);
      await sleep3(batchDelay);
    }
  }
  rateController.onSyncCycleComplete();
  batchResult.endTime = /* @__PURE__ */ new Date();
  batchResult.durationMs = batchResult.endTime.getTime() - startTime.getTime();
  engineStatus.lastSyncTime[tier2] = batchResult.endTime;
  const totalSynced = batchResult.accountResults.reduce((sum2, r) => {
    const synced = typeof r.totalSynced === "number" ? r.totalSynced : 0;
    return sum2 + synced;
  }, 0);
  log135.info(`[UnifiedSync] ${tier2}\u5C42\u6279\u91CF\u540C\u6B65\u5B8C\u6210: ${batchResult.successfulAccounts}/${batchResult.totalAccounts} \u6210\u529F, ${batchResult.failedAccounts} \u5931\u8D25, ${batchResult.skippedAccounts} \u8DF3\u8FC7, \u603B\u540C\u6B65 ${totalSynced} \u6761, \u8017\u65F6 ${batchResult.durationMs}ms`);
  logSync("UnifiedSync", `${tier2}\u5C42\u6279\u91CF\u540C\u6B65\u5B8C\u6210`, {
    tier: tier2,
    total: batchResult.totalAccounts,
    success: batchResult.successfulAccounts,
    failed: batchResult.failedAccounts,
    skipped: batchResult.skippedAccounts,
    totalSynced,
    durationMs: batchResult.durationMs
  });
  // [fix24-P2-10] Synced count logging enhancement
  if (batchResult.accountResults.length > 0) {
    const syncedDetails = batchResult.accountResults
      .filter(r => r.totalSynced > 0)
      .map(r => `${r.accountId}(${r.totalSynced})`)
      .join(', ');
    if (syncedDetails) {
      log135.info(`[UnifiedSync] [fix24-P2-10] ${tier2}\u5c42synced\u8ba1\u6570\u660e\u7ec6: ${syncedDetails}`);
    }
  }
  await recordBatchSyncResult(batchResult);
  if (tier2 === "high") {
    try {
      const { detectAndPauseZombieAccounts: detectAndPauseZombieAccounts2 } = await Promise.resolve().then(() => (init_zombieAccountDetector(), zombieAccountDetector_exports));
      const zombieResult = await detectAndPauseZombieAccounts2();
      if (zombieResult.pausedAccounts > 0) {
        log135.warn(`[UnifiedSync] [v443] \u50F5\u5C38\u8D26\u6237\u68C0\u6D4B: \u81EA\u52A8\u6682\u505C${zombieResult.pausedAccounts}\u4E2A\u65E0\u6570\u636E\u8D26\u6237`);
      }
    } catch (zombieErr) {
      log135.warn(`[UnifiedSync] [v443] \u50F5\u5C38\u8D26\u6237\u68C0\u6D4B\u5931\u8D25: ${zombieErr.message}`);
    }
  }
  if (tier2 === "full" || tier2 === "nightly") {
    try {
      const { scanAndAutoEnrollAll: scanAndAutoEnrollAll2 } = await Promise.resolve().then(() => (init_smartAutoEnrollService(), smartAutoEnrollService_exports));
      const enrollResult = await scanAndAutoEnrollAll2(false);
      if (enrollResult.accountsEnrolled > 0) {
        log135.info(`[UnifiedSync] [fix24-P1-5] \u81EA\u52A8\u7EB3\u7BA1: ${enrollResult.accountsEnrolled}\u4E2A\u8D26\u6237\u88AB\u81EA\u52A8\u7EB3\u7BA1, \u5171${enrollResult.totalCampaignsEnrolled}\u4E2ACampaign`);
      } else {
        log135.debug(`[UnifiedSync] [fix24-P1-5] \u81EA\u52A8\u7EB3\u7BA1\u626B\u63CF\u5B8C\u6210: \u65E0\u9700\u7EB3\u7BA1\u7684\u8D26\u6237`);
      }
    } catch (enrollErr) {
      log135.warn(`[UnifiedSync] [fix24-P1-5] \u81EA\u52A8\u7EB3\u7BA1\u626B\u63CF\u5931\u8D25: ${enrollErr.message}`);
    }
  }
  if (tier2 === "full" || tier2 === "nightly") {
    try {
      const { scanAllAccountsHealth: scanAllAccountsHealth2 } = await Promise.resolve().then(() => (init_optimizationHealthAlert(), optimizationHealthAlert_exports));
      const healthReport = await scanAllAccountsHealth2();
      if (healthReport.criticalAccounts > 0) {
        log135.warn(`[UnifiedSync] [fix24-P1-6] \u4F18\u5316\u5065\u5EB7\u544A\u8B66: ${healthReport.criticalAccounts}\u4E2A\u8D26\u6237\u5904\u4E8E\u4E25\u91CD\u72B6\u6001, \u5E73\u5747\u5065\u5EB7\u5206${healthReport.averageHealthScore}`);
      } else {
        log135.info(`[UnifiedSync] [fix24-P1-6] \u4F18\u5316\u5065\u5EB7\u68C0\u67E5: ${healthReport.healthyAccounts}\u5065\u5EB7/${healthReport.warningAccounts}\u8B66\u544A/${healthReport.criticalAccounts}\u4E25\u91CD, \u5E73\u5747\u5206${healthReport.averageHealthScore}`);
      }
    } catch (healthErr) {
      log135.warn(`[UnifiedSync] [fix24-P1-6] \u4F18\u5316\u5065\u5EB7\u68C0\u67E5\u5931\u8D25: ${healthErr.message}`);
    }
  }
  return batchResult;
}
async function confirmationSync(accountId, affectedEntities, triggerSource) {
  const source = triggerSource || "unknown";
  confirmationTracker.totalTriggered++;
  confirmationTracker.lastTriggeredAt = (/* @__PURE__ */ new Date()).toISOString();
  confirmationTracker.triggerSources[source] = (confirmationTracker.triggerSources[source] || 0) + 1;
  log135.info(`[UnifiedSync] v220 \u89E6\u53D1\u786E\u8BA4\u540C\u6B65: \u8D26\u6237 ${accountId}, \u53D7\u5F71\u54CD\u5B9E\u4F53: ${affectedEntities.join(", ")}, \u89E6\u53D1\u6E90: ${source}`);
  logSync("UnifiedSync", "v220 \u89E6\u53D1\u786E\u8BA4\u540C\u6B65", { accountId, affectedEntities, triggerSource: source });
  const accounts = await discoverSyncableAccounts();
  const account = accounts.find((a) => a.accountId === accountId);
  if (!account) {
    log135.warn(`[UnifiedSync] \u786E\u8BA4\u540C\u6B65: \u8D26\u6237 ${accountId} \u4E0D\u53EF\u7528\u6216\u672A\u6388\u6743`);
    return null;
  }
  const stepsToSync = [];
  for (const entity of affectedEntities) {
    switch (entity) {
      case "campaigns":
      case "budgets":
        stepsToSync.push("sp_campaigns", "sb_campaigns", "sd_campaigns");
        break;
      case "ad_groups":
        stepsToSync.push("sp_ad_groups", "sb_ad_groups", "sd_ad_groups");
        break;
      case "keywords":
        stepsToSync.push("sp_keywords", "sb_keywords");
        break;
      case "targets":
        stepsToSync.push("sp_product_targets", "sb_product_targets", "sd_product_targets");
        break;
    }
  }
  const uniqueSteps = [...new Set(stepsToSync)];
  await sleep3(1e3);
  const result = await syncAccount(account, "confirmation", {
    specificSteps: uniqueSteps
  });
  confirmationTracker.totalDurationMs += result.durationMs;
  if (result.success) {
    confirmationTracker.totalSucceeded++;
  } else {
    confirmationTracker.totalFailed++;
  }
  log135.info(
    `[UnifiedSync] v220 \u786E\u8BA4\u540C\u6B65\u5B8C\u6210: \u8D26\u6237 ${accountId}, \u6210\u529F ${result.completedSteps}/${result.totalSteps} \u6B65, \u540C\u6B65 ${result.totalSynced} \u6761, \u8017\u65F6 ${result.durationMs}ms, \u89E6\u53D1\u6E90: ${source}, \u7D2F\u8BA1: ${confirmationTracker.totalTriggered}\u6B21(\u6210\u529F${confirmationTracker.totalSucceeded})`
  );
  logSync("UnifiedSync", "v220 \u786E\u8BA4\u540C\u6B65\u5B8C\u6210", {
    accountId,
    completedSteps: result.completedSteps,
    // @ts-ignore
    totalSteps: result.totalSteps,
    totalSynced: result.totalSynced,
    durationMs: result.durationMs,
    triggerSource: source,
    cumulativeStats: {
      totalTriggered: confirmationTracker.totalTriggered,
      totalSucceeded: confirmationTracker.totalSucceeded,
      totalFailed: confirmationTracker.totalFailed,
      avgDurationMs: Math.round(confirmationTracker.totalDurationMs / confirmationTracker.totalTriggered)
    }
  });
  return result;
}
function getEngineStatus() {
  return {
    ...engineStatus,
    rateControl: rateController.getStatus(),
    confirmationSync: { ...confirmationTracker }
  };
}
async function getDistributedWorkerInfo() {
  try {
    const workers = await getActiveWorkers();
    const workerId = getWorkerId();
    return { workerId, workers, activeCount: workers.length };
  } catch {
    return { workerId: "unknown", workers: [], activeCount: 0 };
  }
}
function shutdownDistributedWorker() {
  try {
    stopWorkerLifecycle();
  } catch {
  }
}
function getAllSyncSteps() {
  return SYNC_STEPS.map((s) => ({ id: s.id, name: s.name, tier: s.tier }));
}
async function recordBatchSyncResult(batchResult) {
  const safeNum = /* @__PURE__ */ __name((val) => {
    if (typeof val === "number" && !isNaN(val)) return val;
    if (typeof val === "object" && val !== null) {
      return Object.values(val).reduce((s, v) => s + (typeof v === "number" ? v : 0), 0);
    }
    return 0;
  }, "safeNum");
  try {
    const database = await getDb();
    if (!database) return;
    const { dataSyncJobs: dataSyncJobs2 } = await Promise.resolve().then(() => (init_schema2(), schema_exports));
    for (const accountResult of batchResult.accountResults) {
      if (accountResult.errors.some(
        (e) => e.includes("\u5DF2\u6709") && e.includes("\u5728\u8FD0\u884C") || e.includes("\u5C42\u540C\u6B65\u5728\u8FD0\u884C") || e.includes("\u5C42\u6B63\u5728\u8FD0\u884C") || e.includes("\u5C42\u8DF3\u8FC7") || e.includes("\u5C42\u8DDF\u8FC7") || e.includes("\u667A\u80FD\u8DF3\u8FC7") || e.includes("\u7B49\u4E0B\u4E00\u8F6E")
      )) {
        continue;
      }
      if (accountResult.totalSteps === 0 && Object.keys(accountResult.stepResults).length === 0) {
        continue;
      }
      try {
        await database.insert(dataSyncJobs2).values({
          // @ts-ignore
          userId: accountResult.userId || 390001,
          // v336: 使用账户关联的userId，而不是硬编码的1
          accountId: accountResult.accountId,
          syncType: batchResult.tier === "high" ? "campaigns" : batchResult.tier === "medium" ? "targeting" : "all",
          status: accountResult.success ? "completed" : "failed",
          startedAt: accountResult.startTime.toISOString().slice(0, 19).replace("T", " "),
          completedAt: accountResult.endTime.toISOString().slice(0, 19).replace("T", " "),
          durationMs: accountResult.durationMs,
          errorMessage: accountResult.errors.length > 0 ? accountResult.errors.slice(0, 3).join("; ") : null,
          // @ts-expect-error - runtime type mismatch
          spCampaigns: safeNum(accountResult.stepResults["sp_campaigns"]?.synced),
          // @ts-expect-error - runtime type mismatch
          sbCampaigns: safeNum(accountResult.stepResults["sb_campaigns"]?.synced),
          // @ts-expect-error - runtime type mismatch
          sdCampaigns: safeNum(accountResult.stepResults["sd_campaigns"]?.synced),
          // @ts-expect-error - runtime type mismatch
          adGroupsSynced: safeNum(accountResult.stepResults["sp_ad_groups"]?.synced) + // @ts-expect-error - runtime type mismatch
          safeNum(accountResult.stepResults["sb_ad_groups"]?.synced) + // @ts-expect-error - runtime type mismatch
          safeNum(accountResult.stepResults["sd_ad_groups"]?.synced),
          // @ts-expect-error - runtime type mismatch
          keywordsSynced: safeNum(accountResult.stepResults["sp_keywords"]?.synced) + // @ts-expect-error - runtime type mismatch
          safeNum(accountResult.stepResults["sb_keywords"]?.synced),
          // @ts-expect-error - runtime type mismatch
          targetsSynced: safeNum(accountResult.stepResults["sp_product_targets"]?.synced) + // @ts-expect-error - runtime type mismatch
          safeNum(accountResult.stepResults["sb_product_targets"]?.synced) + // @ts-expect-error - runtime type mismatch
          safeNum(accountResult.stepResults["sd_product_targets"]?.synced),
          // @ts-expect-error - runtime type mismatch
          performanceSynced: safeNum(accountResult.stepResults["performance_today"]?.synced) + // @ts-expect-error - runtime type mismatch
          safeNum(accountResult.stepResults["performance_7d"]?.synced) + // @ts-expect-error - runtime type mismatch
          safeNum(accountResult.stepResults["performance_95d"]?.synced),
          // v256: 修复 recordsSynced 字段映射 — 计算所有步骤的同步记录总数
          recordsSynced: Object.values(accountResult.stepResults).reduce(
            // @ts-ignore
            (total, step) => total + safeNum(step?.synced),
            0
          ),
          // v364: 修复同步任务步骤计数缺失 - 添加totalSteps和currentStepIndex
          totalSteps: accountResult.totalSteps || Object.keys(accountResult.stepResults).length,
          currentStepIndex: accountResult.totalSteps || Object.keys(accountResult.stepResults).length,
          currentStep: accountResult.success ? "\u5B8C\u6210" : "\u5931\u8D25",
          progressPercent: accountResult.success ? 100 : Math.round(
            // @ts-ignore
            Object.values(accountResult.stepResults).filter((s) => s?.success).length / Math.max(Object.keys(accountResult.stepResults).length, 1) * 100
          )
        });
      } catch (insertErr) {
        log135.warn(`[UnifiedSync] \u8BB0\u5F55\u8D26\u6237 ${accountResult.accountId} \u540C\u6B65\u7ED3\u679C\u5931\u8D25: ${insertErr.message}`);
      }
    }
  } catch (error48) {
    log135.warn(`[UnifiedSync] \u8BB0\u5F55\u6279\u91CF\u540C\u6B65\u7ED3\u679C\u5931\u8D25: ${error48.message}`);
  }
}
async function triggerManualFullSync(accountId, onProgress, options) {
  const accounts = await discoverSyncableAccounts();
  const account = accounts.find((a) => a.accountId === accountId);
  if (!account) {
    log135.warn(`[UnifiedSync] \u624B\u52A8\u540C\u6B65: \u8D26\u6237 ${accountId} \u4E0D\u53EF\u7528`);
    return null;
  }
  const allSteps = SYNC_STEPS.map((s) => s.id);
  const fullSteps = getStepsForTier("full").map((s) => s.id);
  const nightlySteps = getStepsForTier("nightly").map((s) => s.id);
  const combinedStepIds = [.../* @__PURE__ */ new Set([...fullSteps, ...nightlySteps])];
  const orderedStepIds = allSteps.filter((id) => combinedStepIds.includes(id));
  const wrappedOnProgress = /* @__PURE__ */ __name(async (step, index2, total) => {
    if (onProgress) {
      onProgress(step, index2, total);
    }
    if (options?.jobId) {
      try {
        const { updateSyncJob: updateSyncJob2 } = await Promise.resolve().then(() => (init_syncJobs(), syncJobs_exports));
        const progressPercent = Math.round((index2 + 1) / total * 100);
        await updateSyncJob2(options.jobId, {
          currentStep: step,
          totalSteps: total,
          currentStepIndex: index2,
          progressPercent
        });
      } catch (e) {
        log135.debug(`[UnifiedSync] v404: \u66F4\u65B0\u624B\u52A8\u540C\u6B65\u8FDB\u5EA6\u5931\u8D25: ${e.message}`);
      }
    }
  }, "wrappedOnProgress");
  log135.info(`[UnifiedSync] v404: \u624B\u52A8\u5168\u91CF\u540C\u6B65\u8D26\u6237 ${accountId}\uFF0C\u6267\u884C ${orderedStepIds.length} \u4E2A\u6B65\u9AA4\uFF08\u542Bnightly\u5C42\u7EA7\uFF09`);
  const result = await syncAccount(account, "full", {
    specificSteps: orderedStepIds,
    onProgress: wrappedOnProgress,
    isManual: true
  });
  if (result) {
    try {
      const { postSyncCoverageCheck: postSyncCoverageCheck2 } = await Promise.resolve().then(() => (init_performanceIntegrityChecker(), performanceIntegrityChecker_exports));
      await postSyncCoverageCheck2(accountId, "full");
    } catch (coverageErr) {
      log135.warn(`[fix24] \u7EE9\u6548\u8986\u76D6\u7387\u68C0\u67E5\u5931\u8D25: ${coverageErr.message}`);
    }
  }
  if (result) {
    try {
      const { postSyncAutoEnrollCheck: postSyncAutoEnrollCheck2 } = await Promise.resolve().then(() => (init_smartAutoEnrollService(), smartAutoEnrollService_exports));
      await postSyncAutoEnrollCheck2(accountId, "full");
    } catch (enrollErr) {
      log135.warn(`[fix24-patch] \u5355\u8D26\u6237\u81EA\u52A8\u7EB3\u7BA1\u68C0\u67E5\u5931\u8D25: ${enrollErr.message}`);
    }
  }
  if (result) {
    try {
      const { detectAndQueueBackfill: detectAndQueueBackfill2 } = await Promise.resolve().then(() => (init_dateGapBackfillService(), dateGapBackfillService_exports));
      const gapResult = await detectAndQueueBackfill2(accountId);
      if (gapResult.gapsDetected > 0) {
        log135.warn(`[fix24-patch] \u8D26\u6237${accountId}: \u68C0\u6D4B\u5230${gapResult.gapsDetected}\u5904\u65E5\u671F\u65AD\u6863\uFF0C\u5DF2\u6392\u961F${gapResult.gapsQueued}\u5904\u5F85\u8865\u507F`);
      }
    } catch (gapErr) {
      log135.warn(`[fix24-patch] \u65E5\u671F\u65AD\u6863\u68C0\u6D4B\u5931\u8D25: ${gapErr.message}`);
    }
  }
  if (options?.jobId && result) {
    try {
      const { updateSyncJob: updateSyncJob2 } = await Promise.resolve().then(() => (init_syncJobs(), syncJobs_exports));
      const safeNum = /* @__PURE__ */ __name((v) => typeof v === "number" && !isNaN(v) ? v : 0, "safeNum");
      await updateSyncJob2(options.jobId, {
        status: result.success ? "completed" : "failed",
        errorMessage: result.errors.length > 0 ? result.errors.slice(0, 3).join("; ") : void 0,
        durationMs: result.durationMs,
        recordsSynced: result.totalSynced,
        spCampaigns: safeNum(result.stepResults["sp_campaigns"]?.synced),
        sbCampaigns: safeNum(result.stepResults["sb_campaigns"]?.synced),
        sdCampaigns: safeNum(result.stepResults["sd_campaigns"]?.synced),
        adGroupsSynced: safeNum(result.stepResults["sp_ad_groups"]?.synced) + safeNum(result.stepResults["sb_ad_groups"]?.synced) + safeNum(result.stepResults["sd_ad_groups"]?.synced),
        keywordsSynced: safeNum(result.stepResults["sp_keywords"]?.synced) + safeNum(result.stepResults["sb_keywords"]?.synced),
        targetsSynced: safeNum(result.stepResults["sp_product_targets"]?.synced) + safeNum(result.stepResults["sb_product_targets"]?.synced) + safeNum(result.stepResults["sd_product_targets"]?.synced),
        totalSteps: result.totalSteps,
        currentStepIndex: result.totalSteps,
        currentStep: result.success ? "\u5B8C\u6210" : "\u5931\u8D25",
        progressPercent: result.success ? 100 : Math.round(
          result.completedSteps / Math.max(result.totalSteps, 1) * 100
        )
      });
    } catch (e) {
      log135.warn(`[UnifiedSync] v404: \u66F4\u65B0\u624B\u52A8\u540C\u6B65\u6700\u7EC8\u72B6\u6001\u5931\u8D25: ${e.message}`);
    }
  }
  return result;
}
function isAccountSyncing(accountId) {
  return Array.from(activeSyncs.keys()).some((key) => key.startsWith(`${accountId}:`));
}
function getAccountSyncStatus(accountId) {
  for (const [key, value] of activeSyncs.entries()) {
    if (key.startsWith(`${accountId}:`)) {
      return value;
    }
  }
  return null;
}
function sleep3(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
var log135, v534Initialized, ApiRateController, rateController, confirmationTracker, healthHistory, MAX_HEALTH_HISTORY, SYNC_STEPS, TIER_HIERARCHY, engineStatus, MAX_CONCURRENT_ACCOUNTS, activeSyncs, HEARTBEAT_ZOMBIE_TIMEOUT_MS, MAX_ABSOLUTE_TIMEOUT_MS, DEFAULT_SYNC_TIMEOUT_MS, LARGE_ACCOUNT_TIMEOUT_TIERS, NIGHTLY_SYNC_TIMEOUT_MS;
var init_unifiedSyncEngine = __esm({
  "server/sync/unifiedSyncEngine.ts"() {
    "use strict";
    init_db2();
    init_drizzle_orm();
    init_amazonSyncService();
    init_logger();
    init_opsLogger();
    init_systemConfigService2();
    init_v534_upgrade_syncEngine();
    init_checkpointManager();
    init_v534_upgrade_reconciliation();
    init_reportSemaphore();
    init_distributedQueue();
    log135 = createModuleLogger("UnifiedSync");
    v534Initialized = false;
    __name(v534Init, "v534Init");
    ApiRateController = class {
      static {
        __name(this, "ApiRateController");
      }
      // 滑动窗口配置
      windowMs = 6e4;
      // 1分钟窗口
      maxCallsPerWindow = 120;
      // 每分钟最多120次API调用（保守值，实际限额更高）
      callTimestamps = [];
      // 自适应速率
      baseStepDelayMs = 2e3;
      // v476: 步骤间基础延迟2秒，优先保证100%成功率
      currentStepDelayMs = 2e3;
      // v476: 当前步骤间延迟
      baseBatchDelayMs = 2e3;
      // 批次间基础延迟
      currentBatchDelayMs = 2e3;
      // 当前批次间延迟
      // 限流反馈
      throttleCount = 0;
      // 当前窗口内被限流次数
      totalThrottleCount = 0;
      // 总限流次数
      lastThrottleTime = null;
      consecutiveSuccessWindows = 0;
      // 连续无限流的窗口数
      // 监控指标
      totalApiCalls = 0;
      windowApiCalls = 0;
      peakCallsPerMinute = 0;
      /**
       * 记录一次API调用
       */
      recordApiCall() {
        const now = Date.now();
        this.callTimestamps.push(now);
        this.totalApiCalls++;
        this.windowApiCalls++;
        this.pruneOldTimestamps(now);
        const currentRate = this.getCallsInWindow();
        if (currentRate > this.peakCallsPerMinute) {
          this.peakCallsPerMinute = currentRate;
        }
      }
      /**
       * 记录一次限流事件（429响应）
       */
      recordThrottle() {
        this.throttleCount++;
        this.totalThrottleCount++;
        this.lastThrottleTime = /* @__PURE__ */ new Date();
        this.consecutiveSuccessWindows = 0;
        const backoffFactor = Math.min(Math.pow(1.5, this.throttleCount), 8);
        this.currentStepDelayMs = Math.min(this.baseStepDelayMs * backoffFactor, 15e3);
        this.currentBatchDelayMs = Math.min(this.baseBatchDelayMs * backoffFactor, 3e4);
        log135.warn(`[RateControl] API\u9650\u6D41! \u7B2C${this.throttleCount}\u6B21, \u6B65\u9AA4\u5EF6\u8FDF\u8C03\u6574\u4E3A${this.currentStepDelayMs}ms, \u6279\u6B21\u5EF6\u8FDF\u8C03\u6574\u4E3A${this.currentBatchDelayMs}ms`);
        logSyncWarn("RateControl", "API\u9650\u6D41\u89E6\u53D1\u9000\u907F", {
          throttleCount: this.throttleCount,
          totalThrottles: this.totalThrottleCount,
          stepDelay: this.currentStepDelayMs,
          batchDelay: this.currentBatchDelayMs
        });
      }
      /**
       * 获取步骤间应等待的延迟（毫秒）
       * 根据当前API调用速率动态调整
       */
      getStepDelay() {
        const currentRate = this.getCallsInWindow();
        const utilizationRatio = currentRate / this.maxCallsPerWindow;
        if (utilizationRatio > 0.8) {
          return Math.max(this.currentStepDelayMs * 2, 1e3);
        } else if (utilizationRatio > 0.6) {
          return Math.max(this.currentStepDelayMs * 1.5, 500);
        }
        return this.currentStepDelayMs;
      }
      /**
       * 获取批次间应等待的延迟（毫秒）
       */
      getBatchDelay() {
        const currentRate = this.getCallsInWindow();
        const utilizationRatio = currentRate / this.maxCallsPerWindow;
        if (utilizationRatio > 0.7) {
          return Math.max(this.currentBatchDelayMs * 2, 5e3);
        }
        return this.currentBatchDelayMs;
      }
      /**
       * 在同步周期结束时调用，尝试恢复速率
       */
      onSyncCycleComplete() {
        if (this.throttleCount === 0) {
          this.consecutiveSuccessWindows++;
          if (this.consecutiveSuccessWindows >= 3 && this.currentStepDelayMs > this.baseStepDelayMs) {
            this.currentStepDelayMs = Math.max(
              this.baseStepDelayMs,
              this.currentStepDelayMs * 0.7
              // 每次恢复30%
            );
            this.currentBatchDelayMs = Math.max(
              this.baseBatchDelayMs,
              this.currentBatchDelayMs * 0.7
            );
            log135.info(`[RateControl] \u901F\u7387\u6062\u590D: \u6B65\u9AA4\u5EF6\u8FDF=${this.currentStepDelayMs}ms, \u6279\u6B21\u5EF6\u8FDF=${this.currentBatchDelayMs}ms`);
          }
        }
        this.throttleCount = 0;
        this.windowApiCalls = 0;
      }
      /**
       * 获取速率控制器状态（用于监控日志）
       */
      getStatus() {
        return {
          totalApiCalls: this.totalApiCalls,
          callsInCurrentWindow: this.getCallsInWindow(),
          peakCallsPerMinute: this.peakCallsPerMinute,
          currentStepDelayMs: this.currentStepDelayMs,
          currentBatchDelayMs: this.currentBatchDelayMs,
          totalThrottleCount: this.totalThrottleCount,
          lastThrottleTime: this.lastThrottleTime,
          consecutiveSuccessWindows: this.consecutiveSuccessWindows,
          utilizationPercent: Math.round(this.getCallsInWindow() / this.maxCallsPerWindow * 100)
        };
      }
      getCallsInWindow() {
        this.pruneOldTimestamps(Date.now());
        return this.callTimestamps.length;
      }
      pruneOldTimestamps(now) {
        const cutoff = now - this.windowMs;
        while (this.callTimestamps.length > 0 && this.callTimestamps[0] < cutoff) {
          this.callTimestamps.shift();
        }
      }
    };
    rateController = new ApiRateController();
    confirmationTracker = {
      totalTriggered: 0,
      totalSucceeded: 0,
      totalFailed: 0,
      totalDurationMs: 0,
      lastTriggeredAt: null,
      triggerSources: {}
    };
    healthHistory = [];
    MAX_HEALTH_HISTORY = 24;
    __name(captureHealthSnapshot, "captureHealthSnapshot");
    __name(logHealthSnapshot, "logHealthSnapshot");
    __name(getHealthHistory, "getHealthHistory");
    SYNC_STEPS = [
      // === 高频同步步骤（每15分钟） ===
      {
        id: "sp_campaigns",
        name: "SP\u5E7F\u544A\u6D3B\u52A8",
        tier: "high",
        execute: /* @__PURE__ */ __name(async (service, ctx) => {
          try {
            const result = await service.syncSpCampaigns();
            const synced = typeof result === "number" ? result : result.synced;
            return { success: true, synced, errors: [] };
          } catch (e) {
            return { success: false, synced: 0, errors: [e.message] };
          }
        }, "execute")
      },
      {
        id: "sb_campaigns",
        name: "SB\u5E7F\u544A\u6D3B\u52A8",
        tier: "high",
        // @ts-ignore
        execute: /* @__PURE__ */ __name(async (service, ctx) => {
          try {
            const result = await service.syncSbCampaigns();
            const synced = typeof result === "number" ? result : result.synced;
            return { success: true, synced, errors: [] };
          } catch (e) {
            return { success: false, synced: 0, errors: [e.message] };
          }
        }, "execute")
      },
      {
        id: "sd_campaigns",
        name: "SD\u5E7F\u544A\u6D3B\u52A8",
        // @ts-ignore
        tier: "high",
        execute: /* @__PURE__ */ __name(async (service, ctx) => {
          try {
            const result = await service.syncSdCampaigns();
            const synced = typeof result === "number" ? result : result.synced;
            return { success: true, synced, errors: [] };
          } catch (e) {
            return { success: false, synced: 0, errors: [e.message] };
          }
        }, "execute")
      },
      {
        id: "performance_today",
        // @ts-ignore
        name: "\u5F53\u65E5\u7EE9\u6548",
        tier: "high",
        execute: /* @__PURE__ */ __name(async (service, ctx) => {
          try {
            const campaignCount = ctx?.campaignCount || 0;
            const isLargeAccount = campaignCount > 3e3;
            if (isLargeAccount) {
              log135.info(`[v614i-fix9] \u5927\u8D26\u6237\u5206\u7247\u6267\u884C\u5F53\u65E5\u7EE9\u6548: campaignCount=${campaignCount}, \u6309SP/SB/SD\u5206\u7247`);
              let totalSynced = 0;
              const errors = [];
              const adTypes = ["SP", "SB", "SD"];
              for (const adType of adTypes) {
                try {
                  log135.info(`[v614i-fix9] \u5F00\u59CB\u5206\u7247\u540C\u6B65 ${adType} \u5F53\u65E5\u7EE9\u6548...`);
                  const shardResult = await service.syncPerformanceByType?.(1, adType) ?? 0;
                  const shardSynced = typeof shardResult === "number" ? shardResult : shardResult?.synced || 0;
                  totalSynced += shardSynced;
                  log135.info(`[v614i-fix9] ${adType} \u5206\u7247\u5B8C\u6210: ${shardSynced}\u6761`);
                } catch (shardErr) {
                  const msg = `${adType}\u5206\u7247\u5931\u8D25: ${shardErr.message}`;
                  log135.warn(`[v614i-fix9] ${msg}`);
                  errors.push(msg);
                }
              }
              try {
                const kwPerf = await service.syncKeywordPerformanceData?.(1) ?? 0;
                totalSynced += typeof kwPerf === "number" ? kwPerf : 0;
              } catch (e2) {
                errors.push(`\u5173\u952E\u8BCD\u7EE9\u6548: ${e2.message}`);
              }
              try {
                const ptPerf = await service.syncProductTargetPerformanceData?.(1) ?? 0;
                totalSynced += typeof ptPerf === "number" ? ptPerf : 0;
              } catch (e3) {
                errors.push(`\u5B9A\u4F4D\u7EE9\u6548: ${e3.message}`);
              }
              if (errors.length > 0 && totalSynced === 0) {
                return { success: false, synced: 0, errors };
              }
              return { success: true, synced: totalSynced, errors };
            }
            const result = await service.syncPerformanceOnly(1);
            const synced = typeof result === "number" ? result : (result.performance || 0) + (result.keywordPerf || 0) + (result.targetPerf || 0);
            return { success: true, synced, errors: [] };
          } catch (e) {
            const errMsg = e.message || "unknown error";
            return { success: false, synced: 0, errors: [errMsg] };
          }
        }, "execute")
      },
      // === 中频同步步骤（每30分钟） ===
      {
        // @ts-ignore
        id: "sp_ad_groups",
        name: "SP\u5E7F\u544A\u7EC4",
        tier: "medium",
        execute: /* @__PURE__ */ __name(async (service, ctx) => {
          try {
            const result = await service.syncSpAdGroups();
            const synced = typeof result === "number" ? result : result.synced;
            return { success: true, synced, errors: [] };
          } catch (e) {
            return { success: false, synced: 0, errors: [e.message] };
          }
        }, "execute")
      },
      // @ts-ignore
      {
        id: "sb_ad_groups",
        name: "SB\u5E7F\u544A\u7EC4",
        tier: "medium",
        execute: /* @__PURE__ */ __name(async (service, ctx) => {
          try {
            const result = await service.syncSbAdGroups();
            return { success: true, synced: result.synced, errors: [] };
          } catch (e) {
            return { success: false, synced: 0, errors: [e.message] };
          }
        }, "execute")
        // @ts-ignore
      },
      {
        id: "sd_ad_groups",
        name: "SD\u5E7F\u544A\u7EC4",
        tier: "medium",
        execute: /* @__PURE__ */ __name(async (service, ctx) => {
          try {
            const result = await service.syncSdAdGroups();
            return { success: true, synced: result.synced, errors: [] };
          } catch (e) {
            return { success: false, synced: 0, errors: [e.message] };
          }
        }, "execute")
      },
      {
        id: "sp_keywords",
        name: "SP\u5173\u952E\u8BCD",
        tier: "medium",
        execute: /* @__PURE__ */ __name(async (service, ctx) => {
          try {
            const result = await service.syncSpKeywords();
            const synced = typeof result === "number" ? result : result.synced;
            return { success: true, synced, errors: [] };
          } catch (e) {
            return { success: false, synced: 0, errors: [e.message] };
          }
        }, "execute")
      },
      {
        id: "sb_keywords",
        name: "SB\u5173\u952E\u8BCD",
        tier: "medium",
        execute: /* @__PURE__ */ __name(async (service, ctx) => {
          try {
            const result = await service.syncSbKeywords();
            return { success: true, synced: result.synced, errors: [] };
          } catch (e) {
            return { success: false, synced: 0, errors: [e.message] };
          }
        }, "execute")
      },
      {
        id: "sp_product_targets",
        name: "SP\u5546\u54C1\u5B9A\u4F4D",
        tier: "medium",
        execute: /* @__PURE__ */ __name(async (service, ctx) => {
          try {
            const result = await service.syncSpProductTargets();
            const synced = typeof result === "number" ? result : result.synced;
            return { success: true, synced, errors: [] };
          } catch (e) {
            return { success: false, synced: 0, errors: [e.message] };
          }
        }, "execute")
      },
      {
        id: "sb_product_targets",
        name: "SB\u5546\u54C1\u5B9A\u4F4D",
        tier: "medium",
        execute: /* @__PURE__ */ __name(async (service, ctx) => {
          try {
            const result = await service.syncSbProductTargets();
            return { success: true, synced: result.synced, errors: [] };
          } catch (e) {
            return { success: false, synced: 0, errors: [e.message] };
          }
        }, "execute")
      },
      {
        id: "sd_product_targets",
        name: "SD\u5546\u54C1\u5B9A\u4F4D",
        tier: "medium",
        execute: /* @__PURE__ */ __name(async (service, ctx) => {
          try {
            const result = await service.syncSdProductTargets();
            return { success: true, synced: result.synced, errors: [] };
          } catch (e) {
            return { success: false, synced: 0, errors: [e.message] };
          }
        }, "execute")
      },
      {
        id: "performance_7d",
        name: "7\u5929\u7EE9\u6548\u56DE\u6EAF",
        tier: "medium",
        execute: /* @__PURE__ */ __name(async (service, ctx) => {
          try {
            const result = await service.syncPerformanceOnly(7);
            const synced = typeof result === "number" ? result : (result.performance || 0) + (result.keywordPerf || 0) + (result.targetPerf || 0);
            return { success: true, synced, errors: [] };
          } catch (e) {
            return { success: false, synced: 0, errors: [e.message] };
          }
        }, "execute")
      },
      // === 完整同步步骤（每60分钟） ===
      {
        id: "sp_negative_keywords",
        name: "SP\u5426\u5B9A\u5173\u952E\u8BCD",
        tier: "high",
        // v256: 从 medium 提升到 high，确保否定关键词及时同步（30min→10min）
        execute: /* @__PURE__ */ __name(async (service, ctx) => {
          try {
            const result = await service.syncSpNegativeKeywords();
            return { success: true, synced: result.synced, errors: [] };
          } catch (e) {
            return { success: false, synced: 0, errors: [e.message] };
          }
        }, "execute")
      },
      {
        id: "sb_negative_keywords",
        name: "SB\u5426\u5B9A\u5173\u952E\u8BCD",
        tier: "high",
        // v256: 从 medium 提升到 high
        // @ts-ignore
        execute: /* @__PURE__ */ __name(async (service, ctx) => {
          try {
            const result = await service.syncSbNegativeKeywords();
            return { success: true, synced: result.synced, errors: [] };
          } catch (e) {
            return { success: false, synced: 0, errors: [e.message] };
          }
        }, "execute")
      },
      {
        id: "sp_negative_targets",
        name: "SP\u5426\u5B9A\u5546\u54C1\u5B9A\u4F4D",
        // @ts-ignore
        tier: "high",
        // v256: 从 medium 提升到 high
        execute: /* @__PURE__ */ __name(async (service, ctx) => {
          try {
            const result = await service.syncSpNegativeProductTargets();
            return { success: true, synced: result.synced, errors: [] };
          } catch (e) {
            return { success: false, synced: 0, errors: [e.message] };
          }
        }, "execute")
      },
      {
        id: "sb_negative_targets",
        // @ts-ignore
        name: "SB\u5426\u5B9A\u5546\u54C1\u5B9A\u4F4D",
        tier: "high",
        // v256: 从 medium 提升到 high
        execute: /* @__PURE__ */ __name(async (service, ctx) => {
          try {
            const result = await service.syncSbNegativeTargets();
            return { success: true, synced: result.synced, errors: [] };
          } catch (e) {
            return { success: false, synced: 0, errors: [e.message] };
          }
        }, "execute")
      },
      {
        // @ts-ignore
        id: "sd_negative_targets",
        name: "SD\u5426\u5B9A\u5546\u54C1\u5B9A\u4F4D",
        tier: "high",
        execute: /* @__PURE__ */ __name(async (service, ctx) => {
          try {
            const result = await service.syncSdNegativeTargets();
            return { success: true, synced: result.synced, errors: [] };
          } catch (e) {
            return { success: false, synced: 0, errors: [e.message] };
          }
        }, "execute")
      },
      // @ts-ignore
      {
        id: "sp_search_terms",
        name: "SP\u641C\u7D22\u8BCD",
        tier: "full",
        execute: /* @__PURE__ */ __name(async (service, ctx) => {
          try {
            const synced = await service.syncSearchTerms(95);
            return { success: true, synced, errors: [] };
          } catch (e) {
            return { success: false, synced: 0, errors: [e.message] };
          }
        }, "execute")
        // @ts-ignore
      },
      {
        id: "sb_search_terms",
        name: "SB\u641C\u7D22\u8BCD",
        tier: "full",
        execute: /* @__PURE__ */ __name(async (service, ctx) => {
          try {
            const synced = await service.syncSbSearchTerms(60);
            return { success: true, synced, errors: [] };
          } catch (e) {
            return { success: false, synced: 0, errors: [e.message] };
          }
        }, "execute")
      },
      {
        id: "sp_placement_performance",
        name: "SP\u5E7F\u544A\u4F4D\u7EE9\u6548",
        tier: "full",
        execute: /* @__PURE__ */ __name(async (service, ctx) => {
          try {
            const synced = await service.syncPlacementPerformance(95);
            return { success: true, synced, errors: [] };
          } catch (e) {
            return { success: false, synced: 0, errors: [e.message] };
          }
        }, "execute")
      },
      {
        id: "sb_placement_performance",
        name: "SB\u5E7F\u544A\u4F4D\u7EE9\u6548",
        tier: "full",
        execute: /* @__PURE__ */ __name(async (service, ctx) => {
          try {
            const synced = await service.syncSbPlacementPerformance(60);
            return { success: true, synced, errors: [] };
          } catch (e) {
            return { success: false, synced: 0, errors: [e.message] };
          }
        }, "execute")
      },
      {
        id: "sp_auto_targeting",
        name: "SP\u81EA\u52A8\u5B9A\u5411",
        tier: "full",
        execute: /* @__PURE__ */ __name(async (service, ctx) => {
          try {
            const synced = await service.syncAutoTargeting(95);
            return { success: true, synced, errors: [] };
          } catch (e) {
            return { success: false, synced: 0, errors: [e.message] };
          }
        }, "execute")
      },
      {
        id: "sd_targeting",
        name: "SD\u5B9A\u5411\u62A5\u544A",
        tier: "full",
        execute: /* @__PURE__ */ __name(async (service, ctx) => {
          try {
            const synced = await service.syncSdTargeting(95);
            return { success: true, synced, errors: [] };
          } catch (e) {
            return { success: false, synced: 0, errors: [e.message] };
          }
        }, "execute")
      },
      {
        id: "sb_targeting",
        name: "SB\u5B9A\u5411\u62A5\u544A",
        tier: "full",
        execute: /* @__PURE__ */ __name(async (service, ctx) => {
          try {
            const synced = await service.syncSbTargeting(60);
            return { success: true, synced, errors: [] };
          } catch (e) {
            return { success: false, synced: 0, errors: [e.message] };
          }
        }, "execute")
      },
      {
        id: "sb_ads",
        name: "SB\u5E7F\u544A\u7D20\u6750",
        tier: "full",
        execute: /* @__PURE__ */ __name(async (service, ctx) => {
          try {
            const result = await service.syncSbAds();
            return { success: true, synced: result.synced, errors: [] };
          } catch (e) {
            return { success: false, synced: 0, errors: [e.message] };
          }
        }, "execute")
      },
      {
        id: "sb_asset_urls",
        name: "SB\u7D20\u6750URL",
        tier: "full",
        execute: /* @__PURE__ */ __name(async (service, ctx) => {
          try {
            const synced = await service.syncAssetUrls();
            return { success: true, synced, errors: [] };
          } catch (e) {
            return { success: false, synced: 0, errors: [e.message] };
          }
        }, "execute")
      },
      {
        id: "sp_bid_recommendations",
        name: "SP\u5EFA\u8BAE\u7ADE\u4EF7",
        tier: "medium",
        // v521: 从full降级到medium层，允许建议竞价独立于报告下载步骤运行
        execute: /* @__PURE__ */ __name(async (service, ctx) => {
          try {
            const result = await service.syncSpBidRecommendations();
            const synced = typeof result === "number" ? result : result.synced || 0;
            return { success: true, synced, errors: [] };
          } catch (e) {
            return { success: false, synced: 0, errors: [e.message] };
          }
        }, "execute")
      },
      {
        id: "sb_bid_recommendations",
        name: "SB\u5EFA\u8BAE\u7ADE\u4EF7",
        tier: "medium",
        // v521: 从full降级到medium层，解决全量同步阻塞导致SB建议竞价无法写入的问题
        execute: /* @__PURE__ */ __name(async (service, ctx) => {
          try {
            const result = await service.syncSbBidRecommendations();
            const synced = typeof result === "number" ? result : result.synced || 0;
            return { success: true, synced, errors: [] };
          } catch (e) {
            return { success: false, synced: 0, errors: [e.message] };
          }
        }, "execute")
      },
      {
        id: "sd_bid_recommendations",
        name: "SD\u5EFA\u8BAE\u7ADE\u4EF7",
        // @ts-ignore
        tier: "medium",
        // v521: 从full降级到medium层，解决全量同步阻塞导致SD建议竞价无法写入的问题
        execute: /* @__PURE__ */ __name(async (service, ctx) => {
          try {
            const result = await service.syncSdBidRecommendations();
            const synced = typeof result === "number" ? result : result.synced || 0;
            return { success: true, synced, errors: [] };
          } catch (e) {
            return { success: false, synced: 0, errors: [e.message] };
          }
        }, "execute")
      },
      // v519: SD受众定向建议竞价
      {
        id: "sd_audience_bid_recommendations",
        name: "SD\u53D7\u4F17\u5EFA\u8BAE\u7ADE\u4EF7",
        // @ts-ignore
        tier: "medium",
        // v521: 从full降级到medium层
        execute: /* @__PURE__ */ __name(async (service, ctx) => {
          try {
            const result = await service.syncSdAudienceBidRecommendations();
            const synced = typeof result === "number" ? result : result.synced || 0;
            return { success: true, synced, errors: [] };
          } catch (e) {
            return { success: false, synced: 0, errors: [e.message] };
          }
        }, "execute")
      },
      {
        // @ts-ignore
        id: "sp_budget_rules",
        name: "SP\u9884\u7B97\u89C4\u5219",
        tier: "full",
        execute: /* @__PURE__ */ __name(async (service, ctx) => {
          try {
            const synced = await service.syncSpBudgetRules();
            return { success: true, synced, errors: [] };
          } catch (e) {
            return { success: false, synced: 0, errors: [e.message] };
          }
        }, "execute")
      },
      // @ts-ignore
      {
        id: "performance_95d",
        name: "95\u5929\u7EE9\u6548\u56DE\u6EAF",
        tier: "full",
        execute: /* @__PURE__ */ __name(async (service, ctx) => {
          try {
            const synced = await service.syncPerformanceData(95);
            return { success: true, synced, errors: [] };
          } catch (e) {
            return { success: false, synced: 0, errors: [e.message] };
          }
        }, "execute")
        // @ts-ignore
      },
      {
        id: "keyword_performance",
        name: "\u5173\u952E\u8BCD\u7EE9\u6548",
        tier: "nightly",
        // v403: 从 full 迁移到 nightly，避免 full 层级超时
        execute: /* @__PURE__ */ __name(async (service, ctx) => {
          try {
            const synced = await service.syncKeywordPerformanceData(95);
            return { success: true, synced, errors: [] };
          } catch (e) {
            return { success: false, synced: 0, errors: [e.message] };
          }
        }, "execute")
      },
      {
        id: "target_performance",
        name: "\u5B9A\u4F4D\u7EE9\u6548",
        tier: "nightly",
        // v403: 从 full 迁移到 nightly，避免 full 层级超时
        execute: /* @__PURE__ */ __name(async (service, ctx) => {
          try {
            const synced = await service.syncProductTargetPerformanceData(95);
            return { success: true, synced, errors: [] };
          } catch (e) {
            return { success: false, synced: 0, errors: [e.message] };
          }
        }, "execute")
      },
      {
        id: "ad_group_performance",
        name: "\u5E7F\u544A\u7EC4\u7EE9\u6548",
        tier: "nightly",
        // v403: 从 full 迁移到 nightly，避免 full 层级超时
        execute: /* @__PURE__ */ __name(async (service, ctx) => {
          try {
            const synced = await service.syncAdGroupPerformanceData(95);
            return { success: true, synced, errors: [] };
          } catch (e) {
            return { success: false, synced: 0, errors: [e.message] };
          }
        }, "execute")
      }
    ];
    TIER_HIERARCHY = {
      high: ["high"],
      // 高频：只执行high专有步骤
      medium: ["medium"],
      // 中频：只执行medium专有步骤（不再重复high层）
      full: ["high", "medium", "full"],
      // 完整：执行所有层级步骤
      nightly: ["nightly"],
      // v403: 夜间层级：耗时最长的绩效报表（关键词/定位/广告组绩效）
      confirmation: ["high", "medium"]
      // v380: 确认同步覆盖high+medium层，确保ad_groups/keywords/targets变更能被确认
    };
    engineStatus = {
      isRunning: false,
      lastSyncTime: { high: null, medium: null, full: null, nightly: null, confirmation: null },
      nextSyncTime: { high: null, medium: null, full: null, nightly: null, confirmation: null },
      totalSyncsCompleted: 0,
      totalSyncsFailed: 0,
      currentlyRunning: [],
      recentErrors: [],
      discoveredAccounts: 0
    };
    MAX_CONCURRENT_ACCOUNTS = parseInt(process.env.MAX_CONCURRENT_ACCOUNTS || "15", 10);
    activeSyncs = /* @__PURE__ */ new Map();
    HEARTBEAT_ZOMBIE_TIMEOUT_MS = 30 * 60 * 1e3;
    MAX_ABSOLUTE_TIMEOUT_MS = 6 * 60 * 60 * 1e3;
    DEFAULT_SYNC_TIMEOUT_MS = 90 * 60 * 1e3;
    LARGE_ACCOUNT_TIMEOUT_TIERS = [
      { threshold: 5e3, timeoutMs: 180 * 60 * 1e3 },
      // 5000+广告活动: 3小时
      { threshold: 3e3, timeoutMs: 150 * 60 * 1e3 },
      // 3000-5000: 2.5小时
      { threshold: 1e3, timeoutMs: 120 * 60 * 1e3 }
      // 1000-3000: 2小时
    ];
    NIGHTLY_SYNC_TIMEOUT_MS = 4 * 60 * 60 * 1e3;
    __name(getRateController, "getRateController");
    __name(discoverSyncableAccounts, "discoverSyncableAccounts");
    __name(getStepsForTier, "getStepsForTier");
    __name(syncAccount, "syncAccount");
    __name(interleaveAccountsByUser, "interleaveAccountsByUser");
    __name(syncAllAccounts, "syncAllAccounts");
    __name(confirmationSync, "confirmationSync");
    __name(getEngineStatus, "getEngineStatus");
    __name(getDistributedWorkerInfo, "getDistributedWorkerInfo");
    __name(shutdownDistributedWorker, "shutdownDistributedWorker");
    __name(getAllSyncSteps, "getAllSyncSteps");
    __name(recordBatchSyncResult, "recordBatchSyncResult");
    __name(triggerManualFullSync, "triggerManualFullSync");
    __name(isAccountSyncing, "isAccountSyncing");
    __name(getAccountSyncStatus, "getAccountSyncStatus");
    __name(sleep3, "sleep");
  }
});

