// Extracted from production dist/index.js
// Original module: server/optimization/riskActionEngine.ts
// Lines: 725

var riskActionEngine_exports = {};
__export(riskActionEngine_exports, {
  assessAccountRisks: () => assessAccountRisks,
  assessSyncHealth: () => assessSyncHealth,
  cleanupProcessedEntries: () => cleanupProcessedEntries,
  executeRiskActions: () => executeRiskActions,
  getPendingEmergencyAccounts: () => getPendingEmergencyAccounts,
  isAccountInEmergencyQueue: () => isAccountInEmergencyQueue,
  markEmergencyOptimizationProcessed: () => markEmergencyOptimizationProcessed
});
function assessAccountRiskLevel(acos, targetAcos) {
  const effectiveTarget = targetAcos || 30;
  // v577: 降低critical阈值使风险评估更敏感
  if (acos > effectiveTarget * 2.0 || acos > 55) return "critical";
  if (acos > effectiveTarget * 1.5 || acos > 40) return "warning";
  return "healthy";
}
function getAdaptiveBidReduction(acos, riskLevel) {
  // v577: 增强critical风险账户的出价降幅
  if (riskLevel === "critical") {
    if (acos > 100) return 0.5;  // v577: 从0.4提升到0.5
    if (acos > 80) return 0.4;   // v577: 从0.3提升到0.4
    if (acos > 60) return 0.35;  // v577: 新增60%阈值
    return 0.3;                   // v577: 从0.25提升到0.3
  }
  if (riskLevel === "warning") {
    if (acos > 50) return 0.2;   // v577: 新增50%阈值
    return 0.15;
  }
  return 0;
}
function getRiskResponseStrategy(riskLevel, currentAcos) {
  const adaptiveReduction = currentAcos ? getAdaptiveBidReduction(currentAcos, riskLevel) : void 0;
  switch (riskLevel) {
    case "critical":
      return {
        bidReductionPercent: adaptiveReduction ?? 0.3,
        budgetReductionPercent: currentAcos && currentAcos > 80 ? 0.3 : 0.2,
        // v270: 预算调降20-30%
        pauseThresholdAcos: 120,
        pauseThresholdSpend: 2,
        scanInterval: "immediate",
        daypartingEnabled: true
        // v270: critical级别启用分时限制
      };
    case "warning":
      return {
        bidReductionPercent: adaptiveReduction ?? 0.15,
        budgetReductionPercent: 0.1,
        // v270: 预算调降10%
        pauseThresholdAcos: 200,
        pauseThresholdSpend: 5,
        scanInterval: "4h",
        daypartingEnabled: currentAcos !== void 0 && currentAcos > 50
        // v270: ACoS>50%时启用分时限制
      };
    case "healthy":
    default:
      return {
        bidReductionPercent: 0,
        budgetReductionPercent: 0,
        pauseThresholdAcos: 500,
        pauseThresholdSpend: 20,
        scanInterval: "12h",
        daypartingEnabled: false
      };
  }
}
async function persistRiskAlert(accountId, alertType, severity, detail) {
  const dbInstance = await getDb();
  if (!dbInstance) return;
  try {
    const { sql: sql15 } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
    await dbInstance.execute(sql15`
      INSERT INTO anomaly_alert_logs (account_id, rule_id, user_id, trigger_value, threshold_value, trigger_description, action_taken, created_at)
      VALUES (${accountId}, 0, 0, 0, 0, ${`[${alertType}] severity=${severity}: ${detail}`}, 'alert_sent', NOW())
    `);
  } catch (err) {
    log64.warn(`[persistRiskAlert] \u5199\u5165anomaly_alert_logs\u5931\u8D25: ${err.message}`);
  }
}
async function persistEmergencyTask(accountId, actionType, priority, detail) {
  const dbInstance = await getDb();
  if (!dbInstance) return false;
  // v577: 同时写入Redis紧急队列
  try {
    const { getRedisClient: getRedisClient3 } = await Promise.resolve().then(() => (init_redis(), redis_exports));
    const redisClient = await getRedisClient3();
    if (redisClient) {
      await redisClient.lpush("ppcopt:emergency_sync_queue", JSON.stringify({
        accountId, actionType, priority, detail, createdAt: new Date().toISOString()
      }));
      log64.info(`[persistEmergencyTask] v577: 紧急任务已写入Redis队列: account=${accountId}, action=${actionType}`);
    }
  } catch (redisErr) {
    log64.debug(`[persistEmergencyTask] v577: Redis写入失败(降级到DB): ${redisErr.message}`);
  }
  try {
    const { sql: sql15 } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
    const [existing] = await dbInstance.execute(sql15`
      SELECT id FROM emergency_optimization_queue
      WHERE accountId = ${accountId} AND actionType = ${actionType} AND processed = 0
      LIMIT 1
    `);
    if (existing && existing.length > 0) {
      log64.info(`[RiskActionEngine] \u8D26\u6237${accountId}\u5DF2\u6709\u672A\u5904\u7406\u7684${actionType}\u4EFB\u52A1\uFF0C\u8DF3\u8FC7\u91CD\u590D\u5165\u961F`);
      return true;
    }
    await dbInstance.execute(sql15`
      INSERT INTO emergency_optimization_queue (accountId, actionType, priority, sourceModule, detail, processed, createdAt)
      VALUES (${accountId}, ${actionType}, ${priority}, 'RiskActionEngine', ${detail}, 0, NOW())
    `);
    log64.info(`[RiskActionEngine] v245: \u8D26\u6237${accountId}\u7D27\u6025\u4F18\u5316\u4EFB\u52A1\u5DF2\u6301\u4E45\u5316\u5230\u6570\u636E\u5E93: ${actionType}`);
    return true;
  } catch (err) {
    log64.warn(`[persistEmergencyTask] \u5199\u5165emergency_optimization_queue\u5931\u8D25: ${err.message}`);
    return false;
  }
}
async function assessAccountRisks() {
  const dbInstance = await getDb();
  if (!dbInstance) return [];
  try {
    const accounts = await getAdAccounts();
    const actualSites = accounts.filter((a) => a.marketplace && a.marketplace !== "");
    const assessments = [];
    for (const account of actualSites) {
      try {
        const endDate = /* @__PURE__ */ new Date();
        const startDate = /* @__PURE__ */ new Date();
        startDate.setDate(startDate.getDate() - 6);
        const performance = await getAccountPerformanceSummary(account.id, startDate, endDate);
        const spend = performance?.totalSpend || 0;
        const sales = performance?.totalSales || 0;
        const acos = spend > 0 && sales > 0 ? spend / sales * 100 : 0;
        if (spend < 1) continue;
        const riskLevel = assessAccountRiskLevel(acos);
        const actions = [];
        if (riskLevel === "critical") {
          const adaptiveReduction = getAdaptiveBidReduction(acos, "critical");
          const riskStrategy = getRiskResponseStrategy("critical", acos);
          actions.push({
            actionType: "emergency_bid_reduction",
            priority: "P0",
            description: `\u8D26\u6237ACoS=${acos.toFixed(1)}%\u4E25\u91CD\u8D85\u6807\uFF0C\u89E6\u53D1v268\u5206\u5C42\u7EA7\u7D27\u6025\u964D\u4EF7\u7B56\u7565(\u964D\u5E45${(adaptiveReduction * 100).toFixed(0)}%)`,
            estimatedImpact: `v268: \u9884\u8BA1\u964D\u4F4E\u9AD8ACoS\u5173\u952E\u8BCD\u51FA\u4EF7${(adaptiveReduction * 100).toFixed(0)}%\uFF0C\u57FA\u4E8EACoS\u4E25\u91CD\u7A0B\u5EA6\u52A8\u6001\u8C03\u6574`
          });
          actions.push({
            actionType: "pause_extreme_loss",
            priority: "P0",
            description: `\u6682\u505CACoS>120%\u4E14\u82B1\u8D39>$2\u7684\u6781\u7AEF\u4E8F\u635F\u5173\u952E\u8BCD(\u539Fv267: ACoS>150%\u4E14\u82B1\u8D39>$3)`,
            estimatedImpact: "\u7ACB\u5373\u6B62\u635F\uFF0Cv268\u6536\u7D27\u95E8\u69DB\u540E\u53EF\u66F4\u65E9\u963B\u65AD\u4E8F\u635F"
          });
          actions.push({
            actionType: "budget_cap_reduction",
            priority: "P0",
            description: `\u8D26\u6237ACoS=${acos.toFixed(1)}%\u4E25\u91CD\u8D85\u6807\uFF0C\u8C03\u964D\u4E8F\u635F\u5E7F\u544A\u6D3B\u52A8\u65E5\u9884\u7B97${(riskStrategy.budgetReductionPercent * 100).toFixed(0)}%`,
            estimatedImpact: `\u9884\u8BA1\u51CF\u5C11\u6BCF\u65E5\u65E0\u6548\u82B1\u8D39$${(riskStrategy.budgetReductionPercent * 100).toFixed(0)}%\uFF0C\u4ECE\u6E90\u5934\u63A7\u5236\u4E8F\u635F\u89C4\u6A21`
          });
          if (riskStrategy.daypartingEnabled) {
            actions.push({
              actionType: "dayparting_restriction",
              priority: "P1",
              description: `\u542F\u7528\u5206\u65F6\u6BB5\u9650\u5236\u6295\u653E\uFF0C\u5728\u4F4E\u8F6C\u5316\u65F6\u6BB5(0:00-6:00)\u964D\u4F4E\u7ADE\u4EF750%\uFF0C\u51CF\u5C11\u65E0\u6548\u82B1\u8D39`,
              estimatedImpact: "\u9884\u8BA1\u51CF\u5C11\u4F4E\u6548\u65F6\u6BB5\u82B1\u8D3530-50%\uFF0C\u63D0\u5347\u6574\u4F53\u6295\u4EA7\u6BD4"
            });
          }
        }
        if (riskLevel === "warning" || riskLevel === "critical") {
          actions.push({
            actionType: "nextgen_reevaluate",
            priority: "P1",
            description: `\u8D26\u6237ACoS=${acos.toFixed(1)}%\u504F\u9AD8\uFF0C\u89E6\u53D1NextGen\u7B97\u6CD5\u91CD\u65B0\u8BC4\u4F30\u6240\u6709\u4F18\u5316\u76EE\u6807`,
            estimatedImpact: "\u91CD\u65B0\u8BA1\u7B97\u51FA\u4EF7\u7B56\u7565\uFF0C\u52A0\u901FACoS\u56DE\u5F52\u76EE\u6807"
          });
        }
        if (riskLevel !== "healthy") {
          await persistRiskAlert(
            // @ts-ignore
            account.id,
            // @ts-ignore
            `risk_${riskLevel}`,
            riskLevel === "critical" ? "high" : "medium",
            // @ts-ignore
            `\u8D26\u6237${account.storeName || account.accountName}(${account.marketplace}) 7\u65E5ACoS=${acos.toFixed(1)}%, \u98CE\u9669\u7B49\u7EA7=${riskLevel}, \u63A8\u8350\u884C\u52A8: ${actions.map((a) => a.actionType).join(", ")}`
          );
        }
        assessments.push({
          // @ts-ignore
          accountId: account.id,
          // @ts-ignore
          accountName: account.storeName || account.accountName || `Account ${account.id}`,
          // @ts-ignore
          marketplace: account.marketplace || "US",
          // @ts-ignore
          currentAcos: acos,
          riskLevel,
          riskEscalated: riskLevel === "critical",
          recommendedActions: actions
          // @ts-ignore
        });
      } catch (err) {
        log64.warn(`[assessAccountRisks] Error assessing account ${account.id}: ${err.message}`);
      }
    }
    return assessments.sort((a, b) => b.currentAcos - a.currentAcos);
  } catch (err) {
    log64.warn(`[assessAccountRisks] Fatal error: ${err.message}`);
    return [];
  }
}
async function assessSyncHealth() {
  const dbInstance = await getDb();
  if (!dbInstance) {
    return {
      syncedCount: 0,
      pendingCount: 0,
      failedCount: 0,
      notApplicableCount: 0,
      syncRate: 0,
      healthStatus: "critical",
      recommendedActions: []
    };
  }
  try {
    const { sql: sql15 } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
    const [statusStats] = await dbInstance.execute(
      sql15`SELECT api_sync_status, COUNT(*) as count FROM optimization_events GROUP BY api_sync_status`
    );
    const dist = statusStats || [];
    const synced = Number(dist.find((d) => d.api_sync_status === "synced")?.count || 0);
    const pending = Number(dist.find((d) => d.api_sync_status === "pending_sync" || d.api_sync_status === "pending")?.count || 0);
    const failed = Number(dist.find((d) => d.api_sync_status === "failed")?.count || 0);
    const notApplicable = Number(dist.find((d) => d.api_sync_status === "not_applicable")?.count || 0) + Number(dist.find((d) => d.api_sync_status === "invalid_legacy")?.count || 0);
    const syncableTotal = synced + pending + failed;
    const syncRate = syncableTotal > 0 ? synced / syncableTotal * 100 : 100;
    let healthStatus;
    const actions = [];
    if (failed > 0) {
      healthStatus = "critical";
      actions.push({
        actionType: "trigger_correction_scan",
        priority: "P0",
        description: `\u68C0\u6D4B\u5230${failed}\u6761\u540C\u6B65\u5931\u8D25\u4E8B\u4EF6\uFF0C\u7ACB\u5373\u89E6\u53D1\u7EA0\u9519\u626B\u63CF`,
        targetEntityCount: failed,
        estimatedImpact: "\u4FEE\u590D\u540C\u6B65\u5931\u8D25\u4E8B\u4EF6\uFF0C\u6062\u590D100%\u540C\u6B65\u6210\u529F\u7387"
      });
      await persistRiskAlert(
        0,
        // accountId=0 表示系统级告警
        "sync_health_critical",
        "high",
        `\u540C\u6B65\u5065\u5EB7\u5EA6\u5F02\u5E38: ${failed}\u6761\u5931\u8D25, ${pending}\u6761\u5F85\u540C\u6B65, \u6210\u529F\u7387=${syncRate.toFixed(1)}%`
      );
    } else if (pending > 50) {
      healthStatus = "degraded";
      actions.push({
        actionType: "accelerate_sync",
        priority: "P1",
        description: `${pending}\u6761\u4E8B\u4EF6\u5F85\u540C\u6B65\uFF0C\u89E6\u53D1\u540C\u6B65\u5F15\u64CE\u52A0\u901F\u5904\u7406`,
        targetEntityCount: pending,
        estimatedImpact: "\u52A0\u901F\u5904\u7406\u5F85\u540C\u6B65\u4E8B\u4EF6\u961F\u5217"
      });
    } else {
      healthStatus = "healthy";
    }
    return {
      syncedCount: synced,
      pendingCount: pending,
      failedCount: failed,
      notApplicableCount: notApplicable,
      syncRate,
      healthStatus,
      recommendedActions: actions
    };
  } catch (err) {
    log64.warn(`[assessSyncHealth] Error: ${err.message}`);
    return {
      syncedCount: 0,
      pendingCount: 0,
      failedCount: 0,
      notApplicableCount: 0,
      syncRate: 0,
      healthStatus: "critical",
      recommendedActions: []
    };
  }
}
async function executeRiskActions() {
  const timestamp2 = (/* @__PURE__ */ new Date()).toISOString();
  const actionResults = [];
  let actionsTriggered = 0;
  log64.info("[RiskActionEngine] \u5F00\u59CB\u98CE\u9669\u8BC4\u4F30\u548C\u884C\u52A8\u6267\u884C...");
  const accountRisks = await assessAccountRisks();
  const criticalAccounts = accountRisks.filter((a) => a.riskLevel === "critical");
  const warningAccounts = accountRisks.filter((a) => a.riskLevel === "warning");
  log64.info(`[RiskActionEngine] \u8D26\u6237\u98CE\u9669\u8BC4\u4F30\u5B8C\u6210: critical=${criticalAccounts.length}, warning=${warningAccounts.length}, healthy=${accountRisks.length - criticalAccounts.length - warningAccounts.length}`);
  for (const account of criticalAccounts) {
    for (const action of account.recommendedActions) {
      try {
        if (action.actionType === "emergency_bid_reduction") {
          const result = await markAccountForEmergencyOptimization(account.accountId, "emergency_bid_reduction", action.priority, action.description);
          actionsTriggered++;
          actionResults.push({
            actionType: "emergency_bid_reduction",
            // @ts-ignore
            accountId: account.accountId,
            success: result,
            // @ts-ignore
            detail: `\u8D26\u6237${account.accountName}(ACoS=${account.currentAcos.toFixed(1)}%)\u5DF2\u6807\u8BB0\u4E3A\u7D27\u6025\u4F18\u5316(\u5DF2\u6301\u4E45\u5316\u5230DB)`
          });
        }
        if (action.actionType === "pause_extreme_loss") {
          const result = await markAccountForEmergencyOptimization(account.accountId, "pause_extreme_loss", action.priority, action.description);
          actionsTriggered++;
          actionResults.push({
            // @ts-ignore
            actionType: "pause_extreme_loss",
            // @ts-ignore
            accountId: account.accountId,
            success: result,
            // @ts-ignore
            detail: `\u8D26\u6237${account.accountName}\u5DF2\u6807\u8BB0\u6682\u505C\u6781\u7AEF\u4E8F\u635F\u5173\u952E\u8BCD(\u5DF2\u6301\u4E45\u5316\u5230DB)`
          });
        }
        if (action.actionType === "budget_cap_reduction") {
          const result = await markAccountForEmergencyOptimization(account.accountId, "budget_cap_reduction", action.priority, action.description);
          actionsTriggered++;
          actionResults.push({
            actionType: "budget_cap_reduction",
            // @ts-ignore
            accountId: account.accountId,
            success: result,
            // @ts-ignore
            detail: `\u8D26\u6237${account.accountName}(ACoS=${account.currentAcos.toFixed(1)}%)\u5DF2\u6807\u8BB0\u9884\u7B97\u8C03\u964D(\u5DF2\u6301\u4E45\u5316\u5230DB)`
          });
        }
        if (action.actionType === "dayparting_restriction") {
          const result = await markAccountForEmergencyOptimization(account.accountId, "dayparting_restriction", action.priority, action.description);
          actionsTriggered++;
          actionResults.push({
            actionType: "dayparting_restriction",
            // @ts-ignore
            accountId: account.accountId,
            success: result,
            // @ts-ignore
            detail: `\u8D26\u6237${account.accountName}\u5DF2\u6807\u8BB0\u5206\u65F6\u6BB5\u9650\u5236\u6295\u653E(\u5DF2\u6301\u4E45\u5316\u5230DB)`
          });
        }
      } catch (err) {
        actionResults.push({
          actionType: action.actionType,
          // @ts-ignore
          accountId: account.accountId,
          success: false,
          detail: `\u6267\u884C\u5931\u8D25: ${err.message}`
        });
      }
    }
  }
  const syncHealth = await assessSyncHealth();
  if (syncHealth.healthStatus === "critical" && syncHealth.failedCount > 0) {
    try {
      const { runAutoCorrection: runAutoCorrection2 } = await Promise.resolve().then(() => (init_optimizationAutoCorrector(), optimizationAutoCorrector_exports));
      const correctionResult = await runAutoCorrection2();
      actionsTriggered++;
      actionResults.push({
        actionType: "trigger_correction_scan",
        success: true,
        detail: `\u7EA0\u9519\u626B\u63CF\u5B8C\u6210: \u53D1\u73B0${correctionResult.totalIssuesFound}\u4E2A\u95EE\u9898\uFF0C\u5DF2\u7EA0\u6B63${correctionResult.totalCorrected}\u4E2A`
      });
    } catch (err) {
      actionResults.push({
        actionType: "trigger_correction_scan",
        success: false,
        detail: `\u7EA0\u9519\u626B\u63CF\u5931\u8D25: ${err.message}`
        // @ts-ignore
      });
    }
  }
  try {
    const unassignedResult = await detectAndReportUnassignedCampaigns();
    if (unassignedResult.unassignedCount > 0) {
      actionsTriggered++;
      actionResults.push({
        actionType: "assign_unmanaged_campaigns",
        // @ts-ignore
        success: true,
        detail: `\u68C0\u6D4B\u5230${unassignedResult.unassignedCount}\u4E2A\u672A\u5206\u914D\u5E7F\u544A\u6D3B\u52A8\uFF0C\u65E5\u5747\u9884\u7B97$${unassignedResult.totalDailyBudget.toFixed(2)}\uFF0C\u5DF2\u8BB0\u5F55\u5230\u544A\u8B66\u65E5\u5FD7`
        // @ts-ignore
      });
    }
  } catch (err) {
    log64.warn(`[RiskActionEngine] \u672A\u5206\u914D\u5E7F\u544A\u6D3B\u52A8\u68C0\u6D4B\u5931\u8D25: ${err.message}`);
  }
  for (const account of warningAccounts) {
    try {
      const trendCheck = await checkAcosTrendForAccount(account.accountId);
      if (trendCheck.isDeteriorating) {
        actionsTriggered++;
        const result = await markAccountForEmergencyOptimization(
          // @ts-ignore
          account.accountId,
          "proactive_acos_intervention",
          "P1",
          `ACoS\u8D8B\u52BF\u6076\u5316\u9884\u8B66: \u8FD17\u5929ACoS ${trendCheck.recentAcos.toFixed(1)}% vs \u524D14\u5929 ${trendCheck.prevAcos.toFixed(1)}%\uFF0C\u6076\u5316${trendCheck.deteriorationRate.toFixed(0)}%`
        );
        actionResults.push({
          actionType: "proactive_acos_intervention",
          // @ts-ignore
          accountId: account.accountId,
          success: result,
          // @ts-ignore
          detail: `\u8D26\u6237${account.accountName} ACoS\u8D8B\u52BF\u6076\u5316${trendCheck.deteriorationRate.toFixed(0)}%\uFF0C\u5DF2\u89E6\u53D1\u4E3B\u52A8\u5E72\u9884`
        });
      }
    } catch (err) {
      log64.warn(`[RiskActionEngine] \u8D26\u6237${account.accountId}\u8D8B\u52BF\u68C0\u67E5\u5931\u8D25: ${err.message}`);
    }
  }
  log64.info(`[RiskActionEngine] \u98CE\u9669\u884C\u52A8\u6267\u884C\u5B8C\u6210: \u89E6\u53D1${actionsTriggered}\u4E2A\u884C\u52A8`);
  return {
    timestamp: timestamp2,
    accountRisks,
    syncHealth,
    actionsTriggered,
    actionResults
  };
}
async function markAccountForEmergencyOptimization(accountId, actionType, priority = "P1", detail = "") {
  try {
    const result = await persistEmergencyTask(accountId, actionType, priority, detail);
    log64.info(`[RiskActionEngine] \u8D26\u6237${accountId}\u5DF2\u52A0\u5165\u7D27\u6025\u4F18\u5316\u961F\u5217(DB\u6301\u4E45\u5316): ${actionType}`);
    return result;
  } catch (err) {
    log64.warn(`[RiskActionEngine] \u6807\u8BB0\u7D27\u6025\u4F18\u5316\u5931\u8D25: ${err.message}`);
    return false;
  }
}
async function isAccountInEmergencyQueue(accountId) {
  const dbInstance = await getDb();
  if (!dbInstance) return { inQueue: false };
  try {
    const { sql: sql15 } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
    const [rows] = await dbInstance.execute(sql15`
      SELECT actionType FROM emergency_optimization_queue
      WHERE accountId = ${accountId} AND processed = 0
      ORDER BY createdAt DESC LIMIT 1
    `);
    if (rows && rows.length > 0) {
      return { inQueue: true, type: rows[0].actionType };
    }
    return { inQueue: false };
  } catch (err) {
    log64.warn(`[isAccountInEmergencyQueue] \u67E5\u8BE2\u5931\u8D25: ${err.message}`);
    return { inQueue: false };
  }
}
async function markEmergencyOptimizationProcessed(accountId) {
  const dbInstance = await getDb();
  if (!dbInstance) return;
  try {
    const { sql: sql15 } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
    await dbInstance.execute(sql15`
      UPDATE emergency_optimization_queue 
      SET processed = 1, processedAt = NOW()
      WHERE accountId = ${accountId} AND processed = 0
    `);
    log64.info(`[RiskActionEngine] \u8D26\u6237${accountId}\u7D27\u6025\u4F18\u5316\u5DF2\u5904\u7406(DB\u66F4\u65B0)`);
  } catch (err) {
    log64.warn(`[markEmergencyOptimizationProcessed] \u66F4\u65B0\u5931\u8D25: ${err.message}`);
  }
}
async function getPendingEmergencyAccounts() {
  const dbInstance = await getDb();
  if (!dbInstance) return [];
  try {
    const { sql: sql15 } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
    const [rows] = await dbInstance.execute(sql15`
      SELECT accountId, actionType FROM emergency_optimization_queue
      WHERE processed = 0
      ORDER BY 
        CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 END,
        createdAt ASC
    `);
    if (!rows) return [];
    return rows.map((r) => ({ accountId: r.accountId, type: r.actionType }));
  } catch (err) {
    log64.warn(`[getPendingEmergencyAccounts] \u67E5\u8BE2\u5931\u8D25: ${err.message}`);
    return [];
  }
}
async function detectAndReportUnassignedCampaigns() {
  try {
    const unassigned = await getUnassignedCampaigns();
    const activeCampaigns = unassigned.filter((c) => c.campaignStatus === "enabled");
    if (activeCampaigns.length === 0) {
      return { unassignedCount: 0, totalDailyBudget: 0, autoAssigned: 0 };
    }
    const totalBudget = activeCampaigns.reduce((sum2, c) => sum2 + (Number(c.dailyBudget) || 0), 0);
    log64.warn(`[RiskActionEngine] v614i-fix23: \u68C0\u6D4B\u5230${activeCampaigns.length}\u4E2A\u6D3B\u8DC3\u5E7F\u544A\u6D3B\u52A8\u672A\u5206\u914D\u4F18\u5316\u76EE\u6807\uFF0C\u65E5\u5747\u9884\u7B97$${totalBudget.toFixed(2)}`);
    const groupMap = /* @__PURE__ */ new Map();
    for (const c of activeCampaigns) {
      const key = `${c.accountId}_${c.campaignType || "SP"}`;
      if (!groupMap.has(key)) groupMap.set(key, []);
      groupMap.get(key).push(c);
    }
    let autoAssigned = 0;
    const dbInstance = await getDb();
    for (const [groupKey, groupCampaigns] of groupMap.entries()) {
      const [accountIdStr, campaignType] = groupKey.split("_");
      const accountId = parseInt(accountIdStr);
      const userId = groupCampaigns[0]?.userId || 1;
      const totalSpend = groupCampaigns.reduce((s, c) => s + (Number(c.dailyBudget) || 0), 0);
      const totalSales = groupCampaigns.reduce((s, c) => s + (Number(c.sales) || 0), 0);
      const avgAcos = totalSales > 0 ? totalSpend / totalSales * 100 : 35;
      const strategyTemplateId = matchStrategyTemplate(avgAcos, campaignType);
      const strategyName = getStrategyTemplateName(strategyTemplateId);
      const typeLabel = campaignType === "SB" ? "\u54C1\u724C\u63A8\u5E7F" : campaignType === "SD" ? "\u5C55\u793A\u63A8\u5E7F" : "\u5546\u54C1\u63A8\u5E7F";
      const goalName = `[\u81EA\u52A8\u7EB3\u7BA1] ${typeLabel} ${groupCampaigns.length}\u4E2A\u5E7F\u544A\u6D3B\u52A8`;
      try {
        const defaultTargetAcos = avgAcos < 999 ? Math.min(Math.max(avgAcos * 0.9, 15), 60).toFixed(2) : "35.00";
        const defaultMaxBid = "5.00";
        const avgDailyBudget = (totalSpend / Math.max(groupCampaigns.length, 1)).toFixed(2);
        const newGroupId = await createPerformanceGroup({
          userId,
          accountId,
          name: goalName,
          description: `v614i-fix23\u81EA\u52A8\u7EB3\u7BA1: ${campaignType}\u7C7B\u578B, ${groupCampaigns.length}\u4E2A\u5E7F\u544A\u6D3B\u52A8, \u5E73\u5747ACoS ${avgAcos.toFixed(1)}%, \u7B56\u7565: ${strategyName}`,
          optimizationGoal: avgAcos > 50 ? "target_acos" : "maximize_sales",
          targetAcos: defaultTargetAcos,
          dailyBudget: avgDailyBudget,
          maxBid: defaultMaxBid,
          strategyTemplateId: String(strategyTemplateId),
          strategyTemplateName: strategyName,
          status: "active",
          autoOptimize: 1,
          daypartingEnabled: 1,
          daypartingStrategy: "performance_based",
          keywordAutoEnabled: 1,
          keywordAutoPauseEnabled: 1
        });
        if (newGroupId) {
          const campaignIds = groupCampaigns.map((c) => Number(c.id)).filter(Boolean);
          if (campaignIds.length > 0) {
            await batchAssignCampaignsToPerformanceGroup(campaignIds, newGroupId);
            autoAssigned += campaignIds.length;
            log64.info(`[RiskActionEngine] v614i-fix23: \u81EA\u52A8\u7EB3\u7BA1\u6210\u529F - \u8D26\u6237${accountId} ${campaignType} ${campaignIds.length}\u4E2A\u5E7F\u544A \u2192 \u4F18\u5316\u76EE\u6807#${newGroupId} "${goalName}" \u7B56\u7565"${strategyName}"`);
          }
        }
      } catch (createErr) {
        log64.warn(`[RiskActionEngine] v614i-fix23: \u81EA\u52A8\u7EB3\u7BA1\u5931\u8D25 \u8D26\u6237${accountId} ${campaignType}: ${createErr.message}`);
        await persistRiskAlert(
          accountId,
          "auto_assign_unmanaged",
          avgAcos > 60 ? "high" : "medium",
          JSON.stringify({
            goalName,
            strategyTemplateId,
            strategyName,
            campaignIds: groupCampaigns.map((c) => c.id),
            campaignCount: groupCampaigns.length,
            avgAcos: avgAcos.toFixed(1),
            totalDailyBudget: groupCampaigns.reduce((s, c) => s + (Number(c.dailyBudget) || 0), 0).toFixed(2),
            campaignType,
            error: createErr.message
          })
        );
      }
    }
    log64.info(`[RiskActionEngine] v614i-fix23: \u81EA\u52A8\u7EB3\u7BA1\u5B8C\u6210\uFF0C${autoAssigned}/${activeCampaigns.length}\u4E2A\u5E7F\u544A\u6D3B\u52A8\u5DF2\u7EB3\u5165\u4F18\u5316\u76EE\u6807`);
    return { unassignedCount: activeCampaigns.length, totalDailyBudget: totalBudget, autoAssigned };
  } catch (err) {
    log64.warn(`[detectAndReportUnassignedCampaigns] Error: ${err.message}`);
    return { unassignedCount: 0, totalDailyBudget: 0, autoAssigned: 0 };
  }
}
function matchStrategyTemplate(avgAcos, campaignType) {
  if (campaignType === "SB") return 9;
  if (campaignType === "SD") return 6;
  if (avgAcos > 80) return 3;
  if (avgAcos > 50) return 6;
  if (avgAcos > 30) return 2;
  if (avgAcos > 15) return 1;
  return 5;
}
function getStrategyTemplateName(templateId) {
  const names = {
    1: "\u6FC0\u8FDB\u589E\u957F",
    2: "\u7A33\u5065\u589E\u957F",
    3: "\u5229\u6DA6\u4F18\u5148",
    4: "\u6E05\u4ED3\u4FC3\u9500",
    5: "\u65B0\u54C1\u63A8\u5E7F",
    6: "\u9632\u5FA1\u578B",
    7: "\u5B63\u8282\u6027",
    8: "\u957F\u5C3E\u8BCD\u6316\u6398",
    9: "\u54C1\u724C\u9632\u5FA1",
    10: "\u7ADE\u54C1\u622A\u6D41",
    11: "\u81EA\u52A8\u6295\u653E\u4F18\u5316"
  };
  return names[templateId] || "\u7A33\u5065\u589E\u957F";
}
async function checkAcosTrendForAccount(accountId) {
  const dbInstance = await getDb();
  if (!dbInstance) return { isDeteriorating: false, recentAcos: 0, prevAcos: 0, deteriorationRate: 0 };
  try {
    const { sql: sql15 } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
    const [recentRows] = await dbInstance.execute(sql15`
      SELECT SUM(CAST(spend AS DECIMAL(10,2))) as total_spend,
             SUM(CAST(sales AS DECIMAL(10,2))) as total_sales
      FROM daily_performance
      WHERE accountId = ${accountId}
        AND date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
    `);
    const [prevRows] = await dbInstance.execute(sql15`
      SELECT SUM(CAST(spend AS DECIMAL(10,2))) as total_spend,
             SUM(CAST(sales AS DECIMAL(10,2))) as total_sales
      FROM daily_performance
      WHERE accountId = ${accountId}
        AND date >= DATE_SUB(CURDATE(), INTERVAL 21 DAY)
        AND date < DATE_SUB(CURDATE(), INTERVAL 7 DAY)
    `);
    const recent = recentRows?.[0] || recentRows;
    const prev = prevRows?.[0] || prevRows;
    const recentSpend = Number(recent?.total_spend) || 0;
    const recentSales = Number(recent?.total_sales) || 0;
    const prevSpend = Number(prev?.total_spend) || 0;
    const prevSales = Number(prev?.total_sales) || 0;
    if (recentSales > 0 && prevSales > 0) {
      const recentAcos = recentSpend / recentSales * 100;
      const prevAcos = prevSpend / prevSales * 100;
      const deteriorationRate = prevAcos > 0 ? (recentAcos - prevAcos) / prevAcos * 100 : 0;
      let riskScore = 0;
      const riskFactors = [];
      if (deteriorationRate > 0) {
        const acosTrendScore = Math.min(40, deteriorationRate * 2);
        riskScore += acosTrendScore;
        if (deteriorationRate > 15) riskFactors.push(`ACoS\u6076\u5316${deteriorationRate.toFixed(0)}%`);
      }
      const spendGrowthRate = prevSpend > 0 ? (recentSpend - prevSpend) / prevSpend * 100 : 0;
      const salesGrowthRate = prevSales > 0 ? (recentSales - prevSales) / prevSales * 100 : 0;
      const spendSalesGap = spendGrowthRate - salesGrowthRate;
      if (spendSalesGap > 10) {
        riskScore += Math.min(20, spendSalesGap);
        riskFactors.push(`\u82B1\u8D39\u589E\u901F\u8D85\u8FC7\u9500\u552E${spendSalesGap.toFixed(0)}%`);
      }
      if (recentAcos > 60) {
        riskScore += 25;
        riskFactors.push(`ACoS\u7EDD\u5BF9\u503C${recentAcos.toFixed(0)}%\u4E25\u91CD\u8D85\u6807`);
      } else if (recentAcos > 45) {
        riskScore += 15;
        riskFactors.push(`ACoS\u7EDD\u5BF9\u503C${recentAcos.toFixed(0)}%\u504F\u9AD8`);
      } else if (recentAcos > 35) {
        riskScore += 5;
      }
      const recentCvr = recentSales > 0 ? recentSales / recentSpend : 0;
      const prevCvr = prevSales > 0 ? prevSales / prevSpend : 0;
      if (prevCvr > 0 && recentCvr < prevCvr * 0.8) {
        riskScore += 15;
        riskFactors.push(`\u8F6C\u5316\u6548\u7387\u4E0B\u964D${((1 - recentCvr / prevCvr) * 100).toFixed(0)}%`);
      }
      const isDeteriorating = deteriorationRate > 15 || riskScore >= 50;
      if (isDeteriorating) {
        log64.warn(`[RiskActionEngine] v267: \u8D26\u6237${accountId}\u98CE\u9669\u8BC4\u5206=${riskScore}, \u56E0\u7D20=[${riskFactors.join(", ")}]`);
      }
      return {
        isDeteriorating,
        recentAcos,
        prevAcos,
        deteriorationRate,
        riskScore,
        riskFactors
      };
    }
    return { isDeteriorating: false, recentAcos: 0, prevAcos: 0, deteriorationRate: 0, riskScore: 0, riskFactors: [] };
  } catch (err) {
    log64.warn(`[checkAcosTrendForAccount] Error for account ${accountId}: ${err.message}`);
    return { isDeteriorating: false, recentAcos: 0, prevAcos: 0, deteriorationRate: 0 };
  }
}
async function cleanupProcessedEntries() {
  const dbInstance = await getDb();
  if (!dbInstance) return;
  try {
    const { sql: sql15 } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
    const [result] = await dbInstance.execute(sql15`
      DELETE FROM emergency_optimization_queue
      WHERE processed = 1 AND processedAt < DATE_SUB(NOW(), INTERVAL 24 HOUR)
    `);
    const deleted = result?.affectedRows || 0;
    if (deleted > 0) {
      log64.info(`[RiskActionEngine] v245: \u6E05\u7406${deleted}\u6761\u5DF2\u5904\u7406\u7684\u7D27\u6025\u4F18\u5316\u8BB0\u5F55`);
    }
  } catch (err) {
    log64.warn(`[cleanupProcessedEntries] \u6E05\u7406\u5931\u8D25: ${err.message}`);
  }
}
var log64;
var init_riskActionEngine = __esm({
  "server/optimization/riskActionEngine.ts"() {
    "use strict";
    init_db2();
    init_db2();
    init_logger();
    log64 = createModuleLogger("RiskActionEngine");
    __name(assessAccountRiskLevel, "assessAccountRiskLevel");
    __name(getAdaptiveBidReduction, "getAdaptiveBidReduction");
    __name(getRiskResponseStrategy, "getRiskResponseStrategy");
    __name(persistRiskAlert, "persistRiskAlert");
    __name(persistEmergencyTask, "persistEmergencyTask");
    __name(assessAccountRisks, "assessAccountRisks");
    __name(assessSyncHealth, "assessSyncHealth");
    __name(executeRiskActions, "executeRiskActions");
    __name(markAccountForEmergencyOptimization, "markAccountForEmergencyOptimization");
    __name(isAccountInEmergencyQueue, "isAccountInEmergencyQueue");
    __name(markEmergencyOptimizationProcessed, "markEmergencyOptimizationProcessed");
    __name(getPendingEmergencyAccounts, "getPendingEmergencyAccounts");
    __name(detectAndReportUnassignedCampaigns, "detectAndReportUnassignedCampaigns");
    __name(matchStrategyTemplate, "matchStrategyTemplate");
    __name(getStrategyTemplateName, "getStrategyTemplateName");
    __name(checkAcosTrendForAccount, "checkAcosTrendForAccount");
    __name(cleanupProcessedEntries, "cleanupProcessedEntries");
  }
});

