// Extracted from production dist/index.js
// Original module: server/routes/intelligentRecommendation.ts
// Lines: 75

var log196, intelligentRecommendationRouter;
var init_intelligentRecommendation = __esm({
  "server/routes/intelligentRecommendation.ts"() {
    "use strict";
    init_zod();
    init_trpc();
    init_intelligentRecommendationEngine();
    init_db2();
    init_logger();
    init_accessControl();
    log196 = createModuleLogger("Route_intelligentRecommendation");
    intelligentRecommendationRouter = router({
      scan: protectedProcedure.input(external_exports.object({ accountId: external_exports.number() })).query(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        return await scanAccountHealth(input.accountId);
      }),
      quickCreateGoal: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        name: external_exports.string(),
        description: external_exports.string().optional(),
        optimizationGoal: external_exports.string(),
        targetAcos: external_exports.number().optional(),
        targetRoas: external_exports.number().optional(),
        strategyTemplateId: external_exports.string().optional(),
        strategyTemplateName: external_exports.string().optional(),
        campaignIds: external_exports.array(external_exports.number())
      })).mutation(async ({ ctx, input }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        try {
          const id = await createPerformanceGroup({
            userId: ctx.user.id,
            accountId: input.accountId,
            name: input.name,
            description: input.description || "",
            // @ts-expect-error - type assertion
            optimizationGoal: input.optimizationGoal,
            targetAcos: input.targetAcos?.toString(),
            targetRoas: input.targetRoas?.toString(),
            strategyTemplateId: input.strategyTemplateId,
            strategyTemplateName: input.strategyTemplateName
          });
          if (input.campaignIds.length > 0) {
            await batchAssignCampaignsToPerformanceGroup(input.campaignIds, id);
          }
          try {
            const { triggerInitialOptimization: triggerInitialOptimization2 } = await Promise.resolve().then(() => (init_optimizationScheduler(), optimizationScheduler_exports));
            triggerInitialOptimization2(id, { triggeredBy: "create" }).catch((err) => {
              log196.warn(`[\u667A\u80FD\u63A8\u8350] \u89E6\u53D1\u9996\u6B21\u4F18\u5316\u5931\u8D25:`, err);
            });
          } catch (e) {
            log196.warn("[\u667A\u80FD\u63A8\u8350] \u5BFC\u5165optimizationScheduler\u5931\u8D25:", e);
          }
          log196.info(`[\u667A\u80FD\u63A8\u8350] \u6210\u529F\u521B\u5EFA\u4F18\u5316\u76EE\u6807 #${id}\uFF0C\u5305\u542B${input.campaignIds.length}\u4E2A\u5E7F\u544A\u6D3B\u52A8`);
          return { success: true, goalId: id, campaignCount: input.campaignIds.length };
        } catch (error48) {
          log196.warn("[\u667A\u80FD\u63A8\u8350] \u521B\u5EFA\u4F18\u5316\u76EE\u6807\u5931\u8D25:", error48);
          throw new Error(`\u521B\u5EFA\u4F18\u5316\u76EE\u6807\u5931\u8D25: ${error48.message}`);
        }
      }),
      getSummaryBadge: protectedProcedure.input(external_exports.object({ accountId: external_exports.number() })).query(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        const result = await scanAccountHealth(input.accountId);
        return {
          totalScanned: result.totalCampaignsScanned,
          deteriorating: result.deterioratingCampaigns,
          unmanaged: result.unmanagedDeteriorating,
          potentialSavings: result.totalPotentialSavings,
          hasRecommendations: result.recommendations.length > 0,
          criticalCount: result.recommendations.filter((r) => r.priority === "critical").length
        };
      })
    });
  }
});

