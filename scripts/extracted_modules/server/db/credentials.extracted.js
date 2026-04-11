// Extracted from production dist/index.js
// Original module: server/db/credentials.ts
// Lines: 95

async function saveAmazonApiCredentials(data) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const { safeEncrypt: safeEncrypt2 } = await Promise.resolve().then(() => (init_cryptoService(), cryptoService_exports));
  const updateSet = {
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  if (data.clientId && data.clientId !== "" && data.clientId !== "__USE_SERVER_SECRET__") {
    updateSet.clientId = data.clientId;
  }
  if (data.clientSecret && data.clientSecret !== "" && data.clientSecret !== "__USE_SERVER_SECRET__") {
    updateSet.clientSecret = safeEncrypt2(data.clientSecret);
  }
  if (data.refreshToken && data.refreshToken !== "") {
    updateSet.refreshToken = safeEncrypt2(data.refreshToken);
  }
  if (data.profileId && data.profileId !== "") {
    updateSet.profileId = data.profileId;
  }
  if (data.region) {
    updateSet.region = data.region;
  }
  const encryptedData = {
    ...data,
    clientSecret: data.clientSecret ? safeEncrypt2(data.clientSecret) : data.clientSecret,
    refreshToken: data.refreshToken ? safeEncrypt2(data.refreshToken) : data.refreshToken
  };
  await db.insert(amazonApiCredentials).values(encryptedData).onDuplicateKeyUpdate({
    set: updateSet
  });
  log14.info(`[db] v345: saveAmazonApiCredentials \u5B8C\u6210 (accountId=${data.accountId}, \u66F4\u65B0\u5B57\u6BB5=[${Object.keys(updateSet).filter((k) => k !== "updatedAt").join(",")}], \u51ED\u8BC1\u5DF2\u52A0\u5BC6)`);
}
async function getAmazonApiCredentials(accountId) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(amazonApiCredentials).where(eq(amazonApiCredentials.accountId, accountId)).limit(1);
  const row = result[0] || null;
  if (!row) return null;
  const { safeDecrypt: safeDecrypt2 } = await Promise.resolve().then(() => (init_cryptoService(), cryptoService_exports));
  return {
    ...row,
    clientSecret: safeDecrypt2(row.clientSecret),
    refreshToken: safeDecrypt2(row.refreshToken)
  };
}
async function updateAmazonApiCredentials(accountId, data) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const { safeEncrypt: safeEncrypt2 } = await Promise.resolve().then(() => (init_cryptoService(), cryptoService_exports));
  const encryptedData = { ...data, updatedAt: (/* @__PURE__ */ new Date()).toISOString() };
  if (encryptedData.clientSecret) {
    encryptedData.clientSecret = safeEncrypt2(encryptedData.clientSecret);
  }
  if (encryptedData.refreshToken) {
    encryptedData.refreshToken = safeEncrypt2(encryptedData.refreshToken);
  }
  await db.update(amazonApiCredentials).set(encryptedData).where(eq(amazonApiCredentials.accountId, accountId));
}
async function deleteAmazonApiCredentials(accountId) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(amazonApiCredentials).where(eq(amazonApiCredentials.accountId, accountId));
}
async function updateAmazonApiCredentialsLastSync(accountId) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(amazonApiCredentials).set({ lastSyncAt: (/* @__PURE__ */ new Date()).toISOString(), updatedAt: (/* @__PURE__ */ new Date()).toISOString() }).where(eq(amazonApiCredentials.accountId, accountId));
}
async function updateAmazonApiCredentialsTimezone(accountId, timezone, currencyCode) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(amazonApiCredentials).set({
    timezone,
    currencyCode,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  }).where(eq(amazonApiCredentials.accountId, accountId));
}
var log14;
var init_credentials = __esm({
  "server/db/credentials.ts"() {
    "use strict";
    init_drizzle_orm();
    init_connection();
    init_logger();
    init_schema2();
    log14 = createModuleLogger("DB:credentials");
    __name(saveAmazonApiCredentials, "saveAmazonApiCredentials");
    __name(getAmazonApiCredentials, "getAmazonApiCredentials");
    __name(updateAmazonApiCredentials, "updateAmazonApiCredentials");
    __name(deleteAmazonApiCredentials, "deleteAmazonApiCredentials");
    __name(updateAmazonApiCredentialsLastSync, "updateAmazonApiCredentialsLastSync");
    __name(updateAmazonApiCredentialsTimezone, "updateAmazonApiCredentialsTimezone");
  }
});

