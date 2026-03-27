/**
 * v525: 弹性架构监控服务
 * 
 * 聚合所有弹性组件（熔断器、自适应超时、舱壁隔离、查询安全层）的运行时状态，
 * 提供统一的健康检查和诊断接口。
 */

import { createModuleLogger } from '../utils/logger';
import { CircuitBreakerService } from './circuitBreakerService';
import { AdaptiveTimeoutService } from './adaptiveTimeoutService';
import { BulkheadService } from './bulkheadService';
import { getQueryStats, resetQueryStats } from './typeSafeQueryBuilder';

const log = createModuleLogger('ResilienceMonitor');

export interface ResilienceStatus {
  timestamp: string;
  circuitBreaker: {
    accounts: Record<string, {
      state: string;
      failureCount: number;
      successCount: number;
      lastFailure: string | null;
      lastStateChange: string | null;
    }>;
    globalStats: {
      totalAccounts: number;
      openCircuits: number;
      halfOpenCircuits: number;
      closedCircuits: number;
    };
  };
  adaptiveTimeout: {
    operations: Record<string, {
      currentTimeoutMs: number;
      p50Ms: number;
      p90Ms: number;
      p99Ms: number;
      sampleCount: number;
    }>;
  };
  bulkhead: {
    partitions: Record<string, {
      activeSlots: number;
      maxSlots: number;
      queueLength: number;
      utilizationPct: number;
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
  const cbService = CircuitBreakerService.getInstance();
  const atService = AdaptiveTimeoutService.getInstance();
  const bhService = BulkheadService.getInstance();
  const queryStats = getQueryStats();

  // 熔断器状态
  const cbStatus = cbService.getAllStatus();
  let openCount = 0;
  let halfOpenCount = 0;
  let closedCount = 0;
  const cbAccounts: Record<string, any> = {};
  
  for (const [accountId, status] of Object.entries(cbStatus)) {
    cbAccounts[accountId] = {
      state: status.state,
      failureCount: status.failureCount,
      successCount: status.successCount,
      lastFailure: status.lastFailureTime ? new Date(status.lastFailureTime).toISOString() : null,
      lastStateChange: status.lastStateChangeTime ? new Date(status.lastStateChangeTime).toISOString() : null,
    };
    if (status.state === 'OPEN') openCount++;
    else if (status.state === 'HALF_OPEN') halfOpenCount++;
    else closedCount++;
  }

  // 自适应超时状态
  const atStatus = atService.getAllStats();
  const atOperations: Record<string, any> = {};
  for (const [op, stats] of Object.entries(atStatus)) {
    atOperations[op] = {
      currentTimeoutMs: atService.getTimeout(op),
      p50Ms: stats.p50,
      p90Ms: stats.p90,
      p99Ms: stats.p99,
      sampleCount: stats.sampleCount,
    };
  }

  // 舱壁状态
  const bhStatus = bhService.getAllStatus();
  const bhPartitions: Record<string, any> = {};
  for (const [partition, status] of Object.entries(bhStatus)) {
    bhPartitions[partition] = {
      activeSlots: status.activeSlots,
      maxSlots: status.maxSlots,
      queueLength: status.queueLength,
      utilizationPct: status.maxSlots > 0 ? Math.round((status.activeSlots / status.maxSlots) * 100) : 0,
    };
  }

  return {
    timestamp: new Date().toISOString(),
    circuitBreaker: {
      accounts: cbAccounts,
      globalStats: {
        totalAccounts: Object.keys(cbAccounts).length,
        openCircuits: openCount,
        halfOpenCircuits: halfOpenCount,
        closedCircuits: closedCount,
      },
    },
    adaptiveTimeout: {
      operations: atOperations,
    },
    bulkhead: {
      partitions: bhPartitions,
    },
    queryLayer: {
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
    },
  };
}

/**
 * 生成弹性架构健康摘要（用于日志和告警）
 */
export function getResilienceHealthSummary(): string {
  const status = getResilienceStatus();
  const lines: string[] = [];
  
  lines.push(`[v525 Resilience] CB: ${status.circuitBreaker.globalStats.closedCircuits}closed/${status.circuitBreaker.globalStats.openCircuits}open/${status.circuitBreaker.globalStats.halfOpenCircuits}halfOpen`);
  
  const bhEntries = Object.entries(status.bulkhead.partitions);
  if (bhEntries.length > 0) {
    const maxUtil = Math.max(...bhEntries.map(([, s]) => s.utilizationPct));
    lines.push(`BH: ${bhEntries.length}partitions, maxUtil=${maxUtil}%`);
  }
  
  lines.push(`Query: ${status.queryLayer.totalQueries}total, ${status.queryLayer.totalErrors}err, ${status.queryLayer.validationRejections}rejected, ${status.queryLayer.totalSlowQueries}slow, avg=${status.queryLayer.avgDurationMs}ms`);
  
  return lines.join(' | ');
}

/**
 * 重置所有监控统计（用于新的监控周期）
 */
export function resetResilienceStats(): void {
  resetQueryStats();
  log.info('[v525] 弹性架构监控统计已重置');
}
