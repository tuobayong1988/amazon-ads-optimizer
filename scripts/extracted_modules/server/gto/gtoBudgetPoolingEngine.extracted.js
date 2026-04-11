// Extracted from production dist/index.js
// Original module: server/gto/gtoBudgetPoolingEngine.ts
// Lines: 99

function calculateBudgetPoolAllocation(totalDailyBudget, ventureSpentToday, ventureSalesToday, corePerformanceScore, ventureSuccessRate) {
  let ventureRatio = DEFAULT_VENTURE_RATIO;
  if (ventureSuccessRate > 0.3) {
    ventureRatio = Math.min(MAX_VENTURE_RATIO, DEFAULT_VENTURE_RATIO + ventureSuccessRate * 0.1);
  } else if (ventureSuccessRate < 0.1 && corePerformanceScore > 0.7) {
    ventureRatio = Math.max(MIN_VENTURE_RATIO, DEFAULT_VENTURE_RATIO - 0.05);
  }
  const coreRatio = 1 - ventureRatio;
  const corePoolBudget = totalDailyBudget * coreRatio;
  const venturePoolBudget = totalDailyBudget * ventureRatio;
  const venturePoolLossRate = venturePoolBudget > 0 ? Math.max(0, (ventureSpentToday - ventureSalesToday) / venturePoolBudget) : 0;
  let circuitBreakerTriggered = false;
  let circuitBreakerReason = "";
  if (venturePoolLossRate >= CIRCUIT_BREAKER_LOSS_RATE) {
    circuitBreakerTriggered = true;
    circuitBreakerReason = `\u63A2\u7D22\u6C60\u5F53\u65E5\u4E8F\u635F\u7387${(venturePoolLossRate * 100).toFixed(0)}%\u8FBE\u5230\u7194\u65AD\u9608\u503C${(CIRCUIT_BREAKER_LOSS_RATE * 100).toFixed(0)}%\uFF0C\u6682\u505C\u6240\u6709\u63A2\u7D22\u6027\u6295\u5165`;
  } else if (ventureSpentToday >= venturePoolBudget * CIRCUIT_BREAKER_SPEND_RATE) {
    circuitBreakerTriggered = true;
    circuitBreakerReason = `\u63A2\u7D22\u6C60\u5F53\u65E5\u82B1\u8D39$${ventureSpentToday.toFixed(2)}\u5DF2\u8FBE\u9884\u7B97${(CIRCUIT_BREAKER_SPEND_RATE * 100).toFixed(0)}%\u4E0A\u9650$${(venturePoolBudget * CIRCUIT_BREAKER_SPEND_RATE).toFixed(2)}\uFF0C\u6682\u505C\u63A2\u7D22\u6027\u6295\u5165`;
  }
  return {
    corePoolBudget,
    venturePoolBudget,
    corePoolRatio: coreRatio,
    venturePoolRatio: ventureRatio,
    circuitBreakerTriggered,
    circuitBreakerReason,
    venturePoolSpentToday: ventureSpentToday,
    venturePoolLossRate
  };
}
function assignBudgetPool(target, classification, poolAllocation, totalKeywordsInPool) {
  if (classification === "value") {
    const perKeywordBudget = totalKeywordsInPool > 0 ? poolAllocation.corePoolBudget / totalKeywordsInPool : poolAllocation.corePoolBudget;
    return {
      pool: "core",
      budgetCap: perKeywordBudget,
      budgetModifier: 1,
      // 核心池不做额外修正
      isFrozen: false,
      reasoning: `\u4EF7\u503C\u578B\u5173\u952E\u8BCD\uFF0C\u5206\u914D\u81F3\u6838\u5FC3\u8D44\u4EA7\u6C60(${(poolAllocation.corePoolRatio * 100).toFixed(0)}%)`
    };
  }
  if (classification === "drawing" || classification === "cold_start") {
    if (poolAllocation.circuitBreakerTriggered) {
      return {
        pool: "venture",
        budgetCap: 0,
        budgetModifier: 0,
        // 熔断时完全暂停
        isFrozen: true,
        reasoning: `[\u7194\u65AD] ${poolAllocation.circuitBreakerReason}`
      };
    }
    const perKeywordBudget = totalKeywordsInPool > 0 ? poolAllocation.venturePoolBudget / totalKeywordsInPool : poolAllocation.venturePoolBudget;
    const remainingBudgetRatio = poolAllocation.venturePoolBudget > 0 ? Math.max(0, 1 - poolAllocation.venturePoolSpentToday / poolAllocation.venturePoolBudget) : 0;
    const budgetModifier = 0.5 + remainingBudgetRatio * 0.5;
    return {
      pool: "venture",
      budgetCap: perKeywordBudget,
      budgetModifier,
      isFrozen: false,
      reasoning: `${classification === "drawing" ? "\u542C\u724C\u578B" : "\u51B7\u542F\u52A8\u578B"}\u5173\u952E\u8BCD\uFF0C\u5206\u914D\u81F3\u63A2\u7D22\u98CE\u9669\u6C60(${(poolAllocation.venturePoolRatio * 100).toFixed(0)}%)\uFF0C\u5269\u4F59\u9884\u7B97${(remainingBudgetRatio * 100).toFixed(0)}%\uFF0C\u4FEE\u6B63\u7CFB\u6570${budgetModifier.toFixed(2)}`
    };
  }
  return {
    pool: "venture",
    budgetCap: 0,
    budgetModifier: 0.5,
    // 死牌型大幅降低
    isFrozen: false,
    reasoning: `\u6B7B\u724C\u578B\u5173\u952E\u8BCD\uFF0C\u4E0D\u5206\u914D\u989D\u5916\u9884\u7B97\uFF0C\u51FA\u4EF7\u5927\u5E45\u964D\u4F4E`
  };
}
function calculateVentureSuccessRate(totalExploredKeywords, graduatedKeywords) {
  if (totalExploredKeywords <= 0) return 0.15;
  return Math.min(1, graduatedKeywords / totalExploredKeywords);
}
function calculateCorePerformanceScore(corePoolRoas, targetRoas) {
  if (targetRoas <= 0) return 0.5;
  const ratio = corePoolRoas / targetRoas;
  return Math.min(1, Math.max(0, ratio));
}
var DEFAULT_VENTURE_RATIO, CIRCUIT_BREAKER_LOSS_RATE, CIRCUIT_BREAKER_SPEND_RATE, MIN_VENTURE_RATIO, MAX_VENTURE_RATIO;
var init_gtoBudgetPoolingEngine = __esm({
  "server/gto/gtoBudgetPoolingEngine.ts"() {
    "use strict";
    DEFAULT_VENTURE_RATIO = 0.2;
    CIRCUIT_BREAKER_LOSS_RATE = 0.3;
    CIRCUIT_BREAKER_SPEND_RATE = 0.8;
    MIN_VENTURE_RATIO = 0.1;
    MAX_VENTURE_RATIO = 0.3;
    __name(calculateBudgetPoolAllocation, "calculateBudgetPoolAllocation");
    __name(assignBudgetPool, "assignBudgetPool");
    __name(calculateVentureSuccessRate, "calculateVentureSuccessRate");
    __name(calculateCorePerformanceScore, "calculateCorePerformanceScore");
  }
});

