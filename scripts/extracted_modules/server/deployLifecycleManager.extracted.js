// Extracted from production dist/index.js
// Original module: server/deployLifecycleManager.ts
// Lines: 840

var deployLifecycleManager_exports = {};
__export(deployLifecycleManager_exports, {
  flushPendingTasks: () => flushPendingTasks,
  getActiveTaskCount: () => getActiveTaskCount,
  getDeployRecoveryCompletedAt: () => getDeployRecoveryCompletedAt,
  getSystemInfo: () => getSystemInfo,
  isDeployRecoveryComplete: () => isDeployRecoveryComplete,
  isShuttingDown: () => isShuttingDown2,
  markDeployRecoveryComplete: () => markDeployRecoveryComplete,
  orchestrateStartup: () => orchestrateStartup,
  recoverInterruptedTasks: () => recoverInterruptedTasks2,
  registerActiveTask: () => registerActiveTask3,
  registerGracefulShutdown: () => registerGracefulShutdown,
  runStartupDiagnostics: () => runStartupDiagnostics,
  startHeartbeat: () => startHeartbeat,
  unregisterActiveTask: () => unregisterActiveTask3
});
function isDeployRecoveryComplete() {
  return _deployRecoveryComplete;
}
function markDeployRecoveryComplete() {
  _deployRecoveryComplete = true;
  _deployRecoveryCompletedAt = /* @__PURE__ */ new Date();
  log129.info(`[LifecycleManager] v491: \u90E8\u7F72\u6062\u590D\u5DF2\u5B8C\u6210\uFF0C\u5B9A\u671F\u4F18\u5316\u8C03\u5EA6\u5668\u73B0\u5728\u53EF\u4EE5\u5F00\u59CB\u6267\u884C`);
}
function getDeployRecoveryCompletedAt() {
  return _deployRecoveryCompletedAt;
}
function registerGracefulShutdown(server) {
  httpServer = server;
  process.on("SIGTERM", () => handleShutdown("SIGTERM"));
  process.on("SIGINT", () => handleShutdown("SIGINT"));
  process.on("uncaughtException", async (error48) => {
    const errorMsg = error48.message || "";
    log129.warn(`[LifecycleManager] \u672A\u6355\u83B7\u5F02\u5E38: ${errorMsg}`);
    log129.warn(error48.stack);
    const NON_FATAL_PATTERNS = [
      "val.toString is not a function",
      "Cannot convert undefined or null to object",
      "Cannot read properties of undefined",
      "Cannot read properties of null"
    ];
    const isNonFatal = NON_FATAL_PATTERNS.some((pattern) => errorMsg.includes(pattern));
    if (isNonFatal) {
      log129.warn(`[LifecycleManager] v522: \u975E\u81F4\u547D\u5F02\u5E38\u5DF2\u6355\u83B7\u5E76\u8BB0\u5F55\uFF0C\u7CFB\u7EDF\u7EE7\u7EED\u8FD0\u884C\uFF08\u4E0D\u89E6\u53D1\u5173\u95ED\uFF09`);
      log129.warn(`[LifecycleManager] v522: \u9519\u8BEF\u7C7B\u578B: ${errorMsg.substring(0, 100)}`);
      try {
        const database = await getDb();
        if (database) {
          const detail = JSON.stringify({
            type: "non_fatal_uncaught_exception",
            systemVersion: SYSTEM_VERSION,
            errorMessage: errorMsg.substring(0, 500),
            errorStack: (error48.stack || "").substring(0, 1e3),
            uptime: process.uptime(),
            timestamp: (/* @__PURE__ */ new Date()).toISOString()
          });
          await database.execute(sql`INSERT INTO optimization_events (account_id, event_category, action_type, action_detail, change_reason, algorithm_version, status, api_sync_status) VALUES (0, 'settings_change', 'settings_update', ${detail}, ${`v${SYSTEM_VERSION} \u975E\u81F4\u547D\u5F02\u5E38\u5DF2\u5B89\u5168\u6355\u83B7: ${errorMsg.substring(0, 100)}`}, ${`v${SYSTEM_VERSION}`}, 'success', 'internal')`);
        }
      } catch (logErr) {
      }
      return;
    }
    log129.warn(`[LifecycleManager] v522: \u81F4\u547D\u5F02\u5E38\uFF0C\u89E6\u53D1\u4F18\u96C5\u5173\u95ED...`);
    await handleShutdown("uncaughtException");
  });
  process.on("unhandledRejection", (reason, promise2) => {
    const errorMessage = reason instanceof Error ? reason.message : String(reason);
    const errorStack = reason instanceof Error ? reason.stack : void 0;
    log129.warn(`[LifecycleManager] \u672A\u5904\u7406\u7684Promise\u62D2\u7EDD: ${errorMessage}`);
    if (errorStack) {
      log129.warn(errorStack);
    }
    if (errorMessage.includes("ECONNREFUSED") || errorMessage.includes("PROTOCOL_CONNECTION_LOST")) {
      log129.warn("[LifecycleManager] \u68C0\u6D4B\u5230\u4E25\u91CD\u8FDE\u63A5\u9519\u8BEF\uFF0C\u89E6\u53D1\u4F18\u96C5\u5173\u95ED");
      handleShutdown("unhandledRejection-critical").catch(() => {
      });
    }
  });
  log129.info("[LifecycleManager] v359: \u4F18\u96C5\u5173\u95ED\u5904\u7406\u5668\u5DF2\u6CE8\u518C\uFF08\u542B unhandledRejection \u5168\u5C40\u6355\u83B7\uFF09");
}
async function handleShutdown(signal) {
  if (shutdownState2.isShuttingDown) {
    log129.debug(`[LifecycleManager] \u5DF2\u5728\u5173\u95ED\u4E2D\uFF0C\u5FFD\u7565\u91CD\u590D\u4FE1\u53F7: ${signal}`);
    return;
  }
  shutdownState2.isShuttingDown = true;
  shutdownState2.shutdownStartedAt = /* @__PURE__ */ new Date();
  shutdownState2.shutdownReason = signal;
  markShuttingDown(signal);
  log129.debug(`
[LifecycleManager] ========================================`);
  log129.info(`[LifecycleManager] \u6536\u5230 ${signal} \u4FE1\u53F7\uFF0C\u5F00\u59CB\u4F18\u96C5\u5173\u95ED...`);
  log129.debug(`[LifecycleManager] \u5F53\u524D\u6D3B\u8DC3\u4EFB\u52A1: ${activeTasks2.size}`);
  log129.debug(`[LifecycleManager] ========================================
`);
  const SHUTDOWN_TIMEOUT = 25e3;
  try {
    log129.debug("[LifecycleManager] \u9636\u6BB51: \u505C\u6B62\u63A5\u6536\u65B0\u4EFB\u52A1...");
    await stopNewTaskAcceptance();
    log129.info("[LifecycleManager] \u9636\u6BB52: \u7B49\u5F85\u6D3B\u8DC3\u4EFB\u52A1\u5B8C\u6210...");
    await waitForActiveTasks(2e4);
    log129.info("[LifecycleManager] \u9636\u6BB53: \u6301\u4E45\u5316\u7CFB\u7EDF\u72B6\u6001...");
    await persistShutdownState();
    log129.debug("[LifecycleManager] \u9636\u6BB54: \u5173\u95EDHTTP\u670D\u52A1\u5668...");
    await closeHttpServer();
    log129.info(`[LifecycleManager] \u4F18\u96C5\u5173\u95ED\u5B8C\u6210 (\u8017\u65F6: ${Date.now() - shutdownState2.shutdownStartedAt.getTime()}ms)`);
  } catch (error48) {
    log129.warn(`[LifecycleManager] \u5173\u95ED\u8FC7\u7A0B\u51FA\u9519: ${error48.message}`);
  } finally {
    process.exit(0);
  }
}
async function stopNewTaskAcceptance() {
  try {
    if (heartbeatTimer3) {
      clearInterval(heartbeatTimer3);
      heartbeatTimer3 = null;
    }
    try {
      stopSyncTaskConsumer();
      log129.info("[LifecycleManager]   \u2713 Redis \u4EFB\u52A1\u6D88\u8D39\u8005\u5DF2\u505C\u6B62");
    } catch (e) {
      log129.warn(`[LifecycleManager]   \u26A0 \u505C\u6B62 Redis \u4EFB\u52A1\u6D88\u8D39\u8005\u5931\u8D25: ${e.message}`);
    }
    try {
      stopDataSyncScheduler();
      log129.info("[LifecycleManager]   \u2713 \u6570\u636E\u540C\u6B65\u8C03\u5EA6\u5668\u5DF2\u505C\u6B62");
    } catch (e) {
      log129.warn(`[LifecycleManager]   \u26A0 \u505C\u6B62\u6570\u636E\u540C\u6B65\u8C03\u5EA6\u5668\u5931\u8D25: ${e.message}`);
    }
    try {
      stopSQSConsumer();
      log129.debug("[LifecycleManager]   \u2713 SQS\u6D88\u8D39\u8005\u5DF2\u505C\u6B62");
    } catch (e) {
      log129.warn(`[LifecycleManager]   \u26A0 \u505C\u6B62SQS\u6D88\u8D39\u8005\u5931\u8D25: ${e.message}`);
    }
    try {
      reportJobScheduler.stop();
      log129.debug("[LifecycleManager]   \u2713 \u62A5\u544A\u8C03\u5EA6\u5668\u5DF2\u505C\u6B62");
    } catch (e) {
      log129.warn(`[LifecycleManager]   \u26A0 \u505C\u6B62\u62A5\u544A\u8C03\u5EA6\u5668\u5931\u8D25: ${e.message}`);
    }
    try {
      stopOptimizationScheduler2();
      log129.debug("[LifecycleManager]   \u2713 \u4F18\u5316\u8C03\u5EA6\u5668\u5DF2\u505C\u6B62");
    } catch (e) {
      log129.warn(`[LifecycleManager]   \u26A0 \u505C\u6B62\u4F18\u5316\u8C03\u5EA6\u5668\u5931\u8D25: ${e.message}`);
    }
    try {
      stopEffectTrackingScheduler();
      log129.debug("[LifecycleManager]   \u2713 \u6548\u679C\u8FFD\u8E2A\u8C03\u5EA6\u5668\u5DF2\u505C\u6B62");
    } catch (e) {
      log129.warn(`[LifecycleManager]   \u26A0 \u505C\u6B62\u6548\u679C\u8FFD\u8E2A\u8C03\u5EA6\u5668\u5931\u8D25: ${e.message}`);
    }
  } catch (error48) {
    log129.warn(`[LifecycleManager] \u505C\u6B62\u4EFB\u52A1\u6E90\u5931\u8D25: ${error48.message}`);
  }
}
async function waitForActiveTasks(maxWaitMs) {
  if (activeTasks2.size === 0) {
    log129.debug("[LifecycleManager]   \u65E0\u6D3B\u8DC3\u4EFB\u52A1\uFF0C\u76F4\u63A5\u7EE7\u7EED");
    return;
  }
  log129.info(`[LifecycleManager]   \u7B49\u5F85 ${activeTasks2.size} \u4E2A\u6D3B\u8DC3\u4EFB\u52A1\u5B8C\u6210 (\u6700\u591A ${maxWaitMs / 1e3}\u79D2)...`);
  for (const [taskId, task] of activeTasks2) {
    log129.debug(`[LifecycleManager]     - ${taskId}: ${task.description} (\u8FD0\u884C ${Math.round((Date.now() - task.startedAt.getTime()) / 1e3)}\u79D2)`);
  }
  const startWait = Date.now();
  const checkInterval = 500;
  while (activeTasks2.size > 0 && Date.now() - startWait < maxWaitMs) {
    await new Promise((resolve) => setTimeout(resolve, checkInterval));
  }
  if (activeTasks2.size > 0) {
    log129.warn(`[LifecycleManager]   \u26A0 \u8D85\u65F6! \u4ECD\u6709 ${activeTasks2.size} \u4E2A\u4EFB\u52A1\u672A\u5B8C\u6210\uFF0C\u5C06\u88AB\u4E2D\u65AD:`);
    for (const [taskId, task] of activeTasks2) {
      log129.warn(`[LifecycleManager]     - ${taskId}: ${task.description}`);
    }
  } else {
    log129.info(`[LifecycleManager]   \u2713 \u6240\u6709\u6D3B\u8DC3\u4EFB\u52A1\u5DF2\u5B8C\u6210 (\u7B49\u5F85 ${Date.now() - startWait}ms)`);
  }
}
async function persistShutdownState() {
  try {
    const database = await getDb();
    if (!database) {
      log129.warn("[LifecycleManager]   \u26A0 \u6570\u636E\u5E93\u4E0D\u53EF\u7528\uFF0C\u8DF3\u8FC7\u72B6\u6001\u6301\u4E45\u5316");
      return;
    }
    try {
      const shutdownNote = ` [v185-shutdown: interrupted by ${shutdownState2.shutdownReason}]`;
      const resetResult = await database.execute(sql`
        UPDATE optimization_tasks 
        SET status = 'pending', 
            processing_started_at = NULL,
            error_message = CONCAT(COALESCE(error_message, ''), ${shutdownNote})
        WHERE status = 'processing'
      `);
      const affectedRows = resetResult?.[0]?.affectedRows || 0;
      if (affectedRows > 0) {
        log129.debug(`[LifecycleManager]   \u2713 \u5DF2\u5C06 ${affectedRows} \u4E2Aprocessing\u4EFB\u52A1\u91CD\u7F6E\u4E3Apending`);
      } else {
        log129.debug("[LifecycleManager]   \u2713 \u65E0processing\u4EFB\u52A1\u9700\u8981\u91CD\u7F6E");
      }
    } catch (e) {
      log129.warn(`[LifecycleManager]   \u26A0 \u91CD\u7F6Eprocessing\u4EFB\u52A1\u5931\u8D25: ${e.message}`);
    }
    try {
      const syncResetNote = `v${SYSTEM_VERSION}-shutdown: ${shutdownState2.shutdownReason} at ${(/* @__PURE__ */ new Date()).toISOString()}`;
      const runningJobs = await database.execute(sql`
 SELECT id, account_id as accountId, current_step FROM data_sync_jobs WHERE status = 'running'
 `);
      const runningCount = runningJobs?.[0]?.length || (Array.isArray(runningJobs) ? runningJobs.filter((r) => r.id).length : 0);
      if (runningCount > 0) {
        log129.info(`[LifecycleManager] v409: shutdown\u65F6\u53D1\u73B0 ${runningCount} \u4E2Arunning\u540C\u6B65\u4EFB\u52A1\uFF0C\u4E0D\u518D\u65E0\u6761\u4EF6\u6807\u8BB0\u4E3Afailed\uFF0C\u7531startup cleanup\u57FA\u4E8Eupdated_at\u9608\u503C\u5904\u7406`);
      } else {
        log129.debug("[LifecycleManager] v409: shutdown\u65F6\u65E0running\u7684\u6570\u636E\u540C\u6B65\u4EFB\u52A1");
      }
      const syncCancelResult = await database.execute(sql`
 UPDATE data_sync_jobs 
 SET status = 'cancelled', 
 completedAt = NOW(),
 errorMessage = CONCAT(COALESCE(errorMessage, ''), ' [', ${syncResetNote}, ']')
 WHERE status = 'pending'
 `);
      const syncCancelled = syncCancelResult?.[0]?.affectedRows || 0;
      if (syncCancelled > 0) {
        log129.info(`[LifecycleManager]   \u2713 \u5DF2\u53D6\u6D88 ${syncCancelled} \u4E2Apending\u7684\u6570\u636E\u540C\u6B65\u4EFB\u52A1\uFF08\u90E8\u7F72\u540E\u5C06\u91CD\u65B0\u8C03\u5EA6\uFF09`);
      }
    } catch (e) {
      log129.warn(`[LifecycleManager]   \u26A0 \u91CD\u7F6E\u6570\u636E\u540C\u6B65\u4EFB\u52A1\u5931\u8D25: ${e.message}`);
    }
    try {
      const redisPersisted = await persistProcessingTasks();
      if (redisPersisted > 0) {
        log129.info(`[LifecycleManager]   \u2713 v580: \u5DF2\u6301\u4E45\u5316 ${redisPersisted} \u4E2A Redis \u5904\u7406\u4E2D\u4EFB\u52A1\u7684\u72B6\u6001`);
      }
    } catch (e) {
      log129.warn(`[LifecycleManager]   \u26A0 v580: Redis \u961F\u5217\u72B6\u6001\u6301\u4E45\u5316\u5931\u8D25: ${e.message}`);
    }
    try {
      await releaseAllMyLocks();
      stopWorkerLifecycle();
      log129.info("[LifecycleManager]   \u2713 v580: Redis \u8D26\u6237\u9501\u5DF2\u91CA\u653E\uFF0CWorker \u751F\u547D\u5468\u671F\u5DF2\u505C\u6B62");
    } catch (e) {
      log129.warn(`[LifecycleManager]   \u26A0 v580: Redis \u9501\u91CA\u653E\u5931\u8D25: ${e.message}`);
    }
    try {
      await writeHeartbeat("graceful");
      log129.debug("[LifecycleManager]   \u2713 \u5DF2\u8BB0\u5F55\u4F18\u96C5\u5173\u95ED\u5FC3\u8DF3");
    } catch (e) {
      log129.warn(`[LifecycleManager]   \u26A0 \u8BB0\u5F55\u5173\u95ED\u5FC3\u8DF3\u5931\u8D25: ${e.message}`);
    }
    try {
      const interruptedTasks = [];
      for (const [taskId, task] of activeTasks2) {
        interruptedTasks.push(`${taskId}: ${task.description}`);
      }
      await database.insert(optimizationEvents2).values({
        accountId: 0,
        eventCategory: "settings_change",
        actionType: "settings_update",
        actionDetail: JSON.stringify({
          type: "system_shutdown",
          systemVersion: SYSTEM_VERSION,
          shutdownReason: shutdownState2.shutdownReason,
          shutdownType: "graceful",
          activeTasksAtShutdown: activeTasks2.size,
          interruptedTasks,
          shutdownDuration: Date.now() - (shutdownState2.shutdownStartedAt?.getTime() || Date.now())
        }),
        changeReason: `\u7CFB\u7EDF\u4F18\u96C5\u5173\u95ED v${SYSTEM_VERSION} (${shutdownState2.shutdownReason})`,
        algorithmVersion: `v${SYSTEM_VERSION}`,
        status: "success",
        apiSyncStatus: "internal"
        // v513: 内部系统事件
      });
      log129.debug("[LifecycleManager]   \u2713 \u5DF2\u8BB0\u5F55\u5173\u95ED\u4E8B\u4EF6");
    } catch (e) {
      log129.warn(`[LifecycleManager]   \u26A0 \u8BB0\u5F55\u5173\u95ED\u4E8B\u4EF6\u5931\u8D25: ${e.message}`);
    }
  } catch (error48) {
    log129.warn(`[LifecycleManager] \u72B6\u6001\u6301\u4E45\u5316\u5931\u8D25: ${error48.message}`);
  }
}
async function closeHttpServer() {
  if (!httpServer) return;
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      log129.warn("[LifecycleManager]   \u26A0 HTTP\u670D\u52A1\u5668\u5173\u95ED\u8D85\u65F6\uFF0C\u5F3A\u5236\u7EE7\u7EED");
      resolve();
    }, 2e3);
    httpServer.close(() => {
      clearTimeout(timeout);
      log129.debug("[LifecycleManager]   \u2713 HTTP\u670D\u52A1\u5668\u5DF2\u5173\u95ED");
      resolve();
    });
  });
}
function registerActiveTask3(description, options) {
  const taskId = `task_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  activeTasks2.set(taskId, {
    description,
    startedAt: /* @__PURE__ */ new Date(),
    targetId: options?.targetId,
    accountId: options?.accountId,
    module: options?.module
  });
  shutdownState2.activeTaskCount = activeTasks2.size;
  return taskId;
}
function unregisterActiveTask3(taskId) {
  activeTasks2.delete(taskId);
  shutdownState2.activeTaskCount = activeTasks2.size;
}
function isShuttingDown2() {
  return shutdownState2.isShuttingDown;
}
function getActiveTaskCount() {
  return activeTasks2.size;
}
function startHeartbeat() {
  writeHeartbeat("running").catch((err) => {
    log129.warn(`[LifecycleManager] \u5199\u5165\u542F\u52A8\u5FC3\u8DF3\u5931\u8D25: ${err.message}`);
  });
  heartbeatTimer3 = setInterval(async () => {
    try {
      await writeHeartbeat("running");
    } catch (err) {
      log129.warn(`[LifecycleManager] \u5FC3\u8DF3\u5199\u5165\u5931\u8D25: ${err.message}`);
    }
  }, 60 * 1e3);
  log129.info("[LifecycleManager] v185: \u5FC3\u8DF3\u5B9A\u65F6\u5668\u5DF2\u542F\u52A8 (\u95F4\u9694: 60\u79D2)");
}
async function writeHeartbeat(shutdownType) {
  const database = await getDb();
  if (!database) return;
  let syncHealth = { consecutiveFailures: 0, lastSyncTime: null, isRunning: false };
  try {
    const { getSyncHealthStatus: getSyncHealthStatus2 } = await Promise.resolve().then(() => (init_dataSyncScheduler(), dataSyncScheduler_exports));
    syncHealth = getSyncHealthStatus2();
  } catch (e) {
    log129.debug(`[LifecycleManager] \u8C03\u5EA6\u5668\u53EF\u80FD\u672A\u542F\u52A8: ${e.message}`);
  }
  await database.execute(sql`
    INSERT INTO optimization_events 
      (account_id, event_category, action_type, action_detail, change_reason, algorithm_version, status, api_sync_status, created_at)
    VALUES 
      (0, 'settings_change', 'settings_update', 
       ${JSON.stringify({
    type: "system_heartbeat",
    systemVersion: SYSTEM_VERSION,
    shutdownType,
    activeTaskCount: activeTasks2.size,
    uptime: process.uptime(),
    syncHealth: {
      consecutiveFailures: syncHealth.consecutiveFailures,
      lastSyncTime: syncHealth.lastSyncTime?.toISOString() || null,
      schedulerRunning: syncHealth.isRunning
    }
  })},
       'system_heartbeat',
       ${`v${SYSTEM_VERSION}`},
       'success',
       'internal',
       NOW())
    ON DUPLICATE KEY UPDATE
      action_detail = VALUES(action_detail),
      created_at = NOW()
  `);
}
async function runStartupDiagnostics() {
  log129.info("[LifecycleManager] v185: \u8FD0\u884C\u542F\u52A8\u8BCA\u65AD...");
  const diagnostics = {
    lastShutdownType: "unknown",
    lastHeartbeatAge: -1,
    interruptedTasks: 0,
    pendingTasks: 0,
    versionChanged: false,
    previousVersion: null,
    currentVersion: SYSTEM_VERSION
  };
  try {
    const database = await getDb();
    if (!database) {
      log129.warn("[LifecycleManager] \u6570\u636E\u5E93\u4E0D\u53EF\u7528\uFF0C\u8DF3\u8FC7\u542F\u52A8\u8BCA\u65AD");
      return diagnostics;
    }
    const shutdownEvents = await database.select({ actionDetail: optimizationEvents2.actionDetail, createdAt: optimizationEvents2.createdAt }).from(optimizationEvents2).where(
      and(
        eq(optimizationEvents2.eventCategory, "settings_change"),
        eq(optimizationEvents2.actionType, "settings_update"),
        sql`JSON_EXTRACT(${optimizationEvents2.actionDetail}, '$.type') IN ('system_shutdown', 'system_heartbeat')`
      )
    ).orderBy(desc(optimizationEvents2.createdAt)).limit(5);
    if (shutdownEvents.length > 0) {
      const lastEvent = shutdownEvents[0];
      try {
        const detail = JSON.parse(lastEvent.actionDetail || "{}");
        if (detail.type === "system_shutdown" && detail.shutdownType === "graceful") {
          diagnostics.lastShutdownType = "graceful";
        } else if (detail.type === "system_heartbeat") {
          const heartbeatTime = new Date(lastEvent.createdAt || "").getTime();
          const ageSeconds = (Date.now() - heartbeatTime) / 1e3;
          diagnostics.lastHeartbeatAge = ageSeconds;
          if (ageSeconds > 180) {
            diagnostics.lastShutdownType = "crash";
          } else {
            diagnostics.lastShutdownType = "unknown";
          }
        }
        diagnostics.previousVersion = detail.systemVersion || null;
      } catch {
      }
    }
    try {
      const interruptedResult = await database.execute(sql`
        SELECT COUNT(*) as cnt FROM optimization_tasks WHERE status = 'processing'
      `);
      diagnostics.interruptedTasks = interruptedResult?.[0]?.[0]?.cnt || 0;
    } catch {
    }
    try {
      const pendingResult = await database.execute(sql`
        SELECT COUNT(*) as cnt FROM optimization_tasks WHERE status IN ('pending', 'retry')
      `);
      diagnostics.pendingTasks = pendingResult?.[0]?.[0]?.cnt || 0;
    } catch {
    }
    diagnostics.versionChanged = diagnostics.previousVersion !== null && diagnostics.previousVersion < SYSTEM_VERSION;
  } catch (error48) {
    log129.warn(`[LifecycleManager] \u542F\u52A8\u8BCA\u65AD\u5931\u8D25: ${error48.message}`);
  }
  log129.info(`[LifecycleManager] \u542F\u52A8\u8BCA\u65AD\u7ED3\u679C:`);
  log129.debug(`  \u4E0A\u6B21\u5173\u95ED\u7C7B\u578B: ${diagnostics.lastShutdownType}`);
  log129.debug(`  \u4E0A\u6B21\u5FC3\u8DF3\u8DDD\u4ECA: ${diagnostics.lastHeartbeatAge >= 0 ? Math.round(diagnostics.lastHeartbeatAge) + "\u79D2" : "\u65E0\u8BB0\u5F55"}`);
  log129.debug(`  \u88AB\u4E2D\u65AD\u7684\u4EFB\u52A1: ${diagnostics.interruptedTasks}`);
  log129.info(`  \u5F85\u5904\u7406\u7684\u4EFB\u52A1: ${diagnostics.pendingTasks}`);
  log129.info(`  \u7248\u672C\u53D8\u5316: ${diagnostics.versionChanged ? `v${diagnostics.previousVersion} \u2192 v${SYSTEM_VERSION}` : "\u65E0"}`);
  return diagnostics;
}
async function recoverInterruptedTasks2() {
  try {
    const database = await getDb();
    if (!database) return 0;
    const result = await database.execute(sql`
      UPDATE optimization_tasks 
      SET status = 'pending', 
          processing_started_at = NULL,
          error_message = CONCAT(COALESCE(error_message, ''), ' [v185-recovery: reset after restart]')
      WHERE status = 'processing'
    `);
    const recovered = result?.[0]?.affectedRows || 0;
    if (recovered > 0) {
      log129.debug(`[LifecycleManager] \u2713 \u5DF2\u6062\u590D ${recovered} \u4E2A\u88AB\u4E2D\u65AD\u7684\u4EFB\u52A1 (processing \u2192 pending)`);
      await database.insert(optimizationEvents2).values({
        accountId: 0,
        eventCategory: "settings_change",
        actionType: "auto_correction",
        actionDetail: JSON.stringify({
          // @ts-ignore
          type: "task_recovery",
          systemVersion: SYSTEM_VERSION,
          recoveredTasks: recovered,
          recoveryReason: "restart_after_deploy"
        }),
        changeReason: `v${SYSTEM_VERSION} \u542F\u52A8\u6062\u590D: \u91CD\u7F6E ${recovered} \u4E2A\u88AB\u4E2D\u65AD\u7684\u4EFB\u52A1`,
        algorithmVersion: `v${SYSTEM_VERSION}`,
        status: "success",
        apiSyncStatus: "internal"
        // v513: 内部系统事件
      });
    }
    return recovered;
  } catch (error48) {
    log129.warn(`[LifecycleManager] \u6062\u590D\u4E2D\u65AD\u4EFB\u52A1\u5931\u8D25: ${error48.message}`);
    return 0;
  }
}
async function flushPendingTasks() {
  try {
    const { processSyncQueue } = await Promise.resolve().then(() => (init_optimizationSyncEngine(), optimizationSyncEngine_exports));
    if (typeof processSyncQueue === "function") {
      log129.info("[LifecycleManager] \u89E6\u53D1\u540C\u6B65\u5F15\u64CE\u5904\u7406pending\u4EFB\u52A1...");
      const result = await processSyncQueue({});
      log129.info(`[LifecycleManager] \u2713 \u540C\u6B65\u5F15\u64CE\u5904\u7406\u5B8C\u6210: ${JSON.stringify(result)}`);
    }
  } catch (error48) {
    log129.warn(`[LifecycleManager] \u89E6\u53D1\u540C\u6B65\u5F15\u64CE\u5931\u8D25: ${error48.message}`);
  }
}
async function orchestrateStartup(server) {
  log129.debug(`
[LifecycleManager] ========================================`);
  log129.info(`[LifecycleManager] v${SYSTEM_VERSION}: \u7CFB\u7EDF\u542F\u52A8\u534F\u8C03\u5F00\u59CB`);
  log129.debug(`[LifecycleManager] ========================================
`);
  registerGracefulShutdown(server);
  startHeartbeat();
  const diagnostics = await runStartupDiagnostics();
  if (diagnostics.interruptedTasks > 0) {
    await recoverInterruptedTasks2();
  }
  try {
    log129.info("[LifecycleManager] v580: \u6B65\u9AA43.2 - Redis \u961F\u5217\u4E2D\u65AD\u4EFB\u52A1\u6062\u590D...");
    const redisRecovery = await recoverInterruptedTasks(5 * 60 * 1e3);
    if (redisRecovery.recovered > 0 || redisRecovery.expired > 0) {
      log129.info(
        `[LifecycleManager] v580: Redis \u6062\u590D\u5B8C\u6210: ${redisRecovery.recovered}\u4E2A\u5DF2\u6062\u590D(${redisRecovery.withCheckpoint}\u4E2A\u6709\u68C0\u67E5\u70B9), ${redisRecovery.expired}\u4E2A\u5DF2\u653E\u5F03`
      );
      for (const detail of redisRecovery.details.slice(0, 5)) {
        log129.info(`[LifecycleManager] v580:   - ${detail}`);
      }
    } else {
      log129.info("[LifecycleManager] v580: Redis \u961F\u5217\u65E0\u4E2D\u65AD\u4EFB\u52A1\u9700\u8981\u6062\u590D");
    }
    const qStatus = await getQueueStatus();
    const totalPending = qStatus.high + qStatus.medium + qStatus.low + qStatus.nightly;
    if (totalPending > 0 || qStatus.processing > 0) {
      log129.info(`[LifecycleManager] v580: Redis \u961F\u5217\u72B6\u6001: high=${qStatus.high} medium=${qStatus.medium} low=${qStatus.low} nightly=${qStatus.nightly} processing=${qStatus.processing} checkpoints=${qStatus.checkpoints}`);
    }
  } catch (redisRecErr) {
    log129.warn(`[LifecycleManager] v580: Redis \u961F\u5217\u6062\u590D\u5931\u8D25\uFF08\u4E0D\u5F71\u54CD\u7CFB\u7EDF\u542F\u52A8\uFF09: ${redisRecErr.message}`);
  }
  try {
    log129.info("[LifecycleManager] v335: \u6B65\u9AA43.5 - \u6570\u636E\u540C\u6B65\u4EFB\u52A1\u6062\u590D...");
    const database = await getDb();
    if (database) {
      const staleCleanNote = `v${SYSTEM_VERSION}-startup: cleaned stale running job`;
      const staleThresholdMinutes = 5;
      const interruptedJobsResult = await database.execute(sql`
        SELECT id, accountId, syncType, current_step, current_step_index, total_steps
        FROM data_sync_jobs 
        WHERE status = 'running'
          AND updated_at < DATE_SUB(NOW(), INTERVAL ${sql.raw(String(staleThresholdMinutes))} MINUTE)
      `);
      const interruptedRows = Array.isArray(interruptedJobsResult) ? interruptedJobsResult[0] : interruptedJobsResult.rows || interruptedJobsResult;
      const interruptedJobs = [];
      if (Array.isArray(interruptedRows)) {
        for (const row of interruptedRows) {
          if (row && row.id) {
            interruptedJobs.push({
              id: row.id,
              accountId: row.accountId,
              syncType: row.syncType,
              currentStep: row.current_step,
              currentStepIndex: row.current_step_index || 0,
              totalSteps: row.total_steps || 0
              // @ts-ignore
            });
          }
        }
      }
      const staleResult = await database.execute(sql`
        UPDATE data_sync_jobs 
        SET status = 'failed', 
            completedAt = NOW(),
            errorMessage = CONCAT(COALESCE(errorMessage, ''), ' [', ${staleCleanNote}, ']')
        WHERE status = 'running'
          AND updated_at < DATE_SUB(NOW(), INTERVAL ${sql.raw(String(staleThresholdMinutes))} MINUTE)
      `);
      const staleCleaned = staleResult?.[0]?.affectedRows || 0;
      if (interruptedJobs.length > 0) {
        global.__interrupted_sync_jobs = interruptedJobs;
        log129.info(`[LifecycleManager] v411:   \u2139 \u8BB0\u5F55\u4E86 ${interruptedJobs.length} \u4E2A\u4E2D\u65AD\u4EFB\u52A1\u7684\u65AD\u70B9\u4FE1\u606F: ${interruptedJobs.map((j) => `Job${j.id}(\u8D26\u6237${j.accountId},\u6B65\u9AA4${j.currentStepIndex}/${j.totalSteps})`).join(", ")}`);
      }
      const activeJobs = await database.execute(sql`
        SELECT id, current_step, updated_at FROM data_sync_jobs 
        WHERE status = 'running'
          AND updated_at >= DATE_SUB(NOW(), INTERVAL ${sql.raw(String(staleThresholdMinutes))} MINUTE)
      `);
      const activeCount = activeJobs?.[0]?.length || (Array.isArray(activeJobs) ? activeJobs.filter((r) => r.id).length : 0);
      if (staleCleaned > 0) {
        log129.info(`[LifecycleManager] v411:   \u2713 \u6E05\u7406\u4E86 ${staleCleaned} \u4E2A\u5361\u6B7B\u7684\u6570\u636E\u540C\u6B65\u4EFB\u52A1\uFF08updated_at\u8D85\u8FC7${staleThresholdMinutes}\u5206\u949F\u672A\u66F4\u65B0\uFF09`);
      }
      if (activeCount > 0) {
        log129.info(`[LifecycleManager] v411:   \u2139 \u53D1\u73B0 ${activeCount} \u4E2A\u5FC3\u8DF3\u6B63\u5E38\u7684running\u4EFB\u52A1\uFF0C\u4FDD\u7559\u4E0D\u6E05\u7406`);
      }
      const lastSyncResult = await database.execute(sql`
        SELECT accountId as account_id, MAX(completedAt) as last_sync 
        FROM data_sync_jobs 
        WHERE status = 'completed' 
        GROUP BY accountId
      `);
      const lastSyncs = lastSyncResult?.[0] || [];
      const now = Date.now();
      const staleAccounts = [];
      for (const row of lastSyncs) {
        if (row.last_sync) {
          const lastSyncTime = new Date(row.last_sync).getTime();
          const hoursSinceSync = (now - lastSyncTime) / (1e3 * 60 * 60);
          if (hoursSinceSync > 2) {
            staleAccounts.push(row.account_id);
            log129.warn(`[LifecycleManager] v335:   \u26A0 \u8D26\u6237 ${row.account_id} \u5DF2 ${hoursSinceSync.toFixed(1)} \u5C0F\u65F6\u672A\u6210\u529F\u540C\u6B65`);
          }
        }
      }
      if (staleAccounts.length > 0) {
        log129.info(`[LifecycleManager] v335:   \u2139 ${staleAccounts.length} \u4E2A\u8D26\u6237\u540C\u6B65\u6EDE\u540E\uFF0C\u5C06\u5728\u6570\u636E\u540C\u6B65\u8C03\u5EA6\u5668\u542F\u52A8\u540E\u7ACB\u5373\u89E6\u53D1\u540C\u6B65`);
      }
      if (staleCleaned > 0 || staleAccounts.length > 0) {
        const detail = JSON.stringify({
          type: "data_sync_recovery",
          systemVersion: SYSTEM_VERSION,
          staleJobsCleaned: staleCleaned,
          staleAccounts,
          staleAccountCount: staleAccounts.length
        });
        await database.execute(sql`
 INSERT INTO optimization_events (account_id, event_category, action_type, action_detail, change_reason, algorithm_version, status, api_sync_status) 
 VALUES (0, 'settings_change', 'auto_correction', ${detail}, ${`v${SYSTEM_VERSION} \u542F\u52A8\u6062\u590D: \u6E05\u7406${staleCleaned}\u4E2A\u5361\u6B7B\u540C\u6B65\u4EFB\u52A1, ${staleAccounts.length}\u4E2A\u8D26\u6237\u540C\u6B65\u6EDE\u540E`}, ${`v${SYSTEM_VERSION}`}, 'success', 'internal')
 `);
      }
      log129.info(`[LifecycleManager] v405: \u6B65\u9AA43.5d - \u90E8\u7F72\u540E\u8F7B\u91CF\u7EA7\u6570\u636E\u540C\u6B65(high\u5C42\u7EA7)...`);
      setTimeout(async () => {
        try {
          const { syncAllAccounts: syncAllAccounts2 } = await Promise.resolve().then(() => (init_unifiedSyncEngine(), unifiedSyncEngine_exports));
          const syncResult = await syncAllAccounts2("high");
          log129.info(`[LifecycleManager] v405: \u90E8\u7F72\u540E\u8F7B\u91CF\u7EA7\u540C\u6B65\u5B8C\u6210 - \u6210\u529F: ${syncResult.successfulAccounts}/${syncResult.totalAccounts}, \u5931\u8D25: ${syncResult.failedAccounts}, \u8017\u65F6: ${syncResult.durationMs}ms`);
          log129.info(`[LifecycleManager] v491: \u540C\u6B65\u5B8C\u6210\uFF0C\u4F46\u4F18\u5316\u5C06\u5728\u7EA0\u9519\u6D41\u7A0B\u5B8C\u6210\u540E\u7EDF\u4E00\u89E6\u53D1\uFF08\u4E0D\u518D\u7ACB\u5373\u89E6\u53D1\uFF09`);
          const syncDetail = JSON.stringify({
            type: "deploy_recovery_sync_complete",
            systemVersion: SYSTEM_VERSION,
            // @ts-ignore
            totalAccounts: syncResult.totalAccounts,
            // @ts-ignore
            successfulAccounts: syncResult.successfulAccounts,
            // @ts-ignore
            failedAccounts: syncResult.failedAccounts,
            // @ts-ignore
            durationMs: syncResult.durationMs
          });
          await database.execute(sql`
 INSERT INTO optimization_events (account_id, event_category, action_type, action_detail, change_reason, algorithm_version, status, api_sync_status) 
 VALUES (0, 'settings_change', 'auto_correction', ${syncDetail}, ${`v${SYSTEM_VERSION} \u90E8\u7F72\u540E\u5B8C\u6574\u540C\u6B65\u5B8C\u6210: ${syncResult.successfulAccounts}/${syncResult.totalAccounts}\u6210\u529F`}, ${`v${SYSTEM_VERSION}`}, 'success', 'internal')
 `);
        } catch (syncErr) {
          log129.warn(`[LifecycleManager] v405: \u90E8\u7F72\u540E\u8F7B\u91CF\u7EA7\u540C\u6B65\u5931\u8D25: ${syncErr.message}`);
        }
      }, 15 * 1e3);
    }
  } catch (syncRecoveryErr) {
    log129.warn(`[LifecycleManager] v335: \u6570\u636E\u540C\u6B65\u6062\u590D\u5931\u8D25\uFF08\u4E0D\u5F71\u54CD\u7CFB\u7EDF\u542F\u52A8\uFF09: ${syncRecoveryErr.message}`);
  }
  setTimeout(async () => {
    try {
      if (diagnostics.pendingTasks > 0 || diagnostics.interruptedTasks > 0) {
        log129.info(`[LifecycleManager] \u5904\u7406 ${diagnostics.pendingTasks + diagnostics.interruptedTasks} \u4E2A\u5F85\u5904\u7406/\u6062\u590D\u7684\u4EFB\u52A1...`);
        await flushPendingTasks();
      }
      let corrResult = { totalIssuesFound: 0, totalCorrected: 0, totalFailed: 0 };
      try {
        log129.info("[LifecycleManager] v491: \u6B65\u9AA44b - \u8FD0\u884CAPI\u6267\u884C\u7EA7\u7EA0\u9519\uFF08\u626B\u63CF\u6240\u6709\u4F18\u5316\u65E5\u5FD7\uFF0C\u68C0\u6D4B\u5E76\u4FEE\u590D\u9519\u8BEF\u4F18\u5316\u52A8\u4F5C\uFF09...");
        const { runAutoCorrection: runAutoCorrection2 } = await Promise.resolve().then(() => (init_optimizationAutoCorrector(), optimizationAutoCorrector_exports));
        corrResult = await runAutoCorrection2();
        log129.info(`[LifecycleManager] v491: \u2713 \u7EA0\u9519\u5B8C\u6210: \u53D1\u73B0${corrResult.totalIssuesFound}\u4E2A\u95EE\u9898, \u7EA0\u6B63${corrResult.totalCorrected}\u4E2A`);
      } catch (corrErr) {
        log129.warn(`[LifecycleManager] v491: \u7EA0\u9519\u626B\u63CF\u5931\u8D25\uFF08\u5DF2\u9694\u79BB\uFF0C\u7EE7\u7EED\u6267\u884C\u6307\u4EE4\u91CD\u8BC4\u4F30\uFF09: ${corrErr.message}`);
      }
      try {
        log129.info("[LifecycleManager] v491: \u6B65\u9AA44c - \u8FD0\u884C\u90E8\u7F72\u540E\u6307\u4EE4\u91CD\u8BC4\u4F30\u4E0E\u81EA\u52A8\u7EA0\u9519...");
        const { runFullRevalidation: runFullRevalidation2 } = await Promise.resolve().then(() => (init_postDeployCommandRevalidator(), postDeployCommandRevalidator_exports));
        const revalResult = await runFullRevalidation2();
        log129.info(`[LifecycleManager] v491: \u2713 \u6307\u4EE4\u91CD\u8BC4\u4F30\u5B8C\u6210: ${revalResult.targetsProcessed}\u4E2A\u76EE\u6807, pending=${revalResult.totalPendingRevalidated}(\u53D6\u6D88${revalResult.totalPendingCancelled},\u91CD\u89E6\u53D1${revalResult.totalPendingRetriggered}), \u5386\u53F2\u7EA0\u6B63=${revalResult.totalCorrectionsGenerated}`);
      } catch (revalErr) {
        log129.warn(`[LifecycleManager] v491: \u6307\u4EE4\u91CD\u8BC4\u4F30\u5931\u8D25\uFF08\u5DF2\u9694\u79BB\uFF0C\u7EE7\u7EED\u6267\u884C\u9A8C\u8BC1\uFF09: ${revalErr.message}`);
      }
      if (Number(corrResult.totalCorrected) > 0) {
        try {
          log129.info(`[LifecycleManager] v491: \u6B65\u9AA44d - \u7B49\u5F8560\u79D2\u8BA9Amazon\u5904\u7406${corrResult.totalCorrected}\u4E2A\u7EA0\u9519\u6307\u4EE4...`);
          await new Promise((resolve) => setTimeout(resolve, 60 * 1e3));
          const { runAutoCorrection: runVerify } = await Promise.resolve().then(() => (init_optimizationAutoCorrector(), optimizationAutoCorrector_exports));
          const verifyResult = await runVerify();
          const newIssues = verifyResult.totalIssuesFound;
          const newCorrected = verifyResult.totalCorrected;
          if (newIssues === 0) {
            log129.info(`[LifecycleManager] v491: \u2713 \u4E8C\u6B21\u9A8C\u8BC1\u901A\u8FC7 \u2014 \u6240\u6709\u7EA0\u9519\u6307\u4EE4\u5DF2\u88ABAmazon\u6210\u529F\u6267\u884C`);
          } else {
            log129.warn(`[LifecycleManager] v491: \u26A0 \u4E8C\u6B21\u9A8C\u8BC1\u53D1\u73B0${newIssues}\u4E2A\u6B8B\u4F59\u4E0D\u4E00\u81F4, \u5DF2\u81EA\u52A8\u7EA0\u6B63${newCorrected}\u4E2A`);
          }
          try {
            const database = await getDb();
            if (database) {
              const detail = JSON.stringify({
                type: "post_deploy_correction_verification",
                systemVersion: SYSTEM_VERSION,
                correctionResult: { issuesFound: corrResult.totalIssuesFound, corrected: corrResult.totalCorrected },
                verificationResult: { issuesFound: newIssues, corrected: newCorrected, passed: newIssues === 0 }
              });
              const reason = `v${SYSTEM_VERSION} \u7EA0\u9519\u540E\u4E8C\u6B21\u9A8C\u8BC1: ${newIssues === 0 ? "\u901A\u8FC7" : `\u53D1\u73B0${newIssues}\u4E2A\u6B8B\u4F59\u4E0D\u4E00\u81F4`}`;
              const algVer = `v${SYSTEM_VERSION}`;
              const status = newIssues === 0 ? "success" : "pending";
              await database.execute(sql`INSERT INTO optimization_events (account_id, event_category, action_type, action_detail, change_reason, algorithm_version, status, api_sync_status) VALUES (0, 'settings_change', 'auto_correction', ${detail}, ${reason}, ${algVer}, ${status}, 'internal')`);
            }
          } catch (logErr) {
            log129.warn(`[LifecycleManager] v491: \u8BB0\u5F55\u9A8C\u8BC1\u7ED3\u679C\u5931\u8D25\uFF08\u4E0D\u5F71\u54CD\u7CFB\u7EDF\u8FD0\u884C\uFF09: ${logErr.message}`);
          }
        } catch (verifyErr) {
          log129.warn(`[LifecycleManager] v491: \u4E8C\u6B21\u9A8C\u8BC1\u5931\u8D25\uFF08\u4E0D\u5F71\u54CD\u7CFB\u7EDF\u8FD0\u884C\uFF09: ${verifyErr.message}`);
        }
      } else {
        log129.info("[LifecycleManager] v491: \u65E0\u7EA0\u9519\u64CD\u4F5C\uFF0C\u8DF3\u8FC7\u4E8C\u6B21\u9A8C\u8BC1");
      }
      let deployResult = { triggered: false, reason: "not_executed", targetsProcessed: 0, targetsSucceeded: 0, targetsFailed: 0, totalOptimizationActions: 0 };
      try {
        log129.info("[LifecycleManager] v491: \u6B65\u9AA44e - \u7EA0\u9519\u5DF2\u5B8C\u6210\uFF0C\u73B0\u5728\u8FD0\u884C\u90E8\u7F72\u540E\u91CD\u4F18\u5316\uFF08\u65B0\u7B97\u6CD5\uFF09...");
        const { runPostDeployOptimization: runPostDeployOptimization2 } = await Promise.resolve().then(() => (init_postDeployOptimizer(), postDeployOptimizer_exports));
        deployResult = await runPostDeployOptimization2();
        if (deployResult.triggered) {
          log129.info(`[LifecycleManager] v491: \u2713 \u90E8\u7F72\u540E\u91CD\u4F18\u5316\u5B8C\u6210: ${deployResult.targetsProcessed}\u4E2A\u76EE\u6807, ${deployResult.targetsSucceeded}\u4E2A\u6210\u529F, ${deployResult.totalOptimizationActions}\u4E2A\u4F18\u5316\u52A8\u4F5C`);
        } else {
          log129.debug(`[LifecycleManager] v491: \u2713 ${deployResult.reason}`);
        }
      } catch (deployErr) {
        log129.warn(`[LifecycleManager] v491: \u90E8\u7F72\u540E\u91CD\u4F18\u5316\u5931\u8D25\uFF08\u5DF2\u9694\u79BB\uFF0C\u4E0D\u5F71\u54CD\u7CFB\u7EDF\u8FD0\u884C\uFF09: ${deployErr.message}`);
      }
      try {
        log129.info("[LifecycleManager] v491: \u6B65\u9AA44f - \u68C0\u6D4B\u662F\u5426\u9700\u8981\u6267\u884C\u667A\u80FD\u51B7\u542F\u52A8...");
        const { triggerColdStartForAllAccounts: triggerColdStartForAllAccounts2 } = await Promise.resolve().then(() => (init_coldStartService(), coldStartService_exports));
        const coldStartResult = await triggerColdStartForAllAccounts2("version_upgrade", {
          skipSync: false,
          historicalDays: 90,
          recentDays: 14
        });
        if (coldStartResult.triggered > 0) {
          log129.info(`[LifecycleManager] v491: \u667A\u80FD\u51B7\u542F\u52A8\u5DF2\u89E6\u53D1 ${coldStartResult.triggered}/${coldStartResult.total} \u4E2A\u8D26\u6237`);
        } else {
          log129.info(`[LifecycleManager] v491: \u65E0\u9700\u51B7\u542F\u52A8\uFF08\u6240\u6709\u8D26\u6237\u5DF2\u5728\u5F53\u524D\u7248\u672C\u6267\u884C\u8FC7\uFF09`);
        }
      } catch (coldStartErr) {
        log129.warn(`[LifecycleManager] v491: \u667A\u80FD\u51B7\u542F\u52A8\u5931\u8D25\uFF08\u5DF2\u9694\u79BB\uFF0C\u4E0D\u5F71\u54CD\u7CFB\u7EDF\u8FD0\u884C\uFF09: ${coldStartErr.message}`);
      }
      if (diagnostics.lastShutdownType === "crash") {
        try {
          const database = await getDb();
          if (database) {
            const detail = JSON.stringify({
              type: "crash_recovery_complete",
              systemVersion: SYSTEM_VERSION,
              diagnostics,
              correctionResult: { issuesFound: corrResult.totalIssuesFound, corrected: corrResult.totalCorrected },
              deployResult: { triggered: deployResult.triggered, targetsProcessed: deployResult.targetsProcessed, targetsSucceeded: deployResult.targetsSucceeded }
            });
            const reason = `v${SYSTEM_VERSION} crash\u6062\u590D\u5B8C\u6210`;
            const algVer = `v${SYSTEM_VERSION}`;
            await database.execute(sql`INSERT INTO optimization_events (account_id, event_category, action_type, action_detail, change_reason, algorithm_version, status, api_sync_status) VALUES (0, 'settings_change', 'auto_correction', ${detail}, ${reason}, ${algVer}, 'success', 'internal')`);
          }
        } catch (crashLogErr) {
          log129.warn(`[LifecycleManager] v491: \u8BB0\u5F55crash\u6062\u590D\u4E8B\u4EF6\u5931\u8D25\uFF08\u4E0D\u5F71\u54CD\u7CFB\u7EDF\u8FD0\u884C\uFF09: ${crashLogErr.message}`);
        }
      }
      markDeployRecoveryComplete();
      log129.info(`[LifecycleManager] v491: \u2705 \u90E8\u7F72\u6062\u590D\u5168\u90E8\u5B8C\u6210\uFF08\u7EA0\u9519=${corrResult.totalCorrected}, \u91CD\u4F18\u5316=${deployResult.totalOptimizationActions}\uFF09\uFF0C\u5B9A\u671F\u4F18\u5316\u73B0\u5728\u53EF\u4EE5\u5F00\u59CB`);
      try {
        log129.info("[LifecycleManager] \u8FD0\u884C\u7CFB\u7EDF\u76D1\u63A7\u68C0\u67E5...");
        const { runMonitoringCheck: runMonitoringCheck2, formatMonitoringReport: formatMonitoringReport2 } = await Promise.resolve().then(() => (init_optimizationMonitoringService(), optimizationMonitoringService_exports));
        const database = await getDb();
        if (database) {
          const teams = await database.selectDistinct({ teamId: optimizationEvents2.userId }).from(optimizationEvents2).limit(10);
          for (const team of teams) {
            if (team.teamId) {
              const report = await runMonitoringCheck2(team.teamId);
              log129.info(`[MonitoringService] \u56E2\u961F${team.teamId}: \u5065\u5EB7\u8BC4\u5206${report.healthScore}/100 (${report.status}), ${report.alerts.length}\u4E2A\u544A\u8B66`);
            }
          }
        }
      } catch (monErr) {
        log129.warn(`[LifecycleManager] \u76D1\u63A7\u68C0\u67E5\u5931\u8D25\uFF08\u4E0D\u5F71\u54CD\u7CFB\u7EDF\u8FD0\u884C\uFF09: ${monErr.message}`);
      }
      log129.debug(`
[LifecycleManager] ========================================`);
      log129.info(`[LifecycleManager] v${SYSTEM_VERSION}: \u542F\u52A8\u534F\u8C03\u5B8C\u6210\uFF0C\u7CFB\u7EDF\u8FDB\u5165\u6B63\u5E38\u8FD0\u884C`);
      log129.debug(`[LifecycleManager] ========================================
`);
    } catch (err) {
      log129.warn(`[LifecycleManager] \u542F\u52A8\u534F\u8C03\u4EFB\u52A1\u5931\u8D25: ${err.message}`);
      log129.warn(err.stack);
    }
  }, 30 * 1e3);
  log129.info(`[LifecycleManager] \u542F\u52A8\u534F\u8C03: \u521D\u59CB\u5316\u5B8C\u6210\uFF0C\u7EA0\u9519\u548C\u91CD\u4F18\u5316\u5C06\u572830\u79D2\u540E\u6267\u884C`);
}
function getSystemInfo() {
  return {
    version: SYSTEM_VERSION,
    isShuttingDown: shutdownState2.isShuttingDown,
    activeTasks: activeTasks2.size,
    uptime: process.uptime()
  };
}
var log129, shutdownState2, activeTasks2, heartbeatTimer3, httpServer, _deployRecoveryComplete, _deployRecoveryCompletedAt;
var init_deployLifecycleManager = __esm({
  "server/deployLifecycleManager.ts"() {
    "use strict";
    init_db2();
    init_schema2();
    init_drizzle_orm();
    init_dataSyncScheduler();
    init_sqsConsumerService();
    init_effectTrackingScheduler();
    init_systemVersion();
    init_reportJobScheduler();
    init_logger();
    init_taskLifecycle();
    init_distributedQueue();
    init_syncTaskConsumer();
    log129 = createModuleLogger("DeployLifecycle");
    shutdownState2 = {
      isShuttingDown: false,
      shutdownStartedAt: null,
      shutdownReason: "",
      activeTaskCount: 0
    };
    activeTasks2 = /* @__PURE__ */ new Map();
    heartbeatTimer3 = null;
    httpServer = null;
    _deployRecoveryComplete = false;
    _deployRecoveryCompletedAt = null;
    __name(isDeployRecoveryComplete, "isDeployRecoveryComplete");
    __name(markDeployRecoveryComplete, "markDeployRecoveryComplete");
    __name(getDeployRecoveryCompletedAt, "getDeployRecoveryCompletedAt");
    __name(registerGracefulShutdown, "registerGracefulShutdown");
    __name(handleShutdown, "handleShutdown");
    __name(stopNewTaskAcceptance, "stopNewTaskAcceptance");
    __name(waitForActiveTasks, "waitForActiveTasks");
    __name(persistShutdownState, "persistShutdownState");
    __name(closeHttpServer, "closeHttpServer");
    __name(registerActiveTask3, "registerActiveTask");
    __name(unregisterActiveTask3, "unregisterActiveTask");
    __name(isShuttingDown2, "isShuttingDown");
    __name(getActiveTaskCount, "getActiveTaskCount");
    __name(startHeartbeat, "startHeartbeat");
    __name(writeHeartbeat, "writeHeartbeat");
    __name(runStartupDiagnostics, "runStartupDiagnostics");
    __name(recoverInterruptedTasks2, "recoverInterruptedTasks");
    __name(flushPendingTasks, "flushPendingTasks");
    __name(orchestrateStartup, "orchestrateStartup");
    __name(getSystemInfo, "getSystemInfo");
  }
});

