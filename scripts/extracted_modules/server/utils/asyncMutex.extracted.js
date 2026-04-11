// Extracted from production dist/index.js
// Original module: server/utils/asyncMutex.ts
// Lines: 124

function isLockExpired(entry) {
  const elapsed = Date.now() - entry.acquiredAt.getTime();
  return elapsed > entry.timeoutMs;
}
function releaseLock(name2) {
  const entry = locks.get(name2);
  if (entry?.timeoutHandle) {
    clearTimeout(entry.timeoutHandle);
  }
  locks.delete(name2);
  const queue = waitQueues.get(name2);
  if (queue && queue.length > 0) {
    const next = queue.shift();
    grantLock(name2, next.holder, next.timeoutMs, next.resolve);
  }
}
function grantLock(name2, holder, timeoutMs, resolve) {
  const entry = {
    holder,
    acquiredAt: /* @__PURE__ */ new Date(),
    timeoutMs
  };
  entry.timeoutHandle = setTimeout(() => {
    log73.warn(`\u9501 "${name2}" \u8D85\u65F6\u81EA\u52A8\u91CA\u653E (holder: ${holder}, timeout: ${timeoutMs}ms)`);
    releaseLock(name2);
  }, timeoutMs);
  locks.set(name2, entry);
  resolve(() => releaseLock(name2));
}
var log73, locks, waitQueues, AsyncMutex;
var init_asyncMutex = __esm({
  "server/utils/asyncMutex.ts"() {
    "use strict";
    init_logger();
    log73 = createModuleLogger("AsyncMutex");
    locks = /* @__PURE__ */ new Map();
    waitQueues = /* @__PURE__ */ new Map();
    __name(isLockExpired, "isLockExpired");
    __name(releaseLock, "releaseLock");
    __name(grantLock, "grantLock");
    AsyncMutex = class {
      static {
        __name(this, "AsyncMutex");
      }
      name;
      constructor(name2) {
        this.name = name2;
      }
      /**
       * 获取互斥锁
       * @param timeoutMs 锁的最大持有时间（毫秒），超时后自动释放防止死锁
       * @param waitMs 等待获取锁的最大时间（毫秒），0表示不等待（tryLock语义）
       * @returns 释放函数，如果获取失败返回 null
       */
      async acquire(timeoutMs = 3e4, waitMs = 0) {
        const existing = locks.get(this.name);
        if (existing) {
          if (isLockExpired(existing)) {
            log73.warn(`\u9501 "${this.name}" \u5DF2\u8FC7\u671F\uFF0C\u5F3A\u5236\u91CA\u653E (holder: ${existing.holder})`);
            releaseLock(this.name);
          } else if (waitMs <= 0) {
            return null;
          } else {
            return new Promise((resolve) => {
              const holder = `waiter-${Date.now()}`;
              if (!waitQueues.has(this.name)) {
                waitQueues.set(this.name, []);
              }
              const queue = waitQueues.get(this.name);
              const waiter = { resolve, holder, timeoutMs };
              queue.push(waiter);
              setTimeout(() => {
                const idx = queue.indexOf(waiter);
                if (idx !== -1) {
                  queue.splice(idx, 1);
                  resolve(null);
                }
              }, waitMs);
            });
          }
        }
        return new Promise((resolve) => {
          grantLock(this.name, `holder-${Date.now()}`, timeoutMs, resolve);
        });
      }
      /**
       * 尝试获取锁（不等待）
       * @returns 释放函数，如果锁已被持有返回 null
       */
      async tryAcquire(timeoutMs = 3e4) {
        return this.acquire(timeoutMs, 0);
      }
      /**
       * 检查锁是否被持有
       */
      isLocked() {
        const entry = locks.get(this.name);
        if (!entry) return false;
        if (isLockExpired(entry)) {
          releaseLock(this.name);
          return false;
        }
        return true;
      }
      /**
       * 获取锁的状态信息
       */
      getStatus() {
        const entry = locks.get(this.name);
        const queue = waitQueues.get(this.name);
        if (!entry || isLockExpired(entry)) {
          return { locked: false, waitQueueSize: queue?.length || 0 };
        }
        return {
          locked: true,
          holder: entry.holder,
          acquiredAt: entry.acquiredAt,
          waitQueueSize: queue?.length || 0
        };
      }
    };
  }
});

