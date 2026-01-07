/**
 * 算法学习期机制
 * 
 * 三阶段模型：
 * - 冷启动期 (0-7天): 仅监控，禁止自动调整
 * - 学习期 (8-21天): 保守优化，幅度减半
 * - 成熟期 (21天+): 正常优化，全功能
 */

import { getDb } from "./db";
import { performanceGroups, campaigns, dailyPerformance, keywords } from "../drizzle/schema";
import { eq, and, gte, lte, sql, count, countDistinct } from "drizzle-orm";

// ==================== 类型定义 ====================

export type LearningStage = "cold_start" | "learning" | "mature";

export interface LearningStatus {
  performanceGroupId: number;
  accountId: number;
  currentStage: LearningStage;
  stageStartDate: Date;
  expectedMatureDate: Date | null;
  
  // 数据充分性评分
  dataSufficiencyScore: number;
  dataDays: number;
  totalClicks: number;
  totalConversions: number;
  activeKeywords: number;
  dataContinuity: number;
  
  // 调整因子 (0-1)
  adjustmentFactor: number;
  
  // 特殊状态
  isPaused: boolean;
  pauseReason: string | null;
  isPromotionPeriod: boolean;
  isSeasonalCategory: boolean;
}

export interface DataSufficiencyMetrics {
  dataDays: number;
  totalClicks: number;
  totalConversions: number;
  activeKeywords: number;
  dataContinuity: number;
}

export interface AdjustedLimits {
  budget: {
    maxIncrease: number;
    maxDecrease: number;
  };
  bid: {
    maxIncrease: number;
    maxDecrease: number;
  };
  placement: {
    maxIncrease: number;
    maxDecrease: number;
    absoluteMax: number;
  };
  ngram: {
    minFrequency: number;
    minSpend: number;
  };
  migration: {
    confidenceThreshold: number;
  };
}

// ==================== 常量配置 ====================

// 阶段时间配置（天）
const STAGE_DURATION = {
  COLD_START: 7,
  LEARNING: 14,  // 学习期持续14天（第8-21天）
};

// 大促期间缩短比例
const PROMOTION_REDUCTION_FACTOR = 0.5;

// 季节性品类延长比例
const SEASONAL_EXTENSION_FACTOR = 1.5;

// 数据充分性阈值（已减半）
const DATA_THRESHOLDS = {
  MATURE: {
    dataDays: 21,
    totalClicks: 250,      // 原500减半
    totalConversions: 25,  // 原50减半
    activeKeywords: 50,    // 原100减半
    dataContinuity: 0.8,
  },
  WEIGHTS: {
    dataDays: 0.30,
    totalClicks: 0.25,
    totalConversions: 0.25,
    activeKeywords: 0.10,
    dataContinuity: 0.10,
  },
};

// 基础安全边界
const BASE_SAFETY_LIMITS = {
  BUDGET: {
    MAX_INCREASE_PERCENT: 25,
    MAX_DECREASE_PERCENT: 25,
  },
  BID: {
    MAX_INCREASE_PERCENT: 10,
    MAX_DECREASE_PERCENT: 10,
  },
  PLACEMENT: {
    MAX_INCREASE_PERCENT: 25,
    MAX_DECREASE_PERCENT: 25,
    ABSOLUTE_MAX: 200,
  },
};

// N-Gram基础阈值
const BASE_NGRAM_THRESHOLDS = {
  MIN_FREQUENCY: 25,
  MIN_SPEND: 12.5,
};

// 迁移基础置信度阈值
const BASE_MIGRATION_CONFIDENCE = 0.7;

// ==================== 市场曲线（S曲线）函数 ====================

/**
 * S曲线函数 - 用于学习期调整因子的平滑过渡
 * 使用Logistic函数实现S曲线
 * 
 * @param progress 进度值 (0-1)
 * @param steepness 曲线陡峭度，默认6
 * @returns 调整后的因子值 (0-1)
 */
function marketCurve(progress: number, steepness: number = 6): number {
  // Logistic函数: 1 / (1 + e^(-k*(x-0.5)))
  // 将输入从[0,1]映射到[-0.5,0.5]，输出也在[0,1]范围
  const x = progress - 0.5;
  const result = 1 / (1 + Math.exp(-steepness * x));
  
  // 归一化到[0,1]范围
  const minVal = 1 / (1 + Math.exp(steepness * 0.5));
  const maxVal = 1 / (1 + Math.exp(-steepness * 0.5));
  
  return (result - minVal) / (maxVal - minVal);
}

// ==================== 核心函数 ====================

/**
 * 获取优化目标的学习状态
 */
export async function getLearningStatus(performanceGroupId: number): Promise<LearningStatus | null> {
  const db = await getDb();
  if (!db) return null;
  
  // 获取绩效组信息
  const [group] = await db
    .select()
    .from(performanceGroups)
    .where(eq(performanceGroups.id, performanceGroupId))
    .limit(1);
  
  if (!group) {
    return null;
  }
  
  // 获取数据充分性指标
  const metrics = await calculateDataSufficiencyMetrics(performanceGroupId, group.accountId);
  
  // 计算数据充分性评分
  const score = calculateDataSufficiencyScore(metrics);
  
  // 判定当前阶段
  const stage = determineStage(metrics, score, group);
  
  // 计算调整因子
  const adjustmentFactor = calculateAdjustmentFactor(stage, metrics, group);
  
  // 计算预期成熟日期
  const expectedMatureDate = calculateExpectedMatureDate(stage, metrics, group);
  
  // 检查是否为大促期间或季节性品类
  const isPromotionPeriod = checkPromotionPeriod();
  const isSeasonalCategory = false; // 季节性品类检查已移除
  
  return {
    performanceGroupId,
    accountId: group.accountId,
    currentStage: stage,
    stageStartDate: new Date(group.createdAt),
    expectedMatureDate,
    dataSufficiencyScore: score,
    dataDays: metrics.dataDays,
    totalClicks: metrics.totalClicks,
    totalConversions: metrics.totalConversions,
    activeKeywords: metrics.activeKeywords,
    dataContinuity: metrics.dataContinuity,
    adjustmentFactor,
    isPaused: group.status === "paused",
    pauseReason: group.status === "paused" ? "用户暂停" : null,
    isPromotionPeriod,
    isSeasonalCategory,
  };
}

/**
 * 计算数据充分性指标
 */
async function calculateDataSufficiencyMetrics(
  performanceGroupId: number,
  accountId: number
): Promise<DataSufficiencyMetrics> {
  const db = await getDb();
  if (!db) {
    return {
      dataDays: 0,
      totalClicks: 0,
      totalConversions: 0,
      activeKeywords: 0,
      dataContinuity: 0,
    };
  }
  
  // 获取关联的广告活动ID
  const campaignList = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(eq(campaigns.performanceGroupId, performanceGroupId));
  
  const campaignIds = campaignList.map(c => c.id);
  
  if (campaignIds.length === 0) {
    return {
      dataDays: 0,
      totalClicks: 0,
      totalConversions: 0,
      activeKeywords: 0,
      dataContinuity: 0,
    };
  }
  
  // 计算数据天数和汇总指标
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  
  const performanceData = await db
    .select({
      distinctDays: countDistinct(dailyPerformance.date),
      totalClicks: sql<number>`COALESCE(SUM(${dailyPerformance.clicks}), 0)`,
      totalConversions: sql<number>`COALESCE(SUM(${dailyPerformance.conversions}), 0)`,
    })
    .from(dailyPerformance)
    .where(
      and(
        sql`${dailyPerformance.campaignId} IN (${sql.join(campaignIds.map(id => sql`${id}`), sql`, `)})`,
        gte(dailyPerformance.date, thirtyDaysAgo.toISOString().split('T')[0])
      )
    );
  
  const dataDays = Number(performanceData[0]?.distinctDays || 0);
  const totalClicks = Number(performanceData[0]?.totalClicks || 0);
  const totalConversions = Number(performanceData[0]?.totalConversions || 0);
  
  // 计算活跃关键词数（有点击的关键词）
  const keywordData = await db
    .select({
      activeCount: count(),
    })
    .from(keywords)
    .where(
      and(
        sql`${keywords.adGroupId} IN (SELECT id FROM ad_groups WHERE campaign_id IN (${sql.join(campaignIds.map(id => sql`${id}`), sql`, `)}))`,
        sql`${keywords.clicks} > 0`
      )
    );
  
  const activeKeywords = Number(keywordData[0]?.activeCount || 0);
  
  // 计算数据连续性（有数据的天数 / 总天数）
  const dataContinuity = dataDays > 0 ? Math.min(dataDays / 30, 1) : 0;
  
  return {
    dataDays,
    totalClicks,
    totalConversions,
    activeKeywords,
    dataContinuity,
  };
}

/**
 * 计算数据充分性评分 (0-100)
 */
function calculateDataSufficiencyScore(metrics: DataSufficiencyMetrics): number {
  const thresholds = DATA_THRESHOLDS.MATURE;
  const weights = DATA_THRESHOLDS.WEIGHTS;
  
  // 计算各指标达成率
  const dataDaysRate = Math.min(metrics.dataDays / thresholds.dataDays, 1);
  const clicksRate = Math.min(metrics.totalClicks / thresholds.totalClicks, 1);
  const conversionsRate = Math.min(metrics.totalConversions / thresholds.totalConversions, 1);
  const keywordsRate = Math.min(metrics.activeKeywords / thresholds.activeKeywords, 1);
  const continuityRate = Math.min(metrics.dataContinuity / thresholds.dataContinuity, 1);
  
  // 加权计算总分
  const score = (
    dataDaysRate * weights.dataDays +
    clicksRate * weights.totalClicks +
    conversionsRate * weights.totalConversions +
    keywordsRate * weights.activeKeywords +
    continuityRate * weights.dataContinuity
  ) * 100;
  
  return Math.round(score * 100) / 100;
}

/**
 * 判定当前阶段
 */
function determineStage(
  metrics: DataSufficiencyMetrics,
  score: number,
  group: any
): LearningStage {
  const createdAt = new Date(group.createdAt);
  const now = new Date();
  const daysSinceCreation = Math.floor((now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24));
  
  // 获取调整后的阶段时长
  const coldStartDuration = getAdjustedColdStartDuration(group);
  const learningDuration = getAdjustedLearningDuration(group);
  
  // 基于时间和评分双重判定
  if (daysSinceCreation < coldStartDuration) {
    return "cold_start";
  }
  
  if (daysSinceCreation < coldStartDuration + learningDuration) {
    // 在学习期时间范围内，但如果评分已达标可提前进入成熟期
    if (score >= 71) {
      return "mature";
    }
    return "learning";
  }
  
  // 超过学习期时间，但评分不足仍停留在学习期
  if (score < 71) {
    return "learning";
  }
  
  return "mature";
}

/**
 * 获取调整后的冷启动期时长
 */
function getAdjustedColdStartDuration(group: any): number {
  let duration = STAGE_DURATION.COLD_START;
  
  // 大促期间缩短
  if (checkPromotionPeriod()) {
    duration = Math.ceil(duration * PROMOTION_REDUCTION_FACTOR);
  }
  
  return duration;
}

/**
 * 获取调整后的学习期时长
 */
function getAdjustedLearningDuration(group: any): number {
  let duration = STAGE_DURATION.LEARNING;
  
  // 大促期间缩短
  if (checkPromotionPeriod()) {
    duration = Math.ceil(duration * PROMOTION_REDUCTION_FACTOR);
  }
  
  // 季节性品类延长
  if (group.isSeasonalCategory === 1) {
    duration = Math.ceil(duration * SEASONAL_EXTENSION_FACTOR);
  }
  
  return duration;
}

/**
 * 检查是否为大促期间
 */
function checkPromotionPeriod(): boolean {
  const now = new Date();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  
  // Prime Day (通常7月中旬)
  if (month === 7 && day >= 10 && day <= 20) {
    return true;
  }
  
  // 黑五 (11月第四个周四及之后几天)
  if (month === 11 && day >= 20 && day <= 30) {
    return true;
  }
  
  // 网一 (黑五后的周一)
  if (month === 12 && day >= 1 && day <= 5) {
    return true;
  }
  
  // 圣诞季
  if (month === 12 && day >= 15 && day <= 25) {
    return true;
  }
  
  return false;
}

/**
 * 计算调整因子（使用市场曲线/S曲线）
 */
function calculateAdjustmentFactor(
  stage: LearningStage,
  metrics: DataSufficiencyMetrics,
  group: any
): number {
  if (stage === "cold_start") {
    return 0;
  }
  
  if (stage === "mature") {
    return 1;
  }
  
  // 学习期：使用市场曲线（S曲线）计算调整因子
  const createdAt = new Date(group.createdAt);
  const now = new Date();
  const daysSinceCreation = Math.floor((now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24));
  
  const coldStartDuration = getAdjustedColdStartDuration(group);
  const learningDuration = getAdjustedLearningDuration(group);
  
  // 计算学习期内的进度 (0-1)
  const daysInLearning = daysSinceCreation - coldStartDuration;
  const progress = Math.min(Math.max(daysInLearning / learningDuration, 0), 1);
  
  // 使用市场曲线（S曲线）计算调整因子
  // 基础因子从0.5开始，通过S曲线平滑过渡到1.0
  const baseFactor = 0.5;
  const curveValue = marketCurve(progress);
  
  return baseFactor + (1 - baseFactor) * curveValue;
}

/**
 * 计算预期成熟日期
 */
function calculateExpectedMatureDate(
  stage: LearningStage,
  metrics: DataSufficiencyMetrics,
  group: any
): Date | null {
  if (stage === "mature") {
    return null;
  }
  
  const createdAt = new Date(group.createdAt);
  const coldStartDuration = getAdjustedColdStartDuration(group);
  const learningDuration = getAdjustedLearningDuration(group);
  
  const expectedDate = new Date(createdAt);
  expectedDate.setDate(expectedDate.getDate() + coldStartDuration + learningDuration);
  
  return expectedDate;
}

/**
 * 获取调整后的安全边界
 */
export function getAdjustedLimits(learningStatus: LearningStatus): AdjustedLimits {
  const factor = learningStatus.adjustmentFactor;
  
  return {
    budget: {
      maxIncrease: BASE_SAFETY_LIMITS.BUDGET.MAX_INCREASE_PERCENT * factor,
      maxDecrease: BASE_SAFETY_LIMITS.BUDGET.MAX_DECREASE_PERCENT * factor,
    },
    bid: {
      maxIncrease: BASE_SAFETY_LIMITS.BID.MAX_INCREASE_PERCENT * factor,
      maxDecrease: BASE_SAFETY_LIMITS.BID.MAX_DECREASE_PERCENT * factor,
    },
    placement: {
      maxIncrease: BASE_SAFETY_LIMITS.PLACEMENT.MAX_INCREASE_PERCENT * factor,
      maxDecrease: BASE_SAFETY_LIMITS.PLACEMENT.MAX_DECREASE_PERCENT * factor,
      absoluteMax: BASE_SAFETY_LIMITS.PLACEMENT.ABSOLUTE_MAX,
    },
    ngram: {
      // N-Gram阈值在学习期加倍（factor越小阈值越高）
      minFrequency: Math.ceil(BASE_NGRAM_THRESHOLDS.MIN_FREQUENCY / Math.max(factor, 0.5)),
      minSpend: BASE_NGRAM_THRESHOLDS.MIN_SPEND / Math.max(factor, 0.5),
    },
    migration: {
      // 迁移置信度阈值在学习期提高
      confidenceThreshold: BASE_MIGRATION_CONFIDENCE + (1 - factor) * 0.2,
    },
  };
}

/**
 * 获取阶段显示名称
 */
export function getStageName(stage: LearningStage): string {
  const names: Record<LearningStage, string> = {
    cold_start: "冷启动期",
    learning: "学习期",
    mature: "成熟期",
  };
  return names[stage];
}

/**
 * 获取阶段描述
 */
export function getStageDescription(stage: LearningStage): string {
  const descriptions: Record<LearningStage, string> = {
    cold_start: "系统正在收集基础数据，暂不进行自动优化调整",
    learning: "系统正在学习广告表现模式，采用保守优化策略",
    mature: "数据充分，系统已启用全部优化功能",
  };
  return descriptions[stage];
}

/**
 * 检查是否允许执行特定优化操作
 */
export function canExecuteOptimization(
  learningStatus: LearningStatus,
  operationType: "budget" | "bid" | "placement" | "ngram" | "migration"
): { allowed: boolean; reason?: string } {
  if (learningStatus.isPaused) {
    return { allowed: false, reason: "优化目标已暂停" };
  }
  
  if (learningStatus.currentStage === "cold_start") {
    return { 
      allowed: false, 
      reason: `当前处于冷启动期，${operationType}优化功能暂未启用` 
    };
  }
  
  return { allowed: true };
}

/**
 * 获取所有优化目标的学习状态
 */
export async function getAllLearningStatuses(accountId?: number): Promise<LearningStatus[]> {
  const db = await getDb();
  if (!db) return [];
  
  let query = db.select().from(performanceGroups);
  
  if (accountId) {
    query = query.where(eq(performanceGroups.accountId, accountId)) as any;
  }
  
  const groups = await query;
  
  const statuses: LearningStatus[] = [];
  for (const group of groups) {
    const status = await getLearningStatus(group.id);
    if (status) {
      statuses.push(status);
    }
  }
  
  return statuses;
}

/**
 * 获取学习期进度百分比
 */
export function getLearningProgress(learningStatus: LearningStatus): number {
  const { currentStage, dataSufficiencyScore } = learningStatus;
  
  if (currentStage === "mature") {
    return 100;
  }
  
  if (currentStage === "cold_start") {
    // 冷启动期进度基于时间
    const createdAt = learningStatus.stageStartDate;
    const now = new Date();
    const daysSinceCreation = Math.floor((now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24));
    return Math.min((daysSinceCreation / STAGE_DURATION.COLD_START) * 30, 30);
  }
  
  // 学习期进度基于评分
  // 30-70分对应30%-100%进度
  return Math.min(30 + (dataSufficiencyScore - 30) * (70 / 40), 100);
}
