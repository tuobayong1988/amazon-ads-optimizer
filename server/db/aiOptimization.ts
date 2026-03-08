/**
 * v361: AI优化执行管理
 * 从db.ts拆分的子模块
 */

import { and, desc, eq, lte, not } from 'drizzle-orm';
import { AiOptimizationAction, AiOptimizationExecution, AiOptimizationPrediction, AiOptimizationReview, InsertAiOptimizationAction, InsertAiOptimizationExecution, InsertAiOptimizationPrediction, InsertAiOptimizationReview, aiOptimizationActions, aiOptimizationExecutions, aiOptimizationPredictions, aiOptimizationReviews } from '../../drizzle/schema';
import { getDb } from './connection';

// ==================== AI Optimization Execution Functions ====================

// 创建AI优化执行记录
export async function createAiOptimizationExecution(data: InsertAiOptimizationExecution): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(aiOptimizationExecutions).values(data);
  return result[0].insertId;
}

// 获取AI优化执行记录

// 获取AI优化执行记录
export async function getAiOptimizationExecution(id: number): Promise<AiOptimizationExecution | null> {
  const db = await getDb();
  if (!db) return null;
  
  const results = await db.select().from(aiOptimizationExecutions).where(eq(aiOptimizationExecutions.id, id));
  return results[0] || null;
}

// 获取广告活动的AI优化执行历史

// 获取广告活动的AI优化执行历史
export async function getAiOptimizationExecutionsByCampaign(campaignId: number, limit: number = 50): Promise<AiOptimizationExecution[]> {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(aiOptimizationExecutions)
    .where(eq(aiOptimizationExecutions.campaignId, String(campaignId)))
    .orderBy(desc(aiOptimizationExecutions.executedAt))
    .limit(limit);
}

// 获取账号的AI优化执行历史

// 获取账号的AI优化执行历史
export async function getAiOptimizationExecutionsByAccount(accountId: number, limit: number = 100): Promise<AiOptimizationExecution[]> {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(aiOptimizationExecutions)
    .where(eq(aiOptimizationExecutions.accountId, accountId))
    .orderBy(desc(aiOptimizationExecutions.executedAt))
    .limit(limit);
}

// 更新AI优化执行状态

// 更新AI优化执行状态
export async function updateAiOptimizationExecution(id: number, data: Partial<InsertAiOptimizationExecution>): Promise<void> {
  const db = await getDb();
  if (!db) return;
  
  await db.update(aiOptimizationExecutions).set(data).where(eq(aiOptimizationExecutions.id, id));
}

// 创建AI优化操作记录

// 创建AI优化操作记录
export async function createAiOptimizationAction(data: InsertAiOptimizationAction): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(aiOptimizationActions).values(data);
  return result[0].insertId;
}

// 批量创建AI优化操作记录

// 批量创建AI优化操作记录
export async function createAiOptimizationActions(dataList: InsertAiOptimizationAction[]): Promise<void> {
  const db = await getDb();
  if (!db) return;
  
  if (dataList.length > 0) {
    await db.insert(aiOptimizationActions).values(dataList);
  }
}

// 获取执行的所有操作

// 获取执行的所有操作
export async function getAiOptimizationActionsByExecution(executionId: number): Promise<AiOptimizationAction[]> {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(aiOptimizationActions)
    .where(eq(aiOptimizationActions.executionId, executionId))
    .orderBy(aiOptimizationActions.id);
}

// 更新AI优化操作状态

// 更新AI优化操作状态
export async function updateAiOptimizationAction(id: number, data: Partial<InsertAiOptimizationAction>): Promise<void> {
  const db = await getDb();
  if (!db) return;
  
  await db.update(aiOptimizationActions).set(data).where(eq(aiOptimizationActions.id, id));
}

// 创建AI优化效果预测

// 创建AI优化效果预测
export async function createAiOptimizationPrediction(data: InsertAiOptimizationPrediction): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(aiOptimizationPredictions).values(data);
  return result[0].insertId;
}

// 批量创建AI优化效果预测

// 批量创建AI优化效果预测
export async function createAiOptimizationPredictions(dataList: InsertAiOptimizationPrediction[]): Promise<void> {
  const db = await getDb();
  if (!db) return;
  
  if (dataList.length > 0) {
    await db.insert(aiOptimizationPredictions).values(dataList);
  }
}

// 获取执行的所有预测

// 获取执行的所有预测
export async function getAiOptimizationPredictionsByExecution(executionId: number): Promise<AiOptimizationPrediction[]> {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(aiOptimizationPredictions)
    .where(eq(aiOptimizationPredictions.executionId, executionId));
}

// 创建AI优化复盘记录

// 创建AI优化复盘记录
export async function createAiOptimizationReview(data: InsertAiOptimizationReview): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(aiOptimizationReviews).values(data);
  return result[0].insertId;
}

// 获取执行的所有复盘记录

// 获取执行的所有复盘记录
export async function getAiOptimizationReviewsByExecution(executionId: number): Promise<AiOptimizationReview[]> {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(aiOptimizationReviews)
    .where(eq(aiOptimizationReviews.executionId, executionId));
}

// 获取待复盘的记录

// 获取待复盘的记录
export async function getPendingAiOptimizationReviews(): Promise<AiOptimizationReview[]> {
  const db = await getDb();
  if (!db) return [];
  
  const now = new Date();
  return db.select().from(aiOptimizationReviews)
    .where(and(
      eq(aiOptimizationReviews.reviewStatus, "pending"),
      lte(aiOptimizationReviews.scheduledAt, now.toISOString())
    ))
    .orderBy(aiOptimizationReviews.scheduledAt);
}

// 更新AI优化复盘记录

// 更新AI优化复盘记录
export async function updateAiOptimizationReview(id: number, data: Partial<InsertAiOptimizationReview>): Promise<void> {
  const db = await getDb();
  if (!db) return;
  
  await db.update(aiOptimizationReviews).set(data).where(eq(aiOptimizationReviews.id, id));
}

// 获取AI优化执行详情（包含操作、预测、复盘）

// 获取AI优化执行详情（包含操作、预测、复盘）
export async function getAiOptimizationExecutionDetail(executionId: number) {
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


// ==================== 历史趋势数据查询 ====================
// 获取关键词历史数据
// 注意：当前 dailyPerformance 表没有 targetType 和 targetId 字段
// 返回空数组，让前端使用模拟数据
