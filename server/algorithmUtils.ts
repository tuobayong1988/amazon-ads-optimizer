/**
 * Algorithm Utility Functions - 广告优化算法核心工具函数
 */

// ==================== 类型定义 ====================

export interface BidChangeRecord {
  oldBid: number;
  newBid: number;
  oldClicks: number;
  newClicks: number;
  timestamp: Date;
}

export interface ElasticityResult {
  elasticity: number;
  confidence: number;
  sampleSize: number;
  method: 'historical' | 'category_default' | 'global_default';
}

export interface CPCEstimate {
  estimatedCpc: number;
  cpcBidRatio: number;
  confidence: number;
  placement: 'top_search' | 'product_page' | 'rest' | 'overall';
}

export interface ExplorationStrategy {
  isNewKeyword: boolean;
  explorationDaysRemaining: number;
  suggestedBid: number;
  strategy: 'explore' | 'exploit' | 'transition';
}

export interface NGramDataRequirements {
  minClicks: number;
  minImpressions: number;
  attributionWindowDays: number;
}

// ==================== 时区配置 ====================

export const MARKETPLACE_TIMEZONES: Record<string, string> = {
  'US': 'America/Los_Angeles', 'CA': 'America/Toronto', 'MX': 'America/Mexico_City', 'BR': 'America/Sao_Paulo',
  'UK': 'Europe/London', 'DE': 'Europe/Berlin', 'FR': 'Europe/Paris', 'IT': 'Europe/Rome', 'ES': 'Europe/Madrid',
  'JP': 'Asia/Tokyo', 'AU': 'Australia/Sydney', 'SG': 'Asia/Singapore', 'IN': 'Asia/Kolkata', 'AE': 'Asia/Dubai',
};

export const CATEGORY_ELASTICITY: Record<string, number> = {
  'electronics': 1.2, 'computers': 1.1, 'cell_phones': 1.15, 'video_games': 1.0,
  'home_kitchen': 0.85, 'sports_outdoors': 0.8, 'toys_games': 0.9, 'clothing': 0.75, 'beauty': 0.7, 'health': 0.65,
  'baby': 0.5, 'pet_supplies': 0.55, 'grocery': 0.4, 'luxury': 0.3, 'default': 0.8,
};

// ==================== 动态弹性系数计算 ====================

export function calculateDynamicElasticity(historicalData: BidChangeRecord[], category?: string): ElasticityResult {
  const validRecords = historicalData.filter(record => {
    const bidChangePercent = Math.abs((record.newBid - record.oldBid) / record.oldBid);
    return bidChangePercent >= 0.05 && record.oldClicks > 0;
  });
  
  if (validRecords.length < 5) {
    const categoryElasticity = category ? (CATEGORY_ELASTICITY[category] || CATEGORY_ELASTICITY['default']) : CATEGORY_ELASTICITY['default'];
    return { elasticity: categoryElasticity, confidence: 0.3, sampleSize: validRecords.length, method: category ? 'category_default' : 'global_default' };
  }
  
  const elasticities: number[] = [];
  for (const record of validRecords) {
    const bidChangePercent = (record.newBid - record.oldBid) / record.oldBid;
    const clickChangePercent = (record.newClicks - record.oldClicks) / record.oldClicks;
    if (bidChangePercent !== 0) {
      const elasticity = clickChangePercent / bidChangePercent;
      if (elasticity >= 0 && elasticity <= 3) elasticities.push(elasticity);
    }
  }
  
  if (elasticities.length < 3) {
    const categoryElasticity = category ? (CATEGORY_ELASTICITY[category] || CATEGORY_ELASTICITY['default']) : CATEGORY_ELASTICITY['default'];
    return { elasticity: categoryElasticity, confidence: 0.4, sampleSize: elasticities.length, method: 'category_default' };
  }
  
  elasticities.sort((a, b) => a - b);
  const medianIndex = Math.floor(elasticities.length / 2);
  const medianElasticity = elasticities.length % 2 === 0 ? (elasticities[medianIndex - 1] + elasticities[medianIndex]) / 2 : elasticities[medianIndex];
  
  const mean = elasticities.reduce((a, b) => a + b, 0) / elasticities.length;
  const variance = elasticities.reduce((sum, e) => sum + Math.pow(e - mean, 2), 0) / elasticities.length;
  const stdDev = Math.sqrt(variance);
  const coefficientOfVariation = mean > 0 ? stdDev / mean : 1;
  const sampleConfidence = Math.min(1, elasticities.length / 20);
  const consistencyConfidence = Math.max(0, 1 - coefficientOfVariation);
  const confidence = sampleConfidence * 0.6 + consistencyConfidence * 0.4;
  
  return { elasticity: Math.round(medianElasticity * 100) / 100, confidence: Math.round(confidence * 100) / 100, sampleSize: elasticities.length, method: 'historical' };
}

export function getElasticity(historicalData: BidChangeRecord[], category?: string, minConfidence: number = 0.5): number {
  const result = calculateDynamicElasticity(historicalData, category);
  if (result.confidence < minConfidence && result.method === 'historical') {
    const categoryElasticity = category ? (CATEGORY_ELASTICITY[category] || CATEGORY_ELASTICITY['default']) : CATEGORY_ELASTICITY['default'];
    const weight = result.confidence / minConfidence;
    return result.elasticity * weight + categoryElasticity * (1 - weight);
  }
  return result.elasticity;
}

// ==================== 时区感知的时间转换 ====================

export function convertToLocalTime(utcTime: Date, marketplace: string): Date {
  const timezone = MARKETPLACE_TIMEZONES[marketplace] || 'UTC';
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const parts = formatter.formatToParts(utcTime);
  const dateParts: Record<string, string> = {};
  for (const part of parts) dateParts[part.type] = part.value;
  return new Date(parseInt(dateParts.year), parseInt(dateParts.month) - 1, parseInt(dateParts.day), parseInt(dateParts.hour), parseInt(dateParts.minute), parseInt(dateParts.second));
}

export function getLocalHour(utcTime: Date, marketplace: string): number {
  const timezone = MARKETPLACE_TIMEZONES[marketplace] || 'UTC';
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', hour12: false });
  return parseInt(formatter.format(utcTime));
}

export function getLocalDayOfWeek(utcTime: Date, marketplace: string): number {
  const timezone = MARKETPLACE_TIMEZONES[marketplace] || 'UTC';
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' });
  const dayMap: Record<string, number> = { 'Sun': 0, 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6 };
  return dayMap[formatter.format(utcTime)] ?? 0;
}

export function getTimeSlotIndex(utcTime: Date, marketplace: string): number {
  return Math.floor(getLocalHour(utcTime, marketplace) / 2);
}

// ==================== CPC估算改进 ====================

export function estimateCPC(
  historicalData: { bid: number; cpc: number; clicks: number; placement?: 'top_search' | 'product_page' | 'rest' }[],
  currentBid: number,
  placement?: 'top_search' | 'product_page' | 'rest'
): CPCEstimate {
  let validData = historicalData.filter(d => d.clicks > 0 && d.cpc > 0 && d.bid > 0);
  if (placement) {
    const placementData = validData.filter(d => d.placement === placement);
    if (placementData.length >= 3) validData = placementData;
  }
  
  if (validData.length < 3) {
    const defaultRatios: Record<string, number> = { 'top_search': 0.85, 'product_page': 0.65, 'rest': 0.55, 'overall': 0.70 };
    const ratio = defaultRatios[placement || 'overall'];
    return { estimatedCpc: currentBid * ratio, cpcBidRatio: ratio, confidence: 0.3, placement: placement || 'overall' };
  }
  
  const totalClicks = validData.reduce((sum, d) => sum + d.clicks, 0);
  const weightedRatio = validData.reduce((sum, d) => sum + (d.cpc / d.bid) * (d.clicks / totalClicks), 0);
  const sampleConfidence = Math.min(1, validData.length / 10);
  const ratios = validData.map(d => d.cpc / d.bid);
  const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  const variance = ratios.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / ratios.length;
  const consistencyConfidence = Math.max(0, 1 - Math.sqrt(variance) / mean);
  const confidence = sampleConfidence * 0.5 + consistencyConfidence * 0.5;
  
  return { estimatedCpc: currentBid * weightedRatio, cpcBidRatio: Math.round(weightedRatio * 100) / 100, confidence: Math.round(confidence * 100) / 100, placement: placement || 'overall' };
}

// ==================== 新关键词探索策略 ====================

export function isNewKeyword(createdAt: Date, totalClicks: number, totalImpressions: number, explorationDays: number = 7): boolean {
  const daysSinceCreation = (new Date().getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
  return daysSinceCreation <= explorationDays || (totalClicks < 10 && totalImpressions < 500);
}

export function getExplorationStrategy(
  createdAt: Date, totalClicks: number, totalImpressions: number, currentBid: number,
  suggestedBidRange?: { low: number; median: number; high: number }, explorationDays: number = 7
): ExplorationStrategy {
  const daysSinceCreation = (new Date().getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
  const isNew = isNewKeyword(createdAt, totalClicks, totalImpressions, explorationDays);
  
  if (!isNew) return { isNewKeyword: false, explorationDaysRemaining: 0, suggestedBid: currentBid, strategy: 'exploit' };
  
  const daysRemaining = Math.max(0, explorationDays - daysSinceCreation);
  let suggestedBid = currentBid;
  let strategy: 'explore' | 'exploit' | 'transition' = 'explore';
  
  if (suggestedBidRange) {
    if (daysSinceCreation <= explorationDays * 0.5) {
      suggestedBid = suggestedBidRange.median;
    } else if (totalClicks >= 5) {
      strategy = 'transition';
      const ctr = totalImpressions > 0 ? totalClicks / totalImpressions : 0;
      suggestedBid = ctr > 0.005 ? suggestedBidRange.median : suggestedBidRange.low;
    } else {
      suggestedBid = suggestedBidRange.median;
    }
  } else {
    suggestedBid = currentBid * 1.2;
  }
  
  return { isNewKeyword: true, explorationDaysRemaining: Math.round(daysRemaining * 10) / 10, suggestedBid: Math.round(suggestedBid * 100) / 100, strategy };
}

// ==================== 品牌词白名单管理 ====================

export function isProtectedKeyword(keyword: string, brandTerms: string[], coreProductTerms: string[] = []): boolean {
  const normalizedKeyword = keyword.toLowerCase().trim();
  for (const brand of brandTerms) if (normalizedKeyword.includes(brand.toLowerCase())) return true;
  for (const term of coreProductTerms) if (normalizedKeyword.includes(term.toLowerCase())) return true;
  return false;
}

// ==================== UCB探索-利用平衡 ====================

export function calculateUCB(averageReward: number, totalTrials: number, armTrials: number, explorationFactor: number = 2): number {
  if (armTrials === 0) return Infinity;
  return averageReward + explorationFactor * Math.sqrt(Math.log(totalTrials) / armTrials);
}

export function calculateMinExplorationBudget(totalBudget: number, campaignCount: number, minExplorationRatio: number = 0.1): number {
  return Math.max(0.01, Math.round((totalBudget * minExplorationRatio / campaignCount) * 100) / 100);
}

export function needsReEvaluation(lastEvaluationDate: Date, currentPerformance: number, previousPerformance: number, evaluationIntervalDays: number = 7): boolean {
  const daysSinceEvaluation = (new Date().getTime() - lastEvaluationDate.getTime()) / (1000 * 60 * 60 * 24);
  if (daysSinceEvaluation >= evaluationIntervalDays) return true;
  if (previousPerformance > 0 && Math.abs(currentPerformance - previousPerformance) / previousPerformance > 0.3) return true;
  return false;
}

// ==================== N-Gram分析数据要求 ====================

export function getNGramDataRequirements(matchType: 'broad' | 'phrase' | 'exact', averageCpc: number): NGramDataRequirements {
  let minClicks = matchType === 'broad' ? 15 : matchType === 'exact' ? 8 : 10;
  let minImpressions = matchType === 'broad' ? 1000 : matchType === 'exact' ? 300 : 500;
  if (averageCpc > 2) { minClicks = Math.max(5, Math.floor(minClicks * 0.7)); minImpressions = Math.max(200, Math.floor(minImpressions * 0.7)); }
  return { minClicks, minImpressions, attributionWindowDays: 14 };
}
