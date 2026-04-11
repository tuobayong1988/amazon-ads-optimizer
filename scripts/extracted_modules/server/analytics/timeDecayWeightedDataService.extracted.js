// Extracted from production dist/index.js
// Original module: server/analytics/timeDecayWeightedDataService.ts
// Lines: 365

function aggregateByTimeWindows(dailyData, windows = TIME_WINDOWS) {
  const today = /* @__PURE__ */ new Date();
  today.setHours(0, 0, 0, 0);
  return windows.map((window2) => {
    const windowData = dailyData.filter((d) => {
      const dataDate = new Date(d.date);
      dataDate.setHours(0, 0, 0, 0);
      const daysAgo = Math.floor((today.getTime() - dataDate.getTime()) / (1e3 * 60 * 60 * 24));
      return daysAgo >= window2.startDaysAgo && daysAgo <= window2.endDaysAgo;
    });
    const totalDays = window2.endDaysAgo - window2.startDaysAgo + 1;
    const daysCount = windowData.length;
    const rawImpressions = windowData.reduce((sum2, d) => sum2 + d.impressions, 0);
    const rawClicks = windowData.reduce((sum2, d) => sum2 + d.clicks, 0);
    const rawSpend = windowData.reduce((sum2, d) => sum2 + d.spend, 0);
    const rawSales = windowData.reduce((sum2, d) => sum2 + d.sales, 0);
    const rawOrders = windowData.reduce((sum2, d) => sum2 + d.orders, 0);
    const attributionMultiplier = window2.attributionCompleteness > 0 ? 1 / window2.attributionCompleteness : 1;
    const correctedSales = rawSales * attributionMultiplier;
    const correctedOrders = rawOrders * attributionMultiplier;
    const effectiveDays = Math.max(daysCount, 1);
    const dailyAvgSpend = rawSpend / effectiveDays;
    const dailyAvgSales = correctedSales / effectiveDays;
    const dailyAvgOrders = correctedOrders / effectiveDays;
    const acos = correctedSales > 0 ? rawSpend / correctedSales * 100 : 0;
    const roas = rawSpend > 0 ? correctedSales / rawSpend : 0;
    const ctr = rawImpressions > 0 ? rawClicks / rawImpressions * 100 : 0;
    const cvr = rawClicks > 0 ? correctedOrders / rawClicks * 100 : 0;
    const cpc = rawClicks > 0 ? rawSpend / rawClicks : 0;
    return {
      windowName: window2.name,
      daysCount,
      totalDays,
      rawImpressions,
      rawClicks,
      rawSpend,
      rawSales,
      rawOrders,
      correctedSales,
      correctedOrders,
      dailyAvgSpend,
      dailyAvgSales,
      dailyAvgOrders,
      acos,
      roas,
      ctr,
      cvr,
      cpc
    };
  });
}
function calculateTimeWeightedMetrics(dailyData, windows = TIME_WINDOWS) {
  const windowDetails = aggregateByTimeWindows(dailyData, windows);
  const activeWindows = [];
  let totalActiveWeight = 0;
  for (let i = 0; i < windowDetails.length; i++) {
    const detail = windowDetails[i];
    const window2 = windows[i];
    if (detail.daysCount > 0 && detail.rawSpend > 0) {
      activeWindows.push({ detail, window: window2, effectiveWeight: window2.baseWeight });
      totalActiveWeight += window2.baseWeight;
    }
  }
  if (totalActiveWeight > 0) {
    for (const aw of activeWindows) {
      aw.effectiveWeight = aw.effectiveWeight / totalActiveWeight;
    }
  }
  let weightedAcos = 0, weightedRoas = 0, weightedCtr = 0, weightedCvr = 0, weightedCpc = 0;
  let weightedDailySpend = 0, weightedDailySales = 0, weightedDailyOrders = 0;
  for (const aw of activeWindows) {
    const w = aw.effectiveWeight;
    const d = aw.detail;
    weightedAcos += d.acos * w;
    weightedRoas += d.roas * w;
    weightedCtr += d.ctr * w;
    weightedCvr += d.cvr * w;
    weightedCpc += d.cpc * w;
    weightedDailySpend += d.dailyAvgSpend * w;
    weightedDailySales += d.dailyAvgSales * w;
    weightedDailyOrders += d.dailyAvgOrders * w;
  }
  const totalDaysWithData = windowDetails.reduce((sum2, d) => sum2 + d.daysCount, 0);
  const totalPossibleDays = 90;
  const coveragePercent = totalDaysWithData / totalPossibleDays * 100;
  const recentDataAvailable = windowDetails[0].daysCount > 0 || windowDetails[1].daysCount > 0;
  let confidenceLevel;
  if (totalDaysWithData >= 21 && recentDataAvailable) {
    confidenceLevel = "high";
  } else if (totalDaysWithData >= 10) {
    confidenceLevel = "medium";
  } else if (totalDaysWithData >= 3) {
    confidenceLevel = "low";
  } else {
    confidenceLevel = "insufficient";
  }
  const recentWindows = activeWindows.filter(
    (aw) => aw.window.name === "recent_high_value" || aw.window.name === "mid_term_stable"
  );
  const olderWindows = activeWindows.filter(
    (aw) => aw.window.name === "baseline_reference" || aw.window.name === "historical_reference"
  );
  let trendSignal = {
    direction: "stable",
    strength: 0,
    description: "\u6570\u636E\u4E0D\u8DB3\uFF0C\u65E0\u6CD5\u5224\u65AD\u8D8B\u52BF"
  };
  if (recentWindows.length > 0 && olderWindows.length > 0) {
    const recentAvgRoas = recentWindows.reduce((sum2, aw) => sum2 + aw.detail.roas, 0) / recentWindows.length;
    const olderAvgRoas = olderWindows.reduce((sum2, aw) => sum2 + aw.detail.roas, 0) / olderWindows.length;
    if (olderAvgRoas > 0) {
      const roasChange = (recentAvgRoas - olderAvgRoas) / olderAvgRoas;
      if (roasChange > 0.1) {
        trendSignal = {
          direction: "improving",
          strength: Math.min(1, roasChange),
          description: `ROAS\u8FD1\u671F\u63D0\u5347${(roasChange * 100).toFixed(0)}%\uFF0C\u8868\u73B0\u6539\u5584\u4E2D`
        };
      } else if (roasChange < -0.1) {
        trendSignal = {
          direction: "declining",
          strength: Math.min(1, Math.abs(roasChange)),
          description: `ROAS\u8FD1\u671F\u4E0B\u964D${(Math.abs(roasChange) * 100).toFixed(0)}%\uFF0C\u9700\u8981\u5173\u6CE8`
        };
      } else {
        trendSignal = {
          direction: "stable",
          strength: Math.abs(roasChange),
          description: `ROAS\u8FD1\u671F\u53D8\u5316${(roasChange * 100).toFixed(0)}%\uFF0C\u8868\u73B0\u7A33\u5B9A`
        };
      }
    }
  }
  return {
    weightedAcos,
    weightedRoas,
    weightedCtr,
    weightedCvr,
    weightedCpc,
    weightedDailySpend,
    weightedDailySales,
    weightedDailyOrders,
    windowDetails,
    dataQuality: {
      // @ts-ignore
      totalDaysWithData,
      coveragePercent,
      recentDataAvailable,
      confidenceLevel
    },
    trendSignal
  };
}
function detectDataCliff(dailyData, recentOptimizationEvents) {
  const noCliff = {
    cliffDetected: false,
    cliffType: "none",
    dropMagnitude: 0,
    cliffDaysAgo: 0,
    recommendedMinWindowDays: 7,
    likelyOptimizationCaused: false,
    diagnosis: "\u672A\u68C0\u6D4B\u5230\u6570\u636E\u60AC\u5D16"
  };
  if (dailyData.length < 14) {
    return { ...noCliff, diagnosis: "\u6570\u636E\u4E0D\u8DB314\u5929\uFF0C\u65E0\u6CD5\u8FDB\u884C\u60AC\u5D16\u68C0\u6D4B" };
  }
  const sorted = [...dailyData].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const today = /* @__PURE__ */ new Date();
  today.setHours(0, 0, 0, 0);
  const weekBuckets = [];
  for (let w = 0; w < 13; w++) {
    const weekStart = w * 7;
    const weekEnd = (w + 1) * 7 - 1;
    const weekData = sorted.filter((d) => {
      const dataDate = new Date(d.date);
      dataDate.setHours(0, 0, 0, 0);
      const daysAgo = Math.floor((today.getTime() - dataDate.getTime()) / (1e3 * 60 * 60 * 24));
      return daysAgo >= weekStart && daysAgo <= weekEnd;
    });
    if (weekData.length > 0) {
      weekBuckets.push({
        weekIndex: w,
        avgImpressions: weekData.reduce((s, d) => s + d.impressions, 0) / weekData.length,
        avgClicks: weekData.reduce((s, d) => s + d.clicks, 0) / weekData.length,
        avgSpend: weekData.reduce((s, d) => s + d.spend, 0) / weekData.length,
        avgSales: weekData.reduce((s, d) => s + d.sales, 0) / weekData.length,
        daysWithData: weekData.length
      });
    }
  }
  if (weekBuckets.length < 3) {
    return { ...noCliff, diagnosis: "\u6709\u6548\u5468\u6570\u636E\u4E0D\u8DB33\u5468\uFF0C\u65E0\u6CD5\u8FDB\u884C\u60AC\u5D16\u68C0\u6D4B" };
  }
  const CLIFF_THRESHOLD = 0.5;
  const STABILITY_THRESHOLD = 0.3;
  const cliffCandidates = [];
  for (let i = 0; i < weekBuckets.length - 1; i++) {
    const recentWeek = weekBuckets[i];
    const olderWeek = weekBuckets[i + 1];
    if (olderWeek.avgImpressions > 50) {
      const impressionDrop = (olderWeek.avgImpressions - recentWeek.avgImpressions) / olderWeek.avgImpressions;
      if (impressionDrop > CLIFF_THRESHOLD) {
        cliffCandidates.push({
          type: "impression_cliff",
          weekIndex: i,
          dropMagnitude: impressionDrop,
          beforeAvg: olderWeek.avgImpressions,
          afterAvg: recentWeek.avgImpressions
        });
      }
    }
    if (olderWeek.avgClicks > 2) {
      const clickDrop = (olderWeek.avgClicks - recentWeek.avgClicks) / olderWeek.avgClicks;
      if (clickDrop > CLIFF_THRESHOLD) {
        cliffCandidates.push({
          type: "click_cliff",
          weekIndex: i,
          dropMagnitude: clickDrop,
          beforeAvg: olderWeek.avgClicks,
          afterAvg: recentWeek.avgClicks
        });
      }
    }
    if (olderWeek.avgSpend > 1) {
      const spendDrop = (olderWeek.avgSpend - recentWeek.avgSpend) / olderWeek.avgSpend;
      if (spendDrop > CLIFF_THRESHOLD) {
        cliffCandidates.push({
          type: "spend_cliff",
          weekIndex: i,
          dropMagnitude: spendDrop,
          beforeAvg: olderWeek.avgSpend,
          afterAvg: recentWeek.avgSpend
        });
      }
    }
  }
  if (cliffCandidates.length === 0) {
    return noCliff;
  }
  cliffCandidates.sort((a, b) => b.dropMagnitude - a.dropMagnitude);
  const worstCliff = cliffCandidates[0];
  const cliffDaysAgo = (worstCliff.weekIndex + 1) * 7;
  const recommendedMinWindowDays = Math.min(90, cliffDaysAgo + 14);
  let likelyOptimizationCaused = false;
  if (recentOptimizationEvents && recentOptimizationEvents.length > 0) {
    const cliffDate = new Date(today);
    cliffDate.setDate(cliffDate.getDate() - cliffDaysAgo);
    const cliffWindowStart = new Date(cliffDate.getTime() - 7 * 24 * 36e5);
    const cliffWindowEnd = new Date(cliffDate.getTime() + 3 * 24 * 36e5);
    const nearbyBidDecreases = recentOptimizationEvents.filter((evt) => {
      const evtDate = new Date(evt.date);
      return evtDate >= cliffWindowStart && evtDate <= cliffWindowEnd && evt.actionType === "bid_decrease" && evt.bidChange < -0.15;
    });
    likelyOptimizationCaused = nearbyBidDecreases.length > 0;
  }
  const diagnosis = likelyOptimizationCaused ? `\u68C0\u6D4B\u5230${worstCliff.type}\uFF1A\u65E5\u5747${worstCliff.beforeAvg.toFixed(1)}\u2192${worstCliff.afterAvg.toFixed(1)}\uFF08\u4E0B\u964D${(worstCliff.dropMagnitude * 100).toFixed(0)}%\uFF09\uFF0C\u7EA6${cliffDaysAgo}\u5929\u524D\u53D1\u751F\uFF0C\u53EF\u80FD\u7531\u8FD1\u671F\u51FA\u4EF7\u8C03\u6574\u5F15\u8D77\u3002\u5EFA\u8BAE\u4F7F\u7528${recommendedMinWindowDays}\u5929\u4EE5\u4E0A\u7684\u6570\u636E\u7A97\u53E3\u3002` : `\u68C0\u6D4B\u5230${worstCliff.type}\uFF1A\u65E5\u5747${worstCliff.beforeAvg.toFixed(1)}\u2192${worstCliff.afterAvg.toFixed(1)}\uFF08\u4E0B\u964D${(worstCliff.dropMagnitude * 100).toFixed(0)}%\uFF09\uFF0C\u7EA6${cliffDaysAgo}\u5929\u524D\u53D1\u751F\u3002\u5EFA\u8BAE\u4F7F\u7528${recommendedMinWindowDays}\u5929\u4EE5\u4E0A\u7684\u6570\u636E\u7A97\u53E3\u3002`;
  return {
    cliffDetected: true,
    cliffType: worstCliff.type,
    dropMagnitude: worstCliff.dropMagnitude,
    cliffDaysAgo,
    recommendedMinWindowDays,
    likelyOptimizationCaused,
    diagnosis
  };
}
function calculateCliffAwareTimeWeightedMetrics(dailyData, recentOptimizationEvents) {
  const cliffResult = detectDataCliff(dailyData, recentOptimizationEvents);
  if (!cliffResult.cliffDetected) {
    const metrics2 = calculateTimeWeightedMetrics(dailyData);
    return { ...metrics2, cliffDetection: cliffResult };
  }
  const adjustedWindows = TIME_WINDOWS.map((w) => {
    const windowMidpoint = (w.startDaysAgo + w.endDaysAgo) / 2;
    if (windowMidpoint < cliffResult.cliffDaysAgo) {
      const reductionFactor = cliffResult.likelyOptimizationCaused ? 0.15 : 0.3;
      return { ...w, baseWeight: w.baseWeight * reductionFactor };
    } else {
      return { ...w, baseWeight: w.baseWeight * 1.5 };
    }
  });
  const metrics = calculateTimeWeightedMetrics(dailyData, adjustedWindows);
  if (cliffResult.likelyOptimizationCaused && metrics.trendSignal.direction !== "declining") {
    metrics.trendSignal = {
      direction: "declining",
      strength: cliffResult.dropMagnitude,
      description: `[v491\u60AC\u5D16\u68C0\u6D4B] ${cliffResult.diagnosis}`
    };
  }
  return { ...metrics, cliffDetection: cliffResult };
}
var TIME_WINDOWS;
var init_timeDecayWeightedDataService = __esm({
  "server/analytics/timeDecayWeightedDataService.ts"() {
    "use strict";
    init_db2();
    TIME_WINDOWS = [
      {
        name: "attribution_incomplete",
        // 归因不完整期
        startDaysAgo: 0,
        endDaysAgo: 3,
        baseWeight: 0.05,
        // 极低权重
        attributionCompleteness: 0.35
        // 仅35%的订单已归因
      },
      {
        name: "recent_high_value",
        // 近期高价值期
        startDaysAgo: 4,
        endDaysAgo: 7,
        baseWeight: 0.3,
        // 最高权重
        attributionCompleteness: 0.75
        // 75%的订单已归因
      },
      {
        name: "mid_term_stable",
        // 中期稳定期
        startDaysAgo: 8,
        endDaysAgo: 14,
        baseWeight: 0.28,
        // 较高权重
        attributionCompleteness: 0.92
        // 92%的订单已归因
      },
      {
        name: "baseline_reference",
        // 基准参考期
        startDaysAgo: 15,
        endDaysAgo: 30,
        baseWeight: 0.22,
        // 中等权重
        attributionCompleteness: 1
        // 完全归因
      },
      {
        name: "historical_reference",
        // 历史参考期
        startDaysAgo: 31,
        endDaysAgo: 60,
        baseWeight: 0.1,
        // 较低权重
        attributionCompleteness: 1
        // 完全归因
      },
      {
        name: "long_term_reference",
        // 远期参考期
        startDaysAgo: 61,
        endDaysAgo: 90,
        baseWeight: 0.05,
        // 很低权重
        attributionCompleteness: 1
        // 完全归因
      }
    ];
    __name(aggregateByTimeWindows, "aggregateByTimeWindows");
    __name(calculateTimeWeightedMetrics, "calculateTimeWeightedMetrics");
    __name(detectDataCliff, "detectDataCliff");
    __name(calculateCliffAwareTimeWeightedMetrics, "calculateCliffAwareTimeWeightedMetrics");
  }
});

