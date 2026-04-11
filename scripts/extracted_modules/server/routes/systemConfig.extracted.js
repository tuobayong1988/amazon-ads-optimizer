// Extracted from production dist/index.js
// Original module: server/routes/systemConfig.ts
// Lines: 108

var systemConfigRouter;
var init_systemConfig = __esm({
  "server/routes/systemConfig.ts"() {
    "use strict";
    init_zod();
    init_trpc();
    systemConfigRouter = router({
      /**
       * 获取所有系统配置参数
       */
      getAllConfig: protectedProcedure.query(async () => {
        const { getAllConfig: getAllConfig2 } = await Promise.resolve().then(() => (init_systemConfigService(), systemConfigService_exports));
        return { success: true, config: getAllConfig2() };
      }),
      /**
       * 按分类获取配置参数
       */
      getConfigByCategory: protectedProcedure.input(external_exports.object({ category: external_exports.string() })).query(async ({ ctx, input }) => {
        const { getAllConfig: getAllConfig2 } = await Promise.resolve().then(() => (init_systemConfigService(), systemConfigService_exports));
        return { success: true, config: getAllConfig2(input.category) };
      }),
      /**
       * 更新单个配置参数
       */
      updateConfig: protectedProcedure.input(external_exports.object({
        key: external_exports.string(),
        value: external_exports.union([external_exports.number(), external_exports.string(), external_exports.boolean()]),
        reason: external_exports.string().optional()
      })).mutation(async ({ ctx, input }) => {
        const { updateConfig: updateConfig2 } = await Promise.resolve().then(() => (init_systemConfigService(), systemConfigService_exports));
        const success2 = updateConfig2(
          input.key,
          input.value,
          ctx.user.name || "unknown",
          input.reason || ""
        );
        return { success: success2 };
      }),
      /**
       * 获取配置变更历史
       */
      getChangeHistory: protectedProcedure.input(external_exports.object({ limit: external_exports.number().optional() })).query(async ({ ctx, input }) => {
        const { getChangeLog: getChangeLog2 } = await Promise.resolve().then(() => (init_systemConfigService(), systemConfigService_exports));
        return { success: true, history: getChangeLog2(input.limit || 50) };
      }),
      /**
       * 获取算法决策仪表板指标
       */
      // @ts-ignore
      getAlgorithmDashboard: protectedProcedure.input(external_exports.object({ period: external_exports.enum(["1h", "24h", "7d"]).optional() })).query(async ({ ctx, input }) => {
        const { generateDashboardMetrics: generateDashboardMetrics2 } = await Promise.resolve().then(() => (init_algorithmObservabilityService(), algorithmObservabilityService_exports));
        return { success: true, metrics: generateDashboardMetrics2(input.period || "24h") };
      }),
      /**
       * 获取最近的算法决策追踪
       */
      getRecentDecisions: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number().optional(),
        // @ts-ignore
        algorithm: external_exports.string().optional(),
        limit: external_exports.number().optional()
      })).query(async ({ ctx, input }) => {
        const { getRecentDecisionTraces: getRecentDecisionTraces2 } = await Promise.resolve().then(() => (init_algorithmObservabilityService(), algorithmObservabilityService_exports));
        return {
          success: true,
          traces: getRecentDecisionTraces2(input.limit || 50, { accountId: input.accountId, algorithm: input.algorithm })
        };
      }),
      /**
       * 获取通用可观测性指标
       */
      getMetrics: protectedProcedure.input(external_exports.object({
        type: external_exports.string().optional(),
        limit: external_exports.number().optional()
      })).query(async ({ ctx, input }) => {
        const { getMetrics: getMetrics2 } = await Promise.resolve().then(() => (init_algorithmObservabilityService(), algorithmObservabilityService_exports));
        return { success: true, metrics: getMetrics2(input.type, input.limit || 100) };
      }),
      /**
       * 获取权重自学习状态
       */
      getWeightTuningStatus: protectedProcedure.input(external_exports.object({ strategyTemplateId: external_exports.string().optional() })).query(async ({ ctx, input }) => {
        const { getTuningHistory: getTuningHistory2, getEffectiveWeights: getEffectiveWeights2 } = await Promise.resolve().then(() => (init_weightAutoTuningService(), weightAutoTuningService_exports));
        const history = getTuningHistory2(input.strategyTemplateId);
        const defaultWeights = {
          coreMetric: 20,
          trend: 16,
          budgetEfficiency: 11,
          conversionEfficiency: 15,
          gradualProgress: 18,
          algorithmEfficacy: 8,
          profitHealth: 12
        };
        const effectiveWeights = input.strategyTemplateId ? getEffectiveWeights2(input.strategyTemplateId, defaultWeights) : defaultWeights;
        return { success: true, history, effectiveWeights };
      }),
      /**
       * 回滚权重到上一版本
       */
      rollbackWeights: protectedProcedure.input(external_exports.object({ strategyTemplateId: external_exports.string() })).mutation(async ({ ctx, input }) => {
        const { rollbackWeights: rollbackWeights2 } = await Promise.resolve().then(() => (init_weightAutoTuningService(), weightAutoTuningService_exports));
        const success2 = rollbackWeights2(input.strategyTemplateId);
        return { success: success2 };
      })
    });
  }
});

