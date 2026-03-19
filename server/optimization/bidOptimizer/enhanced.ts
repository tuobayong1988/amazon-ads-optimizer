/**
 * 增强版竞价优化 — 集成时间衰减、UCB探索-利用、节假日调整
 * v417: 从 bidOptimizer.ts 拆分
 */

import {
  calculateTimeWeightedROAS,
  calculateUCBBidSuggestion,
  getDateAdjustmentMultipliers,
  getHolidayConfig,
} from '../../algorithm/algorithmUtils';

import {
  type EnhancedOptimizationTarget,
  type EnhancedOptimizationResult,
  type PerformanceGroupConfig,
  type AlgorithmEffectRecord,
} from './types';
import { calculateMetrics, generateMarketCurve, findOptimalBid } from './marketCurve';
import {
  isDataSufficient,
  calculateBayesianSmoothedCvr,
  detectSuspectedOOS,
  isNewCampaign,
  calculateZeroImpressionProbing,
  calculateExplorationBid,
  generateOptimizationReason,
} from './bidAdjustment';

/**
 * 数据稀疏场景的保守竞价策略（贝叶斯平滑）— 增强版内部使用
 */
function calculateSparseDataBidAdjustment(
  target: EnhancedOptimizationTarget,
  config: PerformanceGroupConfig,
  maxBidLimit: number = 2.00,
  minBidLimit: number = 0.02
) {
  let newBid = target.currentBid;
  let reason = "";

  const groupAvgCvr = config.groupAvgCvr || 0.05;
  const groupAvgAov = config.groupAvgAov || 30;
  const groupAvgCpc = config.groupAvgCpc || 0.75;
  const effectiveMaxBid = config.maxBid || maxBidLimit;

  const smoothedCvr = calculateBayesianSmoothedCvr(target.orders, target.clicks, groupAvgCvr);

  let targetCpa: number;
  if (config.targetAcos) {
    targetCpa = (config.targetAcos / 100) * groupAvgAov;
  } else if (config.targetRoas && config.targetRoas > 0) {
    targetCpa = groupAvgAov / config.targetRoas;
  } else {
    targetCpa = groupAvgAov * 0.3;
  }

  const theoreticalBid = smoothedCvr * targetCpa;

  if (target.clicks === 0) {
    if (target.impressions > 0 && target.impressions < 100) {
      newBid = Math.min(target.currentBid * 1.05, effectiveMaxBid);
      reason = `[贝叶斯] 有曝光(${target.impressions})但零点击，微提5%改善广告位`;
    } else {
      newBid = target.currentBid;
      reason = `[贝叶斯] 数据不足(点击0)，保持当前出价$${target.currentBid.toFixed(2)}等待数据积累`;
    }
  } else if (target.orders === 0) {
    const currentCpc = target.spend / target.clicks;
    if (currentCpc > groupAvgCpc * 1.5) {
      newBid = Math.max(target.currentBid * 0.90, minBidLimit);
      reason = `[贝叶斯] 零转化且CPC($${currentCpc.toFixed(2)})偏高，降价10%`;
    } else {
      newBid = target.currentBid;
      reason = `[贝叶斯] 零转化但CPC合理，保持当前出价等待转化数据`;
    }
  } else {
    if (theoreticalBid > target.currentBid * 1.15) {
      newBid = target.currentBid * 1.10;
      reason = `[贝叶斯] 平滑CVR(${(smoothedCvr * 100).toFixed(1)}%)支持提价，保守提10%`;
    } else if (theoreticalBid < target.currentBid * 0.85) {
      newBid = target.currentBid * 0.90;
      reason = `[贝叶斯] 平滑CVR(${(smoothedCvr * 100).toFixed(1)}%)偏低，保守降10%`;
    } else {
      newBid = theoreticalBid;
      reason = `[贝叶斯] 基于平滑CVR(${(smoothedCvr * 100).toFixed(1)}%)和目标CPA($${targetCpa.toFixed(2)})调整`;
    }
  }

  newBid = Math.min(newBid, effectiveMaxBid);
  newBid = Math.max(newBid, minBidLimit);
  newBid = Math.round(newBid * 100) / 100;

  return { newBid, reason };
}

/**
 * 增强版竞价调整 — 集成时间衰减、UCB和节假日调整
 */
export function calculateEnhancedBidAdjustment(
  target: EnhancedOptimizationTarget,
  config: PerformanceGroupConfig,
  maxBidLimit: number = 2.00,
  minBidLimit: number = 0.02,
  currentDate: Date = new Date()
): EnhancedOptimizationResult {
  const metrics = calculateMetrics(target);
  let algorithmUsed: EnhancedOptimizationResult['algorithmUsed'] = 'market_curve';
  let confidenceScore = 0.5;
  let timeDecayROAS: number | undefined;
  let holidayMultiplier = 1;
  
  // 1. 计算时间衰减加权的ROAS
  if (target.dailyData && target.dailyData.length > 0) {
    timeDecayROAS = calculateTimeWeightedROAS(target.dailyData);
    algorithmUsed = 'time_decay';
    confidenceScore = Math.min(0.9, 0.5 + target.dailyData.length / 30);
  }
  
  // 2. 获取UCB竞价建议
  const targetROAS = config.targetRoas || 3;
  const ucbSuggestion = calculateUCBBidSuggestion(
    target.currentBid,
    target.clicks,
    timeDecayROAS || metrics.roas,
    targetROAS
  );
  
  if (ucbSuggestion.strategy === 'explore') {
    algorithmUsed = 'ucb';
    confidenceScore = ucbSuggestion.confidence;
  }
  
  // 3. 检查节假日配置
  const marketplace = target.marketplace || 'US';
  const dateAdjustment = getDateAdjustmentMultipliers(currentDate, marketplace);
  const holidayConfig = getHolidayConfig(currentDate, marketplace);
  holidayMultiplier = dateAdjustment.bidMultiplier;
  
  if (holidayMultiplier !== 1) {
    algorithmUsed = 'holiday';
  }
  
  const effectiveMaxBid = config.maxBid || maxBidLimit;
  
  // 4. 计算基础竞价
  let baseBid: number;
  
  if (!isDataSufficient(target, config)) {
    const sparseResult = calculateSparseDataBidAdjustment(target, config, effectiveMaxBid, minBidLimit);
    baseBid = sparseResult.newBid;
    algorithmUsed = 'bayesian';
    confidenceScore = 0.3;
  } else if (ucbSuggestion.strategy === 'explore') {
    baseBid = ucbSuggestion.suggestedBid;
  } else if (timeDecayROAS !== undefined) {
    const targetAcos = config.targetAcos || 30;
    const currentAcos = timeDecayROAS > 0 ? (1 / timeDecayROAS) * 100 : 100;
    
    if (currentAcos < targetAcos) {
      const adjustmentFactor = Math.min(1.25, 1 + (targetAcos - currentAcos) / targetAcos * 0.5);
      baseBid = target.currentBid * adjustmentFactor;
    } else {
      const adjustmentFactor = Math.max(0.75, targetAcos / currentAcos);
      baseBid = target.currentBid * adjustmentFactor;
    }
  } else {
    const marketCurve = generateMarketCurve(target);
    baseBid = findOptimalBid(marketCurve, config);
  }
  
  // 5. 应用节假日乘数
  let newBid = baseBid * holidayMultiplier;
  
  // 6. 应用出价限制
  newBid = Math.min(newBid, effectiveMaxBid);
  newBid = Math.max(newBid, minBidLimit);
  
  // 7. 限制单次调整幅度
  const maxChangePercent = config._evolvedMaxChangePercent || 0.30;
  const maxIncrease = target.currentBid * (1 + maxChangePercent);
  const maxDecrease = target.currentBid * (1 - (config._evolvedMaxDecreasePercent || 0.20));
  
  newBid = Math.min(newBid, maxIncrease);
  newBid = Math.max(newBid, maxDecrease);
  
  newBid = Math.round(newBid * 100) / 100;
  
  let actionType: 'increase' | 'decrease' | 'set' = 'set';
  if (newBid > target.currentBid) actionType = 'increase';
  else if (newBid < target.currentBid) actionType = 'decrease';
  
  const bidChangePercent = target.currentBid > 0 ? ((newBid - target.currentBid) / target.currentBid) * 100 : 0;
  
  // 生成原因
  const reasons: string[] = [];
  
  if (timeDecayROAS !== undefined) {
    reasons.push(`时间加权ROAS: ${timeDecayROAS.toFixed(2)}`);
  }
  
  if (ucbSuggestion.strategy === 'explore') {
    reasons.push(`UCB探索策略 (置信度: ${(ucbSuggestion.confidence * 100).toFixed(0)}%)`);
  } else if (ucbSuggestion.strategy === 'exploit') {
    reasons.push(`UCB利用策略 (置信度: ${(ucbSuggestion.confidence * 100).toFixed(0)}%)`);
  }
  
  if (holidayMultiplier !== 1) {
    reasons.push(`${dateAdjustment.reason} (乘数: ${holidayMultiplier})`);
  }
  
  if (reasons.length === 0) {
    reasons.push(generateOptimizationReason(target, metrics, config, newBid));
  }
  
  const algorithmsUsed = [
    timeDecayROAS !== undefined,
    ucbSuggestion.strategy !== 'exploit',
    holidayMultiplier !== 1
  ].filter(Boolean).length;
  
  if (algorithmsUsed > 1) {
    algorithmUsed = 'combined';
  }
  
  return {
    targetId: target.id,
    targetType: target.type,
    previousBid: target.currentBid,
    newBid,
    actionType,
    bidChangePercent: Math.round(bidChangePercent * 100) / 100,
    reason: reasons.join('；'),
    algorithmUsed,
    timeDecayROAS,
    ucbSuggestion,
    holidayConfig,
    holidayMultiplier,
    confidenceScore: Math.round(confidenceScore * 100) / 100
  };
}

/**
 * 增强版绩效组优化
 */
export function optimizePerformanceGroupEnhanced(
  targets: EnhancedOptimizationTarget[],
  config: PerformanceGroupConfig,
  maxBidLimit: number = 2.00,
  currentDate: Date = new Date()
): EnhancedOptimizationResult[] {
  const results: EnhancedOptimizationResult[] = [];
  const effectiveMaxBid = config.maxBid || maxBidLimit;
  
  for (const target of targets) {
    // 第0层：出价超限强制回退
    if (target.currentBid > effectiveMaxBid) {
      const newBid = Math.round(effectiveMaxBid * 100) / 100;
      results.push({
        targetId: target.id,
        targetType: target.type,
        previousBid: target.currentBid,
        newBid,
        actionType: 'decrease',
        bidChangePercent: target.currentBid > 0 ? Math.round(((newBid - target.currentBid) / target.currentBid) * 10000) / 100 : 0,
        reason: `[强制回退] 当前出价$${target.currentBid.toFixed(2)}超过用户设置的最高出价限制$${effectiveMaxBid.toFixed(2)}，强制降价到上限`,
        algorithmUsed: 'combined',
        confidenceScore: 1.0,
        holidayMultiplier: 1,
      } as EnhancedOptimizationResult);
      continue;
    }
    
    // 第1层：疑似断货检测
    if (detectSuspectedOOS(target)) {
      results.push({
        targetId: target.id,
        targetType: target.type,
        previousBid: target.currentBid,
        newBid: target.currentBid,
        actionType: 'set',
        bidChangePercent: 0,
        reason: `疑似断货/揉购物车丢失：历史日均曝光${target.historicalAvgImpressions}但当前曝光为0，强制暂停优化`,
        algorithmUsed: 'combined',
        confidenceScore: 1.0,
        holidayMultiplier: 1,
      } as EnhancedOptimizationResult);
      continue;
    }
    
    // 第1.5层：零曝光高出价回退
    if (target.impressions === 0 && target.currentBid >= effectiveMaxBid * 0.7) {
      const groupAvgCpc = config.groupAvgCpc || 0.75;
      const rollbackBid = Math.max(Math.min(groupAvgCpc, effectiveMaxBid * 0.3), 0.02);
      const newBid = Math.round(rollbackBid * 100) / 100;
      results.push({
        targetId: target.id,
        targetType: target.type,
        previousBid: target.currentBid,
        newBid,
        actionType: 'decrease',
        bidChangePercent: target.currentBid > 0 ? Math.round(((newBid - target.currentBid) / target.currentBid) * 10000) / 100 : 0,
        reason: `[零曝光回退] 出价$${target.currentBid.toFixed(2)}已达上限${effectiveMaxBid.toFixed(2)}的70%+但零曝光，该关键词可能无效，强制回退至组平均CPC$${groupAvgCpc.toFixed(2)}`,
        algorithmUsed: 'bayesian',
        confidenceScore: 0.9,
        holidayMultiplier: 1,
      } as EnhancedOptimizationResult);
      continue;
    }
    
    // 第2层：零曝光/冷启动探测
    if (target.impressions === 0 && isNewCampaign(target)) {
      const probingResult = calculateZeroImpressionProbing(target, config, effectiveMaxBid);
      results.push({
        ...probingResult,
        algorithmUsed: 'bayesian',
        confidenceScore: 0.2,
        holidayMultiplier: 1,
      } as EnhancedOptimizationResult);
      continue;
    }
    
    // 第3层：低数据量探索模式
    if (!isDataSufficient(target, config)) {
      const explorationResult = calculateExplorationBid(target, config, effectiveMaxBid);
      results.push({
        ...explorationResult,
        algorithmUsed: 'bayesian',
        confidenceScore: 0.25,
        holidayMultiplier: 1,
      } as EnhancedOptimizationResult);
      continue;
    }
    
    // 第4层：数据充足的正常增强版优化流程
    const result = calculateEnhancedBidAdjustment(target, config, effectiveMaxBid, 0.02, currentDate);
    
    if (Math.abs(result.bidChangePercent) > 1) {
      results.push(result);
    }
  }
  
  return results;
}

/**
 * 创建算法效果追踪记录
 */
export function createAlgorithmEffectRecord(
  result: EnhancedOptimizationResult,
  currentROAS: number,
  currentACoS: number
): AlgorithmEffectRecord {
  return {
    targetId: result.targetId,
    targetType: result.targetType,
    algorithmUsed: result.algorithmUsed,
    previousBid: result.previousBid,
    newBid: result.newBid,
    previousROAS: currentROAS,
    previousACoS: currentACoS,
    optimizationDate: new Date()
  };
}

/**
 * 更新算法效果追踪记录（优化后7天调用）
 */
export function updateAlgorithmEffectRecord(
  record: AlgorithmEffectRecord,
  postROAS: number,
  postACoS: number
): AlgorithmEffectRecord {
  const roasChange = postROAS - record.previousROAS;
  const acosChange = record.previousACoS - postACoS;
  
  const roasScore = roasChange > 0 ? Math.min(1, roasChange / record.previousROAS) : Math.max(-1, roasChange / record.previousROAS);
  const acosScore = acosChange > 0 ? Math.min(1, acosChange / record.previousACoS) : Math.max(-1, acosChange / record.previousACoS);
  const effectScore = (roasScore * 0.6 + acosScore * 0.4);
  
  return {
    ...record,
    postROAS,
    postACoS,
    roasChange: Math.round(roasChange * 100) / 100,
    acosChange: Math.round(acosChange * 100) / 100,
    effectScore: Math.round(effectScore * 100) / 100
  };
}

/**
 * 计算算法效果统计
 */
export function calculateAlgorithmEffectStats(
  records: AlgorithmEffectRecord[]
): Record<string, {
  count: number;
  avgROASChange: number;
  avgACoSChange: number;
  avgEffectScore: number;
  positiveRate: number;
}> {
  const stats: Record<string, {
    count: number;
    totalROASChange: number;
    totalACoSChange: number;
    totalEffectScore: number;
    positiveCount: number;
  }> = {};
  
  for (const record of (records as unknown[])) {
    if (record.effectScore === undefined) continue;
    
    if (!stats[record.algorithmUsed]) {
      stats[record.algorithmUsed] = {
        count: 0,
        totalROASChange: 0,
        totalACoSChange: 0,
        totalEffectScore: 0,
        positiveCount: 0
      };
    }
    
    const s = stats[record.algorithmUsed];
    s.count++;
    s.totalROASChange += record.roasChange || 0;
    s.totalACoSChange += record.acosChange || 0;
    s.totalEffectScore += record.effectScore;
    if (record.effectScore > 0) s.positiveCount++;
  }
  
  const result: Record<string, {
    count: number;
    avgROASChange: number;
    avgACoSChange: number;
    avgEffectScore: number;
    positiveRate: number;
  }> = {};
  
  for (const [algorithm, s] of Object.entries(stats)) {
    result[algorithm] = {
      count: s.count,
      avgROASChange: Math.round((s.totalROASChange / s.count) * 100) / 100,
      avgACoSChange: Math.round((s.totalACoSChange / s.count) * 100) / 100,
      avgEffectScore: Math.round((s.totalEffectScore / s.count) * 100) / 100,
      positiveRate: Math.round((s.positiveCount / s.count) * 100)
    };
  }
  
  return result;
}
