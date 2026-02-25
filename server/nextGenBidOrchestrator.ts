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
import { getDb } from "./db";
import {
  batchExtractAndCacheFeatures,
  extractFeatureVector,
  type ContextFeatureVector,
} from "./contextualFeatureService";
import { recordBidAction, backfillRewards, type BidAction } from "./rlDataRecorder";
import { batchFitSigmoidCurves } from "./sigmoidCurveFitter";
import { updateArm, type ArmType } from "./contextualBanditService";
import { batchCausalAnalysis } from "./causalInferenceEngine";
import { trainCQL } from "./offlineRLService";
import { selectBestAlgorithm, backfillAlgorithmResults, type MetaDecision } from "./metaLearningSelector";
import { optimizeBudgetPortfolio } from "./budgetPortfolioOptimizer";
import { buildKeywordGraph, discoverOpportunities, discoverNegativeCandidates } from "./keywordGraphService";
import type { OptimizationTarget, PerformanceGroupConfig } from "./bidOptimizer";
import { createModuleLogger } from './utils/logger';

const log = createModuleLogger('NextGen');

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
  /** 算法降级链中实际使用的层级: 'advanced' | 'rule_engine' | 'conservative' */
  algorithmTier: 'advanced' | 'rule_engine' | 'conservative';
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
  maxBidChangePercent: 0.30,
  minBid: 0.02,
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
  maxBidLimit?: number
): number {
  // v231: NaN/Infinity防御 - 确保输入有效
  if (!isFinite(proposedBid) || isNaN(proposedBid)) {
    return currentBid > 0 ? currentBid : config.minBid;
  }
  if (!isFinite(currentBid) || isNaN(currentBid)) {
    return Math.max(config.minBid, Math.min(config.maxBid, proposedBid));
  }
  let safeBid = proposedBid;
  
  // 1. 绝对范围限制
  const effectiveMaxBid = maxBidLimit ? Math.min(config.maxBid, maxBidLimit) : config.maxBid;
  safeBid = Math.max(config.minBid, Math.min(effectiveMaxBid, safeBid));
  
  // 2. 单次变化幅度限制
  if (currentBid > 0) {
    const maxIncrease = currentBid * (1 + config.maxBidChangePercent);
    // v232: 增强安全护栏 - 当提议的出价降幅超过30%时，允许最大50%的降幅以加速止损
    // 这确保规则引擎计算的紧急降价不会被安全阀截断
    const proposedDecrease = (currentBid - safeBid) / currentBid;
    const decreasePercent = proposedDecrease > config.maxBidChangePercent ? 0.50 : config.maxBidChangePercent;
    const maxDecrease = currentBid * (1 - decreasePercent);

    safeBid = Math.max(maxDecrease, Math.min(maxIncrease, safeBid));
  }
  
  // 3. 精度控制
  safeBid = Math.round(safeBid * 100) / 100;
  
  // 4. 最终兜底
  safeBid = Math.max(config.minBid, safeBid);
  
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
  // v231: 防御性转换 — 即使上层已转换，此处仍做兜底检查
  const rawAcos = groupConfig.targetAcos || 0.30;
  const targetAcos = rawAcos > 1 ? rawAcos / 100 : rawAcos;
  const maxBid = groupConfig.maxBid || 10.00;
  
  // v230: 确定性哈希函数，替代Math.random()，确保相同关键词在相同条件下产生相同的调整比例
  const deterministicHash = (id: number, seed: number = 0): number => {
    let h = ((id * 2654435761 + seed) >>> 0) % 10000;
    return h / 10000; // 返回0~1之间的确定性值
  };
  const entityId = (target as any).keywordId || (target as any).targetId || 0;
  
  // 场景1: 零曝光 — 需要提升可见性
  if (impressions === 0) {
    // 新关键词或长期零曝光，适度提升出价以获取曝光
    const boostRatio = Math.min(0.15, 0.05 + deterministicHash(entityId, 1) * 0.10); // v230: 5%~15%确定性提升
    const newBid = currentBid * (1 + boostRatio);
    return {
      bid: Math.min(newBid, maxBid),
      confidence: 0.4,
      reason: `零曝光探索: 提升${(boostRatio * 100).toFixed(0)}%以获取曝光数据`,
    };
  }
  
  // 场景2: 有曝光但零点击 — 出价可能过低或相关性差
  if (clicks === 0 && impressions > 0) {
    if (impressions < 100) {
      // 曝光不足，可能需要更多数据
      const boostRatio = Math.min(0.10, 0.03 + deterministicHash(entityId, 2) * 0.07);
      return {
        bid: currentBid * (1 + boostRatio),
        confidence: 0.35,
        reason: `低曝光零点击(${impressions}次): 小幅提升${(boostRatio * 100).toFixed(0)}%`,
      };
    } else {
      // 曝光充足但无点击，可能相关性差，降低出价
      const reduceRatio = Math.min(0.15, 0.05 + (impressions / 1000) * 0.10);
      return {
        bid: currentBid * (1 - reduceRatio),
        confidence: 0.5,
        reason: `高曝光零点击(${impressions}次): 降低${(reduceRatio * 100).toFixed(0)}%`,
      };
    }
  }
  
  // 场景3: 有点击但零订单 — 根据花费判断
  if (orders === 0 && clicks > 0) {
    // 计算每次点击成本
    const cpc = spend / clicks;
    // 如果花费已经超过目标ACOS对应的可接受花费，降低出价
    // 假设平均客单价为当前出价的30倍（保守估计）
    const estimatedAov = currentBid * 30;
    const maxAcceptableSpend = estimatedAov * targetAcos;
    
    if (spend > maxAcceptableSpend) {
      const reduceRatio = Math.min(0.20, (spend / maxAcceptableSpend - 1) * 0.10);
      return {
        bid: currentBid * (1 - reduceRatio),
        confidence: 0.45,
        reason: `零转化高花费($${spend.toFixed(2)}): 降低${(reduceRatio * 100).toFixed(0)}%`,
      };
    }
    
    // 花费在可接受范围内，维持或小幅调整
    return {
      bid: currentBid,
      confidence: 0.4,
      reason: `零转化但花费可控($${spend.toFixed(2)}): 维持出价观察`,
    };
  }
  
  // 场景4: 有订单 — 基于ACOS进行精确调整
  if (orders > 0 && sales > 0) {
    const actualAcos = spend / sales;
    const acosRatio = actualAcos / targetAcos;
    
    if (acosRatio < 0.7) {
      // ACOS远低于目标，有提升空间
      const boostRatio = Math.min(0.20, (1 - acosRatio) * 0.25);
      return {
        bid: currentBid * (1 + boostRatio),
        confidence: 0.7,
        reason: `ACOS优秀(${(actualAcos * 100).toFixed(1)}% vs 目标${(targetAcos * 100).toFixed(1)}%): 提升${(boostRatio * 100).toFixed(0)}%`,
      };
    } else if (acosRatio <= 1.0) {
      // ACOS在目标范围内，小幅优化
      const adjustRatio = (1 - acosRatio) * 0.10;
      return {
        bid: currentBid * (1 + adjustRatio),
        confidence: 0.65,
        reason: `ACOS达标(${(actualAcos * 100).toFixed(1)}%): 微调${(adjustRatio * 100).toFixed(1)}%`,
      };
    } else if (acosRatio <= 1.5) {
      // ACOS略高于目标，适度降低
      const reduceRatio = Math.min(0.15, (acosRatio - 1) * 0.20);
      return {
        bid: currentBid * (1 - reduceRatio),
        confidence: 0.6,
        reason: `ACOS偏高(${(actualAcos * 100).toFixed(1)}%): 降低${(reduceRatio * 100).toFixed(0)}%`,
      };
    } else {
      // ACOS严重超标
            // v232: ACOS严重超标时，启用紧急降价策略
      // 1. 基础降价幅度提高到35%
      // 2. ACOS超出目标越多，降价越快（系数从0.15提高到0.25）
      // 3. 对于亏损极度严重的情况(ACOS > 3*目标)，启用最大50%的降价护栏
      const baseReduceRatio = (acosRatio - 1) * 0.25;
      const reduceRatio = acosRatio > 3 ? Math.min(0.50, baseReduceRatio) : Math.min(0.35, baseReduceRatio);

      return {
        bid: currentBid * (1 - reduceRatio),
        confidence: 0.7,
        reason: `ACOS超标(${(actualAcos * 100).toFixed(1)}%): 降低${(reduceRatio * 100).toFixed(0)}%`,
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
  
  const safetyConfig: SafetyConfig = {
    maxBidChangePercent: DEFAULT_SAFETY.maxBidChangePercent,
    minBid: DEFAULT_SAFETY.minBid,
    maxBid: groupConfig.maxBid || DEFAULT_SAFETY.maxBid,
    targetAcos: normalizedTargetAcos,
  };
  
  // v231: 创建标准化的groupConfig副本，确保所有内部函数使用正确的小数形式targetAcos
  const normalizedConfig: PerformanceGroupConfig = {
    ...groupConfig,
    targetAcos: normalizedTargetAcos,
  };
  
  // ===== 第1层：尝试高级算法 =====
  try {
    const keywordId = target.type === 'keyword' ? target.id : undefined;
    const targetId = target.type === 'product_target' ? target.id : undefined;
    
    const metaDecision = await selectBestAlgorithm(
      accountId, keywordId, targetId, undefined, target.currentBid
    );
    
    // 只有当高级算法（非rule_based/ucb）给出了有效结果时，才使用它
    const isAdvancedAlgorithm = !['rule_based', 'ucb'].includes(metaDecision.selectedAlgorithm);
    const hasValidBid = metaDecision.recommendedBid > 0 && metaDecision.confidence > 0.3;
    
    if (isAdvancedAlgorithm && hasValidBid) {
      const safeBid = safetyValidate(target.currentBid, metaDecision.recommendedBid, safetyConfig, maxBidLimit);
      
      // 异步记录RL数据
      recordBidAction({
        accountId,
        keywordId,
        targetId,
        bidBefore: target.currentBid,
        bidAfter: safeBid,
        actionSource: metaDecision.selectedAlgorithm === 'linucb' ? 'linucb' :
                      metaDecision.selectedAlgorithm === 'cql' ? 'cql' : 'rule_based',
      }).catch(err => log.error('[NextGenOrchestrator] RL recording error:', err));
      
      return buildResult(target, safeBid, metaDecision.selectedAlgorithm, metaDecision.confidence,
        `[高级算法:${metaDecision.selectedAlgorithm}] ${metaDecision.reasoning}`, 'advanced', metaDecision);
    }
    
    // 高级算法不可用（数据不足），自然降级到第2层
    // 不记录为错误，这是正常的算法选择流程
    
  } catch (advancedError: any) {
    // 高级算法执行异常，降级到第2层
    log.warn(`[NextGenOrchestrator] 高级算法异常(target=${target.id}), 降级到规则引擎: ${advancedError.message}`);
  }
  
  // ===== 第2层：规则引擎 =====
  try {
    const ruleResult = ruleEngineDecision(target, normalizedConfig);
    const safeBid = safetyValidate(target.currentBid, ruleResult.bid, safetyConfig, maxBidLimit);
    
    // 规则引擎也记录RL数据（用于未来训练高级算法）
    const keywordId = target.type === 'keyword' ? target.id : undefined;
    const targetId = target.type === 'product_target' ? target.id : undefined;
    recordBidAction({
      accountId,
      keywordId,
      targetId,
      bidBefore: target.currentBid,
      bidAfter: safeBid,
      actionSource: 'rule_based',
    }).catch(err => log.error('[NextGenOrchestrator] RL recording error:', err));
    
    return buildResult(target, safeBid, 'rule_engine', ruleResult.confidence,
      `[规则引擎] ${ruleResult.reason}`, 'rule_engine');
    
  } catch (ruleError: any) {
    log.error(`[NextGenOrchestrator] 规则引擎异常(target=${target.id}): ${ruleError.message}`);
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
  tier: 'advanced' | 'rule_engine' | 'conservative',
  metaDecision?: MetaDecision
): NextGenBidResult {
  const bidChangePercent = target.currentBid > 0
    ? ((newBid - target.currentBid) / target.currentBid) * 100
    : 0;
  
  let actionType: 'increase' | 'decrease' | 'hold' = 'hold';
  if (Math.abs(newBid - target.currentBid) > 0.01) {
    actionType = newBid > target.currentBid ? 'increase' : 'decrease';
  }
  
  return {
    targetId: target.id,
    targetType: target.type,
    previousBid: target.currentBid,
    newBid,
    actionType,
    bidChangePercent: Math.round(bidChangePercent * 100) / 100,
    reason,
    algorithmUsed,
    confidence,
    metaDecision,
    algorithmTier: tier,
  };
}

// ==================== 批量出价优化 ====================

/**
 * 批量计算出价 — 对一组关键词/商品定向统一计算
 * 保证每一个target都有结果
 */
export async function batchCalculateNextGenBids(
  accountId: number,
  targets: OptimizationTarget[],
  groupConfig: PerformanceGroupConfig,
  maxBidLimit?: number
): Promise<NextGenBidResult[]> {
  const results: NextGenBidResult[] = [];
  
  for (const target of targets) {
    const result = await calculateNextGenBid(accountId, target, groupConfig, maxBidLimit);
    results.push(result);
  }
  
  // 统计日志
  const advanced = results.filter(r => r.algorithmTier === 'advanced').length;
  const ruleEngine = results.filter(r => r.algorithmTier === 'rule_engine').length;
  const conservative = results.filter(r => r.algorithmTier === 'conservative').length;
  const changed = results.filter(r => r.actionType !== 'hold').length;
  
  log.info(`[NextGenOrchestrator] 批量出价完成: 总计=${targets.length}, ` +
    `高级算法=${advanced}, 规则引擎=${ruleEngine}, 保守策略=${conservative}, ` +
    `实际调整=${changed}`);
  
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
  } catch (err: any) {
    log.error(`[NextGenMaintenance] 特征提取失败: ${err.message}`);
  }
  
  // 2. 批量拟合Sigmoid曲线
  try {
    log.info(`[NextGenMaintenance] 开始Sigmoid曲线拟合`);
    results.sigmoidFitted = await batchFitSigmoidCurves(accountId);
  } catch (err: any) {
    log.error(`[NextGenMaintenance] Sigmoid拟合失败: ${err.message}`);
  }
  
  // 3. 回填RL Rewards
  try {
    log.info(`[NextGenMaintenance] 开始Reward回填`);
    results.rewardsBackfilled = await backfillRewards(accountId);
  } catch (err: any) {
    log.error(`[NextGenMaintenance] Reward回填失败: ${err.message}`);
  }
  
  // 4. 运行因果推断分析
  try {
    log.info(`[NextGenMaintenance] 开始因果推断分析`);
    results.causalAnalysis = await batchCausalAnalysis(accountId);
  } catch (err: any) {
    log.error(`[NextGenMaintenance] 因果分析失败: ${err.message}`);
  }
  
  // 5. 回填算法选择结果
  try {
    log.info(`[NextGenMaintenance] 开始算法结果回填`);
    results.algorithmResultsBackfilled = await backfillAlgorithmResults(accountId);
  } catch (err: any) {
    log.error(`[NextGenMaintenance] 算法结果回填失败: ${err.message}`);
  }
  
  log.info(`[NextGenMaintenance] 维护完成(账户${accountId}): ` +
    `特征=${results.featuresCached}, Sigmoid=${results.sigmoidFitted.fitted}, ` +
    `Reward=${results.rewardsBackfilled}, 因果=${results.causalAnalysis.analyzed}, ` +
    `算法回填=${results.algorithmResultsBackfilled}`);
  
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
  } catch (error: any) {
    log.error(`[NextGenTraining] CQL训练失败(账户${accountId}): ${error.message}`);
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
  } catch (error: any) {
    log.error(`[NextGenBudget] 预算优化失败(账户${accountId}): ${error.message}`);
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
  } catch (error: any) {
    log.error(`[NextGenKeyword] 图谱分析失败(账户${accountId}): ${error.message}`);
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
  } catch (error: any) {
    log.error(`[NextGenOrchestrator] LinUCB更新失败: ${error.message}`);
  }
}
