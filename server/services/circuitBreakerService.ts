/**
 * v525: 熔断器服务 (Circuit Breaker Service)
 * 
 * 实现标准的三态熔断器模式（Closed → Open → Half-Open），
 * 防止在 Amazon API 故障时产生无效重试和日志风暴。
 * 
 * 设计原则:
 * 1. 按 "账户ID + 端点类型" 维度独立熔断，避免单账户故障影响全局
 * 2. 支持自定义错误率阈值、窗口大小、冷却时间
 * 3. 半开状态下允许少量探针请求通过，自动恢复或重新熔断
 * 4. 与现有 apiRateLimitService 和 amazonApiErrorMapper 无缝集成
 * 5. 提供实时状态查询和手动控制接口
 * 
 * 三态说明:
 * - CLOSED (闭合): 正常状态，所有请求通过，持续监控错误率
 * - OPEN (断开): 熔断状态，所有请求快速失败，等待冷却期结束
 * - HALF_OPEN (半开): 试探状态，允许有限请求通过，根据结果决定恢复或重新熔断
 */

import { createModuleLogger } from '../utils/logger';
import { SYSTEM_VERSION } from '../utils/systemVersion';
import { ApiEndpointType } from './apiRateLimitService';

const log = createModuleLogger('CircuitBreaker');

// ==================== 类型定义 ====================

/** 熔断器状态 */
export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

/** 熔断器配置 */
export interface CircuitBreakerConfig {
  /** 错误率阈值 (0-1)，超过此值触发熔断。默认 0.5 (50%) */
  errorRateThreshold: number;
  /** 滑动窗口大小（请求数），窗口内请求数达到此值后才开始计算错误率。默认 20 */
  windowSize: number;
  /** 熔断冷却时间（毫秒），OPEN 状态持续时间。默认 300000 (5分钟) */
  cooldownMs: number;
  /** HALF_OPEN 状态允许的最大探针请求数。默认 3 */
  halfOpenMaxRequests: number;
  /** HALF_OPEN 状态探针成功率阈值 (0-1)，超过此值恢复 CLOSED。默认 0.8 */
  halfOpenSuccessThreshold: number;
  /** 连续熔断次数递增冷却时间的倍数上限。默认 4 (最大冷却 = cooldownMs * 4) */
  maxCooldownMultiplier: number;
}

/** 熔断器实例状态 */
interface CircuitBreakerInstance {
  /** 当前状态 */
  state: CircuitState;
  /** 滑动窗口：最近 N 次请求的结果 (true=成功, false=失败) */
  window: boolean[];
  /** 窗口内的失败计数（缓存，避免每次遍历） */
  failureCount: number;
  /** 进入 OPEN 状态的时间戳 */
  openedAt: number;
  /** 当前冷却时间（可能因连续熔断而递增） */
  currentCooldownMs: number;
  /** 连续熔断次数 */
  consecutiveOpenCount: number;
  /** HALF_OPEN 状态的探针请求结果 */
  halfOpenResults: boolean[];
  /** 状态变更历史（最近 10 条） */
  stateHistory: Array<{ from: CircuitState; to: CircuitState; timestamp: number; reason: string }>;
  /** 创建时间 */
  createdAt: number;
  /** 最后活动时间 */
  lastActivityAt: number;
}

/** 熔断器状态摘要（用于外部查询） */
export interface CircuitBreakerStatus {
  key: string;
  state: CircuitState;
  errorRate: number;
  windowSize: number;
  failureCount: number;
  successCount: number;
  consecutiveOpenCount: number;
  currentCooldownMs: number;
  openedAt: number | null;
  timeUntilHalfOpen: number | null;
  lastActivityAt: number;
}

// ==================== 默认配置 ====================

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  errorRateThreshold: 0.5,
  windowSize: 20,
  cooldownMs: 2 * 60 * 1000,       // v675: 5分钟→降为2分钟，加快熔断恢复速度，减少雷群效应
  halfOpenMaxRequests: 5,           // v675: 3→5，更快确认恢复状态
  halfOpenSuccessThreshold: 0.8,
  maxCooldownMultiplier: 4,
};

/** 按端点类型的配置覆盖 */
const ENDPOINT_CONFIG_OVERRIDES: Partial<Record<ApiEndpointType, Partial<CircuitBreakerConfig>>> = {
  report: {
    errorRateThreshold: 0.6,        // 报告端点容忍更高错误率（Amazon 报告生成本身不稳定）
    windowSize: 10,                 // 报告请求量少，窗口更小
    cooldownMs: 10 * 60 * 1000,    // 报告端点冷却 10 分钟
  },
  mutate: {
    errorRateThreshold: 0.4,        // 写操作更敏感，阈值更低
    windowSize: 15,
    cooldownMs: 3 * 60 * 1000,     // 写操作冷却 3 分钟
  },
};

// ==================== 熔断器服务主类 ====================

export class CircuitBreakerService {
  private breakers = new Map<string, CircuitBreakerInstance>();
  private config: CircuitBreakerConfig;
  private endpointConfigs: Map<ApiEndpointType, CircuitBreakerConfig>;

  /** 熔断事件回调 */
  private onStateChangeCallback?: (
    key: string,
    from: CircuitState,
    to: CircuitState,
    reason: string
  ) => void;

  constructor(config?: Partial<CircuitBreakerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.endpointConfigs = new Map();

    // 构建端点级配置
    for (const [endpoint, overrides] of Object.entries(ENDPOINT_CONFIG_OVERRIDES)) {
      this.endpointConfigs.set(
        endpoint as ApiEndpointType,
        { ...this.config, ...overrides }
      );
    }

    log.info(`[v${SYSTEM_VERSION}] CircuitBreaker 初始化完成 | 默认阈值=${this.config.errorRateThreshold} | 窗口=${this.config.windowSize} | 冷却=${this.config.cooldownMs}ms`);
  }

  /**
   * 注册状态变更回调
   */
  onStateChange(callback: (key: string, from: CircuitState, to: CircuitState, reason: string) => void): void {
    this.onStateChangeCallback = callback;
  }

  /**
   * 生成熔断器键
   */
  private getKey(accountId: number, endpointType: ApiEndpointType): string {
    return `${accountId}:${endpointType}`;
  }

  /**
   * 获取端点级配置
   */
  private getConfig(endpointType: ApiEndpointType): CircuitBreakerConfig {
    return this.endpointConfigs.get(endpointType) || this.config;
  }

  /**
   * 获取或创建熔断器实例
   */
  private getOrCreateBreaker(key: string, endpointType: ApiEndpointType): CircuitBreakerInstance {
    let breaker = this.breakers.get(key);
    if (!breaker) {
      breaker = {
        state: CircuitState.CLOSED,
        window: [],
        failureCount: 0,
        openedAt: 0,
        currentCooldownMs: this.getConfig(endpointType).cooldownMs,
        consecutiveOpenCount: 0,
        halfOpenResults: [],
        stateHistory: [],
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
      };
      this.breakers.set(key, breaker);
    }
    return breaker;
  }

  /**
   * 检查请求是否允许通过
   * 
   * @returns true = 允许通过, false = 被熔断（快速失败）
   */
  canPass(accountId: number, endpointType: ApiEndpointType): boolean {
    const key = this.getKey(accountId, endpointType);
    const breaker = this.getOrCreateBreaker(key, endpointType);
    const config = this.getConfig(endpointType);
    const now = Date.now();

    breaker.lastActivityAt = now;

    switch (breaker.state) {
      case CircuitState.CLOSED:
        return true;

      case CircuitState.OPEN: {
        // 检查冷却期是否已过
        const elapsed = now - breaker.openedAt;
        if (elapsed >= breaker.currentCooldownMs) {
          // 冷却期结束，进入半开状态
          this.transitionState(key, breaker, CircuitState.HALF_OPEN,
            `冷却期结束 (${Math.round(elapsed / 1000)}s)`);
          breaker.halfOpenResults = [];
          return true;
        }
        // 仍在冷却期，快速失败
        return false;
      }

      case CircuitState.HALF_OPEN: {
        // 半开状态：允许有限的探针请求
        if (breaker.halfOpenResults.length < config.halfOpenMaxRequests) {
          return true;
        }
        // 探针请求数已满，等待评估结果
        return false;
      }

      default:
        return true;
    }
  }

  /**
   * 记录请求成功
   */
  recordSuccess(accountId: number, endpointType: ApiEndpointType): void {
    const key = this.getKey(accountId, endpointType);
    const breaker = this.getOrCreateBreaker(key, endpointType);
    const config = this.getConfig(endpointType);

    breaker.lastActivityAt = Date.now();

    switch (breaker.state) {
      case CircuitState.CLOSED:
        this.addToWindow(breaker, true, config);
        break;

      case CircuitState.HALF_OPEN:
        breaker.halfOpenResults.push(true);
        this.evaluateHalfOpen(key, breaker, config);
        break;

      case CircuitState.OPEN:
        // OPEN 状态不应有请求通过，忽略
        break;
    }
  }

  /**
   * 记录请求失败
   * 
   * @param isTransient 是否为瞬态错误（如网络超时），瞬态错误权重较低
   */
  recordFailure(accountId: number, endpointType: ApiEndpointType, isTransient: boolean = false): void {
    const key = this.getKey(accountId, endpointType);
    const breaker = this.getOrCreateBreaker(key, endpointType);
    const config = this.getConfig(endpointType);

    breaker.lastActivityAt = Date.now();

    switch (breaker.state) {
      case CircuitState.CLOSED:
        this.addToWindow(breaker, false, config);
        this.evaluateClosed(key, breaker, config);
        break;

      case CircuitState.HALF_OPEN:
        breaker.halfOpenResults.push(false);
        this.evaluateHalfOpen(key, breaker, config);
        break;

      case CircuitState.OPEN:
        // OPEN 状态不应有请求通过，忽略
        break;
    }
  }

  /**
   * 向滑动窗口添加结果
   */
  private addToWindow(breaker: CircuitBreakerInstance, success: boolean, config: CircuitBreakerConfig): void {
    breaker.window.push(success);

    if (!success) {
      breaker.failureCount++;
    }

    // 维护窗口大小
    while (breaker.window.length > config.windowSize) {
      const removed = breaker.window.shift();
      if (removed === false) {
        breaker.failureCount--;
      }
    }
  }

  /**
   * 评估 CLOSED 状态是否需要熔断
   */
  private evaluateClosed(key: string, breaker: CircuitBreakerInstance, config: CircuitBreakerConfig): void {
    // 窗口未满时不评估
    if (breaker.window.length < config.windowSize) {
      return;
    }

    const errorRate = breaker.failureCount / breaker.window.length;
    if (errorRate >= config.errorRateThreshold) {
      // 触发熔断
      breaker.consecutiveOpenCount++;

      // 递增冷却时间（连续熔断时加倍，但不超过上限）
      const multiplier = Math.min(breaker.consecutiveOpenCount, config.maxCooldownMultiplier);
      breaker.currentCooldownMs = config.cooldownMs * multiplier;

      this.transitionState(key, breaker, CircuitState.OPEN,
        `错误率 ${(errorRate * 100).toFixed(1)}% 超过阈值 ${(config.errorRateThreshold * 100).toFixed(1)}% | 连续第${breaker.consecutiveOpenCount}次熔断 | 冷却${Math.round(breaker.currentCooldownMs / 1000)}s`);

      breaker.openedAt = Date.now();
      // 清空窗口，为恢复后重新计数
      breaker.window = [];
      breaker.failureCount = 0;
    }
  }

  /**
   * 评估 HALF_OPEN 状态的探针结果
   */
  private evaluateHalfOpen(key: string, breaker: CircuitBreakerInstance, config: CircuitBreakerConfig): void {
    if (breaker.halfOpenResults.length < config.halfOpenMaxRequests) {
      return; // 探针请求还不够，继续等待
    }

    const successCount = breaker.halfOpenResults.filter(r => r).length;
    const successRate = successCount / breaker.halfOpenResults.length;

    if (successRate >= config.halfOpenSuccessThreshold) {
      // 探针成功率达标，恢复正常
      breaker.consecutiveOpenCount = 0;
      breaker.currentCooldownMs = config.cooldownMs;
      this.transitionState(key, breaker, CircuitState.CLOSED,
        `探针成功率 ${(successRate * 100).toFixed(1)}% 达标 | 恢复正常`);
    } else {
      // 探针失败率仍高，重新熔断
      breaker.consecutiveOpenCount++;
      const multiplier = Math.min(breaker.consecutiveOpenCount, config.maxCooldownMultiplier);
      breaker.currentCooldownMs = config.cooldownMs * multiplier;
      breaker.openedAt = Date.now();
      this.transitionState(key, breaker, CircuitState.OPEN,
        `探针成功率 ${(successRate * 100).toFixed(1)}% 未达标 | 重新熔断 | 冷却${Math.round(breaker.currentCooldownMs / 1000)}s`);
    }

    breaker.halfOpenResults = [];
  }

  /**
   * 状态转换
   */
  private transitionState(key: string, breaker: CircuitBreakerInstance, newState: CircuitState, reason: string): void {
    const oldState = breaker.state;
    if (oldState === newState) return;

    breaker.state = newState;

    // 记录状态变更历史
    breaker.stateHistory.push({
      from: oldState,
      to: newState,
      timestamp: Date.now(),
      reason,
    });

    // 保留最近 10 条历史
    if (breaker.stateHistory.length > 10) {
      breaker.stateHistory.shift();
    }

    // 日志记录
    const logLevel = newState === CircuitState.OPEN ? 'warn' : 'info';
    const message = `[v${SYSTEM_VERSION}] CircuitBreaker [${key}] ${oldState} → ${newState} | ${reason}`;
    if (logLevel === 'warn') {
      log.warn(message);
    } else {
      log.info(message);
    }

    // 触发回调
    if (this.onStateChangeCallback) {
      try {
        this.onStateChangeCallback(key, oldState, newState, reason);
      } catch (err) {
        log.error(`[v${SYSTEM_VERSION}] CircuitBreaker 状态变更回调异常:`, err);
      }
    }
  }

  // ==================== 查询与管理接口 ====================

  /**
   * 获取单个熔断器状态
   */
  getStatus(accountId: number, endpointType: ApiEndpointType): CircuitBreakerStatus {
    const key = this.getKey(accountId, endpointType);
    const breaker = this.breakers.get(key);
    const config = this.getConfig(endpointType);

    if (!breaker) {
      return {
        key,
        state: CircuitState.CLOSED,
        errorRate: 0,
        windowSize: 0,
        failureCount: 0,
        successCount: 0,
        consecutiveOpenCount: 0,
        currentCooldownMs: config.cooldownMs,
        openedAt: null,
        timeUntilHalfOpen: null,
        lastActivityAt: 0,
      };
    }

    const errorRate = breaker.window.length > 0
      ? breaker.failureCount / breaker.window.length
      : 0;

    let timeUntilHalfOpen: number | null = null;
    if (breaker.state === CircuitState.OPEN) {
      const elapsed = Date.now() - breaker.openedAt;
      timeUntilHalfOpen = Math.max(0, breaker.currentCooldownMs - elapsed);
    }

    return {
      key,
      state: breaker.state,
      errorRate,
      windowSize: breaker.window.length,
      failureCount: breaker.failureCount,
      successCount: breaker.window.length - breaker.failureCount,
      consecutiveOpenCount: breaker.consecutiveOpenCount,
      currentCooldownMs: breaker.currentCooldownMs,
      openedAt: breaker.state === CircuitState.OPEN ? breaker.openedAt : null,
      timeUntilHalfOpen,
      lastActivityAt: breaker.lastActivityAt,
    };
  }

  /**
   * 获取所有熔断器状态
   */
  getAllStatus(): CircuitBreakerStatus[] {
    const statuses: CircuitBreakerStatus[] = [];
    for (const [key, breaker] of this.breakers.entries()) {
      const parts = key.split(':');
      const accountId = parseInt(parts[0], 10);
      const endpointType = parts[1] as ApiEndpointType;
      statuses.push(this.getStatus(accountId, endpointType));
    }
    return statuses;
  }

  /**
   * 获取当前处于 OPEN 状态的熔断器
   */
  getOpenBreakers(): CircuitBreakerStatus[] {
    return this.getAllStatus().filter(s => s.state === CircuitState.OPEN);
  }

  /**
   * 手动重置熔断器（强制恢复到 CLOSED 状态）
   */
  reset(accountId: number, endpointType: ApiEndpointType): void {
    const key = this.getKey(accountId, endpointType);
    const breaker = this.breakers.get(key);
    if (breaker) {
      const oldState = breaker.state;
      breaker.state = CircuitState.CLOSED;
      breaker.window = [];
      breaker.failureCount = 0;
      breaker.consecutiveOpenCount = 0;
      breaker.currentCooldownMs = this.getConfig(endpointType).cooldownMs;
      breaker.halfOpenResults = [];
      log.info(`[v${SYSTEM_VERSION}] CircuitBreaker [${key}] 手动重置: ${oldState} → CLOSED`);
    }
  }

  /**
   * 手动重置所有熔断器
   */
  resetAll(): void {
    for (const [key] of this.breakers.entries()) {
      const parts = key.split(':');
      const accountId = parseInt(parts[0], 10);
      const endpointType = parts[1] as ApiEndpointType;
      this.reset(accountId, endpointType);
    }
    log.info(`[v${SYSTEM_VERSION}] CircuitBreaker 所有实例已重置`);
  }

  /**
   * 清理长时间不活跃的熔断器实例（释放内存）
   * 建议每 30 分钟调用一次
   */
  cleanup(maxInactiveMs: number = 30 * 60 * 1000): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, breaker] of this.breakers.entries()) {
      if (breaker.state === CircuitState.CLOSED && (now - breaker.lastActivityAt) > maxInactiveMs) {
        this.breakers.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      log.info(`[v${SYSTEM_VERSION}] CircuitBreaker 清理了 ${cleaned} 个不活跃实例, 剩余 ${this.breakers.size} 个`);
    }

    return cleaned;
  }

  /**
   * 获取健康摘要
   */
  getHealthSummary(): {
    total: number;
    closed: number;
    open: number;
    halfOpen: number;
    overallHealthy: boolean;
  } {
    let closed = 0, open = 0, halfOpen = 0;
    for (const breaker of this.breakers.values()) {
      switch (breaker.state) {
        case CircuitState.CLOSED: closed++; break;
        case CircuitState.OPEN: open++; break;
        case CircuitState.HALF_OPEN: halfOpen++; break;
      }
    }
    return {
      total: this.breakers.size,
      closed,
      open,
      halfOpen,
      overallHealthy: open === 0,
    };
  }
}

// ==================== 全局单例 ====================

let globalCircuitBreaker: CircuitBreakerService | null = null;

/**
 * 获取全局熔断器服务实例
 */
export function getCircuitBreaker(): CircuitBreakerService {
  if (!globalCircuitBreaker) {
    globalCircuitBreaker = new CircuitBreakerService();
  }
  return globalCircuitBreaker;
}

/**
 * 初始化全局熔断器服务（可自定义配置）
 */
export function initCircuitBreaker(config?: Partial<CircuitBreakerConfig>): CircuitBreakerService {
  globalCircuitBreaker = new CircuitBreakerService(config);

  // 启动定期清理
  setInterval(() => {
    globalCircuitBreaker?.cleanup();
  }, 30 * 60 * 1000);

  return globalCircuitBreaker;
}
