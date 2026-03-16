/**
 * Attribution Window Helper - 归因延迟隔离模块
 * 
 * 数据专家改进3：将出价优化和风控扫描使用不同的数据窗口，
 * 避免归因延迟导致的决策偏差。
 * 
 * Amazon Ads 的7天归因窗口意味着：
 * - D-0 ~ D-3 的数据尚未完成归因，销售额和订单数会持续增长
 * - D-4 ~ D-30 的数据已基本完成归因，可用于出价决策
 * 
 * 隔离策略：
 * - **出价优化**：使用 D-4 ~ D-30 的成熟数据（归因已稳定）
 * - **风控扫描**：使用 D-0 ~ D-3 的实时数据（检测异常花销、零曝光风暴）
 * - **趋势分析**：使用 D-0 ~ D-60 的全量数据（长期趋势判断）
 */

import * as db from '../db';
import { getMarketplaceCurrentDate } from '../utils/timezone';

// ==================== 常量定义 ====================

/** 归因窗口配置 */
export const ATTRIBUTION_WINDOW = {
  /** Amazon 7天归因窗口的安全边际（天） */
  ATTRIBUTION_LAG_DAYS: 3,
  
  /** 出价优化数据窗口：D-4 到 D-30（成熟数据） */
  BID_OPTIMIZATION: {
    startDaysAgo: 30,  // 从30天前开始
    endDaysAgo: 4,     // 到4天前结束（跳过D-0~D-3）
    description: '出价优化窗口(D-4~D-30): 归因已稳定的成熟数据',
  },
  
  /** 风控扫描数据窗口：D-0 到 D-3（实时数据） */
  RISK_CONTROL: {
    startDaysAgo: 3,   // 从3天前开始
    endDaysAgo: 0,     // 到今天
    description: '风控扫描窗口(D-0~D-3): 检测异常的实时数据',
  },
  
  /** 趋势分析数据窗口：D-0 到 D-60（全量数据） */
  TREND_ANALYSIS: {
    startDaysAgo: 60,
    endDaysAgo: 0,
    description: '趋势分析窗口(D-0~D-60): 长期趋势判断',
  },
} as const;

/** 数据窗口类型 */
export type DataWindowType = 'bid_optimization' | 'risk_control' | 'trend_analysis';

// ==================== 核心接口 ====================

/** 窗口化绩效数据 */
export interface WindowedPerformance {
  /** 数据窗口类型 */
  windowType: DataWindowType;
  /** 数据起始日期 */
  startDate: string;
  /** 数据结束日期 */
  endDate: string;
  /** 汇总绩效 */
  impressions: number;
  clicks: number;
  spend: number;
  sales: number;
  orders: number;
  /** 计算指标 */
  acos: number;
  roas: number;
  cvr: number;
  cpc: number;
  ctr: number;
  /** 数据天数 */
  dataDays: number;
  /** 数据完整性标记 */
  isAttributionMature: boolean;
}

/** 归因校正后的关键词绩效 */
export interface AttributionCorrectedKeywordPerformance {
  keywordId: number;
  keywordText: string;
  matchType: string;
  currentBid: number;
  /** 成熟窗口（D-4~D-30）的绩效 - 用于出价决策 */
  maturePerformance: WindowedPerformance;
  /** 实时窗口（D-0~D-3）的绩效 - 用于风控 */
  realtimePerformance: WindowedPerformance;
  /** 归因校正系数：matureSales / rawSales，反映归因延迟的影响程度 */
  attributionCorrectionFactor: number;
}

// ==================== 核心函数 ====================

/**
 * 获取指定数据窗口的日期范围
 */
export function getWindowDateRange(
  windowType: DataWindowType,
  marketplace: string = 'US'
): { startDate: Date; endDate: Date; startDateStr: string; endDateStr: string } {
  const config = windowType === 'bid_optimization' 
    ? ATTRIBUTION_WINDOW.BID_OPTIMIZATION
    : windowType === 'risk_control'
    ? ATTRIBUTION_WINDOW.RISK_CONTROL
    : ATTRIBUTION_WINDOW.TREND_ANALYSIS;
  
  const now = new Date();
  const endDate = new Date(now.getTime() - config.endDaysAgo * 24 * 60 * 60 * 1000);
  const startDate = new Date(now.getTime() - config.startDaysAgo * 24 * 60 * 60 * 1000);
  
  return {
    startDate,
    endDate,
    startDateStr: startDate.toISOString().split('T')[0],
    endDateStr: endDate.toISOString().split('T')[0],
  };
}

/**
 * 获取Campaign级别的窗口化绩效数据
 * 
 * 从 dailyPerformance 表中按指定窗口聚合数据。
 */
export async function getCampaignWindowedPerformance(
  accountId: number,
  campaignId: number | string,  // v207: Amazon campaignId (varchar)
  windowType: DataWindowType,
  marketplace: string = 'US'
): Promise<WindowedPerformance> {
  const { startDate, endDate, startDateStr, endDateStr } = getWindowDateRange(windowType, marketplace);
  
  const dailyData = await db.getDailyPerformanceByDateRange(
    accountId,
    startDate,
    endDate,
    campaignId
  );
  
  // 聚合数据
  let impressions = 0, clicks = 0, spend = 0, sales = 0, orders = 0;
  
  for (const day of dailyData) {
    impressions += Number(day.impressions) || 0;
    clicks += Number(day.clicks) || 0;
    spend += parseFloat(String(day.spend || '0'));
    sales += parseFloat(String(day.sales || '0'));
    orders += Number(day.orders) || 0;
  }
  
  const acos = sales > 0 ? (spend / sales) * 100 : 0;
  const roas = spend > 0 ? sales / spend : 0;
  const cvr = clicks > 0 ? (orders / clicks) * 100 : 0;
  const cpc = clicks > 0 ? spend / clicks : 0;
  const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
  
  return {
    windowType,
    startDate: startDateStr,
    endDate: endDateStr,
    impressions,
    clicks,
    spend,
    sales,
    orders,
    acos,
    roas,
    cvr,
    cpc,
    ctr,
    dataDays: dailyData.length,
    isAttributionMature: windowType === 'bid_optimization',
  };
}

/**
 * 获取Account级别的窗口化绩效数据
 */
export async function getAccountWindowedPerformance(
  accountId: number,
  windowType: DataWindowType,
  marketplace: string = 'US'
): Promise<WindowedPerformance> {
  const { startDate, endDate, startDateStr, endDateStr } = getWindowDateRange(windowType, marketplace);
  
  const summary = await db.getPerformanceSummary(accountId, startDate, endDate);
  
  const impressions = Number(summary?.totalImpressions) || 0;
  const clicks = Number(summary?.totalClicks) || 0;
  const spend = parseFloat(String(summary?.totalSpend || '0'));
  const sales = parseFloat(String(summary?.totalSales || '0'));
  const orders = Number(summary?.totalOrders) || 0;
  
  const acos = sales > 0 ? (spend / sales) * 100 : 0;
  const roas = spend > 0 ? sales / spend : 0;
  const cvr = clicks > 0 ? (orders / clicks) * 100 : 0;
  const cpc = clicks > 0 ? spend / clicks : 0;
  const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
  
  return {
    windowType,
    startDate: startDateStr,
    endDate: endDateStr,
    impressions,
    clicks,
    spend,
    sales,
    orders,
    acos,
    roas,
    cvr,
    cpc,
    ctr,
    dataDays: Math.ceil((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000)),
    isAttributionMature: windowType === 'bid_optimization',
  };
}

/**
 * 计算归因校正系数
 * 
 * 通过比较Campaign级别的成熟窗口和全量窗口的数据，
 * 估算归因延迟对关键词级别数据的影响程度。
 * 
 * 校正系数 = 成熟窗口日均销售 / 全量窗口日均销售
 * - 系数 > 1：说明成熟数据比实时数据表现更好（归因延迟使实时数据被低估）
 * - 系数 < 1：说明实时数据比成熟数据表现更好（可能是近期优化生效）
 * - 系数 ≈ 1：归因延迟影响较小
 */
export async function calculateAttributionCorrectionFactor(
  accountId: number,
  campaignId: number | string,  // v207: Amazon campaignId (varchar)
  marketplace: string = 'US'
): Promise<{
  correctionFactor: number;
  maturePerformance: WindowedPerformance;
  realtimePerformance: WindowedPerformance;
  confidence: number;
}> {
  const maturePerf = await getCampaignWindowedPerformance(
    accountId, campaignId, 'bid_optimization', marketplace
  );
  const realtimePerf = await getCampaignWindowedPerformance(
    accountId, campaignId, 'risk_control', marketplace
  );
  
  // 计算日均销售
  const matureDailySales = maturePerf.dataDays > 0 ? maturePerf.sales / maturePerf.dataDays : 0;
  const realtimeDailySales = realtimePerf.dataDays > 0 ? realtimePerf.sales / realtimePerf.dataDays : 0;
  
  // 校正系数
  let correctionFactor = 1.0;
  if (realtimeDailySales > 0 && matureDailySales > 0) {
    correctionFactor = matureDailySales / realtimeDailySales;
    // 限制校正系数在合理范围内 [0.5, 2.0]
    correctionFactor = Math.max(0.5, Math.min(2.0, correctionFactor));
  }
  
  // 置信度：基于成熟窗口的数据量
  const confidence = Math.min(0.95, 0.3 + (maturePerf.clicks / 500) * 0.65);
  
  return {
    correctionFactor,
    maturePerformance: maturePerf,
    realtimePerformance: realtimePerf,
    confidence,
  };
}

/**
 * 对关键词绩效数据应用归因校正
 * 
 * 由于没有关键词级别的每日绩效表，使用Campaign级别的校正系数
 * 来调整关键词的累计绩效数据。
 * 
 * 校正逻辑：
 * - 花费（spend）：不需要校正（花费是实时确认的）
 * - 销售（sales）：乘以校正系数（归因延迟主要影响销售）
 * - 订单（orders）：乘以校正系数
 * - 点击（clicks）：不需要校正（点击是实时确认的）
 * - 曝光（impressions）：不需要校正
 */
export function applyAttributionCorrection(
  rawPerformance: {
    impressions: number;
    clicks: number;
    spend: number;
    sales: number;
    orders: number;
  },
  correctionFactor: number,
  windowType: DataWindowType
): {
  impressions: number;
  clicks: number;
  spend: number;
  sales: number;
  orders: number;
  corrected: boolean;
  correctionFactor: number;
} {
  // 风控窗口不需要校正销售数据（关注花费和流量异常）
  if (windowType === 'risk_control') {
    return {
      ...rawPerformance,
      corrected: false,
      correctionFactor: 1.0,
    };
  }
  
  // 出价优化窗口：校正销售和订单数据
  if (windowType === 'bid_optimization') {
    return {
      impressions: rawPerformance.impressions,
      clicks: rawPerformance.clicks,
      spend: rawPerformance.spend,
      // 销售和订单乘以校正系数
      sales: rawPerformance.sales * correctionFactor,
      orders: Math.round(rawPerformance.orders * correctionFactor),
      corrected: true,
      correctionFactor,
    };
  }
  
  // 趋势分析：不校正
  return {
    ...rawPerformance,
    corrected: false,
    correctionFactor: 1.0,
  };
}

/**
 * 判断是否应该使用归因校正
 * 
 * 只有在以下条件满足时才启用校正：
 * 1. 成熟窗口有足够的数据（clicks >= 50）
 * 2. 校正系数偏离1.0超过10%
 * 3. 不是新Campaign（创建超过7天）
 */
export function shouldApplyCorrection(
  correctionFactor: number,
  matureClicks: number,
  campaignCreatedDaysAgo: number
): boolean {
  // 数据不足，不校正
  if (matureClicks < 50) return false;
  
  // 新Campaign，不校正（数据不稳定）
  if (campaignCreatedDaysAgo < 7) return false;
  
  // 校正系数偏离不大，不需要校正
  if (Math.abs(correctionFactor - 1.0) < 0.10) return false;
  
  return true;
}

/**
 * 风控扫描：检测实时窗口中的异常
 * 
 * 使用 D-0~D-3 的实时数据检测：
 * 1. 花费飙升：日均花费超过成熟窗口日均的2倍
 * 2. 零曝光风暴：成熟窗口有曝光但实时窗口零曝光
 * 3. CPC飙升：实时CPC超过成熟窗口CPC的1.5倍
 */
export async function detectRiskSignals(
  accountId: number,
  campaignId: number | string,  // v207: Amazon campaignId (varchar)
  marketplace: string = 'US'
): Promise<{
  hasRisk: boolean;
  risks: Array<{
    type: 'spend_spike' | 'zero_impression_storm' | 'cpc_spike' | 'acos_spike';
    severity: 'low' | 'medium' | 'high' | 'critical';
    description: string;
    matureValue: number;
    realtimeValue: number;
  }>;
}> {
  const { maturePerformance, realtimePerformance } = await calculateAttributionCorrectionFactor(
    accountId, campaignId, marketplace
  );
  
  const risks: Array<{
    type: 'spend_spike' | 'zero_impression_storm' | 'cpc_spike' | 'acos_spike';
    severity: 'low' | 'medium' | 'high' | 'critical';
    description: string;
    matureValue: number;
    realtimeValue: number;
  }> = [];
  
  const matureDailySpend = maturePerformance.dataDays > 0 
    ? maturePerformance.spend / maturePerformance.dataDays : 0;
  const realtimeDailySpend = realtimePerformance.dataDays > 0 
    ? realtimePerformance.spend / realtimePerformance.dataDays : 0;
  
  // 1. 花费飙升检测
  if (matureDailySpend > 0 && realtimeDailySpend > matureDailySpend * 2) {
    const ratio = realtimeDailySpend / matureDailySpend;
    risks.push({
      type: 'spend_spike',
      severity: ratio > 3 ? 'critical' : ratio > 2.5 ? 'high' : 'medium',
      description: `日均花费飙升: 实时$${realtimeDailySpend.toFixed(2)} vs 成熟$${matureDailySpend.toFixed(2)} (${ratio.toFixed(1)}x)`,
      matureValue: matureDailySpend,
      realtimeValue: realtimeDailySpend,
    });
  }
  
  // 2. 零曝光风暴检测
  const matureDailyImpressions = maturePerformance.dataDays > 0 
    ? maturePerformance.impressions / maturePerformance.dataDays : 0;
  if (matureDailyImpressions > 100 && realtimePerformance.impressions === 0) {
    risks.push({
      type: 'zero_impression_storm',
      severity: matureDailyImpressions > 1000 ? 'critical' : 'high',
      description: `零曝光风暴: 成熟窗口日均${Math.round(matureDailyImpressions)}曝光，实时窗口为0`,
      matureValue: matureDailyImpressions,
      realtimeValue: 0,
    });
  }
  
  // 3. CPC飙升检测
  if (maturePerformance.cpc > 0 && realtimePerformance.cpc > maturePerformance.cpc * 1.5) {
    const ratio = realtimePerformance.cpc / maturePerformance.cpc;
    risks.push({
      type: 'cpc_spike',
      severity: ratio > 2 ? 'high' : 'medium',
      description: `CPC飙升: 实时$${realtimePerformance.cpc.toFixed(2)} vs 成熟$${maturePerformance.cpc.toFixed(2)} (${ratio.toFixed(1)}x)`,
      matureValue: maturePerformance.cpc,
      realtimeValue: realtimePerformance.cpc,
    });
  }
  
  // 4. ACoS飙升检测（注意：实时ACoS因归因延迟会偏高，需要校正）
  // 使用花费/校正后销售来判断
  if (maturePerformance.acos > 0 && realtimePerformance.spend > 0) {
    // 实时ACoS需要考虑归因延迟，给予1.5倍的容忍度
    const adjustedRealtimeAcos = realtimePerformance.acos;
    const threshold = maturePerformance.acos * 2.5; // 2.5倍容忍度（因为D-0~D-3归因未完成）
    
    if (adjustedRealtimeAcos > threshold && adjustedRealtimeAcos > 100) {
      risks.push({
        type: 'acos_spike',
        severity: adjustedRealtimeAcos > maturePerformance.acos * 4 ? 'high' : 'medium',
        description: `ACoS异常: 实时${adjustedRealtimeAcos.toFixed(1)}% vs 成熟${maturePerformance.acos.toFixed(1)}% (考虑归因延迟后仍异常)`,
        matureValue: maturePerformance.acos,
        realtimeValue: adjustedRealtimeAcos,
      });
    }
  }
  
  return {
    hasRisk: risks.length > 0,
    risks,
  };
}
