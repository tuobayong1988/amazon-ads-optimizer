/**
 * v525: 弹性架构监控服务
 * 
 * 聚合所有弹性组件（熔断器、自适应超时、舱壁隔离、查询安全层）的运行时状态，
 * 提供统一的健康检查和诊断接口。
 */

import { createModuleLogger } from '../utils/logger';
import { getCircuitBreaker } from './circuitBreakerService';
import { getAdaptiveTimeout } from './adaptiveTimeoutService';
import { getBulkhead } from './bulkheadService';
import { getQueryStats, resetQueryStats } from './typeSafeQueryBuilder';

const log = createModuleLogger('ResilienceMonitor');

export interface ResilienceStatus {
  timestamp: string;
  circuitBreaker: {
    breakers: Array<{
      key: string;
      state: string;
      errorRate: number;
      failureCount: number;
      successCount: number;
      consecutiveOpenCount: number;
      currentCooldownMs: number;
      timeUntilHalfOpen: number | null;
    }>;
    globalStats: {
      totalBreakers: number;
      openCircuits: number;
      halfOpenCircuits: number;
      closedCircuits: number;
    };
  };
  adaptiveTimeout: {
    latencyStats: Array<{
      endpointType: string;
      sampleCount: number;
      p50Ms: number;
      p90Ms: number;
      p99Ms: number;
      avgMs: number;
      adaptiveTimeoutMs: number;
    }>;
    concurrencyStatus: Array<{
      endpointType: string;
      currentConcurrency: number;
    }>;
  };
  bulkhead: {
    partitions: Array<{
      key: string;
      maxConcurrency: number;
      activeTasks: number;
      queueLength: number;
      utilization: number;
      totalProcessed: number;
      totalRejected: number;
    }>;
  };
  queryLayer: {
    totalQueries: number;
    totalErrors: number;
    totalSlowQueries: number;
    validationRejections: number;
    avgDurationMs: number;
    recentSlowQueries: Array<{ sql: string; durationMs: number; timestamp: string }>;
  };
}

/**
 * 获取完整的弹性架构状态
 */
export function getResilienceStatus(): ResilienceStatus {
  // 熔断器状态
  let cbBreakers: ResilienceStatus['circuitBreaker']['breakers'] = [];
  let openCount = 0;
  let halfOpenCount = 0;
  let closedCount = 0;

  try {
    const cbService = getCircuitBreaker();
    const allCbStatus = cbService.getAllStatus();
    cbBreakers = allCbStatus.map(s => {
      if (s.state === 'OPEN') openCount++;
      else if (s.state === 'HALF_OPEN') halfOpenCount++;
      else closedCount++;
      return {
        key: s.key,
        state: s.state,
        errorRate: Math.round(s.errorRate * 100) / 100,
        failureCount: s.failureCount,
        successCount: s.successCount,
        consecutiveOpenCount: s.consecutiveOpenCount,
        currentCooldownMs: s.currentCooldownMs,
        timeUntilHalfOpen: s.timeUntilHalfOpen,
      };
    });
  } catch (e) {
    log.warn(`[v525] 获取熔断器状态失败: ${(e as Error).message}`);
  }

  // 自适应超时状态
  let latencyStats: ResilienceStatus['adaptiveTimeout']['latencyStats'] = [];
  let concurrencyStatus: ResilienceStatus['adaptiveTimeout']['concurrencyStatus'] = [];

  try {
    const atService = getAdaptiveTimeout();
    const allLatency = atService.getAllLatencyStats();
    latencyStats = allLatency.map(s => ({
      endpointType: s.endpointType,
      sampleCount: s.sampleCount,
      p50Ms: Math.round(s.p50Ms),
      p90Ms: Math.round(s.p90Ms),
      p99Ms: Math.round(s.p99Ms),
      avgMs: Math.round(s.avgMs),
      adaptiveTimeoutMs: Math.round(s.adaptiveTimeoutMs),
    }));
    const allConcurrency = atService.getAllConcurrencyStatus();
    concurrencyStatus = allConcurrency.map(s => ({
      endpointType: s.endpointType,
      currentConcurrency: s.currentConcurrency,
    }));
  } catch (e) {
    log.warn(`[v525] 获取自适应超时状态失败: ${(e as Error).message}`);
  }

  // 舱壁状态
  let bhPartitions: ResilienceStatus['bulkhead']['partitions'] = [];

  try {
    const bhService = getBulkhead();
    const allBhStatus = bhService.getAllStatus();
    bhPartitions = allBhStatus.map(s => ({
      key: s.key,
      maxConcurrency: s.maxConcurrency,
      activeTasks: s.activeTasks,
      queueLength: s.queueLength,
      utilization: Math.round(s.utilization * 100) / 100,
      totalProcessed: s.totalProcessed,
      totalRejected: s.totalRejected,
    }));
  } catch (e) {
    log.warn(`[v525] 获取舱壁状态失败: ${(e as Error).message}`);
  }

  // 查询安全层状态
  let queryLayerData: ResilienceStatus['queryLayer'] = {
    totalQueries: 0,
    totalErrors: 0,
    totalSlowQueries: 0,
    validationRejections: 0,
    avgDurationMs: 0,
    recentSlowQueries: [],
  };

  try {
    const queryStats = getQueryStats();
    queryLayerData = {
      totalQueries: queryStats.totalQueries,
      totalErrors: queryStats.totalErrors,
      totalSlowQueries: queryStats.totalSlowQueries,
      validationRejections: queryStats.validationRejections,
      avgDurationMs: Math.round(queryStats.avgDurationMs),
      recentSlowQueries: queryStats.recentSlowQueries.map(q => ({
        sql: q.sql,
        durationMs: q.durationMs,
        timestamp: q.timestamp.toISOString(),
      })),
    };
  } catch (e) {
    log.warn(`[v525] 获取查询安全层状态失败: ${(e as Error).message}`);
  }

  return {
    timestamp: new Date().toISOString(),
    circuitBreaker: {
      breakers: cbBreakers,
      globalStats: {
        totalBreakers: cbBreakers.length,
        openCircuits: openCount,
        halfOpenCircuits: halfOpenCount,
        closedCircuits: closedCount,
      },
    },
    adaptiveTimeout: {
      latencyStats,
      concurrencyStatus,
    },
    bulkhead: {
      partitions: bhPartitions,
    },
    queryLayer: queryLayerData,
  };
}

/**
 * 生成弹性架构健康摘要（用于日志和告警）
 */
export function getResilienceHealthSummary(): string {
  try {
    const status = getResilienceStatus();
    const lines: string[] = [];
    
    lines.push(`[v525 Resilience] CB: ${status.circuitBreaker.globalStats.closedCircuits}closed/${status.circuitBreaker.globalStats.openCircuits}open/${status.circuitBreaker.globalStats.halfOpenCircuits}halfOpen`);
    
    if (status.bulkhead.partitions.length > 0) {
      const maxUtil = Math.max(...status.bulkhead.partitions.map(s => s.utilization));
      lines.push(`BH: ${status.bulkhead.partitions.length}partitions, maxUtil=${Math.round(maxUtil * 100)}%`);
    }
    
    lines.push(`Query: ${status.queryLayer.totalQueries}total, ${status.queryLayer.totalErrors}err, ${status.queryLayer.validationRejections}rejected, ${status.queryLayer.totalSlowQueries}slow, avg=${status.queryLayer.avgDurationMs}ms`);
    
    return lines.join(' | ');
  } catch (e) {
    return `[v525 Resilience] Error getting summary: ${(e as Error).message}`;
  }
}

/**
 * 重置所有监控统计（用于新的监控周期）
 */
export function resetResilienceStats(): void {
  resetQueryStats();
  log.info('[v525] 弹性架构监控统计已重置');
}
