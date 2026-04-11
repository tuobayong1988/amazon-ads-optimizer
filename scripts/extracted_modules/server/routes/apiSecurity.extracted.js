// Extracted from production dist/index.js
// Original module: server/routes/apiSecurity.ts
// Lines: 107

var apiSecurityRouter;
var init_apiSecurity = __esm({
  "server/routes/apiSecurity.ts"() {
    "use strict";
    init_trpc();
    init_zod();
    init_apiSecurityService();
    apiSecurityRouter = router({
      // 操作日志
      getOperationLogs: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number().optional(),
        operationType: external_exports.enum(["bid_adjustment", "budget_change", "campaign_status", "keyword_status", "negative_keyword", "target_status", "batch_operation", "api_sync", "auto_optimization", "manual_operation", "other"]).optional(),
        status: external_exports.string().optional(),
        riskLevel: external_exports.enum(["low", "medium", "high", "critical"]).optional(),
        startDate: external_exports.string().optional(),
        endDate: external_exports.string().optional(),
        limit: external_exports.number().optional(),
        offset: external_exports.number().optional()
      })).query(async ({ ctx, input }) => {
        return getOperationLogs({
          userId: ctx.user.id,
          ...input
        });
      }),
      // 花费限额配置
      getSpendLimitConfig: protectedProcedure.input(external_exports.object({ accountId: external_exports.number() })).query(async ({ ctx, input }) => {
        return getSpendLimitConfig(ctx.user.id, input.accountId);
      }),
      upsertSpendLimitConfig: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        dailySpendLimit: external_exports.number(),
        warningThreshold1: external_exports.number().optional(),
        warningThreshold2: external_exports.number().optional(),
        criticalThreshold: external_exports.number().optional(),
        autoStopEnabled: external_exports.boolean().optional(),
        autoStopThreshold: external_exports.number().optional()
      })).mutation(async ({ ctx, input }) => {
        const configId = await upsertSpendLimitConfig({
          userId: ctx.user.id,
          ...input
        });
        return { configId };
      }),
      // 花费告警历史
      getSpendAlertHistory: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number().optional(),
        limit: external_exports.number().optional()
      })).query(async ({ ctx, input }) => {
        return getSpendAlertHistory(
          ctx.user.id,
          input.accountId,
          input.limit
        );
      }),
      // 异常检测规则
      getAnomalyRules: protectedProcedure.input(external_exports.object({ accountId: external_exports.number().optional() })).query(async ({ ctx, input }) => {
        return getAnomalyRules(ctx.user.id, input.accountId);
      }),
      createAnomalyRule: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number().optional(),
        ruleName: external_exports.string(),
        ruleDescription: external_exports.string().optional(),
        ruleType: external_exports.enum(["bid_spike", "bid_drop", "batch_size", "frequency", "budget_change", "spend_velocity", "conversion_drop", "acos_spike", "custom"]),
        conditionType: external_exports.enum(["threshold", "percentage_change", "absolute_change", "rate_limit"]),
        conditionValue: external_exports.number(),
        conditionTimeWindow: external_exports.number().optional(),
        actionOnTrigger: external_exports.enum(["alert_only", "pause_and_alert", "rollback_and_alert", "block_operation"]).optional(),
        priority: external_exports.number().optional()
      })).mutation(async ({ ctx, input }) => {
        const ruleId = await createAnomalyRule({
          userId: ctx.user.id,
          ...input
        });
        return { ruleId };
      }),
      // 初始化默认规则
      initializeDefaultRules: protectedProcedure.mutation(async ({ ctx }) => {
        await initializeDefaultRules(ctx.user.id);
        return { success: true };
      }),
      // 自动暂停记录
      getAutoPauseRecords: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number().optional(),
        includeResumed: external_exports.boolean().optional()
      })).query(async ({ ctx, input }) => {
        return getAutoPauseRecords(
          ctx.user.id,
          input.accountId,
          input.includeResumed
        );
      }),
      // 恢复暂停的实体
      resumePausedEntities: protectedProcedure.input(external_exports.object({
        recordId: external_exports.number(),
        resumeReason: external_exports.string()
      })).mutation(async ({ ctx, input }) => {
        const success2 = await resumePausedEntities(
          input.recordId,
          ctx.user.id,
          input.resumeReason
        );
        return { success: success2 };
      })
    });
  }
});

