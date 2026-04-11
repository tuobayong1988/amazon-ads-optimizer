// Extracted from production dist/index.js
// Original module: server/optimization/multiDimComboAnalyzer.ts
// Lines: 781

var multiDimComboAnalyzer_exports = {};
__export(multiDimComboAnalyzer_exports, {
  analyzeCampaignCombos: () => analyzeCampaignCombos,
  executeMultiDimComboAnalysis: () => executeMultiDimComboAnalysis,
  getCampaignBudgetMultiplier: () => getCampaignBudgetMultiplier,
  getComboAnalysisForAccount: () => getComboAnalysisForAccount,
  getComboAnalysisForCampaign: () => getComboAnalysisForCampaign,
  getRealtimeMultipliers: () => getRealtimeMultipliers,
  persistAnalysisResults: () => persistAnalysisResults
});
function getTimeDecayWeight(daysAgo) {
  if (daysAgo <= 7) return 1;
  if (daysAgo <= 14) return 0.7;
  if (daysAgo <= 21) return 0.4;
  if (daysAgo <= 30) return 0.2;
  return 0.1;
}
async function synthesizeFromExistingData(db, campaignId, accountId, startStr, endStr) {
  const campaignInfo = await db.select({
    id: campaigns.id,
    campaignId: campaigns.campaignId
  }).from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
  if (campaignInfo.length === 0) return [];
  const amazonCampaignId = campaignInfo[0].campaignId;
  const hourlyData = await db.select({
    keywordId: hourlyPerformance.keywordId,
    hour: hourlyPerformance.hour,
    dayOfWeek: hourlyPerformance.dayOfWeek,
    date: hourlyPerformance.date,
    impressions: hourlyPerformance.impressions,
    clicks: hourlyPerformance.clicks,
    spend: hourlyPerformance.spend,
    sales: hourlyPerformance.sales,
    orders: hourlyPerformance.orders
  }).from(hourlyPerformance).where(and(
    eq(hourlyPerformance.campaignId, String(amazonCampaignId)),
    // v438: 统一使用Amazon原始ID查询performance表
    eq(hourlyPerformance.accountId, accountId),
    gte(hourlyPerformance.date, startStr),
    lte(hourlyPerformance.date, endStr)
  ));
  if (hourlyData.length === 0) {
    log98.info(`[ComboAnalyzer] Campaign ${campaignId} hourlyPerformance \u4E5F\u65E0\u6570\u636E`);
    return [];
  }
  const placementData = await db.select({
    placement: placementPerformance.placement,
    impressions: placementPerformance.impressions,
    clicks: placementPerformance.clicks,
    spend: placementPerformance.spend,
    sales: placementPerformance.sales,
    orders: placementPerformance.orders
  }).from(placementPerformance).where(and(
    eq(placementPerformance.campaignId, String(amazonCampaignId)),
    eq(placementPerformance.accountId, accountId),
    gte(placementPerformance.date, startStr),
    lte(placementPerformance.date, endStr)
  ));
  const placementRatios = calculatePlacementRatios(placementData);
  log98.info(`[ComboAnalyzer] Campaign ${campaignId} \u5408\u6210\u6570\u636E: ${hourlyData.length}\u6761hourly\u8BB0\u5F55, \u4F4D\u7F6E\u6BD4\u4F8B: TOS=${(placementRatios.top_of_search * 100).toFixed(1)}%, PP=${(placementRatios.product_page * 100).toFixed(1)}%, ROS=${(placementRatios.rest_of_search * 100).toFixed(1)}%`);
  const synthesized = [];
  for (const row of hourlyData) {
    if (!row.keywordId) continue;
    const spend = parseFloat(row.spend || "0");
    const sales = parseFloat(row.sales || "0");
    const clicks = row.clicks || 0;
    const impressions = row.impressions || 0;
    const orders = row.orders || 0;
    const dateStr = typeof row.date === "string" ? row.date.split("T")[0] : new Date(row.date).toISOString().split("T")[0];
    for (const placement of ["top_of_search", "product_page", "rest_of_search"]) {
      const ratio = placementRatios[placement];
      if (ratio <= 0) continue;
      synthesized.push({
        // @ts-ignore
        keywordId: row.keywordId,
        targetId: null,
        placement,
        // @ts-ignore
        dayOfWeek: row.dayOfWeek,
        // @ts-ignore
        hour: row.hour,
        date: dateStr,
        impressions: Math.round(impressions * ratio),
        clicks: Math.round(clicks * ratio),
        spend: (spend * ratio).toFixed(2),
        sales: (sales * ratio).toFixed(2),
        orders: Math.round(orders * ratio)
      });
    }
  }
  log98.info(`[ComboAnalyzer] Campaign ${campaignId} \u5408\u6210\u4E86 ${synthesized.length} \u6761\u4EA4\u53C9\u7EF4\u5EA6\u8BB0\u5F55`);
  return synthesized;
}
function calculatePlacementRatios(placementData) {
  if (placementData.length === 0) {
    return {
      top_of_search: 0.35,
      product_page: 0.3,
      rest_of_search: 0.35
    };
  }
  const spendByPlacement = {
    top_of_search: 0,
    product_page: 0,
    rest_of_search: 0
    // @ts-ignore
  };
  for (const row of placementData) {
    const placement = row.placement;
    const spend = parseFloat(row.spend || "0");
    if (spendByPlacement[placement] !== void 0) {
      spendByPlacement[placement] += spend;
    }
  }
  const totalSpend = Object.values(spendByPlacement).reduce((a, b) => a + b, 0);
  if (totalSpend <= 0) {
    const clicksByPlacement = {
      top_of_search: 0,
      // @ts-ignore
      product_page: 0,
      // @ts-ignore
      rest_of_search: 0
      // @ts-ignore
    };
    for (const row of placementData) {
      const placement = row.placement;
      if (clicksByPlacement[placement] !== void 0) {
        clicksByPlacement[placement] += row.clicks || 0;
      }
    }
    const totalClicks = Object.values(clicksByPlacement).reduce((a, b) => a + b, 0);
    if (totalClicks <= 0) {
      return { top_of_search: 0.35, product_page: 0.3, rest_of_search: 0.35 };
    }
    return {
      // @ts-ignore
      top_of_search: clicksByPlacement.top_of_search / totalClicks,
      // @ts-ignore
      product_page: clicksByPlacement.product_page / totalClicks,
      // @ts-ignore
      rest_of_search: clicksByPlacement.rest_of_search / totalClicks
    };
  }
  return {
    // @ts-ignore
    top_of_search: spendByPlacement.top_of_search / totalSpend,
    // @ts-ignore
    product_page: spendByPlacement.product_page / totalSpend,
    // @ts-ignore
    rest_of_search: spendByPlacement.rest_of_search / totalSpend
  };
}
async function loadPreviousAnalysis(db, accountId, campaignId) {
  const prevResults = await db.select({
    keywordId: multiDimComboAnalysis.keywordId,
    targetId: multiDimComboAnalysis.targetId,
    comboCategory: multiDimComboAnalysis.comboCategory,
    suggestedBidMultiplier: multiDimComboAnalysis.suggestedBidMultiplier,
    suggestedPlacementMultiplier: multiDimComboAnalysis.suggestedPlacementMultiplier,
    suggestedTimeMultiplier: multiDimComboAnalysis.suggestedTimeMultiplier
  }).from(multiDimComboAnalysis).where(and(
    eq(multiDimComboAnalysis.accountId, accountId),
    eq(multiDimComboAnalysis.campaignId, String(campaignId))
  ));
  const map2 = /* @__PURE__ */ new Map();
  for (const row of prevResults) {
    const key = row.keywordId ? `kw_${row.keywordId}` : `tgt_${row.targetId}`;
    map2.set(key, {
      // @ts-ignore
      category: row.comboCategory,
      // @ts-ignore
      bidMultiplier: parseFloat(String(row.suggestedBidMultiplier || "1.000")),
      // @ts-ignore
      placementMultiplier: parseFloat(String(row.suggestedPlacementMultiplier || "1.000")),
      // @ts-ignore
      timeMultiplier: parseFloat(String(row.suggestedTimeMultiplier || "1.000"))
    });
  }
  return map2;
}
function smoothMultiplier(newValue, oldValue, smoothFactor = 0.6) {
  if (oldValue === 1 && newValue === 1) return 1;
  if (Math.abs(oldValue - 1) < 1e-3) return newValue;
  return oldValue * (1 - smoothFactor) + newValue * smoothFactor;
}
async function analyzeCampaignCombos(db, campaignId, accountId, targetAcos = 30, lookbackDays = 30) {
  const endDate = /* @__PURE__ */ new Date();
  const startDate = /* @__PURE__ */ new Date();
  startDate.setDate(startDate.getDate() - lookbackDays);
  const startStr = startDate.toISOString().split("T")[0];
  const endStr = endDate.toISOString().split("T")[0];
  const campaignInfo = await db.select({ campaignName: campaigns.campaignName }).from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
  const campaignName = campaignInfo[0]?.campaignName || `Campaign ${campaignId}`;
  const previousAnalysis = await loadPreviousAnalysis(db, accountId, campaignId);
  let rawData = [];
  let dataSource = "cross_dimension";
  const crossDimData = await db.select({
    keywordId: keywordPlacementHourlyPerformance.keywordId,
    targetId: keywordPlacementHourlyPerformance.targetId,
    placement: keywordPlacementHourlyPerformance.placement,
    dayOfWeek: keywordPlacementHourlyPerformance.dayOfWeek,
    hour: keywordPlacementHourlyPerformance.hour,
    date: keywordPlacementHourlyPerformance.date,
    impressions: keywordPlacementHourlyPerformance.impressions,
    clicks: keywordPlacementHourlyPerformance.clicks,
    spend: keywordPlacementHourlyPerformance.spend,
    sales: keywordPlacementHourlyPerformance.sales,
    orders: keywordPlacementHourlyPerformance.orders
  }).from(keywordPlacementHourlyPerformance).where(and(
    eq(keywordPlacementHourlyPerformance.campaignId, String(campaignId)),
    eq(keywordPlacementHourlyPerformance.accountId, accountId),
    gte(keywordPlacementHourlyPerformance.date, startStr),
    lte(keywordPlacementHourlyPerformance.date, endStr)
  ));
  if (crossDimData.length > 0) {
    rawData = crossDimData.map((row) => ({
      keywordId: row.keywordId,
      targetId: row.targetId,
      placement: row.placement,
      dayOfWeek: row.dayOfWeek,
      hour: row.hour,
      date: typeof row.date === "string" ? row.date : String(row.date),
      impressions: row.impressions || 0,
      clicks: row.clicks || 0,
      // @ts-ignore
      spend: String(row.spend || "0"),
      sales: String(row.sales || "0"),
      // @ts-ignore
      orders: row.orders || 0
    }));
    dataSource = "cross_dimension";
    log98.info(`[ComboAnalyzer] Campaign ${campaignName}: \u4F7F\u7528\u4EA4\u53C9\u7EF4\u5EA6\u8868\u6570\u636E (${rawData.length}\u6761)`);
  }
  if (rawData.length === 0) {
    rawData = await synthesizeFromExistingData(db, campaignId, accountId, startStr, endStr);
    dataSource = "synthesized";
    if (rawData.length === 0) {
      log98.info(`[ComboAnalyzer] Campaign ${campaignName}: \u65E0\u4EFB\u4F55\u53EF\u7528\u6570\u636E\uFF0C\u8DF3\u8FC7`);
      return null;
    }
    log98.info(`[ComboAnalyzer] Campaign ${campaignName}: \u4F7F\u7528\u5408\u6210\u6570\u636E (${rawData.length}\u6761)`);
  }
  if (crossDimData.length > 0 && crossDimData.length < 50) {
    const synthesized = await synthesizeFromExistingData(db, campaignId, accountId, startStr, endStr);
    if (synthesized.length > crossDimData.length) {
      const existingKeys = new Set(rawData.map(
        (r) => `${r.keywordId || ""}_${r.targetId || ""}_${r.placement}_${r.dayOfWeek}_${r.hour}_${r.date}`
      ));
      for (const row of synthesized) {
        const key = `${row.keywordId || ""}_${row.targetId || ""}_${row.placement}_${row.dayOfWeek}_${row.hour}_${row.date}`;
        if (!existingKeys.has(key)) {
          rawData.push(row);
        }
      }
      dataSource = "mixed";
      log98.info(`[ComboAnalyzer] Campaign ${campaignName}: \u6DF7\u5408\u6570\u636E (\u4EA4\u53C9:${crossDimData.length} + \u5408\u6210\u8865\u5145, \u603B\u8BA1:${rawData.length}\u6761)`);
    }
  }
  const keywordGroups = /* @__PURE__ */ new Map();
  for (const row of rawData) {
    const key = row.keywordId ? `kw_${row.keywordId}` : row.targetId ? `tgt_${row.targetId}` : null;
    if (!key) continue;
    if (!keywordGroups.has(key)) {
      keywordGroups.set(key, []);
    }
    keywordGroups.get(key).push(row);
  }
  const keywordTexts = /* @__PURE__ */ new Map();
  const keywordIds = [...keywordGroups.keys()].filter((k) => k.startsWith("kw_")).map((k) => parseInt(k.replace("kw_", "")));
  if (keywordIds.length > 0) {
    const kwInfos = await db.select({ id: keywords.id, keywordText: keywords.keywordText }).from(keywords).where(sql`${keywords.id} IN (${sql.join(keywordIds.map((id) => sql`${id}`), sql`, `)})`);
    for (const kw of kwInfos) {
      keywordTexts.set(`kw_${kw.id}`, kw.keywordText);
    }
  }
  const targetIds = [...keywordGroups.keys()].filter((k) => k.startsWith("tgt_")).map((k) => parseInt(k.replace("tgt_", "")));
  if (targetIds.length > 0) {
    const tgtInfos = await db.select({ id: productTargets.id, targetExpression: productTargets.targetExpression }).from(productTargets).where(sql`${productTargets.id} IN (${sql.join(targetIds.map((id) => sql`${id}`), sql`, `)})`);
    for (const tgt of tgtInfos) {
      keywordTexts.set(`tgt_${tgt.id}`, tgt.targetExpression || `Target ${tgt.id}`);
    }
  }
  const allResults = [];
  const categoryChanges = [];
  for (const [key, rows] of keywordGroups) {
    const prevResult = previousAnalysis.get(key);
    const result = analyzeKeywordCombo(
      // @ts-ignore
      key,
      rows,
      keywordTexts.get(key) || key,
      campaignId,
      targetAcos,
      endDate,
      prevResult || null
    );
    result.dataSource = dataSource;
    if (prevResult) {
      result.previousCategory = prevResult.category;
      result.categoryChanged = result.comboCategory !== prevResult.category;
      if (result.categoryChanged) {
        categoryChanges.push({
          keywordText: result.keywordText,
          from: prevResult.category,
          to: result.comboCategory
        });
      }
    }
    allResults.push(result);
  }
  const goldenCombos = allResults.filter((r) => r.comboCategory === "golden");
  const leadenCombos = allResults.filter((r) => r.comboCategory === "leaden");
  const potentialCombos = allResults.filter((r) => r.comboCategory === "potential");
  const standardCombos = allResults.filter((r) => r.comboCategory === "standard");
  const suggestedBudgetMultiplier = calculateCampaignBudgetMultiplier(
    goldenCombos,
    leadenCombos,
    potentialCombos,
    standardCombos,
    targetAcos
  );
  const totalClicks = allResults.reduce((s, r) => s + r.totalClicks, 0);
  const totalOrders = allResults.reduce((s, r) => s + r.totalOrders, 0);
  const overallConfidence = (
    // @ts-ignore
    totalClicks >= 200 && totalOrders >= 20 ? "high" : (
      // @ts-ignore
      totalClicks >= 50 && totalOrders >= 5 ? "medium" : (
        // @ts-ignore
        totalClicks >= 10 ? "low" : "insufficient"
      )
    )
  );
  log98.info(`[ComboAnalyzer] Campaign ${campaignName} [${dataSource}]: ${goldenCombos.length}\u4E2A\u9EC4\u91D1, ${leadenCombos.length}\u4E2A\u94C5\u77F3, ${potentialCombos.length}\u4E2A\u6F5C\u529B, ${standardCombos.length}\u4E2A\u6807\u51C6 (\u7F6E\u4FE1\u5EA6: ${overallConfidence}, \u9884\u7B97\u4E58\u6570: ${suggestedBudgetMultiplier.toFixed(3)}, \u5206\u7C7B\u53D8\u5316: ${categoryChanges.length}\u4E2A)`);
  if (categoryChanges.length > 0) {
    for (const change of categoryChanges.slice(0, 5)) {
      log98.info(`  [\u8FED\u4EE3] "${change.keywordText}": ${change.from} \u2192 ${change.to}`);
    }
    if (categoryChanges.length > 5) {
      log98.info(`  [\u8FED\u4EE3] ...\u8FD8\u6709${categoryChanges.length - 5}\u4E2A\u5206\u7C7B\u53D8\u5316`);
    }
  }
  return {
    campaignId,
    campaignName,
    goldenCombos,
    leadenCombos,
    potentialCombos,
    standardCombos,
    overallConfidence,
    totalKeywordsAnalyzed: allResults.length,
    suggestedBudgetMultiplier,
    dataSource,
    categoryChanges
    // @ts-ignore
  };
}
function analyzeKeywordCombo(key, rows, keywordText, campaignId, targetAcos, referenceDate, prevResult) {
  const keywordId = key.startsWith("kw_") ? parseInt(key.replace("kw_", "")) : null;
  const targetId = key.startsWith("tgt_") ? parseInt(key.replace("tgt_", "")) : null;
  const weightedRows = rows.map((row) => {
    const rowDate = new Date(row.date);
    const daysAgo = Math.floor((referenceDate.getTime() - rowDate.getTime()) / (1e3 * 60 * 60 * 24));
    const weight = getTimeDecayWeight(daysAgo);
    return {
      ...row,
      // @ts-ignore
      weight,
      wSpend: parseFloat(row.spend || "0") * weight,
      // @ts-ignore
      wSales: parseFloat(row.sales || "0") * weight,
      wClicks: (row.clicks || 0) * weight,
      wOrders: (row.orders || 0) * weight,
      // @ts-ignore
      wImpressions: (row.impressions || 0) * weight
      // @ts-ignore
    };
  });
  const placementMap = /* @__PURE__ */ new Map();
  for (const placement of ["top_of_search", "product_page", "rest_of_search"]) {
    const placementRows = weightedRows.filter((r) => r.placement === placement);
    const totalSpend2 = placementRows.reduce((s, r) => s + r.wSpend, 0);
    const totalSales2 = placementRows.reduce((s, r) => s + r.wSales, 0);
    const totalClicks2 = placementRows.reduce((s, r) => s + r.wClicks, 0);
    const totalOrders2 = placementRows.reduce((s, r) => s + r.wOrders, 0);
    placementMap.set(placement, {
      placement,
      // @ts-ignore
      weightedRoas: totalSpend2 > 0 ? totalSales2 / totalSpend2 : 0,
      // @ts-ignore
      weightedAcos: totalSales2 > 0 ? totalSpend2 / totalSales2 * 100 : totalSpend2 > 0 ? 999 : 0,
      // @ts-ignore
      totalSpend: totalSpend2,
      // @ts-ignore
      totalSales: totalSales2,
      // @ts-ignore
      totalClicks: totalClicks2,
      // @ts-ignore
      totalOrders: totalOrders2,
      dataPoints: placementRows.length
    });
  }
  const placementSummaries = [...placementMap.values()];
  const validPlacements = placementSummaries.filter((p) => p.totalClicks >= 3);
  const sortedPlacements = [...validPlacements].sort((a, b) => b.weightedRoas - a.weightedRoas);
  const bestPlacement = sortedPlacements.length > 0 ? sortedPlacements[0].placement : null;
  const worstPlacement = sortedPlacements.length > 1 ? sortedPlacements[sortedPlacements.length - 1].placement : null;
  const timeSlotMap = /* @__PURE__ */ new Map();
  for (const row of weightedRows) {
    const slotKey = `${row.dayOfWeek}_${row.hour}`;
    if (!timeSlotMap.has(slotKey)) {
      timeSlotMap.set(slotKey, { dayOfWeek: row.dayOfWeek, hour: row.hour, wSpend: 0, wSales: 0, wClicks: 0, wOrders: 0, count: 0 });
    }
    const slot = timeSlotMap.get(slotKey);
    slot.wSpend += row.wSpend;
    slot.wSales += row.wSales;
    slot.wClicks += row.wClicks;
    slot.wOrders += row.wOrders;
    slot.count++;
  }
  const timeSlots = [...timeSlotMap.values()];
  const validTimeSlots = timeSlots.filter((t2) => t2.wClicks >= 2);
  const sortedByRoas = [...validTimeSlots].sort((a, b) => {
    const roasA = a.wSpend > 0 ? a.wSales / a.wSpend : 0;
    const roasB = b.wSpend > 0 ? b.wSales / b.wSpend : 0;
    return roasB - roasA;
  });
  const bestTimeWindows = sortedByRoas.slice(0, 5).map((t2) => ({
    dayOfWeek: t2.dayOfWeek,
    startHour: t2.hour,
    endHour: t2.hour,
    avgRoas: t2.wSpend > 0 ? t2.wSales / t2.wSpend : 0,
    avgAcos: t2.wSales > 0 ? t2.wSpend / t2.wSales * 100 : 999,
    // @ts-ignore
    totalSpend: t2.wSpend,
    // @ts-ignore
    totalSales: t2.wSales
  }));
  const worstTimeWindows = sortedByRoas.slice(-5).reverse().map((t2) => ({
    dayOfWeek: t2.dayOfWeek,
    startHour: t2.hour,
    endHour: t2.hour,
    avgRoas: t2.wSpend > 0 ? t2.wSales / t2.wSpend : 0,
    avgAcos: t2.wSales > 0 ? t2.wSpend / t2.wSales * 100 : 999,
    totalSpend: t2.wSpend,
    totalSales: t2.wSales
  }));
  const totalSpend = weightedRows.reduce((s, r) => s + r.wSpend, 0);
  const totalSales = weightedRows.reduce((s, r) => s + r.wSales, 0);
  const totalClicks = weightedRows.reduce((s, r) => s + r.wClicks, 0);
  const totalOrders = weightedRows.reduce((s, r) => s + r.wOrders, 0);
  const overallRoas = totalSpend > 0 ? totalSales / totalSpend : 0;
  const overallAcos = totalSales > 0 ? totalSpend / totalSales * 100 : totalSpend > 0 ? 999 : 0;
  const { category, bidMultiplier: rawBidMult, placementMultiplier: rawPlaceMult, timeMultiplier: rawTimeMult, confidence } = classifyCombo(
    // @ts-ignore
    totalClicks,
    totalOrders,
    totalSpend,
    totalSales,
    overallRoas,
    overallAcos,
    bestPlacement,
    bestTimeWindows,
    targetAcos,
    rows.length
  );
  let bidMultiplier = rawBidMult;
  let placementMultiplier = rawPlaceMult;
  let timeMultiplier = rawTimeMult;
  if (prevResult) {
    bidMultiplier = smoothMultiplier(rawBidMult, prevResult.bidMultiplier, 0.6);
    placementMultiplier = smoothMultiplier(rawPlaceMult, prevResult.placementMultiplier, 0.6);
    timeMultiplier = smoothMultiplier(rawTimeMult, prevResult.timeMultiplier, 0.6);
    bidMultiplier = Math.max(0.8, Math.min(1.2, bidMultiplier));
    placementMultiplier = Math.max(0.85, Math.min(1.15, placementMultiplier));
    timeMultiplier = Math.max(0.85, Math.min(1.15, timeMultiplier));
  }
  return {
    keywordId,
    targetId,
    keywordText,
    campaignId,
    comboCategory: category,
    bestPlacement,
    worstPlacement,
    bestTimeWindows,
    worstTimeWindows,
    placementSummaries,
    suggestedBidMultiplier: bidMultiplier,
    suggestedPlacementMultiplier: placementMultiplier,
    suggestedTimeMultiplier: timeMultiplier,
    // @ts-ignore
    totalClicks: Math.round(totalClicks),
    // @ts-ignore
    totalOrders: Math.round(totalOrders),
    dataPoints: rows.length,
    confidenceLevel: confidence
  };
}
function classifyCombo(totalClicks, totalOrders, totalSpend, totalSales, roas, acos, bestPlacement, bestTimeWindows, targetAcos, dataPoints) {
  const confidence = totalClicks >= 50 && totalOrders >= 8 ? "high" : totalClicks >= 20 && totalOrders >= 3 ? "medium" : totalClicks >= 10 ? "low" : "insufficient";
  const targetRoas = targetAcos > 0 ? 100 / targetAcos : 3.33;
  if (confidence === "insufficient") {
    return {
      category: "potential",
      bidMultiplier: 1,
      placementMultiplier: 1,
      timeMultiplier: 1,
      confidence
    };
  }
  if (roas >= targetRoas * 1.2 && totalOrders >= 3 && confidence !== "low") {
    const roasRatio = Math.min(roas / targetRoas, 3);
    const bidMultiplier2 = Math.min(1.2, 1 + (roasRatio - 1.2) * 0.1);
    const placementMultiplier = bestPlacement ? Math.min(1.15, 1 + (roasRatio - 1) * 0.05) : 1;
    const timeMultiplier = bestTimeWindows.length > 0 ? Math.min(1.15, 1 + (roasRatio - 1) * 0.05) : 1;
    return { category: "golden", bidMultiplier: bidMultiplier2, placementMultiplier, timeMultiplier, confidence };
  }
  const isHighSpendNoConversion = totalSpend >= 5 && totalOrders === 0 && totalClicks >= 15;
  const isHighAcos = acos >= targetAcos * 1.5 && totalClicks >= 15;
  if (isHighSpendNoConversion || isHighAcos) {
    const acosRatio = acos > 0 ? Math.min(acos / targetAcos, 5) : 3;
    const bidMultiplier2 = Math.max(0.8, 1 - (acosRatio - 1.5) * 0.05);
    const placementMultiplier = Math.max(0.85, 1 - (acosRatio - 1.5) * 0.03);
    const timeMultiplier = Math.max(0.85, 1 - (acosRatio - 1.5) * 0.03);
    return { category: "leaden", bidMultiplier: bidMultiplier2, placementMultiplier, timeMultiplier, confidence };
  }
  if (confidence === "low") {
    return {
      category: "potential",
      bidMultiplier: 1,
      placementMultiplier: 1,
      timeMultiplier: 1,
      confidence
    };
  }
  const deviation = (targetAcos - acos) / targetAcos;
  const bidMultiplier = Math.max(0.95, Math.min(1.05, 1 + deviation * 0.05));
  return {
    category: "standard",
    bidMultiplier,
    placementMultiplier: 1,
    timeMultiplier: 1,
    confidence
  };
}
function calculateCampaignBudgetMultiplier(golden, leaden, potential, standard, targetAcos) {
  const allCombos = [...golden, ...leaden, ...potential, ...standard];
  if (allCombos.length === 0) return 1;
  const totalSpend = allCombos.reduce((s, c) => {
    return s + c.placementSummaries.reduce((ps, p) => ps + p.totalSpend, 0);
  }, 0);
  if (totalSpend <= 0) return 1;
  const goldenSpend = golden.reduce((s, c) => {
    return s + c.placementSummaries.reduce((ps, p) => ps + p.totalSpend, 0);
  }, 0);
  const leadenSpend = leaden.reduce((s, c) => {
    return s + c.placementSummaries.reduce((ps, p) => ps + p.totalSpend, 0);
  }, 0);
  const goldenRatio = goldenSpend / totalSpend;
  const leadenRatio = leadenSpend / totalSpend;
  if (goldenRatio > 0.4 && leadenRatio < 0.2) {
    return Math.min(1.15, 1 + (goldenRatio - 0.4) * 0.3);
  }
  if (leadenRatio > 0.4) {
    return Math.max(0.9, 1 - (leadenRatio - 0.4) * 0.2);
  }
  return 1;
}
async function getRealtimeMultipliers(db, campaignId, keywordId, targetId, currentDayOfWeek, currentHour) {
  const conditions = [eq(multiDimComboAnalysis.campaignId, String(campaignId))];
  if (keywordId) {
    conditions.push(eq(multiDimComboAnalysis.keywordId, keywordId));
  } else if (targetId) {
    conditions.push(eq(multiDimComboAnalysis.targetId, targetId));
  }
  const result = await db.select().from(multiDimComboAnalysis).where(and(...conditions)).orderBy(desc(multiDimComboAnalysis.analyzedAt)).limit(1);
  if (result.length === 0) return null;
  const analysis = result[0];
  const baseBidMultiplier = parseFloat(String(analysis.suggestedBidMultiplier || "1.000"));
  const basePlacementMultiplier = parseFloat(String(analysis.suggestedPlacementMultiplier || "1.000"));
  let baseTimeMultiplier = parseFloat(String(analysis.suggestedTimeMultiplier || "1.000"));
  const bestWindows = analysis.bestTimeWindows || [];
  const worstWindows = analysis.worstTimeWindows || [];
  const isInBestWindow = bestWindows.some(
    (w) => w.dayOfWeek === currentDayOfWeek && currentHour >= w.startHour && currentHour <= w.endHour
  );
  const isInWorstWindow = worstWindows.some(
    (w) => w.dayOfWeek === currentDayOfWeek && currentHour >= w.startHour && currentHour <= w.endHour
  );
  if (isInBestWindow) {
    baseTimeMultiplier = Math.min(baseTimeMultiplier * 1.1, 1.2);
  } else if (isInWorstWindow) {
    baseTimeMultiplier = Math.max(baseTimeMultiplier * 0.9, 0.8);
  }
  return {
    bidMultiplier: baseBidMultiplier,
    placementMultiplier: basePlacementMultiplier,
    timeMultiplier: baseTimeMultiplier,
    // @ts-ignore
    comboCategory: analysis.comboCategory,
    // @ts-ignore
    confidence: analysis.confidenceLevel || "insufficient"
  };
}
async function persistAnalysisResults(db, accountId, analysis) {
  const allCombos = [
    ...analysis.goldenCombos,
    ...analysis.leadenCombos,
    ...analysis.potentialCombos,
    ...analysis.standardCombos
  ];
  if (allCombos.length === 0) return 0;
  const now = (/* @__PURE__ */ new Date()).toISOString().replace("T", " ").substring(0, 19);
  const startDate = /* @__PURE__ */ new Date();
  startDate.setDate(startDate.getDate() - 30);
  await db.delete(multiDimComboAnalysis).where(and(
    eq(multiDimComboAnalysis.accountId, accountId),
    eq(multiDimComboAnalysis.campaignId, String(analysis.campaignId))
  ));
  let inserted = 0;
  for (const combo of allCombos) {
    const topOfSearch = combo.placementSummaries.find((p) => p.placement === "top_of_search");
    const productPage = combo.placementSummaries.find((p) => p.placement === "product_page");
    const restOfSearch = combo.placementSummaries.find((p) => p.placement === "rest_of_search");
    try {
      await db.insert(multiDimComboAnalysis).values({
        accountId,
        campaignId: combo.campaignId,
        keywordId: combo.keywordId,
        targetId: combo.targetId,
        keywordText: combo.keywordText.substring(0, 500),
        comboCategory: combo.comboCategory,
        bestPlacement: combo.bestPlacement,
        worstPlacement: combo.worstPlacement,
        bestTimeWindows: combo.bestTimeWindows,
        worstTimeWindows: combo.worstTimeWindows,
        topOfSearchRoas: topOfSearch ? String(topOfSearch.weightedRoas.toFixed(2)) : null,
        topOfSearchAcos: topOfSearch ? String(topOfSearch.weightedAcos.toFixed(4)) : null,
        topOfSearchSpend: topOfSearch ? String(topOfSearch.totalSpend.toFixed(2)) : null,
        topOfSearchSales: topOfSearch ? String(topOfSearch.totalSales.toFixed(2)) : null,
        productPageRoas: productPage ? String(productPage.weightedRoas.toFixed(2)) : null,
        productPageAcos: productPage ? String(productPage.weightedAcos.toFixed(4)) : null,
        productPageSpend: productPage ? String(productPage.totalSpend.toFixed(2)) : null,
        productPageSales: productPage ? String(productPage.totalSales.toFixed(2)) : null,
        restOfSearchRoas: restOfSearch ? String(restOfSearch.weightedRoas.toFixed(2)) : null,
        restOfSearchAcos: restOfSearch ? String(restOfSearch.weightedAcos.toFixed(4)) : null,
        restOfSearchSpend: restOfSearch ? String(restOfSearch.totalSpend.toFixed(2)) : null,
        restOfSearchSales: restOfSearch ? String(restOfSearch.totalSales.toFixed(2)) : null,
        suggestedBidMultiplier: String(combo.suggestedBidMultiplier.toFixed(3)),
        suggestedPlacementMultiplier: String(combo.suggestedPlacementMultiplier.toFixed(3)),
        suggestedTimeMultiplier: String(combo.suggestedTimeMultiplier.toFixed(3)),
        totalClicks: combo.totalClicks,
        totalOrders: combo.totalOrders,
        dataPoints: combo.dataPoints,
        confidenceLevel: combo.confidenceLevel,
        analysisStartDate: startDate.toISOString().split("T")[0],
        analysisEndDate: (/* @__PURE__ */ new Date()).toISOString().split("T")[0],
        analyzedAt: now
      });
      inserted++;
    } catch (err) {
      log98.warn(`[ComboAnalyzer] \u5199\u5165\u5206\u6790\u7ED3\u679C\u5931\u8D25: ${err.message}`);
    }
  }
  log98.info(`[ComboAnalyzer] Campaign ${analysis.campaignName}: \u5199\u5165${inserted}\u6761\u5206\u6790\u7ED3\u679C (\u6570\u636E\u6E90: ${analysis.dataSource})`);
  return inserted;
}
async function executeMultiDimComboAnalysis(db, accountId, campaignIds, config2) {
  const targetAcos = config2.targetAcos || 30;
  const lookbackDays = config2.lookbackDays || 30;
  let campaignsAnalyzed = 0;
  let totalCombosFound = 0;
  let goldenCount = 0;
  let leadenCount = 0;
  let potentialCount = 0;
  let standardCount = 0;
  let totalCategoryChanges = 0;
  const details = [];
  const campaignBudgetMultipliers = /* @__PURE__ */ new Map();
  for (const campaignId of campaignIds) {
    try {
      const analysis = await analyzeCampaignCombos(db, campaignId, accountId, targetAcos, lookbackDays);
      if (!analysis) continue;
      await persistAnalysisResults(db, accountId, analysis);
      campaignsAnalyzed++;
      totalCombosFound += analysis.totalKeywordsAnalyzed;
      goldenCount += analysis.goldenCombos.length;
      leadenCount += analysis.leadenCombos.length;
      potentialCount += analysis.potentialCombos.length;
      standardCount += analysis.standardCombos.length;
      totalCategoryChanges += analysis.categoryChanges.length;
      details.push(analysis);
      campaignBudgetMultipliers.set(campaignId, analysis.suggestedBudgetMultiplier);
    } catch (err) {
      log98.warn(`[ComboAnalyzer] Campaign ${campaignId} \u5206\u6790\u5931\u8D25: ${err.message}`);
    }
  }
  log98.info(`[ComboAnalyzer] \u5206\u6790\u5B8C\u6210: ${campaignsAnalyzed}\u4E2Acampaign, ${totalCombosFound}\u4E2A\u7EC4\u5408 (\u9EC4\u91D1:${goldenCount}, \u94C5\u77F3:${leadenCount}, \u6F5C\u529B:${potentialCount}, \u6807\u51C6:${standardCount}) \u5206\u7C7B\u53D8\u5316:${totalCategoryChanges}\u4E2A`);
  return {
    campaignsAnalyzed,
    totalCombosFound,
    goldenCount,
    leadenCount,
    potentialCount,
    standardCount,
    details,
    campaignBudgetMultipliers,
    totalCategoryChanges
  };
}
async function getComboAnalysisForAccount(db, accountId) {
  const results = await db.select().from(multiDimComboAnalysis).where(eq(multiDimComboAnalysis.accountId, accountId));
  return results;
}
async function getComboAnalysisForCampaign(db, accountId, campaignId) {
  const results = await db.select().from(multiDimComboAnalysis).where(and(
    eq(multiDimComboAnalysis.accountId, accountId),
    eq(multiDimComboAnalysis.campaignId, String(campaignId))
  ));
  return results;
}
async function getCampaignBudgetMultiplier(db, accountId, campaignId) {
  const results = await db.select({
    comboCategory: multiDimComboAnalysis.comboCategory,
    topOfSearchSpend: multiDimComboAnalysis.topOfSearchSpend,
    productPageSpend: multiDimComboAnalysis.productPageSpend,
    restOfSearchSpend: multiDimComboAnalysis.restOfSearchSpend
  }).from(multiDimComboAnalysis).where(and(
    eq(multiDimComboAnalysis.accountId, accountId),
    eq(multiDimComboAnalysis.campaignId, String(campaignId))
  ));
  if (results.length === 0) return 1;
  let totalSpend = 0;
  let goldenSpend = 0;
  let leadenSpend = 0;
  for (const row of results) {
    const spend = parseFloat(String(row.topOfSearchSpend || "0")) + // @ts-ignore
    parseFloat(String(row.productPageSpend || "0")) + // @ts-ignore
    parseFloat(String(row.restOfSearchSpend || "0"));
    totalSpend += spend;
    if (row.comboCategory === "golden") goldenSpend += spend;
    if (row.comboCategory === "leaden") leadenSpend += spend;
  }
  if (totalSpend <= 0) return 1;
  const goldenRatio = goldenSpend / totalSpend;
  const leadenRatio = leadenSpend / totalSpend;
  if (goldenRatio > 0.4 && leadenRatio < 0.2) {
    return Math.min(1.15, 1 + (goldenRatio - 0.4) * 0.3);
  }
  if (leadenRatio > 0.4) {
    return Math.max(0.9, 1 - (leadenRatio - 0.4) * 0.2);
  }
  return 1;
}
var log98;
var init_multiDimComboAnalyzer = __esm({
  "server/optimization/multiDimComboAnalyzer.ts"() {
    "use strict";
    init_logger();
    init_drizzle_orm();
    init_schema2();
    log98 = createModuleLogger("MultiDimCombo");
    __name(getTimeDecayWeight, "getTimeDecayWeight");
    __name(synthesizeFromExistingData, "synthesizeFromExistingData");
    __name(calculatePlacementRatios, "calculatePlacementRatios");
    __name(loadPreviousAnalysis, "loadPreviousAnalysis");
    __name(smoothMultiplier, "smoothMultiplier");
    __name(analyzeCampaignCombos, "analyzeCampaignCombos");
    __name(analyzeKeywordCombo, "analyzeKeywordCombo");
    __name(classifyCombo, "classifyCombo");
    __name(calculateCampaignBudgetMultiplier, "calculateCampaignBudgetMultiplier");
    __name(getRealtimeMultipliers, "getRealtimeMultipliers");
    __name(persistAnalysisResults, "persistAnalysisResults");
    __name(executeMultiDimComboAnalysis, "executeMultiDimComboAnalysis");
    __name(getComboAnalysisForAccount, "getComboAnalysisForAccount");
    __name(getComboAnalysisForCampaign, "getComboAnalysisForCampaign");
    __name(getCampaignBudgetMultiplier, "getCampaignBudgetMultiplier");
  }
});

