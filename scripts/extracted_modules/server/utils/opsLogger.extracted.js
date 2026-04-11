// Extracted from production dist/index.js
// Original module: server/utils/opsLogger.ts
// Lines: 180

function logMigration(module2, message2, data) {
  opsCollector.log("migration", "info", module2, message2, data);
}
function logMigrationError(module2, message2, data) {
  opsCollector.log("migration", "error", module2, message2, data);
}
function logIdGuardError(module2, message2, data) {
  opsCollector.log("id-guard", "error", module2, message2, data);
}
function logOptimization(module2, message2, data) {
  opsCollector.log("optimization", "info", module2, message2, data);
}
function logOptimizationWarn(module2, message2, data) {
  opsCollector.log("optimization", "warn", module2, message2, data);
}
function logOptimizationError(module2, message2, data) {
  opsCollector.log("optimization", "error", module2, message2, data);
}
function logSync(module2, message2, data) {
  opsCollector.log("sync", "info", module2, message2, data);
}
function logSyncWarn(module2, message2, data) {
  opsCollector.log("sync", "warn", module2, message2, data);
}
function logSyncError(module2, message2, data) {
  opsCollector.log("sync", "error", module2, message2, data);
}
function logSystem(module2, message2, data) {
  opsCollector.log("system", "info", module2, message2, data);
}
var RingBuf, CAT_BUF, GLOBAL_BUF, ALL_CATS, OpsCollector, opsCollector;
var init_opsLogger = __esm({
  "server/utils/opsLogger.ts"() {
    "use strict";
    init_logger();
    RingBuf = class {
      constructor(cap) {
        this.cap = cap;
        this.buf = new Array(cap);
      }
      cap;
      static {
        __name(this, "RingBuf");
      }
      buf;
      head = 0;
      count = 0;
      push(item) {
        this.buf[this.head] = item;
        this.head = (this.head + 1) % this.cap;
        if (this.count < this.cap) this.count++;
      }
      toArray() {
        if (this.count === 0) return [];
        const result = [];
        const start = this.count < this.cap ? 0 : this.head;
        for (let i = 0; i < this.count; i++) {
          const item = this.buf[(start + i) % this.cap];
          if (item !== void 0) result.push(item);
        }
        return result;
      }
      latest() {
        if (this.count === 0) return null;
        return this.buf[(this.head - 1 + this.cap) % this.cap] ?? null;
      }
      size() {
        return this.count;
      }
      capacity() {
        return this.cap;
      }
    };
    CAT_BUF = 300;
    GLOBAL_BUF = 5e3;
    ALL_CATS = ["migration", "id-guard", "optimization", "sync", "error", "system"];
    OpsCollector = class {
      static {
        __name(this, "OpsCollector");
      }
      catBufs = /* @__PURE__ */ new Map();
      globalBuf = new RingBuf(GLOBAL_BUF);
      seq = 0;
      startedAt = (/* @__PURE__ */ new Date()).toISOString();
      totalCounts = {
        migration: 0,
        "id-guard": 0,
        optimization: 0,
        sync: 0,
        error: 0,
        system: 0
      };
      levelCounts = { info: 0, warn: 0, error: 0 };
      constructor() {
        for (const cat of ALL_CATS) {
          this.catBufs.set(cat, new RingBuf(CAT_BUF));
        }
      }
      log(category, level, module2, message2, data) {
        const entry = {
          seq: ++this.seq,
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          category,
          level,
          module: module2,
          message: message2,
          data
        };
        this.catBufs.get(category)?.push(entry);
        this.globalBuf.push(entry);
        this.totalCounts[category]++;
        this.levelCounts[level]++;
        const prefix = `[OPS:${category}]`;
        switch (level) {
          case "error":
            logger.error(module2, `${prefix} ${message2}`, data);
            break;
          case "warn":
            logger.warn(module2, `${prefix} ${message2}`, data);
            break;
          default:
            logger.info(module2, `${prefix} ${message2}`, data);
            break;
        }
      }
      query(params = {}) {
        const { category, level, module: module2, keyword, since, until, limit = 50, afterSeq } = params;
        const maxLimit = Math.min(Math.max(limit || 50, 1), 500);
        let entries;
        if (category) {
          entries = this.catBufs.get(category)?.toArray() || [];
        } else {
          entries = this.globalBuf.toArray();
        }
        if (level) entries = entries.filter((e) => e.level === level);
        if (module2) entries = entries.filter((e) => e.module.toLowerCase().includes(module2.toLowerCase()));
        if (keyword) {
          const kw = keyword.toLowerCase();
          entries = entries.filter(
            (e) => (
              // @ts-expect-error - error message access
              e.message.toLowerCase().includes(kw) || e.data && JSON.stringify(e.data).toLowerCase().includes(kw)
            )
          );
        }
        if (since) entries = entries.filter((e) => e.timestamp >= since);
        if (until) entries = entries.filter((e) => e.timestamp <= until);
        if (afterSeq !== void 0) entries = entries.filter((e) => e.seq > afterSeq);
        return entries.slice(-maxLimit).reverse();
      }
      getSummary() {
        const latestByCategory = {};
        for (const cat of ALL_CATS) {
          latestByCategory[cat] = this.catBufs.get(cat)?.latest() ?? null;
        }
        return {
          categoryCounts: { ...this.totalCounts },
          levelCounts: { ...this.levelCounts },
          bufferCapacity: GLOBAL_BUF,
          bufferUsed: this.globalBuf.size(),
          totalLogged: this.seq,
          startedAt: this.startedAt,
          latestByCategory
        };
      }
    };
    opsCollector = new OpsCollector();
    __name(logMigration, "logMigration");
    __name(logMigrationError, "logMigrationError");
    __name(logIdGuardError, "logIdGuardError");
    __name(logOptimization, "logOptimization");
    __name(logOptimizationWarn, "logOptimizationWarn");
    __name(logOptimizationError, "logOptimizationError");
    __name(logSync, "logSync");
    __name(logSyncWarn, "logSyncWarn");
    __name(logSyncError, "logSyncError");
    __name(logSystem, "logSystem");
  }
});

