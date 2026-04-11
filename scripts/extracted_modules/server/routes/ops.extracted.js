// Extracted from production dist/index.js
// Original module: server/routes/ops.ts
// Lines: 1919

function opsAuth(req, res, next) {
  const apiKey = process.env.OPS_API_KEY;
  if (!apiKey) {
    res.status(503).json({
      error: "Service Unavailable",
      message: "OPS_API_KEY \u73AF\u5883\u53D8\u91CF\u672A\u914D\u7F6E\uFF0C\u8FD0\u7EF4\u63A5\u53E3\u5DF2\u7981\u7528\u3002"
    });
    return;
  }
  const providedKey = req.headers["x-ops-key"] || req.headers["authorization"]?.replace("Bearer ", "") || req.query.key;
  if (providedKey !== apiKey) {
    res.status(401).json({
      error: "Unauthorized",
      message: "\u9700\u8981\u6709\u6548\u7684\u8FD0\u7EF4API\u5BC6\u94A5\u3002\u901A\u8FC7 X-Ops-Key header \u6216 ?key= \u53C2\u6570\u63D0\u4F9B\u3002"
    });
    return;
  }
  next();
}
function evaluateAlerts(memUsage, dbStatus, dbLatencyMs, loggerStatus, opsSummary, uptimeSec) {
  const alerts = [];
  const rssMB = memUsage.rss / (1024 * 1024);
  if (rssMB >= ALERT_THRESHOLDS2.memory.rssCriticalMB) {
    alerts.push({
      metric: "memory.rss",
      level: "critical",
      message: `RSS\u5185\u5B58 ${rssMB.toFixed(0)}MB \u8D85\u8FC7\u4E25\u91CD\u9608\u503C ${ALERT_THRESHOLDS2.memory.rssCriticalMB}MB`,
      value: `${rssMB.toFixed(0)}MB`,
      threshold: `${ALERT_THRESHOLDS2.memory.rssCriticalMB}MB`
    });
  } else if (rssMB >= ALERT_THRESHOLDS2.memory.rssWarningMB) {
    alerts.push({
      metric: "memory.rss",
      level: "warning",
      message: `RSS\u5185\u5B58 ${rssMB.toFixed(0)}MB \u8D85\u8FC7\u8B66\u544A\u9608\u503C ${ALERT_THRESHOLDS2.memory.rssWarningMB}MB`,
      value: `${rssMB.toFixed(0)}MB`,
      threshold: `${ALERT_THRESHOLDS2.memory.rssWarningMB}MB`
    });
  }
  const heapSizeLimit = import_v85.default.getHeapStatistics().heap_size_limit;
  const heapPct = memUsage.heapUsed / heapSizeLimit * 100;
  const heapUsedMB = memUsage.heapUsed / (1024 * 1024);
  const heapSizeLimitMB = Math.round(heapSizeLimit / 1024 / 1024);
  const heapAbsoluteSafe = heapUsedMB < ALERT_THRESHOLDS2.memory.heapUsedWarningMB;
  if (!heapAbsoluteSafe && heapPct >= ALERT_THRESHOLDS2.memory.heapCriticalPct) {
    alerts.push({
      metric: "memory.heapUsage",
      level: "critical",
      message: `\u5806\u5185\u5B58\u4F7F\u7528\u7387 ${heapPct.toFixed(1)}% \u8D85\u8FC7\u4E25\u91CD\u9608\u503C ${ALERT_THRESHOLDS2.memory.heapCriticalPct}% (${heapUsedMB.toFixed(0)}MB / ${heapSizeLimitMB}MB)`,
      value: `${heapPct.toFixed(1)}%`,
      threshold: `${ALERT_THRESHOLDS2.memory.heapCriticalPct}%`
    });
  } else if (!heapAbsoluteSafe && heapPct >= ALERT_THRESHOLDS2.memory.heapWarningPct) {
    alerts.push({
      metric: "memory.heapUsage",
      level: "warning",
      message: `\u5806\u5185\u5B58\u4F7F\u7528\u7387 ${heapPct.toFixed(1)}% \u8D85\u8FC7\u8B66\u544A\u9608\u503C ${ALERT_THRESHOLDS2.memory.heapWarningPct}% (${heapUsedMB.toFixed(0)}MB / ${heapSizeLimitMB}MB)`,
      value: `${heapPct.toFixed(1)}%`,
      threshold: `${ALERT_THRESHOLDS2.memory.heapWarningPct}%`
    });
  }
  if (heapUsedMB >= ALERT_THRESHOLDS2.memory.heapUsedCriticalMB) {
    alerts.push({
      metric: "memory.heapUsedAbsolute",
      level: "critical",
      message: `\u5806\u5185\u5B58\u4F7F\u7528 ${heapUsedMB.toFixed(0)}MB \u8D85\u8FC7\u4E25\u91CD\u9608\u503C ${ALERT_THRESHOLDS2.memory.heapUsedCriticalMB}MB`,
      value: `${heapUsedMB.toFixed(0)}MB`,
      threshold: `${ALERT_THRESHOLDS2.memory.heapUsedCriticalMB}MB`
    });
  } else if (heapUsedMB >= ALERT_THRESHOLDS2.memory.heapUsedWarningMB) {
    alerts.push({
      metric: "memory.heapUsedAbsolute",
      level: "warning",
      message: `\u5806\u5185\u5B58\u4F7F\u7528 ${heapUsedMB.toFixed(0)}MB \u8D85\u8FC7\u8B66\u544A\u9608\u503C ${ALERT_THRESHOLDS2.memory.heapUsedWarningMB}MB`,
      value: `${heapUsedMB.toFixed(0)}MB`,
      threshold: `${ALERT_THRESHOLDS2.memory.heapUsedWarningMB}MB`
    });
  }
  if (dbStatus.startsWith("error")) {
    alerts.push({
      metric: "database.connection",
      level: "critical",
      message: `\u6570\u636E\u5E93\u8FDE\u63A5\u5F02\u5E38: ${dbStatus}`,
      value: dbStatus,
      threshold: "connected"
    });
  } else if (dbLatencyMs >= ALERT_THRESHOLDS2.database.latencyCriticalMs) {
    alerts.push({
      metric: "database.latency",
      level: "critical",
      message: `\u6570\u636E\u5E93\u5EF6\u8FDF ${dbLatencyMs}ms \u8D85\u8FC7\u4E25\u91CD\u9608\u503C ${ALERT_THRESHOLDS2.database.latencyCriticalMs}ms`,
      value: dbLatencyMs,
      threshold: ALERT_THRESHOLDS2.database.latencyCriticalMs
    });
  } else if (dbLatencyMs >= ALERT_THRESHOLDS2.database.latencyWarningMs) {
    alerts.push({
      metric: "database.latency",
      level: "warning",
      message: `\u6570\u636E\u5E93\u5EF6\u8FDF ${dbLatencyMs}ms \u8D85\u8FC7\u8B66\u544A\u9608\u503C ${ALERT_THRESHOLDS2.database.latencyWarningMs}ms`,
      value: dbLatencyMs,
      threshold: ALERT_THRESHOLDS2.database.latencyWarningMs
    });
  }
  const errorCount = opsSummary?.levelCounts?.error || 0;
  if (errorCount >= ALERT_THRESHOLDS2.logger.errorRateCritical) {
    alerts.push({
      metric: "logger.errorCount",
      level: "critical",
      message: `\u7D2F\u8BA1\u9519\u8BEF\u65E5\u5FD7 ${errorCount} \u6761\u8D85\u8FC7\u4E25\u91CD\u9608\u503C ${ALERT_THRESHOLDS2.logger.errorRateCritical}`,
      value: errorCount,
      threshold: ALERT_THRESHOLDS2.logger.errorRateCritical
    });
  } else if (errorCount >= ALERT_THRESHOLDS2.logger.errorRateWarning) {
    alerts.push({
      metric: "logger.errorCount",
      level: "warning",
      message: `\u7D2F\u8BA1\u9519\u8BEF\u65E5\u5FD7 ${errorCount} \u6761\u8D85\u8FC7\u8B66\u544A\u9608\u503C ${ALERT_THRESHOLDS2.logger.errorRateWarning}`,
      value: errorCount,
      threshold: ALERT_THRESHOLDS2.logger.errorRateWarning
    });
  }
  if (loggerStatus.bufferCapacity > 0) {
    const bufPct = loggerStatus.bufferSize / loggerStatus.bufferCapacity * 100;
    if (bufPct >= ALERT_THRESHOLDS2.logger.bufferUsagePct) {
      alerts.push({
        metric: "logger.bufferUsage",
        level: "warning",
        message: `\u65E5\u5FD7\u7F13\u51B2\u533A\u4F7F\u7528\u7387 ${bufPct.toFixed(1)}% \u8D85\u8FC7\u9608\u503C ${ALERT_THRESHOLDS2.logger.bufferUsagePct}%`,
        value: `${bufPct.toFixed(1)}%`,
        threshold: `${ALERT_THRESHOLDS2.logger.bufferUsagePct}%`
      });
    }
  }
  const suppressedTotal = loggerStatus.suppressedTotal || 0;
  const totalEntries = loggerStatus.totalEntries || loggerStatus.bufferSize || 1;
  const suppressedPct = totalEntries > 0 ? suppressedTotal / (totalEntries + suppressedTotal) * 100 : 0;
  if (suppressedPct >= (ALERT_THRESHOLDS2.logger.suppressedRateWarning || 20)) {
    alerts.push({
      metric: "logger.suppressedRate",
      level: "warning",
      // @ts-ignore
      message: `\u65E5\u5FD7\u91C7\u6837\u6291\u5236\u7387 ${suppressedPct.toFixed(1)}% \u8D85\u8FC7\u9608\u503C ${ALERT_THRESHOLDS2.logger.suppressedRateWarning}%\uFF0C\u90E8\u5206\u91CD\u590D\u65E5\u5FD7\u88AB\u4E22\u5F03`,
      value: `${suppressedPct.toFixed(1)}%`,
      // @ts-ignore
      threshold: `${ALERT_THRESHOLDS2.logger.suppressedRateWarning}%`
    });
  }
  if (uptimeSec < ALERT_THRESHOLDS2.uptime.recentRestartSec) {
    alerts.push({
      metric: "system.uptime",
      level: "warning",
      message: `\u7CFB\u7EDF\u5728 ${Math.round(uptimeSec)} \u79D2\u524D\u521A\u91CD\u542F\uFF0C\u53EF\u80FD\u5B58\u5728\u5F02\u5E38\u91CD\u542F`,
      value: `${Math.round(uptimeSec)}s`,
      threshold: `${ALERT_THRESHOLDS2.uptime.recentRestartSec}s`
    });
  }
  const hasCritical = alerts.some((a) => a.level === "critical");
  const hasWarning = alerts.some((a) => a.level === "warning");
  const overallLevel = hasCritical ? "critical" : hasWarning ? "warning" : "ok";
  return { overallLevel, alerts };
}
function parseOpsQuery(req) {
  return {
    category: req.query.category,
    // @ts-expect-error - type assertion
    level: req.query.level,
    module: req.query.module,
    keyword: req.query.keyword || req.query.search || void 0,
    since: req.query.since,
    until: req.query.until,
    limit: parseInt(req.query.limit) || 50,
    afterSeq: req.query.afterSeq ? parseInt(req.query.afterSeq) : void 0
  };
}
function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor(seconds % 86400 / 3600);
  const m = Math.floor(seconds % 3600 / 60);
  const s = Math.floor(seconds % 60);
  const parts = [];
  if (d > 0) parts.push(`${d}\u5929`);
  if (h > 0) parts.push(`${h}\u5C0F\u65F6`);
  if (m > 0) parts.push(`${m}\u5206\u949F`);
  parts.push(`${s}\u79D2`);
  return parts.join("");
}
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
function extractCount2(result) {
  if (!result) return 0;
  if (Array.isArray(result)) {
    const first = result[0];
    if (first) {
      return first.cnt ?? first.total ?? first.count ?? 0;
    }
    return 0;
  }
  return result.cnt ?? result.total ?? result.count ?? 0;
}
var import_express3, import_v85, router3, ALERT_THRESHOLDS2, VALID_CATEGORIES, ops_default;
var init_ops = __esm({
  "server/routes/ops.ts"() {
    "use strict";
    import_express3 = require("express");
    import_v85 = __toESM(require("v8"));
    init_opsLogger();
    init_logger();
    init_deployLifecycleManager();
    init_postDeployOptimizer();
    init_db2();
    init_drizzle_orm();
    router3 = (0, import_express3.Router)();
    __name(opsAuth, "opsAuth");
    router3.use(opsAuth);
    ALERT_THRESHOLDS2 = {
      memory: {
        rssWarningMB: 1200,
        // v447: RSS内存警告阈值（MB）- 3072MB堆限制下，RSS通常是堆的2-3倍，1200MB是合理警告线
        rssCriticalMB: 2e3,
        // v447: RSS内存严重阈值（MB）- 接近3GB堆限制时才告警
        heapWarningPct: 90,
        // 堆内存使用率警告阈值（%）- V8常态80-90%是正常的
        heapCriticalPct: 96,
        // 堆内存使用率严重阈值（%）- 只有接近OOM才告警
        heapUsedWarningMB: 768,
        // v447: 堆内存绝对值警告阈值（MB）- 3072MB堆限制的25%
        heapUsedCriticalMB: 1536
        // v447: 堆内存绝对值严重阈值（MB）- 3072MB堆限制的50%
      },
      database: {
        latencyWarningMs: 500,
        // DB延迟警告阈值（ms）
        latencyCriticalMs: 2e3
        // DB延迟严重阈值（ms）
      },
      logger: {
        errorRateWarning: 50,
        // v222: 错误日志数量警告阈值（近期）
        errorRateCritical: 200,
        // v222: 错误日志数量严重阈值（近期）
        bufferUsagePct: 101,
        // v614i-fix23-patch: 环形缓冲区必然达到100%，设为101禁用此告警（改用日志抑制率监控）
        suppressedRateWarning: 20
        // v614i-fix23-patch: 日志抑制率警告阈值（%）— 超过20%的日志被采样抑制时告警
      },
      uptime: {
        recentRestartSec: 300
        // 最近重启判定阈值（5分钟内）
      }
    };
    __name(evaluateAlerts, "evaluateAlerts");
    router3.get("/status", async (req, res) => {
      try {
        const sysInfo = getSystemInfo();
        const memUsage = process.memoryUsage();
        let dbStatus = "unknown";
        let dbLatencyMs = -1;
        try {
          const dbStart = Date.now();
          const db = await getDb();
          if (db) {
            await db.execute(sql.raw("SELECT 1"));
            dbLatencyMs = Date.now() - dbStart;
            dbStatus = "connected";
          } else {
            dbStatus = "not_configured";
          }
        } catch (e) {
          dbStatus = `error: ${e.message}`;
        }
        const loggerStatus = logger.getStatus();
        const opsSummary = opsCollector.getSummary();
        const alertResult = evaluateAlerts(
          memUsage,
          dbStatus,
          dbLatencyMs,
          loggerStatus,
          opsSummary,
          sysInfo.uptime
        );
        res.json({
          // v211: 告警系统
          health: {
            level: alertResult.overallLevel,
            alertCount: alertResult.alerts.length,
            alerts: alertResult.alerts,
            thresholds: ALERT_THRESHOLDS2
          },
          system: {
            version: `v${SYSTEM_VERSION}`,
            versionNumber: SYSTEM_VERSION,
            nodeVersion: process.version,
            platform: process.platform,
            arch: process.arch,
            pid: process.pid,
            uptime: Math.round(sysInfo.uptime),
            uptimeFormatted: formatUptime(sysInfo.uptime),
            isShuttingDown: sysInfo.isShuttingDown,
            activeTasks: sysInfo.activeTasks
          },
          memory: {
            rss: formatBytes(memUsage.rss),
            heapUsed: formatBytes(memUsage.heapUsed),
            heapTotal: formatBytes(memUsage.heapTotal),
            external: formatBytes(memUsage.external),
            rssRaw: memUsage.rss,
            heapUsedRaw: memUsage.heapUsed,
            heapUsagePct: (memUsage.heapUsed / import_v85.default.getHeapStatistics().heap_size_limit * 100).toFixed(1) + "%"
          },
          database: {
            status: dbStatus,
            latencyMs: dbLatencyMs
          },
          // v427: Redis 状态
          redis: await (async () => {
            try {
              const { isRedisAvailable: isRedisAvailable2, redisHealthCheck: redisHealthCheck2 } = await Promise.resolve().then(() => (init_redisClient(), redisClient_exports));
              if (isRedisAvailable2()) {
                const health = await redisHealthCheck2();
                return { status: "connected", latencyMs: health.latencyMs };
              }
              return { status: "disconnected", latencyMs: -1 };
            } catch {
              return { status: "unavailable", latencyMs: -1 };
            }
          })(),
          logger: {
            bufferUsage: `${loggerStatus.bufferSize}/${loggerStatus.bufferCapacity}`,
            recentRate: `${loggerStatus.recentRate} logs/min`,
            suppressedTotal: loggerStatus.suppressedTotal,
            dbBufferPending: loggerStatus.dbBufferSize
          },
          opsLogger: opsSummary,
          // v384: 单实例模式
          instanceMode: "standalone",
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });
    router3.get("/summary", (req, res) => {
      try {
        const summary = opsCollector.getSummary();
        res.json({
          ...summary,
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });
    router3.get("/logs", (req, res) => {
      try {
        const query = parseOpsQuery(req);
        const entries = opsCollector.query(query);
        res.json({
          query,
          count: entries.length,
          entries,
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });
    VALID_CATEGORIES = ["migration", "id-guard", "optimization", "sync", "error", "system"];
    router3.get("/logs/:category", (req, res) => {
      try {
        const category = req.params.category;
        const normalizedCategory = category === "errors" ? "error" : category;
        if (!VALID_CATEGORIES.includes(normalizedCategory)) {
          res.status(400).json({
            error: `\u65E0\u6548\u7684\u65E5\u5FD7\u5206\u7C7B: ${category}`,
            validCategories: VALID_CATEGORIES
          });
          return;
        }
        const query = parseOpsQuery(req);
        query.category = normalizedCategory;
        const entries = opsCollector.query(query);
        res.json({
          category: normalizedCategory,
          query,
          count: entries.length,
          entries,
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });
    router3.get("/data-integrity", async (req, res) => {
      try {
        const db = await getDb();
        if (!db) {
          res.status(503).json({ error: "\u6570\u636E\u5E93\u4E0D\u53EF\u7528" });
          return;
        }
        const checks = {};
        try {
          const [totalResult] = await db.execute(sql.raw(
            `SELECT COUNT(*) as total FROM campaigns`
          ));
          const [invalidResult] = await db.execute(sql.raw(
            // @ts-ignore
            `SELECT COUNT(*) as cnt FROM campaigns WHERE LENGTH(campaignId) <= 5`
            // @ts-ignore
          ));
          checks.campaigns = {
            status: "checked",
            // @ts-ignore
            total: extractCount2(totalResult),
            // @ts-ignore
            suspectedLocalIds: extractCount2(invalidResult),
            // @ts-ignore
            verdict: extractCount2(invalidResult) === 0 ? "PASS" : "WARN"
          };
        } catch (e) {
          checks.campaigns = { status: "error", message: e.message };
        }
        const fkTables = ["negative_keywords", "bidding_logs", "daily_performance", "search_terms", "ad_groups", "placement_performance"];
        for (const table of fkTables) {
          try {
            const [totalResult] = await db.execute(sql.raw(
              `SELECT COUNT(*) as total FROM \`${table}\` WHERE campaignId IS NOT NULL AND campaignId != ''`
            ));
            const [localIdResult] = await db.execute(sql.raw(
              `SELECT COUNT(*) as cnt FROM \`${table}\` WHERE LENGTH(campaignId) <= 5 AND campaignId REGEXP '^[0-9]+$'`
              // @ts-ignore
            ));
            const [orphanResult] = await db.execute(sql.raw(
              // @ts-ignore
              `SELECT COUNT(*) as cnt FROM \`${table}\` t 
           LEFT JOIN campaigns c ON t.campaignId = c.campaignId 
           WHERE t.campaignId IS NOT NULL AND t.campaignId != '' AND c.id IS NULL`
            ));
            const total = extractCount2(totalResult);
            const localIds = extractCount2(localIdResult);
            const orphans = extractCount2(orphanResult);
            checks[table] = {
              status: "checked",
              total,
              suspectedLocalIds: localIds,
              orphanedRecords: orphans,
              verdict: localIds === 0 && orphans === 0 ? "PASS" : localIds > 0 ? "FAIL" : "WARN"
            };
          } catch (e) {
            checks[table] = { status: "error", message: e.message };
          }
        }
        try {
          const [totalAgResult] = await db.execute(sql.raw(
            `SELECT COUNT(*) as total FROM ad_groups WHERE campaignId IS NOT NULL AND campaignId != ''`
          ));
          const [orphanResult] = await db.execute(sql.raw(
            `SELECT COUNT(*) as cnt FROM ad_groups ag 
         LEFT JOIN campaigns c ON ag.campaignId = c.campaignId AND ag.accountId = c.accountId
         WHERE ag.campaignId IS NOT NULL AND ag.campaignId != '' AND c.id IS NULL`
          ));
          const totalAg = extractCount2(totalAgResult);
          const orphanCount = extractCount2(orphanResult);
          checks.joinIntegrity = {
            status: "checked",
            // @ts-ignore
            adGroupsTotal: totalAg,
            // @ts-ignore
            successfulJoins: totalAg - orphanCount,
            // @ts-ignore
            orphanedAdGroups: orphanCount,
            verdict: orphanCount === 0 ? "PASS" : "WARN",
            note: "v380: \u4F7F\u7528LEFT JOIN+accountId\u7CBE\u786E\u7EDF\u8BA1\u5B64\u7ACB\u5E7F\u544A\u7EC4"
          };
        } catch (e) {
          checks.joinIntegrity = { status: "error", message: e.message };
        }
        const allChecks = Object.values(checks);
        const hasFailure = allChecks.some((c) => c.verdict === "FAIL");
        const hasWarning = allChecks.some((c) => c.verdict === "WARN");
        const hasError = allChecks.some((c) => c.status === "error");
        res.json({
          overallStatus: hasFailure ? "FAIL" : hasError ? "ERROR" : hasWarning ? "WARN" : "PASS",
          description: "ID\u7CFB\u7EDF\u6570\u636E\u5B8C\u6574\u6027\u68C0\u67E5 \u2014 \u9A8C\u8BC1\u6240\u6709\u8868\u7684campaignId\u662F\u5426\u4E3AAmazon ID\u683C\u5F0F",
          checks,
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });
    router3.get("/db-logs", async (req, res) => {
      try {
        const db = await getDb();
        if (!db) {
          res.status(503).json({ error: "\u6570\u636E\u5E93\u4E0D\u53EF\u7528" });
          return;
        }
        const level = req.query.level || "";
        const module2 = req.query.module || "";
        const keyword = req.query.keyword || "";
        const limit = Math.min(parseInt(req.query.limit) || 50, 2e3);
        const hours = parseInt(req.query.hours) || 24;
        let whereClause = `WHERE timestamp >= DATE_SUB(NOW(), INTERVAL ${hours} HOUR)`;
        if (level) whereClause += ` AND level = '${level.toUpperCase()}'`;
        if (module2) whereClause += ` AND module LIKE '%${module2}%'`;
        if (keyword) whereClause += ` AND message LIKE '%${keyword}%'`;
        const [rows] = await db.execute(sql.raw(
          `SELECT id, timestamp, level, module, message, metadata 
       FROM system_logs 
       ${whereClause}
       ORDER BY id DESC 
       LIMIT ${limit}`
        ));
        const [statsRows] = await db.execute(sql.raw(
          `SELECT level, COUNT(*) as cnt 
       FROM system_logs 
       WHERE timestamp >= DATE_SUB(NOW(), INTERVAL ${hours} HOUR)
       GROUP BY level`
        ));
        res.json({
          query: { level, module: module2, keyword, limit, hours },
          count: Array.isArray(rows) ? rows.length : 0,
          entries: rows,
          stats: statsRows,
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        });
      } catch (e) {
        if (e.message?.includes("ER_NO_SUCH_TABLE") || e.message?.includes("doesn't exist")) {
          res.json({
            query: req.query,
            count: 0,
            entries: [],
            stats: [],
            note: "system_logs\u8868\u5C1A\u672A\u521B\u5EFA\uFF0C\u6570\u636E\u5E93\u65E5\u5FD7\u6301\u4E45\u5316\u672A\u542F\u7528",
            timestamp: (/* @__PURE__ */ new Date()).toISOString()
          });
        } else {
          res.status(500).json({ error: e.message });
        }
      }
    });
    router3.get("/optimization-events", async (req, res) => {
      try {
        const db = await getDb();
        if (!db) {
          res.status(503).json({ error: "\u6570\u636E\u5E93\u4E0D\u53EF\u7528" });
          return;
        }
        const limit = Math.min(parseInt(req.query.limit) || 50, 2e3);
        const hours = parseInt(req.query.hours) || 24;
        const category = req.query.category || "";
        const status = req.query.status || "";
        let whereClause = `WHERE created_at >= DATE_SUB(NOW(), INTERVAL ${hours} HOUR)`;
        if (category) whereClause += ` AND event_category = '${category}'`;
        const [rows] = await db.execute(sql.raw(
          `SELECT id, event_category, action_type, 
              campaign_name, change_reason, algorithm_version,
              previous_value, new_value, 
              api_sync_status, api_sync_detail,
              keyword_text, previous_bid, new_bid, bid_change_percent,
              created_at
       FROM optimization_events 
       ${whereClause}
       ORDER BY id DESC 
       LIMIT ${limit}`
        ));
        const [statsRows] = await db.execute(sql.raw(
          `SELECT event_category, COUNT(*) as cnt 
       FROM optimization_events 
       WHERE created_at >= DATE_SUB(NOW(), INTERVAL ${hours} HOUR)
       GROUP BY event_category`
        ));
        let apiSyncStats = [];
        try {
          const [syncRows] = await db.execute(sql.raw(
            `SELECT 
           event_category,
           api_sync_status,
           COUNT(*) as cnt
         FROM optimization_events 
         WHERE created_at >= DATE_SUB(NOW(), INTERVAL ${hours} HOUR)
           AND event_category = 'bid_adjustment'
         GROUP BY event_category, api_sync_status`
          ));
          apiSyncStats = Array.isArray(syncRows) ? syncRows : [];
        } catch (syncErr) {
        }
        res.json({
          query: { limit, hours, category, status },
          count: Array.isArray(rows) ? rows.length : 0,
          entries: rows,
          stats: statsRows,
          apiSyncStats,
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        });
      } catch (e) {
        if (e.message?.includes("doesn't exist")) {
          res.json({
            count: 0,
            entries: [],
            stats: [],
            note: "optimization_events\u8868\u4E0D\u5B58\u5728",
            timestamp: (/* @__PURE__ */ new Date()).toISOString()
          });
        } else {
          res.status(500).json({ error: e.message });
        }
      }
    });
    router3.get("/id-audit", async (req, res) => {
      try {
        const db = await getDb();
        if (!db) {
          res.status(503).json({ error: "\u6570\u636E\u5E93\u4E0D\u53EF\u7528" });
          return;
        }
        const [campaignStats] = await db.execute(sql.raw(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN LENGTH(campaignId) > 8 THEN 1 ELSE 0 END) as amazonIdCount,
        SUM(CASE WHEN LENGTH(campaignId) <= 5 AND campaignId REGEXP '^[0-9]+$' THEN 1 ELSE 0 END) as localIdCount,
        MIN(id) as minLocalId,
        MAX(id) as maxLocalId,
        MIN(LENGTH(campaignId)) as minCampaignIdLen,
        MAX(LENGTH(campaignId)) as maxCampaignIdLen
      FROM campaigns
    `));
        const tableSamples = {};
        const tables = ["negative_keywords", "bidding_logs", "ad_groups"];
        for (const table of tables) {
          try {
            const [sample] = await db.execute(sql.raw(`
          SELECT campaignId, LENGTH(campaignId) as idLen, COUNT(*) as cnt
          FROM \`${table}\`
          WHERE campaignId IS NOT NULL AND campaignId != ''
          GROUP BY campaignId
          ORDER BY cnt DESC
          LIMIT 10
        `));
            tableSamples[table] = sample;
          } catch {
            tableSamples[table] = "table_not_found";
          }
        }
        res.json({
          description: "ID\u7CFB\u7EDF\u5BA1\u8BA1\u5FEB\u7167 \u2014 campaigns\u8868ID\u5206\u5E03 + \u5404FK\u8868campaignId\u6837\u672C",
          campaignIdDistribution: campaignStats,
          tableSamples,
          rules: {
            "campaigns.id": "\u672C\u5730\u81EA\u589Eint\u4E3B\u952E\uFF0C\u4EC5\u7528\u4E8E\u672C\u5730DB\u64CD\u4F5C",
            "campaigns.campaignId": "Amazon Campaign ID (varchar)\uFF0C\u7528\u4E8E\u6240\u6709FK\u5173\u8054\u548CAPI\u8C03\u7528",
            "adGroups.campaignId": "\u2192 campaigns.campaignId (Amazon ID\u5BF9Amazon ID)",
            "negativeKeywords.campaignId": "\u2192 campaigns.campaignId (Amazon ID)"
          },
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });
    router3.get("/logger-stats", (req, res) => {
      try {
        const stats4 = logger.getStats();
        const status = logger.getStatus();
        res.json({
          stats: stats4,
          status,
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });
    router3.get("/logger-query", (req, res) => {
      try {
        const level = req.query.level ? parseInt(req.query.level) : void 0;
        const module2 = req.query.module;
        const search = req.query.search || req.query.keyword;
        const limit = Math.min(parseInt(req.query.limit) || 50, 100);
        const result = logger.query({ level, module: module2, search, limit });
        res.json({
          ...result,
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });
    router3.get("/report-semaphore", async (req, res) => {
      try {
        const { getReportSemaphoreStatus: getReportSemaphoreStatus2 } = await Promise.resolve().then(() => (init_reportSemaphore(), reportSemaphore_exports));
        const status = getReportSemaphoreStatus2();
        res.json({
          success: true,
          semaphore: status,
          description: {
            activeCount: "\u5F53\u524D\u6301\u6709\u4FE1\u53F7\u91CF\u7684\u8D26\u6237\u6570",
            maxConcurrent: "\u6700\u5927\u5E76\u53D1\u62A5\u544A\u8D26\u6237\u6570",
            queueLength: "\u7B49\u5F85\u961F\u5217\u957F\u5EA6",
            activeAccounts: "\u5F53\u524D\u6D3B\u8DC3\u7684\u62A5\u544A\u8D26\u6237"
          }
        });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });
    router3.get("/sync-health", async (req, res) => {
      try {
        const db = await getDb();
        if (!db) {
          res.status(503).json({ error: "Database not available" });
          return;
        }
        const recentSyncs = await db.execute(sql.raw(`
      SELECT 
        sl.accountId,
        sl.syncType,
        sl.status,
        sl.startedAt,
        sl.completedAt,
        sl.recordsSynced,
        sl.errorMessage,
        sl.current_step as currentStep,
        sl.progress_percent as progressPercent,
        sl.sp_campaigns_synced as spCampaigns,
        sl.sb_campaigns_synced as sbCampaigns,
        sl.sd_campaigns_synced as sdCampaigns,
        sl.duration_ms as durationMs,
        TIMESTAMPDIFF(SECOND, sl.startedAt, COALESCE(sl.completedAt, NOW())) as durationSec
      FROM data_sync_jobs sl
      INNER JOIN (
        SELECT accountId, MAX(startedAt) as maxStart
        FROM data_sync_jobs
        GROUP BY accountId
      ) latest ON sl.accountId = latest.accountId 
        AND sl.startedAt = latest.maxStart
      ORDER BY sl.startedAt DESC
      LIMIT 50
    `));
        const syncStats24h = await db.execute(sql.raw(`
      SELECT 
        status,
        COUNT(*) as count,
        AVG(TIMESTAMPDIFF(SECOND, startedAt, COALESCE(completedAt, NOW()))) as avgDurationSec
      FROM data_sync_jobs
      WHERE startedAt >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
      GROUP BY status
    `));
        const freshness = {};
        const tables = ["campaigns", "ad_groups", "keywords", "negative_keywords"];
        for (const table of tables) {
          try {
            const result = await db.execute(sql.raw(
              `SELECT MAX(updatedAt) as lastUpdate FROM \`${table}\``
            ));
            const rows = Array.isArray(result) ? Array.isArray(result[0]) ? result[0] : result : [];
            freshness[table] = rows[0]?.lastUpdate || "no_data";
          } catch {
            freshness[table] = "table_error";
          }
        }
        res.json({
          description: "\u540C\u6B65\u5065\u5EB7\u72B6\u6001 \u2014 \u6700\u8FD1\u540C\u6B65\u8BB0\u5F55\u300124h\u7EDF\u8BA1\u3001\u6570\u636E\u65B0\u9C9C\u5EA6",
          recentSyncs: Array.isArray(recentSyncs) ? Array.isArray(recentSyncs[0]) ? recentSyncs[0] : recentSyncs : [],
          stats24h: Array.isArray(syncStats24h) ? Array.isArray(syncStats24h[0]) ? syncStats24h[0] : syncStats24h : [],
          dataFreshness: freshness,
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });
    router3.get("/sync-diagnosis", async (req, res) => {
      try {
        const db = await getDb();
        if (!db) {
          res.status(503).json({ error: "Database not available" });
          return;
        }
        const accountOverview = await db.execute(sql.raw(`
      SELECT 
        a.id as accountId,
        a.accountName,
        a.storeName,
        a.marketplace,
        a.status,
        a.organizationId,
        a.userId,
        (SELECT COUNT(*) FROM campaigns c WHERE c.accountId = a.id) as campaignCount,
        (SELECT COUNT(*) FROM ad_groups ag WHERE ag.accountId = a.id) as adGroupCount,
        (SELECT COUNT(*) FROM keywords k WHERE k.accountId = a.id) as keywordCount,
        (SELECT COUNT(*) FROM negative_keywords nk WHERE nk.accountId = a.id) as negKeywordCount,
        (SELECT COALESCE(SUM(spend), 0) FROM campaigns c WHERE c.accountId = a.id) as totalSpend
      FROM ad_accounts a
      WHERE a.status = 'active'
    `));
        const recentErrors = await db.execute(sql.raw(`
      SELECT 
        accountId, syncType, status, errorMessage, startedAt
      FROM data_sync_jobs
      WHERE status = 'failed' AND startedAt >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      ORDER BY startedAt DESC
      LIMIT 20
    `));
        const opsLogs = opsCollector.query({
          category: "sync",
          limit: 30
        });
        res.json({
          description: "\u540C\u6B65\u8BCA\u65AD \u2014 \u8D26\u6237\u6570\u636E\u6982\u89C8\u3001\u6700\u8FD1\u9519\u8BEF\u3001\u540C\u6B65\u65E5\u5FD7",
          accountOverview: Array.isArray(accountOverview) ? Array.isArray(accountOverview[0]) ? accountOverview[0] : accountOverview : [],
          recentErrors: Array.isArray(recentErrors) ? Array.isArray(recentErrors[0]) ? recentErrors[0] : recentErrors : [],
          opsLogs,
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });
    __name(parseOpsQuery, "parseOpsQuery");
    __name(formatUptime, "formatUptime");
    __name(formatBytes, "formatBytes");
    __name(extractCount2, "extractCount");
    router3.get("/nextgen-monitor", opsAuth, async (req, res) => {
      try {
        const db = await getDb();
        if (!db) {
          res.status(503).json({ error: "Database not available" });
          return;
        }
        const hoursBack = parseInt(req.query.hours) || 24;
        const since = new Date(Date.now() - hoursBack * 36e5).toISOString();
        const bidStats = await db.execute(sql.raw(`
      SELECT 
        COUNT(*) as total_events,
        SUM(CASE WHEN previous_value != new_value THEN 1 ELSE 0 END) as actual_adjustments,
        SUM(CASE WHEN previous_value = new_value THEN 1 ELSE 0 END) as hold_count,
        SUM(CASE WHEN api_sync_status = 'synced' THEN 1 ELSE 0 END) as api_synced,
        SUM(CASE WHEN api_sync_status = 'failed' THEN 1 ELSE 0 END) as api_failed,
        SUM(CASE WHEN api_sync_status = 'pending' THEN 1 ELSE 0 END) as api_pending
      FROM optimization_logs 
      WHERE created_at >= '${since}'
        AND (log_category = 'bid_adjustment' OR action_type IN ('bid_increase', 'bid_decrease', 'bid_set', 'bid_auto_adjust', 'bid_adjustment', 'bid_optimization'))
    `));
        const algorithmStats = await db.execute(sql.raw(`
      SELECT 
        CASE 
          WHEN change_reason LIKE '%NextGen%' THEN 'NextGen'
          WHEN change_reason LIKE '%\u63A2\u7D22%' OR change_reason LIKE '%RL\u63A2\u7D22%' THEN 'RL-Exploration'
          WHEN change_reason LIKE '%PostDeploy%' THEN 'PostDeploy'
          ELSE 'RuleEngine'
        END as algorithm_source,
        COUNT(*) as count,
        SUM(CASE WHEN previous_value != new_value THEN 1 ELSE 0 END) as effective_count
      FROM optimization_logs 
      WHERE created_at >= '${since}'
        AND action_type IN ('bid_adjustment', 'bid_auto_adjust', 'bid_increase', 'bid_decrease', 'bid_set')
      GROUP BY algorithm_source
      ORDER BY count DESC
    `));
        const rlStats = await db.execute(sql.raw(`
      SELECT 
        COUNT(*) as total_logs,
        SUM(CASE WHEN reward IS NOT NULL AND reward_filled_at IS NOT NULL THEN 1 ELSE 0 END) as reward_filled,
        SUM(CASE WHEN reward IS NULL OR reward_filled_at IS NULL THEN 1 ELSE 0 END) as reward_pending,
        SUM(CASE WHEN action_type = 'bid_increase' THEN 1 ELSE 0 END) as bid_increase_count,
        SUM(CASE WHEN action_type = 'bid_decrease' THEN 1 ELSE 0 END) as bid_decrease_count,
        SUM(CASE WHEN action_type = 'bid_hold' THEN 1 ELSE 0 END) as bid_hold_count,
        SUM(CASE WHEN action_source = 'linucb' THEN 1 ELSE 0 END) as linucb_count,
        SUM(CASE WHEN action_source = 'cql' THEN 1 ELSE 0 END) as cql_count,
        SUM(CASE WHEN action_source = 'rule_based' THEN 1 ELSE 0 END) as rule_based_count
      FROM rl_training_logs 
      WHERE created_at >= '${since}'
    `));
        const explorationStats = await db.execute(sql.raw(`
      SELECT 
        COUNT(*) as total_exploration_actions
      FROM optimization_logs 
      WHERE created_at >= '${since}'
        AND change_reason LIKE '%RL\u63A2\u7D22%'
    `));
        const sigmoidCount = await db.execute(sql.raw(`
      SELECT COUNT(*) as cnt FROM contextual_features WHERE curve_updated_at >= '${since}' AND sigmoid_l IS NOT NULL
    `));
        const featureCount = await db.execute(sql.raw(`
      // @ts-ignore
      SELECT COUNT(*) as cnt FROM contextual_features WHERE updated_at >= '${since}'
    `));
        const opsLogs = opsCollector.query({
          category: "optimization",
          keyword: "NextGen",
          limit: 20
        });
        const bid = Array.isArray(bidStats) ? bidStats[0]?.[0] || bidStats[0] : bidStats;
        const rl = Array.isArray(rlStats) ? rlStats[0]?.[0] || rlStats[0] : rlStats;
        const exploration = Array.isArray(explorationStats) ? explorationStats[0]?.[0] || explorationStats[0] : explorationStats;
        const sigmoid2 = extractCount2(Array.isArray(sigmoidCount) ? sigmoidCount[0] : sigmoidCount);
        const features = extractCount2(Array.isArray(featureCount) ? featureCount[0] : featureCount);
        const totalBidEvents = Number(bid?.total_events) || 0;
        const actualAdjustments = Number(bid?.actual_adjustments) || 0;
        const holdCount = Number(bid?.hold_count) || 0;
        const effectiveRate = totalBidEvents > 0 ? (actualAdjustments / totalBidEvents * 100).toFixed(1) : "0.0";
        const totalRLLogs = Number(rl?.total_logs) || 0;
        const rewardFilled = Number(rl?.reward_filled) || 0;
        const advancedAlgoCount = Number(rl?.linucb_count || 0) + Number(rl?.cql_count || 0);
        const advancedRate = totalRLLogs > 0 ? (advancedAlgoCount / totalRLLogs * 100).toFixed(1) : "0.0";
        const rlExplorationCount = Number(exploration?.total_exploration_actions) || 0;
        let healthStatus = "healthy";
        const healthIssues = [];
        if (parseFloat(effectiveRate) < 10 && totalBidEvents > 10) {
          healthStatus = "warning";
          healthIssues.push(`\u51FA\u4EF7\u6709\u6548\u7387\u4EC5${effectiveRate}%\uFF0C\u5927\u91CF\u8C03\u6574\u88AB\u5224\u5B9A\u4E3Ahold`);
        }
        if (advancedAlgoCount === 0 && totalRLLogs > 50) {
          healthStatus = "warning";
          healthIssues.push("\u9AD8\u7EA7\u7B97\u6CD5\u4ECE\u672A\u88AB\u6FC0\u6D3B\uFF0CRL\u51B7\u542F\u52A8\u53EF\u80FD\u5B58\u5728\u95EE\u9898");
        }
        if (rewardFilled === 0 && totalRLLogs > 20) {
          healthStatus = "critical";
          healthIssues.push("Reward\u56DE\u586B\u4E3A0\uFF0C\u9AD8\u7EA7\u7B97\u6CD5\u65E0\u6CD5\u5B66\u4E60");
        }
        res.json({
          monitorPeriod: `\u8FC7\u53BB${hoursBack}\u5C0F\u65F6`,
          since,
          health: {
            status: healthStatus,
            issues: healthIssues
          },
          bidOptimization: {
            totalEvents: totalBidEvents,
            actualAdjustments,
            holdCount,
            effectiveRate: `${effectiveRate}%`,
            // @ts-expect-error - number type assertion
            apiSynced: Number(bid?.api_synced) || 0,
            // @ts-expect-error - number type assertion
            apiFailed: Number(bid?.api_failed) || 0,
            // @ts-expect-error - number type assertion
            apiPending: Number(bid?.api_pending) || 0
          },
          algorithmDistribution: Array.isArray(algorithmStats) ? Array.isArray(algorithmStats[0]) ? algorithmStats[0] : algorithmStats : [],
          rlColdStart: {
            totalRLLogs,
            rewardFilled,
            // @ts-expect-error - type assertion
            rewardPending: Number(rl?.reward_pending) || 0,
            // @ts-expect-error - type assertion
            bidIncreaseCount: Number(rl?.bid_increase_count) || 0,
            // @ts-expect-error - type assertion
            bidDecreaseCount: Number(rl?.bid_decrease_count) || 0,
            // @ts-expect-error - type assertion
            bidHoldCount: Number(rl?.bid_hold_count) || 0,
            explorationActions: rlExplorationCount,
            advancedAlgorithm: {
              // @ts-expect-error - type assertion
              linucbCount: Number(rl?.linucb_count) || 0,
              // @ts-expect-error - type assertion
              cqlCount: Number(rl?.cql_count) || 0,
              // @ts-expect-error - type assertion
              ruleBasedCount: Number(rl?.rule_based_count) || 0,
              advancedRate: `${advancedRate}%`
            }
          },
          modelStatus: {
            sigmoidFittedRecent: sigmoid2,
            featuresCachedRecent: features
          },
          recentNextGenLogs: opsLogs.map((l) => ({
            timestamp: l.timestamp,
            level: l.level,
            message: l.message
          })),
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });
    router3.get("/rl-diagnostics", opsAuth, async (req, res) => {
      try {
        const db = await getDb();
        if (!db) return res.status(500).json({ error: "DB not available" });
        const now = /* @__PURE__ */ new Date();
        const hoursAgo3 = new Date(now.getTime() - 3 * 36e5).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "");
        const hoursAgo96 = new Date(now.getTime() - 96 * 36e5).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "");
        const totalStats = await db.execute(sql.raw(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN reward_filled_at IS NOT NULL THEN 1 ELSE 0 END) as filled,
        SUM(CASE WHEN reward_filled_at IS NULL THEN 1 ELSE 0 END) as pending,
        MIN(created_at) as earliest,
        MAX(created_at) as latest
      FROM rl_training_logs
    `));
        const accountDist = await db.execute(sql.raw(`
      SELECT 
        accountId,
        COUNT(*) as total,
        SUM(CASE WHEN reward_filled_at IS NULL AND created_at <= '${hoursAgo3}' AND created_at >= '${hoursAgo96}' THEN 1 ELSE 0 END) as in_backfill_window,
        SUM(CASE WHEN created_at > '${hoursAgo3}' THEN 1 ELSE 0 END) as too_new,
        SUM(CASE WHEN created_at < '${hoursAgo96}' THEN 1 ELSE 0 END) as too_old,
        MIN(created_at) as earliest,
        MAX(created_at) as latest
      FROM rl_training_logs
      WHERE reward_filled_at IS NULL
      GROUP BY accountId
    `));
        const timeDist = await db.execute(sql.raw(`
      // @ts-ignore
      SELECT 
        // @ts-ignore
        DATE_FORMAT(created_at, '%Y-%m-%d %H:00') as hour_bucket,
        // @ts-ignore
        COUNT(*) as cnt,
        SUM(CASE WHEN reward_filled_at IS NOT NULL THEN 1 ELSE 0 END) as filled
      FROM rl_training_logs
      GROUP BY hour_bucket
      ORDER BY hour_bucket DESC
      LIMIT 30
    `));
        const extractRows3 = /* @__PURE__ */ __name((result) => {
          if (Array.isArray(result) && Array.isArray(result[0])) return result[0];
          if (Array.isArray(result)) return result;
          return [result];
        }, "extractRows");
        res.json({
          diagnosticTime: now.toISOString(),
          backfillWindow: { from: hoursAgo96, to: hoursAgo3 },
          // @ts-ignore
          totalStats: extractRows3(totalStats),
          // @ts-ignore
          accountDistribution: extractRows3(accountDist),
          // @ts-ignore
          timeDistribution: extractRows3(timeDist)
        });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });
    router3.post("/force-sync", async (req, res) => {
      try {
        const { accountId, tier: tier2 = "full" } = req.body || {};
        if (!accountId) {
          return res.status(400).json({ error: "\u7F3A\u5C11accountId\u53C2\u6570" });
        }
        const { syncAccount: syncAccount2, discoverSyncableAccounts: discoverSyncableAccounts2 } = await Promise.resolve().then(() => (init_unifiedSyncEngine(), unifiedSyncEngine_exports));
        const accounts = await discoverSyncableAccounts2();
        const targetAccount = accounts.find((a) => a.accountId === Number(accountId));
        if (!targetAccount) {
          return res.status(404).json({
            error: `\u8D26\u6237${accountId}\u672A\u627E\u5230\u6216\u7F3A\u5C11API\u51ED\u8BC1`,
            availableAccounts: accounts.map((a) => ({ id: a.accountId, name: a.accountName, marketplace: a.marketplace }))
          });
        }
        const syncStartTime = /* @__PURE__ */ new Date();
        const startTimeStr = syncStartTime.toISOString().slice(0, 19).replace("T", " ");
        let jobId = null;
        try {
          const { createSyncJob: createSyncJob3 } = await Promise.resolve().then(() => (init_syncJobs(), syncJobs_exports));
          jobId = await createSyncJob3({
            userId: targetAccount.userId || 390001,
            accountId: Number(accountId),
            syncType: tier2 === "high" ? "campaigns" : tier2 === "medium" ? "keywords" : "all",
            isIncremental: false,
            triggerSource: "manual"
            // v445: 标记为手动触发，避免阻塞自动同步调度
          });
          logger.info("OPS", `force-sync\u521B\u5EFAdata_sync_jobs\u8BB0\u5F55: jobId=${jobId}, accountId=${accountId}, tier=${tier2}`);
        } catch (jobErr) {
          logger.warn("OPS", `force-sync\u521B\u5EFAdata_sync_jobs\u8BB0\u5F55\u5931\u8D25: ${jobErr.message}`);
        }
        logger.info("OPS", `\u624B\u52A8\u89E6\u53D1\u8D26\u6237${accountId}\u7684${tier2}\u5C42\u5168\u91CF\u540C\u6B65`);
        if (tier2 === "full") {
          const { triggerManualFullSync: triggerManualFullSync2 } = await Promise.resolve().then(() => (init_unifiedSyncEngine(), unifiedSyncEngine_exports));
          triggerManualFullSync2(
            Number(accountId),
            void 0,
            // onProgress由triggerManualFullSync内部通过jobId处理
            { jobId: jobId || void 0, userId: targetAccount.userId }
          ).then(async (result) => {
            if (result) {
              const durationMin = (result.durationMs / 6e4).toFixed(1);
              logger.info("OPS", `\u8D26\u6237${accountId} full\u5C42\u624B\u52A8\u540C\u6B65\u5B8C\u6210: \u6210\u529F=${result.success}, \u6B65\u9AA4=${result.completedSteps}/${result.totalSteps}, \u8BB0\u5F55=${result.totalSynced}, \u8017\u65F6=${durationMin}\u5206\u949F`);
              if (result.errors.length > 0) {
                logger.warn("OPS", `\u8D26\u6237${accountId} \u540C\u6B65\u9519\u8BEF: ${result.errors.join("; ")}`);
              }
            } else {
              logger.warn("OPS", `\u8D26\u6237${accountId} full\u5C42\u624B\u52A8\u540C\u6B65\u8FD4\u56DEnull\uFF08\u8D26\u6237\u4E0D\u53EF\u7528\uFF09`);
            }
          }).catch(async (err) => {
            logger.error("OPS", `\u8D26\u6237${accountId} full\u5C42\u624B\u52A8\u540C\u6B65\u5F02\u5E38: ${err.message}`);
            if (jobId) {
              try {
                const { updateSyncJob: updateSyncJob2 } = await Promise.resolve().then(() => (init_syncJobs(), syncJobs_exports));
                await updateSyncJob2(jobId, {
                  status: "failed",
                  durationMs: Date.now() - syncStartTime.getTime(),
                  errorMessage: err.message,
                  currentStep: "\u5F02\u5E38\u7EC8\u6B62"
                });
              } catch (updateErr) {
                logger.warn("OPS", `force-sync\u5F02\u5E38\u66F4\u65B0data_sync_jobs\u5931\u8D25: ${updateErr.message}`);
              }
            }
          });
        } else {
          syncAccount2(targetAccount, tier2, { isManual: true }).then(async (result) => {
            const durationMs = Date.now() - syncStartTime.getTime();
            const durationMin = (durationMs / 6e4).toFixed(1);
            logger.info("OPS", `\u8D26\u6237${accountId} ${tier2}\u5C42\u540C\u6B65\u5B8C\u6210: \u6210\u529F=${result.success}, \u6B65\u9AA4=${result.completedSteps}/${result.totalSteps}, \u8BB0\u5F55=${result.totalSynced}, \u8017\u65F6=${durationMin}\u5206\u949F`);
            if (result.errors.length > 0) {
              logger.warn("OPS", `\u8D26\u6237${accountId} \u540C\u6B65\u9519\u8BEF: ${result.errors.join("; ")}`);
            }
            if (jobId) {
              try {
                const { updateSyncJob: updateSyncJob2 } = await Promise.resolve().then(() => (init_syncJobs(), syncJobs_exports));
                const safeNum = /* @__PURE__ */ __name((v) => typeof v === "number" && !isNaN(v) ? v : 0, "safeNum");
                await updateSyncJob2(jobId, {
                  status: result.success ? "completed" : "failed",
                  durationMs,
                  recordsSynced: result.totalSynced,
                  errorMessage: result.errors.length > 0 ? result.errors.slice(0, 3).join("; ") : void 0,
                  spCampaigns: safeNum(result.stepResults?.["sp_campaigns"]?.synced),
                  sbCampaigns: safeNum(result.stepResults?.["sb_campaigns"]?.synced),
                  sdCampaigns: safeNum(result.stepResults?.["sd_campaigns"]?.synced),
                  adGroupsSynced: safeNum(result.stepResults?.["sp_ad_groups"]?.synced) + safeNum(result.stepResults?.["sb_ad_groups"]?.synced) + safeNum(result.stepResults?.["sd_ad_groups"]?.synced),
                  keywordsSynced: safeNum(result.stepResults?.["sp_keywords"]?.synced) + safeNum(result.stepResults?.["sb_keywords"]?.synced),
                  targetsSynced: safeNum(result.stepResults?.["sp_product_targets"]?.synced) + safeNum(result.stepResults?.["sb_product_targets"]?.synced) + safeNum(result.stepResults?.["sd_product_targets"]?.synced),
                  totalSteps: result.totalSteps,
                  currentStepIndex: result.completedSteps,
                  currentStep: result.success ? "\u5B8C\u6210" : "\u5931\u8D25",
                  progressPercent: result.success ? 100 : Math.round(result.completedSteps / Math.max(result.totalSteps, 1) * 100)
                });
                logger.info("OPS", `force-sync data_sync_jobs\u8BB0\u5F55\u5DF2\u66F4\u65B0: jobId=${jobId}, status=${result.success ? "completed" : "failed"}`);
              } catch (updateErr) {
                logger.warn("OPS", `force-sync\u66F4\u65B0data_sync_jobs\u8BB0\u5F55\u5931\u8D25: ${updateErr.message}`);
              }
            }
          }).catch(async (err) => {
            logger.error("OPS", `\u8D26\u6237${accountId} ${tier2}\u5C42\u540C\u6B65\u5F02\u5E38: ${err.message}`);
            if (jobId) {
              try {
                const { updateSyncJob: updateSyncJob2 } = await Promise.resolve().then(() => (init_syncJobs(), syncJobs_exports));
                await updateSyncJob2(jobId, {
                  status: "failed",
                  durationMs: Date.now() - syncStartTime.getTime(),
                  errorMessage: err.message,
                  currentStep: "\u5F02\u5E38\u7EC8\u6B62"
                });
              } catch (updateErr) {
                logger.warn("OPS", `force-sync\u5F02\u5E38\u66F4\u65B0data_sync_jobs\u5931\u8D25: ${updateErr.message}`);
              }
            }
          });
        }
        res.json({
          message: `\u5DF2\u89E6\u53D1\u8D26\u6237${accountId}\u7684${tier2}\u5C42\u5168\u91CF\u540C\u6B65\uFF0C\u540E\u53F0\u6267\u884C\u4E2D`,
          accountId: targetAccount.accountId,
          accountName: targetAccount.accountName,
          marketplace: targetAccount.marketplace,
          tier: tier2,
          jobId,
          // v442: 返回jobId供追踪
          triggeredAt: syncStartTime.toISOString(),
          note: "\u540C\u6B65\u5728\u540E\u53F0\u5F02\u6B65\u6267\u884C\uFF0C\u53EF\u901A\u8FC7 GET /api/ops/sync-health \u67E5\u770B\u8FDB\u5EA6"
        });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });
    router3.post("/detect-zombies", async (req, res) => {
      try {
        const { detectAndPauseZombieAccounts: detectAndPauseZombieAccounts2 } = await Promise.resolve().then(() => (init_zombieAccountDetector(), zombieAccountDetector_exports));
        const result = await detectAndPauseZombieAccounts2();
        res.json({
          message: `\u50F5\u5C38\u8D26\u6237\u68C0\u6D4B\u5B8C\u6210: \u68C0\u67E5${result.checkedAccounts}\u4E2A\u8D26\u6237, \u53D1\u73B0${result.detectedZombies.length}\u4E2A\u50F5\u5C38, \u81EA\u52A8\u6682\u505C${result.pausedAccounts}\u4E2A`,
          ...result
          // @ts-ignore
        });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });
    router3.post("/reactivate-account", async (req, res) => {
      try {
        const { accountId } = req.body;
        if (!accountId) {
          return res.status(400).json({ error: "\u7F3A\u5C11accountId\u53C2\u6570" });
        }
        const database = await getDb();
        if (!database) {
          return res.status(500).json({ error: "\u6570\u636E\u5E93\u4E0D\u53EF\u7528" });
        }
        const [account] = await database.execute(sql`
      SELECT id, accountName, marketplace, status FROM ad_accounts WHERE id = ${accountId}
    `);
        const row = Array.isArray(account) ? account[0] : account;
        if (!row) {
          return res.status(404).json({ error: `\u8D26\u6237${accountId}\u4E0D\u5B58\u5728` });
        }
        if (row.status === "active") {
          return res.json({ message: `\u8D26\u6237${accountId}\u5DF2\u7ECF\u662Factive\u72B6\u6001`, accountId, status: "active" });
        }
        await database.execute(sql`
      UPDATE ad_accounts SET status = 'active' WHERE id = ${accountId}
    `);
        res.json({
          message: `\u8D26\u6237${accountId}(${row.accountName})\u5DF2\u91CD\u65B0\u6FC0\u6D3B\u4E3Aactive`,
          accountId,
          accountName: row.accountName,
          marketplace: row.marketplace,
          previousStatus: row.status,
          newStatus: "active"
        });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });
    router3.get("/pool-stats", async (req, res) => {
      try {
        const { getPoolStats: getPoolStats2 } = await Promise.resolve().then(() => (init_connection(), connection_exports));
        const stats4 = getPoolStats2();
        res.json({
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          poolStats: stats4,
          memory: {
            rss: `${(process.memoryUsage().rss / 1024 / 1024).toFixed(1)}MB`,
            heapUsed: `${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1)}MB`,
            heapTotal: `${(process.memoryUsage().heapTotal / 1024 / 1024).toFixed(1)}MB`
          }
        });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });
    router3.post("/gc", async (req, res) => {
      const before = process.memoryUsage();
      if (global.gc) {
        global.gc();
        await new Promise((resolve) => setTimeout(resolve, 1e3));
      }
      const after = process.memoryUsage();
      res.json({
        gcAvailable: !!global.gc,
        before: {
          rss: `${(before.rss / 1024 / 1024).toFixed(1)}MB`,
          heapUsed: `${(before.heapUsed / 1024 / 1024).toFixed(1)}MB`
        },
        after: {
          rss: `${(after.rss / 1024 / 1024).toFixed(1)}MB`,
          heapUsed: `${(after.heapUsed / 1024 / 1024).toFixed(1)}MB`
        },
        freed: {
          rss: `${((before.rss - after.rss) / 1024 / 1024).toFixed(1)}MB`,
          heapUsed: `${((before.heapUsed - after.heapUsed) / 1024 / 1024).toFixed(1)}MB`
        }
      });
    });
    router3.post("/push-metrics", async (req, res) => {
      try {
        const { manualPushMetrics: manualPushMetrics2 } = await Promise.resolve().then(() => (init_cloudwatchMonitor(), cloudwatchMonitor_exports));
        const result = await manualPushMetrics2();
        res.json(result);
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });
    router3.get("/jwt-test", async (req, res) => {
      try {
        const key = req.query.key;
        if (key !== process.env.OPS_API_KEY) return res.status(401).json({ error: "unauthorized" });
        const token = req.query.token;
        if (!token) return res.json({ error: "no token provided" });
        const jwt4 = require_jsonwebtoken();
        const secret = process.env.JWT_SECRET;
        const result = { hasSecret: !!secret, secretLen: secret?.length };
        try {
          const decoded = jwt4.verify(token, secret);
          result.decoded = decoded;
          result.success = true;
        } catch (e) {
          result.error = e.message;
          result.errorName = e.name;
          result.success = false;
        }
        try {
          const { getDb: getDb3 } = await Promise.resolve().then(() => (init_index(), index_exports));
          const { sql: sql15 } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
          const db = await getDb3();
          const userId = result.decoded?.userId;
          if (db && userId) {
            const rows = await db.execute(sql15`SELECT id, name, email, role FROM team_members WHERE id = ${userId}`);
            result.dbRows = rows[0];
          }
        } catch (dbErr) {
          result.dbError = dbErr.message;
        }
        res.json(result);
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });
    router3.post("/align-entity-states", async (req, res) => {
      try {
        const { accountId } = req.body || {};
        const { alignEntityStates: alignEntityStates2, alignAllAccountEntityStates: alignAllAccountEntityStates2 } = await Promise.resolve().then(() => (init_entityStateAlignment(), entityStateAlignment_exports));
        if (accountId) {
          const result = await alignEntityStates2(Number(accountId));
          return res.json({ success: true, result });
        } else {
          const result = await alignAllAccountEntityStates2();
          return res.json({ success: true, result });
        }
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
    router3.get("/resilience", async (_req, res) => {
      try {
        const { getResilienceStatus: getResilienceStatus2 } = await Promise.resolve().then(() => (init_resilienceMonitor(), resilienceMonitor_exports));
        res.json(getResilienceStatus2());
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
    router3.get("/resilience/summary", async (_req, res) => {
      try {
        const { getResilienceHealthSummary: getResilienceHealthSummary2 } = await Promise.resolve().then(() => (init_resilienceMonitor(), resilienceMonitor_exports));
        res.json({ summary: getResilienceHealthSummary2() });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
    router3.get("/resilience/query-stats", async (_req, res) => {
      try {
        const { getQueryStats: getQueryStats2 } = await Promise.resolve().then(() => (init_typeSafeQueryBuilder(), typeSafeQueryBuilder_exports));
        res.json(getQueryStats2());
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
    router3.get("/data-retention/stats", async (_req, res) => {
      try {
        const { getRetentionStats: getRetentionStats2 } = await Promise.resolve().then(() => (init_dataRetentionService(), dataRetentionService_exports));
        const stats4 = await getRetentionStats2();
        res.json({ success: true, stats: stats4 });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
    router3.post("/data-retention/cleanup", async (_req, res) => {
      try {
        const { executeDataCleanup: executeDataCleanup2 } = await Promise.resolve().then(() => (init_dataRetentionService(), dataRetentionService_exports));
        const result = await executeDataCleanup2();
        res.json(result);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
    router3.get("/anomaly-detection/run", async (_req, res) => {
      try {
        const { runAnomalyDetection: runAnomalyDetection2 } = await Promise.resolve().then(() => (init_dataAnomalyDetector(), dataAnomalyDetector_exports));
        const result = await runAnomalyDetection2();
        res.json({ success: true, ...result });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
    router3.get("/nightly-monitor/summary", async (_req, res) => {
      try {
        const { getMonitorSummary: getMonitorSummary2 } = await Promise.resolve().then(() => (init_nightlySyncMonitor(), nightlySyncMonitor_exports));
        const summary = getMonitorSummary2();
        res.json({ success: true, ...summary });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
    router3.get("/nightly-monitor/snapshots", async (req, res) => {
      try {
        const { getMonitorSnapshots: getMonitorSnapshots2 } = await Promise.resolve().then(() => (init_nightlySyncMonitor(), nightlySyncMonitor_exports));
        const tier2 = req.query.tier;
        const limit = parseInt(req.query.limit) || 50;
        const snapshots = getMonitorSnapshots2(tier2, limit);
        res.json({ success: true, count: snapshots.length, snapshots });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
    router3.get("/log-level/status", async (_req, res) => {
      try {
        const { getDynamicLogStatus: getDynamicLogStatus2 } = await Promise.resolve().then(() => (init_dynamicLogLevel(), dynamicLogLevel_exports));
        const status = await getDynamicLogStatus2();
        res.json({ success: true, ...status });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
    router3.post("/log-level/module", async (req, res) => {
      try {
        const { module: moduleName, ttl, action } = req.body || {};
        if (!moduleName) {
          return res.status(400).json({ error: "\u7F3A\u5C11 module \u53C2\u6570" });
        }
        const { setModuleDebug: setModuleDebug2, clearModuleDebug: clearModuleDebug2 } = await Promise.resolve().then(() => (init_dynamicLogLevel(), dynamicLogLevel_exports));
        if (action === "clear") {
          await clearModuleDebug2(moduleName);
          return res.json({ success: true, message: `\u6A21\u5757 ${moduleName} DEBUG \u5DF2\u5173\u95ED` });
        }
        await setModuleDebug2(moduleName, ttl || 600);
        res.json({ success: true, message: `\u6A21\u5757 ${moduleName} DEBUG \u5DF2\u5F00\u542F, TTL=${ttl || 600}s` });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
    router3.post("/log-level/account", async (req, res) => {
      try {
        const { accountId, ttl, action } = req.body || {};
        if (!accountId) {
          return res.status(400).json({ error: "\u7F3A\u5C11 accountId \u53C2\u6570" });
        }
        const { setAccountDebug: setAccountDebug2, clearAccountDebug: clearAccountDebug2 } = await Promise.resolve().then(() => (init_dynamicLogLevel(), dynamicLogLevel_exports));
        if (action === "clear") {
          await clearAccountDebug2(Number(accountId));
          return res.json({ success: true, message: `\u8D26\u6237 ${accountId} DEBUG \u5DF2\u5173\u95ED` });
        }
        await setAccountDebug2(Number(accountId), ttl || 1800);
        res.json({ success: true, message: `\u8D26\u6237 ${accountId} DEBUG \u5DF2\u5F00\u542F, TTL=${ttl || 1800}s` });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
    router3.post("/log-level/global", async (req, res) => {
      try {
        const { level, ttl, action } = req.body || {};
        const { setGlobalLevel: setGlobalLevel2, clearGlobalLevel: clearGlobalLevel2 } = await Promise.resolve().then(() => (init_dynamicLogLevel(), dynamicLogLevel_exports));
        if (action === "clear") {
          await clearGlobalLevel2();
          return res.json({ success: true, message: "\u5168\u5C40\u65E5\u5FD7\u7EA7\u522B\u8986\u76D6\u5DF2\u6E05\u9664" });
        }
        if (!level) {
          return res.status(400).json({ error: "\u7F3A\u5C11 level \u53C2\u6570 (DEBUG|INFO|WARN)" });
        }
        const ok = await setGlobalLevel2(level, ttl || 300);
        res.json({ success: ok, message: ok ? `\u5168\u5C40\u65E5\u5FD7\u7EA7\u522B\u5DF2\u8BBE\u7F6E\u4E3A ${level}, TTL=${ttl || 300}s` : "\u65E0\u6548\u7684\u65E5\u5FD7\u7EA7\u522B" });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
    router3.get("/token-health/status", async (_req, res) => {
      try {
        const { getAllTokenHealthStatus: getAllTokenHealthStatus2 } = await Promise.resolve().then(() => (init_tokenHealthChecker(), tokenHealthChecker_exports));
        res.json(getAllTokenHealthStatus2());
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
    router3.post("/token-health/reset", async (req, res) => {
      try {
        const { accountId } = req.body;
        if (accountId) {
          const { resetTokenHealth: resetTokenHealth2 } = await Promise.resolve().then(() => (init_tokenHealthChecker(), tokenHealthChecker_exports));
          const ok = resetTokenHealth2(Number(accountId));
          res.json({ success: ok, message: ok ? `\u8D26\u6237${accountId}\u7684Token\u5065\u5EB7\u72B6\u6001\u5DF2\u91CD\u7F6E` : `\u8D26\u6237${accountId}\u65E0\u7F13\u5B58\u8BB0\u5F55` });
        } else {
          const { resetAllTokenHealth: resetAllTokenHealth2 } = await Promise.resolve().then(() => (init_tokenHealthChecker(), tokenHealthChecker_exports));
          const count11 = resetAllTokenHealth2();
          res.json({ success: true, message: `\u5DF2\u91CD\u7F6E${count11}\u4E2A\u8D26\u6237\u7684Token\u5065\u5EB7\u72B6\u6001` });
        }
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
    router3.post("/token-health/check", async (req, res) => {
      try {
        const { accountId } = req.body;
        if (!accountId) {
          return res.status(400).json({ error: "\u7F3A\u5C11accountId\u53C2\u6570" });
        }
        const { discoverSyncableAccounts: discoverSyncableAccounts2 } = await Promise.resolve().then(() => (init_unifiedSyncEngine(), unifiedSyncEngine_exports));
        const accounts = await discoverSyncableAccounts2();
        const account = accounts.find((a) => a.accountId === Number(accountId));
        if (!account) {
          return res.status(404).json({ error: `\u8D26\u6237${accountId}\u4E0D\u5B58\u5728\u6216\u65E0API\u51ED\u8BC1` });
        }
        const { precheckToken: precheckToken2 } = await Promise.resolve().then(() => (init_tokenHealthChecker(), tokenHealthChecker_exports));
        const result = await precheckToken2(
          { clientId: account.clientId, clientSecret: account.clientSecret, refreshToken: account.refreshToken, profileId: account.profileId, region: account.region },
          account.accountId,
          account.accountName,
          account.marketplace
        );
        res.json({ accountId: Number(accountId), ...result });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
    router3.get("/perf-coverage/all", async (req, res) => {
      try {
        const { checkAllAccountsCoverage: checkAllAccountsCoverage2 } = await Promise.resolve().then(() => (init_performanceIntegrityChecker(), performanceIntegrityChecker_exports));
        const report = await checkAllAccountsCoverage2();
        res.json(report);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
    router3.get("/perf-coverage/:accountId", async (req, res) => {
      try {
        const { checkAccountPerformanceCoverage: checkAccountPerformanceCoverage2 } = await Promise.resolve().then(() => (init_performanceIntegrityChecker(), performanceIntegrityChecker_exports));
        const report = await checkAccountPerformanceCoverage2(Number(req.params.accountId));
        res.json(report);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
    router3.post("/auto-enroll/scan", async (req, res) => {
      try {
        const { scanAndAutoEnrollAll: scanAndAutoEnrollAll2 } = await Promise.resolve().then(() => (init_smartAutoEnrollService(), smartAutoEnrollService_exports));
        const dryRun = req.body?.dryRun !== false;
        const summary = await scanAndAutoEnrollAll2(dryRun);
        res.json(summary);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
    router3.post("/auto-enroll/account/:accountId", async (req, res) => {
      try {
        const { autoEnrollAccount: autoEnrollAccount2 } = await Promise.resolve().then(() => (init_smartAutoEnrollService(), smartAutoEnrollService_exports));
        const dryRun = req.body?.dryRun !== false;
        const result = await autoEnrollAccount2(Number(req.params.accountId), dryRun);
        res.json(result);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
    router3.get("/optimization-health", async (req, res) => {
      try {
        const { scanAllAccountsHealth: scanAllAccountsHealth2 } = await Promise.resolve().then(() => (init_optimizationHealthAlert(), optimizationHealthAlert_exports));
        const report = await scanAllAccountsHealth2();
        res.json(report);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
    router3.get("/optimization-health/:accountId", async (req, res) => {
      try {
        const { checkAccountOptimizationHealth: checkAccountOptimizationHealth2 } = await Promise.resolve().then(() => (init_optimizationHealthAlert(), optimizationHealthAlert_exports));
        const status = await checkAccountOptimizationHealth2(Number(req.params.accountId));
        res.json(status);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
    router3.get("/date-gaps/all", async (req, res) => {
      try {
        const { scanAllAccountsGaps: scanAllAccountsGaps2 } = await Promise.resolve().then(() => (init_dateGapBackfillService(), dateGapBackfillService_exports));
        const report = await scanAllAccountsGaps2();
        res.json(report);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
    router3.get("/date-gaps/:accountId", async (req, res) => {
      try {
        const { detectAndQueueBackfill: detectAndQueueBackfill2 } = await Promise.resolve().then(() => (init_dateGapBackfillService(), dateGapBackfillService_exports));
        const result = await detectAndQueueBackfill2(Number(req.params.accountId));
        res.json(result);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
    router3.get("/tenant-audit", async (req, res) => {
      try {
        const db = await getDb();
        if (!db) {
          res.status(503).json({ error: "DB not available" });
          return;
        }
        const orgsRaw = await db.execute(sql.raw(
          `SELECT id, name, type, owner_id as ownerId, status, max_accounts as maxAccounts FROM organizations ORDER BY id`
        ));
        const orgs = Array.isArray(orgsRaw) ? Array.isArray(orgsRaw[0]) ? orgsRaw[0] : orgsRaw : [];
        const membersRaw = await db.execute(sql.raw(
          `SELECT id, organization_id as organizationId, email, name, role, status, ownerId, memberId FROM team_members ORDER BY organization_id, id`
        ));
        const members = Array.isArray(membersRaw) ? Array.isArray(membersRaw[0]) ? membersRaw[0] : membersRaw : [];
        const accountsRaw = await db.execute(sql.raw(
          `SELECT id, organization_id as organizationId, userId, storeName, marketplace, status FROM ad_accounts ORDER BY userId, id`
        ));
        const accounts = Array.isArray(accountsRaw) ? Array.isArray(accountsRaw[0]) ? accountsRaw[0] : accountsRaw : [];
        const issues = [];
        const accountList = accounts;
        const nullOrgAccounts = accountList.filter((a) => !a.organizationId || a.organizationId === 0);
        if (nullOrgAccounts.length > 0) {
          issues.push(`${nullOrgAccounts.length} \u4E2A\u8D26\u6237\u7F3A\u5C11 organizationId\uFF08NULL \u6216 0\uFF09`);
        }
        const userOrgMap = {};
        for (const a of accountList) {
          if (a.userId && a.organizationId) {
            if (!userOrgMap[a.userId]) userOrgMap[a.userId] = /* @__PURE__ */ new Set();
            userOrgMap[a.userId].add(a.organizationId);
          }
        }
        for (const [userId, orgIds] of Object.entries(userOrgMap)) {
          if (orgIds.size > 1) {
            issues.push(`userId=${userId} \u5173\u8054\u4E86\u591A\u4E2A\u7EC4\u7EC7: [${[...orgIds].join(", ")}]`);
          }
        }
        res.json({
          description: "v577.2 \u6570\u636E\u9694\u79BB\u5BA1\u8BA1 \u2014 \u7EC4\u7EC7\u3001\u56E2\u961F\u6210\u5458\u3001\u8D26\u6237\u7684 organizationId \u5206\u914D\u60C5\u51B5",
          organizations: orgs,
          teamMembers: members,
          accounts,
          issues,
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
    router3.post("/fix-tenant-isolation", async (req, res) => {
      try {
        const db = await getDb();
        if (!db) {
          res.status(503).json({ error: "DB not available" });
          return;
        }
        const fixes = req.body?.fixes;
        if (!fixes || !Array.isArray(fixes) || fixes.length === 0) {
          res.status(400).json({ error: "\u8BF7\u63D0\u4F9B fixes \u6570\u7EC4\uFF0C\u683C\u5F0F: [{ accountId: number, organizationId: number }]" });
          return;
        }
        const results = [];
        for (const fix of fixes) {
          try {
            await db.execute(sql.raw(
              `UPDATE ad_accounts SET organization_id = ${Number(fix.organizationId)} WHERE id = ${Number(fix.accountId)}`
            ));
            results.push({ accountId: fix.accountId, organizationId: fix.organizationId, success: true });
          } catch (e) {
            results.push({ accountId: fix.accountId, organizationId: fix.organizationId, success: false, error: e.message });
          }
        }
        res.json({
          description: "v577.2 \u6570\u636E\u9694\u79BB\u4FEE\u590D\u7ED3\u679C",
          totalFixes: fixes.length,
          successful: results.filter((r) => r.success).length,
          failed: results.filter((r) => !r.success).length,
          results,
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
    router3.get("/account-origin/:accountId", async (req, res) => {
      try {
        const db = await getDb();
        if (!db) {
          res.status(503).json({ error: "DB not available" });
          return;
        }
        const accountId = Number(req.params.accountId);
        const acctRaw = await db.execute(sql.raw(
          `SELECT id, organization_id, userId, accountId as amazonAccountId, accountName, storeName, marketplace, profileId, status, createdAt, updatedAt FROM ad_accounts WHERE id = ${accountId}`
        ));
        const acct = Array.isArray(acctRaw) ? Array.isArray(acctRaw[0]) ? acctRaw[0] : acctRaw : [];
        const auditRaw = await db.execute(sql.raw(
          `SELECT id, userId, userName, userEmail, actionType, targetType, targetId, targetName, description, previousValue, newValue, metadata, accountId, accountName, ipAddress, createdAt FROM audit_logs WHERE (accountId = ${accountId} OR targetId = '${accountId}') AND actionType IN ('account_create','account_connect','account_update') ORDER BY createdAt ASC LIMIT 20`
        ));
        const audits = Array.isArray(auditRaw) ? Array.isArray(auditRaw[0]) ? auditRaw[0] : auditRaw : [];
        const credRaw = await db.execute(sql.raw(
          `SELECT id, organization_id, accountId, profileId, region, lastSyncAt, syncStatus, createdAt, updatedAt FROM amazon_api_credentials WHERE accountId = ${accountId}`
        ));
        const creds = Array.isArray(credRaw) ? Array.isArray(credRaw[0]) ? credRaw[0] : credRaw : [];
        let relatedAccounts = [];
        const acctData = acct[0];
        if (acctData?.profileId) {
          const relRaw = await db.execute(sql.raw(
            `SELECT id, organization_id, userId, storeName, marketplace, profileId, status FROM ad_accounts WHERE profileId = '${acctData.profileId}' AND id != ${accountId}`
          ));
          relatedAccounts = Array.isArray(relRaw) ? Array.isArray(relRaw[0]) ? relRaw[0] : relRaw : [];
        }
        let sellerRelated = [];
        const sellerRaw = await db.execute(sql.raw(
          `SELECT a.id, a.organization_id, a.userId, a.storeName, a.marketplace, a.sellerId, a.status FROM ad_accounts a WHERE a.sellerId IS NOT NULL AND a.sellerId != '' AND a.sellerId IN (SELECT sellerId FROM ad_accounts WHERE id = ${accountId}) AND a.id != ${accountId}`
        ));
        sellerRelated = Array.isArray(sellerRaw) ? Array.isArray(sellerRaw[0]) ? sellerRaw[0] : sellerRaw : [];
        let amazonIdRelated = [];
        if (acctData?.amazonAccountId) {
          const amzRaw = await db.execute(sql.raw(
            `SELECT id, organization_id, userId, storeName, marketplace, accountId as amazonAccountId, status FROM ad_accounts WHERE accountId = '${acctData.amazonAccountId}' AND id != ${accountId}`
          ));
          amazonIdRelated = Array.isArray(amzRaw) ? Array.isArray(amzRaw[0]) ? amzRaw[0] : amzRaw : [];
        }
        let nameRelated = [];
        if (acctData?.accountName) {
          const nameRaw = await db.execute(sql.raw(
            `SELECT id, organization_id, userId, storeName, marketplace, accountName, status FROM ad_accounts WHERE accountName LIKE '%${acctData.accountName.split("/")[0].split(" ")[0]}%' AND id != ${accountId}`
          ));
          nameRelated = Array.isArray(nameRaw) ? Array.isArray(nameRaw[0]) ? nameRaw[0] : nameRaw : [];
        }
        res.json({
          description: `\u8D26\u6237 ${accountId} \u521B\u5EFA\u6EAF\u6E90\u5206\u6790`,
          account: acct[0] || null,
          auditLogs: audits,
          apiCredentials: creds,
          relatedByProfileId: relatedAccounts,
          relatedBySellerId: sellerRelated,
          relatedByAmazonAccountId: amazonIdRelated,
          relatedByName: nameRelated,
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
    router3.get("/credential-trace/:accountId", async (req, res) => {
      try {
        const db = await getDb();
        if (!db) {
          res.status(503).json({ error: "DB not available" });
          return;
        }
        const accountId = Number(req.params.accountId);
        const credRaw = await db.execute(sql.raw(
          `SELECT id, organization_id, accountId, clientId, refreshToken, profileId, region, createdAt FROM amazon_api_credentials WHERE accountId = ${accountId}`
        ));
        const creds = Array.isArray(credRaw) ? Array.isArray(credRaw[0]) ? credRaw[0] : credRaw : [];
        const cred = creds[0];
        if (!cred) {
          res.json({ error: `\u8D26\u6237 ${accountId} \u6CA1\u6709 API \u51ED\u8BC1` });
          return;
        }
        const sharedRaw = await db.execute(sql.raw(
          `SELECT c.id, c.organization_id as credOrgId, c.accountId, c.clientId, c.profileId, c.region, c.createdAt as credCreatedAt, a.storeName, a.marketplace, a.userId, a.organization_id as acctOrgId, a.status FROM amazon_api_credentials c LEFT JOIN ad_accounts a ON c.accountId = a.id WHERE c.clientId = '${cred.clientId}' ORDER BY c.accountId`
        ));
        const shared = Array.isArray(sharedRaw) ? Array.isArray(sharedRaw[0]) ? sharedRaw[0] : sharedRaw : [];
        const tokenRaw = await db.execute(sql.raw(
          `SELECT c.id, c.accountId, c.profileId, a.storeName, a.marketplace, a.userId, a.organization_id as acctOrgId FROM amazon_api_credentials c LEFT JOIN ad_accounts a ON c.accountId = a.id WHERE c.refreshToken = '${cred.refreshToken.replace(/'/g, "''")}' ORDER BY c.accountId`
        ));
        const tokenShared = Array.isArray(tokenRaw) ? Array.isArray(tokenRaw[0]) ? tokenRaw[0] : tokenRaw : [];
        const orgIds = new Set(shared.map((s) => s.acctOrgId).filter(Boolean));
        const userIds = new Set(shared.map((s) => s.userId).filter(Boolean));
        res.json({
          description: `\u8D26\u6237 ${accountId} \u51ED\u8BC1\u5173\u8054\u6EAF\u6E90`,
          targetCredential: { clientId: cred.clientId?.substring(0, 20) + "...", profileId: cred.profileId, region: cred.region },
          sharedByClientId: shared,
          sharedByRefreshToken: tokenShared,
          analysis: {
            totalAccountsWithSameClientId: shared.length,
            totalAccountsWithSameRefreshToken: tokenShared.length,
            organizationsInvolved: [...orgIds],
            usersInvolved: [...userIds]
          },
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
    // ==================== v620-fix12: 孤儿账户检测和清理API ====================
    router3.get("/orphan-accounts", opsAuth, async (req, res) => {
      try {
        const { getDb: getDb3 } = await Promise.resolve().then(() => (init_db2(), db_exports));
        const database = await getDb3();
        if (!database) return res.status(500).json({ error: "Database not available" });
        const { sql: sql15 } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
        // 查找所有disconnected但status=active的账户
        const orphanAccounts = await database.execute(sql15.raw(`
          SELECT a.id, a.accountId, a.accountName, a.marketplace, a.profileId, 
                 a.status, a.connectionStatus, a.userId, a.createdAt,
                 (SELECT COUNT(*) FROM campaigns c WHERE c.accountId = a.id) as campaignCount,
                 (SELECT COUNT(*) FROM optimization_logs ol WHERE ol.account_id = a.id) as logCount,
                 (SELECT COUNT(*) FROM optimization_logs ol WHERE ol.account_id = a.id AND ol.api_sync_status = 'synced') as syncedLogCount
          FROM ad_accounts a
          WHERE a.connectionStatus != 'connected' AND a.status = 'active'
          ORDER BY a.createdAt DESC
        `));
        const rows = orphanAccounts?.[0] || orphanAccounts;
        // 查找有API凭证但没有ad_account的记录
        const orphanCredentials = await database.execute(sql15.raw(`
          SELECT c.id, c.accountId, c.profileId, c.region, c.createdAt
          FROM amazon_api_credentials c
          LEFT JOIN ad_accounts a ON c.accountId = a.id
          WHERE a.id IS NULL
        `));
        const credRows = orphanCredentials?.[0] || orphanCredentials;
        res.json({
          success: true,
          orphanAccounts: Array.isArray(rows) ? rows : [],
          orphanCredentials: Array.isArray(credRows) ? credRows : [],
          timestamp: new Date().toISOString()
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
    router3.post("/cleanup-orphan-account/:accountId", opsAuth, async (req, res) => {
      try {
        const accountId = parseInt(req.params.accountId);
        if (!accountId || isNaN(accountId)) return res.status(400).json({ error: "Invalid accountId" });
        const { getDb: getDb3 } = await Promise.resolve().then(() => (init_db2(), db_exports));
        const database = await getDb3();
        if (!database) return res.status(500).json({ error: "Database not available" });
        const { sql: sql15 } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
        // 确认账户是孤儿账户
        const acctResult = await database.execute(sql15.raw(`SELECT id, accountName, connectionStatus, status FROM ad_accounts WHERE id = ${accountId}`));
        const acctRows = acctResult?.[0] || acctResult;
        if (!Array.isArray(acctRows) || acctRows.length === 0) return res.status(404).json({ error: "Account not found" });
        const acct = acctRows[0];
        if (acct.connectionStatus === 'connected') return res.status(400).json({ error: "Cannot cleanup a connected account" });
        const dryRun = req.query.dryRun === 'true';
        const cleanupResult = { accountId, accountName: acct.accountName, dryRun, actions: [] };
        // 1. 删除优化日志
        const logCount = await database.execute(sql15.raw(`SELECT COUNT(*) as cnt FROM optimization_logs WHERE account_id = ${accountId}`));
        const logCnt = (logCount?.[0] || logCount)?.[0]?.cnt || 0;
        cleanupResult.actions.push({ table: 'optimization_logs', count: logCnt });
        // 2. 删除performance_groups
        const pgCount = await database.execute(sql15.raw(`SELECT COUNT(*) as cnt FROM performance_groups WHERE accountId = ${accountId}`));
        const pgCnt = (pgCount?.[0] || pgCount)?.[0]?.cnt || 0;
        cleanupResult.actions.push({ table: 'performance_groups', count: pgCnt });
        // 3. 删除keywords
        const kwCount = await database.execute(sql15.raw(`SELECT COUNT(*) as cnt FROM keywords WHERE accountId = ${accountId}`));
        const kwCnt = (kwCount?.[0] || kwCount)?.[0]?.cnt || 0;
        cleanupResult.actions.push({ table: 'keywords', count: kwCnt });
        // 4. 删除campaigns
        const campCount = await database.execute(sql15.raw(`SELECT COUNT(*) as cnt FROM campaigns WHERE accountId = ${accountId}`));
        const campCnt = (campCount?.[0] || campCount)?.[0]?.cnt || 0;
        cleanupResult.actions.push({ table: 'campaigns', count: campCnt });
        // 5. 删除API凭证
        const credCount = await database.execute(sql15.raw(`SELECT COUNT(*) as cnt FROM amazon_api_credentials WHERE accountId = ${accountId}`));
        const credCnt = (credCount?.[0] || credCount)?.[0]?.cnt || 0;
        cleanupResult.actions.push({ table: 'amazon_api_credentials', count: credCnt });
        if (!dryRun) {
          await database.execute(sql15.raw(`DELETE FROM optimization_logs WHERE account_id = ${accountId}`));
          await database.execute(sql15.raw(`DELETE FROM dayparting_performance WHERE accountId = ${accountId}`));
          await database.execute(sql15.raw(`DELETE FROM daily_performance WHERE accountId = ${accountId}`));
          await database.execute(sql15.raw(`DELETE FROM keywords WHERE accountId = ${accountId}`));
          await database.execute(sql15.raw(`DELETE FROM ad_groups WHERE accountId = ${accountId}`));
          await database.execute(sql15.raw(`DELETE FROM product_targets WHERE accountId = ${accountId}`));
          await database.execute(sql15.raw(`DELETE FROM performance_groups WHERE accountId = ${accountId}`));
          await database.execute(sql15.raw(`DELETE FROM campaigns WHERE accountId = ${accountId}`));
          await database.execute(sql15.raw(`DELETE FROM amazon_api_credentials WHERE accountId = ${accountId}`));
          await database.execute(sql15.raw(`DELETE FROM ad_accounts WHERE id = ${accountId}`));
          cleanupResult.actions.push({ table: 'ad_accounts', count: 1, action: 'deleted' });
        }
        res.json({ success: true, ...cleanupResult });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
    // ==================== v620-fix12: 优化日志批量导出API ====================
    router3.get("/export-optimization-logs/:accountId", opsAuth, async (req, res) => {
      try {
        const accountId = parseInt(req.params.accountId);
        if (!accountId || isNaN(accountId)) return res.status(400).json({ error: "Invalid accountId" });
        const { getDb: getDb3 } = await Promise.resolve().then(() => (init_db2(), db_exports));
        const database = await getDb3();
        if (!database) return res.status(500).json({ error: "Database not available" });
        const { sql: sql15 } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
        const startDate = req.query.startDate || '2026-01-01';
        const endDate = req.query.endDate || '2099-12-31';
        const format = req.query.format || 'json';
        const logs = await database.execute(sql15.raw(`
          SELECT ol.id, ol.account_id, ol.account_name, ol.performance_group_id, ol.performance_group_name,
                 ol.campaign_id, ol.campaign_name, ol.action_type, ol.log_category,
                 ol.action_detail, ol.previous_value, ol.new_value, ol.change_reason,
                 ol.time_slot_label, ol.api_sync_status, ol.api_synced_at,
                 ol.status, ol.error_message, ol.created_at, ol.executed_at
          FROM optimization_logs ol
          WHERE ol.account_id = ${accountId}
            AND ol.created_at >= '${startDate}'
            AND ol.created_at <= '${endDate} 23:59:59'
          ORDER BY ol.created_at DESC
        `));
        const rows = logs?.[0] || logs;
        if (format === 'csv') {
          const headers = ['ID','AccountID','AccountName','PG_ID','PG_Name','CampaignID','CampaignName','ActionType','LogCategory','ActionDetail','PreviousValue','NewValue','ChangeReason','TimeSlot','APISyncStatus','APISyncedAt','Status','ErrorMessage','CreatedAt','ExecutedAt'];
          let csv = headers.join(',') + '\n';
          if (Array.isArray(rows)) {
            for (const row of rows) {
              csv += [row.id, row.account_id,
                '"' + String(row.account_name || '').replace(/"/g, '""') + '"',
                row.performance_group_id,
                '"' + String(row.performance_group_name || '').replace(/"/g, '""') + '"',
                row.campaign_id,
                '"' + String(row.campaign_name || '').replace(/"/g, '""') + '"',
                row.action_type, row.log_category,
                '"' + String(row.action_detail || '').replace(/"/g, '""') + '"',
                row.previous_value, row.new_value,
                '"' + String(row.change_reason || '').replace(/"/g, '""') + '"',
                row.time_slot_label, row.api_sync_status, row.api_synced_at,
                row.status, '"' + String(row.error_message || '').replace(/"/g, '""') + '"',
                row.created_at, row.executed_at
              ].join(',') + '\n';
            }
          }
          res.setHeader('Content-Type', 'text/csv; charset=utf-8');
          res.setHeader('Content-Disposition', `attachment; filename=optimization_logs_${accountId}_${startDate}_${endDate}.csv`);
          return res.send('\uFEFF' + csv);
        }
        res.json({
          success: true,
          accountId,
          total: Array.isArray(rows) ? rows.length : 0,
          logs: Array.isArray(rows) ? rows : [],
          exportedAt: new Date().toISOString()
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
    ops_default = router3;
  }
});

