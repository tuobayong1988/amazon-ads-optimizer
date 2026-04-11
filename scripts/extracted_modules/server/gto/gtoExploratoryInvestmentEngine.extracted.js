// Extracted from production dist/index.js
// Original module: server/gto/gtoExploratoryInvestmentEngine.ts
// Lines: 121

function analyzeExploration(target, groupConfig, historicalPulseCount = 0) {
  const { currentBid, impressions, clicks, orders, sales, spend } = target;
  const classification = classifyKeyword(target);
  switch (classification) {
    case "value":
      return buildValueDecision(target, groupConfig);
    case "drawing":
      return buildDrawingDecision(target, groupConfig, historicalPulseCount);
    case "cold_start":
      return buildColdStartDecision(target, groupConfig);
    case "dead":
      return buildDeadDecision(target, groupConfig, historicalPulseCount);
  }
}
function classifyKeyword(target) {
  const { impressions, clicks, orders } = target;
  if (orders >= VALUE_MIN_ORDERS) {
    return "value";
  }
  if (clicks >= DEAD_MIN_CLICKS && orders === 0) {
    return "dead";
  }
  if (clicks >= DRAWING_MIN_CLICKS && impressions >= DRAWING_MIN_IMPRESSIONS && orders === 0) {
    return "drawing";
  }
  return "cold_start";
}
function buildValueDecision(target, config2) {
  return {
    classification: "value",
    shouldPulse: false,
    pulseModifier: 1,
    explorationBudgetShare: 0,
    remainingPulses: 0,
    phase: "graduate",
    suggestedBid: target.currentBid,
    confidence: 0.8,
    reasoning: `\u4EF7\u503C\u578B\u5173\u952E\u8BCD(${target.orders}\u5355, $${target.sales.toFixed(2)}\u9500\u552E)\uFF0C\u5DF2\u6BD5\u4E1A\uFF0C\u4EA4\u7531\u5E38\u89C4\u4F18\u5316\u5F15\u64CE\u5904\u7406`
  };
}
function buildDrawingDecision(target, config2, pulseCount) {
  const remainingPulses = Math.max(0, MAX_PULSE_ATTEMPTS - pulseCount);
  if (remainingPulses <= 0) {
    return {
      classification: "drawing",
      shouldPulse: false,
      pulseModifier: 0.7,
      explorationBudgetShare: 0,
      remainingPulses: 0,
      phase: "abandon",
      suggestedBid: Math.max(0.02, target.currentBid * 0.7),
      confidence: 0.7,
      reasoning: `\u542C\u724C\u578B\u5173\u952E\u8BCD\u5DF2\u5B8C\u6210${MAX_PULSE_ATTEMPTS}\u6B21\u8109\u51B2\u63A2\u7D22\u4ECD\u65E0\u8F6C\u5316\uFF0C\u5224\u5B9A\u4E3A\u8BC8\u552C\u5931\u8D25\uFF0C\u964D\u4EF730%`
    };
  }
  const pulseBid = Math.round(target.currentBid * (1 + PULSE_BID_INCREASE) * 100) / 100;
  const ctr = target.impressions > 0 ? target.clicks / target.impressions : 0;
  const ctrScore = Math.min(1, ctr / 0.01);
  const adjustedPulseModifier = 1 + PULSE_BID_INCREASE * (0.5 + ctrScore * 0.5);
  const phase = pulseCount === 0 ? "probe" : "confirm";
  return {
    classification: "drawing",
    shouldPulse: true,
    pulseModifier: adjustedPulseModifier,
    explorationBudgetShare: Math.min(MAX_EXPLORATION_SHARE, ctrScore * 0.15),
    remainingPulses,
    phase,
    suggestedBid: Math.round(target.currentBid * adjustedPulseModifier * 100) / 100,
    confidence: 0.5 + ctrScore * 0.2,
    reasoning: `\u542C\u724C\u578B\u5173\u952E\u8BCD(${target.clicks}\u6B21\u70B9\u51FB, CTR=${(ctr * 100).toFixed(2)}%)\uFF0C\u7B2C${pulseCount + 1}/${MAX_PULSE_ATTEMPTS}\u6B21\u8109\u51B2\u63A2\u7D22\uFF0C\u51FA\u4EF7\u63D0\u5347${((adjustedPulseModifier - 1) * 100).toFixed(0)}%\u81F3$${(target.currentBid * adjustedPulseModifier).toFixed(2)}`
  };
}
function buildColdStartDecision(target, config2) {
  return {
    classification: "cold_start",
    shouldPulse: false,
    pulseModifier: 1,
    explorationBudgetShare: 0.05,
    remainingPulses: MAX_PULSE_ATTEMPTS,
    phase: "probe",
    suggestedBid: target.currentBid,
    confidence: 0.2,
    reasoning: `\u51B7\u542F\u52A8\u5173\u952E\u8BCD(${target.clicks}\u6B21\u70B9\u51FB, ${target.impressions}\u6B21\u66DD\u5149)\uFF0C\u6570\u636E\u4E0D\u8DB3\u4EE5\u505A\u51FA\u5224\u65AD\uFF0C\u4FDD\u6301\u5F53\u524D\u51FA\u4EF7$${target.currentBid.toFixed(2)}\u7B49\u5F85\u6570\u636E\u79EF\u7D2F`
  };
}
function buildDeadDecision(target, config2, pulseCount) {
  const reductionFactor = 1 - DEAD_BID_REDUCTION;
  const newBid = Math.max(0.02, Math.round(target.currentBid * reductionFactor * 100) / 100);
  return {
    classification: "dead",
    shouldPulse: false,
    pulseModifier: reductionFactor,
    explorationBudgetShare: 0,
    remainingPulses: 0,
    phase: "abandon",
    suggestedBid: newBid,
    confidence: 0.8,
    reasoning: `\u6B7B\u724C\u578B\u5173\u952E\u8BCD(${target.clicks}\u6B21\u70B9\u51FB, 0\u8F6C\u5316, \u82B1\u8D39$${target.spend.toFixed(2)})\uFF0C\u957F\u671F\u65E0\u8F6C\u5316\uFF0C\u964D\u4EF7${(DEAD_BID_REDUCTION * 100).toFixed(0)}%\u81F3$${newBid.toFixed(2)}`
  };
}
var VALUE_MIN_ORDERS, DRAWING_MIN_CLICKS, DRAWING_MIN_IMPRESSIONS, DEAD_MIN_CLICKS, MAX_PULSE_ATTEMPTS, PULSE_BID_INCREASE, DEAD_BID_REDUCTION, MAX_EXPLORATION_SHARE;
var init_gtoExploratoryInvestmentEngine = __esm({
  "server/gto/gtoExploratoryInvestmentEngine.ts"() {
    "use strict";
    VALUE_MIN_ORDERS = 1;
    DRAWING_MIN_CLICKS = 5;
    DRAWING_MIN_IMPRESSIONS = 100;
    DEAD_MIN_CLICKS = 20;
    MAX_PULSE_ATTEMPTS = 5;
    PULSE_BID_INCREASE = 0.15;
    DEAD_BID_REDUCTION = 0.4;
    MAX_EXPLORATION_SHARE = 0.2;
    __name(analyzeExploration, "analyzeExploration");
    __name(classifyKeyword, "classifyKeyword");
    __name(buildValueDecision, "buildValueDecision");
    __name(buildDrawingDecision, "buildDrawingDecision");
    __name(buildColdStartDecision, "buildColdStartDecision");
    __name(buildDeadDecision, "buildDeadDecision");
  }
});

