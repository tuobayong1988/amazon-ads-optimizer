/**
 * 机器学习优化API路由
 * v143: 修复所有TypeScript编译错误
 */

import { z } from 'zod';
import { publicProcedure, router } from '../_core/trpc';
import { BidOptimizer, BudgetAllocator, type HistoricalData, type OptimizationTarget } from '../ml/bidOptimizer';
import * as db from '../db';

const optimizationTargetSchema = z.object({
  type: z.enum(['maximize_sales', 'target_acos', 'target_roas']),
  targetValue: z.number().optional(),
  maxBudget: z.number().optional(),
});

/** 安全地将decimal字段(string|null)转为number */
function toNum(val: string | number | null | undefined): number {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number') return val;
  const n = parseFloat(val);
  return isNaN(n) ? 0 : n;
}

/** 将数据库记录转换为ML格式的HistoricalData */
function toHistoricalData(record: {
  date?: string | null;
  cpc?: string | null;
  spend?: string | null;
  sales?: string | null;
  impressions?: number | null;
  clicks?: number | null;
  conversions?: number | null;
  dailyAcos?: string | null;
  dailyRoas?: string | null;
}): HistoricalData {
  return {
    date: record.date || '',
    bid: toNum(record.cpc),
    spend: toNum(record.spend),
    sales: toNum(record.sales),
    impressions: record.impressions || 0,
    clicks: record.clicks || 0,
    conversions: record.conversions || 0,
    acos: toNum(record.dailyAcos),
    roas: toNum(record.dailyRoas),
  };
}

export const mlOptimizationRouter = router({
  /**
   * 获取出价推荐
   */
  getBidRecommendation: publicProcedure
    .input(
      z.object({
        campaignId: z.string(),
        target: optimizationTargetSchema,
        daysOfHistory: z.number().default(30),
      })
    )
    .mutation(async ({ input }) => {
      const { campaignId, target, daysOfHistory } = input;

      // 获取广告活动信息以确定accountId
      const campaign = await db.getCampaignById(parseInt(campaignId, 10));
      if (!campaign) {
        throw new Error('Campaign not found');
      }

      // 获取历史数据
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysOfHistory);
      const endDate = new Date();

      const historicalRecords = await db.getDailyPerformanceByDateRange(
        campaign.accountId,
        cutoffDate,
        endDate,
        campaign.id
      );

      if (historicalRecords.length < 10) {
        throw new Error(
          `Insufficient historical data. Found ${historicalRecords.length} records, need at least 10.`
        );
      }

      // 转换为ML格式
      const historicalData: HistoricalData[] = historicalRecords.map(toHistoricalData);

      // 训练模型并获取推荐
      const optimizer = new BidOptimizer();
      optimizer.train(historicalData);

      // 计算当前平均值
      const recentData = historicalData.slice(0, 7); // 最近7天
      const currentBid =
        recentData.reduce((sum: number, d) => sum + d.bid, 0) / recentData.length;
      const avgImpressions =
        recentData.reduce((sum: number, d) => sum + d.impressions, 0) / recentData.length;
      const avgClicks =
        recentData.reduce((sum: number, d) => sum + d.clicks, 0) / recentData.length;

      const recommendation = optimizer.recommendBid(
        {
          currentBid,
          avgImpressions,
          avgClicks,
        },
        target as OptimizationTarget
      );

      // 评估模型性能
      const evaluation = optimizer.evaluateModel(historicalData.slice(0, 10));

      return {
        recommendation,
        modelPerformance: evaluation,
        dataPoints: historicalData.length,
      };
    }),

  /**
   * 批量获取多个广告活动的出价推荐
   */
  getBatchBidRecommendations: publicProcedure
    .input(
      z.object({
        campaignIds: z.array(z.string()),
        target: optimizationTargetSchema,
        daysOfHistory: z.number().default(30),
      })
    )
    .mutation(async ({ input }) => {
      const { campaignIds, target, daysOfHistory } = input;

      const results = await Promise.allSettled(
        campaignIds.map(async (campaignId: string) => {
          const campaign = await db.getCampaignById(parseInt(campaignId, 10));
          if (!campaign) {
            throw new Error('Campaign not found');
          }

          const cutoffDate = new Date();
          cutoffDate.setDate(cutoffDate.getDate() - daysOfHistory);
          const endDate = new Date();

          const historicalRecords = await db.getDailyPerformanceByDateRange(
            campaign.accountId,
            cutoffDate,
            endDate,
            campaign.id
          );

          if (historicalRecords.length < 10) {
            throw new Error('Insufficient data');
          }

          const historicalData: HistoricalData[] = historicalRecords.map(toHistoricalData);

          const optimizer = new BidOptimizer();
          optimizer.train(historicalData);

          const recentData = historicalData.slice(0, 7);
          const currentBid =
            recentData.reduce((sum: number, d) => sum + d.bid, 0) / recentData.length;
          const avgImpressions =
            recentData.reduce((sum: number, d) => sum + d.impressions, 0) / recentData.length;
          const avgClicks =
            recentData.reduce((sum: number, d) => sum + d.clicks, 0) / recentData.length;

          const recommendation = optimizer.recommendBid(
            {
              currentBid,
              avgImpressions,
              avgClicks,
            },
            target as OptimizationTarget
          );

          return {
            campaignId,
            recommendation,
            success: true,
          };
        })
      );

      return results.map((result, index: number) => {
        if (result.status === 'fulfilled') {
          return result.value;
        } else {
          return {
            campaignId: campaignIds[index],
            recommendation: null,
            success: false,
            error: (result.reason as Error).message,
          };
        }
      });
    }),

  /**
   * 预算分配优化
   */
  optimizeBudgetAllocation: publicProcedure
    .input(
      z.object({
        performanceGroupId: z.string(),
        totalBudget: z.number(),
        daysOfHistory: z.number().default(30),
      })
    )
    .mutation(async ({ input }) => {
      const { performanceGroupId, totalBudget, daysOfHistory } = input;

      // 获取绩效组下的所有广告活动
      const groupCampaigns = await db.getCampaignsByPerformanceGroupId(parseInt(performanceGroupId, 10));

      if (groupCampaigns.length === 0) {
        throw new Error('No campaigns found in this performance group');
      }

      // 获取每个活动的历史数据
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysOfHistory);
      const endDate = new Date();

      const campaignsWithData = await Promise.all(
        groupCampaigns.map(async (campaign: { id: number; accountId: number; campaignName: string; dailyBudget: string | null }) => {
          const campaignIdStr = String(campaign.campaignId);
          const historicalRecords = await db.getDailyPerformanceByDateRange(
            campaign.accountId,
            cutoffDate,
            endDate,
            campaign.id
          );

          const historicalData: HistoricalData[] = historicalRecords.map(toHistoricalData);

          const currentROAS =
            historicalData.length > 0
              ? historicalData.slice(0, 7).reduce((sum: number, d) => sum + d.roas, 0) / 7
              : 1;

          return {
            id: campaignIdStr,
            name: campaign.campaignName,
            currentBudget: toNum(campaign.dailyBudget) || 100,
            currentROAS,
            historicalData,
          };
        })
      );

      // 执行预算分配
      const allocator = new BudgetAllocator();
      const allocations = allocator.allocateBudget(campaignsWithData, totalBudget);

      // 计算总预期
      const totalExpectedSales = allocations.reduce(
        (sum: number, a: any) => sum + a.expectedSales,
        0
      );
      const totalAllocated = allocations.reduce(
        (sum: number, a: any) => sum + a.allocatedBudget,
        0
      );
      const overallROAS = totalAllocated === 0 ? 0 : totalExpectedSales / totalAllocated;

      return {
        allocations,
        summary: {
          totalBudget,
          totalAllocated: Math.round(totalAllocated * 100) / 100,
          totalExpectedSales: Math.round(totalExpectedSales * 100) / 100,
          overallROAS: Math.round(overallROAS * 100) / 100,
        },
      };
    }),

  /**
   * 模型性能评估
   */
  evaluateModel: publicProcedure
    .input(
      z.object({
        campaignId: z.string(),
        trainingDays: z.number().default(60),
        testDays: z.number().default(14),
      })
    )
    .query(async ({ input }) => {
      const { campaignId, trainingDays, testDays } = input;

      const campaign = await db.getCampaignById(parseInt(campaignId, 10));
      if (!campaign) {
        throw new Error('Campaign not found');
      }

      // 获取训练数据
      const trainingCutoff = new Date();
      trainingCutoff.setDate(trainingCutoff.getDate() - testDays);
      const historyCutoff = new Date(trainingCutoff);
      historyCutoff.setDate(historyCutoff.getDate() - trainingDays);

      const trainingRecords = await db.getDailyPerformanceByDateRange(
        campaign.accountId,
        historyCutoff,
        trainingCutoff,
        campaign.id
      );

      // 获取测试数据
      const testRecords = await db.getDailyPerformanceByDateRange(
        campaign.accountId,
        trainingCutoff,
        new Date(),
        campaign.id
      );

      if (trainingRecords.length < 10 || testRecords.length < 5) {
        throw new Error('Insufficient data for model evaluation');
      }

      const trainingData: HistoricalData[] = trainingRecords.map(toHistoricalData);
      const testData: HistoricalData[] = testRecords.map(toHistoricalData);

      // 训练模型
      const optimizer = new BidOptimizer();
      optimizer.train(trainingData);

      // 评估
      const evaluation = optimizer.evaluateModel(testData);

      return {
        evaluation,
        trainingDataPoints: trainingData.length,
        testDataPoints: testData.length,
      };
    }),
});
