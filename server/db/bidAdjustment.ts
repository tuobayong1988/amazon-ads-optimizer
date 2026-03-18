/**
 * v361: 竞价调整历史
 * 从db.ts拆分的子模块
 */

import { and, count, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { getDb } from './connection';
import { createModuleLogger } from '../utils/logger';
import { bidAdjustmentHistory, keywords } from '../../drizzle/schema';
import { guardCampaignIdInsert } from '../utils/idTypes';

const log = createModuleLogger('DB:bidAdjustment');

// ==================== 历史趋势数据查询 ====================
// 获取关键词历史数据
// 注意：当前 dailyPerformance 表没有 targetType 和 targetId 字段
// 返回空数组，让前端使用模拟数据
export async function getKeywordHistoryData(keywordId: number, days: number) {
  // TODO: 待数据库表结构更新后实现真实数据查询
  return [];
}

// 获取商品定向历史数据
// 注意：当前 dailyPerformance 表没有 targetType 和 targetId 字段
// 返回空数组，让前端使用模拟数据

// 获取商品定向历史数据
// 注意：当前 dailyPerformance 表没有 targetType 和 targetId 字段
// 返回空数组，让前端使用模拟数据
export async function getProductTargetHistoryData(targetId: number, days: number) {
  // TODO: 待数据库表结构更新后实现真实数据查询
  return [];
}


// ==================== 出价调整历史记录 ====================

// 记录出价调整历史

// ==================== 出价调整历史记录 ====================

// 记录出价调整历史
export async function recordBidAdjustment(data: {
  accountId: number;
  campaignId?: number;
  campaignName?: string;
  performanceGroupId?: number;
  performanceGroupName?: string;
  keywordId?: number;
  keywordText?: string;
  matchType?: string;
  previousBid: number;
  newBid: number;
  adjustmentType: 'manual' | 'auto_optimal' | 'auto_dayparting' | 'auto_placement' | 'batch_campaign' | 'batch_group';
  adjustmentReason?: string;
  expectedProfitIncrease?: number;
  optimizationScore?: number;
  appliedBy?: string;
  status?: 'applied' | 'pending' | 'failed' | 'rolled_back';
  errorMessage?: string;
}) {
  const db = await getDb();
  if (!db) return null;
  
  const bidChangePercent = data.previousBid > 0 
    ? ((data.newBid - data.previousBid) / data.previousBid * 100)
    : 100;
  
  // @ts-expect-error - Drizzle query builder type
  const result = await db.insert(bidAdjustmentHistory).values({
    accountId: data.accountId,
    campaignId: data.campaignId,
    campaignName: data.campaignName,
    performanceGroupId: data.performanceGroupId,
    performanceGroupName: data.performanceGroupName,
    keywordId: data.keywordId,
    keywordText: data.keywordText,
    matchType: data.matchType,
    previousBid: String(data.previousBid),
    newBid: String(data.newBid),
    bidChangePercent: String(Math.round(bidChangePercent * 100) / 100),
    adjustmentType: data.adjustmentType,
    adjustmentReason: data.adjustmentReason,
    expectedProfitIncrease: data.expectedProfitIncrease ? String(data.expectedProfitIncrease) : null,
    optimizationScore: data.optimizationScore,
    appliedBy: data.appliedBy,
    status: data.status || 'applied',
    errorMessage: data.errorMessage,
  } as Record<string, any>);
  
  // v145: 双写到统一优化事件表
  try {
    const bidChange = data.newBid - data.previousBid;
    const statusMap: Record<string, string> = {
      'applied': 'success', 'pending': 'pending', 'failed': 'failed', 'rolled_back': 'rolled_back'
    };
    // @ts-expect-error - Drizzle query builder type
    await db.insert(optimizationEvents).values({
      performanceGroupId: data.performanceGroupId,
      performanceGroupName: data.performanceGroupName,
      accountId: data.accountId,
      eventCategory: 'bid_adjustment',
      actionType: bidChange > 0 ? 'bid_increase' : bidChange < 0 ? 'bid_decrease' : 'bid_set',
      campaignId: data.campaignId != null ? guardCampaignIdInsert(data.campaignId, 'optimization_events(bidAdjustment)') : null,
      campaignName: data.campaignName,
      keywordId: data.keywordId,
      keywordText: data.keywordText,
      matchType: data.matchType,
      previousBid: String(data.previousBid),
      newBid: String(data.newBid),
      bidChangePercent: String(Math.round(bidChangePercent * 100) / 100),
      changeReason: data.adjustmentReason,
      adjustmentType: data.adjustmentType,
      algorithmVersion: undefined,
      optimizationScore: data.optimizationScore,
      expectedProfitIncrease: data.expectedProfitIncrease ? String(data.expectedProfitIncrease) : undefined,
      status: (statusMap[data.status || 'applied'] || 'success') as unknown,
      apiSyncStatus: 'synced',
      errorMessage: data.errorMessage,
      sourceTable: 'bid_adjustment_history',
      sourceId: Number(result[0]?.insertId || 0),
    });
  } catch (e) {
    log.error('[v145] 双写optimization_events失败(bidAdjustment):', e);
  }
  
  return result;
}

// 批量记录出价调整历史

// 批量记录出价调整历史
export async function recordBidAdjustmentBatch(records: Array<{
  accountId: number;
  campaignId?: number;
  campaignName?: string;
  performanceGroupId?: number;
  performanceGroupName?: string;
  keywordId?: number;
  keywordText?: string;
  matchType?: string;
  previousBid: number;
  newBid: number;
  adjustmentType: 'manual' | 'auto_optimal' | 'auto_dayparting' | 'auto_placement' | 'batch_campaign' | 'batch_group';
  adjustmentReason?: string;
  expectedProfitIncrease?: number;
  optimizationScore?: number;
  appliedBy?: string;
  status?: 'applied' | 'pending' | 'failed' | 'rolled_back';
  errorMessage?: string;
}>) {
  const db = await getDb();
  if (!db || records.length === 0) return null;
  
  const values = records.map(data => {
    const bidChangePercent = data.previousBid > 0 
      ? ((data.newBid - data.previousBid) / data.previousBid * 100)
      : 100;
    
    return {
      accountId: data.accountId,
      campaignId: data.campaignId,
      campaignName: data.campaignName,
      performanceGroupId: data.performanceGroupId,
      performanceGroupName: data.performanceGroupName,
      keywordId: data.keywordId,
      keywordText: data.keywordText,
      matchType: data.matchType,
      previousBid: String(data.previousBid),
      newBid: String(data.newBid),
      bidChangePercent: String(Math.round(bidChangePercent * 100) / 100),
      adjustmentType: data.adjustmentType,
      adjustmentReason: data.adjustmentReason,
      expectedProfitIncrease: data.expectedProfitIncrease ? String(data.expectedProfitIncrease) : null,
      optimizationScore: data.optimizationScore,
      appliedBy: data.appliedBy,
      status: data.status || 'applied',
      errorMessage: data.errorMessage,
    };
  });
  
  // @ts-expect-error - Drizzle query builder type
  const result = await db.insert(bidAdjustmentHistory).values(values as unknown);
  return result;
}

// 获取出价调整历史记录（支持筛选和分页）

// 获取出价调整历史记录（支持筛选和分页）
export async function getBidAdjustmentHistory(params: {
  accountId: number;
  campaignId?: number;
  performanceGroupId?: number;
  adjustmentType?: 'manual' | 'auto_optimal' | 'auto_dayparting' | 'auto_placement' | 'batch_campaign' | 'batch_group';
  startDate?: string;
  endDate?: string;
  page?: number;
  pageSize?: number;
}) {
  const db = await getDb();
  if (!db) return { records: [], total: 0, page: 1, pageSize: 50 };
  
  const page = params.page || 1;
  const pageSize = params.pageSize || 50;
  const offset = (page - 1) * pageSize;
  
  // 构建查询条件
  const conditions = [eq(bidAdjustmentHistory.accountId, params.accountId)];
  
  if (params.campaignId) {
    conditions.push(eq(bidAdjustmentHistory.campaignId, String(params.campaignId)));
  }
  
  if (params.performanceGroupId) {
    conditions.push(eq(bidAdjustmentHistory.performanceGroupId, params.performanceGroupId));
  }
  
  if (params.adjustmentType) {
    conditions.push(eq(bidAdjustmentHistory.adjustmentType, params.adjustmentType));
  }
  
  if (params.startDate) {
    conditions.push(gte(bidAdjustmentHistory.appliedAt, params.startDate));
  }
  
  if (params.endDate) {
    conditions.push(lte(bidAdjustmentHistory.appliedAt, params.endDate));
  }
  
  // 获取总数
  const countResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(bidAdjustmentHistory)
    .where(and(...conditions));
  
  const total = countResult[0]?.count || 0;
  
  // 获取记录
  const records = await db
    .select()
    .from(bidAdjustmentHistory)
    .where(and(...conditions))
    .orderBy(desc(bidAdjustmentHistory.appliedAt))
    .limit(pageSize)
    .offset(offset);
  
  return {
    records,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

// 获取出价调整统计数据

// 获取出价调整统计数据
export async function getBidAdjustmentStats(accountId: number, days: number = 30) {
  const db = await getDb();
  if (!db) return null;
  
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const startDateStr = startDate.toISOString().slice(0, 19).replace('T', ' ');
  
  // 获取各类型调整数量
  const typeStats = await db
    .select({
      adjustmentType: bidAdjustmentHistory.adjustmentType,
      count: sql<number>`count(*)`,
      totalProfitIncrease: sql<number>`COALESCE(SUM(expected_profit_increase), 0)`,
    })
    .from(bidAdjustmentHistory)
    .where(and(
      eq(bidAdjustmentHistory.accountId, accountId),
      gte(bidAdjustmentHistory.appliedAt, startDateStr)
    ))
    .groupBy(bidAdjustmentHistory.adjustmentType);
  
  // 获取每日调整数量趋势
  const dailyTrend = await db
    .select({
      date: sql<string>`DATE(applied_at)`,
      count: sql<number>`count(*)`,
      avgBidChange: sql<number>`AVG(bid_change_percent)`,
    })
    .from(bidAdjustmentHistory)
    .where(and(
      eq(bidAdjustmentHistory.accountId, accountId),
      gte(bidAdjustmentHistory.appliedAt, startDateStr)
    ))
    .groupBy(sql`DATE(applied_at)`)
    .orderBy(sql`DATE(applied_at)`);
  
  // 获取总体统计
  const overallStats = await db
    .select({
      totalAdjustments: sql<number>`count(*)`,
      totalProfitIncrease: sql<number>`COALESCE(SUM(expected_profit_increase), 0)`,
      avgBidChange: sql<number>`AVG(bid_change_percent)`,
      increasedCount: sql<number>`SUM(CASE WHEN bid_change_percent > 0 THEN 1 ELSE 0 END)`,
      decreasedCount: sql<number>`SUM(CASE WHEN bid_change_percent < 0 THEN 1 ELSE 0 END)`,
    })
    .from(bidAdjustmentHistory)
    .where(and(
      eq(bidAdjustmentHistory.accountId, accountId),
      gte(bidAdjustmentHistory.appliedAt, startDateStr)
    ));
  
  return {
    typeStats,
    dailyTrend,
    overall: overallStats[0] || {
      totalAdjustments: 0,
      totalProfitIncrease: 0,
      avgBidChange: 0,
      increasedCount: 0,
      decreasedCount: 0,
    },
    period: {
      days,
      startDate: startDateStr,
      endDate: new Date().toISOString().slice(0, 19).replace('T', ' '),
    },
  };
}


// 回滚出价调整

// 回滚出价调整
export async function rollbackBidAdjustment(adjustmentId: number, userId: string) {
  const db = await getDb();
  if (!db) return null;
  
  // 获取原始调整记录
  const [adjustment] = await db.select().from(bidAdjustmentHistory).where(eq(bidAdjustmentHistory.id, adjustmentId));
  if (!adjustment) return null;
  
  // 更新关键词出价为之前的值
  if (adjustment.keywordId) {
    await db.update(keywords)
      .set({ bid: adjustment.previousBid })
      .where(eq(keywords.id, adjustment.keywordId));
  }
  
  // 更新调整记录状态为已回滚
  await db.update(bidAdjustmentHistory)
    .set({
      status: 'rolled_back',
      rolledBackAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      rolledBackBy: userId,
    })
    .where(eq(bidAdjustmentHistory.id, adjustmentId));
  
  // 记录一条新的回滚操作历史
  await db.insert(bidAdjustmentHistory).values({
    accountId: adjustment.accountId,
    campaignId: adjustment.campaignId,
    campaignName: adjustment.campaignName,
    performanceGroupId: adjustment.performanceGroupId,
    performanceGroupName: adjustment.performanceGroupName,
    keywordId: adjustment.keywordId,
    keywordText: adjustment.keywordText,
    matchType: adjustment.matchType,
    previousBid: adjustment.newBid, // 回滚前是新出价
    newBid: adjustment.previousBid, // 回滚后是原出价
    bidChangePercent: String(-Number(adjustment.bidChangePercent || 0)),
    adjustmentType: 'manual',
    adjustmentReason: `回滚调整 #${adjustmentId}`,
    appliedBy: userId,
    status: 'applied',
  });
  
  return { success: true, adjustmentId };
}

// 获取单条调整记录详情

// 获取单条调整记录详情
export async function getBidAdjustmentById(adjustmentId: number) {
  const db = await getDb();
  if (!db) return null;
  
  const [adjustment] = await db.select().from(bidAdjustmentHistory).where(eq(bidAdjustmentHistory.id, adjustmentId));
  return adjustment || null;
}

// 更新效果追踪数据

// 更新效果追踪数据
export async function updateBidAdjustmentTracking(adjustmentId: number, trackingData: {
  actualProfit7D?: number;
  actualProfit14D?: number;
  actualProfit30D?: number;
  actualImpressions7D?: number;
  actualClicks7D?: number;
  actualConversions7D?: number;
  actualSpend7D?: number;
  actualRevenue7D?: number;
}) {
  const db = await getDb();
  if (!db) return null;
  
  await db.update(bidAdjustmentHistory)
    .set({
      actualProfit7D: trackingData.actualProfit7D !== undefined ? String(trackingData.actualProfit7D) : undefined,
      actualProfit14D: trackingData.actualProfit14D !== undefined ? String(trackingData.actualProfit14D) : undefined,
      actualProfit30D: trackingData.actualProfit30D !== undefined ? String(trackingData.actualProfit30D) : undefined,
      actualImpressions7D: trackingData.actualImpressions7D,
      actualClicks7D: trackingData.actualClicks7D,
      actualConversions7D: trackingData.actualConversions7D,
      actualSpend7D: trackingData.actualSpend7D !== undefined ? String(trackingData.actualSpend7D) : undefined,
      actualRevenue7D: trackingData.actualRevenue7D !== undefined ? String(trackingData.actualRevenue7D) : undefined,
      trackingUpdatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
    })
    .where(eq(bidAdjustmentHistory.id, adjustmentId));
  
  return { success: true };
}

// 获取需要效果追踪的调整记录（7天前的记录且未追踪）

// 获取需要效果追踪的调整记录（7天前的记录且未追踪）
export async function getAdjustmentsNeedingTracking(daysAgo: number = 7) {
  const db = await getDb();
  if (!db) return [];
  
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysAgo);
  const cutoffDateStr = cutoffDate.toISOString().slice(0, 19).replace('T', ' ');
  
  const results = await db.select()
    .from(bidAdjustmentHistory)
    .where(
      and(
        eq(bidAdjustmentHistory.status, 'applied'),
        sql`${bidAdjustmentHistory.appliedAt} <= ${cutoffDateStr}`,
        sql`${bidAdjustmentHistory.trackingUpdatedAt} IS NULL OR DATE(${bidAdjustmentHistory.trackingUpdatedAt}) < DATE(NOW())`
      )
    )
    .limit(100);
  
  return results;
}

// 批量导入出价调整历史

// 批量导入出价调整历史
export async function importBidAdjustmentHistory(records: Array<{
  accountId: number;
  campaignId?: number;
  campaignName?: string;
  performanceGroupId?: number;
  performanceGroupName?: string;
  keywordId?: number;
  keywordText?: string;
  matchType?: string;
  previousBid: number;
  newBid: number;
  adjustmentType: 'manual' | 'auto_optimal' | 'auto_dayparting' | 'auto_placement' | 'batch_campaign' | 'batch_group';
  adjustmentReason?: string;
  expectedProfitIncrease?: number;
  appliedBy?: string;
  appliedAt?: string;
  status?: 'applied' | 'pending' | 'failed' | 'rolled_back';
}>) {
  const db = await getDb();
  if (!db || records.length === 0) return { success: false, imported: 0, errors: [] };
  
  const errors: Array<{ row: number; error: string }> = [];
  const validRecords: any[] = [];
  
  records.forEach((record: any, index: any) => {
    // 验证必填字段
    if (!record.accountId) {
      errors.push({ row: index + 1, error: '缺少账号ID' });
      return;
    }
    if (record.previousBid === undefined || record.newBid === undefined) {
      errors.push({ row: index + 1, error: '缺少出价数据' });
      return;
    }
    
    const bidChangePercent = record.previousBid > 0 
      ? ((record.newBid - record.previousBid) / record.previousBid * 100)
      : 100;
    
    validRecords.push({
      accountId: record.accountId,
      campaignId: record.campaignId,
      campaignName: record.campaignName,
      performanceGroupId: record.performanceGroupId,
      performanceGroupName: record.performanceGroupName,
      keywordId: record.keywordId,
      keywordText: record.keywordText,
      matchType: record.matchType,
      previousBid: String(record.previousBid),
      newBid: String(record.newBid),
      bidChangePercent: String(Math.round(bidChangePercent * 100) / 100),
      adjustmentType: record.adjustmentType || 'manual',
      adjustmentReason: record.adjustmentReason || '批量导入',
      expectedProfitIncrease: record.expectedProfitIncrease ? String(record.expectedProfitIncrease) : null,
      appliedBy: record.appliedBy || 'import',
      appliedAt: record.appliedAt || new Date().toISOString().slice(0, 19).replace('T', ' '),
      status: record.status || 'applied',
    });
  });
  
  if (validRecords.length > 0) {
    await db.insert(bidAdjustmentHistory).values(validRecords);
  }
  
  return {
    success: true,
    imported: validRecords.length,
    skipped: errors.length,
    errors,
  };
}

// 获取效果追踪统计

// 获取效果追踪统计
export async function getBidAdjustmentTrackingStats(accountId: number, days: number = 30) {
  const db = await getDb();
  if (!db) return null;
  
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  const cutoffDateStr = cutoffDate.toISOString().slice(0, 19).replace('T', ' ');
  
  const results = await db.select()
    .from(bidAdjustmentHistory)
    .where(
      and(
        eq(bidAdjustmentHistory.accountId, accountId),
        eq(bidAdjustmentHistory.status, 'applied'),
        sql`${bidAdjustmentHistory.appliedAt} >= ${cutoffDateStr}`,
        sql`${bidAdjustmentHistory.actualProfit7D} IS NOT NULL`
      )
    );
  
  // 计算统计数据
  let totalExpectedProfit = 0;
  let totalActualProfit7d = 0;
  let totalActualProfit14d = 0;
  let totalActualProfit30d = 0;
  let trackedCount = 0;
  
  results.forEach(r => {
    totalExpectedProfit += Number(r.expectedProfitIncrease || 0);
    totalActualProfit7d += Number(r.actualProfit7D || 0);
    totalActualProfit14d += Number(r.actualProfit14D || 0);
    totalActualProfit30d += Number(r.actualProfit30D || 0);
    trackedCount++;
  });
  
  return {
    trackedCount,
    totalExpectedProfit: Math.round(totalExpectedProfit * 100) / 100,
    totalActualProfit7d: Math.round(totalActualProfit7d * 100) / 100,
    totalActualProfit14d: Math.round(totalActualProfit14d * 100) / 100,
    totalActualProfit30d: Math.round(totalActualProfit30d * 100) / 100,
    accuracy7d: trackedCount > 0 && totalExpectedProfit > 0 
      ? Math.round((totalActualProfit7d / totalExpectedProfit) * 100) 
      : 0,
  };
}


// ==================== 同步历史记录相关函数 ====================

/**
 * 创建同步任务记录
 */
