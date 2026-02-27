import { createModuleLogger } from './utils/logger';
const log = createModuleLogger('SyncIdempotencyService');
/**
 * Sync Idempotency Service - 同步幂等性保护服务
 * 
 * 核心职责：
 * 1. 防止同一账号并发同步 - 同一时刻只允许一个同步任务运行
 * 2. 全量同步前清除旧数据 - 确保覆盖写入而非累积
 * 3. 同步锁管理 - 带超时的分布式锁
 * 
 * 设计原则：
 * - 所有同步模式（全量/增量/AMS实时）都必须保证幂等性
 * - 多次手动触发同步不会导致数据重复或累积
 * - 同步锁有超时机制，防止死锁
 */

import * as db from './db';

// ==================== 同步锁管理 ====================

/**
 * 内存级同步锁（单实例部署足够，多实例需改用Redis）
 * key: `sync:${accountId}:${syncType}`
 * value: { lockId, acquiredAt, expiresAt }
 */
interface SyncLock {
  lockId: string;
  accountId: number;
  syncType: string;
  acquiredAt: Date;
  expiresAt: Date;
}

const syncLocks = new Map<string, SyncLock>();

// 锁超时时间（30分钟，足够完成一次完整同步）
const LOCK_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * 生成锁的唯一key
 */
function getLockKey(accountId: number, syncType: string = 'all'): string {
  return `sync:${accountId}:${syncType}`;
}

/**
 * 尝试获取同步锁
 * 
 * @param accountId 账号ID
 * @param syncType 同步类型
 * @returns lockId（成功）或 null（失败，说明有其他同步正在进行）
 */
export function acquireSyncLock(accountId: number, syncType: string = 'all'): string | null {
  const key = getLockKey(accountId, syncType);
  const existing = syncLocks.get(key);
  
  // 检查是否已有锁
  if (existing) {
    // 检查锁是否已超时
    if (new Date() > existing.expiresAt) {
      log.warn(`[SyncLock] 锁已超时，强制释放: ${key} (acquired at ${existing.acquiredAt.toISOString()})`);
      syncLocks.delete(key);
    } else {
      log.info(`[SyncLock] 同步锁被占用: ${key}, 获取于 ${existing.acquiredAt.toISOString()}, 将于 ${existing.expiresAt.toISOString()} 超时`);
      return null;
    }
  }
  
  // 获取新锁
  const lockId = `lock_${accountId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const now = new Date();
  
  syncLocks.set(key, {
    lockId,
    accountId,
    syncType,
    acquiredAt: now,
    expiresAt: new Date(now.getTime() + LOCK_TIMEOUT_MS),
  });
  
  log.info(`[SyncLock] 同步锁已获取: ${key}, lockId=${lockId}`);
  return lockId;
}

/**
 * 释放同步锁
 * 
 * @param accountId 账号ID
 * @param syncType 同步类型
 * @param lockId 锁ID（用于验证释放者身份）
 */
export function releaseSyncLock(accountId: number, syncType: string = 'all', lockId?: string): boolean {
  const key = getLockKey(accountId, syncType);
  const existing = syncLocks.get(key);
  
  if (!existing) {
    return true; // 锁不存在，视为成功
  }
  
  // 如果提供了lockId，验证身份
  if (lockId && existing.lockId !== lockId) {
    log.warn(`[SyncLock] 锁ID不匹配，拒绝释放: expected=${existing.lockId}, got=${lockId}`);
    return false;
  }
  
  syncLocks.delete(key);
  log.info(`[SyncLock] 同步锁已释放: ${key}`);
  return true;
}

/**
 * 检查同步锁状态
 */
export function isSyncLocked(accountId: number, syncType: string = 'all'): boolean {
  const key = getLockKey(accountId, syncType);
  const existing = syncLocks.get(key);
  
  if (!existing) return false;
  
  // 检查是否超时
  if (new Date() > existing.expiresAt) {
    syncLocks.delete(key);
    return false;
  }
  
  return true;
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
 * 
 * @param accountId 账号ID
 * @param startDate 开始日期 (YYYY-MM-DD)
 * @param endDate 结束日期 (YYYY-MM-DD)
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
  } catch (error: any) {
    log.error(`[SyncIdempotency] 清除旧绩效数据失败:`, error);
    // 清除失败不应阻止同步继续，因为upsert本身也能处理
    return 0;
  }
}

// ==================== 带锁的同步执行器 ====================

/**
 * 带幂等性保护的同步执行器
 * 
 * 自动处理：
 * 1. 获取同步锁
 * 2. 执行同步函数
 * 3. 释放同步锁
 * 4. 异常时自动释放锁
 * 
 * @param accountId 账号ID
 * @param syncType 同步类型
 * @param syncFn 实际的同步函数
 * @returns 同步结果，或 null（如果锁被占用）
 */
export async function executeWithIdempotency<T>(
  accountId: number,
  syncType: string,
  syncFn: () => Promise<T>
): Promise<{ success: boolean; result?: T; error?: string; locked?: boolean }> {
  // 1. 尝试获取锁
  const lockId = acquireSyncLock(accountId, syncType);
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
  } catch (error: any) {
    log.error(`[SyncIdempotency] 同步执行失败: accountId=${accountId}, syncType=${syncType}`, error);
    return { success: false, error: error.message };
  } finally {
    // 3. 始终释放锁
    releaseSyncLock(accountId, syncType, lockId);
  }
}
