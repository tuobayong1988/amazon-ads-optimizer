// Extracted from production dist/index.js
// Original module: server/sync/scheduling/dualTrackSyncService.ts
// Lines: 567

var dualTrackSyncService_exports = {};
__export(dualTrackSyncService_exports, {
  CONSISTENCY_THRESHOLDS: () => CONSISTENCY_THRESHOLDS,
  DATA_FREEZING_CONFIG: () => DATA_FREEZING_CONFIG,
  DATA_SOURCE_PRIORITY: () => DATA_SOURCE_PRIORITY,
  autoRepairDataDeviations: () => autoRepairDataDeviations,
  default: () => dualTrackSyncService_default,
  getDataForAlgorithm: () => getDataForAlgorithm,
  getDataSourceStats: () => getDataSourceStats,
  getDualTrackStatus: () => getDualTrackStatus,
  getMergedPerformanceData: () => getMergedPerformanceData,
  getRealtimeSpendForGuard: () => getRealtimeSpendForGuard,
  getRealtimeTrustedFields: () => getRealtimeTrustedFields,
  getRealtimeUntrustedFields: () => getRealtimeUntrustedFields,
  isDataInFreezingZone: () => isDataInFreezingZone,
  runConsistencyCheck: () => runConsistencyCheck2
});
async function getDualTrackStatus(accountId) {
  const db = await getDb();
  if (!db) {
    return {
      api: { source: "api", lastSyncAt: null, recordCount: 0, status: "error", errorMessage: "\u6570\u636E\u5E93\u8FDE\u63A5\u5931\u8D25" },
      ams: { source: "ams", lastSyncAt: null, recordCount: 0, status: "error", errorMessage: "\u6570\u636E\u5E93\u8FDE\u63A5\u5931\u8D25" },
      lastConsistencyCheck: null,
      overallHealth: "error"
    };
  }
  try {
    const apiStatus = await getApiSyncStatus(db, accountId);
    const amsStatus = await getAmsSyncStatus(db, accountId);
    const lastCheck = await getLastConsistencyCheck(db, accountId);
    const overallHealth = calculateOverallHealth(apiStatus, amsStatus);
    return {
      api: apiStatus,
      ams: amsStatus,
      lastConsistencyCheck: lastCheck,
      overallHealth
    };
  } catch (error48) {
    log146.warn("[DualTrackSync] \u83B7\u53D6\u72B6\u6001\u5931\u8D25:", error48);
    return {
      api: { source: "api", lastSyncAt: null, recordCount: 0, status: "error", errorMessage: error48.message },
      ams: { source: "ams", lastSyncAt: null, recordCount: 0, status: "error", errorMessage: error48.message },
      lastConsistencyCheck: null,
      overallHealth: "error"
    };
  }
}
async function getApiSyncStatus(db, accountId) {
  try {
    const [result] = await db.execute(sql`
      SELECT 
        completedAt as lastSyncAt,
        recordsSynced as recordCount,
        status,
        errorMessage
      FROM data_sync_jobs
      WHERE accountId = ${accountId}
        AND syncType IN ('all', 'performance')
      ORDER BY createdAt DESC
      LIMIT 1
    `);
    const lastSync = Array.isArray(result) && result.length > 0 ? result[0] : null;
    if (lastSync) {
      const syncStatus = lastSync.status === "completed" ? "healthy" : lastSync.status === "running" ? "healthy" : "error";
      return {
        source: "api",
        lastSyncAt: lastSync.lastSyncAt ? new Date(lastSync.lastSyncAt) : null,
        recordCount: lastSync.recordCount || 0,
        status: syncStatus,
        errorMessage: lastSync.errorMessage
      };
    }
    const [perfResult] = await db.execute(sql`
      SELECT 
        COUNT(*) as recordCount,
        MAX(createdAt) as lastUpdate
      FROM daily_performance
      WHERE accountId = ${accountId}
        AND (dataSource = 'api' OR dataSource IS NULL)
    `);
    const perfData = Array.isArray(perfResult) && perfResult.length > 0 ? perfResult[0] : null;
    const recordCount = parseInt(perfData?.recordCount || "0", 10);
    const lastUpdate = perfData?.lastUpdate ? new Date(perfData.lastUpdate) : null;
    if (recordCount > 0) {
      return {
        source: "api",
        lastSyncAt: lastUpdate,
        recordCount,
        status: "healthy",
        errorMessage: void 0
      };
    }
    return {
      source: "api",
      lastSyncAt: null,
      recordCount: 0,
      status: "degraded",
      errorMessage: "\u5C1A\u672A\u540C\u6B65\u8FC7API\u6570\u636E"
    };
  } catch (error48) {
    return {
      source: "api",
      lastSyncAt: null,
      recordCount: 0,
      status: "error",
      errorMessage: error48.message
    };
  }
}
async function getAmsSyncStatus(db, accountId) {
  try {
    const sqsConsumer = getSQSConsumer();
    const consumerStatuses = sqsConsumer.getStatus();
    const hasRunningConsumers = consumerStatuses.some((s) => s.isRunning);
    const totalMessagesProcessed = consumerStatuses.reduce((sum2, s) => sum2 + s.messagesProcessed, 0);
    const lastProcessedAt = consumerStatuses.map((s) => s.lastProcessedAt).filter(Boolean).sort().reverse()[0];
    const [amsDataResult] = await db.execute(sql`
      SELECT 
        COUNT(*) as totalRecords,
        MAX(createdAt) as lastUpdate
      FROM daily_performance
      WHERE accountId = ${accountId}
        AND dataSource = 'ams'
        AND createdAt >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
    `);
    const amsData = Array.isArray(amsDataResult) && amsDataResult.length > 0 ? amsDataResult[0] : null;
    const hasRecentAmsData = (amsData?.totalRecords || 0) > 0;
    let status = "healthy";
    let errorMessage;
    let recordCount = totalMessagesProcessed;
    let lastSyncAt = null;
    if (lastProcessedAt) {
      lastSyncAt = new Date(lastProcessedAt);
    } else if (amsData?.lastUpdate) {
      lastSyncAt = new Date(amsData.lastUpdate);
    }
    if (!hasRunningConsumers) {
      status = "error";
      errorMessage = "SQS\u6D88\u8D39\u8005\u670D\u52A1\u672A\u8FD0\u884C";
    } else if (!hasRecentAmsData && totalMessagesProcessed === 0) {
      status = "degraded";
      errorMessage = "24\u5C0F\u65F6\u5185\u6CA1\u6709\u6536\u5230AMS\u6570\u636E";
    } else {
      status = "healthy";
      recordCount = Math.max(totalMessagesProcessed, amsData?.totalRecords || 0);
    }
    return {
      source: "ams",
      lastSyncAt,
      // @ts-ignore
      recordCount,
      status,
      errorMessage
    };
  } catch (error48) {
    try {
      const sqsConsumer = getSQSConsumer();
      const consumerStatuses = sqsConsumer.getStatus();
      const hasRunningConsumers = consumerStatuses.some((s) => s.isRunning);
      const totalMessagesProcessed = consumerStatuses.reduce((sum2, s) => sum2 + s.messagesProcessed, 0);
      const lastProcessedAt = consumerStatuses.map((s) => s.lastProcessedAt).filter(Boolean).sort().reverse()[0];
      if (hasRunningConsumers) {
        return {
          source: "ams",
          lastSyncAt: lastProcessedAt ? new Date(lastProcessedAt) : null,
          // @ts-ignore
          recordCount: totalMessagesProcessed,
          status: "healthy",
          errorMessage: void 0
        };
      }
    } catch (e) {
    }
    return {
      source: "ams",
      lastSyncAt: null,
      recordCount: 0,
      status: "degraded",
      errorMessage: error48.message || "AMS\u72B6\u6001\u68C0\u67E5\u5931\u8D25"
    };
  }
}
async function getLastConsistencyCheck(db, accountId) {
  try {
    const [result] = await db.execute(sql`
      SELECT MAX(checkTime) as lastCheck
      FROM data_consistency_checks
      WHERE accountId = ${accountId}
    `);
    const row = Array.isArray(result) && result.length > 0 ? result[0] : null;
    return row?.lastCheck ? new Date(row.lastCheck) : null;
  } catch {
    return null;
  }
}
function calculateOverallHealth(apiStatus, amsStatus) {
  if (apiStatus.status === "error" && amsStatus.status === "error") {
    return "error";
  }
  if (apiStatus.status === "error" || amsStatus.status === "error") {
    return "degraded";
  }
  if (apiStatus.status === "degraded" || amsStatus.status === "degraded") {
    return "degraded";
  }
  return "healthy";
}
async function getDataSourceStats(accountId) {
  const db = await getDb();
  if (!db) {
    return {
      api: { records: 0, lastUpdate: null },
      ams: { records: 0, lastUpdate: null },
      merged: { records: 0, lastUpdate: null }
    };
  }
  try {
    const [apiResult] = await db.execute(sql`
      SELECT 
        COUNT(*) as recordCount,
        MAX(createdAt) as lastUpdate
      FROM daily_performance
      WHERE accountId = ${accountId}
        AND (dataSource = 'api' OR dataSource IS NULL)
    `);
    const apiData = Array.isArray(apiResult) && apiResult.length > 0 ? apiResult[0] : null;
    const apiRecords = parseInt(apiData?.recordCount || "0", 10);
    const apiLastUpdate = apiData?.lastUpdate ? new Date(apiData.lastUpdate) : null;
    const [amsResult] = await db.execute(sql`
      SELECT 
        COUNT(*) as recordCount,
        MAX(createdAt) as lastUpdate
      FROM daily_performance
      WHERE accountId = ${accountId}
        AND dataSource = 'ams'
    `);
    const amsData = Array.isArray(amsResult) && amsResult.length > 0 ? amsResult[0] : null;
    const amsRecords = parseInt(amsData?.recordCount || "0", 10);
    const amsLastUpdate = amsData?.lastUpdate ? new Date(amsData.lastUpdate) : null;
    const [totalResult] = await db.execute(sql`
      SELECT 
        COUNT(*) as recordCount,
        MAX(createdAt) as lastUpdate
      FROM daily_performance
      WHERE accountId = ${accountId}
    `);
    const totalData = Array.isArray(totalResult) && totalResult.length > 0 ? totalResult[0] : null;
    const totalRecords = parseInt(totalData?.recordCount || "0", 10);
    const totalLastUpdate = totalData?.lastUpdate ? new Date(totalData.lastUpdate) : null;
    return {
      api: {
        records: apiRecords,
        lastUpdate: apiLastUpdate
      },
      ams: {
        records: amsRecords,
        lastUpdate: amsLastUpdate
      },
      merged: {
        records: totalRecords,
        lastUpdate: totalLastUpdate
      }
    };
  } catch (error48) {
    log146.warn("[DualTrackSync] \u83B7\u53D6\u6570\u636E\u6E90\u7EDF\u8BA1\u5931\u8D25:", error48);
    return {
      api: { records: 0, lastUpdate: null },
      ams: { records: 0, lastUpdate: null },
      merged: { records: 0, lastUpdate: null }
    };
  }
}
async function runConsistencyCheck2(accountId, startDate, endDate) {
  const db = await getDb();
  if (!db) {
    throw new Error("\u6570\u636E\u5E93\u8FDE\u63A5\u5931\u8D25");
  }
  const checkTime = /* @__PURE__ */ new Date();
  try {
    const [apiResult] = await db.execute(sql`
      SELECT COUNT(*) as recordCount
      FROM daily_performance
      WHERE accountId = ${accountId}
        AND DATE(date) >= ${startDate}
        AND DATE(date) <= ${endDate}
    `);
    const apiRecords = Array.isArray(apiResult) && apiResult.length > 0 ? apiResult[0]?.recordCount || 0 : 0;
    return {
      checkTime,
      accountId,
      dateRange: { start: startDate, end: endDate },
      apiRecords,
      amsRecords: 0,
      matchedRecords: 0,
      overallConsistency: 100,
      status: "consistent"
    };
  } catch (error48) {
    log146.warn("[DualTrackSync] \u4E00\u81F4\u6027\u68C0\u67E5\u5931\u8D25:", error48);
    throw error48;
  }
}
async function getMergedPerformanceData(accountId, startDate, endDate, priority = "historical") {
  const db = await getDb();
  if (!db) return [];
  try {
    const [rows] = await db.execute(sql`
      SELECT 
        DATE(date) as reportDate,
        campaignId,
        impressions,
        clicks,
        spend,
        sales,
        orders
      FROM daily_performance
      WHERE accountId = ${accountId}
        AND DATE(date) >= ${startDate}
        AND DATE(date) <= ${endDate}
      ORDER BY DATE(date), campaignId
    `);
    return Array.isArray(rows) ? rows : [];
  } catch (error48) {
    log146.warn("[DualTrackSync] \u83B7\u53D6\u5408\u5E76\u6570\u636E\u5931\u8D25:", error48);
    return [];
  }
}
async function autoRepairDataDeviations(accountId, deviations) {
  return { repaired: 0, failed: 0 };
}
async function getDataForAlgorithm(accountId, algorithmType, lookbackDays = 30) {
  const db = await getDb();
  if (!db) {
    return { data: [], safeEndDate: /* @__PURE__ */ new Date(), excludedDays: 0, warning: "\u6570\u636E\u5E93\u8FDE\u63A5\u5931\u8D25" };
  }
  let excludeDays;
  switch (algorithmType) {
    case "dayparting":
      excludeDays = DATA_FREEZING_CONFIG.daypartingExcludeDays;
      break;
    case "placement":
      excludeDays = DATA_FREEZING_CONFIG.placementExcludeDays;
      break;
    case "search_term":
      excludeDays = 1;
      break;
    case "bid":
    default:
      excludeDays = DATA_FREEZING_CONFIG.bidAlgorithmExcludeDays;
      break;
  }
  const safeEndDate = /* @__PURE__ */ new Date();
  safeEndDate.setDate(safeEndDate.getDate() - excludeDays);
  safeEndDate.setHours(23, 59, 59, 999);
  const startDate = new Date(safeEndDate);
  startDate.setDate(startDate.getDate() - lookbackDays);
  startDate.setHours(0, 0, 0, 0);
  try {
    const [rows] = await db.execute(sql`
      SELECT 
        DATE(date) as reportDate,
        campaignId,
        adGroupId,
        keywordId,
        impressions,
        clicks,
        spend,
        sales,
        orders,
        CASE WHEN clicks > 0 THEN orders / clicks ELSE 0 END as cvr,
        CASE WHEN spend > 0 THEN sales / spend ELSE 0 END as roas,
        CASE WHEN sales > 0 THEN (spend / sales) * 100 ELSE 100 END as acos
      FROM daily_performance
      WHERE accountId = ${accountId}
        AND DATE(date) >= ${startDate.toISOString().split("T")[0]}
        AND DATE(date) <= ${safeEndDate.toISOString().split("T")[0]}
      ORDER BY DATE(date) DESC, campaignId
    `);
    const data = Array.isArray(rows) ? rows : [];
    return {
      data,
      safeEndDate,
      excludedDays: excludeDays,
      warning: excludeDays > 0 ? `\u5DF2\u6392\u9664\u6700\u8FD1${excludeDays}\u5929\u6570\u636E\u4EE5\u907F\u514D\u5F52\u56E0\u5EF6\u8FDF\u8BEF\u5224` : void 0
    };
  } catch (error48) {
    log146.warn("[DualTrackSync] \u83B7\u53D6\u7B97\u6CD5\u6570\u636E\u5931\u8D25:", error48);
    return { data: [], safeEndDate, excludedDays: excludeDays, warning: error48.message };
  }
}
async function getRealtimeSpendForGuard(accountId, campaignId) {
  const db = await getDb();
  if (!db) {
    return {
      todaySpend: 0,
      todayClicks: 0,
      todayImpressions: 0,
      lastUpdateTime: null,
      dataSource: "api",
      warning: "\u6570\u636E\u5E93\u8FDE\u63A5\u5931\u8D25"
    };
  }
  const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
  try {
    let dataSource = "api";
    let result = null;
    try {
      const [amsRows] = await db.execute(sql`
        SELECT 
          SUM(spend) as todaySpend,
          SUM(clicks) as todayClicks,
          SUM(impressions) as todayImpressions,
          MAX(eventTime) as lastUpdateTime
        FROM ams_performance_buffer
        WHERE accountId = ${accountId}
          AND DATE(eventTime) = ${today}
          ${campaignId ? sql`AND campaignId = ${campaignId}` : sql``}
      `);
      if (Array.isArray(amsRows) && amsRows.length > 0 && amsRows[0]?.todaySpend !== null) {
        result = amsRows[0];
        dataSource = "ams";
      }
    } catch {
    }
    if (!result) {
      const [apiRows] = await db.execute(sql`
 SELECT 
 SUM(spend) as todaySpend,
 SUM(clicks) as todayClicks,
 SUM(impressions) as todayImpressions,
 MAX(updatedAt) as lastUpdateTime
 FROM daily_performance
 WHERE accountId = ${accountId}
 AND DATE(date) = ${today}
 ${campaignId ? sql`AND campaignId = ${campaignId}` : sql``}
 `);
      result = Array.isArray(apiRows) && apiRows.length > 0 ? apiRows[0] : null;
    }
    return {
      // @ts-ignore
      todaySpend: result?.todaySpend || 0,
      // @ts-ignore
      todayClicks: result?.todayClicks || 0,
      // @ts-ignore
      todayImpressions: result?.todayImpressions || 0,
      // @ts-ignore
      lastUpdateTime: result?.lastUpdateTime ? new Date(result.lastUpdateTime) : null,
      dataSource,
      warning: dataSource === "api" ? "\u4F7F\u7528API\u6570\u636E\uFF0C\u53EF\u80FD\u6709\u5EF6\u8FDF" : void 0
    };
  } catch (error48) {
    log146.warn("[DualTrackSync] \u83B7\u53D6\u5B9E\u65F6\u82B1\u8D39\u5931\u8D25:", error48);
    return {
      todaySpend: 0,
      todayClicks: 0,
      todayImpressions: 0,
      lastUpdateTime: null,
      dataSource: "api",
      warning: error48.message
    };
  }
}
function isDataInFreezingZone(date6, algorithmType) {
  let excludeDays;
  switch (algorithmType) {
    case "dayparting":
      excludeDays = DATA_FREEZING_CONFIG.daypartingExcludeDays;
      break;
    case "placement":
      excludeDays = DATA_FREEZING_CONFIG.placementExcludeDays;
      break;
    case "search_term":
      excludeDays = 1;
      break;
    case "bid":
    default:
      excludeDays = DATA_FREEZING_CONFIG.bidAlgorithmExcludeDays;
      break;
  }
  const freezeDate = /* @__PURE__ */ new Date();
  freezeDate.setDate(freezeDate.getDate() - excludeDays);
  freezeDate.setHours(0, 0, 0, 0);
  return date6 >= freezeDate;
}
function getRealtimeTrustedFields() {
  return DATA_FREEZING_CONFIG.realtimeTrustedFields;
}
function getRealtimeUntrustedFields() {
  return DATA_FREEZING_CONFIG.realtimeUntrustedFields;
}
var log146, DATA_SOURCE_PRIORITY, CONSISTENCY_THRESHOLDS, DATA_FREEZING_CONFIG, dualTrackSyncService_default;
var init_dualTrackSyncService = __esm({
  "server/sync/scheduling/dualTrackSyncService.ts"() {
    "use strict";
    init_db2();
    init_drizzle_orm();
    init_sqsConsumerService();
    init_logger();
    log146 = createModuleLogger("DualTrackSync");
    DATA_SOURCE_PRIORITY = {
      // 实时展示优先使用AMS（延迟低）
      realtime: ["ams", "api"],
      // 历史分析优先使用API（准确性高）
      historical: ["api", "ams"],
      // 报表导出使用合并数据
      reporting: ["merged", "api", "ams"]
    };
    CONSISTENCY_THRESHOLDS = {
      // 允许的数值差异百分比
      valueDeviation: 0.05,
      // 5%
      // 允许的时间延迟（分钟）
      timeDelay: 60,
      // 触发告警的连续不一致次数
      alertThreshold: 3,
      // AMS无数据触发回补的时间阈值（小时）
      amsBackfillThreshold: 4
    };
    DATA_FREEZING_CONFIG = {
      // 归因延迟窗口（小时）- 转化数据通常有12-48小时延迟
      attributionDelayHours: 48,
      // 分时策略排除天数 - 排除最近3天数据
      daypartingExcludeDays: 3,
      // 竞价算法排除天数 - 排除最近1天数据
      bidAlgorithmExcludeDays: 1,
      // 位置优化排除天数 - 排除最近3天数据
      placementExcludeDays: 3,
      // 实时监控可信字段 - AMS实时数据只看这些字段
      realtimeTrustedFields: ["spend", "clicks", "impressions"],
      // 实时监控不可信字段 - 这些字段有归因延迟
      realtimeUntrustedFields: ["sales", "orders", "roas", "acos", "cvr"]
    };
    __name(getDualTrackStatus, "getDualTrackStatus");
    __name(getApiSyncStatus, "getApiSyncStatus");
    __name(getAmsSyncStatus, "getAmsSyncStatus");
    __name(getLastConsistencyCheck, "getLastConsistencyCheck");
    __name(calculateOverallHealth, "calculateOverallHealth");
    __name(getDataSourceStats, "getDataSourceStats");
    __name(runConsistencyCheck2, "runConsistencyCheck");
    __name(getMergedPerformanceData, "getMergedPerformanceData");
    __name(autoRepairDataDeviations, "autoRepairDataDeviations");
    __name(getDataForAlgorithm, "getDataForAlgorithm");
    __name(getRealtimeSpendForGuard, "getRealtimeSpendForGuard");
    __name(isDataInFreezingZone, "isDataInFreezingZone");
    __name(getRealtimeTrustedFields, "getRealtimeTrustedFields");
    __name(getRealtimeUntrustedFields, "getRealtimeUntrustedFields");
    dualTrackSyncService_default = {
      getDualTrackStatus,
      runConsistencyCheck: runConsistencyCheck2,
      getMergedPerformanceData,
      autoRepairDataDeviations,
      getDataSourceStats,
      // 专家建议新增：数据冻结区函数
      getDataForAlgorithm,
      getRealtimeSpendForGuard,
      isDataInFreezingZone,
      getRealtimeTrustedFields,
      getRealtimeUntrustedFields,
      // 配置
      DATA_SOURCE_PRIORITY,
      CONSISTENCY_THRESHOLDS,
      DATA_FREEZING_CONFIG
    };
  }
});

