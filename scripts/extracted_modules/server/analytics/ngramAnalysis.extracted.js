// Extracted from production dist/index.js
// Original module: server/analytics/ngramAnalysis.ts
// Lines: 384

var ngramAnalysis_exports = {};
__export(ngramAnalysis_exports, {
  NGRAM_CONFIG: () => NGRAM_CONFIG,
  analyzeSearchTermNgrams: () => analyzeSearchTermNgrams,
  executeNegativeKeywords: () => executeNegativeKeywords,
  generateNegativeKeywordSuggestions: () => generateNegativeKeywordSuggestions,
  generateNgramAnalysisReport: () => generateNgramAnalysisReport,
  generateNgrams: () => generateNgrams,
  getCoreKeywordRoots: () => getCoreKeywordRoots,
  getNgramAnalysisSummary: () => getNgramAnalysisSummary,
  tokenize: () => tokenize
});
function tokenize(text2) {
  return text2.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((word) => word.length >= 2 && !NGRAM_CONFIG.STOP_WORDS.has(word));
}
function generateNgrams(tokens, n) {
  const ngrams = [];
  for (let i = 0; i <= tokens.length - n; i++) {
    ngrams.push(tokens.slice(i, i + n).join(" "));
  }
  return ngrams;
}
async function getCoreKeywordRoots(accountId, campaignIds) {
  const db = await getDb();
  if (!db) return /* @__PURE__ */ new Set();
  const conditions = [eq(keywords.accountId, accountId)];
  if (campaignIds && campaignIds.length > 0) {
    conditions.push(inArray(keywords.campaignId, campaignIds.map(String)));
  }
  const result = await db.selectDistinct({ keywordText: keywords.keywordText }).from(keywords).where(and(...conditions));
  const rows = result || [];
  const coreRoots = /* @__PURE__ */ new Set();
  for (const row of rows) {
    const tokens = tokenize(row.keywordText || "");
    tokens.forEach((token) => coreRoots.add(token));
  }
  return coreRoots;
}
async function analyzeSearchTermNgrams(accountId, campaignIds, days = 30) {
  const db = await getDb();
  if (!db) return /* @__PURE__ */ new Map();
  const startDate = /* @__PURE__ */ new Date();
  startDate.setDate(startDate.getDate() - days);
  const startDateStr = startDate.toISOString().split("T")[0];
  const coreRoots = await getCoreKeywordRoots(accountId, campaignIds);
  const stConditions = [
    eq(searchTerms.accountId, accountId),
    gte(searchTerms.reportStartDate, startDateStr)
  ];
  if (campaignIds && campaignIds.length > 0) {
    stConditions.push(inArray(searchTerms.campaignId, campaignIds.map(String)));
  }
  const searchTermResult = await db.select({
    searchTerm: searchTerms.searchTerm,
    impressions: sql`SUM(${searchTerms.searchTermImpressions})`,
    clicks: sql`SUM(${searchTerms.searchTermClicks})`,
    spend: sql`SUM(${searchTerms.searchTermSpend})`,
    sales: sql`SUM(${searchTerms.searchTermSales})`,
    orders: sql`SUM(${searchTerms.searchTermOrders})`
    // @ts-ignore
  }).from(searchTerms).where(and(...stConditions)).groupBy(searchTerms.searchTerm);
  const searchTermData = searchTermResult || [];
  const ngramStats = /* @__PURE__ */ new Map();
  for (const row of searchTermData) {
    const tokens = tokenize(row.searchTerm || row.search_term || "");
    for (let n = 1; n <= NGRAM_CONFIG.MAX_NGRAM_LENGTH; n++) {
      const ngrams = generateNgrams(tokens, n);
      for (const ngram of ngrams) {
        const ngramTokens = ngram.split(" ");
        if (ngramTokens.some((t2) => coreRoots.has(t2))) {
          continue;
        }
        const existing = ngramStats.get(ngram) || {
          frequency: 0,
          totalClicks: 0,
          totalSpend: 0,
          totalOrders: 0,
          totalSales: 0,
          totalImpressions: 0,
          searchTerms: /* @__PURE__ */ new Set()
          // @ts-ignore
        };
        existing.frequency++;
        existing.totalClicks += Number(row.clicks) || 0;
        existing.totalSpend += Number(row.spend) || 0;
        existing.totalOrders += Number(row.orders) || 0;
        existing.totalSales += Number(row.sales) || 0;
        existing.totalImpressions += Number(row.impressions) || 0;
        existing.searchTerms.add(row.searchTerm || row.search_term);
        ngramStats.set(ngram, existing);
      }
    }
  }
  const analysisResults = /* @__PURE__ */ new Map();
  for (const [ngram, stats4] of Array.from(ngramStats.entries())) {
    if (stats4.frequency < NGRAM_CONFIG.MIN_FREQUENCY) continue;
    if (stats4.totalSpend < NGRAM_CONFIG.MIN_SPEND) continue;
    const avgCtr = stats4.totalImpressions > 0 ? stats4.totalClicks / stats4.totalImpressions * 100 : 0;
    const avgCvr = stats4.totalClicks > 0 ? stats4.totalOrders / stats4.totalClicks * 100 : 0;
    const acos = stats4.totalSales > 0 ? stats4.totalSpend / stats4.totalSales * 100 : Infinity;
    const roas = stats4.totalSpend > 0 ? stats4.totalSales / stats4.totalSpend : 0;
    let isNegativeCandidate = false;
    let reason = "";
    let priority = "low";
    if (NGRAM_CONFIG.COMMON_NEGATIVE_ROOTS.has(ngram)) {
      isNegativeCandidate = true;
      reason = "\u5E38\u89C1\u65E0\u6548\u8BCD\u6839";
      priority = "high";
    } else if (stats4.totalOrders === 0 && stats4.totalSpend >= NGRAM_CONFIG.MIN_SPEND * 2) {
      isNegativeCandidate = true;
      reason = `\u9AD8\u82B1\u8D39\u96F6\u8F6C\u5316 (\u82B1\u8D39$${stats4.totalSpend.toFixed(2)}, 0\u8BA2\u5355)`;
      priority = "high";
    } else if (avgCvr < 1 && acos > 100) {
      isNegativeCandidate = true;
      reason = `\u4F4E\u8F6C\u5316\u9AD8ACoS (CVR ${avgCvr.toFixed(2)}%, ACoS ${acos.toFixed(0)}%)`;
      priority = "medium";
    } else if (acos > 50 && stats4.totalOrders < 3) {
      isNegativeCandidate = true;
      reason = `\u8868\u73B0\u4E0D\u4F73 (ACoS ${acos.toFixed(0)}%, ${stats4.totalOrders}\u8BA2\u5355)`;
      priority = "low";
    }
    const matchType = ngram.split(" ").length > 1 ? "phrase" : "exact";
    analysisResults.set(ngram, {
      ngram,
      frequency: stats4.frequency,
      totalClicks: stats4.totalClicks,
      totalSpend: stats4.totalSpend,
      totalOrders: stats4.totalOrders,
      totalSales: stats4.totalSales,
      avgCtr,
      avgCvr,
      acos,
      roas,
      searchTerms: Array.from(stats4.searchTerms),
      isNegativeCandidate,
      reason,
      matchType,
      priority
    });
  }
  return analysisResults;
}
async function generateNegativeKeywordSuggestions(accountId, campaignIds, days = 30) {
  const analysisResults = await analyzeSearchTermNgrams(accountId, campaignIds, days);
  const suggestions = [];
  for (const [ngram, result] of Array.from(analysisResults.entries())) {
    if (!result.isNegativeCandidate) continue;
    suggestions.push({
      ngram: result.ngram,
      matchType: result.matchType,
      frequency: result.frequency,
      totalSpend: result.totalSpend,
      totalClicks: result.totalClicks,
      totalOrders: result.totalOrders,
      acos: result.acos,
      reason: result.reason,
      priority: result.priority,
      affectedSearchTerms: result.searchTerms.slice(0, 10),
      // 最多显示10个
      estimatedSavings: result.totalSpend * 0.8
      // 预估节省80%花费
    });
  }
  suggestions.sort((a, b) => {
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    }
    return b.totalSpend - a.totalSpend;
  });
  return suggestions;
}
async function executeNegativeKeywords(accountId, campaignId, adGroupId, negatives) {
  const db = await getDb();
  if (!db) return { success: false, addedCount: 0, errors: ["Database not available"] };
  const errors = [];
  let addedCount = 0;
  for (const negative of negatives) {
    try {
      await db.insert(negativeKeywords).values({
        accountId,
        campaignId,
        adGroupId,
        negativeLevel: adGroupId ? "ad_group" : "campaign",
        negativeType: "keyword",
        negativeText: negative.keyword,
        negativeMatchType: negative.matchType === "phrase" ? "negative_phrase" : "negative_exact",
        negativeSource: "ngram_analysis",
        negativeStatus: "active"
      });
      addedCount++;
    } catch (error48) {
      if (!error48.message?.includes("Duplicate")) {
        errors.push(`\u6DFB\u52A0\u5426\u5B9A\u8BCD "${negative.keyword}" \u5931\u8D25: ${error48.message}`);
      }
    }
  }
  return {
    success: errors.length === 0,
    addedCount,
    errors
  };
}
async function getNgramAnalysisSummary(accountId, campaignIds, days = 30) {
  const analysisResults = await analyzeSearchTermNgrams(accountId, campaignIds, days);
  let totalSearchTerms = 0;
  let negativeCandidates = 0;
  let highPriority = 0;
  let mediumPriority = 0;
  let lowPriority = 0;
  let estimatedSavings = 0;
  const allSearchTerms = /* @__PURE__ */ new Set();
  for (const [_, result] of Array.from(analysisResults.entries())) {
    result.searchTerms.forEach((st) => allSearchTerms.add(st));
    if (result.isNegativeCandidate) {
      negativeCandidates++;
      estimatedSavings += result.totalSpend * 0.8;
      switch (result.priority) {
        case "high":
          highPriority++;
          break;
        case "medium":
          mediumPriority++;
          break;
        case "low":
          lowPriority++;
          break;
      }
    }
  }
  return {
    totalSearchTerms: allSearchTerms.size,
    totalNgrams: analysisResults.size,
    negativeCandidates,
    highPriority,
    mediumPriority,
    lowPriority,
    estimatedSavings
  };
}
async function generateNgramAnalysisReport(accountId, campaignIds, days = 30) {
  const summary = await getNgramAnalysisSummary(accountId, campaignIds, days);
  const suggestions = await generateNegativeKeywordSuggestions(accountId, campaignIds, days);
  const analysisResults = await analyzeSearchTermNgrams(accountId, campaignIds, days);
  const coreRoots = await getCoreKeywordRoots(accountId, campaignIds);
  const topWastefulNgrams = Array.from(analysisResults.values()).filter((r) => r.totalOrders === 0 || r.acos > 50).sort((a, b) => b.totalSpend - a.totalSpend).slice(0, 20);
  return {
    summary,
    suggestions: suggestions.slice(0, 50),
    // 最多50条建议
    topWastefulNgrams,
    coreRootsExcluded: Array.from(coreRoots).slice(0, 100)
    // 最多显示100个核心词根
  };
}
var NGRAM_CONFIG;
var init_ngramAnalysis = __esm({
  "server/analytics/ngramAnalysis.ts"() {
    "use strict";
    init_db2();
    init_schema2();
    init_drizzle_orm();
    NGRAM_CONFIG = {
      // 频率阈值（减半后的值）
      MIN_FREQUENCY: 25,
      // 词根最小出现频率
      MIN_SPEND: 12.5,
      // 词根最小花费阈值（美元）
      // 分析参数
      MIN_NGRAM_LENGTH: 2,
      // 最小N-Gram长度
      MAX_NGRAM_LENGTH: 3,
      // 最大N-Gram长度（1=单词, 2=双词组合, 3=三词组合）
      // 停用词列表（不参与分析的常见词）
      STOP_WORDS: /* @__PURE__ */ new Set([
        "a",
        "an",
        "the",
        "and",
        "or",
        "but",
        "in",
        "on",
        "at",
        "to",
        "for",
        "of",
        "with",
        "by",
        "from",
        "as",
        "is",
        "was",
        "are",
        "were",
        "been",
        "be",
        "have",
        "has",
        "had",
        "do",
        "does",
        "did",
        "will",
        "would",
        "could",
        "should",
        "may",
        "might",
        "must",
        "shall",
        "can",
        "need",
        "dare",
        "ought",
        "used",
        "it",
        "its",
        "this",
        "that",
        "these",
        "those",
        "i",
        "you",
        "he",
        "she",
        "we",
        "they",
        "me",
        "him",
        "her",
        "us",
        "them",
        "my",
        "your",
        "his",
        "her",
        "our",
        "their",
        "mine",
        "yours",
        "hers",
        "ours",
        "theirs"
      ]),
      // 常见无效词根（默认否定候选）
      COMMON_NEGATIVE_ROOTS: /* @__PURE__ */ new Set([
        "free",
        "cheap",
        "discount",
        "used",
        "repair",
        "fix",
        "broken",
        "diy",
        "homemade",
        "alternative",
        "substitute",
        "knock off",
        "fake",
        "counterfeit",
        "replica",
        "imitation",
        "wholesale",
        "bulk",
        "sample",
        "trial",
        "demo",
        "test",
        "review",
        "comparison"
      ])
    };
    __name(tokenize, "tokenize");
    __name(generateNgrams, "generateNgrams");
    __name(getCoreKeywordRoots, "getCoreKeywordRoots");
    __name(analyzeSearchTermNgrams, "analyzeSearchTermNgrams");
    __name(generateNegativeKeywordSuggestions, "generateNegativeKeywordSuggestions");
    __name(executeNegativeKeywords, "executeNegativeKeywords");
    __name(getNgramAnalysisSummary, "getNgramAnalysisSummary");
    __name(generateNgramAnalysisReport, "generateNgramAnalysisReport");
  }
});

