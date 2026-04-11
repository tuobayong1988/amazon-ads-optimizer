// Extracted from production dist/index.js
// Original module: server/routes/dataHealth.ts
// Lines: 232

var log199, dataHealthRouter;
var init_dataHealth = __esm({
  "server/routes/dataHealth.ts"() {
    "use strict";
    init_zod();
    init_trpc();
    init_logger();
    log199 = createModuleLogger("DataHealthAPI");
    dataHealthRouter = router({
      /**
       * 获取综合数据健康概览
       * 聚合所有子系统的健康状态
       */
      getOverview: protectedProcedure.query(async ({ ctx }) => {
        try {
          const results = {};
          try {
            const { getApiRateLimitService: getApiRateLimitService2 } = await Promise.resolve().then(() => (init_apiRateLimitService(), apiRateLimitService_exports));
            const rateLimitService = getApiRateLimitService2();
            if (rateLimitService) {
              results.rateLimiting = {
                status: "active",
                metrics: rateLimitService.getAllMetrics(),
                configs: rateLimitService.getConfigs()
              };
            } else {
              results.rateLimiting = { status: "not_initialized", metrics: [], configs: {} };
            }
          } catch {
            results.rateLimiting = { status: "unavailable", metrics: [], configs: {} };
          }
          try {
            const { getSelfHealingScheduler: getSelfHealingScheduler2 } = await Promise.resolve().then(() => (init_selfHealingScheduler(), selfHealingScheduler_exports));
            const scheduler2 = getSelfHealingScheduler2();
            if (scheduler2) {
              const status = scheduler2.getStatus();
              results.selfHealing = {
                status: status.running ? "running" : "stopped",
                ...status,
                recentHistory: scheduler2.getRecentHistory(10)
              };
            } else {
              results.selfHealing = { status: "not_initialized" };
            }
          } catch {
            results.selfHealing = { status: "unavailable" };
          }
          try {
            const { getCommandConfirmationService: getCommandConfirmationService2 } = await Promise.resolve().then(() => (init_commandConfirmationService(), commandConfirmationService_exports));
            const confirmService = getCommandConfirmationService2();
            if (confirmService) {
              results.confirmationService = {
                status: "active",
                metrics: confirmService.getMetrics()
              };
            } else {
              results.confirmationService = { status: "not_initialized" };
            }
          } catch {
            results.confirmationService = { status: "unavailable" };
          }
          try {
            const { getDb: getDb3 } = await Promise.resolve().then(() => (init_db2(), db_exports));
            const db = await getDb3();
            if (db) {
              const { dataSyncJobs: dataSyncJobs2 } = await Promise.resolve().then(() => (init_schema2(), schema_exports));
              const { desc: desc29, eq: eq12, sql: sql15 } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
              const { adAccounts: adAccounts3 } = await Promise.resolve().then(() => (init_schema2(), schema_exports));
              const userAccountRows = await db.select({ id: adAccounts3.id }).from(adAccounts3).where(sql15`${adAccounts3.userId} = ${ctx.user?.id || 0}`);
              const userAccountIds = userAccountRows.map((r) => r.id);
              const accountFilter = userAccountIds.length > 0 ? sql15`${dataSyncJobs2.accountId} IN (${sql15.raw(userAccountIds.join(","))})` : sql15`1=0`;
              const recentJobs = await db.select({
                id: dataSyncJobs2.id,
                accountId: dataSyncJobs2.accountId,
                status: dataSyncJobs2.status,
                startedAt: dataSyncJobs2.startedAt,
                completedAt: dataSyncJobs2.completedAt,
                totalSteps: dataSyncJobs2.totalSteps,
                currentStepIndex: dataSyncJobs2.currentStepIndex,
                errorMessage: dataSyncJobs2.errorMessage
              }).from(dataSyncJobs2).where(accountFilter).orderBy(desc29(dataSyncJobs2.startedAt)).limit(10);
              const [syncStats2] = await db.select({
                total: sql15`COUNT(*)`,
                succeeded: sql15`SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END)`,
                failed: sql15`SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END)`,
                running: sql15`SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END)`
              }).from(dataSyncJobs2).where(sql15`${dataSyncJobs2.startedAt} >= DATE_SUB(NOW(), INTERVAL 24 HOUR) AND ${accountFilter}`);
              const trendRows = await db.execute(
                sql15`SELECT 
                    DATE(startedAt) as date,
                    COUNT(*) as total,
                    SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as succeeded,
                    SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
                  FROM data_sync_jobs
                  WHERE startedAt >= DATE_SUB(NOW(), INTERVAL 7 DAY) AND ${accountFilter}
                  GROUP BY DATE(startedAt)
                  ORDER BY date ASC`
              );
              const trendData = (trendRows?.[0] || []).map((r) => ({
                date: r.date,
                dateLabel: r.date ? new Date(r.date).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" }) : "",
                total: Number(r.total || 0),
                succeeded: Number(r.succeeded || 0),
                failed: Number(r.failed || 0),
                rate: Number(r.total) > 0 ? Math.round(Number(r.succeeded || 0) / Number(r.total) * 1e3) / 10 : 0
              }));
              const leaderboardRows = await db.execute(
                sql15`SELECT 
                    accountId,
                    COUNT(*) as total,
                    SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as succeeded
                  FROM data_sync_jobs
                  WHERE startedAt >= DATE_SUB(NOW(), INTERVAL 7 DAY) AND ${accountFilter}
                  GROUP BY accountId
                  ORDER BY total DESC`
              );
              const accountLeaderboard = (leaderboardRows?.[0] || []).map((r) => ({
                accountId: Number(r.accountId),
                total: Number(r.total || 0),
                succeeded: Number(r.succeeded || 0),
                rate: Number(r.total) > 0 ? Math.round(Number(r.succeeded || 0) / Number(r.total) * 100) : 0
              })).sort((a, b) => b.rate - a.rate || b.total - a.total);
              results.syncJobs = {
                status: "active",
                recent: recentJobs,
                stats24h: {
                  total: Number(syncStats2?.total || 0),
                  succeeded: Number(syncStats2?.succeeded || 0),
                  failed: Number(syncStats2?.failed || 0),
                  running: Number(syncStats2?.running || 0),
                  successRate: syncStats2?.total ? Math.round(Number(syncStats2.succeeded || 0) / Number(syncStats2.total) * 100) : 0
                },
                trendData,
                accountLeaderboard
              };
            }
          } catch {
            results.syncJobs = { status: "unavailable" };
          }
          let healthScore = 100;
          const issues = [];
          if (results.rateLimiting?.status !== "active") {
            healthScore -= 10;
            issues.push("\u9650\u6D41\u670D\u52A1\u672A\u6FC0\u6D3B");
          }
          const selfHealingStatus = results.selfHealing?.status;
          if (selfHealingStatus !== "running" && selfHealingStatus !== "running_on_leader" && selfHealingStatus !== "initializing") {
            healthScore -= 15;
            issues.push("\u81EA\u6108\u8C03\u5EA6\u5668\u672A\u8FD0\u884C");
          }
          const syncStats = results.syncJobs?.stats24h;
          if (syncStats) {
            if (syncStats.successRate < 90) {
              healthScore -= 20;
              issues.push(`\u540C\u6B65\u6210\u529F\u7387\u504F\u4F4E: ${syncStats.successRate}%`);
            }
            if (syncStats.failed > 3) {
              healthScore -= 10;
              issues.push(`24h\u5185\u540C\u6B65\u5931\u8D25${syncStats.failed}\u6B21`);
            }
          }
          results.overall = {
            healthScore: Math.max(0, healthScore),
            status: healthScore >= 80 ? "healthy" : healthScore >= 60 ? "degraded" : "unhealthy",
            issues,
            lastChecked: (/* @__PURE__ */ new Date()).toISOString()
          };
          return { success: true, error: null, data: results };
        } catch (e) {
          log199.warn("\u83B7\u53D6\u6570\u636E\u5065\u5EB7\u6982\u89C8\u5931\u8D25", e);
          return { success: false, error: e.message, data: null };
        }
      }),
      /**
       * 获取限流服务详细指标
       */
      getRateLimitMetrics: protectedProcedure.input(external_exports.object({ accountId: external_exports.number().optional() }).optional()).query(async ({ ctx, input }) => {
        try {
          const { getApiRateLimitService: getApiRateLimitService2 } = await Promise.resolve().then(() => (init_apiRateLimitService(), apiRateLimitService_exports));
          const service = getApiRateLimitService2();
          if (!service) {
            return { success: false, error: "\u9650\u6D41\u670D\u52A1\u672A\u521D\u59CB\u5316", metrics: [] };
          }
          const metrics = input?.accountId ? service.getMetrics(input.accountId) : service.getAllMetrics();
          return { success: true, error: null, metrics, configs: service.getConfigs() };
        } catch (e) {
          return { success: false, error: e.message, metrics: [] };
        }
      }),
      /**
       * 获取自愈调度器详细状态
       */
      getSelfHealingStatus: protectedProcedure.query(async () => {
        try {
          const { getSelfHealingScheduler: getSelfHealingScheduler2 } = await Promise.resolve().then(() => (init_selfHealingScheduler(), selfHealingScheduler_exports));
          const scheduler2 = getSelfHealingScheduler2();
          if (!scheduler2) {
            return { success: false, error: "\u81EA\u6108\u8C03\u5EA6\u5668\u672A\u521D\u59CB\u5316", status: null };
          }
          return {
            success: true,
            error: null,
            status: scheduler2.getStatus(),
            recentHistory: scheduler2.getRecentHistory(20)
          };
        } catch (e) {
          return { success: false, error: e.message, status: null };
        }
      }),
      /**
       * 获取指令确认队列状态
       */
      getConfirmationStatus: protectedProcedure.query(async () => {
        try {
          const { getCommandConfirmationService: getCommandConfirmationService2 } = await Promise.resolve().then(() => (init_commandConfirmationService(), commandConfirmationService_exports));
          const service = getCommandConfirmationService2();
          if (!service) {
            return { success: false, error: "\u786E\u8BA4\u670D\u52A1\u672A\u521D\u59CB\u5316", metrics: null };
          }
          return {
            success: true,
            error: null,
            metrics: service.getMetrics()
          };
        } catch (e) {
          return { success: false, error: e.message, metrics: null };
        }
      })
    });
  }
});

