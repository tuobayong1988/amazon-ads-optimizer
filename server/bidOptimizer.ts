/**
 * Amazon Ads Bid Optimization Algorithm
 * Based on market curve modeling and marginal analysis
 */

import { Keyword, ProductTarget, PerformanceGroup, Campaign } from "../drizzle/schema";

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
  
  // Estimate elasticity of clicks with respect to bid
  // Higher bids generally lead to better ad positions and more clicks
  // Elasticity typically ranges from 0.5 to 1.5
  const clickElasticity = 0.8;
  
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
    
    // Estimate clicks using logarithmic model
    // clicks = baseClicks * (1 + elasticity * ln(bidLevel / baseBid))
    const elasticity = 0.8;
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
 * Calculate bid adjustment based on performance
 */
export function calculateBidAdjustment(
  target: OptimizationTarget,
  config: PerformanceGroupConfig,
  maxBidLimit: number = 10.00,
  minBidLimit: number = 0.02
): OptimizationResult {
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
