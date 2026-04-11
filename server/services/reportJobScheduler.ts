/**
 * 报告任务调度器
 * 
 * P5 增强版功能：
 * 1. 定期提交待处理的报告任务
 * 2. 定期检查已提交报告的状态
 * 3. 定期处理已完成的报告
 * 4. 定期清理过期任务
 * 5. P5e: Redis 队列深度监控和告警
 * 6. P5e: Worker 进程委托（当 P5_WORKER_ENABLED=true 时，主进程跳过后台任务）
 * 7. P5e: 启动时清理历史失败任务
 */

import { asyncReportService } from '../sync/scheduling/asyncReportService';
import { createModuleLogger } from '../utils/logger';
import { logSync, logSyncError, logSystem } from '../utils/opsLogger';

const log = createModuleLogger('ReportJobScheduler');

// 调度器配置
const SCHEDULER_CONFIG = {
  // 提交任务间隔（毫秒）
  submitInterval: 30 * 1000, // 30秒
  // 检查状态间隔（毫秒）- P5: 从60秒缩短到20秒，加速异步轮询
  checkInterval: 20 * 1000, // 20秒
  // 处理完成报告间隔（毫秒）
  processInterval: 30 * 1000, // 30秒
  // 清理过期任务间隔（毫秒）
  cleanupInterval: 24 * 60 * 60 * 1000, // 24小时
  // Redis 队列深度监控间隔（毫秒）
  queueMonitorInterval: 5 * 60 * 1000, // 5分钟
  // 每批次处理的任务数
  batchSize: {
    submit: 5,
    check: 10,
    process: 3,
  },
  // P5e: 队列深度告警阈值
  queueDepthAlertThreshold: 100,
};

class ReportJobScheduler {
  private submitTimer: NodeJS.Timeout | null = null;
  private checkTimer: NodeJS.Timeout | null = null;
  private processTimer: NodeJS.Timeout | null = null;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private queueMonitorTimer: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;

  /**
   * 启动调度器
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      log.debug('[ReportJobScheduler] Already running');
      return;
    }

    this.isRunning = true;
    log.info('[ReportJobScheduler] P5e: Starting enhanced scheduler...');
    logSystem('ReportJobScheduler', 'P5e: 报告任务调度器启动');

    // P5e: 启动时清理历史失败任务
    try {
      await this.cleanupFailedJobs();
    } catch (err: unknown) {
      log.warn(`[ReportJobScheduler] P5e: Startup cleanup failed: ${(err as Error).message}`);
    }

    // 启动提交任务定时器
    this.submitTimer = setInterval(async () => {
      try {
        const count = await asyncReportService.submitPendingJobs(SCHEDULER_CONFIG.batchSize.submit);
        if (count > 0) {
          log.info(`[ReportJobScheduler] Submitted ${count} jobs`);
          logSync('ReportJobScheduler', `提交${count}个报告任务`, { count });
        }
      } catch (error: unknown) {
        log.warn('[ReportJobScheduler] Submit error:', (error as Error).message);
        logSyncError('ReportJobScheduler', `提交报告任务失败`, { error: (error as Error).message });
      }
    }, SCHEDULER_CONFIG.submitInterval);

    // 启动检查状态定时器
    this.checkTimer = setInterval(async () => {
      try {
        const result = await asyncReportService.checkSubmittedJobs(SCHEDULER_CONFIG.batchSize.check);
        if (result.completed > 0 || result.failed > 0) {
          log.info(`[ReportJobScheduler] Check result: ${result.completed} completed, ${result.failed} failed, ${result.pending} pending`);
          logSync('ReportJobScheduler', `检查报告状态`, { completed: result.completed, failed: result.failed, pending: result.pending });
        }
      } catch (error: unknown) {
        log.warn('[ReportJobScheduler] Check error:', (error as Error).message);
        logSyncError('ReportJobScheduler', `检查报告状态失败`, { error: (error as Error).message });
      }
    }, SCHEDULER_CONFIG.checkInterval);

    // 启动处理完成报告定时器
    this.processTimer = setInterval(async () => {
      try {
        const count = await asyncReportService.processCompletedJobs(SCHEDULER_CONFIG.batchSize.process);
        if (count > 0) {
          log.info(`[ReportJobScheduler] Processed ${count} jobs`);
          logSync('ReportJobScheduler', `处理${count}个已完成报告`, { count });
        }
      } catch (error: unknown) {
        log.warn('[ReportJobScheduler] Process error:', (error as Error).message);
        logSyncError('ReportJobScheduler', `处理报告失败`, { error: (error as Error).message });
      }
    }, SCHEDULER_CONFIG.processInterval);

    // 启动清理过期任务定时器
    this.cleanupTimer = setInterval(async () => {
      try {
        const count = await asyncReportService.cleanupExpiredJobs(7);
        if (count > 0) {
          log.info(`[ReportJobScheduler] Cleaned up ${count} expired jobs`);
          logSync('ReportJobScheduler', `清理${count}个过期任务`, { count });
        }
      } catch (error: unknown) {
        log.warn('[ReportJobScheduler] Cleanup error:', (error as Error).message);
        logSyncError('ReportJobScheduler', `清理过期任务失败`, { error: (error as Error).message });
      }
    }, SCHEDULER_CONFIG.cleanupInterval);

    // P5e: 启动 Redis 队列深度监控
    this.queueMonitorTimer = setInterval(async () => {
      try {
        await this.monitorQueueDepth();
      } catch (error: unknown) {
        log.warn('[ReportJobScheduler] Queue monitor error:', (error as Error).message);
      }
    }, SCHEDULER_CONFIG.queueMonitorInterval);

    log.info('[ReportJobScheduler] P5e: Started successfully with queue monitoring');
    logSystem('ReportJobScheduler', 'P5e: 报告任务调度器启动完成（含队列监控）');
  }

  /**
   * 停止调度器
   */
  stop(): void {
    if (!this.isRunning) {
      log.debug('[ReportJobScheduler] Not running');
      return;
    }

    if (this.submitTimer) {
      clearInterval(this.submitTimer);
      this.submitTimer = null;
    }
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
    if (this.processTimer) {
      clearInterval(this.processTimer);
      this.processTimer = null;
    }
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    if (this.queueMonitorTimer) {
      clearInterval(this.queueMonitorTimer);
      this.queueMonitorTimer = null;
    }

    this.isRunning = false;
    log.info('[ReportJobScheduler] Stopped');
    logSystem('ReportJobScheduler', '报告任务调度器已停止');
  }

  /**
   * 获取调度器状态
   */
  getStatus(): { isRunning: boolean } {
    return { isRunning: this.isRunning };
  }

  /**
   * 手动触发一次完整的处理周期
   */
  async runOnce(): Promise<{
    submitted: number;
    checked: { completed: number; failed: number; pending: number };
    processed: number;
  }> {
    log.info('[ReportJobScheduler] Running manual cycle...');

    const submitted = await asyncReportService.submitPendingJobs(SCHEDULER_CONFIG.batchSize.submit);
    const checked = await asyncReportService.checkSubmittedJobs(SCHEDULER_CONFIG.batchSize.check);
    const processed = await asyncReportService.processCompletedJobs(SCHEDULER_CONFIG.batchSize.process);

    log.info(`[ReportJobScheduler] Manual cycle complete: submitted=${submitted}, checked=${JSON.stringify(checked)}, processed=${processed}`);
    logSync('ReportJobScheduler', `手动周期完成`, { submitted, checked, processed });

    return { submitted, checked, processed };
  }

  /**
   * P5e: 监控 Redis 队列深度和 report_jobs 状态分布
   */
  private async monitorQueueDepth(): Promise<void> {
    try {
      const { getRedis, isRedisAvailable } = await import('../utils/redisClient');
      
      // 监控 Redis 队列深度
      if (isRedisAvailable() && getRedis()) {
        const redis = getRedis()!;
        const queueKeys = [
          'sync:task:queue:critical',
          'sync:task:queue:high',
          'sync:task:queue:medium',
          'sync:task:queue:low',
        ];
        
        let totalDepth = 0;
        const depths: Record<string, number> = {};
        
        for (const key of queueKeys) {
          const len = await redis.llen(key);
          const priority = key.split(':').pop() || 'unknown';
          depths[priority] = len;
          totalDepth += len;
        }
        
        log.info(`[P5e:QueueMonitor] Redis queue depth: total=${totalDepth}, critical=${depths.critical || 0}, high=${depths.high || 0}, medium=${depths.medium || 0}, low=${depths.low || 0}`);
        
        // 队列深度告警
        if (totalDepth > SCHEDULER_CONFIG.queueDepthAlertThreshold) {
          log.warn(`[P5e:QueueMonitor] ALERT: Queue depth ${totalDepth} exceeds threshold ${SCHEDULER_CONFIG.queueDepthAlertThreshold}`);
          logSyncError('QueueMonitor', `队列深度告警: ${totalDepth} 超过阈值 ${SCHEDULER_CONFIG.queueDepthAlertThreshold}`, { totalDepth, depths });
        }
      }
      
      // 监控 report_jobs 状态分布
      try {
        const { getDb } = await import('../db');
        const { reportJobs } = await import('../../drizzle/schema');
        const { sql } = await import('drizzle-orm');
        const db = await getDb();
        if (db) {
          const statusCounts = await db.select({
            status: reportJobs.status,
            count: sql<number>`count(*)`,
          }).from(reportJobs).groupBy(reportJobs.status);
          
          const statusMap: Record<string, number> = {};
          for (const row of statusCounts) {
            statusMap[row.status] = Number(row.count);
          }
          
          log.info(`[P5e:QueueMonitor] Report jobs status: pending=${statusMap.pending || 0}, submitted=${statusMap.submitted || 0}, completed=${statusMap.completed || 0}, processed=${statusMap.processed || 0}, failed=${statusMap.failed || 0}, expired=${statusMap.expired || 0}`);
        }
      } catch (dbErr: unknown) {
        log.debug(`[P5e:QueueMonitor] DB status check failed: ${(dbErr as Error).message}`);
      }
    } catch (err: unknown) {
      log.debug(`[P5e:QueueMonitor] Monitor failed: ${(err as Error).message}`);
    }
  }

  /**
   * P5e: 清理历史失败任务（启动时执行一次）
   * 将 P5b/P5c 阶段因 400 错误积压的失败任务标记为 expired
   */
  private async cleanupFailedJobs(): Promise<void> {
    try {
      const { getDb } = await import('../db');
      const { reportJobs } = await import('../../drizzle/schema');
      const { eq, and, lt, sql } = await import('drizzle-orm');
      const db = await getDb();
      if (!db) return;

      // 清理超过 2 小时的 failed 和 submitted 状态任务
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      
      const [result] = await db.update(reportJobs)
        .set({ status: 'expired', errorMessage: 'P5e: Cleaned up stale job on startup' })
        .where(and(
          sql`${reportJobs.status} IN ('failed', 'submitted')`,
          sql`${reportJobs.updatedAt} < ${twoHoursAgo}`,
        ));
      
      const affected = (result as { affectedRows?: number }).affectedRows || 0;
      if (affected > 0) {
        log.info(`[P5e:Cleanup] Cleaned up ${affected} stale report jobs on startup`);
        logSystem('ReportJobScheduler', `P5e: 启动清理 ${affected} 个过期任务`);
      }
    } catch (err: unknown) {
      log.warn(`[P5e:Cleanup] Failed to clean up stale jobs: ${(err as Error).message}`);
    }
  }
}

// 导出单例
export const reportJobScheduler = new ReportJobScheduler();
