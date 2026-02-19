/**
 * goalProgressAlgorithm.ts - 多维度目标达成度科学评分算法
 * 
 * v162: 全新的多维度加权评分系统，替代原有的简单ACoS比率计算
 * 
 * 四大维度：
 * 1. 核心指标达成度 (Core Metric Achievement) - ACoS/ROAS与目标值的对比
 * 2. 趋势改善度 (Trend Improvement) - 加入优化目标后的表现改善
 * 3. 预算效率 (Budget Efficiency) - 预算利用率和花费合理性
 * 4. 转化效率 (Conversion Efficiency) - ROAS、CVR、CPC综合评估
 * 
 * 不同策略模板使用不同权重分配
 */

// ==================== 类型定义 ====================

export interface PerformanceMetrics {
  totalSpend: number;
  totalSales: number;
  totalOrders: number;
  totalClicks: number;
  totalImpressions: number;
  avgAcos: number;  // 百分比，如 25.5 表示 25.5%
  avgRoas: number;
  ctr: number;      // 百分比
  cvr: number;      // 百分比
  cpc: number;
}

export interface GroupConfig {
  id: number;
  optimizationGoal: string;
  targetAcos: number | null;    // 百分比
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
  score: number;       // 0-100
  weight: number;      // 权重百分比
  weighted: number;    // 加权后得分
  detail: string;      // 详细说明
}

export interface GoalProgressResult {
  totalScore: number;           // 总分 0-100
  dimensions: DimensionScore[]; // 各维度得分明细
  summary: string;              // 总结说明
  level: 'excellent' | 'good' | 'fair' | 'poor'; // 等级
}

// ==================== 策略模板权重配置 ====================

interface WeightConfig {
  coreMetric: number;      // 核心指标达成度权重
  trend: number;           // 趋势改善度权重
  budgetEfficiency: number; // 预算效率权重
  conversionEfficiency: number; // 转化效率权重
}

/**
 * 不同策略模板的权重分配
 * 所有权重之和 = 100
 */
const STRATEGY_WEIGHTS: Record<string, WeightConfig> = {
  // 激进增长：侧重销售增长趋势和曝光
  'aggressive-growth': { coreMetric: 25, trend: 35, budgetEfficiency: 15, conversionEfficiency: 25 },
  // 平衡增长：四维度均衡
  'balanced': { coreMetric: 30, trend: 25, budgetEfficiency: 20, conversionEfficiency: 25 },
  // 利润优先：侧重ACoS达成和转化效率
  'profit-focused': { coreMetric: 40, trend: 15, budgetEfficiency: 20, conversionEfficiency: 25 },
  // 旺季冲刺：侧重销售额增长
  'seasonal-boost': { coreMetric: 20, trend: 40, budgetEfficiency: 15, conversionEfficiency: 25 },
  // 品牌防御：侧重核心指标稳定和预算控制
  'brand-defense': { coreMetric: 35, trend: 15, budgetEfficiency: 25, conversionEfficiency: 25 },
};

// 默认权重（无策略模板时使用）
const DEFAULT_WEIGHTS: WeightConfig = { coreMetric: 30, trend: 25, budgetEfficiency: 20, conversionEfficiency: 25 };

function getWeights(strategyTemplateId: string | null): WeightConfig {
  if (!strategyTemplateId) return DEFAULT_WEIGHTS;
  return STRATEGY_WEIGHTS[strategyTemplateId] || DEFAULT_WEIGHTS;
}

// ==================== 维度1: 核心指标达成度 ====================

function calculateCoreMetricScore(config: GroupConfig, metrics: PerformanceMetrics): { score: number; detail: string } {
  const { optimizationGoal, targetAcos, targetRoas } = config;
  
  // 数据不足
  if (metrics.totalSpend < 0.5 && metrics.totalSales < 0.5) {
    return { score: 0, detail: '数据不足，暂无法评估' };
  }
  
  // 目标ACoS
  if ((optimizationGoal === 'target_acos' || targetAcos) && targetAcos && targetAcos > 0) {
    const actualAcos = metrics.avgAcos;
    if (actualAcos <= 0 && metrics.totalSales > 0) {
      return { score: 100, detail: `完美：有销售无花费，ACoS=0%（目标≤${targetAcos}%）` };
    }
    if (actualAcos <= 0) {
      return { score: 0, detail: `无有效数据（目标ACoS≤${targetAcos}%）` };
    }
    
    // ACoS达成率计算：目标/实际，达到目标=100分
    // 使用平滑曲线：达标100分，超标按比例递减但不会过于陡峭
    const ratio = targetAcos / actualAcos;
    let score: number;
    if (ratio >= 1) {
      // 达标或优于目标：100分，最高不超过100
      score = 100;
    } else if (ratio >= 0.8) {
      // 接近目标（80%-100%）：线性映射到 70-100
      score = 70 + (ratio - 0.8) / 0.2 * 30;
    } else if (ratio >= 0.5) {
      // 中等偏差（50%-80%）：线性映射到 30-70
      score = 30 + (ratio - 0.5) / 0.3 * 40;
    } else {
      // 严重偏差（<50%）：线性映射到 5-30
      score = Math.max(5, ratio / 0.5 * 30);
    }
    
    return {
      score: Math.round(score),
      detail: `实际ACoS ${actualAcos.toFixed(1)}% / 目标≤${targetAcos}%（达成率${(ratio * 100).toFixed(0)}%）`
    };
  }
  
  // 目标ROAS
  if ((optimizationGoal === 'target_roas' || targetRoas) && targetRoas && targetRoas > 0) {
    const actualRoas = metrics.avgRoas;
    if (actualRoas <= 0) {
      return { score: 5, detail: `ROAS=0（目标≥${targetRoas}）` };
    }
    
    const ratio = actualRoas / targetRoas;
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
      detail: `实际ROAS ${actualRoas.toFixed(2)} / 目标≥${targetRoas}（达成率${(ratio * 100).toFixed(0)}%）`
    };
  }
  
  // 最大化销售额
  if (optimizationGoal === 'maximize_sales') {
    const roas = metrics.avgRoas;
    let score: number;
    if (roas >= 3) score = 100;
    else if (roas >= 2) score = 80 + (roas - 2) * 20;
    else if (roas >= 1) score = 50 + (roas - 1) * 30;
    else if (roas > 0) score = Math.max(10, roas * 50);
    else score = 5;
    
    return {
      score: Math.round(score),
      detail: `ROAS ${roas.toFixed(2)}（销售最大化模式，ROAS≥2为良好）`
    };
  }
  
  // 每日花费上限
  if (optimizationGoal === 'daily_spend_limit' || optimizationGoal === 'daily_cost') {
    const dailyLimit = config.dailySpendLimit || config.dailyBudget || 0;
    if (dailyLimit <= 0) {
      return { score: 50, detail: '未设置花费上限目标' };
    }
    // 假设campaignCount天数据，计算日均花费
    const daysActive = Math.max(1, 30); // 假设30天窗口
    const avgDailySpend = metrics.totalSpend / daysActive;
    const ratio = avgDailySpend / dailyLimit;
    
    let score: number;
    if (ratio <= 1 && ratio >= 0.7) {
      // 花费在70%-100%之间：最佳利用
      score = 100;
    } else if (ratio < 0.7 && ratio >= 0.3) {
      // 花费偏低：预算未充分利用
      score = 60 + (ratio - 0.3) / 0.4 * 40;
    } else if (ratio < 0.3) {
      score = Math.max(20, ratio / 0.3 * 60);
    } else if (ratio <= 1.2) {
      // 略微超支
      score = 80;
    } else {
      // 严重超支
      score = Math.max(10, 80 - (ratio - 1.2) * 100);
    }
    
    return {
      score: Math.round(Math.min(100, Math.max(5, score))),
      detail: `日均花费$${avgDailySpend.toFixed(2)} / 上限$${dailyLimit.toFixed(2)}`
    };
  }
  
  // 兜底：基于ROAS的通用评估
  const roas = metrics.avgRoas;
  let score = roas >= 2 ? 80 : roas >= 1 ? 60 : Math.max(20, roas * 60);
  return {
    score: Math.round(score),
    detail: `ROAS ${roas.toFixed(2)}（通用评估）`
  };
}

// ==================== 维度2: 趋势改善度 ====================

function calculateTrendScore(trendData: TrendData, config: GroupConfig): { score: number; detail: string } {
  const { before, after } = trendData;
  
  // 没有前后对比数据
  if (!before || !after) {
    // 如果只有after数据（新创建的优化目标），给予基础分
    if (after && after.days > 0 && after.totalSpend > 0) {
      const afterRoas = after.totalSpend > 0 ? after.totalSales / after.totalSpend : 0;
      const score = afterRoas >= 2 ? 70 : afterRoas >= 1 ? 55 : 40;
      return { score, detail: `新优化目标，ROAS=${afterRoas.toFixed(2)}（无历史对比）` };
    }
    return { score: 50, detail: '数据不足，无法进行趋势对比' };
  }
  
  // 前后数据都不足
  if (before.days < 3 || after.days < 3) {
    return { score: 50, detail: `数据天数不足（前${before.days}天/后${after.days}天），需更多数据` };
  }
  
  // 计算日均指标进行对比
  const beforeDailySpend = before.totalSpend / before.days;
  const beforeDailySales = before.totalSales / before.days;
  const beforeDailyOrders = before.totalOrders / before.days;
  const beforeAcos = before.totalSales > 0 ? (before.totalSpend / before.totalSales) * 100 : 999;
  const beforeRoas = before.totalSpend > 0 ? before.totalSales / before.totalSpend : 0;
  const beforeCvr = before.totalClicks > 0 ? (before.totalOrders / before.totalClicks) * 100 : 0;
  
  const afterDailySpend = after.totalSpend / after.days;
  const afterDailySales = after.totalSales / after.days;
  const afterDailyOrders = after.totalOrders / after.days;
  const afterAcos = after.totalSales > 0 ? (after.totalSpend / after.totalSales) * 100 : 999;
  const afterRoas = after.totalSpend > 0 ? after.totalSales / after.totalSpend : 0;
  const afterCvr = after.totalClicks > 0 ? (after.totalOrders / after.totalClicks) * 100 : 0;
  
  // 多指标综合趋势评分
  let trendPoints = 0;
  let maxPoints = 0;
  const improvements: string[] = [];
  
  // ACoS改善（权重30%）- ACoS降低是好事
  maxPoints += 30;
  if (beforeAcos < 900 && afterAcos < 900) {
    const acosImprovement = (beforeAcos - afterAcos) / Math.max(beforeAcos, 1);
    if (acosImprovement > 0.15) { trendPoints += 30; improvements.push(`ACoS↓${(acosImprovement * 100).toFixed(0)}%`); }
    else if (acosImprovement > 0.05) { trendPoints += 22; improvements.push(`ACoS↓${(acosImprovement * 100).toFixed(0)}%`); }
    else if (acosImprovement > -0.05) { trendPoints += 15; improvements.push('ACoS持平'); }
    else if (acosImprovement > -0.15) { trendPoints += 8; improvements.push(`ACoS↑${(-acosImprovement * 100).toFixed(0)}%`); }
    else { trendPoints += 0; improvements.push(`ACoS↑${(-acosImprovement * 100).toFixed(0)}%`); }
  } else {
    trendPoints += 15; // 数据不足给中间分
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
    trendPoints += 25; // 从0到有销售
    improvements.push('开始产生销售');
  } else {
    trendPoints += 10;
  }
  
  // ROAS改善（权重20%）
  maxPoints += 20;
  if (beforeRoas > 0) {
    const roasGrowth = (afterRoas - beforeRoas) / beforeRoas;
    if (roasGrowth > 0.15) { trendPoints += 20; improvements.push(`ROAS↑${(roasGrowth * 100).toFixed(0)}%`); }
    else if (roasGrowth > 0) { trendPoints += 15; improvements.push(`ROAS↑${(roasGrowth * 100).toFixed(0)}%`); }
    else if (roasGrowth > -0.1) { trendPoints += 10; improvements.push('ROAS持平'); }
    else { trendPoints += 3; improvements.push(`ROAS↓${(-roasGrowth * 100).toFixed(0)}%`); }
  } else if (afterRoas > 0) {
    trendPoints += 18;
    improvements.push('ROAS从0改善');
  } else {
    trendPoints += 5;
  }
  
  // CVR改善（权重20%）
  maxPoints += 20;
  if (beforeCvr > 0) {
    const cvrGrowth = (afterCvr - beforeCvr) / beforeCvr;
    if (cvrGrowth > 0.1) { trendPoints += 20; improvements.push(`CVR↑${(cvrGrowth * 100).toFixed(0)}%`); }
    else if (cvrGrowth > 0) { trendPoints += 15; }
    else if (cvrGrowth > -0.1) { trendPoints += 10; }
    else { trendPoints += 3; }
  } else {
    trendPoints += 10;
  }
  
  const score = maxPoints > 0 ? Math.round((trendPoints / maxPoints) * 100) : 50;
  const detail = improvements.length > 0 ? improvements.join('，') : '趋势数据计算中';
  
  return { score: Math.min(100, Math.max(5, score)), detail };
}

// ==================== 维度3: 预算效率 ====================

function calculateBudgetEfficiencyScore(config: GroupConfig, metrics: PerformanceMetrics): { score: number; detail: string } {
  const dailyBudget = config.dailyBudget || config.dailySpendLimit || 0;
  
  // 没有设置预算
  if (dailyBudget <= 0) {
    // 没有预算限制时，根据花费产出比评估
    if (metrics.totalSpend > 0 && metrics.totalSales > 0) {
      const roas = metrics.avgRoas;
      const score = roas >= 2 ? 80 : roas >= 1 ? 65 : 45;
      return { score, detail: `未设置预算上限，ROAS=${roas.toFixed(2)}` };
    }
    return { score: 50, detail: '未设置预算，暂无法评估效率' };
  }
  
  // 计算预算利用率（假设30天窗口）
  const totalBudget = dailyBudget * 30;
  const utilizationRate = totalBudget > 0 ? metrics.totalSpend / totalBudget : 0;
  
  let score: number;
  let detail: string;
  
  if (utilizationRate >= 0.75 && utilizationRate <= 1.05) {
    // 最佳区间：75%-105%利用率
    score = 95;
    detail = `预算利用率${(utilizationRate * 100).toFixed(0)}%（最佳区间）`;
  } else if (utilizationRate >= 0.5 && utilizationRate < 0.75) {
    // 偏低但可接受
    score = 65 + (utilizationRate - 0.5) / 0.25 * 30;
    detail = `预算利用率${(utilizationRate * 100).toFixed(0)}%（偏低，可提高曝光）`;
  } else if (utilizationRate >= 0.2 && utilizationRate < 0.5) {
    // 明显偏低
    score = 35 + (utilizationRate - 0.2) / 0.3 * 30;
    detail = `预算利用率${(utilizationRate * 100).toFixed(0)}%（偏低，建议检查竞价或关键词）`;
  } else if (utilizationRate < 0.2) {
    // 极低
    score = Math.max(10, utilizationRate / 0.2 * 35);
    detail = `预算利用率${(utilizationRate * 100).toFixed(0)}%（极低，广告可能未有效投放）`;
  } else if (utilizationRate <= 1.2) {
    // 略微超支
    score = 80;
    detail = `预算利用率${(utilizationRate * 100).toFixed(0)}%（略超预算）`;
  } else {
    // 严重超支
    score = Math.max(15, 80 - (utilizationRate - 1.2) * 80);
    detail = `预算利用率${(utilizationRate * 100).toFixed(0)}%（超支，需要控制花费）`;
  }
  
  // 额外考虑：花费的产出效率
  if (metrics.totalSpend > 0) {
    const spendEfficiency = metrics.totalSales / metrics.totalSpend;
    if (spendEfficiency >= 2) score = Math.min(100, score + 5);
    else if (spendEfficiency < 0.5) score = Math.max(10, score - 10);
  }
  
  return { score: Math.round(Math.min(100, Math.max(5, score))), detail };
}

// ==================== 维度4: 转化效率 ====================

function calculateConversionEfficiencyScore(metrics: PerformanceMetrics, config: GroupConfig): { score: number; detail: string } {
  // 数据不足
  if (metrics.totalClicks < 5 || metrics.totalSpend < 1) {
    return { score: 0, detail: '点击/花费数据不足，暂无法评估转化效率' };
  }
  
  let totalPoints = 0;
  let maxPoints = 0;
  const details: string[] = [];
  
  // ROAS评分（权重40%）
  maxPoints += 40;
  const roas = metrics.avgRoas;
  if (roas >= 4) { totalPoints += 40; details.push(`ROAS ${roas.toFixed(2)}(优秀)`); }
  else if (roas >= 2.5) { totalPoints += 32; details.push(`ROAS ${roas.toFixed(2)}(良好)`); }
  else if (roas >= 1.5) { totalPoints += 24; details.push(`ROAS ${roas.toFixed(2)}(一般)`); }
  else if (roas >= 1) { totalPoints += 16; details.push(`ROAS ${roas.toFixed(2)}(偏低)`); }
  else if (roas > 0) { totalPoints += 8; details.push(`ROAS ${roas.toFixed(2)}(亏损)`); }
  else { totalPoints += 0; details.push('ROAS=0'); }
  
  // CVR评分（权重30%）
  maxPoints += 30;
  const cvr = metrics.cvr;
  if (cvr >= 15) { totalPoints += 30; details.push(`CVR ${cvr.toFixed(1)}%`); }
  else if (cvr >= 10) { totalPoints += 25; }
  else if (cvr >= 5) { totalPoints += 18; }
  else if (cvr >= 2) { totalPoints += 12; }
  else if (cvr > 0) { totalPoints += 5; }
  else { totalPoints += 0; }
  
  // CPC效率评分（权重30%）- 基于CPC与产出的关系
  maxPoints += 30;
  const cpc = metrics.cpc;
  if (cpc > 0 && metrics.totalOrders > 0) {
    // 每单广告成本 = 总花费 / 总订单数
    const costPerOrder = metrics.totalSpend / metrics.totalOrders;
    // 每单广告成本占销售额的比例
    const avgOrderValue = metrics.totalSales / metrics.totalOrders;
    const costRatio = avgOrderValue > 0 ? costPerOrder / avgOrderValue : 1;
    
    if (costRatio <= 0.15) { totalPoints += 30; details.push(`单均广告成本占比${(costRatio * 100).toFixed(0)}%`); }
    else if (costRatio <= 0.25) { totalPoints += 24; }
    else if (costRatio <= 0.4) { totalPoints += 16; }
    else if (costRatio <= 0.6) { totalPoints += 10; }
    else { totalPoints += 4; }
  } else if (cpc > 0) {
    // 有点击无转化
    totalPoints += 5;
    details.push(`CPC $${cpc.toFixed(2)}，暂无转化`);
  }
  
  const score = maxPoints > 0 ? Math.round((totalPoints / maxPoints) * 100) : 0;
  const detail = details.join('，') || '转化数据计算中';
  
  return { score: Math.min(100, Math.max(0, score)), detail };
}

// ==================== 主计算函数 ====================

/**
 * 计算多维度目标达成度
 * 
 * @param config - 优化目标配置
 * @param metrics - 当前绩效指标
 * @param trendData - 趋势对比数据（可选）
 * @returns GoalProgressResult - 包含总分、各维度明细、等级
 */
export function calculateGoalProgress(
  config: GroupConfig,
  metrics: PerformanceMetrics,
  trendData?: TrendData
): GoalProgressResult {
  // 完全没有数据时返回null等效结果
  if (config.campaignCount === 0 && metrics.totalSpend < 0.01 && metrics.totalSales < 0.01) {
    return {
      totalScore: 0,
      dimensions: [],
      summary: '暂无广告活动数据',
      level: 'poor'
    };
  }
  
  const weights = getWeights(config.strategyTemplateId);
  
  // 计算各维度得分
  const coreMetric = calculateCoreMetricScore(config, metrics);
  const trend = trendData 
    ? calculateTrendScore(trendData, config)
    : { score: 50, detail: '趋势数据加载中' };
  const budgetEff = calculateBudgetEfficiencyScore(config, metrics);
  const convEff = calculateConversionEfficiencyScore(metrics, config);
  
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
  ];
  
  // 计算加权总分
  const totalScore = dimensions.reduce((sum, d) => sum + d.weighted, 0);
  
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
  
  return {
    totalScore: Math.min(100, Math.max(0, totalScore)),
    dimensions,
    summary,
    level,
  };
}
