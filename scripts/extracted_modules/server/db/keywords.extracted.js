// Extracted from production dist/index.js
// Original module: server/db/keywords.ts
// Lines: 84

async function createKeyword(keyword) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(keywords).values(keyword).onDuplicateKeyUpdate({
    set: {
      bid: sql`VALUES(bid)`,
      keywordStatus: sql`VALUES(keyword_status)`,
      updatedAt: sql`NOW()`
    }
  });
  return result[0].insertId;
}
async function getKeywordsByAdGroupId(adGroupId) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(keywords).where(
    and(
      eq(keywords.internalAdGroupId, Number(adGroupId)),
      ne(keywords.keywordStatus, "archived"),
      ne(keywords.keywordStatus, "amazon_deleted")
    )
  );
}
async function getKeywordById(id) {
  const db = await getDb();
  if (!db) return void 0;
  const result = await db.select().from(keywords).where(eq(keywords.id, id)).limit(1);
  return result[0];
}
async function updateKeywordBid(id, newBid) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const bidValue = typeof newBid === "number" ? String(newBid) : newBid;
  await db.update(keywords).set({ bid: bidValue }).where(eq(keywords.id, id));
}
async function updateKeyword(id, data) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(keywords).set(data).where(eq(keywords.id, id));
}
async function getKeywordsByCampaignId(campaignId) {
  const db = await getDb();
  if (!db) return [];
  const campaignIdStr = guardCampaignIdParam(campaignId, "getKeywordsByCampaignId");
  const adGroupsList = await db.select().from(adGroups).where(eq(adGroups.campaignId, campaignIdStr));
  if (adGroupsList.length === 0) return [];
  const adGroupIds = adGroupsList.map((ag) => ag.id);
  const allKeywords = await db.select().from(keywords).where(
    and(
      inArray(keywords.internalAdGroupId, adGroupIds),
      ne(keywords.keywordStatus, "archived"),
      ne(keywords.keywordStatus, "amazon_deleted")
    )
  );
  return allKeywords;
}
async function getKeywordsByIds(ids) {
  const db = await getDb();
  if (!db || ids.length === 0) return [];
  return db.select().from(keywords).where(inArray(keywords.id, ids));
}
async function batchUpdateKeywordStatus(ids, status) {
  const db = await getDb();
  if (!db || ids.length === 0) return;
  await db.update(keywords).set({ keywordStatus: status }).where(inArray(keywords.id, ids));
}
var init_keywords = __esm({
  "server/db/keywords.ts"() {
    "use strict";
    init_drizzle_orm();
    init_schema2();
    init_connection();
    init_idTypes();
    __name(createKeyword, "createKeyword");
    __name(getKeywordsByAdGroupId, "getKeywordsByAdGroupId");
    __name(getKeywordById, "getKeywordById");
    __name(updateKeywordBid, "updateKeywordBid");
    __name(updateKeyword, "updateKeyword");
    __name(getKeywordsByCampaignId, "getKeywordsByCampaignId");
    __name(getKeywordsByIds, "getKeywordsByIds");
    __name(batchUpdateKeywordStatus, "batchUpdateKeywordStatus");
  }
});

