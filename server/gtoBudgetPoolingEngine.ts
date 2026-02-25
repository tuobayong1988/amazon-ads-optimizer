/**
 * gtoBudgetPoolingEngine.ts - GTO预算分池与风控引擎
 * 
 * 灵感来源：德州扑克"资金管理"(Bankroll Management) 策略
 * 
 * 核心思想：将总预算动态划分为两个池
 * - 核心资产池 (Core Asset Pool, ~80%): 投放历史表现优秀的价值型关键词
 * - 探索风险池 (Venture Risk Pool, ~20%): 听牌型关键词的脉冲探索和新词测试
 * 
 * 风控机制：
 * - 熔断机制: 探索风险池当日亏损达阈值时自动暂停所有探索性投入
 * - 动态再平衡: 定期根据关键词表现在两个池之间调整
 */

import type { OptimizationTarget, PerformanceGroupConfig } from "./bidOptimizer";
import type { KeywordClassification } from "./gtoExploratoryInvestmentEngine";

// ==================== 类型定义 ====================

export interface BudgetPoolAllocation {
  /** 核心资产池预算 */
  corePoolBudget: number;
  /** 探索风险池预算 */
  venturePoolBudget: number;
  /** 核心资产池占比 */
  corePoolRatio: number;
  /** 探索风险池占比 */
  venturePoolRatio: number;
  /** 熔断状态 */
  circuitBreakerTriggered: boolean;
  /** 熔断原因 */
  circuitBreakerReason: string;
  /** 探索池当日已花费 */
  venturePoolSpentToday: number;
  /** 探索池当日亏损率 */
  venturePoolLossRate: number;
}

export interface BudgetDecision {
  /** 该关键词所属池 */
  pool: 'core' | 'venture';
  /** 该关键词的预算上限 */
  budgetCap: number;
  /** 出价修正系数 (基于预算池状态) */
  budgetModifier: number;
  /** 是否被熔断暂停 */
  isFrozen: boolean;
  /** 原因说明 */
  reasoning: string;
}

// ==================== 常量配置 ====================

/** 默认池比例 */
const DEFAULT_CORE_RATIO = 0.80;
const DEFAULT_VENTURE_RATIO = 0.20;

/** 熔断阈值 */
const CIRCUIT_BREAKER_LOSS_RATE = 0.30;   // 探索池当日亏损30%触发熔断
const CIRCUIT_BREAKER_SPEND_RATE = 0.80;  // 探索池当日花费80%预算触发预警

/** 动态再平衡 */
const MIN_VENTURE_RATIO = 0.10;  // 探索池最低10%
const MAX_VENTURE_RATIO = 0.30;  // 探索池最高30%

// ==================== 核心算法 ====================

/**
 * 计算预算池分配
 */
export function calculateBudgetPoolAllocation(
  totalDailyBudget: number,
  ventureSpentToday: number,
  ventureSalesToday: number,
  corePerformanceScore: number, // 0-1, 核心池的表现评分
  ventureSuccessRate: number    // 0-1, 探索池的历史成功率
): BudgetPoolAllocation {
  
  // ===== 动态调整池比例 =====
  // 如果探索池历史成功率高，增加探索池比例
  // 如果核心池表现优秀，保持核心池比例
  let ventureRatio = DEFAULT_VENTURE_RATIO;
  
  if (ventureSuccessRate > 0.3) {
    // 探索成功率高，增加探索池
    ventureRatio = Math.min(MAX_VENTURE_RATIO, DEFAULT_VENTURE_RATIO + ventureSuccessRate * 0.1);
  } else if (ventureSuccessRate < 0.1 && corePerformanceScore > 0.7) {
    // 探索成功率低且核心池表现好，减少探索池
    ventureRatio = Math.max(MIN_VENTURE_RATIO, DEFAULT_VENTURE_RATIO - 0.05);
  }
  
  const coreRatio = 1 - ventureRatio;
  const corePoolBudget = totalDailyBudget * coreRatio;
  const venturePoolBudget = totalDailyBudget * ventureRatio;
  
  // ===== 熔断检测 =====
  const venturePoolLossRate = venturePoolBudget > 0 
    ? Math.max(0, (ventureSpentToday - ventureSalesToday) / venturePoolBudget) 
    : 0;
  
  let circuitBreakerTriggered = false;
  let circuitBreakerReason = '';
  
  if (venturePoolLossRate >= CIRCUIT_BREAKER_LOSS_RATE) {
    circuitBreakerTriggered = true;
    circuitBreakerReason = `探索池当日亏损率${(venturePoolLossRate * 100).toFixed(0)}%达到熔断阈值${(CIRCUIT_BREAKER_LOSS_RATE * 100).toFixed(0)}%，暂停所有探索性投入`;
  } else if (ventureSpentToday >= venturePoolBudget * CIRCUIT_BREAKER_SPEND_RATE) {
    circuitBreakerTriggered = true;
    circuitBreakerReason = `探索池当日花费$${ventureSpentToday.toFixed(2)}已达预算${(CIRCUIT_BREAKER_SPEND_RATE * 100).toFixed(0)}%上限$${(venturePoolBudget * CIRCUIT_BREAKER_SPEND_RATE).toFixed(2)}，暂停探索性投入`;
  }
  
  return {
    corePoolBudget,
    venturePoolBudget,
    corePoolRatio: coreRatio,
    venturePoolRatio: ventureRatio,
    circuitBreakerTriggered,
    circuitBreakerReason,
    venturePoolSpentToday: ventureSpentToday,
    venturePoolLossRate,
  };
}

/**
 * 为单个关键词分配预算池和出价修正
 */
export function assignBudgetPool(
  target: OptimizationTarget,
  classification: KeywordClassification,
  poolAllocation: BudgetPoolAllocation,
  totalKeywordsInPool: number
): BudgetDecision {
  
  // 价值型 → 核心池
  if (classification === 'value') {
    const perKeywordBudget = totalKeywordsInPool > 0 
      ? poolAllocation.corePoolBudget / totalKeywordsInPool 
      : poolAllocation.corePoolBudget;
    
    return {
      pool: 'core',
      budgetCap: perKeywordBudget,
      budgetModifier: 1.0, // 核心池不做额外修正
      isFrozen: false,
      reasoning: `价值型关键词，分配至核心资产池(${(poolAllocation.corePoolRatio * 100).toFixed(0)}%)`,
    };
  }
  
  // 听牌型/冷启动型 → 探索池
  if (classification === 'drawing' || classification === 'cold_start') {
    // 检查熔断
    if (poolAllocation.circuitBreakerTriggered) {
      return {
        pool: 'venture',
        budgetCap: 0,
        budgetModifier: 0, // 熔断时完全暂停
        isFrozen: true,
        reasoning: `[熔断] ${poolAllocation.circuitBreakerReason}`,
      };
    }
    
    const perKeywordBudget = totalKeywordsInPool > 0 
      ? poolAllocation.venturePoolBudget / totalKeywordsInPool 
      : poolAllocation.venturePoolBudget;
    
    // 根据探索池剩余预算调整出价修正系数
    const remainingBudgetRatio = poolAllocation.venturePoolBudget > 0
      ? Math.max(0, 1 - poolAllocation.venturePoolSpentToday / poolAllocation.venturePoolBudget)
      : 0;
    const budgetModifier = 0.5 + remainingBudgetRatio * 0.5; // 0.5-1.0
    
    return {
      pool: 'venture',
      budgetCap: perKeywordBudget,
      budgetModifier,
      isFrozen: false,
      reasoning: `${classification === 'drawing' ? '听牌型' : '冷启动型'}关键词，` +
        `分配至探索风险池(${(poolAllocation.venturePoolRatio * 100).toFixed(0)}%)，` +
        `剩余预算${(remainingBudgetRatio * 100).toFixed(0)}%，修正系数${budgetModifier.toFixed(2)}`,
    };
  }
  
  // 死牌型 → 不分配预算
  return {
    pool: 'venture',
    budgetCap: 0,
    budgetModifier: 0.5, // 死牌型大幅降低
    isFrozen: false,
    reasoning: `死牌型关键词，不分配额外预算，出价大幅降低`,
  };
}

/**
 * 计算探索池的历史成功率
 * 成功定义：从听牌型升级为价值型的关键词比例
 */
export function calculateVentureSuccessRate(
  totalExploredKeywords: number,
  graduatedKeywords: number
): number {
  if (totalExploredKeywords <= 0) return 0.15; // 默认15%
  return Math.min(1, graduatedKeywords / totalExploredKeywords);
}

/**
 * 计算核心池表现评分
 * 基于核心池关键词的平均ROAS相对于目标ROAS的达成度
 */
export function calculateCorePerformanceScore(
  corePoolRoas: number,
  targetRoas: number
): number {
  if (targetRoas <= 0) return 0.5;
  const ratio = corePoolRoas / targetRoas;
  return Math.min(1, Math.max(0, ratio));
}
