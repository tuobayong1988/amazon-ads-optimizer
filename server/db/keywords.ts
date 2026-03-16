/**
 * v361: 关键词管理
 * 从db.ts拆分的子模块
 */

import { eq, inArray, not } from 'drizzle-orm';
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
  
  return db.select().from(keywords).where(eq(keywords.internalAdGroupId, Number(adGroupId)));
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
  
  // v357: adGroupId现在是varchar类型，需要转换为string数组
  const adGroupIds = adGroupsList.map(ag => String(ag.id));
  const allKeywords = await db.select().from(keywords).where(inArray(keywords.internalAdGroupId, adGroupIds));
  
  return allKeywords;
}

// ==================== Product Target Functions ====================
