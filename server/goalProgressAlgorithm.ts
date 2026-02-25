/**
 * goalProgressAlgorithm.ts - 多维度目标达成度科学评分算法
 * 
 * v162: 全新的多维度加权评分系统
 * v164: 与v163渐进式+时间衰减逻辑完全对齐
 * v235: 新增第6维度“NextGen算法效能”，与NextGen竞价编排器深度对齐
 *   - 核心指标使用时间衰减加权ACoS/ROAS（近期数据权重更高）
 *   - 趋势改善使用多时间窗口对比（7天 vs 30天 vs 60天）
 *   - 预算效率使用时间衰减加权日均花费
 *   - 渐进式优化进度子维度
 *   - 数据置信度修正
 *   - NextGen算法效能：评估算法层级分布、正向率、置信度
 * 
 * 六大维度：
 * 1. 核心指标达成度 - 时间衰减加权ACoS/ROAS与目标值的对比
 * 2. 趋势改善度 - 多时间窗口渐进式改善评估
 * 3. 预算效率 - 时间衰减加权预算利用率
 * 4. 转化效率 - ROAS、CVR、CPC综合评估
 * 5. 渐进优化进度 - 优化是否在稳步接近目标
 * 6. NextGen算法效能 - 算法层级分布、正向率、自我进化效果 (v235新增)
 */

// ==================== 类型定义 ====================

export interface PerformanceMetrics {
  totalSpend: number;
  totalSales: number;
  totalOrders: number;
  totalClicks: number;
  totalImpressions: number;
  avgAcos: number;
  avgRoas: number;
  ctr: number;
  cvr: number;
  cpc: number;
}

/** v164: 时间衰减加权指标（从timeDecayWeightedDataService获取） */
export interface TimeWeightedMetrics {
  weightedAcos: number;
  weightedRoas: number;
  weightedDailySpend: number;
  weightedDailySales: number;
  weightedDailyOrders: number;
  weightedCvr: number;
  weightedCpc: number;
  dataConfidence: 'high' | 'medium' | 'low' | 'very_low';
  trendDirection: 'improving' | 'stable' | 'declining';
  effectiveDataDays: number;
}

/** v164: 多时间窗口趋势数据 */
export interface MultiWindowTrendData {
  recent7d: WindowMetrics | null;   // 最近7天
  recent14d: WindowMetrics | null;  // 最近14天
  recent30d: WindowMetrics | null;  // 最近30天
  recent60d: WindowMetrics | null;  // 最近60天
  recent90d: WindowMetrics | null;  // 最近90天
  preOptimization: WindowMetrics | null; // 加入优化目标前的数据
}

export interface WindowMetrics {
  days: number;
  totalSpend: number;
  totalSales: number;
  totalOrders: number;
  totalClicks: number;
  totalImpressions: number;
}

export interface GroupConfig {
  id: number;
  optimizationGoal: string;
  targetAcos: number | null;
  targetRoas: number | null;
  dailyBudget: number | null;
  dailySpendLimit: number | null;
  maxBid: number | null;
  strategyTemplateId: string | null;
  strategyTemplateName: string | null;
  status: string;
  createdAt: string;
  campaignCount: number;
}

export interface TrendData {
  before: {
    days: number;
    totalSpend: number;
    totalSales: number;
    totalOrders: number;
    totalClicks: number;
    totalImpressions: number;
  } | null;
  after: {
    days: number;
    totalSpend: number;
    totalSales: number;
    totalOrders: number;
    totalClicks: number;
    totalImpressions: number;
  } | null;
}

export interface DimensionScore {
  name: string;
  nameZh: string;
  score: number;
  weight: number;
  weighted: number;
  detail: string;
}

export interface GoalProgressResult {
  totalScore: number;
  dimensions: DimensionScore[];
  summary: string;
  level: 'excellent' | 'good' | 'fair' | 'poor';
}

/** v235: NextGen算法效能数据（从算法效果服务和自我进化引擎获取） */
export interface AlgorithmEfficacyData {
  /** 怰30天总优化操作数 */
  totalOperations: number;
  /** 正向率（优化后ACoS改善的比例） */
  positiveRate: number;
  /** 算法层级分布 */
  tierDistribution: {
    advanced: number;    // 高级算法（LinUCB/CQL）使用比例
    ruleEngine: number;  // 规则引擎使用比例
    conservative: number; // 保守策略使用比例
  };
  /** 平均置信度 */
  avgConfidence: number;
  /** 自我进化纠错数（近30天） */
  evolutionCorrections: number;
  /** 改善趋势: improving/stable/declining */
  improvementTrend: string;
}

// ==================== 策略模板权重配置 ====================

interface WeightConfig {
  coreMetric: number;
  trend: number;
  budgetEfficiency: number;
  conversionEfficiency: number;
  gradualProgress: number;
  algorithmEfficacy: number;  // v235新增: NextGen算法效能
}

// v235: 重新分配权重，给算法效能维度10%权重，从其他维度均匀扣减
const STRATEGY_WEIGHTS: Record<string, WeightConfig> = {
  'aggressive-growth': { coreMetric: 18, trend: 27, budgetEfficiency: 8, conversionEfficiency: 17, gradualProgress: 20, algorithmEfficacy: 10 },
  'balanced':          { coreMetric: 22, trend: 18, budgetEfficiency: 13, conversionEfficiency: 17, gradualProgress: 20, algorithmEfficacy: 10 },
  'profit-focused':    { coreMetric: 32, trend: 8, budgetEfficiency: 13, conversionEfficiency: 17, gradualProgress: 20, algorithmEfficacy: 10 },
  'seasonal-boost':    { coreMetric: 13, trend: 32, budgetEfficiency: 8, conversionEfficiency: 17, gradualProgress: 20, algorithmEfficacy: 10 },
  'brand-defense':     { coreMetric: 27, trend: 8, budgetEfficiency: 18, conversionEfficiency: 17, gradualProgress: 20, algorithmEfficacy: 10 },
};

const DEFAULT_WEIGHTS: WeightConfig = { coreMetric: 22, trend: 18, budgetEfficiency: 13, conversionEfficiency: 17, gradualProgress: 20, algorithmEfficacy: 10 };

function getWeights(strategyTemplateId: string | null): WeightConfig {
  if (!strategyTemplateId) return DEFAULT_WEIGHTS;
  return STRATEGY_WEIGHTS[strategyTemplateId] || DEFAULT_WEIGHTS;
}

// ==================== 数据置信度修正系数 ====================

function getConfidenceMultiplier(confidence: string): number {
  switch (confidence) {
    case 'high': return 1.0;
    case 'medium': return 0.9;
    case 'low': return 0.75;
    case 'very_low': return 0.6;
    default: return 0.8;
  }
}

// ==================== 维度1: 核心指标达成度（v164: 使用时间衰减加权指标） ====================

function calculateCoreMetricScore(
  config: GroupConfig,
  metrics: PerformanceMetrics,
  timeWeighted?: TimeWeightedMetrics
): { score: number; detail: string } {
  const { optimizationGoal, targetAcos, targetRoas } = config;
  
  if (metrics.totalSpend < 0.5 && metrics.totalSales < 0.5) {
    return { score: 0, detail: '数据不足，暂无法评估' };
  }
  
  // v164: 优先使用时间衰减加权指标（近期数据权重更高）
  const effectiveAcos = timeWeighted ? timeWeighted.weightedAcos : metrics.avgAcos;
  const effectiveRoas = timeWeighted ? timeWeighted.weightedRoas : metrics.avgRoas;
  const dataSource = timeWeighted ? '时间衰减加权' : '简单平均';
  
  // 目标ACoS
  if ((optimizationGoal === 'target_acos' || targetAcos) && targetAcos && targetAcos > 0) {
    if (effectiveAcos <= 0 && metrics.totalSales > 0) {
      return { score: 100, detail: `完美：有销售无花费，ACoS=0%（目标≤${targetAcos}%）[${dataSource}]` };
    }
    if (effectiveAcos <= 0) {
      return { score: 0, detail: `无有效数据（目标ACoS≤${targetAcos}%）` };
    }
    
    const ratio = targetAcos / effectiveAcos;
    let score: number;
    if (ratio >= 1) {
      score = 100;
    } else if (ratio >= 0.8) {
      score = 70 + (ratio - 0.8) / 0.2 * 30;
    } else if (ratio >= 0.5) {
      score = 30 + (ratio - 0.5) / 0.3 * 40;
    } else {
      score = Math.max(5, ratio / 0.5 * 30);
    }
    
    return {
      score: Math.round(score),
      detail: `${dataSource}ACoS ${effectiveAcos.toFixed(1)}% / 目标≤${targetAcos}%（达成率${(ratio * 100).toFixed(0)}%）`
    };
  }
  
  // 目标ROAS
  if ((optimizationGoal === 'target_roas' || targetRoas) && targetRoas && targetRoas > 0) {
    if (effectiveRoas <= 0) {
      return { score: 5, detail: `ROAS=0（目标≥${targetRoas}）` };
    }
    
    const ratio = effectiveRoas / targetRoas;
    let score: number;
    if (ratio >= 1) {
      score = 100;
    } else if (ratio >= 0.8) {
      score = 70 + (ratio - 0.8) / 0.2 * 30;
    } else if (ratio >= 0.5) {
      score = 30 + (ratio - 0.5) / 0.3 * 40;
    } else {
      score = Math.max(5, ratio / 0.5 * 30);
    }
    
    return {
      score: Math.round(score),
      detail: `${dataSource}ROAS ${effectiveRoas.toFixed(2)} / 目标≥${targetRoas}（达成率${(ratio * 100).toFixed(0)}%）`
    };
  }
  
  // 最大化销售额
  if (optimizationGoal === 'maximize_sales') {
    const roas = effectiveRoas;
    let score: number;
    if (roas >= 3) score = 100;
    else if (roas >= 2) score = 80 + (roas - 2) * 20;
    else if (roas >= 1) score = 50 + (roas - 1) * 30;
    else if (roas > 0) score = Math.max(10, roas * 50);
    else score = 5;
    
    return {
      score: Math.round(score),
      detail: `${dataSource}ROAS ${roas.toFixed(2)}（销售最大化模式）`
    };
  }
  
  // 每日花费上限
  if (optimizationGoal === 'daily_spend_limit' || optimizationGoal === 'daily_cost') {
    const dailyLimit = config.dailySpendLimit || config.dailyBudget || 0;
    if (dailyLimit <= 0) {
      return { score: 50, detail: '未设置花费上限目标' };
    }
    // v164: 使用时间衰减加权日均花费
    const avgDailySpend = timeWeighted ? timeWeighted.weightedDailySpend : (metrics.totalSpend / Math.max(1, 30));
    const ratio = avgDailySpend / dailyLimit;
    
    let score: number;
    if (ratio <= 1 && ratio >= 0.7) {
      score = 100;
    } else if (ratio < 0.7 && ratio >= 0.3) {
      score = 60 + (ratio - 0.3) / 0.4 * 40;
    } else if (ratio < 0.3) {
      score = Math.max(20, ratio / 0.3 * 60);
    } else if (ratio <= 1.2) {
      score = 80;
    } else {
      score = Math.max(10, 80 - (ratio - 1.2) * 100);
    }
    
    return {
      score: Math.round(Math.min(100, Math.max(5, score))),
      detail: `${dataSource}日均花费$${avgDailySpend.toFixed(2)} / 上限$${dailyLimit.toFixed(2)}`
    };
  }
  
  // 兜底
  const roas = effectiveRoas;
  let score = roas >= 2 ? 80 : roas >= 1 ? 60 : Math.max(20, roas * 60);
  return {
    score: Math.round(score),
    detail: `${dataSource}ROAS ${roas.toFixed(2)}（通用评估）`
  };
}

// ==================== 维度2: 趋势改善度（v164: 多时间窗口对比） ====================

function calculateTrendScore(
  trendData: TrendData,
  config: GroupConfig,
  timeWeighted?: TimeWeightedMetrics,
  multiWindow?: MultiWindowTrendData
): { score: number; detail: string } {
  // v164: 如果有多时间窗口数据，使用更科学的评估
  if (multiWindow) {
    return calculateMultiWindowTrendScore(multiWindow, config, timeWeighted);
  }
  
  // 兼容旧的前后对比逻辑
  const { before, after } = trendData;
  
  if (!before || !after) {
    if (after && after.days > 0 && after.totalSpend > 0) {
      const afterRoas = after.totalSpend > 0 ? after.totalSales / after.totalSpend : 0;
      const score = afterRoas >= 2 ? 70 : afterRoas >= 1 ? 55 : 40;
      return { score, detail: `新优化目标，ROAS=${afterRoas.toFixed(2)}（无历史对比）` };
    }
    return { score: 50, detail: '数据不足，无法进行趋势对比' };
  }
  
  if (before.days < 3 || after.days < 3) {
    return { score: 50, detail: `数据天数不足（前${before.days}天/后${after.days}天）` };
  }
  
  const beforeAcos = before.totalSales > 0 ? (before.totalSpend / before.totalSales) * 100 : 999;
  const afterAcos = after.totalSales > 0 ? (after.totalSpend / after.totalSales) * 100 : 999;
  const beforeDailySales = before.totalSales / before.days;
  const afterDailySales = after.totalSales / after.days;
  const beforeDailyOrders = before.totalOrders / before.days;
  const afterDailyOrders = after.totalOrders / after.days;
  
  let trendPoints = 0;
  let maxPoints = 0;
  const improvements: string[] = [];
  
  // ACoS改善（权重30%）
  maxPoints += 30;
  if (beforeAcos < 900 && afterAcos < 900) {
    const acosImprovement = (beforeAcos - afterAcos) / Math.max(beforeAcos, 1);
    if (acosImprovement > 0.15) { trendPoints += 30; improvements.push(`ACoS↓${(acosImprovement * 100).toFixed(0)}%`); }
    else if (acosImprovement > 0.05) { trendPoints += 22; improvements.push(`ACoS↓${(acosImprovement * 100).toFixed(0)}%`); }
    else if (acosImprovement > -0.05) { trendPoints += 15; improvements.push('ACoS持平'); }
    else if (acosImprovement > -0.15) { trendPoints += 8; improvements.push(`ACoS↑${(-acosImprovement * 100).toFixed(0)}%`); }
    else { trendPoints += 0; improvements.push(`ACoS↑${(-acosImprovement * 100).toFixed(0)}%`); }
  } else {
    trendPoints += 15;
  }
  
  // 日均销售额改善（权重30%）
  maxPoints += 30;
  if (beforeDailySales > 0) {
    const salesGrowth = (afterDailySales - beforeDailySales) / beforeDailySales;
    if (salesGrowth > 0.2) { trendPoints += 30; improvements.push(`日销↑${(salesGrowth * 100).toFixed(0)}%`); }
    else if (salesGrowth > 0.05) { trendPoints += 22; improvements.push(`日销↑${(salesGrowth * 100).toFixed(0)}%`); }
    else if (salesGrowth > -0.05) { trendPoints += 15; improvements.push('日销持平'); }
    else if (salesGrowth > -0.2) { trendPoints += 8; improvements.push(`日销↓${(-salesGrowth * 100).toFixed(0)}%`); }
    else { trendPoints += 0; improvements.push(`日销↓${(-salesGrowth * 100).toFixed(0)}%`); }
  } else if (afterDailySales > 0) {
    trendPoints += 25;
    improvements.push('开始产生销售');
  } else {
    trendPoints += 10;
  }
  
  // 日均订单改善（权重20%）
  maxPoints += 20;
  if (beforeDailyOrders > 0) {
    const ordersGrowth = (afterDailyOrders - beforeDailyOrders) / beforeDailyOrders;
    if (ordersGrowth > 0.15) { trendPoints += 20; improvements.push(`日单↑${(ordersGrowth * 100).toFixed(0)}%`); }
    else if (ordersGrowth > 0) { trendPoints += 15; }
    else if (ordersGrowth > -0.1) { trendPoints += 10; }
    else { trendPoints += 3; }
  } else if (afterDailyOrders > 0) {
    trendPoints += 18;
  } else {
    trendPoints += 5;
  }
  
  // v164: 趋势方向加分（使用时间衰减趋势信号）
  maxPoints += 20;
  if (timeWeighted) {
    if (timeWeighted.trendDirection === 'improving') {
      trendPoints += 20;
      improvements.push('近期趋势向好');
    } else if (timeWeighted.trendDirection === 'stable') {
      trendPoints += 12;
      improvements.push('近期趋势稳定');
    } else {
      trendPoints += 4;
      improvements.push('近期趋势下行');
    }
  } else {
    trendPoints += 10;
  }
  
  const score = maxPoints > 0 ? Math.round((trendPoints / maxPoints) * 100) : 50;
  const detail = improvements.length > 0 ? improvements.join('，') : '趋势数据计算中';
  
  return { score: Math.min(100, Math.max(5, score)), detail };
}

/** v164: 多时间窗口趋势评分 */
function calculateMultiWindowTrendScore(
  multiWindow: MultiWindowTrendData,
  config: GroupConfig,
  timeWeighted?: TimeWeightedMetrics
): { score: number; detail: string } {
  let totalPoints = 0;
  let maxPoints = 0;
  const improvements: string[] = [];
  
  // 对比不同时间窗口的ACoS趋势：7d vs 30d, 30d vs 60d, 60d vs 90d
  const windows = [
    { label: '7天', data: multiWindow.recent7d },
    { label: '14天', data: multiWindow.recent14d },
    { label: '30天', data: multiWindow.recent30d },
    { label: '60天', data: multiWindow.recent60d },
    { label: '90天', data: multiWindow.recent90d },
  ].filter(w => w.data && w.data.totalSpend > 0);
  
  if (windows.length < 2) {
    return { score: 50, detail: '多时间窗口数据不足' };
  }
  
  // 短期 vs 长期ACoS对比（权重40%）
  maxPoints += 40;
  const shortWindow = windows[0]; // 最短时间窗口
  const longWindow = windows[windows.length - 1]; // 最长时间窗口
  
  if (shortWindow.data && longWindow.data && shortWindow.data.totalSales > 0 && longWindow.data.totalSales > 0) {
    const shortAcos = (shortWindow.data.totalSpend / shortWindow.data.totalSales) * 100;
    const longAcos = (longWindow.data.totalSpend / longWindow.data.totalSales) * 100;
    const acosImprovement = (longAcos - shortAcos) / Math.max(longAcos, 1);
    
    if (acosImprovement > 0.15) { totalPoints += 40; improvements.push(`近期ACoS比长期↓${(acosImprovement * 100).toFixed(0)}%`); }
    else if (acosImprovement > 0.05) { totalPoints += 30; improvements.push(`近期ACoS改善中`); }
    else if (acosImprovement > -0.05) { totalPoints += 20; improvements.push('ACoS趋势稳定'); }
    else if (acosImprovement > -0.15) { totalPoints += 10; improvements.push('ACoS近期上升'); }
    else { totalPoints += 2; improvements.push('ACoS近期恶化'); }
  } else {
    totalPoints += 20;
  }
  
  // 短期 vs 长期日均销售对比（权重30%）
  maxPoints += 30;
  if (shortWindow.data && longWindow.data) {
    const shortDailySales = shortWindow.data.totalSales / Math.max(shortWindow.data.days, 1);
    const longDailySales = longWindow.data.totalSales / Math.max(longWindow.data.days, 1);
    
    if (longDailySales > 0) {
      const salesGrowth = (shortDailySales - longDailySales) / longDailySales;
      if (salesGrowth > 0.2) { totalPoints += 30; improvements.push(`近期日销↑${(salesGrowth * 100).toFixed(0)}%`); }
      else if (salesGrowth > 0.05) { totalPoints += 22; }
      else if (salesGrowth > -0.05) { totalPoints += 15; }
      else if (salesGrowth > -0.2) { totalPoints += 8; }
      else { totalPoints += 2; }
    } else {
      totalPoints += shortDailySales > 0 ? 25 : 10;
    }
  } else {
    totalPoints += 15;
  }
  
  // 与优化前对比（权重30%）
  maxPoints += 30;
  if (multiWindow.preOptimization && shortWindow.data) {
    const preAcos = multiWindow.preOptimization.totalSales > 0 
      ? (multiWindow.preOptimization.totalSpend / multiWindow.preOptimization.totalSales) * 100 : 999;
    const postAcos = shortWindow.data.totalSales > 0 
      ? (shortWindow.data.totalSpend / shortWindow.data.totalSales) * 100 : 999;
    
    if (preAcos < 900 && postAcos < 900) {
      const improvement = (preAcos - postAcos) / Math.max(preAcos, 1);
      if (improvement > 0.2) { totalPoints += 30; improvements.push(`优化后ACoS↓${(improvement * 100).toFixed(0)}%`); }
      else if (improvement > 0.05) { totalPoints += 22; improvements.push(`优化后有改善`); }
      else if (improvement > -0.05) { totalPoints += 15; }
      else { totalPoints += 5; improvements.push('优化后ACoS上升'); }
    } else {
      totalPoints += 15;
    }
  } else {
    totalPoints += 15;
  }
  
  const score = maxPoints > 0 ? Math.round((totalPoints / maxPoints) * 100) : 50;
  const detail = improvements.length > 0 ? improvements.join('，') : '多窗口趋势计算中';
  
  return { score: Math.min(100, Math.max(5, score)), detail };
}

// ==================== 维度3: 预算效率（v164: 使用时间衰减加权日均花费） ====================

function calculateBudgetEfficiencyScore(
  config: GroupConfig,
  metrics: PerformanceMetrics,
  timeWeighted?: TimeWeightedMetrics
): { score: number; detail: string } {
  const dailyBudget = config.dailyBudget || config.dailySpendLimit || 0;
  
  if (dailyBudget <= 0) {
    if (metrics.totalSpend > 0 && metrics.totalSales > 0) {
      const roas = timeWeighted ? timeWeighted.weightedRoas : metrics.avgRoas;
      const score = roas >= 2 ? 80 : roas >= 1 ? 65 : 45;
      return { score, detail: `未设置预算上限，ROAS=${roas.toFixed(2)}` };
    }
    return { score: 50, detail: '未设置预算，暂无法评估效率' };
  }
  
  // v164: 使用时间衰减加权日均花费（近期数据权重更高）
  const avgDailySpend = timeWeighted 
    ? timeWeighted.weightedDailySpend 
    : (metrics.totalSpend / Math.max(1, (timeWeighted as any)?.effectiveDataDays || 30));
  const dataSource = timeWeighted ? '加权' : '平均';
  
  const utilizationRate = avgDailySpend / dailyBudget;
  
  let score: number;
  let detail: string;
  
  if (utilizationRate >= 0.75 && utilizationRate <= 1.05) {
    score = 95;
    detail = `${dataSource}日均花费$${avgDailySpend.toFixed(2)}，利用率${(utilizationRate * 100).toFixed(0)}%（最佳）`;
  } else if (utilizationRate >= 0.5 && utilizationRate < 0.75) {
    score = 65 + (utilizationRate - 0.5) / 0.25 * 30;
    detail = `${dataSource}日均花费$${avgDailySpend.toFixed(2)}，利用率${(utilizationRate * 100).toFixed(0)}%（偏低）`;
  } else if (utilizationRate >= 0.2 && utilizationRate < 0.5) {
    score = 35 + (utilizationRate - 0.2) / 0.3 * 30;
    detail = `${dataSource}日均花费$${avgDailySpend.toFixed(2)}，利用率${(utilizationRate * 100).toFixed(0)}%（偏低）`;
  } else if (utilizationRate < 0.2) {
    score = Math.max(10, utilizationRate / 0.2 * 35);
    detail = `${dataSource}日均花费$${avgDailySpend.toFixed(2)}，利用率${(utilizationRate * 100).toFixed(0)}%（极低）`;
  } else if (utilizationRate <= 1.2) {
    score = 80;
    detail = `${dataSource}日均花费$${avgDailySpend.toFixed(2)}，利用率${(utilizationRate * 100).toFixed(0)}%（略超）`;
  } else {
    score = Math.max(15, 80 - (utilizationRate - 1.2) * 80);
    detail = `${dataSource}日均花费$${avgDailySpend.toFixed(2)}，利用率${(utilizationRate * 100).toFixed(0)}%（超支）`;
  }
  
  // 花费产出效率加减分
  const roas = timeWeighted ? timeWeighted.weightedRoas : metrics.avgRoas;
  if (roas >= 2) score = Math.min(100, score + 5);
  else if (roas < 0.5 && metrics.totalSpend > 0) score = Math.max(10, score - 10);
  
  return { score: Math.round(Math.min(100, Math.max(5, score))), detail };
}

// ==================== 维度4: 转化效率 ====================

function calculateConversionEfficiencyScore(
  metrics: PerformanceMetrics,
  config: GroupConfig,
  timeWeighted?: TimeWeightedMetrics
): { score: number; detail: string } {
  if (metrics.totalClicks < 5 || metrics.totalSpend < 1) {
    return { score: 0, detail: '点击/花费数据不足' };
  }
  
  let totalPoints = 0;
  let maxPoints = 0;
  const details: string[] = [];
  
  // v164: 优先使用时间衰减加权指标
  const roas = timeWeighted ? timeWeighted.weightedRoas : metrics.avgRoas;
  const cvr = timeWeighted ? timeWeighted.weightedCvr : metrics.cvr;
  const cpc = timeWeighted ? timeWeighted.weightedCpc : metrics.cpc;
  
  // ROAS评分（权重40%）
  maxPoints += 40;
  if (roas >= 4) { totalPoints += 40; details.push(`ROAS ${roas.toFixed(2)}(优秀)`); }
  else if (roas >= 2.5) { totalPoints += 32; details.push(`ROAS ${roas.toFixed(2)}(良好)`); }
  else if (roas >= 1.5) { totalPoints += 24; details.push(`ROAS ${roas.toFixed(2)}(一般)`); }
  else if (roas >= 1) { totalPoints += 16; details.push(`ROAS ${roas.toFixed(2)}(偏低)`); }
  else if (roas > 0) { totalPoints += 8; details.push(`ROAS ${roas.toFixed(2)}(亏损)`); }
  else { totalPoints += 0; details.push('ROAS=0'); }
  
  // CVR评分（权重30%）
  maxPoints += 30;
  if (cvr >= 15) { totalPoints += 30; details.push(`CVR ${cvr.toFixed(1)}%`); }
  else if (cvr >= 10) { totalPoints += 25; }
  else if (cvr >= 5) { totalPoints += 18; }
  else if (cvr >= 2) { totalPoints += 12; }
  else if (cvr > 0) { totalPoints += 5; }
  else { totalPoints += 0; }
  
  // CPC效率评分（权重30%）
  maxPoints += 30;
  if (cpc > 0 && metrics.totalOrders > 0) {
    const costPerOrder = metrics.totalSpend / metrics.totalOrders;
    const avgOrderValue = metrics.totalSales / metrics.totalOrders;
    const costRatio = avgOrderValue > 0 ? costPerOrder / avgOrderValue : 1;
    
    if (costRatio <= 0.15) { totalPoints += 30; details.push(`单均成本占比${(costRatio * 100).toFixed(0)}%`); }
    else if (costRatio <= 0.25) { totalPoints += 24; }
    else if (costRatio <= 0.4) { totalPoints += 16; }
    else if (costRatio <= 0.6) { totalPoints += 10; }
    else { totalPoints += 4; }
  } else if (cpc > 0) {
    totalPoints += 5;
    details.push(`CPC $${cpc.toFixed(2)}，暂无转化`);
  }
  
  const score = maxPoints > 0 ? Math.round((totalPoints / maxPoints) * 100) : 0;
  const detail = details.join('，') || '转化数据计算中';
  
  return { score: Math.min(100, Math.max(0, score)), detail };
}

// ==================== 维度5: 渐进优化进度（v164新增） ====================

function calculateGradualProgressScore(
  config: GroupConfig,
  metrics: PerformanceMetrics,
  timeWeighted?: TimeWeightedMetrics,
  multiWindow?: MultiWindowTrendData
): { score: number; detail: string } {
  // 评估优化是否在渐进式地接近目标
  const targetAcos = config.targetAcos || 0;
  const targetRoas = config.targetRoas || 0;
  
  if (!timeWeighted) {
    return { score: 50, detail: '需要更多数据评估渐进优化进度' };
  }
  
  let score = 50; // 基础分
  const details: string[] = [];
  
  // 1. 数据置信度评估（20分）
  const confidence = timeWeighted.dataConfidence;
  if (confidence === 'high') { score += 10; details.push('数据充足'); }
  else if (confidence === 'medium') { score += 5; details.push('数据中等'); }
  else if (confidence === 'low') { score += 0; details.push('数据偏少'); }
  else { score -= 5; details.push('数据极少'); }
  
  // 2. 趋势方向评估（30分）
  if (timeWeighted.trendDirection === 'improving') {
    score += 20;
    details.push('指标持续改善');
  } else if (timeWeighted.trendDirection === 'stable') {
    score += 10;
    details.push('指标保持稳定');
  } else {
    score -= 5;
    details.push('指标有下行趋势');
  }
  
  // 3. 多窗口渐进性评估（如果有多窗口数据）
  if (multiWindow) {
    const windows = [
      multiWindow.recent90d,
      multiWindow.recent60d,
      multiWindow.recent30d,
      multiWindow.recent14d,
      multiWindow.recent7d,
    ].filter(w => w && w.totalSpend > 0);
    
    if (windows.length >= 3) {
      // 计算每个窗口的ACoS，检查是否呈渐进改善趋势
      const windowAcos = windows.map(w => {
        if (!w || w.totalSales <= 0) return null;
        return (w.totalSpend / w.totalSales) * 100;
      }).filter(a => a !== null) as number[];
      
      if (windowAcos.length >= 3) {
        // 检查ACoS是否呈递减趋势（从长期到短期）
        let improvingCount = 0;
        for (let i = 1; i < windowAcos.length; i++) {
          if (windowAcos[i] < windowAcos[i - 1]) improvingCount++;
        }
        const improvingRatio = improvingCount / (windowAcos.length - 1);
        
        if (improvingRatio >= 0.7) {
          score += 15;
          details.push('ACoS呈持续改善趋势');
        } else if (improvingRatio >= 0.5) {
          score += 8;
          details.push('ACoS有改善迹象');
        } else {
          score -= 5;
          details.push('ACoS改善不明显');
        }
      }
    }
  }
  
  // 4. 目标接近度评估
  if (targetAcos > 0) {
    const currentAcos = timeWeighted.weightedAcos;
    const gap = Math.abs(currentAcos - targetAcos) / targetAcos;
    
    if (currentAcos <= targetAcos) {
      score += 10;
      details.push('已达成ACoS目标');
    } else if (gap < 0.2) {
      score += 5;
      details.push(`距目标差距${(gap * 100).toFixed(0)}%`);
    } else if (gap < 0.5) {
      score += 0;
      details.push(`距目标差距${(gap * 100).toFixed(0)}%`);
    } else {
      score -= 5;
      details.push(`距目标差距较大(${(gap * 100).toFixed(0)}%)`);
    }
  }
  
  return {
    score: Math.min(100, Math.max(5, score)),
    detail: details.join('，') || '渐进优化评估中'
  };
}

// ==================== 主计算函数 ====================

// ==================== 维度6: NextGen算法效能 (v235新增) ====================

function calculateAlgorithmEfficacyScore(
  algorithmData?: AlgorithmEfficacyData
): { score: number; detail: string } {
  if (!algorithmData || algorithmData.totalOperations === 0) {
    return { score: 50, detail: '暂无算法执行数据，使用基础分' };
  }
  
  let score = 0;
  const details: string[] = [];
  
  // 1. 正向率评分（40分）— 优化后ACoS改善的比例
  const posRate = algorithmData.positiveRate;
  if (posRate >= 70) { score += 40; details.push(`正向率${posRate.toFixed(0)}%(优秀)`); }
  else if (posRate >= 55) { score += 30; details.push(`正向率${posRate.toFixed(0)}%(良好)`); }
  else if (posRate >= 40) { score += 20; details.push(`正向率${posRate.toFixed(0)}%(一般)`); }
  else if (posRate >= 25) { score += 10; details.push(`正向率${posRate.toFixed(0)}%(偏低)`); }
  else { score += 5; details.push(`正向率${posRate.toFixed(0)}%(待改善)`); }
  
  // 2. 算法层级分布评分（25分）— 高级算法使用比例越高越好
  const { advanced, ruleEngine, conservative } = algorithmData.tierDistribution;
  if (advanced >= 50) { score += 25; details.push(`高级算法${advanced}%`); }
  else if (advanced >= 30) { score += 20; details.push(`高级算法${advanced}%`); }
  else if (advanced >= 10) { score += 15; details.push(`高级算法${advanced}%`); }
  else if (ruleEngine >= 70) { score += 12; details.push(`规则引擎主导${ruleEngine}%`); }
  else { score += 8; details.push(`保守策略${conservative}%`); }
  
  // 3. 置信度评分（20分）— 算法对自己决策的信心
  const conf = algorithmData.avgConfidence;
  if (conf >= 0.7) { score += 20; }
  else if (conf >= 0.5) { score += 15; }
  else if (conf >= 0.3) { score += 10; }
  else { score += 5; }
  details.push(`置信度${(conf * 100).toFixed(0)}%`);
  
  // 4. 自我进化效果（15分）— 纠错数越少越好（说明算法已经很稳定）
  const corrections = algorithmData.evolutionCorrections;
  if (corrections === 0) { score += 15; details.push('无纠错(稳定)'); }
  else if (corrections <= 3) { score += 12; details.push(`纠错${corrections}次`); }
  else if (corrections <= 10) { score += 8; details.push(`纠错${corrections}次`); }
  else { score += 4; details.push(`纠错${corrections}次(较多)`); }
  
  // 改善趋势加减分
  if (algorithmData.improvementTrend === 'improving') {
    score = Math.min(100, score + 5);
    details.push('算法效果持续改善');
  } else if (algorithmData.improvementTrend === 'declining') {
    score = Math.max(5, score - 5);
    details.push('算法效果有下滑趋势');
  }
  
  return {
    score: Math.min(100, Math.max(5, score)),
    detail: details.join('，') || 'NextGen算法评估中'
  };
}

// ==================== 主计算函数 ====================

/**
 * 计算多维度目标达成度
 * 
 * v164: 新增timeWeighted和multiWindow参数，与渐进式+时间衰减逻辑对齐
 * v235: 新增algorithmData参数，与NextGen竞价编排器深度对齐
 */
export function calculateGoalProgress(
  config: GroupConfig,
  metrics: PerformanceMetrics,
  trendData?: TrendData,
  timeWeighted?: TimeWeightedMetrics,
  multiWindow?: MultiWindowTrendData,
  algorithmData?: AlgorithmEfficacyData
): GoalProgressResult {
  // 完全没有数据
  if (config.campaignCount === 0 && metrics.totalSpend < 0.01 && metrics.totalSales < 0.01) {
    return {
      totalScore: 0,
      dimensions: [],
      summary: '暂无广告活动数据',
      level: 'poor'
    };
  }
  
  const weights = getWeights(config.strategyTemplateId);
  
  // v164: 数据置信度修正系数
  const confidenceMultiplier = timeWeighted ? getConfidenceMultiplier(timeWeighted.dataConfidence) : 0.8;
  
  // 计算各维度得分
  const coreMetric = calculateCoreMetricScore(config, metrics, timeWeighted);
  const trend = trendData || multiWindow
    ? calculateTrendScore(trendData || { before: null, after: null }, config, timeWeighted, multiWindow)
    : { score: 50, detail: '趋势数据加载中' };
  const budgetEff = calculateBudgetEfficiencyScore(config, metrics, timeWeighted);
  const convEff = calculateConversionEfficiencyScore(metrics, config, timeWeighted);
  const gradualProgress = calculateGradualProgressScore(config, metrics, timeWeighted, multiWindow);
  const algEfficacy = calculateAlgorithmEfficacyScore(algorithmData);
  
  // 构建维度得分数组
  const dimensions: DimensionScore[] = [
    {
      name: 'coreMetric',
      nameZh: '指标达成',
      score: coreMetric.score,
      weight: weights.coreMetric,
      weighted: Math.round(coreMetric.score * weights.coreMetric / 100),
      detail: coreMetric.detail,
    },
    {
      name: 'trend',
      nameZh: '趋势改善',
      score: trend.score,
      weight: weights.trend,
      weighted: Math.round(trend.score * weights.trend / 100),
      detail: trend.detail,
    },
    {
      name: 'budgetEfficiency',
      nameZh: '预算效率',
      score: budgetEff.score,
      weight: weights.budgetEfficiency,
      weighted: Math.round(budgetEff.score * weights.budgetEfficiency / 100),
      detail: budgetEff.detail,
    },
    {
      name: 'conversionEfficiency',
      nameZh: '转化效率',
      score: convEff.score,
      weight: weights.conversionEfficiency,
      weighted: Math.round(convEff.score * weights.conversionEfficiency / 100),
      detail: convEff.detail,
    },
    {
      name: 'gradualProgress',
      nameZh: '渐进优化',
      score: gradualProgress.score,
      weight: weights.gradualProgress,
      weighted: Math.round(gradualProgress.score * weights.gradualProgress / 100),
      detail: gradualProgress.detail,
    },
    {
      name: 'algorithmEfficacy',
      nameZh: '算法效能',
      score: algEfficacy.score,
      weight: weights.algorithmEfficacy,
      weighted: Math.round(algEfficacy.score * weights.algorithmEfficacy / 100),
      detail: algEfficacy.detail,
    },
  ];
  
  // 计算加权总分
  let totalScore = dimensions.reduce((sum, d) => sum + d.weighted, 0);
  
  // v164: 应用数据置信度修正（低置信度时总分向50分靠拢）
  if (confidenceMultiplier < 1.0) {
    totalScore = Math.round(50 + (totalScore - 50) * confidenceMultiplier);
  }
  
  // 确定等级
  let level: GoalProgressResult['level'];
  if (totalScore >= 85) level = 'excellent';
  else if (totalScore >= 65) level = 'good';
  else if (totalScore >= 40) level = 'fair';
  else level = 'poor';
  
  // 生成总结
  const levelLabels = { excellent: '优秀', good: '良好', fair: '一般', poor: '待改善' };
  const topDimension = dimensions.reduce((a, b) => a.score > b.score ? a : b);
  const weakDimension = dimensions.reduce((a, b) => a.score < b.score ? a : b);
  
  let summary = `综合评分${totalScore}分（${levelLabels[level]}）`;
  if (topDimension.score > 70) {
    summary += `，${topDimension.nameZh}表现突出`;
  }
  if (weakDimension.score < 50 && weakDimension.score < topDimension.score - 20) {
    summary += `，${weakDimension.nameZh}需关注`;
  }
  
  // v164: 添加趋势方向说明
  if (timeWeighted) {
    const trendLabels = { improving: '持续改善中', stable: '保持稳定', declining: '需要关注' };
    summary += `，整体趋势${trendLabels[timeWeighted.trendDirection]}`;
  }
  
  return {
    totalScore: Math.min(100, Math.max(0, totalScore)),
    dimensions,
    summary,
    level,
  };
}
