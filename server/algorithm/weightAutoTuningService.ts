/**
 * v271 P2-1: 评分权重自学习服务 (Weight Auto-Tuning Service)
 * 
 * 解决问题：v270中goalProgressAlgorithm的7个维度权重是静态配置的，
 * 无法根据实际优化效果自动调整。
 * 
 * 核心机制：
 * 1. 收集每个策略模板下各维度的历史表现数据
 * 2. 使用在线梯度下降（Online Gradient Descent）微调权重
 * 3. 权重调整幅度受约束，防止极端偏移
 * 4. 定期评估权重效果，支持回滚
 * 
 * 权重调整策略：
 * - 如果某维度得分高且实际优化效果好 → 增加该维度权重
 * - 如果某维度得分高但实际效果差 → 降低该维度权重
 * - 权重总和始终归一化为100%
 * - 单次调整幅度不超过±5%
 * - 任何维度权重不低于2%（防止完全忽略）
 */

import { createModuleLogger } from '../utils/logger';

const log = createModuleLogger('WeightAutoTuning');

// ==================== 类型定义 ====================

export interface DimensionWeight {
  dimension: string;
  weight: number;        // 当前权重 (0-1)
  baseWeight: number;    // 基础权重（策略模板默认）
  adjustedAt?: Date;
  adjustmentReason?: string;
}

export interface WeightTuningConfig {
  /** 学习率：控制每次调整的幅度 */
  learningRate: number;
  /** 单次最大调整幅度（百分比） */
  maxAdjustmentPercent: number;
  /** 最小权重下限（防止维度被完全忽略） */
  minWeightFloor: number;
  /** 评估窗口（天） */
  evaluationWindowDays: number;
  /** 最小样本量（低于此值不调整） */
  minSampleSize: number;
  /** 是否启用自动调整 */
  enabled: boolean;
}

export interface DimensionPerformance {
  dimension: string;
  avgScore: number;          // 该维度的平均得分
  correlationWithOutcome: number;  // 与实际优化效果的相关性 (-1 to 1)
  sampleCount: number;
}

export interface WeightTuningResult {
  strategyTemplateId: string;
  previousWeights: Record<string, number>;
  newWeights: Record<string, number>;
  adjustments: Array<{
    dimension: string;
    oldWeight: number;
    newWeight: number;
    delta: number;
    reason: string;
  }>;
  evaluationMetrics: {
    sampleSize: number;
    avgOutcomeImprovement: number;
    confidenceLevel: number;
  };
  timestamp: Date;
}

// ==================== 默认配置 ====================

const DEFAULT_TUNING_CONFIG: WeightTuningConfig = {
  learningRate: 0.02,           // 2%学习率
  maxAdjustmentPercent: 0.05,   // 单次最大调整5%
  minWeightFloor: 0.02,         // 最小权重2%
  evaluationWindowDays: 14,     // 14天评估窗口
  minSampleSize: 50,            // 最少50个样本
  enabled: true,
};

// 维度名称列表（与goalProgressAlgorithm保持一致）
const DIMENSION_NAMES = [
  'acos_progress',
  'spend_efficiency',
  'conversion_trend',
  'impression_health',
  'click_quality',
  'data_confidence',
  'profit_efficiency',  // v271新增
];

// 内存缓存：策略模板 → 调整后的权重
const tuningCache: Map<string, Record<string, number>> = new Map();

// 调整历史记录
const tuningHistory: WeightTuningResult[] = [];

// ==================== 核心函数 ====================

/**
 * 获取策略模板的当前有效权重
 * 优先返回自学习调整后的权重，否则返回默认权重
 */
export function getEffectiveWeights(
  strategyTemplateId: string,
  defaultWeights: Record<string, number>
): Record<string, number> {
  const cached = tuningCache.get(strategyTemplateId);
  if (cached) {
    log.info(`[WeightAutoTuning] 使用自学习权重: strategy=${strategyTemplateId}, weights=${JSON.stringify(cached)}`);
    return { ...cached };
  }
  return { ...defaultWeights };
}

/**
 * 计算维度表现与优化效果的相关性
 * 
 * 使用简化的皮尔逊相关系数：
 * - 收集每个优化决策的各维度得分和最终效果（ACoS改善率）
 * - 计算每个维度得分与效果的相关性
 * - 正相关 → 该维度对好结果有贡献
 * - 负相关 → 该维度可能误导决策
 */
export function calculateDimensionCorrelations(
  dimensionScores: Array<Record<string, number>>,
  outcomes: number[]  // 正值=效果好，负值=效果差
): DimensionPerformance[] {
  if (dimensionScores.length !== outcomes.length || dimensionScores.length < 2) {
    return DIMENSION_NAMES.map(d => ({
      dimension: d,
      avgScore: 0,
      correlationWithOutcome: 0,
      sampleCount: dimensionScores.length,
    }));
  }

  const n = dimensionScores.length;
  const meanOutcome = outcomes.reduce((s: unknown, v: unknown) => s + v, 0) / n;

  return DIMENSION_NAMES.map(dimension => {
    const scores = dimensionScores.map(s => s[dimension] || 0);
    const meanScore = scores.reduce((s: unknown, v: unknown) => s + v, 0) / n;

    // 皮尔逊相关系数
    let numerator = 0;
    let denomX = 0;
    let denomY = 0;
    for (let i = 0; i < n; i++) {
      const dx = scores[i] - meanScore;
      const dy = outcomes[i] - meanOutcome;
      numerator += dx * dy;
      denomX += dx * dx;
      denomY += dy * dy;
    }

    const denom = Math.sqrt(denomX * denomY);
    const correlation = denom > 0 ? numerator / denom : 0;

    return {
      dimension,
      avgScore: meanScore,
      correlationWithOutcome: Math.max(-1, Math.min(1, correlation)),
      sampleCount: n,
    };
  });
}

/**
 * 执行权重自学习调整
 * 
 * 算法：基于相关性的在线梯度调整
 * 1. 正相关维度 → 增加权重（贡献越大增加越多）
 * 2. 负相关维度 → 降低权重（误导越大降低越多）
 * 3. 零相关维度 → 向基础权重回归
 * 4. 归一化确保权重总和为1
 */
export function adjustWeights(
  currentWeights: Record<string, number>,
  dimensionPerformances: DimensionPerformance[],
  config: WeightTuningConfig = DEFAULT_TUNING_CONFIG
): WeightTuningResult {
  const previousWeights = { ...currentWeights };
  const newWeights: Record<string, number> = {};
  const adjustments: WeightTuningResult['adjustments'] = [];

  // 第1步：基于相关性计算原始调整
  for (const perf of dimensionPerformances) {
    const currentWeight = currentWeights[perf.dimension] || 0;
    let delta = 0;
    let reason = '';

    if (perf.sampleCount < config.minSampleSize) {
      // 样本不足，不调整
      newWeights[perf.dimension] = currentWeight;
      reason = `样本不足(${perf.sampleCount}<${config.minSampleSize})，保持不变`;
    } else if (perf.correlationWithOutcome > 0.1) {
      // 正相关：增加权重
      delta = config.learningRate * perf.correlationWithOutcome;
      delta = Math.min(delta, config.maxAdjustmentPercent);
      newWeights[perf.dimension] = currentWeight + delta;
      reason = `正相关(r=${perf.correlationWithOutcome.toFixed(3)})，增加权重`;
    } else if (perf.correlationWithOutcome < -0.1) {
      // 负相关：降低权重
      delta = config.learningRate * perf.correlationWithOutcome; // 负值
      delta = Math.max(delta, -config.maxAdjustmentPercent);
      newWeights[perf.dimension] = Math.max(config.minWeightFloor, currentWeight + delta);
      reason = `负相关(r=${perf.correlationWithOutcome.toFixed(3)})，降低权重`;
    } else {
      // 弱相关：向基础权重回归
      const baseWeight = 1 / DIMENSION_NAMES.length; // 均匀分布作为回归目标
      delta = (baseWeight - currentWeight) * config.learningRate * 0.5;
      newWeights[perf.dimension] = currentWeight + delta;
      reason = `弱相关(r=${perf.correlationWithOutcome.toFixed(3)})，向均匀分布回归`;
    }

    adjustments.push({
      dimension: perf.dimension,
      oldWeight: currentWeight,
      newWeight: newWeights[perf.dimension],
      delta,
      reason,
    });
  }

  // 第2步：归一化权重，确保所有权重不低于minWeightFloor
  const totalWeight = Object.values(newWeights).reduce((s: unknown, w: unknown) => s + w, 0);
  if (totalWeight > 0) {
    // 迭代归一化 + floor保证（最多3轮确保收敛）
    for (let round = 0; round < 3; round++) {
      const currentTotal = Object.values(newWeights).reduce((s: unknown, w: unknown) => s + w, 0);
      if (currentTotal <= 0) break;
      for (const key of Object.keys(newWeights)) {
        newWeights[key] = newWeights[key] / currentTotal;
        newWeights[key] = Math.max(config.minWeightFloor, newWeights[key]);
      }
    }
    // 最终归一化（不再应用floor，确保总和精确为1）
    const finalTotal = Object.values(newWeights).reduce((s: unknown, w: unknown) => s + w, 0);
    for (const key of Object.keys(newWeights)) {
      newWeights[key] = newWeights[key] / finalTotal;
    }
  }

  // 更新adjustments中的newWeight为归一化后的值
  for (const adj of adjustments) {
    adj.newWeight = newWeights[adj.dimension];
    adj.delta = adj.newWeight - adj.oldWeight;
  }

  const result: WeightTuningResult = {
    strategyTemplateId: 'pending', // 调用方设置
    previousWeights,
    newWeights,
    adjustments,
    evaluationMetrics: {
      sampleSize: dimensionPerformances[0]?.sampleCount || 0,
      avgOutcomeImprovement: 0, // 由调用方填充
      confidenceLevel: 0,
    },
    timestamp: new Date(),
  };

  return result;
}

/**
 * 应用权重调整到缓存
 */
export function applyWeightTuning(
  strategyTemplateId: string,
  result: WeightTuningResult
): void {
  result.strategyTemplateId = strategyTemplateId;
  tuningCache.set(strategyTemplateId, result.newWeights);
  tuningHistory.push(result);

  // 保留最近100条历史
  while (tuningHistory.length > 100) {
    tuningHistory.shift();
  }

  log.info(`[WeightAutoTuning] 权重已更新: strategy=${strategyTemplateId}, adjustments=${result.adjustments.filter(a => Math.abs(a.delta) > 0.001).length}个维度`);
}

/**
 * 回滚权重到上一版本
 */
export function rollbackWeights(strategyTemplateId: string): boolean {
  const history = tuningHistory.filter(h => h.strategyTemplateId === strategyTemplateId);
  if (history.length < 2) {
    tuningCache.delete(strategyTemplateId);
    log.info(`[WeightAutoTuning] 权重已回滚到默认: strategy=${strategyTemplateId}`);
    return true;
  }

  const previousResult = history[history.length - 2];
  tuningCache.set(strategyTemplateId, previousResult.newWeights);
  log.info(`[WeightAutoTuning] 权重已回滚到上一版本: strategy=${strategyTemplateId}`);
  return true;
}

/**
 * 获取调整历史
 */
export function getTuningHistory(strategyTemplateId?: string): WeightTuningResult[] {
  if (strategyTemplateId) {
    return tuningHistory.filter(h => h.strategyTemplateId === strategyTemplateId);
  }
  return [...tuningHistory];
}

/**
 * 获取默认调整配置
 */
export function getDefaultTuningConfig(): WeightTuningConfig {
  return { ...DEFAULT_TUNING_CONFIG };
}
