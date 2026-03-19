/**
 * v361: 归因纠错管理
 * 从db.ts拆分的子模块
 */

import { and, desc, eq, not } from 'drizzle-orm';
import { AttributionCorrectionRecord, CorrectionReviewSession, attributionCorrectionRecords, correctionReviewSessions } from '../../drizzle/schema';
import { getDb } from './connection';

// ==================== Attribution Correction Functions ====================

// Create correction review session
export async function createCorrectionReviewSession(data: {
  userId: number;
  accountId: number;
  periodStart: Date;
  periodEnd: Date;
}): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(correctionReviewSessions).values({
    userId: data.userId,
    accountId: data.accountId,
    periodStart: data.periodStart.toISOString(),
    periodEnd: data.periodEnd.toISOString(),
    sessionStatus: 'analyzing',
    totalAdjustmentsReviewed: 0,
    incorrectAdjustments: 0,
    overDecreasedCount: 0,
    overIncreasedCount: 0,
    correctCount: 0,
  });
  
  return result[0].insertId;
}

// Add attribution correction record

// Add attribution correction record
export async function addAttributionCorrectionRecord(data: {
  userId: number;
  accountId: number;
  biddingLogId: number;
  campaignId: number;
  targetType: 'keyword' | 'product_target';
  targetId: number;
  targetName?: string;
  originalAdjustmentDate: Date | string;
  originalBid: number;
  adjustedBid: number;
  adjustmentReason?: string;
  metricsAtAdjustment?: Record<string, unknown>;
  metricsAfterAttribution?: Record<string, unknown>;
  wasIncorrect?: boolean;
  correctionType?: 'over_decreased' | 'over_increased' | 'correct';
  suggestedBid?: number;
  confidenceScore?: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // @ts-expect-error - Drizzle query builder type
  await db.insert(attributionCorrectionRecords).values({
    userId: data.userId,
    accountId: data.accountId,
    biddingLogId: data.biddingLogId,
    campaignId: data.campaignId,
    correctionTargetType: data.targetType,
    targetId: data.targetId,
    targetName: data.targetName || null,
    originalAdjustmentDate: typeof data.originalAdjustmentDate === 'string' 
      ? data.originalAdjustmentDate 
      : data.originalAdjustmentDate.toISOString().slice(0, 19).replace('T', ' '),
    originalBid: data.originalBid.toString(),
    adjustedBid: data.adjustedBid.toString(),
    adjustmentReason: data.adjustmentReason || null,
    metricsAtAdjustment: data.metricsAtAdjustment ? JSON.stringify(data.metricsAtAdjustment) : null,
    metricsAfterAttribution: data.metricsAfterAttribution ? JSON.stringify(data.metricsAfterAttribution) : null,
    wasIncorrect: data.wasIncorrect ? 1 : 0,
    correctionType: data.correctionType || null,
    suggestedBid: data.suggestedBid?.toString() || null,
    confidenceScore: data.confidenceScore?.toString() || null,
    correctionStatus: 'pending_review',
  } as Record<string, unknown>);
}

// Get correction review session

// Get correction review session
export async function getCorrectionReviewSession(id: number): Promise<CorrectionReviewSession | null> {
  const db = await getDb();
  if (!db) return null;
  
  const result = await db.select()
    .from(correctionReviewSessions)
    .where(eq(correctionReviewSessions.id, id))
    .limit(1);
  
  return result[0] || null;
}

// List correction review sessions

// List correction review sessions
export async function listCorrectionReviewSessions(userId: number, accountId?: number): Promise<CorrectionReviewSession[]> {
  const db = await getDb();
  if (!db) return [];
  
  let conditions = [eq(correctionReviewSessions.userId, userId)];
  if (accountId) {
    conditions.push(eq(correctionReviewSessions.accountId, accountId));
  }
  
  return await db.select()
    .from(correctionReviewSessions)
    .where(and(...conditions))
    .orderBy(desc(correctionReviewSessions.createdAt))
    .limit(50);
}

// Get correction records for a session

// Get correction records for a session
export async function getCorrectionRecordsForSession(sessionId: number): Promise<AttributionCorrectionRecord[]> {
  const db = await getDb();
  if (!db) return [];
  
  // Get session to find the period
  const session = await getCorrectionReviewSession(sessionId);
  if (!session) return [];
  
  return await db.select()
    .from(attributionCorrectionRecords)
    .where(and(
      eq(attributionCorrectionRecords.userId, session.userId),
      eq(attributionCorrectionRecords.accountId, session.accountId)
    ))
    .orderBy(desc(attributionCorrectionRecords.originalAdjustmentDate));
}

// Update correction review session

// Update correction review session
export async function updateCorrectionReviewSession(id: number, data: {
  status?: 'analyzing' | 'ready_for_review' | 'reviewed' | 'corrections_applied';
  totalAdjustmentsReviewed?: number;
  incorrectAdjustments?: number;
  overDecreasedCount?: number;
  overIncreasedCount?: number;
  correctCount?: number;
  estimatedLostRevenue?: number;
  estimatedWastedSpend?: number;
  potentialRecovery?: number;
  reviewedAt?: Date;
  reviewedBy?: number;
  correctionBatchId?: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const updateData: Record<string, unknown> = {};
  if (data.status !== undefined) updateData.status = data.status;
  if (data.totalAdjustmentsReviewed !== undefined) updateData.totalAdjustmentsReviewed = data.totalAdjustmentsReviewed;
  if (data.incorrectAdjustments !== undefined) updateData.incorrectAdjustments = data.incorrectAdjustments;
  if (data.overDecreasedCount !== undefined) updateData.overDecreasedCount = data.overDecreasedCount;
  if (data.overIncreasedCount !== undefined) updateData.overIncreasedCount = data.overIncreasedCount;
  if (data.correctCount !== undefined) updateData.correctCount = data.correctCount;
  if (data.estimatedLostRevenue !== undefined) updateData.estimatedLostRevenue = data.estimatedLostRevenue.toString();
  if (data.estimatedWastedSpend !== undefined) updateData.estimatedWastedSpend = data.estimatedWastedSpend.toString();
  if (data.potentialRecovery !== undefined) updateData.potentialRecovery = data.potentialRecovery.toString();
  if (data.reviewedAt !== undefined) updateData.reviewedAt = data.reviewedAt;
  if (data.reviewedBy !== undefined) updateData.reviewedBy = data.reviewedBy;
  if (data.correctionBatchId !== undefined) updateData.correctionBatchId = data.correctionBatchId;
  
  await db.update(correctionReviewSessions)
    .set(updateData)
    .where(eq(correctionReviewSessions.id, id));
}

// Update attribution correction record status

// Update attribution correction record status
export async function updateAttributionCorrectionStatus(id: number, data: {
  status: 'pending_review' | 'approved' | 'applied' | 'dismissed';
  appliedAt?: Date;
  appliedBy?: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(attributionCorrectionRecords)
    .set({
      correctionStatus: data.status,
      appliedAt: data.appliedAt?.toISOString() || null,
      appliedBy: data.appliedBy || null,
    })
    .where(eq(attributionCorrectionRecords.id, id));
}


// ==================== Team Member Functions ====================
