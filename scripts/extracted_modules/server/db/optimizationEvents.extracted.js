// Extracted from production dist/index.js
// Original module: server/db/optimizationEvents.ts
// Lines: 589

async function createOptimizationLog(data) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(optimizationLogs).values(data);
  const logId = Number(result[0].insertId);
  try {
    const categoryMap = {
      // v212: 修正映射 - 键名必须与optimization_logs.log_category实际值一致
      "bid_adjustment": "bid_adjustment",
      "placement_adjustment": "placement_adjustment",
      "budget_adjustment": "budget_adjustment",
      "optimization_settings": "settings_change",
      // 保留旧映射以兼容可能的历史数据
      "bid_optimization": "bid_adjustment",
      "placement_optimization": "placement_adjustment",
      "budget_optimization": "budget_adjustment",
      "search_term_optimization": "search_term_action",
      "keyword_management": "keyword_action",
      "campaign_management": "campaign_action",
      "target_management": "target_management",
      "settings": "settings_change"
    };
    const actionTypeMap = {
      "bid_increase": "bid_increase",
      "bid_decrease": "bid_decrease",
      "bid_set": "bid_set",
      "bid_auto_adjust": "bid_auto_adjust",
      "dayparting_bid": "dayparting_bid",
      "budget_increase": "budget_increase",
      "budget_decrease": "budget_decrease",
      "budget_set": "budget_set",
      "budget_adjustment": "budget_adjustment",
      "placement_adjust": "placement_adjust",
      "search_term_harvest": "search_term_harvest",
      "negative_keyword_add": "negative_keyword_add",
      "negative_keyword_remove": "negative_keyword_remove",
      "keyword_create": "keyword_create",
      "target_pause": "target_pause",
      "target_enable": "target_enable",
      "campaign_pause": "campaign_pause",
      "campaign_enable": "campaign_enable",
      "create_target": "create_target",
      "update_target": "update_target",
      "delete_target": "delete_target",
      "pause_target": "pause_target",
      "resume_target": "resume_target",
      "add_campaign": "add_campaign",
      "remove_campaign": "remove_campaign",
      "settings_update": "settings_update",
      "strategy_change": "strategy_change"
    };
    let extractedKeywordId;
    let extractedKeywordText;
    let extractedPreviousBid;
    let extractedNewBid;
    let extractedBidChangePercent;
    let extractedApiSyncStatus;
    let extractedApiSyncDetail;
    if (data.actionDetail) {
      try {
        const detail = typeof data.actionDetail === "string" ? JSON.parse(data.actionDetail) : data.actionDetail;
        extractedKeywordId = detail.keywordId ? Number(detail.keywordId) : void 0;
        extractedKeywordText = detail.keywordText || void 0;
        extractedPreviousBid = detail.currentBid != null ? String(detail.currentBid) : void 0;
        extractedNewBid = detail.newBid != null ? String(detail.newBid) : void 0;
        extractedBidChangePercent = detail.changePercent != null ? String(detail.changePercent) : void 0;
        extractedApiSyncStatus = detail.apiSyncStatus || void 0;
        extractedApiSyncDetail = detail.apiSyncDetail || void 0;
      } catch (parseErr) {
      }
    }
    const resolvedCategory = categoryMap[data.logCategory || ""] || "settings_change";
    const resolvedActionType = actionTypeMap[data.actionType || ""] || "settings_update";
    const finalApiSyncStatus = extractedApiSyncStatus || data.apiSyncStatus || "pending";
    const finalApiSyncDetail = extractedApiSyncDetail || data.apiSyncDetail;
    let extractedApiResponseId;
    if (data.actionDetail) {
      try {
        const detailObj = typeof data.actionDetail === "string" ? JSON.parse(data.actionDetail) : data.actionDetail;
        extractedApiResponseId = detailObj.apiResponseId || void 0;
      } catch {
      }
    }
    const eventResult = await db.insert(optimizationEvents2).values({
      // @ts-expect-error - performanceGroupId may exist on extended InsertOptimizationLog
      performanceGroupId: data.performanceGroupId,
      performanceGroupName: data.performanceGroupName,
      accountId: data.accountId || 0,
      accountName: data.accountName,
      userId: data.userId,
      userName: data.userName,
      eventCategory: resolvedCategory,
      actionType: resolvedActionType,
      strategyTemplateId: data.strategyTemplateId,
      strategyTemplateName: data.strategyTemplateName,
      campaignId: data.campaignId ? guardCampaignIdInsert(data.campaignId, "optimization_events") : null,
      campaignName: data.campaignName,
      // v212: 从 action_detail中提取的关键字段
      keywordId: extractedKeywordId,
      keywordText: extractedKeywordText,
      previousBid: extractedPreviousBid,
      newBid: extractedNewBid,
      bidChangePercent: extractedBidChangePercent,
      // v534: 修复previousValue/newValue缺失 - 从previousBid/newBid回填
      previousValue: data.previousValue || (extractedPreviousBid != null ? `$${extractedPreviousBid}` : null),
      newValue: data.newValue || (extractedNewBid != null ? `$${extractedNewBid}` : null),
      changeReason: data.changeReason,
      actionDetail: data.actionDetail,
      status: data.status || "success",
      apiSyncStatus: finalApiSyncStatus === "partial" ? "synced" : finalApiSyncStatus,
      apiSyncDetail: finalApiSyncDetail,
      // v333: 传递apiResponseId和apiSyncedAt到optimization_events表
      apiResponseId: extractedApiResponseId || data.apiResponseId || null,
      apiSyncedAt: data.apiSyncedAt || (finalApiSyncStatus === "synced" ? (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ") : null),
      errorMessage: data.errorMessage,
      sourceTable: "optimization_logs",
      sourceId: logId,
      executedAt: data.executedAt,
      // v258: 写入结构化归因和护栏信息
      reasonDetails: data.reasonDetails || void 0,
      guardrailInfo: data.guardrailInfo || void 0,
      relatedEventId: data.relatedEventId || void 0,
      // v274: 写入算法决策元数据（预算分池、因果推断、GTO修正等）
      performanceData: (() => {
        try {
          if (!data.actionDetail) return void 0;
          const detail = typeof data.actionDetail === "string" ? JSON.parse(data.actionDetail) : data.actionDetail;
          const meta3 = {};
          if (detail.gtoModifier) {
            meta3.gto = {
              composite: detail.gtoModifier.compositeModifier,
              budgetPool: detail.gtoModifier.decisions?.budget?.pool,
              budgetModifier: detail.gtoModifier.decisions?.budget?.budgetModifier,
              isFrozen: detail.gtoModifier.decisions?.budget?.isFrozen,
              keywordRole: detail.gtoModifier.decisions?.portfolio?.role,
              competitorType: detail.gtoModifier.decisions?.competition?.dominantCompetitorType
            };
          }
          if (detail.causalAdjustment) {
            meta3.causal = detail.causalAdjustment;
          }
          if (detail.correctionLayers) {
            meta3.correctionLayers = detail.correctionLayers;
          }
          if (detail.metaLearningDetail) {
            meta3.metaLearning = {
              candidateAlgorithms: detail.metaLearningDetail.candidateAlgorithms,
              selectedAlgorithm: detail.metaLearningDetail.selectedAlgorithm,
              selectionReason: detail.metaLearningDetail.selectionReason,
              fusionMode: detail.metaLearningDetail.fusionMode,
              fusionDetail: detail.metaLearningDetail.fusionDetail
            };
          }
          if (detail.algorithmTier) meta3.algorithmTier = detail.algorithmTier;
          if (detail.algorithmUsed) meta3.algorithmUsed = detail.algorithmUsed;
          return Object.keys(meta3).length > 0 ? JSON.stringify(meta3) : void 0;
        } catch {
          return void 0;
        }
      })()
    });
    const eventId = Number(eventResult[0].insertId);
    log17.info(`[v509] \u53CC\u5199optimization_events\u6210\u529F: logId=${logId}, eventId=${eventId}, category=${resolvedCategory}, keywordId=${extractedKeywordId || "N/A"}, apiSyncStatus=${finalApiSyncStatus}`);
    return { logId, eventId };
  } catch (e) {
    log17.warn("[v212] \u53CC\u5199optimization_events\u5931\u8D25:", (e instanceof Error ? e.message : String(e)) || e);
    log17.warn(`[v212] \u53CC\u5199\u5931\u8D25\u8BE6\u60C5: logCategory=${data.logCategory} actionType=${data.actionType}`);
  }
  return { logId, eventId: null };
}
async function getOptimizationLogs(params) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const { performanceGroupId: performanceGroupId2, category = "all", startDate, endDate, page = 1, pageSize = 50 } = params;
  const offset = (page - 1) * pageSize;
  let conditions = [eq(optimizationLogs.performanceGroupId, performanceGroupId2)];
  if (category && category !== "all") {
    conditions.push(eq(optimizationLogs.logCategory, category));
  }
  if (startDate) {
    conditions.push(gte(optimizationLogs.createdAt, startDate));
  }
  if (endDate) {
    conditions.push(lte(optimizationLogs.createdAt, endDate));
  }
  const countResult = await db.select({ count: sql`count(*)` }).from(optimizationLogs).where(and(...conditions));
  const total = countResult[0]?.count || 0;
  const logs = await db.select().from(optimizationLogs).where(and(...conditions)).orderBy(desc(optimizationLogs.createdAt)).limit(pageSize).offset(offset);
  return { logs, total, page, pageSize };
}
async function getOptimizationLogStats(performanceGroupId2, days = 30) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const startDate = /* @__PURE__ */ new Date();
  startDate.setDate(startDate.getDate() - days);
  const startDateStr = startDate.toISOString().slice(0, 19).replace("T", " ");
  const totalResult = await db.select({ count: sql`count(*)` }).from(optimizationLogs).where(and(
    eq(optimizationLogs.performanceGroupId, performanceGroupId2),
    gte(optimizationLogs.createdAt, startDateStr)
  ));
  const totalLogs = totalResult[0]?.count || 0;
  const byCategoryResult = await db.select({
    category: optimizationLogs.logCategory,
    count: sql`count(*)`
  }).from(optimizationLogs).where(and(
    eq(optimizationLogs.performanceGroupId, performanceGroupId2),
    gte(optimizationLogs.createdAt, startDateStr)
  )).groupBy(optimizationLogs.logCategory);
  const byActionTypeResult = await db.select({
    actionType: optimizationLogs.actionType,
    count: sql`count(*)`
  }).from(optimizationLogs).where(and(
    eq(optimizationLogs.performanceGroupId, performanceGroupId2),
    gte(optimizationLogs.createdAt, startDateStr)
  )).groupBy(optimizationLogs.actionType);
  const recentActivityResult = await db.select({
    date: sql`DATE(created_at)`,
    count: sql`count(*)`
  }).from(optimizationLogs).where(and(
    eq(optimizationLogs.performanceGroupId, performanceGroupId2),
    gte(optimizationLogs.createdAt, startDateStr)
  )).groupBy(sql`DATE(created_at)`).orderBy(sql`DATE(created_at)`);
  return {
    totalLogs,
    byCategory: byCategoryResult.map((r) => ({ category: r.category, count: r.count })),
    byActionType: byActionTypeResult.map((r) => ({ actionType: r.actionType, count: r.count })),
    recentActivity: recentActivityResult.map((r) => ({ date: r.date, count: r.count }))
  };
}
async function batchCreateOptimizationLogs(logs) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (logs.length === 0) return 0;
  await db.insert(optimizationLogs).values(logs);
  return logs.length;
}
async function insertOptimizationEvent(event) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (event.campaignId != null) {
    const { quickValidateCampaignId: quickValidateCampaignId2 } = await Promise.resolve().then(() => (init_campaignIdResolver(), campaignIdResolver_exports));
    event.campaignId = quickValidateCampaignId2(String(event.campaignId), "insertOptimizationEvent");
  }
  const result = await db.insert(optimizationEvents2).values(event);
  return result[0].insertId;
}
async function batchInsertOptimizationEvents(events) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (events.length === 0) return 0;
  const { quickValidateCampaignId: quickValidateCampaignId2 } = await Promise.resolve().then(() => (init_campaignIdResolver(), campaignIdResolver_exports));
  for (const event of events) {
    if (event.campaignId != null) {
      event.campaignId = quickValidateCampaignId2(String(event.campaignId), "batchInsertOptimizationEvents");
    }
  }
  await db.insert(optimizationEvents2).values(events);
  return events.length;
}
async function getOptimizationEvents(params) {
  const db = await getDb();
  if (!db) return { events: [], total: 0 };
  const conditions = [];
  if (params.performanceGroupId) conditions.push(eq(optimizationEvents2.performanceGroupId, params.performanceGroupId));
  if (params.accountId) conditions.push(eq(optimizationEvents2.accountId, params.accountId));
  if (params.eventCategory) conditions.push(sql`${optimizationEvents2.eventCategory} = ${params.eventCategory}`);
  if (params.actionType) conditions.push(sql`${optimizationEvents2.actionType} = ${params.actionType}`);
  if (params.status) conditions.push(sql`${optimizationEvents2.status} = ${params.status}`);
  if (params.apiSyncStatus) conditions.push(sql`${optimizationEvents2.apiSyncStatus} = ${params.apiSyncStatus}`);
  if (params.campaignId) conditions.push(eq(optimizationEvents2.campaignId, params.campaignId));
  if (params.keywordId) conditions.push(eq(optimizationEvents2.keywordId, params.keywordId));
  if (params.startDate) conditions.push(gte(optimizationEvents2.createdAt, params.startDate));
  if (params.endDate) conditions.push(lte(optimizationEvents2.createdAt, params.endDate));
  const whereClause = conditions.length > 0 ? and(...conditions) : void 0;
  const [events, countResult] = await Promise.all([
    db.select().from(optimizationEvents2).where(whereClause).orderBy(desc(optimizationEvents2.createdAt)).limit(params.limit || 50).offset(params.offset || 0),
    db.select({ count: sql`count(*)` }).from(optimizationEvents2).where(whereClause)
  ]);
  return { events, total: countResult[0]?.count || 0 };
}
async function getOptimizationEventStats(params) {
  const db = await getDb();
  if (!db) return { totalEvents: 0, byCategory: [], byStatus: [], successRate: 0, recentTrend: [] };
  const days = params.days || 30;
  const startDate = /* @__PURE__ */ new Date();
  startDate.setDate(startDate.getDate() - days);
  const startDateStr = startDate.toISOString().slice(0, 19).replace("T", " ");
  const conditions = [gte(optimizationEvents2.createdAt, startDateStr)];
  if (params.performanceGroupId) conditions.push(eq(optimizationEvents2.performanceGroupId, params.performanceGroupId));
  if (params.accountId) conditions.push(eq(optimizationEvents2.accountId, params.accountId));
  const whereClause = and(...conditions);
  const [totalResult, byCategoryResult, byStatusResult, trendResult] = await Promise.all([
    db.select({ count: sql`count(*)` }).from(optimizationEvents2).where(whereClause),
    db.select({
      category: optimizationEvents2.eventCategory,
      count: sql`count(*)`
    }).from(optimizationEvents2).where(whereClause).groupBy(optimizationEvents2.eventCategory),
    db.select({
      status: optimizationEvents2.status,
      count: sql`count(*)`
    }).from(optimizationEvents2).where(whereClause).groupBy(optimizationEvents2.status),
    db.select({
      date: sql`DATE(created_at)`,
      count: sql`count(*)`
    }).from(optimizationEvents2).where(whereClause).groupBy(sql`DATE(created_at)`).orderBy(sql`DATE(created_at)`)
  ]);
  const totalEvents = totalResult[0]?.count || 0;
  const successCount = byStatusResult.find((r) => r.status === "success")?.count || 0;
  const failedCount = byStatusResult.find((r) => r.status === "failed")?.count || 0;
  const executedCount = successCount + failedCount;
  return {
    totalEvents,
    byCategory: byCategoryResult.map((r) => ({ category: r.category || "", count: r.count })),
    byStatus: byStatusResult.map((r) => ({ status: r.status || "", count: r.count })),
    successRate: executedCount > 0 ? Math.round(successCount / executedCount * 100) : 0,
    recentTrend: trendResult.map((r) => ({ date: r.date, count: r.count }))
  };
}
async function getBidAdjustmentEvents(params) {
  return getOptimizationEvents({
    ...params,
    eventCategory: "bid_adjustment"
  });
}
async function rollbackOptimizationEvent(eventId, rolledBackBy) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.update(optimizationEvents2).set({
    status: "rolled_back",
    rolledBackAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " "),
    rolledBackBy
  }).where(eq(optimizationEvents2.id, eventId));
  return true;
}
async function updateOptimizationEventTracking(eventId, trackingData) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(optimizationEvents2).set({
    ...trackingData,
    trackingUpdatedAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ")
  }).where(eq(optimizationEvents2.id, eventId));
}
async function migrateFromBiddingLogs(accountId) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const oldLogs = await db.select().from(biddingLogs).where(eq(biddingLogs.accountId, accountId)).orderBy(desc(biddingLogs.createdAt));
  if (oldLogs.length === 0) return 0;
  const events = oldLogs.map((log216) => ({
    accountId: log216.accountId,
    eventCategory: "bid_adjustment",
    actionType: log216.actionType === "increase" ? "bid_increase" : log216.actionType === "decrease" ? "bid_decrease" : "bid_set",
    campaignId: log216.campaignId,
    internalAdGroupId: log216.internalAdGroupId,
    keywordId: log216.targetId,
    targetName: log216.targetName,
    previousBid: log216.previousBid,
    newBid: log216.newBid,
    bidChangePercent: log216.bidChangePercent,
    changeReason: log216.reason,
    status: log216.executionStatus === "success" ? "success" : log216.executionStatus === "failed" ? "failed" : "pending",
    apiSyncStatus: log216.executionStatus === "success" ? "synced" : log216.executionStatus === "failed" ? "failed" : "pending",
    apiResponseId: log216.apiResponseId,
    errorMessage: log216.errorMessage,
    sourceTable: "bidding_logs",
    sourceId: log216.id,
    createdAt: log216.createdAt
  }));
  await db.insert(optimizationEvents2).values(events);
  return events.length;
}
async function migrateFromBidAdjustmentHistory(accountId) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const oldRecords = await db.select().from(bidAdjustmentHistory).where(eq(bidAdjustmentHistory.accountId, accountId)).orderBy(desc(bidAdjustmentHistory.appliedAt));
  if (oldRecords.length === 0) return 0;
  const events = oldRecords.map((record2) => ({
    performanceGroupId: record2.performanceGroupId,
    accountId: record2.accountId,
    eventCategory: "bid_adjustment",
    actionType: record2.adjustmentType?.includes("increase") ? "bid_increase" : record2.adjustmentType?.includes("decrease") ? "bid_decrease" : "bid_auto_adjust",
    campaignId: record2.campaignId,
    keywordId: record2.keywordId,
    keywordText: record2.keywordText,
    matchType: record2.matchType,
    previousBid: record2.previousBid,
    newBid: record2.newBid,
    changeReason: record2.adjustmentReason,
    adjustmentType: record2.adjustmentType,
    status: record2.status === "applied" ? "success" : record2.status === "rolled_back" ? "rolled_back" : record2.status === "failed" ? "failed" : "pending",
    apiSyncStatus: record2.status === "applied" ? "synced" : record2.status === "rolled_back" ? "rolled_back" : record2.status === "failed" ? "failed" : "pending",
    expectedProfitIncrease: record2.expectedProfitIncrease,
    actualProfit7D: record2.actualProfit7D,
    actualProfit14D: record2.actualProfit14D,
    actualProfit30D: record2.actualProfit30D,
    actualImpressions7D: record2.actualImpressions7D,
    actualClicks7D: record2.actualClicks7D,
    actualConversions7D: record2.actualConversions7D,
    actualSpend7D: record2.actualSpend7D,
    actualRevenue7D: record2.actualRevenue7D,
    trackingUpdatedAt: record2.trackingUpdatedAt,
    rolledBackAt: record2.rolledBackAt,
    rolledBackBy: record2.rolledBackBy,
    sourceTable: "bid_adjustment_history",
    sourceId: record2.id,
    createdAt: record2.appliedAt
  }));
  await db.insert(optimizationEvents2).values(events);
  return events.length;
}
async function migrateFromOptimizationLogs(performanceGroupId2) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const oldLogs = await db.select().from(optimizationLogs).where(eq(optimizationLogs.performanceGroupId, performanceGroupId2)).orderBy(desc(optimizationLogs.createdAt));
  if (oldLogs.length === 0) return 0;
  const categoryMap = {
    "bid_optimization": "bid_adjustment",
    "placement_optimization": "placement_adjustment",
    "budget_optimization": "budget_adjustment",
    "search_term_optimization": "search_term_action",
    "keyword_management": "keyword_action",
    "campaign_management": "campaign_action",
    "target_management": "target_management",
    "settings": "settings_change"
  };
  const actionTypeMap = {
    "bid_increase": "bid_increase",
    "bid_decrease": "bid_decrease",
    "bid_set": "bid_set",
    "bid_auto_adjust": "bid_auto_adjust",
    "dayparting_bid": "dayparting_bid",
    "budget_increase": "budget_increase",
    "budget_decrease": "budget_decrease",
    "budget_set": "budget_set",
    "budget_adjustment": "budget_adjustment",
    "placement_adjust": "placement_adjust",
    "search_term_harvest": "search_term_harvest",
    "negative_keyword_add": "negative_keyword_add",
    "negative_keyword_remove": "negative_keyword_remove",
    "keyword_create": "keyword_create",
    "target_pause": "target_pause",
    "target_enable": "target_enable",
    "campaign_pause": "campaign_pause",
    "campaign_enable": "campaign_enable",
    "create_target": "create_target",
    "update_target": "update_target",
    "delete_target": "delete_target",
    "pause_target": "pause_target",
    "resume_target": "resume_target",
    "add_campaign": "add_campaign",
    "remove_campaign": "remove_campaign",
    "settings_update": "settings_update",
    "strategy_change": "strategy_change"
  };
  const events = oldLogs.map((log216) => {
    const logData = log216;
    const mappedCategory = categoryMap[String(logData.logCategory || "")] || "settings_change";
    const mappedAction = actionTypeMap[String(logData.actionType || "")] || "settings_update";
    return {
      performanceGroupId: log216.performanceGroupId,
      performanceGroupName: log216.performanceGroupName,
      accountId: log216.accountId,
      accountName: log216.accountName,
      userId: log216.userId,
      userName: log216.userName,
      eventCategory: mappedCategory,
      actionType: mappedAction,
      strategyTemplateId: log216.strategyTemplateId,
      strategyTemplateName: log216.strategyTemplateName,
      campaignId: log216.campaignId,
      campaignName: log216.campaignName,
      previousValue: log216.previousValue,
      newValue: log216.newValue,
      changeReason: log216.changeReason,
      actionDetail: log216.actionDetail,
      status: log216.status || "success",
      apiSyncStatus: log216.apiSyncStatus,
      apiSyncDetail: log216.apiSyncDetail,
      errorMessage: log216.errorMessage,
      sourceTable: "optimization_logs",
      sourceId: log216.id,
      createdAt: log216.createdAt,
      executedAt: log216.executedAt
    };
  });
  const batchSize = 500;
  let migrated = 0;
  for (let i = 0; i < events.length; i += batchSize) {
    const batch = events.slice(i, i + batchSize);
    await db.insert(optimizationEvents2).values(batch);
    migrated += batch.length;
  }
  return migrated;
}
async function runAutoMigration() {
  const db = await getDb();
  if (!db) return { success: false, migrated: {}, skipped: ["Database not available"] };
  const migrated = {};
  const skipped = [];
  try {
    const existingMigrations = await db.select({
      sourceTable: optimizationEvents2.sourceTable,
      count: sql`count(*)`
    }).from(optimizationEvents2).where(sql`${optimizationEvents2.sourceTable} IS NOT NULL`).groupBy(optimizationEvents2.sourceTable);
    const migratedSources = new Set(existingMigrations.map((m) => m.sourceTable));
    if (migratedSources.has("bidding_logs")) {
      skipped.push("bidding_logs (already migrated)");
    } else {
      try {
        const accounts = await getAdAccounts();
        let totalBiddingLogs = 0;
        for (const account of accounts) {
          totalBiddingLogs += await migrateFromBiddingLogs(account.id);
        }
        migrated.biddingLogs = totalBiddingLogs;
      } catch (err) {
        log17.warn("[AutoMigration] bidding_logs migration error:", err.message);
        skipped.push(`bidding_logs (error: ${err.message})`);
      }
    }
    if (migratedSources.has("bid_adjustment_history")) {
      skipped.push("bid_adjustment_history (already migrated)");
    } else {
      try {
        const accounts = await getAdAccounts();
        let totalBidHistory = 0;
        for (const account of accounts) {
          totalBidHistory += await migrateFromBidAdjustmentHistory(account.id);
        }
        migrated.bidAdjustmentHistory = totalBidHistory;
      } catch (err) {
        log17.warn("[AutoMigration] bid_adjustment_history migration error:", err.message);
        skipped.push(`bid_adjustment_history (error: ${err.message})`);
      }
    }
    if (migratedSources.has("optimization_logs")) {
      skipped.push("optimization_logs (already migrated)");
    } else {
      try {
        const accounts = await getAdAccounts();
        let totalOptLogs = 0;
        for (const account of accounts) {
          const groups = await getPerformanceGroupsByAccountId(account.id);
          for (const group of groups) {
            totalOptLogs += await migrateFromOptimizationLogs(group.id);
          }
        }
        migrated.optimizationLogs = totalOptLogs;
      } catch (err) {
        log17.warn("[AutoMigration] optimization_logs migration error:", err.message);
        skipped.push(`optimization_logs (error: ${err.message})`);
      }
    }
    const totalMigrated = Object.values(migrated).reduce((a, b) => a + b, 0);
    log17.info(`[AutoMigration] \u5B8C\u6210: \u5171\u8FC1\u79FB ${totalMigrated} \u6761\u8BB0\u5F55`, { migrated, skipped });
    return { success: true, migrated, skipped };
  } catch (err) {
    log17.warn("[AutoMigration] \u5168\u5C40\u8FC1\u79FB\u5931\u8D25:", err.message);
    return { success: false, migrated, skipped: [...skipped, err.message] };
  }
}
var log17;
var init_optimizationEvents = __esm({
  "server/db/optimizationEvents.ts"() {
    "use strict";
    init_drizzle_orm();
    init_schema2();
    init_connection();
    init_logger();
    init_idTypes();
    init_accounts();
    log17 = createModuleLogger("DB:optimizationEvents");
    __name(createOptimizationLog, "createOptimizationLog");
    __name(getOptimizationLogs, "getOptimizationLogs");
    __name(getOptimizationLogStats, "getOptimizationLogStats");
    __name(batchCreateOptimizationLogs, "batchCreateOptimizationLogs");
    __name(insertOptimizationEvent, "insertOptimizationEvent");
    __name(batchInsertOptimizationEvents, "batchInsertOptimizationEvents");
    __name(getOptimizationEvents, "getOptimizationEvents");
    __name(getOptimizationEventStats, "getOptimizationEventStats");
    __name(getBidAdjustmentEvents, "getBidAdjustmentEvents");
    __name(rollbackOptimizationEvent, "rollbackOptimizationEvent");
    __name(updateOptimizationEventTracking, "updateOptimizationEventTracking");
    __name(migrateFromBiddingLogs, "migrateFromBiddingLogs");
    __name(migrateFromBidAdjustmentHistory, "migrateFromBidAdjustmentHistory");
    __name(migrateFromOptimizationLogs, "migrateFromOptimizationLogs");
    __name(runAutoMigration, "runAutoMigration");
  }
});

