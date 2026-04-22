/**
 * v717: 多时间窗口出价锚点分析引擎
 * 
 * 核心思想：不再基于"当前出价"做增量调整，而是通过分析5个时间窗口的历史表现，
 * 找到每个投放词/ASIN表现最好的时间窗口，以该窗口的实际CPC作为"锚定出价"（Anchor Bid），
 * 所有调整都围绕这个锚定值进行。
 * 
 * 5个时间窗口：
 * W1: 90天-60天（长期基线）
 * W2: 60天-30天（中期趋势）
 * W3: 30天-14天（近期表现）
 * W4: 14天-7天（短期表现）
 * W5: 7天-3天（最近表现，排除最近2天归因延迟）
 */

import { createModuleLogger } from '../utils/logger';
import { getDb } from '../db';
import { sql, eq, and, between, gte, lte, inArray } from 'drizzle-orm';
import { keywordDailyPerformance, bidAnchorAnalysis, keywords, productTargets } from '../../drizzle/schema';

const log = createModuleLogger('MultiWindowBidAnchor');

// ==================== 类型定义 ====================

export interface WindowMetrics {
  windowName: string;        // W1_90_60, W2_60_30, etc.
  startDate: string;         // YYYY-MM-DD
  endDate: string;           // YYYY-MM-DD
  clicks: number;
  impressions: number;
  spend: number;
  sales: number;
  orders: number;
  cpc: number;               // 平均CPC = spend / clicks
  acos: number;              // ACoS = spend / sales (小数形式)
  roas: number;              // ROAS = sales / spend
  cvr: number;               // 转化率 = orders / clicks
  dataConfidence: 'high' | 'medium' | 'low' | 'insufficient';
  dataDays: number;          // 该窗口内有数据的天数
}

export interface AnchorAnalysisResult {
  entityId: number;
  entityType: 'keyword' | 'product_target';
  accountId: number;
  campaignId: string;
  
  // 锚点信息
  anchorBid: number;
  bestWindow: string;
  bestWindowRoas: number;
  bestWindowAcos: number;
  bestWindowCpc: number;
  bestWindowClicks: number;
  bestWindowOrders: number;
  
  // 当前状态
  currentBid: number;
  bidDriftPercent: number;   // (currentBid - anchorBid) / anchorBid * 100
  
  // 恶化检测
  degradationLevel: 'none' | 'mild' | 'severe' | 'critical';
  
  // 修正建议
  correctionAction: 'maintain' | 'gradual_restore' | 'restore_to_anchor' | 'update_anchor' | 'emergency_restore';
  suggestedBid: number;
  correctionReason: string;
  
  // 完整窗口数据
  windowMetrics: WindowMetrics[];
  dataConfidence: 'high' | 'medium' | 'low' | 'insufficient';
}

// ==================== 配置常量 ====================

/** 时间窗口定义 */
const WINDOW_DEFINITIONS = [
  { name: 'W1_90_60', startDaysAgo: 90, endDaysAgo: 60, weight: 0.10 },
  { name: 'W2_60_30', startDaysAgo: 60, endDaysAgo: 30, weight: 0.15 },
  { name: 'W3_30_14', startDaysAgo: 30, endDaysAgo: 14, weight: 0.25 },
  { name: 'W4_14_7',  startDaysAgo: 14, endDaysAgo: 7,  weight: 0.30 },
  { name: 'W5_7_3',   startDaysAgo: 7,  endDaysAgo: 3,  weight: 0.20 },
] as const;

/** 数据置信度阈值 */
const CONFIDENCE_THRESHOLDS = {
  high:   { minClicks: 20, minOrders: 3 },
  medium: { minClicks: 10, minOrders: 1 },
  low:    { minClicks: 5,  minOrders: 0 },
};

/** 恶化检测阈值 */
const DEGRADATION_THRESHOLDS = {
  mild:     0.85,  // W5 ROAS < bestWindow ROAS * 0.85
  severe:   0.70,  // W5 ROAS < bestWindow ROAS * 0.70
  critical: 0.50,  // W5 ROAS < bestWindow ROAS * 0.50
};

/** 修正幅度限制 — 遵循用户偏好：竞价调整不超过过去7天平均CPC的±10% */
const CORRECTION_LIMITS = {
  maxSingleCorrectionPercent: 0.10,  // 单次修正不超过10%
  maxDriftBeforeEmergency: 0.50,     // 偏移超过50%触发紧急修复
  anchorBidMinFloor: 0.02,           // 锚定出价最低值
};

// ==================== 核心函数 ====================

/**
 * 查询单个投放词/ASIN在5个时间窗口的表现指标
 */
export async function queryWindowMetrics(
  accountId: number,
  entityId: number,
  entityType: 'keyword' | 'product_target',
  referenceDate?: Date
): Promise<WindowMetrics[]> {
  const db = await getDb();
  if (!db) throw new Error('DATABASE_UNAVAILABLE');
  
  const refDate = referenceDate || new Date();
  const results: WindowMetrics[] = [];
  
  for (const windowDef of WINDOW_DEFINITIONS) {
    const startDate = new Date(refDate);
    startDate.setDate(startDate.getDate() - windowDef.startDaysAgo);
    const endDate = new Date(refDate);
    endDate.setDate(endDate.getDate() - windowDef.endDaysAgo);
    
    const startStr = startDate.toISOString().split('T')[0];
    const endStr = endDate.toISOString().split('T')[0];
    
    // 构建查询条件
    const whereConditions = entityType === 'keyword'
      ? and(
          eq(keywordDailyPerformance.accountId, accountId),
          eq(keywordDailyPerformance.keywordId, entityId),
          eq(keywordDailyPerformance.entityType, 'keyword'),
          gte(keywordDailyPerformance.date, startStr),
          lte(keywordDailyPerformance.date, endStr)
        )
      : and(
          eq(keywordDailyPerformance.accountId, accountId),
          eq(keywordDailyPerformance.targetId, entityId),
          eq(keywordDailyPerformance.entityType, 'product_target'),
          gte(keywordDailyPerformance.date, startStr),
          lte(keywordDailyPerformance.date, endStr)
        );
    
    const [aggregated] = await db
      .select({
        totalClicks: sql<number>`COALESCE(SUM(${keywordDailyPerformance.clicks}), 0)`,
        totalImpressions: sql<number>`COALESCE(SUM(${keywordDailyPerformance.impressions}), 0)`,
        totalSpend: sql<number>`COALESCE(SUM(CAST(${keywordDailyPerformance.spend} AS DECIMAL(12,4))), 0)`,
        totalSales: sql<number>`COALESCE(SUM(CAST(${keywordDailyPerformance.sales} AS DECIMAL(12,2))), 0)`,
        totalOrders: sql<number>`COALESCE(SUM(${keywordDailyPerformance.orders}), 0)`,
        dataDays: sql<number>`COUNT(DISTINCT ${keywordDailyPerformance.date})`,
      })
      .from(keywordDailyPerformance)
      .where(whereConditions);
    
    const clicks = Number(aggregated?.totalClicks || 0);
    const impressions = Number(aggregated?.totalImpressions || 0);
    const spend = Number(aggregated?.totalSpend || 0);
    const sales = Number(aggregated?.totalSales || 0);
    const orders = Number(aggregated?.totalOrders || 0);
    const dataDays = Number(aggregated?.dataDays || 0);
    
    // 计算派生指标
    const cpc = clicks > 0 ? spend / clicks : 0;
    const acos = sales > 0 ? spend / sales : (spend > 0 ? 999 : 0);
    const roas = spend > 0 ? sales / spend : 0;
    const cvr = clicks > 0 ? orders / clicks : 0;
    
    // 判断数据置信度
    let dataConfidence: WindowMetrics['dataConfidence'] = 'insufficient';
    if (clicks >= CONFIDENCE_THRESHOLDS.high.minClicks && orders >= CONFIDENCE_THRESHOLDS.high.minOrders) {
      dataConfidence = 'high';
    } else if (clicks >= CONFIDENCE_THRESHOLDS.medium.minClicks && orders >= CONFIDENCE_THRESHOLDS.medium.minOrders) {
      dataConfidence = 'medium';
    } else if (clicks >= CONFIDENCE_THRESHOLDS.low.minClicks) {
      dataConfidence = 'low';
    }
    
    results.push({
      windowName: windowDef.name,
      startDate: startStr,
      endDate: endStr,
      clicks, impressions, spend, sales, orders,
      cpc, acos, roas, cvr,
      dataConfidence,
      dataDays,
    });
  }
  
  return results;
}

/**
 * 从5个窗口中找到ROAS最佳的窗口，返回锚定出价
 */
export function findBestWindowAndAnchor(
  windowMetrics: WindowMetrics[],
  suggestedBid?: number,
  suggestedBidRangeStart?: number,
  suggestedBidRangeEnd?: number
): { bestWindow: WindowMetrics | null; anchorBid: number; confidence: 'high' | 'medium' | 'low' | 'insufficient' } {
  
  // 过滤掉数据不足的窗口
  const validWindows = windowMetrics.filter(w => w.dataConfidence !== 'insufficient' && w.clicks > 0);
  
  if (validWindows.length === 0) {
    // 所有窗口数据不足 — 使用建议竞价作为锚点（冷启动）
    const fallbackBid = suggestedBid || 0;
    log.debug(`[findBestWindow] 所有窗口数据不足，使用建议竞价 $${fallbackBid.toFixed(2)} 作为锚点`);
    return { bestWindow: null, anchorBid: fallbackBid, confidence: 'insufficient' };
  }
  
  // 按ROAS降序排列（ROAS越高越好）
  // 对于有订单的窗口优先，然后按ROAS排序
  const sortedWindows = [...validWindows].sort((a, b) => {
    // 有订单的窗口优先于无订单的
    if (a.orders > 0 && b.orders === 0) return -1;
    if (a.orders === 0 && b.orders > 0) return 1;
    // 都有订单或都没有订单时，按ROAS排序
    return b.roas - a.roas;
  });
  
  const bestWindow = sortedWindows[0];
  let anchorBid = bestWindow.cpc;
  
  // 检查是否有多个窗口ROAS相近（差异<10%），取加权平均
  if (bestWindow.roas > 0) {
    const similarWindows = sortedWindows.filter(w => 
      w.roas >= bestWindow.roas * 0.9 && w.orders > 0
    );
    
    if (similarWindows.length > 1) {
      // 多个窗口表现相近，取点击加权平均CPC
      const totalClicks = similarWindows.reduce((sum, w) => sum + w.clicks, 0);
      anchorBid = similarWindows.reduce((sum, w) => sum + w.cpc * (w.clicks / totalClicks), 0);
      log.debug(`[findBestWindow] ${similarWindows.length}个窗口ROAS相近，取加权平均CPC=$${anchorBid.toFixed(4)}`);
    }
  }
  
  // 安全校验：锚定出价不低于建议竞价范围下限的50%，不高于上限的150%
  if (suggestedBidRangeStart && anchorBid < suggestedBidRangeStart * 0.5) {
    log.debug(`[findBestWindow] 锚点$${anchorBid.toFixed(4)}低于建议竞价下限50%($${(suggestedBidRangeStart * 0.5).toFixed(4)})，上调`);
    anchorBid = suggestedBidRangeStart * 0.5;
  }
  if (suggestedBidRangeEnd && anchorBid > suggestedBidRangeEnd * 1.5) {
    log.debug(`[findBestWindow] 锚点$${anchorBid.toFixed(4)}高于建议竞价上限150%($${(suggestedBidRangeEnd * 1.5).toFixed(4)})，下调`);
    anchorBid = suggestedBidRangeEnd * 1.5;
  }
  
  // 最低出价保护
  anchorBid = Math.max(anchorBid, CORRECTION_LIMITS.anchorBidMinFloor);
  
  // 综合置信度 = 最佳窗口的置信度
  const confidence = bestWindow.dataConfidence;
  
  return { bestWindow, anchorBid, confidence };
}

/**
 * 检测表现恶化程度
 */
export function detectDegradation(
  windowMetrics: WindowMetrics[],
  bestWindow: WindowMetrics
): { level: 'none' | 'mild' | 'severe' | 'critical'; detail: string } {
  
  // 获取最近窗口(W5)的数据
  const recentWindow = windowMetrics.find(w => w.windowName === 'W5_7_3');
  if (!recentWindow || recentWindow.dataConfidence === 'insufficient') {
    return { level: 'none', detail: '最近窗口数据不足，无法判断恶化程度' };
  }
  
  if (bestWindow.roas <= 0) {
    return { level: 'none', detail: '最佳窗口ROAS为0，无法对比' };
  }
  
  const roasRatio = recentWindow.roas / bestWindow.roas;
  
  if (roasRatio < DEGRADATION_THRESHOLDS.critical) {
    return {
      level: 'critical',
      detail: `严重恶化: 最近ROAS(${recentWindow.roas.toFixed(2)})仅为最佳窗口(${bestWindow.windowName})ROAS(${bestWindow.roas.toFixed(2)})的${(roasRatio * 100).toFixed(0)}%`
    };
  }
  if (roasRatio < DEGRADATION_THRESHOLDS.severe) {
    return {
      level: 'severe',
      detail: `明显恶化: 最近ROAS(${recentWindow.roas.toFixed(2)})为最佳窗口ROAS(${bestWindow.roas.toFixed(2)})的${(roasRatio * 100).toFixed(0)}%`
    };
  }
  if (roasRatio < DEGRADATION_THRESHOLDS.mild) {
    return {
      level: 'mild',
      detail: `轻微恶化: 最近ROAS(${recentWindow.roas.toFixed(2)})为最佳窗口ROAS(${bestWindow.roas.toFixed(2)})的${(roasRatio * 100).toFixed(0)}%`
    };
  }
  
  // 检查是否最近表现更好（需要更新锚点）
  if (roasRatio > 1.15) {
    return {
      level: 'none',
      detail: `最近表现优于历史最佳: ROAS提升${((roasRatio - 1) * 100).toFixed(0)}%，建议更新锚点`
    };
  }
  
  return { level: 'none', detail: '表现稳定，无明显恶化' };
}

/**
 * 生成修正决策
 */
export function generateCorrectionDecision(
  anchorBid: number,
  currentBid: number,
  degradation: { level: string; detail: string },
  windowMetrics: WindowMetrics[],
  bestWindow: WindowMetrics | null
): { action: AnchorAnalysisResult['correctionAction']; suggestedBid: number; reason: string } {
  
  const bidDrift = currentBid > 0 ? (currentBid - anchorBid) / anchorBid : 0;
  const recentWindow = windowMetrics.find(w => w.windowName === 'W5_7_3');
  
  // 紧急修复：偏移超过50%
  if (Math.abs(bidDrift) > CORRECTION_LIMITS.maxDriftBeforeEmergency) {
    const direction = bidDrift > 0 ? '过高' : '过低';
    return {
      action: 'emergency_restore',
      suggestedBid: anchorBid,
      reason: `[紧急修复] 当前出价$${currentBid.toFixed(2)}相对锚点$${anchorBid.toFixed(2)}偏移${(bidDrift * 100).toFixed(0)}%（${direction}），直接恢复到锚点`
    };
  }
  
  // 根据恶化程度决定修正策略
  switch (degradation.level) {
    case 'critical':
      // 严重恶化 — 直接恢复到锚点
      return {
        action: 'restore_to_anchor',
        suggestedBid: anchorBid,
        reason: `[锚点恢复] ${degradation.detail}，直接恢复到最佳窗口CPC $${anchorBid.toFixed(2)}`
      };
      
    case 'severe':
      // 明显恶化 — 向锚点靠拢70%
      {
        const correction = (anchorBid - currentBid) * 0.7;
        const newBid = currentBid + correction;
        return {
          action: 'restore_to_anchor',
          suggestedBid: Math.max(newBid, CORRECTION_LIMITS.anchorBidMinFloor),
          reason: `[大幅修正] ${degradation.detail}，向锚点靠拢70%: $${currentBid.toFixed(2)} → $${newBid.toFixed(2)}`
        };
      }
      
    case 'mild':
      // 轻微恶化 — 向锚点靠拢50%
      {
        const correction = (anchorBid - currentBid) * 0.5;
        const newBid = currentBid + correction;
        return {
          action: 'gradual_restore',
          suggestedBid: Math.max(newBid, CORRECTION_LIMITS.anchorBidMinFloor),
          reason: `[温和修正] ${degradation.detail}，向锚点靠拢50%: $${currentBid.toFixed(2)} → $${newBid.toFixed(2)}`
        };
      }
      
    default:
      // 无恶化
      // 检查最近表现是否更好，需要更新锚点
      if (recentWindow && bestWindow && recentWindow.roas > bestWindow.roas * 1.15 && recentWindow.dataConfidence !== 'insufficient') {
        return {
          action: 'update_anchor',
          suggestedBid: currentBid,  // 维持当前出价
          reason: `[更新锚点] 最近表现优于历史最佳(ROAS ${recentWindow.roas.toFixed(2)} vs ${bestWindow.roas.toFixed(2)})，更新锚点为当前CPC`
        };
      }
      
      // 检查出价是否偏离锚点超过10%
      if (Math.abs(bidDrift) > 0.10) {
        const direction = bidDrift > 0 ? '偏高' : '偏低';
        const correction = (anchorBid - currentBid) * 0.3;
        const newBid = currentBid + correction;
        return {
          action: 'gradual_restore',
          suggestedBid: Math.max(newBid, CORRECTION_LIMITS.anchorBidMinFloor),
          reason: `[微调修正] 当前出价${direction}${(Math.abs(bidDrift) * 100).toFixed(0)}%，温和靠拢锚点: $${currentBid.toFixed(2)} → $${newBid.toFixed(2)}`
        };
      }
      
      return {
        action: 'maintain',
        suggestedBid: currentBid,
        reason: `[维持] 出价在锚点±10%范围内，表现稳定，无需修正`
      };
  }
}

/**
 * 对单个投放词/ASIN执行完整的多时间窗口锚点分析
 */
export async function analyzeEntityBidAnchor(
  accountId: number,
  entityId: number,
  entityType: 'keyword' | 'product_target',
  currentBid: number,
  campaignId: string,
  suggestedBid?: number,
  suggestedBidRangeStart?: number,
  suggestedBidRangeEnd?: number
): Promise<AnchorAnalysisResult> {
  
  // Step 1: 查询5个时间窗口的指标
  const windowMetrics = await queryWindowMetrics(accountId, entityId, entityType);
  
  // Step 2: 找到最佳窗口和锚定出价
  const { bestWindow, anchorBid, confidence } = findBestWindowAndAnchor(
    windowMetrics, suggestedBid, suggestedBidRangeStart, suggestedBidRangeEnd
  );
  
  // Step 3: 检测恶化程度
  const degradation = bestWindow 
    ? detectDegradation(windowMetrics, bestWindow)
    : { level: 'none' as const, detail: '数据不足，无法判断' };
  
  // Step 4: 生成修正决策
  const correction = generateCorrectionDecision(
    anchorBid, currentBid, degradation, windowMetrics, bestWindow
  );
  
  // 计算出价偏移
  const bidDriftPercent = anchorBid > 0 ? ((currentBid - anchorBid) / anchorBid) * 100 : 0;
  
  return {
    entityId,
    entityType,
    accountId,
    campaignId,
    anchorBid,
    bestWindow: bestWindow?.windowName || 'none',
    bestWindowRoas: bestWindow?.roas || 0,
    bestWindowAcos: bestWindow?.acos || 0,
    bestWindowCpc: bestWindow?.cpc || 0,
    bestWindowClicks: bestWindow?.clicks || 0,
    bestWindowOrders: bestWindow?.orders || 0,
    currentBid,
    bidDriftPercent,
    degradationLevel: degradation.level as AnchorAnalysisResult['degradationLevel'],
    correctionAction: correction.action,
    suggestedBid: correction.suggestedBid,
    correctionReason: correction.reason,
    windowMetrics,
    dataConfidence: confidence,
  };
}

/**
 * 批量分析一个账户下所有投放词/ASIN的出价锚点
 * 用于紧急修复场景
 */
export async function batchAnalyzeAccountBidAnchors(
  accountId: number,
  options?: {
    onlyDegraded?: boolean;     // 只返回恶化的
    minDegradation?: 'mild' | 'severe' | 'critical';
    campaignIds?: string[];      // 限定campaign范围
  }
): Promise<AnchorAnalysisResult[]> {
  const db = await getDb();
  if (!db) throw new Error('DATABASE_UNAVAILABLE');
  
  log.info(`[batchAnalyze] 开始批量分析账户 ${accountId} 的出价锚点...`);
  
  // 获取所有enabled的keywords
  const enabledKeywords = await db
    .select({
      id: keywords.id,
      bid: keywords.bid,
      campaignId: keywords.campaignId,
      keywordText: keywords.keywordText,
      suggestedBid: keywords.suggestedBid,
      suggestedBidLow: keywords.suggestedBidLow,
      suggestedBidHigh: keywords.suggestedBidHigh,
    })
    .from(keywords)
    .where(and(
      eq(keywords.accountId, accountId),
      eq(keywords.keywordStatus, 'enabled')
    ));
  
  // 获取所有enabled的product_targets
  const enabledTargets = await db
    .select({
      id: productTargets.id,
      bid: productTargets.bid,
      campaignId: productTargets.campaignId,
      targetValue: productTargets.targetValue,
      suggestedBid: productTargets.suggestedBid,
      suggestedBidLow: productTargets.suggestedBidLow,
      suggestedBidHigh: productTargets.suggestedBidHigh,
    })
    .from(productTargets)
    .where(and(
      eq(productTargets.accountId, accountId),
      eq(productTargets.targetStatus, 'enabled')
    ));
  
  log.info(`[batchAnalyze] 账户 ${accountId}: ${enabledKeywords.length} 个关键词, ${enabledTargets.length} 个商品定向`);
  
  const results: AnchorAnalysisResult[] = [];
  let analyzed = 0;
  let degraded = 0;
  
  // 分析keywords
  for (const kw of enabledKeywords) {
    try {
      const currentBid = parseFloat(kw.bid || '0');
      if (currentBid <= 0) continue;
      
      if (options?.campaignIds && !options.campaignIds.includes(kw.campaignId)) continue;
      
      const result = await analyzeEntityBidAnchor(
        accountId, kw.id, 'keyword', currentBid, kw.campaignId,
        kw.suggestedBid ? parseFloat(String(kw.suggestedBid)) : undefined,
        kw.suggestedBidLow ? parseFloat(String(kw.suggestedBidLow)) : undefined,
        kw.suggestedBidHigh ? parseFloat(String(kw.suggestedBidHigh)) : undefined
      );
      
      analyzed++;
      
      if (result.degradationLevel !== 'none' || result.correctionAction !== 'maintain') {
        degraded++;
      }
      
      // 根据过滤条件决定是否加入结果
      if (options?.onlyDegraded) {
        const degradationOrder = ['none', 'mild', 'severe', 'critical'];
        const minLevel = options.minDegradation || 'mild';
        if (degradationOrder.indexOf(result.degradationLevel) >= degradationOrder.indexOf(minLevel)) {
          results.push(result);
        }
      } else {
        // 只返回需要修正的（排除maintain）
        if (result.correctionAction !== 'maintain') {
          results.push(result);
        }
      }
      
      if (analyzed % 100 === 0) {
        log.info(`[batchAnalyze] 进度: ${analyzed}/${enabledKeywords.length + enabledTargets.length}, 需修正: ${degraded}`);
      }
    } catch (err: unknown) {
      log.warn(`[batchAnalyze] 分析keyword ${kw.id} 失败: ${(err as Error).message}`);
    }
  }
  
  // 分析product_targets
  for (const pt of enabledTargets) {
    try {
      const currentBid = parseFloat(pt.bid || '0');
      if (currentBid <= 0) continue;
      
      if (options?.campaignIds && !options.campaignIds.includes(pt.campaignId)) continue;
      
      const result = await analyzeEntityBidAnchor(
        accountId, pt.id, 'product_target', currentBid, pt.campaignId,
        pt.suggestedBid ? parseFloat(String(pt.suggestedBid)) : undefined,
        pt.suggestedBidLow ? parseFloat(String(pt.suggestedBidLow)) : undefined,
        pt.suggestedBidHigh ? parseFloat(String(pt.suggestedBidHigh)) : undefined
      );
      
      analyzed++;
      
      if (result.degradationLevel !== 'none' || result.correctionAction !== 'maintain') {
        degraded++;
      }
      
      if (options?.onlyDegraded) {
        const degradationOrder = ['none', 'mild', 'severe', 'critical'];
        const minLevel = options.minDegradation || 'mild';
        if (degradationOrder.indexOf(result.degradationLevel) >= degradationOrder.indexOf(minLevel)) {
          results.push(result);
        }
      } else {
        if (result.correctionAction !== 'maintain') {
          results.push(result);
        }
      }
    } catch (err: unknown) {
      log.warn(`[batchAnalyze] 分析product_target ${pt.id} 失败: ${(err as Error).message}`);
    }
  }
  
  log.info(`[batchAnalyze] 账户 ${accountId} 分析完成: 总计${analyzed}个实体, ${degraded}个需修正, ${results.length}个返回`);
  
  return results;
}

/**
 * 将分析结果保存到bid_anchor_analysis表
 */
export async function saveAnchorAnalysis(result: AnchorAnalysisResult): Promise<void> {
  const db = await getDb();
  if (!db) return;
  
  const insertData = {
    accountId: result.accountId,
    campaignId: result.campaignId,
    keywordId: result.entityType === 'keyword' ? result.entityId : null,
    targetId: result.entityType === 'product_target' ? result.entityId : null,
    entityType: result.entityType,
    bestWindow: result.bestWindow as any,
    bestWindowRoas: String(result.bestWindowRoas),
    bestWindowAcos: String(result.bestWindowAcos),
    bestWindowCpc: String(result.bestWindowCpc),
    bestWindowClicks: result.bestWindowClicks,
    bestWindowOrders: result.bestWindowOrders,
    anchorBid: String(result.anchorBid),
    currentBid: String(result.currentBid),
    bidDriftPercent: String(result.bidDriftPercent),
    degradationLevel: result.degradationLevel,
    degradationDetail: null,
    correctionAction: result.correctionAction,
    suggestedBid: String(result.suggestedBid),
    correctionReason: result.correctionReason,
    windowMetrics: JSON.stringify(result.windowMetrics),
    dataConfidence: result.dataConfidence,
    totalDataPoints: result.windowMetrics.reduce((sum, w) => sum + w.dataDays, 0),
    correctionStatus: 'pending' as const,
    analyzedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
  };
  
  // UPSERT: 如果已存在则更新
  await db.insert(bidAnchorAnalysis)
    .values(insertData)
    .onDuplicateKeyUpdate({
      set: {
        ...insertData,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      }
    });
}

/**
 * NextGen编排器集成入口 — 在calculateNextGenBid中作为第0层调用
 * 返回null表示不需要锚点修正，由后续层处理
 */
export async function getAnchorBidCorrection(
  accountId: number,
  target: {
    id: number;
    type: 'keyword' | 'product_target';
    currentBid: number;
    suggestedBid?: number;
    suggestedBidRangeStart?: number;
    suggestedBidRangeEnd?: number;
    campaignId?: string;
  }
): Promise<{ bid: number; reason: string; confidence: number } | null> {
  try {
    const db = await getDb();
    if (!db) return null;
    
    // 检查keyword_daily_performance表是否有足够数据（至少14天）
    const entityCondition = target.type === 'keyword'
      ? eq(keywordDailyPerformance.keywordId, target.id)
      : eq(keywordDailyPerformance.targetId, target.id);
    
    const [dataCheck] = await db
      .select({ days: sql<number>`COUNT(DISTINCT ${keywordDailyPerformance.date})` })
      .from(keywordDailyPerformance)
      .where(and(
        eq(keywordDailyPerformance.accountId, accountId),
        entityCondition
      ));
    
    if (!dataCheck || dataCheck.days < 14) {
      // 数据不足14天，降级到现有逻辑
      return null;
    }
    
    // 执行锚点分析
    const result = await analyzeEntityBidAnchor(
      accountId, target.id, target.type, target.currentBid,
      target.campaignId || '',
      target.suggestedBid, target.suggestedBidRangeStart, target.suggestedBidRangeEnd
    );
    
    // 只有需要修正时才返回
    if (result.correctionAction === 'maintain') {
      return null;
    }
    
    // 将置信度映射为数值
    const confidenceMap = { high: 0.9, medium: 0.7, low: 0.5, insufficient: 0.3 };
    
    return {
      bid: result.suggestedBid,
      reason: `[v717多时间窗口修正] ${result.correctionReason}`,
      confidence: confidenceMap[result.dataConfidence] || 0.5,
    };
  } catch (err: unknown) {
    log.warn(`[getAnchorBidCorrection] 锚点分析异常(entity=${target.id}): ${(err as Error).message}`);
    return null;
  }
}
