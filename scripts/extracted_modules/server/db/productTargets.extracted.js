// Extracted from production dist/index.js
// Original module: server/db/productTargets.ts
// Lines: 59

async function createProductTarget(target) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(productTargets).values(target);
  return result[0].insertId;
}
async function getProductTargetsByAdGroupId(adGroupId) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(productTargets).where(
    and(
      eq(productTargets.internalAdGroupId, Number(adGroupId)),
      ne(productTargets.targetStatus, "archived"),
      ne(productTargets.targetStatus, "amazon_deleted")
    )
  );
}
async function getProductTargetsByAdGroupIds(adGroupIds) {
  const db = await getDb();
  if (!db || adGroupIds.length === 0) return [];
  return db.select().from(productTargets).where(
    and(
      inArray(productTargets.internalAdGroupId, adGroupIds.map((id) => Number(id))),
      ne(productTargets.targetStatus, "archived"),
      ne(productTargets.targetStatus, "amazon_deleted")
    )
  );
}
async function getProductTargetById(id) {
  const db = await getDb();
  if (!db) return void 0;
  const result = await db.select().from(productTargets).where(eq(productTargets.id, id)).limit(1);
  return result[0];
}
async function updateProductTargetBid(id, newBid) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(productTargets).set({ bid: newBid }).where(eq(productTargets.id, id));
}
async function updateProductTarget(id, data) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(productTargets).set(data).where(eq(productTargets.id, id));
}
var init_productTargets = __esm({
  "server/db/productTargets.ts"() {
    "use strict";
    init_drizzle_orm();
    init_schema2();
    init_connection();
    __name(createProductTarget, "createProductTarget");
    __name(getProductTargetsByAdGroupId, "getProductTargetsByAdGroupId");
    __name(getProductTargetsByAdGroupIds, "getProductTargetsByAdGroupIds");
    __name(getProductTargetById, "getProductTargetById");
    __name(updateProductTargetBid, "updateProductTargetBid");
    __name(updateProductTarget, "updateProductTarget");
  }
});

