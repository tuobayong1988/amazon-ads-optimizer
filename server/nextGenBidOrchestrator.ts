/**
 * 下一代出价编排器 (Next-Gen Bid Orchestrator)
 * 
 * 核心职责：
 * 1. 作为所有新算法模块的统一入口，与现有bidOptimizer无缝集成
 * 2. 编排算法执行流程：特征提取 → 元学习选择 → 算法执行 → RL记录 → 安全校验
 * 3. 提供渐进式升级路径：初期与现有算法并行运行，逐步过渡
 * 4. 管理定时任务：特征缓存、模型训练、Reward回填、因果分析
 * 
 * 集成架构：
 * ┌─────────────────────────────────────────────────────┐
 * │                 nextGenBidOrchestrator               │
 * │                                                      │
 * │  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │
 * │  │ Feature  │→│   Meta   │→│  Algorithm Engine  │   │
 * │  │ Pipeline │  │ Selector │  │ LinUCB/CQL/Sigmoid│   │
 * │  └──────────┘  └──────────┘  └──────────────────┘   │
 * │       ↑                              ↓               │
 * │  ┌──────────┐              ┌──────────────────┐     │
 * │  │ Causal   │              │   RL Recorder    │     │
 * │  │ Inference│              │  (State-Action)  │     │
 * │  └──────────┘              └──────────────────┘     │
 * │                                                      │
 * │  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │
 * │  │ Budget   │  │ Keyword  │  │ Safety Validator  │   │
 * │  │ Portfolio│  │  Graph   │  │ (Rate Limiter)   │   │
 * │  └──────────┘  └──────────┘  └──────────────────┘   │
 * └─────────────────────────────────────────────────────┘
 */
import { getDb } from "./db";
import {
  batchExtractAndCacheFeatures,
  extractFeatureVector,
  getCachedFeatureVector,
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

// ==================== 类型定义 ====================

export interface NextGenBidResult {
  targetId: number;
  targetType: 'keyword' | 'product_target';
  previousBid: number;
  newBid: number;
  actionType: 'increase' | 'decrease' | 'set';
  bidChangePercent: number;
  reason: string;
  // 下一代算法元数据
  algorithmUsed: string;
  confidence: number;
  metaDecision?: MetaDecision;
  isNextGenAlgorithm: boolean;
}

export interface OrchestratorConfig {
  // 是否启用下一代算法（渐进式开关）
  enableNextGen: boolean;
  // 下一代算法的流量比例（0-1，用于A/B测试）
  nextGenTrafficRatio: number;
  // 最大单次出价变化幅度
  maxBidChangePercent: number;
  // 最小出价
  minBid: number;
  // 最大出价
  maxBid: number;
}

const DEFAULT_CONFIG: OrchestratorConfig = {
  enableNextGen: true,
  nextGenTrafficRatio: 0.3,  // 初始30%流量使用新算法
  maxBidChangePercent: 0.30,
  minBid: 0.02,
  maxBid: 10.00,
};

// ==================== 辅助函数 ====================

async function getDbInstance() {
  const db = await getDb();
  if (!db) throw new Error('Database connection failed');
  return db;
}

/**
 * 安全校验器：确保出价调整在安全范围内
 */
function safetyValidate(
  currentBid: number,
  proposedBid: number,
  config: OrchestratorConfig
): number {
  let safeBid = proposedBid;
  
  // 1. 绝对范围限制
  safeBid = Math.max(config.minBid, Math.min(config.maxBid, safeBid));
  
  // 2. 单次变化幅度限制
  const maxIncrease = currentBid * (1 + config.maxBidChangePercent);
  const maxDecrease = currentBid * (1 - config.maxBidChangePercent);
  safeBid = Math.max(maxDecrease, Math.min(maxIncrease, safeBid));
  
  // 3. 精度控制
  safeBid = Math.round(safeBid * 100) / 100;
  
  // 4. 最终兜底
  safeBid = Math.max(config.minBid, safeBid);
  
  return safeBid;
}

/**
 * 判断是否应该使用下一代算法（基于流量分配）
 */
function shouldUseNextGen(targetId: number, config: OrchestratorConfig): boolean {
  if (!config.enableNextGen) return false;
  
  // 使用targetId的哈希值进行确定性分流
  const hash = targetId * 2654435761 % 1000;
  return hash < config.nextGenTrafficRatio * 1000;
}

// ==================== 核心编排逻辑 ====================

/**
 * 为单个关键词/定位计算下一代出价
 */
export async function calculateNextGenBid(
  accountId: number,
  target: OptimizationTarget,
  groupConfig: PerformanceGroupConfig,
  config: OrchestratorConfig = DEFAULT_CONFIG
): Promise<NextGenBidResult | null> {
  // 判断是否使用新算法
  if (!shouldUseNextGen(target.id, config)) {
    return null; // 返回null表示使用现有算法
  }
  
  try {
    // 1. 元学习选择最优算法
    const keywordId = target.type === 'keyword' ? target.id : undefined;
    const targetId = target.type === 'product_target' ? target.id : undefined;
    
    const metaDecision = await selectBestAlgorithm(
      accountId, keywordId, targetId, undefined, target.currentBid
    );
    
    // 2. 安全校验
    const safeBid = safetyValidate(target.currentBid, metaDecision.recommendedBid, config);
    
    // 3. 记录RL数据
    const bidAction: BidAction = {
      accountId,
      keywordId,
      targetId,
      bidBefore: target.currentBid,
      bidAfter: safeBid,
      actionSource: metaDecision.selectedAlgorithm === 'rule_based' ? 'rule_based' :
                    metaDecision.selectedAlgorithm === 'linucb' ? 'linucb' :
                    metaDecision.selectedAlgorithm === 'cql' ? 'cql' : 'rule_based',
    };
    
    // 异步记录，不阻塞主流程
    recordBidAction(bidAction).catch(err => {
      console.error('[NextGenOrchestrator] RL recording error:', err);
    });
    
    // 4. 构建结果
    const bidChangePercent = target.currentBid > 0
      ? ((safeBid - target.currentBid) / target.currentBid) * 100
      : 0;
    
    let actionType: 'increase' | 'decrease' | 'set' = 'set';
    if (safeBid > target.currentBid) actionType = 'increase';
    else if (safeBid < target.currentBid) actionType = 'decrease';
    
    return {
      targetId: target.id,
      targetType: target.type,
      previousBid: target.currentBid,
      newBid: safeBid,
      actionType,
      bidChangePercent: Math.round(bidChangePercent * 100) / 100,
      reason: `[NextGen:${metaDecision.selectedAlgorithm}] ${metaDecision.reasoning}`,
      algorithmUsed: metaDecision.selectedAlgorithm,
      confidence: metaDecision.confidence,
      metaDecision,
      isNextGenAlgorithm: true,
    };
    
  } catch (error) {
    console.error(`[NextGenOrchestrator] Error calculating bid for target ${target.id}:`, error);
    return null; // 出错时回退到现有算法
  }
}

// ==================== 定时任务编排 ====================

/**
 * 执行下一代算法的定时维护任务
 * 应在dataSyncScheduler的低频同步路径中调用
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
  
  try {
    // 1. 批量提取和缓存上下文特征
    console.log(`[NextGenOrchestrator] Starting feature extraction for account ${accountId}`);
    results.featuresCached = await batchExtractAndCacheFeatures(accountId);
    
    // 2. 批量拟合Sigmoid曲线
    console.log(`[NextGenOrchestrator] Starting sigmoid curve fitting`);
    results.sigmoidFitted = await batchFitSigmoidCurves(accountId);
    
    // 3. 回填RL Rewards
    console.log(`[NextGenOrchestrator] Backfilling RL rewards`);
    results.rewardsBackfilled = await backfillRewards(accountId);
    
    // 4. 运行因果推断分析
    console.log(`[NextGenOrchestrator] Running causal inference analysis`);
    results.causalAnalysis = await batchCausalAnalysis(accountId);
    
    // 5. 回填算法选择结果
    console.log(`[NextGenOrchestrator] Backfilling algorithm selection results`);
    results.algorithmResultsBackfilled = await backfillAlgorithmResults(accountId);
    
    console.log(`[NextGenOrchestrator] Maintenance complete for account ${accountId}:`, JSON.stringify(results));
    
  } catch (error) {
    console.error(`[NextGenOrchestrator] Maintenance error for account ${accountId}:`, error);
  }
  
  return results;
}

/**
 * 执行CQL模型训练（低频任务，每6小时一次）
 */
export async function executeModelTraining(accountId: number): Promise<void> {
  try {
    console.log(`[NextGenOrchestrator] Starting CQL model training for account ${accountId}`);
    await trainCQL(accountId);
    console.log(`[NextGenOrchestrator] CQL training complete`);
  } catch (error) {
    console.error(`[NextGenOrchestrator] CQL training error:`, error);
  }
}

/**
 * 执行预算组合优化（每日一次）
 */
export async function executeBudgetOptimization(accountId: number): Promise<void> {
  try {
    console.log(`[NextGenOrchestrator] Starting budget portfolio optimization for account ${accountId}`);
    const result = await optimizeBudgetPortfolio(accountId);
    if (result) {
      console.log(`[NextGenOrchestrator] Budget optimization complete: ${result.allocations.length} campaigns, expected profit: $${result.expectedTotalProfit}`);
    }
  } catch (error) {
    console.error(`[NextGenOrchestrator] Budget optimization error:`, error);
  }
}

/**
 * 执行关键词图谱分析（每日一次）
 */
export async function executeKeywordGraphAnalysis(accountId: number): Promise<void> {
  try {
    console.log(`[NextGenOrchestrator] Starting keyword graph analysis for account ${accountId}`);
    
    // 构建图谱
    await buildKeywordGraph(accountId);
    
    // 发现扩展机会
    const opportunities = await discoverOpportunities(accountId);
    console.log(`[NextGenOrchestrator] Found ${opportunities.length} keyword opportunities`);
    
    // 发现否定词候选
    const negatives = await discoverNegativeCandidates(accountId);
    console.log(`[NextGenOrchestrator] Found ${negatives.length} negative keyword candidates`);
    
  } catch (error) {
    console.error(`[NextGenOrchestrator] Keyword graph analysis error:`, error);
  }
}

/**
 * LinUCB模型在线更新（在收到Reward后调用）
 */
export async function updateLinUCBFromReward(
  accountId: number,
  armType: ArmType,
  context: ContextFeatureVector,
  reward: number
): Promise<void> {
  try {
    await updateArm(accountId, armType, context, reward);
  } catch (error) {
    console.error(`[NextGenOrchestrator] LinUCB update error:`, error);
  }
}
