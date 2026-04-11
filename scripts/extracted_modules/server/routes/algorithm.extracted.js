// Extracted from production dist/index.js
// Original module: server/routes/algorithm.ts
// Lines: 296

var algorithmOptimizationRouter, algorithmEffectRouter, algorithmEvolutionRouter, holidayConfigRouter;
var init_algorithm = __esm({
  "server/routes/algorithm.ts"() {
    "use strict";
    init_trpc();
    init_zod();
    init_algorithmOptimizationService();
    init_algorithmEffectService();
    init_holidayConfigService();
    init_algorithmEvolutionEngine();
    init_optimizationAutoCorrector();
    init_apiCacheService();
    init_accessControl();
    algorithmOptimizationRouter = router({
      // 获取算法参数
      getParameters: protectedProcedure.query(async () => {
        return getAlgorithmParameters();
      }),
      // 更新算法参数
      updateParameters: protectedProcedure.input(external_exports.object({
        maxBidIncreasePercent: external_exports.number().optional(),
        maxBidDecreasePercent: external_exports.number().optional(),
        minBidChangePercent: external_exports.number().optional(),
        profitMarginPercent: external_exports.number().optional(),
        conversionValueMultiplier: external_exports.number().optional(),
        maxDailyAdjustments: external_exports.number().optional(),
        cooldownPeriodHours: external_exports.number().optional(),
        minConfidenceThreshold: external_exports.number().optional(),
        minDataPoints: external_exports.number().optional()
      })).mutation(async ({ ctx, input }) => {
        return updateAlgorithmParameters(input);
      }),
      // 重置算法参数
      resetParameters: protectedProcedure.mutation(async () => {
        return resetAlgorithmParameters();
      }),
      // 获取算法性能指标
      getPerformance: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number().optional(),
        days: external_exports.number().optional()
        // @ts-ignore
      })).query(async ({ input, ctx }) => {
        if (input.accountId) await verifyAccountAccess(ctx.user.id, input.accountId);
        return calculateAlgorithmPerformance(
          input.accountId,
          input.days || 30
        );
      }),
      // 按调整类型分析
      analyzeByType: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number().optional(),
        // @ts-ignore
        days: external_exports.number().optional()
      })).query(async ({ input, ctx }) => {
        if (input.accountId) await verifyAccountAccess(ctx.user.id, input.accountId);
        return analyzeByAdjustmentType(
          input.accountId,
          input.days || 30
        );
      }),
      // 按出价变化幅度分析
      analyzeByRange: protectedProcedure.input(external_exports.object({
        // @ts-ignore
        accountId: external_exports.number().optional(),
        days: external_exports.number().optional()
      })).query(async ({ input, ctx }) => {
        if (input.accountId) await verifyAccountAccess(ctx.user.id, input.accountId);
        return analyzeByBidChangeRange(
          input.accountId,
          input.days || 30
        );
      }),
      // 获取优化建议
      getSuggestions: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number().optional(),
        days: external_exports.number().optional()
      })).query(async ({ input, ctx }) => {
        if (input.accountId) await verifyAccountAccess(ctx.user.id, input.accountId);
        return generateOptimizationSuggestions(
          input.accountId,
          input.days || 30
        );
      }),
      // 获取参数调优建议
      // @ts-ignore
      getParameterTuning: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number().optional(),
        days: external_exports.number().optional()
      })).query(async ({ input, ctx }) => {
        if (input.accountId) await verifyAccountAccess(ctx.user.id, input.accountId);
        const metrics = await calculateAlgorithmPerformance(
          input.accountId,
          input.days || 30
        );
        const byRange = await analyzeByBidChangeRange(
          input.accountId,
          input.days || 30
        );
        return getParameterTuningSuggestions(metrics, byRange);
      })
    });
    algorithmEffectRouter = router({
      // 获取算法效果统计
      getStats: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number().optional(),
        days: external_exports.number().optional().default(30)
      })).query(async ({ ctx, input }) => {
        const cacheKey = apiCache.generateKey("algorithmEffect.getStats", ctx.user.id, input);
        const cached2 = apiCache.get(cacheKey);
        if (cached2) return cached2;
        const admin = await isAdminUser(ctx.user.id);
        let userAccountIds;
        if (!admin) {
          const accountSet = await getUserAccountIds2(ctx.user.id);
          userAccountIds = Array.from(accountSet);
        }
        const endDate = /* @__PURE__ */ new Date();
        const startDate = /* @__PURE__ */ new Date();
        startDate.setDate(startDate.getDate() - input.days);
        const result = await getAlgorithmEffectStats(
          ctx.user.id,
          input.accountId,
          startDate,
          endDate,
          admin,
          userAccountIds
        );
        apiCache.set(cacheKey, result, 5 * 60 * 1e3);
        return result;
      }),
      // 获取效果趋势
      getTrend: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number().optional(),
        days: external_exports.number().optional().default(30)
      })).query(async ({ ctx, input }) => {
        const admin = await isAdminUser(ctx.user.id);
        let userAccountIds;
        if (!admin) {
          const accountSet = await getUserAccountIds2(ctx.user.id);
          userAccountIds = Array.from(accountSet);
        }
        return getEffectTrend(
          ctx.user.id,
          input.accountId,
          input.days,
          admin,
          userAccountIds
        );
      }),
      // 获取最近的效果记录
      getRecent: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number().optional(),
        limit: external_exports.number().optional().default(50)
      })).query(async ({ ctx, input }) => {
        return getRecentEffectRecords(
          ctx.user.id,
          // @ts-ignore
          input.accountId,
          input.limit
        );
      }),
      // 获取待更新效果的记录
      // @ts-ignore
      getPending: protectedProcedure.query(async ({ ctx }) => {
        return getPendingEffectRecords(ctx.user.id);
      })
    });
    algorithmEvolutionRouter = router({
      // 获取优化目标的算法配置
      getTargetConfig: protectedProcedure.input(external_exports.object({ targetId: external_exports.number() })).query(async ({ ctx, input }) => {
        return getTargetAlgorithmConfig(input.targetId);
      }),
      // 获取优化目标的效果评估
      evaluateTarget: protectedProcedure.input(external_exports.object({
        targetId: external_exports.number(),
        period: external_exports.enum(["7", "14", "30"]).optional().default("14")
      })).query(async ({ ctx, input }) => {
        const period = parseInt(input.period);
        return evaluateTargetPerformance(input.targetId, period);
      }),
      // 手动触发单个目标的进化周期
      runEvolutionCycle: protectedProcedure.input(external_exports.object({ targetId: external_exports.number() })).mutation(async ({ ctx, input }) => {
        return runEvolutionCycle2(input.targetId);
      }),
      // 手动触发全局进化
      runGlobalEvolution: protectedProcedure.mutation(async () => {
        return runGlobalEvolution();
      }),
      // 手动触发效果追踪
      runEffectTracking: protectedProcedure.mutation(async () => {
        return runEffectTracking();
      }),
      // 获取有效出价配置（供前端展示进化后的参数）
      getEffectiveBidConfig: protectedProcedure.input(external_exports.object({ targetId: external_exports.number() })).query(async ({ ctx, input }) => {
        return getEffectiveBidConfig(input.targetId);
      }),
      // v167: 手动触发自动纠错
      runAutoCorrection: protectedProcedure.input(external_exports.object({ accountId: external_exports.number().optional() })).mutation(async ({ input, ctx }) => {
        if (input.accountId) await verifyAccountAccess(ctx.user.id, input.accountId);
        return runAutoCorrection(input.accountId);
      })
    });
    holidayConfigRouter = router({
      // 获取节假日配置列表
      list: protectedProcedure.input(external_exports.object({
        marketplace: external_exports.string().optional()
      }).optional()).query(async ({ ctx, input }) => {
        return getHolidayConfigs(
          ctx.user.id,
          input?.marketplace
        );
      }),
      // 初始化系统默认节假日
      initializeDefaults: protectedProcedure.input(external_exports.object({
        marketplace: external_exports.string()
      })).mutation(async ({ ctx, input }) => {
        return initializeSystemHolidays(
          ctx.user.id,
          input.marketplace
        );
      }),
      // 创建节假日配置
      create: protectedProcedure.input(external_exports.object({
        marketplace: external_exports.string(),
        name: external_exports.string(),
        startDate: external_exports.string(),
        endDate: external_exports.string(),
        bidMultiplier: external_exports.string(),
        budgetMultiplier: external_exports.string(),
        priority: external_exports.enum(["high", "medium", "low"]),
        preHolidayDays: external_exports.number().optional().default(7)
      })).mutation(async ({ ctx, input }) => {
        return createHolidayConfig({
          userId: ctx.user.id,
          ...input,
          isActive: 1,
          isSystemDefault: 0
        });
      }),
      // 更新节假日配置
      update: protectedProcedure.input(external_exports.object({
        id: external_exports.number(),
        name: external_exports.string().optional(),
        startDate: external_exports.string().optional(),
        endDate: external_exports.string().optional(),
        bidMultiplier: external_exports.string().optional(),
        // @ts-ignore
        budgetMultiplier: external_exports.string().optional(),
        priority: external_exports.enum(["high", "medium", "low"]).optional(),
        preHolidayDays: external_exports.number().optional()
      })).mutation(async ({ ctx, input }) => {
        const { id, ...data } = input;
        return updateHolidayConfig(id, data);
      }),
      // 删除节假日配置
      delete: protectedProcedure.input(external_exports.object({ id: external_exports.number() })).mutation(async ({ ctx, input }) => {
        return deleteHolidayConfig(input.id);
      }),
      // 切换节假日配置的启用状态
      toggle: protectedProcedure.input(external_exports.object({
        id: external_exports.number(),
        isActive: external_exports.boolean()
      })).mutation(async ({ ctx, input }) => {
        return toggleHolidayConfig(input.id, input.isActive);
      }),
      // 获取即将到来的节假日
      getUpcoming: protectedProcedure.input(external_exports.object({
        marketplace: external_exports.string().optional(),
        days: external_exports.number().optional().default(30)
      }).optional()).query(async ({ ctx, input }) => {
        return getUpcomingHolidays(
          ctx.user.id,
          input?.marketplace,
          input?.days
        );
      }),
      // 获取支持的站点列表
      getMarketplaces: protectedProcedure.query(async () => {
        return getSupportedMarketplaces();
      }),
      // 获取指定日期的调整乘数
      getMultipliers: protectedProcedure.input(external_exports.object({
        marketplace: external_exports.string(),
        date: external_exports.string().optional()
      })).query(async ({ ctx, input }) => {
        const date6 = input.date ? new Date(input.date) : /* @__PURE__ */ new Date();
        return getDateAdjustmentMultipliersFromDb(
          ctx.user.id,
          input.marketplace,
          date6
        );
      })
    });
  }
});

