// Extracted from production dist/index.js
// Original module: server/services/resilienceMonitor.ts
// Lines: 151

var resilienceMonitor_exports = {};
__export(resilienceMonitor_exports, {
  getResilienceHealthSummary: () => getResilienceHealthSummary,
  getResilienceStatus: () => getResilienceStatus,
  resetResilienceStats: () => resetResilienceStats
});
function getResilienceStatus() {
  let cbBreakers = [];
  let openCount = 0;
  let halfOpenCount = 0;
  let closedCount = 0;
  try {
    const cbService = getCircuitBreaker();
    const allCbStatus = cbService.getAllStatus();
    cbBreakers = allCbStatus.map((s) => {
      if (s.state === "OPEN") openCount++;
      else if (s.state === "HALF_OPEN") halfOpenCount++;
      else closedCount++;
      return {
        key: s.key,
        state: s.state,
        errorRate: Math.round(s.errorRate * 100) / 100,
        failureCount: s.failureCount,
        successCount: s.successCount,
        consecutiveOpenCount: s.consecutiveOpenCount,
        currentCooldownMs: s.currentCooldownMs,
        timeUntilHalfOpen: s.timeUntilHalfOpen
      };
    });
  } catch (e) {
    log204.warn(`[v525] \u83B7\u53D6\u7194\u65AD\u5668\u72B6\u6001\u5931\u8D25: ${e.message}`);
  }
  let latencyStats = [];
  let concurrencyStatus = [];
  try {
    const atService = getAdaptiveTimeout();
    const allLatency = atService.getAllLatencyStats();
    latencyStats = allLatency.map((s) => ({
      endpointType: s.endpointType,
      sampleCount: s.sampleCount,
      p50Ms: Math.round(s.p50Ms),
      p90Ms: Math.round(s.p90Ms),
      p99Ms: Math.round(s.p99Ms),
      avgMs: Math.round(s.avgMs),
      adaptiveTimeoutMs: Math.round(s.adaptiveTimeoutMs)
    }));
    const allConcurrency = atService.getAllConcurrencyStatus();
    concurrencyStatus = allConcurrency.map((s) => ({
      endpointType: s.endpointType,
      currentConcurrency: s.currentConcurrency
    }));
  } catch (e) {
    log204.warn(`[v525] \u83B7\u53D6\u81EA\u9002\u5E94\u8D85\u65F6\u72B6\u6001\u5931\u8D25: ${e.message}`);
  }
  let bhPartitions = [];
  try {
    const bhService = getBulkhead();
    const allBhStatus = bhService.getAllStatus();
    bhPartitions = allBhStatus.map((s) => ({
      key: s.key,
      maxConcurrency: s.maxConcurrency,
      activeTasks: s.activeTasks,
      queueLength: s.queueLength,
      utilization: Math.round(s.utilization * 100) / 100,
      totalProcessed: s.totalProcessed,
      totalRejected: s.totalRejected
    }));
  } catch (e) {
    log204.warn(`[v525] \u83B7\u53D6\u8231\u58C1\u72B6\u6001\u5931\u8D25: ${e.message}`);
  }
  let queryLayerData = {
    totalQueries: 0,
    totalErrors: 0,
    totalSlowQueries: 0,
    validationRejections: 0,
    avgDurationMs: 0,
    recentSlowQueries: []
  };
  try {
    const queryStats = getQueryStats();
    queryLayerData = {
      totalQueries: queryStats.totalQueries,
      totalErrors: queryStats.totalErrors,
      totalSlowQueries: queryStats.totalSlowQueries,
      validationRejections: queryStats.validationRejections,
      avgDurationMs: Math.round(queryStats.avgDurationMs),
      recentSlowQueries: queryStats.recentSlowQueries.map((q) => ({
        sql: q.sql,
        durationMs: q.durationMs,
        timestamp: q.timestamp.toISOString()
      }))
    };
  } catch (e) {
    log204.warn(`[v525] \u83B7\u53D6\u67E5\u8BE2\u5B89\u5168\u5C42\u72B6\u6001\u5931\u8D25: ${e.message}`);
  }
  return {
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    circuitBreaker: {
      breakers: cbBreakers,
      globalStats: {
        totalBreakers: cbBreakers.length,
        openCircuits: openCount,
        halfOpenCircuits: halfOpenCount,
        closedCircuits: closedCount
      }
    },
    adaptiveTimeout: {
      latencyStats,
      concurrencyStatus
    },
    bulkhead: {
      partitions: bhPartitions
    },
    queryLayer: queryLayerData
  };
}
function getResilienceHealthSummary() {
  try {
    const status = getResilienceStatus();
    const lines = [];
    lines.push(`[v525 Resilience] CB: ${status.circuitBreaker.globalStats.closedCircuits}closed/${status.circuitBreaker.globalStats.openCircuits}open/${status.circuitBreaker.globalStats.halfOpenCircuits}halfOpen`);
    if (status.bulkhead.partitions.length > 0) {
      const maxUtil = Math.max(...status.bulkhead.partitions.map((s) => s.utilization));
      lines.push(`BH: ${status.bulkhead.partitions.length}partitions, maxUtil=${Math.round(maxUtil * 100)}%`);
    }
    lines.push(`Query: ${status.queryLayer.totalQueries}total, ${status.queryLayer.totalErrors}err, ${status.queryLayer.validationRejections}rejected, ${status.queryLayer.totalSlowQueries}slow, avg=${status.queryLayer.avgDurationMs}ms`);
    return lines.join(" | ");
  } catch (e) {
    return `[v525 Resilience] Error getting summary: ${e.message}`;
  }
}
function resetResilienceStats() {
  resetQueryStats();
  log204.info("[v525] \u5F39\u6027\u67B6\u6784\u76D1\u63A7\u7EDF\u8BA1\u5DF2\u91CD\u7F6E");
}
var log204;
var init_resilienceMonitor = __esm({
  "server/services/resilienceMonitor.ts"() {
    "use strict";
    init_logger();
    init_circuitBreakerService();
    init_adaptiveTimeoutService();
    init_bulkheadService();
    init_typeSafeQueryBuilder();
    log204 = createModuleLogger("ResilienceMonitor");
    __name(getResilienceStatus, "getResilienceStatus");
    __name(getResilienceHealthSummary, "getResilienceHealthSummary");
    __name(resetResilienceStats, "resetResilienceStats");
  }
});

