/**
 * A/B测试路由
 * 从 routers.ts 拆分的独立路由模块
 */
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as abTestService from '../abTestService';
import { eq, and, gte, lte, desc } from 'drizzle-orm';


// ==================== A/B测试路由 ====================
export const abTestRouter = router({
  // 创建A/B测试
  create: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      performanceGroupId: z.number().optional(),
      testName: z.string(),
      testDescription: z.string().optional(),
      testType: z.enum(['budget_allocation', 'bid_strategy', 'targeting']),
      targetMetric: z.enum(['roas', 'acos', 'conversions', 'revenue', 'profit']),
      minSampleSize: z.number().optional(),
      confidenceLevel: z.number().optional(),
      durationDays: z.number().optional(),
      controlConfig: z.record(z.string(), z.unknown()),
      treatmentConfig: z.record(z.string(), z.unknown()),
      trafficSplit: z.number().optional()
    }))
    .mutation(async ({ ctx, input }) => {
      return abTestService.createABTest({
        accountId: input.accountId,
        performanceGroupId: input.performanceGroupId,
        testName: input.testName,
        testDescription: input.testDescription,
        testType: input.testType,
        targetMetric: input.targetMetric,
        minSampleSize: input.minSampleSize,
        confidenceLevel: input.confidenceLevel,
        durationDays: input.durationDays,
        controlConfig: input.controlConfig as Record<string, unknown>,
        treatmentConfig: input.treatmentConfig as Record<string, unknown>,
        trafficSplit: input.trafficSplit,
      }, ctx.user.id);
    }),
  
  // 获取测试列表
  list: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .query(async ({ input }) => {
      return abTestService.getABTests(input.accountId);
    }),
  
  // 获取测试详情
  get: protectedProcedure
    .input(z.object({ testId: z.number() }))
    .query(async ({ input }) => {
      return abTestService.getABTestById(input.testId);
    }),
  
  // 分配广告活动到测试组
  assignCampaigns: protectedProcedure
    .input(z.object({
      testId: z.number(),
      campaignIds: z.array(z.number()),
      splitMethod: z.enum(['random', 'stratified', 'manual']).optional()
    }))
    .mutation(async ({ input }) => {
      return abTestService.assignCampaignsToTest(
        input.testId,
        input.campaignIds,
        input.splitMethod
      );
    }),
  
  // 启动测试
  start: protectedProcedure
    .input(z.object({
      testId: z.number(),
      durationDays: z.number().optional()
    }))
    .mutation(async ({ input }) => {
      await abTestService.startABTest(input.testId, input.durationDays);
      return { success: true };
    }),
  
  // 暂停测试
  pause: protectedProcedure
    .input(z.object({ testId: z.number() }))
    .mutation(async ({ input }) => {
      await abTestService.pauseABTest(input.testId);
      return { success: true };
    }),
  
  // 结束测试
  complete: protectedProcedure
    .input(z.object({ testId: z.number() }))
    .mutation(async ({ input }) => {
      await abTestService.completeABTest(input.testId);
      return { success: true };
    }),
  
  // 分析测试结果
  analyze: protectedProcedure
    .input(z.object({ testId: z.number() }))
    .query(async ({ input }) => {
      return abTestService.analyzeABTestResults(input.testId);
    }),
  
  // 删除测试
  delete: protectedProcedure
    .input(z.object({ testId: z.number() }))
    .mutation(async ({ input }) => {
      await abTestService.deleteABTest(input.testId);
      return { success: true };
    }),
});
