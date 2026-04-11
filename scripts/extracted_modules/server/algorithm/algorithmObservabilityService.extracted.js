// Extracted from production dist/index.js
// Original module: server/algorithm/algorithmObservabilityService.ts
// Lines: 197

var algorithmObservabilityService_exports = {};
__export(algorithmObservabilityService_exports, {
  cleanupOldTraces: () => cleanupOldTraces,
  completeAlgorithmTrace: () => completeAlgorithmTrace,
  generateDashboardMetrics: () => generateDashboardMetrics,
  getMetrics: () => getMetrics,
  getRecentDecisionTraces: () => getRecentDecisionTraces,
  recordAlgorithmDecision: () => recordAlgorithmDecision,
  recordMetric: () => recordMetric,
  startAlgorithmTrace: () => startAlgorithmTrace
});
function recordAlgorithmDecision(trace) {
  decisionTraces.push(trace);
  while (decisionTraces.length > MAX_TRACE_BUFFER) {
    decisionTraces.shift();
  }
  const logEntry = {
    algo: trace.metaSelection.selectedAlgorithm,
    mode: trace.metaSelection.fusionMode,
    conf: trace.finalDecision.confidence.toFixed(2),
    bid: `$${trace.finalDecision.recommendedBid.toFixed(2)}`,
    change: `${trace.finalDecision.bidChangePercent > 0 ? "+" : ""}${(trace.finalDecision.bidChangePercent * 100).toFixed(1)}%`,
    latency: `${trace.durationMs}ms`,
    abTest: trace.abTestDetail ? `test#${trace.abTestDetail.testId}/${trace.abTestDetail.variantType}` : "none",
    exploring: trace.explorationDetail?.isExploring ? "yes" : "no"
  };
  log60.debug(`[AlgoDecision] account=${trace.accountId} entity=${trace.entityType}#${trace.entityId}: ${JSON.stringify(logEntry)}`);
}
function startAlgorithmTrace(accountId, entityType, entityId, campaignId, strategyTemplateId) {
  const traceId = startTrace("algorithm_decision", {
    accountId,
    entityType,
    entityId,
    campaignId,
    strategyTemplateId
  });
  return { traceId, startTime: Date.now() };
}
function completeAlgorithmTrace(traceContext, trace) {
  const durationMs = Date.now() - traceContext.startTime;
  endTrace(traceContext.traceId, "completed", {
    algorithm: trace.metaSelection.selectedAlgorithm,
    fusionMode: trace.metaSelection.fusionMode,
    confidence: trace.finalDecision.confidence,
    durationMs
  });
  recordAlgorithmDecision({
    ...trace,
    traceId: traceContext.traceId,
    timestamp: /* @__PURE__ */ new Date(),
    durationMs
  });
}
function generateDashboardMetrics(period = "24h") {
  const now = Date.now();
  const periodMs = period === "1h" ? 36e5 : period === "24h" ? 864e5 : 6048e5;
  const cutoff = now - periodMs;
  const recentTraces = decisionTraces.filter((t2) => t2.timestamp.getTime() > cutoff);
  if (recentTraces.length === 0) {
    return {
      timestamp: /* @__PURE__ */ new Date(),
      period,
      algorithmDistribution: {},
      fusionModeDistribution: { single: 0, cascade_ensemble: 0 },
      avgConfidence: 0,
      avgConfidenceByAlgorithm: {},
      explorationRate: 0,
      explorationCount: 0,
      abTestCoverage: 0,
      bidChangeDistribution: { increase: 0, decrease: 0, hold: 0 },
      avgBidChangePercent: 0,
      avgDecisionLatencyMs: 0,
      p95DecisionLatencyMs: 0
    };
  }
  const algorithmDistribution = {};
  const confidenceByAlgorithm = {};
  let singleCount = 0;
  let ensembleCount = 0;
  let explorationCount = 0;
  let abTestCount = 0;
  let increaseCount = 0;
  let decreaseCount = 0;
  let holdCount = 0;
  let totalBidChange = 0;
  const latencies = [];
  const confidences = [];
  for (const trace of recentTraces) {
    const algo = trace.metaSelection.selectedAlgorithm;
    algorithmDistribution[algo] = (algorithmDistribution[algo] || 0) + 1;
    if (!confidenceByAlgorithm[algo]) confidenceByAlgorithm[algo] = [];
    confidenceByAlgorithm[algo].push(trace.finalDecision.confidence);
    confidences.push(trace.finalDecision.confidence);
    if (trace.metaSelection.fusionMode === "cascade_ensemble") ensembleCount++;
    else singleCount++;
    if (trace.explorationDetail?.isExploring) explorationCount++;
    if (trace.abTestDetail) abTestCount++;
    const change = trace.finalDecision.bidChangePercent;
    if (change > 0.02) increaseCount++;
    else if (change < -0.02) decreaseCount++;
    else holdCount++;
    totalBidChange += Math.abs(change);
    latencies.push(trace.durationMs);
  }
  const n = recentTraces.length;
  const sortedLatencies = [...latencies].sort((a, b) => a - b);
  const avgConfidenceByAlgorithm = {};
  for (const [algo, confs] of Object.entries(confidenceByAlgorithm)) {
    avgConfidenceByAlgorithm[algo] = confs.reduce((s, c) => s + c, 0) / confs.length;
  }
  return {
    timestamp: /* @__PURE__ */ new Date(),
    period,
    // @ts-ignore
    algorithmDistribution,
    fusionModeDistribution: { single: singleCount, cascade_ensemble: ensembleCount },
    // @ts-ignore
    avgConfidence: confidences.reduce((s, c) => s + c, 0) / n,
    avgConfidenceByAlgorithm,
    explorationRate: explorationCount / n,
    explorationCount,
    // @ts-ignore
    abTestCoverage: abTestCount / n,
    bidChangeDistribution: { increase: increaseCount, decrease: decreaseCount, hold: holdCount },
    avgBidChangePercent: totalBidChange / n,
    // @ts-ignore
    avgDecisionLatencyMs: latencies.reduce((s, l) => s + l, 0) / n,
    p95DecisionLatencyMs: sortedLatencies[Math.floor(n * 0.95)] || 0
  };
}
function getRecentDecisionTraces(limit = 100, filters) {
  let filtered = decisionTraces;
  if (filters) {
    if (filters.accountId) {
      filtered = filtered.filter((t2) => t2.accountId === filters.accountId);
    }
    if (filters.algorithm) {
      filtered = filtered.filter((t2) => t2.metaSelection.selectedAlgorithm === filters.algorithm);
    }
    if (filters.fusionMode) {
      filtered = filtered.filter((t2) => t2.metaSelection.fusionMode === filters.fusionMode);
    }
    if (filters.isExploring !== void 0) {
      filtered = filtered.filter((t2) => t2.explorationDetail?.isExploring === filters.isExploring);
    }
  }
  return filtered.slice(-limit);
}
function cleanupOldTraces(maxAgeDays = 7) {
  const cutoff = Date.now() - maxAgeDays * 864e5;
  const before = decisionTraces.length;
  while (decisionTraces.length > 0 && decisionTraces[0].timestamp.getTime() < cutoff) {
    decisionTraces.shift();
  }
  const cleaned = before - decisionTraces.length;
  if (cleaned > 0) {
    log60.info(`[AlgorithmObservability] \u6E05\u7406\u4E86 ${cleaned} \u6761\u8FC7\u671F\u8FFD\u8E2A\u8BB0\u5F55`);
  }
  return cleaned;
}
function recordMetric(type, data) {
  metricBuffer.push({
    type,
    data,
    timestamp: /* @__PURE__ */ new Date()
  });
  while (metricBuffer.length > MAX_METRIC_BUFFER) {
    metricBuffer.shift();
  }
  log60.debug(`[Metric] ${type}: ${JSON.stringify(data)}`);
}
function getMetrics(type, limit = 100) {
  const filtered = type ? metricBuffer.filter((m) => m.type === type) : metricBuffer;
  return filtered.slice(-limit);
}
var log60, decisionTraces, MAX_TRACE_BUFFER, metricBuffer, MAX_METRIC_BUFFER;
var init_algorithmObservabilityService = __esm({
  "server/algorithm/algorithmObservabilityService.ts"() {
    "use strict";
    init_logger();
    init_observabilityService();
    log60 = createModuleLogger("AlgorithmObservability");
    decisionTraces = [];
    MAX_TRACE_BUFFER = 2e3;
    __name(recordAlgorithmDecision, "recordAlgorithmDecision");
    __name(startAlgorithmTrace, "startAlgorithmTrace");
    __name(completeAlgorithmTrace, "completeAlgorithmTrace");
    __name(generateDashboardMetrics, "generateDashboardMetrics");
    __name(getRecentDecisionTraces, "getRecentDecisionTraces");
    __name(cleanupOldTraces, "cleanupOldTraces");
    metricBuffer = [];
    MAX_METRIC_BUFFER = 1e3;
    __name(recordMetric, "recordMetric");
    __name(getMetrics, "getMetrics");
  }
});

