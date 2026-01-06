/**
 * Attribution Correction Service
 * Handles detection and correction of bid adjustments affected by attribution delay
 */

export interface BidAdjustmentRecord {
  id: number;
  targetId: number;
  targetName: string;
  targetType: 'keyword' | 'product_target';
  campaignId: number;
  campaignName: string;
  originalBid: number;
  adjustedBid: number;
  adjustmentDate: Date;
  adjustmentReason: string;
  metricsAtAdjustment: PerformanceMetrics;
}

export interface PerformanceMetrics {
  impressions: number;
  clicks: number;
  spend: number;
  sales: number;
  orders: number;
  acos: number;
  roas: number;
  ctr: number;
  cvr: number;
}

export interface CorrectionAnalysis {
  record: BidAdjustmentRecord;
  metricsAfterAttribution: PerformanceMetrics;
  wasIncorrect: boolean;
  correctionType: 'over_decreased' | 'over_increased' | 'correct';
  suggestedBid: number;
  confidenceScore: number;
  impactAnalysis: {
    estimatedLostRevenue: number;
    estimatedWastedSpend: number;
    potentialRecovery: number;
  };
  explanation: string;
}

export interface CorrectionReviewReport {
  sessionId: number;
  periodStart: Date;
  periodEnd: Date;
  totalAdjustmentsReviewed: number;
  incorrectAdjustments: number;
  overDecreasedCount: number;
  overIncreasedCount: number;
  correctCount: number;
  estimatedLostRevenue: number;
  estimatedWastedSpend: number;
  potentialRecovery: number;
  corrections: CorrectionAnalysis[];
  recommendations: string[];
}

/**
 * Amazon attribution window is typically 7-14 days
 * We use 14 days for conservative analysis
 */
export const ATTRIBUTION_WINDOW_DAYS = 14;

/**
 * Minimum days after adjustment before we can analyze
 */
export const MIN_ANALYSIS_DELAY_DAYS = 14;

/**
 * Threshold for considering an adjustment "incorrect"
 * If actual performance differs by more than this %, we flag it
 */
export const CORRECTION_THRESHOLD_PERCENT = 20;

/**
 * Calculate if a bid decrease was incorrect (over-decreased)
 * This happens when conversions came in after the decrease was made
 */
export function analyzeOverDecrease(
  metricsAtAdjustment: PerformanceMetrics,
  metricsAfterAttribution: PerformanceMetrics,
  originalBid: number,
  adjustedBid: number
): { wasOverDecreased: boolean; confidenceScore: number; explanation: string } {
  // Bid was decreased
  if (adjustedBid >= originalBid) {
    return { wasOverDecreased: false, confidenceScore: 0, explanation: '出价未降低' };
  }

  // Check if performance improved after attribution window
  const acosImproved = metricsAfterAttribution.acos < metricsAtAdjustment.acos;
  const roasImproved = metricsAfterAttribution.roas > metricsAtAdjustment.roas;
  const cvrImproved = metricsAfterAttribution.cvr > metricsAtAdjustment.cvr;

  // Calculate improvement percentages
  const acosChange = metricsAtAdjustment.acos > 0 
    ? ((metricsAtAdjustment.acos - metricsAfterAttribution.acos) / metricsAtAdjustment.acos) * 100 
    : 0;
  const roasChange = metricsAtAdjustment.roas > 0 
    ? ((metricsAfterAttribution.roas - metricsAtAdjustment.roas) / metricsAtAdjustment.roas) * 100 
    : 0;

  // If ACoS improved significantly after attribution, the decrease may have been premature
  if (acosImproved && acosChange > CORRECTION_THRESHOLD_PERCENT) {
    const confidenceScore = Math.min(1, acosChange / 100);
    return {
      wasOverDecreased: true,
      confidenceScore,
      explanation: `归因窗口后ACoS改善${acosChange.toFixed(1)}%，表明降价可能过早`,
    };
  }

  // If ROAS improved significantly
  if (roasImproved && roasChange > CORRECTION_THRESHOLD_PERCENT) {
    const confidenceScore = Math.min(1, roasChange / 100);
    return {
      wasOverDecreased: true,
      confidenceScore,
      explanation: `归因窗口后ROAS改善${roasChange.toFixed(1)}%，表明降价可能过早`,
    };
  }

  return { wasOverDecreased: false, confidenceScore: 0, explanation: '调价决策正确' };
}

/**
 * Calculate if a bid increase was incorrect (over-increased)
 * This happens when the expected performance didn't materialize
 */
export function analyzeOverIncrease(
  metricsAtAdjustment: PerformanceMetrics,
  metricsAfterAttribution: PerformanceMetrics,
  originalBid: number,
  adjustedBid: number
): { wasOverIncreased: boolean; confidenceScore: number; explanation: string } {
  // Bid was increased
  if (adjustedBid <= originalBid) {
    return { wasOverIncreased: false, confidenceScore: 0, explanation: '出价未提高' };
  }

  // Check if performance worsened after attribution window
  const acosWorsened = metricsAfterAttribution.acos > metricsAtAdjustment.acos;
  const roasWorsened = metricsAfterAttribution.roas < metricsAtAdjustment.roas;

  // Calculate worsening percentages
  const acosChange = metricsAtAdjustment.acos > 0 
    ? ((metricsAfterAttribution.acos - metricsAtAdjustment.acos) / metricsAtAdjustment.acos) * 100 
    : 0;
  const roasChange = metricsAtAdjustment.roas > 0 
    ? ((metricsAtAdjustment.roas - metricsAfterAttribution.roas) / metricsAtAdjustment.roas) * 100 
    : 0;

  // If ACoS worsened significantly after attribution
  if (acosWorsened && acosChange > CORRECTION_THRESHOLD_PERCENT) {
    const confidenceScore = Math.min(1, acosChange / 100);
    return {
      wasOverIncreased: true,
      confidenceScore,
      explanation: `归因窗口后ACoS恶化${acosChange.toFixed(1)}%，表明加价可能过度`,
    };
  }

  // If ROAS worsened significantly
  if (roasWorsened && roasChange > CORRECTION_THRESHOLD_PERCENT) {
    const confidenceScore = Math.min(1, roasChange / 100);
    return {
      wasOverIncreased: true,
      confidenceScore,
      explanation: `归因窗口后ROAS下降${roasChange.toFixed(1)}%，表明加价可能过度`,
    };
  }

  return { wasOverIncreased: false, confidenceScore: 0, explanation: '调价决策正确' };
}

/**
 * Calculate suggested correction bid
 */
export function calculateSuggestedBid(
  originalBid: number,
  adjustedBid: number,
  correctionType: 'over_decreased' | 'over_increased' | 'correct',
  confidenceScore: number
): number {
  if (correctionType === 'correct') {
    return adjustedBid;
  }

  // Calculate correction amount based on confidence
  const bidDiff = Math.abs(adjustedBid - originalBid);
  const correctionAmount = bidDiff * confidenceScore * 0.5; // Conservative: only correct 50% of the difference

  if (correctionType === 'over_decreased') {
    // Bid was decreased too much, suggest increasing
    return Math.min(originalBid, adjustedBid + correctionAmount);
  } else {
    // Bid was increased too much, suggest decreasing
    return Math.max(originalBid, adjustedBid - correctionAmount);
  }
}

/**
 * Calculate impact of incorrect adjustment
 */
export function calculateImpact(
  metricsAtAdjustment: PerformanceMetrics,
  metricsAfterAttribution: PerformanceMetrics,
  correctionType: 'over_decreased' | 'over_increased' | 'correct',
  daysSinceAdjustment: number
): { estimatedLostRevenue: number; estimatedWastedSpend: number; potentialRecovery: number } {
  if (correctionType === 'correct') {
    return { estimatedLostRevenue: 0, estimatedWastedSpend: 0, potentialRecovery: 0 };
  }

  const dailySpend = metricsAfterAttribution.spend / Math.max(1, daysSinceAdjustment);
  const dailySales = metricsAfterAttribution.sales / Math.max(1, daysSinceAdjustment);

  if (correctionType === 'over_decreased') {
    // Lost revenue due to reduced visibility
    const visibilityLoss = 0.3; // Assume 30% visibility loss from bid decrease
    const estimatedLostRevenue = dailySales * visibilityLoss * daysSinceAdjustment;
    return {
      estimatedLostRevenue,
      estimatedWastedSpend: 0,
      potentialRecovery: estimatedLostRevenue * 0.5, // Can recover 50% with correction
    };
  } else {
    // Wasted spend due to over-bidding
    const wasteRatio = 0.2; // Assume 20% of spend was wasted
    const estimatedWastedSpend = dailySpend * wasteRatio * daysSinceAdjustment;
    return {
      estimatedLostRevenue: 0,
      estimatedWastedSpend,
      potentialRecovery: estimatedWastedSpend * 0.7, // Can save 70% with correction
    };
  }
}

/**
 * Analyze a single bid adjustment record
 */
export function analyzeBidAdjustment(
  record: BidAdjustmentRecord,
  metricsAfterAttribution: PerformanceMetrics
): CorrectionAnalysis {
  const daysSinceAdjustment = Math.floor(
    (Date.now() - record.adjustmentDate.getTime()) / (1000 * 60 * 60 * 24)
  );

  // Check for over-decrease
  const overDecreaseAnalysis = analyzeOverDecrease(
    record.metricsAtAdjustment,
    metricsAfterAttribution,
    record.originalBid,
    record.adjustedBid
  );

  // Check for over-increase
  const overIncreaseAnalysis = analyzeOverIncrease(
    record.metricsAtAdjustment,
    metricsAfterAttribution,
    record.originalBid,
    record.adjustedBid
  );

  // Determine correction type
  let correctionType: 'over_decreased' | 'over_increased' | 'correct' = 'correct';
  let confidenceScore = 0;
  let explanation = '调价决策正确，无需纠正';

  if (overDecreaseAnalysis.wasOverDecreased && 
      overDecreaseAnalysis.confidenceScore > overIncreaseAnalysis.confidenceScore) {
    correctionType = 'over_decreased';
    confidenceScore = overDecreaseAnalysis.confidenceScore;
    explanation = overDecreaseAnalysis.explanation;
  } else if (overIncreaseAnalysis.wasOverIncreased) {
    correctionType = 'over_increased';
    confidenceScore = overIncreaseAnalysis.confidenceScore;
    explanation = overIncreaseAnalysis.explanation;
  }

  const suggestedBid = calculateSuggestedBid(
    record.originalBid,
    record.adjustedBid,
    correctionType,
    confidenceScore
  );

  const impactAnalysis = calculateImpact(
    record.metricsAtAdjustment,
    metricsAfterAttribution,
    correctionType,
    daysSinceAdjustment
  );

  return {
    record,
    metricsAfterAttribution,
    wasIncorrect: correctionType !== 'correct',
    correctionType,
    suggestedBid,
    confidenceScore,
    impactAnalysis,
    explanation,
  };
}

/**
 * Generate recommendations based on correction analysis
 */
export function generateRecommendations(corrections: CorrectionAnalysis[]): string[] {
  const recommendations: string[] = [];
  
  const overDecreasedCount = corrections.filter(c => c.correctionType === 'over_decreased').length;
  const overIncreasedCount = corrections.filter(c => c.correctionType === 'over_increased').length;
  const totalIncorrect = overDecreasedCount + overIncreasedCount;
  const totalReviewed = corrections.length;
  const incorrectRate = totalReviewed > 0 ? (totalIncorrect / totalReviewed) * 100 : 0;

  if (incorrectRate > 30) {
    recommendations.push('错误调价率较高(>30%)，建议延长数据观察周期再做调价决策');
  }

  if (overDecreasedCount > overIncreasedCount * 2) {
    recommendations.push('过度降价情况较多，建议在降价前等待更完整的归因数据');
  }

  if (overIncreasedCount > overDecreasedCount * 2) {
    recommendations.push('过度加价情况较多，建议采用更保守的加价策略');
  }

  const highConfidenceCorrections = corrections.filter(c => c.confidenceScore > 0.7);
  if (highConfidenceCorrections.length > 0) {
    recommendations.push(`有${highConfidenceCorrections.length}个高置信度的纠错建议，建议优先处理`);
  }

  const totalLostRevenue = corrections.reduce((sum, c) => sum + c.impactAnalysis.estimatedLostRevenue, 0);
  const totalWastedSpend = corrections.reduce((sum, c) => sum + c.impactAnalysis.estimatedWastedSpend, 0);
  
  if (totalLostRevenue > 1000) {
    recommendations.push(`预估因过度降价损失收入$${totalLostRevenue.toFixed(2)}，建议及时纠正`);
  }
  
  if (totalWastedSpend > 500) {
    recommendations.push(`预估因过度加价浪费花费$${totalWastedSpend.toFixed(2)}，建议及时纠正`);
  }

  if (recommendations.length === 0) {
    recommendations.push('当前调价策略表现良好，继续保持');
  }

  return recommendations;
}

/**
 * Generate correction review report
 */
export function generateCorrectionReport(
  sessionId: number,
  periodStart: Date,
  periodEnd: Date,
  corrections: CorrectionAnalysis[]
): CorrectionReviewReport {
  const overDecreasedCount = corrections.filter(c => c.correctionType === 'over_decreased').length;
  const overIncreasedCount = corrections.filter(c => c.correctionType === 'over_increased').length;
  const correctCount = corrections.filter(c => c.correctionType === 'correct').length;

  const estimatedLostRevenue = corrections.reduce(
    (sum, c) => sum + c.impactAnalysis.estimatedLostRevenue, 0
  );
  const estimatedWastedSpend = corrections.reduce(
    (sum, c) => sum + c.impactAnalysis.estimatedWastedSpend, 0
  );
  const potentialRecovery = corrections.reduce(
    (sum, c) => sum + c.impactAnalysis.potentialRecovery, 0
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
    corrections: corrections.filter(c => c.wasIncorrect), // Only include incorrect ones in report
    recommendations,
  };
}

/**
 * Format correction type for display
 */
export function formatCorrectionType(type: 'over_decreased' | 'over_increased' | 'correct'): string {
  const labels: Record<string, string> = {
    over_decreased: '过度降价',
    over_increased: '过度加价',
    correct: '正确',
  };
  return labels[type] || type;
}

/**
 * Get severity level based on confidence score
 */
export function getSeverityLevel(confidenceScore: number): 'low' | 'medium' | 'high' {
  if (confidenceScore >= 0.7) return 'high';
  if (confidenceScore >= 0.4) return 'medium';
  return 'low';
}
