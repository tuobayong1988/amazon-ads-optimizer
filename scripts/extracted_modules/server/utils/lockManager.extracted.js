// Extracted from production dist/index.js
// Original module: server/utils/lockManager.ts
// Lines: 178

function getModuleLockGroup(specificModules) {
  if (!specificModules || specificModules.length === 0) return "all";
  if (specificModules.includes("bid")) return "bid";
  if (specificModules.includes("keyword")) return "keyword";
  if (specificModules.includes("dayparting") || specificModules.includes("multidim")) return "dayparting";
  if (specificModules.includes("dayparting_budget")) return "dayparting_budget";
  if (specificModules.includes("placement")) return "placement";
  if (specificModules.includes("searchterm")) return "searchterm";
  if (specificModules.includes("budget")) return "budget";
  return "all";
}
function acquireMemoryLock(lockKey, lockedBy, options) {
  const timeoutMs = Math.min(options?.timeoutMs || DEFAULT_LOCK_TIMEOUT_MS, MAX_LOCK_TIMEOUT_MS);
  if (!accountModuleLocks[lockKey]) {
    accountModuleLocks[lockKey] = {
      locked: false,
      lockedBy: "",
      lockedAt: null,
      expectedDurationMs: DEFAULT_LOCK_TIMEOUT_MS
    };
  }
  const lock = accountModuleLocks[lockKey];
  if (lock.locked) {
    const lockAge = lock.lockedAt ? Date.now() - lock.lockedAt.getTime() : 0;
    const effectiveTimeout = Math.max(lock.expectedDurationMs * 2, timeoutMs);
    if (lockAge > effectiveTimeout) {
      log70.warn(`[LockManager] ${lockKey} \u4F18\u5316\u9501\u8D85\u65F6 ${Math.round(lockAge / 1e3)}\u79D2 (\u9650\u5236: ${Math.round(effectiveTimeout / 1e3)}\u79D2)\uFF0C\u5F3A\u5236\u91CA\u653E (lockedBy: ${lock.lockedBy})`);
      recordLockEvent(lockKey, "timeout_release", lock.lockedBy, lockAge);
    } else {
      log70.info(`[LockManager] ${lockKey} \u4F18\u5316\u9501\u5DF2\u88AB ${lock.lockedBy} \u6301\u6709 ${Math.round(lockAge / 1e3)}\u79D2\uFF0C${lockedBy} \u8DF3\u8FC7`);
      return false;
    }
  }
  lock.locked = true;
  lock.lockedBy = lockedBy;
  lock.lockedAt = /* @__PURE__ */ new Date();
  lock.expectedDurationMs = options?.expectedDurationMs || DEFAULT_LOCK_TIMEOUT_MS;
  return true;
}
function releaseMemoryLock(lockKey) {
  if (accountModuleLocks[lockKey]) {
    accountModuleLocks[lockKey].locked = false;
    accountModuleLocks[lockKey].lockedBy = "";
    accountModuleLocks[lockKey].lockedAt = null;
  }
}
async function acquireRedisOrMySQLLock(lockKey, timeoutMs) {
  try {
    const { RedisDistributedLock: RedisDistributedLock2 } = await Promise.resolve().then(() => (init_redisDistributedLock(), redisDistributedLock_exports));
    const redisLock = new RedisDistributedLock2(`opt_${lockKey}`);
    const release = await redisLock.tryAcquire(timeoutMs);
    if (release) {
      log70.debug(`[LockManager] ${lockKey} Redis\u5206\u5E03\u5F0F\u9501\u83B7\u53D6\u6210\u529F`);
      return release;
    }
    return null;
  } catch (e) {
    log70.debug(`[LockManager] ${lockKey} Redis\u9501\u4E0D\u53EF\u7528: ${e.message}\uFF0C\u964D\u7EA7\u5230MySQL\u9501`);
  }
  try {
    const { DistributedLock: DistributedLock2 } = await Promise.resolve().then(() => (init_distributedLock(), distributedLock_exports));
    const mysqlLock = new DistributedLock2(`opt_${lockKey}`);
    const release = await mysqlLock.tryAcquire(timeoutMs);
    if (release) {
      log70.debug(`[LockManager] ${lockKey} MySQL\u5206\u5E03\u5F0F\u9501\u83B7\u53D6\u6210\u529F`);
      return release;
    }
    return null;
  } catch (e) {
    log70.debug(`[LockManager] ${lockKey} MySQL\u9501\u4E5F\u4E0D\u53EF\u7528: ${e.message}\uFF0C\u964D\u7EA7\u5230\u4EC5\u5185\u5B58\u9501`);
    return async () => {
    };
  }
}
async function acquireAccountOptimizationLock(accountId, lockedBy, moduleGroup, options) {
  const group = moduleGroup || "all";
  const lockKey = `${accountId}:${group}`;
  if (!acquireMemoryLock(lockKey, lockedBy, options)) {
    return false;
  }
  try {
    const timeoutMs = options?.expectedDurationMs || DEFAULT_LOCK_TIMEOUT_MS;
    const release = await acquireRedisOrMySQLLock(lockKey, timeoutMs);
    if (release === null) {
      releaseMemoryLock(lockKey);
      log70.info(`[LockManager] ${lockKey} \u5206\u5E03\u5F0F\u9501\u5DF2\u88AB\u5176\u4ED6\u5B9E\u4F8B\u6301\u6709\uFF0C${lockedBy} \u8DF3\u8FC7`);
      return false;
    }
    distributedLockReleases.set(lockKey, release);
  } catch (e) {
    log70.debug(`[LockManager] ${lockKey} \u5206\u5E03\u5F0F\u9501\u964D\u7EA7: ${e.message}`);
  }
  recordLockEvent(lockKey, "acquired", lockedBy, 0);
  log70.debug(`[LockManager] ${lockKey} \u6DF7\u5408\u9501\u83B7\u53D6\u6210\u529F by ${lockedBy}`);
  return true;
}
async function releaseAccountOptimizationLock(accountId, moduleGroup) {
  const group = moduleGroup || "all";
  const lockKey = `${accountId}:${group}`;
  if (accountModuleLocks[lockKey]) {
    const holdTime = accountModuleLocks[lockKey].lockedAt ? Date.now() - accountModuleLocks[lockKey].lockedAt.getTime() : 0;
    recordLockEvent(lockKey, "released", accountModuleLocks[lockKey].lockedBy, holdTime);
  }
  releaseMemoryLock(lockKey);
  try {
    const release = distributedLockReleases?.get(lockKey);
    if (release) {
      await release();
      distributedLockReleases.delete(lockKey);
    }
  } catch (e) {
    log70.debug(`[LockManager] ${lockKey} \u91CA\u653E\u5206\u5E03\u5F0F\u9501\u5931\u8D25: ${e.message}`);
  }
}
async function acquireAccountOptimizationLockWithRetry(accountId, lockedBy, moduleGroup, maxRetries = 3, retryDelayMs = 1e4) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (await acquireAccountOptimizationLock(accountId, lockedBy, moduleGroup)) {
      if (attempt > 0) {
        log70.debug(`[LockManager] ${accountId}:${moduleGroup || "all"} \u7B2C${attempt + 1}\u6B21\u5C1D\u8BD5\u83B7\u53D6\u9501\u6210\u529F (${lockedBy})`);
      }
      return true;
    }
    if (attempt < maxRetries) {
      const jitter = Math.random() * 2e3;
      const delay2 = retryDelayMs * Math.pow(1.5, attempt) + jitter;
      log70.debug(`[LockManager] ${accountId}:${moduleGroup || "all"} \u9501\u88AB\u5360\u7528\uFF0C${Math.round(delay2 / 1e3)}\u79D2\u540E\u91CD\u8BD5 (${attempt + 1}/${maxRetries})`);
      await new Promise((resolve) => setTimeout(resolve, delay2));
    }
  }
  return false;
}
function recordLockEvent(lockKey, action, lockedBy, holdTimeMs) {
  lockEvents.push({ timestamp: /* @__PURE__ */ new Date(), lockKey, action, lockedBy, holdTimeMs });
  if (lockEvents.length > MAX_LOCK_EVENTS) {
    lockEvents.splice(0, lockEvents.length - MAX_LOCK_EVENTS);
  }
}
var log70, accountModuleLocks, distributedLockReleases, DEFAULT_LOCK_TIMEOUT_MS, MAX_LOCK_TIMEOUT_MS, distributedLockConnections, DIST_LOCK_CLEANUP_INTERVAL_MS, lockEvents, MAX_LOCK_EVENTS;
var init_lockManager = __esm({
  "server/utils/lockManager.ts"() {
    "use strict";
    init_logger();
    log70 = createModuleLogger("LockManager");
    accountModuleLocks = {};
    distributedLockReleases = /* @__PURE__ */ new Map();
    DEFAULT_LOCK_TIMEOUT_MS = 10 * 60 * 1e3;
    MAX_LOCK_TIMEOUT_MS = 30 * 60 * 1e3;
    __name(getModuleLockGroup, "getModuleLockGroup");
    __name(acquireMemoryLock, "acquireMemoryLock");
    __name(releaseMemoryLock, "releaseMemoryLock");
    __name(acquireRedisOrMySQLLock, "acquireRedisOrMySQLLock");
    __name(acquireAccountOptimizationLock, "acquireAccountOptimizationLock");
    __name(releaseAccountOptimizationLock, "releaseAccountOptimizationLock");
    __name(acquireAccountOptimizationLockWithRetry, "acquireAccountOptimizationLockWithRetry");
    distributedLockConnections = /* @__PURE__ */ new Map();
    DIST_LOCK_CLEANUP_INTERVAL_MS = 5 * 60 * 1e3;
    setInterval(async () => {
      if (distributedLockConnections.size === 0) return;
      log70.debug(`[DistLock] \u6E05\u7406\u68C0\u67E5: ${distributedLockConnections.size} \u4E2A\u6D3B\u8DC3\u9501\u8FDE\u63A5`);
      for (const [lockName, conn] of distributedLockConnections.entries()) {
        try {
          await conn.ping();
        } catch (e) {
          log70.warn(`[DistLock] \u6E05\u7406\u65E0\u6548\u9501\u8FDE\u63A5: ${lockName}`);
          distributedLockConnections.delete(lockName);
          try {
            conn.release();
          } catch (_) {
          }
        }
      }
    }, DIST_LOCK_CLEANUP_INTERVAL_MS);
    lockEvents = [];
    MAX_LOCK_EVENTS = 200;
    __name(recordLockEvent, "recordLockEvent");
  }
});

