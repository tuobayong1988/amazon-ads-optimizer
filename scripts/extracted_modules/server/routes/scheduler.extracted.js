// Extracted from production dist/index.js
// Original module: server/routes/scheduler.ts
// Lines: 188

var schedulerRouter;
var init_scheduler = __esm({
  "server/routes/scheduler.ts"() {
    "use strict";
    init_trpc();
    init_zod();
    init_dist();
    init_db2();
    init_schedulerService();
    schedulerRouter = router({
      // Get scheduled tasks
      getTasks: protectedProcedure.query(async ({ ctx }) => {
        return getScheduledTasksByUserId(ctx.user.id);
      }),
      // Create scheduled task
      createTask: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number().optional(),
        taskType: external_exports.enum(["ngram_analysis", "funnel_migration", "traffic_conflict", "smart_bidding", "health_check", "data_sync", "traffic_isolation_full"]),
        name: external_exports.string(),
        description: external_exports.string().optional(),
        schedule: external_exports.enum(["hourly", "daily", "weekly", "monthly"]).optional().default("daily"),
        runTime: external_exports.string().optional().default("06:00"),
        dayOfWeek: external_exports.number().min(0).max(6).optional(),
        dayOfMonth: external_exports.number().min(1).max(31).optional(),
        enabled: external_exports.boolean().optional().default(true),
        autoApply: external_exports.boolean().optional().default(false),
        requireApproval: external_exports.boolean().optional().default(true),
        parameters: external_exports.record(external_exports.string(), external_exports.unknown()).optional()
      })).mutation(async ({ ctx, input }) => {
        const id = await createScheduledTask({
          userId: ctx.user.id,
          accountId: input.accountId,
          taskType: input.taskType,
          name: input.name,
          description: input.description,
          schedule: input.schedule,
          runTime: input.runTime,
          dayOfWeek: input.dayOfWeek,
          dayOfMonth: input.dayOfMonth,
          enabled: input.enabled,
          autoApply: input.autoApply,
          requireApproval: input.requireApproval,
          parameters: input.parameters
        });
        return { id };
      }),
      // v370.4: 数据隔离 - Update scheduled task
      updateTask: protectedProcedure.input(external_exports.object({
        id: external_exports.number(),
        name: external_exports.string().optional(),
        description: external_exports.string().optional(),
        schedule: external_exports.enum(["hourly", "daily", "weekly", "monthly"]).optional(),
        runTime: external_exports.string().optional(),
        dayOfWeek: external_exports.number().min(0).max(6).optional(),
        dayOfMonth: external_exports.number().min(1).max(31).optional(),
        enabled: external_exports.boolean().optional(),
        autoApply: external_exports.boolean().optional(),
        requireApproval: external_exports.boolean().optional(),
        parameters: external_exports.record(external_exports.string(), external_exports.unknown()).optional()
        // @ts-ignore
      })).mutation(async ({ ctx, input }) => {
        const { verifyScheduledTaskAccess: verifyScheduledTaskAccess2 } = await Promise.resolve().then(() => (init_accessControl(), accessControl_exports));
        await verifyScheduledTaskAccess2(ctx.user.id, input.id);
        await updateScheduledTask(input.id, {
          name: input.name,
          description: input.description,
          schedule: input.schedule,
          runTime: input.runTime,
          dayOfWeek: input.dayOfWeek,
          dayOfMonth: input.dayOfMonth,
          enabled: input.enabled,
          autoApply: input.autoApply,
          requireApproval: input.requireApproval,
          parameters: input.parameters
        });
        return { success: true };
      }),
      // v370.4: 数据隔离 - Delete scheduled task
      // @ts-ignore
      deleteTask: protectedProcedure.input(external_exports.object({ id: external_exports.number() })).mutation(async ({ ctx, input }) => {
        const { verifyScheduledTaskAccess: verifyScheduledTaskAccess2 } = await Promise.resolve().then(() => (init_accessControl(), accessControl_exports));
        await verifyScheduledTaskAccess2(ctx.user.id, input.id);
        await deleteScheduledTask(input.id);
        return { success: true };
      }),
      // v370.4: 数据隔离 - Run task manually
      runTask: protectedProcedure.input(external_exports.object({
        id: external_exports.number(),
        autoApply: external_exports.boolean().optional().default(false)
      })).mutation(async ({ ctx, input }) => {
        const { verifyScheduledTaskAccess: verifyScheduledTaskAccess2 } = await Promise.resolve().then(() => (init_accessControl(), accessControl_exports));
        await verifyScheduledTaskAccess2(ctx.user.id, input.id);
        const task = await getScheduledTaskById(input.id);
        if (!task) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Task not found"
          });
        }
        let result;
        const accountId = task.accountId || 1;
        switch (task.taskType) {
          case "ngram_analysis":
            const searchTerms8 = await getSearchTermsForAnalysis(accountId);
            result = await executeNgramAnalysis(
              searchTerms8.map((t2) => ({
                searchTerm: t2.searchTerm,
                clicks: t2.clicks,
                conversions: t2.conversions,
                spend: t2.spend,
                sales: t2.sales,
                impressions: t2.impressions || 0
              })),
              input.autoApply
            );
            break;
          case "health_check":
            const healthData = await getCampaignHealthMetrics(accountId);
            result = await executeHealthCheck(
              healthData.map((h) => ({
                campaignId: h.campaignId,
                campaignName: h.campaignName,
                currentAcos: h.currentMetrics.acos,
                previousAcos: h.historicalAverage.acos,
                currentCtr: h.currentMetrics.ctr,
                previousCtr: h.historicalAverage.ctr,
                currentConversionRate: h.currentMetrics.cvr,
                previousConversionRate: h.historicalAverage.cvr,
                currentSpend: h.currentMetrics.spend,
                previousSpend: h.historicalAverage.spend
              }))
            );
            break;
          case "traffic_isolation_full":
            result = await executeTrafficIsolationFull(
              accountId,
              {
                mode: input.autoApply ? "full_auto" : "supervised",
                enabledTypes: [
                  "ngram_analysis",
                  "funnel_negative_sync",
                  "keyword_migration",
                  "traffic_conflict_resolution"
                ]
              }
            );
            break;
          default:
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Task type ${task.taskType} is not yet implemented`
            });
        }
        await recordTaskExecution({
          taskId: task.id,
          userId: ctx.user.id,
          accountId: task.accountId || void 0,
          taskType: task.taskType,
          status: result.status,
          startedAt: result.startedAt,
          completedAt: result.completedAt,
          duration: result.duration,
          itemsProcessed: result.itemsProcessed,
          suggestionsGenerated: result.suggestionsGenerated,
          suggestionsApplied: result.suggestionsApplied,
          errorMessage: result.errorMessage,
          resultSummary: result.resultSummary
        });
        return result;
      }),
      // v370.4: 数据隔离 - Get task execution history
      getExecutionHistory: protectedProcedure.input(external_exports.object({
        // @ts-ignore
        taskId: external_exports.number(),
        limit: external_exports.number().optional().default(20)
      })).query(async ({ ctx, input }) => {
        const { verifyScheduledTaskAccess: verifyScheduledTaskAccess2 } = await Promise.resolve().then(() => (init_accessControl(), accessControl_exports));
        await verifyScheduledTaskAccess2(ctx.user.id, input.taskId);
        return getTaskExecutionHistory(input.taskId, input.limit);
      }),
      // Get default task configurations
      getDefaultConfigs: protectedProcedure.query(async () => {
        return defaultTaskConfigs;
      })
    });
  }
});

