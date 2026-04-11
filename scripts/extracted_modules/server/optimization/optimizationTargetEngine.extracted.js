// Extracted from production dist/index.js
// Original module: server/optimization/optimizationTargetEngine.ts
// Lines: 978

var optimizationTargetEngine_exports = {};
__export(optimizationTargetEngine_exports, {
  executeAllEnabledTargets: () => executeAllEnabledTargets,
  executeOptimizationTarget: () => executeOptimizationTarget,
  getEnabledOptimizationTargets: () => getEnabledOptimizationTargets,
  getOptimizationTargetConfig: () => getOptimizationTargetConfig,
  getOptimizationTargetSummary: () => getOptimizationTargetSummary,
  getTargetLifecycleInfo: () => getTargetLifecycleInfo
});
function throttleDelay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function getAccountMarketplace2(accountId) {
  const cached2 = marketplaceCache2.get(accountId);
  if (cached2 && Date.now() < cached2.expiresAt) return cached2.value;
  const account = await getAdAccountById(accountId);
  const marketplace = account?.marketplace || "US";
  marketplaceCache2.set(accountId, { value: marketplace, expiresAt: Date.now() + CACHE_TTL_MS3 });
  return marketplace;
}
async function getLastSyncTimeForAccount(accountId) {
  try {
    const account = await getAdAccountById(accountId);
    if (account && account.lastSyncAt) {
      return new Date(account.lastSyncAt);
    }
    const { getEngineStatus: getEngineStatus2 } = await Promise.resolve().then(() => (init_unifiedSyncEngine(), unifiedSyncEngine_exports));
    const status = getEngineStatus2();
    if (status.lastSyncResults) {
      const accountResult = status.lastSyncResults?.find((r) => r.accountId === accountId);
      if (accountResult?.completedAt) {
        return new Date(accountResult.completedAt);
      }
    }
    return null;
  } catch {
    return null;
  }
}
async function getOptimizationTargetConfig(targetId) {
  const group = await getPerformanceGroupById(targetId);
  if (!group) return null;
  const config2 = {
    id: group.id,
    name: group.name,
    accountId: group.accountId,
    marketplace: await getAccountMarketplace2(group.accountId),
    isEnabled: group.status === "active",
    // v347: 修复 performanceGroupId 未赋值导致 optimization_logs 查询全部失败的严重bug
    performanceGroupId: group.id,
    // @ts-expect-error - type assertion
    optimizationGoal: group.optimizationGoal || "balanced",
    targetAcos: group.targetAcos ? parseFloat(group.targetAcos) : void 0,
    targetRoas: group.targetRoas ? parseFloat(group.targetRoas) : void 0,
    dailyBudget: group.dailyBudget ? parseFloat(group.dailyBudget) : void 0,
    maxBid: group.maxBid ? parseFloat(group.maxBid) : void 0,
    // 默认启用所有优化模块
    enableBidOptimization: true,
    enablePlacementOptimization: true,
    enableDaypartingOptimization: true,
    enableSearchTermAnalysis: true,
    enableBudgetAllocation: true,
    enableKeywordAutoExecution: true,
    executionFrequency: "daily",
    // v156: 从数据库恢复上次执行时间
    // @ts-expect-error - dynamic property access
    lastExecutionTime: group.lastOptimizationAt ? new Date(group.lastOptimizationAt) : void 0,
    nextExecutionTime: void 0,
    maxDailyBidChanges: 100,
    maxBidChangePercent: 30,
    minDataPoints: 7,
    autoRollbackEnabled: true,
    // v164: 自我进化所需字段
    // @ts-expect-error - dynamic property access
    userId: group.userId || 0,
    // @ts-expect-error - dynamic property access
    strategyTemplateId: group.strategyTemplateId || void 0
  };
  try {
    const lifecycle = await getTargetLifecycleStage(group.id);
    config2.lifecycleStage = lifecycle.overallStage;
    config2.lifecycleConfig = lifecycle.config;
    config2.lifecycleSummary = lifecycle.summary;
    config2.maxBidChangePercent = lifecycle.config.bid.maxAdjustmentPercent;
    log114.debug(`[OptimizationTargetConfig] \u76EE\u6807 ${group.name} \u751F\u547D\u5468\u671F: ${lifecycle.overallStage} (${lifecycle.summary})`);
  } catch (lcErr) {
    log114.warn(`[OptimizationTargetConfig] \u751F\u547D\u5468\u671F\u67E5\u8BE2\u5931\u8D25: ${lcErr.message}`);
  }
  return config2;
}
async function executeOptimizationTarget(targetId, options = {}) {
  const { dryRun = false, forceExecution = false, specificModules } = options;
  const config2 = await getOptimizationTargetConfig(targetId);
  if (!config2) {
    throw new Error(`\u4F18\u5316\u76EE\u6807 ${targetId} \u4E0D\u5B58\u5728`);
  }
  if (!config2.isEnabled && !forceExecution) {
    throw new Error(`\u4F18\u5316\u76EE\u6807 ${config2.name} \u672A\u542F\u7528`);
  }
  const moduleLockGroup = getModuleLockGroup(specificModules);
  if (!dryRun && !await acquireAccountOptimizationLock(config2.accountId, `optimizationTarget:${targetId}`, moduleLockGroup)) {
    throw new Error(`\u8D26\u6237 ${config2.accountId} \u6A21\u5757\u7EC4 ${moduleLockGroup} \u4F18\u5316\u9501\u5DF2\u88AB\u5360\u7528\uFF0C\u8DF3\u8FC7\u672C\u6B21\u6267\u884C`);
  }
  const shouldReleaseLock = !dryRun;
  if (isShuttingDown() && !forceExecution) {
    if (shouldReleaseLock) await releaseAccountOptimizationLock(config2.accountId, moduleLockGroup);
    throw new Error(`\u7CFB\u7EDF\u6B63\u5728\u5173\u95ED\uFF0C\u8DF3\u8FC7\u4F18\u5316\u76EE\u6807 ${config2.name} \u7684\u6267\u884C`);
  }
  const activeTaskId = registerActiveTask(`\u4F18\u5316\u76EE\u6807\u6267\u884C: ${config2.name}`, {
    targetId: config2.id,
    accountId: config2.accountId,
    module: specificModules?.join(",") || "all"
  });
  const result = {
    targetId: config2.id,
    targetName: config2.name,
    accountId: config2.accountId,
    // v167: 传递accountId到日志记录
    executionTime: /* @__PURE__ */ new Date(),
    status: "success",
    bidOptimization: { executed: false, adjustmentsCount: 0, details: [] },
    placementOptimization: { executed: false, adjustmentsCount: 0, details: [] },
    daypartingOptimization: { executed: false, adjustmentsCount: 0, details: [] },
    daypartingBudgetOptimization: { executed: false, adjustmentsCount: 0, details: [] },
    // v179
    searchTermAnalysis: { executed: false, negativeKeywordsAdded: 0, newKeywordsAdded: 0, details: [] },
    budgetAllocation: { executed: false, adjustmentsCount: 0, details: [] },
    keywordStatusChanges: { executed: false, pausedCount: 0, enabledCount: 0, details: [] },
    campaignStatusChanges: { executed: false, pausedCount: 0, enabledCount: 0, details: [] },
    adGroupStatusChanges: { executed: false, pausedCount: 0, enabledCount: 0, details: [] },
    multiDimensionOptimization: { executed: false, campaignsAnalyzed: 0, rulesGenerated: 0, details: [] },
    bidCoordination: { executed: false, campaignsCoordinated: 0, circuitBreakerTriggered: 0, details: [] },
    errors: [],
    warnings: [],
    lifecycleStage: config2.lifecycleStage,
    lifecycleSummary: config2.lifecycleSummary
  };
  if (config2.lifecycleStage) {
    log114.debug(`[OptimizationTarget] \u76EE\u6807 ${config2.name} \u5F53\u524D\u751F\u547D\u5468\u671F: ${config2.lifecycleStage} | \u51FA\u4EF7\u8C03\u6574\u4E0A\u9650: \xB1${config2.maxBidChangePercent}% | ${config2.lifecycleSummary}`);
  }
  try {
    const safetyCheck = await preOptimizationSafetyCheck(config2.accountId, targetId);
    if (!safetyCheck.safe) {
      result.warnings.push(...safetyCheck.warnings);
      log114.warn(`[OptimizationTarget] v162 \u5B89\u5168\u62A4\u680F\u89E6\u53D1: ${safetyCheck.warnings.join("; ")}`);
    }
    const riskBidMultiplier = safetyCheck.riskAssessment?.autoResponse?.bidMultiplier ?? 1;
    const riskCooldownExtension = safetyCheck.riskAssessment?.autoResponse?.cooldownExtension ?? 1;
    if (riskBidMultiplier < 1) {
      log114.info(`[OptimizationTarget] v275: \u98CE\u9669\u81EA\u52A8\u54CD\u5E94\u751F\u6548 - \u51FA\u4EF7\u4E58\u6570=${riskBidMultiplier}, \u51B7\u5374\u5EF6\u957F=${riskCooldownExtension}x`);
    }
  } catch (safetyErr) {
    log114.warn(`[OptimizationTarget] v162 \u5B89\u5168\u68C0\u67E5\u5F02\u5E38\uFF0C\u7EE7\u7EED\u6267\u884C: ${safetyErr.message}`);
  }
  try {
    const lastSyncTime = await getLastSyncTimeForAccount(config2.accountId);
    if (lastSyncTime) {
      const dataAgeMinutes = (Date.now() - lastSyncTime.getTime()) / (1e3 * 60);
      if (dataAgeMinutes > 120 && !forceExecution) {
        const staleMsg = `v221: \u6570\u636E\u65B0\u9C9C\u5EA6\u8B66\u544A - \u8D26\u6237 ${config2.accountId} \u6700\u540E\u540C\u6B65\u4E8E ${Math.round(dataAgeMinutes)} \u5206\u949F\u524D\uFF0C\u4F18\u5316\u51B3\u7B56\u53EF\u80FD\u57FA\u4E8E\u8FC7\u65F6\u6570\u636E`;
        log114.warn(`[OptimizationTarget] ${staleMsg}`);
        result.warnings.push(staleMsg);
      }
      if (dataAgeMinutes > 360 && !forceExecution) {
        const criticalMsg = `v221: \u6570\u636E\u4E25\u91CD\u8FC7\u65F6 - \u8D26\u6237 ${config2.accountId} \u6700\u540E\u540C\u6B65\u4E8E ${Math.round(dataAgeMinutes)} \u5206\u949F\u524D\uFF0C\u5C1D\u8BD5\u89E6\u53D1\u7D27\u6025\u540C\u6B65`;
        log114.warn(`[OptimizationTarget] ${criticalMsg}`);
        result.warnings.push(criticalMsg);
        try {
          const { syncAllAccounts: syncAllAccounts2 } = await Promise.resolve().then(() => (init_unifiedSyncEngine(), unifiedSyncEngine_exports));
          await syncAllAccounts2("high");
          log114.info(`[OptimizationTarget] v221: \u7D27\u6025\u540C\u6B65\u5B8C\u6210\uFF0C\u7EE7\u7EED\u6267\u884C\u4F18\u5316`);
        } catch (syncErr) {
          log114.warn(`[OptimizationTarget] v221: \u7D27\u6025\u540C\u6B65\u5931\u8D25\uFF0C\u4ECD\u7EE7\u7EED\u6267\u884C: ${syncErr.message}`);
        }
      }
    }
  } catch (freshnessErr) {
    log114.warn(`[OptimizationTarget] v221: \u6570\u636E\u65B0\u9C9C\u5EA6\u68C0\u67E5\u5F02\u5E38: ${freshnessErr.message}`);
  }
  let evolutionReport = null;
  let adaptiveParams = null;
  try {
    evolutionReport = await runEvolutionCycle(
      targetId,
      config2.userId,
      config2.accountId,
      config2.strategyTemplateId
      // @ts-ignore
    );
    if (evolutionReport) {
      log114.info(`[OptimizationTarget] v164 \u8FDB\u5316\u5468\u671F\u5B8C\u6210: \u8BC4\u4F30${evolutionReport.totalActionsEvaluated}\u4E2A\u52A8\u4F5C, \u6B63\u9762${evolutionReport.positiveActions}, \u8D1F\u9762${evolutionReport.negativeActions}, \u7EA0\u9519${evolutionReport.correctionsExecuted}\u4E2A, \u8D8B\u52BF: ${evolutionReport.improvementTrend}`);
      if (evolutionReport.correctionsExecuted > 0) {
        result.warnings.push(`\u81EA\u6211\u8FDB\u5316: \u81EA\u52A8\u7EA0\u6B63\u4E86${evolutionReport.correctionsExecuted}\u4E2A\u4E0D\u5408\u7406\u4F18\u5316`);
      }
    }
    adaptiveParams = await getAdaptiveOptimizationParams(targetId, config2.strategyTemplateId);
    if (adaptiveParams) {
      log114.debug(`[OptimizationTarget] v164 \u81EA\u9002\u5E94\u53C2\u6570: \u6700\u5927\u51FA\u4EF7\u63D0\u5347${Math.round(adaptiveParams.maxBidIncrease * 100)}%, \u6700\u5927\u51FA\u4EF7\u964D\u4F4E${Math.round(adaptiveParams.maxBidDecrease * 100)}%, \u6210\u529F\u7387${Math.round(adaptiveParams.recentSuccessRate * 100)}%`);
    }
  } catch (evoErr) {
    log114.warn(`[OptimizationTarget] v164 \u81EA\u6211\u8FDB\u5316\u5F02\u5E38\uFF0C\u7EE7\u7EED\u6267\u884C: ${evoErr.message}`);
  }
  const allCampaigns = await getCampaignsByPerformanceGroupId(targetId);
  if (allCampaigns.length === 0) {
    result.warnings.push("\u4F18\u5316\u76EE\u6807\u4E0B\u6CA1\u6709\u5E7F\u544A\u6D3B\u52A8");
    if (shouldReleaseLock) await releaseAccountOptimizationLock(config2.accountId, moduleLockGroup);
    unregisterActiveTask(activeTaskId);
    return result;
  }
  const campaigns6 = allCampaigns.filter((c) => c.campaignStatus === "enabled");
  const skippedCampaigns = allCampaigns.length - campaigns6.length;
  if (skippedCampaigns > 0) {
    log114.info(`[OptimizationTarget] v156: \u8DF3\u8FC7${skippedCampaigns}\u4E2A\u975Eenabled\u72B6\u6001\u7684campaign (\u603B${allCampaigns.length}\u4E2A, enabled=${campaigns6.length}\u4E2A)`);
    result.warnings.push(`\u8DF3\u8FC7${skippedCampaigns}\u4E2A\u975Eenabled\u72B6\u6001\u7684campaign`);
  }
  if (campaigns6.length === 0) {
    result.warnings.push("\u4F18\u5316\u76EE\u6807\u4E0B\u6CA1\u6709enabled\u72B6\u6001\u7684\u5E7F\u544A\u6D3B\u52A8");
    if (allCampaigns.length > 0 && campaigns6.length === 0) {
      const allPausedOrArchived = allCampaigns.every(
        (c) => (
          // @ts-expect-error - dynamic property access
          ["paused", "archived"].includes(c.campaignStatus || "")
        )
      );
      if (allPausedOrArchived) {
        try {
          await updatePerformanceGroup(targetId, { autoOptimize: 0 });
          const pauseMsg = `v168: \u4F18\u5316\u76EE\u6807"${config2.name}"\u5DF2\u81EA\u52A8\u6682\u505C - \u6240\u6709${allCampaigns.length}\u4E2A\u5E7F\u544A\u6D3B\u52A8\u5747\u4E3A\u6682\u505C/\u5F52\u6863\u72B6\u6001\uFF0C\u4E0D\u518D\u6267\u884C\u81EA\u52A8\u4F18\u5316`;
          log114.debug(`[OptimizationTarget] ${pauseMsg}`);
          result.warnings.push(pauseMsg);
          result.status = "skipped";
        } catch (autoPauseErr) {
          log114.warn(`[OptimizationTarget] v168: \u81EA\u52A8\u6682\u505C\u4F18\u5316\u76EE\u6807\u5931\u8D25:`, autoPauseErr.message);
        }
      }
    }
    if (shouldReleaseLock) await releaseAccountOptimizationLock(config2.accountId, moduleLockGroup);
    unregisterActiveTask(activeTaskId);
    return result;
  }
  if (!dryRun) {
    try {
      const { clearAllCaches: clearAllCaches2 } = await Promise.resolve().then(() => (init_entityIdResolver(), entityIdResolver_exports));
      clearAllCaches2();
      log114.debug("[OptimizationTarget] v429: entityIdResolver\u7F13\u5B58\u5DF2\u6E05\u7406");
    } catch (_) {
    }
    try {
      const idResolution = await ensureAmazonIdsReady(config2.accountId);
      if (idResolution.totalMissingBefore > 0) {
        const resolvedTotal = idResolution.keywordsResolved + idResolution.keywordsCreated + idResolution.keywordsCleanedUp + idResolution.productTargetsResolved;
        log114.info(`[OptimizationTarget] Pre-Sync ID Resolution: \u5904\u7406\u4E86${idResolution.totalMissingBefore}\u4E2A\u7F3A\u5931ID, \u89E3\u51B3${resolvedTotal}\u4E2A, \u5269\u4F59${idResolution.totalMissingAfter}\u4E2A`);
        if (idResolution.totalMissingAfter > 0) {
          result.warnings.push(`Pre-Sync ID Resolution: \u4ECD\u6709${idResolution.totalMissingAfter}\u4E2A\u5B9E\u4F53\u7F3A\u5C11Amazon ID`);
        }
      }
    } catch (idErr) {
      log114.warn(`[OptimizationTarget] Pre-Sync ID Resolution\u5F02\u5E38: ${idErr.message}`);
      result.warnings.push(`Pre-Sync ID Resolution\u5F02\u5E38: ${idErr.message}`);
    }
  }
  const shouldExecute = /* @__PURE__ */ __name((module2) => {
    if (specificModules && specificModules.length > 0) {
      return specificModules.includes(module2);
    }
    return true;
  }, "shouldExecute");
  let emergencyMode = false;
  try {
    const { isAccountInEmergencyQueue: isAccountInEmergencyQueue2, markEmergencyOptimizationProcessed: markEmergencyOptimizationProcessed2 } = await Promise.resolve().then(() => (init_riskActionEngine(), riskActionEngine_exports));
    const emergencyCheck = await isAccountInEmergencyQueue2(config2.accountId);
    if (emergencyCheck.inQueue) {
      emergencyMode = true;
      log114.info(`[OptimizationTarget] v235: \u8D26\u6237${config2.accountId}\u5728\u7D27\u6025\u4F18\u5316\u961F\u5217\u4E2D (${emergencyCheck.type})\uFF0C\u542F\u7528\u7D27\u6025\u4F18\u5316\u6A21\u5F0F`);
      result.warnings.push(`v235: \u7D27\u6025\u4F18\u5316\u6A21\u5F0F\u5DF2\u542F\u7528 - ${emergencyCheck.type}`);
      await markEmergencyOptimizationProcessed2(config2.accountId);
    }
  } catch (riskErr) {
    log114.warn(`[OptimizationTarget] v235: \u7D27\u6025\u4F18\u5316\u68C0\u67E5\u5F02\u5E38: ${riskErr.message}`);
  }
  if (emergencyMode) {
    log114.info(`[OptimizationTarget] v272: \u7D27\u6025\u6A21\u5F0F\u6FC0\u6D3B\uFF0C\u5E94\u7528\u4FDD\u5B88\u4F18\u5316\u53C2\u6570`);
    config2.maxBidChangePercent = Math.min(config2.maxBidChangePercent, Math.round(config2.maxBidChangePercent * 0.5));
    config2.maxDailyBidChanges = Math.min(config2.maxDailyBidChanges, Math.round(config2.maxDailyBidChanges * 0.5));
    result.warnings.push(`v272: \u7D27\u6025\u6A21\u5F0F\u5DF2\u9650\u5236\u4F18\u5316\u53C2\u6570 (maxBidChange=${config2.maxBidChangePercent}%, maxDailyChanges=${config2.maxDailyBidChanges})`);
  }
  if (config2.enableBidOptimization && shouldExecute("bid")) {
    try {
      const bidResults = await executeBidOptimization(config2, campaigns6, dryRun);
      result.bidOptimization = bidResults;
    } catch (error48) {
      result.errors.push(`\u51FA\u4EF7\u4F18\u5316\u5931\u8D25: ${error48.message}`);
    }
  }
  if (config2.enableBidOptimization && shouldExecute("bid") && !dryRun) {
    await throttleDelay(INTER_MODULE_DELAY_MS);
  }
  if (config2.enablePlacementOptimization && shouldExecute("placement")) {
    try {
      const placementResults = await executePlacementOptimization(config2, campaigns6, dryRun);
      result.placementOptimization = placementResults;
    } catch (error48) {
      result.errors.push(`\u4F4D\u7F6E\u4F18\u5316\u5931\u8D25: ${error48.message}`);
    }
  }
  if (config2.enablePlacementOptimization && shouldExecute("placement") && !dryRun) {
    await throttleDelay(INTER_MODULE_DELAY_MS);
  }
  if (config2.enableDaypartingOptimization && shouldExecute("multidim")) {
    try {
      const multiDimResults = await executeMultiDimensionOptimization(
        targetId,
        config2.accountId,
        campaigns6,
        {
          targetAcos: config2.targetAcos,
          targetRoas: config2.targetRoas,
          maxBid: config2.maxBid,
          dailyBudget: config2.dailyBudget,
          optimizationGoal: config2.optimizationGoal,
          lookbackDays: 30
        },
        dryRun
      );
      result.multiDimensionOptimization = multiDimResults;
      log114.info(`[OptimizationTarget] \u591A\u7EF4\u5EA6\u4F18\u5316\u5B8C\u6210: \u5206\u6790${multiDimResults.campaignsAnalyzed}\u4E2Acampaign, \u751F\u6210${multiDimResults.rulesGenerated}\u6761\u89C4\u5219`);
    } catch (error48) {
      result.errors.push(`\u591A\u7EF4\u5EA6\u667A\u80FD\u4F18\u5316\u5931\u8D25: ${error48.message}`);
      log114.warn(`[OptimizationTarget] \u591A\u7EF4\u5EA6\u4F18\u5316\u5F02\u5E38:`, error48.message);
    }
  }
  if (config2.enableDaypartingOptimization && shouldExecute("combo_analysis")) {
    try {
      const dbConn = await getDb();
      if (dbConn) {
        const campaignIds = campaigns6.map((c) => c.id);
        const comboResults = await executeMultiDimComboAnalysis(
          dbConn,
          config2.accountId,
          campaignIds,
          {
            targetAcos: config2.targetAcos,
            lookbackDays: 30
          }
        );
        log114.info(`[OptimizationTarget] v183 \u591A\u7EF4\u5EA6\u7EC4\u5408\u5206\u6790\u5B8C\u6210: ${comboResults.campaignsAnalyzed}\u4E2Acampaign, ${comboResults.totalCombosFound}\u4E2A\u7EC4\u5408 (\u9EC4\u91D1:${comboResults.goldenCount}, \u94C5\u77F3:${comboResults.leadenCount}, \u6F5C\u529B:${comboResults.potentialCount}, \u6807\u51C6:${comboResults.standardCount})`);
        if (result.multiDimensionOptimization) {
          result.multiDimensionOptimization.comboAnalysis = {
            goldenCount: comboResults.goldenCount,
            leadenCount: comboResults.leadenCount,
            potentialCount: comboResults.potentialCount,
            standardCount: comboResults.standardCount
          };
        }
      }
    } catch (error48) {
      log114.warn(`[OptimizationTarget] v183 \u591A\u7EF4\u5EA6\u7EC4\u5408\u5206\u6790\u5F02\u5E38:`, error48.message);
      result.warnings.push(`\u591A\u7EF4\u5EA6\u7EC4\u5408\u5206\u6790\u5931\u8D25: ${error48.message}`);
    }
  }
  if (config2.enableDaypartingOptimization && (shouldExecute("multidim") || shouldExecute("combo_analysis")) && !dryRun) {
    await throttleDelay(INTER_MODULE_DELAY_MS);
  }
  if (config2.enableDaypartingOptimization && shouldExecute("dayparting")) {
    try {
      const daypartingResults = await executeDaypartingOptimization(config2, campaigns6, dryRun);
      result.daypartingOptimization = daypartingResults;
    } catch (error48) {
      result.errors.push(`\u5206\u65F6\u7ADE\u4EF7\u4F18\u5316\u5931\u8D25: ${error48.message}`);
    }
  }
  if (config2.enableDaypartingOptimization && shouldExecute("dayparting") && !dryRun) {
    await throttleDelay(INTER_MODULE_DELAY_MS);
  }
  if (config2.enableDaypartingOptimization && shouldExecute("dayparting_budget")) {
    try {
      const daypartingBudgetResults = await executeDaypartingBudgetOptimization(config2, campaigns6, dryRun);
      result.daypartingBudgetOptimization = daypartingBudgetResults;
    } catch (error48) {
      result.errors.push(`\u5206\u65F6\u9884\u7B97\u4F18\u5316\u5931\u8D25: ${error48.message}`);
    }
  }
  if (config2.enableDaypartingOptimization && shouldExecute("dayparting_budget") && !dryRun) {
    await throttleDelay(INTER_MODULE_DELAY_MS);
  }
  if (config2.enableSearchTermAnalysis && shouldExecute("searchterm")) {
    try {
      const searchTermResults = await executeSearchTermAnalysis(config2, campaigns6, dryRun);
      result.searchTermAnalysis = searchTermResults;
    } catch (error48) {
      result.errors.push(`\u641C\u7D22\u8BCD\u5206\u6790\u5931\u8D25: ${error48.message}`);
    }
  }
  if (config2.enableSearchTermAnalysis && shouldExecute("searchterm")) {
    try {
      const ngramResults = await executeAutoNgramNegation(config2, campaigns6, dryRun);
      result.ngramAnalysis = ngramResults;
      if (ngramResults.negativeKeywordsAdded > 0) {
        log114.info(`[NgramAutoNegation] v337.3: Ngram\u81EA\u52A8\u5426\u5B9A\u5B8C\u6210: \u6DFB\u52A0${ngramResults.negativeKeywordsAdded}\u4E2A\u5426\u5B9A\u8BCD`);
      }
    } catch (error48) {
      result.errors.push(`Ngram\u81EA\u52A8\u5426\u5B9A\u5931\u8D25: ${error48.message}`);
      log114.warn(`[NgramAutoNegation] v337.3: Ngram\u81EA\u52A8\u5426\u5B9A\u5931\u8D25:`, error48.message);
    }
  }
  if (config2.enableSearchTermAnalysis && shouldExecute("searchterm") && !dryRun) {
    await throttleDelay(INTER_MODULE_DELAY_MS);
  }
  if (config2.enableBudgetAllocation && shouldExecute("budget")) {
    try {
      const budgetResults = await executeBudgetAllocation(config2, campaigns6, dryRun);
      result.budgetAllocation = budgetResults;
    } catch (error48) {
      result.errors.push(`\u9884\u7B97\u5206\u914D\u4F18\u5316\u5931\u8D25: ${error48.message}`);
    }
  }
  if (config2.enableBudgetAllocation && shouldExecute("budget") && !dryRun) {
    await throttleDelay(INTER_MODULE_DELAY_MS);
  }
  if (config2.enableKeywordAutoExecution && shouldExecute("keyword")) {
    try {
      const keywordResults = await executeKeywordStatusChanges(config2, campaigns6, dryRun);
      result.keywordStatusChanges = keywordResults;
    } catch (error48) {
      result.errors.push(`\u6295\u653E\u8BCD\u72B6\u6001\u53D8\u66F4\u5931\u8D25: ${error48.message}`);
    }
  }
  if (config2.enableKeywordAutoExecution && shouldExecute("campaign_status")) {
    try {
      const campaignResults = await executeCampaignStatusChanges(config2, campaigns6, dryRun);
      result.campaignStatusChanges = campaignResults;
    } catch (error48) {
      result.errors.push(`\u5E7F\u544A\u6D3B\u52A8\u72B6\u6001\u53D8\u66F4\u5931\u8D25: ${error48.message}`);
    }
  }
  if (config2.enableKeywordAutoExecution && shouldExecute("adgroup_status")) {
    try {
      const adGroupResults = await executeAdGroupStatusChanges(config2, campaigns6, dryRun);
      result.adGroupStatusChanges = adGroupResults;
    } catch (error48) {
      result.errors.push(`\u5E7F\u544A\u7EC4\u72B6\u6001\u53D8\u66F4\u5931\u8D25: ${error48.message}`);
    }
  }
  if (shouldExecute("coordination")) {
    try {
      const coordinationResults = await executeBidCoordination(
        // @ts-ignore
        config2,
        // @ts-ignore
        campaigns6,
        result.bidOptimization.details,
        result.placementOptimization.details,
        result.daypartingOptimization.details,
        dryRun
      );
      result.bidCoordination = coordinationResults;
      if (coordinationResults.details.length > 0) {
        for (const detail of coordinationResults.details) {
          if (detail.warnings && detail.warnings.length > 0) {
            result.warnings.push(...detail.warnings);
          }
        }
      }
    } catch (error48) {
      result.errors.push(`\u4E2D\u592E\u7ADE\u4EF7\u534F\u8C03\u5931\u8D25: ${error48.message}`);
    }
  }
  if (result.errors.length > 0) {
    result.status = result.errors.length === 7 ? "failed" : "partial";
  }
  if (!dryRun) {
    await recordExecutionLog(result);
    try {
      const { getEffectiveWeights: getEffectiveWeights2 } = await Promise.resolve().then(() => (init_weightAutoTuningService(), weightAutoTuningService_exports));
      if (config2.strategyTemplateId) {
        const currentWeights = getEffectiveWeights2(config2.strategyTemplateId, {
          coreMetric: 20,
          trend: 16,
          budgetEfficiency: 11,
          conversionEfficiency: 15,
          gradualProgress: 18,
          algorithmEfficacy: 8,
          profitHealth: 12
        });
        const bidCount = result.bidOptimization?.details?.length || 0;
        const errorCount = result.errors.length;
        log114.info(`[v272] \u6743\u91CD\u81EA\u5B66\u4E60\u5DF2\u6FC0\u6D3B: strategy=${config2.strategyTemplateId}, bidCount=${bidCount}, errors=${errorCount}`);
      }
    } catch (tuningErr) {
      log114.debug(`[v272] \u6743\u91CD\u81EA\u5B66\u4E60\u5F02\u5E38(\u4E0D\u5F71\u54CD\u4E1A\u52A1): ${tuningErr.message}`);
    }
    try {
      const { recordMetric: recordMetric2 } = await Promise.resolve().then(() => (init_algorithmObservabilityService(), algorithmObservabilityService_exports));
      recordMetric2("optimization_execution", {
        targetId: config2.id,
        accountId: config2.accountId,
        strategyTemplateId: config2.strategyTemplateId,
        bidCount: result.bidOptimization?.details?.length || 0,
        errorCount: result.errors.length,
        warningCount: result.warnings.length,
        status: result.status
      });
    } catch (_obsErr) {
    }
    try {
      const { enqueueTasks: enqueueTasks2 } = await Promise.resolve().then(() => (init_optimizationSyncEngine(), optimizationSyncEngine_exports));
      const { randomUUID: randomUUID6 } = await import("crypto");
      const failedTasks = [];
      const batchId = randomUUID6();
      if (result.bidOptimization?.details) {
        for (const detail of result.bidOptimization.details) {
          if (detail.apiSyncStatus === "failed") {
            failedTasks.push({
              batchId,
              optimizationTargetId: config2.id,
              accountId: config2.accountId,
              taskType: "bid_adjustment",
              priority: 1,
              targetEntityType: detail.isProductTarget ? "product_target" : "keyword",
              targetEntityId: detail.keywordId,
              amazonEntityId: null,
              // 将在同步引擎中查询
              targetEntityName: detail.keywordText,
              // @ts-ignore
              action: detail.newBid > detail.currentBid ? "bid_increase" : "bid_decrease",
              oldValue: String(detail.currentBid),
              newValue: String(detail.newBid),
              changeReason: detail.reason,
              algorithmUsed: detail.algorithmUsed,
              confidenceScore: detail.confidenceScore,
              campaignId: detail.localCampaignId,
              campaignName: detail.campaignName,
              // v509: 传递eventId建立tasks与events的关联
              eventId: detail.eventId || null
            });
          }
        }
      }
      if (result.keywordStatusChanges?.details) {
        for (const detail of result.keywordStatusChanges.details) {
          if (detail.apiSyncStatus === "failed") {
            failedTasks.push({
              batchId,
              optimizationTargetId: config2.id,
              accountId: config2.accountId,
              taskType: "keyword_status",
              priority: 1,
              targetEntityType: "keyword",
              targetEntityId: detail.keywordId || detail.targetId,
              amazonEntityId: null,
              targetEntityName: detail.keywordText,
              action: detail.newStatus || detail.action,
              oldValue: detail.oldStatus || detail.previousValue,
              newValue: detail.newStatus || detail.newValue,
              changeReason: detail.reason,
              campaignId: detail.localCampaignId,
              campaignName: detail.campaignName
            });
          }
        }
      }
      if (result.campaignStatusChanges?.details) {
        for (const detail of result.campaignStatusChanges.details) {
          if (detail.apiSyncStatus === "failed") {
            failedTasks.push({
              batchId,
              optimizationTargetId: config2.id,
              accountId: config2.accountId,
              taskType: "campaign_status",
              priority: 0,
              targetEntityType: "campaign",
              targetEntityId: detail.localCampaignId,
              amazonEntityId: detail.amazonCampaignId,
              targetEntityName: detail.campaignName,
              action: detail.newStatus,
              oldValue: detail.oldStatus,
              newValue: detail.newStatus,
              changeReason: detail.reason
            });
          }
        }
      }
      if (result.adGroupStatusChanges?.details) {
        for (const detail of result.adGroupStatusChanges.details) {
          if (detail.apiSyncStatus === "failed") {
            failedTasks.push({
              batchId,
              optimizationTargetId: config2.id,
              accountId: config2.accountId,
              taskType: "adgroup_status",
              priority: 0,
              targetEntityType: "adgroup",
              targetEntityId: detail.adGroupId,
              amazonEntityId: detail.amazonAdGroupId,
              targetEntityName: detail.adGroupName,
              action: detail.newStatus,
              oldValue: detail.oldStatus,
              newValue: detail.newStatus,
              changeReason: detail.reason
            });
          }
        }
      }
      if (result.searchTermAnalysis?.details) {
        for (const detail of result.searchTermAnalysis.details) {
          if (detail.apiSyncStatus === "failed") {
            if (detail.action === "add_negative") {
              const negCampaign = campaigns6.find((c) => c.id === detail.localCampaignId);
              const negAmazonCampaignId = negCampaign?.campaignId || null;
              failedTasks.push({
                batchId,
                optimizationTargetId: config2.id,
                accountId: config2.accountId,
                taskType: "negative_keyword",
                priority: 1,
                targetEntityType: "campaign",
                targetEntityId: detail.localCampaignId,
                amazonEntityId: detail.amazonCampaignId || (negAmazonCampaignId ? String(negAmazonCampaignId) : null),
                targetEntityName: detail.searchTerm,
                action: detail.matchType === "negative_exact" ? "negativeExact" : "negativePhrase",
                oldValue: "",
                newValue: detail.searchTerm,
                changeReason: detail.reason || "\u5426\u5B9A\u5173\u952E\u8BCD\u521B\u5EFA\u91CD\u8BD5",
                campaignId: detail.localCampaignId,
                campaignName: detail.campaignName,
                adGroupId: detail.adGroupId || null
              });
            } else if (detail.action === "add_negative_product_target") {
              const negProdCampaign = campaigns6.find((c) => c.id === detail.localCampaignId);
              const negProdAmazonCampaignId = negProdCampaign?.campaignId || null;
              failedTasks.push({
                batchId,
                optimizationTargetId: config2.id,
                accountId: config2.accountId,
                taskType: "negative_product_target",
                priority: 1,
                targetEntityType: "campaign",
                targetEntityId: detail.localCampaignId,
                amazonEntityId: detail.amazonCampaignId || (negProdAmazonCampaignId ? String(negProdAmazonCampaignId) : null),
                targetEntityName: detail.searchTerm,
                action: "add_negative_product_target",
                oldValue: "",
                newValue: detail.searchTerm,
                changeReason: detail.reason || "\u5426\u5B9A\u4EA7\u54C1\u5B9A\u5411\u91CD\u8BD5",
                campaignId: detail.localCampaignId,
                campaignName: detail.campaignName,
                adGroupId: detail.adGroupId || null
              });
            } else if (detail.action === "add_keyword") {
              failedTasks.push({
                batchId,
                optimizationTargetId: config2.id,
                accountId: config2.accountId,
                taskType: "new_keyword",
                priority: 1,
                targetEntityType: "keyword",
                targetEntityId: detail.localKeywordId || 0,
                amazonEntityId: null,
                targetEntityName: detail.searchTerm,
                action: `create_${detail.matchType || "exact"}`,
                oldValue: "",
                newValue: String(detail.bid || 0.5),
                changeReason: detail.reason || "\u5173\u952E\u8BCD\u521B\u5EFA\u91CD\u8BD5",
                campaignId: detail.localCampaignId,
                campaignName: detail.campaignName,
                adGroupId: detail.adGroupId || null
              });
            }
          }
        }
      }
      if (result.budgetAllocation?.details) {
        for (const detail of result.budgetAllocation.details) {
          if (detail.apiSyncStatus === "failed") {
            const campaign = campaigns6.find((c) => c.id === detail.localCampaignId);
            failedTasks.push({
              batchId,
              optimizationTargetId: config2.id,
              accountId: config2.accountId,
              taskType: "budget_adjustment",
              priority: 1,
              targetEntityType: "campaign",
              targetEntityId: detail.localCampaignId,
              amazonEntityId: detail.amazonCampaignId || campaign?.campaignId || String(detail.localCampaignId),
              targetEntityName: detail.campaignName,
              action: "budget_update",
              oldValue: String(detail.currentBudget),
              newValue: String(detail.suggestedBudget),
              changeReason: detail.reason || "\u9884\u7B97\u8C03\u6574\u91CD\u8BD5",
              campaignId: detail.localCampaignId,
              campaignName: detail.campaignName
            });
          }
        }
      }
      if (result.placementOptimization?.details) {
        for (const detail of result.placementOptimization.details) {
          if (detail.apiSyncStatus === "failed") {
            const campaign = campaigns6.find((c) => c.id === detail.localCampaignId);
            failedTasks.push({
              batchId,
              optimizationTargetId: config2.id,
              accountId: config2.accountId,
              taskType: "placement_adjustment",
              priority: 2,
              targetEntityType: "campaign",
              targetEntityId: detail.localCampaignId,
              amazonEntityId: detail.amazonCampaignId || campaign?.campaignId || String(detail.localCampaignId),
              targetEntityName: detail.campaignName,
              action: detail.placement || "placement_adjust",
              oldValue: detail.previousValue || "",
              newValue: detail.newValue || "",
              changeReason: detail.reason || "\u4F4D\u7F6E\u503E\u659C\u8C03\u6574\u91CD\u8BD5",
              campaignId: detail.localCampaignId,
              campaignName: detail.campaignName
            });
          }
        }
      }
      if (result.daypartingBudgetOptimization?.details) {
        for (const detail of result.daypartingBudgetOptimization.details) {
          if (detail.apiSyncStatus === "failed") {
            const campaign = campaigns6.find((c) => c.id === detail.localCampaignId);
            failedTasks.push({
              batchId,
              optimizationTargetId: config2.id,
              accountId: config2.accountId,
              taskType: "budget_adjustment",
              priority: 1,
              targetEntityType: "campaign",
              targetEntityId: detail.localCampaignId,
              amazonEntityId: detail.amazonCampaignId || campaign?.campaignId || String(detail.localCampaignId),
              targetEntityName: detail.campaignName,
              action: "dayparting_budget",
              oldValue: String(detail.currentBudget || detail.baseBudget || ""),
              newValue: String(detail.adjustedBudget || detail.newBudget || ""),
              changeReason: detail.reason || "\u5206\u65F6\u9884\u7B97\u8C03\u6574\u91CD\u8BD5",
              campaignId: detail.localCampaignId,
              campaignName: detail.campaignName
            });
          }
        }
      }
      if (result.daypartingOptimization?.details) {
        for (const detail of result.daypartingOptimization.details) {
          if (detail.apiSyncStatus === "failed") {
            failedTasks.push({
              batchId,
              optimizationTargetId: config2.id,
              accountId: config2.accountId,
              taskType: "bid_adjustment",
              priority: 2,
              targetEntityType: detail.isProductTarget ? "product_target" : "keyword",
              // @ts-ignore
              targetEntityId: detail.keywordId || detail.targetId,
              amazonEntityId: null,
              targetEntityName: detail.keywordText || detail.targetName,
              action: "dayparting_bid",
              oldValue: String(detail.baseBid || detail.previousBid || ""),
              newValue: String(detail.adjustedBid || detail.newBid || ""),
              changeReason: detail.reason || "\u5206\u65F6\u7ADE\u4EF7\u8C03\u6574\u91CD\u8BD5",
              campaignId: detail.localCampaignId,
              campaignName: detail.campaignName
            });
          }
        }
      }
      if (failedTasks.length > 0) {
        await enqueueTasks2(failedTasks);
        log114.warn(`[OptimizationTarget] v137: ${failedTasks.length}\u4E2A\u5931\u8D25\u4EFB\u52A1\u5DF2\u5165\u961F\u91CD\u8BD5\u961F\u5217, batchId=${batchId}`);
        result.retryBatchId = batchId;
        result.retryTaskCount = failedTasks.length;
      }
    } catch (enqueueErr) {
      log114.warn(`[OptimizationTarget] v137: \u5165\u961F\u5931\u8D25\u4EFB\u52A1\u5F02\u5E38: ${enqueueErr.message}`);
    }
  }
  try {
    const affectedEntities = [];
    if (result.bidOptimization && result.bidOptimization.adjustmentsCount > 0) affectedEntities.push("keywords");
    if (result.placementOptimization && result.placementOptimization.adjustmentsCount > 0) affectedEntities.push("campaigns");
    if (result.daypartingOptimization && result.daypartingOptimization.adjustmentsCount > 0) affectedEntities.push("keywords");
    if (result.daypartingBudgetOptimization && result.daypartingBudgetOptimization.adjustmentsCount > 0) affectedEntities.push("budgets");
    if (result.searchTermAnalysis && (result.searchTermAnalysis.negativeKeywordsAdded > 0 || result.searchTermAnalysis.newKeywordsAdded > 0)) affectedEntities.push("keywords");
    if (result.budgetAllocation && result.budgetAllocation.adjustmentsCount > 0) affectedEntities.push("budgets");
    if (result.keywordStatusChanges && (result.keywordStatusChanges.pausedCount > 0 || result.keywordStatusChanges.enabledCount > 0)) affectedEntities.push("keywords");
    if (result.campaignStatusChanges && (result.campaignStatusChanges.pausedCount > 0 || result.campaignStatusChanges.enabledCount > 0)) affectedEntities.push("campaigns");
    if (affectedEntities.length > 0) {
      const uniqueEntities = [...new Set(affectedEntities)];
      const { submitReliableConfirmation: submitReliableConfirmation2 } = await Promise.resolve().then(() => (init_commandConfirmationService(), commandConfirmationService_exports));
      const entityArray = uniqueEntities;
      const hasKeywords = entityArray.includes("keywords");
      const hasBudgets = entityArray.includes("budgets");
      const opType = hasKeywords ? "bid_change" : hasBudgets ? "budget_change" : "status_change";
      const requestId = submitReliableConfirmation2(config2.accountId, entityArray, `optimizationTarget_${config2.id}`, opType);
      log114.info(`[OptimizationTarget] v359: \u63D0\u4EA4\u53EF\u9760\u786E\u8BA4\u8BF7\u6C42 - \u8D26\u6237${config2.accountId}, \u76EE\u6807${config2.id}: ${requestId}`);
    }
  } catch (confirmErr) {
    log114.warn(`[OptimizationTarget] v221: \u89E6\u53D1\u786E\u8BA4\u540C\u6B65\u5F02\u5E38: ${confirmErr.message}`);
  }
  if (shouldReleaseLock) await releaseAccountOptimizationLock(config2.accountId, moduleLockGroup);
  unregisterActiveTask(activeTaskId);
  return result;
}
async function getEnabledOptimizationTargets(accountId) {
  const dbInstance = await getDb();
  if (!dbInstance) return [];
  const groups = accountId ? await getPerformanceGroupsByAccountId(accountId) : await getPerformanceGroupsByAccountId(0);
  const configs = [];
  // v620-fix12: 缓存账户连接状态，避免重复查询
  const accountConnectionCache = new Map();
  for (const group of groups) {
    if (group.status === "active" && group.autoOptimize !== 0) {
      // v620-fix12: 检查账户连接状态，只对已授权账户执行优化
      const acctId = group.accountId;
      if (!accountConnectionCache.has(acctId)) {
        try {
          const acct = await getAdAccountById(acctId);
          accountConnectionCache.set(acctId, acct?.connectionStatus || "unknown");
        } catch (_e) {
          accountConnectionCache.set(acctId, "unknown");
        }
      }
      const connStatus = accountConnectionCache.get(acctId);
      if (connStatus !== "connected") {
        log114.info(`[OptimizationTargetEngine] [v620-fix12] \u8df3\u8fc7\u672a\u6388\u6743\u8d26\u6237 ${acctId} \u7684PG#${group.id}, connectionStatus=${connStatus}`);
        continue;
      }
      const config2 = await getOptimizationTargetConfig(group.id);
      if (config2) {
        configs.push(config2);
      }
    }
  }
  return configs;
}
async function executeAllEnabledTargets(accountId, options = {}) {
  const targets = await getEnabledOptimizationTargets(accountId);
  const results = [];
  const modulesDesc = options.specificModules?.length ? options.specificModules.join(",") : "all";
  log114.info(`[OptimizationTargetEngine] \u6279\u91CF\u6267\u884C ${targets.length} \u4E2A\u4F18\u5316\u76EE\u6807, \u6A21\u5757: ${modulesDesc}`);
  for (const target of targets) {
    try {
      const result = await executeOptimizationTarget(target.id, options);
      results.push(result);
    } catch (error48) {
      results.push({
        targetId: target.id,
        targetName: target.name,
        accountId: target.accountId,
        // v167
        executionTime: /* @__PURE__ */ new Date(),
        status: "failed",
        bidOptimization: { executed: false, adjustmentsCount: 0, details: [] },
        placementOptimization: { executed: false, adjustmentsCount: 0, details: [] },
        daypartingOptimization: { executed: false, adjustmentsCount: 0, details: [] },
        daypartingBudgetOptimization: { executed: false, adjustmentsCount: 0, details: [] },
        // v179
        searchTermAnalysis: { executed: false, negativeKeywordsAdded: 0, newKeywordsAdded: 0, details: [] },
        budgetAllocation: { executed: false, adjustmentsCount: 0, details: [] },
        keywordStatusChanges: { executed: false, pausedCount: 0, enabledCount: 0, details: [] },
        campaignStatusChanges: { executed: false, pausedCount: 0, enabledCount: 0, details: [] },
        adGroupStatusChanges: { executed: false, pausedCount: 0, enabledCount: 0, details: [] },
        multiDimensionOptimization: { executed: false, campaignsAnalyzed: 0, rulesGenerated: 0, details: [] },
        bidCoordination: { executed: false, campaignsCoordinated: 0, circuitBreakerTriggered: 0, details: [] },
        errors: [error48.message],
        warnings: []
      });
    }
  }
  return results;
}
async function getTargetLifecycleInfo(targetId) {
  return getTargetLifecycleStage(targetId);
}
async function getOptimizationTargetSummary(targetId) {
  const config2 = await getOptimizationTargetConfig(targetId);
  if (!config2) {
    return {
      config: null,
      campaignsCount: 0,
      keywordsCount: 0,
      // @ts-ignore
      pendingActions: {
        bidAdjustments: 0,
        placementAdjustments: 0,
        negativeKeywords: 0,
        budgetAdjustments: 0
      }
    };
  }
  const campaigns6 = await getCampaignsByPerformanceGroupId(targetId);
  const keywordCounts = await Promise.all(
    campaigns6.map(async (campaign) => {
      try {
        const campaignAmazonId = getCampaignAmazonId(campaign);
        const keywords10 = await getKeywordsByCampaignId(campaignAmazonId);
        return keywords10.length;
      } catch {
        return 0;
      }
    })
  );
  const keywordsCount = keywordCounts.reduce((sum2, count11) => sum2 + count11, 0);
  let pendingActions = {
    bidAdjustments: -1,
    // -1 表示计算中/未知
    placementAdjustments: -1,
    negativeKeywords: -1,
    budgetAdjustments: -1
  };
  try {
    const dryRunPromise = executeOptimizationTarget(targetId, { dryRun: true, forceExecution: true });
    const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve(null), 15e3));
    const dryRunResult = await Promise.race([dryRunPromise, timeoutPromise]);
    if (dryRunResult) {
      pendingActions = {
        bidAdjustments: dryRunResult.bidOptimization.details.length,
        placementAdjustments: dryRunResult.placementOptimization.details.length,
        negativeKeywords: dryRunResult.searchTermAnalysis.negativeKeywordsAdded,
        budgetAdjustments: dryRunResult.budgetAllocation.details.length
      };
    }
  } catch (err) {
  }
  return {
    config: config2,
    campaignsCount: campaigns6.length,
    keywordsCount,
    pendingActions
  };
}
var log114, INTER_MODULE_DELAY_MS, CACHE_TTL_MS3, marketplaceCache2;
var init_optimizationTargetEngine = __esm({
  "server/optimization/optimizationTargetEngine.ts"() {
    "use strict";
    init_db2();
    init_db2();
    init_optimizationSafetyGuardrails();
    init_lockManager();
    init_amazonIdResolver();
    init_campaignLifecycleService();
    init_selfEvolutionEngine();
    init_multiDimensionOptimizer();
    init_multiDimComboAnalyzer();
    init_taskLifecycle();
    init_logger();
    init_idTypes();
    init_bidOptimizationExecutor();
    init_searchTermExecutor();
    init_daypartingExecutor();
    init_statusChangeExecutor();
    init_placementExecutor();
    init_budgetExecutor();
    init_bidCoordinationExecutor();
    init_executionLogger();
    log114 = createModuleLogger("TargetEngine");
    INTER_MODULE_DELAY_MS = 2e4;
    __name(throttleDelay, "throttleDelay");
    CACHE_TTL_MS3 = 30 * 60 * 1e3;
    marketplaceCache2 = /* @__PURE__ */ new Map();
    setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of marketplaceCache2.entries()) {
        if (now > entry.expiresAt) marketplaceCache2.delete(key);
      }
    }, 10 * 60 * 1e3);
    __name(getAccountMarketplace2, "getAccountMarketplace");
    __name(getLastSyncTimeForAccount, "getLastSyncTimeForAccount");
    __name(getOptimizationTargetConfig, "getOptimizationTargetConfig");
    __name(executeOptimizationTarget, "executeOptimizationTarget");
    __name(getEnabledOptimizationTargets, "getEnabledOptimizationTargets");
    __name(executeAllEnabledTargets, "executeAllEnabledTargets");
    __name(getTargetLifecycleInfo, "getTargetLifecycleInfo");
    __name(getOptimizationTargetSummary, "getOptimizationTargetSummary");
  }
});

