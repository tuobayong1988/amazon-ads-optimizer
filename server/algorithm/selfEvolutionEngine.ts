import { createModuleLogger } from "../utils/logger";
const log = createModuleLogger("SelfEvolution");
/**
 * v164: 优化算法自我进化引擎
 * 
 * 三层架构：
 * 1. 效果评估层（Evaluation）：每次优化后7-14天自动评估效果
 * 2. 学习记忆层（Learning）：将效果评估结果转化为可用的学习参数
 * 3. 自动纠错层（AutoCorrection）：发现负面效果自动回滚并调整策略
 * 
 * 核心原则：
 * - 所有优化动作都必须可追踪、可评估、可回滚
 * - 近期数据权重更高（时间衰减加权）
 * - 渐进式调整，保护订单和销量不断崖式下跌
 * - 每个keyword/target积累独立的学习记忆
 */

import { DbInstance, getDb } from '../db';
import { 
  optimizationLogs, 
  keywords, 
  dailyPerformance, 
  campaigns,
  algorithmEffectRecords 
} from '../../drizzle/schema';
import { eq, and, gte, lte, desc, sql, inArray, isNull, isNotNull } from 'drizzle-orm';

// ============================================================
// 类型定义
// ============================================================

/** 优化动作效果评估结果 */
export interface OptimizationEffectAssessment {
  logId: number;
  actionType: string;
  performanceGroupId: number;
  entityId: string;
  entityType: string;
  
  // 优化前指标（时间衰减加权）
  preWeightedAcos: number;
  preWeightedRoas: number;
  preWeightedDailySpend: number;
  preWeightedDailyOrders: number;
  
  // 优化后指标（时间衰减加权）
  postWeightedAcos: number;
  postWeightedRoas: number;
  postWeightedDailySpend: number;
  postWeightedDailyOrders: number;
  
  // 效果评分
  effectScore: number;        // -100 到 100
  effectCategory: 'excellent' | 'positive' | 'neutral' | 'negative' | 'harmful';
  
  // 是否需要纠错
  needsCorrection: boolean;
  correctionType?: 'rollback' | 'partial_rollback' | 'adjust_parameters';
  correctionReason?: string;
}

/** 关键词级别学习记忆 */
export interface KeywordLearningMemory {
  keywordId: number;
  campaignId: number;
  
  // 历史最优出价区间
  optimalBidLow: number;
  optimalBidHigh: number;
  
  // 历史表现统计
  totalOptimizations: number;
  positiveOptimizations: number;
  negativeOptimizations: number;
  avgEffectScore: number;
  
  // 敏感度特征
  bidSensitivity: 'high' | 'medium' | 'low';  // 出价变化对表现的影响程度
  optimalAcosRange: { low: number; high: number };
  
  // 最近一次优化
  lastOptimizationDate: string;
  lastBid: number;
  lastEffectScore: number;
  
  // 学习置信度
  confidence: 'high' | 'medium' | 'low';
}

/** 策略级别学习参数 */
export interface StrategyLearningParams {
  strategyTemplateId: string;
  
  // 各算法的成功率
  algorithmSuccessRates: Record<string, {
    totalCount: number;
    positiveCount: number;
    successRate: number;
    avgEffectScore: number;
  }>;
  
  // 最优调整幅度区间
  optimalBidChangeRange: { min: number; max: number };
  optimalBudgetChangeRange: { min: number; max: number };
  
  // 自适应参数
  adaptiveMaxBidIncrease: number;   // 根据历史成功率动态调整的最大出价提升幅度
  adaptiveMaxBidDecrease: number;   // 根据历史成功率动态调整的最大出价降低幅度
  adaptiveMaxBudgetChange: number;  // 根据历史成功率动态调整的最大预算调整幅度
  
  // 更新时间
  lastUpdated: string;
}

/** 自动纠错动作 */
export interface AutoCorrectionAction {
  id: string;
  logId: number;
  performanceGroupId: number;
  entityType: string;
  entityId: string;
  
  correctionType: 'rollback_bid' | 'rollback_budget' | 'rollback_placement' | 'adjust_parameters';
  
  // 原始值和当前值
  originalValue: number;
  currentValue: number;
  correctedValue: number;
  
  reason: string;
  effectScore: number;
  
  status: 'pending' | 'executed' | 'skipped';
  createdAt: string;
  executedAt?: string;
}

/** 进化周期报告 */
export interface EvolutionCycleReport {
  cycleId: string;
  startDate: string;
  endDate: string;
  
  // 评估统计
  totalActionsEvaluated: number;
  positiveActions: number;
  neutralActions: number;
  negativeActions: number;
  
  // 纠错统计
  correctionsIdentified: number;
  correctionsExecuted: number;
  
  // 学习更新
  keywordsLearningUpdated: number;
  strategyParamsUpdated: number;
  
  // 整体效果
  avgEffectScore: number;
  improvementTrend: 'improving' | 'stable' | 'declining';
}

// ============================================================
// 第一层：效果评估
// ============================================================

/**
 * 评估最近一批优化动作的实际效果
 * 在每次优化执行前自动调用，评估上一轮优化的效果
 */
export async function evaluateRecentOptimizations(
  performanceGroupId: number,
  lookbackDays: number = 14
): Promise<OptimizationEffectAssessment[]> {
  const db = await getDb();
  if (!db) return [];
  
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);
    const cutoffStr = cutoffDate.toISOString().slice(0, 19).replace('T', ' ');
    
    // 最早评估日期（至少7天前的优化才有足够数据评估）
    const minEvalDate = new Date();
    minEvalDate.setDate(minEvalDate.getDate() - 7);
    const minEvalStr = minEvalDate.toISOString().slice(0, 19).replace('T', ' ');
    
    // 获取需要评估的优化日志（7天前到lookbackDays前的出价调整记录）
    const logs = await db.select()
      .from(optimizationLogs)
      .where(and(
        eq(optimizationLogs.performanceGroupId, performanceGroupId),
        eq(optimizationLogs.logCategory, 'bid_adjustment'),
        gte(optimizationLogs.createdAt, cutoffStr),
        lte(optimizationLogs.createdAt, minEvalStr),
        // 只评估未被回滚的记录
        sql`${optimizationLogs.apiSyncStatus} != 'rolled_back' OR ${optimizationLogs.apiSyncStatus} IS NULL`
      ))
      .orderBy(desc(optimizationLogs.createdAt))
      .limit(100);
    
    if (logs.length === 0) return [];
    
    // 获取关联的campaign IDs
    const groupCampaigns = await db.select({ id: campaigns.id })
      .from(campaigns)
      .where(eq(campaigns.performanceGroupId, performanceGroupId));
    
    if (groupCampaigns.length === 0) return [];
    const campaignIds = groupCampaigns.map(c => c.id);
    
    const assessments: OptimizationEffectAssessment[] = [];
    
    for (const optLog of logs) {
      try {
        const logDate = new Date(optLog.createdAt as string);
        
        // 获取优化前7天的campaign级别数据
        const preStartDate = new Date(logDate);
        preStartDate.setDate(preStartDate.getDate() - 7);
        const preData = await getTimeWeightedCampaignMetrics(
          db, campaignIds, 
          preStartDate.toISOString().split('T')[0],
          logDate.toISOString().split('T')[0]
        );
        
        // 获取优化后7天的campaign级别数据
        const postEndDate = new Date(logDate);
        postEndDate.setDate(postEndDate.getDate() + 7);
        const now = new Date();
        const actualEndDate = postEndDate > now ? now : postEndDate;
        const postData = await getTimeWeightedCampaignMetrics(
          db, campaignIds,
          logDate.toISOString().split('T')[0],
          actualEndDate.toISOString().split('T')[0]
        );
        
        if (!preData || !postData) continue;
        
        // 计算效果分数
        const effectScore = calculateEffectScore(preData, postData, log);
        const effectCategory = categorizeEffect(effectScore);
        const needsCorrection = effectScore < -20;
        
        let correctionType: 'rollback' | 'partial_rollback' | 'adjust_parameters' | undefined;
        let correctionReason: string | undefined;
        
        if (effectScore < -50) {
          correctionType = 'rollback';
          correctionReason = `优化效果严重负面（效果分${effectScore}），建议完全回滚`;
        } else if (effectScore < -20) {
          correctionType = 'partial_rollback';
          correctionReason = `优化效果负面（效果分${effectScore}），建议部分回滚`;
        }
        
        // 解析action_detail中的实体信息
        let entityId = '';
        let entityType = 'keyword';
        try {
          const detail = JSON.parse(optLog.actionDetail || '{}');
          entityId = detail.keywordId?.toString() || detail.targetId?.toString() || '';
          entityType = detail.targetType || 'keyword';
        } catch { /* v360: JSON解析失败不影响核心流程 */ }
        
        assessments.push({
          logId: optLog.id,
          actionType: optLog.actionType || 'bid_adjustment',
          performanceGroupId,
          entityId,
          entityType,
          preWeightedAcos: preData.acos,
          preWeightedRoas: preData.roas,
          preWeightedDailySpend: preData.dailySpend,
          preWeightedDailyOrders: preData.dailyOrders,
          postWeightedAcos: postData.acos,
          postWeightedRoas: postData.roas,
          postWeightedDailySpend: postData.dailySpend,
          postWeightedDailyOrders: postData.dailyOrders,
          effectScore,
          effectCategory,
          needsCorrection,
          correctionType,
          correctionReason,
        });
      } catch (logErr) {
        log.error(`[selfEvolution] Error evaluating optimization log:`, logErr);
      }
    }
    
    return assessments;
  } catch (error) {
    log.error(`[selfEvolution] evaluateRecentOptimizations error:`, error);
    return [];
  }
}

/**
 * 获取时间衰减加权的campaign级别指标
 */
async function getTimeWeightedCampaignMetrics(
  db: DbInstance,
  campaignIds: (string | number)[],
  startDate: string,
  endDate: string
): Promise<{ acos: number; roas: number; dailySpend: number; dailyOrders: number; days: number } | null> {
  if (campaignIds.length === 0) return null;
  
  // @ts-expect-error - runtime type mismatch
  const dailyData = await db.select({
    date: dailyPerformance.date,
    spend: sql<number>`COALESCE(SUM(${dailyPerformance.spend}), 0)`,
    sales: sql<number>`COALESCE(SUM(${dailyPerformance.sales}), 0)`,
    orders: sql<number>`COALESCE(SUM(${dailyPerformance.orders}), 0)`,
    clicks: sql<number>`COALESCE(SUM(${dailyPerformance.clicks}), 0)`,
  })
  .from(dailyPerformance)
  .where(and(
    inArray(dailyPerformance.campaignId, campaignIds.map(String)),
    sql`${dailyPerformance.date} >= ${startDate}`,
    sql`${dailyPerformance.date} < ${endDate}`
  ))
  .groupBy(dailyPerformance.date);
  
  if (dailyData.length === 0) return null;
  
  const now = new Date();
  let weightedSpend = 0, weightedSales = 0, weightedOrders = 0;
  let totalWeight = 0;
  
  // v275: 动态时间衰减权重 - 根据数据量和波动性自适应调整
  // 数据量少时降低衰减速度（更平均地利用历史数据），数据量多时增强衰减（更侧重近期数据）
  const dataPoints = dailyData.length;
  const decayRate = dataPoints < 7 ? 0.02 : dataPoints < 14 ? 0.04 : 0.06; // 数据越多衰减越快
  
  // 计算数据波动性（用于调整衰减强度）
  const spendValues = dailyData.map((d: Record<string, unknown>) => Number(d.spend) || 0);
  const avgSpendRaw = spendValues.length > 0 ? spendValues.reduce((a: number, b: number) => a + b, 0) / spendValues.length : 0;
  const variance = spendValues.length > 1 
    ? spendValues.reduce((sum: number, v: number) => sum + Math.pow(v - avgSpendRaw, 2), 0) / spendValues.length 
    : 0;
  const cv = avgSpendRaw > 0 ? Math.sqrt(variance) / avgSpendRaw : 0; // 变异系数
  const volatilityMultiplier = Math.min(1.5, 1.0 + cv * 0.5); // 波动越大衰减越快
  
  for (const day of dailyData) {
    const dayDate = new Date(day.date as string);
    const daysAgo = Math.floor((now.getTime() - dayDate.getTime()) / (1000 * 60 * 60 * 24));
    
    // v275: 指数衰减 + 波动性调整
    const weight = Math.max(0.1, Math.exp(-decayRate * volatilityMultiplier * daysAgo));
    
    weightedSpend += (Number(day.spend) || 0) * weight;
    weightedSales += (Number(day.sales) || 0) * weight;
    weightedOrders += (Number(day.orders) || 0) * weight;
    totalWeight += weight;
  }
  
  if (totalWeight === 0) return null;
  
  const avgSpend = weightedSpend / totalWeight;
  const avgSales = weightedSales / totalWeight;
  const avgOrders = weightedOrders / totalWeight;
  
  return {
    acos: avgSales > 0 ? (avgSpend / avgSales) * 100 : 0,
    roas: avgSpend > 0 ? avgSales / avgSpend : 0,
    dailySpend: avgSpend,
    dailyOrders: avgOrders,
    days: dailyData.length,
  };
}

/**
 * 计算优化效果分数（-100 到 100）
 */
function calculateEffectScore(
  pre: { acos: number; roas: number; dailySpend: number; dailyOrders: number },
  post: { acos: number; roas: number; dailySpend: number; dailyOrders: number },
  logEntry: unknown
): number {
  let score = 0;
  
  // 1. ROAS变化（权重35%）
  if (pre.roas > 0) {
    const roasChange = (post.roas - pre.roas) / pre.roas;
    score += Math.max(-35, Math.min(35, roasChange * 100));
  }
  
  // 2. ACoS变化（权重25%）- ACoS降低为正向
  if (pre.acos > 0) {
    const acosChange = (pre.acos - post.acos) / pre.acos;
    score += Math.max(-25, Math.min(25, acosChange * 100));
  }
  
  // 3. 订单量变化（权重25%）- 订单量不能大幅下降
  if (pre.dailyOrders > 0) {
    const ordersChange = (post.dailyOrders - pre.dailyOrders) / pre.dailyOrders;
    if (ordersChange < 0) {
      score += Math.max(-25, ordersChange * 150);
    } else {
      score += Math.min(25, ordersChange * 80);
    }
  }
  
  // 4. 花费效率（权重10%）
  if (pre.dailySpend > 0 && post.dailyOrders > 0) {
    const preCostPerOrder = pre.dailySpend / Math.max(0.1, pre.dailyOrders);
    const postCostPerOrder = post.dailySpend / Math.max(0.1, post.dailyOrders);
    const efficiencyChange = (preCostPerOrder - postCostPerOrder) / preCostPerOrder;
    score += Math.max(-10, Math.min(10, efficiencyChange * 50));
  }
  
  // v274: 5. 因果推断增量利润信号（权重5%）
  // 如果该优化动作的action_detail中包含因果推断结果，作为额外信号
  try {
    // @ts-expect-error - runtime type mismatch
    if (logEntry?.actionDetail) {
      // @ts-expect-error - runtime type mismatch
      const detail = typeof logEntry.actionDetail === 'string' 
        // @ts-expect-error - runtime type mismatch
        ? JSON.parse(logEntry.actionDetail) : logEntry.actionDetail;
      if (detail.causalAdjustment && detail.causalAdjustment.confidence > 0.5) {
        // 因果推断的增量利润为正 → 加分，为负 → 减分
        const causalSignal = detail.causalAdjustment.incrementalProfit > 0 ? 5 : -5;
        score += causalSignal;
      }
    }
  } catch { /* 解析失败忽略 */ }
  
  return Math.round(Math.max(-100, Math.min(100, score)));
}

/**
 * 将效果分数分类
 */
function categorizeEffect(score: number): 'excellent' | 'positive' | 'neutral' | 'negative' | 'harmful' {
  if (score >= 30) return 'excellent';
  if (score >= 10) return 'positive';
  if (score >= -10) return 'neutral';
  if (score >= -30) return 'negative';
  return 'harmful';
}

// ============================================================
// 第二层：学习记忆
// ============================================================

/**
 * 从优化效果评估中提取学习参数
 * 更新关键词级别和策略级别的学习记忆
 */
export async function updateLearningFromAssessments(
  performanceGroupId: number,
  assessments: OptimizationEffectAssessment[],
  strategyTemplateId?: string | null
): Promise<{
  keywordsUpdated: number;
  strategyUpdated: boolean;
  adaptiveParams: Partial<StrategyLearningParams> | null;
}> {
  if (assessments.length === 0) {
    return { keywordsUpdated: 0, strategyUpdated: false, adaptiveParams: null };
  }
  
  // 1. 更新关键词级别学习记忆
  const keywordMemories = new Map<string, KeywordLearningMemory>();
  
  for (const assessment of assessments) {
    if (!assessment.entityId) continue;
    
    const key = `${assessment.entityType}:${assessment.entityId}`;
    let memory = keywordMemories.get(key);
    
    if (!memory) {
      memory = {
        keywordId: parseInt(assessment.entityId) || 0,
        campaignId: 0,
        optimalBidLow: 0,
        optimalBidHigh: 0,
        totalOptimizations: 0,
        positiveOptimizations: 0,
        negativeOptimizations: 0,
        avgEffectScore: 0,
        bidSensitivity: 'medium',
        optimalAcosRange: { low: 0, high: 100 },
        lastOptimizationDate: '',
        lastBid: 0,
        lastEffectScore: 0,
        confidence: 'low',
      };
    }
    
    memory.totalOptimizations++;
    if (assessment.effectScore > 10) memory.positiveOptimizations++;
    if (assessment.effectScore < -10) memory.negativeOptimizations++;
    memory.avgEffectScore = (memory.avgEffectScore * (memory.totalOptimizations - 1) + assessment.effectScore) / memory.totalOptimizations;
    memory.lastEffectScore = assessment.effectScore;
    
    // 更新置信度
    if (memory.totalOptimizations >= 10) memory.confidence = 'high';
    else if (memory.totalOptimizations >= 5) memory.confidence = 'medium';
    else memory.confidence = 'low';
    
    keywordMemories.set(key, memory);
  }
  
  // 2. 更新策略级别学习参数
  let adaptiveParams: Partial<StrategyLearningParams> | null = null;
  
  if (strategyTemplateId) {
    const positiveCount = assessments.filter(a => a.effectScore > 10).length;
    const negativeCount = assessments.filter(a => a.effectScore < -10).length;
    const totalCount = assessments.length;
    const successRate = totalCount > 0 ? positiveCount / totalCount : 0.5;
    const avgScore = assessments.reduce((sum: number, a: Record<string, unknown>) => sum + a.effectScore, 0) / totalCount;
    
    // 根据成功率动态调整最大调整幅度
    // 成功率高 → 允许更大调整幅度
    // 成功率低 → 收紧调整幅度
    const baseMaxIncrease = 0.20; // 基础最大提升20%
    const baseMaxDecrease = 0.15; // 基础最大降低15%
    
    let adaptiveMaxBidIncrease: number;
    let adaptiveMaxBidDecrease: number;
    
    if (successRate >= 0.7) {
      // 高成功率：可以适度放宽
      adaptiveMaxBidIncrease = baseMaxIncrease * 1.2;
      adaptiveMaxBidDecrease = baseMaxDecrease * 1.2;
    } else if (successRate >= 0.5) {
      // 中等成功率：保持基础
      adaptiveMaxBidIncrease = baseMaxIncrease;
      adaptiveMaxBidDecrease = baseMaxDecrease;
    } else if (successRate >= 0.3) {
      // 低成功率：收紧
      adaptiveMaxBidIncrease = baseMaxIncrease * 0.7;
      adaptiveMaxBidDecrease = baseMaxDecrease * 0.7;
    } else {
      // 极低成功率：大幅收紧
      adaptiveMaxBidIncrease = baseMaxIncrease * 0.5;
      adaptiveMaxBidDecrease = baseMaxDecrease * 0.5;
    }
    
    adaptiveParams = {
      strategyTemplateId,
      adaptiveMaxBidIncrease: Math.round(adaptiveMaxBidIncrease * 1000) / 1000,
      adaptiveMaxBidDecrease: Math.round(adaptiveMaxBidDecrease * 1000) / 1000,
      adaptiveMaxBudgetChange: successRate >= 0.5 ? 0.25 : 0.15,
      lastUpdated: new Date().toISOString(),
    };
  }
  
  return {
    keywordsUpdated: keywordMemories.size,
    strategyUpdated: adaptiveParams !== null,
    adaptiveParams,
  };
}

// ============================================================
// 第三层：自动纠错
// ============================================================

/**
 * 基于效果评估生成自动纠错动作
 * 只对效果严重负面的优化进行自动回滚
 */
export async function generateAutoCorrections(
  performanceGroupId: number,
  assessments: OptimizationEffectAssessment[]
): Promise<AutoCorrectionAction[]> {
  const corrections: AutoCorrectionAction[] = [];
  
  const db = await getDb();
  if (!db) return corrections;
  
  for (const assessment of assessments) {
    if (!assessment.needsCorrection) continue;
    
    try {
      // 获取原始优化日志的详细信息
      const [log] = await db.select()
        .from(optimizationLogs)
        .where(eq(optimizationLogs.id, assessment.logId))
        .limit(1);
      
      if (!log) continue;
      
      // 解析action_detail获取原始值和新值
      let originalValue = 0;
      let currentValue = 0;
      let correctedValue = 0;
      let correctionType: AutoCorrectionAction['correctionType'] = 'rollback_bid';
      
      try {
        const detail = JSON.parse(log.actionDetail || '{}');
        
        if (log.actionType === ('bid_adjustment' as unknown)) {
          originalValue = parseFloat(detail.previousBid || detail.oldBid || '0');
          currentValue = parseFloat(detail.newBid || '0');
          correctionType = 'rollback_bid';
          
          if (assessment.correctionType === 'rollback') {
            // 完全回滚到原始出价
            correctedValue = originalValue;
          } else {
            // 部分回滚：回到原始值和当前值的中间点
            correctedValue = Math.round((originalValue + currentValue) / 2 * 100) / 100;
          }
        } else if (log.actionType === 'budget_adjustment') {
          originalValue = parseFloat(detail.previousBudget || detail.oldBudget || '0');
          currentValue = parseFloat(detail.newBudget || '0');
          correctionType = 'rollback_budget';
          correctedValue = assessment.correctionType === 'rollback' ? originalValue : Math.round((originalValue + currentValue) / 2 * 100) / 100;
        } else if (log.actionType === ('placement_adjustment' as unknown)) {
          originalValue = parseFloat(detail.previousMultiplier || '0');
          currentValue = parseFloat(detail.newMultiplier || '0');
          correctionType = 'rollback_placement';
          correctedValue = assessment.correctionType === 'rollback' ? originalValue : Math.round((originalValue + currentValue) / 2);
        }
      } catch { /* v360: 纠错值计算失败，跳过当前评估 */ }
      
      if (originalValue === 0 && currentValue === 0) continue;
      
      // v274: 因果推断辅助纠错判断
      // 如果因果推断显示该关键词的出价调整实际产生了正向增量利润，则降低纠错优先级
      let causalOverride = false;
      try {
        const causalDb = await getDb();
        if (causalDb && assessment.entityId) {
          const { causalInferenceResults } = await import('../../drizzle/schema');
          const { eq: eqOp, gte: gteOp, and: andOp } = await import('drizzle-orm');
          const recentDate = new Date();
          recentDate.setDate(recentDate.getDate() - 14);
          const [causalResult] = await causalDb.select({
            incrementalProfit: causalInferenceResults.incrementalProfit,
            upliftScore: causalInferenceResults.upliftScore,
          }).from(causalInferenceResults)
            .where(andOp(
              eqOp(causalInferenceResults.keywordId, parseInt(assessment.entityId)),
              gteOp(causalInferenceResults.analysisDate, recentDate.toISOString().split('T')[0])
            ))
            .limit(1);
          
          if (causalResult && Number(causalResult.incrementalProfit) > 0 && Number(causalResult.upliftScore) > 0.3) {
            // 因果推断显示正向效果，降级为部分回滚而非完全回滚
            if (correctionType === 'rollback_bid') {
              correctedValue = Math.round((originalValue * 0.3 + currentValue * 0.7) * 100) / 100;
              causalOverride = true;
            }
          }
        }
      } catch { /* 因果推断查询失败不影响主流程 */ }
      
      corrections.push({
        id: `correction_${assessment.logId}_${Date.now()}`,
        logId: assessment.logId,
        performanceGroupId,
        entityType: assessment.entityType,
        entityId: assessment.entityId,
        correctionType,
        originalValue,
        currentValue,
        correctedValue,
        reason: causalOverride 
          ? `效果评分${assessment.effectScore}，但因果推断显示正向增量利润，降级为部分回滚`
          : (assessment.correctionReason || `效果评分${assessment.effectScore}，需要纠正`),
        effectScore: assessment.effectScore,
        status: 'pending',
        createdAt: new Date().toISOString(),
      });
    } catch (err) {
      log.error(`[selfEvolution] Error generating correction for log ${assessment.logId}:`, err);
    }
  }
  
  return corrections;
}

/**
 * 执行自动纠错动作
 * 将纠错结果写入优化日志，并标记原始日志为已纠正
 */
export async function executeAutoCorrections(
  corrections: AutoCorrectionAction[],
  userId: number,
  accountId: number
): Promise<{
  executed: number;
  skipped: number;
  errors: number;
  details: string[];
}> {
  const result = { executed: 0, skipped: 0, errors: 0, details: [] as string[] };
  
  const db = await getDb();
  if (!db) return result;
  
  for (const correction of corrections) {
    try {
      // 安全检查：纠正值必须合理
      if (correction.correctedValue <= 0) {
        correction.status = 'skipped';
        result.skipped++;
        result.details.push(`跳过纠正 ${correction.id}：纠正值不合理 (${correction.correctedValue})`);
        continue;
      }
      
      // 安全检查：不要纠正已经被纠正过的记录
      const [originalLog] = await db.select()
        .from(optimizationLogs)
        .where(eq(optimizationLogs.id, correction.logId))
        .limit(1);
      
      if (!originalLog || originalLog.apiSyncStatus === 'rolled_back') {
        correction.status = 'skipped';
        result.skipped++;
        result.details.push(`跳过纠正 ${correction.id}：原始记录已被回滚`);
        continue;
      }
      
      // 写入纠错日志
      // @ts-expect-error - Drizzle query builder type
      await db.insert(optimizationLogs).values({
        userId,
        accountId,
        performanceGroupId: correction.performanceGroupId,
        actionType: correction.correctionType.replace('rollback_', '') + '_adjustment',
        actionDetail: JSON.stringify({
          correctionOf: correction.logId,
          previousValue: correction.currentValue,
          correctedValue: correction.correctedValue,
          originalValue: correction.originalValue,
          effectScore: correction.effectScore,
          reason: correction.reason,
          autoCorrection: true,
        }),
        reason: `[自动纠错] ${correction.reason}`,
        apiSyncStatus: 'pending',
        createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      } as Record<string, unknown>);
      
      // 标记原始日志为已纠正
      await db.update(optimizationLogs)
        .set({ apiSyncStatus: 'corrected' })
        .where(eq(optimizationLogs.id, correction.logId));
      
      correction.status = 'executed';
      correction.executedAt = new Date().toISOString();
      result.executed++;
      result.details.push(
        `执行纠正 ${correction.id}：${correction.correctionType} ` +
        `${correction.currentValue} → ${correction.correctedValue} (原始: ${correction.originalValue})`
      );
    } catch (err) {
      correction.status = 'skipped';
      result.errors++;
      result.details.push(`纠正失败 ${correction.id}: ${err}`);
    }
  }
  
  return result;
}

// ============================================================
// 主入口：进化周期
// ============================================================

/**
 * 运行一个完整的自我进化周期
 * 在每次优化执行前自动调用
 */
export async function runEvolutionCycle(
  performanceGroupId: number,
  userId: number,
  accountId: number,
  strategyTemplateId?: string | null
): Promise<EvolutionCycleReport> {
  const cycleId = `evo_${performanceGroupId}_${Date.now()}`;
  const startDate = new Date().toISOString();
  
  log.info(`[selfEvolution] Starting evolution cycle ${cycleId} for group ${performanceGroupId}`);
  
  // 第一步：评估最近的优化效果
  const assessments = await evaluateRecentOptimizations(performanceGroupId);
  
  const positiveActions = assessments.filter(a => a.effectScore > 10).length;
  const neutralActions = assessments.filter(a => a.effectScore >= -10 && a.effectScore <= 10).length;
  const negativeActions = assessments.filter(a => a.effectScore < -10).length;
  
  log.info(`[selfEvolution] Evaluated ${assessments.length} actions: ${positiveActions} positive, ${neutralActions} neutral, ${negativeActions} negative`);
  
  // 第二步：从评估中学习
  const learningResult = await updateLearningFromAssessments(
    performanceGroupId, assessments, strategyTemplateId
  );
  
  log.info(`[selfEvolution] Learning updated: ${learningResult.keywordsUpdated} keywords, strategy: ${learningResult.strategyUpdated}`);
  
  // 第三步：生成自动纠错动作
  const corrections = await generateAutoCorrections(performanceGroupId, assessments);
  
  let correctionsExecuted = 0;
  if (corrections.length > 0) {
    log.info(`[selfEvolution] ${corrections.length} corrections identified`);
    
    // 执行自动纠错（仅对效果严重负面的进行自动回滚）
    const severeCorrections = corrections.filter(c => c.effectScore < -30);
    if (severeCorrections.length > 0) {
      const execResult = await executeAutoCorrections(severeCorrections, userId, accountId);
      correctionsExecuted = execResult.executed;
      log.info(`[selfEvolution] Auto-corrections: ${execResult.executed} executed, ${execResult.skipped} skipped`);
    }
  }
  
  // 计算整体趋势
  const avgEffectScore = assessments.length > 0 
    ? assessments.reduce((sum: number, a: Record<string, unknown>) => sum + a.effectScore, 0) / assessments.length 
    : 0;
  
  let improvementTrend: 'improving' | 'stable' | 'declining';
  if (avgEffectScore > 10) improvementTrend = 'improving';
  else if (avgEffectScore > -10) improvementTrend = 'stable';
  else improvementTrend = 'declining';
  
  const report: EvolutionCycleReport = {
    cycleId,
    startDate,
    endDate: new Date().toISOString(),
    totalActionsEvaluated: assessments.length,
    positiveActions,
    neutralActions,
    negativeActions,
    correctionsIdentified: corrections.length,
    correctionsExecuted,
    keywordsLearningUpdated: learningResult.keywordsUpdated,
    strategyParamsUpdated: learningResult.strategyUpdated ? 1 : 0,
    avgEffectScore: Math.round(avgEffectScore),
    improvementTrend,
  };
  
  log.info(`[selfEvolution] Evolution cycle ${cycleId} completed: avg score ${report.avgEffectScore}, trend: ${report.improvementTrend}`);
  
  return report;
}

/**
 * 获取自适应优化参数
 * 在优化执行时调用，获取根据历史效果动态调整的参数
 */
export async function getAdaptiveOptimizationParams(
  performanceGroupId: number,
  strategyTemplateId?: string | null
): Promise<{
  maxBidIncrease: number;
  maxBidDecrease: number;
  maxBudgetChange: number;
  confidenceMultiplier: number;
  recentSuccessRate: number;
}> {
  const db = await getDb();
  
  // 默认参数
  const defaultParams = {
    maxBidIncrease: 0.20,
    maxBidDecrease: 0.15,
    maxBudgetChange: 0.25,
    confidenceMultiplier: 1.0,
    recentSuccessRate: 0.5,
  };
  
  if (!db) return defaultParams;
  
  try {
    // 获取最近30天的优化效果记录
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const cutoffStr = thirtyDaysAgo.toISOString().slice(0, 19).replace('T', ' ');
    
    const recentLogs = await db.select({
      count: sql<number>`COUNT(*)`,
      avgEffect: sql<number>`AVG(CASE WHEN ${optimizationLogs.apiSyncStatus} = 'corrected' THEN -30 WHEN ${optimizationLogs.apiSyncStatus} = 'rolled_back' THEN -50 ELSE 10 END)`,
      rolledBackCount: sql<number>`SUM(CASE WHEN ${optimizationLogs.apiSyncStatus} IN ('corrected', 'rolled_back') THEN 1 ELSE 0 END)`,
    })
    .from(optimizationLogs)
    .where(and(
      eq(optimizationLogs.performanceGroupId, performanceGroupId),
      eq(optimizationLogs.logCategory, 'bid_adjustment'),
      gte(optimizationLogs.createdAt, cutoffStr)
    ));
    
    const totalCount = Number(recentLogs[0]?.count) || 0;
    const rolledBackCount = Number(recentLogs[0]?.rolledBackCount) || 0;
    
    if (totalCount < 5) return defaultParams; // 数据不足，使用默认值
    
    const successRate = 1 - (rolledBackCount / totalCount);
    
    // 根据成功率动态调整参数
    let maxBidIncrease: number;
    let maxBidDecrease: number;
    let confidenceMultiplier: number;
    
    if (successRate >= 0.8) {
      maxBidIncrease = 0.25;
      maxBidDecrease = 0.20;
      confidenceMultiplier = 1.2;
    } else if (successRate >= 0.6) {
      maxBidIncrease = 0.20;
      maxBidDecrease = 0.15;
      confidenceMultiplier = 1.0;
    } else if (successRate >= 0.4) {
      maxBidIncrease = 0.15;
      maxBidDecrease = 0.10;
      confidenceMultiplier = 0.8;
    } else {
      // 低成功率：大幅收紧
      maxBidIncrease = 0.10;
      maxBidDecrease = 0.08;
      confidenceMultiplier = 0.6;
    }
    
    return {
      maxBidIncrease,
      maxBidDecrease,
      maxBudgetChange: successRate >= 0.5 ? 0.25 : 0.15,
      confidenceMultiplier,
      recentSuccessRate: Math.round(successRate * 100) / 100,
    };
  } catch (error) {
    log.error(`[selfEvolution] getAdaptiveOptimizationParams error:`, error);
    return defaultParams;
  }
}

/**
 * 检查特定关键词的历史优化效果
 * 在对该关键词进行新的优化前调用
 */
export async function getKeywordOptimizationHistory(
  keywordId: number,
  performanceGroupId: number
): Promise<{
  totalOptimizations: number;
  recentEffectScore: number;
  suggestedMaxChange: number;
  warningMessage?: string;
} | null> {
  const db = await getDb();
  if (!db) return null;
  
  try {
    // 查询该关键词的历史优化日志
    const logs = await db.select()
      .from(optimizationLogs)
      .where(and(
        eq(optimizationLogs.performanceGroupId, performanceGroupId),
        eq(optimizationLogs.logCategory, 'bid_adjustment'),
        sql`JSON_EXTRACT(${optimizationLogs.actionDetail}, '$.keywordId') = ${keywordId}`
      ))
      .orderBy(desc(optimizationLogs.createdAt))
      .limit(20);
    
    if (logs.length === 0) return null;
    
    // 分析历史效果
    let rolledBackCount = 0;
    let correctedCount = 0;
    
    for (const log of (logs as unknown[])) {
      if (log.apiSyncStatus === 'rolled_back') rolledBackCount++;
      if (log.apiSyncStatus === 'corrected') correctedCount++;
    }
    
    const totalOptimizations = logs.length;
    const problemRate = (rolledBackCount + correctedCount) / totalOptimizations;
    
    // 根据历史问题率调整建议的最大调整幅度
    let suggestedMaxChange: number;
    let warningMessage: string | undefined;
    
    if (problemRate >= 0.5) {
      suggestedMaxChange = 0.05; // 仅允许5%调整
      warningMessage = `该关键词历史优化问题率${Math.round(problemRate * 100)}%，建议极小幅度调整`;
    } else if (problemRate >= 0.3) {
      suggestedMaxChange = 0.10;
      warningMessage = `该关键词历史优化问题率${Math.round(problemRate * 100)}%，建议小幅度调整`;
    } else if (problemRate >= 0.1) {
      suggestedMaxChange = 0.15;
    } else {
      suggestedMaxChange = 0.20;
    }
    
    // 计算最近效果分数（简化版，基于回滚率）
    const recentEffectScore = Math.round((1 - problemRate) * 100 - 50);
    
    return {
      totalOptimizations,
      recentEffectScore,
      suggestedMaxChange,
      warningMessage,
    };
  } catch (error) {
    log.error(`[selfEvolution] getKeywordOptimizationHistory error:`, error);
    return null;
  }
}
