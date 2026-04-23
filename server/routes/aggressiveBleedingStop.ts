/**
 * v721: 激进止血路由
 * 
 * 两阶段纠正策略 - 第一阶段：激进止血
 * 将所有严重偏离健康基线的实体一次性拉回安全范围
 */
import { z } from 'zod';
import { router, adminProcedure } from '../_core/trpc';
import { createModuleLogger } from '../utils/logger';

const log = createModuleLogger('AggressiveBleedingStop');

let _isRunning = false;
let _lastResult: unknown = null;
let _startedAt: string | null = null;

export const aggressiveBleedingStopRouter = router({
  /**
   * 触发激进止血（异步模式）
   */
  triggerBleedingStop: adminProcedure
    .input(z.object({
      dryRun: z.boolean().default(true),
      accountIds: z.array(z.number()).optional(),
      dimensions: z.array(z.enum(["bid", "hourparting", "dayparting", "placement"])).optional(),
    }))
    .mutation(async ({ input }) => {
      log.info(`[v721] 触发激进止血: dryRun=${input.dryRun}, dims=${input.dimensions?.join(",") || "全部"}`);
      
      if (_isRunning) {
        return {
          success: false,
          message: `止血任务正在运行中（启动于 ${_startedAt}）`,
          status: 'already_running' as const,
        };
      }
      
      _isRunning = true;
      _startedAt = new Date().toISOString();
      _lastResult = null;
      
      // 后台异步执行
      (async () => {
        try {
          const { executeAggressiveBleedingStop } = await import('../scripts/aggressiveBleedingStop');
          const result = await executeAggressiveBleedingStop({
            dryRun: input.dryRun,
            accountIds: input.accountIds,
            dimensions: input.dimensions as any,
          });
          
          _lastResult = {
            success: true,
            completedAt: new Date().toISOString(),
            mode: input.dryRun ? 'dry_run' : 'live',
            ...result.overallSummary,
            bidSummary: {
              analyzed: result.bidResult.analyzed,
              corrected: result.bidResult.corrected,
              failed: result.bidResult.failed,
            },
            hourpartingSummary: {
              analyzed: result.hourpartingResult.analyzed,
              corrected: result.hourpartingResult.corrected,
              failed: result.hourpartingResult.failed,
            },
            daypartingSummary: {
              analyzed: result.daypartingResult.analyzed,
              corrected: result.daypartingResult.corrected,
              failed: result.daypartingResult.failed,
            },
            placementSummary: {
              analyzed: result.placementResult.analyzed,
              corrected: result.placementResult.corrected,
              failed: result.placementResult.failed,
            },
          };
          
          log.info(`[v721] 止血完成: corrected=${result.overallSummary.totalCorrected}`);
        } catch (err: any) {
          log.error(`[v721] 止血失败: ${err.message}`);
          _lastResult = {
            success: false,
            error: err.message,
            completedAt: new Date().toISOString(),
          };
        } finally {
          _isRunning = false;
        }
      })();
      
      return {
        success: true,
        message: `止血任务已启动（${input.dryRun ? 'DRY RUN' : 'LIVE'}模式）`,
        status: 'started' as const,
        startedAt: _startedAt,
      };
    }),

  /**
   * 查询止血任务状态
   */
  getBleedingStopStatus: adminProcedure
    .query(async () => {
      return {
        isRunning: _isRunning,
        startedAt: _startedAt,
        lastResult: _lastResult,
      };
    }),
});
