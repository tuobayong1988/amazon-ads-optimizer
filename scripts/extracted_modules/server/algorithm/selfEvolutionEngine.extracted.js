// Extracted from production dist/index.js
// Original module: server/algorithm/selfEvolutionEngine.ts
// Lines: 522

async function evaluateRecentOptimizations(performanceGroupId2, lookbackDays = 14) {
  const db = await getDb();
  if (!db) return [];
  try {
    const cutoffDate = /* @__PURE__ */ new Date();
    cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);
    const cutoffStr = cutoffDate.toISOString().slice(0, 19).replace("T", " ");
    const minEvalDate = /* @__PURE__ */ new Date();
    minEvalDate.setDate(minEvalDate.getDate() - 7);
    const minEvalStr = minEvalDate.toISOString().slice(0, 19).replace("T", " ");
    const logs = await db.select().from(optimizationLogs).where(and(
      eq(optimizationLogs.performanceGroupId, performanceGroupId2),
      eq(optimizationLogs.logCategory, "bid_adjustment"),
      gte(optimizationLogs.createdAt, cutoffStr),
      lte(optimizationLogs.createdAt, minEvalStr),
      // 只评估未被回滚的记录
      sql`${optimizationLogs.apiSyncStatus} != 'rolled_back' OR ${optimizationLogs.apiSyncStatus} IS NULL`
    )).orderBy(desc(optimizationLogs.createdAt)).limit(100);
    if (logs.length === 0) return [];
    const groupCampaigns = await db.select({ id: campaigns.id }).from(campaigns).where(eq(campaigns.performanceGroupId, performanceGroupId2));
    if (groupCampaigns.length === 0) return [];
    const campaignIds = groupCampaigns.map((c) => c.id);
    const assessments = [];
    for (const optLog of logs) {
      try {
        const logDate = new Date(optLog.createdAt);
        const preStartDate = new Date(logDate);
        preStartDate.setDate(preStartDate.getDate() - 7);
        const preData = await getTimeWeightedCampaignMetrics(
          db,
          campaignIds,
          preStartDate.toISOString().split("T")[0],
          logDate.toISOString().split("T")[0]
        );
        const postEndDate = new Date(logDate);
        postEndDate.setDate(postEndDate.getDate() + 7);
        const now = /* @__PURE__ */ new Date();
        const actualEndDate = postEndDate > now ? now : postEndDate;
        const postData = await getTimeWeightedCampaignMetrics(
          db,
          campaignIds,
          logDate.toISOString().split("T")[0],
          actualEndDate.toISOString().split("T")[0]
        );
        if (!preData || !postData) continue;
        const effectScore = calculateEffectScore(preData, postData, log95);
        const effectCategory = categorizeEffect(effectScore);
        const needsCorrection = effectScore < -20;
        let correctionType;
        let correctionReason;
        if (effectScore < -50) {
          correctionType = "rollback";
          correctionReason = `\u4F18\u5316\u6548\u679C\u4E25\u91CD\u8D1F\u9762\uFF08\u6548\u679C\u5206${effectScore}\uFF09\uFF0C\u5EFA\u8BAE\u5B8C\u5168\u56DE\u6EDA`;
        } else if (effectScore < -20) {
          correctionType = "partial_rollback";
          correctionReason = `\u4F18\u5316\u6548\u679C\u8D1F\u9762\uFF08\u6548\u679C\u5206${effectScore}\uFF09\uFF0C\u5EFA\u8BAE\u90E8\u5206\u56DE\u6EDA`;
        }
        let entityId = "";
        let entityType = "keyword";
        try {
          const detail = JSON.parse(optLog.actionDetail || "{}");
          entityId = detail.keywordId?.toString() || detail.targetId?.toString() || "";
          entityType = detail.targetType || "keyword";
        } catch {
        }
        assessments.push({
          logId: optLog.id,
          actionType: optLog.actionType || "bid_adjustment",
          performanceGroupId: performanceGroupId2,
          entityId,
          entityType,
          preWeightedAcos: preData.acos,
          preWeightedRoas: preData.roas,
          preWeightedDailySpend: preData.dailySpend,
          preWeightedDailyOrders: preData.dailyOrders,
          postWeightedAcos: postData.acos,
          postWeightedRoas: postData.roas,
          postWeightedDailySpend: postData.dailySpend,
          postWeightedDailyOrders: postData.dailyOrders,
          effectScore,
          effectCategory,
          needsCorrection,
          correctionType,
          correctionReason
        });
      } catch (logErr) {
        log95.warn(`[selfEvolution] Error evaluating optimization log:`, logErr);
      }
    }
    return assessments;
  } catch (error48) {
    log95.warn(`[selfEvolution] evaluateRecentOptimizations error:`, error48);
    return [];
  }
}
async function getTimeWeightedCampaignMetrics(db, campaignIds, startDate, endDate) {
  if (campaignIds.length === 0) return null;
  const dailyData = await db.select({
    date: dailyPerformance.date,
    spend: sql`COALESCE(SUM(${dailyPerformance.spend}), 0)`,
    sales: sql`COALESCE(SUM(${dailyPerformance.sales}), 0)`,
    orders: sql`COALESCE(SUM(${dailyPerformance.orders}), 0)`,
    clicks: sql`COALESCE(SUM(${dailyPerformance.clicks}), 0)`
  }).from(dailyPerformance).where(and(
    inArray(dailyPerformance.campaignId, campaignIds.map(String)),
    sql`${dailyPerformance.date} >= ${startDate}`,
    sql`${dailyPerformance.date} < ${endDate}`
  )).groupBy(dailyPerformance.date);
  if (dailyData.length === 0) return null;
  const now = /* @__PURE__ */ new Date();
  let weightedSpend = 0, weightedSales = 0, weightedOrders = 0;
  let totalWeight = 0;
  const dataPoints = dailyData.length;
  const decayRate = dataPoints < 7 ? 0.02 : dataPoints < 14 ? 0.04 : 0.06;
  const spendValues = dailyData.map((d) => Number(d.spend) || 0);
  const avgSpendRaw = spendValues.length > 0 ? spendValues.reduce((a, b) => a + b, 0) / spendValues.length : 0;
  const variance = spendValues.length > 1 ? spendValues.reduce((sum2, v) => sum2 + Math.pow(v - avgSpendRaw, 2), 0) / spendValues.length : 0;
  const cv = avgSpendRaw > 0 ? Math.sqrt(variance) / avgSpendRaw : 0;
  const volatilityMultiplier = Math.min(1.5, 1 + cv * 0.5);
  for (const day2 of dailyData) {
    const dayDate = new Date(day2.date);
    const daysAgo = Math.floor((now.getTime() - dayDate.getTime()) / (1e3 * 60 * 60 * 24));
    const weight = Math.max(0.1, Math.exp(-decayRate * volatilityMultiplier * daysAgo));
    weightedSpend += (Number(day2.spend) || 0) * weight;
    weightedSales += (Number(day2.sales) || 0) * weight;
    weightedOrders += (Number(day2.orders) || 0) * weight;
    totalWeight += weight;
  }
  if (totalWeight === 0) return null;
  const avgSpend = weightedSpend / totalWeight;
  const avgSales = weightedSales / totalWeight;
  const avgOrders = weightedOrders / totalWeight;
  return {
    acos: avgSales > 0 ? avgSpend / avgSales * 100 : 0,
    roas: avgSpend > 0 ? avgSales / avgSpend : 0,
    dailySpend: avgSpend,
    dailyOrders: avgOrders,
    days: dailyData.length
  };
}
function calculateEffectScore(pre, post, logEntry) {
  let score = 0;
  if (pre.roas > 0) {
    const roasChange = (post.roas - pre.roas) / pre.roas;
    score += Math.max(-35, Math.min(35, roasChange * 100));
  }
  if (pre.acos > 0) {
    const acosChange = (pre.acos - post.acos) / pre.acos;
    score += Math.max(-25, Math.min(25, acosChange * 100));
  }
  if (pre.dailyOrders > 0) {
    const ordersChange = (post.dailyOrders - pre.dailyOrders) / pre.dailyOrders;
    if (ordersChange < 0) {
      score += Math.max(-25, ordersChange * 150);
    } else {
      score += Math.min(25, ordersChange * 80);
    }
  }
  if (pre.dailySpend > 0 && post.dailyOrders > 0) {
    const preCostPerOrder = pre.dailySpend / Math.max(0.1, pre.dailyOrders);
    const postCostPerOrder = post.dailySpend / Math.max(0.1, post.dailyOrders);
    const efficiencyChange = (preCostPerOrder - postCostPerOrder) / preCostPerOrder;
    score += Math.max(-10, Math.min(10, efficiencyChange * 50));
  }
  try {
    if (logEntry?.actionDetail) {
      const detail = typeof logEntry.actionDetail === "string" ? JSON.parse(logEntry.actionDetail) : logEntry.actionDetail;
      if (detail.causalAdjustment && detail.causalAdjustment.confidence > 0.5) {
        const causalSignal = detail.causalAdjustment.incrementalProfit > 0 ? 5 : -5;
        score += causalSignal;
      }
    }
  } catch {
  }
  return Math.round(Math.max(-100, Math.min(100, score)));
}
function categorizeEffect(score) {
  if (score >= 30) return "excellent";
  if (score >= 10) return "positive";
  if (score >= -10) return "neutral";
  if (score >= -30) return "negative";
  return "harmful";
}
async function updateLearningFromAssessments(performanceGroupId2, assessments, strategyTemplateId) {
  if (assessments.length === 0) {
    return { keywordsUpdated: 0, strategyUpdated: false, adaptiveParams: null };
  }
  const keywordMemories = /* @__PURE__ */ new Map();
  for (const assessment of assessments) {
    if (!assessment.entityId) continue;
    const key = `${assessment.entityType}:${assessment.entityId}`;
    let memory = keywordMemories.get(key);
    if (!memory) {
      memory = {
        keywordId: parseInt(assessment.entityId) || 0,
        campaignId: 0,
        optimalBidLow: 0,
        optimalBidHigh: 0,
        totalOptimizations: 0,
        positiveOptimizations: 0,
        negativeOptimizations: 0,
        avgEffectScore: 0,
        bidSensitivity: "medium",
        optimalAcosRange: { low: 0, high: 100 },
        lastOptimizationDate: "",
        lastBid: 0,
        lastEffectScore: 0,
        confidence: "low"
      };
    }
    memory.totalOptimizations++;
    if (assessment.effectScore > 10) memory.positiveOptimizations++;
    if (assessment.effectScore < -10) memory.negativeOptimizations++;
    memory.avgEffectScore = (memory.avgEffectScore * (memory.totalOptimizations - 1) + assessment.effectScore) / memory.totalOptimizations;
    memory.lastEffectScore = assessment.effectScore;
    if (memory.totalOptimizations >= 10) memory.confidence = "high";
    else if (memory.totalOptimizations >= 5) memory.confidence = "medium";
    else memory.confidence = "low";
    keywordMemories.set(key, memory);
  }
  let adaptiveParams = null;
  if (strategyTemplateId) {
    const positiveCount = assessments.filter((a) => a.effectScore > 10).length;
    const negativeCount = assessments.filter((a) => a.effectScore < -10).length;
    const totalCount = assessments.length;
    const successRate = totalCount > 0 ? positiveCount / totalCount : 0.5;
    const avgScore = assessments.reduce((sum2, a) => sum2 + a.effectScore, 0) / totalCount;
    const baseMaxIncrease = 0.2;
    const baseMaxDecrease = 0.15;
    let adaptiveMaxBidIncrease;
    let adaptiveMaxBidDecrease;
    if (successRate >= 0.7) {
      adaptiveMaxBidIncrease = baseMaxIncrease * 1.2;
      adaptiveMaxBidDecrease = baseMaxDecrease * 1.2;
    } else if (successRate >= 0.5) {
      adaptiveMaxBidIncrease = baseMaxIncrease;
      adaptiveMaxBidDecrease = baseMaxDecrease;
    } else if (successRate >= 0.3) {
      adaptiveMaxBidIncrease = baseMaxIncrease * 0.7;
      adaptiveMaxBidDecrease = baseMaxDecrease * 0.7;
    } else {
      adaptiveMaxBidIncrease = baseMaxIncrease * 0.5;
      adaptiveMaxBidDecrease = baseMaxDecrease * 0.5;
    }
    adaptiveParams = {
      strategyTemplateId,
      adaptiveMaxBidIncrease: Math.round(adaptiveMaxBidIncrease * 1e3) / 1e3,
      adaptiveMaxBidDecrease: Math.round(adaptiveMaxBidDecrease * 1e3) / 1e3,
      adaptiveMaxBudgetChange: successRate >= 0.5 ? 0.25 : 0.15,
      lastUpdated: (/* @__PURE__ */ new Date()).toISOString()
    };
  }
  return {
    keywordsUpdated: keywordMemories.size,
    strategyUpdated: adaptiveParams !== null,
    adaptiveParams
  };
}
async function generateAutoCorrections(performanceGroupId2, assessments) {
  const corrections = [];
  const db = await getDb();
  if (!db) return corrections;
  for (const assessment of assessments) {
    if (!assessment.needsCorrection) continue;
    try {
      const [log216] = await db.select().from(optimizationLogs).where(eq(optimizationLogs.id, assessment.logId)).limit(1);
      if (!log216) continue;
      let originalValue = 0;
      let currentValue = 0;
      let correctedValue = 0;
      let correctionType = "rollback_bid";
      try {
        const detail = JSON.parse(log216.actionDetail || "{}");
        if (log216.actionType === "bid_adjustment") {
          originalValue = parseFloat(detail.previousBid || detail.oldBid || "0");
          currentValue = parseFloat(detail.newBid || "0");
          correctionType = "rollback_bid";
          if (assessment.correctionType === "rollback") {
            correctedValue = originalValue;
          } else {
            correctedValue = Math.round((originalValue + currentValue) / 2 * 100) / 100;
          }
        } else if (log216.actionType === "budget_adjustment") {
          originalValue = parseFloat(detail.previousBudget || detail.oldBudget || "0");
          currentValue = parseFloat(detail.newBudget || "0");
          correctionType = "rollback_budget";
          correctedValue = assessment.correctionType === "rollback" ? originalValue : Math.round((originalValue + currentValue) / 2 * 100) / 100;
        } else if (log216.actionType === "placement_adjustment") {
          originalValue = parseFloat(detail.previousMultiplier || "0");
          currentValue = parseFloat(detail.newMultiplier || "0");
          correctionType = "rollback_placement";
          correctedValue = assessment.correctionType === "rollback" ? originalValue : Math.round((originalValue + currentValue) / 2);
        }
      } catch {
      }
      if (originalValue === 0 && currentValue === 0) continue;
      let causalOverride = false;
      try {
        const causalDb = await getDb();
        if (causalDb && assessment.entityId) {
          const { causalInferenceResults: causalInferenceResults2 } = await Promise.resolve().then(() => (init_schema2(), schema_exports));
          const { eq: eqOp, gte: gteOp, and: andOp } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
          const recentDate = /* @__PURE__ */ new Date();
          recentDate.setDate(recentDate.getDate() - 14);
          const [causalResult] = await causalDb.select({
            incrementalProfit: causalInferenceResults2.incrementalProfit,
            upliftScore: causalInferenceResults2.upliftScore
          }).from(causalInferenceResults2).where(andOp(
            eqOp(causalInferenceResults2.keywordId, parseInt(assessment.entityId)),
            gteOp(causalInferenceResults2.analysisDate, recentDate.toISOString().split("T")[0])
          )).limit(1);
          if (causalResult && Number(causalResult.incrementalProfit) > 0 && Number(causalResult.upliftScore) > 0.3) {
            if (correctionType === "rollback_bid") {
              correctedValue = Math.round((originalValue * 0.3 + currentValue * 0.7) * 100) / 100;
              causalOverride = true;
            }
          }
        }
      } catch {
      }
      corrections.push({
        id: `correction_${assessment.logId}_${Date.now()}`,
        logId: assessment.logId,
        performanceGroupId: performanceGroupId2,
        entityType: assessment.entityType,
        entityId: assessment.entityId,
        correctionType,
        originalValue,
        currentValue,
        correctedValue,
        reason: causalOverride ? `\u6548\u679C\u8BC4\u5206${assessment.effectScore}\uFF0C\u4F46\u56E0\u679C\u63A8\u65AD\u663E\u793A\u6B63\u5411\u589E\u91CF\u5229\u6DA6\uFF0C\u964D\u7EA7\u4E3A\u90E8\u5206\u56DE\u6EDA` : assessment.correctionReason || `\u6548\u679C\u8BC4\u5206${assessment.effectScore}\uFF0C\u9700\u8981\u7EA0\u6B63`,
        effectScore: assessment.effectScore,
        status: "pending",
        createdAt: (/* @__PURE__ */ new Date()).toISOString()
      });
    } catch (err) {
      log95.warn(`[selfEvolution] Error generating correction for log ${assessment.logId}:`, err);
    }
  }
  return corrections;
}
async function executeAutoCorrections(corrections, userId, accountId) {
  const result = { executed: 0, skipped: 0, errors: 0, details: [] };
  const db = await getDb();
  if (!db) return result;
  for (const correction of corrections) {
    try {
      if (correction.correctedValue <= 0) {
        correction.status = "skipped";
        result.skipped++;
        result.details.push(`\u8DF3\u8FC7\u7EA0\u6B63 ${correction.id}\uFF1A\u7EA0\u6B63\u503C\u4E0D\u5408\u7406 (${correction.correctedValue})`);
        continue;
      }
      const [originalLog] = await db.select().from(optimizationLogs).where(eq(optimizationLogs.id, correction.logId)).limit(1);
      if (!originalLog || originalLog.apiSyncStatus === "rolled_back") {
        correction.status = "skipped";
        result.skipped++;
        result.details.push(`\u8DF3\u8FC7\u7EA0\u6B63 ${correction.id}\uFF1A\u539F\u59CB\u8BB0\u5F55\u5DF2\u88AB\u56DE\u6EDA`);
        continue;
      }
      await db.insert(optimizationLogs).values({
        userId,
        accountId,
        performanceGroupId: correction.performanceGroupId,
        actionType: correction.correctionType.replace("rollback_", "") + "_adjustment",
        actionDetail: JSON.stringify({
          correctionOf: correction.logId,
          previousValue: correction.currentValue,
          correctedValue: correction.correctedValue,
          originalValue: correction.originalValue,
          effectScore: correction.effectScore,
          reason: correction.reason,
          autoCorrection: true
        }),
        reason: `[\u81EA\u52A8\u7EA0\u9519] ${correction.reason}`,
        apiSyncStatus: "pending",
        createdAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ")
      });
      await db.update(optimizationLogs).set({ apiSyncStatus: "corrected" }).where(eq(optimizationLogs.id, correction.logId));
      correction.status = "executed";
      correction.executedAt = (/* @__PURE__ */ new Date()).toISOString();
      result.executed++;
      result.details.push(
        `\u6267\u884C\u7EA0\u6B63 ${correction.id}\uFF1A${correction.correctionType} ${correction.currentValue} \u2192 ${correction.correctedValue} (\u539F\u59CB: ${correction.originalValue})`
      );
    } catch (err) {
      correction.status = "skipped";
      result.errors++;
      result.details.push(`\u7EA0\u6B63\u5931\u8D25 ${correction.id}: ${err}`);
    }
  }
  return result;
}
async function runEvolutionCycle(performanceGroupId2, userId, accountId, strategyTemplateId) {
  const cycleId = `evo_${performanceGroupId2}_${Date.now()}`;
  const startDate = (/* @__PURE__ */ new Date()).toISOString();
  log95.info(`[selfEvolution] Starting evolution cycle ${cycleId} for group ${performanceGroupId2}`);
  const assessments = await evaluateRecentOptimizations(performanceGroupId2);
  const positiveActions = assessments.filter((a) => a.effectScore > 10).length;
  const neutralActions = assessments.filter((a) => a.effectScore >= -10 && a.effectScore <= 10).length;
  const negativeActions = assessments.filter((a) => a.effectScore < -10).length;
  log95.info(`[selfEvolution] Evaluated ${assessments.length} actions: ${positiveActions} positive, ${neutralActions} neutral, ${negativeActions} negative`);
  const learningResult = await updateLearningFromAssessments(
    performanceGroupId2,
    assessments,
    strategyTemplateId
  );
  log95.info(`[selfEvolution] Learning updated: ${learningResult.keywordsUpdated} keywords, strategy: ${learningResult.strategyUpdated}`);
  const corrections = await generateAutoCorrections(performanceGroupId2, assessments);
  let correctionsExecuted = 0;
  if (corrections.length > 0) {
    log95.info(`[selfEvolution] ${corrections.length} corrections identified`);
    const severeCorrections = corrections.filter((c) => c.effectScore < -30);
    if (severeCorrections.length > 0) {
      const execResult = await executeAutoCorrections(severeCorrections, userId, accountId);
      correctionsExecuted = execResult.executed;
      log95.info(`[selfEvolution] Auto-corrections: ${execResult.executed} executed, ${execResult.skipped} skipped`);
    }
  }
  const avgEffectScore = assessments.length > 0 ? assessments.reduce((sum2, a) => sum2 + a.effectScore, 0) / assessments.length : 0;
  let improvementTrend;
  if (avgEffectScore > 10) improvementTrend = "improving";
  else if (avgEffectScore > -10) improvementTrend = "stable";
  else improvementTrend = "declining";
  const report = {
    cycleId,
    startDate,
    endDate: (/* @__PURE__ */ new Date()).toISOString(),
    totalActionsEvaluated: assessments.length,
    positiveActions,
    neutralActions,
    negativeActions,
    correctionsIdentified: corrections.length,
    correctionsExecuted,
    keywordsLearningUpdated: learningResult.keywordsUpdated,
    strategyParamsUpdated: learningResult.strategyUpdated ? 1 : 0,
    avgEffectScore: Math.round(avgEffectScore),
    improvementTrend
  };
  log95.info(`[selfEvolution] Evolution cycle ${cycleId} completed: avg score ${report.avgEffectScore}, trend: ${report.improvementTrend}`);
  return report;
}
async function getAdaptiveOptimizationParams(performanceGroupId2, strategyTemplateId) {
  const db = await getDb();
  const defaultParams = {
    maxBidIncrease: 0.2,
    maxBidDecrease: 0.15,
    maxBudgetChange: 0.25,
    confidenceMultiplier: 1,
    recentSuccessRate: 0.5
  };
  if (!db) return defaultParams;
  try {
    const thirtyDaysAgo = /* @__PURE__ */ new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const cutoffStr = thirtyDaysAgo.toISOString().slice(0, 19).replace("T", " ");
    const recentLogs = await db.select({
      count: sql`COUNT(*)`,
      avgEffect: sql`AVG(CASE WHEN ${optimizationLogs.apiSyncStatus} = 'corrected' THEN -30 WHEN ${optimizationLogs.apiSyncStatus} = 'rolled_back' THEN -50 ELSE 10 END)`,
      rolledBackCount: sql`SUM(CASE WHEN ${optimizationLogs.apiSyncStatus} IN ('corrected', 'rolled_back') THEN 1 ELSE 0 END)`
    }).from(optimizationLogs).where(and(
      eq(optimizationLogs.performanceGroupId, performanceGroupId2),
      eq(optimizationLogs.logCategory, "bid_adjustment"),
      gte(optimizationLogs.createdAt, cutoffStr)
    ));
    const totalCount = Number(recentLogs[0]?.count) || 0;
    const rolledBackCount = Number(recentLogs[0]?.rolledBackCount) || 0;
    if (totalCount < 5) return defaultParams;
    const successRate = 1 - rolledBackCount / totalCount;
    let maxBidIncrease;
    let maxBidDecrease;
    let confidenceMultiplier;
    if (successRate >= 0.8) {
      maxBidIncrease = 0.25;
      maxBidDecrease = 0.2;
      confidenceMultiplier = 1.2;
    } else if (successRate >= 0.6) {
      maxBidIncrease = 0.2;
      maxBidDecrease = 0.15;
      confidenceMultiplier = 1;
    } else if (successRate >= 0.4) {
      maxBidIncrease = 0.15;
      maxBidDecrease = 0.1;
      confidenceMultiplier = 0.8;
    } else {
      maxBidIncrease = 0.1;
      maxBidDecrease = 0.08;
      confidenceMultiplier = 0.6;
    }
    return {
      maxBidIncrease,
      maxBidDecrease,
      maxBudgetChange: successRate >= 0.5 ? 0.25 : 0.15,
      confidenceMultiplier,
      recentSuccessRate: Math.round(successRate * 100) / 100
    };
  } catch (error48) {
    log95.warn(`[selfEvolution] getAdaptiveOptimizationParams error:`, error48);
    return defaultParams;
  }
}
var log95;
var init_selfEvolutionEngine = __esm({
  "server/algorithm/selfEvolutionEngine.ts"() {
    "use strict";
    init_logger();
    init_db2();
    init_schema2();
    init_drizzle_orm();
    log95 = createModuleLogger("SelfEvolution");
    __name(evaluateRecentOptimizations, "evaluateRecentOptimizations");
    __name(getTimeWeightedCampaignMetrics, "getTimeWeightedCampaignMetrics");
    __name(calculateEffectScore, "calculateEffectScore");
    __name(categorizeEffect, "categorizeEffect");
    __name(updateLearningFromAssessments, "updateLearningFromAssessments");
    __name(generateAutoCorrections, "generateAutoCorrections");
    __name(executeAutoCorrections, "executeAutoCorrections");
    __name(runEvolutionCycle, "runEvolutionCycle");
    __name(getAdaptiveOptimizationParams, "getAdaptiveOptimizationParams");
  }
});

