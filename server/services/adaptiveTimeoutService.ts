/**
 * v525: 自适应超时与动态并发控制服务 (Adaptive Timeout & Dynamic Concurrency Service)
 * 
 * 基于历史请求耗时的 P50/P90/P99 统计，动态调整 API 超时时间，
 * 并根据实时错误率和 429 频率自动调节并发度，实现背压（Backpressure）机制。
 * 
 * 设计原则:
 * 1. 基于滑动窗口的耗时统计，而非静态硬编码超时
 * 2. 超时时间 = P99 * 安全系数，确保覆盖绝大多数正常请求
 * 3. 并发度根据成功率动态调整：成功率高时逐步提升，出现错误时快速降低
 * 4. 按 "端点类型" 维度独立管理，不同类型 API 有不同的超时和并发特征
 * 5. 提供实时监控和手动调整接口
 */

import { createModuleLogger } from '../utils/logger';
import { SYSTEM_VERSION } from '../utils/systemVersion';
import { ApiEndpointType } from './apiRateLimitService';

const log = createModuleLogger('AdaptiveTimeout');

// ==================== 类型定义 ====================

/** 自适应超时配置 */
export interface AdaptiveTimeoutConfig {
  /** 滑动窗口大小（保留最近 N 次请求耗时）。默认 100 */
  windowSize: number;
  /** 超时安全系数（超时 = P99 * safetyMultiplier）。默认 1.5 */
  safetyMultiplier: number;
  /** 最小超时时间（毫秒）。默认 30000 (30秒) */
  minTimeoutMs: number;
  /** 最大超时时间（毫秒）。默认 900000 (15分钟) */
  maxTimeoutMs: number;
  /** 默认超时时间（窗口数据不足时使用）。默认 300000 (5分钟) */
  defaultTimeoutMs: number;
  /** 窗口最小样本数（达到此数量后才开始自适应计算）。默认 10 */
  minSamples: number;
}

/** 动态并发控制配置 */
export interface DynamicConcurrencyConfig {
  /** 初始并发度。默认 3 */
  initialConcurrency: number;
  /** 最小并发度。默认 1 */
  minConcurrency: number;
  /** 最大并发度。默认 10 */
  maxConcurrency: number;
  /** 成功率阈值：高于此值时增加并发。默认 0.95 */
  scaleUpThreshold: number;
  /** 成功率阈值：低于此值时减少并发。默认 0.8 */
  scaleDownThreshold: number;
  /** 并发调整的评估窗口（请求数）。默认 20 */
  evaluationWindow: number;
  /** 并发增加步长。默认 1 */
  scaleUpStep: number;
  /** 并发减少步长。默认 2（快速降低） */
  scaleDownStep: number;
  /** 连续成功评估次数后才增加并发（防止抖动）。默认 3 */
  scaleUpConsecutiveRequired: number;
}

/** 耗时统计摘要 */
export interface LatencyStats {
  endpointType: string;
  sampleCount: number;
  p50Ms: number;
  p90Ms: number;
  p99Ms: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
  adaptiveTimeoutMs: number;
}

/** 并发控制状态 */
export interface ConcurrencyStatus {
  endpointType: string;
  currentConcurrency: number;
  activeTasks: number;
  successRate: number;
  consecutiveScaleUpEvals: number;
  lastAdjustmentTime: number;
  lastAdjustmentReason: string;
}

// ==================== 默认配置 ====================

const DEFAULT_TIMEOUT_CONFIG: AdaptiveTimeoutConfig = {
  windowSize: 100,
  safetyMultiplier: 1.5,
  minTimeoutMs: 30 * 1000,
  maxTimeoutMs: 15 * 60 * 1000,
  defaultTimeoutMs: 5 * 60 * 1000,
  minSamples: 10,
};

const DEFAULT_CONCURRENCY_CONFIG: DynamicConcurrencyConfig = {
  initialConcurrency: 3,
  minConcurrency: 1,
  maxConcurrency: 10,
  scaleUpThreshold: 0.95,
  scaleDownThreshold: 0.8,
  evaluationWindow: 20,
  scaleUpStep: 1,
  scaleDownStep: 2,
  scaleUpConsecutiveRequired: 3,
};

/** 按端点类型的配置覆盖 */
const ENDPOINT_TIMEOUT_OVERRIDES: Partial<Record<ApiEndpointType, Partial<AdaptiveTimeoutConfig>>> = {
  report: {
    defaultTimeoutMs: 10 * 60 * 1000,   // 报告默认 10 分钟
    maxTimeoutMs: 20 * 60 * 1000,       // 报告最大 20 分钟
    safetyMultiplier: 2.0,               // 报告波动大，安全系数更高
    minSamples: 5,                       // 报告请求量少，更少样本即可
  },
  mutate: {
    defaultTimeoutMs: 60 * 1000,         // 写操作默认 1 分钟
    maxTimeoutMs: 5 * 60 * 1000,        // 写操作最大 5 分钟
  },
  list: {
    defaultTimeoutMs: 2 * 60 * 1000,    // 查询默认 2 分钟
    maxTimeoutMs: 10 * 60 * 1000,       // 查询最大 10 分钟
  },
};

const ENDPOINT_CONCURRENCY_OVERRIDES: Partial<Record<ApiEndpointType, Partial<DynamicConcurrencyConfig>>> = {
  report: {
    initialConcurrency: 2,
    maxConcurrency: 5,                   // 报告端点并发更保守
    scaleDownThreshold: 0.7,
  },
  mutate: {
    initialConcurrency: 2,
    maxConcurrency: 6,
  },
};

// ==================== 内部状态 ====================

interface LatencyWindow {
  samples: number[];                     // 耗时样本（毫秒）
  config: AdaptiveTimeoutConfig;
}

interface ConcurrencyState {
  currentConcurrency: number;
  activeTasks: number;
  evaluationResults: boolean[];          // 最近 N 次请求结果
  consecutiveScaleUpEvals: number;
  lastAdjustmentTime: number;
  lastAdjustmentReason: string;
  config: DynamicConcurrencyConfig;
}

// ==================== 自适应超时服务 ====================

export class AdaptiveTimeoutService {
  private latencyWindows = new Map<string, LatencyWindow>();
  private concurrencyStates = new Map<string, ConcurrencyState>();

  constructor() {
    log.info(`[v${SYSTEM_VERSION}] AdaptiveTimeout 初始化完成`);
  }

  // ==================== 超时管理 ====================

  /**
   * 获取端点的自适应超时时间
   */
  getTimeout(endpointType: ApiEndpointType): number {
    const window = this.getOrCreateLatencyWindow(endpointType);

    if (window.samples.length < window.config.minSamples) {
      return window.config.defaultTimeoutMs;
    }

    const p99 = this.calculatePercentile(window.samples, 0.99);
    const adaptiveTimeout = Math.round(p99 * window.config.safetyMultiplier);

    return Math.max(
      window.config.minTimeoutMs,
      Math.min(window.config.maxTimeoutMs, adaptiveTimeout)
    );
  }

  /**
   * 记录请求耗时
   */
  recordLatency(endpointType: ApiEndpointType, latencyMs: number): void {
    const window = this.getOrCreateLatencyWindow(endpointType);

    window.samples.push(latencyMs);

    // 维护窗口大小
    while (window.samples.length > window.config.windowSize) {
      window.samples.shift();
    }
  }

  /**
   * 获取耗时统计
   */
  getLatencyStats(endpointType: ApiEndpointType): LatencyStats {
    const window = this.getOrCreateLatencyWindow(endpointType);
    const samples = window.samples;

    if (samples.length === 0) {
      return {
        endpointType,
        sampleCount: 0,
        p50Ms: 0,
        p90Ms: 0,
        p99Ms: 0,
        avgMs: 0,
        minMs: 0,
        maxMs: 0,
        adaptiveTimeoutMs: window.config.defaultTimeoutMs,
      };
    }

    const sorted = [...samples].sort((a, b) => a - b);
    const sum = sorted.reduce((a, b) => a + b, 0);

    return {
      endpointType,
      sampleCount: samples.length,
      p50Ms: Math.round(this.calculatePercentile(sorted, 0.50)),
      p90Ms: Math.round(this.calculatePercentile(sorted, 0.90)),
      p99Ms: Math.round(this.calculatePercentile(sorted, 0.99)),
      avgMs: Math.round(sum / sorted.length),
      minMs: sorted[0],
      maxMs: sorted[sorted.length - 1],
      adaptiveTimeoutMs: this.getTimeout(endpointType),
    };
  }

  /**
   * 获取所有端点的耗时统计
   */
  getAllLatencyStats(): LatencyStats[] {
    const stats: LatencyStats[] = [];
    for (const [endpointType] of this.latencyWindows) {
      stats.push(this.getLatencyStats(endpointType as ApiEndpointType));
    }
    return stats;
  }

  // ==================== 并发控制 ====================

  /**
   * 获取当前允许的并发度
   */
  getConcurrency(endpointType: ApiEndpointType): number {
    const state = this.getOrCreateConcurrencyState(endpointType);
    return state.currentConcurrency;
  }

  /**
   * 获取当前可用的并发槽位数
   */
  getAvailableSlots(endpointType: ApiEndpointType): number {
    const state = this.getOrCreateConcurrencyState(endpointType);
    return Math.max(0, state.currentConcurrency - state.activeTasks);
  }

  /**
   * 尝试获取一个并发槽位
   * @returns true = 获取成功, false = 并发已满
   */
  acquireSlot(endpointType: ApiEndpointType): boolean {
    const state = this.getOrCreateConcurrencyState(endpointType);
    if (state.activeTasks < state.currentConcurrency) {
      state.activeTasks++;
      return true;
    }
    return false;
  }

  /**
   * 释放一个并发槽位，并记录请求结果
   */
  releaseSlot(endpointType: ApiEndpointType, success: boolean): void {
    const state = this.getOrCreateConcurrencyState(endpointType);
    state.activeTasks = Math.max(0, state.activeTasks - 1);

    // 记录结果到评估窗口
    state.evaluationResults.push(success);
    while (state.evaluationResults.length > state.config.evaluationWindow) {
      state.evaluationResults.shift();
    }

    // 评估是否需要调整并发度
    this.evaluateConcurrency(endpointType, state);
  }

  /**
   * 获取并发控制状态
   */
  getConcurrencyStatus(endpointType: ApiEndpointType): ConcurrencyStatus {
    const state = this.getOrCreateConcurrencyState(endpointType);
    const successCount = state.evaluationResults.filter(r => r).length;
    const successRate = state.evaluationResults.length > 0
      ? successCount / state.evaluationResults.length
      : 1.0;

    return {
      endpointType,
      currentConcurrency: state.currentConcurrency,
      activeTasks: state.activeTasks,
      successRate,
      consecutiveScaleUpEvals: state.consecutiveScaleUpEvals,
      lastAdjustmentTime: state.lastAdjustmentTime,
      lastAdjustmentReason: state.lastAdjustmentReason,
    };
  }

  /**
   * 获取所有端点的并发控制状态
   */
  getAllConcurrencyStatus(): ConcurrencyStatus[] {
    const statuses: ConcurrencyStatus[] = [];
    for (const [endpointType] of this.concurrencyStates) {
      statuses.push(this.getConcurrencyStatus(endpointType as ApiEndpointType));
    }
    return statuses;
  }

  /**
   * 紧急降低并发度（由熔断器或外部事件触发）
   */
  emergencyScaleDown(endpointType: ApiEndpointType, reason: string): void {
    const state = this.getOrCreateConcurrencyState(endpointType);
    const oldConcurrency = state.currentConcurrency;
    state.currentConcurrency = state.config.minConcurrency;
    state.consecutiveScaleUpEvals = 0;
    state.lastAdjustmentTime = Date.now();
    state.lastAdjustmentReason = `紧急降级: ${reason}`;

    log.warn(`[v${SYSTEM_VERSION}] AdaptiveTimeout [${endpointType}] 紧急降级并发: ${oldConcurrency} → ${state.currentConcurrency} | ${reason}`);
  }

  // ==================== 内部方法 ====================

  private getOrCreateLatencyWindow(endpointType: ApiEndpointType): LatencyWindow {
    let window = this.latencyWindows.get(endpointType);
    if (!window) {
      const overrides = ENDPOINT_TIMEOUT_OVERRIDES[endpointType] || {};
      window = {
        samples: [],
        config: { ...DEFAULT_TIMEOUT_CONFIG, ...overrides },
      };
      this.latencyWindows.set(endpointType, window);
    }
    return window;
  }

  private getOrCreateConcurrencyState(endpointType: ApiEndpointType): ConcurrencyState {
    let state = this.concurrencyStates.get(endpointType);
    if (!state) {
      const overrides = ENDPOINT_CONCURRENCY_OVERRIDES[endpointType] || {};
      const config = { ...DEFAULT_CONCURRENCY_CONFIG, ...overrides };
      state = {
        currentConcurrency: config.initialConcurrency,
        activeTasks: 0,
        evaluationResults: [],
        consecutiveScaleUpEvals: 0,
        lastAdjustmentTime: Date.now(),
        lastAdjustmentReason: '初始化',
        config,
      };
      this.concurrencyStates.set(endpointType, state);
    }
    return state;
  }

  /**
   * 评估并发度是否需要调整
   */
  private evaluateConcurrency(endpointType: string, state: ConcurrencyState): void {
    // 评估窗口未满时不调整
    if (state.evaluationResults.length < state.config.evaluationWindow) {
      return;
    }

    const successCount = state.evaluationResults.filter(r => r).length;
    const successRate = successCount / state.evaluationResults.length;

    if (successRate >= state.config.scaleUpThreshold) {
      // 成功率高，考虑增加并发
      state.consecutiveScaleUpEvals++;

      if (state.consecutiveScaleUpEvals >= state.config.scaleUpConsecutiveRequired) {
        const oldConcurrency = state.currentConcurrency;
        state.currentConcurrency = Math.min(
          state.config.maxConcurrency,
          state.currentConcurrency + state.config.scaleUpStep
        );

        if (state.currentConcurrency !== oldConcurrency) {
          state.lastAdjustmentTime = Date.now();
          state.lastAdjustmentReason = `成功率 ${(successRate * 100).toFixed(1)}% 连续${state.consecutiveScaleUpEvals}次达标`;
          log.info(`[v${SYSTEM_VERSION}] AdaptiveTimeout [${endpointType}] 并发提升: ${oldConcurrency} → ${state.currentConcurrency} | ${state.lastAdjustmentReason}`);
        }

        state.consecutiveScaleUpEvals = 0;
      }
    } else if (successRate < state.config.scaleDownThreshold) {
      // 成功率低，快速降低并发
      const oldConcurrency = state.currentConcurrency;
      state.currentConcurrency = Math.max(
        state.config.minConcurrency,
        state.currentConcurrency - state.config.scaleDownStep
      );
      state.consecutiveScaleUpEvals = 0;

      if (state.currentConcurrency !== oldConcurrency) {
        state.lastAdjustmentTime = Date.now();
        state.lastAdjustmentReason = `成功率 ${(successRate * 100).toFixed(1)}% 低于阈值 ${(state.config.scaleDownThreshold * 100).toFixed(1)}%`;
        log.warn(`[v${SYSTEM_VERSION}] AdaptiveTimeout [${endpointType}] 并发降级: ${oldConcurrency} → ${state.currentConcurrency} | ${state.lastAdjustmentReason}`);
      }
    } else {
      // 成功率在中间区间，重置连续计数但不调整
      state.consecutiveScaleUpEvals = 0;
    }

    // 重置评估窗口
    state.evaluationResults = [];
  }

  /**
   * 计算百分位数
   */
  private calculatePercentile(sortedSamples: number[], percentile: number): number {
    if (sortedSamples.length === 0) return 0;
    if (sortedSamples.length === 1) return sortedSamples[0];

    const sorted = [...sortedSamples].sort((a, b) => a - b);
    const index = percentile * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);

    if (lower === upper) return sorted[lower];

    const weight = index - lower;
    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
  }

  /**
   * 获取综合健康摘要
   */
  getHealthSummary(): {
    latencyStats: LatencyStats[];
    concurrencyStatus: ConcurrencyStatus[];
    overallHealthy: boolean;
  } {
    const latencyStats = this.getAllLatencyStats();
    const concurrencyStatus = this.getAllConcurrencyStatus();

    // 如果任何端点并发度降到最低，视为不健康
    const overallHealthy = concurrencyStatus.every(
      s => s.currentConcurrency > (ENDPOINT_CONCURRENCY_OVERRIDES[s.endpointType as ApiEndpointType]?.minConcurrency || DEFAULT_CONCURRENCY_CONFIG.minConcurrency)
    );

    return { latencyStats, concurrencyStatus, overallHealthy };
  }
}

// ==================== 全局单例 ====================

let globalAdaptiveTimeout: AdaptiveTimeoutService | null = null;

/**
 * 获取全局自适应超时服务实例
 */
export function getAdaptiveTimeout(): AdaptiveTimeoutService {
  if (!globalAdaptiveTimeout) {
    globalAdaptiveTimeout = new AdaptiveTimeoutService();
  }
  return globalAdaptiveTimeout;
}

/**
 * 初始化全局自适应超时服务
 */
export function initAdaptiveTimeout(): AdaptiveTimeoutService {
  globalAdaptiveTimeout = new AdaptiveTimeoutService();
  return globalAdaptiveTimeout;
}
