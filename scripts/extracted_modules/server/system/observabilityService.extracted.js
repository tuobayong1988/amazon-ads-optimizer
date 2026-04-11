// Extracted from production dist/index.js
// Original module: server/system/observabilityService.ts
// Lines: 713

var observabilityService_exports = {};
__export(observabilityService_exports, {
  collectSystemMetrics: () => collectSystemMetrics,
  endTrace: () => endTrace,
  evaluateAlertRules: () => evaluateAlertRules,
  generateHealthSummary: () => generateHealthSummary,
  getActiveTraces: () => getActiveTraces,
  getDbErrorCounters: () => getDbErrorCounters,
  getLatencyStats: () => getLatencyStats,
  getRecentMetrics: () => getRecentMetrics,
  recordDbError: () => recordDbError,
  startObservabilityService: () => startObservabilityService,
  startTrace: () => startTrace,
  stopObservabilityService: () => stopObservabilityService
});
async function collectSystemMetrics() {
  const now = /* @__PURE__ */ new Date();
  const snapshots = [];
  try {
    const syncMetrics = await collectSyncMetrics(now);
    snapshots.push(syncMetrics);
    const optimizationMetrics = await collectOptimizationMetrics(now);
    snapshots.push(optimizationMetrics);
    const reliabilityMetrics = await collectReliabilityMetrics(now);
    snapshots.push(reliabilityMetrics);
    metricsBuffer.push(...snapshots);
    const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1e3);
    while (metricsBuffer.length > 0 && metricsBuffer[0].timestamp < cutoff) {
      metricsBuffer.shift();
    }
    return snapshots;
  } catch (err) {
    log25.warn(`[Observability] v267: \u6307\u6807\u6536\u96C6\u5931\u8D25: ${err.message}`);
    return snapshots;
  }
}
async function collectSyncMetrics(now) {
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1e3);
  const db = await getDb();
  if (!db) return { timestamp: now, category: "sync", metrics: {} };
  const syncStats = await db.select({
    apiSyncStatus: optimizationEvents2.apiSyncStatus,
    operationType: optimizationEvents2.actionType,
    cnt: count()
  }).from(optimizationEvents2).where(gte(optimizationEvents2.executedAt, oneHourAgo.toISOString().slice(0, 19).replace("T", " "))).groupBy(optimizationEvents2.apiSyncStatus, optimizationEvents2.actionType);
  let totalSynced = 0, totalPending = 0, totalFailed = 0, totalNA = 0;
  const typeBreakdown = {};
  for (const row of syncStats) {
    const opType = row.operationType || "unknown";
    if (!typeBreakdown[opType]) {
      typeBreakdown[opType] = { synced: 0, pending: 0, failed: 0 };
    }
    const cnt = Number(row.cnt);
    if (row.apiSyncStatus === "synced") {
      totalSynced += cnt;
      typeBreakdown[opType].synced += cnt;
    } else if (row.apiSyncStatus === "pending") {
      totalPending += cnt;
      typeBreakdown[opType].pending += cnt;
    } else if (row.apiSyncStatus === "failed") {
      totalFailed += cnt;
      typeBreakdown[opType].failed += cnt;
    } else {
      totalNA += cnt;
    }
  }
  const totalSyncable = totalSynced + totalPending + totalFailed;
  const syncRate = totalSyncable > 0 ? totalSynced / totalSyncable * 100 : 100;
  return {
    timestamp: now,
    category: "sync",
    metrics: {
      sync_rate_percent: Math.round(syncRate * 100) / 100,
      total_synced: totalSynced,
      total_pending: totalPending,
      total_failed: totalFailed,
      total_not_applicable: totalNA
    }
  };
}
async function collectOptimizationMetrics(now) {
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1e3);
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1e3);
  const db2 = await getDb();
  if (!db2) return { timestamp: now, category: "optimization", metrics: {} };
  try {
    const hourlyStats = await db2.select({
      status: optimizationEvents2.status,
      cnt: count()
    }).from(optimizationEvents2).where(gte(optimizationEvents2.createdAt, oneHourAgo.toISOString().slice(0, 19).replace("T", " "))).groupBy(optimizationEvents2.status);
    let hourlyExecuted = 0, hourlyFailed = 0, hourlyRolledBack = 0;
    for (const row of hourlyStats) {
      const cnt = Number(row.cnt);
      if (row.status === "success") hourlyExecuted += cnt;
      else if (row.status === "failed") hourlyFailed += cnt;
      else if (row.status === "rolled_back") hourlyRolledBack += cnt;
    }
    const dailyStats = await db2.select({
      // @ts-ignore
      status: optimizationEvents2.status,
      // @ts-ignore
      cnt: count()
      // @ts-ignore
    }).from(optimizationEvents2).where(gte(optimizationEvents2.createdAt, oneDayAgo.toISOString().slice(0, 19).replace("T", " "))).groupBy(optimizationEvents2.status);
    let dailyExecuted = 0, dailyFailed = 0, dailyRolledBack = 0;
    for (const row of dailyStats) {
      const cnt = Number(row.cnt);
      if (row.status === "success") dailyExecuted += cnt;
      else if (row.status === "failed") dailyFailed += cnt;
      else if (row.status === "rolled_back") dailyRolledBack += cnt;
    }
    const hourlyTotal = hourlyExecuted + hourlyFailed + hourlyRolledBack;
    const dailyTotal = dailyExecuted + dailyFailed + dailyRolledBack;
    return {
      timestamp: now,
      category: "optimization",
      metrics: {
        hourly_executed: hourlyExecuted,
        hourly_failed: hourlyFailed,
        hourly_rolled_back: hourlyRolledBack,
        hourly_success_rate: hourlyTotal > 0 ? Math.round(hourlyExecuted / hourlyTotal * 1e4) / 100 : 100,
        daily_executed: dailyExecuted,
        daily_failed: dailyFailed,
        daily_rolled_back: dailyRolledBack,
        daily_success_rate: dailyTotal > 0 ? Math.round(dailyExecuted / dailyTotal * 1e4) / 100 : 100
      }
    };
  } catch (err) {
    log25.warn(`[Observability] v379: optimization_events\u67E5\u8BE2\u5931\u8D25\uFF0C\u8FD4\u56DE\u7A7A\u6307\u6807: ${err.message?.substring(0, 100)}`);
    return { timestamp: now, category: "optimization", metrics: {} };
  }
}
async function collectReliabilityMetrics(now) {
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1e3);
  const db3 = await getDb();
  if (!db3) return { timestamp: now, category: "reliability", metrics: {} };
  let apiSuccess = 0, apiFailed = 0, apiPending = 0;
  try {
    const apiStats = await db3.select({
      // @ts-ignore
      apiSyncStatus: optimizationEvents2.apiSyncStatus,
      // @ts-ignore
      cnt: count()
    }).from(optimizationEvents2).where(and(
      gte(optimizationEvents2.createdAt, oneDayAgo.toISOString().slice(0, 19).replace("T", " ")),
      not(eq(optimizationEvents2.apiSyncStatus, "not_applicable"))
    )).groupBy(optimizationEvents2.apiSyncStatus);
    for (const row of apiStats) {
      const cnt = Number(row.cnt);
      if (row.apiSyncStatus === "synced") apiSuccess += cnt;
      else if (row.apiSyncStatus === "failed") apiFailed += cnt;
      else if (row.apiSyncStatus === "pending") apiPending += cnt;
    }
  } catch (err) {
    log25.warn(`[Observability] v379: optimization_events API\u7EDF\u8BA1\u67E5\u8BE2\u5931\u8D25: ${err.message?.substring(0, 100)}`);
  }
  const apiTotal = apiSuccess + apiFailed + apiPending;
  const activeTraceCount = activeTraces.size;
  const completedTraces = Array.from(activeTraces.values()).filter((t2) => t2.status === "completed" && t2.durationMs);
  const avgLatency = completedTraces.length > 0 ? completedTraces.reduce((sum2, t2) => sum2 + (t2.durationMs || 0), 0) / completedTraces.length : 0;
  return {
    timestamp: now,
    category: "reliability",
    metrics: {
      api_success_rate: apiTotal > 0 ? Math.round(apiSuccess / apiTotal * 1e4) / 100 : 100,
      api_total_calls: apiTotal,
      api_failed_calls: apiFailed,
      api_pending_calls: apiPending,
      active_traces: activeTraceCount,
      avg_operation_latency_ms: Math.round(avgLatency),
      uptime_hours: Math.round(process.uptime() / 3600 * 100) / 100,
      memory_usage_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
    }
  };
}
function startTrace(operationType, metadata = {}, parentTraceId) {
  const traceId = `trace_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const trace = {
    traceId,
    operationType,
    startTime: /* @__PURE__ */ new Date(),
    status: "started",
    metadata,
    parentTraceId
  };
  activeTraces.set(traceId, trace);
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1e3);
  for (const [id, t2] of activeTraces) {
    if (t2.startTime < oneHourAgo) {
      activeTraces.delete(id);
    }
  }
  return traceId;
}
function endTrace(traceId, status = "completed", additionalMetadata) {
  const trace = activeTraces.get(traceId);
  if (!trace) return;
  trace.endTime = /* @__PURE__ */ new Date();
  trace.durationMs = trace.endTime.getTime() - trace.startTime.getTime();
  trace.status = status;
  if (additionalMetadata) {
    trace.metadata = { ...trace.metadata, ...additionalMetadata };
  }
  if (trace.durationMs > 3e4) {
    log25.warn(`[Observability] v267: \u6162\u64CD\u4F5C\u68C0\u6D4B - ${trace.operationType} \u8017\u65F6 ${trace.durationMs}ms`, trace.metadata);
  }
  const key = `latency_${trace.operationType}`;
  if (!metricAggregates.has(key)) {
    if (metricAggregates.size >= 200) {
      const firstKey = metricAggregates.keys().next().value;
      if (firstKey) metricAggregates.delete(firstKey);
    }
    metricAggregates.set(key, []);
  }
  const values = metricAggregates.get(key);
  values.push(trace.durationMs);
  if (values.length > 100) values.shift();
}
function getAdaptiveCooldown(ruleId, baseCooldownMs) {
  const triggerCount = alertTriggerCounts.get(ruleId) || 0;
  const multiplier = Math.min(MAX_COOLDOWN_MULTIPLIER, Math.pow(2, triggerCount - 1));
  return baseCooldownMs * Math.max(1, multiplier);
}
function recordDbError(errorType) {
  if (Date.now() - dbErrorCounters.lastResetTime > 5 * 60 * 1e3) {
    dbErrorCounters.deadlock = 0;
    dbErrorCounters.dupEntry = 0;
    dbErrorCounters.apiThrottle = 0;
    dbErrorCounters.authTimeout = 0;
    dbErrorCounters.lastResetTime = Date.now();
  }
  dbErrorCounters[errorType]++;
}
function getDbErrorCounters() {
  return { ...dbErrorCounters };
}
async function evaluateAlertRules() {
  const triggered = [];
  const suppressed = [];
  const now = /* @__PURE__ */ new Date();
  for (const rule of alertRules) {
    try {
      const shouldAlert = rule.condition(metricsBuffer);
      if (shouldAlert) {
        const lastAlert = alertCooldowns.get(rule.id);
        const adaptiveCooldown = getAdaptiveCooldown(rule.id, rule.cooldownMs);
        if (lastAlert && now.getTime() - lastAlert.getTime() < adaptiveCooldown) {
          suppressed.push(rule.id);
          continue;
        }
        const message2 = rule.message(metricsBuffer);
        await sendNotification({
          userId: 0,
          type: "alert",
          severity: rule.severity,
          title: `[${rule.category.toUpperCase()}] ${rule.name}`,
          message: message2
        });
        alertCooldowns.set(rule.id, now);
        alertTriggerCounts.set(rule.id, (alertTriggerCounts.get(rule.id) || 0) + 1);
        triggered.push(rule.id);
        log25.warn(`[Observability] v268: \u544A\u8B66\u89E6\u53D1 - ${rule.name}: ${message2} (\u81EA\u9002\u5E94\u51B7\u5374=${Math.round(adaptiveCooldown / 6e4)}\u5206\u949F)`);
      }
    } catch (err) {
      log25.warn(`[Observability] v268: \u8BC4\u4F30\u544A\u8B66\u89C4\u5219 ${rule.id} \u5931\u8D25: ${err.message}`);
    }
  }
  return { triggered, suppressed };
}
async function generateHealthSummary() {
  const now = /* @__PURE__ */ new Date();
  const snapshots = await collectSystemMetrics();
  const alertResult = await evaluateAlertRules();
  const dimensions = [];
  const recommendations = [];
  const syncSnapshot = snapshots.find((s) => s.category === "sync");
  const syncRate = syncSnapshot?.metrics.sync_rate_percent ?? 100;
  const syncScore = Math.min(100, syncRate);
  dimensions.push({
    name: "API\u540C\u6B65\u5065\u5EB7\u5EA6",
    score: syncScore,
    status: syncScore >= 99 ? "excellent" : syncScore >= 95 ? "good" : syncScore >= 85 ? "warning" : "critical",
    details: `\u540C\u6B65\u7387: ${syncRate}%, \u5F85\u540C\u6B65: ${syncSnapshot?.metrics.total_pending ?? 0}, \u5931\u8D25: ${syncSnapshot?.metrics.total_failed ?? 0}`
  });
  if (syncScore < 99) {
    recommendations.push(`\u63D0\u5347API\u540C\u6B65\u7387\u81F399%+\uFF08\u5F53\u524D${syncRate}%\uFF09\uFF0C\u68C0\u67E5\u5931\u8D25\u7684\u540C\u6B65\u4EFB\u52A1\u5E76\u4FEE\u590D`);
  }
  const optSnapshot = snapshots.find((s) => s.category === "optimization");
  const dailySuccessRate = optSnapshot?.metrics.daily_success_rate ?? 100;
  const dailyTotal = (optSnapshot?.metrics.daily_executed ?? 0) + (optSnapshot?.metrics.daily_rolled_back ?? 0);
  const rollbackRate = dailyTotal > 0 ? (optSnapshot?.metrics.daily_rolled_back ?? 0) / dailyTotal * 100 : 0;
  const optScore = Math.min(100, dailySuccessRate * 0.6 + Math.max(0, 100 - rollbackRate * 3) * 0.4);
  dimensions.push({
    name: "\u4F18\u5316\u6267\u884C\u8D28\u91CF",
    score: Math.round(optScore),
    status: optScore >= 90 ? "excellent" : optScore >= 80 ? "good" : optScore >= 65 ? "warning" : "critical",
    details: `\u6210\u529F\u7387: ${dailySuccessRate}%, \u56DE\u6EDA\u7387: ${rollbackRate.toFixed(1)}%, 24h\u6267\u884C: ${optSnapshot?.metrics.daily_executed ?? 0}`
  });
  if (rollbackRate > 10) {
    recommendations.push(`\u964D\u4F4E\u56DE\u6EDA\u7387\u81F310%\u4EE5\u4E0B\uFF08\u5F53\u524D${rollbackRate.toFixed(1)}%\uFF09\uFF0C\u5206\u6790\u56DE\u6EDA\u6839\u56E0\u5E76\u4F18\u5316\u51FA\u4EF7\u4E00\u81F4\u6027`);
  }
  const relSnapshot = snapshots.find((s) => s.category === "reliability");
  const apiSuccessRate = relSnapshot?.metrics.api_success_rate ?? 100;
  const memUsage = relSnapshot?.metrics.memory_usage_mb ?? 0;
  const memScore = memUsage < 512 ? 100 : memUsage < 1024 ? 80 : memUsage < 2048 ? 60 : 40;
  const relScore = apiSuccessRate * 0.7 + memScore * 0.3;
  dimensions.push({
    name: "\u7CFB\u7EDF\u53EF\u9760\u6027",
    score: Math.round(relScore),
    status: relScore >= 95 ? "excellent" : relScore >= 85 ? "good" : relScore >= 70 ? "warning" : "critical",
    details: `API\u6210\u529F\u7387: ${apiSuccessRate}%, \u5185\u5B58: ${memUsage}MB, \u8FD0\u884C: ${relSnapshot?.metrics.uptime_hours ?? 0}h`
  });
  const activeAlerts = alertResult.triggered.length;
  const alertScore = Math.max(0, 100 - activeAlerts * 20);
  dimensions.push({
    name: "\u544A\u8B66\u5065\u5EB7\u5EA6",
    score: alertScore,
    status: alertScore >= 90 ? "excellent" : alertScore >= 70 ? "good" : alertScore >= 50 ? "warning" : "critical",
    details: `\u6D3B\u8DC3\u544A\u8B66: ${activeAlerts}, \u5DF2\u6291\u5236: ${alertResult.suppressed.length}`
  });
  const overallScore = Math.round(
    dimensions[0].score * 0.25 + dimensions[1].score * 0.25 + dimensions[2].score * 0.25 + dimensions[3].score * 0.25
  );
  let grade;
  if (overallScore >= 95) grade = "A";
  else if (overallScore >= 90) grade = "A-";
  else if (overallScore >= 85) grade = "B+";
  else if (overallScore >= 80) grade = "B";
  else if (overallScore >= 70) grade = "C";
  else if (overallScore >= 60) grade = "D";
  else grade = "F";
  const alerts = alertResult.triggered.map((id) => {
    const rule = alertRules.find((r) => r.id === id);
    return {
      id,
      severity: rule?.severity ?? "info",
      message: rule ? rule.message(metricsBuffer) : "Unknown alert"
    };
  });
  return {
    timestamp: now,
    overallScore,
    grade,
    dimensions,
    alerts,
    recommendations
  };
}
function startObservabilityService() {
  setTimeout(async () => {
    try {
      await collectSystemMetrics();
      log25.info("[Observability] v267: \u521D\u59CB\u6307\u6807\u6536\u96C6\u5B8C\u6210");
    } catch (err) {
      log25.warn(`[Observability] v267: \u521D\u59CB\u6307\u6807\u6536\u96C6\u5931\u8D25: ${err.message}`);
    }
  }, 30 * 1e3);
  observabilityInterval = setInterval(async () => {
    try {
      await collectSystemMetrics();
      const alertResult = await evaluateAlertRules();
      if (alertResult.triggered.length > 0) {
        log25.warn(`[Observability] v267: ${alertResult.triggered.length}\u4E2A\u544A\u8B66\u88AB\u89E6\u53D1: ${alertResult.triggered.join(", ")}`);
      }
    } catch (err) {
      log25.warn(`[Observability] v267: \u5B9A\u65F6\u6307\u6807\u6536\u96C6\u5931\u8D25: ${err.message}`);
    }
  }, 5 * 60 * 1e3);
  summaryInterval = setInterval(async () => {
    try {
      const summary = await generateHealthSummary();
      log25.info(`[Observability] v267: \u5065\u5EB7\u6458\u8981 - \u7B49\u7EA7: ${summary.grade} (${summary.overallScore}\u5206), \u544A\u8B66: ${summary.alerts.length}`);
      if (["C", "D", "F"].includes(summary.grade)) {
        const dimensionDetails = summary.dimensions.map((d) => `  ${d.name}: ${d.score}\u5206 (${d.status})`).join("\n");
        await sendNotification({
          userId: 0,
          type: "system",
          severity: summary.grade === "F" ? "critical" : "warning",
          title: `\u7CFB\u7EDF\u5065\u5EB7\u7B49\u7EA7: ${summary.grade} (${summary.overallScore}\u5206)`,
          message: `\u7CFB\u7EDF\u5065\u5EB7\u5EA6\u4F4E\u4E8EB\u7EA7\u6807\u51C6:

${dimensionDetails}

\u5EFA\u8BAE:
${summary.recommendations.map((r) => `\u2022 ${r}`).join("\n")}`
        });
      }
    } catch (err) {
      log25.warn(`[Observability] v267: \u5065\u5EB7\u6458\u8981\u751F\u6210\u5931\u8D25: ${err.message}`);
    }
  }, 60 * 60 * 1e3);
  log25.info("[Observability] v267: \u53EF\u89C2\u6D4B\u6027\u670D\u52A1\u5DF2\u542F\u52A8 - \u6307\u6807\u6536\u96C6: 5\u5206\u949F, \u5065\u5EB7\u6458\u8981: 1\u5C0F\u65F6");
}
function stopObservabilityService() {
  if (observabilityInterval) {
    clearInterval(observabilityInterval);
    observabilityInterval = null;
  }
  if (summaryInterval) {
    clearInterval(summaryInterval);
    summaryInterval = null;
  }
  log25.info("[Observability] v267: \u53EF\u89C2\u6D4B\u6027\u670D\u52A1\u5DF2\u505C\u6B62");
}
function getRecentMetrics(category, limit = 50) {
  let filtered = metricsBuffer;
  if (category) {
    filtered = filtered.filter((m) => m.category === category);
  }
  return filtered.slice(-limit);
}
function getLatencyStats() {
  const stats4 = {};
  for (const [key, values] of metricAggregates) {
    if (!key.startsWith("latency_")) continue;
    const opType = key.replace("latency_", "");
    const sorted = [...values].sort((a, b) => a - b);
    const count11 = sorted.length;
    if (count11 === 0) continue;
    stats4[opType] = {
      // @ts-ignore
      avg: Math.round(sorted.reduce((a, b) => a + b, 0) / count11),
      p50: sorted[Math.floor(count11 * 0.5)],
      p95: sorted[Math.floor(count11 * 0.95)],
      p99: sorted[Math.floor(count11 * 0.99)],
      count: count11
    };
  }
  return stats4;
}
function getActiveTraces() {
  return Array.from(activeTraces.values()).filter((t2) => t2.status === "started").sort((a, b) => b.startTime.getTime() - a.startTime.getTime());
}
var log25, metricsBuffer, activeTraces, metricAggregates, alertCooldowns, ALERT_COOLDOWN_MS, alertTriggerCounts, MAX_COOLDOWN_MULTIPLIER, alertRules, dbErrorCounters, observabilityInterval, summaryInterval;
var init_observabilityService = __esm({
  "server/system/observabilityService.ts"() {
    "use strict";
    init_logger();
    init_db2();
    init_schema2();
    init_drizzle_orm();
    init_notificationService();
    log25 = createModuleLogger("Observability");
    metricsBuffer = [];
    activeTraces = /* @__PURE__ */ new Map();
    metricAggregates = /* @__PURE__ */ new Map();
    alertCooldowns = /* @__PURE__ */ new Map();
    ALERT_COOLDOWN_MS = 30 * 60 * 1e3;
    __name(collectSystemMetrics, "collectSystemMetrics");
    __name(collectSyncMetrics, "collectSyncMetrics");
    __name(collectOptimizationMetrics, "collectOptimizationMetrics");
    __name(collectReliabilityMetrics, "collectReliabilityMetrics");
    __name(startTrace, "startTrace");
    __name(endTrace, "endTrace");
    alertTriggerCounts = /* @__PURE__ */ new Map();
    MAX_COOLDOWN_MULTIPLIER = 4;
    __name(getAdaptiveCooldown, "getAdaptiveCooldown");
    alertRules = [
      {
        id: "sync_rate_drop",
        name: "API\u540C\u6B65\u7387\u4E0B\u964D",
        category: "sync",
        condition: /* @__PURE__ */ __name((metrics) => {
          const syncMetrics = metrics.filter((m) => m.category === "sync");
          if (syncMetrics.length === 0) return false;
          const latest = syncMetrics[syncMetrics.length - 1];
          return latest.metrics.sync_rate_percent < 95;
        }, "condition"),
        severity: "critical",
        message: /* @__PURE__ */ __name((metrics) => {
          const syncMetrics = metrics.filter((m) => m.category === "sync");
          const latest = syncMetrics[syncMetrics.length - 1];
          return `API\u540C\u6B65\u7387\u964D\u81F3 ${latest.metrics.sync_rate_percent}%\uFF0C\u4F4E\u4E8EA\u7EA7\u6807\u51C6(95%)\u3002\u5F85\u540C\u6B65: ${latest.metrics.total_pending}\uFF0C\u5931\u8D25: ${latest.metrics.total_failed}`;
        }, "message"),
        cooldownMs: 30 * 60 * 1e3
        // 30分钟
      },
      {
        id: "sync_rate_warning",
        name: "API\u540C\u6B65\u7387\u9884\u8B66",
        category: "sync",
        condition: /* @__PURE__ */ __name((metrics) => {
          const syncMetrics = metrics.filter((m) => m.category === "sync");
          if (syncMetrics.length === 0) return false;
          const latest = syncMetrics[syncMetrics.length - 1];
          return latest.metrics.sync_rate_percent >= 95 && latest.metrics.sync_rate_percent < 99;
        }, "condition"),
        severity: "warning",
        message: /* @__PURE__ */ __name((metrics) => {
          const syncMetrics = metrics.filter((m) => m.category === "sync");
          const latest = syncMetrics[syncMetrics.length - 1];
          return `API\u540C\u6B65\u7387\u4E3A ${latest.metrics.sync_rate_percent}%\uFF0C\u63A5\u8FD1A\u7EA7\u6807\u51C6\u4E0B\u9650\u3002\u5EFA\u8BAE\u5173\u6CE8\u3002`;
        }, "message"),
        cooldownMs: 60 * 60 * 1e3
        // 1小时
      },
      {
        id: "high_rollback_rate",
        name: "\u56DE\u6EDA\u7387\u8FC7\u9AD8",
        category: "optimization",
        condition: /* @__PURE__ */ __name((metrics) => {
          const optMetrics = metrics.filter((m) => m.category === "optimization");
          if (optMetrics.length === 0) return false;
          const latest = optMetrics[optMetrics.length - 1];
          const total = latest.metrics.daily_executed + latest.metrics.daily_rolled_back;
          if (total < 10) return false;
          const rollbackRate = latest.metrics.daily_rolled_back / total * 100;
          return rollbackRate > 15;
        }, "condition"),
        severity: "warning",
        message: /* @__PURE__ */ __name((metrics) => {
          const optMetrics = metrics.filter((m) => m.category === "optimization");
          const latest = optMetrics[optMetrics.length - 1];
          const total = latest.metrics.daily_executed + latest.metrics.daily_rolled_back;
          const rollbackRate = total > 0 ? (latest.metrics.daily_rolled_back / total * 100).toFixed(1) : "0";
          return `24\u5C0F\u65F6\u56DE\u6EDA\u7387 ${rollbackRate}%\uFF0C\u8D85\u8FC7A\u7EA7\u6807\u51C6(10%)\u3002\u5DF2\u56DE\u6EDA: ${latest.metrics.daily_rolled_back}/${total}`;
        }, "message"),
        cooldownMs: 2 * 60 * 60 * 1e3
        // 2小时
      },
      {
        id: "optimization_failure_spike",
        name: "\u4F18\u5316\u6267\u884C\u5931\u8D25\u6FC0\u589E",
        category: "optimization",
        condition: /* @__PURE__ */ __name((metrics) => {
          const optMetrics = metrics.filter((m) => m.category === "optimization");
          if (optMetrics.length === 0) return false;
          const latest = optMetrics[optMetrics.length - 1];
          return latest.metrics.hourly_failed > 5;
        }, "condition"),
        severity: "critical",
        message: /* @__PURE__ */ __name((metrics) => {
          const optMetrics = metrics.filter((m) => m.category === "optimization");
          const latest = optMetrics[optMetrics.length - 1];
          return `\u6700\u8FD11\u5C0F\u65F6\u4F18\u5316\u6267\u884C\u5931\u8D25 ${latest.metrics.hourly_failed} \u6B21\uFF01\u6210\u529F\u7387: ${latest.metrics.hourly_success_rate}%`;
        }, "message"),
        cooldownMs: 15 * 60 * 1e3
        // 15分钟
      },
      {
        id: "api_failure_rate",
        name: "API\u8C03\u7528\u5931\u8D25\u7387\u8FC7\u9AD8",
        category: "reliability",
        condition: /* @__PURE__ */ __name((metrics) => {
          const relMetrics = metrics.filter((m) => m.category === "reliability");
          if (relMetrics.length === 0) return false;
          const latest = relMetrics[relMetrics.length - 1];
          return latest.metrics.api_success_rate < 95 && latest.metrics.api_total_calls > 10;
        }, "condition"),
        severity: "critical",
        message: /* @__PURE__ */ __name((metrics) => {
          const relMetrics = metrics.filter((m) => m.category === "reliability");
          const latest = relMetrics[relMetrics.length - 1];
          return `API\u8C03\u7528\u6210\u529F\u7387\u964D\u81F3 ${latest.metrics.api_success_rate}%\u3002\u5931\u8D25: ${latest.metrics.api_failed_calls}\uFF0C\u5F85\u5904\u7406: ${latest.metrics.api_pending_calls}`;
        }, "message"),
        cooldownMs: 15 * 60 * 1e3
      },
      {
        id: "memory_usage_high",
        name: "\u5185\u5B58\u4F7F\u7528\u8FC7\u9AD8",
        category: "reliability",
        condition: /* @__PURE__ */ __name((metrics) => {
          const relMetrics = metrics.filter((m) => m.category === "reliability");
          if (relMetrics.length === 0) return false;
          const latest = relMetrics[relMetrics.length - 1];
          return latest.metrics.memory_usage_mb > 1024;
        }, "condition"),
        severity: "warning",
        message: /* @__PURE__ */ __name((metrics) => {
          const relMetrics = metrics.filter((m) => m.category === "reliability");
          const latest = relMetrics[relMetrics.length - 1];
          return `\u5185\u5B58\u4F7F\u7528 ${latest.metrics.memory_usage_mb}MB\uFF0C\u8D85\u8FC71GB\u9608\u503C\u3002\u8FD0\u884C\u65F6\u95F4: ${latest.metrics.uptime_hours}\u5C0F\u65F6`;
        }, "message"),
        cooldownMs: 60 * 60 * 1e3
      },
      // v268 P2-1: 新增算法效能监控告警
      {
        id: "advanced_algorithm_rate_low",
        name: "\u9AD8\u7EA7\u7B97\u6CD5\u6FC0\u6D3B\u7387\u8FC7\u4F4E",
        category: "optimization",
        condition: /* @__PURE__ */ __name((metrics) => {
          const optMetrics = metrics.filter((m) => m.category === "optimization");
          if (optMetrics.length === 0) return false;
          const latest = optMetrics[optMetrics.length - 1];
          const advancedRate = latest.metrics.advanced_algorithm_rate ?? -1;
          return advancedRate >= 0 && advancedRate < 20;
        }, "condition"),
        severity: "warning",
        message: /* @__PURE__ */ __name((metrics) => {
          const optMetrics = metrics.filter((m) => m.category === "optimization");
          const latest = optMetrics[optMetrics.length - 1];
          return `\u9AD8\u7EA7\u7B97\u6CD5\u6FC0\u6D3B\u7387\u4EC5 ${(latest.metrics.advanced_algorithm_rate ?? 0).toFixed(1)}%\uFF0C\u4F4E\u4E8Ev268\u76EE\u6807(30%)\u3002\u5EFA\u8BAE\u68C0\u67E5RL\u6570\u636E\u79EF\u7D2F\u548C\u6A21\u578B\u8BAD\u7EC3\u72B6\u6001\u3002`;
        }, "message"),
        cooldownMs: 4 * 60 * 60 * 1e3
        // 4小时
      },
      {
        id: "positive_rate_declining",
        name: "\u4F18\u5316\u6B63\u5411\u7387\u4E0B\u964D",
        category: "optimization",
        condition: /* @__PURE__ */ __name((metrics) => {
          const optMetrics = metrics.filter((m) => m.category === "optimization");
          if (optMetrics.length === 0) return false;
          const latest = optMetrics[optMetrics.length - 1];
          const positiveRate = latest.metrics.positive_rate ?? -1;
          return positiveRate >= 0 && positiveRate < 50;
        }, "condition"),
        severity: "warning",
        message: /* @__PURE__ */ __name((metrics) => {
          const optMetrics = metrics.filter((m) => m.category === "optimization");
          const latest = optMetrics[optMetrics.length - 1];
          return `\u4F18\u5316\u6B63\u5411\u7387\u4EC5 ${(latest.metrics.positive_rate ?? 0).toFixed(1)}%\uFF0C\u4F4E\u4E8E\u5065\u5EB7\u9608\u503C(50%)\u3002\u7CFB\u7EDF\u53EF\u80FD\u5B58\u5728\u7B97\u6CD5\u504F\u5DEE\u6216\u6570\u636E\u8D28\u91CF\u95EE\u9898\u3002`;
        }, "message"),
        cooldownMs: 6 * 60 * 60 * 1e3
        // 6小时
      },
      {
        id: "rl_data_stale",
        name: "RL\u6570\u636E\u56DE\u586B\u505C\u6EDE",
        category: "performance",
        condition: /* @__PURE__ */ __name((metrics) => {
          const optMetrics = metrics.filter((m) => m.category === "optimization");
          if (optMetrics.length === 0) return false;
          const latest = optMetrics[optMetrics.length - 1];
          const rlBackfillRate = latest.metrics.rl_backfill_rate ?? -1;
          return rlBackfillRate >= 0 && rlBackfillRate < 30;
        }, "condition"),
        severity: "info",
        message: /* @__PURE__ */ __name((metrics) => {
          const optMetrics = metrics.filter((m) => m.category === "optimization");
          const latest = optMetrics[optMetrics.length - 1];
          return `RL\u6570\u636E\u56DE\u586B\u7387\u4EC5 ${(latest.metrics.rl_backfill_rate ?? 0).toFixed(1)}%\uFF0C\u5F71\u54CD\u9AD8\u7EA7\u7B97\u6CD5\u8BAD\u7EC3\u6548\u679C\u3002\u5EFA\u8BAE\u68C0\u67E5reward\u56DE\u586B\u94FE\u8DEF\u3002`;
        }, "message"),
        cooldownMs: 8 * 60 * 60 * 1e3
        // 8小时
      },
      // v614i-fix8: 3.4.1 细粒度错误告警 — 数据库死锁和重复键告警
      {
        id: "db_deadlock_spike",
        name: "\u6570\u636E\u5E93\u6B7B\u9501\u9891\u7E41",
        category: "reliability",
        condition: /* @__PURE__ */ __name(() => {
          return dbErrorCounters.deadlock > 3;
        }, "condition"),
        severity: "critical",
        message: /* @__PURE__ */ __name(() => {
          return `\u6570\u636E\u5E93\u6B7B\u9501\u9891\u7E41! \u6700\u8FD15\u5206\u949F\u5185\u53D1\u751F ${dbErrorCounters.deadlock} \u6B21Deadlock\u3002\u5EFA\u8BAE\u68C0\u67E5\u4E8B\u52A1\u8303\u56F4\u548C\u9501\u7ADE\u4E89\u3002`;
        }, "message"),
        cooldownMs: 15 * 60 * 1e3
        // 15分钟
      },
      {
        id: "db_dup_entry_spike",
        name: "\u6570\u636E\u5E93\u91CD\u590D\u952E\u9519\u8BEF\u6FC0\u589E",
        category: "reliability",
        condition: /* @__PURE__ */ __name(() => {
          return dbErrorCounters.dupEntry > 50;
        }, "condition"),
        severity: "warning",
        message: /* @__PURE__ */ __name(() => {
          return `\u6570\u636E\u5E93\u91CD\u590D\u952E\u9519\u8BEF\u6FC0\u589E! \u6700\u8FD15\u5206\u949F\u5185\u53D1\u751F ${dbErrorCounters.dupEntry} \u6B21ER_DUP_ENTRY\u3002\u53EF\u80FD\u5B58\u5728\u5E76\u53D1\u5199\u5165\u51B2\u7A81\u3002`;
        }, "message"),
        cooldownMs: 30 * 60 * 1e3
        // 30分钟
      },
      {
        id: "api_throttle_excessive",
        name: "API\u9650\u6D41\u8FC7\u591A",
        category: "reliability",
        condition: /* @__PURE__ */ __name(() => {
          return dbErrorCounters.apiThrottle > 500;
        }, "condition"),
        severity: "warning",
        message: /* @__PURE__ */ __name(() => {
          return `API\u9650\u6D41\u8FC7\u591A! \u6700\u8FD15\u5206\u949F\u5185\u89E6\u53D1 ${dbErrorCounters.apiThrottle} \u6B21429\u9650\u6D41\u3002\u5EFA\u8BAE\u964D\u4F4E\u540C\u6B65\u5E76\u53D1\u5EA6\u3002`;
        }, "message"),
        cooldownMs: 15 * 60 * 1e3
      },
      {
        id: "auth_timeout_spike",
        name: "\u8BA4\u8BC1\u8D85\u65F6\u9891\u7E41",
        category: "reliability",
        condition: /* @__PURE__ */ __name(() => {
          return dbErrorCounters.authTimeout > 10;
        }, "condition"),
        severity: "warning",
        message: /* @__PURE__ */ __name(() => {
          return `\u8BA4\u8BC1\u8D85\u65F6\u9891\u7E41! \u6700\u8FD15\u5206\u949F\u5185\u53D1\u751F ${dbErrorCounters.authTimeout} \u6B21\u8BA4\u8BC1\u8D85\u65F6\u3002\u53EF\u80FD\u6570\u636E\u5E93\u8FDE\u63A5\u6C60\u538B\u529B\u8FC7\u5927\u3002`;
        }, "message"),
        cooldownMs: 30 * 60 * 1e3
      }
    ];
    dbErrorCounters = {
      deadlock: 0,
      dupEntry: 0,
      apiThrottle: 0,
      authTimeout: 0,
      lastResetTime: Date.now()
    };
    __name(recordDbError, "recordDbError");
    __name(getDbErrorCounters, "getDbErrorCounters");
    __name(evaluateAlertRules, "evaluateAlertRules");
    __name(generateHealthSummary, "generateHealthSummary");
    observabilityInterval = null;
    summaryInterval = null;
    __name(startObservabilityService, "startObservabilityService");
    __name(stopObservabilityService, "stopObservabilityService");
    __name(getRecentMetrics, "getRecentMetrics");
    __name(getLatencyStats, "getLatencyStats");
    __name(getActiveTraces, "getActiveTraces");
  }
});

