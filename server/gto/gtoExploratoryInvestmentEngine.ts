/**
 * gtoExploratoryInvestmentEngine.ts - GTO探索性投资引擎
 * 
 * 灵感来源：德州扑克"半诈唬"(Semi-Bluff) 策略
 * 
 * 核心思想：对有曝光、有点击但暂未转化的"听牌型"关键词，
 * 不是简单地降价或暂停，而是执行"脉冲式半诈唬"策略：
 * 1. 在高转化时段小幅提升出价，测试转化潜力
 * 2. 如果获得转化，升级为"价值型"关键词
 * 3. 多次脉冲后仍无转化，判定为"诈唬失败"，大幅降价
 * 
 * 关键词分类体系：
 * - 价值型(Value): 有转化、ROI正向 → 正常优化
 * - 听牌型(Drawing): 有曝光有点击无转化 → 脉冲探索
 * - 冷启动型(Cold Start): 数据极少 → 保护性出价
 * - 死牌型(Dead): 长期无转化 → 大幅降价或暂停
 */

import type { OptimizationTarget, PerformanceGroupConfig } from "../optimization/bidOptimizer";

// ==================== 类型定义 ====================

export type KeywordClassification = 'value' | 'drawing' | 'cold_start' | 'dead';

export interface ExplorationDecision {
  /** 关键词分类 */
  classification: KeywordClassification;
  /** 是否应执行脉冲探索 */
  shouldPulse: boolean;
  /** 脉冲出价修正系数 (1.0=不变, 1.15=提升15%) */
  pulseModifier: number;
  /** 探索预算占比 (0-1, 该词应占探索池的比例) */
  explorationBudgetShare: number;
  /** 剩余探索次数 (基于历史脉冲次数) */
  remainingPulses: number;
  /** 探索阶段: probe(初探), confirm(确认), graduate(毕业), abandon(放弃) */
  phase: 'probe' | 'confirm' | 'graduate' | 'abandon';
  /** 建议出价 */
  suggestedBid: number;
  /** 置信度 */
  confidence: number;
  /** 分析原因 */
  reasoning: string;
}

// ==================== 常量配置 ====================

/** 分类阈值 */
const VALUE_MIN_ORDERS = 1;          // 至少1个订单才算价值型
const DRAWING_MIN_CLICKS = 5;        // 至少5次点击才算听牌型
const DRAWING_MIN_IMPRESSIONS = 100; // 至少100次曝光
const COLD_START_MAX_CLICKS = 5;     // 少于5次点击为冷启动
const DEAD_MIN_CLICKS = 20;          // 20+次点击仍无转化为死牌

/** 脉冲探索配置 */
const MAX_PULSE_ATTEMPTS = 5;        // 最多5次脉冲探索
const PULSE_BID_INCREASE = 0.15;     // 脉冲时出价提升15%
const PULSE_INTERVAL_HOURS = 24;     // 每次脉冲间隔24小时
const DEAD_BID_REDUCTION = 0.40;     // 死牌降价40%

/** 探索预算分配 */
const MAX_EXPLORATION_SHARE = 0.20;  // 单个听牌词最多占探索池20%

// ==================== 核心算法 ====================

/**
 * 对单个投放目标进行探索性投资分析
 */
export function analyzeExploration(
  target: OptimizationTarget,
  groupConfig: PerformanceGroupConfig,
  historicalPulseCount: number = 0
): ExplorationDecision {
  const { currentBid, impressions, clicks, orders, sales, spend } = target;
  
  // ===== 第1步：关键词分类 =====
  const classification = classifyKeyword(target);
  
  // ===== 第2步：根据分类制定策略 =====
  switch (classification) {
    case 'value':
      return buildValueDecision(target, groupConfig);
    case 'drawing':
      return buildDrawingDecision(target, groupConfig, historicalPulseCount);
    case 'cold_start':
      return buildColdStartDecision(target, groupConfig);
    case 'dead':
      return buildDeadDecision(target, groupConfig, historicalPulseCount);
  }
}

/**
 * 批量分析探索性投资
 */
export function batchAnalyzeExploration(
  targets: OptimizationTarget[],
  groupConfig: PerformanceGroupConfig,
  pulseHistory: Map<number, number> // keywordId -> pulseCount
): Map<number, ExplorationDecision> {
  const results = new Map<number, ExplorationDecision>();
  
  for (const target of targets) {
    const pulseCount = pulseHistory.get(target.id) || 0;
    results.set(target.id, analyzeExploration(target, groupConfig, pulseCount));
  }
  
  return results;
}

// ==================== 分类逻辑 ====================

/**
 * 关键词分类：价值型 / 听牌型 / 冷启动型 / 死牌型
 */
function classifyKeyword(target: OptimizationTarget): KeywordClassification {
  const { impressions, clicks, orders } = target;
  
  // 有订单 → 价值型
  if (orders >= VALUE_MIN_ORDERS) {
    return 'value';
  }
  
  // 大量点击但无转化 → 死牌型
  if (clicks >= DEAD_MIN_CLICKS && orders === 0) {
    return 'dead';
  }
  
  // 有一定点击和曝光但无转化 → 听牌型（有潜力）
  if (clicks >= DRAWING_MIN_CLICKS && impressions >= DRAWING_MIN_IMPRESSIONS && orders === 0) {
    return 'drawing';
  }
  
  // 数据极少 → 冷启动型
  return 'cold_start';
}

// ==================== 策略构建 ====================

/**
 * 价值型关键词策略 — 正常优化，不需要探索
 */
function buildValueDecision(
  target: OptimizationTarget,
  config: PerformanceGroupConfig
): ExplorationDecision {
  return {
    classification: 'value',
    shouldPulse: false,
    pulseModifier: 1.0,
    explorationBudgetShare: 0,
    remainingPulses: 0,
    phase: 'graduate',
    suggestedBid: target.currentBid,
    confidence: 0.8,
    reasoning: `价值型关键词(${target.orders}单, $${target.sales.toFixed(2)}销售)，已毕业，交由常规优化引擎处理`,
  };
}

/**
 * 听牌型关键词策略 — 脉冲式半诈唬
 */
function buildDrawingDecision(
  target: OptimizationTarget,
  config: PerformanceGroupConfig,
  pulseCount: number
): ExplorationDecision {
  const remainingPulses = Math.max(0, MAX_PULSE_ATTEMPTS - pulseCount);
  
  if (remainingPulses <= 0) {
    // 脉冲次数用尽仍无转化 → 降级为死牌
    return {
      classification: 'drawing',
      shouldPulse: false,
      pulseModifier: 0.70,
      explorationBudgetShare: 0,
      remainingPulses: 0,
      phase: 'abandon',
      suggestedBid: Math.max(0.02, target.currentBid * 0.70),
      confidence: 0.7,
      reasoning: `听牌型关键词已完成${MAX_PULSE_ATTEMPTS}次脉冲探索仍无转化，判定为诈唬失败，降价30%`,
    };
  }

  // 计算脉冲出价
  const pulseBid = Math.round(target.currentBid * (1 + PULSE_BID_INCREASE) * 100) / 100;
  
  // CTR评估：CTR越高，说明用户兴趣越大，转化潜力越高
  const ctr = target.impressions > 0 ? target.clicks / target.impressions : 0;
  const ctrScore = Math.min(1, ctr / 0.01); // 1% CTR为满分
  
  // 根据CTR调整脉冲强度
  const adjustedPulseModifier = 1 + PULSE_BID_INCREASE * (0.5 + ctrScore * 0.5);

  const phase = pulseCount === 0 ? 'probe' : 'confirm';

  return {
    classification: 'drawing',
    shouldPulse: true,
    pulseModifier: adjustedPulseModifier,
    explorationBudgetShare: Math.min(MAX_EXPLORATION_SHARE, ctrScore * 0.15),
    remainingPulses,
    phase,
    suggestedBid: Math.round(target.currentBid * adjustedPulseModifier * 100) / 100,
    confidence: 0.5 + ctrScore * 0.2,
    reasoning: `听牌型关键词(${target.clicks}次点击, CTR=${(ctr * 100).toFixed(2)}%)，` +
      `第${pulseCount + 1}/${MAX_PULSE_ATTEMPTS}次脉冲探索，` +
      `出价提升${((adjustedPulseModifier - 1) * 100).toFixed(0)}%至$${(target.currentBid * adjustedPulseModifier).toFixed(2)}`,
  };
}

/**
 * 冷启动型关键词策略 — 保护性出价
 */
function buildColdStartDecision(
  target: OptimizationTarget,
  config: PerformanceGroupConfig
): ExplorationDecision {
  // 冷启动词保持当前出价，不做大幅调整，等待数据积累
  return {
    classification: 'cold_start',
    shouldPulse: false,
    pulseModifier: 1.0,
    explorationBudgetShare: 0.05,
    remainingPulses: MAX_PULSE_ATTEMPTS,
    phase: 'probe',
    suggestedBid: target.currentBid,
    confidence: 0.2,
    reasoning: `冷启动关键词(${target.clicks}次点击, ${target.impressions}次曝光)，` +
      `数据不足以做出判断，保持当前出价$${target.currentBid.toFixed(2)}等待数据积累`,
  };
}

/**
 * 死牌型关键词策略 — 大幅降价
 */
function buildDeadDecision(
  target: OptimizationTarget,
  config: PerformanceGroupConfig,
  pulseCount: number
): ExplorationDecision {
  const reductionFactor = 1 - DEAD_BID_REDUCTION;
  const newBid = Math.max(0.02, Math.round(target.currentBid * reductionFactor * 100) / 100);
  
  return {
    classification: 'dead',
    shouldPulse: false,
    pulseModifier: reductionFactor,
    explorationBudgetShare: 0,
    remainingPulses: 0,
    phase: 'abandon',
    suggestedBid: newBid,
    confidence: 0.8,
    reasoning: `死牌型关键词(${target.clicks}次点击, 0转化, 花费$${target.spend.toFixed(2)})，` +
      `长期无转化，降价${(DEAD_BID_REDUCTION * 100).toFixed(0)}%至$${newBid.toFixed(2)}`,
  };
}

/**
 * 获取关键词的探索阶段标签（用于日志和UI展示）
 */
export function getExplorationLabel(classification: KeywordClassification): string {
  switch (classification) {
    case 'value': return '价值型';
    case 'drawing': return '听牌型';
    case 'cold_start': return '冷启动';
    case 'dead': return '死牌型';
  }
}
