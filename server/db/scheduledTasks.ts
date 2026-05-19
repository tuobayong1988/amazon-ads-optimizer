/**
 * v361: 定时任务管理
 * 从db.ts拆分的子模块
 */

import { desc, eq } from 'drizzle-orm';
import { getDb } from './connection';
import { scheduledTasks, taskExecutionLog } from '../../drizzle/schema';

// ==================== Scheduler Functions ====================

export async function getScheduledTasksByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];
  
  const result = await db.select()
    .from(scheduledTasks)
    .where(eq(scheduledTasks.userId, userId))
    .orderBy(scheduledTasks.createdAt);
  
  return result;
}

export async function getScheduledTaskById(id: number) {
  const db = await getDb();
  if (!db) return null;
  
  const result = await db.select()
    .from(scheduledTasks)
    .where(eq(scheduledTasks.id, id))
    .limit(1);
  
  return result[0] || null;
}

export async function createScheduledTask(data: {
  userId: number;
  accountId?: number;
  taskType: 'ngram_analysis' | 'funnel_migration' | 'traffic_conflict' | 'smart_bidding' | 'health_check' | 'data_sync' | 'traffic_isolation_full';
  name: string;
  description?: string;
  schedule?: 'hourly' | 'daily' | 'weekly' | 'monthly';
  runTime?: string;
  dayOfWeek?: number;
  dayOfMonth?: number;
  enabled?: boolean;
  autoApply?: boolean;
  requireApproval?: boolean;
  parameters?: Record<string, unknown>;
}) {
  const db = await getDb();
  if (!db) return 0;
  
  // @ts-ignore DB query type inference limitation
  const result = await db.insert(scheduledTasks).values({
    userId: data.userId,
    accountId: data.accountId || null,
    taskType: data.taskType,
    name: data.name,
    description: data.description || null,
    schedule: data.schedule ?? 'daily',
    runTime: data.runTime ?? '06:00',
    dayOfWeek: data.dayOfWeek || null,
    dayOfMonth: data.dayOfMonth || null,
    enabled: data.enabled ? 1 : 0,
    autoApply: data.autoApply ? 1 : 0,
    requireApproval: data.requireApproval !== false ? 1 : 0,
    parameters: data.parameters ? JSON.stringify(data.parameters) : null,
  });
  
  return result[0]?.insertId || 0;
}

export async function updateScheduledTask(id: number, data: {
  name?: string;
  description?: string;
  schedule?: 'hourly' | 'daily' | 'weekly' | 'monthly';
  runTime?: string;
  dayOfWeek?: number;
  dayOfMonth?: number;
  enabled?: boolean;
  autoApply?: boolean;
  requireApproval?: boolean;
  parameters?: Record<string, unknown>;
}) {
  const db = await getDb();
  if (!db) return;
  
  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (data.name !== undefined) updateData.name = data.name;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.schedule !== undefined) updateData.schedule = data.schedule;
  if (data.runTime !== undefined) updateData.runTime = data.runTime;
  if (data.dayOfWeek !== undefined) updateData.dayOfWeek = data.dayOfWeek;
  if (data.dayOfMonth !== undefined) updateData.dayOfMonth = data.dayOfMonth;
  if (data.enabled !== undefined) updateData.enabled = data.enabled;
  if (data.autoApply !== undefined) updateData.autoApply = data.autoApply;
  if (data.requireApproval !== undefined) updateData.requireApproval = data.requireApproval;
  if (data.parameters !== undefined) updateData.parameters = JSON.stringify(data.parameters);
  
  await db.update(scheduledTasks)
    .set(updateData)
    .where(eq(scheduledTasks.id, id));
}

export async function deleteScheduledTask(id: number) {
  const db = await getDb();
  if (!db) return;
  
  await db.delete(scheduledTasks).where(eq(scheduledTasks.id, id));
}

export async function recordTaskExecution(data: {
  taskId: number;
  userId: number;
  accountId?: number;
  taskType: string;
  status: 'running' | 'success' | 'failed' | 'cancelled';
  startedAt: Date | string;
  completedAt?: Date;
  duration?: number;
  itemsProcessed?: number;
  suggestionsGenerated?: number;
  suggestionsApplied?: number;
  errorMessage?: string;
  resultSummary?: Record<string, unknown>;
}) {
  const db = await getDb();
  if (!db) return;
  
  // @ts-ignore DB query type inference limitation
  await db.insert(taskExecutionLog).values({
    taskId: data.taskId,
    userId: data.userId,
    accountId: data.accountId || null,
    taskType: data.taskType,
    status: data.status,
    startedAt: typeof data.startedAt === 'string' ? data.startedAt : data.startedAt.toISOString(),
    completedAt: data.completedAt ? (typeof data.completedAt === 'string' ? data.completedAt : data.completedAt.toISOString()) : null,
    duration: data.duration || null,
    itemsProcessed: data.itemsProcessed ?? 0,
    suggestionsGenerated: data.suggestionsGenerated ?? 0,
    suggestionsApplied: data.suggestionsApplied ?? 0,
    errorMessage: data.errorMessage || null,
    resultSummary: data.resultSummary ? JSON.stringify(data.resultSummary) : null,
  });
  
  // Update last run time on the task
  // Map 'cancelled' to 'failed' for lastRunStatus since schema only supports success/failed/running/skipped
  const mappedStatus = data.status === 'cancelled' ? 'failed' : data.status;
  await db.update(scheduledTasks)
    .set({ 
      lastRunAt: typeof data.startedAt === 'string' ? data.startedAt : new Date(data.startedAt).toISOString(), 
      lastRunStatus: mappedStatus as 'success' | 'failed' | 'running' | 'skipped',
      updatedAt: new Date().toISOString() 
    })
    .where(eq(scheduledTasks.id, data.taskId));
}

export async function getTaskExecutionHistory(taskId: number, limit: number = 20) {
  const db = await getDb();
  if (!db) return [];
  
  const result = await db.select()
    .from(taskExecutionLog)
    .where(eq(taskExecutionLog.taskId, taskId))
    .orderBy(desc(taskExecutionLog.startedAt))
    .limit(limit);
  
  return result;
}


// ==================== Batch Operations Functions ====================

// Create a new batch operation
