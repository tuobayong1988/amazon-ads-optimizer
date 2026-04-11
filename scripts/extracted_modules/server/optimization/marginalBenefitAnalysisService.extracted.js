// Extracted from production dist/index.js
// Original module: server/optimization/marginalBenefitAnalysisService.ts
// Lines: 662

var marginalBenefitAnalysisService_exports = {};
__export(marginalBenefitAnalysisService_exports, {
  batchAnalyzeMarginalBenefits: () => batchAnalyzeMarginalBenefits,
  batchAnalyzeMarginalBenefitsSimple: () => batchAnalyzeMarginalBenefitsSimple,
  calculateAnalysisConfidence: () => calculateAnalysisConfidence,
  calculateElasticity: () => calculateElasticity,
  calculateMarginalBenefit: () => calculateMarginalBenefit,
  calculateMarginalBenefitSimple: () => calculateMarginalBenefitSimple,
  calculateMarginalMetrics: () => calculateMarginalMetrics,
  calculateOptimalRange: () => calculateOptimalRange,
  findDiminishingPoint: () => findDiminishingPoint,
  generateMarginalBenefitReport: () => generateMarginalBenefitReport,
  optimizeTrafficAllocation: () => optimizeTrafficAllocation,
  optimizeTrafficAllocationSimple: () => optimizeTrafficAllocationSimple
});
async function calculateMarginalBenefit(campaignId, accountId, placementType, currentAdjustment, days = 30) {
  const db = await getDb();
  if (!db) {
    return createDefaultMarginalBenefitResult(placementType, currentAdjustment, 0);
  }
  const endDate = /* @__PURE__ */ new Date();
  const startDate = /* @__PURE__ */ new Date();
  startDate.setDate(startDate.getDate() - days);
  const historicalData = await db.select({
    date: placementPerformance.date,
    impressions: placementPerformance.impressions,
    clicks: placementPerformance.clicks,
    spend: placementPerformance.spend,
    sales: placementPerformance.sales,
    orders: placementPerformance.orders
  }).from(placementPerformance).where(
    and(
      eq(placementPerformance.campaignId, String(campaignId)),
      eq(placementPerformance.accountId, accountId),
      sql`${placementPerformance.placement} = ${placementType}`,
      gte(placementPerformance.date, startDate.toISOString()),
      lte(placementPerformance.date, endDate.toISOString())
    )
  ).orderBy(desc(placementPerformance.date));
  if (historicalData.length < 7) {
    return createDefaultMarginalBenefitResult(placementType, currentAdjustment, historicalData.length);
  }
  const convertedData = historicalData.map((d) => ({
    impressions: Number(d.impressions) || 0,
    clicks: Number(d.clicks) || 0,
    spend: Number(d.spend) || 0,
    sales: Number(d.sales) || 0,
    orders: Number(d.orders) || 0
  }));
  const metrics = calculateMarginalMetrics(convertedData, currentAdjustment);
  const elasticity = calculateElasticity(convertedData);
  const diminishingPoint = findDiminishingPoint(convertedData, currentAdjustment);
  const optimalRange = calculateOptimalRange(metrics, diminishingPoint, currentAdjustment);
  const confidence = calculateAnalysisConfidence(convertedData);
  return {
    placementType,
    currentAdjustment,
    marginalROAS: metrics.marginalROAS,
    marginalACoS: metrics.marginalACoS,
    marginalSales: metrics.marginalSales,
    marginalSpend: metrics.marginalSpend,
    elasticity,
    diminishingPoint,
    optimalRange,
    confidence,
    dataPoints: historicalData.length
  };
}
function calculateMarginalMetrics(data, currentAdjustment) {
  const totalSpend = data.reduce((sum2, d) => sum2 + (d.spend || 0), 0);
  const totalSales = data.reduce((sum2, d) => sum2 + (d.sales || 0), 0);
  const totalClicks = data.reduce((sum2, d) => sum2 + (d.clicks || 0), 0);
  const totalOrders = data.reduce((sum2, d) => sum2 + (d.orders || 0), 0);
  if (totalSpend === 0) {
    return { marginalROAS: 0, marginalACoS: 0, marginalSales: 0, marginalSpend: 0 };
  }
  const avgROAS = totalSales / totalSpend;
  const avgACoS = totalSpend / totalSales * 100;
  const avgDailySales = totalSales / data.length;
  const avgDailySpend = totalSpend / data.length;
  const flowSensitivity = 8e-3;
  const conversionRetention = Math.max(0.7, 1 - currentAdjustment * 1e-3);
  const marginalSales = avgDailySales * flowSensitivity * conversionRetention;
  const cpcInflation = 1 + currentAdjustment * 2e-3;
  const marginalSpend = avgDailySpend * flowSensitivity * cpcInflation;
  const marginalROAS = marginalSpend > 0 ? marginalSales / marginalSpend : 0;
  const marginalACoS = marginalSales > 0 ? marginalSpend / marginalSales * 100 : 999;
  return {
    marginalROAS,
    marginalACoS,
    marginalSales,
    marginalSpend
  };
}
function calculateElasticity(data) {
  if (data.length < 2) return 1;
  const midPoint = Math.floor(data.length / 2);
  const recentData = data.slice(0, midPoint);
  const olderData = data.slice(midPoint);
  const recentSales = recentData.reduce((sum2, d) => sum2 + (d.sales || 0), 0);
  const olderSales = olderData.reduce((sum2, d) => sum2 + (d.sales || 0), 0);
  if (olderSales === 0) return 1;
  const salesChange = (recentSales - olderSales) / olderSales;
  const assumedAdjustmentChange = 0.1;
  return salesChange / assumedAdjustmentChange;
}
function findDiminishingPoint(data, currentAdjustment) {
  const totalSpend = data.reduce((sum2, d) => sum2 + (d.spend || 0), 0);
  const totalSales = data.reduce((sum2, d) => sum2 + (d.sales || 0), 0);
  const avgROAS = totalSpend > 0 ? totalSales / totalSpend : 0;
  if (avgROAS >= 5) {
    return 100;
  } else if (avgROAS >= 3) {
    return 70;
  } else if (avgROAS >= 1.5) {
    return 50;
  } else {
    return 30;
  }
}
function calculateOptimalRange(metrics, diminishingPoint, currentAdjustment) {
  if (metrics.marginalROAS > 1.5) {
    return {
      min: Math.max(0, currentAdjustment - 10),
      max: Math.min(200, diminishingPoint + 20)
    };
  } else if (metrics.marginalROAS > 1) {
    return {
      min: Math.max(0, currentAdjustment - 20),
      max: Math.min(200, currentAdjustment + 20)
    };
  } else {
    return {
      min: 0,
      max: Math.max(0, currentAdjustment - 10)
    };
  }
}
function calculateAnalysisConfidence(data) {
  const totalOrders = data.reduce((sum2, d) => sum2 + (d.orders || 0), 0);
  const totalClicks = data.reduce((sum2, d) => sum2 + (d.clicks || 0), 0);
  const dataPoints = data.length;
  let confidence = 0.3;
  if (dataPoints >= 30) confidence += 0.2;
  else if (dataPoints >= 14) confidence += 0.1;
  if (totalOrders >= 50) confidence += 0.3;
  else if (totalOrders >= 20) confidence += 0.2;
  else if (totalOrders >= 10) confidence += 0.1;
  if (totalClicks >= 500) confidence += 0.2;
  else if (totalClicks >= 200) confidence += 0.1;
  return Math.min(1, confidence);
}
function createDefaultMarginalBenefitResult(placementType, currentAdjustment, dataPoints) {
  return {
    placementType,
    currentAdjustment,
    marginalROAS: 1,
    marginalACoS: 100,
    marginalSales: 0,
    marginalSpend: 0,
    elasticity: 1,
    diminishingPoint: 50,
    optimalRange: { min: 0, max: 50 },
    confidence: 0.2,
    dataPoints
  };
}
async function optimizeTrafficAllocation(campaignId, accountId, currentAdjustments, goal = "balanced", constraints = {}) {
  const placements = ["top_of_search", "product_page", "rest_of_search"];
  const effectiveConstraints = {
    maxTotalAdjustment: constraints.maxTotalAdjustment ?? 400,
    minAdjustmentPerPlacement: constraints.minAdjustmentPerPlacement ?? -50,
    maxAdjustmentPerPlacement: constraints.maxAdjustmentPerPlacement ?? 200,
    maxSpendIncrease: constraints.maxSpendIncrease ?? 30,
    targetACoS: constraints.targetACoS ?? 30,
    targetROAS: constraints.targetROAS ?? 3
  };
  const marginalBenefits = {};
  for (const placement of placements) {
    marginalBenefits[placement] = await calculateMarginalBenefit(
      campaignId,
      accountId,
      placement,
      currentAdjustments[placement] || 0
    );
  }
  const currentPerformance = await getCurrentPerformance(campaignId, accountId);
  const optimizedAdjustments = runOptimizationAlgorithm(
    currentAdjustments,
    marginalBenefits,
    goal,
    effectiveConstraints
  );
  const expectedResults = calculateExpectedResults(
    currentPerformance,
    currentAdjustments,
    optimizedAdjustments,
    marginalBenefits
  );
  const allocations = placements.map((placement) => ({
    placementType: placement,
    currentAdjustment: currentAdjustments[placement] || 0,
    suggestedAdjustment: optimizedAdjustments[placement],
    adjustmentDelta: optimizedAdjustments[placement] - (currentAdjustments[placement] || 0),
    expectedSalesChange: expectedResults.salesChangeByPlacement[placement],
    expectedSpendChange: expectedResults.spendChangeByPlacement[placement],
    marginalBenefit: marginalBenefits[placement].marginalROAS,
    allocationReason: generateAllocationReason(
      placement,
      currentAdjustments[placement] || 0,
      optimizedAdjustments[placement],
      marginalBenefits[placement],
      goal
    )
  }));
  const overallConfidence = Math.min(
    ...placements.map((p) => marginalBenefits[p].confidence)
  );
  return {
    allocations,
    totalExpectedSales: expectedResults.totalSales,
    totalExpectedSpend: expectedResults.totalSpend,
    expectedROAS: expectedResults.expectedROAS,
    expectedACoS: expectedResults.expectedACoS,
    improvement: {
      salesChange: expectedResults.salesChange,
      salesChangePercent: expectedResults.salesChangePercent,
      roasChange: expectedResults.roasChange,
      acosChange: expectedResults.acosChange
    },
    optimizationGoal: goal,
    confidence: overallConfidence
  };
}
async function getCurrentPerformance(campaignId, accountId) {
  const db = await getDb();
  if (!db) {
    return {
      totalSales: 0,
      totalSpend: 0,
      roas: 0,
      acos: 0,
      byPlacement: {
        top_of_search: { sales: 0, spend: 0 },
        product_page: { sales: 0, spend: 0 },
        rest_of_search: { sales: 0, spend: 0 }
      }
    };
  }
  const endDate = /* @__PURE__ */ new Date();
  const startDate = /* @__PURE__ */ new Date();
  startDate.setDate(startDate.getDate() - 7);
  const data = await db.select({
    placement: placementPerformance.placement,
    sales: sql`SUM(${placementPerformance.sales})`,
    spend: sql`SUM(${placementPerformance.spend})`
  }).from(placementPerformance).where(
    and(
      eq(placementPerformance.campaignId, String(campaignId)),
      eq(placementPerformance.accountId, accountId),
      gte(placementPerformance.date, startDate.toISOString()),
      lte(placementPerformance.date, endDate.toISOString())
    )
  ).groupBy(placementPerformance.placement);
  const byPlacement = {
    // @ts-ignore
    top_of_search: { sales: 0, spend: 0 },
    // @ts-ignore
    product_page: { sales: 0, spend: 0 },
    rest_of_search: { sales: 0, spend: 0 }
  };
  let totalSales = 0;
  let totalSpend = 0;
  for (const row of data) {
    const placement = row.placement;
    if (byPlacement[placement]) {
      byPlacement[placement].sales = Number(row.sales) || 0;
      byPlacement[placement].spend = Number(row.spend) || 0;
      totalSales += byPlacement[placement].sales;
      totalSpend += byPlacement[placement].spend;
    }
  }
  return {
    totalSales,
    totalSpend,
    roas: totalSpend > 0 ? totalSales / totalSpend : 0,
    acos: totalSales > 0 ? totalSpend / totalSales * 100 : 0,
    byPlacement
  };
}
function runOptimizationAlgorithm(currentAdjustments, marginalBenefits, goal, constraints) {
  const placements = ["top_of_search", "product_page", "rest_of_search"];
  const optimized = { ...currentAdjustments };
  const priorityScores = placements.map((placement) => {
    const mb = marginalBenefits[placement];
    let score = 0;
    switch (goal) {
      case "maximize_roas":
        score = mb.marginalROAS * mb.confidence;
        break;
      case "minimize_acos":
        score = (100 - mb.marginalACoS) * mb.confidence / 100;
        break;
      case "maximize_sales":
        score = mb.marginalSales * mb.confidence;
        break;
      case "balanced":
      default:
        score = (mb.marginalROAS * 0.6 + mb.elasticity * 0.4) * mb.confidence;
    }
    return { placement, score, mb };
  }).sort((a, b) => b.score - a.score);
  let totalAdjustment = Object.values(optimized).reduce((sum2, v) => sum2 + v, 0);
  const maxIterations = 20;
  const stepSize = 5;
  for (let i = 0; i < maxIterations; i++) {
    let improved = false;
    for (const { placement, mb } of priorityScores) {
      const current = optimized[placement];
      if (current < constraints.maxAdjustmentPerPlacement && current < mb.diminishingPoint + 20 && totalAdjustment + stepSize <= constraints.maxTotalAdjustment) {
        if (mb.marginalROAS > 1 || goal === "maximize_sales") {
          optimized[placement] = Math.min(
            current + stepSize,
            constraints.maxAdjustmentPerPlacement,
            mb.optimalRange.max
          );
          totalAdjustment += optimized[placement] - current;
          improved = true;
        }
      }
    }
    if (!improved) {
      const lowest = priorityScores[priorityScores.length - 1];
      const highest = priorityScores[0];
      if (lowest.score < highest.score * 0.5 && optimized[lowest.placement] > constraints.minAdjustmentPerPlacement) {
        const reduction = Math.min(stepSize, optimized[lowest.placement] - constraints.minAdjustmentPerPlacement);
        optimized[lowest.placement] -= reduction;
        if (optimized[highest.placement] < constraints.maxAdjustmentPerPlacement) {
          optimized[highest.placement] = Math.min(
            // @ts-expect-error - runtime type mismatch
            optimized[highest.placement] + reduction,
            constraints.maxAdjustmentPerPlacement
          );
          improved = true;
        }
      }
    }
    if (!improved) break;
  }
  for (const placement of placements) {
    optimized[placement] = Math.max(
      constraints.minAdjustmentPerPlacement,
      Math.min(constraints.maxAdjustmentPerPlacement, optimized[placement])
    );
  }
  return optimized;
}
function calculateExpectedResults(currentPerformance, currentAdjustments, optimizedAdjustments, marginalBenefits) {
  const placements = ["top_of_search", "product_page", "rest_of_search"];
  let totalExpectedSales = 0;
  let totalExpectedSpend = 0;
  const salesChangeByPlacement = {};
  const spendChangeByPlacement = {};
  for (const placement of placements) {
    const currentAdj = currentAdjustments[placement] || 0;
    const newAdj = optimizedAdjustments[placement];
    const delta = newAdj - currentAdj;
    const mb = marginalBenefits[placement];
    const currentSales = currentPerformance.byPlacement[placement].sales;
    const currentSpend = currentPerformance.byPlacement[placement].spend;
    const salesChange2 = delta * mb.marginalSales;
    const spendChange = delta * mb.marginalSpend;
    salesChangeByPlacement[placement] = salesChange2;
    spendChangeByPlacement[placement] = spendChange;
    totalExpectedSales += currentSales + salesChange2;
    totalExpectedSpend += currentSpend + spendChange;
  }
  const expectedROAS = totalExpectedSpend > 0 ? totalExpectedSales / totalExpectedSpend : 0;
  const expectedACoS = totalExpectedSales > 0 ? totalExpectedSpend / totalExpectedSales * 100 : 0;
  const salesChange = totalExpectedSales - currentPerformance.totalSales;
  const salesChangePercent = currentPerformance.totalSales > 0 ? salesChange / currentPerformance.totalSales * 100 : 0;
  return {
    totalSales: totalExpectedSales,
    totalSpend: totalExpectedSpend,
    expectedROAS,
    expectedACoS,
    salesChange,
    salesChangePercent,
    roasChange: expectedROAS - currentPerformance.roas,
    acosChange: expectedACoS - currentPerformance.acos,
    salesChangeByPlacement,
    spendChangeByPlacement
  };
}
function generateAllocationReason(placement, currentAdjustment, suggestedAdjustment, mb, goal) {
  const delta = suggestedAdjustment - currentAdjustment;
  const placementNames = {
    top_of_search: "\u641C\u7D22\u9876\u90E8",
    product_page: "\u5546\u54C1\u8BE6\u60C5\u9875",
    rest_of_search: "\u5176\u4F59\u4F4D\u7F6E"
  };
  if (Math.abs(delta) < 5) {
    return `${placementNames[placement]}\u5F53\u524D\u503E\u659C\u6C34\u5E73\u63A5\u8FD1\u6700\u4F18\uFF0C\u5EFA\u8BAE\u4FDD\u6301`;
  }
  if (delta > 0) {
    if (mb.marginalROAS > 2) {
      return `${placementNames[placement]}\u8FB9\u9645ROAS\u9AD8\u8FBE${mb.marginalROAS.toFixed(2)}\uFF0C\u589E\u52A0\u503E\u659C\u53EF\u663E\u8457\u63D0\u5347\u6536\u76CA`;
    } else if (mb.marginalROAS > 1) {
      return `${placementNames[placement]}\u8FB9\u9645\u6548\u76CA\u4E3A\u6B63\uFF0C\u9002\u5EA6\u589E\u52A0\u503E\u659C`;
    } else {
      return `\u6839\u636E${goal === "maximize_sales" ? "\u9500\u552E\u6700\u5927\u5316" : "\u6574\u4F53\u4F18\u5316"}\u76EE\u6807\uFF0C\u5EFA\u8BAE\u589E\u52A0${placementNames[placement]}\u503E\u659C`;
    }
  } else {
    if (mb.marginalROAS < 0.5) {
      return `${placementNames[placement]}\u8FB9\u9645\u6548\u76CA\u8F83\u4F4E\uFF08ROAS ${mb.marginalROAS.toFixed(2)}\uFF09\uFF0C\u5EFA\u8BAE\u964D\u4F4E\u503E\u659C`;
    } else if (currentAdjustment > mb.diminishingPoint) {
      return `${placementNames[placement]}\u5F53\u524D\u503E\u659C(${currentAdjustment}%)\u5DF2\u8D85\u8FC7\u6548\u76CA\u9012\u51CF\u62D0\u70B9(${mb.diminishingPoint}%)\uFF0C\u5EFA\u8BAE\u9002\u5EA6\u964D\u4F4E`;
    } else {
      return `\u5C06\u8D44\u6E90\u4ECE${placementNames[placement]}\u8F6C\u79FB\u5230\u66F4\u9AD8\u6548\u7684\u4F4D\u7F6E`;
    }
  }
}
async function batchAnalyzeMarginalBenefits(accountId, campaignIds) {
  const db = await getDb();
  const results = /* @__PURE__ */ new Map();
  if (!db) {
    return results;
  }
  let campaignsToAnalyze;
  if (campaignIds && campaignIds.length > 0) {
    campaignsToAnalyze = campaignIds;
  } else {
    const activeCampaigns = await db.select({ campaignId: campaigns.campaignId }).from(campaigns).where(
      and(
        eq(campaigns.accountId, accountId),
        eq(campaigns.campaignStatus, "enabled")
      )
    );
    campaignsToAnalyze = activeCampaigns.map((c) => c.campaignId);
  }
  const placements = ["top_of_search", "product_page", "rest_of_search"];
  for (const campaignId of campaignsToAnalyze) {
    const campaignResults = {};
    for (const placement of placements) {
      campaignResults[placement] = await calculateMarginalBenefit(
        campaignId,
        accountId,
        placement,
        0,
        // 假设当前倾斜为0，实际应从数据库获取
        30
      );
    }
    results.set(campaignId, campaignResults);
  }
  return results;
}
function generateMarginalBenefitReport(marginalBenefits, allocationResult) {
  const placements = ["top_of_search", "product_page", "rest_of_search"];
  const placementNames = {
    top_of_search: "\u641C\u7D22\u9876\u90E8",
    product_page: "\u5546\u54C1\u8BE6\u60C5\u9875",
    rest_of_search: "\u5176\u4F59\u4F4D\u7F6E"
  };
  let report = "# \u8FB9\u9645\u6548\u76CA\u5206\u6790\u62A5\u544A\n\n";
  report += "## \u6982\u8981\n\n";
  report += `- \u4F18\u5316\u76EE\u6807: ${allocationResult.optimizationGoal}
`;
  report += `- \u5206\u6790\u7F6E\u4FE1\u5EA6: ${(allocationResult.confidence * 100).toFixed(0)}%
`;
  report += `- \u9884\u671F\u9500\u552E\u989D\u53D8\u5316: ${allocationResult.improvement.salesChangePercent >= 0 ? "+" : ""}${allocationResult.improvement.salesChangePercent.toFixed(1)}%
`;
  report += `- \u9884\u671FROAS\u53D8\u5316: ${allocationResult.improvement.roasChange >= 0 ? "+" : ""}${allocationResult.improvement.roasChange.toFixed(2)}

`;
  report += "## \u5404\u4F4D\u7F6E\u8FB9\u9645\u6548\u76CA\u5206\u6790\n\n";
  report += "| \u4F4D\u7F6E | \u8FB9\u9645ROAS | \u8FB9\u9645ACoS | \u5F39\u6027\u7CFB\u6570 | \u9012\u51CF\u62D0\u70B9 | \u5EFA\u8BAE\u8303\u56F4 |\n";
  report += "|------|----------|----------|----------|----------|----------|\n";
  for (const placement of placements) {
    const mb = marginalBenefits[placement];
    report += `| ${placementNames[placement]} | ${mb.marginalROAS.toFixed(2)} | ${mb.marginalACoS.toFixed(1)}% | ${mb.elasticity.toFixed(2)} | ${mb.diminishingPoint}% | ${mb.optimalRange.min}%-${mb.optimalRange.max}% |
`;
  }
  report += "\n## \u4F18\u5316\u5EFA\u8BAE\n\n";
  report += "| \u4F4D\u7F6E | \u5F53\u524D\u503E\u659C | \u5EFA\u8BAE\u503E\u659C | \u8C03\u6574\u5E45\u5EA6 | \u539F\u56E0 |\n";
  report += "|------|----------|----------|----------|------|\n";
  for (const allocation of allocationResult.allocations) {
    const delta = allocation.adjustmentDelta;
    const deltaStr = delta >= 0 ? `+${delta.toFixed(0)}%` : `${delta.toFixed(0)}%`;
    report += `| ${placementNames[allocation.placementType]} | ${allocation.currentAdjustment}% | ${allocation.suggestedAdjustment.toFixed(0)}% | ${deltaStr} | ${allocation.allocationReason} |
`;
  }
  report += "\n## \u9884\u671F\u6548\u679C\n\n";
  report += `- \u9884\u671F\u603B\u9500\u552E\u989D: $${allocationResult.totalExpectedSales.toFixed(2)}
`;
  report += `- \u9884\u671F\u603B\u82B1\u8D39: $${allocationResult.totalExpectedSpend.toFixed(2)}
`;
  report += `- \u9884\u671FROAS: ${allocationResult.expectedROAS.toFixed(2)}
`;
  report += `- \u9884\u671FACoS: ${allocationResult.expectedACoS.toFixed(1)}%
`;
  return report;
}
function calculateMarginalBenefitSimple(metrics, currentAdjustment) {
  const baseROAS = metrics.roas || 1;
  const baseACoS = metrics.acos || 100;
  const decayFactor = Math.exp(-currentAdjustment / 100);
  const marginalROAS = Math.max(0.1, baseROAS * decayFactor * (1 - currentAdjustment / 400));
  const marginalACoS = marginalROAS > 0 ? 100 / marginalROAS : 100;
  const avgOrderValue = metrics.orders > 0 ? metrics.sales / metrics.orders : 50;
  const marginalSales = avgOrderValue * marginalROAS * 0.1;
  const marginalSpend = marginalSales / (marginalROAS || 1);
  const elasticity = baseROAS > 1 ? Math.log(baseROAS) / Math.log(2) : 0.5;
  const diminishingPoint = Math.max(30, Math.min(150, 50 + baseROAS * 20));
  const optimalMin = Math.max(0, diminishingPoint - 30);
  const optimalMax = Math.min(200, diminishingPoint + 30);
  let confidence = 0.3;
  if (metrics.orders >= 50) confidence += 0.3;
  else if (metrics.orders >= 20) confidence += 0.2;
  else if (metrics.orders >= 10) confidence += 0.1;
  if (metrics.clicks >= 500) confidence += 0.2;
  else if (metrics.clicks >= 200) confidence += 0.1;
  if (metrics.impressions >= 1e4) confidence += 0.2;
  else if (metrics.impressions >= 5e3) confidence += 0.1;
  confidence = Math.min(1, confidence);
  return {
    marginalROAS,
    marginalACoS,
    marginalSales,
    marginalSpend,
    elasticity,
    diminishingPoint,
    optimalRange: { min: optimalMin, max: optimalMax },
    confidence
  };
}
function optimizeTrafficAllocationSimple(marginalBenefits, currentAdjustments, goal = "balanced") {
  const placements = ["top_of_search", "product_page", "rest_of_search"];
  const optimized = { ...currentAdjustments };
  const scores = placements.map((placement) => {
    const mb = marginalBenefits[placement] || {
      marginalROAS: 1,
      marginalACoS: 100,
      marginalSales: 0,
      elasticity: 0.5,
      diminishingPoint: 50,
      optimalRange: { min: 0, max: 50 },
      // @ts-ignore
      confidence: 0.3
    };
    let score = 0;
    switch (goal) {
      // @ts-ignore
      case "maximize_roas":
        score = mb.marginalROAS * mb.confidence;
        break;
      case "minimize_acos":
        score = (100 - mb.marginalACoS) * mb.confidence / 100;
        break;
      case "maximize_sales":
        score = mb.marginalSales * mb.confidence;
        break;
      case "balanced":
      default:
        score = (mb.marginalROAS * 0.6 + mb.elasticity * 0.4) * mb.confidence;
    }
    return { placement, score, mb };
  }).sort((a, b) => b.score - a.score);
  const stepSize = 5;
  const maxIterations = 20;
  let totalAdjustment = Object.values(optimized).reduce((sum2, v) => sum2 + v, 0);
  for (let i = 0; i < maxIterations; i++) {
    let improved = false;
    for (const { placement, mb } of scores) {
      const current = optimized[placement] || 0;
      if (current < 200 && current < mb.diminishingPoint + 20 && totalAdjustment + stepSize <= 400) {
        if (mb.marginalROAS > 1 || goal === "maximize_sales") {
          const newValue = Math.min(current + stepSize, 200, mb.optimalRange.max);
          if (newValue > current) {
            optimized[placement] = newValue;
            totalAdjustment += newValue - current;
            improved = true;
          }
        }
      }
    }
    if (!improved) break;
  }
  let expectedSalesIncrease = 0;
  let expectedSpendChange = 0;
  let totalConfidence = 0;
  for (const placement of placements) {
    const mb = marginalBenefits[placement];
    if (mb) {
      const delta = (optimized[placement] || 0) - (currentAdjustments[placement] || 0);
      expectedSalesIncrease += mb.marginalSales * delta / 10;
      expectedSpendChange += mb.marginalSpend * delta / 10;
      totalConfidence += mb.confidence;
    }
  }
  const avgConfidence = totalConfidence / placements.length;
  const expectedROASChange = expectedSpendChange > 0 ? (expectedSalesIncrease / expectedSpendChange - 1) * 0.1 : 0;
  return {
    optimizedAdjustments: optimized,
    expectedSalesIncrease,
    expectedSpendChange,
    expectedROASChange,
    confidence: avgConfidence
  };
}
function batchAnalyzeMarginalBenefitsSimple(campaignData) {
  return campaignData.map((campaign) => {
    const marginalBenefits = {};
    for (const [placement, data] of Object.entries(campaign.placements)) {
      marginalBenefits[placement] = calculateMarginalBenefitSimple(
        data.metrics,
        data.currentAdjustment
      );
    }
    const currentAdjustments = {};
    for (const [placement, data] of Object.entries(campaign.placements)) {
      currentAdjustments[placement] = data.currentAdjustment;
    }
    const optimizationResult = optimizeTrafficAllocationSimple(
      // @ts-ignore
      marginalBenefits,
      currentAdjustments,
      "balanced"
    );
    return {
      campaignId: campaign.campaignId,
      marginalBenefits,
      optimizationResult
    };
  });
}
var init_marginalBenefitAnalysisService = __esm({
  "server/optimization/marginalBenefitAnalysisService.ts"() {
    "use strict";
    init_db2();
    init_schema2();
    init_drizzle_orm();
    __name(calculateMarginalBenefit, "calculateMarginalBenefit");
    __name(calculateMarginalMetrics, "calculateMarginalMetrics");
    __name(calculateElasticity, "calculateElasticity");
    __name(findDiminishingPoint, "findDiminishingPoint");
    __name(calculateOptimalRange, "calculateOptimalRange");
    __name(calculateAnalysisConfidence, "calculateAnalysisConfidence");
    __name(createDefaultMarginalBenefitResult, "createDefaultMarginalBenefitResult");
    __name(optimizeTrafficAllocation, "optimizeTrafficAllocation");
    __name(getCurrentPerformance, "getCurrentPerformance");
    __name(runOptimizationAlgorithm, "runOptimizationAlgorithm");
    __name(calculateExpectedResults, "calculateExpectedResults");
    __name(generateAllocationReason, "generateAllocationReason");
    __name(batchAnalyzeMarginalBenefits, "batchAnalyzeMarginalBenefits");
    __name(generateMarginalBenefitReport, "generateMarginalBenefitReport");
    __name(calculateMarginalBenefitSimple, "calculateMarginalBenefitSimple");
    __name(optimizeTrafficAllocationSimple, "optimizeTrafficAllocationSimple");
    __name(batchAnalyzeMarginalBenefitsSimple, "batchAnalyzeMarginalBenefitsSimple");
  }
});

