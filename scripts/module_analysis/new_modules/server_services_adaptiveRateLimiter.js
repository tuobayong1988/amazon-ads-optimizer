// server/services/adaptiveRateLimiter.ts
function getAdaptiveRateLimiter() {
  if (!_instance) {
    _instance = new AdaptiveRateLimiter();
  }
  return _instance;
}
function recordApiResponseForAdaptiveLimiting(accountId, endpointType, responseHeaders, latencyMs, statusCode) {
  try {
    const limiter = getAdaptiveRateLimiter();
    const headers = AdaptiveRateLimiter.extractRateLimitHeaders(responseHeaders);
    headers.statusCode = statusCode;
    limiter.recordApiResponse(accountId, endpointType, headers, latencyMs);
  } catch (e) {
    log28.debug(`[v548] \u81EA\u9002\u5E94\u9650\u6D41\u8BB0\u5F55\u5931\u8D25: ${e.message}`);
  }
}
var log28, WINDOW_SIZE_MS, MIN_ADJUSTMENT_INTERVAL_MS, SPEED_UP_FACTOR, SLOW_DOWN_FACTOR, SPEED_UP_THRESHOLD, SAFETY_MARGIN, MIN_TPS, BASELINE_TPS, MAX_TPS, AdaptiveRateLimiter, _instance;
var init_adaptiveRateLimiter = __esm({
  "server/services/adaptiveRateLimiter.ts"() {
    "use strict";
    init_logger();
    init_apiRateLimitService();
    log28 = createModuleLogger("AdaptiveRateLimiter");
    WINDOW_SIZE_MS = 6e4;
    MIN_ADJUSTMENT_INTERVAL_MS = 5e3;
    SPEED_UP_FACTOR = 1.08;
    SLOW_DOWN_FACTOR = 0.4;
    SPEED_UP_THRESHOLD = 50;
    SAFETY_MARGIN = 0.85;
    MIN_TPS = {
      list: 2,
      mutate: 1,
      report: 0.5,
      snapshot: 0.3,
      default: 1
    };
    BASELINE_TPS = {
      list: 8,
      mutate: 4,
      report: 0.5,
      snapshot: 0.5,
      default: 5
    };
    MAX_TPS = {
      list: 40,
      mutate: 20,
      report: 8,
      snapshot: 5,
      default: 25
    };
    AdaptiveRateLimiter = class {
      static {
        __name(this, "AdaptiveRateLimiter");
      }
      /** 每个端点类型的动态状态 */
      endpointStates = /* @__PURE__ */ new Map();
      /** 底层限流服务引用 */
      rateLimitService;
      /** 全局统计 */
      stats = {
        totalAdjustments: 0,
        speedUps: 0,
        slowDowns: 0,
        amazonHeadersReceived: 0,
        total429s: 0
      };
      constructor() {
        this.rateLimitService = getApiRateLimitService();
        log28.info(`[v548] AdaptiveRateLimiter \u521D\u59CB\u5316\u5B8C\u6210, \u57FA\u51C6TPS: ${Object.entries(BASELINE_TPS).map(([k, v]) => `${k}=${v}`).join(", ")}`);
      }
      /**
       * 核心方法: 记录API响应并动态调整限流参数
       * 在每次Amazon API调用完成后调用此方法
       */
      recordApiResponse(accountId, endpointType, headers, latencyMs) {
        const stateKey = this.getStateKey(accountId, endpointType);
        const state = this.getOrCreateState(endpointType, stateKey);
        const now = Date.now();
        const record2 = {
          timestamp: now,
          success: !headers.statusCode || headers.statusCode >= 200 && headers.statusCode < 400,
          statusCode: headers.statusCode || 200,
          latencyMs,
          amazonTpsLimit: headers.rateLimitLimit
        };
        state.requestWindow.push(record2);
        state.requestWindow = state.requestWindow.filter((r) => now - r.timestamp < WINDOW_SIZE_MS);
        if (headers.rateLimitLimit && headers.rateLimitLimit > 0) {
          state.amazonReportedLimit = headers.rateLimitLimit;
          this.stats.amazonHeadersReceived++;
          log28.debug(`[v548] Amazon TPS\u9650\u5236\u62A5\u544A: \u8D26\u6237${accountId} ${endpointType} = ${headers.rateLimitLimit} TPS`);
        }
        if (headers.statusCode === 429) {
          state.consecutive429s++;
          state.consecutiveSuccesses = 0;
          this.stats.total429s++;
          this.slowDown(accountId, endpointType, state, headers.retryAfterSeconds);
          this.rateLimitService.recordExternalThrottle(accountId, endpointType);
          return;
        }
        if (record2.success) {
          state.consecutiveSuccesses++;
          state.consecutive429s = 0;
          if (state.consecutiveSuccesses >= SPEED_UP_THRESHOLD && now - state.lastAdjustmentTime > MIN_ADJUSTMENT_INTERVAL_MS) {
            this.speedUp(accountId, endpointType, state);
          }
        }
        const recentRecords = state.requestWindow.filter((r) => now - r.timestamp < 3e4);
        if (recentRecords.length > 0) {
          state.recentSuccessRate = recentRecords.filter((r) => r.success).length / recentRecords.length;
        }
        if (state.amazonReportedLimit && now - state.lastAdjustmentTime > 3e4) {
          this.calibrateToAmazonLimit(accountId, endpointType, state);
        }
      }
      /**
       * 提速: 当连续成功时逐步提高TPS
       */
      speedUp(accountId, endpointType, state) {
        const previousTps = state.currentTargetTps;
        const maxAllowed = this.getMaxAllowedTps(endpointType, state);
        let newTps = state.currentTargetTps * SPEED_UP_FACTOR;
        newTps = Math.min(newTps, maxAllowed);
        newTps = Math.min(newTps, MAX_TPS[endpointType] || MAX_TPS.default);
        if (newTps - state.currentTargetTps < 0.5) return;
        state.currentTargetTps = newTps;
        state.lastAdjustmentTime = Date.now();
        state.consecutiveSuccesses = 0;
        state.phase = "normal";
        state.phaseEnteredAt = Date.now();
        this.stats.speedUps++;
        this.stats.totalAdjustments++;
        this.applyTpsToRateLimiter(endpointType, newTps);
        log28.info(`[v548] \u2B06\uFE0F \u63D0\u901F: \u8D26\u6237${accountId} ${endpointType} TPS ${previousTps.toFixed(1)} \u2192 ${newTps.toFixed(1)} (Amazon\u9650\u5236: ${state.amazonReportedLimit || "\u672A\u77E5"}, \u6210\u529F\u7387: ${(state.recentSuccessRate * 100).toFixed(0)}%)`);
      }
      /**
       * 降速: 收到429或检测到限流风险时降低TPS
       */
      slowDown(accountId, endpointType, state, retryAfterSeconds) {
        const previousTps = state.currentTargetTps;
        const minTps = MIN_TPS[endpointType] || MIN_TPS.default;
        if (retryAfterSeconds && retryAfterSeconds > 0) {
          const aggressiveFactor = Math.max(0.3, 1 / (retryAfterSeconds + 1));
          state.currentTargetTps = Math.max(minTps, state.currentTargetTps * aggressiveFactor);
        } else {
          state.currentTargetTps = Math.max(minTps, state.currentTargetTps * SLOW_DOWN_FACTOR);
        }
        state.lastAdjustmentTime = Date.now();
        state.phase = "recovery";
        state.phaseEnteredAt = Date.now();
        this.stats.slowDowns++;
        this.stats.totalAdjustments++;
        this.applyTpsToRateLimiter(endpointType, state.currentTargetTps);
        log28.warn(`[v548] \u2B07\uFE0F \u964D\u901F: \u8D26\u6237${accountId} ${endpointType} TPS ${previousTps.toFixed(1)} \u2192 ${state.currentTargetTps.toFixed(1)} (\u8FDE\u7EED429: ${state.consecutive429s}, Retry-After: ${retryAfterSeconds || "N/A"}s)`);
      }
      /**
       * 校准: 根据Amazon报告的TPS限制调整目标
       */
      calibrateToAmazonLimit(accountId, endpointType, state) {
        if (!state.amazonReportedLimit) return;
        const safeTarget = state.amazonReportedLimit * SAFETY_MARGIN;
        const previousTps = state.currentTargetTps;
        if (state.currentTargetTps > safeTarget) {
          state.currentTargetTps = safeTarget;
          state.lastAdjustmentTime = Date.now();
          state.phase = "cautious";
          state.phaseEnteredAt = Date.now();
          this.applyTpsToRateLimiter(endpointType, state.currentTargetTps);
          log28.info(`[v548] \u{1F3AF} \u6821\u51C6: \u8D26\u6237${accountId} ${endpointType} TPS ${previousTps.toFixed(1)} \u2192 ${state.currentTargetTps.toFixed(1)} (Amazon\u9650\u5236: ${state.amazonReportedLimit}, \u5B89\u5168\u4F59\u91CF: ${(SAFETY_MARGIN * 100).toFixed(0)}%)`);
        }
      }
      /**
       * 将动态TPS目标同步到底层ApiRateLimitService
       */
      applyTpsToRateLimiter(endpointType, targetTps) {
        const roundedTps = Math.max(1, Math.round(targetTps));
        this.rateLimitService.updateConfig(endpointType, {
          maxRequestsPerSecond: roundedTps,
          maxRequestsPerMinute: roundedTps * 55,
          // 留5秒余量
          burstCapacity: Math.max(2, Math.ceil(roundedTps * 1.5)),
          refillRatePerSecond: roundedTps
        });
      }
      /**
       * 获取允许的最大TPS（考虑Amazon报告的限制）
       */
      getMaxAllowedTps(endpointType, state) {
        if (state.amazonReportedLimit) {
          return state.amazonReportedLimit * SAFETY_MARGIN;
        }
        return MAX_TPS[endpointType] || MAX_TPS.default;
      }
      /**
       * 从HTTP响应头中提取限流信息
       * 兼容多种Amazon API响应头格式
       */
      static extractRateLimitHeaders(responseHeaders) {
        const result = {};
        const rateLimitHeader = responseHeaders["x-amz-rate-limit-limit"] || responseHeaders["x-amzn-ratelimit-limit"] || responseHeaders["X-Amz-Rate-Limit-Limit"] || responseHeaders["X-Amzn-RateLimit-Limit"];
        if (rateLimitHeader) {
          const value = Array.isArray(rateLimitHeader) ? rateLimitHeader[0] : rateLimitHeader;
          const parsed = parseFloat(value);
          if (!isNaN(parsed) && parsed > 0) {
            result.rateLimitLimit = parsed;
          }
        }
        const retryAfter = responseHeaders["retry-after"] || responseHeaders["Retry-After"];
        if (retryAfter) {
          const value = Array.isArray(retryAfter) ? retryAfter[0] : retryAfter;
          const parsed = parseFloat(value);
          if (!isNaN(parsed) && parsed > 0) {
            result.retryAfterSeconds = parsed;
          }
        }
        const requestId = responseHeaders["x-amzn-requestid"] || responseHeaders["x-amzn-RequestId"] || responseHeaders["X-Amzn-RequestId"];
        if (requestId) {
          result.requestId = Array.isArray(requestId) ? requestId[0] : requestId;
        }
        return result;
      }
      /**
       * 获取当前动态状态摘要（用于监控和日志）
       */
      getStatus() {
        const endpoints = [];
        for (const [key, state] of this.endpointStates.entries()) {
          endpoints.push({
            key,
            currentTps: state.currentTargetTps,
            amazonLimit: state.amazonReportedLimit,
            successRate: state.recentSuccessRate,
            phase: state.phase,
            consecutive429s: state.consecutive429s
          });
        }
        return { endpoints, stats: { ...this.stats } };
      }
      /**
       * 获取指定端点的当前动态TPS
       */
      getCurrentTps(endpointType) {
        let totalTps = 0;
        let count11 = 0;
        for (const [key, state] of this.endpointStates.entries()) {
          if (key.endsWith(`:${endpointType}`)) {
            totalTps += state.currentTargetTps;
            count11++;
          }
        }
        return count11 > 0 ? totalTps / count11 : BASELINE_TPS[endpointType] || BASELINE_TPS.default;
      }
      // ==================== 内部辅助方法 ====================
      getStateKey(accountId, endpointType) {
        return `${accountId}:${endpointType}`;
      }
      getOrCreateState(endpointType, stateKey) {
        let state = this.endpointStates.get(stateKey);
        if (!state) {
          state = {
            currentTargetTps: BASELINE_TPS[endpointType] || BASELINE_TPS.default,
            amazonReportedLimit: null,
            recentSuccessRate: 1,
            requestWindow: [],
            lastAdjustmentTime: 0,
            consecutiveSuccesses: 0,
            consecutive429s: 0,
            phase: "normal",
            phaseEnteredAt: Date.now()
          };
          this.endpointStates.set(stateKey, state);
        }
        return state;
      }
    };
    _instance = null;
    __name(getAdaptiveRateLimiter, "getAdaptiveRateLimiter");
    __name(recordApiResponseForAdaptiveLimiting, "recordApiResponseForAdaptiveLimiting");
  }
});

