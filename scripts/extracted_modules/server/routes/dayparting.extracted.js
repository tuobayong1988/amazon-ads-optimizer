// Extracted from production dist/index.js
// Original module: server/routes/dayparting.ts
// Lines: 203

var daypartingRouter;
var init_dayparting = __esm({
  "server/routes/dayparting.ts"() {
    "use strict";
    init_trpc();
    init_zod();
    init_dist();
    init_daypartingService();
    init_accessControl();
    daypartingRouter = router({
      // 获取账号的所有分时策略
      listStrategies: protectedProcedure.input(external_exports.object({ accountId: external_exports.number() })).query(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        return getDaypartingStrategies(input.accountId);
      }),
      // 获取单个策略详情
      getStrategy: protectedProcedure.input(external_exports.object({ strategyId: external_exports.number() })).query(async ({ ctx, input }) => {
        const strategy = await getDaypartingStrategy(input.strategyId);
        if (!strategy) {
          throw new TRPCError({ code: "NOT_FOUND", message: "\u7B56\u7565\u4E0D\u5B58\u5728" });
        }
        const budgetRules = await getBudgetRules(input.strategyId);
        const bidRules = await getBidRules(input.strategyId);
        return { strategy, budgetRules, bidRules };
      }),
      // 分析广告活动的每周表现
      analyzeWeeklyPerformance: protectedProcedure.input(external_exports.object({
        campaignId: external_exports.number(),
        // @ts-ignore
        lookbackDays: external_exports.number().default(30)
      })).query(async ({ ctx, input }) => {
        return analyzeWeeklyPerformance(input.campaignId, input.lookbackDays);
      }),
      // 分析广告活动的每小时表现
      analyzeHourlyPerformance: protectedProcedure.input(external_exports.object({
        // @ts-ignore
        campaignId: external_exports.number(),
        lookbackDays: external_exports.number().default(30)
      })).query(async ({ ctx, input }) => {
        return analyzeHourlyPerformance(input.campaignId, input.lookbackDays);
      }),
      // 一键生成最优策略
      generateOptimalStrategy: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        campaignId: external_exports.number(),
        name: external_exports.string(),
        optimizationGoal: external_exports.enum(["maximize_sales", "target_acos", "target_roas", "minimize_acos"]),
        // @ts-ignore
        targetAcos: external_exports.number().optional(),
        targetRoas: external_exports.number().optional(),
        lookbackDays: external_exports.number().default(30)
      })).mutation(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        return generateOptimalStrategy(input.accountId, input.campaignId, {
          name: input.name,
          optimizationGoal: input.optimizationGoal,
          targetAcos: input.targetAcos,
          targetRoas: input.targetRoas,
          lookbackDays: input.lookbackDays
        });
      }),
      // 创建分时策略
      createStrategy: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        campaignId: external_exports.number().optional(),
        name: external_exports.string(),
        description: external_exports.string().optional(),
        strategyType: external_exports.enum(["budget", "bidding", "both"]).default("both"),
        optimizationGoal: external_exports.enum(["maximize_sales", "target_acos", "target_roas", "minimize_acos"]).default("maximize_sales"),
        targetAcos: external_exports.number().optional(),
        targetRoas: external_exports.number().optional(),
        analysisLookbackDays: external_exports.number().default(30),
        // @ts-ignore
        maxBudgetMultiplier: external_exports.number().default(2),
        minBudgetMultiplier: external_exports.number().default(0.2),
        maxBidMultiplier: external_exports.number().default(2),
        minBidMultiplier: external_exports.number().default(0.2)
      })).mutation(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        const strategyId = await createDaypartingStrategy({
          accountId: input.accountId,
          campaignId: input.campaignId,
          name: input.name,
          description: input.description,
          strategyType: input.strategyType,
          daypartingOptGoal: input.optimizationGoal,
          daypartingTargetAcos: input.targetAcos?.toString(),
          daypartingTargetRoas: input.targetRoas?.toString(),
          analysisLookbackDays: input.analysisLookbackDays,
          maxBudgetMultiplier: input.maxBudgetMultiplier.toString(),
          minBudgetMultiplier: input.minBudgetMultiplier.toString(),
          maxBidMultiplier: input.maxBidMultiplier.toString(),
          minBidMultiplier: input.minBidMultiplier.toString(),
          daypartingStatus: "draft"
        });
        return { strategyId };
      }),
      // 更新策略状态
      updateStrategyStatus: protectedProcedure.input(external_exports.object({
        strategyId: external_exports.number(),
        status: external_exports.enum(["active", "paused", "draft"])
      })).mutation(async ({ ctx, input }) => {
        await updateDaypartingStrategy(input.strategyId, {
          daypartingStatus: input.status,
          lastAppliedAt: input.status === "active" ? (/* @__PURE__ */ new Date()).toISOString() : void 0
        });
        return { success: true };
      }),
      // 保存预算规则
      saveBudgetRules: protectedProcedure.input(external_exports.object({
        strategyId: external_exports.number(),
        // @ts-ignore
        rules: external_exports.array(external_exports.object({
          dayOfWeek: external_exports.number().min(0).max(6),
          budgetMultiplier: external_exports.number(),
          budgetPercentage: external_exports.number().optional(),
          isEnabled: external_exports.boolean().default(true)
        }))
      })).mutation(async ({ ctx, input }) => {
        await saveBudgetRules(
          input.strategyId,
          // @ts-expect-error - array method type inference
          input.rules.map((r) => ({
            dayOfWeek: r.dayOfWeek,
            budgetMultiplier: r.budgetMultiplier.toString(),
            budgetPercentage: r.budgetPercentage?.toString(),
            isEnabled: r.isEnabled ? 1 : 0
          }))
        );
        return { success: true };
      }),
      // 保存竞价规则
      saveBidRules: protectedProcedure.input(external_exports.object({
        // @ts-ignore
        strategyId: external_exports.number(),
        rules: external_exports.array(external_exports.object({
          dayOfWeek: external_exports.number().min(0).max(6),
          hour: external_exports.number().min(0).max(23),
          bidMultiplier: external_exports.number(),
          isEnabled: external_exports.boolean().default(true)
        }))
      })).mutation(async ({ ctx, input }) => {
        await saveBidRules(
          input.strategyId,
          // @ts-expect-error - array method type inference
          input.rules.map((r) => ({
            dayOfWeek: r.dayOfWeek,
            hour: r.hour,
            bidMultiplier: r.bidMultiplier.toString(),
            isEnabled: r.isEnabled ? 1 : 0
          }))
        );
        return { success: true };
      }),
      // 获取策略执行日志
      getExecutionLogs: protectedProcedure.input(external_exports.object({
        strategyId: external_exports.number(),
        limit: external_exports.number().default(50)
      })).query(async ({ ctx, input }) => {
        return getExecutionLogs(input.strategyId, input.limit);
      }),
      // 计算最优预算分配（不保存，仅预览）
      previewBudgetAllocation: protectedProcedure.input(external_exports.object({
        campaignId: external_exports.number(),
        optimizationGoal: external_exports.enum(["maximize_sales", "target_acos", "target_roas", "minimize_acos"]),
        targetAcos: external_exports.number().optional(),
        targetRoas: external_exports.number().optional(),
        lookbackDays: external_exports.number().default(30)
      })).query(async ({ ctx, input }) => {
        const weeklyData = await analyzeWeeklyPerformance(
          input.campaignId,
          input.lookbackDays
        );
        const allocation = calculateOptimalBudgetAllocation(weeklyData, {
          optimizationGoal: input.optimizationGoal,
          targetAcos: input.targetAcos,
          targetRoas: input.targetRoas
        });
        return { weeklyData, allocation };
      }),
      // 计算最优竞价调整（不保存，仅预览）
      previewBidAdjustments: protectedProcedure.input(external_exports.object({
        campaignId: external_exports.number(),
        optimizationGoal: external_exports.enum(["maximize_sales", "target_acos", "target_roas", "minimize_acos"]),
        targetAcos: external_exports.number().optional(),
        targetRoas: external_exports.number().optional(),
        lookbackDays: external_exports.number().default(30)
      })).query(async ({ ctx, input }) => {
        const hourlyData = await analyzeHourlyPerformance(
          input.campaignId,
          input.lookbackDays
        );
        const adjustments = calculateOptimalBidAdjustments(hourlyData, {
          optimizationGoal: input.optimizationGoal,
          targetAcos: input.targetAcos,
          targetRoas: input.targetRoas
        });
        return { hourlyData, adjustments };
      })
    });
  }
});

