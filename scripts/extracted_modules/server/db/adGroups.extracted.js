// Extracted from production dist/index.js
// Original module: server/db/adGroups.ts
// Lines: 43

async function createAdGroup(adGroup) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(adGroups).values(adGroup);
  return result[0].insertId;
}
async function getAdGroupsByCampaignId(campaignId) {
  const db = await getDb();
  if (!db) return [];
  const campaignIdStr = guardCampaignIdParam(campaignId, "getAdGroupsByCampaignId");
  return db.select().from(adGroups).where(eq(adGroups.campaignId, campaignIdStr));
}
async function getAdGroupById(id) {
  const db = await getDb();
  if (!db) return void 0;
  const result = await db.select().from(adGroups).where(eq(adGroups.id, id)).limit(1);
  return result[0];
}
async function updateAdGroupDefaultBid(id, defaultBid) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(adGroups).set({ defaultBid }).where(eq(adGroups.id, id));
}
async function updateAdGroupStatus(id, status) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(adGroups).set({ adGroupStatus: status }).where(eq(adGroups.id, id));
}
var init_adGroups = __esm({
  "server/db/adGroups.ts"() {
    "use strict";
    init_drizzle_orm();
    init_schema2();
    init_connection();
    init_idTypes();
    __name(createAdGroup, "createAdGroup");
    __name(getAdGroupsByCampaignId, "getAdGroupsByCampaignId");
    __name(getAdGroupById, "getAdGroupById");
    __name(updateAdGroupDefaultBid, "updateAdGroupDefaultBid");
    __name(updateAdGroupStatus, "updateAdGroupStatus");
  }
});

