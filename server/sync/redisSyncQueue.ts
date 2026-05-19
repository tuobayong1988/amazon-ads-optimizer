// @ts-nocheck
/**
 * v640: Redis 分布式同步任务队列
 * 
 * 核心功能:
 * 1. 任务持久化 — 进程重启不丢失任务
 * 2. 优先级队列 — 手动同步 > 高频同步 > 中频同步 > 完整同步
 * 3. 任务去重 — 同一账户不重复入队
 * 4. 死信队列(DLQ) — 多次失败的任务移入DLQ供人工分析
 * 5. 降级机制 — Redis不可用时自动降级到内存队列
 * 
 * Redis Key 设计:
 * - sync:queue:pending     — 待处理任务有序集合 (ZSET, score=priority*1e12+timestamp)
 * - sync:queue:processing  — 处理中任务哈希 (HASH, field=taskId, value=JSON)
 * - sync:queue:dlq         — 死信队列列表 (LIST)
 * - sync:queue:dedup       — 去重集合 (SET, value=accountId:tier)
 * - sync:queue:stats       — 统计信息 (HASH)
 */

import { createModuleLogger } from '../utils/logger';
import { getRedis, isRedisAvailable } from '../utils/redisClient';

const log = createModuleLogger('RedisSyncQueue');

// Redis Key 前缀
const KEY_PREFIX = 'sync:queue';
const KEYS = {
  pending: `${KEY_PREFIX}:pending`,
  processing: `${KEY_PREFIX}:processing`,
  dlq: `${KEY_PREFIX}:dlq`,
  dedup: `${KEY_PREFIX}:dedup`,
  stats: `${KEY_PREFIX}:stats`,
};

// 优先级定义 (数字越小优先级越高)
export const SYNC_PRIORITY = {
  MANUAL: 1,      // 手动触发的同步
  HIGH_FREQ: 2,   // 高频同步 (状态/预算)
  MED_FREQ: 3,    // 中频同步 (广告组/关键词)
  FULL: 4,        // 完整同步
  NIGHTLY: 5,     // 夜间同步 (绩效报表)
};

// 任务接口
export interface SyncTask {
  id: string;
  accountId: number;
  userId: number;
  tier: string;
  priority: number;
  timestamp: number;
  retryCount: number;
  maxRetries: number;
  errorMessage?: string;
  createdAt: string;
}

// DLQ任务接口
export interface DeadLetterTask extends SyncTask {
  failedAt: string;
  failureReason: string;
  originalPriority: number;
}

// 统计信息
interface QueueStats {
  totalEnqueued: number;
  totalDequeued: number;
  totalCompleted: number;
  totalFailed: number;
  totalDLQ: number;
  dedupSkipped: number;
}

// 内存降级队列
const memoryQueue: SyncTask[] = [];
const memoryDedup = new Set<string>();

/**
 * 生成任务ID
 */
function generateTaskId(accountId: number, tier: string): string {
  return `${accountId}:${tier}:${Date.now()}`;
}

/**
 * 生成去重键
 */
function dedupKey(accountId: number, tier: string): string {
  return `${accountId}:${tier}`;
}

/**
 * 计算排序分数 (priority * 1e12 + timestamp，确保同优先级按时间排序)
 */
function calcScore(priority: number, timestamp: number): number {
  return priority * 1e12 + timestamp;
}

/**
 * 入队 — 添加同步任务到队列
 * 支持去重：同一账户+同一层级不重复入队
 */
export async function enqueue(task: Omit<SyncTask, 'id' | 'retryCount' | 'maxRetries' | 'createdAt'>): Promise<string | null> {
  const dKey = dedupKey(task.accountId, task.tier);
  const redis = getRedis();
  
  if (redis && isRedisAvailable()) {
    try {
      // 去重检查
      const exists = await redis.sismember(KEYS.dedup, dKey);
      if (exists) {
        await redis.hincrby(KEYS.stats, 'dedupSkipped', 1);
        log.info(`[RedisSyncQueue] v640: 任务去重跳过 ${dKey}`);
        return null;
      }

      const taskId = generateTaskId(task.accountId, task.tier);
      const fullTask: SyncTask = {
        ...task,
        id: taskId,
        retryCount: 0,
        maxRetries: 3,
        createdAt: new Date().toISOString(),
      };

      // 原子操作：入队 + 去重标记
      const pipeline = redis.pipeline();
      pipeline.zadd(KEYS.pending, calcScore(task.priority, task.timestamp), JSON.stringify(fullTask));
      pipeline.sadd(KEYS.dedup, dKey);
      pipeline.hincrby(KEYS.stats, 'totalEnqueued', 1);
      // 去重键30分钟过期（防止永久占用）
      pipeline.expire(KEYS.dedup, 1800);
      await pipeline.exec();

      log.info(`[RedisSyncQueue] v640: 任务入队 ${taskId} (priority: ${task.priority}, account: ${task.accountId})`);
      return taskId;
    } catch (error) {
      log.warn(`[RedisSyncQueue] v640: Redis入队失败，降级到内存队列:`, error);
      // 降级到内存队列
    }
  }

  // 内存降级模式
  if (memoryDedup.has(dKey)) {
    log.info(`[RedisSyncQueue] v640: 内存队列去重跳过 ${dKey}`);
    return null;
  }

  const taskId = generateTaskId(task.accountId, task.tier);
  const fullTask: SyncTask = {
    ...task,
    id: taskId,
    retryCount: 0,
    maxRetries: 3,
    createdAt: new Date().toISOString(),
  };

  memoryQueue.push(fullTask);
  memoryDedup.add(dKey);
  // 30分钟后清除去重标记
  setTimeout(() => memoryDedup.delete(dKey), 30 * 60 * 1000);

  log.info(`[RedisSyncQueue] v640: 任务入队(内存) ${taskId}`);
  return taskId;
}

/**
 * 出队 — 获取最高优先级的任务
 */
export async function dequeue(count: number = 1): Promise<SyncTask[]> {
  const redis = getRedis();
  
  if (redis && isRedisAvailable()) {
    try {
      const tasks: SyncTask[] = [];
      
      for (let i = 0; i < count; i++) {
        // ZPOPMIN: 弹出分数最低（优先级最高）的元素
        const result = await redis.zpopmin(KEYS.pending, 1);
        if (!result || result.length === 0) break;
        
        const taskJson = result[0];
        const task = JSON.parse(taskJson) as SyncTask;
        
        // 移入processing集合
        await redis.hset(KEYS.processing, task.id, taskJson);
        await redis.hincrby(KEYS.stats, 'totalDequeued', 1);
        
        tasks.push(task);
      }
      
      return tasks;
    } catch (error) {
      log.warn(`[RedisSyncQueue] v640: Redis出队失败，降级到内存队列:`, error);
    }
  }

  // 内存降级模式
  const tasks: SyncTask[] = [];
  // 按优先级排序
  memoryQueue.sort((a, b) => calcScore(a.priority, a.timestamp) - calcScore(b.priority, b.timestamp));
  
  for (let i = 0; i < count && memoryQueue.length > 0; i++) {
    const task = memoryQueue.shift()!;
    tasks.push(task);
  }
  
  return tasks;
}

/**
 * 完成任务 — 从processing中移除
 */
export async function complete(taskId: string, accountId: number, tier: string): Promise<void> {
  const redis = getRedis();
  const dKey = dedupKey(accountId, tier);
  
  if (redis && isRedisAvailable()) {
    try {
      const pipeline = redis.pipeline();
      pipeline.hdel(KEYS.processing, taskId);
      pipeline.srem(KEYS.dedup, dKey);
      pipeline.hincrby(KEYS.stats, 'totalCompleted', 1);
      await pipeline.exec();
      return;
    } catch (error) {
      log.warn(`[RedisSyncQueue] v640: Redis完成标记失败:`, error);
    }
  }

  // 内存降级
  memoryDedup.delete(dKey);
}

/**
 * 失败任务 — 重试或移入死信队列
 */
export async function fail(taskId: string, accountId: number, tier: string, errorMessage: string): Promise<void> {
  const redis = getRedis();
  const dKey = dedupKey(accountId, tier);
  
  if (redis && isRedisAvailable()) {
    try {
      // 获取任务信息
      const taskJson = await redis.hget(KEYS.processing, taskId);
      if (!taskJson) return;
      
      const task = JSON.parse(taskJson) as SyncTask;
      task.retryCount++;
      task.errorMessage = errorMessage;
      
      if (task.retryCount >= task.maxRetries) {
        // 移入死信队列
        const dlqTask: DeadLetterTask = {
          ...task,
          failedAt: new Date().toISOString(),
          failureReason: errorMessage,
          originalPriority: task.priority,
        };
        
        const pipeline = redis.pipeline();
        pipeline.hdel(KEYS.processing, taskId);
        pipeline.lpush(KEYS.dlq, JSON.stringify(dlqTask));
        pipeline.srem(KEYS.dedup, dKey);
        pipeline.hincrby(KEYS.stats, 'totalDLQ', 1);
        pipeline.hincrby(KEYS.stats, 'totalFailed', 1);
        // DLQ保留30天
        pipeline.ltrim(KEYS.dlq, 0, 999);
        await pipeline.exec();
        
        log.warn(`[RedisSyncQueue] v640: 任务 ${taskId} 移入死信队列 (重试${task.retryCount}次后仍失败: ${errorMessage})`);
      } else {
        // 重新入队（降低优先级）
        const pipeline = redis.pipeline();
        pipeline.hdel(KEYS.processing, taskId);
        pipeline.zadd(KEYS.pending, calcScore(task.priority + 1, Date.now()), JSON.stringify(task));
        pipeline.hincrby(KEYS.stats, 'totalFailed', 1);
        await pipeline.exec();
        
        log.info(`[RedisSyncQueue] v640: 任务 ${taskId} 重新入队 (重试 ${task.retryCount}/${task.maxRetries})`);
      }
      return;
    } catch (error) {
      log.warn(`[RedisSyncQueue] v640: Redis失败标记异常:`, error);
    }
  }

  // 内存降级
  memoryDedup.delete(dKey);
}

/**
 * 获取队列状态
 */
export async function getQueueStatus(): Promise<{
  pendingCount: number;
  processingCount: number;
  dlqCount: number;
  dedupCount: number;
  stats: QueueStats;
  isRedisMode: boolean;
}> {
  const redis = getRedis();
  
  if (redis && isRedisAvailable()) {
    try {
      const pipeline = redis.pipeline();
      pipeline.zcard(KEYS.pending);
      pipeline.hlen(KEYS.processing);
      pipeline.llen(KEYS.dlq);
      pipeline.scard(KEYS.dedup);
      pipeline.hgetall(KEYS.stats);
      const results = await pipeline.exec();
      
      const statsRaw = (results?.[4]?.[1] as Record<string, string>) || {};
      
      return {
        pendingCount: (results?.[0]?.[1] as number) || 0,
        processingCount: (results?.[1]?.[1] as number) || 0,
        dlqCount: (results?.[2]?.[1] as number) || 0,
        dedupCount: (results?.[3]?.[1] as number) || 0,
        stats: {
          totalEnqueued: parseInt(statsRaw.totalEnqueued || '0'),
          totalDequeued: parseInt(statsRaw.totalDequeued || '0'),
          totalCompleted: parseInt(statsRaw.totalCompleted || '0'),
          totalFailed: parseInt(statsRaw.totalFailed || '0'),
          totalDLQ: parseInt(statsRaw.totalDLQ || '0'),
          dedupSkipped: parseInt(statsRaw.dedupSkipped || '0'),
        },
        isRedisMode: true,
      };
    } catch (error) {
      log.warn(`[RedisSyncQueue] v640: 获取Redis队列状态失败:`, error);
    }
  }

  // 内存降级
  return {
    pendingCount: memoryQueue.length,
    processingCount: 0,
    dlqCount: 0,
    dedupCount: memoryDedup.size,
    stats: {
      totalEnqueued: 0,
      totalDequeued: 0,
      totalCompleted: 0,
      totalFailed: 0,
      totalDLQ: 0,
      dedupSkipped: 0,
    },
    isRedisMode: false,
  };
}

/**
 * 获取死信队列中的任务
 */
export async function getDLQTasks(limit: number = 20): Promise<DeadLetterTask[]> {
  const redis = getRedis();
  
  if (redis && isRedisAvailable()) {
    try {
      const items = await redis.lrange(KEYS.dlq, 0, limit - 1);
      return items.map(item => JSON.parse(item) as DeadLetterTask);
    } catch (error) {
      log.warn(`[RedisSyncQueue] v640: 获取DLQ失败:`, error);
    }
  }
  
  return [];
}

/**
 * 重试死信队列中的任务
 */
export async function retryDLQTask(index: number): Promise<boolean> {
  const redis = getRedis();
  
  if (redis && isRedisAvailable()) {
    try {
      const items = await redis.lrange(KEYS.dlq, index, index);
      if (items.length === 0) return false;
      
      const dlqTask = JSON.parse(items[0]) as DeadLetterTask;
      
      // 重置重试计数并重新入队
      const task: SyncTask = {
        id: generateTaskId(dlqTask.accountId, dlqTask.tier),
        accountId: dlqTask.accountId,
        userId: dlqTask.userId,
        tier: dlqTask.tier,
        priority: dlqTask.originalPriority,
        timestamp: Date.now(),
        retryCount: 0,
        maxRetries: dlqTask.maxRetries,
        createdAt: new Date().toISOString(),
      };
      
      const pipeline = redis.pipeline();
      // 从DLQ中标记为已处理（设置为特殊值）
      pipeline.lset(KEYS.dlq, index, '__RETRIED__');
      pipeline.lrem(KEYS.dlq, 1, '__RETRIED__');
      pipeline.zadd(KEYS.pending, calcScore(task.priority, task.timestamp), JSON.stringify(task));
      await pipeline.exec();
      
      log.info(`[RedisSyncQueue] v640: DLQ任务重新入队 account=${dlqTask.accountId} tier=${dlqTask.tier}`);
      return true;
    } catch (error) {
      log.warn(`[RedisSyncQueue] v640: DLQ重试失败:`, error);
    }
  }
  
  return false;
}

/**
 * 恢复processing中的孤儿任务（进程重启后）
 */
export async function recoverOrphanTasks(): Promise<number> {
  const redis = getRedis();
  
  if (redis && isRedisAvailable()) {
    try {
      const processingTasks = await redis.hgetall(KEYS.processing);
      const taskIds = Object.keys(processingTasks);
      
      if (taskIds.length === 0) return 0;
      
      log.info(`[RedisSyncQueue] v640: 发现 ${taskIds.length} 个孤儿任务，正在恢复...`);
      
      const pipeline = redis.pipeline();
      for (const [taskId, taskJson] of Object.entries(processingTasks)) {
        const task = JSON.parse(taskJson) as SyncTask;
        // 重新入队，保持原优先级
        pipeline.zadd(KEYS.pending, calcScore(task.priority, Date.now()), taskJson);
        pipeline.hdel(KEYS.processing, taskId);
      }
      await pipeline.exec();
      
      log.info(`[RedisSyncQueue] v640: 成功恢复 ${taskIds.length} 个孤儿任务`);
      return taskIds.length;
    } catch (error) {
      log.warn(`[RedisSyncQueue] v640: 恢复孤儿任务失败:`, error);
    }
  }
  
  return 0;
}
