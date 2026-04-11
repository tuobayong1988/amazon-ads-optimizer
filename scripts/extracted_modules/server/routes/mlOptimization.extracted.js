// Extracted from production dist/index.js
// Original module: server/routes/mlOptimization.ts
// Lines: 264

function toNum(val) {
  if (val === null || val === void 0) return 0;
  if (typeof val === "number") return val;
  const n = parseFloat(val);
  return isNaN(n) ? 0 : n;
}
function toHistoricalData(record2) {
  return {
    date: record2.date || "",
    bid: toNum(record2.cpc),
    spend: toNum(record2.spend),
    sales: toNum(record2.sales),
    impressions: record2.impressions || 0,
    clicks: record2.clicks || 0,
    conversions: record2.conversions || 0,
    acos: toNum(record2.dailyAcos),
    roas: toNum(record2.dailyRoas)
  };
}
var optimizationTargetSchema, mlOptimizationRouter;
var init_mlOptimization = __esm({
  "server/routes/mlOptimization.ts"() {
    "use strict";
    init_zod();
    init_trpc();
    init_bidOptimizer2();
    init_db2();
    optimizationTargetSchema = external_exports.object({
      type: external_exports.enum(["maximize_sales", "target_acos", "target_roas"]),
      targetValue: external_exports.number().optional(),
      maxBudget: external_exports.number().optional()
    });
    __name(toNum, "toNum");
    __name(toHistoricalData, "toHistoricalData");
    mlOptimizationRouter = router({
      /**
       * 获取出价推荐
       */
      getBidRecommendation: protectedProcedure.input(
        external_exports.object({
          campaignId: external_exports.string(),
          target: optimizationTargetSchema,
          daysOfHistory: external_exports.number().default(30)
        })
      ).mutation(async ({ ctx, input }) => {
        const { campaignId, target, daysOfHistory } = input;
        const campaign = await getCampaignById(parseInt(campaignId, 10));
        if (!campaign) {
          throw new Error("Campaign not found");
        }
        const cutoffDate = /* @__PURE__ */ new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysOfHistory);
        const endDate = /* @__PURE__ */ new Date();
        const historicalRecords = await getDailyPerformanceByDateRange(
          campaign.accountId,
          cutoffDate,
          endDate,
          campaign.id
        );
        if (historicalRecords.length < 10) {
          throw new Error(
            `Insufficient historical data. Found ${historicalRecords.length} records, need at least 10.`
          );
        }
        const historicalData = historicalRecords.map(toHistoricalData);
        const optimizer = new BidOptimizer();
        optimizer.train(historicalData);
        const recentData = historicalData.slice(0, 7);
        const currentBid = recentData.reduce((sum2, d) => sum2 + d.bid, 0) / recentData.length;
        const avgImpressions = recentData.reduce((sum2, d) => sum2 + d.impressions, 0) / recentData.length;
        const avgClicks = recentData.reduce((sum2, d) => sum2 + d.clicks, 0) / recentData.length;
        const recommendation = optimizer.recommendBid(
          {
            currentBid,
            avgImpressions,
            avgClicks
          },
          target
        );
        const evaluation = optimizer.evaluateModel(historicalData.slice(0, 10));
        return {
          recommendation,
          modelPerformance: evaluation,
          dataPoints: historicalData.length
        };
      }),
      /**
       * 批量获取多个广告活动的出价推荐
       */
      getBatchBidRecommendations: protectedProcedure.input(
        external_exports.object({
          campaignIds: external_exports.array(external_exports.string()),
          target: optimizationTargetSchema,
          daysOfHistory: external_exports.number().default(30)
        })
        // @ts-ignore
      ).mutation(async ({ ctx, input }) => {
        const { campaignIds, target, daysOfHistory } = input;
        const results = await Promise.allSettled(
          campaignIds.map(async (campaignId) => {
            const campaign = await getCampaignById(parseInt(campaignId, 10));
            if (!campaign) {
              throw new Error("Campaign not found");
            }
            const cutoffDate = /* @__PURE__ */ new Date();
            cutoffDate.setDate(cutoffDate.getDate() - daysOfHistory);
            const endDate = /* @__PURE__ */ new Date();
            const historicalRecords = await getDailyPerformanceByDateRange(
              campaign.accountId,
              cutoffDate,
              endDate,
              campaign.id
            );
            if (historicalRecords.length < 10) {
              throw new Error("Insufficient data");
            }
            const historicalData = historicalRecords.map(toHistoricalData);
            const optimizer = new BidOptimizer();
            optimizer.train(historicalData);
            const recentData = historicalData.slice(0, 7);
            const currentBid = recentData.reduce((sum2, d) => sum2 + d.bid, 0) / recentData.length;
            const avgImpressions = recentData.reduce((sum2, d) => sum2 + d.impressions, 0) / recentData.length;
            const avgClicks = recentData.reduce((sum2, d) => sum2 + d.clicks, 0) / recentData.length;
            const recommendation = optimizer.recommendBid(
              {
                currentBid,
                avgImpressions,
                avgClicks
              },
              target
            );
            return {
              campaignId,
              recommendation,
              success: true
            };
          })
          // @ts-ignore
        );
        return results.map((result, index2) => {
          if (result.status === "fulfilled") {
            return result.value;
          } else {
            return {
              campaignId: campaignIds[index2],
              recommendation: null,
              success: false,
              error: result.reason.message
            };
          }
        });
      }),
      /**
       * 预算分配优化
       */
      optimizeBudgetAllocation: protectedProcedure.input(
        external_exports.object({
          performanceGroupId: external_exports.string(),
          totalBudget: external_exports.number(),
          // @ts-ignore
          daysOfHistory: external_exports.number().default(30)
        })
      ).mutation(async ({ ctx, input }) => {
        const { performanceGroupId: performanceGroupId2, totalBudget, daysOfHistory } = input;
        const groupCampaigns = await getCampaignsByPerformanceGroupId(parseInt(performanceGroupId2, 10));
        if (groupCampaigns.length === 0) {
          throw new Error("No campaigns found in this performance group");
        }
        const cutoffDate = /* @__PURE__ */ new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysOfHistory);
        const endDate = /* @__PURE__ */ new Date();
        const campaignsWithData = await Promise.all(
          groupCampaigns.map(async (campaign) => {
            const campaignIdStr = String(campaign.campaignId);
            const historicalRecords = await getDailyPerformanceByDateRange(
              campaign.accountId,
              cutoffDate,
              endDate,
              campaign.id
            );
            const historicalData = historicalRecords.map(toHistoricalData);
            const currentROAS = historicalData.length > 0 ? historicalData.slice(0, 7).reduce((sum2, d) => sum2 + d.roas, 0) / 7 : 1;
            return {
              id: campaignIdStr,
              name: campaign.campaignName,
              currentBudget: toNum(campaign.dailyBudget) || 100,
              currentROAS,
              historicalData
            };
          })
        );
        const allocator = new BudgetAllocator();
        const allocations = allocator.allocateBudget(campaignsWithData, totalBudget);
        const totalExpectedSales = allocations.reduce(
          // @ts-ignore
          (sum2, a) => sum2 + a.expectedSales,
          0
        );
        const totalAllocated = allocations.reduce(
          // @ts-ignore
          (sum2, a) => sum2 + a.allocatedBudget,
          0
        );
        const overallROAS = totalAllocated === 0 ? 0 : totalExpectedSales / totalAllocated;
        return {
          allocations,
          summary: {
            totalBudget,
            totalAllocated: Math.round(totalAllocated * 100) / 100,
            totalExpectedSales: Math.round(totalExpectedSales * 100) / 100,
            overallROAS: Math.round(overallROAS * 100) / 100
          }
        };
      }),
      /**
       * 模型性能评估
       */
      evaluateModel: protectedProcedure.input(
        // @ts-ignore
        external_exports.object({
          campaignId: external_exports.string(),
          trainingDays: external_exports.number().default(60),
          testDays: external_exports.number().default(14)
        })
      ).query(async ({ ctx, input }) => {
        const { campaignId, trainingDays, testDays } = input;
        const campaign = await getCampaignById(parseInt(campaignId, 10));
        if (!campaign) {
          throw new Error("Campaign not found");
        }
        const trainingCutoff = /* @__PURE__ */ new Date();
        trainingCutoff.setDate(trainingCutoff.getDate() - testDays);
        const historyCutoff = new Date(trainingCutoff);
        historyCutoff.setDate(historyCutoff.getDate() - trainingDays);
        const trainingRecords = await getDailyPerformanceByDateRange(
          campaign.accountId,
          historyCutoff,
          trainingCutoff,
          campaign.id
        );
        const testRecords = await getDailyPerformanceByDateRange(
          campaign.accountId,
          trainingCutoff,
          /* @__PURE__ */ new Date(),
          campaign.id
        );
        if (trainingRecords.length < 10 || testRecords.length < 5) {
          throw new Error("Insufficient data for model evaluation");
        }
        const trainingData = trainingRecords.map(toHistoricalData);
        const testData = testRecords.map(toHistoricalData);
        const optimizer = new BidOptimizer();
        optimizer.train(trainingData);
        const evaluation = optimizer.evaluateModel(testData);
        return {
          evaluation,
          trainingDataPoints: trainingData.length,
          testDataPoints: testData.length
        };
      })
    });
  }
});

