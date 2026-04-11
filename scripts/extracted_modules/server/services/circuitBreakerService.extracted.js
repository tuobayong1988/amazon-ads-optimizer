// Extracted from production dist/index.js
// Original module: server/services/circuitBreakerService.ts
// Lines: 422

function getCircuitBreaker() {
  if (!globalCircuitBreaker) {
    globalCircuitBreaker = new CircuitBreakerService();
  }
  return globalCircuitBreaker;
}
var log21, DEFAULT_CONFIG2, ENDPOINT_CONFIG_OVERRIDES, CircuitBreakerService, globalCircuitBreaker;
var init_circuitBreakerService = __esm({
  "server/services/circuitBreakerService.ts"() {
    "use strict";
    init_logger();
    init_systemVersion();
    log21 = createModuleLogger("CircuitBreaker");
    DEFAULT_CONFIG2 = {
      errorRateThreshold: 0.5,
      windowSize: 20,
      cooldownMs: 5 * 60 * 1e3,
      // 5 分钟
      halfOpenMaxRequests: 3,
      halfOpenSuccessThreshold: 0.8,
      maxCooldownMultiplier: 4
    };
    ENDPOINT_CONFIG_OVERRIDES = {
      report: {
        errorRateThreshold: 0.6,
        // 报告端点容忍更高错误率（Amazon 报告生成本身不稳定）
        windowSize: 10,
        // 报告请求量少，窗口更小
        cooldownMs: 10 * 60 * 1e3
        // 报告端点冷却 10 分钟
      },
      mutate: {
        errorRateThreshold: 0.4,
        // 写操作更敏感，阈值更低
        windowSize: 15,
        cooldownMs: 3 * 60 * 1e3
        // 写操作冷却 3 分钟
      }
    };
    CircuitBreakerService = class {
      static {
        __name(this, "CircuitBreakerService");
      }
      breakers = /* @__PURE__ */ new Map();
      config;
      endpointConfigs;
      /** 熔断事件回调 */
      onStateChangeCallback;
      constructor(config2) {
        this.config = { ...DEFAULT_CONFIG2, ...config2 };
        this.endpointConfigs = /* @__PURE__ */ new Map();
        for (const [endpoint, overrides] of Object.entries(ENDPOINT_CONFIG_OVERRIDES)) {
          this.endpointConfigs.set(
            endpoint,
            { ...this.config, ...overrides }
          );
        }
        log21.info(`[v${SYSTEM_VERSION}] CircuitBreaker \u521D\u59CB\u5316\u5B8C\u6210 | \u9ED8\u8BA4\u9608\u503C=${this.config.errorRateThreshold} | \u7A97\u53E3=${this.config.windowSize} | \u51B7\u5374=${this.config.cooldownMs}ms`);
      }
      /**
       * 注册状态变更回调
       */
      onStateChange(callback) {
        this.onStateChangeCallback = callback;
      }
      /**
       * 生成熔断器键
       */
      getKey(accountId, endpointType) {
        return `${accountId}:${endpointType}`;
      }
      /**
       * 获取端点级配置
       */
      getConfig(endpointType) {
        return this.endpointConfigs.get(endpointType) || this.config;
      }
      /**
       * 获取或创建熔断器实例
       */
      getOrCreateBreaker(key, endpointType) {
        let breaker = this.breakers.get(key);
        if (!breaker) {
          breaker = {
            state: "CLOSED" /* CLOSED */,
            window: [],
            failureCount: 0,
            openedAt: 0,
            currentCooldownMs: this.getConfig(endpointType).cooldownMs,
            consecutiveOpenCount: 0,
            halfOpenResults: [],
            stateHistory: [],
            createdAt: Date.now(),
            lastActivityAt: Date.now()
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
      canPass(accountId, endpointType) {
        const key = this.getKey(accountId, endpointType);
        const breaker = this.getOrCreateBreaker(key, endpointType);
        const config2 = this.getConfig(endpointType);
        const now = Date.now();
        breaker.lastActivityAt = now;
        switch (breaker.state) {
          case "CLOSED" /* CLOSED */:
            return true;
          case "OPEN" /* OPEN */: {
            const elapsed = now - breaker.openedAt;
            if (elapsed >= breaker.currentCooldownMs) {
              this.transitionState(
                key,
                breaker,
                "HALF_OPEN" /* HALF_OPEN */,
                `\u51B7\u5374\u671F\u7ED3\u675F (${Math.round(elapsed / 1e3)}s)`
              );
              breaker.halfOpenResults = [];
              return true;
            }
            return false;
          }
          case "HALF_OPEN" /* HALF_OPEN */: {
            if (breaker.halfOpenResults.length < config2.halfOpenMaxRequests) {
              return true;
            }
            return false;
          }
          default:
            return true;
        }
      }
      /**
       * 记录请求成功
       */
      recordSuccess(accountId, endpointType) {
        const key = this.getKey(accountId, endpointType);
        const breaker = this.getOrCreateBreaker(key, endpointType);
        const config2 = this.getConfig(endpointType);
        breaker.lastActivityAt = Date.now();
        switch (breaker.state) {
          case "CLOSED" /* CLOSED */:
            this.addToWindow(breaker, true, config2);
            break;
          case "HALF_OPEN" /* HALF_OPEN */:
            breaker.halfOpenResults.push(true);
            this.evaluateHalfOpen(key, breaker, config2);
            break;
          case "OPEN" /* OPEN */:
            break;
        }
      }
      /**
       * 记录请求失败
       * 
       * @param isTransient 是否为瞬态错误（如网络超时），瞬态错误权重较低
       */
      recordFailure(accountId, endpointType, isTransient = false) {
        const key = this.getKey(accountId, endpointType);
        const breaker = this.getOrCreateBreaker(key, endpointType);
        const config2 = this.getConfig(endpointType);
        breaker.lastActivityAt = Date.now();
        switch (breaker.state) {
          case "CLOSED" /* CLOSED */:
            this.addToWindow(breaker, false, config2);
            this.evaluateClosed(key, breaker, config2);
            break;
          case "HALF_OPEN" /* HALF_OPEN */:
            breaker.halfOpenResults.push(false);
            this.evaluateHalfOpen(key, breaker, config2);
            break;
          case "OPEN" /* OPEN */:
            break;
        }
      }
      /**
       * 向滑动窗口添加结果
       */
      addToWindow(breaker, success2, config2) {
        breaker.window.push(success2);
        if (!success2) {
          breaker.failureCount++;
        }
        while (breaker.window.length > config2.windowSize) {
          const removed = breaker.window.shift();
          if (removed === false) {
            breaker.failureCount--;
          }
        }
      }
      /**
       * 评估 CLOSED 状态是否需要熔断
       */
      evaluateClosed(key, breaker, config2) {
        if (breaker.window.length < config2.windowSize) {
          return;
        }
        const errorRate = breaker.failureCount / breaker.window.length;
        if (errorRate >= config2.errorRateThreshold) {
          breaker.consecutiveOpenCount++;
          const multiplier = Math.min(breaker.consecutiveOpenCount, config2.maxCooldownMultiplier);
          breaker.currentCooldownMs = config2.cooldownMs * multiplier;
          this.transitionState(
            key,
            breaker,
            "OPEN" /* OPEN */,
            `\u9519\u8BEF\u7387 ${(errorRate * 100).toFixed(1)}% \u8D85\u8FC7\u9608\u503C ${(config2.errorRateThreshold * 100).toFixed(1)}% | \u8FDE\u7EED\u7B2C${breaker.consecutiveOpenCount}\u6B21\u7194\u65AD | \u51B7\u5374${Math.round(breaker.currentCooldownMs / 1e3)}s`
          );
          breaker.openedAt = Date.now();
          breaker.window = [];
          breaker.failureCount = 0;
        }
      }
      /**
       * 评估 HALF_OPEN 状态的探针结果
       */
      evaluateHalfOpen(key, breaker, config2) {
        if (breaker.halfOpenResults.length < config2.halfOpenMaxRequests) {
          return;
        }
        const successCount = breaker.halfOpenResults.filter((r) => r).length;
        const successRate = successCount / breaker.halfOpenResults.length;
        if (successRate >= config2.halfOpenSuccessThreshold) {
          breaker.consecutiveOpenCount = 0;
          breaker.currentCooldownMs = config2.cooldownMs;
          this.transitionState(
            key,
            breaker,
            "CLOSED" /* CLOSED */,
            `\u63A2\u9488\u6210\u529F\u7387 ${(successRate * 100).toFixed(1)}% \u8FBE\u6807 | \u6062\u590D\u6B63\u5E38`
          );
        } else {
          breaker.consecutiveOpenCount++;
          const multiplier = Math.min(breaker.consecutiveOpenCount, config2.maxCooldownMultiplier);
          breaker.currentCooldownMs = config2.cooldownMs * multiplier;
          breaker.openedAt = Date.now();
          this.transitionState(
            key,
            breaker,
            "OPEN" /* OPEN */,
            `\u63A2\u9488\u6210\u529F\u7387 ${(successRate * 100).toFixed(1)}% \u672A\u8FBE\u6807 | \u91CD\u65B0\u7194\u65AD | \u51B7\u5374${Math.round(breaker.currentCooldownMs / 1e3)}s`
          );
        }
        breaker.halfOpenResults = [];
      }
      /**
       * 状态转换
       */
      transitionState(key, breaker, newState, reason) {
        const oldState = breaker.state;
        if (oldState === newState) return;
        breaker.state = newState;
        breaker.stateHistory.push({
          from: oldState,
          to: newState,
          timestamp: Date.now(),
          reason
        });
        if (breaker.stateHistory.length > 10) {
          breaker.stateHistory.shift();
        }
        const logLevel = newState === "OPEN" /* OPEN */ ? "warn" : "info";
        const message2 = `[v${SYSTEM_VERSION}] CircuitBreaker [${key}] ${oldState} \u2192 ${newState} | ${reason}`;
        if (logLevel === "warn") {
          log21.warn(message2);
        } else {
          log21.info(message2);
        }
        if (this.onStateChangeCallback) {
          try {
            this.onStateChangeCallback(key, oldState, newState, reason);
          } catch (err) {
            log21.error(`[v${SYSTEM_VERSION}] CircuitBreaker \u72B6\u6001\u53D8\u66F4\u56DE\u8C03\u5F02\u5E38:`, err);
          }
        }
      }
      // ==================== 查询与管理接口 ====================
      /**
       * 获取单个熔断器状态
       */
      getStatus(accountId, endpointType) {
        const key = this.getKey(accountId, endpointType);
        const breaker = this.breakers.get(key);
        const config2 = this.getConfig(endpointType);
        if (!breaker) {
          return {
            key,
            state: "CLOSED" /* CLOSED */,
            errorRate: 0,
            windowSize: 0,
            failureCount: 0,
            successCount: 0,
            consecutiveOpenCount: 0,
            currentCooldownMs: config2.cooldownMs,
            openedAt: null,
            timeUntilHalfOpen: null,
            lastActivityAt: 0
          };
        }
        const errorRate = breaker.window.length > 0 ? breaker.failureCount / breaker.window.length : 0;
        let timeUntilHalfOpen = null;
        if (breaker.state === "OPEN" /* OPEN */) {
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
          openedAt: breaker.state === "OPEN" /* OPEN */ ? breaker.openedAt : null,
          timeUntilHalfOpen,
          lastActivityAt: breaker.lastActivityAt
        };
      }
      /**
       * 获取所有熔断器状态
       */
      getAllStatus() {
        const statuses = [];
        for (const [key, breaker] of this.breakers.entries()) {
          const parts = key.split(":");
          const accountId = parseInt(parts[0], 10);
          const endpointType = parts[1];
          statuses.push(this.getStatus(accountId, endpointType));
        }
        return statuses;
      }
      /**
       * 获取当前处于 OPEN 状态的熔断器
       */
      getOpenBreakers() {
        return this.getAllStatus().filter((s) => s.state === "OPEN" /* OPEN */);
      }
      /**
       * 手动重置熔断器（强制恢复到 CLOSED 状态）
       */
      reset(accountId, endpointType) {
        const key = this.getKey(accountId, endpointType);
        const breaker = this.breakers.get(key);
        if (breaker) {
          const oldState = breaker.state;
          breaker.state = "CLOSED" /* CLOSED */;
          breaker.window = [];
          breaker.failureCount = 0;
          breaker.consecutiveOpenCount = 0;
          breaker.currentCooldownMs = this.getConfig(endpointType).cooldownMs;
          breaker.halfOpenResults = [];
          log21.info(`[v${SYSTEM_VERSION}] CircuitBreaker [${key}] \u624B\u52A8\u91CD\u7F6E: ${oldState} \u2192 CLOSED`);
        }
      }
      /**
       * 手动重置所有熔断器
       */
      resetAll() {
        for (const [key] of this.breakers.entries()) {
          const parts = key.split(":");
          const accountId = parseInt(parts[0], 10);
          const endpointType = parts[1];
          this.reset(accountId, endpointType);
        }
        log21.info(`[v${SYSTEM_VERSION}] CircuitBreaker \u6240\u6709\u5B9E\u4F8B\u5DF2\u91CD\u7F6E`);
      }
      /**
       * 清理长时间不活跃的熔断器实例（释放内存）
       * 建议每 30 分钟调用一次
       */
      cleanup(maxInactiveMs = 30 * 60 * 1e3) {
        const now = Date.now();
        let cleaned = 0;
        for (const [key, breaker] of this.breakers.entries()) {
          if (breaker.state === "CLOSED" /* CLOSED */ && now - breaker.lastActivityAt > maxInactiveMs) {
            this.breakers.delete(key);
            cleaned++;
          }
        }
        if (cleaned > 0) {
          log21.info(`[v${SYSTEM_VERSION}] CircuitBreaker \u6E05\u7406\u4E86 ${cleaned} \u4E2A\u4E0D\u6D3B\u8DC3\u5B9E\u4F8B, \u5269\u4F59 ${this.breakers.size} \u4E2A`);
        }
        return cleaned;
      }
      /**
       * 获取健康摘要
       */
      getHealthSummary() {
        let closed = 0, open = 0, halfOpen = 0;
        for (const breaker of this.breakers.values()) {
          switch (breaker.state) {
            case "CLOSED" /* CLOSED */:
              closed++;
              break;
            case "OPEN" /* OPEN */:
              open++;
              break;
            case "HALF_OPEN" /* HALF_OPEN */:
              halfOpen++;
              break;
          }
        }
        return {
          total: this.breakers.size,
          closed,
          open,
          halfOpen,
          overallHealthy: open === 0
        };
      }
    };
    globalCircuitBreaker = null;
    __name(getCircuitBreaker, "getCircuitBreaker");
  }
});

