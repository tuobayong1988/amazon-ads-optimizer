// Extracted from production dist/index.js
// Original module: server/analytics/contextualFeatureService.ts
// Lines: 410

var contextualFeatureService_exports = {};
__export(contextualFeatureService_exports, {
  FEATURE_DIM: () => FEATURE_DIM,
  batchExtractAndCacheFeatures: () => batchExtractAndCacheFeatures,
  extractFeatureVector: () => extractFeatureVector,
  featureVectorToArray: () => featureVectorToArray,
  getCachedFeatureVector: () => getCachedFeatureVector
});
async function getDbInstance() {
  const db = await getDb();
  if (!db) throw new Error("Database connection failed");
  return db;
}
function timeDecayWeight(daysAgo, halfLife = HALF_LIFE_DAYS) {
  const lambda = Math.LN2 / halfLife;
  return Math.exp(-lambda * daysAgo);
}
function calculateTrendSlope(values) {
  if (values.length < 2) return 0;
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  if (mean === 0) return 0;
  let sumXY = 0, sumX2 = 0;
  const xMean = (n - 1) / 2;
  for (let i = 0; i < n; i++) {
    sumXY += (i - xMean) * (values[i] - mean);
    sumX2 += (i - xMean) * (i - xMean);
  }
  const slope = sumX2 === 0 ? 0 : sumXY / sumX2;
  return slope / mean;
}
function calculateVolatility(values) {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean === 0) return 0;
  const variance = values.reduce((sum2, v) => sum2 + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance) / mean;
}
function isUSShoppingHoliday(date6) {
  const month = date6.getMonth() + 1;
  const day2 = date6.getDate();
  const dayOfWeek = date6.getDay();
  if (month === 7 && day2 >= 11 && day2 <= 17) return true;
  if (month === 11 && dayOfWeek === 5 && day2 >= 23 && day2 <= 29) return true;
  if (month === 12 && dayOfWeek === 1 && day2 >= 1 && day2 <= 3) return true;
  if (month === 12 && day2 >= 15 && day2 <= 25) return true;
  if (month === 2 && day2 >= 10 && day2 <= 14) return true;
  if (month === 5 && dayOfWeek === 0 && day2 >= 8 && day2 <= 14) return true;
  return false;
}
async function extractFeatureVector(accountId, keywordId, targetId, campaignId, adGroupId) {
  const db = await getDbInstance();
  const now = /* @__PURE__ */ new Date();
  const today = now.toISOString().split("T")[0];
  const days14Ago = new Date(now.getTime() - 14 * 864e5).toISOString().split("T")[0];
  const days7Ago = new Date(now.getTime() - 7 * 864e5).toISOString().split("T")[0];
  let perfQuery = db.select({
    date: dailyPerformance.date,
    impressions: dailyPerformance.impressions,
    clicks: dailyPerformance.clicks,
    spend: dailyPerformance.spend,
    sales: dailyPerformance.sales,
    orders: dailyPerformance.orders,
    cpc: dailyPerformance.cpc,
    ctr: dailyPerformance.ctr,
    cvr: dailyPerformance.cvr
  }).from(dailyPerformance).where(and(
    eq(dailyPerformance.accountId, accountId),
    campaignId ? eq(dailyPerformance.campaignId, campaignId) : sql`1=1`,
    gte(dailyPerformance.date, days14Ago),
    lte(dailyPerformance.date, today)
  )).orderBy(dailyPerformance.date);
  const perfData = await perfQuery;
  let weightedCvrNum = 0, weightedCvrDen = 0;
  let weightedRoasNum = 0, weightedRoasDen = 0;
  let weightedAcosNum = 0, weightedAcosDen = 0;
  const impressions7d = [];
  const clicks7d = [];
  const orders7d = [];
  const spend7d = [];
  const cpcValues = [];
  const ctrValues = [];
  for (const row of perfData) {
    const rowDate = new Date(row.date);
    const daysAgo = Math.floor((now.getTime() - rowDate.getTime()) / 864e5);
    const weight = timeDecayWeight(daysAgo);
    const clicks = Number(row.clicks) || 0;
    const orders = Number(row.orders) || 0;
    const spend = Number(row.spend) || 0;
    const sales = Number(row.sales) || 0;
    const impressions = Number(row.impressions) || 0;
    const cpc = Number(row.cpc) || 0;
    const ctr = Number(row.ctr) || 0;
    if (clicks > 0) {
      weightedCvrNum += weight * orders;
      weightedCvrDen += weight * clicks;
    }
    if (spend > 0) {
      weightedRoasNum += weight * sales;
      weightedRoasDen += weight * spend;
      weightedAcosNum += weight * spend;
      weightedAcosDen += weight * sales;
    }
    if (daysAgo <= 7) {
      impressions7d.push(impressions);
      clicks7d.push(clicks);
      orders7d.push(orders);
      spend7d.push(spend);
    }
    if (cpc > 0) cpcValues.push(cpc);
    if (ctr > 0) ctrValues.push(ctr);
  }
  const weightedCvr14d = weightedCvrDen > 0 ? weightedCvrNum / weightedCvrDen : 0;
  const weightedRoas14d = weightedRoasDen > 0 ? weightedRoasNum / weightedRoasDen : 0;
  const weightedAcos14d = weightedAcosDen > 0 ? weightedAcosNum / weightedAcosDen : 0;
  const sum7d = /* @__PURE__ */ __name((arr) => arr.reduce((a, b) => a + b, 0), "sum7d");
  const avg7d = /* @__PURE__ */ __name((arr) => arr.length > 0 ? sum7d(arr) / arr.length : 0, "avg7d");
  const totalImpressions7d = sum7d(impressions7d);
  const totalClicks7d = sum7d(clicks7d);
  const totalSpend7d = sum7d(spend7d);
  const avgCpc7d = totalClicks7d > 0 ? totalSpend7d / totalClicks7d : 0;
  const avgCtr7d = totalImpressions7d > 0 ? totalClicks7d / totalImpressions7d : 0;
  const avgCvr7d = totalClicks7d > 0 ? sum7d(orders7d) / totalClicks7d : 0;
  const cpcVolatility7d = calculateVolatility(cpcValues.slice(-7));
  const ctrVolatility7d = calculateVolatility(ctrValues.slice(-7));
  const impressionShare = impressions7d.length >= 2 ? Math.min(1, Math.max(0, 0.5 + calculateTrendSlope(impressions7d) * 2)) : 0.5;
  const estimatedCompetition = Math.min(1, cpcVolatility7d * 0.5 + (avgCpc7d > 2 ? 0.3 : avgCpc7d > 1 ? 0.2 : 0.1));
  const impressionTrend7d = calculateTrendSlope(impressions7d);
  const clickTrend7d = calculateTrendSlope(clicks7d);
  const orderTrend7d = calculateTrendSlope(orders7d);
  const spendTrend7d = calculateTrendSlope(spend7d);
  return {
    accountId,
    keywordId,
    targetId,
    campaignId,
    adGroupId,
    hourOfDay: now.getHours(),
    dayOfWeek: now.getDay(),
    isHoliday: isUSShoppingHoliday(now) ? 1 : 0,
    estimatedCompetition,
    cpcVolatility7d,
    ctrVolatility7d,
    impressionShare,
    avgCpc7d,
    avgCtr7d,
    avgCvr7d,
    weightedAcos14d,
    impressionTrend7d,
    clickTrend7d,
    orderTrend7d,
    spendTrend7d,
    weightedCvr14d,
    weightedRoas14d
  };
}
function featureVectorToArray(features) {
  return [
    features.hourOfDay / 23,
    // [0] 小时归一化
    features.dayOfWeek / 6,
    // [1] 星期归一化
    features.isHoliday,
    // [2] 假日标志
    Math.min(1, features.estimatedCompetition),
    // [3] 竞争强度
    Math.min(1, features.cpcVolatility7d),
    // [4] CPC波动率
    Math.min(1, features.ctrVolatility7d),
    // [5] CTR波动率
    Math.min(1, features.impressionShare),
    // [6] 展示份额
    Math.min(1, features.avgCpc7d / 5),
    // [7] 平均CPC（假设max=5）
    Math.min(1, features.avgCtr7d * 10),
    // [8] 平均CTR（假设max=10%）
    Math.min(1, features.avgCvr7d * 5),
    // [9] 平均CVR（假设max=20%）
    Math.min(1, Math.max(0, features.weightedAcos14d)),
    // [10] 加权ACOS
    Math.min(1, Math.max(0, (features.impressionTrend7d + 1) / 2)),
    // [11] 展示趋势归一化
    Math.min(1, Math.max(0, (features.clickTrend7d + 1) / 2)),
    // [12] 点击趋势归一化
    Math.min(1, Math.max(0, (features.orderTrend7d + 1) / 2)),
    // [13] 订单趋势归一化
    Math.min(1, Math.max(0, (features.spendTrend7d + 1) / 2)),
    // [14] 花费趋势归一化
    Math.min(1, features.weightedCvr14d * 5),
    // [15] 加权CVR
    Math.min(1, features.weightedRoas14d / 10)
    // [16] 加权ROAS（假设max=10）
  ];
}
async function batchExtractAndCacheFeatures(accountId) {
  const db = await getDbInstance();
  const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
  let processedCount = 0;
  try {
    const activeKeywords = await db.select({
      id: keywords.id,
      adGroupId: keywords.internalAdGroupId,
      campaignId: campaigns.campaignId
    }).from(keywords).innerJoin(adGroups, eq(keywords.internalAdGroupId, adGroups.id)).innerJoin(campaigns, eq(adGroups.campaignId, campaigns.campaignId)).where(and(
      eq(campaigns.accountId, accountId),
      eq(keywords.keywordStatus, "enabled")
    )).limit(5e3);
    const activeTargets = await db.select({
      id: productTargets.id,
      adGroupId: productTargets.internalAdGroupId,
      campaignId: campaigns.campaignId
    }).from(productTargets).innerJoin(adGroups, eq(productTargets.internalAdGroupId, adGroups.id)).innerJoin(campaigns, eq(adGroups.campaignId, campaigns.campaignId)).where(and(
      eq(campaigns.accountId, accountId),
      eq(productTargets.targetStatus, "enabled")
    )).limit(5e3);
    const campaignIds = /* @__PURE__ */ new Set();
    for (const kw of activeKeywords) {
      if (kw.campaignId) campaignIds.add(String(kw.campaignId));
    }
    for (const tgt of activeTargets) {
      if (tgt.campaignId) campaignIds.add(String(tgt.campaignId));
    }
    const campaignFeatureCache = /* @__PURE__ */ new Map();
    for (const cid of campaignIds) {
      const features = await extractFeatureVector(accountId, void 0, void 0, cid);
      campaignFeatureCache.set(cid, features);
    }
    const batchSize = 100;
    const allItems = [
      ...activeKeywords.map((kw) => ({ keywordId: kw.id, targetId: null, campaignId: String(kw.campaignId), adGroupId: kw.adGroupId })),
      ...activeTargets.map((tgt) => ({ keywordId: null, targetId: tgt.id, campaignId: String(tgt.campaignId), adGroupId: tgt.adGroupId }))
    ];
    for (let i = 0; i < allItems.length; i += batchSize) {
      const batch = allItems.slice(i, i + batchSize);
      const insertValues = batch.map((item) => {
        const features = campaignFeatureCache.get(item.campaignId || "") || {
          hourOfDay: (/* @__PURE__ */ new Date()).getHours(),
          dayOfWeek: (/* @__PURE__ */ new Date()).getDay(),
          isHoliday: 0,
          estimatedCompetition: 0,
          cpcVolatility7d: 0,
          ctrVolatility7d: 0,
          impressionShare: 0.5,
          avgCpc7d: 0,
          avgCtr7d: 0,
          avgCvr7d: 0,
          impressionTrend7d: 0,
          clickTrend7d: 0,
          orderTrend7d: 0,
          spendTrend7d: 0,
          weightedCvr14d: 0,
          weightedAcos14d: 0,
          weightedRoas14d: 0
        };
        return {
          accountId,
          keywordId: item.keywordId,
          targetId: item.targetId,
          campaignId: item.campaignId,
          adGroupId: item.adGroupId,
          snapshotDate: today,
          hourOfDay: features.hourOfDay,
          dayOfWeek: features.dayOfWeek,
          isHoliday: features.isHoliday,
          estimatedCompetition: String(features.estimatedCompetition),
          cpcVolatility7d: String(features.cpcVolatility7d),
          ctrVolatility7d: String(features.ctrVolatility7d),
          impressionShare: String(features.impressionShare),
          avgCpc7d: String(features.avgCpc7d),
          avgCtr7d: String(features.avgCtr7d),
          avgCvr7d: String(features.avgCvr7d),
          impressionTrend7d: String(features.impressionTrend7d),
          clickTrend7d: String(features.clickTrend7d),
          orderTrend7d: String(features.orderTrend7d),
          spendTrend7d: String(features.spendTrend7d),
          weightedCvr14d: String(features.weightedCvr14d),
          weightedAcos14d: String(features.weightedAcos14d),
          weightedRoas14d: String(features.weightedRoas14d)
        };
      });
      if (insertValues.length > 0) {
        await db.insert(contextualFeatures).values(insertValues);
        processedCount += insertValues.length;
      }
    }
    log41.info(`[ContextualFeatureService] Cached ${processedCount} feature vectors for account ${accountId}`);
    return processedCount;
  } catch (error48) {
    log41.warn(`[ContextualFeatureService] Error extracting features for account ${accountId}: ${error48.message || JSON.stringify(error48)}`);
    return processedCount;
  }
}
async function getCachedFeatureVector(accountId, keywordId, targetId, campaignId) {
  const db = await getDbInstance();
  const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
  let cached2;
  if (keywordId) {
    cached2 = await db.select().from(contextualFeatures).where(and(
      eq(contextualFeatures.accountId, accountId),
      eq(contextualFeatures.keywordId, keywordId),
      eq(contextualFeatures.snapshotDate, today)
    )).limit(1);
  } else if (targetId) {
    cached2 = await db.select().from(contextualFeatures).where(and(
      eq(contextualFeatures.accountId, accountId),
      eq(contextualFeatures.targetId, targetId),
      eq(contextualFeatures.snapshotDate, today)
    )).limit(1);
  }
  if (cached2 && cached2.length > 0) {
    return parseCachedFeature(cached2[0]);
  }
  for (let daysBack = 1; daysBack <= 3; daysBack++) {
    const fallbackDate = new Date(Date.now() - daysBack * 24 * 36e5).toISOString().split("T")[0];
    let staleCache;
    if (keywordId) {
      staleCache = await db.select().from(contextualFeatures).where(and(
        eq(contextualFeatures.accountId, accountId),
        eq(contextualFeatures.keywordId, keywordId),
        eq(contextualFeatures.snapshotDate, fallbackDate)
      )).limit(1);
    } else if (targetId) {
      staleCache = await db.select().from(contextualFeatures).where(and(
        eq(contextualFeatures.accountId, accountId),
        eq(contextualFeatures.targetId, targetId),
        eq(contextualFeatures.snapshotDate, fallbackDate)
      )).limit(1);
    }
    if (staleCache && staleCache.length > 0) {
      const feature = parseCachedFeature(staleCache[0]);
      feature.hourOfDay = (/* @__PURE__ */ new Date()).getHours();
      feature.dayOfWeek = (/* @__PURE__ */ new Date()).getDay();
      log41.info(`[ContextualFeatureService] v275: \u4F7F\u7528${daysBack}\u5929\u524D\u7684\u7F13\u5B58\u7279\u5F81 (kw=${keywordId}, tgt=${targetId})`);
      return feature;
    }
  }
  return extractFeatureVector(accountId, keywordId, targetId, campaignId);
}
function parseCachedFeature(c) {
  return {
    // @ts-ignore
    accountId: c.accountId,
    // @ts-ignore
    keywordId: c.keywordId ?? void 0,
    // @ts-ignore
    targetId: c.targetId ?? void 0,
    // @ts-ignore
    campaignId: c.campaignId ?? void 0,
    // @ts-ignore
    adGroupId: c.internalAdGroupId ?? void 0,
    // @ts-ignore
    hourOfDay: c.hourOfDay ?? (/* @__PURE__ */ new Date()).getHours(),
    // @ts-ignore
    dayOfWeek: c.dayOfWeek ?? (/* @__PURE__ */ new Date()).getDay(),
    // @ts-ignore
    isHoliday: c.isHoliday ?? 0,
    // @ts-ignore
    estimatedCompetition: Number(c.estimatedCompetition) || 0,
    // @ts-ignore
    cpcVolatility7d: Number(c.cpcVolatility7d) || 0,
    // @ts-ignore
    ctrVolatility7d: Number(c.ctrVolatility7d) || 0,
    // @ts-ignore
    impressionShare: Number(c.impressionShare) || 0.5,
    // @ts-ignore
    avgCpc7d: Number(c.avgCpc7d) || 0,
    // @ts-ignore
    avgCtr7d: Number(c.avgCtr7d) || 0,
    // @ts-ignore
    avgCvr7d: Number(c.avgCvr7d) || 0,
    // @ts-ignore
    weightedAcos14d: Number(c.weightedAcos14d) || 0,
    // @ts-ignore
    impressionTrend7d: Number(c.impressionTrend7d) || 0,
    // @ts-ignore
    clickTrend7d: Number(c.clickTrend7d) || 0,
    // @ts-ignore
    orderTrend7d: Number(c.orderTrend7d) || 0,
    // @ts-ignore
    spendTrend7d: Number(c.spendTrend7d) || 0,
    // @ts-ignore
    weightedCvr14d: Number(c.weightedCvr14d) || 0,
    // @ts-ignore
    weightedRoas14d: Number(c.weightedRoas14d) || 0
  };
}
var log41, FEATURE_DIM, HALF_LIFE_DAYS;
var init_contextualFeatureService = __esm({
  "server/analytics/contextualFeatureService.ts"() {
    "use strict";
    init_logger();
    init_db2();
    init_schema2();
    init_drizzle_orm();
    log41 = createModuleLogger("ContextualFeatureService");
    FEATURE_DIM = 17;
    HALF_LIFE_DAYS = 7;
    __name(getDbInstance, "getDbInstance");
    __name(timeDecayWeight, "timeDecayWeight");
    __name(calculateTrendSlope, "calculateTrendSlope");
    __name(calculateVolatility, "calculateVolatility");
    __name(isUSShoppingHoliday, "isUSShoppingHoliday");
    __name(extractFeatureVector, "extractFeatureVector");
    __name(featureVectorToArray, "featureVectorToArray");
    __name(batchExtractAndCacheFeatures, "batchExtractAndCacheFeatures");
    __name(getCachedFeatureVector, "getCachedFeatureVector");
    __name(parseCachedFeature, "parseCachedFeature");
  }
});

