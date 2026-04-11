// Extracted from production dist/index.js
// Original module: server/db/connection.ts
// Lines: 303

var connection_exports = {};
__export(connection_exports, {
  getDb: () => getDb,
  getDirectConnection: () => getDirectConnection,
  getPoolStats: () => getPoolStats
});
function startLeakChecker() {
  if (_leakCheckTimer) return;
  _leakCheckTimer = setInterval(() => {
    const now = Date.now();
    for (const [id, tracked2] of _activeConnections.entries()) {
      if (!tracked2.released && now - tracked2.borrowedAt > CONNECTION_MAX_HOLD_TIME) {
        log7.warn(`[Database] v394: \u68C0\u6D4B\u5230\u8FDE\u63A5\u6CC4\u9732 #${id}\uFF0C\u5DF2\u6301\u6709${Math.round((now - tracked2.borrowedAt) / 1e3)}\u79D2\uFF0C\u6765\u6E90: ${tracked2.caller}\uFF0C\u81EA\u52A8\u56DE\u6536`);
        try {
          tracked2.releaseFunc();
          _poolStats.autoReclaimed++;
        } catch (e) {
          log7.warn(`[Database] v394: \u81EA\u52A8\u56DE\u6536\u8FDE\u63A5 #${id} \u5931\u8D25: ${e.message}`);
        }
        _activeConnections.delete(id);
      }
    }
    for (const [id, tracked2] of _activeConnections.entries()) {
      if (tracked2.released && now - tracked2.borrowedAt > 3e5) {
        _activeConnections.delete(id);
      }
    }
  }, LEAK_CHECK_INTERVAL);
  if (_leakCheckTimer.unref) _leakCheckTimer.unref();
}
async function getDb() {
  if (!process.env.DATABASE_URL) return null;
  const now = Date.now();
  if (_db && _pool && now - _lastHealthCheck > HEALTH_CHECK_INTERVAL) {
    try {
      const conn = await Promise.race([
        _pool.getConnection(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Health check getConnection timeout")), 5e3))
      ]);
      await Promise.race([
        conn.ping(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Health check ping timeout")), 3e3))
      ]);
      conn.release();
      _lastHealthCheck = now;
      _consecutiveHealthCheckFails = 0;
    } catch (error48) {
      _poolStats.healthChecksFailed++;
      if (!_consecutiveHealthCheckFails) _consecutiveHealthCheckFails = 0;
      _consecutiveHealthCheckFails++;
      log7.warn(`[Database] P3v6: \u8FDE\u63A5\u5065\u5EB7\u68C0\u67E5\u5931\u8D25(#${_poolStats.healthChecksFailed}, \u8FDE\u7EED${_consecutiveHealthCheckFails}\u6B21):`, error48.message);
      if (_consecutiveHealthCheckFails >= 2 && now - _lastPoolRebuild > POOL_REBUILD_COOLDOWN) {
        const oldPool = _pool;
        const oldDb = _db;
        try {
          const poolSize = parseInt(process.env.DB_POOL_SIZE || "100", 10);
          const poolIdleTimeout = parseInt(process.env.DB_IDLE_TIMEOUT || "300000", 10);
          const newPool = import_promise.default.createPool({
            uri: process.env.DATABASE_URL,
            waitForConnections: true,
            connectionLimit: poolSize,
            maxIdle: Math.floor(poolSize * 0.4),
            idleTimeout: poolIdleTimeout,
            connectTimeout: 15e3,
            enableKeepAlive: true,
            keepAliveInitialDelay: 1e4,
            queueLimit: poolSize * 4,
            timezone: "+00:00"
          });
          newPool.on("connection", (conn) => {
            _poolStats.created++;
            try { conn.query("SET time_zone = '+00:00'"); } catch (e) {}
          });
          const newDb = drizzle(newPool, { casing: "camelCase" });
          _pool = newPool;
          _db = newDb;
          _lastHealthCheck = Date.now();
          log7.info("[Database] P3v6: \u8FDE\u63A5\u6C60\u539F\u5B50\u5207\u6362\u5B8C\u6210\uFF0C\u65B0\u6C60\u5DF2\u5C31\u7EEA");
          setTimeout(async () => {
            try { await oldPool.end(); } catch(e) {}
            log7.info("[Database] P3v6: \u65E7\u8FDE\u63A5\u6C60\u5DF2\u5F02\u6B65\u9500\u6BC1");
          }, 5000);
        } catch (rebuildErr) {
          log7.warn("[Database] P3v6: \u539F\u5B50\u91CD\u5EFA\u5931\u8D25\uFF0C\u56DE\u9000\u5230\u65E7\u65B9\u5F0F:", rebuildErr.message);
          try { await oldPool.end(); } catch(e) {}
          _db = null;
          _pool = null;
        }
        _lastPoolRebuild = now;
        _poolStats.rebuilds++;
        log7.info(`[Database] v350: \u8FDE\u63A5\u6C60\u91CD\u5EFA\u5B8C\u6210 (\u91CD\u5EFA\u6B21\u6570: ${_poolStats.rebuilds})`);
      } else {
        log7.info(`[Database] v350: \u8DF3\u8FC7\u8FDE\u63A5\u6C60\u91CD\u5EFA\uFF08\u51B7\u5374\u671F\u5185\uFF0C\u8DDD\u4E0A\u6B21\u91CD\u5EFA${now - _lastPoolRebuild}ms\uFF09`);
      }
    }
  }
  if (!_db) {
    try {
      const poolSize = parseInt(process.env.DB_POOL_SIZE || "100", 10);
      const poolIdleTimeout = parseInt(process.env.DB_IDLE_TIMEOUT || "300000", 10);
      _pool = import_promise.default.createPool({
        uri: process.env.DATABASE_URL,
        waitForConnections: true,
        connectionLimit: poolSize,
        maxIdle: Math.floor(poolSize * 0.4),
        idleTimeout: poolIdleTimeout,
        connectTimeout: 15e3,
        enableKeepAlive: true,
        keepAliveInitialDelay: 1e4,
        queueLimit: poolSize * 4,
        // v548: 全链路时区强制统一 - 所有连接强制使用UTC
        // 解决v540时区Bug: 数据库时区US/Pacific与Node.js UTC不一致导致的数据异常
        timezone: "+00:00"
      });
      // v597: Dedicated auth pool - ensures auth queries always have connections during heavy sync
      if (!global._authPool) {
        global._authPool = import_promise.default.createPool({
          uri: process.env.DATABASE_URL,
          waitForConnections: true,
          connectionLimit: 5,
          maxIdle: 2,
          idleTimeout: 300000,
          connectTimeout: 5000,
          enableKeepAlive: true,
          keepAliveInitialDelay: 10000,
          queueLimit: 20,
          timezone: "+00:00"
        });
        global._authPool.on("connection", (conn) => {
          try { conn.query("SET time_zone = '+00:00'"); } catch(e) {}
        });
        console.log("[v597] Dedicated auth pool created with 5 connections");
      }
      _pool.on("connection", (conn) => {
        _poolStats.created++;
        try {
          conn.query("SET time_zone = '+00:00'");
        } catch (e) {
        }
      });
      _db = drizzle(_pool, { casing: "camelCase" });
      _lastHealthCheck = Date.now();
      _lastPoolRebuild = Date.now();
      startLeakChecker();
      log7.info(`[Database] v548: \u8FDE\u63A5\u6C60\u5DF2\u5EFA\u7ACB (limit=${poolSize}, idle=${Math.floor(poolSize * 0.4)}, connectTimeout=15s, keepAlive=10s, queueLimit=${poolSize * 4}, leakCheck=30s, timezone=UTC)`);
    } catch (error48) {
      log7.warn("[Database] v350: \u8FDE\u63A5\u6C60\u521B\u5EFA\u5931\u8D25:", error48);
      _db = null;
      _pool = null;
    }
  }
  return _db;
}

// P4: Read-only database connection pool for analysis modules
async function getReadDb() {
  // If DATABASE_READ_URL is not configured, fall back to primary
  const readUrl = process.env.DATABASE_READ_URL;
  if (!readUrl) {
    log7.debug("[Database] P4: DATABASE_READ_URL not configured, falling back to primary");
    return getDb();
  }
  if (_readDb && _readPool) {
    return _readDb;
  }
  try {
    const poolSize = parseInt(process.env.DB_READ_POOL_SIZE || "30", 10);
    _readPool = import_promise.default.createPool({
      uri: readUrl,
      waitForConnections: true,
      connectionLimit: poolSize,
      maxIdle: Math.floor(poolSize * 0.5),
      idleTimeout: 300000,
      connectTimeout: 15000,
      enableKeepAlive: true,
      keepAliveInitialDelay: 10000,
      queueLimit: poolSize * 2,
      timezone: "+00:00"
    });
    _readPool.on("connection", (conn) => {
      try { conn.query("SET time_zone = '+00:00'"); } catch (e) {}
    });
    _readDb = drizzle(_readPool, { casing: "camelCase" });
    log7.info(`[Database] P4: Read replica pool created (limit=${poolSize}, url=${readUrl.replace(/\/\/.*@/, "//***@")})`);
  } catch (error) {
    log7.warn(`[Database] P4: Read replica pool creation failed, falling back to primary: ${error.message}`);
    _readDb = null;
    _readPool = null;
    return getDb();
  }
  return _readDb;
}

async function getDirectConnection(timeoutMs = 3e4) {
  await getDb();
  if (!_pool) {
    throw new Error("[Database] v350: \u8FDE\u63A5\u6C60\u4E0D\u53EF\u7528\uFF0C\u65E0\u6CD5\u83B7\u53D6\u76F4\u63A5\u8FDE\u63A5");
  }
  _poolStats.directConnBorrowed++;
  const connId = ++_connIdCounter;
  const callerStack = new Error().stack?.split("\n")[2]?.trim() || "unknown";
  try {
    const conn = await Promise.race([
      _pool.getConnection(),
      new Promise(
        (_, reject) => setTimeout(() => reject(new Error(`v350: \u83B7\u53D6\u8FDE\u63A5\u8D85\u65F6(${timeoutMs}ms)\uFF0C\u8FDE\u63A5\u6C60\u53EF\u80FD\u5DF2\u6EE1`)), timeoutMs)
      )
    ]);
    const queryTimeoutSec = Math.ceil(timeoutMs / 1e3);
    const timeoutValue = Math.max(1e3, Math.min(queryTimeoutSec * 1e3, 3e5));
    await conn.query(`SET SESSION max_execution_time = ${timeoutValue}`);
    const originalRelease = conn.release.bind(conn);
    let released = false;
    const tracked2 = {
      conn,
      borrowedAt: Date.now(),
      releaseFunc: /* @__PURE__ */ __name(() => {
        if (!released) {
          released = true;
          tracked2.released = true;
          _poolStats.directConnReturned++;
          originalRelease();
        }
      }, "releaseFunc"),
      released: false,
      caller: callerStack
    };
    _activeConnections.set(connId, tracked2);
    conn.release = () => {
      tracked2.releaseFunc();
      setTimeout(() => _activeConnections.delete(connId), 6e4);
    };
    return conn;
  } catch (error48) {
    log7.warn(`[Database] v350: \u83B7\u53D6\u76F4\u63A5\u8FDE\u63A5\u5931\u8D25: ${error48.message}`);
    throw error48;
  }
}
function getPoolStats() {
  let activeCount = 0;
  let oldestActiveMs = 0;
  const now = Date.now();
  for (const [, tracked2] of _activeConnections) {
    if (!tracked2.released) {
      activeCount++;
      const holdTime = now - tracked2.borrowedAt;
      if (holdTime > oldestActiveMs) oldestActiveMs = holdTime;
    }
  }
  return {
    ..._poolStats,
    poolExists: !!_pool,
    dbExists: !!_db,
    leakedConnections: _poolStats.directConnBorrowed - _poolStats.directConnReturned,
    // v394: 新增监控指标
    activeDirectConnections: activeCount,
    oldestActiveConnectionMs: oldestActiveMs,
    trackedConnectionsTotal: _activeConnections.size
  };
}
var import_promise, log7, _db, _pool, _readDb, _readPool, _lastHealthCheck, _poolStats, HEALTH_CHECK_INTERVAL, POOL_REBUILD_COOLDOWN, _lastPoolRebuild, CONNECTION_MAX_HOLD_TIME, LEAK_CHECK_INTERVAL, _activeConnections, _connIdCounter, _leakCheckTimer, _consecutiveHealthCheckFails;
var init_connection = __esm({
  "server/db/connection.ts"() {
    "use strict";
    init_mysql2();
    import_promise = __toESM(require("mysql2/promise"));
    init_logger();
    init_dbQueryProvider();
    init_productTargets();
    init_keywords();
    init_adGroups();
    log7 = createModuleLogger("DB:connection");
    _db = null;
    _pool = null;
    _readDb = null;
    _readPool = null;
    _lastHealthCheck = 0;
    _poolStats = { created: 0, healthChecksFailed: 0, rebuilds: 0, directConnBorrowed: 0, directConnReturned: 0, autoReclaimed: 0 };
    HEALTH_CHECK_INTERVAL = 3e4;
    POOL_REBUILD_COOLDOWN = 3e4;
    _lastPoolRebuild = 0;
    CONNECTION_MAX_HOLD_TIME = 6e4;
    LEAK_CHECK_INTERVAL = 3e4;
    _activeConnections = /* @__PURE__ */ new Map();
    _connIdCounter = 0;
    _leakCheckTimer = null;
    _consecutiveHealthCheckFails = 0;
    __name(startLeakChecker, "startLeakChecker");
    __name(getDb, "getDb");
    __name(getDirectConnection, "getDirectConnection");
    __name(getReadDb, "getReadDb");
    __name(getPoolStats, "getPoolStats");
    queueMicrotask(() => {
      registerDbQueryProviders({
        getAdGroupById: /* @__PURE__ */ __name((id) => getAdGroupById(id), "getAdGroupById"),
        getKeywordById: /* @__PURE__ */ __name((id) => getKeywordById(id), "getKeywordById"),
        getProductTargetById: /* @__PURE__ */ __name((id) => getProductTargetById(id), "getProductTargetById"),
        getDb: /* @__PURE__ */ __name(() => getDb(), "getDb")
      });
    });
  }
});

