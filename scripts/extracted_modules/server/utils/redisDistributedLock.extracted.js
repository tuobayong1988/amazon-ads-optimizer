// Extracted from production dist/index.js
// Original module: server/utils/redisDistributedLock.ts
// Lines: 263

var redisDistributedLock_exports = {};
__export(redisDistributedLock_exports, {
  RedisDistributedLock: () => RedisDistributedLock,
  getAllRedisLockStatus: () => getAllRedisLockStatus,
  withRedisLock: () => withRedisLock
});
async function withRedisLock(name2, fn, timeoutMs = 3e4) {
  const lock = new RedisDistributedLock(name2);
  const release = await lock.tryAcquire(timeoutMs);
  if (!release) {
    log69.warn(`\u65E0\u6CD5\u83B7\u53D6Redis\u9501 "${name2}"\uFF0C\u64CD\u4F5C\u88AB\u8DF3\u8FC7`);
    return null;
  }
  try {
    return await fn();
  } finally {
    await release();
  }
}
async function getAllRedisLockStatus() {
  const redis = getRedis();
  if (!redis) return [];
  try {
    const keys = [];
    let cursor = "0";
    do {
      const [nextCursor, foundKeys] = await redis.scan(
        cursor,
        "MATCH",
        `${LOCK_PREFIX}*`,
        "COUNT",
        "100"
      );
      cursor = nextCursor;
      keys.push(...foundKeys);
    } while (cursor !== "0");
    if (keys.length === 0) return [];
    const pipeline = redis.pipeline();
    for (const key of keys) {
      pipeline.get(key);
      pipeline.pttl(key);
    }
    const results = await pipeline.exec();
    if (!results) return [];
    const locks2 = [];
    for (let i = 0; i < keys.length; i++) {
      const holderId = results[i * 2]?.[1];
      const ttlMs = results[i * 2 + 1]?.[1];
      if (holderId) {
        locks2.push({
          lockKey: keys[i].replace(LOCK_PREFIX, ""),
          holderId,
          ttlMs: ttlMs > 0 ? ttlMs : 0
        });
      }
    }
    return locks2;
  } catch (e) {
    log69.warn(`\u83B7\u53D6Redis\u9501\u72B6\u6001\u5931\u8D25: ${e.message}`);
    return [];
  }
}
var log69, INSTANCE_ID2, LOCK_PREFIX, RELEASE_SCRIPT, RENEW_SCRIPT, RedisDistributedLock;
var init_redisDistributedLock = __esm({
  "server/utils/redisDistributedLock.ts"() {
    "use strict";
    init_logger();
    init_redisClient();
    init_dist_node();
    log69 = createModuleLogger("RedisLock");
    INSTANCE_ID2 = `inst-${process.pid}-${Date.now().toString(36)}`;
    LOCK_PREFIX = "lock:";
    RELEASE_SCRIPT = `
  if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
  else
    return 0
  end
`;
    RENEW_SCRIPT = `
  if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("pexpire", KEYS[1], ARGV[2])
  else
    return 0
  end
`;
    RedisDistributedLock = class {
      static {
        __name(this, "RedisDistributedLock");
      }
      lockKey;
      holderId;
      renewTimer = null;
      constructor(name2) {
        this.lockKey = `${LOCK_PREFIX}${name2}`;
        this.holderId = `${INSTANCE_ID2}-${v4_default().substring(0, 8)}`;
      }
      /**
       * 获取分布式锁
       * @param timeoutMs 锁的最大持有时间（毫秒），超时后自动过期
       * @param waitMs 等待获取锁的最大时间（毫秒），0表示不等待
       * @param retryIntervalMs 重试间隔（毫秒）
       * @returns 释放函数，如果获取失败返回 null
       */
      async acquire(timeoutMs = 3e4, waitMs = 0, retryIntervalMs = 200) {
        await ensureRedis();
        const redis = getRedis();
        if (!redis) {
          return this.fallbackToMySQL(timeoutMs, waitMs);
        }
        const startTime = Date.now();
        while (true) {
          try {
            const result = await redis.set(
              this.lockKey,
              this.holderId,
              "PX",
              timeoutMs,
              "NX"
            );
            if (result === "OK") {
              log69.info(`Redis\u9501 "${this.lockKey}" \u5DF2\u83B7\u53D6 (holder: ${this.holderId}, timeout: ${timeoutMs}ms)`);
              const renewInterval = Math.max(timeoutMs / 3, 5e3);
              this.startAutoRenew(timeoutMs, renewInterval);
              const lockKey = this.lockKey;
              const holderId = this.holderId;
              const self2 = this;
              return async () => {
                self2.stopAutoRenew();
                try {
                  const released = await redis.eval(
                    RELEASE_SCRIPT,
                    1,
                    lockKey,
                    holderId
                  );
                  if (released === 1) {
                    log69.info(`Redis\u9501 "${lockKey}" \u5DF2\u91CA\u653E (holder: ${holderId})`);
                  } else {
                    log69.warn(`Redis\u9501 "${lockKey}" \u91CA\u653E\u5931\u8D25\uFF08\u53EF\u80FD\u5DF2\u8FC7\u671F\u6216\u88AB\u5176\u4ED6\u6301\u6709\u8005\u91CA\u653E\uFF09`);
                  }
                } catch (e) {
                  log69.warn(`\u91CA\u653ERedis\u9501 "${lockKey}" \u5F02\u5E38: ${e.message}`);
                }
              };
            }
            const elapsed = Date.now() - startTime;
            if (waitMs <= 0 || elapsed >= waitMs) {
              log69.debug(`Redis\u9501 "${this.lockKey}" \u5DF2\u88AB\u5360\u7528\uFF0C\u83B7\u53D6\u5931\u8D25`);
              return null;
            }
            await new Promise((resolve) => setTimeout(resolve, retryIntervalMs));
          } catch (e) {
            log69.warn(`\u83B7\u53D6Redis\u9501 "${this.lockKey}" \u5F02\u5E38: ${e.message}`);
            return this.fallbackToMySQL(timeoutMs, waitMs);
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
        const redis = getRedis();
        if (!redis) return false;
        try {
          const result = await redis.eval(
            RENEW_SCRIPT,
            1,
            this.lockKey,
            this.holderId,
            String(additionalMs)
          );
          if (result === 1) {
            log69.debug(`Redis\u9501 "${this.lockKey}" \u5DF2\u7EED\u671F ${additionalMs}ms`);
            return true;
          }
          log69.warn(`Redis\u9501 "${this.lockKey}" \u7EED\u671F\u5931\u8D25\uFF08\u53EF\u80FD\u5DF2\u8FC7\u671F\u6216\u88AB\u91CA\u653E\uFF09`);
          return false;
        } catch (e) {
          log69.warn(`Redis\u9501 "${this.lockKey}" \u7EED\u671F\u5F02\u5E38: ${e.message}`);
          return false;
        }
      }
      /**
       * 检查锁是否被持有
       */
      async isLocked() {
        const redis = getRedis();
        if (!redis) return false;
        try {
          const value = await redis.get(this.lockKey);
          return value !== null;
        } catch {
          return false;
        }
      }
      /**
       * 强制释放锁（管理员操作）
       */
      async forceRelease() {
        const redis = getRedis();
        if (!redis) return false;
        try {
          await redis.del(this.lockKey);
          log69.warn(`Redis\u9501 "${this.lockKey}" \u88AB\u5F3A\u5236\u91CA\u653E`);
          return true;
        } catch (e) {
          log69.warn(`\u5F3A\u5236\u91CA\u653ERedis\u9501 "${this.lockKey}" \u5931\u8D25: ${e.message}`);
          return false;
        }
      }
      /**
       * 启动自动续期定时器
       */
      startAutoRenew(timeoutMs, intervalMs) {
        this.stopAutoRenew();
        this.renewTimer = setInterval(async () => {
          const success2 = await this.renew(timeoutMs);
          if (!success2) {
            log69.warn(`Redis\u9501 "${this.lockKey}" \u81EA\u52A8\u7EED\u671F\u5931\u8D25\uFF0C\u505C\u6B62\u7EED\u671F`);
            this.stopAutoRenew();
          }
        }, intervalMs);
        if (this.renewTimer && typeof this.renewTimer === "object" && "unref" in this.renewTimer) {
          this.renewTimer.unref();
        }
      }
      /**
       * 停止自动续期
       */
      stopAutoRenew() {
        if (this.renewTimer) {
          clearInterval(this.renewTimer);
          this.renewTimer = null;
        }
      }
      /**
       * 降级到 MySQL 分布式锁
       */
      async fallbackToMySQL(timeoutMs, waitMs) {
        log69.info(`Redis\u9501 "${this.lockKey}" \u964D\u7EA7\u5230 MySQL \u9501`);
        try {
          const { DistributedLock: DistributedLock2 } = await Promise.resolve().then(() => (init_distributedLock(), distributedLock_exports));
          const mysqlLock = new DistributedLock2(this.lockKey.replace(LOCK_PREFIX, ""));
          return mysqlLock.acquire(timeoutMs, waitMs);
        } catch (e) {
          log69.warn(`MySQL \u9501\u4E5F\u4E0D\u53EF\u7528: ${e.message}`);
          return async () => {
          };
        }
      }
    };
    __name(withRedisLock, "withRedisLock");
    __name(getAllRedisLockStatus, "getAllRedisLockStatus");
  }
});

