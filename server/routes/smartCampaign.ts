/**
 * 智能投放系统API路由
 */

import { z } from 'zod';
import { publicProcedure, router } from '../_core/trpc';
import {
  SmartDecisionEngine,
  AutoExecutionEngine,
  type CampaignMetrics,
  type OptimizationGoal,
} from '../smartCampaign/decisionEngine';
import * as db from '../db';
import { eq, and, gte, desc } from 'drizzle-orm';
import { dailyPerformance, campaigns, performanceGroups } from '@db/schema';

const optimizationGoalSchema = z.object({
  type: z.enum(['maximize_sales', 'target_acos', 'target_roas', 'minimize_cost']),
  targetValue: z.number().optional(),
  maxDailyBudget: z.number().optional(),
  minROAS: z.number().optional(),
});

export const smartCampaignRouter = router({
  /**
   * 获取单个广告活动的优化建议
   */
  getOptimizationRecommendation: publicProcedure
    .input(
      z.object({
        campaignId: z.string(),
        goal: optimizationGoalSchema,
        daysOfHistory: z.number().default(7),
      })
    )
    .query(async ({ input }) => {
      const { campaignId, goal, daysOfHistory } = input;

      // 获取广告活动信息
      const campaign = await db.query.campaigns.findFirst({
        where: eq(campaigns.id, campaignId),
      });

      if (!campaign) {
        throw new Error('Campaign not found');
      }

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

      if (historicalRecords.length === 0) {
        throw new Error('No historical data available');
      }

      // 计算指标
      const totalSpend = historicalRecords.reduce((sum, r) => sum + r.spend, 0);
      const totalSales = historicalRecords.reduce((sum, r) => sum + r.sales, 0);
      const totalImpressions = historicalRecords.reduce((sum, r) => sum + r.impressions, 0);
      const totalClicks = historicalRecords.reduce((sum, r) => sum + r.clicks, 0);
      const totalConversions = historicalRecords.reduce((sum, r) => sum + r.conversions, 0);

      const avgACoS = totalSales === 0 ? 999 : (totalSpend / totalSales) * 100;
      const avgROAS = totalSpend === 0 ? 0 : totalSales / totalSpend;
      const avgCTR = totalImpressions === 0 ? 0 : (totalClicks / totalImpressions) * 100;
      const avgCVR = totalClicks === 0 ? 0 : (totalConversions / totalClicks) * 100;

      // 计算趋势
      const recentData = historicalRecords.slice(0, Math.floor(daysOfHistory / 2));
      const olderData = historicalRecords.slice(Math.floor(daysOfHistory / 2));

      const recentSpend = recentData.reduce((sum, r) => sum + r.spend, 0) / recentData.length;
      const olderSpend = olderData.reduce((sum, r) => sum + r.spend, 0) / olderData.length;
      const spendTrend = recentSpend > olderSpend * 1.1 ? 'up' : recentSpend < olderSpend * 0.9 ? 'down' : 'stable';

      const recentSales = recentData.reduce((sum, r) => sum + r.sales, 0) / recentData.length;
      const olderSales = olderData.reduce((sum, r) => sum + r.sales, 0) / olderData.length;
      const salesTrend = recentSales > olderSales * 1.1 ? 'up' : recentSales < olderSales * 0.9 ? 'down' : 'stable';

      const recentACoS = recentData.reduce((sum, r) => sum + r.acos, 0) / recentData.length;
      const olderACoS = olderData.reduce((sum, r) => sum + r.acos, 0) / olderData.length;
      const acosTrend = recentACoS > olderACoS * 1.1 ? 'up' : recentACoS < olderACoS * 0.9 ? 'down' : 'stable';

      const metrics: CampaignMetrics = {
        campaignId: campaign.id,
        campaignName: campaign.name,
        status: campaign.status as 'enabled' | 'paused' | 'archived',
        dailyBudget: campaign.dailyBudget || 100,
        currentBid: historicalRecords[0]?.avgCpc || 1,
        spend: totalSpend,
        sales: totalSales,
        impressions: totalImpressions,
        clicks: totalClicks,
        conversions: totalConversions,
        acos: avgACoS,
        roas: avgROAS,
        ctr: avgCTR,
        cvr: avgCVR,
        spendTrend,
        salesTrend,
        acosTrend,
      };

      // 生成决策
      const engine = new SmartDecisionEngine();
      const decision = engine.makeDecision(metrics, goal as OptimizationGoal);

      return {
        metrics,
        decision,
      };
    }),

  /**
   * 获取绩效组的批量优化建议
   */
  getBatchOptimizationRecommendations: publicProcedure
    .input(
      z.object({
        performanceGroupId: z.string(),
        goal: optimizationGoalSchema,
        daysOfHistory: z.number().default(7),
      })
    )
    .query(async ({ input }) => {
      const { performanceGroupId, goal, daysOfHistory } = input;

      // 获取绩效组下的所有广告活动
      const groupCampaigns = await db
        .select()
        .from(campaigns)
        .where(eq(campaigns.performanceGroupId, performanceGroupId));

      if (groupCampaigns.length === 0) {
        throw new Error('No campaigns found in this performance group');
      }

      // 获取每个活动的指标
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysOfHistory);

      const campaignMetrics: CampaignMetrics[] = await Promise.all(
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

          if (historicalRecords.length === 0) {
            // 返回默认值
            return {
              campaignId: campaign.id,
              campaignName: campaign.name,
              status: campaign.status as 'enabled' | 'paused' | 'archived',
              dailyBudget: campaign.dailyBudget || 100,
              currentBid: 1,
              spend: 0,
              sales: 0,
              impressions: 0,
              clicks: 0,
              conversions: 0,
              acos: 999,
              roas: 0,
              ctr: 0,
              cvr: 0,
              spendTrend: 'stable' as const,
              salesTrend: 'stable' as const,
              acosTrend: 'stable' as const,
            };
          }

          const totalSpend = historicalRecords.reduce((sum, r) => sum + r.spend, 0);
          const totalSales = historicalRecords.reduce((sum, r) => sum + r.sales, 0);
          const totalImpressions = historicalRecords.reduce((sum, r) => sum + r.impressions, 0);
          const totalClicks = historicalRecords.reduce((sum, r) => sum + r.clicks, 0);
          const totalConversions = historicalRecords.reduce((sum, r) => sum + r.conversions, 0);

          const avgACoS = totalSales === 0 ? 999 : (totalSpend / totalSales) * 100;
          const avgROAS = totalSpend === 0 ? 0 : totalSales / totalSpend;
          const avgCTR = totalImpressions === 0 ? 0 : (totalClicks / totalImpressions) * 100;
          const avgCVR = totalClicks === 0 ? 0 : (totalConversions / totalClicks) * 100;

          const recentData = historicalRecords.slice(0, Math.floor(daysOfHistory / 2));
          const olderData = historicalRecords.slice(Math.floor(daysOfHistory / 2));

          const recentSpend = recentData.reduce((sum, r) => sum + r.spend, 0) / recentData.length;
          const olderSpend = olderData.reduce((sum, r) => sum + r.spend, 0) / olderData.length;
          const spendTrend = recentSpend > olderSpend * 1.1 ? 'up' : recentSpend < olderSpend * 0.9 ? 'down' : 'stable';

          const recentSales = recentData.reduce((sum, r) => sum + r.sales, 0) / recentData.length;
          const olderSales = olderData.reduce((sum, r) => sum + r.sales, 0) / olderData.length;
          const salesTrend = recentSales > olderSales * 1.1 ? 'up' : recentSales < olderSales * 0.9 ? 'down' : 'stable';

          const recentACoS = recentData.reduce((sum, r) => sum + r.acos, 0) / recentData.length;
          const olderACoS = olderData.reduce((sum, r) => sum + r.acos, 0) / olderData.length;
          const acosTrend = recentACoS > olderACoS * 1.1 ? 'up' : recentACoS < olderACoS * 0.9 ? 'down' : 'stable';

          return {
            campaignId: campaign.id,
            campaignName: campaign.name,
            status: campaign.status as 'enabled' | 'paused' | 'archived',
            dailyBudget: campaign.dailyBudget || 100,
            currentBid: historicalRecords[0]?.avgCpc || 1,
            spend: totalSpend,
            sales: totalSales,
            impressions: totalImpressions,
            clicks: totalClicks,
            conversions: totalConversions,
            acos: avgACoS,
            roas: avgROAS,
            ctr: avgCTR,
            cvr: avgCVR,
            spendTrend,
            salesTrend,
            acosTrend,
          };
        })
      );

      // 生成批量决策
      const engine = new SmartDecisionEngine();
      const decisions = engine.makeBatchDecisions(campaignMetrics, goal as OptimizationGoal);
      const report = engine.generateOptimizationReport(decisions);

      return report;
    }),

  /**
   * 执行优化决策
   */
  executeOptimization: publicProcedure
    .input(
      z.object({
        campaignId: z.string(),
        action: z.enum(['pause', 'enable', 'increase_bid', 'decrease_bid', 'increase_budget', 'decrease_budget']),
        value: z.number().optional(),
        dryRun: z.boolean().default(true),
      })
    )
    .mutation(async ({ input }) => {
      const { campaignId, action, value, dryRun } = input;

      const executor = new AutoExecutionEngine();
      const decision = {
        campaignId,
        action,
        currentValue: value,
        recommendedValue: value,
        confidence: 1,
        reasoning: 'Manual execution',
        priority: 'high' as const,
        expectedImpact: {
          salesChange: 0,
          spendChange: 0,
          acosChange: 0,
        },
      };

      const result = await executor.executeDecision(decision, dryRun);

      return result;
    }),

  /**
   * 批量执行优化决策
   */
  executeBatchOptimization: publicProcedure
    .input(
      z.object({
        performanceGroupId: z.string(),
        goal: optimizationGoalSchema,
        daysOfHistory: z.number().default(7),
        dryRun: z.boolean().default(true),
        maxConcurrent: z.number().default(5),
      })
    )
    .mutation(async ({ input }) => {
      const { performanceGroupId, goal, daysOfHistory, dryRun, maxConcurrent } = input;

      // 先获取优化建议
      const report = await smartCampaignRouter.createCaller({} as any).getBatchOptimizationRecommendations({
        performanceGroupId,
        goal,
        daysOfHistory,
      });

      // 执行决策
      const executor = new AutoExecutionEngine();
      const results = await executor.executeBatchDecisions(
        report.recommendations,
        dryRun,
        maxConcurrent
      );

      return {
        summary: report.summary,
        results,
      };
    }),
});
