/**
 * systemConfig.ts - v272 P0-1: 系统配置管理和算法可观测性API路由
 * 
 * 将systemConfigService、algorithmObservabilityService、weightAutoTuningService
 * 暴露为前端可访问的API，消除"孤岛"状态。
 */
import { z } from 'zod';
import { router, protectedProcedure } from '../_core/trpc';

export const systemConfigRouter = router({
  /**
   * 获取所有系统配置参数
   */
  getAllConfig: protectedProcedure
    .query(async () => {
      const { getAllConfig } = await import('../systemConfigService');
      return { success: true, config: getAllConfig() };
    }),

  /**
   * 按分类获取配置参数
   */
  getConfigByCategory: protectedProcedure
    .input(z.object({ category: z.string() }))
    .query(async ({ input }: any) => {
      const { getAllConfig } = await import('../systemConfigService');
      return { success: true, config: getAllConfig(input.category) };
    }),

  /**
   * 更新单个配置参数
   */
  updateConfig: protectedProcedure
    .input(z.object({
      key: z.string(),
      value: z.union([z.number(), z.string(), z.boolean()]),
      reason: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { updateConfig } = await import('../systemConfigService');
      const success = updateConfig(
        input.key,
        input.value,
        ctx.user.name || 'unknown',
        input.reason || ''
      );
      return { success };
    }),

  /**
   * 获取配置变更历史
   */
  getChangeHistory: protectedProcedure
    .input(z.object({ limit: z.number().optional() }))
    .query(async ({ input }: any) => {
      const { getChangeLog } = await import('../systemConfigService');
      return { success: true, history: getChangeLog(input.limit || 50) };
    }),

  /**
   * 获取算法决策仪表板指标
   */
  getAlgorithmDashboard: protectedProcedure
    .input(z.object({ period: z.enum(['1h', '24h', '7d']).optional() }))
    .query(async ({ input }: any) => {
      const { generateDashboardMetrics } = await import('../algorithmObservabilityService');
      return { success: true, metrics: generateDashboardMetrics(input.period || '24h') };
    }),

  /**
   * 获取最近的算法决策追踪
   */
  getRecentDecisions: protectedProcedure
    .input(z.object({
      accountId: z.number().optional(),
      algorithm: z.string().optional(),
      limit: z.number().optional(),
    }))
    .query(async ({ input }: any) => {
      const { getRecentDecisionTraces } = await import('../algorithmObservabilityService');
      return {
        success: true,
        traces: getRecentDecisionTraces(input.limit || 50, { accountId: input.accountId, algorithm: input.algorithm }),
      };
    }),

  /**
   * 获取通用可观测性指标
   */
  getMetrics: protectedProcedure
    .input(z.object({
      type: z.string().optional(),
      limit: z.number().optional(),
    }))
    .query(async ({ input }: any) => {
      const { getMetrics } = await import('../algorithmObservabilityService');
      return { success: true, metrics: getMetrics(input.type, input.limit || 100) };
    }),

  /**
   * 获取权重自学习状态
   */
  getWeightTuningStatus: protectedProcedure
    .input(z.object({ strategyTemplateId: z.string().optional() }))
    .query(async ({ input }: any) => {
      const { getTuningHistory, getEffectiveWeights } = await import('../weightAutoTuningService');
      const history = getTuningHistory(input.strategyTemplateId);
      const defaultWeights = {
        coreMetric: 20, trend: 16, budgetEfficiency: 11,
        conversionEfficiency: 15, gradualProgress: 18, algorithmEfficacy: 8, profitHealth: 12,
      };
      const effectiveWeights = input.strategyTemplateId
        ? getEffectiveWeights(input.strategyTemplateId, defaultWeights)
        : defaultWeights;
      return { success: true, history, effectiveWeights };
    }),

  /**
   * 回滚权重到上一版本
   */
  rollbackWeights: protectedProcedure
    .input(z.object({ strategyTemplateId: z.string() }))
    .mutation(async ({ input }: any) => {
      const { rollbackWeights } = await import('../weightAutoTuningService');
      const success = rollbackWeights(input.strategyTemplateId);
      return { success };
    }),
});
