// Extracted from production dist/index.js
// Original module: server/services/systemConfigService.ts
// Lines: 43

var systemConfigService_exports2 = {};
__export(systemConfigService_exports2, {
  calculateHeapUtilization: () => calculateHeapUtilization,
  isHeapHealthy: () => isHeapHealthy,
  memoryConfig: () => memoryConfig
});
function getHeapSizeLimitMB() {
  const stats4 = import_v83.default.getHeapStatistics();
  return Math.round(stats4.heap_size_limit / 1024 / 1024);
}
function calculateHeapUtilization(heapUsedBytes) {
  return Math.round(heapUsedBytes / (HEAP_SIZE_LIMIT_MB * 1024 * 1024) * 100);
}
function isHeapHealthy(heapUsedMB) {
  return heapUsedMB < memoryConfig.heapHealthyThresholdMB;
}
var import_v83, log74, HEAP_SIZE_LIMIT_MB, memoryConfig;
var init_systemConfigService2 = __esm({
  "server/services/systemConfigService.ts"() {
    "use strict";
    import_v83 = __toESM(require("v8"));
    init_logger();
    log74 = createModuleLogger("SystemConfig");
    __name(getHeapSizeLimitMB, "getHeapSizeLimitMB");
    HEAP_SIZE_LIMIT_MB = getHeapSizeLimitMB();
    memoryConfig = {
      /** Node.js 堆内存上限（MB），来自 --max-old-space-size */
      heapSizeLimitMB: HEAP_SIZE_LIMIT_MB,
      /** 堆内存健康阈值（MB）：低于此值认为内存健康 */
      heapHealthyThresholdMB: Math.round(HEAP_SIZE_LIMIT_MB * 0.8),
      /** 堆内存保护触发阈值（百分比）：超过此值触发GC */
      heapProtectionPercent: 85,
      /** RSS 内存危急阈值（MB）：超过此值跳过所有任务 */
      rssCriticalMB: Math.round(HEAP_SIZE_LIMIT_MB * 1.05),
      /** RSS 内存警告阈值（MB）：超过此值跳过非关键任务 */
      rssWarningMB: Math.round(HEAP_SIZE_LIMIT_MB * 0.8)
    };
    __name(calculateHeapUtilization, "calculateHeapUtilization");
    __name(isHeapHealthy, "isHeapHealthy");
    log74.info(`[SystemConfig] v393 \u5185\u5B58\u914D\u7F6E\u5DF2\u521D\u59CB\u5316: heapSizeLimit=${HEAP_SIZE_LIMIT_MB}MB, heapHealthy<${memoryConfig.heapHealthyThresholdMB}MB, rssWarning>${memoryConfig.rssWarningMB}MB, rssCritical>${memoryConfig.rssCriticalMB}MB`);
  }
});

