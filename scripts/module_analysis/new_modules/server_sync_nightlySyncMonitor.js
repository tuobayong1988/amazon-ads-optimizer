// server/sync/nightlySyncMonitor.ts
var nightlySyncMonitor_exports = {};
__export(nightlySyncMonitor_exports, {
  getMonitorSnapshots: () => getMonitorSnapshots,
  getMonitorSummary: () => getMonitorSummary,
  startNightlyMonitor: () => startNightlyMonitor,
  stopNightlyMonitor: () => stopNightlyMonitor
});
function startNightlyMonitor(tier2) {
  if (_monitorTimer) {
    log142.info(`\u76D1\u63A7\u5DF2\u5728\u8FD0\u884C\u4E2D(${_currentTier})\uFF0C\u5207\u6362\u5230 ${tier2}`);
    stopNightlyMonitor();
  }
  _currentTier = tier2;
  _startTime = Date.now();
  _consecutiveHeapIncreases = 0;
  _lastHeapUsedMB = 0;
  collectSnapshot();
  _monitorTimer = setInterval(() => {
    collectSnapshot();
  }, SAMPLE_INTERVAL_MS);
  if (_monitorTimer.unref) _monitorTimer.unref();
  log142.info(`${tier2}\u5C42\u6301\u7EED\u76D1\u63A7\u5DF2\u542F\u52A8\uFF0C\u6BCF${SAMPLE_INTERVAL_MS / 6e4}\u5206\u949F\u91C7\u6837\u4E00\u6B21`);
}
function stopNightlyMonitor() {
  if (_monitorTimer) {
    clearInterval(_monitorTimer);
    _monitorTimer = null;
  }
  if (_currentTier) {
    collectSnapshot();
    const elapsed = Math.round((Date.now() - _startTime) / 6e4);
    const snapshotCount = _snapshots.filter((s) => s.tier === _currentTier).length;
    log142.info(`${_currentTier}\u5C42\u6301\u7EED\u76D1\u63A7\u5DF2\u505C\u6B62\uFF0C\u8FD0\u884C${elapsed}\u5206\u949F\uFF0C\u91C7\u96C6${snapshotCount}\u4E2A\u5FEB\u7167`);
    _currentTier = null;
  }
}
function getMonitorSnapshots(tier2, limit = 50) {
  let result = tier2 ? _snapshots.filter((s) => s.tier === tier2) : [..._snapshots];
  return result.slice(-limit);
}
function getMonitorSummary() {
  const isRunning2 = _monitorTimer !== null;
  const latestSnapshot = _snapshots.length > 0 ? _snapshots[_snapshots.length - 1] : null;
  let memoryTrend = "unknown";
  const recentSnapshots = _snapshots.slice(-6);
  if (recentSnapshots.length >= 3) {
    const heapValues = recentSnapshots.map((s) => s.memory.heapUsedMB);
    const increases = heapValues.slice(1).filter((v, i) => v > heapValues[i]).length;
    const decreases = heapValues.slice(1).filter((v, i) => v < heapValues[i]).length;
    if (increases > decreases + 1) memoryTrend = "increasing";
    else if (decreases > increases + 1) memoryTrend = "decreasing";
    else memoryTrend = "stable";
  }
  const alerts = [];
  if (latestSnapshot) {
    alerts.push(...latestSnapshot.alerts);
  }
  if (memoryTrend === "increasing" && _consecutiveHeapIncreases >= 3) {
    alerts.push(`\u5185\u5B58\u6301\u7EED\u589E\u957F: \u8FDE\u7EED${_consecutiveHeapIncreases}\u6B21\u91C7\u6837Heap\u589E\u52A0`);
  }
  return {
    isRunning: isRunning2,
    currentTier: _currentTier,
    elapsedMinutes: isRunning2 ? Math.round((Date.now() - _startTime) / 6e4) : 0,
    snapshotCount: _snapshots.length,
    latestSnapshot,
    memoryTrend,
    alerts
  };
}
function collectSnapshot() {
  try {
    const now = Date.now();
    const mem = process.memoryUsage();
    const loggerStatus = logger.getStatus();
    const alerts = [];
    const snapshot = {
      timestamp: new Date(now).toISOString(),
      tier: _currentTier || "unknown",
      elapsedMinutes: Math.round((now - _startTime) / 6e4),
      memory: {
        rssMB: Math.round(mem.rss / 1024 / 1024),
        heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
        externalMB: Math.round(mem.external / 1024 / 1024),
        arrayBuffersMB: Math.round((mem.arrayBuffers || 0) / 1024 / 1024)
      },
      logger: {
        recentRate: loggerStatus.recentRate,
        suppressedTotal: loggerStatus.suppressedTotal,
        bufferUsagePct: Math.round(loggerStatus.bufferSize / loggerStatus.bufferCapacity * 100)
      },
      dbPool: null,
      alerts: []
    };
    try {
      const { getPoolStats: getPoolStats2 } = (init_connection(), __toCommonJS(connection_exports));
      const poolStats = getPoolStats2();
      snapshot.dbPool = {
        activeConnections: poolStats.activeDirectConnections || 0,
        borrowedConnections: poolStats.directConnBorrowed - poolStats.directConnReturned || 0
      };
    } catch {
    }
    if (snapshot.memory.heapUsedMB > HEAP_WARN_MB) {
      const alert = `Heap\u4F7F\u7528${snapshot.memory.heapUsedMB}MB\uFF0C\u8D85\u8FC7${HEAP_WARN_MB}MB\u9608\u503C`;
      alerts.push(alert);
      log142.warn(`[NightlySyncMonitor] \u26A0\uFE0F ${alert}`);
      if (typeof global.gc === "function") {
        global.gc();
        const memAfterGc = process.memoryUsage();
        const heapAfterGc = Math.round(memAfterGc.heapUsed / 1024 / 1024);
        log142.info(`[NightlySyncMonitor] GC\u5B8C\u6210: Heap ${snapshot.memory.heapUsedMB}MB \u2192 ${heapAfterGc}MB`);
      }
    }
    if (snapshot.memory.rssMB > RSS_WARN_MB) {
      const alert = `RSS\u4F7F\u7528${snapshot.memory.rssMB}MB\uFF0C\u8D85\u8FC7${RSS_WARN_MB}MB\u9608\u503C`;
      alerts.push(alert);
      log142.warn(`[NightlySyncMonitor] \u26A0\uFE0F ${alert}`);
    }
    const prevSnapshot = _snapshots.length > 0 ? _snapshots[_snapshots.length - 1] : null;
    if (prevSnapshot) {
      const suppressedDelta = snapshot.logger.suppressedTotal - prevSnapshot.logger.suppressedTotal;
      const rateDelta = snapshot.logger.recentRate * (SAMPLE_INTERVAL_MS / 6e4);
      if (rateDelta > 0) {
        const suppressedRate = Math.round(suppressedDelta / (suppressedDelta + rateDelta) * 100);
        if (suppressedRate > SUPPRESSED_RATE_WARN) {
          const alert = `\u65E5\u5FD7\u6291\u5236\u7387${suppressedRate}%\uFF0C\u8D85\u8FC7${SUPPRESSED_RATE_WARN}%\u9608\u503C`;
          alerts.push(alert);
          log142.warn(`[NightlySyncMonitor] \u26A0\uFE0F ${alert}`);
        }
      }
    }
    if (_lastHeapUsedMB > 0) {
      if (snapshot.memory.heapUsedMB > _lastHeapUsedMB + 10) {
        _consecutiveHeapIncreases++;
        if (_consecutiveHeapIncreases >= 5) {
          const alert = `\u5185\u5B58\u6301\u7EED\u589E\u957F: \u8FDE\u7EED${_consecutiveHeapIncreases}\u6B21\u91C7\u6837Heap\u589E\u52A0\uFF08\u53EF\u80FD\u5B58\u5728\u5185\u5B58\u6CC4\u6F0F\uFF09`;
          alerts.push(alert);
          log142.warn(`[NightlySyncMonitor] \u26A0\uFE0F ${alert}`);
        }
      } else {
        _consecutiveHeapIncreases = 0;
      }
    }
    _lastHeapUsedMB = snapshot.memory.heapUsedMB;
    snapshot.alerts = alerts;
    _snapshots.push(snapshot);
    if (_snapshots.length > MAX_SNAPSHOTS) {
      _snapshots = _snapshots.slice(-MAX_SNAPSHOTS);
    }
    if (_currentTier) {
      log142.info(`[NightlySyncMonitor] \u91C7\u6837 #${_snapshots.length} [${_currentTier} +${snapshot.elapsedMinutes}min]: RSS=${snapshot.memory.rssMB}MB, Heap=${snapshot.memory.heapUsedMB}/${snapshot.memory.heapTotalMB}MB, LogRate=${snapshot.logger.recentRate}/min, Buffer=${snapshot.logger.bufferUsagePct}%` + (alerts.length > 0 ? ` | ALERTS: ${alerts.join("; ")}` : ""));
    }
  } catch (err) {
    log142.warn(`[NightlySyncMonitor] \u91C7\u6837\u5931\u8D25: ${err.message}`);
  }
}
var log142, SAMPLE_INTERVAL_MS, MAX_SNAPSHOTS, HEAP_WARN_MB, RSS_WARN_MB, SUPPRESSED_RATE_WARN, _monitorTimer, _currentTier, _startTime, _snapshots, _consecutiveHeapIncreases, _lastHeapUsedMB;
var init_nightlySyncMonitor = __esm({
  "server/sync/nightlySyncMonitor.ts"() {
    "use strict";
    init_logger();
    init_logger();
    log142 = createModuleLogger("NightlySyncMonitor");
    SAMPLE_INTERVAL_MS = 5 * 60 * 1e3;
    MAX_SNAPSHOTS = 288;
    HEAP_WARN_MB = 1024;
    RSS_WARN_MB = 2048;
    SUPPRESSED_RATE_WARN = 30;
    _monitorTimer = null;
    _currentTier = null;
    _startTime = 0;
    _snapshots = [];
    _consecutiveHeapIncreases = 0;
    _lastHeapUsedMB = 0;
    __name(startNightlyMonitor, "startNightlyMonitor");
    __name(stopNightlyMonitor, "stopNightlyMonitor");
    __name(getMonitorSnapshots, "getMonitorSnapshots");
    __name(getMonitorSummary, "getMonitorSummary");
    __name(collectSnapshot, "collectSnapshot");
  }
});

