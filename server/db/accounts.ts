/**
 * v361: 账户与绩效组管理
 * 从db.ts拆分的子模块
 */

import { and, count, eq, not } from 'drizzle-orm';
import { Campaign, InsertAdAccount, InsertPerformanceGroup, adAccounts, performanceGroups } from '../../drizzle/schema';
import { getDb } from './connection';
import { createModuleLogger } from '../utils/logger';

const log = createModuleLogger('DB:accounts');

// ==================== Ad Account Functions ====================
export async function createAdAccount(account: InsertAdAccount) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(adAccounts).values(account);
  return result[0].insertId;
}

export async function getAdAccountsByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(adAccounts)
    .where(eq(adAccounts.userId, userId))
    .orderBy(adAccounts.sortOrder, adAccounts.createdAt);
}

/**
 * @deprecated v361: 此函数不进行租户隔离，仅限系统级内部任务使用（如数据迁移、全局调度）。
 * 面向用户的查询请使用 getAdAccountsByUserId(userId) 确保数据隔离。
 */

/**
 * @deprecated v361: 此函数不进行租户隔离，仅限系统级内部任务使用（如数据迁移、全局调度）。
 * 面向用户的查询请使用 getAdAccountsByUserId(userId) 确保数据隔离。
 */
export async function getAdAccounts() {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(adAccounts);
}

export async function getAdAccountById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  
  const result = await db.select().from(adAccounts).where(eq(adAccounts.id, id)).limit(1);
  return result[0];
}

export async function updateAdAccount(id: number, data: Partial<InsertAdAccount>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(adAccounts).set(data).where(eq(adAccounts.id, id));
}

export async function deleteAdAccount(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.delete(adAccounts).where(eq(adAccounts.id, id));
}

export async function setDefaultAdAccount(userId: number, accountId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // 先取消所有默认账号
  await db.update(adAccounts)
    .set({ isDefault: 0 })
    .where(eq(adAccounts.userId, userId));
  
  // 设置新的默认账号
  await db.update(adAccounts)
    .set({ isDefault: 1 })
    .where(eq(adAccounts.id, accountId));
}

export async function getDefaultAdAccount(userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  
  const result = await db.select().from(adAccounts)
    .where(and(eq(adAccounts.userId, userId), eq(adAccounts.isDefault, 1)))
    .limit(1);
  return result[0];
}

export async function updateAdAccountConnectionStatus(
  id: number, 
  status: 'connected' | 'disconnected' | 'error' | 'pending',
  errorMessage?: string
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(adAccounts).set({
    connectionStatus: status,
    lastConnectionCheck: new Date().toISOString(),
    connectionErrorMessage: errorMessage || null,
  }).where(eq(adAccounts.id, id));
}

export async function reorderAdAccounts(userId: number, accountIds: number[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // 批量更新排序顺序
  for (let i = 0; i < accountIds.length; i++) {
    await db.update(adAccounts)
      .set({ sortOrder: i })
      .where(and(eq(adAccounts.id, accountIds[i]), eq(adAccounts.userId, userId)));
  }
}

// ==================== Performance Group Functions ====================

// ==================== Performance Group Functions ====================
export async function createPerformanceGroup(group: InsertPerformanceGroup) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(performanceGroups).values(group);
  return result[0].insertId;
}

export async function getPerformanceGroupsByAccountId(accountId: number) {
  log.debug('[db.getPerformanceGroupsByAccountId] called with accountId:', accountId);
  try {
    const db = await getDb();
    log.debug('[db.getPerformanceGroupsByAccountId] db obtained:', !!db);
    if (!db) {
      log.debug('[db.getPerformanceGroupsByAccountId] db is null, returning empty array');
      return [];
    }
    
    // v398: 使用SQL WHERE子句替代内存过滤，避免500租户场景下加载全表数据
    // 如果accountId为0或未定义，返回所有优化目标
    if (!accountId || accountId === 0) {
      const allRecords = await db.select().from(performanceGroups);
      log.debug('[db.getPerformanceGroupsByAccountId] accountId is 0, returning all:', allRecords.length);
      return allRecords;
    }
    
    // 使用SQL WHERE过滤，避免将全表数据加载到内存
    const result = await db.select().from(performanceGroups).where(eq(performanceGroups.accountId, accountId));
    log.debug('[db.getPerformanceGroupsByAccountId] filtered result count:', result.length);
    return result;
  } catch (error) {
    log.warn('[db.getPerformanceGroupsByAccountId] error:', error);
    return [];
  }
}

export async function getPerformanceGroupById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  
  const result = await db.select().from(performanceGroups).where(eq(performanceGroups.id, id)).limit(1);
  return result[0];
}

export async function updatePerformanceGroup(id: number, data: Partial<InsertPerformanceGroup>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(performanceGroups).set(data).where(eq(performanceGroups.id, id));
}

export async function deletePerformanceGroup(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.delete(performanceGroups).where(eq(performanceGroups.id, id));
}

// ==================== Campaign Functions ====================
