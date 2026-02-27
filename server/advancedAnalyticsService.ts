import { createModuleLogger } from './utils/logger';
const log = createModuleLogger('AdvancedAnalyticsService');
/**
 * 高级分析服务 (Advanced Analytics Service)
 * 
 * 基于统一事件模型 (optimization_events) 构建的下一代分析引擎，提供：
 * 1. 优化效果归因引擎 - 将优化操作与实际广告效果关联
 * 2. 智能趋势分析与异常检测 - 自动发现效果波动并追溯原因
 * 3. 策略ROI对比引擎 - 评估不同策略模板的投资回报率
 */

import { getDb } from './db';
import { optimizationEvents, dailyPerformance } from '../drizzle/schema';
import { eq, and, gte, lte, desc, asc, sql, isNotNull, ne } from 'drizzle-orm';
import type { OptimizationEvent } from '../drizzle/schema';

// ==================== 类型定义 ====================

/** 归因分析结果 */
export interface AttributionResult {
  eventId: number;
  eventCategory: string;
  actionType: string;
  campaignId: number | null;
  campaignName: string | null;
  keywordText: string | null;
  performanceGroupName: string | null;
  previousBid: string | null;
  newBid: string | null;
  bidChangePercent: string | null;
  createdAt: string;
  changeReason: string | null;
  // 基线数据（操作前7天）
  baselineSpend: number;
  baselineSales: number;
  baselineImpressions: number;
  baselineClicks: number;
  baselineOrders: number;
  baselineAcos: number;
  baselineRoas: number;
  // 效果窗口数据（操作后7天）
  postSpend: number;
  postSales: number;
  postImpressions: number;
  postClicks: number;
  postOrders: number;
  postAcos: number;
  postRoas: number;
  // 增量效果
  deltaSpend: number;
  deltaSales: number;
  deltaImpressions: number;
  deltaClicks: number;
  deltaOrders: number;
  deltaAcos: number;
  deltaRoas: number;
  // 效果评级
  effectRating: 'excellent' | 'good' | 'neutral' | 'poor' | 'harmful';
  effectScore: number; // -100 到 100
}

/** 趋势分析结果 */
export interface TrendAnalysis {
  metric: string;
  metricLabel: string;
  direction: 'up' | 'down' | 'stable';
  changePercent: number;
  trendStrength: 'strong' | 'moderate' | 'weak';
  dataPoints: { date: string; value: number }[];
  movingAverage: { date: string; value: number }[];
}

/** 异常检测结果 */
export interface AnomalyDetection {
  id: string;
  date: string;
  metric: string;
  metricLabel: string;
  actualValue: number;
  expectedValue: number;
  deviationPercent: number;
  severity: 'critical' | 'warning' | 'info';
  direction: 'spike' | 'drop';
  // 可能的原因（来自optimization_events）
  possibleCauses: {
    eventId: number;
    actionType: string;
    eventCategory: string;
    description: string;
    createdAt: string;
    confidence: number; // 0-100
  }[];
}

/** 策略ROI结果 */
export interface StrategyROI {
  strategyId: number | null;
  strategyName: string;
  // 操作统计
  totalEvents: number;
  successEvents: number;
  failedEvents: number;
  successRate: number;
  // 出价调整统计
  avgBidChange: number;
  totalBidIncreases: number;
  totalBidDecreases: number;
  // 效果统计（基于已追踪的事件）
  trackedEvents: number;
  totalEstimatedProfit: number;
  totalActualProfit7D: number;
  totalActualProfit14D: number;
  totalActualProfit30D: number;
  // ROI指标
  roi7D: number | null;
  roi14D: number | null;
  roi30D: number | null;
  profitAccuracy: number | null;
  // 时间维度
  firstEventDate: string | null;
  lastEventDate: string | null;
  avgEventsPerDay: number;
}

/** 高级分析仪表盘汇总 */
export interface AdvancedAnalyticsSummary {
  // 总览
  totalOptimizationEvents: number;
  totalBidAdjustments: number;
  overallSuccessRate: number;
  avgEffectScore: number;
  // 效果归因汇总
  totalAttributedSalesIncrease: number;
  totalAttributedSpendIncrease: number;
  netAttributedProfit: number;
  positiveEffectRate: number; // 产生正面效果的操作占比
  // 异常检测汇总
  activeAnomalies: number;
  criticalAnomalies: number;
  // 策略ROI汇总
  bestStrategyName: string | null;
  bestStrategyROI: number | null;
  worstStrategyName: string | null;
  worstStrategyROI: number | null;
}


// ==================== 1. 优化效果归因引擎 ====================

/**
 * 获取优化事件的效果归因分析
 * 将每个出价调整事件与其前后的广告效果数据进行关联对比
 */
export async function getAttributionAnalysis(params: {
  accountId?: number;
  performanceGroupId?: number;
  days?: number;
  limit?: number;
  offset?: number;
  eventCategory?: string;
}): Promise<{ results: AttributionResult[]; total: number }> {
  const db = await getDb();
  if (!db) return { results: [], total: 0 };
  
  const days = params.days || 30;
  const limit = params.limit || 20;
  const offset = params.offset || 0;
  
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  const cutoffStr = cutoffDate.toISOString().slice(0, 19).replace('T', ' ');
  
  // 构建查询条件
  const conditions = [
    gte(optimizationEvents.createdAt, cutoffStr),
    ne(optimizationEvents.status, 'rolled_back'),
  ];
  
  if (params.accountId) conditions.push(eq(optimizationEvents.accountId, params.accountId));
  if (params.performanceGroupId) conditions.push(eq(optimizationEvents.performanceGroupId, params.performanceGroupId));
  if (params.eventCategory) {
    conditions.push(sql`${optimizationEvents.eventCategory} = ${params.eventCategory}`);
  } else {
    // 默认只分析出价调整事件（有明确的前后对比）
    conditions.push(sql`${optimizationEvents.eventCategory} = 'bid_adjustment'`);
  }
  
  const whereClause = and(...conditions);
  
  // 获取事件总数
  const [countResult] = await db.select({ count: sql<number>`count(*)` })
    .from(optimizationEvents).where(whereClause);
  const total = countResult?.count || 0;
  
  // 获取事件列表
  const events = await db.select()
    .from(optimizationEvents)
    .where(whereClause)
    .orderBy(desc(optimizationEvents.createdAt))
    .limit(limit)
    .offset(offset);
  
  // 对每个事件进行归因分析
  const results: AttributionResult[] = [];
  
  for (const event of events) {
    const attribution = await computeEventAttribution(db, event);
    if (attribution) {
      results.push(attribution);
    }
  }
  
  return { results, total };
}

/**
 * 计算单个事件的归因效果
 */
async function computeEventAttribution(db: any, event: OptimizationEvent): Promise<AttributionResult | null> {
  const eventDate = new Date(event.createdAt);
  
  // 基线窗口：事件前7天
  const baselineStart = new Date(eventDate);
  baselineStart.setDate(baselineStart.getDate() - 7);
  const baselineEnd = new Date(eventDate);
  baselineEnd.setDate(baselineEnd.getDate() - 1);
  
  // 效果窗口：事件后1-7天
  const postStart = new Date(eventDate);
  postStart.setDate(postStart.getDate() + 1);
  const postEnd = new Date(eventDate);
  postEnd.setDate(postEnd.getDate() + 7);
  
  // 查询基线和效果窗口的广告效果数据
  const [baselineData, postData] = await Promise.all([
    getPerformanceWindow(db, event, baselineStart, baselineEnd),
    getPerformanceWindow(db, event, postStart, postEnd),
  ]);
  
  // 计算增量
  const deltaSpend = postData.spend - baselineData.spend;
  const deltaSales = postData.sales - baselineData.sales;
  const deltaImpressions = postData.impressions - baselineData.impressions;
  const deltaClicks = postData.clicks - baselineData.clicks;
  const deltaOrders = postData.orders - baselineData.orders;
  const deltaAcos = postData.acos - baselineData.acos;
  const deltaRoas = postData.roas - baselineData.roas;
  
  // 计算效果评分（-100到100）
  const effectScore = calculateEffectScore(baselineData, postData, event);
  const effectRating = getEffectRating(effectScore);
  
  return {
    eventId: event.id,
    eventCategory: event.eventCategory,
    actionType: event.actionType,
    campaignId: event.campaignId,
    campaignName: event.campaignName,
    keywordText: event.keywordText,
    performanceGroupName: event.performanceGroupName,
    previousBid: event.previousBid,
    newBid: event.newBid,
    bidChangePercent: event.bidChangePercent,
    createdAt: event.createdAt,
    changeReason: event.changeReason,
    baselineSpend: baselineData.spend,
    baselineSales: baselineData.sales,
    baselineImpressions: baselineData.impressions,
    baselineClicks: baselineData.clicks,
    baselineOrders: baselineData.orders,
    baselineAcos: baselineData.acos,
    baselineRoas: baselineData.roas,
    postSpend: postData.spend,
    postSales: postData.sales,
    postImpressions: postData.impressions,
    postClicks: postData.clicks,
    postOrders: postData.orders,
    postAcos: postData.acos,
    postRoas: postData.roas,
    deltaSpend,
    deltaSales,
    deltaImpressions,
    deltaClicks,
    deltaOrders,
    deltaAcos,
    deltaRoas,
    effectRating,
    effectScore,
  };
}

/**
 * 获取指定时间窗口内的广告效果数据
 */
async function getPerformanceWindow(
  db: any,
  event: OptimizationEvent,
  startDate: Date,
  endDate: Date
): Promise<{
  spend: number; sales: number; impressions: number;
  clicks: number; orders: number; acos: number; roas: number;
}> {
  const startStr = startDate.toISOString().slice(0, 10);
  const endStr = endDate.toISOString().slice(0, 10);
  
  // 按广告活动级别查询（如果有campaignId）
  const conditions = [
    eq(dailyPerformance.accountId, event.accountId),
    sql`DATE(${dailyPerformance.date}) >= ${startStr}`,
    sql`DATE(${dailyPerformance.date}) <= ${endStr}`,
  ];
  
  if (event.campaignId) {
    conditions.push(eq(dailyPerformance.campaignId, String(event.campaignId)));
  } else if (event.performanceGroupId) {
    conditions.push(eq(dailyPerformance.performanceGroupId, event.performanceGroupId));
  }
  
  const [result] = await db.select({
    totalSpend: sql<string>`COALESCE(SUM(${dailyPerformance.spend}), 0)`,
    totalSales: sql<string>`COALESCE(SUM(${dailyPerformance.sales}), 0)`,
    totalImpressions: sql<number>`COALESCE(SUM(${dailyPerformance.impressions}), 0)`,
    totalClicks: sql<number>`COALESCE(SUM(${dailyPerformance.clicks}), 0)`,
    totalOrders: sql<number>`COALESCE(SUM(${dailyPerformance.orders}), 0)`,
  }).from(dailyPerformance).where(and(...conditions));
  
  const spend = parseFloat(result?.totalSpend || '0');
  const sales = parseFloat(result?.totalSales || '0');
  const impressions = result?.totalImpressions || 0;
  const clicks = result?.totalClicks || 0;
  const orders = result?.totalOrders || 0;
  const acos = sales > 0 ? (spend / sales) * 100 : 0;
  const roas = spend > 0 ? sales / spend : 0;
  
  return { spend, sales, impressions, clicks, orders, acos: Math.round(acos * 100) / 100, roas: Math.round(roas * 100) / 100 };
}

/**
 * 计算效果评分 (-100 到 100)
 * 综合考虑 ROAS变化、ACoS变化、销量变化
 */
function calculateEffectScore(
  baseline: { spend: number; sales: number; roas: number; acos: number; orders: number },
  post: { spend: number; sales: number; roas: number; acos: number; orders: number },
  event: OptimizationEvent
): number {
  // 如果基线数据为零，无法计算有意义的效果
  if (baseline.spend === 0 && baseline.sales === 0) return 0;
  
  let score = 0;
  
  // ROAS 提升贡献 (权重40%)
  if (baseline.roas > 0) {
    const roasChange = ((post.roas - baseline.roas) / baseline.roas) * 100;
    score += Math.max(-40, Math.min(40, roasChange * 0.4));
  }
  
  // ACoS 降低贡献 (权重30%，ACoS降低是正面的)
  if (baseline.acos > 0) {
    const acosChange = ((baseline.acos - post.acos) / baseline.acos) * 100;
    score += Math.max(-30, Math.min(30, acosChange * 0.3));
  }
  
  // 销量增长贡献 (权重30%)
  if (baseline.orders > 0) {
    const ordersChange = ((post.orders - baseline.orders) / baseline.orders) * 100;
    score += Math.max(-30, Math.min(30, ordersChange * 0.3));
  } else if (post.orders > 0) {
    score += 15; // 从0到有订单，给正面分数
  }
  
  return Math.round(Math.max(-100, Math.min(100, score)));
}

/**
 * 根据效果评分获取效果评级
 */
function getEffectRating(score: number): 'excellent' | 'good' | 'neutral' | 'poor' | 'harmful' {
  if (score >= 30) return 'excellent';
  if (score >= 10) return 'good';
  if (score >= -10) return 'neutral';
  if (score >= -30) return 'poor';
  return 'harmful';
}


// ==================== 2. 智能趋势分析与异常检测 ====================

/**
 * 获取关键指标的趋势分析
 */
export async function getTrendAnalysis(params: {
  accountId: number;
  performanceGroupId?: number;
  days?: number;
  metrics?: string[];
}): Promise<TrendAnalysis[]> {
  const db = await getDb();
  if (!db) return [];
  
  const days = params.days || 30;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const startStr = startDate.toISOString().slice(0, 10);
  
  // 查询每日汇总数据
  const conditions = [
    eq(dailyPerformance.accountId, params.accountId),
    sql`DATE(${dailyPerformance.date}) >= ${startStr}`,
  ];
  if (params.performanceGroupId) {
    conditions.push(eq(dailyPerformance.performanceGroupId, params.performanceGroupId));
  }
  
  const dailyData = await db.select({
    date: sql<string>`DATE(${dailyPerformance.date})`,
    totalSpend: sql<string>`SUM(${dailyPerformance.spend})`,
    totalSales: sql<string>`SUM(${dailyPerformance.sales})`,
    totalImpressions: sql<number>`SUM(${dailyPerformance.impressions})`,
    totalClicks: sql<number>`SUM(${dailyPerformance.clicks})`,
    totalOrders: sql<number>`SUM(${dailyPerformance.orders})`,
  }).from(dailyPerformance)
    .where(and(...conditions))
    .groupBy(sql`DATE(${dailyPerformance.date})`)
    .orderBy(sql`DATE(${dailyPerformance.date})`);
  
  if (dailyData.length < 3) return [];
  
  // 计算每日的派生指标
  const enrichedData = dailyData.map(d => {
    const spend = parseFloat(d.totalSpend || '0');
    const sales = parseFloat(d.totalSales || '0');
    const impressions = d.totalImpressions || 0;
    const clicks = d.totalClicks || 0;
    const orders = d.totalOrders || 0;
    
    return {
      date: d.date,
      spend,
      sales,
      impressions,
      clicks,
      orders,
      acos: sales > 0 ? (spend / sales) * 100 : 0,
      roas: spend > 0 ? sales / spend : 0,
      ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
      cvr: clicks > 0 ? (orders / clicks) * 100 : 0,
      cpc: clicks > 0 ? spend / clicks : 0,
    };
  });
  
  // 默认分析的指标
  const metricsToAnalyze = params.metrics || ['acos', 'roas', 'spend', 'sales', 'ctr'];
  const metricLabels: Record<string, string> = {
    acos: 'ACoS',
    roas: 'ROAS',
    spend: '花费',
    sales: '销售额',
    impressions: '曝光量',
    clicks: '点击量',
    orders: '订单量',
    ctr: '点击率',
    cvr: '转化率',
    cpc: '单次点击成本',
  };
  
  const results: TrendAnalysis[] = [];
  
  for (const metric of metricsToAnalyze) {
    const dataPoints = enrichedData.map(d => ({
      date: d.date,
      value: Math.round((d as any)[metric] * 100) / 100,
    }));
    
    // 计算移动平均（7日窗口）
    const movingAverage = calculateMovingAverage(dataPoints, 7);
    
    // 计算趋势方向和强度
    const { direction, changePercent, strength } = analyzeTrend(dataPoints);
    
    results.push({
      metric,
      metricLabel: metricLabels[metric] || metric,
      direction,
      changePercent: Math.round(changePercent * 100) / 100,
      trendStrength: strength,
      dataPoints,
      movingAverage,
    });
  }
  
  return results;
}

/**
 * 计算移动平均
 */
function calculateMovingAverage(
  data: { date: string; value: number }[],
  window: number
): { date: string; value: number }[] {
  if (data.length < window) return [];
  
  const result: { date: string; value: number }[] = [];
  for (let i = window - 1; i < data.length; i++) {
    const windowData = data.slice(i - window + 1, i + 1);
    const avg = windowData.reduce((sum, d) => sum + d.value, 0) / window;
    result.push({ date: data[i].date, value: Math.round(avg * 100) / 100 });
  }
  return result;
}

/**
 * 分析趋势方向和强度
 */
function analyzeTrend(data: { date: string; value: number }[]): {
  direction: 'up' | 'down' | 'stable';
  changePercent: number;
  strength: 'strong' | 'moderate' | 'weak';
} {
  if (data.length < 2) return { direction: 'stable', changePercent: 0, strength: 'weak' };
  
  // 使用简单线性回归计算趋势
  const n = data.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += data[i].value;
    sumXY += i * data[i].value;
    sumX2 += i * i;
  }
  
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const avgValue = sumY / n;
  
  // 计算变化百分比（基于斜率和平均值）
  const changePercent = avgValue !== 0 ? (slope * n / avgValue) * 100 : 0;
  
  // 确定方向
  let direction: 'up' | 'down' | 'stable';
  if (Math.abs(changePercent) < 3) {
    direction = 'stable';
  } else {
    direction = changePercent > 0 ? 'up' : 'down';
  }
  
  // 确定强度
  let strength: 'strong' | 'moderate' | 'weak';
  if (Math.abs(changePercent) >= 20) {
    strength = 'strong';
  } else if (Math.abs(changePercent) >= 8) {
    strength = 'moderate';
  } else {
    strength = 'weak';
  }
  
  return { direction, changePercent, strength };
}

/**
 * 检测异常数据点
 */
export async function detectAnomalies(params: {
  accountId: number;
  performanceGroupId?: number;
  days?: number;
  sensitivity?: number; // 1-3, 1=高灵敏度, 3=低灵敏度
}): Promise<AnomalyDetection[]> {
  const db = await getDb();
  if (!db) return [];
  
  const days = params.days || 30;
  const sensitivity = params.sensitivity || 2;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const startStr = startDate.toISOString().slice(0, 10);
  
  // 查询每日汇总数据
  const conditions = [
    eq(dailyPerformance.accountId, params.accountId),
    sql`DATE(${dailyPerformance.date}) >= ${startStr}`,
  ];
  if (params.performanceGroupId) {
    conditions.push(eq(dailyPerformance.performanceGroupId, params.performanceGroupId));
  }
  
  const dailyData = await db.select({
    date: sql<string>`DATE(${dailyPerformance.date})`,
    totalSpend: sql<string>`SUM(${dailyPerformance.spend})`,
    totalSales: sql<string>`SUM(${dailyPerformance.sales})`,
    totalImpressions: sql<number>`SUM(${dailyPerformance.impressions})`,
    totalClicks: sql<number>`SUM(${dailyPerformance.clicks})`,
    totalOrders: sql<number>`SUM(${dailyPerformance.orders})`,
  }).from(dailyPerformance)
    .where(and(...conditions))
    .groupBy(sql`DATE(${dailyPerformance.date})`)
    .orderBy(sql`DATE(${dailyPerformance.date})`);
  
  if (dailyData.length < 7) return [];
  
  // 计算派生指标
  const enrichedData = dailyData.map(d => {
    const spend = parseFloat(d.totalSpend || '0');
    const sales = parseFloat(d.totalSales || '0');
    const impressions = d.totalImpressions || 0;
    const clicks = d.totalClicks || 0;
    const orders = d.totalOrders || 0;
    return {
      date: d.date,
      spend, sales, impressions, clicks, orders,
      acos: sales > 0 ? (spend / sales) * 100 : 0,
      roas: spend > 0 ? sales / spend : 0,
    };
  });
  
  const anomalies: AnomalyDetection[] = [];
  const metricsToCheck = ['acos', 'spend', 'sales', 'roas'];
  const metricLabels: Record<string, string> = {
    acos: 'ACoS', spend: '花费', sales: '销售额', roas: 'ROAS',
  };
  
  for (const metric of metricsToCheck) {
    const values = enrichedData.map(d => (d as any)[metric] as number);
    
    // 计算均值和标准差
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);
    
    if (stdDev === 0) continue;
    
    // 使用Z-score检测异常
    const threshold = sensitivity; // 1σ, 2σ, 或 3σ
    
    for (let i = 0; i < enrichedData.length; i++) {
      const value = (enrichedData[i] as any)[metric] as number;
      const zScore = Math.abs((value - mean) / stdDev);
      
      if (zScore >= threshold) {
        const deviationPercent = mean !== 0 ? ((value - mean) / mean) * 100 : 0;
        const direction: 'spike' | 'drop' = value > mean ? 'spike' : 'drop';
        
        // 确定严重程度
        let severity: 'critical' | 'warning' | 'info';
        if (zScore >= 3) severity = 'critical';
        else if (zScore >= 2) severity = 'warning';
        else severity = 'info';
        
        // 查找可能的原因（该日期前后24小时内的优化事件）
        const anomalyDate = enrichedData[i].date;
        const possibleCauses = await findPossibleCauses(db, params.accountId, anomalyDate, params.performanceGroupId);
        
        anomalies.push({
          id: `anomaly_${metric}_${anomalyDate}`,
          date: anomalyDate,
          metric,
          metricLabel: metricLabels[metric] || metric,
          actualValue: Math.round(value * 100) / 100,
          expectedValue: Math.round(mean * 100) / 100,
          deviationPercent: Math.round(deviationPercent * 100) / 100,
          severity,
          direction,
          possibleCauses,
        });
      }
    }
  }
  
  // 按严重程度和日期排序
  const severityOrder = { critical: 0, warning: 1, info: 2 };
  return anomalies.sort((a, b) => {
    if (severityOrder[a.severity] !== severityOrder[b.severity]) {
      return severityOrder[a.severity] - severityOrder[b.severity];
    }
    return b.date.localeCompare(a.date);
  });
}

/**
 * 查找可能导致异常的优化事件
 */
async function findPossibleCauses(
  db: any,
  accountId: number,
  anomalyDate: string,
  performanceGroupId?: number
): Promise<AnomalyDetection['possibleCauses']> {
  // 查找异常日期前后1天内的优化事件
  const startDate = new Date(anomalyDate);
  startDate.setDate(startDate.getDate() - 1);
  const endDate = new Date(anomalyDate);
  endDate.setDate(endDate.getDate() + 1);
  
  const startStr = startDate.toISOString().slice(0, 19).replace('T', ' ');
  const endStr = endDate.toISOString().slice(0, 19).replace('T', ' ');
  
  const conditions = [
    eq(optimizationEvents.accountId, accountId),
    gte(optimizationEvents.createdAt, startStr),
    lte(optimizationEvents.createdAt, endStr),
    ne(optimizationEvents.status, 'rolled_back'),
  ];
  if (performanceGroupId) {
    conditions.push(eq(optimizationEvents.performanceGroupId, performanceGroupId));
  }
  
  const events = await db.select()
    .from(optimizationEvents)
    .where(and(...conditions))
    .orderBy(desc(optimizationEvents.createdAt))
    .limit(10);
  
  return events.map((e: OptimizationEvent) => {
    // 根据事件类型和时间接近程度计算置信度
    const eventDate = new Date(e.createdAt);
    const anomalyDateObj = new Date(anomalyDate);
    const hoursDiff = Math.abs(eventDate.getTime() - anomalyDateObj.getTime()) / (1000 * 60 * 60);
    
    let confidence = 80 - hoursDiff * 3; // 时间越近置信度越高
    if (e.eventCategory === 'bid_adjustment') confidence += 10; // 出价调整影响更大
    if (e.eventCategory === 'campaign_action') confidence += 5;
    confidence = Math.max(10, Math.min(95, confidence));
    
    // 生成描述
    let description = '';
    if (e.eventCategory === 'bid_adjustment') {
      description = `出价调整: ${e.keywordText || e.campaignName || '未知'} 从 $${e.previousBid || '?'} 调整到 $${e.newBid || '?'}`;
    } else if (e.eventCategory === 'campaign_action') {
      description = `广告活动操作: ${e.actionType} - ${e.campaignName || '未知'}`;
    } else if (e.eventCategory === 'budget_adjustment') {
      description = `预算调整: ${e.campaignName || '未知'} ${e.previousValue || '?'} → ${e.newValue || '?'}`;
    } else {
      description = `${e.eventCategory}: ${e.actionType} - ${e.changeReason || e.actionDetail || ''}`;
    }
    
    return {
      eventId: e.id,
      actionType: e.actionType,
      eventCategory: e.eventCategory,
      description,
      createdAt: e.createdAt,
      confidence: Math.round(confidence),
    };
  });
}


// ==================== 3. 策略ROI对比引擎 ====================

/**
 * 获取策略ROI对比数据
 */
export async function getStrategyROIComparison(params: {
  accountId?: number;
  performanceGroupId?: number;
  days?: number;
  groupBy?: 'strategy' | 'actionType' | 'eventCategory';
}): Promise<StrategyROI[]> {
  const db = await getDb();
  if (!db) return [];
  
  const days = params.days || 30;
  const groupBy = params.groupBy || 'strategy';
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  const cutoffStr = cutoffDate.toISOString().slice(0, 19).replace('T', ' ');
  
  // 构建查询条件
  const conditions = [
    gte(optimizationEvents.createdAt, cutoffStr),
  ];
  if (params.accountId) conditions.push(eq(optimizationEvents.accountId, params.accountId));
  if (params.performanceGroupId) conditions.push(eq(optimizationEvents.performanceGroupId, params.performanceGroupId));
  
  const whereClause = and(...conditions);
  
  // 获取所有事件
  const events = await db.select()
    .from(optimizationEvents)
    .where(whereClause)
    .orderBy(asc(optimizationEvents.createdAt));
  
  // 按维度分组
  const groups: Record<string, { name: string; id: number | null; events: OptimizationEvent[] }> = {};
  
  for (const event of events) {
    let key: string;
    let name: string;
    let id: number | null = null;
    
    if (groupBy === 'strategy') {
      key = String(event.strategyTemplateId || 'no_strategy');
      name = event.strategyTemplateName || '无策略模板';
      id = event.strategyTemplateId;
    } else if (groupBy === 'actionType') {
      key = event.actionType;
      name = getActionTypeLabel(event.actionType);
      id = null;
    } else {
      key = event.eventCategory;
      name = getEventCategoryLabel(event.eventCategory);
      id = null;
    }
    
    if (!groups[key]) {
      groups[key] = { name, id, events: [] };
    }
    groups[key].events.push(event);
  }
  
  // 计算每个组的ROI
  const results: StrategyROI[] = [];
  
  for (const [key, group] of Object.entries(groups)) {
    const totalEvents = group.events.length;
    const successEvents = group.events.filter(e => e.status === 'success').length;
    const failedEvents = group.events.filter(e => e.status === 'failed').length;
    
    // 出价调整统计
    const bidEvents = group.events.filter(e => e.eventCategory === 'bid_adjustment');
    const bidIncreases = bidEvents.filter(e => parseFloat(e.bidChangePercent || '0') > 0).length;
    const bidDecreases = bidEvents.filter(e => parseFloat(e.bidChangePercent || '0') < 0).length;
    const avgBidChange = bidEvents.length > 0
      ? bidEvents.reduce((sum, e) => sum + parseFloat(e.bidChangePercent || '0'), 0) / bidEvents.length
      : 0;
    
    // 效果追踪统计
    const trackedEvents = group.events.filter(e => e.actualProfit7D !== null);
    const totalEstimatedProfit = group.events.reduce((sum, e) => sum + parseFloat(e.expectedProfitIncrease || '0'), 0);
    const totalActualProfit7D = trackedEvents.reduce((sum, e) => sum + parseFloat(e.actualProfit7D || '0'), 0);
    const totalActualProfit14D = group.events.filter(e => e.actualProfit14D !== null)
      .reduce((sum, e) => sum + parseFloat(e.actualProfit14D || '0'), 0);
    const totalActualProfit30D = group.events.filter(e => e.actualProfit30D !== null)
      .reduce((sum, e) => sum + parseFloat(e.actualProfit30D || '0'), 0);
    
    // 计算ROI
    const roi7D = totalEstimatedProfit !== 0 ? (totalActualProfit7D / Math.abs(totalEstimatedProfit)) * 100 : null;
    const roi14D = totalEstimatedProfit !== 0 ? (totalActualProfit14D / Math.abs(totalEstimatedProfit)) * 100 : null;
    const roi30D = totalEstimatedProfit !== 0 ? (totalActualProfit30D / Math.abs(totalEstimatedProfit)) * 100 : null;
    
    // 利润准确率
    const profitAccuracy = totalEstimatedProfit !== 0 && trackedEvents.length > 0
      ? Math.min(100, Math.max(0, (1 - Math.abs(totalActualProfit7D - totalEstimatedProfit) / Math.abs(totalEstimatedProfit)) * 100))
      : null;
    
    // 时间范围
    const dates = group.events.map(e => e.createdAt).filter(Boolean).sort();
    const firstEventDate = dates[0] || null;
    const lastEventDate = dates[dates.length - 1] || null;
    
    // 平均每天事件数
    let avgEventsPerDay = 0;
    if (firstEventDate && lastEventDate) {
      const daysDiff = Math.max(1, (new Date(lastEventDate).getTime() - new Date(firstEventDate).getTime()) / (1000 * 60 * 60 * 24));
      avgEventsPerDay = Math.round((totalEvents / daysDiff) * 100) / 100;
    }
    
    results.push({
      strategyId: group.id,
      strategyName: group.name,
      totalEvents,
      successEvents,
      failedEvents,
      successRate: totalEvents > 0 ? Math.round((successEvents / totalEvents) * 100) : 0,
      avgBidChange: Math.round(avgBidChange * 100) / 100,
      totalBidIncreases: bidIncreases,
      totalBidDecreases: bidDecreases,
      trackedEvents: trackedEvents.length,
      totalEstimatedProfit: Math.round(totalEstimatedProfit * 100) / 100,
      totalActualProfit7D: Math.round(totalActualProfit7D * 100) / 100,
      totalActualProfit14D: Math.round(totalActualProfit14D * 100) / 100,
      totalActualProfit30D: Math.round(totalActualProfit30D * 100) / 100,
      roi7D: roi7D !== null ? Math.round(roi7D * 100) / 100 : null,
      roi14D: roi14D !== null ? Math.round(roi14D * 100) / 100 : null,
      roi30D: roi30D !== null ? Math.round(roi30D * 100) / 100 : null,
      profitAccuracy: profitAccuracy !== null ? Math.round(profitAccuracy * 100) / 100 : null,
      firstEventDate,
      lastEventDate,
      avgEventsPerDay,
    });
  }
  
  // 按总事件数排序
  return results.sort((a, b) => b.totalEvents - a.totalEvents);
}


// ==================== 4. 高级分析仪表盘汇总 ====================

/**
 * 获取高级分析仪表盘汇总数据
 */
export async function getAdvancedAnalyticsSummary(params: {
  accountId?: number;
  performanceGroupId?: number;
  days?: number;
}): Promise<AdvancedAnalyticsSummary> {
  const db = await getDb();
  if (!db) return getEmptySummary();
  
  const days = params.days || 30;
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  const cutoffStr = cutoffDate.toISOString().slice(0, 19).replace('T', ' ');
  
  const conditions = [gte(optimizationEvents.createdAt, cutoffStr)];
  if (params.accountId) conditions.push(eq(optimizationEvents.accountId, params.accountId));
  if (params.performanceGroupId) conditions.push(eq(optimizationEvents.performanceGroupId, params.performanceGroupId));
  
  const whereClause = and(...conditions);
  
  // 获取基础统计
  const [totalResult] = await db.select({ count: sql<number>`count(*)` })
    .from(optimizationEvents).where(whereClause);
  const totalOptimizationEvents = totalResult?.count || 0;
  
  // 获取出价调整数量
  const [bidResult] = await db.select({ count: sql<number>`count(*)` })
    .from(optimizationEvents)
    .where(and(whereClause, sql`${optimizationEvents.eventCategory} = 'bid_adjustment'`));
  const totalBidAdjustments = bidResult?.count || 0;
  
  // 获取成功率
  const [successResult] = await db.select({ count: sql<number>`count(*)` })
    .from(optimizationEvents)
    .where(and(whereClause, eq(optimizationEvents.status, 'success')));
  const successCount = successResult?.count || 0;
  const overallSuccessRate = totalOptimizationEvents > 0 ? Math.round((successCount / totalOptimizationEvents) * 100) : 0;
  
  // 获取已追踪事件的利润汇总
  const [profitResult] = await db.select({
    totalEstimated: sql<string>`COALESCE(SUM(${optimizationEvents.expectedProfitIncrease}), 0)`,
    totalActual7D: sql<string>`COALESCE(SUM(${optimizationEvents.actualProfit7D}), 0)`,
    trackedCount: sql<number>`SUM(CASE WHEN ${optimizationEvents.actualProfit7D} IS NOT NULL THEN 1 ELSE 0 END)`,
    positiveCount: sql<number>`SUM(CASE WHEN ${optimizationEvents.actualProfit7D} > 0 THEN 1 ELSE 0 END)`,
  }).from(optimizationEvents).where(whereClause);
  
  const trackedCount = profitResult?.trackedCount || 0;
  const positiveCount = profitResult?.positiveCount || 0;
  const positiveEffectRate = trackedCount > 0 ? Math.round((positiveCount / trackedCount) * 100) : 0;
  
  // 获取策略ROI数据
  const strategyROI = await getStrategyROIComparison({
    accountId: params.accountId,
    performanceGroupId: params.performanceGroupId,
    days,
    groupBy: 'strategy',
  });
  
  const validStrategies = strategyROI.filter(s => s.roi7D !== null && s.totalEvents >= 5);
  const bestStrategy = validStrategies.length > 0
    ? validStrategies.reduce((best, s) => (s.roi7D || 0) > (best.roi7D || 0) ? s : best)
    : null;
  const worstStrategy = validStrategies.length > 0
    ? validStrategies.reduce((worst, s) => (s.roi7D || 0) < (worst.roi7D || 0) ? s : worst)
    : null;
  
  // 获取异常数量
  let activeAnomalies = 0;
  let criticalAnomalies = 0;
  if (params.accountId) {
    const anomalies = await detectAnomalies({
      accountId: params.accountId,
      performanceGroupId: params.performanceGroupId,
      days: Math.min(days, 14), // 异常检测只看最近14天
      sensitivity: 2,
    });
    activeAnomalies = anomalies.length;
    criticalAnomalies = anomalies.filter(a => a.severity === 'critical').length;
  }
  
  return {
    totalOptimizationEvents,
    totalBidAdjustments,
    overallSuccessRate,
    avgEffectScore: 0, // 需要归因分析计算
    totalAttributedSalesIncrease: parseFloat(profitResult?.totalActual7D || '0'),
    totalAttributedSpendIncrease: 0,
    netAttributedProfit: parseFloat(profitResult?.totalActual7D || '0'),
    positiveEffectRate,
    activeAnomalies,
    criticalAnomalies,
    bestStrategyName: bestStrategy?.strategyName || null,
    bestStrategyROI: bestStrategy?.roi7D || null,
    worstStrategyName: worstStrategy?.strategyName || null,
    worstStrategyROI: worstStrategy?.roi7D || null,
  };
}

function getEmptySummary(): AdvancedAnalyticsSummary {
  return {
    totalOptimizationEvents: 0,
    totalBidAdjustments: 0,
    overallSuccessRate: 0,
    avgEffectScore: 0,
    totalAttributedSalesIncrease: 0,
    totalAttributedSpendIncrease: 0,
    netAttributedProfit: 0,
    positiveEffectRate: 0,
    activeAnomalies: 0,
    criticalAnomalies: 0,
    bestStrategyName: null,
    bestStrategyROI: null,
    worstStrategyName: null,
    worstStrategyROI: null,
  };
}


// ==================== 5. 效果追踪调度器（基于统一事件表） ====================

/**
 * 获取需要追踪效果的优化事件
 * 从 optimization_events 表中查找N天前的出价调整事件
 */
export async function getEventsToTrack(period: number): Promise<OptimizationEvent[]> {
  const db = await getDb();
  if (!db) return [];
  
  const now = new Date();
  const targetDate = new Date(now.getTime() - period * 24 * 60 * 60 * 1000);
  const startOfDay = new Date(targetDate);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(targetDate);
  endOfDay.setHours(23, 59, 59, 999);
  
  const startStr = startOfDay.toISOString().slice(0, 19).replace('T', ' ');
  const endStr = endOfDay.toISOString().slice(0, 19).replace('T', ' ');
  
  // 根据周期确定要检查的字段
  let trackingField: string;
  if (period === 7) trackingField = 'actual_profit_7d';
  else if (period === 14) trackingField = 'actual_profit_14d';
  else trackingField = 'actual_profit_30d';
  
  const events = await db.select()
    .from(optimizationEvents)
    .where(and(
      ne(optimizationEvents.status, 'rolled_back'),
      sql`${optimizationEvents.eventCategory} = 'bid_adjustment'`,
      gte(optimizationEvents.createdAt, startStr),
      lte(optimizationEvents.createdAt, endStr),
      sql`${sql.raw(trackingField)} IS NULL`,
    ));
  
  return events;
}

/**
 * 更新优化事件的效果追踪数据（基于统一事件表）
 */
export async function updateEventTrackingData(
  eventId: number,
  period: number,
  trackingData: {
    spend: number; sales: number; impressions: number;
    clicks: number; orders: number; profit: number;
  }
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  
  const updateData: any = {
    trackingUpdatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
  };
  
  if (period === 7) {
    updateData.actualProfit7D = trackingData.profit.toString();
    updateData.actualSpend7D = trackingData.spend.toString();
    updateData.actualRevenue7D = trackingData.sales.toString();
    updateData.actualImpressions7D = trackingData.impressions;
    updateData.actualClicks7D = trackingData.clicks;
    updateData.actualConversions7D = trackingData.orders;
  } else if (period === 14) {
    updateData.actualProfit14D = trackingData.profit.toString();
  } else {
    updateData.actualProfit30D = trackingData.profit.toString();
  }
  
  await db.update(optimizationEvents)
    .set(updateData)
    .where(eq(optimizationEvents.id, eventId));
}

/**
 * 执行基于统一事件表的效果追踪任务
 */
export async function runUnifiedEffectTrackingTask(period: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  
  const events = await getEventsToTrack(period);
  let processed = 0;
  
  for (const event of events) {
    try {
      const eventDate = new Date(event.createdAt);
      const endDate = new Date(eventDate.getTime() + period * 24 * 60 * 60 * 1000);
      
      // 从 daily_performance 获取效果数据
      const perfData = await getPerformanceWindow(db, event, eventDate, endDate);
      
      await updateEventTrackingData(event.id, period, {
        spend: perfData.spend,
        sales: perfData.sales,
        impressions: perfData.impressions,
        clicks: perfData.clicks,
        orders: perfData.orders,
        profit: perfData.sales - perfData.spend,
      });
      
      processed++;
    } catch (error) {
      log.error(`[AdvancedAnalytics] Failed to track event ${event.id}:`, error);
    }
  }
  
  return processed;
}

/**
 * 运行所有周期的统一效果追踪
 */
export async function runAllUnifiedTrackingTasks(): Promise<{
  day7: number; day14: number; day30: number;
}> {
  const day7 = await runUnifiedEffectTrackingTask(7);
  const day14 = await runUnifiedEffectTrackingTask(14);
  const day30 = await runUnifiedEffectTrackingTask(30);
  
  log.info(`[AdvancedAnalytics] Effect tracking completed: 7d=${day7}, 14d=${day14}, 30d=${day30}`);
  return { day7, day14, day30 };
}


// ==================== 辅助函数 ====================

function getActionTypeLabel(actionType: string): string {
  const labels: Record<string, string> = {
    bid_increase: '出价上调',
    bid_decrease: '出价下调',
    bid_set: '出价设定',
    bid_auto_adjust: '自动出价调整',
    dayparting_bid: '分时出价',
    budget_increase: '预算增加',
    budget_decrease: '预算减少',
    budget_set: '预算设定',
    budget_adjustment: '预算调整',
    placement_adjust: '位置调整',
    placement_enable: '位置启用',
    placement_disable: '位置禁用',
    search_term_harvest: '搜索词收割',
    negative_keyword_add: '添加否定词',
    negative_keyword_remove: '移除否定词',
    keyword_create: '创建关键词',
    target_pause: '暂停投放目标',
    target_enable: '启用投放目标',
    campaign_pause: '暂停广告活动',
    campaign_enable: '启用广告活动',
    settings_update: '设置更新',
    strategy_change: '策略变更',
    schedule_update: '调度更新',
  };
  return labels[actionType] || actionType;
}

function getEventCategoryLabel(category: string): string {
  const labels: Record<string, string> = {
    bid_adjustment: '出价调整',
    placement_adjustment: '位置调整',
    budget_adjustment: '预算调整',
    search_term_action: '搜索词操作',
    keyword_action: '关键词操作',
    campaign_action: '广告活动操作',
    adgroup_action: '广告组操作',
    target_management: '投放目标管理',
    settings_change: '设置变更',
  };
  return labels[category] || category;
}
