// Extracted from production dist/index.js
// Original module: server/analytics/abTestService.ts
// Lines: 432

var abTestService_exports = {};
__export(abTestService_exports, {
  analyzeABTestResults: () => analyzeABTestResults,
  assignCampaignsToTest: () => assignCampaignsToTest,
  calculateSampleSize: () => calculateSampleSize,
  calculateStatisticalSignificanceExported: () => calculateStatisticalSignificanceExported,
  completeABTest: () => completeABTest,
  createABTest: () => createABTest,
  deleteABTest: () => deleteABTest,
  determineWinner: () => determineWinner,
  getABTestById: () => getABTestById,
  getABTests: () => getABTests,
  normalCDF: () => normalCDF,
  pauseABTest: () => pauseABTest,
  recordDailyMetrics: () => recordDailyMetrics,
  splitCampaignsIntoGroups: () => splitCampaignsIntoGroups,
  startABTest: () => startABTest
});
async function createABTest(config2, userId) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const testData = {
    accountId: config2.accountId,
    performanceGroupId: config2.performanceGroupId,
    testName: config2.testName,
    testDescription: config2.testDescription,
    testType: config2.testType,
    targetMetric: config2.targetMetric,
    minSampleSize: config2.minSampleSize || 100,
    confidenceLevel: String(config2.confidenceLevel || 0.95),
    status: "draft",
    createdBy: userId
  };
  const testResult = await db.insert(abTests).values(testData);
  const testId = testResult[0].insertId;
  const controlVariantData = {
    testId,
    variantName: "\u5BF9\u7167\u7EC4",
    variantType: "control",
    description: "\u4F7F\u7528\u5F53\u524D\u7684\u9884\u7B97\u5206\u914D\u7B56\u7565",
    configJson: JSON.stringify(config2.controlConfig),
    trafficAllocation: String(1 - (config2.trafficSplit || 0.5))
  };
  const controlResult = await db.insert(abTestVariants).values(controlVariantData);
  const controlVariantId = controlResult[0].insertId;
  const treatmentVariantData = {
    testId,
    variantName: "\u5B9E\u9A8C\u7EC4",
    variantType: "treatment",
    description: "\u4F7F\u7528\u65B0\u7684\u9884\u7B97\u5206\u914D\u7B56\u7565",
    configJson: JSON.stringify(config2.treatmentConfig),
    trafficAllocation: String(config2.trafficSplit || 0.5)
  };
  const treatmentResult = await db.insert(abTestVariants).values(treatmentVariantData);
  const treatmentVariantId = treatmentResult[0].insertId;
  return { testId, controlVariantId, treatmentVariantId };
}
async function assignCampaignsToTest(testId, campaignIds, splitMethod = "random") {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const variants = await db.select().from(abTestVariants).where(eq(abTestVariants.testId, testId));
  const controlVariant = variants.find((v) => v.variantType === "control");
  const treatmentVariant = variants.find((v) => v.variantType === "treatment");
  if (!controlVariant || !treatmentVariant) {
    throw new Error("\u6D4B\u8BD5\u53D8\u4F53\u4E0D\u5B8C\u6574");
  }
  const trafficSplit = parseFloat(treatmentVariant.trafficAllocation || "0.5");
  const controlCampaigns = [];
  const treatmentCampaigns = [];
  if (splitMethod === "random") {
    const shuffled = [...campaignIds].sort(() => Math.random() - 0.5);
    const splitIndex = Math.floor(shuffled.length * (1 - trafficSplit));
    for (let i = 0; i < shuffled.length; i++) {
      if (i < splitIndex) {
        controlCampaigns.push(shuffled[i]);
      } else {
        treatmentCampaigns.push(shuffled[i]);
      }
    }
  } else if (splitMethod === "stratified") {
    for (const campaignId of campaignIds) {
      if (campaignId % 2 === 0) {
        controlCampaigns.push(campaignId);
      } else {
        treatmentCampaigns.push(campaignId);
      }
    }
  }
  const assignments = [
    ...controlCampaigns.map((campaignId) => ({
      testId,
      variantId: controlVariant.id,
      campaignId
    })),
    ...treatmentCampaigns.map((campaignId) => ({
      testId,
      variantId: treatmentVariant.id,
      campaignId
    }))
  ];
  if (assignments.length > 0) {
    await db.insert(abTestCampaignAssignments).values(assignments);
  }
  return { controlCampaigns, treatmentCampaigns };
}
async function startABTest(testId, durationDays = 14) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const startDate = /* @__PURE__ */ new Date();
  const endDate = /* @__PURE__ */ new Date();
  endDate.setDate(endDate.getDate() + durationDays);
  await db.update(abTests).set({
    status: "running",
    startDate: startDate.toISOString().slice(0, 19).replace("T", " "),
    endDate: endDate.toISOString().slice(0, 19).replace("T", " ")
  }).where(eq(abTests.id, testId));
}
async function pauseABTest(testId) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(abTests).set({ status: "paused" }).where(eq(abTests.id, testId));
}
async function completeABTest(testId) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(abTests).set({ status: "completed" }).where(eq(abTests.id, testId));
}
async function recordDailyMetrics(testId, variantId, metrics) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const roas = metrics.spend > 0 ? metrics.sales / metrics.spend : 0;
  const acos = metrics.sales > 0 ? metrics.spend / metrics.sales : 0;
  const ctr = metrics.impressions > 0 ? metrics.clicks / metrics.impressions : 0;
  const cvr = metrics.clicks > 0 ? metrics.conversions / metrics.clicks : 0;
  const cpc = metrics.clicks > 0 ? metrics.spend / metrics.clicks : 0;
  await db.insert(abTestDailyMetrics).values({
    testId,
    variantId,
    date: (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
    impressions: metrics.impressions,
    clicks: metrics.clicks,
    spend: String(metrics.spend),
    sales: String(metrics.sales),
    orders: metrics.conversions,
    roas: String(roas),
    acos: String(acos),
    ctr: String(ctr),
    cvr: String(cvr)
  });
}
function calculateStatisticalSignificance(controlValues, treatmentValues, confidenceLevel = 0.95) {
  if (controlValues.length < 2 || treatmentValues.length < 2) {
    return { pValue: 1, isSignificant: false, confidenceInterval: [0, 0] };
  }
  const controlMean = controlValues.reduce((a, b) => a + b, 0) / controlValues.length;
  const treatmentMean = treatmentValues.reduce((a, b) => a + b, 0) / treatmentValues.length;
  const controlStd = Math.sqrt(
    // @ts-ignore
    controlValues.reduce((sum2, val) => sum2 + Math.pow(val - controlMean, 2), 0) / (controlValues.length - 1)
  );
  const treatmentStd = Math.sqrt(
    // @ts-ignore
    treatmentValues.reduce((sum2, val) => sum2 + Math.pow(val - treatmentMean, 2), 0) / (treatmentValues.length - 1)
  );
  const pooledSE = Math.sqrt(
    Math.pow(controlStd, 2) / controlValues.length + Math.pow(treatmentStd, 2) / treatmentValues.length
  );
  const tStat = pooledSE > 0 ? (treatmentMean - controlMean) / pooledSE : 0;
  const pValue = 2 * (1 - normalCDF(Math.abs(tStat)));
  const zScore = confidenceLevel === 0.95 ? 1.96 : confidenceLevel === 0.99 ? 2.576 : 1.645;
  const marginOfError = zScore * pooledSE;
  const difference = treatmentMean - controlMean;
  const confidenceInterval = [
    difference - marginOfError,
    difference + marginOfError
  ];
  return {
    pValue,
    isSignificant: pValue < 1 - confidenceLevel,
    confidenceInterval
  };
}
function normalCDF(x) {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);
  const t2 = 1 / (1 + p * x);
  const y = 1 - ((((a5 * t2 + a4) * t2 + a3) * t2 + a2) * t2 + a1) * t2 * Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}
async function analyzeABTestResults(testId) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const testResults = await db.select().from(abTests).where(eq(abTests.id, testId)).limit(1);
  if (testResults.length === 0) {
    throw new Error("\u6D4B\u8BD5\u4E0D\u5B58\u5728");
  }
  const testInfo = testResults[0];
  const variants = await db.select().from(abTestVariants).where(eq(abTestVariants.testId, testId));
  const controlVariant = variants.find((v) => v.variantType === "control");
  const treatmentVariant = variants.find((v) => v.variantType === "treatment");
  if (!controlVariant || !treatmentVariant) {
    throw new Error("\u6D4B\u8BD5\u53D8\u4F53\u4E0D\u5B8C\u6574");
  }
  const controlMetrics = await db.select().from(abTestDailyMetrics).where(and(
    eq(abTestDailyMetrics.testId, testId),
    eq(abTestDailyMetrics.variantId, controlVariant.id)
  ));
  const treatmentMetrics = await db.select().from(abTestDailyMetrics).where(and(
    eq(abTestDailyMetrics.testId, testId),
    eq(abTestDailyMetrics.variantId, treatmentVariant.id)
    // @ts-ignore
  ));
  const metricsToAnalyze = ["roas", "acos", "ctr", "cvr", "cpc"];
  const confidenceLevel = parseFloat(testInfo.confidenceLevel || "0.95");
  const analysisResults = metricsToAnalyze.map((metricName) => {
    const controlValues = controlMetrics.map((m) => parseFloat(m[metricName] || "0"));
    const treatmentValues = treatmentMetrics.map((m) => parseFloat(m[metricName] || "0"));
    const controlMean = controlValues.length > 0 ? controlValues.reduce((a, b) => a + b, 0) / controlValues.length : 0;
    const treatmentMean = treatmentValues.length > 0 ? treatmentValues.reduce((a, b) => a + b, 0) / treatmentValues.length : 0;
    const { pValue, isSignificant, confidenceInterval } = calculateStatisticalSignificance(
      controlValues,
      treatmentValues,
      confidenceLevel
    );
    const absoluteDifference = treatmentMean - controlMean;
    const relativeDifference = controlMean !== 0 ? absoluteDifference / controlMean * 100 : 0;
    let winner = "inconclusive";
    if (isSignificant) {
      if (metricName === "acos" || metricName === "cpc") {
        winner = absoluteDifference < 0 ? "treatment" : "control";
      } else {
        winner = absoluteDifference > 0 ? "treatment" : "control";
      }
    }
    return {
      metricName,
      controlValue: controlMean,
      treatmentValue: treatmentMean,
      absoluteDifference,
      relativeDifference,
      pValue,
      // @ts-ignore
      isSignificant,
      confidenceInterval,
      winner
    };
  });
  const targetMetric = testInfo.targetMetric;
  const targetResult = analysisResults.find((r) => r.metricName === targetMetric);
  const overallWinner = targetResult?.winner || "inconclusive";
  let recommendation = "";
  if (overallWinner === "treatment") {
    recommendation = `\u5B9E\u9A8C\u7EC4\u5728\u76EE\u6807\u6307\u6807(${targetMetric})\u4E0A\u8868\u73B0\u66F4\u597D\uFF0C\u5EFA\u8BAE\u91C7\u7528\u65B0\u7684\u9884\u7B97\u5206\u914D\u7B56\u7565\u3002`;
  } else if (overallWinner === "control") {
    recommendation = `\u5BF9\u7167\u7EC4\u5728\u76EE\u6807\u6307\u6807(${targetMetric})\u4E0A\u8868\u73B0\u66F4\u597D\uFF0C\u5EFA\u8BAE\u4FDD\u6301\u5F53\u524D\u7684\u9884\u7B97\u5206\u914D\u7B56\u7565\u3002`;
  } else {
    recommendation = `\u76EE\u524D\u6570\u636E\u4E0D\u8DB3\u4EE5\u5F97\u51FA\u7ED3\u8BBA\uFF0C\u5EFA\u8BAE\u7EE7\u7EED\u8FD0\u884C\u6D4B\u8BD5\u4EE5\u6536\u96C6\u66F4\u591A\u6570\u636E\u3002`;
  }
  for (const result of analysisResults) {
    await db.insert(abTestResults).values({
      testId,
      variantId: treatmentVariant.id,
      metricName: result.metricName,
      controlValue: String(result.controlValue),
      treatmentValue: String(result.treatmentValue),
      absoluteDiff: String(result.absoluteDifference),
      // @ts-ignore
      relativeDiff: String(result.relativeDifference),
      pValue: String(result.pValue),
      confidenceInterval: JSON.stringify(result.confidenceInterval),
      isSignificant: result.isSignificant ? 1 : 0
    });
  }
  return {
    // @ts-ignore
    testInfo,
    variants,
    metrics: analysisResults,
    overallWinner,
    recommendation
  };
}
async function getABTests(accountId) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(abTests).where(eq(abTests.accountId, accountId)).orderBy(desc(abTests.createdAt));
}
async function getABTestById(testId) {
  const db = await getDb();
  if (!db) return null;
  const testResults = await db.select().from(abTests).where(eq(abTests.id, testId)).limit(1);
  if (testResults.length === 0) return null;
  const variants = await db.select().from(abTestVariants).where(eq(abTestVariants.testId, testId));
  const controlVariant = variants.find((v) => v.variantType === "control");
  const treatmentVariant = variants.find((v) => v.variantType === "treatment");
  let controlCount = 0;
  let treatmentCount = 0;
  if (controlVariant) {
    const controlAssignments = await db.select().from(abTestCampaignAssignments).where(eq(abTestCampaignAssignments.variantId, controlVariant.id));
    controlCount = controlAssignments.length;
  }
  if (treatmentVariant) {
    const treatmentAssignments = await db.select().from(abTestCampaignAssignments).where(eq(abTestCampaignAssignments.variantId, treatmentVariant.id));
    treatmentCount = treatmentAssignments.length;
  }
  return {
    test: testResults[0],
    variants,
    campaignCount: { control: controlCount, treatment: treatmentCount }
  };
}
async function deleteABTest(testId) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(abTestResults).where(eq(abTestResults.testId, testId));
  await db.delete(abTestDailyMetrics).where(eq(abTestDailyMetrics.testId, testId));
  await db.delete(abTestCampaignAssignments).where(eq(abTestCampaignAssignments.testId, testId));
  await db.delete(abTestVariants).where(eq(abTestVariants.testId, testId));
  await db.delete(abTests).where(eq(abTests.id, testId));
}
function calculateSampleSize(baselineRate, mde, alpha = 0.05, power = 0.8) {
  const zAlpha = 1.96;
  const zBeta = 0.84;
  const p1 = baselineRate;
  const p2 = baselineRate * (1 + mde);
  const pBar = (p1 + p2) / 2;
  const numerator = Math.pow(zAlpha * Math.sqrt(2 * pBar * (1 - pBar)) + zBeta * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2)), 2);
  const denominator = Math.pow(p2 - p1, 2);
  return Math.ceil(numerator / denominator);
}
function calculateStatisticalSignificanceExported(controlData, treatmentData, metric) {
  let controlValue;
  let treatmentValue;
  let controlN;
  let treatmentN;
  switch (metric) {
    case "conversions":
      controlValue = controlData.conversions / controlData.clicks;
      treatmentValue = treatmentData.conversions / treatmentData.clicks;
      controlN = controlData.clicks;
      treatmentN = treatmentData.clicks;
      break;
    case "roas":
      controlValue = controlData.revenue / controlData.spend;
      treatmentValue = treatmentData.revenue / treatmentData.spend;
      controlN = controlData.impressions;
      treatmentN = treatmentData.impressions;
      break;
    default:
      controlValue = controlData.conversions / controlData.clicks;
      treatmentValue = treatmentData.conversions / treatmentData.clicks;
      controlN = controlData.clicks;
      treatmentN = treatmentData.clicks;
  }
  const pooledP = (controlValue * controlN + treatmentValue * treatmentN) / (controlN + treatmentN);
  const se = Math.sqrt(pooledP * (1 - pooledP) * (1 / controlN + 1 / treatmentN));
  const z2 = se > 0 ? (treatmentValue - controlValue) / se : 0;
  const pValue = 2 * (1 - normalCDF(Math.abs(z2)));
  const marginOfError = 1.96 * se;
  const diff = treatmentValue - controlValue;
  return {
    pValue,
    isSignificant: pValue < 0.05,
    confidenceInterval: [diff - marginOfError, diff + marginOfError]
  };
}
function splitCampaignsIntoGroups(campaigns6, trafficSplit, method = "stratified") {
  if (method === "random") {
    const shuffled = [...campaigns6].sort(() => Math.random() - 0.5);
    const splitIndex = Math.floor(campaigns6.length * (1 - trafficSplit));
    return {
      control: shuffled.slice(0, splitIndex),
      treatment: shuffled.slice(splitIndex)
    };
  } else {
    const sorted = [...campaigns6].sort((a, b) => b.spend - a.spend);
    const control = [];
    const treatment = [];
    let controlSpend = 0;
    let treatmentSpend = 0;
    for (const campaign of sorted) {
      const targetTreatmentRatio = trafficSplit;
      const currentTreatmentRatio = treatmentSpend / (controlSpend + treatmentSpend + 1e-3);
      if (currentTreatmentRatio < targetTreatmentRatio) {
        treatment.push(campaign);
        treatmentSpend += campaign.spend;
      } else {
        control.push(campaign);
        controlSpend += campaign.spend;
      }
    }
    return { control, treatment };
  }
}
function determineWinner(metrics, targetMetric) {
  const targetResult = metrics.find((m) => m.metricName === targetMetric);
  if (!targetResult || !targetResult.isSignificant) {
    return "inconclusive";
  }
  return targetResult.treatmentValue > targetResult.controlValue ? "treatment" : "control";
}
var init_abTestService = __esm({
  "server/analytics/abTestService.ts"() {
    "use strict";
    init_db2();
    init_schema2();
    init_drizzle_orm();
    __name(createABTest, "createABTest");
    __name(assignCampaignsToTest, "assignCampaignsToTest");
    __name(startABTest, "startABTest");
    __name(pauseABTest, "pauseABTest");
    __name(completeABTest, "completeABTest");
    __name(recordDailyMetrics, "recordDailyMetrics");
    __name(calculateStatisticalSignificance, "calculateStatisticalSignificance");
    __name(normalCDF, "normalCDF");
    __name(analyzeABTestResults, "analyzeABTestResults");
    __name(getABTests, "getABTests");
    __name(getABTestById, "getABTestById");
    __name(deleteABTest, "deleteABTest");
    __name(calculateSampleSize, "calculateSampleSize");
    __name(calculateStatisticalSignificanceExported, "calculateStatisticalSignificanceExported");
    __name(splitCampaignsIntoGroups, "splitCampaignsIntoGroups");
    __name(determineWinner, "determineWinner");
  }
});

