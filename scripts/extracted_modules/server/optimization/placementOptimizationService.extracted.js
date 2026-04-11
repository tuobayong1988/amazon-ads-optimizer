// Extracted from production dist/index.js
// Original module: server/optimization/placementOptimizationService.ts
// Lines: 747

function calculateDataConfidence(metrics) {
  const { clicks, orders, spend } = metrics;
  if (orders >= 20 && clicks >= 200 && spend >= 100) {
    return {
      confidence: 1,
      isReliable: true,
      reason: "\u6570\u636E\u5145\u8DB3\uFF08\u226520\u8F6C\u5316\uFF0C\u2265200\u70B9\u51FB\uFF09\uFF0C\u9AD8\u7F6E\u4FE1\u5EA6",
      conversions: orders,
      clicks,
      spend
    };
  }
  if (orders >= 10 && clicks >= 100 && spend >= 50) {
    return {
      confidence: 0.8,
      isReliable: true,
      reason: "\u6570\u636E\u8F83\u5145\u8DB3\uFF08\u226510\u8F6C\u5316\uFF0C\u2265100\u70B9\u51FB\uFF09\uFF0C\u4E2D\u9AD8\u7F6E\u4FE1\u5EA6",
      conversions: orders,
      clicks,
      spend
    };
  }
  if (orders >= 5 && clicks >= 50 && spend >= 25) {
    return {
      confidence: 0.6,
      isReliable: true,
      reason: "\u6570\u636E\u4E2D\u7B49\uFF08\u22655\u8F6C\u5316\uFF0C\u226550\u70B9\u51FB\uFF09\uFF0C\u53EF\u53C2\u8003",
      conversions: orders,
      clicks,
      spend
    };
  }
  if (orders >= 2 && clicks >= 20) {
    return {
      confidence: 0.4,
      isReliable: false,
      reason: "\u6570\u636E\u4E0D\u8DB3\uFF08<5\u8F6C\u5316\uFF09\uFF0C\u5EFA\u8BAE\u7EE7\u7EED\u89C2\u5BDF",
      conversions: orders,
      clicks,
      spend
    };
  }
  return {
    confidence: 0.2,
    isReliable: false,
    reason: "\u6570\u636E\u4E25\u91CD\u4E0D\u8DB3\uFF08<2\u8F6C\u5316\uFF09\uFF0C\u4E0D\u5EFA\u8BAE\u8C03\u6574",
    conversions: orders,
    clicks,
    spend
  };
}
async function calculateDynamicBenchmarks(accountId, days = 30) {
  const db = await getDb();
  if (!db) return DEFAULT_BENCHMARKS;
  try {
    const startDate = /* @__PURE__ */ new Date();
    startDate.setDate(startDate.getDate() - days);
    const performanceData = await db.select({
      avgRoas: sql`AVG(CASE WHEN spend > 0 THEN sales / spend ELSE 0 END)`,
      avgAcos: sql`AVG(CASE WHEN sales > 0 THEN (spend / sales) * 100 ELSE 100 END)`,
      avgCvr: sql`AVG(CASE WHEN clicks > 0 THEN (orders / clicks) * 100 ELSE 0 END)`,
      avgCpc: sql`AVG(CASE WHEN clicks > 0 THEN spend / clicks ELSE 0 END)`
    }).from(placementPerformance).where(
      and(
        eq(placementPerformance.accountId, accountId),
        gte(placementPerformance.date, startDate.toISOString())
      )
    );
    if (performanceData.length === 0 || !performanceData[0].avgRoas) {
      return DEFAULT_BENCHMARKS;
    }
    const data = performanceData[0];
    return {
      // @ts-ignore
      roasBaseline: Math.max(2, Math.min(10, (data.avgRoas || 3) * 1.5)),
      // @ts-ignore
      acosBaseline: 100,
      // ACoS基准保持100%
      // @ts-ignore
      cvrBaseline: Math.max(5, Math.min(25, (data.avgCvr || 10) * 1.5)),
      // @ts-ignore
      cpcBaseline: Math.max(0.5, Math.min(5, (data.avgCpc || 1) * 1.5))
    };
  } catch (error48) {
    log106.warn("[PlacementOptimization] \u8BA1\u7B97\u52A8\u6001\u57FA\u51C6\u5931\u8D25:", error48);
    return DEFAULT_BENCHMARKS;
  }
}
async function checkAdjustmentCooldown(campaignId, accountId, placementType) {
  const db = await getDb();
  if (!db) {
    return { inCooldown: false };
  }
  try {
    const lastAdjustment = await db.select().from(bidAdjustmentHistory).where(
      and(
        eq(bidAdjustmentHistory.accountId, accountId),
        sql`${bidAdjustmentHistory.campaignName} = ${campaignId}`,
        eq(bidAdjustmentHistory.adjustmentType, "auto_placement")
      )
    ).orderBy(desc(bidAdjustmentHistory.appliedAt)).limit(1);
    if (lastAdjustment.length === 0) {
      return { inCooldown: false };
    }
    const lastDate = new Date(lastAdjustment[0].appliedAt || /* @__PURE__ */ new Date());
    const now = /* @__PURE__ */ new Date();
    const daysSinceLastAdjustment = Math.floor(
      (now.getTime() - lastDate.getTime()) / (1e3 * 60 * 60 * 24)
    );
    if (daysSinceLastAdjustment < ADJUSTMENT_COOLDOWN_DAYS) {
      return {
        inCooldown: true,
        lastAdjustmentDate: lastDate,
        daysRemaining: ADJUSTMENT_COOLDOWN_DAYS - daysSinceLastAdjustment,
        reason: `\u8DDD\u4E0A\u6B21\u8C03\u6574\u4EC5${daysSinceLastAdjustment}\u5929\uFF0C\u5EFA\u8BAE\u7B49\u5F85\u81F3\u5C11${ADJUSTMENT_COOLDOWN_DAYS}\u5929`
      };
    }
    return {
      inCooldown: false,
      lastAdjustmentDate: lastDate
    };
  } catch (error48) {
    log106.warn("[PlacementOptimization] \u68C0\u67E5\u51B7\u5374\u671F\u5931\u8D25:", error48);
    return { inCooldown: false };
  }
}
async function getCampaignBiddingStrategy(campaignId, accountId) {
  const db = await getDb();
  if (!db) return "fixed";
  try {
    const campaign = await db.select().from(campaigns).where(
      and(
        eq(campaigns.accountId, accountId),
        eq(campaigns.campaignId, campaignId)
      )
    ).limit(1);
    if (campaign.length === 0) {
      return "fixed";
    }
    return "down_only";
  } catch (error48) {
    log106.warn("[PlacementOptimization] \u83B7\u53D6\u7ADE\u4EF7\u7B56\u7565\u5931\u8D25:", error48);
    return "fixed";
  }
}
function getMaxAdjustmentByBiddingStrategy(biddingStrategy) {
  switch (biddingStrategy) {
    case "up_and_down":
      return 100;
    case "down_only":
      return 200;
    case "fixed":
    default:
      return 200;
  }
}
function calculateEfficiencyScore(metrics, weights = DEFAULT_WEIGHTS, benchmarks = DEFAULT_BENCHMARKS) {
  const ctr = metrics.clicks > 0 ? metrics.clicks / metrics.impressions * 100 : 0;
  const cpc = metrics.clicks > 0 ? metrics.spend / metrics.clicks : 0;
  const cvr = metrics.clicks > 0 ? metrics.orders / metrics.clicks * 100 : 0;
  const acos = metrics.sales > 0 ? metrics.spend / metrics.sales * 100 : 100;
  const roas = metrics.spend > 0 ? metrics.sales / metrics.spend : 0;
  const roasNorm = Math.min(roas / benchmarks.roasBaseline, 1);
  const acosNorm = Math.min(acos / benchmarks.acosBaseline, 1);
  const cvrNorm = Math.min(cvr / benchmarks.cvrBaseline, 1);
  const cpcNorm = Math.min(cpc / benchmarks.cpcBaseline, 1);
  const score = (roasNorm * weights.roasWeight + (1 - acosNorm) * weights.acosWeight + cvrNorm * weights.cvrWeight + (1 - cpcNorm) * weights.cpcWeight) * 100;
  const confidence = calculateDataConfidence(metrics);
  return {
    score: Math.round(score * 100) / 100,
    confidence,
    normalizedMetrics: {
      roas,
      acos,
      cvr,
      cpc,
      ctr,
      roasNorm,
      acosNorm,
      cvrNorm,
      cpcNorm
    }
  };
}
function calculateAdjustmentDelta(currentAdjustment, suggestedAdjustment, confidence, isReliable, biddingStrategy = "down_only") {
  if (!isReliable) {
    return {
      delta: 0,
      finalAdjustment: currentAdjustment,
      reason: "\u6570\u636E\u4E0D\u8DB3\uFF0C\u6682\u4E0D\u8C03\u6574",
      wasLimited: true
    };
  }
  let maxDeltaPercent;
  if (confidence >= 0.8) {
    maxDeltaPercent = 20;
  } else if (confidence >= 0.6) {
    maxDeltaPercent = 10;
  } else {
    maxDeltaPercent = 5;
  }
  let delta = suggestedAdjustment - currentAdjustment;
  const maxDelta = Math.max(Math.abs(currentAdjustment) * 0.25, maxDeltaPercent);
  let wasLimited = false;
  if (Math.abs(delta) > maxDelta) {
    delta = delta > 0 ? maxDelta : -maxDelta;
    wasLimited = true;
  }
  let finalAdjustment = currentAdjustment + delta;
  const maxByStrategy = getMaxAdjustmentByBiddingStrategy(biddingStrategy);
  if (finalAdjustment > maxByStrategy) {
    finalAdjustment = maxByStrategy;
    wasLimited = true;
  }
  finalAdjustment = Math.max(-50, Math.min(maxByStrategy, finalAdjustment));
  delta = finalAdjustment - currentAdjustment;
  return {
    delta: Math.round(delta),
    finalAdjustment: Math.round(finalAdjustment),
    reason: `\u7F6E\u4FE1\u5EA6${(confidence * 100).toFixed(0)}%\uFF0C\u6700\u5927\u8C03\u6574\u5E45\u5EA6${maxDeltaPercent}%${wasLimited ? "\uFF08\u5DF2\u9650\u5236\uFF09" : ""}`,
    wasLimited
  };
}
async function calculateOptimalAdjustment(scores, currentAdjustments, campaignId, accountId) {
  if (scores.length === 0) return [];
  let biddingStrategy = "down_only";
  if (campaignId && accountId) {
    biddingStrategy = await getCampaignBiddingStrategy(campaignId, accountId);
  }
  const reliableScores = scores.filter((s) => s.isReliable);
  const maxScore = reliableScores.length > 0 ? Math.max(...reliableScores.map((s) => s.rawScore)) : Math.max(...scores.map((s) => s.rawScore));
  const suggestions = [];
  for (const score of scores) {
    const currentAdj = currentAdjustments[score.placementType] || 0;
    let cooldownStatus = { inCooldown: false };
    if (campaignId && accountId) {
      cooldownStatus = await checkAdjustmentCooldown(campaignId, accountId, score.placementType);
    }
    let suggestedAdj = 0;
    if (maxScore > 0 && score.isReliable) {
      const relativeScore = score.rawScore / maxScore;
      if (relativeScore >= 0.9) {
        suggestedAdj = Math.round((relativeScore - 0.5) * 200 * score.confidence);
      } else if (relativeScore >= 0.7) {
        suggestedAdj = Math.round((relativeScore - 0.5) * 100 * score.confidence);
      } else if (relativeScore >= 0.5) {
        suggestedAdj = Math.round((relativeScore - 0.7) * 100 * score.confidence);
      } else {
        suggestedAdj = Math.round((relativeScore - 0.8) * 100 * score.confidence);
      }
    } else if (!score.isReliable) {
      suggestedAdj = currentAdj;
    }
    const adjustmentResult = calculateAdjustmentDelta(
      currentAdj,
      suggestedAdj,
      score.confidence,
      score.isReliable,
      biddingStrategy
    );
    if (cooldownStatus.inCooldown) {
      adjustmentResult.delta = 0;
      adjustmentResult.finalAdjustment = currentAdj;
    }
    let reason = "";
    if (cooldownStatus.inCooldown) {
      reason = cooldownStatus.reason || "\u5728\u51B7\u5374\u671F\u5185\uFF0C\u6682\u4E0D\u8C03\u6574";
    } else if (!score.isReliable) {
      reason = `${score.confidenceReason}\uFF0C\u6682\u4E0D\u8C03\u6574`;
    } else if (adjustmentResult.delta > 5) {
      reason = `\u8BE5\u4F4D\u7F6E\u6548\u7387\u8BC4\u5206${score.rawScore.toFixed(1)}\u5206\uFF08${score.confidenceReason}\uFF09\uFF0C\u5EFA\u8BAE\u589E\u52A0\u503E\u659C`;
    } else if (adjustmentResult.delta < -5) {
      reason = `\u8BE5\u4F4D\u7F6E\u6548\u7387\u8BC4\u5206${score.rawScore.toFixed(1)}\u5206\uFF08${score.confidenceReason}\uFF09\uFF0C\u5EFA\u8BAE\u964D\u4F4E\u503E\u659C`;
    } else {
      reason = `\u8BE5\u4F4D\u7F6E\u6548\u7387\u8BC4\u5206${score.rawScore.toFixed(1)}\u5206\uFF0C\u8868\u73B0\u7A33\u5B9A\uFF0C\u5EFA\u8BAE\u4FDD\u6301\u5F53\u524D\u8BBE\u7F6E`;
    }
    suggestions.push({
      placementType: score.placementType,
      currentAdjustment: currentAdj,
      suggestedAdjustment: adjustmentResult.finalAdjustment,
      adjustmentDelta: adjustmentResult.delta,
      efficiencyScore: score.rawScore,
      confidence: score.confidence,
      isReliable: score.isReliable,
      reason,
      cooldownStatus: {
        inCooldown: cooldownStatus.inCooldown,
        lastAdjustmentDate: cooldownStatus.lastAdjustmentDate,
        daysRemaining: cooldownStatus.daysRemaining
      }
    });
  }
  return suggestions;
}
async function getCampaignPlacementPerformance(campaignId, accountId, days = 90, excludeRecentDays = true) {
  const db = await getDb();
  if (!db) throw new Error("Database connection failed");
  const endDate = /* @__PURE__ */ new Date();
  if (excludeRecentDays) {
    endDate.setDate(endDate.getDate() - ATTRIBUTION_DELAY_DAYS2);
  }
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - days);
  const performanceData = await db.select().from(placementPerformance).where(
    and(
      eq(placementPerformance.campaignId, String(campaignId)),
      eq(placementPerformance.accountId, accountId),
      gte(placementPerformance.date, startDate.toISOString()),
      lte(placementPerformance.date, endDate.toISOString())
    )
  );
  const placementDailyData = {};
  const aggregatedData = {};
  for (const row of performanceData) {
    const placement = row.placement;
    if (!aggregatedData[placement]) {
      aggregatedData[placement] = {
        impressions: 0,
        clicks: 0,
        spend: 0,
        // @ts-ignore
        sales: 0,
        // @ts-ignore
        orders: 0
        // @ts-ignore
      };
    }
    aggregatedData[placement].impressions += row.impressions || 0;
    aggregatedData[placement].clicks += row.clicks || 0;
    aggregatedData[placement].spend += Number(row.spend) || 0;
    aggregatedData[placement].sales += Number(row.sales) || 0;
    aggregatedData[placement].orders += row.orders || 0;
    if (!placementDailyData[placement]) {
      placementDailyData[placement] = [];
    }
    placementDailyData[placement].push({
      // @ts-expect-error - dynamic property access
      date: typeof row.date === "string" ? row.date : new Date(row.date).toISOString(),
      // @ts-ignore
      impressions: row.impressions || 0,
      // @ts-ignore
      clicks: row.clicks || 0,
      // @ts-ignore
      spend: Number(row.spend) || 0,
      // @ts-ignore
      sales: Number(row.sales) || 0,
      // @ts-ignore
      orders: row.orders || 0
    });
  }
  const benchmarks = await calculateDynamicBenchmarks(accountId);
  const scores = [];
  for (const [placement, metrics] of Object.entries(aggregatedData)) {
    let weightedMetrics = metrics;
    const dailyData = placementDailyData[placement];
    if (dailyData && dailyData.length > 7) {
      try {
        const twMetrics = calculateTimeWeightedMetrics(dailyData);
        const totalDays = dailyData.length;
        weightedMetrics = {
          // @ts-expect-error - dynamic property access
          impressions: Math.round(twMetrics.weightedDailyImpressions * totalDays),
          // @ts-expect-error - dynamic property access
          clicks: Math.round(twMetrics.weightedDailyClicks * totalDays),
          spend: twMetrics.weightedDailySpend * totalDays,
          sales: twMetrics.weightedDailySales * totalDays,
          orders: Math.round(twMetrics.weightedDailyOrders * totalDays)
        };
        log106.info(`[PlacementOptimization] v163: ${placement} \u65F6\u95F4\u8870\u51CF\u52A0\u6743 - \u52A0\u6743ROAS=${twMetrics.weightedRoas.toFixed(2)}, \u52A0\u6743ACoS=${twMetrics.weightedAcos.toFixed(1)}%, \u7F6E\u4FE1\u5EA6=${twMetrics.dataQuality.confidenceLevel}`);
      } catch (e) {
        log106.info(`[PlacementOptimization] v163: ${placement} \u65F6\u95F4\u8870\u51CF\u8BA1\u7B97\u5931\u8D25\uFF0C\u4F7F\u7528\u539F\u59CB\u6C47\u603B: ${e.message}`);
      }
    }
    const { score, confidence, normalizedMetrics } = calculateEfficiencyScore(
      weightedMetrics,
      DEFAULT_WEIGHTS,
      benchmarks
    );
    scores.push({
      placementType: placement,
      rawScore: score,
      normalizedScore: score / 100,
      confidence: confidence.confidence,
      isReliable: confidence.isReliable,
      confidenceReason: confidence.reason,
      metrics: {
        ...weightedMetrics,
        // @ts-expect-error - runtime type mismatch
        roas: normalizedMetrics.roas,
        // @ts-expect-error - runtime type mismatch
        acos: normalizedMetrics.acos,
        // @ts-expect-error - runtime type mismatch
        cvr: normalizedMetrics.cvr,
        // @ts-expect-error - runtime type mismatch
        cpc: normalizedMetrics.cpc,
        // @ts-expect-error - runtime type mismatch
        ctr: normalizedMetrics.ctr
      }
    });
  }
  return scores;
}
async function getCampaignPlacementSettings(campaignId, accountId) {
  const db = await getDb();
  if (!db) throw new Error("Database connection failed");
  const settings = await db.select().from(placementSettings).where(
    and(
      eq(placementSettings.campaignId, String(campaignId)),
      eq(placementSettings.accountId, accountId)
    )
  );
  const result = {};
  if (settings.length > 0) {
    const setting = settings[0];
    result.top_of_search = setting.topOfSearchAdjustment || 0;
    result.product_page = setting.productPageAdjustment || 0;
    result.rest_of_search = 0;
  }
  return result;
}
async function recordPlacementAdjustment(campaignId, accountId, adjustment) {
  const db = await getDb();
  if (!db) return;
  try {
    await db.insert(bidAdjustmentHistory).values({
      accountId,
      campaignName: campaignId,
      previousBid: adjustment.currentAdjustment.toString(),
      newBid: adjustment.suggestedAdjustment.toString(),
      bidChangePercent: adjustment.adjustmentDelta.toString(),
      adjustmentType: "auto_placement",
      adjustmentReason: adjustment.reason,
      optimizationScore: Math.round(adjustment.efficiencyScore),
      appliedAt: (/* @__PURE__ */ new Date()).toISOString(),
      status: "applied"
    });
  } catch (error48) {
    log106.warn("[PlacementOptimization] \u8BB0\u5F55\u8C03\u6574\u5386\u53F2\u5931\u8D25:", error48);
  }
}
async function updatePlacementSettings(campaignId, accountId, adjustments) {
  const db = await getDb();
  if (!db) throw new Error("Database connection failed");
  const validAdjustments = adjustments.filter(
    (adj) => Math.abs(adj.adjustmentDelta) >= 5 && adj.isReliable && !adj.cooldownStatus?.inCooldown
  );
  if (validAdjustments.length === 0) return;
  const existing = await db.select().from(placementSettings).where(
    and(
      eq(placementSettings.campaignId, String(campaignId)),
      eq(placementSettings.accountId, accountId)
    )
  ).limit(1);
  const updateData = {
    lastAdjustedAt: /* @__PURE__ */ new Date()
  };
  for (const adj of validAdjustments) {
    if (adj.placementType === "top_of_search") {
      updateData.topOfSearchAdjustment = adj.suggestedAdjustment;
    } else if (adj.placementType === "product_page") {
      updateData.productPageAdjustment = adj.suggestedAdjustment;
    }
    await recordPlacementAdjustment(campaignId, accountId, adj);
  }
  if (existing.length > 0) {
    await db.update(placementSettings).set(updateData).where(eq(placementSettings.id, existing[0].id));
  } else {
    await db.insert(placementSettings).values({
      campaignId,
      accountId,
      autoOptimize: true,
      ...updateData
    });
  }
  try {
    const campaignUpdateData = {};
    for (const adj of validAdjustments) {
      if (adj.placementType === "top_of_search") {
        campaignUpdateData.placementTopSearchBidAdjustment = adj.suggestedAdjustment;
      } else if (adj.placementType === "product_page") {
        campaignUpdateData.placementProductPageBidAdjustment = adj.suggestedAdjustment;
      }
    }
    if (Object.keys(campaignUpdateData).length > 0) {
      const nowStr = (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ");
      campaignUpdateData.lastOptimizedAt = nowStr;
      campaignUpdateData.placementSyncStatus = "pending_confirmation";
      for (const adj of validAdjustments) {
        if (adj.placementType === "top_of_search") {
          campaignUpdateData.pendingPlacementTop = adj.suggestedAdjustment;
        } else if (adj.placementType === "product_page") {
          campaignUpdateData.pendingPlacementProduct = adj.suggestedAdjustment;
        }
      }
      await db.update(campaigns).set(campaignUpdateData).where(
        and(
          eq(campaigns.campaignId, campaignId),
          eq(campaigns.accountId, accountId)
        )
      );
      log106.info(`[PlacementOptimization] v166: campaigns\u8868\u4F4D\u7F6E\u503E\u659C\u5DF2\u540C\u6B65\u66F4\u65B0(\u5F85\u786E\u8BA4) - campaignId=${campaignId}`, campaignUpdateData);
    }
  } catch (campaignUpdateError) {
    log106.warn(`[PlacementOptimization] v165: campaigns\u8868\u4F4D\u7F6E\u503E\u659C\u66F4\u65B0\u5931\u8D25: ${campaignUpdateError.message}`);
  }
}
async function executeAutomaticPlacementOptimization(campaignId, accountId, options) {
  try {
    const benchmarks = await calculateDynamicBenchmarks(accountId);
    const biddingStrategy = await getCampaignBiddingStrategy(campaignId, accountId);
    const scores = await getCampaignPlacementPerformance(campaignId, accountId, 14, true);
    if (scores.length === 0) {
      return {
        success: false,
        message: "\u6CA1\u6709\u8DB3\u591F\u7684\u4F4D\u7F6E\u8868\u73B0\u6570\u636E\u8FDB\u884C\u4F18\u5316",
        suggestions: [],
        benchmarksUsed: benchmarks,
        biddingStrategy
      };
    }
    const currentSettings = await getCampaignPlacementSettings(campaignId, accountId);
    const suggestions = await calculateOptimalAdjustment(
      scores,
      currentSettings,
      campaignId,
      accountId
    );
    const needsAdjustment = suggestions.some(
      (s) => Math.abs(s.adjustmentDelta) > 0 && s.isReliable && !s.cooldownStatus?.inCooldown
    );
    if (!needsAdjustment) {
      return {
        success: true,
        message: "\u5F53\u524D\u4F4D\u7F6E\u503E\u659C\u8BBE\u7F6E\u5DF2\u63A5\u8FD1\u6700\u4F18\uFF0C\u6216\u6570\u636E\u4E0D\u8DB3/\u5728\u51B7\u5374\u671F\u5185\uFF0C\u65E0\u9700\u8C03\u6574",
        suggestions,
        benchmarksUsed: benchmarks,
        biddingStrategy
      };
    }
    if (!options?.dryRun) {
      await updatePlacementSettings(campaignId, accountId, suggestions);
    }
    const adjustedCount = suggestions.filter(
      (s) => Math.abs(s.adjustmentDelta) > 0 && s.isReliable && !s.cooldownStatus?.inCooldown
    ).length;
    return {
      success: true,
      message: options?.dryRun ? `\u6A21\u62DF\u8FD0\u884C\uFF1A\u5EFA\u8BAE\u8C03\u6574${adjustedCount}\u4E2A\u4F4D\u7F6E\u7684\u503E\u659C\u8BBE\u7F6E` : `\u6210\u529F\u66F4\u65B0${adjustedCount}\u4E2A\u4F4D\u7F6E\u7684\u503E\u659C\u8BBE\u7F6E`,
      suggestions,
      benchmarksUsed: benchmarks,
      biddingStrategy
    };
  } catch (error48) {
    log106.warn("[PlacementOptimization] \u4F4D\u7F6E\u503E\u659C\u4F18\u5316\u6267\u884C\u5931\u8D25:", error48);
    return {
      success: false,
      message: `\u4F18\u5316\u6267\u884C\u5931\u8D25: ${error48 instanceof Error ? error48.message : "\u672A\u77E5\u9519\u8BEF"}`,
      suggestions: []
    };
  }
}
async function batchExecutePlacementOptimization(accountId, campaignIds) {
  let campaignsToOptimize = [];
  if (campaignIds && campaignIds.length > 0) {
    campaignsToOptimize = campaignIds.map((id) => ({ amazonCampaignId: id }));
  } else {
    const db = await getDb();
    if (!db) throw new Error("Database connection failed");
    const allCampaigns = await db.select().from(campaigns).where(
      and(
        eq(campaigns.accountId, accountId),
        eq(campaigns.campaignStatus, "enabled")
      )
    );
    campaignsToOptimize = allCampaigns.filter((c) => c.campaignId && c.campaignId !== "0" && c.campaignId !== "").map((c) => ({ amazonCampaignId: String(c.campaignId) }));
  }
  const results = [];
  let successCount = 0;
  let failedCount = 0;
  let skippedCount = 0;
  for (const campaign of campaignsToOptimize) {
    if (!campaign.amazonCampaignId) continue;
    const result = await executeAutomaticPlacementOptimization(
      // @ts-ignore
      campaign.amazonCampaignId,
      accountId
    );
    const wasSkipped = result.suggestions.every(
      (s) => s.cooldownStatus?.inCooldown || !s.isReliable
    );
    results.push({
      // @ts-ignore
      campaignId: campaign.amazonCampaignId,
      success: result.success,
      message: result.message,
      skippedReason: wasSkipped ? "\u51B7\u5374\u671F\u5185\u6216\u6570\u636E\u4E0D\u8DB3" : void 0
    });
    if (wasSkipped) {
      skippedCount++;
    } else if (result.success) {
      successCount++;
    } else {
      failedCount++;
    }
  }
  return {
    total: campaignsToOptimize.length,
    // @ts-ignore
    success: successCount,
    // @ts-ignore
    failed: failedCount,
    // @ts-ignore
    skipped: skippedCount,
    // @ts-ignore
    results
  };
}
async function analyzePlacementPerformance(campaignId, accountId) {
  const performance = await getCampaignPlacementPerformance(campaignId, accountId);
  if (!performance || performance.length === 0) return null;
  return {
    campaignId,
    placements: performance,
    analysis: {
      // @ts-ignore
      bestPerforming: performance.reduce((best, p) => (
        // @ts-ignore
        (p.metrics?.roas || 0) > (best?.metrics?.roas || 0) ? p : best
      ), performance[0]),
      // @ts-ignore
      worstPerforming: performance.reduce((worst, p) => (
        // @ts-ignore
        (p.metrics?.roas || Infinity) < (worst?.metrics?.roas || Infinity) ? p : worst
      ), performance[0]),
      reliableDataCount: performance.filter((p) => p.isReliable).length,
      totalPlacements: performance.length
      // @ts-ignore
    }
  };
}
async function generatePlacementSuggestions(campaignId, accountId) {
  const performance = await getCampaignPlacementPerformance(campaignId, accountId);
  if (!performance || performance.length === 0) return [];
  const currentAdjustments = await getCampaignPlacementSettings(campaignId, accountId);
  const adjustmentSuggestions = await calculateOptimalAdjustment(
    performance,
    currentAdjustments,
    campaignId,
    // @ts-ignore
    accountId
  );
  const suggestions = [];
  for (const suggestion of adjustmentSuggestions) {
    const adjustmentDelta = Math.abs(suggestion.suggestedAdjustment - suggestion.currentAdjustment);
    if (adjustmentDelta > 0) {
      suggestions.push({
        // @ts-ignore
        placement: suggestion.placementType,
        // @ts-ignore
        currentAdjustment: suggestion.currentAdjustment,
        // @ts-ignore
        suggestedAdjustment: suggestion.suggestedAdjustment,
        // @ts-ignore
        suggestedMultiplier: 1 + suggestion.suggestedAdjustment / 100,
        // @ts-ignore
        currentMultiplier: 1 + suggestion.currentAdjustment / 100,
        // @ts-ignore
        reason: suggestion.reason,
        // @ts-ignore
        isReliable: suggestion.isReliable,
        // @ts-ignore
        confidence: suggestion.confidence,
        // @ts-ignore
        cooldownStatus: suggestion.cooldownStatus
      });
    }
  }
  return suggestions;
}
async function applyPlacementAdjustment(campaignId, accountId, adjustment) {
  try {
    await updatePlacementSettings(campaignId, accountId, [{
      // @ts-expect-error - runtime type mismatch
      placementType: adjustment.placement,
      // @ts-expect-error - runtime type mismatch
      currentAdjustment: adjustment.currentAdjustment || 0,
      // @ts-expect-error - runtime type mismatch
      suggestedAdjustment: adjustment.suggestedAdjustment,
      // @ts-expect-error - runtime type mismatch
      adjustmentDelta: adjustment.suggestedAdjustment - (adjustment.currentAdjustment || 0),
      efficiencyScore: 0,
      confidence: 1,
      isReliable: true,
      // @ts-expect-error - runtime type mismatch
      reason: adjustment.reason || ""
    }]);
    return true;
  } catch (error48) {
    log106.warn("[placementOptimizationService] applyPlacementAdjustment error:", error48);
    return false;
  }
}
var log106, DEFAULT_WEIGHTS, DEFAULT_BENCHMARKS, ADJUSTMENT_COOLDOWN_DAYS, ATTRIBUTION_DELAY_DAYS2;
var init_placementOptimizationService = __esm({
  "server/optimization/placementOptimizationService.ts"() {
    "use strict";
    init_logger();
    init_db2();
    init_schema2();
    init_drizzle_orm();
    init_timeDecayWeightedDataService();
    log106 = createModuleLogger("PlacementOptimizationService");
    DEFAULT_WEIGHTS = {
      roasWeight: 0.35,
      acosWeight: 0.25,
      cvrWeight: 0.25,
      cpcWeight: 0.15
    };
    DEFAULT_BENCHMARKS = {
      roasBaseline: 5,
      acosBaseline: 100,
      cvrBaseline: 15,
      // 从20%降低到15%，更符合实际
      cpcBaseline: 2
    };
    ADJUSTMENT_COOLDOWN_DAYS = 7;
    ATTRIBUTION_DELAY_DAYS2 = 3;
    __name(calculateDataConfidence, "calculateDataConfidence");
    __name(calculateDynamicBenchmarks, "calculateDynamicBenchmarks");
    __name(checkAdjustmentCooldown, "checkAdjustmentCooldown");
    __name(getCampaignBiddingStrategy, "getCampaignBiddingStrategy");
    __name(getMaxAdjustmentByBiddingStrategy, "getMaxAdjustmentByBiddingStrategy");
    __name(calculateEfficiencyScore, "calculateEfficiencyScore");
    __name(calculateAdjustmentDelta, "calculateAdjustmentDelta");
    __name(calculateOptimalAdjustment, "calculateOptimalAdjustment");
    __name(getCampaignPlacementPerformance, "getCampaignPlacementPerformance");
    __name(getCampaignPlacementSettings, "getCampaignPlacementSettings");
    __name(recordPlacementAdjustment, "recordPlacementAdjustment");
    __name(updatePlacementSettings, "updatePlacementSettings");
    __name(executeAutomaticPlacementOptimization, "executeAutomaticPlacementOptimization");
    __name(batchExecutePlacementOptimization, "batchExecutePlacementOptimization");
    __name(analyzePlacementPerformance, "analyzePlacementPerformance");
    __name(generatePlacementSuggestions, "generatePlacementSuggestions");
    __name(applyPlacementAdjustment, "applyPlacementAdjustment");
  }
});

