/**
 * gtoIntegrationOrchestrator.ts - GTO集成编排层
 * 
 * 将6个GTO引擎统一编排，为NextGen出价引擎提供GTO修正系数。
 * 
 * 设计原则：
 * 1. 非侵入式 — 不修改NextGen的核心出价逻辑，而是通过修正系数叠加
 * 2. 安全优先 — GTO修正有独立的安全边界，不会产生极端出价
 * 3. 渐进式 — 所有修正系数都在安全范围内(0.5~1.5)
 * 4. 可观测 — 完整记录每个引擎的决策过程
 * 
 * 集成方式：
 * NextGen最终出价 = NextGen基础出价 × GTO综合修正系数
 * GTO综合修正系数 = 加权平均(EV修正, 探索修正, 预算修正, 窗口修正, 组合修正, 竞争修正)
 */

import type { OptimizationTarget, PerformanceGroupConfig } from "../optimization/bidOptimizer";
import { type CompetitionProfile, type CompetitorType } from "./gtoCompetitorAwarenessEngine";
import { calculateEV, type EVAnalysis } from "./gtoDynamicEVEngine";
import { analyzeExploration, type ExplorationDecision, type KeywordClassification } from "./gtoExploratoryInvestmentEngine";
import { 
  calculateBudgetPoolAllocation, assignBudgetPool, calculateVentureSuccessRate, calculateCorePerformanceScore,
  type BudgetPoolAllocation, type BudgetDecision 
} from "./gtoBudgetPoolingEngine";
import { detectOpportunityWindow, type OpportunityWindow, type HourlySignal } from "./gtoOpportunityWindowEngine";
import { analyzePortfolio, assignKeywordRole, type PortfolioAnalysis, type KeywordRoleAssignment } from "./gtoKeywordPortfolioBalancer";
import { createModuleLogger } from '../utils/logger';

const log = createModuleLogger('GTO');

// ==================== 类型定义 ====================

export interface GTOModifier {
  /** GTO综合修正系数 (0.5~1.5) */
  compositeModifier: number;
  /** 各引擎的独立修正系数 */
  breakdown: {
    evModifier: number;
    explorationModifier: number;
    budgetModifier: number;
    windowModifier: number;
    portfolioModifier: number;
    competitionModifier: number;
  };
  /** 各引擎的决策摘要 */
  decisions: {
    ev: EVAnalysis;
    exploration: ExplorationDecision;
    budget: BudgetDecision;
    window: OpportunityWindow;
    portfolio: KeywordRoleAssignment;
    competition: CompetitionProfile;
  };
  /** GTO综合推理说明 */
  reasoning: string;
}

export interface GTOBatchContext {
  /** 账户ID */
  accountId: number;
  /** 当前小时 */
  currentHour: number;
  /** 每日总预算 */
  totalDailyBudget: number;
  /** 探索池当日已花费 */
  ventureSpentToday: number;
  /** 探索池当日销售 */
  ventureSalesToday: number;
  /** 历史脉冲记录 */
  pulseHistory: Map<number, number>;
  /** 历史小时信号 */
  hourlySignals: HourlySignal[];
  /** 核心池ROAS */
  corePoolRoas: number;
  /** 目标ROAS */
  targetRoas: number;
  /** 历史探索总数 */
  totalExploredKeywords: number;
  /** 历史毕业数 */
  graduatedKeywords: number;
}

// ==================== 常量配置 ====================

/** 各引擎权重 */
const ENGINE_WEIGHTS = {
  ev: 0.25,           // EV引擎权重最高 — 直接影响盈亏
  exploration: 0.15,  // 探索引擎 — 关键词生命周期管理
  budget: 0.15,       // 预算引擎 — 资金安全
  window: 0.15,       // 窗口引擎 — 时机把握
  portfolio: 0.15,    // 组合引擎 — 结构平衡
  competition: 0.15,  // 竞争引擎 — 环境适应
};

/** GTO修正安全边界 */
const GTO_MIN_MODIFIER = 0.60;  // 最大降低40%
const GTO_MAX_MODIFIER = 1.40;  // 最大提升40%

// ==================== 核心编排 ====================

/**
 * 为单个关键词计算GTO综合修正系数
 */
export function calculateGTOModifier(
  target: OptimizationTarget,
  groupConfig: PerformanceGroupConfig,
  context: GTOBatchContext,
  portfolioAnalysis: PortfolioAnalysis,
  competitionProfile: CompetitionProfile
): GTOModifier {
  
  // ===== 1. EV引擎 =====
  const evAnalysis = calculateEV(target, groupConfig);
  let evModifier = 1.0;
  if (evAnalysis.action === 'raise') {
    evModifier = Math.min(1.25, evAnalysis.suggestedBid / Math.max(0.02, target.currentBid));
  } else if (evAnalysis.action === 'fold') {
    evModifier = Math.max(0.65, evAnalysis.suggestedBid / Math.max(0.02, target.currentBid));
  }
  
  // ===== 2. 探索引擎 =====
  const pulseCount = context.pulseHistory.get(target.id) || 0;
  const explorationDecision = analyzeExploration(target, groupConfig, pulseCount);
  const explorationModifier = explorationDecision.pulseModifier;
  
  // ===== 3. 预算引擎 =====
  const ventureSuccessRate = calculateVentureSuccessRate(
    context.totalExploredKeywords, context.graduatedKeywords
  );
  const corePerformanceScore = calculateCorePerformanceScore(
    context.corePoolRoas, context.targetRoas
  );
  const poolAllocation = calculateBudgetPoolAllocation(
    context.totalDailyBudget,
    context.ventureSpentToday,
    context.ventureSalesToday,
    corePerformanceScore,
    ventureSuccessRate
  );
  const budgetDecision = assignBudgetPool(
    target, explorationDecision.classification, poolAllocation, 
    Math.max(1, Math.round(context.totalExploredKeywords * 0.3))
  );
  const budgetModifier = budgetDecision.isFrozen ? 0.60 : budgetDecision.budgetModifier;
  
  // ===== 4. 窗口引擎 =====
  const windowResult = detectOpportunityWindow(
    context.currentHour,
    target.clicks > 0 ? target.spend / target.clicks : target.currentBid,
    target.impressions,
    context.hourlySignals,
    competitionProfile
  );
  const windowModifier = windowResult.isOpen ? windowResult.strikeModifier : 1.0;
  
  // ===== 5. 组合引擎 =====
  const roleAssignment = assignKeywordRole(target, groupConfig, portfolioAnalysis);
  const portfolioModifier = roleAssignment.portfolioModifier;
  
  // ===== 6. 竞争引擎 =====
  const competitionModifier = competitionProfile.bidStrategyModifier;
  
  // ===== 综合修正系数 =====
  const weightedSum = 
    ENGINE_WEIGHTS.ev * evModifier +
    ENGINE_WEIGHTS.exploration * explorationModifier +
    ENGINE_WEIGHTS.budget * budgetModifier +
    ENGINE_WEIGHTS.window * windowModifier +
    ENGINE_WEIGHTS.portfolio * portfolioModifier +
    ENGINE_WEIGHTS.competition * competitionModifier;
  
  // 安全边界
  const compositeModifier = Math.max(GTO_MIN_MODIFIER, Math.min(GTO_MAX_MODIFIER, weightedSum));
  
  const reasoning = `GTO修正=${compositeModifier.toFixed(3)} ` +
    `[EV:${evModifier.toFixed(2)}(${evAnalysis.action}) ` +
    `探索:${explorationModifier.toFixed(2)}(${explorationDecision.classification}) ` +
    `预算:${budgetModifier.toFixed(2)}(${budgetDecision.pool}) ` +
    `窗口:${windowModifier.toFixed(2)}(${windowResult.windowType}) ` +
    `组合:${portfolioModifier.toFixed(2)}(${roleAssignment.role}) ` +
    `竞争:${competitionModifier.toFixed(2)}(${competitionProfile.dominantCompetitorType})]`;
  
  return {
    compositeModifier,
    breakdown: {
      evModifier,
      explorationModifier,
      budgetModifier,
      windowModifier,
      portfolioModifier,
      competitionModifier,
    },
    decisions: {
      ev: evAnalysis,
      exploration: explorationDecision,
      budget: budgetDecision,
      window: windowResult,
      portfolio: roleAssignment,
      competition: competitionProfile,
    },
    reasoning,
  };
}

/**
 * 批量计算GTO修正系数
 * 
 * 先进行组合级别的分析（组合平衡器、预算分池），
 * 然后为每个关键词计算个体修正系数
 */
export function batchCalculateGTOModifiers(
  targets: OptimizationTarget[],
  groupConfig: PerformanceGroupConfig,
  context: GTOBatchContext
): Map<number, GTOModifier> {
  const results = new Map<number, GTOModifier>();
  
  if (targets.length === 0) return results;
  
  // ===== 组合级别分析（一次性） =====
  const portfolioAnalysis = analyzePortfolio(targets, groupConfig);
  
  // ===== 竞争环境分析（基于组级别数据，同步内联版本） =====
  const groupCpc = targets.reduce((sum: any, t: any) => sum + (t.clicks > 0 ? t.spend / t.clicks : 0), 0) / Math.max(1, targets.length);
  const groupImpressions = targets.reduce((sum: any, t: any) => sum + t.impressions, 0);
  const competitionProfile = buildSyncCompetitionProfile(groupCpc, groupImpressions, context.currentHour);
  
  // ===== 逐个计算修正系数 =====
  for (const target of targets) {
    try {
      const modifier = calculateGTOModifier(
        target, groupConfig, context, portfolioAnalysis, competitionProfile
      );
      results.set(target.id, modifier);
    } catch (err: unknown) {
      log.warn(`[GTO] 计算修正系数失败(target=${target.id}): ${(err as Error).message}`);
      // 失败时返回中性修正
      results.set(target.id, buildNeutralModifier(target, competitionProfile));
    }
  }
  
  // 统计日志
  const modifiers = Array.from(results.values());
  const avgModifier = modifiers.reduce((s: any, m: any) => s + m.compositeModifier, 0) / Math.max(1, modifiers.length);
  const raises = modifiers.filter(m => m.compositeModifier > 1.05).length;
  const folds = modifiers.filter(m => m.compositeModifier < 0.95).length;
  const holds = modifiers.length - raises - folds;
  
  log.info(`[GTO] 批量修正完成: ${targets.length}个目标, ` +
    `平均修正=${avgModifier.toFixed(3)}, 加注=${raises}, 弃牌=${folds}, 维持=${holds}, ` +
    `组合健康度=${portfolioAnalysis.portfolioHealthScore}/100`);
  
  if (portfolioAnalysis.imbalanceWarnings.length > 0) {
    log.warn(`[GTO] 组合失衡警告: ${portfolioAnalysis.imbalanceWarnings.join('; ')}`);
  }
  
  return results;
}

/**
 * 构建中性修正（GTO计算失败时的兜底）
 */
function buildNeutralModifier(target: OptimizationTarget, competition: CompetitionProfile): GTOModifier {
  const neutralEV: EVAnalysis = {
    expectedValue: 0, evPerClick: 0, evOptimalBid: target.currentBid,
    breakEvenBid: target.currentBid, bidEfficiency: 1.0, impliedOddsPremium: 0,
    action: 'call', suggestedBid: target.currentBid, confidence: 0.1,
    reasoning: 'GTO计算失败，使用中性修正',
  };
  const neutralExploration: ExplorationDecision = {
    classification: 'cold_start', shouldPulse: false, pulseModifier: 1.0,
    explorationBudgetShare: 0, remainingPulses: 0, phase: 'probe',
    suggestedBid: target.currentBid, confidence: 0.1, reasoning: '中性修正',
  };
  const neutralBudget: BudgetDecision = {
    pool: 'core', budgetCap: 0, budgetModifier: 1.0, isFrozen: false, reasoning: '中性修正',
  };
  const neutralWindow: OpportunityWindow = {
    isOpen: false, windowType: 'none', strikeModifier: 1.0,
    estimatedDurationHours: 0, confidence: 0, reasoning: '中性修正',
  };
  const neutralPortfolio: KeywordRoleAssignment = {
    keywordId: target.id, role: 'new_explorer', roleConfidence: 0.1,
    portfolioModifier: 1.0, reasoning: '中性修正',
  };
  
  return {
    compositeModifier: 1.0,
    breakdown: {
      evModifier: 1.0, explorationModifier: 1.0, budgetModifier: 1.0,
      windowModifier: 1.0, portfolioModifier: 1.0, competitionModifier: 1.0,
    },
    decisions: {
      ev: neutralEV, exploration: neutralExploration, budget: neutralBudget,
      window: neutralWindow, portfolio: neutralPortfolio, competition: competition,
    },
    reasoning: 'GTO计算失败，使用中性修正(1.0)',
  };
}

/**
 * 同步版本的竞争环境分析（不依赖数据库查询）
 * 基于当前批次的CPC和曝光量推断竞争环境
 */
function buildSyncCompetitionProfile(
  avgCpc: number,
  totalImpressions: number,
  currentHour: number
): CompetitionProfile {
  // 基于CPC和曝光量推断竞争类型
  let dominantType: CompetitorType = 'unknown';
  let bidModifier = 1.0;
  let reasoning = '';
  
  if (avgCpc > 2.0 && totalImpressions > 10000) {
    // 高CPC + 高曝光 = 疯狂型竞争（多个竞争者激进出价）
    dominantType = 'maniac';
    bidModifier = 0.90; // 面对疯狂型，适度收缩
    reasoning = `高CPC($${avgCpc.toFixed(2)})+高曝光(${totalImpressions}): 疯狂型竞争环境，收缩10%`;
  } else if (avgCpc > 1.5 && totalImpressions < 5000) {
    // 高CPC + 低曝光 = 紧缩型竞争（少数竞争者占据位置）
    dominantType = 'nit';
    bidModifier = 1.05; // 面对紧缩型，小幅加压
    reasoning = `高CPC($${avgCpc.toFixed(2)})+低曝光(${totalImpressions}): 紧缩型竞争，加压5%`;
  } else if (avgCpc < 0.5 && totalImpressions > 10000) {
    // 低CPC + 高曝光 = 跟注站型（竞争者被动出价）
    dominantType = 'calling_station';
    bidModifier = 1.10; // 面对被动型，积极扩张
    reasoning = `低CPC($${avgCpc.toFixed(2)})+高曝光(${totalImpressions}): 被动型竞争，扩张10%`;
  } else {
    dominantType = 'unknown';
    bidModifier = 1.0;
    reasoning = `CPC=$${avgCpc.toFixed(2)}, 曝光=${totalImpressions}: 竞争环境中性`;
  }
  
  // 时段修正：非高峰时段竞争通常较低
  const isPeakHour = (currentHour >= 8 && currentHour <= 12) || (currentHour >= 19 && currentHour <= 23);
  if (!isPeakHour) {
    bidModifier *= 1.03; // 非高峰时段微幅提升
    reasoning += ' | 非高峰时段+3%';
  }
  
  return {
    dominantCompetitorType: dominantType,
    competitionIntensity: avgCpc > 1.5 ? 0.8 : avgCpc > 0.8 ? 0.5 : 0.2,
    cpcVolatility: 0.3, // 默认中等波动
    impressionConcentration: 0.5, // 默认中等集中度
    weakCompetitionHours: [2, 3, 4, 5, 6], // 默认凌晨为低竞争时段
    peakCompetitionHours: [10, 11, 20, 21], // 默认上午和晚间为高竞争
    bidStrategyModifier: Math.round(bidModifier * 100) / 100,
    confidence: 0.4, // 同步版本置信度较低
    reasoning,
  };
}
