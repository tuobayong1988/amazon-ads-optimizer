// Extracted from production dist/index.js
// Original module: server/db/accounts.ts
// Lines: 167

var accounts_exports = {};
__export(accounts_exports, {
  createAdAccount: () => createAdAccount,
  createPerformanceGroup: () => createPerformanceGroup,
  deleteAdAccount: () => deleteAdAccount,
  deletePerformanceGroup: () => deletePerformanceGroup,
  getAccountsForUser: () => getAccountsForUser,
  getAdAccountById: () => getAdAccountById,
  getAdAccounts: () => getAdAccounts,
  getAdAccountsByOrganizationId: () => getAdAccountsByOrganizationId,
  getAdAccountsByUserId: () => getAdAccountsByUserId,
  getDefaultAdAccount: () => getDefaultAdAccount,
  getPerformanceGroupById: () => getPerformanceGroupById,
  getPerformanceGroupsByAccountId: () => getPerformanceGroupsByAccountId,
  reorderAdAccounts: () => reorderAdAccounts,
  setDefaultAdAccount: () => setDefaultAdAccount,
  updateAdAccount: () => updateAdAccount,
  updateAdAccountConnectionStatus: () => updateAdAccountConnectionStatus,
  updatePerformanceGroup: () => updatePerformanceGroup
});
async function createAdAccount(account) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(adAccounts).values(account);
  return result[0].insertId;
}
async function getAdAccountsByUserId(userId) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(adAccounts).where(eq(adAccounts.userId, userId)).orderBy(adAccounts.sortOrder, adAccounts.createdAt);
}
async function getAdAccountsByOrganizationId(organizationId) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(adAccounts).where(eq(adAccounts.organizationId, organizationId)).orderBy(adAccounts.sortOrder, adAccounts.createdAt);
}
async function getAccountsForUser(user) {
  if (user.organizationId && user.organizationId > 0) {
    return getAdAccountsByOrganizationId(user.organizationId);
  }
  if (user.organizationId === 0) {
    return [];
  }
  return getAdAccountsByUserId(user.id);
}
async function getAdAccounts() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(adAccounts);
}
async function getAdAccountById(id) {
  const db = await getDb();
  if (!db) return void 0;
  const result = await db.select().from(adAccounts).where(eq(adAccounts.id, id)).limit(1);
  return result[0];
}
async function updateAdAccount(id, data) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(adAccounts).set(data).where(eq(adAccounts.id, id));
}
async function deleteAdAccount(id) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(adAccounts).where(eq(adAccounts.id, id));
}
async function setDefaultAdAccount(userId, accountId) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(adAccounts).set({ isDefault: 0 }).where(eq(adAccounts.userId, userId));
  await db.update(adAccounts).set({ isDefault: 1 }).where(eq(adAccounts.id, accountId));
}
async function getDefaultAdAccount(userId) {
  const db = await getDb();
  if (!db) return void 0;
  const result = await db.select().from(adAccounts).where(and(eq(adAccounts.userId, userId), eq(adAccounts.isDefault, 1))).limit(1);
  return result[0];
}
async function updateAdAccountConnectionStatus(id, status, errorMessage) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(adAccounts).set({
    connectionStatus: status,
    lastConnectionCheck: (/* @__PURE__ */ new Date()).toISOString(),
    connectionErrorMessage: errorMessage || null
  }).where(eq(adAccounts.id, id));
}
async function reorderAdAccounts(userId, accountIds) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  for (let i = 0; i < accountIds.length; i++) {
    await db.update(adAccounts).set({ sortOrder: i }).where(and(eq(adAccounts.id, accountIds[i]), eq(adAccounts.userId, userId)));
  }
}
async function createPerformanceGroup(group) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(performanceGroups).values(group);
  return result[0].insertId;
}
async function getPerformanceGroupsByAccountId(accountId) {
  log9.debug("[db.getPerformanceGroupsByAccountId] called with accountId:", accountId);
  try {
    const db = await getDb();
    log9.debug("[db.getPerformanceGroupsByAccountId] db obtained:", !!db);
    if (!db) {
      log9.debug("[db.getPerformanceGroupsByAccountId] db is null, returning empty array");
      return [];
    }
    if (!accountId || accountId === 0) {
      const allRecords = await db.select().from(performanceGroups);
      log9.debug("[db.getPerformanceGroupsByAccountId] accountId is 0, returning all:", allRecords.length);
      return allRecords;
    }
    const result = await db.select().from(performanceGroups).where(eq(performanceGroups.accountId, accountId));
    log9.debug("[db.getPerformanceGroupsByAccountId] filtered result count:", result.length);
    return result;
  } catch (error48) {
    log9.warn("[db.getPerformanceGroupsByAccountId] error:", error48);
    return [];
  }
}
async function getPerformanceGroupById(id) {
  const db = await getDb();
  if (!db) return void 0;
  const result = await db.select().from(performanceGroups).where(eq(performanceGroups.id, id)).limit(1);
  return result[0];
}
async function updatePerformanceGroup(id, data) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(performanceGroups).set(data).where(eq(performanceGroups.id, id));
}
async function deletePerformanceGroup(id) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(performanceGroups).where(eq(performanceGroups.id, id));
}
var log9;
var init_accounts = __esm({
  "server/db/accounts.ts"() {
    "use strict";
    init_drizzle_orm();
    init_schema2();
    init_connection();
    init_logger();
    log9 = createModuleLogger("DB:accounts");
    __name(createAdAccount, "createAdAccount");
    __name(getAdAccountsByUserId, "getAdAccountsByUserId");
    __name(getAdAccountsByOrganizationId, "getAdAccountsByOrganizationId");
    __name(getAccountsForUser, "getAccountsForUser");
    __name(getAdAccounts, "getAdAccounts");
    __name(getAdAccountById, "getAdAccountById");
    __name(updateAdAccount, "updateAdAccount");
    __name(deleteAdAccount, "deleteAdAccount");
    __name(setDefaultAdAccount, "setDefaultAdAccount");
    __name(getDefaultAdAccount, "getDefaultAdAccount");
    __name(updateAdAccountConnectionStatus, "updateAdAccountConnectionStatus");
    __name(reorderAdAccounts, "reorderAdAccounts");
    __name(createPerformanceGroup, "createPerformanceGroup");
    __name(getPerformanceGroupsByAccountId, "getPerformanceGroupsByAccountId");
    __name(getPerformanceGroupById, "getPerformanceGroupById");
    __name(updatePerformanceGroup, "updatePerformanceGroup");
    __name(deletePerformanceGroup, "deletePerformanceGroup");
  }
});

