// Extracted from production dist/index.js
// Original module: server/system/systemHealthMetricsService.ts
// Lines: 366

async function calculateRollbackRate(accountId, days = 7) {
  const db = await getDb();
  if (!db) {
    return { totalAdjustments: 0, rolledBackCount: 0, rate: 0, status: "healthy", trend: "stable", previousRate: 0 };
  }
  try {
    const currentPeriodQuery = sql`
      SELECT 
        COUNT(CASE WHEN change_reason NOT LIKE '%AutoCorrector%' THEN 1 END) as total_original,
        COUNT(*) as total_all,
        SUM(CASE 
          WHEN status = 'rolled_back' 
            AND change_reason NOT LIKE '%AutoCorrector%'
            AND ABS(CAST(new_value AS DECIMAL(10,4)) - CAST(previous_value AS DECIMAL(10,4))) / NULLIF(CAST(previous_value AS DECIMAL(10,4)), 0) >= 0.15
          THEN 1 
          ELSE 0 
        END) as hard_rollback,
        SUM(CASE 
          WHEN (status = 'rolled_back' OR (change_reason LIKE '%AutoCorrector%' AND change_reason LIKE '%纠正%'))
            AND change_reason NOT LIKE '%AutoCorrector%'
          THEN 1 
          ELSE 0 
        END) as soft_rollback
      FROM optimization_events
      WHERE account_id = ${accountId}
        AND event_category = 'bid_adjustment'
        AND action_type IN ('bid_increase', 'bid_decrease')
        AND created_at > DATE_SUB(NOW(), INTERVAL ${sql.raw(String(days))} DAY)
    `;
    const currentResult = await db.execute(currentPeriodQuery);
    const currentRows = currentResult[0] || currentResult;
    const totalOriginal = Number(currentRows?.[0]?.total_original) || 0;
    const hardRollback = Number(currentRows?.[0]?.hard_rollback) || 0;
    const softRollback = Number(currentRows?.[0]?.soft_rollback) || 0;
    const total = totalOriginal;
    const rolledBack = hardRollback;
    const rate = total > 0 ? rolledBack / total * 100 : 0;
    const previousPeriodQuery = sql`
 SELECT 
 COUNT(CASE WHEN change_reason NOT LIKE '%AutoCorrector%' THEN 1 END) as total_original,
 SUM(CASE 
 WHEN status = 'rolled_back' 
 AND change_reason NOT LIKE '%AutoCorrector%'
 AND ABS(CAST(new_value AS DECIMAL(10,4)) - CAST(previous_value AS DECIMAL(10,4))) / NULLIF(CAST(previous_value AS DECIMAL(10,4)), 0) >= 0.15
 THEN 1 
 ELSE 0 
 END) as hard_rollback
 FROM optimization_events
 WHERE account_id = ${accountId}
 AND event_category = 'bid_adjustment'
 AND action_type IN ('bid_increase', 'bid_decrease')
 AND created_at > DATE_SUB(NOW(), INTERVAL ${sql.raw(String(days * 2))} DAY)
 AND created_at <= DATE_SUB(NOW(), INTERVAL ${sql.raw(String(days))} DAY)
 `;
    const previousResult = await db.execute(previousPeriodQuery);
    const previousRows = previousResult[0] || previousResult;
    const prevTotal = Number(previousRows?.[0]?.total_original) || 0;
    const prevRolledBack = Number(previousRows?.[0]?.hard_rollback) || 0;
    const previousRate = prevTotal > 0 ? prevRolledBack / prevTotal * 100 : 0;
    const trend = rate < previousRate - 2 ? "improving" : rate > previousRate + 2 ? "worsening" : "stable";
    const status = rate < 10 ? "healthy" : rate < 30 ? "warning" : "critical";
    log194.info(`[RollbackRate] v266: \u8D26\u6237${accountId} \u539F\u59CB\u8C03\u6574=${totalOriginal}, \u786C\u56DE\u6EDA=${hardRollback}, \u8F6F\u56DE\u6EDA=${softRollback}, \u771F\u6B63\u56DE\u6EDA\u7387=${rate.toFixed(1)}%`);
    return { totalAdjustments: total, rolledBackCount: rolledBack, rate: Math.round(rate * 10) / 10, status, trend, previousRate: Math.round(previousRate * 10) / 10 };
  } catch (error48) {
    log194.warn(`[RollbackRate] \u8BA1\u7B97\u5F02\u5E38: ${error48.message}`);
    return { totalAdjustments: 0, rolledBackCount: 0, rate: 0, status: "healthy", trend: "stable", previousRate: 0 };
  }
}
async function calculateAlgorithmActivation(accountId, days = 7) {
  const db = await getDb();
  if (!db) {
    return { totalDecisions: 0, algorithmCounts: {}, advancedRate: 0, status: "critical", algorithmRates: {} };
  }
  try {
    const query = sql`
 SELECT 
 change_reason,
 action_detail,
 COUNT(*) as cnt
 FROM optimization_events
 WHERE account_id = ${accountId}
 AND event_category = 'bid_adjustment'
 AND status = 'success'
 AND created_at > DATE_SUB(NOW(), INTERVAL ${sql.raw(String(days))} DAY)
 GROUP BY change_reason, action_detail
 `;
    const result = await db.execute(query);
    const rows = result[0] || result;
    const algorithmCounts = {};
    let totalDecisions = 0;
    if (Array.isArray(rows)) {
      for (const row of rows) {
        const count11 = Number(row.cnt) || 0;
        const algorithm = parseAlgorithmName(row.change_reason, row.action_detail);
        algorithmCounts[algorithm] = (algorithmCounts[algorithm] || 0) + count11;
        totalDecisions += count11;
      }
    }
    const advancedAlgorithms = ["ucb", "linucb", "sigmoid_curve", "cql", "ensemble"];
    let advancedCount = 0;
    for (const alg of advancedAlgorithms) {
      advancedCount += algorithmCounts[alg] || 0;
    }
    const advancedRate = totalDecisions > 0 ? advancedCount / totalDecisions * 100 : 0;
    const algorithmRates = {};
    for (const [alg, count11] of Object.entries(algorithmCounts)) {
      algorithmRates[alg] = totalDecisions > 0 ? Math.round(count11 / totalDecisions * 1e3) / 10 : 0;
    }
    const status = advancedRate > 30 ? "healthy" : advancedRate > 10 ? "warning" : "critical";
    return {
      totalDecisions,
      algorithmCounts,
      advancedRate: Math.round(advancedRate * 10) / 10,
      status,
      algorithmRates
    };
  } catch (error48) {
    log194.warn(`[AlgorithmActivation] \u8BA1\u7B97\u5F02\u5E38: ${error48.message}`);
    return { totalDecisions: 0, algorithmCounts: {}, advancedRate: 0, status: "critical", algorithmRates: {} };
  }
}
async function calculateAcosTrend(accountId) {
  const db = await getDb();
  if (!db) {
    return { currentAcos: 0, acos7dAgo: 0, acos14dAgo: 0, direction: "stable", changePoints: 0, deathSpiralDetected: false };
  }
  try {
    const recentQuery = sql`
 SELECT 
 SUM(spend) as total_spend,
 SUM(sales) as total_sales
 FROM daily_performance
 WHERE accountId = ${accountId}
 AND date >= DATE_SUB(CURDATE(), INTERVAL 3 DAY)
 `;
    const recentResult = await db.execute(recentQuery);
    const recentRows = recentResult[0] || recentResult;
    const recentSpend = Number(recentRows?.[0]?.total_spend) || 0;
    const recentSales = Number(recentRows?.[0]?.total_sales) || 0;
    const currentAcos = recentSales > 0 ? recentSpend / recentSales * 100 : 0;
    const week1Query = sql`
      SELECT 
        SUM(spend) as total_spend,
        SUM(sales) as total_sales
      FROM daily_performance
      WHERE accountId = ${accountId}
        AND date >= DATE_SUB(CURDATE(), INTERVAL 10 DAY)
        AND date < DATE_SUB(CURDATE(), INTERVAL 7 DAY)
    `;
    const week1Result = await db.execute(week1Query);
    const week1Rows = week1Result[0] || week1Result;
    const week1Spend = Number(week1Rows?.[0]?.total_spend) || 0;
    const week1Sales = Number(week1Rows?.[0]?.total_sales) || 0;
    const acos7dAgo = week1Sales > 0 ? week1Spend / week1Sales * 100 : 0;
    const week2Query = sql`
      SELECT 
        SUM(spend) as total_spend,
        SUM(sales) as total_sales
      FROM daily_performance
      WHERE accountId = ${accountId}
        AND date >= DATE_SUB(CURDATE(), INTERVAL 17 DAY)
        AND date < DATE_SUB(CURDATE(), INTERVAL 14 DAY)
    `;
    const week2Result = await db.execute(week2Query);
    const week2Rows = week2Result[0] || week2Result;
    const week2Spend = Number(week2Rows?.[0]?.total_spend) || 0;
    const week2Sales = Number(week2Rows?.[0]?.total_sales) || 0;
    const acos14dAgo = week2Sales > 0 ? week2Spend / week2Sales * 100 : 0;
    const changePoints = currentAcos - acos7dAgo;
    const direction = changePoints < -3 ? "improving" : changePoints > 3 ? "worsening" : "stable";
    const deathSpiralDetected = currentAcos > 50 && currentAcos > acos7dAgo && acos7dAgo > acos14dAgo;
    return {
      currentAcos: Math.round(currentAcos * 10) / 10,
      acos7dAgo: Math.round(acos7dAgo * 10) / 10,
      acos14dAgo: Math.round(acos14dAgo * 10) / 10,
      direction,
      changePoints: Math.round(changePoints * 10) / 10,
      deathSpiralDetected
    };
  } catch (error48) {
    log194.warn(`[AcosTrend] \u8BA1\u7B97\u5F02\u5E38: ${error48.message}`);
    return { currentAcos: 0, acos7dAgo: 0, acos14dAgo: 0, direction: "stable", changePoints: 0, deathSpiralDetected: false };
  }
}
async function calculateBidIncreaseAnalysis(accountId, days = 14) {
  const db = await getDb();
  if (!db) {
    return { totalIncreases: 0, avgIncreasePercent: 0, successRate: 0, byScenario: [] };
  }
  try {
    const query = sql`
 SELECT 
 change_reason,
 previous_bid,
 new_bid,
 bid_change_percent,
 created_at
 FROM optimization_events
 WHERE account_id = ${accountId}
 AND event_category = 'bid_adjustment'
 AND action_type = 'bid_increase'
 AND status = 'success'
 AND created_at > DATE_SUB(NOW(), INTERVAL ${sql.raw(String(days))} DAY)
 ORDER BY created_at DESC
 LIMIT 1000
 `;
    const result = await db.execute(query);
    const rows = result[0] || result;
    if (!Array.isArray(rows) || rows.length === 0) {
      return { totalIncreases: 0, avgIncreasePercent: 0, successRate: 0, byScenario: [] };
    }
    const scenarioMap = /* @__PURE__ */ new Map();
    let totalPercent = 0;
    for (const row of rows) {
      const percent = Math.abs(Number(row.bid_change_percent) || 0);
      totalPercent += percent;
      const scenario = classifyBidIncreaseScenario(row.change_reason);
      if (!scenarioMap.has(scenario)) {
        scenarioMap.set(scenario, { count: 0, totalPercent: 0 });
      }
      const stats4 = scenarioMap.get(scenario);
      stats4.count++;
      stats4.totalPercent += percent;
    }
    const byScenario = Array.from(scenarioMap.entries()).map(([scenario, stats4]) => ({
      scenario,
      count: stats4.count,
      avgPercent: Math.round(stats4.totalPercent / stats4.count * 10) / 10
      // @ts-ignore
    })).sort((a, b) => b.count - a.count);
    return {
      totalIncreases: rows.length,
      avgIncreasePercent: Math.round(totalPercent / rows.length * 10) / 10,
      successRate: 0,
      // 需要后续数据验证才能计算
      byScenario
    };
  } catch (error48) {
    log194.warn(`[BidIncreaseAnalysis] \u8BA1\u7B97\u5F02\u5E38: ${error48.message}`);
    return { totalIncreases: 0, avgIncreasePercent: 0, successRate: 0, byScenario: [] };
  }
}
async function calculateCircuitBreakerRate(accountId, days = 7) {
  const db = await getDb();
  if (!db) {
    return { totalDecisions: 0, trippedCount: 0, rate: 0, byReason: {} };
  }
  try {
    const totalQuery = sql`
 SELECT COUNT(*) as total
 FROM optimization_events
 WHERE account_id = ${accountId}
 AND event_category = 'bid_adjustment'
 AND created_at > DATE_SUB(NOW(), INTERVAL ${sql.raw(String(days))} DAY)
 `;
    const totalResult = await db.execute(totalQuery);
    const totalRows = totalResult[0] || totalResult;
    const totalDecisions = Number(totalRows?.[0]?.total) || 0;
    const trippedQuery = sql`
      SELECT 
        change_reason,
        COUNT(*) as cnt
      FROM optimization_events
      WHERE account_id = ${accountId}
        AND event_category = 'bid_adjustment'
        AND created_at > DATE_SUB(NOW(), INTERVAL ${sql.raw(String(days))} DAY)
        AND (change_reason LIKE '%熔断%' OR change_reason LIKE '%circuit_breaker%' OR change_reason LIKE '%提价恢复%' OR change_reason LIKE '%曝光保护%')
      GROUP BY change_reason
    `;
    const trippedResult = await db.execute(trippedQuery);
    const trippedRows = trippedResult[0] || trippedResult;
    let trippedCount = 0;
    const byReason = {};
    if (Array.isArray(trippedRows)) {
      for (const row of trippedRows) {
        const count11 = Number(row.cnt) || 0;
        trippedCount += count11;
        const reason = classifyCircuitBreakerReason(row.change_reason);
        byReason[reason] = (byReason[reason] || 0) + count11;
      }
    }
    const rate = totalDecisions > 0 ? trippedCount / totalDecisions * 100 : 0;
    return {
      totalDecisions,
      trippedCount,
      rate: Math.round(rate * 10) / 10,
      byReason
    };
  } catch (error48) {
    log194.warn(`[CircuitBreakerRate] \u8BA1\u7B97\u5F02\u5E38: ${error48.message}`);
    return { totalDecisions: 0, trippedCount: 0, rate: 0, byReason: {} };
  }
}
function parseAlgorithmName(changeReason, actionDetail) {
  const text2 = `${changeReason || ""} ${actionDetail || ""}`.toLowerCase();
  if (text2.includes("ensemble") || text2.includes("\u878D\u5408")) return "ensemble";
  if (text2.includes("cql") || text2.includes("\u79BB\u7EBF\u5F3A\u5316")) return "cql";
  if (text2.includes("linucb") || text2.includes("\u4E0A\u4E0B\u6587\u8D4C\u535A\u673A")) return "linucb";
  if (text2.includes("sigmoid") || text2.includes("\u66F2\u7EBF\u5229\u6DA6")) return "sigmoid_curve";
  if (text2.includes("ucb") || text2.includes("\u63A2\u7D22-\u5229\u7528") || text2.includes("\u63A2\u7D22\u5229\u7528")) return "ucb";
  if (text2.includes("rule_engine") || text2.includes("rule_based") || text2.includes("\u89C4\u5219\u5F15\u64CE") || text2.includes("\u89C4\u5219")) return "rule_engine";
  if (text2.includes("conservative") || text2.includes("\u4FDD\u5B88\u7B56\u7565") || text2.includes("\u7EF4\u6301")) return "conservative";
  if (text2.includes("autocorrect") || text2.includes("\u7EA0\u6B63") || text2.includes("\u7EA0\u9519")) return "auto_corrector";
  if (text2.includes("\u7194\u65AD") || text2.includes("\u63D0\u4EF7\u6062\u590D") || text2.includes("\u66DD\u5149\u4FDD\u62A4")) return "circuit_breaker";
  return "unknown";
}
function classifyBidIncreaseScenario(changeReason) {
  const text2 = (changeReason || "").toLowerCase();
  if (text2.includes("\u53CC\u5411\u51FA\u4EF7") || text2.includes("acos\u6781\u4F18")) return "v259\u53CC\u5411\u51FA\u4EF7-ACOS\u6781\u4F18";
  if (text2.includes("\u66DD\u5149\u4FDD\u62A4")) return "v259\u66DD\u5149\u4FDD\u62A4\u63D0\u4EF7";
  if (text2.includes("\u63D0\u4EF7\u6062\u590D") || text2.includes("\u7194\u65AD")) return "v259\u7194\u65AD\u63D0\u4EF7\u6062\u590D";
  if (text2.includes("\u96F6\u66DD\u5149") || text2.includes("\u63A2\u7D22")) return "\u96F6\u66DD\u5149\u63A2\u7D22\u63D0\u4EF7";
  if (text2.includes("acos\u4F18\u79C0") || text2.includes("acos\u8FBE\u6807")) return "ACOS\u8FBE\u6807\u5FAE\u8C03\u63D0\u4EF7";
  if (text2.includes("\u4F4E\u66DD\u5149\u96F6\u70B9\u51FB")) return "\u4F4E\u66DD\u5149\u96F6\u70B9\u51FB\u63A2\u7D22";
  return "\u5176\u4ED6\u63D0\u4EF7";
}
function classifyCircuitBreakerReason(changeReason) {
  const text2 = (changeReason || "").toLowerCase();
  if (text2.includes("\u7D2F\u8BA1\u964D\u5E45")) return "7\u5929\u7D2F\u8BA1\u964D\u5E45\u8D85\u9650";
  if (text2.includes("\u8FDE\u7EED") && text2.includes("\u964D\u4EF7")) return "\u8FDE\u7EED\u964D\u4EF7\u8D85\u9650";
  if (text2.includes("\u5E95\u7EBF") || text2.includes("bid_floor")) return "\u6700\u4F4E\u51FA\u4EF7\u4FDD\u62A4";
  if (text2.includes("\u66DD\u5149\u4FDD\u62A4")) return "\u66DD\u5149\u4E0B\u964D\u4FDD\u62A4";
  return "\u5176\u4ED6\u7194\u65AD";
}
async function getSystemHealthMetrics(accountId, days = 7) {
  log194.info(`[SystemHealth] \u8BA1\u7B97\u8D26\u6237${accountId}\u7684\u5065\u5EB7\u6307\u6807 (${days}\u5929\u7A97\u53E3)`);
  const [rollbackRate, algorithmActivation, acosTrend, bidIncreaseAnalysis, circuitBreakerRate] = await Promise.all([
    calculateRollbackRate(accountId, days),
    calculateAlgorithmActivation(accountId, days),
    calculateAcosTrend(accountId),
    calculateBidIncreaseAnalysis(accountId, days * 2),
    // 提价分析用更长窗口
    calculateCircuitBreakerRate(accountId, days)
  ]);
  const metrics = {
    calculatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    accountId,
    rollbackRate,
    algorithmActivation,
    acosTrend,
    bidIncreaseAnalysis,
    circuitBreakerRate
  };
  log194.info(`[SystemHealth] \u8D26\u6237${accountId}\u5065\u5EB7\u6307\u6807: \u56DE\u6EDA\u7387=${rollbackRate.rate}%(${rollbackRate.status}), \u9AD8\u7EA7\u7B97\u6CD5=${algorithmActivation.advancedRate}%(${algorithmActivation.status}), ACoS\u8D8B\u52BF=${acosTrend.direction}(${acosTrend.currentAcos}%)`);
  return metrics;
}
var log194;
var init_systemHealthMetricsService = __esm({
  "server/system/systemHealthMetricsService.ts"() {
    "use strict";
    init_db2();
    init_drizzle_orm();
    init_logger();
    log194 = createModuleLogger("SystemHealth");
    __name(calculateRollbackRate, "calculateRollbackRate");
    __name(calculateAlgorithmActivation, "calculateAlgorithmActivation");
    __name(calculateAcosTrend, "calculateAcosTrend");
    __name(calculateBidIncreaseAnalysis, "calculateBidIncreaseAnalysis");
    __name(calculateCircuitBreakerRate, "calculateCircuitBreakerRate");
    __name(parseAlgorithmName, "parseAlgorithmName");
    __name(classifyBidIncreaseScenario, "classifyBidIncreaseScenario");
    __name(classifyCircuitBreakerReason, "classifyCircuitBreakerReason");
    __name(getSystemHealthMetrics, "getSystemHealthMetrics");
  }
});

