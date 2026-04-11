/**
 * v450 + P5e: CloudWatch 自定义指标推送服务
 * 
 * 定期将应用健康指标推送到 CloudWatch，支持以下指标：
 * - 数据库连接池泄漏数 (LeakedConnections)
 * - 数据库连接池健康检查失败数 (HealthChecksFailed)
 * - 内存使用量 RSS (MemoryRSS)
 * - 堆内存使用量 (HeapUsed)
 * - 活跃直接连接数 (ActiveDirectConnections)
 * - P5e: Redis 队列深度 (RedisQueueDepth)
 * - P5e: 报告任务状态分布 (ReportJobsPending/Submitted/Failed)
 */

import { CloudWatchClient, PutMetricDataCommand, type MetricDatum } from '@aws-sdk/client-cloudwatch';
import { getPoolStats } from '../db/connection';

const NAMESPACE = 'AmazonAdsOptimizer';
const PUSH_INTERVAL_MS = 5 * 60 * 1000; // 每5分钟推送一次

let cloudwatch: CloudWatchClient | null = null;
let intervalId: ReturnType<typeof setInterval> | null = null;

function getClient(): CloudWatchClient {
  if (!cloudwatch) {
    cloudwatch = new CloudWatchClient({ region: process.env.AWS_REGION || 'us-east-1' });
  }
  return cloudwatch;
}

/**
 * 收集当前应用健康指标
 */
function collectMetrics(): MetricDatum[] {
  const now = new Date();
  const memUsage = process.memoryUsage();
  const poolStats = getPoolStats();
  
  const dimensions = [
    { Name: 'Environment', Value: process.env.NODE_ENV || 'production' },
  ];

  const metrics: MetricDatum[] = [
    // 连接池泄漏数 - 最关键的告警指标
    {
      MetricName: 'LeakedConnections',
      Value: poolStats.leakedConnections || 0,
      Unit: 'Count',
      Timestamp: now,
      Dimensions: dimensions,
    },
    // 健康检查失败数
    {
      MetricName: 'HealthChecksFailed',
      Value: poolStats.healthChecksFailed || 0,
      Unit: 'Count',
      Timestamp: now,
      Dimensions: dimensions,
    },
    // 活跃直接连接数
    {
      MetricName: 'ActiveDirectConnections',
      Value: poolStats.activeDirectConnections || 0,
      Unit: 'Count',
      Timestamp: now,
      Dimensions: dimensions,
    },
    // 内存 RSS (MB)
    {
      MetricName: 'MemoryRSS',
      Value: Math.round(memUsage.rss / 1024 / 1024),
      Unit: 'Megabytes',
      Timestamp: now,
      Dimensions: dimensions,
    },
    // 堆内存使用 (MB)
    {
      MetricName: 'HeapUsed',
      Value: Math.round(memUsage.heapUsed / 1024 / 1024),
      Unit: 'Megabytes',
      Timestamp: now,
      Dimensions: dimensions,
    },
    // 连接池创建总数
    {
      MetricName: 'PoolConnectionsCreated',
      Value: poolStats.created || 0,
      Unit: 'Count',
      Timestamp: now,
      Dimensions: dimensions,
    },
  ];

  return metrics;
}

/**
 * P5e: 收集 Redis 队列深度指标
 */
async function collectRedisQueueMetrics(): Promise<MetricDatum[]> {
  const metrics: MetricDatum[] = [];
  const now = new Date();
  const dimensions = [
    { Name: 'Environment', Value: process.env.NODE_ENV || 'production' },
  ];

  try {
    const { getRedis, isRedisAvailable } = await import('../utils/redisClient');
    if (!isRedisAvailable() || !getRedis()) return metrics;

    const redis = getRedis()!;
    const queueKeys = [
      'sync:task:queue:critical',
      'sync:task:queue:high',
      'sync:task:queue:medium',
      'sync:task:queue:low',
    ];

    let totalDepth = 0;
    for (const key of queueKeys) {
      const len = await redis.llen(key);
      totalDepth += len;
    }

    metrics.push({
      MetricName: 'RedisQueueDepth',
      Value: totalDepth,
      Unit: 'Count',
      Timestamp: now,
      Dimensions: dimensions,
    });
  } catch (_err) {
    // Redis 不可用时跳过
  }

  return metrics;
}

/**
 * P5e: 收集 report_jobs 状态分布指标
 */
async function collectReportJobMetrics(): Promise<MetricDatum[]> {
  const metrics: MetricDatum[] = [];
  const now = new Date();
  const dimensions = [
    { Name: 'Environment', Value: process.env.NODE_ENV || 'production' },
  ];

  try {
    const { getDb } = await import('../db');
    const { reportJobs } = await import('../../drizzle/schema');
    const { sql } = await import('drizzle-orm');
    const db = await getDb();
    if (!db) return metrics;

    const statusCounts = await db.select({
      status: reportJobs.status,
      count: sql<number>`count(*)`,
    }).from(reportJobs).groupBy(reportJobs.status);

    const statusMap: Record<string, number> = {};
    for (const row of statusCounts) {
      statusMap[row.status] = Number(row.count);
    }

    // 推送关键状态指标
    const statusMetrics: Array<[string, string]> = [
      ['ReportJobsPending', 'pending'],
      ['ReportJobsSubmitted', 'submitted'],
      ['ReportJobsCompleted', 'completed'],
      ['ReportJobsFailed', 'failed'],
    ];

    for (const [metricName, status] of statusMetrics) {
      metrics.push({
        MetricName: metricName,
        Value: statusMap[status] || 0,
        Unit: 'Count',
        Timestamp: now,
        Dimensions: dimensions,
      });
    }
  } catch (_err) {
    // DB 不可用时跳过
  }

  return metrics;
}

/**
 * 推送指标到 CloudWatch
 */
async function pushMetrics(): Promise<void> {
  try {
    const baseMetrics = collectMetrics();
    
    // P5e: 收集 Redis 和 report_jobs 指标
    const redisMetrics = await collectRedisQueueMetrics();
    const reportJobMetrics = await collectReportJobMetrics();
    
    const allMetrics = [...baseMetrics, ...redisMetrics, ...reportJobMetrics];
    const client = getClient();
    
    // CloudWatch PutMetricData 每次最多20个指标
    for (let i = 0; i < allMetrics.length; i += 20) {
      const batch = allMetrics.slice(i, i + 20);
      const command = new PutMetricDataCommand({
        Namespace: NAMESPACE,
        MetricData: batch,
      });
      await client.send(command);
    }
    
    console.log(`[CloudWatch] P5e: Pushed ${allMetrics.length} metrics to ${NAMESPACE} (base=${baseMetrics.length}, redis=${redisMetrics.length}, reportJobs=${reportJobMetrics.length})`);
  } catch (error: unknown) {
    // 不要让 CloudWatch 推送失败影响应用运行
    // @ts-ignore
    console.error(`[CloudWatch] Failed to push metrics: ${error.message}`);
  }
}

/**
 * 启动定期指标推送
 */
export function startCloudWatchMonitor(): void {
  // 仅在生产环境启用
  if (process.env.NODE_ENV !== 'production') {
    console.log('[CloudWatch] Skipping monitor in non-production environment');
    return;
  }
  
  // 立即推送一次
  pushMetrics();
  
  // 设置定时推送
  intervalId = setInterval(pushMetrics, PUSH_INTERVAL_MS);
  console.log(`[CloudWatch] P5e: Monitor started with Redis queue + report_jobs metrics, pushing every ${PUSH_INTERVAL_MS / 1000}s to namespace: ${NAMESPACE}`);
}

/**
 * 停止指标推送
 */
export function stopCloudWatchMonitor(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log('[CloudWatch] Monitor stopped');
  }
}

/**
 * 手动触发一次指标推送（用于OPS端点）
 */
export async function manualPushMetrics(): Promise<{ success: boolean; metrics: number; error?: string }> {
  try {
    const baseMetrics = collectMetrics();
    const redisMetrics = await collectRedisQueueMetrics();
    const reportJobMetrics = await collectReportJobMetrics();
    const allMetrics = [...baseMetrics, ...redisMetrics, ...reportJobMetrics];
    const client = getClient();
    
    for (let i = 0; i < allMetrics.length; i += 20) {
      const batch = allMetrics.slice(i, i + 20);
      const command = new PutMetricDataCommand({
        Namespace: NAMESPACE,
        MetricData: batch,
      });
      await client.send(command);
    }
    
    return { success: true, metrics: allMetrics.length };
  // @ts-ignore
  } catch (error: unknown) {
    // @ts-ignore
    return { success: false, metrics: 0, error: error.message };
  }
}
