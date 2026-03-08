/**
 * monitoring.ts - 系统监控告警API路由
 * v239 - 提供监控报告查询和手动触发监控检查的API
 * v260 - 新增系统健康核心指标API（回滚率、算法激活率、ACoS趋势）
 * v261 - 新增部署后纠错报告API（纠错结果+效果验证可视化）
 */

import { z } from 'zod';
import { router, protectedProcedure } from '../_core/trpc';
import { generateMonitoringReport, runMonitoringCheck } from '../optimizationMonitoringService';
import { getSystemHealthMetrics } from '../systemHealthMetricsService';
import { getDb } from '../db';
import { optimizationEvents } from '../../drizzle/schema';
import { eq, and, sql, desc } from 'drizzle-orm';
import { apiCache } from '../services/apiCacheService';

export const monitoringRouter = router({
  /**
   * 获取当前团队的监控报告
   */
  getReport: protectedProcedure
    .query(async ({ ctx }) => {
      const teamId = ctx.user.id;
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
      } catch (e: unknown) {
        return {
          success: false,
          error: (e as Error).message,
          report: null,
        };
      }
    }),

  /**
   * 手动触发监控检查
   */
  runCheck: protectedProcedure
    .mutation(async ({ ctx }) => {
      const teamId = ctx.user.id;
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
      } catch (e: unknown) {
        return {
          success: false,
          error: (e as Error).message,
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
      // v268 性能优化: 健康指标缓存（TTL 5分钟）
      const cacheKey = `monitoring.healthMetrics:${input.accountId}:${input.days}`;
      const cached = apiCache.get<any>(cacheKey);
      if (cached) return cached;

      try {
        const metrics = await getSystemHealthMetrics(input.accountId, input.days);
        const result = {
          success: true,
          error: null,
          metrics,
        };
        apiCache.set(cacheKey, result, 5 * 60 * 1000);
        return result;
      } catch (e: unknown) {
        return {
          success: false,
          error: (e as Error).message,
          metrics: null,
        };
      }
    }),
  /**
   * v261: 获取部署后纠错报告
   * 
   * 返回最近的部署后重优化结果、纠错结果和效果验证结果
   * 用于前端仪表盘展示每次部署后的纠错执行情况
   */
  getDeployCorrectionReport: protectedProcedure
    .query(async () => {
      // v268 性能优化: 部署纠错报告缓存（TTL 10分钟）
      const cacheKey = 'monitoring.deployCorrectionReport:global';
      const cached = apiCache.get<any>(cacheKey);
      if (cached) return cached;

      try {
        const database = await getDb();
        if (!database) {
          return { success: false, error: '数据库连接失败', report: null };
        }

        // 查询最近的部署事件
        const deployEvents = await database
          .select({
            id: optimizationEvents.id,
            actionDetail: optimizationEvents.actionDetail,
            changeReason: optimizationEvents.changeReason,
            status: optimizationEvents.status,
            createdAt: optimizationEvents.createdAt,
          })
          .from(optimizationEvents)
          .where(
            and(
              eq(optimizationEvents.eventCategory, 'settings_change'),
              eq(optimizationEvents.actionType, 'settings_update'),
              sql`JSON_EXTRACT(${optimizationEvents.actionDetail}, '$.type') = 'system_deploy'`
            )
          )
          .orderBy(desc(optimizationEvents.createdAt))
          .limit(5);

        // 查询最近的效果验证事件
        const verifyEvents = await database
          .select({
            id: optimizationEvents.id,
            actionDetail: optimizationEvents.actionDetail,
            changeReason: optimizationEvents.changeReason,
            status: optimizationEvents.status,
            createdAt: optimizationEvents.createdAt,
          })
          .from(optimizationEvents)
          .where(
            and(
              eq(optimizationEvents.eventCategory, 'settings_change'),
              eq(optimizationEvents.actionType, 'auto_correction'),
              sql`JSON_EXTRACT(${optimizationEvents.actionDetail}, '$.type') = 'post_deploy_verification'`
            )
          )
          .orderBy(desc(optimizationEvents.createdAt))
          .limit(5);

        const deployHistory = deployEvents.map(e => {
          let detail: any = {};
          try { detail = JSON.parse(e.actionDetail || '{}'); } catch {}
          return {
            id: e.id,
            version: detail.systemVersion,
            previousVersion: detail.previousVersion,
            targetsProcessed: detail.targetsProcessed || 0,
            targetsSucceeded: detail.targetsSucceeded || 0,
            targetsFailed: detail.targetsFailed || 0,
            totalActions: detail.totalActions || 0,
            status: e.status,
            deployedAt: e.createdAt,
          };
        });

        const verifyHistory = verifyEvents.map(e => {
          let detail: any = {};
          try { detail = JSON.parse(e.actionDetail || '{}'); } catch {}
          return {
            id: e.id,
            version: detail.systemVersion,
            deployResult: detail.deployResult || {},
            correctionResult: detail.correctionResult || {},
            verificationResult: detail.verificationResult || {},
            status: e.status,
            verifiedAt: e.createdAt,
          };
        });

        const result = {
          success: true,
          error: null,
          report: {
            deployHistory,
            verifyHistory,
            latestDeploy: deployHistory[0] || null,
            latestVerification: verifyHistory[0] || null,
          },
        };
        apiCache.set(cacheKey, result, 10 * 60 * 1000);
        return result;
      } catch (e: unknown) {
        return {
          success: false,
          error: (e as Error).message,
          report: null,
        };
      }
    }),

  /**
   * v358.1: 获取SLO监控指标
   */
  getSLOMetrics: protectedProcedure
    .query(async () => {
      try {
        const { getSLOMetrics } = await import('../services/sync/sloMonitor');
        const metrics = await getSLOMetrics();
        return { success: true, error: null, metrics };
      } catch (e: unknown) {
        return { success: false, error: (e as Error).message, metrics: null };
      }
    }),

  /**
   * v358.1: 获取SLO趋势数据
   */
  getSLOTrend: protectedProcedure
    .input(z.object({ days: z.number().min(1).max(30).optional() }).optional())
    .query(async ({ input }) => {
      try {
        const { getSLOTrend } = await import('../services/sync/sloMonitor');
        const trend = await getSLOTrend(input?.days || 7);
        return { success: true, error: null, trend };
      } catch (e: unknown) {
        return { success: false, error: (e as Error).message, trend: [] };
      }
    }),

  /**
   * v358.1: 获取数据完整性检查报告
   */
  getIntegrityReport: protectedProcedure
    .input(z.object({ daysToCheck: z.number().min(1).max(90).optional() }).optional())
    .query(async ({ input }) => {
      try {
        const { checkAllAccountsIntegrity } = await import('../services/sync/dataIntegrityChecker');
        const report = await checkAllAccountsIntegrity(input?.daysToCheck || 14);
        return { success: true, error: null, report };
      } catch (e: unknown) {
        return { success: false, error: (e as Error).message, report: null };
      }
    }),

  /**
   * v358.1: 手动触发数据完整性检查并自动修复
   */
  triggerIntegrityCheck: protectedProcedure
    .mutation(async () => {
      try {
        const { checkAllAccountsIntegrity, executeAutoRepair } = await import('../services/sync/dataIntegrityChecker');
        const checkResult = await checkAllAccountsIntegrity(14);
        const repairResults: Array<{ accountId: number; repaired: boolean; actionsExecuted: number; errors: string[] }> = [];
        
        for (const result of checkResult.results.filter(r => r.needsRepair)) {
          const repairResult = await executeAutoRepair(result);
          repairResults.push({
            accountId: result.accountId,
            ...repairResult,
          });
        }
        
        return {
          success: true,
          error: null,
          checkResult: {
            totalAccounts: checkResult.totalAccounts,
            healthyAccounts: checkResult.healthyAccounts,
            unhealthyAccounts: checkResult.unhealthyAccounts,
          },
          repairResults,
        };
      } catch (e: unknown) {
        return { success: false, error: (e as Error).message, checkResult: null, repairResults: [] };
      }
    }),
});
