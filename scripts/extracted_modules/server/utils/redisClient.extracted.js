// Extracted from production dist/index.js
// Original module: server/utils/redisClient.ts
// Lines: 153

var redisClient_exports = {};
__export(redisClient_exports, {
  closeRedis: () => closeRedis,
  ensureRedis: () => ensureRedis,
  getRedis: () => getRedis,
  isRedisAvailable: () => isRedisAvailable,
  redisHealthCheck: () => redisHealthCheck
});
async function initRedis() {
  if (_initAttempted) return _isConnected;
  _initAttempted = true;
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    log2.info("REDIS_URL \u672A\u914D\u7F6E\uFF0CRedis \u529F\u80FD\u5DF2\u7981\u7528");
    return false;
  }
  try {
    const ioredis = await import("ioredis");
    Redis = ioredis.default;
    _client = new Redis(redisUrl, {
      // 连接配置
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        if (times > 10) {
          log2.warn(`Redis \u91CD\u8FDE\u5931\u8D25 ${times} \u6B21\uFF0C\u505C\u6B62\u91CD\u8BD5`);
          return null;
        }
        const delay2 = Math.min(times * 500, 5e3);
        log2.info(`Redis \u91CD\u8FDE\u4E2D... (\u7B2C ${times} \u6B21\uFF0C${delay2}ms \u540E\u91CD\u8BD5)`);
        return delay2;
      },
      // 超时配置
      connectTimeout: 5e3,
      commandTimeout: 3e3,
      // 性能配置
      enableReadyCheck: true,
      lazyConnect: false,
      // 断线重连
      reconnectOnError(err) {
        const targetErrors = ["READONLY", "ECONNRESET", "ECONNREFUSED"];
        return targetErrors.some((e) => err.message.includes(e));
      }
    });
    _client.on("connect", () => {
      log2.info("Redis \u5DF2\u8FDE\u63A5");
      _isConnected = true;
    });
    _client.on("ready", () => {
      log2.info("Redis \u5C31\u7EEA");
      _isConnected = true;
    });
    _client.on("error", (err) => {
      log2.warn(`Redis \u9519\u8BEF: ${err.message}`);
      _isConnected = false;
    });
    _client.on("close", () => {
      log2.info("Redis \u8FDE\u63A5\u5DF2\u5173\u95ED");
      _isConnected = false;
    });
    _client.on("reconnecting", () => {
      log2.info("Redis \u6B63\u5728\u91CD\u8FDE...");
    });
    await Promise.race([
      new Promise((resolve) => {
        _client.once("ready", resolve);
      }),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("Redis \u8FDE\u63A5\u8D85\u65F6")), 5e3);
      })
    ]);
    log2.info(`Redis \u8FDE\u63A5\u6210\u529F: ${redisUrl.replace(/\/\/.*@/, "//***@")}`);
    return true;
  } catch (e) {
    const msg = e.message || String(e);
    if (msg.includes("Cannot find module") || msg.includes("MODULE_NOT_FOUND")) {
      log2.info("ioredis \u672A\u5B89\u88C5\uFF0CRedis \u529F\u80FD\u5DF2\u7981\u7528\uFF08\u964D\u7EA7\u5230 MySQL \u9501\uFF09");
    } else {
      log2.warn(`Redis \u8FDE\u63A5\u5931\u8D25: ${msg}\uFF08\u964D\u7EA7\u5230 MySQL \u9501\uFF09`);
    }
    _client = null;
    _isConnected = false;
    return false;
  }
}
function getRedis() {
  if (!_isConnected || !_client) return null;
  return _client;
}
async function ensureRedis() {
  if (!_initPromise) {
    _initPromise = initRedis();
  }
  return _initPromise;
}
function isRedisAvailable() {
  return _isConnected && _client !== null;
}
async function redisHealthCheck() {
  if (!_client || !_isConnected) {
    return { available: false, latencyMs: -1 };
  }
  try {
    const start = Date.now();
    const pong = await _client.ping();
    const latencyMs = Date.now() - start;
    return {
      available: pong === "PONG",
      latencyMs,
      info: `Connected, latency: ${latencyMs}ms`
    };
  } catch (e) {
    return {
      available: false,
      latencyMs: -1,
      info: `Health check failed: ${e.message}`
    };
  }
}
async function closeRedis() {
  if (_client) {
    try {
      await _client.quit();
      log2.info("Redis \u8FDE\u63A5\u5DF2\u4F18\u96C5\u5173\u95ED");
    } catch (e) {
      log2.warn(`Redis \u5173\u95ED\u5F02\u5E38: ${e.message}`);
      _client.disconnect();
    }
    _client = null;
    _isConnected = false;
    _initAttempted = false;
    _initPromise = null;
  }
}
var log2, Redis, _client, _isConnected, _initAttempted, _initPromise;
var init_redisClient = __esm({
  "server/utils/redisClient.ts"() {
    "use strict";
    init_logger();
    log2 = createModuleLogger("Redis");
    Redis = null;
    _client = null;
    _isConnected = false;
    _initAttempted = false;
    _initPromise = null;
    __name(initRedis, "initRedis");
    __name(getRedis, "getRedis");
    __name(ensureRedis, "ensureRedis");
    __name(isRedisAvailable, "isRedisAvailable");
    __name(redisHealthCheck, "redisHealthCheck");
    __name(closeRedis, "closeRedis");
  }
});

