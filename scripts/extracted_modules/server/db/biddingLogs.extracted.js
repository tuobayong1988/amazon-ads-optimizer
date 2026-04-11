// Extracted from production dist/index.js
// Original module: server/db/biddingLogs.ts
// Lines: 90

async function createBiddingLog(log216) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const { safeCampaignIdForInsert: safeCampaignIdForInsert2 } = await Promise.resolve().then(() => (init_campaignIdResolver(), campaignIdResolver_exports));
  const safeCampaignId = await safeCampaignIdForInsert2({
    campaignId: log216.campaignId,
    targetLocalId: log216.targetId ? Number(log216.targetId) : void 0,
    // @ts-expect-error - dynamic property access
    targetType: log216.logTargetType || "keyword",
    adGroupId: log216.internalAdGroupId ? Number(log216.internalAdGroupId) : void 0,
    caller: "createBiddingLog"
  });
  log216.campaignId = safeCampaignId;
  const result = await db.insert(biddingLogs).values(log216);
  const logId = result[0].insertId;
  try {
    const bidChange = Number(log216.newBid || 0) - Number(log216.previousBid || 0);
    // v620-fix13: P0-2 Fix - Correctly set eventCategory and actionType based on logTargetType
    const isSearchTermHarvest = log216.logTargetType === 'search_term_harvest';
    const isNegativeKeyword = log216.logTargetType === 'negative_keyword';
    const isCampaignBudget = log216.logTargetType === 'campaign_budget';
    let resolvedEventCategory = 'bid_adjustment';
    let resolvedActionType = bidChange > 0 ? 'bid_increase' : bidChange < 0 ? 'bid_decrease' : 'bid_set';
    if (isSearchTermHarvest) {
      resolvedEventCategory = 'search_term_action';
      resolvedActionType = 'search_term_harvest';
    } else if (isNegativeKeyword) {
      resolvedEventCategory = 'search_term_action';
      resolvedActionType = 'negative_keyword_add';
    } else if (isCampaignBudget) {
      resolvedEventCategory = 'budget_adjustment';
      resolvedActionType = 'budget_adjustment';
    }
    await db.insert(optimizationEvents2).values({
      accountId: log216.accountId || 0,
      eventCategory: resolvedEventCategory,
      actionType: resolvedActionType,
      // v438: campaignId存储为字符串，避免Amazon ID转Number时精度丢失或溢出
      campaignId: safeCampaignId != null ? String(safeCampaignId) : null,
      campaignName: log216.campaignName || null,
      keywordId: log216.targetId,
      keywordText: log216.keywordText || null,
      matchType: log216.logMatchType || null,
      previousBid: String(log216.previousBid || 0),
      newBid: String(log216.newBid || 0),
      bidChangePercent: Number(log216.previousBid) > 0 ? String(Math.round(bidChange / Number(log216.previousBid) * 1e4) / 100) : "0",
      changeReason: log216.reason || null,
      adjustmentType: log216.actionType || null,
      status: "success",
      apiSyncStatus: "not_applicable",
      sourceTable: "bidding_logs",
      sourceId: Number(logId)
    });
  } catch (e) {
    log216.error("[v145] \u53CC\u5199optimization_events\u5931\u8D25(biddingLog):", e);
  }
  return logId;
}
async function getBiddingLogsByAccountId(accountId, limit = 100, offset = 0) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(biddingLogs).where(eq(biddingLogs.accountId, accountId)).orderBy(desc(biddingLogs.createdAt)).limit(limit).offset(offset);
}
async function getBiddingLogsByCampaignId(campaignId, limit = 100) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(biddingLogs).where(eq(biddingLogs.campaignId, String(campaignId))).orderBy(desc(biddingLogs.createdAt)).limit(limit);
}
async function getBiddingLogsCount(accountId) {
  const db = await getDb();
  if (!db) return 0;
  const result = await db.select({ count: sql`count(*)` }).from(biddingLogs).where(eq(biddingLogs.accountId, accountId));
  return result[0]?.count || 0;
}
var log11;
var init_biddingLogs = __esm({
  "server/db/biddingLogs.ts"() {
    "use strict";
    init_drizzle_orm();
    init_schema2();
    init_connection();
    init_logger();
    log11 = createModuleLogger("DB:biddingLogs");
    __name(createBiddingLog, "createBiddingLog");
    __name(getBiddingLogsByAccountId, "getBiddingLogsByAccountId");
    __name(getBiddingLogsByCampaignId, "getBiddingLogsByCampaignId");
    __name(getBiddingLogsCount, "getBiddingLogsCount");
  }
});

