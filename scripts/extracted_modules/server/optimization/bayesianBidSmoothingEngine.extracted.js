// Extracted from production dist/index.js
// Original module: server/optimization/bayesianBidSmoothingEngine.ts
// Lines: 486

async function estimateKeywordBid(accountId, currentBid, matchType, campaignType, entityPerformance, campaignId) {
  try {
    let prior = null;
    if (campaignId) {
      prior = await buildCampaignLevelKeywordPrior(accountId, campaignId, matchType);
      if (prior) {
        log53.debug(`[BayesianBidSmoothing] \u4F7F\u7528\u6D3B\u52A8\u7EA7\u5148\u9A8C: ${prior.source}`);
      }
    }
    if (!prior || prior.priorSampleCount < 3) {
      prior = await buildKeywordPrior(accountId, matchType);
    }
    if (!prior || prior.priorSampleCount < BAYESIAN_CONFIG.MIN_PRIOR_SAMPLES) {
      return createFailedEstimate(currentBid, "\u540C\u7C7B\u5173\u952E\u8BCD\u6570\u636E\u4E0D\u8DB3\uFF0C\u65E0\u6CD5\u6784\u5EFA\u6709\u6548\u5148\u9A8C");
    }
    const posterior = calculatePosterior(prior, currentBid, entityPerformance);
    return posterior;
  } catch (err) {
    log53.warn(`[BayesianBidSmoothing] \u5173\u952E\u8BCD\u7ADE\u4EF7\u63A8\u65AD\u5F02\u5E38: ${err.message}`);
    return createFailedEstimate(currentBid, `\u63A8\u65AD\u5F02\u5E38: ${err.message}`);
  }
}
async function estimateProductTargetBid(accountId, currentBid, targetType, entityPerformance, campaignId) {
  try {
    let prior = null;
    if (campaignId) {
      prior = await buildCampaignLevelTargetPrior(accountId, campaignId, targetType);
      if (prior) {
        log53.debug(`[BayesianBidSmoothing] \u4F7F\u7528\u6D3B\u52A8\u7EA7\u5148\u9A8C: ${prior.source}`);
      }
    }
    if (!prior || prior.priorSampleCount < 3) {
      prior = await buildProductTargetPrior(accountId, targetType);
    }
    if (!prior || prior.priorSampleCount < BAYESIAN_CONFIG.MIN_PRIOR_SAMPLES) {
      return createFailedEstimate(currentBid, "\u540C\u7C7B\u5546\u54C1\u5B9A\u5411\u6570\u636E\u4E0D\u8DB3\uFF0C\u65E0\u6CD5\u6784\u5EFA\u6709\u6548\u5148\u9A8C");
    }
    return calculatePosterior(prior, currentBid, entityPerformance);
  } catch (err) {
    log53.warn(`[BayesianBidSmoothing] \u5546\u54C1\u5B9A\u5411\u7ADE\u4EF7\u63A8\u65AD\u5F02\u5E38: ${err.message}`);
    return createFailedEstimate(currentBid, `\u63A8\u65AD\u5F02\u5E38: ${err.message}`);
  }
}
async function estimateAutoTargetingBid(accountId, currentBid, targetingType) {
  try {
    const prior = await buildAutoTargetingPrior(accountId, targetingType);
    if (!prior || prior.priorSampleCount < BAYESIAN_CONFIG.MIN_PRIOR_SAMPLES) {
      return createFailedEstimate(currentBid, "\u540C\u7C7B\u81EA\u52A8\u5339\u914D\u5F62\u5F0F\u6570\u636E\u4E0D\u8DB3\uFF0C\u65E0\u6CD5\u6784\u5EFA\u6709\u6548\u5148\u9A8C");
    }
    return calculatePosterior(prior, currentBid, void 0);
  } catch (err) {
    log53.warn(`[BayesianBidSmoothing] \u81EA\u52A8\u5339\u914D\u7ADE\u4EF7\u63A8\u65AD\u5F02\u5E38: ${err.message}`);
    return createFailedEstimate(currentBid, `\u63A8\u65AD\u5F02\u5E38: ${err.message}`);
  }
}
async function estimateAudienceBid(accountId, currentBid, audienceType) {
  try {
    const prior = await buildAudiencePrior(accountId, audienceType);
    if (!prior || prior.priorSampleCount < BAYESIAN_CONFIG.MIN_PRIOR_SAMPLES) {
      return createFailedEstimate(currentBid, "\u540C\u7C7B\u53D7\u4F17\u6570\u636E\u4E0D\u8DB3\uFF0C\u65E0\u6CD5\u6784\u5EFA\u6709\u6548\u5148\u9A8C");
    }
    return calculatePosterior(prior, currentBid, void 0);
  } catch (err) {
    log53.warn(`[BayesianBidSmoothing] \u53D7\u4F17\u7ADE\u4EF7\u63A8\u65AD\u5F02\u5E38: ${err.message}`);
    return createFailedEstimate(currentBid, `\u63A8\u65AD\u5F02\u5E38: ${err.message}`);
  }
}
async function estimateBid(accountId, entityType, currentBid, subType, entityPerformance) {
  switch (entityType) {
    case "keyword":
      return estimateKeywordBid(accountId, currentBid, subType, void 0, entityPerformance);
    case "product_target":
      return estimateProductTargetBid(accountId, currentBid, subType, entityPerformance);
    case "auto_targeting":
      return estimateAutoTargetingBid(accountId, currentBid, subType);
    case "audience":
      return estimateAudienceBid(accountId, currentBid, subType);
    default:
      return createFailedEstimate(currentBid, `\u672A\u77E5\u5B9E\u4F53\u7C7B\u578B: ${entityType}`);
  }
}
async function buildCampaignLevelKeywordPrior(accountId, campaignId, matchType) {
  const db = await getDb();
  if (!db) return null;
  const conditions = [
    eq(keywords.accountId, accountId),
    eq(keywords.campaignId, campaignId),
    eq(keywords.keywordStatus, "enabled"),
    gt(keywords.bid, "0")
  ];
  if (matchType) {
    conditions.push(eq(keywords.matchType, matchType));
  }
  const [stats4] = await db.select({
    count: sql`COUNT(*)`,
    avgBid: sql`AVG(CAST(${keywords.bid} AS DECIMAL(10,4)))`,
    stdBid: sql`STDDEV(CAST(${keywords.bid} AS DECIMAL(10,4)))`,
    suggestedBidCount: sql`SUM(CASE WHEN ${keywords.suggestedBid} IS NOT NULL AND ${keywords.suggestedBid} > 0 THEN 1 ELSE 0 END)`,
    avgSuggestedBid: sql`AVG(CASE WHEN ${keywords.suggestedBid} IS NOT NULL AND ${keywords.suggestedBid} > 0 THEN CAST(${keywords.suggestedBid} AS DECIMAL(10,4)) ELSE NULL END)`,
    avgCpc: sql`AVG(CASE WHEN ${keywords.keywordCpc} IS NOT NULL AND ${keywords.keywordCpc} > 0 THEN CAST(${keywords.keywordCpc} AS DECIMAL(10,4)) ELSE NULL END)`
  }).from(keywords).where(and(...conditions));
  const count11 = Number(stats4?.count || 0);
  if (count11 < 3) {
    if (matchType) {
      return buildCampaignLevelKeywordPrior(accountId, campaignId, void 0);
    }
    return null;
  }
  const avgBid = Number(stats4?.avgBid || 0);
  const stdBid = Number(stats4?.stdBid || 0) || avgBid * BAYESIAN_CONFIG.DEFAULT_CV;
  const suggestedBidCount = Number(stats4?.suggestedBidCount || 0);
  const avgSuggestedBid = stats4?.avgSuggestedBid ? Number(stats4.avgSuggestedBid) : null;
  const avgCpc = stats4?.avgCpc ? Number(stats4.avgCpc) : null;
  let priorMean;
  let source;
  if (avgSuggestedBid && suggestedBidCount >= 2) {
    priorMean = avgSuggestedBid * 0.6 + avgBid * 0.4;
    source = `\u6D3B\u52A8\u7EA7suggestedBid\u52A0\u6743(${suggestedBidCount}\u4E2AsuggestedBid, ${count11}\u4E2Abid, campaign=${campaignId})`;
  } else if (avgCpc && avgCpc > 0) {
    priorMean = avgCpc * 0.5 + avgBid * 0.5;
    source = `\u6D3B\u52A8\u7EA7CPC\u52A0\u6743(avgCpc=$${avgCpc.toFixed(2)}, ${count11}\u4E2Abid, campaign=${campaignId})`;
  } else {
    priorMean = avgBid;
    source = `\u6D3B\u52A8\u7EA7bid\u5747\u503C(${count11}\u4E2A${matchType || "\u5168\u90E8"}\u5173\u952E\u8BCD, campaign=${campaignId})`;
  }
  return {
    priorMean: Math.max(0.02, priorMean),
    priorStd: Math.max(0.01, stdBid),
    priorSampleCount: count11,
    suggestedBidCount,
    suggestedBidMean: avgSuggestedBid,
    source
  };
}
async function buildCampaignLevelTargetPrior(accountId, campaignId, targetType) {
  const db = await getDb();
  if (!db) return null;
  const conditions = [
    eq(productTargets.accountId, accountId),
    eq(productTargets.campaignId, campaignId),
    eq(productTargets.targetStatus, "enabled"),
    gt(productTargets.bid, "0")
  ];
  if (targetType) {
    conditions.push(eq(productTargets.targetType, targetType));
  }
  const [stats4] = await db.select({
    count: sql`COUNT(*)`,
    avgBid: sql`AVG(CAST(${productTargets.bid} AS DECIMAL(10,4)))`,
    stdBid: sql`STDDEV(CAST(${productTargets.bid} AS DECIMAL(10,4)))`,
    suggestedBidCount: sql`SUM(CASE WHEN ${productTargets.suggestedBid} IS NOT NULL AND ${productTargets.suggestedBid} > 0 THEN 1 ELSE 0 END)`,
    avgSuggestedBid: sql`AVG(CASE WHEN ${productTargets.suggestedBid} IS NOT NULL AND ${productTargets.suggestedBid} > 0 THEN CAST(${productTargets.suggestedBid} AS DECIMAL(10,4)) ELSE NULL END)`,
    avgCpc: sql`AVG(CASE WHEN ${productTargets.targetCpc} IS NOT NULL AND ${productTargets.targetCpc} > 0 THEN CAST(${productTargets.targetCpc} AS DECIMAL(10,4)) ELSE NULL END)`
  }).from(productTargets).where(and(...conditions));
  const count11 = Number(stats4?.count || 0);
  if (count11 < 3) {
    if (targetType) {
      return buildCampaignLevelTargetPrior(accountId, campaignId, void 0);
    }
    return null;
  }
  const avgBid = Number(stats4?.avgBid || 0);
  const stdBid = Number(stats4?.stdBid || 0) || avgBid * BAYESIAN_CONFIG.DEFAULT_CV;
  const suggestedBidCount = Number(stats4?.suggestedBidCount || 0);
  const avgSuggestedBid = stats4?.avgSuggestedBid ? Number(stats4.avgSuggestedBid) : null;
  const avgCpc = stats4?.avgCpc ? Number(stats4.avgCpc) : null;
  let priorMean;
  let source;
  if (avgSuggestedBid && suggestedBidCount >= 2) {
    priorMean = avgSuggestedBid * 0.6 + avgBid * 0.4;
    source = `\u6D3B\u52A8\u7EA7suggestedBid\u52A0\u6743(${suggestedBidCount}\u4E2AsuggestedBid, ${count11}\u4E2A${targetType || "\u5168\u90E8"}\u5B9A\u5411, campaign=${campaignId})`;
  } else if (avgCpc && avgCpc > 0) {
    priorMean = avgCpc * 0.5 + avgBid * 0.5;
    source = `\u6D3B\u52A8\u7EA7CPC\u52A0\u6743(avgCpc=$${avgCpc.toFixed(2)}, ${count11}\u4E2A\u5B9A\u5411, campaign=${campaignId})`;
  } else {
    priorMean = avgBid;
    source = `\u6D3B\u52A8\u7EA7bid\u5747\u503C(${count11}\u4E2A${targetType || "\u5168\u90E8"}\u5B9A\u5411, campaign=${campaignId})`;
  }
  return {
    priorMean: Math.max(0.02, priorMean),
    priorStd: Math.max(0.01, stdBid),
    priorSampleCount: count11,
    suggestedBidCount,
    suggestedBidMean: avgSuggestedBid,
    source
  };
}
async function buildKeywordPrior(accountId, matchType) {
  const db = await getDb();
  if (!db) return null;
  const conditions = [
    eq(keywords.accountId, accountId),
    eq(keywords.keywordStatus, "enabled"),
    gt(keywords.bid, "0")
  ];
  if (matchType) {
    conditions.push(eq(keywords.matchType, matchType));
  }
  const [stats4] = await db.select({
    count: sql`COUNT(*)`,
    avgBid: sql`AVG(CAST(${keywords.bid} AS DECIMAL(10,4)))`,
    stdBid: sql`STDDEV(CAST(${keywords.bid} AS DECIMAL(10,4)))`,
    suggestedBidCount: sql`SUM(CASE WHEN ${keywords.suggestedBid} IS NOT NULL AND ${keywords.suggestedBid} > 0 THEN 1 ELSE 0 END)`,
    avgSuggestedBid: sql`AVG(CASE WHEN ${keywords.suggestedBid} IS NOT NULL AND ${keywords.suggestedBid} > 0 THEN CAST(${keywords.suggestedBid} AS DECIMAL(10,4)) ELSE NULL END)`,
    avgCpc: sql`AVG(CASE WHEN ${keywords.keywordCpc} IS NOT NULL AND ${keywords.keywordCpc} > 0 THEN CAST(${keywords.keywordCpc} AS DECIMAL(10,4)) ELSE NULL END)`
  }).from(keywords).where(and(...conditions));
  const count11 = Number(stats4?.count || 0);
  if (count11 < BAYESIAN_CONFIG.MIN_PRIOR_SAMPLES) {
    if (matchType) {
      return buildKeywordPrior(accountId, void 0);
    }
    return null;
  }
  const avgBid = Number(stats4?.avgBid || 0);
  const stdBid = Number(stats4?.stdBid || 0) || avgBid * BAYESIAN_CONFIG.DEFAULT_CV;
  const suggestedBidCount = Number(stats4?.suggestedBidCount || 0);
  const avgSuggestedBid = stats4?.avgSuggestedBid ? Number(stats4.avgSuggestedBid) : null;
  const avgCpc = stats4?.avgCpc ? Number(stats4.avgCpc) : null;
  let priorMean;
  let source;
  if (avgSuggestedBid && suggestedBidCount >= 3) {
    priorMean = avgSuggestedBid * 0.6 + avgBid * 0.4;
    source = `suggestedBid\u52A0\u6743(${suggestedBidCount}\u4E2AsuggestedBid, ${count11}\u4E2Abid)`;
  } else if (avgCpc && avgCpc > 0) {
    priorMean = avgCpc * 0.5 + avgBid * 0.5;
    source = `CPC\u52A0\u6743(avgCpc=$${avgCpc.toFixed(2)}, ${count11}\u4E2Abid)`;
  } else {
    priorMean = avgBid;
    source = `bid\u5747\u503C(${count11}\u4E2A${matchType || "\u5168\u90E8"}\u5173\u952E\u8BCD)`;
  }
  return {
    priorMean: Math.max(0.02, priorMean),
    priorStd: Math.max(0.01, stdBid),
    priorSampleCount: count11,
    suggestedBidCount,
    suggestedBidMean: avgSuggestedBid,
    source
  };
}
async function buildProductTargetPrior(accountId, targetType) {
  const db = await getDb();
  if (!db) return null;
  const conditions = [
    eq(productTargets.accountId, accountId),
    eq(productTargets.targetStatus, "enabled"),
    gt(productTargets.bid, "0")
  ];
  if (targetType) {
    conditions.push(eq(productTargets.targetType, targetType));
  }
  const [stats4] = await db.select({
    count: sql`COUNT(*)`,
    avgBid: sql`AVG(CAST(${productTargets.bid} AS DECIMAL(10,4)))`,
    stdBid: sql`STDDEV(CAST(${productTargets.bid} AS DECIMAL(10,4)))`,
    suggestedBidCount: sql`SUM(CASE WHEN ${productTargets.suggestedBid} IS NOT NULL AND ${productTargets.suggestedBid} > 0 THEN 1 ELSE 0 END)`,
    avgSuggestedBid: sql`AVG(CASE WHEN ${productTargets.suggestedBid} IS NOT NULL AND ${productTargets.suggestedBid} > 0 THEN CAST(${productTargets.suggestedBid} AS DECIMAL(10,4)) ELSE NULL END)`,
    avgCpc: sql`AVG(CASE WHEN ${productTargets.targetCpc} IS NOT NULL AND ${productTargets.targetCpc} > 0 THEN CAST(${productTargets.targetCpc} AS DECIMAL(10,4)) ELSE NULL END)`
  }).from(productTargets).where(and(...conditions));
  const count11 = Number(stats4?.count || 0);
  if (count11 < BAYESIAN_CONFIG.MIN_PRIOR_SAMPLES) {
    if (targetType) {
      return buildProductTargetPrior(accountId, void 0);
    }
    return null;
  }
  const avgBid = Number(stats4?.avgBid || 0);
  const stdBid = Number(stats4?.stdBid || 0) || avgBid * BAYESIAN_CONFIG.DEFAULT_CV;
  const suggestedBidCount = Number(stats4?.suggestedBidCount || 0);
  const avgSuggestedBid = stats4?.avgSuggestedBid ? Number(stats4.avgSuggestedBid) : null;
  const avgCpc = stats4?.avgCpc ? Number(stats4.avgCpc) : null;
  let priorMean;
  let source;
  if (avgSuggestedBid && suggestedBidCount >= 3) {
    priorMean = avgSuggestedBid * 0.6 + avgBid * 0.4;
    source = `suggestedBid\u52A0\u6743(${suggestedBidCount}\u4E2AsuggestedBid, ${count11}\u4E2A${targetType || "\u5168\u90E8"}\u5B9A\u5411)`;
  } else if (avgCpc && avgCpc > 0) {
    priorMean = avgCpc * 0.5 + avgBid * 0.5;
    source = `CPC\u52A0\u6743(avgCpc=$${avgCpc.toFixed(2)}, ${count11}\u4E2A\u5B9A\u5411)`;
  } else {
    priorMean = avgBid;
    source = `bid\u5747\u503C(${count11}\u4E2A${targetType || "\u5168\u90E8"}\u5B9A\u5411)`;
  }
  return {
    priorMean: Math.max(0.02, priorMean),
    priorStd: Math.max(0.01, stdBid),
    priorSampleCount: count11,
    suggestedBidCount,
    suggestedBidMean: avgSuggestedBid,
    source
  };
}
async function buildAutoTargetingPrior(accountId, targetingType) {
  const db = await getDb();
  if (!db) return null;
  const conditions = [
    eq(autoTargetingSettings.targetingStatus, "enabled")
  ];
  if (targetingType) {
    conditions.push(eq(autoTargetingSettings.targetingType, targetingType));
  }
  const [stats4] = await db.select({
    count: sql`COUNT(*)`,
    avgBid: sql`AVG(CASE WHEN ${autoTargetingSettings.bid} IS NOT NULL AND ${autoTargetingSettings.bid} > 0 THEN CAST(${autoTargetingSettings.bid} AS DECIMAL(10,4)) ELSE NULL END)`,
    stdBid: sql`STDDEV(CASE WHEN ${autoTargetingSettings.bid} IS NOT NULL AND ${autoTargetingSettings.bid} > 0 THEN CAST(${autoTargetingSettings.bid} AS DECIMAL(10,4)) ELSE NULL END)`,
    suggestedBidCount: sql`SUM(CASE WHEN ${autoTargetingSettings.suggestedBid} IS NOT NULL AND ${autoTargetingSettings.suggestedBid} > 0 THEN 1 ELSE 0 END)`,
    avgSuggestedBid: sql`AVG(CASE WHEN ${autoTargetingSettings.suggestedBid} IS NOT NULL AND ${autoTargetingSettings.suggestedBid} > 0 THEN CAST(${autoTargetingSettings.suggestedBid} AS DECIMAL(10,4)) ELSE NULL END)`
  }).from(autoTargetingSettings).where(and(...conditions));
  const count11 = Number(stats4?.count || 0);
  if (count11 < BAYESIAN_CONFIG.MIN_PRIOR_SAMPLES) {
    if (targetingType) {
      return buildAutoTargetingPrior(accountId, void 0);
    }
    return null;
  }
  const avgBid = Number(stats4?.avgBid || 0);
  const stdBid = Number(stats4?.stdBid || 0) || avgBid * BAYESIAN_CONFIG.DEFAULT_CV;
  const suggestedBidCount = Number(stats4?.suggestedBidCount || 0);
  const avgSuggestedBid = stats4?.avgSuggestedBid ? Number(stats4.avgSuggestedBid) : null;
  let priorMean;
  let source;
  if (avgSuggestedBid && suggestedBidCount >= 3) {
    priorMean = avgSuggestedBid * 0.6 + avgBid * 0.4;
    source = `suggestedBid\u52A0\u6743(${suggestedBidCount}\u4E2AsuggestedBid, ${count11}\u4E2A${targetingType || "\u5168\u90E8"}\u81EA\u52A8\u5339\u914D)`;
  } else {
    priorMean = avgBid;
    source = `bid\u5747\u503C(${count11}\u4E2A${targetingType || "\u5168\u90E8"}\u81EA\u52A8\u5339\u914D)`;
  }
  return {
    priorMean: Math.max(0.02, priorMean),
    priorStd: Math.max(0.01, stdBid),
    priorSampleCount: count11,
    suggestedBidCount,
    suggestedBidMean: avgSuggestedBid,
    source
  };
}
async function buildAudiencePrior(accountId, audienceType) {
  const db = await getDb();
  if (!db) return null;
  const conditions = [
    eq(sdAudiences.accountId, accountId),
    eq(sdAudiences.state, "enabled")
  ];
  if (audienceType) {
    conditions.push(eq(sdAudiences.audienceType, audienceType));
  }
  const [stats4] = await db.select({
    count: sql`COUNT(*)`,
    avgBid: sql`AVG(CASE WHEN ${sdAudiences.bid} IS NOT NULL AND ${sdAudiences.bid} > 0 THEN CAST(${sdAudiences.bid} AS DECIMAL(10,4)) ELSE NULL END)`,
    stdBid: sql`STDDEV(CASE WHEN ${sdAudiences.bid} IS NOT NULL AND ${sdAudiences.bid} > 0 THEN CAST(${sdAudiences.bid} AS DECIMAL(10,4)) ELSE NULL END)`
  }).from(sdAudiences).where(and(...conditions));
  const count11 = Number(stats4?.count || 0);
  if (count11 < BAYESIAN_CONFIG.MIN_PRIOR_SAMPLES) {
    if (audienceType) {
      return buildAudiencePrior(accountId, void 0);
    }
    return null;
  }
  const avgBid = Number(stats4?.avgBid || 0);
  const stdBid = Number(stats4?.stdBid || 0) || avgBid * BAYESIAN_CONFIG.DEFAULT_CV;
  return {
    priorMean: Math.max(0.02, avgBid),
    priorStd: Math.max(0.01, stdBid),
    priorSampleCount: count11,
    suggestedBidCount: 0,
    suggestedBidMean: null,
    source: `bid\u5747\u503C(${count11}\u4E2A${audienceType || "\u5168\u90E8"}\u53D7\u4F17)`
  };
}
function calculatePosterior(prior, currentBid, entityPerformance) {
  const logSamples = Math.log2(Math.max(1, prior.priorSampleCount));
  let priorWeight = Math.min(
    BAYESIAN_CONFIG.MAX_PRIOR_WEIGHT,
    Math.max(BAYESIAN_CONFIG.MIN_PRIOR_WEIGHT, logSamples * 0.1)
  );
  if (prior.suggestedBidCount > 0 && prior.suggestedBidMean) {
    priorWeight = Math.min(BAYESIAN_CONFIG.MAX_PRIOR_WEIGHT, priorWeight + BAYESIAN_CONFIG.SUGGESTED_BID_WEIGHT_BONUS);
  }
  let performanceAdjustment = 1;
  if (entityPerformance) {
    if (entityPerformance.clicks >= 20) {
      performanceAdjustment = 0.4;
    } else if (entityPerformance.clicks >= 5) {
      performanceAdjustment = 0.65;
    } else if (entityPerformance.impressions >= 100) {
      performanceAdjustment = 0.85;
    }
  }
  priorWeight *= performanceAdjustment;
  const posteriorMean = priorWeight * prior.priorMean + (1 - priorWeight) * currentBid;
  const bidDeviation = Math.abs(currentBid - prior.priorMean);
  const posteriorStd = Math.sqrt(
    priorWeight * prior.priorStd * prior.priorStd + (1 - priorWeight) * bidDeviation * bidDeviation
  );
  const bidRangeLow = Math.max(0.02, posteriorMean - 1.5 * posteriorStd);
  const bidRangeHigh = posteriorMean + 1.5 * posteriorStd;
  let confidence = BAYESIAN_CONFIG.BASE_CONFIDENCE + Math.min(0.2, prior.priorSampleCount * BAYESIAN_CONFIG.CONFIDENCE_PER_SAMPLE);
  if (prior.suggestedBidCount >= 3) {
    confidence += 0.08;
  }
  const relativeDiff = Math.abs(currentBid - prior.priorMean) / prior.priorMean;
  if (relativeDiff < 0.2) {
    confidence += 0.05;
  } else if (relativeDiff > 0.8) {
    confidence -= 0.05;
  }
  confidence = Math.min(BAYESIAN_CONFIG.MAX_CONFIDENCE, Math.max(0.2, confidence));
  const estimatedBid = Math.max(0.02, Math.round(posteriorMean * 100) / 100);
  const method = `\u8D1D\u53F6\u65AF\u5E73\u6ED1(\u5148\u9A8C=${prior.source}, \u6743\u91CD=${(priorWeight * 100).toFixed(0)}%, \u5148\u9A8C\u5747\u503C=$${prior.priorMean.toFixed(2)}, \u5F53\u524D\u51FA\u4EF7=$${currentBid.toFixed(2)})`;
  const diagnosis = `\u540E\u9A8C\u7ADE\u4EF7=$${estimatedBid.toFixed(2)} (\u5148\u9A8C$${prior.priorMean.toFixed(2)}\xD7${(priorWeight * 100).toFixed(0)}% + \u5F53\u524D$${currentBid.toFixed(2)}\xD7${((1 - priorWeight) * 100).toFixed(0)}%), \u533A\u95F4=[$${bidRangeLow.toFixed(2)}-$${bidRangeHigh.toFixed(2)}], \u7F6E\u4FE1\u5EA6=${(confidence * 100).toFixed(0)}%, \u6837\u672C\u6570=${prior.priorSampleCount}`;
  log53.debug(`[BayesianBidSmoothing] ${diagnosis}`);
  return {
    success: true,
    estimatedBid,
    bidRangeLow: Math.round(bidRangeLow * 100) / 100,
    bidRangeHigh: Math.round(bidRangeHigh * 100) / 100,
    confidence,
    priorWeight,
    prior,
    method,
    diagnosis
  };
}
function createFailedEstimate(currentBid, reason) {
  return {
    success: false,
    estimatedBid: currentBid,
    bidRangeLow: currentBid * 0.7,
    bidRangeHigh: currentBid * 1.3,
    confidence: 0,
    priorWeight: 0,
    prior: {
      priorMean: 0,
      priorStd: 0,
      priorSampleCount: 0,
      suggestedBidCount: 0,
      suggestedBidMean: null,
      source: "none"
    },
    method: "failed",
    diagnosis: reason
  };
}
var log53, BAYESIAN_CONFIG;
var init_bayesianBidSmoothingEngine = __esm({
  "server/optimization/bayesianBidSmoothingEngine.ts"() {
    "use strict";
    init_db2();
    init_schema2();
    init_drizzle_orm();
    init_logger();
    log53 = createModuleLogger("BayesianBidSmoothing");
    BAYESIAN_CONFIG = {
      /** 最少需要多少个同类实体才能构建有效先验 */
      MIN_PRIOR_SAMPLES: 5,
      /** 先验权重的最大值（即使有大量同类数据，先验权重也不超过此值） */
      MAX_PRIOR_WEIGHT: 0.6,
      /** 先验权重的最小值（低于此值认为先验不可靠） */
      MIN_PRIOR_WEIGHT: 0.15,
      /** 使用suggestedBid作为先验时的额外权重加成 */
      SUGGESTED_BID_WEIGHT_BONUS: 0.15,
      /** 先验分布的默认标准差系数（相对于均值的比例） */
      DEFAULT_CV: 0.4,
      /** 后验置信度的基础值 */
      BASE_CONFIDENCE: 0.4,
      /** 每增加一个先验样本，置信度增加的量 */
      CONFIDENCE_PER_SAMPLE: 8e-3,
      /** 最大置信度 */
      MAX_CONFIDENCE: 0.7
    };
    __name(estimateKeywordBid, "estimateKeywordBid");
    __name(estimateProductTargetBid, "estimateProductTargetBid");
    __name(estimateAutoTargetingBid, "estimateAutoTargetingBid");
    __name(estimateAudienceBid, "estimateAudienceBid");
    __name(estimateBid, "estimateBid");
    __name(buildCampaignLevelKeywordPrior, "buildCampaignLevelKeywordPrior");
    __name(buildCampaignLevelTargetPrior, "buildCampaignLevelTargetPrior");
    __name(buildKeywordPrior, "buildKeywordPrior");
    __name(buildProductTargetPrior, "buildProductTargetPrior");
    __name(buildAutoTargetingPrior, "buildAutoTargetingPrior");
    __name(buildAudiencePrior, "buildAudiencePrior");
    __name(calculatePosterior, "calculatePosterior");
    __name(createFailedEstimate, "createFailedEstimate");
  }
});

