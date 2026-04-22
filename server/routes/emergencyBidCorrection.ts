/**
 * v717: 紧急出价修复路由
 * 
 * 提供管理后台触发全量出价修复的API入口
 */
import { z } from 'zod';
import { router, protectedProcedure, adminProcedure } from '../trpc';
import { createModuleLogger } from '../utils/logger';

const log = createModuleLogger('EmergencyBidCorrectionRoute');

export const emergencyBidCorrectionRouter = router({
  /**
   * 触发紧急全量出价修复
   * 仅管理员可操作
   */
  triggerEmergencyCorrection: adminProcedure
    .input(z.object({
      dryRun: z.boolean().default(true),
      accountId: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      log.info(`[v717] 触发紧急出价修复: dryRun=${input.dryRun}, accountId=${input.accountId || '全部'}`);
      
      try {
        const { runEmergencyBidCorrection } = await import('../scripts/emergencyBidCorrection');
        const summaries = await runEmergencyBidCorrection({
          dryRun: input.dryRun,
          accountId: input.accountId,
        });
        
        const totalEntities = summaries.reduce((sum, s) => sum + s.totalEntities, 0);
        const totalCorrections = summaries.reduce((sum, s) => sum + s.entitiesNeedCorrection, 0);
        const totalApplied = summaries.reduce((sum, s) => sum + s.correctionsApplied, 0);
        const totalFailed = summaries.reduce((sum, s) => sum + s.correctionsFailed, 0);
        
        return {
          success: true,
          mode: input.dryRun ? 'dry_run' : 'live',
          summary: {
            accountsProcessed: summaries.length,
            totalEntities,
            totalCorrections,
            totalApplied,
            totalFailed,
          },
          details: summaries.map(s => ({
            accountId: s.accountId,
            marketplace: s.marketplace,
            entities: s.totalEntities,
            analyzed: s.entitiesAnalyzed,
            corrections: s.entitiesNeedCorrection,
            applied: s.correctionsApplied,
            failed: s.correctionsFailed,
            bidIncreases: s.bidIncreases,
            bidDecreases: s.bidDecreases,
            avgChangePercent: s.avgBidChangePercent,
            errors: s.errors.slice(0, 5),
          })),
        };
      } catch (err: unknown) {
        log.error(`[v717] 紧急出价修复执行失败: ${(err as Error).message}`);
        return {
          success: false,
          error: (err as Error).message,
          mode: input.dryRun ? 'dry_run' : 'live',
        };
      }
    }),

  /**
   * 查询锚点分析结果
   */
  getAnchorAnalysis: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      degradationLevel: z.enum(['none', 'mild', 'severe', 'critical']).optional(),
      correctionAction: z.enum(['maintain', 'gradual_restore', 'restore_to_anchor', 'update_anchor', 'emergency_restore']).optional(),
      limit: z.number().default(50),
      offset: z.number().default(0),
    }))
    .query(async ({ input }) => {
      const { getDb } = await import('../db');
      const { bidAnchorAnalysis } = await import('../../drizzle/schema');
      const { eq, and, sql } = await import('drizzle-orm');
      
      const db = await getDb();
      if (!db) return { items: [], total: 0 };
      
      const conditions: unknown[] = [eq(bidAnchorAnalysis.accountId, input.accountId)];
      if (input.degradationLevel) {
        conditions.push(eq(bidAnchorAnalysis.degradationLevel, input.degradationLevel));
      }
      if (input.correctionAction) {
        conditions.push(eq(bidAnchorAnalysis.correctionAction, input.correctionAction));
      }
      
      const items = await db
        .select()
        .from(bidAnchorAnalysis)
        // @ts-expect-error - Drizzle dynamic where conditions
        .where(and(...conditions))
        .limit(input.limit)
        .offset(input.offset)
        .orderBy(sql`analyzed_at DESC`);
      
      const [countResult] = await db
        .select({ count: sql<number>`count(*)` })
        .from(bidAnchorAnalysis)
        // @ts-expect-error - Drizzle dynamic where conditions
        .where(and(...conditions));
      
      return {
        items,
        total: countResult?.count || 0,
      };
    }),
});
