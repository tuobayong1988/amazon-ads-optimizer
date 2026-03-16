/**
 * v271 P2-3: 算法决策可观测性增强服务 (Algorithm Observability Service)
 * 
 * 解决问题：v270中算法决策过程缺乏结构化的可观测性，
 * 难以追踪和分析Meta选择器、Cascade Ensemble、A/B测试等核心模块的运行状态。
 * 
 * 核心能力：
 * 1. 算法选择决策追踪：记录每次Meta选择器的决策过程和结果
 * 2. Cascade Ensemble融合追踪：记录融合模式、置信度、分歧度
 * 3. A/B测试实验追踪：记录实验分组、配置覆盖、效果对比
 * 4. 利润维度追踪：记录利润评估的输入和输出
 * 5. 探索-利用平衡追踪：记录探索率、探索决策和效果
 * 6. 聚合仪表板指标：提供算法健康度的聚合视图
 */

import { createModuleLogger } from '../utils/logger';
import { startTrace, endTrace } from '../system/observabilityService';

const log = createModuleLogger('AlgorithmObservability');

// ==================== 类型定义 ====================

export interface AlgorithmDecisionTrace {
  traceId: string;
  timestamp: Date;
  accountId: number;
  entityType: 'keyword' | 'product_target';
  entityId: number;
  campaignId?: string;
  strategyTemplateId?: string;
  
  // Meta选择器决策
  metaSelection: {
    algorithmScores: Array<{ algorithm: string; score: number; eligible: boolean }>;
    selectedAlgorithm: string;
    fusionMode: 'single' | 'cascade_ensemble';
    fusionThreshold: number;
    fusionDetail: string;
  };
  
  // Cascade Ensemble详情（如果使用）
  cascadeDetail?: {
    algorithm1: string;
    algorithm2: string;
    bid1: number;
    bid2: number;
    confidence1: number;
    confidence2: number;
    fusedBid: number;
    bidDivergence: number;
    consensusBonus: number;
  };
  
  // A/B测试详情（如果在实验中）
  abTestDetail?: {
    testId: number;
    variantType: 'control' | 'treatment';
    configOverrides: Record<string, any>;
  };
  
  // 探索决策详情
  explorationDetail?: {
    explorationRate: number;
    isExploring: boolean;
    explorationAlgorithm?: string;
  };
  
  // 最终决策
  finalDecision: {
    recommendedBid: number;
    confidence: number;
    currentBid: number;
    bidChangePercent: number;
  };
  
  // 执行耗时
  durationMs: number;
}

export interface AlgorithmDashboardMetrics {
  timestamp: Date;
  period: '1h' | '24h' | '7d';
  
  // 算法分布
  algorithmDistribution: Record<string, number>;
  
  // 融合模式分布
  fusionModeDistribution: {
    single: number;
    cascade_ensemble: number;
  };
  
  // 平均置信度
  avgConfidence: number;
  avgConfidenceByAlgorithm: Record<string, number>;
  
  // 探索率
  explorationRate: number;
  explorationCount: number;
  
  // A/B测试覆盖率
  abTestCoverage: number;
  
  // 出价变化分布
  bidChangeDistribution: {
    increase: number;
    decrease: number;
    hold: number;
  };
  
  // 平均出价变化幅度
  avgBidChangePercent: number;
  
  // 决策延迟
  avgDecisionLatencyMs: number;
  p95DecisionLatencyMs: number;
}

// ==================== 内存存储 ====================

const decisionTraces: AlgorithmDecisionTrace[] = [];
const MAX_TRACE_BUFFER = 2000; // v329: 从10000降至2000，减少内存占用约80%

// ==================== 核心函数 ====================

/**
 * 记录算法决策追踪
 */
export function recordAlgorithmDecision(trace: AlgorithmDecisionTrace): void {
  decisionTraces.push(trace);
  
  // 保持缓冲区大小
  while (decisionTraces.length > MAX_TRACE_BUFFER) {
    decisionTraces.shift();
  }
  
  // 结构化日志输出
  const logEntry = {
    algo: trace.metaSelection.selectedAlgorithm,
    mode: trace.metaSelection.fusionMode,
    conf: trace.finalDecision.confidence.toFixed(2),
    bid: `$${trace.finalDecision.recommendedBid.toFixed(2)}`,
    change: `${trace.finalDecision.bidChangePercent > 0 ? '+' : ''}${(trace.finalDecision.bidChangePercent * 100).toFixed(1)}%`,
    latency: `${trace.durationMs}ms`,
    abTest: trace.abTestDetail ? `test#${trace.abTestDetail.testId}/${trace.abTestDetail.variantType}` : 'none',
    exploring: trace.explorationDetail?.isExploring ? 'yes' : 'no',
  };
  
  log.info(`[AlgoDecision] account=${trace.accountId} entity=${trace.entityType}#${trace.entityId}: ${JSON.stringify(logEntry)}`);
}

/**
 * 创建算法决策追踪的起始点
 */
export function startAlgorithmTrace(
  accountId: number,
  entityType: 'keyword' | 'product_target',
  entityId: number,
  campaignId?: string,
  strategyTemplateId?: string
): { traceId: string; startTime: number } {
  const traceId = startTrace('algorithm_decision', {
    accountId,
    entityType,
    entityId,
    campaignId,
    strategyTemplateId,
  });
  
  return { traceId, startTime: Date.now() };
}

/**
 * 完成算法决策追踪
 */
export function completeAlgorithmTrace(
  traceContext: { traceId: string; startTime: number },
  trace: Omit<AlgorithmDecisionTrace, 'traceId' | 'timestamp' | 'durationMs'>
): void {
  const durationMs = Date.now() - traceContext.startTime;
  
  endTrace(traceContext.traceId, 'completed', {
    algorithm: trace.metaSelection.selectedAlgorithm,
    fusionMode: trace.metaSelection.fusionMode,
    confidence: trace.finalDecision.confidence,
    durationMs,
  });
  
  recordAlgorithmDecision({
    ...trace,
    traceId: traceContext.traceId,
    timestamp: new Date(),
    durationMs,
  });
}

/**
 * 生成算法仪表板指标
 */
export function generateDashboardMetrics(period: '1h' | '24h' | '7d' = '24h'): AlgorithmDashboardMetrics {
  const now = Date.now();
  const periodMs = period === '1h' ? 3600000 : period === '24h' ? 86400000 : 604800000;
  const cutoff = now - periodMs;
  
  const recentTraces = decisionTraces.filter(t => t.timestamp.getTime() > cutoff);
  
  if (recentTraces.length === 0) {
    return {
      timestamp: new Date(),
      period,
      algorithmDistribution: {},
      fusionModeDistribution: { single: 0, cascade_ensemble: 0 },
      avgConfidence: 0,
      avgConfidenceByAlgorithm: {},
      explorationRate: 0,
      explorationCount: 0,
      abTestCoverage: 0,
      bidChangeDistribution: { increase: 0, decrease: 0, hold: 0 },
      avgBidChangePercent: 0,
      avgDecisionLatencyMs: 0,
      p95DecisionLatencyMs: 0,
    };
  }
  
  // 算法分布
  const algorithmDistribution: Record<string, number> = {};
  const confidenceByAlgorithm: Record<string, number[]> = {};
  let singleCount = 0;
  let ensembleCount = 0;
  let explorationCount = 0;
  let abTestCount = 0;
  let increaseCount = 0;
  let decreaseCount = 0;
  let holdCount = 0;
  let totalBidChange = 0;
  const latencies: number[] = [];
  const confidences: number[] = [];
  
  for (const trace of recentTraces) {
    const algo = trace.metaSelection.selectedAlgorithm;
    algorithmDistribution[algo] = (algorithmDistribution[algo] || 0) + 1;
    
    if (!confidenceByAlgorithm[algo]) confidenceByAlgorithm[algo] = [];
    confidenceByAlgorithm[algo].push(trace.finalDecision.confidence);
    confidences.push(trace.finalDecision.confidence);
    
    if (trace.metaSelection.fusionMode === 'cascade_ensemble') ensembleCount++;
    else singleCount++;
    
    if (trace.explorationDetail?.isExploring) explorationCount++;
    if (trace.abTestDetail) abTestCount++;
    
    const change = trace.finalDecision.bidChangePercent;
    if (change > 0.02) increaseCount++;
    else if (change < -0.02) decreaseCount++;
    else holdCount++;
    
    totalBidChange += Math.abs(change);
    latencies.push(trace.durationMs);
  }
  
  const n = recentTraces.length;
  const sortedLatencies = [...latencies].sort((a: any, b: any) => a - b);
  
  const avgConfidenceByAlgorithm: Record<string, number> = {};
  for (const [algo, confs] of Object.entries(confidenceByAlgorithm)) {
    avgConfidenceByAlgorithm[algo] = confs.reduce((s: any, c: any) => s + c, 0) / confs.length;
  }
  
  return {
    timestamp: new Date(),
    period,
    algorithmDistribution,
    fusionModeDistribution: { single: singleCount, cascade_ensemble: ensembleCount },
    avgConfidence: confidences.reduce((s: any, c: any) => s + c, 0) / n,
    avgConfidenceByAlgorithm,
    explorationRate: explorationCount / n,
    explorationCount,
    abTestCoverage: abTestCount / n,
    bidChangeDistribution: { increase: increaseCount, decrease: decreaseCount, hold: holdCount },
    avgBidChangePercent: totalBidChange / n,
    avgDecisionLatencyMs: latencies.reduce((s: any, l: any) => s + l, 0) / n,
    p95DecisionLatencyMs: sortedLatencies[Math.floor(n * 0.95)] || 0,
  };
}

/**
 * 获取最近的决策追踪记录
 */
export function getRecentDecisionTraces(
  limit: number = 100,
  filters?: {
    accountId?: number;
    algorithm?: string;
    fusionMode?: 'single' | 'cascade_ensemble';
    isExploring?: boolean;
  }
): AlgorithmDecisionTrace[] {
  let filtered = decisionTraces;
  
  if (filters) {
    if (filters.accountId) {
      filtered = filtered.filter(t => t.accountId === filters.accountId);
    }
    if (filters.algorithm) {
      filtered = filtered.filter(t => t.metaSelection.selectedAlgorithm === filters.algorithm);
    }
    if (filters.fusionMode) {
      filtered = filtered.filter(t => t.metaSelection.fusionMode === filters.fusionMode);
    }
    if (filters.isExploring !== undefined) {
      filtered = filtered.filter(t => t.explorationDetail?.isExploring === filters.isExploring);
    }
  }
  
  return filtered.slice(-limit);
}

/**
 * 清理过期追踪数据
 */
export function cleanupOldTraces(maxAgeDays: number = 7): number {
  const cutoff = Date.now() - maxAgeDays * 86400000;
  const before = decisionTraces.length;
  
  while (decisionTraces.length > 0 && decisionTraces[0].timestamp.getTime() < cutoff) {
    decisionTraces.shift();
  }
  
  const cleaned = before - decisionTraces.length;
  if (cleaned > 0) {
    log.info(`[AlgorithmObservability] 清理了 ${cleaned} 条过期追踪记录`);
  }
  return cleaned;
}

// ==================== v272 P0-1: 通用指标记录 ====================

/** 通用指标缓冲区 */
const metricBuffer: Array<{ type: string; data: Record<string, any>; timestamp: Date }> = [];
const MAX_METRIC_BUFFER = 1000; // v329: 从5000降至1000，减少内存占用约80%

/**
 * v272 P0-1: 记录通用可观测性指标
 * 
 * 用于核心业务流程中记录关键操作指标，
 * 支持后续聚合分析和仪表板展示。
 */
export function recordMetric(type: string, data: Record<string, any>): void {
  metricBuffer.push({
    type,
    data,
    timestamp: new Date(),
  });
  
  while (metricBuffer.length > MAX_METRIC_BUFFER) {
    metricBuffer.shift();
  }
  
  log.debug(`[Metric] ${type}: ${JSON.stringify(data)}`);
}

/**
 * v272 P0-1: 获取指标缓冲区数据
 */
export function getMetrics(type?: string, limit: number = 100): Array<{ type: string; data: Record<string, any>; timestamp: Date }> {
  const filtered = type ? metricBuffer.filter(m => m.type === type) : metricBuffer;
  return filtered.slice(-limit);
}
