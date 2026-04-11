// Extracted from production dist/index.js
// Original module: server/optimization/bidOptimizer/bidAdjustment.ts
// Lines: 171

function calculateBayesianSmoothedCvr(orders, clicks, priorCvr, confidence = BAYESIAN_CONFIDENCE) {
  return (orders + confidence * priorCvr) / (clicks + confidence);
}
function isDataSufficient(target, config2) {
  const strategyKey = config2?.strategyTemplate || config2?.optimizationGoal || "balanced";
  const thresholds = STRATEGY_DATA_THRESHOLDS[strategyKey] || DATA_SUFFICIENCY_THRESHOLDS;
  return target.clicks >= thresholds.minClicks && target.orders >= thresholds.minOrders;
}
function calculateSparseDataBidAdjustment(target, config2, maxBidLimit = 2, minBidLimit = 0.02) {
  let newBid = target.currentBid;
  let reason = "";
  const groupAvgCvr = config2.groupAvgCvr || 0.05;
  const groupAvgAov = config2.groupAvgAov || 30;
  const groupAvgCpc = config2.groupAvgCpc || 0.75;
  const effectiveMaxBid = config2.maxBid || maxBidLimit;
  const smoothedCvr = calculateBayesianSmoothedCvr(target.orders, target.clicks, groupAvgCvr);
  let targetCpa;
  if (config2.targetAcos) {
    targetCpa = config2.targetAcos / 100 * groupAvgAov;
  } else if (config2.targetRoas && config2.targetRoas > 0) {
    targetCpa = groupAvgAov / config2.targetRoas;
  } else {
    targetCpa = groupAvgAov * 0.3;
  }
  const theoreticalBid = smoothedCvr * targetCpa;
  if (target.clicks === 0) {
    if (target.impressions > 0 && target.impressions < 100) {
      newBid = Math.min(target.currentBid * 1.05, effectiveMaxBid);
      reason = `[\u8D1D\u53F6\u65AF] \u6709\u66DD\u5149(${target.impressions})\u4F46\u96F6\u70B9\u51FB\uFF0C\u5FAE\u63D05%\u6539\u5584\u5E7F\u544A\u4F4D`;
    } else {
      newBid = target.currentBid;
      reason = `[\u8D1D\u53F6\u65AF] \u6570\u636E\u4E0D\u8DB3(\u70B9\u51FB0)\uFF0C\u4FDD\u6301\u5F53\u524D\u51FA\u4EF7$${target.currentBid.toFixed(2)}\u7B49\u5F85\u6570\u636E\u79EF\u7D2F`;
    }
  } else if (target.orders === 0) {
    const currentCpc = target.spend / target.clicks;
    if (currentCpc > groupAvgCpc * 1.5) {
      newBid = Math.max(target.currentBid * 0.9, minBidLimit);
      reason = `[\u8D1D\u53F6\u65AF] \u96F6\u8F6C\u5316\u4E14CPC($${currentCpc.toFixed(2)})\u504F\u9AD8\uFF0C\u964D\u4EF710%`;
    } else {
      newBid = target.currentBid;
      reason = `[\u8D1D\u53F6\u65AF] \u96F6\u8F6C\u5316\u4F46CPC\u5408\u7406\uFF0C\u4FDD\u6301\u5F53\u524D\u51FA\u4EF7\u7B49\u5F85\u8F6C\u5316\u6570\u636E`;
    }
  } else {
    if (theoreticalBid > target.currentBid * 1.15) {
      newBid = target.currentBid * 1.1;
      reason = `[\u8D1D\u53F6\u65AF] \u5E73\u6ED1CVR(${(smoothedCvr * 100).toFixed(1)}%)\u652F\u6301\u63D0\u4EF7\uFF0C\u4FDD\u5B88\u63D010%`;
    } else if (theoreticalBid < target.currentBid * 0.85) {
      newBid = target.currentBid * 0.9;
      reason = `[\u8D1D\u53F6\u65AF] \u5E73\u6ED1CVR(${(smoothedCvr * 100).toFixed(1)}%)\u504F\u4F4E\uFF0C\u4FDD\u5B88\u964D10%`;
    } else {
      newBid = theoreticalBid;
      reason = `[\u8D1D\u53F6\u65AF] \u57FA\u4E8E\u5E73\u6ED1CVR(${(smoothedCvr * 100).toFixed(1)}%)\u548C\u76EE\u6807CPA($${targetCpa.toFixed(2)})\u8C03\u6574`;
    }
  }
  newBid = Math.min(newBid, effectiveMaxBid);
  newBid = Math.max(newBid, minBidLimit);
  newBid = Math.round(newBid * 100) / 100;
  let actionType = "set";
  if (newBid > target.currentBid) actionType = "increase";
  else if (newBid < target.currentBid) actionType = "decrease";
  const bidChangePercent = target.currentBid > 0 ? (newBid - target.currentBid) / target.currentBid * 100 : 0;
  return {
    targetId: target.id,
    targetType: target.type,
    previousBid: target.currentBid,
    newBid,
    actionType,
    bidChangePercent: Math.round(bidChangePercent * 100) / 100,
    reason,
    // v620-fix11: Pass through for upstream guards
    _v620_isDecrease: newBid < target.currentBid
  };
}
function generateOptimizationReason(target, metrics, config2, newBid) {
  const reasons = [];
  if (metrics.acos > 0) {
    if (config2.optimizationGoal === "target_acos" && config2.targetAcos) {
      if (metrics.acos > config2.targetAcos) {
        reasons.push(`\u5F53\u524DACoS (${metrics.acos.toFixed(1)}%) \u9AD8\u4E8E\u76EE\u6807 (${config2.targetAcos}%)`);
      } else {
        reasons.push(`\u5F53\u524DACoS (${metrics.acos.toFixed(1)}%) \u4F4E\u4E8E\u76EE\u6807\uFF0C\u53EF\u63D0\u9AD8\u51FA\u4EF7\u83B7\u53D6\u66F4\u591A\u6D41\u91CF`);
      }
    }
  }
  if (metrics.roas > 0) {
    if (config2.optimizationGoal === "target_roas" && config2.targetRoas) {
      if (metrics.roas < config2.targetRoas) {
        reasons.push(`\u5F53\u524DROAS (${metrics.roas.toFixed(2)}) \u4F4E\u4E8E\u76EE\u6807 (${config2.targetRoas})`);
      } else {
        reasons.push(`\u5F53\u524DROAS (${metrics.roas.toFixed(2)}) \u8FBE\u5230\u76EE\u6807\uFF0C\u4F18\u5316\u51FA\u4EF7\u4EE5\u6700\u5927\u5316\u6548\u76CA`);
      }
    }
  }
  if (metrics.cvr > 5) {
    reasons.push(`\u9AD8\u8F6C\u5316\u7387 (${metrics.cvr.toFixed(1)}%) \u652F\u6301\u63D0\u9AD8\u51FA\u4EF7`);
  } else if (metrics.cvr < 1 && target.clicks > 50) {
    reasons.push(`\u4F4E\u8F6C\u5316\u7387 (${metrics.cvr.toFixed(1)}%) \u5EFA\u8BAE\u964D\u4F4E\u51FA\u4EF7`);
  }
  if (target.impressions < 100 && newBid > target.currentBid) {
    reasons.push("\u66DD\u5149\u91CF\u8F83\u4F4E\uFF0C\u63D0\u9AD8\u51FA\u4EF7\u4EE5\u83B7\u53D6\u66F4\u591A\u6D41\u91CF");
  }
  if (reasons.length === 0) {
    if (newBid > target.currentBid) {
      reasons.push("\u57FA\u4E8E\u5E02\u573A\u66F2\u7EBF\u5206\u6790\uFF0C\u63D0\u9AD8\u51FA\u4EF7\u53EF\u589E\u52A0\u8FB9\u9645\u6536\u76CA");
    } else if (newBid < target.currentBid) {
      reasons.push("\u57FA\u4E8E\u5E02\u573A\u66F2\u7EBF\u5206\u6790\uFF0C\u964D\u4F4E\u51FA\u4EF7\u53EF\u4F18\u5316\u6295\u5165\u4EA7\u51FA\u6BD4");
    } else {
      reasons.push("\u5F53\u524D\u51FA\u4EF7\u5904\u4E8E\u6700\u4F18\u533A\u95F4");
    }
  }
  return reasons.join("\uFF1B");
}
function calculateBidAdjustment(target, config2, maxBidLimit = 2, minBidLimit = 0.02) {
  if (!isDataSufficient(target, config2)) {
    return calculateSparseDataBidAdjustment(target, config2, maxBidLimit, minBidLimit);
  }
  const aspSensitivity = calculateASPSensitivity(target.currentASP, target.historicalASP);
  const adjustedConfig = { ...config2 };
  if (aspSensitivity.acosAdjustmentMultiplier !== 1 && adjustedConfig.targetAcos) {
    adjustedConfig.targetAcos = adjustedConfig.targetAcos * aspSensitivity.acosAdjustmentMultiplier;
  }
  if (aspSensitivity.acosAdjustmentMultiplier !== 1 && adjustedConfig.targetRoas) {
    adjustedConfig.targetRoas = aspSensitivity.acosAdjustmentMultiplier !== 0 ? adjustedConfig.targetRoas / aspSensitivity.acosAdjustmentMultiplier : adjustedConfig.targetRoas;
  }
  const metrics = calculateMetrics(target);
  const marketCurve = generateMarketCurve(target);
  const optimalBid = findOptimalBid(marketCurve, adjustedConfig);
  const effectiveMaxBid = config2.maxBid || maxBidLimit;
  let newBid = optimalBid;
  newBid = Math.min(newBid, effectiveMaxBid);
  newBid = Math.max(newBid, minBidLimit);
  const maxIncrease = target.currentBid * (1 + MAX_BID_CHANGE_PERCENT);
  const maxDecrease = target.currentBid * (1 - MAX_BID_CHANGE_PERCENT);
  newBid = Math.min(newBid, maxIncrease);
  newBid = Math.max(newBid, maxDecrease);
  newBid = Math.round(newBid * 100) / 100;
  let actionType = "set";
  if (newBid > target.currentBid) {
    actionType = "increase";
  } else if (newBid < target.currentBid) {
    actionType = "decrease";
  }
  const bidChangePercent = target.currentBid > 0 ? (newBid - target.currentBid) / target.currentBid * 100 : 0;
  let reason = generateOptimizationReason(target, metrics, adjustedConfig, newBid);
  if (aspSensitivity.priceAction !== "stable") {
    reason = `[${aspSensitivity.reason}] ${reason}`;
  }
  return {
    targetId: target.id,
    targetType: target.type,
    previousBid: target.currentBid,
    newBid,
    actionType,
    bidChangePercent: Math.round(bidChangePercent * 100) / 100,
    reason
  };
}
var init_bidAdjustment2 = __esm({
  "server/optimization/bidOptimizer/bidAdjustment.ts"() {
    "use strict";
    init_types();
    init_marketCurve();
    init_businessAware();
    __name(calculateBayesianSmoothedCvr, "calculateBayesianSmoothedCvr");
    __name(isDataSufficient, "isDataSufficient");
    __name(calculateSparseDataBidAdjustment, "calculateSparseDataBidAdjustment");
    __name(generateOptimizationReason, "generateOptimizationReason");
    __name(calculateBidAdjustment, "calculateBidAdjustment");
  }
});

