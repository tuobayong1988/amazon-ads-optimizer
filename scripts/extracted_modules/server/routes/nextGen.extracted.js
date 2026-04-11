// Extracted from production dist/index.js
// Original module: server/routes/nextGen.ts
// Lines: 293

var nextGenRouter;
var init_nextGen = __esm({
  "server/routes/nextGen.ts"() {
    "use strict";
    init_trpc();
    init_zod();
    init_causalInferenceEngine();
    init_keywordGraphService();
    init_drizzle_orm();
    init_nextGenMigration();
    init_db2();
    init_accessControl();
    init_schema2();
    nextGenRouter = router({
      // 初始化NextGen数据库表（仅在首次部署时使用一次，后续部署自动执行）
      ensureTables: protectedProcedure.mutation(async () => {
        return ensureNextGenTables();
      }),
      // 获取NextGen算法系统状态
      getStatus: protectedProcedure.input(external_exports.object({ accountId: external_exports.number() })).query(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        return {
          version: "v276",
          engineMode: "unified",
          description: "NextGen\u7EDF\u4E00\u51FA\u4EF7\u5F15\u64CE\uFF0C100%\u8986\u76D6\u6240\u6709\u5173\u952E\u8BCD\u548C\u5546\u54C1\u5B9A\u5411",
          algorithmTiers: {
            advanced: ["sigmoid_curve", "linucb", "cql", "ensemble"],
            ruleEngine: ["acos_based", "exploration", "protection"],
            conservative: ["hold_current_bid"]
          },
          automatedTasks: {
            maintenance: "\u6BCF4\u5C0F\u65F6\u81EA\u52A8\u6267\u884C\uFF08\u7279\u5F81\u7F13\u5B58/Sigmoid\u62DF\u5408/Reward\u56DE\u586B/\u56E0\u679C\u5206\u6790\uFF09",
            modelTraining: "\u6BCF6\u5C0F\u65F6\u81EA\u52A8\u6267\u884C\uFF08CQL\u79BB\u7EBF\u5F3A\u5316\u5B66\u4E60\uFF09",
            budgetOptimization: "\u6BCF\u65E5\u51CC\u66682:00\u81EA\u52A8\u6267\u884C\uFF08\u9884\u7B97\u7EC4\u5408\u4F18\u5316+\u5173\u952E\u8BCD\u56FE\u8C31\uFF09"
          },
          status: "active"
        };
      }),
      // 查询因果推断分析结果（只读查询，分析由定时任务自动执行）
      getCausalAnalysis: protectedProcedure.input(external_exports.object({ accountId: external_exports.number() })).query(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        return batchCausalAnalysis(input.accountId);
      }),
      // v275: 查询因果推断详细结果 — 用于前端因果推断可视化模块
      getCausalInsights: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        days: external_exports.number().default(30),
        // @ts-ignore
        limit: external_exports.number().default(50)
      })).query(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        const db = await getDb();
        if (!db) return { results: [], summary: { total: 0, significant: 0, avgUplift: 0, totalIncrementalProfit: 0 } };
        const startDate = /* @__PURE__ */ new Date();
        startDate.setDate(startDate.getDate() - input.days);
        const startDateStr = startDate.toISOString().split("T")[0];
        try {
          const results = await db.select({
            id: causalInferenceResults.id,
            keywordId: causalInferenceResults.keywordId,
            targetId: causalInferenceResults.targetId,
            campaignId: causalInferenceResults.campaignId,
            analysisDate: causalInferenceResults.analysisDate,
            upliftScore: causalInferenceResults.upliftScore,
            confidenceInterval: causalInferenceResults.confidenceInterval,
            incrementalRevenue: causalInferenceResults.incrementalRevenue,
            incrementalCost: causalInferenceResults.incrementalCost,
            incrementalProfit: causalInferenceResults.incrementalProfit,
            incrementalRoas: causalInferenceResults.incrementalRoas,
            optimalBid: causalInferenceResults.optimalBid,
            optimalBidLower: causalInferenceResults.optimalBidLower,
            optimalBidUpper: causalInferenceResults.optimalBidUpper,
            treatmentCvr: causalInferenceResults.treatmentCvr,
            controlCvr: causalInferenceResults.controlCvr,
            sampleSize: causalInferenceResults.sampleSize,
            modelVersion: causalInferenceResults.modelVersion
          }).from(causalInferenceResults).where(and(
            eq(causalInferenceResults.accountId, input.accountId),
            gte(causalInferenceResults.analysisDate, startDateStr)
          )).orderBy(desc(causalInferenceResults.analysisDate)).limit(input.limit);
          const total = results.length;
          const significant = results.filter(
            (r) => Math.abs(parseFloat(r.upliftScore || "0")) > 0.05 && parseFloat(r.confidenceInterval || "1") < 0.5
          ).length;
          const avgUplift = total > 0 ? results.reduce((sum2, r) => sum2 + parseFloat(r.upliftScore || "0"), 0) / total : 0;
          const totalIncrementalProfit = results.reduce(
            (sum2, r) => sum2 + parseFloat(r.incrementalProfit || "0"),
            0
          );
          return {
            results: results.map((r) => ({
              ...r,
              upliftScore: parseFloat(r.upliftScore || "0"),
              confidenceInterval: parseFloat(r.confidenceInterval || "0"),
              incrementalRevenue: parseFloat(r.incrementalRevenue || "0"),
              incrementalCost: parseFloat(r.incrementalCost || "0"),
              incrementalProfit: parseFloat(r.incrementalProfit || "0"),
              incrementalRoas: parseFloat(r.incrementalRoas || "0"),
              optimalBid: parseFloat(r.optimalBid || "0"),
              optimalBidLower: parseFloat(r.optimalBidLower || "0"),
              optimalBidUpper: parseFloat(r.optimalBidUpper || "0"),
              treatmentCvr: parseFloat(r.treatmentCvr || "0"),
              controlCvr: parseFloat(r.controlCvr || "0")
            })),
            summary: {
              total,
              significant,
              avgUplift: Math.round(avgUplift * 1e4) / 1e4,
              totalIncrementalProfit: Math.round(totalIncrementalProfit * 100) / 100
            }
          };
        } catch (e) {
          return { results: [], summary: { total: 0, significant: 0, avgUplift: 0, totalIncrementalProfit: 0 } };
        }
      }),
      // v275: 查询CQL模型训练状态 — 用于前端CQL训练效果监控
      getCqlModelStatus: protectedProcedure.input(external_exports.object({ accountId: external_exports.number() })).query(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        const db = await getDb();
        if (!db) return { models: [], summary: { totalModels: 0, avgTrainingSteps: 0, latestTrainedAt: null } };
        try {
          const models = await db.select({
            id: cqlModels.id,
            accountId: cqlModels.accountId,
            modelVersion: cqlModels.modelVersion,
            trainingEpisodes: cqlModels.trainingEpisodes,
            trainingSteps: cqlModels.trainingSteps,
            avgLoss: cqlModels.avgLoss,
            lastTrainedAt: cqlModels.lastTrainedAt,
            createdAt: cqlModels.createdAt,
            updatedAt: cqlModels.updatedAt
          }).from(cqlModels).where(eq(cqlModels.accountId, input.accountId)).orderBy(desc(cqlModels.updatedAt)).limit(10);
          const totalModels = models.length;
          const avgTrainingSteps = totalModels > 0 ? models.reduce((sum2, m) => sum2 + (m.trainingSteps || 0), 0) / totalModels : 0;
          const latestTrainedAt = models.length > 0 ? models[0].lastTrainedAt : null;
          return {
            models: models.map((m) => ({
              ...m,
              avgLoss: parseFloat(m.avgLoss || "0")
            })),
            summary: {
              totalModels,
              avgTrainingSteps: Math.round(avgTrainingSteps),
              latestTrainedAt
            }
          };
        } catch (e) {
          return { models: [], summary: { totalModels: 0, avgTrainingSteps: 0, latestTrainedAt: null } };
        }
      }),
      // v275: 查询竞争环境感知状态 — 用于前端竞争环境展示
      // @ts-ignore
      getCompetitionInsights: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        days: external_exports.number().default(7)
      })).query(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        const db = await getDb();
        if (!db) return { distribution: [], recentTrend: [], summary: { avgCompetition: "medium", dominantType: "neutral" } };
        try {
          const startDate = /* @__PURE__ */ new Date();
          startDate.setDate(startDate.getDate() - input.days);
          const startDateStr = startDate.toISOString().split("T")[0];
          const events = await db.select({
            performanceData: optimizationEvents2.performanceData,
            createdAt: optimizationEvents2.createdAt
          }).from(optimizationEvents2).where(and(
            eq(optimizationEvents2.accountId, input.accountId),
            gte(optimizationEvents2.createdAt, startDateStr)
          )).orderBy(desc(optimizationEvents2.createdAt)).limit(500);
          const competitionCounts = { aggressive: 0, tight: 0, passive: 0, neutral: 0 };
          const dailyCompetition = {};
          for (const event of events) {
            const perfData = event.performanceData;
            if (!perfData) continue;
            const competitionType = perfData?.gto?.competitorType || perfData?.competitorType || "neutral";
            const normalizedType = ["aggressive", "tight", "passive", "neutral"].includes(competitionType) ? competitionType : "neutral";
            competitionCounts[normalizedType]++;
            const dateKey = event.createdAt ? event.createdAt.split(" ")[0] : "unknown";
            if (!dailyCompetition[dateKey]) {
              dailyCompetition[dateKey] = { aggressive: 0, tight: 0, passive: 0, neutral: 0, total: 0 };
            }
            dailyCompetition[dateKey][normalizedType]++;
            dailyCompetition[dateKey].total++;
          }
          const total = Object.values(competitionCounts).reduce((a, b) => a + b, 0);
          const distribution = Object.entries(competitionCounts).map(([type, cnt]) => ({
            type,
            count: cnt,
            // @ts-ignore
            percentage: total > 0 ? Math.round(cnt / total * 1e3) / 10 : 0,
            label: type === "aggressive" ? "\u75AF\u72C2\u578B" : type === "tight" ? "\u7D27\u7F29\u578B" : type === "passive" ? "\u88AB\u52A8\u578B" : "\u4E2D\u6027\u578B"
          }));
          const recentTrend = Object.entries(dailyCompetition).sort(([a], [b]) => a.localeCompare(b)).map(([date6, data]) => ({
            date: date6,
            ...data,
            dominantType: Object.entries(data).filter(([k]) => k !== "total").sort(([, a], [, b]) => b - a)[0]?.[0] || "neutral"
            // @ts-ignore
          }));
          const dominantType = Object.entries(competitionCounts).sort(([, a], [, b]) => b - a)[0]?.[0] || "neutral";
          const intensityMap = { aggressive: 3, tight: 2, neutral: 1, passive: 0 };
          const avgIntensity = total > 0 ? Object.entries(competitionCounts).reduce((sum2, [type, cnt]) => sum2 + (intensityMap[type] || 1) * cnt, 0) / total : 1;
          const avgCompetition = avgIntensity > 2.2 ? "high" : avgIntensity > 1.2 ? "medium" : "low";
          return {
            distribution,
            recentTrend,
            summary: { avgCompetition, dominantType }
          };
        } catch (e) {
          return { distribution: [], recentTrend: [], summary: { avgCompetition: "medium", dominantType: "neutral" } };
        }
      }),
      // v275: 查询预算分池状态 — 用于前端预算分池Dashboard展示
      getBudgetPoolInsights: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        days: external_exports.number().default(30)
      })).query(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        const db = await getDb();
        if (!db) return { poolAllocation: { coreRatio: 80, explorationRatio: 20 }, dailyTrend: [], summary: { avgCoreRatio: 80, avgExplorationRatio: 20, fusedCount: 0, totalEvents: 0 } };
        try {
          const startDate = /* @__PURE__ */ new Date();
          startDate.setDate(startDate.getDate() - input.days);
          const startDateStr = startDate.toISOString().split("T")[0];
          const events = await db.select({
            performanceData: optimizationEvents2.performanceData,
            createdAt: optimizationEvents2.createdAt
          }).from(optimizationEvents2).where(and(
            eq(optimizationEvents2.accountId, input.accountId),
            gte(optimizationEvents2.createdAt, startDateStr)
          )).orderBy(desc(optimizationEvents2.createdAt)).limit(1e3);
          const dailyPool = {};
          let totalCoreRatio = 0;
          let totalExplorationRatio = 0;
          let poolEventCount = 0;
          let fusedCount = 0;
          for (const event of events) {
            const perfData = event.performanceData;
            if (!perfData) continue;
            const budgetPool = perfData?.budgetPool || perfData?.gto?.budgetPool;
            if (budgetPool) {
              const coreRatio = budgetPool.coreRatio || budgetPool.profitPoolRatio || 80;
              const explorationRatio = budgetPool.explorationRatio || budgetPool.explorationPoolRatio || 20;
              const isFused = budgetPool.isFused || false;
              totalCoreRatio += coreRatio;
              totalExplorationRatio += explorationRatio;
              poolEventCount++;
              if (isFused) fusedCount++;
              const dateKey = event.createdAt ? event.createdAt.split(" ")[0] : "unknown";
              if (!dailyPool[dateKey]) {
                dailyPool[dateKey] = { coreRatioSum: 0, explorationRatioSum: 0, count: 0, fusedCount: 0 };
              }
              dailyPool[dateKey].coreRatioSum += coreRatio;
              dailyPool[dateKey].explorationRatioSum += explorationRatio;
              dailyPool[dateKey].count++;
              if (isFused) dailyPool[dateKey].fusedCount++;
            }
          }
          const avgCoreRatio = poolEventCount > 0 ? Math.round(totalCoreRatio / poolEventCount * 10) / 10 : 80;
          const avgExplorationRatio = poolEventCount > 0 ? Math.round(totalExplorationRatio / poolEventCount * 10) / 10 : 20;
          const dailyTrend = Object.entries(dailyPool).sort(([a], [b]) => a.localeCompare(b)).map(([date6, data]) => ({
            date: date6,
            avgCoreRatio: Math.round(data.coreRatioSum / data.count * 10) / 10,
            avgExplorationRatio: Math.round(data.explorationRatioSum / data.count * 10) / 10,
            eventCount: data.count,
            fusedCount: data.fusedCount
          }));
          return {
            poolAllocation: { coreRatio: avgCoreRatio, explorationRatio: avgExplorationRatio },
            dailyTrend,
            summary: {
              avgCoreRatio,
              // @ts-ignore
              avgExplorationRatio,
              fusedCount,
              totalEvents: poolEventCount
            }
          };
        } catch (e) {
          return { poolAllocation: { coreRatio: 80, explorationRatio: 20 }, dailyTrend: [], summary: { avgCoreRatio: 80, avgExplorationRatio: 20, fusedCount: 0, totalEvents: 0 } };
        }
      }),
      // 查询关键词图谱机会（只读查询，图谱由定时任务自动构建）
      getKeywordOpportunities: protectedProcedure.input(external_exports.object({ accountId: external_exports.number() })).query(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        const opportunities = await discoverOpportunities(input.accountId);
        const negatives = await discoverNegativeCandidates(input.accountId);
        return { opportunities, negatives };
      })
    });
  }
});

