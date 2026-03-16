/**
 * 智能运营推荐 tRPC 路由 v269.4
 */
import { z } from 'zod';
import { router, protectedProcedure } from '../_core/trpc';
import { scanAccountHealth } from '../analytics/intelligentRecommendationEngine';
import * as db from '../db';
import { createModuleLogger } from '../utils/logger';
import { verifyAccountAccess } from '../utils/accessControl';

const log = createModuleLogger('Route_intelligentRecommendation');

export const intelligentRecommendationRouter = router({
  scan: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .query(async ({ input, ctx }: any) => {
      await verifyAccountAccess(ctx.user.id, input.accountId);
      return await scanAccountHealth(input.accountId);
    }),

  quickCreateGoal: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      name: z.string(),
      description: z.string().optional(),
      optimizationGoal: z.string(),
      targetAcos: z.number().optional(),
      targetRoas: z.number().optional(),
      strategyTemplateId: z.string().optional(),
      strategyTemplateName: z.string().optional(),
      campaignIds: z.array(z.number()),
    }))
    .mutation(async ({ ctx, input }) => {
      await verifyAccountAccess(ctx.user.id, input.accountId);
      try {
        const id = await db.createPerformanceGroup({
          userId: ctx.user.id,
          accountId: input.accountId,
          name: input.name,
          description: input.description || '',
          // @ts-ignore
          optimizationGoal: input.optimizationGoal as unknown,
          targetAcos: input.targetAcos?.toString(),
          targetRoas: input.targetRoas?.toString(),
          strategyTemplateId: input.strategyTemplateId,
          strategyTemplateName: input.strategyTemplateName,
        });

        if (input.campaignIds.length > 0) {
          await db.batchAssignCampaignsToPerformanceGroup(input.campaignIds, id);
        }

        try {
          const { triggerInitialOptimization } = await import('../optimizationScheduler');
          // @ts-ignore
          triggerInitialOptimization(id, { triggeredBy: 'create' as unknown }).catch(err => {
            log.error(`[智能推荐] 触发首次优化失败:`, err);
          });
        } catch (e) {
          log.error('[智能推荐] 导入optimizationScheduler失败:', e);
        }

        log.info(`[智能推荐] 成功创建优化目标 #${id}，包含${input.campaignIds.length}个广告活动`);
        return { success: true, goalId: id, campaignCount: input.campaignIds.length };
      } catch (error: unknown) {
        log.error('[智能推荐] 创建优化目标失败:', error);
        throw new Error(`创建优化目标失败: ${(error as Error).message}`);
      }
    }),

  getSummaryBadge: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .query(async ({ input, ctx }: any) => {
      await verifyAccountAccess(ctx.user.id, input.accountId);
      const result = await scanAccountHealth(input.accountId);
      return {
        totalScanned: result.totalCampaignsScanned,
        deteriorating: result.deterioratingCampaigns,
        unmanaged: result.unmanagedDeteriorating,
        potentialSavings: result.totalPotentialSavings,
        hasRecommendations: result.recommendations.length > 0,
        criticalCount: result.recommendations.filter(r => r.priority === 'critical').length,
      };
    }),
});
