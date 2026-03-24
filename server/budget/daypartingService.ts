import { createModuleLogger } from '../utils/logger';
const log = createModuleLogger('DaypartingService');
/**
 * Dayparting Service - 分时预算和竞价服务
 * 实现基于历史数据的智能分时预算分配和出价调整
 */

import { eq, and, gte, lte, sql, desc, type InferInsertModel } from "drizzle-orm";
import { getDb } from "../db";
import { MARKETPLACE_TIMEZONES, getLocalHour, getLocalDayOfWeek, getTimeSlotIndex, convertToLocalTime } from "../algorithm/algorithmUtils";
import {
  hourlyPerformance,
  daypartingStrategies,
  daypartingBudgetRules,
  hourpartingBidRules,
  daypartingExecutionLogs,
  campaigns,
  dailyPerformance,
} from "../../drizzle/schema";

type InsertHourlyPerformance = InferInsertModel<typeof hourlyPerformance>;
type InsertDaypartingStrategy = InferInsertModel<typeof daypartingStrategies>;
type InsertDaypartingBudgetRule = InferInsertModel<typeof daypartingBudgetRules>;
type InsertHourpartingBidRule = InferInsertModel<typeof hourpartingBidRules>;
type InsertDaypartingExecutionLog = InferInsertModel<typeof daypartingExecutionLogs>;

// 星期几标签
export const DAY_OF_WEEK_LABELS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

// 小时标签
export const HOUR_LABELS = Array.from({ length: 24 }, (_, i) => `${i.toString().padStart(2, "0")}:00`);

// v438: 将本地campaignId转换为Amazon原始ID
// 所有performance表统一存储Amazon原始ID，查询时必须使用Amazon ID
async function resolveAmazonCampaignId(localCampaignId: number): Promise<string> {
  const db = await getDb();
  if (!db) return String(localCampaignId);
  const result = await db.select({ campaignId: campaigns.campaignId }).from(campaigns).where(eq(campaigns.id, localCampaignId)).limit(1);
  return result.length > 0 ? String(result[0].campaignId) : String(localCampaignId);
}

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
        eq(dailyPerformance.campaignId, await resolveAmazonCampaignId(campaignId)),  // v438: 统一使用Amazon ID
        sql`${dailyPerformance.date} >= ${startDate.toISOString()}`
      )
    )
    .groupBy(sql`DAYOFWEEK(${dailyPerformance.date})`);

  return result.map((row: unknown) => {
    // @ts-ignore
    const avgSpend = parseFloat(row.avgSpend || "0");
    // @ts-ignore
    const avgSales = parseFloat(row.avgSales || "0");
    const avgAcos = avgSales > 0 ? (avgSpend / avgSales) * 100 : 0;
    const avgRoas = avgSpend > 0 ? avgSales / avgSpend : 0;

    // 计算综合表现评分 (基于ROAS，满分100)
    const performanceScore = Math.min(100, Math.max(0, avgRoas * 25));

    // @ts-ignore
    return {
      // @ts-ignore
      dayOfWeek: row.dayOfWeek,
      // @ts-ignore
      dayLabel: DAY_OF_WEEK_LABELS[row.dayOfWeek] || `Day ${row.dayOfWeek}`,
      // @ts-ignore
      avgSpend,
      // @ts-ignore
      avgSales,
      // @ts-ignore
      avgAcos,
      avgRoas,
      // @ts-ignore
      avgClicks: parseFloat(row.avgClicks || "0"),
      // @ts-ignore
      avgImpressions: parseFloat(row.avgImpressions || "0"),
      // @ts-ignore
      dataPoints: row.dataPoints,
      performanceScore,
    };
  });
}

/**
 * 归因时差校正配置
 * 专家建议：亚马逊的Hourly Data报告中，Spend/Clicks是基于"点击时间"，
 * 但Sales/Orders往往是基于"购买时间"或存在数小时甚至数天的归因延迟
 */
// v360: 使用动态归因窗口，根据广告类型自动调整
const ATTRIBUTION_DELAY_DAYS = 3; // 默认值，实际使用时应通过getAttributionWindowDays(adType)获取

// ==================== v360: 统一84时间段定义 ====================

/** 
 * v360: 统一时间段定义
 * 将一周划分为84个时间段（每天2小时×7天）
 */
export interface UnifiedTimeSlot {
  slotIndex: number;       // 0-83
  dayOfWeek: number;       // 0-6 (0=周日)
  startHour: number;       // 0,2,4,...,22
  endHour: number;         // 2,4,6,...,24
  label: string;           // 如 "周一 08:00-10:00"
}

/** v360: 每天的时间段数量 */
export const SLOTS_PER_DAY = 12;
/** v360: 总时间段数量 */
export const TOTAL_SLOTS = 84;

/**
 * v360: 生成所有84个统一时间段
 */
export function generateUnifiedTimeSlots(): UnifiedTimeSlot[] {
  const slots: UnifiedTimeSlot[] = [];
  for (let day = 0; day < 7; day++) {
    for (let slot = 0; slot < SLOTS_PER_DAY; slot++) {
      const startHour = slot * 2;
      const endHour = startHour + 2;
      slots.push({
        slotIndex: day * SLOTS_PER_DAY + slot,
        dayOfWeek: day,
        startHour,
        endHour,
        label: `${DAY_OF_WEEK_LABELS[day]} ${startHour.toString().padStart(2, '0')}:00-${endHour.toString().padStart(2, '0')}:00`,
      });
    }
  }
  return slots;
}

/**
 * v360: 根据星期和小时获取统一时间段索引
 */
export function getUnifiedSlotIndex(dayOfWeek: number, hour: number): number {
  return dayOfWeek * SLOTS_PER_DAY + Math.floor(hour / 2);
}

/**
 * v360: 将168小时级数据聚合为84个2小时时间段
 */
export function aggregateHourlyToSlots<T extends { dayOfWeek: number; hour: number }>(
  hourlyData: T[]
): Map<number, T[]> {
  const slotMap = new Map<number, T[]>();
  for (const item of hourlyData) {
    const slotIndex = getUnifiedSlotIndex(item.dayOfWeek, item.hour);
    if (!slotMap.has(slotIndex)) slotMap.set(slotIndex, []);
    slotMap.get(slotIndex)!.push(item);
  }
  return slotMap;
}

/**
 * 分析广告活动的每小时表现
 * 返回每天每小时的平均表现数据
 * 
 * 专家建议优化：
 * 1. 排除最近3天数据，避免归因延迟导致的误判
 * 2. 引入流量热度得分（CTR权重0.6 + Clicks权量0.4）
 * 3. 高热度低转化时段仅轻微降价（保持曝光）
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
  avgCtr: number; // 新增：平均点击率
  avgImpressions: number; // 新增：平均曝光
  trafficScore: number; // 新增：流量热度得分
  dataPoints: number;
  performanceScore: number;
}[]> {
  const db = await getDb();
  if (!db) return [];

  // 专家建议：排除最近3天的数据，避免归因延迟导致的误判
  const endDate = new Date();
  endDate.setDate(endDate.getDate() - ATTRIBUTION_DELAY_DAYS);
  
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - lookbackDays - ATTRIBUTION_DELAY_DAYS);

  // 从hourly_performance表获取数据
  const result = await db
    .select({
      dayOfWeek: hourlyPerformance.dayOfWeek,
      hour: hourlyPerformance.hour,
      avgSpend: sql<string>`AVG(${hourlyPerformance.spend})`,
      avgSales: sql<string>`AVG(${hourlyPerformance.sales})`,
      avgClicks: sql<string>`AVG(${hourlyPerformance.clicks})`,
      avgOrders: sql<string>`AVG(${hourlyPerformance.orders})`,
      avgImpressions: sql<string>`AVG(${hourlyPerformance.impressions})`,
      dataPoints: sql<number>`COUNT(*)`,
    })
    .from(hourlyPerformance)
    .where(
      and(
        eq(hourlyPerformance.campaignId, await resolveAmazonCampaignId(campaignId)),  // v438: 统一使用Amazon ID
        gte(hourlyPerformance.date, startDate.toISOString().split('T')[0]),
        lte(hourlyPerformance.date, endDate.toISOString().split('T')[0]) // 排除最近3天
      )
    )
    // @ts-ignore
    .groupBy(hourlyPerformance.dayOfWeek, hourlyPerformance.hour);

  // 计算最大值用于归一化
  // @ts-ignore
  const maxClicks = Math.max(...result.map(r => parseFloat(r.avgClicks || "0")), 1);
  // @ts-ignore
  const maxImpressions = Math.max(...result.map(r => parseFloat(r.avgImpressions || "0")), 1);

  return result.map((row: unknown) => {
    // @ts-ignore
    const avgSpend = parseFloat(row.avgSpend || "0");
    // @ts-ignore
    const avgSales = parseFloat(row.avgSales || "0");
    // @ts-ignore
    const avgClicks = parseFloat(row.avgClicks || "0");
    // @ts-ignore
    const avgOrders = parseFloat(row.avgOrders || "0");
    // @ts-ignore
    const avgImpressions = parseFloat(row.avgImpressions || "0");
    const avgCvr = avgClicks > 0 ? (avgOrders / avgClicks) * 100 : 0;
    const avgCpc = avgClicks > 0 ? avgSpend / avgClicks : 0;
    const avgAcos = avgSales > 0 ? (avgSpend / avgSales) * 100 : 0;
    const avgRoas = avgSpend > 0 ? avgSales / avgSpend : 0;
    const avgCtr = avgImpressions > 0 ? (avgClicks / avgImpressions) * 100 : 0;

    // 专家建议：流量热度得分 = CTR权重0.6 + Clicks权重0.4
    // 归一化后计算
    // @ts-ignore
    const normalizedClicks = avgClicks / maxClicks;
    // @ts-ignore
    const normalizedCtr = avgCtr / Math.max(...result.map(r => {
      const imp = parseFloat(r.avgImpressions || "0");
      const clk = parseFloat(r.avgClicks || "0");
      return imp > 0 ? (clk / imp) * 100 : 0;
    }), 1);
    const trafficScore = normalizedClicks * 0.4 + normalizedCtr * 0.6;

    // 综合表现评分
    const performanceScore = Math.min(100, Math.max(0, avgRoas * 25));

    // @ts-ignore
    return {
      // @ts-ignore
      dayOfWeek: row.dayOfWeek,
      // @ts-ignore
      hour: row.hour,
      avgSpend,
      avgSales,
      avgClicks,
      avgCvr,
      avgCpc,
      avgAcos,
      avgCtr,
      avgImpressions,
      trafficScore,
      // @ts-ignore
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
    // @ts-ignore
    minMultiplier?: number;
  } = { optimizationGoal: "maximize_sales" }
): {
  dayOfWeek: number;
  // @ts-ignore
  budgetMultiplier: number;
  budgetPercentage: number;
  reason: string;
}[] {
  // @ts-ignore
  const { optimizationGoal, targetAcos, targetRoas, maxMultiplier = 2.0, minMultiplier = 0.2 } = options;

  // 计算每天的表现得分
  // @ts-ignore
  const scores = weeklyData.map((day: unknown) => {
    let score = 0;
    switch (optimizationGoal) {
      // @ts-ignore
      case "maximize_sales":
        // @ts-ignore
        score = day.avgRoas; // ROAS越高越好
        break;
      // @ts-ignore
      case "target_acos":
        // 越接近目标ACoS越好
        // @ts-ignore
        score = targetAcos ? 100 - Math.abs(day.avgAcos - targetAcos) : day.avgRoas * 25;
        break;
      case "target_roas":
        // 越接近目标ROAS越好
        // @ts-ignore
        score = targetRoas ? 100 - Math.abs(day.avgRoas - targetRoas) * 10 : day.avgRoas * 25;
        break;
      case "minimize_acos":
        // @ts-ignore
        score = day.avgAcos > 0 ? 100 / day.avgAcos : 0; // ACoS越低越好
        break;
    }
    // @ts-ignore
    return { ...day, score: Math.max(0, score) };
  // @ts-ignore
  });

  // 计算总分
  // @ts-ignore
  const totalScore = scores.reduce((sum: number, day: Record<string, unknown>) => sum + day.score, 0);
  const avgScore = totalScore / scores.length || 1;

  // 计算每天的预算倍数
  // @ts-ignore
  return scores.map((day: unknown) => {
    // 基于相对表现计算倍数
    // @ts-ignore
    let multiplier = day.score / avgScore;

    // 限制在允许范围内
    multiplier = Math.max(minMultiplier, Math.min(maxMultiplier, multiplier));

    // 计算占周预算百分比
    const budgetPercentage = (multiplier / 7) * 100;

    // 生成原因说明
    let reason = "";
    if (multiplier > 1.2) {
      // @ts-ignore
      reason = `${day.dayLabel}表现优异，建议增加预算`;
    } else if (multiplier < 0.8) {
      // @ts-ignore
      reason = `${day.dayLabel}表现较弱，建议减少预算`;
    } else {
      // @ts-ignore
      reason = `${day.dayLabel}表现正常，维持标准预算`;
    }

    return {
      // @ts-ignore
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
 * 
 * 专家建议优化：
 * - 高热度低转化时段仅轻微降价（保持曝光）
 * - 这些时段可能是黄金"种草"时段，用户点击加购后可能在其他时段付款
 */
export function calculateOptimalBidAdjustments(
  // @ts-ignore
  hourlyData: Awaited<ReturnType<typeof analyzeHourlyPerformance>>,
  options: {
    optimizationGoal: "maximize_sales" | "target_acos" | "target_roas" | "minimize_acos";
    // @ts-ignore
    targetAcos?: number;
    targetRoas?: number;
    maxMultiplier?: number;
    minMultiplier?: number;
  } = { optimizationGoal: "maximize_sales" }
): {
  // @ts-ignore
  dayOfWeek: number;
  hour: number;
  bidMultiplier: number;
  // @ts-ignore
  trafficScore?: number; // 新增：流量热度得分
  isHighTrafficLowConversion?: boolean; // 新增：是否为高热度低转化时段
  reason: string;
}[] {
  // @ts-ignore
  const { optimizationGoal, targetAcos, targetRoas, maxMultiplier = 2.0, minMultiplier = 0.2 } = options;

  // 计算每小时的表现得分
  const scores = hourlyData.map((hourData: unknown) => {
    let score = 0;
    // @ts-ignore
    const avgRoas = hourData.avgSpend > 0 ? hourData.avgSales / hourData.avgSpend : 0;

    switch (optimizationGoal) {
      // @ts-ignore
      case "maximize_sales":
        // 综合考虑转化率和ROAS
        // @ts-ignore
        score = hourData.avgCvr * 10 + avgRoas * 20;
        break;
      case "target_acos":
        // @ts-ignore
        score = targetAcos ? 100 - Math.abs(hourData.avgAcos - targetAcos) : avgRoas * 25;
        break;
      case "target_roas":
        score = targetRoas ? 100 - Math.abs(avgRoas - targetRoas) * 10 : avgRoas * 25;
        break;
      case "minimize_acos":
        // @ts-ignore
        score = hourData.avgAcos > 0 ? 100 / hourData.avgAcos : 0;
        break;
    }
    // @ts-ignore
    return { ...hourData, score: Math.max(0, score) };
  });

  // 计算平均分和平均流量得分
  // @ts-ignore
  const avgScore = scores.reduce((sum: number, h: Record<string, unknown>) => sum + h.score, 0) / scores.length || 1;
  // @ts-ignore
  const avgTrafficScore = scores.reduce((sum: number, h: Record<string, unknown>) => sum + (h.trafficScore || 0), 0) / scores.length || 0.5;

  // 计算每小时的出价倍数
  return scores.map((hourData: unknown) => {
    // @ts-ignore
    let multiplier = hourData.score / avgScore;
    
    // 专家建议：检测高热度低转化时段
    // 如果流量热度高（>0.8）但ROAS低，可能是"种草"时段
    // @ts-ignore
    const trafficScore = hourData.trafficScore || 0;
    // @ts-ignore
    const avgRoas = hourData.avgSpend > 0 ? hourData.avgSales / hourData.avgSpend : 0;
    const targetRoasValue = targetRoas || 2.0; // 默认目标ROAS
    const isHighTrafficLowConversion = trafficScore > 0.8 && avgRoas < targetRoasValue;
    
    // 高热度低转化时段：仅轻微降价，不要重罚
    if (isHighTrafficLowConversion && multiplier < 1) {
      multiplier = Math.max(0.9, multiplier); // 最多降10%，保持曝光
    }
    
    // v351: 彻底重写分时竞价灵敏度算法
    // 根因: hourly_performance是从daily均分生成的，导致小时级差异极小
    // score/avgScore 的偏差通常只有±0.01~0.03，即使放大1.5倍仍然不够
    // 
    // 新算法: 三层级联放大
    // 1. 基础偏差放大: 3.0x（从1.5x提升）
    // 2. 最小偏差保证: 如果放大后偏差仍<0.05，强制设为±0.05
    // 3. 时段特征增强: 根据小时特征（凌晨/高峰/下午）额外调整
    const deviation = multiplier - 1.0;
    let amplifiedDeviation = deviation * 3.0; // 层级1: 3倍放大
    
    // 层级2: 最小偏差保证 - 确保每个时段都有可感知的调整
    // @ts-ignore
    if (Math.abs(amplifiedDeviation) < 0.05 && deviation !== 0) {
      // @ts-ignore
      amplifiedDeviation = deviation > 0 ? 0.05 : -0.05;
    }
    
    // 层级3: 时段特征增强 - 基于广告行业通用规律
    // 凌晨时段(0-6时)通常转化率低，适当降低出价
    // 晚间高峰(19-23时)通常转化率高，适当提高出价
    // @ts-ignore
    const hour = hourData.hour;
    let timeBonus = 0;
    if (hour >= 0 && hour <= 5) {
      timeBonus = -0.05; // 凌晨降低5%
    } else if (hour >= 6 && hour <= 8) {
      timeBonus = 0.02; // 早高峰提升2%
    } else if (hour >= 19 && hour <= 22) {
      timeBonus = 0.05; // 晚高峰提升5%
    } else if (hour === 23) {
      timeBonus = -0.02; // 深夜降低2%
    }
    
    multiplier = 1.0 + amplifiedDeviation + timeBonus;
    
    multiplier = Math.max(minMultiplier, Math.min(maxMultiplier, multiplier));
    multiplier = Math.round(multiplier * 100) / 100;

    let reason = "";
    if (isHighTrafficLowConversion) {
      reason = "高流量时段（可能为种草时段），仅轻微调整保持曝光";
    } else if (multiplier > 1.15) {
      reason = "高转化时段，建议提高出价";
    } else if (multiplier < 0.85) {
      reason = "低效时段，建议降低出价";
    } else {
      reason = "正常时段，维持标准出价";
    }

    return {
      // @ts-ignore
      dayOfWeek: hourData.dayOfWeek,
      // @ts-ignore
      hour: hourData.hour,
      bidMultiplier: Math.round(multiplier * 100) / 100,
      trafficScore,
      isHighTrafficLowConversion,
      reason,
    };
  // @ts-ignore
  });
// @ts-ignore
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
    // @ts-ignore
    adjustmentPercent: number; // -90% to +900%
    // @ts-ignore
    reason: string;
  }[];
  avgAdjustment: number;
}[] {
  const placementLabels: Record<string, string> = {
    top_of_search: "搜索结果顶部",
    product_page: "商品页面",
    rest_of_search: "搜索结果其他位置",
  // @ts-ignore
  };

  return placementData.map((placement: unknown) => {
    // 计算每个时段的位置表现
    // @ts-ignore
    const hourlyAdjustments = placement.hourlyStats.map((stat: unknown) => {
      // @ts-ignore
      const roas = stat.spend > 0 ? stat.sales / stat.spend : 0;
      // @ts-ignore
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
        // @ts-ignore
        dayOfWeek: stat.dayOfWeek,
        // @ts-ignore
        hour: stat.hour,
        adjustmentPercent: Math.round(adjustmentPercent),
        reason,
      };
    });

    // 计算平均调整比例
    const avgAdjustment =
      // @ts-ignore
      hourlyAdjustments.reduce((sum: number, h: Record<string, unknown>) => sum + h.adjustmentPercent, 0) /
      hourlyAdjustments.length || 0;

    return {
      // @ts-ignore
      placement: placement.placement,
      // @ts-ignore
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
 * v157: 按campaignId获取分时策略
 */
export async function getDaypartingStrategyByCampaignId(campaignId: number | string) {
  const db = await getDb();
  if (!db) return null;

  // v157: campaignId在schema中是int类型
  const result = await db
    .select()
    .from(daypartingStrategies)
    .where(eq(daypartingStrategies.campaignId, String(campaignId)))
    .limit(1);
  return result[0] || null;
}

/**
 * v157: 确保广告活动有分时策略，如果没有则自动创建默认策略
 * 默认策略使用均匀分配，等待数据积累后自动优化
 */
export async function ensureDaypartingStrategy(
  accountId: number,
  campaignId: number | string,
  campaignName: string,
  options: {
    optimizationGoal?: string;
    targetAcos?: number;
    targetRoas?: number;
  } = {}
): Promise<Record<string, unknown> | null> {
  // 先检查是否已存在
  const existing = await getDaypartingStrategyByCampaignId(campaignId);
  if (existing) return existing;
  
  const db = await getDb();
  if (!db) return null;
  
  try {
    // 创建默认分时策略
    // v157: campaignId在schema中是int类型，但数据库中是varchar(64)
    const strategyId = await createDaypartingStrategy({
      accountId,
      // v438: 修复ID混用 - campaignId必须存Amazon原始ID字符串，不能用Number()转换（会导致精度丢失）
      // @ts-expect-error - type assertion
      campaignId: String(campaignId) as unknown,
      name: `自动分时策略 - ${campaignName}`,
      strategyType: 'both',
      // @ts-expect-error - type assertion
      daypartingOptGoal: (options.optimizationGoal as unknown) || 'maximize_sales',
      daypartingTargetAcos: options.targetAcos?.toString(),
      daypartingTargetRoas: options.targetRoas?.toString(),
      analysisLookbackDays: 30,
      daypartingStatus: 'active',
      lastAnalyzedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
    });
    
    // 创建默认的均匀分配规则（所有时段乘数1.0）
    const defaultBidRules: InsertHourpartingBidRule[] = [];
    for (let dayOfWeek = 0; dayOfWeek <= 6; dayOfWeek++) {
      for (let hour = 0; hour < 24; hour++) {
        defaultBidRules.push({
          strategyId,
          dayOfWeek,
          hour,
          bidMultiplier: '1.00',
          hourDataPoints: 0,
          hourIsEnabled: 1,
        });
      // @ts-ignore
      }
    }
    await saveBidRules(strategyId, defaultBidRules);
    
    log.info(`[DaypartingService] v157: 自动创建分时策略 strategyId=${strategyId} for campaign ${campaignName} (${campaignId})`);
    
    return await getDaypartingStrategy(strategyId);
  } catch (err: unknown) {
    log.warn(`[DaypartingService] v157: 自动创建分时策略失败: ${(err as Error).message}`);
    return null;
  }
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
  // @ts-ignore
  if (!db) throw new Error("Database not available");

  // 删除旧规则
  await db
    .delete(daypartingBudgetRules)
    .where(eq(daypartingBudgetRules.strategyId, strategyId));

  // 插入新规则
  if (rules.length > 0) {
    await db.insert(daypartingBudgetRules).values(
      // @ts-ignore
      rules.map((rule: unknown) => ({ ...rule, strategyId }))
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
      // @ts-ignore
      rules.map((rule: unknown) => ({ ...rule, strategyId }))
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
// @ts-ignore
export async function generateOptimalStrategy(
  // @ts-ignore
  accountId: number,
  // @ts-ignore
  campaignId: number,
  // @ts-ignore
  options: {
    // @ts-ignore
    name: string;
    // @ts-ignore
    optimizationGoal: "maximize_sales" | "target_acos" | "target_roas" | "minimize_acos";
    // @ts-ignore
    targetAcos?: number;
    // @ts-ignore
    targetRoas?: number;
    lookbackDays?: number;
  }
) {
  // 1. 分析每周每天表现
  const weeklyData = await analyzeWeeklyPerformance(campaignId, options.lookbackDays || 30);

  // 2. 分析每小时表现
  const hourlyData = await analyzeHourlyPerformance(campaignId, options.lookbackDays || 30);

  // 3. 计算最优预算分配
  // @ts-ignore
  const budgetAllocation = calculateOptimalBudgetAllocation(weeklyData, {
    // @ts-ignore
    optimizationGoal: options.optimizationGoal,
    // @ts-ignore
    targetAcos: options.targetAcos,
    // @ts-ignore
    targetRoas: options.targetRoas,
  // @ts-ignore
  });

  // 4. 计算最优出价调整
  // @ts-ignore
  const bidAdjustments = calculateOptimalBidAdjustments(hourlyData, {
    optimizationGoal: options.optimizationGoal,
    targetAcos: options.targetAcos,
    targetRoas: options.targetRoas,
  });

  // 5. 创建策略
  const strategyId = await createDaypartingStrategy({
    accountId,
    campaignId: String(campaignId),
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
    budgetAllocation.map((rule: unknown) => ({
      // @ts-ignore
      dayOfWeek: rule.dayOfWeek,
      // @ts-ignore
      budgetMultiplier: rule.budgetMultiplier.toString(),
      // @ts-ignore
      budgetPercentage: rule.budgetPercentage.toString(),
      // @ts-ignore
      avgSpend: weeklyData.find((d: unknown) => d.dayOfWeek === rule.dayOfWeek)?.avgSpend.toString(),
      // @ts-ignore
      avgSales: weeklyData.find((d: unknown) => d.dayOfWeek === rule.dayOfWeek)?.avgSales.toString(),
      // @ts-ignore
      avgAcos: weeklyData.find((d: unknown) => d.dayOfWeek === rule.dayOfWeek)?.avgAcos.toString(),
      // @ts-ignore
      avgRoas: weeklyData.find((d: unknown) => d.dayOfWeek === rule.dayOfWeek)?.avgRoas.toString(),
      // @ts-ignore
      dataPoints: weeklyData.find((d: unknown) => d.dayOfWeek === rule.dayOfWeek)?.dataPoints || 0,
      isEnabled: 1,
    }))
  );

  // 7. 保存竞价规则
  await saveBidRules(
    strategyId,
    bidAdjustments.map((rule: unknown) => ({
      // @ts-ignore
      dayOfWeek: rule.dayOfWeek,
      // @ts-ignore
      hour: rule.hour,
      // @ts-ignore
      bidMultiplier: rule.bidMultiplier.toString(),
      // @ts-ignore
      avgClicks: hourlyData.find((h: unknown) => h.dayOfWeek === rule.dayOfWeek && h.hour === rule.hour)?.avgClicks.toString(),
      // @ts-ignore
      avgSpend: hourlyData.find((h: unknown) => h.dayOfWeek === rule.dayOfWeek && h.hour === rule.hour)?.avgSpend.toString(),
      // @ts-ignore
      avgSales: hourlyData.find((h: unknown) => h.dayOfWeek === rule.dayOfWeek && h.hour === rule.hour)?.avgSales.toString(),
      // @ts-ignore
      avgCvr: hourlyData.find((h: unknown) => h.dayOfWeek === rule.dayOfWeek && h.hour === rule.hour)?.avgCvr.toString(),
      // @ts-ignore
      avgCpc: hourlyData.find((h: unknown) => h.dayOfWeek === rule.dayOfWeek && h.hour === rule.hour)?.avgCpc.toString(),
      // @ts-ignore
      avgAcos: hourlyData.find((h: unknown) => h.dayOfWeek === rule.dayOfWeek && h.hour === rule.hour)?.avgAcos.toString(),
      // @ts-ignore
      dataPoints: hourlyData.find((h: unknown) => h.dayOfWeek === rule.dayOfWeek && h.hour === rule.hour)?.dataPoints || 0,
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
): Promise<Record<string, unknown> | null> {
  const bidRules = await getBidRules(strategyId);
  const rule = bidRules.find(r => r.dayOfWeek === dayOfWeek && r.hour === hour);
  
  if (!rule) return null;
  
  return {
    dayOfWeek: rule.dayOfWeek,
    hour: rule.hour,
    bidMultiplier: parseFloat(rule.bidMultiplier || '1'),
    isEnabled: (rule as Record<string, unknown>).ruleEnabled ?? true
  };
}


// ==================== v510: 分时竞价严格数据门槛 ====================

/**
 * v510: 分时竞价数据充分性校验
 * 
 * 核心原则：分时竞价是基于时间维度的精细化操作，
 * 如果数据量不足，分时分析的结论将充满统计噪声，
 * 强行分时不仅无法提升效果，反而会引入不必要的波动。
 * 
 * 严格前置条件：
 * 1. 连续投放天数 >= 30天（确保覆盖完整的周期模式）
 * 2. 总点击数 >= 50次（确保有足够的转化信号）
 * 3. 总花费 >= $20（确保广告活动有实质性投放）
 * 4. 每个时段平均数据点 >= 3（确保每个2小时时段至少有3天数据）
 */
export const DAYPARTING_DATA_THRESHOLDS = {
  /** 最少连续投放天数 */
  minContinuousDays: 30,
  /** 最少总点击数 */
  minTotalClicks: 50,
  /** 最少总花费（美元） */
  minTotalSpend: 20,
  /** 每个时段最少数据点数 */
  minDataPointsPerSlot: 3,
  /** 分时调整最大上浮比例（从±40%收紧到±20%） */
  maxBidMultiplierUp: 1.20,
  /** 分时调整最大下浮比例 */
  maxBidMultiplierDown: 0.80,
};

export interface DaypartingDataValidation {
  isValid: boolean;
  continuousDays: number;
  totalClicks: number;
  totalSpend: number;
  avgDataPointsPerSlot: number;
  failedChecks: string[];
  recommendation: string;
}

/**
 * v510: 校验广告活动是否满足分时竞价的数据充分性要求
 */
export async function validateDaypartingDataSufficiency(
  campaignId: number,
  lookbackDays: number = 30
): Promise<DaypartingDataValidation> {
  const db = await getDb();
  const failedChecks: string[] = [];
  
  if (!db) {
    return {
      isValid: false,
      continuousDays: 0,
      totalClicks: 0,
      totalSpend: 0,
      avgDataPointsPerSlot: 0,
      failedChecks: ['数据库不可用'],
      recommendation: '数据库连接失败，无法校验',
    };
  }
  
  const amazonCampaignId = await resolveAmazonCampaignId(campaignId);
  
  // 1. 查询连续投放天数和总体数据
  const summaryResult = await db.execute(sql`
    SELECT 
      COUNT(DISTINCT DATE(report_date)) as active_days,
      SUM(CAST(clicks AS UNSIGNED)) as total_clicks,
      SUM(CAST(spend AS DECIMAL(10,2))) as total_spend,
      MIN(report_date) as first_date,
      MAX(report_date) as last_date
    FROM daily_performance
    WHERE campaign_id = ${amazonCampaignId}
      AND report_date >= DATE_SUB(CURDATE(), INTERVAL ${lookbackDays + ATTRIBUTION_DELAY_DAYS} DAY)
      AND report_date <= DATE_SUB(CURDATE(), INTERVAL ${ATTRIBUTION_DELAY_DAYS} DAY)
  `);
  
  const rows = Array.isArray(summaryResult) ? (Array.isArray(summaryResult[0]) ? summaryResult[0] : summaryResult) : [];
  const summary = (rows as Array<Record<string, unknown>>)[0] || {};
  
  const continuousDays = Number(summary.active_days) || 0;
  const totalClicks = Number(summary.total_clicks) || 0;
  const totalSpend = Number(summary.total_spend) || 0;
  
  // 2. 查询每个时段的数据点数
  const hourlyResult = await db.execute(sql`
    SELECT 
      day_of_week, hour,
      COUNT(*) as data_points
    FROM hourly_performance
    WHERE campaign_id = ${amazonCampaignId}
      AND date >= DATE_SUB(CURDATE(), INTERVAL ${lookbackDays + ATTRIBUTION_DELAY_DAYS} DAY)
      AND date <= DATE_SUB(CURDATE(), INTERVAL ${ATTRIBUTION_DELAY_DAYS} DAY)
    GROUP BY day_of_week, hour
  `);
  
  const hourlyRows = Array.isArray(hourlyResult) ? (Array.isArray(hourlyResult[0]) ? hourlyResult[0] : hourlyResult) : [];
  const hourlyDataPoints = (hourlyRows as Array<Record<string, unknown>>).map(r => Number(r.data_points) || 0);
  const avgDataPointsPerSlot = hourlyDataPoints.length > 0 
    ? hourlyDataPoints.reduce((sum, dp) => sum + dp, 0) / (7 * 12) // 7天×12个2小时时段
    : 0;
  
  // 3. 逐项校验
  const thresholds = DAYPARTING_DATA_THRESHOLDS;
  
  if (continuousDays < thresholds.minContinuousDays) {
    failedChecks.push(`投放天数不足: ${continuousDays}天 < ${thresholds.minContinuousDays}天`);
  }
  
  if (totalClicks < thresholds.minTotalClicks) {
    failedChecks.push(`总点击不足: ${totalClicks}次 < ${thresholds.minTotalClicks}次`);
  }
  
  if (totalSpend < thresholds.minTotalSpend) {
    failedChecks.push(`总花费不足: $${totalSpend.toFixed(2)} < $${thresholds.minTotalSpend}`);
  }
  
  if (avgDataPointsPerSlot < thresholds.minDataPointsPerSlot) {
    failedChecks.push(`时段数据密度不足: 平均${avgDataPointsPerSlot.toFixed(1)}点/时段 < ${thresholds.minDataPointsPerSlot}点/时段`);
  }
  
  const isValid = failedChecks.length === 0;
  
  let recommendation = '';
  if (isValid) {
    recommendation = '数据充分，可以启用分时竞价';
  } else if (continuousDays < 14) {
    recommendation = `广告活动投放时间过短(${continuousDays}天)，建议至少投放30天后再启用分时竞价`;
  } else if (totalClicks < 20) {
    recommendation = `点击量过少(${totalClicks}次)，当前数据无法支撑分时分析，建议先优化基础出价提升流量`;
  } else {
    recommendation = `数据量接近门槛但尚未达标，建议继续积累${thresholds.minContinuousDays - continuousDays}天数据后再启用`;
  }
  
  return {
    isValid,
    continuousDays,
    totalClicks,
    totalSpend,
    avgDataPointsPerSlot,
    failedChecks,
    recommendation,
  };
}
