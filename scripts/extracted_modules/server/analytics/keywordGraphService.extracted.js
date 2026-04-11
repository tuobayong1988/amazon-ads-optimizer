// Extracted from production dist/index.js
// Original module: server/analytics/keywordGraphService.ts
// Lines: 192

async function getDbInstance9() {
  const db = await getDb();
  if (!db) throw new Error("Database connection failed");
  return db;
}
async function buildKeywordGraph(accountId) {
  const db = await getDbInstance9();
  const result = { nodes: 0, edges: 0, opportunities: 0, negatives: 0 };
  try {
    const searchTermData = await db.select({
      id: searchTerms.id,
      keywordId: searchTerms.searchTermTargetId,
      keywordText: searchTerms.targetText,
      searchTerm: searchTerms.searchTerm,
      impressions: searchTerms.searchTermImpressions,
      clicks: searchTerms.searchTermClicks,
      orders: searchTerms.searchTermOrders,
      spend: searchTerms.searchTermSpend,
      sales: searchTerms.searchTermSales
    }).from(searchTerms).where(eq(searchTerms.accountId, accountId)).limit(5e3);
    if (searchTermData.length === 0) return result;
    const edges = [];
    const uniqueSearchTerms = /* @__PURE__ */ new Map();
    const keywordToSearchTerms = /* @__PURE__ */ new Map();
    for (const st of searchTermData) {
      const searchTerm = st.searchTerm || "";
      const keywordText = st.keywordText || "";
      edges.push({
        sourceId: keywordText,
        targetId: searchTerm,
        edgeType: "triggers",
        weight: Number(st.clicks) || 0,
        sharedImpressions: Number(st.impressions) || 0,
        sharedClicks: Number(st.clicks) || 0,
        sharedOrders: Number(st.orders) || 0
      });
      const existing = uniqueSearchTerms.get(searchTerm) || { impressions: 0, clicks: 0, orders: 0, spend: 0, sales: 0 };
      existing.impressions += Number(st.impressions) || 0;
      existing.clicks += Number(st.clicks) || 0;
      existing.orders += Number(st.orders) || 0;
      existing.spend += Number(st.spend) || 0;
      existing.sales += Number(st.sales) || 0;
      uniqueSearchTerms.set(searchTerm, existing);
      const stList = keywordToSearchTerms.get(keywordText) || [];
      stList.push(searchTerm);
      keywordToSearchTerms.set(keywordText, stList);
    }
    result.edges = edges.length;
    result.nodes = uniqueSearchTerms.size + keywordToSearchTerms.size;
    const batchSize = 100;
    const edgeValues = edges.slice(0, 2e3);
    for (let i = 0; i < edgeValues.length; i += batchSize) {
      const batch = edgeValues.slice(i, i + batchSize);
      await db.insert(keywordSemanticGraph).values(
        // @ts-expect-error - array method type inference
        batch.map((e) => ({
          accountId,
          sourceNodeType: "keyword",
          sourceNodeId: e.sourceId,
          targetNodeType: "search_term",
          targetNodeId: e.targetId,
          edgeType: e.edgeType,
          edgeWeight: String(e.weight),
          sharedImpressions: e.sharedImpressions,
          sharedClicks: e.sharedClicks,
          sharedOrders: e.sharedOrders,
          isOpportunity: 0,
          isNegativeCandidate: 0
        }))
      );
    }
    log50.info(`[KeywordGraph] Built graph: ${result.nodes} nodes, ${result.edges} edges`);
    return result;
  } catch (error48) {
    log50.warn(`[KeywordGraph] Error building graph:`, error48);
    return result;
  }
}
async function discoverOpportunities(accountId) {
  const db = await getDbInstance9();
  const opportunities = [];
  try {
    const convertingSearchTerms = await db.select({
      searchTerm: searchTerms.searchTerm,
      totalImpressions: sql`SUM(search_term_impressions)`,
      totalClicks: sql`SUM(search_term_clicks)`,
      totalOrders: sql`SUM(search_term_orders)`,
      totalSpend: sql`SUM(CAST(search_term_spend AS DECIMAL(10,2)))`,
      totalSales: sql`SUM(CAST(search_term_sales AS DECIMAL(10,2)))`
    }).from(searchTerms).where(eq(searchTerms.accountId, accountId)).groupBy(searchTerms.searchTerm).having(sql`SUM(search_term_orders) >= 2`).orderBy(desc(sql`SUM(search_term_orders)`)).limit(200);
    const existingKeywords = await db.select({
      keywordText: keywords.keywordText
    }).from(keywords).innerJoin(adGroups, eq(keywords.internalAdGroupId, adGroups.id)).innerJoin(campaigns, eq(adGroups.campaignId, campaigns.campaignId)).where(and(
      eq(campaigns.accountId, accountId),
      eq(keywords.keywordStatus, "enabled")
    ));
    const existingSet = new Set(existingKeywords.map((k) => (k.keywordText || "").toLowerCase()));
    for (const st of convertingSearchTerms) {
      const term = (st.searchTerm || "").toLowerCase();
      if (existingSet.has(term)) continue;
      const clicks = Number(st.totalClicks) || 0;
      const orders = Number(st.totalOrders) || 0;
      const spend = Number(st.totalSpend) || 0;
      const sales = Number(st.totalSales) || 0;
      const cvr = clicks > 0 ? orders / clicks : 0;
      const acos = sales > 0 ? spend / sales : 1;
      if (acos > 0.4) continue;
      const suggestedBid = clicks > 0 ? spend / clicks * 0.9 : 0.5;
      const wordCount = term.split(" ").length;
      opportunities.push({
        searchTerm: st.searchTerm || "",
        impressions: Number(st.totalImpressions) || 0,
        clicks,
        orders,
        cvr,
        acos,
        suggestedMatchType: wordCount >= 4 ? "exact" : wordCount >= 2 ? "phrase" : "broad",
        suggestedBid: Math.round(suggestedBid * 100) / 100,
        confidence: Math.min(1, orders / 5),
        reason: `${orders}\u4E2A\u8F6C\u5316, CVR=${(cvr * 100).toFixed(1)}%, ACOS=${(acos * 100).toFixed(1)}%`
      });
    }
    for (const opp of opportunities.slice(0, 50)) {
      await db.update(keywordSemanticGraph).set({ isOpportunity: 1 }).where(and(
        eq(keywordSemanticGraph.accountId, accountId),
        eq(keywordSemanticGraph.targetNodeId, opp.searchTerm)
      ));
    }
    return opportunities;
  } catch (error48) {
    log50.warn(`[KeywordGraph] Error discovering opportunities:`, error48);
    return opportunities;
  }
}
async function discoverNegativeCandidates(accountId) {
  const db = await getDbInstance9();
  const candidates = [];
  try {
    const wastefulTerms = await db.select({
      searchTerm: searchTerms.searchTerm,
      totalImpressions: sql`SUM(search_term_impressions)`,
      totalClicks: sql`SUM(search_term_clicks)`,
      totalOrders: sql`SUM(search_term_orders)`,
      totalSpend: sql`SUM(CAST(search_term_spend AS DECIMAL(10,2)))`,
      totalSales: sql`SUM(CAST(search_term_sales AS DECIMAL(10,2)))`
    }).from(searchTerms).where(eq(searchTerms.accountId, accountId)).groupBy(searchTerms.searchTerm).having(sql`SUM(search_term_clicks) >= 10 AND SUM(search_term_orders) = 0`).orderBy(desc(sql`SUM(CAST(search_term_spend AS DECIMAL(10,2)))`)).limit(100);
    for (const st of wastefulTerms) {
      const clicks = Number(st.totalClicks) || 0;
      const spend = Number(st.totalSpend) || 0;
      const term = st.searchTerm || "";
      const wordCount = term.split(" ").length;
      candidates.push({
        searchTerm: term,
        impressions: Number(st.totalImpressions) || 0,
        clicks,
        spend,
        orders: 0,
        acos: Infinity,
        suggestedLevel: wordCount <= 2 ? "campaign" : "ad_group",
        suggestedMatchType: wordCount >= 3 ? "negative_exact" : "negative_phrase",
        reason: `${clicks}\u6B21\u70B9\u51FB, $${spend.toFixed(2)}\u82B1\u8D39, 0\u8F6C\u5316`
      });
    }
    for (const neg of candidates.slice(0, 50)) {
      await db.update(keywordSemanticGraph).set({ isNegativeCandidate: 1 }).where(and(
        eq(keywordSemanticGraph.accountId, accountId),
        eq(keywordSemanticGraph.targetNodeId, neg.searchTerm)
      ));
    }
    return candidates;
  } catch (error48) {
    log50.warn(`[KeywordGraph] Error discovering negatives:`, error48);
    return candidates;
  }
}
var import_openai, log50;
var init_keywordGraphService = __esm({
  "server/analytics/keywordGraphService.ts"() {
    "use strict";
    init_logger();
    init_db2();
    init_schema2();
    init_drizzle_orm();
    import_openai = __toESM(require("openai"));
    log50 = createModuleLogger("KeywordGraphService");
    __name(getDbInstance9, "getDbInstance");
    __name(buildKeywordGraph, "buildKeywordGraph");
    __name(discoverOpportunities, "discoverOpportunities");
    __name(discoverNegativeCandidates, "discoverNegativeCandidates");
  }
});

