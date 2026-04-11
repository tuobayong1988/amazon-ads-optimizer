// Extracted from production dist/index.js
// Original module: server/advancedPlacementService.ts
// Lines: 448

async function getDbInstance13() {
  const db = await getDb();
  if (!db) throw new Error("Database connection failed");
  return db;
}
function calculateEffectiveBids(baseBid, topAdjustment, productAdjustment) {
  return {
    top: baseBid * (1 + topAdjustment / 100),
    product: baseBid * (1 + productAdjustment / 100),
    rest: baseBid
    // rest位置没有调整
  };
}
function estimatePlacementProfit(effectiveBid, impressions, ctr, cvr, aov) {
  const clicks = impressions * ctr;
  const spend = clicks * effectiveBid;
  const orders = clicks * cvr;
  const revenue = orders * aov;
  const profit = revenue - spend;
  return {
    clicks: Math.round(clicks),
    spend: Math.round(spend * 100) / 100,
    revenue: Math.round(revenue * 100) / 100,
    profit: Math.round(profit * 100) / 100
  };
}
function calculateOptimalBaseBid(cvr, aov, targetProfitMargin = 0.3) {
  const breakEvenCpc = cvr * aov;
  const optimalBid = breakEvenCpc * (1 - targetProfitMargin);
  return Math.round(optimalBid * 100) / 100;
}
function calculateOptimalPlacementAdjustments(placementEfficiencies, maxAdjustment = 50) {
  const maxEfficiency = Math.max(
    placementEfficiencies.top,
    placementEfficiencies.product,
    placementEfficiencies.rest
  );
  const topNorm = placementEfficiencies.top / maxEfficiency;
  const productNorm = placementEfficiencies.product / maxEfficiency;
  let topAdjustment = Math.round((topNorm - 0.5) * maxAdjustment * 2);
  let productAdjustment = Math.round((productNorm - 0.5) * maxAdjustment * 2);
  topAdjustment = Math.max(0, Math.min(maxAdjustment, topAdjustment));
  productAdjustment = Math.max(0, Math.min(maxAdjustment, productAdjustment));
  return { topAdjustment, productAdjustment };
}
async function analyzeBidObjectProfit(accountId, campaignId, bidObjectType, bidObjectId, bidObjectText, currentBaseBid, currentTopAdjustment = 0, currentProductAdjustment = 0, placementData) {
  let marketCurve = await getMarketCurveModel(accountId, bidObjectType, bidObjectId);
  if (!marketCurve && bidObjectType === "keyword") {
    marketCurve = await buildMarketCurveForKeyword(
      accountId,
      campaignId,
      parseInt(bidObjectId)
    );
  }
  let prediction;
  if (bidObjectType === "keyword") {
    const wordCount = bidObjectText.split(" ").length;
    let keywordType = "generic";
    const text2 = bidObjectText.toLowerCase();
    if (text2.includes("brand") || text2.includes("official")) {
      keywordType = "brand";
    } else if (wordCount >= 4) {
      keywordType = "product";
    }
    const features = {
      matchType: "broad",
      // 默认
      wordCount,
      keywordType,
      avgBid: currentBaseBid
    };
    prediction = await predictKeywordPerformance(accountId, features);
  }
  const cvr = prediction?.predictedCr || marketCurve?.conversion.cvr || 0.05;
  const aov = prediction?.predictedCv || marketCurve?.conversion.aov || 30;
  const currentEffectiveBids = calculateEffectiveBids(
    currentBaseBid,
    currentTopAdjustment,
    currentProductAdjustment
  );
  const defaultPlacementData = {
    top: { impressions: 1e3, ctr: 0.03 },
    product: { impressions: 800, ctr: 0.02 },
    rest: { impressions: 500, ctr: 0.015 }
  };
  const placement = placementData || defaultPlacementData;
  const currentProfitTop = estimatePlacementProfit(
    currentEffectiveBids.top,
    placement.top.impressions,
    placement.top.ctr,
    cvr,
    aov
  );
  const currentProfitProduct = estimatePlacementProfit(
    currentEffectiveBids.product,
    placement.product.impressions,
    placement.product.ctr,
    cvr,
    aov
  );
  const currentProfitRest = estimatePlacementProfit(
    currentEffectiveBids.rest,
    placement.rest.impressions,
    placement.rest.ctr,
    cvr,
    aov
  );
  const totalCurrentProfit = currentProfitTop.profit + currentProfitProduct.profit + currentProfitRest.profit;
  const recommendedBaseBid = marketCurve?.optimalBid || calculateOptimalBaseBid(cvr, aov);
  const placementEfficiencies = {
    top: currentProfitTop.profit > 0 ? currentProfitTop.revenue / currentProfitTop.spend : 0,
    product: currentProfitProduct.profit > 0 ? currentProfitProduct.revenue / currentProfitProduct.spend : 0,
    rest: currentProfitRest.profit > 0 ? currentProfitRest.revenue / currentProfitRest.spend : 0
  };
  const { topAdjustment: recommendedTopAdjustment, productAdjustment: recommendedProductAdjustment } = calculateOptimalPlacementAdjustments(placementEfficiencies);
  const optimizedEffectiveBids = calculateEffectiveBids(
    recommendedBaseBid,
    recommendedTopAdjustment,
    recommendedProductAdjustment
  );
  const optimizedProfitTop = estimatePlacementProfit(
    optimizedEffectiveBids.top,
    placement.top.impressions,
    placement.top.ctr,
    cvr,
    aov
  );
  const optimizedProfitProduct = estimatePlacementProfit(
    optimizedEffectiveBids.product,
    placement.product.impressions,
    placement.product.ctr,
    cvr,
    aov
  );
  const optimizedProfitRest = estimatePlacementProfit(
    optimizedEffectiveBids.rest,
    placement.rest.impressions,
    placement.rest.ctr,
    cvr,
    aov
  );
  const totalOptimizedProfit = optimizedProfitTop.profit + optimizedProfitProduct.profit + optimizedProfitRest.profit;
  const profitImprovementPotential = totalOptimizedProfit - totalCurrentProfit;
  const profitImprovementPercent = totalCurrentProfit !== 0 ? profitImprovementPotential / Math.abs(totalCurrentProfit) : 0;
  const confidence = Math.min(
    marketCurve?.confidence || 0.5,
    prediction?.confidence || 0.5
  );
  return {
    bidObjectType,
    bidObjectId,
    bidObjectText,
    currentBaseBid,
    currentTopAdjustment,
    currentProductAdjustment,
    effectiveBidTop: currentEffectiveBids.top,
    effectiveBidProduct: currentEffectiveBids.product,
    effectiveBidRest: currentEffectiveBids.rest,
    estimatedProfitTop: currentProfitTop.profit,
    estimatedProfitProduct: currentProfitProduct.profit,
    estimatedProfitRest: currentProfitRest.profit,
    totalEstimatedProfit: totalCurrentProfit,
    recommendedBaseBid,
    recommendedTopAdjustment,
    recommendedProductAdjustment,
    profitImprovementPotential,
    profitImprovementPercent,
    marketCurve: marketCurve || void 0,
    prediction,
    confidence
  };
}
async function analyzeCampaignPlacementProfit(accountId, campaignId) {
  const db = await getDbInstance13();
  const campaignData = await db.select().from(campaigns).where(
    and(
      eq(campaigns.campaignId, campaignId),
      eq(campaigns.accountId, accountId)
    )
  ).limit(1);
  const campaignName = campaignData[0]?.campaignName || campaignId;
  const campaignKeywords = await db.select().from(keywords).where(eq(keywords.keywordStatus, "enabled")).limit(100);
  const startDate = /* @__PURE__ */ new Date();
  startDate.setDate(startDate.getDate() - 30);
  const placementData = await db.select().from(placementPerformance).where(
    and(
      eq(placementPerformance.campaignId, String(campaignId)),
      eq(placementPerformance.accountId, accountId),
      gte(placementPerformance.date, startDate.toISOString().split("T")[0])
    )
  );
  const placementAggregates = {
    top_of_search: { impressions: 0, clicks: 0, spend: 0, sales: 0, orders: 0 },
    product_page: { impressions: 0, clicks: 0, spend: 0, sales: 0, orders: 0 },
    rest_of_search: { impressions: 0, clicks: 0, spend: 0, sales: 0, orders: 0 }
  };
  for (const row of placementData) {
    const placement = row.placement;
    if (placementAggregates[placement]) {
      placementAggregates[placement].impressions += row.impressions || 0;
      placementAggregates[placement].clicks += row.clicks || 0;
      placementAggregates[placement].spend += Number(row.spend) || 0;
      placementAggregates[placement].sales += Number(row.sales) || 0;
      placementAggregates[placement].orders += row.orders || 0;
    }
  }
  const bidObjectAnalyses = [];
  for (const kw of campaignKeywords.slice(0, 50)) {
    const analysis = await analyzeBidObjectProfit(
      accountId,
      campaignId,
      "keyword",
      String(kw.id),
      kw.keywordText,
      Number(kw.bid) || 1,
      0,
      // 当前位置调整（需要从设置中获取）
      // @ts-ignore
      0
      // @ts-ignore
    );
    bidObjectAnalyses.push(analysis);
  }
  const totalCurrentProfit = bidObjectAnalyses.reduce((sum2, a) => sum2 + a.totalEstimatedProfit, 0);
  const totalOptimizedProfit = bidObjectAnalyses.reduce((sum2, a) => sum2 + a.totalEstimatedProfit + a.profitImprovementPotential, 0);
  const calculatePlacementSummary = /* @__PURE__ */ __name((data) => {
    const revenue = data.sales;
    const spend = data.spend;
    const profit = revenue - spend;
    const roas = spend > 0 ? revenue / spend : 0;
    const acos = revenue > 0 ? spend / revenue : 1;
    const efficiency = roas;
    return {
      totalSpend: spend,
      totalRevenue: revenue,
      totalProfit: profit,
      avgROAS: roas,
      avgACoS: acos,
      efficiency,
      recommendedWeight: 0
      // 将在后面计算
    };
  }, "calculatePlacementSummary");
  const placementSummary = {
    topOfSearch: calculatePlacementSummary(placementAggregates.top_of_search),
    productPage: calculatePlacementSummary(placementAggregates.product_page),
    restOfSearch: calculatePlacementSummary(placementAggregates.rest_of_search)
  };
  const totalEfficiency = placementSummary.topOfSearch.efficiency + placementSummary.productPage.efficiency + placementSummary.restOfSearch.efficiency;
  if (totalEfficiency > 0) {
    placementSummary.topOfSearch.recommendedWeight = placementSummary.topOfSearch.efficiency / totalEfficiency;
    placementSummary.productPage.recommendedWeight = placementSummary.productPage.efficiency / totalEfficiency;
    placementSummary.restOfSearch.recommendedWeight = placementSummary.restOfSearch.efficiency / totalEfficiency;
  }
  const placementEfficiencies = {
    top: placementSummary.topOfSearch.efficiency,
    product: placementSummary.productPage.efficiency,
    rest: placementSummary.restOfSearch.efficiency
  };
  const { topAdjustment, productAdjustment } = calculateOptimalPlacementAdjustments(placementEfficiencies);
  const recommendations = [];
  if (topAdjustment > 0 || productAdjustment > 0) {
    recommendations.push({
      type: "placement_adjustment",
      priority: "high",
      title: "\u4F18\u5316\u5C55\u793A\u4F4D\u7F6E\u8C03\u6574",
      description: `\u57FA\u4E8E\u667A\u80FD\u4F18\u5316\u7B56\u7565\uFF0C\u5EFA\u8BAE\u5C06\u641C\u7D22\u9876\u90E8\u8C03\u6574\u8BBE\u4E3A${topAdjustment}%\uFF0C\u5546\u54C1\u8BE6\u60C5\u9875\u8C03\u6574\u8BBE\u4E3A${productAdjustment}%\u3002\u8F83\u4F4E\u7684\u4F4D\u7F6E\u8C03\u6574\u503C\u53EF\u4EE5\u8BA9\u57FA\u7840\u51FA\u4EF7\u66F4\u7CBE\u786E\u5730\u63A7\u5236\u5B9E\u9645\u7ADE\u4EF7\u3002`,
      // @ts-ignore
      expectedImpact: `\u9884\u8BA1\u63D0\u5347\u5229\u6DA6${Math.round(totalOptimizedProfit - totalCurrentProfit)}\u7F8E\u5143`,
      currentValue: { topOfSearch: 0, productPage: 0 },
      recommendedValue: { topOfSearch: topAdjustment, productPage: productAdjustment },
      // @ts-ignore
      expectedProfitChange: totalOptimizedProfit - totalCurrentProfit
    });
  }
  const bidImprovements = bidObjectAnalyses.filter((a) => a.profitImprovementPercent > 0.1);
  if (bidImprovements.length > 0) {
    recommendations.push({
      type: "bid_adjustment",
      priority: "medium",
      title: `\u4F18\u5316${bidImprovements.length}\u4E2A\u5173\u952E\u8BCD\u7684\u57FA\u7840\u51FA\u4EF7`,
      description: `\u53D1\u73B0${bidImprovements.length}\u4E2A\u5173\u952E\u8BCD\u7684\u5F53\u524D\u51FA\u4EF7\u504F\u79BB\u6700\u4F18\u503C\uFF0C\u8C03\u6574\u540E\u53EF\u63D0\u5347\u5229\u6DA6\u3002`,
      // @ts-ignore
      expectedImpact: `\u9884\u8BA1\u63D0\u5347\u5229\u6DA6${Math.round(bidImprovements.reduce((sum2, a) => sum2 + a.profitImprovementPotential, 0))}\u7F8E\u5143`,
      currentValue: bidImprovements.map((a) => ({ id: a.bidObjectId, bid: a.currentBaseBid })),
      recommendedValue: bidImprovements.map((a) => ({ id: a.bidObjectId, bid: a.recommendedBaseBid })),
      // @ts-ignore
      expectedProfitChange: bidImprovements.reduce((sum2, a) => sum2 + a.profitImprovementPotential, 0)
    });
  }
  const lowConfidenceCount = bidObjectAnalyses.filter((a) => a.confidence < 0.5).length;
  if (lowConfidenceCount > bidObjectAnalyses.length * 0.3) {
    recommendations.push({
      type: "data_collection",
      priority: "low",
      title: "\u6536\u96C6\u66F4\u591A\u6570\u636E\u4EE5\u63D0\u9AD8\u9884\u6D4B\u51C6\u786E\u6027",
      // @ts-ignore
      description: `${lowConfidenceCount}\u4E2A\u5173\u952E\u8BCD\u7684\u6570\u636E\u7F6E\u4FE1\u5EA6\u8F83\u4F4E\uFF0C\u5EFA\u8BAE\u4FDD\u6301\u5F53\u524D\u51FA\u4EF7\u4E00\u6BB5\u65F6\u95F4\u4EE5\u6536\u96C6\u66F4\u591A\u6570\u636E\u3002`,
      // @ts-ignore
      expectedImpact: "\u63D0\u9AD8\u540E\u7EED\u4F18\u5316\u5EFA\u8BAE\u7684\u51C6\u786E\u6027",
      // @ts-ignore
      currentValue: { lowConfidenceCount },
      recommendedValue: { targetConfidence: 0.7 },
      expectedProfitChange: 0
    });
  }
  return {
    campaignId,
    campaignName,
    totalBidObjects: bidObjectAnalyses.length,
    // @ts-ignore
    totalCurrentProfit,
    // @ts-ignore
    totalOptimizedProfit,
    // @ts-ignore
    totalProfitImprovement: totalOptimizedProfit - totalCurrentProfit,
    placementSummary,
    recommendedAdjustments: {
      topOfSearch: topAdjustment,
      productPage: productAdjustment
    },
    bidObjectAnalyses,
    recommendations
  };
}
async function applyOptimizationRecommendation(recommendationId, userId) {
  const db = await getDbInstance13();
  const recommendation = await db.select().from(optimizationRecommendations).where(eq(optimizationRecommendations.id, recommendationId)).limit(1);
  if (recommendation.length === 0) {
    return { success: false, message: "\u672A\u627E\u5230\u4F18\u5316\u5EFA\u8BAE" };
  }
  const rec = recommendation[0];
  if (rec.status !== "pending") {
    return { success: false, message: "\u8BE5\u5EFA\u8BAE\u5DF2\u88AB\u5904\u7406" };
  }
  try {
    switch (rec.recommendationType) {
      case "placement_adjustment":
        const adjustmentValues = rec.recommendedValue;
        await db.update(placementSettings).set({
          topOfSearchAdjustment: adjustmentValues.topOfSearch,
          productPageAdjustment: adjustmentValues.productPage,
          lastAdjustedAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ")
        }).where(
          and(
            // @ts-ignore
            eq(placementSettings.campaignId, String(rec.campaignId)),
            // @ts-ignore
            eq(placementSettings.accountId, rec.accountId)
          )
        );
        break;
      case "bid_adjustment":
        const bidValues = rec.recommendedValue;
        for (const bv of bidValues) {
          await db.update(keywords).set({ bid: String(bv.bid) }).where(eq(keywords.id, parseInt(bv.id)));
        }
        break;
      default:
        break;
    }
    await db.update(optimizationRecommendations).set({
      status: "applied",
      appliedAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " "),
      appliedBy: userId
    }).where(eq(optimizationRecommendations.id, recommendationId));
    return { success: true, message: "\u4F18\u5316\u5EFA\u8BAE\u5DF2\u6210\u529F\u5E94\u7528" };
  } catch (error48) {
    return {
      success: false,
      message: `\u5E94\u7528\u5931\u8D25: ${error48 instanceof Error ? error48.message : "\u672A\u77E5\u9519\u8BEF"}`
    };
  }
}
async function getPendingRecommendations(accountId, campaignId) {
  const db = await getDbInstance13();
  let query = db.select().from(optimizationRecommendations).where(
    and(
      eq(optimizationRecommendations.accountId, accountId),
      eq(optimizationRecommendations.status, "pending")
    )
  ).orderBy(desc(optimizationRecommendations.createdAt));
  const results = await query;
  return results.filter((r) => !campaignId || r.campaignId === campaignId).map((r) => ({
    id: r.id,
    type: r.recommendationType,
    priority: r.priority || "medium",
    title: r.title || "",
    description: r.description || "",
    expectedProfitChange: Number(r.expectedProfitChange) || 0,
    createdAt: r.createdAt || (/* @__PURE__ */ new Date()).toISOString()
  }));
}
async function generateProfitVisualizationData(accountId, bidObjectType, bidObjectId) {
  const model = await getMarketCurveModel(accountId, bidObjectType, bidObjectId);
  if (!model) {
    return null;
  }
  const curveData = generateProfitCurveData(
    model.impressionCurve,
    model.ctrCurve,
    model.conversion,
    0.1,
    model.breakEvenCpc * 1.5,
    50
  );
  return {
    profitCurve: curveData.map((d) => ({
      cpc: d.cpc,
      profit: d.profit,
      roas: d.roas,
      acos: d.acos
    })),
    optimalPoint: {
      cpc: model.optimalBid,
      profit: model.maxProfit
    },
    currentPoint: {
      cpc: 0,
      // 需要从外部传入
      profit: 0
    },
    breakEvenPoint: {
      cpc: model.breakEvenCpc
    }
  };
}
var init_advancedPlacementService = __esm({
  "server/advancedPlacementService.ts"() {
    "use strict";
    init_db2();
    init_schema2();
    init_drizzle_orm();
    init_marketCurveService();
    init_decisionTreeService();
    __name(getDbInstance13, "getDbInstance");
    __name(calculateEffectiveBids, "calculateEffectiveBids");
    __name(estimatePlacementProfit, "estimatePlacementProfit");
    __name(calculateOptimalBaseBid, "calculateOptimalBaseBid");
    __name(calculateOptimalPlacementAdjustments, "calculateOptimalPlacementAdjustments");
    __name(analyzeBidObjectProfit, "analyzeBidObjectProfit");
    __name(analyzeCampaignPlacementProfit, "analyzeCampaignPlacementProfit");
    __name(applyOptimizationRecommendation, "applyOptimizationRecommendation");
    __name(getPendingRecommendations, "getPendingRecommendations");
    __name(generateProfitVisualizationData, "generateProfitVisualizationData");
  }
});

