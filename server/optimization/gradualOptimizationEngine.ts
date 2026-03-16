/**
 * gradualOptimizationEngine.ts - 渐进式优化引擎
 * 
 * v163: 确保所有自动优化动作（竞价、预算、位置）都是渐进式的
 * 
 * ==================== 核心设计原则 ====================
 * 
 * 1. 渐进式调整：永远不一步到位
 *    - 每次调整只缩小当前值与目标值之间差距的一部分
 *    - 调整幅度受数据置信度和趋势方向约束
 *    - 保护订单和销量不出现断崖式下跌
 * 
 * 2. 数据驱动的调整幅度：
 *    - 数据越充分，允许的调整幅度越大
 *    - 趋势越明确，调整越果断
 *    - 数据不足时极度保守
 * 
 * 3. 安全优先：
 *    - 降价/降预算比提价/提预算更保守
 *    - 连续同向调整时逐步降速
 *    - 检测异常波动时暂停调整
 * 
 * 4. 时间衰减加权数据驱动：
 *    - 使用timeDecayWeightedDataService提供的加权指标
 *    - 近期数据权重更高，但考虑归因延迟修正
 */

import {
  TimeWeightedMetrics,
  getCampaignTimeWeightedMetrics,
  calculateGradualBidAdjustment,
  calculateGradualBudgetTarget,
  calculateKeywordAdjustmentFactor,
} from '../analytics/timeDecayWeightedDataService';

// ==================== 配置常量 ====================

/** 渐进式竞价调整配置 */
export const GRADUAL_BID_CONFIG = {
  // 单次最大调整幅度（按数据置信度分级）
  maxChangeByConfidence: {
    high: 0.18,         // 高置信度：最多18%
    medium: 0.10,       // 中置信度：最多10%
    low: 0.06,          // 低置信度：最多6%
    insufficient: 0.03, // 数据不足：最多3%
  },
  // 连续同向调整降速因子
  consecutiveSameDirectionDampening: 0.80, // 每次连续同向调整，幅度降低20%
  // 最大连续同向调整次数（超过后暂停该方向调整）
  maxConsecutiveSameDirection: 5,
  // 降价保守系数（降价幅度 = 提价幅度 × 此系数）
  decreaseCaution: 0.70,
};

/** 渐进式预算调整配置 */
export const GRADUAL_BUDGET_CONFIG = {
  // 每次缩小差距的比例
  stepRatio: 0.25,
  // 单次最大调整百分比
  maxSingleChangePercent: 0.15,
  // 降预算保守系数
  decreaseCaution: 0.65,
  // 最低预算保护（美元）
  minBudget: 1.00,
  // 最高预算上限（美元）
  maxBudget: 50000.00,
  // 订单保护阈值：如果预计调整后订单下降超过此比例，限制调整
  orderProtectionThreshold: 0.20,
};

/** 渐进式位置调整配置 */
export const GRADUAL_PLACEMENT_CONFIG = {
  // 单次最大调整百分点
  maxSingleChangePoints: 15,
  // 总范围
  minMultiplier: -50,
  maxMultiplier: 200,
  // v360: 位置倾斜冷却期（48小时）
  cooldownDays: 2,
};

/** v360: 预算调整冷却期配置 */
export const BUDGET_COOLDOWN_CONFIG = {
  // 预算调整冷却期（24小时）
  cooldownHours: 24,
};

/** v360: 动态归因周期配置 - 根据广告类型自动调整 */
export const ATTRIBUTION_WINDOW_CONFIG: Record<string, number> = {
  sp: 7,    // SP广告: 7天点击归因
  sb: 14,   // SB广告: 14天点击归因
  sd: 14,   // SD广告: 14天点击归因
  default: 7,
};

/**
 * v360: 根据广告类型获取归因窗口天数
 */
export function getAttributionWindowDays(adType?: string): number {
  if (!adType) return ATTRIBUTION_WINDOW_CONFIG.default;
  const key = adType.toLowerCase().replace('sponsored_', '').replace('sponsored', '');
  return ATTRIBUTION_WINDOW_CONFIG[key] || ATTRIBUTION_WINDOW_CONFIG.default;
}

/**
 * v360: 检查预算调整冷却期
 * 返回true表示仍在冷却期内，不应进行调整
 */
export function isBudgetInCooldown(lastAdjustedAt?: string | null): boolean {
  if (!lastAdjustedAt) return false;
  const lastTime = new Date(lastAdjustedAt).getTime();
  const cooldownMs = BUDGET_COOLDOWN_CONFIG.cooldownHours * 3600 * 1000;
  return Date.now() - lastTime < cooldownMs;
}

/**
 * v360: 检查位置倾斜调整冷却期
 * 返回true表示仍在冷却期内，不应进行调整
 */
export function isPlacementInCooldown(lastAdjustedAt?: string | null): boolean {
  if (!lastAdjustedAt) return false;
  const lastTime = new Date(lastAdjustedAt).getTime();
  const cooldownMs = GRADUAL_PLACEMENT_CONFIG.cooldownDays * 24 * 3600 * 1000;
  return Date.now() - lastTime < cooldownMs;
}

// ==================== 渐进式竞价优化 ====================

export interface GradualBidResult {
  keywordId: number;
  currentBid: number;
  targetBid: number;       // 算法计算的理想目标出价
  gradualBid: number;      // 渐进式调整后的实际出价
  changePercent: number;
  reason: string;
  dataConfidence: string;
  trendDirection: string;
  stepsToTarget: number;   // 预计还需多少步达到目标
}

/**
 * 渐进式竞价调整
 * 
 * 输入：算法计算的理想目标出价
 * 输出：经过渐进式限制后的实际调整出价
 * 
 * 流程：
 * 1. 获取campaign级别的时间衰减加权指标
 * 2. 根据数据置信度确定最大调整幅度
 * 3. 根据趋势方向修正调整幅度
 * 4. 应用降价保守系数
 * 5. 检查连续同向调整限制
 */
export function applyGradualBidAdjustment(
  currentBid: number,
  algorithmTargetBid: number,
  campaignMetrics: TimeWeightedMetrics,
  consecutiveSameDirectionCount: number = 0,
  maxBidLimit: number = 2.00, // v165: 默认安全上限从$5降为$2，优化目标的max_bid为绝对红线
  minBidLimit: number = 0.02
): GradualBidResult {
  const confidence = campaignMetrics.dataQuality.confidenceLevel;
  const trend = campaignMetrics.trendSignal.direction;
  
  // 1. 确定基础最大调整幅度
  let maxChange = GRADUAL_BID_CONFIG.maxChangeByConfidence[confidence] || 0.10;
  
  // 2. 趋势修正
  if (trend === 'improving' && algorithmTargetBid > currentBid) {
    maxChange *= 1.15; // 趋势向好+提价：允许稍大幅度
  } else if (trend === 'declining' && algorithmTargetBid < currentBid) {
    maxChange *= 1.10; // 趋势向差+降价：允许稍大幅度
  } else if (trend === 'declining' && algorithmTargetBid > currentBid) {
    maxChange *= 0.50; // 趋势向差+提价：大幅限制
  } else if (trend === 'improving' && algorithmTargetBid < currentBid) {
    maxChange *= 0.60; // 趋势向好+降价：限制降价
  }
  
  // 3. 降价保守系数
  if (algorithmTargetBid < currentBid) {
    maxChange *= GRADUAL_BID_CONFIG.decreaseCaution;
  }
  
  // 4. 连续同向调整降速
  if (consecutiveSameDirectionCount > 0) {
    const dampening = Math.pow(
      GRADUAL_BID_CONFIG.consecutiveSameDirectionDampening,
      Math.min(consecutiveSameDirectionCount, GRADUAL_BID_CONFIG.maxConsecutiveSameDirection)
    );
    maxChange *= dampening;
  }
  
  // 5. 如果连续同向调整超过上限，暂停调整
  if (consecutiveSameDirectionCount >= GRADUAL_BID_CONFIG.maxConsecutiveSameDirection) {
    return {
      keywordId: 0,
      currentBid,
      targetBid: algorithmTargetBid,
      gradualBid: currentBid,
      changePercent: 0,
      reason: `连续${consecutiveSameDirectionCount}次同向调整，暂停以观察效果`,
      dataConfidence: confidence,
      trendDirection: trend,
      stepsToTarget: 999,
    };
  }
  
  // 6. 计算渐进式出价
  const bidDiff = algorithmTargetBid - currentBid;
  const maxAbsChange = currentBid * maxChange;
  
  let gradualBid: number;
  if (Math.abs(bidDiff) <= maxAbsChange) {
    gradualBid = algorithmTargetBid; // 差距在允许范围内，直接到位
  } else {
    gradualBid = currentBid + (bidDiff > 0 ? maxAbsChange : -maxAbsChange);
  }
  
  // 7. 应用绝对限制
  gradualBid = Math.min(gradualBid, maxBidLimit);
  gradualBid = Math.max(gradualBid, minBidLimit);
  gradualBid = Math.round(gradualBid * 100) / 100;
  
  // 8. 计算预计步数
  const actualChange = Math.abs(gradualBid - currentBid);
  const remainingGap = Math.abs(algorithmTargetBid - gradualBid);
  const stepsToTarget = actualChange > 0.001 ? Math.ceil(remainingGap / actualChange) : 0;
  
  const changePercent = currentBid > 0 ? ((gradualBid - currentBid) / currentBid) * 100 : 0;
  
  return {
    keywordId: 0,
    currentBid,
    targetBid: algorithmTargetBid,
    gradualBid,
    changePercent: Math.round(changePercent * 100) / 100,
    reason: buildBidReason(currentBid, gradualBid, algorithmTargetBid, confidence, trend, stepsToTarget),
    dataConfidence: confidence,
    trendDirection: trend,
    stepsToTarget,
  };
}

function buildBidReason(
  current: number, gradual: number, target: number,
  confidence: string, trend: string, steps: number
): string {
  const direction = gradual > current ? '提价' : gradual < current ? '降价' : '维持';
  const changeAbs = Math.abs(gradual - current);
  const changePct = current > 0 ? (changeAbs / current * 100).toFixed(1) : '0';
  
  if (direction === '维持') {
    return `渐进式优化: 维持当前出价$${current.toFixed(2)} (置信度=${confidence})`;
  }
  
  const parts = [
    `渐进${direction}: $${current.toFixed(2)}→$${gradual.toFixed(2)} (${changePct}%)`,
    `目标$${target.toFixed(2)}`,
  ];
  
  if (steps > 0) {
    parts.push(`预计${steps}步达成`);
  }
  
  parts.push(`置信度=${confidence}`);
  
  if (trend !== 'stable') {
    parts.push(`趋势=${trend === 'improving' ? '改善' : '下降'}`);
  }
  
  return parts.join('，');
}

// ==================== 渐进式预算优化 ====================

export interface GradualBudgetResult {
  campaignId: number;
  currentBudget: number;
  currentDailySpend: number;  // 时间衰减加权的日均花费
  targetBudget: number;       // 用户设定的目标预算
  gradualBudget: number;      // 渐进式调整后的预算
  changePercent: number;
  reason: string;
  stepsToTarget: number;
  orderProtectionActive: boolean;
}

/**
 * 渐进式预算调整
 * 
 * 核心场景：
 * - 当前日均花费$1500，目标$500 → 不能直接降到$500
 * - 每次降低15%左右，逐步接近目标
 * - 同时监控订单变化，如果订单下降过快则放缓调整
 */
export function applyGradualBudgetAdjustment(
  currentBudget: number,
  currentDailySpend: number,
  targetBudget: number,
  campaignMetrics: TimeWeightedMetrics
): GradualBudgetResult {
  const confidence = campaignMetrics.dataQuality.confidenceLevel;
  const trend = campaignMetrics.trendSignal.direction;
  
  // v165: 使用时间衰减加权的日均花费作为参考
  const effectiveSpend = campaignMetrics.weightedDailySpend > 0 
    ? campaignMetrics.weightedDailySpend 
    : currentDailySpend;
  
  // v165修复: gap基于currentBudget vs targetBudget（当前预算与目标预算的差距）
  // 而不是effectiveSpend vs targetBudget，因为我们要调整的是预算而不是花费
  const gap = currentBudget - targetBudget;
  const gapPercent = currentBudget > 0 ? Math.abs(gap) / currentBudget : 0;
  
  // 如果已经在目标范围内（±10%），微调到目标
  if (gapPercent <= 0.10) {
    return {
      campaignId: 0,
      currentBudget,
      currentDailySpend: effectiveSpend,
      targetBudget,
      gradualBudget: targetBudget,
      changePercent: currentBudget > 0 ? ((targetBudget - currentBudget) / currentBudget) * 100 : 0,
      reason: '当前花费已接近目标，微调到位',
      stepsToTarget: 0,
      orderProtectionActive: false,
    };
  }
  
  // 确定调整步长
  let stepRatio = GRADUAL_BUDGET_CONFIG.stepRatio;
  let maxChangePercent = GRADUAL_BUDGET_CONFIG.maxSingleChangePercent;
  
  // 根据数据置信度调整步长
  if (confidence === 'low' || confidence === 'insufficient') {
    stepRatio *= 0.60;
    maxChangePercent *= 0.60;
  } else if (confidence === 'medium') {
    stepRatio *= 0.80;
    maxChangePercent *= 0.80;
  }
  
  // 降预算时更保守
  if (gap > 0) {
    stepRatio *= GRADUAL_BUDGET_CONFIG.decreaseCaution;
    maxChangePercent *= GRADUAL_BUDGET_CONFIG.decreaseCaution;
  }
  
  // 趋势修正
  if (trend === 'improving' && gap > 0) {
    // 趋势向好但需要降预算：更保守
    stepRatio *= 0.70;
  } else if (trend === 'declining' && gap < 0) {
    // 趋势向差但需要提预算：更保守
    stepRatio *= 0.70;
  }
  
  // 计算本次调整量
  let stepAdjustment = gap * stepRatio;
  const maxAdjustment = currentBudget * maxChangePercent;
  
  if (Math.abs(stepAdjustment) > maxAdjustment) {
    stepAdjustment = stepAdjustment > 0 ? maxAdjustment : -maxAdjustment;
  }
  
  let gradualBudget = currentBudget - stepAdjustment;
  
  // 订单保护：如果预计调整会导致订单大幅下降
  let orderProtectionActive = false;
  if (gap > 0 && campaignMetrics.weightedDailyOrders > 0) {
    // 预估调整后的订单变化
    const spendReduction = stepAdjustment / effectiveSpend;
    // 假设订单与花费近似线性关系（保守估计）
    const estimatedOrderDrop = spendReduction * 0.8; // 花费降10%，订单大约降8%
    
    if (estimatedOrderDrop > GRADUAL_BUDGET_CONFIG.orderProtectionThreshold) {
      // 订单保护触发：限制调整幅度
      const safeReduction = GRADUAL_BUDGET_CONFIG.orderProtectionThreshold / 0.8 * effectiveSpend;
      stepAdjustment = Math.min(stepAdjustment, safeReduction);
      gradualBudget = currentBudget - stepAdjustment;
      orderProtectionActive = true;
    }
  }
  
  // 应用绝对限制
  gradualBudget = Math.max(GRADUAL_BUDGET_CONFIG.minBudget, gradualBudget);
  gradualBudget = Math.min(GRADUAL_BUDGET_CONFIG.maxBudget, gradualBudget);
  
  // v165修复: 最小有效调整量保证
  // 如果差距>$2但调整量<$1，强制至少调整$1（确保API能被触发）
  const actualChange = Math.abs(gradualBudget - currentBudget);
  if (actualChange < 1.00 && Math.abs(gap) > 2.00) {
    const direction = gap > 0 ? -1 : 1; // gap>0表示需要降预算
    gradualBudget = currentBudget + direction * 1.00;
    gradualBudget = Math.max(GRADUAL_BUDGET_CONFIG.minBudget, gradualBudget);
    gradualBudget = Math.min(GRADUAL_BUDGET_CONFIG.maxBudget, gradualBudget);
  }
  
  gradualBudget = Math.round(gradualBudget * 100) / 100;
  
  const changePercent = currentBudget > 0 ? ((gradualBudget - currentBudget) / currentBudget) * 100 : 0;
  const remainingGap = Math.abs(gradualBudget - targetBudget);
  const avgStep = Math.abs(stepAdjustment);
  const stepsToTarget = avgStep > 0.01 ? Math.ceil(remainingGap / avgStep) : 0;
  
  const direction = gradualBudget < currentBudget ? '降低' : '提升';
  let reason = `渐进${direction}预算: $${currentBudget.toFixed(0)}→$${gradualBudget.toFixed(0)} (${Math.abs(changePercent).toFixed(1)}%)`;
  reason += `，目标$${targetBudget.toFixed(0)}`;
  if (stepsToTarget > 0) reason += `，预计${stepsToTarget}步达成`;
  if (orderProtectionActive) reason += ' [订单保护已激活]';
  
  return {
    campaignId: 0,
    currentBudget,
    currentDailySpend: effectiveSpend,
    targetBudget,
    gradualBudget,
    changePercent: Math.round(changePercent * 100) / 100,
    reason,
    stepsToTarget,
    orderProtectionActive,
  };
}

// ==================== 渐进式位置调整 ====================

export interface GradualPlacementResult {
  placement: string;
  currentMultiplier: number;
  targetMultiplier: number;
  gradualMultiplier: number;
  changePoints: number;
  reason: string;
}

/**
 * 渐进式位置调整
 * 
 * 位置调整（Top of Search、Product Page等）的百分比倾斜也需要渐进
 */
export function applyGradualPlacementAdjustment(
  placement: string,
  currentMultiplier: number,
  targetMultiplier: number,
  campaignMetrics: TimeWeightedMetrics,
  placementRoiData?: { acos?: number; cvr?: number; roas?: number } // v360: 位置ROI数据
): GradualPlacementResult {
  const confidence = campaignMetrics.dataQuality.confidenceLevel;
  
  // 根据置信度确定最大调整百分点
  let maxPoints = GRADUAL_PLACEMENT_CONFIG.maxSingleChangePoints;
  if (confidence === 'low' || confidence === 'insufficient') {
    maxPoints = 8;
  } else if (confidence === 'medium') {
    maxPoints = 12;
  }
  
  // v360: 根据位置ROI数据调整调整幅度
  // ROI高的位置倾斜更积极，ROI低的位置倾斜更保守
  if (placementRoiData) {
    const placementAcos = placementRoiData.acos || 0;
    const placementRoas = placementRoiData.roas || 0;
    
    if (placementRoas > 3.0 || placementAcos < 25) {
      // 高ROI位置: 允许更大幅度的正向调整
      if (targetMultiplier > currentMultiplier) {
        maxPoints = Math.round(maxPoints * 1.3);
      }
    } else if (placementRoas < 1.5 || placementAcos > 50) {
      // 低ROI位置: 限制正向调整幅度
      if (targetMultiplier > currentMultiplier) {
        maxPoints = Math.round(maxPoints * 0.6);
      }
    }
  }
  
  const diff = targetMultiplier - currentMultiplier;
  
  let gradualMultiplier: number;
  if (Math.abs(diff) <= maxPoints) {
    gradualMultiplier = targetMultiplier;
  } else {
    gradualMultiplier = currentMultiplier + (diff > 0 ? maxPoints : -maxPoints);
  }
  
  // 应用绝对限制
  gradualMultiplier = Math.max(GRADUAL_PLACEMENT_CONFIG.minMultiplier, gradualMultiplier);
  gradualMultiplier = Math.min(GRADUAL_PLACEMENT_CONFIG.maxMultiplier, gradualMultiplier);
  gradualMultiplier = Math.round(gradualMultiplier);
  
  const changePoints = gradualMultiplier - currentMultiplier;
  
  // v360: 增强日志信息
  let reason = `渐进位置调整: ${placement} ${currentMultiplier}%→${gradualMultiplier}% (目标${targetMultiplier}%，置信度=${confidence})`;
  if (placementRoiData) {
    reason += ` [ROI: ACoS=${placementRoiData.acos?.toFixed(1) || 'N/A'}%, ROAS=${placementRoiData.roas?.toFixed(2) || 'N/A'}]`;
  }
  
  return {
    placement,
    currentMultiplier,
    targetMultiplier,
    gradualMultiplier,
    changePoints,
    reason,
  };
}

// ==================== 异常检测与安全保护 ====================

export interface SafetyCheckResult {
  safe: boolean;
  warnings: string[];
  shouldPause: boolean;
  reason?: string;
}

/**
 * 优化前安全检查
 * 
 * 检查时间衰减加权数据中的异常信号：
 * 1. 近期销售急剧下降（可能缺货或listing问题）
 * 2. 近期花费激增（可能竞争加剧或恶意点击）
 * 3. 转化率异常波动
 */
export function performSafetyCheck(
  metrics: TimeWeightedMetrics
): SafetyCheckResult {
  const warnings: string[] = [];
  let shouldPause = false;
  
  if (metrics.dataQuality.confidenceLevel === 'insufficient') {
    return {
      safe: true,
      warnings: ['数据不足，将使用极保守策略'],
      shouldPause: false,
    };
  }
  
  const windows = metrics.windowDetails;
  
  // 找到近期窗口和基准窗口
  const recentWindow = windows.find(w => w.windowName === 'recent_high_value');
  const baselineWindow = windows.find(w => w.windowName === 'baseline_reference');
  
  if (recentWindow && baselineWindow && baselineWindow.dailyAvgSales > 0) {
    // 检查销售急剧下降
    const salesDropRatio = recentWindow.dailyAvgSales / baselineWindow.dailyAvgSales;
    if (salesDropRatio < 0.40) {
      warnings.push(`近期日均销售额下降${((1 - salesDropRatio) * 100).toFixed(0)}%，可能存在缺货或listing问题`);
      shouldPause = true;
    } else if (salesDropRatio < 0.65) {
      warnings.push(`近期日均销售额下降${((1 - salesDropRatio) * 100).toFixed(0)}%，需要关注`);
    }
    
    // 检查花费激增
    if (baselineWindow.dailyAvgSpend > 0) {
      const spendSurgeRatio = recentWindow.dailyAvgSpend / baselineWindow.dailyAvgSpend;
      if (spendSurgeRatio > 2.5) {
        warnings.push(`近期日均花费激增${((spendSurgeRatio - 1) * 100).toFixed(0)}%，可能存在异常`);
        shouldPause = true;
      } else if (spendSurgeRatio > 1.8) {
        warnings.push(`近期日均花费增长${((spendSurgeRatio - 1) * 100).toFixed(0)}%`);
      }
    }
    
    // 检查转化率异常
    if (baselineWindow.cvr > 0) {
      const cvrChangeRatio = recentWindow.cvr / baselineWindow.cvr;
      if (cvrChangeRatio < 0.40) {
        warnings.push(`近期转化率下降${((1 - cvrChangeRatio) * 100).toFixed(0)}%，建议检查listing和库存`);
      }
    }
  }
  
  // v332: ACoS持续超标检测 — 当加权ACoS超过合理阈值时发出警告
  // 这是对LERUCCI US ACoS 132.7%问题的底层修复
  if (metrics.weightedAcos > 0) {
    if (metrics.weightedAcos > 1.5) {
      // ACoS > 150%: 严重超标，触发安全暂停
      warnings.push(`加权ACoS达${(metrics.weightedAcos * 100).toFixed(1)}%，严重超标，建议紧急审查广告活动`);
      shouldPause = true;
    } else if (metrics.weightedAcos > 0.8) {
      // ACoS > 80%: 明显超标，发出警告
      warnings.push(`加权ACoS达${(metrics.weightedAcos * 100).toFixed(1)}%，明显偏高`);
    }
  }
  
  return {
    safe: !shouldPause,
    warnings,
    shouldPause,
    reason: shouldPause ? warnings.join('；') : undefined,
  };
}
