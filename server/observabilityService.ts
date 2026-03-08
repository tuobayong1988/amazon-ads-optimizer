import { createModuleLogger } from "./utils/logger";
const log = createModuleLogger("Observability");
/**
 * v267 P2-3: 统一可观测性服务 (Observability Service)
 * 
 * 整合 Metrics-Logging-Tracing 三大支柱：
 * 1. Metrics: 系统级指标收集和聚合
 * 2. Logging: 结构化日志和审计追踪
 * 3. Tracing: 操作链路追踪和性能分析
 * 
 * 自动化告警调度：
 * - 每5分钟收集系统健康指标
 * - 每小时生成健康摘要
 * - 实时触发critical告警
 */

import { getDb } from './db';
import { optimizationEvents } from '../drizzle/schema';
import { eq, sql, and, gte, lte, desc, count, isNull, not } from 'drizzle-orm';
import { sendNotification, sendBatchAlerts, analyzeHealthMetrics, defaultNotificationConfig } from './notificationService';
import { getSystemHealthMetrics } from './systemHealthMetricsService';

// ==================== Metrics 指标收集 ====================

export interface SystemMetricSnapshot {
  timestamp: Date;
  category: 'performance' | 'reliability' | 'optimization' | 'sync';
  metrics: Record<string, number>;
}

export interface OperationTrace {
  traceId: string;
  operationType: string;
  startTime: Date;
  endTime?: Date;
  durationMs?: number;
  status: 'started' | 'completed' | 'failed';
  metadata: Record<string, unknown>;
  parentTraceId?: string;
}

// In-memory metrics buffer (flushed periodically)
const metricsBuffer: SystemMetricSnapshot[] = [];
const activeTraces: Map<string, OperationTrace> = new Map();
const metricAggregates: Map<string, number[]> = new Map();

// Alert state tracking to prevent alert fatigue
const alertCooldowns: Map<string, Date> = new Map();
const ALERT_COOLDOWN_MS = 30 * 60 * 1000; // 30分钟冷却

/**
 * 收集系统级指标快照
 */
export async function collectSystemMetrics(): Promise<SystemMetricSnapshot[]> {
  const now = new Date();
  const snapshots: SystemMetricSnapshot[] = [];
  
  try {
    // 1. 同步健康度指标
    const syncMetrics = await collectSyncMetrics(now);
    snapshots.push(syncMetrics);
    
    // 2. 优化执行指标
    const optimizationMetrics = await collectOptimizationMetrics(now);
    snapshots.push(optimizationMetrics);
    
    // 3. 可靠性指标
    const reliabilityMetrics = await collectReliabilityMetrics(now);
    snapshots.push(reliabilityMetrics);
    
    // 缓存到内存
    metricsBuffer.push(...snapshots);
    
    // 保持最近24小时的指标
    const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    while (metricsBuffer.length > 0 && metricsBuffer[0].timestamp < cutoff) {
      metricsBuffer.shift();
    }
    
    return snapshots;
  } catch (err: any) {
    log.error(`[Observability] v267: 指标收集失败: ${err.message}`);
    return snapshots;
  }
}

async function collectSyncMetrics(now: Date): Promise<SystemMetricSnapshot> {
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  
  // 统计各类型同步状态
  const db = await getDb();
  if (!db) return { timestamp: now, category: 'sync' as const, metrics: {} };
  const syncStats = await db.select({
    apiSyncStatus: optimizationEvents.apiSyncStatus,
    operationType: optimizationEvents.actionType,
    cnt: count()
  })
  .from(optimizationEvents)
  .where(gte(optimizationEvents.executedAt, oneHourAgo.toISOString().slice(0, 19).replace('T', ' ')))
  .groupBy(optimizationEvents.apiSyncStatus, optimizationEvents.actionType);
  
  let totalSynced = 0, totalPending = 0, totalFailed = 0, totalNA = 0;
  const typeBreakdown: Record<string, { synced: number; pending: number; failed: number }> = {};
  
  for (const row of syncStats) {
    const opType = row.operationType || 'unknown';
    if (!typeBreakdown[opType]) {
      typeBreakdown[opType] = { synced: 0, pending: 0, failed: 0 };
    }
    
    const cnt = Number(row.cnt);
    if (row.apiSyncStatus === 'synced') {
      totalSynced += cnt;
      typeBreakdown[opType].synced += cnt;
    } else if (row.apiSyncStatus === 'pending') {
      totalPending += cnt;
      typeBreakdown[opType].pending += cnt;
    } else if (row.apiSyncStatus === 'failed') {
      totalFailed += cnt;
      typeBreakdown[opType].failed += cnt;
    } else {
      totalNA += cnt;
    }
  }
  
  const totalSyncable = totalSynced + totalPending + totalFailed;
  const syncRate = totalSyncable > 0 ? (totalSynced / totalSyncable) * 100 : 100;
  
  return {
    timestamp: now,
    category: 'sync',
    metrics: {
      sync_rate_percent: Math.round(syncRate * 100) / 100,
      total_synced: totalSynced,
      total_pending: totalPending,
      total_failed: totalFailed,
      total_not_applicable: totalNA,
    }
  };
}

async function collectOptimizationMetrics(now: Date): Promise<SystemMetricSnapshot> {
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  
  const db2 = await getDb();
  if (!db2) return { timestamp: now, category: 'optimization' as const, metrics: {} };
  // 最近1小时的优化事件统计
  const hourlyStats = await db2.select({
    status: optimizationEvents.status,
    cnt: count()
  })
  .from(optimizationEvents)
  .where(gte(optimizationEvents.executedAt, oneHourAgo.toISOString().slice(0, 19).replace('T', ' ')))
  .groupBy(optimizationEvents.status);
  
  let hourlyExecuted = 0, hourlyFailed = 0, hourlyRolledBack = 0;
  for (const row of hourlyStats) {
    const cnt = Number(row.cnt);
    if (row.status === 'success') hourlyExecuted += cnt;
    else if (row.status === 'failed') hourlyFailed += cnt;
    else if (row.status === 'rolled_back') hourlyRolledBack += cnt;
  }
  
  // 最近24小时的优化事件统计
  const dailyStats = await db2.select({
    status: optimizationEvents.status,
    cnt: count()
  })
  .from(optimizationEvents)
  .where(gte(optimizationEvents.executedAt, oneDayAgo.toISOString().slice(0, 19).replace('T', ' ')))
  .groupBy(optimizationEvents.status);
  
  let dailyExecuted = 0, dailyFailed = 0, dailyRolledBack = 0;
  for (const row of dailyStats) {
    const cnt = Number(row.cnt);
    if (row.status === 'success') dailyExecuted += cnt;
    else if (row.status === 'failed') dailyFailed += cnt;
    else if (row.status === 'rolled_back') dailyRolledBack += cnt;
  }
  
  const hourlyTotal = hourlyExecuted + hourlyFailed + hourlyRolledBack;
  const dailyTotal = dailyExecuted + dailyFailed + dailyRolledBack;
  
  return {
    timestamp: now,
    category: 'optimization',
    metrics: {
      hourly_executed: hourlyExecuted,
      hourly_failed: hourlyFailed,
      hourly_rolled_back: hourlyRolledBack,
      hourly_success_rate: hourlyTotal > 0 ? Math.round((hourlyExecuted / hourlyTotal) * 10000) / 100 : 100,
      daily_executed: dailyExecuted,
      daily_failed: dailyFailed,
      daily_rolled_back: dailyRolledBack,
      daily_success_rate: dailyTotal > 0 ? Math.round((dailyExecuted / dailyTotal) * 10000) / 100 : 100,
    }
  };
}

async function collectReliabilityMetrics(now: Date): Promise<SystemMetricSnapshot> {
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  
  const db3 = await getDb();
  if (!db3) return { timestamp: now, category: 'reliability' as const, metrics: {} };
  // 计算API调用成功率
  const apiStats = await db3.select({
    apiSyncStatus: optimizationEvents.apiSyncStatus,
    cnt: count()
  })
  .from(optimizationEvents)
  .where(and(
    gte(optimizationEvents.executedAt, oneDayAgo.toISOString().slice(0, 19).replace('T', ' ')),
    not(eq(optimizationEvents.apiSyncStatus, 'not_applicable'))
  ))
  .groupBy(optimizationEvents.apiSyncStatus);
  
  let apiSuccess = 0, apiFailed = 0, apiPending = 0;
  for (const row of apiStats) {
    const cnt = Number(row.cnt);
    if (row.apiSyncStatus === 'synced') apiSuccess += cnt;
    else if (row.apiSyncStatus === 'failed') apiFailed += cnt;
    else if (row.apiSyncStatus === 'pending') apiPending += cnt;
  }
  
  const apiTotal = apiSuccess + apiFailed + apiPending;
  
  // 活跃追踪数
  const activeTraceCount = activeTraces.size;
  
  // 计算平均操作延迟（从最近完成的追踪中）
  const completedTraces = Array.from(activeTraces.values()).filter(t => t.status === 'completed' && t.durationMs);
  const avgLatency = completedTraces.length > 0
    ? completedTraces.reduce((sum, t) => sum + (t.durationMs || 0), 0) / completedTraces.length
    : 0;
  
  return {
    timestamp: now,
    category: 'reliability',
    metrics: {
      api_success_rate: apiTotal > 0 ? Math.round((apiSuccess / apiTotal) * 10000) / 100 : 100,
      api_total_calls: apiTotal,
      api_failed_calls: apiFailed,
      api_pending_calls: apiPending,
      active_traces: activeTraceCount,
      avg_operation_latency_ms: Math.round(avgLatency),
      uptime_hours: Math.round(process.uptime() / 3600 * 100) / 100,
      memory_usage_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    }
  };
}

// ==================== Tracing 链路追踪 ====================

/**
 * 开始一个操作追踪
 */
export function startTrace(operationType: string, metadata: Record<string, unknown> = {}, parentTraceId?: string): string {
  const traceId = `trace_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  
  const trace: OperationTrace = {
    traceId,
    operationType,
    startTime: new Date(),
    status: 'started',
    metadata,
    parentTraceId,
  };
  
  activeTraces.set(traceId, trace);
  
  // 清理超过1小时的旧追踪
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  for (const [id, t] of activeTraces) {
    if (t.startTime < oneHourAgo) {
      activeTraces.delete(id);
    }
  }
  
  return traceId;
}

/**
 * 完成一个操作追踪
 */
export function endTrace(traceId: string, status: 'completed' | 'failed' = 'completed', additionalMetadata?: Record<string, unknown>): void {
  const trace = activeTraces.get(traceId);
  if (!trace) return;
  
  trace.endTime = new Date();
  trace.durationMs = trace.endTime.getTime() - trace.startTime.getTime();
  trace.status = status;
  
  if (additionalMetadata) {
    trace.metadata = { ...trace.metadata, ...additionalMetadata };
  }
  
  // 记录慢操作
  if (trace.durationMs > 30000) { // >30秒
    log.warn(`[Observability] v267: 慢操作检测 - ${trace.operationType} 耗时 ${trace.durationMs}ms`, trace.metadata);
  }
  
  // 聚合指标
  const key = `latency_${trace.operationType}`;
  // v329: 限制metricAggregates的key数量，防止operationType种类无限增长导致内存泄漏
  if (!metricAggregates.has(key)) {
    if (metricAggregates.size >= 200) {
      // 达到上限时，删除最早的key
      const firstKey = metricAggregates.keys().next().value;
      if (firstKey) metricAggregates.delete(firstKey);
    }
    metricAggregates.set(key, []);
  }
  const values = metricAggregates.get(key)!;
  values.push(trace.durationMs);
  // 保持最近100个样本
  if (values.length > 100) values.shift();
}

// ==================== Alerting 告警引擎 ====================

export interface AlertRule {
  id: string;
  name: string;
  category: 'sync' | 'optimization' | 'reliability' | 'performance';
  condition: (metrics: SystemMetricSnapshot[]) => boolean;
  severity: 'info' | 'warning' | 'critical';
  message: (metrics: SystemMetricSnapshot[]) => string;
  cooldownMs: number;
}

// v268 P2-1: 增强告警规则 — 分级告警+智能降噪+算法效能监控
// 告警级别: info(仅日志) < warning(通知) < critical(立即响应)
// 智能降噪: 连续触发同一告警时自动延长冷却期
const alertTriggerCounts: Map<string, number> = new Map();
const MAX_COOLDOWN_MULTIPLIER = 4; // 最大冷却期倍数

function getAdaptiveCooldown(ruleId: string, baseCooldownMs: number): number {
  const triggerCount = alertTriggerCounts.get(ruleId) || 0;
  // 每次触发后冷却期翻倍，最大到4倍
  const multiplier = Math.min(MAX_COOLDOWN_MULTIPLIER, Math.pow(2, triggerCount - 1));
  return baseCooldownMs * Math.max(1, multiplier);
}

const alertRules: AlertRule[] = [
  {
    id: 'sync_rate_drop',
    name: 'API同步率下降',
    category: 'sync',
    condition: (metrics) => {
      const syncMetrics = metrics.filter(m => m.category === 'sync');
      if (syncMetrics.length === 0) return false;
      const latest = syncMetrics[syncMetrics.length - 1];
      return latest.metrics.sync_rate_percent < 95;
    },
    severity: 'critical',
    message: (metrics) => {
      const syncMetrics = metrics.filter(m => m.category === 'sync');
      const latest = syncMetrics[syncMetrics.length - 1];
      return `API同步率降至 ${latest.metrics.sync_rate_percent}%，低于A级标准(95%)。待同步: ${latest.metrics.total_pending}，失败: ${latest.metrics.total_failed}`;
    },
    cooldownMs: 30 * 60 * 1000, // 30分钟
  },
  {
    id: 'sync_rate_warning',
    name: 'API同步率预警',
    category: 'sync',
    condition: (metrics) => {
      const syncMetrics = metrics.filter(m => m.category === 'sync');
      if (syncMetrics.length === 0) return false;
      const latest = syncMetrics[syncMetrics.length - 1];
      return latest.metrics.sync_rate_percent >= 95 && latest.metrics.sync_rate_percent < 99;
    },
    severity: 'warning',
    message: (metrics) => {
      const syncMetrics = metrics.filter(m => m.category === 'sync');
      const latest = syncMetrics[syncMetrics.length - 1];
      return `API同步率为 ${latest.metrics.sync_rate_percent}%，接近A级标准下限。建议关注。`;
    },
    cooldownMs: 60 * 60 * 1000, // 1小时
  },
  {
    id: 'high_rollback_rate',
    name: '回滚率过高',
    category: 'optimization',
    condition: (metrics) => {
      const optMetrics = metrics.filter(m => m.category === 'optimization');
      if (optMetrics.length === 0) return false;
      const latest = optMetrics[optMetrics.length - 1];
      const total = latest.metrics.daily_executed + latest.metrics.daily_rolled_back;
      if (total < 10) return false; // 样本太少不告警
      const rollbackRate = (latest.metrics.daily_rolled_back / total) * 100;
      return rollbackRate > 15; // A级标准: <10%，15%以上告警
    },
    severity: 'warning',
    message: (metrics) => {
      const optMetrics = metrics.filter(m => m.category === 'optimization');
      const latest = optMetrics[optMetrics.length - 1];
      const total = latest.metrics.daily_executed + latest.metrics.daily_rolled_back;
      const rollbackRate = total > 0 ? ((latest.metrics.daily_rolled_back / total) * 100).toFixed(1) : '0';
      return `24小时回滚率 ${rollbackRate}%，超过A级标准(10%)。已回滚: ${latest.metrics.daily_rolled_back}/${total}`;
    },
    cooldownMs: 2 * 60 * 60 * 1000, // 2小时
  },
  {
    id: 'optimization_failure_spike',
    name: '优化执行失败激增',
    category: 'optimization',
    condition: (metrics) => {
      const optMetrics = metrics.filter(m => m.category === 'optimization');
      if (optMetrics.length === 0) return false;
      const latest = optMetrics[optMetrics.length - 1];
      return latest.metrics.hourly_failed > 5;
    },
    severity: 'critical',
    message: (metrics) => {
      const optMetrics = metrics.filter(m => m.category === 'optimization');
      const latest = optMetrics[optMetrics.length - 1];
      return `最近1小时优化执行失败 ${latest.metrics.hourly_failed} 次！成功率: ${latest.metrics.hourly_success_rate}%`;
    },
    cooldownMs: 15 * 60 * 1000, // 15分钟
  },
  {
    id: 'api_failure_rate',
    name: 'API调用失败率过高',
    category: 'reliability',
    condition: (metrics) => {
      const relMetrics = metrics.filter(m => m.category === 'reliability');
      if (relMetrics.length === 0) return false;
      const latest = relMetrics[relMetrics.length - 1];
      return latest.metrics.api_success_rate < 95 && latest.metrics.api_total_calls > 10;
    },
    severity: 'critical',
    message: (metrics) => {
      const relMetrics = metrics.filter(m => m.category === 'reliability');
      const latest = relMetrics[relMetrics.length - 1];
      return `API调用成功率降至 ${latest.metrics.api_success_rate}%。失败: ${latest.metrics.api_failed_calls}，待处理: ${latest.metrics.api_pending_calls}`;
    },
    cooldownMs: 15 * 60 * 1000,
  },
  {
    id: 'memory_usage_high',
    name: '内存使用过高',
    category: 'reliability',
    condition: (metrics) => {
      const relMetrics = metrics.filter(m => m.category === 'reliability');
      if (relMetrics.length === 0) return false;
      const latest = relMetrics[relMetrics.length - 1];
      return latest.metrics.memory_usage_mb > 1024; // >1GB
    },
    severity: 'warning',
    message: (metrics) => {
      const relMetrics = metrics.filter(m => m.category === 'reliability');
      const latest = relMetrics[relMetrics.length - 1];
      return `内存使用 ${latest.metrics.memory_usage_mb}MB，超过1GB阈值。运行时间: ${latest.metrics.uptime_hours}小时`;
    },
    cooldownMs: 60 * 60 * 1000,
  },
  // v268 P2-1: 新增算法效能监控告警
  {
    id: 'advanced_algorithm_rate_low',
    name: '高级算法激活率过低',
    category: 'optimization',
    condition: (metrics) => {
      const optMetrics = metrics.filter(m => m.category === 'optimization');
      if (optMetrics.length === 0) return false;
      const latest = optMetrics[optMetrics.length - 1];
      const advancedRate = latest.metrics.advanced_algorithm_rate ?? -1;
      return advancedRate >= 0 && advancedRate < 20; // 目标>30%，20%以下告警
    },
    severity: 'warning',
    message: (metrics) => {
      const optMetrics = metrics.filter(m => m.category === 'optimization');
      const latest = optMetrics[optMetrics.length - 1];
      return `高级算法激活率仅 ${(latest.metrics.advanced_algorithm_rate ?? 0).toFixed(1)}%，低于v268目标(30%)。建议检查RL数据积累和模型训练状态。`;
    },
    cooldownMs: 4 * 60 * 60 * 1000, // 4小时
  },
  {
    id: 'positive_rate_declining',
    name: '优化正向率下降',
    category: 'optimization',
    condition: (metrics) => {
      const optMetrics = metrics.filter(m => m.category === 'optimization');
      if (optMetrics.length === 0) return false;
      const latest = optMetrics[optMetrics.length - 1];
      const positiveRate = latest.metrics.positive_rate ?? -1;
      return positiveRate >= 0 && positiveRate < 50; // 正向率低于50%告警
    },
    severity: 'warning',
    message: (metrics) => {
      const optMetrics = metrics.filter(m => m.category === 'optimization');
      const latest = optMetrics[optMetrics.length - 1];
      return `优化正向率仅 ${(latest.metrics.positive_rate ?? 0).toFixed(1)}%，低于健康阈值(50%)。系统可能存在算法偏差或数据质量问题。`;
    },
    cooldownMs: 6 * 60 * 60 * 1000, // 6小时
  },
  {
    id: 'rl_data_stale',
    name: 'RL数据回填停滞',
    category: 'performance',
    condition: (metrics) => {
      const optMetrics = metrics.filter(m => m.category === 'optimization');
      if (optMetrics.length === 0) return false;
      const latest = optMetrics[optMetrics.length - 1];
      const rlBackfillRate = latest.metrics.rl_backfill_rate ?? -1;
      return rlBackfillRate >= 0 && rlBackfillRate < 30; // RL回填率低于30%告警
    },
    severity: 'info',
    message: (metrics) => {
      const optMetrics = metrics.filter(m => m.category === 'optimization');
      const latest = optMetrics[optMetrics.length - 1];
      return `RL数据回填率仅 ${(latest.metrics.rl_backfill_rate ?? 0).toFixed(1)}%，影响高级算法训练效果。建议检查reward回填链路。`;
    },
    cooldownMs: 8 * 60 * 60 * 1000, // 8小时
  },
];

/**
 * 评估告警规则并发送通知
 */
export async function evaluateAlertRules(): Promise<{ triggered: string[]; suppressed: string[] }> {
  const triggered: string[] = [];
  const suppressed: string[] = [];
  const now = new Date();
  
  for (const rule of alertRules) {
    try {
      const shouldAlert = rule.condition(metricsBuffer);
      
      if (shouldAlert) {
        // v268 P2-1: 智能降噪 — 使用自适应冷却期
        const lastAlert = alertCooldowns.get(rule.id);
        const adaptiveCooldown = getAdaptiveCooldown(rule.id, rule.cooldownMs);
        if (lastAlert && (now.getTime() - lastAlert.getTime()) < adaptiveCooldown) {
          suppressed.push(rule.id);
          continue;
        }
        
        // 发送告警
        const message = rule.message(metricsBuffer);
        await sendNotification({
          userId: 0,
          type: 'alert',
          severity: rule.severity,
          title: `[${rule.category.toUpperCase()}] ${rule.name}`,
          message: message,
        });
        
        alertCooldowns.set(rule.id, now);
        // v268: 更新触发计数，用于自适应冷却期
        alertTriggerCounts.set(rule.id, (alertTriggerCounts.get(rule.id) || 0) + 1);
        triggered.push(rule.id);
        
        log.warn(`[Observability] v268: 告警触发 - ${rule.name}: ${message} (自适应冷却=${Math.round(adaptiveCooldown/60000)}分钟)`);
      }
    } catch (err: any) {
      log.error(`[Observability] v268: 评估告警规则 ${rule.id} 失败: ${err.message}`);
    }
  }
  
  return { triggered, suppressed };
}

// ==================== 健康摘要生成 ====================

export interface HealthSummary {
  timestamp: Date;
  overallScore: number; // 0-100
  grade: 'A' | 'A-' | 'B+' | 'B' | 'C' | 'D' | 'F';
  dimensions: {
    name: string;
    score: number;
    status: 'excellent' | 'good' | 'warning' | 'critical';
    details: string;
  }[];
  alerts: { id: string; severity: string; message: string }[];
  recommendations: string[];
}

/**
 * 生成系统健康摘要
 */
export async function generateHealthSummary(): Promise<HealthSummary> {
  const now = new Date();
  
  // 收集最新指标
  const snapshots = await collectSystemMetrics();
  
  // 评估告警
  const alertResult = await evaluateAlertRules();
  
  // 计算各维度得分
  const dimensions: HealthSummary['dimensions'] = [];
  const recommendations: string[] = [];
  
  // 1. 同步健康度 (权重25%)
  const syncSnapshot = snapshots.find(s => s.category === 'sync');
  const syncRate = syncSnapshot?.metrics.sync_rate_percent ?? 100;
  const syncScore = Math.min(100, syncRate);
  dimensions.push({
    name: 'API同步健康度',
    score: syncScore,
    status: syncScore >= 99 ? 'excellent' : syncScore >= 95 ? 'good' : syncScore >= 85 ? 'warning' : 'critical',
    details: `同步率: ${syncRate}%, 待同步: ${syncSnapshot?.metrics.total_pending ?? 0}, 失败: ${syncSnapshot?.metrics.total_failed ?? 0}`
  });
  if (syncScore < 99) {
    recommendations.push(`提升API同步率至99%+（当前${syncRate}%），检查失败的同步任务并修复`);
  }
  
  // 2. 优化执行质量 (权重25%)
  const optSnapshot = snapshots.find(s => s.category === 'optimization');
  const dailySuccessRate = optSnapshot?.metrics.daily_success_rate ?? 100;
  const dailyTotal = (optSnapshot?.metrics.daily_executed ?? 0) + (optSnapshot?.metrics.daily_rolled_back ?? 0);
  const rollbackRate = dailyTotal > 0 ? ((optSnapshot?.metrics.daily_rolled_back ?? 0) / dailyTotal) * 100 : 0;
  const optScore = Math.min(100, dailySuccessRate * 0.6 + Math.max(0, 100 - rollbackRate * 3) * 0.4);
  dimensions.push({
    name: '优化执行质量',
    score: Math.round(optScore),
    status: optScore >= 90 ? 'excellent' : optScore >= 80 ? 'good' : optScore >= 65 ? 'warning' : 'critical',
    details: `成功率: ${dailySuccessRate}%, 回滚率: ${rollbackRate.toFixed(1)}%, 24h执行: ${optSnapshot?.metrics.daily_executed ?? 0}`
  });
  if (rollbackRate > 10) {
    recommendations.push(`降低回滚率至10%以下（当前${rollbackRate.toFixed(1)}%），分析回滚根因并优化出价一致性`);
  }
  
  // 3. 系统可靠性 (权重25%)
  const relSnapshot = snapshots.find(s => s.category === 'reliability');
  const apiSuccessRate = relSnapshot?.metrics.api_success_rate ?? 100;
  const memUsage = relSnapshot?.metrics.memory_usage_mb ?? 0;
  const memScore = memUsage < 512 ? 100 : memUsage < 1024 ? 80 : memUsage < 2048 ? 60 : 40;
  const relScore = apiSuccessRate * 0.7 + memScore * 0.3;
  dimensions.push({
    name: '系统可靠性',
    score: Math.round(relScore),
    status: relScore >= 95 ? 'excellent' : relScore >= 85 ? 'good' : relScore >= 70 ? 'warning' : 'critical',
    details: `API成功率: ${apiSuccessRate}%, 内存: ${memUsage}MB, 运行: ${relSnapshot?.metrics.uptime_hours ?? 0}h`
  });
  
  // 4. 告警健康度 (权重25%)
  const activeAlerts = alertResult.triggered.length;
  const alertScore = Math.max(0, 100 - activeAlerts * 20);
  dimensions.push({
    name: '告警健康度',
    score: alertScore,
    status: alertScore >= 90 ? 'excellent' : alertScore >= 70 ? 'good' : alertScore >= 50 ? 'warning' : 'critical',
    details: `活跃告警: ${activeAlerts}, 已抑制: ${alertResult.suppressed.length}`
  });
  
  // 计算总分
  const overallScore = Math.round(
    dimensions[0].score * 0.25 +
    dimensions[1].score * 0.25 +
    dimensions[2].score * 0.25 +
    dimensions[3].score * 0.25
  );
  
  // 确定等级
  let grade: HealthSummary['grade'];
  if (overallScore >= 95) grade = 'A';
  else if (overallScore >= 90) grade = 'A-';
  else if (overallScore >= 85) grade = 'B+';
  else if (overallScore >= 80) grade = 'B';
  else if (overallScore >= 70) grade = 'C';
  else if (overallScore >= 60) grade = 'D';
  else grade = 'F';
  
  const alerts = alertResult.triggered.map(id => {
    const rule = alertRules.find(r => r.id === id);
    return {
      id,
      severity: rule?.severity ?? 'info',
      message: rule ? rule.message(metricsBuffer) : 'Unknown alert'
    };
  });
  
  return {
    timestamp: now,
    overallScore,
    grade,
    dimensions,
    alerts,
    recommendations,
  };
}

// ==================== 调度集成 ====================

let observabilityInterval: NodeJS.Timeout | null = null;
let summaryInterval: NodeJS.Timeout | null = null;

/**
 * 启动可观测性服务
 * - 每5分钟收集指标并评估告警
 * - 每小时生成健康摘要
 */
export function startObservabilityService(): void {
  // 立即收集一次
  setTimeout(async () => {
    try {
      await collectSystemMetrics();
      log.info('[Observability] v267: 初始指标收集完成');
    } catch (err: any) {
      log.error(`[Observability] v267: 初始指标收集失败: ${err.message}`);
    }
  }, 30 * 1000); // 启动30秒后
  
  // 每5分钟收集指标并评估告警
  observabilityInterval = setInterval(async () => {
    try {
      await collectSystemMetrics();
      const alertResult = await evaluateAlertRules();
      
      if (alertResult.triggered.length > 0) {
        log.warn(`[Observability] v267: ${alertResult.triggered.length}个告警被触发: ${alertResult.triggered.join(', ')}`);
      }
    } catch (err: any) {
      log.error(`[Observability] v267: 定时指标收集失败: ${err.message}`);
    }
  }, 5 * 60 * 1000);
  
  // 每小时生成健康摘要
  summaryInterval = setInterval(async () => {
    try {
      const summary = await generateHealthSummary();
      log.info(`[Observability] v267: 健康摘要 - 等级: ${summary.grade} (${summary.overallScore}分), 告警: ${summary.alerts.length}`);
      
      // 如果等级低于B，发送通知
      if (['C', 'D', 'F'].includes(summary.grade)) {
        const dimensionDetails = summary.dimensions.map(d => `  ${d.name}: ${d.score}分 (${d.status})`).join('\n');
        await sendNotification({
          userId: 0,
          type: 'system',
          severity: summary.grade === 'F' ? 'critical' : 'warning',
          title: `系统健康等级: ${summary.grade} (${summary.overallScore}分)`,
          message: `系统健康度低于B级标准:\n\n${dimensionDetails}\n\n建议:\n${summary.recommendations.map(r => `• ${r}`).join('\n')}`,
        });
      }
    } catch (err: any) {
      log.error(`[Observability] v267: 健康摘要生成失败: ${err.message}`);
    }
  }, 60 * 60 * 1000);
  
  log.info('[Observability] v267: 可观测性服务已启动 - 指标收集: 5分钟, 健康摘要: 1小时');
}

/**
 * 停止可观测性服务
 */
export function stopObservabilityService(): void {
  if (observabilityInterval) {
    clearInterval(observabilityInterval);
    observabilityInterval = null;
  }
  if (summaryInterval) {
    clearInterval(summaryInterval);
    summaryInterval = null;
  }
  log.info('[Observability] v267: 可观测性服务已停止');
}

// ==================== 对外查询接口 ====================

/**
 * 获取最近的指标快照
 */
export function getRecentMetrics(category?: string, limit: number = 50): SystemMetricSnapshot[] {
  let filtered = metricsBuffer;
  if (category) {
    filtered = filtered.filter(m => m.category === category);
  }
  return filtered.slice(-limit);
}

/**
 * 获取操作延迟统计
 */
export function getLatencyStats(): Record<string, { avg: number; p50: number; p95: number; p99: number; count: number }> {
  const stats: Record<string, { avg: number; p50: number; p95: number; p99: number; count: number }> = {};
  
  for (const [key, values] of metricAggregates) {
    if (!key.startsWith('latency_')) continue;
    const opType = key.replace('latency_', '');
    const sorted = [...values].sort((a, b) => a - b);
    const count = sorted.length;
    
    if (count === 0) continue;
    
    stats[opType] = {
      avg: Math.round(sorted.reduce((a, b) => a + b, 0) / count),
      p50: sorted[Math.floor(count * 0.5)],
      p95: sorted[Math.floor(count * 0.95)],
      p99: sorted[Math.floor(count * 0.99)],
      count,
    };
  }
  
  return stats;
}

/**
 * 获取活跃追踪列表
 */
export function getActiveTraces(): OperationTrace[] {
  return Array.from(activeTraces.values())
    .filter(t => t.status === 'started')
    .sort((a, b) => b.startTime.getTime() - a.startTime.getTime());
}
