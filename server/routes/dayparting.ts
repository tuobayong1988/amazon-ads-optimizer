/**
 * 分时优化路由
 * 从 routers.ts 拆分的独立路由模块
 */
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as daypartingService from '../daypartingService';
import { eq, and, gte, lte, desc } from 'drizzle-orm';


// ==================== Dayparting Router ====================
export const daypartingRouter = router({
  // 获取账号的所有分时策略
  listStrategies: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .query(async ({ input }: any) => {
      return daypartingService.getDaypartingStrategies(input.accountId);
    }),

  // 获取单个策略详情
  getStrategy: protectedProcedure
    .input(z.object({ strategyId: z.number() }))
    .query(async ({ input }: any) => {
      const strategy = await daypartingService.getDaypartingStrategy(input.strategyId);
      if (!strategy) {
        throw new TRPCError({ code: "NOT_FOUND", message: "策略不存在" });
      }
      const budgetRules = await daypartingService.getBudgetRules(input.strategyId);
      const bidRules = await daypartingService.getBidRules(input.strategyId);
      return { strategy, budgetRules, bidRules };
    }),

  // 分析广告活动的每周表现
  analyzeWeeklyPerformance: protectedProcedure
    .input(z.object({
      campaignId: z.number(),
      lookbackDays: z.number().default(30),
    }))
    .query(async ({ input }: any) => {
      return daypartingService.analyzeWeeklyPerformance(input.campaignId, input.lookbackDays);
    }),

  // 分析广告活动的每小时表现
  analyzeHourlyPerformance: protectedProcedure
    .input(z.object({
      campaignId: z.number(),
      lookbackDays: z.number().default(30),
    }))
    .query(async ({ input }: any) => {
      return daypartingService.analyzeHourlyPerformance(input.campaignId, input.lookbackDays);
    }),

  // 一键生成最优策略
  generateOptimalStrategy: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      campaignId: z.number(),
      name: z.string(),
      optimizationGoal: z.enum(["maximize_sales", "target_acos", "target_roas", "minimize_acos"]),
      targetAcos: z.number().optional(),
      targetRoas: z.number().optional(),
      lookbackDays: z.number().default(30),
    }))
    .mutation(async ({ input }: any) => {
      return daypartingService.generateOptimalStrategy(input.accountId, input.campaignId, {
        name: input.name,
        optimizationGoal: input.optimizationGoal,
        targetAcos: input.targetAcos,
        targetRoas: input.targetRoas,
        lookbackDays: input.lookbackDays,
      });
    }),

  // 创建分时策略
  createStrategy: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      campaignId: z.number().optional(),
      name: z.string(),
      description: z.string().optional(),
      strategyType: z.enum(["budget", "bidding", "both"]).default("both"),
      optimizationGoal: z.enum(["maximize_sales", "target_acos", "target_roas", "minimize_acos"]).default("maximize_sales"),
      targetAcos: z.number().optional(),
      targetRoas: z.number().optional(),
      analysisLookbackDays: z.number().default(30),
      maxBudgetMultiplier: z.number().default(2.0),
      minBudgetMultiplier: z.number().default(0.2),
      maxBidMultiplier: z.number().default(2.0),
      minBidMultiplier: z.number().default(0.2),
    }))
    .mutation(async ({ input }: any) => {
      const strategyId = await daypartingService.createDaypartingStrategy({
        accountId: input.accountId,
        campaignId: input.campaignId as string,
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
        daypartingStatus: "draft",
      });
      return { strategyId };
    }),

  // 更新策略状态
  updateStrategyStatus: protectedProcedure
    .input(z.object({
      strategyId: z.number(),
      status: z.enum(["active", "paused", "draft"]),
    }))
    .mutation(async ({ input }: any) => {
      await daypartingService.updateDaypartingStrategy(input.strategyId, {
        daypartingStatus: input.status,
        lastAppliedAt: input.status === "active" ? new Date().toISOString() : undefined,
      });
      return { success: true };
    }),

  // 保存预算规则
  saveBudgetRules: protectedProcedure
    .input(z.object({
      strategyId: z.number(),
      rules: z.array(z.object({
        dayOfWeek: z.number().min(0).max(6),
        budgetMultiplier: z.number(),
        budgetPercentage: z.number().optional(),
        isEnabled: z.boolean().default(true),
      })),
    }))
    .mutation(async ({ input }: any) => {
      await daypartingService.saveBudgetRules(
        input.strategyId,
        // @ts-ignore
        input.rules.map(r => ({
          dayOfWeek: r.dayOfWeek,
          budgetMultiplier: r.budgetMultiplier.toString(),
          budgetPercentage: r.budgetPercentage?.toString(),
          isEnabled: r.isEnabled ? 1 : 0,
        }))
      );
      return { success: true };
    }),

  // 保存竞价规则
  saveBidRules: protectedProcedure
    .input(z.object({
      strategyId: z.number(),
      rules: z.array(z.object({
        dayOfWeek: z.number().min(0).max(6),
        hour: z.number().min(0).max(23),
        bidMultiplier: z.number(),
        isEnabled: z.boolean().default(true),
      })),
    }))
    .mutation(async ({ input }: any) => {
      await daypartingService.saveBidRules(
        input.strategyId,
        // @ts-ignore
        input.rules.map(r => ({
          dayOfWeek: r.dayOfWeek,
          hour: r.hour,
          bidMultiplier: r.bidMultiplier.toString(),
          isEnabled: r.isEnabled ? 1 : 0,
        }))
      );
      return { success: true };
    }),

  // 获取策略执行日志
  getExecutionLogs: protectedProcedure
    .input(z.object({
      strategyId: z.number(),
      limit: z.number().default(50),
    }))
    .query(async ({ input }: any) => {
      return daypartingService.getExecutionLogs(input.strategyId, input.limit);
    }),

  // 计算最优预算分配（不保存，仅预览）
  previewBudgetAllocation: protectedProcedure
    .input(z.object({
      campaignId: z.number(),
      optimizationGoal: z.enum(["maximize_sales", "target_acos", "target_roas", "minimize_acos"]),
      targetAcos: z.number().optional(),
      targetRoas: z.number().optional(),
      lookbackDays: z.number().default(30),
    }))
    .query(async ({ input }: any) => {
      const weeklyData = await daypartingService.analyzeWeeklyPerformance(
        input.campaignId,
        input.lookbackDays
      );
      const allocation = daypartingService.calculateOptimalBudgetAllocation(weeklyData, {
        optimizationGoal: input.optimizationGoal,
        targetAcos: input.targetAcos,
        targetRoas: input.targetRoas,
      });
      return { weeklyData, allocation };
    }),

  // 计算最优竞价调整（不保存，仅预览）
  previewBidAdjustments: protectedProcedure
    .input(z.object({
      campaignId: z.number(),
      optimizationGoal: z.enum(["maximize_sales", "target_acos", "target_roas", "minimize_acos"]),
      targetAcos: z.number().optional(),
      targetRoas: z.number().optional(),
      lookbackDays: z.number().default(30),
    }))
    .query(async ({ input }: any) => {
      const hourlyData = await daypartingService.analyzeHourlyPerformance(
        input.campaignId,
        input.lookbackDays
      );
      const adjustments = daypartingService.calculateOptimalBidAdjustments(hourlyData, {
        optimizationGoal: input.optimizationGoal,
        targetAcos: input.targetAcos,
        targetRoas: input.targetRoas,
      });
      return { hourlyData, adjustments };
    }),
});
