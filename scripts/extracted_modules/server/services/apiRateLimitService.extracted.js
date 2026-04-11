// Extracted from production dist/index.js
// Original module: server/services/apiRateLimitService.ts
// Lines: 502

var apiRateLimitService_exports = {};
__export(apiRateLimitService_exports, {
  ApiRateLimitService: () => ApiRateLimitService,
  acquireApiPermit: () => acquireApiPermit,
  classifyEndpoint: () => classifyEndpoint,
  getApiRateLimitService: () => getApiRateLimitService,
  setApiRateLimitService: () => setApiRateLimitService
});
function createDistributedStore() {
  const isProduction = process.env.NODE_ENV === "production";
  if (isProduction) {
    try {
      const { MysqlRateLimitStore: MysqlRateLimitStore2 } = (init_mysqlRateLimitStore(), __toCommonJS(mysqlRateLimitStore_exports));
      log27.info(`[v372] \u751F\u4EA7\u73AF\u5883: \u4F7F\u7528MySQL\u5206\u5E03\u5F0F\u9650\u6D41\u5B58\u50A8`);
      return new MysqlRateLimitStore2();
    } catch (err) {
      log27.warn(`[v372] MySQL\u9650\u6D41\u5B58\u50A8\u521D\u59CB\u5316\u5931\u8D25\uFF0C\u964D\u7EA7\u5230\u5185\u5B58\u5B58\u50A8: ${err.message}`);
      return new InMemoryRateLimitStore();
    }
  }
  log27.info(`[v372] \u5F00\u53D1\u73AF\u5883: \u4F7F\u7528\u5185\u5B58\u9650\u6D41\u5B58\u50A8`);
  return new InMemoryRateLimitStore();
}
function getApiRateLimitService() {
  if (!globalRateLimitService) {
    const store = createDistributedStore();
    globalRateLimitService = new ApiRateLimitService(store);
    globalRateLimitService.onThrottle((accountId, endpointType, waitMs) => {
      if (waitMs > 5e3) {
        log27.warn(`[ALERT] v${SYSTEM_VERSION}: API\u9650\u6D41\u544A\u8B66! \u8D26\u6237${accountId} ${endpointType}\u7AEF\u70B9\u7B49\u5F85${waitMs}ms`);
      }
    });
  }
  return globalRateLimitService;
}
function setApiRateLimitService(service) {
  globalRateLimitService = service;
}
async function acquireApiPermit(accountId, endpointType = "default") {
  const service = getApiRateLimitService();
  await service.acquirePermit(accountId, endpointType, true);
}
function classifyEndpoint(methodName) {
  const lowerName = methodName.toLowerCase();
  // v615: 区分报告提交和轮询 - 轮询(/reports/{id})使用list配额,提交(/reports POST)使用report配额
  if (lowerName.match(/\/reports\/[a-z0-9._-]{8,}/)) {
    return "list"; // 报告状态轮询和下载,使用list配额(1500/min)
  }
  if (lowerName.includes("report") || lowerName.includes("performance") || lowerName.includes("searchterm")) {
    return "report";
  }
  if (lowerName.includes("snapshot")) {
    return "snapshot";
  }
  if (lowerName.includes("update") || lowerName.includes("create") || lowerName.includes("delete") || lowerName.includes("sync") || lowerName.includes("apply") || lowerName.includes("add") || lowerName.includes("remove") || lowerName.includes("archive")) {
    return "mutate";
  }
  if (lowerName.includes("list") || lowerName.includes("get") || lowerName.includes("fetch") || lowerName.includes("query") || lowerName.includes("search")) {
    return "list";
  }
  return "default";
}
var log27, InMemoryRateLimitStore, DEFAULT_ENDPOINT_CONFIGS, GLOBAL_ENDPOINT_CONFIGS, accountThrottleStates, ApiRateLimitService, globalRateLimitService;
var init_apiRateLimitService = __esm({
  "server/services/apiRateLimitService.ts"() {
    "use strict";
    init_logger();
    init_systemVersion();
    init_circuitBreakerService();
    log27 = createModuleLogger("ApiRateLimitService");
    InMemoryRateLimitStore = class {
      static {
        __name(this, "InMemoryRateLimitStore");
      }
      buckets = /* @__PURE__ */ new Map();
      counters = /* @__PURE__ */ new Map();
      async getBucket(key) {
        return this.buckets.get(key) || null;
      }
      async setBucket(key, tokens, lastRefillTime) {
        this.buckets.set(key, { tokens, lastRefillTime });
      }
      async consumeToken(key, config2) {
        const now = Date.now();
        let bucket = this.buckets.get(key);
        if (!bucket) {
          bucket = { tokens: config2.burstCapacity, lastRefillTime: now };
          this.buckets.set(key, bucket);
        }
        const elapsedMs = now - bucket.lastRefillTime;
        const tokensToAdd = elapsedMs / 1e3 * config2.refillRatePerSecond;
        bucket.tokens = Math.min(config2.burstCapacity, bucket.tokens + tokensToAdd);
        bucket.lastRefillTime = now;
        if (bucket.tokens >= 1) {
          bucket.tokens -= 1;
          return { remaining: Math.floor(bucket.tokens), waitMs: 0 };
        } else {
          const deficit = 1 - bucket.tokens;
          const waitMs = Math.ceil(deficit / config2.refillRatePerSecond * 1e3);
          return { remaining: 0, waitMs };
        }
      }
      async incrementCounter(key, windowMs) {
        const now = Date.now();
        let counter = this.counters.get(key);
        if (!counter || now - counter.windowStart >= counter.windowMs) {
          counter = { count: 0, windowStart: now, windowMs };
          this.counters.set(key, counter);
        }
        counter.count++;
        return counter.count;
      }
      async getCounter(key) {
        const counter = this.counters.get(key);
        if (!counter) return 0;
        const now = Date.now();
        if (now - counter.windowStart >= counter.windowMs) {
          return 0;
        }
        return counter.count;
      }
    };
    DEFAULT_ENDPOINT_CONFIGS = {
      list: {
        maxRequestsPerSecond: 8,
        // 官方~10 TPS，保守设为8
        maxRequestsPerMinute: 400,
        burstCapacity: 15,
        // 允许短时突发到15
        refillRatePerSecond: 8
      },
      mutate: {
        maxRequestsPerSecond: 4,
        // 官方~5 TPS，保守设为4
        maxRequestsPerMinute: 200,
        burstCapacity: 8,
        refillRatePerSecond: 4
      },
      report: {
        maxRequestsPerSecond: 1,
        // 报告端点限制严格 - P3v6: 降低每分钟限额
        maxRequestsPerMinute: 20,
        burstCapacity: 3,
        refillRatePerSecond: 1
      },
      snapshot: {
        maxRequestsPerSecond: 1,
        maxRequestsPerMinute: 20,
        burstCapacity: 2,
        refillRatePerSecond: 0.5
      },
      default: {
        maxRequestsPerSecond: 3,
        maxRequestsPerMinute: 150,
        burstCapacity: 6,
        refillRatePerSecond: 3
      }
    };
    GLOBAL_ENDPOINT_CONFIGS = {
      list: {
        maxRequestsPerSecond: 30,
        maxRequestsPerMinute: 1500,
        burstCapacity: 50,
        refillRatePerSecond: 30
      },
      mutate: {
        maxRequestsPerSecond: 8,
        maxRequestsPerMinute: 400,
        burstCapacity: 12,
        refillRatePerSecond: 8
      },
      report: {
        maxRequestsPerSecond: 5,
        maxRequestsPerMinute: 120,
        burstCapacity: 8,
        refillRatePerSecond: 5
      },
      snapshot: {
        maxRequestsPerSecond: 3,
        maxRequestsPerMinute: 60,
        burstCapacity: 5,
        refillRatePerSecond: 3
      },
      default: {
        maxRequestsPerSecond: 20,
        maxRequestsPerMinute: 800,
        burstCapacity: 30,
        refillRatePerSecond: 20
      }
    };
    accountThrottleStates = /* @__PURE__ */ new Map();
    ApiRateLimitService = class {
      static {
        __name(this, "ApiRateLimitService");
      }
      store;
      globalStore;
      configs;
      metrics = /* @__PURE__ */ new Map();
      /** 限流事件回调（用于告警） */
      onThrottleCallback;
      constructor(store, configs) {
        this.store = store || new InMemoryRateLimitStore();
        this.globalStore = store || new InMemoryRateLimitStore();
        this.configs = { ...DEFAULT_ENDPOINT_CONFIGS };
        if (configs) {
          for (const [type, overrides] of Object.entries(configs)) {
            if (overrides && this.configs[type]) {
              this.configs[type] = {
                ...this.configs[type],
                ...overrides
              };
            }
          }
        }
        log27.info(`[ApiRateLimitService] v${SYSTEM_VERSION}: \u521D\u59CB\u5316\u5B8C\u6210, \u7AEF\u70B9\u914D\u7F6E: ${Object.entries(this.configs).map(([k, v]) => `${k}=${v.maxRequestsPerSecond}TPS`).join(", ")}, \u5168\u5C40\u9650\u989D: ${Object.entries(GLOBAL_ENDPOINT_CONFIGS).map(([k, v]) => `${k}=${v.maxRequestsPerSecond}TPS`).join(", ")}`);
      }
      /**
       * v368: 获取账户的有效限流配置（考虑退避系数）
       */
      getEffectiveConfig(accountId, endpointType) {
        const baseConfig = this.configs[endpointType] || this.configs.default;
        const stateKey = `${accountId}:${endpointType}`;
        const state = accountThrottleStates.get(stateKey);
        if (!state || state.backoffFactor >= 1) {
          return baseConfig;
        }
        return {
          maxRequestsPerSecond: Math.max(1, Math.floor(baseConfig.maxRequestsPerSecond * state.backoffFactor)),
          maxRequestsPerMinute: Math.max(10, Math.floor(baseConfig.maxRequestsPerMinute * state.backoffFactor)),
          burstCapacity: Math.max(1, Math.floor(baseConfig.burstCapacity * state.backoffFactor)),
          refillRatePerSecond: Math.max(0.5, baseConfig.refillRatePerSecond * state.backoffFactor)
        };
      }
      /**
       * 请求限流检查 - 核心方法
       * 在发起API调用前调用此方法，获取限流决策
       * 
       * v368: 增加全局限流层，先检查全局限额再检查per-account限额
       */
      async acquirePermit(accountId, endpointType = "default", autoWait = true) {
        const circuitBreaker = getCircuitBreaker();
        if (!circuitBreaker.canPass(accountId, endpointType)) {
          const status = circuitBreaker.getStatus(accountId, endpointType);
          const waitMs2 = status.timeUntilHalfOpen || 6e4;
          log27.warn(`[RateLimit] v${SYSTEM_VERSION}: \u8D26\u6237${accountId} ${endpointType}\u7AEF\u70B9\u5DF2\u7194\u65AD(${status.state}), \u5FEB\u901F\u5931\u8D25 | \u5269\u4F59\u51B7\u5374${Math.round(waitMs2 / 1e3)}s`);
          this.recordThrottle(accountId, endpointType, waitMs2);
          return { allowed: false, waitMs: waitMs2, remainingTokens: 0, retryAfterMs: waitMs2 };
        }
        const effectiveConfig = this.getEffectiveConfig(accountId, endpointType);
        const globalConfig2 = GLOBAL_ENDPOINT_CONFIGS[endpointType] || GLOBAL_ENDPOINT_CONFIGS.default;
        const bucketKey = `ratelimit:${accountId}:${endpointType}`;
        const minuteCounterKey = `ratelimit:minute:${accountId}:${endpointType}`;
        const globalBucketKey = `ratelimit:global:${endpointType}`;
        const globalMinuteKey = `ratelimit:global:minute:${endpointType}`;
        const MAX_ACQUIRE_RETRIES = 5;
        let acquireAttempt = 0;
        while (acquireAttempt < MAX_ACQUIRE_RETRIES) {
          const globalMinuteCount = await this.globalStore.getCounter(globalMinuteKey);
          if (globalMinuteCount >= globalConfig2.maxRequestsPerMinute) {
            const baseWait = 1e4;
            const waitMs2 = Math.min(baseWait * Math.pow(2, acquireAttempt), 6e4) + Math.random() * 3000;
            this.recordThrottle(accountId, endpointType, waitMs2);
            if (autoWait && acquireAttempt < MAX_ACQUIRE_RETRIES - 1) {
              acquireAttempt++;
              log27.warn(`[RateLimit] v${SYSTEM_VERSION}: \u5168\u5C40${endpointType}\u7AEF\u70B9\u6BCF\u5206\u949F\u9650\u989D\u5DF2\u6EE1(${globalMinuteCount}/${globalConfig2.maxRequestsPerMinute}), \u6307\u6570\u9000\u907F${Math.round(waitMs2/1000)}s (\u91CD\u8BD5${acquireAttempt}/${MAX_ACQUIRE_RETRIES})`);
              await this.delay(waitMs2);
              continue;
            }
            return { allowed: false, waitMs: waitMs2, remainingTokens: 0, retryAfterMs: waitMs2 };
          }
          const minuteCount = await this.store.getCounter(minuteCounterKey);
          if (minuteCount >= effectiveConfig.maxRequestsPerMinute) {
            const waitMs2 = 6e4;
            this.recordThrottle(accountId, endpointType, waitMs2);
            if (autoWait && acquireAttempt < MAX_ACQUIRE_RETRIES - 1) {
              acquireAttempt++;
              log27.warn(`[RateLimit] \u8D26\u6237${accountId} ${endpointType}\u7AEF\u70B9\u6BCF\u5206\u949F\u9650\u989D\u5DF2\u6EE1(${minuteCount}/${effectiveConfig.maxRequestsPerMinute}), \u7B49\u5F85${Math.min(waitMs2, 1e4)}ms (\u91CD\u8BD5${acquireAttempt}/${MAX_ACQUIRE_RETRIES})`);
              await this.delay(Math.min(waitMs2, 1e4));
              continue;
            }
            return { allowed: false, waitMs: waitMs2, remainingTokens: 0, retryAfterMs: waitMs2 };
          }
          break;
        }
        const globalResult = await this.globalStore.consumeToken(globalBucketKey, globalConfig2);
        if (globalResult.waitMs > 0) {
          if (autoWait) {
            log27.debug(`[RateLimit] v${SYSTEM_VERSION}: \u5168\u5C40${endpointType}\u7AEF\u70B9\u4EE4\u724C\u4E0D\u8DB3, \u7B49\u5F85${globalResult.waitMs}ms`);
            await this.delay(globalResult.waitMs);
            await this.globalStore.consumeToken(globalBucketKey, globalConfig2);
          } else {
            return { allowed: false, waitMs: globalResult.waitMs, remainingTokens: 0, retryAfterMs: globalResult.waitMs };
          }
        }
        const { remaining, waitMs } = await this.store.consumeToken(bucketKey, effectiveConfig);
        if (waitMs > 0) {
          this.recordThrottle(accountId, endpointType, waitMs);
          if (autoWait) {
            log27.debug(`[RateLimit] \u8D26\u6237${accountId} ${endpointType}\u7AEF\u70B9\u4EE4\u724C\u4E0D\u8DB3, \u7B49\u5F85${waitMs}ms`);
            await this.delay(waitMs);
            const retryResult = await this.store.consumeToken(bucketKey, effectiveConfig);
            await this.store.incrementCounter(minuteCounterKey, 6e4);
            await this.globalStore.incrementCounter(`ratelimit:global:minute:${endpointType}`, 6e4);
            this.recordAccepted(accountId, endpointType, waitMs);
            return { allowed: true, waitMs, remainingTokens: retryResult.remaining };
          }
          return { allowed: false, waitMs, remainingTokens: 0, retryAfterMs: waitMs };
        }
        await this.store.incrementCounter(minuteCounterKey, 6e4);
        await this.globalStore.incrementCounter(`ratelimit:global:minute:${endpointType}`, 6e4);
        this.recordAccepted(accountId, endpointType, 0);
        return { allowed: true, waitMs: 0, remainingTokens: remaining };
      }
      /**
       * 批量请求限流 - 用于批量API调用前预检
       */
      async planBatchRequests(accountId, endpointType, requestCount) {
        const config2 = this.getEffectiveConfig(accountId, endpointType);
        const recommendedBatchSize = Math.min(
          requestCount,
          config2.burstCapacity,
          config2.maxRequestsPerSecond * 2
        );
        const batchIntervalMs = Math.ceil(recommendedBatchSize / config2.refillRatePerSecond * 1e3) + 500;
        const totalBatches = Math.ceil(requestCount / recommendedBatchSize);
        const estimatedTotalTimeMs = totalBatches * batchIntervalMs;
        log27.debug(`[RateLimit] \u6279\u91CF\u89C4\u5212: \u8D26\u6237${accountId} ${endpointType} ${requestCount}\u4E2A\u8BF7\u6C42 -> \u6279\u6B21\u5927\u5C0F${recommendedBatchSize}, \u95F4\u9694${batchIntervalMs}ms, \u9884\u8BA1${estimatedTotalTimeMs}ms`);
        return { recommendedBatchSize, batchIntervalMs, estimatedTotalTimeMs };
      }
      /**
       * v368: 记录外部429限流事件 - Per-account退避
       * 当Amazon API返回429时调用，触发该账户的自适应降速
       * 不再修改全局配置，只影响触发429的特定账户
       */
      recordExternalThrottle(accountId, endpointType) {
        const circuitBreaker = getCircuitBreaker();
        circuitBreaker.recordFailure(accountId, endpointType, false);
        const stateKey = `${accountId}:${endpointType}`;
        let state = accountThrottleStates.get(stateKey);
        if (!state) {
          state = {
            backoffFactor: 1,
            consecutive429Count: 0,
            lastThrottleTime: Date.now(),
            recoveryTimer: null
          };
          accountThrottleStates.set(stateKey, state);
        }
        if (state.recoveryTimer) {
          clearTimeout(state.recoveryTimer);
          state.recoveryTimer = null;
        }
        state.consecutive429Count++;
        state.lastThrottleTime = Date.now();
        const previousFactor = state.backoffFactor;
        state.backoffFactor = Math.max(0.3, state.backoffFactor * 0.6);
        const baseConfig = this.configs[endpointType] || this.configs.default;
        const effectiveTps = Math.max(1, Math.floor(baseConfig.maxRequestsPerSecond * state.backoffFactor));
        log27.warn(`[RateLimit] v${SYSTEM_VERSION}: \u5916\u90E8429\u9650\u6D41! \u8D26\u6237${accountId} ${endpointType}\u7AEF\u70B9 \u9000\u907F\u7CFB\u6570: ${previousFactor.toFixed(2)} -> ${state.backoffFactor.toFixed(2)}, \u6709\u6548TPS: ${effectiveTps}, \u8FDE\u7EED429: ${state.consecutive429Count}\u6B21`);
        try {
          const { recordThrottleEvent: recordThrottleEvent2, evaluateThrottlePause: evaluateThrottlePause2 } = (init_syncPriorityScheduler(), __toCommonJS(syncPriorityScheduler_exports));
          recordThrottleEvent2();
          evaluateThrottlePause2();
        } catch (_) {
        }
        try {
          const { recordDbError: recordDbError2 } = (init_observabilityService(), __toCommonJS(observabilityService_exports));
          recordDbError2("apiThrottle");
        } catch (_) {
        }
        const scheduleRecovery = /* @__PURE__ */ __name(() => {
          const recoveryIntervalMs = 3e4;
          state.recoveryTimer = setTimeout(() => {
            if (!state) return;
            const previousRecoveryFactor = state.backoffFactor;
            state.backoffFactor = Math.min(1, state.backoffFactor * 1.5);
            state.consecutive429Count = Math.max(0, state.consecutive429Count - 1);
            const recoveredTps = Math.max(1, Math.floor(baseConfig.maxRequestsPerSecond * state.backoffFactor));
            log27.info(`[RateLimit] v${SYSTEM_VERSION}: \u8D26\u6237${accountId} ${endpointType}\u7AEF\u70B9TPS\u6062\u590D: \u9000\u907F\u7CFB\u6570 ${previousRecoveryFactor.toFixed(2)} -> ${state.backoffFactor.toFixed(2)}, \u6709\u6548TPS: ${recoveredTps}`);
            if (state.backoffFactor < 1) {
              scheduleRecovery();
            } else {
              state.consecutive429Count = 0;
              state.recoveryTimer = null;
              log27.info(`[RateLimit] v${SYSTEM_VERSION}: \u8D26\u6237${accountId} ${endpointType}\u7AEF\u70B9\u5DF2\u5B8C\u5168\u6062\u590D\u5230\u6B63\u5E38TPS`);
            }
          }, recoveryIntervalMs);
        }, "scheduleRecovery");
        scheduleRecovery();
        if (this.onThrottleCallback) {
          this.onThrottleCallback(accountId, endpointType, 0);
        }
      }
      /**
       * 设置限流事件回调
       */
      onThrottle(callback) {
        this.onThrottleCallback = callback;
      }
      /**
       * 获取指定账户和端点的限流指标
       */
      getMetrics(accountId, endpointType) {
        const results = [];
        for (const [key, metrics] of this.metrics.entries()) {
          if (metrics.accountId === accountId) {
            if (!endpointType || metrics.endpointType === endpointType) {
              results.push({ ...metrics });
            }
          }
        }
        return results;
      }
      /**
       * 获取所有限流指标汇总
       */
      getAllMetrics() {
        return Array.from(this.metrics.values()).map((m) => ({ ...m }));
      }
      /**
       * v368: 获取账户退避状态
       */
      getAccountThrottleState(accountId, endpointType) {
        const state = accountThrottleStates.get(`${accountId}:${endpointType}`);
        if (!state) return null;
        return { backoffFactor: state.backoffFactor, consecutive429Count: state.consecutive429Count };
      }
      /**
       * 获取当前限流配置
       */
      getConfigs() {
        return { ...this.configs };
      }
      /**
       * 动态更新端点限流配置
       */
      updateConfig(endpointType, config2) {
        if (this.configs[endpointType]) {
          this.configs[endpointType] = { ...this.configs[endpointType], ...config2 };
          log27.info(`[RateLimit] v${SYSTEM_VERSION}: \u66F4\u65B0${endpointType}\u7AEF\u70B9\u914D\u7F6E: ${JSON.stringify(config2)}`);
        }
      }
      /**
       * 重置指标（通常在同步周期结束时调用）
       */
      resetMetrics() {
        this.metrics.clear();
      }
      // ==================== 内部方法 ====================
      getMetricsKey(accountId, endpointType) {
        return `${accountId}:${endpointType}`;
      }
      getOrCreateMetrics(accountId, endpointType) {
        const key = this.getMetricsKey(accountId, endpointType);
        let metrics = this.metrics.get(key);
        if (!metrics) {
          metrics = {
            endpointType,
            accountId,
            totalRequests: 0,
            acceptedRequests: 0,
            rejectedRequests: 0,
            totalWaitTimeMs: 0,
            avgWaitTimeMs: 0,
            peakTps: 0,
            throttleEvents: 0,
            lastThrottleTime: null
          };
          this.metrics.set(key, metrics);
        }
        return metrics;
      }
      recordAccepted(accountId, endpointType, waitMs) {
        const metrics = this.getOrCreateMetrics(accountId, endpointType);
        metrics.totalRequests++;
        metrics.acceptedRequests++;
        metrics.totalWaitTimeMs += waitMs;
        metrics.avgWaitTimeMs = metrics.totalWaitTimeMs / metrics.acceptedRequests;
      }
      recordThrottle(accountId, endpointType, waitMs) {
        const metrics = this.getOrCreateMetrics(accountId, endpointType);
        metrics.totalRequests++;
        metrics.throttleEvents++;
        metrics.lastThrottleTime = /* @__PURE__ */ new Date();
        if (this.onThrottleCallback) {
          this.onThrottleCallback(accountId, endpointType, waitMs);
        }
      }
      delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
      }
    };
    globalRateLimitService = null;
    __name(createDistributedStore, "createDistributedStore");
    __name(getApiRateLimitService, "getApiRateLimitService");
    __name(setApiRateLimitService, "setApiRateLimitService");
    __name(acquireApiPermit, "acquireApiPermit");
    __name(classifyEndpoint, "classifyEndpoint");
  }
});

