// Extracted from production dist/index.js
// Original module: server/routes/specialScenario.ts
// Lines: 135

var specialScenarioRouter;
var init_specialScenario = __esm({
  "server/routes/specialScenario.ts"() {
    "use strict";
    init_trpc();
    init_zod();
    init_specialScenarioOptimizationService();
    init_accessControl();
    init_apiCacheService();
    specialScenarioRouter = router({
      // 预算耗尽风险分析
      analyzeBudgetDepletionRisk: protectedProcedure.input(external_exports.object({ accountId: external_exports.number() })).query(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        return analyzeBudgetDepletionRisk(input.accountId);
      }),
      // 单个广告活动预算耗尽预测
      predictBudgetDepletion: protectedProcedure.input(external_exports.object({
        campaignId: external_exports.number(),
        currentSpend: external_exports.number(),
        dailyBudget: external_exports.number(),
        currentHour: external_exports.number().optional()
        // @ts-ignore
      })).query(async ({ ctx, input }) => {
        return predictBudgetDepletion(
          input.campaignId,
          input.currentSpend,
          input.dailyBudget,
          input.currentHour
        );
      }),
      // v386: 归因延迟调整后的近期数据（添加API缓存）
      getAttributionAdjustedData: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        // @ts-ignore
        days: external_exports.number().optional()
      })).query(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        const cacheKey = apiCache.generateKey("specialScenario.getAttributionAdjustedData", ctx.user.id, input);
        const cached2 = apiCache.get(cacheKey);
        if (cached2) return cached2;
        const result = await adjustRecentPerformanceData(
          input.accountId,
          input.days || 7
        );
        apiCache.set(cacheKey, result, 5 * 60 * 1e3);
        return result;
      }),
      // 获取归因模型
      getAttributionModel: protectedProcedure.input(external_exports.object({ accountId: external_exports.number() })).query(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        return getAttributionModel(input.accountId);
      }),
      // 竞价效率分析
      analyzeBidEfficiency: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        // @ts-ignore
        targetAcos: external_exports.number().optional(),
        profitMargin: external_exports.number().optional(),
        minClicks: external_exports.number().optional()
      })).query(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        return analyzeBidEfficiency(
          input.accountId,
          input.targetAcos,
          input.profitMargin,
          input.minClicks
        );
      }),
      // 季节性调整策略
      // @ts-ignore
      getSeasonalStrategy: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        targetDate: external_exports.string().optional()
      })).query(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        const date6 = input.targetDate ? new Date(input.targetDate) : /* @__PURE__ */ new Date();
        return generateSeasonalStrategy(
          input.accountId,
          date6
        );
      }),
      // 学习季节性模式
      learnSeasonalPatterns: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        metric: external_exports.enum(["sales", "roas", "spend"]).optional()
      })).query(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        return learnSeasonalPatterns(
          input.accountId,
          input.metric
        );
      }),
      // 大促渐进式调整计划
      // @ts-ignore
      getEventTransitionPlan: protectedProcedure.input(external_exports.object({
        eventName: external_exports.string(),
        eventDate: external_exports.string(),
        baseBudget: external_exports.number(),
        baseBid: external_exports.number()
      })).query(async ({ ctx, input }) => {
        return generateEventTransitionPlan(
          input.eventName,
          new Date(input.eventDate),
          // @ts-ignore
          input.baseBudget,
          input.baseBid
        );
      }),
      // 获取即将到来的大促事件
      getUpcomingEvents: protectedProcedure.input(external_exports.object({ daysAhead: external_exports.number().optional() })).query(async ({ ctx, input }) => {
        return getUpcomingPromotionalEvents(
          input.daysAhead || 30
        );
      }),
      // 综合特殊场景分析
      runFullAnalysis: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        targetAcos: external_exports.number().optional(),
        profitMargin: external_exports.number().optional(),
        minClicks: external_exports.number().optional()
      })).query(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        return runSpecialScenarioAnalysis(
          input.accountId,
          {
            targetAcos: input.targetAcos,
            profitMargin: input.profitMargin,
            minClicks: input.minClicks
          }
        );
      })
    });
  }
});

