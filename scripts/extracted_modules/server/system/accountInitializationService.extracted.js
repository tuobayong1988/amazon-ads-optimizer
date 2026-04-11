// Extracted from production dist/index.js
// Original module: server/system/accountInitializationService.ts
// Lines: 367

var accountInitializationService_exports = {};
__export(accountInitializationService_exports, {
  getDataCollectionStatus: () => getDataCollectionStatus,
  initializeAccount: () => initializeAccount,
  initializeMultipleAccounts: () => initializeMultipleAccounts,
  isAccountReady: () => isAccountReady
});
async function isAccountReady(accountId) {
  try {
    const account = await getAdAccountById(accountId);
    if (!account) return false;
    const status = account.initializationStatus || "pending";
    return status === "completed" || status === "ready";
  } catch (err) {
    log167.warn(`[AccountInit] \u68C0\u67E5\u8D26\u53F7 ${accountId} \u5C31\u7EEA\u72B6\u6001\u5931\u8D25: ${err.message}`);
    return false;
  }
}
async function initializeAccount(params) {
  const { accountId, userId, clientId, clientSecret, refreshToken, profileId, region, marketplace } = params;
  log167.info(`[v360] \u5F00\u59CB\u521D\u59CB\u5316\u8D26\u53F7 ${accountId} (${marketplace}), \u542F\u52A824\u5C0F\u65F6\u6570\u636E\u6536\u96C6\u5468\u671F...`);
  const result = {
    accountId,
    marketplace,
    syncResult: { success: false },
    scheduleResult: { success: false },
    amsResult: { success: false },
    dataCollectionStatus: {
      status: "collecting",
      currentRound: 1,
      totalRounds: DATA_COLLECTION_CONFIG.syncRounds,
      successRounds: 0,
      estimatedCompletionAt: new Date(Date.now() + DATA_COLLECTION_CONFIG.totalDurationHours * 36e5).toISOString()
    }
  };
  try {
    await updateAdAccount(accountId, {
      initializationStatus: "collecting",
      initializationStartedAt: (/* @__PURE__ */ new Date()).toISOString(),
      initializationProgress: 0,
      initializationError: null
    });
  } catch (err) {
    log167.warn(`[v360] \u66F4\u65B0\u8D26\u53F7 ${accountId} \u521D\u59CB\u5316\u72B6\u6001\u5931\u8D25: ${err.message}`);
  }
  try {
    log167.info(`[v360] \u6B65\u9AA41: \u542F\u52A8\u7B2C\u4E00\u8F6E\u5168\u91CF\u6570\u636E\u540C\u6B65 (${marketplace})...`);
    const syncService = await AmazonSyncService.createFromCredentials(
      { clientId, clientSecret, refreshToken, profileId, region },
      accountId,
      userId,
      marketplace
    );
    syncService.syncAll({ syncMode: "init" }).then(async (syncData) => {
      log167.info(`[v360] \u8D26\u53F7 ${accountId} (${marketplace}) \u7B2C1\u8F6E\u5168\u91CF\u540C\u6B65\u5B8C\u6210:`, syncData);
      await updateAmazonApiCredentialsLastSync(accountId);
      await recordSyncRound(accountId, 1, true);
      scheduleSubsequentRounds(accountId, userId, clientId, clientSecret, refreshToken, profileId, region, marketplace);
      try {
        const { triggerColdStart: triggerColdStart2 } = await Promise.resolve().then(() => (init_coldStartService(), coldStartService_exports));
        const coldStartResult = await triggerColdStart2(accountId, {
          reason: "new_account",
          skipSync: true,
          historicalDays: DATA_COLLECTION_CONFIG.historicalDays,
          recentDays: 14
        });
        log167.info(`[v360] \u8D26\u53F7 ${accountId} (${marketplace}) \u51B7\u542F\u52A8${coldStartResult.triggered ? "\u5DF2\u89E6\u53D1" : "\u5DF2\u8DF3\u8FC7"}: ${coldStartResult.reason || ""}`);
      } catch (coldStartErr) {
        log167.warn(`[v360] \u8D26\u53F7 ${accountId} (${marketplace}) \u51B7\u542F\u52A8\u89E6\u53D1\u5931\u8D25: ${coldStartErr.message}`);
      }
    }).catch(async (err) => {
      log167.warn(`[v360] \u8D26\u53F7 ${accountId} (${marketplace}) \u7B2C1\u8F6E\u5168\u91CF\u540C\u6B65\u5931\u8D25:`, err);
      await recordSyncRound(accountId, 1, false, err.message);
      scheduleSubsequentRounds(accountId, userId, clientId, clientSecret, refreshToken, profileId, region, marketplace);
    });
    result.syncResult = { success: true };
    log167.info(`[v360] \u6B65\u9AA41\u5B8C\u6210: \u7B2C1\u8F6E\u5168\u91CF\u540C\u6B65\u5DF2\u542F\u52A8`);
  } catch (syncError) {
    log167.warn(`[v360] \u6B65\u9AA41\u5931\u8D25: \u5168\u91CF\u540C\u6B65\u542F\u52A8\u5931\u8D25:`, syncError);
    result.syncResult = { success: false, error: syncError.message };
  }
  try {
    log167.info(`\u6B65\u9AA42: \u521B\u5EFA\u5B9A\u65F6\u540C\u6B65\u914D\u7F6E (${marketplace})...`);
    const existingSchedule = await getSyncScheduleByAccountId(userId, accountId);
    if (!existingSchedule) {
      const scheduleId = await createSyncSchedule({
        userId,
        accountId,
        syncType: "all",
        frequency: "hourly",
        isEnabled: true
      });
      result.scheduleResult = { success: true, scheduleId };
      log167.info(`\u6B65\u9AA42\u5B8C\u6210: \u5DF2\u521B\u5EFA\u6BCF\u5C0F\u65F6\u5B9A\u65F6\u540C\u6B65\u914D\u7F6E (scheduleId=${scheduleId})`);
    } else {
      if (!existingSchedule.isEnabled) {
        await updateSyncSchedule(existingSchedule.id, {
          isEnabled: true,
          frequency: "hourly"
        });
        log167.info(`\u6B65\u9AA42\u5B8C\u6210: \u5DF2\u91CD\u65B0\u542F\u7528\u73B0\u6709\u5B9A\u65F6\u540C\u6B65\u914D\u7F6E`);
      } else {
        log167.info(`\u6B65\u9AA42\u5B8C\u6210: \u5B9A\u65F6\u540C\u6B65\u914D\u7F6E\u5DF2\u5B58\u5728\u4E14\u5DF2\u542F\u7528`);
      }
      result.scheduleResult = { success: true, scheduleId: existingSchedule.id };
    }
  } catch (scheduleError) {
    log167.warn(`\u6B65\u9AA42\u5931\u8D25: \u521B\u5EFA\u5B9A\u65F6\u540C\u6B65\u914D\u7F6E\u5931\u8D25:`, scheduleError);
    result.scheduleResult = { success: false, error: scheduleError.message };
  }
  try {
    log167.info(`\u6B65\u9AA43: \u521B\u5EFAAMS\u5B9E\u65F6\u6570\u636E\u6D41\u8BA2\u9605 (${marketplace})...`);
    const urlToArn = /* @__PURE__ */ __name((url3) => {
      if (!url3) return void 0;
      let match = url3.match(/sqs\.([^.]+)\.amazonaws\.com\/(\d+)\/(.+)/);
      if (match) {
        const [, awsRegion, awsAccountId, queueName] = match;
        return `arn:aws:sqs:${awsRegion}:${awsAccountId}:${queueName}`;
      }
      match = url3.match(/queue\.amazonaws\.com\/(\d+)\/(.+)/);
      if (match) {
        const [, awsAccountId, queueName] = match;
        const awsRegion = process.env.AWS_REGION || "us-east-1";
        return `arn:aws:sqs:${awsRegion}:${awsAccountId}:${queueName}`;
      }
      return url3;
    }, "urlToArn");
    const queueArnMapping = {
      "sp-traffic": urlToArn(process.env.AWS_SQS_QUEUE_TRAFFIC_URL),
      "sp-conversion": urlToArn(process.env.AWS_SQS_QUEUE_CONVERSION_URL),
      "sp-budget-usage": urlToArn(process.env.AWS_SQS_QUEUE_BUDGET_URL),
      "sb-traffic": urlToArn(process.env.AWS_SQS_QUEUE_SB_TRAFFIC_URL),
      "sb-conversion": urlToArn(process.env.AWS_SQS_QUEUE_SB_CONVERSION_URL),
      "sb-budget-usage": urlToArn(process.env.AWS_SQS_QUEUE_SB_BUDGET_URL),
      "sd-traffic": urlToArn(process.env.AWS_SQS_QUEUE_SD_TRAFFIC_URL),
      "sd-conversion": urlToArn(process.env.AWS_SQS_QUEUE_SD_CONVERSION_URL),
      "sd-budget-usage": urlToArn(process.env.AWS_SQS_QUEUE_SD_BUDGET_URL)
    };
    const configuredQueues = Object.entries(queueArnMapping).filter(([_, arn]) => arn);
    const sqsQueueArn = process.env.AWS_SQS_QUEUE_ARN;
    if (configuredQueues.length === 0 && !sqsQueueArn) {
      log167.warn(`\u6B65\u9AA43\u8DF3\u8FC7: \u672A\u914D\u7F6ESQS\u961F\u5217\u73AF\u5883\u53D8\u91CF`);
      result.amsResult = { success: false, error: "\u672A\u914D\u7F6ESQS\u961F\u5217\u73AF\u5883\u53D8\u91CF" };
    } else {
      const apiRegion = MARKETPLACE_TO_REGION[marketplace] || region;
      const client = new AmazonAdsApiClient({
        clientId,
        clientSecret,
        refreshToken,
        profileId,
        region: apiRegion
      });
      const amsArg = configuredQueues.length > 0 ? queueArnMapping : sqsQueueArn;
      const amsCreateResult = await client.createAllTrafficSubscriptions(amsArg);
      result.amsResult = {
        success: true,
        subscriptionsCreated: amsCreateResult.created.length,
        subscriptionsFailed: amsCreateResult.failed.length
      };
      if (amsCreateResult.created.length > 0) {
        const activeCount = amsCreateResult.created.filter((s) => s.status === "ACTIVE").length;
        log167.warn(`\u6B65\u9AA43\u5B8C\u6210: AMS\u8BA2\u9605\u521B\u5EFA ${amsCreateResult.created.length} \u4E2A (ACTIVE: ${activeCount}), \u5931\u8D25 ${amsCreateResult.failed.length} \u4E2A`);
      } else {
        log167.warn(`\u6B65\u9AA43: \u6CA1\u6709\u65B0\u521B\u5EFA\u7684AMS\u8BA2\u9605\uFF08\u53EF\u80FD\u5DF2\u5B58\u5728\uFF09`);
      }
    }
  } catch (amsError) {
    log167.warn(`\u6B65\u9AA43\u5931\u8D25: AMS\u8BA2\u9605\u521B\u5EFA\u5931\u8D25:`, amsError);
    result.amsResult = { success: false, error: amsError.message };
  }
  log167.info(`[v360] \u8D26\u53F7 ${accountId} (${marketplace}) \u521D\u59CB\u5316\u542F\u52A8\u5B8C\u6210, 24\u5C0F\u65F6\u6570\u636E\u6536\u96C6\u5468\u671F\u5F00\u59CB`, {
    sync: result.syncResult.success ? "started" : "failed",
    schedule: result.scheduleResult.success ? "ok" : "failed",
    ams: result.amsResult.success ? "ok" : "failed",
    dataCollection: `Round 1/${DATA_COLLECTION_CONFIG.syncRounds} started`
  });
  return result;
}
async function recordSyncRound(accountId, round, success2, error48) {
  try {
    const account = await getAdAccountById(accountId);
    if (!account) return;
    let roundHistory = [];
    try {
      if (account.initializationError && account.initializationError.startsWith("[")) {
        roundHistory = JSON.parse(account.initializationError);
      }
    } catch (_) {
    }
    roundHistory.push({
      round,
      startedAt: /* @__PURE__ */ new Date(),
      completedAt: /* @__PURE__ */ new Date(),
      success: success2,
      syncedTypes: success2 ? ["SP", "SB", "SD"] : [],
      failedTypes: success2 ? [] : ["unknown"],
      error: error48
    });
    const successRounds = roundHistory.filter((r) => r.success).length;
    const progress = Math.round(round / DATA_COLLECTION_CONFIG.syncRounds * 100);
    if (round >= DATA_COLLECTION_CONFIG.syncRounds || successRounds >= DATA_COLLECTION_CONFIG.minSuccessRounds) {
      if (successRounds >= DATA_COLLECTION_CONFIG.minSuccessRounds) {
        await updateAdAccount(accountId, {
          initializationStatus: "completed",
          initializationCompletedAt: (/* @__PURE__ */ new Date()).toISOString(),
          initializationProgress: 100,
          initializationError: JSON.stringify(roundHistory)
        });
        log167.info(`[v360] \u8D26\u53F7 ${accountId} \u6570\u636E\u6536\u96C6\u5B8C\u6210! ${successRounds}/${round} \u8F6E\u6210\u529F, \u8D26\u53F7\u5DF2\u5C31\u7EEA`);
      } else {
        await updateAdAccount(accountId, {
          initializationStatus: "failed",
          initializationProgress: progress,
          initializationError: JSON.stringify(roundHistory)
        });
        log167.warn(`[v360] \u8D26\u53F7 ${accountId} \u6570\u636E\u6536\u96C6\u5931\u8D25! ${successRounds}/${round} \u8F6E\u6210\u529F, \u672A\u8FBE\u5230\u6700\u4F4E\u8981\u6C42 ${DATA_COLLECTION_CONFIG.minSuccessRounds} \u8F6E`);
      }
    } else {
      await updateAdAccount(accountId, {
        initializationProgress: progress,
        initializationError: JSON.stringify(roundHistory)
      });
      log167.info(`[v360] \u8D26\u53F7 ${accountId} \u7B2C${round}\u8F6E\u540C\u6B65${success2 ? "\u6210\u529F" : "\u5931\u8D25"}, \u8FDB\u5EA6 ${progress}%`);
    }
  } catch (err) {
    log167.warn(`[v360] \u8BB0\u5F55\u540C\u6B65\u8F6E\u6B21\u5931\u8D25: ${err.message}`);
  }
}
function scheduleSubsequentRounds(accountId, userId, clientId, clientSecret, refreshToken, profileId, region, marketplace) {
  const intervalMs = DATA_COLLECTION_CONFIG.roundIntervalHours * 36e5;
  for (let round = 2; round <= DATA_COLLECTION_CONFIG.syncRounds; round++) {
    const delayMs = (round - 1) * intervalMs;
    const roundNum = round;
    setTimeout(async () => {
      try {
        const account = await getAdAccountById(accountId);
        if (!account) {
          log167.warn(`[v360] \u7B2C${roundNum}\u8F6E\u540C\u6B65\u8DF3\u8FC7: \u8D26\u53F7 ${accountId} \u4E0D\u5B58\u5728`);
          return;
        }
        if (account.initializationStatus === "completed" || account.initializationStatus === "ready") {
          log167.info(`[v360] \u7B2C${roundNum}\u8F6E\u540C\u6B65\u8DF3\u8FC7: \u8D26\u53F7 ${accountId} \u5DF2\u5C31\u7EEA`);
          return;
        }
        log167.info(`[v360] \u5F00\u59CB\u7B2C${roundNum}\u8F6E\u5168\u91CF\u540C\u6B65, \u8D26\u53F7 ${accountId} (${marketplace})`);
        const syncService = await AmazonSyncService.createFromCredentials(
          { clientId, clientSecret, refreshToken, profileId, region },
          accountId,
          userId,
          marketplace
        );
        const syncData = await syncService.syncAll({ syncMode: "init" });
        log167.info(`[v360] \u8D26\u53F7 ${accountId} \u7B2C${roundNum}\u8F6E\u5168\u91CF\u540C\u6B65\u5B8C\u6210:`, syncData);
        await updateAmazonApiCredentialsLastSync(accountId);
        await recordSyncRound(accountId, roundNum, true);
      } catch (err) {
        log167.warn(`[v360] \u8D26\u53F7 ${accountId} \u7B2C${roundNum}\u8F6E\u5168\u91CF\u540C\u6B65\u5931\u8D25:`, err);
        await recordSyncRound(accountId, roundNum, false, err.message);
        try {
          log167.info(`[v360] \u8D26\u53F7 ${accountId} \u7B2C${roundNum}\u8F6E\u540C\u6B65\u91CD\u8BD5...`);
          await new Promise((resolve) => setTimeout(resolve, 3e5));
          const syncService = await AmazonSyncService.createFromCredentials(
            { clientId, clientSecret, refreshToken, profileId, region },
            accountId,
            userId,
            marketplace
          );
          const retryData = await syncService.syncAll({ syncMode: "init" });
          log167.info(`[v360] \u8D26\u53F7 ${accountId} \u7B2C${roundNum}\u8F6E\u91CD\u8BD5\u6210\u529F:`, retryData);
          await recordSyncRound(accountId, roundNum, true);
        } catch (retryErr) {
          log167.warn(`[v360] \u8D26\u53F7 ${accountId} \u7B2C${roundNum}\u8F6E\u91CD\u8BD5\u4E5F\u5931\u8D25:`, retryErr);
        }
      }
    }, delayMs);
    const nextRoundTime = new Date(Date.now() + delayMs);
    log167.info(`[v360] \u8D26\u53F7 ${accountId} \u7B2C${roundNum}\u8F6E\u540C\u6B65\u5DF2\u8C03\u5EA6, \u9884\u8BA1 ${nextRoundTime.toISOString()} \u6267\u884C`);
  }
}
async function getDataCollectionStatus(accountId) {
  const account = await getAdAccountById(accountId);
  if (!account) {
    return { status: "unknown", progress: 0, rounds: [], isReady: false };
  }
  let rounds = [];
  try {
    if (account.initializationError && account.initializationError.startsWith("[")) {
      rounds = JSON.parse(account.initializationError);
    }
  } catch (_) {
  }
  const isReady = account.initializationStatus === "completed" || account.initializationStatus === "ready";
  const startedAt = account.initializationStartedAt ? new Date(account.initializationStartedAt).getTime() : Date.now();
  const estimatedCompletionAt = new Date(startedAt + DATA_COLLECTION_CONFIG.totalDurationHours * 36e5).toISOString();
  return {
    status: account.initializationStatus || "pending",
    progress: account.initializationProgress || 0,
    rounds,
    isReady,
    estimatedCompletionAt: isReady ? void 0 : estimatedCompletionAt
  };
}
async function initializeMultipleAccounts(accounts) {
  log167.info(`[v360] \u5F00\u59CB\u6279\u91CF\u521D\u59CB\u5316 ${accounts.length} \u4E2A\u8D26\u53F7\uFF08\u6BCF\u4E2A\u542F\u52A824\u5C0F\u65F6\u6570\u636E\u6536\u96C6\uFF09...`);
  const results = [];
  for (const account of accounts) {
    try {
      const result = await initializeAccount(account);
      results.push(result);
      if (accounts.indexOf(account) < accounts.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 1e3));
      }
    } catch (error48) {
      log167.warn(`\u8D26\u53F7 ${account.accountId} \u521D\u59CB\u5316\u5F02\u5E38:`, error48);
      results.push({
        // @ts-ignore
        accountId: account.accountId,
        // @ts-ignore
        marketplace: account.marketplace,
        syncResult: { success: false, error: error48.message },
        scheduleResult: { success: false, error: error48.message },
        amsResult: { success: false, error: error48.message },
        dataCollectionStatus: {
          status: "failed",
          currentRound: 0,
          totalRounds: DATA_COLLECTION_CONFIG.syncRounds,
          successRounds: 0
        }
      });
    }
  }
  const successCount = results.filter((r) => r.syncResult.success).length;
  log167.info(`[v360] \u6279\u91CF\u521D\u59CB\u5316\u542F\u52A8\u5B8C\u6210: ${successCount}/${accounts.length} \u4E2A\u8D26\u53F7\u5DF2\u5F00\u59CB\u6570\u636E\u6536\u96C6`);
  return results;
}
var log167, DATA_COLLECTION_CONFIG;
var init_accountInitializationService = __esm({
  "server/system/accountInitializationService.ts"() {
    "use strict";
    init_db2();
    init_amazonSyncService();
    init_amazonAdsApi();
    init_logger();
    log167 = createModuleLogger("AccountInit");
    DATA_COLLECTION_CONFIG = {
      totalDurationHours: 24,
      // 总收集周期
      syncRounds: 3,
      // 总同步轮次
      roundIntervalHours: 8,
      // 每轮间隔
      minSuccessRounds: 2,
      // 最少成功轮次才标记就绪
      maxRetryPerRound: 2,
      // 每轮最大重试次数
      historicalDays: 90
      // 历史数据天数
    };
    __name(isAccountReady, "isAccountReady");
    __name(initializeAccount, "initializeAccount");
    __name(recordSyncRound, "recordSyncRound");
    __name(scheduleSubsequentRounds, "scheduleSubsequentRounds");
    __name(getDataCollectionStatus, "getDataCollectionStatus");
    __name(initializeMultipleAccounts, "initializeMultipleAccounts");
  }
});

