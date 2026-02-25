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
import { createModuleLogger } from './utils/logger';

const rlLog = createModuleLogger('RLDataRecorder');
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
  // v231: 防御性校验 - 确保必要参数有效
  if (!action.accountId) {
    console.warn(`[RLDataRecorder] v231: recordBidAction skipped - missing accountId`);
    return;
  }
  if (!action.keywordId && !action.targetId) {
    console.warn(`[RLDataRecorder] v231: recordBidAction skipped - missing both keywordId and targetId`);
    return;
  }
  if (action.bidAfter == null || !isFinite(action.bidAfter)) {
    console.warn(`[RLDataRecorder] v231: recordBidAction skipped - invalid bidAfter: ${action.bidAfter}`);
    return;
  }
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
    // v248: 进一步缩短回填下限 6h → 3h，打破RL冷启动死锁
    // 根因: 6h下限导致所有RL日志reward始终为0，高级算法永远不能eligible
    // Amazon广告数据通常在2-4小时后可用，3小时是更积极的安全下限
    // 上限保持96小时，避免因系统重启导致的回填空窗
    const hoursAgo96 = new Date(Date.now() - 96 * 3600000).toISOString();
    const hoursAgo3 = new Date(Date.now() - 3 * 3600000).toISOString();
    rlLog.info(`[backfillRewards] 账户${accountId}: 查找3-96h内未回填的RL日志...`);
    
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
        gte(rlTrainingLogs.createdAt, hoursAgo96),
        lte(rlTrainingLogs.createdAt, hoursAgo3)
      ))
      .limit(500);
    
    for (const log of pendingLogs) {
      try {
        const logDate = new Date(log.createdAt as string);
        const nextDay = new Date(logDate.getTime() + 86400000).toISOString().split('T')[0];
        const twoDaysLater = new Date(logDate.getTime() + 2 * 86400000).toISOString().split('T')[0];
        
        // v230: 修复归因粒度 - 优先使用关键词/商品定向级别的绩效数据，而非整个Campaign级别
        let rewardImpressions = 0;
        let rewardClicks = 0;
        let rewardOrders = 0;
        let rewardSpend = 0;
        let rewardSales = 0;
        
        if (log.keywordId) {
          // 关键词级别归因：直接从keywords表获取绩效数据
          const kwPerf = await db.select({
            impressions: keywords.impressions,
            clicks: keywords.clicks,
            orders: keywords.orders,
            spend: keywords.spend,
            sales: keywords.sales,
          }).from(keywords).where(eq(keywords.id, log.keywordId)).limit(1);
          
          if (kwPerf[0]) {
            rewardImpressions = Number(kwPerf[0].impressions) || 0;
            rewardClicks = Number(kwPerf[0].clicks) || 0;
            rewardOrders = Number(kwPerf[0].orders) || 0;
            rewardSpend = Number(kwPerf[0].spend) || 0;
            rewardSales = Number(kwPerf[0].sales) || 0;
          }
        } else if (log.targetId) {
          // 商品定向级别归因：从productTargets表获取绩效数据
          const tgtPerf = await db.select({
            impressions: productTargets.impressions,
            clicks: productTargets.clicks,
            orders: productTargets.orders,
            spend: productTargets.spend,
            sales: productTargets.sales,
          }).from(productTargets).where(eq(productTargets.id, log.targetId)).limit(1);
          
          if (tgtPerf[0]) {
            rewardImpressions = Number(tgtPerf[0].impressions) || 0;
            rewardClicks = Number(tgtPerf[0].clicks) || 0;
            rewardOrders = Number(tgtPerf[0].orders) || 0;
            rewardSpend = Number(tgtPerf[0].spend) || 0;
            rewardSales = Number(tgtPerf[0].sales) || 0;
          }
        } else {
          // 回退到Campaign级别（仅在无关键词/定向ID时）
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
          rewardImpressions = Number(perf.totalImpressions) || 0;
          rewardClicks = Number(perf.totalClicks) || 0;
          rewardOrders = Number(perf.totalOrders) || 0;
          rewardSpend = Number(perf.totalSpend) || 0;
          rewardSales = Number(perf.totalSales) || 0;
        }
        
        // v230: 使用归一化的Reward计算，避免不同规模关键词的绝对利润差异过大
        const rewardProfit = rewardSales - rewardSpend;
        const bidDelta = Number(log.actionBidAfter) - Number(log.actionBidBefore);
        // 归一化Reward: 利润率作为基准，避免绝对值偏差
        const reward = rewardSpend > 0 ? rewardProfit / rewardSpend : rewardProfit;
        
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
    
    rlLog.info(`[backfillRewards] 账户${accountId}: 回填完成, 待回填=${pendingLogs.length}, 成功回填=${filledCount}`);
    return filledCount;
    
  } catch (error: any) {
    rlLog.error(`[backfillRewards] 账户${accountId}回填异常: ${error.message}`);
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

/**
 * v230: 记录出价-绩效历史数据到 bidPerformanceHistory 表
 * 
 * 核心职责：为Sigmoid曲线拟合算法提供训练数据
 * 每次出价调整执行后调用，记录当前出价和对应的绩效指标
 * 
 * 调用时机：在 optimizationTargetEngine 的出价同步成功后调用
 */
export async function recordBidPerformanceHistory(params: {
  accountId: number;
  campaignId: string;
  bidObjectType: 'keyword' | 'asin';
  bidObjectId: number;
  bid: number;
  impressions?: number;
  clicks?: number;
  spend?: number;
  sales?: number;
  orders?: number;
}): Promise<void> {
  // v231: 防御性校验 - 确保关键参数有效，避免写入无效数据
  if (!params.accountId || !params.campaignId || !params.bidObjectId || params.bid == null) {
    console.warn(`[RLDataRecorder] v231: recordBidPerformanceHistory skipped - missing required params: accountId=${params.accountId}, campaignId=${params.campaignId}, bidObjectId=${params.bidObjectId}, bid=${params.bid}`);
    return;
  }
  if (params.bid <= 0 || !isFinite(params.bid)) {
    console.warn(`[RLDataRecorder] v231: recordBidPerformanceHistory skipped - invalid bid value: ${params.bid}`);
    return;
  }
  try {
    const db = await getDbInstance();
    const { bidPerformanceHistory } = await import('../drizzle/schema');
    
    const today = new Date().toISOString().split('T')[0];
    const currentHour = new Date().getHours();
    
    // 计算绩效指标
    const impressions = params.impressions || 0;
    const clicks = params.clicks || 0;
    const spend = params.spend || 0;
    const sales = params.sales || 0;
    const orders = params.orders || 0;
    
    const ctr = impressions > 0 ? clicks / impressions : 0;
    const cvr = clicks > 0 ? orders / clicks : 0;
    const acos = sales > 0 ? spend / sales : 0;
    const roas = spend > 0 ? sales / spend : 0;
    const effectiveCpc = clicks > 0 ? spend / clicks : 0;
    const revenue = sales;
    const profit = sales - spend;
    
    await db.insert(bidPerformanceHistory).values({
      accountId: params.accountId,
      campaignId: String(params.campaignId),
      bidObjectType: params.bidObjectType,
      bidObjectId: String(params.bidObjectId),
      bid: String(params.bid),
      effectiveCpc: String(effectiveCpc),
      date: today,
      timeSlot: currentHour,
      impressions,
      clicks,
      spend: String(spend),
      sales: String(sales),
      orders,
      ctr: String(ctr),
      cvr: String(cvr),
      acos: String(acos),
      roas: String(roas),
      revenue: String(revenue),
      profit: String(profit),
    } as any);
    
    console.log(`[RLDataRecorder] v230: bidPerformanceHistory recorded: account=${params.accountId}, type=${params.bidObjectType}, id=${params.bidObjectId}, bid=${params.bid}`);
  } catch (error) {
    // 记录失败不阻塞主流程
    console.error(`[RLDataRecorder] v230: Failed to record bidPerformanceHistory:`, error);
  }
}

/**
 * v230: 批量记录出价-绩效历史数据
 * 在优化目标引擎的出价同步成功后批量调用
 */
export async function batchRecordBidPerformanceHistory(records: Array<{
  accountId: number;
  campaignId: string;
  bidObjectType: 'keyword' | 'asin';
  bidObjectId: number;
  bid: number;
  impressions?: number;
  clicks?: number;
  spend?: number;
  sales?: number;
  orders?: number;
}>): Promise<{ recorded: number; failed: number }> {
  let recorded = 0;
  let failed = 0;
  
  for (const record of records) {
    try {
      await recordBidPerformanceHistory(record);
      recorded++;
    } catch (e) {
      failed++;
    }
  }
  
  console.log(`[RLDataRecorder] v230: batchRecordBidPerformanceHistory: recorded=${recorded}, failed=${failed}`);
  return { recorded, failed };
}

/**
 * v230: 回填bidPerformanceHistory中的绩效数据
 * 出价记录创建时只有bid值，绩效数据需要在后续同步后回填
 * 此函数在数据同步完成后被调度执行
 */
export async function backfillBidPerformanceResults(): Promise<{ updated: number; skipped: number }> {
  try {
    const db = await getDbInstance();
    const { bidPerformanceHistory, keywords, productTargets } = await import('../drizzle/schema');
    
    // 查找最近7天内尚未回填绩效数据的记录（impressions仍为0且记录时间超过24小时）
    const staleRecords = await db.select({
      id: bidPerformanceHistory.id,
      bidObjectType: bidPerformanceHistory.bidObjectType,
      bidObjectId: bidPerformanceHistory.bidObjectId,
    })
    .from(bidPerformanceHistory)
    .where(
      and(
        eq(bidPerformanceHistory.impressions, 0),
        sql`${bidPerformanceHistory.createdAt} < DATE_SUB(NOW(), INTERVAL 24 HOUR)`,
        sql`${bidPerformanceHistory.createdAt} > DATE_SUB(NOW(), INTERVAL 7 DAY)`
      )
    )
    .limit(200);
    
    let updated = 0;
    let skipped = 0;
    
    for (const record of staleRecords) {
      try {
        let perfData: any = null;
        
        if (record.bidObjectType === 'keyword') {
          const [kw] = await db.select({
            impressions: keywords.impressions,
            clicks: keywords.clicks,
            spend: keywords.spend,
            sales: keywords.sales,
            orders: keywords.orders,
          })
          .from(keywords)
          .where(eq(keywords.id, Number(record.bidObjectId)))
          .limit(1);
          perfData = kw;
        } else {
          const [pt] = await db.select({
            impressions: productTargets.impressions,
            clicks: productTargets.clicks,
            spend: productTargets.spend,
            sales: productTargets.sales,
            orders: productTargets.orders,
          })
          .from(productTargets)
          .where(eq(productTargets.id, Number(record.bidObjectId)))
          .limit(1);
          perfData = pt;
        }
        
        if (perfData && (parseInt(String(perfData.impressions || '0')) > 0)) {
          const impressions = parseInt(String(perfData.impressions || '0'));
          const clicks = parseInt(String(perfData.clicks || '0'));
          const spend = parseFloat(String(perfData.spend || '0'));
          const sales = parseFloat(String(perfData.sales || '0'));
          const orders = parseInt(String(perfData.orders || '0'));
          const ctr = impressions > 0 ? clicks / impressions : 0;
          const cvr = clicks > 0 ? orders / clicks : 0;
          const acos = sales > 0 ? spend / sales : 0;
          const roas = spend > 0 ? sales / spend : 0;
          
          await db.update(bidPerformanceHistory)
            .set({
              impressions: String(impressions),
              clicks: String(clicks),
              spend: String(spend),
              sales: String(sales),
              orders: String(orders),
              ctr: String(ctr),
              cvr: String(cvr),
              acos: String(acos),
              roas: String(roas),
              revenue: String(sales),
              profit: String(sales - spend),
            } as any)
            .where(eq(bidPerformanceHistory.id, record.id));
          
          updated++;
        } else {
          skipped++;
        }
      } catch (e) {
        skipped++;
      }
    }
    
    if (updated > 0 || staleRecords.length > 0) {
      console.log(`[RLDataRecorder] v230: backfillBidPerformanceResults: updated=${updated}, skipped=${skipped}, total_checked=${staleRecords.length}`);
    }
    
    return { updated, skipped };
  } catch (error) {
    console.error(`[RLDataRecorder] v230: Failed to backfill bid performance results:`, error);
    return { updated: 0, skipped: 0 };
  }
}
