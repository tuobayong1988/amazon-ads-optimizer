// Extracted from production dist/index.js
// Original module: server/services/adaptiveTimeoutService.ts
// Lines: 327

function getAdaptiveTimeout() {
  if (!globalAdaptiveTimeout) {
    globalAdaptiveTimeout = new AdaptiveTimeoutService();
  }
  return globalAdaptiveTimeout;
}
var log35, DEFAULT_TIMEOUT_CONFIG, DEFAULT_CONCURRENCY_CONFIG, ENDPOINT_TIMEOUT_OVERRIDES, ENDPOINT_CONCURRENCY_OVERRIDES, AdaptiveTimeoutService, globalAdaptiveTimeout;
var init_adaptiveTimeoutService = __esm({
  "server/services/adaptiveTimeoutService.ts"() {
    "use strict";
    init_logger();
    init_systemVersion();
    log35 = createModuleLogger("AdaptiveTimeout");
    DEFAULT_TIMEOUT_CONFIG = {
      windowSize: 100,
      safetyMultiplier: 1.5,
      minTimeoutMs: 30 * 1e3,
      maxTimeoutMs: 15 * 60 * 1e3,
      defaultTimeoutMs: 5 * 60 * 1e3,
      minSamples: 10
    };
    DEFAULT_CONCURRENCY_CONFIG = {
      initialConcurrency: 3,
      minConcurrency: 1,
      maxConcurrency: 10,
      scaleUpThreshold: 0.95,
      scaleDownThreshold: 0.8,
      evaluationWindow: 20,
      scaleUpStep: 1,
      scaleDownStep: 2,
      scaleUpConsecutiveRequired: 3
    };
    ENDPOINT_TIMEOUT_OVERRIDES = {
      report: {
        defaultTimeoutMs: 10 * 60 * 1e3,
        // 报告默认 10 分钟
        maxTimeoutMs: 20 * 60 * 1e3,
        // 报告最大 20 分钟
        safetyMultiplier: 2,
        // 报告波动大，安全系数更高
        minSamples: 5
        // 报告请求量少，更少样本即可
      },
      mutate: {
        defaultTimeoutMs: 60 * 1e3,
        // 写操作默认 1 分钟
        maxTimeoutMs: 5 * 60 * 1e3
        // 写操作最大 5 分钟
      },
      list: {
        defaultTimeoutMs: 2 * 60 * 1e3,
        // 查询默认 2 分钟
        maxTimeoutMs: 10 * 60 * 1e3
        // 查询最大 10 分钟
      }
    };
    ENDPOINT_CONCURRENCY_OVERRIDES = {
      report: {
        initialConcurrency: 2,
        maxConcurrency: 5,
        // 报告端点并发更保守
        scaleDownThreshold: 0.7
      },
      mutate: {
        initialConcurrency: 2,
        maxConcurrency: 6
      }
    };
    AdaptiveTimeoutService = class {
      static {
        __name(this, "AdaptiveTimeoutService");
      }
      latencyWindows = /* @__PURE__ */ new Map();
      concurrencyStates = /* @__PURE__ */ new Map();
      constructor() {
        log35.info(`[v${SYSTEM_VERSION}] AdaptiveTimeout \u521D\u59CB\u5316\u5B8C\u6210`);
      }
      // ==================== 超时管理 ====================
      /**
       * 获取端点的自适应超时时间
       */
      getTimeout(endpointType) {
        const window2 = this.getOrCreateLatencyWindow(endpointType);
        if (window2.samples.length < window2.config.minSamples) {
          return window2.config.defaultTimeoutMs;
        }
        const p99 = this.calculatePercentile(window2.samples, 0.99);
        const adaptiveTimeout = Math.round(p99 * window2.config.safetyMultiplier);
        return Math.max(
          window2.config.minTimeoutMs,
          Math.min(window2.config.maxTimeoutMs, adaptiveTimeout)
        );
      }
      /**
       * 记录请求耗时
       */
      recordLatency(endpointType, latencyMs) {
        const window2 = this.getOrCreateLatencyWindow(endpointType);
        window2.samples.push(latencyMs);
        while (window2.samples.length > window2.config.windowSize) {
          window2.samples.shift();
        }
      }
      /**
       * 获取耗时统计
       */
      getLatencyStats(endpointType) {
        const window2 = this.getOrCreateLatencyWindow(endpointType);
        const samples = window2.samples;
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
            adaptiveTimeoutMs: window2.config.defaultTimeoutMs
          };
        }
        const sorted = [...samples].sort((a, b) => a - b);
        const sum2 = sorted.reduce((a, b) => a + b, 0);
        return {
          endpointType,
          sampleCount: samples.length,
          p50Ms: Math.round(this.calculatePercentile(sorted, 0.5)),
          p90Ms: Math.round(this.calculatePercentile(sorted, 0.9)),
          p99Ms: Math.round(this.calculatePercentile(sorted, 0.99)),
          avgMs: Math.round(sum2 / sorted.length),
          minMs: sorted[0],
          maxMs: sorted[sorted.length - 1],
          adaptiveTimeoutMs: this.getTimeout(endpointType)
        };
      }
      /**
       * 获取所有端点的耗时统计
       */
      getAllLatencyStats() {
        const stats4 = [];
        for (const [endpointType] of this.latencyWindows) {
          stats4.push(this.getLatencyStats(endpointType));
        }
        return stats4;
      }
      // ==================== 并发控制 ====================
      /**
       * 获取当前允许的并发度
       */
      getConcurrency(endpointType) {
        const state = this.getOrCreateConcurrencyState(endpointType);
        return state.currentConcurrency;
      }
      /**
       * 获取当前可用的并发槽位数
       */
      getAvailableSlots(endpointType) {
        const state = this.getOrCreateConcurrencyState(endpointType);
        return Math.max(0, state.currentConcurrency - state.activeTasks);
      }
      /**
       * 尝试获取一个并发槽位
       * @returns true = 获取成功, false = 并发已满
       */
      acquireSlot(endpointType) {
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
      releaseSlot(endpointType, success2) {
        const state = this.getOrCreateConcurrencyState(endpointType);
        state.activeTasks = Math.max(0, state.activeTasks - 1);
        state.evaluationResults.push(success2);
        while (state.evaluationResults.length > state.config.evaluationWindow) {
          state.evaluationResults.shift();
        }
        this.evaluateConcurrency(endpointType, state);
      }
      /**
       * 获取并发控制状态
       */
      getConcurrencyStatus(endpointType) {
        const state = this.getOrCreateConcurrencyState(endpointType);
        const successCount = state.evaluationResults.filter((r) => r).length;
        const successRate = state.evaluationResults.length > 0 ? successCount / state.evaluationResults.length : 1;
        return {
          endpointType,
          currentConcurrency: state.currentConcurrency,
          activeTasks: state.activeTasks,
          successRate,
          consecutiveScaleUpEvals: state.consecutiveScaleUpEvals,
          lastAdjustmentTime: state.lastAdjustmentTime,
          lastAdjustmentReason: state.lastAdjustmentReason
        };
      }
      /**
       * 获取所有端点的并发控制状态
       */
      getAllConcurrencyStatus() {
        const statuses = [];
        for (const [endpointType] of this.concurrencyStates) {
          statuses.push(this.getConcurrencyStatus(endpointType));
        }
        return statuses;
      }
      /**
       * 紧急降低并发度（由熔断器或外部事件触发）
       */
      emergencyScaleDown(endpointType, reason) {
        const state = this.getOrCreateConcurrencyState(endpointType);
        const oldConcurrency = state.currentConcurrency;
        state.currentConcurrency = state.config.minConcurrency;
        state.consecutiveScaleUpEvals = 0;
        state.lastAdjustmentTime = Date.now();
        state.lastAdjustmentReason = `\u7D27\u6025\u964D\u7EA7: ${reason}`;
        log35.warn(`[v${SYSTEM_VERSION}] AdaptiveTimeout [${endpointType}] \u7D27\u6025\u964D\u7EA7\u5E76\u53D1: ${oldConcurrency} \u2192 ${state.currentConcurrency} | ${reason}`);
      }
      // ==================== 内部方法 ====================
      getOrCreateLatencyWindow(endpointType) {
        let window2 = this.latencyWindows.get(endpointType);
        if (!window2) {
          const overrides = ENDPOINT_TIMEOUT_OVERRIDES[endpointType] || {};
          window2 = {
            samples: [],
            config: { ...DEFAULT_TIMEOUT_CONFIG, ...overrides }
          };
          this.latencyWindows.set(endpointType, window2);
        }
        return window2;
      }
      getOrCreateConcurrencyState(endpointType) {
        let state = this.concurrencyStates.get(endpointType);
        if (!state) {
          const overrides = ENDPOINT_CONCURRENCY_OVERRIDES[endpointType] || {};
          const config2 = { ...DEFAULT_CONCURRENCY_CONFIG, ...overrides };
          state = {
            currentConcurrency: config2.initialConcurrency,
            activeTasks: 0,
            evaluationResults: [],
            consecutiveScaleUpEvals: 0,
            lastAdjustmentTime: Date.now(),
            lastAdjustmentReason: "\u521D\u59CB\u5316",
            config: config2
          };
          this.concurrencyStates.set(endpointType, state);
        }
        return state;
      }
      /**
       * 评估并发度是否需要调整
       */
      evaluateConcurrency(endpointType, state) {
        if (state.evaluationResults.length < state.config.evaluationWindow) {
          return;
        }
        const successCount = state.evaluationResults.filter((r) => r).length;
        const successRate = successCount / state.evaluationResults.length;
        if (successRate >= state.config.scaleUpThreshold) {
          state.consecutiveScaleUpEvals++;
          if (state.consecutiveScaleUpEvals >= state.config.scaleUpConsecutiveRequired) {
            const oldConcurrency = state.currentConcurrency;
            state.currentConcurrency = Math.min(
              state.config.maxConcurrency,
              state.currentConcurrency + state.config.scaleUpStep
            );
            if (state.currentConcurrency !== oldConcurrency) {
              state.lastAdjustmentTime = Date.now();
              state.lastAdjustmentReason = `\u6210\u529F\u7387 ${(successRate * 100).toFixed(1)}% \u8FDE\u7EED${state.consecutiveScaleUpEvals}\u6B21\u8FBE\u6807`;
              log35.info(`[v${SYSTEM_VERSION}] AdaptiveTimeout [${endpointType}] \u5E76\u53D1\u63D0\u5347: ${oldConcurrency} \u2192 ${state.currentConcurrency} | ${state.lastAdjustmentReason}`);
            }
            state.consecutiveScaleUpEvals = 0;
          }
        } else if (successRate < state.config.scaleDownThreshold) {
          const oldConcurrency = state.currentConcurrency;
          state.currentConcurrency = Math.max(
            state.config.minConcurrency,
            state.currentConcurrency - state.config.scaleDownStep
          );
          state.consecutiveScaleUpEvals = 0;
          if (state.currentConcurrency !== oldConcurrency) {
            state.lastAdjustmentTime = Date.now();
            state.lastAdjustmentReason = `\u6210\u529F\u7387 ${(successRate * 100).toFixed(1)}% \u4F4E\u4E8E\u9608\u503C ${(state.config.scaleDownThreshold * 100).toFixed(1)}%`;
            log35.warn(`[v${SYSTEM_VERSION}] AdaptiveTimeout [${endpointType}] \u5E76\u53D1\u964D\u7EA7: ${oldConcurrency} \u2192 ${state.currentConcurrency} | ${state.lastAdjustmentReason}`);
          }
        } else {
          state.consecutiveScaleUpEvals = 0;
        }
        state.evaluationResults = [];
      }
      /**
       * 计算百分位数
       */
      calculatePercentile(sortedSamples, percentile) {
        if (sortedSamples.length === 0) return 0;
        if (sortedSamples.length === 1) return sortedSamples[0];
        const sorted = [...sortedSamples].sort((a, b) => a - b);
        const index2 = percentile * (sorted.length - 1);
        const lower = Math.floor(index2);
        const upper = Math.ceil(index2);
        if (lower === upper) return sorted[lower];
        const weight = index2 - lower;
        return sorted[lower] * (1 - weight) + sorted[upper] * weight;
      }
      /**
       * 获取综合健康摘要
       */
      getHealthSummary() {
        const latencyStats = this.getAllLatencyStats();
        const concurrencyStatus = this.getAllConcurrencyStatus();
        const overallHealthy = concurrencyStatus.every(
          (s) => s.currentConcurrency > (ENDPOINT_CONCURRENCY_OVERRIDES[s.endpointType]?.minConcurrency || DEFAULT_CONCURRENCY_CONFIG.minConcurrency)
        );
        return { latencyStats, concurrencyStatus, overallHealthy };
      }
    };
    globalAdaptiveTimeout = null;
    __name(getAdaptiveTimeout, "getAdaptiveTimeout");
  }
});

