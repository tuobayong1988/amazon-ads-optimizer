/**
 * 效果追踪定时任务服务
 * 
 * 功能：
 * 1. 自动收集出价调整后7/14/30天的实际表现数据
 * 2. 对比预估利润与实际利润
 * 3. 更新bid_adjustment_history表的效果追踪字段
 * 4. 生成效果追踪报告
 */

import { getDb } from '../db';
import { bidAdjustmentHistory, campaigns, keywords } from '../../drizzle/schema';
import { eq, and, isNull, lte, gte, sql } from 'drizzle-orm';

// 追踪周期配置
export const TRACKING_PERIODS = {
  DAY_7: 7,
  DAY_14: 14,
  DAY_30: 30,
} as const;

// 任务状态
export interface SchedulerStatus {
  isRunning: boolean;
  lastRunTime: Date | null;
  nextRunTime: Date | null;
  totalProcessed: number;
  errors: string[];
}

// 效果追踪数据
export interface EffectTrackingData {
  impressions: number;
  clicks: number;
  spend: number;
  sales: number;
  orders: number;
  profit: number;
  acos: number;
  roas: number;
}

// 调度器状态
let schedulerStatus: SchedulerStatus = {
  isRunning: false,
  lastRunTime: null,
  nextRunTime: null,
  totalProcessed: 0,
  errors: [],
};

let schedulerInterval: NodeJS.Timeout | null = null;

/**
 * 计算调整后天数
 */
export function calculateDaysSinceAdjustment(adjustmentDate: Date, currentDate: Date = new Date()): number {
  const diffTime = currentDate.getTime() - adjustmentDate.getTime();
  return Math.floor(diffTime / (1000 * 60 * 60 * 24));
}

/**
 * 判断是否应该收集数据
 */
export function shouldCollectData(
  daysSince: number,
  has7Day: boolean,
  has14Day: boolean,
  has30Day: boolean
): { collect7Day: boolean; collect14Day: boolean; collect30Day: boolean } {
  return {
    collect7Day: daysSince >= TRACKING_PERIODS.DAY_7 && !has7Day,
    collect14Day: daysSince >= TRACKING_PERIODS.DAY_14 && !has14Day,
    collect30Day: daysSince >= TRACKING_PERIODS.DAY_30 && !has30Day,
  };
}

/**
 * 计算实际利润
 * Profit = Sales - Ad Spend
 */
export function calculateActualProfit(revenue: number, adSpend: number): number {
  return revenue - adSpend;
}

/**
 * 计算利润预测准确度
 * 返回0-100的百分比
 */
export function calculateProfitAccuracy(estimated: number, actual: number): number {
  if (estimated === 0 && actual === 0) return 100;
  if (estimated === 0 || actual === 0) return 0;
  
  // 如果符号相同，计算准确度
  if ((estimated > 0 && actual > 0) || (estimated < 0 && actual < 0)) {
    const ratio = Math.min(Math.abs(estimated), Math.abs(actual)) / 
                  Math.max(Math.abs(estimated), Math.abs(actual));
    return ratio * 100;
  }
  
  // 符号不同，准确度为0
  return 0;
}

/**
 * 聚合追踪统计
 */
export function aggregateTrackingStats(records: Array<{ 
  expectedProfitIncrease: number; 
  actualProfit7D: number | null;
  actualProfit14D?: number | null;
  actualProfit30D?: number | null;
}>): {
  totalEstimated: number;
  totalActual7Day: number;
  totalActual14Day: number;
  totalActual30Day: number;
  recordCount: number;
  averageAccuracy7Day: number;
  averageAccuracy14Day: number;
  averageAccuracy30Day: number;
} {
  if (records.length === 0) {
    return { 
      totalEstimated: 0, 
      totalActual7Day: 0, 
      totalActual14Day: 0, 
      totalActual30Day: 0, 
      recordCount: 0, 
      averageAccuracy7Day: 0,
      averageAccuracy14Day: 0,
      averageAccuracy30Day: 0,
    };
  }
  
  const totalEstimated = records.reduce((sum: number, r: any) => sum + (r.expectedProfitIncrease || 0), 0);
  const totalActual7Day = records.reduce((sum: number, r: any) => sum + (r.actualProfit7D || 0), 0);
  const totalActual14Day = records.reduce((sum: number, r: any) => sum + (r.actualProfit14D || 0), 0);
  const totalActual30Day = records.reduce((sum: number, r: any) => sum + (r.actualProfit30D || 0), 0);
  
  // 计算7天准确度
  const accuracies7Day = records
    .filter((r: any) => r.actualProfit7D !== null)
    .map((r: any) => calculateProfitAccuracy(r.expectedProfitIncrease, r.actualProfit7D!));
  const averageAccuracy7Day = accuracies7Day.length > 0 
    ? accuracies7Day.reduce((sum: number, a: number) => sum + a, 0) / accuracies7Day.length 
    : 0;
  
  // 计算14天准确度
  const accuracies14Day = records
    .filter((r: any) => r.actualProfit14D !== null && r.actualProfit14D !== undefined)
    .map((r: any) => calculateProfitAccuracy(r.expectedProfitIncrease, r.actualProfit14D!));
  const averageAccuracy14Day = accuracies14Day.length > 0 
    ? accuracies14Day.reduce((sum: number, a: number) => sum + a, 0) / accuracies14Day.length 
    : 0;
  
  // 计算30天准确度
  const accuracies30Day = records
    .filter((r: any) => r.actualProfit30D !== null && r.actualProfit30D !== undefined)
    .map((r: any) => calculateProfitAccuracy(r.expectedProfitIncrease, r.actualProfit30D!));
  const averageAccuracy30Day = accuracies30Day.length > 0 
    ? accuracies30Day.reduce((sum: number, a: number) => sum + a, 0) / accuracies30Day.length 
    : 0;
  
  return { 
    totalEstimated, 
    totalActual7Day, 
    totalActual14Day, 
    totalActual30Day, 
    recordCount: records.length, 
    averageAccuracy7Day,
    averageAccuracy14Day,
    averageAccuracy30Day,
  };
}

/**
 * 获取需要追踪的记录
 */
export async function getPendingTrackingRecords(): Promise<any[]> {
  const currentDate = new Date();
  const sevenDaysAgo = new Date(currentDate.getTime() - 7 * 24 * 60 * 60 * 1000);
  
  try {
    // 查询需要追踪的记录：
    // 1. 调整时间超过7天
    // 2. 状态为applied（已应用）
    // 3. 至少有一个追踪字段为空
    const db = await getDb();
    if (!db) return [];
    
    const records = await db
      .select()
      .from(bidAdjustmentHistory)
      .where(
        and(
          eq(bidAdjustmentHistory.status, 'applied'),
          lte(bidAdjustmentHistory.appliedAt, sevenDaysAgo as any)
        )
      );
    
    // 过滤出需要追踪的记录
    return records.filter(record => {
      const daysSince = calculateDaysSinceAdjustment(new Date(record.appliedAt!));
      const needs = shouldCollectData(
        daysSince,
        record.actualProfit7D !== null,
        record.actualProfit14D !== null,
        record.actualProfit30D !== null
      );
      return needs.collect7Day || needs.collect14Day || needs.collect30Day;
    });
  } catch (error) {
    console.error('获取待追踪记录失败:', error);
    return [];
  }
}

/**
 * 模拟获取实际表现数据
 * 在实际应用中，这里应该调用Amazon API获取真实数据
 */
export async function fetchActualPerformanceData(
  campaignId: string,
  keywordId: string | null,
  startDate: Date,
  endDate: Date
): Promise<EffectTrackingData> {
  // 模拟数据 - 实际应用中应调用Amazon Advertising API
  const baseImpressions = Math.floor(Math.random() * 10000) + 1000;
  const ctr = 0.01 + Math.random() * 0.05;
  const clicks = Math.floor(baseImpressions * ctr);
  const cpc = 0.5 + Math.random() * 2;
  const spend = clicks * cpc;
  const cvr = 0.05 + Math.random() * 0.15;
  const orders = Math.floor(clicks * cvr);
  const aov = 20 + Math.random() * 80;
  const sales = orders * aov;
  const profit = sales - spend;
  const acos = sales > 0 ? (spend / sales) * 100 : 0;
  const roas = spend > 0 ? sales / spend : 0;
  
  return {
    impressions: baseImpressions,
    clicks,
    spend,
    sales,
    orders,
    profit,
    acos,
    roas,
  };
}

/**
 * 更新记录的效果追踪数据
 */
export async function updateTrackingData(
  recordId: number,
  period: 7 | 14 | 30,
  data: EffectTrackingData
): Promise<boolean> {
  try {
    const updateData: any = {};
    
    if (period === 7) {
      updateData.actualProfit7D = data.profit;
      updateData.actualImpressions7d = data.impressions;
      updateData.actualClicks7d = data.clicks;
      updateData.actualSpend7D = data.spend;
      updateData.actualRevenue7D = data.sales;
      updateData.actualConversions7d = data.orders;
    } else if (period === 14) {
      updateData.actualProfit14D = data.profit;
    } else if (period === 30) {
      updateData.actualProfit30D = data.profit;
    }
    updateData.trackingUpdatedAt = new Date().toISOString();
    
    const db = await getDb();
    if (!db) return false;
    
    await db
      .update(bidAdjustmentHistory)
      .set(updateData)
      .where(eq(bidAdjustmentHistory.id, recordId));
    
    return true;
  } catch (error) {
    console.error(`更新记录 ${recordId} 的 ${period} 天追踪数据失败:`, error);
    return false;
  }
}

/**
 * 执行效果追踪任务
 */
export async function runEffectTrackingTask(): Promise<{
  processed: number;
  updated7Day: number;
  updated14Day: number;
  updated30Day: number;
  errors: string[];
}> {
  const result = {
    processed: 0,
    updated7Day: 0,
    updated14Day: 0,
    updated30Day: 0,
    errors: [] as string[],
  };
  
  try {
    const records = await getPendingTrackingRecords();
    result.processed = records.length;
    
    for (const record of records) {
      const daysSince = calculateDaysSinceAdjustment(new Date(record.appliedAt!));
      const needs = shouldCollectData(
        daysSince,
        record.actualProfit7D !== null,
        record.actualProfit14D !== null,
        record.actualProfit30D !== null
      );
      
      // 收集7天数据
      if (needs.collect7Day) {
        try {
          const startDate = new Date(record.appliedAt!);
          const endDate = new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000);
          const data = await fetchActualPerformanceData(
            record.campaignId,
            record.keywordId,
            startDate,
            endDate
          );
          const success = await updateTrackingData(record.id, 7, data);
          if (success) result.updated7Day++;
        } catch (error: any) {
          result.errors.push(`记录 ${record.id} 7天数据收集失败: ${error.message}`);
        }
      }
      
      // 收集14天数据
      if (needs.collect14Day) {
        try {
          const startDate = new Date(record.appliedAt!);
          const endDate = new Date(startDate.getTime() + 14 * 24 * 60 * 60 * 1000);
          const data = await fetchActualPerformanceData(
            record.campaignId,
            record.keywordId,
            startDate,
            endDate
          );
          const success = await updateTrackingData(record.id, 14, data);
          if (success) result.updated14Day++;
        } catch (error: any) {
          result.errors.push(`记录 ${record.id} 14天数据收集失败: ${error.message}`);
        }
      }
      
      // 收集30天数据
      if (needs.collect30Day) {
        try {
          const startDate = new Date(record.appliedAt!);
          const endDate = new Date(startDate.getTime() + 30 * 24 * 60 * 60 * 1000);
          const data = await fetchActualPerformanceData(
            record.campaignId,
            record.keywordId,
            startDate,
            endDate
          );
          const success = await updateTrackingData(record.id, 30, data);
          if (success) result.updated30Day++;
        } catch (error: any) {
          result.errors.push(`记录 ${record.id} 30天数据收集失败: ${error.message}`);
        }
      }
    }
    
    // 更新调度器状态
    schedulerStatus.lastRunTime = new Date();
    schedulerStatus.totalProcessed += result.processed;
    schedulerStatus.errors = result.errors;
    
  } catch (error: any) {
    result.errors.push(`任务执行失败: ${error.message}`);
  }
  
  return result;
}

/**
 * 启动定时任务
 * 默认每小时执行一次
 */
export function startScheduler(intervalMs: number = 60 * 60 * 1000): void {
  if (schedulerStatus.isRunning) {
    console.log('效果追踪定时任务已在运行中');
    return;
  }
  
  schedulerStatus.isRunning = true;
  schedulerStatus.nextRunTime = new Date(Date.now() + intervalMs);
  
  // 立即执行一次
  runEffectTrackingTask().then(result => {
    console.log('效果追踪任务执行完成:', result);
  });
  
  // 设置定时执行
  schedulerInterval = setInterval(async () => {
    schedulerStatus.nextRunTime = new Date(Date.now() + intervalMs);
    const result = await runEffectTrackingTask();
    console.log('效果追踪任务执行完成:', result);
  }, intervalMs);
  
  console.log(`效果追踪定时任务已启动，执行间隔: ${intervalMs / 1000 / 60} 分钟`);
}

/**
 * 停止定时任务
 */
export function stopScheduler(): void {
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
 * 生成效果追踪报告
 */
export async function generateEffectTrackingReport(options: {
  startDate?: Date;
  endDate?: Date;
  campaignId?: string;
  performanceGroupId?: number;
}): Promise<{
  summary: {
    totalRecords: number;
    recordsWith7DayData: number;
    recordsWith14DayData: number;
    recordsWith30DayData: number;
    totalEstimatedProfit: number;
    totalActual7DayProfit: number;
    totalActual14DayProfit: number;
    totalActual30DayProfit: number;
    averageAccuracy7Day: number;
    averageAccuracy14Day: number;
    averageAccuracy30Day: number;
  };
  records: any[];
  algorithmPerformance: {
    mae7Day: number;
    mae14Day: number;
    mae30Day: number;
    rmse7Day: number;
    rmse14Day: number;
    rmse30Day: number;
    hitRate7Day: number;
    hitRate14Day: number;
    hitRate30Day: number;
  };
}> {
  try {
    // 构建查询条件
    const db = await getDb();
    if (!db) throw new Error('Database not available');
    
    let query = db.select().from(bidAdjustmentHistory);
    
    // 获取所有记录
    const records = await query;
    
    // 过滤条件
    let filteredRecords = records;
    
    if (options.startDate) {
      filteredRecords = filteredRecords.filter((r: any) => 
        new Date(r.adjustedAt!) >= options.startDate!
      );
    }
    
    if (options.endDate) {
      filteredRecords = filteredRecords.filter((r: any) => 
        new Date(r.adjustedAt!) <= options.endDate!
      );
    }
    
    if (options.campaignId) {
      filteredRecords = filteredRecords.filter((r: any) => 
        r.campaignId === options.campaignId
      );
    }
    
    if (options.performanceGroupId) {
      filteredRecords = filteredRecords.filter((r: any) => 
        r.performanceGroupId === options.performanceGroupId
      );
    }
    
    // 计算汇总统计
    const recordsWith7DayData = filteredRecords.filter((r: any) => r.actualProfit7D !== null);
    const recordsWith14DayData = filteredRecords.filter((r: any) => r.actualProfit14D !== null);
    const recordsWith30DayData = filteredRecords.filter((r: any) => r.actualProfit30D !== null);
    
    const totalEstimatedProfit = filteredRecords.reduce((sum: number, r: any) => 
      sum + (r.expectedProfitIncrease || 0), 0
    );
    const totalActual7DayProfit = recordsWith7DayData.reduce((sum: number, r: any) => 
      sum + (r.actualProfit7D || 0), 0
    );
    const totalActual14DayProfit = recordsWith14DayData.reduce((sum: number, r: any) => 
      sum + (r.actualProfit14D || 0), 0
    );
    const totalActual30DayProfit = recordsWith30DayData.reduce((sum: number, r: any) => 
      sum + (r.actualProfit30D || 0), 0
    );
    
    // 计算准确度
    const accuracies7Day = recordsWith7DayData.map((r: any) => 
      calculateProfitAccuracy(r.expectedProfitIncrease || 0, r.actualProfit7D || 0)
    );
    const accuracies14Day = recordsWith14DayData.map((r: any) => 
      calculateProfitAccuracy(r.expectedProfitIncrease || 0, r.actualProfit14D || 0)
    );
    const accuracies30Day = recordsWith30DayData.map((r: any) => 
      calculateProfitAccuracy(r.expectedProfitIncrease || 0, r.actualProfit30D || 0)
    );
    
    const averageAccuracy7Day = accuracies7Day.length > 0 
      ? accuracies7Day.reduce((a: number, b: number) => a + b, 0) / accuracies7Day.length 
      : 0;
    const averageAccuracy14Day = accuracies14Day.length > 0 
      ? accuracies14Day.reduce((a: number, b: number) => a + b, 0) / accuracies14Day.length 
      : 0;
    const averageAccuracy30Day = accuracies30Day.length > 0 
      ? accuracies30Day.reduce((a: number, b: number) => a + b, 0) / accuracies30Day.length 
      : 0;
    
    // 计算算法性能指标
    // MAE (Mean Absolute Error)
    const mae7Day = recordsWith7DayData.length > 0
      ? recordsWith7DayData.reduce((sum: number, r: any) => 
          sum + Math.abs((r.expectedProfitIncrease || 0) - (r.actualProfit7D || 0)), 0
        ) / recordsWith7DayData.length
      : 0;
    const mae14Day = recordsWith14DayData.length > 0
      ? recordsWith14DayData.reduce((sum: number, r: any) => 
          sum + Math.abs((r.expectedProfitIncrease || 0) - (r.actualProfit14D || 0)), 0
        ) / recordsWith14DayData.length
      : 0;
    const mae30Day = recordsWith30DayData.length > 0
      ? recordsWith30DayData.reduce((sum: number, r: any) => 
          sum + Math.abs((r.expectedProfitIncrease || 0) - (r.actualProfit30D || 0)), 0
        ) / recordsWith30DayData.length
      : 0;
    
    // RMSE (Root Mean Square Error)
    const rmse7Day = recordsWith7DayData.length > 0
      ? Math.sqrt(recordsWith7DayData.reduce((sum: number, r: any) => 
          sum + Math.pow((r.expectedProfitIncrease || 0) - (r.actualProfit7D || 0), 2), 0
        ) / recordsWith7DayData.length)
      : 0;
    const rmse14Day = recordsWith14DayData.length > 0
      ? Math.sqrt(recordsWith14DayData.reduce((sum: number, r: any) => 
          sum + Math.pow((r.expectedProfitIncrease || 0) - (r.actualProfit14D || 0), 2), 0
        ) / recordsWith14DayData.length)
      : 0;
    const rmse30Day = recordsWith30DayData.length > 0
      ? Math.sqrt(recordsWith30DayData.reduce((sum: number, r: any) => 
          sum + Math.pow((r.expectedProfitIncrease || 0) - (r.actualProfit30D || 0), 2), 0
        ) / recordsWith30DayData.length)
      : 0;
    
    // Hit Rate (预测方向正确率)
    const hitRate7Day = recordsWith7DayData.length > 0
      ? recordsWith7DayData.filter((r: any) => {
          const est = r.expectedProfitIncrease || 0;
          const act = r.actualProfit7D || 0;
          return (est >= 0 && act >= 0) || (est < 0 && act < 0);
        }).length / recordsWith7DayData.length * 100
      : 0;
    const hitRate14Day = recordsWith14DayData.length > 0
      ? recordsWith14DayData.filter((r: any) => {
          const est = r.expectedProfitIncrease || 0;
          const act = r.actualProfit14D || 0;
          return (est >= 0 && act >= 0) || (est < 0 && act < 0);
        }).length / recordsWith14DayData.length * 100
      : 0;
    const hitRate30Day = recordsWith30DayData.length > 0
      ? recordsWith30DayData.filter((r: any) => {
          const est = r.expectedProfitIncrease || 0;
          const act = r.actualProfit30D || 0;
          return (est >= 0 && act >= 0) || (est < 0 && act < 0);
        }).length / recordsWith30DayData.length * 100
      : 0;
    
    return {
      summary: {
        totalRecords: filteredRecords.length,
        recordsWith7DayData: recordsWith7DayData.length,
        recordsWith14DayData: recordsWith14DayData.length,
        recordsWith30DayData: recordsWith30DayData.length,
        totalEstimatedProfit,
        totalActual7DayProfit,
        totalActual14DayProfit,
        totalActual30DayProfit,
        averageAccuracy7Day,
        averageAccuracy14Day,
        averageAccuracy30Day,
      },
      records: filteredRecords,
      algorithmPerformance: {
        mae7Day,
        mae14Day,
        mae30Day,
        rmse7Day,
        rmse14Day,
        rmse30Day,
        hitRate7Day,
        hitRate14Day,
        hitRate30Day,
      },
    };
  } catch (error) {
    console.error('生成效果追踪报告失败:', error);
    throw error;
  }
}

export default {
  startScheduler,
  stopScheduler,
  getSchedulerStatus,
  runEffectTrackingTask,
  generateEffectTrackingReport,
  calculateDaysSinceAdjustment,
  shouldCollectData,
  calculateActualProfit,
  calculateProfitAccuracy,
  aggregateTrackingStats,
};
