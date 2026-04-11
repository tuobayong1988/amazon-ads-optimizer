// Extracted from production dist/index.js
// Original module: server/automation/adAutomation.ts
// Lines: 981

function tokenize2(searchTerm) {
  return searchTerm.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter((word) => word.length > 1);
}
function generateNgrams2(tokens, maxN = 2) {
  const ngrams = [...tokens];
  if (maxN >= 2) {
    for (let i = 0; i < tokens.length - 1; i++) {
      ngrams.push(`${tokens[i]} ${tokens[i + 1]}`);
    }
  }
  return ngrams;
}
function analyzeNgrams(searchTerms8) {
  const minClicksThreshold = 5;
  const ineffectiveTerms = searchTerms8.filter(
    (term) => term.clicks >= minClicksThreshold && term.conversions === 0
  );
  const ngramStats = /* @__PURE__ */ new Map();
  for (const term of ineffectiveTerms) {
    const tokens = tokenize2(term.searchTerm);
    const ngrams = generateNgrams2(tokens);
    const isProductTargeting = term.targetingType === "product";
    for (const ngram of ngrams) {
      const existing = ngramStats.get(ngram) || {
        frequency: 0,
        totalClicks: 0,
        totalConversions: 0,
        totalSpend: 0,
        terms: [],
        hasProductTargeting: false
      };
      existing.frequency++;
      existing.totalClicks += term.clicks;
      existing.totalConversions += term.conversions;
      existing.totalSpend += term.spend;
      existing.terms.push(term.searchTerm);
      if (isProductTargeting) {
        existing.hasProductTargeting = true;
      }
      ngramStats.set(ngram, existing);
    }
  }
  const results = [];
  const knownNegativePatterns = [
    "cheap",
    "free",
    "used",
    "broken",
    "repair",
    "fix",
    "diy",
    "homemade",
    "alternative",
    "substitute",
    "wholesale",
    "bulk",
    "clearance",
    "discount",
    "how to",
    "what is",
    "review",
    "vs",
    "versus"
  ];
  for (const [ngram, stats4] of Array.from(ngramStats.entries())) {
    if (stats4.frequency >= 3) {
      const conversionRate = stats4.totalConversions / stats4.totalClicks;
      const isKnownNegative = knownNegativePatterns.some(
        (pattern) => ngram.includes(pattern)
      );
      let reason = "";
      let isNegativeCandidate = false;
      if (conversionRate === 0 && stats4.frequency >= 5) {
        isNegativeCandidate = true;
        reason = `\u51FA\u73B0${stats4.frequency}\u6B21\uFF0C${stats4.totalClicks}\u6B21\u70B9\u51FB\uFF0C0\u8F6C\u5316\uFF0C\u6D6A\u8D39$${stats4.totalSpend.toFixed(2)}`;
      } else if (isKnownNegative) {
        isNegativeCandidate = true;
        reason = `\u5339\u914D\u5DF2\u77E5\u8D1F\u9762\u8BCD\u6839\u6A21\u5F0F`;
      } else if (conversionRate < 0.01 && stats4.totalClicks >= 10) {
        isNegativeCandidate = true;
        reason = `\u8F6C\u5316\u7387\u4EC5${(conversionRate * 100).toFixed(2)}%\uFF0C\u4F4E\u4E8E1%\u9608\u503C`;
      }
      const suggestedNegativeLevel = stats4.hasProductTargeting ? "campaign" : "ad_group";
      results.push({
        ngram,
        frequency: stats4.frequency,
        totalClicks: stats4.totalClicks,
        totalConversions: stats4.totalConversions,
        totalSpend: stats4.totalSpend,
        conversionRate,
        isNegativeCandidate,
        reason,
        affectedTerms: stats4.terms,
        suggestedNegativeLevel,
        hasProductTargeting: stats4.hasProductTargeting
      });
    }
  }
  return results.sort((a, b) => b.frequency - a.frequency);
}
function analyzeFunnelMigration(searchTerms8, config2 = {
  broadToPhrase: { minConversions: 3, minRoas: 1 },
  phraseToExact: { minConversions: 10, minRoas: 5 },
  bidIncreasePercent: 20
}) {
  const suggestions = [];
  for (const term of searchTerms8) {
    const negativeLevel = term.targetingType === "product" ? "campaign" : "ad_group";
    if (term.matchType === "broad" || term.matchType === "auto") {
      if (term.conversions >= config2.broadToPhrase.minConversions && term.roas >= config2.broadToPhrase.minRoas) {
        const suggestedBid = term.cpc * (1 + config2.bidIncreasePercent / 100);
        suggestions.push({
          searchTerm: term.searchTerm,
          fromCampaign: term.campaignName,
          fromMatchType: term.matchType,
          toMatchType: "phrase",
          reason: `${term.conversions}\u6B21\u6210\u4EA4\uFF0CROAS ${term.roas.toFixed(2)}\uFF0C\u7B26\u5408\u8FC1\u79FB\u6761\u4EF6`,
          suggestedBid: Math.round(suggestedBid * 100) / 100,
          currentCpc: term.cpc,
          conversions: term.conversions,
          roas: term.roas,
          priority: term.conversions >= 5 ? "high" : "medium",
          negativeInOriginal: true,
          negativeLevel
        });
      }
    }
    if (term.matchType === "phrase") {
      if (term.conversions >= config2.phraseToExact.minConversions && term.roas >= config2.phraseToExact.minRoas) {
        const suggestedBid = term.cpc * (1 + config2.bidIncreasePercent / 100);
        suggestions.push({
          searchTerm: term.searchTerm,
          fromCampaign: term.campaignName,
          fromMatchType: "phrase",
          toMatchType: "exact",
          reason: `${term.conversions}\u6B21\u6210\u4EA4\uFF0CROAS ${term.roas.toFixed(2)}\uFF0C\u9AD8\u4EF7\u503C\u6D41\u91CF`,
          suggestedBid: Math.round(suggestedBid * 100) / 100,
          currentCpc: term.cpc,
          conversions: term.conversions,
          roas: term.roas,
          priority: term.roas >= 8 ? "high" : "medium",
          negativeInOriginal: true,
          negativeLevel
        });
      }
    }
    if (term.targetingType === "product" && term.conversions >= 5 && term.roas >= 3) {
      suggestions.push({
        searchTerm: term.searchTerm,
        fromCampaign: term.campaignName,
        fromMatchType: "product",
        toMatchType: "phrase",
        // 建议先用短语匹配测试
        reason: `\u4EA7\u54C1\u5B9A\u4F4D\u5E7F\u544A\u4E2D\u53D1\u73B0\u9AD8\u8F6C\u5316\u641C\u7D22\u8BCD\uFF08${term.conversions}\u6B21\u6210\u4EA4\uFF09\uFF0C\u5EFA\u8BAE\u521B\u5EFA\u5173\u952E\u8BCD\u5E7F\u544A`,
        suggestedBid: Math.round(term.cpc * 1.1 * 100) / 100,
        currentCpc: term.cpc,
        conversions: term.conversions,
        roas: term.roas,
        priority: "high",
        negativeInOriginal: false,
        // 产品定位广告不需要否定这个搜索词
        negativeLevel: "campaign"
        // 如果需要否定，只能在活动层级
      });
    }
  }
  return suggestions.sort((a, b) => {
    if (a.priority !== b.priority) {
      return a.priority === "high" ? -1 : 1;
    }
    return b.conversions - a.conversions;
  });
}
function detectTrafficConflicts(searchTerms8) {
  const termGroups = /* @__PURE__ */ new Map();
  for (const term of searchTerms8) {
    const key = term.searchTerm.toLowerCase();
    const existing = termGroups.get(key) || [];
    existing.push(term);
    termGroups.set(key, existing);
  }
  const conflicts = [];
  for (const [searchTerm, terms] of Array.from(termGroups.entries())) {
    if (terms.length > 1) {
      const campaignScores = terms.map((t2) => {
        const cvr = t2.clicks > 0 ? t2.conversions / t2.clicks : 0;
        const ctr = t2.clicks > 0 ? t2.clicks / (t2.clicks + 100) : 0;
        const score = t2.roas * 0.4 + cvr * 100 * 0.3 + t2.conversions * 0.3;
        return {
          campaignId: t2.campaignId,
          campaignName: t2.campaignName,
          campaignType: t2.campaignType,
          targetingType: t2.targetingType,
          matchType: t2.matchType,
          clicks: t2.clicks,
          conversions: t2.conversions,
          spend: t2.spend,
          sales: t2.sales,
          roas: t2.roas,
          ctr,
          cvr,
          score
          // @ts-ignore
        };
      });
      campaignScores.sort((a, b) => b.score - a.score);
      const winner = campaignScores[0];
      const losers = campaignScores.slice(1);
      const wastedSpend = losers.reduce((sum2, l) => sum2 + l.spend, 0);
      const loserCampaigns = losers.map((l) => ({
        name: l.campaignName,
        campaignType: l.campaignType,
        targetingType: l.targetingType,
        negativeLevel: l.targetingType === "product" ? "campaign" : "ad_group"
      }));
      conflicts.push({
        searchTerm,
        campaigns: campaignScores.map((c) => ({
          campaignId: c.campaignId,
          campaignName: c.campaignName,
          campaignType: c.campaignType,
          targetingType: c.targetingType,
          matchType: c.matchType,
          clicks: c.clicks,
          conversions: c.conversions,
          spend: c.spend,
          // @ts-ignore
          sales: c.sales,
          // @ts-ignore
          roas: c.roas,
          // @ts-ignore
          ctr: c.ctr,
          cvr: c.cvr
        })),
        // @ts-ignore
        recommendation: {
          // @ts-ignore
          winnerCampaign: winner.campaignName,
          // @ts-ignore
          winnerCampaignType: winner.campaignType,
          // @ts-ignore
          winnerTargetingType: winner.targetingType,
          loserCampaigns,
          // @ts-ignore
          action: "negative_exact",
          // @ts-ignore
          reason: `${winner.campaignName}\u8868\u73B0\u6700\u4F73\uFF08ROAS: ${winner.roas.toFixed(2)}, CVR: ${(winner.cvr * 100).toFixed(1)}%\uFF09\uFF0C\u5EFA\u8BAE\u5728\u5176\u4ED6\u6D3B\u52A8\u4E2D\u5426\u5B9A\u6B64\u8BCD`
        },
        totalWastedSpend: Math.round(wastedSpend * 100) / 100
      });
    }
  }
  return conflicts.sort((a, b) => b.totalWastedSpend - a.totalWastedSpend);
}
function analyzeBidAdjustments2(targets, config2 = {
  rampUpPercent: 5,
  maxBidMultiplier: 3,
  minImpressions: 100,
  correctionWindow: 14,
  targetAcos: 30,
  targetRoas: 3.33
}) {
  const suggestions = [];
  for (const target of targets) {
    const ctr = target.impressions > 0 ? target.clicks / target.impressions : 0;
    const cvr = target.clicks > 0 ? target.conversions / target.clicks : 0;
    const acos = target.sales > 0 ? target.spend / target.sales * 100 : 0;
    const roas = target.spend > 0 ? target.sales / target.spend : 0;
    const effectiveTargetAcos = target.targetAcos || config2.targetAcos;
    const effectiveTargetRoas = target.targetRoas || config2.targetRoas;
    let suggestedBid = target.currentBid;
    let adjustmentType = "maintain";
    let reason = "";
    let priority = "low";
    if (target.impressions < config2.minImpressions) {
      suggestedBid = target.currentBid * (1 + config2.rampUpPercent / 100);
      adjustmentType = "increase";
      reason = `\u66DD\u5149\u4E0D\u8DB3\uFF08${target.impressions}\u6B21\uFF09\uFF0C\u5EFA\u8BAE\u63D0\u5347${config2.rampUpPercent}%\u7ADE\u4EF7\u4EE5\u83B7\u53D6\u66F4\u591A\u66DD\u5149`;
      priority = "high";
    } else if (acos > 0 && acos < effectiveTargetAcos * 0.7 && target.conversions >= 3) {
      const increasePercent = Math.min(20, (effectiveTargetAcos - acos) / effectiveTargetAcos * 30);
      suggestedBid = target.currentBid * (1 + increasePercent / 100);
      adjustmentType = "increase";
      reason = `ACoS ${acos.toFixed(1)}%\u8FDC\u4F4E\u4E8E\u76EE\u6807${effectiveTargetAcos}%\uFF0C\u6709\u63D0\u4EF7\u7A7A\u95F4`;
      priority = "medium";
    } else if (acos > effectiveTargetAcos * 1.3 && target.clicks >= 20) {
      const decreasePercent = Math.min(30, (acos - effectiveTargetAcos) / acos * 40);
      suggestedBid = target.currentBid * (1 - decreasePercent / 100);
      adjustmentType = "decrease";
      reason = `ACoS ${acos.toFixed(1)}%\u8D85\u51FA\u76EE\u6807${effectiveTargetAcos}%\uFF0C\u5EFA\u8BAE\u964D\u4EF7`;
      priority = "high";
    } else if (target.daysSinceLastChange && target.daysSinceLastChange <= config2.correctionWindow) {
      if (target.conversions >= 2 && roas < effectiveTargetRoas * 0.5) {
        suggestedBid = target.currentBid * 0.9;
        adjustmentType = "decrease";
        reason = `\u8FD1\u671F\u8C03\u4EF7\u540EROAS\u4E0B\u964D\u81F3${roas.toFixed(2)}\uFF0C\u5EFA\u8BAE\u56DE\u8C03\u7ADE\u4EF7`;
        priority = "urgent";
      }
    } else if (target.clicks >= 30 && target.conversions === 0) {
      suggestedBid = target.currentBid * 0.7;
      adjustmentType = "decrease";
      reason = `${target.clicks}\u6B21\u70B9\u51FB\u65E0\u8F6C\u5316\uFF0C\u5EFA\u8BAE\u5927\u5E45\u964D\u4EF7\u6216\u8003\u8651\u6682\u505C`;
      priority = "urgent";
    }
    const maxBid = target.currentBid * config2.maxBidMultiplier;
    const minBid = 0.15;
    suggestedBid = Math.max(minBid, Math.min(maxBid, suggestedBid));
    suggestedBid = Math.round(suggestedBid * 100) / 100;
    if (suggestedBid < target.currentBid) {
      const maxDecrease = target.currentBid * 0.8;
      suggestedBid = Math.max(suggestedBid, maxDecrease);
      suggestedBid = Math.round(suggestedBid * 100) / 100;
    }
    const adjustmentPercent = (suggestedBid - target.currentBid) / target.currentBid * 100;
    if (Math.abs(adjustmentPercent) >= 3) {
      suggestions.push({
        targetId: target.id,
        targetType: target.type,
        targetName: target.name,
        campaignName: target.campaignName,
        currentBid: target.currentBid,
        suggestedBid,
        adjustmentPercent: Math.round(adjustmentPercent * 10) / 10,
        adjustmentType,
        reason,
        priority,
        metrics: {
          impressions: target.impressions,
          clicks: target.clicks,
          conversions: target.conversions,
          spend: target.spend,
          sales: target.sales,
          acos: Math.round(acos * 10) / 10,
          roas: Math.round(roas * 100) / 100,
          ctr: Math.round(ctr * 1e4) / 100,
          cvr: Math.round(cvr * 1e4) / 100
        }
      });
    }
  }
  const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
  return suggestions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
}
function classifySearchTerms(searchTerms8, productKeywords, productAttributes) {
  const results = [];
  const keywordSet = new Set(productKeywords.map((k) => k.toLowerCase()));
  const categoryWords = productAttributes.category.toLowerCase().split(/\s+/);
  const brandLower = productAttributes.brand.toLowerCase();
  const negativePatterns = [
    "free",
    "cheap",
    "used",
    "broken",
    "repair",
    "fix",
    "diy",
    "how to",
    "what is",
    "review",
    "vs",
    "versus",
    "alternative",
    "wholesale",
    "bulk",
    "clearance"
  ];
  const attributeMismatchCheck = /* @__PURE__ */ __name((term) => {
    const termLower = term.toLowerCase();
    if (productAttributes.colors && productAttributes.colors.length > 0) {
      const allColors = ["red", "blue", "green", "yellow", "black", "white", "pink", "purple", "orange", "brown", "gray", "grey"];
      const productColors = productAttributes.colors.map((c) => c.toLowerCase());
      for (const color of allColors) {
        if (termLower.includes(color) && !productColors.includes(color)) {
          return true;
        }
      }
    }
    if (productAttributes.sizes && productAttributes.sizes.length > 0) {
      const sizePatterns = ["small", "medium", "large", "xl", "xxl", "xs", "mini", "jumbo"];
      const productSizes = productAttributes.sizes.map((s) => s.toLowerCase());
      for (const size of sizePatterns) {
        if (termLower.includes(size) && !productSizes.some((ps) => ps.includes(size))) {
          return true;
        }
      }
    }
    return false;
  }, "attributeMismatchCheck");
  for (const term of searchTerms8) {
    const termLower = term.toLowerCase();
    const termTokens = tokenize2(term);
    let relevance = "unrelated";
    let confidence = 0;
    let reason = "";
    let suggestedAction = "negative_exact";
    let matchTypeSuggestion;
    const hasNegativePattern = negativePatterns.some((p) => termLower.includes(p));
    if (hasNegativePattern) {
      relevance = "unrelated";
      confidence = 0.9;
      reason = "\u5305\u542B\u8D1F\u9762\u8BCD\u6839\uFF08\u5982cheap, free, used\u7B49\uFF09";
      suggestedAction = "negative_phrase";
    } else if (attributeMismatchCheck(term)) {
      relevance = "seemingly_related";
      confidence = 0.75;
      reason = "\u4EA7\u54C1\u5C5E\u6027\u4E0D\u5339\u914D\uFF08\u989C\u8272/\u5C3A\u5BF8\uFF09";
      suggestedAction = "negative_exact";
    } else if (keywordSet.has(termLower)) {
      relevance = "high";
      confidence = 0.95;
      reason = "\u7CBE\u786E\u5339\u914D\u4EA7\u54C1\u5173\u952E\u8BCD";
      suggestedAction = "target";
      matchTypeSuggestion = "exact";
    } else if (termLower.includes(brandLower)) {
      relevance = "high";
      confidence = 0.9;
      reason = "\u5305\u542B\u54C1\u724C\u8BCD";
      suggestedAction = "target";
      matchTypeSuggestion = "phrase";
    } else if (categoryWords.some((cw) => termLower.includes(cw))) {
      const matchedWords = categoryWords.filter((cw) => termLower.includes(cw));
      if (matchedWords.length >= 2) {
        relevance = "high";
        confidence = 0.8;
        reason = "\u5305\u542B\u591A\u4E2A\u7C7B\u76EE\u5173\u952E\u8BCD";
        suggestedAction = "target";
        matchTypeSuggestion = "phrase";
      } else {
        relevance = "weak";
        confidence = 0.6;
        reason = "\u4EC5\u5305\u542B\u90E8\u5206\u7C7B\u76EE\u5173\u952E\u8BCD";
        suggestedAction = "monitor";
        matchTypeSuggestion = "broad";
      }
    } else {
      const matchedKeywords = productKeywords.filter(
        (k) => termLower.includes(k.toLowerCase()) || k.toLowerCase().includes(termLower)
      );
      if (matchedKeywords.length > 0) {
        relevance = "weak";
        confidence = 0.5;
        reason = "\u90E8\u5206\u5339\u914D\u4EA7\u54C1\u5173\u952E\u8BCD";
        suggestedAction = "monitor";
        matchTypeSuggestion = "broad";
      } else {
        relevance = "unrelated";
        confidence = 0.7;
        reason = "\u4E0E\u4EA7\u54C1\u5173\u952E\u8BCD\u65E0\u660E\u663E\u5173\u8054";
        suggestedAction = "negative_exact";
      }
    }
    results.push({
      searchTerm: term,
      relevance,
      confidence,
      reason,
      suggestedAction,
      matchTypeSuggestion
    });
  }
  return results;
}
function getPresetNegativeKeywords(category) {
  const commonNegatives = [
    "free",
    "cheap",
    "cheapest",
    "used",
    "broken",
    "repair",
    "fix",
    "diy",
    "homemade",
    "alternative",
    "substitute",
    "replacement",
    "wholesale",
    "bulk",
    "clearance",
    "discount",
    "coupon",
    "how to",
    "what is",
    "review",
    "reviews",
    "vs",
    "versus",
    "reddit",
    "amazon",
    "ebay",
    "walmart",
    "aliexpress",
    "download",
    "pdf",
    "manual",
    "instructions"
  ];
  const categoryNegatives = {
    "electronics": ["schematic", "circuit", "datasheet", "pinout", "driver"],
    "clothing": ["pattern", "sewing", "fabric", "material", "costume"],
    "toys": ["plans", "blueprint", "build", "make", "craft"],
    "home": ["rental", "rent", "lease", "apartment"],
    "beauty": ["recipe", "homemade", "natural", "organic diy"],
    "sports": ["rules", "how to play", "history", "olympics"]
  };
  const categoryLower = category.toLowerCase();
  const specificNegatives = categoryNegatives[categoryLower] || [];
  return [...commonNegatives, ...specificNegatives];
}
function analyzeBidCorrections(bidChanges, attributionWindowDays = 14) {
  const suggestions = [];
  const now = /* @__PURE__ */ new Date();
  for (const change of bidChanges) {
    const daysElapsed = Math.floor((now.getTime() - new Date(change.changeDate).getTime()) / (1e3 * 60 * 60 * 24));
    if (daysElapsed < 3 || daysElapsed > attributionWindowDays + 7) {
      continue;
    }
    if (!change.performanceAfter) {
      continue;
    }
    const bidChangePercent = (change.newBid - change.oldBid) / change.oldBid * 100;
    const perf = change.performanceAfter;
    const roas = perf.spend > 0 ? perf.sales / perf.spend : 0;
    const acos = perf.sales > 0 ? perf.spend / perf.sales * 100 : 0;
    let errorType = null;
    let reason = "";
    let suggestedBid = change.oldBid;
    let priority = "medium";
    let confidence = 0;
    if (bidChangePercent < -10 && perf.conversions > 0) {
      if (roas > 3 || acos < 25) {
        errorType = "premature_decrease";
        reason = `\u964D\u4EF7${Math.abs(bidChangePercent).toFixed(1)}%\u540E\uFF0CROAS\u4ECD\u8FBE${roas.toFixed(2)}\uFF0CACoS\u4EC5${acos.toFixed(1)}%\uFF0C\u5EFA\u8BAE\u6062\u590D\u51FA\u4EF7`;
        suggestedBid = change.oldBid * 0.95;
        priority = roas > 5 ? "urgent" : "high";
        confidence = Math.min(0.9, 0.5 + roas / 10);
      }
    } else if (bidChangePercent > 15 && perf.conversions === 0 && perf.clicks > 10) {
      errorType = "premature_increase";
      reason = `\u52A0\u4EF7${bidChangePercent.toFixed(1)}%\u540E\uFF0C${perf.clicks}\u6B21\u70B9\u51FB0\u8F6C\u5316\uFF0C\u5EFA\u8BAE\u56DE\u8C03\u51FA\u4EF7`;
      suggestedBid = change.oldBid * 1.05;
      priority = perf.spend > 50 ? "urgent" : "high";
      confidence = 0.75;
    } else if (Math.abs(bidChangePercent) > 30) {
      if (perf.conversions === 0 && perf.clicks > 5) {
        errorType = "over_adjustment";
        reason = `\u51FA\u4EF7\u8C03\u6574\u5E45\u5EA6\u8FC7\u5927(${bidChangePercent > 0 ? "+" : ""}${bidChangePercent.toFixed(1)}%)\uFF0C\u5EFA\u8BAE\u9010\u6B65\u8C03\u6574`;
        suggestedBid = (change.oldBid + change.newBid) / 2;
        priority = "medium";
        confidence = 0.6;
      }
    }
    if (daysElapsed >= attributionWindowDays - 3 && daysElapsed <= attributionWindowDays + 3) {
      if (perf.conversions > 0 && bidChangePercent < -15) {
        if (!errorType) {
          errorType = "attribution_delay";
          reason = `\u53D8\u66F4\u53D1\u751F\u5728\u5F52\u56E0\u7A97\u53E3\u8FB9\u7F18(${daysElapsed}\u5929\u524D)\uFF0C\u53EF\u80FD\u5B58\u5728\u5EF6\u8FDF\u5F52\u56E0\u8F6C\u5316\uFF0C\u5EFA\u8BAE\u91CD\u65B0\u8BC4\u4F30`;
          suggestedBid = change.oldBid * 0.9;
          priority = "medium";
          confidence = 0.55;
        }
      }
    }
    if (errorType) {
      suggestions.push({
        targetId: change.targetId,
        targetName: change.targetName,
        targetType: change.targetType,
        campaignName: change.campaignName,
        originalBid: change.oldBid,
        currentBid: change.newBid,
        suggestedBid,
        errorType,
        reason,
        evidence: {
          changeDate: typeof change.changeDate === "string" ? change.changeDate : new Date(change.changeDate).toISOString(),
          daysElapsed,
          performanceBefore: {
            conversions: 0,
            // 需要从历史数据获取
            roas: 0,
            acos: 0
          },
          performanceAfter: {
            conversions: perf.conversions,
            roas,
            acos
          },
          attributedConversions: perf.conversions
        },
        priority,
        // @ts-ignore
        confidence
      });
    }
  }
  const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
  suggestions.sort((a, b) => {
    const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
    if (priorityDiff !== 0) return priorityDiff;
    return b.confidence - a.confidence;
  });
  return suggestions;
}
function analyzeCampaignHealth(campaigns6, thresholds = {
  acosWarning: 35,
  acosCritical: 50,
  ctrDropWarning: -20,
  ctrDropCritical: -40,
  // @ts-ignore
  cvrDropWarning: -25,
  cvrDropCritical: -50,
  roasMinimum: 2
}) {
  const results = [];
  for (const campaign of campaigns6) {
    const alerts = [];
    const recommendations = [];
    const now = /* @__PURE__ */ new Date();
    const { currentMetrics: curr, historicalAverage: hist, changes } = campaign;
    if (curr.acos > thresholds.acosCritical) {
      alerts.push({
        // @ts-ignore
        campaignId: campaign.campaignId,
        // @ts-ignore
        campaignName: campaign.campaignName,
        // @ts-ignore
        alertType: "acos_spike",
        severity: "critical",
        metric: "ACoS",
        currentValue: curr.acos,
        expectedValue: hist.acos,
        changePercent: changes.acos,
        message: `ACoS\u8FBE\u5230${curr.acos.toFixed(1)}%\uFF0C\u8D85\u8FC7\u4E34\u754C\u503C${thresholds.acosCritical}%`,
        suggestedAction: "\u5EFA\u8BAE\u964D\u4F4E\u51FA\u4EF7\u6216\u6682\u505C\u4F4E\u6548\u5173\u952E\u8BCD",
        detectedAt: now
      });
      recommendations.push("\u7D27\u6025\uFF1A\u964D\u4F4E\u9AD8ACoS\u5173\u952E\u8BCD\u7684\u51FA\u4EF7");
      recommendations.push("\u68C0\u67E5\u662F\u5426\u6709\u6076\u610F\u70B9\u51FB\u6216\u7ADE\u4E89\u5BF9\u624B\u5E72\u6270");
    } else if (curr.acos > thresholds.acosWarning) {
      alerts.push({
        // @ts-ignore
        campaignId: campaign.campaignId,
        // @ts-ignore
        campaignName: campaign.campaignName,
        // @ts-ignore
        alertType: "acos_spike",
        severity: "warning",
        metric: "ACoS",
        currentValue: curr.acos,
        expectedValue: hist.acos,
        changePercent: changes.acos,
        message: `ACoS\u8FBE\u5230${curr.acos.toFixed(1)}%\uFF0C\u63A5\u8FD1\u8B66\u6212\u7EBF`,
        suggestedAction: "\u5EFA\u8BAE\u4F18\u5316\u5173\u952E\u8BCD\u51FA\u4EF7\u7B56\u7565",
        detectedAt: now
      });
      recommendations.push("\u4F18\u5316\u51FA\u4EF7\u7B56\u7565\uFF0C\u5173\u6CE8\u9AD8\u82B1\u8D39\u4F4E\u8F6C\u5316\u8BCD");
    }
    if (changes.ctr < thresholds.ctrDropCritical) {
      alerts.push({
        // @ts-ignore
        campaignId: campaign.campaignId,
        // @ts-ignore
        campaignName: campaign.campaignName,
        alertType: "ctr_drop",
        severity: "critical",
        metric: "CTR",
        currentValue: curr.ctr,
        expectedValue: hist.ctr,
        changePercent: changes.ctr,
        message: `CTR\u4E0B\u964D${Math.abs(changes.ctr).toFixed(1)}%\uFF0C\u53EF\u80FD\u5B58\u5728\u4E25\u91CD\u95EE\u9898`,
        suggestedAction: "\u68C0\u67E5\u5E7F\u544A\u521B\u610F\u548C\u5173\u952E\u8BCD\u76F8\u5173\u6027",
        detectedAt: now
      });
      recommendations.push("\u7D27\u6025\uFF1A\u68C0\u67E5\u5E7F\u544A\u6587\u6848\u548C\u56FE\u7247\u662F\u5426\u9700\u8981\u66F4\u65B0");
      recommendations.push("\u5206\u6790\u7ADE\u4E89\u5BF9\u624B\u662F\u5426\u6709\u65B0\u7684\u5E7F\u544A\u7B56\u7565");
    } else if (changes.ctr < thresholds.ctrDropWarning) {
      alerts.push({
        // @ts-ignore
        campaignId: campaign.campaignId,
        // @ts-ignore
        campaignName: campaign.campaignName,
        alertType: "ctr_drop",
        severity: "warning",
        metric: "CTR",
        currentValue: curr.ctr,
        expectedValue: hist.ctr,
        changePercent: changes.ctr,
        message: `CTR\u4E0B\u964D${Math.abs(changes.ctr).toFixed(1)}%`,
        suggestedAction: "\u5EFA\u8BAE\u4F18\u5316\u5E7F\u544A\u521B\u610F",
        detectedAt: now
      });
      recommendations.push("\u8003\u8651\u66F4\u65B0\u5E7F\u544A\u521B\u610F\u4EE5\u63D0\u9AD8\u70B9\u51FB\u7387");
    }
    if (changes.cvr < thresholds.cvrDropCritical) {
      alerts.push({
        // @ts-ignore
        campaignId: campaign.campaignId,
        // @ts-ignore
        campaignName: campaign.campaignName,
        alertType: "cvr_drop",
        severity: "critical",
        metric: "CVR",
        currentValue: curr.cvr,
        expectedValue: hist.cvr,
        changePercent: changes.cvr,
        message: `\u8F6C\u5316\u7387\u4E0B\u964D${Math.abs(changes.cvr).toFixed(1)}%\uFF0C\u9700\u8981\u7ACB\u5373\u5173\u6CE8`,
        suggestedAction: "\u68C0\u67E5\u4EA7\u54C1\u9875\u9762\u548C\u4EF7\u683C\u7ADE\u4E89\u529B",
        detectedAt: now
        // @ts-ignore
      });
      recommendations.push("\u7D27\u6025\uFF1A\u68C0\u67E5\u4EA7\u54C1\u8BE6\u60C5\u9875\u662F\u5426\u6709\u95EE\u9898");
      recommendations.push("\u5206\u6790\u662F\u5426\u6709\u5DEE\u8BC4\u6216\u5E93\u5B58\u95EE\u9898\u5F71\u54CD\u8F6C\u5316");
    } else if (changes.cvr < thresholds.cvrDropWarning) {
      alerts.push({
        // @ts-ignore
        campaignId: campaign.campaignId,
        // @ts-ignore
        campaignName: campaign.campaignName,
        alertType: "cvr_drop",
        severity: "warning",
        metric: "CVR",
        currentValue: curr.cvr,
        expectedValue: hist.cvr,
        changePercent: changes.cvr,
        message: `\u8F6C\u5316\u7387\u4E0B\u964D${Math.abs(changes.cvr).toFixed(1)}%`,
        suggestedAction: "\u5EFA\u8BAE\u4F18\u5316\u4EA7\u54C1\u9875\u9762",
        detectedAt: now
        // @ts-ignore
      });
      recommendations.push("\u4F18\u5316\u4EA7\u54C1\u8BE6\u60C5\u9875\u4EE5\u63D0\u9AD8\u8F6C\u5316\u7387");
    }
    if (curr.roas < thresholds.roasMinimum && curr.spend > 0) {
      alerts.push({
        // @ts-ignore
        campaignId: campaign.campaignId,
        // @ts-ignore
        campaignName: campaign.campaignName,
        alertType: "roas_decline",
        severity: curr.roas < 1 ? "critical" : "warning",
        metric: "ROAS",
        currentValue: curr.roas,
        expectedValue: thresholds.roasMinimum,
        changePercent: changes.roas,
        message: `ROAS\u4EC5${curr.roas.toFixed(2)}\uFF0C\u4F4E\u4E8E\u6700\u4F4E\u8981\u6C42${thresholds.roasMinimum}`,
        suggestedAction: "ROAS\u8FC7\u4F4E\uFF0C\u5EFA\u8BAE\u4F18\u5316\u6216\u6682\u505C\u6D3B\u52A8",
        detectedAt: now
      });
      recommendations.push("\u5206\u6790\u4F4E\u6548\u5173\u952E\u8BCD\u5E76\u8003\u8651\u6682\u505C");
    }
    if (curr.clicks > 20 && curr.orders === 0) {
      alerts.push({
        // @ts-ignore
        campaignId: campaign.campaignId,
        // @ts-ignore
        campaignName: campaign.campaignName,
        alertType: "no_conversions",
        severity: curr.clicks > 50 ? "critical" : "warning",
        metric: "Conversions",
        currentValue: 0,
        expectedValue: hist.orders,
        // @ts-ignore
        changePercent: -100,
        // @ts-ignore
        message: `${curr.clicks}\u6B21\u70B9\u51FB\u65E0\u8F6C\u5316\uFF0C\u82B1\u8D39$${curr.spend.toFixed(2)}`,
        suggestedAction: "\u68C0\u67E5\u5173\u952E\u8BCD\u76F8\u5173\u6027\u548C\u4EA7\u54C1\u7ADE\u4E89\u529B",
        detectedAt: now
      });
      recommendations.push("\u5206\u6790\u65E0\u8F6C\u5316\u539F\u56E0\uFF1A\u5173\u952E\u8BCD\u76F8\u5173\u6027\u3001\u4EF7\u683C\u3001\u8BC4\u4EF7\u7B49");
    }
    const efficiencyScore = calculateEfficiencyScore2(curr.acos, curr.roas, thresholds);
    const trafficScore = calculateTrafficScore(changes.impressions, changes.clicks);
    const conversionScore = calculateConversionScore(curr.cvr, changes.cvr, curr.orders);
    const costScore = calculateCostScore(curr.acos, changes.spend, changes.sales);
    const overallScore = Math.round(
      efficiencyScore * 0.35 + // @ts-ignore
      trafficScore * 0.2 + conversionScore * 0.3 + costScore * 0.15
    );
    let status = "healthy";
    if (overallScore < 40 || alerts.some((a) => a.severity === "critical")) {
      status = "critical";
    } else if (overallScore < 70 || alerts.some((a) => a.severity === "warning")) {
      status = "warning";
    }
    results.push({
      // @ts-ignore
      campaignId: campaign.campaignId,
      // @ts-ignore
      campaignName: campaign.campaignName,
      overallScore,
      scoreBreakdown: {
        efficiency: efficiencyScore,
        traffic: trafficScore,
        conversion: conversionScore,
        cost: costScore
      },
      status,
      alerts,
      recommendations: Array.from(new Set(recommendations))
      // 去重
    });
  }
  results.sort((a, b) => a.overallScore - b.overallScore);
  return results;
}
function calculateEfficiencyScore2(acos, roas, thresholds) {
  let score = 100;
  if (acos > thresholds.acosCritical) {
    score -= 50;
  } else if (acos > thresholds.acosWarning) {
    score -= 25;
  } else if (acos > 20) {
    score -= 10;
  }
  if (roas < 1) {
    score -= 40;
  } else if (roas < thresholds.roasMinimum) {
    score -= 20;
  } else if (roas > 5) {
    score += 10;
  }
  return Math.max(0, Math.min(100, score));
}
function calculateTrafficScore(impressionChange, clickChange) {
  let score = 70;
  if (impressionChange > 20) score += 15;
  else if (impressionChange > 0) score += 10;
  else if (impressionChange < -30) score -= 25;
  else if (impressionChange < -10) score -= 10;
  if (clickChange > 20) score += 15;
  else if (clickChange > 0) score += 10;
  else if (clickChange < -30) score -= 25;
  else if (clickChange < -10) score -= 10;
  return Math.max(0, Math.min(100, score));
}
function calculateConversionScore(cvr, cvrChange, orders) {
  let score = 60;
  if (cvr > 15) score += 25;
  else if (cvr > 10) score += 15;
  else if (cvr > 5) score += 5;
  else if (cvr < 2) score -= 20;
  if (cvrChange > 10) score += 15;
  else if (cvrChange < -30) score -= 25;
  else if (cvrChange < -10) score -= 10;
  if (orders === 0) score -= 30;
  else if (orders < 5) score -= 10;
  return Math.max(0, Math.min(100, score));
}
function calculateCostScore(acos, spendChange, salesChange) {
  let score = 70;
  if (salesChange > spendChange && salesChange > 0) {
    score += 20;
  } else if (spendChange > 30 && salesChange < 10) {
    score -= 30;
  }
  if (acos < 15) score += 15;
  else if (acos > 40) score -= 20;
  return Math.max(0, Math.min(100, score));
}
function validateNegativeKeywordBatch(items) {
  const valid = [];
  const invalid = [];
  const seen = /* @__PURE__ */ new Set();
  for (const item of items) {
    const key = `${item.campaignId}-${item.adGroupId || "campaign"}-${item.keyword}-${item.matchType}`;
    if (seen.has(key)) {
      invalid.push({ item, reason: "\u91CD\u590D\u7684\u5426\u5B9A\u8BCD" });
      continue;
    }
    seen.add(key);
    if (!item.keyword || item.keyword.trim().length === 0) {
      invalid.push({ item, reason: "\u5173\u952E\u8BCD\u4E0D\u80FD\u4E3A\u7A7A" });
      continue;
    }
    if (item.keyword.length > 80) {
      invalid.push({ item, reason: "\u5173\u952E\u8BCD\u957F\u5EA6\u8D85\u8FC780\u5B57\u7B26\u9650\u5236" });
      continue;
    }
    if (!["phrase", "exact"].includes(item.matchType)) {
      invalid.push({ item, reason: "\u65E0\u6548\u7684\u5339\u914D\u7C7B\u578B" });
      continue;
    }
    if (item.level === "ad_group" && !item.adGroupId) {
      invalid.push({ item, reason: "\u5E7F\u544A\u7EC4\u5C42\u7EA7\u5426\u5B9A\u9700\u8981\u6307\u5B9A\u5E7F\u544A\u7EC4ID" });
      continue;
    }
    valid.push(item);
  }
  return { valid, invalid };
}
function validateBidAdjustmentBatch(items, maxBid = 10, minBid = 0.15, maxAdjustmentPercent = 100) {
  const valid = [];
  const invalid = [];
  const seen = /* @__PURE__ */ new Set();
  for (const item of items) {
    if (seen.has(item.targetId)) {
      invalid.push({ item, reason: "\u91CD\u590D\u7684\u76EE\u6807ID" });
      continue;
    }
    seen.add(item.targetId);
    if (item.newBid < minBid) {
      invalid.push({ item, reason: `\u51FA\u4EF7\u4E0D\u80FD\u4F4E\u4E8E$${minBid}` });
      continue;
    }
    if (item.newBid > maxBid) {
      invalid.push({ item, reason: `\u51FA\u4EF7\u4E0D\u80FD\u8D85\u8FC7$${maxBid}` });
      continue;
    }
    if (Math.abs(item.adjustmentPercent) > maxAdjustmentPercent) {
      invalid.push({ item, reason: `\u5355\u6B21\u8C03\u6574\u5E45\u5EA6\u4E0D\u80FD\u8D85\u8FC7${maxAdjustmentPercent}%` });
      continue;
    }
    if (item.newBid === item.currentBid) {
      invalid.push({ item, reason: "\u65B0\u51FA\u4EF7\u4E0E\u5F53\u524D\u51FA\u4EF7\u76F8\u540C" });
      continue;
    }
    valid.push(item);
  }
  return { valid, invalid };
}
function generateBatchOperationSummary(negativeItems, bidItems) {
  const negativeSummary = {
    total: negativeItems.length,
    byCampaign: {},
    byMatchType: { phrase: 0, exact: 0 },
    byLevel: { ad_group: 0, campaign: 0 }
  };
  for (const item of negativeItems) {
    negativeSummary.byCampaign[item.campaignId] = (negativeSummary.byCampaign[item.campaignId] || 0) + 1;
    negativeSummary.byMatchType[item.matchType]++;
    negativeSummary.byLevel[item.level]++;
  }
  const bidSummary = {
    total: bidItems.length,
    increases: 0,
    decreases: 0,
    avgAdjustment: 0,
    totalBidChange: 0
  };
  let totalAdjustment = 0;
  for (const item of bidItems) {
    if (item.newBid > item.currentBid) {
      bidSummary.increases++;
    } else {
      bidSummary.decreases++;
    }
    totalAdjustment += item.adjustmentPercent;
    bidSummary.totalBidChange += item.newBid - item.currentBid;
  }
  bidSummary.avgAdjustment = bidItems.length > 0 ? totalAdjustment / bidItems.length : 0;
  return {
    negatives: negativeSummary,
    bids: bidSummary
  };
}
var log177;
var init_adAutomation = __esm({
  "server/automation/adAutomation.ts"() {
    "use strict";
    init_logger();
    log177 = createModuleLogger("AdAutomation");
    __name(tokenize2, "tokenize");
    __name(generateNgrams2, "generateNgrams");
    __name(analyzeNgrams, "analyzeNgrams");
    __name(analyzeFunnelMigration, "analyzeFunnelMigration");
    __name(detectTrafficConflicts, "detectTrafficConflicts");
    __name(analyzeBidAdjustments2, "analyzeBidAdjustments");
    __name(classifySearchTerms, "classifySearchTerms");
    __name(getPresetNegativeKeywords, "getPresetNegativeKeywords");
    __name(analyzeBidCorrections, "analyzeBidCorrections");
    __name(analyzeCampaignHealth, "analyzeCampaignHealth");
    __name(calculateEfficiencyScore2, "calculateEfficiencyScore");
    __name(calculateTrafficScore, "calculateTrafficScore");
    __name(calculateConversionScore, "calculateConversionScore");
    __name(calculateCostScore, "calculateCostScore");
    __name(validateNegativeKeywordBatch, "validateNegativeKeywordBatch");
    __name(validateBidAdjustmentBatch, "validateBidAdjustmentBatch");
    __name(generateBatchOperationSummary, "generateBatchOperationSummary");
  }
});

