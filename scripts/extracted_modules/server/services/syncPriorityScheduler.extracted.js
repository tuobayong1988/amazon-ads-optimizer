// Extracted from production dist/index.js
// Original module: server/services/syncPriorityScheduler.ts
// Lines: 22

var syncPriorityScheduler_exports2 = {};
__export(syncPriorityScheduler_exports2, {
  calculateAccountPriorities: () => calculateAccountPriorities,
  clearThrottlePause: () => clearThrottlePause,
  evaluateThrottlePause: () => evaluateThrottlePause,
  getConcurrencyStatus: () => getConcurrencyStatus,
  getCurrentBatchDelay: () => getCurrentBatchDelay,
  getCurrentConcurrency: () => getCurrentConcurrency,
  getMaxAccountsForTier: () => getMaxAccountsForTier,
  getThrottlePauseStatus: () => getThrottlePauseStatus,
  recordSuccessEvent: () => recordSuccessEvent,
  recordThrottleEvent: () => recordThrottleEvent,
  resetConcurrencyCounters: () => resetConcurrencyCounters,
  shouldPauseLowPriority: () => shouldPauseLowPriority
});
var init_syncPriorityScheduler2 = __esm({
  "server/services/syncPriorityScheduler.ts"() {
    "use strict";
    init_syncPriorityScheduler();
  }
});

