// Extracted from production dist/index.js
// Original module: server/db/aiOptimization.ts
// Lines: 134

async function createAiOptimizationExecution(data) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(aiOptimizationExecutions).values(data);
  return result[0].insertId;
}
async function getAiOptimizationExecution(id) {
  const db = await getDb();
  if (!db) return null;
  const results = await db.select().from(aiOptimizationExecutions).where(eq(aiOptimizationExecutions.id, id));
  return results[0] || null;
}
async function getAiOptimizationExecutionsByCampaign(campaignId, limit = 50) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(aiOptimizationExecutions).where(eq(aiOptimizationExecutions.campaignId, String(campaignId))).orderBy(desc(aiOptimizationExecutions.executedAt)).limit(limit);
}
async function getAiOptimizationExecutionsByAccount(accountId, limit = 100) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(aiOptimizationExecutions).where(eq(aiOptimizationExecutions.accountId, accountId)).orderBy(desc(aiOptimizationExecutions.executedAt)).limit(limit);
}
async function updateAiOptimizationExecution(id, data) {
  const db = await getDb();
  if (!db) return;
  await db.update(aiOptimizationExecutions).set(data).where(eq(aiOptimizationExecutions.id, id));
}
async function createAiOptimizationAction(data) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(aiOptimizationActions).values(data);
  return result[0].insertId;
}
async function createAiOptimizationActions(dataList) {
  const db = await getDb();
  if (!db) return;
  if (dataList.length > 0) {
    await db.insert(aiOptimizationActions).values(dataList);
  }
}
async function getAiOptimizationActionsByExecution(executionId) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(aiOptimizationActions).where(eq(aiOptimizationActions.executionId, executionId)).orderBy(aiOptimizationActions.id);
}
async function updateAiOptimizationAction(id, data) {
  const db = await getDb();
  if (!db) return;
  await db.update(aiOptimizationActions).set(data).where(eq(aiOptimizationActions.id, id));
}
async function createAiOptimizationPrediction(data) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(aiOptimizationPredictions).values(data);
  return result[0].insertId;
}
async function createAiOptimizationPredictions(dataList) {
  const db = await getDb();
  if (!db) return;
  if (dataList.length > 0) {
    await db.insert(aiOptimizationPredictions).values(dataList);
  }
}
async function getAiOptimizationPredictionsByExecution(executionId) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(aiOptimizationPredictions).where(eq(aiOptimizationPredictions.executionId, executionId));
}
async function createAiOptimizationReview(data) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(aiOptimizationReviews).values(data);
  return result[0].insertId;
}
async function getAiOptimizationReviewsByExecution(executionId) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(aiOptimizationReviews).where(eq(aiOptimizationReviews.executionId, executionId));
}
async function getPendingAiOptimizationReviews() {
  const db = await getDb();
  if (!db) return [];
  const now = /* @__PURE__ */ new Date();
  return db.select().from(aiOptimizationReviews).where(and(
    eq(aiOptimizationReviews.reviewStatus, "pending"),
    lte(aiOptimizationReviews.scheduledAt, now.toISOString())
  )).orderBy(aiOptimizationReviews.scheduledAt);
}
async function updateAiOptimizationReview(id, data) {
  const db = await getDb();
  if (!db) return;
  await db.update(aiOptimizationReviews).set(data).where(eq(aiOptimizationReviews.id, id));
}
async function getAiOptimizationExecutionDetail(executionId) {
  const execution = await getAiOptimizationExecution(executionId);
  if (!execution) return null;
  const [actions, predictions, reviews] = await Promise.all([
    getAiOptimizationActionsByExecution(executionId),
    getAiOptimizationPredictionsByExecution(executionId),
    getAiOptimizationReviewsByExecution(executionId)
  ]);
  return {
    execution,
    actions,
    predictions,
    reviews
  };
}
var init_aiOptimization = __esm({
  "server/db/aiOptimization.ts"() {
    "use strict";
    init_drizzle_orm();
    init_schema2();
    init_connection();
    __name(createAiOptimizationExecution, "createAiOptimizationExecution");
    __name(getAiOptimizationExecution, "getAiOptimizationExecution");
    __name(getAiOptimizationExecutionsByCampaign, "getAiOptimizationExecutionsByCampaign");
    __name(getAiOptimizationExecutionsByAccount, "getAiOptimizationExecutionsByAccount");
    __name(updateAiOptimizationExecution, "updateAiOptimizationExecution");
    __name(createAiOptimizationAction, "createAiOptimizationAction");
    __name(createAiOptimizationActions, "createAiOptimizationActions");
    __name(getAiOptimizationActionsByExecution, "getAiOptimizationActionsByExecution");
    __name(updateAiOptimizationAction, "updateAiOptimizationAction");
    __name(createAiOptimizationPrediction, "createAiOptimizationPrediction");
    __name(createAiOptimizationPredictions, "createAiOptimizationPredictions");
    __name(getAiOptimizationPredictionsByExecution, "getAiOptimizationPredictionsByExecution");
    __name(createAiOptimizationReview, "createAiOptimizationReview");
    __name(getAiOptimizationReviewsByExecution, "getAiOptimizationReviewsByExecution");
    __name(getPendingAiOptimizationReviews, "getPendingAiOptimizationReviews");
    __name(updateAiOptimizationReview, "updateAiOptimizationReview");
    __name(getAiOptimizationExecutionDetail, "getAiOptimizationExecutionDetail");
  }
});

