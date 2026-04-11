// Extracted from production dist/index.js
// Original module: server/db/batchOps.ts
// Lines: 117

async function createBatchOperation(data) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(batchOperations).values({
    userId: data.userId,
    accountId: data.accountId || null,
    operationType: data.operationType,
    name: data.name,
    description: data.description || null,
    requiresApproval: data.requiresApproval !== false ? 1 : 0,
    sourceType: data.sourceType || null,
    sourceTaskId: data.sourceTaskId || null,
    batchStatus: "pending",
    totalItems: 0,
    processedItems: 0,
    successItems: 0,
    failedItems: 0
  });
  return result[0].insertId;
}
async function addBatchOperationItems(batchId, items) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  for (const item of items) {
    const bidChangePercent = item.currentBid && item.newBid ? (item.newBid - item.currentBid) / item.currentBid * 100 : null;
    await db.insert(batchOperationItems).values({
      batchId,
      entityType: item.entityType,
      entityId: item.entityId,
      entityName: item.entityName || null,
      negativeKeyword: item.negativeKeyword || null,
      negativeMatchType: item.negativeMatchType || null,
      negativeLevel: item.negativeLevel || null,
      currentBid: item.currentBid?.toString() || null,
      newBid: item.newBid?.toString() || null,
      bidChangePercent: bidChangePercent?.toFixed(2) || null,
      bidChangeReason: item.bidChangeReason || null,
      previousValue: item.previousValue || null,
      itemStatus: "pending"
    });
  }
  await db.update(batchOperations).set({ totalItems: items.length }).where(eq(batchOperations.id, batchId));
}
async function getBatchOperation(id) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(batchOperations).where(eq(batchOperations.id, id)).limit(1);
  return result[0] || null;
}
async function getBatchOperationItems(batchId) {
  const db = await getDb();
  if (!db) return [];
  return await db.select().from(batchOperationItems).where(eq(batchOperationItems.batchId, batchId));
}
async function listBatchOperations(userId, options) {
  const db = await getDb();
  if (!db) return [];
  let query = db.select().from(batchOperations).where(eq(batchOperations.userId, userId)).orderBy(desc(batchOperations.createdAt)).limit(options?.limit || 50);
  return await query;
}
async function approveBatchOperation(id, approvedBy) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(batchOperations).set({
    batchStatus: "approved",
    approvedBy,
    approvedAt: (/* @__PURE__ */ new Date()).toISOString()
  }).where(eq(batchOperations.id, id));
}
async function updateBatchOperationStatus(id, data) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const updateData = { batchStatus: data.status };
  if (data.processedItems !== void 0) updateData.processedItems = data.processedItems;
  if (data.successItems !== void 0) updateData.successItems = data.successItems;
  if (data.failedItems !== void 0) updateData.failedItems = data.failedItems;
  if (data.executedBy !== void 0) updateData.executedBy = data.executedBy;
  if (data.executedAt !== void 0) updateData.executedAt = data.executedAt;
  if (data.completedAt !== void 0) updateData.completedAt = data.completedAt;
  await db.update(batchOperations).set(updateData).where(eq(batchOperations.id, id));
}
async function updateBatchOperationItemStatus(itemId, data) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(batchOperationItems).set({
    itemStatus: data.status,
    errorMessage: data.errorMessage || null,
    itemExecutedAt: data.executedAt?.toISOString() || (/* @__PURE__ */ new Date()).toISOString()
  }).where(eq(batchOperationItems.id, itemId));
}
async function rollbackBatchOperation(id, rolledBackBy) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(batchOperations).set({
    batchStatus: "rolled_back",
    rolledBackBy,
    rolledBackAt: (/* @__PURE__ */ new Date()).toISOString()
  }).where(eq(batchOperations.id, id));
}
var init_batchOps = __esm({
  "server/db/batchOps.ts"() {
    "use strict";
    init_drizzle_orm();
    init_schema2();
    init_connection();
    __name(createBatchOperation, "createBatchOperation");
    __name(addBatchOperationItems, "addBatchOperationItems");
    __name(getBatchOperation, "getBatchOperation");
    __name(getBatchOperationItems, "getBatchOperationItems");
    __name(listBatchOperations, "listBatchOperations");
    __name(approveBatchOperation, "approveBatchOperation");
    __name(updateBatchOperationStatus, "updateBatchOperationStatus");
    __name(updateBatchOperationItemStatus, "updateBatchOperationItemStatus");
    __name(rollbackBatchOperation, "rollbackBatchOperation");
  }
});

