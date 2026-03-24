/**
 * v503: 自动止血服务 tRPC 路由
 * 
 * 提供前端可调用的止血服务API：
 * - 获取止血配置
 * - 更新止血配置
 * - 手动触发止血扫描
 * - 查看止血历史记录
 */

import { z } from 'zod';
import { router, protectedProcedure } from '../_core/trpc';
import { 
  executeFullStopLossScan, 
  getStopLossConfig, 
  updateStopLossConfig,
  scanAndPauseHighAcosCampaigns,
  scanAndNegateSearchTerms,
  scanReactivatedCampaigns,
  scanAndRepairDataCliffs,
} from '../automation/autoStopLossService';

export const stopLossRouter = router({
  /** 获取当前止血配置 */
  getConfig: protectedProcedure
    .query(() => {
      return getStopLossConfig();
    }),

  /** 更新止血配置 */
  updateConfig: protectedProcedure
    .input(z.object({
      campaignAutoPause: z.object({
        consecutiveDays: z.number().min(3).max(30).optional(),
        acosThreshold: z.number().min(50).max(500).optional(),
        minSpendThreshold: z.number().min(5).max(500).optional(),
        minClicksThreshold: z.number().min(5).max(100).optional(),
        historicalOrderThreshold: z.number().min(1).max(100).optional(),
      }).optional(),
      searchTermAutoNegate: z.object({
        zeroConversionSpendThreshold: z.number().min(5).max(100).optional(),
        highAcosThreshold: z.number().min(100).max(1000).optional(),
        highAcosSpendThreshold: z.number().min(10).max(200).optional(),
        competitorBrands: z.array(z.string()).optional(),
        irrelevantCategories: z.array(z.string()).optional(),
      }).optional(),
      reactivationGuard: z.object({
        checkWindowHours: z.number().min(1).max(72).optional(),
        batchReactivationThreshold: z.number().min(2).max(50).optional(),
        autoRollbackEnabled: z.boolean().optional(),
        historicalAcosThreshold: z.number().min(50).max(300).optional(),
      }).optional(),
      dataCliffRepair: z.object({
        historicalOrderThreshold: z.number().min(1).max(50).optional(),
        trafficDropThreshold: z.number().min(20).max(90).optional(),
        maxBidIncreasePercent: z.number().min(5).max(50).optional(),
      }).optional(),
    }))
    .mutation(({ input }) => {
      updateStopLossConfig(input as Parameters<typeof updateStopLossConfig>[0]);
      return { success: true, config: getStopLossConfig() };
    }),

  /** 手动触发全量止血扫描 */
  triggerFullScan: protectedProcedure
    .input(z.object({
      accountId: z.number(),
    }))
    .mutation(async ({ input }) => {
      const result = await executeFullStopLossScan(input.accountId);
      return result;
    }),

  /** 手动触发单项扫描 */
  triggerSingleScan: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      scanType: z.enum(['campaign_pause', 'search_term_negate', 'reactivation_guard', 'data_cliff_repair']),
    }))
    .mutation(async ({ input }) => {
      switch (input.scanType) {
        case 'campaign_pause':
          return { actions: await scanAndPauseHighAcosCampaigns(input.accountId) };
        case 'search_term_negate':
          return { actions: await scanAndNegateSearchTerms(input.accountId) };
        case 'reactivation_guard':
          return { actions: await scanReactivatedCampaigns(input.accountId) };
        case 'data_cliff_repair':
          return { actions: await scanAndRepairDataCliffs(input.accountId) };
        default:
          throw new Error(`Unknown scan type: ${input.scanType}`);
      }
    }),
});
