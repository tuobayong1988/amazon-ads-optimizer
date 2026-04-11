// Extracted from production dist/index.js
// Original module: server/optimization/crossProductTransferEngine.ts
// Lines: 291

async function generateTransferParameters(accountId, newCampaignId) {
  const logPrefix = `[CrossProductTransfer] \u8D26\u6237=${accountId}, \u65B0\u6D3B\u52A8=${newCampaignId}`;
  try {
    const newCampaign = await getCampaignFeatures(accountId, newCampaignId);
    if (!newCampaign) {
      return { accountId, newCampaignId, newCampaignName: "", parameters: null, matchedCampaigns: 0, reason: "\u65B0\u54C1\u5E7F\u544A\u6D3B\u52A8\u4E0D\u5B58\u5728" };
    }
    if (newCampaign.totalClicks > TRANSFER_CONFIG.NEW_CAMPAIGN_MAX_CLICKS) {
      return { accountId, newCampaignId, newCampaignName: newCampaign.campaignName, parameters: null, matchedCampaigns: 0, reason: `\u5DF2\u6709${newCampaign.totalClicks}\u6B21\u70B9\u51FB\uFF0C\u4E0D\u9700\u8981\u8FC1\u79FB\u5B66\u4E60` };
    }
    const matureCampaigns = await getMatureCampaigns(accountId, newCampaignId);
    if (matureCampaigns.length === 0) {
      return { accountId, newCampaignId, newCampaignName: newCampaign.campaignName, parameters: null, matchedCampaigns: 0, reason: "\u8D26\u6237\u4E2D\u6CA1\u6709\u6210\u719F\u7684\u5E7F\u544A\u6D3B\u52A8\u53EF\u4F9B\u8FC1\u79FB" };
    }
    const matches = matureCampaigns.map((mature) => ({
      sourceCampaign: mature,
      targetCampaign: newCampaign,
      ...calculateSimilarity(newCampaign, mature)
    })).filter((m) => m.similarityScore >= TRANSFER_CONFIG.SIMILARITY_THRESHOLD).sort((a, b) => b.similarityScore - a.similarityScore).slice(0, TRANSFER_CONFIG.MAX_SIMILAR_CAMPAIGNS);
    if (matches.length === 0) {
      return { accountId, newCampaignId, newCampaignName: newCampaign.campaignName, parameters: null, matchedCampaigns: 0, reason: `\u627E\u5230${matureCampaigns.length}\u4E2A\u6210\u719F\u6D3B\u52A8\uFF0C\u4F46\u76F8\u4F3C\u5EA6\u5747\u4F4E\u4E8E\u9608\u503C${TRANSFER_CONFIG.SIMILARITY_THRESHOLD}` };
    }
    const parameters = aggregateTransferParameters(matches, newCampaign);
    log55.info(`${logPrefix} \u8FC1\u79FB\u5B66\u4E60\u6210\u529F: \u5339\u914D${matches.length}\u4E2A\u76F8\u4F3C\u6D3B\u52A8, \u5E73\u5747\u76F8\u4F3C\u5EA6=${parameters.sourceInfo.avgSimilarity.toFixed(3)}, \u7F6E\u4FE1\u5EA6=${parameters.confidence}, \u5EFA\u8BAECPC=${parameters.suggestedCpc.toFixed(2)}, \u9884\u4F30CVR=${(parameters.estimatedCvr * 100).toFixed(2)}%`);
    return {
      accountId,
      newCampaignId,
      newCampaignName: newCampaign.campaignName,
      parameters,
      matchedCampaigns: matches.length,
      reason: `\u6210\u529F\u5339\u914D${matches.length}\u4E2A\u76F8\u4F3C\u5E7F\u544A\u6D3B\u52A8`
    };
  } catch (err) {
    log55.warn(`${logPrefix} \u8FC1\u79FB\u5B66\u4E60\u5F02\u5E38: ${err.message}`);
    return { accountId, newCampaignId, newCampaignName: "", parameters: null, matchedCampaigns: 0, reason: `\u5F02\u5E38: ${err.message}` };
  }
}
function calculateTransferWeight(newCampaignClicks, newCampaignDays) {
  const timeDecay = Math.max(0, 1 - newCampaignDays * TRANSFER_CONFIG.WEIGHT_DECAY_PER_DAY);
  const dataDecay = Math.max(0, 1 - newCampaignClicks / TRANSFER_CONFIG.NEW_CAMPAIGN_MAX_CLICKS);
  const weight = TRANSFER_CONFIG.MAX_TRANSFER_WEIGHT * Math.sqrt(timeDecay * dataDecay);
  return weight >= TRANSFER_CONFIG.MIN_TRANSFER_WEIGHT ? weight : 0;
}
function blendTransferWithOwn(transferValue, ownValue, transferWeight) {
  if (transferWeight <= 0) return ownValue;
  if (ownValue <= 0) return transferValue * transferWeight;
  return transferValue * transferWeight + ownValue * (1 - transferWeight);
}
async function getCampaignFeatures(accountId, campaignId) {
  const db = await getDb();
  if (!db) return null;
  const lookbackDate = /* @__PURE__ */ new Date();
  lookbackDate.setDate(lookbackDate.getDate() - TRANSFER_CONFIG.PERFORMANCE_LOOKBACK_DAYS);
  const [campaign] = await db.select().from(campaigns).where(and(
    eq(campaigns.accountId, accountId),
    eq(campaigns.campaignId, campaignId)
  )).limit(1);
  if (!campaign) return null;
  const [perfSummary] = await db.select({
    totalImpressions: sql`COALESCE(SUM(${dailyPerformance.impressions}), 0)`,
    totalClicks: sql`COALESCE(SUM(${dailyPerformance.clicks}), 0)`,
    totalSpend: sql`COALESCE(SUM(${dailyPerformance.spend}), 0)`,
    totalSales: sql`COALESCE(SUM(${dailyPerformance.sales}), 0)`,
    totalOrders: sql`COALESCE(SUM(${dailyPerformance.orders}), 0)`,
    activeDays: sql`COUNT(DISTINCT DATE(${dailyPerformance.date}))`
  }).from(dailyPerformance).where(and(
    eq(dailyPerformance.accountId, accountId),
    eq(dailyPerformance.campaignId, campaignId),
    gte(dailyPerformance.date, lookbackDate.toISOString())
  ));
  const [kwStats] = await db.select({
    keywordCount: sql`COUNT(*)`,
    avgBid: sql`COALESCE(AVG(${keywords.bid}), 0)`
  }).from(keywords).where(and(
    eq(keywords.accountId, accountId),
    eq(keywords.campaignId, campaignId),
    eq(keywords.keywordStatus, "enabled")
  ));
  const totalClicks = Number(perfSummary?.totalClicks || 0);
  const totalSpend = Number(perfSummary?.totalSpend || 0);
  const totalSales = Number(perfSummary?.totalSales || 0);
  const totalOrders = Number(perfSummary?.totalOrders || 0);
  const totalImpressions = Number(perfSummary?.totalImpressions || 0);
  return {
    campaignId: campaign.campaignId,
    campaignName: campaign.campaignName,
    campaignType: campaign.campaignType,
    targetingType: campaign.targetingType,
    performanceGroupId: campaign.performanceGroupId,
    dailyBudget: Number(campaign.dailyBudget || 0),
    avgCpc: totalClicks > 0 ? totalSpend / totalClicks : 0,
    avgCvr: totalClicks > 0 ? totalOrders / totalClicks : 0,
    avgAcos: totalSales > 0 ? totalSpend / totalSales * 100 : 0,
    avgRoas: totalSpend > 0 ? totalSales / totalSpend : 0,
    totalClicks,
    totalSpend,
    totalSales,
    totalOrders,
    totalImpressions,
    activeDays: Number(perfSummary?.activeDays || 0),
    avgBid: Number(kwStats?.avgBid || 0),
    keywordCount: Number(kwStats?.keywordCount || 0),
    topSearchImpressionShare: Number(campaign.topOfSearchImpressionShare || 0),
    createdAt: campaign.createdAt || ""
  };
}
async function getMatureCampaigns(accountId, excludeCampaignId) {
  const db = await getDb();
  if (!db) return [];
  const lookbackDate = /* @__PURE__ */ new Date();
  lookbackDate.setDate(lookbackDate.getDate() - TRANSFER_CONFIG.PERFORMANCE_LOOKBACK_DAYS);
  const matureCampaignIds = await db.select({
    campaignId: dailyPerformance.campaignId,
    totalClicks: sql`SUM(${dailyPerformance.clicks})`,
    activeDays: sql`COUNT(DISTINCT DATE(${dailyPerformance.date}))`
  }).from(dailyPerformance).where(and(
    eq(dailyPerformance.accountId, accountId),
    gte(dailyPerformance.date, lookbackDate.toISOString()),
    isNotNull(dailyPerformance.campaignId)
  )).groupBy(dailyPerformance.campaignId).having(and(
    gte(sql`SUM(${dailyPerformance.clicks})`, TRANSFER_CONFIG.MATURE_MIN_CLICKS),
    gte(sql`COUNT(DISTINCT DATE(${dailyPerformance.date}))`, TRANSFER_CONFIG.MATURE_MIN_DAYS)
  ));
  const results = [];
  for (const row of matureCampaignIds) {
    if (!row.campaignId || row.campaignId === excludeCampaignId) continue;
    const features = await getCampaignFeatures(accountId, row.campaignId);
    if (features) {
      results.push(features);
    }
  }
  return results;
}
function calculateSimilarity(newCampaign, matureCampaign) {
  let typeScore = 0;
  if (newCampaign.campaignType === matureCampaign.campaignType) {
    typeScore = 1;
  } else if (newCampaign.campaignType === "sp_auto" && matureCampaign.campaignType === "sp_manual" || newCampaign.campaignType === "sp_manual" && matureCampaign.campaignType === "sp_auto") {
    typeScore = 0.6;
  } else {
    typeScore = 0.1;
  }
  let budgetScore = 0;
  if (newCampaign.dailyBudget > 0 && matureCampaign.dailyBudget > 0) {
    const ratio = Math.min(newCampaign.dailyBudget, matureCampaign.dailyBudget) / Math.max(newCampaign.dailyBudget, matureCampaign.dailyBudget);
    budgetScore = ratio;
  } else if (newCampaign.dailyBudget === 0 && matureCampaign.dailyBudget === 0) {
    budgetScore = 0.5;
  }
  let performanceGroupScore = 0;
  if (newCampaign.performanceGroupId && matureCampaign.performanceGroupId) {
    performanceGroupScore = newCampaign.performanceGroupId === matureCampaign.performanceGroupId ? 1 : 0;
  } else {
    performanceGroupScore = 0.3;
  }
  const namePatternScore = calculateNameSimilarity(newCampaign.campaignName, matureCampaign.campaignName);
  let keywordOverlapScore = 0;
  if (newCampaign.keywordCount > 0 && matureCampaign.keywordCount > 0) {
    const ratio = Math.min(newCampaign.keywordCount, matureCampaign.keywordCount) / Math.max(newCampaign.keywordCount, matureCampaign.keywordCount);
    keywordOverlapScore = ratio * 0.8;
  }
  const similarityScore = typeScore * 0.3 + budgetScore * 0.2 + performanceGroupScore * 0.2 + namePatternScore * 0.15 + keywordOverlapScore * 0.15;
  return {
    similarityScore,
    similarityBreakdown: {
      typeScore,
      budgetScore,
      performanceGroupScore,
      namePatternScore,
      keywordOverlapScore
    }
  };
}
function calculateNameSimilarity(name1, name2) {
  const tokens1 = name1.toLowerCase().split(/[-_\s|]+/).filter((t2) => t2.length > 0);
  const tokens2 = name2.toLowerCase().split(/[-_\s|]+/).filter((t2) => t2.length > 0);
  if (tokens1.length === 0 || tokens2.length === 0) return 0;
  const set1 = new Set(tokens1);
  const set2 = new Set(tokens2);
  const intersection2 = new Set([...set1].filter((x) => set2.has(x)));
  const union3 = /* @__PURE__ */ new Set([...set1, ...set2]);
  return intersection2.size / union3.size;
}
function aggregateTransferParameters(matches, newCampaign) {
  const totalSimilarity = matches.reduce((sum2, m) => sum2 + m.similarityScore, 0);
  let weightedCpc = 0;
  let weightedCvr = 0;
  let weightedCtr = 0;
  let weightedAcos = 0;
  let weightedRoas = 0;
  let weightedBid = 0;
  let weightedBudget = 0;
  let totalDataPoints = 0;
  for (const match of matches) {
    const weight = match.similarityScore / totalSimilarity;
    const src = match.sourceCampaign;
    weightedCpc += src.avgCpc * weight;
    weightedCvr += src.avgCvr * weight;
    weightedAcos += src.avgAcos * weight;
    weightedRoas += src.avgRoas * weight;
    weightedBid += src.avgBid * weight;
    weightedBudget += src.dailyBudget * weight;
    totalDataPoints += src.totalClicks;
    const ctr = src.totalImpressions > 0 ? src.totalClicks / src.totalImpressions : 0;
    weightedCtr += ctr * weight;
  }
  const transferWeight = calculateTransferWeight(newCampaign.totalClicks, newCampaign.activeDays);
  const bestMatch = matches[0].sourceCampaign;
  const avgSimilarity = totalSimilarity / matches.length;
  let confidence;
  if (avgSimilarity >= 0.7 && matches.length >= 3) {
    confidence = "high";
  } else if (avgSimilarity >= 0.5 || matches.length >= 2) {
    confidence = "medium";
  } else {
    confidence = "low";
  }
  return {
    suggestedCpc: Math.max(0.02, weightedCpc),
    suggestedBid: Math.max(0.02, weightedBid),
    estimatedCvr: Math.max(0, weightedCvr),
    estimatedCtr: Math.max(0, weightedCtr),
    referenceAcos: weightedAcos,
    referenceRoas: weightedRoas,
    suggestedDailyBudget: Math.max(1, weightedBudget),
    suggestedTopSearchAdjustment: 0,
    // 保守起见，不迁移广告位调整
    suggestedProductPageAdjustment: 0,
    transferWeight,
    sourceInfo: {
      campaignIds: matches.map((m) => m.sourceCampaign.campaignId),
      campaignNames: matches.map((m) => m.sourceCampaign.campaignName),
      avgSimilarity,
      totalDataPoints
    },
    confidence
  };
}
async function getTransferPriorForCampaign(accountId, campaignId) {
  try {
    const result = await generateTransferParameters(accountId, campaignId);
    return result.parameters;
  } catch {
    return null;
  }
}
var log55, TRANSFER_CONFIG;
var init_crossProductTransferEngine = __esm({
  "server/optimization/crossProductTransferEngine.ts"() {
    "use strict";
    init_db2();
    init_schema2();
    init_drizzle_orm();
    init_logger();
    log55 = createModuleLogger("CrossProductTransfer");
    TRANSFER_CONFIG = {
      /** 成熟广告活动的最低点击数阈值 */
      MATURE_MIN_CLICKS: 200,
      /** 成熟广告活动的最低运行天数 */
      MATURE_MIN_DAYS: 14,
      /** 新品广告活动的最大点击数（超过此值不再视为新品） */
      NEW_CAMPAIGN_MAX_CLICKS: 50,
      /** 新品广告活动的最大运行天数 */
      NEW_CAMPAIGN_MAX_DAYS: 14,
      /** 相似度阈值（低于此值不迁移） */
      SIMILARITY_THRESHOLD: 0.3,
      /** 迁移权重衰减系数（每天衰减的比例） */
      WEIGHT_DECAY_PER_DAY: 0.05,
      /** 最大迁移权重（第0天） */
      MAX_TRANSFER_WEIGHT: 0.7,
      /** 最小迁移权重（低于此值停止迁移） */
      MIN_TRANSFER_WEIGHT: 0.1,
      /** 最多匹配的相似广告活动数量 */
      MAX_SIMILAR_CAMPAIGNS: 5,
      /** 绩效数据回溯天数 */
      PERFORMANCE_LOOKBACK_DAYS: 30,
      /** 价格区间相似度的容差比例（±30%视为同价格区间） */
      PRICE_TOLERANCE_RATIO: 0.3
    };
    __name(generateTransferParameters, "generateTransferParameters");
    __name(calculateTransferWeight, "calculateTransferWeight");
    __name(blendTransferWithOwn, "blendTransferWithOwn");
    __name(getCampaignFeatures, "getCampaignFeatures");
    __name(getMatureCampaigns, "getMatureCampaigns");
    __name(calculateSimilarity, "calculateSimilarity");
    __name(calculateNameSimilarity, "calculateNameSimilarity");
    __name(aggregateTransferParameters, "aggregateTransferParameters");
    __name(getTransferPriorForCampaign, "getTransferPriorForCampaign");
  }
});

