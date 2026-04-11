// Extracted from production dist/index.js
// Original module: server/db/performance.ts
// Lines: 266

async function createDailyPerformance(perf) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(dailyPerformance).values(perf).onDuplicateKeyUpdate({
    set: {
      impressions: sql`VALUES(impressions)`,
      clicks: sql`VALUES(clicks)`,
      spend: sql`VALUES(spend)`,
      sales: sql`VALUES(sales)`,
      orders: sql`VALUES(orders)`
    }
  });
  return result[0].insertId;
}
async function getDailyPerformanceByDateRange(accountId, startDate, endDate, campaignId) {
  const db = await getDb();
  if (!db) return [];
  const startDateStr = startDate.toISOString().split("T")[0];
  const endDateStr = endDate.toISOString().split("T")[0];
  const conditions = [
    eq(dailyPerformance.accountId, accountId),
    sql`${dailyPerformance.date} >= ${startDateStr}`,
    sql`${dailyPerformance.date} <= ${endDateStr}`
  ];
  if (campaignId) {
    const campaignIdStr = guardCampaignIdParam(campaignId, "getDailyPerformanceByDateRange");
    conditions.push(eq(dailyPerformance.campaignId, campaignIdStr));
  }
  return db.select().from(dailyPerformance).where(and(...conditions)).orderBy(dailyPerformance.date);
}
async function getDailyPerformanceAggregatedByDate(accountId, startDate, endDate) {
  const db = await getDb();
  if (!db) return [];
  const startDateStr = startDate.toISOString().split("T")[0];
  const endDateStr = endDate.toISOString().split("T")[0];
  return db.select({
    date: sql`DATE(${dailyPerformance.date})`.as("date"),
    totalImpressions: sql`COALESCE(SUM(${dailyPerformance.impressions}), 0)`.as("totalImpressions"),
    totalClicks: sql`COALESCE(SUM(${dailyPerformance.clicks}), 0)`.as("totalClicks"),
    totalSpend: sql`COALESCE(SUM(${dailyPerformance.spend}), '0')`.as("totalSpend"),
    totalSales: sql`COALESCE(SUM(${dailyPerformance.sales}), '0')`.as("totalSales"),
    totalOrders: sql`COALESCE(SUM(${dailyPerformance.orders}), 0)`.as("totalOrders")
  }).from(dailyPerformance).where(and(
    eq(dailyPerformance.accountId, accountId),
    // ✅ 只汇总campaign级别的记录
    sql`${dailyPerformance.campaignId} IS NOT NULL`,
    sql`DATE(${dailyPerformance.date}) >= ${startDateStr}`,
    sql`DATE(${dailyPerformance.date}) <= ${endDateStr}`
  )).groupBy(sql`DATE(${dailyPerformance.date})`).orderBy(sql`DATE(${dailyPerformance.date})`);
}
async function getPerformanceSummary(accountId, startDate, endDate) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select({
    totalImpressions: sql`COALESCE(SUM(impressions), 0)`,
    totalClicks: sql`COALESCE(SUM(clicks), 0)`,
    totalSpend: sql`COALESCE(SUM(spend), '0')`,
    totalSales: sql`COALESCE(SUM(sales), '0')`,
    totalOrders: sql`COALESCE(SUM(orders), 0)`,
    totalConversions: sql`COALESCE(SUM(conversions), 0)`
  }).from(dailyPerformance).where(and(
    eq(dailyPerformance.accountId, accountId),
    // ✅ 只汇总campaign级别的记录，排除账户级汇总记录（campaignId IS NULL）
    sql`${dailyPerformance.campaignId} IS NOT NULL`,
    sql`DATE(${dailyPerformance.date}) >= ${startDate.toISOString().split("T")[0]}`,
    sql`DATE(${dailyPerformance.date}) <= ${endDate.toISOString().split("T")[0]}`
  ));
  return result[0];
}
async function getDailyPerformanceByAccountAndDate(accountId, date6, campaignId) {
  const db = await getDb();
  if (!db) return null;
  const conditions = [
    eq(dailyPerformance.accountId, accountId),
    sql`DATE(${dailyPerformance.date}) = ${date6}`
  ];
  if (campaignId !== void 0 && campaignId !== null) {
    conditions.push(eq(dailyPerformance.campaignId, String(campaignId)));
  } else {
    conditions.push(sql`${dailyPerformance.campaignId} IS NULL`);
  }
  const result = await db.select().from(dailyPerformance).where(and(...conditions)).limit(1);
  return result[0] || null;
}
async function upsertDailyPerformanceFromAms(data) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (data.idempotencyId) {
    try {
      const result = await db.execute(sql`
        INSERT IGNORE INTO ams_processed_messages (idempotency_id, dataset_id)
        VALUES (${data.idempotencyId}, ${data.datasetId || null})
      `);
      if (result[0]?.affectedRows === 0) {
        log12.debug(`[AMS DB] \u8DF3\u8FC7\u91CD\u590D\u6D88\u606F: idempotencyId=${data.idempotencyId}`);
        return;
      }
    } catch (e) {
      log12.warn(`[AMS DB] idempotency\u53BB\u91CD\u68C0\u67E5\u5931\u8D25: ${e.message}`);
    }
  }
  const deltaImpressions = data.impressions;
  const deltaClicks = data.clicks;
  const deltaCost = data.cost;
  if (data.campaignId) {
    const safeCampaignId = guardCampaignIdInsert(data.campaignId, "daily_performance");
    const existingCampaign = await getDailyPerformanceByAccountAndDate(
      data.accountId,
      data.date,
      safeCampaignId
    );
    if (existingCampaign?.isFinalized) {
      log12.info(`[AMS DB] \u8DF3\u8FC7\u5DF2\u6821\u51C6campaign\u6570\u636E: ${data.date} campaignId=${data.campaignId}`);
    } else if (existingCampaign) {
      const newImpressions = Math.max(0, (existingCampaign.impressions || 0) + deltaImpressions);
      const newClicks = Math.max(0, (existingCampaign.clicks || 0) + deltaClicks);
      const newSpend = Math.max(0, parseFloat(String(existingCampaign.spend || "0")) + deltaCost);
      await db.update(dailyPerformance).set({
        impressions: newImpressions,
        clicks: newClicks,
        spend: String(newSpend.toFixed(2)),
        dataSource: "ams"
      }).where(eq(dailyPerformance.id, existingCampaign.id));
    } else {
      await db.insert(dailyPerformance).values({
        accountId: data.accountId,
        campaignId: safeCampaignId,
        date: data.date,
        impressions: Math.max(0, deltaImpressions),
        clicks: Math.max(0, deltaClicks),
        spend: String(Math.max(0, deltaCost).toFixed(2)),
        sales: "0",
        orders: 0,
        conversions: 0,
        dataSource: "ams",
        isFinalized: 0
      });
    }
  }
}
async function updateDailyPerformanceConversion(data) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (data.idempotencyId) {
    try {
      const result = await db.execute(sql`
 INSERT IGNORE INTO ams_processed_messages (idempotency_id, dataset_id)
 VALUES (${data.idempotencyId}, ${data.datasetId || null})
 `);
      if (result[0]?.affectedRows === 0) {
        log12.debug(`[AMS DB] \u8DF3\u8FC7\u91CD\u590D\u8F6C\u5316\u6D88\u606F: idempotencyId=${data.idempotencyId}`);
        return;
      }
    } catch (e) {
      log12.warn(`[AMS DB] \u8F6C\u5316idempotency\u53BB\u91CD\u68C0\u67E5\u5931\u8D25: ${e.message}`);
    }
  }
  const deltaSales = data.sales;
  const deltaOrders = data.orders;
  if (data.campaignId) {
    const safeCampaignId = guardCampaignIdInsert(data.campaignId, "daily_performance");
    const existingCampaign = await getDailyPerformanceByAccountAndDate(
      data.accountId,
      data.date,
      safeCampaignId
    );
    if (existingCampaign && !existingCampaign.isFinalized) {
      const newSales = Math.max(0, parseFloat(String(existingCampaign.sales || "0")) + deltaSales);
      const newOrders = Math.max(0, (existingCampaign.orders || 0) + deltaOrders);
      await db.update(dailyPerformance).set({
        sales: String(newSales.toFixed(2)),
        orders: newOrders,
        dataSource: "ams"
      }).where(eq(dailyPerformance.id, existingCampaign.id));
    }
  }
  const existing = await getDailyPerformanceByAccountAndDate(
    data.accountId,
    data.date,
    null
  );
  if (existing?.isFinalized) {
    log12.info(`[AMS DB] \u8DF3\u8FC7\u5DF2\u6821\u51C6\u8F6C\u5316\u6570\u636E: ${data.date} accountId=${data.accountId}`);
    return;
  }
  if (existing) {
    const newSales = Math.max(0, parseFloat(String(existing.sales || "0")) + deltaSales);
    const newOrders = Math.max(0, (existing.orders || 0) + deltaOrders);
    await db.update(dailyPerformance).set({
      sales: String(newSales.toFixed(2)),
      orders: newOrders,
      dataSource: "ams"
    }).where(eq(dailyPerformance.id, existing.id));
  }
}
async function markDailyPerformanceAsFinalized(accountId, date6) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(dailyPerformance).set({
    isFinalized: 1,
    dataSource: "api"
  }).where(and(
    eq(dailyPerformance.accountId, accountId),
    sql`DATE(${dailyPerformance.date}) = ${date6}`
  ));
}
async function deleteDailyPerformanceByDateRange(accountId, startDate, endDate) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.delete(dailyPerformance).where(and(
    eq(dailyPerformance.accountId, accountId),
    sql`DATE(${dailyPerformance.date}) >= ${startDate}`,
    sql`DATE(${dailyPerformance.date}) <= ${endDate}`
  ));
  return result[0]?.affectedRows || 0;
}
async function upsertMarketCurveData(data) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(marketCurveData).values(data).onDuplicateKeyUpdate({
    set: {
      estimatedImpressions: data.estimatedImpressions,
      estimatedClicks: data.estimatedClicks,
      estimatedConversions: data.estimatedConversions,
      estimatedSpend: data.estimatedSpend,
      estimatedSales: data.estimatedSales,
      curveMarginalRevenue: data.curveMarginalRevenue,
      curveMarginalCost: data.curveMarginalCost,
      marginalProfit: data.marginalProfit,
      curveTrafficCeiling: data.curveTrafficCeiling,
      optimalBidPoint: data.optimalBidPoint
    }
  });
}
async function getMarketCurveData(targetType, targetId) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(marketCurveData).where(and(
    eq(marketCurveData.curveTargetType, targetType),
    eq(marketCurveData.curveTargetId, targetId)
  )).orderBy(marketCurveData.bidLevel);
}
var log12;
var init_performance = __esm({
  "server/db/performance.ts"() {
    "use strict";
    init_drizzle_orm();
    init_schema2();
    init_connection();
    init_idTypes();
    init_logger();
    log12 = createModuleLogger("DB:performance");
    __name(createDailyPerformance, "createDailyPerformance");
    __name(getDailyPerformanceByDateRange, "getDailyPerformanceByDateRange");
    __name(getDailyPerformanceAggregatedByDate, "getDailyPerformanceAggregatedByDate");
    __name(getPerformanceSummary, "getPerformanceSummary");
    __name(getDailyPerformanceByAccountAndDate, "getDailyPerformanceByAccountAndDate");
    __name(upsertDailyPerformanceFromAms, "upsertDailyPerformanceFromAms");
    __name(updateDailyPerformanceConversion, "updateDailyPerformanceConversion");
    __name(markDailyPerformanceAsFinalized, "markDailyPerformanceAsFinalized");
    __name(deleteDailyPerformanceByDateRange, "deleteDailyPerformanceByDateRange");
    __name(upsertMarketCurveData, "upsertMarketCurveData");
    __name(getMarketCurveData, "getMarketCurveData");
  }
});

