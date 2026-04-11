// Extracted from production dist/index.js
// Original module: server/automation/correctionService.ts
// Lines: 235

function analyzeOverDecrease(metricsAtAdjustment, metricsAfterAttribution, originalBid, adjustedBid) {
  if (adjustedBid >= originalBid) {
    return { wasOverDecreased: false, confidenceScore: 0, explanation: "\u51FA\u4EF7\u672A\u964D\u4F4E" };
  }
  const acosImproved = metricsAfterAttribution.acos < metricsAtAdjustment.acos;
  const roasImproved = metricsAfterAttribution.roas > metricsAtAdjustment.roas;
  const cvrImproved = metricsAfterAttribution.cvr > metricsAtAdjustment.cvr;
  const acosChange = metricsAtAdjustment.acos > 0 ? (metricsAtAdjustment.acos - metricsAfterAttribution.acos) / metricsAtAdjustment.acos * 100 : 0;
  const roasChange = metricsAtAdjustment.roas > 0 ? (metricsAfterAttribution.roas - metricsAtAdjustment.roas) / metricsAtAdjustment.roas * 100 : 0;
  if (acosImproved && acosChange > CORRECTION_THRESHOLD_PERCENT) {
    const confidenceScore = Math.min(1, acosChange / 100);
    return {
      wasOverDecreased: true,
      confidenceScore,
      explanation: `\u5F52\u56E0\u7A97\u53E3\u540EACoS\u6539\u5584${acosChange.toFixed(1)}%\uFF0C\u8868\u660E\u964D\u4EF7\u53EF\u80FD\u8FC7\u65E9`
    };
  }
  if (roasImproved && roasChange > CORRECTION_THRESHOLD_PERCENT) {
    const confidenceScore = Math.min(1, roasChange / 100);
    return {
      wasOverDecreased: true,
      confidenceScore,
      explanation: `\u5F52\u56E0\u7A97\u53E3\u540EROAS\u6539\u5584${roasChange.toFixed(1)}%\uFF0C\u8868\u660E\u964D\u4EF7\u53EF\u80FD\u8FC7\u65E9`
    };
  }
  return { wasOverDecreased: false, confidenceScore: 0, explanation: "\u8C03\u4EF7\u51B3\u7B56\u6B63\u786E" };
}
function analyzeOverIncrease(metricsAtAdjustment, metricsAfterAttribution, originalBid, adjustedBid) {
  if (adjustedBid <= originalBid) {
    return { wasOverIncreased: false, confidenceScore: 0, explanation: "\u51FA\u4EF7\u672A\u63D0\u9AD8" };
  }
  const acosWorsened = metricsAfterAttribution.acos > metricsAtAdjustment.acos;
  const roasWorsened = metricsAfterAttribution.roas < metricsAtAdjustment.roas;
  const acosChange = metricsAtAdjustment.acos > 0 ? (metricsAfterAttribution.acos - metricsAtAdjustment.acos) / metricsAtAdjustment.acos * 100 : 0;
  const roasChange = metricsAtAdjustment.roas > 0 ? (metricsAtAdjustment.roas - metricsAfterAttribution.roas) / metricsAtAdjustment.roas * 100 : 0;
  if (acosWorsened && acosChange > CORRECTION_THRESHOLD_PERCENT) {
    const confidenceScore = Math.min(1, acosChange / 100);
    return {
      wasOverIncreased: true,
      confidenceScore,
      explanation: `\u5F52\u56E0\u7A97\u53E3\u540EACoS\u6076\u5316${acosChange.toFixed(1)}%\uFF0C\u8868\u660E\u52A0\u4EF7\u53EF\u80FD\u8FC7\u5EA6`
    };
  }
  if (roasWorsened && roasChange > CORRECTION_THRESHOLD_PERCENT) {
    const confidenceScore = Math.min(1, roasChange / 100);
    return {
      wasOverIncreased: true,
      confidenceScore,
      explanation: `\u5F52\u56E0\u7A97\u53E3\u540EROAS\u4E0B\u964D${roasChange.toFixed(1)}%\uFF0C\u8868\u660E\u52A0\u4EF7\u53EF\u80FD\u8FC7\u5EA6`
    };
  }
  return { wasOverIncreased: false, confidenceScore: 0, explanation: "\u8C03\u4EF7\u51B3\u7B56\u6B63\u786E" };
}
function calculateSuggestedBid(originalBid, adjustedBid, correctionType, confidenceScore) {
  if (correctionType === "correct") {
    return adjustedBid;
  }
  const bidDiff = Math.abs(adjustedBid - originalBid);
  const correctionAmount = bidDiff * confidenceScore * 0.5;
  if (correctionType === "over_decreased") {
    return Math.min(originalBid, adjustedBid + correctionAmount);
  } else {
    return Math.max(originalBid, adjustedBid - correctionAmount);
  }
}
function calculateImpact(metricsAtAdjustment, metricsAfterAttribution, correctionType, daysSinceAdjustment) {
  if (correctionType === "correct") {
    return { estimatedLostRevenue: 0, estimatedWastedSpend: 0, potentialRecovery: 0 };
  }
  const dailySpend = metricsAfterAttribution.spend / Math.max(1, daysSinceAdjustment);
  const dailySales = metricsAfterAttribution.sales / Math.max(1, daysSinceAdjustment);
  if (correctionType === "over_decreased") {
    const visibilityLoss = 0.3;
    const estimatedLostRevenue = dailySales * visibilityLoss * daysSinceAdjustment;
    return {
      estimatedLostRevenue,
      estimatedWastedSpend: 0,
      potentialRecovery: estimatedLostRevenue * 0.5
      // Can recover 50% with correction
    };
  } else {
    const wasteRatio = 0.2;
    const estimatedWastedSpend = dailySpend * wasteRatio * daysSinceAdjustment;
    return {
      estimatedLostRevenue: 0,
      estimatedWastedSpend,
      potentialRecovery: estimatedWastedSpend * 0.7
      // Can save 70% with correction
    };
  }
}
function analyzeBidAdjustment(record2, metricsAfterAttribution) {
  const adjustmentDate = typeof record2.adjustmentDate === "string" ? new Date(record2.adjustmentDate) : record2.adjustmentDate;
  const daysSinceAdjustment = Math.floor(
    (Date.now() - adjustmentDate.getTime()) / (1e3 * 60 * 60 * 24)
  );
  const overDecreaseAnalysis = analyzeOverDecrease(
    record2.metricsAtAdjustment,
    metricsAfterAttribution,
    record2.originalBid,
    record2.adjustedBid
  );
  const overIncreaseAnalysis = analyzeOverIncrease(
    record2.metricsAtAdjustment,
    metricsAfterAttribution,
    record2.originalBid,
    record2.adjustedBid
  );
  let correctionType = "correct";
  let confidenceScore = 0;
  let explanation = "\u8C03\u4EF7\u51B3\u7B56\u6B63\u786E\uFF0C\u65E0\u9700\u7EA0\u6B63";
  if (overDecreaseAnalysis.wasOverDecreased && overDecreaseAnalysis.confidenceScore > overIncreaseAnalysis.confidenceScore) {
    correctionType = "over_decreased";
    confidenceScore = overDecreaseAnalysis.confidenceScore;
    explanation = overDecreaseAnalysis.explanation;
  } else if (overIncreaseAnalysis.wasOverIncreased) {
    correctionType = "over_increased";
    confidenceScore = overIncreaseAnalysis.confidenceScore;
    explanation = overIncreaseAnalysis.explanation;
  }
  const suggestedBid = calculateSuggestedBid(
    record2.originalBid,
    record2.adjustedBid,
    correctionType,
    confidenceScore
  );
  const impactAnalysis = calculateImpact(
    record2.metricsAtAdjustment,
    metricsAfterAttribution,
    correctionType,
    daysSinceAdjustment
  );
  return {
    record: record2,
    metricsAfterAttribution,
    wasIncorrect: correctionType !== "correct",
    correctionType,
    suggestedBid,
    confidenceScore,
    impactAnalysis,
    explanation
  };
}
function generateRecommendations(corrections) {
  const recommendations = [];
  const overDecreasedCount = corrections.filter((c) => c.correctionType === "over_decreased").length;
  const overIncreasedCount = corrections.filter((c) => c.correctionType === "over_increased").length;
  const totalIncorrect = overDecreasedCount + overIncreasedCount;
  const totalReviewed = corrections.length;
  const incorrectRate = totalReviewed > 0 ? totalIncorrect / totalReviewed * 100 : 0;
  if (incorrectRate > 30) {
    recommendations.push("\u9519\u8BEF\u8C03\u4EF7\u7387\u8F83\u9AD8(>30%)\uFF0C\u5EFA\u8BAE\u5EF6\u957F\u6570\u636E\u89C2\u5BDF\u5468\u671F\u518D\u505A\u8C03\u4EF7\u51B3\u7B56");
  }
  if (overDecreasedCount > overIncreasedCount * 2) {
    recommendations.push("\u8FC7\u5EA6\u964D\u4EF7\u60C5\u51B5\u8F83\u591A\uFF0C\u5EFA\u8BAE\u5728\u964D\u4EF7\u524D\u7B49\u5F85\u66F4\u5B8C\u6574\u7684\u5F52\u56E0\u6570\u636E");
  }
  if (overIncreasedCount > overDecreasedCount * 2) {
    recommendations.push("\u8FC7\u5EA6\u52A0\u4EF7\u60C5\u51B5\u8F83\u591A\uFF0C\u5EFA\u8BAE\u91C7\u7528\u66F4\u4FDD\u5B88\u7684\u52A0\u4EF7\u7B56\u7565");
  }
  const highConfidenceCorrections = corrections.filter((c) => c.confidenceScore > 0.7);
  if (highConfidenceCorrections.length > 0) {
    recommendations.push(`\u6709${highConfidenceCorrections.length}\u4E2A\u9AD8\u7F6E\u4FE1\u5EA6\u7684\u7EA0\u9519\u5EFA\u8BAE\uFF0C\u5EFA\u8BAE\u4F18\u5148\u5904\u7406`);
  }
  const totalLostRevenue = corrections.reduce((sum2, c) => sum2 + c.impactAnalysis.estimatedLostRevenue, 0);
  const totalWastedSpend = corrections.reduce((sum2, c) => sum2 + c.impactAnalysis.estimatedWastedSpend, 0);
  if (totalLostRevenue > 1e3) {
    recommendations.push(`\u9884\u4F30\u56E0\u8FC7\u5EA6\u964D\u4EF7\u635F\u5931\u6536\u5165$${totalLostRevenue.toFixed(2)}\uFF0C\u5EFA\u8BAE\u53CA\u65F6\u7EA0\u6B63`);
  }
  if (totalWastedSpend > 500) {
    recommendations.push(`\u9884\u4F30\u56E0\u8FC7\u5EA6\u52A0\u4EF7\u6D6A\u8D39\u82B1\u8D39$${totalWastedSpend.toFixed(2)}\uFF0C\u5EFA\u8BAE\u53CA\u65F6\u7EA0\u6B63`);
  }
  if (recommendations.length === 0) {
    recommendations.push("\u5F53\u524D\u8C03\u4EF7\u7B56\u7565\u8868\u73B0\u826F\u597D\uFF0C\u7EE7\u7EED\u4FDD\u6301");
  }
  return recommendations;
}
function generateCorrectionReport(sessionId, periodStart, periodEnd, corrections) {
  const overDecreasedCount = corrections.filter((c) => c.correctionType === "over_decreased").length;
  const overIncreasedCount = corrections.filter((c) => c.correctionType === "over_increased").length;
  const correctCount = corrections.filter((c) => c.correctionType === "correct").length;
  const estimatedLostRevenue = corrections.reduce(
    (sum2, c) => sum2 + c.impactAnalysis.estimatedLostRevenue,
    0
  );
  const estimatedWastedSpend = corrections.reduce(
    (sum2, c) => sum2 + c.impactAnalysis.estimatedWastedSpend,
    0
  );
  const potentialRecovery = corrections.reduce(
    (sum2, c) => sum2 + c.impactAnalysis.potentialRecovery,
    0
  );
  const recommendations = generateRecommendations(corrections);
  return {
    sessionId,
    periodStart,
    periodEnd,
    totalAdjustmentsReviewed: corrections.length,
    incorrectAdjustments: overDecreasedCount + overIncreasedCount,
    overDecreasedCount,
    overIncreasedCount,
    correctCount,
    estimatedLostRevenue,
    estimatedWastedSpend,
    potentialRecovery,
    corrections: corrections.filter((c) => c.wasIncorrect),
    // Only include incorrect ones in report
    recommendations
  };
}
function formatCorrectionType(type) {
  const labels = {
    over_decreased: "\u8FC7\u5EA6\u964D\u4EF7",
    over_increased: "\u8FC7\u5EA6\u52A0\u4EF7",
    correct: "\u6B63\u786E"
  };
  return labels[type] || type;
}
var MIN_ANALYSIS_DELAY_DAYS, CORRECTION_THRESHOLD_PERCENT;
var init_correctionService = __esm({
  "server/automation/correctionService.ts"() {
    "use strict";
    MIN_ANALYSIS_DELAY_DAYS = 14;
    CORRECTION_THRESHOLD_PERCENT = 20;
    __name(analyzeOverDecrease, "analyzeOverDecrease");
    __name(analyzeOverIncrease, "analyzeOverIncrease");
    __name(calculateSuggestedBid, "calculateSuggestedBid");
    __name(calculateImpact, "calculateImpact");
    __name(analyzeBidAdjustment, "analyzeBidAdjustment");
    __name(generateRecommendations, "generateRecommendations");
    __name(generateCorrectionReport, "generateCorrectionReport");
    __name(formatCorrectionType, "formatCorrectionType");
  }
});

