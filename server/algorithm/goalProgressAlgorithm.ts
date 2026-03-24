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
 * 七大维度：
 * 1. 核心指标达成度 - 时间衰减加权ACoS/ROAS与目标值的对比
 * 2. 趋势改善度 - 多时间窗口渐进式改善评估
 * 3. 预算效率 - 时间衰减加权预算利用率
 * 4. 转化效率 - ROAS、CVR、CPC综合评估
 * 5. 渐进优化进度 - 优化是否在稳步接近目标
 * 6. NextGen算法效能 - 算法层级分布、正向率、自我进化效果 (v235新增)
 * 7. 广告效率 - ACOS健康度、ROAS表现、花费效率 (v272重构)
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
  profitHealth: number;       // v272重构: 广告效率（基于ACOS/ROAS等广告原生指标）
}

// v235: 重新分配权重，给算法效能维度10%权重，从其他维度均匀扣减
// v270 P1-2: 补齐全部11个策略模板的权重配置，消除缺失策略回退DEFAULT_WEIGHTS的问题
// v376 P2-01: 提升核心指标权重至35-45%，确保评分真实反映ACoS/ROAS偏离程度
const STRATEGY_WEIGHTS: Record<string, WeightConfig> = {
  // v376: 核心指标权重提升，其他维度等比例缩减
  'aggressive-growth':  { coreMetric: 35, trend: 18, budgetEfficiency: 3,  conversionEfficiency: 12, gradualProgress: 14, algorithmEfficacy: 8,  profitHealth: 10 },
  'balanced':           { coreMetric: 40, trend: 12, budgetEfficiency: 7,  conversionEfficiency: 10, gradualProgress: 13, algorithmEfficacy: 6,  profitHealth: 12 },
  'profit-focused':     { coreMetric: 45, trend: 4,  budgetEfficiency: 6,  conversionEfficiency: 8,  gradualProgress: 10, algorithmEfficacy: 5,  profitHealth: 22 },
  'seasonal-boost':     { coreMetric: 35, trend: 20, budgetEfficiency: 5,  conversionEfficiency: 10, gradualProgress: 12, algorithmEfficacy: 6,  profitHealth: 12 },
  'brand-defense':      { coreMetric: 40, trend: 5,  budgetEfficiency: 12, conversionEfficiency: 10, gradualProgress: 13, algorithmEfficacy: 8,  profitHealth: 12 },
  // v270 P1-2 + v271 + v376: 以下6个策略模板已补齐权重配置，并提升核心指标权重
  // 清仓策略: 核心指标提升，同时保留趋势和转化效率的重要性
  'inventory-clearance': { coreMetric: 30, trend: 20, budgetEfficiency: 5,  conversionEfficiency: 14, gradualProgress: 12, algorithmEfficacy: 8,  profitHealth: 11 },
  // 竞争攻击策略: 核心指标提升，同时保留渐进优化的重要性
  'competitor-attack':   { coreMetric: 30, trend: 16, budgetEfficiency: 3,  conversionEfficiency: 10, gradualProgress: 20, algorithmEfficacy: 10, profitHealth: 11 },
  // 市场扩张策略: 核心指标提升，同时保留算法效能的重要性
  'market-expansion':    { coreMetric: 30, trend: 18, budgetEfficiency: 3,  conversionEfficiency: 10, gradualProgress: 16, algorithmEfficacy: 11, profitHealth: 12 },
  // 季节性模式策略: 核心指标提升，同时保留趋势的重要性
  'seasonal-pattern':    { coreMetric: 35, trend: 20, budgetEfficiency: 5,  conversionEfficiency: 10, gradualProgress: 10, algorithmEfficacy: 6,  profitHealth: 14 },
  // 下滑管理策略: 核心指标提升，同时保留预算效率的重要性
  'decline-management':  { coreMetric: 40, trend: 7,  budgetEfficiency: 12, conversionEfficiency: 10, gradualProgress: 8,  algorithmEfficacy: 5,  profitHealth: 18 },
  // 紧急响应策略: 核心指标最高，同时保留预算效率和利润维度
  'emergency-response':  { coreMetric: 45, trend: 3,  budgetEfficiency: 14, conversionEfficiency: 8,  gradualProgress: 6,  algorithmEfficacy: 7,  profitHealth: 17 },
};

// v376: 默认权重也提升核心指标至40%
const DEFAULT_WEIGHTS: WeightConfig = { coreMetric: 40, trend: 12, budgetEfficiency: 7, conversionEfficiency: 10, gradualProgress: 13, algorithmEfficacy: 6, profitHealth: 12 };

function getWeights(strategyTemplateId: string | null): WeightConfig {
  const baseWeights = (!strategyTemplateId) ? DEFAULT_WEIGHTS : (STRATEGY_WEIGHTS[strategyTemplateId] || DEFAULT_WEIGHTS);
  
  // v272 P0-1: 集成weightAutoTuningService，优先使用自学习权重
  // v358.1: 使用延迟加载模式避免循环依赖，保持同步调用确保兼容性
  let weightModule: Record<string, unknown> | null = null;
  try {
    if (strategyTemplateId) {
      if (!weightModule) {
        weightModule = require('./weightAutoTuningService');
      }
      const getEffectiveWeights = (weightModule as Record<string, Function>).getEffectiveWeights;
      if (typeof getEffectiveWeights === 'function') {
        const tunedWeights = getEffectiveWeights(strategyTemplateId, baseWeights);
        if (tunedWeights && Object.keys(tunedWeights).length > 0) {
          return tunedWeights as unknown as WeightConfig;
        }
      }
    }
  } catch (_e: any) { // v362: 解析错误不影响进度计算
    // weightAutoTuningService不可用时降级到静态权重
  }
  return baseWeights;
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
  
  // v268 P0-2: 趋势方向加分 + “方向正确性”加分
  // 核心改进：对于ACoS绝对值虽未达标、但处于明确下降趋势的目标，给予额外加分
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
  
  // v268 P0-2: “方向正确性”加分机制
  // 当ACoS绝对值未达标但处于明确下降趋势时，额外加分奖励正确方向
  // 这解决了“ACoS从150%降到100%仍然得分很低”的不公平问题
  maxPoints += 10;
  if (beforeAcos < 900 && afterAcos < 900 && afterAcos > (config.targetAcos || 30)) {
    const acosImprovement = (beforeAcos - afterAcos) / Math.max(beforeAcos, 1);
    if (acosImprovement > 0.10 && timeWeighted?.trendDirection === 'improving') {
      trendPoints += 10;
      improvements.push(`v268方向正确加分: ACoS未达标但持续改善${(acosImprovement * 100).toFixed(0)}%`);
    } else if (acosImprovement > 0.05) {
      trendPoints += 6;
    } else {
      trendPoints += 2;
    }
  } else {
    trendPoints += 5; // ACoS已达标或无数据时给中间分
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
  const shortWindow = windows[0] as unknown; // 最短时间窗口
  const longWindow = windows[windows.length - 1]; // 最长时间窗口
  
  // @ts-ignore
  if (shortWindow.data && longWindow.data && shortWindow.data.totalSales > 0 && longWindow.data.totalSales > 0) {
    // @ts-ignore
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
  // @ts-ignore
  maxPoints += 30;
  // @ts-ignore
  if (shortWindow.data && longWindow.data) {
    // @ts-ignore
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
  // @ts-ignore
  }
  
  // 与优化前对比（权重30%）
  // @ts-ignore
  maxPoints += 30;
  // @ts-ignore
  if (multiWindow.preOptimization && shortWindow.data) {
    const preAcos = multiWindow.preOptimization.totalSales > 0 
      ? (multiWindow.preOptimization.totalSpend / multiWindow.preOptimization.totalSales) * 100 : 999;
    // @ts-ignore
    const postAcos = shortWindow.data.totalSales > 0 
      // @ts-ignore
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
    // @ts-expect-error - type assertion
    : (metrics.totalSpend / Math.max(1, (timeWeighted as unknown)?.effectiveDataDays || 30));
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
  
  // v268 P0-2: CVR评分（权重30%）— 引入品类基准对比
  // 不同品类的CVR基准差异很大，使用固定阈值对低客单价品类不公平
  // 品类基准CVR: 电子8-12%, 家居5-8%, 服装3-5%, 快消品15-25%
  const CATEGORY_CVR_BENCHMARK: Record<string, number> = {
    // @ts-ignore
    'electronics': 10, 'computers': 9, 'cell_phones': 8, 'video_games': 12,
    'home_kitchen': 7, 'sports_outdoors': 6, 'toys_games': 10, 'clothing': 4,
    'beauty': 8, 'health': 7, 'baby': 9, 'pet_supplies': 8,
    'grocery': 18, 'luxury': 3, 'default': 8,
  };
  // @ts-expect-error - dynamic property access
  const productCategory = (config as Record<string, unknown>).productCategory || 'default';
  // @ts-ignore
  const categoryCvrBenchmark = CATEGORY_CVR_BENCHMARK[productCategory] || CATEGORY_CVR_BENCHMARK['default'];
  
  maxPoints += 30;
  // v268: 使用品类基准进行相对评估，而非绝对值
  const cvrRatio = cvr / categoryCvrBenchmark;
  if (cvrRatio >= 1.5) { totalPoints += 30; details.push(`CVR ${cvr.toFixed(1)}%(超越品类基准${categoryCvrBenchmark}%)`); }
  else if (cvrRatio >= 1.0) { totalPoints += 25; details.push(`CVR ${cvr.toFixed(1)}%(达到品类基准)`); }
  else if (cvrRatio >= 0.7) { totalPoints += 18; details.push(`CVR ${cvr.toFixed(1)}%`); }
  else if (cvrRatio >= 0.4) { totalPoints += 12; }
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
  
  // v263: 修复无timeWeighted时的回退逻辑 — 使用metrics数据进行基础评估而非硬编码50分
  if (!timeWeighted) {
    // 即使没有时间衰减数据，也可以基于当前指标与目标的差距进行基础评估
    const targetAcosVal = config.targetAcos || 0;
    const targetRoasVal = config.targetRoas || 0;
    if (targetAcosVal > 0 && metrics.avgAcos > 0) {
      const gap = Math.abs(metrics.avgAcos - targetAcosVal) / targetAcosVal;
      const baseScore = metrics.avgAcos <= targetAcosVal ? 75 : gap < 0.3 ? 55 : gap < 0.6 ? 40 : 25;
      return { score: baseScore, detail: `基于ACoS与目标差距评估(差距${(gap * 100).toFixed(0)}%)` };
    }
    if (targetRoasVal > 0 && metrics.avgRoas > 0) {
      const gap = Math.abs(metrics.avgRoas - targetRoasVal) / targetRoasVal;
      const baseScore = metrics.avgRoas >= targetRoasVal ? 75 : gap < 0.3 ? 55 : gap < 0.6 ? 40 : 25;
      return { score: baseScore, detail: `基于ROAS与目标差距评估(差距${(gap * 100).toFixed(0)}%)` };
    }
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
  
  // v268 P0-2: 引入“优化速度”评估
  // 在多窗口数据中评估ACoS每周下降幅度，奖励快速接近目标的优化组
  if (multiWindow && targetAcos > 0) {
    const w7 = multiWindow.recent7d;
    const w30 = multiWindow.recent30d;
    if (w7 && w30 && w7.totalSales > 0 && w30.totalSales > 0) {
      const acos7d = (w7.totalSpend / w7.totalSales) * 100;
      const acos30d = (w30.totalSpend / w30.totalSales) * 100;
      const weeklyImprovement = (acos30d - acos7d) / Math.max(acos30d, 1);
      
      if (weeklyImprovement > 0.15) {
        score += 8;
        details.push(`v268优化速度优秀: ACoS周降${(weeklyImprovement * 100).toFixed(0)}%`);
      } else if (weeklyImprovement > 0.05) {
        score += 4;
        details.push(`优化速度良好`);
      } else if (weeklyImprovement > 0) {
        score += 2;
      }
    }
  }
  
  return {
    score: Math.min(100, Math.max(5, score)),
    detail: details.join('，') || '渐进优化评估中'
  };
}

// ==================== 主计算函数 ====================

// ==================== 维度7: 广告效率 (v272重构 - 基于广告原生指标) ====================

/**
 * v272 (修正版): 广告投放效率评分
 * 
 * 完全基于广告原生指标（ACOS、ROAS、花费、销售额）评估广告投放效率，
 * 不涉及任何商品成本(COGS)或利润率假设。
 * 
 * 对于亚马逊卖家而言，ACOS和ROAS就是最核心的广告效果衡量指标。
 */
function calculateDefaultProfitScore(metrics: PerformanceMetrics): { score: number; detail: string } {
  if (metrics.totalSpend < 0.01 || metrics.totalSales < 0.01) {
    return { score: 0, detail: '数据不足，无法评估广告投放效率' };
  }
  
  const roas = metrics.totalSpend > 0 ? metrics.totalSales / metrics.totalSpend : 0;
  const actualAcos = metrics.avgAcos; // 实际ACOS百分比
  const adNetValue = metrics.totalSales - metrics.totalSpend; // 广告投产净值
  
  let score = 0;
  
  // 1. ROAS表现评分（40%权重）— 亚马逊卖家最核心的投产比指标
  // 行业基准: ROAS >= 4x 优秀, >= 2.5x 良好, >= 1.5x 一般
  if (roas >= 7.0) score += 40;
  else if (roas >= 5.0) score += 35 + (roas - 5.0) / 2.0 * 5;
  else if (roas >= 4.0) score += 30 + (roas - 4.0) * 5;
  else if (roas >= 2.5) score += 20 + (roas - 2.5) / 1.5 * 10;
  else if (roas >= 1.5) score += 10 + (roas - 1.5) * 10;
  else if (roas >= 1.0) score += 4 + (roas - 1.0) * 12;
  else score += roas * 4;
  
  // 2. ACOS表现评分（35%权重）— 广告花费占销售额比例
  // 行业基准: ACOS <= 15% 优秀, <= 25% 良好, <= 35% 一般
  if (actualAcos <= 0) score += 0;
  else if (actualAcos <= 10) score += 35;
  else if (actualAcos <= 15) score += 30 + (15 - actualAcos) / 5 * 5;
  else if (actualAcos <= 25) score += 20 + (25 - actualAcos) / 10 * 10;
  else if (actualAcos <= 35) score += 10 + (35 - actualAcos) / 10 * 10;
  else if (actualAcos <= 50) score += 3 + (50 - actualAcos) / 15 * 7;
  else score += Math.max(0, 3 - (actualAcos - 50) / 20 * 3);
  
  // 3. 花费规模与效率评分（25%权重）— 有足够花费才有统计意义
  if (metrics.totalSpend >= 200 && roas >= 2.5) score += 25;
  else if (metrics.totalSpend >= 100 && roas >= 2.0) score += 20;
  else if (metrics.totalSpend >= 50 && roas >= 1.5) score += 15;
  else if (metrics.totalSpend >= 20 && roas >= 1.0) score += 10;
  else if (metrics.totalSpend >= 10) score += 5;
  else score += 2;
  
  score = Math.min(100, Math.max(0, Math.round(score)));
  
  const efficiencyStatus = adNetValue > 0 ? '正向' : '负向';
  return {
    score,
    detail: `广告效率评估: ROAS=${roas.toFixed(2)}x, ACOS=${actualAcos.toFixed(1)}%, ` +
      `花费$${metrics.totalSpend.toFixed(2)}, 销售$${metrics.totalSales.toFixed(2)}, ` +
      `投产净值${efficiencyStatus}$${Math.abs(adNetValue).toFixed(2)}`,
  };
}

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
  algorithmData?: AlgorithmEfficacyData,
  profitData?: { profitHealthScore: number; detail: string }
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
  // v266 P2-2: 增强趋势维度评分精度
  // 核心改进:
  //   1. 无数据场景不再硬编码50分，而是基于账户整体健康状态推断
  //   2. 新优化目标给予“新手保护”加分，避免初期得分过低
  //   3. 归因延迟感知：优化目标创建不足7天时，趋势得分不会拉低总分
  let trend: { score: number; detail: string };
  if (trendData || multiWindow) {
    trend = calculateTrendScore(trendData || { before: null, after: null }, config, timeWeighted, multiWindow);
  } else if (timeWeighted) {
    const trendDir = timeWeighted.trendDirection;
    // v266: 细化时间衰减信号的得分范围
    let baseScore: number;
    if (trendDir === 'improving') {
      // 改善中: 基于ROAS和ACoS的绝对值微调
      const roas = timeWeighted.weightedRoas || 0;
      baseScore = roas >= 3 ? 78 : roas >= 2 ? 72 : roas >= 1 ? 65 : 58;
    } else if (trendDir === 'stable') {
      baseScore = 55;
    } else {
      // 下行中: 基于下行幅度微调
      baseScore = 32;
    }
    trend = { score: baseScore, detail: `基于时间衰减趋势信号: ${trendDir} (ROAS=${(timeWeighted.weightedRoas || 0).toFixed(2)})` };
  } else {
    // v266: 无任何趋势数据时，基于当前绩效指标推断而非硬编码50
    const currentRoas = metrics.totalSpend > 0 ? metrics.totalSales / metrics.totalSpend : 0;
    const inferredScore = currentRoas >= 3 ? 65 : currentRoas >= 2 ? 55 : currentRoas >= 1 ? 45 : 35;
    trend = { score: inferredScore, detail: `趋势数据不足，基于当前ROAS(${currentRoas.toFixed(2)})推断` };
  }
  const budgetEff = calculateBudgetEfficiencyScore(config, metrics, timeWeighted);
  const convEff = calculateConversionEfficiencyScore(metrics, config, timeWeighted);
  const gradualProgress = calculateGradualProgressScore(config, metrics, timeWeighted, multiWindow);
  const algEfficacy = calculateAlgorithmEfficacyScore(algorithmData);
  
  // v271 P1-1 → v272重构: 第7维度 - 广告效率（基于ACOS/ROAS等广告原生指标）
  const profitHealth = profitData 
    ? { score: profitData.profitHealthScore, detail: profitData.detail }
    : calculateDefaultProfitScore(metrics);
  
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
    {
      name: 'profitHealth',
      nameZh: '广告效率',
      // @ts-ignore
      score: profitHealth.score,
      weight: weights.profitHealth,
      weighted: Math.round(profitHealth.score * weights.profitHealth / 100),
      detail: profitHealth.detail,
    },
  ];
  
  // 计算加权总分
  // @ts-ignore
  let totalScore = dimensions.reduce((sum: number, d: Record<string, unknown>) => sum + d.weighted, 0);
  
  // v385: 核心指标严重偏离惩罚机制
  // 当核心指标达成度很低时，其他维度不应过度补偿总分
  // @ts-ignore
  if (coreMetric.score < 50) {
    // 核心指标低于50分时，对总分施加惩罚系数
    // 核心指标得0分 -> 惩罚系数0.6，30分 -> 0.75，50分 -> 1.0
    const penaltyFactor = 0.6 + (coreMetric.score / 50) * 0.4;
    // @ts-ignore
    totalScore = Math.round(totalScore * penaltyFactor);
  // @ts-ignore
  }
  
  // v164: 应用数据置信度修正（低置信度时总分吆50分靠拢）
  if (confidenceMultiplier < 1.0) {
    // @ts-ignore
    totalScore = Math.round(50 + (totalScore - 50) * confidenceMultiplier);
  // @ts-ignore
  }
  
  // 确定等级
  let level: GoalProgressResult['level'];
  // @ts-ignore
  if (totalScore >= 85) level = 'excellent';
  // @ts-ignore
  else if (totalScore >= 65) level = 'good';
  // @ts-ignore
  else if (totalScore >= 40) level = 'fair';
  else level = 'poor';
  
  // 生成总结
  const levelLabels = { excellent: '优秀', good: '良好', fair: '一般', poor: '待改善' };
  // @ts-ignore
  const topDimension = dimensions.reduce((a: unknown, b: unknown) => a.score > b.score ? a : b);
  // @ts-ignore
  const weakDimension = dimensions.reduce((a: unknown, b: unknown) => a.score < b.score ? a : b);
  
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
    // @ts-ignore
    totalScore: Math.min(100, Math.max(0, totalScore)),
    dimensions,
    summary,
    level,
  };
}
