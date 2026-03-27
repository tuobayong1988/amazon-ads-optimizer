/**
 * v525: 舱壁隔离服务 (Bulkhead Isolation Service)
 * 
 * 为不同层级的账户和不同类型的任务分配独立的资源池，
 * 防止单一异常账户或任务类型拖垮全局系统。
 * 
 * 设计原则:
 * 1. 按 "账户层级" 隔离：VIP/标准/试用账户各有独立的并发池
 * 2. 按 "任务类型" 隔离：同步/优化/报告各有独立的资源配额
 * 3. 支持优先级队列：高优先级任务可以抢占低优先级的资源
 * 4. 异常账户自动降级：连续失败的账户自动降低资源配额
 * 5. 提供实时监控和手动调整接口
 * 
 * 舱壁维度:
 * - AccountTier: 按账户层级分配资源池 (vip / standard / trial)
 * - TaskCategory: 按任务类别分配资源池 (sync / optimization / report / alignment)
 * - AccountHealth: 按账户健康度动态调整配额 (healthy / degraded / quarantined)
 */

import { createModuleLogger } from '../utils/logger';
import { SYSTEM_VERSION } from '../utils/systemVersion';

const log = createModuleLogger('Bulkhead');

// ==================== 类型定义 ====================

/** 账户层级 */
export type AccountTier = 'vip' | 'standard' | 'trial';

/** 任务类别 */
export type TaskCategory = 'sync' | 'optimization' | 'report' | 'alignment';

/** 账户健康状态 */
export type AccountHealth = 'healthy' | 'degraded' | 'quarantined';

/** 舱壁配置 */
export interface BulkheadConfig {
  /** 最大并发任务数 */
  maxConcurrency: number;
  /** 等待队列最大长度 */
  maxQueueSize: number;
  /** 队列等待超时（毫秒） */
  queueTimeoutMs: number;
}

/** 舱壁运行时状态 */
interface BulkheadState {
  config: BulkheadConfig;
  activeTasks: number;
  queue: Array<{
    resolve: (value: boolean) => void;
    enqueueTime: number;
    label: string;
  }>;
  totalProcessed: number;
  totalRejected: number;
  totalTimedOut: number;
}

/** 账户健康跟踪 */
interface AccountHealthState {
  health: AccountHealth;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  lastFailureTime: number;
  lastSuccessTime: number;
  degradedAt: number;
  quarantinedAt: number;
  /** 降级/隔离原因 */
  reason: string;
}

/** 舱壁状态摘要 */
export interface BulkheadStatus {
  key: string;
  maxConcurrency: number;
  activeTasks: number;
  queueLength: number;
  maxQueueSize: number;
  totalProcessed: number;
  totalRejected: number;
  totalTimedOut: number;
  utilization: number;
}

/** 账户健康摘要 */
export interface AccountHealthStatus {
  accountId: number;
  health: AccountHealth;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  reason: string;
  effectiveTier: AccountTier;
}

// ==================== 默认配置 ====================

/** 按账户层级的默认舱壁配置 */
const TIER_CONFIGS: Record<AccountTier, BulkheadConfig> = {
  vip: {
    maxConcurrency: 5,
    maxQueueSize: 20,
    queueTimeoutMs: 60000,
  },
  standard: {
    maxConcurrency: 3,
    maxQueueSize: 15,
    queueTimeoutMs: 45000,
  },
  trial: {
    maxConcurrency: 1,
    maxQueueSize: 5,
    queueTimeoutMs: 30000,
  },
};

/** 按任务类别的默认舱壁配置 */
const CATEGORY_CONFIGS: Record<TaskCategory, BulkheadConfig> = {
  sync: {
    maxConcurrency: 4,
    maxQueueSize: 30,
    queueTimeoutMs: 120000,
  },
  optimization: {
    maxConcurrency: 3,
    maxQueueSize: 50,
    queueTimeoutMs: 60000,
  },
  report: {
    maxConcurrency: 2,
    maxQueueSize: 10,
    queueTimeoutMs: 300000,
  },
  alignment: {
    maxConcurrency: 1,
    maxQueueSize: 5,
    queueTimeoutMs: 60000,
  },
};

/** 账户健康状态阈值 */
const HEALTH_THRESHOLDS = {
  /** 连续失败次数达到此值时降级 */
  degradeAfterFailures: 5,
  /** 连续失败次数达到此值时隔离 */
  quarantineAfterFailures: 15,
  /** 连续成功次数达到此值时恢复 */
  recoverAfterSuccesses: 10,
  /** 隔离最短持续时间（毫秒） */
  minQuarantineDurationMs: 10 * 60 * 1000,  // 10 分钟
  /** 降级时并发度缩减系数 */
  degradedConcurrencyFactor: 0.5,
  /** 隔离时并发度缩减系数 */
  quarantinedConcurrencyFactor: 0.2,
};

// ==================== 舱壁隔离服务 ====================

export class BulkheadService {
  /** 按 "层级:类别" 组合键的舱壁池 */
  private bulkheads = new Map<string, BulkheadState>();
  /** 账户健康状态跟踪 */
  private accountHealth = new Map<number, AccountHealthState>();
  /** 账户层级映射（由外部注入） */
  private accountTiers = new Map<number, AccountTier>();

  constructor() {
    log.info(`[v${SYSTEM_VERSION}] Bulkhead 初始化完成 | 层级配置: VIP=${TIER_CONFIGS.vip.maxConcurrency}, Standard=${TIER_CONFIGS.standard.maxConcurrency}, Trial=${TIER_CONFIGS.trial.maxConcurrency}`);

    // 启动队列超时清理定时器
    setInterval(() => this.cleanupTimedOutQueue(), 10000);
  }

  // ==================== 账户层级管理 ====================

  /**
   * 注册账户层级
   */
  setAccountTier(accountId: number, tier: AccountTier): void {
    this.accountTiers.set(accountId, tier);
  }

  /**
   * 批量注册账户层级
   */
  setAccountTiers(tiers: Map<number, AccountTier>): void {
    for (const [accountId, tier] of tiers) {
      this.accountTiers.set(accountId, tier);
    }
  }

  /**
   * 获取账户的有效层级（考虑健康状态降级）
   */
  getEffectiveTier(accountId: number): AccountTier {
    const baseTier = this.accountTiers.get(accountId) || 'standard';
    const healthState = this.accountHealth.get(accountId);

    if (!healthState) return baseTier;

    // 隔离状态的账户降级到 trial
    if (healthState.health === 'quarantined') {
      return 'trial';
    }

    // 降级状态的账户降一级
    if (healthState.health === 'degraded') {
      if (baseTier === 'vip') return 'standard';
      return 'trial';
    }

    return baseTier;
  }

  // ==================== 资源获取与释放 ====================

  /**
   * 获取舱壁键
   */
  private getBulkheadKey(tier: AccountTier, category: TaskCategory): string {
    return `${tier}:${category}`;
  }

  /**
   * 获取或创建舱壁实例
   */
  private getOrCreateBulkhead(tier: AccountTier, category: TaskCategory): BulkheadState {
    const key = this.getBulkheadKey(tier, category);
    let bulkhead = this.bulkheads.get(key);

    if (!bulkhead) {
      const tierConfig = TIER_CONFIGS[tier];
      const categoryConfig = CATEGORY_CONFIGS[category];

      // 合并配置：取两者中较小的并发度
      const config: BulkheadConfig = {
        maxConcurrency: Math.min(tierConfig.maxConcurrency, categoryConfig.maxConcurrency),
        maxQueueSize: Math.min(tierConfig.maxQueueSize, categoryConfig.maxQueueSize),
        queueTimeoutMs: Math.min(tierConfig.queueTimeoutMs, categoryConfig.queueTimeoutMs),
      };

      bulkhead = {
        config,
        activeTasks: 0,
        queue: [],
        totalProcessed: 0,
        totalRejected: 0,
        totalTimedOut: 0,
      };
      this.bulkheads.set(key, bulkhead);
    }

    return bulkhead;
  }

  /**
   * 获取有效的最大并发度（考虑账户健康状态）
   */
  private getEffectiveMaxConcurrency(accountId: number, bulkhead: BulkheadState): number {
    const healthState = this.accountHealth.get(accountId);
    if (!healthState) return bulkhead.config.maxConcurrency;

    let factor = 1.0;
    if (healthState.health === 'degraded') {
      factor = HEALTH_THRESHOLDS.degradedConcurrencyFactor;
    } else if (healthState.health === 'quarantined') {
      factor = HEALTH_THRESHOLDS.quarantinedConcurrencyFactor;
    }

    return Math.max(1, Math.floor(bulkhead.config.maxConcurrency * factor));
  }

  /**
   * 尝试获取资源槽位
   * 
   * @param accountId 账户 ID
   * @param category 任务类别
   * @param label 任务标签（用于日志）
   * @param wait 是否等待（排队）
   * @returns true = 获取成功, false = 被拒绝
   */
  async acquire(
    accountId: number,
    category: TaskCategory,
    label: string = '',
    wait: boolean = true
  ): Promise<boolean> {
    const effectiveTier = this.getEffectiveTier(accountId);
    const bulkhead = this.getOrCreateBulkhead(effectiveTier, category);
    const effectiveMax = this.getEffectiveMaxConcurrency(accountId, bulkhead);

    // 有空闲槽位，直接获取
    if (bulkhead.activeTasks < effectiveMax) {
      bulkhead.activeTasks++;
      bulkhead.totalProcessed++;
      return true;
    }

    // 不等待模式，直接拒绝
    if (!wait) {
      bulkhead.totalRejected++;
      log.debug(`[v${SYSTEM_VERSION}] Bulkhead [${effectiveTier}:${category}] 拒绝 ${label} | 活跃=${bulkhead.activeTasks}/${effectiveMax}`);
      return false;
    }

    // 队列已满，拒绝
    if (bulkhead.queue.length >= bulkhead.config.maxQueueSize) {
      bulkhead.totalRejected++;
      log.warn(`[v${SYSTEM_VERSION}] Bulkhead [${effectiveTier}:${category}] 队列已满, 拒绝 ${label} | 队列=${bulkhead.queue.length}/${bulkhead.config.maxQueueSize}`);
      return false;
    }

    // 进入等待队列
    return new Promise<boolean>((resolve) => {
      bulkhead.queue.push({
        resolve,
        enqueueTime: Date.now(),
        label,
      });
    });
  }

  /**
   * 释放资源槽位
   */
  release(accountId: number, category: TaskCategory): void {
    const effectiveTier = this.getEffectiveTier(accountId);
    const key = this.getBulkheadKey(effectiveTier, category);
    const bulkhead = this.bulkheads.get(key);

    if (!bulkhead) return;

    bulkhead.activeTasks = Math.max(0, bulkhead.activeTasks - 1);

    // 尝试从队列中取出下一个等待者
    this.drainQueue(bulkhead, accountId);
  }

  /**
   * 从队列中取出等待者
   */
  private drainQueue(bulkhead: BulkheadState, accountId: number): void {
    const effectiveMax = this.getEffectiveMaxConcurrency(accountId, bulkhead);

    while (bulkhead.queue.length > 0 && bulkhead.activeTasks < effectiveMax) {
      const waiter = bulkhead.queue.shift();
      if (waiter) {
        bulkhead.activeTasks++;
        bulkhead.totalProcessed++;
        waiter.resolve(true);
      }
    }
  }

  /**
   * 清理超时的队列等待者
   */
  private cleanupTimedOutQueue(): void {
    const now = Date.now();

    for (const [key, bulkhead] of this.bulkheads.entries()) {
      const timedOut: number[] = [];

      for (let i = bulkhead.queue.length - 1; i >= 0; i--) {
        const waiter = bulkhead.queue[i];
        if (now - waiter.enqueueTime > bulkhead.config.queueTimeoutMs) {
          timedOut.push(i);
        }
      }

      for (const idx of timedOut) {
        const waiter = bulkhead.queue.splice(idx, 1)[0];
        if (waiter) {
          bulkhead.totalTimedOut++;
          waiter.resolve(false);
          log.warn(`[v${SYSTEM_VERSION}] Bulkhead [${key}] 队列超时: ${waiter.label} (等待${Math.round((now - waiter.enqueueTime) / 1000)}s)`);
        }
      }
    }
  }

  // ==================== 账户健康管理 ====================

  /**
   * 记录账户任务成功
   */
  recordAccountSuccess(accountId: number): void {
    const state = this.getOrCreateHealthState(accountId);
    state.consecutiveSuccesses++;
    state.consecutiveFailures = 0;
    state.lastSuccessTime = Date.now();

    // 检查是否可以恢复
    if (state.health !== 'healthy' && state.consecutiveSuccesses >= HEALTH_THRESHOLDS.recoverAfterSuccesses) {
      // 隔离状态需要等待最短隔离时间
      if (state.health === 'quarantined') {
        const elapsed = Date.now() - state.quarantinedAt;
        if (elapsed < HEALTH_THRESHOLDS.minQuarantineDurationMs) {
          return; // 隔离时间未到
        }
      }

      const oldHealth = state.health;
      // 逐级恢复：quarantined → degraded → healthy
      if (state.health === 'quarantined') {
        state.health = 'degraded';
        state.consecutiveSuccesses = 0;
        log.info(`[v${SYSTEM_VERSION}] Bulkhead 账户${accountId} 健康恢复: ${oldHealth} → degraded`);
      } else {
        state.health = 'healthy';
        state.reason = '';
        log.info(`[v${SYSTEM_VERSION}] Bulkhead 账户${accountId} 健康恢复: ${oldHealth} → healthy`);
      }
    }
  }

  /**
   * 记录账户任务失败
   */
  recordAccountFailure(accountId: number, reason: string = ''): void {
    const state = this.getOrCreateHealthState(accountId);
    state.consecutiveFailures++;
    state.consecutiveSuccesses = 0;
    state.lastFailureTime = Date.now();

    if (state.health === 'healthy' && state.consecutiveFailures >= HEALTH_THRESHOLDS.degradeAfterFailures) {
      state.health = 'degraded';
      state.degradedAt = Date.now();
      state.reason = reason || `连续失败${state.consecutiveFailures}次`;
      log.warn(`[v${SYSTEM_VERSION}] Bulkhead 账户${accountId} 降级: healthy → degraded | ${state.reason}`);
    } else if (state.health === 'degraded' && state.consecutiveFailures >= HEALTH_THRESHOLDS.quarantineAfterFailures) {
      state.health = 'quarantined';
      state.quarantinedAt = Date.now();
      state.reason = reason || `连续失败${state.consecutiveFailures}次`;
      log.warn(`[v${SYSTEM_VERSION}] Bulkhead 账户${accountId} 隔离: degraded → quarantined | ${state.reason}`);
    }
  }

  /**
   * 获取账户健康状态
   */
  getAccountHealth(accountId: number): AccountHealthStatus {
    const state = this.accountHealth.get(accountId);
    return {
      accountId,
      health: state?.health || 'healthy',
      consecutiveFailures: state?.consecutiveFailures || 0,
      consecutiveSuccesses: state?.consecutiveSuccesses || 0,
      reason: state?.reason || '',
      effectiveTier: this.getEffectiveTier(accountId),
    };
  }

  /**
   * 手动恢复账户健康状态
   */
  resetAccountHealth(accountId: number): void {
    this.accountHealth.delete(accountId);
    log.info(`[v${SYSTEM_VERSION}] Bulkhead 账户${accountId} 健康状态已手动重置`);
  }

  private getOrCreateHealthState(accountId: number): AccountHealthState {
    let state = this.accountHealth.get(accountId);
    if (!state) {
      state = {
        health: 'healthy',
        consecutiveFailures: 0,
        consecutiveSuccesses: 0,
        lastFailureTime: 0,
        lastSuccessTime: 0,
        degradedAt: 0,
        quarantinedAt: 0,
        reason: '',
      };
      this.accountHealth.set(accountId, state);
    }
    return state;
  }

  // ==================== 查询接口 ====================

  /**
   * 获取所有舱壁状态
   */
  getAllStatus(): BulkheadStatus[] {
    const statuses: BulkheadStatus[] = [];
    for (const [key, bulkhead] of this.bulkheads.entries()) {
      statuses.push({
        key,
        maxConcurrency: bulkhead.config.maxConcurrency,
        activeTasks: bulkhead.activeTasks,
        queueLength: bulkhead.queue.length,
        maxQueueSize: bulkhead.config.maxQueueSize,
        totalProcessed: bulkhead.totalProcessed,
        totalRejected: bulkhead.totalRejected,
        totalTimedOut: bulkhead.totalTimedOut,
        utilization: bulkhead.config.maxConcurrency > 0
          ? bulkhead.activeTasks / bulkhead.config.maxConcurrency
          : 0,
      });
    }
    return statuses;
  }

  /**
   * 获取所有不健康的账户
   */
  getUnhealthyAccounts(): AccountHealthStatus[] {
    const unhealthy: AccountHealthStatus[] = [];
    for (const [accountId, state] of this.accountHealth.entries()) {
      if (state.health !== 'healthy') {
        unhealthy.push(this.getAccountHealth(accountId));
      }
    }
    return unhealthy;
  }

  /**
   * 获取健康摘要
   */
  getHealthSummary(): {
    totalBulkheads: number;
    totalActiveTasks: number;
    totalQueuedTasks: number;
    totalRejected: number;
    unhealthyAccounts: number;
    quarantinedAccounts: number;
  } {
    let totalActiveTasks = 0, totalQueuedTasks = 0, totalRejected = 0;
    for (const bulkhead of this.bulkheads.values()) {
      totalActiveTasks += bulkhead.activeTasks;
      totalQueuedTasks += bulkhead.queue.length;
      totalRejected += bulkhead.totalRejected;
    }

    let unhealthyAccounts = 0, quarantinedAccounts = 0;
    for (const state of this.accountHealth.values()) {
      if (state.health !== 'healthy') unhealthyAccounts++;
      if (state.health === 'quarantined') quarantinedAccounts++;
    }

    return {
      totalBulkheads: this.bulkheads.size,
      totalActiveTasks,
      totalQueuedTasks,
      totalRejected,
      unhealthyAccounts,
      quarantinedAccounts,
    };
  }
}

// ==================== 全局单例 ====================

let globalBulkhead: BulkheadService | null = null;

/**
 * 获取全局舱壁隔离服务实例
 */
export function getBulkhead(): BulkheadService {
  if (!globalBulkhead) {
    globalBulkhead = new BulkheadService();
  }
  return globalBulkhead;
}

/**
 * 初始化全局舱壁隔离服务
 */
export function initBulkhead(): BulkheadService {
  globalBulkhead = new BulkheadService();
  return globalBulkhead;
}
