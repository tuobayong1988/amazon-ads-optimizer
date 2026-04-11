// Extracted from production dist/index.js
// Original module: server/sync/infrastructure/dataIntegrityChecker.ts
// Lines: 316

var dataIntegrityChecker_exports = {};
__export(dataIntegrityChecker_exports, {
  checkAccountIntegrity: () => checkAccountIntegrity,
  checkAllAccountsIntegrity: () => checkAllAccountsIntegrity,
  executeAutoRepair: () => executeAutoRepair
});
async function checkAccountIntegrity(accountId, daysToCheck = 14) {
  const checkTime = (/* @__PURE__ */ new Date()).toISOString();
  const endDate = /* @__PURE__ */ new Date();
  const startDate = /* @__PURE__ */ new Date();
  startDate.setDate(startDate.getDate() - daysToCheck);
  const startDateStr = startDate.toISOString().split("T")[0];
  const endDateStr = endDate.toISOString().split("T")[0];
  const result = {
    accountId,
    checkTime,
    dateRange: { start: startDateStr, end: endDateStr },
    expectedDays: daysToCheck,
    actualDays: 0,
    missingDates: [],
    coveragePercent: 0,
    anomalies: [],
    needsRepair: false,
    repairActions: []
  };
  try {
    const { getDb: getDb3 } = await Promise.resolve().then(() => (init_db2(), db_exports));
    const database = await getDb3();
    if (!database) {
      log136.warn(`[v358] \u6570\u636E\u5E93\u8FDE\u63A5\u5931\u8D25\uFF0C\u65E0\u6CD5\u68C0\u67E5\u8D26\u6237${accountId}\u7684\u5B8C\u6574\u6027`);
      return result;
    }
    const dailyData = await database.execute(sql`
      SELECT DATE(date) as report_date, 
             COUNT(*) as record_count,
             SUM(CAST(spend AS DECIMAL(10,2))) as total_spend,
             SUM(clicks) as total_clicks,
             SUM(impressions) as total_impressions
      FROM daily_performance 
      WHERE accountId = ${accountId}
      AND DATE(date) >= ${startDateStr}
      AND DATE(date) <= ${endDateStr}
      GROUP BY DATE(date)
      ORDER BY DATE(date)
    `);
    const rows = dailyData?.[0] || dailyData;
    const dataByDate = /* @__PURE__ */ new Map();
    if (Array.isArray(rows)) {
      for (const row of rows) {
        const dateStr = row.report_date instanceof Date ? row.report_date.toISOString().split("T")[0] : String(row.report_date);
        dataByDate.set(dateStr, row);
      }
    }
    result.actualDays = dataByDate.size;
    const current = new Date(startDate);
    while (current <= endDate) {
      const dateStr = current.toISOString().split("T")[0];
      if (!dataByDate.has(dateStr)) {
        result.missingDates.push(dateStr);
        result.anomalies.push({
          type: "missing_data",
          date: dateStr,
          description: `\u65E5\u671F${dateStr}\u65E0\u7EE9\u6548\u6570\u636E`,
          severity: "high"
        });
      }
      current.setDate(current.getDate() + 1);
    }
    result.coveragePercent = result.expectedDays > 0 ? Math.round(result.actualDays / result.expectedDays * 100) : 0;
    if (dataByDate.size > 1) {
      const recordCounts = Array.from(dataByDate.values()).map((r) => Number(r.record_count));
      const avgCount = recordCounts.reduce((a, b) => a + b, 0) / recordCounts.length;
      const stdDev = Math.sqrt(
        // @ts-ignore
        recordCounts.reduce((sum2, c) => sum2 + Math.pow(c - avgCount, 2), 0) / recordCounts.length
      );
      for (const [dateStr, data] of dataByDate.entries()) {
        const count11 = Number(data.record_count);
        if (stdDev > 0 && count11 > avgCount + 3 * stdDev) {
          result.anomalies.push({
            type: "data_spike",
            date: dateStr,
            description: `\u65E5\u671F${dateStr}\u8BB0\u5F55\u6570\u5F02\u5E38\u504F\u9AD8: ${count11}\u6761 (\u5E73\u5747${Math.round(avgCount)}\u6761)`,
            severity: "high"
          });
        }
      }
    }
    const yesterday = /* @__PURE__ */ new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split("T")[0];
    if (!dataByDate.has(yesterdayStr) && !dataByDate.has(endDateStr)) {
      result.anomalies.push({
        type: "stale_data",
        // @ts-ignore
        date: yesterdayStr,
        // @ts-ignore
        description: `\u6628\u65E5(${yesterdayStr})\u65E0\u6570\u636E\uFF0C\u6570\u636E\u53EF\u80FD\u4E0D\u65B0\u9C9C`,
        // @ts-ignore
        severity: "medium"
      });
    }
    for (const [dateStr, data] of dataByDate.entries()) {
      const spend = Number(data.total_spend);
      const clicks = Number(data.total_clicks);
      const impressions = Number(data.total_impressions);
      if (clicks > 0 && spend === 0) {
        result.anomalies.push({
          type: "zero_spend_with_clicks",
          date: dateStr,
          description: `\u65E5\u671F${dateStr}\u6709${clicks}\u6B21\u70B9\u51FB\u4F46\u82B1\u8D39\u4E3A0`,
          severity: "medium"
        });
      }
    }
    const duplicateCheck = await database.execute(sql`
      SELECT DATE(date) as report_date, campaignId, COUNT(*) as cnt
      FROM daily_performance
      WHERE accountId = ${accountId}
      AND DATE(date) >= ${startDateStr}
      AND DATE(date) <= ${endDateStr}
      GROUP BY DATE(date), campaignId
      HAVING COUNT(*) > 1
      LIMIT 10
    `);
    const dupRows = duplicateCheck?.[0] || duplicateCheck;
    if (Array.isArray(dupRows) && dupRows.length > 0) {
      for (const dup of dupRows) {
        const dateStr = dup.report_date instanceof Date ? dup.report_date.toISOString().split("T")[0] : String(dup.report_date);
        result.anomalies.push({
          type: "duplicate_data",
          date: dateStr,
          description: `\u65E5\u671F${dateStr} campaign ${dup.campaign_id}\u6709${dup.cnt}\u6761\u91CD\u590D\u8BB0\u5F55`,
          severity: "critical"
        });
      }
    }
    const criticalAnomalies = result.anomalies.filter((a) => a.severity === "critical");
    const highAnomalies = result.anomalies.filter((a) => a.severity === "high");
    if (criticalAnomalies.some((a) => a.type === "duplicate_data")) {
      result.needsRepair = true;
      result.repairActions.push({
        type: "deduplicate",
        reason: `\u53D1\u73B0${criticalAnomalies.filter((a) => a.type === "duplicate_data").length}\u5904\u91CD\u590D\u6570\u636E`,
        priority: 1
      });
    }
    if (result.coveragePercent < 70) {
      result.needsRepair = true;
      result.repairActions.push({
        type: "resync_full",
        reason: `\u6570\u636E\u8986\u76D6\u7387\u4EC5${result.coveragePercent}%\uFF0C\u4F4E\u4E8E70%\u9608\u503C`,
        priority: 2
      });
    } else if (result.missingDates.length > 0) {
      result.needsRepair = true;
      result.repairActions.push({
        type: "resync_dates",
        dates: result.missingDates,
        reason: `\u7F3A\u5931${result.missingDates.length}\u5929\u6570\u636E`,
        priority: 3
      });
    }
    log136.info(`[v358] \u8D26\u6237${accountId}\u5B8C\u6574\u6027\u68C0\u67E5\u5B8C\u6210: \u8986\u76D6\u7387=${result.coveragePercent}%, \u7F3A\u5931=${result.missingDates.length}\u5929, \u5F02\u5E38=${result.anomalies.length}\u4E2A, \u9700\u4FEE\u590D=${result.needsRepair}`);
    logSync("DataIntegrityChecker", `\u8D26\u6237${accountId}\u5B8C\u6574\u6027\u68C0\u67E5`, {
      accountId,
      coveragePercent: result.coveragePercent,
      missingDays: result.missingDates.length,
      anomalyCount: result.anomalies.length,
      needsRepair: result.needsRepair
    });
  } catch (error48) {
    log136.warn(`[v358] \u8D26\u6237${accountId}\u5B8C\u6574\u6027\u68C0\u67E5\u5931\u8D25: ${error48.message}`);
    logSyncError("DataIntegrityChecker", `\u5B8C\u6574\u6027\u68C0\u67E5\u5931\u8D25`, { accountId, error: error48.message });
  }
  return result;
}
async function checkAllAccountsIntegrity(daysToCheck = 14) {
  const results = [];
  try {
    const { getDb: getDb3 } = await Promise.resolve().then(() => (init_db2(), db_exports));
    const database = await getDb3();
    if (!database) {
      return { totalAccounts: 0, healthyAccounts: 0, unhealthyAccounts: 0, results };
    }
    const accounts = await database.execute(sql`
 SELECT DISTINCT id FROM ad_accounts 
 WHERE status = 'active' OR connectionStatus = 'connected'
 `);
    const accountRows = accounts?.[0] || accounts;
    if (!Array.isArray(accountRows)) {
      return { totalAccounts: 0, healthyAccounts: 0, unhealthyAccounts: 0, results };
    }
    log136.info(`[v358] \u5F00\u59CB\u6279\u91CF\u5B8C\u6574\u6027\u68C0\u67E5: ${accountRows.length}\u4E2A\u8D26\u6237`);
    for (const account of accountRows) {
      const result = await checkAccountIntegrity(account.id, daysToCheck);
      results.push(result);
      await new Promise((r) => setTimeout(r, 1e3));
    }
    const healthyAccounts = results.filter((r) => !r.needsRepair).length;
    const unhealthyAccounts = results.filter((r) => r.needsRepair).length;
    log136.info(`[v358] \u6279\u91CF\u5B8C\u6574\u6027\u68C0\u67E5\u5B8C\u6210: \u603B\u8BA1=${results.length}, \u5065\u5EB7=${healthyAccounts}, \u9700\u4FEE\u590D=${unhealthyAccounts}`);
    return {
      totalAccounts: results.length,
      healthyAccounts,
      unhealthyAccounts,
      results
    };
  } catch (error48) {
    log136.warn(`[v358] \u6279\u91CF\u5B8C\u6574\u6027\u68C0\u67E5\u5931\u8D25: ${error48.message}`);
    return { totalAccounts: 0, healthyAccounts: 0, unhealthyAccounts: 0, results };
  }
}
async function executeAutoRepair(checkResult) {
  const errors = [];
  let actionsExecuted = 0;
  if (!checkResult.needsRepair) {
    return { repaired: true, actionsExecuted: 0, errors: [] };
  }
  log136.info(`[v358] \u5F00\u59CB\u81EA\u52A8\u4FEE\u590D\u8D26\u6237${checkResult.accountId}: ${checkResult.repairActions.length}\u4E2A\u4FEE\u590D\u52A8\u4F5C`);
  const sortedActions = [...checkResult.repairActions].sort((a, b) => a.priority - b.priority);
  for (const action of sortedActions) {
    try {
      switch (action.type) {
        case "deduplicate":
          await deduplicatePerformanceData(checkResult.accountId);
          actionsExecuted++;
          break;
        // @ts-ignore
        case "resync_dates":
          if (action.dates && action.dates.length > 0) {
            log136.info(`[v358] \u89E6\u53D1\u8865\u507F\u540C\u6B65: \u8D26\u6237${checkResult.accountId}, \u65E5\u671F=${action.dates.join(",")}`);
            await recordPendingResync(checkResult.accountId, action.dates);
            actionsExecuted++;
          }
          break;
        case "resync_full":
          log136.info(`[v358] \u89E6\u53D1\u5168\u91CF\u91CD\u65B0\u540C\u6B65: \u8D26\u6237${checkResult.accountId}`);
          await recordPendingResync(checkResult.accountId, ["full"]);
          actionsExecuted++;
          break;
        case "alert_only":
          log136.warn(`[v358] \u4EC5\u544A\u8B66: \u8D26\u6237${checkResult.accountId} - ${action.reason}`);
          actionsExecuted++;
          break;
      }
    } catch (error48) {
      errors.push(`${action.type}: ${error48.message}`);
      log136.warn(`[v358] \u4FEE\u590D\u52A8\u4F5C${action.type}\u5931\u8D25: ${error48.message}`);
    }
  }
  const repaired = errors.length === 0;
  log136.info(`[v358] \u8D26\u6237${checkResult.accountId}\u81EA\u52A8\u4FEE\u590D\u5B8C\u6210: \u6267\u884C=${actionsExecuted}, \u9519\u8BEF=${errors.length}`);
  return { repaired, actionsExecuted, errors };
}
async function deduplicatePerformanceData(accountId) {
  try {
    const { getDb: getDb3 } = await Promise.resolve().then(() => (init_db2(), db_exports));
    const database = await getDb3();
    if (!database) return 0;
    const result = await database.execute(sql`
      DELETE dp1 FROM daily_performance dp1
      INNER JOIN daily_performance dp2
      ON dp1.accountId = dp2.accountId
      AND dp1.campaignId = dp2.campaignId
      AND DATE(dp1.date) = DATE(dp2.date)
      AND dp1.id < dp2.id
      WHERE dp1.accountId = ${accountId}
    `);
    const deletedCount = result?.affectedRows || 0;
    log136.info(`[v358] \u8D26\u6237${accountId}\u53BB\u91CD\u5B8C\u6210: \u5220\u9664${deletedCount}\u6761\u91CD\u590D\u8BB0\u5F55`);
    return deletedCount;
  } catch (error48) {
    log136.warn(`[v358] \u53BB\u91CD\u5931\u8D25: ${error48.message}`);
    return 0;
  }
}
async function recordPendingResync(accountId, dates) {
  try {
    const { getDb: getDb3 } = await Promise.resolve().then(() => (init_db2(), db_exports));
    const database = await getDb3();
    if (!database) return;
    const now = (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ");
    await database.execute(sql`
      INSERT INTO sync_tasks_v2 (task_id, tier, trigger_source, status, total_shards, created_at, updated_at)
      VALUES (
        ${`repair-${accountId}-${Date.now()}`},
        'repair',
        'data_integrity_checker',
        'pending',
        ${dates.length},
        ${now},
        ${now}
      )
    `);
    log136.info(`[v358] \u5DF2\u8BB0\u5F55\u8D26\u6237${accountId}\u7684\u8865\u507F\u540C\u6B65\u4EFB\u52A1: ${dates.length}\u4E2A\u65E5\u671F`);
  } catch (error48) {
    log136.warn(`[v358] \u8BB0\u5F55\u8865\u507F\u540C\u6B65\u5931\u8D25: ${error48.message}`);
  }
}
var log136;
var init_dataIntegrityChecker = __esm({
  "server/sync/infrastructure/dataIntegrityChecker.ts"() {
    "use strict";
    init_logger();
    init_drizzle_orm();
    init_opsLogger();
    log136 = createModuleLogger("dataIntegrityChecker");
    __name(checkAccountIntegrity, "checkAccountIntegrity");
    __name(checkAllAccountsIntegrity, "checkAllAccountsIntegrity");
    __name(executeAutoRepair, "executeAutoRepair");
    __name(deduplicatePerformanceData, "deduplicatePerformanceData");
    __name(recordPendingResync, "recordPendingResync");
  }
});

