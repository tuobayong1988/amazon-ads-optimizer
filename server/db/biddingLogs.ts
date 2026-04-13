/**
 * v361: 竞价日志管理
 * 从db.ts拆分的子模块
 */

import { count, desc, eq, not, sql } from 'drizzle-orm';
import { InsertBiddingLog, biddingLogs, optimizationEvents } from '../../drizzle/schema';
import { getDb } from './connection';
import { createModuleLogger } from '../utils/logger';

const log = createModuleLogger('DB:biddingLogs');

// ==================== Bidding Log Functions ====================
export async function createBiddingLog(log: InsertBiddingLog) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // v222: 使用统一解析器确保 campaignId 有效
  const { safeCampaignIdForInsert } = await import('../utils/campaignIdResolver');
  const safeCampaignId = await safeCampaignIdForInsert({
    campaignId: log.campaignId,
    targetLocalId: log.targetId ? Number(log.targetId) : undefined,
    // @ts-expect-error - dynamic property access
    targetType: (log as Record<string, unknown>).logTargetType || 'keyword',
    adGroupId: (log as Record<string, unknown>).internalAdGroupId ? Number((log as Record<string, unknown>).internalAdGroupId) : undefined,
    caller: 'createBiddingLog',
  });
  // @ts-expect-error - type assertion
  log.campaignId = safeCampaignId as unknown;
  
  const result = await db.insert(biddingLogs).values(log);
  const logId = result[0].insertId;
  
  // v145: 双写到统一优化事件表
  try {
    const bidChange = Number(log.newBid || 0) - Number(log.previousBid || 0);
    // @ts-expect-error DB query type inference limitation
    await db.insert(optimizationEvents).values({
      accountId: log.accountId || 0,
      eventCategory: 'bid_adjustment',
      actionType: bidChange > 0 ? 'bid_increase' : bidChange < 0 ? 'bid_decrease' : 'bid_set',
      // v438: campaignId存储为字符串，避免Amazon ID转Number时精度丢失或溢出
      campaignId: safeCampaignId != null ? String(safeCampaignId) : null,
      campaignName: (log as Record<string, unknown>).campaignName as string || null,
      keywordId: log.targetId,
      keywordText: (log as Record<string, unknown>).keywordText as string || null,
      matchType: log.logMatchType as string || null,
      previousBid: String(log.previousBid || 0),
      newBid: String(log.newBid || 0),
      bidChangePercent: Number(log.previousBid) > 0 ? String(Math.round(bidChange / Number(log.previousBid) * 10000) / 100) : '0',
      changeReason: log.reason as string || null,
      adjustmentType: log.actionType as string || null,
      status: 'success',
      apiSyncStatus: 'not_applicable',
      sourceTable: 'bidding_logs',
      sourceId: Number(logId),
    });
  } catch (e: any) {
    // @ts-expect-error - dynamic property access
    (log as Record<string, unknown>).error('[v145] 双写optimization_events失败(biddingLog):', e);
  }
  
  return logId;
}

export async function getBiddingLogsByAccountId(accountId: number, limit = 100, offset = 0) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select()
    .from(biddingLogs)
    .where(eq(biddingLogs.accountId, accountId))
    .orderBy(desc(biddingLogs.createdAt))
    .limit(limit)
    .offset(offset);
}

export async function getBiddingLogsByCampaignId(campaignId: number | string, limit = 100) {
  const db = await getDb();
  if (!db) return [];
  
  // v186: biddingLogs.campaignId在DB中是varchar类型
  return db.select()
    .from(biddingLogs)
    .where(eq(biddingLogs.campaignId, String(campaignId)))
    .orderBy(desc(biddingLogs.createdAt))
    .limit(limit);
}

export async function getBiddingLogsCount(accountId: number) {
  const db = await getDb();
  if (!db) return 0;
  
  const result = await db.select({ count: sql<number>`count(*)` })
    .from(biddingLogs)
    .where(eq(biddingLogs.accountId, accountId));
  return result[0]?.count || 0;
}

// ==================== Daily Performance Functions ====================
/**
 * v361: UPSERT模式 - 基于唯一约束避免重复插入
 */
