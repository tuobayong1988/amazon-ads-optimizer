// Extracted from production dist/index.js
// Original module: server/analytics/specialScenarioOptimizationService.ts
// Lines: 799

async function resolveAmazonCampaignId3(localCampaignId) {
  const db = await getDb();
  if (!db) return String(localCampaignId);
  const result = await db.select({ campaignId: campaigns.campaignId }).from(campaigns).where(eq(campaigns.id, localCampaignId)).limit(1);
  return result.length > 0 ? String(result[0].campaignId) : String(localCampaignId);
}
function average(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}
function subDays(date6, days) {
  const result = new Date(date6);
  result.setDate(result.getDate() - days);
  return result;
}
function addDays(date6, days) {
  const result = new Date(date6);
  result.setDate(result.getDate() + days);
  return result;
}
function formatDate(date6) {
  return date6.toISOString().split("T")[0];
}
async function learnCampaignSpendPattern(campaignId, lookbackDays = 30) {
  const db = await getDb();
  if (!db) {
    return {
      // @ts-ignore
      campaignId,
      // @ts-ignore
      weekdayPatterns: Array(7).fill(null).map(
        () => DEFAULT_HOURLY_PATTERN.map((pct, hour2) => ({
          // @ts-ignore
          hour: hour2,
          avgSpendPercent: pct,
          // @ts-ignore
          stdDev: pct * 0.2,
          sampleSize: 0
        }))
      ),
      lastUpdated: /* @__PURE__ */ new Date()
    };
  }
  const startDate = subDays(/* @__PURE__ */ new Date(), lookbackDays);
  const historicalData = await db.select().from(dailyPerformance).where(and(
    eq(dailyPerformance.campaignId, await resolveAmazonCampaignId3(campaignId)),
    // v438: 统一使用Amazon ID
    gte(dailyPerformance.date, formatDate(startDate))
  )).orderBy(dailyPerformance.date);
  const dailySpends = historicalData.map((d) => Number(d.spend) || 0);
  const avgDailySpend = average(dailySpends);
  const weekdaySpends = Array(7).fill(null).map(() => []);
  for (const day2 of historicalData) {
    const weekday = new Date(day2.date).getDay();
    weekdaySpends[weekday].push(Number(day2.spend) || 0);
  }
  const weekdayFactors = weekdaySpends.map((spends) => {
    if (spends.length === 0) return 1;
    return average(spends) / avgDailySpend;
  });
  const weekdayPatterns = weekdayFactors.map((factor, weekday) => {
    return DEFAULT_HOURLY_PATTERN.map((basePct, hour2) => ({
      hour: hour2,
      // @ts-ignore
      avgSpendPercent: basePct * factor,
      // @ts-ignore
      stdDev: basePct * factor * 0.2,
      // @ts-ignore
      sampleSize: weekdaySpends[weekday].length
    }));
  });
  return {
    campaignId,
    weekdayPatterns,
    lastUpdated: /* @__PURE__ */ new Date()
  };
}
async function predictBudgetDepletion(campaignId, currentSpend, dailyBudget, currentHour = (/* @__PURE__ */ new Date()).getHours()) {
  const db = await getDb();
  let campaignName = `Campaign ${campaignId}`;
  if (db) {
    const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
    if (campaign) {
      campaignName = campaign.campaignName;
    }
  }
  const spendModel = await learnCampaignSpendPattern(campaignId);
  const remainingBudget = dailyBudget - currentSpend;
  const weekday = (/* @__PURE__ */ new Date()).getDay();
  const patterns = spendModel.weekdayPatterns[weekday];
  if (remainingBudget <= 0) {
    return {
      campaignId,
      campaignName,
      dailyBudget,
      currentSpend,
      currentHour,
      predictedDepletionHour: currentHour,
      confidenceLow: currentHour,
      confidenceHigh: currentHour,
      riskLevel: "critical",
      recommendation: "\u9884\u7B97\u5DF2\u8017\u5C3D\u3002\u5EFA\u8BAE\u7ACB\u5373\u589E\u52A0\u9884\u7B97\u6216\u6682\u505C\u4F4E\u6548\u5173\u952E\u8BCD\u4EE5\u63A7\u5236\u6210\u672C\u3002"
    };
  }
  let cumulativeExpectedSpend = 0;
  let predictedDepletionHour = null;
  const remainingHoursPattern = patterns.slice(currentHour + 1);
  const totalRemainingPercent = remainingHoursPattern.reduce((sum2, p) => sum2 + p.avgSpendPercent, 0);
  for (let h = currentHour + 1; h < 24; h++) {
    const hourPattern = patterns[h];
    const normalizedPercent = totalRemainingPercent > 0 ? hourPattern.avgSpendPercent / totalRemainingPercent : 1 / (24 - currentHour - 1);
    const expectedHourlySpend = remainingBudget * normalizedPercent;
    cumulativeExpectedSpend += expectedHourlySpend;
    if (cumulativeExpectedSpend >= remainingBudget && predictedDepletionHour === null) {
      predictedDepletionHour = h;
    }
  }
  const avgStdDev = average(remainingHoursPattern.map((p) => p.stdDev));
  const confidenceLow = predictedDepletionHour !== null ? Math.max(currentHour + 1, predictedDepletionHour - Math.ceil(avgStdDev)) : null;
  const confidenceHigh = predictedDepletionHour !== null ? Math.min(23, predictedDepletionHour + Math.ceil(avgStdDev)) : null;
  let riskLevel = "safe";
  let recommendation = "";
  if (predictedDepletionHour !== null) {
    if (predictedDepletionHour < 15) {
      riskLevel = "critical";
      recommendation = `\u9884\u7B97\u9884\u8BA1\u5728${predictedDepletionHour}:00\u8017\u5C3D\uFF0C\u8FDC\u65E9\u4E8E\u8425\u4E1A\u9AD8\u5CF0\u671F\u7ED3\u675F\u3002\u5EFA\u8BAE\u7ACB\u5373\u589E\u52A0\u9884\u7B97${Math.ceil(dailyBudget * 0.5)}\u6216\u964D\u4F4E\u9AD8\u6D88\u8017\u5173\u952E\u8BCD\u51FA\u4EF7\u3002`;
    } else if (predictedDepletionHour < 20) {
      riskLevel = "warning";
      recommendation = `\u9884\u7B97\u9884\u8BA1\u5728${predictedDepletionHour}:00\u8017\u5C3D\uFF0C\u53EF\u80FD\u9519\u8FC7\u665A\u95F4\u6D41\u91CF\u9AD8\u5CF0\u3002\u5EFA\u8BAE\u589E\u52A0\u9884\u7B97\u6216\u4F18\u5316\u51FA\u4EF7\u7B56\u7565\u3002`;
    } else {
      riskLevel = "safe";
      recommendation = `\u9884\u7B97\u6D88\u8017\u6B63\u5E38\uFF0C\u9884\u8BA1\u5728${predictedDepletionHour}:00\u5DE6\u53F3\u8017\u5C3D\uFF0C\u8986\u76D6\u5927\u90E8\u5206\u8425\u4E1A\u65F6\u95F4\u3002`;
    }
  } else {
    recommendation = "\u9884\u7B97\u5145\u8DB3\uFF0C\u9884\u8BA1\u4ECA\u65E5\u4E0D\u4F1A\u8017\u5C3D\u3002\u53EF\u8003\u8651\u9002\u5F53\u63D0\u9AD8\u51FA\u4EF7\u4EE5\u83B7\u53D6\u66F4\u591A\u6D41\u91CF\u3002";
  }
  const optimalAnalysis = await calculateOptimalDepletionTime(campaignId);
  return {
    campaignId,
    campaignName,
    dailyBudget,
    currentSpend,
    currentHour,
    predictedDepletionHour,
    confidenceLow,
    confidenceHigh,
    riskLevel,
    recommendation,
    optimalDepletionHour: optimalAnalysis?.optimalHour,
    optimalDepletionReason: optimalAnalysis?.reason
  };
}
async function calculateOptimalDepletionTime(campaignId) {
  return {
    optimalHour: 22,
    reason: "\u57FA\u4E8E\u884C\u4E1A\u6700\u4F73\u5B9E\u8DF5\uFF0C\u5EFA\u8BAE\u9884\u7B97\u572822:00\u5DE6\u53F3\u8017\u5C3D\uFF0C\u4EE5\u8986\u76D6\u5168\u5929\u4E3B\u8981\u6D41\u91CF\u65F6\u6BB5\u3002"
  };
}
async function analyzeBudgetDepletionRisk(accountId) {
  const db = await getDb();
  if (!db) return [];
  const activeCampaigns = await db.select().from(campaigns).where(and(
    eq(campaigns.accountId, accountId),
    eq(campaigns.campaignStatus, "enabled")
  ));
  const currentHour = (/* @__PURE__ */ new Date()).getHours();
  const today = formatDate(/* @__PURE__ */ new Date());
  const predictions = [];
  for (const campaign of activeCampaigns) {
    const [todayPerf] = await db.select().from(dailyPerformance).where(and(
      // @ts-ignore
      eq(dailyPerformance.campaignId, String(campaign.campaignId)),
      sql`DATE(${dailyPerformance.date}) = ${today}`
    )).limit(1);
    const currentSpend = todayPerf ? Number(todayPerf.spend) : 0;
    const dailyBudget = Number(campaign.dailyBudget) || Number(campaign.maxBid) * 100 || 100;
    const prediction = await predictBudgetDepletion(
      // @ts-ignore
      campaign.id,
      currentSpend,
      dailyBudget,
      currentHour
    );
    predictions.push(prediction);
  }
  const riskOrder = { critical: 0, warning: 1, safe: 2 };
  predictions.sort((a, b) => riskOrder[a.riskLevel] - riskOrder[b.riskLevel]);
  return predictions;
}
async function getAttributionModel(accountId) {
  return {
    ...DEFAULT_ATTRIBUTION_MODEL,
    accountId
  };
}
function adjustForAttributionDelay(rawMetrics, dataDate, model, campaignType = "sp_manual") {
  const now = /* @__PURE__ */ new Date();
  const dataAge = Math.floor((now.getTime() - dataDate.getTime()) / (1e3 * 60 * 60 * 24));
  let completionRate = 1;
  if (dataAge >= 1 && dataAge <= 7) {
    const key = `day${dataAge}`;
    completionRate = model.completionRates[key] || 1;
  } else if (dataAge < 1) {
    completionRate = model.completionRates.day1 * 0.7;
  }
  const typeFactor = model.campaignTypeFactors[campaignType] || 1;
  completionRate *= typeFactor;
  completionRate = Math.max(0.5, Math.min(1, completionRate));
  const adjustmentFactor = 1 / completionRate;
  const adjustedSales = rawMetrics.sales * adjustmentFactor;
  const adjustedOrders = Math.round(rawMetrics.orders * adjustmentFactor);
  const ctr = rawMetrics.impressions > 0 ? rawMetrics.clicks / rawMetrics.impressions : 0;
  const cvr = rawMetrics.clicks > 0 ? adjustedOrders / rawMetrics.clicks : 0;
  const adjustedAcos = adjustedSales > 0 ? rawMetrics.spend / adjustedSales * 100 : 0;
  const adjustedRoas = rawMetrics.spend > 0 ? adjustedSales / rawMetrics.spend : 0;
  let confidence = "high";
  if (dataAge <= 2) {
    confidence = "low";
  } else if (dataAge <= 4) {
    confidence = "medium";
  }
  return {
    impressions: rawMetrics.impressions,
    clicks: rawMetrics.clicks,
    spend: rawMetrics.spend,
    sales: adjustedSales,
    orders: adjustedOrders,
    acos: adjustedAcos,
    roas: adjustedRoas,
    ctr,
    cvr,
    isAdjusted: dataAge < 7,
    adjustmentFactor,
    completionRate,
    confidence,
    dataAge
  };
}
async function adjustRecentPerformanceData(accountId, days = 7) {
  const db = await getDb();
  if (!db) return [];
  const model = await getAttributionModel(accountId);
  const endDate = /* @__PURE__ */ new Date();
  const startDate = subDays(endDate, days - 1);
  const startDateStr = formatDate(startDate);
  const endDateStr = formatDate(endDate);
  const allDayData = await db.select({
    date: sql`DATE(${dailyPerformance.date})`.as("perf_date"),
    impressions: sql`COALESCE(SUM(${dailyPerformance.impressions}), 0)`,
    clicks: sql`COALESCE(SUM(${dailyPerformance.clicks}), 0)`,
    spend: sql`COALESCE(SUM(${dailyPerformance.spend}), 0)`,
    sales: sql`COALESCE(SUM(${dailyPerformance.sales}), 0)`,
    orders: sql`COALESCE(SUM(${dailyPerformance.orders}), 0)`
  }).from(dailyPerformance).where(and(
    eq(dailyPerformance.accountId, accountId),
    sql`DATE(${dailyPerformance.date}) >= ${startDateStr}`,
    sql`DATE(${dailyPerformance.date}) <= ${endDateStr}`
  )).groupBy(sql`DATE(${dailyPerformance.date})`).orderBy(sql`DATE(${dailyPerformance.date}) DESC`);
  const dayDataMap = /* @__PURE__ */ new Map();
  for (const row of allDayData) {
    if (row.date) {
      const dateKey = typeof row.date === "string" ? row.date.split("T")[0] : String(row.date);
      dayDataMap.set(dateKey, row);
    }
  }
  const results = [];
  for (let i = 0; i < days; i++) {
    const date6 = subDays(/* @__PURE__ */ new Date(), i);
    const dateStr = formatDate(date6);
    const dayData = dayDataMap.get(dateStr);
    if (dayData) {
      const raw = {
        impressions: Number(dayData.impressions) || 0,
        clicks: Number(dayData.clicks) || 0,
        spend: Number(dayData.spend) || 0,
        sales: Number(dayData.sales) || 0,
        orders: Number(dayData.orders) || 0
      };
      const rawAcos = raw.sales > 0 ? raw.spend / raw.sales * 100 : 0;
      const rawRoas = raw.spend > 0 ? raw.sales / raw.spend : 0;
      const adjusted = adjustForAttributionDelay(raw, date6, model);
      results.push({
        date: dateStr,
        raw: {
          spend: raw.spend,
          sales: raw.sales,
          acos: rawAcos,
          roas: rawRoas
        },
        adjusted
      });
    }
  }
  return results;
}
function calculateTargetCpc(targetAcos, cvr, avgOrderValue, profitMargin) {
  const targetCpc = targetAcos * cvr * avgOrderValue;
  const breakEvenCpc = profitMargin ? profitMargin * cvr * avgOrderValue : targetCpc * 1.5;
  const maxCpc = breakEvenCpc;
  return { targetCpc, breakEvenCpc, maxCpc };
}
function detectOverbidding(target, targetAcos, profitMargin) {
  const { bid, clicks, spend, sales, orders } = target;
  const cpc = clicks > 0 ? spend / clicks : 0;
  const cvr = clicks > 0 ? orders / clicks : 0;
  const avgOrderValue = orders > 0 ? sales / orders : 0;
  const actualAcos = sales > 0 ? spend / sales * 100 : 0;
  const { targetCpc, breakEvenCpc } = calculateTargetCpc(
    targetAcos,
    cvr,
    avgOrderValue,
    profitMargin
  );
  const bidToCpcRatio = cpc > 0 ? bid / cpc : 0;
  const cpcToTargetRatio = targetCpc > 0 ? cpc / targetCpc : 0;
  const acosToTargetRatio = targetAcos > 0 ? actualAcos / (targetAcos * 100) : 0;
  const overbiddingReasons = [];
  let overbiddingScore = 0;
  if (bidToCpcRatio > 2 && clicks >= 5) {
    overbiddingReasons.push(`\u51FA\u4EF7\u662F\u5B9E\u9645CPC\u7684${bidToCpcRatio.toFixed(1)}\u500D`);
    overbiddingScore += 30;
  }
  if (cpcToTargetRatio > 1.2 && clicks >= 5) {
    overbiddingReasons.push(`\u5B9E\u9645CPC\u8D85\u51FA\u76EE\u6807${((cpcToTargetRatio - 1) * 100).toFixed(0)}%`);
    overbiddingScore += 40;
  }
  if (acosToTargetRatio > 1.5 && sales > 0) {
    overbiddingReasons.push(`ACoS\u8D85\u51FA\u76EE\u6807${((acosToTargetRatio - 1) * 100).toFixed(0)}%`);
    overbiddingScore += 30;
  }
  let suggestedBid = bid;
  if (overbiddingScore >= 50) {
    suggestedBid = Math.min(
      targetCpc > 0 ? targetCpc * 1.5 : bid,
      breakEvenCpc > 0 ? breakEvenCpc : bid,
      cpc > 0 ? cpc * 1.2 : bid
    );
    suggestedBid = Math.max(suggestedBid, 0.02);
  }
  const expectedSavings = clicks > 0 ? clicks * Math.max(0, bid - suggestedBid) : 0;
  const efficiencyScore = Math.max(0, 100 - overbiddingScore);
  return {
    targetId: target.id,
    targetType: target.type,
    targetText: target.text,
    matchType: target.matchType,
    currentBid: bid,
    actualCpc: cpc,
    targetCpc,
    breakEvenCpc,
    bidToCpcRatio,
    efficiencyScore,
    isOverbidding: overbiddingScore >= 50,
    overbiddingScore,
    overbiddingReasons,
    suggestedBid,
    expectedSavings
  };
}
async function analyzeBidEfficiency(accountId, targetAcos = 0.25, profitMargin = 0.3, minClicks = 10) {
  const db = await getDb();
  if (!db) {
    return {
      accountId,
      analysisDate: /* @__PURE__ */ new Date(),
      totalTargets: 0,
      overbiddingCount: 0,
      overbiddingPercent: 0,
      totalPotentialSavings: 0,
      avgEfficiencyScore: 0,
      topOverbidding: [],
      recommendations: []
    };
  }
  const adGroupList = await db.select().from(adGroups).innerJoin(campaigns, eq(adGroups.campaignId, campaigns.campaignId)).where(eq(campaigns.accountId, accountId));
  const adGroupIds = adGroupList.map((ag) => ag.ad_groups.id);
  if (adGroupIds.length === 0) {
    return {
      accountId,
      analysisDate: /* @__PURE__ */ new Date(),
      totalTargets: 0,
      overbiddingCount: 0,
      overbiddingPercent: 0,
      totalPotentialSavings: 0,
      avgEfficiencyScore: 0,
      topOverbidding: [],
      recommendations: []
    };
  }
  const keywordData = await db.select().from(keywords).where(sql`${keywords.internalAdGroupId} IN (${sql.join(adGroupIds.map((id) => sql`${id}`), sql`, `)})`);
  const targetData = await db.select().from(productTargets).where(sql`${productTargets.internalAdGroupId} IN (${sql.join(adGroupIds.map((id) => sql`${id}`), sql`, `)})`);
  const analyses = [];
  let totalPotentialSavings = 0;
  let overbiddingCount = 0;
  for (const kw of keywordData) {
    const clicks = Number(kw.clicks) || 0;
    if (clicks < minClicks) continue;
    const analysis = detectOverbidding({
      // @ts-ignore
      id: kw.id,
      type: "keyword",
      // @ts-ignore
      text: kw.keywordText,
      // @ts-ignore
      matchType: kw.matchType,
      // @ts-ignore
      bid: Number(kw.bid) || 0,
      // @ts-ignore
      impressions: Number(kw.impressions) || 0,
      clicks,
      // @ts-ignore
      spend: Number(kw.spend) || 0,
      // @ts-ignore
      sales: Number(kw.sales) || 0,
      // @ts-ignore
      orders: Number(kw.orders) || 0
    }, targetAcos, profitMargin);
    analyses.push(analysis);
    if (analysis.isOverbidding) {
      overbiddingCount++;
      totalPotentialSavings += analysis.expectedSavings;
    }
  }
  for (const pt of targetData) {
    const clicks = Number(pt.clicks) || 0;
    if (clicks < minClicks) continue;
    const analysis = detectOverbidding({
      id: pt.id,
      type: "product_target",
      text: pt.targetValue,
      bid: Number(pt.bid) || 0,
      impressions: Number(pt.impressions) || 0,
      clicks,
      spend: Number(pt.spend) || 0,
      sales: Number(pt.sales) || 0,
      orders: Number(pt.orders) || 0
    }, targetAcos, profitMargin);
    analyses.push(analysis);
    if (analysis.isOverbidding) {
      overbiddingCount++;
      totalPotentialSavings += analysis.expectedSavings;
    }
  }
  analyses.sort((a, b) => b.overbiddingScore - a.overbiddingScore);
  const avgEfficiencyScore = analyses.length > 0 ? average(analyses.map((a) => a.efficiencyScore)) : 100;
  const recommendations = [];
  if (overbiddingCount > 0) {
    recommendations.push(`\u53D1\u73B0${overbiddingCount}\u4E2A\u6295\u653E\u8BCD\u5B58\u5728\u8FC7\u5EA6\u7ADE\u4EF7\u95EE\u9898\uFF0C\u9884\u8BA1\u53EF\u8282\u7701$${totalPotentialSavings.toFixed(2)}\u3002`);
  }
  if (avgEfficiencyScore < 70) {
    recommendations.push("\u6574\u4F53\u7ADE\u4EF7\u6548\u7387\u504F\u4F4E\uFF0C\u5EFA\u8BAE\u5168\u9762\u5BA1\u67E5\u51FA\u4EF7\u7B56\u7565\u3002");
  }
  if (analyses.filter((a) => a.bidToCpcRatio > 3).length > 5) {
    recommendations.push("\u591A\u4E2A\u6295\u653E\u8BCD\u7684\u51FA\u4EF7\u8FDC\u9AD8\u4E8E\u5B9E\u9645CPC\uFF0C\u5EFA\u8BAE\u964D\u4F4E\u8FD9\u4E9B\u6295\u653E\u8BCD\u7684\u51FA\u4EF7\u3002");
  }
  return {
    accountId,
    analysisDate: /* @__PURE__ */ new Date(),
    totalTargets: analyses.length,
    overbiddingCount,
    overbiddingPercent: analyses.length > 0 ? overbiddingCount / analyses.length * 100 : 0,
    totalPotentialSavings,
    avgEfficiencyScore,
    topOverbidding: analyses.slice(0, 20),
    recommendations
  };
}
async function learnSeasonalPatterns(accountId, metric = "sales") {
  const db = await getDb();
  const defaultPattern = {
    accountId,
    weekdayFactors: [0.85, 1.05, 1.1, 1.1, 1.15, 1, 0.75],
    // 周日到周六
    monthdayFactors: Array(31).fill(1),
    monthlyFactors: [0.9, 0.85, 0.95, 1, 1.05, 1, 1.1, 0.95, 1, 1.05, 1.2, 1.3],
    // 1-12月
    confidence: 0.5,
    lastUpdated: /* @__PURE__ */ new Date()
  };
  if (!db) return defaultPattern;
  const startDate = subDays(/* @__PURE__ */ new Date(), 365);
  const historicalData = await db.select().from(dailyPerformance).where(and(
    eq(dailyPerformance.accountId, accountId),
    gte(dailyPerformance.date, formatDate(startDate))
  )).orderBy(dailyPerformance.date);
  if (historicalData.length < 30) {
    return defaultPattern;
  }
  const weekdayData = Array(7).fill(null).map(() => []);
  for (const day2 of historicalData) {
    const weekday = new Date(day2.date).getDay();
    const value = Number(day2[metric]) || 0;
    if (value > 0) weekdayData[weekday].push(value);
  }
  const weekdayAvg = weekdayData.map((arr) => arr.length > 0 ? average(arr) : 0);
  const weekdayOverall = average(weekdayAvg.filter((v) => v > 0));
  const weekdayFactors = weekdayAvg.map((v) => v > 0 ? v / weekdayOverall : 1);
  const monthdayData = Array(31).fill(null).map(() => []);
  for (const day2 of historicalData) {
    const monthday = new Date(day2.date).getDate() - 1;
    const value = Number(day2[metric]) || 0;
    if (value > 0) monthdayData[monthday].push(value);
  }
  const monthdayAvg = monthdayData.map((arr) => arr.length > 0 ? average(arr) : 0);
  const monthdayOverall = average(monthdayAvg.filter((v) => v > 0));
  const monthdayFactors = monthdayAvg.map((v) => v > 0 ? v / monthdayOverall : 1);
  const monthlyData = Array(12).fill(null).map(() => []);
  for (const day2 of historicalData) {
    const month = new Date(day2.date).getMonth();
    const value = Number(day2[metric]) || 0;
    if (value > 0) monthlyData[month].push(value);
  }
  const monthlyAvg = monthlyData.map((arr) => arr.length > 0 ? average(arr) : 0);
  const monthlyOverall = average(monthlyAvg.filter((v) => v > 0));
  const monthlyFactors = monthlyAvg.map((v) => v > 0 ? v / monthlyOverall : 1);
  const confidence = Math.min(1, historicalData.length / 365);
  return {
    accountId,
    weekdayFactors,
    monthdayFactors,
    monthlyFactors,
    confidence,
    lastUpdated: /* @__PURE__ */ new Date()
  };
}
function getUpcomingEvent(targetDate, daysAhead = 14) {
  for (const event of PROMOTIONAL_EVENTS_2026) {
    const daysUntil = Math.floor((event.date.getTime() - targetDate.getTime()) / (1e3 * 60 * 60 * 24));
    if (daysUntil >= -event.duration && daysUntil <= daysAhead) {
      return { event, daysUntil };
    }
  }
  return null;
}
async function generateSeasonalStrategy(accountId, targetDate = /* @__PURE__ */ new Date()) {
  const pattern = await learnSeasonalPatterns(accountId);
  const weekday = targetDate.getDay();
  const monthday = targetDate.getDate() - 1;
  const month = targetDate.getMonth();
  const baseFactor = pattern.weekdayFactors[weekday] * 0.4 + pattern.monthdayFactors[monthday] * 0.2 + pattern.monthlyFactors[month] * 0.4;
  const upcomingEvent = getUpcomingEvent(targetDate);
  let eventFactor = 1;
  let eventName;
  if (upcomingEvent) {
    eventName = upcomingEvent.event.name;
    const { daysUntil } = upcomingEvent;
    if (daysUntil === 0) {
      eventFactor = 2;
    } else if (daysUntil > 0 && daysUntil <= 7) {
      eventFactor = 1 + (7 - daysUntil) * 0.15;
    } else if (daysUntil < 0 && daysUntil >= -3) {
      eventFactor = 1 + (3 + daysUntil) * 0.2;
    }
  }
  const finalFactor = baseFactor * eventFactor;
  const budgetMultiplier = Math.max(0.5, Math.min(2.5, finalFactor));
  const bidMultiplier = Math.max(0.8, Math.min(1.5, Math.sqrt(finalFactor)));
  const acosToleranceMultiplier = finalFactor > 1.2 ? 1.2 : 1;
  let explanation = "";
  if (eventName) {
    explanation = `${eventName}\u671F\u95F4\uFF0C\u5EFA\u8BAE\u9884\u7B97\u63D0\u5347${((budgetMultiplier - 1) * 100).toFixed(0)}%\uFF0C\u51FA\u4EF7\u63D0\u5347${((bidMultiplier - 1) * 100).toFixed(0)}%\u3002`;
  } else if (baseFactor > 1.1) {
    explanation = `\u5F53\u524D\u5904\u4E8E\u9500\u552E\u65FA\u5B63\uFF08\u5468${weekday === 0 ? "\u65E5" : weekday}\uFF0C${month + 1}\u6708\uFF09\uFF0C\u5EFA\u8BAE\u9002\u5F53\u589E\u52A0\u6295\u653E\u529B\u5EA6\u3002`;
  } else if (baseFactor < 0.9) {
    explanation = `\u5F53\u524D\u5904\u4E8E\u9500\u552E\u6DE1\u5B63\uFF0C\u5EFA\u8BAE\u63A7\u5236\u9884\u7B97\uFF0C\u63D0\u9AD8\u6295\u653E\u6548\u7387\u3002`;
  } else {
    explanation = "\u5F53\u524D\u5904\u4E8E\u6B63\u5E38\u9500\u552E\u671F\uFF0C\u5EFA\u8BAE\u7EF4\u6301\u5E38\u89C4\u6295\u653E\u7B56\u7565\u3002";
  }
  return {
    date: targetDate,
    baseFactor,
    eventName,
    eventFactor: eventName ? eventFactor : void 0,
    finalFactor,
    budgetMultiplier,
    bidMultiplier,
    acosToleranceMultiplier,
    explanation,
    confidence: pattern.confidence
  };
}
function generateEventTransitionPlan(eventName, eventDate, baseBudget, baseBid) {
  const plan = [];
  for (let i = 7; i >= 1; i--) {
    const date6 = subDays(eventDate, i);
    const factor = 1 + (7 - i) * 0.15;
    plan.push({
      date: date6,
      phase: "pre_event",
      daysFromEvent: -i,
      budgetMultiplier: factor,
      bidMultiplier: Math.sqrt(factor),
      recommendedBudget: baseBudget * factor,
      recommendedBid: baseBid * Math.sqrt(factor),
      explanation: `${eventName}\u524D${i}\u5929\uFF0C\u5EFA\u8BAE\u9884\u7B97\u63D0\u5347${((factor - 1) * 100).toFixed(0)}%`
    });
  }
  const eventDayFactor = 2;
  plan.push({
    date: eventDate,
    phase: "event_day",
    daysFromEvent: 0,
    budgetMultiplier: eventDayFactor,
    bidMultiplier: Math.sqrt(eventDayFactor),
    recommendedBudget: baseBudget * eventDayFactor,
    // @ts-ignore
    recommendedBid: baseBid * Math.sqrt(eventDayFactor),
    explanation: `${eventName}\u5F53\u5929\uFF0C\u5EFA\u8BAE\u9884\u7B97\u63D0\u5347${((eventDayFactor - 1) * 100).toFixed(0)}%`
  });
  for (let i = 1; i <= 3; i++) {
    const date6 = addDays(eventDate, i);
    const factor = 1 + (3 - i) * 0.2;
    plan.push({
      date: date6,
      // @ts-ignore
      phase: "post_event",
      daysFromEvent: i,
      budgetMultiplier: factor,
      bidMultiplier: Math.sqrt(factor),
      recommendedBudget: baseBudget * factor,
      recommendedBid: baseBid * Math.sqrt(factor),
      explanation: `${eventName}\u540E${i}\u5929\uFF0C\u5EFA\u8BAE\u9884\u7B97\u7EF4\u6301\u63D0\u5347${((factor - 1) * 100).toFixed(0)}%`
    });
  }
  const estimatedAdditionalSpend = plan.reduce((sum2, day2) => {
    return sum2 + (day2.recommendedBudget - baseBudget);
  }, 0);
  const estimatedAdditionalSales = estimatedAdditionalSpend * 3.5;
  return {
    // @ts-ignore
    eventName,
    eventDate,
    totalDays: plan.length,
    dailyAdjustments: plan,
    // @ts-ignore
    estimatedAdditionalSpend,
    estimatedAdditionalSales
  };
}
function getUpcomingPromotionalEvents(daysAhead = 30) {
  const today = /* @__PURE__ */ new Date();
  const events = [];
  for (const event of PROMOTIONAL_EVENTS_2026) {
    const daysUntil = Math.floor((event.date.getTime() - today.getTime()) / (1e3 * 60 * 60 * 24));
    if (daysUntil >= 0 && daysUntil <= daysAhead) {
      events.push({ event, daysUntil });
    }
  }
  return events.sort((a, b) => a.daysUntil - b.daysUntil);
}
async function runSpecialScenarioAnalysis(accountId, options = {}) {
  const { targetAcos = 0.25, profitMargin = 0.3, minClicks = 10 } = options;
  const [
    budgetDepletion,
    attributionAdjustment,
    bidEfficiency,
    seasonalStrategy
  ] = await Promise.all([
    analyzeBudgetDepletionRisk(accountId),
    adjustRecentPerformanceData(accountId, 7),
    analyzeBidEfficiency(accountId, targetAcos, profitMargin, minClicks),
    generateSeasonalStrategy(accountId)
  ]);
  const upcomingEvents = getUpcomingPromotionalEvents(30);
  const criticalIssues = [];
  const recommendations = [];
  let potentialSavings = 0;
  let potentialRevenueGain = 0;
  const criticalBudgetCampaigns = budgetDepletion.filter((p) => p.riskLevel === "critical");
  if (criticalBudgetCampaigns.length > 0) {
    criticalIssues.push(`${criticalBudgetCampaigns.length}\u4E2A\u5E7F\u544A\u6D3B\u52A8\u9884\u7B97\u5373\u5C06\u8FC7\u65E9\u8017\u5C3D`);
    recommendations.push("\u5EFA\u8BAE\u7ACB\u5373\u68C0\u67E5\u5E76\u589E\u52A0\u9AD8\u98CE\u9669\u5E7F\u544A\u6D3B\u52A8\u7684\u9884\u7B97");
  }
  const recentAdjusted = attributionAdjustment.filter((a) => a.adjusted.dataAge <= 3);
  if (recentAdjusted.length > 0) {
    const avgAdjustment = average(recentAdjusted.map((a) => a.adjusted.adjustmentFactor));
    if (avgAdjustment > 1.2) {
      recommendations.push(`\u8FD1\u671F\u6570\u636E\u5F52\u56E0\u5C1A\u672A\u5B8C\u6210\uFF0C\u5B9E\u9645\u9500\u552E\u989D\u53EF\u80FD\u6BD4\u663E\u793A\u9AD8${((avgAdjustment - 1) * 100).toFixed(0)}%`);
    }
  }
  if (bidEfficiency.overbiddingCount > 0) {
    criticalIssues.push(`${bidEfficiency.overbiddingCount}\u4E2A\u6295\u653E\u8BCD\u5B58\u5728\u8FC7\u5EA6\u7ADE\u4EF7\u95EE\u9898`);
    potentialSavings += bidEfficiency.totalPotentialSavings;
    recommendations.push(...bidEfficiency.recommendations);
  }
  if (seasonalStrategy.eventName) {
    recommendations.push(seasonalStrategy.explanation);
    potentialRevenueGain += seasonalStrategy.budgetMultiplier > 1 ? (seasonalStrategy.budgetMultiplier - 1) * 1e3 : 0;
  }
  if (upcomingEvents.length > 0) {
    const nearestEvent = upcomingEvents[0];
    if (nearestEvent.daysUntil <= 7) {
      criticalIssues.push(`${nearestEvent.event.name}\u5373\u5C06\u5728${nearestEvent.daysUntil}\u5929\u540E\u5230\u6765`);
      recommendations.push(`\u5EFA\u8BAE\u7ACB\u5373\u51C6\u5907${nearestEvent.event.name}\u7684\u9884\u7B97\u548C\u51FA\u4EF7\u8C03\u6574\u8BA1\u5212`);
    }
  }
  return {
    budgetDepletion,
    attributionAdjustment,
    bidEfficiency,
    seasonalStrategy,
    upcomingEvents,
    summary: {
      criticalIssues,
      recommendations,
      potentialSavings,
      potentialRevenueGain
    }
  };
}
var DEFAULT_HOURLY_PATTERN, DEFAULT_ATTRIBUTION_MODEL, PROMOTIONAL_EVENTS_2026;
var init_specialScenarioOptimizationService = __esm({
  "server/analytics/specialScenarioOptimizationService.ts"() {
    "use strict";
    init_drizzle_orm();
    init_db2();
    init_schema2();
    __name(resolveAmazonCampaignId3, "resolveAmazonCampaignId");
    __name(average, "average");
    __name(subDays, "subDays");
    __name(addDays, "addDays");
    __name(formatDate, "formatDate");
    DEFAULT_HOURLY_PATTERN = [
      2.5,
      2,
      1.5,
      1.2,
      1,
      1.5,
      // 0-5点
      2.5,
      3.5,
      4.5,
      5,
      5.5,
      5.5,
      // 6-11点
      5,
      4.5,
      4.5,
      4.5,
      4.5,
      5,
      // 12-17点
      5.5,
      6,
      6.5,
      6,
      5,
      4
      // 18-23点
    ];
    __name(learnCampaignSpendPattern, "learnCampaignSpendPattern");
    __name(predictBudgetDepletion, "predictBudgetDepletion");
    __name(calculateOptimalDepletionTime, "calculateOptimalDepletionTime");
    __name(analyzeBudgetDepletionRisk, "analyzeBudgetDepletionRisk");
    DEFAULT_ATTRIBUTION_MODEL = {
      accountId: 0,
      completionRates: {
        day1: 0.7,
        day2: 0.8,
        day3: 0.9,
        day4: 0.95,
        day5: 0.97,
        day6: 0.99,
        day7: 1
      },
      campaignTypeFactors: {
        sp_auto: 1,
        sp_manual: 1,
        sb: 0.95,
        sd: 0.9
      },
      lastCalibrated: /* @__PURE__ */ new Date()
    };
    __name(getAttributionModel, "getAttributionModel");
    __name(adjustForAttributionDelay, "adjustForAttributionDelay");
    __name(adjustRecentPerformanceData, "adjustRecentPerformanceData");
    __name(calculateTargetCpc, "calculateTargetCpc");
    __name(detectOverbidding, "detectOverbidding");
    __name(analyzeBidEfficiency, "analyzeBidEfficiency");
    PROMOTIONAL_EVENTS_2026 = [
      { name: "Prime Day", date: /* @__PURE__ */ new Date("2026-07-15"), duration: 2 },
      { name: "Black Friday", date: /* @__PURE__ */ new Date("2026-11-27"), duration: 1 },
      { name: "Cyber Monday", date: /* @__PURE__ */ new Date("2026-11-30"), duration: 1 },
      { name: "Christmas", date: /* @__PURE__ */ new Date("2026-12-25"), duration: 3 },
      { name: "Valentine's Day", date: /* @__PURE__ */ new Date("2026-02-14"), duration: 1 },
      { name: "Mother's Day", date: /* @__PURE__ */ new Date("2026-05-10"), duration: 1 },
      { name: "Father's Day", date: /* @__PURE__ */ new Date("2026-06-21"), duration: 1 }
    ];
    __name(learnSeasonalPatterns, "learnSeasonalPatterns");
    __name(getUpcomingEvent, "getUpcomingEvent");
    __name(generateSeasonalStrategy, "generateSeasonalStrategy");
    __name(generateEventTransitionPlan, "generateEventTransitionPlan");
    __name(getUpcomingPromotionalEvents, "getUpcomingPromotionalEvents");
    __name(runSpecialScenarioAnalysis, "runSpecialScenarioAnalysis");
  }
});

