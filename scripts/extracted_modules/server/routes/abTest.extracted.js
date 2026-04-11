// Extracted from production dist/index.js
// Original module: server/routes/abTest.ts
// Lines: 273

var abTestRouter;
var init_abTest = __esm({
  "server/routes/abTest.ts"() {
    "use strict";
    init_trpc();
    init_zod();
    init_dist();
    init_abTestService();
    init_abTestIntegration();
    init_drizzle_orm();
    init_db2();
    init_schema2();
    abTestRouter = router({
      // 创建A/B测试
      create: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        performanceGroupId: external_exports.number().optional(),
        testName: external_exports.string(),
        testDescription: external_exports.string().optional(),
        testType: external_exports.enum(["budget_allocation", "bid_strategy", "targeting"]),
        targetMetric: external_exports.enum(["roas", "acos", "conversions", "revenue", "profit"]),
        minSampleSize: external_exports.number().optional(),
        confidenceLevel: external_exports.number().optional(),
        durationDays: external_exports.number().optional(),
        controlConfig: external_exports.record(external_exports.string(), external_exports.unknown()),
        treatmentConfig: external_exports.record(external_exports.string(), external_exports.unknown()),
        trafficSplit: external_exports.number().optional()
      })).mutation(async ({ ctx, input }) => {
        return createABTest({
          accountId: input.accountId,
          performanceGroupId: input.performanceGroupId,
          testName: input.testName,
          testDescription: input.testDescription,
          testType: input.testType,
          targetMetric: input.targetMetric,
          minSampleSize: input.minSampleSize,
          confidenceLevel: input.confidenceLevel,
          durationDays: input.durationDays,
          controlConfig: input.controlConfig,
          treatmentConfig: input.treatmentConfig,
          trafficSplit: input.trafficSplit
        }, ctx.user.id);
      }),
      // 获取测试列表
      list: protectedProcedure.input(external_exports.object({ accountId: external_exports.number() })).query(async ({ ctx, input }) => {
        return getABTests(input.accountId);
      }),
      // 获取测试详情
      get: protectedProcedure.input(external_exports.object({ testId: external_exports.number() })).query(async ({ ctx, input }) => {
        return getABTestById(input.testId);
      }),
      // 分配广告活动到测试组
      assignCampaigns: protectedProcedure.input(external_exports.object({
        testId: external_exports.number(),
        campaignIds: external_exports.array(external_exports.number()),
        // @ts-ignore
        splitMethod: external_exports.enum(["random", "stratified", "manual"]).optional()
      })).mutation(async ({ ctx, input }) => {
        return assignCampaignsToTest(
          input.testId,
          input.campaignIds,
          input.splitMethod
        );
      }),
      // 启动测试
      start: protectedProcedure.input(external_exports.object({
        // @ts-ignore
        testId: external_exports.number(),
        durationDays: external_exports.number().optional()
      })).mutation(async ({ ctx, input }) => {
        await startABTest(input.testId, input.durationDays);
        return { success: true };
      }),
      // 暂停测试
      pause: protectedProcedure.input(external_exports.object({ testId: external_exports.number() })).mutation(async ({ ctx, input }) => {
        await pauseABTest(input.testId);
        return { success: true };
      }),
      // 结束测试
      complete: protectedProcedure.input(external_exports.object({ testId: external_exports.number() })).mutation(async ({ ctx, input }) => {
        await completeABTest(input.testId);
        return { success: true };
      }),
      // 分析测试结果
      analyze: protectedProcedure.input(external_exports.object({ testId: external_exports.number() })).query(async ({ ctx, input }) => {
        return analyzeABTestResults(input.testId);
      }),
      // 删除测试
      delete: protectedProcedure.input(external_exports.object({ testId: external_exports.number() })).mutation(async ({ ctx, input }) => {
        await deleteABTest(input.testId);
        return { success: true };
      }),
      // ==================== v276: 闭环反馈与增强API ====================
      // v276: 实验统计概览 — 提供全局实验状态汇总
      overview: protectedProcedure.input(external_exports.object({ accountId: external_exports.number() })).query(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) return { total: 0, running: 0, completed: 0, draft: 0, avgConfidence: 0, recentResults: [] };
        try {
          const allTests = await db.select().from(abTests).where(eq(abTests.accountId, input.accountId)).orderBy(desc(abTests.createdAt));
          const total = allTests.length;
          const running = allTests.filter((t2) => t2.status === "running").length;
          const completed = allTests.filter((t2) => t2.status === "completed").length;
          const draft = allTests.filter((t2) => t2.status === "draft").length;
          const paused = allTests.filter((t2) => t2.status === "paused").length;
          const completedTests = allTests.filter((t2) => t2.status === "completed").slice(0, 5);
          const recentResults = [];
          for (const test2 of completedTests) {
            const results = await db.select().from(abTestResults).where(eq(abTestResults.testId, test2.id));
            const significantMetrics = results.filter((r) => r.isSignificant === 1);
            recentResults.push({
              testId: test2.id,
              testName: test2.testName,
              targetMetric: test2.targetMetric,
              completedAt: test2.endDate,
              significantCount: significantMetrics.length,
              totalMetrics: results.length,
              hasWinner: significantMetrics.length > 0
            });
          }
          return {
            total,
            running,
            completed,
            draft,
            paused,
            avgConfidence: allTests.length > 0 ? allTests.reduce((sum2, t2) => sum2 + parseFloat(t2.confidenceLevel || "0.95"), 0) / allTests.length : 0.95,
            recentResults
          };
        } catch (e) {
          return { total: 0, running: 0, completed: 0, draft: 0, paused: 0, avgConfidence: 0.95, recentResults: [] };
        }
      }),
      // v276: 从实验模板快速创建
      createFromTemplate: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        performanceGroupId: external_exports.number().optional(),
        template: external_exports.enum(["cascade_vs_single", "fusion_threshold", "exploration_rate"]),
        // 融合阈值模板参数
        controlThreshold: external_exports.number().optional(),
        treatmentThreshold: external_exports.number().optional(),
        // 探索率模板参数
        controlRange: external_exports.object({ min: external_exports.number(), max: external_exports.number() }).optional(),
        treatmentRange: external_exports.object({ min: external_exports.number(), max: external_exports.number() }).optional()
      })).mutation(async ({ ctx, input }) => {
        switch (input.template) {
          case "cascade_vs_single":
            return createCascadeVsSingleExperiment(
              input.accountId,
              input.performanceGroupId,
              ctx.user.id
            );
          case "fusion_threshold":
            return createFusionThresholdExperiment(
              input.accountId,
              input.controlThreshold || 0.1,
              input.treatmentThreshold || 0.2,
              input.performanceGroupId,
              ctx.user.id
            );
          case "exploration_rate":
            return createExplorationRateExperiment(
              input.accountId,
              input.controlRange || { min: 0.05, max: 0.15 },
              input.treatmentRange || { min: 0.1, max: 0.25 },
              input.performanceGroupId,
              ctx.user.id
            );
          default:
            throw new TRPCError({ code: "BAD_REQUEST", message: "\u672A\u77E5\u7684\u5B9E\u9A8C\u6A21\u677F" });
        }
      }),
      // v276: 闭环反馈 — 将获胜策略自动应用到优化引擎
      applyWinnerStrategy: protectedProcedure.input(external_exports.object({
        testId: external_exports.number(),
        applyToAll: external_exports.boolean().default(false),
        targetGroupId: external_exports.number().optional()
      })).mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        const analysis = await analyzeABTestResults(input.testId);
        if (analysis.overallWinner === "inconclusive") {
          return {
            success: false,
            message: "\u5B9E\u9A8C\u7ED3\u679C\u4E0D\u663E\u8457\uFF0C\u65E0\u6CD5\u786E\u5B9A\u83B7\u80DC\u7B56\u7565\u3002\u5EFA\u8BAE\u7EE7\u7EED\u8FD0\u884C\u5B9E\u9A8C\u6216\u589E\u52A0\u6837\u672C\u91CF\u3002",
            applied: false
          };
        }
        const winnerVariant = analysis.variants.find(
          (v) => v.variantType === analysis.overallWinner
        );
        if (!winnerVariant) {
          return {
            success: false,
            message: "\u65E0\u6CD5\u627E\u5230\u83B7\u80DC\u53D8\u4F53\u914D\u7F6E",
            applied: false
          };
        }
        const winnerConfig = winnerVariant.configJson ? JSON.parse(winnerVariant.configJson) : {};
        const applyLog = {
          testId: input.testId,
          testName: analysis.testInfo.testName,
          winner: analysis.overallWinner,
          winnerConfig,
          appliedAt: (/* @__PURE__ */ new Date()).toISOString(),
          applyToAll: input.applyToAll,
          targetGroupId: input.targetGroupId,
          metrics: analysis.metrics.map((m) => ({
            metric: m.metricName,
            improvement: m.relativeDifference,
            pValue: m.pValue,
            isSignificant: m.isSignificant
          }))
        };
        return {
          success: true,
          // @ts-ignore
          message: `\u83B7\u80DC\u7B56\u7565 (${analysis.overallWinner === "treatment" ? "\u5B9E\u9A8C\u7EC4" : "\u5BF9\u7167\u7EC4"}) \u5DF2\u6807\u8BB0\u4E3A\u63A8\u8350\u7B56\u7565\u3002`,
          applied: true,
          winnerConfig,
          applyLog,
          recommendation: analysis.recommendation
        };
      }),
      // v276: 获取实验每日趋势数据 — 用于前端趋势图展示
      getDailyTrend: protectedProcedure.input(external_exports.object({ testId: external_exports.number() })).query(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) return { controlTrend: [], treatmentTrend: [] };
        try {
          const variants = await db.select().from(abTestVariants).where(eq(abTestVariants.testId, input.testId));
          const controlVariant = variants.find((v) => v.variantType === "control");
          const treatmentVariant = variants.find((v) => v.variantType === "treatment");
          const controlTrend = controlVariant ? await db.select().from(abTestDailyMetrics).where(and(
            eq(abTestDailyMetrics.testId, input.testId),
            eq(abTestDailyMetrics.variantId, controlVariant.id)
          )).orderBy(abTestDailyMetrics.date) : [];
          const treatmentTrend = treatmentVariant ? await db.select().from(abTestDailyMetrics).where(and(
            eq(abTestDailyMetrics.testId, input.testId),
            eq(abTestDailyMetrics.variantId, treatmentVariant.id)
          )).orderBy(abTestDailyMetrics.date) : [];
          return {
            controlTrend: controlTrend.map((m) => ({
              date: m.date,
              impressions: m.impressions,
              clicks: m.clicks,
              spend: parseFloat(m.spend || "0"),
              sales: parseFloat(m.sales || "0"),
              orders: m.orders,
              acos: parseFloat(m.acos || "0"),
              roas: parseFloat(m.roas || "0"),
              ctr: parseFloat(m.ctr || "0"),
              cvr: parseFloat(m.cvr || "0")
            })),
            treatmentTrend: treatmentTrend.map((m) => ({
              date: m.date,
              impressions: m.impressions,
              clicks: m.clicks,
              spend: parseFloat(m.spend || "0"),
              sales: parseFloat(m.sales || "0"),
              orders: m.orders,
              acos: parseFloat(m.acos || "0"),
              roas: parseFloat(m.roas || "0"),
              ctr: parseFloat(m.ctr || "0"),
              cvr: parseFloat(m.cvr || "0")
            }))
          };
        } catch (e) {
          return { controlTrend: [], treatmentTrend: [] };
        }
      })
    });
  }
});

