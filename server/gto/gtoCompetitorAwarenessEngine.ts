import { createModuleLogger } from '../utils/logger';
const log = createModuleLogger('GtoCompetitorAwarenessEngine');
/**
 * gtoCompetitorAwarenessEngine.ts - GTO竞争环境感知引擎
 * 
 * 灵感来源：德州扑克"读对手"策略
 * - 岩石型(Nits): 只在黄金时段竞争头部流量，出价极高但持续性差
 * - 跟注站型(Calling Stations): 机械跟随出价，缺乏独立策略
 * - 疯狂型(Maniacs): 全时段高价竞价，预算消耗极快
 * 
 * 核心功能：
 * 1. 分析关键词级别的竞争强度（基于CPC波动、曝光份额变化）
 * 2. 推断竞品行为模式并分类
 * 3. 为出价引擎提供竞争环境上下文
 */

import { getDb } from "../db";
import { hourlyPerformance, keywords, campaigns, dailyPerformance } from "../../drizzle/schema";
import { eq, and, gte, lte, sql, desc, isNotNull } from "drizzle-orm";

// ==================== 类型定义 ====================

export type CompetitorType = 'nit' | 'calling_station' | 'maniac' | 'unknown';

export interface CompetitionProfile {
  /** 竞争强度: 0-1, 1表示极高竞争 */
  competitionIntensity: number;
  /** 推断的主要竞品类型 */
  dominantCompetitorType: CompetitorType;
  /** CPC波动系数 (标准差/均值), 高波动暗示有岩石型对手 */
  cpcVolatility: number;
  /** 曝光集中度: 高峰时段曝光占比, 高集中度暗示竞品集中在黄金时段 */
  impressionConcentration: number;
  /** 竞争窗口: 竞争最弱的时段列表 */
  weakCompetitionHours: number[];
  /** 竞争高峰: 竞争最强的时段列表 */
  peakCompetitionHours: number[];
  /** 建议的出价策略修正系数 */
  bidStrategyModifier: number;
  /** 分析置信度 */
  confidence: number;
  /** 分析原因说明 */
  reasoning: string;
}

export interface KeywordCompetitionContext {
  keywordId: number;
  profile: CompetitionProfile;
}

// ==================== 常量配置 ====================

/** 分析所需的最小小时数据点数 */
const MIN_HOURLY_DATA_POINTS = 48; // 至少2天的小时级数据

/** CPC波动阈值 */
const CPC_VOLATILITY_HIGH = 0.5;  // 高波动 — 可能有岩石型对手
const CPC_VOLATILITY_LOW = 0.15;  // 低波动 — 可能有跟注站型对手

/** 曝光集中度阈值 (高峰6小时占全天比例) */
const CONCENTRATION_HIGH = 0.6;  // 高集中度 — 竞品集中在黄金时段
const CONCENTRATION_LOW = 0.3;   // 低集中度 — 竞品全天覆盖

// ==================== 核心算法 ====================

/**
 * 分析单个Campaign在指定账户下的竞争环境
 * 基于hourly_performance表中的CPC、曝光量、estimated_competition等数据
 */
export async function analyzeCompetitionForCampaign(
  accountId: number,
  campaignId: string,
  lookbackDays: number = 14
): Promise<CompetitionProfile> {
  const db = await getDb();
  if (!db) return buildDefaultProfile('数据库不可用');
  
  // v274: 多维信号融合 — 从广告活动日报中提取额外的竞争信号
  let dailyCompetitionSignals: { avgCpc: number; cpcTrend: number; impressionTrend: number; ctrTrend: number } | null = null;
  try {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - lookbackDays);
    const dailyData = await db.select({
      date: dailyPerformance.date,
      impressions: dailyPerformance.impressions,
      clicks: dailyPerformance.clicks,
      spend: dailyPerformance.spend,
    }).from(dailyPerformance)
      .where(and(
        eq(dailyPerformance.accountId, accountId),
        eq(dailyPerformance.campaignId, campaignId),
        gte(dailyPerformance.date, startDate.toISOString().split('T')[0])
      ))
      .orderBy(dailyPerformance.date)
      .limit(lookbackDays);
    
    if (dailyData.length >= 5) {
      const cpcs = dailyData.filter(d => (d.clicks || 0) > 0).map(d => Number(d.spend || 0) / (d.clicks || 1));
      const impressions = dailyData.map(d => d.impressions || 0);
      const ctrs = dailyData.filter(d => (d.impressions || 0) > 0).map(d => (d.clicks || 0) / (d.impressions || 1));
      
      // @ts-ignore
      const avgCpc = cpcs.length > 0 ? cpcs.reduce((a: unknown, b: unknown) => a + b, 0) / cpcs.length : 0;
      const cpcTrend = cpcs.length >= 3 ? (cpcs[cpcs.length - 1] - cpcs[0]) / (cpcs[0] || 1) : 0;
      const impressionTrend = impressions.length >= 3 ? (impressions[impressions.length - 1] - impressions[0]) / (impressions[0] || 1) : 0;
      const ctrTrend = ctrs.length >= 3 ? (ctrs[ctrs.length - 1] - ctrs[0]) / (ctrs[0] || 1) : 0;
      
      dailyCompetitionSignals = { avgCpc, cpcTrend, impressionTrend, ctrTrend };
    }
  } catch (dailyErr: unknown) {
    // 日报信号失败不影响核心流程
  }

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - lookbackDays);

  try {
    // 查询小时级表现数据
    const hourlyData = await db.select({
      hour: hourlyPerformance.hour,
      impressions: hourlyPerformance.impressions,
      clicks: hourlyPerformance.clicks,
      spend: hourlyPerformance.spend,
      estimatedCompetition: hourlyPerformance.estimatedCompetition,
    })
    .from(hourlyPerformance)
    .where(and(
      eq(hourlyPerformance.accountId, accountId),
      eq(hourlyPerformance.campaignId, campaignId),
      gte(hourlyPerformance.date, startDate.toISOString()),
    ))
    .orderBy(hourlyPerformance.hour);

    if (hourlyData.length < MIN_HOURLY_DATA_POINTS) {
      return buildDefaultProfile(`小时数据不足(${hourlyData.length}/${MIN_HOURLY_DATA_POINTS})`);
    }

    // 1. 计算每小时的CPC
    const hourlyMetrics: Map<number, { cpcs: number[], impressions: number[], competitions: number[] }> = new Map();
    for (let h = 0; h < 24; h++) {
      hourlyMetrics.set(h, { cpcs: [], impressions: [], competitions: [] });
    }

    // @ts-ignore
    for (const row of (hourlyData as unknown[])) {
      // @ts-ignore
      const h = row.hour;
      // @ts-ignore
      const clicks = row.clicks || 0;
      // @ts-ignore
      const spend = parseFloat(row.spend || '0');
      // @ts-ignore
      const impressions = row.impressions || 0;
      // @ts-ignore
      const competition = parseFloat(row.estimatedCompetition || '0');
      
      const metrics = hourlyMetrics.get(h)!;
      if (clicks > 0) {
        metrics.cpcs.push(spend / clicks);
      }
      metrics.impressions.push(impressions);
      if (competition > 0) {
        metrics.competitions.push(competition);
      }
    }

    // 2. 计算CPC波动系数
    const allCpcs: number[] = [];
    for (const [, m] of hourlyMetrics) {
      allCpcs.push(...m.cpcs);
    }
    // @ts-ignore
    const cpcVolatility = allCpcs.length >= 5 ? calculateCV(allCpcs) : 0.3;

    // 3. 计算曝光集中度 — 高峰6小时占全天比例
    const hourlyAvgImpressions: { hour: number; avg: number }[] = [];
    // @ts-ignore
    for (const [hour, m] of hourlyMetrics) {
      const avg = m.impressions.length > 0 
        // @ts-ignore
        ? m.impressions.reduce((a: unknown, b: unknown) => a + b, 0) / m.impressions.length 
        : 0;
      hourlyAvgImpressions.push({ hour, avg });
    }
    // @ts-ignore
    hourlyAvgImpressions.sort((a: unknown, b: unknown) => b.avg - a.avg);
    
    // @ts-ignore
    const totalAvgImpressions = hourlyAvgImpressions.reduce((sum: number, h: Record<string, unknown>) => sum + h.avg, 0);
    // @ts-ignore
    const top6Impressions = hourlyAvgImpressions.slice(0, 6).reduce((sum: number, h: Record<string, unknown>) => sum + h.avg, 0);
    const impressionConcentration = totalAvgImpressions > 0 ? top6Impressions / totalAvgImpressions : 0.25;

    // 4. 识别竞争窗口（曝光最高=竞争最弱的时段，因为我们能获得更多曝光）
    // 和竞争高峰（曝光最低=竞争最强，因为被挤出）
    // 注意：这里的逻辑是——当我们的曝光低时，说明竞争激烈（CPC高、被挤出）
    // 当我们的曝光高时，说明竞争较弱（竞品不在线或预算耗尽）
    // @ts-ignore
    const sortedByImpression = [...hourlyAvgImpressions].sort((a: unknown, b: unknown) => b.avg - a.avg);
    // @ts-ignore
    const weakCompetitionHours = sortedByImpression.slice(0, 4).map(h => h.hour);
    const peakCompetitionHours = sortedByImpression.slice(-4).map(h => h.hour);

    // 但更准确的方式是看CPC：CPC低的时段竞争弱，CPC高的时段竞争强
    const hourlyCpcAvg: { hour: number; avgCpc: number }[] = [];
    for (const [hour, m] of hourlyMetrics) {
      if (m.cpcs.length > 0) {
        // @ts-ignore
        hourlyCpcAvg.push({ hour, avgCpc: m.cpcs.reduce((a: unknown, b: unknown) => a + b, 0) / m.cpcs.length });
      }
    }
    if (hourlyCpcAvg.length >= 12) {
      // @ts-ignore
      hourlyCpcAvg.sort((a: unknown, b: unknown) => a.avgCpc - b.avgCpc);
      weakCompetitionHours.length = 0;
      peakCompetitionHours.length = 0;
      weakCompetitionHours.push(...hourlyCpcAvg.slice(0, 4).map(h => h.hour));
      peakCompetitionHours.push(...hourlyCpcAvg.slice(-4).map(h => h.hour));
    }

    // 5. 计算竞争强度 (0-1)
    const avgCompetition = allCpcs.length > 0 
      ? (() => {
          const allComps: number[] = [];
          for (const [, m] of hourlyMetrics) allComps.push(...m.competitions);
          // @ts-ignore
          return allComps.length > 0 ? allComps.reduce((a: unknown, b: unknown) => a + b, 0) / allComps.length : 0.5;
        })()
      : 0.5;
    let competitionIntensity = Math.min(1, Math.max(0, avgCompetition));
    
    // v274: 融合日报多维信号增强竞争强度估计
    if (dailyCompetitionSignals) {
      // CPC上升趋势表明竞争加剧
      const cpcSignal = dailyCompetitionSignals.cpcTrend > 0.1 ? 0.15 : dailyCompetitionSignals.cpcTrend < -0.1 ? -0.1 : 0;
      // 曝光下降趋势表明被竞品挤出
      const impressionSignal = dailyCompetitionSignals.impressionTrend < -0.15 ? 0.1 : dailyCompetitionSignals.impressionTrend > 0.15 ? -0.05 : 0;
      // CTR下降可能表明竞品广告更具吸引力
      const ctrSignal = dailyCompetitionSignals.ctrTrend < -0.1 ? 0.05 : 0;
      
      competitionIntensity = Math.min(1, Math.max(0, competitionIntensity + cpcSignal + impressionSignal + ctrSignal));
    }
    
    // 6. 推断竞品类型型
    const { competitorType, reasoning } = classifyCompetitor(
      cpcVolatility, impressionConcentration, competitionIntensity
    );

    // 7. 计算出价策略修正系数
    const bidStrategyModifier = calculateBidModifier(competitorType, competitionIntensity);

    // 8. 计算置信度
    const confidence = Math.min(0.9, hourlyData.length / 336); // 336 = 14天 × 24小时

    return {
      competitionIntensity,
      dominantCompetitorType: competitorType,
      cpcVolatility,
      impressionConcentration,
      weakCompetitionHours,
      peakCompetitionHours,
      bidStrategyModifier,
      confidence,
      reasoning,
    };
  } catch (error: unknown) {
    log.warn(`[GTO-CompetitorAwareness] Error analyzing competition: ${(error as Error).message}`);
    return buildDefaultProfile(`分析异常: ${(error as Error).message}`);
  }
}

/**
 * 批量分析多个关键词的竞争环境
 */
export async function batchAnalyzeCompetition(
  accountId: number,
  campaignIds: string[],
  lookbackDays: number = 14
): Promise<Map<string, CompetitionProfile>> {
  const results = new Map<string, CompetitionProfile>();
  
  for (const campaignId of campaignIds) {
    const profile = await analyzeCompetitionForCampaign(accountId, campaignId, lookbackDays);
    results.set(campaignId, profile);
  }
  
  return results;
}

// ==================== 辅助函数 ====================

/**
 * 根据CPC波动、曝光集中度和竞争强度推断竞品类型
 */
function classifyCompetitor(
  cpcVolatility: number,
  impressionConcentration: number,
  competitionIntensity: number
): { competitorType: CompetitorType; reasoning: string } {
  
  // 岩石型特征: CPC波动大(高峰时段出价极高，其他时段消失) + 曝光高度集中
  if (cpcVolatility > CPC_VOLATILITY_HIGH && impressionConcentration > CONCENTRATION_HIGH) {
    return {
      competitorType: 'nit',
      reasoning: `CPC波动系数${cpcVolatility.toFixed(2)}(高)，曝光集中度${(impressionConcentration * 100).toFixed(0)}%(高)，` +
        `竞品特征为"岩石型"：仅在黄金时段高价竞争，其他时段不活跃。` +
        `建议策略：避开其活跃时段，在其不在线时段加注。`
    };
  }

  // 疯狂型特征: CPC波动低(全天持续高价) + 曝光分散 + 竞争强度高
  if (cpcVolatility < CPC_VOLATILITY_LOW && impressionConcentration < CONCENTRATION_LOW && competitionIntensity > 0.6) {
    return {
      competitorType: 'maniac',
      reasoning: `CPC波动系数${cpcVolatility.toFixed(2)}(低)，曝光集中度${(impressionConcentration * 100).toFixed(0)}%(低)，` +
        `竞争强度${(competitionIntensity * 100).toFixed(0)}%(高)，竞品特征为"疯狂型"：全天无差别高价竞价。` +
        `建议策略：保守出价避免正面冲突，等待其预算耗尽后抢占。`
    };
  }

  // 跟注站型特征: CPC波动低(机械跟价) + 竞争强度中等
  if (cpcVolatility < CPC_VOLATILITY_HIGH && competitionIntensity >= 0.3 && competitionIntensity <= 0.7) {
    return {
      competitorType: 'calling_station',
      reasoning: `CPC波动系数${cpcVolatility.toFixed(2)}(中低)，竞争强度${(competitionIntensity * 100).toFixed(0)}%(中等)，` +
        `竞品特征为"跟注站型"：机械跟随出价，缺乏独立策略。` +
        `建议策略：对核心词稳定价值下注，在非核心词上可设置诱导性出价。`
    };
  }

  return {
    competitorType: 'unknown',
    reasoning: `CPC波动${cpcVolatility.toFixed(2)}，曝光集中度${(impressionConcentration * 100).toFixed(0)}%，` +
      `竞争强度${(competitionIntensity * 100).toFixed(0)}%，竞品模式不明确，采用默认策略。`
  };
}

/**
 * 根据竞品类型计算出价策略修正系数
 * > 1.0 表示可以更激进，< 1.0 表示应更保守
 */
function calculateBidModifier(competitorType: CompetitorType, intensity: number): number {
  switch (competitorType) {
    case 'nit':
      // 岩石型: 在其不活跃时段可以更激进(1.1-1.2)，活跃时段保守(0.8-0.9)
      // 返回平均修正系数，具体时段修正在出价时动态计算
      return 1.05;
    
    case 'calling_station':
      // 跟注站型: 稳定价值下注，略微激进
      return 1.08;
    
    // @ts-ignore
    case 'maniac':
      // 疯狂型: 保守出价，避免正面冲突
      // @ts-ignore
      return Math.max(0.75, 1.0 - intensity * 0.3);
    
    default:
      return 1.0;
  }
}

/**
 * 计算变异系数 (Coefficient of Variation)
 */
function calculateCV(values: number[]): number {
  if (values.length < 2) return 0;
  // @ts-ignore
  const mean = values.reduce((a: unknown, b: unknown) => a + b, 0) / values.length;
  if (mean === 0) return 0;
  // @ts-ignore
  const variance = values.reduce((sum: number, v: Record<string, unknown>) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}

/**
 * 构建默认竞争环境配置（数据不足时使用）
 */
function buildDefaultProfile(reason: string): CompetitionProfile {
  return {
    competitionIntensity: 0.5,
    dominantCompetitorType: 'unknown',
    cpcVolatility: 0.3,
    impressionConcentration: 0.35,
    weakCompetitionHours: [0, 1, 2, 3],
    peakCompetitionHours: [10, 11, 14, 15],
    bidStrategyModifier: 1.0,
    confidence: 0,
    reasoning: `[默认配置] ${reason}`,
  };
}

/**
 * 获取当前小时的竞争修正系数
 * 在实际出价时调用，根据当前时段是否为竞争窗口进行动态调整
 */
export function getHourlyCompetitionModifier(
  profile: CompetitionProfile,
  currentHour: number
): number {
  if (profile.confidence < 0.1) return 1.0; // 数据不足，不做修正

  const isWeakHour = profile.weakCompetitionHours.includes(currentHour);
  const isPeakHour = profile.peakCompetitionHours.includes(currentHour);

  switch (profile.dominantCompetitorType) {
    case 'nit':
      // 岩石型: 弱竞争时段加注20%，强竞争时段减注15%
      if (isWeakHour) return 1.20;
      if (isPeakHour) return 0.85;
      return 1.0;

    case 'calling_station':
      // 跟注站型: 全天稳定，弱竞争时段小幅加注
      if (isWeakHour) return 1.10;
      return 1.0;

    case 'maniac':
      // 疯狂型: 弱竞争时段（可能预算耗尽）大幅加注，其他时段保守
      if (isWeakHour) return 1.30;
      if (isPeakHour) return 0.70;
      return 0.85;

    default:
      if (isWeakHour) return 1.05;
      if (isPeakHour) return 0.95;
      return 1.0;
  }
}
