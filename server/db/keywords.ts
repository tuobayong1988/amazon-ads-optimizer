/**
 * v361: 关键词管理
 * 从db.ts拆分的子模块
 */

import { eq, inArray, not, and, ne } from 'drizzle-orm';
import { InsertKeyword, Keyword, adGroups, keywords } from '../../drizzle/schema';
import { getDb } from './connection';
import { guardCampaignIdParam } from '../utils/idTypes';

// ==================== Keyword Functions ====================
export async function createKeyword(keyword: InsertKeyword) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(keywords).values(keyword);
  return result[0].insertId;
}

// v357: adGroupId参数类型改为string | number，内部转换为string

// v357: adGroupId参数类型改为string | number，内部转换为string
export async function getKeywordsByAdGroupId(adGroupId: number | string) {
  const db = await getDb();
  if (!db) return [];
  
  // v444+v454: 过滤archived和amazon_deleted状态的keyword，避免为已删除/已失效实体生成优化任务
  return db.select().from(keywords).where(
    and(
      eq(keywords.internalAdGroupId, Number(adGroupId)),
      ne(keywords.keywordStatus, 'archived'),
      ne(keywords.keywordStatus, 'amazon_deleted')
    )
  );
}

export async function getKeywordById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  
  const result = await db.select().from(keywords).where(eq(keywords.id, id)).limit(1);
  return result[0];
}

export async function updateKeywordBid(id: number, newBid: number | string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const bidValue = typeof newBid === 'number' ? String(newBid) : newBid;
  await db.update(keywords).set({ bid: bidValue }).where(eq(keywords.id, id));
}

export async function updateKeyword(id: number, data: Partial<InsertKeyword>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(keywords).set(data).where(eq(keywords.id, id));
}

export async function getKeywordsByCampaignId(campaignId: string | number) {
  const db = await getDb();
  if (!db) return [];
  
  // v208: 入口守卫 — campaignId必须是Amazon ID（varchar）
  const campaignIdStr = guardCampaignIdParam(campaignId, 'getKeywordsByCampaignId');
  
  // 先获取该广告活动下的所有广告组
  const adGroupsList = await db.select().from(adGroups).where(eq(adGroups.campaignId, campaignIdStr));
  
  if (adGroupsList.length === 0) return [];
  
  // v421: internalAdGroupId是int类型，直接使用int数组
  const adGroupIds = adGroupsList.map(ag => ag.id);
  // v444+v454: 过滤archived和amazon_deleted状态的keyword，避免为已删除/已失效实体生成优化任务
  const allKeywords = await db.select().from(keywords).where(
    and(
      inArray(keywords.internalAdGroupId, adGroupIds),
      ne(keywords.keywordStatus, 'archived'),
      ne(keywords.keywordStatus, 'amazon_deleted')
    )
  );
  
  return allKeywords;
}

// ==================== Product Target Functions ====================
