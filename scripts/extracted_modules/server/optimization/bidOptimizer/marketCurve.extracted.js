// Extracted from production dist/index.js
// Original module: server/optimization/bidOptimizer/marketCurve.ts
// Lines: 113

function calculateMetrics(target) {
  const acos = target.sales > 0 ? target.spend / target.sales * 100 : 0;
  const roas = target.spend > 0 ? target.sales / target.spend : 0;
  const ctr = target.impressions > 0 ? target.clicks / target.impressions * 100 : 0;
  const cvr = target.clicks > 0 ? target.orders / target.clicks * 100 : 0;
  const cpc = target.clicks > 0 ? target.spend / target.clicks : 0;
  const aov = target.orders > 0 ? target.sales / target.orders : 0;
  return { acos, roas, ctr, cvr, cpc, aov };
}
function generateMarketCurve(target, minBid = 0.1, maxBid = 5, steps = 20) {
  const points = [];
  const bidStep = steps > 0 ? (maxBid - minBid) / steps : 0.01;
  const { cvr, aov } = calculateMetrics(target);
  const baseClicks = target.clicks;
  const baseBid = target.currentBid;
  for (let i = 0; i <= steps; i++) {
    const bidLevel = minBid + i * bidStep;
    const elasticity = getElasticity(target.bidChangeHistory || [], target.category);
    const clickMultiplier = baseBid > 0 ? 1 + elasticity * Math.log(bidLevel / baseBid) : 1;
    const estimatedClicks = Math.max(0, baseClicks * clickMultiplier);
    const ctr = target.impressions > 0 ? target.clicks / target.impressions : DEFAULT_CTR_FALLBACK;
    const estimatedImpressions = ctr > 0 ? estimatedClicks / ctr : estimatedClicks * 100;
    const estimatedConversions = estimatedClicks * (cvr / 100);
    const estimatedSales = estimatedConversions * aov;
    const estimatedCpc = bidLevel * CPC_BID_RATIO;
    const estimatedSpend = estimatedClicks * estimatedCpc;
    let marginalRevenue = 0;
    let marginalCost = 0;
    if (i > 0) {
      const prevPoint = points[i - 1];
      marginalRevenue = (estimatedSales - prevPoint.estimatedSales) / bidStep;
      marginalCost = (estimatedSpend - prevPoint.estimatedSpend) / bidStep;
    }
    points.push({
      bidLevel: Math.round(bidLevel * 100) / 100,
      estimatedImpressions: Math.round(estimatedImpressions),
      estimatedClicks: Math.round(estimatedClicks),
      estimatedConversions: Math.round(estimatedConversions * 100) / 100,
      estimatedSpend: Math.round(estimatedSpend * 100) / 100,
      estimatedSales: Math.round(estimatedSales * 100) / 100,
      marginalRevenue: Math.round(marginalRevenue * 100) / 100,
      marginalCost: Math.round(marginalCost * 100) / 100
    });
  }
  return points;
}
function findOptimalBid(marketCurve, config2) {
  let optimalBid = marketCurve[0].bidLevel;
  switch (config2.optimizationGoal) {
    case "maximize_sales":
      for (const point of marketCurve) {
        if (point.marginalRevenue >= point.marginalCost) {
          optimalBid = point.bidLevel;
        } else {
          break;
        }
      }
      break;
    case "target_acos":
      if (config2.targetAcos) {
        for (const point of marketCurve) {
          const acos = point.estimatedSpend > 0 ? point.estimatedSpend / point.estimatedSales * 100 : 0;
          if (acos <= config2.targetAcos) {
            optimalBid = point.bidLevel;
          }
        }
      }
      break;
    case "target_roas":
      if (config2.targetRoas) {
        for (const point of marketCurve) {
          const roas = point.estimatedSpend > 0 ? point.estimatedSales / point.estimatedSpend : 0;
          if (roas >= config2.targetRoas) {
            optimalBid = point.bidLevel;
          }
        }
      }
      break;
    case "daily_spend_limit":
      if (config2.dailySpendLimit) {
        for (const point of marketCurve) {
          if (point.estimatedSpend <= config2.dailySpendLimit) {
            optimalBid = point.bidLevel;
          }
        }
      }
      break;
    case "daily_cost":
      if (config2.dailyCostTarget) {
        let minDiff = Infinity;
        for (const point of marketCurve) {
          const diff = Math.abs(point.estimatedSpend - config2.dailyCostTarget);
          if (diff < minDiff) {
            minDiff = diff;
            optimalBid = point.bidLevel;
          }
        }
      }
      break;
  }
  return optimalBid;
}
var init_marketCurve = __esm({
  "server/optimization/bidOptimizer/marketCurve.ts"() {
    "use strict";
    init_algorithmUtils();
    init_types();
    __name(calculateMetrics, "calculateMetrics");
    __name(generateMarketCurve, "generateMarketCurve");
    __name(findOptimalBid, "findOptimalBid");
  }
});

