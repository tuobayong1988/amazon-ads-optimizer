/**
 * v450: CloudWatch 自定义指标推送服务
 * 
 * 定期将应用健康指标推送到 CloudWatch，支持以下指标：
 * - 数据库连接池泄漏数 (LeakedConnections)
 * - 数据库连接池健康检查失败数 (HealthChecksFailed)
 * - 内存使用量 RSS (MemoryRSS)
 * - 堆内存使用量 (HeapUsed)
 * - 活跃直接连接数 (ActiveDirectConnections)
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
 * 推送指标到 CloudWatch
 */
async function pushMetrics(): Promise<void> {
  try {
    const metrics = collectMetrics();
    const client = getClient();
    
    // CloudWatch PutMetricData 每次最多20个指标
    const command = new PutMetricDataCommand({
      Namespace: NAMESPACE,
      MetricData: metrics,
    });
    
    await client.send(command);
    console.log(`[CloudWatch] Pushed ${metrics.length} metrics to ${NAMESPACE}`);
  } catch (error: any) {
    // 不要让 CloudWatch 推送失败影响应用运行
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
  console.log(`[CloudWatch] Monitor started, pushing metrics every ${PUSH_INTERVAL_MS / 1000}s to namespace: ${NAMESPACE}`);
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
    const metrics = collectMetrics();
    const client = getClient();
    
    const command = new PutMetricDataCommand({
      Namespace: NAMESPACE,
      MetricData: metrics,
    });
    
    await client.send(command);
    return { success: true, metrics: metrics.length };
  } catch (error: any) {
    return { success: false, metrics: 0, error: error.message };
  }
}
