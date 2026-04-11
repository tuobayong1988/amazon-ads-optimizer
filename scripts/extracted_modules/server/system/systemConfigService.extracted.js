// Extracted from production dist/index.js
// Original module: server/system/systemConfigService.ts
// Lines: 360

var systemConfigService_exports = {};
__export(systemConfigService_exports, {
  batchUpdateConfig: () => batchUpdateConfig,
  exportConfig: () => exportConfig,
  getAllConfig: () => getAllConfig,
  getChangeLog: () => getChangeLog,
  getConfig: () => getConfig,
  getConfigDetail: () => getConfigDetail,
  importConfig: () => importConfig,
  resetAllConfig: () => resetAllConfig,
  resetConfig: () => resetConfig,
  updateConfig: () => updateConfig
});
function initializeConfig() {
  for (const [key, def] of Object.entries(DEFAULT_CONFIG4)) {
    runtimeConfig.set(key, {
      ...def,
      updatedAt: /* @__PURE__ */ new Date(),
      updatedBy: "system_init"
    });
  }
}
function getConfig(key) {
  const param2 = runtimeConfig.get(key);
  if (param2) {
    return param2.value;
  }
  const def = DEFAULT_CONFIG4[key];
  if (def) {
    return def.defaultValue;
  }
  throw new Error(`[SystemConfig] \u672A\u77E5\u914D\u7F6E\u53C2\u6570: ${key}`);
}
function getConfigDetail(key) {
  return runtimeConfig.get(key);
}
function updateConfig(key, value, updatedBy = "system", reason = "") {
  const param2 = runtimeConfig.get(key);
  if (!param2) {
    log59.warn(`[SystemConfig] \u5C1D\u8BD5\u66F4\u65B0\u672A\u77E5\u53C2\u6570: ${key}`);
    return false;
  }
  if (param2.range && typeof value === "number") {
    if (value < param2.range.min || value > param2.range.max) {
      log59.warn(`[SystemConfig] \u53C2\u6570${key}\u7684\u503C${value}\u8D85\u51FA\u5408\u6CD5\u8303\u56F4[${param2.range.min}, ${param2.range.max}]`);
      return false;
    }
  }
  changeLogs.push({
    key,
    previousValue: param2.value,
    newValue: value,
    changedBy: updatedBy,
    reason,
    timestamp: /* @__PURE__ */ new Date()
  });
  while (changeLogs.length > MAX_CHANGE_LOGS) changeLogs.shift();
  param2.value = value;
  param2.updatedAt = /* @__PURE__ */ new Date();
  param2.updatedBy = updatedBy;
  log59.info(`[SystemConfig] \u53C2\u6570\u66F4\u65B0: ${key} = ${value} (by ${updatedBy}, reason: ${reason})`);
  return true;
}
function batchUpdateConfig(updates, updatedBy = "system", reason = "") {
  let success2 = 0;
  let failed = 0;
  const errors = [];
  for (const update of updates) {
    if (updateConfig(update.key, update.value, updatedBy, reason)) {
      success2++;
    } else {
      failed++;
      errors.push(`\u53C2\u6570${update.key}\u66F4\u65B0\u5931\u8D25`);
    }
  }
  return { success: success2, failed, errors };
}
function resetConfig(key, resetBy = "system") {
  const def = DEFAULT_CONFIG4[key];
  if (!def) return false;
  return updateConfig(key, def.defaultValue, resetBy, "\u91CD\u7F6E\u4E3A\u9ED8\u8BA4\u503C");
}
function resetAllConfig(resetBy = "system") {
  initializeConfig();
  changeLogs.push({
    key: "*",
    previousValue: "all",
    newValue: "defaults",
    changedBy: resetBy,
    reason: "\u91CD\u7F6E\u6240\u6709\u53C2\u6570\u4E3A\u9ED8\u8BA4\u503C",
    timestamp: /* @__PURE__ */ new Date()
  });
  while (changeLogs.length > MAX_CHANGE_LOGS) changeLogs.shift();
}
function getAllConfig(category) {
  const all3 = Array.from(runtimeConfig.values());
  if (category) {
    return all3.filter((p) => p.category === category);
  }
  return all3;
}
function getChangeLog(limit = 100) {
  return changeLogs.slice(-limit);
}
function exportConfig() {
  const exported = {};
  for (const [key, param2] of runtimeConfig) {
    exported[key] = param2.value;
  }
  return exported;
}
function importConfig(config2, importedBy = "system") {
  let success2 = 0;
  let failed = 0;
  for (const [key, value] of Object.entries(config2)) {
    if (updateConfig(key, value, importedBy, "\u4ECE\u5907\u4EFD\u5BFC\u5165")) {
      success2++;
    } else {
      failed++;
    }
  }
  return { success: success2, failed };
}
var log59, DEFAULT_CONFIG4, runtimeConfig, changeLogs, MAX_CHANGE_LOGS;
var init_systemConfigService = __esm({
  "server/system/systemConfigService.ts"() {
    "use strict";
    init_logger();
    log59 = createModuleLogger("SystemConfig");
    DEFAULT_CONFIG4 = {
      // ===== 安全护栏参数 =====
      "safety.cooldown_hours": {
        key: "safety.cooldown_hours",
        value: 72,
        // v510: 默认冷却期提升至72小时(3天)，尊重归因周期
        category: "safety",
        description: "\u51FA\u4EF7\u8C03\u6574\u51B7\u5374\u65F6\u95F4\u7A97\u53E3\uFF08\u5C0F\u65F6\uFF09\u2014 \u9ED8\u8BA4\u503C\uFF0CSP\u5E7F\u544A\u4F7F\u7528",
        defaultValue: 72,
        range: { min: 24, max: 168 }
      },
      "safety.cooldown_hours_sp": {
        key: "safety.cooldown_hours_sp",
        value: 72,
        // v510: SP广告3天冷却期（48h数据延迟+部分归因）
        category: "safety",
        description: "SP\u5E7F\u544A\u51FA\u4EF7\u8C03\u6574\u51B7\u5374\u65F6\u95F4\uFF08\u5C0F\u65F6\uFF09\u2014 7\u5929\u5F52\u56E0\u7A97\u53E3",
        defaultValue: 72,
        range: { min: 48, max: 168 }
      },
      "safety.cooldown_hours_sb": {
        key: "safety.cooldown_hours_sb",
        value: 120,
        // v510: SB广告5天冷却期（14天归因窗口更长）
        category: "safety",
        description: "SB\u5E7F\u544A\u51FA\u4EF7\u8C03\u6574\u51B7\u5374\u65F6\u95F4\uFF08\u5C0F\u65F6\uFF09\u2014 14\u5929\u5F52\u56E0\u7A97\u53E3",
        defaultValue: 120,
        range: { min: 72, max: 168 }
      },
      "safety.cooldown_hours_sd": {
        key: "safety.cooldown_hours_sd",
        value: 120,
        // v510: SD广告5天冷却期（14天归因窗口更长）
        category: "safety",
        description: "SD\u5E7F\u544A\u51FA\u4EF7\u8C03\u6574\u51B7\u5374\u65F6\u95F4\uFF08\u5C0F\u65F6\uFF09\u2014 14\u5929\u5F52\u56E0\u7A97\u53E3",
        defaultValue: 120,
        range: { min: 72, max: 168 }
      },
      "safety.min_adjustment_percent": {
        key: "safety.min_adjustment_percent",
        value: 0.02,
        category: "safety",
        description: "\u6700\u5C0F\u8C03\u6574\u5E45\u5EA6\u767E\u5206\u6BD4",
        defaultValue: 0.02,
        range: { min: 0.01, max: 0.1 }
      },
      "safety.max_adjustments_per_day": {
        key: "safety.max_adjustments_per_day",
        value: 1,
        // v510: 配合冷却期延长至72h+，每日最多1次调整
        category: "safety",
        description: "24\u5C0F\u65F6\u5185\u6700\u5927\u8C03\u6574\u6B21\u6570",
        defaultValue: 1,
        range: { min: 1, max: 4 }
      },
      "safety.max_cumulative_decrease_7d": {
        key: "safety.max_cumulative_decrease_7d",
        value: 0.15,
        // v510: 从20%收紧至15%，配合冷却期延长防止死亡螺旋
        category: "safety",
        description: "7\u5929\u5185\u7D2F\u8BA1\u964D\u4EF7\u5E45\u5EA6\u4E0A\u9650",
        defaultValue: 0.15,
        range: { min: 0.1, max: 0.3 }
      },
      "safety.max_consecutive_decreases": {
        key: "safety.max_consecutive_decreases",
        value: 2,
        category: "safety",
        description: "\u8FDE\u7EED\u964D\u4EF7\u6B21\u6570\u4E0A\u9650",
        defaultValue: 2,
        range: { min: 1, max: 5 }
      },
      "safety.min_bid_floor_ratio": {
        key: "safety.min_bid_floor_ratio",
        value: 0.5,
        category: "safety",
        description: "\u6700\u4F4E\u51FA\u4EF7\u4FDD\u62A4\u6BD4\u4F8B\uFF08\u76F8\u5BF9\u521D\u59CB\u51FA\u4EF7\uFF09",
        defaultValue: 0.5,
        range: { min: 0.3, max: 0.8 }
      },
      "safety.recovery_boost_percent": {
        key: "safety.recovery_boost_percent",
        value: 0.15,
        category: "safety",
        description: "\u7194\u65AD\u89E6\u53D1\u65F6\u7684\u63D0\u4EF7\u6062\u590D\u6BD4\u4F8B",
        defaultValue: 0.15,
        range: { min: 0.05, max: 0.3 }
      },
      "safety.max_bid_change_percent": {
        key: "safety.max_bid_change_percent",
        value: 0.20,
        // v608: 用户要求±20%最大调整幅度
        category: "safety",
        description: "\u5355\u6B21\u6700\u5927\u51FA\u4EF7\u53D8\u5316\u5E45\u5EA6",
        defaultValue: 0.20,
        range: { min: 0.05, max: 0.25 }
      },
      // ===== 算法参数 =====
      "algorithm.fusion_threshold": {
        key: "algorithm.fusion_threshold",
        value: 0.15,
        category: "algorithm",
        description: "Cascade Ensemble\u878D\u5408\u9608\u503C\uFF08\u5206\u5DEE\u767E\u5206\u6BD4\uFF09",
        defaultValue: 0.15,
        range: { min: 0.05, max: 0.3 }
      },
      "algorithm.exploration_rate_min": {
        key: "algorithm.exploration_rate_min",
        value: 0.3,
        category: "algorithm",
        description: "\u63A2\u7D22\u7387\u4E0B\u9650",
        defaultValue: 0.3,
        range: { min: 0.1, max: 0.5 }
      },
      "algorithm.exploration_rate_max": {
        key: "algorithm.exploration_rate_max",
        value: 0.65,
        category: "algorithm",
        description: "\u63A2\u7D22\u7387\u4E0A\u9650",
        defaultValue: 0.65,
        range: { min: 0.3, max: 0.8 }
      },
      "algorithm.ucb_epsilon": {
        key: "algorithm.ucb_epsilon",
        value: 0.2,
        category: "algorithm",
        description: "UCB\u63A2\u7D22\u7684epsilon\u53C2\u6570",
        defaultValue: 0.2,
        range: { min: 0.05, max: 0.4 }
      },
      "algorithm.confidence_threshold_ensemble": {
        key: "algorithm.confidence_threshold_ensemble",
        value: 0.35,
        category: "algorithm",
        description: "\u878D\u5408\u7B97\u6CD5\u7684\u7F6E\u4FE1\u5EA6\u95E8\u69DB",
        defaultValue: 0.35,
        range: { min: 0.2, max: 0.6 }
      },
      "algorithm.weight_learning_rate": {
        key: "algorithm.weight_learning_rate",
        value: 0.02,
        category: "algorithm",
        description: "\u6743\u91CD\u81EA\u5B66\u4E60\u7684\u5B66\u4E60\u7387",
        defaultValue: 0.02,
        range: { min: 5e-3, max: 0.1 }
      },
      // ===== 执行参数 =====
      "execution.api_retry_count": {
        key: "execution.api_retry_count",
        value: 3,
        category: "execution",
        description: "Amazon API\u8C03\u7528\u91CD\u8BD5\u6B21\u6570",
        defaultValue: 3,
        range: { min: 1, max: 5 }
      },
      "execution.api_retry_delay_ms": {
        key: "execution.api_retry_delay_ms",
        value: 2e3,
        category: "execution",
        description: "API\u91CD\u8BD5\u95F4\u9694\uFF08\u6BEB\u79D2\uFF09",
        defaultValue: 2e3,
        range: { min: 500, max: 1e4 }
      },
      "execution.batch_size": {
        key: "execution.batch_size",
        value: 50,
        category: "execution",
        description: "\u6279\u91CF\u64CD\u4F5C\u7684\u6279\u6B21\u5927\u5C0F",
        defaultValue: 50,
        range: { min: 10, max: 200 }
      },
      "execution.concurrent_accounts": {
        key: "execution.concurrent_accounts",
        value: 3,
        category: "execution",
        description: "\u5E76\u53D1\u5904\u7406\u7684\u8D26\u6237\u6570",
        defaultValue: 3,
        range: { min: 1, max: 10 }
      },
      // ===== 业务参数 =====
      "business.default_target_acos": {
        key: "business.default_target_acos",
        value: 0.3,
        category: "business",
        description: "\u9ED8\u8BA4\u76EE\u6807ACoS",
        defaultValue: 0.3,
        range: { min: 0.05, max: 1 }
      },
      "business.min_bid": {
        key: "business.min_bid",
        value: 0.02,
        category: "business",
        description: "\u6700\u4F4E\u51FA\u4EF7\uFF08\u7F8E\u5143\uFF09",
        defaultValue: 0.02,
        range: { min: 0.01, max: 0.1 }
      },
      "business.max_bid": {
        key: "business.max_bid",
        value: 100,
        category: "business",
        description: "\u6700\u9AD8\u51FA\u4EF7\uFF08\u7F8E\u5143\uFF09",
        defaultValue: 100,
        range: { min: 10, max: 500 }
      },
      "business.default_profit_margin": {
        key: "business.default_profit_margin",
        value: 0.3,
        category: "business",
        description: "\u9ED8\u8BA4\u5229\u6DA6\u7387",
        defaultValue: 0.3,
        range: { min: 0.05, max: 0.8 }
      }
    };
    runtimeConfig = /* @__PURE__ */ new Map();
    changeLogs = [];
    MAX_CHANGE_LOGS = 200;
    __name(initializeConfig, "initializeConfig");
    initializeConfig();
    __name(getConfig, "getConfig");
    __name(getConfigDetail, "getConfigDetail");
    __name(updateConfig, "updateConfig");
    __name(batchUpdateConfig, "batchUpdateConfig");
    __name(resetConfig, "resetConfig");
    __name(resetAllConfig, "resetAllConfig");
    __name(getAllConfig, "getAllConfig");
    __name(getChangeLog, "getChangeLog");
    __name(exportConfig, "exportConfig");
    __name(importConfig, "importConfig");
  }
});

