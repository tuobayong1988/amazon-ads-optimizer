/**
 * v361: 批量操作审批
 * 从db.ts拆分的子模块
 */

import { count, desc, eq, not } from 'drizzle-orm';
import { BatchOperation, BatchOperationItem, batchOperationItems, batchOperations } from '../../drizzle/schema';
import { getDb } from './connection';

// ==================== Batch Operations Functions ====================

// Create a new batch operation
export async function createBatchOperation(data: {
  userId: number;
  accountId?: number;
  operationType: 'negative_keyword' | 'bid_adjustment' | 'keyword_migration' | 'campaign_status';
  name: string;
  description?: string;
  requiresApproval?: boolean;
  sourceType?: string;
  sourceTaskId?: number;
}): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // @ts-ignore DB query type inference limitation
  const result = await db.insert(batchOperations).values({
    userId: data.userId,
    accountId: data.accountId || null,
    operationType: data.operationType,
    name: data.name,
    description: data.description || null,
    requiresApproval: data.requiresApproval !== false ? 1 : 0,
    sourceType: data.sourceType || null,
    sourceTaskId: data.sourceTaskId || null,
    batchStatus: 'pending',
    totalItems: 0,
    processedItems: 0,
    successItems: 0,
    failedItems: 0,
  });
  
  return result[0].insertId;
}

// Add items to a batch operation

// Add items to a batch operation
export async function addBatchOperationItems(batchId: number, items: Array<{
  entityType: 'keyword' | 'product_target' | 'campaign' | 'ad_group';
  entityId: number;
  entityName?: string;
  negativeKeyword?: string;
  negativeMatchType?: 'negative_phrase' | 'negative_exact';
  negativeLevel?: 'ad_group' | 'campaign';
  currentBid?: number;
  newBid?: number;
  bidChangeReason?: string;
  previousValue?: string;
}>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // Insert items
  for (const item of items) {
    const bidChangePercent = item.currentBid && item.newBid 
      ? ((item.newBid - item.currentBid) / item.currentBid * 100)
      : null;
      
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
      itemStatus: 'pending',
    });
  }
  
  // Update total count
  await db.update(batchOperations)
    .set({ totalItems: items.length })
    .where(eq(batchOperations.id, batchId));
}

// Get batch operation by ID

// Get batch operation by ID
export async function getBatchOperation(id: number): Promise<BatchOperation | null> {
  const db = await getDb();
  if (!db) return null;
  
  const result = await db.select()
    .from(batchOperations)
    .where(eq(batchOperations.id, id))
    .limit(1);
  
  return result[0] || null;
}

// Get batch operation items

// Get batch operation items
export async function getBatchOperationItems(batchId: number): Promise<BatchOperationItem[]> {
  const db = await getDb();
  if (!db) return [];
  
  return await db.select()
    .from(batchOperationItems)
    .where(eq(batchOperationItems.batchId, batchId));
}

// List batch operations for a user

// List batch operations for a user
export async function listBatchOperations(userId: number, options?: {
  accountId?: number;
  status?: string;
  operationType?: string;
  limit?: number;
  offset?: number;
}): Promise<BatchOperation[]> {
  const db = await getDb();
  if (!db) return [];
  
  let query = db.select()
    .from(batchOperations)
    .where(eq(batchOperations.userId, userId))
    .orderBy(desc(batchOperations.createdAt))
    .limit(options?.limit || 50);
  
  return await query;
}

// Approve batch operation

// Approve batch operation
export async function approveBatchOperation(id: number, approvedBy: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(batchOperations)
    .set({
      batchStatus: 'approved',
      approvedBy,
      approvedAt: new Date().toISOString(),
    })
    .where(eq(batchOperations.id, id));
}

// Update batch operation status

// Update batch operation status
export async function updateBatchOperationStatus(id: number, data: {
  status: 'pending' | 'approved' | 'executing' | 'completed' | 'failed' | 'cancelled' | 'rolled_back';
  processedItems?: number;
  successItems?: number;
  failedItems?: number;
  executedBy?: number;
  executedAt?: Date;
  completedAt?: Date;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const updateData: Record<string, unknown> = { batchStatus: data.status };
  if (data.processedItems !== undefined) updateData.processedItems = data.processedItems;
  if (data.successItems !== undefined) updateData.successItems = data.successItems;
  if (data.failedItems !== undefined) updateData.failedItems = data.failedItems;
  if (data.executedBy !== undefined) updateData.executedBy = data.executedBy;
  if (data.executedAt !== undefined) updateData.executedAt = data.executedAt;
  if (data.completedAt !== undefined) updateData.completedAt = data.completedAt;
  
  await db.update(batchOperations)
    .set(updateData)
    .where(eq(batchOperations.id, id));
}

// Update batch operation item status

// Update batch operation item status
export async function updateBatchOperationItemStatus(itemId: number, data: {
  status: 'pending' | 'success' | 'failed' | 'skipped' | 'rolled_back';
  errorMessage?: string;
  executedAt?: Date;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(batchOperationItems)
    .set({
      itemStatus: data.status,
      errorMessage: data.errorMessage || null,
      itemExecutedAt: data.executedAt?.toISOString() || new Date().toISOString(),
    })
    .where(eq(batchOperationItems.id, itemId));
}

// Rollback batch operation

// Rollback batch operation
export async function rollbackBatchOperation(id: number, rolledBackBy: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(batchOperations)
    .set({
      batchStatus: 'rolled_back',
      rolledBackBy,
      rolledBackAt: new Date().toISOString(),
    })
    .where(eq(batchOperations.id, id));
}

// ==================== Attribution Correction Functions ====================

// Create correction review session
