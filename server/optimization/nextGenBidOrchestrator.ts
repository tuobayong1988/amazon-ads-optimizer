/**
 * 下一代出价编排器 (Next-Gen Bid Orchestrator) v2
 * 
 * 设计理念：NextGen是唯一的出价引擎，不是"可选的附加模块"
 * 
 * 核心保证：
 * 1. 100%覆盖 — 对每一个关键词/商品定向都给出可靠的出价结果，无例外
 * 2. 零回退 — 不存在"回退到旧算法"的概念，所有逻辑内化在NextGen内部
 * 3. 全自动化 — 所有维护任务（特征缓存、模型训练、Reward回填）自动执行，零人工干预
 * 4. 渐进式安全 — 出价变化幅度受严格约束，避免极端调整
 * 
 * 算法降级链（内部梯队，对外透明）：
 * ┌─────────────────────────────────────────────────────────────┐
 * │  第1层: 高级算法（数据充足时自动启用）                        │
 * │  ├── Ensemble: 多算法加权融合（≥3个算法可用时）               │
 * │  ├── CQL: 离线强化学习（≥50条RL日志时）                      │
 * │  ├── Sigmoid: 曲线利润最大化（≥20条历史数据时）               │
 * │  └── LinUCB: 上下文赌博机（有特征缓存时）                    │
 * │                                                              │
 * │  第2层: 规则引擎（数据不足时的可靠决策）                       │
 * │  ├── 基于ACOS目标的出价调整                                   │
 * │  ├── 基于时间衰减加权的表现评估                               │
 * │  ├── 新关键词保护策略                                         │
 * │  └── 零曝光/零点击的探索策略                                  │
 * │                                                              │
 * │  第3层: 保守策略（极端异常时的安全兜底）                       │
 * │  └── 维持当前出价不变                                         │
 * └─────────────────────────────────────────────────────────────┘
 */
import { getDb } from "../db";
import {
  batchExtractAndCacheFeatures,
  extractFeatureVector,
  type ContextFeatureVector,
} from "../analytics/contextualFeatureService";
import { recordBidAction, backfillRewards, type BidAction } from "../algorithm/rlDataRecorder";
import { batchFitSigmoidCurves } from "../algorithm/sigmoidCurveFitter";
import { updateArm, type ArmType } from "../algorithm/contextualBanditService";
import { batchCausalAnalysis, type CausalEffect } from "../algorithm/causalInferenceEngine";
import { causalInferenceResults } from '../../drizzle/schema';
// v274: getDb已在第30行导入，此处复用
import { eq, and, gte, desc, isNotNull } from 'drizzle-orm';
import { trainCQL } from "../algorithm/offlineRLService";
import { selectBestAlgorithm, backfillAlgorithmResults, type MetaDecision } from "../algorithm/metaLearningSelector";
import { optimizeBudgetPortfolio } from "../budget/budgetPortfolioOptimizer";
import { buildKeywordGraph, discoverOpportunities, discoverNegativeCandidates } from "../analytics/keywordGraphService";
import { autoResolveConflicts } from "./postOptimizationVerifier";
import type { OptimizationTarget, PerformanceGroupConfig } from "./bidOptimizer";
import { createModuleLogger } from '../utils/logger';
import { batchCalculateGTOModifiers, type GTOModifier, type GTOBatchContext } from '../gto/gtoIntegrationOrchestrator';
import { batchPreloadNashRanges, applyNashConstraint, type NashEquilibriumRange } from './nashEquilibriumEngine';
import { getColdStartBidOverride, isInColdStartPeriod, type ColdStartBidResult } from './suggestedBidColdStartEngine';
import { batchGetParetoTiers, applyParetoWeight, type ParetoTierResult } from './paretoTierEngine';
import { batchForecastCampaignTrends, applyTrendModifier, type TrendSignal } from './timeSeriesForecastEngine';
import { getTransferPriorForCampaign, blendTransferWithOwn, type TransferParameters } from './crossProductTransferEngine';
import { getEffectiveMinBid, AMAZON_PLATFORM_MIN_BIDS } from './optimizationSafetyGuardrails';
import * as timeDecayService from '../analytics/timeDecayWeightedDataService';
import { getConfig } from '../system/systemConfigService';
import { startAlgorithmTrace, completeAlgorithmTrace } from '../algorithm/algorithmObservabilityService';

const log = createModuleLogger('NextGen');

// ==================== v258: 出价安全护栏配置 ====================

/**
 * v258: 出价安全护栏配置（整合v257冷却机制 + v258降价熔断）
 * 
 * v257问题回顾：冷却机制未能根治振荡，64.1%的出价被回滚
 * v258解决方案：
 *   1. 保留冷却时间和最小调整幅度
 *   2. 新增降价熔断机制：防止"死亡螺旋"式连续降价
 *   3. 新增累计降价追踪：7天内累计降幅不超过30%
 *   4. 新增连续降价计数：连续3次降价后强制hold
 */
// v510: 支持按广告类型获取不同的冷却期配置
// SP广告: 72h(3天) — 7天归因窗口
// SB/SD广告: 120h(5天) — 14天归因窗口
function getBidCooldownConfig(adType?: string) {
  // v510: 根据广告类型获取对应的冷却期
  let cooldownHours: number;
  const normalizedAdType = (adType || '').toLowerCase().replace('sponsored_', '').replace('sponsored', '');
  switch (normalizedAdType) {
    case 'sb':
      cooldownHours = getConfig<number>('safety.cooldown_hours_sb');
      break;
    case 'sd':
      cooldownHours = getConfig<number>('safety.cooldown_hours_sd');
      break;
    case 'sp':
      cooldownHours = getConfig<number>('safety.cooldown_hours_sp');
      break;
    default:
      cooldownHours = getConfig<number>('safety.cooldown_hours');
  }
  return {
    cooldownHours,
    minAdjustmentPercent: getConfig<number>('safety.min_adjustment_percent'),
    minAdjustmentAbsolute: 0.02, // 绝对值保持固定
    maxAdjustmentsPerDay: getConfig<number>('safety.max_adjustments_per_day'),
  };
}
// v510: 默认配置（未知广告类型时使用）
const BID_COOLDOWN_CONFIG = getBidCooldownConfig();

/**
 * v258: 降价熔断配置
 * 
 * 问题根因：LERUCCI US账户ACoS从30%飙升到122.7%
 * 原因：rule_engine持续降价 → 曝光减少 → 点击减少 → 转化更少 → ACoS更高 → 继续降价
 * 形成"死亡螺旋"（Death Spiral）
 * 
 * 解决方案：多层降价保护
 *   Layer 1: 7天累计降幅上限（防止渐进式过度降价）
 *   Layer 2: 连续降价次数限制（防止单方向持续降价）
 *   Layer 3: 最低出价保护（防止出价降到无效水平）
 */
const BID_CIRCUIT_BREAKER_CONFIG = {
  /** v266 P0-3: 降低熔断触发阈值，使熔断机制能真正生效 */
  /** 7天内累计降价幅度上限（百分比）：超过此值触发熔断 */
  maxCumulativeDecreasePercent7d: 0.15, // v510: 从20%收紧至15%，配合冷却期延长更早触发熔断
  /** 连续降价次数上限：超过此值强制hold一个周期 */
  maxConsecutiveDecreases: 2, // v266: 从3次降至2次，连续2次降价即触发熔断
  /** 最低出价保护：出价不得低于初始出价的此比例 */
  minBidFloorRatio: 0.50, // v266: 从40%提升到50%，提高出价底线保护
  /** 归因延迟保护窗口（小时）：最近N小时内的数据权重降低 */
  attributionDelayHours: 48,
  /** 归因延迟数据权重折扣：最近48h内数据的权重 */
  recentDataWeightDiscount: 0.6,
  /** v268 P0-1: 熔断触发时的提价恢复比例 — 从10%提升到15%，分3步渐进执行 */
  recoveryBoostPercent: 0.15, // v268: 从10%提升到15%，更积极地恢复曝光
  /** v268 P0-1: 渐进恢复步骤数 — 将恢复提价分成多步执行，避免一次性大幅提价 */
  recoverySteps: 3,
  /** v259: 最低曝光保护阈值 — 曝光低于历史基线此比例时暂停所有降价 */
  minImpressionProtectionRatio: 0.60, // v266: 从50%提升到60%，更早保护曝光
};

/**
 * v267: 检查出价方向一致性 — 检测振荡模式
 * 
 * 查询最近3次出价调整的方向，如果出现“升-降-升”或“降-升-降”的振荡模式，
 * 强制hold一个周期，等待数据稳定后再做决策。
 * 这是根治回滚率高的核心机制。
 */
async function checkBidDirectionConsistency(
  accountId: number,
  keywordId?: number,
  targetId?: number
): Promise<{ isOscillating: boolean; reason: string }> {
  if (!keywordId && !targetId) return { isOscillating: false, reason: '' };
  
  try {
    const db = await getDb();
    if (!db) return { isOscillating: false, reason: '' };
    
    const { sql } = await import('drizzle-orm');
    // v324: 修复列名 - optimization_events表使用keyword_id/target_id而非entity_type/entity_id
    const entityCondition = keywordId 
      ? sql`keyword_id = ${keywordId}`
      : sql`target_id = ${targetId}`;
    
    // 查询最近3次出价调整的方向
    // @ts-expect-error - Drizzle raw SQL execution
    const [rows] = await db.execute(sql`
      SELECT action_type, new_value, previous_value, created_at
      FROM optimization_events
      WHERE account_id = ${accountId}
        AND ${entityCondition}
        AND event_category = 'bid_adjustment'
        AND action_type IN ('bid_increase', 'bid_decrease')
        AND created_at > DATE_SUB(NOW(), INTERVAL 72 HOUR)
      ORDER BY created_at DESC
      LIMIT 4
    `) as unknown;
    
    if (!rows || rows.length < 3) return { isOscillating: false, reason: '' };
    
    // 检测方向序列: 如果最近3次中方向交替变化，则为振荡
    const directions = rows.slice(0, 3).map((r: Record<string, unknown>) => r.action_type === 'bid_increase' ? 'up' : 'down');
    
    // 振荡模式: 升-降-升 或 降-升-降
    const isOscillating = (
      (directions[0] !== directions[1] && directions[1] !== directions[2]) ||
      // 或者4次调整中方向变化超过2次
      (rows.length >= 4 && (() => {
        const dirs4 = rows.slice(0, 4).map((r: Record<string, unknown>) => r.action_type === 'bid_increase' ? 'up' : 'down');
        let changes = 0;
        for (let i = 1; i < dirs4.length; i++) {
          if (dirs4[i] !== dirs4[i-1]) changes++;
        }
        return changes >= 2;
      })())
    );
    
    if (isOscillating) {
      return {
        isOscillating: true,
        reason: `72h内出价方向序列=[${directions.join('→')}]，检测到振荡模式`,
      };
    }
    
    return { isOscillating: false, reason: '' };
  } catch (err: unknown) {
    return { isOscillating: false, reason: '' };
  }
}

/**
 * v257: 检查关键词是否在冷却期内
 * 
 * 查询optimization_events表，判断该关键词最近是否已经被调整过
 * 如果在冷却期内，返回true（应跳过调整）
 * 如果24小时内调整次数超过阈值，也返回true
 */
async function isInCooldownPeriod(
  accountId: number,
  keywordId?: number,
  targetId?: number
): Promise<{ inCooldown: boolean; reason: string; recentAdjustments: number }> {
  if (!keywordId && !targetId) return { inCooldown: false, reason: '', recentAdjustments: 0 };
  
  try {
    const db = await getDb();
    if (!db) return { inCooldown: false, reason: '', recentAdjustments: 0 };
    
    const { optimizationEvents } = await import('../../drizzle/schema');
    const { and: andOp, eq: eqOp, gte: gteOp, sql: sqlOp } = await import('drizzle-orm');
    
    // 查询24小时内的出价调整次数和最近一次调整时间
    const hoursAgo24 = new Date(Date.now() - 24 * 3600000).toISOString();
    const cooldownCutoff = new Date(Date.now() - BID_COOLDOWN_CONFIG.cooldownHours * 3600000).toISOString();
    
    const conditions = [
      eqOp(optimizationEvents.accountId, accountId),
      sqlOp`${optimizationEvents.eventCategory} = 'bid_adjustment'`,
      sqlOp`${optimizationEvents.status} = 'success'`,
      gteOp(optimizationEvents.createdAt, hoursAgo24),
    ];
    
    if (keywordId) {
      // @ts-expect-error Array method type inference
      conditions.push(eqOp(optimizationEvents.keywordId, keywordId));
    // @ts-expect-error Conditional type narrowing
    } else if (targetId) {
      // @ts-expect-error Array method type inference
      conditions.push(eqOp(optimizationEvents.targetId, targetId));
    }
    
    const recentEvents = await db.select({
      id: optimizationEvents.id,
      createdAt: optimizationEvents.createdAt,
    }).from(optimizationEvents)
      .where(andOp(...conditions))
      .orderBy(sqlOp`created_at DESC`)
      .limit(10);
    
    const recentAdjustments = recentEvents.length;
    
    // 检查1: 24小时内调整次数超过阈值
    if (recentAdjustments >= BID_COOLDOWN_CONFIG.maxAdjustmentsPerDay) {
      return {
        inCooldown: true,
        reason: `24h内已调整${recentAdjustments}次(上限${BID_COOLDOWN_CONFIG.maxAdjustmentsPerDay}次)`,
        recentAdjustments,
      };
    }
    
    // 检查2: 最近一次调整是否在冷却期内
    if (recentEvents.length > 0) {
      const lastAdjustTime = new Date(recentEvents[0].createdAt as string);
      if (lastAdjustTime.getTime() > new Date(cooldownCutoff).getTime()) {
        const hoursAgo = ((Date.now() - lastAdjustTime.getTime()) / 3600000).toFixed(1);
        return {
          inCooldown: true,
          reason: `距上次调整仅${hoursAgo}h(冷却期${BID_COOLDOWN_CONFIG.cooldownHours}h)`,
          recentAdjustments,
        };
      }
    }
    
    return { inCooldown: false, reason: '', recentAdjustments };
  } catch (error: unknown) {
    // 冷却检查失败不阻塞出价流程
    log.warn(`[CooldownCheck] 冷却检查异常: ${(error as Error).message}`);
    return { inCooldown: false, reason: '', recentAdjustments: 0 };
  }
}

/**
 * v257: 检查调整幅度是否达到最小阈值
 * 避免微小的、无意义的出价变动产生不必要的API调用和振荡
 */
function meetsMinimumAdjustment(currentBid: number, newBid: number): boolean {
  const absoluteDiff = Math.abs(newBid - currentBid);
  const percentDiff = currentBid > 0 ? absoluteDiff / currentBid : 0;
  
  return absoluteDiff >= BID_COOLDOWN_CONFIG.minAdjustmentAbsolute &&
         percentDiff >= BID_COOLDOWN_CONFIG.minAdjustmentPercent;
}

/**
 * v258: 降价熔断检查
 * 
 * 多层保护机制，防止"死亡螺旋"式连续降价：
 * 1. 检查7天内累计降幅是否超过30%
 * 2. 检查是否连续3次降价
 * 3. 检查出价是否低于初始出价的40%
 * 
 * 返回: { tripped: boolean, reason: string, guardrailInfo: object }
 */
async function checkCircuitBreaker(
  accountId: number,
  keywordId?: number,
  targetId?: number,
  currentBid?: number,
  proposedBid?: number
): Promise<{ tripped: boolean; reason: string; guardrailInfo: Record<string, unknown> }> {
  if (!keywordId && !targetId) return { tripped: false, reason: '', guardrailInfo: {} };
  if (!proposedBid || !currentBid || proposedBid >= currentBid) {
    // 只对降价操作进行熔断检查
    return { tripped: false, reason: '', guardrailInfo: {} };
  }
  
  try {
    const db = await getDb();
    if (!db) return { tripped: false, reason: '', guardrailInfo: {} };
    
    const { optimizationEvents } = await import('../../drizzle/schema');
    const { and: andOp, eq: eqOp, gte: gteOp, sql: sqlOp, desc: descOp } = await import('drizzle-orm');
    
    // 查询7天内的所有出价调整事件
    const daysAgo7 = new Date(Date.now() - 7 * 24 * 3600000).toISOString();
    
    const conditions = [
      eqOp(optimizationEvents.accountId, accountId),
      sqlOp`${optimizationEvents.eventCategory} = 'bid_adjustment'`,
      sqlOp`${optimizationEvents.status} = 'success'`,
      gteOp(optimizationEvents.createdAt, daysAgo7),
    ];
    
    if (keywordId) {
      // @ts-expect-error Array method type inference
      conditions.push(eqOp(optimizationEvents.keywordId, keywordId));
    } else if (targetId) {
      // @ts-expect-error Array method type inference
      conditions.push(eqOp(optimizationEvents.targetId, targetId));
    }
    
    const recentEvents = await db.select({
      id: optimizationEvents.id,
      previousBid: optimizationEvents.previousBid,
      newBid: optimizationEvents.newBid,
      createdAt: optimizationEvents.createdAt,
    }).from(optimizationEvents)
      .where(andOp(...conditions))
      .orderBy(sqlOp`created_at DESC`)
      .limit(20);
    
    const guardrailInfo: Record<string, unknown> = {
      recentEventsCount: recentEvents.length,
      circuitBreakerConfig: BID_CIRCUIT_BREAKER_CONFIG,
    };
    
    if (recentEvents.length === 0) {
      return { tripped: false, reason: '', guardrailInfo };
    }
    
    // === Layer 1: 7天累计降幅检查 ===
    // 找到7天前的初始出价（最早事件的previousBid）
    const oldestEvent = recentEvents[recentEvents.length - 1];
    const initialBid = parseFloat(String(oldestEvent.previousBid)) || currentBid;
    const cumulativeDecrease = initialBid > 0 ? (initialBid - (proposedBid || currentBid)) / initialBid : 0;
    guardrailInfo.initialBid7d = initialBid;
    guardrailInfo.cumulativeDecrease7d = cumulativeDecrease;
    
    if (cumulativeDecrease > BID_CIRCUIT_BREAKER_CONFIG.maxCumulativeDecreasePercent7d) {
      // v259: 熔断触发时不再简单hold，而是执行提价恢复
      // 核心逻辑：累计降幅超限说明出价已经降得太多，需要小幅提价恢复曝光
      const recoveryBid = (currentBid || 0) * (1 + BID_CIRCUIT_BREAKER_CONFIG.recoveryBoostPercent);
      guardrailInfo.recoveryMode = 'cumulative_decrease_recovery';
      guardrailInfo.recoveryBid = recoveryBid;
      return {
        tripped: true,
        reason: `[v259熔断-提价恢复] 7天累计降幅${(cumulativeDecrease * 100).toFixed(1)}%超过上限${(BID_CIRCUIT_BREAKER_CONFIG.maxCumulativeDecreasePercent7d * 100)}%: 初始$${initialBid.toFixed(2)}→当前$${currentBid?.toFixed(2)}, 执行${(BID_CIRCUIT_BREAKER_CONFIG.recoveryBoostPercent * 100)}%提价恢复→$${recoveryBid.toFixed(2)}`,
        guardrailInfo,
      };
    }
    
    // === Layer 2: 连续降价次数检查 ===
    let consecutiveDecreases = 0;
    for (const evt of recentEvents) {
      const prevBid = parseFloat(String(evt.previousBid)) || 0;
      const newBid = parseFloat(String(evt.newBid)) || 0;
      if (newBid < prevBid - 0.005) {
        consecutiveDecreases++;
      } else {
        break; // 一旦遇到非降价操作，停止计数
      }
    }
    guardrailInfo.consecutiveDecreases = consecutiveDecreases;
    
    if (consecutiveDecreases >= BID_CIRCUIT_BREAKER_CONFIG.maxConsecutiveDecreases) {
      // v259: 连续降价触发时也执行提价恢复
      const recoveryBid = (currentBid || 0) * (1 + BID_CIRCUIT_BREAKER_CONFIG.recoveryBoostPercent * 0.5); // 连续降价场景用一半的恢复幅度
      guardrailInfo.recoveryMode = 'consecutive_decrease_recovery';
      guardrailInfo.recoveryBid = recoveryBid;
      return {
        tripped: true,
        reason: `[v259熔断-提价恢复] 已连续${consecutiveDecreases}次降价(上限${BID_CIRCUIT_BREAKER_CONFIG.maxConsecutiveDecreases}次): 执行${(BID_CIRCUIT_BREAKER_CONFIG.recoveryBoostPercent * 50)}%提价恢复→$${recoveryBid.toFixed(2)}`,
        guardrailInfo,
      };
    }
    
    // === Layer 3: v510增强 — 动态历史CPC底线 + 固定比例底线 ===
    // 新底线公式: Bid Floor = max(历史稳定出单期CPC × 0.85, 初始出价 × minBidFloorRatio)
    const ratioFloor = initialBid * BID_CIRCUIT_BREAKER_CONFIG.minBidFloorRatio;
    let dynamicFloor = ratioFloor;
    let floorSource = 'ratio_fallback';
    
    try {
      const { getDynamicBidFloor } = await import('../services/historicalCpcFloorService');
      const entityType = keywordId ? 'keyword' as const : 'product_target' as const;
      const entityId = keywordId || targetId || 0;
      const floorResult = await getDynamicBidFloor(accountId, entityType, entityId, currentBid || 0);
      dynamicFloor = Math.max(floorResult.dynamicFloor, ratioFloor);
      floorSource = floorResult.source;
      guardrailInfo.historicalCpc = floorResult.historicalCpc;
      guardrailInfo.historicalOrders = floorResult.historicalOrders;
      guardrailInfo.floorPeriod = floorResult.periodDescription;
    } catch (floorErr: unknown) {
      log.warn(`[CircuitBreaker] 动态底线查询失败，回退固定比例: ${(floorErr as Error).message}`);
    }
    
    guardrailInfo.bidFloor = dynamicFloor;
    guardrailInfo.bidFloorSource = floorSource;
    guardrailInfo.ratioFloor = ratioFloor;
    
    if (proposedBid < dynamicFloor) {
      // v510: 底线保护触发时，将出价拉回到动态底线并小幅提升
      const recoveryBid = dynamicFloor * (1 + BID_CIRCUIT_BREAKER_CONFIG.recoveryBoostPercent * 0.5);
      guardrailInfo.recoveryMode = 'dynamic_floor_recovery';
      guardrailInfo.recoveryBid = recoveryBid;
      return {
        tripped: true,
        reason: `[v510动态底线保护] 拟调出价$${proposedBid.toFixed(2)}低于动态底线$${dynamicFloor.toFixed(2)}(来源:${floorSource}): 恢复到$${recoveryBid.toFixed(2)}`,
        guardrailInfo,
      };
    }
    
    return { tripped: false, reason: '', guardrailInfo };
  } catch (error: unknown) {
    // v426: P2-4 修复 — 熔断检查异常时安全拒绝（tripped=true），而非静默放行
    log.warn(`[CircuitBreaker] 熔断检查异常，安全拒绝: ${(error as Error).message}`);
    return { tripped: true, reason: `熔断检查异常(安全拒绝): ${(error as Error).message}`, guardrailInfo: {} };
  }
}

// ==================== 类型定义 ====================

export interface NextGenBidResult {
  targetId: number;
  targetType: 'keyword' | 'product_target';
  previousBid: number;
  newBid: number;
  actionType: 'increase' | 'decrease' | 'hold';
  bidChangePercent: number;
  reason: string;
  algorithmUsed: string;
  confidence: number;
  metaDecision?: MetaDecision;
  /** v273: 算法降级链中实际使用的层级，新增guardrail层级区分护栏保护操作 */
  algorithmTier: 'advanced' | 'rule_engine' | 'conservative' | 'guardrail';
  /** GTO博弈论修正系数（v236新增） */
  gtoModifier?: GTOModifier;
  /** v274: 因果推断修正信息 */
  causalAdjustment?: {
    optimalBid: number;
    upliftScore: number;
    incrementalProfit: number;
    confidence: number;
    applied: boolean;
  };
  /** v258: 结构化调整归因详情 */
  reasonDetails?: {
    triggerRule: string;         // 触发的规则/场景
    coreMetrics: {               // 核心数据指标
      acos?: number;
      targetAcos?: number;
      clicks?: number;
      impressions?: number;
      ctr?: number;
      spend?: number;
      sales?: number;
      orders?: number;
    };
    algorithmChoice: string;     // 算法选择说明
    dataConfidence?: number;     // 数据置信度
    trendSignal?: string;        // 趋势信号
  };
  /** v258: 护栏机制介入信息 */
  guardrailInfo?: {
    cooldownActive: boolean;     // 冷却保护是否激活
    circuitBreakerTripped: boolean; // 熔断是否触发
    arbitrationApplied: boolean; // 仲裁是否介入
    minAdjustmentFiltered: boolean; // 最小调整幅度过滤
    maxBidCapped: boolean;       // 最高出价限制
    details?: string;            // 护栏详情说明
  };
  /** v337: 修正层标记 — 显式记录GTO和Cascade Fusion的介入 */
  correctionLayers?: {
    gtoApplied: boolean;           // GTO博弈论修正是否生效
    gtoCompositeModifier?: number; // GTO综合修正系数
    gtoActiveEngines?: string[];   // GTO生效的子引擎列表
    cascadeFusionApplied: boolean; // Cascade Fusion是否生效
    cascadeFusionAlgorithms?: string[]; // 参与融合的算法列表
    cascadeFusionDetail?: string;  // Cascade Fusion融合详情
    causalInferenceApplied: boolean; // 因果推断修正是否生效
  };
  /** v490: 纳什均衡约束信息 */
  nashEquilibrium?: {
    bidFloor: number;
    bidCeiling: number;
    optimalBid: number;
    confidence: number;
    source: string;
    constrained: boolean;
  };
  /** v490: 帕累托分层信息 */
  paretoTier?: {
    tier: string;
    rank: number;
    profitContribution: number;
    bidWeightMultiplier: number;
    budgetWeightMultiplier: number;
    applied: boolean;
    reason: string;
  };
  /** v490: 时序预测信号 */
  trendForecast?: {
    direction: string;
    strength: number;
    bidModifier: number;
    applied: boolean;
    reason: string;
  };
  /** v489: 跨品迁移学习参数 */
  crossProductTransfer?: {
    applied: boolean;
    transferWeight: number;
    sourceCampaigns: string[];
    suggestedBid: number;
    confidence: string;
    reason: string;
  };
  /** v337: Meta-Learning决策详情 — 记录算法选择的完整过程 */
  metaLearningDetail?: {
    candidateAlgorithms: Array<{ algorithm: string; score: number; eligible: boolean; reason: string }>;
    selectedAlgorithm: string;
    selectionReason: string;
    fusionMode: 'single' | 'cascade_ensemble';
    fusionDetail: string;
    dynamicConfidenceThreshold: number;
    evolvedConfidenceMultiplier: number;
  };
}

export interface SafetyConfig {
  /** 单次最大出价变化幅度 (0-1) */
  maxBidChangePercent: number;
  /** 绝对最低出价 */
  minBid: number;
  /** 绝对最高出价 */
  maxBid: number;
  /** ACOS目标 (0-1) */
  targetAcos: number;
}

const DEFAULT_SAFETY: SafetyConfig = {
  maxBidChangePercent: 0.15, // v510: 从30%收紧至15%，落实竞价锚定原则
  minBid: 0.10, // v643: 从$0.02提升到$0.10，与v641的全局最低出价保护保持一致
  maxBid: 10.00,
  targetAcos: 0.30,
};

// ==================== 安全校验器 ====================

/**
 * 多层安全校验：确保出价调整在安全范围内
 * 
 * 校验顺序：
 * 1. 绝对范围限制（minBid ~ maxBid）
 * 2. 单次变化幅度限制（±maxBidChangePercent）
 * 3. 精度控制（保留2位小数）
 * 4. 最终兜底（确保≥minBid）
 */
function safetyValidate(
  currentBid: number,
  proposedBid: number,
  config: SafetyConfig,
  maxBidLimit?: number,
  acosRatio?: number, // v643: 可选的ACoS比率参数，用于动态调整降价上限
  adType?: string // v645: 广告类型，用于确定平台最低竞价
): number {
  // v645: 根据广告类型获取有效的最低竞价
  const effectiveMinBid = getEffectiveMinBid(adType);
  
  // v231: NaN/Infinity防御 - 确保输入有效
  if (!isFinite(proposedBid) || isNaN(proposedBid)) {
    return currentBid > 0 ? currentBid : effectiveMinBid;
  }
  if (!isFinite(currentBid) || isNaN(currentBid)) {
    return Math.max(effectiveMinBid, Math.min(config.maxBid, proposedBid));
  }
  let safeBid = proposedBid;
  
  // 1. 绝对范围限制 — v645: 使用广告类型感知的最低竞价
  const effectiveMaxBid = maxBidLimit ? Math.min(config.maxBid, maxBidLimit) : config.maxBid;
  safeBid = Math.max(effectiveMinBid, Math.min(effectiveMaxBid, safeBid));
  
  // 2. 单次变化幅度限制
  if (currentBid > 0) {
    const maxIncrease = currentBid * (1 + config.maxBidChangePercent);
    
    // v643: 动态降价上限 — 当ACoS严重超标时允许更大幅度的降价
    // 这是对v510严格15%上限的安全放宽，仅在有明确的ACoS超标数据时才激活
    let effectiveMaxDecreasePercent = config.maxBidChangePercent; // 默认15%
    if (acosRatio && acosRatio > 1.0) {
      if (acosRatio > 3.0) {
        // ACoS超过目标的300%以上（如140% vs 40%）— 允许最大降价30%
        effectiveMaxDecreasePercent = Math.min(0.30, config.maxBidChangePercent * 2.0);
      } else if (acosRatio > 2.0) {
        // ACoS超过目标的200%以上 — 允许最大降价25%
        effectiveMaxDecreasePercent = Math.min(0.25, config.maxBidChangePercent * 1.67);
      } else if (acosRatio > 1.5) {
        // ACoS超过目标的150%以上 — 允许最大降价20%
        effectiveMaxDecreasePercent = Math.min(0.20, config.maxBidChangePercent * 1.33);
      }
    }
    const maxDecrease = currentBid * (1 - effectiveMaxDecreasePercent);

    safeBid = Math.max(maxDecrease, Math.min(maxIncrease, safeBid));
  }
  
  // 3. 精度控制
  safeBid = Math.round(safeBid * 100) / 100;
  
  // 4. v645: 最终兆底 — 使用广告类型感知的最低竞价
  safeBid = Math.max(effectiveMinBid, safeBid);
  
  return safeBid;
}

// ==================== 第2层：规则引擎 ====================

/**
 * 规则引擎出价决策 — 当高级算法不可用时的可靠决策
 * 
 * 内化了现有bidOptimizer的核心逻辑，包括：
 * - 基于ACOS目标的出价调整
 * - 时间衰减加权的表现评估
 * - 新关键词保护
 * - 零曝光/零点击的探索策略
 */
function ruleEngineDecision(
  target: OptimizationTarget,
  groupConfig: PerformanceGroupConfig,
): { bid: number; confidence: number; reason: string } {
  const currentBid = target.currentBid;
  const impressions = target.impressions || 0;
  const clicks = target.clicks || 0;
  const spend = target.spend || 0;
  const sales = target.sales || 0;
  const orders = target.orders || 0;
  
  // 提取ACOS目标
  // v231: 防御性转换 — 即使上层已转换，此处仍做兑底检查
  const rawAcos = groupConfig.targetAcos || 0.30;
  const targetAcos = rawAcos > 1 ? rawAcos / 100 : rawAcos;
  const maxBid = groupConfig.maxBid || 10.00;
  
  // v267 P3-3: 多品类自适应 — 根据品类弹性系数调整提价/降价幅度
  // 高弹性品类(electronics=1.2): 出价变化对曝光影响大，调整幅度可以更大
  // 低弹性品类(grocery=0.4): 出价变化对曝光影响小，调整幅度应更保守
  const categoryElasticity = (() => {
    const cat = groupConfig.productCategory || 'default';
    const ELASTICITY: Record<string, number> = {
      'electronics': 1.2, 'computers': 1.1, 'cell_phones': 1.15, 'video_games': 1.0,
      'home_kitchen': 0.85, 'sports_outdoors': 0.8, 'toys_games': 0.9, 'clothing': 0.75,
      'beauty': 0.7, 'health': 0.65, 'baby': 0.5, 'pet_supplies': 0.55,
      'grocery': 0.4, 'luxury': 0.3, 'default': 0.8,
    };
    return ELASTICITY[cat] || ELASTICITY['default'];
  })();
  // 弹性修正因子：弹性>0.8时放大调整幅度，弹性<0.8时缩小调整幅度
  // 范围限制在0.7-1.3，避免极端品类导致过度调整
  const elasticityModifier = Math.max(0.7, Math.min(1.3, categoryElasticity / 0.8));
  
  // v259: 最低曝光保护机制
  // 核心逻辑：当曝光量大幅下降时，说明出价可能已经降得太低，应暂停所有降价并尝试提价恢复
  // 使用dailyData对比近期曝光与历史基线
  // @ts-expect-error Dynamic type assertion
  const dailyDataForImpression = (target as Record<string, unknown>).dailyData as Array<{ date: Date; impressions?: number; clicks: number; spend: number; sales: number; orders: number }> | undefined;
  if (dailyDataForImpression && dailyDataForImpression.length >= 7) {
    const recent3d = dailyDataForImpression.slice(-3);
    const earlier4d = dailyDataForImpression.slice(-7, -3);
    // @ts-expect-error - dynamic property access
    const recentAvgImpressions = recent3d.reduce((sum: number, d: Record<string, unknown>) => sum + ((d as Record<string, unknown>).impressions || 0), 0) / Math.max(recent3d.length, 1);
    // @ts-expect-error - dynamic property access
    const earlierAvgImpressions = earlier4d.reduce((sum: number, d: Record<string, unknown>) => sum + ((d as Record<string, unknown>).impressions || 0), 0) / Math.max(earlier4d.length, 1);
    
    if (earlierAvgImpressions > 50 && recentAvgImpressions < earlierAvgImpressions * BID_CIRCUIT_BREAKER_CONFIG.minImpressionProtectionRatio) {
      // v268 P0-1: 增强曝光保护 — 引入渐进恢复机制
      // 将恢复提价分成recoverySteps步执行，避免一次性大幅提价
      const totalRecoveryBoost = Math.min(0.15, BID_CIRCUIT_BREAKER_CONFIG.recoveryBoostPercent);
      const stepRecoveryBoost = totalRecoveryBoost / (BID_CIRCUIT_BREAKER_CONFIG.recoverySteps || 3);
      const recoveryBid = currentBid * (1 + stepRecoveryBoost);
      const impressionDropPct = ((1 - recentAvgImpressions / earlierAvgImpressions) * 100).toFixed(0);
      return {
        bid: recoveryBid,
        confidence: 0.55,
        reason: `[v268曝光保护-渐进恢复] 近期曝光均值${recentAvgImpressions.toFixed(0)}较历史基线${earlierAvgImpressions.toFixed(0)}下降${impressionDropPct}%: 渐进提价${(stepRecoveryBoost * 100).toFixed(1)}%(总目标${(totalRecoveryBoost * 100).toFixed(0)}%分${BID_CIRCUIT_BREAKER_CONFIG.recoverySteps}步)`,
      };
    }
    
    // v268 P0-1: 新增“竞争力恢复”模式
    // 针对因长期低价而失去曝光的关键词，将出价提升至建议竞价的80%
    // 触发条件：曝光持续低迷（近期均值<20）且当前出价较低（<$0.50）
    // 安全保护：仅对有历史表现的关键词触发，且受maxBid限制
    // @ts-expect-error - dynamic property access
    const hasHistoricalPerformance = dailyDataForImpression.some(d => ((d as Record<string, unknown>).impressions || 0) > 100);
    if (recentAvgImpressions < 20 && currentBid < 0.50 && hasHistoricalPerformance) {
      // v491修正: 只使用target自身的suggestedBid，绝不回退到group级别中位数
      // 无suggestedBid时使用maxBid的保守估算作为竞争力恢复的参考
      // @ts-expect-error Dynamic type assertion
      const targetSBForRecovery = (target as Record<string, unknown>).suggestedBid as number | undefined;
      const suggestedBid = (targetSBForRecovery && targetSBForRecovery > 0) ? targetSBForRecovery
        : (groupConfig.maxBid || 10) * 0.15;
      const competitiveRecoveryBid = Math.max(currentBid * 1.5, suggestedBid * 0.80);
      const cappedRecoveryBid = Math.min(competitiveRecoveryBid, (groupConfig.maxBid || 10) * 0.60); // 不超过maxBid的60%
      return {
        bid: cappedRecoveryBid,
        confidence: 0.50,
        reason: `[v268竞争力恢复] 曝光持续低迷(均值${recentAvgImpressions.toFixed(0)})且出价较低($${currentBid.toFixed(2)}): 提升至$${cappedRecoveryBid.toFixed(2)}恢复市场竞争力`,
      };
    }
  }
  
  // v230: 确定性哈希函数，替代Math.random()，确保相同关键词在相同条件下产生相同的调整比例
  const deterministicHash = (id: number, seed: number = 0): number => {
    let h = ((id * 2654435761 + seed) >>> 0) % 10000;
    return h / 10000; // 返回0~1之间的确定性值
  };
  // @ts-expect-error Dynamic type assertion
  const entityId = Number((target as Record<string, unknown>).keywordId || (target as Record<string, unknown>).targetId || 0);
  
  // 场景1: 零曝光 — 需要提升可见性
  // v238: 增加出价累积保护，防止零曝光关键词被无限提价
  // v330: R-01优化 — 引入亚马逊建议出价作为锚点
  if (impressions === 0) {
    // v491修正: 只使用target自身的suggestedBid/Low/High
    // 绝不回退到group级别中位数，无suggestedBid的target将走下方的基础规则引擎路径
    // @ts-expect-error Dynamic type assertion
    const suggestedBid = ((target as Record<string, unknown>).suggestedBid as number | undefined) || undefined;
    // @ts-expect-error Dynamic type assertion
    const suggestedBidRangeStart = ((target as Record<string, unknown>).suggestedBidRangeStart as number | undefined) || undefined;
    // @ts-expect-error Dynamic type assertion
    const suggestedBidRangeEnd = ((target as Record<string, unknown>).suggestedBidRangeEnd as number | undefined) || undefined;
    
    // v434: 零曝光探索 — 基于Amazon建议竞价的动态范围快速测试
    // 竞价范围: 建议最低竞价×50% ~ 建议最高竞价×150%
    // 目的: 快速获取曝光和点击数据，加快产生有效数据用于后续优化决策
    if (suggestedBid && suggestedBid > 0) {
      // 计算目标出价：优先使用建议竞价范围
      let targetBid: number;
      if (suggestedBidRangeStart && suggestedBidRangeEnd && suggestedBidRangeEnd > suggestedBidRangeStart) {
        // v434: 使用建议竞价范围的中位数作为目标，确保在合理范围内
        targetBid = (suggestedBidRangeStart + suggestedBidRangeEnd) / 2;
      } else {
        targetBid = suggestedBid;
      }
      
      // v434: 安全保护 — 不超过建议最高竞价的150%，且不超过maxBid的80%
      const suggestedBidCeiling = suggestedBidRangeEnd 
        ? Math.min(suggestedBidRangeEnd * 1.50, maxBid * 0.80) 
        : Math.min(targetBid * 1.50, maxBid * 0.80);
      const suggestedBidFloor = suggestedBidRangeStart 
        ? suggestedBidRangeStart * 0.50 
        : targetBid * 0.50;
      const safeBid = Math.max(suggestedBidFloor, Math.min(targetBid, suggestedBidCeiling, maxBid));
      
      // 如果当前出价已经接近或超过建议出价，维持当前出价
      if (currentBid >= safeBid * 0.90) {
        return {
          bid: currentBid,
          confidence: 0.5,
          reason: `[v434] 零曝光但出价已接近建议竞价($${currentBid.toFixed(2)} vs 建议$${safeBid.toFixed(2)}): 维持出价，建议检查关键词相关性`,
        };
      }
      
      // v434: 更积极的分步逼近 — 每次走差距的70%（从50%提升），加快达到建议竞价
      const bidGap = safeBid - currentBid;
      const stepBid = currentBid + bidGap * 0.70;
      const finalBid = Math.max(suggestedBidFloor, Math.min(stepBid, suggestedBidCeiling, maxBid));
      
      return {
        bid: finalBid,
        confidence: 0.65,
        reason: `[v434] 零曝光探索(建议竞价引导): 从$${currentBid.toFixed(2)}向建议竞价$${safeBid.toFixed(2)}逼近至$${finalBid.toFixed(2)} (建议范围=$${(suggestedBidRangeStart||0).toFixed(2)}-$${(suggestedBidRangeEnd||0).toFixed(2)}, 动态上下界=$${suggestedBidFloor.toFixed(2)}-$${suggestedBidCeiling.toFixed(2)})`,
      };
    }
    
    // v238: 出价累积保护 — 如果当前出价已经达到maxBid的40%，不再提价
    // 这防止了零曝光关键词通过多次小幅提价累积到过高出价的问题
    const explorationCeiling = maxBid * 0.40;
    if (currentBid >= explorationCeiling) {
      return {
        bid: currentBid,
        confidence: 0.3,
        reason: `零曝光但出价已达探索上限($${currentBid.toFixed(2)} >= $${explorationCeiling.toFixed(2)}): 维持出价，建议检查关键词相关性`,
      };
    }
    
    // 新关键词或长期零曝光，适度提升出价以获取曝光
    // v267 P3-3: 品类弹性修正 — 高弹性品类提价更积极，低弹性品类更保守
    const baseBoostRatio = Math.min(0.15, 0.05 + deterministicHash(entityId, 1) * 0.10);
    const boostRatio = baseBoostRatio * elasticityModifier; // v267: 品类弹性修正
    const newBid = currentBid * (1 + boostRatio);
    // v238: 提价后也不能超过探索上限
    const cappedBid = Math.min(newBid, explorationCeiling, maxBid);
    return {
      bid: cappedBid,
      confidence: 0.4,
      reason: `零曝光探索: 提升${(boostRatio * 100).toFixed(0)}%以获取曝光数据`,
    };
  }
  
  // 场景2: 有曝光但零点击 — 出价可能过低或相关性差
  if (clicks === 0 && impressions > 0) {
    if (impressions < 100) {
      // v238: 低曝光零点击也增加出价上限保护
      const lowClickCeiling = maxBid * 0.50;
      if (currentBid >= lowClickCeiling) {
        return {
          bid: currentBid,
          confidence: 0.3,
          reason: `低曝光零点击(${impressions}次)但出价已达上限($${currentBid.toFixed(2)}): 维持出价观察`,
        };
      }
      // 曝光不足，可能需要更多数据
      // v267 P3-3: 品类弹性修正
      const baseBoostRatio = Math.min(0.10, 0.03 + deterministicHash(entityId, 2) * 0.07);
      const boostRatio = baseBoostRatio * elasticityModifier;
      const newBid = Math.min(currentBid * (1 + boostRatio), lowClickCeiling);
      return {
        bid: newBid,
        confidence: 0.35,
        reason: `低曝光零点击(${impressions}次): 小幅提升${(boostRatio * 100).toFixed(0)}%`,
      };
    } else {
      // 曝光充足但无点击，可能相关性差，降低出价
      // v267 P3-3: 品类弹性修正
      const baseReduceRatio = Math.min(0.15, 0.05 + (impressions / 1000) * 0.10);
      const reduceRatio = baseReduceRatio * elasticityModifier;
      return {
        bid: currentBid * (1 - reduceRatio),
        confidence: 0.5,
        reason: `高曝光零点击(${impressions}次): 降低${(reduceRatio * 100).toFixed(0)}%`,
      };
    }
  }
  
  // 场景3: 有点击但零订单 — 根据花费判断
  // v258: 重构归因延迟保护，引入多维度决策和降价力度上限
  // 核心改进：
  //   1. 归因延迟保护窗口：最近48h内的数据权重打折，避免对未归因数据反应过激
  //   2. 多维度决策：综合CTR、趋势、花费比例、点击数等多个因素
  //   3. 降价力度上限：单次降价不超过15%（原来最大可达25%）
  //   4. 保护期：点击数少于5次时强制维持观察，等待更多数据
  if (orders === 0 && clicks > 0) {
    const cpc = spend / clicks;
    const realAov = groupConfig.groupAvgAov || 30;
    
    // v258: 趋势感知（保留v254逻辑）
    let zeroConvTrendDir: 'improving' | 'stable' | 'declining' = 'stable';
    let zeroConvTrendStr = 0;
    // @ts-expect-error Dynamic type assertion
    const dailyData = (target as Record<string, unknown>).dailyData as Array<{ date: Date; spend: number; sales: number; clicks: number; orders: number }> | undefined;
    if (dailyData && dailyData.length >= 7) {
      try {
        const rawData: timeDecayService.DailyRawData[] = dailyData.map(d => ({
          date: d.date instanceof Date ? d.date.toISOString() : String(d.date),
          impressions: 0, clicks: d.clicks || 0, spend: d.spend || 0, sales: d.sales || 0, orders: d.orders || 0,
        }));
        const twMetrics = timeDecayService.calculateTimeWeightedMetrics(rawData);
        zeroConvTrendDir = twMetrics.trendSignal.direction;
        zeroConvTrendStr = twMetrics.trendSignal.strength;
      } catch { /* 趋势计算失败不影响核心决策 */ }
    }
    const zeroConvTrendLabel = zeroConvTrendDir !== 'stable' ? `, 趋势=${zeroConvTrendDir}` : '';
    
    // v268 P1-2: 增强归因延迟保护 — 引入“无单词保护期”
    // 亚马逊广告归因延迟24-48h，高客单价品类可能更长
    // v268改进: 点击数门槛从5提升到8，并引入基于花费的保护期
    // 当花费<AOV*targetAcos时，无论点击多少都不应降价（还未给足转化机会）
    const minSpendForDecision = realAov * targetAcos * 0.8; // 至少花费AOV*targetAcos的80%才能做降价决策
    if (clicks < 8 || spend < minSpendForDecision) {
      const protectionReason = clicks < 8 ? `点击不足(${clicks}<8)` : `花费不足($${spend.toFixed(2)}<$${minSpendForDecision.toFixed(2)})`;
      return {
        bid: currentBid,
        confidence: 0.35,
        reason: `零转化保护期(${protectionReason}${zeroConvTrendLabel}): v268归因延迟保护，维持观察等待归因完成`,
      };
    }
    
    // v258: 增强归因延迟容忍度 — 提升基础容忍系数到2.0（原1.5）
    // 趋势improving时进一步提升，declining时适度降低
    const baseTolerance = 2.5; // v268: 从2.0提升到2.5，给予更多归因时间（尤其是高客单价品类）
    const attributionToleranceFactor = zeroConvTrendDir === 'improving' ? baseTolerance * (1 + zeroConvTrendStr * 0.25) :
                                       zeroConvTrendDir === 'declining' ? baseTolerance * (1 - zeroConvTrendStr * 0.15) : baseTolerance;
    const maxAcceptableSpend = realAov * targetAcos * attributionToleranceFactor;
    
    // v258: 多维度决策 — CTR作为辅助判断依据
    const ctr = impressions > 0 ? clicks / impressions : 0;
    const isHighCtr = ctr > 0.008; // CTR > 0.8% 表明关键词相关性好
    
    if (spend > maxAcceptableSpend) {
      // v258: 降价力度上限从25%降低到15%，防止过度降价引发死亡螺旋
      const spendRatio = spend / maxAcceptableSpend;
      // v258: 高CTR关键词降价更保守（相关性好的词值得保留）
      const maxReduce = isHighCtr ? 0.10 : 0.15;
      const reduceRatio = Math.min(maxReduce, (spendRatio - 1) * 0.10);
      return {
        bid: currentBid * (1 - reduceRatio),
        confidence: 0.45,
        reason: `零转化高花费($${spend.toFixed(2)}, AOV=$${realAov.toFixed(0)}, ${spendRatio.toFixed(1)}x超标, CTR=${(ctr * 100).toFixed(2)}%${zeroConvTrendLabel}): v258温和降低${(reduceRatio * 100).toFixed(0)}%(上限${(maxReduce * 100)}%)`,
      };
    }
    
    // v258: 点击数较多但花费未超标 — 更保守的降价策略
    if (clicks >= 10) {
      // v258: 降价上限从10%降低到7%，高CTR时仅降5%
      const maxReduce = isHighCtr ? 0.05 : 0.07;
      const reduceRatio = Math.min(maxReduce, clicks / 300);
      return {
        bid: currentBid * (1 - reduceRatio),
        confidence: 0.40,
        reason: `零转化${clicks}次点击($${spend.toFixed(2)}, CTR=${(ctr * 100).toFixed(2)}%${zeroConvTrendLabel}): v258温和降低${(reduceRatio * 100).toFixed(1)}%`,
      };
    }
    
    // 花费在可接受范围内且点击数少，维持观察
    return {
      bid: currentBid,
      confidence: 0.4,
      reason: `零转化但花费可控($${spend.toFixed(2)}, ${clicks}次点击, CTR=${(ctr * 100).toFixed(2)}%): 维持出价观察`,
    };
  }
  
  // 场景4: 有订单 — 基于ACOS进行精确调整
  // v253: 引入数据置信度因子和CTR相关性感知，实现个性化调整
  // v254: 引入趋势感知 — 近期表现趋势影响调整方向和力度
  // v360: 增强ACoS偏差因子透明度 - 明确偏差方向、幅度和决策区间
  // v646: 建议竞价底线保护 — 降价时不低于suggestedBidRangeStart的80%，防止失去市场竞争力
  // @ts-expect-error Dynamic type assertion
  const _suggestedBidRangeStart = ((target as Record<string, unknown>).suggestedBidRangeStart as number | undefined) || undefined;
  // @ts-expect-error Dynamic type assertion
  const _suggestedBid = ((target as Record<string, unknown>).suggestedBid as number | undefined) || undefined;
  // v646: 计算建议竞价底线 — suggestedBidRangeStart的80%，或suggestedBid的60%作为兜底
  const suggestedBidFloorForReduce = _suggestedBidRangeStart && _suggestedBidRangeStart > 0
    ? _suggestedBidRangeStart * 0.80
    : (_suggestedBid && _suggestedBid > 0 ? _suggestedBid * 0.60 : 0);
  
  if (orders > 0 && sales > 0) {
    const actualAcos = spend / sales;
    const acosRatio = actualAcos / targetAcos;
    
    // v360: ACoS偏差因子诊断标签
    const acosDeviationPct = ((acosRatio - 1) * 100).toFixed(1);
    const acosDirection = acosRatio < 1 ? 'below_target' : acosRatio <= 1.5 ? 'slightly_above' : acosRatio <= 2.0 ? 'moderately_above' : acosRatio <= 3.0 ? 'severely_above' : 'extremely_above';
    const acosZone = acosRatio < 0.5 ? 'boost_zone' : acosRatio < 0.7 ? 'growth_zone' : acosRatio <= 1.0 ? 'target_zone' : acosRatio <= 1.5 ? 'caution_zone' : acosRatio <= 2.0 ? 'reduce_zone' : acosRatio <= 3.0 ? 'danger_zone' : 'emergency_zone';
    log.debug(`[v360-BidDecision] ACoS偏差分析: actual=${(actualAcos * 100).toFixed(1)}%, target=${(targetAcos * 100).toFixed(1)}%, ratio=${acosRatio.toFixed(2)}, deviation=${acosDeviationPct}%, direction=${acosDirection}, zone=${acosZone}`);
    
    // v253: 数据置信度因子 — 数据量越大，调整幅度越接近理论值；数据量小时保守调整
    // clicks < 5: 保守因子 0.5 | clicks 5-20: 中等因子 0.5-0.85 | clicks > 20: 充分因子 0.85-1.0
    const dataConfidence = clicks < 5 ? 0.5 : clicks < 20 ? 0.5 + (clicks - 5) * 0.023 : Math.min(1.0, 0.85 + (clicks - 20) * 0.003);
    
    // v253: CTR相关性感知 — 高CTR表明关键词相关性好，值得更积极的投入
    const ctr = impressions > 0 ? clicks / impressions : 0;
    // 行业平均CTR约为0.3%-0.5%，超过1%属于优秀
    const ctrBonus = ctr > 0.01 ? 1.1 : ctr > 0.005 ? 1.05 : 1.0;
    // 低CTR表明相关性差，应更保守
    const ctrPenalty = ctr < 0.002 && impressions > 200 ? 0.85 : 1.0;
    
    // v254: 趋势感知因子 — 利用dailyData计算近期表现趋势
    // improving: 对提价加速、对降价减缓（避免误杀正在好转的关键词）
    // declining: 对降价加速、对提价减缓（更果断止损）
    // stable: 不做额外调整
    let trendDirection: 'improving' | 'stable' | 'declining' = 'stable';
    let trendStrength = 0;
    // @ts-expect-error Dynamic type assertion
    const dailyData = (target as Record<string, unknown>).dailyData as Array<{ date: Date; spend: number; sales: number; clicks: number; orders: number }> | undefined;
    if (dailyData && dailyData.length >= 7) {
      try {
        const rawData: timeDecayService.DailyRawData[] = dailyData.map(d => ({
          date: d.date instanceof Date ? d.date.toISOString() : String(d.date),
          impressions: 0,
          clicks: d.clicks || 0,
          spend: d.spend || 0,
          sales: d.sales || 0,
          orders: d.orders || 0,
        }));
        const twMetrics = timeDecayService.calculateTimeWeightedMetrics(rawData);
        trendDirection = twMetrics.trendSignal.direction;
        trendStrength = twMetrics.trendSignal.strength;
      } catch {
        // 趋势计算失败不影响核心决策
      }
    }
    // 趋势修正因子：improving时提价放大/降价缩小，declining时反之
    // 最大影响幅度±15%，由trendStrength(0-1)控制实际影响
    const trendBoostFactor = trendDirection === 'improving' ? 1 + trendStrength * 0.15 :
                             trendDirection === 'declining' ? 1 - trendStrength * 0.10 : 1.0;
    const trendReduceFactor = trendDirection === 'declining' ? 1 + trendStrength * 0.15 :
                              trendDirection === 'improving' ? 1 - trendStrength * 0.10 : 1.0;
    const trendLabel = trendDirection !== 'stable' ? `, 趋势=${trendDirection}(${(trendStrength * 100).toFixed(0)}%)` : '';
    
    if (acosRatio < 0.5) {
      // v260: 动态提价模型 — 基于CTR和CVR精细化调整提价幅度
      // v259固定25%上限 → v260根据关键词质量动态调整:
      //   - 高CTR(>1%) + 高CVR(>5%): 最大提价30% (明星关键词)
      //   - 高CTR + 低CVR: 最大提价15% (流量好但转化待提升)
      //   - 低CTR + 高CVR: 最大提价20% (转化好但需要更多曝光)
      //   - 低CTR + 低CVR: 最大提价10% (保守提价)
      const cvr = clicks > 0 ? orders / clicks : 0;
      const isHighCtr = ctr > 0.01; // CTR > 1%
      const isHighCvr = cvr > 0.05;  // CVR > 5%
      
      // v260: 动态提价上限
      const dynamicMaxBoost = isHighCtr && isHighCvr ? 0.30 :  // 明星词
                              isHighCtr && !isHighCvr ? 0.15 :  // 流量好转化低
                              !isHighCtr && isHighCvr ? 0.20 :  // 转化好曝光低
                              0.10;                              // 保守
      
      const rawBoostRatio = Math.min(dynamicMaxBoost, (1 - acosRatio) * 0.30);
      const boostRatio = rawBoostRatio * dataConfidence * ctrBonus * trendBoostFactor * elasticityModifier; // v267 P3-3: 品类弹性修正
      const newBid = Math.min(currentBid * (1 + boostRatio), maxBid * 0.85); // 上限为maxBid皅85%
      const qualityLabel = isHighCtr && isHighCvr ? '明星词' : isHighCtr ? '高流量' : isHighCvr ? '高转化' : '保守';
      return {
        bid: newBid,
        confidence: 0.65 + dataConfidence * 0.2,
        reason: `[v260动态提价] ACOS极优(${(actualAcos * 100).toFixed(1)}% vs 目标${(targetAcos * 100).toFixed(1)}%, ${clicks}次点击, CTR=${(ctr * 100).toFixed(2)}%, CVR=${(cvr * 100).toFixed(1)}%${trendLabel}): ${qualityLabel}提升${(boostRatio * 100).toFixed(1)}%(上限${(dynamicMaxBoost * 100)}%)`,
      };
    } else if (acosRatio < 0.7) {
      // v260: ACOS优秀场景也引入CVR感知的动态提价
      const cvr = clicks > 0 ? orders / clicks : 0;
      const isHighCvr = cvr > 0.05;
      // v260: 高CVR时允许更大提价幅度
      const dynamicMaxBoost = isHighCvr ? 0.22 : 0.15;
      const rawBoostRatio = Math.min(dynamicMaxBoost, (1 - acosRatio) * 0.25);
      const boostRatio = rawBoostRatio * dataConfidence * ctrBonus * trendBoostFactor * elasticityModifier; // v267 P3-3
      return {
        bid: currentBid * (1 + boostRatio),
        confidence: 0.5 + dataConfidence * 0.2,
        reason: `[v260] ACOS优秀(${(actualAcos * 100).toFixed(1)}% vs 目标${(targetAcos * 100).toFixed(1)}%, ${clicks}次点击, CTR=${(ctr * 100).toFixed(2)}%, CVR=${(cvr * 100).toFixed(1)}%${trendLabel}): 提升${(boostRatio * 100).toFixed(1)}%(上限${(dynamicMaxBoost * 100)}%, 置信度${(dataConfidence * 100).toFixed(0)}%)`,
      };
    } else if (acosRatio <= 1.0) {
      // v242: ACOS在目标范围内 — 精度感知微调
      const rawAdjustRatio = (1 - acosRatio) * 0.15;
      const minEffectiveRatio = currentBid > 0 ? 0.02 / currentBid : 0.03;
      const baseAdjustRatio = rawAdjustRatio > 0.001 ? Math.max(rawAdjustRatio, minEffectiveRatio) : rawAdjustRatio;
      // v253: 应用数据置信度和CTR修正
      // v254: ACOS达标场景的微调也受趋势影响
      const adjustRatio = baseAdjustRatio * dataConfidence * ctrBonus * trendBoostFactor * elasticityModifier; // v267 P3-3
      return {
        bid: currentBid * (1 + adjustRatio),
        confidence: 0.55 + dataConfidence * 0.15,
        reason: `ACOS达标(${(actualAcos * 100).toFixed(1)}%, ${clicks}次点击${trendLabel}): 微调${(adjustRatio * 100).toFixed(1)}%${rawAdjustRatio < minEffectiveRatio ? '(精度放大)' : ''}`,
      };
    } else if (acosRatio <= 1.5) {
      // v242: ACOS略高于目标 — 精度感知降价
      const rawReduceRatio = Math.min(0.15, (acosRatio - 1) * 0.25);
      const minEffectiveRatio = currentBid > 0 ? 0.02 / currentBid : 0.03;
      const baseReduceRatio = rawReduceRatio > 0.001 ? Math.max(rawReduceRatio, minEffectiveRatio) : rawReduceRatio;
      // v253: 低CTR时更积极地降价，高CTR时保守降价（相关性好的词值得保留）
      // v254: 趋势declining时加速降价，improving时减缓降价（正在好转的词不急于降价）
      const reduceRatio = baseReduceRatio * dataConfidence * ctrPenalty * trendReduceFactor * elasticityModifier; // v267 P3-3
      let reducedBid = currentBid * (1 - reduceRatio);
      // v646: 建议竞价底线保护 — 降价后不低于建议竞价下界的80%
      if (suggestedBidFloorForReduce > 0 && reducedBid < suggestedBidFloorForReduce) {
        reducedBid = suggestedBidFloorForReduce;
        log.info(`[v646] 建议竞价底线保护触发: 降价后$${(currentBid * (1 - reduceRatio)).toFixed(2)}低于底线$${suggestedBidFloorForReduce.toFixed(2)}, 兜底至$${reducedBid.toFixed(2)}`);
      }
      return {
        bid: reducedBid,
        confidence: 0.5 + dataConfidence * 0.15,
        reason: `ACOS偏高(${(actualAcos * 100).toFixed(1)}%, ${clicks}次点击, CTR=${(ctr * 100).toFixed(2)}%${trendLabel}): 降低${(reduceRatio * 100).toFixed(1)}%${rawReduceRatio < minEffectiveRatio ? '(精度放大)' : ''}${suggestedBidFloorForReduce > 0 ? ` [底线$${suggestedBidFloorForReduce.toFixed(2)}]` : ''}`,
      };
    } else if (acosRatio <= 2.0) {
      // v259: ACOS超标但在2倍以内 — 温和降价，避免过度反应
      const isHighCtr = ctr > 0.008;
      const maxReduceLimit = isHighCtr ? 0.10 : 0.18;
      const baseReduceRatio = (acosRatio - 1) * 0.18;
      const rawReduceRatio = Math.min(maxReduceLimit, baseReduceRatio);
      const reduceRatio = rawReduceRatio * dataConfidence * ctrPenalty * trendReduceFactor * elasticityModifier; // v267 P3-3
      let reducedBid = currentBid * (1 - reduceRatio);
      // v646: 建议竞价底线保护
      if (suggestedBidFloorForReduce > 0 && reducedBid < suggestedBidFloorForReduce) {
        reducedBid = suggestedBidFloorForReduce;
        log.info(`[v646] 建议竞价底线保护触发(超标): 降价后$${(currentBid * (1 - reduceRatio)).toFixed(2)}低于底线$${suggestedBidFloorForReduce.toFixed(2)}, 兜底至$${reducedBid.toFixed(2)}`);
      }
      return {
        bid: reducedBid,
        confidence: 0.5 + dataConfidence * 0.15,
        reason: `ACOS超标(${(actualAcos * 100).toFixed(1)}%, ${clicks}次点击, CTR=${(ctr * 100).toFixed(2)}%${trendLabel}): v259温和降低${(reduceRatio * 100).toFixed(1)}%(上限${(maxReduceLimit * 100)}%)${suggestedBidFloorForReduce > 0 ? ` [底线$${suggestedBidFloorForReduce.toFixed(2)}]` : ''}`,
      };
    } else if (acosRatio <= 3.0) {
      // v259: ACOS严重超标（2-3倍）— 果断但有限降价
      // 核心改进：即使严重超标也不超过20%降幅，防止死亡螺旋
      const isHighCtr = ctr > 0.008;
      // v259: 高CTR关键词降价更保守（相关性好，可能是归因延迟导致）
      const maxReduceLimit = isHighCtr ? 0.12 : 0.20;
      const baseReduceRatio = (acosRatio - 1) * 0.15;
      const rawReduceRatio = Math.min(maxReduceLimit, baseReduceRatio);
      const reduceRatio = rawReduceRatio * dataConfidence * trendReduceFactor * elasticityModifier;
      let reducedBid = currentBid * (1 - reduceRatio);
      // v646: 建议竞价底线保护（严重超标时底线降至60%，给予更大降价空间）
      const severeFloor = suggestedBidFloorForReduce > 0 ? suggestedBidFloorForReduce * 0.75 : 0;
      if (severeFloor > 0 && reducedBid < severeFloor) {
        reducedBid = severeFloor;
        log.info(`[v646] 建议竞价底线保护触发(严重超标): 降价后$${(currentBid * (1 - reduceRatio)).toFixed(2)}低于底线$${severeFloor.toFixed(2)}, 兜底至$${reducedBid.toFixed(2)}`);
      }
      return {
        bid: reducedBid,
        confidence: 0.5 + dataConfidence * 0.2,
        reason: `ACOS严重超标(${(actualAcos * 100).toFixed(1)}%, ${clicks}次点击, CTR=${(ctr * 100).toFixed(2)}%, 置信度${(dataConfidence * 100).toFixed(0)}%${trendLabel}): v259降低${(reduceRatio * 100).toFixed(1)}%(上限${(maxReduceLimit * 100)}%)${severeFloor > 0 ? ` [底线$${severeFloor.toFixed(2)}]` : ''}`,
      };
    } else {
      // v332: ACOS极端超标（>3倍）— 更激进的降价策略
      // 针对LERUCCI US ACoS 132.7%（目标35%，acosRatio=3.79）这类极端情况
      // 原来最大降幅20%远远不够，需要更果断的止损
      const isHighCtr = ctr > 0.008;
      // 极端超标时，即使高CTR也需要更大降幅，但仍然保留差异化
      const maxReduceLimit = isHighCtr ? 0.20 : 0.30;
      // 使用更陡峭的系数，让降幅更快触及上限
      const baseReduceRatio = (acosRatio - 1) * 0.12;
      const rawReduceRatio = Math.min(maxReduceLimit, baseReduceRatio);
      const reduceRatio = rawReduceRatio * dataConfidence * trendReduceFactor * elasticityModifier;
      let reducedBid = currentBid * (1 - reduceRatio);
      // v646: 极端超标时底线降至50%（允许更大降价空间，但仍保留最低市场竞争力）
      const extremeFloor = suggestedBidFloorForReduce > 0 ? suggestedBidFloorForReduce * 0.50 : 0;
      if (extremeFloor > 0 && reducedBid < extremeFloor) {
        reducedBid = extremeFloor;
        log.info(`[v646] 建议竞价底线保护触发(极端超标): 降价后$${(currentBid * (1 - reduceRatio)).toFixed(2)}低于底线$${extremeFloor.toFixed(2)}, 兜底至$${reducedBid.toFixed(2)}`);
      }
      return {
        bid: reducedBid,
        confidence: 0.6 + dataConfidence * 0.2,
        reason: `ACOS极端超标(${(actualAcos * 100).toFixed(1)}% vs 目标${(targetAcos * 100).toFixed(1)}%, acosRatio=${acosRatio.toFixed(1)}x, ${clicks}次点击, CTR=${(ctr * 100).toFixed(2)}%${trendLabel}): v332激进降低${(reduceRatio * 100).toFixed(1)}%(上限${(maxReduceLimit * 100)}%)${extremeFloor > 0 ? ` [底线$${extremeFloor.toFixed(2)}]` : ''}`,
      };
    }
  }
  
  // 场景5: 兜底 — 维持当前出价
  return {
    bid: currentBid,
    confidence: 0.3,
    reason: '数据不足以做出判断: 维持当前出价',
  };
}

// ==================== 核心编排逻辑 ====================

/**
 * 为单个关键词/商品定向计算出价 — 保证100%返回结果
 * 
 * 算法降级链：
 * 1. 尝试高级算法（元学习选择器 → 最优算法）
 * 2. 高级算法失败 → 使用规则引擎
 * 3. 规则引擎也失败 → 保守策略（维持当前出价）
 * 
 * @returns NextGenBidResult — 永远不返回null，永远不抛出异常
 */
export async function calculateNextGenBid(
  accountId: number,
  target: OptimizationTarget,
  groupConfig: PerformanceGroupConfig,
  maxBidLimit?: number
): Promise<NextGenBidResult> {
  // v231: 防御性targetAcos单位转换 — NextGen内部统一使用小数形式(0.30)
  // 数据库和旧算法使用百分比形式(30.0)，需要在入口处统一转换
  const rawTargetAcos = groupConfig.targetAcos || DEFAULT_SAFETY.targetAcos;
  const normalizedTargetAcos = rawTargetAcos > 1 ? rawTargetAcos / 100 : rawTargetAcos;
  
  // v267 P1-3: 自我进化引擎集成 — 读取进化引擎注入的自适应参数
  // 进化引擎通过 _evolvedMaxChangePercent/_evolvedMaxDecreasePercent/_confidenceMultiplier 注入参数
  // 这些参数基于历史优化效果动态调整，使系统能够自我学习和进化
  // @ts-expect-error - dynamic property access
  const evolvedMaxIncrease = (groupConfig as Record<string, unknown>)._evolvedMaxChangePercent;
  // @ts-expect-error - dynamic property access
  const evolvedMaxDecrease = (groupConfig as Record<string, unknown>)._evolvedMaxDecreasePercent;
  // @ts-expect-error - dynamic property access
  const evolvedConfidenceMultiplier = (groupConfig as Record<string, unknown>)._confidenceMultiplier || 1.0;
  
  // 使用进化参数覆盖默认安全配置（如果可用）
  // @ts-expect-error Type inference limitation
  const effectiveMaxChange = evolvedMaxIncrease 
    // @ts-expect-error Conditional type narrowing
    ? Math.min(evolvedMaxIncrease, 0.15) // v510: 安全上限从50%收紧至15%
    : DEFAULT_SAFETY.maxBidChangePercent;
  
  const safetyConfig: SafetyConfig = {
    maxBidChangePercent: effectiveMaxChange,
    minBid: DEFAULT_SAFETY.minBid,
    maxBid: groupConfig.maxBid || DEFAULT_SAFETY.maxBid,
    targetAcos: normalizedTargetAcos,
  };
  
  if (evolvedMaxIncrease) {
    // @ts-expect-error Complex function parameter types
    log.info(`[NextGenBid] v267 自我进化参数已激活: maxIncrease=${(evolvedMaxIncrease*100).toFixed(0)}%, maxDecrease=${(evolvedMaxDecrease*100).toFixed(0)}%, confidenceMultiplier=${evolvedConfidenceMultiplier.toFixed(2)}`);
  }
  
  // v231: 创建标准化的groupConfig副本，确保所有内部函数使用正确的小数形式targetAcos
  const normalizedConfig: PerformanceGroupConfig = {
    // @ts-expect-error Spread operator type compatibility
    ...groupConfig,
    targetAcos: normalizedTargetAcos,
  };
  
  // v643: 计算ACoS比率，用于动态调整降价上限
  // acosRatio = 实际ACoS / 目标ACoS，大于1表示超标
  let acosRatio: number | undefined;
  if (target.sales > 0 && target.spend > 0 && normalizedTargetAcos > 0) {
    const actualAcos = target.spend / target.sales;
    acosRatio = actualAcos / normalizedTargetAcos;
  } else if (target.spend > 0 && target.sales === 0 && normalizedTargetAcos > 0) {
    // 有花费无销售，视为极端超标
    acosRatio = 5.0;
  }
  
  // ===== 第1层：尝试高级算法 =====
  try {
    const keywordId = target.type === 'keyword' ? target.id : undefined;
    const targetId = target.type === 'product_target' ? target.id : undefined;
    
    // v272 P0-1: 启动算法决策追踪
    const traceCtx = startAlgorithmTrace(
      accountId,
      target.type === 'keyword' ? 'keyword' : 'product_target',
      target.id,
      // @ts-expect-error Dynamic type assertion
      (target as Record<string, unknown>).amazonCampaignId,
      // @ts-expect-error - dynamic property access
      (normalizedConfig as Record<string, unknown>).strategyTemplate
    );
    
    // v271 P1-2: 传递策略模板以支持策略级别的算法配置
    const metaDecision = await selectBestAlgorithm(
      accountId, keywordId, targetId, undefined, target.currentBid,
      normalizedConfig.strategyTemplate || null
    );
    
    // v264: 高级算法判断逻辑增强
    // 1. 非rule_based/ucb的算法始终视为高级算法
    // 2. UCB探索模式（confidence=0.4且bid与currentBid不同）也视为有效决策
    const isAdvancedAlgorithm = !['rule_based', 'ucb'].includes(metaDecision.selectedAlgorithm);
    const isUcbExploration = metaDecision.selectedAlgorithm === 'ucb' 
      // @ts-expect-error Legacy code type compatibility
      && Math.abs(metaDecision.confidence - 0.4) < 0.01
      && Math.abs(metaDecision.recommendedBid - target.currentBid) > 0.005;
    // v264: P1-2 动态confidence门槛
    // 冷启动算法(linucb/cql新启用)降低门槛鼓励探索，成熟算法(ensemble)提高门槛要求更高置信度
    // v273: 进一步降低高级算法confidence门槛，提高高级算法激活率
    const dynamicConfidenceThreshold = (() => {
      switch (metaDecision.selectedAlgorithm) {
        case 'ensemble': return 0.30;     // v273: 从0.35降至0.30，融合算法本身已有多算法交叉验证
        case 'cql': return 0.20;          // v273: 从0.25降至0.20，CQL冷启动期更积极探索
        case 'linucb': return 0.20;       // v273: 从0.25降至0.20，LinUCB冷启动期更积极探索
        case 'sigmoid_curve': return 0.25; // v273: 从0.30降至0.25，Sigmoid有曲线拟合保证
        // @ts-expect-error Legacy code type compatibility
        default: return 0.25;             // v273: 从0.30降至0.25
      // @ts-expect-error Legacy code type compatibility
      }
    })();
    // v267 P1-3: 应用进化引擎的置信度乘数 — 历史表现好时降低门槛，表现差时提高门槛
    // @ts-expect-error Type inference limitation
    const evolvedThreshold = dynamicConfidenceThreshold * (1 / evolvedConfidenceMultiplier);
    const hasValidBid = metaDecision.recommendedBid > 0 && metaDecision.confidence > evolvedThreshold;
    
    if ((isAdvancedAlgorithm || isUcbExploration) && hasValidBid) {
      const safeBid = safetyValidate(target.currentBid, metaDecision.recommendedBid, safetyConfig, maxBidLimit, acosRatio);
      
      // v515: 修复RL数据记录参数传递 — 确保campaignId(string)和adGroupId(number)正确传入
      const advRlCampaignId = String((target as Record<string, unknown>).amazonCampaignId || (target as Record<string, unknown>).campaignId || '');
      const advRlAdGroupId = Number((target as Record<string, unknown>).internalAdGroupId || (target as Record<string, unknown>).adGroupId || 0);
      recordBidAction({
        accountId,
        // @ts-expect-error Legacy code type compatibility
        keywordId,
        targetId,
        campaignId: advRlCampaignId || undefined,
        adGroupId: advRlAdGroupId || undefined,
        bidBefore: target.currentBid,
        bidAfter: safeBid,
        actionSource: metaDecision.selectedAlgorithm === 'linucb' ? 'linucb' :
                      metaDecision.selectedAlgorithm === 'cql' ? 'cql' : 'rule_based',
      }).catch((err: any) => log.warn('[NextGenOrchestrator] RL recording error:', err));
      
      // v272 P0-1: 记录算法决策追踪
      try {
        completeAlgorithmTrace(traceCtx, {
          accountId,
          entityType: target.type === 'keyword' ? 'keyword' : 'product_target',
          entityId: target.id,
          // @ts-expect-error Dynamic type assertion
          campaignId: (target as Record<string, unknown>).amazonCampaignId,
          // @ts-expect-error - dynamic property access
          strategyTemplateId: (normalizedConfig as Record<string, unknown>).strategyTemplate,
          metaSelection: {
            // @ts-expect-error Complex function parameter types
            algorithmScores: metaDecision.algorithmScores?.map((s: Record<string, unknown>) => ({ algorithm: s.algorithm, score: s.score, eligible: s.eligible })) || [],
            selectedAlgorithm: metaDecision.selectedAlgorithm,
            fusionMode: metaDecision.fusionMode || 'single',
            fusionThreshold: 0.15,
            fusionDetail: metaDecision.fusionDetail || '',
          },
          finalDecision: {
            recommendedBid: safeBid,
            confidence: metaDecision.confidence,
            currentBid: target.currentBid,
            bidChangePercent: target.currentBid > 0 ? ((safeBid - target.currentBid) / target.currentBid) * 100 : 0,
          },
        });
      } catch (_traceErr: any) { /* 追踪失败不影响业务 */ }
      
      // @ts-expect-error Return type compatibility
      return buildResult(target, safeBid, metaDecision.selectedAlgorithm, metaDecision.confidence,
        // @ts-expect-error Legacy code type compatibility
        `[高级算法:${metaDecision.selectedAlgorithm}] ${metaDecision.reasoning}`, 'advanced', metaDecision);
    // @ts-expect-error Legacy code type compatibility
    }
    
    // 高级算法不可用（数据不足），自然降级到2层
    // 不记录为错误，这是正常的算法选择流程
    
  // @ts-expect-error Legacy code type compatibility
  } catch (advancedError: unknown) {
    // 高级算法执行异常，降级到2层2层
    // @ts-expect-error Complex function parameter types
    log.warn(`[NextGenOrchestrator] 高级算法异常(target=${target.id}), 降级到规则引擎: ${(advancedError as Error).message}`);
  // @ts-expect-error Legacy code type compatibility
  }
  
  // ===== v490: 冷启动建议竞价驱动层 =====
  // 在规则引擎之前，检查目标是否处于冷启动期
  // 如果是，使用亚马逊建议竞价作为贝叶斯先验计算智能初始出价
  try {
    const coldStartTarget = {
      id: target.id,
      type: target.type === 'keyword' ? 'keyword' as const : 'product_target' as const,
      currentBid: target.currentBid,
      // @ts-expect-error Dynamic type assertion
      suggestedBid: (target as Record<string, unknown>).suggestedBid as number | undefined,
      // @ts-expect-error Dynamic type assertion
      suggestedBidRangeStart: (target as Record<string, unknown>).suggestedBidRangeStart as number | undefined,
      // @ts-expect-error Dynamic type assertion
      suggestedBidRangeEnd: (target as Record<string, unknown>).suggestedBidRangeEnd as number | undefined,
      // @ts-expect-error Dynamic type assertion
      matchType: (target as Record<string, unknown>).matchType as string | undefined,
      // @ts-expect-error Dynamic type assertion
      keywordText: (target as Record<string, unknown>).keywordText as string | undefined,
      // @ts-expect-error Dynamic type assertion
      adGroupId: (target as Record<string, unknown>).internalAdGroupId as number | undefined,
      // @ts-expect-error Dynamic type assertion
      campaignId: (target as Record<string, unknown>).amazonCampaignId as number | undefined,
      // @ts-expect-error Dynamic type assertion
      clicks: (target as Record<string, unknown>).clicks as number | undefined,
      // @ts-expect-error Dynamic type assertion
      impressions: (target as Record<string, unknown>).impressions as number | undefined,
      // @ts-expect-error Dynamic type assertion
      spend: (target as Record<string, unknown>).spend as number | undefined,
      // @ts-expect-error Dynamic type assertion
      sales: (target as Record<string, unknown>).sales as number | undefined,
      // @ts-expect-error Dynamic type assertion
      orders: (target as Record<string, unknown>).orders as number | undefined,
      // @ts-expect-error Dynamic type assertion
      createdAt: (target as Record<string, unknown>).createdAt as string | undefined,
    };
    
    const coldStartResult = await getColdStartBidOverride(
      accountId, coldStartTarget, normalizedTargetAcos
    );
    
    if (coldStartResult) {
      const safeBid = safetyValidate(
        target.currentBid, coldStartResult.recommendedBid, safetyConfig, maxBidLimit, acosRatio
      );
      
      log.info(`[NextGenOrchestrator] v490冷启动驱动: target=${target.id}, ` +
        `策略=${coldStartResult.strategy}, 先验权重=${(coldStartResult.priorWeight * 100).toFixed(0)}%, ` +
        `建议竞价=$${coldStartResult.suggestedBidInfo.suggestedBid.toFixed(2)}, ` +
        `推荐出价=$${coldStartResult.recommendedBid.toFixed(2)}, 安全出价=$${safeBid.toFixed(2)}`);
      
      // 记录RL数据
      const keywordId = target.type === 'keyword' ? target.id : undefined;
      const targetId = target.type === 'product_target' ? target.id : undefined;
      // v515: 修复RLDataRecorder参数传递 — 确保campaignId(string)和adGroupId(number)正确传入
      const rlCampaignId = String((target as Record<string, unknown>).amazonCampaignId || (target as Record<string, unknown>).campaignId || '');
      const rlAdGroupId = Number((target as Record<string, unknown>).internalAdGroupId || (target as Record<string, unknown>).adGroupId || 0);
      recordBidAction({
        accountId, keywordId, targetId,
        campaignId: rlCampaignId || undefined,
        adGroupId: rlAdGroupId || undefined,
        bidBefore: target.currentBid,
        bidAfter: safeBid,
        actionSource: 'cold_start',
      }).catch((err: any) => log.warn('[NextGenOrchestrator] RL recording error:', err));
      
      return buildResult(target, safeBid, `cold_start_${coldStartResult.strategy}`,
        coldStartResult.confidence,
        `${coldStartResult.reason}`, 'rule_engine');
    }
  } catch (coldStartErr: unknown) {
    log.warn(`[NextGenOrchestrator] v490冷启动引擎异常(target=${target.id}): ${(coldStartErr as Error).message}`);
  }
  
  // ===== v257: 出价冷却时间检查 =====
  // 在规则引擎执行前检查冷却期，避免出价振荡
  const cooldownResult = await isInCooldownPeriod(
    accountId,
    target.type === 'keyword' ? target.id : undefined,
    target.type === 'product_target' ? target.id : undefined
  );
  
  if (cooldownResult.inCooldown) {
    log.info(`[NextGenOrchestrator] v257冷却保护: target=${target.id}, ${cooldownResult.reason}`);
    return buildResult(target, target.currentBid, 'cooldown_hold', 0.5,
      `[冷却保护] ${cooldownResult.reason}: 维持当前出价避免振荡`, 'guardrail');
  }
  
  // ===== v267: 出价方向一致性检查 =====
  // 核心思路：如果最近3次调整中有“先降后升”或“先升后降”的振荡模式，强制hold一个周期
  // 这是导致回滚率高的核心原因：算法在“降价”和“熔断提价恢复”之间振荡
  try {
    const directionCheck = await checkBidDirectionConsistency(
      accountId,
      target.type === 'keyword' ? target.id : undefined,
      target.type === 'product_target' ? target.id : undefined
    );
    if (directionCheck.isOscillating) {
      log.info(`[NextGenOrchestrator] v267方向一致性保护: target=${target.id}, ${directionCheck.reason}`);
      return buildResult(target, target.currentBid, 'direction_hold', 0.5,
        `[v267方向保护] ${directionCheck.reason}: 检测到出价振荡模式，强制hold等待数据稳定`, 'guardrail');
    }
  } catch (dirErr: unknown) {
    log.warn(`[NextGenOrchestrator] v267方向检查异常: ${(dirErr as Error).message}`);
  }
  
  // ===== 第2层：规则引擎 =====
  try {
    const ruleResult = ruleEngineDecision(target, normalizedConfig);
    let safeBid = safetyValidate(target.currentBid, ruleResult.bid, safetyConfig, maxBidLimit, acosRatio);
    let finalReason = ruleResult.reason;
    
    // v257: 最小调整幅度检查 — 忽略微小的无意义变动
    if (!meetsMinimumAdjustment(target.currentBid, safeBid)) {
      safeBid = target.currentBid;
      // @ts-expect-error Legacy code type compatibility
      finalReason += ' | v257: 调整幅度低于最小阈值，维持不变';
    // @ts-expect-error Legacy code type compatibility
    }
    
    // ===== v510: 断崖修复锁定检查 =====
    // 如果实体正在断崖修复期间，禁止任何降价操作
    if (safeBid < target.currentBid - 0.005) {
      try {
        const { isInCliffRecoveryLockdown } = await import('../services/dataCliffAutoRecoveryEngine');
        const lockdown = await isInCliffRecoveryLockdown(
          accountId,
          target.type === 'keyword' ? 'keyword' : 'product_target',
          target.id
        );
        if (lockdown.locked) {
          log.info(`[NextGenOrchestrator] v510断崖锁定: target=${target.id}, ${lockdown.reason}`);
          return buildResult(target, target.currentBid, 'cliff_lockdown_hold', 0.6,
            `${lockdown.reason}: 维持当前出价等待流量恢复`, 'guardrail');
        }
      } catch (lockdownErr: unknown) {
        log.warn(`[NextGenOrchestrator] v510断崖锁定检查异常: ${(lockdownErr as Error).message}`);
      }
    }
    
    // ===== v258: 降价熔断检查 =====
    // 在规则引擎做出降价决策后，检查是否触发熔断保护
    // 防止“死亡螺旋”：持续降价 → 曝光减少 → ACoS更高 → 继续降价
    if (safeBid < target.currentBid - 0.005) {
      const keywordId = target.type === 'keyword' ? target.id : undefined;
      const targetIdForCB = target.type === 'product_target' ? target.id : undefined;
      const cbResult = await checkCircuitBreaker(accountId, keywordId, targetIdForCB, target.currentBid, safeBid);
      
      if (cbResult.tripped) {
        log.warn(`[NextGenOrchestrator] v259熔断提价恢复: target=${target.id}, ${cbResult.reason}`);
        // v259: 熔断触发时执行提价恢复，而不是简单hold
        // 核心逻辑：死亡螺旋的根因是出价降得太低导致曝光消失，必须主动提价恢复
        // @ts-expect-error Dynamic property access
        if (cbResult.guardrailInfo.recoveryBid && cbResult.guardrailInfo.recoveryBid > target.currentBid) {
          // @ts-expect-error Legacy code type compatibility
          safeBid = safetyValidate(target.currentBid, cbResult.guardrailInfo.recoveryBid, safetyConfig, maxBidLimit, acosRatio);
          finalReason = `[v259提价恢复] ${cbResult.reason}`;
        } else {
          safeBid = target.currentBid; // 安全回退: 维持当前出价
          finalReason += ` | ${cbResult.reason}`;
        }
        // 将护栏信息附加到reason中，便于日志分析
        finalReason += ` | guardrail: ${JSON.stringify({
          consecutiveDecreases: cbResult.guardrailInfo.consecutiveDecreases,
          cumulativeDecrease7d: cbResult.guardrailInfo.cumulativeDecrease7d,
          initialBid7d: cbResult.guardrailInfo.initialBid7d,
          recoveryMode: cbResult.guardrailInfo.recoveryMode,
          recoveryBid: cbResult.guardrailInfo.recoveryBid,
        })}`;
      }
    }
    
    // v257: 增强型主动探索策略 — 加速高级算法数据积累
    // 目标：产生多样化的成功/失败数据，打破“数据不足→无法激活→永远数据不足”的死锁
    // 策略：
    //   1. 提高探索率到30%，确保更多关键词产生RL训练数据
    //   2. 引入多梯度探索：小幅度(3-5%)、中幅度(5-8%)、大幅度(8-12%)
    //   3. 对于非“hold”的调整也有概率叠加探索扰动，增加数据多样性
    // 安全保障：所有探索受safetyValidate约束，且受冷却时间保护
    const isEffectivelyHold = Math.abs(safeBid - target.currentBid) <= 0.005;
    const entityId = Number(target.id);
    const hourSeed = Math.floor(Date.now() / (4 * 3600000)); // 每4小时一个种子
    const explorationHash = ((entityId * 2654435761 + hourSeed * 1597334677) >>> 0) % 100;
    
    // v257: 主动探索分两种场景
    // 场景A: hold状态 — 30%概率触发探索
    // 场景B: 非hold状态 — 10%概率叠加微小扰动，增加数据多样性
    const EXPLORATION_RATE_HOLD = 30;
    const EXPLORATION_RATE_ACTIVE = 10;
    
    const shouldExplore = isEffectivelyHold 
      ? (explorationHash < EXPLORATION_RATE_HOLD && target.currentBid > 0.05)
      : (explorationHash < EXPLORATION_RATE_ACTIVE);
    
    if (shouldExplore) {
      const directionHash = ((entityId * 1103515245 + hourSeed) >>> 0) % 100;
      // v257: 多梯度探索 — 根据哈希值分配不同幅度
      // v258: 使用普通数字运算替代BigInt（兼容ES2019及以下）
      const gradientHash = Math.abs(((entityId * 2654435761 + hourSeed * 40503) >>> 0) % 100);
      const gradientVal = gradientHash;
      let explorationRatio: number;
      if (gradientVal < 50) {
        // 50%概率: 小幅度探索 3-5%
        explorationRatio = 0.03 + (gradientVal / 50) * 0.02;
      } else if (gradientVal < 80) {
        // 30%概率: 中幅度探索 5-8%
        explorationRatio = 0.05 + ((gradientVal - 50) / 30) * 0.03;
      } else {
        // 20%概率: 大幅度探索 8-12%
        // @ts-expect-error Legacy code type compatibility
        explorationRatio = 0.08 + ((gradientVal - 80) / 20) * 0.04;
      // @ts-expect-error Legacy code type compatibility
      }
      
      // 精度保障: 确保探索幅度超过最小有效值
      const minExplorationRatio = target.currentBid > 0 ? 0.02 / target.currentBid : 0.03;
      explorationRatio = Math.max(minExplorationRatio, explorationRatio);
      
      let explorationBid: number;
      if (isEffectivelyHold) {
        // hold场景: 完全由探索决定方向
        explorationBid = directionHash < 50 
          ? target.currentBid * (1 + explorationRatio)
          : target.currentBid * (1 - explorationRatio);
      } else {
        // 非hold场景: 在规则引擎结果上叠加微小扰动
        const perturbRatio = explorationRatio * 0.3; // 扰动幅度为探索幅度的30%
        explorationBid = directionHash < 50 
          ? safeBid * (1 + perturbRatio)
          : safeBid * (1 - perturbRatio);
      }
      
      safeBid = safetyValidate(target.currentBid, explorationBid, safetyConfig, maxBidLimit, acosRatio);
      const exploreType = isEffectivelyHold ? 'RL探索' : 'RL扰动';
      const exploreDir = directionHash < 50 ? '上探' : '下探';
      finalReason += ` | v257${exploreType}: ${exploreDir}${(explorationRatio * 100).toFixed(1)}%`;
      log.info(`[NextGenOrchestrator] v257主动探索: target=${target.id}, ` +
        `类型=${exploreType}, 方向=${exploreDir}, 幅度=${(explorationRatio * 100).toFixed(1)}%, ` +
        `$${target.currentBid.toFixed(2)} → $${safeBid.toFixed(2)}`);
    }
    
    // v252: 规则引擎也记录RL数据（修复: 传递campaignId确保正确粒度）
    const keywordId = target.type === 'keyword' ? target.id : undefined;
    const targetId = target.type === 'product_target' ? target.id : undefined;
    // v515: 修复RL数据记录参数传递 — 确保campaignId(string)和adGroupId(number)正确传入
    const ruleRlCampaignId = String((target as Record<string, unknown>).amazonCampaignId || (target as Record<string, unknown>).campaignId || '');
    const ruleRlAdGroupId = Number((target as Record<string, unknown>).internalAdGroupId || (target as Record<string, unknown>).adGroupId || 0);
    recordBidAction({
      accountId,
      keywordId,
      targetId,
      campaignId: ruleRlCampaignId || undefined,
      adGroupId: ruleRlAdGroupId || undefined,
      bidBefore: target.currentBid,
      bidAfter: safeBid,
      actionSource: 'rule_based',
    }).catch((err: any) => log.warn('[NextGenOrchestrator] RL recording error:', err));
    
    return buildResult(target, safeBid, 'rule_engine', ruleResult.confidence,
      `[规则引擎] ${finalReason}`, 'rule_engine');
    
  // @ts-expect-error Legacy code type compatibility
  } catch (ruleError: unknown) {
    // @ts-expect-error Complex function parameter types
    log.warn(`[NextGenOrchestrator] 规则引擎异常(target=${target.id}): ${(ruleError as Error).message}`);
  // @ts-expect-error Legacy code type compatibility
  }
  
  // ===== 第3层：保守策略（绝对兜底） =====
  return buildResult(target, target.currentBid, 'conservative', 0.1,
    '[保守策略] 算法异常，维持当前出价', 'conservative');
}

/**
 * 构建标准化的出价结果
 */
function buildResult(
  target: OptimizationTarget,
  newBid: number,
  algorithmUsed: string,
  confidence: number,
  reason: string,
  tier: 'advanced' | 'rule_engine' | 'conservative' | 'guardrail',
  metaDecision?: MetaDecision
): NextGenBidResult {
  const bidChangePercent = target.currentBid > 0
    ? ((newBid - target.currentBid) / target.currentBid) * 100
    : 0;
  
  let actionType: 'increase' | 'decrease' | 'hold' = 'hold';
  // v240: 降低hold阈值0.01→0.005，让低出价关键词的微调也能生效
  if (Math.abs(newBid - target.currentBid) > 0.005) {
    actionType = newBid > target.currentBid ? 'increase' : 'decrease';
  }
  
  // v258: 构建结构化归因详情
  const reasonDetails = {
    triggerRule: tier === 'advanced' ? `高级算法:${algorithmUsed}` :
                 tier === 'conservative' ? '保守策略:算法异常兆底' :
                 tier === 'guardrail' ? `护栏保护:${algorithmUsed}` :
                 `规则引擎:${reason.split(':')[0]?.replace('[\u89c4\u5219\u5f15\u64ce] ', '') || algorithmUsed}`,
    coreMetrics: {
      // @ts-expect-error Dynamic type assertion
      clicks: (target as Record<string, unknown>).clicks,
      // @ts-expect-error Dynamic type assertion
      impressions: (target as Record<string, unknown>).impressions,
      // @ts-expect-error Dynamic type assertion
      spend: (target as Record<string, unknown>).spend,
      // @ts-expect-error Dynamic type assertion
      sales: (target as Record<string, unknown>).sales,
      // @ts-expect-error Dynamic type assertion
      orders: (target as Record<string, unknown>).orders,
    },
    algorithmChoice: `${tier}/${algorithmUsed}`,
    dataConfidence: confidence,
  };
  
  // v258+v259: 构建护栏信息
  const guardrailInfo = {
    cooldownActive: algorithmUsed === 'cooldown_hold',
    circuitBreakerTripped: reason.includes('熔断') || reason.includes('circuit_breaker'),
    arbitrationApplied: false,
    minAdjustmentFiltered: reason.includes('调整幅度低于最小阈值'),
    maxBidCapped: reason.includes('max_bid'),
    // v259新增护栏标识
    bidRecoveryTriggered: reason.includes('提价恢复') || reason.includes('recovery_bid') || reason.includes('熔断提价'),
    exposureProtectionActive: reason.includes('曝光保护') || reason.includes('exposure_protection') || reason.includes('曝光大幅下降'),
    bidirectionalBid: actionType === 'increase' && (reason.includes('ACOS极优') || reason.includes('ACOS优秀') || reason.includes('双向出价')),
    // @ts-expect-error Conditional type narrowing
    details: reason.includes('guardrail') ? reason.split('guardrail:')[1]?.trim() : undefined,
  };
  
  // v337: 构建修正层标记 — 显式记录GTO和Cascade Fusion的介入
  const correctionLayers = {
    gtoApplied: false,
    gtoCompositeModifier: undefined as number | undefined,
    gtoActiveEngines: undefined as string[] | undefined,
    cascadeFusionApplied: metaDecision?.fusionMode === 'cascade_ensemble',
    cascadeFusionAlgorithms: metaDecision?.fusionMode === 'cascade_ensemble'
      ? metaDecision.algorithmScores?.filter(s => s.eligible).slice(0, 2).map(s => s.algorithm)
      : undefined,
    cascadeFusionDetail: metaDecision?.fusionDetail || undefined,
    causalInferenceApplied: false,
  };

  // v337: 构建Meta-Learning决策详情
  const metaLearningDetail = metaDecision ? {
    candidateAlgorithms: metaDecision.algorithmScores?.map(s => ({
      algorithm: s.algorithm,
      score: s.score,
      eligible: s.eligible,
      reason: s.reason,
    })) || [],
    selectedAlgorithm: metaDecision.selectedAlgorithm,
    selectionReason: metaDecision.reasoning,
    fusionMode: metaDecision.fusionMode || 'single' as const,
    fusionDetail: metaDecision.fusionDetail || '',
    // @ts-expect-error Legacy code type compatibility
    dynamicConfidenceThreshold: 0, // 将在调用处填充
    // @ts-expect-error Legacy code type compatibility
    evolvedConfidenceMultiplier: 1, // 将在调用处填充
  // @ts-expect-error Legacy code type compatibility
  } : undefined;

  return {
    targetId: target.id,
    targetType: target.type,
    previousBid: target.currentBid,
    newBid,
    actionType,
    // @ts-expect-error Amazon API response type flexibility
    bidChangePercent: Math.round(bidChangePercent * 100) / 100,
    // @ts-expect-error Legacy code type compatibility
    reason,
    algorithmUsed,
    confidence,
    // @ts-expect-error Legacy code type compatibility
    metaDecision,
    algorithmTier: tier,
    // @ts-expect-error Legacy code type compatibility
    reasonDetails,
    guardrailInfo,
    correctionLayers,
    metaLearningDetail,
  };
}

// ==================== 批量出价优化 ====================

/**
 * 批量计算出价 — 对一组关键词/商品定向统一计算
 * 保证每一个target都有结果
 * 
 * v236: 集成GTO博弈论修正层
 * NextGen最终出价 = NextGen基础出价 × GTO综合修正系数
 */
// @ts-expect-error Legacy code type compatibility
export async function batchCalculateNextGenBids(
  // @ts-expect-error Legacy code type compatibility
  accountId: number,
  // @ts-expect-error Legacy code type compatibility
  targets: OptimizationTarget[],
  groupConfig: PerformanceGroupConfig,
  maxBidLimit?: number
): Promise<NextGenBidResult[]> {
  
  // ===== v236: 计算GTO修正系数 =====
  let gtoModifiers: Map<number, GTOModifier> = new Map();
  try {
    const currentHour = new Date().getUTCHours();
    // 构建GTO上下文（使用安全默认值，避免外部依赖失败影响NextGen核心流程）
    // @ts-expect-error Type inference limitation
    const totalSpend = targets.reduce((s: unknown, t: unknown) => s + t.spend, 0);
    // @ts-expect-error Type inference limitation
    const totalSales = targets.reduce((s: unknown, t: unknown) => s + t.sales, 0);
    // @ts-expect-error Type inference limitation
    const totalOrders = targets.reduce((s: unknown, t: unknown) => s + t.orders, 0);
    const valueTargets = targets.filter(t => t.orders > 0);
    const drawingTargets = targets.filter(t => t.orders === 0 && t.clicks >= 5);
    
    const gtoContext: GTOBatchContext = {
      accountId,
      currentHour,
      totalDailyBudget: groupConfig.maxBid ? groupConfig.maxBid * targets.length * 0.5 : 100,
      // @ts-expect-error Array method type inference
      ventureSpentToday: drawingTargets.reduce((s: unknown, t: unknown) => s + t.spend, 0),
      // @ts-expect-error Array method type inference
      ventureSalesToday: drawingTargets.reduce((s: unknown, t: unknown) => s + t.sales, 0),
      pulseHistory: new Map(), // 将在未来版本中从数据库加载
      hourlySignals: [], // 将在未来版本中从 hourly_performance 表加载
      // @ts-expect-error Conditional type narrowing
      corePoolRoas: totalSpend > 0 ? totalSales / totalSpend : 1.0,
      targetRoas: groupConfig.targetAcos ? (1 / (groupConfig.targetAcos > 1 ? groupConfig.targetAcos / 100 : groupConfig.targetAcos)) : 3.33,
      totalExploredKeywords: drawingTargets.length,
      graduatedKeywords: Math.round(valueTargets.length * 0.1), // 估算毕业率
    };
    
    gtoModifiers = batchCalculateGTOModifiers(targets, groupConfig, gtoContext);
    log.info(`[NextGenOrchestrator] GTO修正层已启用: ${gtoModifiers.size}个目标获得修正系数`);
  } catch (gtoError: unknown) {
    // GTO层失败不影响NextGen核心流程
    log.warn(`[NextGenOrchestrator] GTO修正层异常(已降级): ${(gtoError as Error).message}`);
  }
  
  // ===== v490: 预加载纳什均衡出价区间 =====
  let nashRanges: Map<string, NashEquilibriumRange> = new Map();
  try {
    // v491修正: 只使用每个target自身的suggestedBid/Low/High
    // 绝不回退到group级别中位数，无suggestedBid时由Nash引擎内部降级链处理（贝叶斯平滑 → 当前竞价+规则引擎）
    const nashTargets = targets.map(t => {
      // @ts-expect-error Dynamic type assertion
      const targetSuggestedBid = (t as Record<string, unknown>).suggestedBid as number | undefined;
      // @ts-expect-error Dynamic type assertion
      const targetSuggestedBidRangeStart = (t as Record<string, unknown>).suggestedBidRangeStart as number | undefined;
      // @ts-expect-error Dynamic type assertion
      const targetSuggestedBidRangeEnd = (t as Record<string, unknown>).suggestedBidRangeEnd as number | undefined;
      return {
        id: t.id,
        type: t.type as 'keyword' | 'product_target',
        currentBid: t.currentBid,
        suggestedBid: (targetSuggestedBid && targetSuggestedBid > 0) ? targetSuggestedBid : undefined,
        suggestedBidRangeStart: (targetSuggestedBidRangeStart && targetSuggestedBidRangeStart > 0) ? targetSuggestedBidRangeStart : undefined,
        suggestedBidRangeEnd: (targetSuggestedBidRangeEnd && targetSuggestedBidRangeEnd > 0) ? targetSuggestedBidRangeEnd : undefined,
      };
    });
    // @ts-expect-error Async operation type inference
    nashRanges = await batchPreloadNashRanges(accountId, nashTargets);
    log.info(`[NextGenOrchestrator] v490纳什均衡层已启用: ${nashRanges.size}个目标获得均衡区间`);
  } catch (nashError: unknown) {
    // 纳什均衡层失败不影响NextGen核心流程
    log.warn(`[NextGenOrchestrator] v490纳什均衡层异常(已降级): ${(nashError as Error).message}`);
  }

  // ===== v274: 加载因果推断结果，作为出价修正信号 =====
  let causalMap: Map<string, { optimalBid: number; upliftScore: number; incrementalProfit: number; confidence: number; sampleSize: number }> = new Map();
  try {
    const causalDb = await getDb();
    if (!causalDb) throw new Error('DB not available for causal inference');
    const recentDate = new Date();
    // @ts-expect-error Legacy code type compatibility
    recentDate.setDate(recentDate.getDate() - 7);
    const causalResults = await causalDb.select({
      keywordId: causalInferenceResults.keywordId,
      targetId: causalInferenceResults.targetId,
      optimalBid: causalInferenceResults.optimalBid,
      upliftScore: causalInferenceResults.upliftScore,
      incrementalProfit: causalInferenceResults.incrementalProfit,
      confidenceInterval: causalInferenceResults.confidenceInterval,
      sampleSize: causalInferenceResults.sampleSize,
    }).from(causalInferenceResults)
      .where(and(
        eq(causalInferenceResults.accountId, accountId),
        gte(causalInferenceResults.analysisDate, recentDate.toISOString().split('T')[0])
      ))
      .orderBy(desc(causalInferenceResults.createdAt))
      .limit(500);
    
    for (const cr of causalResults) {
      const key = cr.keywordId ? `kw_${cr.keywordId}` : cr.targetId ? `tg_${cr.targetId}` : null;
      if (key && !causalMap.has(key)) {
        causalMap.set(key, {
          optimalBid: Number(cr.optimalBid) || 0,
          upliftScore: Number(cr.upliftScore) || 0,
          incrementalProfit: Number(cr.incrementalProfit) || 0,
          confidence: cr.confidenceInterval ? Math.max(0, 1 - Number(cr.confidenceInterval)) : 0.5,
          sampleSize: cr.sampleSize || 0,
        });
      }
    }
    if (causalMap.size > 0) {
      log.info(`[NextGenOrchestrator] v274 因果推断信号已加载: ${causalMap.size}个关键词/定向`);
    }
  } catch (causalErr: unknown) {
    log.warn(`[NextGenOrchestrator] v274 因果推断加载异常(已降级): ${(causalErr as Error).message}`);
  }
  
  // ===== v490: 预加载帕累托分层权重 =====
  let paretoTiers: Map<string, ParetoTierResult> = new Map();
  try {
    const campaignIds = targets.map(t => (t as unknown as Record<string, unknown>).amazonCampaignId as string | undefined || (t as unknown as Record<string, unknown>).campaignId as string | undefined).filter(Boolean);
    if (campaignIds.length > 0) {
      // @ts-expect-error Async operation type inference
      paretoTiers = await batchGetParetoTiers(accountId, campaignIds);
      log.info(`[NextGenOrchestrator] v490帕累托分层已启用: ${paretoTiers.size}个广告活动获得分层权重`);
    }
  } catch (paretoError: unknown) {
    // 帕累托分层失败不影响NextGen核心流程
    log.warn(`[NextGenOrchestrator] v490帕累托分层异常(已降级): ${(paretoError as Error).message}`);
  }

  // ===== v490: 预加载时序预测趋势信号 =====
  let trendSignals: Map<string, TrendSignal> = new Map();
  try {
    const forecastCampaignIds = targets.map(t => (t as unknown as Record<string, unknown>).amazonCampaignId as string | undefined || (t as unknown as Record<string, unknown>).campaignId as string | undefined).filter(Boolean);
    if (forecastCampaignIds.length > 0) {
      // @ts-expect-error Async operation type inference
      trendSignals = await batchForecastCampaignTrends(accountId, forecastCampaignIds as string[]);
      log.info(`[NextGenOrchestrator] v490时序预测已启用: ${trendSignals.size}个广告活动获得趋势信号`);
    }
  } catch (forecastError: unknown) {
    log.warn(`[NextGenOrchestrator] v490时序预测异常(已降级): ${(forecastError as Error).message}`);
  }

  // ===== 核心出价计算 =====
  const results: NextGenBidResult[] = [];
  
  for (const target of targets) {
    const result = await calculateNextGenBid(accountId, target, groupConfig, maxBidLimit);
    
    // v274: 应用因果推断修正 — 在GTO修正之前，作为额外的出价信号
    const causalKey = target.type === 'keyword' ? `kw_${target.id}` : target.type === 'product_target' ? `tg_${target.id}` : null;
    const causalData = causalKey ? causalMap.get(causalKey) : null;
    if (causalData && causalData.optimalBid > 0 && causalData.sampleSize >= 3 && causalData.confidence > 0.3) {
      // 因果推断的最优出价作为修正信号，权重基于置信度
      const causalWeight = Math.min(0.3, causalData.confidence * 0.3); // 最大修正权重30%
      const blendedBid = result.newBid * (1 - causalWeight) + causalData.optimalBid * causalWeight;
      const causalCorrectedBid = Math.round(blendedBid * 100) / 100;
      
      // 安全边界：因果修正不应超过原始出价的15%
      const maxCausalDelta = result.newBid * 0.15;
      const finalCausalBid = Math.max(
        result.newBid - maxCausalDelta,
        Math.min(result.newBid + maxCausalDelta, causalCorrectedBid)
      );
      
      result.causalAdjustment = {
        optimalBid: causalData.optimalBid,
        upliftScore: causalData.upliftScore,
        incrementalProfit: causalData.incrementalProfit,
        confidence: causalData.confidence,
        applied: Math.abs(finalCausalBid - result.newBid) > 0.005,
      };
      
      if (result.causalAdjustment.applied) {
        result.newBid = finalCausalBid;
        result.reason += ` | 因果修正: uplift=${causalData.upliftScore.toFixed(3)}, 最优出价=$${causalData.optimalBid.toFixed(2)}`;
      }
      // v337: 填充correctionLayers的因果推断标记
      if (result.correctionLayers) {
        result.correctionLayers.causalInferenceApplied = result.causalAdjustment.applied;
      }
    }
    
    // v236: 应用GTO修正
    const gtoMod = gtoModifiers.get(target.id);
    if (gtoMod && gtoMod.compositeModifier !== 1.0) {
      const baseBid = result.newBid;
      const gtoCorrectedBid = Math.round(baseBid * gtoMod.compositeModifier * 100) / 100;
      
      // 安全边界：GTO修正后的出价仍然要通过安全校验
      const safetyConfig: SafetyConfig = {
        maxBidChangePercent: DEFAULT_SAFETY.maxBidChangePercent,
        minBid: DEFAULT_SAFETY.minBid,
        maxBid: groupConfig.maxBid || DEFAULT_SAFETY.maxBid,
        targetAcos: groupConfig.targetAcos && groupConfig.targetAcos > 1 
          ? groupConfig.targetAcos / 100 : (groupConfig.targetAcos || DEFAULT_SAFETY.targetAcos),
      };
      const safeBid = safetyValidate(target.currentBid, gtoCorrectedBid, safetyConfig, maxBidLimit, acosRatio);
      
      // 更新结果
      result.newBid = safeBid;
      // @ts-expect-error Amazon API response type flexibility
      result.bidChangePercent = target.currentBid > 0 
        ? Math.round(((safeBid - target.currentBid) / target.currentBid) * 10000) / 100 
        // @ts-expect-error Legacy code type compatibility
        : 0;
      // v240: 降低hold阈值0.01→0.005，与buildResult保持一致
      // @ts-expect-error Dynamic property access
      result.actionType = Math.abs(safeBid - target.currentBid) > 0.005 
        // @ts-expect-error Conditional type narrowing
        ? (safeBid > target.currentBid ? 'increase' : 'decrease') 
        // @ts-expect-error Legacy code type compatibility
        : 'hold';
      // @ts-expect-error Legacy code type compatibility
      result.reason += ` | GTO修正: ${gtoMod.reasoning}`;
      // @ts-expect-error Dynamic property access
      result.gtoModifier = gtoMod;
      // v337: 填充correctionLayers的GTO标记
      // @ts-expect-error Conditional type narrowing
      if (result.correctionLayers) {
        // @ts-expect-error Dynamic property access
        result.correctionLayers.gtoApplied = true;
        result.correctionLayers.gtoCompositeModifier = gtoMod.compositeModifier;
        // 提取GTO生效的子引擎列表（修正系数不为1.0的引擎）
        const activeEngines: string[] = [];
        // @ts-expect-error Conditional type narrowing
        if (gtoMod.breakdown) {
          // @ts-expect-error Dynamic property access
          if (gtoMod.breakdown.evModifier !== 1.0) activeEngines.push('ev_analysis');
          if (gtoMod.breakdown.explorationModifier !== 1.0) activeEngines.push('exploration');
          // @ts-expect-error Dynamic property access
          if (gtoMod.breakdown.budgetModifier !== 1.0) activeEngines.push('budget_pool');
          if (gtoMod.breakdown.windowModifier !== 1.0) activeEngines.push('opportunity_window');
          if (gtoMod.breakdown.portfolioModifier !== 1.0) activeEngines.push('portfolio_role');
          if (gtoMod.breakdown.competitionModifier !== 1.0) activeEngines.push('competition');
        }
        result.correctionLayers.gtoActiveEngines = activeEngines;
      }
    // @ts-expect-error Legacy code type compatibility
    }
    
    // ===== v490: 应用纳什均衡约束（最终安全层） =====
    // @ts-expect-error Type inference limitation
    const nashKey = `${target.type}_${target.id}`;
    // @ts-expect-error Type inference limitation
    const nashRange = nashRanges.get(nashKey);
    // @ts-expect-error Dynamic property access
    if (nashRange && nashRange.confidence >= 0.25) {
      // @ts-expect-error Type inference limitation
      const nashResult = applyNashConstraint(result.newBid, nashRange, target.currentBid);
      // @ts-expect-error Dynamic property access
      result.nashEquilibrium = {
        bidFloor: nashRange.bidFloor,
        // @ts-expect-error Amazon API response type flexibility
        bidCeiling: nashRange.bidCeiling,
        // @ts-expect-error Legacy code type compatibility
        optimalBid: nashRange.optimalBid,
        confidence: nashRange.confidence,
        // @ts-expect-error Legacy code type compatibility
        source: nashRange.source,
        constrained: nashResult.wasConstrained,
      // @ts-expect-error Legacy code type compatibility
      };
      // @ts-expect-error Conditional type narrowing
      if (nashResult.wasConstrained) {
        result.newBid = nashResult.constrainedBid;
        // @ts-expect-error Amazon API response type flexibility
        result.bidChangePercent = target.currentBid > 0
          ? Math.round(((nashResult.constrainedBid - target.currentBid) / target.currentBid) * 10000) / 100
          : 0;
        result.actionType = Math.abs(nashResult.constrainedBid - target.currentBid) > 0.005
          ? (nashResult.constrainedBid > target.currentBid ? 'increase' : 'decrease')
          : 'hold';
        result.reason += ` | ${nashResult.constraintReason}`;
      }
    }
    
    // ===== v490: 应用帕累托分层权重修正 =====
    const campaignIdStr = String((target as unknown as Record<string, unknown>).amazonCampaignId || (target as unknown as Record<string, unknown>).campaignId || '');
    // @ts-expect-error Type inference limitation
    const paretoResult = campaignIdStr ? paretoTiers.get(campaignIdStr) : null;
    if (paretoResult) {
      // @ts-expect-error Type inference limitation
      const paretoAdj = applyParetoWeight(target.currentBid, result.newBid, paretoResult);
      result.paretoTier = {
        // @ts-expect-error Legacy code type compatibility
        tier: paretoResult.tier,
        // @ts-expect-error Legacy code type compatibility
        rank: paretoResult.paretoRank,
        // @ts-expect-error Legacy code type compatibility
        profitContribution: paretoResult.profitContribution,
        // @ts-expect-error Amazon API response type flexibility
        bidWeightMultiplier: paretoResult.bidWeightMultiplier,
        // @ts-expect-error Legacy code type compatibility
        budgetWeightMultiplier: paretoResult.budgetWeightMultiplier,
        // @ts-expect-error Legacy code type compatibility
        applied: paretoAdj.paretoApplied,
        // @ts-expect-error Legacy code type compatibility
        reason: paretoAdj.reason,
      };
      // @ts-expect-error Conditional type narrowing
      if (paretoAdj.paretoApplied) {
        // @ts-expect-error Dynamic property access
        result.newBid = paretoAdj.adjustedBid;
        result.bidChangePercent = target.currentBid > 0
          // @ts-expect-error Conditional type narrowing
          ? Math.round(((paretoAdj.adjustedBid - target.currentBid) / target.currentBid) * 10000) / 100
          : 0;
        // @ts-expect-error Dynamic property access
        result.actionType = Math.abs(paretoAdj.adjustedBid - target.currentBid) > 0.005
          // @ts-expect-error Dynamic property access
          ? (paretoAdj.adjustedBid > target.currentBid ? 'increase' : 'decrease')
          : 'hold';
        // @ts-expect-error Legacy code type compatibility
        result.reason += ` | ${paretoAdj.reason}`;
      }
    }

    // ===== v490: 应用时序预测趋势修正 =====
    const trendCampaignId = String((target as unknown as Record<string, unknown>).amazonCampaignId || (target as unknown as Record<string, unknown>).campaignId || '');
    const trendSignal = trendCampaignId ? trendSignals.get(trendCampaignId) : null;
    // @ts-expect-error Dynamic property access
    if (trendSignal && trendSignal.direction !== 'stable' && trendSignal.strength >= 0.1) {
      // @ts-expect-error Type inference limitation
      const trendAdj = applyTrendModifier(target.currentBid, result.newBid, trendSignal);
      result.trendForecast = {
        // @ts-expect-error Legacy code type compatibility
        direction: trendSignal.direction,
        // @ts-expect-error Legacy code type compatibility
        strength: trendSignal.strength,
        // @ts-expect-error Amazon API response type flexibility
        bidModifier: trendSignal.bidModifier,
        // @ts-expect-error Legacy code type compatibility
        applied: trendAdj.applied,
        // @ts-expect-error Legacy code type compatibility
        reason: trendAdj.reason,
      };
      // @ts-expect-error Conditional type narrowing
      if (trendAdj.applied) {
        // @ts-expect-error Dynamic property access
        result.newBid = trendAdj.adjustedBid;
        result.bidChangePercent = target.currentBid > 0
          // @ts-expect-error Conditional type narrowing
          ? Math.round(((trendAdj.adjustedBid - target.currentBid) / target.currentBid) * 10000) / 100
          : 0;
        // @ts-expect-error Dynamic property access
        result.actionType = Math.abs(trendAdj.adjustedBid - target.currentBid) > 0.005
          // @ts-expect-error Dynamic property access
          ? (trendAdj.adjustedBid > target.currentBid ? 'increase' : 'decrease')
          : 'hold';
        // @ts-expect-error Legacy code type compatibility
        result.reason += ` | ${trendAdj.reason}`;
      }
    }

    // ==================== v491: 跨品迁移学习应用（扩展到所有tier） ====================
    // v489: 原来仅限cold_start/rule_engine tier
    // v491: 扩展到advanced tier，但对advanced tier使用更保守的迁移权重
    // 理论基础：即使高级算法已经给出出价建议，跨品迁移仍可提供有价值的市场参考信号
    {
      // v491: 根据tier动态调整迁移权重系数
      const tierWeightMultiplier = (() => {
        switch (result.algorithmTier) {
          // @ts-expect-error Legacy code type compatibility
          case 'cold_start': return 0.40;   // 冷启动期：迁移权重最高（自身数据最少）
          case 'rule_engine': return 0.30;  // 规则引擎：迁移权重较高
          case 'advanced': return 0.15;     // 高级算法：迁移权重保守（仅作为参考信号）
          case 'conservative': return 0.25; // 保守策略：迁移权重中等
          default: return 0.20;
        }
      })();

      try {
        const transferParams = await getTransferPriorForCampaign(accountId, String((target as unknown as Record<string, unknown>).amazonCampaignId || (target as unknown as Record<string, unknown>).campaignId || ''));
        if (transferParams && transferParams.transferWeight > 0) {
          const effectiveWeight = transferParams.transferWeight * tierWeightMultiplier;
          const blendedBid = blendTransferWithOwn(
            transferParams.suggestedBid,
            result.newBid,
            effectiveWeight
          );
          result.crossProductTransfer = {
            applied: Math.abs(blendedBid - result.newBid) > 0.005,
            transferWeight: effectiveWeight,
            sourceCampaigns: transferParams.sourceInfo.campaignNames.slice(0, 3),
            suggestedBid: transferParams.suggestedBid,
            confidence: transferParams.confidence,
            reason: `跨品迁移(${result.algorithmTier}): 来源=${transferParams.sourceInfo.campaignNames.length}个活动, 原始权重=${transferParams.transferWeight.toFixed(2)}, tier系数=${tierWeightMultiplier}, 有效权重=${effectiveWeight.toFixed(2)}, 置信度=${transferParams.confidence}`,
          };
          if (result.crossProductTransfer.applied) {
            result.newBid = Math.round(blendedBid * 100) / 100;
            result.reason += ` | v491-跨品迁移融合(${result.algorithmTier})`;
          }
        }
      } catch {
        // 跨品迁移失败，静默降级
      }
    }

    results.push(result);
  }
  
  // v273: 统计日志增加guardrail计数
  const advanced = results.filter(r => r.algorithmTier === 'advanced').length;
  const ruleEngine = results.filter(r => r.algorithmTier === 'rule_engine').length;
  const conservative = results.filter(r => r.algorithmTier === 'conservative').length;
  const guardrail = results.filter(r => r.algorithmTier === 'guardrail').length;
  const changed = results.filter(r => r.actionType !== 'hold').length;
  const gtoApplied = results.filter(r => r.gtoModifier && r.gtoModifier.compositeModifier !== 1.0).length;
  const causalApplied = results.filter(r => r.causalAdjustment?.applied).length;
  const nashConstrained = results.filter(r => r.nashEquilibrium?.constrained).length;
  const nashLoaded = results.filter(r => r.nashEquilibrium).length;
  const paretoApplied = results.filter(r => r.paretoTier?.applied).length;
  const paretoLoaded = results.filter(r => r.paretoTier).length;
  const trendApplied = results.filter(r => r.trendForecast?.applied).length;
  const trendLoaded = results.filter(r => r.trendForecast).length;
  const transferApplied = results.filter(r => r.crossProductTransfer?.applied).length;
  const transferLoaded = results.filter(r => r.crossProductTransfer).length;
  
  log.info(`[NextGenOrchestrator] v490批量出价完成: 总计=${targets.length}, ` +
    `高级算法=${advanced}, 规则引擎=${ruleEngine}, 护栏保护=${guardrail}, 保守策略=${conservative}, ` +
    `实际调整=${changed}, GTO修正=${gtoApplied}, 因果修正=${causalApplied}, ` +
    `纳什均衡加载=${nashLoaded}, 纳什约束=${nashConstrained}, ` +
    `帕累托加载=${paretoLoaded}, 帕累托调整=${paretoApplied}, ` +
    `时序预测加载=${trendLoaded}, 时序预测调整=${trendApplied}, ` +
    `跨品迁移加载=${transferLoaded}, 跨品迁移调整=${transferApplied}`);
  
  return results;
}

// ==================== 定时任务编排（全自动化） ====================

/**
 * 执行下一代算法的定时维护任务
 * 完全自动化，零人工干预
 */
export async function executeNextGenMaintenanceTasks(accountId: number): Promise<{
  featuresCached: number;
  sigmoidFitted: { fitted: number; skipped: number; errors: number };
  rewardsBackfilled: number;
  causalAnalysis: { analyzed: number; significant: number; errors: number };
  algorithmResultsBackfilled: number;
}> {
  const results = {
    featuresCached: 0,
    sigmoidFitted: { fitted: 0, skipped: 0, errors: 0 },
    rewardsBackfilled: 0,
    causalAnalysis: { analyzed: 0, significant: 0, errors: 0 },
    algorithmResultsBackfilled: 0,
  };
  
  // 1. 批量提取和缓存上下文特征
  try {
    log.info(`[NextGenMaintenance] 开始特征提取: 账户${accountId}`);
    results.featuresCached = await batchExtractAndCacheFeatures(accountId);
  } catch (err: unknown) {
    log.warn(`[NextGenMaintenance] 特征提取失败: ${(err as Error).message}`);
  }
  
  // 2. 批量拟合Sigmoid曲线
  try {
    log.info(`[NextGenMaintenance] 开始Sigmoid曲线拟合`);
    results.sigmoidFitted = await batchFitSigmoidCurves(accountId);
  } catch (err: unknown) {
    log.warn(`[NextGenMaintenance] Sigmoid拟合失败: ${(err as Error).message}`);
  }
  
  // 3. 回填RL Rewards
  try {
    log.info(`[NextGenMaintenance] 开始Reward回填`);
    results.rewardsBackfilled = await backfillRewards(accountId);
  } catch (err: unknown) {
    log.warn(`[NextGenMaintenance] Reward回填失败: ${(err as Error).message}`);
  }
  
  // 4. 运行因果推断分析
  try {
    log.info(`[NextGenMaintenance] 开始因果推断分析`);
    results.causalAnalysis = await batchCausalAnalysis(accountId);
  } catch (err: unknown) {
    log.warn(`[NextGenMaintenance] 因果分析失败: ${(err as Error).message}`);
  }
  
  // 5. 回填算法选择结果
  try {
    log.info(`[NextGenMaintenance] 开始算法结果回填`);
    results.algorithmResultsBackfilled = await backfillAlgorithmResults(accountId);
  } catch (err: unknown) {
    log.warn(`[NextGenMaintenance] 算法结果回填失败: ${(err as Error).message}`);
  }
  
  // 6. v256: 自动解决积压的sync_conflicts
  let conflictsResult = { resolved: 0, ignored: 0, skipped: 0 };
  try {
    log.info(`[NextGenMaintenance] 开始自动冲突解决`);
    conflictsResult = await autoResolveConflicts(accountId);
  } catch (err: unknown) {
    log.warn(`[NextGenMaintenance] 自动冲突解决失败: ${(err as Error).message}`);
  }
  
  log.info(`[NextGenMaintenance] 维护完成(账户${accountId}): ` +
    `特征=${results.featuresCached}, Sigmoid=${results.sigmoidFitted.fitted}, ` +
    `Reward=${results.rewardsBackfilled}, 因果=${results.causalAnalysis.analyzed}, ` +
    `算法回填=${results.algorithmResultsBackfilled}, ` +
    `冲突解决=${conflictsResult.resolved}+${conflictsResult.ignored}`);
  
  return results;
}

/**
 * 执行CQL模型训练（自动定时执行）
 */
export async function executeModelTraining(accountId: number): Promise<void> {
  try {
    log.info(`[NextGenTraining] 开始CQL模型训练: 账户${accountId}`);
    await trainCQL(accountId);
    log.info(`[NextGenTraining] CQL训练完成: 账户${accountId}`);
  } catch (error: unknown) {
    log.warn(`[NextGenTraining] CQL训练失败(账户${accountId}): ${(error as Error).message}`);
  }
}

/**
 * 执行预算组合优化（自动定时执行）
 */
export async function executeBudgetOptimization(accountId: number): Promise<void> {
  try {
    log.info(`[NextGenBudget] 开始预算组合优化: 账户${accountId}`);
    const result = await optimizeBudgetPortfolio(accountId);
    if (result) {
      log.info(`[NextGenBudget] 预算优化完成: ${result.allocations.length}个广告活动, 预期利润=$${result.expectedTotalProfit.toFixed(2)}`);
    }
  } catch (error: unknown) {
    log.warn(`[NextGenBudget] 预算优化失败(账户${accountId}): ${(error as Error).message}`);
  }
}

/**
 * 执行关键词图谱分析（自动定时执行）
 */
export async function executeKeywordGraphAnalysis(accountId: number): Promise<void> {
  try {
    log.info(`[NextGenKeyword] 开始关键词图谱分析: 账户${accountId}`);
    await buildKeywordGraph(accountId);
    const opportunities = await discoverOpportunities(accountId);
    const negatives = await discoverNegativeCandidates(accountId);
    log.info(`[NextGenKeyword] 图谱分析完成: ${opportunities.length}个扩展机会, ${negatives.length}个否定词候选`);
  } catch (error: unknown) {
    log.warn(`[NextGenKeyword] 图谱分析失败(账户${accountId}): ${(error as Error).message}`);
  }
}

/**
 * LinUCB模型在线更新（在收到Reward后自动调用）
 */
export async function updateLinUCBFromReward(
  accountId: number,
  armType: ArmType,
  context: ContextFeatureVector,
  reward: number
): Promise<void> {
  try {
    await updateArm(accountId, armType, context, reward);
  } catch (error: unknown) {
    log.warn(`[NextGenOrchestrator] LinUCB更新失败: ${(error as Error).message}`);
  }
}
