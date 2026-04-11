// Extracted from production dist/index.js
// Original module: server/utils/accessControl.ts
// Lines: 271

var accessControl_exports = {};
__export(accessControl_exports, {
  clearAllAccountCache: () => clearAllAccountCache,
  getUserAccountIds: () => getUserAccountIds2,
  invalidateUserAccountCache: () => invalidateUserAccountCache,
  isAdminUser: () => isAdminUser,
  verifyAccountAccess: () => verifyAccountAccess,
  verifyAdGroupAccess: () => verifyAdGroupAccess,
  verifyBatchKeywordAccess: () => verifyBatchKeywordAccess,
  verifyCampaignAccess: () => verifyCampaignAccess,
  verifyKeywordAccess: () => verifyKeywordAccess,
  verifyMultipleAccountAccess: () => verifyMultipleAccountAccess,
  verifyPerformanceGroupAccess: () => verifyPerformanceGroupAccess,
  verifyScheduledTaskAccess: () => verifyScheduledTaskAccess
});
async function isAdminUser(userId) {
  const cached2 = adminUserCache.get(userId);
  if (cached2 && cached2.expiry > Date.now()) {
    return cached2.isAdmin;
  }
  try {
    const { getDb: getDb3 } = await Promise.resolve().then(() => (init_connection(), connection_exports));
    const { teamMembers: teamMembers2 } = await Promise.resolve().then(() => (init_schema2(), schema_exports));
    const db = await getDb3();
    if (!db) return false;
    const rows = await db.select({ role: teamMembers2.role, organizationId: teamMembers2.organizationId }).from(teamMembers2).where(eq(teamMembers2.id, userId)).limit(1);
    const isAdmin = rows.length > 0 && rows[0].role === "admin" && (rows[0].organizationId === 1 || rows[0].organizationId === null);
    adminUserCache.set(userId, { isAdmin, expiry: Date.now() + ADMIN_CACHE_TTL_MS });
    if (!isAdmin && rows.length > 0 && rows[0].role === "admin") {
      log154.info(`[v452.8] \u5916\u90E8\u79DF\u6237admin\u89D2\u8272\u4E0D\u4F5C\u4E3A\u7CFB\u7EDF\u7BA1\u7406\u5458: userId=${userId}, orgId=${rows[0].organizationId}`);
    }
    return isAdmin;
  } catch {
    return false;
  }
}
async function getUserAccountIds2(userId) {
  const cached2 = userAccountCache2.get(userId);
  if (cached2 && cached2.expiry > Date.now()) {
    return cached2.accounts;
  }
  try {
    const { getDb: getDb3 } = await Promise.resolve().then(() => (init_connection(), connection_exports));
    const { adAccounts: adAccounts3 } = await Promise.resolve().then(() => (init_schema2(), schema_exports));
    const db = await getDb3();
    if (!db) return /* @__PURE__ */ new Set();
    const accounts = await db.select({ id: adAccounts3.id }).from(adAccounts3).where(eq(adAccounts3.userId, userId));
    const accountSet = new Set(accounts.map((a) => a.id));
    userAccountCache2.set(userId, { accounts: accountSet, expiry: Date.now() + CACHE_TTL_MS5 });
    return accountSet;
  } catch (error48) {
    log154.warn(`[v370.4] \u67E5\u8BE2\u7528\u6237 ${userId} \u7684\u8D26\u6237\u5217\u8868\u5931\u8D25:`, error48);
    return /* @__PURE__ */ new Set();
  }
}
async function getCampaignAccountId2(campaignId) {
  const cached2 = campaignAccountCache2.get(campaignId);
  if (cached2 && cached2.expiry > Date.now()) return cached2.accountId;
  try {
    const { getDb: getDb3 } = await Promise.resolve().then(() => (init_connection(), connection_exports));
    const { campaigns: campaigns6 } = await Promise.resolve().then(() => (init_schema2(), schema_exports));
    const db = await getDb3();
    if (!db) return null;
    const [row] = await db.select({ accountId: campaigns6.accountId }).from(campaigns6).where(eq(campaigns6.id, campaignId)).limit(1);
    if (row) {
      campaignAccountCache2.set(campaignId, { accountId: row.accountId, expiry: Date.now() + CACHE_TTL_MS5 });
      return row.accountId;
    }
    return null;
  } catch {
    return null;
  }
}
async function getPGOwnership(pgId) {
  const cached2 = pgOwnershipCache.get(pgId);
  if (cached2 && cached2.expiry > Date.now()) return { accountId: cached2.accountId, userId: cached2.userId };
  try {
    const { getDb: getDb3 } = await Promise.resolve().then(() => (init_connection(), connection_exports));
    const { performanceGroups: performanceGroups8 } = await Promise.resolve().then(() => (init_schema2(), schema_exports));
    const db = await getDb3();
    if (!db) return null;
    const [row] = await db.select({ accountId: performanceGroups8.accountId, userId: performanceGroups8.userId }).from(performanceGroups8).where(eq(performanceGroups8.id, pgId)).limit(1);
    if (row) {
      pgOwnershipCache.set(pgId, { accountId: row.accountId, userId: row.userId, expiry: Date.now() + CACHE_TTL_MS5 });
      return { accountId: row.accountId, userId: row.userId };
    }
    return null;
  } catch {
    return null;
  }
}
async function getKeywordAccountId(keywordId) {
  try {
    const { getDb: getDb3 } = await Promise.resolve().then(() => (init_connection(), connection_exports));
    const { keywords: keywords10 } = await Promise.resolve().then(() => (init_schema2(), schema_exports));
    const db = await getDb3();
    if (!db) return null;
    const [row] = await db.select({ accountId: keywords10.accountId }).from(keywords10).where(eq(keywords10.id, keywordId)).limit(1);
    return row?.accountId ?? null;
  } catch {
    return null;
  }
}
async function getAdGroupAccountId(adGroupId) {
  try {
    const { getDb: getDb3 } = await Promise.resolve().then(() => (init_connection(), connection_exports));
    const { adGroups: adGroups6 } = await Promise.resolve().then(() => (init_schema2(), schema_exports));
    const db = await getDb3();
    if (!db) return null;
    const [row] = await db.select({ accountId: adGroups6.accountId }).from(adGroups6).where(eq(adGroups6.id, adGroupId)).limit(1);
    return row?.accountId ?? null;
  } catch {
    return null;
  }
}
async function getScheduledTaskUserId(taskId) {
  try {
    const { getDb: getDb3 } = await Promise.resolve().then(() => (init_connection(), connection_exports));
    const { scheduledTasks: scheduledTasks2 } = await Promise.resolve().then(() => (init_schema2(), schema_exports));
    const db = await getDb3();
    if (!db) return null;
    const [row] = await db.select({ userId: scheduledTasks2.userId }).from(scheduledTasks2).where(eq(scheduledTasks2.id, taskId)).limit(1);
    return row?.userId ?? null;
  } catch {
    return null;
  }
}
async function verifyAccountAccess(userId, accountId) {
  if (!accountId || !userId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "\u7F3A\u5C11\u5FC5\u8981\u7684\u7528\u6237\u6216\u8D26\u6237\u4FE1\u606F" });
  }
  if (await isAdminUser(userId)) return;
  const userAccounts = await getUserAccountIds2(userId);
  if (!userAccounts.has(accountId)) {
    log154.warn(`[v370.4] \u6570\u636E\u9694\u79BB\u62E6\u622A(account): \u7528\u6237 ${userId} \u8BD5\u56FE\u8BBF\u95EE\u4E0D\u5C5E\u4E8E\u81EA\u5DF1\u7684\u8D26\u6237 ${accountId}`);
    throw new TRPCError({ code: "FORBIDDEN", message: "\u60A8\u6CA1\u6709\u6743\u9650\u8BBF\u95EE\u6B64\u8D26\u6237\u7684\u6570\u636E" });
  }
}
async function verifyMultipleAccountAccess(userId, accountIds) {
  if (!accountIds || accountIds.length === 0) return;
  if (await isAdminUser(userId)) return;
  const userAccounts = await getUserAccountIds2(userId);
  for (const accountId of accountIds) {
    if (!userAccounts.has(accountId)) {
      log154.warn(`[v370.4] \u6570\u636E\u9694\u79BB\u62E6\u622A(accounts): \u7528\u6237 ${userId} \u8BD5\u56FE\u6279\u91CF\u8BBF\u95EE\u4E0D\u5C5E\u4E8E\u81EA\u5DF1\u7684\u8D26\u6237 ${accountId}`);
      throw new TRPCError({ code: "FORBIDDEN", message: "\u60A8\u6CA1\u6709\u6743\u9650\u8BBF\u95EE\u90E8\u5206\u8D26\u6237\u7684\u6570\u636E" });
    }
  }
}
async function verifyCampaignAccess(userId, campaignId) {
  if (await isAdminUser(userId)) return;
  const accountId = await getCampaignAccountId2(campaignId);
  if (accountId === null) {
    throw new TRPCError({ code: "NOT_FOUND", message: "\u5E7F\u544A\u6D3B\u52A8\u4E0D\u5B58\u5728" });
  }
  const userAccounts = await getUserAccountIds2(userId);
  if (!userAccounts.has(accountId)) {
    log154.warn(`[v370.4] \u6570\u636E\u9694\u79BB\u62E6\u622A(campaign): \u7528\u6237 ${userId} \u8BD5\u56FE\u8BBF\u95EE\u4E0D\u5C5E\u4E8E\u81EA\u5DF1\u7684\u5E7F\u544A\u6D3B\u52A8 ${campaignId}`);
    throw new TRPCError({ code: "FORBIDDEN", message: "\u60A8\u6CA1\u6709\u6743\u9650\u8BBF\u95EE\u6B64\u5E7F\u544A\u6D3B\u52A8" });
  }
}
async function verifyPerformanceGroupAccess(userId, pgId) {
  if (await isAdminUser(userId)) return;
  const ownership = await getPGOwnership(pgId);
  if (!ownership) {
    throw new TRPCError({ code: "NOT_FOUND", message: "\u4F18\u5316\u76EE\u6807\u4E0D\u5B58\u5728" });
  }
  if (ownership.userId !== userId) {
    const userAccounts = await getUserAccountIds2(userId);
    if (!userAccounts.has(ownership.accountId)) {
      log154.warn(`[v370.4] \u6570\u636E\u9694\u79BB\u62E6\u622A(performanceGroup): \u7528\u6237 ${userId} \u8BD5\u56FE\u8BBF\u95EE\u4E0D\u5C5E\u4E8E\u81EA\u5DF1\u7684\u4F18\u5316\u76EE\u6807 ${pgId}`);
      throw new TRPCError({ code: "FORBIDDEN", message: "\u60A8\u6CA1\u6709\u6743\u9650\u8BBF\u95EE\u6B64\u4F18\u5316\u76EE\u6807" });
    }
  }
}
async function verifyKeywordAccess(userId, keywordId) {
  if (await isAdminUser(userId)) return;
  const accountId = await getKeywordAccountId(keywordId);
  if (accountId === null) return;
  const userAccounts = await getUserAccountIds2(userId);
  if (!userAccounts.has(accountId)) {
    log154.warn(`[v370.4] \u6570\u636E\u9694\u79BB\u62E6\u622A(keyword): \u7528\u6237 ${userId} \u8BD5\u56FE\u8BBF\u95EE\u4E0D\u5C5E\u4E8E\u81EA\u5DF1\u7684\u5173\u952E\u8BCD ${keywordId}`);
    throw new TRPCError({ code: "FORBIDDEN", message: "\u60A8\u6CA1\u6709\u6743\u9650\u8BBF\u95EE\u6B64\u5173\u952E\u8BCD" });
  }
}
async function verifyBatchKeywordAccess(userId, keywordIds) {
  if (keywordIds.length === 0) return;
  if (await isAdminUser(userId)) return;
  const userAccounts = await getUserAccountIds2(userId);
  try {
    const { getDb: getDb3 } = await Promise.resolve().then(() => (init_connection(), connection_exports));
    const { keywords: keywords10 } = await Promise.resolve().then(() => (init_schema2(), schema_exports));
    const { inArray: inArray13 } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
    const db = await getDb3();
    if (!db) return;
    const rows = await db.selectDistinct({ accountId: keywords10.accountId }).from(keywords10).where(inArray13(keywords10.id, keywordIds));
    for (const row of rows) {
      if (row.accountId !== null && !userAccounts.has(row.accountId)) {
        log154.warn(`[v602] \u6570\u636E\u9694\u79BB\u62E6\u622A(batchKeyword): \u7528\u6237 ${userId} \u8BD5\u56FE\u6279\u91CF\u8BBF\u95EE\u4E0D\u5C5E\u4E8E\u81EA\u5DF1\u7684\u5173\u952E\u8BCD`);
        throw new TRPCError({ code: "FORBIDDEN", message: "\u60A8\u6CA1\u6709\u6743\u9650\u8BBF\u95EE\u90E8\u5206\u5173\u952E\u8BCD" });
      }
    }
  } catch (e) {
    if (e instanceof TRPCError) throw e;
    log154.warn(`[v602] verifyBatchKeywordAccess error: ${e.message}`);
  }
}
async function verifyAdGroupAccess(userId, adGroupId) {
  if (await isAdminUser(userId)) return;
  const accountId = await getAdGroupAccountId(adGroupId);
  if (accountId === null) return;
  const userAccounts = await getUserAccountIds2(userId);
  if (!userAccounts.has(accountId)) {
    log154.warn(`[v370.4] \u6570\u636E\u9694\u79BB\u62E6\u622A(adGroup): \u7528\u6237 ${userId} \u8BD5\u56FE\u8BBF\u95EE\u4E0D\u5C5E\u4E8E\u81EA\u5DF1\u7684\u5E7F\u544A\u7EC4 ${adGroupId}`);
    throw new TRPCError({ code: "FORBIDDEN", message: "\u60A8\u6CA1\u6709\u6743\u9650\u8BBF\u95EE\u6B64\u5E7F\u544A\u7EC4" });
  }
}
async function verifyScheduledTaskAccess(userId, taskId) {
  if (await isAdminUser(userId)) return;
  const taskUserId = await getScheduledTaskUserId(taskId);
  if (taskUserId === null) {
    throw new TRPCError({ code: "NOT_FOUND", message: "\u4EFB\u52A1\u4E0D\u5B58\u5728" });
  }
  if (taskUserId !== userId) {
    log154.warn(`[v370.4] \u6570\u636E\u9694\u79BB\u62E6\u622A(scheduledTask): \u7528\u6237 ${userId} \u8BD5\u56FE\u8BBF\u95EE\u4E0D\u5C5E\u4E8E\u81EA\u5DF1\u7684\u4EFB\u52A1 ${taskId}`);
    throw new TRPCError({ code: "FORBIDDEN", message: "\u60A8\u6CA1\u6709\u6743\u9650\u8BBF\u95EE\u6B64\u4EFB\u52A1" });
  }
}
function invalidateUserAccountCache(userId) {
  userAccountCache2.delete(userId);
}
function clearAllAccountCache() {
  userAccountCache2.clear();
  campaignAccountCache2.clear();
  pgOwnershipCache.clear();
  adminUserCache.clear();
}
var log154, userAccountCache2, campaignAccountCache2, pgOwnershipCache, CACHE_TTL_MS5, adminUserCache, ADMIN_CACHE_TTL_MS;
var init_accessControl = __esm({
  "server/utils/accessControl.ts"() {
    "use strict";
    init_dist();
    init_drizzle_orm();
    init_logger();
    log154 = createModuleLogger("AccessControl");
    userAccountCache2 = /* @__PURE__ */ new Map();
    campaignAccountCache2 = /* @__PURE__ */ new Map();
    pgOwnershipCache = /* @__PURE__ */ new Map();
    CACHE_TTL_MS5 = 5 * 60 * 1e3;
    adminUserCache = /* @__PURE__ */ new Map();
    ADMIN_CACHE_TTL_MS = 10 * 60 * 1e3;
    __name(isAdminUser, "isAdminUser");
    __name(getUserAccountIds2, "getUserAccountIds");
    __name(getCampaignAccountId2, "getCampaignAccountId");
    __name(getPGOwnership, "getPGOwnership");
    __name(getKeywordAccountId, "getKeywordAccountId");
    __name(getAdGroupAccountId, "getAdGroupAccountId");
    __name(getScheduledTaskUserId, "getScheduledTaskUserId");
    __name(verifyAccountAccess, "verifyAccountAccess");
    __name(verifyMultipleAccountAccess, "verifyMultipleAccountAccess");
    __name(verifyCampaignAccess, "verifyCampaignAccess");
    __name(verifyPerformanceGroupAccess, "verifyPerformanceGroupAccess");
    __name(verifyKeywordAccess, "verifyKeywordAccess");
    __name(verifyBatchKeywordAccess, "verifyBatchKeywordAccess");
    __name(verifyAdGroupAccess, "verifyAdGroupAccess");
    __name(verifyScheduledTaskAccess, "verifyScheduledTaskAccess");
    __name(invalidateUserAccountCache, "invalidateUserAccountCache");
    __name(clearAllAccountCache, "clearAllAccountCache");
  }
});

