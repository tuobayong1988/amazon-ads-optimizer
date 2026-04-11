// Extracted from production dist/index.js
// Original module: server/algorithm/weightAutoTuningService.ts
// Lines: 193

var weightAutoTuningService_exports = {};
__export(weightAutoTuningService_exports, {
  adjustWeights: () => adjustWeights,
  applyWeightTuning: () => applyWeightTuning,
  calculateDimensionCorrelations: () => calculateDimensionCorrelations,
  getDefaultTuningConfig: () => getDefaultTuningConfig,
  getEffectiveWeights: () => getEffectiveWeights,
  getTuningHistory: () => getTuningHistory,
  rollbackWeights: () => rollbackWeights
});
function getEffectiveWeights(strategyTemplateId, defaultWeights) {
  const cached2 = tuningCache.get(strategyTemplateId);
  if (cached2) {
    log113.info(`[WeightAutoTuning] \u4F7F\u7528\u81EA\u5B66\u4E60\u6743\u91CD: strategy=${strategyTemplateId}, weights=${JSON.stringify(cached2)}`);
    return { ...cached2 };
  }
  return { ...defaultWeights };
}
function calculateDimensionCorrelations(dimensionScores, outcomes) {
  if (dimensionScores.length !== outcomes.length || dimensionScores.length < 2) {
    return DIMENSION_NAMES.map((d) => ({
      dimension: d,
      avgScore: 0,
      correlationWithOutcome: 0,
      sampleCount: dimensionScores.length
    }));
  }
  const n = dimensionScores.length;
  const meanOutcome = outcomes.reduce((s, v) => s + v, 0) / n;
  return DIMENSION_NAMES.map((dimension) => {
    const scores = dimensionScores.map((s) => s[dimension] || 0);
    const meanScore = scores.reduce((s, v) => s + v, 0) / n;
    let numerator = 0;
    let denomX = 0;
    let denomY = 0;
    for (let i = 0; i < n; i++) {
      const dx = scores[i] - meanScore;
      const dy = outcomes[i] - meanOutcome;
      numerator += dx * dy;
      denomX += dx * dx;
      denomY += dy * dy;
    }
    const denom = Math.sqrt(denomX * denomY);
    const correlation = denom > 0 ? numerator / denom : 0;
    return {
      dimension,
      avgScore: meanScore,
      correlationWithOutcome: Math.max(-1, Math.min(1, correlation)),
      sampleCount: n
    };
  });
}
function adjustWeights(currentWeights, dimensionPerformances, config2 = DEFAULT_TUNING_CONFIG) {
  const previousWeights = { ...currentWeights };
  const newWeights = {};
  const adjustments = [];
  for (const perf of dimensionPerformances) {
    const currentWeight = currentWeights[perf.dimension] || 0;
    let delta = 0;
    let reason = "";
    if (perf.sampleCount < config2.minSampleSize) {
      newWeights[perf.dimension] = currentWeight;
      reason = `\u6837\u672C\u4E0D\u8DB3(${perf.sampleCount}<${config2.minSampleSize})\uFF0C\u4FDD\u6301\u4E0D\u53D8`;
    } else if (perf.correlationWithOutcome > 0.1) {
      delta = config2.learningRate * perf.correlationWithOutcome;
      delta = Math.min(delta, config2.maxAdjustmentPercent);
      newWeights[perf.dimension] = currentWeight + delta;
      reason = `\u6B63\u76F8\u5173(r=${perf.correlationWithOutcome.toFixed(3)})\uFF0C\u589E\u52A0\u6743\u91CD`;
    } else if (perf.correlationWithOutcome < -0.1) {
      delta = config2.learningRate * perf.correlationWithOutcome;
      delta = Math.max(delta, -config2.maxAdjustmentPercent);
      newWeights[perf.dimension] = Math.max(config2.minWeightFloor, currentWeight + delta);
      reason = `\u8D1F\u76F8\u5173(r=${perf.correlationWithOutcome.toFixed(3)})\uFF0C\u964D\u4F4E\u6743\u91CD`;
    } else {
      const baseWeight = 1 / DIMENSION_NAMES.length;
      delta = (baseWeight - currentWeight) * config2.learningRate * 0.5;
      newWeights[perf.dimension] = currentWeight + delta;
      reason = `\u5F31\u76F8\u5173(r=${perf.correlationWithOutcome.toFixed(3)})\uFF0C\u5411\u5747\u5300\u5206\u5E03\u56DE\u5F52`;
    }
    adjustments.push({
      dimension: perf.dimension,
      oldWeight: currentWeight,
      newWeight: newWeights[perf.dimension],
      delta,
      reason
    });
  }
  const totalWeight = Object.values(newWeights).reduce((s, w) => s + w, 0);
  if (totalWeight > 0) {
    for (let round = 0; round < 3; round++) {
      const currentTotal = Object.values(newWeights).reduce((s, w) => s + w, 0);
      if (currentTotal <= 0) break;
      for (const key of Object.keys(newWeights)) {
        newWeights[key] = newWeights[key] / currentTotal;
        newWeights[key] = Math.max(config2.minWeightFloor, newWeights[key]);
      }
    }
    const finalTotal = Object.values(newWeights).reduce((s, w) => s + w, 0);
    for (const key of Object.keys(newWeights)) {
      newWeights[key] = newWeights[key] / finalTotal;
    }
  }
  for (const adj of adjustments) {
    adj.newWeight = newWeights[adj.dimension];
    adj.delta = adj.newWeight - adj.oldWeight;
  }
  const result = {
    strategyTemplateId: "pending",
    // 调用方设置
    previousWeights,
    newWeights,
    adjustments,
    evaluationMetrics: {
      sampleSize: dimensionPerformances[0]?.sampleCount || 0,
      avgOutcomeImprovement: 0,
      // 由调用方填充
      confidenceLevel: 0
    },
    timestamp: /* @__PURE__ */ new Date()
  };
  return result;
}
function applyWeightTuning(strategyTemplateId, result) {
  result.strategyTemplateId = strategyTemplateId;
  tuningCache.set(strategyTemplateId, result.newWeights);
  tuningHistory.push(result);
  while (tuningHistory.length > 100) {
    tuningHistory.shift();
  }
  log113.info(`[WeightAutoTuning] \u6743\u91CD\u5DF2\u66F4\u65B0: strategy=${strategyTemplateId}, adjustments=${result.adjustments.filter((a) => Math.abs(a.delta) > 1e-3).length}\u4E2A\u7EF4\u5EA6`);
}
function rollbackWeights(strategyTemplateId) {
  const history = tuningHistory.filter((h) => h.strategyTemplateId === strategyTemplateId);
  if (history.length < 2) {
    tuningCache.delete(strategyTemplateId);
    log113.info(`[WeightAutoTuning] \u6743\u91CD\u5DF2\u56DE\u6EDA\u5230\u9ED8\u8BA4: strategy=${strategyTemplateId}`);
    return true;
  }
  const previousResult = history[history.length - 2];
  tuningCache.set(strategyTemplateId, previousResult.newWeights);
  log113.info(`[WeightAutoTuning] \u6743\u91CD\u5DF2\u56DE\u6EDA\u5230\u4E0A\u4E00\u7248\u672C: strategy=${strategyTemplateId}`);
  return true;
}
function getTuningHistory(strategyTemplateId) {
  if (strategyTemplateId) {
    return tuningHistory.filter((h) => h.strategyTemplateId === strategyTemplateId);
  }
  return [...tuningHistory];
}
function getDefaultTuningConfig() {
  return { ...DEFAULT_TUNING_CONFIG };
}
var log113, DEFAULT_TUNING_CONFIG, DIMENSION_NAMES, tuningCache, tuningHistory;
var init_weightAutoTuningService = __esm({
  "server/algorithm/weightAutoTuningService.ts"() {
    "use strict";
    init_logger();
    log113 = createModuleLogger("WeightAutoTuning");
    DEFAULT_TUNING_CONFIG = {
      learningRate: 0.02,
      // 2%学习率
      maxAdjustmentPercent: 0.05,
      // 单次最大调整5%
      minWeightFloor: 0.02,
      // 最小权重2%
      evaluationWindowDays: 14,
      // 14天评估窗口
      minSampleSize: 50,
      // 最少50个样本
      enabled: true
    };
    DIMENSION_NAMES = [
      "acos_progress",
      "spend_efficiency",
      "conversion_trend",
      "impression_health",
      "click_quality",
      "data_confidence",
      "profit_efficiency"
      // v271新增
    ];
    tuningCache = /* @__PURE__ */ new Map();
    tuningHistory = [];
    __name(getEffectiveWeights, "getEffectiveWeights");
    __name(calculateDimensionCorrelations, "calculateDimensionCorrelations");
    __name(adjustWeights, "adjustWeights");
    __name(applyWeightTuning, "applyWeightTuning");
    __name(rollbackWeights, "rollbackWeights");
    __name(getTuningHistory, "getTuningHistory");
    __name(getDefaultTuningConfig, "getDefaultTuningConfig");
  }
});

