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
  // 专家建议新增：库存与业务感知
  inventoryLevel?: 'normal' | 'low' | 'critical' | 'out_of_stock'; // 库存水平
  inventoryDays?: number; // 剩余库存天数
  organicRank?: number; // 自然排名（如果有）
  isStockout?: boolean; // 是否缺货
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
  const clickElasticity = 0.8; // 默认值，可通过getElasticity()动态获取
  
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
    const elasticity = 0.8; // 默认弹性系数
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
 * 数据充足性检查阈值
 * 专家建议：点击>=15且订单>=3才认为数据充足
 */
const DATA_SUFFICIENCY_THRESHOLDS = {
  minClicks: 15,
  minOrders: 3,
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
 */
export function isDataSufficient(target: OptimizationTarget): boolean {
  return target.clicks >= DATA_SUFFICIENCY_THRESHOLDS.minClicks && 
         target.orders >= DATA_SUFFICIENCY_THRESHOLDS.minOrders;
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

  // 专家建议：限制调整幅度，长尾词不宜大起大落（最多±20%）
  const MAX_SPARSE_CHANGE_PERCENT = 0.20;
  
  if (theoreticalBid > target.currentBid) {
    newBid = Math.min(theoreticalBid, target.currentBid * (1 + MAX_SPARSE_CHANGE_PERCENT));
    reason = `数据稀疏（点击${target.clicks}，订单${target.orders}），基于贝叶斯平滑CVR(${(smoothedCvr * 100).toFixed(1)}%)尝试提价`;
  } else {
    newBid = Math.max(theoreticalBid, target.currentBid * (1 - MAX_SPARSE_CHANGE_PERCENT));
    reason = `数据稀疏（点击${target.clicks}，订单${target.orders}），表现不及预期，保守降价`;
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
  // 专家建议：数据充足性检查
  if (!isDataSufficient(target)) {
    // 数据稀疏时，使用贝叶斯平滑的保守策略
    return calculateSparseDataBidAdjustment(target, config, maxBidLimit, minBidLimit);
  }

  // 数据充足时，使用原有的市场曲线模型
  const metrics = calculateMetrics(target);
  const marketCurve = generateMarketCurve(target);
  const optimalBid = findOptimalBid(marketCurve, config);
  
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
  
  // Generate reason
  const reason = generateOptimizationReason(target, metrics, config, newBid);
  
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
 * Batch optimize all targets in a performance group
 */
export function optimizePerformanceGroup(
  targets: OptimizationTarget[],
  config: PerformanceGroupConfig,
  maxBidLimit: number = 10.00
): OptimizationResult[] {
  const results: OptimizationResult[] = [];
  
  for (const target of targets) {
    // Skip targets with insufficient data
    if (target.clicks < 5 && target.impressions < 100) {
      continue;
    }
    
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
