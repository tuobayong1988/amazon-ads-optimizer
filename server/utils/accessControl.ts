/**
 * v370.4: 全面增强的多租户数据隔离 - 实体所有权验证
 * 
 * 提供对所有关键实体（account, campaign, performanceGroup, keyword, adGroup, scheduledTask等）
 * 的所有权验证函数，确保用户只能访问属于自己的数据。
 * 
 * 数据层级关系：
 *   user → ad_accounts (userId)
 *        → campaigns (accountId) → ad_groups (campaignId/accountId) → keywords (adGroupId/accountId)
 *        → performance_groups (accountId, userId)
 *        → scheduled_tasks (userId)
 *        → optimization_logs (account_id)
 */
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { createModuleLogger } from './logger';

const log = createModuleLogger('AccessControl');

// ==================== 缓存层 ====================
const userAccountCache = new Map<number, { accounts: Set<number>; expiry: number }>();
const campaignAccountCache = new Map<number, { accountId: number; expiry: number }>();
const pgOwnershipCache = new Map<number, { accountId: number; userId: number; expiry: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5分钟

// v447: admin角色缓存 - 避免每次验证都查询数据库
const adminUserCache = new Map<number, { isAdmin: boolean; expiry: number }>();
const ADMIN_CACHE_TTL_MS = 10 * 60 * 1000; // 10分钟

/** v452.8: 检查用户是否为系统管理员（带缓存）
 * 必须同时满足: role='admin' 且 organization_id=1(内部组织)
 * 外部租户的admin角色不会被视为系统管理员
 */
export async function isAdminUser(userId: number): Promise<boolean> {
  const cached = adminUserCache.get(userId);
  if (cached && cached.expiry > Date.now()) {
    return cached.isAdmin;
  }
  try {
    const { getDb } = await import('../db/connection');
    const { teamMembers } = await import('../../drizzle/schema');
    const db = await getDb();
    if (!db) return false;
    const rows = await db.select({ role: teamMembers.role, organizationId: teamMembers.organizationId })
      .from(teamMembers).where(eq(teamMembers.id, userId)).limit(1);
    // v452.8: 系统管理员必须是内部组织(org_id=1)的admin
    const isAdmin = rows.length > 0 && rows[0].role === 'admin' && (rows[0].organizationId === 1 || rows[0].organizationId === null);
    adminUserCache.set(userId, { isAdmin, expiry: Date.now() + ADMIN_CACHE_TTL_MS });
    if (!isAdmin && rows.length > 0 && rows[0].role === 'admin') {
      log.info(`[v452.8] 外部租户admin角色不作为系统管理员: userId=${userId}, orgId=${rows[0].organizationId}`);
    }
    return isAdmin;
  } catch {
    return false;
  }
}

// ==================== 基础查询函数 ====================

/** 获取用户拥有的所有accountId集合（带缓存） */
export async function getUserAccountIds(userId: number): Promise<Set<number>> {
  const cached = userAccountCache.get(userId);
  if (cached && cached.expiry > Date.now()) {
    return cached.accounts;
  }

  try {
    const { getDb } = await import('../db/connection');
    const { adAccounts } = await import('../../drizzle/schema');
    const db = await getDb();
    if (!db) return new Set();

    const accounts = await db.select({ id: adAccounts.id })
      .from(adAccounts)
      .where(eq(adAccounts.userId, userId));

    const accountSet = new Set(accounts.map(a => a.id));
    userAccountCache.set(userId, { accounts: accountSet, expiry: Date.now() + CACHE_TTL_MS });
    return accountSet;
  } catch (error) {
    log.warn(`[v370.4] 查询用户 ${userId} 的账户列表失败:`, error);
    return new Set();
  }
}

/** 反查campaign的accountId（带缓存） */
async function getCampaignAccountId(campaignId: number): Promise<number | null> {
  const cached = campaignAccountCache.get(campaignId);
  if (cached && cached.expiry > Date.now()) return cached.accountId;
  try {
    const { getDb } = await import('../db/connection');
    const { campaigns } = await import('../../drizzle/schema');
    const db = await getDb();
    if (!db) return null;
    const [row] = await db.select({ accountId: campaigns.accountId })
      .from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
    if (row) {
      campaignAccountCache.set(campaignId, { accountId: row.accountId, expiry: Date.now() + CACHE_TTL_MS });
      return row.accountId;
    }
    return null;
  } catch { return null; }
}

/** 反查performanceGroup的accountId和userId（带缓存） */
async function getPGOwnership(pgId: number): Promise<{ accountId: number; userId: number } | null> {
  const cached = pgOwnershipCache.get(pgId);
  if (cached && cached.expiry > Date.now()) return { accountId: cached.accountId, userId: cached.userId };
  try {
    const { getDb } = await import('../db/connection');
    const { performanceGroups } = await import('../../drizzle/schema');
    const db = await getDb();
    if (!db) return null;
    const [row] = await db.select({ accountId: performanceGroups.accountId, userId: performanceGroups.userId })
      .from(performanceGroups).where(eq(performanceGroups.id, pgId)).limit(1);
    if (row) {
      pgOwnershipCache.set(pgId, { accountId: row.accountId, userId: row.userId, expiry: Date.now() + CACHE_TTL_MS });
      return { accountId: row.accountId, userId: row.userId };
    }
    return null;
  } catch { return null; }
}

/** 反查keyword的accountId */
async function getKeywordAccountId(keywordId: number): Promise<number | null> {
  try {
    const { getDb } = await import('../db/connection');
    const { keywords } = await import('../../drizzle/schema');
    const db = await getDb();
    if (!db) return null;
    const [row] = await db.select({ accountId: keywords.accountId })
      .from(keywords).where(eq(keywords.id, keywordId)).limit(1);
    return row?.accountId ?? null;
  } catch { return null; }
}

/** 反查adGroup的accountId */
async function getAdGroupAccountId(adGroupId: number): Promise<number | null> {
  try {
    const { getDb } = await import('../db/connection');
    const { adGroups } = await import('../../drizzle/schema');
    const db = await getDb();
    if (!db) return null;
    const [row] = await db.select({ accountId: adGroups.accountId })
      .from(adGroups).where(eq(adGroups.id, adGroupId)).limit(1);
    return row?.accountId ?? null;
  } catch { return null; }
}

/** 反查scheduledTask的userId */
async function getScheduledTaskUserId(taskId: number): Promise<number | null> {
  try {
    const { getDb } = await import('../db/connection');
    const { scheduledTasks } = await import('../../drizzle/schema');
    const db = await getDb();
    if (!db) return null;
    const [row] = await db.select({ userId: scheduledTasks.userId })
      .from(scheduledTasks).where(eq(scheduledTasks.id, taskId)).limit(1);
    return row?.userId ?? null;
  } catch { return null; }
}

// ==================== 验证函数 ====================

/** v667: 获取用户所属组织的所有账户ID集合（带缓存） */
const orgAccountCache = new Map<number, { accounts: Set<number>; expiry: number }>();
async function getOrganizationAccountIds(userId: number): Promise<Set<number>> {
  try {
    const { getDb } = await import('../db/connection');
    const { teamMembers, adAccounts } = await import('../../drizzle/schema');
    const db = await getDb();
    if (!db) return new Set();
    // 先查用户的organizationId
    const userRows = await db.select({ organizationId: teamMembers.organizationId })
      .from(teamMembers).where(eq(teamMembers.id, userId)).limit(1);
    if (!userRows.length || !userRows[0].organizationId) return new Set();
    const orgId = userRows[0].organizationId;
    // 检查缓存
    const cached = orgAccountCache.get(orgId);
    if (cached && cached.expiry > Date.now()) return cached.accounts;
    // 查询组织内所有账户
    const accounts = await db.select({ id: adAccounts.id })
      .from(adAccounts)
      .where(eq(adAccounts.organizationId, orgId));
    const accountSet = new Set(accounts.map(a => a.id));
    orgAccountCache.set(orgId, { accounts: accountSet, expiry: Date.now() + CACHE_TTL_MS });
    return accountSet;
  } catch (error) {
    log.warn(`[v667] 查询用户 ${userId} 的组织账户列表失败:`, error);
    return new Set();
  }
}

/** 验证accountId是否属于指定用户（或其组织） */
export async function verifyAccountAccess(userId: number, accountId: number): Promise<void> {
  if (!accountId || !userId) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: '缺少必要的用户或账户信息' });
  }
  // v667: admin角色也需要验证组织归属，不再无条件跳过
  if (await isAdminUser(userId)) {
    const orgAccounts = await getOrganizationAccountIds(userId);
    if (!orgAccounts.has(accountId)) {
      log.warn(`[v667] 数据隔离拦截(admin-org): 管理员 ${userId} 试图访问不属于其组织的账户 ${accountId}`);
      throw new TRPCError({ code: 'FORBIDDEN', message: '您没有权限访问此账户的数据' });
    }
    return;
  }
  const userAccounts = await getUserAccountIds(userId);
  if (!userAccounts.has(accountId)) {
    log.warn(`[v370.4] 数据隔离拦截(account): 用户 ${userId} 试图访问不属于自己的账户 ${accountId}`);
    throw new TRPCError({ code: 'FORBIDDEN', message: '您没有权限访问此账户的数据' });
  }
}

/** 验证多个accountId是否都属于指定用户（或其组织） */
export async function verifyMultipleAccountAccess(userId: number, accountIds: number[]): Promise<void> {
  if (!accountIds || accountIds.length === 0) return;
  // v667: admin角色也需要验证组织归属
  if (await isAdminUser(userId)) {
    const orgAccounts = await getOrganizationAccountIds(userId);
    for (const accountId of accountIds) {
      if (!orgAccounts.has(accountId)) {
        log.warn(`[v667] 数据隔离拦截(admin-org-batch): 管理员 ${userId} 试图批量访问不属于其组织的账户 ${accountId}`);
        throw new TRPCError({ code: 'FORBIDDEN', message: '您没有权限访问部分账户的数据' });
      }
    }
    return;
  }
  const userAccounts = await getUserAccountIds(userId);
  for (const accountId of accountIds) {
    if (!userAccounts.has(accountId)) {
      log.warn(`[v370.4] 数据隔离拦截(accounts): 用户 ${userId} 试图批量访问不属于自己的账户 ${accountId}`);
      throw new TRPCError({ code: 'FORBIDDEN', message: '您没有权限访问部分账户的数据' });
    }
  }
}

/** v370.4: 验证campaign是否属于指定用户（或其组织） */
export async function verifyCampaignAccess(userId: number, campaignId: number): Promise<void> {
  const accountId = await getCampaignAccountId(campaignId);
  if (accountId === null) {
    throw new TRPCError({ code: 'NOT_FOUND', message: '广告活动不存在' });
  }
  // v667: admin角色也需要验证组织归属
  if (await isAdminUser(userId)) {
    const orgAccounts = await getOrganizationAccountIds(userId);
    if (!orgAccounts.has(accountId)) {
      log.warn(`[v667] 数据隔离拦截(admin-campaign): 管理员 ${userId} 试图访问不属于其组织的广告活动 ${campaignId}`);
      throw new TRPCError({ code: 'FORBIDDEN', message: '您没有权限访问此广告活动' });
    }
    return;
  }
  const userAccounts = await getUserAccountIds(userId);
  if (!userAccounts.has(accountId)) {
    log.warn(`[v370.4] 数据隔离拦截(campaign): 用户 ${userId} 试图访问不属于自己的广告活动 ${campaignId}`);
    throw new TRPCError({ code: 'FORBIDDEN', message: '您没有权限访问此广告活动' });
  }
}

/** v370.4: 验证performanceGroup是否属于指定用户（或其组织） */
export async function verifyPerformanceGroupAccess(userId: number, pgId: number): Promise<void> {
  const ownership = await getPGOwnership(pgId);
  if (!ownership) {
    throw new TRPCError({ code: 'NOT_FOUND', message: '优化目标不存在' });
  }
  // v667: admin角色也需要验证组织归属
  if (await isAdminUser(userId)) {
    const orgAccounts = await getOrganizationAccountIds(userId);
    if (!orgAccounts.has(ownership.accountId)) {
      log.warn(`[v667] 数据隔离拦截(admin-pg): 管理员 ${userId} 试图访问不属于其组织的优化目标 ${pgId}`);
      throw new TRPCError({ code: 'FORBIDDEN', message: '您没有权限访问此优化目标' });
    }
    return;
  }
  if (ownership.userId !== userId) {
    const userAccounts = await getUserAccountIds(userId);
    if (!userAccounts.has(ownership.accountId)) {
      log.warn(`[v370.4] 数据隔离拦截(performanceGroup): 用户 ${userId} 试图访问不属于自己的优化目标 ${pgId}`);
      throw new TRPCError({ code: 'FORBIDDEN', message: '您没有权限访问此优化目标' });
    }
  }
}

/** v370.4: 验证keyword是否属于指定用户（或其组织） */
export async function verifyKeywordAccess(userId: number, keywordId: number): Promise<void> {
  const accountId = await getKeywordAccountId(keywordId);
  if (accountId === null) return; // 旧数据可能没有accountId
  // v667: admin角色也需要验证组织归属
  if (await isAdminUser(userId)) {
    const orgAccounts = await getOrganizationAccountIds(userId);
    if (!orgAccounts.has(accountId)) {
      log.warn(`[v667] 数据隔离拦截(admin-keyword): 管理员 ${userId} 试图访问不属于其组织的关键词 ${keywordId}`);
      throw new TRPCError({ code: 'FORBIDDEN', message: '您没有权限访问此关键词' });
    }
    return;
  }
  const userAccounts = await getUserAccountIds(userId);
  if (!userAccounts.has(accountId)) {
    log.warn(`[v370.4] 数据隔离拦截(keyword): 用户 ${userId} 试图访问不属于自己的关键词 ${keywordId}`);
    throw new TRPCError({ code: 'FORBIDDEN', message: '您没有权限访问此关键词' });
  }
}

/** v370.4: 验证adGroup是否属于指定用户（或其组织） */
export async function verifyAdGroupAccess(userId: number, adGroupId: number): Promise<void> {
  const accountId = await getAdGroupAccountId(adGroupId);
  if (accountId === null) return; // 旧数据可能没有accountId
  // v667: admin角色也需要验证组织归属
  if (await isAdminUser(userId)) {
    const orgAccounts = await getOrganizationAccountIds(userId);
    if (!orgAccounts.has(accountId)) {
      log.warn(`[v667] 数据隔离拦截(admin-adGroup): 管理员 ${userId} 试图访问不属于其组织的广告组 ${adGroupId}`);
      throw new TRPCError({ code: 'FORBIDDEN', message: '您没有权限访问此广告组' });
    }
    return;
  }
  const userAccounts = await getUserAccountIds(userId);
  if (!userAccounts.has(accountId)) {
    log.warn(`[v370.4] 数据隔离拦截(adGroup): 用户 ${userId} 试图访问不属于自己的广告组 ${adGroupId}`);
    throw new TRPCError({ code: 'FORBIDDEN', message: '您没有权限访问此广告组' });
  }
}

/** v370.4: 验证scheduledTask是否属于指定用户 */
export async function verifyScheduledTaskAccess(userId: number, taskId: number): Promise<void> {
  // 调度任务不涉及组织级隔离，保持用户级隔离
  if (await isAdminUser(userId)) return;
  const taskUserId = await getScheduledTaskUserId(taskId);
  if (taskUserId === null) {
    throw new TRPCError({ code: 'NOT_FOUND', message: '任务不存在' });
  }
  if (taskUserId !== userId) {
    log.warn(`[v370.4] 数据隔离拦截(scheduledTask): 用户 ${userId} 试图访问不属于自己的任务 ${taskId}`);
    throw new TRPCError({ code: 'FORBIDDEN', message: '您没有权限访问此任务' });
  }
}

// ==================== 缓存管理 ====================

/** 清除指定用户的缓存 */
export function invalidateUserAccountCache(userId: number): void {
  userAccountCache.delete(userId);
}

/** 清除所有缓存 */
export function clearAllAccountCache(): void {
  userAccountCache.clear();
  campaignAccountCache.clear();
  pgOwnershipCache.clear();
  adminUserCache.clear();
  orgAccountCache.clear();
}
