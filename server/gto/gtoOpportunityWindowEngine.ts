/**
 * gtoOpportunityWindowEngine.ts - GTO竞争窗口打击引擎
 * 
 * 灵感来源：德州扑克"位置攻击"(Positional Advantage) 策略
 * 
 * 核心思想：不再依赖固定的分时竞价时间表，而是实时监控竞品的
 * 广告在线状态。一旦侦测到主要竞品在高价值时段"掉线"（预算耗尽），
 * 立即触发"机会窗口攻击"模式，临时大幅提高出价，以极低成本
 * 收割原本属于高竞争环境的优质流量。
 * 
 * 数据来源：
 * - hourly_performance表的estimatedCompetition字段
 * - CPC突然下降 + 曝光量突然上升 = 竞品预算耗尽信号
 */

import type { CompetitionProfile } from "./gtoCompetitorAwarenessEngine";

// ==================== 类型定义 ====================

export interface OpportunityWindow {
  /** 是否检测到机会窗口 */
  isOpen: boolean;
  /** 窗口类型 */
  windowType: 'competitor_exhausted' | 'low_competition_period' | 'cpc_dip' | 'none';
  /** 出价攻击修正系数 (1.0=不变, 1.3=提升30%) */
  strikeModifier: number;
  /** 窗口持续预估（小时） */
  estimatedDurationHours: number;
  /** 窗口置信度 */
  confidence: number;
  /** 原因说明 */
  reasoning: string;
}

export interface HourlySignal {
  hour: number;
  avgCpc: number;
  avgImpressions: number;
  avgCompetition: number;
}

// ==================== 常量配置 ====================

/** 机会窗口检测阈值 */
const CPC_DROP_THRESHOLD = 0.25;          // CPC下降25%以上视为信号
const IMPRESSION_SURGE_THRESHOLD = 1.50;  // 曝光量上升50%以上视为信号
const COMPETITION_DROP_THRESHOLD = 0.30;  // 竞争指数下降30%以上视为信号

/** 攻击出价修正 */
const STRIKE_MODIFIER_EXHAUSTED = 1.35;   // 竞品耗尽时加注35%
const STRIKE_MODIFIER_LOW_COMP = 1.20;    // 低竞争时段加注20%
const STRIKE_MODIFIER_CPC_DIP = 1.15;     // CPC下降时加注15%

/** 安全限制 */
const MAX_STRIKE_MODIFIER = 1.40;         // 最大攻击修正40%
const MIN_CONFIDENCE_FOR_STRIKE = 0.3;    // 最低置信度要求

// ==================== 核心算法 ====================

/**
 * 检测当前时段是否存在竞争窗口
 * 
 * 通过对比当前小时的指标与历史同时段均值来判断
 */
export function detectOpportunityWindow(
  currentHour: number,
  currentCpc: number,
  currentImpressions: number,
  historicalSignals: HourlySignal[],
  competitionProfile?: CompetitionProfile
): OpportunityWindow {
  
  // 获取当前小时的历史基准
  const sameHourSignals = historicalSignals.filter(s => s.hour === currentHour);
  
  if (sameHourSignals.length < 3) {
    return buildNoWindow('历史数据不足，无法检测机会窗口');
  }
  
  // @ts-ignore Type inference limitation
  const avgHistCpc = sameHourSignals.reduce((s: unknown, h: unknown) => s + h.avgCpc, 0) / sameHourSignals.length;
  // @ts-ignore Type inference limitation
  const avgHistImpressions = sameHourSignals.reduce((s: unknown, h: unknown) => s + h.avgImpressions, 0) / sameHourSignals.length;
  // @ts-ignore Type inference limitation
  const avgHistCompetition = sameHourSignals.reduce((s: unknown, h: unknown) => s + h.avgCompetition, 0) / sameHourSignals.length;
  
  // ===== 信号检测 =====
  const cpcDropRatio = avgHistCpc > 0 ? (avgHistCpc - currentCpc) / avgHistCpc : 0;
  const impressionSurgeRatio = avgHistImpressions > 0 ? currentImpressions / avgHistImpressions : 1;
  const competitionDrop = avgHistCompetition > 0 ? (avgHistCompetition - (competitionProfile?.competitionIntensity || avgHistCompetition)) / avgHistCompetition : 0;
  
  // ===== 窗口类型判断 =====
  
  // 信号1: CPC大幅下降 + 曝光量上升 = 竞品预算耗尽
  if (cpcDropRatio >= CPC_DROP_THRESHOLD && impressionSurgeRatio >= IMPRESSION_SURGE_THRESHOLD) {
    const confidence = Math.min(0.9, (cpcDropRatio + (impressionSurgeRatio - 1)) / 2);
    return {
      isOpen: true,
      windowType: 'competitor_exhausted',
      strikeModifier: Math.min(MAX_STRIKE_MODIFIER, STRIKE_MODIFIER_EXHAUSTED),
      estimatedDurationHours: estimateWindowDuration(currentHour, competitionProfile),
      confidence,
      reasoning: `[竞品耗尽] CPC下降${(cpcDropRatio * 100).toFixed(0)}%(${avgHistCpc.toFixed(2)}→${currentCpc.toFixed(2)})，` +
        `曝光上升${((impressionSurgeRatio - 1) * 100).toFixed(0)}%，判定竞品预算耗尽，触发攻击模式(+${((STRIKE_MODIFIER_EXHAUSTED - 1) * 100).toFixed(0)}%)`,
    };
  }
  
  // 信号2: 竞争指数大幅下降
  if (competitionDrop >= COMPETITION_DROP_THRESHOLD) {
    const confidence = Math.min(0.8, competitionDrop);
    return {
      isOpen: true,
      windowType: 'low_competition_period',
      strikeModifier: Math.min(MAX_STRIKE_MODIFIER, STRIKE_MODIFIER_LOW_COMP),
      estimatedDurationHours: estimateWindowDuration(currentHour, competitionProfile),
      confidence,
      reasoning: `[低竞争时段] 竞争指数下降${(competitionDrop * 100).toFixed(0)}%，` +
        `当前为低竞争窗口，触发加注(+${((STRIKE_MODIFIER_LOW_COMP - 1) * 100).toFixed(0)}%)`,
    };
  }
  
  // 信号3: CPC单独下降（可能是部分竞品退出）
  if (cpcDropRatio >= CPC_DROP_THRESHOLD) {
    const confidence = Math.min(0.6, cpcDropRatio);
    return {
      isOpen: true,
      windowType: 'cpc_dip',
      strikeModifier: Math.min(MAX_STRIKE_MODIFIER, STRIKE_MODIFIER_CPC_DIP),
      estimatedDurationHours: 1, // CPC下降可能是短暂的
      confidence,
      reasoning: `[CPC下降] CPC下降${(cpcDropRatio * 100).toFixed(0)}%，` +
        `可能有竞品退出，小幅加注(+${((STRIKE_MODIFIER_CPC_DIP - 1) * 100).toFixed(0)}%)`,
    };
  }
  
  // 信号4: 利用竞争环境感知的弱竞争时段
  if (competitionProfile && competitionProfile.confidence > 0.3) {
    const isWeakHour = competitionProfile.weakCompetitionHours.includes(currentHour);
    if (isWeakHour) {
      return {
        isOpen: true,
        windowType: 'low_competition_period',
        strikeModifier: 1.10, // 基于历史模式的温和加注
        estimatedDurationHours: 2,
        confidence: competitionProfile.confidence * 0.7,
        reasoning: `[历史弱竞争时段] 当前${currentHour}时为历史低竞争时段(${competitionProfile.dominantCompetitorType}型竞品模式)，温和加注(+10%)`,
      };
    }
  }
  
  return buildNoWindow('当前时段竞争正常，无机会窗口');
}

/**
 * 批量检测多个Campaign的机会窗口
 */
export function batchDetectOpportunityWindows(
  currentHour: number,
  campaignSignals: Map<string, { currentCpc: number; currentImpressions: number; historicalSignals: HourlySignal[] }>,
  competitionProfiles?: Map<string, CompetitionProfile>
): Map<string, OpportunityWindow> {
  const results = new Map<string, OpportunityWindow>();
  
  for (const [campaignId, signals] of campaignSignals) {
    const profile = competitionProfiles?.get(campaignId);
    results.set(campaignId, detectOpportunityWindow(
      currentHour,
      signals.currentCpc,
      signals.currentImpressions,
      signals.historicalSignals,
      profile
    ));
  }
  
  return results;
}

// ==================== 辅助函数 ====================

/**
 * 估算机会窗口持续时间
 */
function estimateWindowDuration(
  currentHour: number,
  profile?: CompetitionProfile
): number {
  if (!profile || profile.confidence < 0.2) return 2; // 默认2小时
  
  // 基于竞品类型估算
  switch (profile.dominantCompetitorType) {
    case 'nit':
      // 岩石型竞品不在线时，窗口可能持续较长
      return 4;
    case 'maniac':
      // 疯狂型竞品预算耗尽后，通常到次日才恢复
      const hoursUntilMidnight = 24 - currentHour;
      return Math.min(8, hoursUntilMidnight);
    case 'calling_station':
      // 跟注站型通常持续在线，窗口较短
      return 1;
    default:
      return 2;
  }
}

/**
 * 构建无窗口结果
 */
function buildNoWindow(reason: string): OpportunityWindow {
  return {
    isOpen: false,
    windowType: 'none',
    strikeModifier: 1.0,
    estimatedDurationHours: 0,
    confidence: 0,
    reasoning: reason,
  };
}
