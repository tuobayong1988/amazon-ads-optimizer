/**
 * 分时预算算法模块 - 周×时段二维控制
 * 
 * 功能：
 * - 7天 × 12时段 = 84个独立控制单元
 * - 采用每2小时为一个时段的精细化划分
 * - 基于历史表现数据动态调整预算
 * - 支持周×时段热力图可视化
 */

import { getDb } from "./db";
import { dailyPerformance, campaigns } from "../drizzle/schema";
import { eq, and, gte, lte, sql, inArray } from "drizzle-orm";

// 时段定义（每2小时一个时段，共12个时段）
export const TIME_SLOTS = [
  { id: 'T1', startHour: 0, endHour: 2, name: '深夜低谷', description: '00:00-02:00', defaultWeight: 0.3 },
  { id: 'T2', startHour: 2, endHour: 4, name: '凌晨低谷', description: '02:00-04:00', defaultWeight: 0.2 },
  { id: 'T3', startHour: 4, endHour: 6, name: '黎明前', description: '04:00-06:00', defaultWeight: 0.3 },
  { id: 'T4', startHour: 6, endHour: 8, name: '早起通勤', description: '06:00-08:00', defaultWeight: 0.6 },
  { id: 'T5', startHour: 8, endHour: 10, name: '上午工作', description: '08:00-10:00', defaultWeight: 0.8 },
  { id: 'T6', startHour: 10, endHour: 12, name: '午前高峰', description: '10:00-12:00', defaultWeight: 1.0 },
  { id: 'T7', startHour: 12, endHour: 14, name: '午休购物', description: '12:00-14:00', defaultWeight: 1.2 },
  { id: 'T8', startHour: 14, endHour: 16, name: '下午工作', description: '14:00-16:00', defaultWeight: 0.9 },
  { id: 'T9', startHour: 16, endHour: 18, name: '下班前', description: '16:00-18:00', defaultWeight: 0.9 },
  { id: 'T10', startHour: 18, endHour: 20, name: '晚间高峰', description: '18:00-20:00', defaultWeight: 1.3 },
  { id: 'T11', startHour: 20, endHour: 22, name: '黄金时段', description: '20:00-22:00', defaultWeight: 1.5 },
  { id: 'T12', startHour: 22, endHour: 24, name: '睡前浏览', description: '22:00-24:00', defaultWeight: 0.8 },
];

// 周几定义
export const WEEKDAYS = [
  { id: 1, name: 'D1', label: '周一', description: '工作日开始，购物意愿回升', defaultWeight: 0.9 },
  { id: 2, name: 'D2', label: '周二', description: '工作日常规', defaultWeight: 0.85 },
  { id: 3, name: 'D3', label: '周三', description: '工作日中期', defaultWeight: 0.85 },
  { id: 4, name: 'D4', label: '周四', description: '工作日，周末前购物准备', defaultWeight: 0.95 },
  { id: 5, name: 'D5', label: '周五', description: '工作日结束，购物高峰开始', defaultWeight: 1.1 },
  { id: 6, name: 'D6', label: '周六', description: '周末购物高峰', defaultWeight: 1.2 },
  { id: 7, name: 'D7', label: '周日', description: '周末购物高峰', defaultWeight: 1.15 },
];

// 时段预算调整系数阈值
export const BUDGET_ADJUSTMENT_THRESHOLDS = {
  SUPER_HIGH: { coefficient: 1.5, adjustment: { min: 40, max: 50 } },
  HIGH: { coefficient: 1.2, adjustment: { min: 20, max: 40 } },
  NORMAL: { coefficient: 0.8, adjustment: { min: 0, max: 0 } },
  LOW: { coefficient: 0.5, adjustment: { min: -40, max: -20 } },
  SUPER_LOW: { coefficient: 0, adjustment: { min: -50, max: -40 } },
};

export interface TimeSlotPerformance {
  slotId: string;
  slotName: string;
  description: string;
  startHour: number;
  endHour: number;
  impressions: number;
  clicks: number;
  spend: number;
  sales: number;
  orders: number;
  ctr: number;
  cvr: number;
  cpc: number;
  acos: number;
  roas: number;
}

export interface TimeSlotBudgetAllocation {
  slotId: string;
  slotName: string;
  description: string;
  performanceCoefficient: number;
  baseBudget: number;
  adjustmentPercent: number;
  allocatedBudget: number;
  reason: string;
}

// 周×时段表现数据类型
export interface WeeklySlotPerformance {
  dayOfWeek: number; // 1-7 (周一到周日)
  dayLabel: string;
  timeSlotId: string;
  timeSlotName: string;
  impressions: number;
  clicks: number;
  spend: number;
  sales: number;
  orders: number;
  roas: number;
  cvr: number;
  cpc: number;
  performanceCoefficient: number; // 相对于全周平均的系数
}

// 周×时段预算分配
export interface WeeklySlotBudgetAllocation {
  dayOfWeek: number;
  dayLabel: string;
  timeSlotId: string;
  timeSlotName: string;
  performanceCoefficient: number;
  baseBudget: number;
  adjustmentPercent: number;
  allocatedBudget: number;
  reason: string;
}

/**
 * 根据小时获取时段ID
 */
export function getTimeSlotByHour(hour: number): typeof TIME_SLOTS[0] | undefined {
  return TIME_SLOTS.find(slot => hour >= slot.startHour && hour < slot.endHour);
}

/**
 * 获取当前时段
 */
export function getCurrentTimeSlot(): typeof TIME_SLOTS[0] {
  const currentHour = new Date().getHours();
  return getTimeSlotByHour(currentHour) || TIME_SLOTS[0];
}

/**
 * 获取当前周几（1-7，周一到周日）
 */
export function getCurrentDayOfWeek(): number {
  const day = new Date().getDay();
  return day === 0 ? 7 : day; // 周日返回7，其他返回1-6
}

/**
 * 获取周几信息
 */
export function getWeekdayInfo(dayId: number) {
  return WEEKDAYS.find(d => d.id === dayId);
}

/**
 * 分析各时段表现（单日维度）
 */
export async function analyzeTimeSlotPerformance(
  accountId: number,
  campaignIds?: number[],
  days: number = 14
): Promise<TimeSlotPerformance[]> {
  const db = await getDb();
  if (!db) return TIME_SLOTS.map(slot => ({
    slotId: slot.id,
    slotName: slot.name,
    description: slot.description,
    startHour: slot.startHour,
    endHour: slot.endHour,
    impressions: 0,
    clicks: 0,
    spend: 0,
    sales: 0,
    orders: 0,
    ctr: 0,
    cvr: 0,
    cpc: 0,
    acos: 0,
    roas: 0,
  }));
  
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const startDateStr = startDate.toISOString().split('T')[0];
  
  // 由于没有小时级数据，使用每日数据和默认权重来模拟
  let query = `
    SELECT 
      SUM(impressions) as total_impressions,
      SUM(clicks) as total_clicks,
      SUM(spend) as total_spend,
      SUM(sales) as total_sales,
      SUM(orders) as total_orders
    FROM daily_performance
    WHERE account_id = ?
    AND date >= ?
  `;
  const params: any[] = [accountId, startDateStr];
  
  if (campaignIds && campaignIds.length > 0) {
    query += ` AND campaign_id IN (${campaignIds.map(() => '?').join(',')})`;
    params.push(...campaignIds);
  }
  
  const result = await db.execute(sql.raw(query));
  const rows = (result as any[])[0] || [];
  const totals = rows[0] || {
    total_impressions: 0,
    total_clicks: 0,
    total_spend: 0,
    total_sales: 0,
    total_orders: 0,
  };
  
  // 基于默认权重分配各时段的表现
  const totalWeight = TIME_SLOTS.reduce((sum, slot) => sum + slot.defaultWeight, 0);
  
  return TIME_SLOTS.map(slot => {
    const weightRatio = slot.defaultWeight / totalWeight;
    
    const impressions = Math.round(Number(totals.total_impressions) * weightRatio);
    const clicks = Math.round(Number(totals.total_clicks) * weightRatio);
    const spend = Number(totals.total_spend) * weightRatio;
    const sales = Number(totals.total_sales) * weightRatio;
    const orders = Math.round(Number(totals.total_orders) * weightRatio);
    
    const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
    const cvr = clicks > 0 ? (orders / clicks) * 100 : 0;
    const cpc = clicks > 0 ? spend / clicks : 0;
    const acos = sales > 0 ? (spend / sales) * 100 : 0;
    const roas = spend > 0 ? sales / spend : 0;
    
    return {
      slotId: slot.id,
      slotName: slot.name,
      description: slot.description,
      startHour: slot.startHour,
      endHour: slot.endHour,
      impressions,
      clicks,
      spend,
      sales,
      orders,
      ctr,
      cvr,
      cpc,
      acos,
      roas,
    };
  });
}

/**
 * 分析周×时段表现数据（二维控制）
 * 收集过去4周的历史数据，计算每个周×时段组合的表现系数
 */
export async function analyzeWeeklySlotPerformance(
  accountId: number,
  campaignIds?: number[],
  weeks: number = 4
): Promise<{
  matrix: WeeklySlotPerformance[][];
  weeklyAverage: {
    roas: number;
    cvr: number;
    cpc: number;
  };
}> {
  const db = await getDb();
  
  // 初始化84个单元的矩阵（7天 × 12时段）
  const matrix: WeeklySlotPerformance[][] = [];
  for (let d = 1; d <= 7; d++) {
    matrix[d] = [];
    const weekday = WEEKDAYS.find(w => w.id === d)!;
    for (let t = 0; t < TIME_SLOTS.length; t++) {
      const slot = TIME_SLOTS[t];
      matrix[d][t] = {
        dayOfWeek: d,
        dayLabel: weekday.label,
        timeSlotId: slot.id,
        timeSlotName: slot.name,
        impressions: 0,
        clicks: 0,
        spend: 0,
        sales: 0,
        orders: 0,
        roas: 0,
        cvr: 0,
        cpc: 0,
        performanceCoefficient: 1.0,
      };
    }
  }
  
  if (!db) {
    return {
      matrix,
      weeklyAverage: { roas: 0, cvr: 0, cpc: 0 },
    };
  }
  
  // 计算日期范围（过去4周，排除最近2天）
  const endDate = new Date();
  endDate.setDate(endDate.getDate() - 2);
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - (weeks * 7 + 2));
  
  const startDateStr = startDate.toISOString().split('T')[0];
  const endDateStr = endDate.toISOString().split('T')[0];
  
  // 查询历史表现数据
  let query = `
    SELECT 
      date,
      SUM(impressions) as impressions,
      SUM(clicks) as clicks,
      SUM(spend) as spend,
      SUM(sales) as sales,
      SUM(orders) as orders
    FROM daily_performance
    WHERE account_id = ?
    AND date >= ?
    AND date <= ?
  `;
  const params: any[] = [accountId, startDateStr, endDateStr];
  
  if (campaignIds && campaignIds.length > 0) {
    query += ` AND campaign_id IN (${campaignIds.map(() => '?').join(',')})`;
    params.push(...campaignIds);
  }
  
  query += ` GROUP BY date`;
  
  const result = await db.execute(sql.raw(query));
  const rows = (result as any[])[0] || [];
  
  // 计算全周总计
  let totalSpend = 0;
  let totalSales = 0;
  let totalClicks = 0;
  let totalOrders = 0;
  
  // 处理数据，按周几分组
  for (const row of rows) {
    const date = new Date(row.date);
    let dayOfWeek = date.getDay();
    dayOfWeek = dayOfWeek === 0 ? 7 : dayOfWeek; // 周日返回7
    
    const weekday = WEEKDAYS.find(w => w.id === dayOfWeek)!;
    
    // 将日数据按时段权重分配到12个时段
    const totalSlotWeight = TIME_SLOTS.reduce((sum, slot) => sum + slot.defaultWeight, 0);
    
    for (let t = 0; t < TIME_SLOTS.length; t++) {
      const slot = TIME_SLOTS[t];
      const slotWeightRatio = slot.defaultWeight / totalSlotWeight;
      // 结合周几权重
      const dayWeightRatio = weekday.defaultWeight;
      const combinedWeight = slotWeightRatio * dayWeightRatio;
      
      const impressions = Number(row.impressions || 0) * slotWeightRatio;
      const clicks = Number(row.clicks || 0) * slotWeightRatio;
      const spend = Number(row.spend || 0) * slotWeightRatio;
      const sales = Number(row.sales || 0) * slotWeightRatio;
      const orders = Number(row.orders || 0) * slotWeightRatio;
      
      matrix[dayOfWeek][t].impressions += impressions;
      matrix[dayOfWeek][t].clicks += clicks;
      matrix[dayOfWeek][t].spend += spend;
      matrix[dayOfWeek][t].sales += sales;
      matrix[dayOfWeek][t].orders += orders;
    }
    
    totalSpend += Number(row.spend || 0);
    totalSales += Number(row.sales || 0);
    totalClicks += Number(row.clicks || 0);
    totalOrders += Number(row.orders || 0);
  }
  
  // 计算全周平均值
  const weeklyAverage = {
    roas: totalSpend > 0 ? totalSales / totalSpend : 0,
    cvr: totalClicks > 0 ? totalOrders / totalClicks : 0,
    cpc: totalClicks > 0 ? totalSpend / totalClicks : 0,
  };
  
  // 计算每个单元的指标和表现系数
  for (let d = 1; d <= 7; d++) {
    for (let t = 0; t < TIME_SLOTS.length; t++) {
      const cell = matrix[d][t];
      cell.roas = cell.spend > 0 ? cell.sales / cell.spend : 0;
      cell.cvr = cell.clicks > 0 ? cell.orders / cell.clicks : 0;
      cell.cpc = cell.clicks > 0 ? cell.spend / cell.clicks : 0;
      
      // 计算表现系数（相对于全周平均ROAS）
      cell.performanceCoefficient = weeklyAverage.roas > 0 
        ? cell.roas / weeklyAverage.roas 
        : 1.0;
    }
  }
  
  return { matrix, weeklyAverage };
}

/**
 * 根据表现系数计算预算调整百分比
 */
export function calculateBudgetAdjustment(coefficient: number): {
  adjustmentPercent: number;
  category: string;
} {
  if (coefficient > BUDGET_ADJUSTMENT_THRESHOLDS.SUPER_HIGH.coefficient) {
    return { 
      adjustmentPercent: BUDGET_ADJUSTMENT_THRESHOLDS.SUPER_HIGH.adjustment.max, 
      category: "超高价值时段" 
    };
  } else if (coefficient > BUDGET_ADJUSTMENT_THRESHOLDS.HIGH.coefficient) {
    // 线性插值
    const range = BUDGET_ADJUSTMENT_THRESHOLDS.SUPER_HIGH.coefficient - BUDGET_ADJUSTMENT_THRESHOLDS.HIGH.coefficient;
    const position = (coefficient - BUDGET_ADJUSTMENT_THRESHOLDS.HIGH.coefficient) / range;
    const adjustmentPercent = BUDGET_ADJUSTMENT_THRESHOLDS.HIGH.adjustment.min + 
      (BUDGET_ADJUSTMENT_THRESHOLDS.HIGH.adjustment.max - BUDGET_ADJUSTMENT_THRESHOLDS.HIGH.adjustment.min) * position;
    return { adjustmentPercent, category: "高价值时段" };
  } else if (coefficient > BUDGET_ADJUSTMENT_THRESHOLDS.NORMAL.coefficient) {
    return { adjustmentPercent: 0, category: "正常时段" };
  } else if (coefficient > BUDGET_ADJUSTMENT_THRESHOLDS.LOW.coefficient) {
    // 线性插值
    const range = BUDGET_ADJUSTMENT_THRESHOLDS.NORMAL.coefficient - BUDGET_ADJUSTMENT_THRESHOLDS.LOW.coefficient;
    const position = (BUDGET_ADJUSTMENT_THRESHOLDS.NORMAL.coefficient - coefficient) / range;
    const adjustmentPercent = BUDGET_ADJUSTMENT_THRESHOLDS.LOW.adjustment.max - 
      (BUDGET_ADJUSTMENT_THRESHOLDS.LOW.adjustment.max - BUDGET_ADJUSTMENT_THRESHOLDS.LOW.adjustment.min) * position;
    return { adjustmentPercent, category: "低价值时段" };
  } else {
    return { 
      adjustmentPercent: BUDGET_ADJUSTMENT_THRESHOLDS.SUPER_LOW.adjustment.min, 
      category: "超低价值时段" 
    };
  }
}

/**
 * 计算时段预算分配（单日维度）
 */
export async function calculateTimeSlotBudgetAllocation(
  accountId: number,
  dailyBudget: number,
  campaignIds?: number[],
  days: number = 14
): Promise<TimeSlotBudgetAllocation[]> {
  // 获取各时段表现
  const slotPerformance = await analyzeTimeSlotPerformance(accountId, campaignIds, days);
  
  // 计算全天平均ROAS
  const totalSpend = slotPerformance.reduce((sum, s) => sum + s.spend, 0);
  const totalSales = slotPerformance.reduce((sum, s) => sum + s.sales, 0);
  const avgRoas = totalSpend > 0 ? totalSales / totalSpend : 1;
  
  // 基础预算（每个时段平均分配）
  const baseBudgetPerSlot = dailyBudget / TIME_SLOTS.length;
  
  // 计算各时段预算分配
  const allocations: TimeSlotBudgetAllocation[] = slotPerformance.map(slot => {
    // 计算表现系数
    const performanceCoefficient = avgRoas > 0 ? slot.roas / avgRoas : 1;
    
    // 确定调整幅度
    const { adjustmentPercent, category } = calculateBudgetAdjustment(performanceCoefficient);
    const reason = `${category} (系数${performanceCoefficient.toFixed(2)})`;
    
    // 计算分配预算
    const allocatedBudget = baseBudgetPerSlot * (1 + adjustmentPercent / 100);
    
    return {
      slotId: slot.slotId,
      slotName: slot.slotName,
      description: slot.description,
      performanceCoefficient,
      baseBudget: baseBudgetPerSlot,
      adjustmentPercent,
      allocatedBudget,
      reason,
    };
  });
  
  // 归一化，确保总预算不变
  const totalAllocated = allocations.reduce((sum, a) => sum + a.allocatedBudget, 0);
  const normalizationFactor = dailyBudget / totalAllocated;
  
  return allocations.map(a => ({
    ...a,
    allocatedBudget: a.allocatedBudget * normalizationFactor,
  }));
}

/**
 * 计算周×时段预算分配（二维控制）
 */
export async function calculateWeeklySlotBudgetAllocation(
  accountId: number,
  dailyBudget: number,
  campaignIds?: number[],
  weeks: number = 4
): Promise<{
  allocations: WeeklySlotBudgetAllocation[][];
  heatmapData: { day: number; slot: number; value: number; color: string; label: string }[];
}> {
  const { matrix } = await analyzeWeeklySlotPerformance(accountId, campaignIds, weeks);
  
  const allocations: WeeklySlotBudgetAllocation[][] = [];
  const heatmapData: { day: number; slot: number; value: number; color: string; label: string }[] = [];
  
  // 每个时段的基础预算 = 日预算 / 12
  const baseBudgetPerSlot = dailyBudget / TIME_SLOTS.length;
  
  for (let d = 1; d <= 7; d++) {
    allocations[d] = [];
    const weekday = WEEKDAYS.find(w => w.id === d)!;
    
    for (let t = 0; t < TIME_SLOTS.length; t++) {
      const cell = matrix[d][t];
      const slot = TIME_SLOTS[t];
      const { adjustmentPercent, category } = calculateBudgetAdjustment(cell.performanceCoefficient);
      const allocatedBudget = baseBudgetPerSlot * (1 + adjustmentPercent / 100);
      
      allocations[d][t] = {
        dayOfWeek: d,
        dayLabel: weekday.label,
        timeSlotId: slot.id,
        timeSlotName: slot.name,
        performanceCoefficient: cell.performanceCoefficient,
        baseBudget: baseBudgetPerSlot,
        adjustmentPercent,
        allocatedBudget,
        reason: category,
      };
      
      // 生成热力图数据
      heatmapData.push({
        day: d,
        slot: t + 1,
        value: cell.performanceCoefficient,
        color: getHeatmapColor(cell.performanceCoefficient),
        label: `${weekday.label} ${slot.description}: ${cell.performanceCoefficient.toFixed(2)}`,
      });
    }
  }
  
  return { allocations, heatmapData };
}

/**
 * 获取热力图颜色
 */
function getHeatmapColor(coefficient: number): string {
  if (coefficient > 1.5) return "#dc2626"; // 深红色 - 超高价值
  if (coefficient > 1.2) return "#f97316"; // 橙色 - 高价值
  if (coefficient > 0.8) return "#fbbf24"; // 黄色 - 正常
  if (coefficient > 0.5) return "#60a5fa"; // 浅蓝 - 低价值
  return "#1d4ed8"; // 深蓝 - 超低价值
}

/**
 * 获取周×时段表现热力图数据
 */
export async function getWeeklySlotHeatmap(
  accountId: number,
  campaignIds?: number[]
): Promise<{
  data: { day: number; slot: number; value: number; color: string; label: string }[];
  weekdays: typeof WEEKDAYS;
  timeSlots: typeof TIME_SLOTS;
}> {
  const { matrix } = await analyzeWeeklySlotPerformance(accountId, campaignIds);
  
  const data: { day: number; slot: number; value: number; color: string; label: string }[] = [];
  
  for (let d = 1; d <= 7; d++) {
    const weekday = WEEKDAYS.find(w => w.id === d)!;
    for (let t = 0; t < TIME_SLOTS.length; t++) {
      const cell = matrix[d][t];
      const slot = TIME_SLOTS[t];
      data.push({
        day: d,
        slot: t + 1,
        value: cell.performanceCoefficient,
        color: getHeatmapColor(cell.performanceCoefficient),
        label: `${weekday.label} ${slot.description}: ROAS系数 ${cell.performanceCoefficient.toFixed(2)}`,
      });
    }
  }
  
  return {
    data,
    weekdays: WEEKDAYS,
    timeSlots: TIME_SLOTS,
  };
}

/**
 * 获取当前周×时段的预算建议
 */
export async function getCurrentWeeklySlotBudgetRecommendation(
  accountId: number,
  dailyBudget: number,
  currentSpend: number,
  campaignIds?: number[]
): Promise<{
  currentDayOfWeek: number;
  currentDayLabel: string;
  currentSlot: typeof TIME_SLOTS[0];
  slotBudget: number;
  remainingSlotBudget: number;
  spendRate: number;
  performanceCoefficient: number;
  recommendation: string;
}> {
  const currentDayOfWeek = getCurrentDayOfWeek();
  const currentSlot = getCurrentTimeSlot();
  const weekday = WEEKDAYS.find(w => w.id === currentDayOfWeek)!;
  
  const { allocations } = await calculateWeeklySlotBudgetAllocation(accountId, dailyBudget, campaignIds);
  
  const slotIndex = TIME_SLOTS.findIndex(s => s.id === currentSlot.id);
  const currentAllocation = allocations[currentDayOfWeek]?.[slotIndex];
  const slotBudget = currentAllocation?.allocatedBudget || dailyBudget / TIME_SLOTS.length;
  const performanceCoefficient = currentAllocation?.performanceCoefficient || 1.0;
  
  // 计算当前时段已过时间比例
  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  const slotProgressMinutes = (currentHour - currentSlot.startHour) * 60 + currentMinute;
  const slotTotalMinutes = (currentSlot.endHour - currentSlot.startHour) * 60;
  const slotProgress = slotProgressMinutes / slotTotalMinutes;
  
  // 计算预期花费和实际花费率
  const expectedSpend = slotBudget * slotProgress;
  const spendRate = expectedSpend > 0 ? currentSpend / expectedSpend : 0;
  
  // 生成建议
  let recommendation = '';
  if (spendRate > 1.5) {
    recommendation = '消耗过快，建议降低出价或暂停部分低效广告';
  } else if (spendRate > 1.2) {
    recommendation = '消耗略快，可适当控制出价';
  } else if (spendRate < 0.5) {
    recommendation = '消耗过慢，可适当提高出价或扩大投放';
  } else if (spendRate < 0.8) {
    recommendation = '消耗略慢，可考虑优化广告素材或提高出价';
  } else {
    recommendation = '消耗正常，保持当前策略';
  }
  
  return {
    currentDayOfWeek,
    currentDayLabel: weekday.label,
    currentSlot,
    slotBudget,
    remainingSlotBudget: Math.max(0, slotBudget - currentSpend),
    spendRate,
    performanceCoefficient,
    recommendation,
  };
}

/**
 * 获取当前时段的预算消耗建议（兼容旧接口）
 */
export async function getCurrentSlotBudgetRecommendation(
  accountId: number,
  dailyBudget: number,
  currentSpend: number,
  campaignIds?: number[]
): Promise<{
  currentSlot: typeof TIME_SLOTS[0];
  slotBudget: number;
  remainingSlotBudget: number;
  spendRate: number;
  recommendation: string;
}> {
  const result = await getCurrentWeeklySlotBudgetRecommendation(
    accountId, dailyBudget, currentSpend, campaignIds
  );
  
  return {
    currentSlot: result.currentSlot,
    slotBudget: result.slotBudget,
    remainingSlotBudget: result.remainingSlotBudget,
    spendRate: result.spendRate,
    recommendation: result.recommendation,
  };
}

/**
 * 获取分时预算概览
 */
export async function getHourlyBudgetOverview(
  accountId: number,
  dailyBudget: number,
  campaignIds?: number[]
): Promise<{
  slots: TimeSlotBudgetAllocation[];
  weeklySlots: WeeklySlotBudgetAllocation[][];
  heatmapData: { day: number; slot: number; value: number; color: string; label: string }[];
  summary: {
    highValueSlots: string[];
    lowValueSlots: string[];
    peakHours: string;
    offPeakHours: string;
    bestDay: string;
    worstDay: string;
  };
}> {
  // 获取单日维度分配
  const allocations = await calculateTimeSlotBudgetAllocation(accountId, dailyBudget, campaignIds);
  
  // 获取周×时段维度分配
  const { allocations: weeklyAllocations, heatmapData } = await calculateWeeklySlotBudgetAllocation(
    accountId, dailyBudget, campaignIds
  );
  
  // 识别高价值和低价值时段
  const highValueSlots = allocations
    .filter(a => a.adjustmentPercent > 20)
    .map(a => a.description);
  
  const lowValueSlots = allocations
    .filter(a => a.adjustmentPercent < -20)
    .map(a => a.description);
  
  // 找出峰值和低谷时段
  const sortedByCoefficient = [...allocations].sort(
    (a, b) => b.performanceCoefficient - a.performanceCoefficient
  );
  
  const peakHours = sortedByCoefficient.slice(0, 3).map(a => a.description).join(', ');
  const offPeakHours = sortedByCoefficient.slice(-3).map(a => a.description).join(', ');
  
  // 计算每天的平均表现系数
  const dayAverages: { day: number; label: string; avgCoefficient: number }[] = [];
  for (let d = 1; d <= 7; d++) {
    const dayAllocations = weeklyAllocations[d] || [];
    const avgCoefficient = dayAllocations.length > 0
      ? dayAllocations.reduce((sum, a) => sum + a.performanceCoefficient, 0) / dayAllocations.length
      : 1;
    dayAverages.push({
      day: d,
      label: WEEKDAYS.find(w => w.id === d)?.label || '',
      avgCoefficient,
    });
  }
  
  const sortedDays = [...dayAverages].sort((a, b) => b.avgCoefficient - a.avgCoefficient);
  const bestDay = sortedDays[0]?.label || '';
  const worstDay = sortedDays[sortedDays.length - 1]?.label || '';
  
  return {
    slots: allocations,
    weeklySlots: weeklyAllocations,
    heatmapData,
    summary: {
      highValueSlots,
      lowValueSlots,
      peakHours,
      offPeakHours,
      bestDay,
      worstDay,
    },
  };
}
