/**
 * v361: 商品投放管理
 * 从db.ts拆分的子模块
 */

import { eq, inArray, not } from 'drizzle-orm';
import { InsertProductTarget, productTargets } from '../../drizzle/schema';
import { getDb } from './connection';

// ==================== Product Target Functions ====================
export async function createProductTarget(target: InsertProductTarget) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(productTargets).values(target);
  return result[0].insertId;
}

// v357: adGroupId参数类型改为string | number

// v357: adGroupId参数类型改为string | number
export async function getProductTargetsByAdGroupId(adGroupId: number | string) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(productTargets).where(eq(productTargets.internalAdGroupId, Number(adGroupId)));
}

// v357: 批量获取多个广告组的商品定向 — adGroupId现在是varchar类型

// v357: 批量获取多个广告组的商品定向 — adGroupId现在是varchar类型
export async function getProductTargetsByAdGroupIds(adGroupIds: (number | string)[]) {
  const db = await getDb();
  if (!db || adGroupIds.length === 0) return [];
  
  // v421: internalAdGroupId是int类型，直接使用Number转换
  return db.select().from(productTargets).where(inArray(productTargets.internalAdGroupId, adGroupIds.map(id => Number(id))));
}

export async function getProductTargetById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  
  const result = await db.select().from(productTargets).where(eq(productTargets.id, id)).limit(1);
  return result[0];
}

export async function updateProductTargetBid(id: number, newBid: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(productTargets).set({ bid: newBid }).where(eq(productTargets.id, id));
}

export async function updateProductTarget(id: number, data: Partial<InsertProductTarget>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(productTargets).set(data).where(eq(productTargets.id, id));
}

// ==================== Bidding Log Functions ====================
