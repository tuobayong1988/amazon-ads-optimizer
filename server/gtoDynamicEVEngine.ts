/**
 * gtoDynamicEVEngine.ts - GTO动态期望价值出价引擎
 * 
 * 灵感来源：德州扑克"底池赔率"(Pot Odds) + "隐含赔率"(Implied Odds)
 * 
 * 核心思想：每次出价前实时计算该关键词的期望价值(EV)
 * EV = (预估转化率 × (平均客单价 - 预估CPA)) - (1 - 预估转化率) × 当前出价
 * 
 * 决策逻辑：
 * - EV > 0: "跟注"或"加注"，出价上限为使EV=0的临界值
 * - EV < 0: "弃牌"，暂停或大幅降低出价
 * - 引入"隐含赔率"：对高LTV或品牌曝光关键词给予风险溢价
 */

import type { OptimizationTarget, PerformanceGroupConfig } from "./bidOptimizer";

// ==================== 类型定义 ====================

export interface EVAnalysis {
  /** 期望价值 (正=盈利, 负=亏损) */
  expectedValue: number;
  /** 每次点击的EV */
  evPerClick: number;
  /** 基于EV的最优出价 */
  evOptimalBid: number;
  /** 使EV=0的临界出价（最大可接受出价） */
  breakEvenBid: number;
  /** 当前出价相对于breakEvenBid的比率 */
  bidEfficiency: number;
  /** 隐含赔率溢价 (0-0.3) */
  impliedOddsPremium: number;
  /** 出价建议: call(维持/小幅调整), raise(加注), fold(弃牌) */
  action: 'raise' | 'call' | 'fold';
  /** 建议出价 */
  suggestedBid: number;
  /** 置信度 */
  confidence: number;
  /** 分析原因 */
  reasoning: string;
}

// ==================== 常量配置 ====================

/** 最小数据要求 */
const MIN_CLICKS_FOR_ANALYSIS = 3;
const MIN_IMPRESSIONS_FOR_ANALYSIS = 50;

/** 隐含赔率溢价配置 */
const IMPLIED_ODDS_BRAND_PREMIUM = 0.15;     // 品牌词溢价15%
const IMPLIED_ODDS_HIGH_CVR_PREMIUM = 0.10;  // 高转化率词溢价10%
const IMPLIED_ODDS_NEW_KEYWORD_PREMIUM = 0.20; // 新词探索溢价20%

/** EV决策阈值 */
const EV_RAISE_THRESHOLD = 0.15;  // EV/出价 > 15% 时加注
const EV_FOLD_THRESHOLD = -0.20;  // EV/出价 < -20% 时弃牌

// ==================== 核心算法 ====================

/**
 * 计算单个投放目标的期望价值分析
 */
export function calculateEV(
  target: OptimizationTarget,
  groupConfig: PerformanceGroupConfig
): EVAnalysis {
  const { currentBid, impressions, clicks, spend, sales, orders } = target;
  
  // 数据不足时返回保守分析
  if (clicks < MIN_CLICKS_FOR_ANALYSIS || impressions < MIN_IMPRESSIONS_FOR_ANALYSIS) {
    return buildConservativeAnalysis(target, groupConfig, '数据不足，采用保守策略');
  }

  // ===== 核心指标计算 =====
  const ctr = impressions > 0 ? clicks / impressions : 0;
  const cvr = clicks > 0 ? orders / clicks : 0;
  const aov = orders > 0 ? sales / orders : (groupConfig.groupAvgAov || 25); // 平均客单价
  const cpc = clicks > 0 ? spend / clicks : currentBid;
  const acos = sales > 0 ? spend / sales : Infinity;
  
  // 使用组级别CVR作为贝叶斯先验（如果关键词自身数据不足）
  const effectiveCvr = clicks >= 10 ? cvr : 
    (groupConfig.groupAvgCvr || 0.05) * 0.3 + cvr * 0.7; // 加权混合

  // ===== EV计算 =====
  // EV per click = P(转化) × (AOV - CPA) - P(不转化) × CPC
  // 其中 CPA = CPC / CVR (每次转化成本)
  const estimatedCPA = effectiveCvr > 0 ? cpc / effectiveCvr : cpc * 20;
  const evPerClick = effectiveCvr * (aov - estimatedCPA) - (1 - effectiveCvr) * cpc;
  const expectedValue = evPerClick * clicks; // 总EV

  // ===== Break-Even出价计算 =====
  // 使EV=0的临界出价: breakEvenBid = CVR × AOV × targetAcos
  const targetAcosDecimal = (groupConfig.targetAcos || 30) > 1 
    ? (groupConfig.targetAcos || 30) / 100 
    : (groupConfig.targetAcos || 0.30);
  const breakEvenBid = effectiveCvr * aov * targetAcosDecimal;

  // ===== 隐含赔率溢价 =====
  const impliedOddsPremium = calculateImpliedOddsPremium(target, groupConfig, effectiveCvr);

  // 加入隐含赔率后的调整breakEvenBid
  const adjustedBreakEvenBid = breakEvenBid * (1 + impliedOddsPremium);

  // ===== 出价效率 =====
  const bidEfficiency = adjustedBreakEvenBid > 0 ? currentBid / adjustedBreakEvenBid : 2.0;

  // ===== 决策逻辑 =====
  const evRatio = currentBid > 0 ? evPerClick / currentBid : 0;
  let action: 'raise' | 'call' | 'fold';
  let suggestedBid: number;
  let reasoning: string;

  if (evRatio > EV_RAISE_THRESHOLD && currentBid < adjustedBreakEvenBid * 0.85) {
    // EV显著为正且出价远低于breakEven: 加注
    action = 'raise';
    // 加注到breakEven的70-85%（留有安全边际）
    suggestedBid = Math.min(adjustedBreakEvenBid * 0.80, currentBid * 1.25);
    reasoning = `EV正向(${evPerClick.toFixed(3)}/click)，出价效率${(bidEfficiency * 100).toFixed(0)}%，` +
      `低于breakEven($${adjustedBreakEvenBid.toFixed(2)})，建议加注至$${suggestedBid.toFixed(2)}`;
  } else if (evRatio < EV_FOLD_THRESHOLD && bidEfficiency > 1.3) {
    // EV显著为负且出价远超breakEven: 弃牌
    action = 'fold';
    // 降到breakEven的60%
    suggestedBid = Math.max(0.02, adjustedBreakEvenBid * 0.60);
    reasoning = `EV负向(${evPerClick.toFixed(3)}/click)，出价效率${(bidEfficiency * 100).toFixed(0)}%，` +
      `超过breakEven($${adjustedBreakEvenBid.toFixed(2)})，建议降至$${suggestedBid.toFixed(2)}`;
  } else {
    // EV中性: 维持
    action = 'call';
    suggestedBid = currentBid;
    reasoning = `EV中性(${evPerClick.toFixed(3)}/click)，出价效率${(bidEfficiency * 100).toFixed(0)}%，` +
      `接近breakEven($${adjustedBreakEvenBid.toFixed(2)})，维持当前出价`;
  }

  // 安全边界
  suggestedBid = Math.max(0.02, Math.round(suggestedBid * 100) / 100);

  // 置信度基于数据量
  const confidence = Math.min(0.9, Math.sqrt(clicks / 100) * 0.6 + (cvr > 0 ? 0.3 : 0));

  return {
    expectedValue,
    evPerClick,
    evOptimalBid: adjustedBreakEvenBid * 0.75,
    breakEvenBid: adjustedBreakEvenBid,
    bidEfficiency,
    impliedOddsPremium,
    action,
    suggestedBid,
    confidence,
    reasoning,
  };
}

/**
 * 批量计算EV分析
 */
export function batchCalculateEV(
  targets: OptimizationTarget[],
  groupConfig: PerformanceGroupConfig
): Map<number, EVAnalysis> {
  const results = new Map<number, EVAnalysis>();
  for (const target of targets) {
    results.set(target.id, calculateEV(target, groupConfig));
  }
  return results;
}

// ==================== 辅助函数 ====================

/**
 * 计算隐含赔率溢价
 * 对有长期价值的关键词给予额外的出价空间
 */
function calculateImpliedOddsPremium(
  target: OptimizationTarget,
  config: PerformanceGroupConfig,
  effectiveCvr: number
): number {
  let premium = 0;

  // 1. 高转化率关键词 — 已验证的价值词，给予溢价
  if (effectiveCvr > 0.10 && target.clicks >= 20) {
    premium += IMPLIED_ODDS_HIGH_CVR_PREMIUM;
  }

  // 2. 新词探索 — 数据不足但有潜力的词
  if (target.clicks < 10 && target.impressions > 100) {
    premium += IMPLIED_ODDS_NEW_KEYWORD_PREMIUM;
  }

  // 3. 精确匹配词 — 通常有更高的转化意图
  if (target.matchType === 'exact') {
    premium += 0.05;
  }

  // 4. 策略模板加成
  if (config.strategyTemplate === 'aggressive-growth') {
    premium += 0.10; // 激进增长策略给予更多探索空间
  } else if (config.strategyTemplate === 'profit-maximize') {
    premium -= 0.05; // 利润最大化策略收紧溢价
  }

  // 上限30%
  return Math.min(0.30, Math.max(0, premium));
}

/**
 * 数据不足时的保守分析
 */
function buildConservativeAnalysis(
  target: OptimizationTarget,
  config: PerformanceGroupConfig,
  reason: string
): EVAnalysis {
  const targetAcosDecimal = (config.targetAcos || 30) > 1 
    ? (config.targetAcos || 30) / 100 
    : (config.targetAcos || 0.30);
  const estimatedCvr = config.groupAvgCvr || 0.05;
  const estimatedAov = config.groupAvgAov || 25;
  const conservativeBreakEven = estimatedCvr * estimatedAov * targetAcosDecimal;

  return {
    expectedValue: 0,
    evPerClick: 0,
    evOptimalBid: conservativeBreakEven * 0.60,
    breakEvenBid: conservativeBreakEven,
    bidEfficiency: target.currentBid > 0 ? target.currentBid / conservativeBreakEven : 1.0,
    impliedOddsPremium: IMPLIED_ODDS_NEW_KEYWORD_PREMIUM, // 新词给予探索溢价
    action: 'call',
    suggestedBid: target.currentBid, // 数据不足时维持现状
    confidence: 0.1,
    reasoning: `[保守模式] ${reason}，使用组级别先验(CVR=${(estimatedCvr * 100).toFixed(1)}%, AOV=$${estimatedAov.toFixed(0)})`,
  };
}
