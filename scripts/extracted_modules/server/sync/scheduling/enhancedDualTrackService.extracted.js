// Extracted from production dist/index.js
// Original module: server/sync/scheduling/enhancedDualTrackService.ts
// Lines: 409

var enhancedDualTrackService_exports = {};
__export(enhancedDualTrackService_exports, {
  DATA_FRESHNESS_CONFIG: () => DATA_FRESHNESS_CONFIG,
  checkAndBackfillData: () => checkAndBackfillData,
  default: () => enhancedDualTrackService_default,
  getRealtimeDashboardData: () => getRealtimeDashboardData,
  getSmartMergedData: () => getSmartMergedData,
  getTimelineAggregatedData: () => getTimelineAggregatedData
});
async function getSmartMergedData(accountId, startDate, endDate, options) {
  const db = await getDb();
  if (!db) {
    return { data: [], dataSource: "api", freshness: "stale", warnings: ["\u6570\u636E\u5E93\u8FDE\u63A5\u5931\u8D25"] };
  }
  const warnings = [];
  const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
  let strategy;
  let excludeRecentDays = 0;
  switch (options.purpose) {
    case "realtime_display":
      strategy = "ams_priority";
      break;
    case "historical_analysis":
      strategy = "api_priority";
      excludeRecentDays = 1;
      break;
    case "report_export":
      strategy = "weighted_merge";
      break;
    case "algorithm_input":
      strategy = "api_priority";
      excludeRecentDays = DATA_FREEZING_CONFIG.bidAlgorithmExcludeDays;
      warnings.push(`\u5DF2\u6392\u9664\u6700\u8FD1${excludeRecentDays}\u5929\u6570\u636E\u4EE5\u907F\u514D\u5F52\u56E0\u5EF6\u8FDF\u8BEF\u5224`);
      break;
    default:
      strategy = "api_priority";
  }
  let effectiveEndDate = endDate;
  if (excludeRecentDays > 0) {
    const adjustedEnd = /* @__PURE__ */ new Date();
    adjustedEnd.setDate(adjustedEnd.getDate() - excludeRecentDays);
    effectiveEndDate = adjustedEnd.toISOString().split("T")[0];
    if (effectiveEndDate < startDate) {
      return { data: [], dataSource: "api", freshness: "stale", warnings: ["\u65E5\u671F\u8303\u56F4\u65E0\u6548"] };
    }
  }
  try {
    const apiData = await getApiPerformanceData(db, accountId, startDate, effectiveEndDate, options.campaignIds);
    let amsData = [];
    if (strategy === "ams_priority" && options.includeToday !== false) {
      amsData = await getAmsPerformanceData(db, accountId, today, options.campaignIds);
    }
    const mergedData = mergeDataByStrategy(apiData, amsData, strategy, today);
    const freshness = determineFreshness(apiData, amsData, strategy);
    const dataSource = amsData.length > 0 && strategy === "ams_priority" ? "ams" : "api";
    return {
      data: mergedData,
      dataSource,
      freshness,
      warnings
    };
  } catch (error48) {
    log170.warn("[EnhancedDualTrack] \u83B7\u53D6\u5408\u5E76\u6570\u636E\u5931\u8D25:", error48);
    return { data: [], dataSource: "api", freshness: "stale", warnings: [error48.message] };
  }
}
async function getApiPerformanceData(db, accountId, startDate, endDate, campaignIds) {
  try {
    let query = sql`
      SELECT 
        DATE(date) as reportDate,
        campaignId,
        adGroupId,
        impressions,
        clicks,
        spend,
        sales,
        orders,
        CASE WHEN clicks > 0 THEN orders / clicks * 100 ELSE 0 END as cvr,
        CASE WHEN spend > 0 THEN sales / spend ELSE 0 END as roas,
        CASE WHEN sales > 0 THEN (spend / sales) * 100 ELSE 100 END as acos,
        updatedAt,
        'api' as dataSource
      FROM daily_performance
      WHERE accountId = ${accountId}
        AND DATE(date) >= ${startDate}
        AND DATE(date) <= ${endDate}
    `;
    const [rows] = await db.execute();
    return Array.isArray(rows) ? rows : [];
  } catch (error48) {
    log170.warn("[EnhancedDualTrack] \u83B7\u53D6API\u6570\u636E\u5931\u8D25:", error48);
    return [];
  }
}
async function getAmsPerformanceData(db, accountId, date6, campaignIds) {
  try {
    const [rows] = await db.execute(sql`
      SELECT 
        DATE(eventTime) as reportDate,
        campaignId,
        adGroupId,
        SUM(impressions) as impressions,
        SUM(clicks) as clicks,
        SUM(spend) as spend,
        SUM(sales) as sales,
        SUM(orders) as orders,
        MAX(eventTime) as lastUpdateTime,
        'ams' as dataSource
      FROM ams_performance_buffer
      WHERE accountId = ${accountId}
        AND DATE(eventTime) = ${date6}
      GROUP BY DATE(eventTime), campaignId, adGroupId
    `);
    return Array.isArray(rows) ? rows : [];
  } catch (error48) {
    return [];
  }
}
function mergeDataByStrategy(apiData, amsData, strategy, today) {
  switch (strategy) {
    case "ams_priority":
      return mergeAmsFirst(apiData, amsData, today);
    case "api_priority":
      return mergeApiFirst(apiData, amsData);
    case "weighted_merge":
      return weightedMerge(apiData, amsData);
    case "latest_wins":
      return latestWinsMerge(apiData, amsData);
    default:
      return apiData;
  }
}
function mergeAmsFirst(apiData, amsData, today) {
  const historicalApiData = apiData.filter((d) => d.reportDate !== today);
  return [...historicalApiData, ...amsData];
}
function mergeApiFirst(apiData, amsData) {
  const apiDates = new Set(apiData.map((d) => `${d.reportDate}-${d.campaignId}`));
  const missingAmsData = amsData.filter((d) => !apiDates.has(`${d.reportDate}-${d.campaignId}`));
  return [...apiData, ...missingAmsData];
}
function weightedMerge(apiData, amsData) {
  const mergedMap = /* @__PURE__ */ new Map();
  for (const item of apiData) {
    const key = `${item.reportDate}-${item.campaignId}`;
    mergedMap.set(key, { ...item, weight: 1 });
  }
  for (const item of amsData) {
    const key = `${item.reportDate}-${item.campaignId}`;
    if (!mergedMap.has(key)) {
      mergedMap.set(key, { ...item, weight: 0.8 });
    }
  }
  return Array.from(mergedMap.values());
}
function latestWinsMerge(apiData, amsData) {
  const mergedMap = /* @__PURE__ */ new Map();
  const allData = [...apiData, ...amsData].sort((a, b) => {
    const timeA = new Date(a.updatedAt || a.lastUpdateTime || 0).getTime();
    const timeB = new Date(b.updatedAt || b.lastUpdateTime || 0).getTime();
    return timeB - timeA;
  });
  for (const item of allData) {
    const key = `${item.reportDate}-${item.campaignId}`;
    if (!mergedMap.has(key)) {
      mergedMap.set(key, item);
    }
  }
  return Array.from(mergedMap.values());
}
function determineFreshness(apiData, amsData, strategy) {
  const now = Date.now();
  const amsIsFresh = amsData.some((d) => {
    const updateTime = new Date(d.lastUpdateTime || 0).getTime();
    return now - updateTime < DATA_FRESHNESS_CONFIG.amsMaxAge * 60 * 1e3;
  });
  const apiIsFresh = apiData.some((d) => {
    const updateTime = new Date(d.updatedAt || 0).getTime();
    return now - updateTime < DATA_FRESHNESS_CONFIG.apiMaxAge * 60 * 1e3;
  });
  if (strategy === "ams_priority" && amsIsFresh) return "fresh";
  if (strategy === "api_priority" && apiIsFresh) return "fresh";
  if (amsIsFresh || apiIsFresh) return "mixed";
  return "stale";
}
async function checkAndBackfillData(accountId, date6) {
  const db = await getDb();
  if (!db) {
    return { needsBackfill: false, backfilledRecords: 0, message: "\u6570\u636E\u5E93\u8FDE\u63A5\u5931\u8D25" };
  }
  try {
    const [amsResult] = await db.execute(sql`
      SELECT COUNT(*) as count
      FROM ams_performance_buffer
      WHERE accountId = ${accountId}
        AND DATE(eventTime) = ${date6}
    `);
    const amsCount = Array.isArray(amsResult) && amsResult.length > 0 ? amsResult[0]?.count || 0 : 0;
    if (amsCount > 0) {
      return { needsBackfill: false, backfilledRecords: 0, message: "AMS\u6570\u636E\u6B63\u5E38" };
    }
    const [apiResult] = await db.execute(sql`
      SELECT COUNT(*) as count
      FROM daily_performance
      WHERE accountId = ${accountId}
        AND DATE(date) = ${date6}
    `);
    const apiCount = Array.isArray(apiResult) && apiResult.length > 0 ? apiResult[0]?.count || 0 : 0;
    if (apiCount === 0) {
      return { needsBackfill: false, backfilledRecords: 0, message: "\u65E0\u53EF\u7528\u6570\u636E\u8FDB\u884C\u56DE\u8865" };
    }
    return {
      needsBackfill: true,
      backfilledRecords: apiCount,
      message: `\u68C0\u6D4B\u5230${date6}\u7684AMS\u6570\u636E\u7F3A\u5931\uFF0C\u53EF\u4F7F\u7528${apiCount}\u6761API\u6570\u636E\u8FDB\u884C\u56DE\u8865`
    };
  } catch (error48) {
    log170.warn("[EnhancedDualTrack] \u6570\u636E\u56DE\u8865\u68C0\u67E5\u5931\u8D25:", error48);
    return { needsBackfill: false, backfilledRecords: 0, message: error48.message };
  }
}
async function getTimelineAggregatedData(accountId, startDate, endDate, granularity = "daily") {
  const db = await getDb();
  if (!db) {
    return {
      timeline: [],
      totals: { impressions: 0, clicks: 0, spend: 0, sales: 0, orders: 0, ctr: 0, cvr: 0, acos: 0, roas: 0 },
      dataSource: "api"
    };
  }
  try {
    const dateGroupingMap = {
      "weekly": sql`YEARWEEK(date, 1)`,
      "monthly": sql`DATE_FORMAT(date, '%Y-%m')`,
      "daily": sql`DATE(date)`
    };
    const dateGroupingSql = dateGroupingMap[granularity] || dateGroupingMap["daily"];
    const [rows] = await db.execute(sql`
      SELECT 
        ${dateGroupingSql} as period,
        SUM(impressions) as impressions,
        SUM(clicks) as clicks,
        SUM(spend) as spend,
        SUM(sales) as sales,
        SUM(orders) as orders
      FROM daily_performance
      WHERE accountId = ${accountId}
        AND DATE(date) >= ${startDate}
        AND DATE(date) <= ${endDate}
      GROUP BY ${dateGroupingSql}
      ORDER BY period
    `);
    const timeline = (Array.isArray(rows) ? rows : []).map((row) => ({
      period: String(row.period),
      impressions: Number(row.impressions) || 0,
      clicks: Number(row.clicks) || 0,
      spend: Number(row.spend) || 0,
      // @ts-ignore
      sales: Number(row.sales) || 0,
      // @ts-ignore
      orders: Number(row.orders) || 0,
      // @ts-ignore
      ctr: row.impressions > 0 ? row.clicks / row.impressions * 100 : 0,
      // @ts-ignore
      cvr: row.clicks > 0 ? row.orders / row.clicks * 100 : 0,
      // @ts-ignore
      acos: row.sales > 0 ? row.spend / row.sales * 100 : 0,
      // @ts-ignore
      roas: row.spend > 0 ? row.sales / row.spend : 0
    }));
    const totals = timeline.reduce(
      (acc, item) => ({
        impressions: acc.impressions + item.impressions,
        clicks: acc.clicks + item.clicks,
        spend: acc.spend + item.spend,
        sales: acc.sales + item.sales,
        orders: acc.orders + item.orders,
        ctr: 0,
        cvr: 0,
        acos: 0,
        roas: 0
      }),
      { impressions: 0, clicks: 0, spend: 0, sales: 0, orders: 0, ctr: 0, cvr: 0, acos: 0, roas: 0 }
    );
    totals.ctr = totals.impressions > 0 ? totals.clicks / totals.impressions * 100 : 0;
    totals.cvr = totals.clicks > 0 ? totals.orders / totals.clicks * 100 : 0;
    totals.acos = totals.sales > 0 ? totals.spend / totals.sales * 100 : 0;
    totals.roas = totals.spend > 0 ? totals.sales / totals.spend : 0;
    return { timeline, totals, dataSource: "api" };
  } catch (error48) {
    log170.warn("[EnhancedDualTrack] \u83B7\u53D6\u65F6\u95F4\u7EBF\u6570\u636E\u5931\u8D25:", error48);
    return {
      timeline: [],
      totals: { impressions: 0, clicks: 0, spend: 0, sales: 0, orders: 0, ctr: 0, cvr: 0, acos: 0, roas: 0 },
      dataSource: "api"
    };
  }
}
async function getRealtimeDashboardData(accountId) {
  const db = await getDb();
  const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
  const defaultResult = {
    trusted: { todaySpend: 0, todayClicks: 0, todayImpressions: 0, lastUpdate: null },
    untrusted: { todaySales: 0, todayOrders: 0, todayRoas: 0, todayAcos: 0, warning: "\u8F6C\u5316\u6570\u636E\u670912-48\u5C0F\u65F6\u5F52\u56E0\u5EF6\u8FDF" },
    dataSource: "api"
  };
  if (!db) return defaultResult;
  try {
    let dataSource = "api";
    let result = null;
    try {
      const [amsRows] = await db.execute(sql`
        SELECT 
          SUM(spend) as spend,
          SUM(clicks) as clicks,
          SUM(impressions) as impressions,
          SUM(sales) as sales,
          SUM(orders) as orders,
          MAX(eventTime) as lastUpdate
        FROM ams_performance_buffer
        WHERE accountId = ${accountId}
          AND DATE(eventTime) = ${today}
      `);
      if (Array.isArray(amsRows) && amsRows.length > 0 && amsRows[0]?.spend !== null) {
        result = amsRows[0];
        dataSource = "ams";
      }
    } catch {
    }
    if (!result) {
      const [apiRows] = await db.execute(sql`
        SELECT 
          SUM(spend) as spend,
          SUM(clicks) as clicks,
          SUM(impressions) as impressions,
          SUM(sales) as sales,
          SUM(orders) as orders,
          MAX(updatedAt) as lastUpdate
        FROM daily_performance
        WHERE accountId = ${accountId}
          AND DATE(date) = ${today}
      `);
      result = Array.isArray(apiRows) && apiRows.length > 0 ? apiRows[0] : null;
    }
    if (!result) return defaultResult;
    const spend = Number(result.spend) || 0;
    const sales = Number(result.sales) || 0;
    return {
      trusted: {
        todaySpend: spend,
        todayClicks: Number(result.clicks) || 0,
        todayImpressions: Number(result.impressions) || 0,
        // @ts-ignore
        lastUpdate: result.lastUpdate ? new Date(result.lastUpdate) : null
      },
      untrusted: {
        todaySales: sales,
        todayOrders: Number(result.orders) || 0,
        todayRoas: spend > 0 ? sales / spend : 0,
        todayAcos: sales > 0 ? spend / sales * 100 : 0,
        warning: "\u8F6C\u5316\u6570\u636E\u670912-48\u5C0F\u65F6\u5F52\u56E0\u5EF6\u8FDF\uFF0C\u4EC5\u4F9B\u53C2\u8003"
      },
      dataSource
    };
  } catch (error48) {
    log170.warn("[EnhancedDualTrack] \u83B7\u53D6\u5B9E\u65F6\u4EEA\u8868\u76D8\u6570\u636E\u5931\u8D25:", error48);
    return defaultResult;
  }
}
var log170, DATA_FRESHNESS_CONFIG, enhancedDualTrackService_default;
var init_enhancedDualTrackService = __esm({
  "server/sync/scheduling/enhancedDualTrackService.ts"() {
    "use strict";
    init_db2();
    init_drizzle_orm();
    init_dualTrackSyncService();
    init_logger();
    log170 = createModuleLogger("EnhancedDualTrack");
    DATA_FRESHNESS_CONFIG = {
      // AMS数据被认为是新鲜的最大时间
      amsMaxAge: 15,
      // API数据被认为是新鲜的最大时间
      apiMaxAge: 60,
      // 触发数据回补的AMS无数据时间
      amsBackfillTrigger: 30
    };
    __name(getSmartMergedData, "getSmartMergedData");
    __name(getApiPerformanceData, "getApiPerformanceData");
    __name(getAmsPerformanceData, "getAmsPerformanceData");
    __name(mergeDataByStrategy, "mergeDataByStrategy");
    __name(mergeAmsFirst, "mergeAmsFirst");
    __name(mergeApiFirst, "mergeApiFirst");
    __name(weightedMerge, "weightedMerge");
    __name(latestWinsMerge, "latestWinsMerge");
    __name(determineFreshness, "determineFreshness");
    __name(checkAndBackfillData, "checkAndBackfillData");
    __name(getTimelineAggregatedData, "getTimelineAggregatedData");
    __name(getRealtimeDashboardData, "getRealtimeDashboardData");
    enhancedDualTrackService_default = {
      getSmartMergedData,
      checkAndBackfillData,
      getTimelineAggregatedData,
      getRealtimeDashboardData,
      DATA_FRESHNESS_CONFIG
    };
  }
});

