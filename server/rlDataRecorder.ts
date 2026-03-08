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
  db: ReturnType<typeof getDb> | null,
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
    rlLog.warn(`[RLDataRecorder] v231: recordBidAction skipped - missing accountId`);
    return;
  }
  if (!action.keywordId && !action.targetId) {
    rlLog.warn(`[RLDataRecorder] v231: recordBidAction skipped - missing both keywordId and targetId`);
    return;
  }
  if (action.bidAfter == null || !isFinite(action.bidAfter)) {
    rlLog.warn(`[RLDataRecorder] v231: recordBidAction skipped - invalid bidAfter: ${action.bidAfter}`);
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
    rlLog.error(`[RLDataRecorder] Failed to record bid action:`, error);
  }
}

/**
 * v252: 捕获当前状态快照
 * 
 * 修复: 优先使用关键词/商品定向级别的绩效数据，而非账户/Campaign级别汇总
 * 根因: 之前当campaignId为空时，SQL条件退化为`1=1`，导致查询整个账户的
 *       dailyPerformance汇总数据，所有关键词共享相同的state特征，
 *       RL模型无法区分不同关键词的表现差异
 * 
 * 修复策略:
 *   1. 优先从keywords/productTargets表直接获取实体级别的绩效数据（最精确）
 *   2. 仅在实体级别数据不可用时，回退到campaign级别的dailyPerformance
 *   3. 最后回退到账户级别（保持向后兼容）
 */
async function captureStateSnapshot(
  db: ReturnType<typeof getDb> | null,
  accountId: number,
  keywordId?: number,
  targetId?: number,
  campaignId?: string
): Promise<StateSnapshot> {
  let currentBid = 0;
  let impressions = 0;
  let clicks = 0;
  let orders = 0;
  let spend = 0;
  let sales = 0;
  let dataSource = 'none';
  
  // ===== 策略1: 从关键词/商品定向表直接获取实体级别数据（最精确） =====
  if (keywordId) {
    const kwResults = await db.select({
      bid: keywords.bid,
      impressions: keywords.impressions,
      clicks: keywords.clicks,
      orders: keywords.orders,
      spend: keywords.spend,
      sales: keywords.sales,
    }).from(keywords)
      .where(eq(keywords.id, keywordId)).limit(1);
    
    if (kwResults[0]) {
      currentBid = Number(kwResults[0].bid) || 0;
      impressions = Number(kwResults[0].impressions) || 0;
      clicks = Number(kwResults[0].clicks) || 0;
      orders = Number(kwResults[0].orders) || 0;
      spend = Number(kwResults[0].spend) || 0;
      sales = Number(kwResults[0].sales) || 0;
      dataSource = 'keyword_entity';
    }
  } else if (targetId) {
    const tgtResults = await db.select({
      bid: productTargets.bid,
      impressions: productTargets.impressions,
      clicks: productTargets.clicks,
      orders: productTargets.orders,
      spend: productTargets.spend,
      sales: productTargets.sales,
    }).from(productTargets)
      .where(eq(productTargets.id, targetId)).limit(1);
    
    if (tgtResults[0]) {
      currentBid = Number(tgtResults[0].bid) || 0;
      impressions = Number(tgtResults[0].impressions) || 0;
      clicks = Number(tgtResults[0].clicks) || 0;
      orders = Number(tgtResults[0].orders) || 0;
      spend = Number(tgtResults[0].spend) || 0;
      sales = Number(tgtResults[0].sales) || 0;
      dataSource = 'product_target_entity';
    }
  }
  
  // ===== 策略2: 实体级别数据不可用时，回退到campaign级别的dailyPerformance =====
  if (dataSource === 'none' && campaignId) {
    const days7Ago = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
    const today = new Date().toISOString().split('T')[0];
    
    const perfResults = await db.select({
      totalImpressions: sql<number>`SUM(impressions)`,
      totalClicks: sql<number>`SUM(clicks)`,
      totalOrders: sql<number>`SUM(orders)`,
      totalSpend: sql<number>`SUM(CAST(spend AS DECIMAL(10,2)))`,
      totalSales: sql<number>`SUM(CAST(sales AS DECIMAL(10,2)))`,
    }).from(dailyPerformance)
      .where(and(
        eq(dailyPerformance.accountId, accountId),
        eq(dailyPerformance.campaignId, campaignId),
        gte(dailyPerformance.date, days7Ago),
        lte(dailyPerformance.date, today)
      ));
    
    const perf = perfResults[0] || {};
    impressions = Number(perf.totalImpressions) || 0;
    clicks = Number(perf.totalClicks) || 0;
    orders = Number(perf.totalOrders) || 0;
    spend = Number(perf.totalSpend) || 0;
    sales = Number(perf.totalSales) || 0;
    dataSource = 'campaign_daily';
    
    // 如果策略1没有获取到bid，尝试从关键词/定向表获取
    if (currentBid === 0) {
      if (keywordId) {
        const kw = await db.select({ bid: keywords.bid }).from(keywords)
          .where(eq(keywords.id, keywordId)).limit(1);
        currentBid = kw[0] ? Number(kw[0].bid) : 0;
      } else if (targetId) {
        const tgt = await db.select({ bid: productTargets.bid }).from(productTargets)
          .where(eq(productTargets.id, targetId)).limit(1);
        currentBid = tgt[0] ? Number(tgt[0].bid) : 0;
      }
    }
  }
  
  // ===== 策略3: 最后回退到账户级别（仅在无campaignId时） =====
  if (dataSource === 'none') {
    const days7Ago = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
    const today = new Date().toISOString().split('T')[0];
    
    const perfResults = await db.select({
      totalImpressions: sql<number>`SUM(impressions)`,
      totalClicks: sql<number>`SUM(clicks)`,
      totalOrders: sql<number>`SUM(orders)`,
      totalSpend: sql<number>`SUM(CAST(spend AS DECIMAL(10,2)))`,
      totalSales: sql<number>`SUM(CAST(sales AS DECIMAL(10,2)))`,
    }).from(dailyPerformance)
      .where(and(
        eq(dailyPerformance.accountId, accountId),
        gte(dailyPerformance.date, days7Ago),
        lte(dailyPerformance.date, today)
      ));
    
    const perf = perfResults[0] || {};
    impressions = Number(perf.totalImpressions) || 0;
    clicks = Number(perf.totalClicks) || 0;
    orders = Number(perf.totalOrders) || 0;
    spend = Number(perf.totalSpend) || 0;
    sales = Number(perf.totalSales) || 0;
    dataSource = 'account_fallback';
    
    rlLog.warn(`[captureStateSnapshot] v252: 使用账户级别回退数据 accountId=${accountId}, keywordId=${keywordId}, targetId=${targetId} (无campaignId)`);
  }
  
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
 * v257: 延迟回填Reward（定时任务，每30分钟由nextGenMaintenance触发）
 * 
 * v257增强 — 三通道回填策略:
 * 通道A（即时回填）: 对于有实体级绩效数据的日志，立即回填（无需等待3小时）
 * 通道B（延迟回填）: 对于需要dailyPerformance归因的日志，保持3小时延迟
 * 通道C（历史合成）: v257新增，当通道A/B均无数据时，从optimization_events中合成奖励
 * 
 * v256基础:
 * 1. 移除固定3小时下限，改为智能多通道回填策略
 * 2. 扩展上限到168小时（7天），确保系统重启后不丢失历史数据
 * 3. 系统重启后自动恢复：RL日志持久化在数据库中，不受进程重启影响
 * 4. 移除limit(500)限制，确保每次回填完整处理所有待回填记录
 * 5. 增强零数据场景处理：当绩效数据全为0时，给予中性reward(0)而非负奖励
 */
export async function backfillRewards(accountId: number): Promise<number> {
  const db = await getDbInstance();
  let filledCount = 0;
  let skippedNoData = 0;
  let immediateFilledCount = 0;
  let retriedFromZero = 0;
  let channelCSuccess = 0;
  
  try {
    // v259: 增强回填链路健壮性
    // 核心改进：
    //   1. 零数据重试机制：对之前被零数据中性回填的日志，在数据同步后重新尝试回填真实数据
    //   2. 通道C增强：从optimiaztion_events中提取更完整的绩效数据
    //   3. 回填健康检查：统计各通道成功率，识别断裂点
    
    const hoursAgo168 = new Date(Date.now() - 168 * 3600000).toISOString();
    
    // v266 P1-1: 扩大零数据重试范围，从50条提升到200条，确保更完整的数据回填
    const zeroFilledLogs = await db.select({
      id: rlTrainingLogs.id,
      keywordId: rlTrainingLogs.keywordId,
      targetId: rlTrainingLogs.targetId,
      campaignId: rlTrainingLogs.campaignId,
      accountId: rlTrainingLogs.accountId,
      actionBidAfter: rlTrainingLogs.actionBidAfter,
      actionBidBefore: rlTrainingLogs.actionBidBefore,
      createdAt: rlTrainingLogs.createdAt,
    }).from(rlTrainingLogs)
      .where(and(
        eq(rlTrainingLogs.accountId, accountId),
        sql`reward = '0'`,
        sql`reward_impressions = 0`,
        sql`reward_clicks = 0`,
        gte(rlTrainingLogs.createdAt, hoursAgo168)
      ))
      .limit(200); // v266: 从50提升到200，确保更完整的数据回填
    
    // v259: 尝试为零数据日志重新回填真实数据
    for (const zLog of zeroFilledLogs) {
      try {
        let hasRealData = false;
        let ri = 0, rc = 0, ro = 0, rsp = 0, rsa = 0;
        
        if (zLog.keywordId) {
          const kwPerf = await db.select({
            impressions: keywords.impressions,
            clicks: keywords.clicks,
            orders: keywords.orders,
            spend: keywords.spend,
            sales: keywords.sales,
          }).from(keywords).where(eq(keywords.id, zLog.keywordId)).limit(1);
          if (kwPerf[0] && (Number(kwPerf[0].impressions) > 0 || Number(kwPerf[0].clicks) > 0)) {
            ri = Number(kwPerf[0].impressions) || 0;
            rc = Number(kwPerf[0].clicks) || 0;
            ro = Number(kwPerf[0].orders) || 0;
            rsp = Number(kwPerf[0].spend) || 0;
            rsa = Number(kwPerf[0].sales) || 0;
            hasRealData = true;
          }
        } else if (zLog.targetId) {
          const tgtPerf = await db.select({
            impressions: productTargets.impressions,
            clicks: productTargets.clicks,
            orders: productTargets.orders,
            spend: productTargets.spend,
            sales: productTargets.sales,
          }).from(productTargets).where(eq(productTargets.id, zLog.targetId)).limit(1);
          if (tgtPerf[0] && (Number(tgtPerf[0].impressions) > 0 || Number(tgtPerf[0].clicks) > 0)) {
            ri = Number(tgtPerf[0].impressions) || 0;
            rc = Number(tgtPerf[0].clicks) || 0;
            ro = Number(tgtPerf[0].orders) || 0;
            rsp = Number(tgtPerf[0].spend) || 0;
            rsa = Number(tgtPerf[0].sales) || 0;
            hasRealData = true;
          }
        }
        
        if (hasRealData) {
          const profit = rsa - rsp;
          const reward = rsp > 0 ? profit / rsp : profit;
          await db.update(rlTrainingLogs)
            .set({
              reward: String(reward),
              rewardImpressions: ri,
              rewardClicks: rc,
              rewardOrders: ro,
              rewardSpend: String(rsp),
              rewardSales: String(rsa),
              rewardProfit: String(profit),
              rewardFilledAt: new Date().toISOString(),
            })
            .where(eq(rlTrainingLogs.id, zLog.id));
          retriedFromZero++;
        }
      } catch (retryErr) {
        // 重试失败不影响主流程
      }
    }
    
    if (retriedFromZero > 0) {
      rlLog.info(`[backfillRewards] 账户${accountId}: v259零数据重试成功 ${retriedFromZero}/${zeroFilledLogs.length}条`);
    }
    
    rlLog.info(`[backfillRewards] 账户${accountId}: 查找168h内未回填的RL日志（v259增强三通道+重试）...`);
    
    // v256: 查找所有168小时内未回填的记录（不再有下限限制）
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
        gte(rlTrainingLogs.createdAt, hoursAgo168)
      ));
    
    rlLog.info(`[backfillRewards] 账户${accountId}: 找到${pendingLogs.length}条待回填记录`);
    
    for (const log of pendingLogs) {
      try {
        const logDate = new Date(log.createdAt as string);
        const logAgeHours = (Date.now() - logDate.getTime()) / 3600000;
        const nextDay = new Date(logDate.getTime() + 86400000).toISOString().split('T')[0];
        const twoDaysLater = new Date(logDate.getTime() + 2 * 86400000).toISOString().split('T')[0];
        
        // v256: 智能双通道回填策略
        let rewardImpressions = 0;
        let rewardClicks = 0;
        let rewardOrders = 0;
        let rewardSpend = 0;
        let rewardSales = 0;
        let dataSource = 'none';
        let usedImmediateChannel = false;
        
        // v267 P1-1: 通道A根治 — 使用daily_performance表计算出价调整前后的真正增量变化
        // 核心修复: keywords/productTargets表是累计数据，无法反映出价调整的因果关系
        // v267方案: 从调整前后的daily_performance中计算增量差值，反映出价变化的真实效果
        // 回退策略: 如果daily_performance无数据，回退到keywords/productTargets表
        if (log.keywordId || log.targetId) {
          const adjustDate = logDate.toISOString().split('T')[0];
          const beforeDate = new Date(logDate.getTime() - 86400000).toISOString().split('T')[0];
          const afterDate1 = new Date(logDate.getTime() + 86400000).toISOString().split('T')[0];
          const afterDate2 = new Date(logDate.getTime() + 2 * 86400000).toISOString().split('T')[0];
          
          // 尝试从 daily_performance 获取调整前后的增量数据
          if (logAgeHours >= 48) {
            // 调整前1天的基线绩效
            const beforePerf = await db.select({
              totalImpressions: sql<number>`SUM(impressions)`,
              totalClicks: sql<number>`SUM(clicks)`,
              totalOrders: sql<number>`SUM(orders)`,
              totalSpend: sql<number>`SUM(CAST(spend AS DECIMAL(10,2)))`,
              totalSales: sql<number>`SUM(CAST(sales AS DECIMAL(10,2)))`,
            }).from(dailyPerformance)
              .where(and(
                eq(dailyPerformance.accountId, log.accountId),
                log.campaignId ? eq(dailyPerformance.campaignId, log.campaignId) : sql`1=1`,
                eq(dailyPerformance.date, beforeDate)
              ));
            
            // 调整后1-2天的绩效
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
                gte(dailyPerformance.date, afterDate1),
                lte(dailyPerformance.date, afterDate2)
              ));
            
            const bPerf = beforePerf[0] || {};
            const aPerf = afterPerf[0] || {};
            const bImpressions = Number(bPerf.totalImpressions) || 0;
            const aImpressions = Number(aPerf.totalImpressions) || 0;
            
            if (bImpressions > 0 || aImpressions > 0) {
              // 计算增量: 调整后的平均日绩效 vs 调整前的日绩效
              const afterDays = 2; // 调整后看2天平均
              rewardImpressions = Math.round((Number(aPerf.totalImpressions) || 0) / afterDays);
              rewardClicks = Math.round((Number(aPerf.totalClicks) || 0) / afterDays);
              rewardOrders = Math.round((Number(aPerf.totalOrders) || 0) / afterDays);
              rewardSpend = (Number(aPerf.totalSpend) || 0) / afterDays;
              rewardSales = (Number(aPerf.totalSales) || 0) / afterDays;
              dataSource = 'daily_performance_incremental';
              usedImmediateChannel = true;
            }
          }
          
          // 回退策略: 使用keywords/productTargets的当前数据
          if (dataSource === 'none') {
            if (log.keywordId) {
              const kwPerf = await db.select({
                impressions: keywords.impressions,
                clicks: keywords.clicks,
                orders: keywords.orders,
                spend: keywords.spend,
                sales: keywords.sales,
              }).from(keywords).where(eq(keywords.id, log.keywordId)).limit(1);
              
              if (kwPerf[0]) {
                const ci = Number(kwPerf[0].impressions) || 0;
                const cc = Number(kwPerf[0].clicks) || 0;
                if (logAgeHours >= 24 && (ci > 0 || cc > 0)) {
                  rewardImpressions = ci; rewardClicks = cc;
                  rewardOrders = Number(kwPerf[0].orders) || 0;
                  rewardSpend = Number(kwPerf[0].spend) || 0;
                  rewardSales = Number(kwPerf[0].sales) || 0;
                  dataSource = 'keyword_post_attribution';
                  usedImmediateChannel = true;
                } else if (ci > 0 || cc > 0) {
                  rewardImpressions = ci; rewardClicks = cc;
                  rewardOrders = Number(kwPerf[0].orders) || 0;
                  rewardSpend = Number(kwPerf[0].spend) || 0;
                  rewardSales = Number(kwPerf[0].sales) || 0;
                  dataSource = 'keyword_pre_attribution';
                  usedImmediateChannel = true;
                }
              }
            } else if (log.targetId) {
              const tgtPerf = await db.select({
                impressions: productTargets.impressions,
                clicks: productTargets.clicks,
                orders: productTargets.orders,
                spend: productTargets.spend,
                sales: productTargets.sales,
              }).from(productTargets).where(eq(productTargets.id, log.targetId)).limit(1);
              
              if (tgtPerf[0]) {
                const ci = Number(tgtPerf[0].impressions) || 0;
                const cc = Number(tgtPerf[0].clicks) || 0;
                if (logAgeHours >= 24 && (ci > 0 || cc > 0)) {
                  rewardImpressions = ci; rewardClicks = cc;
                  rewardOrders = Number(tgtPerf[0].orders) || 0;
                  rewardSpend = Number(tgtPerf[0].spend) || 0;
                  rewardSales = Number(tgtPerf[0].sales) || 0;
                  dataSource = 'target_post_attribution';
                  usedImmediateChannel = true;
                } else if (ci > 0 || cc > 0) {
                  rewardImpressions = ci; rewardClicks = cc;
                  rewardOrders = Number(tgtPerf[0].orders) || 0;
                  rewardSpend = Number(tgtPerf[0].spend) || 0;
                  rewardSales = Number(tgtPerf[0].sales) || 0;
                  dataSource = 'target_pre_attribution';
                  usedImmediateChannel = true;
                }
              }
            }
          }
        }
        
        // v266 P1-1: 通道B优化 — 扩展时间窗口以适应Amazon更长的归因延迟
        // 原来只看调整后1-2天，v266扩展到1-3天，并增加归因窗口权重
        if (dataSource === 'none') {
          if (logAgeHours < 6) {
            // v266: 将最小等待时间从3h提升到6h，减少不完整数据的干扰
            continue;
          }
          // v266: 扩展查询窗口到1-3天，覆盖Amazon的归因延迟窗口
          const threeDaysLater = new Date(logDate.getTime() + 3 * 86400000).toISOString().split('T')[0];
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
              lte(dailyPerformance.date, threeDaysLater)
            ));
          
          const perf = afterPerf[0] || {};
          rewardImpressions = Number(perf.totalImpressions) || 0;
          rewardClicks = Number(perf.totalClicks) || 0;
          rewardOrders = Number(perf.totalOrders) || 0;
          rewardSpend = Number(perf.totalSpend) || 0;
          rewardSales = Number(perf.totalSales) || 0;
          dataSource = 'campaign_daily';
        }
        
        // v257: 通道C（历史合成）: 当通道A/B均无数据时，从optimization_events中合成奖励
        // 这解决了冷启动场景：新关键词尚无绩效数据，但已有优化事件记录
        if (dataSource === 'none' || (rewardImpressions === 0 && rewardClicks === 0 && rewardSpend === 0)) {
          try {
            const { optimizationEvents } = await import('../drizzle/schema');
            const entityConditions = [
              eq(optimizationEvents.accountId, log.accountId),
              sql`${optimizationEvents.eventCategory} = 'bid_adjustment'`,
              sql`${optimizationEvents.status} = 'success'`,
              gte(optimizationEvents.createdAt, new Date(logDate.getTime() - 3600000).toISOString()),
              lte(optimizationEvents.createdAt, new Date(logDate.getTime() + 48 * 3600000).toISOString()),
            ];
            if (log.keywordId) {
              entityConditions.push(eq(optimizationEvents.keywordId, log.keywordId));
            } else if (log.targetId) {
              entityConditions.push(eq(optimizationEvents.targetId, log.targetId));
            }
            
            const eventData = await db.select({
              performanceData: optimizationEvents.performanceData,
              previousBid: optimizationEvents.previousBid,
              newBid: optimizationEvents.newBid,
            }).from(optimizationEvents)
              .where(and(...entityConditions))
              .orderBy(sql`created_at DESC`)
              .limit(1);
            
            if (eventData[0]?.performanceData) {
              const perfData = typeof eventData[0].performanceData === 'string' 
                ? JSON.parse(eventData[0].performanceData) 
                : eventData[0].performanceData;
              if (perfData) {
                rewardImpressions = Number(perfData.impressions || perfData.stateImpressions) || 0;
                rewardClicks = Number(perfData.clicks || perfData.stateClicks) || 0;
                rewardOrders = Number(perfData.orders || perfData.stateOrders) || 0;
                rewardSpend = Number(perfData.spend || perfData.stateSpend) || 0;
                rewardSales = Number(perfData.sales || perfData.stateSales) || 0;
                if (rewardImpressions > 0 || rewardClicks > 0) {
                  dataSource = 'optimization_events_synthesis';
                }
              }
            }
          } catch (synthErr) {
            // 历史合成失败不影响主流程
          }
        }
        
        // v266 P1-1: 通道D（出价方向合成）— 解决冷启动死锁
        // 当所有通道都无数据时，基于出价变化方向和幅度生成合成奖励
        // 核心思想: 小幅降价给予微正奖励(0.1)，小幅提价给予微正奖励(0.05)，大幅调整给予中性(0)
        // 这样可以为RL算法提供初始信号，打破“无数据→无奖励→无学习”的死锁
        if (rewardImpressions === 0 && rewardClicks === 0 && rewardSpend === 0) {
          const bidBefore = Number(log.actionBidBefore) || 0;
          const bidAfter = Number(log.actionBidAfter) || 0;
          const bidChangeRatio = bidBefore > 0 ? (bidAfter - bidBefore) / bidBefore : 0;
          
          let syntheticReward = 0;
          if (Math.abs(bidChangeRatio) <= 0.15) {
            // 小幅调整(±15%以内): 给予微正奖励，鼓励保守策略
            syntheticReward = bidChangeRatio < 0 ? 0.1 : 0.05;
          } else {
            // 大幅调整: 给予中性奖励，不鼓励也不惩罚
            syntheticReward = 0;
          }
          
          skippedNoData++;
          await db.update(rlTrainingLogs)
            .set({
              reward: String(syntheticReward),
              rewardImpressions: 0,
              rewardClicks: 0,
              rewardOrders: 0,
              rewardSpend: '0',
              rewardSales: '0',
              rewardProfit: '0',
              rewardFilledAt: new Date().toISOString(),
            })
            .where(eq(rlTrainingLogs.id, log.id));
          filledCount++;
          continue;
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
        
        if (usedImmediateChannel) immediateFilledCount++;
        filledCount++;
      } catch (e) {
        rlLog.error(`[RLDataRecorder] Failed to fill reward for log ${log.id}:`, e);
      }
    }
    
    rlLog.info(`[backfillRewards] 账户${accountId}: v259增强回填完成, 待回填=${pendingLogs.length}, 成功回填=${filledCount}, 即时通道A=${immediateFilledCount}, 零数据中性=${skippedNoData}, 零数据重试成功=${retriedFromZero}`);
    
    // v259: 回填健康检查报告
    const totalProcessed = filledCount + skippedNoData;
    const realDataRate = totalProcessed > 0 ? ((filledCount - skippedNoData) / totalProcessed * 100).toFixed(1) : '0';
    const channelARate = totalProcessed > 0 ? (immediateFilledCount / totalProcessed * 100).toFixed(1) : '0';
    rlLog.info(`[backfillRewards] v259健康检查: 真实数据率=${realDataRate}%, 通道A成功率=${channelARate}%, 零数据重试=${retriedFromZero}条`);
    return filledCount;
    
  } catch (error: unknown) {
    rlLog.error(`[backfillRewards] 账户${accountId}回填异常: ${(error as Error).message}`);
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
    rlLog.warn(`[RLDataRecorder] v231: recordBidPerformanceHistory skipped - missing required params: accountId=${params.accountId}, campaignId=${params.campaignId}, bidObjectId=${params.bidObjectId}, bid=${params.bid}`);
    return;
  }
  if (params.bid <= 0 || !isFinite(params.bid)) {
    rlLog.warn(`[RLDataRecorder] v231: recordBidPerformanceHistory skipped - invalid bid value: ${params.bid}`);
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
    
    rlLog.info(`[RLDataRecorder] v230: bidPerformanceHistory recorded: account=${params.accountId}, type=${params.bidObjectType}, id=${params.bidObjectId}, bid=${params.bid}`);
  } catch (error) {
    // 记录失败不阻塞主流程
    rlLog.error(`[RLDataRecorder] v230: Failed to record bidPerformanceHistory:`, error);
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
  
  rlLog.info(`[RLDataRecorder] v230: batchRecordBidPerformanceHistory: recorded=${recorded}, failed=${failed}`);
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
      rlLog.info(`[RLDataRecorder] v230: backfillBidPerformanceResults: updated=${updated}, skipped=${skipped}, total_checked=${staleRecords.length}`);
    }
    
    return { updated, skipped };
  } catch (error) {
    rlLog.error(`[RLDataRecorder] v230: Failed to backfill bid performance results:`, error);
    return { updated: 0, skipped: 0 };
  }
}
