// Extracted from production dist/index.js
// Original module: server/optimization/optimizationScheduler.ts
// Lines: 449

var optimizationScheduler_exports = {};
__export(optimizationScheduler_exports, {
  getSchedulerStatus: () => getSchedulerStatus2,
  onCampaignsAdded: () => onCampaignsAdded,
  onTargetStatusChanged: () => onTargetStatusChanged,
  startOptimizationScheduler: () => startOptimizationScheduler,
  stopOptimizationScheduler: () => stopOptimizationScheduler,
  triggerAccountOptimizations: () => triggerAccountOptimizations,
  triggerInitialOptimization: () => triggerInitialOptimization
});
async function triggerInitialOptimization(targetId, options = { triggeredBy: "create" }) {
  const startTime = Date.now();
  const errors = [];
  log116.info(`\u89E6\u53D1\u9996\u6B21\u4F18\u5316: targetId=${targetId}, triggeredBy=${options.triggeredBy}`);
  logOptimization("OptScheduler", `\u89E6\u53D1\u9996\u6B21\u4F18\u5316`, { targetId, triggeredBy: options.triggeredBy });
  const optimizationTargetEngine = await Promise.resolve().then(() => (init_optimizationTargetEngine(), optimizationTargetEngine_exports));
  const config2 = await optimizationTargetEngine.getOptimizationTargetConfig(targetId);
  if (!config2) {
    return {
      targetId,
      targetName: "\u672A\u77E5",
      phase: "analysis",
      success: false,
      errors: ["\u4F18\u5316\u76EE\u6807\u4E0D\u5B58\u5728"],
      duration: Date.now() - startTime
    };
  }
  const result = {
    targetId,
    targetName: config2.name,
    phase: "analysis",
    success: false,
    errors: [],
    duration: 0
  };
  try {
    log116.debug(`[${config2.name}] \u9636\u6BB51: \u5FEB\u901F\u6570\u636E\u5206\u6790...`);
    const db = await getDb();
    if (!db) throw new Error("\u6570\u636E\u5E93\u8FDE\u63A5\u5931\u8D25");
    const campaignsData = await Promise.resolve().then(() => (init_db2(), db_exports)).then((m) => m.getCampaignsByPerformanceGroupId(targetId));
    if (campaignsData.length === 0) {
      result.errors.push("\u4F18\u5316\u76EE\u6807\u4E0B\u6CA1\u6709\u5E7F\u544A\u6D3B\u52A8\uFF0C\u8DF3\u8FC7\u9996\u6B21\u4F18\u5316");
      result.duration = Date.now() - startTime;
      await registerScheduledExecution(targetId, config2.name, "daily");
      return result;
    }
    let totalSpend = 0, totalSales = 0, totalClicks = 0, totalOrders = 0, totalImpressions = 0;
    for (const c of campaignsData) {
      totalSpend += parseFloat(c.spend || "0");
      totalSales += parseFloat(c.sales || "0");
      totalClicks += c.clicks || 0;
      totalOrders += c.orders || 0;
      totalImpressions += c.impressions || 0;
    }
    const avgAcos = totalSales > 0 ? totalSpend / totalSales * 100 : 0;
    const avgRoas = totalSpend > 0 ? totalSales / totalSpend : 0;
    let dataQuality = "sparse";
    if (totalClicks >= 100 && totalOrders >= 10) {
      dataQuality = "sufficient";
    } else if (totalClicks >= 20 || totalOrders >= 3) {
      dataQuality = "moderate";
    }
    result.analysisResult = {
      campaignCount: campaignsData.length,
      totalSpend,
      totalSales,
      avgAcos,
      avgRoas,
      dataQuality
    };
    log116.info(`[${config2.name}] \u6570\u636E\u5206\u6790\u5B8C\u6210: ${campaignsData.length}\u4E2A\u5E7F\u544A\u6D3B\u52A8, \u82B1\u8D39$${totalSpend.toFixed(2)}, \u9500\u552E$${totalSales.toFixed(2)}, ACoS ${avgAcos.toFixed(1)}%, ROAS ${avgRoas.toFixed(2)}, \u6570\u636E\u8D28\u91CF: ${dataQuality}`);
    logOptimization("OptScheduler", `[${config2.name}]\u6570\u636E\u5206\u6790\u5B8C\u6210`, {
      targetId,
      campaigns: campaignsData.length,
      spend: totalSpend,
      sales: totalSales,
      acos: avgAcos,
      roas: avgRoas,
      dataQuality
    });
    result.phase = "execution";
    log116.info(`[${config2.name}] \u9636\u6BB52: \u6267\u884C\u9996\u6B21\u4F18\u5316...`);
    try {
      let specificModules;
      if (dataQuality === "sparse") {
        log116.info(`[${config2.name}] \u6570\u636E\u7A00\u758F\uFF0C\u4F46\u4ECD\u6267\u884C\u6240\u6709\u6A21\u5757\uFF08\u5404\u6A21\u5757\u5185\u90E8\u4F1A\u81EA\u884C\u5224\u65AD\u6570\u636E\u5145\u5206\u6027\uFF09`);
      } else if (dataQuality === "moderate") {
        log116.info(`[${config2.name}] \u6570\u636E\u4E2D\u7B49\uFF0C\u6267\u884C\u6240\u6709\u6A21\u5757`);
      }
      const executionResult = await optimizationTargetEngine.executeOptimizationTarget(targetId, {
        dryRun: false,
        forceExecution: true,
        // 首次执行强制执行，忽略启用状态检查
        specificModules
      });
      result.executionResult = {
        status: executionResult.status,
        bidAdjustments: executionResult.bidOptimization.adjustmentsCount,
        placementAdjustments: executionResult.placementOptimization.adjustmentsCount,
        keywordChanges: {
          paused: executionResult.keywordStatusChanges.pausedCount,
          enabled: executionResult.keywordStatusChanges.enabledCount
        },
        budgetAdjustments: executionResult.budgetAllocation.adjustmentsCount,
        errors: executionResult.errors,
        warnings: executionResult.warnings
      };
      log116.info(`[${config2.name}] \u9996\u6B21\u4F18\u5316\u6267\u884C\u5B8C\u6210: \u51FA\u4EF7\u8C03\u6574${executionResult.bidOptimization.adjustmentsCount}\u4E2A, \u5173\u952E\u8BCD\u6682\u505C${executionResult.keywordStatusChanges.pausedCount}\u4E2A/\u542F\u7528${executionResult.keywordStatusChanges.enabledCount}\u4E2A, \u9884\u7B97\u8C03\u6574${executionResult.budgetAllocation.adjustmentsCount}\u4E2A`);
      if (executionResult.errors.length > 0) {
        errors.push(...executionResult.errors);
      }
    } catch (execError) {
      errors.push(`\u9996\u6B21\u4F18\u5316\u6267\u884C\u5931\u8D25: ${execError.message}`);
      log116.warn(`[${config2.name}] \u9996\u6B21\u4F18\u5316\u6267\u884C\u5931\u8D25:`, execError.message);
    }
    result.phase = "scheduling";
    log116.info(`[${config2.name}] \u9636\u6BB53: \u6CE8\u518C\u540E\u7EED\u5B9A\u65F6\u8C03\u5EA6...`);
    try {
      let frequency = "daily";
      if (dataQuality === "sparse") {
        frequency = "every_6_hours";
      } else if (dataQuality === "moderate") {
        frequency = "every_4_hours";
      }
      const schedulingResult = await registerScheduledExecution(targetId, config2.name, frequency);
      result.schedulingResult = schedulingResult;
      log116.info(`[${config2.name}] \u8C03\u5EA6\u6CE8\u518C\u5B8C\u6210: \u9891\u7387=${frequency}, \u4E0B\u6B21\u6267\u884C=${schedulingResult.nextExecutionTime.toISOString()}`);
    } catch (schedError) {
      errors.push(`\u8C03\u5EA6\u6CE8\u518C\u5931\u8D25: ${schedError.message}`);
      log116.warn(`[${config2.name}] \u8C03\u5EA6\u6CE8\u518C\u5931\u8D25:`, schedError.message);
    }
    result.success = errors.length === 0;
    result.errors = errors;
    try {
      const dbInstance = await getDb();
      if (dbInstance) {
        await dbInstance.update(performanceGroups).set({
          lastOptimizationAt: (/* @__PURE__ */ new Date()).toISOString(),
          updatedAt: (/* @__PURE__ */ new Date()).toISOString()
        }).where(eq(performanceGroups.id, targetId));
      }
    } catch (e) {
    }
    try {
      const statusEmoji = result.success ? "\u2705" : "\u26A0\uFE0F";
      await notifyOwner({
        title: `${statusEmoji} \u4F18\u5316\u76EE\u6807"${config2.name}"\u9996\u6B21\u4F18\u5316${result.success ? "\u5B8C\u6210" : "\u90E8\u5206\u5B8C\u6210"}`,
        content: [
          `\u89E6\u53D1\u65B9\u5F0F: ${options.triggeredBy === "create" ? "\u521B\u5EFA\u4F18\u5316\u76EE\u6807" : options.triggeredBy === "add_campaigns" ? "\u6DFB\u52A0\u5E7F\u544A\u6D3B\u52A8" : options.triggeredBy === "enable" ? "\u542F\u7528\u4F18\u5316\u76EE\u6807" : "\u624B\u52A8\u89E6\u53D1"}`,
          `\u5E7F\u544A\u6D3B\u52A8\u6570: ${result.analysisResult?.campaignCount || 0}`,
          `\u6570\u636E\u8D28\u91CF: ${dataQuality === "sufficient" ? "\u5145\u8DB3" : dataQuality === "moderate" ? "\u4E2D\u7B49" : "\u7A00\u758F"}`,
          // @ts-expect-error - runtime type mismatch
          result.executionResult ? `\u51FA\u4EF7\u8C03\u6574: ${result.executionResult.bidAdjustments}\u4E2A` : "",
          // @ts-expect-error - runtime type mismatch
          result.executionResult ? `\u5173\u952E\u8BCD\u53D8\u66F4: \u6682\u505C${result.executionResult.keywordChanges?.paused || 0}\u4E2A, \u542F\u7528${result.executionResult.keywordChanges?.enabled || 0}\u4E2A` : "",
          result.schedulingResult ? `\u540E\u7EED\u8C03\u5EA6: ${result.schedulingResult.frequency}, \u4E0B\u6B21\u6267\u884C${result.schedulingResult.nextExecutionTime.toLocaleString()}` : "",
          errors.length > 0 ? `
\u8B66\u544A: ${errors.join("; ")}` : ""
        ].filter(Boolean).join("\n")
      });
    } catch (e) {
    }
  } catch (error48) {
    result.errors.push(`\u9996\u6B21\u4F18\u5316\u5931\u8D25: ${error48.message}`);
    log116.warn(`[${result.targetName}] \u9996\u6B21\u4F18\u5316\u5931\u8D25:`, error48);
  }
  result.duration = Date.now() - startTime;
  log116.info(`\u9996\u6B21\u4F18\u5316\u5B8C\u6210: targetId=${targetId}, \u8017\u65F6${result.duration}ms, \u6210\u529F=${result.success}`);
  logOptimization("OptScheduler", `\u9996\u6B21\u4F18\u5316\u5B8C\u6210`, {
    targetId,
    targetName: result.targetName,
    duration: result.duration,
    success: result.success,
    errors: result.errors.length
  });
  return result;
}
async function registerScheduledExecution(targetId, targetName, frequency) {
  unregisterScheduledExecution(targetId);
  const intervalMs = FREQUENCY_MS[frequency] || FREQUENCY_MS["daily"];
  const nextExecutionTime = new Date(Date.now() + intervalMs);
  const scheduledTarget = {
    targetId,
    targetName,
    intervalMs,
    timer: null,
    lastExecutionTime: /* @__PURE__ */ new Date(),
    nextExecutionTime,
    executionCount: 1,
    // 首次执行已完成
    status: "scheduled",
    lastError: null
  };
  scheduledTarget.timer = null;
  scheduledTargets.set(targetId, scheduledTarget);
  log116.info(`v189: \u5DF2\u6CE8\u518C\u4F18\u5316\u76EE\u6807: targetId=${targetId}, name=${targetName} (\u5B9A\u65F6\u6267\u884C\u7531dataSyncScheduler\u7EDF\u4E00\u7BA1\u7406)`);
  return { frequency, nextExecutionTime };
}
function unregisterScheduledExecution(targetId) {
  const existing = scheduledTargets.get(targetId);
  if (existing) {
    if (existing.timer) {
      clearInterval(existing.timer);
    }
    scheduledTargets.delete(targetId);
    log116.info(`\u5DF2\u53D6\u6D88\u5B9A\u65F6\u6267\u884C: targetId=${targetId}, name=${existing.targetName}`);
  }
}
async function startOptimizationScheduler() {
  if (isSchedulerRunning) {
    log116.debug("\u8C03\u5EA6\u5668\u5DF2\u5728\u8FD0\u884C\u4E2D");
    return { total: 0, scheduled: scheduledTargets.size, errors: 0 };
  }
  log116.info("\u542F\u52A8\u4F18\u5316\u8C03\u5EA6\u5668...");
  logSystem("OptScheduler", "\u4F18\u5316\u8C03\u5EA6\u5668\u542F\u52A8\u4E2D");
  isSchedulerRunning = true;
  try {
    const dbInstance = await getDb();
    if (!dbInstance) {
      log116.warn("\u6570\u636E\u5E93\u8FDE\u63A5\u5931\u8D25\uFF0C\u8C03\u5EA6\u5668\u542F\u52A8\u5931\u8D25");
      return { total: 0, scheduled: 0, errors: 1 };
    }
    const activeTargets = await dbInstance.select({
      id: performanceGroups.id,
      name: performanceGroups.name,
      status: performanceGroups.status,
      optimizationGoal: performanceGroups.optimizationGoal
    }).from(performanceGroups).where(eq(performanceGroups.status, "active"));
    let scheduled = 0;
    let errors = 0;
    for (const target of activeTargets) {
      try {
        const campaigns6 = await Promise.resolve().then(() => (init_db2(), db_exports)).then((m) => m.getCampaignsByPerformanceGroupId(target.id));
        if (campaigns6.length === 0) {
          log116.info(`\u8DF3\u8FC7\u65E0\u5E7F\u544A\u6D3B\u52A8\u7684\u4F18\u5316\u76EE\u6807: ${target.name} (id=${target.id})`);
          continue;
        }
        await registerScheduledExecution(target.id, target.name, "daily");
        scheduled++;
      } catch (error48) {
        log116.warn(`\u6CE8\u518C\u4F18\u5316\u76EE\u6807 ${target.id} \u5931\u8D25:`, error48.message);
        errors++;
      }
    }
    log116.info(`\u8C03\u5EA6\u5668\u542F\u52A8\u5B8C\u6210: \u5171${activeTargets.length}\u4E2A\u6D3B\u8DC3\u76EE\u6807, \u5DF2\u6CE8\u518C${scheduled}\u4E2A, \u5931\u8D25${errors}\u4E2A`);
    logSystem("OptScheduler", "\u4F18\u5316\u8C03\u5EA6\u5668\u542F\u52A8\u5B8C\u6210", {
      total: activeTargets.length,
      scheduled,
      errors
    });
    return { total: activeTargets.length, scheduled, errors };
  } catch (error48) {
    log116.warn("\u8C03\u5EA6\u5668\u542F\u52A8\u5931\u8D25:", error48.message);
    isSchedulerRunning = false;
    return { total: 0, scheduled: 0, errors: 1 };
  }
}
function stopOptimizationScheduler() {
  log116.debug("\u505C\u6B62\u4F18\u5316\u8C03\u5EA6\u5668...");
  for (const [targetId, scheduled] of scheduledTargets) {
    if (scheduled.timer) {
      clearInterval(scheduled.timer);
    }
  }
  scheduledTargets.clear();
  isSchedulerRunning = false;
  log116.debug("\u8C03\u5EA6\u5668\u5DF2\u505C\u6B62");
}
function getSchedulerStatus2() {
  return {
    isRunning: isSchedulerRunning,
    scheduledCount: scheduledTargets.size,
    targets: Array.from(scheduledTargets.values()).map((t2) => ({
      targetId: t2.targetId,
      targetName: t2.targetName,
      status: t2.status,
      lastExecutionTime: t2.lastExecutionTime?.toISOString() || null,
      nextExecutionTime: t2.nextExecutionTime?.toISOString() || null,
      executionCount: t2.executionCount,
      lastError: t2.lastError
    }))
  };
}
async function onTargetStatusChanged(targetId, newStatus) {
  if (newStatus === "active") {
    log116.info(`\u4F18\u5316\u76EE\u6807 ${targetId} \u5DF2\u542F\u7528\uFF0C\u89E6\u53D1\u9996\u6B21\u4F18\u5316`);
    triggerInitialOptimization(targetId, { triggeredBy: "enable" }).catch((err) => {
      log116.warn(`\u542F\u7528\u89E6\u53D1\u4F18\u5316\u5931\u8D25:`, err);
    });
  } else {
    unregisterScheduledExecution(targetId);
    log116.debug(`\u4F18\u5316\u76EE\u6807 ${targetId} \u5DF2${newStatus === "paused" ? "\u6682\u505C" : "\u5F52\u6863"}\uFF0C\u5DF2\u53D6\u6D88\u8C03\u5EA6`);
  }
}
async function onCampaignsAdded(targetId, campaignIds) {
  log116.info(`${campaignIds.length}\u4E2A\u5E7F\u544A\u6D3B\u52A8\u5DF2\u6DFB\u52A0\u5230\u4F18\u5316\u76EE\u6807 ${targetId}\uFF0C\u89E6\u53D1\u4F18\u5316`);
  triggerInitialOptimization(targetId, {
    triggeredBy: "add_campaigns",
    campaignIds
  }).catch((err) => {
    log116.warn(`\u6DFB\u52A0\u5E7F\u544A\u6D3B\u52A8\u89E6\u53D1\u4F18\u5316\u5931\u8D25:`, err);
  });
}
async function triggerAccountOptimizations(accountId, triggeredBy = "data_sync_complete") {
  log116.info(`v151: \u89E6\u53D1\u8D26\u6237 ${accountId} \u4E0B\u6240\u6709\u4F18\u5316\u76EE\u6807, \u6765\u6E90: ${triggeredBy}`);
  logOptimization("OptScheduler", `\u89E6\u53D1\u8D26\u6237\u4F18\u5316`, { accountId, triggeredBy });
  try {
    const { isDeployRecoveryComplete: isDeployRecoveryComplete2 } = await Promise.resolve().then(() => (init_deployLifecycleManager(), deployLifecycleManager_exports));
    if (!isDeployRecoveryComplete2() && !triggeredBy.startsWith("deploy_recovery") && !triggeredBy.startsWith("post_deploy") && triggeredBy !== "version_upgrade") {
      log116.info(`[OptScheduler] v491: \u90E8\u7F72\u6062\u590D\u5C1A\u672A\u5B8C\u6210\uFF0C\u8DF3\u8FC7\u8D26\u6237${accountId}\u7684\u4F18\u5316\u89E6\u53D1 (\u6765\u6E90: ${triggeredBy})`);
      return {
        triggeredCount: 0,
        skippedCount: 0,
        errorCount: 0,
        details: [{ targetId: 0, targetName: "all", status: "skipped", reason: "deploy_recovery_not_complete" }]
      };
    }
  } catch (gateErr) {
    log116.warn(`[OptScheduler] v491: \u90E8\u7F72\u6062\u590D\u95E8\u63A7\u68C0\u67E5\u5931\u8D25\uFF0C\u9ED8\u8BA4\u5141\u8BB8\u6267\u884C: ${gateErr.message}`);
  }
  const result = {
    triggeredCount: 0,
    skippedCount: 0,
    errorCount: 0,
    details: []
  };
  try {
    const dbInstance = await getDb();
    if (!dbInstance) {
      log116.warn(`v151: \u6570\u636E\u5E93\u8FDE\u63A5\u5931\u8D25`);
      result.errorCount = 1;
      return result;
    }
    const activeTargets = await dbInstance.select({
      id: performanceGroups.id,
      name: performanceGroups.name,
      status: performanceGroups.status
    }).from(performanceGroups).where(
      and(
        eq(performanceGroups.accountId, accountId),
        eq(performanceGroups.status, "active")
      )
    );
    if (activeTargets.length === 0) {
      log116.debug(`v151: \u8D26\u6237 ${accountId} \u4E0B\u6CA1\u6709\u6D3B\u8DC3\u7684\u4F18\u5316\u76EE\u6807`);
      return result;
    }
    log116.info(`v151: \u8D26\u6237 ${accountId} \u4E0B\u53D1\u73B0 ${activeTargets.length} \u4E2A\u6D3B\u8DC3\u4F18\u5316\u76EE\u6807`);
    const optimizationTargetEngine = await Promise.resolve().then(() => (init_optimizationTargetEngine(), optimizationTargetEngine_exports));
    for (const target of activeTargets) {
      try {
        const lastExecution = scheduledTargets.get(target.id);
        if (lastExecution?.lastExecutionTime) {
          const timeSinceLastExec = Date.now() - lastExecution.lastExecutionTime.getTime();
          const MIN_INTERVAL_MS = 30 * 60 * 1e3;
          if (timeSinceLastExec < MIN_INTERVAL_MS) {
            result.skippedCount++;
            result.details.push({
              targetId: target.id,
              targetName: target.name,
              status: "skipped",
              reason: `\u51B7\u5374\u671F\u5185\uFF08\u8DDD\u4E0A\u6B21\u6267\u884C ${Math.round(timeSinceLastExec / 6e4)} \u5206\u949F\uFF09`
            });
            continue;
          }
        }
        const campaigns6 = await Promise.resolve().then(() => (init_db2(), db_exports)).then((m) => m.getCampaignsByPerformanceGroupId(target.id));
        if (campaigns6.length === 0) {
          result.skippedCount++;
          result.details.push({
            targetId: target.id,
            targetName: target.name,
            status: "skipped",
            reason: "\u65E0\u5E7F\u544A\u6D3B\u52A8"
          });
          continue;
        }
        log116.info(`v151: \u6267\u884C\u4F18\u5316\u76EE\u6807 ${target.name} (id=${target.id})`);
        const execResult = await optimizationTargetEngine.executeOptimizationTarget(target.id);
        const INTER_TARGET_DELAY_MS = 3e4;
        log116.info(`v476: \u76EE\u6807\u95F4\u8282\u6D41 - \u7B49\u5F85${INTER_TARGET_DELAY_MS / 1e3}\u79D2\u540E\u6267\u884C\u4E0B\u4E00\u4E2A\u76EE\u6807...`);
        await new Promise((resolve) => setTimeout(resolve, INTER_TARGET_DELAY_MS));
        if (scheduledTargets.has(target.id)) {
          scheduledTargets.get(target.id).lastExecutionTime = /* @__PURE__ */ new Date();
        }
        result.triggeredCount++;
        result.details.push({
          targetId: target.id,
          targetName: target.name,
          status: "triggered"
        });
        log116.info(`v151: \u4F18\u5316\u76EE\u6807 ${target.name} \u6267\u884C\u5B8C\u6210`);
      } catch (error48) {
        result.errorCount++;
        result.details.push({
          targetId: target.id,
          targetName: target.name,
          status: "error",
          reason: error48.message
        });
        log116.warn(`v151: \u4F18\u5316\u76EE\u6807 ${target.name} \u6267\u884C\u5931\u8D25:`, error48.message);
      }
    }
    log116.info(`v151: \u8D26\u6237 ${accountId} \u4F18\u5316\u89E6\u53D1\u5B8C\u6210: \u89E6\u53D1=${result.triggeredCount}, \u8DF3\u8FC7=${result.skippedCount}, \u9519\u8BEF=${result.errorCount}`);
  } catch (error48) {
    log116.warn(`v151: \u8D26\u6237 ${accountId} \u4F18\u5316\u89E6\u53D1\u5F02\u5E38:`, error48.message);
    result.errorCount++;
  }
  return result;
}
var log116, scheduledTargets, isSchedulerRunning, FREQUENCY_MS;
var init_optimizationScheduler = __esm({
  "server/optimization/optimizationScheduler.ts"() {
    "use strict";
    init_db2();
    init_schema2();
    init_drizzle_orm();
    init_notification();
    init_logger();
    init_opsLogger();
    log116 = createModuleLogger("OptScheduler");
    scheduledTargets = /* @__PURE__ */ new Map();
    isSchedulerRunning = false;
    FREQUENCY_MS = {
      "hourly": 60 * 60 * 1e3,
      // 1小时
      "every_2_hours": 2 * 60 * 60 * 1e3,
      // 2小时
      "every_4_hours": 4 * 60 * 60 * 1e3,
      // 4小时
      "every_6_hours": 6 * 60 * 60 * 1e3,
      // 6小时
      "daily": 24 * 60 * 60 * 1e3,
      // 24小时
      "weekly": 7 * 24 * 60 * 60 * 1e3
      // 7天
    };
    __name(triggerInitialOptimization, "triggerInitialOptimization");
    __name(registerScheduledExecution, "registerScheduledExecution");
    __name(unregisterScheduledExecution, "unregisterScheduledExecution");
    __name(startOptimizationScheduler, "startOptimizationScheduler");
    __name(stopOptimizationScheduler, "stopOptimizationScheduler");
    __name(getSchedulerStatus2, "getSchedulerStatus");
    __name(onTargetStatusChanged, "onTargetStatusChanged");
    __name(onCampaignsAdded, "onCampaignsAdded");
    __name(triggerAccountOptimizations, "triggerAccountOptimizations");
  }
});

