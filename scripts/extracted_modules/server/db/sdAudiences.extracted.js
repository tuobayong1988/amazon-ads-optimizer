// Extracted from production dist/index.js
// Original module: server/db/sdAudiences.ts
// Lines: 70

var sdAudiences_exports = {};
__export(sdAudiences_exports, {
  getEnabledSdAudiencesByAccountId: () => getEnabledSdAudiencesByAccountId,
  getSdAudienceById: () => getSdAudienceById,
  getSdAudiencesByAdGroupId: () => getSdAudiencesByAdGroupId,
  getSdAudiencesByAdGroupIds: () => getSdAudiencesByAdGroupIds,
  updateSdAudience: () => updateSdAudience,
  updateSdAudienceBid: () => updateSdAudienceBid
});
async function getSdAudiencesByAdGroupId(adGroupId) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(sdAudiences).where(
    and(
      eq(sdAudiences.internalAdGroupId, adGroupId),
      ne(sdAudiences.state, "archived")
    )
  );
}
async function getSdAudiencesByAdGroupIds(adGroupIds) {
  const db = await getDb();
  if (!db || adGroupIds.length === 0) return [];
  return db.select().from(sdAudiences).where(
    and(
      inArray(sdAudiences.internalAdGroupId, adGroupIds),
      ne(sdAudiences.state, "archived")
    )
  );
}
async function getSdAudienceById(id) {
  const db = await getDb();
  if (!db) return void 0;
  const result = await db.select().from(sdAudiences).where(eq(sdAudiences.id, id)).limit(1);
  return result[0];
}
async function updateSdAudienceBid(id, newBid) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(sdAudiences).set({ bid: newBid }).where(eq(sdAudiences.id, id));
}
async function updateSdAudience(id, data) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(sdAudiences).set(data).where(eq(sdAudiences.id, id));
}
async function getEnabledSdAudiencesByAccountId(accountId) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(sdAudiences).where(
    and(
      eq(sdAudiences.accountId, accountId),
      eq(sdAudiences.state, "enabled")
    )
  );
}
var init_sdAudiences = __esm({
  "server/db/sdAudiences.ts"() {
    "use strict";
    init_drizzle_orm();
    init_schema2();
    init_connection();
    __name(getSdAudiencesByAdGroupId, "getSdAudiencesByAdGroupId");
    __name(getSdAudiencesByAdGroupIds, "getSdAudiencesByAdGroupIds");
    __name(getSdAudienceById, "getSdAudienceById");
    __name(updateSdAudienceBid, "updateSdAudienceBid");
    __name(updateSdAudience, "updateSdAudience");
    __name(getEnabledSdAudiencesByAccountId, "getEnabledSdAudiencesByAccountId");
  }
});

