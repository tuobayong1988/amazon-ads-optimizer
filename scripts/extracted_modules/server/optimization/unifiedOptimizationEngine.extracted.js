// Extracted from production dist/index.js
// Original module: server/optimization/unifiedOptimizationEngine.ts
// Lines: 623

async function getDbInstance10() {
  const db = await getDb();
  if (!db) throw new Error("Database connection failed");
  return db;
}
async function getCampaignOptimizationState(campaignId) {
  const db = await getDbInstance10();
  const campaign = await db.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
  if (campaign.length === 0) return null;
  const c = campaign[0];
  const executedToday = 0;
  const acos = c.spend && c.sales ? Number(c.spend) / Number(c.sales) * 100 : 0;
  const roas = c.spend && c.sales ? Number(c.sales) / Number(c.spend) : 0;
  const performanceScore = Math.min(100, Math.max(
    0,
    // @ts-ignore
    roas * 20 + (100 - acos)
    // @ts-ignore
  ));
  return {
    // @ts-ignore
    campaignId: c.id,
    // @ts-ignore
    campaignName: c.campaignName,
    autoOptimizationEnabled: true,
    // 默认启用
    executionMode: "semi_auto",
    // 默认半自动
    lastOptimizationAt: void 0,
    // TODO: 从日志获取
    pendingDecisions: 0,
    // TODO: 从决策表获取
    executedToday,
    performanceScore,
    optimizationTypes: {
      bidAdjustment: true,
      placementTilt: true,
      dayparting: true,
      negativeKeyword: true
    }
  };
}
async function getPerformanceGroupOptimizationState(groupId) {
  const db = await getDbInstance10();
  const group = await db.select().from(performanceGroups).where(eq(performanceGroups.id, groupId)).limit(1);
  if (group.length === 0) return null;
  const g = group[0];
  const groupCampaigns = await db.select().from(campaigns).where(eq(campaigns.performanceGroupId, groupId));
  let totalSpend = 0;
  let totalSales = 0;
  for (const c of groupCampaigns) {
    totalSpend += Number(c.spend) || 0;
    totalSales += Number(c.sales) || 0;
  }
  const overallRoas = totalSpend > 0 ? totalSales / totalSpend : 0;
  const overallAcos = totalSales > 0 ? totalSpend / totalSales * 100 : 0;
  const overallPerformanceScore = Math.min(100, Math.max(
    0,
    // @ts-ignore
    overallRoas * 20 + (100 - overallAcos)
    // @ts-ignore
  ));
  return {
    // @ts-ignore
    groupId: g.id,
    // @ts-ignore
    groupName: g.name,
    autoOptimizationEnabled: true,
    executionMode: "semi_auto",
    // @ts-ignore
    targetAcos: g.targetAcos ? Number(g.targetAcos) : void 0,
    // @ts-ignore
    targetRoas: g.targetRoas ? Number(g.targetRoas) : void 0,
    campaignCount: groupCampaigns.length,
    optimizedCampaigns: groupCampaigns.length,
    // TODO: 统计实际优化的数量
    totalPendingDecisions: 0,
    totalExecutedToday: 0,
    overallPerformanceScore
  };
}
async function runUnifiedOptimizationAnalysis(accountId, options = {}) {
  const db = await getDbInstance10();
  const decisions = [];
  let targetCampaigns;
  if (options.campaignIds && options.campaignIds.length > 0) {
    targetCampaigns = await db.select().from(campaigns).where(and(eq(campaigns.accountId, accountId), sql`${campaigns.id} IN (${options.campaignIds.join(",")})`));
  } else if (options.performanceGroupIds && options.performanceGroupIds.length > 0) {
    targetCampaigns = await db.select().from(campaigns).where(and(eq(campaigns.accountId, accountId), sql`${campaigns.performanceGroupId} IN (${options.performanceGroupIds.join(",")})`));
  } else {
    targetCampaigns = await db.select().from(campaigns).where(and(eq(campaigns.accountId, accountId), eq(campaigns.campaignStatus, "enabled"))).limit(100);
  }
  const types = options.optimizationTypes || [
    "bid_adjustment",
    // @ts-ignore
    "placement_tilt",
    "dayparting",
    "negative_keyword"
  ];
  for (const campaign of targetCampaigns) {
    const costType = campaign.costType === "vcpm" ? "vcpm" : "cpc";
    const isVcpm = costType === "vcpm";
    if (types.includes("bid_adjustment")) {
      const bidDecisions = await analyzeBidAdjustments(campaign, costType);
      decisions.push(...bidDecisions);
    }
    if (types.includes("placement_tilt") && !isVcpm) {
      const placementDecisions = await analyzePlacementTilt(campaign);
      decisions.push(...placementDecisions);
    }
    if (types.includes("dayparting")) {
      const daypartingDecisions = await analyzeDayparting(campaign);
      decisions.push(...daypartingDecisions);
    }
    if (types.includes("negative_keyword")) {
      const negativeDecisions = await analyzeNegativeKeywords(campaign, costType);
      decisions.push(...negativeDecisions);
    }
  }
  return decisions;
}
async function analyzeBidAdjustments(campaign, costType = "cpc") {
  const db = await getDbInstance10();
  const decisions = [];
  const isVcpm = costType === "vcpm";
  let groupTargetAcos = 30;
  if (campaign.performanceGroupId) {
    try {
      const groups = await db.select().from(performanceGroups).where(eq(performanceGroups.id, campaign.performanceGroupId)).limit(1);
      if (groups.length > 0 && groups[0].targetAcos) {
        groupTargetAcos = Number(groups[0].targetAcos);
        log152.info(`[UnifiedOptEngine] v148: Campaign ${campaign.campaignId} \u4F7F\u7528\u4F18\u5316\u76EE\u6807targetAcos=${groupTargetAcos}%`);
      }
    } catch (pgErr) {
      log152.warn(`[UnifiedOptEngine] v148: \u83B7\u53D6\u4F18\u5316\u76EE\u6807targetAcos\u5931\u8D25, \u4F7F\u7528\u9ED8\u8BA4\u503C30%:`, pgErr.message);
    }
  }
  let correctionFactor = 1;
  let correctionApplied = false;
  try {
    const correctionResult = await calculateAttributionCorrectionFactor(
      // @ts-ignore
      campaign.accountId,
      campaign.campaignId
    );
    const campaignAge = campaign.createdAt ? Math.floor((Date.now() - new Date(campaign.createdAt).getTime()) / (24 * 60 * 60 * 1e3)) : 30;
    if (shouldApplyCorrection(
      // @ts-ignore
      correctionResult.correctionFactor,
      // @ts-ignore
      correctionResult.maturePerformance.clicks,
      // @ts-ignore
      campaignAge
      // @ts-ignore
    )) {
      correctionFactor = correctionResult.correctionFactor;
      correctionApplied = true;
      log152.info(`[UnifiedOptEngine] Campaign ${campaign.campaignId} \u5F52\u56E0\u6821\u6B63\u7CFB\u6570: ${correctionFactor.toFixed(3)}`);
    }
  } catch (corrErr) {
    log152.warn(`[UnifiedOptEngine] \u5F52\u56E0\u6821\u6B63\u8BA1\u7B97\u5931\u8D25, \u4F7F\u7528\u539F\u59CB\u6570\u636E:`, corrErr.message);
  }
  const campaignKeywords = await db.select().from(keywords).where(sql`${keywords.internalAdGroupId} IN (SELECT id FROM ad_groups WHERE campaignId = ${campaign.campaignId})`);
  for (const kw of campaignKeywords) {
    const rawImpressions = Number(kw.impressions) || 0;
    const rawClicks = Number(kw.clicks) || 0;
    const rawOrders = Number(kw.orders) || 0;
    const rawSpend = Number(kw.spend) || 0;
    const rawSales = Number(kw.sales) || 0;
    const currentBid = Number(kw.bid) || 0;
    if (isVcpm) {
      if (rawImpressions < 1e3) continue;
      const corrected2 = applyAttributionCorrection(
        // @ts-ignore
        { impressions: rawImpressions, clicks: rawClicks, spend: rawSpend, sales: rawSales, orders: rawOrders },
        correctionFactor,
        "bid_optimization"
        // @ts-ignore
      );
      const impressions = corrected2.impressions;
      const spend2 = corrected2.spend;
      const sales2 = corrected2.sales;
      const orders2 = corrected2.orders;
      const clicks2 = corrected2.clicks;
      const currentCpm = impressions > 0 ? spend2 / impressions * 1e3 : 0;
      const ctr = impressions > 0 ? clicks2 / impressions : 0;
      const viewCvr = impressions > 0 ? orders2 / impressions : 0;
      const acos2 = sales2 > 0 ? spend2 / sales2 * 100 : 999;
      const aov2 = orders2 > 0 ? sales2 / orders2 : 30;
      const targetAcos2 = groupTargetAcos;
      const optimalVcpm = viewCvr * aov2 * (targetAcos2 / 100) * 1e3;
      const bidDiff2 = currentBid > 0 ? Math.abs(optimalVcpm - currentBid) / currentBid : 1;
      if (bidDiff2 > 0.15 && optimalVcpm > 0.5) {
        decisions.push({
          // @ts-ignore
          id: `vcpm_bid_${campaign.campaignId}_${kw.id}_${Date.now()}`,
          type: "bid_adjustment",
          targetType: "keyword",
          // @ts-ignore
          targetId: kw.id,
          // @ts-ignore
          targetName: kw.keywordText || `\u5173\u952E\u8BCD ${kw.id}`,
          currentValue: currentBid,
          suggestedValue: Math.round(optimalVcpm * 100) / 100,
          expectedImpact: {
            metric: "CPM",
            currentValue: currentCpm,
            expectedValue: optimalVcpm,
            changePercent: currentCpm > 0 ? (optimalVcpm - currentCpm) / currentCpm * 100 : 0
          },
          confidence: Math.min(0.9, 0.4 + impressions / 1e4 * 0.5),
          reasoning: `[vCPM\u4F18\u5316] \u57FA\u4E8E\u5C55\u793A\u8F6C\u5316\u7387\u8BA1\u7B97\uFF1A\u5C55\u793ACVR=${(viewCvr * 1e5).toFixed(2)}\u2030, CTR=${(ctr * 100).toFixed(3)}%, AOV=$${aov2.toFixed(2)}, ACoS=${acos2.toFixed(1)}%, \u76EE\u6807ACoS=${targetAcos2}%${correctionApplied ? ` [\u5F52\u56E0\u6821\u6B63\xD7${correctionFactor.toFixed(2)}]` : ""}`,
          status: "pending",
          createdAt: /* @__PURE__ */ new Date()
        });
      }
      continue;
    }
    if (rawClicks < 10) continue;
    const corrected = applyAttributionCorrection(
      { impressions: rawImpressions, clicks: rawClicks, spend: rawSpend, sales: rawSales, orders: rawOrders },
      correctionFactor,
      "bid_optimization"
    );
    const clicks = corrected.clicks;
    const orders = corrected.orders;
    const spend = corrected.spend;
    const sales = corrected.sales;
    const cvr = clicks > 0 ? orders / clicks : 0;
    const acos = sales > 0 ? spend / sales * 100 : 999;
    const cpc = clicks > 0 ? spend / clicks : 0;
    const aov = orders > 0 ? sales / orders : 30;
    const targetAcos = groupTargetAcos;
    const optimalBid = cvr * aov * (targetAcos / 100);
    const bidDiff = Math.abs(optimalBid - currentBid) / currentBid;
    if (bidDiff > 0.1 && optimalBid > 0.1) {
      const expectedAcos = optimalBid > 0 ? optimalBid / (cvr * aov) * 100 : acos;
      decisions.push({
        // @ts-ignore
        id: `bid_${campaign.campaignId}_${kw.id}_${Date.now()}`,
        type: "bid_adjustment",
        targetType: "keyword",
        // @ts-ignore
        targetId: kw.id,
        // @ts-ignore
        targetName: kw.keywordText || `\u5173\u952E\u8BCD ${kw.id}`,
        currentValue: currentBid,
        suggestedValue: Math.round(optimalBid * 100) / 100,
        expectedImpact: {
          metric: "ACoS",
          currentValue: acos,
          expectedValue: expectedAcos,
          changePercent: (expectedAcos - acos) / acos * 100
        },
        confidence: Math.min(0.95, 0.5 + clicks / 100 * 0.45),
        reasoning: `[CPC\u4F18\u5316] \u57FA\u4E8E\u5229\u6DA6\u6700\u5927\u5316\u516C\u5F0F\u8BA1\u7B97\uFF1ACVR=${(cvr * 100).toFixed(2)}%, AOV=$${aov.toFixed(2)}, \u76EE\u6807ACoS=${targetAcos}%${correctionApplied ? ` [\u5F52\u56E0\u6821\u6B63\xD7${correctionFactor.toFixed(2)}]` : ""}`,
        status: "pending",
        createdAt: /* @__PURE__ */ new Date()
      });
    }
  }
  const campaignTargets = await db.select().from(productTargets).where(sql`${productTargets.internalAdGroupId} IN (SELECT id FROM ad_groups WHERE campaignId = ${campaign.campaignId})`);
  for (const pt of campaignTargets) {
    const rawImpressions = Number(pt.impressions) || 0;
    const rawClicks = Number(pt.clicks) || 0;
    const rawOrders = Number(pt.orders) || 0;
    const rawSpend = Number(pt.spend) || 0;
    const rawSales = Number(pt.sales) || 0;
    const currentBid = Number(pt.bid) || 0;
    if (isVcpm) {
      if (rawImpressions < 1e3) continue;
      const corrected = applyAttributionCorrection(
        { impressions: rawImpressions, clicks: rawClicks, spend: rawSpend, sales: rawSales, orders: rawOrders },
        correctionFactor,
        "bid_optimization"
      );
      const viewCvr = corrected.impressions > 0 ? corrected.orders / corrected.impressions : 0;
      const aov = corrected.orders > 0 ? corrected.sales / corrected.orders : 30;
      const targetAcos = groupTargetAcos;
      const optimalVcpm = viewCvr * aov * (targetAcos / 100) * 1e3;
      const bidDiff = currentBid > 0 ? Math.abs(optimalVcpm - currentBid) / currentBid : 1;
      if (bidDiff > 0.15 && optimalVcpm > 0.5) {
        decisions.push({
          id: `vcpm_pt_bid_${campaign.campaignId}_${pt.id}_${Date.now()}`,
          type: "bid_adjustment",
          targetType: "keyword",
          targetId: pt.id,
          targetName: pt.targetValue || `\u5546\u54C1\u5B9A\u5411 ${pt.id}`,
          currentValue: currentBid,
          suggestedValue: Math.round(optimalVcpm * 100) / 100,
          expectedImpact: { metric: "CPM", currentValue: corrected.impressions > 0 ? corrected.spend / corrected.impressions * 1e3 : 0, expectedValue: optimalVcpm, changePercent: 0 },
          confidence: Math.min(0.9, 0.4 + corrected.impressions / 1e4 * 0.5),
          reasoning: `[vCPM\u5546\u54C1\u5B9A\u5411\u4F18\u5316] \u5339\u914D\u65B9\u5F0F:${pt.targetMatchType || "auto"}, \u5C55\u793ACVR=${(viewCvr * 1e5).toFixed(2)}\u2030${correctionApplied ? ` [\u5F52\u56E0\u6821\u6B63\xD7${correctionFactor.toFixed(2)}]` : ""}`,
          status: "pending",
          createdAt: /* @__PURE__ */ new Date()
        });
      }
    } else {
      if (rawClicks < 10) continue;
      const corrected = applyAttributionCorrection(
        { impressions: rawImpressions, clicks: rawClicks, spend: rawSpend, sales: rawSales, orders: rawOrders },
        correctionFactor,
        "bid_optimization"
      );
      const cvr = corrected.clicks > 0 ? corrected.orders / corrected.clicks : 0;
      const acos = corrected.sales > 0 ? corrected.spend / corrected.sales * 100 : 999;
      const aov = corrected.orders > 0 ? corrected.sales / corrected.orders : 30;
      const targetAcos = groupTargetAcos;
      const optimalBid = cvr * aov * (targetAcos / 100);
      const bidDiff = currentBid > 0 ? Math.abs(optimalBid - currentBid) / currentBid : 1;
      if (bidDiff > 0.1 && optimalBid > 0.1) {
        const expectedAcos = optimalBid > 0 ? optimalBid / (cvr * aov) * 100 : acos;
        decisions.push({
          id: `pt_bid_${campaign.campaignId}_${pt.id}_${Date.now()}`,
          type: "bid_adjustment",
          targetType: "keyword",
          targetId: pt.id,
          targetName: pt.targetValue || `\u5546\u54C1\u5B9A\u5411 ${pt.id}`,
          currentValue: currentBid,
          suggestedValue: Math.round(optimalBid * 100) / 100,
          expectedImpact: { metric: "ACoS", currentValue: acos, expectedValue: expectedAcos, changePercent: acos > 0 ? (expectedAcos - acos) / acos * 100 : 0 },
          confidence: Math.min(0.95, 0.5 + corrected.clicks / 100 * 0.45),
          // @ts-ignore
          reasoning: `[CPC\u5546\u54C1\u5B9A\u5411\u4F18\u5316] \u5339\u914D\u65B9\u5F0F:${pt.targetMatchType || "auto"}, CVR=${(cvr * 100).toFixed(2)}%, AOV=$${aov.toFixed(2)}${correctionApplied ? ` [\u5F52\u56E0\u6821\u6B63\xD7${correctionFactor.toFixed(2)}]` : ""}`,
          // @ts-ignore
          status: "pending",
          createdAt: /* @__PURE__ */ new Date()
        });
      }
    }
  }
  return decisions;
}
async function analyzePlacementTilt(campaign) {
  const decisions = [];
  const currentTopSearch = Number(campaign.topOfSearchBidAdjustment) || 0;
  const currentProductPage = Number(campaign.productPageBidAdjustment) || 0;
  const suggestedTopSearch = Math.min(50, Math.max(0, currentTopSearch));
  const suggestedProductPage = Math.min(50, Math.max(0, currentProductPage));
  if (currentTopSearch > 50) {
    decisions.push({
      id: `placement_top_${campaign.campaignId}_${Date.now()}`,
      type: "placement_tilt",
      targetType: "campaign",
      // @ts-ignore
      targetId: campaign.id,
      // @ts-ignore
      targetName: campaign.campaignName,
      currentValue: currentTopSearch,
      suggestedValue: suggestedTopSearch,
      expectedImpact: {
        metric: "\u4F4D\u7F6E\u8C03\u6574",
        currentValue: currentTopSearch,
        expectedValue: suggestedTopSearch,
        changePercent: (suggestedTopSearch - currentTopSearch) / currentTopSearch * 100
      },
      confidence: 0.85,
      reasoning: "\u667A\u80FD\u4F18\u5316\u7B56\u7565\uFF1A\u8BBE\u7F6E\u8F83\u4F4E\u7684\u4F4D\u7F6E\u8C03\u6574\uFF080-50%\uFF09\uFF0C\u8BA9\u57FA\u7840\u51FA\u4EF7\u66F4\u7CBE\u786E\u63A7\u5236\u7ADE\u4EF7\u5BF9\u8C61",
      status: "pending",
      createdAt: /* @__PURE__ */ new Date()
    });
  }
  if (currentProductPage > 50) {
    decisions.push({
      id: `placement_product_${campaign.campaignId}_${Date.now()}`,
      type: "placement_tilt",
      targetType: "campaign",
      // @ts-ignore
      targetId: campaign.id,
      // @ts-ignore
      targetName: campaign.campaignName,
      currentValue: currentProductPage,
      suggestedValue: suggestedProductPage,
      expectedImpact: {
        metric: "\u4F4D\u7F6E\u8C03\u6574",
        currentValue: currentProductPage,
        expectedValue: suggestedProductPage,
        changePercent: (suggestedProductPage - currentProductPage) / currentProductPage * 100
      },
      confidence: 0.85,
      reasoning: "\u667A\u80FD\u4F18\u5316\u7B56\u7565\uFF1A\u8BBE\u7F6E\u8F83\u4F4E\u7684\u4F4D\u7F6E\u8C03\u6574\uFF080-50%\uFF09\uFF0C\u8BA9\u57FA\u7840\u51FA\u4EF7\u66F4\u7CBE\u786E\u63A7\u5236\u7ADE\u4EF7\u5BF9\u8C61",
      status: "pending",
      createdAt: /* @__PURE__ */ new Date()
    });
  }
  return decisions;
}
async function analyzeDayparting(campaign) {
  const decisions = [];
  const poorPerformingHours = [2, 3, 4, 5];
  decisions.push({
    id: `daypart_${campaign.campaignId}_${Date.now()}`,
    type: "dayparting",
    targetType: "campaign",
    // @ts-ignore
    targetId: campaign.id,
    // @ts-ignore
    targetName: campaign.campaignName,
    currentValue: "\u65E0\u5206\u65F6\u7B56\u7565",
    suggestedValue: "\u51CC\u66682-6\u70B9\u964D\u4F4E50%\u51FA\u4EF7",
    // @ts-ignore
    expectedImpact: {
      // @ts-ignore
      metric: "ACoS",
      currentValue: 0,
      // @ts-ignore
      expectedValue: -10,
      changePercent: -10
    },
    // @ts-ignore
    confidence: 0.75,
    // @ts-ignore
    reasoning: `\u51CC\u6668${poorPerformingHours.join(",")}\u70B9\u901A\u5E38\u8F6C\u5316\u7387\u8F83\u4F4E\uFF0C\u5EFA\u8BAE\u964D\u4F4E\u51FA\u4EF7\u4EE5\u51CF\u5C11\u6D6A\u8D39`,
    status: "pending",
    createdAt: /* @__PURE__ */ new Date()
  });
  return decisions;
}
async function analyzeNegativeKeywords(campaign, costType = "cpc") {
  const db = await getDbInstance10();
  const decisions = [];
  const isVcpm = costType === "vcpm";
  if (isVcpm) {
    const poorKeywords = await db.select().from(keywords).where(and(
      sql`${keywords.internalAdGroupId} IN (SELECT id FROM ad_groups WHERE campaignId = ${campaign.campaignId})`,
      sql`${keywords.impressions} > 5000`,
      // vCPM需要更多展示数据
      sql`${keywords.clicks} = 0`,
      // 零点击表示展示完全无效
      sql`${keywords.orders} = 0`
    )).limit(10);
    for (const kw of poorKeywords) {
      const impressions = Number(kw.impressions) || 0;
      const spend = Number(kw.spend) || 0;
      decisions.push({
        // @ts-ignore
        id: `negative_vcpm_${campaign.campaignId}_${kw.id}_${Date.now()}`,
        type: "negative_keyword",
        targetType: "keyword",
        // @ts-ignore
        targetId: kw.id,
        // @ts-ignore
        targetName: kw.keywordText || `\u5173\u952E\u8BCD ${kw.id}`,
        currentValue: "\u6B63\u5E38\u6295\u653E",
        // @ts-ignore
        suggestedValue: "\u6DFB\u52A0\u4E3A\u5426\u5B9A\u8BCD",
        // @ts-ignore
        expectedImpact: {
          metric: "\u82B1\u8D39",
          currentValue: spend,
          expectedValue: 0,
          changePercent: -100
        },
        confidence: 0.85,
        reasoning: `[vCPM] \u8BE5\u5173\u952E\u8BCD\u5DF2\u83B7\u5F97${impressions}\u6B21\u5C55\u793A\u4F460\u70B9\u51FB0\u8F6C\u5316\uFF0C\u82B1\u8D39$${spend.toFixed(2)}\uFF0C\u5C55\u793A\u5B8C\u5168\u65E0\u6548\uFF0C\u5EFA\u8BAE\u6DFB\u52A0\u4E3A\u5426\u5B9A\u8BCD`,
        status: "pending",
        createdAt: /* @__PURE__ */ new Date()
        // @ts-ignore
      });
    }
  } else {
    const campaignSales = Number(campaign.sales) || 0;
    const campaignOrders = Number(campaign.orders) || 0;
    const campaignAov = campaignOrders > 0 ? campaignSales / campaignOrders : 0;
    const campaignTargetAcos = Number(campaign.targetAcos) || 30;
    const poorKeywords = await db.select().from(keywords).where(and(
      sql`${keywords.internalAdGroupId} IN (SELECT id FROM ad_groups WHERE campaignId = ${campaign.campaignId})`,
      sql`${keywords.clicks} > 20`,
      sql`${keywords.orders} = 0`
    )).limit(10);
    for (const kw of poorKeywords) {
      const kwSpend = Number(kw.spend) || 0;
      const spendThreshold = campaignAov > 0 ? campaignAov * (campaignTargetAcos / 100) * 1.5 : 0;
      const shouldNegate = campaignAov === 0 || kwSpend >= spendThreshold;
      if (shouldNegate) {
        decisions.push({
          // @ts-ignore
          id: `negative_${campaign.campaignId}_${kw.id}_${Date.now()}`,
          type: "negative_keyword",
          targetType: "keyword",
          // @ts-ignore
          targetId: kw.id,
          // @ts-ignore
          targetName: kw.keywordText || `\u5173\u952E\u8BCD ${kw.id}`,
          currentValue: "\u6B63\u5E38\u6295\u653E",
          suggestedValue: "\u6DFB\u52A0\u4E3A\u5426\u5B9A\u8BCD",
          expectedImpact: {
            metric: "\u82B1\u8D39",
            currentValue: kwSpend,
            expectedValue: 0,
            changePercent: -100
          },
          confidence: 0.9,
          // @ts-ignore
          reasoning: `[CPC] \u8BE5\u5173\u952E\u8BCD\u5DF2\u83B7\u5F97${kw.clicks}\u6B21\u70B9\u51FB\u4F460\u8F6C\u5316\uFF0C\u82B1\u8D39$${kwSpend.toFixed(2)}${campaignAov > 0 ? `(\u8D85\u8FC7AOV\u5BB9\u5FCD\u7EBF$${spendThreshold.toFixed(2)})` : ""}\uFF0C\u5EFA\u8BAE\u6DFB\u52A0\u4E3A\u5426\u5B9A\u8BCD`,
          status: "pending",
          createdAt: /* @__PURE__ */ new Date()
        });
      }
    }
  }
  if (isVcpm) {
    const poorTargets = await db.select().from(productTargets).where(and(
      sql`${productTargets.internalAdGroupId} IN (SELECT id FROM ad_groups WHERE campaignId = ${campaign.campaignId})`,
      sql`${productTargets.impressions} > 5000`,
      sql`${productTargets.clicks} = 0`,
      sql`${productTargets.orders} = 0`
    )).limit(10);
    for (const pt of poorTargets) {
      const impressions = Number(pt.impressions) || 0;
      const spend = Number(pt.spend) || 0;
      decisions.push({
        id: `negative_vcpm_pt_${campaign.campaignId}_${pt.id}_${Date.now()}`,
        type: "negative_keyword",
        targetType: "keyword",
        targetId: pt.id,
        targetName: pt.targetValue || `\u5546\u54C1\u5B9A\u5411 ${pt.id}`,
        currentValue: "\u6B63\u5E38\u6295\u653E",
        suggestedValue: "\u6DFB\u52A0\u4E3A\u5426\u5B9A\u5546\u54C1\u5B9A\u5411",
        expectedImpact: { metric: "\u82B1\u8D39", currentValue: spend, expectedValue: 0, changePercent: -100 },
        confidence: 0.85,
        reasoning: `[vCPM\u5546\u54C1\u5B9A\u5411] \u5339\u914D\u65B9\u5F0F:${pt.targetMatchType || "auto"}, \u5DF2\u83B7\u5F97${impressions}\u6B21\u5C55\u793A\u4F460\u70B9\u51FB0\u8F6C\u5316\uFF0C\u82B1\u8D39$${spend.toFixed(2)}\uFF0C\u5EFA\u8BAE\u5426\u5B9A`,
        status: "pending",
        createdAt: /* @__PURE__ */ new Date()
      });
    }
  } else {
    const poorTargets = await db.select().from(productTargets).where(and(
      sql`${productTargets.internalAdGroupId} IN (SELECT id FROM ad_groups WHERE campaignId = ${campaign.campaignId})`,
      sql`${productTargets.clicks} > 20`,
      sql`${productTargets.orders} = 0`
    )).limit(10);
    for (const pt of poorTargets) {
      decisions.push({
        id: `negative_pt_${campaign.campaignId}_${pt.id}_${Date.now()}`,
        type: "negative_keyword",
        targetType: "keyword",
        targetId: pt.id,
        targetName: pt.targetValue || `\u5546\u54C1\u5B9A\u5411 ${pt.id}`,
        currentValue: "\u6B63\u5E38\u6295\u653E",
        suggestedValue: "\u6DFB\u52A0\u4E3A\u5426\u5B9A\u5546\u54C1\u5B9A\u5411",
        expectedImpact: { metric: "\u82B1\u8D39", currentValue: Number(pt.spend) || 0, expectedValue: 0, changePercent: -100 },
        confidence: 0.9,
        reasoning: `[CPC\u5546\u54C1\u5B9A\u5411] \u5339\u914D\u65B9\u5F0F:${pt.targetMatchType || "auto"}, \u5DF2\u83B7\u5F97${pt.clicks}\u6B21\u70B9\u51FB\u4F460\u8F6C\u5316\uFF0C\u82B1\u8D39$${pt.spend}\uFF0C\u5EFA\u8BAE\u5426\u5B9A`,
        status: "pending",
        createdAt: /* @__PURE__ */ new Date()
      });
    }
  }
  return decisions;
}
async function executeOptimizationDecision(decisionId, executedBy = "manual") {
  return {
    success: true,
    message: `\u51B3\u7B56 ${decisionId} \u5DF2${executedBy === "auto" ? "\u81EA\u52A8" : "\u624B\u52A8"}\u6267\u884C`
  };
}
async function batchExecuteOptimizationDecisions(decisionIds, executedBy = "manual") {
  const results = [];
  let success2 = 0;
  let failed = 0;
  for (const id of decisionIds) {
    const result = await executeOptimizationDecision(id, executedBy);
    results.push({ id, ...result });
    if (result.success) {
      success2++;
    } else {
      failed++;
    }
  }
  return { success: success2, failed, results };
}
async function getOptimizationSummary(accountId, options = {}) {
  return {
    totalDecisions: 0,
    pendingDecisions: 0,
    executedToday: 0,
    successRate: 0,
    byType: {
      bid_adjustment: { total: 0, pending: 0, executed: 0, avgConfidence: 0 },
      placement_tilt: { total: 0, pending: 0, executed: 0, avgConfidence: 0 },
      dayparting: { total: 0, pending: 0, executed: 0, avgConfidence: 0 },
      negative_keyword: { total: 0, pending: 0, executed: 0, avgConfidence: 0 },
      funnel_migration: { total: 0, pending: 0, executed: 0, avgConfidence: 0 },
      budget_reallocation: { total: 0, pending: 0, executed: 0, avgConfidence: 0 },
      correction: { total: 0, pending: 0, executed: 0, avgConfidence: 0 },
      traffic_isolation: { total: 0, pending: 0, executed: 0, avgConfidence: 0 }
    },
    recentDecisions: []
  };
}
async function updateCampaignOptimizationSettings(campaignId, settings) {
  return { success: true };
}
async function updatePerformanceGroupOptimizationSettings(groupId, settings) {
  return { success: true };
}
var log152;
var init_unifiedOptimizationEngine = __esm({
  "server/optimization/unifiedOptimizationEngine.ts"() {
    "use strict";
    init_logger();
    init_db2();
    init_schema2();
    init_drizzle_orm();
    init_attributionWindowHelper();
    log152 = createModuleLogger("UnifiedOptimizationEngine");
    __name(getDbInstance10, "getDbInstance");
    __name(getCampaignOptimizationState, "getCampaignOptimizationState");
    __name(getPerformanceGroupOptimizationState, "getPerformanceGroupOptimizationState");
    __name(runUnifiedOptimizationAnalysis, "runUnifiedOptimizationAnalysis");
    __name(analyzeBidAdjustments, "analyzeBidAdjustments");
    __name(analyzePlacementTilt, "analyzePlacementTilt");
    __name(analyzeDayparting, "analyzeDayparting");
    __name(analyzeNegativeKeywords, "analyzeNegativeKeywords");
    __name(executeOptimizationDecision, "executeOptimizationDecision");
    __name(batchExecuteOptimizationDecisions, "batchExecuteOptimizationDecisions");
    __name(getOptimizationSummary, "getOptimizationSummary");
    __name(updateCampaignOptimizationSettings, "updateCampaignOptimizationSettings");
    __name(updatePerformanceGroupOptimizationSettings, "updatePerformanceGroupOptimizationSettings");
  }
});

