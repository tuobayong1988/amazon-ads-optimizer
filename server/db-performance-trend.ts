import { getDb } from "./db";
import { dailyPerformance, campaigns } from "../drizzle/schema";
import { eq, and, sql } from "drizzle-orm";

/**
 * 获取绩效组的每日聚合数据
 * 通过performanceGroupId查找所有关联的campaigns,然后聚合它们的dailyPerformance数据
 * 
 * v401: 优化WHERE条件 - 避免DATE()函数包裹以利用idx_daily_perf_campaign_date索引
 *       SELECT和GROUP BY中的DATE()保留（用于聚合和展示，不影响索引使用）
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
  
  // v401: WHERE条件使用范围查询替代DATE()包裹，允许MySQL使用索引
  // SELECT和GROUP BY中的DATE()保留用于聚合展示
  const result = await db.select({
    date: sql<string>`DATE(${dailyPerformance.date})`.as('date'),
    totalImpressions: sql<number>`COALESCE(SUM(${dailyPerformance.impressions}), 0)`.as('totalImpressions'),
    totalClicks: sql<number>`COALESCE(SUM(${dailyPerformance.clicks}), 0)`.as('totalClicks'),
    totalSpend: sql<string>`COALESCE(SUM(${dailyPerformance.spend}), '0')`.as('totalSpend'),
    totalSales: sql<string>`COALESCE(SUM(${dailyPerformance.sales}), '0')`.as('totalSales'),
    totalOrders: sql<number>`COALESCE(SUM(${dailyPerformance.orders}), 0)`.as('totalOrders'),
  })
    .from(dailyPerformance)
    .innerJoin(campaigns, eq(dailyPerformance.campaignId, campaigns.campaignId))
    .where(and(
      eq(campaigns.performanceGroupId, performanceGroupId),
      sql`${dailyPerformance.campaignId} IS NOT NULL`,
      sql`${dailyPerformance.date} >= ${startDateStr}`,
      sql`${dailyPerformance.date} < DATE_ADD(${endDateStr}, INTERVAL 1 DAY)`
    ))
    .groupBy(sql`DATE(${dailyPerformance.date})`)
    .orderBy(sql`DATE(${dailyPerformance.date})`);
  
  return result;
}
