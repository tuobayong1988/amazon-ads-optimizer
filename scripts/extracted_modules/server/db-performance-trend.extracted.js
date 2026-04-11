// Extracted from production dist/index.js
// Original module: server/db-performance-trend.ts
// Lines: 34

var db_performance_trend_exports = {};
__export(db_performance_trend_exports, {
  getDailyPerformanceByPerformanceGroup: () => getDailyPerformanceByPerformanceGroup
});
async function getDailyPerformanceByPerformanceGroup(performanceGroupId2, startDate, endDate) {
  const db = await getDb();
  if (!db) return [];
  const startDateStr = startDate.toISOString().split("T")[0];
  const endDateStr = endDate.toISOString().split("T")[0];
  const result = await db.select({
    date: sql`DATE(${dailyPerformance.date})`.as("date"),
    totalImpressions: sql`COALESCE(SUM(${dailyPerformance.impressions}), 0)`.as("totalImpressions"),
    totalClicks: sql`COALESCE(SUM(${dailyPerformance.clicks}), 0)`.as("totalClicks"),
    totalSpend: sql`COALESCE(SUM(${dailyPerformance.spend}), '0')`.as("totalSpend"),
    totalSales: sql`COALESCE(SUM(${dailyPerformance.sales}), '0')`.as("totalSales"),
    totalOrders: sql`COALESCE(SUM(${dailyPerformance.orders}), 0)`.as("totalOrders")
  }).from(dailyPerformance).innerJoin(campaigns, eq(dailyPerformance.campaignId, campaigns.campaignId)).where(and(
    eq(campaigns.performanceGroupId, performanceGroupId2),
    sql`${dailyPerformance.campaignId} IS NOT NULL`,
    sql`${dailyPerformance.date} >= ${startDateStr}`,
    sql`${dailyPerformance.date} < DATE_ADD(${endDateStr}, INTERVAL 1 DAY)`
  )).groupBy(sql`DATE(${dailyPerformance.date})`).orderBy(sql`DATE(${dailyPerformance.date})`);
  return result;
}
var init_db_performance_trend = __esm({
  "server/db-performance-trend.ts"() {
    "use strict";
    init_db2();
    init_schema2();
    init_drizzle_orm();
    __name(getDailyPerformanceByPerformanceGroup, "getDailyPerformanceByPerformanceGroup");
  }
});

