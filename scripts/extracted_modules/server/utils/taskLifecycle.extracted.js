// Extracted from production dist/index.js
// Original module: server/utils/taskLifecycle.ts
// Lines: 42

function registerActiveTask(description, options) {
  const taskId = `task_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  activeTasks.set(taskId, {
    description,
    startedAt: /* @__PURE__ */ new Date(),
    targetId: options?.targetId,
    accountId: options?.accountId,
    module: options?.module
  });
  shutdownState.activeTaskCount = activeTasks.size;
  return taskId;
}
function unregisterActiveTask(taskId) {
  activeTasks.delete(taskId);
  shutdownState.activeTaskCount = activeTasks.size;
}
function isShuttingDown() {
  return shutdownState.isShuttingDown;
}
function markShuttingDown(reason) {
  shutdownState.isShuttingDown = true;
  shutdownState.shutdownStartedAt = /* @__PURE__ */ new Date();
  shutdownState.shutdownReason = reason;
}
var shutdownState, activeTasks;
var init_taskLifecycle = __esm({
  "server/utils/taskLifecycle.ts"() {
    "use strict";
    shutdownState = {
      isShuttingDown: false,
      shutdownStartedAt: null,
      shutdownReason: null,
      activeTaskCount: 0
    };
    activeTasks = /* @__PURE__ */ new Map();
    __name(registerActiveTask, "registerActiveTask");
    __name(unregisterActiveTask, "unregisterActiveTask");
    __name(isShuttingDown, "isShuttingDown");
    __name(markShuttingDown, "markShuttingDown");
  }
});

