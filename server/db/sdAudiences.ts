/**
 * v512: SD受众投放管理
 * 新增DB子模块 - 支持SD Audience Targeting的查询和更新
 */

import { eq, inArray, and, ne } from 'drizzle-orm';
import { InsertSdAudience, sdAudiences } from '../../drizzle/schema';
import { getDb } from './connection';

// ==================== SD Audience Functions ====================

/**
 * 根据广告组ID获取SD受众定向
 * 过滤archived状态的受众
 */
export async function getSdAudiencesByAdGroupId(adGroupId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(sdAudiences).where(
    and(
      eq(sdAudiences.internalAdGroupId, adGroupId),
      ne(sdAudiences.state, 'archived')
    )
  );
}

/**
 * 批量获取多个广告组的SD受众定向
 * v512: 用于bidOptimizationExecutor批量查询
 */
export async function getSdAudiencesByAdGroupIds(adGroupIds: number[]) {
  const db = await getDb();
  if (!db || adGroupIds.length === 0) return [];
  
  return db.select().from(sdAudiences).where(
    and(
      inArray(sdAudiences.internalAdGroupId, adGroupIds),
      ne(sdAudiences.state, 'archived')
    )
  );
}

/**
 * 根据ID获取单个SD受众
 */
export async function getSdAudienceById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  
  const result = await db.select().from(sdAudiences).where(eq(sdAudiences.id, id)).limit(1);
  return result[0];
}

/**
 * 更新SD受众出价
 */
export async function updateSdAudienceBid(id: number, newBid: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(sdAudiences).set({ bid: newBid }).where(eq(sdAudiences.id, id));
}

/**
 * 更新SD受众记录
 */
export async function updateSdAudience(id: number, data: Partial<InsertSdAudience>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(sdAudiences).set(data).where(eq(sdAudiences.id, id));
}

/**
 * 根据账号ID获取所有启用的SD受众
 * v512: 用于全账号级别的受众优化扫描
 */
export async function getEnabledSdAudiencesByAccountId(accountId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(sdAudiences).where(
    and(
      eq(sdAudiences.accountId, accountId),
      eq(sdAudiences.state, 'enabled')
    )
  );
}
