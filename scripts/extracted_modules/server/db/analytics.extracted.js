// Extracted from production dist/index.js
// Original module: server/db/analytics.ts
// Lines: 294

function extractRows(rawResult) {
  if (!rawResult) return [];
  if (Array.isArray(rawResult)) {
    if (rawResult.length > 0 && Array.isArray(rawResult[0])) {
      return rawResult[0];
    }
    return rawResult;
  }
  return [];
}
function extractFirstRow(rawResult) {
  const rows = extractRows(rawResult);
  return rows.length > 0 ? rows[0] : null;
}
async function getLocalDataStats(accountId) {
  const db = await getDb();
  if (!db) {
    return { spCampaigns: 0, sbCampaigns: 0, sdCampaigns: 0, adGroups: 0, keywords: 0, productTargets: 0 };
  }
  try {
    const [campaignStats] = await db.select({
      spCampaigns: sql`SUM(CASE WHEN ${campaigns.campaignType} IN ('sp_auto', 'sp_manual') THEN 1 ELSE 0 END)`,
      sbCampaigns: sql`SUM(CASE WHEN ${campaigns.campaignType} = 'sb' THEN 1 ELSE 0 END)`,
      sdCampaigns: sql`SUM(CASE WHEN ${campaigns.campaignType} = 'sd' THEN 1 ELSE 0 END)`
    }).from(campaigns).where(eq(campaigns.accountId, accountId));
    const subStatsResult = await db.execute(sql`
      SELECT 
        (SELECT COUNT(*) FROM ad_groups ag 
         INNER JOIN campaigns c ON ag.campaignId = c.campaignId 
         WHERE c.accountId = ${accountId}) as adGroupCount,
        (SELECT COUNT(*) FROM keywords k 
         INNER JOIN ad_groups ag ON k.internalAdGroupId = ag.id 
         INNER JOIN campaigns c ON ag.campaignId = c.campaignId 
         WHERE c.accountId = ${accountId}) as keywordCount,
        (SELECT COUNT(*) FROM product_targets pt 
         INNER JOIN ad_groups ag ON pt.internalAdGroupId = ag.id 
         INNER JOIN campaigns c ON ag.campaignId = c.campaignId 
         WHERE c.accountId = ${accountId}) as productTargetCount
    `);
    const subStats = extractFirstRow(subStatsResult);
    return {
      spCampaigns: Number(campaignStats?.spCampaigns || 0),
      sbCampaigns: Number(campaignStats?.sbCampaigns || 0),
      sdCampaigns: Number(campaignStats?.sdCampaigns || 0),
      adGroups: Number(subStats?.adGroupCount || 0),
      keywords: Number(subStats?.keywordCount || 0),
      productTargets: Number(subStats?.productTargetCount || 0)
    };
  } catch (error48) {
    log16.warn("[getLocalDataStats] Error:", error48);
    return { spCampaigns: 0, sbCampaigns: 0, sdCampaigns: 0, adGroups: 0, keywords: 0, productTargets: 0 };
  }
}
async function getAccountPerformanceSummary(accountId, startDate, endDate) {
  const db = await getDb();
  if (!db) return null;
  try {
    if (startDate && endDate) {
      const startDateStr = startDate.toISOString().split("T")[0];
      const endDateStr = endDate.toISOString().split("T")[0];
      const [result2] = await db.select({
        totalSpend: sql`COALESCE(SUM(CASE WHEN spend_usd > 0 THEN spend_usd ELSE ${dailyPerformance.spend} END), 0)`,
        totalSales: sql`COALESCE(SUM(CASE WHEN sales_usd > 0 THEN sales_usd ELSE ${dailyPerformance.sales} END), 0)`,
        totalOrders: sql`COALESCE(SUM(${dailyPerformance.orders}), 0)`,
        totalImpressions: sql`COALESCE(SUM(${dailyPerformance.impressions}), 0)`,
        totalClicks: sql`COALESCE(SUM(${dailyPerformance.clicks}), 0)`
      }).from(dailyPerformance).where(and(
        eq(dailyPerformance.accountId, accountId),
        // ✅ v500: 只汇总campaign级别的记录，排除account-level汇总记录（campaignId IS NULL），避免双重计算
        sql`${dailyPerformance.campaignId} IS NOT NULL`,
        sql`${dailyPerformance.date} >= ${startDateStr}`,
        sql`${dailyPerformance.date} < DATE_ADD(${endDateStr}, INTERVAL 1 DAY)`
      ));
      return {
        totalSpend: Number(result2?.totalSpend || 0),
        totalSales: Number(result2?.totalSales || 0),
        totalOrders: Number(result2?.totalOrders || 0),
        totalImpressions: Number(result2?.totalImpressions || 0),
        totalClicks: Number(result2?.totalClicks || 0)
      };
    }
    const [result] = await db.select({
      totalSpend: sql`COALESCE(SUM(CASE WHEN spend_usd > 0 THEN spend_usd ELSE ${dailyPerformance.spend} END), 0)`,
      totalSales: sql`COALESCE(SUM(CASE WHEN sales_usd > 0 THEN sales_usd ELSE ${dailyPerformance.sales} END), 0)`,
      totalOrders: sql`COALESCE(SUM(${dailyPerformance.orders}), 0)`,
      totalImpressions: sql`COALESCE(SUM(${dailyPerformance.impressions}), 0)`,
      totalClicks: sql`COALESCE(SUM(${dailyPerformance.clicks}), 0)`
    }).from(dailyPerformance).where(and(
      eq(dailyPerformance.accountId, accountId),
      sql`${dailyPerformance.campaignId} IS NOT NULL`
    ));
    return {
      totalSpend: Number(result?.totalSpend || 0),
      totalSales: Number(result?.totalSales || 0),
      totalOrders: Number(result?.totalOrders || 0),
      totalImpressions: Number(result?.totalImpressions || 0),
      totalClicks: Number(result?.totalClicks || 0)
    };
  } catch (error48) {
    log16.warn("[getAccountPerformanceSummary] Error:", error48);
    return null;
  }
}
async function getDailyTrendData(accountIds, days, timeRange, customStartDate, customEndDate) {
  const db = await getDb();
  if (!db) return [];
  try {
    let startDateStr;
    let endDateStr;
    if (customStartDate && customEndDate) {
      startDateStr = customStartDate;
      endDateStr = customEndDate;
    } else {
      let endDate = /* @__PURE__ */ new Date();
      let startDate = /* @__PURE__ */ new Date();
      if (timeRange === "yesterday") {
        endDate.setDate(endDate.getDate() - 1);
        startDate = new Date(endDate);
      } else if (timeRange === "today") {
      } else {
        startDate.setDate(startDate.getDate() - days);
      }
      startDateStr = startDate.toISOString().split("T")[0];
      endDateStr = endDate.toISOString().split("T")[0];
    }
    const results = await db.execute(sql`
      SELECT 
        date as report_date,
        COALESCE(SUM(CASE WHEN spend_usd > 0 THEN spend_usd ELSE spend END), 0) as spend,
        COALESCE(SUM(CASE WHEN sales_usd > 0 THEN sales_usd ELSE sales END), 0) as sales,
        COALESCE(SUM(orders), 0) as orders
      FROM daily_performance
      WHERE accountId IN (${safeInClause(accountIds)})
        AND campaignId IS NOT NULL
        AND date >= ${startDateStr}
        AND date < DATE_ADD(${endDateStr}, INTERVAL 1 DAY)
      GROUP BY date
      ORDER BY date
    `);
    const rows = extractRows(results);
    return rows.map((r) => {
      const spend = Number(r.spend) || 0;
      const sales = Number(r.sales) || 0;
      const acos = spend > 0 && sales > 0 ? spend / sales * 100 : 0;
      let dateStr = "N/A";
      const dateValue = r.report_date || r.date;
      if (dateValue) {
        const dateObj = new Date(dateValue);
        if (!isNaN(dateObj.getTime())) {
          dateStr = `${dateObj.getMonth() + 1}/${dateObj.getDate()}`;
        }
      }
      return {
        date: dateStr,
        spend: parseFloat(spend.toFixed(0)),
        sales: parseFloat(sales.toFixed(0)),
        orders: Number(r.orders) || 0,
        acos: parseFloat(acos.toFixed(1))
      };
    });
  } catch (error48) {
    log16.warn("[getDailyTrendData] Error:", error48);
    return [];
  }
}
async function getDataDateRange(accountIds) {
  const db = await getDb();
  const defaultRange = /* @__PURE__ */ __name(() => {
    const now = /* @__PURE__ */ new Date();
    const minDate = new Date(now);
    minDate.setDate(minDate.getDate() - 90);
    return {
      minDate: minDate.toISOString().split("T")[0],
      maxDate: now.toISOString().split("T")[0],
      hasData: false
    };
  }, "defaultRange");
  if (!db) return defaultRange();
  try {
    const results = await db.execute(sql`
      SELECT 
        MIN(date) as min_date,
        MAX(date) as max_date
      FROM daily_performance
      WHERE accountId IN (${safeInClause(accountIds)})
    `);
    const row = extractFirstRow(results);
    if (row && row.min_date && row.max_date) {
      const syncResults = await db.execute(sql`
        SELECT MAX(lastSyncAt) as last_sync
        FROM amazon_api_credentials
        WHERE accountId IN (${safeInClause(accountIds)})
      `);
      const syncRow = extractFirstRow(syncResults);
      const formatDate2 = /* @__PURE__ */ __name((d) => {
        if (typeof d === "string") return d.split("T")[0];
        if (d instanceof Date) return d.toISOString().split("T")[0];
        return String(d);
      }, "formatDate");
      return {
        minDate: formatDate2(row.min_date),
        // @ts-ignore
        maxDate: formatDate2(row.max_date),
        hasData: true,
        // @ts-ignore
        lastSyncAt: syncRow?.last_sync || void 0
      };
    }
    const campaignResults = await db.execute(sql`
      SELECT 
        MIN(createdAt) as min_date,
        MAX(updatedAt) as max_date
      FROM campaigns
      WHERE accountId IN (${safeInClause(accountIds)})
    `);
    const campaignRow = extractFirstRow(campaignResults);
    if (campaignRow && campaignRow.min_date && campaignRow.max_date) {
      const formatDate2 = /* @__PURE__ */ __name((d) => {
        if (typeof d === "string") return d.split("T")[0];
        if (d instanceof Date) return d.toISOString().split("T")[0];
        return String(d);
      }, "formatDate");
      return {
        minDate: formatDate2(campaignRow.min_date),
        maxDate: formatDate2(campaignRow.max_date),
        hasData: true
      };
    }
    return defaultRange();
  } catch (error48) {
    log16.warn("[getDataDateRange] Error:", error48);
    return defaultRange();
  }
}
async function getPlacementPerformanceByCampaignId(campaignId) {
  const db = await getDb();
  if (!db) return [];
  try {
    const result = await db.execute(sql`
      SELECT 
        MIN(id) as id,
        campaignId,
        placement as placementType,
        SUM(impressions) as impressions,
        SUM(clicks) as clicks,
        SUM(spend) as spend,
        SUM(sales) as sales,
        SUM(orders) as orders,
        CASE WHEN SUM(sales) > 0 THEN ROUND(SUM(spend) / SUM(sales) * 100, 2) ELSE NULL END as acos,
        CASE WHEN SUM(spend) > 0 THEN ROUND(SUM(sales) / SUM(spend), 2) ELSE 0 END as roas,
        CASE WHEN SUM(impressions) > 0 THEN ROUND(SUM(clicks) / SUM(impressions), 6) ELSE 0 END as ctr,
        CASE WHEN SUM(clicks) > 0 THEN ROUND(SUM(orders) / SUM(clicks), 6) ELSE 0 END as cvr,
        CASE WHEN SUM(clicks) > 0 THEN ROUND(SUM(spend) / SUM(clicks), 2) ELSE NULL END as cpc,
        MAX(date) as reportDate,
        MIN(createdAt) as createdAt
      FROM placement_performance
      WHERE campaignId = ${campaignId}
      GROUP BY campaignId, placement
      ORDER BY placement
    `);
    return extractRows(result) || [];
  } catch (error48) {
    log16.warn("[getPlacementPerformanceByCampaignId] Error:", error48);
    return [];
  }
}
async function updateCampaignBudgetUsage(campaignId, data) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(campaigns).set({
    budgetUsagePercent: String(data.budgetUsagePercentage)
  }).where(eq(campaigns.campaignId, campaignId));
}
var log16;
var init_analytics = __esm({
  "server/db/analytics.ts"() {
    "use strict";
    init_drizzle_orm();
    init_connection();
    init_safeSql();
    init_logger();
    init_schema2();
    log16 = createModuleLogger("DB:analytics");
    __name(extractRows, "extractRows");
    __name(extractFirstRow, "extractFirstRow");
    __name(getLocalDataStats, "getLocalDataStats");
    __name(getAccountPerformanceSummary, "getAccountPerformanceSummary");
    __name(getDailyTrendData, "getDailyTrendData");
    __name(getDataDateRange, "getDataDateRange");
    __name(getPlacementPerformanceByCampaignId, "getPlacementPerformanceByCampaignId");
    __name(updateCampaignBudgetUsage, "updateCampaignBudgetUsage");
  }
});

