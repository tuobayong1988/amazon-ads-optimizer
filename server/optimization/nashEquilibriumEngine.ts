/**
 * v490: 纳什均衡出价区间引擎 (Nash Equilibrium Bid Range Engine)
 * 
 * 核心理论：在亚马逊广告竞价中，每个关键词存在一个"纳什均衡区间"——
 * 在这个区间内，出价再增加不会显著提升ROI（边际收益递减），
 * 出价再降低则会导致曝光急剧下降（跌出竞争区间）。
 * 
 * 实现方法：
 * 1. 利用历史出价-绩效数据，拟合出价与曝光/转化的响应曲线
 * 2. 计算边际收益（dROI/dBid），找到边际收益趋近于零的区间上界
 * 3. 计算曝光弹性（dImpressions/dBid），找到弹性急剧下降的区间下界
 * 4. 结合亚马逊建议竞价范围作为先验锚点
 * 5. 输出 [bidFloor, bidCeiling] 作为纳什均衡区间
 * 
 * 集成点：作为安全约束层嵌入 calculateNextGenBid 的最终输出校验中
 * 当规则引擎/高级算法的出价落在均衡区间外时，将其拉回区间边界
 */

import { getDb } from '../db';
import { createModuleLogger } from '../utils/logger';
import { estimateBid as bayesianEstimateBid } from './bayesianBidSmoothingEngine';
const log = createModuleLogger('NashEquilibrium');

// ==================== 类型定义 ====================

export interface NashEquilibriumRange {
  /** 均衡区间下界（曝光弹性急剧下降的临界点） */
  bidFloor: number;
  /** 均衡区间上界（边际ROI趋近于零的临界点） */
  bidCeiling: number;
  /** 建议最优出价（均衡区间内的最优点） */
  optimalBid: number;
  /** 置信度 (0-1)，基于数据充分度 */
  confidence: number;
  /** 数据来源说明 */
  source: 'historical_curve' | 'suggested_bid_anchor' | 'hybrid' | 'current_bid_anchor' | 'bayesian_smoothing' | 'insufficient_data';
  /** 诊断信息 */
  diagnostics: {
    dataPoints: number;
    bidRange: [number, number];
    impressionElasticity: number;
    marginalRoiAtCeiling: number;
    suggestedBidUsed: boolean;
  };
}

interface BidPerformancePoint {
  bid: number;
  impressions: number;
  clicks: number;
  spend: number;
  sales: number;
  orders: number;
  date: string;
}

// ==================== 配置常量 ====================

const NASH_CONFIG = {
  /** 计算均衡区间所需的最小数据点数 */
  MIN_DATA_POINTS: 5,
  /** 理想数据点数（达到此数量时置信度为1.0） */
  IDEAL_DATA_POINTS: 20,
  /** 历史数据回溯天数 */
  LOOKBACK_DAYS: 30,
  /** 边际ROI阈值：低于此值认为边际收益趋近于零 */
  MARGINAL_ROI_THRESHOLD: 0.10,
  /** 曝光弹性阈值：低于此值认为曝光对出价不再敏感 */
  IMPRESSION_ELASTICITY_FLOOR: 0.15,
  /** 建议竞价锚定权重（当历史数据不足时） */
  SUGGESTED_BID_ANCHOR_WEIGHT: 0.40,
  /** 均衡区间的最小宽度（占中心值的百分比） */
  MIN_RANGE_WIDTH_PERCENT: 0.15,
  /** 均衡区间的最大宽度（占中心值的百分比） */
  MAX_RANGE_WIDTH_PERCENT: 0.60,
  /** 区间外出价的拉回强度 (0-1)：1.0=完全拉回边界，0.5=拉回一半 */
  PULLBACK_STRENGTH: 0.70,
};

// ==================== 核心算法 ====================

/**
 * 计算单个关键词/定向的纳什均衡出价区间
 * 
 * 算法流程：
 * 1. 从数据库加载历史出价-绩效数据
 * 2. 按出价水平分桶，计算每个桶的平均绩效
 * 3. 拟合出价-曝光响应曲线和出价-ROI响应曲线
 * 4. 计算边际收益和曝光弹性
 * 5. 确定均衡区间 [bidFloor, bidCeiling]
 * 6. 结合建议竞价进行锚定修正
 */
export async function calculateNashEquilibrium(
  accountId: number,
  keywordId?: number | string,
  targetId?: number | string,
  suggestedBid?: number,
  suggestedBidRangeStart?: number,
  suggestedBidRangeEnd?: number,
  currentBid?: number,
): Promise<NashEquilibriumRange> {
  try {
    // Step 1: 加载历史出价-绩效数据
    const historicalData = await loadBidPerformanceHistory(
      accountId, keywordId, targetId
    );

    // Step 2: 如果历史数据充足，使用曲线拟合法
    if (historicalData.length >= NASH_CONFIG.MIN_DATA_POINTS) {
      const curveResult = calculateFromHistoricalCurve(
        historicalData, suggestedBid, suggestedBidRangeStart, suggestedBidRangeEnd
      );
      
      // 如果有建议竞价，进行混合锚定
      if (suggestedBid && suggestedBid > 0) {
        return hybridWithSuggestedBid(
          curveResult, suggestedBid, suggestedBidRangeStart, suggestedBidRangeEnd
        );
      }
      
      return curveResult;
    }

    // Step 3: 历史数据不足，使用建议竞价锚定法
    if (suggestedBid && suggestedBid > 0) {
      return calculateFromSuggestedBid(
        suggestedBid, suggestedBidRangeStart, suggestedBidRangeEnd, currentBid
      );
    }

    // v491 Step 3.5: 贝叶斯平滑竞价推断 — 从同账户同类型实体的历史竞价分布中推断
    // 优先级高于currentBid锚点法，因为贝叶斯平滑融合了市场整体竞价水平
    if (currentBid && currentBid > 0) {
      try {
        const entityType = keywordId ? 'keyword' : (targetId ? 'product_target' : 'keyword');
        const bayesianResult = await bayesianEstimateBid(
          accountId, entityType, currentBid
        );
        if (bayesianResult.success && bayesianResult.confidence >= 0.30) {
          log.info(`[NashEquilibrium] v491贝叶斯平滑推断成功: ${bayesianResult.diagnosis}`);
          return {
            bidFloor: bayesianResult.bidRangeLow,
            bidCeiling: bayesianResult.bidRangeHigh,
            optimalBid: bayesianResult.estimatedBid,
            confidence: Math.round(bayesianResult.confidence * 100) / 100,
            source: 'bayesian_smoothing',
            diagnostics: {
              dataPoints: bayesianResult.prior.priorSampleCount,
              bidRange: [bayesianResult.bidRangeLow, bayesianResult.bidRangeHigh],
              impressionElasticity: 0,
              marginalRoiAtCeiling: 0,
              suggestedBidUsed: bayesianResult.prior.suggestedBidCount > 0,
            },
          };
        }
        log.debug(`[NashEquilibrium] v491贝叶斯平滑置信度不足(${bayesianResult.confidence.toFixed(2)}), 降级到currentBid锚点`);
      } catch (bayesErr: unknown) {
        log.debug(`[NashEquilibrium] v491贝叶斯平滑异常: ${(bayesErr as Error).message}, 降级到currentBid锚点`);
      }
    }

    // v491 Step 3.6: 降级策略 — 无suggestedBid且贝叶斯平滑不可用时，使用当前出价作为锚点
    // 理论基础：当前出价是广告主已经验证过的竞价水平，可以作为均衡区间的参考点
    // 但confidence低于suggestedBid锚定法和贝叶斯平滑（因为缺少市场竞价参考）
    if (currentBid && currentBid > 0) {
      return calculateFromCurrentBidAnchor(currentBid, historicalData.length);
    }

    // Step 4: 完全无数据，返回宽松的默认区间
    return createInsufficientDataResult(currentBid);

  } catch (error: unknown) {
    log.warn(`[NashEquilibrium] 计算异常: ${(error as Error).message}`);
    return createInsufficientDataResult(currentBid);
  }
}

/**
 * 基于历史出价-绩效曲线计算均衡区间
 * 
 * 核心算法：
 * 1. 将历史数据按出价水平分成5-10个桶
 * 2. 计算相邻桶之间的边际收益 (dROI/dBid) 和曝光弹性 (dImpressions%/dBid%)
 * 3. bidCeiling = 边际ROI首次低于阈值的出价水平
 * 4. bidFloor = 曝光弹性首次高于阈值的出价水平（从低到高看，弹性开始变大的点）
 */
function calculateFromHistoricalCurve(
  data: BidPerformancePoint[],
  suggestedBid?: number,
  suggestedBidRangeStart?: number,
  suggestedBidRangeEnd?: number,
): NashEquilibriumRange {
  // 按出价排序
  const sorted = [...data].sort((a, b) => a.bid - b.bid);
  const minBid = sorted[0].bid;
  const maxBid = sorted[sorted.length - 1].bid;
  
  // 动态分桶：根据数据量决定桶数
  const numBuckets = Math.min(Math.max(4, Math.floor(data.length / 3)), 8);
  const bucketWidth = (maxBid - minBid) / numBuckets;
  
  if (bucketWidth < 0.01) {
    // 出价变化范围太小，无法有效分桶
    return createInsufficientDataResult(sorted[Math.floor(sorted.length / 2)].bid);
  }
  
  // 分桶聚合
  interface BucketStats {
    bidCenter: number;
    avgImpressions: number;
    avgClicks: number;
    avgSpend: number;
    avgSales: number;
    avgOrders: number;
    roi: number;
    count: number;
  }
  
  const buckets: BucketStats[] = [];
  for (let i = 0; i < numBuckets; i++) {
    const bucketMin = minBid + i * bucketWidth;
    const bucketMax = bucketMin + bucketWidth;
    const bucketData = sorted.filter(d => d.bid >= bucketMin && (i === numBuckets - 1 ? d.bid <= bucketMax : d.bid < bucketMax));
    
    if (bucketData.length === 0) continue;
    
    const avgImpressions = bucketData.reduce((s, d) => s + d.impressions, 0) / bucketData.length;
    const avgClicks = bucketData.reduce((s, d) => s + d.clicks, 0) / bucketData.length;
    const avgSpend = bucketData.reduce((s, d) => s + d.spend, 0) / bucketData.length;
    const avgSales = bucketData.reduce((s, d) => s + d.sales, 0) / bucketData.length;
    const avgOrders = bucketData.reduce((s, d) => s + d.orders, 0) / bucketData.length;
    
    buckets.push({
      bidCenter: (bucketMin + bucketMax) / 2,
      avgImpressions,
      avgClicks,
      avgSpend,
      avgSales,
      avgOrders,
      roi: avgSpend > 0 ? avgSales / avgSpend : 0,
      count: bucketData.length,
    });
  }
  
  if (buckets.length < 3) {
    return createInsufficientDataResult(sorted[Math.floor(sorted.length / 2)].bid);
  }
  
  // 计算相邻桶之间的边际指标
  let bidCeiling = maxBid;
  let bidFloor = minBid;
  let lastMarginalRoi = 1.0;
  let maxElasticity = 0;
  
  for (let i = 1; i < buckets.length; i++) {
    const prev = buckets[i - 1];
    const curr = buckets[i];
    const bidDelta = curr.bidCenter - prev.bidCenter;
    
    if (bidDelta < 0.005) continue;
    
    // 边际ROI = (ROI变化) / (出价变化百分比)
    const roiDelta = curr.roi - prev.roi;
    const bidChangePct = bidDelta / prev.bidCenter;
    const marginalRoi = roiDelta / bidChangePct;
    
    // 曝光弹性 = (曝光变化百分比) / (出价变化百分比)
    const impressionChangePct = prev.avgImpressions > 0 
      ? (curr.avgImpressions - prev.avgImpressions) / prev.avgImpressions 
      : 0;
    const impressionElasticity = bidChangePct > 0 ? impressionChangePct / bidChangePct : 0;
    
    // 找bidCeiling：边际ROI首次变为负值或低于阈值
    if (marginalRoi < NASH_CONFIG.MARGINAL_ROI_THRESHOLD && lastMarginalRoi >= NASH_CONFIG.MARGINAL_ROI_THRESHOLD) {
      bidCeiling = curr.bidCenter;
    }
    lastMarginalRoi = marginalRoi;
    
    // 找bidFloor：从低到高，曝光弹性最大的区间的起点
    if (impressionElasticity > maxElasticity) {
      maxElasticity = impressionElasticity;
      // bidFloor是弹性最大区间的起点——低于此出价，曝光会急剧下降
      bidFloor = prev.bidCenter;
    }
  }
  
  // 确保 bidFloor < bidCeiling
  if (bidFloor >= bidCeiling) {
    // 如果计算出的区间无效，使用数据中位数构建合理区间
    const medianBid = buckets[Math.floor(buckets.length / 2)].bidCenter;
    bidFloor = medianBid * (1 - NASH_CONFIG.MIN_RANGE_WIDTH_PERCENT / 2);
    bidCeiling = medianBid * (1 + NASH_CONFIG.MIN_RANGE_WIDTH_PERCENT / 2);
  }
  
  // 确保区间宽度在合理范围内
  const rangeCenter = (bidFloor + bidCeiling) / 2;
  const rangeWidth = (bidCeiling - bidFloor) / rangeCenter;
  
  if (rangeWidth < NASH_CONFIG.MIN_RANGE_WIDTH_PERCENT) {
    const expansion = (NASH_CONFIG.MIN_RANGE_WIDTH_PERCENT - rangeWidth) / 2 * rangeCenter;
    bidFloor = Math.max(0.02, bidFloor - expansion);
    bidCeiling = bidCeiling + expansion;
  } else if (rangeWidth > NASH_CONFIG.MAX_RANGE_WIDTH_PERCENT) {
    const contraction = (rangeWidth - NASH_CONFIG.MAX_RANGE_WIDTH_PERCENT) / 2 * rangeCenter;
    bidFloor = bidFloor + contraction;
    bidCeiling = bidCeiling - contraction;
  }
  
  // 计算最优出价：ROI最高的桶的中心出价
  const bestBucket = buckets.reduce((best, b) => b.roi > best.roi ? b : best, buckets[0]);
  const optimalBid = Math.max(bidFloor, Math.min(bestBucket.bidCenter, bidCeiling));
  
  // 置信度基于数据充分度
  const dataConfidence = Math.min(1.0, data.length / NASH_CONFIG.IDEAL_DATA_POINTS);
  // 桶的分布均匀度也影响置信度
  const bucketCoverage = buckets.length / numBuckets;
  const confidence = dataConfidence * 0.7 + bucketCoverage * 0.3;
  
  return {
    bidFloor: Math.round(bidFloor * 100) / 100,
    bidCeiling: Math.round(bidCeiling * 100) / 100,
    optimalBid: Math.round(optimalBid * 100) / 100,
    confidence: Math.round(confidence * 100) / 100,
    source: 'historical_curve',
    diagnostics: {
      dataPoints: data.length,
      bidRange: [minBid, maxBid],
      impressionElasticity: maxElasticity,
      marginalRoiAtCeiling: lastMarginalRoi,
      suggestedBidUsed: false,
    },
  };
}

/**
 * 基于亚马逊建议竞价构建均衡区间（冷启动/数据不足场景）
 * 
 * 核心逻辑：亚马逊的建议竞价本身就是一个市场均衡信号
 * - suggestedBidRangeStart ≈ 市场均衡下界（低于此出价难以获得曝光）
 * - suggestedBidRangeEnd ≈ 市场均衡上界（高于此出价边际收益递减）
 * - suggestedBid ≈ 市场均衡点
 */
function calculateFromSuggestedBid(
  suggestedBid: number,
  suggestedBidRangeStart?: number,
  suggestedBidRangeEnd?: number,
  currentBid?: number,
): NashEquilibriumRange {
  // 使用亚马逊建议竞价范围作为均衡区间的基础
  let bidFloor: number;
  let bidCeiling: number;
  
  if (suggestedBidRangeStart && suggestedBidRangeEnd && suggestedBidRangeEnd > suggestedBidRangeStart) {
    // 有完整的建议范围：直接使用，但适度扩展
    // 下界取建议下界的80%（留出安全余量）
    bidFloor = suggestedBidRangeStart * 0.80;
    // 上界取建议上界的110%（允许小幅超出探索）
    bidCeiling = suggestedBidRangeEnd * 1.10;
  } else {
    // 只有建议竞价中值：构建对称区间
    bidFloor = suggestedBid * 0.65;
    bidCeiling = suggestedBid * 1.35;
  }
  
  // 如果当前出价远低于建议竞价，说明可能需要更宽的下界
  if (currentBid && currentBid < bidFloor * 0.5) {
    bidFloor = Math.min(bidFloor, currentBid * 1.2);
  }
  
  return {
    bidFloor: Math.round(Math.max(0.02, bidFloor) * 100) / 100,
    bidCeiling: Math.round(bidCeiling * 100) / 100,
    optimalBid: Math.round(suggestedBid * 100) / 100,
    confidence: 0.45, // 仅基于建议竞价，置信度中等偏低
    source: 'suggested_bid_anchor',
    diagnostics: {
      dataPoints: 0,
      bidRange: [bidFloor, bidCeiling],
      impressionElasticity: 0,
      marginalRoiAtCeiling: 0,
      suggestedBidUsed: true,
    },
  };
}

/**
 * 混合历史曲线和建议竞价的均衡区间
 * 
 * 当两种数据源都可用时，进行加权融合：
 * - 历史数据充足时（>15个数据点），历史曲线权重80%
 * - 历史数据中等时（5-15个数据点），历史曲线权重60%
 * - 建议竞价始终作为"锚点"防止区间偏离市场
 */
function hybridWithSuggestedBid(
  curveResult: NashEquilibriumRange,
  suggestedBid: number,
  suggestedBidRangeStart?: number,
  suggestedBidRangeEnd?: number,
): NashEquilibriumRange {
  const suggestedResult = calculateFromSuggestedBid(
    suggestedBid, suggestedBidRangeStart, suggestedBidRangeEnd
  );
  
  // 根据历史数据充分度决定权重
  const curveWeight = curveResult.diagnostics.dataPoints >= 15 ? 0.80 :
                      curveResult.diagnostics.dataPoints >= 10 ? 0.70 : 0.60;
  const suggestedWeight = 1 - curveWeight;
  
  const hybridFloor = curveResult.bidFloor * curveWeight + suggestedResult.bidFloor * suggestedWeight;
  const hybridCeiling = curveResult.bidCeiling * curveWeight + suggestedResult.bidCeiling * suggestedWeight;
  const hybridOptimal = curveResult.optimalBid * curveWeight + suggestedResult.optimalBid * suggestedWeight;
  
  // 置信度取两者的加权平均，但混合本身提供额外的置信度提升
  const hybridConfidence = Math.min(0.95, 
    curveResult.confidence * curveWeight + suggestedResult.confidence * suggestedWeight + 0.10
  );
  
  return {
    bidFloor: Math.round(Math.max(0.02, hybridFloor) * 100) / 100,
    bidCeiling: Math.round(hybridCeiling * 100) / 100,
    optimalBid: Math.round(hybridOptimal * 100) / 100,
    confidence: Math.round(hybridConfidence * 100) / 100,
    source: 'hybrid',
    diagnostics: {
      ...curveResult.diagnostics,
      suggestedBidUsed: true,
    },
  };
}

/**
 * v491: 降级策略 — 使用当前出价作为锚点计算均衡区间
 * 
 * 当无suggestedBid但有currentBid时，基于当前出价构建一个保守的均衡区间：
 * - 下界 = currentBid * 0.60（允许适度降价探索）
 * - 上界 = currentBid * 1.50（允许适度提价探索）
 * - 如果有少量历史数据（1-4个点），可以稍微提高confidence
 * 
 * confidence = 0.30 (基础) + 历史数据点数加成 (最多+0.05)
 * 这确保在应用层的 >= 0.25 阈值下能够参与决策
 */
function calculateFromCurrentBidAnchor(
  currentBid: number,
  historicalDataPoints: number,
): NashEquilibriumRange {
  // 基于当前出价构建不对称区间（降价空间小于提价空间，因为降价风险更大）
  const bidFloor = currentBid * 0.60;
  const bidCeiling = currentBid * 1.50;
  
  // 少量历史数据点可以稍微提高置信度
  const dataBonus = Math.min(0.05, historicalDataPoints * 0.015);
  const confidence = Math.round((0.30 + dataBonus) * 100) / 100;
  
  return {
    bidFloor: Math.round(Math.max(0.02, bidFloor) * 100) / 100,
    bidCeiling: Math.round(bidCeiling * 100) / 100,
    optimalBid: Math.round(currentBid * 100) / 100,
    confidence,
    source: 'current_bid_anchor',
    diagnostics: {
      dataPoints: historicalDataPoints,
      bidRange: [bidFloor, bidCeiling],
      impressionElasticity: 0,
      marginalRoiAtCeiling: 0,
      suggestedBidUsed: false,
    },
  };
}

/**
 * 数据不足时的默认结果
 */
function createInsufficientDataResult(currentBid?: number): NashEquilibriumRange {
  const bid = currentBid || 0.50;
  return {
    bidFloor: Math.round(Math.max(0.02, bid * 0.50) * 100) / 100,
    bidCeiling: Math.round(bid * 2.00 * 100) / 100,
    optimalBid: Math.round(bid * 100) / 100,
    confidence: 0.15,
    source: 'insufficient_data',
    diagnostics: {
      dataPoints: 0,
      bidRange: [0, 0],
      impressionElasticity: 0,
      marginalRoiAtCeiling: 0,
      suggestedBidUsed: false,
    },
  };
}

// ==================== 数据加载 ====================

/**
 * 从数据库加载历史出价-绩效数据
 * 
 * 数据来源：optimization_events 表中的出价调整记录 + daily_performance 表中的绩效数据
 * 通过关联出价调整时间和绩效数据时间，构建"出价水平→绩效结果"的映射
 */
async function loadBidPerformanceHistory(
  accountId: number,
  keywordId?: number | string,
  targetId?: number | string,
): Promise<BidPerformancePoint[]> {
  const db = await getDb();
  if (!db) return [];
  
  const { optimizationEvents, dailyPerformance } = await import('../../drizzle/schema');
  const { and: andOp, eq: eqOp, gte: gteOp, sql: sqlOp, desc: descOp } = await import('drizzle-orm');
  
  const lookbackDate = new Date(Date.now() - NASH_CONFIG.LOOKBACK_DAYS * 24 * 3600000).toISOString();
  
  // 查询历史出价调整事件
  // 注意：optimizationEvents中keywordId/targetId是varchar类型，需要用sql模板进行字符串比较
  const conditions = [
    eqOp(optimizationEvents.accountId, accountId),
    sqlOp`${optimizationEvents.eventCategory} = 'bid_adjustment'`,
    sqlOp`${optimizationEvents.status} = 'success'`,
    gteOp(optimizationEvents.createdAt, lookbackDate),
  ];
  
  if (keywordId) {
    conditions.push(sqlOp`${optimizationEvents.keywordId} = ${String(keywordId)}`);
  } else if (targetId) {
    conditions.push(sqlOp`${optimizationEvents.targetId} = ${String(targetId)}`);
  } else {
    return [];
  }
  
  const events = await db.select({
    newBid: optimizationEvents.newBid,
    createdAt: optimizationEvents.createdAt,
    campaignId: optimizationEvents.campaignId,
  }).from(optimizationEvents)
    .where(andOp(...conditions))
    .orderBy(descOp(optimizationEvents.createdAt))
    .limit(60);
  
  if (events.length === 0) return [];
  
  // v490修复: dailyPerformance表是campaign粒度，没有keywordId/targetId字段
  // 通过optimizationEvents中的campaignId关联到dailyPerformance的campaign级别绩效
  const campaignIds = [...new Set(events.map(e => e.campaignId).filter(Boolean))];
  if (campaignIds.length === 0) return [];
  
  let perfData: Array<{
    date: unknown;
    impressions: unknown;
    clicks: unknown;
    spend: unknown;
    sales: unknown;
    orders: unknown;
  }> = [];
  
  try {
    perfData = await db.select({
      date: dailyPerformance.date,
      impressions: dailyPerformance.impressions,
      clicks: dailyPerformance.clicks,
      spend: dailyPerformance.spend,
      sales: dailyPerformance.sales,
      orders: dailyPerformance.orders,
    }).from(dailyPerformance)
      .where(andOp(
        eqOp(dailyPerformance.accountId, accountId),
        sqlOp`${dailyPerformance.campaignId} IN (${sqlOp.raw(campaignIds.map(id => `'${String(id).replace(/'/g, "''")}'`).join(','))})`,
        gteOp(dailyPerformance.date, lookbackDate.split('T')[0])
      ))
      .orderBy(descOp(dailyPerformance.date))
      .limit(60);
  } catch (err: unknown) {
    log.warn(`[NashEquilibrium] 绩效数据查询失败: ${(err as Error).message}`);
    return [];
  }
  
  if (perfData.length === 0) return [];
  
  // 将出价事件与绩效数据按日期关联
  const perfByDate = new Map<string, typeof perfData[0]>();
  for (const p of perfData) {
    const dateStr = String(p.date).split('T')[0];
    perfByDate.set(dateStr, p);
  }
  
  const result: BidPerformancePoint[] = [];
  for (const evt of events) {
    const evtDate = new Date(evt.createdAt as string);
    // 出价调整后的第2天开始看效果（归因延迟）
    const effectDate = new Date(evtDate.getTime() + 2 * 24 * 3600000);
    const effectDateStr = effectDate.toISOString().split('T')[0];
    
    const perf = perfByDate.get(effectDateStr);
    if (perf) {
      result.push({
        bid: Number(evt.newBid) || 0,
        impressions: Number(perf.impressions) || 0,
        clicks: Number(perf.clicks) || 0,
        spend: Number(perf.spend) || 0,
        sales: Number(perf.sales) || 0,
        orders: Number(perf.orders) || 0,
        date: effectDateStr,
      });
    }
  }
  
  return result;
}

// ==================== 约束应用 ====================

/**
 * 将出价约束到纳什均衡区间内
 * 
 * 这是集成到 calculateNextGenBid 中的核心函数：
 * - 如果出价在区间内：不做调整
 * - 如果出价低于bidFloor：按pullback强度拉回到bidFloor
 * - 如果出价高于bidCeiling：按pullback强度拉回到bidCeiling
 * 
 * @param proposedBid 算法建议的出价
 * @param nashRange 纳什均衡区间
 * @param currentBid 当前出价（用于计算拉回幅度）
 * @returns 约束后的出价和约束信息
 */
export function applyNashConstraint(
  proposedBid: number,
  nashRange: NashEquilibriumRange,
  currentBid: number,
): { constrainedBid: number; wasConstrained: boolean; constraintReason: string } {
  // 置信度太低时不约束（数据不足，区间不可靠）
  if (nashRange.confidence < 0.25) {
    return { constrainedBid: proposedBid, wasConstrained: false, constraintReason: '' };
  }
  
  // 根据置信度调整拉回强度：置信度越高，拉回越强
  const effectivePullback = NASH_CONFIG.PULLBACK_STRENGTH * nashRange.confidence;
  
  if (proposedBid < nashRange.bidFloor) {
    // 出价低于均衡下界：拉回到bidFloor
    const pullbackBid = proposedBid + (nashRange.bidFloor - proposedBid) * effectivePullback;
    return {
      constrainedBid: Math.round(pullbackBid * 100) / 100,
      wasConstrained: true,
      constraintReason: `[v490纳什均衡] 出价$${proposedBid.toFixed(2)}低于均衡下界$${nashRange.bidFloor.toFixed(2)}(来源:${nashRange.source}, 置信度:${(nashRange.confidence * 100).toFixed(0)}%): 拉回至$${pullbackBid.toFixed(2)}`,
    };
  }
  
  if (proposedBid > nashRange.bidCeiling) {
    // 出价高于均衡上界：拉回到bidCeiling
    const pullbackBid = proposedBid - (proposedBid - nashRange.bidCeiling) * effectivePullback;
    return {
      constrainedBid: Math.round(pullbackBid * 100) / 100,
      wasConstrained: true,
      constraintReason: `[v490纳什均衡] 出价$${proposedBid.toFixed(2)}高于均衡上界$${nashRange.bidCeiling.toFixed(2)}(来源:${nashRange.source}, 置信度:${(nashRange.confidence * 100).toFixed(0)}%): 拉回至$${pullbackBid.toFixed(2)}`,
    };
  }
  
  // 出价在均衡区间内，不做调整
  return { constrainedBid: proposedBid, wasConstrained: false, constraintReason: '' };
}

/**
 * 批量预计算纳什均衡区间（用于batchCalculateNextGenBids）
 * 
 * 为了避免在循环中逐个查询数据库，提供批量预加载接口
 */
export async function batchPreloadNashRanges(
  accountId: number,
  targets: Array<{
    id: number | string;
    type: 'keyword' | 'product_target';
    currentBid: number;
    suggestedBid?: number;
    suggestedBidRangeStart?: number;
    suggestedBidRangeEnd?: number;
  }>,
): Promise<Map<string, NashEquilibriumRange>> {
  const rangeMap = new Map<string, NashEquilibriumRange>();
  
  // 并行计算所有目标的纳什均衡区间（限制并发数）
  const CONCURRENCY = 5;
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const batch = targets.slice(i, i + CONCURRENCY);
    const promises = batch.map(async (t) => {
      const key = `${t.type}_${t.id}`;
      try {
        const range = await calculateNashEquilibrium(
          accountId,
          t.type === 'keyword' ? t.id : undefined,
          t.type === 'product_target' ? t.id : undefined,
          t.suggestedBid,
          t.suggestedBidRangeStart,
          t.suggestedBidRangeEnd,
          t.currentBid,
        );
        rangeMap.set(key, range);
      } catch (err: unknown) {
        log.warn(`[NashEquilibrium] 批量预加载失败(${key}): ${(err as Error).message}`);
      }
    });
    await Promise.all(promises);
  }
  
  log.info(`[NashEquilibrium] v490批量预加载完成: ${rangeMap.size}/${targets.length}个目标`);
  return rangeMap;
}
