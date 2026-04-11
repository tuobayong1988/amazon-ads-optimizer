// Extracted from production dist/index.js
// Original module: server/gto/gtoIntegrationOrchestrator.ts
// Lines: 245

function calculateGTOModifier(target, groupConfig, context, portfolioAnalysis, competitionProfile) {
  const evAnalysis = calculateEV(target, groupConfig);
  let evModifier = 1;
  if (evAnalysis.action === "raise") {
    evModifier = Math.min(1.25, evAnalysis.suggestedBid / Math.max(0.02, target.currentBid));
  } else if (evAnalysis.action === "fold") {
    evModifier = Math.max(0.65, evAnalysis.suggestedBid / Math.max(0.02, target.currentBid));
  }
  const pulseCount = context.pulseHistory.get(target.id) || 0;
  const explorationDecision = analyzeExploration(target, groupConfig, pulseCount);
  const explorationModifier = explorationDecision.pulseModifier;
  const ventureSuccessRate = calculateVentureSuccessRate(
    context.totalExploredKeywords,
    context.graduatedKeywords
  );
  const corePerformanceScore = calculateCorePerformanceScore(
    context.corePoolRoas,
    context.targetRoas
  );
  const poolAllocation = calculateBudgetPoolAllocation(
    context.totalDailyBudget,
    context.ventureSpentToday,
    context.ventureSalesToday,
    corePerformanceScore,
    ventureSuccessRate
  );
  const budgetDecision = assignBudgetPool(
    target,
    explorationDecision.classification,
    poolAllocation,
    Math.max(1, Math.round(context.totalExploredKeywords * 0.3))
  );
  const budgetModifier = budgetDecision.isFrozen ? 0.6 : budgetDecision.budgetModifier;
  const windowResult = detectOpportunityWindow(
    context.currentHour,
    target.clicks > 0 ? target.spend / target.clicks : target.currentBid,
    target.impressions,
    context.hourlySignals,
    competitionProfile
  );
  const windowModifier = windowResult.isOpen ? windowResult.strikeModifier : 1;
  const roleAssignment = assignKeywordRole(target, groupConfig, portfolioAnalysis);
  const portfolioModifier = roleAssignment.portfolioModifier;
  const competitionModifier = competitionProfile.bidStrategyModifier;
  const weightedSum = ENGINE_WEIGHTS.ev * evModifier + ENGINE_WEIGHTS.exploration * explorationModifier + ENGINE_WEIGHTS.budget * budgetModifier + ENGINE_WEIGHTS.window * windowModifier + ENGINE_WEIGHTS.portfolio * portfolioModifier + ENGINE_WEIGHTS.competition * competitionModifier;
  const compositeModifier = Math.max(GTO_MIN_MODIFIER, Math.min(GTO_MAX_MODIFIER, weightedSum));
  const reasoning = `GTO\u4FEE\u6B63=${compositeModifier.toFixed(3)} [EV:${evModifier.toFixed(2)}(${evAnalysis.action}) \u63A2\u7D22:${explorationModifier.toFixed(2)}(${explorationDecision.classification}) \u9884\u7B97:${budgetModifier.toFixed(2)}(${budgetDecision.pool}) \u7A97\u53E3:${windowModifier.toFixed(2)}(${windowResult.windowType}) \u7EC4\u5408:${portfolioModifier.toFixed(2)}(${roleAssignment.role}) \u7ADE\u4E89:${competitionModifier.toFixed(2)}(${competitionProfile.dominantCompetitorType})]`;
  return {
    compositeModifier,
    breakdown: {
      evModifier,
      explorationModifier,
      budgetModifier,
      windowModifier,
      portfolioModifier,
      competitionModifier
    },
    decisions: {
      ev: evAnalysis,
      exploration: explorationDecision,
      budget: budgetDecision,
      window: windowResult,
      portfolio: roleAssignment,
      competition: competitionProfile
    },
    reasoning
  };
}
function batchCalculateGTOModifiers(targets, groupConfig, context) {
  const results = /* @__PURE__ */ new Map();
  if (targets.length === 0) return results;
  const portfolioAnalysis = analyzePortfolio(targets, groupConfig);
  const groupCpc = targets.reduce((sum2, t2) => sum2 + (t2.clicks > 0 ? t2.spend / t2.clicks : 0), 0) / Math.max(1, targets.length);
  const groupImpressions = targets.reduce((sum2, t2) => sum2 + t2.impressions, 0);
  const competitionProfile = buildSyncCompetitionProfile(groupCpc, groupImpressions, context.currentHour);
  for (const target of targets) {
    try {
      const modifier = calculateGTOModifier(
        target,
        groupConfig,
        context,
        portfolioAnalysis,
        competitionProfile
      );
      results.set(target.id, modifier);
    } catch (err) {
      log52.warn(`[GTO] \u8BA1\u7B97\u4FEE\u6B63\u7CFB\u6570\u5931\u8D25(target=${target.id}): ${err.message}`);
      results.set(target.id, buildNeutralModifier(target, competitionProfile));
    }
  }
  const modifiers = Array.from(results.values());
  const avgModifier = modifiers.reduce((s, m) => s + m.compositeModifier, 0) / Math.max(1, modifiers.length);
  const raises = modifiers.filter((m) => m.compositeModifier > 1.05).length;
  const folds = modifiers.filter((m) => m.compositeModifier < 0.95).length;
  const holds = modifiers.length - raises - folds;
  log52.info(`[GTO] \u6279\u91CF\u4FEE\u6B63\u5B8C\u6210: ${targets.length}\u4E2A\u76EE\u6807, \u5E73\u5747\u4FEE\u6B63=${avgModifier.toFixed(3)}, \u52A0\u6CE8=${raises}, \u5F03\u724C=${folds}, \u7EF4\u6301=${holds}, \u7EC4\u5408\u5065\u5EB7\u5EA6=${portfolioAnalysis.portfolioHealthScore}/100`);
  if (portfolioAnalysis.imbalanceWarnings.length > 0) {
    log52.warn(`[GTO] \u7EC4\u5408\u5931\u8861\u8B66\u544A: ${portfolioAnalysis.imbalanceWarnings.join("; ")}`);
  }
  return results;
}
function buildNeutralModifier(target, competition) {
  const neutralEV = {
    expectedValue: 0,
    evPerClick: 0,
    evOptimalBid: target.currentBid,
    breakEvenBid: target.currentBid,
    bidEfficiency: 1,
    impliedOddsPremium: 0,
    action: "call",
    suggestedBid: target.currentBid,
    confidence: 0.1,
    reasoning: "GTO\u8BA1\u7B97\u5931\u8D25\uFF0C\u4F7F\u7528\u4E2D\u6027\u4FEE\u6B63"
  };
  const neutralExploration = {
    classification: "cold_start",
    shouldPulse: false,
    pulseModifier: 1,
    explorationBudgetShare: 0,
    remainingPulses: 0,
    phase: "probe",
    suggestedBid: target.currentBid,
    confidence: 0.1,
    reasoning: "\u4E2D\u6027\u4FEE\u6B63"
  };
  const neutralBudget = {
    pool: "core",
    budgetCap: 0,
    budgetModifier: 1,
    isFrozen: false,
    reasoning: "\u4E2D\u6027\u4FEE\u6B63"
  };
  const neutralWindow = {
    isOpen: false,
    windowType: "none",
    strikeModifier: 1,
    estimatedDurationHours: 0,
    confidence: 0,
    reasoning: "\u4E2D\u6027\u4FEE\u6B63"
  };
  const neutralPortfolio = {
    keywordId: target.id,
    role: "new_explorer",
    roleConfidence: 0.1,
    portfolioModifier: 1,
    reasoning: "\u4E2D\u6027\u4FEE\u6B63"
  };
  return {
    compositeModifier: 1,
    breakdown: {
      evModifier: 1,
      explorationModifier: 1,
      budgetModifier: 1,
      windowModifier: 1,
      portfolioModifier: 1,
      competitionModifier: 1
    },
    decisions: {
      ev: neutralEV,
      exploration: neutralExploration,
      budget: neutralBudget,
      window: neutralWindow,
      portfolio: neutralPortfolio,
      competition
    },
    reasoning: "GTO\u8BA1\u7B97\u5931\u8D25\uFF0C\u4F7F\u7528\u4E2D\u6027\u4FEE\u6B63(1.0)"
  };
}
function buildSyncCompetitionProfile(avgCpc, totalImpressions, currentHour) {
  let dominantType = "unknown";
  let bidModifier = 1;
  let reasoning = "";
  if (avgCpc > 2 && totalImpressions > 1e4) {
    dominantType = "maniac";
    bidModifier = 0.9;
    reasoning = `\u9AD8CPC($${avgCpc.toFixed(2)})+\u9AD8\u66DD\u5149(${totalImpressions}): \u75AF\u72C2\u578B\u7ADE\u4E89\u73AF\u5883\uFF0C\u6536\u7F2910%`;
  } else if (avgCpc > 1.5 && totalImpressions < 5e3) {
    dominantType = "nit";
    bidModifier = 1.05;
    reasoning = `\u9AD8CPC($${avgCpc.toFixed(2)})+\u4F4E\u66DD\u5149(${totalImpressions}): \u7D27\u7F29\u578B\u7ADE\u4E89\uFF0C\u52A0\u538B5%`;
  } else if (avgCpc < 0.5 && totalImpressions > 1e4) {
    dominantType = "calling_station";
    bidModifier = 1.1;
    reasoning = `\u4F4ECPC($${avgCpc.toFixed(2)})+\u9AD8\u66DD\u5149(${totalImpressions}): \u88AB\u52A8\u578B\u7ADE\u4E89\uFF0C\u6269\u5F2010%`;
  } else {
    dominantType = "unknown";
    bidModifier = 1;
    reasoning = `CPC=$${avgCpc.toFixed(2)}, \u66DD\u5149=${totalImpressions}: \u7ADE\u4E89\u73AF\u5883\u4E2D\u6027`;
  }
  const isPeakHour = currentHour >= 8 && currentHour <= 12 || currentHour >= 19 && currentHour <= 23;
  if (!isPeakHour) {
    bidModifier *= 1.03;
    reasoning += " | \u975E\u9AD8\u5CF0\u65F6\u6BB5+3%";
  }
  return {
    dominantCompetitorType: dominantType,
    competitionIntensity: avgCpc > 1.5 ? 0.8 : avgCpc > 0.8 ? 0.5 : 0.2,
    cpcVolatility: 0.3,
    // 默认中等波动
    impressionConcentration: 0.5,
    // 默认中等集中度
    weakCompetitionHours: [2, 3, 4, 5, 6],
    // 默认凌晨为低竞争时段
    peakCompetitionHours: [10, 11, 20, 21],
    // 默认上午和晚间为高竞争
    bidStrategyModifier: Math.round(bidModifier * 100) / 100,
    confidence: 0.4,
    // 同步版本置信度较低
    reasoning
  };
}
var log52, ENGINE_WEIGHTS, GTO_MIN_MODIFIER, GTO_MAX_MODIFIER;
var init_gtoIntegrationOrchestrator = __esm({
  "server/gto/gtoIntegrationOrchestrator.ts"() {
    "use strict";
    init_gtoDynamicEVEngine();
    init_gtoExploratoryInvestmentEngine();
    init_gtoBudgetPoolingEngine();
    init_gtoOpportunityWindowEngine();
    init_gtoKeywordPortfolioBalancer();
    init_logger();
    log52 = createModuleLogger("GTO");
    ENGINE_WEIGHTS = {
      ev: 0.25,
      // EV引擎权重最高 — 直接影响盈亏
      exploration: 0.15,
      // 探索引擎 — 关键词生命周期管理
      budget: 0.15,
      // 预算引擎 — 资金安全
      window: 0.15,
      // 窗口引擎 — 时机把握
      portfolio: 0.15,
      // 组合引擎 — 结构平衡
      competition: 0.15
      // 竞争引擎 — 环境适应
    };
    GTO_MIN_MODIFIER = 0.80; // v608: tighten to ±20% consistent with safety limits
    GTO_MAX_MODIFIER = 1.20; // v608: tighten to ±20% consistent with safety limits
    __name(calculateGTOModifier, "calculateGTOModifier");
    __name(batchCalculateGTOModifiers, "batchCalculateGTOModifiers");
    __name(buildNeutralModifier, "buildNeutralModifier");
    __name(buildSyncCompetitionProfile, "buildSyncCompetitionProfile");
  }
});

