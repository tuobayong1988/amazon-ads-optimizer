// Extracted from production dist/index.js
// Original module: server/algorithm/sigmoidCurveFitter.ts
// Lines: 329

var sigmoidCurveFitter_exports = {};
__export(sigmoidCurveFitter_exports, {
  batchFitSigmoidCurves: () => batchFitSigmoidCurves,
  calculateSigmoidOptimalBid: () => calculateSigmoidOptimalBid,
  fitAndCacheSigmoidForEntity: () => fitAndCacheSigmoidForEntity,
  fitSigmoidCurve: () => fitSigmoidCurve,
  sigmoid: () => sigmoid,
  sigmoidDerivative: () => sigmoidDerivative
});
function sigmoid(bid, params) {
  return params.L / (1 + Math.exp(-params.k * (bid - params.x0))) + params.b;
}
function sigmoidDerivative(bid, params) {
  const expTerm = Math.exp(-params.k * (bid - params.x0));
  return params.L * params.k * expTerm / Math.pow(1 + expTerm, 2);
}
function fitSigmoidCurve(bids, impressions) {
  const n = bids.length;
  if (n < 4) {
    const maxImp2 = impressions.length > 0 ? Math.max(...impressions) : 1e3;
    const avgBid = bids.length > 0 ? bids.reduce((a, b2) => a + b2, 0) / bids.length : 1;
    return {
      L: maxImp2 * 2,
      k: 2,
      x0: avgBid,
      b: 0,
      r2: 0
    };
  }
  const sortedByBid = bids.map((b2, i) => ({ bid: b2, imp: impressions[i] })).sort((a, b2) => a.bid - b2.bid);
  const maxImp = Math.max(...impressions);
  const minImp = Math.min(...impressions);
  const medianBid = sortedByBid[Math.floor(n / 2)].bid;
  let L = (maxImp - minImp) * 1.5;
  let k = 3;
  let x0 = medianBid;
  let b = minImp * 0.5;
  let lambda = 0.01;
  const maxIter = 200;
  const tolerance = 1e-8;
  for (let iter = 0; iter < maxIter; iter++) {
    const residuals = [];
    const J = [];
    for (let i = 0; i < n; i++) {
      const bid = bids[i];
      const expTerm = Math.exp(-k * (bid - x0));
      const denom = 1 + expTerm;
      const predicted = L / denom + b;
      residuals.push(impressions[i] - predicted);
      const dL = 1 / denom;
      const dk = L * (bid - x0) * expTerm / (denom * denom);
      const dx0 = -L * k * expTerm / (denom * denom);
      const db = 1;
      J.push([dL, dk, dx0, db]);
    }
    const JTJ = Array.from({ length: 4 }, () => Array(4).fill(0));
    const JTr = Array(4).fill(0);
    for (let i = 0; i < n; i++) {
      for (let p = 0; p < 4; p++) {
        JTr[p] += J[i][p] * residuals[i];
        for (let q = 0; q < 4; q++) {
          JTJ[p][q] += J[i][p] * J[i][q];
        }
      }
    }
    for (let p = 0; p < 4; p++) {
      JTJ[p][p] *= 1 + lambda;
    }
    const delta = solveLinearSystem(JTJ, JTr);
    if (!delta) break;
    const newL = L + delta[0];
    const newK = k + delta[1];
    const newX0 = x0 + delta[2];
    const newB = b + delta[3];
    let oldSSR = 0, newSSR = 0;
    for (let i = 0; i < n; i++) {
      oldSSR += residuals[i] * residuals[i];
      const newPred = newL / (1 + Math.exp(-newK * (bids[i] - newX0))) + newB;
      newSSR += (impressions[i] - newPred) ** 2;
    }
    if (newSSR < oldSSR) {
      L = Math.max(newL, maxImp * 0.5);
      k = Math.max(newK, 0.1);
      x0 = newX0;
      b = Math.max(newB, 0);
      lambda *= 0.5;
      if (Math.abs(oldSSR - newSSR) / Math.max(oldSSR, 1) < tolerance) break;
    } else {
      lambda *= 2;
    }
  }
  const meanImp = impressions.reduce((a, b2) => a + b2, 0) / n;
  let ssTotal = 0, ssResidual = 0;
  for (let i = 0; i < n; i++) {
    ssTotal += (impressions[i] - meanImp) ** 2;
    const predicted = L / (1 + Math.exp(-k * (bids[i] - x0))) + b;
    ssResidual += (impressions[i] - predicted) ** 2;
  }
  const r2 = ssTotal > 0 ? 1 - ssResidual / ssTotal : 0;
  return {
    L: Math.round(L * 100) / 100,
    k: Math.round(k * 1e4) / 1e4,
    // @ts-ignore
    x0: Math.round(x0 * 1e4) / 1e4,
    b: Math.round(b * 100) / 100,
    // @ts-ignore
    r2: Math.max(0, Math.min(1, r2))
  };
}
function solveLinearSystem(A2, b) {
  const n = A2.length;
  const aug = A2.map((row, i) => [...row, b[i]]);
  for (let col2 = 0; col2 < n; col2++) {
    let maxRow = col2;
    for (let row = col2 + 1; row < n; row++) {
      if (Math.abs(aug[row][col2]) > Math.abs(aug[maxRow][col2])) {
        maxRow = row;
      }
    }
    [aug[col2], aug[maxRow]] = [aug[maxRow], aug[col2]];
    if (Math.abs(aug[col2][col2]) < 1e-12) return null;
    for (let row = col2 + 1; row < n; row++) {
      const factor = aug[row][col2] / aug[col2][col2];
      for (let j = col2; j <= n; j++) {
        aug[row][j] -= factor * aug[col2][j];
      }
    }
  }
  const x = Array(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    x[row] = aug[row][n];
    for (let col2 = row + 1; col2 < n; col2++) {
      x[row] -= aug[row][col2] * x[col2];
    }
    x[row] /= aug[row][row];
  }
  return x;
}
function calculateSigmoidOptimalBid(sigmoidParams, ctr, cvr, aov, cpcRatio = 0.7, bidRange = [0.02, 10]) {
  const [minBid, maxBid] = bidRange;
  const step = 0.01;
  let bestBid = minBid;
  let maxProfit = -Infinity;
  const profitCurve = [];
  let prevProfit = 0;
  let prevImpressions = 0;
  let prevClicks = 0;
  for (let bid = minBid; bid <= maxBid; bid += step) {
    const impressions = sigmoid(bid, sigmoidParams);
    const cpc = bid * cpcRatio;
    const clicks = impressions * ctr;
    const orders = clicks * cvr;
    const revenue = orders * aov;
    const cost = clicks * cpc;
    const profit = revenue - cost;
    const marginalImpressions = (impressions - prevImpressions) / step;
    const marginalClicks = (clicks - prevClicks) / step;
    const marginalProfit2 = (profit - prevProfit) / step;
    if (Math.round(bid * 100) % 10 === 0) {
      profitCurve.push({
        bid: Math.round(bid * 100) / 100,
        impressions: Math.round(impressions),
        marginalImpressions: Math.round(marginalImpressions),
        clicks: Math.round(clicks * 10) / 10,
        marginalClicks: Math.round(marginalClicks * 100) / 100,
        revenue: Math.round(revenue * 100) / 100,
        cost: Math.round(cost * 100) / 100,
        profit: Math.round(profit * 100) / 100,
        marginalProfit: Math.round(marginalProfit2 * 100) / 100,
        roas: cost > 0 ? Math.round(revenue / cost * 100) / 100 : 0,
        acos: revenue > 0 ? Math.round(cost / revenue * 1e4) / 1e4 : 0
      });
    }
    if (profit > maxProfit) {
      maxProfit = profit;
      bestBid = bid;
    }
    prevProfit = profit;
    prevImpressions = impressions;
    prevClicks = clicks;
  }
  const optimalBid = goldenSectionSearchMax(
    (bid) => {
      const imp = sigmoid(bid, sigmoidParams);
      const clicks = imp * ctr;
      return clicks * (cvr * aov - bid * cpcRatio);
    },
    Math.max(minBid, bestBid - 0.1),
    Math.min(maxBid, bestBid + 0.1)
  );
  const optImp = sigmoid(optimalBid, sigmoidParams);
  const optClicks = optImp * ctr;
  const optProfit = optClicks * (cvr * aov - optimalBid * cpcRatio);
  const eps = 1e-3;
  const profitPlus = (() => {
    const imp = sigmoid(optimalBid + eps, sigmoidParams);
    const clicks = imp * ctr;
    return clicks * (cvr * aov - (optimalBid + eps) * cpcRatio);
  })();
  const marginalProfitAtOptimal = (profitPlus - optProfit) / eps;
  return {
    optimalBid: Math.round(optimalBid * 100) / 100,
    maxProfit: Math.round(optProfit * 100) / 100,
    marginalProfitAtOptimal: Math.round(marginalProfitAtOptimal * 100) / 100,
    impressionCeiling: Math.round(sigmoidParams.L + sigmoidParams.b),
    competitionMidpoint: Math.round(sigmoidParams.x0 * 100) / 100,
    profitCurve,
    confidence: sigmoidParams.r2
  };
}
function goldenSectionSearchMax(f, a, b, tolerance = 1e-3) {
  const phi = (1 + Math.sqrt(5)) / 2;
  const resphi = 2 - phi;
  let x1 = a + resphi * (b - a);
  let x2 = b - resphi * (b - a);
  let f1 = f(x1);
  let f2 = f(x2);
  let iterations = 0;
  while (Math.abs(b - a) > tolerance && iterations < 100) {
    if (f1 < f2) {
      a = x1;
      x1 = x2;
      f1 = f2;
      x2 = b - resphi * (b - a);
      f2 = f(x2);
    } else {
      b = x2;
      x2 = x1;
      f2 = f1;
      x1 = a + resphi * (b - a);
      f1 = f(x1);
    }
    iterations++;
  }
  return (a + b) / 2;
}
async function getDbInstance3() {
  const db = await getDb();
  if (!db) throw new Error("Database connection failed");
  return db;
}
async function fitAndCacheSigmoidForEntity(accountId, entityType, entityId, campaignId, daysBack = 30) {
  const db = await getDbInstance3();
  const startDate = new Date(Date.now() - daysBack * 864e5).toISOString().split("T")[0];
  const historyData = await db.select({
    bid: bidPerformanceHistory.bid,
    impressions: bidPerformanceHistory.impressions
  }).from(bidPerformanceHistory).where(and(
    eq(bidPerformanceHistory.accountId, accountId),
    eq(bidPerformanceHistory.bidObjectType, entityType === "target" ? "asin" : entityType),
    eq(bidPerformanceHistory.bidObjectId, String(entityId)),
    gte(bidPerformanceHistory.date, startDate)
  ));
  if (historyData.length < 4) {
    return null;
  }
  const bids = historyData.map((h) => Number(h.bid));
  const impressions = historyData.map((h) => Number(h.impressions));
  const params = fitSigmoidCurve(bids, impressions);
  const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
  try {
    await db.update(contextualFeatures).set({
      sigmoidL: String(params.L),
      sigmoidK: String(params.k),
      sigmoidX0: String(params.x0),
      sigmoidB: String(params.b),
      curveFitR2: String(params.r2),
      curveUpdatedAt: (/* @__PURE__ */ new Date()).toISOString()
    }).where(and(
      eq(contextualFeatures.accountId, accountId),
      entityType === "keyword" ? eq(contextualFeatures.keywordId, entityId) : eq(contextualFeatures.targetId, entityId),
      eq(contextualFeatures.snapshotDate, today)
    ));
  } catch (e) {
    log42.warn(`[SigmoidCurveFitter] Failed to cache sigmoid params:`, e);
  }
  return params;
}
async function batchFitSigmoidCurves(accountId) {
  const db = await getDbInstance3();
  const result = { fitted: 0, skipped: 0, errors: 0 };
  const entities = await db.select({
    bidObjectType: bidPerformanceHistory.bidObjectType,
    bidObjectId: bidPerformanceHistory.bidObjectId,
    dataPoints: sql`COUNT(*)`
  }).from(bidPerformanceHistory).where(eq(bidPerformanceHistory.accountId, accountId)).groupBy(bidPerformanceHistory.bidObjectType, bidPerformanceHistory.bidObjectId).having(sql`COUNT(*) >= 4`);
  for (const entity of entities) {
    try {
      const entityType = entity.bidObjectType;
      const entityId = Number(entity.bidObjectId);
      const params = await fitAndCacheSigmoidForEntity(
        accountId,
        entityType,
        entityId,
        ""
      );
      if (params && params.r2 > 0.3) {
        result.fitted++;
      } else {
        result.skipped++;
      }
    } catch (e) {
      result.errors++;
    }
  }
  log42.info(`[SigmoidCurveFitter] Batch fit: ${result.fitted} fitted, ${result.skipped} skipped, ${result.errors} errors`);
  return result;
}
var log42;
var init_sigmoidCurveFitter = __esm({
  "server/algorithm/sigmoidCurveFitter.ts"() {
    "use strict";
    init_logger();
    init_db2();
    init_schema2();
    init_drizzle_orm();
    log42 = createModuleLogger("SigmoidCurveFitter");
    __name(sigmoid, "sigmoid");
    __name(sigmoidDerivative, "sigmoidDerivative");
    __name(fitSigmoidCurve, "fitSigmoidCurve");
    __name(solveLinearSystem, "solveLinearSystem");
    __name(calculateSigmoidOptimalBid, "calculateSigmoidOptimalBid");
    __name(goldenSectionSearchMax, "goldenSectionSearchMax");
    __name(getDbInstance3, "getDbInstance");
    __name(fitAndCacheSigmoidForEntity, "fitAndCacheSigmoidForEntity");
    __name(batchFitSigmoidCurves, "batchFitSigmoidCurves");
  }
});

