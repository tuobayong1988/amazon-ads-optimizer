// Extracted from production dist/index.js
// Original module: server/routes/automation.ts
// Lines: 210

var automationRouter, autoOperationRouter;
var init_automation = __esm({
  "server/routes/automation.ts"() {
    "use strict";
    init_trpc();
    init_zod();
    init_automationExecutionEngine();
    init_autoOperationService();
    init_accessControl();
    automationRouter = router({
      // 获取账号自动化配置
      getConfig: protectedProcedure.input(external_exports.object({ accountId: external_exports.number() })).query(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        return getAccountAutomationConfig(input.accountId);
      }),
      // 更新账号自动化配置
      updateConfig: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        enabled: external_exports.boolean().optional(),
        mode: external_exports.enum(["full_auto", "supervised", "approval", "disabled"]).optional(),
        enabledTypes: external_exports.array(external_exports.enum([
          "bid_adjustment",
          "budget_adjustment",
          "placement_tilt",
          "negative_keyword",
          "dayparting",
          "funnel_migration",
          "traffic_isolation",
          "auto_rollback"
        ])).optional(),
        safetyBoundary: external_exports.object({
          maxBidChangePercent: external_exports.number().optional(),
          maxBudgetChangePercent: external_exports.number().optional(),
          maxPlacementChangePercent: external_exports.number().optional(),
          maxDailyBidAdjustments: external_exports.number().optional(),
          maxDailyBudgetAdjustments: external_exports.number().optional(),
          maxDailyTotalAdjustments: external_exports.number().optional(),
          autoExecuteConfidence: external_exports.number().optional(),
          supervisedConfidence: external_exports.number().optional()
        }).optional()
        // @ts-ignore
      })).mutation(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        return updateAccountAutomationConfig(input.accountId, {
          enabled: input.enabled,
          mode: input.mode,
          enabledTypes: input.enabledTypes,
          // @ts-expect-error - type assertion
          safetyBoundary: input.safetyBoundary
        });
      }),
      // 运行完整自动化周期
      // @ts-ignore
      runFullCycle: protectedProcedure.input(external_exports.object({ accountId: external_exports.number() })).mutation(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        return runFullAutomationCycle(input.accountId);
      }),
      // 获取执行历史
      getExecutionHistory: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        limit: external_exports.number().optional(),
        // @ts-ignore
        startDate: external_exports.date().optional(),
        endDate: external_exports.date().optional()
      })).query(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        return getExecutionHistory2(input.accountId, {
          limit: input.limit,
          startDate: input.startDate,
          endDate: input.endDate
        });
      }),
      // 获取每日执行统计
      getDailyStats: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        date: external_exports.date().optional()
      })).query(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        return getDailyExecutionStats(input.accountId, input.date);
      }),
      // 紧急停止
      // @ts-ignore
      emergencyStop: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        reason: external_exports.string()
      })).mutation(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        emergencyStop(input.accountId, input.reason);
        return { success: true };
      }),
      // 恢复自动化
      resume: protectedProcedure.input(external_exports.object({ accountId: external_exports.number() })).mutation(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        resumeAutomation(input.accountId);
        return { success: true };
      }),
      // 执行单个优化
      executeOptimization: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        type: external_exports.enum([
          "bid_adjustment",
          "budget_adjustment",
          "placement_tilt",
          "negative_keyword",
          "dayparting",
          "funnel_migration",
          "traffic_isolation",
          "auto_rollback"
        ]),
        targetType: external_exports.enum(["keyword", "campaign", "ad_group", "placement"]),
        // @ts-ignore
        targetId: external_exports.number(),
        targetName: external_exports.string(),
        currentValue: external_exports.number(),
        newValue: external_exports.number(),
        confidence: external_exports.number(),
        reason: external_exports.string()
      })).mutation(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        return executeOptimization(
          input.accountId,
          input.type,
          input.targetType,
          input.targetId,
          input.targetName,
          input.currentValue,
          input.newValue,
          input.confidence,
          input.reason
        );
      }),
      // 批量执行优化
      batchExecute: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        optimizations: external_exports.array(external_exports.object({
          type: external_exports.enum([
            "bid_adjustment",
            "budget_adjustment",
            "placement_tilt",
            "negative_keyword",
            "dayparting",
            "funnel_migration",
            "traffic_isolation",
            "auto_rollback"
          ]),
          targetType: external_exports.enum(["keyword", "campaign", "ad_group", "placement"]),
          // @ts-ignore
          targetId: external_exports.number(),
          targetName: external_exports.string(),
          currentValue: external_exports.number(),
          newValue: external_exports.number(),
          confidence: external_exports.number(),
          reason: external_exports.string()
        }))
      })).mutation(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        return batchExecuteOptimizations(
          input.accountId,
          input.optimizations
        );
      })
    });
    autoOperationRouter = router({
      // 获取账号自动运营配置
      getConfig: protectedProcedure.input(external_exports.object({ accountId: external_exports.number() })).query(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        return autoOperationService.getConfig(input.accountId);
      }),
      // 创建或更新自动运营配置
      upsertConfig: protectedProcedure.input(external_exports.object({
        // @ts-ignore
        accountId: external_exports.number(),
        enabled: external_exports.boolean().optional(),
        intervalHours: external_exports.number().optional(),
        enableDataSync: external_exports.boolean().optional(),
        enableNgramAnalysis: external_exports.boolean().optional(),
        enableFunnelSync: external_exports.boolean().optional(),
        enableConflictDetection: external_exports.boolean().optional(),
        enableMigrationSuggestion: external_exports.boolean().optional(),
        // @ts-ignore
        enableBidOptimization: external_exports.boolean().optional()
      })).mutation(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        return autoOperationService.upsertConfig(input);
      }),
      // 执行完整的自动运营流程
      executeFullOperation: protectedProcedure.input(external_exports.object({ accountId: external_exports.number() })).mutation(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        return autoOperationService.executeFullOperation(input.accountId);
      }),
      // 获取运营日志
      getLogs: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        limit: external_exports.number().optional()
      })).query(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        return autoOperationService.getLogs(input.accountId, input.limit);
      }),
      // 获取所有配置
      getAllConfigs: protectedProcedure.query(async () => {
        return autoOperationService.getAllConfigs();
      }),
      // 执行所有到期的自动运营任务
      executeAllDueTasks: protectedProcedure.mutation(async () => {
        return autoOperationService.executeAllDueTasks();
      })
    });
  }
});

