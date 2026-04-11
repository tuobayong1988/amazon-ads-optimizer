// Extracted from production dist/index.js
// Original module: server/analytics/abTestIntegration.ts
// Lines: 155

async function createAlgorithmExperiment(config2, userId) {
  log46.info(`[ABTestIntegration] \u521B\u5EFA\u7B97\u6CD5\u5B9E\u9A8C: ${config2.name}, \u7C7B\u578B: ${config2.experimentType}`);
  const result = await createABTest({
    accountId: config2.accountId,
    performanceGroupId: config2.performanceGroupId,
    testName: `[${config2.experimentType}] ${config2.name}`,
    testDescription: config2.description || `v271 \u7B97\u6CD5\u5BF9\u6BD4\u5B9E\u9A8C: ${config2.experimentType}`,
    testType: "bid_strategy",
    targetMetric: config2.targetMetric,
    durationDays: config2.durationDays || 14,
    controlConfig: config2.controlConfig,
    treatmentConfig: config2.treatmentConfig,
    trafficSplit: config2.trafficSplit || 0.5
  }, userId);
  invalidateCache(config2.accountId);
  log46.info(`[ABTestIntegration] \u5B9E\u9A8C\u521B\u5EFA\u6210\u529F: testId=${result.testId}`);
  return result;
}
async function getExperimentConfigForCampaign(accountId, campaignId) {
  const experiments = await getActiveExperiments(accountId);
  if (experiments.length === 0) return null;
  for (const exp of experiments) {
    if (exp.controlCampaignIds.includes(campaignId)) {
      return { variantType: "control", config: exp.controlConfig, testId: exp.testId };
    }
    if (exp.treatmentCampaignIds.includes(campaignId)) {
      return { variantType: "treatment", config: exp.treatmentConfig, testId: exp.testId };
    }
  }
  return null;
}
async function getActiveExperiments(accountId) {
  const now = Date.now();
  if (activeExperimentsCache.has(accountId) && now - cacheLastRefresh < CACHE_TTL) {
    return activeExperimentsCache.get(accountId) || [];
  }
  try {
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    const tests = await db.select().from(abTests).where(and(
      eq(abTests.accountId, accountId),
      eq(abTests.status, "running")
    ));
    const experiments = [];
    for (const test2 of tests) {
      const variants = await db.select().from(abTestVariants).where(eq(abTestVariants.testId, test2.id));
      const controlVariant = variants.find((v) => v.variantType === "control");
      const treatmentVariant = variants.find((v) => v.variantType === "treatment");
      if (!controlVariant || !treatmentVariant) continue;
      const assignments = await db.select().from(abTestCampaignAssignments).where(eq(abTestCampaignAssignments.testId, test2.id));
      const controlCampaignIds = assignments.filter((a) => a.variantId === controlVariant.id).map((a) => String(a.campaignId));
      const treatmentCampaignIds = assignments.filter((a) => a.variantId === treatmentVariant.id).map((a) => String(a.campaignId));
      experiments.push({
        testId: test2.id,
        experimentType: test2.testType || "bid_strategy",
        controlConfig: controlVariant.config || {},
        treatmentConfig: treatmentVariant.config || {},
        controlCampaignIds,
        treatmentCampaignIds
      });
    }
    activeExperimentsCache.set(accountId, experiments);
    cacheLastRefresh = now;
    return experiments;
  } catch (error48) {
    log46.warn(`[ABTestIntegration] \u52A0\u8F7D\u6D3B\u8DC3\u5B9E\u9A8C\u5931\u8D25:`, error48);
    return [];
  }
}
function invalidateCache(accountId) {
  activeExperimentsCache.delete(accountId);
}
async function createCascadeVsSingleExperiment(accountId, performanceGroupId2, userId) {
  const result = await createAlgorithmExperiment({
    name: "Cascade Ensemble vs Single Mode",
    description: "v271: \u5BF9\u6BD4Cascade Ensemble\u878D\u5408\u6A21\u5F0F\u4E0E\u4F20\u7EDFSingle\u6A21\u5F0F\u7684ROAS/ACoS\u8868\u73B0",
    accountId,
    performanceGroupId: performanceGroupId2,
    experimentType: "algorithm_strategy",
    controlConfig: {
      algorithmMode: "single"
    },
    treatmentConfig: {
      algorithmMode: "cascade_ensemble",
      fusionThreshold: 0.15
    },
    targetMetric: "roas",
    durationDays: 14,
    trafficSplit: 0.5
  }, userId);
  return { testId: result.testId };
}
async function createFusionThresholdExperiment(accountId, controlThreshold, treatmentThreshold, performanceGroupId2, userId) {
  const result = await createAlgorithmExperiment({
    name: `Fusion Threshold ${controlThreshold * 100}% vs ${treatmentThreshold * 100}%`,
    description: `v271: \u5BF9\u6BD4\u4E0D\u540CCascade Ensemble\u878D\u5408\u9608\u503C\u7684\u6548\u679C`,
    accountId,
    performanceGroupId: performanceGroupId2,
    experimentType: "fusion_threshold",
    controlConfig: {
      algorithmMode: "cascade_ensemble",
      fusionThreshold: controlThreshold
    },
    treatmentConfig: {
      algorithmMode: "cascade_ensemble",
      fusionThreshold: treatmentThreshold
    },
    targetMetric: "roas",
    durationDays: 14,
    trafficSplit: 0.5
  }, userId);
  return { testId: result.testId };
}
async function createExplorationRateExperiment(accountId, controlRange, treatmentRange, performanceGroupId2, userId) {
  const result = await createAlgorithmExperiment({
    name: `Exploration Rate [${controlRange.min}-${controlRange.max}] vs [${treatmentRange.min}-${treatmentRange.max}]`,
    description: `v271: \u5BF9\u6BD4\u4E0D\u540C\u63A2\u7D22\u7387\u8303\u56F4\u5BF9\u7B97\u6CD5\u5B66\u4E60\u6548\u7387\u7684\u5F71\u54CD`,
    accountId,
    performanceGroupId: performanceGroupId2,
    experimentType: "exploration_rate",
    controlConfig: {
      explorationRange: controlRange
    },
    treatmentConfig: {
      explorationRange: treatmentRange
    },
    targetMetric: "roas",
    durationDays: 21,
    trafficSplit: 0.5
  }, userId);
  return { testId: result.testId };
}
var log46, activeExperimentsCache, cacheLastRefresh, CACHE_TTL;
var init_abTestIntegration = __esm({
  "server/analytics/abTestIntegration.ts"() {
    "use strict";
    init_db2();
    init_schema2();
    init_drizzle_orm();
    init_logger();
    init_abTestService();
    log46 = createModuleLogger("ABTestIntegration");
    activeExperimentsCache = /* @__PURE__ */ new Map();
    cacheLastRefresh = 0;
    CACHE_TTL = 5 * 60 * 1e3;
    __name(createAlgorithmExperiment, "createAlgorithmExperiment");
    __name(getExperimentConfigForCampaign, "getExperimentConfigForCampaign");
    __name(getActiveExperiments, "getActiveExperiments");
    __name(invalidateCache, "invalidateCache");
    __name(createCascadeVsSingleExperiment, "createCascadeVsSingleExperiment");
    __name(createFusionThresholdExperiment, "createFusionThresholdExperiment");
    __name(createExplorationRateExperiment, "createExplorationRateExperiment");
  }
});

