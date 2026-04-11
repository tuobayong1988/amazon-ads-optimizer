// Extracted from production dist/index.js
// Original module: server/db/corrections.ts
// Lines: 109

async function createCorrectionReviewSession(data) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(correctionReviewSessions).values({
    userId: data.userId,
    accountId: data.accountId,
    periodStart: data.periodStart.toISOString(),
    periodEnd: data.periodEnd.toISOString(),
    sessionStatus: "analyzing",
    totalAdjustmentsReviewed: 0,
    incorrectAdjustments: 0,
    overDecreasedCount: 0,
    overIncreasedCount: 0,
    correctCount: 0
  });
  return result[0].insertId;
}
async function addAttributionCorrectionRecord(data) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(attributionCorrectionRecords).values({
    userId: data.userId,
    accountId: data.accountId,
    biddingLogId: data.biddingLogId,
    campaignId: data.campaignId,
    correctionTargetType: data.targetType,
    targetId: data.targetId,
    targetName: data.targetName || null,
    originalAdjustmentDate: typeof data.originalAdjustmentDate === "string" ? data.originalAdjustmentDate : data.originalAdjustmentDate.toISOString().slice(0, 19).replace("T", " "),
    originalBid: data.originalBid.toString(),
    adjustedBid: data.adjustedBid.toString(),
    adjustmentReason: data.adjustmentReason || null,
    metricsAtAdjustment: data.metricsAtAdjustment ? JSON.stringify(data.metricsAtAdjustment) : null,
    metricsAfterAttribution: data.metricsAfterAttribution ? JSON.stringify(data.metricsAfterAttribution) : null,
    wasIncorrect: data.wasIncorrect ? 1 : 0,
    correctionType: data.correctionType || null,
    suggestedBid: data.suggestedBid?.toString() || null,
    confidenceScore: data.confidenceScore?.toString() || null,
    correctionStatus: "pending_review"
  });
}
async function getCorrectionReviewSession(id) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(correctionReviewSessions).where(eq(correctionReviewSessions.id, id)).limit(1);
  return result[0] || null;
}
async function listCorrectionReviewSessions(userId, accountId) {
  const db = await getDb();
  if (!db) return [];
  let conditions = [eq(correctionReviewSessions.userId, userId)];
  if (accountId) {
    conditions.push(eq(correctionReviewSessions.accountId, accountId));
  }
  return await db.select().from(correctionReviewSessions).where(and(...conditions)).orderBy(desc(correctionReviewSessions.createdAt)).limit(50);
}
async function getCorrectionRecordsForSession(sessionId) {
  const db = await getDb();
  if (!db) return [];
  const session = await getCorrectionReviewSession(sessionId);
  if (!session) return [];
  return await db.select().from(attributionCorrectionRecords).where(and(
    eq(attributionCorrectionRecords.userId, session.userId),
    eq(attributionCorrectionRecords.accountId, session.accountId)
  )).orderBy(desc(attributionCorrectionRecords.originalAdjustmentDate));
}
async function updateCorrectionReviewSession(id, data) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const updateData = {};
  if (data.status !== void 0) updateData.status = data.status;
  if (data.totalAdjustmentsReviewed !== void 0) updateData.totalAdjustmentsReviewed = data.totalAdjustmentsReviewed;
  if (data.incorrectAdjustments !== void 0) updateData.incorrectAdjustments = data.incorrectAdjustments;
  if (data.overDecreasedCount !== void 0) updateData.overDecreasedCount = data.overDecreasedCount;
  if (data.overIncreasedCount !== void 0) updateData.overIncreasedCount = data.overIncreasedCount;
  if (data.correctCount !== void 0) updateData.correctCount = data.correctCount;
  if (data.estimatedLostRevenue !== void 0) updateData.estimatedLostRevenue = data.estimatedLostRevenue.toString();
  if (data.estimatedWastedSpend !== void 0) updateData.estimatedWastedSpend = data.estimatedWastedSpend.toString();
  if (data.potentialRecovery !== void 0) updateData.potentialRecovery = data.potentialRecovery.toString();
  if (data.reviewedAt !== void 0) updateData.reviewedAt = data.reviewedAt;
  if (data.reviewedBy !== void 0) updateData.reviewedBy = data.reviewedBy;
  if (data.correctionBatchId !== void 0) updateData.correctionBatchId = data.correctionBatchId;
  await db.update(correctionReviewSessions).set(updateData).where(eq(correctionReviewSessions.id, id));
}
async function updateAttributionCorrectionStatus(id, data) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(attributionCorrectionRecords).set({
    correctionStatus: data.status,
    appliedAt: data.appliedAt?.toISOString() || null,
    appliedBy: data.appliedBy || null
  }).where(eq(attributionCorrectionRecords.id, id));
}
var init_corrections = __esm({
  "server/db/corrections.ts"() {
    "use strict";
    init_drizzle_orm();
    init_schema2();
    init_connection();
    __name(createCorrectionReviewSession, "createCorrectionReviewSession");
    __name(addAttributionCorrectionRecord, "addAttributionCorrectionRecord");
    __name(getCorrectionReviewSession, "getCorrectionReviewSession");
    __name(listCorrectionReviewSessions, "listCorrectionReviewSessions");
    __name(getCorrectionRecordsForSession, "getCorrectionRecordsForSession");
    __name(updateCorrectionReviewSession, "updateCorrectionReviewSession");
    __name(updateAttributionCorrectionStatus, "updateAttributionCorrectionStatus");
  }
});

