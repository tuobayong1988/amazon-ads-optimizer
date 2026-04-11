// Extracted from production dist/index.js
// Original module: server/algorithm/algorithmEffectService.ts
// Lines: 306

function parseAlgorithmFromDetail(actionDetail, changeReason) {
  if (!actionDetail) return changeReason?.includes("\u89C4\u5219\u5F15\u64CE") ? "rule_engine" : "unknown";
  try {
    const detail = JSON.parse(actionDetail);
    if (detail.algorithmTier) {
      if (detail.algorithmTier === "advanced") {
        const algo = (detail.algorithmUsed || "").toLowerCase();
        if (algo.includes("linucb")) return "LinUCB";
        if (algo.includes("cql")) return "CQL";
        if (algo.includes("ensemble")) return "ensemble";
        if (algo.includes("sigmoid")) return "sigmoid_curve";
        if (algo.includes("ucb")) return "UCB";
        return "advanced";
      }
      if (detail.algorithmTier === "guardrail") return "guardrail";
      if (detail.algorithmTier === "rule_engine") return "rule_engine";
      if (detail.algorithmTier === "conservative") return "conservative";
    }
    if (detail.algorithmUsed) {
      const algo = detail.algorithmUsed.toLowerCase();
      if (algo.includes("linucb") || algo === "linucb") return "LinUCB";
      if (algo.includes("cql") || algo === "cql") return "CQL";
      if (algo.includes("ensemble")) return "ensemble";
      if (algo.includes("sigmoid")) return "sigmoid_curve";
      if (algo.includes("ucb") && algo !== "linucb") return "UCB";
      if (algo.includes("bayesian")) return "Bayesian";
      if (algo.includes("cooldown") || algo.includes("direction")) return "guardrail";
      if (algo.includes("rule") || algo === "rule_engine") return "rule_engine";
      if (algo.includes("conservative")) return "conservative";
      return detail.algorithmUsed;
    }
    const reason = detail.reason || detail.changeReason || "";
    if (reason.includes("[\u9AD8\u7EA7\u7B97\u6CD5:linucb]") || reason.includes("LinUCB")) return "LinUCB";
    if (reason.includes("[\u9AD8\u7EA7\u7B97\u6CD5:cql]") || reason.includes("CQL")) return "CQL";
    if (reason.includes("[\u9AD8\u7EA7\u7B97\u6CD5:ensemble]")) return "ensemble";
    if (reason.includes("[\u9AD8\u7EA7\u7B97\u6CD5:sigmoid]")) return "sigmoid_curve";
    if (reason.includes("[\u9AD8\u7EA7\u7B97\u6CD5:ucb]")) return "UCB";
    if (reason.includes("[\u9AD8\u7EA7\u7B97\u6CD5:bayesian]")) return "Bayesian";
    if (reason.includes("[\u9AD8\u7EA7\u7B97\u6CD5")) return "advanced";
    if (reason.includes("[\u51B7\u5374\u4FDD\u62A4]") || reason.includes("[\u65B9\u5411\u4FDD\u62A4]") || reason.includes("\u62A4\u680F\u4FDD\u62A4")) return "guardrail";
    if (reason.includes("[\u89C4\u5219\u5F15\u64CE]")) return "rule_engine";
    if (reason.includes("[\u4FDD\u5B88\u7B56\u7565]")) return "conservative";
    return "rule_engine";
  } catch {
    return "unknown";
  }
}
function isPositiveAction(actionDetail, actionType) {
  if (!actionDetail) {
    return actionType === "bid_decrease" || actionType === "bid_increase" || actionType === "bid_auto_adjust";
  }
  try {
    const detail = typeof actionDetail === "string" ? JSON.parse(actionDetail) : actionDetail;
    const changePercent = Math.abs(Number(detail.changePercent || detail.bidChangePercent || 0));
    const acos = Number(detail.acos || detail.keywordAcos || 0);
    const targetAcos = Number(detail.targetAcos || 30);
    const currentBid = Number(detail.currentBid || detail.previousBid || 0);
    const newBid = Number(detail.newBid || 0);
    if (changePercent < 5) return true;
    if (acos > targetAcos && newBid < currentBid) return true;
    if (acos > 0 && acos < targetAcos * 0.8 && newBid > currentBid) return true;
    const sales = Number(detail.sales || detail.keywordSales || 0);
    if (sales > 0 && acos <= targetAcos * 1.2) return true;
    const confidence = Number(detail.confidence || 0);
    if (confidence >= 0.7) return true;
    const algorithm = String(detail.algorithm || detail.selectedAlgorithm || "");
    if (algorithm && (algorithm.includes("cql") || algorithm.includes("linucb") || algorithm.includes("bayesian"))) {
      return true;
    }
    return false;
  } catch {
    return actionType === "bid_decrease" || actionType === "bid_increase" || actionType === "bid_auto_adjust";
  }
}
async function getAlgorithmEffectStats(userId, accountId, startDate, endDate, isAdmin, userAccountIds) {
  const db = await getDb();
  if (!db) throw new Error("Database connection failed");
  // v577: 修复数据隔离 - admin用户不过滤，非admin用户按accountId过滤，无账户时返回空
  const accountFilter = isAdmin ? void 0 : userAccountIds && userAccountIds.length > 0 ? inArray(optimizationEvents2.accountId, userAccountIds) : sql`1=0`;
  const accountFilterLogs = isAdmin ? void 0 : userAccountIds && userAccountIds.length > 0 ? inArray(optimizationLogs.accountId, userAccountIds) : sql`1=0`;
  // v577: 如果指定了accountId，优先使用accountId过滤（覆盖accountFilter）
  const effectiveAccountFilter = accountId ? void 0 : accountFilter;
  const effectiveAccountFilterLogs = accountId ? void 0 : accountFilterLogs;
  try {
    const startStr = startDate ? startDate.toISOString().slice(0, 19).replace("T", " ") : void 0;
    const endStr = endDate ? endDate.toISOString().slice(0, 19).replace("T", " ") : void 0;
    const [totalCountResult] = await db.select({
      totalCount: sql`COUNT(*)`,
      syncedCount: sql`SUM(CASE WHEN ${optimizationEvents2.apiSyncStatus} = 'synced' THEN 1 ELSE 0 END)`
    }).from(optimizationEvents2).where(
      and(
        accountFilter,
        accountId ? eq(optimizationEvents2.accountId, accountId) : void 0,
        inArray(optimizationEvents2.eventCategory, ["bid_adjustment"]),
        inArray(optimizationEvents2.actionType, ["bid_increase", "bid_decrease", "bid_auto_adjust"]),
        startStr ? gte(optimizationEvents2.createdAt, startStr) : void 0,
        endStr ? lte(optimizationEvents2.createdAt, endStr) : void 0,
        sql`${optimizationEvents2.apiSyncStatus} IN ('synced', 'pending', 'failed', 'skipped_unsupported_campaign_type')`
      )
    );
    const realTotalCount = Number(totalCountResult?.totalCount) || 0;
    log182.info(`[v502] \u51C6\u786E\u603B\u64CD\u4F5C\u6570: ${realTotalCount}, \u5DF2\u540C\u6B65: ${totalCountResult?.syncedCount}`);
    if (realTotalCount === 0) {
      log182.info("[algorithmEffectService] v577: optimization_events无bid_adjustment记录, 回退到optimization_logs查询");
      throw new Error("No events found, fallback to logs");
    }
    const bidEvents = await db.select({
      id: optimizationEvents2.id,
      actionType: optimizationEvents2.actionType,
      actionDetail: optimizationEvents2.actionDetail,
      changeReason: optimizationEvents2.changeReason,
      previousBid: optimizationEvents2.previousBid,
      newBid: optimizationEvents2.newBid,
      bidChangePercent: optimizationEvents2.bidChangePercent,
      apiSyncStatus: optimizationEvents2.apiSyncStatus,
      createdAt: optimizationEvents2.createdAt
    }).from(optimizationEvents2).where(
      and(
        accountFilter,
        accountId ? eq(optimizationEvents2.accountId, accountId) : void 0,
        inArray(optimizationEvents2.eventCategory, ["bid_adjustment"]),
        inArray(optimizationEvents2.actionType, ["bid_increase", "bid_decrease", "bid_auto_adjust"]),
        startStr ? gte(optimizationEvents2.createdAt, startStr) : void 0,
        endStr ? lte(optimizationEvents2.createdAt, endStr) : void 0,
        sql`${optimizationEvents2.apiSyncStatus} != 'not_applicable'`
      )
    ).orderBy(desc(optimizationEvents2.createdAt)).limit(1e4);
    const algorithmMap = /* @__PURE__ */ new Map();
    const sampleSize = bidEvents.length;
    for (const event of bidEvents) {
      const algorithm = parseAlgorithmFromDetail(event.actionDetail, event.changeReason);
      const isPositive = isPositiveAction(event.actionDetail, event.actionType);
      const bidChange = Number(event.bidChangePercent) || 0;
      if (!algorithmMap.has(algorithm)) {
        algorithmMap.set(algorithm, { count: 0, positive: 0, totalBidChange: 0 });
      }
      const stats4 = algorithmMap.get(algorithm);
      stats4.count++;
      if (isPositive) stats4.positive++;
      stats4.totalBidChange += bidChange;
    }
    const scaleFactor = sampleSize > 0 ? realTotalCount / sampleSize : 1;
    return Array.from(algorithmMap.entries()).map(([algorithm, stats4]) => ({
      algorithm,
      count: Math.round(stats4.count * scaleFactor),
      // 按比例放大到真实总数
      avgROASChange: 0,
      avgACoSChange: 0,
      avgEffectScore: stats4.count > 0 ? Math.round(stats4.positive / stats4.count * 100) / 100 : 0,
      positiveRate: stats4.count > 0 ? Math.round(stats4.positive / stats4.count * 100) : 0
    }));
  } catch (eventsErr) {
    log182.warn("[algorithmEffectService] v502: optimization_events\u67E5\u8BE2\u5931\u8D25\uFF0C\u56DE\u9000\u5230optimization_logs:", eventsErr.message);
  }
  try {
    const startStr = startDate ? startDate.toISOString().slice(0, 19).replace("T", " ") : void 0;
    const endStr = endDate ? endDate.toISOString().slice(0, 19).replace("T", " ") : void 0;
    const bidLogs = await db.select({
      id: optimizationLogs.id,
      actionType: optimizationLogs.actionType,
      actionDetail: optimizationLogs.actionDetail,
      changeReason: optimizationLogs.changeReason,
      previousValue: optimizationLogs.previousValue,
      newValue: optimizationLogs.newValue,
      apiSyncStatus: optimizationLogs.apiSyncStatus,
      createdAt: optimizationLogs.createdAt
    }).from(optimizationLogs).where(
      and(
        // v482: 基于账户归属的数据隔离（替代之前的userId过滤）
        accountFilterLogs,
        eq(optimizationLogs.logCategory, "bid_adjustment"),
        startStr ? gte(optimizationLogs.createdAt, startStr) : void 0,
        endStr ? lte(optimizationLogs.createdAt, endStr) : void 0
      )
    ).orderBy(desc(optimizationLogs.createdAt)).limit(5e3);
    if (bidLogs.length > 0) {
      const algorithmMap = /* @__PURE__ */ new Map();
      for (const log216 of bidLogs) {
        const algorithm = parseAlgorithmFromDetail(log216.actionDetail, log216.changeReason);
        const isPositive = isPositiveAction(log216.actionDetail, log216.actionType);
        const prevBid = Number(log216.previousValue) || 0;
        const newBid = Number(log216.newValue) || 0;
        const bidChange = prevBid > 0 ? (newBid - prevBid) / prevBid * 100 : 0;
        if (!algorithmMap.has(algorithm)) {
          algorithmMap.set(algorithm, { count: 0, positive: 0, totalBidChange: 0 });
        }
        const stats4 = algorithmMap.get(algorithm);
        stats4.count++;
        if (isPositive) stats4.positive++;
        stats4.totalBidChange += bidChange;
      }
      return Array.from(algorithmMap.entries()).map(([algorithm, stats4]) => ({
        algorithm,
        count: stats4.count,
        avgROASChange: 0,
        avgACoSChange: 0,
        avgEffectScore: stats4.count > 0 ? Math.round(stats4.positive / stats4.count * 100) / 100 : 0,
        positiveRate: stats4.count > 0 ? Math.round(stats4.positive / stats4.count * 100) : 0
      }));
    }
  } catch (logsErr) {
    log182.warn("[algorithmEffectService] v235: optimization_logs\u67E5\u8BE2\u4E5F\u5931\u8D25:", logsErr.message);
  }
  return [];
}
async function getRecentEffectRecords(userId, accountId, limit = 50) {
  const db = await getDb();
  if (!db) throw new Error("Database connection failed");
  return db.select().from(algorithmEffectRecords).where(
    and(
      eq(algorithmEffectRecords.userId, userId),
      accountId ? eq(algorithmEffectRecords.accountId, accountId) : void 0
    )
  ).orderBy(desc(algorithmEffectRecords.optimizationDate)).limit(limit);
}
async function getPendingEffectRecords(userId) {
  const sevenDaysAgo = /* @__PURE__ */ new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const db = await getDb();
  if (!db) throw new Error("Database connection failed");
  return db.select().from(algorithmEffectRecords).where(
    and(
      eq(algorithmEffectRecords.userId, userId),
      sql`${algorithmEffectRecords.effectScore} IS NULL`,
      lte(algorithmEffectRecords.optimizationDate, sevenDaysAgo.toISOString().slice(0, 19).replace("T", " "))
    )
  ).orderBy(algorithmEffectRecords.optimizationDate).limit(100);
}
async function getEffectTrend(userId, accountId, days = 30, isAdmin, userAccountIds) {
  const startDate = /* @__PURE__ */ new Date();
  startDate.setDate(startDate.getDate() - days);
  const startStr = startDate.toISOString().slice(0, 19).replace("T", " ");
  const db = await getDb();
  if (!db) throw new Error("Database connection failed");
  const accountFilter = isAdmin ? void 0 : userAccountIds && userAccountIds.length > 0 ? inArray(optimizationEvents2.accountId, userAccountIds) : sql`1=0`;
  try {
    const results = await db.select({
      date: sql`DATE(${optimizationEvents2.createdAt})`,
      count: sql`COUNT(*)`,
      avgBidChange: sql`AVG(CAST(${optimizationEvents2.bidChangePercent} AS DECIMAL(10,2)))`,
      positiveCount: sql`SUM(CASE WHEN ${optimizationEvents2.actionType} = 'bid_decrease' THEN 1 ELSE 0 END)`
    }).from(optimizationEvents2).where(
      and(
        accountFilter,
        accountId ? eq(optimizationEvents2.accountId, accountId) : void 0,
        inArray(optimizationEvents2.eventCategory, ["bid_adjustment"]),
        inArray(optimizationEvents2.actionType, ["bid_increase", "bid_decrease", "bid_auto_adjust"]),
        gte(optimizationEvents2.createdAt, startStr),
        sql`${optimizationEvents2.apiSyncStatus} != 'not_applicable'`
      )
    ).groupBy(sql`DATE(${optimizationEvents2.createdAt})`).orderBy(sql`DATE(${optimizationEvents2.createdAt})`);
    return results.map((row) => ({
      date: String(row.date),
      // @ts-ignore
      avgEffectScore: row.count > 0 ? Math.round(Number(row.positiveCount) / Number(row.count) * 100) / 100 : 0,
      avgROASChange: 0,
      avgACoSChange: Number(row.avgBidChange) || 0,
      count: Number(row.count)
    }));
  } catch (err) {
    log182.warn("[algorithmEffectService] v235: getEffectTrend from optimization_events failed:", err.message);
  }
  try {
    const results = await db.select({
      date: sql`DATE(${algorithmEffectRecords.optimizationDate})`,
      avgEffectScore: sql`AVG(CAST(${algorithmEffectRecords.effectScore} AS DECIMAL(10,2)))`,
      avgROASChange: sql`AVG(CAST(${algorithmEffectRecords.roasChange} AS DECIMAL(10,2)))`,
      avgACoSChange: sql`AVG(CAST(${algorithmEffectRecords.acosChange} AS DECIMAL(10,2)))`,
      count: sql`COUNT(*)`
    }).from(algorithmEffectRecords).where(
      and(
        eq(algorithmEffectRecords.userId, userId),
        accountId ? eq(algorithmEffectRecords.accountId, accountId) : void 0,
        gte(algorithmEffectRecords.optimizationDate, startStr),
        sql`${algorithmEffectRecords.effectScore} IS NOT NULL`
      )
    ).groupBy(sql`DATE(${algorithmEffectRecords.optimizationDate})`).orderBy(sql`DATE(${algorithmEffectRecords.optimizationDate})`);
    return results.map((row) => ({
      date: String(row.date),
      avgEffectScore: Number(row.avgEffectScore) || 0,
      avgROASChange: Number(row.avgROASChange) || 0,
      avgACoSChange: Number(row.avgACoSChange) || 0,
      count: Number(row.count)
    }));
  } catch {
    return [];
  }
}
var log182;
var init_algorithmEffectService = __esm({
  "server/algorithm/algorithmEffectService.ts"() {
    "use strict";
    init_logger();
    init_db2();
    init_schema2();
    init_drizzle_orm();
    log182 = createModuleLogger("AlgorithmEffectService");
    __name(parseAlgorithmFromDetail, "parseAlgorithmFromDetail");
    __name(isPositiveAction, "isPositiveAction");
    __name(getAlgorithmEffectStats, "getAlgorithmEffectStats");
    __name(getRecentEffectRecords, "getRecentEffectRecords");
    __name(getPendingEffectRecords, "getPendingEffectRecords");
    __name(getEffectTrend, "getEffectTrend");
  }
});

