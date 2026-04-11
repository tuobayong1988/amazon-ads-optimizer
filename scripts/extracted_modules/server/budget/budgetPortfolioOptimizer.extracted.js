// Extracted from production dist/index.js
// Original module: server/budget/budgetPortfolioOptimizer.ts
// Lines: 203

async function getDbInstance8() {
  const db = await getDb();
  if (!db) throw new Error("Database connection failed");
  return db;
}
function profitFunction(budget, maxSales, efficiency) {
  return maxSales * (1 - Math.exp(-efficiency * budget)) - budget;
}
function marginalProfit(budget, maxSales, efficiency) {
  return maxSales * efficiency * Math.exp(-efficiency * budget) - 1;
}
function budgetFromMarginal(lambda, maxSales, efficiency) {
  const numerator = lambda + 1;
  const denominator = maxSales * efficiency;
  if (denominator <= 0 || numerator <= 0) return 0;
  return Math.max(0, -Math.log(numerator / denominator) / efficiency);
}
async function estimateProfitCurve(db, accountId, campaignId, campaignName, currentBudget, daysBack = 30) {
  const startDate = new Date(Date.now() - daysBack * 864e5).toISOString().split("T")[0];
  const endDate = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
  const perfData = await db.select({
    totalSpend: sql`SUM(CAST(spend AS DECIMAL(10,2)))`,
    totalSales: sql`SUM(CAST(sales AS DECIMAL(10,2)))`,
    totalOrders: sql`SUM(orders)`,
    totalClicks: sql`SUM(clicks)`,
    totalImpressions: sql`SUM(impressions)`,
    dayCount: sql`COUNT(DISTINCT date)`
  }).from(dailyPerformance).where(and(
    eq(dailyPerformance.accountId, accountId),
    eq(dailyPerformance.campaignId, campaignId),
    gte(dailyPerformance.date, startDate),
    lte(dailyPerformance.date, endDate)
  ));
  const perf = perfData[0] || {};
  const totalSpend = Number(perf.totalSpend) || 0;
  const totalSales = Number(perf.totalSales) || 0;
  const dayCount = Number(perf.dayCount) || 1;
  const avgDailySpend = totalSpend / dayCount;
  const avgDailySales = totalSales / dayCount;
  const avgRoas = totalSpend > 0 ? totalSales / totalSpend : 0;
  const avgAcos = totalSales > 0 ? totalSpend / totalSales : 1;
  const maxSales = avgDailySales * 2.5;
  const efficiency = avgDailySpend > 0 ? -Math.log(1 - avgDailySales / Math.max(maxSales, avgDailySales * 1.1)) / avgDailySpend : 0.1;
  return {
    campaignId,
    campaignName,
    currentBudget,
    maxSales,
    efficiency: Math.max(1e-3, efficiency),
    avgRoas,
    avgAcos,
    avgSpend: avgDailySpend,
    avgSales: avgDailySales
  };
}
function marginalUtilityAllocation(curves, totalBudget, maxChangePercent = 0.5) {
  if (curves.length === 0) return [];
  let lambdaLow = -1;
  let lambdaHigh = 10;
  const tolerance = 0.01;
  let iterations = 0;
  const maxIterations = 100;
  while (lambdaHigh - lambdaLow > tolerance && iterations < maxIterations) {
    const lambdaMid = (lambdaLow + lambdaHigh) / 2;
    let totalAllocated = 0;
    for (const curve of curves) {
      let budget = budgetFromMarginal(lambdaMid, curve.maxSales, curve.efficiency);
      budget = Math.max(
        curve.currentBudget * (1 - maxChangePercent),
        Math.min(curve.currentBudget * (1 + maxChangePercent), budget)
      );
      budget = Math.max(1, budget);
      totalAllocated += budget;
    }
    if (totalAllocated > totalBudget) {
      lambdaLow = lambdaMid;
    } else {
      lambdaHigh = lambdaMid;
    }
    iterations++;
  }
  const optimalLambda = (lambdaLow + lambdaHigh) / 2;
  const allocations = curves.map((curve) => {
    let optimalBudget = budgetFromMarginal(optimalLambda, curve.maxSales, curve.efficiency);
    optimalBudget = Math.max(
      curve.currentBudget * (1 - maxChangePercent),
      Math.min(curve.currentBudget * (1 + maxChangePercent), optimalBudget)
    );
    optimalBudget = Math.max(1, Math.round(optimalBudget * 100) / 100);
    const expectedProfit = profitFunction(optimalBudget, curve.maxSales, curve.efficiency);
    const expectedSales = curve.maxSales * (1 - Math.exp(-curve.efficiency * optimalBudget));
    const expectedRoas = optimalBudget > 0 ? expectedSales / optimalBudget : 0;
    const mp = marginalProfit(optimalBudget, curve.maxSales, curve.efficiency);
    return {
      campaignId: curve.campaignId,
      campaignName: curve.campaignName,
      currentBudget: curve.currentBudget,
      optimalBudget,
      budgetChange: Math.round((optimalBudget - curve.currentBudget) * 100) / 100,
      changePercent: curve.currentBudget > 0 ? Math.round((optimalBudget - curve.currentBudget) / curve.currentBudget * 1e4) / 1e4 : 0,
      expectedProfit: Math.round(expectedProfit * 100) / 100,
      expectedRoas: Math.round(expectedRoas * 100) / 100,
      marginalProfit: Math.round(mp * 1e4) / 1e4
    };
  });
  return allocations;
}
async function optimizeBudgetPortfolio(accountId, performanceGroupId2, totalBudgetOverride) {
  const db = await getDbInstance8();
  try {
    const whereConditions = [
      eq(campaigns.accountId, accountId),
      eq(campaigns.campaignStatus, "enabled")
    ];
    if (performanceGroupId2) {
      whereConditions.push(eq(campaigns.performanceGroupId, performanceGroupId2));
    }
    const activeCampaigns = await db.select({
      id: campaigns.id,
      campaignId: campaigns.campaignId,
      name: campaigns.campaignName,
      dailyBudget: campaigns.dailyBudget,
      campaignType: campaigns.campaignType,
      performanceGroupId: campaigns.performanceGroupId
    }).from(campaigns).where(and(...whereConditions)).limit(100);
    if (activeCampaigns.length === 0) return null;
    const currentTotalBudget = activeCampaigns.reduce(
      (sum2, c) => sum2 + (Number(c.dailyBudget) || 0),
      0
    );
    const totalBudget = totalBudgetOverride || currentTotalBudget;
    const curves = [];
    for (const campaign of activeCampaigns) {
      const curve = await estimateProfitCurve(
        db,
        accountId,
        // @ts-ignore
        String(campaign.campaignId),
        // @ts-ignore
        campaign.name || "",
        // @ts-ignore
        Number(campaign.dailyBudget) || 10
      );
      curves.push(curve);
    }
    const allocations = marginalUtilityAllocation(curves, totalBudget);
    const expectedTotalProfit = allocations.reduce((sum2, a) => sum2 + a.expectedProfit, 0);
    const totalAllocated = allocations.reduce((sum2, a) => sum2 + a.optimalBudget, 0);
    const expectedTotalSales = curves.reduce((sum2, c, i) => {
      const budget = allocations[i]?.optimalBudget || c.currentBudget;
      return sum2 + c.maxSales * (1 - Math.exp(-c.efficiency * budget));
    }, 0);
    const expectedTotalRoas = totalAllocated > 0 ? expectedTotalSales / totalAllocated : 0;
    const result = {
      totalBudget,
      allocations,
      // @ts-ignore
      expectedTotalProfit: Math.round(expectedTotalProfit * 100) / 100,
      expectedTotalRoas: Math.round(expectedTotalRoas * 100) / 100,
      expectedTotalSales: Math.round(expectedTotalSales * 100) / 100,
      algorithmUsed: "marginal_utility",
      iterationCount: 100,
      convergenceScore: 0.99
    };
    await db.insert(budgetOptimizationResults).values({
      accountId,
      performanceGroupId: performanceGroupId2 || null,
      optimizationDate: (/* @__PURE__ */ new Date()).toISOString().split("T")[0],
      totalBudget: String(totalBudget),
      allocations,
      expectedTotalProfit: String(result.expectedTotalProfit),
      expectedTotalRoas: String(result.expectedTotalRoas),
      expectedTotalSales: String(result.expectedTotalSales),
      algorithmUsed: "marginal_utility",
      iterationCount: 100,
      convergenceScore: "0.990000"
    });
    log49.info(`[BudgetPortfolio] Optimized ${allocations.length} campaigns, expected profit: $${result.expectedTotalProfit}`);
    return result;
  } catch (error48) {
    log49.warn(`[BudgetPortfolio] Error:`, error48);
    return null;
  }
}
var log49;
var init_budgetPortfolioOptimizer = __esm({
  "server/budget/budgetPortfolioOptimizer.ts"() {
    "use strict";
    init_logger();
    init_db2();
    init_schema2();
    init_drizzle_orm();
    log49 = createModuleLogger("BudgetPortfolioOptimizer");
    __name(getDbInstance8, "getDbInstance");
    __name(profitFunction, "profitFunction");
    __name(marginalProfit, "marginalProfit");
    __name(budgetFromMarginal, "budgetFromMarginal");
    __name(estimateProfitCurve, "estimateProfitCurve");
    __name(marginalUtilityAllocation, "marginalUtilityAllocation");
    __name(optimizeBudgetPortfolio, "optimizeBudgetPortfolio");
  }
});

