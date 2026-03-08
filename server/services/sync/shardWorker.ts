/**
 * v358: Shard Worker - 负责执行和监控分片同步任务
 * 
 * 职责:
 * 1. 提供与dataSyncScheduler集成的接口
 * 2. 管理shard执行的生命周期
 * 3. 定期重试失败的shards
 * 4. 提供任务进度API
 * 5. 清理过期的锁和历史任务记录
 */
import { createModuleLogger } from '../../utils/logger';
import { shardBasedSyncAll, retryFailedShards } from './shardSyncOrchestrator';
import { getTaskProgress, type SyncTier, type TaskProgress } from './shardManager';
import { logSync, logSyncError } from '../../utils/opsLogger';

const log = createModuleLogger('shardWorker');

// Worker状态
interface WorkerStatus {
  isRunning: boolean;
  retryTimerId: ReturnType<typeof setInterval> | null;
  cleanupTimerId: ReturnType<typeof setInterval> | null;
  lastTaskId: string | null;
  lastTaskProgress: TaskProgress | null;
  totalTasksExecuted: number;
  totalShardsRetried: number;
  startedAt: string | null;
}

const workerStatus: WorkerStatus = {
  isRunning: false,
  retryTimerId: null,
  cleanupTimerId: null,
  lastTaskId: null,
  lastTaskProgress: null,
  totalTasksExecuted: 0,
  totalShardsRetried: 0,
  startedAt: null,
};

// ==================== 调度器集成接口 ====================

/**
 * v358: 供dataSyncScheduler调用的分层同步入口
 * 替代原有的直接调用syncAllAccounts
 * 
 * 用法（在dataSyncScheduler.ts中）:
 * ```
 * // 旧代码:
 * const { syncAllAccounts } = await import('./unifiedSyncEngine');
 * const batchResult = await syncAllAccounts(tier as any);
 * 
 * // 新代码:
 * const { executeShardSync } = await import('./services/sync/shardWorker');
 * const shardResult = await executeShardSync(tier, 'scheduler');
 * ```
 */
export async function executeShardSync(
  tier: SyncTier,
  triggerSource: string = 'scheduler'
): Promise<{
  taskId: string | null;
  success: boolean;
  totalShards: number;
  completedShards: number;
  failedShards: number;
  totalRecordsSynced: number;
  durationMs: number;
}> {
  const startTime = Date.now();
  
  log.info(`[v358] ShardWorker: 开始执行${tier}层分片同步, 触发源=${triggerSource}`);
  logSync('ShardWorker', `开始${tier}层分片同步`, { tier, triggerSource });

  try {
    const result = await shardBasedSyncAll(tier, triggerSource);
    const durationMs = Date.now() - startTime;

    workerStatus.lastTaskId = result.taskId;
    workerStatus.totalTasksExecuted++;

    // 获取最终进度
    if (result.taskId) {
      workerStatus.lastTaskProgress = await getTaskProgress(result.taskId);
    }

    const success = result.failedShards === 0 && result.completedShards > 0;

    log.info(`[v358] ShardWorker: ${tier}层分片同步完成: ` +
      `taskId=${result.taskId}, 完成=${result.completedShards}/${result.totalShards}, ` +
      `失败=${result.failedShards}, 记录=${result.totalRecordsSynced}, 耗时=${durationMs}ms`);

    logSync('ShardWorker', `${tier}层分片同步完成`, {
      taskId: result.taskId,
      tier,
      totalShards: result.totalShards,
      completedShards: result.completedShards,
      failedShards: result.failedShards,
      totalRecordsSynced: result.totalRecordsSynced,
      durationMs,
      success,
    });

    return {
      taskId: result.taskId,
      success,
      totalShards: result.totalShards,
      completedShards: result.completedShards,
      failedShards: result.failedShards,
      totalRecordsSynced: result.totalRecordsSynced,
      durationMs,
    };
  } catch (error: unknown) {
    const durationMs = Date.now() - startTime;
    log.error(`[v358] ShardWorker: ${tier}层分片同步异常: ${(error as Error).message}`);
    logSyncError('ShardWorker', `${tier}层分片同步异常`, { tier, error: (error as Error).message, durationMs });

    return {
      taskId: null,
      success: false,
      totalShards: 0,
      completedShards: 0,
      failedShards: 0,
      totalRecordsSynced: 0,
      durationMs,
    };
  }
}

// ==================== Worker生命周期管理 ====================

/**
 * 启动Worker
 * - 启动失败分片重试定时器（每5分钟检查一次）
 * - 启动过期锁清理定时器（每10分钟清理一次）
 */
export function startShardWorker(): void {
  if (workerStatus.isRunning) {
    log.warn('[v358] ShardWorker已在运行中');
    return;
  }

  workerStatus.isRunning = true;
  workerStatus.startedAt = new Date().toISOString();

  // 失败分片重试定时器（每5分钟）
  workerStatus.retryTimerId = setInterval(async () => {
    try {
      const result = await retryFailedShards();
      if (result.retried > 0) {
        workerStatus.totalShardsRetried += result.retried;
        log.info(`[v358] ShardWorker: 自动重试完成 - 重试=${result.retried}, 成功=${result.succeeded}, 失败=${result.failed}`);
      }
    } catch (error: unknown) {
      log.error(`[v358] ShardWorker: 自动重试异常: ${(error as Error).message}`);
    }
  }, 5 * 60 * 1000); // 5分钟

  // 过期锁清理定时器（每10分钟）
  workerStatus.cleanupTimerId = setInterval(async () => {
    try {
      await cleanupExpiredLocks();
      await cleanupOldTasks();
    } catch (error: unknown) {
      log.error(`[v358] ShardWorker: 清理任务异常: ${(error as Error).message}`);
    }
  }, 10 * 60 * 1000); // 10分钟

  log.info('[v358] ShardWorker已启动: 重试定时器(5min) + 清理定时器(10min)');
  logSync('ShardWorker', 'Worker已启动', { retryInterval: '5min', cleanupInterval: '10min' });
}

/**
 * 停止Worker
 */
export function stopShardWorker(): void {
  if (workerStatus.retryTimerId) {
    clearInterval(workerStatus.retryTimerId);
    workerStatus.retryTimerId = null;
  }
  if (workerStatus.cleanupTimerId) {
    clearInterval(workerStatus.cleanupTimerId);
    workerStatus.cleanupTimerId = null;
  }
  workerStatus.isRunning = false;
  log.info('[v358] ShardWorker已停止');
}

// ==================== 清理任务 ====================

/**
 * 清理过期的分布式锁
 */
async function cleanupExpiredLocks(): Promise<void> {
  try {
    const { getDb } = await import('../../db');
    const { syncLocks } = await import('../../../drizzle/schema');
    const { lte } = await import('drizzle-orm');
    
    const database = await getDb();
    if (!database) return;

    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    await database.delete(syncLocks).where(lte(syncLocks.expiresAt, now));
  } catch (error: unknown) {
    log.error(`[v358] 清理过期锁失败: ${(error as Error).message}`);
  }
}

/**
 * 清理7天前的历史任务记录
 */
async function cleanupOldTasks(): Promise<void> {
  try {
    const { getDb } = await import('../../db');
    const { sql } = await import('drizzle-orm');
    
    const database = await getDb();
    if (!database) return;

    // 删除7天前的已完成任务的分片记录
    await database.execute(sql`
      DELETE ss FROM sync_shards ss
      INNER JOIN sync_tasks_v2 st ON ss.task_id = st.task_id
      WHERE st.status IN ('completed', 'failed', 'partial_success')
      AND st.created_at < DATE_SUB(NOW(), INTERVAL 7 DAY)
    `);

    // 删除7天前的已完成任务记录
    await database.execute(sql`
      DELETE FROM sync_tasks_v2
      WHERE status IN ('completed', 'failed', 'partial_success')
      AND created_at < DATE_SUB(NOW(), INTERVAL 7 DAY)
    `);

    log.debug('[v358] 历史任务清理完成');
  } catch (error: unknown) {
    log.error(`[v358] 清理历史任务失败: ${(error as Error).message}`);
  }
}

// ==================== 状态查询 ====================

/**
 * 获取Worker状态
 */
export function getWorkerStatus(): WorkerStatus & { uptime: string } {
  const uptimeMs = workerStatus.startedAt 
    ? Date.now() - new Date(workerStatus.startedAt).getTime() 
    : 0;
  const uptimeHours = Math.round(uptimeMs / 3600000 * 10) / 10;

  return {
    ...workerStatus,
    uptime: `${uptimeHours}h`,
  };
}

/**
 * 获取最近任务的进度
 */
export async function getLastTaskProgress(): Promise<TaskProgress | null> {
  if (!workerStatus.lastTaskId) return null;
  return getTaskProgress(workerStatus.lastTaskId);
}
