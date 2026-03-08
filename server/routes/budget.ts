/**
 * 预算管理路由
 * 从 routers.ts 拆分的独立路由模块
 */
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as intelligentBudgetAllocationService from '../intelligentBudgetAllocationService';
import * as budgetAutoExecutionService from '../budgetAutoExecutionService';
import * as budgetAlertService from "../budgetAlertService";
import * as budgetTrackingService from "../budgetTrackingService";
import * as seasonalBudgetService from "../seasonalBudgetService";
import { eq, and, gte, lte, desc } from 'drizzle-orm';


// ==================== Budget Allocation Router ====================
export const budgetAllocationRouter = router({
  // 生成预算分配建议
  generateAllocation: protectedProcedure
    .input(z.object({
      accountId: z.number().nullable(),
      totalBudget: z.number().min(0),
      prioritizeHighRoas: z.boolean().optional(),
      prioritizeNewProducts: z.boolean().optional(),
      minCampaignBudget: z.number().optional(),
      maxCampaignBudget: z.number().optional(),
      targetRoas: z.number().optional(),
      targetAcos: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { generateBudgetAllocation } = await import("../budgetAllocationService");
      return generateBudgetAllocation(ctx.user.id, input.accountId, input.totalBudget, {
        prioritizeHighRoas: input.prioritizeHighRoas,
        prioritizeNewProducts: input.prioritizeNewProducts,
        minCampaignBudget: input.minCampaignBudget,
        maxCampaignBudget: input.maxCampaignBudget,
        targetRoas: input.targetRoas,
        targetAcos: input.targetAcos,
      });
    }),

  // 保存预算分配方案
  saveAllocation: protectedProcedure
    .input(z.object({
      accountId: z.number().nullable(),
      goalId: z.number().nullable(),
      allocationName: z.string().min(1),
      description: z.string(),
      result: z.unknown(), // AllocationResult
    }))
    .mutation(async ({ ctx, input }) => {
      const { saveBudgetAllocation } = await import("../budgetAllocationService");
      const allocationId = await saveBudgetAllocation(
        ctx.user.id,
        input.accountId,
        input.goalId,
        input.allocationName,
        input.description,
        // @ts-ignore
        input.result
      );
      return { allocationId };
    }),

  // 应用预算分配方案
  applyAllocation: protectedProcedure
    .input(z.object({
      allocationId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { applyBudgetAllocation } = await import("../budgetAllocationService");
      return applyBudgetAllocation(input.allocationId, ctx.user.id);
    }),

  // 获取预算分配历史
  getAllocationHistory: protectedProcedure
    .input(z.object({
      accountId: z.number().optional(),
      limit: z.number().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const { getBudgetAllocationHistory } = await import("../budgetAllocationService");
      return getBudgetAllocationHistory(ctx.user.id, input.accountId, input.limit);
    }),

  // 获取预算调整历史
  getBudgetHistory: protectedProcedure
    .input(z.object({
      accountId: z.number().optional(),
      campaignId: z.number().optional(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
      limit: z.number().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const { getBudgetHistory } = await import("../budgetAllocationService");
      return getBudgetHistory(ctx.user.id, input);
    }),

  // 创建预算目标
  createGoal: protectedProcedure
    .input(z.object({
      accountId: z.number().optional(),
      goalType: z.enum(["sales_target", "roas_target", "acos_target", "profit_target", "market_share"]),
      targetValue: z.number().min(0),
      periodType: z.enum(["daily", "weekly", "monthly", "quarterly"]).optional(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
      totalBudget: z.number().optional(),
      minCampaignBudget: z.number().optional(),
      maxCampaignBudget: z.number().optional(),
      prioritizeHighRoas: z.boolean().optional(),
      prioritizeNewProducts: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { createBudgetGoal } = await import("../budgetAllocationService");
      const goalId = await createBudgetGoal(ctx.user.id, input);
      return { goalId };
    }),

  // 获取预算目标列表
  getGoals: protectedProcedure
    .input(z.object({
      accountId: z.number().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const { getBudgetGoals } = await import("../budgetAllocationService");
      return getBudgetGoals(ctx.user.id, input.accountId);
    }),

  // 更新预算目标
  updateGoal: protectedProcedure
    .input(z.object({
      goalId: z.number(),
      targetValue: z.number().optional(),
      totalBudget: z.number().optional(),
      status: z.enum(["active", "paused", "completed", "expired"]).optional(),
    }))
    .mutation(async ({ input }: any) => {
      const { updateBudgetGoal } = await import("../budgetAllocationService");
      await updateBudgetGoal(input.goalId, {
        targetValue: input.targetValue,
        totalBudget: input.totalBudget,
        status: input.status,
      });
      return { success: true };
    }),

  // 删除预算目标
  deleteGoal: protectedProcedure
    .input(z.object({
      goalId: z.number(),
    }))
    .mutation(async ({ input }: any) => {
      const { deleteBudgetGoal } = await import("../budgetAllocationService");
      await deleteBudgetGoal(input.goalId);
      return { success: true };
    }),
});


export const budgetAlertRouter = router({
  // 获取预算预警设置
  getSettings: protectedProcedure
    .input(z.object({ accountId: z.number().optional() }))
    .query(async ({ ctx, input }) => {
      return budgetAlertService.getAlertSettings(ctx.user.id, input.accountId);
    }),

  // 保存预算预警设置
  saveSettings: protectedProcedure
    .input(z.object({
      accountId: z.number().optional(),
      fastConsumptionThreshold: z.number().min(100).max(500),
      slowConsumptionThreshold: z.number().min(10).max(100),
      checkInterval: z.number().min(1).max(24),
      notifyEmail: z.boolean(),
      notifyInApp: z.boolean(),
    }))
    .mutation(async ({ ctx, input }) => {
      return budgetAlertService.saveAlertSettings(ctx.user.id, input);
    }),

  // 获取预算消耗预警列表
  getAlerts: protectedProcedure
    .input(z.object({
      accountId: z.number().optional(),
      alertType: z.enum(["overspending", "underspending", "budget_depleted", "near_depletion"]).optional(),
      status: z.enum(["active", "acknowledged", "resolved"]).optional(),
      limit: z.number().default(50),
      offset: z.number().default(0),
    }))
    .query(async ({ ctx, input }) => {
      return budgetAlertService.getAlerts(ctx.user.id, input);
    }),

  // 确认预警
  acknowledgeAlert: protectedProcedure
    .input(z.object({ alertId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      return budgetAlertService.acknowledgeAlert(input.alertId, ctx.user.id);
    }),

  // 检查预算消耗
  checkConsumption: protectedProcedure
    .input(z.object({ accountId: z.number().optional() }))
    .mutation(async ({ ctx, input }) => {
      return budgetAlertService.runBudgetConsumptionCheck(ctx.user.id, input.accountId);
    }),
});


export const budgetTrackingRouter = router({
  // 创建效果追踪
  createTracking: protectedProcedure
    .input(z.object({
      allocationId: z.number(),
      trackingPeriodDays: z.number().default(14),
    }))
    .mutation(async ({ ctx, input }) => {
      const periodMap: Record<number, "7_days" | "14_days" | "30_days"> = { 7: "7_days", 14: "14_days", 30: "30_days" };
      const period = periodMap[input.trackingPeriodDays] || "14_days";
      return budgetTrackingService.createTracking(ctx.user.id, input.allocationId, period);
    }),

  // 获取追踪列表
  getTrackings: protectedProcedure
    .input(z.object({
      accountId: z.number().optional(),
      status: z.enum(["tracking", "completed", "cancelled"]).optional(),
      limit: z.number().default(20),
      offset: z.number().default(0),
    }))
    .query(async ({ ctx, input }) => {
      return budgetTrackingService.getTrackingList(ctx.user.id, input);
    }),

  // 获取追踪详情
  getTrackingDetail: protectedProcedure
    .input(z.object({ trackingId: z.number() }))
    .query(async ({ input }: any) => {
      return budgetTrackingService.getTrackingReport(input.trackingId);
    }),

  // 生成效果报告
  generateReport: protectedProcedure
    .input(z.object({ trackingId: z.number() }))
    .mutation(async ({ input }: any) => {
      return budgetTrackingService.updateTrackingMetrics(input.trackingId);
    }),
});


export const seasonalBudgetRouter = router({
  // 获取季节性建议
  getRecommendations: protectedProcedure
    .input(z.object({
      accountId: z.number().optional(),
      status: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      return seasonalBudgetService.getRecommendations(ctx.user.id, { accountId: input.accountId, status: input.status });
    }),

  // 生成季节性建议
  generateRecommendations: protectedProcedure
    .input(z.object({
      accountId: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const recommendations = await seasonalBudgetService.generateSeasonalRecommendations(ctx.user.id, input.accountId);
      await seasonalBudgetService.saveRecommendations(recommendations);
      return { success: true, count: recommendations.length, recommendations };
    }),

  // 应用建议
  applyRecommendation: protectedProcedure
    .input(z.object({ recommendationId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      return seasonalBudgetService.applyRecommendation(input.recommendationId, ctx.user.id);
    }),

  // 获取即将到来的促销活动
  getUpcomingEvents: protectedProcedure
    .input(z.object({ marketplace: z.string().optional() }))
    .query(async ({ input }: any) => {
      return seasonalBudgetService.getPromotionalEvents({ marketplace: input.marketplace, isActive: true });
    }),

  // 获取历史趋势数据
  getHistoricalTrends: protectedProcedure
    .input(z.object({
      accountId: z.number().optional(),
    }))
    .query(async ({ ctx, input }) => {
      return seasonalBudgetService.getSeasonalTrends(ctx.user.id, input.accountId);
    }),

  // 获取历史大促效果对比数据
  getEventPerformanceComparison: protectedProcedure
    .input(z.object({
      accountId: z.number().optional(),
      eventType: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      return seasonalBudgetService.getEventPerformanceComparison(ctx.user.id, {
        accountId: input.accountId,
        eventType: input.eventType,
      });
    }),

  // 获取大促活动效果汇总统计
  getEventSummaryStats: protectedProcedure
    .input(z.object({
      accountId: z.number().optional(),
    }))
    .query(async ({ ctx, input }) => {
      return seasonalBudgetService.getEventSummaryStats(ctx.user.id, {
        accountId: input.accountId,
      });
    }),
});


// ==================== Intelligent Budget Allocation Router ====================
export const intelligentBudgetAllocationRouter = router({
  // 获取绩效组的预算分配建议
  getSuggestions: protectedProcedure
    .input(z.object({
      performanceGroupId: z.number()
    }))
    .query(async ({ input }: any) => {
      return intelligentBudgetAllocationService.generateBudgetAllocationSuggestions(
        input.performanceGroupId
      );
    }),
  
  // 获取预算分配配置
  getConfig: protectedProcedure
    .input(z.object({
      performanceGroupId: z.number()
    }))
    .query(async ({ input }: any) => {
      return intelligentBudgetAllocationService.getBudgetAllocationConfig(
        input.performanceGroupId
      );
    }),
  
  // 更新预算分配配置
  updateConfig: protectedProcedure
    .input(z.object({
      performanceGroupId: z.number(),
      conversionEfficiencyWeight: z.number().optional(),
      roasWeight: z.number().optional(),
      growthPotentialWeight: z.number().optional(),
      stabilityWeight: z.number().optional(),
      trendWeight: z.number().optional(),
      maxAdjustmentPercent: z.number().optional(),
      minDailyBudget: z.number().optional(),
      cooldownDays: z.number().optional(),
      newCampaignProtectionDays: z.number().optional()
    }))
    .mutation(async ({ ctx, input }) => {
      const { performanceGroupId, ...updates } = input;
      await intelligentBudgetAllocationService.updateBudgetAllocationConfig(
        performanceGroupId,
        ctx.user.id,
        updates
      );
      return { success: true };
    }),
  
  // 模拟预算调整效果
  simulateScenario: protectedProcedure
    .input(z.object({
      performanceGroupId: z.number(),
      campaignId: z.number(),
      newBudget: z.number()
    }))
    .query(async ({ input }: any) => {
      const campaigns = await intelligentBudgetAllocationService.collectCampaignPerformanceData(
        input.performanceGroupId
      );
      const campaign = campaigns.find(c => c.campaignId === input.campaignId);
      if (!campaign) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '广告活动不存在' });
      }
      return intelligentBudgetAllocationService.simulateBudgetScenario(
        campaign,
        input.newBudget
      );
    }),
  
  // 应用预算分配建议
  applySuggestions: protectedProcedure
    .input(z.object({
      suggestionIds: z.array(z.number())
    }))
    .mutation(async ({ ctx, input }) => {
      return intelligentBudgetAllocationService.applyBudgetAllocationSuggestions(
        input.suggestionIds,
        ctx.user.id
      );
    }),
  
  // 获取广告活动表现数据
  getCampaignPerformance: protectedProcedure
    .input(z.object({
      performanceGroupId: z.number()
    }))
    .query(async ({ input }: any) => {
      return intelligentBudgetAllocationService.collectCampaignPerformanceData(
        input.performanceGroupId
      );
    }),
});


// ==================== 预算自动执行路由 ====================
export const budgetAutoExecutionRouter = router({
  // 创建自动执行配置
  createConfig: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      performanceGroupId: z.number().optional(),
      configName: z.string(),
      isEnabled: z.boolean().optional(),
      executionFrequency: z.enum(['daily', 'weekly', 'biweekly', 'monthly']),
      executionTime: z.string().optional(),
      executionDayOfWeek: z.number().optional(),
      executionDayOfMonth: z.number().optional(),
      minDataDays: z.number().optional(),
      maxAdjustmentPercent: z.number().optional(),
      minBudget: z.number().optional(),
      requireApproval: z.boolean().optional(),
      notifyOnExecution: z.boolean().optional(),
      notifyOnError: z.boolean().optional()
    }))
    .mutation(async ({ ctx, input }) => {
      const configId = await budgetAutoExecutionService.createAutoExecutionConfig(
        input,
        ctx.user.id
      );
      return { configId };
    }),
  
  // 更新自动执行配置
  updateConfig: protectedProcedure
    .input(z.object({
      configId: z.number(),
      configName: z.string().optional(),
      isEnabled: z.boolean().optional(),
      executionFrequency: z.enum(['daily', 'weekly', 'biweekly', 'monthly']).optional(),
      executionTime: z.string().optional(),
      executionDayOfWeek: z.number().optional(),
      executionDayOfMonth: z.number().optional(),
      minDataDays: z.number().optional(),
      maxAdjustmentPercent: z.number().optional(),
      minBudget: z.number().optional(),
      requireApproval: z.boolean().optional(),
      notifyOnExecution: z.boolean().optional(),
      notifyOnError: z.boolean().optional()
    }))
    .mutation(async ({ input }: any) => {
      const { configId, ...updates } = input;
      await budgetAutoExecutionService.updateAutoExecutionConfig(configId, updates);
      return { success: true };
    }),
  
  // 删除自动执行配置
  deleteConfig: protectedProcedure
    .input(z.object({ configId: z.number() }))
    .mutation(async ({ input }: any) => {
      await budgetAutoExecutionService.deleteAutoExecutionConfig(input.configId);
      return { success: true };
    }),
  
  // 获取自动执行配置列表
  listConfigs: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .query(async ({ input }: any) => {
      return budgetAutoExecutionService.getAutoExecutionConfigs(input.accountId);
    }),
  
  // 获取单个配置
  getConfig: protectedProcedure
    .input(z.object({ configId: z.number() }))
    .query(async ({ input }: any) => {
      return budgetAutoExecutionService.getAutoExecutionConfigById(input.configId);
    }),
  
  // 手动触发执行
  triggerExecution: protectedProcedure
    .input(z.object({ configId: z.number() }))
    .mutation(async ({ input }: any) => {
      return budgetAutoExecutionService.triggerManualExecution(input.configId);
    }),
  
  // 获取执行历史
  getHistory: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      limit: z.number().optional()
    }))
    .query(async ({ input }: any) => {
      return budgetAutoExecutionService.getExecutionHistory(
        input.accountId,
        input.limit
      );
    }),
  
  // 获取执行详情
  getExecutionDetails: protectedProcedure
    .input(z.object({ executionId: z.number() }))
    .query(async ({ input }: any) => {
      return budgetAutoExecutionService.getExecutionDetails(input.executionId);
    }),
  
  // 审批执行
  approveExecution: protectedProcedure
    .input(z.object({
      executionId: z.number(),
      approve: z.boolean()
    }))
    .mutation(async ({ ctx, input }) => {
      await budgetAutoExecutionService.approveExecution(
        input.executionId,
        ctx.user.id,
        input.approve
      );
      return { success: true };
    }),
});
