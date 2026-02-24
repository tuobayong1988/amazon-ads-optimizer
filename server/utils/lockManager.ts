/**
 * 账户级模块锁管理器 (v181)
 * 
 * 从 dataSyncScheduler.ts 中提取的独立模块，用于管理账户+模块级别的优化锁。
 * 不同模块类型的优化可以并行执行，只阻塞相同模块的并发操作。
 * 
 * 提取目的：打破 dataSyncScheduler <-> optimizationTargetEngine 的循环依赖。
 */

import { createModuleLogger } from './logger';

const log = createModuleLogger('LockManager');

// 账户+模块级别的锁状态
const accountModuleLocks: Record<string, { locked: boolean; lockedBy: string; lockedAt: Date | null }> = {};

/**
 * 根据模块列表确定锁分组
 * 不同模块类型使用不同的锁分组，允许不同类型的优化并行执行
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
 * @param accountId 账户ID
 * @param lockedBy 锁持有者标识
 * @param moduleGroup 模块分组（可选，默认为'all'）
 * @returns 是否成功获取锁
 */
export function acquireAccountOptimizationLock(accountId: number, lockedBy: string, moduleGroup?: string): boolean {
  const group = moduleGroup || 'all';
  const lockKey = `${accountId}:${group}`;
  
  if (!accountModuleLocks[lockKey]) {
    accountModuleLocks[lockKey] = { locked: false, lockedBy: '', lockedAt: null };
  }
  const lock = accountModuleLocks[lockKey];
  
  if (lock.locked) {
    // 防止死锁 - 如果锁定超过5分钟，强制释放
    if (lock.lockedAt && (Date.now() - lock.lockedAt.getTime()) > 5 * 60 * 1000) {
      log.warn(`[LockManager] ${lockKey} 优化锁超时5分钟，强制释放 (lockedBy: ${lock.lockedBy})`);
    } else {
      log.info(`[LockManager] ${lockKey} 优化锁已被 ${lock.lockedBy} 持有，${lockedBy} 跳过`);
      return false;
    }
  }
  
  lock.locked = true;
  lock.lockedBy = lockedBy;
  lock.lockedAt = new Date();
  return true;
}

/**
 * 释放账户+模块级别的优化锁
 */
export function releaseAccountOptimizationLock(accountId: number, moduleGroup?: string): void {
  const group = moduleGroup || 'all';
  const lockKey = `${accountId}:${group}`;
  if (accountModuleLocks[lockKey]) {
    accountModuleLocks[lockKey].locked = false;
    accountModuleLocks[lockKey].lockedBy = '';
    accountModuleLocks[lockKey].lockedAt = null;
  }
}

/**
 * 带重试的锁获取 - 获取失败时等待后重试
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
      log.debug(`[LockManager] ${accountId}:${moduleGroup || 'all'} 锁被占用，${retryDelayMs / 1000}秒后重试 (${attempt + 1}/${maxRetries})`);
      await new Promise(resolve => setTimeout(resolve, retryDelayMs));
    }
  }
  return false;
}
