/**
 * 强化学习数据记录器 (RL Data Recorder)
 * 
 * 核心职责：
 * 1. 在每次出价调整时记录 State（调整前状态）和 Action（执行的动作）
 * 2. 延迟回填 Reward（调整后24-48小时的绩效变化）
 * 3. 生成 Episode（一个关键词/定位的完整出价调整序列）
 * 4. 为离线强化学习（CQL）提供高质量训练数据
 */
import { getDb } from "./db";
import { rlTrainingLogs, dailyPerformance, keywords, productTargets } from "../drizzle/schema";
import { eq, and, gte, lte, isNull, sql } from "drizzle-orm";
import { extractFeatureVector, type ContextFeatureVector } from "./contextualFeatureService";
import { randomUUID } from "crypto";
const uuidv4 = randomUUID;

// ==================== 类型定义 ====================

export interface BidAction {
  keywordId?: number;
  targetId?: number;
  accountId: number;
  campaignId?: string;
  adGroupId?: number;
  bidBefore: number;
  bidAfter: number;
  actionSource: 'rule_based' | 'ucb' | 'linucb' | 'cql' | 'manual';
}

export interface StateSnapshot {
  bid: number;
  impressions: number;
  clicks: number;
  orders: number;
  spend: number;
  sales: number;
  acos: number;
  cvr: number;
  cpc: number;
  competition: number;
  context?: ContextFeatureVector;
}

// ==================== 辅助函数 ====================

async function getDbInstance() {
  const db = await getDb();
  if (!db) throw new Error('Database connection failed');
  return db;
}

/**
 * 确定动作类型
 */
function classifyAction(bidBefore: number, bidAfter: number): 'bid_increase' | 'bid_decrease' | 'bid_hold' | 'pause' | 'resume' {
  if (bidAfter === 0) return 'pause';
  if (bidBefore === 0 && bidAfter > 0) return 'resume';
  const delta = bidAfter - bidBefore;
  const threshold = bidBefore * 0.005; // 0.5%以内视为hold
  if (Math.abs(delta) <= threshold) return 'bid_hold';
  return delta > 0 ? 'bid_increase' : 'bid_decrease';
}

/**
 * 生成或获取当前Episode ID
 * Episode = 同一个关键词/定位在连续时间内的一系列出价调整
 * 如果距离上次调整超过7天，开始新Episode
 */
async function getOrCreateEpisodeId(
  db: any,
  accountId: number,
  keywordId?: number,
  targetId?: number
): Promise<{ episodeId: string; stepIndex: number }> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  
  // 查找最近的Episode
  let lastLog;
  if (keywordId) {
    const results = await db.select({
      episodeId: rlTrainingLogs.episodeId,
      stepIndex: rlTrainingLogs.stepIndex,
      createdAt: rlTrainingLogs.createdAt,
    }).from(rlTrainingLogs)
      .where(and(
        eq(rlTrainingLogs.accountId, accountId),
        eq(rlTrainingLogs.keywordId, keywordId),
        gte(rlTrainingLogs.createdAt, sevenDaysAgo)
      ))
      .orderBy(sql`created_at DESC`)
      .limit(1);
    lastLog = results[0];
  } else if (targetId) {
    const results = await db.select({
      episodeId: rlTrainingLogs.episodeId,
      stepIndex: rlTrainingLogs.stepIndex,
      createdAt: rlTrainingLogs.createdAt,
    }).from(rlTrainingLogs)
      .where(and(
        eq(rlTrainingLogs.accountId, accountId),
        eq(rlTrainingLogs.targetId, targetId),
        gte(rlTrainingLogs.createdAt, sevenDaysAgo)
      ))
      .orderBy(sql`created_at DESC`)
      .limit(1);
    lastLog = results[0];
  }
  
  if (lastLog && lastLog.episodeId) {
    return {
      episodeId: lastLog.episodeId,
      stepIndex: (lastLog.stepIndex || 0) + 1,
    };
  }
  
  // 创建新Episode
  return {
    episodeId: `ep_${uuidv4().substring(0, 12)}`,
    stepIndex: 0,
  };
}

// ==================== 核心功能 ====================

/**
 * 记录出价调整的State和Action（在出价执行时调用）
 */
export async function recordBidAction(action: BidAction): Promise<void> {
  const db = await getDbInstance();
  
  try {
    // 获取当前状态快照
    const state = await captureStateSnapshot(
      db, action.accountId, action.keywordId, action.targetId, action.campaignId
    );
    
    // 获取上下文特征
    let contextFeatures: ContextFeatureVector | undefined;
    try {
      contextFeatures = await extractFeatureVector(
        action.accountId, action.keywordId, action.targetId, action.campaignId
      );
    } catch (e) {
      // 上下文特征提取失败不阻塞主流程
    }
    
    // 获取Episode信息
    const { episodeId, stepIndex } = await getOrCreateEpisodeId(
      db, action.accountId, action.keywordId, action.targetId
    );
    
    // 记录State-Action对
    await db.insert(rlTrainingLogs).values({
      accountId: action.accountId,
      keywordId: action.keywordId || null,
      targetId: action.targetId || null,
      campaignId: action.campaignId || null,
      adGroupId: action.adGroupId || null,
      episodeId,
      stepIndex,
      // State
      stateBid: String(state.bid),
      stateImpressions: state.impressions,
      stateClicks: state.clicks,
      stateOrders: state.orders,
      stateSpend: String(state.spend),
      stateSales: String(state.sales),
      stateAcos: String(state.acos),
      stateCvr: String(state.cvr),
      stateCpc: String(state.cpc),
      stateCompetition: String(state.competition),
      stateContext: contextFeatures ? JSON.stringify(contextFeatures) : null,
      // Action
      actionType: classifyAction(action.bidBefore, action.bidAfter),
      actionBidBefore: String(action.bidBefore),
      actionBidAfter: String(action.bidAfter),
      actionBidDelta: String(action.bidAfter - action.bidBefore),
      actionSource: action.actionSource,
    } as any);
    
  } catch (error) {
    // RL数据记录失败不应阻塞出价调整主流程
    console.error(`[RLDataRecorder] Failed to record bid action:`, error);
  }
}

/**
 * 捕获当前状态快照
 */
async function captureStateSnapshot(
  db: any,
  accountId: number,
  keywordId?: number,
  targetId?: number,
  campaignId?: string
): Promise<StateSnapshot> {
  const days7Ago = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
  const today = new Date().toISOString().split('T')[0];
  
  // 获取当前bid
  let currentBid = 0;
  if (keywordId) {
    const kw = await db.select({ bid: keywords.bid }).from(keywords)
      .where(eq(keywords.id, keywordId)).limit(1);
    currentBid = kw[0] ? Number(kw[0].bid) : 0;
  } else if (targetId) {
    const tgt = await db.select({ bid: productTargets.bid }).from(productTargets)
      .where(eq(productTargets.id, targetId)).limit(1);
    currentBid = tgt[0] ? Number(tgt[0].bid) : 0;
  }
  
  // 获取最近7天的聚合绩效
  const perfResults = await db.select({
    totalImpressions: sql<number>`SUM(impressions)`,
    totalClicks: sql<number>`SUM(clicks)`,
    totalOrders: sql<number>`SUM(orders)`,
    totalSpend: sql<number>`SUM(CAST(spend AS DECIMAL(10,2)))`,
    totalSales: sql<number>`SUM(CAST(sales AS DECIMAL(10,2)))`,
  }).from(dailyPerformance)
    .where(and(
      eq(dailyPerformance.accountId, accountId),
      campaignId ? eq(dailyPerformance.campaignId, campaignId) : sql`1=1`,
      gte(dailyPerformance.date, days7Ago),
      lte(dailyPerformance.date, today)
    ));
  
  const perf = perfResults[0] || {};
  const impressions = Number(perf.totalImpressions) || 0;
  const clicks = Number(perf.totalClicks) || 0;
  const orders = Number(perf.totalOrders) || 0;
  const spend = Number(perf.totalSpend) || 0;
  const sales = Number(perf.totalSales) || 0;
  
  return {
    bid: currentBid,
    impressions,
    clicks,
    orders,
    spend,
    sales,
    acos: sales > 0 ? spend / sales : 0,
    cvr: clicks > 0 ? orders / clicks : 0,
    cpc: clicks > 0 ? spend / clicks : 0,
    competition: 0, // 将由上下文特征填充
  };
}

/**
 * 延迟回填Reward（定时任务，每天执行一次）
 * 查找24-72小时前的State-Action记录，用后续绩效数据计算Reward
 */
export async function backfillRewards(accountId: number): Promise<number> {
  const db = await getDbInstance();
  let filledCount = 0;
  
  try {
    // 查找需要回填Reward的记录（24-72小时前创建，尚未回填）
    const hoursAgo72 = new Date(Date.now() - 72 * 3600000).toISOString();
    const hoursAgo24 = new Date(Date.now() - 24 * 3600000).toISOString();
    
    const pendingLogs = await db.select({
      id: rlTrainingLogs.id,
      accountId: rlTrainingLogs.accountId,
      keywordId: rlTrainingLogs.keywordId,
      targetId: rlTrainingLogs.targetId,
      campaignId: rlTrainingLogs.campaignId,
      actionBidAfter: rlTrainingLogs.actionBidAfter,
      actionBidBefore: rlTrainingLogs.actionBidBefore,
      createdAt: rlTrainingLogs.createdAt,
    }).from(rlTrainingLogs)
      .where(and(
        eq(rlTrainingLogs.accountId, accountId),
        isNull(rlTrainingLogs.rewardFilledAt),
        gte(rlTrainingLogs.createdAt, hoursAgo72),
        lte(rlTrainingLogs.createdAt, hoursAgo24)
      ))
      .limit(500);
    
    for (const log of pendingLogs) {
      try {
        const logDate = new Date(log.createdAt as string);
        const nextDay = new Date(logDate.getTime() + 86400000).toISOString().split('T')[0];
        const twoDaysLater = new Date(logDate.getTime() + 2 * 86400000).toISOString().split('T')[0];
        
        // 获取调整后1-2天的绩效数据
        const afterPerf = await db.select({
          totalImpressions: sql<number>`SUM(impressions)`,
          totalClicks: sql<number>`SUM(clicks)`,
          totalOrders: sql<number>`SUM(orders)`,
          totalSpend: sql<number>`SUM(CAST(spend AS DECIMAL(10,2)))`,
          totalSales: sql<number>`SUM(CAST(sales AS DECIMAL(10,2)))`,
        }).from(dailyPerformance)
          .where(and(
            eq(dailyPerformance.accountId, log.accountId),
            log.campaignId ? eq(dailyPerformance.campaignId, log.campaignId) : sql`1=1`,
            gte(dailyPerformance.date, nextDay),
            lte(dailyPerformance.date, twoDaysLater)
          ));
        
        const perf = afterPerf[0] || {};
        const rewardImpressions = Number(perf.totalImpressions) || 0;
        const rewardClicks = Number(perf.totalClicks) || 0;
        const rewardOrders = Number(perf.totalOrders) || 0;
        const rewardSpend = Number(perf.totalSpend) || 0;
        const rewardSales = Number(perf.totalSales) || 0;
        
        // 计算增量利润作为Reward
        // Reward = Sales - Spend - (估计的产品成本)
        // 简化：使用 (Sales - Spend) 作为广告利润
        const rewardProfit = rewardSales - rewardSpend;
        
        // 归一化Reward：使用出价变化方向的利润变化
        // 正Reward = 利润增加，负Reward = 利润减少
        const reward = rewardProfit;
        
        await db.update(rlTrainingLogs)
          .set({
            reward: String(reward),
            rewardImpressions,
            rewardClicks,
            rewardOrders,
            rewardSpend: String(rewardSpend),
            rewardSales: String(rewardSales),
            rewardProfit: String(rewardProfit),
            rewardFilledAt: new Date().toISOString(),
          })
          .where(eq(rlTrainingLogs.id, log.id));
        
        filledCount++;
      } catch (e) {
        console.error(`[RLDataRecorder] Failed to fill reward for log ${log.id}:`, e);
      }
    }
    
    console.log(`[RLDataRecorder] Backfilled ${filledCount} rewards for account ${accountId}`);
    return filledCount;
    
  } catch (error) {
    console.error(`[RLDataRecorder] Error backfilling rewards:`, error);
    return filledCount;
  }
}

/**
 * 获取训练数据集（供CQL离线RL使用）
 */
export async function getTrainingDataset(
  accountId: number,
  limit: number = 10000
): Promise<any[]> {
  const db = await getDbInstance();
  
  const data = await db.select().from(rlTrainingLogs)
    .where(and(
      eq(rlTrainingLogs.accountId, accountId),
      sql`reward IS NOT NULL`,
      sql`reward_filled_at IS NOT NULL`
    ))
    .orderBy(sql`created_at DESC`)
    .limit(limit);
  
  return data;
}
