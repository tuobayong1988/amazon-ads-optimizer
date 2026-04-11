// Extracted from production dist/index.js
// Original module: server/optimization/coldStartService.ts
// Lines: 578

var coldStartService_exports = {};
__export(coldStartService_exports, {
  getColdStartLogs: () => getColdStartLogs,
  getColdStartStatus: () => getColdStartStatus,
  getRunningColdStarts: () => getRunningColdStarts,
  isAnyColdStartRunning: () => isAnyColdStartRunning,
  triggerColdStart: () => triggerColdStart,
  triggerColdStartForAllAccounts: () => triggerColdStartForAllAccounts
});
async function triggerColdStart(accountId, options) {
  const { reason, force = false } = options;
  if (!force) {
    const lastRequestTime = coldStartRequestTimestamps.get(accountId);
    if (lastRequestTime && Date.now() - lastRequestTime < COLD_START_DEBOUNCE_MS) {
      const secondsSince = Math.round((Date.now() - lastRequestTime) / 1e3);
      return { triggered: false, reason: `v580: \u9632\u6296\u62E6\u622A - ${secondsSince}\u79D2\u524D\u5DF2\u6536\u5230\u8BF7\u6C42\uFF0C${Math.round((COLD_START_DEBOUNCE_MS - (Date.now() - lastRequestTime)) / 1e3)}\u79D2\u540E\u53EF\u91CD\u8BD5` };
    }
  }
  coldStartRequestTimestamps.set(accountId, Date.now());
  log117.info(`[ColdStart] v${SYSTEM_VERSION}: \u6536\u5230\u51B7\u542F\u52A8\u8BF7\u6C42 - \u8D26\u6237=${accountId}, \u539F\u56E0=${reason}, \u5F3A\u5236=${force}`);
  logSystem("ColdStart", `\u51B7\u542F\u52A8\u8BF7\u6C42`, { accountId, reason, force });
  if (runningColdStarts.has(accountId)) {
    log117.warn(`[ColdStart] \u8D26\u6237 ${accountId} \u5DF2\u6709\u51B7\u542F\u52A8\u6B63\u5728\u6267\u884C\uFF0C\u8DF3\u8FC7`);
    return { triggered: false, reason: "\u5DF2\u6709\u51B7\u542F\u52A8\u6B63\u5728\u6267\u884C" };
  }
  if (isShuttingDown()) {
    log117.warn(`[ColdStart] \u7CFB\u7EDF\u6B63\u5728\u5173\u95ED\uFF0C\u8DF3\u8FC7\u51B7\u542F\u52A8`);
    return { triggered: false, reason: "\u7CFB\u7EDF\u6B63\u5728\u5173\u95ED" };
  }
  if (!force) {
    const shouldSkip = await checkIdempotency(accountId, reason);
    if (shouldSkip) {
      log117.info(`[ColdStart] \u8D26\u6237 ${accountId} \u5E42\u7B49\u6027\u68C0\u67E5\u672A\u901A\u8FC7: ${shouldSkip}`);
      return { triggered: false, reason: shouldSkip };
    }
  }
  const logId = await createColdStartLog(accountId, reason);
  runningColdStarts.add(accountId);
  executeColdStart(accountId, options, logId).finally(() => {
    runningColdStarts.delete(accountId);
  });
  return { triggered: true, logId };
}
async function triggerColdStartForAllAccounts(reason, options = {}) {
  log117.info(`[ColdStart] v${SYSTEM_VERSION}: \u6279\u91CF\u51B7\u542F\u52A8\u5F00\u59CB - \u539F\u56E0=${reason}`);
  const result = { total: 0, triggered: 0, skipped: 0, errors: 0 };
  try {
    const { discoverSyncableAccounts: discoverSyncableAccounts2 } = await Promise.resolve().then(() => (init_unifiedSyncEngine(), unifiedSyncEngine_exports));
    const accounts = await discoverSyncableAccounts2();
    result.total = accounts.length;
    log117.info(`[ColdStart] \u53D1\u73B0 ${accounts.length} \u4E2A\u8D26\u6237\u9700\u8981\u51B7\u542F\u52A8`);
    for (const account of accounts) {
      try {
        const triggerResult = await triggerColdStart(account.accountId, {
          reason,
          ...options
        });
        if (triggerResult.triggered) {
          result.triggered++;
          await sleep(5e3);
        } else {
          result.skipped++;
        }
      } catch (err) {
        result.errors++;
        log117.warn(`[ColdStart] \u8D26\u6237 ${account.accountId} \u51B7\u542F\u52A8\u89E6\u53D1\u5931\u8D25: ${err.message}`);
      }
    }
    log117.info(`[ColdStart] \u6279\u91CF\u51B7\u542F\u52A8\u5B8C\u6210: \u603B\u8BA1=${result.total}, \u89E6\u53D1=${result.triggered}, \u8DF3\u8FC7=${result.skipped}, \u9519\u8BEF=${result.errors}`);
  } catch (err) {
    log117.warn(`[ColdStart] \u6279\u91CF\u51B7\u542F\u52A8\u5F02\u5E38: ${err.message}`);
  }
  return result;
}
async function executeColdStart(accountId, options, logId) {
  const startTime = Date.now();
  const {
    reason,
    historicalDays = COLD_START_CONFIG2.defaultHistoricalDays,
    recentDays = COLD_START_CONFIG2.defaultRecentDays,
    skipSync = false,
    specificModules
  } = options;
  const result = {
    accountId,
    reason,
    systemVersion: SYSTEM_VERSION,
    status: "completed",
    syncPhase: { executed: false, campaigns: 0, keywords: 0, searchTerms: 0, targets: 0, durationMs: 0 },
    historicalPhase: { executed: false, targetsProcessed: 0, negativesAdded: 0, keywordsHarvested: 0, ngramNegatives: 0, durationMs: 0 },
    recentPhase: { executed: false, targetsProcessed: 0, optimizationsTriggered: 0, durationMs: 0 },
    totalDurationMs: 0,
    errors: []
  };
  log117.info(`[ColdStart] ========================================`);
  log117.info(`[ColdStart] \u5F00\u59CB\u6267\u884C\u51B7\u542F\u52A8: \u8D26\u6237=${accountId}, \u539F\u56E0=${reason}`);
  log117.info(`[ColdStart] \u5386\u53F2\u6570\u636E\u8303\u56F4: ${historicalDays}\u5929, \u8FD1\u671F\u6570\u636E\u8303\u56F4: ${recentDays}\u5929`);
  log117.info(`[ColdStart] ========================================`);
  try {
    await updateColdStartLog(logId, "syncing");
    if (!skipSync) {
      const syncStart = Date.now();
      log117.info(`[ColdStart] \u9636\u6BB51: \u5168\u91CF\u6570\u636E\u540C\u6B65\u5F00\u59CB (${historicalDays}\u5929)...`);
      try {
        const syncResult = await executeFullSync(accountId, historicalDays);
        result.syncPhase = {
          // @ts-ignore
          executed: true,
          // @ts-ignore
          campaigns: syncResult.campaigns,
          // @ts-ignore
          keywords: syncResult.keywords,
          // @ts-ignore
          searchTerms: syncResult.searchTerms,
          // @ts-ignore
          targets: syncResult.targets,
          durationMs: Date.now() - syncStart
        };
        log117.info(`[ColdStart] \u9636\u6BB51\u5B8C\u6210: \u5E7F\u544A\u6D3B\u52A8=${syncResult.campaigns}, \u5173\u952E\u8BCD=${syncResult.keywords}, \u641C\u7D22\u8BCD=${syncResult.searchTerms}, \u5B9A\u5411=${syncResult.targets}, \u8017\u65F6=${result.syncPhase.durationMs}ms`);
        await sleep(COLD_START_CONFIG2.postSyncDelayMs);
      } catch (syncErr) {
        log117.warn(`[ColdStart] \u9636\u6BB51\u5931\u8D25\uFF08\u7EE7\u7EED\u6267\u884C\u540E\u7EED\u9636\u6BB5\uFF09: ${syncErr.message}`);
        result.errors.push(`\u6570\u636E\u540C\u6B65\u5931\u8D25: ${syncErr.message}`);
      }
    } else {
      log117.info(`[ColdStart] \u9636\u6BB51\u8DF3\u8FC7: skipSync=true`);
    }
    await updateColdStartLog(logId, "optimizing_historical");
    const histStart = Date.now();
    log117.info(`[ColdStart] \u9636\u6BB52: \u5386\u53F2\u6570\u636E\u6279\u91CF\u4F18\u5316\u5F00\u59CB (${recentDays}-${historicalDays}\u5929\u524D\u7684\u6570\u636E)...`);
    try {
      const histResult = await executeHistoricalOptimization(accountId, historicalDays, recentDays, specificModules);
      result.historicalPhase = {
        executed: true,
        targetsProcessed: histResult.targetsProcessed,
        negativesAdded: histResult.negativesAdded,
        keywordsHarvested: histResult.keywordsHarvested,
        ngramNegatives: histResult.ngramNegatives,
        durationMs: Date.now() - histStart
      };
      log117.info(`[ColdStart] \u9636\u6BB52\u5B8C\u6210: \u76EE\u6807=${histResult.targetsProcessed}, \u5426\u5B9A\u8BCD=${histResult.negativesAdded}, \u6536\u5272=${histResult.keywordsHarvested}, Ngram\u5426\u5B9A=${histResult.ngramNegatives}, \u8017\u65F6=${result.historicalPhase.durationMs}ms`);
    } catch (histErr) {
      log117.warn(`[ColdStart] \u9636\u6BB52\u5931\u8D25\uFF08\u7EE7\u7EED\u6267\u884C\u540E\u7EED\u9636\u6BB5\uFF09: ${histErr.message}`);
      result.errors.push(`\u5386\u53F2\u6570\u636E\u4F18\u5316\u5931\u8D25: ${histErr.message}`);
    }
    await updateColdStartLog(logId, "optimizing_recent");
    const recentStart = Date.now();
    log117.info(`[ColdStart] \u9636\u6BB53: \u8FD1\u671F\u6570\u636E\u5FEB\u901F\u4F18\u5316\u5F00\u59CB (\u6700\u8FD1${recentDays}\u5929)...`);
    try {
      const recentResult = await executeRecentOptimization(accountId, recentDays, specificModules);
      result.recentPhase = {
        executed: true,
        targetsProcessed: recentResult.targetsProcessed,
        optimizationsTriggered: recentResult.optimizationsTriggered,
        durationMs: Date.now() - recentStart
      };
      log117.info(`[ColdStart] \u9636\u6BB53\u5B8C\u6210: \u76EE\u6807=${recentResult.targetsProcessed}, \u89E6\u53D1\u4F18\u5316=${recentResult.optimizationsTriggered}, \u8017\u65F6=${result.recentPhase.durationMs}ms`);
    } catch (recentErr) {
      log117.warn(`[ColdStart] \u9636\u6BB53\u5931\u8D25: ${recentErr.message}`);
      result.errors.push(`\u8FD1\u671F\u6570\u636E\u4F18\u5316\u5931\u8D25: ${recentErr.message}`);
    }
    result.totalDurationMs = Date.now() - startTime;
    result.status = result.errors.length > 0 ? "failed" : "completed";
    await updateColdStartStatus(accountId, result.status === "completed" ? "completed" : "failed");
    await completeColdStartLog(logId, result);
    await recordColdStartEvent(accountId, result);
    log117.info(`[ColdStart] ========================================`);
    log117.info(`[ColdStart] \u51B7\u542F\u52A8${result.status === "completed" ? "\u6210\u529F" : "\u90E8\u5206\u5931\u8D25"}: \u8D26\u6237=${accountId}`);
    log117.info(`[ColdStart] \u603B\u8017\u65F6: ${(result.totalDurationMs / 1e3).toFixed(1)}\u79D2`);
    log117.info(`[ColdStart] \u540C\u6B65: ${result.syncPhase.executed ? "\u2705" : "\u23ED\uFE0F"} | \u5386\u53F2\u4F18\u5316: ${result.historicalPhase.executed ? "\u2705" : "\u274C"} | \u8FD1\u671F\u4F18\u5316: ${result.recentPhase.executed ? "\u2705" : "\u274C"}`);
    if (result.errors.length > 0) {
      log117.warn(`[ColdStart] \u9519\u8BEF\u6570: ${result.errors.length}`);
    }
    log117.info(`[ColdStart] ========================================`);
  } catch (err) {
    result.status = "failed";
    result.totalDurationMs = Date.now() - startTime;
    result.errors.push(`\u51B7\u542F\u52A8\u5F02\u5E38: ${err.message}`);
    await updateColdStartStatus(accountId, "failed");
    await completeColdStartLog(logId, result);
    log117.warn(`[ColdStart] \u51B7\u542F\u52A8\u5F02\u5E38\u7EC8\u6B62: \u8D26\u6237=${accountId}, \u9519\u8BEF=${err.message}`);
    logOptimizationError("ColdStart", `\u51B7\u542F\u52A8\u5F02\u5E38`, { accountId, reason, error: err.message });
  }
  return result;
}
async function executeFullSync(accountId, days) {
  const result = { campaigns: 0, keywords: 0, searchTerms: 0, targets: 0 };
  try {
    const credentials = await getAmazonApiCredentials(accountId);
    if (!credentials) {
      throw new Error(`\u8D26\u6237 ${accountId} \u6CA1\u6709API\u51ED\u8BC1`);
    }
    const { AmazonSyncService: AmazonSyncService2 } = await Promise.resolve().then(() => (init_amazonSyncService(), amazonSyncService_exports));
    const account = await getAdAccountById(accountId);
    if (!account) {
      throw new Error(`\u8D26\u6237 ${accountId} \u4E0D\u5B58\u5728`);
    }
    const syncService = await AmazonSyncService2.createFromCredentials(
      {
        clientId: credentials.clientId,
        clientSecret: credentials.clientSecret,
        refreshToken: credentials.refreshToken,
        profileId: credentials.profileId,
        region: credentials.region || "NA"
      },
      accountId,
      account.userId,
      account.marketplace
    );
    log117.info(`[ColdStart] v344: \u6267\u884C\u5168\u91CF\u540C\u6B65\uFF0CperformanceDays=${days}\u5929`);
    const syncData = await syncService.syncAll({ performanceDays: days, syncMode: "recovery" });
    result.campaigns = syncData.campaigns || 0;
    result.keywords = syncData.keywords || 0;
    result.targets = syncData.targets || 0;
    await updateAmazonApiCredentialsLastSync(accountId);
    log117.info(`[ColdStart] v344: syncAll\u5DF2\u5305\u542B${days}\u5929\u7EE9\u6548\u6570\u636E\uFF0C\u65E0\u9700\u989D\u5916\u540C\u6B65`);
  } catch (err) {
    log117.warn(`[ColdStart] \u5168\u91CF\u540C\u6B65\u5931\u8D25: ${err.message}`);
    throw err;
  }
  return result;
}
async function executeHistoricalOptimization(accountId, historicalDays, recentDays, specificModules) {
  const result = { targetsProcessed: 0, negativesAdded: 0, keywordsHarvested: 0, ngramNegatives: 0 };
  const { getEnabledOptimizationTargets: getEnabledOptimizationTargets2, executeOptimizationTarget: executeOptimizationTarget2 } = await Promise.resolve().then(() => (init_optimizationTargetEngine(), optimizationTargetEngine_exports));
  const targets = await getEnabledOptimizationTargets2(accountId);
  if (targets.length === 0) {
    log117.info(`[ColdStart] \u8D26\u6237 ${accountId} \u6CA1\u6709\u6D3B\u8DC3\u7684\u4F18\u5316\u76EE\u6807\uFF0C\u8DF3\u8FC7\u5386\u53F2\u6570\u636E\u4F18\u5316`);
    return result;
  }
  log117.info(`[ColdStart] \u53D1\u73B0 ${targets.length} \u4E2A\u6D3B\u8DC3\u4F18\u5316\u76EE\u6807\uFF0C\u5F00\u59CB\u5386\u53F2\u6570\u636E\u6279\u91CF\u4F18\u5316...`);
  try {
    log117.info(`[ColdStart] 2a: \u6267\u884CNgram\u5206\u6790 (${historicalDays}\u5929)...`);
    const { generateNegativeKeywordSuggestions: generateNegativeKeywordSuggestions2 } = await Promise.resolve().then(() => (init_ngramAnalysis(), ngramAnalysis_exports));
    const suggestions = await generateNegativeKeywordSuggestions2(accountId, void 0, historicalDays);
    if (suggestions.length > 0) {
      log117.info(`[ColdStart] Ngram\u5206\u6790\u53D1\u73B0 ${suggestions.length} \u4E2A\u5426\u5B9A\u8BCD\u5EFA\u8BAE`);
      const highPriority = suggestions.filter((s) => s.priority === "high");
      if (highPriority.length > 0) {
        log117.info(`[ColdStart] \u81EA\u52A8\u6267\u884C ${highPriority.length} \u4E2A\u9AD8\u4F18\u5148\u7EA7Ngram\u5426\u5B9A...`);
        result.ngramNegatives = highPriority.length;
      }
    }
  } catch (ngramErr) {
    log117.warn(`[ColdStart] Ngram\u5206\u6790\u5931\u8D25\uFF08\u7EE7\u7EED\u6267\u884C\uFF09: ${ngramErr.message}`);
  }
  try {
    log117.info(`[ColdStart] 2b: \u6267\u884C\u641C\u7D22\u8BCD\u6536\u5272...`);
    const searchTermHarvester = await Promise.resolve().then(() => (init_searchTermHarvester(), searchTermHarvester_exports));
    const harvestResult = await searchTermHarvester.batchHarvestSearchTerms(accountId);
    result.keywordsHarvested = harvestResult.summary.success;
    log117.info(`[ColdStart] \u641C\u7D22\u8BCD\u6536\u5272\u5B8C\u6210: \u5019\u9009=${harvestResult.summary.total}, \u6210\u529F=${harvestResult.summary.success}`);
  } catch (harvestErr) {
    log117.warn(`[ColdStart] \u641C\u7D22\u8BCD\u6536\u5272\u5931\u8D25\uFF08\u7EE7\u7EED\u6267\u884C\uFF09: ${harvestErr.message}`);
  }
  const modulesToRun = specificModules || ["searchterm"];
  for (let i = 0; i < targets.length; i += COLD_START_CONFIG2.batchSize) {
    const batch = targets.slice(i, i + COLD_START_CONFIG2.batchSize);
    const memUsage = process.memoryUsage();
    const rssMB = Math.round(memUsage.rss / 1024 / 1024);
    if (rssMB > 1e3) {
      log117.warn(`[ColdStart] v369: \u5185\u5B58\u7D27\u5F20(RSS=${rssMB}MB)\uFF0C\u6682\u505C30\u79D2\u7B49\u5F85GC...`);
      if (typeof global.gc === "function") global.gc();
      await sleep(3e4);
    }
    for (const target of batch) {
      if (isShuttingDown()) {
        log117.warn(`[ColdStart] \u7CFB\u7EDF\u6B63\u5728\u5173\u95ED\uFF0C\u4E2D\u6B62\u5386\u53F2\u6570\u636E\u4F18\u5316`);
        break;
      }
      try {
        log117.info(`[ColdStart] \u5904\u7406\u4F18\u5316\u76EE\u6807: ${target.name} (id=${target.id})`);
        const execResult = await executeOptimizationTarget2(target.id, {
          dryRun: false,
          forceExecution: true,
          specificModules: modulesToRun
        });
        result.targetsProcessed++;
        result.negativesAdded += execResult.searchTermAnalysis.negativeKeywordsAdded || 0;
        log117.info(`[ColdStart] \u76EE\u6807 ${target.name} \u5B8C\u6210: \u5426\u5B9A\u8BCD=${execResult.searchTermAnalysis.negativeKeywordsAdded}, \u65B0\u5173\u952E\u8BCD=${execResult.searchTermAnalysis.newKeywordsAdded}`);
      } catch (targetErr) {
        log117.warn(`[ColdStart] \u76EE\u6807 ${target.name} \u4F18\u5316\u5931\u8D25: ${targetErr.message}`);
      }
    }
    if (i + COLD_START_CONFIG2.batchSize < targets.length) {
      log117.debug(`[ColdStart] \u6279\u6B21\u95F4\u5EF6\u8FDF ${COLD_START_CONFIG2.batchDelayMs / 1e3}\u79D2...`);
      await sleep(COLD_START_CONFIG2.batchDelayMs);
    }
  }
  return result;
}
async function executeRecentOptimization(accountId, recentDays, specificModules) {
  const result = { targetsProcessed: 0, optimizationsTriggered: 0 };
  try {
    const { triggerAccountOptimizations: triggerAccountOptimizations2 } = await Promise.resolve().then(() => (init_optimizationScheduler(), optimizationScheduler_exports));
    const triggerResult = await triggerAccountOptimizations2(accountId, "cold_start_recent");
    result.targetsProcessed = triggerResult.triggeredCount + triggerResult.skippedCount;
    result.optimizationsTriggered = triggerResult.triggeredCount;
    log117.info(`[ColdStart] \u8FD1\u671F\u6570\u636E\u4F18\u5316\u89E6\u53D1: \u6267\u884C=${triggerResult.triggeredCount}, \u8DF3\u8FC7=${triggerResult.skippedCount}`);
  } catch (err) {
    log117.warn(`[ColdStart] \u8FD1\u671F\u6570\u636E\u4F18\u5316\u89E6\u53D1\u5931\u8D25: ${err.message}`);
    throw err;
  }
  return result;
}
async function checkIdempotency(accountId, reason) {
  try {
    const database = await getDb();
    if (!database) return null;
    if (reason === "version_upgrade") {
      const rows = await database.execute(sql`
        SELECT last_cold_start_version FROM amazon_api_credentials 
        WHERE accountId = ${accountId} 
        LIMIT 1
      `);
      const row = rows?.[0]?.[0];
      if (row?.last_cold_start_version >= SYSTEM_VERSION) {
        return `\u8BE5\u8D26\u6237\u5DF2\u5728 v${row.last_cold_start_version} \u6267\u884C\u8FC7\u51B7\u542F\u52A8\uFF0C\u5F53\u524D\u7248\u672C v${SYSTEM_VERSION}`;
      }
    } else if (reason === "new_account" || reason === "new_marketplace") {
      const rows = await database.execute(sql`
        SELECT last_cold_start_at FROM amazon_api_credentials 
        WHERE accountId = ${accountId} 
        LIMIT 1
      `);
      const row = rows?.[0]?.[0];
      if (row?.last_cold_start_at) {
        const lastColdStart = new Date(row.last_cold_start_at).getTime();
        const hoursSince = (Date.now() - lastColdStart) / (1e3 * 60 * 60);
        if (hoursSince < 1) {
          return `\u8BE5\u8D26\u6237 ${hoursSince.toFixed(1)} \u5C0F\u65F6\u524D\u521A\u6267\u884C\u8FC7\u51B7\u542F\u52A8`;
        }
      }
    } else if (reason === "credential_refresh") {
      const rows = await database.execute(sql`
        SELECT last_cold_start_at FROM amazon_api_credentials 
        WHERE accountId = ${accountId} 
        LIMIT 1
      `);
      const row = rows?.[0]?.[0];
      if (row?.last_cold_start_at) {
        const lastColdStart = new Date(row.last_cold_start_at).getTime();
        const minutesSince = (Date.now() - lastColdStart) / (1e3 * 60);
        if (minutesSince < 30) {
          return `\u8BE5\u8D26\u6237 ${minutesSince.toFixed(0)} \u5206\u949F\u524D\u521A\u6267\u884C\u8FC7\u51B7\u542F\u52A8`;
        }
      }
    }
    return null;
  } catch (err) {
    log117.warn(`[ColdStart] \u5E42\u7B49\u6027\u68C0\u67E5\u5931\u8D25\uFF08\u5141\u8BB8\u6267\u884C\uFF09: ${err.message}`);
    return null;
  }
}
async function createColdStartLog(accountId, reason) {
  try {
    const database = await getDb();
    if (!database) return 0;
    const result = await database.execute(sql`
      INSERT INTO cold_start_logs (account_id, trigger_reason, system_version, status)
      VALUES (${accountId}, ${reason}, ${SYSTEM_VERSION}, 'started')
    `);
    return result?.[0]?.insertId || 0;
  } catch (err) {
    log117.warn(`[ColdStart] \u521B\u5EFA\u65E5\u5FD7\u8BB0\u5F55\u5931\u8D25: ${err.message}`);
    return 0;
  }
}
async function updateColdStartLog(logId, status) {
  if (logId === 0) return;
  try {
    const database = await getDb();
    if (!database) return;
    await database.execute(sql`
      UPDATE cold_start_logs SET status = ${status} WHERE id = ${logId}
    `);
  } catch (err) {
    log117.warn(`[ColdStart] \u66F4\u65B0\u65E5\u5FD7\u72B6\u6001\u5931\u8D25: ${err.message}`);
  }
}
async function completeColdStartLog(logId, result) {
  if (logId === 0) return;
  try {
    const database = await getDb();
    if (!database) return;
    const detail = JSON.stringify({
      syncPhase: result.syncPhase,
      historicalPhase: result.historicalPhase,
      recentPhase: result.recentPhase,
      errors: result.errors
    });
    await database.execute(sql`
      UPDATE cold_start_logs SET 
        status = ${result.status},
        sync_campaigns = ${result.syncPhase.campaigns},
        sync_keywords = ${result.syncPhase.keywords},
        sync_search_terms = ${result.syncPhase.searchTerms},
        sync_targets = ${result.syncPhase.targets},
        sync_duration_ms = ${result.syncPhase.durationMs},
        historical_targets_processed = ${result.historicalPhase.targetsProcessed},
        historical_negatives_added = ${result.historicalPhase.negativesAdded},
        historical_keywords_harvested = ${result.historicalPhase.keywordsHarvested},
        historical_ngram_negatives = ${result.historicalPhase.ngramNegatives},
        historical_duration_ms = ${result.historicalPhase.durationMs},
        recent_targets_processed = ${result.recentPhase.targetsProcessed},
        recent_optimizations_triggered = ${result.recentPhase.optimizationsTriggered},
        recent_duration_ms = ${result.recentPhase.durationMs},
        total_duration_ms = ${result.totalDurationMs},
        error_message = ${result.errors.length > 0 ? result.errors.join("; ") : null},
        detail = ${detail},
        completed_at = NOW()
      WHERE id = ${logId}
    `);
  } catch (err) {
    log117.warn(`[ColdStart] \u5B8C\u6210\u65E5\u5FD7\u8BB0\u5F55\u5931\u8D25: ${err.message}`);
  }
}
async function updateColdStartStatus(accountId, status) {
  try {
    const database = await getDb();
    if (!database) return;
    if (status === "completed") {
      await database.execute(sql`
        UPDATE amazon_api_credentials SET 
          last_cold_start_at = NOW(),
          last_cold_start_version = ${SYSTEM_VERSION},
          cold_start_status = 'completed'
        WHERE accountId = ${accountId}
      `);
    } else {
      await database.execute(sql`
        UPDATE amazon_api_credentials SET 
          cold_start_status = 'failed'
        WHERE accountId = ${accountId}
      `);
    }
  } catch (err) {
    log117.warn(`[ColdStart] \u66F4\u65B0\u8D26\u6237\u51B7\u542F\u52A8\u72B6\u6001\u5931\u8D25: ${err.message}`);
  }
}
async function recordColdStartEvent(accountId, result) {
  try {
    const database = await getDb();
    if (!database) return;
    const detail = JSON.stringify({
      type: "cold_start_complete",
      systemVersion: SYSTEM_VERSION,
      reason: result.reason,
      syncPhase: result.syncPhase,
      historicalPhase: result.historicalPhase,
      recentPhase: result.recentPhase,
      totalDurationMs: result.totalDurationMs,
      errors: result.errors
    });
    const changeReason = `v${SYSTEM_VERSION} \u667A\u80FD\u51B7\u542F\u52A8[${result.reason}]: \u540C\u6B65=${result.syncPhase.executed ? "\u2705" : "\u23ED\uFE0F"} \u5386\u53F2\u4F18\u5316=${result.historicalPhase.targetsProcessed}\u76EE\u6807/${result.historicalPhase.negativesAdded}\u5426\u5B9A \u8FD1\u671F\u4F18\u5316=${result.recentPhase.optimizationsTriggered}\u6B21 \u8017\u65F6=${(result.totalDurationMs / 1e3).toFixed(1)}s`;
    await database.execute(sql`
      INSERT INTO optimization_events 
        (account_id, event_category, action_type, action_detail, change_reason, algorithm_version, status, api_sync_status) 
      VALUES 
        (${accountId}, 'settings_change', 'auto_correction', ${detail}, ${changeReason}, ${`v${SYSTEM_VERSION}`}, ${result.status === "completed" ? "success" : "failed"}, 'internal')  -- v513: 内部事件使用 internal 状态
    `);
  } catch (err) {
    log117.warn(`[ColdStart] \u8BB0\u5F55\u51B7\u542F\u52A8\u4E8B\u4EF6\u5931\u8D25: ${err.message}`);
  }
}
async function getColdStartStatus(accountId) {
  const isRunning2 = runningColdStarts.has(accountId);
  try {
    const database = await getDb();
    if (!database) {
      return { lastColdStartAt: null, lastColdStartVersion: null, coldStartStatus: "unknown", isRunning: isRunning2 };
    }
    const rows = await database.execute(sql`
      SELECT last_cold_start_at, last_cold_start_version, cold_start_status
      FROM amazon_api_credentials 
      WHERE accountId = ${accountId}
      LIMIT 1
    `);
    const row = rows?.[0]?.[0];
    return {
      // @ts-ignore
      lastColdStartAt: row?.last_cold_start_at || null,
      // @ts-ignore
      lastColdStartVersion: row?.last_cold_start_version || null,
      // @ts-ignore
      coldStartStatus: row?.cold_start_status || "idle",
      isRunning: isRunning2
      // @ts-ignore
    };
  } catch (err) {
    return { lastColdStartAt: null, lastColdStartVersion: null, coldStartStatus: "error", isRunning: isRunning2 };
  }
}
async function getColdStartLogs(accountId, limit = 20) {
  try {
    const database = await getDb();
    if (!database) return [];
    if (accountId) {
      const rows = await database.execute(sql`
        SELECT * FROM cold_start_logs 
        WHERE account_id = ${accountId} 
        ORDER BY created_at DESC 
        LIMIT ${sql.raw(String(limit))}
      `);
      return rows?.[0] || [];
    } else {
      const rows = await database.execute(sql`
        SELECT * FROM cold_start_logs 
        ORDER BY created_at DESC 
        LIMIT ${sql.raw(String(limit))}
      `);
      return rows?.[0] || [];
    }
  } catch (err) {
    log117.warn(`[ColdStart] \u67E5\u8BE2\u51B7\u542F\u52A8\u65E5\u5FD7\u5931\u8D25: ${err.message}`);
    return [];
  }
}
function isAnyColdStartRunning() {
  return runningColdStarts.size > 0;
}
function getRunningColdStarts() {
  return Array.from(runningColdStarts);
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
var log117, COLD_START_CONFIG2, runningColdStarts, coldStartRequestTimestamps, COLD_START_DEBOUNCE_MS;
var init_coldStartService = __esm({
  "server/optimization/coldStartService.ts"() {
    "use strict";
    init_db2();
    init_db2();
    init_drizzle_orm();
    init_systemVersion();
    init_logger();
    init_opsLogger();
    init_taskLifecycle();
    log117 = createModuleLogger("ColdStart");
    COLD_START_CONFIG2 = {
      /** 历史数据默认回溯天数 */
      defaultHistoricalDays: 90,
      /** 近期数据默认天数 */
      defaultRecentDays: 14,
      /** 每批处理的优化目标数 */
      batchSize: 3,
      /** 批次间延迟（毫秒） */
      batchDelayMs: 15 * 1e3,
      /** 单个优化目标超时（毫秒） */
      targetTimeoutMs: 10 * 60 * 1e3,
      /** 内存使用率上限（超过则暂停） */
      memoryThreshold: 0.8,
      /** 同步完成后等待时间（毫秒），让数据库索引更新 */
      postSyncDelayMs: 10 * 1e3
    };
    runningColdStarts = /* @__PURE__ */ new Set();
    coldStartRequestTimestamps = /* @__PURE__ */ new Map();
    COLD_START_DEBOUNCE_MS = 5 * 60 * 1e3;
    __name(triggerColdStart, "triggerColdStart");
    __name(triggerColdStartForAllAccounts, "triggerColdStartForAllAccounts");
    __name(executeColdStart, "executeColdStart");
    __name(executeFullSync, "executeFullSync");
    __name(executeHistoricalOptimization, "executeHistoricalOptimization");
    __name(executeRecentOptimization, "executeRecentOptimization");
    __name(checkIdempotency, "checkIdempotency");
    __name(createColdStartLog, "createColdStartLog");
    __name(updateColdStartLog, "updateColdStartLog");
    __name(completeColdStartLog, "completeColdStartLog");
    __name(updateColdStartStatus, "updateColdStartStatus");
    __name(recordColdStartEvent, "recordColdStartEvent");
    __name(getColdStartStatus, "getColdStartStatus");
    __name(getColdStartLogs, "getColdStartLogs");
    __name(isAnyColdStartRunning, "isAnyColdStartRunning");
    __name(getRunningColdStarts, "getRunningColdStarts");
    __name(sleep, "sleep");
  }
});

