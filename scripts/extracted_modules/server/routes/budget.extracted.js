// Extracted from production dist/index.js
// Original module: server/routes/budget.ts
// Lines: 417

var budgetAllocationRouter, budgetAlertRouter, budgetTrackingRouter, seasonalBudgetRouter, intelligentBudgetAllocationRouter, budgetAutoExecutionRouter;
var init_budget = __esm({
  "server/routes/budget.ts"() {
    "use strict";
    init_trpc();
    init_zod();
    init_dist();
    init_accessControl();
    init_intelligentBudgetAllocationService();
    init_budgetAutoExecutionService();
    init_budgetAlertService();
    init_budgetTrackingService();
    init_seasonalBudgetService();
    budgetAllocationRouter = router({
      // 生成预算分配建议
      generateAllocation: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number().nullable(),
        totalBudget: external_exports.number().min(0),
        prioritizeHighRoas: external_exports.boolean().optional(),
        prioritizeNewProducts: external_exports.boolean().optional(),
        minCampaignBudget: external_exports.number().optional(),
        maxCampaignBudget: external_exports.number().optional(),
        targetRoas: external_exports.number().optional(),
        targetAcos: external_exports.number().optional()
      })).mutation(async ({ ctx, input }) => {
        const { generateBudgetAllocation: generateBudgetAllocation2 } = await Promise.resolve().then(() => (init_budgetAllocationService(), budgetAllocationService_exports));
        return generateBudgetAllocation2(ctx.user.id, input.accountId, input.totalBudget, {
          prioritizeHighRoas: input.prioritizeHighRoas,
          prioritizeNewProducts: input.prioritizeNewProducts,
          minCampaignBudget: input.minCampaignBudget,
          maxCampaignBudget: input.maxCampaignBudget,
          targetRoas: input.targetRoas,
          targetAcos: input.targetAcos
        });
      }),
      // 保存预算分配方案
      saveAllocation: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number().nullable(),
        goalId: external_exports.number().nullable(),
        allocationName: external_exports.string().min(1),
        description: external_exports.string(),
        result: external_exports.unknown()
        // AllocationResult
      })).mutation(async ({ ctx, input }) => {
        const { saveBudgetAllocation: saveBudgetAllocation2 } = await Promise.resolve().then(() => (init_budgetAllocationService(), budgetAllocationService_exports));
        const allocationId = await saveBudgetAllocation2(
          ctx.user.id,
          input.accountId,
          input.goalId,
          input.allocationName,
          input.description,
          // @ts-expect-error - runtime type mismatch
          input.result
        );
        return { allocationId };
      }),
      // 应用预算分配方案
      applyAllocation: protectedProcedure.input(external_exports.object({
        allocationId: external_exports.number()
      })).mutation(async ({ ctx, input }) => {
        const { applyBudgetAllocation: applyBudgetAllocation2 } = await Promise.resolve().then(() => (init_budgetAllocationService(), budgetAllocationService_exports));
        return applyBudgetAllocation2(input.allocationId, ctx.user.id);
      }),
      // 获取预算分配历史
      getAllocationHistory: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number().optional(),
        limit: external_exports.number().optional()
      })).query(async ({ ctx, input }) => {
        const { getBudgetAllocationHistory: getBudgetAllocationHistory2 } = await Promise.resolve().then(() => (init_budgetAllocationService(), budgetAllocationService_exports));
        return getBudgetAllocationHistory2(ctx.user.id, input.accountId, input.limit);
      }),
      // 获取预算调整历史
      getBudgetHistory: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number().optional(),
        campaignId: external_exports.number().optional(),
        startDate: external_exports.date().optional(),
        endDate: external_exports.date().optional(),
        limit: external_exports.number().optional()
      })).query(async ({ ctx, input }) => {
        const { getBudgetHistory: getBudgetHistory2 } = await Promise.resolve().then(() => (init_budgetAllocationService(), budgetAllocationService_exports));
        return getBudgetHistory2(ctx.user.id, input);
      }),
      // 创建预算目标
      createGoal: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number().optional(),
        goalType: external_exports.enum(["sales_target", "roas_target", "acos_target", "profit_target", "market_share"]),
        targetValue: external_exports.number().min(0),
        periodType: external_exports.enum(["daily", "weekly", "monthly", "quarterly"]).optional(),
        startDate: external_exports.date().optional(),
        endDate: external_exports.date().optional(),
        totalBudget: external_exports.number().optional(),
        minCampaignBudget: external_exports.number().optional(),
        maxCampaignBudget: external_exports.number().optional(),
        prioritizeHighRoas: external_exports.boolean().optional(),
        prioritizeNewProducts: external_exports.boolean().optional()
      })).mutation(async ({ ctx, input }) => {
        const { createBudgetGoal: createBudgetGoal2 } = await Promise.resolve().then(() => (init_budgetAllocationService(), budgetAllocationService_exports));
        const goalId = await createBudgetGoal2(ctx.user.id, input);
        return { goalId };
      }),
      // 获取预算目标列表
      getGoals: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number().optional()
      })).query(async ({ ctx, input }) => {
        const { getBudgetGoals: getBudgetGoals2 } = await Promise.resolve().then(() => (init_budgetAllocationService(), budgetAllocationService_exports));
        return getBudgetGoals2(ctx.user.id, input.accountId);
      }),
      // 更新预算目标
      updateGoal: protectedProcedure.input(external_exports.object({
        goalId: external_exports.number(),
        targetValue: external_exports.number().optional(),
        totalBudget: external_exports.number().optional(),
        status: external_exports.enum(["active", "paused", "completed", "expired"]).optional()
      })).mutation(async ({ ctx, input }) => {
        const { updateBudgetGoal: updateBudgetGoal2 } = await Promise.resolve().then(() => (init_budgetAllocationService(), budgetAllocationService_exports));
        await updateBudgetGoal2(input.goalId, {
          targetValue: input.targetValue,
          totalBudget: input.totalBudget,
          status: input.status
        });
        return { success: true };
      }),
      // 删除预算目标
      deleteGoal: protectedProcedure.input(external_exports.object({
        goalId: external_exports.number()
        // @ts-ignore
      })).mutation(async ({ ctx, input }) => {
        const { deleteBudgetGoal: deleteBudgetGoal2 } = await Promise.resolve().then(() => (init_budgetAllocationService(), budgetAllocationService_exports));
        await deleteBudgetGoal2(input.goalId);
        return { success: true };
      })
    });
    budgetAlertRouter = router({
      // 获取预算预警设置
      getSettings: protectedProcedure.input(external_exports.object({ accountId: external_exports.number().optional() })).query(async ({ ctx, input }) => {
        return getAlertSettings(ctx.user.id, input.accountId);
      }),
      // 保存预算预警设置
      saveSettings: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number().optional(),
        fastConsumptionThreshold: external_exports.number().min(100).max(500),
        slowConsumptionThreshold: external_exports.number().min(10).max(100),
        checkInterval: external_exports.number().min(1).max(24),
        notifyEmail: external_exports.boolean(),
        notifyInApp: external_exports.boolean()
      })).mutation(async ({ ctx, input }) => {
        return saveAlertSettings(ctx.user.id, input);
      }),
      // 获取预算消耗预警列表
      getAlerts: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number().optional(),
        alertType: external_exports.enum(["overspending", "underspending", "budget_depleted", "near_depletion"]).optional(),
        status: external_exports.enum(["active", "acknowledged", "resolved"]).optional(),
        limit: external_exports.number().default(50),
        offset: external_exports.number().default(0)
      })).query(async ({ ctx, input }) => {
        return getAlerts(ctx.user.id, input);
      }),
      // 确认预警
      acknowledgeAlert: protectedProcedure.input(external_exports.object({ alertId: external_exports.number() })).mutation(async ({ ctx, input }) => {
        return acknowledgeAlert(input.alertId, ctx.user.id);
      }),
      // 检查预算消耗
      checkConsumption: protectedProcedure.input(external_exports.object({ accountId: external_exports.number().optional() })).mutation(async ({ ctx, input }) => {
        return runBudgetConsumptionCheck(ctx.user.id, input.accountId);
      })
    });
    budgetTrackingRouter = router({
      // 创建效果追踪
      createTracking: protectedProcedure.input(external_exports.object({
        allocationId: external_exports.number(),
        trackingPeriodDays: external_exports.number().default(14)
      })).mutation(async ({ ctx, input }) => {
        const periodMap = { 7: "7_days", 14: "14_days", 30: "30_days" };
        const period = periodMap[input.trackingPeriodDays] || "14_days";
        return createTracking(ctx.user.id, input.allocationId, period);
      }),
      // 获取追踪列表
      getTrackings: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number().optional(),
        status: external_exports.enum(["tracking", "completed", "cancelled"]).optional(),
        limit: external_exports.number().default(20),
        offset: external_exports.number().default(0)
      })).query(async ({ ctx, input }) => {
        return getTrackingList(ctx.user.id, input);
      }),
      // 获取追踪详情
      // @ts-ignore
      getTrackingDetail: protectedProcedure.input(external_exports.object({ trackingId: external_exports.number() })).query(async ({ ctx, input }) => {
        return getTrackingReport(input.trackingId);
      }),
      // 生成效果报告
      generateReport: protectedProcedure.input(external_exports.object({ trackingId: external_exports.number() })).mutation(async ({ ctx, input }) => {
        return updateTrackingMetrics(input.trackingId);
      })
    });
    seasonalBudgetRouter = router({
      // 获取季节性建议
      getRecommendations: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number().optional(),
        status: external_exports.string().optional()
      })).query(async ({ ctx, input }) => {
        return getRecommendations(ctx.user.id, { accountId: input.accountId, status: input.status });
      }),
      // 生成季节性建议
      generateRecommendations: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number().optional()
      })).mutation(async ({ ctx, input }) => {
        const recommendations = await generateSeasonalRecommendations(ctx.user.id, input.accountId);
        await saveRecommendations(recommendations);
        return { success: true, count: recommendations.length, recommendations };
      }),
      // 应用建议
      applyRecommendation: protectedProcedure.input(external_exports.object({ recommendationId: external_exports.number() })).mutation(async ({ ctx, input }) => {
        return applyRecommendation(input.recommendationId, ctx.user.id);
      }),
      // 获取即将到来的促销活动
      getUpcomingEvents: protectedProcedure.input(external_exports.object({ marketplace: external_exports.string().optional() })).query(async ({ ctx, input }) => {
        return getPromotionalEvents({ marketplace: input.marketplace, isActive: true });
      }),
      // 获取历史趋势数据
      getHistoricalTrends: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number().optional()
      })).query(async ({ ctx, input }) => {
        return getSeasonalTrends(ctx.user.id, input.accountId);
      }),
      // 获取历史大促效果对比数据
      getEventPerformanceComparison: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number().optional(),
        eventType: external_exports.string().optional()
      })).query(async ({ ctx, input }) => {
        return getEventPerformanceComparison(ctx.user.id, {
          accountId: input.accountId,
          eventType: input.eventType
        });
      }),
      // 获取大促活动效果汇总统计
      getEventSummaryStats: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number().optional()
      })).query(async ({ ctx, input }) => {
        return getEventSummaryStats(ctx.user.id, {
          accountId: input.accountId
        });
      })
    });
    intelligentBudgetAllocationRouter = router({
      // 获取绩效组的预算分配建议
      getSuggestions: protectedProcedure.input(external_exports.object({
        performanceGroupId: external_exports.number()
      })).query(async ({ ctx, input }) => {
        return generateBudgetAllocationSuggestions(
          input.performanceGroupId
        );
      }),
      // 获取预算分配配置
      getConfig: protectedProcedure.input(external_exports.object({
        performanceGroupId: external_exports.number()
      })).query(async ({ ctx, input }) => {
        return getBudgetAllocationConfig(
          input.performanceGroupId
        );
      }),
      // 更新预算分配配置
      updateConfig: protectedProcedure.input(external_exports.object({
        performanceGroupId: external_exports.number(),
        conversionEfficiencyWeight: external_exports.number().optional(),
        roasWeight: external_exports.number().optional(),
        growthPotentialWeight: external_exports.number().optional(),
        stabilityWeight: external_exports.number().optional(),
        trendWeight: external_exports.number().optional(),
        maxAdjustmentPercent: external_exports.number().optional(),
        minDailyBudget: external_exports.number().optional(),
        cooldownDays: external_exports.number().optional(),
        newCampaignProtectionDays: external_exports.number().optional()
      })).mutation(async ({ ctx, input }) => {
        const { performanceGroupId: performanceGroupId2, ...updates } = input;
        await updateBudgetAllocationConfig(
          performanceGroupId2,
          ctx.user.id,
          updates
        );
        return { success: true };
      }),
      // 模拟预算调整效果
      simulateScenario: protectedProcedure.input(external_exports.object({
        performanceGroupId: external_exports.number(),
        campaignId: external_exports.number(),
        newBudget: external_exports.number()
      })).query(async ({ ctx, input }) => {
        const campaigns6 = await collectCampaignPerformanceData(
          input.performanceGroupId
        );
        const campaign = campaigns6.find((c) => c.campaignId === input.campaignId);
        if (!campaign) {
          throw new TRPCError({ code: "NOT_FOUND", message: "\u5E7F\u544A\u6D3B\u52A8\u4E0D\u5B58\u5728" });
        }
        return simulateBudgetScenario(
          campaign,
          input.newBudget
        );
      }),
      // 应用预算分配建议
      applySuggestions: protectedProcedure.input(external_exports.object({
        suggestionIds: external_exports.array(external_exports.number())
      })).mutation(async ({ ctx, input }) => {
        return applyBudgetAllocationSuggestions(
          input.suggestionIds,
          ctx.user.id
          // @ts-ignore
        );
      }),
      // 获取广告活动表现数据
      getCampaignPerformance: protectedProcedure.input(external_exports.object({
        performanceGroupId: external_exports.number()
      })).query(async ({ ctx, input }) => {
        return collectCampaignPerformanceData(
          input.performanceGroupId
        );
      })
    });
    budgetAutoExecutionRouter = router({
      // 创建自动执行配置
      createConfig: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        performanceGroupId: external_exports.number().optional(),
        configName: external_exports.string(),
        isEnabled: external_exports.boolean().optional(),
        executionFrequency: external_exports.enum(["daily", "weekly", "biweekly", "monthly"]),
        executionTime: external_exports.string().optional(),
        executionDayOfWeek: external_exports.number().optional(),
        executionDayOfMonth: external_exports.number().optional(),
        minDataDays: external_exports.number().optional(),
        maxAdjustmentPercent: external_exports.number().optional(),
        minBudget: external_exports.number().optional(),
        requireApproval: external_exports.boolean().optional(),
        notifyOnExecution: external_exports.boolean().optional(),
        notifyOnError: external_exports.boolean().optional()
      })).mutation(async ({ ctx, input }) => {
        const configId = await createAutoExecutionConfig(
          input,
          ctx.user.id
        );
        return { configId };
      }),
      // 更新自动执行配置
      updateConfig: protectedProcedure.input(external_exports.object({
        configId: external_exports.number(),
        configName: external_exports.string().optional(),
        isEnabled: external_exports.boolean().optional(),
        executionFrequency: external_exports.enum(["daily", "weekly", "biweekly", "monthly"]).optional(),
        executionTime: external_exports.string().optional(),
        // @ts-ignore
        executionDayOfWeek: external_exports.number().optional(),
        executionDayOfMonth: external_exports.number().optional(),
        minDataDays: external_exports.number().optional(),
        maxAdjustmentPercent: external_exports.number().optional(),
        minBudget: external_exports.number().optional(),
        requireApproval: external_exports.boolean().optional(),
        notifyOnExecution: external_exports.boolean().optional(),
        notifyOnError: external_exports.boolean().optional()
      })).mutation(async ({ ctx, input }) => {
        const { configId, ...updates } = input;
        await updateAutoExecutionConfig(configId, updates);
        return { success: true };
      }),
      // 删除自动执行配置
      deleteConfig: protectedProcedure.input(external_exports.object({ configId: external_exports.number() })).mutation(async ({ ctx, input }) => {
        await deleteAutoExecutionConfig(input.configId);
        return { success: true };
      }),
      // 获取自动执行配置列表
      // @ts-ignore
      listConfigs: protectedProcedure.input(external_exports.object({ accountId: external_exports.number() })).query(async ({ ctx, input }) => {
        if (input.accountId) await verifyAccountAccess(ctx.user.id, input.accountId);
        return getAutoExecutionConfigs(input.accountId);
      }),
      // 获取单个配置
      getConfig: protectedProcedure.input(external_exports.object({ configId: external_exports.number() })).query(async ({ ctx, input }) => {
        return getAutoExecutionConfigById(input.configId);
      }),
      // 手动触发执行
      // @ts-ignore
      triggerExecution: protectedProcedure.input(external_exports.object({ configId: external_exports.number() })).mutation(async ({ ctx, input }) => {
        return triggerManualExecution(input.configId);
      }),
      // 获取执行历史
      getHistory: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        // @ts-ignore
        limit: external_exports.number().optional()
      })).query(async ({ ctx, input }) => {
        if (input.accountId) await verifyAccountAccess(ctx.user.id, input.accountId);
        return getExecutionHistory(
          input.accountId,
          input.limit
        );
      }),
      // 获取执行详情
      getExecutionDetails: protectedProcedure.input(external_exports.object({ executionId: external_exports.number() })).query(async ({ ctx, input }) => {
        return getExecutionDetails(input.executionId);
      }),
      // 审批执行
      approveExecution: protectedProcedure.input(external_exports.object({
        executionId: external_exports.number(),
        approve: external_exports.boolean()
      })).mutation(async ({ ctx, input }) => {
        await approveExecution(
          input.executionId,
          ctx.user.id,
          input.approve
        );
        return { success: true };
      })
    });
  }
});

