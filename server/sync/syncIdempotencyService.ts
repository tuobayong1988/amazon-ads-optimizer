import { createModuleLogger } from '../utils/logger';
const log = createModuleLogger('SyncIdempotencyService');
/**
 * Sync Idempotency Service - 同步幂等性保护服务
 * 
 * 核心职责：
 * 1. 防止同一账号并发同步 - 同一时刻只允许一个同步任务运行
 * 2. 全量同步前清除旧数据 - 确保覆盖写入而非累积
 * 3. 同步锁管理 - 带超时的分布式锁
 * 
 * v358改造：
 * - 新增分布式锁模式（基于数据库），支持多实例部署
 * - 保留内存锁作为降级方案（数据库不可用时自动切换）
 * - 新增锁模式自动检测和切换
 */

import * as db from '../db';
import { acquireLock, releaseLock, renewLock } from './infrastructure/shardManager';
import { randomUUID } from 'crypto';

// ==================== 锁模式配置 ====================

type LockMode = 'memory' | 'distributed' | 'auto';

// v358: 默认使用auto模式（优先分布式锁，降级到内存锁）
let currentLockMode: LockMode = 'auto';

// 进程实例ID（用于分布式锁的持有者标识）
const PROCESS_ID = `proc-${randomUUID().slice(0, 8)}`;

/**
 * v358: 设置锁模式
 */
export function setLockMode(mode: LockMode): void {
  currentLockMode = mode;
  log.info(`[v358] 锁模式设置为: ${mode}`);
}

// ==================== 内存锁（降级方案） ====================

interface SyncLock {
  lockId: string;
  accountId: number;
  syncType: string;
  acquiredAt: Date;
  expiresAt: Date;
}

const syncLocks = new Map<string, SyncLock>();
// v518: 动态锁超时 - 默认45分钟，大账户通过参数传入更长超时
// 与unifiedSyncEngine的动态超时机制保持一致
const DEFAULT_LOCK_TIMEOUT_MS = 45 * 60 * 1000;
// v518: 导出动态超时计算函数，供unifiedSyncEngine调用
export function getDynamicLockTimeout(campaignCount: number, tier: string): number {
  if (tier === 'nightly') return 4 * 60 * 60 * 1000; // nightly: 4小时
  if (campaignCount >= 5000) return 90 * 60 * 1000;
  if (campaignCount >= 3000) return 75 * 60 * 1000;
  if (campaignCount >= 1000) return 60 * 60 * 1000;
  return DEFAULT_LOCK_TIMEOUT_MS;
}

function getLockKey(accountId: number, syncType: string = 'all'): string {
  return `sync:${accountId}:${syncType}`;
}

// ==================== 内存锁操作 ====================

function acquireMemoryLock(accountId: number, syncType: string = 'all'): string | null {
  const key = getLockKey(accountId, syncType);
  const existing = syncLocks.get(key);
  
  if (existing) {
    if (new Date() > existing.expiresAt) {
      log.warn(`[SyncLock] 内存锁已超时，强制释放: ${key}`);
      syncLocks.delete(key);
    } else {
      log.info(`[SyncLock] 内存锁被占用: ${key}`);
      return null;
    }
  }
  
  const lockId = `lock_${accountId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const now = new Date();
  
  syncLocks.set(key, {
    lockId,
    accountId,
    syncType,
    acquiredAt: now,
    expiresAt: new Date(now.getTime() + DEFAULT_LOCK_TIMEOUT_MS),
  });
  
  return lockId;
}

function releaseMemoryLock(accountId: number, syncType: string = 'all', lockId?: string): boolean {
  const key = getLockKey(accountId, syncType);
  const existing = syncLocks.get(key);
  
  if (!existing) return true;
  if (lockId && existing.lockId !== lockId) return false;
  
  syncLocks.delete(key);
  return true;
}

function isMemoryLocked(accountId: number, syncType: string = 'all'): boolean {
  const key = getLockKey(accountId, syncType);
  const existing = syncLocks.get(key);
  if (!existing) return false;
  if (new Date() > existing.expiresAt) {
    syncLocks.delete(key);
    return false;
  }
  return true;
}

// ==================== 统一锁接口（v358） ====================

/**
 * 尝试获取同步锁（v358: 支持分布式锁）
 */
export async function acquireSyncLock(accountId: number, syncType: string = 'all', dynamicTimeoutMs?: number): Promise<string | null> {
  const lockKey = getLockKey(accountId, syncType);
  const timeoutMs = dynamicTimeoutMs || DEFAULT_LOCK_TIMEOUT_MS;
  
  if (currentLockMode === 'memory') {
    return acquireMemoryLock(accountId, syncType);
  }
  
  // auto或distributed模式：优先尝试分布式锁
  try {
    const holderId = `${PROCESS_ID}:${lockKey}`;
    const acquired = await acquireLock(lockKey, holderId, timeoutMs);
    
    if (acquired) {
      log.info(`[v358] 分布式锁已获取: ${lockKey}`);
      // 同时在内存中记录（用于快速查询）
      acquireMemoryLock(accountId, syncType);
      return holderId;
    } else {
      log.info(`[v358] 分布式锁被占用: ${lockKey}`);
      return null;
    }
  } catch (error: unknown) {
    if (currentLockMode === 'auto') {
      // 降级到内存锁
      log.warn(`[v358] 分布式锁获取失败(${(error as Error).message})，降级到内存锁`);
      return acquireMemoryLock(accountId, syncType);
    }
    log.warn(`[v358] 分布式锁获取失败: ${(error as Error).message}`);
    return null;
  }
}

/**
 * 释放同步锁（v358: 支持分布式锁）
 */
export async function releaseSyncLock(accountId: number, syncType: string = 'all', lockId?: string): Promise<boolean> {
  const lockKey = getLockKey(accountId, syncType);
  
  // 始终释放内存锁
  releaseMemoryLock(accountId, syncType, lockId);
  
  if (currentLockMode === 'memory') {
    return true;
  }
  
  // 释放分布式锁
  try {
    const holderId = lockId || `${PROCESS_ID}:${lockKey}`;
    await releaseLock(lockKey, holderId);
    log.info(`[v358] 分布式锁已释放: ${lockKey}`);
    return true;
  } catch (error: unknown) {
    log.warn(`[v358] 分布式锁释放失败(${(error as Error).message})，内存锁已释放`);
    return true; // 内存锁已释放，不阻塞
  }
}

/**
 * 检查同步锁状态
 */
export function isSyncLocked(accountId: number, syncType: string = 'all'): boolean {
  // 快速路径：检查内存锁
  return isMemoryLocked(accountId, syncType);
}

/**
 * 获取所有活跃的同步锁
 */
export function getActiveSyncLocks(): SyncLock[] {
  const now = new Date();
  const active: SyncLock[] = [];
  
  for (const [key, lock] of syncLocks.entries()) {
    if (now > lock.expiresAt) {
      syncLocks.delete(key);
    } else {
      active.push(lock);
    }
  }
  
  return active;
}

// ==================== 绩效数据覆盖写入保护 ====================

/**
 * 全量同步前清除指定日期范围的旧绩效数据
 * 
 * ⚠️ 重要设计原则：
 * 全量同步采用"先删后写"策略，确保数据完全覆盖而非累积。
 * 这样即使一天内多次触发全量同步，数据也不会翻倍。
 */
export async function clearPerformanceDataForFullSync(
  accountId: number,
  startDate: string,
  endDate: string
): Promise<number> {
  log.info(`[SyncIdempotency] 清除旧绩效数据: accountId=${accountId}, ${startDate} ~ ${endDate}`);
  
  try {
    const deletedCount = await db.deleteDailyPerformanceByDateRange(
      accountId,
      startDate,
      endDate
    );
    
    log.info(`[SyncIdempotency] 已清除 ${deletedCount} 条旧绩效数据`);
    return deletedCount;
  } catch (error: unknown) {
    log.warn(`[SyncIdempotency] 清除旧绩效数据失败:`, error);
    return 0;
  }
}

// ==================== 带锁的同步执行器 ====================

/**
 * 带幂等性保护的同步执行器（v358: 支持分布式锁）
 */
export async function executeWithIdempotency<T>(
  accountId: number,
  syncType: string,
  syncFn: () => Promise<T>
): Promise<{ success: boolean; result?: T; error?: string; locked?: boolean }> {
  // 1. 尝试获取锁（v358: 异步，支持分布式锁）
  const lockId = await acquireSyncLock(accountId, syncType);
  if (!lockId) {
    return {
      success: false,
      locked: true,
      error: `账号 ${accountId} 的 ${syncType} 同步正在进行中，请稍后再试`,
    };
  }
  
  try {
    // 2. 执行同步
    const result = await syncFn();
    return { success: true, result };
  } catch (error: unknown) {
    log.warn(`[SyncIdempotency] 同步执行失败: accountId=${accountId}, syncType=${syncType}`, error);
    return { success: false, error: (error as Error).message };
  } finally {
    // 3. 始终释放锁
    await releaseSyncLock(accountId, syncType, lockId);
  }
}
