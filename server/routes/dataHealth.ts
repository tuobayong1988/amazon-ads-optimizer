/**
 * v359: 数据健康仪表盘API
 * 
 * 提供数据同步健康状况、限流指标、自愈状态、确认队列状态等
 * 综合性的系统运行状态监控端点
 */
import { z } from 'zod';
import { router, protectedProcedure } from '../_core/trpc';
import { createModuleLogger } from '../utils/logger';

const log = createModuleLogger('DataHealthAPI');

export const dataHealthRouter = router({
  /**
   * 获取综合数据健康概览
   * 聚合所有子系统的健康状态
   */
  getOverview: protectedProcedure
    .query(async ({ ctx }: any) => {
      try {
        const results: Record<string, any> = {};
        
        // 1. 获取限流服务指标
        try {
          const { getApiRateLimitService } = await import('../services/apiRateLimitService');
          const rateLimitService = getApiRateLimitService();
          if (rateLimitService) {
            results.rateLimiting = {
              status: 'active',
              metrics: rateLimitService.getAllMetrics(),
              configs: rateLimitService.getConfigs(),
            };
          } else {
            results.rateLimiting = { status: 'not_initialized', metrics: [], configs: {} };
          }
        } catch {
          results.rateLimiting = { status: 'unavailable', metrics: [], configs: {} };
        }
        
        // 2. 获取自愈调度器状态
        // v373: 修复非Leader实例显示"已停止"问题
        // 自愈调度器只在Leader实例上运行，非Leader实例查询本地状态会显示"stopped"
        // 解决方案：先检查本地状态，如果本地未运行则检查是否为Leader实例
        try {
          const { getSelfHealingScheduler } = await import('../services/selfHealingScheduler');
          const scheduler = getSelfHealingScheduler();
          if (scheduler) {
            const status = scheduler.getStatus();
            if (status.running) {
              // 本实例是Leader，自愈正在运行
              results.selfHealing = {
                status: 'running',
                ...status,
                recentHistory: scheduler.getRecentHistory(10),
              };
            } else {
              // v373: 本实例可能不是Leader，检查Leader状态
              try {
                const { isCurrentLeader, getLeaderStatus } = await import('../utils/leaderElection');
                const leaderStatus = getLeaderStatus();
                if (!isCurrentLeader()) {
                  // 非Leader实例，自愈在其他实例上运行
                  results.selfHealing = {
                    status: 'running_on_leader',
                    message: `自愈调度器在Leader实例(${leaderStatus.instanceId})上运行`,
                    running: true,
                    instanceMode: leaderStatus.mode,
                    recentHistory: [],
                  };
                } else {
                  // 是Leader但未运行，可能刚启动还未初始化
                  results.selfHealing = {
                    status: 'initializing',
                    message: 'Leader实例自愈调度器正在初始化',
                    running: false,
                    recentHistory: [],
                  };
                }
              } catch {
                results.selfHealing = { status: 'stopped', ...status, recentHistory: scheduler.getRecentHistory(10) };
              }
            }
          } else {
            results.selfHealing = { status: 'not_initialized' };
          }
        } catch {
          results.selfHealing = { status: 'unavailable' };
        }
        
        // 3. 获取确认服务状态
        try {
          const { getCommandConfirmationService } = await import('../services/commandConfirmationService');
          const confirmService = getCommandConfirmationService();
          if (confirmService) {
            results.confirmationService = {
              status: 'active',
              metrics: confirmService.getMetrics(),
            };
          } else {
            results.confirmationService = { status: 'not_initialized' };
          }
        } catch {
          results.confirmationService = { status: 'unavailable' };
        }
        
        // 4. 获取同步任务状态
        try {
          const { getDb } = await import('../db');
          const db = await getDb();
          if (db) {
            const { dataSyncJobs } = await import('../../drizzle/schema');
            const { desc, eq, sql } = await import('drizzle-orm');
            
            // v370.4: 多租户数据隔离 - 只查询当前用户的账户数据
            const { adAccounts } = await import('../../drizzle/schema');
            const userAccountRows = await db.select({ id: adAccounts.id }).from(adAccounts).where(sql`${adAccounts.userId} = ${ctx.user?.id || 0}`);
            const userAccountIds = userAccountRows.map((r: any) => r.id);
            const accountFilter = userAccountIds.length > 0 
              ? sql`${dataSyncJobs.accountId} IN (${sql.raw(userAccountIds.join(','))})` 
              : sql`1=0`;
            
            // 最近的同步任务（仅当前用户的账户）
            const recentJobs = await db.select({
              id: dataSyncJobs.id,
              accountId: dataSyncJobs.accountId,
              status: dataSyncJobs.status,
              startedAt: dataSyncJobs.startedAt,
              completedAt: dataSyncJobs.completedAt,
              totalSteps: dataSyncJobs.totalSteps,
              currentStepIndex: dataSyncJobs.currentStepIndex,
              errorMessage: dataSyncJobs.errorMessage,
            })
            .from(dataSyncJobs)
            .where(accountFilter)
            .orderBy(desc(dataSyncJobs.startedAt))
            .limit(10);
            
            // 同步成功率统计（最近24小时，仅当前用户的账户）
            const [syncStats] = await db.select({
              total: sql<number>`COUNT(*)`,
              succeeded: sql<number>`SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END)`,
              failed: sql<number>`SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END)`,
              running: sql<number>`SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END)`,
            })
            .from(dataSyncJobs)
            .where(sql`${dataSyncJobs.startedAt} >= DATE_SUB(NOW(), INTERVAL 24 HOUR) AND ${accountFilter}`);
            
            results.syncJobs = {
              status: 'active',
              recent: recentJobs,
              stats24h: {
                total: Number(syncStats?.total || 0),
                succeeded: Number(syncStats?.succeeded || 0),
                failed: Number(syncStats?.failed || 0),
                running: Number(syncStats?.running || 0),
                successRate: syncStats?.total ? 
                  Math.round((Number(syncStats.succeeded || 0) / Number(syncStats.total)) * 100) : 0,
              },
            };
          }
        } catch {
          results.syncJobs = { status: 'unavailable' };
        }
        
        // 5. 计算综合健康评分
        let healthScore = 100;
        const issues: string[] = [];
        
        // 限流健康
        if ((results.rateLimiting as any)?.status !== 'active') {
          healthScore -= 10;
          issues.push('限流服务未激活');
        }
        
        // 自愈健康 - v373: 兼容running_on_leader状态
        const selfHealingStatus = (results.selfHealing as any)?.status;
        if (selfHealingStatus !== 'running' && selfHealingStatus !== 'running_on_leader' && selfHealingStatus !== 'initializing') {
          healthScore -= 15;
          issues.push('自愈调度器未运行');
        }
        
        // 同步健康
        const syncStats = (results.syncJobs as any)?.stats24h;
        if (syncStats) {
          if (syncStats.successRate < 90) {
            healthScore -= 20;
            issues.push(`同步成功率偏低: ${syncStats.successRate}%`);
          }
          if (syncStats.failed > 3) {
            healthScore -= 10;
            issues.push(`24h内同步失败${syncStats.failed}次`);
          }
        }
        
        results.overall = {
          healthScore: Math.max(0, healthScore),
          status: healthScore >= 80 ? 'healthy' : healthScore >= 60 ? 'degraded' : 'unhealthy',
          issues,
          lastChecked: new Date().toISOString(),
        };
        
        return { success: true, error: null, data: results };
      } catch (e: unknown) {
        log.error('获取数据健康概览失败', e);
        return { success: false, error: (e as Error).message, data: null };
      }
    }),
  
  /**
   * 获取限流服务详细指标
   */
  getRateLimitMetrics: protectedProcedure
    .input(z.object({ accountId: z.number().optional() }).optional())
    .query(async ({ input }: any) => {
      try {
        const { getApiRateLimitService } = await import('../services/apiRateLimitService');
        const service = getApiRateLimitService();
        if (!service) {
          return { success: false, error: '限流服务未初始化', metrics: [] };
        }
        
        const metrics = input?.accountId 
          ? service.getMetrics(input.accountId)
          : service.getAllMetrics();
        
        return { success: true, error: null, metrics, configs: service.getConfigs() };
      } catch (e: unknown) {
        return { success: false, error: (e as Error).message, metrics: [] };
      }
    }),
  
  /**
   * 获取自愈调度器详细状态
   */
  getSelfHealingStatus: protectedProcedure
    .query(async () => {
      try {
        const { getSelfHealingScheduler } = await import('../services/selfHealingScheduler');
        const scheduler = getSelfHealingScheduler();
        if (!scheduler) {
          return { success: false, error: '自愈调度器未初始化', status: null };
        }
        
        return {
          success: true,
          error: null,
          status: scheduler.getStatus(),
          recentHistory: scheduler.getRecentHistory(20),
        };
      } catch (e: unknown) {
        return { success: false, error: (e as Error).message, status: null };
      }
    }),
  
  /**
   * 获取指令确认队列状态
   */
  getConfirmationStatus: protectedProcedure
    .query(async () => {
      try {
        const { getCommandConfirmationService } = await import('../services/commandConfirmationService');
        const service = getCommandConfirmationService();
        if (!service) {
          return { success: false, error: '确认服务未初始化', metrics: null };
        }
        
        return {
          success: true,
          error: null,
          metrics: service.getMetrics(),
        };
      } catch (e: unknown) {
        return { success: false, error: (e as Error).message, metrics: null };
      }
    }),
});
