/**
 * v358: SLO监控仪表板服务
 * 
 * 提供同步系统的关键SLO指标:
 * 1. 同步成功率 (目标: ≥95%)
 * 2. 数据覆盖率 (目标: ≥90%)
 * 3. 数据新鲜度 (目标: 最近数据不超过2小时)
 * 4. 同步延迟P95 (目标: ≤30分钟)
 * 5. 错误率趋势
 */
import { createModuleLogger } from '../../utils/logger';
import { sql } from 'drizzle-orm';

const log = createModuleLogger('sloMonitor');

// ==================== SLO指标定义 ====================

export interface SLOMetrics {
  timestamp: string;
  
  // 同步成功率
  syncSuccessRate: {
    target: number;  // 95
    actual: number;
    status: 'ok' | 'warning' | 'critical';
    totalTasks: number;
    successfulTasks: number;
    failedTasks: number;
  };

  // 数据覆盖率（所有账户平均）
  dataCoverage: {
    target: number;  // 90
    actual: number;
    status: 'ok' | 'warning' | 'critical';
    accountCount: number;
    healthyAccounts: number;
  };

  // 数据新鲜度
  dataFreshness: {
    target: string;  // "2h"
    actual: string;
    status: 'ok' | 'warning' | 'critical';
    latestSyncTime: string | null;
    minutesSinceLastSync: number;
  };

  // 同步延迟P95
  syncLatencyP95: {
    target: number;  // 30 (分钟)
    actual: number;
    status: 'ok' | 'warning' | 'critical';
    p50: number;
    p95: number;
    p99: number;
  };

  // Shard系统健康度
  shardHealth: {
    totalShards: number;
    pendingShards: number;
    runningShards: number;
    completedShards: number;
    failedShards: number;
    retryingShards: number;
    stuckShards: number;  // 运行超过1小时的
  };

  // 锁状态
  lockStatus: {
    activeLocks: number;
    expiredLocks: number;
  };

  // 整体健康评分 (0-100)
  overallScore: number;
  overallStatus: 'healthy' | 'degraded' | 'unhealthy';
}

// ==================== SLO计算 ====================

/**
 * v358: 获取完整的SLO指标
 */
export async function getSLOMetrics(): Promise<SLOMetrics> {
  const timestamp = new Date().toISOString();
  
  const metrics: SLOMetrics = {
    timestamp,
    syncSuccessRate: { target: 95, actual: 0, status: 'critical', totalTasks: 0, successfulTasks: 0, failedTasks: 0 },
    dataCoverage: { target: 90, actual: 0, status: 'critical', accountCount: 0, healthyAccounts: 0 },
    dataFreshness: { target: '2h', actual: 'N/A', status: 'critical', latestSyncTime: null, minutesSinceLastSync: Infinity },
    syncLatencyP95: { target: 30, actual: 0, status: 'ok', p50: 0, p95: 0, p99: 0 },
    shardHealth: { totalShards: 0, pendingShards: 0, runningShards: 0, completedShards: 0, failedShards: 0, retryingShards: 0, stuckShards: 0 },
    lockStatus: { activeLocks: 0, expiredLocks: 0 },
    overallScore: 0,
    overallStatus: 'unhealthy',
  };

  try {
    const { getDb } = await import('../../db');
    const database = await getDb();
    if (!database) return metrics;

    // 1. 同步成功率（最近24小时）
    try {
      const taskStats = await database.execute(sql`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as success,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
        FROM sync_tasks_v2
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
      `);
      const stats = ((taskStats as any)?.[0] || taskStats)?.[0];
      if (stats) {
        metrics.syncSuccessRate.totalTasks = Number(stats.total) || 0;
        metrics.syncSuccessRate.successfulTasks = Number(stats.success) || 0;
        metrics.syncSuccessRate.failedTasks = Number(stats.failed) || 0;
        metrics.syncSuccessRate.actual = metrics.syncSuccessRate.totalTasks > 0
          ? Math.round((metrics.syncSuccessRate.successfulTasks / metrics.syncSuccessRate.totalTasks) * 100)
          : 100; // 无任务时视为正常
        metrics.syncSuccessRate.status = metrics.syncSuccessRate.actual >= 95 ? 'ok' 
          : metrics.syncSuccessRate.actual >= 80 ? 'warning' : 'critical';
      }
    } catch (e: any) {
      log.debug(`[v358] 同步成功率查询失败(表可能不存在): ${e.message}`);
      metrics.syncSuccessRate.actual = 100;
      metrics.syncSuccessRate.status = 'ok';
    }

    // 2. 数据覆盖率
    try {
      const coverageStats = await database.execute(sql`
        SELECT 
          a.id as account_id,
          COUNT(DISTINCT DATE(dp.date)) as data_days
        FROM amazon_ad_accounts a
        LEFT JOIN daily_performance dp ON a.id = dp.account_id 
          AND DATE(dp.date) >= DATE_SUB(CURDATE(), INTERVAL 14 DAY)
        WHERE a.status IN ('active', 'connected')
        GROUP BY a.id
      `);
      const coverageRows = (coverageStats as any)?.[0] || coverageStats;
      if (Array.isArray(coverageRows) && coverageRows.length > 0) {
        metrics.dataCoverage.accountCount = coverageRows.length;
        metrics.dataCoverage.healthyAccounts = coverageRows.filter(
          (r: any) => Number(r.data_days) >= 10
        ).length;
        const avgCoverage = coverageRows.reduce(
          (sum: number, r: any) => sum + Math.min(100, (Number(r.data_days) / 14) * 100), 0
        ) / coverageRows.length;
        metrics.dataCoverage.actual = Math.round(avgCoverage);
        metrics.dataCoverage.status = metrics.dataCoverage.actual >= 90 ? 'ok'
          : metrics.dataCoverage.actual >= 70 ? 'warning' : 'critical';
      }
    } catch (e: any) {
      log.debug(`[v358] 数据覆盖率查询失败: ${e.message}`);
    }

    // 3. 数据新鲜度
    try {
      const freshnessResult = await database.execute(sql`
        SELECT MAX(created_at) as latest_sync 
        FROM daily_performance
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
      `);
      const freshness = ((freshnessResult as any)?.[0] || freshnessResult)?.[0];
      if (freshness?.latest_sync) {
        const latestTime = new Date(freshness.latest_sync);
        const minutesAgo = Math.round((Date.now() - latestTime.getTime()) / 60000);
        metrics.dataFreshness.latestSyncTime = latestTime.toISOString();
        metrics.dataFreshness.minutesSinceLastSync = minutesAgo;
        metrics.dataFreshness.actual = minutesAgo < 60 ? `${minutesAgo}min` : `${Math.round(minutesAgo/60)}h`;
        metrics.dataFreshness.status = minutesAgo <= 120 ? 'ok'
          : minutesAgo <= 360 ? 'warning' : 'critical';
      }
    } catch (e: any) {
      log.debug(`[v358] 数据新鲜度查询失败: ${e.message}`);
    }

    // 4. 同步延迟P95
    try {
      const latencyResult = await database.execute(sql`
        SELECT duration_ms FROM sync_shards
        WHERE status = 'completed' AND duration_ms IS NOT NULL
        AND completed_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
        ORDER BY duration_ms ASC
      `);
      const latencyRows = (latencyResult as any)?.[0] || latencyResult;
      if (Array.isArray(latencyRows) && latencyRows.length > 0) {
        const durations = latencyRows.map((r: any) => Number(r.duration_ms) / 60000); // 转为分钟
        const p50Index = Math.floor(durations.length * 0.5);
        const p95Index = Math.floor(durations.length * 0.95);
        const p99Index = Math.floor(durations.length * 0.99);
        
        metrics.syncLatencyP95.p50 = Math.round(durations[p50Index] * 10) / 10;
        metrics.syncLatencyP95.p95 = Math.round(durations[p95Index] * 10) / 10;
        metrics.syncLatencyP95.p99 = Math.round(durations[Math.min(p99Index, durations.length - 1)] * 10) / 10;
        metrics.syncLatencyP95.actual = metrics.syncLatencyP95.p95;
        metrics.syncLatencyP95.status = metrics.syncLatencyP95.p95 <= 30 ? 'ok'
          : metrics.syncLatencyP95.p95 <= 60 ? 'warning' : 'critical';
      }
    } catch (e: any) {
      log.debug(`[v358] 同步延迟查询失败(表可能不存在): ${e.message}`);
      metrics.syncLatencyP95.status = 'ok';
    }

    // 5. Shard健康度
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
      const shardRows = (shardStats as any)?.[0] || shardStats;
      if (Array.isArray(shardRows)) {
        for (const row of shardRows) {
          const count = Number(row.cnt);
          switch (row.status) {
            case 'pending': metrics.shardHealth.pendingShards = count; break;
            case 'running': metrics.shardHealth.runningShards = count; break;
            case 'completed': metrics.shardHealth.completedShards = count; break;
            case 'failed': metrics.shardHealth.failedShards = count; break;
            case 'retrying': metrics.shardHealth.retryingShards = count; break;
          }
          metrics.shardHealth.stuckShards += Number(row.stuck) || 0;
          metrics.shardHealth.totalShards += count;
        }
      }
    } catch (e: any) {
      log.debug(`[v358] Shard健康度查询失败(表可能不存在): ${e.message}`);
    }

    // 6. 锁状态
    try {
      const lockStats = await database.execute(sql`
        SELECT 
          SUM(CASE WHEN expires_at > NOW() THEN 1 ELSE 0 END) as active_locks,
          SUM(CASE WHEN expires_at <= NOW() THEN 1 ELSE 0 END) as expired_locks
        FROM sync_locks
      `);
      const lockRow = ((lockStats as any)?.[0] || lockStats)?.[0];
      if (lockRow) {
        metrics.lockStatus.activeLocks = Number(lockRow.active_locks) || 0;
        metrics.lockStatus.expiredLocks = Number(lockRow.expired_locks) || 0;
      }
    } catch (e: any) {
      log.debug(`[v358] 锁状态查询失败(表可能不存在): ${e.message}`);
    }

    // ==================== 计算整体健康评分 ====================
    
    let score = 0;
    const weights = {
      syncSuccessRate: 30,
      dataCoverage: 30,
      dataFreshness: 20,
      syncLatency: 10,
      shardHealth: 10,
    };

    // 同步成功率得分
    score += (metrics.syncSuccessRate.actual / 100) * weights.syncSuccessRate;
    
    // 数据覆盖率得分
    score += (metrics.dataCoverage.actual / 100) * weights.dataCoverage;
    
    // 数据新鲜度得分
    const freshnessScore = metrics.dataFreshness.minutesSinceLastSync <= 120 ? 1
      : metrics.dataFreshness.minutesSinceLastSync <= 360 ? 0.7
      : metrics.dataFreshness.minutesSinceLastSync <= 720 ? 0.3 : 0;
    score += freshnessScore * weights.dataFreshness;
    
    // 延迟得分
    const latencyScore = metrics.syncLatencyP95.p95 <= 30 ? 1
      : metrics.syncLatencyP95.p95 <= 60 ? 0.7 : 0.3;
    score += latencyScore * weights.syncLatency;
    
    // Shard健康度得分
    const shardScore = metrics.shardHealth.totalShards > 0
      ? (metrics.shardHealth.completedShards / metrics.shardHealth.totalShards)
      : 1;
    score += shardScore * weights.shardHealth;

    metrics.overallScore = Math.round(score);
    metrics.overallStatus = score >= 85 ? 'healthy' : score >= 60 ? 'degraded' : 'unhealthy';

    log.info(`[v358] SLO指标: score=${metrics.overallScore}, status=${metrics.overallStatus}, ` +
      `syncRate=${metrics.syncSuccessRate.actual}%, coverage=${metrics.dataCoverage.actual}%, ` +
      `freshness=${metrics.dataFreshness.actual}`);

  } catch (error: any) {
    log.error(`[v358] SLO指标获取失败: ${error.message}`);
  }

  return metrics;
}

/**
 * v358: 获取SLO趋势数据（最近7天）
 */
export async function getSLOTrend(days: number = 7): Promise<Array<{
  date: string;
  syncSuccessRate: number;
  dataCoverage: number;
  avgLatencyMinutes: number;
}>> {
  const trend: Array<{
    date: string;
    syncSuccessRate: number;
    dataCoverage: number;
    avgLatencyMinutes: number;
  }> = [];

  try {
    const { getDb } = await import('../../db');
    const database = await getDb();
    if (!database) return trend;

    const trendData = await database.execute(sql`
      SELECT 
        DATE(created_at) as trend_date,
        COUNT(*) as total_shards,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_shards,
        AVG(CASE WHEN status = 'completed' THEN duration_ms ELSE NULL END) as avg_duration
      FROM sync_shards
      WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL ${days} DAY)
      GROUP BY DATE(created_at)
      ORDER BY DATE(created_at)
    `);

    const rows = (trendData as any)?.[0] || trendData;
    if (Array.isArray(rows)) {
      for (const row of rows) {
        const dateStr = row.trend_date instanceof Date
          ? row.trend_date.toISOString().split('T')[0]
          : String(row.trend_date);
        trend.push({
          date: dateStr,
          syncSuccessRate: Number(row.total_shards) > 0
            ? Math.round((Number(row.completed_shards) / Number(row.total_shards)) * 100)
            : 100,
          dataCoverage: 0, // 需要单独查询
          avgLatencyMinutes: Math.round((Number(row.avg_duration) || 0) / 60000 * 10) / 10,
        });
      }
    }
  } catch (e: any) {
    log.debug(`[v358] SLO趋势查询失败: ${e.message}`);
  }

  return trend;
}
