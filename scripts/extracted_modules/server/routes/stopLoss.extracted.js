// Extracted from production dist/index.js
// Original module: server/routes/stopLoss.ts
// Lines: 72

var stopLossRouter;
var init_stopLoss = __esm({
  "server/routes/stopLoss.ts"() {
    "use strict";
    init_zod();
    init_trpc();
    init_autoStopLossService();
    stopLossRouter = router({
      /** 获取当前止血配置 */
      getConfig: protectedProcedure.query(() => {
        return getStopLossConfig();
      }),
      /** 更新止血配置 */
      updateConfig: protectedProcedure.input(external_exports.object({
        campaignAutoPause: external_exports.object({
          consecutiveDays: external_exports.number().min(3).max(30).optional(),
          acosThreshold: external_exports.number().min(50).max(500).optional(),
          minSpendThreshold: external_exports.number().min(5).max(500).optional(),
          minClicksThreshold: external_exports.number().min(5).max(100).optional(),
          historicalOrderThreshold: external_exports.number().min(1).max(100).optional()
        }).optional(),
        searchTermAutoNegate: external_exports.object({
          zeroConversionSpendThreshold: external_exports.number().min(5).max(100).optional(),
          highAcosThreshold: external_exports.number().min(100).max(1e3).optional(),
          highAcosSpendThreshold: external_exports.number().min(10).max(200).optional(),
          competitorBrands: external_exports.array(external_exports.string()).optional(),
          irrelevantCategories: external_exports.array(external_exports.string()).optional()
        }).optional(),
        reactivationGuard: external_exports.object({
          checkWindowHours: external_exports.number().min(1).max(72).optional(),
          batchReactivationThreshold: external_exports.number().min(2).max(50).optional(),
          autoRollbackEnabled: external_exports.boolean().optional(),
          historicalAcosThreshold: external_exports.number().min(50).max(300).optional()
        }).optional(),
        dataCliffRepair: external_exports.object({
          historicalOrderThreshold: external_exports.number().min(1).max(50).optional(),
          trafficDropThreshold: external_exports.number().min(20).max(90).optional(),
          maxBidIncreasePercent: external_exports.number().min(5).max(50).optional()
        }).optional()
      })).mutation(({ input }) => {
        updateStopLossConfig(input);
        return { success: true, config: getStopLossConfig() };
      }),
      /** 手动触发全量止血扫描 */
      triggerFullScan: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number()
      })).mutation(async ({ input }) => {
        const result = await executeFullStopLossScan(input.accountId);
        return result;
      }),
      /** 手动触发单项扫描 */
      triggerSingleScan: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        scanType: external_exports.enum(["campaign_pause", "search_term_negate", "reactivation_guard", "data_cliff_repair"])
      })).mutation(async ({ input }) => {
        switch (input.scanType) {
          case "campaign_pause":
            return { actions: await scanAndPauseHighAcosCampaigns(input.accountId) };
          case "search_term_negate":
            return { actions: await scanAndNegateSearchTerms(input.accountId) };
          case "reactivation_guard":
            return { actions: await scanReactivatedCampaigns(input.accountId) };
          case "data_cliff_repair":
            return { actions: await scanAndRepairDataCliffs(input.accountId) };
          default:
            throw new Error(`Unknown scan type: ${input.scanType}`);
        }
      })
    });
  }
});

