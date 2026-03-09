/**
 * v366: 多租户数据隔离 - accountId归属验证
 * 
 * 确保所有面向用户的API端点在接收accountId参数时，
 * 验证该accountId确实属于当前登录用户，防止跨租户数据泄露。
 */
import { TRPCError } from '@trpc/server';
import { eq, and } from 'drizzle-orm';
import { createModuleLogger } from './logger';

const log = createModuleLogger('AccessControl');

// 缓存：userId -> Set<accountId(number)>
// 使用TTL缓存避免每次请求都查数据库
const userAccountCache = new Map<number, { accounts: Set<number>; expiry: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5分钟缓存

/**
 * 获取用户拥有的所有accountId集合（带缓存）
 */
async function getUserAccountIds(userId: number): Promise<Set<number>> {
  const cached = userAccountCache.get(userId);
  if (cached && cached.expiry > Date.now()) {
    return cached.accounts;
  }

  try {
    const { getDb } = await import('../db/connection');
    const { adAccounts } = await import('../../drizzle/schema');
    const db = await getDb();
    if (!db) {
      log.error(`[v366] 数据库连接失败，无法验证用户 ${userId} 的账户归属`);
      return new Set();
    }

    const accounts = await db.select({ id: adAccounts.id })
      .from(adAccounts)
      .where(eq(adAccounts.userId, userId));

    const accountSet = new Set(accounts.map(a => a.id));
    userAccountCache.set(userId, { accounts: accountSet, expiry: Date.now() + CACHE_TTL_MS });

    return accountSet;
  } catch (error) {
    log.error(`[v366] 查询用户 ${userId} 的账户列表失败:`, error);
    return new Set();
  }
}

/**
 * 验证accountId是否属于指定用户
 * 
 * @param userId - 当前登录用户的ID
 * @param accountId - 需要验证的accountId
 * @throws TRPCError FORBIDDEN 如果accountId不属于该用户
 */
export async function verifyAccountAccess(userId: number, accountId: number): Promise<void> {
  if (!accountId || !userId) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: '缺少必要的用户或账户信息',
    });
  }

  const userAccounts = await getUserAccountIds(userId);

  if (!userAccounts.has(accountId)) {
    log.warn(`[v366] 数据隔离拦截: 用户 ${userId} 试图访问不属于自己的账户 ${accountId}`);
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: '您没有权限访问此账户的数据',
    });
  }
}

/**
 * 验证多个accountId是否都属于指定用户
 */
export async function verifyMultipleAccountAccess(userId: number, accountIds: number[]): Promise<void> {
  if (!accountIds || accountIds.length === 0) return;

  const userAccounts = await getUserAccountIds(userId);

  for (const accountId of accountIds) {
    if (!userAccounts.has(accountId)) {
      log.warn(`[v366] 数据隔离拦截: 用户 ${userId} 试图批量访问不属于自己的账户 ${accountId}`);
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: '您没有权限访问部分账户的数据',
      });
    }
  }
}

/**
 * 清除指定用户的缓存（在账户变更时调用）
 */
export function invalidateUserAccountCache(userId: number): void {
  userAccountCache.delete(userId);
}

/**
 * 清除所有缓存
 */
export function clearAllAccountCache(): void {
  userAccountCache.clear();
}
