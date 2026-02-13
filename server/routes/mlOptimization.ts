/**
 * 机器学习优化API路由
 */

import { z } from 'zod';
import { publicProcedure, router } from '../trpc';
import { BidOptimizer, BudgetAllocator, type HistoricalData, type OptimizationTarget } from '../ml/bidOptimizer';
import { db } from '../db';
import { eq, and, gte, desc } from 'drizzle-orm';
import { dailyPerformance, campaigns } from '@db/schema';

const historicalDataSchema = z.object({
  date: z.string(),
  bid: z.number(),
  spend: z.number(),
  sales: z.number(),
  impressions: z.number(),
  clicks: z.number(),
  conversions: z.number(),
  acos: z.number(),
  roas: z.number(),
});

const optimizationTargetSchema = z.object({
  type: z.enum(['maximize_sales', 'target_acos', 'target_roas']),
  targetValue: z.number().optional(),
  maxBudget: z.number().optional(),
});

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

      // 获取历史数据
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysOfHistory);

      const historicalRecords = await db
        .select()
        .from(dailyPerformance)
        .where(
          and(
            eq(dailyPerformance.campaignId, campaignId),
            gte(dailyPerformance.date, cutoffDate.toISOString().split('T')[0])
          )
        )
        .orderBy(desc(dailyPerformance.date));

      if (historicalRecords.length < 10) {
        throw new Error(
          `Insufficient historical data. Found ${historicalRecords.length} records, need at least 10.`
        );
      }

      // 转换为ML格式
      const historicalData: HistoricalData[] = historicalRecords.map((record) => ({
        date: record.date,
        bid: record.avgCpc || 0,
        spend: record.spend,
        sales: record.sales,
        impressions: record.impressions,
        clicks: record.clicks,
        conversions: record.conversions,
        acos: record.acos,
        roas: record.roas,
      }));

      // 训练模型并获取推荐
      const optimizer = new BidOptimizer();
      optimizer.train(historicalData);

      // 计算当前平均值
      const recentData = historicalData.slice(0, 7); // 最近7天
      const currentBid =
        recentData.reduce((sum, d) => sum + d.bid, 0) / recentData.length;
      const avgImpressions =
        recentData.reduce((sum, d) => sum + d.impressions, 0) / recentData.length;
      const avgClicks =
        recentData.reduce((sum, d) => sum + d.clicks, 0) / recentData.length;

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
        campaignIds.map(async (campaignId) => {
          // 获取历史数据
          const cutoffDate = new Date();
          cutoffDate.setDate(cutoffDate.getDate() - daysOfHistory);

          const historicalRecords = await db
            .select()
            .from(dailyPerformance)
            .where(
              and(
                eq(dailyPerformance.campaignId, campaignId),
                gte(dailyPerformance.date, cutoffDate.toISOString().split('T')[0])
              )
            )
            .orderBy(desc(dailyPerformance.date));

          if (historicalRecords.length < 10) {
            throw new Error('Insufficient data');
          }

          const historicalData: HistoricalData[] = historicalRecords.map((record) => ({
            date: record.date,
            bid: record.avgCpc || 0,
            spend: record.spend,
            sales: record.sales,
            impressions: record.impressions,
            clicks: record.clicks,
            conversions: record.conversions,
            acos: record.acos,
            roas: record.roas,
          }));

          const optimizer = new BidOptimizer();
          optimizer.train(historicalData);

          const recentData = historicalData.slice(0, 7);
          const currentBid =
            recentData.reduce((sum, d) => sum + d.bid, 0) / recentData.length;
          const avgImpressions =
            recentData.reduce((sum, d) => sum + d.impressions, 0) / recentData.length;
          const avgClicks =
            recentData.reduce((sum, d) => sum + d.clicks, 0) / recentData.length;

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

      return results.map((result, index) => {
        if (result.status === 'fulfilled') {
          return result.value;
        } else {
          return {
            campaignId: campaignIds[index],
            recommendation: null,
            success: false,
            error: result.reason.message,
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
      const groupCampaigns = await db
        .select()
        .from(campaigns)
        .where(eq(campaigns.performanceGroupId, performanceGroupId));

      if (groupCampaigns.length === 0) {
        throw new Error('No campaigns found in this performance group');
      }

      // 获取每个活动的历史数据
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysOfHistory);

      const campaignsWithData = await Promise.all(
        groupCampaigns.map(async (campaign) => {
          const historicalRecords = await db
            .select()
            .from(dailyPerformance)
            .where(
              and(
                eq(dailyPerformance.campaignId, campaign.id),
                gte(dailyPerformance.date, cutoffDate.toISOString().split('T')[0])
              )
            )
            .orderBy(desc(dailyPerformance.date));

          const historicalData: HistoricalData[] = historicalRecords.map((record) => ({
            date: record.date,
            bid: record.avgCpc || 0,
            spend: record.spend,
            sales: record.sales,
            impressions: record.impressions,
            clicks: record.clicks,
            conversions: record.conversions,
            acos: record.acos,
            roas: record.roas,
          }));

          const currentROAS =
            historicalData.length > 0
              ? historicalData.slice(0, 7).reduce((sum, d) => sum + d.roas, 0) / 7
              : 1;

          return {
            id: campaign.id,
            name: campaign.name,
            currentBudget: campaign.dailyBudget || 100,
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
        (sum, a) => sum + a.expectedSales,
        0
      );
      const totalAllocated = allocations.reduce(
        (sum, a) => sum + a.allocatedBudget,
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

      // 获取训练数据
      const trainingCutoff = new Date();
      trainingCutoff.setDate(trainingCutoff.getDate() - testDays);
      const historyCutoff = new Date(trainingCutoff);
      historyCutoff.setDate(historyCutoff.getDate() - trainingDays);

      const trainingRecords = await db
        .select()
        .from(dailyPerformance)
        .where(
          and(
            eq(dailyPerformance.campaignId, campaignId),
            gte(dailyPerformance.date, historyCutoff.toISOString().split('T')[0]),
            gte(trainingCutoff.toISOString().split('T')[0], dailyPerformance.date)
          )
        )
        .orderBy(desc(dailyPerformance.date));

      // 获取测试数据
      const testRecords = await db
        .select()
        .from(dailyPerformance)
        .where(
          and(
            eq(dailyPerformance.campaignId, campaignId),
            gte(dailyPerformance.date, trainingCutoff.toISOString().split('T')[0])
          )
        )
        .orderBy(desc(dailyPerformance.date));

      if (trainingRecords.length < 10 || testRecords.length < 5) {
        throw new Error('Insufficient data for model evaluation');
      }

      const trainingData: HistoricalData[] = trainingRecords.map((record) => ({
        date: record.date,
        bid: record.avgCpc || 0,
        spend: record.spend,
        sales: record.sales,
        impressions: record.impressions,
        clicks: record.clicks,
        conversions: record.conversions,
        acos: record.acos,
        roas: record.roas,
      }));

      const testData: HistoricalData[] = testRecords.map((record) => ({
        date: record.date,
        bid: record.avgCpc || 0,
        spend: record.spend,
        sales: record.sales,
        impressions: record.impressions,
        clicks: record.clicks,
        conversions: record.conversions,
        acos: record.acos,
        roas: record.roas,
      }));

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
