// Extracted from production dist/index.js
// Original module: server/optimization/multiDimensionOptimizer.ts
// Lines: 769

async function analyzeMultiDimensionPerformance(campaignId, accountId, lookbackDays = 30, targetAcos, amazonCampaignId) {
  const db = await getDb();
  if (!db) return null;
  const endDate = /* @__PURE__ */ new Date();
  endDate.setDate(endDate.getDate() - DATA_THRESHOLDS.ATTRIBUTION_DELAY_DAYS);
  const startDate = /* @__PURE__ */ new Date();
  startDate.setDate(startDate.getDate() - lookbackDays - DATA_THRESHOLDS.ATTRIBUTION_DELAY_DAYS);
  const startStr = startDate.toISOString().split("T")[0];
  const endStr = endDate.toISOString().split("T")[0];
  const performanceQueryId = String(amazonCampaignId || campaignId);
  const weeklyData = await db.select({
    dayOfWeek: hourlyPerformance.dayOfWeek,
    impressions: sql`SUM(${hourlyPerformance.impressions})`,
    clicks: sql`SUM(${hourlyPerformance.clicks})`,
    spend: sql`SUM(${hourlyPerformance.spend})`,
    sales: sql`SUM(${hourlyPerformance.sales})`,
    orders: sql`SUM(${hourlyPerformance.orders})`,
    dataPoints: sql`COUNT(DISTINCT ${hourlyPerformance.date})`
  }).from(hourlyPerformance).where(
    and(
      eq(hourlyPerformance.campaignId, performanceQueryId),
      sql`${hourlyPerformance.date} >= ${startStr}`,
      sql`${hourlyPerformance.date} <= ${endStr}`
    )
  ).groupBy(hourlyPerformance.dayOfWeek);
  const hourlyData = await db.select({
    hour: hourlyPerformance.hour,
    impressions: sql`SUM(${hourlyPerformance.impressions})`,
    clicks: sql`SUM(${hourlyPerformance.clicks})`,
    spend: sql`SUM(${hourlyPerformance.spend})`,
    sales: sql`SUM(${hourlyPerformance.sales})`,
    orders: sql`SUM(${hourlyPerformance.orders})`,
    dataPoints: sql`COUNT(DISTINCT ${hourlyPerformance.date})`
  }).from(hourlyPerformance).where(
    and(
      eq(hourlyPerformance.campaignId, performanceQueryId),
      sql`${hourlyPerformance.date} >= ${startStr}`,
      sql`${hourlyPerformance.date} <= ${endStr}`
    )
  ).groupBy(hourlyPerformance.hour);
  const placementData = await db.select({
    placement: placementPerformance.placement,
    impressions: sql`SUM(${placementPerformance.impressions})`,
    clicks: sql`SUM(${placementPerformance.clicks})`,
    spend: sql`SUM(${placementPerformance.spend})`,
    sales: sql`SUM(${placementPerformance.sales})`,
    orders: sql`SUM(${placementPerformance.orders})`
  }).from(placementPerformance).where(
    and(
      eq(placementPerformance.campaignId, performanceQueryId),
      eq(placementPerformance.accountId, accountId),
      gte(placementPerformance.date, startStr),
      lte(placementPerformance.date, endStr)
    )
  ).groupBy(placementPerformance.placement);
  const keywordQueryId = amazonCampaignId || campaignId;
  const allKeywords = await getKeywordsByCampaignId(Number(keywordQueryId));
  const keywordData = allKeywords.filter((kw) => kw.keywordStatus === "enabled");
  const dayPerformances = weeklyData.map((d) => {
    const spend = parseFloat(d.spend || "0");
    const sales = parseFloat(d.sales || "0");
    const roas = spend > 0 ? sales / spend : 0;
    const acos = sales > 0 ? spend / sales * 100 : spend > 0 ? 999 : 0;
    return {
      dayOfWeek: d.dayOfWeek,
      dayLabel: DAY_LABELS[d.dayOfWeek] || `Day${d.dayOfWeek}`,
      roas,
      acos,
      spend,
      sales,
      orders: d.orders || 0,
      clicks: d.clicks || 0,
      impressions: d.impressions || 0,
      score: calculatePerformanceScore(roas, acos, d.clicks || 0, d.orders || 0, targetAcos)
    };
  });
  const hourPerformances = hourlyData.map((h) => {
    const spend = parseFloat(h.spend || "0");
    const sales = parseFloat(h.sales || "0");
    const clicks = h.clicks || 0;
    const orders = h.orders || 0;
    const roas = spend > 0 ? sales / spend : 0;
    const acos = sales > 0 ? spend / sales * 100 : spend > 0 ? 999 : 0;
    const cvr = clicks > 0 ? orders / clicks * 100 : 0;
    return {
      hour: h.hour,
      roas,
      acos,
      spend,
      sales,
      orders,
      clicks,
      impressions: h.impressions || 0,
      cvr,
      score: calculatePerformanceScore(roas, acos, clicks, orders, targetAcos)
    };
  });
  const sortedDays = [...dayPerformances].sort((a, b) => b.score - a.score);
  const sortedHours = [...hourPerformances].sort((a, b) => b.score - a.score);
  const peakWindows = identifyTimeWindows(hourPerformances, "peak", targetAcos);
  const offPeakWindows = identifyTimeWindows(hourPerformances, "offpeak", targetAcos);
  const placementLabels = {
    top_of_search: "\u641C\u7D22\u7ED3\u679C\u9876\u90E8",
    product_page: "\u5546\u54C1\u9875\u9762",
    rest_of_search: "\u641C\u7D22\u7ED3\u679C\u5176\u4ED6\u4F4D\u7F6E"
  };
  const placementPerfs = placementData.map((p) => {
    const spend = parseFloat(p.spend || "0");
    const sales = parseFloat(p.sales || "0");
    const clicks = p.clicks || 0;
    const orders = p.orders || 0;
    const roas = spend > 0 ? sales / spend : 0;
    const acos = sales > 0 ? spend / sales * 100 : spend > 0 ? 999 : 0;
    const cvr = clicks > 0 ? orders / clicks * 100 : 0;
    const { adjustment, reason } = calculatePlacementSuggestion(roas, acos, cvr, clicks, orders, targetAcos);
    return {
      placement: p.placement,
      placementLabel: placementLabels[p.placement] || p.placement,
      roas,
      acos,
      spend,
      sales,
      orders,
      clicks,
      impressions: p.impressions || 0,
      cvr,
      suggestedAdjustment: adjustment,
      reason
    };
  });
  const sortedPlacements = [...placementPerfs].sort((a, b) => b.roas - a.roas);
  const keywordPerfs = keywordData.map((kw) => {
    const spend = parseFloat(kw.spend || "0");
    const sales = parseFloat(kw.sales || "0");
    const clicks = kw.clicks || 0;
    const orders = kw.orders || 0;
    const impressions = kw.impressions || 0;
    const currentBid = parseFloat(kw.bid || "0");
    const roas = spend > 0 ? sales / spend : 0;
    const acos = sales > 0 ? spend / sales * 100 : spend > 0 ? 999 : 0;
    const { category, multiplier, reason } = classifyKeyword2(
      clicks,
      orders,
      impressions,
      spend,
      sales,
      roas,
      acos,
      targetAcos
    );
    return {
      keywordId: kw.id,
      keywordText: kw.keywordText || "",
      matchType: kw.matchType || "broad",
      currentBid,
      roas,
      acos,
      spend,
      sales,
      orders,
      clicks,
      impressions,
      category,
      suggestedBidMultiplier: multiplier,
      reason,
      dataPoints: clicks
      // 用点击数作为数据充分性指标
    };
  });
  const highPerformers = keywordPerfs.filter((k) => k.category === "high_performer");
  const lowPerformers = keywordPerfs.filter((k) => k.category === "low_performer");
  const protectedKeywords = keywordPerfs.filter((k) => k.category === "protected" || k.category === "new");
  const totalClicks = hourPerformances.reduce((s, h) => s + h.clicks, 0);
  const totalOrders = hourPerformances.reduce((s, h) => s + h.orders, 0);
  const dataConfidence = (
    // @ts-ignore
    totalClicks >= 100 && totalOrders >= 10 ? "high" : (
      // @ts-ignore
      totalClicks >= 30 && totalOrders >= 3 ? "medium" : "low"
    )
  );
  const avgRoas = hourPerformances.reduce((s, h) => s + h.roas, 0) / Math.max(hourPerformances.length, 1);
  const overallScore = Math.min(100, avgRoas * 25);
  return {
    campaignId,
    campaignName: "",
    // 由调用方填充
    timeAnalysis: {
      bestDays: sortedDays.slice(0, 3),
      worstDays: sortedDays.slice(-3).reverse(),
      bestHours: sortedHours.slice(0, 6),
      worstHours: sortedHours.slice(-6).reverse(),
      peakWindows,
      offPeakWindows
    },
    placementAnalysis: {
      placements: placementPerfs,
      bestPlacement: sortedPlacements[0]?.placement || "top_of_search",
      worstPlacement: sortedPlacements[sortedPlacements.length - 1]?.placement || "rest_of_search"
    },
    keywordAnalysis: {
      highPerformers,
      lowPerformers,
      protectedKeywords
    },
    overallScore,
    dataConfidence
  };
}
function generateOptimizationPlan(analysis, config2) {
  const targetAcos = config2.targetAcos || 30;
  const targetRoas = config2.targetRoas || 100 / targetAcos;
  const maxBid = config2.maxBid || 2;
  const hourlyBidRules = generateHourlyBidRules(analysis, targetAcos, targetRoas);
  const placementAdjustments = generatePlacementAdjustments(analysis, targetAcos);
  const keywordBidAdjustments = generateKeywordBidAdjustments(
    analysis,
    targetAcos,
    maxBid
  );
  const budgetSuggestion = generateBudgetSuggestion(analysis, config2.dailyBudget || 0);
  return {
    campaignId: analysis.campaignId,
    hourlyBidRules,
    placementAdjustments,
    keywordBidAdjustments,
    budgetSuggestion
  };
}
function generateHourlyBidRules(analysis, targetAcos, targetRoas) {
  const rules = [];
  const allHours = [...analysis.timeAnalysis.bestHours, ...analysis.timeAnalysis.worstHours];
  const avgRoas = allHours.reduce((s, h) => s + h.roas, 0) / Math.max(allHours.length, 1);
  for (let dayOfWeek = 0; dayOfWeek <= 6; dayOfWeek++) {
    const dayPerf = analysis.timeAnalysis.bestDays.find((d) => d.dayOfWeek === dayOfWeek) || analysis.timeAnalysis.worstDays.find((d) => d.dayOfWeek === dayOfWeek);
    const dayMultiplier = dayPerf ? calculateDayMultiplier(dayPerf, targetRoas) : 1;
    for (let hour2 = 0; hour2 < 24; hour2++) {
      const hourPerf = analysis.timeAnalysis.bestHours.find((h) => h.hour === hour2) || analysis.timeAnalysis.worstHours.find((h) => h.hour === hour2);
      let hourMultiplier = 1;
      let reason = "\u6807\u51C6\u65F6\u6BB5";
      if (hourPerf) {
        if (avgRoas > 0) {
          hourMultiplier = hourPerf.roas / avgRoas;
        }
        if (hourPerf.clicks < DATA_THRESHOLDS.MIN_CLICKS_FOR_CONFIDENCE) {
          const confidence = hourPerf.clicks / DATA_THRESHOLDS.MIN_CLICKS_FOR_CONFIDENCE;
          hourMultiplier = 1 + (hourMultiplier - 1) * confidence;
          reason = `\u6570\u636E\u4E0D\u8DB3(${hourPerf.clicks}\u6B21\u70B9\u51FB)\uFF0C\u4FDD\u5B88\u8C03\u6574`;
        } else if (hourPerf.roas > targetRoas * 1.5) {
          reason = `\u9AD8\u6295\u4EA7\u65F6\u6BB5(ROAS ${hourPerf.roas.toFixed(1)}x)\uFF0C\u52A0\u5927\u6295\u5165`;
        } else if (hourPerf.roas > targetRoas) {
          reason = `\u8FBE\u6807\u65F6\u6BB5(ROAS ${hourPerf.roas.toFixed(1)}x)\uFF0C\u9002\u5EA6\u589E\u52A0`;
        } else if (hourPerf.roas > 0 && hourPerf.roas < targetRoas * 0.5) {
          reason = `\u4F4E\u6295\u4EA7\u65F6\u6BB5(ROAS ${hourPerf.roas.toFixed(1)}x)\uFF0C\u51CF\u5C11\u6295\u5165`;
        } else if (hourPerf.spend > 0 && hourPerf.sales === 0) {
          reason = `\u96F6\u8F6C\u5316\u65F6\u6BB5\uFF0C\u5927\u5E45\u51CF\u5C11\u6295\u5165`;
          hourMultiplier = Math.max(0.3, hourMultiplier);
        } else {
          reason = `\u4E00\u822C\u65F6\u6BB5(ROAS ${hourPerf.roas.toFixed(1)}x)`;
        }
      }
      let finalMultiplier = dayMultiplier * hourMultiplier;
      finalMultiplier = Math.max(0.2, Math.min(2.5, finalMultiplier));
      finalMultiplier = Math.round(finalMultiplier * 100) / 100;
      rules.push({
        dayOfWeek,
        hour: hour2,
        bidMultiplier: finalMultiplier,
        reason: `${DAY_LABELS[dayOfWeek]} ${hour2}:00 - ${reason} (\u65E5\u500D\u6570${dayMultiplier.toFixed(2)}x \xD7 \u65F6\u500D\u6570${hourMultiplier.toFixed(2)}x)`
      });
    }
  }
  return rules;
}
function generatePlacementAdjustments(analysis, targetAcos) {
  return analysis.placementAnalysis.placements.map((p) => {
    let adjustmentPercent = p.suggestedAdjustment;
    adjustmentPercent = Math.max(-90, Math.min(900, adjustmentPercent));
    return {
      placement: p.placement,
      adjustmentPercent: Math.round(adjustmentPercent),
      reason: p.reason
    };
  });
}
function generateKeywordBidAdjustments(analysis, targetAcos, maxBid) {
  const adjustments = [];
  const allKeywords = [
    // @ts-ignore
    ...analysis.keywordAnalysis.highPerformers,
    ...analysis.keywordAnalysis.lowPerformers,
    ...analysis.keywordAnalysis.protectedKeywords
  ];
  for (const kw of allKeywords) {
    const currentBid = kw.currentBid;
    if (currentBid <= 0) continue;
    let suggestedBid = currentBid * kw.suggestedBidMultiplier;
    suggestedBid = Math.max(ADJUSTMENT_LIMITS.MIN_BID, suggestedBid);
    suggestedBid = Math.min(maxBid, suggestedBid);
    suggestedBid = Math.round(suggestedBid * 100) / 100;
    if (Math.abs(suggestedBid - currentBid) >= 0.01) {
      adjustments.push({
        // @ts-ignore
        keywordId: kw.keywordId,
        // @ts-ignore
        keywordText: kw.keywordText,
        currentBid,
        suggestedBid,
        // @ts-ignore
        reason: kw.reason
      });
    }
  }
  return adjustments;
}
function generateBudgetSuggestion(analysis, currentBudget) {
  if (currentBudget <= 0) {
    return { currentBudget: 0, suggestedBudget: 0, reason: "\u672A\u8BBE\u7F6E\u9884\u7B97" };
  }
  const avgRoas = analysis.overallScore / 25;
  let budgetMultiplier = 1;
  let reason = "";
  if (avgRoas > 4) {
    budgetMultiplier = 1.2;
    reason = `\u9AD8\u6295\u4EA7(ROAS ${avgRoas.toFixed(1)}x)\uFF0C\u5EFA\u8BAE\u589E\u52A0\u9884\u7B97\u83B7\u53D6\u66F4\u591A\u9AD8\u6295\u4EA7\u8BA2\u5355`;
  } else if (avgRoas > 2.5) {
    budgetMultiplier = 1.1;
    reason = `\u6295\u4EA7\u826F\u597D(ROAS ${avgRoas.toFixed(1)}x)\uFF0C\u9002\u5EA6\u589E\u52A0\u9884\u7B97`;
  } else if (avgRoas > 1.5) {
    budgetMultiplier = 1;
    reason = `\u6295\u4EA7\u4E00\u822C(ROAS ${avgRoas.toFixed(1)}x)\uFF0C\u7EF4\u6301\u5F53\u524D\u9884\u7B97`;
  } else if (avgRoas > 0) {
    budgetMultiplier = 0.9;
    reason = `\u6295\u4EA7\u8F83\u4F4E(ROAS ${avgRoas.toFixed(1)}x)\uFF0C\u9002\u5EA6\u51CF\u5C11\u9884\u7B97`;
  }
  budgetMultiplier = Math.max(
    1 - ADJUSTMENT_LIMITS.MAX_BUDGET_CHANGE_PERCENT,
    Math.min(1 + ADJUSTMENT_LIMITS.MAX_BUDGET_CHANGE_PERCENT, budgetMultiplier)
  );
  const suggestedBudget = Math.round(currentBudget * budgetMultiplier * 100) / 100;
  return { currentBudget, suggestedBudget, reason };
}
async function applyHourlyBidRulesToStrategy(campaignId, accountId, rules) {
  let strategy = await getDaypartingStrategyByCampaignId(campaignId);
  if (!strategy) {
    strategy = await ensureDaypartingStrategy(
      accountId,
      campaignId,
      `Campaign ${campaignId}`,
      {}
    );
  }
  if (!strategy) {
    return { success: false, strategyId: 0, rulesApplied: 0 };
  }
  const existingRules = await getBidRules(strategy.id);
  const updatedRules = rules.map((newRule) => {
    const existing = existingRules.find(
      // @ts-expect-error - runtime type mismatch
      (e) => e.dayOfWeek === newRule.dayOfWeek && e.hour === newRule.hour
    );
    let finalMultiplier = newRule.bidMultiplier;
    if (existing) {
      const existingMultiplier = parseFloat(existing.bidMultiplier || "1.00");
      finalMultiplier = existingMultiplier * 0.3 + newRule.bidMultiplier * 0.7;
      finalMultiplier = Math.round(finalMultiplier * 100) / 100;
    }
    return {
      strategyId: strategy.id,
      dayOfWeek: newRule.dayOfWeek,
      hour: newRule.hour,
      bidMultiplier: finalMultiplier.toFixed(2),
      hourDataPoints: 0,
      hourIsEnabled: 1
    };
  });
  await saveBidRules(strategy.id, updatedRules);
  if (strategy.daypartingStatus !== "active") {
    await updateDaypartingStrategy(strategy.id, {
      daypartingStatus: "active",
      lastAnalyzedAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ")
    });
  }
  return { success: true, strategyId: strategy.id, rulesApplied: updatedRules.length };
}
async function applyDailyBudgetRulesToStrategy(campaignId, accountId, dayPerformances, config2) {
  let strategy = await getDaypartingStrategyByCampaignId(campaignId);
  if (!strategy) {
    strategy = await ensureDaypartingStrategy(
      accountId,
      campaignId,
      `Campaign ${campaignId}`,
      // @ts-ignore
      {}
    );
  }
  if (!strategy) {
    return { success: false, strategyId: 0, rulesApplied: 0 };
  }
  const existingRules = await getBudgetRules(strategy.id);
  const targetRoas = config2.targetRoas || (config2.targetAcos ? 100 / config2.targetAcos : 3.33);
  const allScores = dayPerformances.map((d) => d.score);
  const avgScore = allScores.reduce((s, v) => s + v, 0) / Math.max(allScores.length, 1) || 1;
  const budgetRules = [];
  for (let dayOfWeek = 0; dayOfWeek <= 6; dayOfWeek++) {
    const dayPerf = dayPerformances.find((d) => d.dayOfWeek === dayOfWeek);
    let multiplier = 1;
    if (dayPerf && avgScore > 0) {
      multiplier = dayPerf.score / avgScore;
      multiplier = Math.max(0.5, Math.min(1.8, multiplier));
    }
    const existing = existingRules.find((e) => e.dayOfWeek === dayOfWeek);
    if (existing) {
      const existingMultiplier = parseFloat(existing.budgetMultiplier || "1.00");
      multiplier = existingMultiplier * 0.3 + multiplier * 0.7;
    }
    multiplier = Math.round(multiplier * 100) / 100;
    const budgetPercentage = Math.round(multiplier / 7 * 100 * 100) / 100;
    budgetRules.push({
      dayOfWeek,
      budgetMultiplier: multiplier.toFixed(2),
      budgetPercentage: budgetPercentage.toFixed(2),
      avgSpend: dayPerf?.spend?.toFixed(2),
      avgSales: dayPerf?.sales?.toFixed(2),
      avgAcos: dayPerf?.acos?.toFixed(2),
      avgRoas: dayPerf?.roas?.toFixed(2),
      dataPoints: dayPerf ? Math.round(dayPerf.clicks / 10) : 0,
      // 估算数据点
      isEnabled: 1
    });
  }
  await saveBudgetRules(strategy.id, budgetRules);
  if (strategy.daypartingStatus !== "active") {
    await updateDaypartingStrategy(strategy.id, {
      daypartingStatus: "active",
      lastAnalyzedAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ")
    });
  }
  return { success: true, strategyId: strategy.id, rulesApplied: budgetRules.length };
}
async function executeMultiDimensionOptimization(targetId, accountId, campaigns6, config2, dryRun = false) {
  const details = [];
  let totalRulesGenerated = 0;
  let campaignsAnalyzed = 0;
  const lookbackDays = config2.lookbackDays || 30;
  for (const campaign of campaigns6) {
    try {
      const analysis = await analyzeMultiDimensionPerformance(
        // @ts-ignore
        campaign.id,
        accountId,
        lookbackDays,
        config2.targetAcos,
        campaign.campaignId
      );
      if (!analysis) {
        details.push({
          // @ts-ignore
          campaignId: campaign.campaignId,
          // @ts-ignore
          campaignName: campaign.campaignName,
          status: "skipped",
          reason: "\u65E0\u6CD5\u83B7\u53D6\u5206\u6790\u6570\u636E"
        });
        continue;
      }
      analysis.campaignName = campaign.campaignName;
      campaignsAnalyzed++;
      const plan = generateOptimizationPlan(analysis, config2);
      if (!dryRun && plan.hourlyBidRules.length > 0) {
        const applyResult = await applyHourlyBidRulesToStrategy(
          // @ts-ignore
          campaign.campaignId,
          accountId,
          plan.hourlyBidRules
          // @ts-ignore
        );
        totalRulesGenerated += applyResult.rulesApplied;
      }
      const allDayPerfs = [
        ...analysis.timeAnalysis.bestDays,
        ...analysis.timeAnalysis.worstDays
        // @ts-ignore
      ];
      const uniqueDayPerfs = allDayPerfs.filter(
        (d, i, arr) => arr.findIndex((x) => x.dayOfWeek === d.dayOfWeek) === i
      );
      if (!dryRun && uniqueDayPerfs.length > 0) {
        try {
          const budgetApplyResult = await applyDailyBudgetRulesToStrategy(
            // @ts-ignore
            campaign.campaignId,
            accountId,
            uniqueDayPerfs,
            config2
          );
          if (budgetApplyResult.success) {
            log97.info(`[MultiDimOptimizer] v179: Campaign ${campaign.campaignName} \u5206\u65F6\u9884\u7B97\u89C4\u5219\u5DF2\u4FDD\u5B58: ${budgetApplyResult.rulesApplied}\u6761`);
          }
        } catch (budgetErr) {
          log97.warn(`[MultiDimOptimizer] v179: \u5206\u65F6\u9884\u7B97\u89C4\u5219\u4FDD\u5B58\u5931\u8D25: ${budgetErr.message}`);
        }
      }
      details.push({
        // @ts-ignore
        campaignId: campaign.campaignId,
        // @ts-ignore
        campaignName: campaign.campaignName,
        status: "analyzed",
        dataConfidence: analysis.dataConfidence,
        overallScore: analysis.overallScore,
        peakWindows: analysis.timeAnalysis.peakWindows.length,
        bestPlacement: analysis.placementAnalysis.bestPlacement,
        highPerformKeywords: analysis.keywordAnalysis.highPerformers.length,
        protectedKeywords: analysis.keywordAnalysis.protectedKeywords.length,
        hourlyRulesGenerated: plan.hourlyBidRules.length,
        placementAdjustments: plan.placementAdjustments.length,
        keywordAdjustments: plan.keywordBidAdjustments.length,
        budgetSuggestion: plan.budgetSuggestion
      });
    } catch (error48) {
      details.push({
        // @ts-ignore
        campaignId: campaign.campaignId,
        // @ts-ignore
        campaignName: campaign.campaignName,
        status: "error",
        error: error48.message
      });
    }
  }
  return {
    executed: true,
    campaignsAnalyzed,
    rulesGenerated: totalRulesGenerated,
    details
  };
}
function calculatePerformanceScore(roas, acos, clicks, orders, targetAcos) {
  const target = targetAcos || 30;
  const roasScore = Math.min(50, roas * 12.5);
  let acosScore = 0;
  if (acos > 0 && acos <= target) {
    acosScore = 30;
  } else if (acos > 0 && acos <= target * 1.5) {
    acosScore = 30 * (1 - (acos - target) / (target * 0.5));
  }
  const dataScore = Math.min(20, clicks / 50 * 10 + orders / 5 * 10);
  return Math.min(100, roasScore + acosScore + dataScore);
}
function identifyTimeWindows(hourPerformances, type, targetAcos) {
  const windows = [];
  const targetRoas = targetAcos ? 100 / targetAcos : 3.33;
  const sorted = [...hourPerformances].sort((a, b) => a.hour - b.hour);
  let windowStart = -1;
  let windowHours = [];
  for (const hour2 of sorted) {
    const isGood = type === "peak" ? hour2.roas > targetRoas : hour2.roas < targetRoas * 0.5;
    if (isGood) {
      if (windowStart === -1) windowStart = hour2.hour;
      windowHours.push(hour2);
    } else {
      if (windowHours.length >= 2) {
        const totalSales = windowHours.reduce((s, h) => s + h.sales, 0);
        const totalSpend = windowHours.reduce((s, h) => s + h.spend, 0);
        const avgRoas = totalSpend > 0 ? totalSales / totalSpend : 0;
        const avgAcos = totalSales > 0 ? totalSpend / totalSales * 100 : 0;
        let bidMultiplier = 1;
        if (type === "peak") {
          bidMultiplier = Math.min(2, 1 + (avgRoas / targetRoas - 1) * 0.5);
        } else {
          bidMultiplier = Math.max(0.3, avgRoas / targetRoas);
        }
        windows.push({
          startHour: windowStart,
          endHour: windowHours[windowHours.length - 1].hour,
          // @ts-ignore
          avgRoas,
          // @ts-ignore
          avgAcos,
          // @ts-ignore
          totalSales,
          // @ts-ignore
          totalSpend,
          bidMultiplier: Math.round(bidMultiplier * 100) / 100,
          reason: type === "peak" ? `\u9AD8\u6295\u4EA7\u7A97\u53E3 ${windowStart}:00-${windowHours[windowHours.length - 1].hour + 1}:00 (ROAS ${avgRoas.toFixed(1)}x)` : `\u4F4E\u6295\u4EA7\u7A97\u53E3 ${windowStart}:00-${windowHours[windowHours.length - 1].hour + 1}:00 (ROAS ${avgRoas.toFixed(1)}x)`
        });
      }
      windowStart = -1;
      windowHours = [];
    }
  }
  if (windowHours.length >= 2) {
    const totalSales = windowHours.reduce((s, h) => s + h.sales, 0);
    const totalSpend = windowHours.reduce((s, h) => s + h.spend, 0);
    const avgRoas = totalSpend > 0 ? totalSales / totalSpend : 0;
    const avgAcos = totalSales > 0 ? totalSpend / totalSales * 100 : 0;
    let bidMultiplier = type === "peak" ? Math.min(2, 1 + (avgRoas / (targetAcos ? 100 / targetAcos : 3.33) - 1) * 0.5) : Math.max(0.3, avgRoas / (targetAcos ? 100 / targetAcos : 3.33));
    windows.push({
      startHour: windowStart,
      endHour: windowHours[windowHours.length - 1].hour,
      avgRoas,
      avgAcos,
      // @ts-ignore
      totalSales,
      // @ts-ignore
      totalSpend,
      bidMultiplier: Math.round(bidMultiplier * 100) / 100,
      reason: type === "peak" ? `\u9AD8\u6295\u4EA7\u7A97\u53E3 ${windowStart}:00-${windowHours[windowHours.length - 1].hour + 1}:00 (ROAS ${avgRoas.toFixed(1)}x)` : `\u4F4E\u6295\u4EA7\u7A97\u53E3 ${windowStart}:00-${windowHours[windowHours.length - 1].hour + 1}:00 (ROAS ${avgRoas.toFixed(1)}x)`
    });
  }
  return windows;
}
function calculateDayMultiplier(dayPerf, targetRoas) {
  if (dayPerf.clicks < 5) return 1;
  let multiplier = 1;
  if (dayPerf.roas > targetRoas * 1.5) {
    multiplier = 1 + Math.min(0.3, (dayPerf.roas / targetRoas - 1) * 0.2);
  } else if (dayPerf.roas > targetRoas) {
    multiplier = 1 + Math.min(0.15, (dayPerf.roas / targetRoas - 1) * 0.15);
  } else if (dayPerf.roas > 0 && dayPerf.roas < targetRoas * 0.5) {
    multiplier = Math.max(0.8, dayPerf.roas / targetRoas);
  }
  return Math.round(multiplier * 100) / 100;
}
function calculatePlacementSuggestion(roas, acos, cvr, clicks, orders, targetAcos) {
  const target = targetAcos || 30;
  const targetRoas = 100 / target;
  if (clicks < DATA_THRESHOLDS.MIN_CLICKS_FOR_CONFIDENCE) {
    return { adjustment: 0, reason: `\u6570\u636E\u4E0D\u8DB3(${clicks}\u6B21\u70B9\u51FB)\uFF0C\u7EF4\u6301\u5F53\u524D\u8BBE\u7F6E` };
  }
  if (roas > targetRoas * 2) {
    const adj = Math.min(200, Math.round((roas / targetRoas - 1) * 100));
    return { adjustment: adj, reason: `\u9AD8\u6295\u4EA7\u4F4D\u7F6E(ROAS ${roas.toFixed(1)}x)\uFF0C\u5927\u5E45\u63D0\u9AD8\u4F4D\u7F6E\u51FA\u4EF7` };
  } else if (roas > targetRoas) {
    const adj = Math.min(100, Math.round((roas / targetRoas - 1) * 50));
    return { adjustment: adj, reason: `\u8FBE\u6807\u4F4D\u7F6E(ROAS ${roas.toFixed(1)}x)\uFF0C\u9002\u5EA6\u63D0\u9AD8\u4F4D\u7F6E\u51FA\u4EF7` };
  } else if (roas > 0 && roas < targetRoas * 0.5) {
    const adj = Math.max(-50, Math.round((roas / targetRoas - 1) * 50));
    return { adjustment: adj, reason: `\u4F4E\u6295\u4EA7\u4F4D\u7F6E(ROAS ${roas.toFixed(1)}x)\uFF0C\u964D\u4F4E\u4F4D\u7F6E\u51FA\u4EF7` };
  }
  return { adjustment: 0, reason: `\u4E00\u822C\u8868\u73B0(ROAS ${roas.toFixed(1)}x)\uFF0C\u7EF4\u6301\u5F53\u524D\u8BBE\u7F6E` };
}
function classifyKeyword2(clicks, orders, impressions, spend, sales, roas, acos, targetAcos) {
  const target = targetAcos || 30;
  const targetRoas = 100 / target;
  if (impressions < DATA_THRESHOLDS.MIN_IMPRESSIONS_FOR_ANALYSIS) {
    return {
      category: "new",
      multiplier: 1,
      reason: `\u65B0\u6295\u653E\u8BCD(\u66DD\u5149${impressions})\uFF0C\u4FDD\u62A4\u6027\u7EF4\u6301\u5F53\u524D\u51FA\u4EF7\uFF0C\u7B49\u5F85\u6570\u636E\u79EF\u7D2F`
    };
  }
  if (clicks < DATA_THRESHOLDS.MIN_CLICKS_FOR_CONFIDENCE) {
    if (clicks > 0 && clicks < 10) {
      return {
        category: "protected",
        multiplier: 1,
        reason: `\u6570\u636E\u4E0D\u8DB3(${clicks}\u6B21\u70B9\u51FB)\uFF0C\u4FDD\u62A4\u6027\u7EF4\u6301\u51FA\u4EF7\u7EE7\u7EED\u89C2\u5BDF`
      };
    }
    if (clicks >= 10 && orders === 0) {
      return {
        category: "protected",
        multiplier: 0.95,
        reason: `${clicks}\u6B21\u70B9\u51FB\u96F6\u8F6C\u5316\uFF0C\u6570\u636E\u4ECD\u4E0D\u5145\u5206\uFF0C\u4EC5\u8F7B\u5FAE\u964D\u4EF75%`
      };
    }
    return {
      category: "protected",
      multiplier: 1,
      reason: `\u6570\u636E\u79EF\u7D2F\u4E2D(${clicks}\u6B21\u70B9\u51FB/${orders}\u8BA2\u5355)\uFF0C\u7EF4\u6301\u89C2\u5BDF`
    };
  }
  if (roas > targetRoas * 1.5 && orders >= DATA_THRESHOLDS.MIN_ORDERS_FOR_TREND) {
    const increase = Math.min(
      ADJUSTMENT_LIMITS.MAX_BID_INCREASE_PERCENT,
      (roas / targetRoas - 1) * 0.15
    );
    return {
      category: "high_performer",
      multiplier: 1 + increase,
      reason: `\u9AD8\u6295\u4EA7\u8BCD(ROAS ${roas.toFixed(1)}x, ${orders}\u8BA2\u5355)\uFF0C\u63D0\u4EF7${Math.round(increase * 100)}%\u83B7\u53D6\u66F4\u591A\u8BA2\u5355`
    };
  }
  if (roas >= targetRoas * 0.8 && roas <= targetRoas * 1.5) {
    return {
      category: "high_performer",
      multiplier: 1.05,
      reason: `\u8FBE\u6807\u8BCD(ROAS ${roas.toFixed(1)}x)\uFF0C\u5C0F\u5E45\u63D0\u4EF75%`
    };
  }
  if (roas < targetRoas * 0.5 && clicks >= 30 && orders >= 1) {
    const decrease = Math.min(
      ADJUSTMENT_LIMITS.MAX_BID_DECREASE_PERCENT,
      (1 - roas / targetRoas) * 0.2
    );
    return {
      category: "low_performer",
      multiplier: 1 - decrease,
      reason: `\u4F4E\u6295\u4EA7\u8BCD(ROAS ${roas.toFixed(1)}x, ACoS ${acos.toFixed(0)}%)\uFF0C\u964D\u4EF7${Math.round(decrease * 100)}%`
    };
  }
  if (clicks >= 30 && orders === 0 && spend > 0) {
    return {
      category: "low_performer",
      multiplier: 0.8,
      reason: `\u9AD8\u82B1\u8D39\u96F6\u8F6C\u5316(${clicks}\u6B21\u70B9\u51FB/$${spend.toFixed(2)}\u82B1\u8D39)\uFF0C\u964D\u4EF720%`
    };
  }
  return {
    category: "protected",
    multiplier: 1,
    reason: `\u8868\u73B0\u4E00\u822C(ROAS ${roas.toFixed(1)}x)\uFF0C\u7EF4\u6301\u5F53\u524D\u51FA\u4EF7`
  };
}
var log97, DAY_LABELS, DATA_THRESHOLDS, ADJUSTMENT_LIMITS;
var init_multiDimensionOptimizer = __esm({
  "server/optimization/multiDimensionOptimizer.ts"() {
    "use strict";
    init_logger();
    init_db2();
    init_db2();
    init_schema2();
    init_drizzle_orm();
    init_daypartingService();
    log97 = createModuleLogger("MultiDimensionOptimizer");
    DAY_LABELS = ["\u5468\u65E5", "\u5468\u4E00", "\u5468\u4E8C", "\u5468\u4E09", "\u5468\u56DB", "\u5468\u4E94", "\u5468\u516D"];
    DATA_THRESHOLDS = {
      MIN_CLICKS_FOR_CONFIDENCE: 20,
      // 至少20次点击才有统计意义
      MIN_ORDERS_FOR_TREND: 3,
      // 至少3个订单才能判断趋势
      MIN_IMPRESSIONS_FOR_ANALYSIS: 100,
      // 至少100次曝光才分析
      MIN_DAYS_FOR_HOURLY: 7,
      // 至少7天数据才做分时分析
      ATTRIBUTION_DELAY_DAYS: 3
      // 排除最近3天（归因延迟）
    };
    ADJUSTMENT_LIMITS = {
      MAX_BID_INCREASE_PERCENT: 0.3,
      // 单次最大提价30%
      MAX_BID_DECREASE_PERCENT: 0.2,
      // 单次最大降价20%
      MAX_PLACEMENT_CHANGE: 50,
      // 位置倾斜单次最大变化50%
      MAX_BUDGET_CHANGE_PERCENT: 0.25,
      // 预算单次最大变化25%
      MIN_BID: 0.02
      // 最低出价
    };
    __name(analyzeMultiDimensionPerformance, "analyzeMultiDimensionPerformance");
    __name(generateOptimizationPlan, "generateOptimizationPlan");
    __name(generateHourlyBidRules, "generateHourlyBidRules");
    __name(generatePlacementAdjustments, "generatePlacementAdjustments");
    __name(generateKeywordBidAdjustments, "generateKeywordBidAdjustments");
    __name(generateBudgetSuggestion, "generateBudgetSuggestion");
    __name(applyHourlyBidRulesToStrategy, "applyHourlyBidRulesToStrategy");
    __name(applyDailyBudgetRulesToStrategy, "applyDailyBudgetRulesToStrategy");
    __name(executeMultiDimensionOptimization, "executeMultiDimensionOptimization");
    __name(calculatePerformanceScore, "calculatePerformanceScore");
    __name(identifyTimeWindows, "identifyTimeWindows");
    __name(calculateDayMultiplier, "calculateDayMultiplier");
    __name(calculatePlacementSuggestion, "calculatePlacementSuggestion");
    __name(classifyKeyword2, "classifyKeyword");
  }
});

