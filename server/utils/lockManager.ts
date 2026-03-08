/**
 * 账户级模块锁管理器 (v362)
 * 
 * v181: 从 dataSyncScheduler.ts 中提取的独立模块
 * v362: 增强为混合锁管理器，支持内存锁（单实例）和数据库锁（多实例）
 * 
 * 设计原则：
 * 1. 内存锁用于单实例快速路径（零延迟）
 * 2. 数据库锁用于多实例环境下的分布式互斥
 * 3. 锁超时自动释放，防止死锁
 * 4. 锁状态可查询，便于监控和排查
 */
import { createModuleLogger } from './logger';
const log = createModuleLogger('LockManager');

// ============================================================
// 内存锁（单实例模式）
// ============================================================

interface MemoryLockState {
  locked: boolean;
  lockedBy: string;
  lockedAt: Date | null;
  /** v362: 锁的预期持续时间（毫秒） */
  expectedDurationMs: number;
}

const accountModuleLocks: Record<string, MemoryLockState> = {};

/** v362: 默认锁超时时间（10分钟，从5分钟提升以适应大账户优化） */
const DEFAULT_LOCK_TIMEOUT_MS = 10 * 60 * 1000;
/** v362: 最大锁超时时间（30分钟） */
const MAX_LOCK_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * 根据模块列表确定锁分组
 */
export function getModuleLockGroup(specificModules?: string[]): string {
  if (!specificModules || specificModules.length === 0) return 'all';
  if (specificModules.includes('bid') || specificModules.includes('keyword')) return 'bid';
  if (specificModules.includes('dayparting') || specificModules.includes('multidim')) return 'dayparting';
  if (specificModules.includes('dayparting_budget')) return 'dayparting_budget';
  if (specificModules.includes('placement')) return 'placement';
  if (specificModules.includes('searchterm')) return 'searchterm';
  if (specificModules.includes('budget')) return 'budget';
  return 'all';
}

/**
 * 获取账户+模块级别的优化锁
 */
export function acquireAccountOptimizationLock(
  accountId: number,
  lockedBy: string,
  moduleGroup?: string,
  options?: { expectedDurationMs?: number; timeoutMs?: number }
): boolean {
  const group = moduleGroup || 'all';
  const lockKey = `${accountId}:${group}`;
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
  recordLockEvent(lockKey, 'acquired', lockedBy, 0);
  return true;
}

/**
 * 释放账户+模块级别的优化锁
 */
export function releaseAccountOptimizationLock(accountId: number, moduleGroup?: string): void {
  const group = moduleGroup || 'all';
  const lockKey = `${accountId}:${group}`;
  if (accountModuleLocks[lockKey]) {
    const holdTime = accountModuleLocks[lockKey].lockedAt
      ? Date.now() - accountModuleLocks[lockKey].lockedAt!.getTime() : 0;
    recordLockEvent(lockKey, 'released', accountModuleLocks[lockKey].lockedBy, holdTime);
    accountModuleLocks[lockKey].locked = false;
    accountModuleLocks[lockKey].lockedBy = '';
    accountModuleLocks[lockKey].lockedAt = null;
  }
}

/**
 * 带重试的锁获取 - v362: 使用指数退避+抖动
 */
export async function acquireAccountOptimizationLockWithRetry(
  accountId: number, lockedBy: string, moduleGroup?: string, maxRetries: number = 3, retryDelayMs: number = 10000
): Promise<boolean> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (acquireAccountOptimizationLock(accountId, lockedBy, moduleGroup)) {
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
// v362: 数据库分布式锁（多实例模式）
// ============================================================

/**
 * 基于数据库的分布式锁获取 (MySQL GET_LOCK)
 */
export async function acquireDistributedLock(lockName: string, timeoutSec: number = 5): Promise<boolean> {
  try {
    const db = await import('../db');
    const conn = await db.getDirectConnection(10000);
    try {
      const [rows] = await conn.execute('SELECT GET_LOCK(?, ?) as result', [`ppcopt_${lockName}`, timeoutSec]) as any[];
      const result = rows?.[0]?.result;
      if (result === 1) {
        log.debug(`[DistLock] 获取分布式锁成功: ${lockName}`);
        return true;
      }
      log.debug(`[DistLock] 获取分布式锁失败: ${lockName} (result=${result})`);
      return false;
    } finally {
      conn.release();
    }
  } catch (error) {
    log.error(`[DistLock] 获取分布式锁异常: ${lockName} - ${(error as Error).message}`);
    return false;
  }
}

/**
 * 释放数据库分布式锁
 */
export async function releaseDistributedLock(lockName: string): Promise<void> {
  try {
    const db = await import('../db');
    const conn = await db.getDirectConnection(5000);
    try {
      await conn.execute('SELECT RELEASE_LOCK(?)', [`ppcopt_${lockName}`]);
      log.debug(`[DistLock] 释放分布式锁: ${lockName}`);
    } finally {
      conn.release();
    }
  } catch (error) {
    log.error(`[DistLock] 释放分布式锁异常: ${lockName} - ${(error as Error).message}`);
  }
}

/**
 * 使用分布式锁执行操作（自动获取和释放）
 */
export async function withDistributedLock<T>(
  lockName: string, fn: () => Promise<T>, options?: { timeoutSec?: number }
): Promise<T | null> {
  const acquired = await acquireDistributedLock(lockName, options?.timeoutSec || 5);
  if (!acquired) return null;
  try {
    return await fn();
  } finally {
    await releaseDistributedLock(lockName);
  }
}

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
 */
export function getLockStatus(): {
  activeLocks: Array<{ key: string; lockedBy: string; holdTimeSec: number }>;
  recentEvents: LockEvent[];
  stats: { totalAcquired: number; totalTimeout: number; totalReleased: number };
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
    },
  };
}
