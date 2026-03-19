/**
 * 报告任务调度器
 * 
 * 功能：
 * 1. 定期提交待处理的报告任务
 * 2. 定期检查已提交报告的状态
 * 3. 定期处理已完成的报告
 * 4. 定期清理过期任务
 */

import { asyncReportService } from '../sync/scheduling/asyncReportService';
import { createModuleLogger } from '../utils/logger';
import { logSync, logSyncError, logSystem } from '../utils/opsLogger';

const log = createModuleLogger('ReportJobScheduler');

// 调度器配置
const SCHEDULER_CONFIG = {
  // 提交任务间隔（毫秒）
  submitInterval: 30 * 1000, // 30秒
  // 检查状态间隔（毫秒）
  checkInterval: 60 * 1000, // 1分钟
  // 处理完成报告间隔（毫秒）
  processInterval: 30 * 1000, // 30秒
  // 清理过期任务间隔（毫秒）
  cleanupInterval: 24 * 60 * 60 * 1000, // 24小时
  // 每批次处理的任务数
  batchSize: {
    submit: 5,
    check: 10,
    process: 3,
  },
};

class ReportJobScheduler {
  private submitTimer: NodeJS.Timeout | null = null;
  private checkTimer: NodeJS.Timeout | null = null;
  private processTimer: NodeJS.Timeout | null = null;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;

  /**
   * 启动调度器
   */
  start(): void {
    if (this.isRunning) {
      log.debug('[ReportJobScheduler] Already running');
      return;
    }

    this.isRunning = true;
    log.info('[ReportJobScheduler] Starting...');
    logSystem('ReportJobScheduler', '报告任务调度器启动');

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

    log.info('[ReportJobScheduler] Started successfully');
    logSystem('ReportJobScheduler', '报告任务调度器启动完成');
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
}

// 导出单例
export const reportJobScheduler = new ReportJobScheduler();
