/**
 * v361: 广告组管理
 * 从db.ts拆分的子模块
 */

import { eq, not } from 'drizzle-orm';
import { InsertAdGroup, Keyword, adGroups } from '../../drizzle/schema';
import { getDb } from './connection';
import { guardCampaignIdParam } from '../utils/idTypes';

// ==================== Ad Group Functions ====================
export async function createAdGroup(adGroup: InsertAdGroup) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(adGroups).values(adGroup);
  return result[0].insertId;
}

export async function getAdGroupsByCampaignId(campaignId: number | string) {
  const db = await getDb();
  if (!db) return [];
  
  // v208: 入口守卫 — campaignId必须是Amazon ID（varchar），不能是本地int
  const campaignIdStr = guardCampaignIdParam(campaignId, 'getAdGroupsByCampaignId');
  return db.select().from(adGroups).where(eq(adGroups.campaignId, campaignIdStr));
}

export async function getAdGroupById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  
  const result = await db.select().from(adGroups).where(eq(adGroups.id, id)).limit(1);
  return result[0];
}

export async function updateAdGroupDefaultBid(id: number, defaultBid: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(adGroups).set({ defaultBid }).where(eq(adGroups.id, id));
}

export async function updateAdGroupStatus(id: number, status: 'enabled' | 'paused' | 'archived') {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(adGroups).set({ adGroupStatus: status }).where(eq(adGroups.id, id));
}

// ==================== Keyword Functions ====================
