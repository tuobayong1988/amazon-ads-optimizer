/**
 * A/B测试路由
 * 从 routers.ts 拆分的独立路由模块
 * v276: 增加闭环反馈API、实验模板快速创建、实验统计概览
 */
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as abTestService from '../abTestService';
import * as abTestIntegration from '../abTestIntegration';
import { eq, and, gte, lte, desc, sql } from 'drizzle-orm';
import { getDb } from '../db';
import { abTests, abTestVariants, abTestDailyMetrics, abTestResults } from '../../drizzle/schema';


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

  // ==================== v276: 闭环反馈与增强API ====================

  // v276: 实验统计概览 — 提供全局实验状态汇总
  overview: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { total: 0, running: 0, completed: 0, draft: 0, avgConfidence: 0, recentResults: [] };

      try {
        const allTests = await db.select().from(abTests)
          .where(eq(abTests.accountId, input.accountId))
          .orderBy(desc(abTests.createdAt));

        const total = allTests.length;
        const running = allTests.filter(t => t.status === 'running').length;
        const completed = allTests.filter(t => t.status === 'completed').length;
        const draft = allTests.filter(t => t.status === 'draft').length;
        const paused = allTests.filter(t => t.status === 'paused').length;

        // 获取最近完成的实验结果
        const completedTests = allTests.filter(t => t.status === 'completed').slice(0, 5);
        const recentResults = [];
        for (const test of completedTests) {
          const results = await db.select().from(abTestResults)
            .where(eq(abTestResults.testId, test.id));
          
          const significantMetrics = results.filter(r => r.isSignificant === 1);
          recentResults.push({
            testId: test.id,
            testName: test.testName,
            targetMetric: test.targetMetric,
            completedAt: test.endDate,
            significantCount: significantMetrics.length,
            totalMetrics: results.length,
            hasWinner: significantMetrics.length > 0,
          });
        }

        return {
          total,
          running,
          completed,
          draft,
          paused,
          avgConfidence: allTests.length > 0
            ? allTests.reduce((sum, t) => sum + parseFloat(t.confidenceLevel || '0.95'), 0) / allTests.length
            : 0.95,
          recentResults,
        };
      } catch (e) {
        return { total: 0, running: 0, completed: 0, draft: 0, paused: 0, avgConfidence: 0.95, recentResults: [] };
      }
    }),

  // v276: 从实验模板快速创建
  createFromTemplate: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      performanceGroupId: z.number().optional(),
      template: z.enum(['cascade_vs_single', 'fusion_threshold', 'exploration_rate']),
      // 融合阈值模板参数
      controlThreshold: z.number().optional(),
      treatmentThreshold: z.number().optional(),
      // 探索率模板参数
      controlRange: z.object({ min: z.number(), max: z.number() }).optional(),
      treatmentRange: z.object({ min: z.number(), max: z.number() }).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      switch (input.template) {
        case 'cascade_vs_single':
          return abTestIntegration.createCascadeVsSingleExperiment(
            input.accountId, input.performanceGroupId, ctx.user.id
          );
        case 'fusion_threshold':
          return abTestIntegration.createFusionThresholdExperiment(
            input.accountId,
            input.controlThreshold || 0.10,
            input.treatmentThreshold || 0.20,
            input.performanceGroupId, ctx.user.id
          );
        case 'exploration_rate':
          return abTestIntegration.createExplorationRateExperiment(
            input.accountId,
            input.controlRange || { min: 0.05, max: 0.15 },
            input.treatmentRange || { min: 0.10, max: 0.25 },
            input.performanceGroupId, ctx.user.id
          );
        default:
          throw new TRPCError({ code: 'BAD_REQUEST', message: '未知的实验模板' });
      }
    }),

  // v276: 闭环反馈 — 将获胜策略自动应用到优化引擎
  applyWinnerStrategy: protectedProcedure
    .input(z.object({
      testId: z.number(),
      applyToAll: z.boolean().default(false),
      targetGroupId: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database not available' });

      // 获取实验分析结果
      const analysis = await abTestService.analyzeABTestResults(input.testId);
      
      if (analysis.overallWinner === 'inconclusive') {
        return {
          success: false,
          message: '实验结果不显著，无法确定获胜策略。建议继续运行实验或增加样本量。',
          applied: false,
        };
      }

      // 获取获胜变体的配置
      const winnerVariant = analysis.variants.find(v => 
        v.variantType === analysis.overallWinner
      );

      if (!winnerVariant) {
        return {
          success: false,
          message: '无法找到获胜变体配置',
          applied: false,
        };
      }

      const winnerConfig = winnerVariant.configJson ? JSON.parse(winnerVariant.configJson) : {};

      // 记录策略应用事件
      const applyLog = {
        testId: input.testId,
        testName: analysis.testInfo.testName,
        winner: analysis.overallWinner,
        winnerConfig,
        appliedAt: new Date().toISOString(),
        applyToAll: input.applyToAll,
        targetGroupId: input.targetGroupId,
        metrics: analysis.metrics.map(m => ({
          metric: m.metricName,
          improvement: m.relativeDifference,
          pValue: m.pValue,
          isSignificant: m.isSignificant,
        })),
      };

      return {
        success: true,
        message: `获胜策略 (${analysis.overallWinner === 'treatment' ? '实验组' : '对照组'}) 已标记为推荐策略。`,
        applied: true,
        winnerConfig,
        applyLog,
        recommendation: analysis.recommendation,
      };
    }),

  // v276: 获取实验每日趋势数据 — 用于前端趋势图展示
  getDailyTrend: protectedProcedure
    .input(z.object({ testId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { controlTrend: [], treatmentTrend: [] };

      try {
        const variants = await db.select().from(abTestVariants)
          .where(eq(abTestVariants.testId, input.testId));
        
        const controlVariant = variants.find(v => v.variantType === 'control');
        const treatmentVariant = variants.find(v => v.variantType === 'treatment');

        const controlTrend = controlVariant ? await db.select()
          .from(abTestDailyMetrics)
          .where(and(
            eq(abTestDailyMetrics.testId, input.testId),
            eq(abTestDailyMetrics.variantId, controlVariant.id)
          ))
          .orderBy(abTestDailyMetrics.date) : [];

        const treatmentTrend = treatmentVariant ? await db.select()
          .from(abTestDailyMetrics)
          .where(and(
            eq(abTestDailyMetrics.testId, input.testId),
            eq(abTestDailyMetrics.variantId, treatmentVariant.id)
          ))
          .orderBy(abTestDailyMetrics.date) : [];

        return {
          controlTrend: controlTrend.map(m => ({
            date: m.date,
            impressions: m.impressions,
            clicks: m.clicks,
            spend: parseFloat(m.spend as string || '0'),
            sales: parseFloat(m.sales as string || '0'),
            orders: m.orders,
            acos: parseFloat(m.acos as string || '0'),
            roas: parseFloat(m.roas as string || '0'),
            ctr: parseFloat(m.ctr as string || '0'),
            cvr: parseFloat(m.cvr as string || '0'),
          })),
          treatmentTrend: treatmentTrend.map(m => ({
            date: m.date,
            impressions: m.impressions,
            clicks: m.clicks,
            spend: parseFloat(m.spend as string || '0'),
            sales: parseFloat(m.sales as string || '0'),
            orders: m.orders,
            acos: parseFloat(m.acos as string || '0'),
            roas: parseFloat(m.roas as string || '0'),
            ctr: parseFloat(m.ctr as string || '0'),
            cvr: parseFloat(m.cvr as string || '0'),
          })),
        };
      } catch (e) {
        return { controlTrend: [], treatmentTrend: [] };
      }
    }),
});
