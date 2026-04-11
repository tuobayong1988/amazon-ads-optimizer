// Extracted from production dist/index.js
// Original module: server/routes/guardrailConfig.ts
// Lines: 120

var log200, overrideSchema, guardrailConfigRouter;
var init_guardrailConfig = __esm({
  "server/routes/guardrailConfig.ts"() {
    "use strict";
    init_zod();
    init_trpc();
    init_logger();
    log200 = createModuleLogger("GuardrailConfigAPI");
    overrideSchema = external_exports.object({
      bid: external_exports.object({
        maxSingleChangePercent: external_exports.number().min(0.05).max(0.5).optional(),
        maxDailyChangePercent: external_exports.number().min(0.1).max(0.6).optional(),
        minBid: external_exports.number().min(0.01).max(0.1).optional(),
        maxBid: external_exports.number().min(50).max(500).optional(),
        consecutiveSameDirectionSlowdown: external_exports.number().min(2).max(7).optional(),
        slowdownFactor: external_exports.number().min(0.3).max(0.8).optional()
      }).optional(),
      budget: external_exports.object({
        maxSingleChangePercent: external_exports.number().min(0.1).max(0.5).optional(),
        maxDailyChangePercent: external_exports.number().min(0.15).max(0.7).optional(),
        minDailyBudget: external_exports.number().min(0.5).max(5).optional(),
        maxDailyBudget: external_exports.number().min(1e4).max(1e5).optional()
      }).optional(),
      placement: external_exports.object({
        maxSingleChangePct: external_exports.number().min(10).max(50).optional(),
        maxTotalAdjustment: external_exports.number().min(100).max(900).optional(),
        minTotalAdjustment: external_exports.number().min(-80).max(0).optional()
      }).optional(),
      emergency: external_exports.object({
        salesDropThreshold: external_exports.number().min(0.2).max(0.7).optional(),
        spendSurgeThreshold: external_exports.number().min(1.5).max(5).optional(),
        ordersDropThreshold: external_exports.number().min(0.25).max(0.8).optional(),
        lookbackDays: external_exports.number().min(1).max(14).optional()
      }).optional()
    });
    guardrailConfigRouter = router({
      /**
       * 获取有效护栏配置（合并后的最终值）
       */
      getEffective: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number().optional(),
        adType: external_exports.enum(["sp", "sb", "sd", "default"]).optional()
      }).optional()).query(async ({ ctx, input }) => {
        try {
          const { getGuardrailConfigService: getGuardrailConfigService2 } = await Promise.resolve().then(() => (init_guardrailConfigService(), guardrailConfigService_exports));
          const service = getGuardrailConfigService2();
          const config2 = service.getEffectiveConfig(input?.accountId, input?.adType);
          return { success: true, error: null, config: config2 };
        } catch (e) {
          return { success: false, error: e.message, config: null };
        }
      }),
      /**
       * 获取所有配置覆盖
       */
      getAllOverrides: protectedProcedure.query(async () => {
        try {
          const { getGuardrailConfigService: getGuardrailConfigService2 } = await Promise.resolve().then(() => (init_guardrailConfigService(), guardrailConfigService_exports));
          const service = getGuardrailConfigService2();
          return { success: true, error: null, overrides: service.getAllOverrides() };
        } catch (e) {
          return { success: false, error: e.message, overrides: [] };
        }
      }),
      /**
       * 获取硬编界限
       */
      getHardLimits: protectedProcedure.query(async () => {
        try {
          const { getGuardrailConfigService: getGuardrailConfigService2 } = await Promise.resolve().then(() => (init_guardrailConfigService(), guardrailConfigService_exports));
          const service = getGuardrailConfigService2();
          return { success: true, error: null, limits: service.getHardLimits() };
        } catch (e) {
          return { success: false, error: e.message, limits: null };
        }
      }),
      /**
       * 设置配置覆盖
       */
      setOverride: protectedProcedure.input(external_exports.object({
        scope: external_exports.enum(["global", "adType", "account"]),
        scopeKey: external_exports.string(),
        overrides: overrideSchema
        // @ts-ignore
      })).mutation(async ({ input, ctx }) => {
        try {
          const { getGuardrailConfigService: getGuardrailConfigService2 } = await Promise.resolve().then(() => (init_guardrailConfigService(), guardrailConfigService_exports));
          const service = getGuardrailConfigService2();
          const result = service.setConfigOverride(
            input.scope,
            input.scopeKey,
            input.overrides,
            ctx.user?.email || "unknown"
          );
          return { success: result.success, errors: result.errors };
        } catch (e) {
          return { success: false, errors: [e.message] };
        }
      }),
      /**
       * 删除配置覆盖
       */
      removeOverride: protectedProcedure.input(external_exports.object({
        scope: external_exports.enum(["global", "adType", "account"]),
        // @ts-ignore
        scopeKey: external_exports.string()
      })).mutation(async ({ ctx, input }) => {
        try {
          const { getGuardrailConfigService: getGuardrailConfigService2 } = await Promise.resolve().then(() => (init_guardrailConfigService(), guardrailConfigService_exports));
          const service = getGuardrailConfigService2();
          const removed = service.removeConfigOverride(input.scope, input.scopeKey);
          return { success: true, removed };
        } catch (e) {
          return { success: false, removed: false, error: e.message };
        }
      })
    });
  }
});

