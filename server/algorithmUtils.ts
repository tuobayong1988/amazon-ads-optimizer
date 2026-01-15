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


// ==================== 时间衰减权重计算 ====================

/**
 * 计算时间衰减权重
 * 使用指数衰减模型，使近期数据获得更高权重
 * 
 * @param dataDate 数据日期
 * @param halfLifeDays 半衰期（天数），默认7天
 * @param referenceDate 参考日期，默认为当前时间
 * @returns 权重值 (0-1)
 */
export function calculateTimeDecayWeight(
  dataDate: Date,
  halfLifeDays: number = 7,
  referenceDate: Date = new Date()
): number {
  const daysDiff = (referenceDate.getTime() - dataDate.getTime()) / (1000 * 60 * 60 * 24);
  if (daysDiff < 0) return 1; // 未来数据给予最高权重
  return Math.pow(0.5, daysDiff / halfLifeDays);
}

/**
 * 批量计算时间衰减权重
 * 返回归一化后的权重数组
 */
export function calculateTimeDecayWeights(
  dates: Date[],
  halfLifeDays: number = 7,
  referenceDate: Date = new Date()
): number[] {
  const weights = dates.map(date => calculateTimeDecayWeight(date, halfLifeDays, referenceDate));
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  if (totalWeight === 0) return weights.map(() => 1 / weights.length);
  return weights.map(w => w / totalWeight);
}

/**
 * 计算时间加权平均值
 * 对数据应用时间衰减权重后计算加权平均
 */
export function calculateTimeWeightedAverage(
  values: number[],
  dates: Date[],
  halfLifeDays: number = 7
): number {
  if (values.length !== dates.length || values.length === 0) return 0;
  
  const weights = calculateTimeDecayWeights(dates, halfLifeDays);
  let weightedSum = 0;
  
  for (let i = 0; i < values.length; i++) {
    weightedSum += values[i] * weights[i];
  }
  
  return weightedSum;
}

/**
 * 计算时间加权ROAS
 * 专门用于计算考虑时间衰减的ROAS指标
 */
export function calculateTimeWeightedROAS(
  dailyData: Array<{ date: Date; spend: number; sales: number }>,
  halfLifeDays: number = 7
): number {
  if (dailyData.length === 0) return 0;
  
  const dates = dailyData.map(d => d.date);
  const weights = calculateTimeDecayWeights(dates, halfLifeDays);
  
  let weightedSpend = 0;
  let weightedSales = 0;
  
  for (let i = 0; i < dailyData.length; i++) {
    weightedSpend += dailyData[i].spend * weights[i];
    weightedSales += dailyData[i].sales * weights[i];
  }
  
  return weightedSpend > 0 ? weightedSales / weightedSpend : 0;
}

/**
 * 计算时间加权ACoS
 */
export function calculateTimeWeightedACoS(
  dailyData: Array<{ date: Date; spend: number; sales: number }>,
  halfLifeDays: number = 7
): number {
  const roas = calculateTimeWeightedROAS(dailyData, halfLifeDays);
  return roas > 0 ? 1 / roas : 0;
}

// ==================== UCB探索-利用平衡改进 ====================

/**
 * UCB1-Tuned算法 - 更精确的探索-利用平衡
 * 考虑了奖励的方差，在高方差情况下增加探索
 */
export function calculateUCBTuned(
  averageReward: number,
  totalTrials: number,
  armTrials: number,
  rewardVariance: number,
  explorationFactor: number = 2
): number {
  if (armTrials === 0) return Infinity;
  
  const logN = Math.log(totalTrials);
  // 高方差应该导致更高的探索奖励
  // 使用方差的平方根作为额外的探索乘数
  const varianceMultiplier = 1 + Math.sqrt(rewardVariance) * 0.5;
  const explorationBonus = Math.sqrt(logN / armTrials) * varianceMultiplier;
  
  return averageReward + explorationFactor * explorationBonus;
}

/**
 * 计算关键词的UCB竞价建议
 * 用于在新关键词探索和高效词利用之间取得平衡
 */
export interface UCBBidSuggestion {
  suggestedBid: number;
  ucbScore: number;
  explorationBonus: number;
  strategy: 'explore' | 'exploit' | 'balanced';
  confidence: number;
}

export function calculateUCBBidSuggestion(
  currentBid: number,
  averageROAS: number,
  clicks: number,
  totalClicks: number,
  roasVariance: number = 0,
  targetROAS: number = 3,
  explorationFactor: number = 1.5
): UCBBidSuggestion {
  // 计算UCB分数
  const ucbScore = roasVariance > 0
    ? calculateUCBTuned(averageROAS, totalClicks, clicks, roasVariance, explorationFactor)
    : calculateUCB(averageROAS, totalClicks, clicks, explorationFactor);
  
  // 计算探索奖励
  const explorationBonus = clicks > 0
    ? explorationFactor * Math.sqrt(Math.log(totalClicks) / clicks)
    : Infinity;
  
  // 确定策略
  let strategy: 'explore' | 'exploit' | 'balanced';
  let confidence: number;
  
  if (clicks < 10) {
    strategy = 'explore';
    confidence = 0.3;
  } else if (clicks < 50) {
    strategy = 'balanced';
    confidence = 0.5 + (clicks - 10) / 80;
  } else {
    strategy = 'exploit';
    confidence = Math.min(0.95, 0.7 + clicks / 500);
  }
  
  // 计算建议竞价
  let suggestedBid: number;
  
  if (strategy === 'explore') {
    // 探索阶段：略微提高竞价以获取更多数据
    suggestedBid = currentBid * (1 + 0.1 * (1 - clicks / 10));
  } else if (strategy === 'exploit') {
    // 利用阶段：基于ROAS调整竞价
    if (averageROAS >= targetROAS) {
      suggestedBid = currentBid * Math.min(1.2, 1 + (averageROAS - targetROAS) / targetROAS * 0.1);
    } else {
      suggestedBid = currentBid * Math.max(0.8, averageROAS / targetROAS);
    }
  } else {
    // 平衡阶段：结合探索和利用
    const exploitBid = averageROAS >= targetROAS
      ? currentBid * (1 + (averageROAS - targetROAS) / targetROAS * 0.05)
      : currentBid * (averageROAS / targetROAS);
    const exploreBid = currentBid * (1 + 0.05);
    const exploitWeight = (clicks - 10) / 40;
    suggestedBid = exploreBid * (1 - exploitWeight) + exploitBid * exploitWeight;
  }
  
  // 限制竞价调整幅度
  suggestedBid = Math.max(currentBid * 0.7, Math.min(currentBid * 1.3, suggestedBid));
  
  return {
    suggestedBid: Math.round(suggestedBid * 100) / 100,
    ucbScore: Math.round(ucbScore * 100) / 100,
    explorationBonus: Math.round(explorationBonus * 100) / 100,
    strategy,
    confidence: Math.round(confidence * 100) / 100
  };
}

// ==================== 节假日和促销日配置 ====================

export interface HolidayConfig {
  name: string;
  date: string; // YYYY-MM-DD 格式，或 'YYYY-MM-DD~YYYY-MM-DD' 表示日期范围
  bidMultiplier: number; // 竞价乘数
  budgetMultiplier: number; // 预算乘数
  priority: 'high' | 'medium' | 'low';
}

export const MARKETPLACE_HOLIDAYS: Record<string, HolidayConfig[]> = {
  'US': [
    { name: 'Prime Day', date: '2026-07-15~2026-07-16', bidMultiplier: 1.5, budgetMultiplier: 2.0, priority: 'high' },
    { name: 'Black Friday', date: '2026-11-27', bidMultiplier: 1.8, budgetMultiplier: 2.5, priority: 'high' },
    { name: 'Cyber Monday', date: '2026-11-30', bidMultiplier: 1.8, budgetMultiplier: 2.5, priority: 'high' },
    { name: 'Thanksgiving', date: '2026-11-26', bidMultiplier: 1.3, budgetMultiplier: 1.5, priority: 'medium' },
    { name: 'Christmas Eve', date: '2026-12-24', bidMultiplier: 1.2, budgetMultiplier: 1.3, priority: 'medium' },
    { name: 'Christmas', date: '2026-12-25', bidMultiplier: 0.8, budgetMultiplier: 0.8, priority: 'low' },
    { name: 'New Year Eve', date: '2026-12-31', bidMultiplier: 1.1, budgetMultiplier: 1.2, priority: 'medium' },
    { name: 'New Year', date: '2026-01-01', bidMultiplier: 0.9, budgetMultiplier: 1.0, priority: 'low' },
    { name: 'Valentine Day', date: '2026-02-14', bidMultiplier: 1.3, budgetMultiplier: 1.5, priority: 'medium' },
    { name: 'Easter', date: '2026-04-05', bidMultiplier: 1.2, budgetMultiplier: 1.3, priority: 'medium' },
    { name: 'Mother Day', date: '2026-05-10', bidMultiplier: 1.3, budgetMultiplier: 1.5, priority: 'medium' },
    { name: 'Father Day', date: '2026-06-21', bidMultiplier: 1.2, budgetMultiplier: 1.3, priority: 'medium' },
    { name: 'Independence Day', date: '2026-07-04', bidMultiplier: 1.2, budgetMultiplier: 1.3, priority: 'medium' },
    { name: 'Labor Day', date: '2026-09-07', bidMultiplier: 1.2, budgetMultiplier: 1.3, priority: 'medium' },
    { name: 'Halloween', date: '2026-10-31', bidMultiplier: 1.2, budgetMultiplier: 1.3, priority: 'medium' },
  ],
  'UK': [
    { name: 'Prime Day', date: '2026-07-15~2026-07-16', bidMultiplier: 1.5, budgetMultiplier: 2.0, priority: 'high' },
    { name: 'Black Friday', date: '2026-11-27', bidMultiplier: 1.8, budgetMultiplier: 2.5, priority: 'high' },
    { name: 'Boxing Day', date: '2026-12-26', bidMultiplier: 1.5, budgetMultiplier: 1.8, priority: 'high' },
    { name: 'Christmas', date: '2026-12-25', bidMultiplier: 0.7, budgetMultiplier: 0.7, priority: 'low' },
  ],
  'DE': [
    { name: 'Prime Day', date: '2026-07-15~2026-07-16', bidMultiplier: 1.5, budgetMultiplier: 2.0, priority: 'high' },
    { name: 'Black Friday', date: '2026-11-27', bidMultiplier: 1.8, budgetMultiplier: 2.5, priority: 'high' },
    { name: 'Christmas', date: '2026-12-25~2026-12-26', bidMultiplier: 0.7, budgetMultiplier: 0.7, priority: 'low' },
  ],
  'JP': [
    { name: 'Prime Day', date: '2026-07-15~2026-07-16', bidMultiplier: 1.5, budgetMultiplier: 2.0, priority: 'high' },
    { name: 'Black Friday', date: '2026-11-27', bidMultiplier: 1.5, budgetMultiplier: 2.0, priority: 'high' },
    { name: 'New Year', date: '2026-01-01~2026-01-03', bidMultiplier: 0.8, budgetMultiplier: 0.8, priority: 'low' },
    { name: 'Golden Week', date: '2026-04-29~2026-05-05', bidMultiplier: 1.3, budgetMultiplier: 1.5, priority: 'medium' },
  ],
  'CA': [
    { name: 'Prime Day', date: '2026-07-15~2026-07-16', bidMultiplier: 1.5, budgetMultiplier: 2.0, priority: 'high' },
    { name: 'Black Friday', date: '2026-11-27', bidMultiplier: 1.8, budgetMultiplier: 2.5, priority: 'high' },
    { name: 'Boxing Day', date: '2026-12-26', bidMultiplier: 1.5, budgetMultiplier: 1.8, priority: 'high' },
  ],
  'MX': [
    { name: 'Prime Day', date: '2026-07-15~2026-07-16', bidMultiplier: 1.5, budgetMultiplier: 2.0, priority: 'high' },
    { name: 'Buen Fin', date: '2026-11-13~2026-11-16', bidMultiplier: 1.8, budgetMultiplier: 2.5, priority: 'high' },
    { name: 'Hot Sale', date: '2026-05-25~2026-06-02', bidMultiplier: 1.5, budgetMultiplier: 2.0, priority: 'high' },
  ],
  'AU': [
    { name: 'Prime Day', date: '2026-07-15~2026-07-16', bidMultiplier: 1.5, budgetMultiplier: 2.0, priority: 'high' },
    { name: 'Black Friday', date: '2026-11-27', bidMultiplier: 1.8, budgetMultiplier: 2.5, priority: 'high' },
    { name: 'Boxing Day', date: '2026-12-26', bidMultiplier: 1.5, budgetMultiplier: 1.8, priority: 'high' },
    { name: 'Click Frenzy', date: '2026-11-10~2026-11-12', bidMultiplier: 1.5, budgetMultiplier: 1.8, priority: 'high' },
  ],
};

/**
 * 检查指定日期是否为节假日或促销日
 */
export function getHolidayConfig(
  date: Date,
  marketplace: string
): HolidayConfig | null {
  const holidays = MARKETPLACE_HOLIDAYS[marketplace] || MARKETPLACE_HOLIDAYS['US'];
  const dateStr = date.toISOString().split('T')[0];
  
  for (const holiday of holidays) {
    if (holiday.date.includes('~')) {
      const [startStr, endStr] = holiday.date.split('~');
      if (dateStr >= startStr && dateStr <= endStr) {
        return holiday;
      }
    } else if (holiday.date === dateStr) {
      return holiday;
    }
  }
  
  return null;
}

/**
 * 获取节假日前的预热期配置
 * 在大促前7天开始逐步提高竞价和预算
 */
export function getPreHolidayMultiplier(
  date: Date,
  marketplace: string,
  preHolidayDays: number = 7
): { bidMultiplier: number; budgetMultiplier: number; holidayName: string | null } {
  const holidays = MARKETPLACE_HOLIDAYS[marketplace] || MARKETPLACE_HOLIDAYS['US'];
  const dateMs = date.getTime();
  
  for (const holiday of holidays) {
    if (holiday.priority !== 'high') continue;
    
    let holidayStartDate: Date;
    if (holiday.date.includes('~')) {
      holidayStartDate = new Date(holiday.date.split('~')[0]);
    } else {
      holidayStartDate = new Date(holiday.date);
    }
    
    const daysUntilHoliday = (holidayStartDate.getTime() - dateMs) / (1000 * 60 * 60 * 24);
    
    if (daysUntilHoliday > 0 && daysUntilHoliday <= preHolidayDays) {
      // 线性增加乘数
      const progress = 1 - daysUntilHoliday / preHolidayDays;
      const bidMultiplier = 1 + (holiday.bidMultiplier - 1) * progress * 0.5;
      const budgetMultiplier = 1 + (holiday.budgetMultiplier - 1) * progress * 0.5;
      
      return {
        bidMultiplier: Math.round(bidMultiplier * 100) / 100,
        budgetMultiplier: Math.round(budgetMultiplier * 100) / 100,
        holidayName: holiday.name
      };
    }
  }
  
  return { bidMultiplier: 1, budgetMultiplier: 1, holidayName: null };
}

/**
 * 获取完整的日期调整乘数（包括节假日和预热期）
 */
export function getDateAdjustmentMultipliers(
  date: Date,
  marketplace: string
): { bidMultiplier: number; budgetMultiplier: number; reason: string } {
  // 首先检查是否为节假日
  const holidayConfig = getHolidayConfig(date, marketplace);
  if (holidayConfig) {
    return {
      bidMultiplier: holidayConfig.bidMultiplier,
      budgetMultiplier: holidayConfig.budgetMultiplier,
      reason: `${holidayConfig.name} (${holidayConfig.priority} priority)`
    };
  }
  
  // 检查是否为预热期
  const preHoliday = getPreHolidayMultiplier(date, marketplace);
  if (preHoliday.holidayName) {
    return {
      bidMultiplier: preHoliday.bidMultiplier,
      budgetMultiplier: preHoliday.budgetMultiplier,
      reason: `Pre-${preHoliday.holidayName} warm-up period`
    };
  }
  
  return { bidMultiplier: 1, budgetMultiplier: 1, reason: 'Normal day' };
}
