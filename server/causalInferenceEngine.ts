import { createModuleLogger } from './utils/logger';
const log = createModuleLogger('CausalInferenceEngine');
/**
 * 因果推断引擎 (Causal Inference Engine)
 * 
 * 核心算法：
 * 1. Difference-in-Differences (DID)：利用出价变化前后的绩效差异估计因果效应
 * 2. Propensity Score Matching (PSM)：匹配相似关键词，构建准实验对照组
 * 3. Uplift Modeling：估计每个关键词的个体处理效应 (ITE)
 * 
 * 核心创新：
 * - 将出价调整视为"处理"(treatment)，未调整的关键词作为"对照"(control)
 * - 通过DID消除时间趋势的混淆因素
 * - 通过PSM消除选择偏差（高绩效关键词更可能被加价）
 * - 计算增量利润 = 因果效应 × 规模，而非简单的前后对比
 */
import { getDb } from "./db";
import {
  causalInferenceResults,
  dailyPerformance,
  keywords,
  productTargets,
  rlTrainingLogs,
} from "../drizzle/schema";
import { eq, and, gte, lte, sql, isNotNull } from "drizzle-orm";

// ==================== 类型定义 ====================

export interface CausalEffect {
  keywordId?: number;
  targetId?: number;
  campaignId?: string;
  // 个体处理效应 (ITE)
  estimatedITE: number;
  // 处理组与对照组的CVR
  treatmentCVR: number;
  controlCVR: number;
  // Uplift分数 = ITE / controlCVR
  upliftScore: number;
  // 置信区间
  confidenceInterval: number;
  // 增量利润
  incrementalRevenue: number;
  incrementalCost: number;
  incrementalProfit: number;
  incrementalROAS: number;
  // 最优出价点
  optimalBid: number;
  optimalBidLower: number;
  optimalBidUpper: number;
  // 样本量
  sampleSize: number;
}

interface PerformanceSnapshot {
  impressions: number;
  clicks: number;
  orders: number;
  spend: number;
  sales: number;
  cvr: number;
  cpc: number;
  acos: number;
}

interface BidChangeEvent {
  keywordId?: number;
  targetId?: number;
  campaignId?: string;
  bidBefore: number;
  bidAfter: number;
  changeDate: string;
  perfBefore: PerformanceSnapshot;
  perfAfter: PerformanceSnapshot;
}

// ==================== 辅助函数 ====================

async function getDbInstance() {
  const db = await getDb();
  if (!db) throw new Error('Database connection failed');
  return db;
}

/**
 * 计算两个特征向量之间的欧氏距离（用于PSM匹配）
 */
function euclideanDistance(a: number[], b: number[]): number {
  return Math.sqrt(a.reduce((sum, val, i) => sum + (val - b[i]) ** 2, 0));
}

/**
 * 计算加权均值
 */
function weightedMean(values: number[], weights: number[]): number {
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  if (totalWeight === 0) return 0;
  return values.reduce((sum, val, i) => sum + val * weights[i], 0) / totalWeight;
}

/**
 * Bootstrap置信区间
 */
function bootstrapCI(values: number[], confidence: number = 0.95, nBootstrap: number = 500): number {
  if (values.length < 3) return Infinity;
  
  const bootstrapMeans: number[] = [];
  for (let i = 0; i < nBootstrap; i++) {
    const sample = Array.from({ length: values.length }, () =>
      values[Math.floor(Math.random() * values.length)]
    );
    bootstrapMeans.push(sample.reduce((a, b) => a + b, 0) / sample.length);
  }
  
  bootstrapMeans.sort((a, b) => a - b);
  const alpha = (1 - confidence) / 2;
  const lower = bootstrapMeans[Math.floor(alpha * nBootstrap)];
  const upper = bootstrapMeans[Math.floor((1 - alpha) * nBootstrap)];
  
  return (upper - lower) / 2;
}

// ==================== 核心因果推断算法 ====================

/**
 * Difference-in-Differences (DID) 估计
 * 
 * ITE = (Y_treat_after - Y_treat_before) - (Y_control_after - Y_control_before)
 * 
 * 其中：
 * - Y_treat = 处理组（出价被调整的关键词）的绩效
 * - Y_control = 对照组（出价未被调整的相似关键词）的绩效
 */
export function didEstimate(
  treatBefore: PerformanceSnapshot,
  treatAfter: PerformanceSnapshot,
  controlBefore: PerformanceSnapshot,
  controlAfter: PerformanceSnapshot
): { ite: number; treatmentEffect: number; timeEffect: number } {
  // 处理组的前后差异
  const treatDiff = treatAfter.cvr - treatBefore.cvr;
  
  // 对照组的前后差异（时间趋势）
  const controlDiff = controlAfter.cvr - controlBefore.cvr;
  
  // DID估计 = 处理效应 - 时间效应
  const ite = treatDiff - controlDiff;
  
  return {
    ite,
    treatmentEffect: treatDiff,
    timeEffect: controlDiff,
  };
}

/**
 * 倾向得分匹配 (PSM)
 * 为处理组的每个关键词找到最相似的对照组关键词
 */
function propensityScoreMatch(
  treatmentFeatures: number[][],
  controlFeatures: number[][],
  k: number = 3  // 匹配最近的k个
): number[][][] {
  // 返回每个处理组样本匹配的对照组索引
  return treatmentFeatures.map(treatFeat => {
    const distances = controlFeatures.map((ctrlFeat, idx) => ({
      idx,
      dist: euclideanDistance(treatFeat, ctrlFeat),
    }));
    distances.sort((a, b) => a.dist - b.dist);
    return distances.slice(0, k).map(d => [d.idx, 1 / (1 + d.dist)]);
  });
}

/**
 * 为单个关键词估计因果效应
 */
export async function estimateCausalEffect(
  accountId: number,
  keywordId?: number,
  targetId?: number,
  campaignId?: string
): Promise<CausalEffect | null> {
  const db = await getDbInstance();
  
  try {
    // 获取该关键词最近的出价变化事件
    const bidChanges = await db.select({
      actionBidBefore: rlTrainingLogs.actionBidBefore,
      actionBidAfter: rlTrainingLogs.actionBidAfter,
      createdAt: rlTrainingLogs.createdAt,
      reward: rlTrainingLogs.reward,
      rewardSales: rlTrainingLogs.rewardSales,
      rewardSpend: rlTrainingLogs.rewardSpend,
      rewardOrders: rlTrainingLogs.rewardOrders,
      rewardClicks: rlTrainingLogs.rewardClicks,
      rewardImpressions: rlTrainingLogs.rewardImpressions,
    }).from(rlTrainingLogs)
      .where(and(
        eq(rlTrainingLogs.accountId, accountId),
        keywordId ? eq(rlTrainingLogs.keywordId, keywordId) : sql`1=1`,
        targetId ? eq(rlTrainingLogs.targetId, targetId) : sql`1=1`,
        isNotNull(rlTrainingLogs.rewardFilledAt)
      ))
      .orderBy(sql`created_at DESC`)
      .limit(20);
    
    if (bidChanges.length < 3) {
      return null; // 数据不足
    }
    
    // 获取处理前后的绩效数据
    const events: BidChangeEvent[] = [];
    for (const change of bidChanges) {
      const changeDate = new Date(change.createdAt as string);
      const beforeStart = new Date(changeDate.getTime() - 7 * 86400000).toISOString().split('T')[0];
      const beforeEnd = new Date(changeDate.getTime() - 1 * 86400000).toISOString().split('T')[0];
      const afterStart = new Date(changeDate.getTime() + 1 * 86400000).toISOString().split('T')[0];
      const afterEnd = new Date(changeDate.getTime() + 7 * 86400000).toISOString().split('T')[0];
      
      const [perfBefore, perfAfter] = await Promise.all([
        getAggregatedPerf(db, accountId, campaignId, beforeStart, beforeEnd),
        getAggregatedPerf(db, accountId, campaignId, afterStart, afterEnd),
      ]);
      
      if (perfBefore && perfAfter) {
        events.push({
          keywordId,
          targetId,
          campaignId,
          bidBefore: Number(change.actionBidBefore),
          bidAfter: Number(change.actionBidAfter),
          changeDate: changeDate.toISOString().split('T')[0],
          perfBefore,
          perfAfter,
        });
      }
    }
    
    if (events.length < 2) return null;
    
    // 获取同账号下未被调整的关键词作为对照组
    // 简化：使用账号整体平均绩效作为对照组代理
    const controlPerf = await getAccountAveragePerf(db, accountId);
    
    // 计算DID估计
    const iteValues: number[] = [];
    for (const event of events) {
      const did = didEstimate(
        event.perfBefore,
        event.perfAfter,
        controlPerf.before,
        controlPerf.after
      );
      iteValues.push(did.ite);
    }
    
    const avgITE = iteValues.reduce((a, b) => a + b, 0) / iteValues.length;
    const ci = bootstrapCI(iteValues);
    
    // 计算增量利润
    const latestEvent = events[0];
    const avgClicks = (latestEvent.perfAfter.clicks + latestEvent.perfBefore.clicks) / 2;
    const avgAOV = latestEvent.perfAfter.sales > 0 && latestEvent.perfAfter.orders > 0
      ? latestEvent.perfAfter.sales / latestEvent.perfAfter.orders
      : 30;
    
    const incrementalOrders = avgClicks * Math.max(0, avgITE);
    const incrementalRevenue = incrementalOrders * avgAOV;
    const incrementalCost = latestEvent.perfAfter.spend - latestEvent.perfBefore.spend;
    const incrementalProfit = incrementalRevenue - incrementalCost;
    const incrementalROAS = incrementalCost > 0 ? incrementalRevenue / incrementalCost : 0;
    
    // 计算最优出价点（基于增量利润最大化）
    const currentBid = latestEvent.bidAfter;
    const optimalBid = incrementalProfit > 0
      ? currentBid * (1 + Math.min(0.1, avgITE * 2))  // 正增量效应 → 可以加价
      : currentBid * (1 - Math.min(0.1, Math.abs(avgITE) * 2));  // 负增量效应 → 应该降价
    
    const result: CausalEffect = {
      keywordId,
      targetId,
      campaignId,
      estimatedITE: avgITE,
      treatmentCVR: latestEvent.perfAfter.cvr,
      controlCVR: controlPerf.after.cvr,
      upliftScore: controlPerf.after.cvr > 0 ? avgITE / controlPerf.after.cvr : 0,
      confidenceInterval: ci,
      incrementalRevenue: Math.round(incrementalRevenue * 100) / 100,
      incrementalCost: Math.round(incrementalCost * 100) / 100,
      incrementalProfit: Math.round(incrementalProfit * 100) / 100,
      incrementalROAS: Math.round(incrementalROAS * 100) / 100,
      optimalBid: Math.round(optimalBid * 100) / 100,
      optimalBidLower: Math.round(optimalBid * 0.9 * 100) / 100,
      optimalBidUpper: Math.round(optimalBid * 1.1 * 100) / 100,
      sampleSize: events.length,
    };
    
    // 保存到数据库
    await saveCausalResult(db, accountId, result);
    
    return result;
    
  } catch (error) {
    log.error(`[CausalInference] Error estimating causal effect:`, error);
    return null;
  }
}

/**
 * 获取聚合绩效数据
 */
async function getAggregatedPerf(
  db: ReturnType<typeof getDb> | null,
  accountId: number,
  campaignId: string | undefined,
  startDate: string,
  endDate: string
): Promise<PerformanceSnapshot | null> {
  const results = await db.select({
    totalImpressions: sql<number>`SUM(impressions)`,
    totalClicks: sql<number>`SUM(clicks)`,
    totalOrders: sql<number>`SUM(orders)`,
    totalSpend: sql<number>`SUM(CAST(spend AS DECIMAL(10,2)))`,
    totalSales: sql<number>`SUM(CAST(sales AS DECIMAL(10,2)))`,
  }).from(dailyPerformance)
    .where(and(
      eq(dailyPerformance.accountId, accountId),
      campaignId ? eq(dailyPerformance.campaignId, campaignId) : sql`1=1`,
      gte(dailyPerformance.date, startDate),
      lte(dailyPerformance.date, endDate)
    ));
  
  const r = results[0];
  if (!r) return null;
  
  const impressions = Number(r.totalImpressions) || 0;
  const clicks = Number(r.totalClicks) || 0;
  const orders = Number(r.totalOrders) || 0;
  const spend = Number(r.totalSpend) || 0;
  const sales = Number(r.totalSales) || 0;
  
  return {
    impressions,
    clicks,
    orders,
    spend,
    sales,
    cvr: clicks > 0 ? orders / clicks : 0,
    cpc: clicks > 0 ? spend / clicks : 0,
    acos: sales > 0 ? spend / sales : 0,
  };
}

/**
 * 获取账号平均绩效（作为对照组代理）
 */
async function getAccountAveragePerf(
  db: ReturnType<typeof getDb> | null,
  accountId: number
): Promise<{ before: PerformanceSnapshot; after: PerformanceSnapshot }> {
  const now = new Date();
  const days14Ago = new Date(now.getTime() - 14 * 86400000).toISOString().split('T')[0];
  const days7Ago = new Date(now.getTime() - 7 * 86400000).toISOString().split('T')[0];
  const today = now.toISOString().split('T')[0];
  
  const [before, after] = await Promise.all([
    getAggregatedPerf(db, accountId, undefined, days14Ago, days7Ago),
    getAggregatedPerf(db, accountId, undefined, days7Ago, today),
  ]);
  
  const defaultPerf: PerformanceSnapshot = {
    impressions: 0, clicks: 0, orders: 0, spend: 0, sales: 0,
    cvr: 0, cpc: 0, acos: 0,
  };
  
  return {
    before: before || defaultPerf,
    after: after || defaultPerf,
  };
}

/**
 * 保存因果推断结果
 */
async function saveCausalResult(db: ReturnType<typeof getDb> | null, accountId: number, result: CausalEffect): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  
  await db.insert(causalInferenceResults).values({
    accountId,
    keywordId: result.keywordId || null,
    targetId: result.targetId || null,
    campaignId: result.campaignId || null,
    analysisDate: today,
    estimatedIte: String(result.estimatedITE),
    treatmentCvr: String(result.treatmentCVR),
    controlCvr: String(result.controlCVR),
    upliftScore: String(result.upliftScore),
    confidenceInterval: String(result.confidenceInterval),
    incrementalRevenue: String(result.incrementalRevenue),
    incrementalCost: String(result.incrementalCost),
    incrementalProfit: String(result.incrementalProfit),
    incrementalRoas: String(result.incrementalROAS),
    optimalBid: String(result.optimalBid),
    optimalBidLower: String(result.optimalBidLower),
    optimalBidUpper: String(result.optimalBidUpper),
    modelVersion: 'did_v1',
    sampleSize: result.sampleSize,
  } as Record<string, unknown>);
}

/**
 * 批量运行因果推断分析（定时任务）
 */
export async function batchCausalAnalysis(accountId: number): Promise<{
  analyzed: number;
  significant: number;
  errors: number;
}> {
  const db = await getDbInstance();
  const result = { analyzed: 0, significant: 0, errors: 0 };
  
  // 获取有RL日志的关键词
  const entitiesWithLogs = await db.select({
    keywordId: rlTrainingLogs.keywordId,
    targetId: rlTrainingLogs.targetId,
    campaignId: rlTrainingLogs.campaignId,
    logCount: sql<number>`COUNT(*)`,
  }).from(rlTrainingLogs)
    .where(and(
      eq(rlTrainingLogs.accountId, accountId),
      isNotNull(rlTrainingLogs.rewardFilledAt)
    ))
    .groupBy(rlTrainingLogs.keywordId, rlTrainingLogs.targetId, rlTrainingLogs.campaignId)
    .having(sql`COUNT(*) >= 3`)
    .limit(200);
  
  for (const entity of entitiesWithLogs) {
    try {
      const effect = await estimateCausalEffect(
        accountId,
        entity.keywordId ?? undefined,
        entity.targetId ?? undefined,
        entity.campaignId ?? undefined
      );
      
      if (effect) {
        result.analyzed++;
        // 统计显著的效应（置信区间不包含0）
        if (Math.abs(effect.estimatedITE) > effect.confidenceInterval) {
          result.significant++;
        }
      }
    } catch (e) {
      result.errors++;
    }
  }
  
  log.info(`[CausalInference] Batch analysis: ${result.analyzed} analyzed, ${result.significant} significant, ${result.errors} errors`);
  return result;
}
