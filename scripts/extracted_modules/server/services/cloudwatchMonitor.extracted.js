// Extracted from production dist/index.js
// Original module: server/services/cloudwatchMonitor.ts
// Lines: 220

var cloudwatchMonitor_exports = {};
__export(cloudwatchMonitor_exports, {
  manualPushMetrics: () => manualPushMetrics,
  startCloudWatchMonitor: () => startCloudWatchMonitor,
  stopCloudWatchMonitor: () => stopCloudWatchMonitor
});
function getClient2() {
  if (!cloudwatch) {
    cloudwatch = new import_client_cloudwatch.CloudWatchClient({ region: process.env.AWS_REGION || "us-east-1" });
  }
  return cloudwatch;
}
async function collectRedisQueueMetrics(dimensions, now) {
  const queueMetrics = [];
  try {
    const { getRedis, isRedisAvailable } = await Promise.resolve().then(() => (init_redisClient(), redisClient_exports));
    if (!isRedisAvailable() || !getRedis()) return queueMetrics;
    const redis = getRedis();
    // Redis sync queue depths
    const queueKeys = {
      "SyncQueueHigh": "sync:queue:high",
      "SyncQueueMedium": "sync:queue:medium",
      "SyncQueueLow": "sync:queue:low",
      "SyncQueueNightly": "sync:queue:nightly",
      "SyncProcessing": "sync:processing"
    };
    for (const [metricName, key] of Object.entries(queueKeys)) {
      try {
        let len = 0;
        if (key === "sync:processing") {
          len = await redis.hlen(key);
        } else {
          len = await redis.llen(key);
        }
        queueMetrics.push({
          MetricName: metricName,
          Value: len,
          Unit: "Count",
          Timestamp: now,
          Dimensions: dimensions
        });
      } catch (_e) {}
    }
    // Report jobs status counts from database
    try {
      const { getDb } = await Promise.resolve().then(() => (init_db(), db_exports));
      const db = await getDb();
      if (db) {
        const rows = await db.execute(
          sql`SELECT status, COUNT(*) as cnt FROM report_jobs WHERE createdAt > DATE_SUB(NOW(), INTERVAL 24 HOUR) GROUP BY status`
        );
        const statusCounts = {};
        if (rows && rows[0]) {
          for (const row of rows[0]) {
            statusCounts[row.status] = parseInt(row.cnt) || 0;
          }
        }
        for (const [status, count] of Object.entries(statusCounts)) {
          queueMetrics.push({
            MetricName: `ReportJobs_${status}`,
            Value: count,
            Unit: "Count",
            Timestamp: now,
            Dimensions: dimensions
          });
        }
        // Total pending + submitted = active queue depth
        const activeDepth = (statusCounts["pending"] || 0) + (statusCounts["submitted"] || 0);
        queueMetrics.push({
          MetricName: "ReportJobsActiveDepth",
          Value: activeDepth,
          Unit: "Count",
          Timestamp: now,
          Dimensions: dimensions
        });
      }
    } catch (_dbErr) {
      console.warn(`[CloudWatch] P5e: Failed to collect report_jobs metrics: ${_dbErr.message}`);
    }
  } catch (err) {
    console.warn(`[CloudWatch] P5e: Failed to collect Redis queue metrics: ${err.message}`);
  }
  return queueMetrics;
}
function collectMetrics() {
  const now = /* @__PURE__ */ new Date();
  const memUsage = process.memoryUsage();
  const poolStats = getPoolStats();
  const dimensions = [
    { Name: "Environment", Value: process.env.NODE_ENV || "production" }
  ];
  const metrics = [
    // 连接池泄漏数 - 最关键的告警指标
    {
      MetricName: "LeakedConnections",
      Value: poolStats.leakedConnections || 0,
      Unit: "Count",
      Timestamp: now,
      Dimensions: dimensions
    },
    // 健康检查失败数
    {
      MetricName: "HealthChecksFailed",
      Value: poolStats.healthChecksFailed || 0,
      Unit: "Count",
      Timestamp: now,
      Dimensions: dimensions
    },
    // 活跃直接连接数
    {
      MetricName: "ActiveDirectConnections",
      Value: poolStats.activeDirectConnections || 0,
      Unit: "Count",
      Timestamp: now,
      Dimensions: dimensions
    },
    // 内存 RSS (MB)
    {
      MetricName: "MemoryRSS",
      Value: Math.round(memUsage.rss / 1024 / 1024),
      Unit: "Megabytes",
      Timestamp: now,
      Dimensions: dimensions
    },
    // 堆内存使用 (MB)
    {
      MetricName: "HeapUsed",
      Value: Math.round(memUsage.heapUsed / 1024 / 1024),
      Unit: "Megabytes",
      Timestamp: now,
      Dimensions: dimensions
    },
    // 连接池创建总数
    {
      MetricName: "PoolConnectionsCreated",
      Value: poolStats.created || 0,
      Unit: "Count",
      Timestamp: now,
      Dimensions: dimensions
    }
  ];
  return metrics;
}
async function pushMetrics() {
  try {
    const metrics = collectMetrics();
    // P5e: Add Redis queue depth and report_jobs metrics
    try {
      const dimensions = [{ Name: "Environment", Value: process.env.NODE_ENV || "production" }];
      const redisMetrics = await collectRedisQueueMetrics(dimensions, new Date());
      metrics.push(...redisMetrics);
      if (redisMetrics.length > 0) {
        // Log queue depths for visibility
        const queueDepths = redisMetrics.filter(m => m.MetricName.startsWith("SyncQueue") || m.MetricName === "ReportJobsActiveDepth");
        const depthStr = queueDepths.map(m => `${m.MetricName}=${m.Value}`).join(", ");
        if (depthStr) console.log(`[CloudWatch] P5e: Queue depths: ${depthStr}`);
      }
    } catch (_redisErr) {
      console.warn(`[CloudWatch] P5e: Redis metrics collection failed: ${_redisErr.message}`);
    }
    const client = getClient2();
    const command = new import_client_cloudwatch.PutMetricDataCommand({
      Namespace: NAMESPACE,
      MetricData: metrics
    });
    await client.send(command);
    console.log(`[CloudWatch] Pushed ${metrics.length} metrics to ${NAMESPACE}`);
  } catch (error48) {
    console.error(`[CloudWatch] Failed to push metrics: ${error48.message}`);
  }
}
function startCloudWatchMonitor() {
  if (process.env.NODE_ENV !== "production") {
    console.log("[CloudWatch] Skipping monitor in non-production environment");
    return;
  }
  pushMetrics();
  intervalId = setInterval(pushMetrics, PUSH_INTERVAL_MS);
  console.log(`[CloudWatch] Monitor started, pushing metrics every ${PUSH_INTERVAL_MS / 1e3}s to namespace: ${NAMESPACE}`);
}
function stopCloudWatchMonitor() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log("[CloudWatch] Monitor stopped");
  }
}
async function manualPushMetrics() {
  try {
    const metrics = collectMetrics();
    const client = getClient2();
    const command = new import_client_cloudwatch.PutMetricDataCommand({
      Namespace: NAMESPACE,
      MetricData: metrics
    });
    await client.send(command);
    return { success: true, metrics: metrics.length };
  } catch (error48) {
    return { success: false, metrics: 0, error: error48.message };
  }
}
var import_client_cloudwatch, NAMESPACE, PUSH_INTERVAL_MS, cloudwatch, intervalId;
var init_cloudwatchMonitor = __esm({
  "server/services/cloudwatchMonitor.ts"() {
    "use strict";
    import_client_cloudwatch = require("@aws-sdk/client-cloudwatch");
    init_connection();
    NAMESPACE = "AmazonAdsOptimizer";
    PUSH_INTERVAL_MS = 5 * 60 * 1e3;
    cloudwatch = null;
    intervalId = null;
    __name(getClient2, "getClient");
    __name(collectMetrics, "collectMetrics");
    __name(pushMetrics, "pushMetrics");
    __name(startCloudWatchMonitor, "startCloudWatchMonitor");
    __name(stopCloudWatchMonitor, "stopCloudWatchMonitor");
    __name(manualPushMetrics, "manualPushMetrics");
  }
});

