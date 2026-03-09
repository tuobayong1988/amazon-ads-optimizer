import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { createModuleLogger } from '../utils/logger';

const log = createModuleLogger('TRPC_AccessControl');

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

/**
 * v366: accountId归属验证中间件
 * 
 * 自动拦截所有包含accountId参数的请求，验证该accountId是否属于当前登录用户。
 * 这是一个全局性的安全屏障，确保多租户数据隔离。
 * 
 * 工作原理：
 * 1. 检查请求的input中是否包含accountId字段
 * 2. 如果包含，查询数据库验证该accountId的userId是否等于当前用户ID
 * 3. 如果不匹配，立即拒绝请求
 * 4. 使用内存缓存减少数据库查询压力（5分钟TTL）
 */

// 缓存：userId -> Set<accountId(number)>
const userAccountCache = new Map<number, { accounts: Set<number>; expiry: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5分钟

async function getUserAccountIds(userId: number): Promise<Set<number>> {
  const cached = userAccountCache.get(userId);
  if (cached && cached.expiry > Date.now()) {
    return cached.accounts;
  }

  try {
    const { getDb } = await import('../db/connection');
    const { adAccounts } = await import('../../drizzle/schema');
    const { eq } = await import('drizzle-orm');
    const db = await getDb();
    if (!db) return new Set();

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

/** v366: 清除用户账户缓存（在账户变更时调用） */
export function invalidateUserAccountCache(userId?: number): void {
  if (userId) {
    userAccountCache.delete(userId);
  } else {
    userAccountCache.clear();
  }
}

const enforceAccountAccess = t.middleware(async opts => {
  const { ctx, next, rawInput } = opts;

  // 只对已认证用户生效
  if (ctx.user && rawInput && typeof rawInput === 'object') {
    const input = rawInput as Record<string, any>;
    
    // 检查input中是否有accountId字段
    const accountId = input.accountId;
    if (accountId !== undefined && accountId !== null && typeof accountId === 'number' && accountId > 0) {
      const userAccounts = await getUserAccountIds(ctx.user.id);
      
      if (!userAccounts.has(accountId)) {
        log.warn(
          `[v366] 数据隔离拦截: 用户 ${ctx.user.id}(${ctx.user.email}) 试图访问不属于自己的账户 ${accountId}`
        );
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: '您没有权限访问此账户的数据',
        });
      }
    }

    // 检查accountIds数组字段
    const accountIds = input.accountIds;
    if (Array.isArray(accountIds) && accountIds.length > 0) {
      const userAccounts = await getUserAccountIds(ctx.user.id);
      for (const aid of accountIds) {
        if (typeof aid === 'number' && aid > 0 && !userAccounts.has(aid)) {
          log.warn(
            `[v366] 数据隔离拦截: 用户 ${ctx.user.id}(${ctx.user.email}) 试图批量访问不属于自己的账户 ${aid}`
          );
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: '您没有权限访问部分账户的数据',
          });
        }
      }
    }
  }

  return next();
});

/**
 * v366: protectedProcedure 现在同时包含：
 * 1. requireUser - 验证用户已登录
 * 2. enforceAccountAccess - 验证accountId归属（自动拦截）
 */
export const protectedProcedure = t.procedure.use(requireUser).use(enforceAccountAccess);

export const adminProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== 'admin') {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
);
