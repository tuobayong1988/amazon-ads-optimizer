// Extracted from production dist/index.js
// Original module: server/routes/dataSync.ts
// Lines: 274

var log175, dataSyncRouter, reportJobsRouter;
var init_dataSync = __esm({
  "server/routes/dataSync.ts"() {
    "use strict";
    init_trpc();
    init_zod();
    init_db2();
    init_dataSyncService();
    init_asyncReportService();
    init_reportJobScheduler();
    init_accountInitializationService2();
    init_smartSyncService();
    init_tieredSyncService();
    init_logger();
    log175 = createModuleLogger("DataSyncRoute");
    dataSyncRouter = router({
      // 创建同步任务
      createJob: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        syncType: external_exports.enum(["campaigns", "keywords", "performance", "all"]).default("all")
      })).mutation(async ({ ctx, input }) => {
        const account = await getAdAccountById(input.accountId);
        const jobId = await createSyncJob2(ctx.user.id, input.accountId, input.syncType);
        if (!jobId) return { success: false, message: "\u521B\u5EFA\u4EFB\u52A1\u5931\u8D25" };
        const { logAudit: logAudit2 } = await Promise.resolve().then(() => (init_auditService(), auditService_exports));
        const syncTypeDesc = {
          campaigns: "\u5E7F\u544A\u6D3B\u52A8",
          keywords: "\u5173\u952E\u8BCD",
          performance: "\u6548\u679C\u6570\u636E",
          all: "\u5168\u90E8\u6570\u636E"
        };
        await logAudit2({
          userId: ctx.user.id,
          userName: ctx.user.name || void 0,
          userEmail: ctx.user.email || void 0,
          actionType: "data_import",
          targetType: "account",
          targetId: String(input.accountId),
          targetName: account?.accountName || void 0,
          description: `\u542F\u52A8\u6570\u636E\u540C\u6B65\uFF08${syncTypeDesc[input.syncType]}\uFF09`,
          metadata: { syncType: input.syncType, jobId },
          accountId: input.accountId,
          accountName: account?.accountName || void 0,
          status: "success"
        });
        executeSyncJob(jobId).catch((err) => log175.warn(`\u540C\u6B65\u4EFB\u52A1\u6267\u884C\u5931\u8D25 (jobId=${jobId}):`, err.message));
        return { success: true, jobId };
      }),
      // 获取同步任务列表
      getJobs: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number().optional(),
        status: external_exports.enum(["pending", "running", "completed", "failed", "cancelled"]).optional(),
        limit: external_exports.number().default(50),
        offset: external_exports.number().default(0)
      })).query(async ({ ctx, input }) => {
        return getSyncJobs(ctx.user.id, input);
      }),
      // 获取同步日志
      getLogs: protectedProcedure.input(external_exports.object({ jobId: external_exports.number() })).query(async ({ ctx, input }) => {
        return getSyncLogs2(input.jobId);
      }),
      // 取消同步任务
      cancelJob: protectedProcedure.input(external_exports.object({ jobId: external_exports.number() })).mutation(async ({ ctx, input }) => {
        return cancelSyncJob(input.jobId, ctx.user.id);
      }),
      // 获取API限流状态
      getRateLimitStatus: protectedProcedure.query(async () => {
        return getRateLimitStatus();
      }),
      // 获取账号API使用统计
      getApiUsage: protectedProcedure.input(external_exports.object({ accountId: external_exports.number() })).query(async ({ ctx, input }) => {
        return getApiUsageStats(input.accountId);
      }),
      // ==================== 定时调度API ====================
      // 创建同步调度
      createSchedule: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        syncType: external_exports.enum(["campaigns", "keywords", "performance", "all"]).default("all"),
        frequency: external_exports.enum(["hourly", "every_2_hours", "every_4_hours", "every_6_hours", "every_12_hours", "daily", "weekly", "monthly"]),
        hour: external_exports.number().min(0).max(23).optional(),
        dayOfWeek: external_exports.number().min(0).max(6).optional(),
        dayOfMonth: external_exports.number().min(1).max(31).optional(),
        isEnabled: external_exports.boolean().default(true)
      })).mutation(async ({ ctx, input }) => {
        const scheduleId = await createSyncSchedule2({
          userId: ctx.user.id,
          ...input
        });
        if (!scheduleId) return { success: false, message: "\u521B\u5EFA\u8C03\u5EA6\u5931\u8D25" };
        return { success: true, scheduleId };
      }),
      // 获取同步调度列表
      getSchedules: protectedProcedure.input(external_exports.object({ accountId: external_exports.number().optional() })).query(async ({ ctx, input }) => {
        return getSyncSchedules(ctx.user.id, input.accountId);
      }),
      // 更新同步调度
      updateSchedule: protectedProcedure.input(external_exports.object({
        id: external_exports.number(),
        syncType: external_exports.enum(["campaigns", "keywords", "performance", "all"]).optional(),
        frequency: external_exports.enum(["hourly", "every_2_hours", "every_4_hours", "every_6_hours", "every_12_hours", "daily", "weekly", "monthly"]).optional(),
        hour: external_exports.number().min(0).max(23).optional(),
        dayOfWeek: external_exports.number().min(0).max(6).optional(),
        dayOfMonth: external_exports.number().min(1).max(31).optional(),
        isEnabled: external_exports.boolean().optional()
      })).mutation(async ({ ctx, input }) => {
        const { id, ...updates } = input;
        const success2 = await updateSyncSchedule2(id, ctx.user.id, updates);
        return { success: success2 };
      }),
      // 删除同步调度
      deleteSchedule: protectedProcedure.input(external_exports.object({ id: external_exports.number() })).mutation(async ({ ctx, input }) => {
        const success2 = await deleteSyncSchedule2(input.id, ctx.user.id);
        return { success: success2 };
      }),
      // 手动触发调度执行
      // @ts-ignore
      triggerSchedule: protectedProcedure.input(external_exports.object({ scheduleId: external_exports.number() })).mutation(async ({ ctx, input }) => {
        return executeScheduledSync(input.scheduleId);
      }),
      // 获取调度执行历史
      getScheduleHistory: protectedProcedure.input(external_exports.object({ scheduleId: external_exports.number(), limit: external_exports.number().default(20) })).query(async ({ ctx, input }) => {
        return getScheduleHistory(input.scheduleId, input.limit);
      }),
      // 获取调度详细执行历史
      getScheduleExecutionHistory: protectedProcedure.input(external_exports.object({ scheduleId: external_exports.number(), limit: external_exports.number().default(50) })).query(async ({ ctx, input }) => {
        return getScheduleExecutionHistory(input.scheduleId, input.limit);
      }),
      // 获取调度执行统计
      getScheduleExecutionStats: protectedProcedure.input(external_exports.object({ scheduleId: external_exports.number() })).query(async ({ ctx, input }) => {
        return getScheduleExecutionStats(input.scheduleId);
      }),
      // 手动触发调度执行（带重试）
      triggerScheduleWithRetry: protectedProcedure.input(external_exports.object({ scheduleId: external_exports.number() })).mutation(async ({ ctx, input }) => {
        return executeScheduledSyncWithRetry(input.scheduleId);
      })
    });
    reportJobsRouter = router({
      // 获取报告任务统计
      // v370.4: 多租户数据隔离 - 只统计当前用户的报告任务
      // @ts-ignore
      getStats: protectedProcedure.query(async ({ ctx }) => {
        try {
          const { getDb: getDb3 } = await Promise.resolve().then(() => (init_connection(), connection_exports));
          const { adAccounts: adAccounts3, reportJobs: reportJobs3 } = await Promise.resolve().then(() => (init_schema2(), schema_exports));
          const { eq: eq12, sql: sqlTag, inArray: inArray13 } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
          const dbInstance = await getDb3();
          if (!dbInstance) return { pending: 0, submitted: 0, processing: 0, completed: 0, failed: 0 };
          const userAccountRows = await dbInstance.select({ id: adAccounts3.id }).from(adAccounts3).where(eq12(adAccounts3.userId, ctx.user.id));
          const userAccountIds = userAccountRows.map((r) => r.id);
          if (userAccountIds.length === 0) return { pending: 0, submitted: 0, processing: 0, completed: 0, failed: 0 };
          const stats4 = await dbInstance.select({
            status: reportJobs3.status,
            count: sqlTag`count(*)`
          }).from(reportJobs3).where(sqlTag`${reportJobs3.accountId} IN (${sqlTag.raw(userAccountIds.join(","))})`).groupBy(reportJobs3.status);
          const result = { pending: 0, submitted: 0, processing: 0, completed: 0, failed: 0 };
          for (const stat of stats4) {
            if (stat.status && stat.status in result) result[stat.status] = Number(stat.count);
          }
          return result;
        } catch {
          return asyncReportService.getJobStats();
        }
      }),
      // 获取调度器状态
      getSchedulerStatus: protectedProcedure.query(async () => {
        return reportJobScheduler.getStatus();
      }),
      // 手动触发一次处理周期
      runOnce: protectedProcedure.mutation(async () => {
        return reportJobScheduler.runOnce();
      }),
      // 创建归因回溯任务
      createAttributionJobs: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        profileId: external_exports.string()
      })).mutation(async ({ ctx, input }) => {
        const jobIds = await asyncReportService.createAttributionJobs(input.accountId, input.profileId);
        return { success: true, jobCount: jobIds.length, jobIds };
      }),
      // 创建初始化任务（新店铺）
      createInitializationJobs: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        // @ts-ignore
        profileId: external_exports.string()
      })).mutation(async ({ ctx, input }) => {
        const jobIds = await asyncReportService.createInitializationJobs(input.accountId, input.profileId);
        return { success: true, jobCount: jobIds.length, jobIds };
      }),
      // 清理过期任务
      cleanupExpiredJobs: protectedProcedure.input(external_exports.object({ daysOld: external_exports.number().default(7) })).mutation(async ({ ctx, input }) => {
        const count11 = await asyncReportService.cleanupExpiredJobs(input.daysOld);
        return { success: true, deletedCount: count11 };
      }),
      // 开始账号初始化
      startInitialization: protectedProcedure.input(external_exports.object({ accountId: external_exports.number() })).mutation(async ({ ctx, input }) => {
        return accountInitializationService.startInitialization(input.accountId);
      }),
      // 获取初始化进度
      getInitializationProgress: protectedProcedure.input(external_exports.object({ accountId: external_exports.number() })).query(async ({ ctx, input }) => {
        return accountInitializationService.getInitializationProgress(input.accountId);
      }),
      // 重试失败的初始化
      retryFailedInitialization: protectedProcedure.input(external_exports.object({ accountId: external_exports.number() })).mutation(async ({ ctx, input }) => {
        return accountInitializationService.retryFailedInitialization(input.accountId);
      }),
      // 获取待初始化的账号列表
      // v370.4: 多租户数据隔离 - 只返回当前用户的账户
      // @ts-ignore
      getPendingInitializationAccounts: protectedProcedure.query(async ({ ctx }) => {
        const allPending = await accountInitializationService.getPendingInitializationAccounts();
        try {
          const { getDb: getDb3 } = await Promise.resolve().then(() => (init_connection(), connection_exports));
          const { adAccounts: adAccounts3 } = await Promise.resolve().then(() => (init_schema2(), schema_exports));
          const { eq: eq12 } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
          const dbInstance = await getDb3();
          if (!dbInstance) return allPending;
          const userAccountRows = await dbInstance.select({ id: adAccounts3.id }).from(adAccounts3).where(eq12(adAccounts3.userId, ctx.user.id));
          const userAccountIds = new Set(userAccountRows.map((r) => r.id));
          return allPending.filter((a) => userAccountIds.has(a.id));
        } catch {
          return [];
        }
      }),
      // 执行智能同步
      executeSmartSync: protectedProcedure.input(external_exports.object({ accountId: external_exports.number() })).mutation(async ({ ctx, input }) => {
        return smartSyncService.executeSmartSync(input.accountId);
      }),
      // 获取同步统计
      getSyncStats: protectedProcedure.input(external_exports.object({ accountId: external_exports.number() })).query(async ({ ctx, input }) => {
        return smartSyncService.getSyncStats(input.accountId);
      }),
      // 获取任务数量对比
      getTaskComparison: protectedProcedure.query(async () => {
        return smartSyncService.getTaskComparison();
      }),
      // ===== 智能分层同步（方案五） =====
      // 获取分层配置
      getTierConfig: protectedProcedure.query(async () => {
        return tieredSyncService.getTierConfig();
      }),
      // 计算各层任务数量
      calculateTieredTaskCounts: protectedProcedure.query(async () => {
        return tieredSyncService.calculateTaskCounts();
      }),
      // 创建分层初始化任务
      createTieredInitializationTasks: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        profileId: external_exports.string()
      })).mutation(async ({ ctx, input }) => {
        return tieredSyncService.createTieredInitializationTasks(input.accountId, input.profileId);
      }),
      // 获取分层初始化进度
      getTieredInitializationStats: protectedProcedure.input(external_exports.object({ accountId: external_exports.number() })).query(async ({ ctx, input }) => {
        return tieredSyncService.getInitializationStats(input.accountId);
      }),
      // 获取任务进度（断点续传支持）
      getTaskProgress: protectedProcedure.input(external_exports.object({ taskId: external_exports.number() })).query(async ({ ctx, input }) => {
        return tieredSyncService.getTaskProgress(input.taskId);
      }),
      // 重试失败的任务（增量重试）
      retryFailedTieredTasks: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        maxRetries: external_exports.number().default(3)
      })).mutation(async ({ ctx, input }) => {
        return tieredSyncService.retryFailedTasks(input.accountId, input.maxRetries);
      }),
      // 检查任务完成状态
      checkTaskCompletion: protectedProcedure.input(external_exports.object({ taskId: external_exports.number() })).query(async ({ ctx, input }) => {
        return tieredSyncService.checkTaskCompletion(input.taskId);
      })
    });
  }
});

