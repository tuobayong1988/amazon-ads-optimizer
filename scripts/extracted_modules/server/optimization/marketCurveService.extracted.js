// Extracted from production dist/index.js
// Original module: server/optimization/marketCurveService.ts
// Lines: 453

async function getDbInstance11() {
  const db = await getDb();
  if (!db) throw new Error("Database connection failed");
  return db;
}
function buildImpressionCurve(dataPoints) {
  const validPoints = dataPoints.filter((p) => p.impressions > 0 && p.bid > 0);
  if (validPoints.length < 5) {
    return {
      a: 1e3,
      b: 0.1,
      c: 100,
      r2: 0
    };
  }
  const n = validPoints.length;
  const lnX = validPoints.map((p) => Math.log(p.bid + 0.01));
  const y = validPoints.map((p) => p.impressions);
  const sumLnX = lnX.reduce((a2, b) => a2 + b, 0);
  const sumY = y.reduce((a2, b) => a2 + b, 0);
  const sumLnXY = lnX.reduce((sum2, x, i) => sum2 + x * y[i], 0);
  const sumLnX2 = lnX.reduce((sum2, x) => sum2 + x * x, 0);
  const a = (n * sumLnXY - sumLnX * sumY) / (n * sumLnX2 - sumLnX * sumLnX);
  const c = (sumY - a * sumLnX) / n;
  const meanY = sumY / n;
  const ssTotal = y.reduce((sum2, yi) => sum2 + Math.pow(yi - meanY, 2), 0);
  const ssResidual = validPoints.reduce((sum2, p, i) => {
    const predicted = a * lnX[i] + c;
    return sum2 + Math.pow(p.impressions - predicted, 2);
  }, 0);
  const r2 = 1 - ssResidual / ssTotal;
  return {
    a: Math.max(a, 0),
    b: 0.01,
    c: Math.max(c, 0),
    r2: Math.max(0, Math.min(1, r2))
  };
}
function buildCTRCurve(dataPoints) {
  const validPoints = dataPoints.filter((p) => p.clicks > 0 && p.impressions > 0);
  if (validPoints.length < 3) {
    return {
      // @ts-ignore
      baseCtr: 0.01,
      // @ts-ignore
      positionBonus: 0.5,
      // @ts-ignore
      topSearchCtrBonus: 0.3
    };
  }
  const totalClicks = validPoints.reduce((sum2, p) => sum2 + p.clicks, 0);
  const totalImpressions = validPoints.reduce((sum2, p) => sum2 + p.impressions, 0);
  const baseCtr = totalClicks / totalImpressions;
  const sortedByBid = [...validPoints].sort((a, b) => b.bid - a.bid);
  const topHalf = sortedByBid.slice(0, Math.ceil(sortedByBid.length / 2));
  const bottomHalf = sortedByBid.slice(Math.ceil(sortedByBid.length / 2));
  const topCTR = topHalf.reduce((sum2, p) => sum2 + p.ctr, 0) / topHalf.length;
  const bottomCTR = bottomHalf.reduce((sum2, p) => sum2 + p.ctr, 0) / bottomHalf.length;
  const positionBonus = bottomCTR > 0 ? (topCTR - bottomCTR) / bottomCTR : 0.5;
  return {
    baseCtr,
    positionBonus: Math.max(0, Math.min(2, positionBonus)),
    topSearchCtrBonus: positionBonus * 0.6
    // 搜索顶部额外加成
  };
}
function calculateConversionParams(dataPoints) {
  const validPoints = dataPoints.filter((p) => p.clicks > 0);
  if (validPoints.length < 3) {
    return {
      cvr: 0.05,
      aov: 30,
      conversionDelayDays: 7
    };
  }
  const totalClicks = validPoints.reduce((sum2, p) => sum2 + p.clicks, 0);
  const totalOrders = validPoints.reduce((sum2, p) => sum2 + p.orders, 0);
  const totalSales = validPoints.reduce((sum2, p) => sum2 + p.sales, 0);
  const cvr = totalOrders / Math.max(totalClicks, 1);
  const aov = totalOrders > 0 ? totalSales / totalOrders : 30;
  return {
    cvr,
    aov,
    conversionDelayDays: 7
  };
}
function calculateImpressions(cpc, curve) {
  return Math.max(0, curve.a * Math.log(cpc + curve.b) + curve.c);
}
function calculateCTR(cpc, curve, maxCPC = 5) {
  const positionScore = Math.min(cpc / maxCPC, 1);
  return curve.baseCtr * (1 + curve.positionBonus * positionScore);
}
function calculateProfit(cpc, impressionCurve, ctrCurve, conversion) {
  const impressions = calculateImpressions(cpc, impressionCurve);
  const ctr = calculateCTR(cpc, ctrCurve);
  const clicks = impressions * ctr;
  const { cvr, aov } = conversion;
  return clicks * (cvr * aov - cpc);
}
function goldenSectionSearch(f, a, b, tolerance = 1e-3) {
  const phi = (1 + Math.sqrt(5)) / 2;
  const resphi = 2 - phi;
  let x1 = a + resphi * (b - a);
  let x2 = b - resphi * (b - a);
  let f1 = f(x1);
  let f2 = f(x2);
  let iterations = 0;
  const maxIterations = 100;
  while (Math.abs(b - a) > tolerance && iterations < maxIterations) {
    if (f1 > f2) {
      b = x2;
      x2 = x1;
      f2 = f1;
      x1 = a + resphi * (b - a);
      f1 = f(x1);
    } else {
      a = x1;
      x1 = x2;
      f1 = f2;
      x2 = b - resphi * (b - a);
      f2 = f(x2);
    }
    iterations++;
  }
  return (a + b) / 2;
}
function calculateOptimalBid2(impressionCurve, ctrCurve, conversion) {
  const { cvr, aov } = conversion;
  const breakEvenCpc = cvr * aov;
  const minCPC = 0.02;
  const maxCPC = Math.min(breakEvenCpc * 1.5, 10);
  const step = 0.05;
  let bestCPC = minCPC;
  let maxProfit = -Infinity;
  for (let cpc = minCPC; cpc <= maxCPC; cpc += step) {
    const profit = calculateProfit(cpc, impressionCurve, ctrCurve, conversion);
    if (profit > maxProfit) {
      maxProfit = profit;
      bestCPC = cpc;
    }
  }
  const optimalBid = goldenSectionSearch(
    (cpc) => calculateProfit(cpc, impressionCurve, ctrCurve, conversion),
    Math.max(minCPC, bestCPC - step * 2),
    Math.min(maxCPC, bestCPC + step * 2)
  );
  const finalProfit = calculateProfit(optimalBid, impressionCurve, ctrCurve, conversion);
  const profitMargin = (cvr * aov - optimalBid) / (cvr * aov);
  const profitCurve = [];
  for (let cpc = minCPC; cpc <= maxCPC; cpc += 0.1) {
    profitCurve.push({
      cpc,
      profit: calculateProfit(cpc, impressionCurve, ctrCurve, conversion)
    });
  }
  return {
    optimalBid: Math.round(optimalBid * 100) / 100,
    maxProfit: Math.round(finalProfit * 100) / 100,
    profitMargin: Math.round(profitMargin * 1e4) / 1e4,
    breakEvenCpc: Math.round(breakEvenCpc * 100) / 100,
    profitCurve
  };
}
async function buildMarketCurveForKeyword(accountId, campaignId, keywordId, daysBack = 30) {
  const db = await getDbInstance11();
  const startDate = /* @__PURE__ */ new Date();
  startDate.setDate(startDate.getDate() - daysBack);
  const historyData = await db.select().from(bidPerformanceHistory).where(
    and(
      eq(bidPerformanceHistory.accountId, accountId),
      eq(bidPerformanceHistory.bidObjectType, "keyword"),
      eq(bidPerformanceHistory.bidObjectId, String(keywordId)),
      gte(bidPerformanceHistory.date, startDate.toISOString().split("T")[0])
    )
    // @ts-ignore
  );
  if (historyData.length < 5) {
    const keywordData = await db.select().from(keywords).where(eq(keywords.id, keywordId)).limit(1);
    if (keywordData.length === 0) {
      return null;
    }
    const kw = keywordData[0];
    const dataPoints2 = [{
      // @ts-ignore
      bid: Number(kw.bid) || 1,
      // @ts-ignore
      effectiveCpc: Number(kw.spend) / Math.max(Number(kw.clicks), 1),
      // @ts-ignore
      impressions: kw.impressions || 0,
      // @ts-ignore
      clicks: kw.clicks || 0,
      // @ts-ignore
      spend: Number(kw.spend) || 0,
      // @ts-ignore
      sales: Number(kw.sales) || 0,
      // @ts-ignore
      orders: kw.orders || 0,
      // @ts-ignore
      ctr: kw.impressions && kw.clicks ? kw.clicks / kw.impressions * 100 : 0.01,
      // @ts-ignore
      cvr: kw.clicks && kw.orders ? kw.orders / kw.clicks * 100 : 0.05
    }];
    const impressionCurve2 = buildImpressionCurve(dataPoints2);
    const ctrCurve2 = buildCTRCurve(dataPoints2);
    const conversion2 = calculateConversionParams(dataPoints2);
    const optimal2 = calculateOptimalBid2(impressionCurve2, ctrCurve2, conversion2);
    return {
      impressionCurve: impressionCurve2,
      ctrCurve: ctrCurve2,
      conversion: conversion2,
      ...optimal2,
      dataPoints: 1,
      confidence: 0.3
      // 低置信度
    };
  }
  const dataPoints = historyData.map((h) => ({
    bid: Number(h.bid),
    effectiveCpc: Number(h.effectiveCpc) || Number(h.bid),
    impressions: h.impressions || 0,
    clicks: h.clicks || 0,
    spend: Number(h.spend) || 0,
    sales: Number(h.sales) || 0,
    orders: h.orders || 0,
    ctr: Number(h.ctr) || 0,
    cvr: Number(h.cvr) || 0
  }));
  const impressionCurve = buildImpressionCurve(dataPoints);
  const ctrCurve = buildCTRCurve(dataPoints);
  const conversion = calculateConversionParams(dataPoints);
  const optimal = calculateOptimalBid2(impressionCurve, ctrCurve, conversion);
  const confidence = calculateModelConfidence(dataPoints, impressionCurve.r2);
  return {
    impressionCurve,
    ctrCurve,
    conversion,
    ...optimal,
    dataPoints: dataPoints.length,
    confidence
  };
}
function calculateModelConfidence(dataPoints, r2) {
  const dataConfidence = Math.min(dataPoints.length / 30, 1);
  const r2Confidence = Math.max(0, r2);
  const clicks = dataPoints.map((p) => p.clicks);
  const avgClicks = clicks.reduce((a, b) => a + b, 0) / clicks.length;
  const variance = clicks.reduce((sum2, c) => sum2 + Math.pow(c - avgClicks, 2), 0) / clicks.length;
  const cv = Math.sqrt(variance) / Math.max(avgClicks, 1);
  const consistencyConfidence = Math.max(0, 1 - cv);
  return dataConfidence * 0.4 + r2Confidence * 0.3 + consistencyConfidence * 0.3;
}
async function saveMarketCurveModel(accountId, campaignId, bidObjectType, bidObjectId, bidObjectText, model, currentBid) {
  const db = await getDbInstance11();
  const bidGap = model.optimalBid - currentBid;
  const bidGapPercent = currentBid > 0 ? bidGap / currentBid : 0;
  const existing = await db.select().from(marketCurveModels).where(
    and(
      eq(marketCurveModels.accountId, accountId),
      eq(marketCurveModels.bidObjectType, bidObjectType),
      eq(marketCurveModels.bidObjectId, bidObjectId)
    )
  ).limit(1);
  const modelData = {
    accountId,
    campaignId,
    bidObjectType,
    bidObjectId,
    bidObjectText,
    impressionCurveA: String(model.impressionCurve.a),
    impressionCurveB: String(model.impressionCurve.b),
    impressionCurveC: String(model.impressionCurve.c),
    impressionCurveR2: String(model.impressionCurve.r2),
    baseCtr: String(model.ctrCurve.baseCtr),
    positionBonus: String(model.ctrCurve.positionBonus),
    topSearchCtrBonus: String(model.ctrCurve.topSearchCtrBonus),
    cvr: String(model.conversion.cvr),
    aov: String(model.conversion.aov),
    conversionDelayDays: model.conversion.conversionDelayDays,
    cvrSource: "historical",
    optimalBid: String(model.optimalBid),
    maxProfit: String(model.maxProfit),
    profitMargin: String(model.profitMargin),
    breakEvenCpc: String(model.breakEvenCpc),
    currentBid: String(currentBid),
    bidGap: String(bidGap),
    bidGapPercent: String(bidGapPercent),
    dataPoints: model.dataPoints,
    confidence: String(model.confidence)
  };
  if (existing.length > 0) {
    await db.update(marketCurveModels).set(modelData).where(eq(marketCurveModels.id, existing[0].id));
  } else {
    await db.insert(marketCurveModels).values(modelData);
  }
}
async function getMarketCurveModel(accountId, bidObjectType, bidObjectId) {
  const db = await getDbInstance11();
  const models = await db.select().from(marketCurveModels).where(
    // @ts-ignore
    and(
      eq(marketCurveModels.accountId, accountId),
      // @ts-ignore
      eq(marketCurveModels.bidObjectType, bidObjectType),
      // @ts-ignore
      eq(marketCurveModels.bidObjectId, bidObjectId)
      // @ts-ignore
    )
    // @ts-ignore
  ).limit(1);
  if (models.length === 0) {
    return null;
  }
  const m = models[0];
  return {
    impressionCurve: {
      // @ts-ignore
      a: Number(m.impressionCurveA) || 0,
      // @ts-ignore
      b: Number(m.impressionCurveB) || 0,
      // @ts-ignore
      c: Number(m.impressionCurveC) || 0,
      // @ts-ignore
      r2: Number(m.impressionCurveR2) || 0
    },
    ctrCurve: {
      // @ts-ignore
      baseCtr: Number(m.baseCtr) || 0,
      // @ts-ignore
      positionBonus: Number(m.positionBonus) || 0,
      // @ts-ignore
      topSearchCtrBonus: Number(m.topSearchCtrBonus) || 0
    },
    conversion: {
      // @ts-ignore
      cvr: Number(m.cvr) || 0,
      // @ts-ignore
      aov: Number(m.aov) || 0,
      // @ts-ignore
      conversionDelayDays: m.conversionDelayDays || 7
    },
    // @ts-ignore
    optimalBid: Number(m.optimalBid) || 0,
    // @ts-ignore
    maxProfit: Number(m.maxProfit) || 0,
    // @ts-ignore
    profitMargin: Number(m.profitMargin) || 0,
    // @ts-ignore
    breakEvenCpc: Number(m.breakEvenCpc) || 0,
    // @ts-ignore
    dataPoints: m.dataPoints || 0,
    // @ts-ignore
    confidence: Number(m.confidence) || 0
    // @ts-ignore
  };
}
async function updateAllMarketCurveModels(accountId) {
  const db = await getDbInstance11();
  const result = {
    updated: 0,
    failed: 0,
    errors: []
  };
  const allKeywords = await db.select({
    id: keywords.id,
    adGroupId: keywords.internalAdGroupId,
    keywordText: keywords.keywordText,
    bid: keywords.bid
  }).from(keywords).where(eq(keywords.keywordStatus, "enabled")).limit(1e3);
  for (const kw of allKeywords) {
    try {
      const adGroupData = await db.select().from(keywords).where(eq(keywords.id, kw.id)).limit(1);
      if (adGroupData.length === 0) continue;
      const model = await buildMarketCurveForKeyword(
        accountId,
        // @ts-ignore
        String(kw.internalAdGroupId),
        // 使用adGroupId作为campaignId的代理
        // @ts-ignore
        kw.id
      );
      if (model) {
        await saveMarketCurveModel(
          accountId,
          // @ts-ignore
          String(kw.internalAdGroupId),
          "keyword",
          // @ts-ignore
          String(kw.id),
          // @ts-ignore
          kw.keywordText,
          model,
          // @ts-ignore
          Number(kw.bid)
        );
        result.updated++;
      }
    } catch (error48) {
      result.failed++;
      result.errors.push(`\u5173\u952E\u8BCD ${kw.id}: ${error48 instanceof Error ? error48.message : String(error48)}`);
    }
  }
  return result;
}
function generateProfitCurveData(impressionCurve, ctrCurve, conversion, minCPC = 0.1, maxCPC = 5, points = 50) {
  const step = (maxCPC - minCPC) / points;
  const data = [];
  for (let cpc = minCPC; cpc <= maxCPC; cpc += step) {
    const impressions = calculateImpressions(cpc, impressionCurve);
    const ctr = calculateCTR(cpc, ctrCurve);
    const clicks = impressions * ctr;
    const spend = clicks * cpc;
    const revenue = clicks * conversion.cvr * conversion.aov;
    const profit = revenue - spend;
    const roas = spend > 0 ? revenue / spend : 0;
    const acos = revenue > 0 ? spend / revenue : 0;
    data.push({
      cpc: Math.round(cpc * 100) / 100,
      impressions: Math.round(impressions),
      clicks: Math.round(clicks),
      spend: Math.round(spend * 100) / 100,
      revenue: Math.round(revenue * 100) / 100,
      profit: Math.round(profit * 100) / 100,
      roas: Math.round(roas * 100) / 100,
      acos: Math.round(acos * 1e4) / 1e4
    });
  }
  return data;
}
var init_marketCurveService = __esm({
  "server/optimization/marketCurveService.ts"() {
    "use strict";
    init_db2();
    init_schema2();
    init_drizzle_orm();
    __name(getDbInstance11, "getDbInstance");
    __name(buildImpressionCurve, "buildImpressionCurve");
    __name(buildCTRCurve, "buildCTRCurve");
    __name(calculateConversionParams, "calculateConversionParams");
    __name(calculateImpressions, "calculateImpressions");
    __name(calculateCTR, "calculateCTR");
    __name(calculateProfit, "calculateProfit");
    __name(goldenSectionSearch, "goldenSectionSearch");
    __name(calculateOptimalBid2, "calculateOptimalBid");
    __name(buildMarketCurveForKeyword, "buildMarketCurveForKeyword");
    __name(calculateModelConfidence, "calculateModelConfidence");
    __name(saveMarketCurveModel, "saveMarketCurveModel");
    __name(getMarketCurveModel, "getMarketCurveModel");
    __name(updateAllMarketCurveModels, "updateAllMarketCurveModels");
    __name(generateProfitCurveData, "generateProfitCurveData");
  }
});

