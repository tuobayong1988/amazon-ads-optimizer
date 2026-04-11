// Extracted from production dist/index.js
// Original module: server/sync/syncCoordinator.ts
// Lines: 116

function acquireGlobalMutex(tier2) {
  if (globalMutex.activeTier !== null) {
    const elapsed = Date.now() - (globalMutex.startedAt?.getTime() || 0);
    if (elapsed > GLOBAL_MUTEX_TIMEOUT_MS) {
      log71.info(`[v574] \u5168\u5C40\u4E92\u65A5\u9501\u8D85\u65F6\uFF08${globalMutex.activeTier}\u5C42\u5DF2\u8FD0\u884C${(elapsed / 6e4).toFixed(1)}\u5206\u949F\uFF09\uFF0C\u5F3A\u5236\u91CA\u653E`);
      releaseGlobalMutex(globalMutex.activeTier);
    } else {
      log71.warn(`[v574-enhanced] \u5168\u5C40\u4E92\u65A5\u9501\u88AB\u5360\u7528: ${globalMutex.activeTier}\u5C42\u6B63\u5728\u8FD0\u884C\uFF08${(elapsed / 6e4).toFixed(1)}\u5206\u949F\uFF09\uFF0C${tier2}\u5C42\u7B49\u5F85. \u8D85\u65F6\u91CA\u653E\u9608\u503C=30\u5206\u949F`);
      return false;
    }
  }
  globalMutex.activeTier = tier2;
  globalMutex.startedAt = /* @__PURE__ */ new Date();
  globalMutex.pausedByManual = false;
  log71.info(`[v488] \u5168\u5C40\u4E92\u65A5\u9501\u5DF2\u83B7\u53D6: ${tier2}\u5C42`);
  return true;
}
function releaseGlobalMutex(tier2) {
  if (globalMutex.activeTier === tier2) {
    const elapsed = globalMutex.startedAt ? Date.now() - globalMutex.startedAt.getTime() : 0;
    log71.info(`[v488] \u5168\u5C40\u4E92\u65A5\u9501\u5DF2\u91CA\u653E: ${tier2}\u5C42\uFF08\u8FD0\u884C\u4E86${(elapsed / 6e4).toFixed(1)}\u5206\u949F\uFF09`);
    globalMutex.activeTier = null;
    globalMutex.startedAt = null;
    globalMutex.pausedByManual = false;
  }
}
async function cleanupExpiredOverrides() {
  const now = Date.now();
  for (const [accountId, state] of manualOverrides) {
    const elapsed = now - state.triggeredAt.getTime();
    if (elapsed > MANUAL_OVERRIDE_MAX_DURATION_MS) {
      log71.warn(`[v579] \u624B\u52A8\u8986\u76D6\u8D85\u65F6: \u8D26\u6237${accountId}\uFF08${(elapsed / 6e4).toFixed(1)}\u5206\u949F\uFF09\uFF0C\u81EA\u52A8\u6E05\u7406`);
      state.abortController.abort();
      manualOverrides.delete(accountId);
    }
  }
  for (const [accountId, lock] of accountLocks) {
    const elapsed = now - lock.acquiredAt.getTime();
    if (elapsed > ACCOUNT_LOCK_TIMEOUT_MS) {
      log71.warn(`[v579] \u8D26\u6237\u9501\u8D85\u65F6: \u8D26\u6237${accountId}\u7684${lock.lockType}\u9501\uFF08${(elapsed / 6e4).toFixed(1)}\u5206\u949F\uFF09\uFF0C\u81EA\u52A8\u6E05\u7406`);
      accountLocks.delete(accountId);
    }
  }
  if (globalMutex.activeTier !== null && globalMutex.startedAt) {
    const elapsed = now - globalMutex.startedAt.getTime();
    if (elapsed > GLOBAL_MUTEX_TIMEOUT_MS) {
      log71.warn(`[v579] \u5168\u5C40\u4E92\u65A5\u9501\u8D85\u65F6\u6E05\u7406: ${globalMutex.activeTier}\u5C42\uFF08${(elapsed / 6e4).toFixed(1)}\u5206\u949F\uFF09`);
      globalMutex.activeTier = null;
      globalMutex.startedAt = null;
      globalMutex.pausedByManual = false;
    }
  }
}
function getCoordinatorStatus() {
  const now = Date.now();
  const overrideList = Array.from(manualOverrides.entries()).map(([accountId, state]) => ({
    accountId,
    syncType: state.syncType,
    phase: state.syncRunning ? "executing" : state.coolingCompleted ? "completed" : "cooling",
    elapsedMs: now - state.triggeredAt.getTime(),
    triggerSource: state.triggerSource
  }));
  const accountLockList = Array.from(accountLocks.entries()).map(([accountId, lock]) => ({
    accountId,
    lockType: lock.lockType,
    tier: lock.tier,
    elapsedMs: now - lock.acquiredAt.getTime()
  }));
  const avgCooling = stats.coolingDurations.length > 0 ? stats.coolingDurations.reduce((a, b) => a + b, 0) / stats.coolingDurations.length : 0;
  return {
    manualOverrides: overrideList,
    globalMutex: { ...globalMutex },
    accountLocks: accountLockList,
    pausedAutoSyncCount: manualOverrides.size,
    stats: {
      totalManualOverrides: stats.totalManualOverrides,
      totalCoolingPeriods: stats.totalCoolingPeriods,
      totalAutoSyncsPaused: stats.totalAutoSyncsPaused,
      totalAutoSyncsResumed: stats.totalAutoSyncsResumed,
      avgCoolingDurationMs: Math.round(avgCooling)
    }
  };
}
var log71, manualOverrides, globalMutex, accountLocks, stats, GLOBAL_MUTEX_TIMEOUT_MS, ACCOUNT_LOCK_TIMEOUT_MS, MANUAL_OVERRIDE_MAX_DURATION_MS, COOLING_PERIOD_MAX_MS, COOLING_POLL_INTERVAL_MS, POST_CLEANUP_WAIT_MS;
var init_syncCoordinator = __esm({
  "server/sync/syncCoordinator.ts"() {
    "use strict";
    init_logger();
    log71 = createModuleLogger("SyncCoordinator");
    manualOverrides = /* @__PURE__ */ new Map();
    globalMutex = {
      activeTier: null,
      startedAt: null,
      pausedByManual: false
    };
    accountLocks = /* @__PURE__ */ new Map();
    stats = {
      totalManualOverrides: 0,
      totalCoolingPeriods: 0,
      totalAutoSyncsPaused: 0,
      totalAutoSyncsResumed: 0,
      coolingDurations: []
    };
    GLOBAL_MUTEX_TIMEOUT_MS = 30 * 60 * 1e3;
    ACCOUNT_LOCK_TIMEOUT_MS = 15 * 60 * 1e3;
    MANUAL_OVERRIDE_MAX_DURATION_MS = 2 * 60 * 60 * 1e3;
    COOLING_PERIOD_MAX_MS = 60 * 1e3;
    COOLING_POLL_INTERVAL_MS = 2 * 1e3;
    POST_CLEANUP_WAIT_MS = 3 * 1e3;
    __name(acquireGlobalMutex, "acquireGlobalMutex");
    __name(releaseGlobalMutex, "releaseGlobalMutex");
    __name(cleanupExpiredOverrides, "cleanupExpiredOverrides");
    __name(getCoordinatorStatus, "getCoordinatorStatus");
  }
});

