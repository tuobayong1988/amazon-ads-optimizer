/**
 * Data Sync Scheduler Service - 定时数据同步调度服务
 * 实现分层同步策略，根据Amazon API速率限制优化同步频率
 * 
 * v488重构：
 * - 接入SyncCoordinator同步协调器，支持手动同步冷却期和优先级抢占
 * - 自动同步在创建任务前检查账号是否处于MANUAL_OVERRIDE状态
 * - 处于手动接管状态的账号将被自动跳过，直到手动同步完成
 * - 新增全局互斥保护，同一时间只允许一个同步层级运行
 * 
 * 同步策略：
 * - 高频同步（每30分钟）：广告活动状态、预算
 * - 中频同步（每60分钟）：广告组、关键词、定位
 * - 完整同步（每3小时）：所有数据
 * - 夜间同步（每24小时）：耗时最长的绩效报表
 */

import * as db from '../db';
import { sql } from 'drizzle-orm';
import { AmazonSyncService } from './amazonSyncService';
import { notifyOwner } from '../_core/notification';
import { getLocalHour, getLocalDayOfWeek, getAccountMarketplace, MARKETPLACE_TIMEZONES } from '../algorithm/algorithmUtils';
import * as automationExecutionEngine from '../automation/automationExecutionEngine';
import * as searchTermHarvester from '../automation/searchTermHarvester';
import { detectRiskSignals } from '../analytics/attributionWindowHelper';
import * as campaignLifecycleService from '../services/campaignLifecycleService';
import { runAutoCorrection, startAutoCorrector, stopAutoCorrector } from '../optimization/optimizationAutoCorrector';
import * as nextGenOrchestrator from '../optimization/nextGenBidOrchestrator';
import { createModuleLogger } from '../utils/logger';
import { AsyncMutex, withMutex } from '../utils/asyncMutex';
import { logSync, logSyncWarn, logSyncError, logSystem, logOptimization, logOptimizationError } from '../utils/opsLogger';
import {
  acquireAccountOptimizationLock as _lmAcquireLock,
  releaseAccountOptimizationLock as _lmReleaseLock,
  acquireAccountOptimizationLockWithRetry as _lmAcquireLockWithRetry,
  getModuleLockGroup as _lmGetModuleLockGroup,
} from '../utils/lockManager';
import {
  isAccountInManualOverride,
  acquireGlobalMutex,
  releaseGlobalMutex,
  cleanupExpiredOverrides,
  getCoordinatorStatus,
  shouldAbortAutoSync,
} from './syncCoordinator';
// v384: 移除Leader选举依赖，改为单实例直接启动模式
// import { startLeaderElection, isCurrentLeader, getLeaderStatus, stopLeaderElection } from '../utils/leaderElection';

const log = createModuleLogger('Scheduler');

// 同步层级定义
export type SyncTier = 'high' | 'medium' | 'low' | 'full' | 'nightly';

// 同步层级配置
const SYNC_TIER_CONFIG: Record<SyncTier, {
  intervalMs: number;
  description: string;
  syncTypes: string[];
}> = {
  high: {
    intervalMs: 30 * 60 * 1000, // v488: 30分钟（从15分钟调整，降低API压力，优先保证精准）
    description: 'v488: 高频同步 - 广告活动状态和预算，每30分钟',
    syncTypes: ['campaigns_status', 'budgets'],
  },
  medium: {
    intervalMs: 60 * 60 * 1000, // v488: 60分钟（从30分钟调整，与高频同步错开）
    description: 'v488: 中频同步 - 广告组、关键词、定位，每60分钟',
    syncTypes: ['ad_groups', 'keywords', 'targets'],
  },
  low: {
    intervalMs: 60 * 60 * 1000, // 1小时
    description: '低频同步 - 完整数据同步',
    syncTypes: ['full_sync'],
  },
  full: {
    intervalMs: 3 * 60 * 60 * 1000, // v488: 3小时（从2小时调整，给API令牌桶充足的恢复时间）
    description: 'v488: 完整同步 - 所有数据（SP 90天/SB 60天/SD 90天），每3小时',
    syncTypes: ['all'],
  },
  nightly: {
    intervalMs: 24 * 60 * 60 * 1000, // v403: 24小时（每日凌晨执行一次）
    description: 'v488: 夜间同步 - 耗时最长的关键词/定位/广告组绩效报表，超时时间4小时',
    syncTypes: ['keyword_performance', 'target_performance', 'ad_group_performance'],
  },
};

// 调度器状态
interface SchedulerStatus {
  isRunning: boolean;
  lastRunTime: Date | null;
  nextRunTime: Date | null;
  totalSyncs: number;
  successfulSyncs: number;
  failedSyncs: number;
  errors: string[];
  currentTier: SyncTier | null;
  tierLastRun: Record<SyncTier, Date | null>;
}

let schedulerStatus: SchedulerStatus = {
  isRunning: false,
  lastRunTime: null,
  nextRunTime: null,
  totalSyncs: 0,
  successfulSyncs: 0,
  failedSyncs: 0,
  errors: [],
  currentTier: null,
  tierLastRun: {
    high: null,
    medium: null,
    low: null,
    full: null,
    nightly: null,
  },
};

let schedulerIntervals: Record<string, NodeJS.Timeout | null> = {
  high: null,
  medium: null,
  low: null,
  full: null,
  nightly: null,
  confirmation: null,
};

// v361: 监控和辅助定时器的引用，确保可以在停止时清理
const monitoringIntervals: NodeJS.Timeout[] = [];

// API请求队列，用于控制请求速率
interface QueuedRequest {
  accountId: number;
  userId: number;
  tier: SyncTier;
  timestamp: number;
}

const requestQueue: QueuedRequest[] = [];
let isProcessingQueue = false;

// 请求间隔（毫秒）- 每个API调用之间的最小间隔
const REQUEST_INTERVAL_MS = 200;

// ==================== v488: 同步协调器常量 ====================

/** v488: 同步层级之间的冷却间隔（毫秒）- 上一个层级完成后等待此时间再启动下一个 */
const TIER_COOLDOWN_MS = 30 * 1000; // 30秒

/** v488: 全局互斥锁轮询间隔（毫秒）- 当互斥锁被占用时，多久检查一次 */
const MUTEX_POLL_INTERVAL_MS = 10 * 1000; // 10秒

/** v488: 全局互斥锁最大等待时间（毫秒）- 超过此时间则跳过本轮同步 */
const MUTEX_MAX_WAIT_MS = 5 * 60 * 1000; // 5分钟

/** v488: 协调器过期状态清理间隔（毫秒） */
const COORDINATOR_CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // 10分钟

// 频率到毫秒的映射（用于用户自定义配置）
const frequencyToMs: Record<string, number> = {
  'every_15_minutes': 15 * 60 * 1000,
  'every_30_minutes': 30 * 60 * 1000,
  'hourly': 60 * 60 * 1000,
  'every_2_hours': 2 * 60 * 60 * 1000,
  'every_4_hours': 4 * 60 * 60 * 1000,
  'every_6_hours': 6 * 60 * 60 * 1000,
  'every_12_hours': 12 * 60 * 60 * 1000,
  'daily': 24 * 60 * 60 * 1000,
  'weekly': 7 * 24 * 60 * 60 * 1000,
};

/**
 * 获取调度器状态
 */
export function getSchedulerStatus(): SchedulerStatus {
  return { ...schedulerStatus };
}

/**
 * v219: 启动统一同步调度器
 * 使用 UnifiedSyncEngine 自动发现所有活跃账户并执行分层同步
 * 完全消除对 data_sync_schedules 表的依赖
 * 
 * @param defaultIntervalMs 默认执行间隔（毫秒），用于完整同步，默认60分钟
 */
export async function startDataSyncScheduler(defaultIntervalMs: number = 60 * 60 * 1000): Promise<void> {
  if (schedulerStatus.isRunning) {
    log.info('[DataSyncScheduler] 定时同步调度器已在运行中');
    return;
  }

  schedulerStatus.isRunning = true;
  
  // v384: 单实例直接启动模式 - 移除Leader选举，所有调度器直接启动
  log.info('[DataSyncScheduler] v384: 单实例模式，直接启动所有调度器...');
  logSystem('DataSyncScheduler', 'v384: 单实例模式启动所有调度器');
  
  // 启动数据同步调度任务
  startSchedulerTasks(defaultIntervalMs);
  
  // 启动优化调度器
  startOptimizationScheduler();
  log.info('[DataSyncScheduler] v384: 优化调度器已启动');
  
  // 启动自愈调度器
  try {
    const { startSelfHealing } = await import('../services/selfHealingScheduler');
    startSelfHealing();
    log.info('[DataSyncScheduler] v384: 自愈调度器已启动');
  } catch (healErr: unknown) {
    log.warn(`[DataSyncScheduler] v384: 自愈调度器启动失败: ${(healErr as Error).message}`);
  }
  
  log.info(`[DataSyncScheduler] v384: 所有调度器已启动完成`);
}

/**
 * v371: 停止调度任务（不停止Leader选举）
 */
function stopSchedulerTasks(): void {
  Object.keys(schedulerIntervals).forEach((tier: unknown) => {
    const interval = schedulerIntervals[tier as SyncTier];
    if (interval) {
      clearInterval(interval);
      schedulerIntervals[tier as SyncTier] = null;
    }
  });
  for (const timer of monitoringIntervals) {
    clearInterval(timer);
  }
  monitoringIntervals.length = 0;
  schedulerStatus.currentTier = null;
}

/**
 * v371: 启动实际的调度任务（仅Leader调用）
 */
async function startSchedulerTasks(defaultIntervalMs: number): Promise<void> {
  // v335: 启动时立即清理卡死的同步任务（进程重启后DB中残留的running状态）
  (async () => {
    try {
      const { cleanupStaleJobs, cleanupOrphanedPendingJobs } = await import('./dataSyncService');
      const staleResult = await cleanupStaleJobs(10); // v411: 启动清理10分钟阈值（与v410并发检查窗口一致，心跳3分钟间隔，10分钟无更新确定卡死）
      const orphanResult = await cleanupOrphanedPendingJobs(60); // 超过1小时的pending任务
      if (staleResult.cleaned > 0 || orphanResult.cleaned > 0) {
        log.warn(`[DataSyncScheduler] v335: 启动清理完成 - 卡死任务: ${staleResult.cleaned}个 (${staleResult.jobIds.join(',')}), 孤儿任务: ${orphanResult.cleaned}个`);
        logSystem('DataSyncScheduler', 'v335启动时卡死任务清理', { staleCleaned: staleResult.cleaned, orphanCleaned: orphanResult.cleaned, staleJobIds: staleResult.jobIds });
      }
    } catch (cleanupErr: unknown) {
      log.warn(`[DataSyncScheduler] v335: 启动清理失败: ${(cleanupErr as Error).message}`);
    }
  })();

  // v219: 启动统一同步引擎驱动的分层同步
  log.info('[DataSyncScheduler] v371: Leader启动统一同步引擎驱动的分层同步调度器...');
  logSystem('DataSyncScheduler', 'v371 Leader启动同步调度器', { defaultIntervalMs, mode: 'unified_engine' });
  
  // 高频同步：每15分钟 - 广告活动状态和当日绩效
  schedulerIntervals.high = setInterval(async () => {
    await executeUnifiedSync('high');
  }, SYNC_TIER_CONFIG.high.intervalMs);
  log.info(`[DataSyncScheduler] v219: 高频同步已启动，间隔: ${SYNC_TIER_CONFIG.high.intervalMs / 1000 / 60} 分钟`);

  // 中频同步：每30分钟 - 广告组、关键词、定位
  schedulerIntervals.medium = setInterval(async () => {
    await executeUnifiedSync('medium');
  }, SYNC_TIER_CONFIG.medium.intervalMs);
  log.info(`[DataSyncScheduler] v219: 中频同步已启动，间隔: ${SYNC_TIER_CONFIG.medium.intervalMs / 1000 / 60} 分钟`);

  // 完整同步：使用传入的间隔（默认60分钟）
  schedulerIntervals.full = setInterval(async () => {
    await executeUnifiedSync('full');
  }, defaultIntervalMs);
  
  schedulerStatus.nextRunTime = new Date(Date.now() + defaultIntervalMs);
  log.info(`[DataSyncScheduler] v219: 完整同步已启动，间隔: ${defaultIntervalMs / 1000 / 60} 分钟`);
  // v406: 夜间同步：计算距离下一个 PST 凌晨2点的毫秒数
  // 服务器运行在UTC，但广告数据以PST时区为准，所以nightly同步应在PST凌晨2点执行
  // PST = UTC-8，所以PST 2:00 AM = UTC 10:00 AM
  const nightlyDelayMs = (() => {
    const now = new Date();
    // 计算下一个UTC 10:00 (= PST 2:00 AM)
    const nextNightly = new Date(now);
    nextNightly.setUTCHours(10, 0, 0, 0);
    if (nextNightly.getTime() <= now.getTime()) {
      nextNightly.setDate(nextNightly.getDate() + 1);
    }
    return nextNightly.getTime() - now.getTime();
  })();
  setTimeout(() => {
    log.info('[DataSyncScheduler] v406: 夜间同步首次执行（PST凌晨2点 = UTC 10:00）...');
    executeUnifiedSync('nightly' as unknown);
    // 启动每24小时循环
    schedulerIntervals.nightly = setInterval(async () => {
      log.info('[DataSyncScheduler] v406: 夜间同步定时执行（PST凌晨2点）...');
      await executeUnifiedSync('nightly' as unknown);
    }, 24 * 60 * 60 * 1000);
  }, nightlyDelayMs);
  log.info(`[DataSyncScheduler] v406: 夜间同步已调度，首次执行将在 ${Math.round(nightlyDelayMs / 1000 / 60)} 分钟后（PST凌晨2点 = UTC 10:00）`);

  // v336: 缩短启动后首次同步延迟（v335的2分钟→30秒，5分钟→60秒）
  // 部署后尽快恢复数据同步，减少数据空窗期
  setTimeout(async () => {
    log.info('[DataSyncScheduler] v336: 启动后首次高频同步（30秒延迟）...');
    await executeUnifiedSync('high');
    log.info('[DataSyncScheduler] v336: 启动后首次高频同步完成');
  }, 30 * 1000);
  
  // v411: 启动后60秒检查是否有中断的同步任务需要接管恢复
  setTimeout(async () => {
    // v411: 任务接管机制 - 检查是否有被中断的同步任务需要从断点恢复
    const interruptedJobs = (global as Record<string, unknown>).__interrupted_sync_jobs as Array<{
      id: number; accountId: number; syncType: string; 
      currentStep: string; currentStepIndex: number; totalSteps: number;
    }> | undefined;
    
    if (interruptedJobs && interruptedJobs.length > 0) {
      log.info(`[DataSyncScheduler] v411: 发现 ${interruptedJobs.length} 个中断任务需要接管恢复`);
      
      for (const job of interruptedJobs) {
        // 只接管full和nightly类型的任务（这些任务步骤多、耗时长，从断点恢复有意义）
        // high/medium任务步骤少，直接重新执行即可
        if (job.totalSteps >= 10 && job.currentStepIndex > 3) {
          log.info(`[DataSyncScheduler] v411: 接管Job${job.id}(账户${job.accountId}) - 从步骤${job.currentStepIndex}/${job.totalSteps}恢复执行（跳过已完成的前${job.currentStepIndex}步）`);
          
          try {
            const { syncAllAccounts, SYNC_STEPS } = await import('./unifiedSyncEngine');
            // 获取从断点开始的步骤ID列表
            const allStepIds = SYNC_STEPS.map((s: unknown) => s.id);
            const remainingStepIds = allStepIds.slice(job.currentStepIndex);
            
            if (remainingStepIds.length > 0) {
              log.info(`[DataSyncScheduler] v411: 为账户${job.accountId}恢复执行剩余${remainingStepIds.length}个步骤`);
              // 使用syncAllAccounts触发full同步，它会为所有账户执行完整同步
              // 这比仅恢复单个账户更安全，因为其他账户也可能需要同步
              const syncResult: unknown = await syncAllAccounts('full');
              log.info(`[DataSyncScheduler] v411: 任务接管同步完成 - 成功: ${syncResult.successfulAccounts}/${syncResult.totalAccounts}, 失败: ${syncResult.failedAccounts}, 耗时: ${syncResult.durationMs}ms`);
            }
          } catch (resumeErr: unknown) {
            log.warn(`[DataSyncScheduler] v411: 任务接管失败: ${(resumeErr as Error).message}`);
          }
          break; // 一次只接管一个任务，避免并发冲突
        } else {
          log.info(`[DataSyncScheduler] v411: Job${job.id}(账户${job.accountId})步骤较少(${job.currentStepIndex}/${job.totalSteps})，将通过常规调度重新执行`);
        }
      }
      
      // 清理全局变量
      delete (global as Record<string, unknown>).__interrupted_sync_jobs;
    } else {
      // 无中断任务，执行常规的启动后完整同步
      log.info('[DataSyncScheduler] v411: 无中断任务，执行常规启动后完整同步（60秒延迟）...');
      const result = await executeUnifiedSync('full');
      log.info('[DataSyncScheduler] v411: 启动后完整同步已完成');
    }
    
    // 同步完成后验证结果
    try {
      await verifySyncHealth();
    } catch (verifyErr: unknown) {
      log.warn(`[DataSyncScheduler] v336: 同步健康验证失败: ${(verifyErr as Error).message}`);
    }
  }, 60 * 1000);

  // v361: 系统健康监控 - 每15分钟输出健康快照
  monitoringIntervals.push(setInterval(async () => {
    try {
      const { logHealthSnapshot } = await import('./unifiedSyncEngine');
      logHealthSnapshot();
    } catch (err: unknown) {
      log.warn(`[DataSyncScheduler] v220: 健康监控快照失败: ${(err as Error).message}`);
    }
  }, 15 * 60 * 1000));
  log.info('[DataSyncScheduler] v220: 系统健康监控已启动，间隔: 15分钟');
  
  // v361: 启动优化任务重试同步引擎（每5分钟）
  monitoringIntervals.push(setInterval(async () => {
    try {
      const { processRetryTasks } = await import('./optimizationSyncEngine');
      const retryResult = await processRetryTasks();
      if (retryResult.processed > 0) {
        log.warn(`[DataSyncScheduler] 重试同步完成: 处理=${retryResult.processed}, 成功=${retryResult.synced}, 失败=${retryResult.failed}`);
      }
    } catch (err: unknown) {
      log.warn(`[DataSyncScheduler] 重试同步异常: ${(err as Error).message}`);
    }
  }, 5 * 60 * 1000));
  log.info(`[DataSyncScheduler] v137: 优化任务重试同步引擎已启动，间隔: 5分钟`);

  // v361: 定期清理卡死任务（每10分钟）
  monitoringIntervals.push(setInterval(async () => {
    try {
      const { cleanupStaleJobs } = await import('./dataSyncService');
      const result = await cleanupStaleJobs(15); // v411: 定期清理15分钟阈值（心跳3分钟间隔，15分钟无更新确定卡死，避免僵尸任务长时间阻塞调度器）
      if (result.cleaned > 0) {
        log.warn(`[DataSyncScheduler] v334: 定期清理发现 ${result.cleaned} 个卡死任务: ${result.jobIds.join(', ')}`);
      }
    } catch (err: unknown) {
      log.warn(`[DataSyncScheduler] v334: 定期卡死任务清理异常: ${(err as Error).message}`);
    }
  }, 10 * 60 * 1000));
  log.info('[DataSyncScheduler] v334: 卡死任务定期清理已启动，间隔: 10分钟');

  // v361: SLO监控 - 每10分钟采集一次SLO指标
  monitoringIntervals.push(setInterval(async () => {
    try {
      const { getSLOMetrics } = await import('../services/sync/sloMonitor');
      const metrics = await getSLOMetrics();
      if (metrics.overallStatus === 'unhealthy') {
        log.warn(`[DataSyncScheduler] v358.1: SLO健康度异常! score=${metrics.overallScore}, ` +
          `syncRate=${metrics.syncSuccessRate.actual}%, coverage=${metrics.dataCoverage.actual}%, ` +
          `freshness=${metrics.dataFreshness.actual}`);
      } else if (metrics.overallStatus === 'degraded') {
        log.warn(`[DataSyncScheduler] v358.1: SLO健康度降级 score=${metrics.overallScore}, ` +
          `syncRate=${metrics.syncSuccessRate.actual}%, coverage=${metrics.dataCoverage.actual}%`);
      } else {
        log.debug(`[DataSyncScheduler] v358.1: SLO正常 score=${metrics.overallScore}`);
      }
    } catch (err: unknown) {
      log.warn(`[DataSyncScheduler] v358.1: SLO监控采集失败: ${(err as Error).message}`);
    }
  }, 10 * 60 * 1000));
  log.info('[DataSyncScheduler] v358.1: SLO监控已启动，间隔: 10分钟');

  // v361: 数据完整性检查器 - 每4小时全量检查
  monitoringIntervals.push(setInterval(async () => {
    try {
      const { checkAllAccountsIntegrity, executeAutoRepair } = await import('../services/sync/dataIntegrityChecker');
      log.info('[DataSyncScheduler] v358.1: 开始数据完整性定期检查...');
      const checkResult = await checkAllAccountsIntegrity(14);
      log.info(`[DataSyncScheduler] v358.1: 完整性检查完成 - 总计=${checkResult.totalAccounts}, ` +
        `健康=${checkResult.healthyAccounts}, 需修复=${checkResult.unhealthyAccounts}`);
      
      // 自动修复需要修复的账户
      const unhealthyResults = checkResult.results.filter(r => r.needsRepair);
      for (const result of unhealthyResults) {
        try {
          const repairResult = await executeAutoRepair(result);
          log.info(`[DataSyncScheduler] v358.1: 账户${result.accountId}自动修复: ` +
            `成功=${repairResult.repaired}, 动作=${repairResult.actionsExecuted}, 错误=${repairResult.errors.length}`);
        } catch (repairErr: unknown) {
          log.warn(`[DataSyncScheduler] v358.1: 账户${result.accountId}自动修复失败: ${(repairErr as Error).message}`);
        }
      }
    } catch (err: unknown) {
      log.warn(`[DataSyncScheduler] v358.1: 数据完整性检查失败: ${(err as Error).message}`);
    }
  }, 4 * 60 * 60 * 1000));
  log.info('[DataSyncScheduler] v358.1: 数据完整性检查器已启动，间隔: 4小时');

  // v358.1: 启动后延迟5分钟执行一次完整性检查（确保部署后立即检查）
  setTimeout(async () => {
    try {
      const { checkAllAccountsIntegrity } = await import('../services/sync/dataIntegrityChecker');
      log.info('[DataSyncScheduler] v358.1: 部署后首次完整性检查...');
      const checkResult = await checkAllAccountsIntegrity(14);
      log.info(`[DataSyncScheduler] v358.1: 部署后首次检查完成 - 总计=${checkResult.totalAccounts}, ` +
        `健康=${checkResult.healthyAccounts}, 需修复=${checkResult.unhealthyAccounts}`);
    } catch (err: unknown) {
      log.warn(`[DataSyncScheduler] v358.1: 部署后首次完整性检查失败: ${(err as Error).message}`);
    }
  }, 5 * 60 * 1000);
  
  // v383: 自愈调度器已移至onBecomeLeader回调中启动，确保只在Leader实例上运行

  // v488: SyncCoordinator 过期状态清理定时器（每10分钟）
  monitoringIntervals.push(setInterval(() => {
    try {
      const cleaned = cleanupExpiredOverrides();
      if (cleaned > 0) {
        log.warn(`[DataSyncScheduler] v488: SyncCoordinator清理了 ${cleaned} 个过期的手动接管状态`);
      }
      // 输出协调器状态快照
      const coordStatus = getCoordinatorStatus();
      if (coordStatus.manualOverrides.length > 0) {
        log.info(`[DataSyncScheduler] v488: SyncCoordinator状态 - 手动接管中: ${coordStatus.manualOverrides.map(o => `账号${o.accountId}(阶段:${o.phase},耗时:${(o.elapsedMs/1000).toFixed(0)}s)`).join(', ')}`);
      }
    } catch (err: unknown) {
      log.warn(`[DataSyncScheduler] v488: SyncCoordinator清理异常: ${(err as Error).message}`);
    }
  }, COORDINATOR_CLEANUP_INTERVAL_MS));
  log.info('[DataSyncScheduler] v488: SyncCoordinator过期状态清理已启动，间隔: 10分钟');
  
  log.info(`[DataSyncScheduler] v488: 统一同步调度器已启动，完整同步间隔: ${defaultIntervalMs / 1000 / 60} 分钟`);
}

/**
 * 停止定时同步调度器
 */
export function stopDataSyncScheduler(): void {
  if (!schedulerStatus.isRunning) {
    log.info('[DataSyncScheduler] 定时同步调度器未在运行');
    return;
  }
  // v384: 单实例模式，无需停止Leader选举
  // 停止所有层级的调度器
  stopSchedulerTasks();
  log.info(`[DataSyncScheduler] v371: 已清理所有监控定时器`);
  schedulerStatus.isRunning = false;
  schedulerStatus.nextRunTime = null;
  schedulerStatus.currentTier = null;
  log.info('[DataSyncScheduler] 定时同步调度器已停止');
  logSystem('DataSyncScheduler', '同步调度器已停止');
}

/**
 * v222: 智能调度协调 - 追踪各层级的运行状态
 * 避免同一时间窗口内多个层级同时触发造成API压力翻倍
 */
const tierRunningState: Record<string, boolean> = {
  high: false,
  medium: false,
  full: false,
  nightly: false,
};

// v411: 调度器跳过计数器 - 追踪每个层级因并发控制而跳过的次数
const schedulerSkipCount: Record<string, number> = {
  high: 0,
  medium: 0,
  full: 0,
  nightly: 0,
};

/**
 * v222: 基于统一同步引擎的分层同步执行（含智能协调）
 * 自动发现所有活跃账户，无需依赖 data_sync_schedules 表
 * 
 * 协调规则：
 * 1. full层运行时，high和medium层自动跳过（full已包含所有步骤）
 * 2. medium层运行时，high层自动跳过（减少API并发压力）
 * 3. high层运行时，medium层正常执行（步骤不重叠，但会串行等待API资源）
 */
async function executeUnifiedSync(tier: SyncTier): Promise<void> {
  // ==================== v488: SyncCoordinator 全局互斥保护 ====================
  // 同一时间只允许一个同步层级运行，彻底消除层级间并发导致的API限流
  const mutexAcquired = acquireGlobalMutex(tier);
  if (!mutexAcquired) {
    // 等待互斥锁释放，最多等待MUTEX_MAX_WAIT_MS
    const waitStart = Date.now();
    let acquired = false;
    while (Date.now() - waitStart < MUTEX_MAX_WAIT_MS) {
      await new Promise(resolve => setTimeout(resolve, MUTEX_POLL_INTERVAL_MS));
      acquired = acquireGlobalMutex(tier);
      if (acquired) break;
    }
    if (!acquired) {
      log.info(`[DataSyncScheduler] v488: ${tier}层跳过 - 全局互斥锁等待超时(${MUTEX_MAX_WAIT_MS / 1000}秒)，将在下一个调度周期重试`);
      logSync('DataSyncScheduler', `v488: ${tier}层互斥锁等待超时`, { tier, waitedMs: Date.now() - waitStart });
      return;
    }
    log.info(`[DataSyncScheduler] v488: ${tier}层获得全局互斥锁（等待了${((Date.now() - waitStart) / 1000).toFixed(1)}秒）`);
  }

  try {
  // v384: 单实例模式，无需Leader检查，直接执行同步
  // v410: 数据库级别的全局并发检查 - 检查是否有任何running状态的同步任务
  // 解决问题：手动触发的全量同步不会设置tierRunningState，导致调度器仍然会创建新任务
  // v488: 现在由全局互斥锁统一保护，数据库检查作为补充层
  try {
    const database = await db.getDb();
    if (database) {
      // v488: 检查所有running任务（包括手动同步），因为全局互斥锁已经保证了层级间不会并发
      // 但手动同步的冲突由SyncCoordinator的MANUAL_OVERRIDE机制处理
      const runningJobs = await database.execute(
        sql`SELECT id, accountId, syncType, trigger_source, current_step, current_step_index, total_steps,
                   TIMESTAMPDIFF(MINUTE, startedAt, NOW()) as running_minutes,
                   TIMESTAMPDIFF(SECOND, updated_at, NOW()) as seconds_since_heartbeat
            FROM data_sync_jobs
            WHERE status = 'running'
              AND updated_at >= DATE_SUB(NOW(), INTERVAL 10 MINUTE)
              AND (trigger_source IS NULL OR trigger_source = 'auto')
            ORDER BY id`
      );
      // Drizzle mysql2返回 [rows, fields]，取第一个元素
      const runningRows = Array.isArray(runningJobs) ? (runningJobs as Record<string, unknown>[])[0] : ((runningJobs as Record<string, unknown>).rows || runningJobs);
      if (runningRows && runningRows.length > 0) {
        // v411: 增强日志 - 添加心跳时间、进度百分比、预计完成时间
        const jobSummary = runningRows.map((j: unknown) => {
          const progress = j.total_steps > 0 ? Math.round((j.current_step_index / j.total_steps) * 100) : 0;
          const heartbeatAge = j.seconds_since_heartbeat || 0;
          return `Job${j.id}(账户${j.accountId},${j.current_step}[${j.current_step_index}/${j.total_steps}]=${progress}%,运行${j.running_minutes}分钟,心跳${heartbeatAge}秒前)`;
        }).join(', ');
        
        // v411: 统计跳过次数
        schedulerSkipCount[tier] = (schedulerSkipCount[tier] || 0) + 1;
        const skipCount = schedulerSkipCount[tier];
        
        log.info(`[DataSyncScheduler] v411: ${tier}层跳过(第${skipCount}次) - 数据库中有${runningRows.length}个running任务: ${jobSummary}`);
        logSync('DataSyncScheduler', `v411: ${tier}层跳过`, { 
          tier, 
          skipCount,
          runningCount: runningRows.length, 
          runningJobs: jobSummary 
        });
        return;
      } else {
        // v411: running任务清空，重置跳过计数器
        if (schedulerSkipCount[tier] > 0) {
          log.info(`[DataSyncScheduler] v411: ${tier}层恢复执行（之前跳过了${schedulerSkipCount[tier]}次）`);
          schedulerSkipCount[tier] = 0;
        }
      }
    }
  } catch (dbCheckErr: unknown) {
    // 数据库检查失败时，回退到内存级别检查，不阻塞同步执行
    log.warn(`[DataSyncScheduler] v410: 数据库并发检查失败，回退到内存检查: ${(dbCheckErr as Error).message}`);
  }

  // v222: 智能协调 - 内存级别检查（作为数据库检查的补充，v488保留作为额外安全层）
  if (tier === 'high') {
    if (tierRunningState.full) {
      log.info(`[DataSyncScheduler] v222: high层跳过 - full层正在运行（full已包含high步骤）`);
      logSync('DataSyncScheduler', 'v222: high层智能跳过', { reason: 'full_running' });
      return;
    }
    if (tierRunningState.medium) {
      log.info(`[DataSyncScheduler] v222: high层跳过 - medium层正在运行（避免API并发压力）`);
      logSync('DataSyncScheduler', 'v222: high层智能跳过', { reason: 'medium_running' });
      return;
    }
  }
  if (tier === 'medium') {
    if (tierRunningState.full) {
      log.info(`[DataSyncScheduler] v222: medium层跳过 - full层正在运行（full已包含medium步骤）`);
      logSync('DataSyncScheduler', 'v222: medium层智能跳过', { reason: 'full_running' });
      return;
    }
  }

  // 标记当前层级为运行中
  tierRunningState[tier] = true;

  log.info(`[DataSyncScheduler] v222: 开始执行${SYNC_TIER_CONFIG[tier].description} (统一引擎) - ${new Date().toISOString()}`);
  logSync('DataSyncScheduler', `v222: 开始${SYNC_TIER_CONFIG[tier].description}`, { tier, mode: 'unified_engine' });
  schedulerStatus.currentTier = tier;

  try {
    const { syncAllAccounts } = await import('./unifiedSyncEngine');
    // @ts-expect-error - type assertion
    const batchResult = await syncAllAccounts(tier as unknown);

    schedulerStatus.tierLastRun[tier] = new Date();
    schedulerStatus.lastRunTime = new Date();
    schedulerStatus.successfulSyncs += batchResult.successfulAccounts;
    schedulerStatus.failedSyncs += batchResult.failedAccounts;
    schedulerStatus.totalSyncs += batchResult.totalAccounts;

    log.info(`[DataSyncScheduler] v219: ${SYNC_TIER_CONFIG[tier].description}完成: ` +
      `${batchResult.successfulAccounts}/${batchResult.totalAccounts} 成功, ` +
      `${batchResult.failedAccounts} 失败, ${batchResult.skippedAccounts} 跳过, ` +
      `耗时 ${batchResult.durationMs}ms`);

    // v219: 完整同步完成后触发优化目标执行
    if (tier === 'full' || tier === 'low') {
      for (const accountResult of batchResult.accountResults) {
        if (!accountResult.success) continue;
        try {
          const { triggerAccountOptimizations } = await import('../optimization/optimizationScheduler');
          await triggerAccountOptimizations(accountResult.accountId, 'unified_sync_complete');
          log.info(`[DataSyncScheduler] v219: 账户 ${accountResult.accountId} 优化目标触发完成`);
        } catch (optErr: unknown) {
          log.warn(`[DataSyncScheduler] v219: 账户 ${accountResult.accountId} 优化目标触发失败: ${(optErr as Error).message}`);
        }
      }
      
      // v337.4: 数据同步完成后触发快速否定扫描
      // 不等待定时任务，立即检查是否有高风险搜索词需要否定
      try {
        log.info(`[DataSyncScheduler] v337.4: 数据同步完成，触发快速否定扫描...`);
        await executeOptimizationTask('daily_search_term_negation');
        log.info(`[DataSyncScheduler] v337.4: 快速否定扫描完成`);
      } catch (negErr: unknown) {
        log.warn(`[DataSyncScheduler] v337.4: 快速否定扫描失败: ${(negErr as Error).message}`);
      }
    }

    // 更新下次运行时间
    if (tier === 'full') {
      schedulerStatus.nextRunTime = new Date(Date.now() + (schedulerIntervals.full ? 60 * 60 * 1000 : 30 * 60 * 1000));
    }

    // 只保留最近10条错误
    schedulerStatus.errors = schedulerStatus.errors.slice(-10);

  } catch (error: unknown) {
    log.warn(`[DataSyncScheduler] v219: ${tier}层同步执行失败:`, error);
    schedulerStatus.errors.push(`v219 ${tier}层同步失败: ${(error as Error).message}`);
    logSyncError('DataSyncScheduler', `v219 ${tier}层同步失败`, { tier, error: (error as Error).message });
  }

  schedulerStatus.currentTier = null;

  // v222: 清除运行状态标记
  tierRunningState[tier] = false;

  } finally {
    // v488: 释放全局互斥锁
    releaseGlobalMutex(tier);
    
    // v488: 层级间冷却期 - 给API令牌桶充足的恢复时间
    log.info(`[DataSyncScheduler] v488: ${tier}层完成，进入层级间冷却期(${TIER_COOLDOWN_MS / 1000}秒)...`);
    await new Promise(resolve => setTimeout(resolve, TIER_COOLDOWN_MS));
  }
}

/**
 * [已废弃 - v219] 旧版分层同步，保留作为回退方案
 * @deprecated 使用 executeUnifiedSync 替代
 */
async function executeLayeredSync(tier: SyncTier): Promise<void> {
  log.warn(`[DEPRECATED] executeLayeredSync已废弃，请使用executeUnifiedSync替代`);
  log.info(`[DataSyncScheduler] 开始执行${SYNC_TIER_CONFIG[tier].description} - ${new Date().toISOString()}`);
  logSync('DataSyncScheduler', `开始执行${SYNC_TIER_CONFIG[tier].description}`, { tier });
  schedulerStatus.currentTier = tier;

  try {
    // 获取所有启用了定时同步的账号
    const schedules = await db.getEnabledSyncSchedules();

    if (schedules.length === 0) {
      log.info('[DataSyncScheduler] 没有启用的定时同步配置');
      return;
    }

    for (const schedule of schedules) {
      // 将请求加入队列
      addToQueue({
        accountId: schedule.accountId,
        userId: schedule.userId,
        tier,
        timestamp: Date.now(),
      });
    }

    // 处理队列
    await processQueue();

    schedulerStatus.tierLastRun[tier] = new Date();
    log.info(`[DataSyncScheduler] ${SYNC_TIER_CONFIG[tier].description}完成`);

  } catch (error: unknown) {
    log.warn(`[DataSyncScheduler] ${tier}层同步执行失败:`, error);
    schedulerStatus.errors.push(`${tier}层同步失败: ${(error as Error).message}`);
  }

  schedulerStatus.currentTier = null;
}

/**
 * 添加请求到队列
 */
function addToQueue(request: QueuedRequest): void {
  requestQueue.push(request);
}

/**
 * 处理请求队列（带速率限制）
 */
async function processQueue(): Promise<void> {
  if (isProcessingQueue) {
    return;
  }

  isProcessingQueue = true;

  // v215优化: 账户级并行同步，同一账户内串行
  // v399: 默认并发从10→15，与unifiedSyncEngine/syncPriorityScheduler保持一致
  const MAX_CONCURRENT_ACCOUNTS = parseInt(process.env.MAX_CONCURRENT_ACCOUNTS || '15', 10);
  const accountGroups = new Map<number, QueuedRequest[]>();
  
  // 按账户分组
  while (requestQueue.length > 0) {
    const request = requestQueue.shift();
    if (!request) continue;
    const group = accountGroups.get(request.accountId) || [];
    group.push(request);
    accountGroups.set(request.accountId, group);
  }

  // 并行执行不同账户的同步任务
  const accountIds = Array.from(accountGroups.keys());
  for (let i = 0; i < accountIds.length; i += MAX_CONCURRENT_ACCOUNTS) {
    const batch = accountIds.slice(i, i + MAX_CONCURRENT_ACCOUNTS);
    await Promise.all(batch.map(async (accountId) => {
      const requests = accountGroups.get(accountId) || [];
      for (const request of requests) {
        try {
          await executeTieredSyncForAccount(request);
          schedulerStatus.successfulSyncs++;
        } catch (error: unknown) {
          schedulerStatus.failedSyncs++;
          schedulerStatus.errors.push(`账号 ${request.accountId} ${request.tier}层同步失败: ${(error as Error).message}`);
          log.warn(`[DataSyncScheduler] 账号 ${request.accountId} ${request.tier}层同步失败:`, error);
        }
        schedulerStatus.totalSyncs++;
      }
    }));
    // 批次间间隔
    if (i + MAX_CONCURRENT_ACCOUNTS < accountIds.length) {
      await sleep(REQUEST_INTERVAL_MS);
    }
  }

  isProcessingQueue = false;
  schedulerStatus.errors = schedulerStatus.errors.slice(-10);
}

/**
 * 为指定账号执行分层同步
 */
async function executeTieredSyncForAccount(request: QueuedRequest): Promise<void> {
  const { accountId, userId, tier } = request;
  log.info(`[DataSyncScheduler] 开始${tier}层同步账号 ${accountId}`);
  logSync('DataSyncScheduler', `开始${tier}层同步`, { accountId, tier });

  // v194: 获取账号信息，不存在时优雅跳过而非抛出异常
  const account = await db.getAdAccountById(accountId);
  if (!account) {
    log.warn(`[DataSyncScheduler] v194: 账号 ${accountId} 不存在，跳过${tier}层同步`);
    return;
  }

  // v194: 获取API凭证，缺失时优雅跳过
  const credentials = await db.getAmazonApiCredentials(accountId);
  if (!credentials) {
    log.warn(`[DataSyncScheduler] v194: 账号 ${accountId} 未配置API凭证，跳过${tier}层同步`);
    return;
  }

  const syncService = await AmazonSyncService.createFromCredentials(
    {
      clientId: credentials.clientId || '',
      clientSecret: credentials.clientSecret || '',
      refreshToken: credentials.refreshToken || '',
      profileId: account.profileId || '',
      region: (credentials.region as 'NA' | 'EU' | 'FE') || 'NA'
    },
    accountId,
    userId,
    account.marketplace || 'US'
  );

  // 根据层级执行不同的同步
  let result;
  switch (tier) {
    case 'high':
      // 高频同步：同步广告活动状态（SP/SB/SD全覆盖）
      result = await syncService.syncCampaignsOnly();
      // 同时同步当日绩效数据（T-1归因回溯）
      try {
        await syncService.syncPerformanceOnly(1);
      } catch (e: unknown) {
        log.warn(`[DataSyncScheduler] 账号 ${accountId} 高频绩效同步失败:`, (e as Error).message);
        logSyncError('DataSyncScheduler', `账号${accountId}高频绩效同步失败`, { accountId, error: (e as Error).message });
      }
      break;
    case 'medium':
      // 中频同步：同步广告组、关键词、定位（SP/SB/SD全覆盖）
      result = await syncService.syncAdGroupsAndTargeting();
      // 同时同步7天绩效数据（归因窗口期数据更新）
      try {
        await syncService.syncPerformanceOnly(7);
      } catch (e: unknown) {
        log.warn(`[DataSyncScheduler] 账号 ${accountId} 中频绩效同步失败:`, (e as Error).message);
        logSyncError('DataSyncScheduler', `账号${accountId}中频绩效同步失败`, { accountId, error: (e as Error).message });
      }
      break;
    case 'low':
    case 'full':
    default:
      // v382: 日常增量同步，只同步归因期内的数据，大幅减少API调用量
      // 包含所有层级，但搜索词/广告位/定向报告/绩效数据只同步近14天
      // 归因期过后数据基本不变，无需每次都同步90天全量数据
      result = await syncService.syncAll({ syncMode: 'daily' });
      break;
  }

  // v196: 同步完成后记录数据新鲜度日志
  const syncEndTime = new Date();
  log.info(`[DataSyncScheduler] v196: 账号 ${accountId} ${tier}层同步完成:`, result);
  logSync('DataSyncScheduler', `账号${accountId} ${tier}层同步完成`, { accountId, tier, result });
  
  // 记录同步完成时间到data_sync_jobs表 (v200: 使用Drizzle ORM替代原始SQL，避免列名不一致)
  try {
    const database = await db.getDb();
    if (database) {
      const { dataSyncJobs } = await import('../../drizzle/schema');
      await database.insert(dataSyncJobs).values({
        userId: 1, // 系统自动同步
        accountId: accountId,
        syncType: tier === 'high' || tier === 'medium' || tier === 'full' ? 'all' : 'all',
        status: 'completed',
        startedAt: syncEndTime.toISOString().slice(0, 19).replace('T', ' '),
        completedAt: syncEndTime.toISOString().slice(0, 19).replace('T', ' '),
        spCampaigns: (result as unknown)?.spCampaigns || (result as unknown)?.campaigns || 0,
        sbCampaigns: (result as unknown)?.sbCampaigns || 0,
        sdCampaigns: (result as unknown)?.sdCampaigns || 0,
        adGroupsSynced: (result as unknown)?.adGroups || 0,
        keywordsSynced: (result as unknown)?.keywords || 0,
        targetsSynced: (result as unknown)?.targets || 0,
        performanceSynced: (result as unknown)?.performance || 0,
        // v364: 修复同步任务步骤计数缺失
        totalSteps: 7,
        currentStepIndex: 7,
        currentStep: '完成',
        progressPercent: 100,
      });
    }
  } catch (logErr: unknown) {
    // 日志记录失败不影响主流程，但输出完整错误信息便于排查
    // @ts-expect-error - error message access
    log.warn(`[DataSyncScheduler] v200: 同步日志记录失败: ${(logErr as Error).message}`, logErr.cause || '');
    logSyncWarn('DataSyncScheduler', `同步日志记录失败`, { accountId, error: (logErr as Error).message });
  }

  // v196: 每次同步完成后触发优化目标执行（确保优化频率与同步频率同步）
  if (tier === 'medium' || tier === 'full' || tier === 'low') {
    try {
      log.info(`[DataSyncScheduler] v196: ${tier}层同步完成，触发账号 ${accountId} 的优化目标执行...`);
      const { triggerAccountOptimizations } = await import('../optimization/optimizationScheduler');
      await triggerAccountOptimizations(accountId);
      log.info(`[DataSyncScheduler] v196: 账号 ${accountId} 优化目标执行完成`);
      logOptimization('DataSyncScheduler', `账号${accountId}优化目标执行完成`, { accountId, tier });
    } catch (optErr: unknown) {
      log.warn(`[DataSyncScheduler] v196: 账号 ${accountId} 优化目标执行失败: ${(optErr as Error).message}`);
      logOptimizationError('DataSyncScheduler', `账号${accountId}优化目标执行失败`, { accountId, error: (optErr as Error).message });
    }
  }
}

/**
 * 执行定时同步任务（完整同步）
 */
async function executeScheduledSync(): Promise<void> {
  log.info(`[DataSyncScheduler] 开始执行定时同步任务 - ${new Date().toISOString()}`);

  try {
    // 获取所有启用了定时同步的账号
    const schedules = await db.getEnabledSyncSchedules();

    if (schedules.length === 0) {
      log.info('[DataSyncScheduler] 没有启用的定时同步配置');
      return;
    }

    for (const schedule of schedules) {
      // 检查是否应该执行同步
      if (!(await shouldExecuteSync(schedule))) {
        continue;
      }

      try {
        await executeSyncForAccount(schedule);
        schedulerStatus.successfulSyncs++;
      } catch (error: unknown) {
        schedulerStatus.failedSyncs++;
        schedulerStatus.errors.push(`账号 ${schedule.accountId} 同步失败: ${(error as Error).message}`);
        log.warn(`[DataSyncScheduler] 账号 ${schedule.accountId} 同步失败:`, error);
      }

      schedulerStatus.totalSyncs++;
      
      // 请求间隔
      await sleep(REQUEST_INTERVAL_MS);
    }

    schedulerStatus.lastRunTime = new Date();
    // 只保留最近10条错误
    schedulerStatus.errors = schedulerStatus.errors.slice(-10);

  } catch (error: unknown) {
    log.warn('[DataSyncScheduler] 定时同步任务执行失败:', error);
    schedulerStatus.errors.push(`任务执行失败: ${(error as Error).message}`);
  }
}

/**
 * 检查是否应该执行同步
 */
async function shouldExecuteSync(schedule: db.DataSyncSchedule): Promise<boolean> {
  if (!schedule.isEnabled) {
    return false;
  }

  const now = new Date();
  const frequency = schedule.frequency || 'hourly';
  const intervalMs = frequencyToMs[frequency] || frequencyToMs['hourly'];

  // 如果有上次运行时间，检查是否已经过了间隔时间
  if (schedule.lastRunAt) {
    const lastRun = new Date(schedule.lastRunAt);
    const timeSinceLastRun = now.getTime() - lastRun.getTime();
    
    if (timeSinceLastRun < intervalMs) {
      return false;
    }
  }

  // v182: 检查首选时间（使用站点本地时间）
  if (schedule.preferredTime) {
    const [hours, minutes] = schedule.preferredTime.split(':').map(Number);
    // v182: 获取账号对应的站点本地时间
    const account = await db.getAdAccountById(schedule.accountId);
    const marketplace = account?.marketplace || 'US';
    const tz = MARKETPLACE_TIMEZONES[marketplace] || 'America/Los_Angeles';
    const currentHours = getLocalHour(now, marketplace);
    const currentMinutes = parseInt(now.toLocaleString('en-US', { timeZone: tz, minute: 'numeric' }));

    // 允许5分钟的时间窗口
    const preferredMinutes = hours * 60 + minutes;
    const currentTotalMinutes = currentHours * 60 + currentMinutes;
    const diff = Math.abs(currentTotalMinutes - preferredMinutes);

    if (diff > 5 && diff < (24 * 60 - 5)) {
      return false;
    }
  }

  // v182: 检查首选星期几（使用站点本地时间）
  if (frequency === 'weekly' && schedule.preferredDayOfWeek !== null && schedule.preferredDayOfWeek !== undefined) {
    const account = await db.getAdAccountById(schedule.accountId);
    const marketplace = account?.marketplace || 'US';
    const currentDay = getLocalDayOfWeek(now, marketplace);
    if (currentDay !== schedule.preferredDayOfWeek) {
      return false;
    }
  }

  return true;
}

/**
 * 为指定账号执行完整同步
 */
async function executeSyncForAccount(schedule: db.DataSyncSchedule): Promise<void> {
  log.info(`[DataSyncScheduler] 开始同步账号 ${schedule.accountId}`);

  // v194: 获取账号信息，不存在时优雅跳过
  const account = await db.getAdAccountById(schedule.accountId);
  if (!account) {
    log.warn(`[DataSyncScheduler] v194: 账号 ${schedule.accountId} 不存在，跳过同步`);
    return;
  }

  // v194: 获取API凭证，缺失时优雅跳过
  const credentials = await db.getAmazonApiCredentials(schedule.accountId);
  if (!credentials) {
    log.warn(`[DataSyncScheduler] v194: 账号 ${schedule.accountId} 未配置API凭证，跳过同步`);
    return;
  }
  
  const syncService = await AmazonSyncService.createFromCredentials(
    {
      clientId: credentials.clientId || '',
      clientSecret: credentials.clientSecret || '',
      refreshToken: credentials.refreshToken || '',
      profileId: account.profileId || '',
      region: (credentials.region as 'NA' | 'EU' | 'FE') || 'NA'
    },
    schedule.accountId,
    schedule.userId,
    account.marketplace || 'US'
  );

  // v382: 定时调度使用daily模式（只同步归因期内数据）
  const result = await syncService.syncAll({ syncMode: 'daily' });

  // 更新调度记录
  await db.updateSyncScheduleLastRun(schedule.id);

  // 记录同步日志
  await db.createSyncLog({
    userId: schedule.userId,
    accountId: schedule.accountId,
    syncType: 'full_sync',
    status: 'completed',
    recordsSynced: result.campaigns + result.adGroups + result.keywords + result.targets,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    isIncremental: false,
    spCampaigns: result.spCampaigns || 0,
    sbCampaigns: result.sbCampaigns || 0,
    sdCampaigns: result.sdCampaigns || 0,
    adGroupsSynced: result.adGroups,
    keywordsSynced: result.keywords,
    targetsSynced: result.targets,
  });

  log.info(`[DataSyncScheduler] 账号 ${schedule.accountId} 同步完成:`, result);

  // ✅ 数据同步完成后，自动更新策略模板推荐
  try {
    const { updateAllCampaignRecommendations } = await import('../analytics/strategyRecommendationService');
    const recUpdated = await updateAllCampaignRecommendations(schedule.accountId);
    log.info(`[DataSyncScheduler] 账号 ${schedule.accountId} 策略模板推荐已更新: ${recUpdated} 个广告活动`);
  } catch (recError: unknown) {
    log.warn(`[DataSyncScheduler] 账号 ${schedule.accountId} 策略模板推荐更新失败:`, (recError as Error).message);
  }

  // ✅ v168: 数据同步完成后，检查是否有优化目标需要自动恢复
  // 业务规则：当广告活动从暂停状态恢复为enabled时，自动恢复对应的优化目标
  try {
    const accountPGs = await db.getPerformanceGroupsByAccountId(schedule.accountId);
    for (const pg of accountPGs) {
      // 只检查当前已暂停的优化目标
      if ((pg as Record<string, unknown>).autoOptimize === 0 || (pg as Record<string, unknown>).autoOptimize === false) {
        const pgCampaigns = await db.getCampaignsByPerformanceGroupId(pg.id);
        const enabledCount = pgCampaigns.filter((c: Record<string, unknown>) => c.campaignStatus === 'enabled').length;
        if (enabledCount > 0) {
          // 有广告活动恢复了enabled状态，自动恢复优化目标
          await db.updatePerformanceGroup(pg.id, { autoOptimize: 1 });
          log.debug(`[DataSyncScheduler] v168: 优化目标"${(pg as Record<string, unknown>).name}"已自动恢复 - 检测到${enabledCount}个广告活动恢复enabled状态`);
        }
      }
    }
  } catch (autoResumeErr: unknown) {
    log.warn(`[DataSyncScheduler] v168: 优化目标自动恢复检查失败:`, (autoResumeErr as Error).message);
  }

  // ✅ v151: 统一优化入口 - 数据同步完成后，通过optimizationScheduler触发该账户下所有活跃优化目标的执行
  // 废弃原有的automationExecutionEngine账户级优化，改为基于优化目标的精准触发
  try {
    const { triggerAccountOptimizations } = await import('../optimization/optimizationScheduler');
    const triggerResult = await triggerAccountOptimizations(schedule.accountId, 'data_sync_complete');
    log.info(`[DataSyncScheduler] v151: 账号 ${schedule.accountId} 优化目标触发完成:`, {
      triggeredTargets: triggerResult.triggeredCount,
      skippedTargets: triggerResult.skippedCount,
      errors: triggerResult.errorCount,
    });
  } catch (autoOptError: unknown) {
    log.warn(`[DataSyncScheduler] 账号 ${schedule.accountId} 优化目标触发失败:`, (autoOptError as Error).message);
  }

  // ✅ v152: 数据同步完成后，自动执行效果追踪（追踪之前优化的7/14/30天效果）
  try {
    const { runEffectTracking } = await import('../algorithm/algorithmEvolutionEngine');
    const trackingResult = await runEffectTracking();
    log.info(`[DataSyncScheduler] v152: 效果追踪完成: 7d=${trackingResult.tracked7d}, 14d=${trackingResult.tracked14d}, 30d=${trackingResult.tracked30d}`);
  } catch (trackError: unknown) {
    log.warn(`[DataSyncScheduler] v152: 效果追踪失败:`, (trackError as Error).message);
  }

  // v360: 算法进化周期从每天一次优化为每12小时一次，并使用DB持久化去重
  // 原来: 每天一次 + 内存Set去重（重启后丢失）
  // 现在: 每12小时一次 + 基于时间窗口去重（重启安全）
  try {
    const now = new Date();
    // v360: 使用12小时窗口替代每天一次
    const halfDaySlot = `${now.toISOString().slice(0, 10)}_${now.getHours() < 12 ? 'AM' : 'PM'}`;
    const lastEvolutionKey = `evolution_${schedule.accountId}_${halfDaySlot}`;
    // @ts-expect-error - dynamic property access
    if (!(globalThis as Record<string, unknown>).__evolutionExecuted) {
      // @ts-expect-error - dynamic property assignment
      (globalThis as Record<string, unknown>).__evolutionExecuted = new Set();
    }
    // v360: 限制Set大小，防止内存泄漏
    // @ts-expect-error - dynamic property access
    const evoSet = (globalThis as Record<string, unknown>).__evolutionExecuted as Set<string>;
    if (evoSet.size > 200) {
      const entries = Array.from(evoSet);
      entries.slice(0, 100).forEach(e => evoSet.delete(e));
    }
    
    if (!evoSet.has(lastEvolutionKey)) {
      const { runGlobalEvolution } = await import('../algorithm/algorithmEvolutionEngine');
      const evolutionResult = await runGlobalEvolution();
      evoSet.add(lastEvolutionKey);
      log.info(`[DataSyncScheduler] v360: 算法进化完成(12h周期): 总目标=${evolutionResult.totalTargets}, 已进化=${evolutionResult.evolvedTargets}, 跳过=${evolutionResult.skippedTargets}`);
    }
  } catch (evoError: unknown) {
    log.warn(`[DataSyncScheduler] v360: 算法进化失败:`, (evoError as Error).message);
  }

  // ✅ v167: 数据同步完成后，自动运行纠错扫描（检测并修复过往错误优化）
  try {
    const correctionResult = await runAutoCorrection(schedule.accountId);
    log.warn(`[DataSyncScheduler] v167: 自动纠错扫描完成: 发现${correctionResult.totalIssuesFound}个问题, 纠正${correctionResult.totalCorrected}个, 失败${correctionResult.totalFailed}个`);
  } catch (correctionError: unknown) {
    log.warn(`[DataSyncScheduler] v167: 自动纠错扫描失败:`, (correctionError as Error).message);
  }

  // 发送通知（如果配置了）
  if (result.campaigns > 0 || result.adGroups > 0) {
    try {
      await notifyOwner({
        title: `定时同步完成 - ${account.accountName || account.sellerId}`,
        content: `同步结果: ${result.campaigns} 个广告活动, ${result.adGroups} 个广告组, ${result.keywords} 个关键词, ${result.targets} 个商品定位`
      });
    } catch (e) {
      log.warn('[DataSyncScheduler] 发送通知失败:', e);
    }
  }
}

/**
 * v219: 手动触发同步（使用统一同步引擎）
 */
export async function triggerManualSync(userId: number, accountId: number): Promise<{
  success: boolean;
  message: string;
  result?: unknown;
}> {
  try {
    const { triggerManualFullSync } = await import('./unifiedSyncEngine');
    const syncResult: unknown = await triggerManualFullSync(accountId);

    if (!syncResult) {
      return { success: false, message: '账号不存在或未配置API凭证' };
    }

    return {
      success: syncResult.success,
      message: syncResult.success ? 
        `同步完成: ${syncResult.completedSteps}/${syncResult.totalSteps}步成功, 同步${syncResult.totalSynced}条数据, 耗时${syncResult.durationMs}ms` :
        `同步部分完成: ${syncResult.completedSteps}/${syncResult.totalSteps}步成功, 错误: ${syncResult.errors.slice(0, 3).join('; ')}`,
      result: {
        campaigns: (syncResult.stepResults['sp_campaigns']?.synced || 0) +
          (syncResult.stepResults['sb_campaigns']?.synced || 0) +
          (syncResult.stepResults['sd_campaigns']?.synced || 0),
        adGroups: (syncResult.stepResults['sp_ad_groups']?.synced || 0) +
          (syncResult.stepResults['sb_ad_groups']?.synced || 0) +
          (syncResult.stepResults['sd_ad_groups']?.synced || 0),
        keywords: (syncResult.stepResults['sp_keywords']?.synced || 0) +
          (syncResult.stepResults['sb_keywords']?.synced || 0),
        targets: (syncResult.stepResults['sp_product_targets']?.synced || 0) +
          (syncResult.stepResults['sb_product_targets']?.synced || 0) +
          (syncResult.stepResults['sd_product_targets']?.synced || 0),
        performance: (syncResult.stepResults['performance_95d']?.synced || 0),
        spCampaigns: syncResult.stepResults['sp_campaigns']?.synced || 0,
        sbCampaigns: syncResult.stepResults['sb_campaigns']?.synced || 0,
        sdCampaigns: syncResult.stepResults['sd_campaigns']?.synced || 0,
        durationMs: syncResult.durationMs,
        completedSteps: syncResult.completedSteps,
        totalSteps: syncResult.totalSteps,
        failedSteps: syncResult.failedSteps,
      }
    };
  } catch (error: unknown) {
    return {
      success: false,
      message: `同步失败: ${(error as Error).message}`
    };
  }
}

/**
 * v215: 获取同步队列状态
 */
export function getSyncQueueStatus() {
  return {
    queueLength: requestQueue.length,
    isProcessing: isProcessingQueue,
    schedulerStatus: { ...schedulerStatus },
  };
}

/**
 * 创建或更新定时同步配置
 */
export async function upsertSyncSchedule(params: {
  userId: number;
  accountId: number;
  syncType?: string;
  frequency: string;
  preferredTime?: string;
  preferredDayOfWeek?: number;
  isEnabled: boolean;
}): Promise<db.DataSyncSchedule> {
  // 检查是否已存在配置
  const existing = await db.getSyncScheduleByAccountId(params.userId, params.accountId);

  if (existing) {
    // 更新现有配置
    await db.updateSyncSchedule(existing.id, {
      syncType: params.syncType || 'full_sync',
      frequency: params.frequency,
      preferredTime: params.preferredTime,
      preferredDayOfWeek: params.preferredDayOfWeek,
      isEnabled: params.isEnabled,
    });
    return { ...existing, ...params } as unknown as db.DataSyncSchedule;
  } else {
    // 创建新配置
    const id = await db.createSyncSchedule({
      userId: params.userId,
      accountId: params.accountId,
      syncType: params.syncType || 'full_sync',
      frequency: params.frequency,
      preferredTime: params.preferredTime,
      preferredDayOfWeek: params.preferredDayOfWeek,
      isEnabled: params.isEnabled,
    });
    return {
      id,
      userId: params.userId,
      accountId: params.accountId,
      syncType: params.syncType || 'full_sync',
      frequency: params.frequency,
      preferredTime: params.preferredTime || null,
      preferredDayOfWeek: params.preferredDayOfWeek || null,
      isEnabled: params.isEnabled ? 1 : 0,
      lastRunAt: null,
      nextRunAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as db.DataSyncSchedule;
  }
}

/**
 * 获取账号的定时同步配置
 */
export async function getSyncSchedule(userId: number, accountId: number): Promise<db.DataSyncSchedule | null> {
  return db.getSyncScheduleByAccountId(userId, accountId);
}

/**
 * 删除定时同步配置
 */
export async function deleteSyncSchedule(scheduleId: number): Promise<void> {
  await db.deleteSyncSchedule(scheduleId);
}

/**
 * 辅助函数：延迟执行
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 指数退避重试
 */
export async function withExponentialBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelayMs: number = 1000
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      lastError = error;
      
      // 如果是429错误，使用指数退避
      // @ts-expect-error - error message access
      if (error.response?.status === 429 || (error as Error).message?.includes('429')) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        log.info(`[DataSyncScheduler] 遇到速率限制，等待 ${delay}ms 后重试 (尝试 ${attempt + 1}/${maxRetries})`);
        await sleep(delay);
      } else {
        // 其他错误直接抛出
        throw error;
      }
    }
  }
  
  throw lastError || new Error('重试次数已用尽');
}

// ==================== v143: 生命周期感知的智能优化调度器 ====================
// 核心设计：
// 1. 生命周期感知 - 新广告活动高频探索，成熟广告活动低频稳优
// 2. 模块隔离 - 每个调度任务只执行对应的优化模块
// 3. 以优化目标为单位 - 每个目标独立判断是否应该执行
// 4. 归因窗口匹配 - SP 7天、SB/SD 14天
// 5. 执行锁防止重复执行
//
// 生命周期阶段频率表：
// | 优化模块     | 启动期(launch) | 成长期(growth) | 成熟期(mature) | 设计依据                           |
// |--------------|---------------|---------------|---------------|------------------------------------|
// | 出价优化     | 每4小时        | 每6小时        | 每12小时       | 新广告低竞价需快速迭代探索       |
// | 分时调整     | 每小时          | 每小时          | 每小时          | 分时策略按小时粒度执行           |
// | 位置倾斜     | 每24小时       | 每12小时       | 每12小时       | 启动期数据不足，不宜频繁调整位置 |
// | 否定搜索词   | 每48小时       | 每24小时       | 每24小时       | 启动期给新词更多机会               |
// | 搜索词迁移   | 每72小时       | 每48小时       | 每24小时       | 启动期不急于固化新搜索词           |
// | 预算分配     | 每4小时        | 每4小时        | 每4小时        | 及时响应花费速率变化               |
// | 风控扫描     | 每2小时        | 每2小时        | 每2小时        | 风控不受生命周期影响               |
// | 日内节奏     | 每30分钟       | 每30分钟       | 每30分钟       | 实时监控不受生命周期影响           |

/**
 * v143 优化调度频率表（生命周期感知版）
 * 
 * 调度器以最高频率运行（启动期频率），但在执行时根据每个优化目标的
 * 生命周期阶段独立判断是否应该执行。这样同一调度器可以服务于
 * 不同生命周期阶段的优化目标。
 */

type OptimizationTaskType = 
  | 'intraday_pacing'
  | 'risk_scan' 
  | 'dayparting_adjustment'
  | 'dayparting_budget'  // v179: 分时预算调整
  | 'daily_bid_optimization' 
  | 'daily_placement_optimization'
  | 'daily_search_term_negation'
  | 'budget_allocation' 
  | 'search_term_harvest' 
  | 'weekly_report'
  | 'nextgen_maintenance'
  | 'nextgen_model_training'
  | 'nextgen_budget_optimization'
  | 'ab_test_metrics'  // v267 P2-2: A/B测试每日指标收集
  | 'auto_stop_loss'  // v503: 自动止血扫描
  | 'system_defense';  // v504: 系统防线全量扫描

interface OptimizationScheduleConfig {
  type: OptimizationTaskType;
  description: string;
  intervalMs: number;
  cronHours?: number[];     // 指定小时执行
  cronDayOfWeek?: number;   // 指定星期几执行 (0=Sunday)
  specificModules?: string[];  // v122: 该任务只执行的优化模块
}

const OPTIMIZATION_SCHEDULE: Record<OptimizationTaskType, OptimizationScheduleConfig> = {
  intraday_pacing: {
    type: 'intraday_pacing',
    description: '日内节奏监控 - 预算消耗速度监控和异常流量检测',
    intervalMs: 30 * 60 * 1000, // 每30分钟
    specificModules: [], // 独立执行，不走优化目标引擎
  },
  risk_scan: {
    type: 'risk_scan',
    description: '高频风控扫描 - 零曝光风暴、异常花销、CPC飙升检测',
    intervalMs: 2 * 60 * 60 * 1000, // 每2小时（从4小时缩短到2小时）
    specificModules: [], // 仅风控，不执行优化模块
  },
  dayparting_adjustment: {
    type: 'dayparting_adjustment',
    description: '分时竞价调整 - 根据当前时段动态调整出价乘数',
    intervalMs: 60 * 60 * 1000, // 每小时
    specificModules: ['multidim', 'dayparting', 'coordination'], // v179: 添加multidim模块以生成分时竞价规则
  },
  dayparting_budget: {
    type: 'dayparting_budget',
    description: 'v179: 分时预算调整 - 根据星期几的表现动态调整预算',
    intervalMs: 24 * 60 * 60 * 1000, // 每天执行一次
    cronHours: [6], // 凌昨6:00执行（在分时竞价规则生成后）
    specificModules: ['multidim', 'dayparting_budget'], // 先生成规则，再应用预算
  },
  daily_bid_optimization: {
    type: 'daily_bid_optimization',
    description: '出价智能优化 - 每2小时基于市场曲线模型自动调整出价',
    intervalMs: 2 * 60 * 60 * 1000, // v122h: 从每日1次提升到每2小时，与宣传一致
    specificModules: ['bid', 'keyword', 'coordination'],
  },
  daily_placement_optimization: {
    type: 'daily_placement_optimization',
    description: '每日位置优化 - 广告位置倾斜比例调整',
    intervalMs: 24 * 60 * 60 * 1000,
    cronHours: [3], // 凌晨3:00
    specificModules: ['placement'], // 仅位置优化
  },
  daily_search_term_negation: {
    type: 'daily_search_term_negation',
    description: 'v337.4: 搜索词否定 - 每6小时自动否定低效搜索词',
    intervalMs: 6 * 60 * 60 * 1000, // v337.4: 24h→6h
    cronHours: [], // v337.4: 移除固定时间限制，改为纯间隔驱动
    specificModules: ['searchterm'], // 仅搜索词分析
  },
  budget_allocation: {
    type: 'budget_allocation',
    description: '预算智能分配 - 早晚两次预算分配',
    intervalMs: 12 * 60 * 60 * 1000,
    cronHours: [8, 18], // 早8:00 + 晚18:00
    specificModules: ['budget'], // 仅预算分配
  },
  search_term_harvest: {
    type: 'search_term_harvest',
    description: 'v337.4: 搜索词收割 - 每8小时自动收割高转化搜索词并添加否定词',
    intervalMs: 8 * 60 * 60 * 1000, // v337.4: 24h→8h
    cronHours: [], // v337.4: 移除固定时间限制，改为纯间隔驱动
    specificModules: [], // 独立执行，使用searchTermHarvester服务
  },
  weekly_report: {
    type: 'weekly_report',
    description: '绩效周报 - 每周自动生成广告优化报告',
    intervalMs: 7 * 24 * 60 * 60 * 1000,
    cronHours: [9], // 上午9:00
    cronDayOfWeek: 1, // 周一
    specificModules: [],
  },
  // v197: 下一代算法定时任务
  nextgen_maintenance: {
    type: 'nextgen_maintenance',
    description: 'v204: NextGen维护 - 特征缓存、Sigmoid拟合、RL Reward回填、因果分析',
    intervalMs: 30 * 60 * 1000, // v232: 从2小时大幅缩短到30分钟，加速算法进化
    specificModules: [],
  },
  nextgen_model_training: {
    type: 'nextgen_model_training',
    description: 'v197: NextGen模型训练 - CQL离线强化学习模型训练',
    intervalMs: 6 * 60 * 60 * 1000, // 每6小时
    specificModules: [],
  },
  nextgen_budget_optimization: {
    type: 'nextgen_budget_optimization',
    description: 'v197: NextGen预算组合优化 + 关键词图谱分析',
    intervalMs: 24 * 60 * 60 * 1000, // 每日
    cronHours: [2], // 凌晨2:00
    specificModules: [],
  },
  ab_test_metrics: {
    type: 'ab_test_metrics',
    description: 'v267: A/B测试每日指标收集',
    intervalMs: 24 * 60 * 60 * 1000, // 每日
    cronHours: [23], // 晚上23:00
    specificModules: [],
  },
  // v503: 自动止血扫描
  auto_stop_loss: {
    type: 'auto_stop_loss',
    description: 'v503: 自动止血扫描 - 高ACoS Campaign暂停、搜索词自动否定、重新激活防护、数据悬崖修复',
    intervalMs: 4 * 60 * 60 * 1000,
    cronHours: [],
    specificModules: [],
  },
  system_defense: {
    type: 'system_defense',
    description: 'v504: 系统防线全量扫描 - 同步清理、算法熔断、死亡螺旋干预、紧急优化',
    intervalMs: 6 * 60 * 60 * 1000, // 每6小时执行一次
    cronHours: [],
    specificModules: [],
  },
};

let optimizationIntervals: Record<OptimizationTaskType, NodeJS.Timeout | null> = {
  intraday_pacing: null,
  risk_scan: null,
  dayparting_adjustment: null,
  dayparting_budget: null, // v179
  daily_bid_optimization: null,
  daily_placement_optimization: null,
  daily_search_term_negation: null,
  budget_allocation: null,
  search_term_harvest: null,
  weekly_report: null,
  // v197: NextGen定时任务
  nextgen_maintenance: null,
  nextgen_model_training: null,
  nextgen_budget_optimization: null,
  ab_test_metrics: null,  // v267 P2-2
  auto_stop_loss: null,  // v503
  system_defense: null,  // v504
};

// v122: 执行锁 - 防止同一任务重复执行
const executionLocks: Record<string, boolean> = {};
// v122: 上次执行时间记录 - 防止同一小时内重复执行
const lastExecutionHour: Record<string, string> = {};

/**
 * v366: 锁函数统一委托给 lockManager.ts，消除重复实现
 * 保留export以兼容可能的外部引用
 */
export const getModuleLockGroup = _lmGetModuleLockGroup;
export const acquireAccountOptimizationLock = _lmAcquireLock;
export const releaseAccountOptimizationLock = _lmReleaseLock;
export const acquireAccountOptimizationLockWithRetry = _lmAcquireLockWithRetry;

// v143: 每个优化目标的每个模块的上次执行时间
// key: `${targetId}:${moduleName}`  value: Date
const moduleLastExecutionMap = new Map<string, Date>();

/**
 * v143: 检查某个优化目标的某个模块是否应该执行
 * 基于生命周期阶段的执行间隔判断
 */
function shouldExecuteModuleForTarget(
  targetId: number,
  moduleName: 'bid' | 'negativeKeyword' | 'searchTermHarvest' | 'placement' | 'budget' | 'dayparting',
  stage: campaignLifecycleService.LifecycleStage
): { shouldExecute: boolean; reason: string } {
  const key = `${targetId}:${moduleName}`;
  const lastExecuted = moduleLastExecutionMap.get(key) || null;
  const result = campaignLifecycleService.shouldExecuteModule(moduleName, lastExecuted, stage);
  return { shouldExecute: result.shouldExecute, reason: result.reason };
}

/**
 * v242: 记录某个优化目标的某个模块的执行时间
 * 同时更新内存Map和数据库，确保部署重启后能精确恢复每个模块的执行时间
 */
export async function recordModuleExecution(targetId: number, moduleName: string): Promise<void> {
  const key = `${targetId}:${moduleName}`;
  const now = new Date();
  moduleLastExecutionMap.set(key, now);
  
  // v242: 持久化到数据库 - 使用module_execution_times JSON字段
  try {
    const dbInstance = await db.getDb();
    if (dbInstance) {
      // 先读取当前的模块执行时间JSON，然后更新对应模块
      const rows = await dbInstance.execute(sql`SELECT module_execution_times FROM performance_groups WHERE id = ${targetId}`);
      let executionTimes: Record<string, string> = {};
      // @ts-expect-error - type assertion
      const rowData = Array.isArray(rows) ? rows[0] : (rows as unknown)?.rows?.[0];
      if (rowData) {
        const rawArr = Array.isArray(rowData) ? rowData : [rowData];
        for (const r of rawArr) {
          // @ts-expect-error - dynamic property access
          const met = (r as Record<string, unknown>).module_execution_times;
          if (met) {
            try {
              executionTimes = JSON.parse(met);
            } catch (e) {
              executionTimes = {};
            }
            break;
          }
        }
      }
      executionTimes[moduleName] = now.toISOString();
      await dbInstance.execute(sql`UPDATE performance_groups SET module_execution_times = ${JSON.stringify(executionTimes)} WHERE id = ${targetId}`);
    }
  } catch (dbErr: unknown) {
    // 数据库更新失败不影响内存Map的正常工作
    log.warn(`[OptimizationScheduler] v242: 持久化模块执行时间失败(target=${targetId}, module=${moduleName}): ${(dbErr as Error).message}`);
  }
}

/**
 * 获取执行锁
 */
function acquireLock(taskType: string): boolean {
  if (executionLocks[taskType]) {
    log.info(`[OptimizationScheduler] 任务 ${taskType} 正在执行中，跳过`);
    return false;
  }
  executionLocks[taskType] = true;
  return true;
}

/**
 * 释放执行锁
 */
function releaseLock(taskType: string): void {
  executionLocks[taskType] = false;
}

/**
 * 检查是否应该在当前小时执行（防止同一小时重复执行）
 */
function shouldExecuteThisHour(taskType: string): boolean {
  const now = new Date();
  const hourKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}`;
  if (lastExecutionHour[taskType] === hourKey) {
    return false;
  }
  lastExecutionHour[taskType] = hourKey;
  return true;
}

/**
 * 启动生命周期感知的智能优化调度器 (v143 重构版)
 * 
 * 核心设计：
 * - 调度器以最高频率运行（启动期频率）
 * - 每次触发时，遍历所有优化目标，根据各自生命周期阶段独立判断是否应该执行
 * - 新广告活动（启动期）获得更高频率的检查，快速迭代探索
 * - 成熟广告活动低频稳优，避免过度干预
 */
export async function startOptimizationScheduler(): Promise<void> {
  log.info('[OptimizationScheduler] 启动v156生命周期感知智能优化调度器...');
  
  // v242: 从数据库恢复各模块的上次执行时间（模块级别精确恢复）
  // 优先从 module_execution_times JSON字段恢复各模块独立的执行时间
  // 回退方案：使用 last_optimization_at 作为所有模块的基准时间
  try {
    const { getEnabledOptimizationTargets } = await import('../optimization/optimizationTargetEngine');
    const targets = await getEnabledOptimizationTargets();
    const dbInstance = await db.getDb();
    let restoredFromJson = 0;
    let restoredFromFallback = 0;
    
    for (const target of targets) {
      let moduleTimesRestored = false;
      
      // 优先尝试从 module_execution_times JSON字段恢复
      if (dbInstance) {
        try {
          const rows = await dbInstance.execute(sql`SELECT module_execution_times FROM performance_groups WHERE id = ${target.id}`);
          // Drizzle mysql2返回 [rows, fields]，取第一个元素
          const resultRows = Array.isArray(rows) ? rows[0] : rows;
          const dataArr = Array.isArray(resultRows) ? resultRows : [resultRows];
          for (const row of (dataArr as unknown[])) {
            // @ts-expect-error - type assertion
            const met = (row as unknown)?.module_execution_times;
            if (met) {
              const executionTimes = JSON.parse(met);
              const modules = Object.keys(executionTimes);
              if (modules.length > 0) {
                for (const mod of modules) {
                  const key = `${target.id}:${mod}`;
                  if (!moduleLastExecutionMap.has(key)) {
                    moduleLastExecutionMap.set(key, new Date(executionTimes[mod]));
                  }
                }
                moduleTimesRestored = true;
                restoredFromJson++;
                log.info(`[OptimizationScheduler] v242: 从模块执行时间JSON恢复 ${target.name}: ${modules.map(m => `${m}=${executionTimes[m]}`).join(', ')}`);
              }
              break;
            }
          }
        } catch (jsonErr: unknown) {
          log.warn(`[OptimizationScheduler] v242: 解析模块执行时间JSON失败(target=${target.id}): ${(jsonErr as Error).message}`);
        }
      }
      
      // v242f: 回退方案优化 - 不再使用 last_optimization_at 填充模块执行时间
      // 原因：PostDeploy会更新last_optimization_at为当前时间，导致所有模块被误判为“刚执行过”
      // 新策略：不填充任何值，让shouldExecuteModule的“首次执行”逻辑生效（lastExecutedAt=null时返回true）
      if (!moduleTimesRestored) {
        restoredFromFallback++;
        log.info(`[OptimizationScheduler] v242f: ${target.name} 无模块执行时间记录，将允许首次执行 (不再使用last_optimization_at回退)`);
      }
    }
    log.info(`[OptimizationScheduler] v242: 已恢复 ${moduleLastExecutionMap.size} 个模块执行时间记录 (JSON精确恢复=${restoredFromJson}, 回退恢复=${restoredFromFallback})`);
  } catch (restoreErr: unknown) {
    log.warn(`[OptimizationScheduler] v242: 恢复模块执行时间失败: ${(restoreErr as Error).message}`);
  }
  
  // v181: 所有任务添加启动偏移量，避免多个任务同时触发导致锁竞争
  // 偏移量从1分钟开始，每个任务错开5分钟
  
  // 0. 日内节奏监控 - 每30分钟（偏移1分钟）
  setTimeout(() => {
    optimizationIntervals.intraday_pacing = setInterval(async () => {
      await executeOptimizationTask('intraday_pacing');
    }, OPTIMIZATION_SCHEDULE.intraday_pacing.intervalMs);
    executeOptimizationTask('intraday_pacing'); // 立即执行一次
  }, 1 * 60 * 1000);
  log.info(`[OptimizationScheduler] 日内节奏监控已启动，间隔: 30分钟，偏移: 1分钟`);
  
  // 1. 高频风控扫描 - 每2小时（偏移6分钟）
  setTimeout(() => {
    optimizationIntervals.risk_scan = setInterval(async () => {
      await executeOptimizationTask('risk_scan');
    }, OPTIMIZATION_SCHEDULE.risk_scan.intervalMs);
    executeOptimizationTask('risk_scan'); // 立即执行一次
  }, 6 * 60 * 1000);
  log.info(`[OptimizationScheduler] 高频风控扫描已启动，间隔: 2小时，偏移: 6分钟`);
  
  // 2. 分时竞价调整 - 每小时（偏移11分钟）
  setTimeout(() => {
    optimizationIntervals.dayparting_adjustment = setInterval(async () => {
      await executeOptimizationTask('dayparting_adjustment');
    }, OPTIMIZATION_SCHEDULE.dayparting_adjustment.intervalMs);
    executeOptimizationTask('dayparting_adjustment'); // 立即执行一次
  }, 11 * 60 * 1000);
  log.info(`[OptimizationScheduler] 分时竞价调整已启动，间隔: 1小时，偏移: 11分钟`);
  
  // 2.5 v179: 分时预算调整 - 每天执行一次（偏移16分钟）
  setTimeout(() => {
    optimizationIntervals.dayparting_budget = setInterval(async () => {
      await executeOptimizationTask('dayparting_budget');
    }, OPTIMIZATION_SCHEDULE.dayparting_budget.intervalMs);
  }, 16 * 60 * 1000);
  log.info(`[OptimizationScheduler] v179: 分时预算调整已启动，间隔: 24小时，偏移: 16分钟`);
  
  // 3. v143: 出价智能优化 - 每2小时触发（偏移21分钟）
  // 启动期: 每4小时执行 | 成长期: 每6小时 | 成熟期: 每12小时
  setTimeout(() => {
    optimizationIntervals.daily_bid_optimization = setInterval(async () => {
      await executeOptimizationTask('daily_bid_optimization');
    }, OPTIMIZATION_SCHEDULE.daily_bid_optimization.intervalMs);
    executeOptimizationTask('daily_bid_optimization'); // 立即执行一次
  }, 21 * 60 * 1000);
  log.info(`[OptimizationScheduler] 出价智能优化已启动，触发间隔: 2小时，偏移: 21分钟`);
  
  // 4. v143: 位置优化 - 每4小时触发（偏移26分钟）
  // 启动期: 每24小时 | 成长期: 每12小时 | 成熟期: 每12小时
  setTimeout(() => {
    optimizationIntervals.daily_placement_optimization = setInterval(async () => {
      await executeOptimizationTask('daily_placement_optimization');
    }, 4 * 60 * 60 * 1000);
    executeOptimizationTask('daily_placement_optimization'); // 立即执行一次
  }, 26 * 60 * 1000);
  log.info(`[OptimizationScheduler] 位置优化已启动，触发间隔: 4小时，偏移: 26分钟`);
  
  // 5. v337.4: 搜索词否定 - 每6小时触发（偏移31分钟）
  // v337.4优化: 12h→6h，配合生命周期层控制实际执行频率
  // 启动期: 每12小时 | 成长期: 每8小时 | 成熟期: 每8小时
  setTimeout(() => {
    optimizationIntervals.daily_search_term_negation = setInterval(async () => {
      await executeOptimizationTask('daily_search_term_negation');
    }, 6 * 60 * 60 * 1000);
    executeOptimizationTask('daily_search_term_negation'); // 立即执行一次
  }, 31 * 60 * 1000);
  log.info(`[OptimizationScheduler] v337.4: 搜索词否定已启动，触发间隔: 6小时，偏移: 31分钟`);
  
  // 6. 预算智能分配 - 每4小时（偏移36分钟）
  setTimeout(() => {
    optimizationIntervals.budget_allocation = setInterval(async () => {
      await executeOptimizationTask('budget_allocation');
    }, 4 * 60 * 60 * 1000);
    executeOptimizationTask('budget_allocation'); // 立即执行一次
  }, 36 * 60 * 1000);
  log.info(`[OptimizationScheduler] 预算智能分配已启动，间隔: 4小时，偏移: 36分钟`);
   // 7. v337.4: 搜索词收割 - 每8小时触发（偏移41分钟）
  // v337.4优化: 移除cronHours限制，改为纯间隔驱动，配合生命周期层控制实际执行频率
  // 启动期: 每24小时 | 成长期: 每12小时 | 成熟期: 每12小时
  setTimeout(() => {
    optimizationIntervals.search_term_harvest = setInterval(async () => {
      await executeOptimizationTask('search_term_harvest');
    }, 8 * 60 * 60 * 1000);
    executeOptimizationTask('search_term_harvest'); // 立即执行一次
  }, 41 * 60 * 1000);
  log.info(`[OptimizationScheduler] v337.4: 搜索词收割已启动，触发间隔: 8小时，偏移: 41分钟`);
  
  // 8. 绩效周报 - 周一上午9:00（站点本地时间）
  optimizationIntervals.weekly_report = setInterval(async () => {
    const now = new Date();
    // v182: 使用默认US站点本地时间
    const localHour = getLocalHour(now, 'US');
    const localDow = getLocalDayOfWeek(now, 'US');
    if (localDow === 1 && localHour === 9 && shouldExecuteThisHour('weekly_report')) {
      await executeOptimizationTask('weekly_report');
    }
  }, 60 * 60 * 1000);
  log.info(`[OptimizationScheduler] 绩效周报已启动，执行时间: 周一上午9:00 (站点本地时间)`);
  
  log.info('[OptimizationScheduler] v143生命周期感知调度器启动完成');
  log.debug('[OptimizationScheduler] 生命周期频率表:');
  log.info('  | 模块           | 启动期  | 成长期  | 成熟期  |');
  log.debug('  |----------------|---------|---------|---------|');
  log.debug('  | 出价优化       | 4小时   | 6小时   | 12小时  |');
  log.debug('  | 分时调整       | 1小时   | 1小时   | 1小时   |');
  log.debug('  | 位置倾斜       | 24小时  | 12小时  | 12小时  |');
  log.debug('  | 否定搜索词     | 48小时  | 24小时  | 24小时  |');
  log.debug('  | 搜索词迁移     | 72小时  | 48小时  | 24小时  |');
  log.debug('  | 预算分配       | 4小时   | 4小时   | 4小时   |');
  
  // v167: 启动自动纠错服务
  try {
    startAutoCorrector();
    log.info('[OptimizationScheduler] v167: 自动纠错服务已启动');
  } catch (correctorErr: unknown) {
    log.warn('[OptimizationScheduler] v167: 自动纠错服务启动失败:', (correctorErr as Error).message);
  }
  
  // v204: 启动NextGen维护任务 - 启动后立即执行，然后每2小时重复
  // v204修复: 移除41分钟偏移，避免服务器重启后维护任务永远无法执行
  // v232: 启动后延迟2分钟立即执行一次，确保快速生成初始特征和模型
  setTimeout(() => {
    executeOptimizationTask('nextgen_maintenance');
  }, 2 * 60 * 1000);
  optimizationIntervals.nextgen_maintenance = setInterval(async () => {
    await executeOptimizationTask('nextgen_maintenance');
  }, OPTIMIZATION_SCHEDULE.nextgen_maintenance.intervalMs);
  log.info(`[OptimizationScheduler] v232: NextGen维护任务已启动，间隔: ${OPTIMIZATION_SCHEDULE.nextgen_maintenance.intervalMs / 60000}分钟，首次执行: 2分钟后`);
  
  // v204: 启动NextGen模型训练 - 启动后10分钟执行，然后每6小时重复
  // v204修复: 移除46分钟偏移，确保模型训练能在维护任务之后执行
  optimizationIntervals.nextgen_model_training = setInterval(async () => {
    await executeOptimizationTask('nextgen_model_training');
  }, OPTIMIZATION_SCHEDULE.nextgen_model_training.intervalMs);
  setTimeout(() => {
    executeOptimizationTask('nextgen_model_training');
  }, 10 * 60 * 1000);
  log.info(`[OptimizationScheduler] v204: NextGen模型训练已启动，间隔: 6小时，首次执行: 10分钟后`);
  
  // v197: 启动NextGen预算优化+关键词图谱 - 每日凌晨2:00
  optimizationIntervals.nextgen_budget_optimization = setInterval(async () => {
    const now = new Date();
    const localHour = getLocalHour(now, 'US');
    if (localHour === 2 && shouldExecuteThisHour('nextgen_budget_optimization')) {
      await executeOptimizationTask('nextgen_budget_optimization');
    }
  }, 60 * 60 * 1000);
  log.info(`[OptimizationScheduler] v197: NextGen预算优化+关键词图谱已启动，执行时间: 每日凌昨2:00`);
  
  // v267 P2-2: A/B测试每日指标收集和自动分析 - 每日凌昨3:00执行
  optimizationIntervals.ab_test_metrics = setInterval(async () => {
    const now = new Date();
    const localHour = getLocalHour(now, 'US');
    if (localHour === 3 && shouldExecuteThisHour('ab_test_metrics')) {
      try {
        const abTestService = await import('../analytics/abTestService');
        const db = await import('../db');
        // 获取所有活跃账户
        const accounts = await db.getAdAccounts();
        for (const account of (accounts as unknown[])) {
          const tests = await abTestService.getABTests(account.id);
          const activeTests = tests.filter((t: Record<string, unknown>) => t.status === 'running');
          for (const test of activeTests) {
            try {
              // 收集每日指标
              // v329: recordDailyMetrics需要testId, variantId, metrics三个参数
              // 此处简化为仅触发分析，指标收集由abTestIntegration负责
              // 检查是否已达到统计显著性
              const analysis = await abTestService.analyzeABTestResults(test.id);
              const primaryMetric = analysis.metrics?.[0];
              if (primaryMetric?.isSignificant) {
                log.info(`[ABTestScheduler] v267: 测试${test.id}已达到统计显著性! 胜者: ${analysis.overallWinner}, p值: ${primaryMetric.pValue}`);
              }
              // 检查是否超时（超过30天自动完成）
              const startDate = test.startDate ? new Date(test.startDate) : null;
              const daysSinceStart = startDate ? (Date.now() - startDate.getTime()) / (1000 * 60 * 60 * 24) : 0;
              if (daysSinceStart > 30) {
                await abTestService.completeABTest(test.id);
                log.info(`[ABTestScheduler] v267: 测试${test.id}超过30天，自动完成`);
              }
            } catch (testErr: unknown) {
              log.warn(`[ABTestScheduler] v267: 处理测试${test.id}失败: ${(testErr as Error).message}`);
            }
          }
        }
        log.info(`[ABTestScheduler] v267: A/B测试每日指标收集完成`);
      } catch (err: unknown) {
        log.warn(`[ABTestScheduler] v267: A/B测试调度失败: ${(err as Error).message}`);
      }
    }
  }, 60 * 60 * 1000);  log.info(`[OptimizationScheduler] v267: A/B测试指标收集已启动，执行时间: 每日凌昨昨3:00`);

  // v361: 自动数据清理 - 每天凌晨4:00执行
  monitoringIntervals.push(setInterval(async () => {
    const now = new Date();
    const localHour = getLocalHour(now, 'US');
    if (localHour === 4 && shouldExecuteThisHour('data_cleanup')) {
      try {
        log.info('[DataCleanup] v350: 开始自动数据清理...');
        const { getDirectConnection } = await import('../db');
        const conn = await getDirectConnection(120_000);
        try {
          const RETENTION_DAYS = 30;
          // 清理sync_conflicts
          const [r1] = await conn.execute(
            `DELETE FROM sync_conflicts WHERE created_at < DATE_SUB(NOW(), INTERVAL ${sql.raw(String(RETENTION_DAYS))} DAY)`
          ) as unknown[];
          // 清理sync_change_records
          const [r2] = await conn.execute(
            `DELETE FROM sync_change_records WHERE created_at < DATE_SUB(NOW(), INTERVAL ${sql.raw(String(RETENTION_DAYS))} DAY)`
          ) as unknown[];
          // 清理system_logs
          const [r3] = await conn.execute(
            `DELETE FROM system_logs WHERE timestamp < DATE_SUB(NOW(), INTERVAL ${sql.raw(String(RETENTION_DAYS))} DAY)`
          ) as unknown[];
          // 清理已完成的optimization_tasks
          const [r4] = await conn.execute(
            `DELETE FROM optimization_tasks WHERE status IN ('synced', 'permanently_failed') AND created_at < DATE_SUB(NOW(), INTERVAL ${sql.raw(String(RETENTION_DAYS))} DAY)`
          ) as unknown[];
          log.warn(`[DataCleanup] v350: 自动清理完成 - sync_conflicts:${r1.affectedRows}, sync_change_records:${r2.affectedRows}, system_logs:${r3.affectedRows}, optimization_tasks:${r4.affectedRows}`);
        } finally {
          conn.release();
        }
      } catch (err: unknown) {
        log.warn(`[DataCleanup] v350: 自动数据清理失败: ${(err as Error).message}`);
      }
    }
  }, 60 * 60 * 1000));  log.info(`[OptimizationScheduler] v350: 自动数据清理已启动，执行时间: 每日凌昨晨4:00 (EST)`);

  // v503: 启动自动止血扫描 - 每4小时执行一次，启动后5分钟执行首次扫描
  try {
    const { executeFullStopLossScan } = await import('../automation/autoStopLossService');
    const { getAdAccounts } = await import('../db/accounts');
    
    // 首次扫描延迟5分钟
    setTimeout(async () => {
      try {
        const accounts = await getAdAccounts();
        for (const account of (accounts as Array<{ id: number }>)) {
          try {
            await executeFullStopLossScan(account.id);
          } catch (accountErr: unknown) {
            log.warn(`[AutoStopLoss] 账户${account.id}止血扫描失败: ${(accountErr as Error).message}`);
          }
        }
      } catch (err: unknown) {
        log.warn(`[AutoStopLoss] 首次止血扫描失败: ${(err as Error).message}`);
      }
    }, 5 * 60 * 1000);
    
    // 定时扫描 - 每4小时
    optimizationIntervals.auto_stop_loss = setInterval(async () => {
      try {
        const accounts = await getAdAccounts();
        for (const account of (accounts as Array<{ id: number }>)) {
          try {
            await executeFullStopLossScan(account.id);
          } catch (accountErr: unknown) {
            log.warn(`[AutoStopLoss] 账户${account.id}止血扫描失败: ${(accountErr as Error).message}`);
          }
        }
      } catch (err: unknown) {
        log.warn(`[AutoStopLoss] 定时止血扫描失败: ${(err as Error).message}`);
      }
    }, OPTIMIZATION_SCHEDULE.auto_stop_loss.intervalMs);
    
    log.info(`[OptimizationScheduler] v503: 自动止血扫描已启动，间隔: ${OPTIMIZATION_SCHEDULE.auto_stop_loss.intervalMs / 3600000}小时，首次执行: 5分钟后`);
  } catch (stopLossErr: unknown) {
    log.warn(`[OptimizationScheduler] v503: 自动止血服务启动失败: ${(stopLossErr as Error).message}`);
  }

  // v504: 系统防线全量扫描
  try {
    const { runSystemDefenseScan } = await import('../system/systemDefenseService');
    
    // 首次扫描: 服务启动后10分钟执行
    setTimeout(async () => {
      try {
        const scanResult = await runSystemDefenseScan();
        log.info(`[SystemDefense] 首次扫描完成: ${scanResult.summary}`);
      } catch (firstErr: unknown) {
        log.warn(`[SystemDefense] 首次扫描失败: ${(firstErr as Error).message}`);
      }
    }, 10 * 60 * 1000);

    // 定时扫描: 每6小时执行一次
    optimizationIntervals.system_defense = setInterval(async () => {
      try {
        const scanResult = await runSystemDefenseScan();
        log.info(`[SystemDefense] 定时扫描完成: ${scanResult.summary}`);
      } catch (err: unknown) {
        log.warn(`[SystemDefense] 定时扫描失败: ${(err as Error).message}`);
      }
    }, OPTIMIZATION_SCHEDULE.system_defense.intervalMs);

    log.info(`[OptimizationScheduler] v504: 系统防线已启动，间隔: ${OPTIMIZATION_SCHEDULE.system_defense.intervalMs / 3600000}小时，首次执行: 10分钟后`);
  } catch (defenseErr: unknown) {
    log.warn(`[OptimizationScheduler] v504: 系统防线启动失败: ${(defenseErr as Error).message}`);
  }
}

/**
 * 停止优化调度器
 */
export function stopOptimizationScheduler(): void {
  Object.keys(optimizationIntervals).forEach((type: unknown) => {
    const interval = optimizationIntervals[type as OptimizationTaskType];
    if (interval) {
      clearInterval(interval);
      optimizationIntervals[type as OptimizationTaskType] = null;
    }
  });
  log.debug('[OptimizationScheduler] 分层优化调度器已停止');
  
  // v167: 停止自动纠错服务
  try {
    stopAutoCorrector();
  } catch (e: unknown) { log.debug(`停止AutoCorrector时忽略: ${(e as Error).message}`); }
}

/**
 * 执行优化任务 (v122 重构版)
 * 
 * 核心修复：
 * 1. 每个任务只执行对应的 specificModules，不再全量执行所有优化模块
 * 2. 风控扫描不再调用 executeAllEnabledTargets（之前每4小时执行全量优化）
 * 3. 新增日内节奏监控和分时竞价独立调度
 * 4. 使用执行锁防止重复执行
 */
async function executeOptimizationTask(taskType: OptimizationTaskType): Promise<void> {
   // v491: 部署恢复门控 — 纠错和验证全部完成前，不执行定期优化
   // 确保新版本上线后先完成: 扫描优化日志 → 分析合理性 → 纠正错误动作 → 确认Amazon执行
   // 然后才允许定期自动优化开始
   try {
     const { isDeployRecoveryComplete } = await import('../deployLifecycleManager');
     if (!isDeployRecoveryComplete()) {
       log.info(`[OptimizationScheduler] v491: 部署恢复尚未完成（纠错/验证进行中），跳过定期优化任务: ${taskType}`);
       return;
     }
   } catch (gateErr: unknown) {
     // 如果门控检查失败，默认允许执行（避免死锁）
     log.warn(`[OptimizationScheduler] v491: 部署恢复门控检查失败，默认允许执行: ${(gateErr as Error).message}`);
   }
   
   // v384: 单实例模式，无需Leader检查，直接执行优化任务
   // 获取执行锁
   if (!acquireLock(taskType)) return;
  
  // v347: 内存预算检查 - 使用绝对内存值(MB)作为阈值
  // 修复v329的bug: heapUsed/heapTotal百分比不可靠，因为V8的heapTotal是动态增长的
  // 例如 heapUsed=102MB, heapTotal=115MB → 89%，但max-old-space-size=1400MB，实际只用了7%
  // 改为使用RSS(常驻内存)的绝对值作为判断标准
  const mem = process.memoryUsage();
  const rssMB = Math.round(mem.rss / 1024 / 1024);
  const heapUsedMB = Math.round(mem.heapUsed / 1024 / 1024);
  const heapTotalMB = Math.round(mem.heapTotal / 1024 / 1024);
  
  // v393: 使用systemConfigService动态计算内存阈值，替代硬编码值
  // 基于实际的--max-old-space-size动态计算，确保在不同实例类型下自动适配
  const { memoryConfig } = require('../services/systemConfigService');
  const MEMORY_CRITICAL_MB = memoryConfig.rssCriticalMB;  // RSS超过此值: 危急，跳过所有任务
  const MEMORY_WARNING_MB = memoryConfig.rssWarningMB;    // RSS超过此值: 紧张，跳过非关键任务
  
  // 关键任务：出价优化、风控扫描、日内节奏、分时策略
  // v349: 将dayparting_adjustment添加为关键任务，防止因内存压力被跳过导致分时策略停滞
  const criticalTasks: OptimizationTaskType[] = ['daily_bid_optimization', 'risk_scan', 'intraday_pacing', 'dayparting_adjustment'];
  const isCritical = criticalTasks.includes(taskType);
  
  if (rssMB > MEMORY_CRITICAL_MB) {
    // 内存危急: 跳过所有任务，触发GC
    log.warn(`[OptimizationScheduler] v347: 内存危急(RSS=${rssMB}MB, heap=${heapUsedMB}/${heapTotalMB}MB)，跳过任务: ${taskType}`);
    if (typeof global.gc === 'function') global.gc();
    releaseLock(taskType);
    return;
  }
  
  if (rssMB > MEMORY_WARNING_MB && !isCritical) {
    // 内存紧张: 跳过非关键任务
    log.warn(`[OptimizationScheduler] v347: 内存紧张(RSS=${rssMB}MB, heap=${heapUsedMB}/${heapTotalMB}MB)，跳过非关键任务: ${taskType}`);
    if (typeof global.gc === 'function') global.gc();
    releaseLock(taskType);
    return;
  }
  
  const config = OPTIMIZATION_SCHEDULE[taskType];
  log.info(`[OptimizationScheduler] 开始执行: ${config.description} - RSS=${rssMB}MB, heap=${heapUsedMB}/${heapTotalMB}MB - ${new Date().toISOString()}`);
  
  try {
    // 直接导入优化目标引擎
    const { executeAllEnabledTargets, getEnabledOptimizationTargets } = await import('../optimization/optimizationTargetEngine');
    
    switch (taskType) {
      // ==================== 日内节奏监控（每30分钟）====================
      case 'intraday_pacing': {
        log.info(`[OptimizationScheduler] 执行日内节奏监控`);
        try {
          const { checkAllCampaignsPacing, applyIntradayAdjustment } = await import('../services/intradayPacingService');
          const targets = await getEnabledOptimizationTargets();
          const checkedAccountIds = new Set<number>();
          
          for (const target of targets) {
            if (checkedAccountIds.has(target.accountId)) continue;
            checkedAccountIds.add(target.accountId);
            
            try {
              const adjustments = await checkAllCampaignsPacing(target.accountId);
              const criticalCount = adjustments.filter(a => a.pacingStatus === 'critical' || a.anomalyDetected).length;
              const overspendCount = adjustments.filter(a => a.pacingStatus === 'overspending').length;
              const underspendCount = adjustments.filter(a => a.pacingStatus === 'underspending').length;
              
              // 自动应用调整（仅对critical和overspending的Campaign）
              for (const adj of adjustments) {
                if (adj.suggestedAction !== 'none' && (adj.pacingStatus === 'critical' || adj.pacingStatus === 'overspending')) {
                  await applyIntradayAdjustment(adj);
                }
              }
              
              log.info(`[OptimizationScheduler] 账号 ${target.accountId} 日内节奏检查完成: ` +
                `${adjustments.length}个Campaign, 危急=${criticalCount}, 超速=${overspendCount}, 欠速=${underspendCount}`);
            } catch (pacingError: unknown) {
              log.warn(`[OptimizationScheduler] 账号 ${target.accountId} 日内节奏检查异常:`, (pacingError as Error).message);
            }
          }
        } catch (pacingError: unknown) {
          log.warn(`[OptimizationScheduler] 日内节奏监控异常:`, (pacingError as Error).message);
        }
        break;
      }
      
      // ==================== 高频风控扫描（每2小时，仅风控）====================
      case 'risk_scan': {
        // v122修复：风控扫描仅执行风险检测，不再调用executeAllEnabledTargets
        log.info(`[OptimizationScheduler] 执行风控扫描(仅风控，不含优化)`);
        try {
          const targets = await getEnabledOptimizationTargets();
          const scannedAccountIds = new Set<number>();
          
          for (const target of targets) {
            if (scannedAccountIds.has(target.accountId)) continue;
            scannedAccountIds.add(target.accountId);
            
            try {
              const riskCampaigns = await db.getCampaignsByAccountId(target.accountId);
              const enabledCampaigns = riskCampaigns.filter((c: Record<string, unknown>) => c.campaignStatus === 'enabled');
              let totalRisks = 0;
              for (const campaign of (enabledCampaigns as unknown[])) {
                const riskResult = await detectRiskSignals(target.accountId, campaign.campaignId);
                if (riskResult.hasRisk) {
                  totalRisks += riskResult.risks.length;
                  for (const risk of riskResult.risks) {
                    log.warn(`[RiskScan] Campaign ${campaign.campaignName}: ` +
                      `[${risk.severity}] ${risk.description}`);
                  }
                }
              }
              log.info(`[OptimizationScheduler] 账号 ${target.accountId} 风控扫描完成: ${enabledCampaigns.length}个Campaign, ${totalRisks}个风险信号`);
            } catch (riskError: unknown) {
              log.warn(`[OptimizationScheduler] 账号 ${target.accountId} 风控扫描异常:`, (riskError as Error).message);
            }
          }
        } catch (riskError: unknown) {
          log.warn(`[OptimizationScheduler] 风控扫描异常:`, (riskError as Error).message);
        }
        // v122修复：删除了此处的 executeAllEnabledTargets() 调用
        // 之前风控扫描会执行全量优化（出价+位置+分时+搜索词+预算+关键词），导致所有模块的独立调度频率失效
        break;
      }
      
      // ==================== 分时竞价调整（每小时）====================
      case 'dayparting_adjustment': {
        log.info(`[OptimizationScheduler] 执行分时竞价调整`);
        try {
          // v179: 添加multidim模块以生成分时竞价规则，然后由dayparting模块应用
          const daypartingResults = await executeAllEnabledTargets(undefined, { 
            dryRun: false, 
            specificModules: ['multidim', 'dayparting', 'coordination'] 
          });
          log.info(`[OptimizationScheduler] 分时竞价调整完成: ${daypartingResults.length}个目标`);
          for (const r of daypartingResults) {
            log.debug(`  - ${r.targetName}: 分时调整=${r.daypartingOptimization.adjustmentsCount}`);
          }
          // v351: 修复遗漏 — dayparting使用executeAllEnabledTargets但未记录模块执行时间
          // 导致module_execution_times中dayparting停留在2月28日，其他模块正常更新
          for (const r of daypartingResults) {
            if (r.status !== 'failed') {
              try {
                await recordModuleExecution(r.targetId, 'dayparting');
              } catch (recErr: unknown) {
                log.warn(`[OptimizationScheduler] v351: recordModuleExecution(dayparting)失败: ${(recErr as Error).message}`);
              }
            }
          }
        } catch (daypartingError: unknown) {
          log.warn(`[OptimizationScheduler] 分时竞价调整失败:`, (daypartingError as Error).message);
        }
        break;
      }
      
      // ==================== v179: 分时预算调整（每天凌昨6:00）====================
      case 'dayparting_budget': {
        log.info(`[OptimizationScheduler] v179: 执行分时预算调整`);
        try {
          // 先生成规则（multidim），再应用预算（dayparting_budget）
          const daypartingBudgetResults = await executeAllEnabledTargets(undefined, { 
            dryRun: false, 
            specificModules: ['multidim', 'dayparting_budget'] 
          });
          log.info(`[OptimizationScheduler] v179: 分时预算调整完成: ${daypartingBudgetResults.length}个目标`);
          for (const r of daypartingBudgetResults) {
            log.debug(`  - ${r.targetName}: 分时预算调整=${r.daypartingBudgetOptimization?.adjustmentsCount || 0}`);
          }
        } catch (daypartingBudgetError: unknown) {
          log.warn(`[OptimizationScheduler] v179: 分时预算调整失败:`, (daypartingBudgetError as Error).message);
        }
        break;
      }
        
      // ==================== v143: 出价智能优化（生命周期感知）====================
      case 'daily_bid_optimization': {
        log.info(`[OptimizationScheduler] 出价优化触发，开始生命周期感知执行...`);
        try {
          const targets = await getEnabledOptimizationTargets();
          let executedCount = 0;
          let skippedCount = 0;
          
          for (const target of targets) {
            const stage = target.lifecycleStage || 'mature';
            const check = shouldExecuteModuleForTarget(target.id, 'bid', stage);
            
            if (!check.shouldExecute) {
              skippedCount++;
              log.info(`[OptimizationScheduler] 跳过出价优化: ${target.name} (${check.reason})`);
              continue;
            }
            
            try {
              const { executeOptimizationTarget } = await import('../optimization/optimizationTargetEngine');
              const result = await executeOptimizationTarget(target.id, {
                dryRun: false,
                specificModules: ['bid', 'keyword', 'coordination'],
              });
              await recordModuleExecution(target.id, 'bid');
              executedCount++;
              log.debug(`  - ${target.name} [${stage}]: 出价调整=${result.bidOptimization.adjustmentsCount}, 关键词暂停=${result.keywordStatusChanges.pausedCount}`);
            } catch (targetErr: unknown) {
              log.warn(`  - ${target.name} 出价优化失败: ${(targetErr as Error).message}`);
            }
          }
          
          log.info(`[OptimizationScheduler] v273出价优化完成: 执行=${executedCount}, 跳过=${skippedCount}, 总目标=${targets.length}, 时间=${new Date().toISOString()}`);
        } catch (bidError: unknown) {
          log.warn(`[OptimizationScheduler] 出价优化失败:`, (bidError as Error).message);
        }
        break;
      }
      
      // ==================== v143: 位置优化（生命周期感知）====================
      case 'daily_placement_optimization': {
        log.info(`[OptimizationScheduler] 位置优化触发，开始生命周期感知执行...`);
        try {
          const targets = await getEnabledOptimizationTargets();
          let executedCount = 0;
          let skippedCount = 0;
          
          for (const target of targets) {
            const stage = target.lifecycleStage || 'mature';
            const check = shouldExecuteModuleForTarget(target.id, 'placement', stage);
            
            if (!check.shouldExecute) {
              skippedCount++;
              log.info(`[OptimizationScheduler] 跳过位置优化: ${target.name} (${check.reason})`);
              continue;
            }
            
            try {
              const { executeOptimizationTarget } = await import('../optimization/optimizationTargetEngine');
              const result = await executeOptimizationTarget(target.id, {
                dryRun: false,
                specificModules: ['placement'],
              });
              await recordModuleExecution(target.id, 'placement');
              executedCount++;
              log.debug(`  - ${target.name} [${stage}]: 位置调整=${result.placementOptimization.adjustmentsCount}`);
            } catch (targetErr: unknown) {
              log.warn(`  - ${target.name} 位置优化失败: ${(targetErr as Error).message}`);
            }
          }
          
          log.info(`[OptimizationScheduler] 位置优化完成: 执行=${executedCount}, 跳过=${skippedCount}`);
        } catch (placementError: unknown) {
          log.warn(`[OptimizationScheduler] 位置优化失败:`, (placementError as Error).message);
        }
        break;
      }
      
      // ==================== v143: 搜索词否定（生命周期感知）====================
      case 'daily_search_term_negation': {
        log.info(`[OptimizationScheduler] 搜索词否定触发，开始生命周期感知执行...`);
        try {
          const targets = await getEnabledOptimizationTargets();
          let executedCount = 0;
          let skippedCount = 0;
          
          for (const target of targets) {
            const stage = target.lifecycleStage || 'mature';
            const check = shouldExecuteModuleForTarget(target.id, 'negativeKeyword', stage);
            
            if (!check.shouldExecute) {
              skippedCount++;
              log.info(`[OptimizationScheduler] 跳过搜索词否定: ${target.name} (${check.reason})`);
              continue;
            }
            
            try {
              const { executeOptimizationTarget } = await import('../optimization/optimizationTargetEngine');
              const result = await executeOptimizationTarget(target.id, {
                dryRun: false,
                specificModules: ['searchterm'],
              });
              await recordModuleExecution(target.id, 'negativeKeyword');
              executedCount++;
              log.debug(`  - ${target.name} [${stage}]: 否定词添加=${result.searchTermAnalysis.negativeKeywordsAdded}, 新关键词=${result.searchTermAnalysis.newKeywordsAdded}`);
            } catch (targetErr: unknown) {
              log.warn(`  - ${target.name} 搜索词否定失败: ${(targetErr as Error).message}`);
            }
          }
          
          log.info(`[OptimizationScheduler] 搜索词否定完成: 执行=${executedCount}, 跳过=${skippedCount}`);
        } catch (searchTermError: unknown) {
          log.warn(`[OptimizationScheduler] 搜索词否定失败:`, (searchTermError as Error).message);
        }
        break;
      }
        
      // ==================== v143: 预算智能分配（生命周期感知）====================
      case 'budget_allocation': {
        log.info(`[OptimizationScheduler] 预算分配触发，开始生命周期感知执行...`);
        try {
          const targets = await getEnabledOptimizationTargets();
          let executedCount = 0;
          let skippedCount = 0;
          
          for (const target of targets) {
            const stage = target.lifecycleStage || 'mature';
            const check = shouldExecuteModuleForTarget(target.id, 'budget', stage);
            
            if (!check.shouldExecute) {
              skippedCount++;
              log.info(`[OptimizationScheduler] 跳过预算分配: ${target.name} (${check.reason})`);
              continue;
            }
            
            try {
              const { executeOptimizationTarget } = await import('../optimization/optimizationTargetEngine');
              const result = await executeOptimizationTarget(target.id, {
                dryRun: false,
                specificModules: ['budget'],
              });
              await recordModuleExecution(target.id, 'budget');
              executedCount++;
              log.debug(`  - ${target.name} [${stage}]: 预算调整=${result.budgetAllocation.adjustmentsCount}`);
            } catch (targetErr: unknown) {
              log.warn(`  - ${target.name} 预算分配失败: ${(targetErr as Error).message}`);
            }
          }
          
          log.info(`[OptimizationScheduler] 预算分配完成: 执行=${executedCount}, 跳过=${skippedCount}`);
          
          // v267 P3-2: 执行边际效益驱动的预算自动执行
          try {
            const { checkAndExecutePendingTasks } = await import('../budget/budgetAutoExecutionService');
            const autoExecResult = await checkAndExecutePendingTasks();
            log.info(`[OptimizationScheduler] v267: 预算自动执行完成: 执行=${autoExecResult.executed}, 失败=${autoExecResult.failed}, 错误数=${autoExecResult.errors.length}`);
          } catch (autoExecErr: unknown) {
            log.warn(`[OptimizationScheduler] v267: 预算自动执行失败:`, (autoExecErr as Error).message);
          }
        } catch (budgetError: unknown) {
          log.warn(`[OptimizationScheduler] 预算分配失败:`, (budgetError as Error).message);
        }
        break;
      }
        
      // ==================== 搜索词收割（周一凌晨5:00）====================
      case 'search_term_harvest': {
        log.info(`[OptimizationScheduler] 执行搜索词收割`);
        try {
          const targets = await getEnabledOptimizationTargets();
          const harvestedAccountIds = new Set<number>();
          
          for (const target of targets) {
            if (harvestedAccountIds.has(target.accountId)) continue;
            harvestedAccountIds.add(target.accountId);
            
            try {
              const harvestResult = await searchTermHarvester.batchHarvestSearchTerms(
                target.accountId,
                { dryRun: false }
              );
              log.info(`[OptimizationScheduler] 账号 ${target.accountId} 搜索词收割完成: ` +
                `候选=${harvestResult.summary.total}, ` +
                `成功=${harvestResult.summary.success}, ` +
                `失败=${harvestResult.summary.failed}, ` +
                `回滚=${harvestResult.summary.rolledBack}`);
            } catch (harvestError: unknown) {
              log.warn(`[OptimizationScheduler] 账号 ${target.accountId} 搜索词收割异常:`, (harvestError as Error).message);
            }
          }
        } catch (harvestError: unknown) {
          log.warn(`[OptimizationScheduler] 搜索词收割异常:`, (harvestError as Error).message);
        }
        break;
      }
        
      // ==================== 绩效周报（周一上午9:00）====================
      case 'weekly_report': {
        log.debug(`[OptimizationScheduler] 生成绩效周报`);
        // TODO: 实现绩效周报生成逻辑
        break;
      }
      
      // ==================== v197: NextGen维护任务 ====================
      case 'nextgen_maintenance': {
        log.info(`[OptimizationScheduler] v197: NextGen维护任务触发...`);
        try {
          const targets = await getEnabledOptimizationTargets();
          for (const target of targets) {
            try {
              const result = await nextGenOrchestrator.executeNextGenMaintenanceTasks(target.accountId);
              log.debug(`  - 账户${target.accountId}: 特征缓存=${result.featuresCached}, Sigmoid拟合=${result.sigmoidFitted.fitted}, Reward回填=${result.rewardsBackfilled}, 因果分析=${result.causalAnalysis.analyzed}`);
            } catch (err: unknown) {
              log.warn(`  - 账户${target.accountId} NextGen维护失败: ${(err as Error).message}`);
            }
          }
          
          // v230: 回填bidPerformanceHistory中的绩效数据
          try {
            const { backfillBidPerformanceResults } = await import('../algorithm/rlDataRecorder');
            const backfillResult = await backfillBidPerformanceResults();
            log.info(`[OptimizationScheduler] v230: bidPerformanceHistory回填完成: updated=${backfillResult.updated}, skipped=${backfillResult.skipped}`);
          } catch (bErr: unknown) {
            log.warn(`[OptimizationScheduler] v230: bidPerformanceHistory回填失败: ${(bErr as Error).message}`);
          }
        } catch (err: unknown) {
          log.warn(`[OptimizationScheduler] v197: NextGen维护失败:`, (err as Error).message);
        }
        break;
      }
      
      // ==================== v197: NextGen模型训练 ====================
      case 'nextgen_model_training': {
        log.info(`[OptimizationScheduler] v197: NextGen模型训练触发...`);
        try {
          const targets = await getEnabledOptimizationTargets();
          for (const target of targets) {
            try {
              await nextGenOrchestrator.executeModelTraining(target.accountId);
              log.info(`  - 账户${target.accountId}: CQL模型训练完成`);
            } catch (err: unknown) {
              log.warn(`  - 账户${target.accountId} CQL训练失败: ${(err as Error).message}`);
            }
          }
        } catch (err: unknown) {
          log.warn(`[OptimizationScheduler] v197: 模型训练失败:`, (err as Error).message);
        }
        break;
      }
      
      // ==================== v197: NextGen预算优化+关键词图谱 ====================
      case 'nextgen_budget_optimization': {
        log.info(`[OptimizationScheduler] v197: NextGen预算优化+关键词图谱触发...`);
        try {
          const targets = await getEnabledOptimizationTargets();
          for (const target of targets) {
            try {
              await nextGenOrchestrator.executeBudgetOptimization(target.accountId);
              log.info(`  - 账户${target.accountId}: 预算组合优化完成`);
            } catch (err: unknown) {
              log.warn(`  - 账户${target.accountId} 预算优化失败: ${(err as Error).message}`);
            }
            try {
              await nextGenOrchestrator.executeKeywordGraphAnalysis(target.accountId);
              log.info(`  - 账户${target.accountId}: 关键词图谱分析完成`);
            } catch (err: unknown) {
              log.warn(`  - 账户${target.accountId} 关键词图谱失败: ${(err as Error).message}`);
            }
          }
        } catch (err: unknown) {
          log.warn(`[OptimizationScheduler] v197: 预算优化失败:`, (err as Error).message);
        }
        break;
      }
    }
    
    log.info(`[OptimizationScheduler] ${config.description} 执行完成`);
    
  } catch (error: unknown) {
    log.warn(`[OptimizationScheduler] ${taskType} 执行失败:`, (error as Error).message);
  } finally {
    // 确保释放执行锁
    releaseLock(taskType);
  }
}

// ==================== v336: 同步健康监控 ====================

// v336: 连续失败计数器
let consecutiveFailures = 0;
const MAX_CONSECUTIVE_FAILURES = 3;

/**
 * v336: 同步健康验证
 * 检查最近的同步是否成功，如果连续失败则记录告警事件
 */
async function verifySyncHealth(): Promise<void> {
  try {
    const database = await db.getDb();
    if (!database) return;
    
    // 检查最近的dataSyncJobs状态
    const recentJobs = await database.execute(sql`
      SELECT accountId as account_id, status, syncType as sync_type, completedAt as completed_at, errorMessage as error_message
      FROM data_sync_jobs 
      WHERE createdAt > DATE_SUB(NOW(), INTERVAL 2 HOUR)
      ORDER BY createdAt DESC
      LIMIT 20
    `);
    
    const jobs = (recentJobs as Record<string, unknown>[])?.[0] || [];
    const successCount = jobs.filter((j: Record<string, unknown>) => j.status === 'completed').length;
    const failCount = jobs.filter((j: Record<string, unknown>) => j.status === 'failed').length;
    
    if (jobs.length === 0) {
      // 最近2小时没有任何同步记录，记录告警
      consecutiveFailures++;
      log.warn(`[DataSyncScheduler] v336: 同步健康告警 - 最近2小时无同步记录 (连续失败: ${consecutiveFailures})`);
    } else if (failCount > 0 && successCount === 0) {
      // 所有同步都失败
      consecutiveFailures++;
      log.warn(`[DataSyncScheduler] v336: 同步健康告警 - 最近${jobs.length}次同步全部失败 (连续失败: ${consecutiveFailures})`);
    } else {
      // 有成功的同步，重置计数器
      consecutiveFailures = 0;
      log.info(`[DataSyncScheduler] v336: 同步健康检查通过 - 成功:${successCount}, 失败:${failCount}`);
    }
    
    // 连续失败超过阈值，记录告警事件
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      const { optimizationEvents } = await import('../../drizzle/schema');
      const { SYSTEM_VERSION } = await import('../utils/systemVersion');
      
      const alertDetail = JSON.stringify({
        type: 'sync_health_alert',
        systemVersion: SYSTEM_VERSION,
        consecutiveFailures,
        recentJobs: jobs.slice(0, 5).map((j: Record<string, unknown>) => ({
          accountId: j.account_id,
          status: j.status,
          syncType: j.sync_type,
          error: j.error_message?.substring(0, 200),
        })),
        alertTime: new Date().toISOString(),
      });
      
      await database.insert(optimizationEvents).values({
        accountId: 0,
        eventCategory: 'settings_change',
        actionType: 'auto_correction',
        actionDetail: alertDetail,
        changeReason: `v${SYSTEM_VERSION} 同步健康告警: 连续${consecutiveFailures}次同步失败`,
        algorithmVersion: `v${SYSTEM_VERSION}`,
        status: 'failed',
        apiSyncStatus: 'not_applicable',
      });
      
      log.warn(`[DataSyncScheduler] v336: ❗ 同步健康严重告警 - 连续${consecutiveFailures}次同步失败，已记录告警事件`);
      
      // 重置计数器避免重复告警
      consecutiveFailures = 0;
    }
  } catch (err: unknown) {
    log.warn(`[DataSyncScheduler] v336: 同步健康检查异常: ${(err as Error).message}`);
  }
}

/**
 * v336: 事件驱动同步触发
 * 当新账户创建、凭证保存、重新授权等事件发生时，立即触发完整同步
 * 而不是等待定时器触发（最长15分钟）
 * 
 * @param accountId 触发同步的账户ID
 * @param reason 触发原因
 */
export async function triggerImmediateSync(accountId: number, reason: string): Promise<void> {
  log.info(`[DataSyncScheduler] v336: 事件驱动同步触发 - 账户${accountId}, 原因: ${reason}`);
  logSync('DataSyncScheduler', `v336: 事件驱动同步`, { accountId, reason });
  
  try {
    // 延迟5秒后执行，给数据库事务时间提交
    setTimeout(async () => {
      try {
        const { syncAllAccounts } = await import('./unifiedSyncEngine');
        const result = await syncAllAccounts('full');
        log.info(`[DataSyncScheduler] v336: 事件驱动同步完成 - 账户${accountId}, 原因: ${reason}, 成功: ${result.successfulAccounts}/${result.totalAccounts}`);
        
        // 同步完成后验证健康
        await verifySyncHealth();
      } catch (syncErr: unknown) {
        log.warn(`[DataSyncScheduler] v336: 事件驱动同步失败 - 账户${accountId}: ${(syncErr as Error).message}`);
        logSyncError('DataSyncScheduler', `v336: 事件驱动同步失败`, { accountId, reason, error: (syncErr as Error).message });
      }
    }, 5 * 1000);
  } catch (err: unknown) {
    log.warn(`[DataSyncScheduler] v336: 事件驱动同步触发异常: ${(err as Error).message}`);
  }
}

/**
 * v336: 获取同步健康状态（供心跳和监控使用）
 */
export function getSyncHealthStatus(): { consecutiveFailures: number; lastSyncTime: Date | null; isRunning: boolean } {
  return {
    consecutiveFailures,
    lastSyncTime: schedulerStatus.lastRunTime,
    isRunning: schedulerStatus.isRunning,
  };
}

/** v360+v424: 检查主同步是否正在进行，供自愈调度器协调使用
 * v424: 同时检查dataSyncScheduler和unifiedSyncEngine两个层面的同步状态
 */
export function isSyncRunning(): boolean {
  // 检查dataSyncScheduler层面
  if (schedulerStatus.isRunning || Object.values(executionLocks).some(v => v)) {
    return true;
  }
  // v424: 检查unifiedSyncEngine层面
  try {
    // 使用require避免循环依赖问题
    const { getEngineStatus } = require('./unifiedSyncEngine');
    const engineStatus = getEngineStatus();
    if (engineStatus.currentlyRunning && engineStatus.currentlyRunning.length > 0) {
      return true;
    }
  } catch {
    // unifiedSyncEngine不可用时不影响
  }
  return false;
}

// 导出同步层级配置和优化调度配置供外部使用
export { SYNC_TIER_CONFIG, frequencyToMs, OPTIMIZATION_SCHEDULE };
