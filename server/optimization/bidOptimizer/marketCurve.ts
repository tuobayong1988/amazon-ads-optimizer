/**
 * 市场曲线建模 — 流量估算、边际分析、最优出价计算
 * v417: 从 bidOptimizer.ts 拆分
 */

import { getElasticity } from "../../algorithm/algorithmUtils";
import {
  type OptimizationTarget,
  type MarketCurvePoint,
  type PerformanceGroupConfig,
  CPC_BID_RATIO,
  DEFAULT_CTR_FALLBACK,
  TRAFFIC_CEILING_MULTIPLIER,
} from './types';

/**
 * Calculate key performance metrics
 */
export function calculateMetrics(target: OptimizationTarget) {
  const acos = target.sales > 0 ? (target.spend / target.sales) * 100 : 0;
  const roas = target.spend > 0 ? target.sales / target.spend : 0;
  const ctr = target.impressions > 0 ? (target.clicks / target.impressions) * 100 : 0;
  const cvr = target.clicks > 0 ? (target.orders / target.clicks) * 100 : 0;
  const cpc = target.clicks > 0 ? target.spend / target.clicks : 0;
  const aov = target.orders > 0 ? target.sales / target.orders : 0;
  
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
  if (historicalData && historicalData.length >= 3) {
    const n = historicalData.length;
    // @ts-ignore
    const sumLnBid = historicalData.reduce((s: unknown, d: unknown) => s + Math.log(d.bid), 0);
    // @ts-ignore
    const sumImpressions = historicalData.reduce((s: unknown, d: unknown) => s + d.impressions, 0);
    // @ts-ignore
    const sumLnBidImpressions = historicalData.reduce((s: unknown, d: unknown) => s + Math.log(d.bid) * d.impressions, 0);
    // @ts-ignore
    const sumLnBidSq = historicalData.reduce((s: unknown, d: unknown) => s + Math.log(d.bid) ** 2, 0);
    
    // @ts-ignore
    const denominator = n * sumLnBidSq - sumLnBid ** 2;
    if (denominator === 0 || n === 0) {
      // @ts-ignore
      return Math.round(currentImpressions * TRAFFIC_CEILING_MULTIPLIER);
    }
    // @ts-ignore
    const a = (n * sumLnBidImpressions - sumLnBid * sumImpressions) / denominator;
    
    const ceilingBid = 10;
    // @ts-ignore
    const ceiling = a * Math.log(ceilingBid) + (sumImpressions - a * sumLnBid) / n;
    
    return Math.max(ceiling, currentImpressions * TRAFFIC_CEILING_MULTIPLIER);
  }
  
  return Math.round(currentImpressions / 0.6);
}

/**
 * Calculate marginal revenue and cost
 */
export function calculateMarginalValues(
  currentBid: number,
  currentMetrics: OptimizationTarget,
  bidIncrement: number = 0.10
): { marginalRevenue: number; marginalCost: number; marginalProfit: number } {
  const { cvr, cpc, aov } = calculateMetrics(currentMetrics);
  
  const clickElasticity = getElasticity(currentMetrics.bidChangeHistory || [], currentMetrics.category);
  
  const bidChangePercent = currentBid > 0 ? bidIncrement / currentBid : 0;
  const estimatedClickIncrease = currentMetrics.clicks * clickElasticity * bidChangePercent;
  
  const marginalCost = estimatedClickIncrease * (cpc + bidIncrement);
  const marginalRevenue = estimatedClickIncrease * (cvr / 100) * aov;
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
  const bidStep = steps > 0 ? (maxBid - minBid) / steps : 0.01;
  const { cvr, aov } = calculateMetrics(target);
  
  const baseClicks = target.clicks;
  const baseBid = target.currentBid;
  
  for (let i = 0; i <= steps; i++) {
    const bidLevel = minBid + i * bidStep;
    
    const elasticity = getElasticity(target.bidChangeHistory || [], target.category);
    const clickMultiplier = baseBid > 0 ? 1 + elasticity * Math.log(bidLevel / baseBid) : 1;
    const estimatedClicks = Math.max(0, baseClicks * clickMultiplier);
    
    const ctr = target.impressions > 0 ? target.clicks / target.impressions : DEFAULT_CTR_FALLBACK;
    const estimatedImpressions = ctr > 0 ? estimatedClicks / ctr : estimatedClicks * 100;
    
    const estimatedConversions = estimatedClicks * (cvr / 100);
    const estimatedSales = estimatedConversions * aov;
    
    const estimatedCpc = bidLevel * CPC_BID_RATIO;
    const estimatedSpend = estimatedClicks * estimatedCpc;
    
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
      for (const point of marketCurve) {
        if (point.marginalRevenue >= point.marginalCost) {
          optimalBid = point.bidLevel;
        } else {
          break;
        }
      }
      break;
      
    case "target_acos":
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
      if (config.dailySpendLimit) {
        for (const point of marketCurve) {
          if (point.estimatedSpend <= config.dailySpendLimit) {
            optimalBid = point.bidLevel;
          }
        }
      }
      break;
      
    case "daily_cost":
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
