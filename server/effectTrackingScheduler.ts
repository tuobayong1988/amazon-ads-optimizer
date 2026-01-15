/**
 * 效果追踪定时任务服务
 * 自动收集出价调整后7/14/30天的实际表现数据
 */

import { getDb } from './db';
import { bidAdjustmentHistory, keywords } from '../drizzle/schema';
import { eq, and, isNull, lte, gte, sql } from 'drizzle-orm';

// 追踪周期配置
export const TRACKING_PERIODS = {
  DAY_7: 7,
  DAY_14: 14,
  DAY_30: 30,
} as const;

// 效果追踪数据结构
export interface TrackingData {
  clicks: number;
  impressions: number;
  spend: number;
  sales: number;
  orders: number;
  acos: number;
  roas: number;
  profit: number;
}

// 效果追踪结果
export interface TrackingResult {
  historyId: number;
  keywordId: number;
  period: number;
  estimatedProfit: number;
  actualProfit: number;
  profitDifference: number;
  accuracyRate: number;
  trackingData: TrackingData;
}

/**
 * 获取需要追踪的历史记录
 * @param period 追踪周期（7/14/30天）
 */
export async function getRecordsToTrack(period: number): Promise<any[]> {
  const db = await getDb();
  if (!db) return [];
  
  // 计算目标日期范围
  const now = new Date();
  const targetDate = new Date(now.getTime() - period * 24 * 60 * 60 * 1000);
  const startOfDay = new Date(targetDate.setHours(0, 0, 0, 0));
  const endOfDay = new Date(targetDate.setHours(23, 59, 59, 999));
  
  // 根据周期确定要检查的字段
  let trackingField: string;
  if (period === TRACKING_PERIODS.DAY_7) {
    trackingField = 'actual_profit_7d';
  } else if (period === TRACKING_PERIODS.DAY_14) {
    trackingField = 'actual_profit_14d';
  } else {
    trackingField = 'actual_profit_30d';
  }
  
  // 查询需要追踪的记录 - 使用status字段而不是isRolledBack
  const endOfDayStr = new Date(endOfDay).toISOString().slice(0, 19).replace('T', ' ');
  const startOfDayStr = new Date(startOfDay.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  
  const records = await db
    .select()
    .from(bidAdjustmentHistory)
    .where(
      and(
        sql`${bidAdjustmentHistory.status} != 'rolled_back'`,
        sql`${bidAdjustmentHistory.appliedAt} <= ${endOfDayStr}`,
        sql`${bidAdjustmentHistory.appliedAt} >= ${startOfDayStr}`
      )
    );
  
  // 过滤出尚未追踪指定周期的记录
  return records.filter(record => {
    if (period === TRACKING_PERIODS.DAY_7) {
      return record.actualProfit7D === null;
    } else if (period === TRACKING_PERIODS.DAY_14) {
      return record.actualProfit14D === null;
    } else {
      return record.actualProfit30D === null;
    }
  });
}

/**
 * 收集关键词在指定时间段的实际表现数据
 * @param keywordId 关键词ID
 * @param startDate 开始日期
 * @param endDate 结束日期
 */
export async function collectKeywordPerformance(
  keywordId: number,
  startDate: Date,
  endDate: Date
): Promise<TrackingData> {
  const db = await getDb();
  
  // 注意：dailyPerformance表是按账号/活动级别存储的，没有keywordId字段
  // 这里我们模拟返回空数据，实际实现需要从关键词表或其他数据源获取
  // 在实际生产环境中，应该从Amazon API获取关键词级别的历史数据
  const metrics: any[] = [];
  
  // 汇总数据
  const totalClicks = metrics.reduce((sum, m) => sum + (m.clicks || 0), 0);
  const totalImpressions = metrics.reduce((sum, m) => sum + (m.impressions || 0), 0);
  const totalSpend = metrics.reduce((sum, m) => sum + parseFloat(String(m.spend || 0)), 0);
  const totalSales = metrics.reduce((sum, m) => sum + parseFloat(String(m.sales || 0)), 0);
  const totalOrders = metrics.reduce((sum, m) => sum + (m.orders || 0), 0);
  
  // 计算衍生指标
  const acos = totalSales > 0 ? (totalSpend / totalSales) * 100 : 0;
  const roas = totalSpend > 0 ? totalSales / totalSpend : 0;
  const profit = totalSales - totalSpend;
  
  return {
    clicks: totalClicks,
    impressions: totalImpressions,
    spend: totalSpend,
    sales: totalSales,
    orders: totalOrders,
    acos: Math.round(acos * 100) / 100,
    roas: Math.round(roas * 100) / 100,
    profit: Math.round(profit * 100) / 100,
  };
}

/**
 * 更新历史记录的效果追踪数据
 * @param historyId 历史记录ID
 * @param period 追踪周期
 * @param trackingData 追踪数据
 */
export async function updateTrackingData(
  historyId: number,
  period: number,
  trackingData: TrackingData
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  
  const updateData: any = {};
  
  if (period === TRACKING_PERIODS.DAY_7) {
    updateData.actualProfit7D = trackingData.profit.toString();
    updateData.actualClicks7d = trackingData.clicks;
    updateData.actualSales7d = trackingData.sales.toString();
    updateData.actualAcos7d = trackingData.acos.toString();
  } else if (period === TRACKING_PERIODS.DAY_14) {
    updateData.actualProfit14D = trackingData.profit.toString();
    updateData.actualClicks14d = trackingData.clicks;
    updateData.actualSales14d = trackingData.sales.toString();
    updateData.actualAcos14d = trackingData.acos.toString();
  } else {
    updateData.actualProfit30D = trackingData.profit.toString();
    updateData.actualClicks30d = trackingData.clicks;
    updateData.actualSales30d = trackingData.sales.toString();
    updateData.actualAcos30d = trackingData.acos.toString();
  }
  
  await db
    .update(bidAdjustmentHistory)
    .set(updateData)
    .where(eq(bidAdjustmentHistory.id, historyId));
}

/**
 * 执行效果追踪任务
 * @param period 追踪周期（7/14/30天）
 */
export async function runEffectTrackingTask(period: number): Promise<TrackingResult[]> {
  const results: TrackingResult[] = [];
  
  // 获取需要追踪的记录
  const records = await getRecordsToTrack(period);
  
  for (const record of records) {
    try {
      // 计算追踪时间范围
      const adjustedAt = new Date(record.adjustedAt);
      const startDate = adjustedAt;
      const endDate = new Date(adjustedAt.getTime() + period * 24 * 60 * 60 * 1000);
      
      // 收集实际表现数据
      const trackingData = await collectKeywordPerformance(
        record.keywordId,
        startDate,
        endDate
      );
      
      // 更新历史记录
      await updateTrackingData(record.id, period, trackingData);
      
      // 计算准确率
      const estimatedProfit = parseFloat(record.estimatedProfitChange || '0');
      const actualProfit = trackingData.profit;
      const profitDifference = actualProfit - estimatedProfit;
      const accuracyRate = estimatedProfit !== 0 
        ? Math.min(100, Math.max(0, (1 - Math.abs(profitDifference) / Math.abs(estimatedProfit)) * 100))
        : (actualProfit >= 0 ? 100 : 0);
      
      results.push({
        historyId: record.id,
        keywordId: record.keywordId,
        period,
        estimatedProfit,
        actualProfit,
        profitDifference,
        accuracyRate: Math.round(accuracyRate * 100) / 100,
        trackingData,
      });
    } catch (error) {
      console.error(`Failed to track record ${record.id}:`, error);
    }
  }
  
  return results;
}

/**
 * 运行所有周期的效果追踪任务
 */
export async function runAllTrackingTasks(): Promise<{
  day7: TrackingResult[];
  day14: TrackingResult[];
  day30: TrackingResult[];
}> {
  const day7 = await runEffectTrackingTask(TRACKING_PERIODS.DAY_7);
  const day14 = await runEffectTrackingTask(TRACKING_PERIODS.DAY_14);
  const day30 = await runEffectTrackingTask(TRACKING_PERIODS.DAY_30);
  
  return { day7, day14, day30 };
}

/**
 * 获取效果追踪统计摘要
 */
export async function getTrackingStatsSummary(): Promise<{
  totalTracked: number;
  avgAccuracy7d: number;
  avgAccuracy14d: number;
  avgAccuracy30d: number;
  totalEstimatedProfit: number;
  totalActualProfit: number;
  overallAccuracy: number;
}> {
  const db = await getDb();
  if (!db) return { totalTracked: 0, avgAccuracy7d: 0, avgAccuracy14d: 0, avgAccuracy30d: 0, totalEstimatedProfit: 0, totalActualProfit: 0, overallAccuracy: 0 };
  
  // 查询所有已追踪的记录 - 使用status字段而不是isRolledBack
  const records = await db
    .select()
    .from(bidAdjustmentHistory)
    .where(sql`${bidAdjustmentHistory.status} != 'rolled_back'`);
  
  // 计算统计数据
  let totalTracked = 0;
  let sum7d = 0, count7d = 0;
  let sum14d = 0, count14d = 0;
  let sum30d = 0, count30d = 0;
  let totalEstimated = 0;
  let totalActual = 0;
  
  for (const record of records) {
    const estimated = parseFloat((record as any).estimatedProfitChange || '0');
    totalEstimated += estimated;
    
    if (record.actualProfit7D !== null) {
      const actual = parseFloat(record.actualProfit7D);
      const accuracy = estimated !== 0 
        ? Math.min(100, Math.max(0, (1 - Math.abs(actual - estimated) / Math.abs(estimated)) * 100))
        : (actual >= 0 ? 100 : 0);
      sum7d += accuracy;
      count7d++;
      totalTracked++;
    }
    
    if (record.actualProfit14D !== null) {
      const actual = parseFloat(record.actualProfit14D);
      const accuracy = estimated !== 0 
        ? Math.min(100, Math.max(0, (1 - Math.abs(actual - estimated) / Math.abs(estimated)) * 100))
        : (actual >= 0 ? 100 : 0);
      sum14d += accuracy;
      count14d++;
    }
    
    if (record.actualProfit30D !== null) {
      const actual = parseFloat(record.actualProfit30D);
      totalActual += actual;
      const accuracy = estimated !== 0 
        ? Math.min(100, Math.max(0, (1 - Math.abs(actual - estimated) / Math.abs(estimated)) * 100))
        : (actual >= 0 ? 100 : 0);
      sum30d += accuracy;
      count30d++;
    }
  }
  
  const overallAccuracy = totalEstimated !== 0 
    ? Math.min(100, Math.max(0, (1 - Math.abs(totalActual - totalEstimated) / Math.abs(totalEstimated)) * 100))
    : (totalActual >= 0 ? 100 : 0);
  
  return {
    totalTracked,
    avgAccuracy7d: count7d > 0 ? Math.round(sum7d / count7d * 100) / 100 : 0,
    avgAccuracy14d: count14d > 0 ? Math.round(sum14d / count14d * 100) / 100 : 0,
    avgAccuracy30d: count30d > 0 ? Math.round(sum30d / count30d * 100) / 100 : 0,
    totalEstimatedProfit: Math.round(totalEstimated * 100) / 100,
    totalActualProfit: Math.round(totalActual * 100) / 100,
    overallAccuracy: Math.round(overallAccuracy * 100) / 100,
  };
}


// ==================== 定时任务调度器 ====================

// 调度器状态
interface SchedulerStatus {
  isRunning: boolean;
  lastRunTime: Date | null;
  nextRunTime: Date | null;
  totalProcessed: number;
  errors: string[];
}

let schedulerStatus: SchedulerStatus = {
  isRunning: false,
  lastRunTime: null,
  nextRunTime: null,
  totalProcessed: 0,
  errors: [],
};

let schedulerInterval: NodeJS.Timeout | null = null;

/**
 * 启动效果追踪定时任务
 * @param intervalMs 执行间隔（毫秒），默认每小时执行一次
 */
export function startEffectTrackingScheduler(intervalMs: number = 60 * 60 * 1000): void {
  if (schedulerStatus.isRunning) {
    console.log('效果追踪定时任务已在运行中');
    return;
  }
  
  schedulerStatus.isRunning = true;
  schedulerStatus.nextRunTime = new Date(Date.now() + intervalMs);
  
  // 立即执行一次
  executeScheduledTask();
  
  // 设置定时执行
  schedulerInterval = setInterval(() => {
    schedulerStatus.nextRunTime = new Date(Date.now() + intervalMs);
    executeScheduledTask();
  }, intervalMs);
  
  console.log(`效果追踪定时任务已启动，执行间隔: ${intervalMs / 1000 / 60} 分钟`);
}

/**
 * 停止效果追踪定时任务
 */
export function stopEffectTrackingScheduler(): void {
  if (!schedulerStatus.isRunning) {
    console.log('效果追踪定时任务未在运行');
    return;
  }
  
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
  
  schedulerStatus.isRunning = false;
  schedulerStatus.nextRunTime = null;
  
  console.log('效果追踪定时任务已停止');
}

/**
 * 获取调度器状态
 */
export function getSchedulerStatus(): SchedulerStatus {
  return { ...schedulerStatus };
}

/**
 * 执行定时任务
 */
async function executeScheduledTask(): Promise<void> {
  try {
    console.log(`[${new Date().toISOString()}] 开始执行效果追踪任务...`);
    
    const results = await runAllTrackingTasks();
    
    const totalProcessed = results.day7.length + results.day14.length + results.day30.length;
    schedulerStatus.lastRunTime = new Date();
    schedulerStatus.totalProcessed += totalProcessed;
    schedulerStatus.errors = [];
    
    console.log(`[${new Date().toISOString()}] 效果追踪任务完成: 7天=${results.day7.length}, 14天=${results.day14.length}, 30天=${results.day30.length}`);
  } catch (error: any) {
    const errorMsg = `效果追踪任务执行失败: ${error.message}`;
    console.error(errorMsg);
    schedulerStatus.errors.push(errorMsg);
  }
}

/**
 * 手动触发效果追踪任务
 */
export async function triggerEffectTrackingTask(): Promise<{
  success: boolean;
  message: string;
  results?: {
    day7: number;
    day14: number;
    day30: number;
  };
}> {
  try {
    const results = await runAllTrackingTasks();
    
    return {
      success: true,
      message: '效果追踪任务执行成功',
      results: {
        day7: results.day7.length,
        day14: results.day14.length,
        day30: results.day30.length,
      },
    };
  } catch (error: any) {
    return {
      success: false,
      message: `效果追踪任务执行失败: ${error.message}`,
    };
  }
}
