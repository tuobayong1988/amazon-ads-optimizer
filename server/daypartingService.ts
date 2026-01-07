/**
 * Dayparting Service - 分时预算和竞价服务
 * 实现基于历史数据的智能分时预算分配和出价调整
 */

import { eq, and, gte, lte, sql, desc } from "drizzle-orm";
import { getDb } from "./db";
import {
  hourlyPerformance,
  daypartingStrategies,
  daypartingBudgetRules,
  hourpartingBidRules,
  daypartingExecutionLogs,
  campaigns,
  dailyPerformance,
} from "../drizzle/schema";
import { InferInsertModel } from "drizzle-orm";

type InsertHourlyPerformance = InferInsertModel<typeof hourlyPerformance>;
type InsertDaypartingStrategy = InferInsertModel<typeof daypartingStrategies>;
type InsertDaypartingBudgetRule = InferInsertModel<typeof daypartingBudgetRules>;
type InsertHourpartingBidRule = InferInsertModel<typeof hourpartingBidRules>;
type InsertDaypartingExecutionLog = InferInsertModel<typeof daypartingExecutionLogs>;

// 星期几标签
export const DAY_OF_WEEK_LABELS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

// 小时标签
export const HOUR_LABELS = Array.from({ length: 24 }, (_, i) => `${i.toString().padStart(2, "0")}:00`);

// ==================== 数据分析函数 ====================

/**
 * 分析广告活动的每周每天表现
 * 返回每天的平均花费、销售额、ACoS、ROAS等指标
 */
export async function analyzeWeeklyPerformance(
  campaignId: number,
  lookbackDays: number = 30
): Promise<{
  dayOfWeek: number;
  dayLabel: string;
  avgSpend: number;
  avgSales: number;
  avgAcos: number;
  avgRoas: number;
  avgClicks: number;
  avgImpressions: number;
  dataPoints: number;
  performanceScore: number; // 综合表现评分 (0-100)
}[]> {
  const db = await getDb();
  if (!db) return [];

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - lookbackDays);

  // 从daily_performance表获取数据并按星期几分组
  const result = await db
    .select({
      dayOfWeek: sql<number>`DAYOFWEEK(${dailyPerformance.date}) - 1`, // MySQL DAYOFWEEK返回1-7，转为0-6
      avgSpend: sql<string>`AVG(${dailyPerformance.spend})`,
      avgSales: sql<string>`AVG(${dailyPerformance.sales})`,
      avgClicks: sql<string>`AVG(${dailyPerformance.clicks})`,
      avgImpressions: sql<string>`AVG(${dailyPerformance.impressions})`,
      dataPoints: sql<number>`COUNT(*)`,
    })
    .from(dailyPerformance)
    .where(
      and(
        eq(dailyPerformance.campaignId, campaignId),
        sql`${dailyPerformance.date} >= ${startDate.toISOString()}`
      )
    )
    .groupBy(sql`DAYOFWEEK(${dailyPerformance.date})`);

  return result.map((row) => {
    const avgSpend = parseFloat(row.avgSpend || "0");
    const avgSales = parseFloat(row.avgSales || "0");
    const avgAcos = avgSales > 0 ? (avgSpend / avgSales) * 100 : 0;
    const avgRoas = avgSpend > 0 ? avgSales / avgSpend : 0;

    // 计算综合表现评分 (基于ROAS，满分100)
    const performanceScore = Math.min(100, Math.max(0, avgRoas * 25));

    return {
      dayOfWeek: row.dayOfWeek,
      dayLabel: DAY_OF_WEEK_LABELS[row.dayOfWeek] || `Day ${row.dayOfWeek}`,
      avgSpend,
      avgSales,
      avgAcos,
      avgRoas,
      avgClicks: parseFloat(row.avgClicks || "0"),
      avgImpressions: parseFloat(row.avgImpressions || "0"),
      dataPoints: row.dataPoints,
      performanceScore,
    };
  });
}

/**
 * 分析广告活动的每小时表现
 * 返回每天每小时的平均表现数据
 */
export async function analyzeHourlyPerformance(
  campaignId: number,
  lookbackDays: number = 30
): Promise<{
  dayOfWeek: number;
  hour: number;
  avgSpend: number;
  avgSales: number;
  avgClicks: number;
  avgCvr: number;
  avgCpc: number;
  avgAcos: number;
  dataPoints: number;
  performanceScore: number;
}[]> {
  const db = await getDb();
  if (!db) return [];

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - lookbackDays);

  // 从hourly_performance表获取数据
  const result = await db
    .select({
      dayOfWeek: hourlyPerformance.dayOfWeek,
      hour: hourlyPerformance.hour,
      avgSpend: sql<string>`AVG(${hourlyPerformance.spend})`,
      avgSales: sql<string>`AVG(${hourlyPerformance.sales})`,
      avgClicks: sql<string>`AVG(${hourlyPerformance.clicks})`,
      avgOrders: sql<string>`AVG(${hourlyPerformance.orders})`,
      dataPoints: sql<number>`COUNT(*)`,
    })
    .from(hourlyPerformance)
    .where(
      and(
        eq(hourlyPerformance.campaignId, campaignId),
        gte(hourlyPerformance.date, startDate.toISOString().split('T')[0])
      )
    )
    .groupBy(hourlyPerformance.dayOfWeek, hourlyPerformance.hour);

  return result.map((row) => {
    const avgSpend = parseFloat(row.avgSpend || "0");
    const avgSales = parseFloat(row.avgSales || "0");
    const avgClicks = parseFloat(row.avgClicks || "0");
    const avgOrders = parseFloat(row.avgOrders || "0");
    const avgCvr = avgClicks > 0 ? (avgOrders / avgClicks) * 100 : 0;
    const avgCpc = avgClicks > 0 ? avgSpend / avgClicks : 0;
    const avgAcos = avgSales > 0 ? (avgSpend / avgSales) * 100 : 0;
    const avgRoas = avgSpend > 0 ? avgSales / avgSpend : 0;

    // 综合表现评分
    const performanceScore = Math.min(100, Math.max(0, avgRoas * 25));

    return {
      dayOfWeek: row.dayOfWeek,
      hour: row.hour,
      avgSpend,
      avgSales,
      avgClicks,
      avgCvr,
      avgCpc,
      avgAcos,
      dataPoints: row.dataPoints,
      performanceScore,
    };
  });
}

/**
 * 计算最优分时预算分配
 * 基于历史表现数据，计算每天的最优预算倍数
 */
export function calculateOptimalBudgetAllocation(
  weeklyData: Awaited<ReturnType<typeof analyzeWeeklyPerformance>>,
  options: {
    optimizationGoal: "maximize_sales" | "target_acos" | "target_roas" | "minimize_acos";
    targetAcos?: number;
    targetRoas?: number;
    maxMultiplier?: number;
    minMultiplier?: number;
  } = { optimizationGoal: "maximize_sales" }
): {
  dayOfWeek: number;
  budgetMultiplier: number;
  budgetPercentage: number;
  reason: string;
}[] {
  const { optimizationGoal, targetAcos, targetRoas, maxMultiplier = 2.0, minMultiplier = 0.2 } = options;

  // 计算每天的表现得分
  const scores = weeklyData.map((day) => {
    let score = 0;
    switch (optimizationGoal) {
      case "maximize_sales":
        score = day.avgRoas; // ROAS越高越好
        break;
      case "target_acos":
        // 越接近目标ACoS越好
        score = targetAcos ? 100 - Math.abs(day.avgAcos - targetAcos) : day.avgRoas * 25;
        break;
      case "target_roas":
        // 越接近目标ROAS越好
        score = targetRoas ? 100 - Math.abs(day.avgRoas - targetRoas) * 10 : day.avgRoas * 25;
        break;
      case "minimize_acos":
        score = day.avgAcos > 0 ? 100 / day.avgAcos : 0; // ACoS越低越好
        break;
    }
    return { ...day, score: Math.max(0, score) };
  });

  // 计算总分
  const totalScore = scores.reduce((sum, day) => sum + day.score, 0);
  const avgScore = totalScore / scores.length || 1;

  // 计算每天的预算倍数
  return scores.map((day) => {
    // 基于相对表现计算倍数
    let multiplier = day.score / avgScore;

    // 限制在允许范围内
    multiplier = Math.max(minMultiplier, Math.min(maxMultiplier, multiplier));

    // 计算占周预算百分比
    const budgetPercentage = (multiplier / 7) * 100;

    // 生成原因说明
    let reason = "";
    if (multiplier > 1.2) {
      reason = `${day.dayLabel}表现优异，建议增加预算`;
    } else if (multiplier < 0.8) {
      reason = `${day.dayLabel}表现较弱，建议减少预算`;
    } else {
      reason = `${day.dayLabel}表现正常，维持标准预算`;
    }

    return {
      dayOfWeek: day.dayOfWeek,
      budgetMultiplier: Math.round(multiplier * 100) / 100,
      budgetPercentage: Math.round(budgetPercentage * 100) / 100,
      reason,
    };
  });
}

/**
 * 计算最优分时竞价调整
 * 基于每小时的表现数据，计算出价倍数
 */
export function calculateOptimalBidAdjustments(
  hourlyData: Awaited<ReturnType<typeof analyzeHourlyPerformance>>,
  options: {
    optimizationGoal: "maximize_sales" | "target_acos" | "target_roas" | "minimize_acos";
    targetAcos?: number;
    targetRoas?: number;
    maxMultiplier?: number;
    minMultiplier?: number;
  } = { optimizationGoal: "maximize_sales" }
): {
  dayOfWeek: number;
  hour: number;
  bidMultiplier: number;
  reason: string;
}[] {
  const { optimizationGoal, targetAcos, targetRoas, maxMultiplier = 2.0, minMultiplier = 0.2 } = options;

  // 计算每小时的表现得分
  const scores = hourlyData.map((hourData) => {
    let score = 0;
    const avgRoas = hourData.avgSpend > 0 ? hourData.avgSales / hourData.avgSpend : 0;

    switch (optimizationGoal) {
      case "maximize_sales":
        // 综合考虑转化率和ROAS
        score = hourData.avgCvr * 10 + avgRoas * 20;
        break;
      case "target_acos":
        score = targetAcos ? 100 - Math.abs(hourData.avgAcos - targetAcos) : avgRoas * 25;
        break;
      case "target_roas":
        score = targetRoas ? 100 - Math.abs(avgRoas - targetRoas) * 10 : avgRoas * 25;
        break;
      case "minimize_acos":
        score = hourData.avgAcos > 0 ? 100 / hourData.avgAcos : 0;
        break;
    }
    return { ...hourData, score: Math.max(0, score) };
  });

  // 计算平均分
  const avgScore = scores.reduce((sum, h) => sum + h.score, 0) / scores.length || 1;

  // 计算每小时的出价倍数
  return scores.map((hourData) => {
    let multiplier = hourData.score / avgScore;
    multiplier = Math.max(minMultiplier, Math.min(maxMultiplier, multiplier));

    let reason = "";
    if (multiplier > 1.3) {
      reason = "高转化时段，建议提高出价";
    } else if (multiplier < 0.7) {
      reason = "低效时段，建议降低出价";
    } else {
      reason = "正常时段，维持标准出价";
    }

    return {
      dayOfWeek: hourData.dayOfWeek,
      hour: hourData.hour,
      bidMultiplier: Math.round(multiplier * 100) / 100,
      reason,
    };
  });
}

/**
 * 计算分时广告位置倾斜比例
 * 基于不同时段各广告位的表现，计算最优位置出价调整
 */
export function calculateOptimalPlacementAdjustments(
  hourlyData: Awaited<ReturnType<typeof analyzeHourlyPerformance>>,
  placementData: {
    placement: string;
    hourlyStats: {
      hour: number;
      dayOfWeek: number;
      clicks: number;
      spend: number;
      sales: number;
      orders: number;
    }[];
  }[]
): {
  placement: string;
  placementLabel: string;
  hourlyAdjustments: {
    dayOfWeek: number;
    hour: number;
    adjustmentPercent: number; // -90% to +900%
    reason: string;
  }[];
  avgAdjustment: number;
}[] {
  const placementLabels: Record<string, string> = {
    top_of_search: "搜索结果顶部",
    product_page: "商品页面",
    rest_of_search: "搜索结果其他位置",
  };

  return placementData.map((placement) => {
    // 计算每个时段的位置表现
    const hourlyAdjustments = placement.hourlyStats.map((stat) => {
      const roas = stat.spend > 0 ? stat.sales / stat.spend : 0;
      const cvr = stat.clicks > 0 ? stat.orders / stat.clicks : 0;

      // 基于ROAS和CVR计算调整比例
      // 基准：ROAS=3, CVR=10%
      const roasScore = roas / 3;
      const cvrScore = cvr / 0.1;
      const combinedScore = (roasScore + cvrScore) / 2;

      // 转换为调整百分比 (-90% to +900%)
      let adjustmentPercent = (combinedScore - 1) * 100;
      adjustmentPercent = Math.max(-90, Math.min(900, adjustmentPercent));

      let reason = "";
      if (adjustmentPercent > 50) {
        reason = "该时段位置表现优异，建议大幅提高位置出价";
      } else if (adjustmentPercent > 0) {
        reason = "该时段位置表现良好，建议适当提高位置出价";
      } else if (adjustmentPercent > -50) {
        reason = "该时段位置表现一般，建议适当降低位置出价";
      } else {
        reason = "该时段位置表现较差，建议大幅降低位置出价";
      }

      return {
        dayOfWeek: stat.dayOfWeek,
        hour: stat.hour,
        adjustmentPercent: Math.round(adjustmentPercent),
        reason,
      };
    });

    // 计算平均调整比例
    const avgAdjustment =
      hourlyAdjustments.reduce((sum, h) => sum + h.adjustmentPercent, 0) /
      hourlyAdjustments.length || 0;

    return {
      placement: placement.placement,
      placementLabel: placementLabels[placement.placement] || placement.placement,
      hourlyAdjustments,
      avgAdjustment: Math.round(avgAdjustment),
    };
  });
}

// ==================== 策略管理函数 ====================

/**
 * 创建分时策略
 */
export async function createDaypartingStrategy(data: InsertDaypartingStrategy) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(daypartingStrategies).values(data);
  return result[0].insertId;
}

/**
 * 获取账号的所有分时策略
 */
export async function getDaypartingStrategies(accountId: number) {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(daypartingStrategies)
    .where(eq(daypartingStrategies.accountId, accountId))
    .orderBy(desc(daypartingStrategies.updatedAt));
}

/**
 * 获取单个分时策略详情
 */
export async function getDaypartingStrategy(strategyId: number) {
  const db = await getDb();
  if (!db) return null;

  const result = await db
    .select()
    .from(daypartingStrategies)
    .where(eq(daypartingStrategies.id, strategyId))
    .limit(1);
  return result[0] || null;
}

/**
 * 更新分时策略
 */
export async function updateDaypartingStrategy(
  strategyId: number,
  data: Partial<InsertDaypartingStrategy>
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(daypartingStrategies)
    .set(data)
    .where(eq(daypartingStrategies.id, strategyId));
}

/**
 * 保存分时预算规则
 */
export async function saveBudgetRules(
  strategyId: number,
  rules: Omit<InsertDaypartingBudgetRule, "strategyId">[]
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // 删除旧规则
  await db
    .delete(daypartingBudgetRules)
    .where(eq(daypartingBudgetRules.strategyId, strategyId));

  // 插入新规则
  if (rules.length > 0) {
    await db.insert(daypartingBudgetRules).values(
      rules.map((rule) => ({ ...rule, strategyId }))
    );
  }
}

/**
 * 获取分时预算规则
 */
export async function getBudgetRules(strategyId: number) {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(daypartingBudgetRules)
    .where(eq(daypartingBudgetRules.strategyId, strategyId))
    .orderBy(daypartingBudgetRules.dayOfWeek);
}

/**
 * 保存分时竞价规则
 */
export async function saveBidRules(
  strategyId: number,
  rules: Omit<InsertHourpartingBidRule, "strategyId">[]
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // 删除旧规则
  await db
    .delete(hourpartingBidRules)
    .where(eq(hourpartingBidRules.strategyId, strategyId));

  // 插入新规则
  if (rules.length > 0) {
    await db.insert(hourpartingBidRules).values(
      rules.map((rule) => ({ ...rule, strategyId }))
    );
  }
}

/**
 * 获取分时竞价规则
 */
export async function getBidRules(strategyId: number) {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(hourpartingBidRules)
    .where(eq(hourpartingBidRules.strategyId, strategyId))
    .orderBy(hourpartingBidRules.dayOfWeek, hourpartingBidRules.hour);
}

/**
 * 记录策略执行日志
 */
export async function logStrategyExecution(data: InsertDaypartingExecutionLog) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.insert(daypartingExecutionLogs).values(data);
}

/**
 * 获取策略执行历史
 */
export async function getExecutionLogs(strategyId: number, limit: number = 50) {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(daypartingExecutionLogs)
    .where(eq(daypartingExecutionLogs.strategyId, strategyId))
    .orderBy(desc(daypartingExecutionLogs.executedAt))
    .limit(limit);
}

// ==================== 一键生成最优策略 ====================

/**
 * 分析并生成最优分时策略
 */
export async function generateOptimalStrategy(
  accountId: number,
  campaignId: number,
  options: {
    name: string;
    optimizationGoal: "maximize_sales" | "target_acos" | "target_roas" | "minimize_acos";
    targetAcos?: number;
    targetRoas?: number;
    lookbackDays?: number;
  }
) {
  // 1. 分析每周每天表现
  const weeklyData = await analyzeWeeklyPerformance(campaignId, options.lookbackDays || 30);

  // 2. 分析每小时表现
  const hourlyData = await analyzeHourlyPerformance(campaignId, options.lookbackDays || 30);

  // 3. 计算最优预算分配
  const budgetAllocation = calculateOptimalBudgetAllocation(weeklyData, {
    optimizationGoal: options.optimizationGoal,
    targetAcos: options.targetAcos,
    targetRoas: options.targetRoas,
  });

  // 4. 计算最优出价调整
  const bidAdjustments = calculateOptimalBidAdjustments(hourlyData, {
    optimizationGoal: options.optimizationGoal,
    targetAcos: options.targetAcos,
    targetRoas: options.targetRoas,
  });

  // 5. 创建策略
  const strategyId = await createDaypartingStrategy({
    accountId,
    campaignId,
    name: options.name,
    strategyType: "both",
    daypartingOptGoal: options.optimizationGoal,
    daypartingTargetAcos: options.targetAcos?.toString(),
    daypartingTargetRoas: options.targetRoas?.toString(),
    analysisLookbackDays: options.lookbackDays || 30,
    daypartingStatus: "draft",
    lastAnalyzedAt: new Date().toISOString(),
  });

  // 6. 保存预算规则
  await saveBudgetRules(
    strategyId,
    budgetAllocation.map((rule) => ({
      dayOfWeek: rule.dayOfWeek,
      budgetMultiplier: rule.budgetMultiplier.toString(),
      budgetPercentage: rule.budgetPercentage.toString(),
      avgSpend: weeklyData.find((d) => d.dayOfWeek === rule.dayOfWeek)?.avgSpend.toString(),
      avgSales: weeklyData.find((d) => d.dayOfWeek === rule.dayOfWeek)?.avgSales.toString(),
      avgAcos: weeklyData.find((d) => d.dayOfWeek === rule.dayOfWeek)?.avgAcos.toString(),
      avgRoas: weeklyData.find((d) => d.dayOfWeek === rule.dayOfWeek)?.avgRoas.toString(),
      dataPoints: weeklyData.find((d) => d.dayOfWeek === rule.dayOfWeek)?.dataPoints || 0,
      isEnabled: 1,
    }))
  );

  // 7. 保存竞价规则
  await saveBidRules(
    strategyId,
    bidAdjustments.map((rule) => ({
      dayOfWeek: rule.dayOfWeek,
      hour: rule.hour,
      bidMultiplier: rule.bidMultiplier.toString(),
      avgClicks: hourlyData.find((h) => h.dayOfWeek === rule.dayOfWeek && h.hour === rule.hour)?.avgClicks.toString(),
      avgSpend: hourlyData.find((h) => h.dayOfWeek === rule.dayOfWeek && h.hour === rule.hour)?.avgSpend.toString(),
      avgSales: hourlyData.find((h) => h.dayOfWeek === rule.dayOfWeek && h.hour === rule.hour)?.avgSales.toString(),
      avgCvr: hourlyData.find((h) => h.dayOfWeek === rule.dayOfWeek && h.hour === rule.hour)?.avgCvr.toString(),
      avgCpc: hourlyData.find((h) => h.dayOfWeek === rule.dayOfWeek && h.hour === rule.hour)?.avgCpc.toString(),
      avgAcos: hourlyData.find((h) => h.dayOfWeek === rule.dayOfWeek && h.hour === rule.hour)?.avgAcos.toString(),
      dataPoints: hourlyData.find((h) => h.dayOfWeek === rule.dayOfWeek && h.hour === rule.hour)?.dataPoints || 0,
      isEnabled: 1,
    }))
  );

  return {
    strategyId,
    weeklyAnalysis: weeklyData,
    hourlyAnalysis: hourlyData,
    budgetAllocation,
    bidAdjustments,
  };
}


/**
 * 获取指定时间的分时规则
 */
export async function getHourlyRule(
  strategyId: number,
  dayOfWeek: number,
  hour: number
): Promise<any | null> {
  const bidRules = await getBidRules(strategyId);
  const rule = bidRules.find(r => r.dayOfWeek === dayOfWeek && r.hour === hour);
  
  if (!rule) return null;
  
  return {
    dayOfWeek: rule.dayOfWeek,
    hour: rule.hour,
    bidMultiplier: parseFloat(rule.bidMultiplier || '1'),
    isEnabled: (rule as any).ruleEnabled ?? true
  };
}
