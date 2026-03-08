/**
 * v361: 导入任务管理
 * 从db.ts拆分的子模块
 */

import { desc, eq, not } from 'drizzle-orm';
import { InsertImportJob, importJobs } from '../../drizzle/schema';
import { getDb } from './connection';

// ==================== Import Job Functions ====================
export async function createImportJob(job: InsertImportJob) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(importJobs).values(job);
  return result[0].insertId;
}

export async function getImportJobsByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select()
    .from(importJobs)
    .where(eq(importJobs.userId, userId))
    .orderBy(desc(importJobs.createdAt));
}

export async function updateImportJob(id: number, data: Partial<InsertImportJob>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(importJobs).set(data).where(eq(importJobs.id, id));
}

// ==================== Bulk Operations ====================
/**
 * v361: UPSERT模式 - 基于accountId+campaignId自然唯一键，避免重复插入
 */
