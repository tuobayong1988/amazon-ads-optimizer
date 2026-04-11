// Extracted from production dist/index.js
// Original module: server/automation/optimizationHealthAlert.ts
// Lines: 225

var optimizationHealthAlert_exports = {};
__export(optimizationHealthAlert_exports, {
  checkAccountOptimizationHealth: () => checkAccountOptimizationHealth,
  scanAllAccountsHealth: () => scanAllAccountsHealth
});
async function checkAccountOptimizationHealth(accountId) {
  const db_instance = await getDb();
  const alerts = [];
  let healthScore = 100;
  if (!db_instance) {
    return {
      accountId,
      hasPerformanceGroup: false,
      performanceGroupCount: 0,
      managedCampaignCount: 0,
      totalActiveCampaigns: 0,
      managementRate: 0,
      alerts: [{ severity: "critical", type: "db_unavailable", message: "\u6570\u636E\u5E93\u8FDE\u63A5\u4E0D\u53EF\u7528" }],
      recentOptimizationCount: 0,
      recentFailedCount: 0,
      healthScore: 0
    };
  }
  try {
    const pgs = await db_instance.select({ id: performanceGroups.id }).from(performanceGroups).where(eq(performanceGroups.accountId, accountId));
    const activeCampaigns = await db_instance.select({
      id: campaigns.id,
      performanceGroupId: campaigns.performanceGroupId
    }).from(campaigns).where(and(
      eq(campaigns.accountId, accountId),
      eq(campaigns.campaignStatus, "enabled")
    ));
    const managedCount = activeCampaigns.filter((c) => c.performanceGroupId).length;
    const totalActive = activeCampaigns.length;
    const managementRate = totalActive > 0 ? managedCount / totalActive * 100 : 0;
    if (pgs.length === 0 && totalActive > 0) {
      alerts.push({
        severity: "critical",
        type: "no_performance_group",
        message: `\u8D26\u6237\u6709${totalActive}\u4E2A\u6D3B\u8DC3Campaign\u4F46\u6CA1\u6709\u4EFB\u4F55\u4F18\u5316\u76EE\u6807`
      });
      healthScore -= 40;
    } else if (managementRate < 50 && totalActive > 5) {
      alerts.push({
        severity: "warning",
        type: "low_management_rate",
        message: `\u4F18\u5316\u8986\u76D6\u7387\u4EC5${managementRate.toFixed(1)}%\uFF08${managedCount}/${totalActive}\uFF09`
      });
      healthScore -= 20;
    }
    const sevenDaysAgo = /* @__PURE__ */ new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const sevenDaysAgoStr = sevenDaysAgo.toISOString().split("T")[0];
    const [optStats] = await db_instance.select({
      totalCount: sql`COUNT(*)`,
      failedCount: sql`SUM(CASE WHEN api_sync_status = 'failed' THEN 1 ELSE 0 END)`,
      lastOptTime: sql`MAX(created_at)`
    }).from(sql`optimization_events`).where(and(
      sql`account_id = ${accountId}`,
      sql`DATE(created_at) >= ${sevenDaysAgoStr}`
    ));
    const recentTotal = Number(optStats?.totalCount) || 0;
    const recentFailed = Number(optStats?.failedCount) || 0;
    const lastOptTime = optStats?.lastOptTime;
    if (pgs.length > 0 && lastOptTime) {
      const lastOptDate = new Date(lastOptTime);
      const daysSinceLastOpt = (Date.now() - lastOptDate.getTime()) / (1e3 * 60 * 60 * 24);
      if (daysSinceLastOpt > ALERT_CONFIG.staleOptimizationDays) {
        alerts.push({
          severity: "warning",
          type: "stale_optimization",
          message: `\u5DF2${Math.floor(daysSinceLastOpt)}\u5929\u6CA1\u6709\u65B0\u7684\u4F18\u5316\u4E8B\u4EF6\uFF08\u6700\u540E: ${lastOptTime}\uFF09`
        });
        healthScore -= 15;
      }
    } else if (pgs.length > 0 && !lastOptTime) {
      alerts.push({
        severity: "critical",
        type: "no_optimization_ever",
        message: "\u6709\u4F18\u5316\u76EE\u6807\u4F46\u8FD17\u5929\u5185\u6CA1\u6709\u4EFB\u4F55\u4F18\u5316\u4E8B\u4EF6"
      });
      healthScore -= 30;
    }
    if (recentTotal > 0) {
      const failureRate = recentFailed / recentTotal * 100;
      if (failureRate > 20) {
        alerts.push({
          severity: "critical",
          type: "high_failure_rate",
          message: `\u8FD17\u5929\u4F18\u5316\u5931\u8D25\u7387${failureRate.toFixed(1)}%\uFF08${recentFailed}/${recentTotal}\uFF09`
        });
        healthScore -= 25;
      } else if (failureRate > 5) {
        alerts.push({
          severity: "warning",
          type: "elevated_failure_rate",
          message: `\u8FD17\u5929\u4F18\u5316\u5931\u8D25\u7387${failureRate.toFixed(1)}%\uFF08${recentFailed}/${recentTotal}\uFF09`
        });
        healthScore -= 10;
      }
    }
    const yesterday = /* @__PURE__ */ new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dayBefore = /* @__PURE__ */ new Date();
    dayBefore.setDate(dayBefore.getDate() - 2);
    const [spendYesterday] = await db_instance.select({
      totalSpend: sql`COALESCE(SUM(${dailyPerformance.spend}), '0')`
    }).from(dailyPerformance).where(and(
      eq(dailyPerformance.accountId, accountId),
      sql`DATE(${dailyPerformance.date}) = ${yesterday.toISOString().split("T")[0]}`
    ));
    const [spendDayBefore] = await db_instance.select({
      totalSpend: sql`COALESCE(SUM(${dailyPerformance.spend}), '0')`
    }).from(dailyPerformance).where(and(
      eq(dailyPerformance.accountId, accountId),
      sql`DATE(${dailyPerformance.date}) = ${dayBefore.toISOString().split("T")[0]}`
    ));
    const spendY = parseFloat(spendYesterday?.totalSpend || "0");
    const spendDB = parseFloat(spendDayBefore?.totalSpend || "0");
    if (spendDB > 1 && spendY > 1) {
      const spendChange = (spendY - spendDB) / spendDB * 100;
      if (spendChange > ALERT_CONFIG.spendSpikeThresholdPct) {
        alerts.push({
          severity: "warning",
          type: "spend_spike",
          message: `\u65E5\u82B1\u8D39\u73AF\u6BD4\u589E\u957F${spendChange.toFixed(1)}%\uFF08$${spendDB.toFixed(2)} -> $${spendY.toFixed(2)}\uFF09`,
          details: { yesterday: spendY, dayBefore: spendDB, changePct: spendChange }
        });
        healthScore -= 10;
      }
    }
    return {
      accountId,
      hasPerformanceGroup: pgs.length > 0,
      performanceGroupCount: pgs.length,
      managedCampaignCount: managedCount,
      totalActiveCampaigns: totalActive,
      managementRate: Math.round(managementRate * 10) / 10,
      alerts,
      lastOptimizationTime: lastOptTime || void 0,
      recentOptimizationCount: recentTotal,
      recentFailedCount: recentFailed,
      healthScore: Math.max(0, healthScore)
    };
  } catch (error48) {
    return {
      accountId,
      hasPerformanceGroup: false,
      performanceGroupCount: 0,
      managedCampaignCount: 0,
      totalActiveCampaigns: 0,
      managementRate: 0,
      alerts: [{ severity: "critical", type: "check_error", message: error48.message }],
      recentOptimizationCount: 0,
      recentFailedCount: 0,
      healthScore: 0
    };
  }
}
async function scanAllAccountsHealth() {
  const db_instance = await getDb();
  if (!db_instance) {
    return {
      scanTime: (/* @__PURE__ */ new Date()).toISOString(),
      totalAccounts: 0,
      healthyAccounts: 0,
      warningAccounts: 0,
      criticalAccounts: 0,
      averageHealthScore: 0,
      accounts: []
    };
  }
  const { adAccounts: adAccounts3 } = await Promise.resolve().then(() => (init_schema2(), schema_exports));
  const accounts = await db_instance.select({
    id: adAccounts3.id,
    accountName: adAccounts3.accountName
  }).from(adAccounts3).where(and(eq(adAccounts3.status, "active"), eq(adAccounts3.connectionStatus, "connected")));
  log132.info(`[fix24] [v620-fix12] \u5F00\u59CB\u4F18\u5316\u5065\u5EB7\u626B\u63CF: ${accounts.length}\u4E2A\u5DF2\u6388\u6743\u6D3B\u8DC3\u8D26\u6237`);
  const results = [];
  for (const account of accounts) {
    const status = await checkAccountOptimizationHealth(account.id);
    status.accountName = account.accountName || void 0;
    results.push(status);
  }
  const healthy = results.filter((r) => r.healthScore >= 80).length;
  const warning = results.filter((r) => r.healthScore >= 40 && r.healthScore < 80).length;
  const critical = results.filter((r) => r.healthScore < 40).length;
  const avgScore = results.length > 0 ? results.reduce((sum2, r) => sum2 + r.healthScore, 0) / results.length : 0;
  results.sort((a, b) => a.healthScore - b.healthScore);
  const report = {
    scanTime: (/* @__PURE__ */ new Date()).toISOString(),
    totalAccounts: accounts.length,
    healthyAccounts: healthy,
    warningAccounts: warning,
    criticalAccounts: critical,
    averageHealthScore: Math.round(avgScore * 10) / 10,
    accounts: results
  };
  log132.info(`[fix24] \u4F18\u5316\u5065\u5EB7\u626B\u63CF\u5B8C\u6210: ${healthy}\u5065\u5EB7/${warning}\u8B66\u544A/${critical}\u4E25\u91CD, \u5E73\u5747\u5206${avgScore.toFixed(1)}`);
  return report;
}
var log132, ALERT_CONFIG;
var init_optimizationHealthAlert = __esm({
  "server/automation/optimizationHealthAlert.ts"() {
    "use strict";
    init_db2();
    init_schema2();
    init_drizzle_orm();
    init_logger();
    log132 = createModuleLogger("OptHealthAlert");
    ALERT_CONFIG = {
      // 优化停滞阈值（天）：超过此天数没有新的优化事件则告警
      staleOptimizationDays: 3,
      // 连续失败阈值：超过此次数的连续API同步失败则告警
      consecutiveFailureThreshold: 10,
      // 花费异常增长阈值（百分比）：日花费环比增长超过此值则告警
      spendSpikeThresholdPct: 50,
      // ACOS恶化阈值（百分比点）：ACOS环比恶化超过此值则告警
      acosDeterioration: 10
    };
    __name(checkAccountOptimizationHealth, "checkAccountOptimizationHealth");
    __name(scanAllAccountsHealth, "scanAllAccountsHealth");
  }
});

