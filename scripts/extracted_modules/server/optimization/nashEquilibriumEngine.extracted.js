// Extracted from production dist/index.js
// Original module: server/optimization/nashEquilibriumEngine.ts
// Lines: 418

async function calculateNashEquilibrium(accountId, keywordId, targetId, suggestedBid, suggestedBidRangeStart, suggestedBidRangeEnd, currentBid) {
  try {
    const historicalData = await loadBidPerformanceHistory(
      accountId,
      keywordId,
      targetId
    );
    if (historicalData.length >= NASH_CONFIG.MIN_DATA_POINTS) {
      const curveResult = calculateFromHistoricalCurve(
        historicalData,
        suggestedBid,
        suggestedBidRangeStart,
        suggestedBidRangeEnd
      );
      if (suggestedBid && suggestedBid > 0) {
        return hybridWithSuggestedBid(
          curveResult,
          suggestedBid,
          suggestedBidRangeStart,
          suggestedBidRangeEnd
        );
      }
      return curveResult;
    }
    if (suggestedBid && suggestedBid > 0) {
      return calculateFromSuggestedBid(
        suggestedBid,
        suggestedBidRangeStart,
        suggestedBidRangeEnd,
        currentBid
      );
    }
    if (currentBid && currentBid > 0) {
      try {
        const entityType = keywordId ? "keyword" : targetId ? "product_target" : "keyword";
        const bayesianResult = await estimateBid(
          accountId,
          entityType,
          currentBid
        );
        if (bayesianResult.success && bayesianResult.confidence >= 0.3) {
          log54.info(`[NashEquilibrium] v491\u8D1D\u53F6\u65AF\u5E73\u6ED1\u63A8\u65AD\u6210\u529F: ${bayesianResult.diagnosis}`);
          return {
            bidFloor: bayesianResult.bidRangeLow,
            bidCeiling: bayesianResult.bidRangeHigh,
            optimalBid: bayesianResult.estimatedBid,
            confidence: Math.round(bayesianResult.confidence * 100) / 100,
            source: "bayesian_smoothing",
            diagnostics: {
              dataPoints: bayesianResult.prior.priorSampleCount,
              bidRange: [bayesianResult.bidRangeLow, bayesianResult.bidRangeHigh],
              impressionElasticity: 0,
              marginalRoiAtCeiling: 0,
              suggestedBidUsed: bayesianResult.prior.suggestedBidCount > 0
            }
          };
        }
        log54.debug(`[NashEquilibrium] v491\u8D1D\u53F6\u65AF\u5E73\u6ED1\u7F6E\u4FE1\u5EA6\u4E0D\u8DB3(${bayesianResult.confidence.toFixed(2)}), \u964D\u7EA7\u5230currentBid\u951A\u70B9`);
      } catch (bayesErr) {
        log54.debug(`[NashEquilibrium] v491\u8D1D\u53F6\u65AF\u5E73\u6ED1\u5F02\u5E38: ${bayesErr.message}, \u964D\u7EA7\u5230currentBid\u951A\u70B9`);
      }
    }
    if (currentBid && currentBid > 0) {
      return calculateFromCurrentBidAnchor(currentBid, historicalData.length);
    }
    return createInsufficientDataResult(currentBid);
  } catch (error48) {
    log54.warn(`[NashEquilibrium] \u8BA1\u7B97\u5F02\u5E38: ${error48.message}`);
    return createInsufficientDataResult(currentBid);
  }
}
function calculateFromHistoricalCurve(data, suggestedBid, suggestedBidRangeStart, suggestedBidRangeEnd) {
  const sorted = [...data].sort((a, b) => a.bid - b.bid);
  const minBid = sorted[0].bid;
  const maxBid = sorted[sorted.length - 1].bid;
  const numBuckets = Math.min(Math.max(4, Math.floor(data.length / 3)), 8);
  const bucketWidth = (maxBid - minBid) / numBuckets;
  if (bucketWidth < 0.01) {
    return createInsufficientDataResult(sorted[Math.floor(sorted.length / 2)].bid);
  }
  const buckets = [];
  for (let i = 0; i < numBuckets; i++) {
    const bucketMin = minBid + i * bucketWidth;
    const bucketMax = bucketMin + bucketWidth;
    const bucketData = sorted.filter((d) => d.bid >= bucketMin && (i === numBuckets - 1 ? d.bid <= bucketMax : d.bid < bucketMax));
    if (bucketData.length === 0) continue;
    const avgImpressions = bucketData.reduce((s, d) => s + d.impressions, 0) / bucketData.length;
    const avgClicks = bucketData.reduce((s, d) => s + d.clicks, 0) / bucketData.length;
    const avgSpend = bucketData.reduce((s, d) => s + d.spend, 0) / bucketData.length;
    const avgSales = bucketData.reduce((s, d) => s + d.sales, 0) / bucketData.length;
    const avgOrders = bucketData.reduce((s, d) => s + d.orders, 0) / bucketData.length;
    buckets.push({
      bidCenter: (bucketMin + bucketMax) / 2,
      avgImpressions,
      avgClicks,
      avgSpend,
      avgSales,
      avgOrders,
      roi: avgSpend > 0 ? avgSales / avgSpend : 0,
      count: bucketData.length
    });
  }
  if (buckets.length < 3) {
    return createInsufficientDataResult(sorted[Math.floor(sorted.length / 2)].bid);
  }
  let bidCeiling = maxBid;
  let bidFloor = minBid;
  let lastMarginalRoi = 1;
  let maxElasticity = 0;
  for (let i = 1; i < buckets.length; i++) {
    const prev = buckets[i - 1];
    const curr = buckets[i];
    const bidDelta = curr.bidCenter - prev.bidCenter;
    if (bidDelta < 5e-3) continue;
    const roiDelta = curr.roi - prev.roi;
    const bidChangePct = bidDelta / prev.bidCenter;
    const marginalRoi = roiDelta / bidChangePct;
    const impressionChangePct = prev.avgImpressions > 0 ? (curr.avgImpressions - prev.avgImpressions) / prev.avgImpressions : 0;
    const impressionElasticity = bidChangePct > 0 ? impressionChangePct / bidChangePct : 0;
    if (marginalRoi < NASH_CONFIG.MARGINAL_ROI_THRESHOLD && lastMarginalRoi >= NASH_CONFIG.MARGINAL_ROI_THRESHOLD) {
      bidCeiling = curr.bidCenter;
    }
    lastMarginalRoi = marginalRoi;
    if (impressionElasticity > maxElasticity) {
      maxElasticity = impressionElasticity;
      bidFloor = prev.bidCenter;
    }
  }
  if (bidFloor >= bidCeiling) {
    const medianBid = buckets[Math.floor(buckets.length / 2)].bidCenter;
    bidFloor = medianBid * (1 - NASH_CONFIG.MIN_RANGE_WIDTH_PERCENT / 2);
    bidCeiling = medianBid * (1 + NASH_CONFIG.MIN_RANGE_WIDTH_PERCENT / 2);
  }
  const rangeCenter = (bidFloor + bidCeiling) / 2;
  const rangeWidth = (bidCeiling - bidFloor) / rangeCenter;
  if (rangeWidth < NASH_CONFIG.MIN_RANGE_WIDTH_PERCENT) {
    const expansion = (NASH_CONFIG.MIN_RANGE_WIDTH_PERCENT - rangeWidth) / 2 * rangeCenter;
    bidFloor = Math.max(0.02, bidFloor - expansion);
    bidCeiling = bidCeiling + expansion;
  } else if (rangeWidth > NASH_CONFIG.MAX_RANGE_WIDTH_PERCENT) {
    const contraction = (rangeWidth - NASH_CONFIG.MAX_RANGE_WIDTH_PERCENT) / 2 * rangeCenter;
    bidFloor = bidFloor + contraction;
    bidCeiling = bidCeiling - contraction;
  }
  const bestBucket = buckets.reduce((best, b) => b.roi > best.roi ? b : best, buckets[0]);
  const optimalBid = Math.max(bidFloor, Math.min(bestBucket.bidCenter, bidCeiling));
  const dataConfidence = Math.min(1, data.length / NASH_CONFIG.IDEAL_DATA_POINTS);
  const bucketCoverage = buckets.length / numBuckets;
  const confidence = dataConfidence * 0.7 + bucketCoverage * 0.3;
  return {
    bidFloor: Math.round(bidFloor * 100) / 100,
    bidCeiling: Math.round(bidCeiling * 100) / 100,
    optimalBid: Math.round(optimalBid * 100) / 100,
    confidence: Math.round(confidence * 100) / 100,
    source: "historical_curve",
    diagnostics: {
      dataPoints: data.length,
      bidRange: [minBid, maxBid],
      impressionElasticity: maxElasticity,
      marginalRoiAtCeiling: lastMarginalRoi,
      suggestedBidUsed: false
    }
  };
}
function calculateFromSuggestedBid(suggestedBid, suggestedBidRangeStart, suggestedBidRangeEnd, currentBid) {
  let bidFloor;
  let bidCeiling;
  if (suggestedBidRangeStart && suggestedBidRangeEnd && suggestedBidRangeEnd > suggestedBidRangeStart) {
    bidFloor = suggestedBidRangeStart * 0.8;
    bidCeiling = suggestedBidRangeEnd * 1.1;
  } else {
    bidFloor = suggestedBid * 0.65;
    bidCeiling = suggestedBid * 1.35;
  }
  if (currentBid && currentBid < bidFloor * 0.5) {
    bidFloor = Math.min(bidFloor, currentBid * 1.2);
  }
  return {
    bidFloor: Math.round(Math.max(0.02, bidFloor) * 100) / 100,
    bidCeiling: Math.round(bidCeiling * 100) / 100,
    optimalBid: Math.round(suggestedBid * 100) / 100,
    confidence: 0.45,
    // 仅基于建议竞价，置信度中等偏低
    source: "suggested_bid_anchor",
    diagnostics: {
      dataPoints: 0,
      bidRange: [bidFloor, bidCeiling],
      impressionElasticity: 0,
      marginalRoiAtCeiling: 0,
      suggestedBidUsed: true
    }
  };
}
function hybridWithSuggestedBid(curveResult, suggestedBid, suggestedBidRangeStart, suggestedBidRangeEnd) {
  const suggestedResult = calculateFromSuggestedBid(
    suggestedBid,
    suggestedBidRangeStart,
    suggestedBidRangeEnd
  );
  const curveWeight = curveResult.diagnostics.dataPoints >= 15 ? 0.8 : curveResult.diagnostics.dataPoints >= 10 ? 0.7 : 0.6;
  const suggestedWeight = 1 - curveWeight;
  const hybridFloor = curveResult.bidFloor * curveWeight + suggestedResult.bidFloor * suggestedWeight;
  const hybridCeiling = curveResult.bidCeiling * curveWeight + suggestedResult.bidCeiling * suggestedWeight;
  const hybridOptimal = curveResult.optimalBid * curveWeight + suggestedResult.optimalBid * suggestedWeight;
  const hybridConfidence = Math.min(
    0.95,
    curveResult.confidence * curveWeight + suggestedResult.confidence * suggestedWeight + 0.1
  );
  return {
    bidFloor: Math.round(Math.max(0.02, hybridFloor) * 100) / 100,
    bidCeiling: Math.round(hybridCeiling * 100) / 100,
    optimalBid: Math.round(hybridOptimal * 100) / 100,
    confidence: Math.round(hybridConfidence * 100) / 100,
    source: "hybrid",
    diagnostics: {
      ...curveResult.diagnostics,
      suggestedBidUsed: true
    }
  };
}
function calculateFromCurrentBidAnchor(currentBid, historicalDataPoints) {
  const bidFloor = currentBid * 0.6;
  const bidCeiling = currentBid * 1.5;
  const dataBonus = Math.min(0.05, historicalDataPoints * 0.015);
  const confidence = Math.round((0.3 + dataBonus) * 100) / 100;
  return {
    bidFloor: Math.round(Math.max(0.02, bidFloor) * 100) / 100,
    bidCeiling: Math.round(bidCeiling * 100) / 100,
    optimalBid: Math.round(currentBid * 100) / 100,
    confidence,
    source: "current_bid_anchor",
    diagnostics: {
      dataPoints: historicalDataPoints,
      bidRange: [bidFloor, bidCeiling],
      impressionElasticity: 0,
      marginalRoiAtCeiling: 0,
      suggestedBidUsed: false
    }
  };
}
function createInsufficientDataResult(currentBid) {
  const bid = currentBid || 0.5;
  return {
    bidFloor: Math.round(Math.max(0.02, bid * 0.5) * 100) / 100,
    bidCeiling: Math.round(bid * 2 * 100) / 100,
    optimalBid: Math.round(bid * 100) / 100,
    confidence: 0.15,
    source: "insufficient_data",
    diagnostics: {
      dataPoints: 0,
      bidRange: [0, 0],
      impressionElasticity: 0,
      marginalRoiAtCeiling: 0,
      suggestedBidUsed: false
    }
  };
}
async function loadBidPerformanceHistory(accountId, keywordId, targetId) {
  const db = await getDb();
  if (!db) return [];
  const { optimizationEvents: optimizationEvents9, dailyPerformance: dailyPerformance12 } = await Promise.resolve().then(() => (init_schema2(), schema_exports));
  const { and: andOp, eq: eqOp, gte: gteOp, sql: sqlOp, desc: descOp } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
  const lookbackDate = new Date(Date.now() - NASH_CONFIG.LOOKBACK_DAYS * 24 * 36e5).toISOString();
  const conditions = [
    eqOp(optimizationEvents9.accountId, accountId),
    sqlOp`${optimizationEvents9.eventCategory} = 'bid_adjustment'`,
    sqlOp`${optimizationEvents9.status} = 'success'`,
    gteOp(optimizationEvents9.createdAt, lookbackDate)
  ];
  if (keywordId) {
    conditions.push(sqlOp`${optimizationEvents9.keywordId} = ${String(keywordId)}`);
  } else if (targetId) {
    conditions.push(sqlOp`${optimizationEvents9.targetId} = ${String(targetId)}`);
  } else {
    return [];
  }
  const events = await db.select({
    newBid: optimizationEvents9.newBid,
    createdAt: optimizationEvents9.createdAt,
    campaignId: optimizationEvents9.campaignId
  }).from(optimizationEvents9).where(andOp(...conditions)).orderBy(descOp(optimizationEvents9.createdAt)).limit(60);
  if (events.length === 0) return [];
  const campaignIds = [...new Set(events.map((e) => e.campaignId).filter(Boolean))];
  if (campaignIds.length === 0) return [];
  let perfData = [];
  try {
    perfData = await db.select({
      date: dailyPerformance12.date,
      impressions: dailyPerformance12.impressions,
      clicks: dailyPerformance12.clicks,
      spend: dailyPerformance12.spend,
      sales: dailyPerformance12.sales,
      orders: dailyPerformance12.orders
    }).from(dailyPerformance12).where(andOp(
      eqOp(dailyPerformance12.accountId, accountId),
      sqlOp`${dailyPerformance12.campaignId} IN (${sqlOp.raw(campaignIds.map((id) => `'${String(id).replace(/'/g, "''")}'`).join(","))})`,
      gteOp(dailyPerformance12.date, lookbackDate.split("T")[0])
    )).orderBy(descOp(dailyPerformance12.date)).limit(60);
  } catch (err) {
    log54.warn(`[NashEquilibrium] \u7EE9\u6548\u6570\u636E\u67E5\u8BE2\u5931\u8D25: ${err.message}`);
    return [];
  }
  if (perfData.length === 0) return [];
  const perfByDate = /* @__PURE__ */ new Map();
  for (const p of perfData) {
    const dateStr = String(p.date).split("T")[0];
    perfByDate.set(dateStr, p);
  }
  const result = [];
  for (const evt of events) {
    const evtDate = new Date(evt.createdAt);
    const effectDate = new Date(evtDate.getTime() + 2 * 24 * 36e5);
    const effectDateStr = effectDate.toISOString().split("T")[0];
    const perf = perfByDate.get(effectDateStr);
    if (perf) {
      result.push({
        bid: Number(evt.newBid) || 0,
        impressions: Number(perf.impressions) || 0,
        clicks: Number(perf.clicks) || 0,
        spend: Number(perf.spend) || 0,
        sales: Number(perf.sales) || 0,
        orders: Number(perf.orders) || 0,
        date: effectDateStr
      });
    }
  }
  return result;
}
function applyNashConstraint(proposedBid, nashRange, currentBid) {
  if (nashRange.confidence < 0.25) {
    return { constrainedBid: proposedBid, wasConstrained: false, constraintReason: "" };
  }
  const effectivePullback = NASH_CONFIG.PULLBACK_STRENGTH * nashRange.confidence;
  if (proposedBid < nashRange.bidFloor) {
    const pullbackBid = proposedBid + (nashRange.bidFloor - proposedBid) * effectivePullback;
    return {
      constrainedBid: Math.round(pullbackBid * 100) / 100,
      wasConstrained: true,
      constraintReason: `[v490\u7EB3\u4EC0\u5747\u8861] \u51FA\u4EF7$${proposedBid.toFixed(2)}\u4F4E\u4E8E\u5747\u8861\u4E0B\u754C$${nashRange.bidFloor.toFixed(2)}(\u6765\u6E90:${nashRange.source}, \u7F6E\u4FE1\u5EA6:${(nashRange.confidence * 100).toFixed(0)}%): \u62C9\u56DE\u81F3$${pullbackBid.toFixed(2)}`
    };
  }
  if (proposedBid > nashRange.bidCeiling) {
    const pullbackBid = proposedBid - (proposedBid - nashRange.bidCeiling) * effectivePullback;
    return {
      constrainedBid: Math.round(pullbackBid * 100) / 100,
      wasConstrained: true,
      constraintReason: `[v490\u7EB3\u4EC0\u5747\u8861] \u51FA\u4EF7$${proposedBid.toFixed(2)}\u9AD8\u4E8E\u5747\u8861\u4E0A\u754C$${nashRange.bidCeiling.toFixed(2)}(\u6765\u6E90:${nashRange.source}, \u7F6E\u4FE1\u5EA6:${(nashRange.confidence * 100).toFixed(0)}%): \u62C9\u56DE\u81F3$${pullbackBid.toFixed(2)}`
    };
  }
  return { constrainedBid: proposedBid, wasConstrained: false, constraintReason: "" };
}
async function batchPreloadNashRanges(accountId, targets) {
  const rangeMap = /* @__PURE__ */ new Map();
  const CONCURRENCY = 5;
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const batch = targets.slice(i, i + CONCURRENCY);
    const promises = batch.map(async (t2) => {
      const key = `${t2.type}_${t2.id}`;
      try {
        const range = await calculateNashEquilibrium(
          accountId,
          t2.type === "keyword" ? t2.id : void 0,
          t2.type === "product_target" ? t2.id : void 0,
          t2.suggestedBid,
          t2.suggestedBidRangeStart,
          t2.suggestedBidRangeEnd,
          t2.currentBid
        );
        rangeMap.set(key, range);
      } catch (err) {
        log54.warn(`[NashEquilibrium] \u6279\u91CF\u9884\u52A0\u8F7D\u5931\u8D25(${key}): ${err.message}`);
      }
    });
    await Promise.all(promises);
  }
  log54.info(`[NashEquilibrium] v490\u6279\u91CF\u9884\u52A0\u8F7D\u5B8C\u6210: ${rangeMap.size}/${targets.length}\u4E2A\u76EE\u6807`);
  return rangeMap;
}
var log54, NASH_CONFIG;
var init_nashEquilibriumEngine = __esm({
  "server/optimization/nashEquilibriumEngine.ts"() {
    "use strict";
    init_db2();
    init_logger();
    init_bayesianBidSmoothingEngine();
    log54 = createModuleLogger("NashEquilibrium");
    NASH_CONFIG = {
      /** 计算均衡区间所需的最小数据点数 */
      MIN_DATA_POINTS: 5,
      /** 理想数据点数（达到此数量时置信度为1.0） */
      IDEAL_DATA_POINTS: 20,
      /** 历史数据回溯天数 */
      LOOKBACK_DAYS: 30,
      /** 边际ROI阈值：低于此值认为边际收益趋近于零 */
      MARGINAL_ROI_THRESHOLD: 0.1,
      /** 曝光弹性阈值：低于此值认为曝光对出价不再敏感 */
      IMPRESSION_ELASTICITY_FLOOR: 0.15,
      /** 建议竞价锚定权重（当历史数据不足时） */
      SUGGESTED_BID_ANCHOR_WEIGHT: 0.4,
      /** 均衡区间的最小宽度（占中心值的百分比） */
      MIN_RANGE_WIDTH_PERCENT: 0.15,
      /** 均衡区间的最大宽度（占中心值的百分比） */
      MAX_RANGE_WIDTH_PERCENT: 0.6,
      /** 区间外出价的拉回强度 (0-1)：1.0=完全拉回边界，0.5=拉回一半 */
      PULLBACK_STRENGTH: 0.7
    };
    __name(calculateNashEquilibrium, "calculateNashEquilibrium");
    __name(calculateFromHistoricalCurve, "calculateFromHistoricalCurve");
    __name(calculateFromSuggestedBid, "calculateFromSuggestedBid");
    __name(hybridWithSuggestedBid, "hybridWithSuggestedBid");
    __name(calculateFromCurrentBidAnchor, "calculateFromCurrentBidAnchor");
    __name(createInsufficientDataResult, "createInsufficientDataResult");
    __name(loadBidPerformanceHistory, "loadBidPerformanceHistory");
    __name(applyNashConstraint, "applyNashConstraint");
    __name(batchPreloadNashRanges, "batchPreloadNashRanges");
  }
});

