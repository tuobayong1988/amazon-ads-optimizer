/**
 * monitoring.ts - 系统监控告警API路由
 * v239 - 提供监控报告查询和手动触发监控检查的API
 * v260 - 新增系统健康核心指标API（回滚率、算法激活率、ACoS趋势）
 */

import { z } from 'zod';
import { router, protectedProcedure } from '../_core/trpc';
import { generateMonitoringReport, runMonitoringCheck } from '../optimizationMonitoringService';
import { getSystemHealthMetrics } from '../systemHealthMetricsService';

export const monitoringRouter = router({
  /**
   * 获取当前团队的监控报告
   */
  getReport: protectedProcedure
    .query(async ({ ctx }) => {
      const teamId = ctx.user.teamId;
      if (!teamId) {
        return {
          success: false,
          error: '未关联团队',
          report: null,
        };
      }

      try {
        const report = await generateMonitoringReport(teamId);
        return {
          success: true,
          error: null,
          report: {
            ...report,
            generatedAt: report.generatedAt.toISOString(),
            alerts: report.alerts.map(a => ({
              ...a,
              timestamp: a.timestamp.toISOString(),
            })),
          },
        };
      } catch (e: any) {
        return {
          success: false,
          error: e.message,
          report: null,
        };
      }
    }),

  /**
   * 手动触发监控检查
   */
  runCheck: protectedProcedure
    .mutation(async ({ ctx }) => {
      const teamId = ctx.user.teamId;
      if (!teamId) {
        return {
          success: false,
          error: '未关联团队',
          report: null,
        };
      }

      try {
        const report = await runMonitoringCheck(teamId);
        return {
          success: true,
          error: null,
          report: {
            ...report,
            generatedAt: report.generatedAt.toISOString(),
            alerts: report.alerts.map(a => ({
              ...a,
              timestamp: a.timestamp.toISOString(),
            })),
          },
        };
      } catch (e: any) {
        return {
          success: false,
          error: e.message,
          report: null,
        };
      }
    }),

  /**
   * v260: 获取系统健康核心指标
   * 
   * 返回回滚率、算法激活率、ACoS趋势、提价分析、熔断触发率等核心指标
   * 用于前端仪表盘实时展示系统健康状况
   */
  getHealthMetrics: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      days: z.number().optional().default(7),
    }))
    .query(async ({ input }) => {
      try {
        const metrics = await getSystemHealthMetrics(input.accountId, input.days);
        return {
          success: true,
          error: null,
          metrics,
        };
      } catch (e: any) {
        return {
          success: false,
          error: e.message,
          metrics: null,
        };
      }
    }),
});
