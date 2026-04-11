// Extracted from production dist/index.js
// Original module: server/utils/distributedLock.ts
// Lines: 243

var distributedLock_exports = {};
__export(distributedLock_exports, {
  DistributedLock: () => DistributedLock,
  getAllDistributedLockStatus: () => getAllDistributedLockStatus,
  withDistributedLock: () => withDistributedLock
});
async function ensureTable() {
  if (tableEnsured) return true;
  try {
    const database = await getDb();
    await database.execute(sql`
      CREATE TABLE IF NOT EXISTS sync_locks (
        id INT AUTO_INCREMENT NOT NULL PRIMARY KEY,
        lock_key VARCHAR(128) NOT NULL,
        holder_id VARCHAR(64) NOT NULL,
        acquired_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        UNIQUE KEY uk_lock_key (lock_key),
        INDEX idx_sync_locks_expires_at (expires_at)
      )
    `);
    tableEnsured = true;
    return true;
  } catch (e) {
    log68.warn(`\u521B\u5EFAsync_locks\u8868\u5931\u8D25: ${e.message}`);
    return false;
  }
}
async function cleanupExpiredLocks() {
  try {
    const database = await getDb();
    const result = await database.execute(sql`
      DELETE FROM sync_locks WHERE expires_at <= NOW()
    `);
    const deleted = getAffectedRows(result);
    if (deleted > 0) {
      log68.info(`\u6E05\u7406\u4E86 ${deleted} \u4E2A\u8FC7\u671F\u9501`);
    }
    return deleted;
  } catch (e) {
    log68.debug(`\u6E05\u7406\u8FC7\u671F\u9501\u5931\u8D25: ${e.message}`);
    return 0;
  }
}
async function withDistributedLock(name2, fn, timeoutMs = 3e4) {
  const lock = new DistributedLock(name2);
  const release = await lock.tryAcquire(timeoutMs);
  if (!release) {
    log68.warn(`\u65E0\u6CD5\u83B7\u53D6\u5206\u5E03\u5F0F\u9501 "${name2}"\uFF0C\u64CD\u4F5C\u88AB\u8DF3\u8FC7`);
    return null;
  }
  try {
    return await fn();
  } finally {
    await release();
  }
}
async function getAllDistributedLockStatus() {
  try {
    await ensureTable();
    const database = await getDb();
    const result = await database.execute(sql`
 SELECT lock_key, holder_id, acquired_at, expires_at,
 TIMESTAMPDIFF(SECOND, NOW(), expires_at) * 1000 as remaining_ms
 FROM sync_locks
 WHERE expires_at > NOW()
 ORDER BY acquired_at DESC
 `);
    const rows = extractRows2(result);
    return rows.map((row) => ({
      // @ts-ignore
      lockKey: row.lock_key,
      // @ts-ignore
      holderId: row.holder_id,
      // @ts-ignore
      acquiredAt: row.acquired_at,
      // @ts-ignore
      expiresAt: row.expires_at,
      // @ts-ignore
      remainingMs: Number(row.remaining_ms) || 0
    }));
  } catch {
    return [];
  }
}
var log68, INSTANCE_ID, tableEnsured, DistributedLock;
var init_distributedLock = __esm({
  "server/utils/distributedLock.ts"() {
    "use strict";
    init_db2();
    init_drizzle_orm();
    init_logger();
    init_dist_node();
    init_utilTypes();
    log68 = createModuleLogger("DistributedLock");
    INSTANCE_ID = `inst-${process.pid}-${Date.now().toString(36)}`;
    tableEnsured = false;
    __name(ensureTable, "ensureTable");
    __name(cleanupExpiredLocks, "cleanupExpiredLocks");
    DistributedLock = class {
      static {
        __name(this, "DistributedLock");
      }
      lockKey;
      holderId;
      constructor(name2) {
        this.lockKey = name2;
        this.holderId = `${INSTANCE_ID}-${v4_default().substring(0, 8)}`;
      }
      /**
       * 获取分布式锁
       * @param timeoutMs 锁的最大持有时间（毫秒），超时后自动过期
       * @param waitMs 等待获取锁的最大时间（毫秒），0表示不等待
       * @param retryIntervalMs 重试间隔（毫秒）
       * @returns 释放函数，如果获取失败返回 null
       */
      async acquire(timeoutMs = 3e4, waitMs = 0, retryIntervalMs = 1e3) {
        const tableReady = await ensureTable();
        if (!tableReady) {
          log68.warn(`sync_locks\u8868\u4E0D\u53EF\u7528\uFF0C\u9501 "${this.lockKey}" \u56DE\u9000\u5230\u65E0\u9501\u6A21\u5F0F`);
          return async () => {
          };
        }
        const startTime = Date.now();
        while (true) {
          try {
            await cleanupExpiredLocks();
            const expiresAtMs = Date.now() + timeoutMs;
            const expiresAt = new Date(expiresAtMs).toISOString().slice(0, 19).replace("T", " ");
            const db = await getDb();
            await db.execute(sql`
          INSERT INTO sync_locks (lock_key, holder_id, acquired_at, expires_at)
          VALUES (${this.lockKey}, ${this.holderId}, NOW(), ${expiresAt})
        `);
            log68.info(`\u9501 "${this.lockKey}" \u5DF2\u83B7\u53D6 (holder: ${this.holderId}, timeout: ${timeoutMs}ms)`);
            const localTimeout = setTimeout(() => {
              log68.warn(`\u9501 "${this.lockKey}" \u5373\u5C06\u8FC7\u671F (holder: ${this.holderId})`);
            }, timeoutMs - 5e3);
            const lockKey = this.lockKey;
            const holderId = this.holderId;
            return async () => {
              clearTimeout(localTimeout);
              try {
                const db2 = await getDb();
                await db2.execute(sql`
              DELETE FROM sync_locks 
              WHERE lock_key = ${lockKey} AND holder_id = ${holderId}
            `);
                log68.info(`\u9501 "${lockKey}" \u5DF2\u91CA\u653E (holder: ${holderId})`);
              } catch (e) {
                log68.warn(`\u91CA\u653E\u9501 "${lockKey}" \u5931\u8D25: ${e.message}`);
              }
            };
          } catch (e) {
            const errorMsg = e.message || "";
            if (errorMsg.includes("Duplicate") || errorMsg.includes("ER_DUP_ENTRY")) {
              const elapsed = Date.now() - startTime;
              if (waitMs <= 0 || elapsed >= waitMs) {
                log68.debug(`\u9501 "${this.lockKey}" \u5DF2\u88AB\u5360\u7528\uFF0C\u83B7\u53D6\u5931\u8D25`);
                return null;
              }
              await new Promise((resolve) => setTimeout(resolve, retryIntervalMs));
              continue;
            }
            log68.warn(`\u83B7\u53D6\u9501 "${this.lockKey}" \u5F02\u5E38: ${errorMsg}`);
            return async () => {
            };
          }
        }
      }
      /**
       * 尝试获取锁（不等待）
       */
      async tryAcquire(timeoutMs = 3e4) {
        return this.acquire(timeoutMs, 0);
      }
      /**
       * 续期锁（延长过期时间）
       */
      async renew(additionalMs = 3e4) {
        try {
          const db = await getDb();
          const result = await db.execute(sql`
        UPDATE sync_locks 
        SET expires_at = DATE_ADD(NOW(), INTERVAL ${Math.ceil(additionalMs / 1e3)} SECOND)
        WHERE lock_key = ${this.lockKey} AND holder_id = ${this.holderId}
      `);
          const affected = getAffectedRows(result);
          if (affected > 0) {
            log68.debug(`\u9501 "${this.lockKey}" \u5DF2\u7EED\u671F ${additionalMs}ms`);
            return true;
          }
          log68.warn(`\u9501 "${this.lockKey}" \u7EED\u671F\u5931\u8D25\uFF08\u53EF\u80FD\u5DF2\u8FC7\u671F\u6216\u88AB\u91CA\u653E\uFF09`);
          return false;
        } catch (e) {
          log68.warn(`\u9501 "${this.lockKey}" \u7EED\u671F\u5F02\u5E38: ${e.message}`);
          return false;
        }
      }
      /**
       * 检查锁是否被持有
       */
      async isLocked() {
        try {
          const db = await getDb();
          const result = await db.execute(sql`
        SELECT COUNT(*) as cnt FROM sync_locks 
        WHERE lock_key = ${this.lockKey} AND expires_at > NOW()
      `);
          const count11 = extractCount(result);
          return count11 > 0;
        } catch {
          return false;
        }
      }
      /**
       * 强制释放锁（管理员操作）
       */
      async forceRelease() {
        try {
          const db = await getDb();
          await db.execute(sql`
        DELETE FROM sync_locks WHERE lock_key = ${this.lockKey}
      `);
          log68.warn(`\u9501 "${this.lockKey}" \u88AB\u5F3A\u5236\u91CA\u653E`);
          return true;
        } catch (e) {
          log68.warn(`\u5F3A\u5236\u91CA\u653E\u9501 "${this.lockKey}" \u5931\u8D25: ${e.message}`);
          return false;
        }
      }
    };
    __name(withDistributedLock, "withDistributedLock");
    __name(getAllDistributedLockStatus, "getAllDistributedLockStatus");
    setInterval(async () => {
      try {
        await cleanupExpiredLocks();
      } catch {
      }
    }, 5 * 60 * 1e3);
  }
});

