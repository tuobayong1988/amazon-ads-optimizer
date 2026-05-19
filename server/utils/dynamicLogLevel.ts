// @ts-nocheck
/**
 * server/utils/dynamicLogLevel.ts
 * 
 * Auto-converted from production bundle to TypeScript source.
 * Version: v621147 (production)
 */



export function shouldEnableDebug(moduleName, accountId) {
  const now = Date.now();
  if (_cachedOverrides.global === "DEBUG") return true;
  if (moduleName && _cachedOverrides.modules.has(moduleName)) return true;
  if (accountId && _cachedOverrides.accounts.has(accountId)) return true;
  if (moduleName) {
    const moduleOverride = memoryOverrides.modules.get(moduleName);
    if (moduleOverride && moduleOverride.enabled && moduleOverride.expiresAt > now) return true;
  }
  if (accountId) {
    const accountOverride = memoryOverrides.accounts.get(accountId);
    if (accountOverride && accountOverride.enabled && accountOverride.expiresAt > now) return true;
  }
  return false;
}
export async function setModuleDebug(moduleName, ttlSeconds = 600) {
  const safeTtl = Math.min(Math.max(ttlSeconds, 30), 3600);
  try {
    const { getRedis: getRedis2, isRedisAvailable: isRedisAvailable2 } = await Promise.resolve().then(() => (init_redisClient(), redisClient_exports));
    if (isRedisAvailable2()) {
      const redis = getRedis2();
      if (redis) {
        await redis.set(`${KEY_MODULE_PREFIX}${moduleName}`, "1", "EX", safeTtl);
        _cachedOverrides.modules.add(moduleName);
        log3.info(`\u6A21\u5757 DEBUG \u5DF2\u5F00\u542F: ${moduleName}, TTL=${safeTtl}s`);
        return true;
      }
    }
  } catch (err) {
    log3.warn(`Redis \u8BBE\u7F6E\u6A21\u5757 DEBUG \u5931\u8D25: ${err.message}`);
  }
  memoryOverrides.modules.set(moduleName, {
    enabled: true,
    expiresAt: Date.now() + safeTtl * 1e3
  });
  _cachedOverrides.modules.add(moduleName);
  log3.info(`\u6A21\u5757 DEBUG \u5DF2\u5F00\u542F(\u5185\u5B58\u6A21\u5F0F): ${moduleName}, TTL=${safeTtl}s`);
  return true;
}
export async function clearModuleDebug(moduleName) {
  try {
    const { getRedis: getRedis2, isRedisAvailable: isRedisAvailable2 } = await Promise.resolve().then(() => (init_redisClient(), redisClient_exports));
    if (isRedisAvailable2()) {
      const redis = getRedis2();
      if (redis) {
        await redis.del(`${KEY_MODULE_PREFIX}${moduleName}`);
      }
    }
  } catch {
  }
  memoryOverrides.modules.delete(moduleName);
  _cachedOverrides.modules.delete(moduleName);
  log3.info(`\u6A21\u5757 DEBUG \u5DF2\u5173\u95ED: ${moduleName}`);
  return true;
}
export async function setAccountDebug(accountId, ttlSeconds = 1800) {
  const safeTtl = Math.min(Math.max(ttlSeconds, 30), 7200);
  try {
    const { getRedis: getRedis2, isRedisAvailable: isRedisAvailable2 } = await Promise.resolve().then(() => (init_redisClient(), redisClient_exports));
    if (isRedisAvailable2()) {
      const redis = getRedis2();
      if (redis) {
        await redis.set(`${KEY_ACCOUNT_PREFIX}${accountId}`, "1", "EX", safeTtl);
        _cachedOverrides.accounts.add(accountId);
        log3.info(`\u8D26\u6237 DEBUG \u5DF2\u5F00\u542F: ${accountId}, TTL=${safeTtl}s`);
        return true;
      }
    }
  } catch (err) {
    log3.warn(`Redis \u8BBE\u7F6E\u8D26\u6237 DEBUG \u5931\u8D25: ${err.message}`);
  }
  memoryOverrides.accounts.set(accountId, {
    enabled: true,
    expiresAt: Date.now() + safeTtl * 1e3
  });
  _cachedOverrides.accounts.add(accountId);
  log3.info(`\u8D26\u6237 DEBUG \u5DF2\u5F00\u542F(\u5185\u5B58\u6A21\u5F0F): ${accountId}, TTL=${safeTtl}s`);
  return true;
}
export async function clearAccountDebug(accountId) {
  try {
    const { getRedis: getRedis2, isRedisAvailable: isRedisAvailable2 } = await Promise.resolve().then(() => (init_redisClient(), redisClient_exports));
    if (isRedisAvailable2()) {
      const redis = getRedis2();
      if (redis) {
        await redis.del(`${KEY_ACCOUNT_PREFIX}${accountId}`);
      }
    }
  } catch {
  }
  memoryOverrides.accounts.delete(accountId);
  _cachedOverrides.accounts.delete(accountId);
  log3.info(`\u8D26\u6237 DEBUG \u5DF2\u5173\u95ED: ${accountId}`);
  return true;
}
export async function setGlobalLevel(level, ttlSeconds = 300) {
  const validLevels = ["DEBUG", "INFO", "WARN"];
  const upperLevel = level.toUpperCase();
  if (!validLevels.includes(upperLevel)) {
    log3.warn(`\u65E0\u6548\u7684\u65E5\u5FD7\u7EA7\u522B: ${level}`);
    return false;
  }
  const safeTtl = Math.min(Math.max(ttlSeconds, 30), 1800);
  try {
    const { getRedis: getRedis2, isRedisAvailable: isRedisAvailable2 } = await Promise.resolve().then(() => (init_redisClient(), redisClient_exports));
    if (isRedisAvailable2()) {
      const redis = getRedis2();
      if (redis) {
        await redis.set(KEY_GLOBAL, upperLevel, "EX", safeTtl);
        _cachedOverrides.global = upperLevel;
        log3.info(`\u5168\u5C40\u65E5\u5FD7\u7EA7\u522B\u5DF2\u8BBE\u7F6E: ${upperLevel}, TTL=${safeTtl}s`);
        return true;
      }
    }
  } catch (err) {
    log3.warn(`Redis \u8BBE\u7F6E\u5168\u5C40\u7EA7\u522B\u5931\u8D25: ${err.message}`);
  }
  memoryOverrides.global = upperLevel;
  _cachedOverrides.global = upperLevel;
  setTimeout(() => {
    if (memoryOverrides.global === upperLevel) {
      memoryOverrides.global = null;
      _cachedOverrides.global = null;
      log3.info(`\u5168\u5C40\u65E5\u5FD7\u7EA7\u522B\u8986\u76D6\u5DF2\u8FC7\u671F(\u5185\u5B58\u6A21\u5F0F)`);
    }
  }, safeTtl * 1e3);
  log3.info(`\u5168\u5C40\u65E5\u5FD7\u7EA7\u522B\u5DF2\u8BBE\u7F6E(\u5185\u5B58\u6A21\u5F0F): ${upperLevel}, TTL=${safeTtl}s`);
  return true;
}
export async function clearGlobalLevel() {
  try {
    const { getRedis: getRedis2, isRedisAvailable: isRedisAvailable2 } = await Promise.resolve().then(() => (init_redisClient(), redisClient_exports));
    if (isRedisAvailable2()) {
      const redis = getRedis2();
      if (redis) {
        await redis.del(KEY_GLOBAL);
      }
    }
  } catch {
  }
  memoryOverrides.global = null;
  _cachedOverrides.global = null;
  log3.info(`\u5168\u5C40\u65E5\u5FD7\u7EA7\u522B\u8986\u76D6\u5DF2\u6E05\u9664`);
  return true;
}
export async function getDynamicLogStatus() {
  const result = {
    global: null,
    modules: [],
    accounts: [],
    source: "memory"
  };
  try {
    const { getRedis: getRedis2, isRedisAvailable: isRedisAvailable2 } = await Promise.resolve().then(() => (init_redisClient(), redisClient_exports));
    if (isRedisAvailable2()) {
      const redis = getRedis2();
      if (redis) {
        result.source = "redis";
        result.global = await redis.get(KEY_GLOBAL);
        const moduleKeys = await redis.keys(`${KEY_MODULE_PREFIX}*`);
        for (const key of moduleKeys) {
          const moduleName = key.replace(KEY_MODULE_PREFIX, "");
          const ttl = await redis.ttl(key);
          result.modules.push({ name: moduleName, ttl });
        }
        const accountKeys = await redis.keys(`${KEY_ACCOUNT_PREFIX}*`);
        for (const key of accountKeys) {
          const accountId = parseInt(key.replace(KEY_ACCOUNT_PREFIX, ""), 10);
          const ttl = await redis.ttl(key);
          result.accounts.push({ id: accountId, ttl });
        }
        return result;
      }
    }
  } catch {
  }
  const now = Date.now();
  result.global = memoryOverrides.global;
  for (const [name2, override] of memoryOverrides.modules) {
    if (override.enabled && override.expiresAt > now) {
      result.modules.push({ name: name2, ttl: Math.round((override.expiresAt - now) / 1e3) });
    }
  }
  for (const [id, override] of memoryOverrides.accounts) {
    if (override.enabled && override.expiresAt > now) {
      result.accounts.push({ id, ttl: Math.round((override.expiresAt - now) / 1e3) });
    }
  }
  return result;
}
async function refreshCache() {
  try {
    const { getRedis: getRedis2, isRedisAvailable: isRedisAvailable2 } = await Promise.resolve().then(() => (init_redisClient(), redisClient_exports));
    if (!isRedisAvailable2()) return;
    const redis = getRedis2();
    if (!redis) return;
    _cachedOverrides.global = await redis.get(KEY_GLOBAL);
    const moduleKeys = await redis.keys(`${KEY_MODULE_PREFIX}*`);
    const newModules = /* @__PURE__ */ new Set();
    for (const key of moduleKeys) {
      newModules.add(key.replace(KEY_MODULE_PREFIX, ""));
    }
    _cachedOverrides.modules = newModules;
    const accountKeys = await redis.keys(`${KEY_ACCOUNT_PREFIX}*`);
    const newAccounts = /* @__PURE__ */ new Set();
    for (const key of accountKeys) {
      newAccounts.add(parseInt(key.replace(KEY_ACCOUNT_PREFIX, ""), 10));
    }
    _cachedOverrides.accounts = newAccounts;
    _cachedOverrides.lastRefresh = Date.now();
  } catch {
  }
}
export function startDynamicLogLevelRefresh() {
  if (_refreshTimer) return;
  refreshCache().catch(() => {
  });
  _refreshTimer = setInterval(() => {
    refreshCache().catch(() => {
    });
  }, CACHE_REFRESH_INTERVAL_MS);
  if (_refreshTimer.unref) _refreshTimer.unref();
  log3.info("\u52A8\u6001\u65E5\u5FD7\u7EA7\u522B\u63A7\u5236\u5DF2\u542F\u52A8\uFF0C\u6BCF10\u79D2\u4ECERedis\u5237\u65B0\u7F13\u5B58");
}
export function stopDynamicLogLevelRefresh() {
  if (_refreshTimer) {
    clearInterval(_refreshTimer);
    _refreshTimer = null;
  }
}
var log3, KEY_PREFIX, KEY_GLOBAL, KEY_MODULE_PREFIX, KEY_ACCOUNT_PREFIX, memoryOverrides, _cachedOverrides, CACHE_REFRESH_INTERVAL_MS, _refreshTimer;
