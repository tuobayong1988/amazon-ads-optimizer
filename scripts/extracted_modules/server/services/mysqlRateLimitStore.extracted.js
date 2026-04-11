// Extracted from production dist/index.js
// Original module: server/services/mysqlRateLimitStore.ts
// Lines: 235

var mysqlRateLimitStore_exports = {};
__export(mysqlRateLimitStore_exports, {
  MysqlRateLimitStore: () => MysqlRateLimitStore
});
var log26, MysqlRateLimitStore;
var init_mysqlRateLimitStore = __esm({
  "server/services/mysqlRateLimitStore.ts"() {
    "use strict";
    init_logger();
    log26 = createModuleLogger("MysqlRateLimitStore");
    MysqlRateLimitStore = class {
      static {
        __name(this, "MysqlRateLimitStore");
      }
      initialized = false;
      initPromise = null;
      cleanupInterval = null;
      constructor() {
        this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1e3);
      }
      /**
       * 确保限流表已创建
       */
      async ensureInitialized() {
        if (this.initialized) return;
        if (this.initPromise) return this.initPromise;
        this.initPromise = (async () => {
          try {
            const { getDb: getDb3 } = await Promise.resolve().then(() => (init_connection(), connection_exports));
            const db = await getDb3();
            if (!db) {
              log26.warn("[v372] \u6570\u636E\u5E93\u4E0D\u53EF\u7528\uFF0C\u8DF3\u8FC7\u9650\u6D41\u8868\u521D\u59CB\u5316");
              return;
            }
            const { sql: sql15 } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
            await db.execute(sql15`
          CREATE TABLE IF NOT EXISTS rate_limit_buckets (
            bucket_key VARCHAR(255) PRIMARY KEY,
            tokens DECIMAL(10,4) NOT NULL DEFAULT 0,
            last_refill_time BIGINT NOT NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
          ) ENGINE=InnoDB
        `);
            await db.execute(sql15`
          CREATE TABLE IF NOT EXISTS rate_limit_counters (
            counter_key VARCHAR(255) NOT NULL,
            window_start BIGINT NOT NULL,
            window_ms BIGINT NOT NULL,
            count INT NOT NULL DEFAULT 0,
            PRIMARY KEY (counter_key, window_start),
            INDEX idx_rlc_updated (window_start)
          ) ENGINE=InnoDB
        `);
            this.initialized = true;
            log26.info("[v372] MySQL\u9650\u6D41\u5B58\u50A8\u8868\u521D\u59CB\u5316\u5B8C\u6210");
          } catch (err) {
            log26.warn(`[v372] \u521D\u59CB\u5316MySQL\u9650\u6D41\u5B58\u50A8\u5931\u8D25: ${err.message}`);
          }
        })();
        return this.initPromise;
      }
      async getBucket(key) {
        await this.ensureInitialized();
        try {
          const { getDb: getDb3 } = await Promise.resolve().then(() => (init_connection(), connection_exports));
          const db = await getDb3();
          if (!db) return null;
          const { sql: sql15 } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
          const [rows] = await db.execute(
            sql15`SELECT tokens, last_refill_time FROM rate_limit_buckets WHERE bucket_key = ${key}`
          );
          if (rows && rows.length > 0) {
            return {
              tokens: parseFloat(rows[0].tokens),
              lastRefillTime: parseInt(rows[0].last_refill_time)
            };
          }
          return null;
        } catch (err) {
          log26.warn(`[v372] getBucket\u5931\u8D25: ${err.message}`);
          return null;
        }
      }
      async setBucket(key, tokens, lastRefillTime) {
        await this.ensureInitialized();
        try {
          const { getDb: getDb3 } = await Promise.resolve().then(() => (init_connection(), connection_exports));
          const db = await getDb3();
          if (!db) return;
          const { sql: sql15 } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
          await db.execute(
            sql15`INSERT INTO rate_limit_buckets (bucket_key, tokens, last_refill_time) 
            VALUES (${key}, ${tokens}, ${lastRefillTime})
            ON DUPLICATE KEY UPDATE tokens = ${tokens}, last_refill_time = ${lastRefillTime}`
          );
        } catch (err) {
          log26.warn(`[v372] setBucket\u5931\u8D25: ${err.message}`);
        }
      }
      /**
       * 原子性令牌消费
       * 使用MySQL的 SELECT ... FOR UPDATE 实现行级锁，确保并发安全
       */
      async consumeToken(key, config2) {
        await this.ensureInitialized();
        try {
          const { getDb: getDb3 } = await Promise.resolve().then(() => (init_connection(), connection_exports));
          const db = await getDb3();
          if (!db) {
            return { remaining: config2.burstCapacity, waitMs: 0 };
          }
          const { sql: sql15 } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
          const now = Date.now();
          await db.execute(
            sql15`INSERT IGNORE INTO rate_limit_buckets (bucket_key, tokens, last_refill_time) 
            VALUES (${key}, ${config2.burstCapacity}, ${now})`
          );
          const [result] = await db.execute(
            sql15`UPDATE rate_limit_buckets 
            SET 
              tokens = GREATEST(0, 
                LEAST(
                  ${config2.burstCapacity},
                  tokens + (${now} - last_refill_time) / 1000.0 * ${config2.refillRatePerSecond}
                ) - 1
              ),
              last_refill_time = ${now}
            WHERE bucket_key = ${key}
              AND LEAST(
                ${config2.burstCapacity},
                tokens + (${now} - last_refill_time) / 1000.0 * ${config2.refillRatePerSecond}
              ) >= 1`
          );
          if (result && result.affectedRows > 0) {
            const bucket = await this.getBucket(key);
            return { remaining: bucket ? Math.floor(bucket.tokens) : 0, waitMs: 0 };
          } else {
            const bucket = await this.getBucket(key);
            if (bucket) {
              const currentTokens = Math.min(
                config2.burstCapacity,
                bucket.tokens + (now - bucket.lastRefillTime) / 1e3 * config2.refillRatePerSecond
              );
              const deficit = 1 - currentTokens;
              const waitMs = Math.ceil(Math.max(0, deficit) / config2.refillRatePerSecond * 1e3);
              return { remaining: 0, waitMs: Math.max(waitMs, 100) };
            }
            return { remaining: 0, waitMs: 1e3 };
          }
        } catch (err) {
          log26.warn(`[v372] consumeToken\u5931\u8D25: ${err.message}`);
          return { remaining: config2.burstCapacity, waitMs: 0 };
        }
      }
      /**
       * 滑动窗口计数器递增
       */
      async incrementCounter(key, windowMs) {
        await this.ensureInitialized();
        try {
          const { getDb: getDb3 } = await Promise.resolve().then(() => (init_connection(), connection_exports));
          const db = await getDb3();
          if (!db) return 0;
          const { sql: sql15 } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
          const now = Date.now();
          const windowStart = now - now % windowMs;
          await db.execute(
            sql15`INSERT INTO rate_limit_counters (counter_key, window_start, window_ms, count) 
            VALUES (${key}, ${windowStart}, ${windowMs}, 1)
            ON DUPLICATE KEY UPDATE count = count + 1`
          );
          const [rows] = await db.execute(
            sql15`SELECT SUM(count) as total FROM rate_limit_counters 
            WHERE counter_key = ${key} AND window_start >= ${now - windowMs}`
          );
          return rows && rows.length > 0 ? parseInt(rows[0].total || "0") : 0;
        } catch (err) {
          log26.warn(`[v372] incrementCounter\u5931\u8D25: ${err.message}`);
          return 0;
        }
      }
      /**
       * 获取当前窗口计数
       */
      async getCounter(key) {
        await this.ensureInitialized();
        try {
          const { getDb: getDb3 } = await Promise.resolve().then(() => (init_connection(), connection_exports));
          const db = await getDb3();
          if (!db) return 0;
          const { sql: sql15 } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
          const now = Date.now();
          const [rows] = await db.execute(
            sql15`SELECT SUM(count) as total FROM rate_limit_counters 
            WHERE counter_key = ${key} AND window_start >= ${now - 6e4}`
          );
          return rows && rows.length > 0 ? parseInt(rows[0].total || "0") : 0;
        } catch (err) {
          log26.warn(`[v372] getCounter\u5931\u8D25: ${err.message}`);
          return 0;
        }
      }
      /**
       * 清理过期记录
       */
      async cleanup() {
        try {
          const { getDb: getDb3 } = await Promise.resolve().then(() => (init_connection(), connection_exports));
          const db = await getDb3();
          if (!db) return;
          const { sql: sql15 } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
          const cutoff = Date.now() - 10 * 60 * 1e3;
          await db.execute(
            sql15`DELETE FROM rate_limit_counters WHERE window_start < ${cutoff}`
          );
          await db.execute(
            sql15`DELETE FROM rate_limit_buckets WHERE updated_at < DATE_SUB(NOW(), INTERVAL 1 HOUR)`
          );
        } catch (err) {
          log26.debug(`[v372] \u9650\u6D41\u8BB0\u5F55\u6E05\u7406\u5931\u8D25: ${err.message}`);
        }
      }
      /**
       * 停止清理定时器
       */
      destroy() {
        if (this.cleanupInterval) {
          clearInterval(this.cleanupInterval);
          this.cleanupInterval = null;
        }
      }
    };
  }
});

