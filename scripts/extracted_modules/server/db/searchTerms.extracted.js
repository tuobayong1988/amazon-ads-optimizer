// Extracted from production dist/index.js
// Original module: server/db/searchTerms.ts
// Lines: 416

async function getSearchTermsForAnalysis(accountId, _days = 30) {
  const db = await getDb();
  if (!db) return [];
  const result = await db.select({
    searchTerm: keywords.keywordText,
    clicks: keywords.clicks,
    orders: keywords.orders,
    spend: keywords.spend,
    sales: keywords.sales,
    impressions: keywords.impressions
  }).from(keywords).innerJoin(adGroups, eq(keywords.internalAdGroupId, adGroups.id)).innerJoin(campaigns, eq(adGroups.campaignId, campaigns.campaignId)).where(eq(campaigns.accountId, accountId));
  return result.map((r) => ({
    searchTerm: r.searchTerm || "",
    clicks: Number(r.clicks) || 0,
    conversions: Number(r.orders) || 0,
    spend: parseFloat(r.spend || "0"),
    sales: parseFloat(r.sales || "0"),
    impressions: Number(r.impressions) || 0
  }));
}
async function getCampaignSearchTerms(accountId) {
  const db = await getDb();
  if (!db) return [];
  const result = await db.select({
    searchTerm: keywords.keywordText,
    campaignId: campaigns.campaignId,
    campaignName: campaigns.campaignName,
    matchType: keywords.matchType,
    clicks: keywords.clicks,
    spend: keywords.spend,
    sales: keywords.sales,
    orders: keywords.orders,
    bid: keywords.bid
  }).from(keywords).innerJoin(adGroups, eq(keywords.internalAdGroupId, adGroups.id)).innerJoin(campaigns, eq(adGroups.campaignId, campaigns.campaignId)).where(eq(campaigns.accountId, accountId));
  return result.map((r) => {
    const clicks = Number(r.clicks) || 0;
    const orders = Number(r.orders) || 0;
    const spend = parseFloat(r.spend || "0");
    const sales = parseFloat(r.sales || "0");
    const roas = spend > 0 ? sales / spend : 0;
    const acos = sales > 0 ? spend / sales * 100 : 0;
    const cpc = clicks > 0 ? spend / clicks : 0;
    return {
      searchTerm: r.searchTerm || "",
      campaignId: r.campaignId,
      campaignName: r.campaignName || "",
      campaignType: "sp_manual",
      // 默认为SP手动广告
      targetingType: "keyword",
      // 关键词定位
      matchType: r.matchType || "broad",
      clicks,
      conversions: orders,
      spend,
      sales,
      roas,
      acos,
      cpc
    };
  });
}
async function getBidTargets(accountId) {
  const db = await getDb();
  if (!db) return [];
  const keywordTargets = await db.select({
    id: keywords.id,
    name: keywords.keywordText,
    campaignId: campaigns.campaignId,
    campaignName: campaigns.campaignName,
    currentBid: keywords.bid,
    impressions: keywords.impressions,
    clicks: keywords.clicks,
    spend: keywords.spend,
    sales: keywords.sales,
    orders: keywords.orders
  }).from(keywords).innerJoin(adGroups, eq(keywords.internalAdGroupId, adGroups.id)).innerJoin(campaigns, eq(adGroups.campaignId, campaigns.campaignId)).where(eq(campaigns.accountId, accountId));
  const productTargetResults = await db.select({
    id: productTargets.id,
    name: productTargets.targetValue,
    campaignId: campaigns.campaignId,
    campaignName: campaigns.campaignName,
    currentBid: productTargets.bid,
    impressions: productTargets.impressions,
    clicks: productTargets.clicks,
    spend: productTargets.spend,
    sales: productTargets.sales,
    orders: productTargets.orders
  }).from(productTargets).innerJoin(adGroups, eq(productTargets.internalAdGroupId, adGroups.id)).innerJoin(campaigns, eq(adGroups.campaignId, campaigns.campaignId)).where(eq(campaigns.accountId, accountId));
  const results = [
    ...keywordTargets.map((r) => ({
      id: r.id,
      type: "keyword",
      name: r.name || "",
      campaignId: r.campaignId,
      campaignName: r.campaignName || "",
      currentBid: parseFloat(r.currentBid || "0"),
      impressions: Number(r.impressions) || 0,
      clicks: Number(r.clicks) || 0,
      conversions: Number(r.orders) || 0,
      spend: parseFloat(r.spend || "0"),
      sales: parseFloat(r.sales || "0")
    })),
    ...productTargetResults.map((r) => ({
      id: r.id,
      type: "product_target",
      name: r.name || "",
      campaignId: r.campaignId,
      campaignName: r.campaignName || "",
      currentBid: parseFloat(r.currentBid || "0"),
      impressions: Number(r.impressions) || 0,
      clicks: Number(r.clicks) || 0,
      conversions: Number(r.orders) || 0,
      spend: parseFloat(r.spend || "0"),
      sales: parseFloat(r.sales || "0")
    }))
  ];
  return results;
}
async function getUniqueSearchTerms(accountId) {
  const db = await getDb();
  if (!db) return [];
  const result = await db.selectDistinct({
    searchTerm: keywords.keywordText
  }).from(keywords).innerJoin(adGroups, eq(keywords.internalAdGroupId, adGroups.id)).innerJoin(campaigns, eq(adGroups.campaignId, campaigns.campaignId)).where(eq(campaigns.accountId, accountId));
  return result.map((r) => r.searchTerm || "").filter((t2) => t2.length > 0);
}
async function recordMigration(data) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(biddingLogs).values({
    accountId: data.accountId,
    campaignId: guardCampaignIdInsert(data.fromCampaignId, "biddingLogs"),
    // v208: 写入守卫
    logTargetType: "keyword",
    targetId: 0,
    targetName: data.searchTerm,
    logMatchType: data.toMatchType,
    actionType: "set",
    previousBid: "0",
    newBid: data.suggestedBid.toString(),
    reason: `\u6F0F\u6597\u8FC1\u79FB: \u5347\u7EA7\u5230${data.toMatchType}\u5339\u914D`
  });
}
async function getBidChangeRecords(accountId, days) {
  const db = await getDb();
  if (!db) return [];
  const startDate = /* @__PURE__ */ new Date();
  startDate.setDate(startDate.getDate() - days);
  const logs = await db.select().from(biddingLogs).where(eq(biddingLogs.accountId, accountId)).orderBy(desc(biddingLogs.createdAt)).limit(500);
  const records = [];
  for (const bidRecord of logs) {
    if (bidRecord.actionType !== "increase" && bidRecord.actionType !== "decrease" && bidRecord.actionType !== "set") {
      continue;
    }
    const oldBid = parseFloat(bidRecord.previousBid || "0");
    const newBid = parseFloat(bidRecord.newBid || "0");
    if (oldBid === 0 || newBid === 0) continue;
    let performanceAfter = {
      clicks: 0,
      conversions: 0,
      spend: 0,
      sales: 0,
      roas: 0,
      acos: 0
    };
    try {
      if (bidRecord.campaignId) {
        const changeDate = new Date(bidRecord.createdAt || Date.now());
        const endDate = new Date(changeDate);
        endDate.setDate(endDate.getDate() + 7);
        const perfRows = await db.select().from(dailyPerformance).where(and(
          // @ts-expect-error - dynamic property access
          eq(dailyPerformance.campaignId, String(log.campaignId)),
          sql`DATE(${dailyPerformance.date}) >= ${changeDate.toISOString().split("T")[0]}`,
          sql`DATE(${dailyPerformance.date}) <= ${endDate.toISOString().split("T")[0]}`
        ));
        if (perfRows.length > 0) {
          const totalClicks = perfRows.reduce((s, r) => s + (r.clicks || 0), 0);
          const totalSpend = perfRows.reduce((s, r) => s + parseFloat(String(r.spend || "0")), 0);
          const totalSales = perfRows.reduce((s, r) => s + parseFloat(String(r.sales || "0")), 0);
          const totalOrders = perfRows.reduce((s, r) => s + (r.orders || 0), 0);
          performanceAfter = {
            // @ts-ignore
            clicks: totalClicks,
            // @ts-ignore
            conversions: totalOrders,
            // @ts-ignore
            spend: totalSpend,
            // @ts-ignore
            sales: totalSales,
            // @ts-ignore
            roas: totalSpend > 0 ? totalSales / totalSpend : 0,
            // @ts-ignore
            acos: totalSales > 0 ? totalSpend / totalSales * 100 : 0
          };
        }
      }
    } catch (e) {
    }
    records.push({
      id: bidRecord.id,
      targetId: bidRecord.targetId || 0,
      targetName: bidRecord.targetName || "",
      targetType: bidRecord.logTargetType,
      // @ts-expect-error - type assertion
      campaignId: bidRecord.campaignId || 0,
      campaignName: "",
      oldBid,
      newBid,
      changeDate: bidRecord.createdAt || (/* @__PURE__ */ new Date()).toISOString(),
      changeReason: bidRecord.reason || "",
      performanceAfter
    });
  }
  return records;
}
async function recordBidChange(data) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const dbTargetType = data.targetType === "product" ? "product_target" : "keyword";
  await db.insert(biddingLogs).values({
    accountId: data.accountId,
    campaignId: data.campaignId ? guardCampaignIdInsert(data.campaignId, "biddingLogs") : "",
    // v208: 写入守卫
    logTargetType: dbTargetType,
    targetId: data.targetId,
    targetName: "",
    logMatchType: "exact",
    actionType: data.newBid > data.oldBid ? "increase" : "decrease",
    previousBid: data.oldBid.toString(),
    newBid: data.newBid.toString(),
    reason: data.reason
  });
}
async function getCampaignHealthMetrics(accountId) {
  const db = await getDb();
  if (!db) return [];
  const campaignList = await db.select().from(campaigns).where(eq(campaigns.accountId, accountId));
  const results = [];
  for (const campaign of campaignList) {
    const recentPerf = await db.select().from(dailyPerformance).where(eq(dailyPerformance.campaignId, String(campaign.campaignId))).orderBy(desc(dailyPerformance.date)).limit(7);
    const historicalPerf = await db.select().from(dailyPerformance).where(eq(dailyPerformance.campaignId, String(campaign.campaignId))).orderBy(desc(dailyPerformance.date)).limit(30);
    const currentMetrics = calculateAverageMetrics(recentPerf);
    const historicalAverage = calculateAverageMetrics(historicalPerf);
    const changes = calculateMetricChanges(currentMetrics, historicalAverage);
    results.push({
      // @ts-ignore
      campaignId: String(campaign.campaignId),
      // @ts-ignore
      campaignName: campaign.campaignName,
      // @ts-ignore
      campaignType: campaign.campaignType,
      currentMetrics,
      historicalAverage,
      changes
    });
  }
  return results;
}
function calculateAverageMetrics(perfData) {
  if (perfData.length === 0) {
    return {
      impressions: 0,
      clicks: 0,
      spend: 0,
      sales: 0,
      orders: 0,
      ctr: 0,
      cvr: 0,
      acos: 0,
      roas: 0,
      cpc: 0
    };
  }
  const totals = perfData.reduce((acc, p) => ({
    impressions: acc.impressions + (Number(p.impressions) || 0),
    clicks: acc.clicks + (Number(p.clicks) || 0),
    spend: acc.spend + parseFloat(String(p.spend || "0")),
    sales: acc.sales + parseFloat(String(p.sales || "0")),
    orders: acc.orders + (Number(p.orders) || 0)
  }), { impressions: 0, clicks: 0, spend: 0, sales: 0, orders: 0 });
  const ctr = totals.impressions > 0 ? totals.clicks / totals.impressions * 100 : 0;
  const cvr = totals.clicks > 0 ? totals.orders / totals.clicks * 100 : 0;
  const acos = totals.sales > 0 ? totals.spend / totals.sales * 100 : 0;
  const roas = totals.spend > 0 ? totals.sales / totals.spend : 0;
  const cpc = totals.clicks > 0 ? totals.spend / totals.clicks : 0;
  return {
    impressions: Math.round(totals.impressions / perfData.length),
    clicks: Math.round(totals.clicks / perfData.length),
    spend: totals.spend / perfData.length,
    sales: totals.sales / perfData.length,
    orders: Math.round(totals.orders / perfData.length),
    ctr,
    cvr,
    acos,
    roas,
    cpc
  };
}
function calculateMetricChanges(current, historical) {
  const calcChange = /* @__PURE__ */ __name((curr, hist) => {
    if (hist === 0) return curr > 0 ? 100 : 0;
    return (curr - hist) / hist * 100;
  }, "calcChange");
  return {
    impressions: calcChange(current.impressions, historical.impressions),
    clicks: calcChange(current.clicks, historical.clicks),
    spend: calcChange(current.spend, historical.spend),
    sales: calcChange(current.sales, historical.sales),
    orders: calcChange(current.orders, historical.orders),
    ctr: calcChange(current.ctr, historical.ctr),
    cvr: calcChange(current.cvr, historical.cvr),
    acos: calcChange(current.acos, historical.acos),
    roas: calcChange(current.roas, historical.roas),
    cpc: calcChange(current.cpc, historical.cpc)
  };
}
async function addNegativeKeyword(data) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  let resolvedAccountId = data.accountId || 0;
  if (!resolvedAccountId && data.campaignId) {
    try {
      const { sql: sql15 } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
      const rows = await db.execute(sql15`SELECT accountId FROM campaigns WHERE id = ${data.campaignId} OR campaignId = ${String(data.campaignId)} LIMIT 1`);
      if (rows && rows.length > 0) {
        resolvedAccountId = rows[0]?.accountId || 0;
      }
    } catch {
    }
  }
  await db.insert(negativeKeywords).values({
    accountId: resolvedAccountId,
    campaignId: data.campaignId,
    internalAdGroupId: data.adGroupId || null,
    negativeLevel: data.level || (data.adGroupId ? "ad_group" : "campaign"),
    negativeType: "keyword",
    negativeText: data.keyword,
    negativeMatchType: data.matchType === "phrase" ? "negative_phrase" : "negative_exact",
    negativeSource: "manual"
  });
}
async function getNegativeKeywordsByCampaignId(campaignId) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(negativeKeywords).where(eq(negativeKeywords.campaignId, String(campaignId)));
}
async function getNegativeKeywordsByAccountId(accountId) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(negativeKeywords).where(eq(negativeKeywords.accountId, accountId));
}
async function getNegativeKeywordsByAdGroupId(adGroupId) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(negativeKeywords).where(eq(negativeKeywords.internalAdGroupId, Number(adGroupId)));
}
async function getSearchTermsByCampaignId(campaignId) {
  const db = await getDb();
  if (!db) return [];
  const campaignIdStr = guardCampaignIdParam(campaignId, "getSearchTermsByCampaignId");
  return db.select().from(searchTerms).where(eq(searchTerms.campaignId, campaignIdStr));
}
async function getSearchTermsByAdGroupId(adGroupId) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(searchTerms).where(eq(searchTerms.internalAdGroupId, Number(adGroupId)));
}
async function createSearchTerm(data) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(searchTerms).values(data);
  return result[0].insertId;
}
async function bulkCreateSearchTerms(data) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (data.length === 0) return;
  await db.insert(searchTerms).values(data).onDuplicateKeyUpdate({
    set: {
      searchTermImpressions: sql`VALUES(search_term_impressions)`,
      searchTermClicks: sql`VALUES(search_term_clicks)`,
      searchTermSpend: sql`VALUES(search_term_spend)`,
      searchTermSales: sql`VALUES(search_term_sales)`,
      searchTermOrders: sql`VALUES(search_term_orders)`
    }
  });
}
var init_searchTerms = __esm({
  "server/db/searchTerms.ts"() {
    "use strict";
    init_drizzle_orm();
    init_schema2();
    init_connection();
    init_idTypes();
    __name(getSearchTermsForAnalysis, "getSearchTermsForAnalysis");
    __name(getCampaignSearchTerms, "getCampaignSearchTerms");
    __name(getBidTargets, "getBidTargets");
    __name(getUniqueSearchTerms, "getUniqueSearchTerms");
    __name(recordMigration, "recordMigration");
    __name(getBidChangeRecords, "getBidChangeRecords");
    __name(recordBidChange, "recordBidChange");
    __name(getCampaignHealthMetrics, "getCampaignHealthMetrics");
    __name(calculateAverageMetrics, "calculateAverageMetrics");
    __name(calculateMetricChanges, "calculateMetricChanges");
    __name(addNegativeKeyword, "addNegativeKeyword");
    __name(getNegativeKeywordsByCampaignId, "getNegativeKeywordsByCampaignId");
    __name(getNegativeKeywordsByAccountId, "getNegativeKeywordsByAccountId");
    __name(getNegativeKeywordsByAdGroupId, "getNegativeKeywordsByAdGroupId");
    __name(getSearchTermsByCampaignId, "getSearchTermsByCampaignId");
    __name(getSearchTermsByAdGroupId, "getSearchTermsByAdGroupId");
    __name(createSearchTerm, "createSearchTerm");
    __name(bulkCreateSearchTerms, "bulkCreateSearchTerms");
  }
});

