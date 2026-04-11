// Extracted from production dist/index.js
// Original module: server/gto/gtoKeywordPortfolioBalancer.ts
// Lines: 171

function classifyKeywordRole(target, config2) {
  const { impressions, clicks, orders, sales, spend } = target;
  const cvr = clicks > 0 ? orders / clicks : 0;
  const roas = spend > 0 ? sales / spend : 0;
  if (clicks < 5 && impressions < 100) {
    return "new_explorer";
  }
  if (roas >= PROFIT_CORE_MIN_ROAS && orders >= PROFIT_CORE_MIN_ORDERS) {
    return "profit_core";
  }
  if (impressions >= TRAFFIC_DRIVER_MIN_IMPRESSIONS && cvr < TRAFFIC_DRIVER_MAX_CVR) {
    return "traffic_driver";
  }
  if (cvr >= LONG_TAIL_MIN_CVR && impressions < LONG_TAIL_MAX_IMPRESSIONS) {
    return "long_tail";
  }
  if (target.matchType === "exact" && orders >= 1 && roas >= 2) {
    return "brand_defense";
  }
  if (orders >= 1) {
    return "long_tail";
  }
  return "traffic_driver";
}
function analyzePortfolio(targets, config2) {
  if (targets.length === 0) {
    return buildEmptyPortfolio();
  }
  const roleAssignments = /* @__PURE__ */ new Map();
  const roleDistribution = {
    profit_core: 0,
    traffic_driver: 0,
    long_tail: 0,
    brand_defense: 0,
    new_explorer: 0
  };
  const roleSpend = {
    profit_core: 0,
    traffic_driver: 0,
    long_tail: 0,
    brand_defense: 0,
    new_explorer: 0
  };
  const roleSales = {
    profit_core: 0,
    traffic_driver: 0,
    long_tail: 0,
    brand_defense: 0,
    new_explorer: 0
  };
  for (const target of targets) {
    const role = classifyKeywordRole(target, config2);
    roleAssignments.set(target.id, role);
    roleDistribution[role]++;
    roleSpend[role] += target.spend;
    roleSales[role] += target.sales;
  }
  const totalSpend = Object.values(roleSpend).reduce((a, b) => a + b, 0);
  const totalSales = Object.values(roleSales).reduce((a, b) => a + b, 0);
  const spendDistribution = {};
  const salesDistribution = {};
  for (const role of Object.keys(roleDistribution)) {
    spendDistribution[role] = totalSpend > 0 ? roleSpend[role] / totalSpend : 0;
    salesDistribution[role] = totalSales > 0 ? roleSales[role] / totalSales : 0;
  }
  const imbalanceWarnings = [];
  let healthScore = 100;
  for (const [role, ideal] of Object.entries(IDEAL_SPEND_DISTRIBUTION)) {
    const actual = spendDistribution[role] || 0;
    if (actual < ideal.min) {
      const deficit = ideal.min - actual;
      imbalanceWarnings.push(
        `${getRoleLabel(role)}\u82B1\u8D39\u5360\u6BD4${(actual * 100).toFixed(0)}%\u4F4E\u4E8E\u6700\u4F4E\u9608\u503C${(ideal.min * 100).toFixed(0)}%\uFF0C\u5EFA\u8BAE\u589E\u52A0\u6295\u5165`
      );
      healthScore -= Math.round(deficit * 200);
    } else if (actual > ideal.max) {
      const excess = actual - ideal.max;
      imbalanceWarnings.push(
        `${getRoleLabel(role)}\u82B1\u8D39\u5360\u6BD4${(actual * 100).toFixed(0)}%\u8D85\u8FC7\u6700\u9AD8\u9608\u503C${(ideal.max * 100).toFixed(0)}%\uFF0C\u5EFA\u8BAE\u5206\u6563\u6295\u5165`
      );
      healthScore -= Math.round(excess * 150);
    }
  }
  healthScore = Math.max(0, Math.min(100, healthScore));
  const roleModifiers = {};
  for (const [role, ideal] of Object.entries(IDEAL_SPEND_DISTRIBUTION)) {
    const actual = spendDistribution[role] || 0;
    if (actual < ideal.min) {
      roleModifiers[role] = Math.min(1.25, 1 + (ideal.target - actual) * 2);
    } else if (actual > ideal.max) {
      roleModifiers[role] = Math.max(0.8, 1 - (actual - ideal.target) * 1.5);
    } else {
      roleModifiers[role] = 1;
    }
  }
  const reasoning = `\u7EC4\u5408\u5065\u5EB7\u5EA6${healthScore}/100\uFF0C\u6838\u5FC3\u5229\u6DA6\u8BCD${roleDistribution.profit_core}\u4E2A(${(spendDistribution.profit_core * 100).toFixed(0)}%\u82B1\u8D39)\uFF0C\u5F15\u6D41\u6CDB\u8BCD${roleDistribution.traffic_driver}\u4E2A\uFF0C\u957F\u5C3E\u8BCD${roleDistribution.long_tail}\u4E2A\uFF0C\u54C1\u724C\u8BCD${roleDistribution.brand_defense}\u4E2A\uFF0C\u65B0\u8BCD${roleDistribution.new_explorer}\u4E2A`;
  return {
    roleDistribution,
    spendDistribution,
    salesDistribution,
    portfolioHealthScore: healthScore,
    imbalanceWarnings,
    roleModifiers,
    reasoning
  };
}
function assignKeywordRole(target, config2, portfolioAnalysis) {
  const role = classifyKeywordRole(target, config2);
  const modifier = portfolioAnalysis.roleModifiers[role] || 1;
  const cvr = target.clicks > 0 ? target.orders / target.clicks : 0;
  const roas = target.spend > 0 ? target.sales / target.spend : 0;
  const confidence = Math.min(0.9, Math.sqrt(target.clicks / 50) * 0.5 + (target.orders > 0 ? 0.3 : 0));
  return {
    keywordId: target.id,
    role,
    roleConfidence: confidence,
    portfolioModifier: modifier,
    reasoning: `${getRoleLabel(role)}(ROAS=${roas.toFixed(1)}, CVR=${(cvr * 100).toFixed(1)}%)\uFF0C\u7EC4\u5408\u4FEE\u6B63${modifier.toFixed(2)}`
  };
}
function getRoleLabel(role) {
  switch (role) {
    case "profit_core":
      return "\u6838\u5FC3\u5229\u6DA6\u8BCD";
    case "traffic_driver":
      return "\u5F15\u6D41\u6CDB\u8BCD";
    case "long_tail":
      return "\u957F\u5C3E\u8F6C\u5316\u8BCD";
    case "brand_defense":
      return "\u54C1\u724C\u9632\u5FA1\u8BCD";
    case "new_explorer":
      return "\u65B0\u8BCD\u63A2\u7D22";
  }
}
function buildEmptyPortfolio() {
  const empty = { profit_core: 0, traffic_driver: 0, long_tail: 0, brand_defense: 0, new_explorer: 0 };
  return {
    roleDistribution: { ...empty },
    spendDistribution: { ...empty },
    salesDistribution: { ...empty },
    portfolioHealthScore: 50,
    imbalanceWarnings: ["\u65E0\u5173\u952E\u8BCD\u6570\u636E\uFF0C\u65E0\u6CD5\u8BC4\u4F30\u7EC4\u5408\u5065\u5EB7\u5EA6"],
    roleModifiers: { profit_core: 1, traffic_driver: 1, long_tail: 1, brand_defense: 1, new_explorer: 1 },
    reasoning: "\u65E0\u5173\u952E\u8BCD\u6570\u636E"
  };
}
var IDEAL_SPEND_DISTRIBUTION, PROFIT_CORE_MIN_ROAS, PROFIT_CORE_MIN_ORDERS, TRAFFIC_DRIVER_MIN_IMPRESSIONS, TRAFFIC_DRIVER_MAX_CVR, LONG_TAIL_MIN_CVR, LONG_TAIL_MAX_IMPRESSIONS;
var init_gtoKeywordPortfolioBalancer = __esm({
  "server/gto/gtoKeywordPortfolioBalancer.ts"() {
    "use strict";
    IDEAL_SPEND_DISTRIBUTION = {
      profit_core: { min: 0.35, max: 0.55, target: 0.45 },
      traffic_driver: { min: 0.1, max: 0.25, target: 0.15 },
      long_tail: { min: 0.15, max: 0.3, target: 0.2 },
      brand_defense: { min: 0.05, max: 0.15, target: 0.1 },
      new_explorer: { min: 0.05, max: 0.15, target: 0.1 }
    };
    PROFIT_CORE_MIN_ROAS = 3;
    PROFIT_CORE_MIN_ORDERS = 3;
    TRAFFIC_DRIVER_MIN_IMPRESSIONS = 1e3;
    TRAFFIC_DRIVER_MAX_CVR = 0.02;
    LONG_TAIL_MIN_CVR = 0.05;
    LONG_TAIL_MAX_IMPRESSIONS = 500;
    __name(classifyKeywordRole, "classifyKeywordRole");
    __name(analyzePortfolio, "analyzePortfolio");
    __name(assignKeywordRole, "assignKeywordRole");
    __name(getRoleLabel, "getRoleLabel");
    __name(buildEmptyPortfolio, "buildEmptyPortfolio");
  }
});

