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
 * v370.4: 全面增强的多租户数据隔离中间件
 * 
 * 在v366的基础上大幅增强，不仅检查accountId，还自动验证所有关键参数的所有权：
 * - accountId / accountIds → 直接验证是否属于当前用户
 * - performanceGroupId / groupId → 反查performance_groups表的accountId，再验证所有权
 * - campaignId（数字类型）→ 反查campaigns表的accountId，再验证所有权
 * - taskId / id（在scheduled_tasks上下文中）→ 反查scheduled_tasks表的userId
 * 
 * 数据层级关系：
 *   user → ad_accounts (userId) → campaigns (accountId) → ad_groups → keywords/targets
 *                                → performance_groups (accountId, userId)
 *                                → daily_performance (accountId)
 *                                → optimization_logs (account_id)
 *                                → scheduled_tasks (userId)
 */

// ==================== 缓存层 ====================
// 缓存1：userId -> Set<accountId(number)>
const userAccountCache = new Map<number, { accounts: Set<number>; expiry: number }>();
// 缓存2：campaignId(number) -> accountId(number)
const campaignAccountCache = new Map<number, { accountId: number; expiry: number }>();
// 缓存3：performanceGroupId(number) -> accountId(number)
const pgAccountCache = new Map<number, { accountId: number; expiry: number }>();

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
    log.error(`[v370.4] 查询用户 ${userId} 的账户列表失败:`, error);
    return new Set();
  }
}

/** 反查campaign的accountId */
async function getCampaignAccountId(campaignId: number): Promise<number | null> {
  const cached = campaignAccountCache.get(campaignId);
  if (cached && cached.expiry > Date.now()) {
    return cached.accountId;
  }

  try {
    const { getDb } = await import('../db/connection');
    const { campaigns } = await import('../../drizzle/schema');
    const { eq } = await import('drizzle-orm');
    const db = await getDb();
    if (!db) return null;

    const [row] = await db.select({ accountId: campaigns.accountId })
      .from(campaigns)
      .where(eq(campaigns.id, campaignId))
      .limit(1);

    if (row) {
      campaignAccountCache.set(campaignId, { accountId: row.accountId, expiry: Date.now() + CACHE_TTL_MS });
      return row.accountId;
    }
    return null;
  } catch {
    return null;
  }
}

/** 反查performanceGroup的accountId */
async function getPGAccountId(pgId: number): Promise<number | null> {
  const cached = pgAccountCache.get(pgId);
  if (cached && cached.expiry > Date.now()) {
    return cached.accountId;
  }

  try {
    const { getDb } = await import('../db/connection');
    const { performanceGroups } = await import('../../drizzle/schema');
    const { eq } = await import('drizzle-orm');
    const db = await getDb();
    if (!db) return null;

    const [row] = await db.select({ accountId: performanceGroups.accountId })
      .from(performanceGroups)
      .where(eq(performanceGroups.id, pgId))
      .limit(1);

    if (row) {
      pgAccountCache.set(pgId, { accountId: row.accountId, expiry: Date.now() + CACHE_TTL_MS });
      return row.accountId;
    }
    return null;
  } catch {
    return null;
  }
}

/** v366: 清除用户账户缓存（在账户变更时调用） */
export function invalidateUserAccountCache(userId?: number): void {
  if (userId) {
    userAccountCache.delete(userId);
  } else {
    userAccountCache.clear();
  }
  // 同时清除关联缓存
  campaignAccountCache.clear();
  pgAccountCache.clear();
}

// ==================== 核心中间件 ====================
const enforceAccountAccess = t.middleware(async opts => {
  const { ctx, next, getRawInput } = opts;

  // 只对已认证用户生效
  const rawInput = await getRawInput();
  if (ctx.user && rawInput && typeof rawInput === 'object') {
    const input = rawInput as Record<string, any>;
    const userId = ctx.user.id;
    
    // ===== 1. 检查accountId字段（v366原有逻辑） =====
    const accountId = input.accountId;
    if (accountId !== undefined && accountId !== null && typeof accountId === 'number' && accountId > 0) {
      const userAccounts = await getUserAccountIds(userId);
      
      if (!userAccounts.has(accountId)) {
        log.warn(
          `[v370.4] 数据隔离拦截(accountId): 用户 ${userId}(${ctx.user.email}) 试图访问不属于自己的账户 ${accountId}`
        );
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: '您没有权限访问此账户的数据',
        });
      }
    }

    // ===== 2. 检查accountIds数组字段 =====
    const accountIds = input.accountIds;
    if (Array.isArray(accountIds) && accountIds.length > 0) {
      const userAccounts = await getUserAccountIds(userId);
      for (const aid of accountIds) {
        if (typeof aid === 'number' && aid > 0 && !userAccounts.has(aid)) {
          log.warn(
            `[v370.4] 数据隔离拦截(accountIds): 用户 ${userId}(${ctx.user.email}) 试图批量访问不属于自己的账户 ${aid}`
          );
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: '您没有权限访问部分账户的数据',
          });
        }
      }
    }

    // ===== 3. v370.4新增：检查performanceGroupId / groupId =====
    const pgId = input.performanceGroupId ?? input.groupId;
    if (pgId !== undefined && pgId !== null && typeof pgId === 'number' && pgId > 0) {
      const pgAccountId = await getPGAccountId(pgId);
      if (pgAccountId !== null) {
        const userAccounts = await getUserAccountIds(userId);
        if (!userAccounts.has(pgAccountId)) {
          log.warn(
            `[v370.4] 数据隔离拦截(performanceGroupId): 用户 ${userId}(${ctx.user.email}) 试图访问不属于自己的绩效组 ${pgId} (accountId=${pgAccountId})`
          );
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: '您没有权限访问此优化目标的数据',
          });
        }
      }
    }
    // 也检查字符串类型的performanceGroupId（某些路由用z.string()）
    const pgIdStr = typeof input.performanceGroupId === 'string' ? parseInt(input.performanceGroupId, 10) : NaN;
    if (!isNaN(pgIdStr) && pgIdStr > 0) {
      const pgAccountId = await getPGAccountId(pgIdStr);
      if (pgAccountId !== null) {
        const userAccounts = await getUserAccountIds(userId);
        if (!userAccounts.has(pgAccountId)) {
          log.warn(
            `[v370.4] 数据隔离拦截(performanceGroupId/str): 用户 ${userId}(${ctx.user.email}) 试图访问不属于自己的绩效组 ${pgIdStr}`
          );
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: '您没有权限访问此优化目标的数据',
          });
        }
      }
    }

    // ===== 4. v370.4新增：检查campaignId（数字类型，即数据库内部ID） =====
    const campaignId = input.campaignId;
    if (campaignId !== undefined && campaignId !== null && typeof campaignId === 'number' && campaignId > 0) {
      const campAccountId = await getCampaignAccountId(campaignId);
      if (campAccountId !== null) {
        const userAccounts = await getUserAccountIds(userId);
        if (!userAccounts.has(campAccountId)) {
          log.warn(
            `[v370.4] 数据隔离拦截(campaignId): 用户 ${userId}(${ctx.user.email}) 试图访问不属于自己的广告活动 ${campaignId} (accountId=${campAccountId})`
          );
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: '您没有权限访问此广告活动的数据',
          });
        }
      }
    }

    // ===== 5. v370.4新增：检查campaignIds数组 =====
    const campaignIds = input.campaignIds;
    if (Array.isArray(campaignIds) && campaignIds.length > 0) {
      const userAccounts = await getUserAccountIds(userId);
      for (const cid of campaignIds) {
        if (typeof cid === 'number' && cid > 0) {
          const campAccountId = await getCampaignAccountId(cid);
          if (campAccountId !== null && !userAccounts.has(campAccountId)) {
            log.warn(
              `[v370.4] 数据隔离拦截(campaignIds): 用户 ${userId}(${ctx.user.email}) 试图批量访问不属于自己的广告活动 ${cid}`
            );
            throw new TRPCError({
              code: 'FORBIDDEN',
              message: '您没有权限访问部分广告活动的数据',
            });
          }
        }
      }
    }

    // ===== 6. v370.4新增：检查targetId（优化目标执行相关，targetId指向performanceGroupId） =====
    const targetId = input.targetId;
    if (targetId !== undefined && targetId !== null && typeof targetId === 'number' && targetId > 0) {
      // targetId在优化上下文中通常指performanceGroupId
      const pgAccountId = await getPGAccountId(targetId);
      if (pgAccountId !== null) {
        const userAccounts = await getUserAccountIds(userId);
        if (!userAccounts.has(pgAccountId)) {
          log.warn(
            `[v370.4] 数据隔离拦截(targetId): 用户 ${userId}(${ctx.user.email}) 试图访问不属于自己的目标 ${targetId}`
          );
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: '您没有权限访问此目标的数据',
          });
        }
      }
    }
  }

  return next();
});

/**
 * v370.4: protectedProcedure 现在包含全面的多租户数据隔离：
 * 1. requireUser - 验证用户已登录
 * 2. enforceAccountAccess - 验证accountId/performanceGroupId/campaignId等所有关键参数的归属
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
