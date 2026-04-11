// Extracted from production dist/index.js
// Original module: server/services/targetingAlgorithm.ts
// Lines: 524

function decideTargeting(data) {
  const {
    searchTerm,
    clicks,
    impressions,
    orders,
    spend,
    sales,
    campaignTargetingType,
    campaignType,
    targetAcos
  } = data;
  const isAsin = isAsinSearchTerm(searchTerm);
  if (!isAsin) {
    const validation = sanitizeAndValidateKeyword(searchTerm, "positive");
    if (!validation.isValid) {
      return {
        action: "SKIP",
        targetValue: searchTerm,
        reason: `\u6570\u636E\u6821\u9A8C\u5931\u8D25: ${validation.reasonMessage}`,
        confidence: 1,
        dataMaturityLevel: "insufficient",
        valueLevel: "unknown"
      };
    }
  }
  const cvr = clicks > 0 ? orders / clicks * 100 : 0;
  const acos = sales > 0 ? spend / sales * 100 : spend > 0 ? 999 : 0;
  const roas = spend > 0 ? sales / spend : 0;
  const cpc = clicks > 0 ? spend / clicks : 0;
  const ctr = impressions > 0 ? clicks / impressions * 100 : 0;
  const aov = orders > 0 ? sales / orders : 0;
  const dataMaturity = assessDataMaturity(data);
  const valueLevel = assessValueLevel(cvr, acos, orders, clicks, targetAcos);
  const normalizedCampaignType = normalizeCampaignType(campaignType);
  if (isAsin) {
    return decideAsinTargetingV2(data, cvr, acos, orders, clicks, dataMaturity, valueLevel, normalizedCampaignType);
  }
  switch (normalizedCampaignType) {
    case "sp":
      if (!canAddPositiveKeyword(campaignTargetingType)) {
        return decideAutoTargetingAction(data, cvr, acos, orders, clicks, dataMaturity, valueLevel);
      }
      return decideKeywordTargeting(data, cvr, acos, roas, cpc, aov, orders, clicks, dataMaturity, valueLevel);
    case "sb":
      return decideSbKeywordTargeting(data, cvr, acos, roas, cpc, aov, orders, clicks, dataMaturity, valueLevel);
    case "sd":
      return decideSdKeywordTargeting(data, cvr, acos, roas, cpc, aov, orders, clicks, dataMaturity, valueLevel);
    default:
      if (!canAddPositiveKeyword(campaignTargetingType)) {
        return decideAutoTargetingAction(data, cvr, acos, orders, clicks, dataMaturity, valueLevel);
      }
      return decideKeywordTargeting(data, cvr, acos, roas, cpc, aov, orders, clicks, dataMaturity, valueLevel);
  }
}
function normalizeCampaignType(campaignType) {
  if (campaignType === "sp_auto" || campaignType === "sp_manual" || campaignType === "sp") return "sp";
  if (campaignType === "sb") return "sb";
  if (campaignType === "sd") return "sd";
  return "sp";
}
function assessDataMaturity(data) {
  const { clicks, impressions, orders, dataSpanDays, historicalConversions } = data;
  if (orders >= 5 && clicks >= 30 && (dataSpanDays || 0) >= 14) return "proven";
  if ((historicalConversions || orders) >= 8) return "proven";
  if (orders >= 3 && clicks >= 20) return "mature";
  if (orders >= 2 && clicks >= 10) return "moderate";
  if (orders >= 1 || clicks >= 15) return "emerging";
  return "insufficient";
}
function assessValueLevel(cvr, acos, orders, clicks, targetAcos) {
  if (clicks < 5) return "unknown";
  if (orders >= 3 && cvr >= 10 && acos < targetAcos * 0.7) return "high_profit";
  if (orders >= 2 && acos <= targetAcos) return "profitable";
  if (orders >= 1 && acos <= targetAcos * 1.5) return "potential";
  if (orders >= 1 && acos > targetAcos * 1.5) return "marginal";
  if (clicks >= 10 && orders === 0) return "negative";
  return "unknown";
}
function decideKeywordTargeting(data, cvr, acos, roas, cpc, aov, orders, clicks, dataMaturity, valueLevel) {
  const { searchTerm, targetAcos, spend, sales } = data;
  const cleanText = sanitizeAndValidateKeyword(searchTerm, "positive").sanitizedText || searchTerm;
  const spendThreshold = aov > 0 ? aov * (targetAcos / 100) * 1.5 : spend;
  const spendExceeded = spend >= spendThreshold;
  if (clicks >= 15 && orders === 0 && spendExceeded) {
    return {
      action: "CREATE_NEGATIVE_KEYWORD",
      targetValue: cleanText,
      negativeMatchType: "negative_exact",
      negativeType: "keyword",
      // v2: 明确否定类型
      negativeScope: "campaign",
      // v2: SP Manual支持Campaign级
      campaignType: "sp",
      // v2: 来源广告类型
      reason: `\u9AD8\u70B9\u51FB\u65E0\u8F6C\u5316: ${clicks}\u6B21\u70B9\u51FB, 0\u8BA2\u5355, \u82B1\u8D39$${spend.toFixed(2)}(AOV=$${aov.toFixed(0)}, \u8D85\u8FC7\u5BB9\u5FCD\u7EBF$${spendThreshold.toFixed(2)})`,
      confidence: Math.min(0.95, 0.6 + clicks / 100),
      // @ts-ignore
      dataMaturityLevel: String(dataMaturity),
      valueLevel: "negative"
    };
  }
  if (clicks >= 15 && orders === 0 && !spendExceeded) {
    return {
      action: "MONITOR",
      targetValue: cleanText,
      reason: `\u9AD8\u70B9\u51FB\u65E0\u8F6C\u5316\u4F46\u82B1\u8D39\u672A\u8FBE\u5BA2\u5355\u4EF7\u5BB9\u5FCD\u7EBF: ${clicks}\u6B21\u70B9\u51FB, \u82B1\u8D39$${spend.toFixed(2)}(AOV=$${aov.toFixed(0)}, \u5BB9\u5FCD\u7EBF$${spendThreshold.toFixed(2)}), \u7EE7\u7EED\u89C2\u5BDF`,
      // @ts-ignore
      confidence: 0.5,
      // @ts-ignore
      dataMaturityLevel: String(dataMaturity),
      valueLevel: "unknown"
    };
  }
  if (clicks >= 8 && clicks < 15 && orders === 0) {
    return {
      action: "MONITOR",
      targetValue: cleanText,
      // @ts-ignore
      reason: `\u4E2D\u7B49\u70B9\u51FB\u65E0\u8F6C\u5316: ${clicks}\u6B21\u70B9\u51FB, 0\u8BA2\u5355, \u82B1\u8D39$${spend.toFixed(2)}, \u9700\u8981\u66F4\u591A\u6570\u636E`,
      confidence: 0.5,
      // @ts-ignore
      dataMaturityLevel: String(dataMaturity),
      valueLevel: "unknown"
    };
  }
  if ((dataMaturity === "proven" || dataMaturity === "mature" && valueLevel === "high_profit") && (valueLevel === "high_profit" || valueLevel === "profitable")) {
    const optimalBid = calculateOptimalBid(cvr, aov, targetAcos, "exact");
    return {
      action: "CREATE_KEYWORD",
      targetValue: cleanText,
      matchType: "exact",
      suggestedBid: optimalBid,
      // @ts-ignore
      reason: `[\u7CBE\u786E\u6536\u5272] ${orders}\u5355, CVR=${cvr.toFixed(1)}%, ACoS=${acos.toFixed(1)}%, \u6570\u636E\u6210\u719F\u5EA6=${dataMaturity}, \u4EF7\u503C=${valueLevel}`,
      confidence: Math.min(0.95, 0.7 + orders / 20),
      // @ts-ignore
      dataMaturityLevel: String(dataMaturity),
      // @ts-ignore
      valueLevel: String(valueLevel)
    };
  }
  if ((dataMaturity === "mature" || dataMaturity === "moderate") && (valueLevel === "profitable" || valueLevel === "potential" || valueLevel === "high_profit")) {
    const optimalBid = calculateOptimalBid(cvr, aov, targetAcos, "phrase");
    return {
      action: "CREATE_KEYWORD",
      targetValue: cleanText,
      // @ts-ignore
      matchType: "phrase",
      // @ts-ignore
      suggestedBid: optimalBid,
      reason: `[\u77ED\u8BED\u6295\u653E] ${orders}\u5355, CVR=${cvr.toFixed(1)}%, ACoS=${acos.toFixed(1)}%, \u6570\u636E\u6210\u719F\u5EA6=${dataMaturity}, \u4EF7\u503C=${valueLevel}`,
      confidence: Math.min(0.9, 0.6 + orders / 15),
      // @ts-ignore
      dataMaturityLevel: String(dataMaturity),
      // @ts-ignore
      valueLevel: String(valueLevel)
    };
  }
  if (dataMaturity === "emerging" && (valueLevel === "potential" || valueLevel === "profitable" || valueLevel === "unknown")) {
    const optimalBid = calculateOptimalBid(cvr, aov, targetAcos, "broad");
    return {
      // @ts-ignore
      action: "CREATE_KEYWORD",
      // @ts-ignore
      targetValue: cleanText,
      matchType: "broad",
      suggestedBid: optimalBid,
      reason: `[\u5E7F\u6CDB\u63A2\u7D22] ${orders}\u5355, ${clicks}\u6B21\u70B9\u51FB, CVR=${cvr.toFixed(1)}%, \u6570\u636E\u6210\u719F\u5EA6=${dataMaturity}, \u4EF7\u503C=${valueLevel}`,
      confidence: Math.min(0.75, 0.4 + orders / 10),
      // @ts-ignore
      dataMaturityLevel: String(dataMaturity),
      // @ts-ignore
      valueLevel: String(valueLevel)
    };
  }
  if (valueLevel === "marginal") {
    return {
      action: "MONITOR",
      targetValue: cleanText,
      reason: `\u8FB9\u9645\u641C\u7D22\u8BCD: ${orders}\u5355, ACoS=${acos.toFixed(1)}%(\u76EE\u6807${targetAcos}%), \u6682\u4E0D\u6295\u653E`,
      confidence: 0.6,
      // @ts-ignore
      dataMaturityLevel: String(dataMaturity),
      // @ts-ignore
      valueLevel: "marginal"
      // @ts-ignore
    };
  }
  return {
    action: "MONITOR",
    targetValue: cleanText,
    reason: `\u6570\u636E\u4E0D\u8DB3: ${clicks}\u6B21\u70B9\u51FB, ${orders}\u5355, \u9700\u8981\u66F4\u591A\u6570\u636E`,
    confidence: 0.3,
    // @ts-ignore
    dataMaturityLevel: String(dataMaturity),
    // @ts-ignore
    valueLevel: String(valueLevel)
  };
}
function decideAsinTargetingV2(data, cvr, acos, orders, clicks, dataMaturity, valueLevel, normalizedCampaignType) {
  const { searchTerm, targetAcos, spend, sales } = data;
  const aov = orders > 0 ? sales / orders : 0;
  const clickToSpendRatio = clicks > 0 ? spend / clicks : 0;
  const toleranceMultiplier = clickToSpendRatio > 2 ? 2 : (
    // 高CPC: 2x容忍
    clickToSpendRatio > 1 ? 1.5 : (
      // 中CPC: 1.5x容忍
      1.2
    )
  );
  const spendThreshold = aov > 0 ? aov * (targetAcos / 100) * toleranceMultiplier : spend;
  const spendExceeded = spend >= spendThreshold;
  const dynamicClickThreshold = aov > 100 ? 20 : (
    // 高客单价: 20次点击
    aov > 30 ? 15 : (
      // 中客单价: 15次点击
      10
    )
  );
  const campaignTargetingType = data.campaignTargetingType || "manual";
  const negativeScope = normalizedCampaignType === "sp" && campaignTargetingType === "auto" ? "campaign" : "ad_group";
  if (clicks >= dynamicClickThreshold && orders === 0 && spendExceeded) {
    return {
      action: "CREATE_NEGATIVE_PRODUCT_TARGET",
      // v2: 修正！ASIN应用否定产品定向
      targetValue: searchTerm.trim(),
      negativeType: "product",
      negativeScope,
      campaignType: normalizedCampaignType,
      reason: `[\u5426\u5B9AASIN-${normalizedCampaignType.toUpperCase()}] \u9AD8\u70B9\u51FB\u65E0\u8F6C\u5316: ${clicks}\u6B21\u70B9\u51FB, \u82B1\u8D39$${spend.toFixed(2)}${aov > 0 ? `(AOV=$${aov.toFixed(0)})` : ""}, \u5C42\u7EA7=${negativeScope}`,
      confidence: Math.min(0.9, 0.5 + clicks / 50),
      // @ts-ignore
      dataMaturityLevel: String(dataMaturity),
      valueLevel: "negative"
    };
  }
  if (clicks >= dynamicClickThreshold && orders === 0 && !spendExceeded) {
    return {
      action: "MONITOR",
      targetValue: searchTerm.trim(),
      reason: `\u9AD8\u70B9\u51FB\u65E0\u8F6C\u5316ASIN\u4F46\u82B1\u8D39\u672A\u8FBE\u5BB9\u5FCD\u7EBF: ${clicks}\u6B21\u70B9\u51FB, \u82B1\u8D39$${spend.toFixed(2)}(AOV=$${aov.toFixed(0)}), \u7EE7\u7EED\u89C2\u5BDF`,
      confidence: 0.5,
      // @ts-ignore
      dataMaturityLevel: String(dataMaturity),
      valueLevel: "unknown"
    };
  }
  if (orders >= 3 && acos <= targetAcos * 1.1 && (dataMaturity === "proven" || dataMaturity === "mature")) {
    const optimalBid = calculateOptimalBid(cvr, aov, targetAcos, "exact");
    return {
      action: "CREATE_PRODUCT_TARGET",
      targetValue: searchTerm.trim(),
      productTargetingType: "exact",
      suggestedBid: optimalBid,
      reason: `[\u7CBE\u786EASIN\u5B9A\u5411] ${orders}\u5355, CVR=${cvr.toFixed(1)}%, ACoS=${acos.toFixed(1)}%`,
      confidence: Math.min(0.9, 0.6 + orders / 15),
      // @ts-ignore
      dataMaturityLevel: String(dataMaturity),
      // @ts-ignore
      valueLevel: String(valueLevel)
    };
  }
  if (orders >= 1 && acos <= targetAcos * 1.5 && (dataMaturity === "moderate" || dataMaturity === "mature" || dataMaturity === "emerging")) {
    const optimalBid = calculateOptimalBid(cvr, aov, targetAcos, "broad");
    return {
      action: "CREATE_PRODUCT_TARGET",
      // @ts-ignore
      targetValue: searchTerm.trim(),
      // @ts-ignore
      productTargetingType: "expanded",
      suggestedBid: optimalBid,
      reason: `[\u6269\u5C55ASIN\u5B9A\u5411] ${orders}\u5355, CVR=${cvr.toFixed(1)}%, ACoS=${acos.toFixed(1)}%`,
      confidence: Math.min(0.8, 0.5 + orders / 10),
      // @ts-ignore
      dataMaturityLevel: String(dataMaturity),
      // @ts-ignore
      valueLevel: String(valueLevel)
    };
  }
  return {
    action: "MONITOR",
    targetValue: searchTerm.trim(),
    reason: `ASIN\u6570\u636E\u4E0D\u8DB3: ${clicks}\u6B21\u70B9\u51FB, ${orders}\u5355`,
    confidence: 0.3,
    // @ts-ignore
    dataMaturityLevel: String(dataMaturity),
    // @ts-ignore
    valueLevel: String(valueLevel)
  };
}
function decideAutoTargetingAction(data, cvr, acos, orders, clicks, dataMaturity, valueLevel) {
  const { searchTerm, spend, sales, targetAcos } = data;
  const cleanText = sanitizeAndValidateKeyword(searchTerm, "negative_exact").sanitizedText || searchTerm;
  const aov = orders > 0 ? sales / orders : 0;
  const spendThreshold = aov > 0 ? aov * (targetAcos / 100) * 1.2 : 0;
  const spendExceeded = aov === 0 || spend >= spendThreshold;
  if (clicks >= 15 && orders === 0 && spendExceeded) {
    return {
      action: "CREATE_NEGATIVE_KEYWORD",
      targetValue: cleanText,
      negativeMatchType: "negative_exact",
      negativeType: "keyword",
      // v2: 明确否定类型
      // @ts-ignore
      negativeScope: "campaign",
      // v2: SP Auto支持Campaign级
      campaignType: "sp",
      // v2: 自动广告属于SP
      reason: `[\u81EA\u52A8\u5E7F\u544A] \u9AD8\u70B9\u51FB\u65E0\u8F6C\u5316: ${clicks}\u6B21\u70B9\u51FB, \u82B1\u8D39$${spend.toFixed(2)}${aov > 0 ? `(AOV=$${aov.toFixed(0)})` : ""}`,
      confidence: Math.min(0.95, 0.6 + clicks / 100),
      // @ts-ignore
      dataMaturityLevel: String(dataMaturity),
      valueLevel: "negative"
    };
  }
  if (clicks >= 10 && orders === 0 && spendExceeded) {
    return {
      action: "CREATE_NEGATIVE_KEYWORD",
      targetValue: cleanText,
      negativeMatchType: "negative_exact",
      negativeType: "keyword",
      // v2
      negativeScope: "campaign",
      // v2
      campaignType: "sp",
      // v2
      reason: `[\u81EA\u52A8\u5E7F\u544A] \u4E2D\u7B49\u70B9\u51FB\u65E0\u8F6C\u5316: ${clicks}\u6B21\u70B9\u51FB, \u82B1\u8D39$${spend.toFixed(2)}${aov > 0 ? `(AOV=$${aov.toFixed(0)})` : ""}`,
      confidence: Math.min(0.85, 0.5 + clicks / 50),
      // @ts-ignore
      dataMaturityLevel: String(dataMaturity),
      // @ts-ignore
      valueLevel: "negative"
      // @ts-ignore
    };
  }
  if (clicks >= 10 && orders === 0 && !spendExceeded) {
    return {
      action: "MONITOR",
      targetValue: cleanText,
      reason: `[\u81EA\u52A8\u5E7F\u544A] \u70B9\u51FB${clicks}\u6B21\u65E0\u8F6C\u5316\u4F46\u82B1\u8D39\u672A\u8FBE\u5BA2\u5355\u4EF7\u5BB9\u5FCD\u7EBF: \u82B1\u8D39$${spend.toFixed(2)}(AOV=$${aov.toFixed(0)}), \u7EE7\u7EED\u89C2\u5BDF`,
      confidence: 0.5,
      // @ts-ignore
      dataMaturityLevel: String(dataMaturity),
      valueLevel: "unknown"
    };
  }
  return {
    action: "MONITOR",
    targetValue: cleanText,
    reason: `[\u81EA\u52A8\u5E7F\u544A] ${orders > 0 ? "\u6709\u8F6C\u5316\u8BCD\u7B49\u5F85\u624B\u52A8\u6536\u5272" : "\u6570\u636E\u4E0D\u8DB3\u7EE7\u7EED\u89C2\u5BDF"}: ${clicks}\u70B9\u51FB, ${orders}\u5355`,
    confidence: 0.5,
    // @ts-ignore
    dataMaturityLevel: String(dataMaturity),
    // @ts-ignore
    valueLevel: String(valueLevel)
  };
}
function calculateOptimalBid(cvr, aov, targetAcos, matchType) {
  const baseBid = cvr / 100 * aov * (targetAcos / 100);
  const matchTypeMultiplier = {
    "exact": 1,
    // 精确匹配: 全额出价
    "phrase": 0.9,
    // 短语匹配: 90%出价
    "broad": 0.75
    // 广泛匹配: 75%出价
  };
  const multiplier = matchTypeMultiplier[matchType] || 0.85;
  let finalBid = baseBid * multiplier;
  finalBid = Math.max(0.1, finalBid);
  finalBid = Math.min(10, finalBid);
  return Math.round(finalBid * 100) / 100;
}
function decideSbKeywordTargeting(data, cvr, acos, roas, cpc, aov, orders, clicks, dataMaturity, valueLevel) {
  const { searchTerm, targetAcos, spend, sales } = data;
  const cleanText = sanitizeAndValidateKeyword(searchTerm, "positive").sanitizedText || searchTerm;
  const spendThreshold = aov > 0 ? aov * (targetAcos / 100) * 1.5 : spend;
  const spendExceeded = spend >= spendThreshold;
  if (clicks >= 15 && orders === 0 && spendExceeded) {
    return {
      action: "CREATE_NEGATIVE_KEYWORD",
      targetValue: cleanText,
      negativeMatchType: "negative_exact",
      negativeType: "keyword",
      negativeScope: "ad_group",
      // SB仅支持Ad Group级
      campaignType: "sb",
      reason: `[SB\u5426\u5B9A\u5173\u952E\u8BCD] \u9AD8\u70B9\u51FB\u65E0\u8F6C\u5316: ${clicks}\u6B21\u70B9\u51FB, \u82B1\u8D39$${spend.toFixed(2)}, \u5C42\u7EA7=ad_group`,
      // @ts-ignore
      confidence: Math.min(0.95, 0.6 + clicks / 100),
      // @ts-ignore
      dataMaturityLevel: String(dataMaturity),
      valueLevel: "negative"
    };
  }
  if (clicks >= 15 && orders === 0 && !spendExceeded) {
    return {
      action: "MONITOR",
      targetValue: cleanText,
      reason: `[SB] \u9AD8\u70B9\u51FB\u65E0\u8F6C\u5316\u4F46\u82B1\u8D39\u672A\u8FBE\u5BB9\u5FCD\u7EBF: ${clicks}\u6B21\u70B9\u51FB, \u82B1\u8D39$${spend.toFixed(2)}(AOV=$${aov.toFixed(0)}), \u7EE7\u7EED\u89C2\u5BDF`,
      confidence: 0.5,
      // @ts-ignore
      dataMaturityLevel: String(dataMaturity),
      valueLevel: "unknown"
    };
  }
  if (clicks >= 8 && clicks < 15 && orders === 0) {
    return {
      action: "MONITOR",
      targetValue: cleanText,
      reason: `[SB] \u4E2D\u7B49\u70B9\u51FB\u65E0\u8F6C\u5316: ${clicks}\u6B21\u70B9\u51FB, \u9700\u8981\u66F4\u591A\u6570\u636E`,
      confidence: 0.5,
      // @ts-ignore
      dataMaturityLevel: String(dataMaturity),
      valueLevel: "unknown"
    };
  }
  if ((dataMaturity === "proven" || dataMaturity === "mature" && valueLevel === "high_profit") && // @ts-ignore
  (valueLevel === "high_profit" || valueLevel === "profitable")) {
    const optimalBid = calculateOptimalBid(cvr, aov, targetAcos, "exact");
    return {
      action: "CREATE_KEYWORD",
      targetValue: cleanText,
      matchType: "exact",
      suggestedBid: optimalBid,
      reason: `[SB\u7CBE\u786E\u6536\u5272] ${orders}\u5355, CVR=${cvr.toFixed(1)}%, ACoS=${acos.toFixed(1)}%`,
      confidence: Math.min(0.95, 0.7 + orders / 20),
      // @ts-ignore
      dataMaturityLevel: String(dataMaturity),
      // @ts-ignore
      valueLevel: String(valueLevel)
    };
  }
  if (
    // @ts-ignore
    (dataMaturity === "mature" || dataMaturity === "moderate") && (valueLevel === "profitable" || valueLevel === "potential" || valueLevel === "high_profit")
  ) {
    const optimalBid = calculateOptimalBid(cvr, aov, targetAcos, "phrase");
    return {
      action: "CREATE_KEYWORD",
      targetValue: cleanText,
      matchType: "phrase",
      suggestedBid: optimalBid,
      reason: `[SB\u77ED\u8BED\u6295\u653E] ${orders}\u5355, CVR=${cvr.toFixed(1)}%, ACoS=${acos.toFixed(1)}%`,
      // @ts-ignore
      confidence: Math.min(0.9, 0.6 + orders / 15),
      // @ts-ignore
      dataMaturityLevel: String(dataMaturity),
      // @ts-ignore
      valueLevel: String(valueLevel)
    };
  }
  if (dataMaturity === "emerging" && (valueLevel === "potential" || valueLevel === "profitable" || valueLevel === "unknown")) {
    const optimalBid = calculateOptimalBid(cvr, aov, targetAcos, "broad");
    return {
      action: "CREATE_KEYWORD",
      targetValue: cleanText,
      matchType: "broad",
      suggestedBid: optimalBid,
      reason: `[SB\u5E7F\u6CDB\u63A2\u7D22] ${orders}\u5355, ${clicks}\u6B21\u70B9\u51FB`,
      confidence: Math.min(0.75, 0.4 + orders / 10),
      // @ts-ignore
      dataMaturityLevel: String(dataMaturity),
      // @ts-ignore
      valueLevel: String(valueLevel)
    };
  }
  return {
    action: "MONITOR",
    targetValue: cleanText,
    reason: `[SB] ${valueLevel === "marginal" ? "\u8FB9\u9645\u641C\u7D22\u8BCD" : "\u6570\u636E\u4E0D\u8DB3"}: ${clicks}\u6B21\u70B9\u51FB, ${orders}\u5355`,
    confidence: 0.3,
    // @ts-ignore
    dataMaturityLevel: String(dataMaturity),
    // @ts-ignore
    valueLevel: String(valueLevel)
  };
}
function decideSdKeywordTargeting(data, cvr, acos, roas, cpc, aov, orders, clicks, dataMaturity, valueLevel) {
  const { searchTerm, targetAcos, spend } = data;
  const cleanText = sanitizeAndValidateKeyword(searchTerm, "positive").sanitizedText || searchTerm;
  if (clicks >= 15 && orders === 0) {
    return {
      action: "MONITOR",
      targetValue: cleanText,
      reason: `[SD-\u65E0\u6CD5\u5426\u5B9A\u5173\u952E\u8BCD] \u9AD8\u70B9\u51FB\u65E0\u8F6C\u5316: ${clicks}\u6B21\u70B9\u51FB, \u82B1\u8D39$${spend.toFixed(2)}, SD\u4E0D\u652F\u6301\u5426\u5B9A\u5173\u952E\u8BCD`,
      confidence: 0.5,
      // @ts-ignore
      dataMaturityLevel: String(dataMaturity),
      valueLevel: "negative"
    };
  }
  return {
    action: "MONITOR",
    targetValue: cleanText,
    reason: `[SD] ${orders > 0 ? "\u6709\u8F6C\u5316\u8BCD" : "\u6570\u636E\u4E0D\u8DB3"}: ${clicks}\u6B21\u70B9\u51FB, ${orders}\u5355, SD\u5173\u952E\u8BCD\u4EC5\u652F\u6301\u76D1\u63A7`,
    confidence: 0.3,
    // @ts-ignore
    dataMaturityLevel: String(dataMaturity),
    // @ts-ignore
    valueLevel: String(valueLevel)
  };
}
var log102;
var init_targetingAlgorithm = __esm({
  "server/services/targetingAlgorithm.ts"() {
    "use strict";
    init_keywordValidator();
    init_logger();
    log102 = createModuleLogger("TargetingAlgorithm");
    __name(decideTargeting, "decideTargeting");
    __name(normalizeCampaignType, "normalizeCampaignType");
    __name(assessDataMaturity, "assessDataMaturity");
    __name(assessValueLevel, "assessValueLevel");
    __name(decideKeywordTargeting, "decideKeywordTargeting");
    __name(decideAsinTargetingV2, "decideAsinTargetingV2");
    __name(decideAutoTargetingAction, "decideAutoTargetingAction");
    __name(calculateOptimalBid, "calculateOptimalBid");
    __name(decideSbKeywordTargeting, "decideSbKeywordTargeting");
    __name(decideSdKeywordTargeting, "decideSdKeywordTargeting");
  }
});

