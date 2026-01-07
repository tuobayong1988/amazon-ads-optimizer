/**
 * 算法优化建议服务
 * 根据历史准确率数据，提供出价算法参数调优建议
 */

import { getDb } from './db';
import { bidAdjustmentHistory } from '../drizzle/schema';
import { eq, and, isNotNull, sql, desc } from 'drizzle-orm';

// 算法性能指标
export interface AlgorithmPerformanceMetrics {
  // 基础统计
  totalAdjustments: number;
  trackedAdjustments: number;
  trackingRate: number;
  
  // 准确率指标
  accuracy7d: number | null;
  accuracy14d: number | null;
  accuracy30d: number | null;
  
  // 误差指标
  mae7d: number | null;  // 平均绝对误差
  mae14d: number | null;
  mae30d: number | null;
  rmse7d: number | null; // 均方根误差
  rmse14d: number | null;
  rmse30d: number | null;
  
  // 方向准确率（预测涨跌方向是否正确）
  directionAccuracy7d: number | null;
  directionAccuracy14d: number | null;
  directionAccuracy30d: number | null;
  
  // 利润统计
  totalEstimatedProfit: number;
  totalActualProfit7d: number;
  totalActualProfit14d: number;
  totalActualProfit30d: number;
}

// 按维度分析的性能
export interface DimensionPerformance {
  dimension: string;
  value: string;
  count: number;
  accuracy: number;
  mae: number;
  totalEstimated: number;
  totalActual: number;
  recommendation: string;
}

// 优化建议
export interface OptimizationSuggestion {
  id: string;
  category: 'parameter' | 'strategy' | 'targeting' | 'timing';
  priority: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  impact: string;
  currentValue?: string;
  suggestedValue?: string;
  expectedImprovement: string;
  confidence: number; // 0-100
  basedOn: string; // 基于什么数据得出
  createdAt: Date;
}

// 算法参数配置
export interface AlgorithmParameters {
  // 出价调整幅度
  maxBidIncreasePercent: number;
  maxBidDecreasePercent: number;
  minBidChangePercent: number;
  
  // 利润计算参数
  profitMarginPercent: number;
  conversionValueMultiplier: number;
  
  // 风险控制
  maxDailyAdjustments: number;
  cooldownPeriodHours: number;
  
  // 置信度阈值
  minConfidenceThreshold: number;
  minDataPoints: number;
}

// 默认算法参数
export const DEFAULT_ALGORITHM_PARAMETERS: AlgorithmParameters = {
  maxBidIncreasePercent: 30,
  maxBidDecreasePercent: 20,
  minBidChangePercent: 5,
  profitMarginPercent: 30,
  conversionValueMultiplier: 1.0,
  maxDailyAdjustments: 100,
  cooldownPeriodHours: 24,
  minConfidenceThreshold: 70,
  minDataPoints: 10,
};

// 当前算法参数
let currentParameters: AlgorithmParameters = { ...DEFAULT_ALGORITHM_PARAMETERS };

/**
 * 获取当前算法参数
 */
export function getAlgorithmParameters(): AlgorithmParameters {
  return { ...currentParameters };
}

/**
 * 更新算法参数
 */
export function updateAlgorithmParameters(updates: Partial<AlgorithmParameters>): AlgorithmParameters {
  currentParameters = { ...currentParameters, ...updates };
  return currentParameters;
}

/**
 * 重置算法参数为默认值
 */
export function resetAlgorithmParameters(): AlgorithmParameters {
  currentParameters = { ...DEFAULT_ALGORITHM_PARAMETERS };
  return currentParameters;
}

/**
 * 计算算法性能指标
 */
export async function calculateAlgorithmPerformance(
  accountId?: number,
  days: number = 30
): Promise<AlgorithmPerformanceMetrics> {
  const db = await getDb();
  if (!db) return null as any;
  
  // 查询历史记录
  const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  
  // 使用status字段检查是否已回滚
  let records = await db
    .select()
    .from(bidAdjustmentHistory)
    .where(
      sql`${bidAdjustmentHistory.status} != 'rolled_back'`
    );
  
  // 过滤账号和日期
  if (accountId) {
    records = records.filter(r => r.accountId === accountId);
  }
  records = records.filter(r => {
    const adjustedAt = r.appliedAt ? new Date(r.appliedAt) : null;
    return adjustedAt && adjustedAt >= cutoffDate;
  });
  
  const totalAdjustments = records.length;
  const tracked7d = records.filter(r => r.actualProfit7d !== null);
  const tracked14d = records.filter(r => r.actualProfit14d !== null);
  const tracked30d = records.filter(r => r.actualProfit30d !== null);
  
  // 计算各项指标
  const metrics: AlgorithmPerformanceMetrics = {
    totalAdjustments,
    trackedAdjustments: tracked7d.length,
    trackingRate: totalAdjustments > 0 ? (tracked7d.length / totalAdjustments) * 100 : 0,
    
    accuracy7d: calculateAccuracy(tracked7d, 'actualProfit7d'),
    accuracy14d: calculateAccuracy(tracked14d, 'actualProfit14d'),
    accuracy30d: calculateAccuracy(tracked30d, 'actualProfit30d'),
    
    mae7d: calculateMAE(tracked7d, 'actualProfit7d'),
    mae14d: calculateMAE(tracked14d, 'actualProfit14d'),
    mae30d: calculateMAE(tracked30d, 'actualProfit30d'),
    
    rmse7d: calculateRMSE(tracked7d, 'actualProfit7d'),
    rmse14d: calculateRMSE(tracked14d, 'actualProfit14d'),
    rmse30d: calculateRMSE(tracked30d, 'actualProfit30d'),
    
    directionAccuracy7d: calculateDirectionAccuracy(tracked7d, 'actualProfit7d'),
    directionAccuracy14d: calculateDirectionAccuracy(tracked14d, 'actualProfit14d'),
    directionAccuracy30d: calculateDirectionAccuracy(tracked30d, 'actualProfit30d'),
    
    totalEstimatedProfit: records.reduce((sum, r) => sum + parseFloat(String(r.expectedProfitIncrease || 0)), 0),
    totalActualProfit7d: tracked7d.reduce((sum, r) => sum + parseFloat(String(r.actualProfit7d || 0)), 0),
    totalActualProfit14d: tracked14d.reduce((sum, r) => sum + parseFloat(String(r.actualProfit14d || 0)), 0),
    totalActualProfit30d: tracked30d.reduce((sum, r) => sum + parseFloat(String(r.actualProfit30d || 0)), 0),
  };
  
  return metrics;
}

/**
 * 计算准确率
 */
function calculateAccuracy(records: any[], actualField: string): number | null {
  if (records.length === 0) return null;
  
  let totalEstimated = 0;
  let totalActual = 0;
  
  for (const record of records) {
    totalEstimated += parseFloat(String(record.expectedProfitIncrease || 0));
    totalActual += parseFloat(String(record[actualField] || 0));
  }
  
  if (totalEstimated === 0) {
    return totalActual >= 0 ? 100 : 0;
  }
  
  const accuracy = Math.min(100, Math.max(0, (1 - Math.abs(totalActual - totalEstimated) / Math.abs(totalEstimated)) * 100));
  return Math.round(accuracy * 100) / 100;
}

/**
 * 计算平均绝对误差 (MAE)
 */
function calculateMAE(records: any[], actualField: string): number | null {
  if (records.length === 0) return null;
  
  let totalError = 0;
  for (const record of records) {
    const estimated = parseFloat(String(record.expectedProfitIncrease || 0));
    const actual = parseFloat(String(record[actualField] || 0));
    totalError += Math.abs(actual - estimated);
  }
  
  return Math.round((totalError / records.length) * 100) / 100;
}

/**
 * 计算均方根误差 (RMSE)
 */
function calculateRMSE(records: any[], actualField: string): number | null {
  if (records.length === 0) return null;
  
  let totalSquaredError = 0;
  for (const record of records) {
    const estimated = parseFloat(String(record.expectedProfitIncrease || 0));
    const actual = parseFloat(String(record[actualField] || 0));
    totalSquaredError += Math.pow(actual - estimated, 2);
  }
  
  return Math.round(Math.sqrt(totalSquaredError / records.length) * 100) / 100;
}

/**
 * 计算方向准确率
 */
function calculateDirectionAccuracy(records: any[], actualField: string): number | null {
  if (records.length === 0) return null;
  
  let correctCount = 0;
  for (const record of records) {
    const estimated = parseFloat(String(record.expectedProfitIncrease || 0));
    const actual = parseFloat(String(record[actualField] || 0));
    
    // 方向一致（同正、同负、或都为0）
    if ((estimated > 0 && actual > 0) || (estimated < 0 && actual < 0) || (estimated === 0 && actual === 0)) {
      correctCount++;
    }
  }
  
  return Math.round((correctCount / records.length) * 100 * 100) / 100;
}

/**
 * 按调整类型分析性能
 */
export async function analyzeByAdjustmentType(
  accountId?: number,
  days: number = 30
): Promise<DimensionPerformance[]> {
  const db = await getDb();
  if (!db) return [];
  
  const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  
  let records = await db
    .select()
    .from(bidAdjustmentHistory)
    .where(
      and(
        sql`${bidAdjustmentHistory.status} != 'rolled_back'`,
        isNotNull(bidAdjustmentHistory.actualProfit7d)
      )
    );
  
  if (accountId) {
    records = records.filter(r => r.accountId === accountId);
  }
  records = records.filter(r => {
    const adjustedAt = r.appliedAt ? new Date(r.appliedAt) : null;
    return adjustedAt && adjustedAt >= cutoffDate;
  });
  
  // 按调整类型分组
  const byType: Record<string, any[]> = {};
  for (const record of records) {
    const type = record.adjustmentType || 'unknown';
    if (!byType[type]) byType[type] = [];
    byType[type].push(record);
  }
  
  const results: DimensionPerformance[] = [];
  
  for (const [type, typeRecords] of Object.entries(byType)) {
    const totalEstimated = typeRecords.reduce((sum, r) => sum + parseFloat(String(r.expectedProfitIncrease || 0)), 0);
    const totalActual = typeRecords.reduce((sum, r) => sum + parseFloat(String(r.actualProfit7d || 0)), 0);
    const accuracy = calculateAccuracy(typeRecords, 'actualProfit7d') || 0;
    const mae = calculateMAE(typeRecords, 'actualProfit7d') || 0;
    
    results.push({
      dimension: 'adjustmentType',
      value: type,
      count: typeRecords.length,
      accuracy,
      mae,
      totalEstimated,
      totalActual,
      recommendation: generateTypeRecommendation(type, accuracy, mae, typeRecords.length),
    });
  }
  
  return results.sort((a, b) => b.count - a.count);
}

/**
 * 按出价变化幅度分析性能
 */
export async function analyzeByBidChangeRange(
  accountId?: number,
  days: number = 30
): Promise<DimensionPerformance[]> {
  const db = await getDb();
  if (!db) return [];
  
  const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  
  let records = await db
    .select()
    .from(bidAdjustmentHistory)
    .where(
      and(
        sql`${bidAdjustmentHistory.status} != 'rolled_back'`,
        isNotNull(bidAdjustmentHistory.actualProfit7d)
      )
    );
  
  if (accountId) {
    records = records.filter(r => r.accountId === accountId);
  }
  records = records.filter(r => {
    const adjustedAt = r.appliedAt ? new Date(r.appliedAt) : null;
    return adjustedAt && adjustedAt >= cutoffDate;
  });
  
  // 按出价变化幅度分组
  const ranges = [
    { min: -100, max: -20, label: '大幅降价 (>20%)' },
    { min: -20, max: -10, label: '中幅降价 (10-20%)' },
    { min: -10, max: -5, label: '小幅降价 (5-10%)' },
    { min: -5, max: 5, label: '微调 (<5%)' },
    { min: 5, max: 10, label: '小幅提价 (5-10%)' },
    { min: 10, max: 20, label: '中幅提价 (10-20%)' },
    { min: 20, max: 100, label: '大幅提价 (>20%)' },
  ];
  
  const results: DimensionPerformance[] = [];
  
  for (const range of ranges) {
    const rangeRecords = records.filter(r => {
      const change = parseFloat(String(r.bidChangePercent || 0));
      return change >= range.min && change < range.max;
    });
    
    if (rangeRecords.length === 0) continue;
    
    const totalEstimated = rangeRecords.reduce((sum, r) => sum + parseFloat(String(r.expectedProfitIncrease || 0)), 0);
    const totalActual = rangeRecords.reduce((sum, r) => sum + parseFloat(String(r.actualProfit7d || 0)), 0);
    const accuracy = calculateAccuracy(rangeRecords, 'actualProfit7d') || 0;
    const mae = calculateMAE(rangeRecords, 'actualProfit7d') || 0;
    
    results.push({
      dimension: 'bidChangeRange',
      value: range.label,
      count: rangeRecords.length,
      accuracy,
      mae,
      totalEstimated,
      totalActual,
      recommendation: generateRangeRecommendation(range.label, accuracy, mae, rangeRecords.length),
    });
  }
  
  return results;
}

/**
 * 生成调整类型建议
 */
function generateTypeRecommendation(type: string, accuracy: number, mae: number, count: number): string {
  if (count < 5) {
    return '样本量不足，建议收集更多数据后再评估';
  }
  
  if (accuracy >= 80) {
    return `${type}类型调整表现优秀，建议继续使用当前策略`;
  } else if (accuracy >= 60) {
    return `${type}类型调整表现良好，可适当增加使用频率`;
  } else if (accuracy >= 40) {
    return `${type}类型调整表现一般，建议优化参数或减少使用`;
  } else {
    return `${type}类型调整表现较差，建议暂停使用并分析原因`;
  }
}

/**
 * 生成幅度范围建议
 */
function generateRangeRecommendation(range: string, accuracy: number, mae: number, count: number): string {
  if (count < 5) {
    return '样本量不足，建议收集更多数据后再评估';
  }
  
  if (accuracy >= 80) {
    return `${range}范围调整效果优秀，可作为优先选择`;
  } else if (accuracy >= 60) {
    return `${range}范围调整效果良好，建议保持当前策略`;
  } else if (accuracy >= 40) {
    return `${range}范围调整效果一般，建议缩小调整幅度`;
  } else {
    return `${range}范围调整效果较差，建议避免此幅度的调整`;
  }
}

/**
 * 生成综合优化建议
 */
export async function generateOptimizationSuggestions(
  accountId?: number,
  days: number = 30
): Promise<OptimizationSuggestion[]> {
  const suggestions: OptimizationSuggestion[] = [];
  
  // 获取性能指标
  const metrics = await calculateAlgorithmPerformance(accountId, days);
  const byType = await analyzeByAdjustmentType(accountId, days);
  const byRange = await analyzeByBidChangeRange(accountId, days);
  
  // 基于整体准确率生成建议
  if (metrics.accuracy7d !== null) {
    if (metrics.accuracy7d < 50) {
      suggestions.push({
        id: `suggestion_${Date.now()}_1`,
        category: 'parameter',
        priority: 'critical',
        title: '算法准确率过低',
        description: `当前7天准确率仅为${metrics.accuracy7d.toFixed(1)}%，远低于期望水平。建议全面审查算法参数和数据质量。`,
        impact: '可能导致大量无效或负面的出价调整',
        currentValue: `${metrics.accuracy7d.toFixed(1)}%`,
        suggestedValue: '70%+',
        expectedImprovement: '提高准确率至少20个百分点',
        confidence: 90,
        basedOn: `基于${metrics.trackedAdjustments}条追踪数据`,
        createdAt: new Date(),
      });
    } else if (metrics.accuracy7d < 70) {
      suggestions.push({
        id: `suggestion_${Date.now()}_2`,
        category: 'parameter',
        priority: 'high',
        title: '算法准确率需要提升',
        description: `当前7天准确率为${metrics.accuracy7d.toFixed(1)}%，有较大提升空间。建议优化关键参数。`,
        impact: '部分出价调整可能未达到预期效果',
        currentValue: `${metrics.accuracy7d.toFixed(1)}%`,
        suggestedValue: '75%+',
        expectedImprovement: '提高准确率10-15个百分点',
        confidence: 80,
        basedOn: `基于${metrics.trackedAdjustments}条追踪数据`,
        createdAt: new Date(),
      });
    }
  }
  
  // 基于方向准确率生成建议
  if (metrics.directionAccuracy7d !== null && metrics.directionAccuracy7d < 60) {
    suggestions.push({
      id: `suggestion_${Date.now()}_3`,
      category: 'strategy',
      priority: 'high',
      title: '预测方向准确率不足',
      description: `当前预测涨跌方向准确率仅为${metrics.directionAccuracy7d.toFixed(1)}%，接近随机水平。建议增加更多市场信号作为预测依据。`,
      impact: '可能导致反向操作，造成损失',
      currentValue: `${metrics.directionAccuracy7d.toFixed(1)}%`,
      suggestedValue: '70%+',
      expectedImprovement: '减少反向调整带来的损失',
      confidence: 85,
      basedOn: `基于${metrics.trackedAdjustments}条追踪数据的方向分析`,
      createdAt: new Date(),
    });
  }
  
  // 基于MAE生成建议
  if (metrics.mae7d !== null && metrics.mae7d > 50) {
    suggestions.push({
      id: `suggestion_${Date.now()}_4`,
      category: 'parameter',
      priority: 'medium',
      title: '预测误差较大',
      description: `当前平均绝对误差为$${metrics.mae7d.toFixed(2)}，预测精度有待提高。建议调整利润计算参数。`,
      impact: '预估利润与实际利润差距较大',
      currentValue: `$${metrics.mae7d.toFixed(2)}`,
      suggestedValue: '<$30',
      expectedImprovement: '提高预测精度，减少误差',
      confidence: 75,
      basedOn: `基于${metrics.trackedAdjustments}条追踪数据的误差分析`,
      createdAt: new Date(),
    });
  }
  
  // 基于调整类型分析生成建议
  for (const typePerf of byType) {
    if (typePerf.count >= 10 && typePerf.accuracy < 40) {
      suggestions.push({
        id: `suggestion_${Date.now()}_type_${typePerf.value}`,
        category: 'strategy',
        priority: 'medium',
        title: `${typePerf.value}类型调整效果不佳`,
        description: `${typePerf.value}类型的调整准确率仅为${typePerf.accuracy.toFixed(1)}%，建议减少此类调整的使用频率或优化相关参数。`,
        impact: `影响${typePerf.count}次调整的效果`,
        currentValue: `准确率${typePerf.accuracy.toFixed(1)}%`,
        suggestedValue: '准确率60%+',
        expectedImprovement: '减少无效调整，提高整体ROI',
        confidence: 70,
        basedOn: `基于${typePerf.count}条${typePerf.value}类型调整数据`,
        createdAt: new Date(),
      });
    }
  }
  
  // 基于幅度分析生成建议
  const poorRanges = byRange.filter(r => r.count >= 5 && r.accuracy < 50);
  if (poorRanges.length > 0) {
    const rangeNames = poorRanges.map(r => r.value).join('、');
    suggestions.push({
      id: `suggestion_${Date.now()}_range`,
      category: 'parameter',
      priority: 'medium',
      title: '部分调整幅度效果不佳',
      description: `以下调整幅度的效果较差：${rangeNames}。建议调整maxBidIncreasePercent和maxBidDecreasePercent参数，避免这些幅度范围。`,
      impact: '减少大幅度调整带来的风险',
      currentValue: `当前最大提价${currentParameters.maxBidIncreasePercent}%，最大降价${currentParameters.maxBidDecreasePercent}%`,
      suggestedValue: '根据数据调整幅度限制',
      expectedImprovement: '提高整体调整成功率',
      confidence: 65,
      basedOn: `基于${poorRanges.reduce((sum, r) => sum + r.count, 0)}条调整数据`,
      createdAt: new Date(),
    });
  }
  
  // 如果数据量不足，添加建议
  if (metrics.totalAdjustments < 50) {
    suggestions.push({
      id: `suggestion_${Date.now()}_data`,
      category: 'strategy',
      priority: 'low',
      title: '数据量不足',
      description: `当前仅有${metrics.totalAdjustments}条调整记录，建议积累更多数据后再进行深入分析和优化。`,
      impact: '分析结果可能不够准确',
      expectedImprovement: '获得更可靠的优化建议',
      confidence: 50,
      basedOn: `当前数据量${metrics.totalAdjustments}条`,
      createdAt: new Date(),
    });
  }
  
  // 如果追踪率低，添加建议
  if (metrics.trackingRate < 50) {
    suggestions.push({
      id: `suggestion_${Date.now()}_tracking`,
      category: 'strategy',
      priority: 'medium',
      title: '效果追踪率较低',
      description: `当前效果追踪率仅为${metrics.trackingRate.toFixed(1)}%，大量调整缺少效果数据。建议检查效果追踪定时任务是否正常运行。`,
      impact: '无法准确评估算法效果',
      currentValue: `${metrics.trackingRate.toFixed(1)}%`,
      suggestedValue: '80%+',
      expectedImprovement: '获得更完整的效果数据',
      confidence: 80,
      basedOn: `${metrics.totalAdjustments}条调整中仅${metrics.trackedAdjustments}条有追踪数据`,
      createdAt: new Date(),
    });
  }
  
  // 按优先级排序
  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  return suggestions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
}

/**
 * 获取参数调优建议
 */
export function getParameterTuningSuggestions(
  metrics: AlgorithmPerformanceMetrics,
  byRange: DimensionPerformance[]
): { parameter: string; current: number; suggested: number; reason: string }[] {
  const suggestions: { parameter: string; current: number; suggested: number; reason: string }[] = [];
  
  // 根据大幅调整的表现调整最大幅度
  const largeIncrease = byRange.find(r => r.value.includes('大幅提价'));
  if (largeIncrease && largeIncrease.accuracy < 50 && largeIncrease.count >= 5) {
    suggestions.push({
      parameter: 'maxBidIncreasePercent',
      current: currentParameters.maxBidIncreasePercent,
      suggested: Math.max(15, currentParameters.maxBidIncreasePercent - 10),
      reason: `大幅提价准确率仅${largeIncrease.accuracy.toFixed(1)}%，建议降低最大提价幅度`,
    });
  }
  
  const largeDecrease = byRange.find(r => r.value.includes('大幅降价'));
  if (largeDecrease && largeDecrease.accuracy < 50 && largeDecrease.count >= 5) {
    suggestions.push({
      parameter: 'maxBidDecreasePercent',
      current: currentParameters.maxBidDecreasePercent,
      suggested: Math.max(10, currentParameters.maxBidDecreasePercent - 5),
      reason: `大幅降价准确率仅${largeDecrease.accuracy.toFixed(1)}%，建议降低最大降价幅度`,
    });
  }
  
  // 根据整体准确率调整置信度阈值
  if (metrics.accuracy7d !== null && metrics.accuracy7d < 60) {
    suggestions.push({
      parameter: 'minConfidenceThreshold',
      current: currentParameters.minConfidenceThreshold,
      suggested: Math.min(85, currentParameters.minConfidenceThreshold + 10),
      reason: `整体准确率较低(${metrics.accuracy7d.toFixed(1)}%)，建议提高置信度阈值以减少低质量调整`,
    });
  }
  
  // 根据数据量调整最小数据点要求
  if (metrics.totalAdjustments > 100 && metrics.accuracy7d !== null && metrics.accuracy7d < 70) {
    suggestions.push({
      parameter: 'minDataPoints',
      current: currentParameters.minDataPoints,
      suggested: Math.min(20, currentParameters.minDataPoints + 5),
      reason: `数据充足但准确率不高，建议增加最小数据点要求以提高预测质量`,
    });
  }
  
  return suggestions;
}
