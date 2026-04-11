// Extracted from production dist/index.js
// Original module: server/utils/logger.ts
// Lines: 689

function escapeSql(str) {
  return str.replace(/'/g, "''").replace(/\\/g, "\\\\");
}
function resolveLogArgs(message2, metadata) {
  if (metadata instanceof Error) {
    const errMsg = metadata.message || String(metadata);
    const enrichedMessage = message2.endsWith(":") || message2.endsWith(": ") ? `${message2.trimEnd()} ${errMsg}` : `${message2} ${errMsg}`;
    return [enrichedMessage, { errorName: metadata.name, errorStack: metadata.stack?.slice(0, 500) }];
  }
  if (metadata !== void 0 && metadata !== null && typeof metadata === "object") {
    return [message2, metadata];
  }
  if (metadata !== void 0) {
    return [message2, { value: metadata }];
  }
  return [message2, void 0];
}
function createModuleLogger(moduleName) {
  return {
    debug: /* @__PURE__ */ __name((message2, metadata) => {
      const [msg, meta3] = resolveLogArgs(message2, metadata);
      logger.debug(moduleName, msg, meta3);
    }, "debug"),
    info: /* @__PURE__ */ __name((message2, metadata) => {
      const [msg, meta3] = resolveLogArgs(message2, metadata);
      logger.info(moduleName, msg, meta3);
    }, "info"),
    warn: /* @__PURE__ */ __name((message2, metadata) => {
      const [msg, meta3] = resolveLogArgs(message2, metadata);
      logger.warn(moduleName, msg, meta3);
    }, "warn"),
    error: /* @__PURE__ */ __name((message2, metadata) => {
      const [msg, meta3] = resolveLogArgs(message2, metadata);
      logger.error(moduleName, msg, meta3);
    }, "error"),
    fatal: /* @__PURE__ */ __name((message2, metadata) => {
      const [msg, meta3] = resolveLogArgs(message2, metadata);
      logger.fatal(moduleName, msg, meta3);
    }, "fatal")
  };
}
var LOG_LEVEL_NAMES, DEFAULT_CONFIG, RingBuffer, LogSampler, DbWriter, Logger, logger;
var init_logger = __esm({
  "server/utils/logger.ts"() {
    "use strict";
    LOG_LEVEL_NAMES = {
      [0 /* DEBUG */]: "DEBUG",
      [1 /* INFO */]: "INFO",
      [2 /* WARN */]: "WARN",
      [3 /* ERROR */]: "ERROR",
      [4 /* FATAL */]: "FATAL"
    };
    DEFAULT_CONFIG = {
      consoleLevel: 1 /* INFO */,
      dbLevel: 2 /* WARN */,
      bufferSize: 3e4,
      // v614j: 从10000恢复到30000 — 43.5%抑制率过高，需要更大缓冲区。每条~200B，30000条仅占~6MB
      samplingWindowMs: 3e4,
      // v614j: 从10秒扩大到30秒窗口 — 减少采样抑制频率
      samplingMaxPerWindow: 15,
      // v614j: 从5提升到15 — 每30秒最多15条同类日志，大幅降低抑制率
      dbFlushIntervalMs: 3e4,
      // 30秒批量写入
      dbFlushBatchSize: 200,
      // v369: 从100提升到200，加快缓冲区消耗速度
      dbRetentionDays: 7
      // 保留7天
    };
    RingBuffer = class {
      static {
        __name(this, "RingBuffer");
      }
      buffer;
      head = 0;
      count = 0;
      capacity;
      constructor(capacity) {
        this.capacity = capacity;
        this.buffer = new Array(capacity);
      }
      push(item) {
        this.buffer[this.head] = item;
        this.head = (this.head + 1) % this.capacity;
        if (this.count < this.capacity) this.count++;
      }
      /** 获取所有条目（从最新到最旧） */
      toArray() {
        const result = [];
        for (let i = 0; i < this.count; i++) {
          const idx = (this.head - 1 - i + this.capacity) % this.capacity;
          const item = this.buffer[idx];
          if (item !== void 0) result.push(item);
        }
        return result;
      }
      /** 获取最新的N条 */
      getLatest(n) {
        const count11 = Math.min(n, this.count);
        const result = [];
        for (let i = 0; i < count11; i++) {
          const idx = (this.head - 1 - i + this.capacity) % this.capacity;
          const item = this.buffer[idx];
          if (item !== void 0) result.push(item);
        }
        return result;
      }
      size() {
        return this.count;
      }
      getCapacity() {
        return this.capacity;
      }
      clear() {
        this.buffer = new Array(this.capacity);
        this.head = 0;
        this.count = 0;
      }
    };
    LogSampler = class {
      static {
        __name(this, "LogSampler");
      }
      states = /* @__PURE__ */ new Map();
      totalSuppressed = 0;
      windowMs;
      maxPerWindow;
      constructor(windowMs, maxPerWindow) {
        this.windowMs = windowMs;
        this.maxPerWindow = maxPerWindow;
      }
      /**
       * 判断是否应该输出此日志
       * @returns [shouldOutput, suppressedCount] — suppressedCount 是自上次输出以来被抑制的数量
       */
      shouldOutput(key) {
        const now = Date.now();
        let state = this.states.get(key);
        if (!state || now - state.windowStart > this.windowMs) {
          const suppressed = state?.suppressedCount || 0;
          this.states.set(key, { count: 1, windowStart: now, suppressedCount: 0 });
          return [true, suppressed];
        }
        state.count++;
        if (state.count <= this.maxPerWindow) {
          const suppressed = state.suppressedCount;
          state.suppressedCount = 0;
          return [true, suppressed];
        }
        state.suppressedCount++;
        this.totalSuppressed++;
        return [false, 0];
      }
      getTotalSuppressed() {
        return this.totalSuppressed;
      }
      /** 定期清理过期的采样状态 */
      cleanup() {
        const now = Date.now();
        const expireThreshold = this.windowMs * 3;
        for (const [key, state] of this.states.entries()) {
          if (now - state.windowStart > expireThreshold) {
            this.states.delete(key);
          }
        }
      }
    };
    DbWriter = class {
      static {
        __name(this, "DbWriter");
      }
      buffer = [];
      flushTimer = null;
      isWriting = false;
      getDb = null;
      batchSize;
      flushIntervalMs;
      retentionDays;
      lastCleanupTime = 0;
      constructor(batchSize, flushIntervalMs, retentionDays) {
        this.batchSize = batchSize;
        this.flushIntervalMs = flushIntervalMs;
        this.retentionDays = retentionDays;
      }
      setDbProvider(getDb3) {
        this.getDb = getDb3;
      }
      enqueue(entry) {
        this.buffer.push(entry);
        if (this.buffer.length >= this.batchSize) {
          this.flush().catch(() => {
          });
        }
      }
      startPeriodicFlush() {
        if (this.flushTimer) return;
        this.flushTimer = setInterval(() => {
          this.flush().catch(() => {
          });
          this.cleanupOldLogs().catch(() => {
          });
        }, this.flushIntervalMs);
        if (this.flushTimer.unref) this.flushTimer.unref();
      }
      stopPeriodicFlush() {
        if (this.flushTimer) {
          clearInterval(this.flushTimer);
          this.flushTimer = null;
        }
      }
      async flush() {
        if (this.isWriting || this.buffer.length === 0 || !this.getDb) return;
        this.isWriting = true;
        const batch = this.buffer.splice(0, this.batchSize);
        try {
          const db = await this.getDb();
          if (!db) {
            if (this.buffer.length < this.batchSize * 3) {
              this.buffer.unshift(...batch);
            }
            return;
          }
          const values = batch.map(
            (e) => `('${e.timestamp}', '${e.level}', '${escapeSql(e.module)}', '${escapeSql(e.message)}', ${e.metadata ? `'${escapeSql(e.metadata)}'` : "NULL"})`
          ).join(",");
          await db.execute(
            `INSERT INTO system_logs (timestamp, level, module, message, metadata) VALUES ${values}`
          );
        } catch (err) {
          if (err?.code !== "ER_NO_SUCH_TABLE") {
            process.stderr.write(`[Logger] DB flush error: ${err?.message || "unknown"}
`);
          }
        } finally {
          this.isWriting = false;
        }
      }
      async cleanupOldLogs() {
        const now = Date.now();
        if (now - this.lastCleanupTime < 36e5) return;
        this.lastCleanupTime = now;
        try {
          const db = await this.getDb?.();
          if (!db) return;
          const cutoff = new Date(now - this.retentionDays * 864e5).toISOString().slice(0, 19).replace("T", " ");
          await db.execute(
            `DELETE FROM system_logs WHERE timestamp < '${cutoff}' LIMIT 10000`
          );
        } catch {
        }
      }
      getBufferSize() {
        return this.buffer.length;
      }
    };
    __name(escapeSql, "escapeSql");
    Logger = class {
      static {
        __name(this, "Logger");
      }
      config;
      ringBuffer;
      sampler;
      dbWriter;
      nextId = 1;
      startTime = Date.now();
      recentTimestamps = [];
      // 最近1分钟的日志时间戳
      constructor(config2 = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config2 };
        this.ringBuffer = new RingBuffer(this.config.bufferSize);
        this.sampler = new LogSampler(this.config.samplingWindowMs, this.config.samplingMaxPerWindow);
        this.dbWriter = new DbWriter(
          this.config.dbFlushBatchSize,
          this.config.dbFlushIntervalMs,
          this.config.dbRetentionDays
        );
        const cleanupTimer = setInterval(() => this.sampler.cleanup(), 6e4);
        if (cleanupTimer.unref) cleanupTimer.unref();
      }
      /** 设置数据库提供者（延迟初始化，避免循环依赖） */
      setDbProvider(getDb3) {
        this.dbWriter.setDbProvider(getDb3);
        this.dbWriter.startPeriodicFlush();
      }
      /** 更新配置 */
      updateConfig(config2) {
        this.config = { ...this.config, ...config2 };
      }
      /** v362: 日志脱敏 - 移除敏感信息 */
      sanitize(message2) {
        if (!message2) return message2;
        try {
          const { sanitizeLogMessage: sanitizeLogMessage2 } = (init_logSanitizer(), __toCommonJS(logSanitizer_exports));
          return sanitizeLogMessage2(message2);
        } catch {
          return message2;
        }
      }
      // ==================== 日志写入方法 ====================
      debug(module2, message2, metadata) {
        this.log(0 /* DEBUG */, module2, message2, metadata);
      }
      info(module2, message2, metadata) {
        this.log(1 /* INFO */, module2, message2, metadata);
      }
      warn(module2, message2, metadata) {
        this.log(2 /* WARN */, module2, message2, metadata);
      }
      error(module2, message2, metadata) {
        this.log(3 /* ERROR */, module2, message2, metadata);
      }
      fatal(module2, message2, metadata) {
        this.log(4 /* FATAL */, module2, message2, metadata);
      }
      log(level, module2, message2, metadata) {
        const now = Date.now();
        const timestamp2 = new Date(now).toISOString();
        let suppressedCount = 0;
        if (level <= 1 /* INFO */) {
          const samplingKey = `${module2}:${this.getMessageTemplate(message2)}`;
          const [shouldOutput, suppressed] = this.sampler.shouldOutput(samplingKey);
          suppressedCount = suppressed;
          if (!shouldOutput) return;
        }
        const entry = {
          id: this.nextId++,
          timestamp: timestamp2,
          level,
          levelName: LOG_LEVEL_NAMES[level],
          module: module2,
          message: message2,
          metadata,
          suppressedCount: suppressedCount > 0 ? suppressedCount : void 0
        };
        this.ringBuffer.push(entry);
        let shouldConsoleOutput = level >= this.config.consoleLevel;
        if (!shouldConsoleOutput && level === 0 /* DEBUG */) {
          try {
            const { shouldEnableDebug: shouldEnableDebug2 } = (init_dynamicLogLevel(), __toCommonJS(dynamicLogLevel_exports));
            const accountId = metadata?.accountId;
            shouldConsoleOutput = shouldEnableDebug2(module2, accountId);
          } catch {
          }
        }
        if (shouldConsoleOutput) {
          this.writeToConsole(entry);
        }
        if (level >= this.config.dbLevel) {
          this.dbWriter.enqueue({
            timestamp: timestamp2.slice(0, 19).replace("T", " "),
            level: LOG_LEVEL_NAMES[level],
            module: module2,
            message: message2.slice(0, 2e3),
            // 截断超长消息
            metadata: metadata ? JSON.stringify(metadata).slice(0, 4e3) : null
          });
        }
        this.recentTimestamps.push(now);
        const oneMinuteAgo = now - 6e4;
        while (this.recentTimestamps.length > 0 && this.recentTimestamps[0] < oneMinuteAgo) {
          this.recentTimestamps.shift();
        }
      }
      /** 提取消息模板（用于采样去重） — 将数字和ID替换为占位符 */
      getMessageTemplate(message2) {
        return message2.replace(/\d+(\.\d+)?/g, "#").replace(/id=#/g, "id=#").slice(0, 100);
      }
      /** 格式化控制台输出 - v362: 集成日志脱敏 */
      writeToConsole(entry) {
        const levelTag = entry.levelName.padEnd(5);
        const suppressedInfo = entry.suppressedCount ? ` (+${entry.suppressedCount} suppressed)` : "";
        const sanitizedMessage = this.sanitize(entry.message);
        const line = `[${levelTag}] [${entry.module}] ${sanitizedMessage}${suppressedInfo}`;
        if (entry.level >= 3 /* ERROR */) {
          console.error(line);
        } else if (entry.level >= 2 /* WARN */) {
          console.warn(line);
        } else {
          console.log(line);
        }
      }
      // ==================== 查询方法 ====================
      /** 查询内存缓冲区中的日志 */
      query(params = {}) {
        const limit = Math.min(params.limit || 50, 100);
        let entries = this.ringBuffer.toArray();
        if (params.level !== void 0) {
          entries = entries.filter((e) => e.level >= params.level);
        }
        if (params.module) {
          const moduleLower = params.module.toLowerCase();
          entries = entries.filter((e) => e.module.toLowerCase().includes(moduleLower));
        }
        if (params.search) {
          const searchLower = params.search.toLowerCase();
          entries = entries.filter((e) => e.message.toLowerCase().includes(searchLower));
        }
        if (params.startTime) {
          entries = entries.filter((e) => e.timestamp >= params.startTime);
        }
        if (params.endTime) {
          entries = entries.filter((e) => e.timestamp <= params.endTime);
        }
        if (params.cursor !== void 0) {
          if (params.direction === "newer") {
            entries = entries.filter((e) => e.id > params.cursor);
            entries.reverse();
          } else {
            entries = entries.filter((e) => e.id < params.cursor);
          }
        }
        const total = entries.length;
        const sliced = entries.slice(0, limit);
        const hasMore = total > limit;
        const nextCursor = sliced.length > 0 ? sliced[sliced.length - 1].id : void 0;
        return { entries: sliced, total, hasMore, nextCursor };
      }
      /** 获取日志统计信息 */
      getStats() {
        const entries = this.ringBuffer.toArray();
        const byLevel = {};
        const moduleCount = /* @__PURE__ */ new Map();
        for (const entry of entries) {
          const levelName = entry.levelName;
          byLevel[levelName] = (byLevel[levelName] || 0) + 1;
          moduleCount.set(entry.module, (moduleCount.get(entry.module) || 0) + 1);
        }
        const byModule = Array.from(moduleCount.entries()).map(([module2, count11]) => ({ module: module2, count: count11 })).sort((a, b) => b.count - a.count).slice(0, 20);
        return {
          totalEntries: entries.length,
          byLevel,
          byModule,
          recentRate: this.recentTimestamps.length,
          bufferUsage: Math.round(this.ringBuffer.size() / this.ringBuffer.getCapacity() * 100),
          suppressedTotal: this.sampler.getTotalSuppressed()
        };
      }
      /** 获取最新的N条日志（快速方法） */
      getLatest(n = 50) {
        return this.ringBuffer.getLatest(Math.min(n, 100));
      }
      /** 获取特定模块的最新日志 */
      getModuleLogs(module2, limit = 50) {
        return this.query({ module: module2, limit }).entries;
      }
      /** 获取错误和警告日志 */
      getAlerts(limit = 50) {
        return this.query({ level: 2 /* WARN */, limit }).entries;
      }
      /** 强制刷写数据库缓冲区 */
      async flush() {
        await this.dbWriter.flush();
      }
      /** 获取运行状态 */
      getStatus() {
        return {
          uptime: Math.round((Date.now() - this.startTime) / 1e3),
          config: { ...this.config },
          bufferSize: this.ringBuffer.size(),
          bufferCapacity: this.ringBuffer.getCapacity(),
          dbBufferSize: this.dbWriter.getBufferSize(),
          recentRate: this.recentTimestamps.length,
          suppressedTotal: this.sampler.getTotalSuppressed()
        };
      }
      /** 清理资源 */
      destroy() {
        this.dbWriter.stopPeriodicFlush();
        this.dbWriter.flush().catch(() => {
        });
      }
    };
    logger = new Logger({
      consoleLevel: process.env.LOG_LEVEL === "debug" ? 0 /* DEBUG */ : 1 /* INFO */,
      dbLevel: 2 /* WARN */,
      bufferSize: 3e4
      // v614j: 恢复到30000，配合更宽松的采样策略，将抑制率从43.5%降至<15%
    });
    __name(resolveLogArgs, "resolveLogArgs");
    __name(createModuleLogger, "createModuleLogger");
  }
});

// node_modules/sqlstring/lib/SqlString.js
var require_SqlString = __commonJS({
  "node_modules/sqlstring/lib/SqlString.js"(exports2) {
    var SqlString = exports2;
    var ID_GLOBAL_REGEXP = /`/g;
    var QUAL_GLOBAL_REGEXP = /\./g;
    var CHARS_GLOBAL_REGEXP = /[\0\b\t\n\r\x1a\"\'\\]/g;
    var CHARS_ESCAPE_MAP = {
      "\0": "\\0",
      "\b": "\\b",
      "	": "\\t",
      "\n": "\\n",
      "\r": "\\r",
      "": "\\Z",
      '"': '\\"',
      "'": "\\'",
      "\\": "\\\\"
    };
    SqlString.escapeId = /* @__PURE__ */ __name(function escapeId(val, forbidQualified) {
      if (Array.isArray(val)) {
        var sql15 = "";
        for (var i = 0; i < val.length; i++) {
          sql15 += (i === 0 ? "" : ", ") + SqlString.escapeId(val[i], forbidQualified);
        }
        return sql15;
      } else if (forbidQualified) {
        return "`" + String(val).replace(ID_GLOBAL_REGEXP, "``") + "`";
      } else {
        return "`" + String(val).replace(ID_GLOBAL_REGEXP, "``").replace(QUAL_GLOBAL_REGEXP, "`.`") + "`";
      }
    }, "escapeId");
    SqlString.escape = /* @__PURE__ */ __name(function escape(val, stringifyObjects, timeZone) {
      if (val === void 0 || val === null) {
        return "NULL";
      }
      switch (typeof val) {
        case "boolean":
          return val ? "true" : "false";
        case "number":
          return val + "";
        case "object":
          if (Object.prototype.toString.call(val) === "[object Date]") {
            return SqlString.dateToString(val, timeZone || "local");
          } else if (Array.isArray(val)) {
            return SqlString.arrayToList(val, timeZone);
          } else if (Buffer.isBuffer(val)) {
            return SqlString.bufferToString(val);
          } else if (typeof val.toSqlString === "function") {
            return String(val.toSqlString());
          } else if (stringifyObjects) {
            return escapeString(val.toString());
          } else {
            return SqlString.objectToValues(val, timeZone);
          }
        default:
          return escapeString(val);
      }
    }, "escape");
    SqlString.arrayToList = /* @__PURE__ */ __name(function arrayToList(array2, timeZone) {
      var sql15 = "";
      for (var i = 0; i < array2.length; i++) {
        var val = array2[i];
        if (Array.isArray(val)) {
          sql15 += (i === 0 ? "" : ", ") + "(" + SqlString.arrayToList(val, timeZone) + ")";
        } else {
          sql15 += (i === 0 ? "" : ", ") + SqlString.escape(val, true, timeZone);
        }
      }
      return sql15;
    }, "arrayToList");
    SqlString.format = /* @__PURE__ */ __name(function format(sql15, values, stringifyObjects, timeZone) {
      if (values == null) {
        return sql15;
      }
      if (!Array.isArray(values)) {
        values = [values];
      }
      var chunkIndex = 0;
      var placeholdersRegex = /\?+/g;
      var result = "";
      var valuesIndex = 0;
      var match;
      while (valuesIndex < values.length && (match = placeholdersRegex.exec(sql15))) {
        var len = match[0].length;
        if (len > 2) {
          continue;
        }
        var value = len === 2 ? SqlString.escapeId(values[valuesIndex]) : SqlString.escape(values[valuesIndex], stringifyObjects, timeZone);
        result += sql15.slice(chunkIndex, match.index) + value;
        chunkIndex = placeholdersRegex.lastIndex;
        valuesIndex++;
      }
      if (chunkIndex === 0) {
        return sql15;
      }
      if (chunkIndex < sql15.length) {
        return result + sql15.slice(chunkIndex);
      }
      return result;
    }, "format");
    SqlString.dateToString = /* @__PURE__ */ __name(function dateToString(date6, timeZone) {
      var dt = new Date(date6);
      if (isNaN(dt.getTime())) {
        return "NULL";
      }
      var year3;
      var month;
      var day2;
      var hour2;
      var minute2;
      var second;
      var millisecond;
      if (timeZone === "local") {
        year3 = dt.getFullYear();
        month = dt.getMonth() + 1;
        day2 = dt.getDate();
        hour2 = dt.getHours();
        minute2 = dt.getMinutes();
        second = dt.getSeconds();
        millisecond = dt.getMilliseconds();
      } else {
        var tz = convertTimezone(timeZone);
        if (tz !== false && tz !== 0) {
          dt.setTime(dt.getTime() + tz * 6e4);
        }
        year3 = dt.getUTCFullYear();
        month = dt.getUTCMonth() + 1;
        day2 = dt.getUTCDate();
        hour2 = dt.getUTCHours();
        minute2 = dt.getUTCMinutes();
        second = dt.getUTCSeconds();
        millisecond = dt.getUTCMilliseconds();
      }
      var str = zeroPad(year3, 4) + "-" + zeroPad(month, 2) + "-" + zeroPad(day2, 2) + " " + zeroPad(hour2, 2) + ":" + zeroPad(minute2, 2) + ":" + zeroPad(second, 2) + "." + zeroPad(millisecond, 3);
      return escapeString(str);
    }, "dateToString");
    SqlString.bufferToString = /* @__PURE__ */ __name(function bufferToString(buffer2) {
      return "X" + escapeString(buffer2.toString("hex"));
    }, "bufferToString");
    SqlString.objectToValues = /* @__PURE__ */ __name(function objectToValues(object2, timeZone) {
      var sql15 = "";
      for (var key in object2) {
        var val = object2[key];
        if (typeof val === "function") {
          continue;
        }
        sql15 += (sql15.length === 0 ? "" : ", ") + SqlString.escapeId(key) + " = " + SqlString.escape(val, true, timeZone);
      }
      return sql15;
    }, "objectToValues");
    SqlString.raw = /* @__PURE__ */ __name(function raw(sql15) {
      if (typeof sql15 !== "string") {
        throw new TypeError("argument sql must be a string");
      }
      return {
        toSqlString: /* @__PURE__ */ __name(function toSqlString() {
          return sql15;
        }, "toSqlString")
      };
    }, "raw");
    function escapeString(val) {
      var chunkIndex = CHARS_GLOBAL_REGEXP.lastIndex = 0;
      var escapedVal = "";
      var match;
      while (match = CHARS_GLOBAL_REGEXP.exec(val)) {
        escapedVal += val.slice(chunkIndex, match.index) + CHARS_ESCAPE_MAP[match[0]];
        chunkIndex = CHARS_GLOBAL_REGEXP.lastIndex;
      }
      if (chunkIndex === 0) {
        return "'" + val + "'";
      }
      if (chunkIndex < val.length) {
        return "'" + escapedVal + val.slice(chunkIndex) + "'";
      }
      return "'" + escapedVal + "'";
    }
    __name(escapeString, "escapeString");
    function zeroPad(number4, length) {
      number4 = number4.toString();
      while (number4.length < length) {
        number4 = "0" + number4;
      }
      return number4;
    }
    __name(zeroPad, "zeroPad");
    function convertTimezone(tz) {
      if (tz === "Z") {
        return 0;
      }
      var m = tz.match(/([\+\-\s])(\d\d):?(\d\d)?/);
      if (m) {
        return (m[1] === "-" ? -1 : 1) * (parseInt(m[2], 10) + (m[3] ? parseInt(m[3], 10) : 0) / 60) * 60;
      }
      return false;
    }
    __name(convertTimezone, "convertTimezone");
  }
});

// node_modules/sqlstring/index.js
var require_sqlstring = __commonJS({
  "node_modules/sqlstring/index.js"(exports2, module2) {
    module2.exports = require_SqlString();
  }
});

