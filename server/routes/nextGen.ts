/**
 * 下一代算法路由
 * 从 routers.ts 拆分的独立路由模块
 * v275: 扩展因果推断详情、CQL模型状态、竞争环境感知和预算分池查询API
 */
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as causalInferenceEngine from '../algorithm/causalInferenceEngine';
import * as keywordGraphService from '../analytics/keywordGraphService';
import { eq, and, gte, lte, desc, sql, count } from 'drizzle-orm';
import { ensureNextGenTables } from '../optimization/nextGenMigration';
import { getDb } from '../db';
import { verifyAccountAccess } from '../utils/accessControl';
import { causalInferenceResults, cqlModels, optimizationEvents } from '../../drizzle/schema';


export const nextGenRouter = router({
  // 初始化NextGen数据库表（仅在首次部署时使用一次，后续部署自动执行）
  ensureTables: protectedProcedure
    .mutation(async () => {
      return ensureNextGenTables();
    }),

  // 获取NextGen算法系统状态
  getStatus: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .query(async ({ input, ctx }: unknown) => {
      await verifyAccountAccess(ctx.user.id, input.accountId);
      return {
        version: 'v276',
        engineMode: 'unified',
        description: 'NextGen统一出价引擎，100%覆盖所有关键词和商品定向',
        algorithmTiers: {
          advanced: ['sigmoid_curve', 'linucb', 'cql', 'ensemble'],
          ruleEngine: ['acos_based', 'exploration', 'protection'],
          conservative: ['hold_current_bid'],
        },
        automatedTasks: {
          maintenance: '每4小时自动执行（特征缓存/Sigmoid拟合/Reward回填/因果分析）',
          modelTraining: '每6小时自动执行（CQL离线强化学习）',
          budgetOptimization: '每日凌晨2:00自动执行（预算组合优化+关键词图谱）',
        },
        status: 'active',
      };
    }),
  
  // 查询因果推断分析结果（只读查询，分析由定时任务自动执行）
  getCausalAnalysis: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .query(async ({ input, ctx }: unknown) => {
      await verifyAccountAccess(ctx.user.id, input.accountId);
      return causalInferenceEngine.batchCausalAnalysis(input.accountId);
    }),

  // v275: 查询因果推断详细结果 — 用于前端因果推断可视化模块
  getCausalInsights: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      days: z.number().default(30),
      limit: z.number().default(50),
    }))
    .query(async ({ input, ctx }: unknown) => {
      await verifyAccountAccess(ctx.user.id, input.accountId);
      const db = await getDb();
      if (!db) return { results: [], summary: { total: 0, significant: 0, avgUplift: 0, totalIncrementalProfit: 0 } };
      
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - input.days);
      const startDateStr = startDate.toISOString().split('T')[0];
      
      try {
        // 查询因果推断详细结果
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
          modelVersion: causalInferenceResults.modelVersion,
        })
        .from(causalInferenceResults)
        .where(and(
          eq(causalInferenceResults.accountId, input.accountId),
          gte(causalInferenceResults.analysisDate, startDateStr),
        ))
        .orderBy(desc(causalInferenceResults.analysisDate))
        .limit(input.limit);

        // 计算汇总统计
        const total = results.length;
        const significant = results.filter(r => 
          Math.abs(parseFloat(r.upliftScore as string || '0')) > 0.05 &&
          parseFloat(r.confidenceInterval as string || '1') < 0.5
        ).length;
        const avgUplift = total > 0 
          ? results.reduce((sum: number, r: Record<string, unknown>) => sum + parseFloat(r.upliftScore as string || '0'), 0) / total 
          : 0;
        const totalIncrementalProfit = results.reduce(
          (sum, r) => sum + parseFloat(r.incrementalProfit as string || '0'), 0
        );

        return {
          results: results.map(r => ({
            ...r,
            upliftScore: parseFloat(r.upliftScore as string || '0'),
            confidenceInterval: parseFloat(r.confidenceInterval as string || '0'),
            incrementalRevenue: parseFloat(r.incrementalRevenue as string || '0'),
            incrementalCost: parseFloat(r.incrementalCost as string || '0'),
            incrementalProfit: parseFloat(r.incrementalProfit as string || '0'),
            incrementalRoas: parseFloat(r.incrementalRoas as string || '0'),
            optimalBid: parseFloat(r.optimalBid as string || '0'),
            optimalBidLower: parseFloat(r.optimalBidLower as string || '0'),
            optimalBidUpper: parseFloat(r.optimalBidUpper as string || '0'),
            treatmentCvr: parseFloat(r.treatmentCvr as string || '0'),
            controlCvr: parseFloat(r.controlCvr as string || '0'),
          })),
          summary: {
            total,
            significant,
            avgUplift: Math.round(avgUplift * 10000) / 10000,
            totalIncrementalProfit: Math.round(totalIncrementalProfit * 100) / 100,
          },
        };
      } catch (e) {
        return { results: [], summary: { total: 0, significant: 0, avgUplift: 0, totalIncrementalProfit: 0 } };
      }
    }),

  // v275: 查询CQL模型训练状态 — 用于前端CQL训练效果监控
  getCqlModelStatus: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .query(async ({ input, ctx }: unknown) => {
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
          updatedAt: cqlModels.updatedAt,
        })
        .from(cqlModels)
        .where(eq(cqlModels.accountId, input.accountId))
        .orderBy(desc(cqlModels.updatedAt))
        .limit(10);

        const totalModels = models.length;
        const avgTrainingSteps = totalModels > 0
          ? models.reduce((sum: number, m: Record<string, unknown>) => sum + (m.trainingSteps || 0), 0) / totalModels
          : 0;
        const latestTrainedAt = models.length > 0 ? models[0].lastTrainedAt : null;

        return {
          models: models.map(m => ({
            ...m,
            avgLoss: parseFloat(m.avgLoss as string || '0'),
          })),
          summary: {
            totalModels,
            avgTrainingSteps: Math.round(avgTrainingSteps),
            latestTrainedAt,
          },
        };
      } catch (e) {
        return { models: [], summary: { totalModels: 0, avgTrainingSteps: 0, latestTrainedAt: null } };
      }
    }),

  // v275: 查询竞争环境感知状态 — 用于前端竞争环境展示
  getCompetitionInsights: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      days: z.number().default(7),
    }))
    .query(async ({ input, ctx }: unknown) => {
      await verifyAccountAccess(ctx.user.id, input.accountId);
      const db = await getDb();
      if (!db) return { distribution: [], recentTrend: [], summary: { avgCompetition: 'medium', dominantType: 'neutral' } };
      
      try {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - input.days);
        const startDateStr = startDate.toISOString().split('T')[0];

        // 从optimization_events中提取竞争环境信息（存储在performanceData JSON中）
        const events = await db.select({
          performanceData: optimizationEvents.performanceData,
          createdAt: optimizationEvents.createdAt,
        })
        .from(optimizationEvents)
        .where(and(
          eq(optimizationEvents.accountId, input.accountId),
          gte(optimizationEvents.createdAt, startDateStr),
        ))
        .orderBy(desc(optimizationEvents.createdAt))
        .limit(500);

        // 解析竞争环境分布
        const competitionCounts: Record<string, number> = { aggressive: 0, tight: 0, passive: 0, neutral: 0 };
        const dailyCompetition: Record<string, { aggressive: number; tight: number; passive: number; neutral: number; total: number }> = {};

        for (const event of events) {
          const perfData = event.performanceData as Record<string, unknown>;
          if (!perfData) continue;
          
          // 从performanceData中提取GTO竞争分类
          const competitionType = perfData?.gto?.competitorType || perfData?.competitorType || 'neutral';
          const normalizedType = ['aggressive', 'tight', 'passive', 'neutral'].includes(competitionType) 
            ? competitionType : 'neutral';
          competitionCounts[normalizedType]++;

          const dateKey = event.createdAt ? event.createdAt.split(' ')[0] : 'unknown';
          if (!dailyCompetition[dateKey]) {
            dailyCompetition[dateKey] = { aggressive: 0, tight: 0, passive: 0, neutral: 0, total: 0 };
          }
          dailyCompetition[dateKey][normalizedType as keyof typeof dailyCompetition[string]]++;
          dailyCompetition[dateKey].total++;
        }

        const total = Object.values(competitionCounts).reduce((a: unknown, b: unknown) => a + b, 0);
        const distribution = Object.entries(competitionCounts).map(([type, cnt]) => ({
          type,
          count: cnt,
          percentage: total > 0 ? Math.round((cnt / total) * 1000) / 10 : 0,
          label: type === 'aggressive' ? '疯狂型' : type === 'tight' ? '紧缩型' : type === 'passive' ? '被动型' : '中性型',
        }));

        const recentTrend = Object.entries(dailyCompetition)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, data]) => ({
            date,
            ...data,
            dominantType: Object.entries(data)
              .filter(([k]) => k !== 'total')
              .sort(([, a], [, b]) => (b as number) - (a as number))[0]?.[0] || 'neutral',
          }));

        // 确定主导竞争类型
        const dominantType = Object.entries(competitionCounts)
          .sort(([, a], [, b]) => b - a)[0]?.[0] || 'neutral';

        // 计算平均竞争强度
        const intensityMap: Record<string, number> = { aggressive: 3, tight: 2, neutral: 1, passive: 0 };
        const avgIntensity = total > 0
          ? Object.entries(competitionCounts).reduce((sum, [type, cnt]) => sum + (intensityMap[type] || 1) * cnt, 0) / total
          : 1;
        const avgCompetition = avgIntensity > 2.2 ? 'high' : avgIntensity > 1.2 ? 'medium' : 'low';

        return {
          distribution,
          recentTrend,
          summary: { avgCompetition, dominantType },
        };
      } catch (e) {
        return { distribution: [], recentTrend: [], summary: { avgCompetition: 'medium', dominantType: 'neutral' } };
      }
    }),

  // v275: 查询预算分池状态 — 用于前端预算分池Dashboard展示
  getBudgetPoolInsights: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      days: z.number().default(30),
    }))
    .query(async ({ input, ctx }: unknown) => {
      await verifyAccountAccess(ctx.user.id, input.accountId);
      const db = await getDb();
      if (!db) return { poolAllocation: { coreRatio: 80, explorationRatio: 20 }, dailyTrend: [], summary: { avgCoreRatio: 80, avgExplorationRatio: 20, fusedCount: 0, totalEvents: 0 } };
      
      try {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - input.days);
        const startDateStr = startDate.toISOString().split('T')[0];

        // 从optimization_events中提取预算分池信息
        const events = await db.select({
          performanceData: optimizationEvents.performanceData,
          createdAt: optimizationEvents.createdAt,
        })
        .from(optimizationEvents)
        .where(and(
          eq(optimizationEvents.accountId, input.accountId),
          gte(optimizationEvents.createdAt, startDateStr),
        ))
        .orderBy(desc(optimizationEvents.createdAt))
        .limit(1000);

        // 解析预算分池数据
        const dailyPool: Record<string, { coreRatioSum: number; explorationRatioSum: number; count: number; fusedCount: number }> = {};
        let totalCoreRatio = 0;
        let totalExplorationRatio = 0;
        let poolEventCount = 0;
        let fusedCount = 0;

        for (const event of events) {
          const perfData = event.performanceData as Record<string, unknown>;
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

            const dateKey = event.createdAt ? event.createdAt.split(' ')[0] : 'unknown';
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

        const dailyTrend = Object.entries(dailyPool)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, data]) => ({
            date,
            avgCoreRatio: Math.round(data.coreRatioSum / data.count * 10) / 10,
            avgExplorationRatio: Math.round(data.explorationRatioSum / data.count * 10) / 10,
            eventCount: data.count,
            fusedCount: data.fusedCount,
          }));

        return {
          poolAllocation: { coreRatio: avgCoreRatio, explorationRatio: avgExplorationRatio },
          dailyTrend,
          summary: {
            avgCoreRatio,
            avgExplorationRatio,
            fusedCount,
            totalEvents: poolEventCount,
          },
        };
      } catch (e) {
        return { poolAllocation: { coreRatio: 80, explorationRatio: 20 }, dailyTrend: [], summary: { avgCoreRatio: 80, avgExplorationRatio: 20, fusedCount: 0, totalEvents: 0 } };
      }
    }),

  // 查询关键词图谱机会（只读查询，图谱由定时任务自动构建）
  getKeywordOpportunities: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .query(async ({ input, ctx }: unknown) => {
      await verifyAccountAccess(ctx.user.id, input.accountId);
      const opportunities = await keywordGraphService.discoverOpportunities(input.accountId);
      const negatives = await keywordGraphService.discoverNegativeCandidates(input.accountId);
      return { opportunities, negatives };
    }),
});
