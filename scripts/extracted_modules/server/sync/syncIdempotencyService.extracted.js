// Extracted from production dist/index.js
// Original module: server/sync/syncIdempotencyService.ts
// Lines: 185

var syncIdempotencyService_exports = {};
__export(syncIdempotencyService_exports, {
  acquireSyncLock: () => acquireSyncLock,
  clearPerformanceDataForFullSync: () => clearPerformanceDataForFullSync,
  executeWithIdempotency: () => executeWithIdempotency,
  getActiveSyncLocks: () => getActiveSyncLocks,
  getDynamicLockTimeout: () => getDynamicLockTimeout,
  isSyncLocked: () => isSyncLocked,
  releaseSyncLock: () => releaseSyncLock,
  setLockMode: () => setLockMode
});
function setLockMode(mode) {
  currentLockMode = mode;
  log169.info(`[v358] \u9501\u6A21\u5F0F\u8BBE\u7F6E\u4E3A: ${mode}`);
}
function getDynamicLockTimeout(campaignCount, tier2) {
  if (tier2 === "nightly") return 4 * 60 * 60 * 1e3;
  if (campaignCount >= 5e3) return 120 * 60 * 1e3;
  if (campaignCount >= 3e3) return 105 * 60 * 1e3;
  if (campaignCount >= 1e3) return 90 * 60 * 1e3;
  return DEFAULT_LOCK_TIMEOUT_MS2;
}
function getLockKey(accountId, syncType = "all") {
  return `sync:${accountId}:${syncType}`;
}
function acquireMemoryLock2(accountId, syncType = "all") {
  const key = getLockKey(accountId, syncType);
  const existing = syncLocks2.get(key);
  if (existing) {
    if (/* @__PURE__ */ new Date() > existing.expiresAt) {
      log169.warn(`[SyncLock] \u5185\u5B58\u9501\u5DF2\u8D85\u65F6\uFF0C\u5F3A\u5236\u91CA\u653E: ${key}`);
      syncLocks2.delete(key);
    } else {
      log169.info(`[SyncLock] \u5185\u5B58\u9501\u88AB\u5360\u7528: ${key}`);
      return null;
    }
  }
  const lockId = `lock_${accountId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const now = /* @__PURE__ */ new Date();
  syncLocks2.set(key, {
    lockId,
    accountId,
    syncType,
    acquiredAt: now,
    expiresAt: new Date(now.getTime() + DEFAULT_LOCK_TIMEOUT_MS2)
  });
  return lockId;
}
function releaseMemoryLock2(accountId, syncType = "all", lockId) {
  const key = getLockKey(accountId, syncType);
  const existing = syncLocks2.get(key);
  if (!existing) return true;
  if (lockId && existing.lockId !== lockId) return false;
  syncLocks2.delete(key);
  return true;
}
function isMemoryLocked(accountId, syncType = "all") {
  const key = getLockKey(accountId, syncType);
  const existing = syncLocks2.get(key);
  if (!existing) return false;
  if (/* @__PURE__ */ new Date() > existing.expiresAt) {
    syncLocks2.delete(key);
    return false;
  }
  return true;
}
async function acquireSyncLock(accountId, syncType = "all", dynamicTimeoutMs) {
  const lockKey = getLockKey(accountId, syncType);
  const timeoutMs = dynamicTimeoutMs || DEFAULT_LOCK_TIMEOUT_MS2;
  if (currentLockMode === "memory") {
    return acquireMemoryLock2(accountId, syncType);
  }
  try {
    const holderId = `${PROCESS_ID}:${lockKey}`;
    const acquired = await acquireLock2(lockKey, holderId, timeoutMs);
    if (acquired) {
      log169.info(`[v358] \u5206\u5E03\u5F0F\u9501\u5DF2\u83B7\u53D6: ${lockKey}`);
      acquireMemoryLock2(accountId, syncType);
      return holderId;
    } else {
      log169.info(`[v358] \u5206\u5E03\u5F0F\u9501\u88AB\u5360\u7528: ${lockKey}`);
      return null;
    }
  } catch (error48) {
    if (currentLockMode === "auto") {
      log169.warn(`[v358] \u5206\u5E03\u5F0F\u9501\u83B7\u53D6\u5931\u8D25(${error48.message})\uFF0C\u964D\u7EA7\u5230\u5185\u5B58\u9501`);
      return acquireMemoryLock2(accountId, syncType);
    }
    log169.warn(`[v358] \u5206\u5E03\u5F0F\u9501\u83B7\u53D6\u5931\u8D25: ${error48.message}`);
    return null;
  }
}
async function releaseSyncLock(accountId, syncType = "all", lockId) {
  const lockKey = getLockKey(accountId, syncType);
  releaseMemoryLock2(accountId, syncType, lockId);
  if (currentLockMode === "memory") {
    return true;
  }
  try {
    const holderId = lockId || `${PROCESS_ID}:${lockKey}`;
    await releaseLock3(lockKey, holderId);
    log169.info(`[v358] \u5206\u5E03\u5F0F\u9501\u5DF2\u91CA\u653E: ${lockKey}`);
    return true;
  } catch (error48) {
    log169.warn(`[v358] \u5206\u5E03\u5F0F\u9501\u91CA\u653E\u5931\u8D25(${error48.message})\uFF0C\u5185\u5B58\u9501\u5DF2\u91CA\u653E`);
    return true;
  }
}
function isSyncLocked(accountId, syncType = "all") {
  return isMemoryLocked(accountId, syncType);
}
function getActiveSyncLocks() {
  const now = /* @__PURE__ */ new Date();
  const active = [];
  for (const [key, lock] of syncLocks2.entries()) {
    if (now > lock.expiresAt) {
      syncLocks2.delete(key);
    } else {
      active.push(lock);
    }
  }
  return active;
}
async function clearPerformanceDataForFullSync(accountId, startDate, endDate) {
  log169.info(`[SyncIdempotency] \u6E05\u9664\u65E7\u7EE9\u6548\u6570\u636E: accountId=${accountId}, ${startDate} ~ ${endDate}`);
  try {
    const deletedCount = await deleteDailyPerformanceByDateRange(
      accountId,
      startDate,
      endDate
    );
    log169.info(`[SyncIdempotency] \u5DF2\u6E05\u9664 ${deletedCount} \u6761\u65E7\u7EE9\u6548\u6570\u636E`);
    return deletedCount;
  } catch (error48) {
    log169.warn(`[SyncIdempotency] \u6E05\u9664\u65E7\u7EE9\u6548\u6570\u636E\u5931\u8D25:`, error48);
    return 0;
  }
}
async function executeWithIdempotency(accountId, syncType, syncFn) {
  const lockId = await acquireSyncLock(accountId, syncType);
  if (!lockId) {
    return {
      success: false,
      locked: true,
      error: `\u8D26\u53F7 ${accountId} \u7684 ${syncType} \u540C\u6B65\u6B63\u5728\u8FDB\u884C\u4E2D\uFF0C\u8BF7\u7A0D\u540E\u518D\u8BD5`
    };
  }
  try {
    const result = await syncFn();
    return { success: true, result };
  } catch (error48) {
    log169.warn(`[SyncIdempotency] \u540C\u6B65\u6267\u884C\u5931\u8D25: accountId=${accountId}, syncType=${syncType}`, error48);
    return { success: false, error: error48.message };
  } finally {
    await releaseSyncLock(accountId, syncType, lockId);
  }
}
var import_crypto6, log169, currentLockMode, PROCESS_ID, syncLocks2, DEFAULT_LOCK_TIMEOUT_MS2;
var init_syncIdempotencyService = __esm({
  "server/sync/syncIdempotencyService.ts"() {
    "use strict";
    init_logger();
    init_db2();
    init_shardManager();
    import_crypto6 = require("crypto");
    log169 = createModuleLogger("SyncIdempotencyService");
    currentLockMode = "auto";
    PROCESS_ID = `proc-${(0, import_crypto6.randomUUID)().slice(0, 8)}`;
    __name(setLockMode, "setLockMode");
    syncLocks2 = /* @__PURE__ */ new Map();
    DEFAULT_LOCK_TIMEOUT_MS2 = 60 * 60 * 1e3;
    __name(getDynamicLockTimeout, "getDynamicLockTimeout");
    __name(getLockKey, "getLockKey");
    __name(acquireMemoryLock2, "acquireMemoryLock");
    __name(releaseMemoryLock2, "releaseMemoryLock");
    __name(isMemoryLocked, "isMemoryLocked");
    __name(acquireSyncLock, "acquireSyncLock");
    __name(releaseSyncLock, "releaseSyncLock");
    __name(isSyncLocked, "isSyncLocked");
    __name(getActiveSyncLocks, "getActiveSyncLocks");
    __name(clearPerformanceDataForFullSync, "clearPerformanceDataForFullSync");
    __name(executeWithIdempotency, "executeWithIdempotency");
  }
});

