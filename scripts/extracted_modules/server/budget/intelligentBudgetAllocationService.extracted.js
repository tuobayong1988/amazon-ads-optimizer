// Extracted from production dist/index.js
// Original module: server/budget/intelligentBudgetAllocationService.ts
// Lines: 634

function getDefaultAllocationConfig() {
  return { ...DEFAULT_CONFIG6 };
}
async function collectCampaignPerformanceData(performanceGroupId2, endDate = /* @__PURE__ */ new Date()) {
  const dbInstance = await getDb();
  if (!dbInstance) return [];
  const date7dAgo = new Date(endDate);
  date7dAgo.setDate(date7dAgo.getDate() - 7);
  const date14dAgo = new Date(endDate);
  date14dAgo.setDate(date14dAgo.getDate() - 14);
  const date30dAgo = new Date(endDate);
  date30dAgo.setDate(date30dAgo.getDate() - 30);
  const date90dAgo = new Date(endDate);
  date90dAgo.setDate(date90dAgo.getDate() - 90);
  const campaignList = await dbInstance.select().from(campaigns).where(eq(campaigns.performanceGroupId, performanceGroupId2));
  const results = [];
  for (const campaign of campaignList) {
    const amazonCampaignId = String(campaign.campaignId);
    const [data7d, data14d, data30d] = await Promise.all([
      aggregatePerformanceData(amazonCampaignId, date7dAgo, endDate),
      aggregatePerformanceData(amazonCampaignId, date14dAgo, endDate),
      aggregatePerformanceData(amazonCampaignId, date30dAgo, endDate)
    ]);
    let timeWeightedMetrics;
    try {
      const rawDailyData = await dbInstance.select({
        date: dailyPerformance.date,
        impressions: dailyPerformance.impressions,
        clicks: dailyPerformance.clicks,
        spend: dailyPerformance.spend,
        sales: dailyPerformance.sales,
        orders: dailyPerformance.orders
      }).from(dailyPerformance).where(and(
        // @ts-ignore
        eq(dailyPerformance.campaignId, String(campaign.campaignId)),
        sql`DATE(${dailyPerformance.date}) >= ${date90dAgo.toISOString().split("T")[0]}`,
        sql`DATE(${dailyPerformance.date}) <= ${endDate.toISOString().split("T")[0]}`
      ));
      const dailyDataForWeighting = rawDailyData.map((d) => ({
        // @ts-expect-error - dynamic property access
        date: typeof d.date === "string" ? d.date : new Date(d.date).toISOString(),
        impressions: d.impressions || 0,
        clicks: d.clicks || 0,
        spend: parseFloat(String(d.spend || "0")),
        sales: parseFloat(String(d.sales || "0")),
        orders: d.orders || 0
      }));
      if (dailyDataForWeighting.length > 0) {
        timeWeightedMetrics = calculateTimeWeightedMetrics(dailyDataForWeighting);
        log108.info(`[BudgetAllocation] v163: Campaign ${campaign.id} \u65F6\u95F4\u8870\u51CF\u52A0\u6743 - \u52A0\u6743\u65E5\u5747\u82B1\u8D39=$${timeWeightedMetrics.weightedDailySpend.toFixed(2)}, \u52A0\u6743ROAS=${timeWeightedMetrics.weightedRoas.toFixed(2)}, \u7F6E\u4FE1\u5EA6=${timeWeightedMetrics.dataQuality.confidenceLevel}`);
      }
    } catch (e) {
      log108.info(`[BudgetAllocation] v163: Campaign ${campaign.id} \u65F6\u95F4\u8870\u51CF\u6570\u636E\u83B7\u53D6\u5931\u8D25: ${e.message}`);
    }
    const currentBudget = Number(campaign.dailyBudget) || 0;
    const dailyAvgSpend = timeWeightedMetrics ? timeWeightedMetrics.weightedDailySpend : data30d.spend / 30;
    const budgetUtilization = currentBudget > 0 ? dailyAvgSpend / currentBudget * 100 : 0;
    results.push({
      // @ts-ignore
      campaignId: campaign.id,
      // v354: 本地自增ID，用于本地数据库操作
      // @ts-ignore
      amazonCampaignId: String(campaign.campaignId),
      // v354: Amazon Campaign ID，用于绰效数据查询
      // @ts-ignore
      campaignName: campaign.campaignName,
      currentBudget,
      // 7天数据
      spend7d: data7d.spend,
      sales7d: data7d.sales,
      conversions7d: data7d.conversions,
      clicks7d: data7d.clicks,
      impressions7d: data7d.impressions,
      // 14天数据
      spend14d: data14d.spend,
      sales14d: data14d.sales,
      conversions14d: data14d.conversions,
      clicks14d: data14d.clicks,
      impressions14d: data14d.impressions,
      // 30天数据
      spend30d: data30d.spend,
      sales30d: data30d.sales,
      conversions30d: data30d.conversions,
      clicks30d: data30d.clicks,
      impressions30d: data30d.impressions,
      // 计算指标
      roas7d: data7d.spend > 0 ? data7d.sales / data7d.spend : 0,
      roas14d: data14d.spend > 0 ? data14d.sales / data14d.spend : 0,
      roas30d: data30d.spend > 0 ? data30d.sales / data30d.spend : 0,
      acos7d: data7d.sales > 0 ? data7d.spend / data7d.sales * 100 : 0,
      acos14d: data14d.sales > 0 ? data14d.spend / data14d.sales * 100 : 0,
      acos30d: data30d.sales > 0 ? data30d.spend / data30d.sales * 100 : 0,
      ctr7d: data7d.impressions > 0 ? data7d.clicks / data7d.impressions * 100 : 0,
      cvr7d: data7d.clicks > 0 ? data7d.conversions / data7d.clicks * 100 : 0,
      cpc7d: data7d.clicks > 0 ? data7d.spend / data7d.clicks : 0,
      budgetUtilization,
      dailyAvgSpend,
      dailyAvgSales: timeWeightedMetrics ? timeWeightedMetrics.weightedDailySales : data30d.sales / 30,
      dailyAvgConversions: timeWeightedMetrics ? timeWeightedMetrics.weightedDailyOrders : data30d.conversions / 30,
      // v163: 时间衰减加权指标
      timeWeightedMetrics,
      weightedAcos: timeWeightedMetrics ? timeWeightedMetrics.weightedAcos : data30d.sales > 0 ? data30d.spend / data30d.sales * 100 : 0,
      weightedRoas: timeWeightedMetrics ? timeWeightedMetrics.weightedRoas : data30d.spend > 0 ? data30d.sales / data30d.spend : 0,
      weightedDailySpend: timeWeightedMetrics ? timeWeightedMetrics.weightedDailySpend : data30d.spend / 30,
      weightedDailySales: timeWeightedMetrics ? timeWeightedMetrics.weightedDailySales : data30d.sales / 30,
      weightedDailyOrders: timeWeightedMetrics ? timeWeightedMetrics.weightedDailyOrders : data30d.conversions / 30,
      dataConfidence: timeWeightedMetrics ? timeWeightedMetrics.dataQuality.confidenceLevel : "medium",
      trendDirection: timeWeightedMetrics ? timeWeightedMetrics.trendSignal.direction : "stable"
    });
  }
  return results;
}
async function aggregatePerformanceData(campaignId, startDate, endDate) {
  const dbInstance = await getDb();
  if (!dbInstance) return { spend: 0, sales: 0, conversions: 0, clicks: 0, impressions: 0 };
  const result = await dbInstance.select({
    spend: sql`COALESCE(SUM(${dailyPerformance.spend}), 0)`,
    sales: sql`COALESCE(SUM(${dailyPerformance.sales}), 0)`,
    conversions: sql`COALESCE(SUM(${dailyPerformance.orders}), 0)`,
    clicks: sql`COALESCE(SUM(${dailyPerformance.clicks}), 0)`,
    impressions: sql`COALESCE(SUM(${dailyPerformance.impressions}), 0)`
  }).from(dailyPerformance).where(and(
    eq(dailyPerformance.campaignId, String(campaignId)),
    sql`DATE(${dailyPerformance.date}) >= ${startDate.toISOString().split("T")[0]}`,
    sql`DATE(${dailyPerformance.date}) <= ${endDate.toISOString().split("T")[0]}`
  ));
  return result[0] || { spend: 0, sales: 0, conversions: 0, clicks: 0, impressions: 0 };
}
function calculateMultiDimensionalScore(campaign, groupAverage, config2 = DEFAULT_CONFIG6) {
  const explanations = [];
  const conversionEfficiency = campaign.spend30d > 0 ? campaign.conversions30d / campaign.spend30d : 0;
  const conversionEfficiencyRatio = groupAverage.avgConversionEfficiency > 0 ? conversionEfficiency / groupAverage.avgConversionEfficiency : 1;
  const conversionEfficiencyScore = Math.min(100, Math.max(0, conversionEfficiencyRatio * 50));
  if (conversionEfficiencyRatio > 1.2) {
    explanations.push(`\u8F6C\u5316\u6548\u7387\u9AD8\u4E8E\u7EC4\u5E73\u5747${((conversionEfficiencyRatio - 1) * 100).toFixed(0)}%`);
  } else if (conversionEfficiencyRatio < 0.8) {
    explanations.push(`\u8F6C\u5316\u6548\u7387\u4F4E\u4E8E\u7EC4\u5E73\u5747${((1 - conversionEfficiencyRatio) * 100).toFixed(0)}%`);
  }
  const roasRatio = groupAverage.avgROAS > 0 ? campaign.roas30d / groupAverage.avgROAS : 1;
  const roasScore = Math.min(100, Math.max(0, roasRatio * 50));
  if (roasRatio > 1.2) {
    explanations.push(`ROAS\u9AD8\u4E8E\u7EC4\u5E73\u5747${((roasRatio - 1) * 100).toFixed(0)}%`);
  } else if (roasRatio < 0.8) {
    explanations.push(`ROAS\u4F4E\u4E8E\u7EC4\u5E73\u5747${((1 - roasRatio) * 100).toFixed(0)}%`);
  }
  let growthPotentialScore = 50;
  if (campaign.budgetUtilization > 80 && roasRatio > 1) {
    growthPotentialScore = 80 + (roasRatio - 1) * 20;
    explanations.push("\u9884\u7B97\u5229\u7528\u7387\u9AD8\u4E14\u8868\u73B0\u4F18\u79C0\uFF0C\u589E\u957F\u6F5C\u529B\u5927");
  } else if (campaign.budgetUtilization < 50 && roasRatio < 0.8) {
    growthPotentialScore = 30;
    explanations.push("\u9884\u7B97\u5229\u7528\u7387\u4F4E\u4E14\u8868\u73B0\u6B20\u4F73\uFF0C\u589E\u957F\u6F5C\u529B\u6709\u9650");
  } else if (campaign.budgetUtilization > 90) {
    growthPotentialScore = 70;
    explanations.push("\u9884\u7B97\u63A5\u8FD1\u9971\u548C\uFF0C\u53EF\u80FD\u9700\u8981\u589E\u52A0\u9884\u7B97");
  }
  growthPotentialScore = Math.min(100, Math.max(0, growthPotentialScore));
  const roas7dTo30dRatio = campaign.roas30d > 0 ? campaign.roas7d / campaign.roas30d : 1;
  const roas14dTo30dRatio = campaign.roas30d > 0 ? campaign.roas14d / campaign.roas30d : 1;
  const roasVariance = Math.abs(roas7dTo30dRatio - 1) + Math.abs(roas14dTo30dRatio - 1);
  const stabilityScore = Math.max(0, 100 - roasVariance * 50);
  if (roasVariance < 0.2) {
    explanations.push("\u8868\u73B0\u7A33\u5B9A\uFF0C\u6570\u636E\u6CE2\u52A8\u5C0F");
  } else if (roasVariance > 0.5) {
    explanations.push("\u8868\u73B0\u6CE2\u52A8\u8F83\u5927\uFF0C\u9700\u8981\u5173\u6CE8");
  }
  let trendScore = 50;
  if (campaign.roas7d > campaign.roas30d * 1.1) {
    trendScore = 70 + Math.min(30, (campaign.roas7d / campaign.roas30d - 1) * 100);
    explanations.push("\u8FD1\u671F\u8868\u73B0\u5448\u4E0A\u5347\u8D8B\u52BF");
  } else if (campaign.roas7d < campaign.roas30d * 0.9) {
    trendScore = 30 - Math.min(30, (1 - campaign.roas7d / campaign.roas30d) * 100);
    explanations.push("\u8FD1\u671F\u8868\u73B0\u5448\u4E0B\u964D\u8D8B\u52BF");
  }
  trendScore = Math.min(100, Math.max(0, trendScore));
  const compositeScore = conversionEfficiencyScore * config2.conversionEfficiencyWeight + roasScore * config2.roasWeight + growthPotentialScore * config2.growthPotentialWeight + stabilityScore * config2.stabilityWeight + trendScore * config2.trendWeight;
  return {
    conversionEfficiencyScore,
    roasScore,
    growthPotentialScore,
    stabilityScore,
    trendScore,
    compositeScore,
    scoreExplanation: explanations
  };
}
function analyzeMarginalBenefit(campaign) {
  const currentBudget = campaign.currentBudget;
  const dailyAvgSpend = campaign.dailyAvgSpend;
  const dailyAvgSales = campaign.dailyAvgSales;
  const currentROAS = dailyAvgSpend > 0 ? dailyAvgSales / dailyAvgSpend : 0;
  const budgetEfficiencyCurve = [];
  const baseEfficiency = currentROAS;
  const diminishingFactor = 0.8;
  const budgetSteps = [0.5, 0.7, 0.85, 1, 1.15, 1.3, 1.5, 1.75, 2];
  let previousSales = 0;
  for (const multiplier of budgetSteps) {
    const testBudget = currentBudget * multiplier;
    const logFactor = multiplier > 0 ? Math.log(multiplier) : 0;
    const efficiencyAdjustment = 1 - diminishingFactor * Math.abs(logFactor) * 0.3;
    const expectedSales = baseEfficiency * testBudget * Math.max(0.5, efficiencyAdjustment);
    const marginalROAS = testBudget > previousSales ? (expectedSales - previousSales) / (testBudget - (budgetEfficiencyCurve.length > 0 ? budgetEfficiencyCurve[budgetEfficiencyCurve.length - 1].budget : 0)) : 0;
    budgetEfficiencyCurve.push({
      budget: testBudget,
      expectedSales,
      marginalROAS: Math.max(0, marginalROAS)
    });
    previousSales = expectedSales;
  }
  let diminishingPoint = currentBudget;
  let maxEfficiencyBudget = currentBudget;
  let maxEfficiency = 0;
  for (const point of budgetEfficiencyCurve) {
    const efficiency = point.expectedSales / point.budget;
    if (efficiency > maxEfficiency) {
      maxEfficiency = efficiency;
      maxEfficiencyBudget = point.budget;
    }
    if (point.marginalROAS < currentROAS * 0.7 && point.budget > currentBudget) {
      diminishingPoint = point.budget;
      break;
    }
  }
  let optimalBudget = currentBudget;
  if (campaign.budgetUtilization > 85 && currentROAS > 1.5) {
    optimalBudget = Math.min(currentBudget * 1.15, diminishingPoint);
  } else if (campaign.budgetUtilization < 50 || currentROAS < 0.8) {
    optimalBudget = currentBudget * 0.9;
  }
  return {
    currentBudget,
    optimalBudget,
    marginalROAS: currentROAS,
    diminishingPoint,
    maxEfficiencyBudget,
    budgetEfficiencyCurve
  };
}
function detectAnomalies(campaign, config2 = DEFAULT_CONFIG6) {
  const anomalies = [];
  let hasAnomaly = false;
  let anomalyType = null;
  let severity = null;
  if (campaign.spend30d === 0 && campaign.currentBudget > 0) {
    hasAnomaly = true;
    anomalyType = "missing_data";
    severity = "high";
    anomalies.push("30\u5929\u5185\u65E0\u82B1\u8D39\u6570\u636E\uFF0C\u53EF\u80FD\u5B58\u5728\u6570\u636E\u540C\u6B65\u95EE\u9898");
  }
  if (campaign.spend30d > 0) {
    const dailyAvg30d = campaign.spend30d / 30;
    const dailyAvg7d = campaign.spend7d / 7;
    const spendVariation = Math.abs(dailyAvg7d - dailyAvg30d) / dailyAvg30d;
    if (spendVariation > config2.anomalyThreshold) {
      hasAnomaly = true;
      if (dailyAvg7d > dailyAvg30d) {
        anomalyType = "spike";
        anomalies.push(`\u8FD17\u5929\u65E5\u5747\u82B1\u8D39\u5F02\u5E38\u589E\u52A0${(spendVariation * 100).toFixed(0)}%`);
      } else {
        anomalyType = "drop";
        anomalies.push(`\u8FD17\u5929\u65E5\u5747\u82B1\u8D39\u5F02\u5E38\u4E0B\u964D${(spendVariation * 100).toFixed(0)}%`);
      }
      severity = spendVariation > config2.anomalyThreshold * 2 ? "high" : "medium";
    }
  }
  if (campaign.roas30d > 0) {
    const roasVariation = Math.abs(campaign.roas7d - campaign.roas30d) / campaign.roas30d;
    if (roasVariation > config2.anomalyThreshold) {
      hasAnomaly = true;
      anomalyType = "outlier";
      anomalies.push(`ROAS\u6CE2\u52A8\u5F02\u5E38\uFF1A7\u5929ROAS\u4E3A${campaign.roas7d.toFixed(2)}\uFF0C30\u5929\u5E73\u5747\u4E3A${campaign.roas30d.toFixed(2)}`);
      severity = severity === "high" ? "high" : "medium";
    }
  }
  if (campaign.cvr7d > 50 || campaign.cvr7d < 0.1) {
    hasAnomaly = true;
    anomalyType = "outlier";
    anomalies.push(`\u8F6C\u5316\u7387\u5F02\u5E38\uFF1A${campaign.cvr7d.toFixed(2)}%`);
    severity = "medium";
  }
  let recommendation = "";
  if (hasAnomaly) {
    switch (anomalyType) {
      case "missing_data":
        recommendation = "\u5EFA\u8BAE\u68C0\u67E5\u6570\u636E\u540C\u6B65\u72B6\u6001\uFF0C\u786E\u4FDD\u5E7F\u544A\u6570\u636E\u6B63\u5E38\u66F4\u65B0";
        break;
      case "spike":
        recommendation = "\u5EFA\u8BAE\u6682\u7F13\u9884\u7B97\u8C03\u6574\uFF0C\u89C2\u5BDF\u6570\u636E\u662F\u5426\u6062\u590D\u6B63\u5E38";
        break;
      case "drop":
        recommendation = "\u5EFA\u8BAE\u68C0\u67E5\u5E7F\u544A\u6D3B\u52A8\u72B6\u6001\uFF0C\u786E\u8BA4\u662F\u5426\u6709\u5F02\u5E38\u6682\u505C\u6216\u7ADE\u4E89\u52A0\u5267";
        break;
      case "outlier":
        recommendation = "\u5EFA\u8BAE\u6392\u67E5\u5F02\u5E38\u539F\u56E0\u540E\u518D\u8FDB\u884C\u9884\u7B97\u8C03\u6574";
        break;
    }
  }
  return {
    hasAnomaly,
    anomalyType,
    severity,
    affectedMetrics: anomalies,
    recommendation
  };
}
async function generateBudgetAllocationSuggestions(performanceGroupId2, config2 = DEFAULT_CONFIG6) {
  const campaignData = await collectCampaignPerformanceData(performanceGroupId2);
  if (campaignData.length === 0) {
    return {
      suggestions: [],
      groupSummary: {
        totalCurrentBudget: 0,
        totalSuggestedBudget: 0,
        avgScore: 0,
        // @ts-ignore
        campaignsToIncrease: 0,
        // @ts-ignore
        campaignsToDecrease: 0,
        // @ts-ignore
        campaignsUnchanged: 0
      },
      warnings: ["\u7EE9\u6548\u7EC4\u5185\u6CA1\u6709\u5E7F\u544A\u6D3B\u52A8"]
      // @ts-ignore
    };
  }
  const totalSpend = campaignData.reduce((sum2, c) => sum2 + c.spend30d, 0);
  const totalSales = campaignData.reduce((sum2, c) => sum2 + c.sales30d, 0);
  const totalConversions = campaignData.reduce((sum2, c) => sum2 + c.conversions30d, 0);
  const groupAverage = {
    // @ts-ignore
    avgROAS: totalSpend > 0 ? totalSales / totalSpend : 0,
    // @ts-ignore
    avgConversionEfficiency: totalSpend > 0 ? totalConversions / totalSpend : 0,
    // @ts-ignore
    avgBudgetUtilization: campaignData.reduce((sum2, c) => sum2 + c.budgetUtilization, 0) / campaignData.length
  };
  const suggestions = [];
  const warnings = [];
  for (const campaign of campaignData) {
    const anomalyResult = detectAnomalies(campaign, config2);
    if (anomalyResult.hasAnomaly && anomalyResult.severity === "high") {
      warnings.push(`${campaign.campaignName}: ${anomalyResult.recommendation}`);
    }
    const scores = calculateMultiDimensionalScore(campaign, groupAverage, config2);
    const marginalAnalysis = analyzeMarginalBenefit(campaign);
    let suggestedBudget = campaign.currentBudget;
    const reasons = [];
    const riskFactors = [];
    let riskLevel = "low";
    const scoreDeviation = (scores.compositeScore - 50) / 50;
    let adjustmentPercent = 0;
    if (scores.compositeScore > 65) {
      adjustmentPercent = Math.min(config2.maxAdjustmentPercent, scoreDeviation * 20);
      reasons.push(`\u7EFC\u5408\u5F97\u5206${scores.compositeScore.toFixed(0)}\u5206\uFF0C\u8868\u73B0\u4F18\u4E8E\u5E73\u5747\u6C34\u5E73`);
      reasons.push(...scores.scoreExplanation);
    } else if (scores.compositeScore < 35) {
      adjustmentPercent = Math.max(-config2.maxAdjustmentPercent, scoreDeviation * 20);
      reasons.push(`\u7EFC\u5408\u5F97\u5206${scores.compositeScore.toFixed(0)}\u5206\uFF0C\u8868\u73B0\u4F4E\u4E8E\u5E73\u5747\u6C34\u5E73`);
      reasons.push(...scores.scoreExplanation);
    } else {
      adjustmentPercent = scoreDeviation * 5;
      reasons.push(`\u7EFC\u5408\u5F97\u5206${scores.compositeScore.toFixed(0)}\u5206\uFF0C\u8868\u73B0\u63A5\u8FD1\u5E73\u5747\u6C34\u5E73`);
    }
    if (marginalAnalysis.optimalBudget > campaign.currentBudget * 1.1) {
      adjustmentPercent = Math.min(adjustmentPercent + 5, config2.maxAdjustmentPercent);
      reasons.push("\u8FB9\u9645\u6548\u76CA\u5206\u6790\u663E\u793A\u6709\u589E\u957F\u7A7A\u95F4");
    } else if (marginalAnalysis.optimalBudget < campaign.currentBudget * 0.9) {
      adjustmentPercent = Math.max(adjustmentPercent - 5, -config2.maxAdjustmentPercent);
      reasons.push("\u8FB9\u9645\u6548\u76CA\u5206\u6790\u663E\u793A\u9884\u7B97\u53EF\u80FD\u8FC7\u9AD8");
    }
    suggestedBudget = campaign.currentBudget * (1 + adjustmentPercent / 100);
    suggestedBudget = Math.max(config2.minDailyBudget, suggestedBudget);
    if (anomalyResult.hasAnomaly) {
      riskFactors.push(anomalyResult.recommendation);
      riskLevel = anomalyResult.severity || "low";
    }
    if (Math.abs(adjustmentPercent) > 10) {
      riskFactors.push("\u8C03\u6574\u5E45\u5EA6\u8F83\u5927\uFF0C\u5EFA\u8BAE\u5BC6\u5207\u5173\u6CE8\u6548\u679C");
      riskLevel = riskLevel === "high" ? "high" : "medium";
    }
    if (scores.stabilityScore < 40) {
      riskFactors.push("\u6570\u636E\u6CE2\u52A8\u8F83\u5927\uFF0C\u9884\u6D4B\u51C6\u786E\u6027\u53EF\u80FD\u53D7\u5F71\u54CD");
      riskLevel = riskLevel === "high" ? "high" : "medium";
    }
    const budgetChangeRatio = suggestedBudget / campaign.currentBudget;
    const efficiencyAdjustment = 1 - 0.1 * Math.abs(Math.log(budgetChangeRatio));
    const predictedSpend = suggestedBudget * campaign.budgetUtilization / 100;
    const predictedSales = predictedSpend * campaign.roas30d * efficiencyAdjustment;
    const predictedConversions = campaign.dailyAvgConversions * budgetChangeRatio * efficiencyAdjustment;
    const predictedROAS = predictedSpend > 0 ? predictedSales / predictedSpend : 0;
    let confidence = 70;
    if (scores.stabilityScore > 70) confidence += 15;
    if (scores.stabilityScore < 40) confidence -= 20;
    if (anomalyResult.hasAnomaly) confidence -= 15;
    if (campaign.spend30d < 100) confidence -= 10;
    confidence = Math.min(95, Math.max(30, confidence));
    suggestions.push({
      // @ts-ignore
      campaignId: campaign.campaignId,
      // v354: 本地自增ID (campaigns.id)
      // @ts-ignore
      amazonCampaignId: campaign.amazonCampaignId,
      // v354: Amazon Campaign ID
      // @ts-ignore
      campaignName: campaign.campaignName,
      // @ts-ignore
      currentBudget: campaign.currentBudget,
      suggestedBudget,
      // @ts-ignore
      adjustmentAmount: suggestedBudget - campaign.currentBudget,
      // @ts-ignore
      adjustmentPercent,
      scores,
      marginalAnalysis,
      // @ts-ignore
      predictedSpend,
      predictedSales,
      predictedConversions,
      // @ts-ignore
      predictedROAS,
      riskLevel,
      riskFactors,
      reasons,
      // @ts-ignore
      confidence
    });
  }
  const totalCurrentBudget = suggestions.reduce((sum2, s) => sum2 + s.currentBudget, 0);
  const totalSuggestedBudget = suggestions.reduce((sum2, s) => sum2 + s.suggestedBudget, 0);
  const targetBudget = config2.targetTotalBudget && config2.targetTotalBudget > 0 ? config2.targetTotalBudget : totalCurrentBudget;
  if (config2.targetTotalBudget && config2.targetTotalBudget > 0) {
    const GRADUAL_FACTOR = 0.25;
    const budgetGap = totalCurrentBudget - targetBudget;
    let effectiveTarget;
    if (Math.abs(budgetGap) < totalCurrentBudget * 0.02) {
      effectiveTarget = targetBudget;
    } else if (budgetGap > 0) {
      effectiveTarget = totalCurrentBudget - budgetGap * GRADUAL_FACTOR * 0.65;
    } else {
      effectiveTarget = totalCurrentBudget - budgetGap * GRADUAL_FACTOR;
    }
    const adjustmentRatio = effectiveTarget / totalSuggestedBudget;
    for (const suggestion of suggestions) {
      suggestion.suggestedBudget *= adjustmentRatio;
      suggestion.suggestedBudget = Math.max(config2.minDailyBudget, suggestion.suggestedBudget);
      suggestion.adjustmentAmount = suggestion.suggestedBudget - suggestion.currentBudget;
      suggestion.adjustmentPercent = suggestion.currentBudget > 0 ? suggestion.adjustmentAmount / suggestion.currentBudget * 100 : 0;
    }
    warnings.push(`[v360] \u4F18\u5316\u76EE\u6807\u65E5\u9884\u7B97: $${targetBudget.toFixed(0)}, \u5F53\u524D\u603B\u9884\u7B97: $${totalCurrentBudget.toFixed(0)}, \u672C\u6B21\u8C03\u6574\u76EE\u6807: $${effectiveTarget.toFixed(0)}`);
  } else if (Math.abs(totalSuggestedBudget - totalCurrentBudget) > 1) {
    const adjustmentRatio = totalCurrentBudget / totalSuggestedBudget;
    for (const suggestion of suggestions) {
      suggestion.suggestedBudget *= adjustmentRatio;
      suggestion.adjustmentAmount = suggestion.suggestedBudget - suggestion.currentBudget;
      suggestion.adjustmentPercent = suggestion.adjustmentAmount / suggestion.currentBudget * 100;
    }
  }
  const groupSummary = {
    totalCurrentBudget,
    // @ts-ignore
    totalSuggestedBudget: suggestions.reduce((sum2, s) => sum2 + s.suggestedBudget, 0),
    // @ts-ignore
    avgScore: suggestions.reduce((sum2, s) => sum2 + s.scores.compositeScore, 0) / suggestions.length,
    campaignsToIncrease: suggestions.filter((s) => s.adjustmentAmount > 0.5).length,
    campaignsToDecrease: suggestions.filter((s) => s.adjustmentAmount < -0.5).length,
    campaignsUnchanged: suggestions.filter((s) => Math.abs(s.adjustmentAmount) <= 0.5).length
  };
  return { suggestions, groupSummary, warnings };
}
function simulateBudgetScenario(campaign, newBudget) {
  const budgetChangeRatio = newBudget / campaign.currentBudget;
  const efficiencyAdjustment = budgetChangeRatio <= 1 ? 1 + 0.05 * (1 - budgetChangeRatio) : 1 - 0.1 * Math.log(budgetChangeRatio);
  let predictedUtilization = campaign.budgetUtilization;
  if (budgetChangeRatio > 1) {
    predictedUtilization = Math.max(50, campaign.budgetUtilization - (budgetChangeRatio - 1) * 20);
  } else {
    predictedUtilization = Math.min(100, campaign.budgetUtilization + (1 - budgetChangeRatio) * 30);
  }
  const predictedSpend = newBudget * predictedUtilization / 100;
  const predictedSales = predictedSpend * campaign.roas30d * efficiencyAdjustment;
  const predictedConversions = campaign.dailyAvgConversions * budgetChangeRatio * efficiencyAdjustment;
  const predictedROAS = predictedSpend > 0 ? predictedSales / predictedSpend : 0;
  const predictedACoS = predictedSales > 0 ? predictedSpend / predictedSales * 100 : 0;
  let confidence = 80;
  if (Math.abs(budgetChangeRatio - 1) > 0.3) confidence -= 20;
  if (Math.abs(budgetChangeRatio - 1) > 0.5) confidence -= 20;
  return {
    predictedSpend,
    predictedSales,
    predictedConversions,
    predictedROAS,
    predictedACoS,
    budgetUtilization: predictedUtilization,
    confidence: Math.max(30, confidence)
  };
}
async function applyBudgetAllocationSuggestions(suggestionIds, userId) {
  const dbInstance = await getDb();
  if (!dbInstance) return [];
  const errors = [];
  let appliedCount = 0;
  let failedCount = 0;
  for (const suggestionId of suggestionIds) {
    try {
      const [suggestion] = await dbInstance.select().from(budgetAllocationSuggestions).where(eq(budgetAllocationSuggestions.id, suggestionId));
      if (!suggestion) {
        errors.push(`\u5EFA\u8BAEID ${suggestionId} \u4E0D\u5B58\u5728`);
        failedCount++;
        continue;
      }
      if (suggestion.status !== "pending" && suggestion.status !== "approved") {
        errors.push(`\u5EFA\u8BAEID ${suggestionId} \u72B6\u6001\u4E0D\u5141\u8BB8\u5E94\u7528`);
        failedCount++;
        continue;
      }
      const [campaign] = await dbInstance.select().from(campaigns).where(eq(campaigns.id, Number(suggestion.campaignId)));
      if (!campaign) {
        errors.push(`\u5E7F\u544A\u6D3B\u52A8ID ${suggestion.campaignId} \u4E0D\u5B58\u5728`);
        failedCount++;
        continue;
      }
      await dbInstance.update(campaigns).set({ dailyBudget: suggestion.suggestedBudget?.toString() }).where(eq(campaigns.id, Number(suggestion.campaignId)));
      await dbInstance.insert(budgetAllocationHistory).values({
        configId: suggestion.configId,
        campaignId: suggestion.campaignId,
        previousBudget: suggestion.currentBudget?.toString(),
        newBudget: suggestion.suggestedBudget?.toString(),
        changeReason: suggestion.reason || "auto",
        appliedBy: userId
      });
      await dbInstance.update(budgetAllocationSuggestions).set({
        status: "applied",
        appliedAt: (/* @__PURE__ */ new Date()).toISOString()
      }).where(eq(budgetAllocationSuggestions.id, suggestionId));
      appliedCount++;
    } catch (error48) {
      errors.push(`\u5E94\u7528\u5EFA\u8BAEID ${suggestionId} \u5931\u8D25: ${error48}`);
      failedCount++;
    }
  }
  return {
    success: failedCount === 0,
    appliedCount,
    failedCount,
    errors
  };
}
async function getBudgetAllocationConfig(performanceGroupId2) {
  const dbInstance = await getDb();
  if (!dbInstance) return [];
  const [config2] = await dbInstance.select().from(budgetAllocationConfigs).where(eq(budgetAllocationConfigs.performanceGroupId, performanceGroupId2));
  if (!config2) {
    return DEFAULT_CONFIG6;
  }
  return {
    conversionEfficiencyWeight: Number(config2.conversionEfficiencyWeight) || DEFAULT_CONFIG6.conversionEfficiencyWeight,
    roasWeight: DEFAULT_CONFIG6.roasWeight,
    growthPotentialWeight: Number(config2.growthPotentialWeight) || DEFAULT_CONFIG6.growthPotentialWeight,
    stabilityWeight: DEFAULT_CONFIG6.stabilityWeight,
    trendWeight: DEFAULT_CONFIG6.trendWeight,
    maxAdjustmentPercent: Number(config2.maxAdjustmentPercent) || DEFAULT_CONFIG6.maxAdjustmentPercent,
    minDailyBudget: Number(config2.minDailyBudget) || DEFAULT_CONFIG6.minDailyBudget,
    cooldownDays: config2.cooldownDays || DEFAULT_CONFIG6.cooldownDays,
    newCampaignProtectionDays: config2.newCampaignProtectionDays || DEFAULT_CONFIG6.newCampaignProtectionDays,
    anomalyThreshold: DEFAULT_CONFIG6.anomalyThreshold,
    minDataDays: DEFAULT_CONFIG6.minDataDays
  };
}
async function updateBudgetAllocationConfig(performanceGroupId2, userId, updates) {
  const dbInstance = await getDb();
  if (!dbInstance) return [];
  const [existing] = await dbInstance.select().from(budgetAllocationConfigs).where(eq(budgetAllocationConfigs.performanceGroupId, performanceGroupId2));
  if (existing) {
    await dbInstance.update(budgetAllocationConfigs).set({
      conversionEfficiencyWeight: updates.conversionEfficiencyWeight?.toString(),
      growthPotentialWeight: updates.growthPotentialWeight?.toString(),
      maxAdjustmentPercent: updates.maxAdjustmentPercent?.toString(),
      minDailyBudget: updates.minDailyBudget?.toString(),
      cooldownDays: updates.cooldownDays,
      newCampaignProtectionDays: updates.newCampaignProtectionDays
    }).where(eq(budgetAllocationConfigs.performanceGroupId, performanceGroupId2));
  } else {
    await dbInstance.insert(budgetAllocationConfigs).values({
      accountId: 0,
      // 需要从上下文获取
      performanceGroupId: performanceGroupId2,
      totalDailyBudget: "0",
      conversionEfficiencyWeight: (updates.conversionEfficiencyWeight || DEFAULT_CONFIG6.conversionEfficiencyWeight).toString(),
      growthPotentialWeight: (updates.growthPotentialWeight || DEFAULT_CONFIG6.growthPotentialWeight).toString(),
      maxAdjustmentPercent: (updates.maxAdjustmentPercent || DEFAULT_CONFIG6.maxAdjustmentPercent).toString(),
      minDailyBudget: (updates.minDailyBudget || DEFAULT_CONFIG6.minDailyBudget).toString(),
      cooldownDays: updates.cooldownDays || DEFAULT_CONFIG6.cooldownDays,
      newCampaignProtectionDays: updates.newCampaignProtectionDays || DEFAULT_CONFIG6.newCampaignProtectionDays
    });
  }
}
var log108, DEFAULT_CONFIG6;
var init_intelligentBudgetAllocationService = __esm({
  "server/budget/intelligentBudgetAllocationService.ts"() {
    "use strict";
    init_logger();
    init_db2();
    init_schema2();
    init_drizzle_orm();
    init_timeDecayWeightedDataService();
    log108 = createModuleLogger("IntelligentBudgetAllocationService");
    DEFAULT_CONFIG6 = {
      conversionEfficiencyWeight: 0.25,
      roasWeight: 0.25,
      growthPotentialWeight: 0.2,
      stabilityWeight: 0.15,
      trendWeight: 0.15,
      maxAdjustmentPercent: 15,
      minDailyBudget: 5,
      cooldownDays: 3,
      newCampaignProtectionDays: 7,
      anomalyThreshold: 2.5,
      // 标准差倍数
      minDataDays: 7
    };
    __name(getDefaultAllocationConfig, "getDefaultAllocationConfig");
    __name(collectCampaignPerformanceData, "collectCampaignPerformanceData");
    __name(aggregatePerformanceData, "aggregatePerformanceData");
    __name(calculateMultiDimensionalScore, "calculateMultiDimensionalScore");
    __name(analyzeMarginalBenefit, "analyzeMarginalBenefit");
    __name(detectAnomalies, "detectAnomalies");
    __name(generateBudgetAllocationSuggestions, "generateBudgetAllocationSuggestions");
    __name(simulateBudgetScenario, "simulateBudgetScenario");
    __name(applyBudgetAllocationSuggestions, "applyBudgetAllocationSuggestions");
    __name(getBudgetAllocationConfig, "getBudgetAllocationConfig");
    __name(updateBudgetAllocationConfig, "updateBudgetAllocationConfig");
  }
});

