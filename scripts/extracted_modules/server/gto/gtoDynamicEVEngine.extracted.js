// Extracted from production dist/index.js
// Original module: server/gto/gtoDynamicEVEngine.ts
// Lines: 105

function calculateEV(target, groupConfig) {
  const { currentBid, impressions, clicks, spend, sales, orders } = target;
  if (clicks < MIN_CLICKS_FOR_ANALYSIS || impressions < MIN_IMPRESSIONS_FOR_ANALYSIS) {
    return buildConservativeAnalysis(target, groupConfig, "\u6570\u636E\u4E0D\u8DB3\uFF0C\u91C7\u7528\u4FDD\u5B88\u7B56\u7565");
  }
  const ctr = impressions > 0 ? clicks / impressions : 0;
  const cvr = clicks > 0 ? orders / clicks : 0;
  const aov = orders > 0 ? sales / orders : groupConfig.groupAvgAov || 25;
  const cpc = clicks > 0 ? spend / clicks : currentBid;
  const acos = sales > 0 ? spend / sales : Infinity;
  const effectiveCvr = clicks >= 10 ? cvr : (groupConfig.groupAvgCvr || 0.05) * 0.3 + cvr * 0.7;
  const estimatedCPA = effectiveCvr > 0 ? cpc / effectiveCvr : cpc * 20;
  const evPerClick = effectiveCvr * (aov - estimatedCPA) - (1 - effectiveCvr) * cpc;
  const expectedValue = evPerClick * clicks;
  const targetAcosDecimal = (groupConfig.targetAcos || 30) > 1 ? (groupConfig.targetAcos || 30) / 100 : groupConfig.targetAcos || 0.3;
  const breakEvenBid = effectiveCvr * aov * targetAcosDecimal;
  const impliedOddsPremium = calculateImpliedOddsPremium(target, groupConfig, effectiveCvr);
  const adjustedBreakEvenBid = breakEvenBid * (1 + impliedOddsPremium);
  const bidEfficiency = adjustedBreakEvenBid > 0 ? currentBid / adjustedBreakEvenBid : 2;
  const evRatio = currentBid > 0 ? evPerClick / currentBid : 0;
  let action;
  let suggestedBid;
  let reasoning;
  if (evRatio > EV_RAISE_THRESHOLD && currentBid < adjustedBreakEvenBid * 0.85) {
    action = "raise";
    suggestedBid = Math.min(adjustedBreakEvenBid * 0.8, currentBid * 1.25);
    reasoning = `EV\u6B63\u5411(${evPerClick.toFixed(3)}/click)\uFF0C\u51FA\u4EF7\u6548\u7387${(bidEfficiency * 100).toFixed(0)}%\uFF0C\u4F4E\u4E8EbreakEven($${adjustedBreakEvenBid.toFixed(2)})\uFF0C\u5EFA\u8BAE\u52A0\u6CE8\u81F3$${suggestedBid.toFixed(2)}`;
  } else if (evRatio < EV_FOLD_THRESHOLD && bidEfficiency > 1.3) {
    action = "fold";
    suggestedBid = Math.max(0.02, adjustedBreakEvenBid * 0.6);
    reasoning = `EV\u8D1F\u5411(${evPerClick.toFixed(3)}/click)\uFF0C\u51FA\u4EF7\u6548\u7387${(bidEfficiency * 100).toFixed(0)}%\uFF0C\u8D85\u8FC7breakEven($${adjustedBreakEvenBid.toFixed(2)})\uFF0C\u5EFA\u8BAE\u964D\u81F3$${suggestedBid.toFixed(2)}`;
  } else {
    action = "call";
    suggestedBid = currentBid;
    reasoning = `EV\u4E2D\u6027(${evPerClick.toFixed(3)}/click)\uFF0C\u51FA\u4EF7\u6548\u7387${(bidEfficiency * 100).toFixed(0)}%\uFF0C\u63A5\u8FD1breakEven($${adjustedBreakEvenBid.toFixed(2)})\uFF0C\u7EF4\u6301\u5F53\u524D\u51FA\u4EF7`;
  }
  suggestedBid = Math.max(0.02, Math.round(suggestedBid * 100) / 100);
  const confidence = Math.min(0.9, Math.sqrt(clicks / 100) * 0.6 + (cvr > 0 ? 0.3 : 0));
  return {
    expectedValue,
    evPerClick,
    evOptimalBid: adjustedBreakEvenBid * 0.75,
    breakEvenBid: adjustedBreakEvenBid,
    bidEfficiency,
    impliedOddsPremium,
    action,
    suggestedBid,
    confidence,
    reasoning
  };
}
function calculateImpliedOddsPremium(target, config2, effectiveCvr) {
  let premium = 0;
  if (effectiveCvr > 0.1 && target.clicks >= 20) {
    premium += IMPLIED_ODDS_HIGH_CVR_PREMIUM;
  }
  if (target.clicks < 10 && target.impressions > 100) {
    premium += IMPLIED_ODDS_NEW_KEYWORD_PREMIUM;
  }
  if (target.matchType === "exact") {
    premium += 0.05;
  }
  if (config2.strategyTemplate === "aggressive-growth") {
    premium += 0.1;
  } else if (config2.strategyTemplate === "profit-maximize") {
    premium -= 0.05;
  }
  return Math.min(0.3, Math.max(0, premium));
}
function buildConservativeAnalysis(target, config2, reason) {
  const targetAcosDecimal = (config2.targetAcos || 30) > 1 ? (config2.targetAcos || 30) / 100 : config2.targetAcos || 0.3;
  const estimatedCvr = config2.groupAvgCvr || 0.05;
  const estimatedAov = config2.groupAvgAov || 25;
  const conservativeBreakEven = estimatedCvr * estimatedAov * targetAcosDecimal;
  return {
    expectedValue: 0,
    evPerClick: 0,
    evOptimalBid: conservativeBreakEven * 0.6,
    breakEvenBid: conservativeBreakEven,
    bidEfficiency: target.currentBid > 0 ? target.currentBid / conservativeBreakEven : 1,
    impliedOddsPremium: IMPLIED_ODDS_NEW_KEYWORD_PREMIUM,
    // 新词给予探索溢价
    action: "call",
    suggestedBid: target.currentBid,
    // 数据不足时维持现状
    confidence: 0.1,
    reasoning: `[\u4FDD\u5B88\u6A21\u5F0F] ${reason}\uFF0C\u4F7F\u7528\u7EC4\u7EA7\u522B\u5148\u9A8C(CVR=${(estimatedCvr * 100).toFixed(1)}%, AOV=$${estimatedAov.toFixed(0)})`
  };
}
var MIN_CLICKS_FOR_ANALYSIS, MIN_IMPRESSIONS_FOR_ANALYSIS, IMPLIED_ODDS_HIGH_CVR_PREMIUM, IMPLIED_ODDS_NEW_KEYWORD_PREMIUM, EV_RAISE_THRESHOLD, EV_FOLD_THRESHOLD;
var init_gtoDynamicEVEngine = __esm({
  "server/gto/gtoDynamicEVEngine.ts"() {
    "use strict";
    MIN_CLICKS_FOR_ANALYSIS = 3;
    MIN_IMPRESSIONS_FOR_ANALYSIS = 50;
    IMPLIED_ODDS_HIGH_CVR_PREMIUM = 0.1;
    IMPLIED_ODDS_NEW_KEYWORD_PREMIUM = 0.2;
    EV_RAISE_THRESHOLD = 0.15;
    EV_FOLD_THRESHOLD = -0.2;
    __name(calculateEV, "calculateEV");
    __name(calculateImpliedOddsPremium, "calculateImpliedOddsPremium");
    __name(buildConservativeAnalysis, "buildConservativeAnalysis");
  }
});

