import { getDb } from "./db";
import { dailyPerformance, campaigns } from "../drizzle/schema";
import { eq, and, sql } from "drizzle-orm";

/**
 * 获取绩效组的每日聚合数据
 * 通过performanceGroupId查找所有关联的campaigns,然后聚合它们的dailyPerformance数据
 */
export async function getDailyPerformanceByPerformanceGroup(
  performanceGroupId: number,
  startDate: Date,
  endDate: Date
) {
  const db = await getDb();
  if (!db) return [];
  
  const startDateStr = startDate.toISOString().split('T')[0];
  const endDateStr = endDate.toISOString().split('T')[0];
  
  // 查询逻辑:
  // 1. 从dailyPerformance表获取数据
  // 2. JOIN campaigns表来过滤performanceGroupId
  // 3. 按日期GROUP BY聚合
  const result = await db.select({
    date: sql<string>`DATE(${dailyPerformance.date})`.as('date'),
    totalImpressions: sql<number>`COALESCE(SUM(${dailyPerformance.impressions}), 0)`.as('totalImpressions'),
    totalClicks: sql<number>`COALESCE(SUM(${dailyPerformance.clicks}), 0)`.as('totalClicks'),
    totalSpend: sql<string>`COALESCE(SUM(${dailyPerformance.spend}), '0')`.as('totalSpend'),
    totalSales: sql<string>`COALESCE(SUM(${dailyPerformance.sales}), '0')`.as('totalSales'),
    totalOrders: sql<number>`COALESCE(SUM(${dailyPerformance.orders}), 0)`.as('totalOrders'),
  })
    .from(dailyPerformance)
    .innerJoin(campaigns, sql`${dailyPerformance.campaignId} = CAST(${campaigns.id} AS CHAR)`)
    .where(and(
      eq(campaigns.performanceGroupId, performanceGroupId),
      sql`${dailyPerformance.campaignId} IS NOT NULL`,
      sql`DATE(${dailyPerformance.date}) >= ${startDateStr}`,
      sql`DATE(${dailyPerformance.date}) <= ${endDateStr}`
    ))
    .groupBy(sql`DATE(${dailyPerformance.date})`)
    .orderBy(sql`DATE(${dailyPerformance.date})`);
  
  return result;
}
