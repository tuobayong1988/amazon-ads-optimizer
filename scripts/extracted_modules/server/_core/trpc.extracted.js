// Extracted from production dist/index.js
// Original module: server/_core/trpc.ts
// Lines: 339

function withTimeout(promise2, ms, fallback) {
  let timedOut = false;
  return Promise.race([
    promise2,
    new Promise((resolve) => setTimeout(() => {
      timedOut = true;
      log150.warn(`[v447] DB query timeout after ${ms}ms, using fallback`);
      resolve(fallback);
    }, ms))
  ]);
}
async function getUserAccountIds(userId) {
  const cached2 = userAccountCache.get(userId);
  if (cached2 && cached2.expiry > Date.now()) {
    return cached2.accounts;
  }
  try {
    const { getDb: getDb3 } = await Promise.resolve().then(() => (init_connection(), connection_exports));
    const { adAccounts: adAccounts3 } = await Promise.resolve().then(() => (init_schema2(), schema_exports));
    const { eq: eq12 } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
    const accounts = await withTimeout((async () => {
      const db = await getDb3();
      if (!db) return [];
      return db.select({ id: adAccounts3.id }).from(adAccounts3).where(eq12(adAccounts3.userId, userId));
    })(), 5e3, []);
    const accountSet = new Set(accounts.map((a) => a.id));
    if (accountSet.size > 0) {
      userAccountCache.set(userId, { accounts: accountSet, expiry: Date.now() + CACHE_TTL_MS4 });
    }
    return accountSet;
  } catch (error48) {
    log150.warn(`[v370.4] \u67E5\u8BE2\u7528\u6237 ${userId} \u7684\u8D26\u6237\u5217\u8868\u5931\u8D25:`, error48);
    return /* @__PURE__ */ new Set();
  }
}
async function getOrgAccountIds(organizationId) {
  const cacheKey = -organizationId;
  const cached2 = userAccountCache.get(cacheKey);
  if (cached2 && cached2.expiry > Date.now()) {
    return cached2.accounts;
  }
  try {
    const { getDb: getDb3 } = await Promise.resolve().then(() => (init_connection(), connection_exports));
    const { adAccounts: adAccounts3 } = await Promise.resolve().then(() => (init_schema2(), schema_exports));
    const { eq: eq12 } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
    const accounts = await withTimeout((async () => {
      const db = await getDb3();
      if (!db) return [];
      return db.select({ id: adAccounts3.id }).from(adAccounts3).where(eq12(adAccounts3.organizationId, organizationId));
    })(), 5e3, []);
    const accountSet = new Set(accounts.map((a) => a.id));
    if (accountSet.size > 0) {
      userAccountCache.set(cacheKey, { accounts: accountSet, expiry: Date.now() + CACHE_TTL_MS4 });
    }
    return accountSet;
  } catch (error48) {
    log150.warn(`[v577] \u67E5\u8BE2\u7EC4\u7EC7 ${organizationId} \u7684\u8D26\u6237\u5217\u8868\u5931\u8D25:`, error48);
    return /* @__PURE__ */ new Set();
  }
}
async function getCampaignAccountIdByAmazonId(amazonCampaignId) {
  const cached2 = amazonCampaignAccountCache.get(amazonCampaignId);
  if (cached2 && cached2.expiry > Date.now()) {
    return cached2.accountId;
  }
  try {
    const { getDb: getDb3 } = await Promise.resolve().then(() => (init_connection(), connection_exports));
    const { campaigns: campaigns6 } = await Promise.resolve().then(() => (init_schema2(), schema_exports));
    const { eq: eq12 } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
    const row = await withTimeout((async () => {
      const db = await getDb3();
      if (!db) return null;
      const [r] = await db.select({ accountId: campaigns6.accountId }).from(campaigns6).where(eq12(campaigns6.campaignId, amazonCampaignId)).limit(1);
      return r || null;
    })(), 5e3, null);
    if (row) {
      amazonCampaignAccountCache.set(amazonCampaignId, { accountId: row.accountId, expiry: Date.now() + CACHE_TTL_MS4 });
      return row.accountId;
    }
    return null;
  } catch {
    return null;
  }
}
async function getCampaignAccountId(campaignId) {
  const cached2 = campaignAccountCache.get(campaignId);
  if (cached2 && cached2.expiry > Date.now()) {
    return cached2.accountId;
  }
  try {
    const { getDb: getDb3 } = await Promise.resolve().then(() => (init_connection(), connection_exports));
    const { campaigns: campaigns6 } = await Promise.resolve().then(() => (init_schema2(), schema_exports));
    const { eq: eq12 } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
    const row = await withTimeout((async () => {
      const db = await getDb3();
      if (!db) return null;
      const [r] = await db.select({ accountId: campaigns6.accountId }).from(campaigns6).where(eq12(campaigns6.id, campaignId)).limit(1);
      return r || null;
    })(), 5e3, null);
    if (row) {
      campaignAccountCache.set(campaignId, { accountId: row.accountId, expiry: Date.now() + CACHE_TTL_MS4 });
      return row.accountId;
    }
    return null;
  } catch {
    return null;
  }
}
async function getPGAccountId(pgId) {
  const cached2 = pgAccountCache.get(pgId);
  if (cached2 && cached2.expiry > Date.now()) {
    return cached2.accountId;
  }
  try {
    const { getDb: getDb3 } = await Promise.resolve().then(() => (init_connection(), connection_exports));
    const { performanceGroups: performanceGroups8 } = await Promise.resolve().then(() => (init_schema2(), schema_exports));
    const { eq: eq12 } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
    const row = await withTimeout((async () => {
      const db = await getDb3();
      if (!db) return null;
      const [r] = await db.select({ accountId: performanceGroups8.accountId }).from(performanceGroups8).where(eq12(performanceGroups8.id, pgId)).limit(1);
      return r || null;
    })(), 5e3, null);
    if (row) {
      pgAccountCache.set(pgId, { accountId: row.accountId, expiry: Date.now() + CACHE_TTL_MS4 });
      return row.accountId;
    }
    return null;
  } catch {
    return null;
  }
}
var import_superjson, log150, t, router, publicProcedure, requireUser, userAccountCache, campaignAccountCache, pgAccountCache, CACHE_TTL_MS4, amazonCampaignAccountCache, enforceAccountAccess, protectedProcedure, adminProcedure;
var init_trpc = __esm({
  "server/_core/trpc.ts"() {
    "use strict";
    init_const();
    init_dist();
    import_superjson = __toESM(require_dist2());
    init_logger();
    log150 = createModuleLogger("TRPC_AccessControl");
    t = initTRPC.context().create({
      transformer: import_superjson.default
    });
    router = t.router;
    publicProcedure = t.procedure;
    requireUser = t.middleware(async (opts) => {
      const { ctx, next } = opts;
      if (!ctx.user) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
      }
      return next({
        ctx: {
          ...ctx,
          user: ctx.user
        }
      });
    });
    userAccountCache = /* @__PURE__ */ new Map();
    campaignAccountCache = /* @__PURE__ */ new Map();
    pgAccountCache = /* @__PURE__ */ new Map();
    CACHE_TTL_MS4 = 5 * 60 * 1e3;
    __name(withTimeout, "withTimeout");
    __name(getUserAccountIds, "getUserAccountIds");
    __name(getOrgAccountIds, "getOrgAccountIds");
    amazonCampaignAccountCache = /* @__PURE__ */ new Map();
    __name(getCampaignAccountIdByAmazonId, "getCampaignAccountIdByAmazonId");
    __name(getCampaignAccountId, "getCampaignAccountId");
    __name(getPGAccountId, "getPGAccountId");
    enforceAccountAccess = t.middleware(async (opts) => {
      const { ctx, next, getRawInput } = opts;
      const rawInput = await getRawInput();
      if (ctx.user && rawInput && typeof rawInput === "object") {
        const input = rawInput;
        const userId = ctx.user.id;
        const getAccessibleAccounts = /* @__PURE__ */ __name(async () => {
          if (ctx.user.organizationId) {
            return getOrgAccountIds(ctx.user.organizationId);
          }
          return getUserAccountIds(userId);
        }, "getAccessibleAccounts");
        const accountId = input.accountId;
        if (accountId !== void 0 && accountId !== null && typeof accountId === "number" && accountId > 0) {
          const userAccounts = await getAccessibleAccounts();
          if (!userAccounts.has(accountId)) {
            log150.warn(
              `[v370.4] \u6570\u636E\u9694\u79BB\u62E6\u622A(accountId): \u7528\u6237 ${userId}(${ctx.user.email}) \u8BD5\u56FE\u8BBF\u95EE\u4E0D\u5C5E\u4E8E\u81EA\u5DF1\u7684\u8D26\u6237 ${accountId}`
            );
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "\u60A8\u6CA1\u6709\u6743\u9650\u8BBF\u95EE\u6B64\u8D26\u6237\u7684\u6570\u636E"
            });
          }
        }
        const accountIds = input.accountIds;
        if (Array.isArray(accountIds) && accountIds.length > 0) {
          const userAccounts = await getAccessibleAccounts();
          for (const aid of accountIds) {
            if (typeof aid === "number" && aid > 0 && !userAccounts.has(aid)) {
              log150.warn(
                `[v370.4] \u6570\u636E\u9694\u79BB\u62E6\u622A(accountIds): \u7528\u6237 ${userId}(${ctx.user.email}) \u8BD5\u56FE\u6279\u91CF\u8BBF\u95EE\u4E0D\u5C5E\u4E8E\u81EA\u5DF1\u7684\u8D26\u6237 ${aid}`
              );
              throw new TRPCError({
                code: "FORBIDDEN",
                message: "\u60A8\u6CA1\u6709\u6743\u9650\u8BBF\u95EE\u90E8\u5206\u8D26\u6237\u7684\u6570\u636E"
              });
            }
          }
        }
        const pgId = input.performanceGroupId ?? input.groupId;
        if (pgId !== void 0 && pgId !== null && typeof pgId === "number" && pgId > 0) {
          const pgAccountId = await getPGAccountId(pgId);
          if (pgAccountId !== null) {
            const userAccounts = await getAccessibleAccounts();
            if (!userAccounts.has(pgAccountId)) {
              log150.warn(
                `[v370.4] \u6570\u636E\u9694\u79BB\u62E6\u622A(performanceGroupId): \u7528\u6237 ${userId}(${ctx.user.email}) \u8BD5\u56FE\u8BBF\u95EE\u4E0D\u5C5E\u4E8E\u81EA\u5DF1\u7684\u7EE9\u6548\u7EC4 ${pgId} (accountId=${pgAccountId})`
              );
              throw new TRPCError({
                code: "FORBIDDEN",
                message: "\u60A8\u6CA1\u6709\u6743\u9650\u8BBF\u95EE\u6B64\u4F18\u5316\u76EE\u6807\u7684\u6570\u636E"
              });
            }
          }
        }
        const pgIdStr = typeof input.performanceGroupId === "string" ? parseInt(input.performanceGroupId, 10) : NaN;
        if (!isNaN(pgIdStr) && pgIdStr > 0) {
          const pgAccountId = await getPGAccountId(pgIdStr);
          if (pgAccountId !== null) {
            const userAccounts = await getAccessibleAccounts();
            if (!userAccounts.has(pgAccountId)) {
              log150.warn(
                `[v370.4] \u6570\u636E\u9694\u79BB\u62E6\u622A(performanceGroupId/str): \u7528\u6237 ${userId}(${ctx.user.email}) \u8BD5\u56FE\u8BBF\u95EE\u4E0D\u5C5E\u4E8E\u81EA\u5DF1\u7684\u7EE9\u6548\u7EC4 ${pgIdStr}`
              );
              throw new TRPCError({
                code: "FORBIDDEN",
                message: "\u60A8\u6CA1\u6709\u6743\u9650\u8BBF\u95EE\u6B64\u4F18\u5316\u76EE\u6807\u7684\u6570\u636E"
              });
            }
          }
        }
        const campaignId = input.campaignId;
        if (campaignId !== void 0 && campaignId !== null && typeof campaignId === "number" && campaignId > 0) {
          const campAccountId = await getCampaignAccountId(campaignId);
          if (campAccountId !== null) {
            const userAccounts = await getAccessibleAccounts();
            if (!userAccounts.has(campAccountId)) {
              log150.warn(
                `[v370.4] \u6570\u636E\u9694\u79BB\u62E6\u622A(campaignId): \u7528\u6237 ${userId}(${ctx.user.email}) \u8BD5\u56FE\u8BBF\u95EE\u4E0D\u5C5E\u4E8E\u81EA\u5DF1\u7684\u5E7F\u544A\u6D3B\u52A8 ${campaignId} (accountId=${campAccountId})`
              );
              throw new TRPCError({
                code: "FORBIDDEN",
                message: "\u60A8\u6CA1\u6709\u6743\u9650\u8BBF\u95EE\u6B64\u5E7F\u544A\u6D3B\u52A8\u7684\u6570\u636E"
              });
            }
          }
        }
        if (campaignId !== void 0 && campaignId !== null && typeof campaignId === "string" && campaignId.length > 0) {
          const campAccountId = await getCampaignAccountIdByAmazonId(campaignId);
          if (campAccountId !== null) {
            const userAccounts = await getAccessibleAccounts();
            if (!userAccounts.has(campAccountId)) {
              log150.warn(
                `[v452] \u6570\u636E\u9694\u79BB\u62E6\u622A(campaignId/string): \u7528\u6237 ${userId}(${ctx.user.email}) \u8BD5\u56FE\u8BBF\u95EE\u4E0D\u5C5E\u4E8E\u81EA\u5DF1\u7684\u5E7F\u544A\u6D3B\u52A8 ${campaignId} (accountId=${campAccountId})`
              );
              throw new TRPCError({
                code: "FORBIDDEN",
                message: "\u60A8\u6CA1\u6709\u6743\u9650\u8BBF\u95EE\u6B64\u5E7F\u544A\u6D3B\u52A8\u7684\u6570\u636E"
              });
            }
          }
        }
        const campaignIds = input.campaignIds;
        if (Array.isArray(campaignIds) && campaignIds.length > 0) {
          const userAccounts = await getAccessibleAccounts();
          for (const cid of campaignIds) {
            if (typeof cid === "number" && cid > 0) {
              const campAccountId = await getCampaignAccountId(cid);
              if (campAccountId !== null && !userAccounts.has(campAccountId)) {
                log150.warn(
                  `[v370.4] \u6570\u636E\u9694\u79BB\u62E6\u622A(campaignIds): \u7528\u6237 ${userId}(${ctx.user.email}) \u8BD5\u56FE\u6279\u91CF\u8BBF\u95EE\u4E0D\u5C5E\u4E8E\u81EA\u5DF1\u7684\u5E7F\u544A\u6D3B\u52A8 ${cid}`
                );
                throw new TRPCError({
                  code: "FORBIDDEN",
                  message: "\u60A8\u6CA1\u6709\u6743\u9650\u8BBF\u95EE\u90E8\u5206\u5E7F\u544A\u6D3B\u52A8\u7684\u6570\u636E"
                });
              }
            }
            if (typeof cid === "string" && cid.length > 0) {
              const campAccountId = await getCampaignAccountIdByAmazonId(cid);
              if (campAccountId !== null && !userAccounts.has(campAccountId)) {
                log150.warn(
                  `[v452] \u6570\u636E\u9694\u79BB\u62E6\u622A(campaignIds/string): \u7528\u6237 ${userId}(${ctx.user.email}) \u8BD5\u56FE\u6279\u91CF\u8BBF\u95EE\u4E0D\u5C5E\u4E8E\u81EA\u5DF1\u7684\u5E7F\u544A\u6D3B\u52A8 ${cid}`
                );
                throw new TRPCError({
                  code: "FORBIDDEN",
                  message: "\u60A8\u6CA1\u6709\u6743\u9650\u8BBF\u95EE\u90E8\u5206\u5E7F\u544A\u6D3B\u52A8\u7684\u6570\u636E"
                });
              }
            }
          }
        }
        const targetId = input.targetId;
        if (targetId !== void 0 && targetId !== null && typeof targetId === "number" && targetId > 0) {
          const pgAccountId = await getPGAccountId(targetId);
          if (pgAccountId !== null) {
            const userAccounts = await getAccessibleAccounts();
            if (!userAccounts.has(pgAccountId)) {
              log150.warn(
                `[v370.4] \u6570\u636E\u9694\u79BB\u62E6\u622A(targetId): \u7528\u6237 ${userId}(${ctx.user.email}) \u8BD5\u56FE\u8BBF\u95EE\u4E0D\u5C5E\u4E8E\u81EA\u5DF1\u7684\u76EE\u6807 ${targetId}`
              );
              throw new TRPCError({
                code: "FORBIDDEN",
                message: "\u60A8\u6CA1\u6709\u6743\u9650\u8BBF\u95EE\u6B64\u76EE\u6807\u7684\u6570\u636E"
              });
            }
          }
        }
      }
      return next();
    });
    protectedProcedure = t.procedure.use(requireUser).use(enforceAccountAccess);
    adminProcedure = t.procedure.use(
      t.middleware(async (opts) => {
        const { ctx, next } = opts;
        if (!ctx.user || ctx.user.role !== "admin" || ctx.user.organizationId !== 1 && ctx.user.organizationId !== null && ctx.user.organizationId !== void 0) {
          throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
        }
        return next({
          ctx: {
            ...ctx,
            user: ctx.user
          }
        });
      })
    );
  }
});

