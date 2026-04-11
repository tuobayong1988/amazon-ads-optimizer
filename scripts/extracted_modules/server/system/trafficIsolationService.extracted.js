// Extracted from production dist/index.js
// Original module: server/system/trafficIsolationService.ts
// Lines: 558

function tokenize3(text2) {
  const cleaned = text2.toLowerCase().replace(/[^a-z0-9\s]/g, " ").trim();
  const words = cleaned.split(/\s+/).filter((w) => w.length > 1);
  return words.filter((w) => !TRAFFIC_ISOLATION_CONFIG.ngram.stopWords.includes(w));
}
function generateNGrams(tokens, n) {
  const ngrams = [];
  for (let i = 0; i <= tokens.length - n; i++) {
    ngrams.push(tokens.slice(i, i + n).join(" "));
  }
  return ngrams;
}
async function runNGramAnalysis(accountId, startDate, endDate, options) {
  const db = await getDb();
  if (!db) {
    return { accountId, analysisDate: /* @__PURE__ */ new Date(), totalSearchTermsAnalyzed: 0, totalTokensExtracted: 0, highRiskTokens: [], mediumRiskTokens: [], suggestedNegatives: [] };
  }
  const minFrequency = options?.minFrequency || TRAFFIC_ISOLATION_CONFIG.ngram.minFrequency;
  const searchTermData = await db.select({
    searchTerm: searchTerms.searchTerm,
    clicks: searchTerms.searchTermClicks,
    conversions: searchTerms.searchTermOrders,
    spend: searchTerms.searchTermSpend,
    sales: searchTerms.searchTermSales
  }).from(searchTerms).where(and(
    eq(searchTerms.accountId, accountId),
    gte(searchTerms.reportStartDate, startDate.toISOString()),
    lte(searchTerms.reportEndDate, endDate.toISOString()),
    // 默认只分析有点击但无转化的搜索词
    options?.includeConvertingTerms ? sql`1=1` : sql`${searchTerms.searchTermClicks} > 0 AND ${searchTerms.searchTermOrders} = 0`
  ));
  const tokenStats = /* @__PURE__ */ new Map();
  for (const term of searchTermData) {
    const tokens = tokenize3(term.searchTerm);
    for (const token of tokens) {
      const stats4 = tokenStats.get(token) || {
        frequency: 0,
        totalClicks: 0,
        totalSpend: 0,
        totalConversions: 0,
        searchTerms: /* @__PURE__ */ new Set()
      };
      stats4.frequency++;
      stats4.totalClicks += term.clicks || 0;
      stats4.totalSpend += Number(term.spend) || 0;
      stats4.totalConversions += term.conversions || 0;
      stats4.searchTerms.add(term.searchTerm);
      tokenStats.set(token, stats4);
    }
    const bigrams = generateNGrams(tokens, 2);
    for (const bigram of bigrams) {
      const stats4 = tokenStats.get(bigram) || {
        frequency: 0,
        totalClicks: 0,
        totalSpend: 0,
        totalConversions: 0,
        searchTerms: /* @__PURE__ */ new Set()
      };
      stats4.frequency++;
      stats4.totalClicks += term.clicks || 0;
      stats4.totalSpend += Number(term.spend) || 0;
      stats4.totalConversions += term.conversions || 0;
      stats4.searchTerms.add(term.searchTerm);
      tokenStats.set(bigram, stats4);
    }
  }
  const allTokens = [];
  tokenStats.forEach((stats4, token) => {
    if (stats4.frequency < minFrequency) return;
    const cvr = stats4.totalClicks > 0 ? stats4.totalConversions / stats4.totalClicks : 0;
    const isMultiWord = token.includes(" ");
    const frequencyScore = Math.min(stats4.frequency / TRAFFIC_ISOLATION_CONFIG.ngram.highRiskFrequency, 1);
    const clickScore = Math.min(stats4.totalClicks / 100, 1);
    const cvrPenalty = cvr > 0 ? 0.5 : 1;
    const confidence = (frequencyScore * 0.4 + clickScore * 0.4 + 0.2) * cvrPenalty;
    let suggestedAction = "monitor";
    if (confidence >= TRAFFIC_ISOLATION_CONFIG.ngram.confidenceThreshold && cvr === 0) {
      suggestedAction = isMultiWord ? "negative_phrase" : "negative_phrase";
    } else if (confidence >= 0.5 && cvr < 0.01) {
      suggestedAction = "monitor";
    }
    allTokens.push({
      // @ts-ignore
      token,
      tokenType: isMultiWord ? "bigram" : "unigram",
      // @ts-ignore
      frequency: stats4.frequency,
      // @ts-ignore
      totalClicks: stats4.totalClicks,
      // @ts-ignore
      totalSpend: stats4.totalSpend,
      // @ts-ignore
      totalConversions: stats4.totalConversions,
      conversionRate: cvr,
      confidence,
      // @ts-ignore
      searchTerms: Array.from(stats4.searchTerms).slice(0, 10),
      // 最多保甹10个示例
      suggestedAction
    });
  });
  allTokens.sort((a, b) => b.confidence - a.confidence);
  const highRiskTokens = allTokens.filter((t2) => t2.confidence >= TRAFFIC_ISOLATION_CONFIG.ngram.confidenceThreshold);
  const mediumRiskTokens = allTokens.filter((t2) => t2.confidence >= 0.5 && t2.confidence < TRAFFIC_ISOLATION_CONFIG.ngram.confidenceThreshold);
  const suggestedNegatives = highRiskTokens.filter((t2) => t2.suggestedAction !== "ignore").map((t2) => ({
    token: t2.token,
    matchType: "negative_phrase",
    reason: `\u51FA\u73B0${t2.frequency}\u6B21\uFF0C${t2.totalClicks}\u6B21\u70B9\u51FB\uFF0C0\u8F6C\u5316\uFF0C\u9884\u8BA1\u53EF\u8282\u7701$${t2.totalSpend.toFixed(2)}`,
    estimatedSavings: t2.totalSpend
  }));
  return {
    accountId,
    analysisDate: /* @__PURE__ */ new Date(),
    totalSearchTermsAnalyzed: searchTermData.length,
    totalTokensExtracted: allTokens.length,
    highRiskTokens,
    mediumRiskTokens,
    suggestedNegatives
  };
}
async function detectTrafficConflicts2(accountId, startDate, endDate) {
  const db = await getDb();
  if (!db) {
    return { accountId, analysisDate: /* @__PURE__ */ new Date(), totalConflicts: 0, totalWastedSpend: 0, conflicts: [], resolutionSuggestions: [] };
  }
  const searchTermData = await db.select({
    searchTerm: searchTerms.searchTerm,
    campaignId: searchTerms.campaignId,
    clicks: searchTerms.searchTermClicks,
    conversions: searchTerms.searchTermOrders,
    spend: searchTerms.searchTermSpend,
    sales: searchTerms.searchTermSales,
    matchType: searchTerms.searchTermMatchType
  }).from(searchTerms).where(and(
    eq(searchTerms.accountId, accountId),
    gte(searchTerms.reportStartDate, startDate.toISOString()),
    lte(searchTerms.reportEndDate, endDate.toISOString()),
    gte(searchTerms.searchTermClicks, TRAFFIC_ISOLATION_CONFIG.conflict.minClicks)
  ));
  const campaignData = await db.select({
    id: campaigns.id,
    campaignId: campaigns.campaignId,
    campaignName: campaigns.campaignName,
    targetingType: campaigns.targetingType
  }).from(campaigns).where(eq(campaigns.accountId, accountId));
  const campaignMap = new Map(campaignData.map((c) => [c.campaignId, c]));
  const searchTermGroups = /* @__PURE__ */ new Map();
  for (const term of searchTermData) {
    const group = searchTermGroups.get(term.searchTerm) || [];
    group.push(term);
    searchTermGroups.set(term.searchTerm, group);
  }
  const conflicts = [];
  let totalWastedSpend = 0;
  searchTermGroups.forEach((terms, searchTerm) => {
    const campaignIds = new Set(terms.map((t2) => t2.campaignId));
    if (campaignIds.size < 2) return;
    const campaignStats = /* @__PURE__ */ new Map();
    for (const term of terms) {
      const stats4 = campaignStats.get(term.campaignId) || {
        clicks: 0,
        conversions: 0,
        spend: 0,
        // @ts-ignore
        sales: 0,
        matchType: term.matchType || "unknown"
      };
      stats4.clicks += term.clicks || 0;
      stats4.conversions += term.conversions || 0;
      stats4.spend += Number(term.spend) || 0;
      stats4.sales += Number(term.sales) || 0;
      campaignStats.set(term.campaignId, stats4);
    }
    const conflictingCampaigns = [];
    campaignStats.forEach((stats4, campaignId) => {
      const campaign = campaignMap.get(campaignId);
      if (!campaign) return;
      const cvr = stats4.clicks > 0 ? stats4.conversions / stats4.clicks : 0;
      const aov = stats4.conversions > 0 ? stats4.sales / stats4.conversions : 0;
      const roas = stats4.spend > 0 ? stats4.sales / stats4.spend : 0;
      const { cvrWeight, aovWeight, roasWeight, dataVolumeWeight } = TRAFFIC_ISOLATION_CONFIG.conflict;
      const normalizedCVR = Math.min(cvr / 0.2, 1);
      const normalizedAOV = Math.min(aov / 100, 1);
      const normalizedROAS = Math.min(roas / 5, 1);
      const normalizedVolume = Math.min(stats4.clicks / 50, 1);
      const score = normalizedCVR * cvrWeight + normalizedAOV * aovWeight + // @ts-ignore
      normalizedROAS * roasWeight + normalizedVolume * dataVolumeWeight;
      conflictingCampaigns.push({
        // @ts-ignore
        campaignId: String(campaignId),
        // @ts-ignore
        campaignName: campaign.campaignName,
        // @ts-ignore
        matchType: stats4.matchType,
        // @ts-ignore
        clicks: stats4.clicks,
        // @ts-ignore
        conversions: stats4.conversions,
        // @ts-ignore
        spend: stats4.spend,
        // @ts-ignore
        sales: stats4.sales,
        cvr,
        // @ts-ignore
        aov,
        roas,
        score
      });
    });
    conflictingCampaigns.sort((a, b) => b.score - a.score);
    const winner = conflictingCampaigns[0];
    const wastedSpend = conflictingCampaigns.slice(1).reduce((sum2, c) => sum2 + c.spend, 0);
    totalWastedSpend += wastedSpend;
    let winnerReason = "";
    if (winner.cvr > 0 && conflictingCampaigns.slice(1).every((c) => c.cvr === 0)) {
      winnerReason = `\u552F\u4E00\u6709\u8F6C\u5316\u7684\u5E7F\u544A\u6D3B\u52A8\uFF08CVR: ${(winner.cvr * 100).toFixed(1)}%\uFF09`;
    } else if (winner.roas > conflictingCampaigns[1]?.roas * 1.5) {
      winnerReason = `ROAS\u663E\u8457\u66F4\u9AD8\uFF08${winner.roas.toFixed(2)} vs ${conflictingCampaigns[1]?.roas.toFixed(2)}\uFF09`;
    } else if (winner.cvr > conflictingCampaigns[1]?.cvr * 1.2) {
      winnerReason = `\u8F6C\u5316\u7387\u66F4\u9AD8\uFF08${(winner.cvr * 100).toFixed(1)}% vs ${(conflictingCampaigns[1]?.cvr * 100).toFixed(1)}%\uFF09`;
    } else {
      winnerReason = `\u7EFC\u5408\u5F97\u5206\u6700\u9AD8\uFF08${winner.score.toFixed(3)}\uFF09`;
    }
    conflicts.push({
      // @ts-ignore
      searchTerm,
      // @ts-ignore
      conflictingCampaigns,
      suggestedWinner: {
        // @ts-ignore
        campaignId: winner.campaignId,
        // @ts-ignore
        campaignName: winner.campaignName,
        reason: winnerReason
      },
      totalWastedSpend: wastedSpend
    });
  });
  conflicts.sort((a, b) => b.totalWastedSpend - a.totalWastedSpend);
  const resolutionSuggestions = conflicts.map((conflict, index2) => ({
    conflictId: index2,
    // @ts-ignore
    searchTerm: conflict.searchTerm,
    // @ts-ignore
    winnerCampaignId: conflict.suggestedWinner.campaignId,
    // @ts-ignore
    negativesToAdd: conflict.conflictingCampaigns.filter((c) => c.campaignId !== conflict.suggestedWinner.campaignId).map((c) => ({
      campaignId: c.campaignId,
      // @ts-ignore
      negativeText: conflict.searchTerm,
      matchType: "negative_exact"
    }))
  }));
  return {
    accountId,
    analysisDate: /* @__PURE__ */ new Date(),
    totalConflicts: conflicts.length,
    totalWastedSpend,
    conflicts,
    // @ts-ignore
    resolutionSuggestions
    // @ts-ignore
  };
}
async function identifyFunnelTiers(accountId) {
  const db = await getDb();
  if (!db) return [];
  const campaignData = await db.select({
    // @ts-ignore
    id: campaigns.id,
    // @ts-ignore
    campaignId: campaigns.campaignId,
    // @ts-ignore
    campaignName: campaigns.campaignName,
    targetingType: campaigns.targetingType
  }).from(campaigns).where(and(
    eq(campaigns.accountId, accountId),
    eq(campaigns.campaignStatus, "enabled")
  ));
  const keywordData = await db.select({
    // @ts-ignore
    campaignId: adGroups.campaignId,
    // @ts-ignore
    matchType: keywords.matchType,
    count: sql`COUNT(*)`
  }).from(keywords).innerJoin(adGroups, eq(keywords.internalAdGroupId, adGroups.id)).innerJoin(campaigns, eq(adGroups.campaignId, campaigns.campaignId)).where(eq(campaigns.accountId, accountId)).groupBy(adGroups.campaignId, keywords.matchType);
  const campaignMatchTypes = /* @__PURE__ */ new Map();
  for (const kw of keywordData) {
    const matchTypes = campaignMatchTypes.get(kw.campaignId) || /* @__PURE__ */ new Map();
    matchTypes.set(kw.matchType || "unknown", kw.count);
    campaignMatchTypes.set(kw.campaignId, matchTypes);
  }
  const tierConfigs = [];
  for (const campaign of campaignData) {
    const matchTypes = campaignMatchTypes.get(campaign.id);
    if (!matchTypes) continue;
    let dominantMatchType = "unknown";
    let maxCount = 0;
    matchTypes.forEach((count11, matchType) => {
      if (count11 > maxCount) {
        maxCount = count11;
        dominantMatchType = matchType;
      }
    });
    let tierLevel;
    if (dominantMatchType === "exact") {
      if (campaign.campaignName.toLowerCase().includes("exact") || // @ts-ignore
      campaign.campaignName.includes("\u7CBE\u51C6") || // @ts-ignore
      campaign.campaignName.includes("core") || // @ts-ignore
      campaign.campaignName.includes("\u6838\u5FC3")) {
        tierLevel = "tier1_exact";
      } else {
        tierLevel = "tier2_longtail";
      }
    } else if (dominantMatchType === "phrase") {
      tierLevel = "tier2_longtail";
    } else {
      tierLevel = "tier3_explore";
    }
    tierConfigs.push({
      // @ts-ignore
      campaignId: campaign.campaignId,
      // @ts-ignore
      campaignName: campaign.campaignName,
      tierLevel,
      matchType: dominantMatchType,
      autoNegativeSync: true
    });
  }
  return tierConfigs;
}
async function syncFunnelNegatives(accountId, tierConfigs) {
  const db = await getDb();
  if (!db) {
    return {
      accountId,
      syncDate: /* @__PURE__ */ new Date(),
      tier1Keywords: [],
      tier2Keywords: [],
      negativesToSync: [],
      totalNegativesToAdd: 0
    };
  }
  const tier1Campaigns = tierConfigs.filter((t2) => t2.tierLevel === "tier1_exact").map((t2) => t2.campaignId);
  const tier2Campaigns = tierConfigs.filter((t2) => t2.tierLevel === "tier2_longtail").map((t2) => t2.campaignId);
  const tier3Campaigns = tierConfigs.filter((t2) => t2.tierLevel === "tier3_explore").map((t2) => t2.campaignId);
  const tier1Keywords = tier1Campaigns.length > 0 ? await db.select({
    keywordText: keywords.keywordText
  }).from(keywords).innerJoin(adGroups, eq(keywords.internalAdGroupId, adGroups.id)).where(and(
    inArray(adGroups.campaignId, tier1Campaigns),
    eq(keywords.keywordStatus, "enabled")
  )) : [];
  const tier2Keywords = tier2Campaigns.length > 0 ? await db.select({
    keywordText: keywords.keywordText
  }).from(keywords).innerJoin(adGroups, eq(keywords.internalAdGroupId, adGroups.id)).where(and(
    inArray(adGroups.campaignId, tier2Campaigns),
    eq(keywords.keywordStatus, "enabled")
  )) : [];
  const existingNegatives = await db.select({
    campaignId: negativeKeywords.campaignId,
    negativeText: negativeKeywords.negativeText
  }).from(negativeKeywords).where(and(
    eq(negativeKeywords.accountId, accountId),
    eq(negativeKeywords.negativeStatus, "active")
  ));
  const existingNegativeMap = /* @__PURE__ */ new Map();
  for (const neg of existingNegatives) {
    const negSet = existingNegativeMap.get(neg.campaignId) || /* @__PURE__ */ new Set();
    negSet.add((neg.negativeText || "").toLowerCase());
    existingNegativeMap.set(neg.campaignId, negSet);
  }
  const negativesToSync = [];
  const tier1KeywordTexts = tier1Keywords.map((k) => k.keywordText.toLowerCase());
  const tier2KeywordTexts = tier2Keywords.map((k) => k.keywordText.toLowerCase());
  for (const campaignId of tier2Campaigns) {
    const existingNegs = existingNegativeMap.get(campaignId) || /* @__PURE__ */ new Set();
    const negatives = tier1KeywordTexts.filter((kw) => !existingNegs.has(kw)).map((kw) => ({
      keyword: kw,
      matchType: "negative_exact",
      sourceTier: "tier1"
    }));
    if (negatives.length > 0) {
      const config2 = tierConfigs.find((t2) => t2.campaignId === campaignId);
      negativesToSync.push({
        // @ts-ignore
        targetCampaignId: String(campaignId),
        targetTier: config2?.tierLevel || "tier2_longtail",
        negatives
      });
    }
  }
  const allUpperTierKeywords = Array.from(/* @__PURE__ */ new Set([...tier1KeywordTexts, ...tier2KeywordTexts]));
  for (const campaignId of tier3Campaigns) {
    const existingNegs = existingNegativeMap.get(campaignId) || /* @__PURE__ */ new Set();
    const negatives = allUpperTierKeywords.filter((kw) => !existingNegs.has(kw)).map((kw) => ({
      keyword: kw,
      matchType: "negative_phrase",
      sourceTier: tier1KeywordTexts.includes(kw) ? "tier1" : "tier2"
    }));
    if (negatives.length > 0) {
      const config2 = tierConfigs.find((t2) => t2.campaignId === campaignId);
      negativesToSync.push({
        // @ts-ignore
        targetCampaignId: String(campaignId),
        targetTier: config2?.tierLevel || "tier3_explore",
        negatives
      });
    }
  }
  return {
    accountId,
    syncDate: /* @__PURE__ */ new Date(),
    tier1Keywords: tier1KeywordTexts,
    tier2Keywords: tier2KeywordTexts,
    negativesToSync,
    // @ts-ignore
    totalNegativesToAdd: negativesToSync.reduce((sum2, n) => sum2 + n.negatives.length, 0)
  };
}
async function getKeywordMigrationSuggestions(accountId, tierConfigs, startDate, endDate) {
  const db = await getDb();
  if (!db) return [];
  const { minConversions, minCVR, minClicks } = TRAFFIC_ISOLATION_CONFIG.migration;
  const tier3Campaigns = tierConfigs.filter((t2) => t2.tierLevel === "tier3_explore");
  if (tier3Campaigns.length === 0) return [];
  const tier3CampaignIds = tier3Campaigns.map((t2) => t2.campaignId);
  const searchTermData = await db.select({
    searchTerm: searchTerms.searchTerm,
    // @ts-ignore
    campaignId: searchTerms.campaignId,
    clicks: searchTerms.searchTermClicks,
    conversions: searchTerms.searchTermOrders,
    spend: searchTerms.searchTermSpend,
    sales: searchTerms.searchTermSales
  }).from(searchTerms).where(and(
    eq(searchTerms.accountId, accountId),
    inArray(searchTerms.campaignId, tier3CampaignIds),
    gte(searchTerms.reportStartDate, startDate.toISOString()),
    lte(searchTerms.reportEndDate, endDate.toISOString()),
    gte(searchTerms.searchTermClicks, minClicks),
    gte(searchTerms.searchTermOrders, minConversions)
  ));
  const tier1Campaigns = tierConfigs.filter((t2) => t2.tierLevel === "tier1_exact");
  const tier1CampaignIds = tier1Campaigns.map((t2) => t2.campaignId);
  const existingExactKeywords = tier1CampaignIds.length > 0 ? await db.select({
    keywordText: keywords.keywordText
  }).from(keywords).innerJoin(adGroups, eq(keywords.internalAdGroupId, adGroups.id)).where(inArray(adGroups.campaignId, tier1CampaignIds)) : [];
  const existingKeywordSet = new Set(existingExactKeywords.map((k) => k.keywordText.toLowerCase()));
  const suggestions = [];
  const campaignMap = new Map(tierConfigs.map((t2) => [t2.campaignId, t2]));
  for (const term of searchTermData) {
    const clicks = term.clicks || 0;
    const cvr = clicks > 0 ? (term.conversions || 0) / clicks : 0;
    if (cvr < minCVR) continue;
    if (existingKeywordSet.has(term.searchTerm.toLowerCase())) continue;
    const sourceCampaign = campaignMap.get(term.campaignId);
    suggestions.push({
      searchTerm: term.searchTerm,
      sourceCampaignId: term.campaignId,
      sourceCampaignName: sourceCampaign?.campaignName || "Unknown",
      sourceTier: "tier3_explore",
      targetTier: "tier1_exact",
      clicks: term.clicks || 0,
      conversions: term.conversions || 0,
      cvr,
      sales: Number(term.sales) || 0,
      // @ts-ignore
      reason: `\u5728\u63A2\u7D22\u5C42\u8868\u73B0\u4F18\u5F02\uFF1A${term.conversions}\u6B21\u8F6C\u5316\uFF0CCVR ${(cvr * 100).toFixed(1)}%\uFF0C\u5EFA\u8BAE\u8FC1\u79FB\u5230\u7CBE\u51C6\u5C42`
    });
  }
  suggestions.sort((a, b) => b.conversions - a.conversions);
  return suggestions;
}
var log179, TRAFFIC_ISOLATION_CONFIG;
var init_trafficIsolationService = __esm({
  "server/system/trafficIsolationService.ts"() {
    "use strict";
    init_logger();
    init_db2();
    init_schema2();
    init_drizzle_orm();
    log179 = createModuleLogger("TrafficIsolationService");
    TRAFFIC_ISOLATION_CONFIG = {
      // N-Gram分析参数
      ngram: {
        minFrequency: 10,
        // 词根最小出现频率
        highRiskFrequency: 50,
        // 高风险词根频率阈值
        confidenceThreshold: 0.7,
        // 建议否定的置信度阈值
        maxTokenLength: 3,
        // 最大N-Gram长度
        stopWords: ["a", "an", "the", "for", "and", "or", "with", "to", "of", "in", "on", "at", "by"]
      },
      // 流量冲突检测参数
      conflict: {
        minOverlapDays: 3,
        // 判定冲突的最小重叠天数
        minClicks: 5,
        // 最小点击数
        cvrWeight: 0.4,
        // CVR权重
        aovWeight: 0.3,
        // AOV权重
        roasWeight: 0.2,
        // ROAS权重
        dataVolumeWeight: 0.1
        // 数据量权重
      },
      // 专家建议新增：软隔离策略参数
      softIsolation: {
        // 默认不添加否定词，通过出价差异实现流量分配
        suggestAddNegative: false,
        // Exact组出价相对于Broad组的倍数
        exactToBroadBidMultiplier: 1.5,
        // Exact组流量稳定阈值（达到此点击数后才建议添加否定词）
        exactGroupStabilityThreshold: 50,
        // Exact组流量稳定所需的最小转化数
        exactGroupMinConversions: 5,
        // 软隔离策略说明
        strategyDescription: "\u901A\u8FC7\u51FA\u4EF7\u5DEE\u5F02\u800C\u975E\u5426\u5B9A\u8BCD\u5B9E\u73B0\u6D41\u91CF\u5206\u914D\uFF0C\u907F\u514D\u6D41\u91CF\u65AD\u5C42"
      },
      // 漏斗模型参数
      funnel: {
        tier1MatchTypes: ["exact"],
        tier2MatchTypes: ["phrase", "exact"],
        tier3MatchTypes: ["broad", "phrase"]
      },
      // 关键词迁移参数
      migration: {
        minConversions: 3,
        // 最小转化数
        minCVR: 0.05,
        // 最小转化率 (5%)
        minClicks: 20
        // 最小点击数
      },
      // 安全边界
      safety: {
        maxNegativesPerBatch: 100,
        // 单次最大否定词数
        maxNegativesPerDay: 500,
        // 每日最大否定词数
        protectedKeywordTypes: ["brand", "high_conversion"]
        // 保护的关键词类型
      }
    };
    __name(tokenize3, "tokenize");
    __name(generateNGrams, "generateNGrams");
    __name(runNGramAnalysis, "runNGramAnalysis");
    __name(detectTrafficConflicts2, "detectTrafficConflicts");
    __name(identifyFunnelTiers, "identifyFunnelTiers");
    __name(syncFunnelNegatives, "syncFunnelNegatives");
    __name(getKeywordMigrationSuggestions, "getKeywordMigrationSuggestions");
  }
});

