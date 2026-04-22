/**
 * v717-fix5: 紧急出价修复路由
 * 
 * 提供管理后台触发全量出价修复的API入口
 * 使用异步模式：立即返回，后台执行修复
 */
import { z } from 'zod';
import { router, protectedProcedure, adminProcedure } from '../_core/trpc';
import { createModuleLogger } from '../utils/logger';

const log = createModuleLogger('EmergencyBidCorrectionRoute');

// 全局状态追踪
let _isRunning = false;
let _lastResult: unknown = null;
let _startedAt: string | null = null;

export const emergencyBidCorrectionRouter = router({
  /**
   * 触发紧急全量出价修复（异步模式）
   * 立即返回，后台执行
   */
  triggerEmergencyCorrection: adminProcedure
    .input(z.object({
      dryRun: z.boolean().default(true),
      accountId: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      log.info(`[v717-fix5] 触发紧急出价修复: dryRun=${input.dryRun}, accountId=${input.accountId || '全部'}`);
      
      if (_isRunning) {
        return {
          success: false,
          message: `修复任务正在运行中（启动于 ${_startedAt}），请稍后查询状态`,
          status: 'already_running',
        };
      }
      
      // 立即标记为运行中
      _isRunning = true;
      _startedAt = new Date().toISOString();
      _lastResult = null;
      
      // 后台异步执行 - 不await
      (async () => {
        try {
          const { runEmergencyBidCorrection } = await import('../scripts/emergencyBidCorrection');
          const result = await runEmergencyBidCorrection({
            dryRun: input.dryRun,
            targetAccountId: input.accountId || null,
          });
          
          _lastResult = {
            success: true,
            completedAt: new Date().toISOString(),
            mode: input.dryRun ? 'dry_run' : 'live',
            duration: result.duration,
            summary: {
              accountsProcessed: result.processedAccounts,
              totalCorrections: result.totalCorrections,
              totalApplied: result.totalApplied,
              totalFailed: result.totalFailed,
            },
            details: result.summaries.map(s => ({
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
          
          log.info(`[v717-fix5] 紧急出价修复完成: ${result.totalCorrections}需修正, ${result.totalApplied}已推送, 耗时${result.duration}`);
        } catch (err: unknown) {
          log.error(`[v717-fix5] 紧急出价修复执行失败: ${(err as Error).message}`);
          _lastResult = {
            success: false,
            completedAt: new Date().toISOString(),
            error: (err as Error).message,
          };
        } finally {
          _isRunning = false;
        }
      })();
      
      // 立即返回
      return {
        success: true,
        message: '紧急出价修复已启动，请通过 getEmergencyCorrectionStatus 查询进度',
        status: 'started',
        startedAt: _startedAt,
        mode: input.dryRun ? 'dry_run' : 'live',
      };
    }),

  /**
   * 查询紧急修复执行状态
   */
  getEmergencyCorrectionStatus: adminProcedure
    .query(async () => {
      return {
        isRunning: _isRunning,
        startedAt: _startedAt,
        lastResult: _lastResult,
      };
    }),

  /**
   * 查询锚点分析结果
   */
  getAnchorAnalysis: protectedProcedure
    .input(z.object({
      accountId: z.number(),
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
