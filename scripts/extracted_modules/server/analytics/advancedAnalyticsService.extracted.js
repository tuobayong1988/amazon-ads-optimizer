// Extracted from production dist/index.js
// Original module: server/analytics/advancedAnalyticsService.ts
// Lines: 729

async function getAttributionAnalysis(params) {
  const db = await getDb();
  if (!db) return { results: [], total: 0 };
  const days = params.days || 30;
  const limit = params.limit || 20;
  const offset = params.offset || 0;
  const cutoffDate = /* @__PURE__ */ new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  const cutoffStr = cutoffDate.toISOString().slice(0, 19).replace("T", " ");
  const conditions = [
    gte(optimizationEvents2.createdAt, cutoffStr),
    ne(optimizationEvents2.status, "rolled_back")
  ];
  if (params.accountId) conditions.push(eq(optimizationEvents2.accountId, params.accountId));
  if (params.performanceGroupId) conditions.push(eq(optimizationEvents2.performanceGroupId, params.performanceGroupId));
  if (params.eventCategory) {
    conditions.push(sql`${optimizationEvents2.eventCategory} = ${params.eventCategory}`);
  } else {
    conditions.push(sql`${optimizationEvents2.eventCategory} = 'bid_adjustment'`);
  }
  const whereClause = and(...conditions);
  const [countResult] = await db.select({ count: sql`count(*)` }).from(optimizationEvents2).where(whereClause);
  const total = countResult?.count || 0;
  const events = await db.select().from(optimizationEvents2).where(whereClause).orderBy(desc(optimizationEvents2.createdAt)).limit(limit).offset(offset);
  const results = [];
  for (const event of events) {
    const attribution = await computeEventAttribution(db, event);
    if (attribution) {
      results.push(attribution);
    }
  }
  return { results, total };
}
async function computeEventAttribution(db, event) {
  const eventDate = new Date(event.createdAt);
  const baselineStart = new Date(eventDate);
  baselineStart.setDate(baselineStart.getDate() - 7);
  const baselineEnd = new Date(eventDate);
  baselineEnd.setDate(baselineEnd.getDate() - 1);
  const postStart = new Date(eventDate);
  postStart.setDate(postStart.getDate() + 1);
  const postEnd = new Date(eventDate);
  postEnd.setDate(postEnd.getDate() + 7);
  const [baselineData, postData] = await Promise.all([
    getPerformanceWindow(db, event, baselineStart, baselineEnd),
    getPerformanceWindow(db, event, postStart, postEnd)
  ]);
  const deltaSpend = postData.spend - baselineData.spend;
  const deltaSales = postData.sales - baselineData.sales;
  const deltaImpressions = postData.impressions - baselineData.impressions;
  const deltaClicks = postData.clicks - baselineData.clicks;
  const deltaOrders = postData.orders - baselineData.orders;
  const deltaAcos = postData.acos - baselineData.acos;
  const deltaRoas = postData.roas - baselineData.roas;
  const effectScore = calculateEffectScore2(baselineData, postData, event);
  const effectRating = getEffectRating(effectScore);
  return {
    eventId: event.id,
    eventCategory: event.eventCategory,
    actionType: event.actionType,
    // @ts-ignore
    campaignId: event.campaignId,
    campaignName: event.campaignName,
    keywordText: event.keywordText,
    performanceGroupName: event.performanceGroupName,
    previousBid: event.previousBid,
    newBid: event.newBid,
    bidChangePercent: event.bidChangePercent,
    createdAt: event.createdAt,
    changeReason: event.changeReason,
    baselineSpend: baselineData.spend,
    baselineSales: baselineData.sales,
    baselineImpressions: baselineData.impressions,
    baselineClicks: baselineData.clicks,
    baselineOrders: baselineData.orders,
    baselineAcos: baselineData.acos,
    baselineRoas: baselineData.roas,
    postSpend: postData.spend,
    postSales: postData.sales,
    postImpressions: postData.impressions,
    postClicks: postData.clicks,
    postOrders: postData.orders,
    postAcos: postData.acos,
    postRoas: postData.roas,
    deltaSpend,
    deltaSales,
    deltaImpressions,
    deltaClicks,
    deltaOrders,
    deltaAcos,
    deltaRoas,
    effectRating,
    effectScore
  };
}
async function getPerformanceWindow(db, event, startDate, endDate) {
  const startStr = startDate.toISOString().slice(0, 10);
  const endStr = endDate.toISOString().slice(0, 10);
  const conditions = [
    eq(dailyPerformance.accountId, event.accountId),
    sql`DATE(${dailyPerformance.date}) >= ${startStr}`,
    sql`DATE(${dailyPerformance.date}) <= ${endStr}`
  ];
  if (event.campaignId) {
    conditions.push(eq(dailyPerformance.campaignId, String(event.campaignId)));
  } else if (event.performanceGroupId) {
    conditions.push(eq(dailyPerformance.performanceGroupId, event.performanceGroupId));
  }
  const [result] = await db.select({
    totalSpend: sql`COALESCE(SUM(${dailyPerformance.spend}), 0)`,
    totalSales: sql`COALESCE(SUM(${dailyPerformance.sales}), 0)`,
    totalImpressions: sql`COALESCE(SUM(${dailyPerformance.impressions}), 0)`,
    totalClicks: sql`COALESCE(SUM(${dailyPerformance.clicks}), 0)`,
    totalOrders: sql`COALESCE(SUM(${dailyPerformance.orders}), 0)`
  }).from(dailyPerformance).where(and(...conditions));
  const spend = parseFloat(result?.totalSpend || "0");
  const sales = parseFloat(result?.totalSales || "0");
  const impressions = result?.totalImpressions || 0;
  const clicks = result?.totalClicks || 0;
  const orders = result?.totalOrders || 0;
  const acos = sales > 0 ? spend / sales * 100 : 0;
  const roas = spend > 0 ? sales / spend : 0;
  return { spend, sales, impressions, clicks, orders, acos: Math.round(acos * 100) / 100, roas: Math.round(roas * 100) / 100 };
}
function calculateEffectScore2(baseline, post, event) {
  if (baseline.spend === 0 && baseline.sales === 0) return 0;
  let score = 0;
  if (baseline.roas > 0) {
    const roasChange = (post.roas - baseline.roas) / baseline.roas * 100;
    score += Math.max(-40, Math.min(40, roasChange * 0.4));
  }
  if (baseline.acos > 0) {
    const acosChange = (baseline.acos - post.acos) / baseline.acos * 100;
    score += Math.max(-30, Math.min(30, acosChange * 0.3));
  }
  if (baseline.orders > 0) {
    const ordersChange = (post.orders - baseline.orders) / baseline.orders * 100;
    score += Math.max(-30, Math.min(30, ordersChange * 0.3));
  } else if (post.orders > 0) {
    score += 15;
  }
  return Math.round(Math.max(-100, Math.min(100, score)));
}
function getEffectRating(score) {
  if (score >= 30) return "excellent";
  if (score >= 10) return "good";
  if (score >= -10) return "neutral";
  if (score >= -30) return "poor";
  return "harmful";
}
async function getTrendAnalysis(params) {
  const db = await getDb();
  if (!db) return [];
  const days = params.days || 30;
  const startDate = /* @__PURE__ */ new Date();
  startDate.setDate(startDate.getDate() - days);
  const startStr = startDate.toISOString().slice(0, 10);
  const conditions = [
    eq(dailyPerformance.accountId, params.accountId),
    sql`DATE(${dailyPerformance.date}) >= ${startStr}`
  ];
  if (params.performanceGroupId) {
    conditions.push(eq(dailyPerformance.performanceGroupId, params.performanceGroupId));
  }
  const dailyData = await db.select({
    date: sql`DATE(${dailyPerformance.date})`,
    totalSpend: sql`SUM(${dailyPerformance.spend})`,
    totalSales: sql`SUM(${dailyPerformance.sales})`,
    totalImpressions: sql`SUM(${dailyPerformance.impressions})`,
    totalClicks: sql`SUM(${dailyPerformance.clicks})`,
    totalOrders: sql`SUM(${dailyPerformance.orders})`
  }).from(dailyPerformance).where(and(...conditions)).groupBy(sql`DATE(${dailyPerformance.date})`).orderBy(sql`DATE(${dailyPerformance.date})`);
  if (dailyData.length < 3) return [];
  const enrichedData = dailyData.map((d) => {
    const spend = parseFloat(d.totalSpend || "0");
    const sales = parseFloat(d.totalSales || "0");
    const impressions = d.totalImpressions || 0;
    const clicks = d.totalClicks || 0;
    const orders = d.totalOrders || 0;
    return {
      date: d.date,
      spend,
      sales,
      impressions,
      clicks,
      orders,
      acos: sales > 0 ? spend / sales * 100 : 0,
      roas: spend > 0 ? sales / spend : 0,
      ctr: impressions > 0 ? clicks / impressions * 100 : 0,
      cvr: clicks > 0 ? orders / clicks * 100 : 0,
      cpc: clicks > 0 ? spend / clicks : 0
    };
  });
  const metricsToAnalyze = params.metrics || ["acos", "roas", "spend", "sales", "ctr"];
  const metricLabels = {
    acos: "ACoS",
    roas: "ROAS",
    spend: "\u82B1\u8D39",
    sales: "\u9500\u552E\u989D",
    impressions: "\u66DD\u5149\u91CF",
    clicks: "\u70B9\u51FB\u91CF",
    orders: "\u8BA2\u5355\u91CF",
    ctr: "\u70B9\u51FB\u7387",
    cvr: "\u8F6C\u5316\u7387",
    cpc: "\u5355\u6B21\u70B9\u51FB\u6210\u672C"
  };
  const results = [];
  for (const metric of metricsToAnalyze) {
    const dataPoints = enrichedData.map((d) => ({
      date: d.date,
      // @ts-expect-error - type assertion
      value: Math.round(d[metric] * 100) / 100
    }));
    const movingAverage = calculateMovingAverage(dataPoints, 7);
    const { direction, changePercent, strength } = analyzeTrend(dataPoints);
    results.push({
      metric,
      metricLabel: metricLabels[metric] || metric,
      direction,
      changePercent: Math.round(changePercent * 100) / 100,
      trendStrength: strength,
      dataPoints,
      movingAverage
    });
  }
  return results;
}
function calculateMovingAverage(data, window2) {
  if (data.length < window2) return [];
  const result = [];
  for (let i = window2 - 1; i < data.length; i++) {
    const windowData = data.slice(i - window2 + 1, i + 1);
    const avg2 = windowData.reduce((sum2, d) => sum2 + d.value, 0) / window2;
    result.push({ date: data[i].date, value: Math.round(avg2 * 100) / 100 });
  }
  return result;
}
function analyzeTrend(data) {
  if (data.length < 2) return { direction: "stable", changePercent: 0, strength: "weak" };
  const n = data.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += data[i].value;
    sumXY += i * data[i].value;
    sumX2 += i * i;
  }
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const avgValue = sumY / n;
  const changePercent = avgValue !== 0 ? slope * n / avgValue * 100 : 0;
  let direction;
  if (Math.abs(changePercent) < 3) {
    direction = "stable";
  } else {
    direction = changePercent > 0 ? "up" : "down";
  }
  let strength;
  if (Math.abs(changePercent) >= 20) {
    strength = "strong";
  } else if (Math.abs(changePercent) >= 8) {
    strength = "moderate";
  } else {
    strength = "weak";
  }
  return { direction, changePercent, strength };
}
async function detectAnomalies3(params) {
  const db = await getDb();
  if (!db) return [];
  const days = params.days || 30;
  const sensitivity = params.sensitivity || 2;
  const startDate = /* @__PURE__ */ new Date();
  startDate.setDate(startDate.getDate() - days);
  const startStr = startDate.toISOString().slice(0, 10);
  const conditions = [
    eq(dailyPerformance.accountId, params.accountId),
    sql`DATE(${dailyPerformance.date}) >= ${startStr}`
  ];
  if (params.performanceGroupId) {
    conditions.push(eq(dailyPerformance.performanceGroupId, params.performanceGroupId));
  }
  const dailyData = await db.select({
    date: sql`DATE(${dailyPerformance.date})`,
    totalSpend: sql`SUM(${dailyPerformance.spend})`,
    totalSales: sql`SUM(${dailyPerformance.sales})`,
    totalImpressions: sql`SUM(${dailyPerformance.impressions})`,
    totalClicks: sql`SUM(${dailyPerformance.clicks})`,
    totalOrders: sql`SUM(${dailyPerformance.orders})`
  }).from(dailyPerformance).where(and(...conditions)).groupBy(sql`DATE(${dailyPerformance.date})`).orderBy(sql`DATE(${dailyPerformance.date})`);
  if (dailyData.length < 7) return [];
  const enrichedData = dailyData.map((d) => {
    const spend = parseFloat(d.totalSpend || "0");
    const sales = parseFloat(d.totalSales || "0");
    const impressions = d.totalImpressions || 0;
    const clicks = d.totalClicks || 0;
    const orders = d.totalOrders || 0;
    return {
      date: d.date,
      spend,
      sales,
      impressions,
      clicks,
      orders,
      acos: sales > 0 ? spend / sales * 100 : 0,
      roas: spend > 0 ? sales / spend : 0
    };
  });
  const anomalies = [];
  const metricsToCheck = ["acos", "spend", "sales", "roas"];
  const metricLabels = {
    acos: "ACoS",
    spend: "\u82B1\u8D39",
    sales: "\u9500\u552E\u989D",
    roas: "ROAS"
  };
  for (const metric of metricsToCheck) {
    const values = enrichedData.map((d) => d[metric]);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum2, v) => sum2 + Math.pow(v - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);
    if (stdDev === 0) continue;
    const threshold = sensitivity;
    for (let i = 0; i < enrichedData.length; i++) {
      const value = enrichedData[i][metric];
      const zScore = Math.abs((value - mean) / stdDev);
      if (zScore >= threshold) {
        const deviationPercent = mean !== 0 ? (value - mean) / mean * 100 : 0;
        const direction = value > mean ? "spike" : "drop";
        let severity;
        if (zScore >= 3) severity = "critical";
        else if (zScore >= 2) severity = "warning";
        else severity = "info";
        const anomalyDate = enrichedData[i].date;
        const possibleCauses = await findPossibleCauses(db, params.accountId, anomalyDate, params.performanceGroupId);
        anomalies.push({
          id: `anomaly_${metric}_${anomalyDate}`,
          date: anomalyDate,
          metric,
          metricLabel: metricLabels[metric] || metric,
          actualValue: Math.round(value * 100) / 100,
          expectedValue: Math.round(mean * 100) / 100,
          deviationPercent: Math.round(deviationPercent * 100) / 100,
          severity,
          direction,
          possibleCauses
        });
      }
    }
  }
  const severityOrder = { critical: 0, warning: 1, info: 2 };
  return anomalies.sort((a, b) => {
    if (severityOrder[a.severity] !== severityOrder[b.severity]) {
      return severityOrder[a.severity] - severityOrder[b.severity];
    }
    return b.date.localeCompare(a.date);
  });
}
async function findPossibleCauses(db, accountId, anomalyDate, performanceGroupId2) {
  const startDate = new Date(anomalyDate);
  startDate.setDate(startDate.getDate() - 1);
  const endDate = new Date(anomalyDate);
  endDate.setDate(endDate.getDate() + 1);
  const startStr = startDate.toISOString().slice(0, 19).replace("T", " ");
  const endStr = endDate.toISOString().slice(0, 19).replace("T", " ");
  const conditions = [
    eq(optimizationEvents2.accountId, accountId),
    gte(optimizationEvents2.createdAt, startStr),
    lte(optimizationEvents2.createdAt, endStr),
    ne(optimizationEvents2.status, "rolled_back")
  ];
  if (performanceGroupId2) {
    conditions.push(eq(optimizationEvents2.performanceGroupId, performanceGroupId2));
  }
  const events = await db.select().from(optimizationEvents2).where(and(...conditions)).orderBy(desc(optimizationEvents2.createdAt)).limit(10);
  return events.map((e) => {
    const eventDate = new Date(e.createdAt);
    const anomalyDateObj = new Date(anomalyDate);
    const hoursDiff = Math.abs(eventDate.getTime() - anomalyDateObj.getTime()) / (1e3 * 60 * 60);
    let confidence = 80 - hoursDiff * 3;
    if (e.eventCategory === "bid_adjustment") confidence += 10;
    if (e.eventCategory === "campaign_action") confidence += 5;
    confidence = Math.max(10, Math.min(95, confidence));
    let description = "";
    if (e.eventCategory === "bid_adjustment") {
      description = `\u51FA\u4EF7\u8C03\u6574: ${e.keywordText || e.campaignName || "\u672A\u77E5"} \u4ECE $${e.previousBid || "?"} \u8C03\u6574\u5230 $${e.newBid || "?"}`;
    } else if (e.eventCategory === "campaign_action") {
      description = `\u5E7F\u544A\u6D3B\u52A8\u64CD\u4F5C: ${e.actionType} - ${e.campaignName || "\u672A\u77E5"}`;
    } else if (e.eventCategory === "budget_adjustment") {
      description = `\u9884\u7B97\u8C03\u6574: ${e.campaignName || "\u672A\u77E5"} ${e.previousValue || "?"} \u2192 ${e.newValue || "?"}`;
    } else {
      description = `${e.eventCategory}: ${e.actionType} - ${e.changeReason || e.actionDetail || ""}`;
    }
    return {
      eventId: e.id,
      actionType: e.actionType,
      eventCategory: e.eventCategory,
      description,
      createdAt: e.createdAt,
      confidence: Math.round(confidence)
    };
  });
}
async function getStrategyROIComparison(params) {
  const db = await getDb();
  if (!db) return [];
  const days = params.days || 30;
  const groupBy = params.groupBy || "strategy";
  const cutoffDate = /* @__PURE__ */ new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  const cutoffStr = cutoffDate.toISOString().slice(0, 19).replace("T", " ");
  const conditions = [
    gte(optimizationEvents2.createdAt, cutoffStr)
  ];
  if (params.accountId) conditions.push(eq(optimizationEvents2.accountId, params.accountId));
  if (params.performanceGroupId) conditions.push(eq(optimizationEvents2.performanceGroupId, params.performanceGroupId));
  const whereClause = and(...conditions);
  const events = await db.select().from(optimizationEvents2).where(whereClause).orderBy(asc(optimizationEvents2.createdAt));
  const groups = {};
  for (const event of events) {
    let key;
    let name2;
    let id = null;
    if (groupBy === "strategy") {
      key = String(event.strategyTemplateId || "no_strategy");
      name2 = event.strategyTemplateName || "\u65E0\u7B56\u7565\u6A21\u677F";
      id = event.strategyTemplateId;
    } else if (groupBy === "actionType") {
      key = event.actionType;
      name2 = getActionTypeLabel(event.actionType);
      id = null;
    } else {
      key = event.eventCategory;
      name2 = getEventCategoryLabel(event.eventCategory);
      id = null;
    }
    if (!groups[key]) {
      groups[key] = { name: name2, id, events: [] };
    }
    groups[key].events.push(event);
  }
  const results = [];
  for (const [key, group] of Object.entries(groups)) {
    const totalEvents = group.events.length;
    const successEvents = group.events.filter((e) => e.status === "success").length;
    const failedEvents = group.events.filter((e) => e.status === "failed").length;
    const bidEvents = group.events.filter((e) => e.eventCategory === "bid_adjustment");
    const bidIncreases = bidEvents.filter((e) => parseFloat(e.bidChangePercent || "0") > 0).length;
    const bidDecreases = bidEvents.filter((e) => parseFloat(e.bidChangePercent || "0") < 0).length;
    const avgBidChange = bidEvents.length > 0 ? bidEvents.reduce((sum2, e) => sum2 + parseFloat(e.bidChangePercent || "0"), 0) / bidEvents.length : 0;
    const trackedEvents = group.events.filter((e) => e.actualProfit7D !== null);
    const totalEstimatedProfit = group.events.reduce((sum2, e) => sum2 + parseFloat(e.expectedProfitIncrease || "0"), 0);
    const totalActualProfit7D = trackedEvents.reduce((sum2, e) => sum2 + parseFloat(e.actualProfit7D || "0"), 0);
    const totalActualProfit14D = group.events.filter((e) => e.actualProfit14D !== null).reduce((sum2, e) => sum2 + parseFloat(e.actualProfit14D || "0"), 0);
    const totalActualProfit30D = group.events.filter((e) => e.actualProfit30D !== null).reduce((sum2, e) => sum2 + parseFloat(e.actualProfit30D || "0"), 0);
    const roi7D = totalEstimatedProfit !== 0 ? totalActualProfit7D / Math.abs(totalEstimatedProfit) * 100 : null;
    const roi14D = totalEstimatedProfit !== 0 ? totalActualProfit14D / Math.abs(totalEstimatedProfit) * 100 : null;
    const roi30D = totalEstimatedProfit !== 0 ? totalActualProfit30D / Math.abs(totalEstimatedProfit) * 100 : null;
    const profitAccuracy = totalEstimatedProfit !== 0 && trackedEvents.length > 0 ? Math.min(100, Math.max(0, (1 - Math.abs(totalActualProfit7D - totalEstimatedProfit) / Math.abs(totalEstimatedProfit)) * 100)) : null;
    const dates = group.events.map((e) => e.createdAt).filter(Boolean).sort();
    const firstEventDate = dates[0] || null;
    const lastEventDate = dates[dates.length - 1] || null;
    let avgEventsPerDay = 0;
    if (firstEventDate && lastEventDate) {
      const daysDiff = Math.max(1, (new Date(lastEventDate).getTime() - new Date(firstEventDate).getTime()) / (1e3 * 60 * 60 * 24));
      avgEventsPerDay = Math.round(totalEvents / daysDiff * 100) / 100;
    }
    results.push({
      strategyId: group.id,
      strategyName: group.name,
      totalEvents,
      successEvents,
      failedEvents,
      successRate: totalEvents > 0 ? Math.round(successEvents / totalEvents * 100) : 0,
      avgBidChange: Math.round(avgBidChange * 100) / 100,
      totalBidIncreases: bidIncreases,
      totalBidDecreases: bidDecreases,
      trackedEvents: trackedEvents.length,
      totalEstimatedProfit: Math.round(totalEstimatedProfit * 100) / 100,
      totalActualProfit7D: Math.round(totalActualProfit7D * 100) / 100,
      totalActualProfit14D: Math.round(totalActualProfit14D * 100) / 100,
      totalActualProfit30D: Math.round(totalActualProfit30D * 100) / 100,
      roi7D: roi7D !== null ? Math.round(roi7D * 100) / 100 : null,
      // @ts-ignore
      roi14D: roi14D !== null ? Math.round(roi14D * 100) / 100 : null,
      roi30D: roi30D !== null ? Math.round(roi30D * 100) / 100 : null,
      profitAccuracy: profitAccuracy !== null ? Math.round(profitAccuracy * 100) / 100 : null,
      firstEventDate,
      lastEventDate,
      avgEventsPerDay
    });
  }
  return results.sort((a, b) => b.totalEvents - a.totalEvents);
}
async function getAdvancedAnalyticsSummary(params) {
  const db = await getDb();
  if (!db) return getEmptySummary();
  const days = params.days || 30;
  const cutoffDate = /* @__PURE__ */ new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  const cutoffStr = cutoffDate.toISOString().slice(0, 19).replace("T", " ");
  const conditions = [gte(optimizationEvents2.createdAt, cutoffStr)];
  if (params.accountId) conditions.push(eq(optimizationEvents2.accountId, params.accountId));
  if (params.performanceGroupId) conditions.push(eq(optimizationEvents2.performanceGroupId, params.performanceGroupId));
  const whereClause = and(...conditions);
  const [totalResult] = await db.select({ count: sql`count(*)` }).from(optimizationEvents2).where(whereClause);
  const totalOptimizationEvents = totalResult?.count || 0;
  const [bidResult] = await db.select({ count: sql`count(*)` }).from(optimizationEvents2).where(and(whereClause, sql`${optimizationEvents2.eventCategory} = 'bid_adjustment'`));
  const totalBidAdjustments = bidResult?.count || 0;
  const [successResult] = await db.select({ count: sql`count(*)` }).from(optimizationEvents2).where(and(whereClause, eq(optimizationEvents2.status, "success")));
  const successCount = successResult?.count || 0;
  const overallSuccessRate = totalOptimizationEvents > 0 ? Math.round(successCount / totalOptimizationEvents * 100) : 0;
  const [profitResult] = await db.select({
    totalEstimated: sql`COALESCE(SUM(${optimizationEvents2.expectedProfitIncrease}), 0)`,
    totalActual7D: sql`COALESCE(SUM(${optimizationEvents2.actualProfit7D}), 0)`,
    trackedCount: sql`SUM(CASE WHEN ${optimizationEvents2.actualProfit7D} IS NOT NULL THEN 1 ELSE 0 END)`,
    positiveCount: sql`SUM(CASE WHEN ${optimizationEvents2.actualProfit7D} > 0 THEN 1 ELSE 0 END)`
  }).from(optimizationEvents2).where(whereClause);
  const trackedCount = profitResult?.trackedCount || 0;
  const positiveCount = profitResult?.positiveCount || 0;
  const positiveEffectRate = trackedCount > 0 ? Math.round(positiveCount / trackedCount * 100) : 0;
  const strategyROI = await getStrategyROIComparison({
    // @ts-ignore
    accountId: params.accountId,
    performanceGroupId: params.performanceGroupId,
    days,
    groupBy: "strategy"
  });
  const validStrategies = strategyROI.filter((s) => s.roi7D !== null && s.totalEvents >= 5);
  const bestStrategy = validStrategies.length > 0 ? validStrategies.reduce((best, s) => (s.roi7D || 0) > (best.roi7D || 0) ? s : best) : null;
  const worstStrategy = validStrategies.length > 0 ? validStrategies.reduce((worst, s) => (s.roi7D || 0) < (worst.roi7D || 0) ? s : worst) : null;
  let activeAnomalies = 0;
  let criticalAnomalies = 0;
  if (params.accountId) {
    const anomalies = await detectAnomalies3({
      accountId: params.accountId,
      performanceGroupId: params.performanceGroupId,
      days: Math.min(days, 14),
      // 异常检测只看最近14天
      sensitivity: 2
    });
    activeAnomalies = anomalies.length;
    criticalAnomalies = anomalies.filter((a) => a.severity === "critical").length;
  }
  return {
    totalOptimizationEvents,
    totalBidAdjustments,
    overallSuccessRate,
    avgEffectScore: 0,
    // 需要归因分析计算
    totalAttributedSalesIncrease: parseFloat(profitResult?.totalActual7D || "0"),
    totalAttributedSpendIncrease: 0,
    netAttributedProfit: parseFloat(profitResult?.totalActual7D || "0"),
    positiveEffectRate,
    activeAnomalies,
    criticalAnomalies,
    bestStrategyName: bestStrategy?.strategyName || null,
    bestStrategyROI: bestStrategy?.roi7D || null,
    worstStrategyName: worstStrategy?.strategyName || null,
    worstStrategyROI: worstStrategy?.roi7D || null
  };
}
function getEmptySummary() {
  return {
    totalOptimizationEvents: 0,
    totalBidAdjustments: 0,
    overallSuccessRate: 0,
    avgEffectScore: 0,
    totalAttributedSalesIncrease: 0,
    totalAttributedSpendIncrease: 0,
    netAttributedProfit: 0,
    positiveEffectRate: 0,
    activeAnomalies: 0,
    criticalAnomalies: 0,
    bestStrategyName: null,
    bestStrategyROI: null,
    worstStrategyName: null,
    worstStrategyROI: null
  };
}
async function getEventsToTrack(period) {
  const db = await getDb();
  if (!db) return [];
  const now = /* @__PURE__ */ new Date();
  const targetDate = new Date(now.getTime() - period * 24 * 60 * 60 * 1e3);
  const startOfDay = new Date(targetDate);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(targetDate);
  endOfDay.setHours(23, 59, 59, 999);
  const startStr = startOfDay.toISOString().slice(0, 19).replace("T", " ");
  const endStr = endOfDay.toISOString().slice(0, 19).replace("T", " ");
  let trackingField;
  if (period === 7) trackingField = "actual_profit_7d";
  else if (period === 14) trackingField = "actual_profit_14d";
  else trackingField = "actual_profit_30d";
  const events = await db.select().from(optimizationEvents2).where(and(
    ne(optimizationEvents2.status, "rolled_back"),
    sql`${optimizationEvents2.eventCategory} = 'bid_adjustment'`,
    gte(optimizationEvents2.createdAt, startStr),
    lte(optimizationEvents2.createdAt, endStr),
    // v361: 使用白名单验证动态列名，防止SQL注入
    trackingField === "actual_profit_7d" ? sql`actual_profit_7d IS NULL` : trackingField === "actual_profit_14d" ? sql`actual_profit_14d IS NULL` : sql`actual_profit_30d IS NULL`
  ));
  return events;
}
async function updateEventTrackingData(eventId, period, trackingData) {
  const db = await getDb();
  if (!db) return;
  const updateData = {
    trackingUpdatedAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ")
  };
  if (period === 7) {
    updateData.actualProfit7D = trackingData.profit.toString();
    updateData.actualSpend7D = trackingData.spend.toString();
    updateData.actualRevenue7D = trackingData.sales.toString();
    updateData.actualImpressions7D = trackingData.impressions;
    updateData.actualClicks7D = trackingData.clicks;
    updateData.actualConversions7D = trackingData.orders;
  } else if (period === 14) {
    updateData.actualProfit14D = trackingData.profit.toString();
  } else {
    updateData.actualProfit30D = trackingData.profit.toString();
  }
  await db.update(optimizationEvents2).set(updateData).where(eq(optimizationEvents2.id, eventId));
}
async function runUnifiedEffectTrackingTask(period) {
  const db = await getDb();
  if (!db) return 0;
  const events = await getEventsToTrack(period);
  let processed = 0;
  for (const event of events) {
    try {
      const eventDate = new Date(event.createdAt);
      const endDate = new Date(eventDate.getTime() + period * 24 * 60 * 60 * 1e3);
      const perfData = await getPerformanceWindow(db, event, eventDate, endDate);
      await updateEventTrackingData(event.id, period, {
        spend: perfData.spend,
        sales: perfData.sales,
        impressions: perfData.impressions,
        clicks: perfData.clicks,
        orders: perfData.orders,
        profit: perfData.sales - perfData.spend
      });
      processed++;
    } catch (error48) {
      log153.warn(`[AdvancedAnalytics] Failed to track event ${event.id}:`, error48);
    }
  }
  return processed;
}
async function runAllUnifiedTrackingTasks() {
  const day7 = await runUnifiedEffectTrackingTask(7);
  const day14 = await runUnifiedEffectTrackingTask(14);
  const day30 = await runUnifiedEffectTrackingTask(30);
  log153.info(`[AdvancedAnalytics] Effect tracking completed: 7d=${day7}, 14d=${day14}, 30d=${day30}`);
  return { day7, day14, day30 };
}
function getActionTypeLabel(actionType) {
  const labels = {
    bid_increase: "\u51FA\u4EF7\u4E0A\u8C03",
    bid_decrease: "\u51FA\u4EF7\u4E0B\u8C03",
    bid_set: "\u51FA\u4EF7\u8BBE\u5B9A",
    bid_auto_adjust: "\u81EA\u52A8\u51FA\u4EF7\u8C03\u6574",
    dayparting_bid: "\u5206\u65F6\u51FA\u4EF7",
    budget_increase: "\u9884\u7B97\u589E\u52A0",
    budget_decrease: "\u9884\u7B97\u51CF\u5C11",
    budget_set: "\u9884\u7B97\u8BBE\u5B9A",
    budget_adjustment: "\u9884\u7B97\u8C03\u6574",
    placement_adjust: "\u4F4D\u7F6E\u8C03\u6574",
    placement_enable: "\u4F4D\u7F6E\u542F\u7528",
    placement_disable: "\u4F4D\u7F6E\u7981\u7528",
    search_term_harvest: "\u641C\u7D22\u8BCD\u6536\u5272",
    negative_keyword_add: "\u6DFB\u52A0\u5426\u5B9A\u8BCD",
    negative_keyword_remove: "\u79FB\u9664\u5426\u5B9A\u8BCD",
    keyword_create: "\u521B\u5EFA\u5173\u952E\u8BCD",
    target_pause: "\u6682\u505C\u6295\u653E\u76EE\u6807",
    target_enable: "\u542F\u7528\u6295\u653E\u76EE\u6807",
    campaign_pause: "\u6682\u505C\u5E7F\u544A\u6D3B\u52A8",
    campaign_enable: "\u542F\u7528\u5E7F\u544A\u6D3B\u52A8",
    settings_update: "\u8BBE\u7F6E\u66F4\u65B0",
    strategy_change: "\u7B56\u7565\u53D8\u66F4",
    schedule_update: "\u8C03\u5EA6\u66F4\u65B0"
  };
  return labels[actionType] || actionType;
}
function getEventCategoryLabel(category) {
  const labels = {
    bid_adjustment: "\u51FA\u4EF7\u8C03\u6574",
    placement_adjustment: "\u4F4D\u7F6E\u8C03\u6574",
    budget_adjustment: "\u9884\u7B97\u8C03\u6574",
    search_term_action: "\u641C\u7D22\u8BCD\u64CD\u4F5C",
    keyword_action: "\u5173\u952E\u8BCD\u64CD\u4F5C",
    campaign_action: "\u5E7F\u544A\u6D3B\u52A8\u64CD\u4F5C",
    adgroup_action: "\u5E7F\u544A\u7EC4\u64CD\u4F5C",
    target_management: "\u6295\u653E\u76EE\u6807\u7BA1\u7406",
    settings_change: "\u8BBE\u7F6E\u53D8\u66F4"
  };
  return labels[category] || category;
}
var log153;
var init_advancedAnalyticsService = __esm({
  "server/analytics/advancedAnalyticsService.ts"() {
    "use strict";
    init_logger();
    init_db2();
    init_schema2();
    init_drizzle_orm();
    log153 = createModuleLogger("AdvancedAnalyticsService");
    __name(getAttributionAnalysis, "getAttributionAnalysis");
    __name(computeEventAttribution, "computeEventAttribution");
    __name(getPerformanceWindow, "getPerformanceWindow");
    __name(calculateEffectScore2, "calculateEffectScore");
    __name(getEffectRating, "getEffectRating");
    __name(getTrendAnalysis, "getTrendAnalysis");
    __name(calculateMovingAverage, "calculateMovingAverage");
    __name(analyzeTrend, "analyzeTrend");
    __name(detectAnomalies3, "detectAnomalies");
    __name(findPossibleCauses, "findPossibleCauses");
    __name(getStrategyROIComparison, "getStrategyROIComparison");
    __name(getAdvancedAnalyticsSummary, "getAdvancedAnalyticsSummary");
    __name(getEmptySummary, "getEmptySummary");
    __name(getEventsToTrack, "getEventsToTrack");
    __name(updateEventTrackingData, "updateEventTrackingData");
    __name(runUnifiedEffectTrackingTask, "runUnifiedEffectTrackingTask");
    __name(runAllUnifiedTrackingTasks, "runAllUnifiedTrackingTasks");
    __name(getActionTypeLabel, "getActionTypeLabel");
    __name(getEventCategoryLabel, "getEventCategoryLabel");
  }
});

