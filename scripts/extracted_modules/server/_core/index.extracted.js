// Extracted from production dist/index.js
// Original module: server/_core/index.ts
// Lines: 496

var index_exports = {};
function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = import_net.default.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}
async function findAvailablePort(startPort = 3e3) {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}
async function startServer() {
  const app = (0, import_express4.default)();
  const server = (0, import_http4.createServer)(app);
  app.use((0, import_compression.default)({
    level: 6,
    threshold: 1024,
    filter: /* @__PURE__ */ __name((req, res) => {
      if (req.headers["accept"] === "text/event-stream") {
        return false;
      }
      return import_compression.default.filter(req, res);
    }, "filter")
  }));
  app.use(import_express4.default.json({ limit: "50mb" }));
  app.use(import_express4.default.urlencoded({ limit: "50mb", extended: true }));
  app.get("/health", async (req, res) => {
    const info = getSystemInfo();
    if (info.isShuttingDown) {
      res.status(503).json({
        status: "shutting_down",
        version: `v${info.version}`,
        activeTasks: info.activeTasks
      });
      return;
    }
    let dbHealthy = false;
    try {
      const { getDb: getDb3 } = await Promise.resolve().then(() => (init_connection(), connection_exports));
      const db = await getDb3();
      if (db) {
        const { sql: sql15 } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
        await db.execute(sql15`SELECT 1`);
        dbHealthy = true;
      }
    } catch {
      dbHealthy = false;
    }
    const memUsage = process.memoryUsage();
    const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);
    const { isHeapHealthy: isHeapHealthy2 } = (init_systemConfigService2(), __toCommonJS(systemConfigService_exports2));
    const memoryHealthy = isHeapHealthy2(heapUsedMB);
    const overallHealthy = dbHealthy && memoryHealthy;
    const status = overallHealthy ? "healthy" : "degraded";
    res.status(overallHealthy ? 200 : 200).json({
      status,
      version: `v${info.version}`,
      uptime: Math.round(info.uptime),
      activeTasks: info.activeTasks,
      checks: {
        database: dbHealthy ? "ok" : "fail",
        memory: memoryHealthy ? "ok" : `warning (${heapUsedMB}MB/${heapTotalMB}MB)`
      }
    });
  });
  app.get("/api/system/status", (req, res) => {
    const info = getSystemInfo();
    res.json({
      ...info,
      nodeVersion: process.version,
      memoryUsage: process.memoryUsage(),
      pid: process.pid
    });
  });
  app.use("/api/trpc", (req, res, next) => {
    if (isShuttingDown()) {
      res.status(503).json({
        error: "Service is shutting down for deployment. Please retry in 30 seconds.",
        retryAfter: 30
      });
      return;
    }
    next();
  });
  registerOAuthRoutes(app);
  registerAmazonAuthCallbackRoutes(app);
  app.use("/api/ops", ops_default);
  app.use("/api", sitemap_default);
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext
    })
  );
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }
  const preferredPort = parseInt(process.env.PORT || "3000");
  let port = preferredPort;
  if (process.env.NODE_ENV !== "production") {
    port = await findAvailablePort(preferredPort);
    if (port !== preferredPort) {
      log215.info(`Port ${preferredPort} is busy, using port ${port} instead`);
    }
  }
  server.listen(port, () => {
    log215.info(`Server running on http://localhost:${port}/ (v${SYSTEM_VERSION})`);
    // v588: 启动AsyncReportService定期调度 - 每3分钟检查一次
    setInterval(async () => {
      try {
        const asyncSvc = new AsyncReportService();
        const checked = await asyncSvc.checkSubmittedJobs(10);
        const processed = await asyncSvc.processCompletedJobs(5);
        if (checked.completed > 0 || checked.failed > 0 || processed > 0) {
          log215.info(`[v588 AsyncScheduler] checked=${JSON.stringify(checked)}, processed=${processed}`);
        }
      } catch (e) {
        // 静默处理 - 不影响主流程
      }
    }, 3 * 60 * 1000);
    log215.info("[v588] AsyncReportService定期调度已启动(每3分钟)");
    logSystem("Startup", `\u7CFB\u7EDF\u542F\u52A8\u5B8C\u6210 v${SYSTEM_VERSION}`, { port, nodeVersion: process.version, pid: process.pid });
    logger.setDbProvider(getDb);
    getDb().then(async (db) => {
      if (db) {
        try {
          await db.execute(`CREATE TABLE IF NOT EXISTS \`system_logs\` (
            \`id\` int NOT NULL AUTO_INCREMENT,
            \`timestamp\` datetime NOT NULL,
            \`level\` varchar(8) NOT NULL,
            \`module\` varchar(128) NOT NULL,
            \`message\` text NOT NULL,
            \`metadata\` text DEFAULT NULL,
            PRIMARY KEY (\`id\`),
            INDEX \`idx_syslog_timestamp\` (\`timestamp\`),
            INDEX \`idx_syslog_level\` (\`level\`),
            INDEX \`idx_syslog_module\` (\`module\`(64)),
            INDEX \`idx_syslog_level_timestamp\` (\`level\`, \`timestamp\`)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
          log215.info("[Logger] system_logs\u8868\u5DF2\u5C31\u7EEA");
        } catch (e) {
          log215.warn("[Logger] system_logs\u8868\u521B\u5EFA\u5931\u8D25:", e.message);
        }
      }
    }).catch(() => {
    });
    ensureNextGenTables().then((result) => {
      if (result.success) {
        log215.info(`[NextGen] \u6570\u636E\u5E93\u8868\u68C0\u67E5\u5B8C\u6210: ${result.tablesCreated} \u4E2A\u8868\u5DF2\u5C31\u7EEA`);
      } else {
        log215.warn("[NextGen] \u6570\u636E\u5E93\u8868\u521B\u5EFA\u5931\u8D25:", result.error);
      }
    }).catch((err) => {
      log215.warn("[NextGen] \u6570\u636E\u5E93\u8868\u68C0\u67E5\u5F02\u5E38:", err.message);
    });
    runAutoDbMigration().then((result) => {
      if (result.success) {
        log215.info(`[AutoDbMigration] v248\u6570\u636E\u5E93\u8FC1\u79FB\u5B8C\u6210: ${result.results.join("; ")}`);
      } else {
        log215.warn("[AutoDbMigration] v248\u6570\u636E\u5E93\u8FC1\u79FB\u5931\u8D25:", result.results.join("; "));
      }
    }).catch((err) => {
      log215.warn("[AutoDbMigration] v248\u8FC1\u79FB\u5F02\u5E38:", err.message);
    });
    runPrelaunchDbMigration().then((result) => {
      if (result.success) {
        log215.info(`[PrelaunchDb] \u9884\u53D1\u5E03\u5F15\u64CE\u8868\u8FC1\u79FB\u5B8C\u6210: ${result.results.filter((r) => r.includes("\u5DF2\u5C31\u7EEA")).length} \u5F20\u8868\u521B\u5EFA/\u786E\u8BA4`);
      } else {
        log215.warn("[PrelaunchDb] \u9884\u53D1\u5E03\u5F15\u64CE\u8868\u8FC1\u79FB\u5931\u8D25:", result.results.join("; "));
      }
    }).catch((err) => {
      log215.warn("[PrelaunchDb] \u9884\u53D1\u5E03\u5F15\u64CE\u8868\u8FC1\u79FB\u5F02\u5E38:", err.message);
    });
    initializeRLS().then((result) => {
      if (result.success) {
        log215.info(`[RLS] \u6570\u636E\u5E93\u7EA7\u884C\u7EA7\u5B89\u5168\u521D\u59CB\u5316\u5B8C\u6210: ${result.viewsCreated} \u4E2A\u5B89\u5168\u89C6\u56FE\u5DF2\u521B\u5EFA`);
      } else {
        log215.warn(`[RLS] RLS\u521D\u59CB\u5316\u90E8\u5206\u5931\u8D25: ${result.errors.join("; ")}`);
      }
    }).catch((err) => {
      log215.warn("[RLS] RLS\u521D\u59CB\u5316\u5F02\u5E38:", err.message);
    });
    runAutoMigration().then((result) => {
      if (result.success) {
        const total = Object.values(result.migrated).reduce((a, b) => a + b, 0);
        if (total > 0) {
          log215.info(`[AutoMigration] v146\u6570\u636E\u8FC1\u79FB\u5B8C\u6210: \u5171\u8FC1\u79FB ${total} \u6761\u8BB0\u5F55`, result.migrated);
        } else {
          log215.info("[AutoMigration] v146\u6570\u636E\u8FC1\u79FB: \u65E0\u65B0\u6570\u636E\u9700\u8981\u8FC1\u79FB", result.skipped);
        }
      } else {
        log215.warn("[AutoMigration] v146\u6570\u636E\u8FC1\u79FB\u5931\u8D25:", result.skipped);
      }
    }).catch((err) => {
      log215.warn("[AutoMigration] v146\u8FC1\u79FB\u5F02\u5E38:", err.message);
    });
    migrateCampaignIdsToAmazonIds().then(() => {
      log215.info("[AutoMigration] v208 campaignId\u6807\u51C6\u5316\u8FC1\u79FB\u5B8C\u6210");
      logMigration("CampaignIdMigration", "v208 campaignId\u6807\u51C6\u5316\u8FC1\u79FB\u5B8C\u6210");
    }).catch((err) => {
      log215.warn("[AutoMigration] v208 campaignId\u8FC1\u79FB\u5F02\u5E38:", err.message);
      logMigration("CampaignIdMigration", `v208 campaignId\u8FC1\u79FB\u5F02\u5E38: ${err.message}`);
    });
    try {
      initEntityIdResolver(createEntityIdResolverDbProvider());
      log215.info("[EntityIdResolver] v429: \u96C6\u4E2D\u5F0FID\u89E3\u6790\u5668\u5DF2\u521D\u59CB\u5316");
      logSystem("EntityIdResolver", "v429: \u96C6\u4E2D\u5F0FID\u89E3\u6790\u5668\u5DF2\u521D\u59CB\u5316");
    } catch (resolverErr) {
      log215.warn(`[EntityIdResolver] v429: \u521D\u59CB\u5316\u5931\u8D25: ${resolverErr.message}`);
    }
    Promise.resolve().then(() => (init_redisClient(), redisClient_exports)).then(async ({ ensureRedis: ensureRedis2, redisHealthCheck: redisHealthCheck2 }) => {
      const connected = await ensureRedis2();
      if (connected) {
        const health = await redisHealthCheck2();
        log215.info(`[Redis] v427: Redis \u8FDE\u63A5\u5DF2\u5EFA\u7ACB (latency: ${health.latencyMs}ms)`);
        logSystem("Redis", `Redis \u8FDE\u63A5\u5DF2\u5EFA\u7ACB (latency: ${health.latencyMs}ms)`);
        try {
          const { startDynamicLogLevelRefresh: startDynamicLogLevelRefresh2 } = await Promise.resolve().then(() => (init_dynamicLogLevel(), dynamicLogLevel_exports));
          startDynamicLogLevelRefresh2();
          log215.info("[DynamicLogLevel] v614k: \u52A8\u6001\u65E5\u5FD7\u7EA7\u522B\u63A7\u5236\u5DF2\u542F\u52A8");
        } catch (dlErr) {
          log215.warn(`[DynamicLogLevel] v614k: \u542F\u52A8\u5931\u8D25: ${dlErr.message}`);
        }
      } else {
        log215.info("[Redis] v427: Redis \u4E0D\u53EF\u7528\uFF0C\u5206\u5E03\u5F0F\u9501\u5C06\u4F7F\u7528 MySQL sync_locks \u8868");
        try {
          const { startDynamicLogLevelRefresh: startDynamicLogLevelRefresh2 } = await Promise.resolve().then(() => (init_dynamicLogLevel(), dynamicLogLevel_exports));
          startDynamicLogLevelRefresh2();
        } catch {
        }
      }
    }).catch((err) => {
      log215.warn(`[Redis] v427: Redis \u521D\u59CB\u5316\u5F02\u5E38: ${err.message}`);
    });
    startDataSyncScheduler(60 * 60 * 1e3);
    log215.info("[DataSyncScheduler] \u5B9A\u65F6\u540C\u6B65\u8C03\u5EA6\u5668\u5DF2\u542F\u52A8\uFF0C\u95F4\u9694: 1\u5C0F\u65F6");
    log215.info("[OptimizationScheduler] v374: \u4F18\u5316\u8C03\u5EA6\u5668\u5C06\u7531Leader\u9009\u4E3E\u673A\u5236\u63A7\u5236\u542F\u52A8\uFF0C\u786E\u4FDD\u5355\u5B9E\u4F8B\u6267\u884C");
    log215.info("[TargetScheduler] v142: daily\u5168\u91CF\u6267\u884C\u5DF2\u7981\u7528\uFF0C\u4F18\u5316\u8C03\u5EA6\u7531dataSyncScheduler\u7EDF\u4E00\u7BA1\u7406");
    if (process.env.AWS_SQS_QUEUE_TRAFFIC_URL || process.env.AWS_SQS_QUEUE_CONVERSION_URL || process.env.AWS_SQS_QUEUE_BUDGET_URL) {
      startSQSConsumer().then(() => {
        log215.info("[SQS Consumer] AMS\u5B9E\u65F6\u6570\u636E\u6D41\u6D88\u8D39\u8005\u5DF2\u542F\u52A8");
      }).catch((err) => {
        log215.warn("[SQS Consumer] \u542F\u52A8\u5931\u8D25:", err.message);
      });
    } else {
      log215.info("[SQS Consumer] \u672A\u914D\u7F6ESQS\u961F\u5217URL\uFF0C\u8DF3\u8FC7AMS\u6D88\u8D39\u8005\u542F\u52A8");
    }
    startObservabilityService();
    log215.info("[Observability] v267: \u7EDF\u4E00\u53EF\u89C2\u6D4B\u6027\u670D\u52A1\u5DF2\u542F\u52A8 - \u6307\u6807\u6536\u96C6/\u544A\u8B66/\u5065\u5EB7\u6458\u8981");
    startEffectTrackingScheduler(60 * 60 * 1e3);
    log215.info("[EffectTrackingScheduler] v417: \u6548\u679C\u8FFD\u8E2A\u8C03\u5EA6\u5668\u5DF2\u542F\u52A8\uFF0C\u95F4\u9694: 1\u5C0F\u65F6");
    reportJobScheduler.start();
    log215.info("[ReportJobScheduler] \u5F02\u6B65\u62A5\u544A\u4EFB\u52A1\u8C03\u5EA6\u5668\u5DF2\u542F\u52A8");
    // v595: Cleanup stuck submitted jobs on startup (older than 2 hours without reportId)
    (async () => {
      try {
        const { getDb: getDb595 } = await Promise.resolve().then(() => (init_db2(), db_exports));
        const db595 = await getDb595();
        if (db595) {
          const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
          const result = await db595.execute(
            sql`UPDATE report_jobs SET status = 'pending', retryCount = retryCount + 1 
                WHERE status = 'submitted' AND reportId IS NULL AND submittedAt < ${twoHoursAgo}`
          );
          const resetCount = result?.[0]?.affectedRows || 0;
          if (resetCount > 0) {
            log215.info(`[v595] Reset ${resetCount} stuck submitted jobs (no reportId, >2h old) to pending`);
          }
          // v595: Also expire very old submitted jobs (> 7 days)
          const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
          const expResult = await db595.execute(
            sql`UPDATE report_jobs SET status = 'expired' 
                WHERE status = 'submitted' AND submittedAt < ${sevenDaysAgo}`
          );
          const expCount = expResult?.[0]?.affectedRows || 0;
          if (expCount > 0) {
            log215.info(`[v595] Expired ${expCount} very old submitted jobs (>7 days)`);
          }
          // P5e: Clean up P5b/P5c failed jobs with empty profileId (400 errors)
          try {
            const p5eCleanResult = await db595.execute(
              sql`UPDATE report_jobs SET status = 'expired', errorMessage = 'P5e: Cleaned up legacy job with profileId issue'
                  WHERE status = 'failed' AND errorMessage LIKE '%profile ID required%' AND retryCount >= 3`
            );
            const p5eCleanCount = p5eCleanResult?.[0]?.affectedRows || 0;
            if (p5eCleanCount > 0) {
              log215.info(`[P5e] Cleaned up ${p5eCleanCount} legacy failed jobs (profileId issue from P5b/P5c)`);
            }
          } catch (_p5eErr) {
            log215.debug(`[P5e] Legacy job cleanup skipped: ${_p5eErr.message}`);
          }
          // P5e: Also clean up completed/processed jobs older than 3 days to keep table lean
          try {
            const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
            const cleanResult = await db595.execute(
              sql`DELETE FROM report_jobs WHERE status IN ('completed', 'expired') AND createdAt < ${threeDaysAgo}`
            );
            const cleanCount = cleanResult?.[0]?.affectedRows || 0;
            if (cleanCount > 0) {
              log215.info(`[P5e] Purged ${cleanCount} old completed/expired jobs (>3 days)`);
            }
          } catch (_purgeErr) {
            log215.debug(`[P5e] Job purge skipped: ${_purgeErr.message}`);
          }
        }
      } catch (e) {
        log215.warn(`[v595] Startup report job cleanup failed: ${e.message}`);
      }
    })();
    startCloudWatchMonitor();
    getExchangeRates().then((rates) => {
      log215.info(`[ExchangeRate] v451: \u6C47\u7387\u670D\u52A1\u521D\u59CB\u5316\u5B8C\u6210\uFF0C\u5171${Object.keys(rates).length}\u79CD\u8D27\u5E01`);
    }).catch((err) => {
      log215.warn(`[ExchangeRate] v451: \u6C47\u7387\u670D\u52A1\u521D\u59CB\u5316\u5931\u8D25: ${err.message}\uFF0C\u5C06\u4F7F\u7528\u9759\u6001\u5146\u5E95\u6C47\u7387`);
    });
    initStartupTasks().catch((err) => {
      log215.warn("[StartupTasks] v614i: \u542F\u52A8\u4EFB\u52A1\u521D\u59CB\u5316\u5931\u8D25:", err.message);
    });
    try {
      if (isRedisQueueEnabled()) {
        startSyncTaskConsumer();
        log215.info("[SyncTaskConsumer] v580: Redis \u4EFB\u52A1\u6D88\u8D39\u8005\u5DF2\u542F\u52A8\uFF08\u961F\u5217\u6A21\u5F0F\uFF09");
      } else {
        log215.info("[SyncTaskConsumer] v580: Redis \u961F\u5217\u672A\u542F\u7528\uFF0C\u4EFB\u52A1\u6D88\u8D39\u8005\u8DF3\u8FC7\u542F\u52A8\uFF08\u4F7F\u7528\u65E7\u8C03\u5EA6\u5668\u76F4\u63A5\u6267\u884C\u6A21\u5F0F\uFF09");
      }
    } catch (consumerErr) {
      log215.warn(`[SyncTaskConsumer] v580: \u6D88\u8D39\u8005\u542F\u52A8\u5931\u8D25: ${consumerErr.message}`);
    }
    orchestrateStartup(server).catch((err) => {
      log215.warn("[LifecycleManager] \u542F\u52A8\u534F\u8C03\u5931\u8D25:", err.message);
    });
  });
}
var import_express4, import_compression, import_http4, import_net, log215;
var init_index = __esm({
  "server/_core/index.ts"() {
    init_config();
    init_patchSqlstring();
    init_logger();
    import_express4 = __toESM(require("express"));
    import_compression = __toESM(require_compression());
    import_http4 = require("http");
    import_net = __toESM(require("net"));
    init_express();
    init_oauth();
    init_amazonAuthCallback();
    init_routers();
    init_context();
    init_vite();
    init_dataSyncScheduler();
    init_db2();
    init_sqsConsumerService();
    init_reportJobScheduler();
    init_sitemap();
    init_ops();
    init_postDeployOptimizer();
    init_deployLifecycleManager();
    init_taskLifecycle();
    init_nextGenMigration();
    init_observabilityService();
    init_dbAutoMigration();
    init_prelaunchDbMigration();
    init_migrateCampaignIds();
    init_opsLogger();
    init_dbRLS();
    init_effectTrackingScheduler();
    init_init();
    init_entityIdResolver();
    init_entityIdResolverDbProvider();
    init_cloudwatchMonitor();
    init_startupTasks();
    init_syncTaskConsumer();
    init_syncSchedulerAdapter();
    init_exchangeRateService();
    patchSqlstring();
    log215 = createModuleLogger("Server");
    __name(isPortAvailable, "isPortAvailable");
    __name(findAvailablePort, "findAvailablePort");
    __name(startServer, "startServer");
    startServer().catch(console.error);
  }
});
init_index();
/*! Bundled license information:

negotiator/index.js:
  (*!
   * negotiator
   * Copyright(c) 2012 Federico Romero
   * Copyright(c) 2012-2014 Isaac Z. Schlueter
   * Copyright(c) 2015 Douglas Christopher Wilson
   * MIT Licensed
   *)

safe-buffer/index.js:
  (*! safe-buffer. MIT License. Feross Aboukhadijeh <https://feross.org/opensource> *)

bytes/index.js:
  (*!
   * bytes
   * Copyright(c) 2012-2014 TJ Holowaychuk
   * Copyright(c) 2015 Jed Watson
   * MIT Licensed
   *)

mime-db/index.js:
mime-db/index.js:
  (*!
   * mime-db
   * Copyright(c) 2014 Jonathan Ong
   * Copyright(c) 2015-2022 Douglas Christopher Wilson
   * MIT Licensed
   *)

compressible/index.js:
  (*!
   * compressible
   * Copyright(c) 2013 Jonathan Ong
   * Copyright(c) 2014 Jeremiah Senkpiel
   * Copyright(c) 2015 Douglas Christopher Wilson
   * MIT Licensed
   *)

on-headers/index.js:
  (*!
   * on-headers
   * Copyright(c) 2014 Douglas Christopher Wilson
   * MIT Licensed
   *)

vary/index.js:
  (*!
   * vary
   * Copyright(c) 2014-2017 Douglas Christopher Wilson
   * MIT Licensed
   *)

compression/index.js:
  (*!
   * compression
   * Copyright(c) 2010 Sencha Inc.
   * Copyright(c) 2011 TJ Holowaychuk
   * Copyright(c) 2014 Jonathan Ong
   * Copyright(c) 2014-2015 Douglas Christopher Wilson
   * MIT Licensed
   *)

@trpc/server/dist/tracked-DiE3uR1B.mjs:
  (* istanbul ignore if -- @preserve *)

@trpc/server/dist/resolveResponse-C5I6V_wc.mjs:
  (* istanbul ignore if -- @preserve *)
  (*!
  * is-plain-object <https://github.com/jonschlinkert/is-plain-object>
  *
  * Copyright (c) 2014-2017, Jon Schlinkert.
  * Released under the MIT License.
  *)

mime-types/index.js:
  (*!
   * mime-types
   * Copyright(c) 2014 Jonathan Ong
   * Copyright(c) 2015 Douglas Christopher Wilson
   * MIT Licensed
   *)

@google/generative-ai/dist/index.mjs:
  (**
   * @license
   * Copyright 2024 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   *)
*/
