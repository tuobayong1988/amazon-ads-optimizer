/**
 * Amazon Ads Bid Optimization Algorithm
 * Based on market curve modeling and marginal analysis
 */

import { Keyword, ProductTarget, PerformanceGroup, Campaign } from "../drizzle/schema";
import { calculateDynamicElasticity, getElasticity, estimateCPC, type BidChangeRecord } from "./algorithmUtils";

// Types for optimization
export interface OptimizationTarget {
  id: number;
  type: "keyword" | "product_target";
  currentBid: number;
  impressions: number;
  clicks: number;
  spend: number;
  sales: number;
  orders: number;
  matchType?: string;
  // 冷启动探测所需字段
  campaignStartDate?: Date; // Campaign创建日期，用于判断是否为新品
  historicalAvgImpressions?: number; // 历史日均曝光量，用于断货检测
  // ASP变动感知字段
  currentASP?: number; // 当前ASP (Average Selling Price)
  historicalASP?: number; // 过去14天平均ASP
  // 专家建议新增：库存与业务感知
  inventoryLevel?: 'normal' | 'low' | 'critical' | 'out_of_stock'; // 库存水平
  inventoryDays?: number; // 剩余库存天数
  organicRank?: number; // 自然排名（如果有）
  isStockout?: boolean; // 是否缺货
  // 专家建议：动态弹性系数所需字段
  bidChangeHistory?: BidChangeRecord[]; // 历史出价变动记录，用于OLS回归计算真实弹性
  category?: string; // 商品类目，用于fallback弹性系数
}

export interface OptimizationResult {
  targetId: number;
  targetType: "keyword" | "product_target";
  previousBid: number;
  newBid: number;
  actionType: "increase" | "decrease" | "set";
  bidChangePercent: number;
  reason: string;
}

export interface MarketCurvePoint {
  bidLevel: number;
  estimatedImpressions: number;
  estimatedClicks: number;
  estimatedConversions: number;
  estimatedSpend: number;
  estimatedSales: number;
  marginalRevenue: number;
  marginalCost: number;
}

export interface PerformanceGroupConfig {
  optimizationGoal: string;
  targetAcos?: number;
  targetRoas?: number;
  dailySpendLimit?: number;
  dailyCostTarget?: number;
  dailyBudget?: number;
  maxBid?: number;
  // 专家建议新增：广告组/Campaign平均CVR作为贝叶斯先验数据
  groupAvgCvr?: number;
  // 专家建议新增：广告组/Campaign平均CPC
  groupAvgCpc?: number;
  // 专家建议新增：平均订单价值
  groupAvgAov?: number;
}

/**
 * Calculate key performance metrics
 */
export function calculateMetrics(target: OptimizationTarget) {
  const acos = target.sales > 0 ? (target.spend / target.sales) * 100 : 0;
  const roas = target.spend > 0 ? target.sales / target.spend : 0;
  const ctr = target.impressions > 0 ? (target.clicks / target.impressions) * 100 : 0;
  const cvr = target.clicks > 0 ? (target.orders / target.clicks) * 100 : 0;
  const cpc = target.clicks > 0 ? target.spend / target.clicks : 0;
  const aov = target.orders > 0 ? target.sales / target.orders : 0; // Average Order Value
  
  return { acos, roas, ctr, cvr, cpc, aov };
}

/**
 * Estimate traffic ceiling based on historical data
 * Uses diminishing returns model
 */
export function estimateTrafficCeiling(
  currentBid: number,
  currentImpressions: number,
  historicalData?: { bid: number; impressions: number }[]
): number {
  // If we have historical data, use curve fitting
  if (historicalData && historicalData.length >= 3) {
    // Use logarithmic model: impressions = a * ln(bid) + b
    const n = historicalData.length;
    const sumLnBid = historicalData.reduce((s, d) => s + Math.log(d.bid), 0);
    const sumImpressions = historicalData.reduce((s, d) => s + d.impressions, 0);
    const sumLnBidImpressions = historicalData.reduce((s, d) => s + Math.log(d.bid) * d.impressions, 0);
    const sumLnBidSq = historicalData.reduce((s, d) => s + Math.log(d.bid) ** 2, 0);
    
    const a = (n * sumLnBidImpressions - sumLnBid * sumImpressions) / (n * sumLnBidSq - sumLnBid ** 2);
    
    // Estimate ceiling at bid = $10 (practical maximum)
    const ceilingBid = 10;
    const ceiling = a * Math.log(ceilingBid) + (sumImpressions - a * sumLnBid) / n;
    
    return Math.max(ceiling, currentImpressions * 1.5);
  }
  
  // Default estimation based on current performance
  // Assume current bid captures ~60% of potential traffic
  return Math.round(currentImpressions / 0.6);
}

/**
 * Calculate marginal revenue and cost
 * MR = change in revenue / change in bid
 * MC = change in cost / change in bid
 */
export function calculateMarginalValues(
  currentBid: number,
  currentMetrics: OptimizationTarget,
  bidIncrement: number = 0.10
): { marginalRevenue: number; marginalCost: number; marginalProfit: number } {
  const { acos, roas, cvr, cpc, aov } = calculateMetrics(currentMetrics);
  
  // 使用动态弹性系数计算
  // 如果有历史出价变化数据，使用动态计算；否则使用默认值
  // 专家建议：使用动态弹性系数替代固定0.8
  // 如果有历史出价变动数据，通过加权OLS回归计算真实弹性；否则fallback到类目默认值
  const clickElasticity = getElasticity(currentMetrics.bidChangeHistory || [], currentMetrics.category)
  
  // Estimate new clicks at higher bid
  const bidChangePercent = bidIncrement / currentBid;
  const estimatedClickIncrease = currentMetrics.clicks * clickElasticity * bidChangePercent;
  
  // Marginal cost = additional spend from bid increase
  const marginalCost = estimatedClickIncrease * (cpc + bidIncrement);
  
  // Marginal revenue = additional sales from more clicks
  const marginalRevenue = estimatedClickIncrease * (cvr / 100) * aov;
  
  // Marginal profit
  const marginalProfit = marginalRevenue - marginalCost;
  
  return { marginalRevenue, marginalCost, marginalProfit };
}

/**
 * Generate market curve data points
 */
export function generateMarketCurve(
  target: OptimizationTarget,
  minBid: number = 0.10,
  maxBid: number = 5.00,
  steps: number = 20
): MarketCurvePoint[] {
  const points: MarketCurvePoint[] = [];
  const bidStep = (maxBid - minBid) / steps;
  const { cvr, aov } = calculateMetrics(target);
  
  // Base metrics at current bid
  const baseClicks = target.clicks;
  const baseBid = target.currentBid;
  
  for (let i = 0; i <= steps; i++) {
    const bidLevel = minBid + i * bidStep;
    
    // 使用对数模型估算点击量
    // clicks = baseClicks * (1 + elasticity * ln(bidLevel / baseBid))
    // 弹性系数可通过getElasticity()动态获取
    // 专家建议：使用动态弹性系数替代固定0.8
    const elasticity = getElasticity(target.bidChangeHistory || [], target.category)
    const clickMultiplier = 1 + elasticity * Math.log(bidLevel / baseBid);
    const estimatedClicks = Math.max(0, baseClicks * clickMultiplier);
    
    // Estimate impressions (clicks / CTR)
    const ctr = target.impressions > 0 ? target.clicks / target.impressions : 0.01;
    const estimatedImpressions = estimatedClicks / ctr;
    
    // Estimate conversions and sales
    const estimatedConversions = estimatedClicks * (cvr / 100);
    const estimatedSales = estimatedConversions * aov;
    
    // Estimate spend (clicks * estimated CPC at this bid level)
    // CPC is typically 60-80% of max bid
    const estimatedCpc = bidLevel * 0.7;
    const estimatedSpend = estimatedClicks * estimatedCpc;
    
    // Calculate marginal values
    let marginalRevenue = 0;
    let marginalCost = 0;
    
    if (i > 0) {
      const prevPoint = points[i - 1];
      marginalRevenue = (estimatedSales - prevPoint.estimatedSales) / bidStep;
      marginalCost = (estimatedSpend - prevPoint.estimatedSpend) / bidStep;
    }
    
    points.push({
      bidLevel: Math.round(bidLevel * 100) / 100,
      estimatedImpressions: Math.round(estimatedImpressions),
      estimatedClicks: Math.round(estimatedClicks),
      estimatedConversions: Math.round(estimatedConversions * 100) / 100,
      estimatedSpend: Math.round(estimatedSpend * 100) / 100,
      estimatedSales: Math.round(estimatedSales * 100) / 100,
      marginalRevenue: Math.round(marginalRevenue * 100) / 100,
      marginalCost: Math.round(marginalCost * 100) / 100,
    });
  }
  
  return points;
}

/**
 * Find optimal bid point where MR = MC
 */
export function findOptimalBid(
  marketCurve: MarketCurvePoint[],
  config: PerformanceGroupConfig
): number {
  let optimalBid = marketCurve[0].bidLevel;
  
  switch (config.optimizationGoal) {
    case "maximize_sales":
      // Find bid where marginal profit is still positive
      for (const point of marketCurve) {
        if (point.marginalRevenue >= point.marginalCost) {
          optimalBid = point.bidLevel;
        } else {
          break;
        }
      }
      break;
      
    case "target_acos":
      // Find bid that achieves target ACoS
      if (config.targetAcos) {
        for (const point of marketCurve) {
          const acos = point.estimatedSpend > 0 
            ? (point.estimatedSpend / point.estimatedSales) * 100 
            : 0;
          if (acos <= config.targetAcos) {
            optimalBid = point.bidLevel;
          }
        }
      }
      break;
      
    case "target_roas":
      // Find bid that achieves target ROAS
      if (config.targetRoas) {
        for (const point of marketCurve) {
          const roas = point.estimatedSpend > 0 
            ? point.estimatedSales / point.estimatedSpend 
            : 0;
          if (roas >= config.targetRoas) {
            optimalBid = point.bidLevel;
          }
        }
      }
      break;
      
    case "daily_spend_limit":
      // Find highest bid within spend limit
      if (config.dailySpendLimit) {
        for (const point of marketCurve) {
          if (point.estimatedSpend <= config.dailySpendLimit) {
            optimalBid = point.bidLevel;
          }
        }
      }
      break;
      
    case "daily_cost":
      // Optimize for specific daily cost target
      if (config.dailyCostTarget) {
        let minDiff = Infinity;
        for (const point of marketCurve) {
          const diff = Math.abs(point.estimatedSpend - config.dailyCostTarget);
          if (diff < minDiff) {
            minDiff = diff;
            optimalBid = point.bidLevel;
          }
        }
      }
      break;
  }
  
  return optimalBid;
}

/**
 * 数据充足性检查阈值（默认值）
 * v122g: 升级为策略感知的动态阈值
 */
const DATA_SUFFICIENCY_THRESHOLDS = {
  minClicks: 15,
  minOrders: 3,
};

/**
 * 策略感知的数据充足性阈值映射
 * v122g: 不同优化策略对数据充足性有不同的容忍度
 * - 激进策略（aggressive-growth, seasonal-boost, market-expansion）：更早进入利用阶段
 * - 保守策略（profit-focused, brand-defense, decline-management）：需要更多数据确认
 * - 平衡策略（balanced）：使用默认阈值
 * - 探索策略（inventory-clearance, competitor-attack）：中等阈值
 */
const STRATEGY_DATA_THRESHOLDS: Record<string, { minClicks: number; minOrders: number }> = {
  'aggressive-growth': { minClicks: 8, minOrders: 1 },
  'seasonal-boost': { minClicks: 8, minOrders: 1 },
  'market-expansion': { minClicks: 8, minOrders: 1 },
  'balanced': { minClicks: 15, minOrders: 3 },
  'maximize_sales': { minClicks: 12, minOrders: 2 },
  'target_acos': { minClicks: 15, minOrders: 3 },
  'target_roas': { minClicks: 15, minOrders: 3 },
  'profit-focused': { minClicks: 20, minOrders: 5 },
  'brand-defense': { minClicks: 20, minOrders: 5 },
  'decline-management': { minClicks: 20, minOrders: 5 },
  'inventory-clearance': { minClicks: 10, minOrders: 1 },
  'competitor-attack': { minClicks: 10, minOrders: 2 },
  'emergency-response': { minClicks: 10, minOrders: 2 },
  'seasonal-pattern': { minClicks: 12, minOrders: 2 },
};

/**
 * 贝叶斯平滑信心参数
 * 越大表示越信任先验数据（广告组平均值）
 */
const BAYESIAN_CONFIDENCE = 1;

/**
 * 计算贝叶斯平滑后的转化率
 * 公式：smoothedCvr = (orders + confidence * priorCvr) / (clicks + confidence)
 * 
 * @param orders - 当前订单数
 * @param clicks - 当前点击数
 * @param priorCvr - 先验转化率（广告组/Campaign平均值）
 * @param confidence - 信心参数，默认1
 */
export function calculateBayesianSmoothedCvr(
  orders: number,
  clicks: number,
  priorCvr: number,
  confidence: number = BAYESIAN_CONFIDENCE
): number {
  return (orders + confidence * priorCvr) / (clicks + confidence);
}

/**
 * 检查数据是否充足，决定使用市场曲线模型还是贝叶斯平滑策略
 * v122g: 升级为策略感知版本，不同策略有不同的数据充足性阈值
 */
export function isDataSufficient(target: OptimizationTarget, config?: PerformanceGroupConfig): boolean {
  const strategyKey = config?.optimizationGoal || 'balanced';
  const thresholds = STRATEGY_DATA_THRESHOLDS[strategyKey] || DATA_SUFFICIENCY_THRESHOLDS;
  return target.clicks >= thresholds.minClicks && 
         target.orders >= thresholds.minOrders;
}

/**
 * 数据稀疏场景的保守竞价策略（贝叶斯平滑）
 * 专家建议：当数据不足时，不要拟合曲线，使用基于规则的保守策略
 * 
 * @param target - 优化目标
 * @param config - 绩效组配置
 * @param maxBidLimit - 最高出价限制
 * @param minBidLimit - 最低出价限制
 */
function calculateSparseDataBidAdjustment(
  target: OptimizationTarget,
  config: PerformanceGroupConfig,
  maxBidLimit: number = 10.00,
  minBidLimit: number = 0.02
): OptimizationResult {
  let newBid = target.currentBid;
  let reason = "";

  // 获取广告组或Campaign的平均CVR作为先验数据 (Bayesian Prior)
  const groupAvgCvr = config.groupAvgCvr || 0.05; // 默认5%转化率
  const groupAvgAov = config.groupAvgAov || 30; // 默认平均订单价值$30
  
  // 贝叶斯平均转化率 = (当前转化 + 信心参数*平均转化) / (当前点击 + 信心参数)
  const smoothedCvr = calculateBayesianSmoothedCvr(
    target.orders,
    target.clicks,
    groupAvgCvr
  );
  
  // 计算目标CPA
  let targetCpa: number;
  if (config.targetAcos && target.orders > 0) {
    // 基于目标ACoS计算目标CPA
    const avgOrderValue = target.sales / target.orders;
    targetCpa = config.targetAcos / 100 * avgOrderValue;
  } else if (config.targetRoas) {
    // 基于目标ROAS计算目标CPA
    targetCpa = groupAvgAov / config.targetRoas;
  } else {
    // 默认目标CPA：平均订单价值的30%
    targetCpa = groupAvgAov * 0.3;
  }
  
  // 基于平滑后的CVR计算理论出价
  // 理论出价 = 平滑CVR * 目标CPA
  const theoreticalBid = smoothedCvr * targetCpa;

  // v122g: 根据策略类型动态调整稀疏数据场景的最大变化幅度
  // 激进策略允许更大幅度调整，保守策略限制调整幅度
  let MAX_SPARSE_CHANGE_PERCENT = 0.20;
  const goal = config.optimizationGoal || 'balanced';
  if (['aggressive-growth', 'seasonal-boost', 'market-expansion', 'inventory-clearance'].includes(goal)) {
    MAX_SPARSE_CHANGE_PERCENT = 0.30; // 激进策略允许±30%
  } else if (['profit-focused', 'brand-defense', 'decline-management'].includes(goal)) {
    MAX_SPARSE_CHANGE_PERCENT = 0.12; // 保守策略限制±12%
  }
  
  if (theoreticalBid > target.currentBid) {
    newBid = Math.min(theoreticalBid, target.currentBid * (1 + MAX_SPARSE_CHANGE_PERCENT));
    reason = `[数据培育] 点击${target.clicks}/订单${target.orders}，贝叶斯平滑CVR(${(smoothedCvr * 100).toFixed(1)}%)，小幅提价获取更多数据`;
  } else if (target.clicks < 5 && target.orders === 0) {
    // v122g: 点击极少且无转化时，不急于降价，保持当前出价继续观察
    newBid = target.currentBid;
    reason = `[数据培育] 点击${target.clicks}/订单${target.orders}，数据不足以判断趋势，保持当前出价继续观察`;
  } else {
    newBid = Math.max(theoreticalBid, target.currentBid * (1 - MAX_SPARSE_CHANGE_PERCENT));
    reason = `[数据培育] 点击${target.clicks}/订单${target.orders}，表现不及预期，保守微调出价`;
  }

  // 应用出价限制
  newBid = Math.min(newBid, maxBidLimit);
  newBid = Math.max(newBid, minBidLimit);
  newBid = Math.round(newBid * 100) / 100;

  // 确定操作类型
  let actionType: "increase" | "decrease" | "set" = "set";
  if (newBid > target.currentBid) {
    actionType = "increase";
  } else if (newBid < target.currentBid) {
    actionType = "decrease";
  }

  const bidChangePercent = ((newBid - target.currentBid) / target.currentBid) * 100;

  return {
    targetId: target.id,
    targetType: target.type,
    previousBid: target.currentBid,
    newBid,
    actionType,
    bidChangePercent: Math.round(bidChangePercent * 100) / 100,
    reason,
  };
}

/**
 * Calculate bid adjustment based on performance
 * 
 * 专家建议优化：
 * - 数据充足时（clicks>=15, orders>=3）：使用市场曲线模型
 * - 数据稀疏时：使用贝叶斯平滑的保守策略
 */
export function calculateBidAdjustment(
  target: OptimizationTarget,
  config: PerformanceGroupConfig,
  maxBidLimit: number = 10.00,
  minBidLimit: number = 0.02
): OptimizationResult {
  // v122g: 策略感知的数据充足性检查
  if (!isDataSufficient(target, config)) {
    // 数据稀疏时，使用贝叶斯平滑的保守策略
    return calculateSparseDataBidAdjustment(target, config, maxBidLimit, minBidLimit);
  }

  // === ASP变动感知：动态调整ACoS目标 ===
  const aspSensitivity = calculateASPSensitivity(target.currentASP, target.historicalASP);
  const adjustedConfig = { ...config };
  if (aspSensitivity.acosAdjustmentMultiplier !== 1 && adjustedConfig.targetAcos) {
    adjustedConfig.targetAcos = adjustedConfig.targetAcos * aspSensitivity.acosAdjustmentMultiplier;
  }
  if (aspSensitivity.acosAdjustmentMultiplier !== 1 && adjustedConfig.targetRoas) {
    // ROAS目标与ACoS目标反向调整
    adjustedConfig.targetRoas = adjustedConfig.targetRoas / aspSensitivity.acosAdjustmentMultiplier;
  }

  // 数据充足时，使用原有的市场曲线模型（使用ASP调整后的配置）
  const metrics = calculateMetrics(target);
  const marketCurve = generateMarketCurve(target);
  const optimalBid = findOptimalBid(marketCurve, adjustedConfig);
  
  // Calculate new bid with constraints
  let newBid = optimalBid;
  
  // Apply bid limits
  newBid = Math.min(newBid, maxBidLimit);
  newBid = Math.max(newBid, minBidLimit);
  
  // Limit bid change to 25% per adjustment to avoid drastic changes
  const maxChangePercent = 0.25;
  const maxIncrease = target.currentBid * (1 + maxChangePercent);
  const maxDecrease = target.currentBid * (1 - maxChangePercent);
  
  newBid = Math.min(newBid, maxIncrease);
  newBid = Math.max(newBid, maxDecrease);
  
  // Round to 2 decimal places
  newBid = Math.round(newBid * 100) / 100;
  
  // Determine action type
  let actionType: "increase" | "decrease" | "set" = "set";
  if (newBid > target.currentBid) {
    actionType = "increase";
  } else if (newBid < target.currentBid) {
    actionType = "decrease";
  }
  
  // Calculate change percentage
  const bidChangePercent = ((newBid - target.currentBid) / target.currentBid) * 100;
  
  // Generate reason (包含ASP变动信息)
  let reason = generateOptimizationReason(target, metrics, adjustedConfig, newBid);
  if (aspSensitivity.priceAction !== 'stable') {
    reason = `[${aspSensitivity.reason}] ${reason}`;
  }
  
  return {
    targetId: target.id,
    targetType: target.type,
    previousBid: target.currentBid,
    newBid,
    actionType,
    bidChangePercent: Math.round(bidChangePercent * 100) / 100,
    reason,
  };
}

/**
 * Generate human-readable optimization reason
 */
function generateOptimizationReason(
  target: OptimizationTarget,
  metrics: ReturnType<typeof calculateMetrics>,
  config: PerformanceGroupConfig,
  newBid: number
): string {
  const reasons: string[] = [];
  
  // Performance-based reasons
  if (metrics.acos > 0) {
    if (config.optimizationGoal === "target_acos" && config.targetAcos) {
      if (metrics.acos > config.targetAcos) {
        reasons.push(`当前ACoS (${metrics.acos.toFixed(1)}%) 高于目标 (${config.targetAcos}%)`);
      } else {
        reasons.push(`当前ACoS (${metrics.acos.toFixed(1)}%) 低于目标，可提高出价获取更多流量`);
      }
    }
  }
  
  if (metrics.roas > 0) {
    if (config.optimizationGoal === "target_roas" && config.targetRoas) {
      if (metrics.roas < config.targetRoas) {
        reasons.push(`当前ROAS (${metrics.roas.toFixed(2)}) 低于目标 (${config.targetRoas})`);
      } else {
        reasons.push(`当前ROAS (${metrics.roas.toFixed(2)}) 达到目标，优化出价以最大化效益`);
      }
    }
  }
  
  // Conversion-based reasons
  if (metrics.cvr > 5) {
    reasons.push(`高转化率 (${metrics.cvr.toFixed(1)}%) 支持提高出价`);
  } else if (metrics.cvr < 1 && target.clicks > 50) {
    reasons.push(`低转化率 (${metrics.cvr.toFixed(1)}%) 建议降低出价`);
  }
  
  // Traffic-based reasons
  if (target.impressions < 100 && newBid > target.currentBid) {
    reasons.push("曝光量较低，提高出价以获取更多流量");
  }
  
  // Default reason
  if (reasons.length === 0) {
    if (newBid > target.currentBid) {
      reasons.push("基于市场曲线分析，提高出价可增加边际收益");
    } else if (newBid < target.currentBid) {
      reasons.push("基于市场曲线分析，降低出价可优化投入产出比");
    } else {
      reasons.push("当前出价处于最优区间");
    }
  }
  
  return reasons.join("；");
}

/**
 * 零曝光探测配置
 * v122g: 扩展为支持探索模式的全面配置
 */
const ZERO_IMPRESSION_PROBING_CONFIG = {
  newCampaignDays: 7,           // Campaign创建7天内视为新品
  probingBidIncrementPercent: 0.10, // 每次探测提价百分比
  probingBidIncrementFixed: 0.05,   // 每次探测提价固定金额($)
  probingImpressionThreshold: 500,  // 曝光达到500后退出探测模式
  oosHistoricalAvgThreshold: 1000,  // 历史日均曝光>1000且昨日曝光=0，判定为疑似断货
  // v122g: 探索模式配置
  explorationMaxBidPercent: 0.15,   // 探索模式最大提价百分比
  explorationMinImpressions: 200,   // 探索模式最低曝光要求
};

/**
 * v122g: 探索模式出价计算
 * 针对低数据量广告活动（非新品）的智能探索策略
 * 
 * 核心理念：
 * - 不是粗暴地降低出价，而是耐心地培育数据
 * - 对于有少量曝光但无点击的：小幅提价获取更好位置
 * - 对于有点击但无转化的：使用贝叶斯平滑保守调整
 * - 对于有少量转化的：基于平滑CVR和目标CPA计算探索性出价
 */
function calculateExplorationBid(
  target: OptimizationTarget,
  config: PerformanceGroupConfig,
  maxBidLimit: number = 10.00,
  minBidLimit: number = 0.02
): OptimizationResult {
  let newBid = target.currentBid;
  let reason = '';
  
  const groupAvgCvr = config.groupAvgCvr || 0.05;
  const groupAvgAov = config.groupAvgAov || 30;
  const groupAvgCpc = config.groupAvgCpc || target.currentBid;
  
  // 场景1：零曝光或极低曝光（<50）—— 探测性提价
  if (target.impressions < 50) {
    const increment = Math.max(
      target.currentBid * 0.08,  // 8%提价
      0.03                       // 最少$0.03
    );
    newBid = target.currentBid + increment;
    reason = `[探索模式] 曝光量仅${target.impressions}，探测性提价+$${increment.toFixed(2)}寻找合理价位`;
  }
  // 场景2：有曝光但无点击（曝光>=50，点击=0）—— 可能是位置不够好，小幅提价
  else if (target.clicks === 0) {
    const increment = Math.max(
      target.currentBid * 0.05,  // 5%提价
      0.02
    );
    newBid = target.currentBid + increment;
    reason = `[探索模式] 曝光${target.impressions}但零点击，小幅提价+$${increment.toFixed(2)}改善广告位置`;
  }
  // 场景3：有点击但无转化（点击>0，订单=0）—— 保持当前出价继续观察
  else if (target.orders === 0) {
    // 如果点击费用远高于组平均CPC，微降
    const currentCpc = target.clicks > 0 ? target.spend / target.clicks : target.currentBid;
    if (currentCpc > groupAvgCpc * 1.5) {
      // CPC远高于组平均，微降到组平均水平
      newBid = Math.max(target.currentBid * 0.92, groupAvgCpc);
      reason = `[探索模式] 点击${target.clicks}无转化，CPC($${currentCpc.toFixed(2)})高于组平均($${groupAvgCpc.toFixed(2)})，微调降低成本`;
    } else {
      // CPC合理，保持当前出价继续积累数据
      newBid = target.currentBid;
      reason = `[探索模式] 点击${target.clicks}无转化，CPC在合理范围，保持当前出价继续积累数据`;
    }
  }
  // 场景4：有少量转化（订单>0）—— 使用贝叶斯平滑计算探索性出价
  else {
    const smoothedCvr = calculateBayesianSmoothedCvr(target.orders, target.clicks, groupAvgCvr);
    let targetCpa: number;
    if (config.targetAcos && target.orders > 0) {
      const avgOrderValue = target.sales / target.orders;
      targetCpa = (config.targetAcos / 100) * avgOrderValue;
    } else if (config.targetRoas) {
      targetCpa = groupAvgAov / config.targetRoas;
    } else {
      targetCpa = groupAvgAov * 0.3;
    }
    const theoreticalBid = smoothedCvr * targetCpa;
    // 探索模式下限制调整幅度为±15%
    if (theoreticalBid > target.currentBid) {
      newBid = Math.min(theoreticalBid, target.currentBid * 1.15);
    } else {
      newBid = Math.max(theoreticalBid, target.currentBid * 0.85);
    }
    reason = `[探索模式] 点击${target.clicks}/订单${target.orders}，贝叶斯平滑CVR(${(smoothedCvr * 100).toFixed(1)}%)，基于探索性出价调整`;
  }
  
  // 应用出价限制
  const effectiveMaxBid = config.maxBid || maxBidLimit;
  newBid = Math.min(newBid, effectiveMaxBid);
  newBid = Math.max(newBid, minBidLimit);
  newBid = Math.round(newBid * 100) / 100;
  
  // 确定操作类型
  let actionType: 'increase' | 'decrease' | 'set' = 'set';
  if (newBid > target.currentBid) actionType = 'increase';
  else if (newBid < target.currentBid) actionType = 'decrease';
  
  const bidChangePercent = target.currentBid > 0 ? ((newBid - target.currentBid) / target.currentBid) * 100 : 0;
  
  return {
    targetId: target.id,
    targetType: target.type,
    previousBid: target.currentBid,
    newBid,
    actionType,
    bidChangePercent: Math.round(bidChangePercent * 100) / 100,
    reason,
  };
}

/**
 * 检测是否为疑似断货/揉购物车丢失
 * 专家建议：历史日均曝光>1000且昨日曝光=0 → 疑似断货
 */
function detectSuspectedOOS(target: OptimizationTarget): boolean {
  if (target.historicalAvgImpressions !== undefined && 
      target.historicalAvgImpressions > ZERO_IMPRESSION_PROBING_CONFIG.oosHistoricalAvgThreshold &&
      target.impressions === 0) {
    return true;
  }
  return false;
}

/**
 * 检测是否为新品/新广告活动（冷启动阶段）
 */
function isNewCampaign(target: OptimizationTarget): boolean {
  if (!target.campaignStartDate) return false;
  const daysSinceStart = (Date.now() - target.campaignStartDate.getTime()) / (1000 * 60 * 60 * 24);
  return daysSinceStart <= ZERO_IMPRESSION_PROBING_CONFIG.newCampaignDays;
}

/**
 * 零曝光探测策略
 * 专家建议：对新品的零曝光关键词执行探测性提价，打破“零曝光→跳过→零曝光”的死循环
 */
function calculateZeroImpressionProbing(
  target: OptimizationTarget,
  config: PerformanceGroupConfig,
  maxBidLimit: number
): OptimizationResult {
  const { probingBidIncrementPercent, probingBidIncrementFixed, probingImpressionThreshold } = ZERO_IMPRESSION_PROBING_CONFIG;
  
  // 使用百分比和固定金额中的较大值作为提价幅度
  const percentIncrease = target.currentBid * probingBidIncrementPercent;
  const bidIncrement = Math.max(percentIncrease, probingBidIncrementFixed);
  let newBid = target.currentBid + bidIncrement;
  
  // 应用最高出价限制
  const effectiveMaxBid = config.maxBid || maxBidLimit;
  newBid = Math.min(newBid, effectiveMaxBid);
  newBid = Math.round(newBid * 100) / 100;
  
  const bidChangePercent = ((newBid - target.currentBid) / target.currentBid) * 100;
  
  let reason = '';
  if (target.impressions === 0) {
    reason = `冷启动探测：零曝光，探测性提价+$${bidIncrement.toFixed(2)}寻找入场价位`;
  } else {
    reason = `冷启动探测：低曝光(${target.impressions})，探测性提价+$${bidIncrement.toFixed(2)}获取更多流量`;
  }
  
  return {
    targetId: target.id,
    targetType: target.type,
    previousBid: target.currentBid,
    newBid,
    actionType: 'increase',
    bidChangePercent: Math.round(bidChangePercent * 100) / 100,
    reason,
  };
}

/**
 * Batch optimize all targets in a performance group
 * 
 * 专家建议改进：
 * - 移除“clicks<5 && impressions<100 → skip”的死锁逻辑
 * - 新增零曝光探测机制，解决新品冷启动问题
 * - 新增疑似断货检测，防止算法在异常情况下乱动
 */
export function optimizePerformanceGroup(
  targets: OptimizationTarget[],
  config: PerformanceGroupConfig,
  maxBidLimit: number = 10.00
): OptimizationResult[] {
  const results: OptimizationResult[] = [];
  
  for (const target of targets) {
    // === 第1层：疑似断货检测（优先级最高） ===
    if (detectSuspectedOOS(target)) {
      // 强制保持当前出价，不做任何调整，防止浪费预算
      results.push({
        targetId: target.id,
        targetType: target.type,
        previousBid: target.currentBid,
        newBid: target.currentBid,
        actionType: 'set',
        bidChangePercent: 0,
        reason: `疑似断货/揉购物车丢失：历史日均曝光${target.historicalAvgImpressions}但当前曝光为0，强制暂停优化保持当前出价`,
      });
      continue;
    }
    
    // === 第2层：零曝光/冷启动探测 ===
    if (target.impressions === 0 && isNewCampaign(target)) {
      // 新品零曝光：执行探测性提价，打破死循环
      const probingResult = calculateZeroImpressionProbing(target, config, maxBidLimit);
      results.push(probingResult);
      continue;
    }
    
    // === 第3层：低数据量探索模式（v122g新增） ===
    // 不再跳过低数据量活动，而是进入探索模式进行智能培育
    if (!isDataSufficient(target, config)) {
      const explorationResult = calculateExplorationBid(target, config, maxBidLimit);
      // 探索模式下，即使变化很小也要记录（包括“保持不变”的决策）
      results.push(explorationResult);
      continue;
    }
    
    // === 第4层：数据充足的正常优化流程 ===
    const result = calculateBidAdjustment(target, config, maxBidLimit);
    
    // Only include if there's a meaningful change (> 1%)
    if (Math.abs(result.bidChangePercent) > 1) {
      results.push(result);
    }
  }
  
  return results;
}

/**
 * Calculate placement bid adjustments
 */
export function calculatePlacementAdjustments(
  placementPerformance: {
    placement: "top_search" | "product_page" | "rest";
    impressions: number;
    clicks: number;
    spend: number;
    sales: number;
  }[],
  targetAcos?: number
): { topSearch: number; productPage: number; rest: number } {
  const adjustments = { topSearch: 0, productPage: 0, rest: 0 };
  
  for (const placement of placementPerformance) {
    const acos = placement.sales > 0 ? (placement.spend / placement.sales) * 100 : 0;
    const roas = placement.spend > 0 ? placement.sales / placement.spend : 0;
    
    let adjustment = 0;
    
    if (targetAcos) {
      // If ACoS is below target, increase bid for this placement
      if (acos < targetAcos && acos > 0) {
        adjustment = Math.min(50, Math.round((targetAcos - acos) / targetAcos * 100));
      } else if (acos > targetAcos) {
        adjustment = Math.max(-50, Math.round((targetAcos - acos) / acos * 100));
      }
    } else {
      // Default: adjust based on ROAS
      if (roas > 3) {
        adjustment = Math.min(50, Math.round((roas - 3) * 10));
      } else if (roas < 1 && roas > 0) {
        adjustment = Math.max(-50, Math.round((roas - 1) * 50));
      }
    }
    
    switch (placement.placement) {
      case "top_search":
        adjustments.topSearch = adjustment;
        break;
      case "product_page":
        adjustments.productPage = adjustment;
        break;
      case "rest":
        adjustments.rest = adjustment;
        break;
    }
  }
  
  return adjustments;
}

/**
 * Intraday bidding adjustment
 * Adjusts bids based on time-of-day performance patterns
 */
export function calculateIntradayAdjustment(
  hourlyPerformance: {
    hour: number;
    impressions: number;
    clicks: number;
    spend: number;
    sales: number;
  }[],
  currentHour: number
): number {
  // Find average performance
  const totalSales = hourlyPerformance.reduce((s, h) => s + h.sales, 0);
  const avgHourlySales = totalSales / hourlyPerformance.length;
  
  // Find current hour's performance
  const currentHourData = hourlyPerformance.find(h => h.hour === currentHour);
  if (!currentHourData) return 0;
  
  // Calculate adjustment based on performance relative to average
  const performanceRatio = avgHourlySales > 0 
    ? currentHourData.sales / avgHourlySales 
    : 1;
  
  // Adjust bid by up to ±30% based on hourly performance
  let adjustment = (performanceRatio - 1) * 30;
  adjustment = Math.max(-30, Math.min(30, adjustment));
  
  return Math.round(adjustment);
}

/**
 * 获取出价调整原因
 */
export function getAdjustmentReason(
  keyword: any,
  config: PerformanceGroupConfig
): string {
  const acos = keyword.acos ? parseFloat(keyword.acos) : 0;
  const roas = keyword.roas ? parseFloat(keyword.roas) : 0;
  const impressions = keyword.impressions || 0;
  const clicks = keyword.clicks || 0;
  const orders = keyword.orders || 0;
  
  if (config.targetAcos && acos > 0) {
    if (acos > config.targetAcos * 1.2) {
      return `ACoS (${acos.toFixed(1)}%) 高于目标 (${config.targetAcos}%)，降低出价`;
    } else if (acos < config.targetAcos * 0.8) {
      return `ACoS (${acos.toFixed(1)}%) 低于目标 (${config.targetAcos}%)，提高出价获取更多流量`;
    }
  }
  
  if (config.targetRoas && roas > 0) {
    if (roas < config.targetRoas * 0.8) {
      return `ROAS (${roas.toFixed(2)}) 低于目标 (${config.targetRoas})，降低出价`;
    } else if (roas > config.targetRoas * 1.2) {
      return `ROAS (${roas.toFixed(2)}) 高于目标 (${config.targetRoas})，提高出价获取更多流量`;
    }
  }
  
  if (impressions > 1000 && clicks === 0) {
    return `高曝光零点击，降低出价`;
  }
  
  if (clicks > 50 && orders === 0) {
    return `高点击零转化，降低出价`;
  }
  
  return `基于历史表现优化出价`;
}

// ==================== 专家建议新增：ASP变动感知与价格敏感度 ====================

/**
 * ASP变动感知配置
 */
export const ASP_SENSITIVITY_CONFIG = {
  significantDropPercent: 0.10,   // ASP下降>10%视为显著降价（秒杀/促销）
  significantRisePercent: 0.10,   // ASP上升>10%视为显著涨价
  acosRelaxMultiplier: 1.3,       // 降价期间ACoS目标放宽30%
  acosStricterMultiplier: 0.85,   // 涨价期间ACoS目标收紧15%
};

/**
 * ASP变动感知结果
 */
export interface ASPSensitivityResult {
  aspChangePercent: number;        // ASP变动百分比
  priceAction: 'price_drop' | 'price_rise' | 'stable'; // 价格动作
  acosAdjustmentMultiplier: number; // ACoS目标调整乘数
  reason: string;
}

/**
 * 计算ASP变动感知
 * 专家建议：通过Ads API的销量和曝光数据反推业务状态
 * - ASP下降>10%：说明在做秒杀或降价，CVR通常会飙升，临时放宽 ACoS 目标
 * - ASP上升>10%：说明涨价了，CVR可能下降，收紧ACoS目标
 */
export function calculateASPSensitivity(
  currentASP: number | undefined,
  historicalASP: number | undefined
): ASPSensitivityResult {
  // 没有ASP数据，返回稳定
  if (!currentASP || !historicalASP || historicalASP === 0) {
    return {
      aspChangePercent: 0,
      priceAction: 'stable',
      acosAdjustmentMultiplier: 1,
      reason: '无ASP数据，保持标准ACoS目标',
    };
  }
  
  const aspChangePercent = (currentASP - historicalASP) / historicalASP;
  
  // 降价检测：ASP下降>10%
  if (aspChangePercent < -ASP_SENSITIVITY_CONFIG.significantDropPercent) {
    return {
      aspChangePercent: Math.round(aspChangePercent * 100) / 100,
      priceAction: 'price_drop',
      acosAdjustmentMultiplier: ASP_SENSITIVITY_CONFIG.acosRelaxMultiplier,
      reason: `检测到降价/秒杀：ASP从$${historicalASP.toFixed(2)}降至$${currentASP.toFixed(2)}(${(aspChangePercent * 100).toFixed(1)}%)，临时放宽 ACoS目标${Math.round((ASP_SENSITIVITY_CONFIG.acosRelaxMultiplier - 1) * 100)}%抓住流量红利`,
    };
  }
  
  // 涨价检测：ASP上升>10%
  if (aspChangePercent > ASP_SENSITIVITY_CONFIG.significantRisePercent) {
    return {
      aspChangePercent: Math.round(aspChangePercent * 100) / 100,
      priceAction: 'price_rise',
      acosAdjustmentMultiplier: ASP_SENSITIVITY_CONFIG.acosStricterMultiplier,
      reason: `检测到涨价：ASP从$${historicalASP.toFixed(2)}升至$${currentASP.toFixed(2)}(+${(aspChangePercent * 100).toFixed(1)}%)，收紧ACoS目标${Math.round((1 - ASP_SENSITIVITY_CONFIG.acosStricterMultiplier) * 100)}%保护利润`,
    };
  }
  
  // 价格稳定
  return {
    aspChangePercent: Math.round(aspChangePercent * 100) / 100,
    priceAction: 'stable',
    acosAdjustmentMultiplier: 1,
    reason: `ASP稳定($${currentASP.toFixed(2)}，变动${(aspChangePercent * 100).toFixed(1)}%)，保持标准ACoS目标`,
  };
}

// ==================== 专家建议新增：库存与业务感知 ====================

/**
 * 库存保护配置
 */
export const INVENTORY_PROTECTION_CONFIG = {
  // 库存水平阈值（天数）
  lowInventoryThreshold: 7,      // 低库存阈值
  criticalInventoryThreshold: 3, // 危急库存阈值
  
  // 出价调整倍数
  lowInventoryBidMultiplier: 0.7,      // 低库存时出价倍数
  criticalInventoryBidMultiplier: 0.5, // 危急库存时出价倍数（强制降价50%）
  outOfStockBidMultiplier: 0,          // 缺货时暂停广告
  
  // 自然排名策略
  organicRankThreshold: 10,            // 自然排名前10名可以降低广告投入
  organicRankBidReduction: 0.3,        // 自然排名好时出价降低30%
};

/**
 * 库存保护结果
 */
export interface InventoryProtectionResult {
  originalBid: number;
  adjustedBid: number;
  bidMultiplier: number;
  inventoryLevel: string;
  inventoryDays?: number;
  action: 'normal' | 'reduce' | 'pause';
  reason: string;
}

/**
 * 计算库存保护调整
 * 专家建议：库存告急时强制降价50%延长售卖时间
 * 
 * @param currentBid - 当前出价
 * @param inventoryLevel - 库存水平
 * @param inventoryDays - 剩余库存天数
 */
export function calculateInventoryProtection(
  currentBid: number,
  inventoryLevel: OptimizationTarget['inventoryLevel'],
  inventoryDays?: number
): InventoryProtectionResult {
  const {
    lowInventoryThreshold,
    criticalInventoryThreshold,
    lowInventoryBidMultiplier,
    criticalInventoryBidMultiplier,
    outOfStockBidMultiplier,
  } = INVENTORY_PROTECTION_CONFIG;
  
  // 缺货时暂停广告
  if (inventoryLevel === 'out_of_stock') {
    return {
      originalBid: currentBid,
      adjustedBid: 0,
      bidMultiplier: outOfStockBidMultiplier,
      inventoryLevel: 'out_of_stock',
      inventoryDays,
      action: 'pause',
      reason: '库存已缺货，暂停广告投放避免浪费广告费',
    };
  }
  
  // 危急库存（小于3天）
  if (inventoryLevel === 'critical' || (inventoryDays !== undefined && inventoryDays <= criticalInventoryThreshold)) {
    const adjustedBid = Math.round(currentBid * criticalInventoryBidMultiplier * 100) / 100;
    return {
      originalBid: currentBid,
      adjustedBid,
      bidMultiplier: criticalInventoryBidMultiplier,
      inventoryLevel: 'critical',
      inventoryDays,
      action: 'reduce',
      reason: `库存危急（剩余${inventoryDays || '<3'}天），强制降价50%延长售卖时间`,
    };
  }
  
  // 低库存（小于7天）
  if (inventoryLevel === 'low' || (inventoryDays !== undefined && inventoryDays <= lowInventoryThreshold)) {
    const adjustedBid = Math.round(currentBid * lowInventoryBidMultiplier * 100) / 100;
    return {
      originalBid: currentBid,
      adjustedBid,
      bidMultiplier: lowInventoryBidMultiplier,
      inventoryLevel: 'low',
      inventoryDays,
      action: 'reduce',
      reason: `库存偏低（剩余${inventoryDays || '<7'}天），降低出价30%控制销售速度`,
    };
  }
  
  // 库存正常
  return {
    originalBid: currentBid,
    adjustedBid: currentBid,
    bidMultiplier: 1,
    inventoryLevel: 'normal',
    inventoryDays,
    action: 'normal',
    reason: '库存正常，无需库存保护调整',
  };
}

/**
 * 自然排名策略结果
 */
export interface OrganicRankStrategyResult {
  originalBid: number;
  adjustedBid: number;
  bidReduction: number;
  organicRank: number;
  shouldReduceBid: boolean;
  reason: string;
}

/**
 * 计算自然排名策略调整
 * 专家建议：自然排名前10名时降低广告投入，避免重复购买已有流量
 * 
 * @param currentBid - 当前出价
 * @param organicRank - 自然排名
 */
export function calculateOrganicRankStrategy(
  currentBid: number,
  organicRank?: number
): OrganicRankStrategyResult {
  const { organicRankThreshold, organicRankBidReduction } = INVENTORY_PROTECTION_CONFIG;
  
  // 没有自然排名数据
  if (organicRank === undefined || organicRank <= 0) {
    return {
      originalBid: currentBid,
      adjustedBid: currentBid,
      bidReduction: 0,
      organicRank: 0,
      shouldReduceBid: false,
      reason: '无自然排名数据，保持当前出价',
    };
  }
  
  // 自然排名在前10名
  if (organicRank <= organicRankThreshold) {
    const bidReduction = organicRankBidReduction;
    const adjustedBid = Math.round(currentBid * (1 - bidReduction) * 100) / 100;
    return {
      originalBid: currentBid,
      adjustedBid,
      bidReduction,
      organicRank,
      shouldReduceBid: true,
      reason: `自然排名第${organicRank}名（前${organicRankThreshold}名），降低广告出价${Math.round(bidReduction * 100)}%避免重复购买已有流量`,
    };
  }
  
  // 自然排名较差
  return {
    originalBid: currentBid,
    adjustedBid: currentBid,
    bidReduction: 0,
    organicRank,
    shouldReduceBid: false,
    reason: `自然排名第${organicRank}名，需要广告补充流量`,
  };
}

/**
 * 综合应用库存和自然排名策略
 * 专家建议：库存保护优先级最高
 * 
 * @param target - 优化目标
 * @param baseBid - 基础出价（经过其他算法计算后的出价）
 */
export function applyBusinessAwareAdjustments(
  target: OptimizationTarget,
  baseBid: number
): {
  finalBid: number;
  inventoryProtection?: InventoryProtectionResult;
  organicRankStrategy?: OrganicRankStrategyResult;
  totalAdjustmentReason: string;
} {
  let finalBid = baseBid;
  const reasons: string[] = [];
  
  // 1. 库存保护（优先级最高）
  let inventoryProtection: InventoryProtectionResult | undefined;
  if (target.inventoryLevel || target.inventoryDays !== undefined || target.isStockout) {
    const level = target.isStockout ? 'out_of_stock' : target.inventoryLevel;
    inventoryProtection = calculateInventoryProtection(finalBid, level, target.inventoryDays);
    
    if (inventoryProtection.action !== 'normal') {
      finalBid = inventoryProtection.adjustedBid;
      reasons.push(inventoryProtection.reason);
    }
  }
  
  // 2. 自然排名策略（仅当库存正常时应用）
  let organicRankStrategy: OrganicRankStrategyResult | undefined;
  if (target.organicRank !== undefined && 
      (!inventoryProtection || inventoryProtection.action === 'normal')) {
    organicRankStrategy = calculateOrganicRankStrategy(finalBid, target.organicRank);
    
    if (organicRankStrategy.shouldReduceBid) {
      finalBid = organicRankStrategy.adjustedBid;
      reasons.push(organicRankStrategy.reason);
    }
  }
  
  // 确保出价不低于最低限制（除非缺货暂停）
  if (finalBid > 0) {
    finalBid = Math.max(finalBid, 0.02);
  }
  
  return {
    finalBid: Math.round(finalBid * 100) / 100,
    inventoryProtection,
    organicRankStrategy,
    totalAdjustmentReason: reasons.length > 0 
      ? reasons.join('；') 
      : '无业务感知调整',
  };
}


// ==================== 新算法集成 ====================

import {
  calculateTimeWeightedROAS,
  calculateTimeWeightedACoS,
  calculateUCBBidSuggestion,
  getDateAdjustmentMultipliers,
  getHolidayConfig,
  type UCBBidSuggestion,
  type HolidayConfig
} from './algorithmUtils';

/**
 * 增强版优化目标 - 包含历史数据用于时间衰减计算
 */
export interface EnhancedOptimizationTarget extends OptimizationTarget {
  dailyData?: Array<{ date: Date; spend: number; sales: number; clicks: number; orders: number }>;
  marketplace?: string;
  campaignId?: number;
  adGroupId?: number;
}

/**
 * 增强版优化结果 - 包含算法类型和详细信息
 */
export interface EnhancedOptimizationResult extends OptimizationResult {
  algorithmUsed: 'time_decay' | 'ucb' | 'holiday' | 'bayesian' | 'market_curve' | 'combined';
  timeDecayROAS?: number;
  ucbSuggestion?: UCBBidSuggestion;
  holidayConfig?: HolidayConfig | null;
  holidayMultiplier?: number;
  confidenceScore: number;
}

/**
 * 算法效果追踪记录
 */
export interface AlgorithmEffectRecord {
  targetId: number;
  targetType: 'keyword' | 'product_target';
  algorithmUsed: string;
  previousBid: number;
  newBid: number;
  previousROAS: number;
  previousACoS: number;
  optimizationDate: Date;
  // 效果追踪字段（优化后7天填充）
  postROAS?: number;
  postACoS?: number;
  roasChange?: number;
  acosChange?: number;
  effectScore?: number;
}

/**
 * 增强版竞价调整 - 集成时间衰减、UCB和节假日调整
 */
export function calculateEnhancedBidAdjustment(
  target: EnhancedOptimizationTarget,
  config: PerformanceGroupConfig,
  maxBidLimit: number = 10.00,
  minBidLimit: number = 0.02,
  currentDate: Date = new Date()
): EnhancedOptimizationResult {
  const metrics = calculateMetrics(target);
  let algorithmUsed: EnhancedOptimizationResult['algorithmUsed'] = 'market_curve';
  let confidenceScore = 0.5;
  let timeDecayROAS: number | undefined;
  let ucbSuggestion: UCBBidSuggestion | undefined;
  let holidayConfig: HolidayConfig | null = null;
  let holidayMultiplier = 1;
  
  // 1. 计算时间衰减加权的ROAS（如果有历史数据）
  if (target.dailyData && target.dailyData.length > 0) {
    timeDecayROAS = calculateTimeWeightedROAS(target.dailyData);
    algorithmUsed = 'time_decay';
    confidenceScore = Math.min(0.9, 0.5 + target.dailyData.length / 30);
  }
  
  // 2. 获取UCB竞价建议（用于探索-利用平衡）
  const targetROAS = config.targetRoas || 3;
  ucbSuggestion = calculateUCBBidSuggestion(
    target.currentBid,
    target.clicks,
    timeDecayROAS || metrics.roas,
    targetROAS
  );
  
  // 如果UCB建议探索，使用UCB算法
  if (ucbSuggestion.strategy === 'explore') {
    algorithmUsed = 'ucb';
    confidenceScore = ucbSuggestion.confidence;
  }
  
  // 3. 检查节假日配置
  const marketplace = target.marketplace || 'US';
  const dateAdjustment = getDateAdjustmentMultipliers(currentDate, marketplace);
  holidayConfig = getHolidayConfig(currentDate, marketplace);
  holidayMultiplier = dateAdjustment.bidMultiplier;
  
  if (holidayMultiplier !== 1) {
    algorithmUsed = 'holiday';
  }
  
  // 4. 计算基础竞价
  let baseBid: number;
  
  if (!isDataSufficient(target, config)) {
    // v122g: 数据稀疏：使用贝叶斯平滑（已升级为策略感知版本）
    const sparseResult = calculateSparseDataBidAdjustment(target, config, maxBidLimit, minBidLimit);
    baseBid = sparseResult.newBid;
    algorithmUsed = 'bayesian';
    confidenceScore = 0.3;
  } else if (ucbSuggestion.strategy === 'explore') {
    // 探索阶段：使用UCB建议
    baseBid = ucbSuggestion.suggestedBid;
  } else if (timeDecayROAS !== undefined) {
    // 有历史数据：基于时间衰减ROAS计算
    const targetAcos = config.targetAcos || 30;
    const currentAcos = timeDecayROAS > 0 ? (1 / timeDecayROAS) * 100 : 100;
    
    if (currentAcos < targetAcos) {
      // ACoS低于目标，可以提高出价
      const adjustmentFactor = Math.min(1.25, 1 + (targetAcos - currentAcos) / targetAcos * 0.5);
      baseBid = target.currentBid * adjustmentFactor;
    } else {
      // ACoS高于目标，需要降低出价
      const adjustmentFactor = Math.max(0.75, targetAcos / currentAcos);
      baseBid = target.currentBid * adjustmentFactor;
    }
  } else {
    // 默认：使用市场曲线模型
    const marketCurve = generateMarketCurve(target);
    baseBid = findOptimalBid(marketCurve, config);
  }
  
  // 5. 应用节假日乘数
  let newBid = baseBid * holidayMultiplier;
  
  // 6. 应用出价限制
  newBid = Math.min(newBid, maxBidLimit);
  newBid = Math.max(newBid, minBidLimit);
  
  // 7. 限制单次调整幅度（v152: 从进化引擎获取自适应参数，默认30%）
  // 进化引擎会根据历史效果自动调整这些参数
  const maxChangePercent = (config as any)._evolvedMaxChangePercent || 0.30;
  const maxIncrease = target.currentBid * (1 + maxChangePercent);
  const maxDecrease = target.currentBid * (1 - ((config as any)._evolvedMaxDecreasePercent || 0.20));
  
  newBid = Math.min(newBid, maxIncrease);
  newBid = Math.max(newBid, maxDecrease);
  
  // 8. 四舍五入
  newBid = Math.round(newBid * 100) / 100;
  
  // 9. 确定操作类型
  let actionType: 'increase' | 'decrease' | 'set' = 'set';
  if (newBid > target.currentBid) {
    actionType = 'increase';
  } else if (newBid < target.currentBid) {
    actionType = 'decrease';
  }
  
  // 10. 计算变化百分比
  const bidChangePercent = ((newBid - target.currentBid) / target.currentBid) * 100;
  
  // 11. 生成原因
  const reasons: string[] = [];
  
  if (timeDecayROAS !== undefined) {
    reasons.push(`时间加权ROAS: ${timeDecayROAS.toFixed(2)}`);
  }
  
  if (ucbSuggestion.strategy === 'explore') {
    reasons.push(`UCB探索策略 (置信度: ${(ucbSuggestion.confidence * 100).toFixed(0)}%)`);
  } else if (ucbSuggestion.strategy === 'exploit') {
    reasons.push(`UCB利用策略 (置信度: ${(ucbSuggestion.confidence * 100).toFixed(0)}%)`);
  }
  
  if (holidayMultiplier !== 1) {
    reasons.push(`${dateAdjustment.reason} (乘数: ${holidayMultiplier})`);
  }
  
  if (reasons.length === 0) {
    reasons.push(generateOptimizationReason(target, metrics, config, newBid));
  }
  
  // 如果使用了多种算法，标记为combined
  const algorithmsUsed = [
    timeDecayROAS !== undefined,
    ucbSuggestion.strategy !== 'exploit',
    holidayMultiplier !== 1
  ].filter(Boolean).length;
  
  if (algorithmsUsed > 1) {
    algorithmUsed = 'combined';
  }
  
  return {
    targetId: target.id,
    targetType: target.type,
    previousBid: target.currentBid,
    newBid,
    actionType,
    bidChangePercent: Math.round(bidChangePercent * 100) / 100,
    reason: reasons.join('；'),
    algorithmUsed,
    timeDecayROAS,
    ucbSuggestion,
    holidayConfig,
    holidayMultiplier,
    confidenceScore: Math.round(confidenceScore * 100) / 100
  };
}

/**
 * 增强版绩效组优化 - 使用新算法
 */
export function optimizePerformanceGroupEnhanced(
  targets: EnhancedOptimizationTarget[],
  config: PerformanceGroupConfig,
  maxBidLimit: number = 10.00,
  currentDate: Date = new Date()
): EnhancedOptimizationResult[] {
  const results: EnhancedOptimizationResult[] = [];
  
  for (const target of targets) {
    // === 第1层：疑似断货检测（优先级最高） ===
    if (detectSuspectedOOS(target)) {
      results.push({
        targetId: target.id,
        targetType: target.type,
        previousBid: target.currentBid,
        newBid: target.currentBid,
        actionType: 'set',
        bidChangePercent: 0,
        reason: `疑似断货/揉购物车丢失：历史日均曝光${target.historicalAvgImpressions}但当前曝光为0，强制暂停优化`,
        algorithmUsed: 'combined',
        confidenceScore: 1.0,
        holidayMultiplier: 1,
      } as EnhancedOptimizationResult);
      continue;
    }
    
    // === 第2层：零曝光/冷启动探测 ===
    if (target.impressions === 0 && isNewCampaign(target)) {
      const probingResult = calculateZeroImpressionProbing(target, config, maxBidLimit);
      results.push({
        ...probingResult,
        algorithmUsed: 'bayesian',
        confidenceScore: 0.2,
        holidayMultiplier: 1,
      } as EnhancedOptimizationResult);
      continue;
    }
    
    // === 第3层：低数据量探索模式（v122g新增） ===
    // 不再跳过低数据量活动，而是进入探索模式进行智能培育
    if (!isDataSufficient(target, config)) {
      const explorationResult = calculateExplorationBid(target, config, maxBidLimit);
      results.push({
        ...explorationResult,
        algorithmUsed: 'bayesian',
        confidenceScore: 0.25,
        holidayMultiplier: 1,
      } as EnhancedOptimizationResult);
      continue;
    }
    
    // === 第4层：数据充足的正常增强版优化流程 ===
    const result = calculateEnhancedBidAdjustment(target, config, maxBidLimit, 0.02, currentDate);
    
    // 只包含有意义的变化（> 1%）
    if (Math.abs(result.bidChangePercent) > 1) {
      results.push(result);
    }
  }
  
  return results;
}

/**
 * 创建算法效果追踪记录
 */
export function createAlgorithmEffectRecord(
  result: EnhancedOptimizationResult,
  currentROAS: number,
  currentACoS: number
): AlgorithmEffectRecord {
  return {
    targetId: result.targetId,
    targetType: result.targetType,
    algorithmUsed: result.algorithmUsed,
    previousBid: result.previousBid,
    newBid: result.newBid,
    previousROAS: currentROAS,
    previousACoS: currentACoS,
    optimizationDate: new Date()
  };
}

/**
 * 更新算法效果追踪记录（优化后7天调用）
 */
export function updateAlgorithmEffectRecord(
  record: AlgorithmEffectRecord,
  postROAS: number,
  postACoS: number
): AlgorithmEffectRecord {
  const roasChange = postROAS - record.previousROAS;
  const acosChange = record.previousACoS - postACoS; // ACoS降低为正向
  
  // 计算效果分数：ROAS提升和ACoS降低的加权平均
  const roasScore = roasChange > 0 ? Math.min(1, roasChange / record.previousROAS) : Math.max(-1, roasChange / record.previousROAS);
  const acosScore = acosChange > 0 ? Math.min(1, acosChange / record.previousACoS) : Math.max(-1, acosChange / record.previousACoS);
  const effectScore = (roasScore * 0.6 + acosScore * 0.4);
  
  return {
    ...record,
    postROAS,
    postACoS,
    roasChange: Math.round(roasChange * 100) / 100,
    acosChange: Math.round(acosChange * 100) / 100,
    effectScore: Math.round(effectScore * 100) / 100
  };
}

/**
 * 计算算法效果统计
 */
export function calculateAlgorithmEffectStats(
  records: AlgorithmEffectRecord[]
): Record<string, {
  count: number;
  avgROASChange: number;
  avgACoSChange: number;
  avgEffectScore: number;
  positiveRate: number;
}> {
  const stats: Record<string, {
    count: number;
    totalROASChange: number;
    totalACoSChange: number;
    totalEffectScore: number;
    positiveCount: number;
  }> = {};
  
  for (const record of records) {
    if (record.effectScore === undefined) continue;
    
    if (!stats[record.algorithmUsed]) {
      stats[record.algorithmUsed] = {
        count: 0,
        totalROASChange: 0,
        totalACoSChange: 0,
        totalEffectScore: 0,
        positiveCount: 0
      };
    }
    
    const s = stats[record.algorithmUsed];
    s.count++;
    s.totalROASChange += record.roasChange || 0;
    s.totalACoSChange += record.acosChange || 0;
    s.totalEffectScore += record.effectScore;
    if (record.effectScore > 0) s.positiveCount++;
  }
  
  const result: Record<string, {
    count: number;
    avgROASChange: number;
    avgACoSChange: number;
    avgEffectScore: number;
    positiveRate: number;
  }> = {};
  
  for (const [algorithm, s] of Object.entries(stats)) {
    result[algorithm] = {
      count: s.count,
      avgROASChange: Math.round((s.totalROASChange / s.count) * 100) / 100,
      avgACoSChange: Math.round((s.totalACoSChange / s.count) * 100) / 100,
      avgEffectScore: Math.round((s.totalEffectScore / s.count) * 100) / 100,
      positiveRate: Math.round((s.positiveCount / s.count) * 100)
    };
  }
  
  return result;
}
