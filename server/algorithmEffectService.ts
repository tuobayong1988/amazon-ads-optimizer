/**
 * 算法效果追踪服务
 * 记录和分析优化算法的实际效果
 */

import { getDb } from './db';
import { algorithmEffectRecords, type InsertAlgorithmEffectRecord } from '../drizzle/schema';
import { eq, and, gte, lte, desc, sql } from 'drizzle-orm';
import type { EnhancedOptimizationResult } from './bidOptimizer';

/**
 * 创建算法效果追踪记录
 */
export async function createEffectRecord(
  userId: number,
  accountId: number,
  result: EnhancedOptimizationResult,
  currentROAS: number,
  currentACoS: number
): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error('Database connection failed');
  const record: InsertAlgorithmEffectRecord = {
    userId,
    accountId,
    targetId: result.targetId,
    targetType: result.targetType,
    algorithmUsed: result.algorithmUsed,
    previousBid: result.previousBid.toString(),
    newBid: result.newBid.toString(),
    bidChangePercent: result.bidChangePercent.toString(),
    previousROAS: currentROAS.toString(),
    previousACoS: currentACoS.toString(),
    optimizationDate: new Date().toISOString().slice(0, 19).replace('T', ' '),
    confidenceScore: result.confidenceScore.toString(),
    holidayName: result.holidayConfig?.name || null,
    reason: result.reason
  };

  const [insertResult] = await db.insert(algorithmEffectRecords).values(record);
  return insertResult.insertId;
}

/**
 * 批量创建算法效果追踪记录
 */
export async function createEffectRecordsBatch(
  userId: number,
  accountId: number,
  results: EnhancedOptimizationResult[],
  metricsMap: Map<number, { roas: number; acos: number }>
): Promise<number[]> {
  if (results.length === 0) return [];

  const db = await getDb();
  if (!db) throw new Error('Database connection failed');
  const records: InsertAlgorithmEffectRecord[] = results.map(result => {
    const metrics = metricsMap.get(result.targetId) || { roas: 0, acos: 0 };
    return {
      userId,
      accountId,
      targetId: result.targetId,
      targetType: result.targetType,
      algorithmUsed: result.algorithmUsed,
      previousBid: result.previousBid.toString(),
      newBid: result.newBid.toString(),
      bidChangePercent: result.bidChangePercent.toString(),
      previousROAS: metrics.roas.toString(),
      previousACoS: metrics.acos.toString(),
      optimizationDate: new Date().toISOString().slice(0, 19).replace('T', ' '),
      confidenceScore: result.confidenceScore.toString(),
      holidayName: result.holidayConfig?.name || null,
      reason: result.reason
    };
  });

  const insertResult = await db.insert(algorithmEffectRecords).values(records);
  // 返回插入的ID范围
  const startId = insertResult[0].insertId;
  return records.map((_, index) => startId + index);
}

/**
 * 更新算法效果（优化后7天调用）
 */
export async function updateEffectMetrics(
  recordId: number,
  postROAS: number,
  postACoS: number
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error('Database connection failed');
  const [record] = await db
    .select()
    .from(algorithmEffectRecords)
    .where(eq(algorithmEffectRecords.id, recordId))
    .limit(1);

  if (!record) return;

  const previousROAS = parseFloat(record.previousROAS || '0');
  const previousACoS = parseFloat(record.previousACoS || '0');
  
  const roasChange = postROAS - previousROAS;
  const acosChange = previousACoS - postACoS; // ACoS降低为正向

  // 计算效果分数
  const roasScore = previousROAS > 0 
    ? (roasChange > 0 ? Math.min(1, roasChange / previousROAS) : Math.max(-1, roasChange / previousROAS))
    : 0;
  const acosScore = previousACoS > 0 
    ? (acosChange > 0 ? Math.min(1, acosChange / previousACoS) : Math.max(-1, acosChange / previousACoS))
    : 0;
  const effectScore = roasScore * 0.6 + acosScore * 0.4;

  await db
    .update(algorithmEffectRecords)
    .set({
      postROAS: postROAS.toFixed(2),
      postACoS: postACoS.toFixed(2),
      roasChange: roasChange.toFixed(2),
      acosChange: acosChange.toFixed(2),
      effectScore: effectScore.toFixed(2),
      effectCalculatedAt: new Date().toISOString().slice(0, 19).replace('T', ' ')
    })
    .where(eq(algorithmEffectRecords.id, recordId));
}

/**
 * 获取算法效果统计
 */
export async function getAlgorithmEffectStats(
  userId: number,
  accountId?: number,
  startDate?: Date,
  endDate?: Date
): Promise<{
  algorithm: string;
  count: number;
  avgROASChange: number;
  avgACoSChange: number;
  avgEffectScore: number;
  positiveRate: number;
}[]> {
  const db = await getDb();
  if (!db) throw new Error('Database connection failed');
  const results = await db
    .select({
      algorithm: algorithmEffectRecords.algorithmUsed,
      count: sql<number>`COUNT(*)`,
      avgROASChange: sql<number>`AVG(CAST(${algorithmEffectRecords.roasChange} AS DECIMAL(10,2)))`,
      avgACoSChange: sql<number>`AVG(CAST(${algorithmEffectRecords.acosChange} AS DECIMAL(10,2)))`,
      avgEffectScore: sql<number>`AVG(CAST(${algorithmEffectRecords.effectScore} AS DECIMAL(10,2)))`,
      positiveCount: sql<number>`SUM(CASE WHEN CAST(${algorithmEffectRecords.effectScore} AS DECIMAL(10,2)) > 0 THEN 1 ELSE 0 END)`
    })
    .from(algorithmEffectRecords)
    .where(
      and(
        eq(algorithmEffectRecords.userId, userId),
        accountId ? eq(algorithmEffectRecords.accountId, accountId) : undefined,
        startDate ? gte(algorithmEffectRecords.optimizationDate, startDate.toISOString().slice(0, 19).replace('T', ' ')) : undefined,
        endDate ? lte(algorithmEffectRecords.optimizationDate, endDate.toISOString().slice(0, 19).replace('T', ' ')) : undefined,
        sql`${algorithmEffectRecords.effectScore} IS NOT NULL`
      )
    )
    .groupBy(algorithmEffectRecords.algorithmUsed);

  return results.map((row: any) => ({
    algorithm: row.algorithm,
    count: Number(row.count),
    avgROASChange: Number(row.avgROASChange) || 0,
    avgACoSChange: Number(row.avgACoSChange) || 0,
    avgEffectScore: Number(row.avgEffectScore) || 0,
    positiveRate: row.count > 0 ? Math.round((Number(row.positiveCount) / Number(row.count)) * 100) : 0
  }));
}

/**
 * 获取最近的效果追踪记录
 */
export async function getRecentEffectRecords(
  userId: number,
  accountId?: number,
  limit: number = 50
): Promise<typeof algorithmEffectRecords.$inferSelect[]> {
  const db = await getDb();
  if (!db) throw new Error('Database connection failed');
  return db
    .select()
    .from(algorithmEffectRecords)
    .where(
      and(
        eq(algorithmEffectRecords.userId, userId),
        accountId ? eq(algorithmEffectRecords.accountId, accountId) : undefined
      )
    )
    .orderBy(desc(algorithmEffectRecords.optimizationDate))
    .limit(limit);
}

/**
 * 获取待更新效果的记录（优化后7天且未计算效果的记录）
 */
export async function getPendingEffectRecords(
  userId: number
): Promise<typeof algorithmEffectRecords.$inferSelect[]> {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const db = await getDb();
  if (!db) throw new Error('Database connection failed');
  return db
    .select()
    .from(algorithmEffectRecords)
    .where(
      and(
        eq(algorithmEffectRecords.userId, userId),
        sql`${algorithmEffectRecords.effectScore} IS NULL`,
        lte(algorithmEffectRecords.optimizationDate, sevenDaysAgo.toISOString().slice(0, 19).replace('T', ' '))
      )
    )
    .orderBy(algorithmEffectRecords.optimizationDate)
    .limit(100);
}

/**
 * 获取算法效果趋势（按日期分组）
 */
export async function getEffectTrend(
  userId: number,
  accountId?: number,
  days: number = 30
): Promise<{
  date: string;
  avgEffectScore: number;
  avgROASChange: number;
  avgACoSChange: number;
  count: number;
}[]> {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const db = await getDb();
  if (!db) throw new Error('Database connection failed');
  const results = await db
    .select({
      date: sql<string>`DATE(${algorithmEffectRecords.optimizationDate})`,
      avgEffectScore: sql<number>`AVG(CAST(${algorithmEffectRecords.effectScore} AS DECIMAL(10,2)))`,
      avgROASChange: sql<number>`AVG(CAST(${algorithmEffectRecords.roasChange} AS DECIMAL(10,2)))`,
      avgACoSChange: sql<number>`AVG(CAST(${algorithmEffectRecords.acosChange} AS DECIMAL(10,2)))`,
      count: sql<number>`COUNT(*)`
    })
    .from(algorithmEffectRecords)
    .where(
      and(
        eq(algorithmEffectRecords.userId, userId),
        accountId ? eq(algorithmEffectRecords.accountId, accountId) : undefined,
        gte(algorithmEffectRecords.optimizationDate, startDate.toISOString().slice(0, 19).replace('T', ' ')),
        sql`${algorithmEffectRecords.effectScore} IS NOT NULL`
      )
    )
    .groupBy(sql`DATE(${algorithmEffectRecords.optimizationDate})`)
    .orderBy(sql`DATE(${algorithmEffectRecords.optimizationDate})`);

  return results.map((row: any) => ({
    date: String(row.date),
    avgEffectScore: Number(row.avgEffectScore) || 0,
    avgROASChange: Number(row.avgROASChange) || 0,
    avgACoSChange: Number(row.avgACoSChange) || 0,
    count: Number(row.count)
  }));
}
