/**
 * v358: Shard管理服务 - 持久化任务状态机的核心
 * 
 * 职责:
 * 1. 创建和管理sync_tasks_v2记录
 * 2. 为每个account+step组合生成shard
 * 3. 追踪shard执行状态
 * 4. 支持断点续传（从失败的shard恢复）
 * 5. 提供任务进度查询
 */
import { eq, and, sql, inArray, lte, isNull } from 'drizzle-orm';
import { getDb } from '../../db';
import { syncTasksV2, syncShards, syncLocks } from '../../../drizzle/schema';
import { createModuleLogger } from '../../utils/logger';
import { randomUUID } from 'crypto';

const log = createModuleLogger('shardManager');

// ==================== 类型定义 ====================

export type SyncTier = 'high' | 'medium' | 'full' | 'confirmation';
export type TaskStatus = 'pending' | 'running' | 'partial_success' | 'completed' | 'failed' | 'cancelled';
export type ShardStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface ShardDefinition {
  accountId: number;
  stepId: string;
  stepName: string;
  tier: 'high' | 'medium' | 'full';
}

export interface TaskProgress {
  taskId: string;
  tier: SyncTier;
  status: TaskStatus;
  totalShards: number;
  completedShards: number;
  failedShards: number;
  totalRecordsSynced: number;
  progressPercent: number;
  startedAt: string | null;
  elapsedMs: number | null;
}

export interface ShardResult {
  shardId: string;
  status: ShardStatus;
  recordsSynced: number;
  errorMessage?: string;
  errorCode?: string;
  durationMs: number;
}

// ==================== 任务管理 ====================

/**
 * 创建一个新的同步任务
 */
export async function createSyncTask(
  tier: SyncTier,
  shardDefs: ShardDefinition[],
  triggerSource: string = 'scheduler'
): Promise<string | null> {
  const db = await getDb();
  if (!db) {
    log.warn('[v358] 无法创建同步任务: 数据库不可用');
    return null;
  }

  const taskId = randomUUID();
  
  try {
    // 创建任务主记录
    await db.insert(syncTasksV2).values({
      taskId,
      tier,
      status: 'pending',
      totalShards: shardDefs.length,
      completedShards: 0,
      failedShards: 0,
      totalRecordsSynced: 0,
      triggerSource,
    });

    // 批量创建shard记录
    if (shardDefs.length > 0) {
      const shardValues = shardDefs.map(def => ({
        taskId,
        shardId: `${taskId}:${def.accountId}:${def.stepId}`,
        accountId: def.accountId,
        stepId: def.stepId,
        stepName: def.stepName,
        tier: def.tier,
        status: 'pending' as const,
        recordsSynced: 0,
        retryCount: 0,
        maxRetries: 3,
      }));

      // 分批插入，每批100条
      const BATCH_SIZE = 100;
      for (let i = 0; i < shardValues.length; i += BATCH_SIZE) {
        const batch = shardValues.slice(i, i + BATCH_SIZE);
        await db.insert(syncShards).values(batch);
      }
    }

    log.info(`[v358] 同步任务创建成功: taskId=${taskId}, tier=${tier}, shards=${shardDefs.length}, trigger=${triggerSource}`);
    return taskId;
  } catch (error: unknown) {
    log.warn(`[v358] 创建同步任务失败: ${(error as Error).message}`);
    return null;
  }
}

/**
 * 启动任务（更新状态为running）
 */
export async function startTask(taskId: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  try {
    await db.update(syncTasksV2)
      .set({ 
        status: 'running',
        startedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      })
      .where(eq(syncTasksV2.taskId, taskId));
    return true;
  } catch (error: unknown) {
    log.warn(`[v358] 启动任务失败: ${(error as Error).message}`);
    return false;
  }
}

/**
 * 获取下一个待执行的shard
 */
export async function getNextPendingShard(taskId: string): Promise<{
  shardId: string;
  accountId: number;
  stepId: string;
  stepName: string;
  retryCount: number;
} | null> {
  const db = await getDb();
  if (!db) return null;

  try {
    const [shard] = await db.select()
      .from(syncShards)
      .where(and(
        eq(syncShards.taskId, taskId),
        eq(syncShards.status, 'pending')
      ))
      .limit(1);

    if (!shard) return null;

    return {
      shardId: shard.shardId,
      accountId: shard.accountId,
      stepId: shard.stepId,
      stepName: shard.stepName,
      retryCount: shard.retryCount,
    };
  } catch (error: unknown) {
    log.warn(`[v358] 获取待执行shard失败: ${(error as Error).message}`);
    return null;
  }
}

/**
 * 获取所有待执行的shards（按account分组）
 */
export async function getPendingShards(taskId: string): Promise<Array<{
  shardId: string;
  accountId: number;
  stepId: string;
  stepName: string;
  retryCount: number;
}>> {
  const db = await getDb();
  if (!db) return [];

  try {
    const shards = await db.select()
      .from(syncShards)
      .where(and(
        eq(syncShards.taskId, taskId),
        eq(syncShards.status, 'pending')
      ));

    return shards.map(s => ({
      shardId: s.shardId,
      accountId: s.accountId,
      stepId: s.stepId,
      stepName: s.stepName,
      retryCount: s.retryCount,
    }));
  } catch (error: unknown) {
    log.warn(`[v358] 获取待执行shards失败: ${(error as Error).message}`);
    return [];
  }
}

/**
 * 标记shard开始执行
 */
export async function markShardRunning(shardId: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  try {
    await db.update(syncShards)
      .set({
        status: 'running',
        startedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      })
      .where(eq(syncShards.shardId, shardId));
    return true;
  } catch (error: unknown) {
    log.warn(`[v358] 标记shard运行失败: ${(error as Error).message}`);
    return false;
  }
}

/**
 * 标记shard执行完成
 */
export async function markShardCompleted(shardId: string, result: ShardResult): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  try {
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    
    await db.update(syncShards)
      .set({
        status: result.status,
        recordsSynced: result.recordsSynced,
        errorMessage: result.errorMessage || null,
        errorCode: result.errorCode || null,
        durationMs: result.durationMs,
        completedAt: now,
      })
      .where(eq(syncShards.shardId, shardId));

    // 更新任务主记录的进度
    const taskId = shardId.split(':')[0];
    await updateTaskProgress(taskId);

    return true;
  } catch (error: unknown) {
    log.warn(`[v358] 标记shard完成失败: ${(error as Error).message}`);
    return false;
  }
}

/**
 * 标记shard失败并安排重试
 */
export async function markShardFailed(
  shardId: string,
  errorMessage: string,
  errorCode: string = 'UNKNOWN'
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  try {
    // 获取当前shard信息
    const [shard] = await db.select()
      .from(syncShards)
      .where(eq(syncShards.shardId, shardId))
      .limit(1);

    if (!shard) return false;

    const newRetryCount = shard.retryCount + 1;
    const canRetry = newRetryCount <= shard.maxRetries;

    if (canRetry) {
      // 指数退避: 30s, 60s, 120s
      const backoffMs = 30000 * Math.pow(2, shard.retryCount);
      const nextRetryAt = new Date(Date.now() + backoffMs);

      await db.update(syncShards)
        .set({
          status: 'pending', // 重新设为pending等待重试
          retryCount: newRetryCount,
          errorMessage,
          errorCode,
          nextRetryAt: nextRetryAt.toISOString().slice(0, 19).replace('T', ' '),
        })
        .where(eq(syncShards.shardId, shardId));

      log.warn(`[v358] Shard ${shardId} 失败(${errorCode}), 将在${backoffMs/1000}s后重试 (${newRetryCount}/${shard.maxRetries})`);
    } else {
      // 超过最大重试次数，标记为最终失败
      await db.update(syncShards)
        .set({
          status: 'failed',
          retryCount: newRetryCount,
          errorMessage,
          errorCode,
          completedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
        })
        .where(eq(syncShards.shardId, shardId));

      log.warn(`[v358] Shard ${shardId} 最终失败(${errorCode}), 已达最大重试次数(${shard.maxRetries})`);
    }

    // 更新任务主记录
    const taskId = shardId.split(':')[0];
    await updateTaskProgress(taskId);

    return true;
  } catch (error: unknown) {
    log.warn(`[v358] 标记shard失败异常: ${(error as Error).message}`);
    return false;
  }
}

/**
 * 更新任务主记录的进度
 */
async function updateTaskProgress(taskId: string): Promise<void> {
  const db = await getDb();
  if (!db) return;

  try {
    // 统计各状态的shard数量
    const stats = await db.execute(sql`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN status = 'pending' OR status = 'running' THEN 1 ELSE 0 END) as in_progress,
        SUM(records_synced) as total_synced
      FROM sync_shards 
      WHERE task_id = ${taskId}
    `);

    const row = (stats as Record<string, unknown>[])?.[0]?.[0] || (stats as Record<string, unknown>[])?.[0];
    if (!row) return;

    const total = Number(row.total) || 0;
    const completed = Number(row.completed) || 0;
    const failed = Number(row.failed) || 0;
    const inProgress = Number(row.in_progress) || 0;
    const totalSynced = Number(row.total_synced) || 0;

    // 判断任务整体状态
    let taskStatus: TaskStatus;
    if (inProgress > 0) {
      taskStatus = 'running';
    } else if (failed > 0 && completed > 0) {
      taskStatus = 'partial_success';
    } else if (failed > 0 && completed === 0) {
      taskStatus = 'failed';
    } else {
      taskStatus = 'completed';
    }

    const updates: Record<string, unknown> = {
      completedShards: completed,
      failedShards: failed,
      totalRecordsSynced: totalSynced,
      status: taskStatus,
    };

    // 如果任务完成（无论成功还是失败），设置完成时间
    if (inProgress === 0) {
      updates.completedAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
      
      if (failed > 0) {
        updates.errorSummary = `${failed}/${total}个分片失败`;
      }
    }

    await db.update(syncTasksV2)
      .set(updates)
      .where(eq(syncTasksV2.taskId, taskId));
  } catch (error: unknown) {
    log.warn(`[v358] 更新任务进度失败: ${(error as Error).message}`);
  }
}

/**
 * 获取任务进度
 */
export async function getTaskProgress(taskId: string): Promise<TaskProgress | null> {
  const db = await getDb();
  if (!db) return null;

  try {
    const [task] = await db.select()
      .from(syncTasksV2)
      .where(eq(syncTasksV2.taskId, taskId))
      .limit(1);

    if (!task) return null;

    const total = task.totalShards || 1;
    const completed = task.completedShards || 0;
    const progressPercent = Math.round((completed / total) * 100);

    let elapsedMs: number | null = null;
    if (task.startedAt) {
      const start = new Date(task.startedAt).getTime();
      const end = task.completedAt ? new Date(task.completedAt).getTime() : Date.now();
      elapsedMs = end - start;
    }

    return {
      taskId: task.taskId,
      tier: task.tier as SyncTier,
      status: task.status as TaskStatus,
      totalShards: task.totalShards,
      completedShards: task.completedShards,
      failedShards: task.failedShards,
      totalRecordsSynced: task.totalRecordsSynced,
      progressPercent,
      startedAt: task.startedAt,
      elapsedMs,
    };
  } catch (error: unknown) {
    log.warn(`[v358] 获取任务进度失败: ${(error as Error).message}`);
    return null;
  }
}

/**
 * 获取可重试的失败shards
 */
export async function getRetryableShards(): Promise<Array<{
  shardId: string;
  taskId: string;
  accountId: number;
  stepId: string;
  retryCount: number;
}>> {
  const db = await getDb();
  if (!db) return [];

  try {
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const shards = await db.select()
      .from(syncShards)
      .where(and(
        eq(syncShards.status, 'pending'),
        lte(syncShards.nextRetryAt, now)
      ));

    return shards.map(s => ({
      shardId: s.shardId,
      taskId: s.taskId,
      accountId: s.accountId,
      stepId: s.stepId,
      retryCount: s.retryCount,
    }));
  } catch (error: unknown) {
    log.warn(`[v358] 获取可重试shards失败: ${(error as Error).message}`);
    return [];
  }
}

// ==================== 分布式锁 ====================

/**
 * 尝试获取分布式锁
 * @param lockKey 锁标识
 * @param holderId 持有者ID
 * @param ttlMs 锁的TTL（毫秒）
 */
export async function acquireLock(
  lockKey: string,
  holderId: string,
  ttlMs: number = 300000 // 默认5分钟
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  try {
    const expiresAt = new Date(Date.now() + ttlMs);
    const expiresAtStr = expiresAt.toISOString().slice(0, 19).replace('T', ' ');
    const nowStr = new Date().toISOString().slice(0, 19).replace('T', ' ');

    // 先清理过期的锁
    await db.delete(syncLocks)
      .where(lte(syncLocks.expiresAt, nowStr));

    // 尝试插入锁记录（利用UNIQUE约束实现原子性）
    await db.insert(syncLocks).values({
      lockKey,
      holderId,
      expiresAt: expiresAtStr,
    });

    log.debug(`[v358] 获取锁成功: ${lockKey} by ${holderId}`);
    return true;
  } catch (error: unknown) {
    // UNIQUE约束冲突说明锁已被持有
    // @ts-expect-error - MySQL error code check
    if (error.code === 'ER_DUP_ENTRY' || (error as Error).message?.includes('Duplicate')) {
      log.debug(`[v358] 锁已被占用: ${lockKey}`);
      return false;
    }
    log.warn(`[v358] 获取锁异常: ${(error as Error).message}`);
    return false;
  }
}

/**
 * 释放分布式锁
 */
export async function releaseLock(lockKey: string, holderId: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  try {
    await db.delete(syncLocks)
      .where(and(
        eq(syncLocks.lockKey, lockKey),
        eq(syncLocks.holderId, holderId)
      ));
    log.debug(`[v358] 释放锁成功: ${lockKey}`);
    return true;
  } catch (error: unknown) {
    log.warn(`[v358] 释放锁失败: ${(error as Error).message}`);
    return false;
  }
}

/**
 * 续期锁
 */
export async function renewLock(
  lockKey: string,
  holderId: string,
  ttlMs: number = 300000
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  try {
    const expiresAt = new Date(Date.now() + ttlMs);
    const expiresAtStr = expiresAt.toISOString().slice(0, 19).replace('T', ' ');

    const result = await db.update(syncLocks)
      .set({ expiresAt: expiresAtStr })
      .where(and(
        eq(syncLocks.lockKey, lockKey),
        eq(syncLocks.holderId, holderId)
      ));

    return true;
  } catch (error: unknown) {
    log.warn(`[v358] 续期锁失败: ${(error as Error).message}`);
    return false;
  }
}
