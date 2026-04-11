// Extracted from production dist/index.js
// Original module: server/optimization/marginalBenefitHistoryService.ts
// Lines: 313

var marginalBenefitHistoryService_exports = {};
__export(marginalBenefitHistoryService_exports, {
  analyzeSeasonalPatterns: () => analyzeSeasonalPatterns,
  comparePeriods: () => comparePeriods,
  getHistoryTrend: () => getHistoryTrend,
  saveMarginalBenefitHistory: () => saveMarginalBenefitHistory
});
async function saveMarginalBenefitHistory(accountId, campaignId, placementType, analysisResult, performanceData) {
  const db = await getDb();
  if (!db) {
    throw new Error("\u6570\u636E\u5E93\u8FDE\u63A5\u5931\u8D25");
  }
  const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
  const existing = await db.execute(sql`
    SELECT id FROM marginal_benefit_history 
    WHERE account_id = ${accountId} 
    AND campaign_id = ${campaignId}
    AND placement_type = ${placementType}
    AND analysis_date = ${today}
  `);
  if (existing[0] && existing[0].length > 0) {
    await db.execute(sql`
 UPDATE marginal_benefit_history SET
 current_adjustment = ${analysisResult.currentAdjustment},
 marginal_roas = ${analysisResult.marginalROAS},
 marginal_acos = ${analysisResult.marginalACoS},
 marginal_sales = ${analysisResult.marginalSales},
 marginal_spend = ${analysisResult.marginalSpend},
 elasticity = ${analysisResult.elasticity},
 diminishing_point = ${analysisResult.diminishingPoint},
 optimal_range_min = ${analysisResult.optimalRange.min},
 optimal_range_max = ${analysisResult.optimalRange.max},
 confidence = ${analysisResult.confidence},
 data_points = ${analysisResult.dataPoints},
 total_impressions = ${performanceData.totalImpressions},
 total_clicks = ${performanceData.totalClicks},
 total_spend = ${performanceData.totalSpend},
 total_sales = ${performanceData.totalSales},
 total_orders = ${performanceData.totalOrders}
 WHERE account_id = ${accountId} 
 AND campaign_id = ${campaignId}
 AND placement_type = ${placementType}
 AND analysis_date = ${today}
 `);
    return existing[0][0].id;
  }
  const result = await db.execute(sql`
    INSERT INTO marginal_benefit_history (
      account_id, campaign_id, placement_type, analysis_date,
      current_adjustment, marginal_roas, marginal_acos, marginal_sales, marginal_spend,
      elasticity, diminishing_point, optimal_range_min, optimal_range_max,
      confidence, data_points, total_impressions, total_clicks, total_spend, total_sales, total_orders
    ) VALUES (
      ${accountId}, ${campaignId}, ${placementType}, ${today},
      ${analysisResult.currentAdjustment}, ${analysisResult.marginalROAS}, 
      ${analysisResult.marginalACoS}, ${analysisResult.marginalSales}, ${analysisResult.marginalSpend},
      ${analysisResult.elasticity}, ${analysisResult.diminishingPoint},
      ${analysisResult.optimalRange.min}, ${analysisResult.optimalRange.max},
      ${analysisResult.confidence}, ${analysisResult.dataPoints},
      ${performanceData.totalImpressions}, ${performanceData.totalClicks},
      ${performanceData.totalSpend}, ${performanceData.totalSales}, ${performanceData.totalOrders}
    )
  `);
  return result[0].insertId;
}
async function getHistoryTrend(accountId, campaignId, days = 30) {
  const db = await getDb();
  if (!db) {
    return createEmptyTrendData();
  }
  const endDate = /* @__PURE__ */ new Date();
  const startDate = /* @__PURE__ */ new Date();
  startDate.setDate(startDate.getDate() - days);
  const records = await db.execute(sql`
    SELECT * FROM marginal_benefit_history
    WHERE account_id = ${accountId}
    AND campaign_id = ${campaignId}
    AND analysis_date >= ${startDate.toISOString().split("T")[0]}
    AND analysis_date <= ${endDate.toISOString().split("T")[0]}
    ORDER BY analysis_date ASC
  `);
  const data = records[0] || [];
  const dateMap = /* @__PURE__ */ new Map();
  for (const record2 of data) {
    const date6 = record2.analysis_date;
    if (!dateMap.has(date6)) {
      dateMap.set(date6, []);
    }
    dateMap.get(date6).push(record2);
  }
  const dates = Array.from(dateMap.keys()).sort();
  const topOfSearch = createEmptyTrendMetrics(dates.length);
  const productPage = createEmptyTrendMetrics(dates.length);
  const restOfSearch = createEmptyTrendMetrics(dates.length);
  dates.forEach((date6, index2) => {
    const dayRecords = dateMap.get(date6) || [];
    for (const record2 of dayRecords) {
      const metrics = record2.placement_type === "top_of_search" ? topOfSearch : (
        // @ts-ignore
        record2.placement_type === "product_page" ? productPage : restOfSearch
      );
      metrics.marginalROAS[index2] = Number(record2.marginal_roas) || 0;
      metrics.marginalACoS[index2] = Number(record2.marginal_acos) || 0;
      metrics.marginalSales[index2] = Number(record2.marginal_sales) || 0;
      metrics.elasticity[index2] = Number(record2.elasticity) || 0;
      metrics.diminishingPoint[index2] = Number(record2.diminishing_point) || 0;
      metrics.confidence[index2] = Number(record2.confidence) || 0;
    }
  });
  return { dates, topOfSearch, productPage, restOfSearch };
}
async function analyzeSeasonalPatterns(accountId, campaignId, period = "weekly") {
  const db = await getDb();
  if (!db) {
    return { period, patterns: [], insights: [] };
  }
  const endDate = /* @__PURE__ */ new Date();
  const startDate = /* @__PURE__ */ new Date();
  startDate.setDate(startDate.getDate() - 90);
  const records = await db.execute(sql`
    SELECT * FROM marginal_benefit_history
    WHERE account_id = ${accountId}
    AND campaign_id = ${campaignId}
    AND analysis_date >= ${startDate.toISOString().split("T")[0]}
    ORDER BY analysis_date ASC
  `);
  const data = records[0] || [];
  if (data.length < 14) {
    return {
      period,
      patterns: [],
      // @ts-ignore
      insights: ["\u6570\u636E\u4E0D\u8DB3\uFF0C\u9700\u8981\u81F3\u5C1114\u5929\u7684\u5386\u53F2\u6570\u636E\u624D\u80FD\u8FDB\u884C\u5B63\u8282\u6027\u5206\u6790"]
    };
  }
  const patterns = [];
  const insights = [];
  if (period === "weekly") {
    const weekdayGroups = /* @__PURE__ */ new Map();
    const weekdayNames = ["\u5468\u65E5", "\u5468\u4E00", "\u5468\u4E8C", "\u5468\u4E09", "\u5468\u56DB", "\u5468\u4E94", "\u5468\u516D"];
    for (const record2 of data) {
      const date6 = new Date(record2.analysis_date);
      const weekday = date6.getDay();
      if (!weekdayGroups.has(weekday)) {
        weekdayGroups.set(weekday, []);
      }
      weekdayGroups.get(weekday).push(record2);
    }
    for (let i = 0; i < 7; i++) {
      const records2 = weekdayGroups.get(i) || [];
      if (records2.length > 0) {
        const avgMarginalROAS = records2.reduce((sum2, r) => sum2 + Number(r.marginal_roas || 0), 0) / records2.length;
        const avgMarginalSales = records2.reduce((sum2, r) => sum2 + Number(r.marginal_sales || 0), 0) / records2.length;
        const avgElasticity = records2.reduce((sum2, r) => sum2 + Number(r.elasticity || 0), 0) / records2.length;
        patterns.push({
          // @ts-ignore
          label: weekdayNames[i],
          // @ts-ignore
          avgMarginalROAS,
          avgMarginalSales,
          avgElasticity,
          dataPoints: records2.length
        });
      }
    }
    if (patterns.length >= 5) {
      const sortedByROAS = [...patterns].sort((a, b) => b.avgMarginalROAS - a.avgMarginalROAS);
      const bestDay = sortedByROAS[0];
      const worstDay = sortedByROAS[sortedByROAS.length - 1];
      if (bestDay.avgMarginalROAS > worstDay.avgMarginalROAS * 1.2) {
        insights.push(`${bestDay.label}\u7684\u8FB9\u9645ROAS\u6700\u9AD8\uFF08${bestDay.avgMarginalROAS.toFixed(2)}\uFF09\uFF0C\u5EFA\u8BAE\u5728\u8BE5\u65E5\u589E\u52A0\u4F4D\u7F6E\u503E\u659C`);
        insights.push(`${worstDay.label}\u7684\u8FB9\u9645ROAS\u6700\u4F4E\uFF08${worstDay.avgMarginalROAS.toFixed(2)}\uFF09\uFF0C\u5EFA\u8BAE\u5728\u8BE5\u65E5\u964D\u4F4E\u4F4D\u7F6E\u503E\u659C`);
      }
    }
  } else if (period === "monthly") {
    const periodGroups = /* @__PURE__ */ new Map([
      ["\u6708\u521D(1-10\u65E5)", []],
      ["\u6708\u4E2D(11-20\u65E5)", []],
      ["\u6708\u672B(21-31\u65E5)", []]
    ]);
    for (const record2 of data) {
      const date6 = new Date(record2.analysis_date);
      const day2 = date6.getDate();
      const periodKey = day2 <= 10 ? "\u6708\u521D(1-10\u65E5)" : day2 <= 20 ? "\u6708\u4E2D(11-20\u65E5)" : "\u6708\u672B(21-31\u65E5)";
      periodGroups.get(periodKey).push(record2);
    }
    for (const [label, records2] of Array.from(periodGroups.entries())) {
      if (records2.length > 0) {
        patterns.push({
          label,
          avgMarginalROAS: records2.reduce((sum2, r) => sum2 + Number(r.marginal_roas || 0), 0) / records2.length,
          avgMarginalSales: records2.reduce((sum2, r) => sum2 + Number(r.marginal_sales || 0), 0) / records2.length,
          avgElasticity: records2.reduce((sum2, r) => sum2 + Number(r.elasticity || 0), 0) / records2.length,
          dataPoints: records2.length
        });
      }
    }
  }
  return { period, patterns, insights };
}
async function comparePeriods(accountId, campaignId, period1Start, period1End, period2Start, period2End) {
  const db = await getDb();
  const period1Label = `${period1Start} ~ ${period1End}`;
  const period2Label = `${period2Start} ~ ${period2End}`;
  if (!db) {
    return {
      period1: { startDate: period1Start, endDate: period1End, label: period1Label },
      period2: { startDate: period2Start, endDate: period2End, label: period2Label },
      comparison: []
    };
  }
  const [period1Data, period2Data] = await Promise.all([
    db.execute(sql`
 SELECT placement_type, 
 AVG(marginal_roas) as avg_marginal_roas,
 AVG(marginal_sales) as avg_marginal_sales,
 AVG(elasticity) as avg_elasticity
 FROM marginal_benefit_history
 WHERE account_id = ${accountId}
 AND campaign_id = ${campaignId}
 AND analysis_date >= ${period1Start}
 AND analysis_date <= ${period1End}
 GROUP BY placement_type
 `),
    db.execute(sql`
 SELECT placement_type,
 AVG(marginal_roas) as avg_marginal_roas,
 AVG(marginal_sales) as avg_marginal_sales,
 AVG(elasticity) as avg_elasticity
 FROM marginal_benefit_history
 WHERE account_id = ${accountId}
 AND campaign_id = ${campaignId}
 AND analysis_date >= ${period2Start}
 AND analysis_date <= ${period2End}
 GROUP BY placement_type
 `)
  ]);
  const p1Map = new Map((period1Data[0] || []).map((r) => [r.placement_type, r]));
  const p2Map = new Map((period2Data[0] || []).map((r) => [r.placement_type, r]));
  const placements = ["top_of_search", "product_page", "rest_of_search"];
  const comparison = placements.map((placementType) => {
    const p1 = p1Map.get(placementType) || { avg_marginal_roas: 0, avg_marginal_sales: 0, avg_elasticity: 0 };
    const p2 = p2Map.get(placementType) || { avg_marginal_roas: 0, avg_marginal_sales: 0, avg_elasticity: 0 };
    const period1Avg = {
      // @ts-ignore
      marginalROAS: Number(p1.avg_marginal_roas) || 0,
      // @ts-ignore
      marginalSales: Number(p1.avg_marginal_sales) || 0,
      // @ts-ignore
      elasticity: Number(p1.avg_elasticity) || 0
    };
    const period2Avg = {
      // @ts-ignore
      marginalROAS: Number(p2.avg_marginal_roas) || 0,
      // @ts-ignore
      marginalSales: Number(p2.avg_marginal_sales) || 0,
      // @ts-ignore
      elasticity: Number(p2.avg_elasticity) || 0
    };
    return {
      placementType,
      period1Avg,
      period2Avg,
      change: {
        marginalROAS: period2Avg.marginalROAS - period1Avg.marginalROAS,
        marginalSales: period2Avg.marginalSales - period1Avg.marginalSales,
        elasticity: period2Avg.elasticity - period1Avg.elasticity
      },
      changePercent: {
        marginalROAS: period1Avg.marginalROAS ? (period2Avg.marginalROAS - period1Avg.marginalROAS) / period1Avg.marginalROAS * 100 : 0,
        marginalSales: period1Avg.marginalSales ? (period2Avg.marginalSales - period1Avg.marginalSales) / period1Avg.marginalSales * 100 : 0,
        elasticity: period1Avg.elasticity ? (period2Avg.elasticity - period1Avg.elasticity) / period1Avg.elasticity * 100 : 0
      }
    };
  });
  return {
    period1: { startDate: period1Start, endDate: period1End, label: period1Label },
    period2: { startDate: period2Start, endDate: period2End, label: period2Label },
    comparison
  };
}
function createEmptyTrendData() {
  return {
    dates: [],
    topOfSearch: createEmptyTrendMetrics(0),
    productPage: createEmptyTrendMetrics(0),
    restOfSearch: createEmptyTrendMetrics(0)
  };
}
function createEmptyTrendMetrics(length) {
  return {
    marginalROAS: new Array(length).fill(0),
    marginalACoS: new Array(length).fill(0),
    marginalSales: new Array(length).fill(0),
    elasticity: new Array(length).fill(0),
    diminishingPoint: new Array(length).fill(0),
    confidence: new Array(length).fill(0)
  };
}
var init_marginalBenefitHistoryService = __esm({
  "server/optimization/marginalBenefitHistoryService.ts"() {
    "use strict";
    init_db2();
    init_drizzle_orm();
    __name(saveMarginalBenefitHistory, "saveMarginalBenefitHistory");
    __name(getHistoryTrend, "getHistoryTrend");
    __name(analyzeSeasonalPatterns, "analyzeSeasonalPatterns");
    __name(comparePeriods, "comparePeriods");
    __name(createEmptyTrendData, "createEmptyTrendData");
    __name(createEmptyTrendMetrics, "createEmptyTrendMetrics");
  }
});

