// Extracted from production dist/index.js
// Original module: server/sync/syncTaskConsumer.ts
// Lines: 153

function startSyncTaskConsumer() {
  if (isRunning) {
    log85.info("[v580] \u6D88\u8D39\u8005\u5DF2\u5728\u8FD0\u884C\u4E2D\uFF0C\u8DF3\u8FC7\u91CD\u590D\u542F\u52A8");
    return;
  }
  isRunning = true;
  log85.info("[v619] Redis \u4EFB\u52A1\u6D88\u8D39\u8005\u5DF2\u542F\u52A8 (\u5E76\u53D1\u4E0A\u96503, \u8F6E\u8BE215s, \u5FC3\u8DF330s)");
  pollTimer = setTimeout(() => pollAndConsume(), 5e3);  // v619: first poll after 5s instead of 30s
}
function stopSyncTaskConsumer() {
  isRunning = false;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  if (taskHeartbeatTimer) {
    clearInterval(taskHeartbeatTimer);
    taskHeartbeatTimer = null;
  }
  log85.info("[v580] Redis \u4EFB\u52A1\u6D88\u8D39\u8005\u5DF2\u505C\u6B62");
}
async function pollAndConsume() {
  if (!isRunning || isShuttingDown()) {
    log85.debug("[v580] \u6D88\u8D39\u8005\u5DF2\u505C\u6B62\u6216\u7CFB\u7EDF\u6B63\u5728\u5173\u95ED\uFF0C\u9000\u51FA\u8F6E\u8BE2");
    return;
  }
  let nextPollMs = IDLE_POLL_INTERVAL_MS;
  try {
    const status = await getQueueStatus();
    const totalPending = status.high + status.medium + status.low + status.nightly;
    const MAX_CONCURRENT_TASKS = 3;
    if (totalPending === 0 && status.processing === 0) {
      nextPollMs = IDLE_POLL_INTERVAL_MS;
    } else if (status.processing >= MAX_CONCURRENT_TASKS) {
      log85.debug(`[v619] ${status.processing}/${MAX_CONCURRENT_TASKS} \u4EFB\u52A1\u5904\u7406\u4E2D\uFF0C\u5DF2\u8FBE\u5E76\u53D1\u4E0A\u9650\uFF0C\u7B49\u5F85...`);
      nextPollMs = POLL_INTERVAL_MS;
    } else if (totalPending > 0) {
      const task = await dequeueTask();
      if (task) {
        nextPollMs = 2e3;
        executeTask(task).catch(e => log85.warn(`[v619] Task execution error: ${e.message}`));
      } else {
        nextPollMs = POLL_INTERVAL_MS;
      }
    } else {
      nextPollMs = POLL_INTERVAL_MS;
    }
  } catch (e) {
    log85.warn(`[v580] \u6D88\u8D39\u5FAA\u73AF\u5F02\u5E38: ${e.message}`);
    nextPollMs = POLL_INTERVAL_MS * 3;
  }
  if (isRunning && !isShuttingDown()) {
    pollTimer = setTimeout(() => pollAndConsume(), nextPollMs);
  }
}
async function executeTask(task) {
  const startTime = Date.now();
  currentTask = task;
  log85.info(
    `[v580] \u5F00\u59CB\u6267\u884C\u4EFB\u52A1: id=${task.id}, account=${task.accountId}, tier=${task.tier}, retry=${task.retryCount || 0}, trigger=${task.triggerSource || "auto"}`
  );
  taskHeartbeatTimer = setInterval(async () => {
    if (currentTask) {
      await updateTaskHeartbeat(currentTask.id, {
        currentStepIndex: currentTask.currentStepIndex,
        totalSteps: currentTask.totalSteps
      });
    }
  }, TASK_HEARTBEAT_INTERVAL_MS);
  try {
    const checkpoint = await loadTaskCheckpoint(task.id);
    if (checkpoint && checkpoint.completedStepIds.length > 0) {
      log85.info(
        `[v580] \u65AD\u70B9\u7EED\u4F20: task=${task.id}, \u8DF3\u8FC7 ${checkpoint.completedStepIds.length}/${checkpoint.totalSteps} \u4E2A\u5DF2\u5B8C\u6210\u6B65\u9AA4, \u5DF2\u540C\u6B65 ${checkpoint.totalSynced} \u6761\u8BB0\u5F55`
      );
    }
    const { syncAccount: syncAccount2 } = await Promise.resolve().then(() => (init_unifiedSyncEngine(), unifiedSyncEngine_exports));
    const skipStepsArray = checkpoint ? checkpoint.completedStepIds : [];
    const syncResult = await syncAccount2(
      { accountId: task.accountId },
      task.tier,
      {
        skipSteps: skipStepsArray,
        onProgress: /* @__PURE__ */ __name(async (stepName, stepIndex, totalSteps) => {
          const updatedCheckpoint = {
            taskId: task.id,
            accountId: task.accountId,
            tier: task.tier,
            completedStepIds: [...skipStepsArray],
            // 当前已完成的步骤
            currentStepIndex: stepIndex,
            totalSteps,
            totalSynced: 0,
            elapsedMs: Date.now() - startTime,
            savedAt: (/* @__PURE__ */ new Date()).toISOString()
          };
          await saveTaskCheckpoint(updatedCheckpoint).catch(() => {
          });
          task.currentStepIndex = stepIndex;
          task.totalSteps = totalSteps;
        }, "onProgress")
      }
    );
    const durationMs = Date.now() - startTime;
    await completeTask(task.id, task.accountId, task.tier);
    log85.info(
      `[v580] \u4EFB\u52A1\u5B8C\u6210: id=${task.id}, account=${task.accountId}, tier=${task.tier}, \u8017\u65F6=${Math.round(durationMs / 1e3)}s`
    );
    // v620-fix10: Event-driven healthSignal precompute on sync completion
    _hsPrecomputeForAccount(task.accountId).catch(() => {});
  } catch (error48) {
    const durationMs = Date.now() - startTime;
    const errorMsg = error48.message || String(error48);
    if (durationMs > MAX_TASK_DURATION_MS) {
      log85.warn(`[v580] \u4EFB\u52A1\u8D85\u65F6: id=${task.id}, \u8017\u65F6=${Math.round(durationMs / 1e3)}s`);
    }
    if (isShuttingDown()) {
      log85.info(`[v580] \u4EFB\u52A1\u88AB\u5173\u95ED\u4FE1\u53F7\u4E2D\u65AD: id=${task.id}, \u68C0\u67E5\u70B9\u5DF2\u4FDD\u5B58`);
      return;
    }
    log85.warn(`[v580] \u4EFB\u52A1\u5931\u8D25: id=${task.id}, error=${errorMsg.substring(0, 200)}`);
    await failTask(task.id, errorMsg, task);
  } finally {
    if (taskHeartbeatTimer) {
      clearInterval(taskHeartbeatTimer);
      taskHeartbeatTimer = null;
    }
    currentTask = null;
  }
}
var log85, isRunning, pollTimer, currentTask, taskHeartbeatTimer, POLL_INTERVAL_MS, IDLE_POLL_INTERVAL_MS, TASK_HEARTBEAT_INTERVAL_MS, MAX_TASK_DURATION_MS;
var init_syncTaskConsumer = __esm({
  "server/sync/syncTaskConsumer.ts"() {
    "use strict";
    init_logger();
    init_distributedQueue();
    init_taskLifecycle();
    log85 = createModuleLogger("SyncTaskConsumer");
    isRunning = false;
    pollTimer = null;
    currentTask = null;
    taskHeartbeatTimer = null;
    POLL_INTERVAL_MS = 1e4;
    IDLE_POLL_INTERVAL_MS = 15e3;  // v619: reduced from 30s to 15s for faster task pickup
    TASK_HEARTBEAT_INTERVAL_MS = 3e4;  // v619: reduced from 60s to 30s for better stuck detection
    MAX_TASK_DURATION_MS = 4 * 60 * 60 * 1e3;
    __name(startSyncTaskConsumer, "startSyncTaskConsumer");
    __name(stopSyncTaskConsumer, "stopSyncTaskConsumer");
    __name(pollAndConsume, "pollAndConsume");
    __name(executeTask, "executeTask");
  }
});

