/**
 * monitoring.ts - 系统监控告警API路由
 * v239 - 提供监控报告查询和手动触发监控检查的API
 */

import { z } from 'zod';
import { router, protectedProcedure } from '../_core/trpc';
import { generateMonitoringReport, runMonitoringCheck } from '../optimizationMonitoringService';

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
});
