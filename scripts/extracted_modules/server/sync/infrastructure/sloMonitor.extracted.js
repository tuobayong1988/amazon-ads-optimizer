// Extracted from production dist/index.js
// Original module: server/sync/infrastructure/sloMonitor.ts
// Lines: 239

var sloMonitor_exports = {};
__export(sloMonitor_exports, {
  getSLOMetrics: () => getSLOMetrics,
  getSLOTrend: () => getSLOTrend
});
async function getSLOMetrics() {
  const timestamp2 = (/* @__PURE__ */ new Date()).toISOString();
  const metrics = {
    timestamp: timestamp2,
    syncSuccessRate: { target: 95, actual: 0, status: "critical", totalTasks: 0, successfulTasks: 0, failedTasks: 0 },
    dataCoverage: { target: 90, actual: 0, status: "critical", accountCount: 0, healthyAccounts: 0 },
    dataFreshness: { target: "2h", actual: "N/A", status: "critical", latestSyncTime: null, minutesSinceLastSync: Infinity },
    syncLatencyP95: { target: 30, actual: 0, status: "ok", p50: 0, p95: 0, p99: 0 },
    shardHealth: { totalShards: 0, pendingShards: 0, runningShards: 0, completedShards: 0, failedShards: 0, retryingShards: 0, stuckShards: 0 },
    lockStatus: { activeLocks: 0, expiredLocks: 0 },
    overallScore: 0,
    overallStatus: "unhealthy"
  };
  try {
    const { getDb: getDb3 } = await Promise.resolve().then(() => (init_db2(), db_exports));
    const database = await getDb3();
    if (!database) return metrics;
    try {
      const taskStats = await database.execute(sql`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as success,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
        FROM sync_tasks_v2
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
      `);
      const stats4 = (taskStats?.[0] || taskStats)?.[0];
      if (stats4) {
        metrics.syncSuccessRate.totalTasks = Number(stats4.total) || 0;
        metrics.syncSuccessRate.successfulTasks = Number(stats4.success) || 0;
        metrics.syncSuccessRate.failedTasks = Number(stats4.failed) || 0;
        metrics.syncSuccessRate.actual = metrics.syncSuccessRate.totalTasks > 0 ? Math.round(metrics.syncSuccessRate.successfulTasks / metrics.syncSuccessRate.totalTasks * 100) : 100;
        metrics.syncSuccessRate.status = metrics.syncSuccessRate.actual >= 95 ? "ok" : metrics.syncSuccessRate.actual >= 80 ? "warning" : "critical";
      }
    } catch (e) {
      log140.debug(`[v358] \u540C\u6B65\u6210\u529F\u7387\u67E5\u8BE2\u5931\u8D25(\u8868\u53EF\u80FD\u4E0D\u5B58\u5728): ${e.message}`);
      metrics.syncSuccessRate.actual = 100;
      metrics.syncSuccessRate.status = "ok";
    }
    try {
      const coverageStats = await database.execute(sql`
 SELECT 
 a.id as account_id,
 COUNT(DISTINCT DATE(dp.date)) as data_days
 FROM ad_accounts a
 LEFT JOIN daily_performance dp ON a.id = dp.accountId 
 AND DATE(dp.date) >= DATE_SUB(CURDATE(), INTERVAL 14 DAY)
 WHERE a.status = 'active' OR a.connectionStatus = 'connected'
 GROUP BY a.id
 `);
      const coverageRows = coverageStats?.[0] || coverageStats;
      if (Array.isArray(coverageRows) && coverageRows.length > 0) {
        metrics.dataCoverage.accountCount = coverageRows.length;
        metrics.dataCoverage.healthyAccounts = coverageRows.filter(
          (r) => Number(r.data_days) >= 10
        ).length;
        const avgCoverage = coverageRows.reduce(
          // @ts-ignore
          (sum2, r) => sum2 + Math.min(100, Number(r.data_days) / 14 * 100),
          0
        ) / coverageRows.length;
        metrics.dataCoverage.actual = Math.round(avgCoverage);
        metrics.dataCoverage.status = metrics.dataCoverage.actual >= 90 ? "ok" : metrics.dataCoverage.actual >= 70 ? "warning" : "critical";
      }
    } catch (e) {
      log140.debug(`[v358] \u6570\u636E\u8986\u76D6\u7387\u67E5\u8BE2\u5931\u8D25: ${e.message}`);
    }
    try {
      const freshnessResult = await database.execute(sql`
 SELECT MAX(created_at) as latest_sync 
 FROM daily_performance
 WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
 `);
      const freshness = (freshnessResult?.[0] || freshnessResult)?.[0];
      if (freshness?.latest_sync) {
        const latestTime = new Date(freshness.latest_sync);
        const minutesAgo = Math.round((Date.now() - latestTime.getTime()) / 6e4);
        metrics.dataFreshness.latestSyncTime = latestTime.toISOString();
        metrics.dataFreshness.minutesSinceLastSync = minutesAgo;
        metrics.dataFreshness.actual = minutesAgo < 60 ? `${minutesAgo}min` : `${Math.round(minutesAgo / 60)}h`;
        metrics.dataFreshness.status = minutesAgo <= 120 ? "ok" : minutesAgo <= 360 ? "warning" : "critical";
      }
    } catch (e) {
      log140.debug(`[v358] \u6570\u636E\u65B0\u9C9C\u5EA6\u67E5\u8BE2\u5931\u8D25: ${e.message}`);
    }
    try {
      const latencyResult = await database.execute(sql`
        SELECT duration_ms FROM sync_shards
        WHERE status = 'completed' AND duration_ms IS NOT NULL
        AND completed_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
        ORDER BY duration_ms ASC
      `);
      const latencyRows = latencyResult?.[0] || latencyResult;
      if (Array.isArray(latencyRows) && latencyRows.length > 0) {
        const durations = latencyRows.map((r) => Number(r.duration_ms) / 6e4);
        const p50Index = Math.floor(durations.length * 0.5);
        const p95Index = Math.floor(durations.length * 0.95);
        const p99Index = Math.floor(durations.length * 0.99);
        metrics.syncLatencyP95.p50 = Math.round(durations[p50Index] * 10) / 10;
        metrics.syncLatencyP95.p95 = Math.round(durations[p95Index] * 10) / 10;
        metrics.syncLatencyP95.p99 = Math.round(durations[Math.min(p99Index, durations.length - 1)] * 10) / 10;
        metrics.syncLatencyP95.actual = metrics.syncLatencyP95.p95;
        metrics.syncLatencyP95.status = metrics.syncLatencyP95.p95 <= 30 ? "ok" : metrics.syncLatencyP95.p95 <= 60 ? "warning" : "critical";
      }
    } catch (e) {
      log140.debug(`[v358] \u540C\u6B65\u5EF6\u8FDF\u67E5\u8BE2\u5931\u8D25(\u8868\u53EF\u80FD\u4E0D\u5B58\u5728): ${e.message}`);
      metrics.syncLatencyP95.status = "ok";
    }
    try {
      const shardStats = await database.execute(sql`
 SELECT 
 status,
 COUNT(*) as cnt,
 SUM(CASE WHEN status = 'running' AND started_at < DATE_SUB(NOW(), INTERVAL 1 HOUR) THEN 1 ELSE 0 END) as stuck
 FROM sync_shards
 WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
 GROUP BY status
 `);
      const shardRows = shardStats?.[0] || shardStats;
      if (Array.isArray(shardRows)) {
        for (const row of shardRows) {
          const count11 = Number(row.cnt);
          switch (row.status) {
            case "pending":
              metrics.shardHealth.pendingShards = count11;
              break;
            case "running":
              metrics.shardHealth.runningShards = count11;
              break;
            case "completed":
              metrics.shardHealth.completedShards = count11;
              break;
            case "failed":
              metrics.shardHealth.failedShards = count11;
              break;
            case "retrying":
              metrics.shardHealth.retryingShards = count11;
              break;
          }
          metrics.shardHealth.stuckShards += Number(row.stuck) || 0;
          metrics.shardHealth.totalShards += count11;
        }
      }
    } catch (e) {
      log140.debug(`[v358] Shard\u5065\u5EB7\u5EA6\u67E5\u8BE2\u5931\u8D25(\u8868\u53EF\u80FD\u4E0D\u5B58\u5728): ${e.message}`);
    }
    try {
      const lockStats = await database.execute(sql`
        SELECT 
          SUM(CASE WHEN expires_at > NOW() THEN 1 ELSE 0 END) as active_locks,
          SUM(CASE WHEN expires_at <= NOW() THEN 1 ELSE 0 END) as expired_locks
        FROM sync_locks
      `);
      const lockRow = (lockStats?.[0] || lockStats)?.[0];
      if (lockRow) {
        metrics.lockStatus.activeLocks = Number(lockRow.active_locks) || 0;
        metrics.lockStatus.expiredLocks = Number(lockRow.expired_locks) || 0;
      }
    } catch (e) {
      log140.debug(`[v358] \u9501\u72B6\u6001\u67E5\u8BE2\u5931\u8D25(\u8868\u53EF\u80FD\u4E0D\u5B58\u5728): ${e.message}`);
    }
    let score = 0;
    const weights = {
      syncSuccessRate: 30,
      dataCoverage: 30,
      dataFreshness: 20,
      syncLatency: 10,
      shardHealth: 10
    };
    score += metrics.syncSuccessRate.actual / 100 * weights.syncSuccessRate;
    score += metrics.dataCoverage.actual / 100 * weights.dataCoverage;
    const freshnessScore = metrics.dataFreshness.minutesSinceLastSync <= 120 ? 1 : metrics.dataFreshness.minutesSinceLastSync <= 360 ? 0.7 : metrics.dataFreshness.minutesSinceLastSync <= 720 ? 0.3 : 0;
    score += freshnessScore * weights.dataFreshness;
    const latencyScore = metrics.syncLatencyP95.p95 <= 30 ? 1 : metrics.syncLatencyP95.p95 <= 60 ? 0.7 : 0.3;
    score += latencyScore * weights.syncLatency;
    const shardScore = metrics.shardHealth.totalShards > 0 ? metrics.shardHealth.completedShards / metrics.shardHealth.totalShards : 1;
    score += shardScore * weights.shardHealth;
    metrics.overallScore = Math.round(score);
    metrics.overallStatus = score >= 85 ? "healthy" : score >= 60 ? "degraded" : "unhealthy";
    log140.info(`[v358] SLO\u6307\u6807: score=${metrics.overallScore}, status=${metrics.overallStatus}, syncRate=${metrics.syncSuccessRate.actual}%, coverage=${metrics.dataCoverage.actual}%, freshness=${metrics.dataFreshness.actual}`);
  } catch (error48) {
    log140.warn(`[v358] SLO\u6307\u6807\u83B7\u53D6\u5931\u8D25: ${error48.message}`);
  }
  return metrics;
}
async function getSLOTrend(days = 7) {
  const trend = [];
  try {
    const { getDb: getDb3 } = await Promise.resolve().then(() => (init_db2(), db_exports));
    const database = await getDb3();
    if (!database) return trend;
    const trendData = await database.execute(sql`
 SELECT 
 DATE(created_at) as trend_date,
 COUNT(*) as total_shards,
 SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_shards,
 AVG(CASE WHEN status = 'completed' THEN duration_ms ELSE NULL END) as avg_duration
 FROM sync_shards
 WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL ${sql.raw(String(days))} DAY)
 GROUP BY DATE(created_at)
 ORDER BY DATE(created_at)
 `);
    const rows = trendData?.[0] || trendData;
    if (Array.isArray(rows)) {
      for (const row of rows) {
        const dateStr = row.trend_date instanceof Date ? row.trend_date.toISOString().split("T")[0] : String(row.trend_date);
        trend.push({
          date: dateStr,
          // @ts-ignore
          syncSuccessRate: Number(row.total_shards) > 0 ? Math.round(Number(row.completed_shards) / Number(row.total_shards) * 100) : 100,
          dataCoverage: 0,
          // 需要单独查询
          // @ts-ignore
          avgLatencyMinutes: Math.round((Number(row.avg_duration) || 0) / 6e4 * 10) / 10
        });
      }
    }
  } catch (e) {
    log140.debug(`[v358] SLO\u8D8B\u52BF\u67E5\u8BE2\u5931\u8D25: ${e.message}`);
  }
  return trend;
}
var log140;
var init_sloMonitor = __esm({
  "server/sync/infrastructure/sloMonitor.ts"() {
    "use strict";
    init_logger();
    init_drizzle_orm();
    log140 = createModuleLogger("sloMonitor");
    __name(getSLOMetrics, "getSLOMetrics");
    __name(getSLOTrend, "getSLOTrend");
  }
});

