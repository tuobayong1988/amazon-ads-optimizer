/**
 * v683: Sync Coordinator - 账户级互斥锁 + 主动死锁保护 + 统一锁路径
 * 
 * 核心原则：稳定性和成功率 > 效率
 * 
 * v683 重大重构（基于v682诊断报告）：
 * 1. 【修复1】主动定时器死锁保护 — 每60秒主动检查并释放超时锁，不再依赖被动调用
 * 2. 【修复3】锁粒度细化 — 从层级全局锁改为账户级互斥锁，单个账户同步完成即释放
 *    - 保留轻量级的"层级运行标记"（非互斥锁）用于PostOptVerifier判断
 *    - 账户级锁确保同一账户不会被手动和自动同步同时处理
 * 3. 【修复5】统一手动与自动同步锁路径 — triggerManualFullSync也使用账户级锁
 * 
 * 变更历史:
 * - v500: Stub空实现
 * - v658: 实现真正的内存级全局互斥锁 + 内存压力感知 + 同步队列
 * - v683: 账户级锁 + 主动死锁保护 + 统一锁路径（基于v682诊断报告）
 */
import { createModuleLogger } from '../utils/logger';
const log = createModuleLogger('SyncCoordinator');

// ==================== v683: 账户级互斥锁 ====================

interface AccountLock {
  accountId: number;
  holder: string;       // 'manual' | 'auto_high' | 'auto_medium' | 'auto_full' | 'auto_nightly' 等
  acquiredAt: number;   // Date.now()
  tier: string;         // 同步层级
}

/** v683: 账户级锁映射表 — key为accountId */
const accountLocks = new Map<number, AccountLock>();

/** v683: 账户级锁最大持有时间 — 单个账户同步不应超过30分钟 */
const ACCOUNT_LOCK_MAX_HOLD_MS = 30 * 60 * 1000;

/** v683: 大账户锁最大持有时间 — 大账户全量同步可能需要更长时间 */
const LARGE_ACCOUNT_LOCK_MAX_HOLD_MS = 60 * 60 * 1000;

// ==================== v683: 层级运行标记（轻量级，非互斥锁） ====================

interface TierRunningInfo {
  isRunning: boolean;
  startedAt: number;
  accountCount: number;      // 本轮总账户数
  completedCount: number;    // 已完成账户数
  currentAccountId: number | null;
}

const tierRunningState = new Map<string, TierRunningInfo>();

// ==================== v683: 兼容旧版全局互斥锁接口 ====================
// 保留旧接口签名以确保向后兼容，但内部改为层级运行标记（非阻塞）

let currentLockHolder: string | null = null;
let lockAcquiredAt: number = 0;

// v683: 降低全局锁最大持有时间到45分钟（仅作为兼容层的安全网）
const LOCK_MAX_HOLD_MS = 45 * 60 * 1000;

let manualOverrideActive = false;

/**
 * v683: 获取全局互斥锁（兼容旧接口）
 * 现在改为"层级运行标记"，不再阻塞其他层级
 * 真正的互斥保护在账户级别实现
 */
export async function acquireGlobalMutex(key: string, _ttl?: number): Promise<boolean> {
  // v683: 主动死锁保护 — 检查并释放超时的全局标记
  if (currentLockHolder !== null) {
    const holdDuration = Date.now() - lockAcquiredAt;
    if (holdDuration > LOCK_MAX_HOLD_MS) {
      log.warn(`[v683] 全局标记超时释放: ${currentLockHolder}已持有${Math.round(holdDuration / 60000)}分钟，强制清除`);
      currentLockHolder = null;
      lockAcquiredAt = 0;
    }
  }

  // v683: 全局标记现在是非阻塞的 — 直接设置，不拒绝
  // 如果已有其他层级在运行，仍然允许获取（真正的互斥在账户级别）
  if (currentLockHolder !== null && currentLockHolder !== key) {
    log.info(`[v683] 层级运行标记切换: ${currentLockHolder} → ${key} (旧标记已运行${Math.round((Date.now() - lockAcquiredAt) / 1000)}秒)`);
  }
  
  currentLockHolder = key;
  lockAcquiredAt = Date.now();
  
  // 更新层级运行信息
  if (!tierRunningState.has(key)) {
    tierRunningState.set(key, {
      isRunning: true,
      startedAt: Date.now(),
      accountCount: 0,
      completedCount: 0,
      currentAccountId: null,
    });
  } else {
    const info = tierRunningState.get(key)!;
    info.isRunning = true;
    info.startedAt = Date.now();
  }
  
  log.info(`[v683] 层级运行标记已设置: ${key}`);
  return true;
}

/**
 * v683: 释放全局互斥锁（兼容旧接口）
 */
export async function releaseGlobalMutex(key: string): Promise<void> {
  if (currentLockHolder === key) {
    const holdDuration = Math.round((Date.now() - lockAcquiredAt) / 1000);
    log.info(`[v683] 层级运行标记已清除: ${key} (持有${holdDuration}秒)`);
    currentLockHolder = null;
    lockAcquiredAt = 0;
  }
  
  // 清除层级运行信息
  const info = tierRunningState.get(key);
  if (info) {
    info.isRunning = false;
    info.currentAccountId = null;
  }
}

// ==================== v683: 账户级锁操作 ====================

/**
 * v683: 获取账户级同步锁
 * 确保同一账户不会被多个同步任务同时处理
 * 
 * @param accountId 账户ID
 * @param holder 锁持有者标识（如 'manual', 'auto_high'）
 * @param tier 同步层级
 * @param isLargeAccount 是否为大账户（影响超时时间）
 * @returns true=获取成功, false=账户已被锁定
 */
export function acquireAccountLock(
  accountId: number,
  holder: string,
  tier: string,
  isLargeAccount: boolean = false
): boolean {
  const existing = accountLocks.get(accountId);
  
  if (existing) {
    const holdDuration = Date.now() - existing.acquiredAt;
    const maxHold = isLargeAccount ? LARGE_ACCOUNT_LOCK_MAX_HOLD_MS : ACCOUNT_LOCK_MAX_HOLD_MS;
    
    // 检查是否超时
    if (holdDuration > maxHold) {
      log.warn(`[v683] 账户${accountId}锁超时释放: ${existing.holder}已持有${Math.round(holdDuration / 60000)}分钟，强制释放给${holder}`);
      accountLocks.delete(accountId);
      // 继续获取锁
    } else {
      // 手动同步优先级高于自动同步 — 手动同步可以抢占自动同步的锁
      if (holder === 'manual' && existing.holder !== 'manual') {
        log.info(`[v683] 账户${accountId}: 手动同步抢占自动同步锁 (原持有者: ${existing.holder}, 已持有${Math.round(holdDuration / 1000)}秒)`);
        accountLocks.delete(accountId);
        // 继续获取锁
      } else if (existing.holder === holder) {
        // 同一持有者重入，更新时间
        existing.acquiredAt = Date.now();
        return true;
      } else {
        log.info(`[v683] 账户${accountId}锁被拒绝: ${holder}请求，但${existing.holder}已持有${Math.round(holdDuration / 1000)}秒`);
        return false;
      }
    }
  }
  
  accountLocks.set(accountId, {
    accountId,
    holder,
    acquiredAt: Date.now(),
    tier,
  });
  
  log.debug(`[v683] 账户${accountId}锁已获取: ${holder} (tier=${tier})`);
  return true;
}

/**
 * v683: 释放账户级同步锁
 */
export function releaseAccountLock(accountId: number, holder: string): void {
  const existing = accountLocks.get(accountId);
  if (!existing) {
    return; // 锁不存在，静默返回
  }
  
  if (existing.holder === holder || holder === 'force') {
    const holdDuration = Math.round((Date.now() - existing.acquiredAt) / 1000);
    log.debug(`[v683] 账户${accountId}锁已释放: ${existing.holder} (持有${holdDuration}秒)`);
    accountLocks.delete(accountId);
  } else {
    log.warn(`[v683] 账户${accountId}锁释放失败: ${holder}请求释放，但持有者是${existing.holder}`);
  }
}

/**
 * v683: 检查账户是否被锁定
 */
export function isAccountLocked(accountId: number): boolean {
  const lock = accountLocks.get(accountId);
  if (!lock) return false;
  
  // 检查是否超时（超时的锁视为无效）
  const holdDuration = Date.now() - lock.acquiredAt;
  if (holdDuration > LARGE_ACCOUNT_LOCK_MAX_HOLD_MS) {
    accountLocks.delete(accountId);
    return false;
  }
  
  return true;
}

/**
 * v683: 获取账户锁信息
 */
export function getAccountLockInfo(accountId: number): AccountLock | null {
  return accountLocks.get(accountId) || null;
}

/**
 * v683: 获取所有活跃的账户锁
 */
export function getAllAccountLocks(): AccountLock[] {
  return Array.from(accountLocks.values());
}

/**
 * v683: 更新层级运行进度
 */
export function updateTierProgress(tier: string, accountCount: number, completedCount: number, currentAccountId: number | null): void {
  const info = tierRunningState.get(tier);
  if (info) {
    info.accountCount = accountCount;
    info.completedCount = completedCount;
    info.currentAccountId = currentAccountId;
  }
}

// ==================== v683: 主动定时器死锁保护 ====================

let deadlockWatchdogTimer: NodeJS.Timeout | null = null;

/**
 * v683: 启动死锁保护看门狗
 * 每60秒主动检查所有锁，释放超时的锁
 * 解决v682诊断报告中发现的"死锁保护形同虚设"问题
 */
export function startDeadlockWatchdog(): void {
  if (deadlockWatchdogTimer) {
    clearInterval(deadlockWatchdogTimer);
  }
  
  deadlockWatchdogTimer = setInterval(() => {
    const now = Date.now();
    
    // 1. 检查全局层级标记
    if (currentLockHolder !== null) {
      const holdDuration = now - lockAcquiredAt;
      if (holdDuration > LOCK_MAX_HOLD_MS) {
        log.warn(`[v683-watchdog] 全局标记超时: ${currentLockHolder}已持有${Math.round(holdDuration / 60000)}分钟，强制清除`);
        currentLockHolder = null;
        lockAcquiredAt = 0;
      }
    }
    
    // 2. 检查所有账户级锁
    let expiredCount = 0;
    for (const [accountId, lock] of accountLocks.entries()) {
      const holdDuration = now - lock.acquiredAt;
      const maxHold = LARGE_ACCOUNT_LOCK_MAX_HOLD_MS; // 使用最大阈值
      if (holdDuration > maxHold) {
        log.warn(`[v683-watchdog] 账户${accountId}锁超时: ${lock.holder}已持有${Math.round(holdDuration / 60000)}分钟，强制释放`);
        accountLocks.delete(accountId);
        expiredCount++;
      }
    }
    
    // 3. 检查手动同步覆盖是否过期（超过60分钟自动清除）
    if (manualOverrideActive && manualOverrideStartedAt > 0) {
      const overrideDuration = now - manualOverrideStartedAt;
      if (overrideDuration > 60 * 60 * 1000) {
        log.warn(`[v683-watchdog] 手动同步覆盖超时: 已激活${Math.round(overrideDuration / 60000)}分钟，自动清除`);
        manualOverrideActive = false;
        manualOverrideStartedAt = 0;
      }
    }
    
    // 4. 定期日志输出当前锁状态（每5分钟一次详细日志）
    const activeAccountLocks = accountLocks.size;
    if (activeAccountLocks > 0 || currentLockHolder !== null) {
      const lockSummary = Array.from(accountLocks.entries()).map(([id, l]) => 
        `${id}(${l.holder},${Math.round((now - l.acquiredAt) / 1000)}s)`
      ).join(', ');
      log.info(`[v683-watchdog] 锁状态: 全局=${currentLockHolder || 'none'}, 账户锁=${activeAccountLocks}个${lockSummary ? ': ' + lockSummary : ''}, 手动覆盖=${manualOverrideActive}${expiredCount > 0 ? ', 本轮清理=' + expiredCount + '个' : ''}`);
    }
  }, 60 * 1000); // 每60秒检查一次
  
  log.info('[v683] 死锁保护看门狗已启动 (每60秒检查)');
}

/**
 * v683: 停止死锁保护看门狗
 */
export function stopDeadlockWatchdog(): void {
  if (deadlockWatchdogTimer) {
    clearInterval(deadlockWatchdogTimer);
    deadlockWatchdogTimer = null;
    log.info('[v683] 死锁保护看门狗已停止');
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

let manualOverrideStartedAt: number = 0;

export function setManualOverride(active: boolean): void {
  manualOverrideActive = active;
  manualOverrideStartedAt = active ? Date.now() : 0;
  log.info(`[v683] 手动同步覆盖: ${active ? '激活' : '取消'}`);
}

export function shouldAbortAutoSync(): boolean {
  // v683: 增加超时保护 — 手动覆盖超过60分钟自动失效
  if (manualOverrideActive && manualOverrideStartedAt > 0) {
    const duration = Date.now() - manualOverrideStartedAt;
    if (duration > 60 * 60 * 1000) {
      log.warn(`[v683] 手动同步覆盖超时(${Math.round(duration / 60000)}分钟)，自动清除`);
      manualOverrideActive = false;
      manualOverrideStartedAt = 0;
      return false;
    }
  }
  return manualOverrideActive;
}

export async function cleanupExpiredOverrides(): Promise<void> {
  if (manualOverrideActive) {
    log.info('[v683] 清理过期的手动同步覆盖');
    manualOverrideActive = false;
    manualOverrideStartedAt = 0;
  }
}

// ==================== 同步状态查询 ====================

/**
 * v683: 查询当前是否有同步正在运行（全局级别）
 * 修复：只检查全局层级标记，不再因账户级锁而全局阻塞
 * 账户级锁的检查应使用 isAccountSyncing(accountId)
 */
export function isSyncRunning(): boolean {
  return currentLockHolder !== null;
}

/**
 * v683: 查询特定账户是否正在同步
 * 供PostOptVerifier等模块做账户级延迟判断
 * 只有当该账户被锁定时才返回true，不影响其他账户的验证任务
 */
export function isAccountSyncing(accountId: number): boolean {
  return isAccountLocked(accountId);
}

/**
 * v683: 查询是否有任何同步活动（全局标记或账户锁）
 * 用于需要知道系统是否完全空闲的场景
 */
export function isAnySyncActive(): boolean {
  if (currentLockHolder !== null) return true;
  if (accountLocks.size > 0) return true;
  return false;
}

/**
 * v683: 获取当前同步锁持有者信息（兼容旧接口）
 * 改进：返回更丰富的信息
 */
export function getSyncLockInfo(): { 
  holder: string | null; 
  holdDurationSec: number;
  activeAccountLocks: number;
  lockedAccountIds: number[];
} {
  return {
    holder: currentLockHolder,
    holdDurationSec: currentLockHolder ? Math.round((Date.now() - lockAcquiredAt) / 1000) : 0,
    activeAccountLocks: accountLocks.size,
    lockedAccountIds: Array.from(accountLocks.keys()),
  };
}

// ==================== 协调器状态 ====================

export function getCoordinatorStatus(): Record<string, unknown> {
  const memPressure = checkMemoryPressure();
  const now = Date.now();
  
  return {
    status: 'active',
    version: 'v683',
    globalMutex: {
      holder: currentLockHolder,
      acquiredAt: lockAcquiredAt > 0 ? new Date(lockAcquiredAt).toISOString() : null,
      holdDurationSec: currentLockHolder ? Math.round((now - lockAcquiredAt) / 1000) : 0,
    },
    accountLocks: {
      count: accountLocks.size,
      locks: Array.from(accountLocks.entries()).map(([id, lock]) => ({
        accountId: id,
        holder: lock.holder,
        tier: lock.tier,
        holdDurationSec: Math.round((now - lock.acquiredAt) / 1000),
      })),
    },
    tierProgress: Object.fromEntries(
      Array.from(tierRunningState.entries()).map(([tier, info]) => [tier, {
        isRunning: info.isRunning,
        durationSec: info.isRunning ? Math.round((now - info.startedAt) / 1000) : 0,
        progress: `${info.completedCount}/${info.accountCount}`,
        currentAccountId: info.currentAccountId,
      }])
    ),
    memoryPressure: memPressure,
    manualOverrideActive,
    deadlockWatchdog: deadlockWatchdogTimer !== null ? 'running' : 'stopped',
  };
}
