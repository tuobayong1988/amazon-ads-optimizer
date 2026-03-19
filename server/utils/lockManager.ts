/**
 * 账户级模块锁管理器 (v427)
 * 
 * v181: 从 dataSyncScheduler.ts 中提取的独立模块
 * v362: 增强为混合锁管理器，支持内存锁（单实例）和数据库锁（多实例）
 * v368: 修复分布式锁连接管理Bug
 * v426: 改用sync_locks表替代GET_LOCK
 * v427: 升级为 Redis 分布式锁（三级降级：Redis → MySQL sync_locks → 内存锁）
 * 
 * 设计原则：
 * 1. 内存锁用于单实例快速路径（零延迟）
 * 2. Redis 锁用于多实例环境下的分布式互斥（<1ms延迟）
 * 3. MySQL sync_locks 表作为 Redis 不可用时的降级方案
 * 4. 三级降级：Redis → MySQL → 内存锁
 * 5. 锁超时自动释放，防止死锁
 * 6. 锁状态可查询，便于监控和排查
 */
import { createModuleLogger } from './logger';
const log = createModuleLogger('LockManager');

// ============================================================
// 内存锁（单实例模式 - 快速路径）
// ============================================================

interface MemoryLockState {
  locked: boolean;
  lockedBy: string;
  lockedAt: Date | null;
  /** v362: 锁的预期持续时间（毫秒） */
  expectedDurationMs: number;
}

const accountModuleLocks: Record<string, MemoryLockState> = {};

/** v427: 分布式锁释放函数缓存 */
const distributedLockReleases: Map<string, () => Promise<void>> = new Map();

/** v362: 默认锁超时时间（10分钟，从5分钟提升以适应大账户优化） */
const DEFAULT_LOCK_TIMEOUT_MS = 10 * 60 * 1000;
/** v362: 最大锁超时时间（30分钟） */
const MAX_LOCK_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * 根据模块列表确定锁分组
 */
export function getModuleLockGroup(specificModules?: string[]): string {
  if (!specificModules || specificModules.length === 0) return 'all';
  // v385: 将keyword从bid锁组分离，减少锁冲突
  if (specificModules.includes('bid')) return 'bid';
  if (specificModules.includes('keyword')) return 'keyword';
  if (specificModules.includes('dayparting') || specificModules.includes('multidim')) return 'dayparting';
  if (specificModules.includes('dayparting_budget')) return 'dayparting_budget';
  if (specificModules.includes('placement')) return 'placement';
  if (specificModules.includes('searchterm')) return 'searchterm';
  if (specificModules.includes('budget')) return 'budget';
  return 'all';
}

/**
 * 获取账户+模块级别的优化锁（内存锁，单实例快速路径）
 */
function acquireMemoryLock(
  lockKey: string,
  lockedBy: string,
  options?: { expectedDurationMs?: number; timeoutMs?: number }
): boolean {
  const timeoutMs = Math.min(options?.timeoutMs || DEFAULT_LOCK_TIMEOUT_MS, MAX_LOCK_TIMEOUT_MS);
  
  if (!accountModuleLocks[lockKey]) {
    accountModuleLocks[lockKey] = {
      locked: false, lockedBy: '', lockedAt: null, expectedDurationMs: DEFAULT_LOCK_TIMEOUT_MS,
    };
  }
  const lock = accountModuleLocks[lockKey];
  
  if (lock.locked) {
    const lockAge = lock.lockedAt ? (Date.now() - lock.lockedAt.getTime()) : 0;
    const effectiveTimeout = Math.max(lock.expectedDurationMs * 2, timeoutMs);
    
    if (lockAge > effectiveTimeout) {
      log.warn(`[LockManager] ${lockKey} 优化锁超时 ${Math.round(lockAge / 1000)}秒 (限制: ${Math.round(effectiveTimeout / 1000)}秒)，强制释放 (lockedBy: ${lock.lockedBy})`);
      recordLockEvent(lockKey, 'timeout_release', lock.lockedBy, lockAge);
    } else {
      log.info(`[LockManager] ${lockKey} 优化锁已被 ${lock.lockedBy} 持有 ${Math.round(lockAge / 1000)}秒，${lockedBy} 跳过`);
      return false;
    }
  }
  
  lock.locked = true;
  lock.lockedBy = lockedBy;
  lock.lockedAt = new Date();
  lock.expectedDurationMs = options?.expectedDurationMs || DEFAULT_LOCK_TIMEOUT_MS;
  return true;
}

/**
 * 释放内存锁
 */
function releaseMemoryLock(lockKey: string): void {
  if (accountModuleLocks[lockKey]) {
    accountModuleLocks[lockKey].locked = false;
    accountModuleLocks[lockKey].lockedBy = '';
    accountModuleLocks[lockKey].lockedAt = null;
  }
}

// ============================================================
// v427: Redis 分布式锁集成
// ============================================================

/**
 * 尝试获取 Redis 分布式锁，降级到 MySQL sync_locks 表
 * @returns 释放函数，如果获取失败返回 null
 */
async function acquireRedisOrMySQLLock(
  lockKey: string,
  timeoutMs: number
): Promise<(() => Promise<void>) | null> {
  // 优先尝试 Redis 分布式锁
  try {
    const { RedisDistributedLock } = await import('./redisDistributedLock');
    const redisLock = new RedisDistributedLock(`opt_${lockKey}`);
    const release = await redisLock.tryAcquire(timeoutMs);
    if (release) {
      log.debug(`[LockManager] ${lockKey} Redis分布式锁获取成功`);
      return release;
    }
    // Redis 锁被占用
    return null;
  } catch (e: unknown) {
    log.debug(`[LockManager] ${lockKey} Redis锁不可用: ${(e as Error).message}，降级到MySQL锁`);
  }

  // 降级到 MySQL sync_locks 表锁
  try {
    const { DistributedLock } = await import('./distributedLock');
    const mysqlLock = new DistributedLock(`opt_${lockKey}`);
    const release = await mysqlLock.tryAcquire(timeoutMs);
    if (release) {
      log.debug(`[LockManager] ${lockKey} MySQL分布式锁获取成功`);
      return release;
    }
    return null;
  } catch (e: unknown) {
    log.debug(`[LockManager] ${lockKey} MySQL锁也不可用: ${(e as Error).message}，降级到仅内存锁`);
    // 返回空释放函数（仅内存锁模式）
    return async () => {};
  }
}

/**
 * 获取账户+模块级别的优化锁（三级混合锁：内存锁 + Redis/MySQL 分布式锁）
 * 
 * v427: 升级为三级降级策略
 * - 先获取内存锁（快速失败，避免不必要的网络调用）
 * - 再尝试 Redis 分布式锁（<1ms延迟，跨实例互斥）
 * - Redis 不可用时降级到 MySQL sync_locks 表锁
 * - 全部不可用时降级到仅内存锁模式
 */
export async function acquireAccountOptimizationLock(
  accountId: number,
  lockedBy: string,
  moduleGroup?: string,
  options?: { expectedDurationMs?: number; timeoutMs?: number }
): Promise<boolean> {
  const group = moduleGroup || 'all';
  const lockKey = `${accountId}:${group}`;
  
  // Step 1: 内存锁快速路径
  if (!acquireMemoryLock(lockKey, lockedBy, options)) {
    return false;
  }
  
  // Step 2: v427 Redis/MySQL 分布式锁
  try {
    const timeoutMs = options?.expectedDurationMs || DEFAULT_LOCK_TIMEOUT_MS;
    const release = await acquireRedisOrMySQLLock(lockKey, timeoutMs);
    
    if (release === null) {
      // 分布式锁获取失败（被其他实例持有），回滚内存锁
      releaseMemoryLock(lockKey);
      log.info(`[LockManager] ${lockKey} 分布式锁已被其他实例持有，${lockedBy} 跳过`);
      return false;
    }
    
    // 保存release函数用于后续释放
    distributedLockReleases.set(lockKey, release);
  } catch (e: unknown) {
    // 分布式锁获取异常，降级为仅内存锁模式
    log.debug(`[LockManager] ${lockKey} 分布式锁降级: ${(e as Error).message}`);
  }
  
  recordLockEvent(lockKey, 'acquired', lockedBy, 0);
  log.debug(`[LockManager] ${lockKey} 混合锁获取成功 by ${lockedBy}`);
  return true;
}

/**
 * 释放账户+模块级别的优化锁（同时释放内存锁和分布式锁）
 * v427: 同时释放 Redis/MySQL 分布式锁
 */
export async function releaseAccountOptimizationLock(accountId: number, moduleGroup?: string): Promise<void> {
  const group = moduleGroup || 'all';
  const lockKey = `${accountId}:${group}`;
  
  if (accountModuleLocks[lockKey]) {
    const holdTime = accountModuleLocks[lockKey].lockedAt
      ? Date.now() - accountModuleLocks[lockKey].lockedAt!.getTime() : 0;
    recordLockEvent(lockKey, 'released', accountModuleLocks[lockKey].lockedBy, holdTime);
  }
  
  // 释放内存锁
  releaseMemoryLock(lockKey);
  
  // v427: 释放分布式锁（Redis 或 MySQL）
  try {
    const release = distributedLockReleases?.get(lockKey);
    if (release) {
      await release();
      distributedLockReleases.delete(lockKey);
    }
  } catch (e: unknown) {
    log.debug(`[LockManager] ${lockKey} 释放分布式锁失败: ${(e as Error).message}`);
  }
}

/**
 * 带重试的锁获取 - v362: 使用指数退避+抖动, v368: 适配async混合锁
 */
export async function acquireAccountOptimizationLockWithRetry(
  accountId: number, lockedBy: string, moduleGroup?: string, maxRetries: number = 3, retryDelayMs: number = 10000
): Promise<boolean> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (await acquireAccountOptimizationLock(accountId, lockedBy, moduleGroup)) {
      if (attempt > 0) {
        log.debug(`[LockManager] ${accountId}:${moduleGroup || 'all'} 第${attempt + 1}次尝试获取锁成功 (${lockedBy})`);
      }
      return true;
    }
    if (attempt < maxRetries) {
      const jitter = Math.random() * 2000;
      const delay = retryDelayMs * Math.pow(1.5, attempt) + jitter;
      log.debug(`[LockManager] ${accountId}:${moduleGroup || 'all'} 锁被占用，${Math.round(delay / 1000)}秒后重试 (${attempt + 1}/${maxRetries})`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  return false;
}

// ============================================================
// v427: 向后兼容的数据库分布式锁（保留旧API）
// ============================================================

/**
 * v368: 分布式锁连接池（向后兼容）
 * 
 * 注意：此API已被 Redis 分布式锁取代，保留仅为向后兼容。
 * 新代码应使用 RedisDistributedLock 或 acquireAccountOptimizationLock。
 */
const distributedLockConnections: Map<string, unknown> = new Map();

/**
 * 基于数据库的分布式锁获取 (MySQL GET_LOCK)
 * @deprecated 使用 RedisDistributedLock 替代
 */
export async function acquireDistributedLock(lockName: string, timeoutSec: number = 5): Promise<boolean> {
  const fullLockName = `ppcopt_${lockName}`;
  try {
    // 如果已经持有该锁的连接，先释放旧连接
    if (distributedLockConnections.has(fullLockName)) {
      try {
        const oldConn = distributedLockConnections.get(fullLockName);
        await oldConn.execute('SELECT RELEASE_LOCK(?)', [fullLockName]);
        oldConn.release();
        distributedLockConnections.delete(fullLockName);
      } catch (e) {
        // 忽略旧连接清理错误
      }
    }
    
    const db = await import('../db');
    const conn = await db.getDirectConnection(10000);
    
    // @ts-expect-error - MySQL connection method
    const [rows] = await conn.execute('SELECT GET_LOCK(?, ?) as result', [fullLockName, timeoutSec]) as unknown[];
    const result = rows?.[0]?.result;
    
    if (result === 1) {
      // 锁获取成功，保持连接不释放
      distributedLockConnections.set(fullLockName, conn);
      log.debug(`[DistLock] 获取分布式锁成功: ${lockName} (活跃锁连接: ${distributedLockConnections.size})`);
      return true;
    }
    
    // 锁获取失败，释放连接
    // @ts-expect-error - MySQL connection method
    conn.release();
    log.debug(`[DistLock] 获取分布式锁失败: ${lockName} (result=${result})`);
    return false;
  } catch (error) {
    log.error(`[DistLock] 获取分布式锁异常: ${lockName} - ${(error as Error).message}`);
    return false;
  }
}

/**
 * 释放数据库分布式锁
 * @deprecated 使用 RedisDistributedLock 替代
 */
export async function releaseDistributedLock(lockName: string): Promise<void> {
  const fullLockName = `ppcopt_${lockName}`;
  try {
    const conn = distributedLockConnections.get(fullLockName);
    if (conn) {
      try {
        await conn.execute('SELECT RELEASE_LOCK(?)', [fullLockName]);
      } catch (e) {
        // 忽略RELEASE_LOCK错误（连接可能已断开）
      }
      try {
        conn.release();
      } catch (e) {
        // 忽略连接释放错误
      }
      distributedLockConnections.delete(fullLockName);
      log.debug(`[DistLock] 释放分布式锁: ${lockName} (剩余锁连接: ${distributedLockConnections.size})`);
    } else {
      log.debug(`[DistLock] 释放分布式锁: ${lockName} (无对应连接，可能已释放)`);
    }
  } catch (error) {
    log.error(`[DistLock] 释放分布式锁异常: ${lockName} - ${(error as Error).message}`);
  }
}

/**
 * 使用分布式锁执行操作（自动获取和释放）
 * v427: 优先使用 Redis 锁
 */
export async function withDistributedLock<T>(
  lockName: string, fn: () => Promise<T>, options?: { timeoutSec?: number }
): Promise<T | null> {
  // v427: 优先使用 Redis 分布式锁
  try {
    const { withRedisLock } = await import('./redisDistributedLock');
    const timeoutMs = (options?.timeoutSec || 5) * 1000;
    const result = await withRedisLock(lockName, fn, timeoutMs);
    return result;
  } catch (e: unknown) {
    log.debug(`[DistLock] Redis锁不可用，降级到MySQL GET_LOCK: ${(e as Error).message}`);
  }

  // 降级到 MySQL GET_LOCK
  const acquired = await acquireDistributedLock(lockName, options?.timeoutSec || 5);
  if (!acquired) return null;
  try {
    return await fn();
  } finally {
    await releaseDistributedLock(lockName);
  }
}

/**
 * v368: 定期清理可能泄漏的锁连接（安全网）
 */
const DIST_LOCK_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

setInterval(async () => {
  if (distributedLockConnections.size === 0) return;
  
  log.debug(`[DistLock] 清理检查: ${distributedLockConnections.size} 个活跃锁连接`);
  
  for (const [lockName, conn] of distributedLockConnections.entries()) {
    try {
      await conn.ping();
    } catch (e) {
      log.warn(`[DistLock] 清理无效锁连接: ${lockName}`);
      distributedLockConnections.delete(lockName);
      try { conn.release(); } catch (_) {}
    }
  }
}, DIST_LOCK_CLEANUP_INTERVAL_MS);

// ============================================================
// v362: 锁状态监控
// ============================================================

interface LockEvent {
  timestamp: Date;
  lockKey: string;
  action: string;
  lockedBy: string;
  holdTimeMs: number;
}

const lockEvents: LockEvent[] = [];
const MAX_LOCK_EVENTS = 200;

function recordLockEvent(lockKey: string, action: string, lockedBy: string, holdTimeMs: number) {
  lockEvents.push({ timestamp: new Date(), lockKey, action, lockedBy, holdTimeMs });
  if (lockEvents.length > MAX_LOCK_EVENTS) {
    lockEvents.splice(0, lockEvents.length - MAX_LOCK_EVENTS);
  }
}

/**
 * 获取当前所有锁的状态（用于监控和排查）
 * v427: 增加 Redis 锁状态
 */
export function getLockStatus(): {
  activeLocks: Array<{ key: string; lockedBy: string; holdTimeSec: number }>;
  recentEvents: LockEvent[];
  stats: { totalAcquired: number; totalTimeout: number; totalReleased: number; activeDistLocks: number };
} {
  const activeLocks: Array<{ key: string; lockedBy: string; holdTimeSec: number }> = [];
  for (const [key, lock] of Object.entries(accountModuleLocks)) {
    if (lock.locked) {
      activeLocks.push({
        key, lockedBy: lock.lockedBy,
        holdTimeSec: lock.lockedAt ? Math.round((Date.now() - lock.lockedAt.getTime()) / 1000) : 0,
      });
    }
  }
  return {
    activeLocks,
    recentEvents: lockEvents.slice(-20),
    stats: {
      totalAcquired: lockEvents.filter(e => e.action === 'acquired').length,
      totalTimeout: lockEvents.filter(e => e.action === 'timeout_release').length,
      totalReleased: lockEvents.filter(e => e.action === 'released').length,
      activeDistLocks: distributedLockConnections.size,
    },
  };
}

/**
 * v427: 获取完整的锁状态（包括 Redis 分布式锁）
 */
export async function getFullLockStatus(): Promise<{
  memoryLocks: Array<{ key: string; lockedBy: string; holdTimeSec: number }>;
  redisLocks: Array<{ lockKey: string; holderId: string; ttlMs: number }>;
  mysqlLocks: Array<{ lockKey: string; holderId: string; acquiredAt: string; expiresAt: string; remainingMs: number }>;
  recentEvents: LockEvent[];
  stats: { totalAcquired: number; totalTimeout: number; totalReleased: number };
}> {
  const basicStatus = getLockStatus();
  
  // 获取 Redis 锁状态
  let redisLocks: Array<{ lockKey: string; holderId: string; ttlMs: number }> = [];
  try {
    const { getAllRedisLockStatus } = await import('./redisDistributedLock');
    redisLocks = await getAllRedisLockStatus();
  } catch {
    // Redis 不可用
  }

  // 获取 MySQL 锁状态
  let mysqlLocks: Array<{ lockKey: string; holderId: string; acquiredAt: string; expiresAt: string; remainingMs: number }> = [];
  try {
    const { getAllDistributedLockStatus } = await import('./distributedLock');
    mysqlLocks = await getAllDistributedLockStatus();
  } catch {
    // MySQL 锁不可用
  }

  return {
    memoryLocks: basicStatus.activeLocks,
    redisLocks,
    mysqlLocks,
    recentEvents: basicStatus.recentEvents,
    stats: {
      totalAcquired: basicStatus.stats.totalAcquired,
      totalTimeout: basicStatus.stats.totalTimeout,
      totalReleased: basicStatus.stats.totalReleased,
    },
  };
}
