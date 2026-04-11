// Extracted from production dist/index.js
// Original module: server/optimization/optimizationMonitoringService.ts
// Lines: 484

var optimizationMonitoringService_exports = {};
__export(optimizationMonitoringService_exports, {
  formatMonitoringReport: () => formatMonitoringReport,
  generateMonitoringReport: () => generateMonitoringReport,
  runMonitoringCheck: () => runMonitoringCheck
});
async function generateMonitoringReport(teamId) {
  const now = /* @__PURE__ */ new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1e3);
  const alerts = [];
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const bidMetrics = await checkBidRatio(db, teamId, thirtyDaysAgo, alerts);
  const acosMetrics = await checkAcosOverrun(db, teamId, alerts);
  const syncMetrics = await checkSyncHealth(db, teamId, alerts);
  const algorithmMetrics = await checkAlgorithmHealth2(db, teamId, thirtyDaysAgo, alerts);
  await checkVersionConsistency(alerts);
  await checkUnassignedCampaigns(db, teamId, alerts);
  await checkProactiveRiskWarning(db, teamId, alerts);
  const healthScore = calculateHealthScore(alerts);
  const status = healthScore >= 80 ? "healthy" : healthScore >= 50 ? "warning" : "critical";
  return {
    generatedAt: now,
    systemVersion: 263,
    alerts,
    metrics: {
      bidRaiseCount: bidMetrics.raiseCount,
      bidLowerCount: bidMetrics.lowerCount,
      bidRaiseToLowerRatio: bidMetrics.ratio,
      avgAcosOverrun: acosMetrics.avgOverrun,
      syncSuccessRate: syncMetrics.successRate,
      optimizationCount30d: algorithmMetrics.totalOps,
      positiveRate: algorithmMetrics.positiveRate,
      activeAlgorithms: algorithmMetrics.activeAlgorithms,
      highRiskAccounts: acosMetrics.highRiskCount
    },
    healthScore,
    status
  };
}
async function checkBidRatio(db, teamId, since, alerts) {
  try {
    const sinceStr = since.toISOString();
    const result = await db.select({
      actionType: optimizationEvents2.actionType,
      count: sql`count(*)`
    }).from(optimizationEvents2).where(
      and(
        eq(optimizationEvents2.userId, teamId),
        gte(optimizationEvents2.createdAt, sinceStr),
        sql`${optimizationEvents2.eventCategory} = 'bid_adjustment'`
      )
    ).groupBy(optimizationEvents2.actionType);
    let raiseCount = 0;
    let lowerCount = 0;
    for (const row of result) {
      if (row.actionType === "bid_increase") raiseCount = Number(row.count);
      if (row.actionType === "bid_decrease") lowerCount = Number(row.count);
    }
    const ratio = lowerCount > 0 ? raiseCount / lowerCount : raiseCount > 0 ? Infinity : 1;
    if (ratio > ALERT_THRESHOLDS.bidRatioMax) {
      alerts.push({
        id: `bid-ratio-${Date.now()}`,
        category: "bid_ratio_imbalance",
        severity: ratio > 5 ? "critical" : "warning",
        title: "\u63D0\u4EF7/\u964D\u4EF7\u6BD4\u4F8B\u5931\u8861",
        message: `30\u5929\u5185\u63D0\u4EF7${raiseCount}\u6B21\uFF0C\u964D\u4EF7${lowerCount}\u6B21\uFF0C\u6BD4\u4F8B${ratio.toFixed(1)}:1\uFF0C\u8D85\u8FC7\u5B89\u5168\u9608\u503C${ALERT_THRESHOLDS.bidRatioMax}:1`,
        metric: "bid_raise_lower_ratio",
        currentValue: ratio,
        threshold: ALERT_THRESHOLDS.bidRatioMax,
        recommendation: "\u68C0\u67E5\u7B97\u6CD5\u662F\u5426\u8FC7\u5EA6\u6FC0\u8FDB\uFF0C\u8003\u8651\u964D\u4F4E\u63A2\u7D22\u51FA\u4EF7\u4E0A\u9650\u6216\u5207\u6362\u5230\u66F4\u4FDD\u5B88\u7684\u7B56\u7565\u6A21\u677F",
        timestamp: /* @__PURE__ */ new Date()
      });
    }
    return { raiseCount, lowerCount, ratio };
  } catch (e) {
    log128.warn("[MonitoringService] checkBidRatio error:", e);
    return { raiseCount: 0, lowerCount: 0, ratio: 1 };
  }
}
async function checkAcosOverrun(db, teamId, alerts) {
  try {
    const accounts = await db.select({
      id: adAccounts.id,
      name: adAccounts.accountName,
      marketplace: adAccounts.marketplace
    }).from(adAccounts).where(eq(adAccounts.userId, teamId));
    let totalOverrun = 0;
    let highRiskCount = 0;
    let accountCount = 0;
    for (const account of accounts) {
      const latestLog = await db.select({
        actionDetail: optimizationLogs.actionDetail,
        previousValue: optimizationLogs.previousValue,
        newValue: optimizationLogs.newValue
      }).from(optimizationLogs).where(
        and(
          // @ts-ignore
          eq(optimizationLogs.accountId, account.id),
          sql`${optimizationLogs.logCategory} = 'bid_adjustment'`
        )
      ).orderBy(desc(optimizationLogs.createdAt)).limit(1);
      if (latestLog.length > 0 && latestLog[0].actionDetail) {
        try {
          const detail = JSON.parse(latestLog[0].actionDetail);
          const target = Number(detail.targetAcos || detail.target_acos || 0);
          const actual = Number(detail.actualAcos || detail.actual_acos || detail.currentAcos || 0);
          if (target > 0 && actual > 0) {
            const overrunPercent = (actual - target) / target * 100;
            totalOverrun += Math.max(0, overrunPercent);
            accountCount++;
            if (overrunPercent > ALERT_THRESHOLDS.acosOverrunPercent) {
              highRiskCount++;
              alerts.push({
                // @ts-ignore
                id: `acos-overrun-${account.id}-${Date.now()}`,
                category: "acos_overrun",
                severity: actual > target * ALERT_THRESHOLDS.criticalAcosMultiplier ? "critical" : "warning",
                // @ts-ignore
                title: `${account.name} ${account.marketplace} ACoS\u4E25\u91CD\u8D85\u6807`,
                message: `\u5B9E\u9645ACoS ${actual.toFixed(1)}%\uFF0C\u76EE\u6807${target.toFixed(1)}%\uFF0C\u8D85\u6807${overrunPercent.toFixed(0)}%`,
                metric: "acos_overrun_percent",
                currentValue: overrunPercent,
                // @ts-ignore
                threshold: ALERT_THRESHOLDS.acosOverrunPercent,
                // @ts-ignore
                recommendation: overrunPercent > 100 ? '\u5EFA\u8BAE\u6682\u505C\u8BE5\u8D26\u6237\u7684\u9AD8ACoS\u5E7F\u544A\u6D3B\u52A8\uFF0C\u5207\u6362\u5230"\u5229\u6DA6\u4F18\u5148"\u7B56\u7565' : "\u5EFA\u8BAE\u964D\u4F4E\u76EE\u6807ACoS\u6216\u68C0\u67E5\u5173\u952E\u8BCD\u8D28\u91CF",
                timestamp: /* @__PURE__ */ new Date(),
                // @ts-ignore
                accountId: account.id,
                // @ts-ignore
                accountName: `${account.name} ${account.marketplace}`
              });
            }
          }
        } catch {
        }
      }
    }
    const avgOverrun = accountCount > 0 ? totalOverrun / accountCount : 0;
    return { avgOverrun, highRiskCount };
  } catch (e) {
    log128.warn("[MonitoringService] checkAcosOverrun error:", e);
    return { avgOverrun: 0, highRiskCount: 0 };
  }
}
async function checkSyncHealth(db, teamId, alerts) {
  try {
    const result = await db.select({
      status: optimizationEvents2.apiSyncStatus,
      count: sql`count(*)`
    }).from(optimizationEvents2).where(
      and(
        eq(optimizationEvents2.userId, teamId),
        sql`${optimizationEvents2.apiSyncStatus} NOT IN ('not_applicable', 'invalid_legacy')`
        // @ts-ignore
      )
    ).groupBy(optimizationEvents2.apiSyncStatus);
    let synced = 0;
    let total = 0;
    for (const row of result) {
      const count11 = Number(row.count);
      total += count11;
      if (row.status === "synced") synced += count11;
    }
    const successRate = total > 0 ? synced / total * 100 : 100;
    if (successRate < ALERT_THRESHOLDS.syncSuccessRateMin) {
      alerts.push({
        id: `sync-health-${Date.now()}`,
        category: "sync_failure",
        severity: successRate < 90 ? "critical" : "warning",
        title: "\u540C\u6B65\u6210\u529F\u7387\u4F4E\u4E8E100%",
        message: `\u540C\u6B65\u6210\u529F\u7387${successRate.toFixed(1)}%\uFF08${synced}/${total}\uFF09\uFF0C\u76EE\u6807100%`,
        metric: "sync_success_rate",
        currentValue: successRate,
        threshold: ALERT_THRESHOLDS.syncSuccessRateMin,
        recommendation: "\u68C0\u67E5Amazon API\u8FDE\u63A5\u72B6\u6001\u548C\u5931\u8D25\u4E8B\u4EF6\u7684\u9519\u8BEF\u65E5\u5FD7",
        timestamp: /* @__PURE__ */ new Date()
      });
    }
    return { successRate };
  } catch (e) {
    log128.warn("[MonitoringService] checkSyncHealth error:", e);
    return { successRate: 100 };
  }
}
async function checkAlgorithmHealth2(db, teamId, since, alerts) {
  try {
    const sinceStr = since.toISOString();
    const opsResult = await db.select({
      count: sql`count(*)`
    }).from(optimizationEvents2).where(
      and(
        eq(optimizationEvents2.userId, teamId),
        gte(optimizationEvents2.createdAt, sinceStr),
        sql`${optimizationEvents2.eventCategory} = 'bid_adjustment'`
      )
    );
    const totalOps = Number(opsResult[0]?.count || 0);
    const positiveResult = await db.select({
      count: sql`count(*)`
    }).from(optimizationEvents2).where(
      and(
        eq(optimizationEvents2.userId, teamId),
        gte(optimizationEvents2.createdAt, sinceStr),
        sql`${optimizationEvents2.eventCategory} = 'bid_adjustment'`,
        sql`${optimizationEvents2.status} = 'success'`
      )
    );
    const positiveCount = Number(positiveResult[0]?.count || 0);
    const positiveRate = totalOps > 0 ? positiveCount / totalOps * 100 : 0;
    const algorithmResult = await db.select({
      algorithm: optimizationEvents2.algorithmVersion
    }).from(optimizationEvents2).where(
      and(
        eq(optimizationEvents2.userId, teamId),
        gte(optimizationEvents2.createdAt, sinceStr),
        sql`${optimizationEvents2.algorithmVersion} IS NOT NULL`
      )
    ).groupBy(optimizationEvents2.algorithmVersion);
    const activeAlgorithms = algorithmResult.map((r) => r.algorithm).filter((a) => a !== null);
    if (totalOps === 0) {
      alerts.push({
        id: `zero-optimization-${Date.now()}`,
        category: "zero_optimization",
        severity: "critical",
        title: "30\u5929\u5185\u96F6\u4F18\u5316\u64CD\u4F5C",
        message: "\u7CFB\u7EDF\u5728\u8FC7\u53BB30\u5929\u5185\u672A\u6267\u884C\u4EFB\u4F55\u51FA\u4EF7\u8C03\u6574\u64CD\u4F5C",
        metric: "optimization_count_30d",
        currentValue: 0,
        threshold: ALERT_THRESHOLDS.minOptimizationCount,
        recommendation: "\u68C0\u67E5dataSyncScheduler\u662F\u5426\u6B63\u5E38\u8FD0\u884C\uFF0C\u786E\u8BA4\u4F18\u5316\u76EE\u6807\u662F\u5426\u5DF2\u914D\u7F6E",
        timestamp: /* @__PURE__ */ new Date()
      });
    }
    if (totalOps > 10 && positiveRate < ALERT_THRESHOLDS.minPositiveRate) {
      alerts.push({
        id: `low-positive-rate-${Date.now()}`,
        category: "algorithm_stall",
        severity: "warning",
        title: "\u7B97\u6CD5\u6B63\u5411\u7387\u504F\u4F4E",
        message: `30\u5929\u5185${totalOps}\u6B21\u4F18\u5316\u64CD\u4F5C\u4E2D\uFF0C\u6210\u529F\u7387\u4EC5${positiveRate.toFixed(1)}%\uFF0C\u4F4E\u4E8E${ALERT_THRESHOLDS.minPositiveRate}%\u9608\u503C`,
        metric: "positive_rate",
        currentValue: positiveRate,
        threshold: ALERT_THRESHOLDS.minPositiveRate,
        recommendation: "\u68C0\u67E5\u89C4\u5219\u5F15\u64CE\u7684\u51FA\u4EF7\u7B56\u7565\u662F\u5426\u8FC7\u4E8E\u6FC0\u8FDB\uFF0C\u6216\u6570\u636E\u8D28\u91CF\u662F\u5426\u5B58\u5728\u95EE\u9898",
        timestamp: /* @__PURE__ */ new Date()
      });
    }
    if (activeAlgorithms.length <= 1 && totalOps > 0) {
      alerts.push({
        id: `single-algorithm-${Date.now()}`,
        category: "algorithm_stall",
        severity: "info",
        title: "\u4EC5\u5355\u4E00\u7B97\u6CD5\u5728\u8FD0\u884C",
        message: `\u5F53\u524D\u4EC5${activeAlgorithms[0] || "rule_engine"}\u5728\u8FD0\u884C\uFF0C\u9AD8\u7EA7\u7B97\u6CD5\uFF08sigmoid_curve, linucb, cql\uFF09\u5C1A\u672A\u6FC0\u6D3B`,
        metric: "active_algorithm_count",
        currentValue: activeAlgorithms.length,
        threshold: 3,
        recommendation: "\u968F\u7740\u6570\u636E\u79EF\u7D2F\uFF0C\u9AD8\u7EA7\u7B97\u6CD5\u5E94\u9010\u6B65\u88ABmetaLearningSelector\u6FC0\u6D3B\u3002\u5982\u4E00\u4E2A\u6708\u540E\u4ECD\u672A\u6FC0\u6D3B\uFF0C\u9700\u8FDB\u4E00\u6B65\u964D\u4F4E\u51B7\u542F\u52A8\u95E8\u69DB",
        timestamp: /* @__PURE__ */ new Date()
      });
    }
    return { totalOps, positiveRate, activeAlgorithms };
  } catch (e) {
    log128.warn("[MonitoringService] checkAlgorithmHealth error:", e);
    return { totalOps: 0, positiveRate: 0, activeAlgorithms: [] };
  }
}
async function checkVersionConsistency(alerts) {
  try {
    const { SYSTEM_VERSION: SYSTEM_VERSION2 } = await Promise.resolve().then(() => (init_postDeployOptimizer(), postDeployOptimizer_exports));
    const { SYSTEM_VERSION: UTIL_VERSION } = await Promise.resolve().then(() => (init_systemVersion(), systemVersion_exports));
    if (Number(SYSTEM_VERSION2) !== Number(UTIL_VERSION)) {
      alerts.push({
        id: `version-mismatch-${Date.now()}`,
        category: "version_mismatch",
        severity: "critical",
        title: "SYSTEM_VERSION\u4E0D\u4E00\u81F4",
        message: `postDeployOptimizer.SYSTEM_VERSION=${SYSTEM_VERSION2}\uFF0CsystemVersion.SYSTEM_VERSION=${UTIL_VERSION}`,
        metric: "version_consistency",
        currentValue: 0,
        threshold: 1,
        recommendation: "\u7ACB\u5373\u540C\u6B65\u4E24\u4E2A\u6587\u4EF6\u4E2D\u7684SYSTEM_VERSION\uFF0C\u786E\u4FDD\u7248\u672C\u53F7\u4E00\u81F4",
        timestamp: /* @__PURE__ */ new Date()
      });
    }
  } catch (e) {
    log128.warn("[MonitoringService] checkVersionConsistency error:", e);
  }
}
async function checkUnassignedCampaigns(db, teamId, alerts) {
  try {
    const unassigned = await db.select({
      id: campaigns.id,
      campaignName: campaigns.campaignName,
      campaignStatus: campaigns.campaignStatus,
      accountId: campaigns.accountId,
      dailyBudget: campaigns.dailyBudget
    }).from(campaigns).where(
      and(
        isNull(campaigns.performanceGroupId),
        eq(campaigns.campaignStatus, "enabled")
      )
    );
    if (unassigned.length > 0) {
      const totalBudget = unassigned.reduce((sum2, c) => sum2 + (Number(c.dailyBudget) || 0), 0);
      const severity = unassigned.length > 50 ? "critical" : unassigned.length > 10 ? "warning" : "info";
      alerts.push({
        id: `unassigned-campaigns-${Date.now()}`,
        category: "unassigned_campaigns",
        severity,
        title: `${unassigned.length}\u4E2A\u6D3B\u8DC3\u5E7F\u544A\u6D3B\u52A8\u672A\u5206\u914D\u4F18\u5316\u76EE\u6807`,
        message: `\u5171${unassigned.length}\u4E2A\u6D3B\u8DC3\u5E7F\u544A\u6D3B\u52A8\u672A\u88AB\u5206\u914D\u5230\u4EFB\u4F55\u4F18\u5316\u76EE\u6807\uFF0C\u65E5\u5747\u9884\u7B97\u5408\u8BA1$${totalBudget.toFixed(2)}\uFF0C\u8FD9\u4E9B\u5E7F\u544A\u6D3B\u52A8\u4E0D\u4F1A\u88AB\u4EFB\u4F55\u4F18\u5316\u7B97\u6CD5\u7BA1\u7406`,
        metric: "unassigned_campaign_count",
        currentValue: unassigned.length,
        threshold: 0,
        recommendation: "\u5EFA\u8BAE\u5C06\u8FD9\u4E9B\u5E7F\u544A\u6D3B\u52A8\u5206\u914D\u5230\u5408\u9002\u7684\u4F18\u5316\u76EE\u6807\uFF0C\u6216\u521B\u5EFA\u65B0\u7684\u4F18\u5316\u76EE\u6807\u8FDB\u884C\u7BA1\u7406",
        timestamp: /* @__PURE__ */ new Date()
      });
    }
  } catch (e) {
    log128.warn("[MonitoringService] checkUnassignedCampaigns error:", e);
  }
}
async function checkProactiveRiskWarning(db, teamId, alerts) {
  try {
    const accounts = await db.select({
      id: adAccounts.id,
      name: adAccounts.accountName,
      marketplace: adAccounts.marketplace
    }).from(adAccounts).where(eq(adAccounts.userId, teamId));
    for (const account of accounts) {
      try {
        const [recentResult] = await db.execute(
          sql`SELECT 
 SUM(CAST(spend AS DECIMAL(10,2))) as total_spend,
 SUM(CAST(sales AS DECIMAL(10,2))) as total_sales
 FROM daily_performance 
 WHERE accountId = ${account.id}
 AND date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)`
        );
        const [prevResult] = await db.execute(
          sql`SELECT 
 SUM(CAST(spend AS DECIMAL(10,2))) as total_spend,
 SUM(CAST(sales AS DECIMAL(10,2))) as total_sales
 FROM daily_performance 
 WHERE accountId = ${account.id}
 AND date >= DATE_SUB(CURDATE(), INTERVAL 21 DAY)
 AND date < DATE_SUB(CURDATE(), INTERVAL 7 DAY)`
        );
        const recentData = recentResult?.[0] || recentResult;
        const prevData = prevResult?.[0] || prevResult;
        const recentSpend = Number(recentData?.total_spend) || 0;
        const recentSales = Number(recentData?.total_sales) || 0;
        const prevSpend = Number(prevData?.total_spend) || 0;
        const prevSales = Number(prevData?.total_sales) || 0;
        if (recentSales > 0 && prevSales > 0) {
          const recentAcos = recentSpend / recentSales * 100;
          const prevAcos = prevSpend / prevSales * 100;
          const deterioration = prevAcos > 0 ? (recentAcos - prevAcos) / prevAcos * 100 : 0;
          if (deterioration > 20) {
            alerts.push({
              // @ts-ignore
              id: `proactive-risk-${account.id}-${Date.now()}`,
              category: "proactive_risk_warning",
              severity: deterioration > 50 ? "critical" : "warning",
              // @ts-ignore
              title: `${account.name} ${account.marketplace} ACoS\u8D8B\u52BF\u6076\u5316\u9884\u8B66`,
              message: `\u6700\u8FD17\u5929ACoS ${recentAcos.toFixed(1)}%\uFF0C\u6BD4\u524D14\u5929(${prevAcos.toFixed(1)}%)\u6076\u5316${deterioration.toFixed(0)}%\uFF0C\u9700\u63D0\u524D\u5E72\u9884`,
              metric: "acos_deterioration_rate",
              currentValue: deterioration,
              threshold: 20,
              recommendation: `\u5EFA\u8BAE\u7ACB\u5373\u68C0\u67E5\u8BE5\u8D26\u6237\u7684\u9AD8ACoS\u5173\u952E\u8BCD\uFF0C\u8003\u8651\u5207\u6362\u5230\u66F4\u4FDD\u5B88\u7684\u7B56\u7565\u6A21\u677F\u6216\u964D\u4F4E\u76EE\u6807ACoS`,
              timestamp: /* @__PURE__ */ new Date(),
              // @ts-ignore
              accountId: account.id,
              // @ts-ignore
              accountName: `${account.name} ${account.marketplace}`
            });
          }
        }
      } catch (accountErr) {
      }
    }
  } catch (e) {
    log128.warn("[MonitoringService] checkProactiveRiskWarning error:", e);
  }
}
function calculateHealthScore(alerts) {
  let score = 100;
  for (const alert of alerts) {
    switch (alert.severity) {
      case "critical":
        score -= 25;
        break;
      case "warning":
        score -= 10;
        break;
      case "info":
        score -= 3;
        break;
    }
  }
  return Math.max(0, Math.min(100, score));
}
function formatMonitoringReport(report) {
  const lines = [
    `
========== \u7CFB\u7EDF\u76D1\u63A7\u62A5\u544A ==========`,
    `\u751F\u6210\u65F6\u95F4: ${report.generatedAt.toISOString()}`,
    `\u7CFB\u7EDF\u7248\u672C: v${report.systemVersion}`,
    `\u5065\u5EB7\u8BC4\u5206: ${report.healthScore}/100 (${report.status.toUpperCase()})`,
    ``,
    `--- \u6838\u5FC3\u6307\u6807 ---`,
    `\u63D0\u4EF7\u6B21\u6570: ${report.metrics.bidRaiseCount}`,
    `\u964D\u4EF7\u6B21\u6570: ${report.metrics.bidLowerCount}`,
    `\u63D0\u4EF7/\u964D\u4EF7\u6BD4: ${report.metrics.bidRaiseToLowerRatio.toFixed(2)}:1`,
    `\u5E73\u5747ACoS\u8D85\u6807: ${report.metrics.avgAcosOverrun.toFixed(1)}%`,
    `\u540C\u6B65\u6210\u529F\u7387: ${report.metrics.syncSuccessRate.toFixed(1)}%`,
    `30\u5929\u4F18\u5316\u64CD\u4F5C: ${report.metrics.optimizationCount30d}`,
    `\u6B63\u5411\u7387: ${report.metrics.positiveRate.toFixed(1)}%`,
    `\u6D3B\u8DC3\u7B97\u6CD5: ${report.metrics.activeAlgorithms.join(", ") || "\u65E0"}`,
    `\u9AD8\u98CE\u9669\u8D26\u6237: ${report.metrics.highRiskAccounts}`
  ];
  if (report.alerts.length > 0) {
    lines.push("", `--- \u544A\u8B66 (${report.alerts.length}) ---`);
    for (const alert of report.alerts) {
      const icon = alert.severity === "critical" ? "[CRIT]" : alert.severity === "warning" ? "[WARN]" : "[INFO]";
      lines.push(`${icon} [${alert.severity.toUpperCase()}] ${alert.title}`);
      lines.push(`   ${alert.message}`);
      lines.push(`   \u5EFA\u8BAE: ${alert.recommendation}`);
    }
  } else {
    lines.push("", "\u7CFB\u7EDF\u8FD0\u884C\u6B63\u5E38\uFF0C\u65E0\u544A\u8B66");
  }
  lines.push(`
====================================
`);
  return lines.join("\n");
}
async function runMonitoringCheck(teamId) {
  log128.info("[MonitoringService] Starting monitoring check for team", teamId);
  const report = await generateMonitoringReport(teamId);
  log128.info(formatMonitoringReport(report));
  return report;
}
var log128, ALERT_THRESHOLDS;
var init_optimizationMonitoringService = __esm({
  "server/optimization/optimizationMonitoringService.ts"() {
    "use strict";
    init_logger();
    init_db2();
    init_schema2();
    init_drizzle_orm();
    log128 = createModuleLogger("OptimizationMonitoringService");
    ALERT_THRESHOLDS = {
      // 提价/降价比例超过此值触发告警
      bidRatioMax: 3,
      // ACoS超标幅度超过此百分比触发告警（如目标30%，实际超过45%即超标50%）
      acosOverrunPercent: 50,
      // 同步成功率低于此值触发告警
      syncSuccessRateMin: 100,
      // 30天内优化操作为0触发告警
      minOptimizationCount: 1,
      // 正向率低于此值触发警告
      minPositiveRate: 40,
      // 单账户ACoS超过目标的此倍数触发严重告警
      criticalAcosMultiplier: 2
    };
    __name(generateMonitoringReport, "generateMonitoringReport");
    __name(checkBidRatio, "checkBidRatio");
    __name(checkAcosOverrun, "checkAcosOverrun");
    __name(checkSyncHealth, "checkSyncHealth");
    __name(checkAlgorithmHealth2, "checkAlgorithmHealth");
    __name(checkVersionConsistency, "checkVersionConsistency");
    __name(checkUnassignedCampaigns, "checkUnassignedCampaigns");
    __name(checkProactiveRiskWarning, "checkProactiveRiskWarning");
    __name(calculateHealthScore, "calculateHealthScore");
    __name(formatMonitoringReport, "formatMonitoringReport");
    __name(runMonitoringCheck, "runMonitoringCheck");
  }
});

