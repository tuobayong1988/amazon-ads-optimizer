/**
 * 特殊场景优化路由
 * 从 routers.ts 拆分的独立路由模块
 */
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as specialScenarioOptimizationService from '../analytics/specialScenarioOptimizationService';
import { verifyAccountAccess } from '../utils/accessControl';
import { apiCache } from '../services/apiCacheService';


// ==================== Special Scenario Optimization Router ====================
export const specialScenarioRouter = router({
  // 预算耗尽风险分析
  analyzeBudgetDepletionRisk: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .query(async ({ input, ctx }: any) => {
      await verifyAccountAccess(ctx.user.id, input.accountId);
      return specialScenarioOptimizationService.analyzeBudgetDepletionRisk(input.accountId);
    }),

  // 单个广告活动预算耗尽预测
  predictBudgetDepletion: protectedProcedure
    .input(z.object({
      campaignId: z.number(),
      currentSpend: z.number(),
      dailyBudget: z.number(),
      currentHour: z.number().optional(),
    }))
    .query(async ({ ctx, input }: any) => {
      return specialScenarioOptimizationService.predictBudgetDepletion(
        input.campaignId,
        input.currentSpend,
        input.dailyBudget,
        input.currentHour
      );
    }),

  // v386: 归因延迟调整后的近期数据（添加API缓存）
  getAttributionAdjustedData: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      days: z.number().optional(),
    }))
    .query(async ({ input, ctx }: any) => {
      await verifyAccountAccess(ctx.user.id, input.accountId);
      
      const cacheKey = apiCache.generateKey('specialScenario.getAttributionAdjustedData', ctx.user.id, input);
      const cached = apiCache.get<any>(cacheKey);
      if (cached) return cached;
      
      const result = await specialScenarioOptimizationService.adjustRecentPerformanceData(
        input.accountId,
        input.days || 7
      );
      
      apiCache.set(cacheKey, result, 5 * 60 * 1000); // 5分钟缓存
      return result;
    }),

  // 获取归因模型
  getAttributionModel: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .query(async ({ input, ctx }: any) => {
      await verifyAccountAccess(ctx.user.id, input.accountId);
      return specialScenarioOptimizationService.getAttributionModel(input.accountId);
    }),

  // 竞价效率分析
  analyzeBidEfficiency: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      targetAcos: z.number().optional(),
      profitMargin: z.number().optional(),
      minClicks: z.number().optional(),
    }))
    .query(async ({ input, ctx }: any) => {
      await verifyAccountAccess(ctx.user.id, input.accountId);
      return specialScenarioOptimizationService.analyzeBidEfficiency(
        input.accountId,
        input.targetAcos,
        input.profitMargin,
        input.minClicks
      );
    }),

  // 季节性调整策略
  getSeasonalStrategy: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      targetDate: z.string().optional(),
    }))
    .query(async ({ input, ctx }: any) => {
      await verifyAccountAccess(ctx.user.id, input.accountId);
      const date = input.targetDate ? new Date(input.targetDate) : new Date();
      return specialScenarioOptimizationService.generateSeasonalStrategy(
        input.accountId,
        date
      );
    }),

  // 学习季节性模式
  learnSeasonalPatterns: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      metric: z.enum(['sales', 'roas', 'spend']).optional(),
    }))
    .query(async ({ input, ctx }: any) => {
      await verifyAccountAccess(ctx.user.id, input.accountId);
      return specialScenarioOptimizationService.learnSeasonalPatterns(
        input.accountId,
        input.metric
      );
    }),

  // 大促渐进式调整计划
  getEventTransitionPlan: protectedProcedure
    .input(z.object({
      eventName: z.string(),
      eventDate: z.string(),
      baseBudget: z.number(),
      baseBid: z.number(),
    }))
    .query(async ({ ctx, input }: any) => {
      return specialScenarioOptimizationService.generateEventTransitionPlan(
        input.eventName,
        new Date(input.eventDate),
        input.baseBudget,
        input.baseBid
      );
    }),

  // 获取即将到来的大促事件
  getUpcomingEvents: protectedProcedure
    .input(z.object({ daysAhead: z.number().optional() }))
    .query(async ({ ctx, input }: any) => {
      return specialScenarioOptimizationService.getUpcomingPromotionalEvents(
        input.daysAhead || 30
      );
    }),

  // 综合特殊场景分析
  runFullAnalysis: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      targetAcos: z.number().optional(),
      profitMargin: z.number().optional(),
      minClicks: z.number().optional(),
    }))
    .query(async ({ input, ctx }: any) => {
      await verifyAccountAccess(ctx.user.id, input.accountId);
      return specialScenarioOptimizationService.runSpecialScenarioAnalysis(
        input.accountId,
        {
          targetAcos: input.targetAcos,
          profitMargin: input.profitMargin,
          minClicks: input.minClicks,
        }
      );
    }),
});
