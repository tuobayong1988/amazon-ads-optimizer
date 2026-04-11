// Extracted from production dist/index.js
// Original module: server/scheduler/schedulerService.ts
// Lines: 216

async function executeNgramAnalysis(searchTerms8, autoApply = false) {
  const startedAt = /* @__PURE__ */ new Date();
  try {
    const result = analyzeNgrams(searchTerms8);
    const completedAt = /* @__PURE__ */ new Date();
    return {
      taskId: 0,
      taskType: "ngram_analysis",
      status: "success",
      startedAt,
      completedAt,
      duration: Math.round((completedAt.getTime() - startedAt.getTime()) / 1e3),
      itemsProcessed: searchTerms8.length,
      suggestionsGenerated: result.filter((r) => r.isNegativeCandidate).length,
      suggestionsApplied: autoApply ? result.filter((r) => r.isNegativeCandidate).length : 0,
      resultSummary: {
        totalNgrams: result.length,
        negativeCandidates: result.filter((r) => r.isNegativeCandidate).length,
        estimatedSavings: result.filter((r) => r.isNegativeCandidate).reduce((sum2, r) => sum2 + r.totalSpend, 0)
      }
    };
  } catch (error48) {
    const completedAt = /* @__PURE__ */ new Date();
    return {
      taskId: 0,
      taskType: "ngram_analysis",
      status: "failed",
      startedAt,
      completedAt,
      duration: Math.round((completedAt.getTime() - startedAt.getTime()) / 1e3),
      itemsProcessed: 0,
      suggestionsGenerated: 0,
      suggestionsApplied: 0,
      errorMessage: error48 instanceof Error ? error48.message : "Unknown error",
      resultSummary: {}
    };
  }
}
async function executeHealthCheck(campaigns6, notificationConfig = defaultNotificationConfig) {
  const startedAt = /* @__PURE__ */ new Date();
  try {
    const allAlerts = campaigns6.flatMap(
      (campaign) => analyzeHealthMetrics(campaign, notificationConfig)
    );
    if (allAlerts.length > 0) {
      await sendBatchAlerts(allAlerts);
    }
    const completedAt = /* @__PURE__ */ new Date();
    return {
      taskId: 0,
      taskType: "health_check",
      status: "success",
      startedAt,
      completedAt,
      duration: Math.round((completedAt.getTime() - startedAt.getTime()) / 1e3),
      itemsProcessed: campaigns6.length,
      suggestionsGenerated: allAlerts.length,
      suggestionsApplied: 0,
      resultSummary: {
        campaignsChecked: campaigns6.length,
        alertsGenerated: allAlerts.length,
        criticalAlerts: allAlerts.filter((a) => a.severity === "critical").length,
        warningAlerts: allAlerts.filter((a) => a.severity === "warning").length
      }
    };
  } catch (error48) {
    const completedAt = /* @__PURE__ */ new Date();
    return {
      taskId: 0,
      taskType: "health_check",
      status: "failed",
      startedAt,
      completedAt,
      duration: Math.round((completedAt.getTime() - startedAt.getTime()) / 1e3),
      itemsProcessed: 0,
      suggestionsGenerated: 0,
      suggestionsApplied: 0,
      errorMessage: error48 instanceof Error ? error48.message : "Unknown error",
      resultSummary: {}
    };
  }
}
async function executeTrafficIsolationFull(accountId, config2) {
  const startedAt = /* @__PURE__ */ new Date();
  try {
    const fullConfig = {
      mode: config2?.mode || "full_auto",
      safetyLimits: config2?.safetyLimits || {
        maxBidChangePercent: 30,
        maxBudgetChangePercent: 50,
        maxDailyExecutions: 100,
        minConfidenceScore: 0.7
      },
      notificationConfig: config2?.notificationConfig || {
        notifyOnSuccess: true,
        notifyOnFailure: true,
        dailySummary: true
      },
      enabledTypes: config2?.enabledTypes || [
        "ngram_analysis",
        "funnel_negative_sync",
        "keyword_migration",
        "traffic_conflict_resolution"
      ]
    };
    const result = await runFullTrafficIsolationCycle(accountId, fullConfig);
    const completedAt = /* @__PURE__ */ new Date();
    return {
      taskId: 0,
      taskType: "traffic_isolation_full",
      status: result.success ? "success" : "failed",
      startedAt,
      completedAt,
      duration: Math.round((completedAt.getTime() - startedAt.getTime()) / 1e3),
      itemsProcessed: result.summary.totalNegativesAdded + result.summary.totalKeywordsMigrated + result.summary.totalConflictsResolved,
      suggestionsGenerated: result.summary.totalNegativesAdded + result.summary.totalKeywordsMigrated + result.summary.totalConflictsResolved,
      suggestionsApplied: fullConfig.mode === "full_auto" ? result.summary.totalNegativesAdded + result.summary.totalKeywordsMigrated + result.summary.totalConflictsResolved : 0,
      resultSummary: {
        negativesAdded: result.summary.totalNegativesAdded,
        keywordsMigrated: result.summary.totalKeywordsMigrated,
        conflictsResolved: result.summary.totalConflictsResolved,
        estimatedSavings: result.summary.estimatedSavings,
        ngramAnalysis: result.ngramResult.success,
        funnelSync: result.funnelResult.success,
        migration: result.migrationResult.success,
        conflictResolution: result.conflictResult.success
      }
    };
  } catch (error48) {
    const completedAt = /* @__PURE__ */ new Date();
    return {
      taskId: 0,
      taskType: "traffic_isolation_full",
      status: "failed",
      startedAt,
      completedAt,
      duration: Math.round((completedAt.getTime() - startedAt.getTime()) / 1e3),
      itemsProcessed: 0,
      suggestionsGenerated: 0,
      suggestionsApplied: 0,
      errorMessage: error48 instanceof Error ? error48.message : "Unknown error",
      resultSummary: {}
    };
  }
}
var defaultTaskConfigs;
var init_schedulerService = __esm({
  "server/scheduler/schedulerService.ts"() {
    "use strict";
    init_adAutomation();
    init_notificationService();
    init_automationExecutionEngine();
    defaultTaskConfigs = {
      ngram_analysis: {
        name: "N-Gram\u8BCD\u6839\u5206\u6790",
        description: "\u5206\u6790\u65E0\u6548\u641C\u7D22\u8BCD\u7684\u5171\u540C\u8BCD\u6839\u7279\u5F81\uFF0C\u751F\u6210\u6279\u91CF\u5426\u5B9A\u8BCD\u5EFA\u8BAE",
        schedule: "daily",
        runTime: "06:00",
        autoApply: false,
        requireApproval: true
      },
      funnel_migration: {
        name: "\u6F0F\u6597\u8FC1\u79FB\u5206\u6790",
        description: "\u76D1\u63A7\u5E7F\u6CDB\u5339\u914D\u4E2D\u8868\u73B0\u4F18\u79C0\u7684\u8BCD\uFF0C\u5EFA\u8BAE\u8FC1\u79FB\u5230\u77ED\u8BED\u6216\u7CBE\u51C6\u5339\u914D",
        schedule: "daily",
        runTime: "06:30",
        autoApply: false,
        requireApproval: true
      },
      traffic_conflict: {
        name: "\u6D41\u91CF\u51B2\u7A81\u68C0\u6D4B",
        description: "\u68C0\u6D4B\u8DE8\u5E7F\u544A\u6D3B\u52A8\u7684\u91CD\u53E0\u641C\u7D22\u8BCD\uFF0C\u5EFA\u8BAE\u6700\u4F18\u6D41\u91CF\u5206\u914D\u65B9\u6848",
        schedule: "daily",
        runTime: "07:00",
        autoApply: false,
        requireApproval: true
      },
      smart_bidding: {
        name: "\u667A\u80FD\u7ADE\u4EF7\u8C03\u6574",
        description: "\u57FA\u4E8E\u7EE9\u6548\u6570\u636E\u81EA\u52A8\u8BA1\u7B97\u6700\u4F18\u51FA\u4EF7\u8C03\u6574",
        schedule: "daily",
        runTime: "07:30",
        autoApply: false,
        requireApproval: true
      },
      health_check: {
        name: "\u5065\u5EB7\u5EA6\u68C0\u67E5",
        description: "\u76D1\u63A7\u5E7F\u544A\u6D3B\u52A8\u5065\u5EB7\u72B6\u6001\uFF0C\u68C0\u6D4B\u5F02\u5E38\u6307\u6807",
        schedule: "hourly",
        runTime: "00:00",
        autoApply: false,
        requireApproval: false
      },
      data_sync: {
        name: "\u6570\u636E\u540C\u6B65",
        description: "\u4ECETAmazon API\u540C\u6B65\u6700\u65B0\u5E7F\u544A\u6570\u636E",
        schedule: "daily",
        runTime: "05:00",
        autoApply: true,
        requireApproval: false
      },
      traffic_isolation_full: {
        name: "\u6D41\u91CF\u9694\u79BB\u81EA\u52A8\u5316",
        description: "\u5B8C\u6574\u6D41\u91CF\u9694\u79BB\u5468\u671F\uFF1AN-Gram\u5206\u6790+\u6F0F\u6597\u540C\u6B65+\u5173\u952E\u8BCD\u8FC1\u79FB+\u51B2\u7A81\u89E3\u51B3",
        schedule: "daily",
        runTime: "06:00",
        autoApply: true,
        requireApproval: false
      }
    };
    __name(executeNgramAnalysis, "executeNgramAnalysis");
    __name(executeHealthCheck, "executeHealthCheck");
    __name(executeTrafficIsolationFull, "executeTrafficIsolationFull");
  }
});

