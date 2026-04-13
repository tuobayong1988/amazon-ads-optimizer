/**
 * v658: Sync Coordinator - 真正的全局互斥锁实现
 * 
 * 核心原则：稳定性和成功率 > 效率
 * 同一时间只允许一个同步层级运行，彻底消除层级间并发导致的API限流和内存暴涨
 * 
 * 变更历史:
 * - v500: Stub空实现
 * - v658: 实现真正的内存级全局互斥锁 + 内存压力感知 + 同步队列
 */
import { createModuleLogger } from '../utils/logger';
const log = createModuleLogger('SyncCoordinator');

// ==================== 全局互斥锁 ====================
let currentLockHolder: string | null = null;
let lockAcquiredAt: number = 0;
const LOCK_MAX_HOLD_MS = 180 * 60 * 1000; // v660: 锁最大持有时间: 180分钟，匹配大账户全量同步可能的耗时

let manualOverrideActive = false;

/**
 * v658: 获取全局互斥锁
 * 同一时间只允许一个同步层级运行
 */
export async function acquireGlobalMutex(key: string, _ttl?: number): Promise<boolean> {
  // 死锁保护：锁持有超过60分钟，强制释放
  if (currentLockHolder !== null) {
    const holdDuration = Date.now() - lockAcquiredAt;
    if (holdDuration > LOCK_MAX_HOLD_MS) {
      log.warn(`[v658] 全局互斥锁死锁保护: ${currentLockHolder}已持有${Math.round(holdDuration / 60000)}分钟，强制释放`);
      currentLockHolder = null;
      lockAcquiredAt = 0;
    }
  }

  if (currentLockHolder === null) {
    currentLockHolder = key;
    lockAcquiredAt = Date.now();
    log.info(`[v658] 全局互斥锁已获取: ${key}`);
    return true;
  }

  // 同一个key重入，允许
  if (currentLockHolder === key) {
    return true;
  }

  const holdDuration = Math.round((Date.now() - lockAcquiredAt) / 1000);
  log.info(`[v658] 全局互斥锁被拒绝: ${key} 请求锁，但 ${currentLockHolder} 已持有${holdDuration}秒`);
  return false;
}

/**
 * v658: 释放全局互斥锁
 */
export async function releaseGlobalMutex(key: string): Promise<void> {
  if (currentLockHolder === key) {
    const holdDuration = Math.round((Date.now() - lockAcquiredAt) / 1000);
    log.info(`[v658] 全局互斥锁已释放: ${key} (持有${holdDuration}秒)`);
    currentLockHolder = null;
    lockAcquiredAt = 0;
  } else {
    log.warn(`[v658] 释放互斥锁失败: ${key}请求释放，但当前持有者是${currentLockHolder}`);
  }
}

// ==================== 内存压力感知 ====================

export interface MemoryPressureLevel {
  level: 'normal' | 'elevated' | 'high' | 'critical';
  rssMB: number;
  heapUsedMB: number;
  maxConcurrency: number;
  shouldPauseSyncs: boolean;
  shouldForceGC: boolean;
  description: string;
}

/**
 * v658: 检查当前内存压力等级
 * 阈值设计（基于max-old-space-size=6144MB）：
 * - normal (RSS < 800MB): 最多3个用户并行
 * - elevated (800-1500MB): 降低到2个用户并行
 * - high (1500-2500MB): 完全串行(1个用户)
 * - critical (>2500MB): 暂停所有新同步，触发GC
 */
export function checkMemoryPressure(): MemoryPressureLevel {
  const mem = process.memoryUsage();
  const rssMB = Math.round(mem.rss / 1024 / 1024);
  const heapUsedMB = Math.round(mem.heapUsed / 1024 / 1024);

  if (rssMB > 2500) {
    return {
      level: 'critical', rssMB, heapUsedMB,
      maxConcurrency: 0, shouldPauseSyncs: true, shouldForceGC: true,
      description: `内存危急(RSS=${rssMB}MB): 暂停所有新同步，触发GC`,
    };
  }
  if (rssMB > 1500) {
    return {
      level: 'high', rssMB, heapUsedMB,
      maxConcurrency: 1, shouldPauseSyncs: false, shouldForceGC: true,
      description: `内存高压(RSS=${rssMB}MB): 完全串行模式(1用户)，触发GC`,
    };
  }
  if (rssMB > 800) {
    return {
      level: 'elevated', rssMB, heapUsedMB,
      maxConcurrency: 2, shouldPauseSyncs: false, shouldForceGC: false,
      description: `内存轻度压力(RSS=${rssMB}MB): 降低并发到2用户`,
    };
  }
  return {
    level: 'normal', rssMB, heapUsedMB,
    maxConcurrency: 3, shouldPauseSyncs: false, shouldForceGC: false,
    description: `内存正常(RSS=${rssMB}MB): 最多3用户并行`,
  };
}

// ==================== 手动同步覆盖 ====================

export function setManualOverride(active: boolean): void {
  manualOverrideActive = active;
  log.info(`[v658] 手动同步覆盖: ${active ? '激活' : '取消'}`);
}

export function shouldAbortAutoSync(): boolean {
  return manualOverrideActive;
}

export async function cleanupExpiredOverrides(): Promise<void> {
  if (manualOverrideActive) {
    log.info('[v658] 清理过期的手动同步覆盖');
    manualOverrideActive = false;
  }
}

// ==================== 协调器状态 ====================

export function getCoordinatorStatus(): Record<string, unknown> {
  const memPressure = checkMemoryPressure();
  return {
    status: 'active',
    version: 'v658',
    globalMutex: {
      holder: currentLockHolder,
      acquiredAt: lockAcquiredAt > 0 ? new Date(lockAcquiredAt).toISOString() : null,
      holdDurationSec: currentLockHolder ? Math.round((Date.now() - lockAcquiredAt) / 1000) : 0,
    },
    memoryPressure: memPressure,
    manualOverrideActive,
  };
}
