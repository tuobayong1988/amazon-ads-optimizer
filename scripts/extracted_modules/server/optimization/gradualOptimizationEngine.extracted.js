// Extracted from production dist/index.js
// Original module: server/optimization/gradualOptimizationEngine.ts
// Lines: 168

function applyGradualBudgetAdjustment(currentBudget, currentDailySpend, targetBudget, campaignMetrics) {
  const confidence = campaignMetrics.dataQuality.confidenceLevel;
  const trend = campaignMetrics.trendSignal.direction;
  const effectiveSpend = campaignMetrics.weightedDailySpend > 0 ? campaignMetrics.weightedDailySpend : currentDailySpend;
  const gap = currentBudget - targetBudget;
  const gapPercent = currentBudget > 0 ? Math.abs(gap) / currentBudget : 0;
  if (gapPercent <= 0.1) {
    return {
      campaignId: 0,
      currentBudget,
      currentDailySpend: effectiveSpend,
      targetBudget,
      gradualBudget: targetBudget,
      changePercent: currentBudget > 0 ? (targetBudget - currentBudget) / currentBudget * 100 : 0,
      reason: "\u5F53\u524D\u82B1\u8D39\u5DF2\u63A5\u8FD1\u76EE\u6807\uFF0C\u5FAE\u8C03\u5230\u4F4D",
      stepsToTarget: 0,
      orderProtectionActive: false
    };
  }
  let stepRatio = GRADUAL_BUDGET_CONFIG.stepRatio;
  let maxChangePercent = GRADUAL_BUDGET_CONFIG.maxSingleChangePercent;
  if (confidence === "low" || confidence === "insufficient") {
    stepRatio *= 0.6;
    maxChangePercent *= 0.6;
  } else if (confidence === "medium") {
    stepRatio *= 0.8;
    maxChangePercent *= 0.8;
  }
  if (gap > 0) {
    stepRatio *= GRADUAL_BUDGET_CONFIG.decreaseCaution;
    maxChangePercent *= GRADUAL_BUDGET_CONFIG.decreaseCaution;
  }
  if (trend === "improving" && gap > 0) {
    stepRatio *= 0.7;
  } else if (trend === "declining" && gap < 0) {
    stepRatio *= 0.7;
  }
  let stepAdjustment = gap * stepRatio;
  const maxAdjustment = currentBudget * maxChangePercent;
  if (Math.abs(stepAdjustment) > maxAdjustment) {
    stepAdjustment = stepAdjustment > 0 ? maxAdjustment : -maxAdjustment;
  }
  let gradualBudget = currentBudget - stepAdjustment;
  let orderProtectionActive = false;
  if (gap > 0 && campaignMetrics.weightedDailyOrders > 0) {
    const spendReduction = stepAdjustment / effectiveSpend;
    const estimatedOrderDrop = spendReduction * 0.8;
    if (estimatedOrderDrop > GRADUAL_BUDGET_CONFIG.orderProtectionThreshold) {
      const safeReduction = GRADUAL_BUDGET_CONFIG.orderProtectionThreshold / 0.8 * effectiveSpend;
      stepAdjustment = Math.min(stepAdjustment, safeReduction);
      gradualBudget = currentBudget - stepAdjustment;
      orderProtectionActive = true;
    }
  }
  gradualBudget = Math.max(GRADUAL_BUDGET_CONFIG.minBudget, gradualBudget);
  gradualBudget = Math.min(GRADUAL_BUDGET_CONFIG.maxBudget, gradualBudget);
  const actualChange = Math.abs(gradualBudget - currentBudget);
  if (actualChange < 1 && Math.abs(gap) > 2) {
    const direction2 = gap > 0 ? -1 : 1;
    gradualBudget = currentBudget + direction2 * 1;
    gradualBudget = Math.max(GRADUAL_BUDGET_CONFIG.minBudget, gradualBudget);
    gradualBudget = Math.min(GRADUAL_BUDGET_CONFIG.maxBudget, gradualBudget);
  }
  gradualBudget = Math.round(gradualBudget * 100) / 100;
  const changePercent = currentBudget > 0 ? (gradualBudget - currentBudget) / currentBudget * 100 : 0;
  const remainingGap = Math.abs(gradualBudget - targetBudget);
  const avgStep = Math.abs(stepAdjustment);
  const stepsToTarget = avgStep > 0.01 ? Math.ceil(remainingGap / avgStep) : 0;
  const direction = gradualBudget < currentBudget ? "\u964D\u4F4E" : "\u63D0\u5347";
  let reason = `\u6E10\u8FDB${direction}\u9884\u7B97: $${currentBudget.toFixed(0)}\u2192$${gradualBudget.toFixed(0)} (${Math.abs(changePercent).toFixed(1)}%)`;
  reason += `\uFF0C\u76EE\u6807$${targetBudget.toFixed(0)}`;
  if (stepsToTarget > 0) reason += `\uFF0C\u9884\u8BA1${stepsToTarget}\u6B65\u8FBE\u6210`;
  if (orderProtectionActive) reason += " [\u8BA2\u5355\u4FDD\u62A4\u5DF2\u6FC0\u6D3B]";
  return {
    campaignId: 0,
    currentBudget,
    currentDailySpend: effectiveSpend,
    targetBudget,
    gradualBudget,
    changePercent: Math.round(changePercent * 100) / 100,
    reason,
    stepsToTarget,
    orderProtectionActive
  };
}
function performSafetyCheck(metrics) {
  const warnings = [];
  let shouldPause = false;
  if (metrics.dataQuality.confidenceLevel === "insufficient") {
    return {
      safe: true,
      warnings: ["\u6570\u636E\u4E0D\u8DB3\uFF0C\u5C06\u4F7F\u7528\u6781\u4FDD\u5B88\u7B56\u7565"],
      shouldPause: false
    };
  }
  const windows = metrics.windowDetails;
  const recentWindow = windows.find((w) => w.windowName === "recent_high_value");
  const baselineWindow = windows.find((w) => w.windowName === "baseline_reference");
  if (recentWindow && baselineWindow && baselineWindow.dailyAvgSales > 0) {
    const hasBaselineSpend = baselineWindow.dailyAvgSpend >= 3;
    const salesDropRatio = recentWindow.dailyAvgSales / baselineWindow.dailyAvgSales;
    if (salesDropRatio < 0.4 && hasBaselineSpend) {
      warnings.push(`\u8FD1\u671F\u65E5\u5747\u9500\u552E\u989D\u4E0B\u964D${((1 - salesDropRatio) * 100).toFixed(0)}%\uFF0C\u53EF\u80FD\u5B58\u5728\u7F3A\u8D27\u6216listing\u95EE\u9898`);
      if (salesDropRatio < 0.2 && baselineWindow.dailyAvgSpend >= 10) {
        shouldPause = true;
      }
    } else if (salesDropRatio < 0.65) {
      warnings.push(`\u8FD1\u671F\u65E5\u5747\u9500\u552E\u989D\u4E0B\u964D${((1 - salesDropRatio) * 100).toFixed(0)}%\uFF0C\u9700\u8981\u5173\u6CE8`);
    }
    if (baselineWindow.dailyAvgSpend > 0) {
      const spendSurgeRatio = recentWindow.dailyAvgSpend / baselineWindow.dailyAvgSpend;
      if (spendSurgeRatio > 2.5 && hasBaselineSpend) {
        warnings.push(`\u8FD1\u671F\u65E5\u5747\u82B1\u8D39\u6FC0\u589E${((spendSurgeRatio - 1) * 100).toFixed(0)}%\uFF0C\u53EF\u80FD\u5B58\u5728\u5F02\u5E38`);
        if (spendSurgeRatio > 5) {
          shouldPause = true;
        }
      } else if (spendSurgeRatio > 1.8) {
        warnings.push(`\u8FD1\u671F\u65E5\u5747\u82B1\u8D39\u589E\u957F${((spendSurgeRatio - 1) * 100).toFixed(0)}%`);
      }
    }
    if (baselineWindow.cvr > 0) {
      const cvrChangeRatio = recentWindow.cvr / baselineWindow.cvr;
      if (cvrChangeRatio < 0.4) {
        warnings.push(`\u8FD1\u671F\u8F6C\u5316\u7387\u4E0B\u964D${((1 - cvrChangeRatio) * 100).toFixed(0)}%\uFF0C\u5EFA\u8BAE\u68C0\u67E5listing\u548C\u5E93\u5B58`);
      }
    }
  }
  if (metrics.weightedAcos > 0) {
    const hasSignificantSpend = recentWindow && recentWindow.dailyAvgSpend >= 5;
    if (metrics.weightedAcos > 3 && hasSignificantSpend) {
      warnings.push(`\u52A0\u6743ACoS\u8FBE${(metrics.weightedAcos * 100).toFixed(1)}%\uFF0C\u6781\u5EA6\u5F02\u5E38\uFF0C\u5EFA\u8BAE\u7D27\u6025\u5BA1\u67E5\u5E7F\u544A\u6D3B\u52A8`);
      shouldPause = true;
    } else if (metrics.weightedAcos > 1.5 && hasSignificantSpend) {
      warnings.push(`\u52A0\u6743ACoS\u8FBE${(metrics.weightedAcos * 100).toFixed(1)}%\uFF0C\u4E25\u91CD\u8D85\u6807\uFF0C\u5C06\u4F7F\u7528\u4FDD\u5B88\u4F18\u5316\u7B56\u7565`);
    } else if (metrics.weightedAcos > 0.8) {
      warnings.push(`\u52A0\u6743ACoS\u8FBE${(metrics.weightedAcos * 100).toFixed(1)}%\uFF0C\u660E\u663E\u504F\u9AD8`);
    }
  }
  return {
    safe: !shouldPause,
    warnings,
    shouldPause,
    reason: shouldPause ? warnings.join("\uFF1B") : void 0
  };
}
var GRADUAL_BUDGET_CONFIG;
var init_gradualOptimizationEngine = __esm({
  "server/optimization/gradualOptimizationEngine.ts"() {
    "use strict";
    GRADUAL_BUDGET_CONFIG = {
      // 每次缩小差距的比例
      stepRatio: 0.25,
      // 单次最大调整百分比
      maxSingleChangePercent: 0.15,
      // 降预算保守系数
      decreaseCaution: 0.65,
      // 最低预算保护（美元）
      minBudget: 1,
      // 最高预算上限（美元）
      maxBudget: 5e4,
      // 订单保护阈值：如果预计调整后订单下降超过此比例，限制调整
      orderProtectionThreshold: 0.2
    };
    __name(applyGradualBudgetAdjustment, "applyGradualBudgetAdjustment");
    __name(performSafetyCheck, "performSafetyCheck");
  }
});

