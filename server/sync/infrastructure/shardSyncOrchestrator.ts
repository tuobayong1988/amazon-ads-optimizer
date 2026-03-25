/**
 * v358: Shard同步编排器 - 重构syncAll为基于Shard的模式
 * 
 * 设计理念:
 * 1. syncAllAccounts创建任务 → 生成shards → 逐个执行shard
 * 2. 每个shard的执行结果持久化到数据库
 * 3. 失败的shard自动安排重试（指数退避）
 * 4. 支持断点续传：从上次失败的shard继续
 * 
 * 与现有架构的兼容:
 * - 保持syncAllAccounts的接口不变
 * - 内部使用shardManager管理状态
 * - 分布式锁替代内存锁
 * 
 * v519: 修复锁TTL动态超时问题
 * - 账户级锁TTL从硬编码45分钟改为动态计算（与unifiedSyncEngine V518一致）
 * - 每个shard执行后同时续期账户级锁和全局锁
 * - 根据账户广告活动数量动态调整锁TTL
 */
import { createModuleLogger } from '../../utils/logger';
import {
  createSyncTask,
  startTask,
  getPendingShards,
  markShardRunning,
  markShardCompleted,
  markShardFailed,
  getTaskProgress,
  acquireLock,
  releaseLock,
  renewLock,
  type SyncTier,
  type ShardDefinition,
  type ShardResult,
} from './shardManager';
import { discoverSyncableAccounts, getStepsForTier, syncAccount } from '../unifiedSyncEngine';
import { randomUUID } from 'crypto';
import { getDb } from '../../db';
import { campaigns as campaignsTable } from '../../../drizzle/schema';
import { eq, sql } from 'drizzle-orm';

const log = createModuleLogger('shardSyncOrchestrator');

// 进程实例ID（用于分布式锁）
const INSTANCE_ID = `worker-${randomUUID().slice(0, 8)}`;

// v519: 动态超时常量 — 与unifiedSyncEngine V518保持一致
const DEFAULT_ACCOUNT_LOCK_TTL_MS = 45 * 60 * 1000;  // 默认45分钟
const GLOBAL_LOCK_TTL_MS = 60 * 60 * 1000;            // 全局锁1小时
const NIGHTLY_LOCK_TTL_MS = 4 * 60 * 60 * 1000;       // nightly层级4小时
const LARGE_ACCOUNT_THRESHOLD = 1000;
const LARGE_ACCOUNT_TIMEOUT_TIERS = [
  { threshold: 5000, timeoutMs: 90 * 60 * 1000 },  // 5000+广告活动: 90分钟
  { threshold: 3000, timeoutMs: 75 * 60 * 1000 },  // 3000-5000: 75分钟
  { threshold: 1000, timeoutMs: 60 * 60 * 1000 },  // 1000-3000: 60分钟
];

/**
 * v519: 根据账户广告活动数量计算动态锁TTL
 */
async function getDynamicLockTtl(accountId: number, tier: SyncTier): Promise<number> {
  if (tier === 'nightly') return NIGHTLY_LOCK_TTL_MS;

  try {
    const db = await getDb();
    if (!db) return DEFAULT_ACCOUNT_LOCK_TTL_MS;

    const countResult = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(campaignsTable)
      .where(eq(campaignsTable.accountId, accountId));
    const campaignCount = countResult[0]?.count || 0;

    if (campaignCount >= LARGE_ACCOUNT_THRESHOLD) {
      for (const t of LARGE_ACCOUNT_TIMEOUT_TIERS) {
        if (campaignCount >= t.threshold) {
          log.info(`[v519] 账户${accountId}拥有${campaignCount}个广告活动，动态锁TTL=${Math.round(t.timeoutMs / 60000)}分钟`);
          return t.timeoutMs;
        }
      }
    }
  } catch (e: unknown) {
    log.debug(`[v519] 查询账户${accountId}广告活动数失败: ${(e as Error).message}`);
  }

  return DEFAULT_ACCOUNT_LOCK_TTL_MS;
}

/**
 * v358: 基于Shard的syncAllAccounts
 * 
 * 流程:
 * 1. 发现所有可同步账户
 * 2. 为每个account+step组合生成shard定义
 * 3. 创建持久化任务记录
 * 4. 逐个执行shard（带分布式锁保护）
 * 5. 失败shard自动安排重试
 */
export async function shardBasedSyncAll(
  tier: SyncTier,
  triggerSource: string = 'scheduler'
): Promise<{
  taskId: string | null;
  totalShards: number;
  completedShards: number;
  failedShards: number;
  totalRecordsSynced: number;
}> {
  const result = {
    taskId: null as string | null,
    totalShards: 0,
    completedShards: 0,
    failedShards: 0,
    totalRecordsSynced: 0,
  };

  // Step 1: 获取全局锁（防止同一层级的多个实例同时执行）
  const globalLockKey = `sync:global:${tier}`;
  const globalLockTtl = tier === 'nightly' ? NIGHTLY_LOCK_TTL_MS : GLOBAL_LOCK_TTL_MS;
  const lockAcquired = await acquireLock(globalLockKey, INSTANCE_ID, globalLockTtl);
  if (!lockAcquired) {
    log.info(`[v358] ${tier}层同步已有其他实例在执行，跳过`);
    return result;
  }

  try {
    // Step 2: 发现所有可同步账户
    const accounts = await discoverSyncableAccounts();
    if (accounts.length === 0) {
      log.info('[v358] 没有发现可同步的账户');
      return result;
    }

    // Step 3: 生成shard定义
    const steps = getStepsForTier(tier);
    const shardDefs: ShardDefinition[] = [];

    for (const account of (accounts as unknown[])) {
      for (const step of steps) {
        shardDefs.push({
          // @ts-ignore
          accountId: account.accountId,
          stepId: step.id,
          stepName: step.name,
          // @ts-expect-error - runtime type mismatch
          tier: step.tier,
        });
      }
    }

    result.totalShards = shardDefs.length;
    log.info(`[v358] ${tier}层同步: ${accounts.length}个账户 × ${steps.length}个步骤 = ${shardDefs.length}个分片`);

    // Step 4: 创建持久化任务
    const taskId = await createSyncTask(tier, shardDefs, triggerSource);
    if (!taskId) {
      log.warn('[v358] 创建同步任务失败');
      return result;
    }
    result.taskId = taskId;

    // Step 5: 启动任务
    await startTask(taskId);

    // Step 6: 执行所有shards
    const pendingShards = await getPendingShards(taskId);
    
    // 按账户分组执行（保持与原有逻辑一致的串行执行模式）
    const accountGroups = new Map<number, typeof pendingShards>();
    for (const shard of pendingShards) {
      if (!accountGroups.has(shard.accountId)) {
        accountGroups.set(shard.accountId, []);
      }
      accountGroups.get(shard.accountId)!.push(shard);
    }

    for (const [accountId, accountShards] of accountGroups) {
      // v519: 获取账户级锁 — 使用动态TTL替代硬编码45分钟
      const accountLockKey = `sync:account:${accountId}:${tier}`;
      const accountLockTtl = await getDynamicLockTtl(accountId, tier);
      const accountLockAcquired = await acquireLock(accountLockKey, INSTANCE_ID, accountLockTtl);
      
      if (!accountLockAcquired) {
        log.warn(`[v358] 账户${accountId}的${tier}层同步被锁定，跳过该账户的所有分片`);
        for (const shard of accountShards) {
          await markShardFailed(shard.shardId, `账户锁定: 另一个同步进程正在处理`, 'ACCOUNT_LOCKED');
        }
        continue;
      }

      try {
        // 逐个执行该账户的shards
        for (const shard of accountShards) {
          const shardStartTime = Date.now();
          
          await markShardRunning(shard.shardId);
          
          try {
            // 找到对应的账户信息
            const account = accounts.find(a => a.accountId === accountId);
            if (!account) {
              await markShardFailed(shard.shardId, '账户信息不存在', 'ACCOUNT_NOT_FOUND');
              result.failedShards++;
              continue;
            }

            // 执行单个步骤的同步
            const accountResult = await syncAccount(account, tier, {
              specificSteps: [shard.stepId],
            });

            const stepResult = accountResult.stepResults[shard.stepId];
            const durationMs = Date.now() - shardStartTime;

            if (stepResult?.success) {
              await markShardCompleted(shard.shardId, {
                shardId: shard.shardId,
                status: 'completed',
                recordsSynced: stepResult.synced || 0,
                durationMs,
              });
              result.completedShards++;
              result.totalRecordsSynced += stepResult.synced || 0;
            } else {
              const errorMsg = stepResult?.errors?.join('; ') || accountResult.errors.join('; ') || '未知错误';
              await markShardFailed(shard.shardId, errorMsg, 'STEP_FAILED');
              result.failedShards++;
            }

          } catch (error: unknown) {
            const durationMs = Date.now() - shardStartTime;
            log.warn(`[v358] Shard ${shard.shardId} 执行异常: ${(error as Error).message}`);
            
            // 根据错误类型分类
            let errorCode = 'UNKNOWN';
            if ((error as Error).message?.includes('DATABASE_UNAVAILABLE')) {
              errorCode = 'DATABASE_UNAVAILABLE';
            } else if ((error as Error).message?.includes('PARTIAL_SYNC_FAILURE')) {
              errorCode = 'PARTIAL_SYNC_FAILURE';
            } else if ((error as Error).message?.includes('timeout') || (error as Error).message?.includes('TIMEOUT')) {
              errorCode = 'API_TIMEOUT';
            } else if ((error as Error).message?.includes('429') || (error as Error).message?.includes('throttl')) {
              errorCode = 'API_THROTTLE';
            }
            
            await markShardFailed(shard.shardId, (error as Error).message, errorCode);
            result.failedShards++;
          }

          // 步骤间延迟
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          // v519: 定期续期全局锁和账户级锁（使用动态TTL）
          await renewLock(globalLockKey, INSTANCE_ID, globalLockTtl);
          await renewLock(accountLockKey, INSTANCE_ID, accountLockTtl);
        }
      } finally {
        // 释放账户级锁
        await releaseLock(accountLockKey, INSTANCE_ID);
      }

      // 账户间延迟
      await new Promise(resolve => setTimeout(resolve, 5000));
    }

    // 获取最终进度
    const progress = await getTaskProgress(taskId);
    if (progress) {
      result.completedShards = progress.completedShards;
      result.failedShards = progress.failedShards;
      result.totalRecordsSynced = progress.totalRecordsSynced;
    }

    log.info(`[v358] ${tier}层同步完成: taskId=${taskId}, 完成=${result.completedShards}, 失败=${result.failedShards}, 总记录=${result.totalRecordsSynced}`);

  } finally {
    // 释放全局锁
    await releaseLock(globalLockKey, INSTANCE_ID);
  }

  return result;
}

/**
 * v358: 重试失败的shards
 * 由定时器定期调用，处理之前失败但可重试的分片
 */
export async function retryFailedShards(): Promise<{
  retried: number;
  succeeded: number;
  failed: number;
}> {
  const { getRetryableShards } = await import('./shardManager');
  const retryableShards = await getRetryableShards();

  const result = { retried: 0, succeeded: 0, failed: 0 };

  if (retryableShards.length === 0) {
    return result;
  }

  log.info(`[v358] 发现${retryableShards.length}个可重试的分片`);

  for (const shard of retryableShards) {
    result.retried++;
    
    try {
      await markShardRunning(shard.shardId);
      
      // 发现账户信息
      const accounts = await discoverSyncableAccounts();
      const account = accounts.find(a => a.accountId === shard.accountId);
      
      if (!account) {
        await markShardFailed(shard.shardId, '账户信息不存在', 'ACCOUNT_NOT_FOUND');
        result.failed++;
        continue;
      }

      // v519: 获取动态锁TTL
      const accountLockTtl = await getDynamicLockTtl(shard.accountId, shard.tier as SyncTier);
      const accountLockKey = `sync:account:${shard.accountId}:${shard.tier}`;
      const lockAcquired = await acquireLock(accountLockKey, INSTANCE_ID, accountLockTtl);
      
      if (!lockAcquired) {
        await markShardFailed(shard.shardId, '账户锁定: 重试时另一个同步进程正在处理', 'ACCOUNT_LOCKED');
        result.failed++;
        continue;
      }

      try {
        const accountResult = await syncAccount(account, shard.tier as SyncTier, {
          specificSteps: [shard.stepId],
        });

        const stepResult = accountResult.stepResults[shard.stepId];
        if (stepResult?.success) {
          await markShardCompleted(shard.shardId, {
            shardId: shard.shardId,
            status: 'completed',
            recordsSynced: stepResult.synced || 0,
          });
          result.succeeded++;
        } else {
          const errorMsg = stepResult?.errors?.join('; ') || '重试失败';
          await markShardFailed(shard.shardId, errorMsg, 'RETRY_FAILED');
          result.failed++;
        }
      } finally {
        await releaseLock(accountLockKey, INSTANCE_ID);
      }

    } catch (error: unknown) {
      log.warn(`[v358] 重试分片 ${shard.shardId} 异常: ${(error as Error).message}`);
      await markShardFailed(shard.shardId, (error as Error).message, 'RETRY_ERROR');
      result.failed++;
    }

    // 重试间延迟
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  log.info(`[v358] 重试完成: 重试=${result.retried}, 成功=${result.succeeded}, 失败=${result.failed}`);
  return result;
}
