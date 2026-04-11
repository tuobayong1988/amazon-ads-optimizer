// Extracted from production dist/index.js
// Original module: server/routes/monitoring.ts
// Lines: 378

var import_os2, import_v84, monitoringRouter;
var init_monitoring = __esm({
  "server/routes/monitoring.ts"() {
    "use strict";
    init_zod();
    import_os2 = __toESM(require("os"));
    import_v84 = __toESM(require("v8"));
    init_trpc();
    init_optimizationMonitoringService();
    init_systemHealthMetricsService();
    init_db2();
    init_connection();
    init_schema2();
    init_drizzle_orm();
    init_apiCacheService();
    monitoringRouter = router({
      /**
       * 获取当前团队的监控报告
       */
      getReport: protectedProcedure.query(async ({ ctx }) => {
        const teamId = ctx.user.id;
        if (!teamId) {
          return {
            success: false,
            error: "\u672A\u5173\u8054\u56E2\u961F",
            report: null
          };
        }
        try {
          const report = await generateMonitoringReport(teamId);
          return {
            success: true,
            error: null,
            report: {
              ...report,
              generatedAt: report.generatedAt.toISOString(),
              alerts: report.alerts.map((a) => ({
                ...a,
                timestamp: a.timestamp.toISOString()
              }))
            }
          };
        } catch (e) {
          return {
            success: false,
            error: e.message,
            report: null
          };
        }
      }),
      /**
       * 手动触发监控检查
       */
      // @ts-ignore
      runCheck: protectedProcedure.mutation(async ({ ctx }) => {
        const teamId = ctx.user.id;
        if (!teamId) {
          return {
            success: false,
            error: "\u672A\u5173\u8054\u56E2\u961F",
            report: null
          };
        }
        try {
          const report = await runMonitoringCheck(teamId);
          return {
            success: true,
            error: null,
            report: {
              ...report,
              generatedAt: report.generatedAt.toISOString(),
              alerts: report.alerts.map((a) => ({
                ...a,
                timestamp: a.timestamp.toISOString()
              }))
            }
          };
        } catch (e) {
          return {
            success: false,
            error: e.message,
            report: null
          };
        }
      }),
      /**
       * v260: 获取系统健康核心指标
       * 
       * 返回回滚率、算法激活率、ACoS趋势、提价分析、熔断触发率等核心指标
       * 用于前端仪表盘实时展示系统健康状况
       */
      getHealthMetrics: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        // @ts-ignore
        days: external_exports.number().optional().default(7)
      })).query(async ({ ctx, input }) => {
        const cacheKey = `monitoring.healthMetrics:${input.accountId}:${input.days}`;
        const cached2 = apiCache.get(cacheKey);
        if (cached2) return cached2;
        try {
          const metrics = await getSystemHealthMetrics(input.accountId, input.days);
          const result = {
            success: true,
            error: null,
            metrics
          };
          apiCache.set(cacheKey, result, 5 * 60 * 1e3);
          return result;
        } catch (e) {
          return {
            success: false,
            error: e.message,
            metrics: null
          };
        }
      }),
      /**
       * v261: 获取部署后纠错报告
       * 
       * 返回最近的部署后重优化结果、纠错结果和效果验证结果
       * 用于前端仪表盘展示每次部署后的纠错执行情况
       */
      getDeployCorrectionReport: protectedProcedure.query(async () => {
        const cacheKey = "monitoring.deployCorrectionReport:global";
        const cached2 = apiCache.get(cacheKey);
        if (cached2) return cached2;
        try {
          const database = await getDb();
          if (!database) {
            return { success: false, error: "\u6570\u636E\u5E93\u8FDE\u63A5\u5931\u8D25", report: null };
          }
          const deployEvents = await database.select({
            id: optimizationEvents2.id,
            actionDetail: optimizationEvents2.actionDetail,
            changeReason: optimizationEvents2.changeReason,
            status: optimizationEvents2.status,
            createdAt: optimizationEvents2.createdAt
          }).from(optimizationEvents2).where(
            and(
              eq(optimizationEvents2.eventCategory, "settings_change"),
              eq(optimizationEvents2.actionType, "settings_update"),
              sql`JSON_EXTRACT(${optimizationEvents2.actionDetail}, '$.type') = 'system_deploy'`
            )
          ).orderBy(desc(optimizationEvents2.createdAt)).limit(5);
          const verifyEvents = await database.select({
            id: optimizationEvents2.id,
            actionDetail: optimizationEvents2.actionDetail,
            changeReason: optimizationEvents2.changeReason,
            status: optimizationEvents2.status,
            createdAt: optimizationEvents2.createdAt
          }).from(optimizationEvents2).where(
            and(
              eq(optimizationEvents2.eventCategory, "settings_change"),
              eq(optimizationEvents2.actionType, "auto_correction"),
              sql`JSON_EXTRACT(${optimizationEvents2.actionDetail}, '$.type') = 'post_deploy_verification'`
            )
          ).orderBy(desc(optimizationEvents2.createdAt)).limit(5);
          const deployHistory = deployEvents.map((e) => {
            let detail = {};
            try {
              detail = JSON.parse(e.actionDetail || "{}");
            } catch {
            }
            return {
              id: e.id,
              version: detail.systemVersion,
              previousVersion: detail.previousVersion,
              targetsProcessed: detail.targetsProcessed || 0,
              targetsSucceeded: detail.targetsSucceeded || 0,
              targetsFailed: detail.targetsFailed || 0,
              totalActions: detail.totalActions || 0,
              status: e.status,
              deployedAt: e.createdAt
            };
          });
          const verifyHistory = verifyEvents.map((e) => {
            let detail = {};
            try {
              detail = JSON.parse(e.actionDetail || "{}");
            } catch {
            }
            return {
              id: e.id,
              version: detail.systemVersion,
              deployResult: detail.deployResult || {},
              correctionResult: detail.correctionResult || {},
              verificationResult: detail.verificationResult || {},
              status: e.status,
              verifiedAt: e.createdAt
            };
          });
          const result = {
            success: true,
            error: null,
            report: {
              deployHistory,
              verifyHistory,
              latestDeploy: deployHistory[0] || null,
              latestVerification: verifyHistory[0] || null
            }
          };
          apiCache.set(cacheKey, result, 10 * 60 * 1e3);
          return result;
        } catch (e) {
          return {
            success: false,
            error: e.message,
            report: null
          };
        }
      }),
      /**
       * v392: 系统资源实时监控
       * 
       * 返回CPU使用率、内存使用量、数据库连接池状态、进程运行时间等关键指标
       * 用于持续监控系统在租户增长时的稳定性
       */
      getSystemResources: protectedProcedure.query(async () => {
        const cacheKey = "monitoring.systemResources:global";
        const cached2 = apiCache.get(cacheKey);
        if (cached2) return cached2;
        try {
          const cpus = import_os2.default.cpus();
          const cpuUsage = cpus.map((cpu) => {
            const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
            const idle = cpu.times.idle;
            return (total - idle) / total * 100;
          });
          const avgCpuUsage = Math.round(cpuUsage.reduce((a, b) => a + b, 0) / cpuUsage.length * 10) / 10;
          const totalMem = import_os2.default.totalmem();
          const freeMem = import_os2.default.freemem();
          const usedMem = totalMem - freeMem;
          const memUsagePercent = Math.round(usedMem / totalMem * 1e3) / 10;
          const processMemory = process.memoryUsage();
          const heapStats = import_v84.default.getHeapStatistics();
          const heapUsedMB = Math.round(processMemory.heapUsed / 1024 / 1024 * 10) / 10;
          const heapTotalMB = Math.round(processMemory.heapTotal / 1024 / 1024 * 10) / 10;
          const heapSizeLimitMB = Math.round(heapStats.heap_size_limit / 1024 / 1024);
          const rssMB = Math.round(processMemory.rss / 1024 / 1024 * 10) / 10;
          const externalMB = Math.round(processMemory.external / 1024 / 1024 * 10) / 10;
          const poolStats = getPoolStats();
          const uptimeSeconds = Math.floor(process.uptime());
          const uptimeHours = Math.round(uptimeSeconds / 3600 * 10) / 10;
          const loadAvg = import_os2.default.loadavg();
          const dbPoolSize = parseInt(process.env.DB_POOL_SIZE || "25", 10);
          const maxOldSpaceSize = process.execArgv.find((a) => a.includes("max-old-space-size"));
          const result = {
            success: true,
            error: null,
            resources: {
              timestamp: (/* @__PURE__ */ new Date()).toISOString(),
              cpu: {
                cores: cpus.length,
                model: cpus[0]?.model || "unknown",
                avgUsagePercent: avgCpuUsage,
                perCoreUsage: cpuUsage.map((u) => Math.round(u * 10) / 10)
              },
              memory: {
                system: {
                  totalMB: Math.round(totalMem / 1024 / 1024),
                  usedMB: Math.round(usedMem / 1024 / 1024),
                  freeMB: Math.round(freeMem / 1024 / 1024),
                  usagePercent: memUsagePercent
                },
                process: {
                  rssMB,
                  heapUsedMB,
                  heapTotalMB,
                  externalMB,
                  heapUsagePercent: Math.round(processMemory.heapUsed / heapStats.heap_size_limit * 1e3) / 10
                },
                nodeMaxOldSpaceMB: heapSizeLimitMB
              },
              database: {
                poolConfigured: dbPoolSize,
                poolCreated: poolStats.created,
                poolExists: poolStats.poolExists,
                dbExists: poolStats.dbExists,
                healthChecksFailed: poolStats.healthChecksFailed,
                poolRebuilds: poolStats.rebuilds,
                directConnBorrowed: poolStats.directConnBorrowed,
                directConnReturned: poolStats.directConnReturned,
                leakedConnections: poolStats.leakedConnections
              },
              system: {
                platform: import_os2.default.platform(),
                arch: import_os2.default.arch(),
                nodeVersion: process.version,
                uptimeHours,
                uptimeSeconds,
                loadAvg1m: Math.round(loadAvg[0] * 100) / 100,
                loadAvg5m: Math.round(loadAvg[1] * 100) / 100,
                loadAvg15m: Math.round(loadAvg[2] * 100) / 100
              },
              alerts: []
            }
          };
          if (avgCpuUsage > 80) result.resources.alerts.push(`CPU\u4F7F\u7528\u7387\u8FC7\u9AD8: ${avgCpuUsage}%`);
          if (memUsagePercent > 85) result.resources.alerts.push(`\u7CFB\u7EDF\u5185\u5B58\u4F7F\u7528\u7387\u8FC7\u9AD8: ${memUsagePercent}%`);
          const heapUsageRatio = processMemory.heapUsed / heapStats.heap_size_limit;
          if (heapUsageRatio > 0.85) result.resources.alerts.push(`Node.js\u5806\u5185\u5B58\u4F7F\u7528\u7387\u8FC7\u9AD8: ${Math.round(heapUsageRatio * 100)}% (${heapUsedMB}MB / ${heapSizeLimitMB}MB)`);
          if (poolStats.leakedConnections > 3) result.resources.alerts.push(`\u68C0\u6D4B\u5230${poolStats.leakedConnections}\u4E2A\u53EF\u80FD\u6CC4\u6F0F\u7684\u6570\u636E\u5E93\u8FDE\u63A5`);
          if (poolStats.healthChecksFailed > 10) result.resources.alerts.push(`\u6570\u636E\u5E93\u5065\u5EB7\u68C0\u67E5\u5931\u8D25${poolStats.healthChecksFailed}\u6B21`);
          apiCache.set(cacheKey, result, 15 * 1e3);
          return result;
        } catch (e) {
          return { success: false, error: e.message, resources: null };
        }
      }),
      /**
       * v358.1: 获取SLO监控指标
       */
      getSLOMetrics: protectedProcedure.query(async () => {
        try {
          const { getSLOMetrics: getSLOMetrics2 } = await Promise.resolve().then(() => (init_sloMonitor(), sloMonitor_exports));
          const metrics = await getSLOMetrics2();
          return { success: true, error: null, metrics };
        } catch (e) {
          return { success: false, error: e.message, metrics: null };
        }
      }),
      /**
       * v358.1: 获取SLO趋势数据
       */
      getSLOTrend: protectedProcedure.input(external_exports.object({ days: external_exports.number().min(1).max(30).optional() }).optional()).query(async ({ ctx, input }) => {
        try {
          const { getSLOTrend: getSLOTrend2 } = await Promise.resolve().then(() => (init_sloMonitor(), sloMonitor_exports));
          const trend = await getSLOTrend2(input?.days || 7);
          return { success: true, error: null, trend };
        } catch (e) {
          return { success: false, error: e.message, trend: [] };
        }
      }),
      /**
       * v358.1: 获取数据完整性检查报告
       */
      getIntegrityReport: protectedProcedure.input(external_exports.object({ daysToCheck: external_exports.number().min(1).max(90).optional() }).optional()).query(async ({ ctx, input }) => {
        try {
          const { checkAllAccountsIntegrity: checkAllAccountsIntegrity2 } = await Promise.resolve().then(() => (init_dataIntegrityChecker(), dataIntegrityChecker_exports));
          const report = await checkAllAccountsIntegrity2(input?.daysToCheck || 14);
          return { success: true, error: null, report };
        } catch (e) {
          return { success: false, error: e.message, report: null };
        }
      }),
      /**
       * v358.1: 手动触发数据完整性检查并自动修复
       */
      triggerIntegrityCheck: protectedProcedure.mutation(async () => {
        try {
          const { checkAllAccountsIntegrity: checkAllAccountsIntegrity2, executeAutoRepair: executeAutoRepair2 } = await Promise.resolve().then(() => (init_dataIntegrityChecker(), dataIntegrityChecker_exports));
          const checkResult = await checkAllAccountsIntegrity2(14);
          const repairResults = [];
          for (const result of checkResult.results.filter((r) => r.needsRepair)) {
            const repairResult = await executeAutoRepair2(result);
            repairResults.push({
              accountId: result.accountId,
              ...repairResult
            });
          }
          return {
            success: true,
            error: null,
            checkResult: {
              totalAccounts: checkResult.totalAccounts,
              healthyAccounts: checkResult.healthyAccounts,
              unhealthyAccounts: checkResult.unhealthyAccounts
            },
            repairResults
          };
        } catch (e) {
          return { success: false, error: e.message, checkResult: null, repairResults: [] };
        }
      })
    });
  }
});

