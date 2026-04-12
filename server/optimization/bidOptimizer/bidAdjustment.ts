/**
 * 核心竞价调整算法 — 数据充足/稀疏/探索/零曝光场景的出价计算
 * v417: 从 bidOptimizer.ts 拆分
 */

import {
  type OptimizationTarget,
  type OptimizationResult,
  type PerformanceGroupConfig,
  MAX_BID_CHANGE_PERCENT,
  BAYESIAN_CONFIDENCE,
  DATA_SUFFICIENCY_THRESHOLDS,
  STRATEGY_DATA_THRESHOLDS,
  ZERO_IMPRESSION_PROBING_CONFIG,
} from './types';
import { calculateMetrics, generateMarketCurve, findOptimalBid } from './marketCurve';
import { calculateASPSensitivity } from './businessAware';

/**
 * 计算贝叶斯平滑后的转化率
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
 * 检查数据是否充足
 */
export function isDataSufficient(target: OptimizationTarget, config?: PerformanceGroupConfig): boolean {
  const strategyKey = config?.strategyTemplate || config?.optimizationGoal || 'balanced';
  const thresholds = STRATEGY_DATA_THRESHOLDS[strategyKey] || DATA_SUFFICIENCY_THRESHOLDS;
  return target.clicks >= thresholds.minClicks && 
         target.orders >= thresholds.minOrders;
}

/**
 * 数据稀疏场景的保守竞价策略（贝叶斯平滑）
 */
function calculateSparseDataBidAdjustment(
  target: OptimizationTarget,
  config: PerformanceGroupConfig,
  maxBidLimit: number = 2.00,
  minBidLimit: number = 0.10 // v641: 从$0.02提高到$0.10
): OptimizationResult {
  let newBid = target.currentBid;
  let reason = "";

  const groupAvgCvr = config.groupAvgCvr || 0.05;
  const groupAvgAov = config.groupAvgAov || 30;
  const groupAvgCpc = config.groupAvgCpc || 0.75;
  const effectiveMaxBid = config.maxBid || maxBidLimit;

  const smoothedCvr = calculateBayesianSmoothedCvr(target.orders, target.clicks, groupAvgCvr);

  let targetCpa: number;
  if (config.targetAcos) {
    targetCpa = (config.targetAcos / 100) * groupAvgAov;
  } else if (config.targetRoas && config.targetRoas > 0) {
    targetCpa = groupAvgAov / config.targetRoas;
  } else {
    targetCpa = groupAvgAov * 0.3;
  }

  const theoreticalBid = smoothedCvr * targetCpa;

  if (target.clicks === 0) {
    if (target.impressions > 0 && target.impressions < 100) {
      newBid = Math.min(target.currentBid * 1.05, effectiveMaxBid);
      reason = `[贝叶斯] 有曝光(${target.impressions})但零点击，微提5%改善广告位`;
    } else {
      newBid = target.currentBid;
      reason = `[贝叶斯] 数据不足(点击0)，保持当前出价$${target.currentBid.toFixed(2)}等待数据积累`;
    }
  } else if (target.orders === 0) {
    const currentCpc = target.spend / target.clicks;
    if (currentCpc > groupAvgCpc * 1.5) {
      newBid = Math.max(target.currentBid * 0.90, minBidLimit);
      reason = `[贝叶斯] 零转化且CPC($${currentCpc.toFixed(2)})偏高，降价10%`;
    } else {
      newBid = target.currentBid;
      reason = `[贝叶斯] 零转化但CPC合理，保持当前出价等待转化数据`;
    }
  } else {
    if (theoreticalBid > target.currentBid * 1.15) {
      newBid = target.currentBid * 1.10;
      reason = `[贝叶斯] 平滑CVR(${(smoothedCvr * 100).toFixed(1)}%)支持提价，保守提10%`;
    } else if (theoreticalBid < target.currentBid * 0.85) {
      newBid = target.currentBid * 0.90;
      reason = `[贝叶斯] 平滑CVR(${(smoothedCvr * 100).toFixed(1)}%)偏低，保守降10%`;
    } else {
      newBid = theoreticalBid;
      reason = `[贝叶斯] 基于平滑CVR(${(smoothedCvr * 100).toFixed(1)}%)和目标CPA($${targetCpa.toFixed(2)})调整`;
    }
  }

  newBid = Math.min(newBid, effectiveMaxBid);
  newBid = Math.max(newBid, minBidLimit);
  newBid = Math.round(newBid * 100) / 100;

  let actionType: "increase" | "decrease" | "set" = "set";
  if (newBid > target.currentBid) actionType = "increase";
  else if (newBid < target.currentBid) actionType = "decrease";

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
 * Generate human-readable optimization reason
 */
function generateOptimizationReason(
  target: OptimizationTarget,
  metrics: ReturnType<typeof calculateMetrics>,
  config: PerformanceGroupConfig,
  newBid: number
): string {
  const reasons: string[] = [];
  
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
  
  if (metrics.cvr > 5) {
    reasons.push(`高转化率 (${metrics.cvr.toFixed(1)}%) 支持提高出价`);
  } else if (metrics.cvr < 1 && target.clicks > 50) {
    reasons.push(`低转化率 (${metrics.cvr.toFixed(1)}%) 建议降低出价`);
  }
  
  if (target.impressions < 100 && newBid > target.currentBid) {
    reasons.push("曝光量较低，提高出价以获取更多流量");
  }
  
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

// 导出 generateOptimizationReason 供 enhanced.ts 使用
export { generateOptimizationReason };

/**
 * 核心竞价调整算法 — 数据充足时使用市场曲线模型
 */
export function calculateBidAdjustment(
  target: OptimizationTarget,
  config: PerformanceGroupConfig,
  maxBidLimit: number = 2.00,
  minBidLimit: number = 0.10 // v641: 从$0.02提高到$0.10
): OptimizationResult {
  if (!isDataSufficient(target, config)) {
    return calculateSparseDataBidAdjustment(target, config, maxBidLimit, minBidLimit);
  }

  const aspSensitivity = calculateASPSensitivity(target.currentASP, target.historicalASP);
  const adjustedConfig = { ...config };
  if (aspSensitivity.acosAdjustmentMultiplier !== 1 && adjustedConfig.targetAcos) {
    adjustedConfig.targetAcos = adjustedConfig.targetAcos * aspSensitivity.acosAdjustmentMultiplier;
  }
  if (aspSensitivity.acosAdjustmentMultiplier !== 1 && adjustedConfig.targetRoas) {
    adjustedConfig.targetRoas = aspSensitivity.acosAdjustmentMultiplier !== 0 ? adjustedConfig.targetRoas / aspSensitivity.acosAdjustmentMultiplier : adjustedConfig.targetRoas;
  }

  const metrics = calculateMetrics(target);
  const marketCurve = generateMarketCurve(target);
  const optimalBid = findOptimalBid(marketCurve, adjustedConfig);
  
  const effectiveMaxBid = config.maxBid || maxBidLimit;
  
  let newBid = optimalBid;
  
  newBid = Math.min(newBid, effectiveMaxBid);
  newBid = Math.max(newBid, minBidLimit);
  
  // v641: 算法激进度调整 — 当ACoS严重超标时允许更大幅度的降价
  let effectiveMaxChangePercent = MAX_BID_CHANGE_PERCENT;
  if (config.targetAcos && metrics.acos > 0) {
    const acosRatio = metrics.acos / config.targetAcos;
    if (acosRatio > 2.5) {
      // ACoS超过目标的250%以上，允许最大降价30%
      effectiveMaxChangePercent = Math.min(0.30, MAX_BID_CHANGE_PERCENT * 2);
    } else if (acosRatio > 1.8) {
      // ACoS超过目标的180%以上，允许最大降价22.5%
      effectiveMaxChangePercent = Math.min(0.225, MAX_BID_CHANGE_PERCENT * 1.5);
    } else if (acosRatio > 1.3) {
      // ACoS超过目标的130%以上，允许最大降价18.75%
      effectiveMaxChangePercent = Math.min(0.1875, MAX_BID_CHANGE_PERCENT * 1.25);
    }
  }
  if (config.targetRoas && metrics.roas > 0 && metrics.roas < config.targetRoas) {
    const roasRatio = metrics.roas / config.targetRoas;
    if (roasRatio < 0.4) {
      effectiveMaxChangePercent = Math.min(0.30, MAX_BID_CHANGE_PERCENT * 2);
    } else if (roasRatio < 0.6) {
      effectiveMaxChangePercent = Math.min(0.225, MAX_BID_CHANGE_PERCENT * 1.5);
    }
  }
  
  const maxIncrease = target.currentBid * (1 + MAX_BID_CHANGE_PERCENT); // 提价仍用原始限制
  const maxDecrease = target.currentBid * (1 - effectiveMaxChangePercent); // 降价使用动态限制
  
  newBid = Math.min(newBid, maxIncrease);
  newBid = Math.max(newBid, maxDecrease);
  
  newBid = Math.round(newBid * 100) / 100;
  
  let actionType: "increase" | "decrease" | "set" = "set";
  if (newBid > target.currentBid) {
    actionType = "increase";
  } else if (newBid < target.currentBid) {
    actionType = "decrease";
  }
  
  const bidChangePercent = target.currentBid > 0 ? ((newBid - target.currentBid) / target.currentBid) * 100 : 0;

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
 * 检测是否为疑似断货
 */
export function detectSuspectedOOS(target: OptimizationTarget): boolean {
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
export function isNewCampaign(target: OptimizationTarget): boolean {
  if (!target.campaignStartDate) return false;
  const daysSinceStart = (Date.now() - target.campaignStartDate.getTime()) / (1000 * 60 * 60 * 24);
  return daysSinceStart <= ZERO_IMPRESSION_PROBING_CONFIG.newCampaignDays;
}

/**
 * 零曝光探测策略
 */
export function calculateZeroImpressionProbing(
  target: OptimizationTarget,
  config: PerformanceGroupConfig,
  maxBidLimit: number
): OptimizationResult {
  const { probingBidIncrementPercent, probingBidIncrementFixed } = ZERO_IMPRESSION_PROBING_CONFIG;
  const effectiveMaxBid = config.maxBid || maxBidLimit;
  
  const increment = Math.max(
    target.currentBid * probingBidIncrementPercent,
    probingBidIncrementFixed
  );
  
  let newBid = Math.min(target.currentBid + increment, effectiveMaxBid);
  newBid = Math.round(newBid * 100) / 100;
  
  const bidChangePercent = target.currentBid > 0 ? ((newBid - target.currentBid) / target.currentBid) * 100 : 0;
  
  return {
    targetId: target.id,
    targetType: target.type,
    previousBid: target.currentBid,
    newBid,
    actionType: 'increase',
    bidChangePercent: Math.round(bidChangePercent * 100) / 100,
    reason: `[冷启动探测] 新Campaign零曝光，探测性提价+$${increment.toFixed(2)}(上限$${effectiveMaxBid.toFixed(2)})`,
  };
}

/**
 * 探索模式出价计算
 */
export function calculateExplorationBid(
  target: OptimizationTarget,
  config: PerformanceGroupConfig,
  maxBidLimit: number = 2.00,
  minBidLimit: number = 0.10 // v641: 从$0.02提高到$0.10
): OptimizationResult {
  let newBid = target.currentBid;
  let reason = '';
  
  const groupAvgCvr = config.groupAvgCvr || 0.05;
  const groupAvgAov = config.groupAvgAov || 30;
  const groupAvgCpc = config.groupAvgCpc || 0.75;
  const effectiveMaxBid = config.maxBid || maxBidLimit;
  
  const explorationCeiling = Math.min(groupAvgCpc * 3, effectiveMaxBid * 0.5, 3.00);
  
  // 场景0A：出价已达上限区间且仍无曝光 → 强制回退
  if (target.currentBid >= effectiveMaxBid * 0.9 && target.impressions === 0) {
    newBid = Math.max(groupAvgCpc, minBidLimit);
    reason = `[回退模式] 出价$${target.currentBid.toFixed(2)}已接近上限$${effectiveMaxBid.toFixed(2)}但零曝光，该关键词可能无效，强制回退至组平均CPC$${groupAvgCpc.toFixed(2)}`;
  }
  // 场景0B：出价已超过探索上限且无点击 → 降价回退
  else if (target.currentBid > explorationCeiling && target.clicks === 0) {
    newBid = explorationCeiling;
    reason = `[回退模式] 出价$${target.currentBid.toFixed(2)}超过探索上限$${explorationCeiling.toFixed(2)}但零点击，降价至探索上限`;
  }
  // 场景0C：出价超过组平均CPC的2倍且无转化 → 逐步降价
  else if (target.currentBid > groupAvgCpc * 2 && target.orders === 0 && target.spend > groupAvgCpc * 10) {
    newBid = Math.max(target.currentBid * 0.80, groupAvgCpc);
    reason = `[回退模式] 出价$${target.currentBid.toFixed(2)}远超组平均CPC$${groupAvgCpc.toFixed(2)}且花费$${target.spend.toFixed(2)}无转化，降价20%控制成本`;
  }
  // 场景1：零曝光或极低曝光（<50）
  else if (target.impressions < 50) {
    if (target.currentBid < explorationCeiling) {
      const increment = Math.max(target.currentBid * 0.08, 0.03);
      newBid = Math.min(target.currentBid + increment, explorationCeiling);
      reason = `[探索模式] 曝光量仅${target.impressions}，探测性提价+$${increment.toFixed(2)}寻找合理价位(上限$${explorationCeiling.toFixed(2)})`;
    } else {
      newBid = target.currentBid;
      reason = `[探索模式] 曝光量仅${target.impressions}，出价已达探索上限$${explorationCeiling.toFixed(2)}，保持观察`;
    }
  }
  // 场景2：有曝光但无点击
  else if (target.clicks === 0) {
    if (target.currentBid < explorationCeiling) {
      const increment = Math.max(target.currentBid * 0.05, 0.02);
      newBid = Math.min(target.currentBid + increment, explorationCeiling);
      reason = `[探索模式] 曝光${target.impressions}但零点击，小幅提价+$${increment.toFixed(2)}改善广告位置`;
    } else {
      newBid = target.currentBid * 0.95;
      reason = `[探索模式] 曝光${target.impressions}但零点击且出价已达探索上限，微降5%测试价格敏感性`;
    }
  }
  // 场景3：有点击但无转化
  else if (target.orders === 0) {
    const currentCpc = target.clicks > 0 ? target.spend / target.clicks : target.currentBid;
    if (currentCpc > groupAvgCpc * 1.5) {
      newBid = Math.max(target.currentBid * 0.90, groupAvgCpc * 0.8);
      reason = `[探索模式] 点击${target.clicks}无转化，CPC($${currentCpc.toFixed(2)})高于组平均($${groupAvgCpc.toFixed(2)})，降价10%控制成本`;
    } else if (target.spend > groupAvgAov * 0.5 && target.clicks >= 3) {
      newBid = target.currentBid * 0.95;
      reason = `[探索模式] 点击${target.clicks}无转化，花费$${target.spend.toFixed(2)}已达半个订单价值，微降5%`;
    } else {
      newBid = target.currentBid;
      reason = `[探索模式] 点击${target.clicks}无转化，CPC在合理范围，保持当前出价继续积累数据`;
    }
  }
  // 场景4：有少量转化
  else {
    const smoothedCvr = calculateBayesianSmoothedCvr(target.orders, target.clicks, groupAvgCvr);
    let targetCpa: number;
    if (config.targetAcos && target.orders > 0) {
      const avgOrderValue = target.sales / target.orders;
      targetCpa = (config.targetAcos / 100) * avgOrderValue;
    } else if (config.targetRoas && config.targetRoas > 0) {
      targetCpa = groupAvgAov / config.targetRoas;
    } else {
      targetCpa = groupAvgAov * 0.3;
    }
    const theoreticalBid = smoothedCvr * targetCpa;
    if (theoreticalBid > target.currentBid) {
      newBid = Math.min(theoreticalBid, target.currentBid * 1.15);
    } else {
      newBid = Math.max(theoreticalBid, target.currentBid * 0.85);
    }
    reason = `[探索模式] 点击${target.clicks}/订单${target.orders}，贝叶斯平滑CVR(${(smoothedCvr * 100).toFixed(1)}%)，基于探索性出价调整`;
  }
  
  newBid = Math.min(newBid, effectiveMaxBid);
  newBid = Math.max(newBid, minBidLimit);
  newBid = Math.round(newBid * 100) / 100;
  
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
 * 绩效组优化 — 对一组投放目标执行分层竞价优化
 */
export function optimizePerformanceGroup(
  targets: OptimizationTarget[],
  config: PerformanceGroupConfig,
  maxBidLimit: number = 2.00
): OptimizationResult[] {
  const results: OptimizationResult[] = [];
  const effectiveMaxBid = config.maxBid || maxBidLimit;
  
  for (const target of targets) {
    // 第0层：出价超限强制回退
    if (target.currentBid > effectiveMaxBid) {
      const newBid = Math.round(effectiveMaxBid * 100) / 100;
      results.push({
        targetId: target.id,
        targetType: target.type,
        previousBid: target.currentBid,
        newBid,
        actionType: 'decrease',
        bidChangePercent: target.currentBid > 0 ? Math.round(((newBid - target.currentBid) / target.currentBid) * 10000) / 100 : 0,
        reason: `[强制回退] 当前出价$${target.currentBid.toFixed(2)}超过最高出价限制$${effectiveMaxBid.toFixed(2)}，强制降价`,
      });
      continue;
    }
    
    // 第1层：疑似断货检测
    if (detectSuspectedOOS(target)) {
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
    
    // 第1.5层：零曝光高出价回退
    if (target.impressions === 0 && target.currentBid >= effectiveMaxBid * 0.7) {
      const groupAvgCpc = config.groupAvgCpc || 0.75;
      const rollbackBid = Math.max(Math.min(groupAvgCpc, effectiveMaxBid * 0.3), 0.02);
      const newBid = Math.round(rollbackBid * 100) / 100;
      results.push({
        targetId: target.id,
        targetType: target.type,
        previousBid: target.currentBid,
        newBid,
        actionType: 'decrease',
        bidChangePercent: target.currentBid > 0 ? Math.round(((newBid - target.currentBid) / target.currentBid) * 10000) / 100 : 0,
        reason: `[零曝光回退] 出价$${target.currentBid.toFixed(2)}已达上限的70%+但零曝光，强制回退至组平均CPC$${groupAvgCpc.toFixed(2)}`,
      });
      continue;
    }
    
    // 第2层：零曝光/冷启动探测
    if (target.impressions === 0 && isNewCampaign(target)) {
      const probingResult = calculateZeroImpressionProbing(target, config, effectiveMaxBid);
      results.push(probingResult);
      continue;
    }
    
    // 第3层：低数据量探索模式
    if (!isDataSufficient(target, config)) {
      const explorationResult = calculateExplorationBid(target, config, effectiveMaxBid);
      results.push(explorationResult);
      continue;
    }
    
    // 第4层：数据充足的正常优化流程
    const result = calculateBidAdjustment(target, config, effectiveMaxBid);
    
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
      if (acos < targetAcos && acos > 0) {
        adjustment = Math.min(50, Math.round((targetAcos - acos) / targetAcos * 100));
      } else if (acos > targetAcos) {
        adjustment = Math.max(-50, Math.round((targetAcos - acos) / acos * 100));
      }
    } else {
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
  // @ts-ignore
  const totalSales = hourlyPerformance.reduce((s: unknown, h: unknown) => s + h.sales, 0);
  // @ts-ignore
  const avgHourlySales = totalSales / hourlyPerformance.length;
  
  const currentHourData = hourlyPerformance.find(h => h.hour === currentHour);
  if (!currentHourData) return 0;
  
  const performanceRatio = avgHourlySales > 0 
    ? currentHourData.sales / avgHourlySales 
    : 1;
  
  let adjustment = (performanceRatio - 1) * 30;
  adjustment = Math.max(-30, Math.min(30, adjustment));
  
  return Math.round(adjustment);
}

/**
 * 获取出价调整原因
 */
export function getAdjustmentReason(
  keyword: { acos?: string | number; roas?: string | number; impressions?: number; clicks?: number; orders?: number; spend?: number; sales?: number },
  config: PerformanceGroupConfig
): string {
  const acos = keyword.acos ? parseFloat(String(keyword.acos)) : 0;
  const roas = keyword.roas ? parseFloat(String(keyword.roas)) : 0;
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
