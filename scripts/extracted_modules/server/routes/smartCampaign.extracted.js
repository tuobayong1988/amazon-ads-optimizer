// Extracted from production dist/index.js
// Original module: server/routes/smartCampaign.ts
// Lines: 250

function toNum2(val) {
  if (val === null || val === void 0) return 0;
  if (typeof val === "number") return val;
  const n = parseFloat(val);
  return isNaN(n) ? 0 : n;
}
function calcTrend(recent, older) {
  if (older === 0) return "stable";
  return recent > older * 1.1 ? "up" : recent < older * 0.9 ? "down" : "stable";
}
function buildMetrics(campaignId, campaignName, status, dailyBudget, records, daysOfHistory) {
  if (records.length === 0) {
    return {
      campaignId: String(campaignId),
      campaignName,
      status: status || "enabled",
      dailyBudget,
      currentBid: 1,
      spend: 0,
      sales: 0,
      impressions: 0,
      clicks: 0,
      conversions: 0,
      acos: 999,
      roas: 0,
      ctr: 0,
      cvr: 0,
      spendTrend: "stable",
      salesTrend: "stable",
      acosTrend: "stable"
    };
  }
  const totalSpend = records.reduce((sum2, r) => sum2 + toNum2(r.spend), 0);
  const totalSales = records.reduce((sum2, r) => sum2 + toNum2(r.sales), 0);
  const totalImpressions = records.reduce((sum2, r) => sum2 + (r.impressions || 0), 0);
  const totalClicks = records.reduce((sum2, r) => sum2 + (r.clicks || 0), 0);
  const totalConversions = records.reduce((sum2, r) => sum2 + (r.conversions || 0), 0);
  const avgACoS = totalSales === 0 ? 999 : totalSpend / totalSales * 100;
  const avgROAS = totalSpend === 0 ? 0 : totalSales / totalSpend;
  const avgCTR = totalImpressions === 0 ? 0 : totalClicks / totalImpressions * 100;
  const avgCVR = totalClicks === 0 ? 0 : totalConversions / totalClicks * 100;
  const half = Math.floor(daysOfHistory / 2);
  const recentData = records.slice(0, half);
  const olderData = records.slice(half);
  const recentLen = recentData.length || 1;
  const olderLen = olderData.length || 1;
  const recentSpend = recentData.reduce((sum2, r) => sum2 + toNum2(r.spend), 0) / recentLen;
  const olderSpend = olderData.reduce((sum2, r) => sum2 + toNum2(r.spend), 0) / olderLen;
  const recentSales = recentData.reduce((sum2, r) => sum2 + toNum2(r.sales), 0) / recentLen;
  const olderSales = olderData.reduce((sum2, r) => sum2 + toNum2(r.sales), 0) / olderLen;
  const recentACoS = recentData.reduce((sum2, r) => sum2 + toNum2(r.dailyAcos), 0) / recentLen;
  const olderACoS = olderData.reduce((sum2, r) => sum2 + toNum2(r.dailyAcos), 0) / olderLen;
  return {
    campaignId: String(campaignId),
    campaignName,
    status: status || "enabled",
    dailyBudget,
    currentBid: toNum2(records[0]?.cpc) || 1,
    spend: totalSpend,
    sales: totalSales,
    impressions: totalImpressions,
    clicks: totalClicks,
    conversions: totalConversions,
    acos: avgACoS,
    roas: avgROAS,
    ctr: avgCTR,
    cvr: avgCVR,
    spendTrend: calcTrend(recentSpend, olderSpend),
    salesTrend: calcTrend(recentSales, olderSales),
    acosTrend: calcTrend(recentACoS, olderACoS)
  };
}
var optimizationGoalSchema, smartCampaignRouter;
var init_smartCampaign = __esm({
  "server/routes/smartCampaign.ts"() {
    "use strict";
    init_zod();
    init_trpc();
    init_decisionEngine();
    init_db2();
    optimizationGoalSchema = external_exports.object({
      type: external_exports.enum(["maximize_sales", "target_acos", "target_roas", "minimize_cost"]),
      targetValue: external_exports.number().optional(),
      maxDailyBudget: external_exports.number().optional(),
      minROAS: external_exports.number().optional()
    });
    __name(toNum2, "toNum");
    __name(calcTrend, "calcTrend");
    __name(buildMetrics, "buildMetrics");
    smartCampaignRouter = router({
      /**
       * 获取单个广告活动的优化建议
       */
      getOptimizationRecommendation: protectedProcedure.input(
        external_exports.object({
          campaignId: external_exports.string(),
          goal: optimizationGoalSchema,
          daysOfHistory: external_exports.number().default(7)
        })
      ).query(async ({ ctx, input }) => {
        const { campaignId, goal, daysOfHistory } = input;
        const campaign = await getCampaignByAmazonCampaignId(campaignId);
        if (!campaign) {
          throw new Error("Campaign not found");
        }
        const { verifyCampaignAccess: verifyCampaignAccess2 } = await Promise.resolve().then(() => (init_accessControl(), accessControl_exports));
        await verifyCampaignAccess2(ctx.user.id, campaign.id);
        const cutoffDate = /* @__PURE__ */ new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysOfHistory);
        const endDate = /* @__PURE__ */ new Date();
        const historicalRecords = await getDailyPerformanceByDateRange(
          campaign.accountId,
          cutoffDate,
          endDate,
          campaign.campaignId
        );
        if (historicalRecords.length === 0) {
          throw new Error("No historical data available");
        }
        const metrics = buildMetrics(
          campaign.id,
          campaign.campaignName,
          campaign.campaignStatus || "enabled",
          toNum2(campaign.dailyBudget) || 100,
          historicalRecords,
          daysOfHistory
        );
        const engine = new SmartDecisionEngine();
        const decision = engine.makeDecision(metrics, goal);
        return {
          metrics,
          decision
        };
      }),
      /**
       * 获取绩效组的批量优化建议
       */
      getBatchOptimizationRecommendations: protectedProcedure.input(
        external_exports.object({
          performanceGroupId: external_exports.string(),
          goal: optimizationGoalSchema,
          daysOfHistory: external_exports.number().default(7)
        })
        // @ts-ignore
      ).query(async ({ ctx, input }) => {
        const { performanceGroupId: performanceGroupId2, goal, daysOfHistory } = input;
        const { verifyPerformanceGroupAccess: verifyPerformanceGroupAccess2 } = await Promise.resolve().then(() => (init_accessControl(), accessControl_exports));
        await verifyPerformanceGroupAccess2(ctx.user.id, parseInt(performanceGroupId2, 10));
        const groupCampaigns = await getCampaignsByPerformanceGroupId(parseInt(performanceGroupId2, 10));
        if (groupCampaigns.length === 0) {
          throw new Error("No campaigns found in this performance group");
        }
        const cutoffDate = /* @__PURE__ */ new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysOfHistory);
        const endDate = /* @__PURE__ */ new Date();
        const campaignMetrics = await Promise.all(
          groupCampaigns.map(async (campaign) => {
            const historicalRecords = await getDailyPerformanceByDateRange(
              campaign.accountId,
              cutoffDate,
              endDate,
              campaign.campaignId
            );
            return buildMetrics(
              campaign.id,
              campaign.campaignName,
              campaign.campaignStatus || "enabled",
              toNum2(campaign.dailyBudget) || 100,
              historicalRecords,
              daysOfHistory
            );
          })
        );
        const engine = new SmartDecisionEngine();
        const decisions = engine.makeBatchDecisions(campaignMetrics, goal);
        const report = engine.generateOptimizationReport(decisions);
        return report;
      }),
      /**
       * 执行优化决策
       */
      executeOptimization: protectedProcedure.input(
        external_exports.object({
          campaignId: external_exports.string(),
          action: external_exports.enum(["pause", "enable", "increase_bid", "decrease_bid", "increase_budget", "decrease_budget"]),
          value: external_exports.number().optional(),
          dryRun: external_exports.boolean().default(true)
          // @ts-ignore
        })
      ).mutation(async ({ ctx, input }) => {
        const { campaignId, action, value, dryRun } = input;
        const campaignRecord = await getCampaignByAmazonCampaignId(campaignId);
        if (!campaignRecord) {
          throw new Error("Campaign not found");
        }
        const { verifyCampaignAccess: verifyCampaignAccess2 } = await Promise.resolve().then(() => (init_accessControl(), accessControl_exports));
        await verifyCampaignAccess2(ctx.user.id, campaignRecord.id);
        const executor = new AutoExecutionEngine();
        const decision = {
          campaignId,
          action,
          currentValue: value,
          recommendedValue: value,
          confidence: 1,
          reasoning: "Manual execution",
          priority: "high",
          expectedImpact: {
            salesChange: 0,
            spendChange: 0,
            acosChange: 0
          }
        };
        const result = await executor.executeDecision(decision, dryRun);
        return result;
      }),
      /**
       * 批量执行优化决策
       */
      executeBatchOptimization: protectedProcedure.input(
        external_exports.object({
          performanceGroupId: external_exports.string(),
          goal: optimizationGoalSchema,
          daysOfHistory: external_exports.number().default(7),
          dryRun: external_exports.boolean().default(true),
          maxConcurrent: external_exports.number().default(5)
        })
      ).mutation(async ({ ctx, input }) => {
        const { performanceGroupId: performanceGroupId2, goal, daysOfHistory, dryRun, maxConcurrent } = input;
        const { verifyPerformanceGroupAccess: verifyPerformanceGroupAccess2 } = await Promise.resolve().then(() => (init_accessControl(), accessControl_exports));
        await verifyPerformanceGroupAccess2(ctx.user.id, parseInt(performanceGroupId2, 10));
        const report = await smartCampaignRouter.createCaller({}).getBatchOptimizationRecommendations({
          performanceGroupId: performanceGroupId2,
          goal,
          daysOfHistory
        });
        const executor = new AutoExecutionEngine();
        const results = await executor.executeBatchDecisions(
          report.recommendations,
          dryRun,
          maxConcurrent
        );
        return {
          summary: report.summary,
          results
        };
      })
    });
  }
});

