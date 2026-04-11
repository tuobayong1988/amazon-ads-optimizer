// Extracted from production dist/index.js
// Original module: server/algorithm/goalProgressAlgorithm.ts
// Lines: 875

function getWeights(strategyTemplateId) {
  const baseWeights = !strategyTemplateId ? DEFAULT_WEIGHTS2 : STRATEGY_WEIGHTS[strategyTemplateId] || DEFAULT_WEIGHTS2;
  let weightModule = null;
  try {
    if (strategyTemplateId) {
      if (!weightModule) {
        weightModule = (init_weightAutoTuningService(), __toCommonJS(weightAutoTuningService_exports));
      }
      const getEffectiveWeights2 = weightModule.getEffectiveWeights;
      if (typeof getEffectiveWeights2 === "function") {
        const tunedWeights = getEffectiveWeights2(strategyTemplateId, baseWeights);
        if (tunedWeights && Object.keys(tunedWeights).length > 0) {
          return tunedWeights;
        }
      }
    }
  } catch (_e) {
  }
  return baseWeights;
}
function getConfidenceMultiplier(confidence) {
  switch (confidence) {
    case "high":
      return 1;
    case "medium":
      return 0.9;
    case "low":
      return 0.75;
    case "very_low":
      return 0.6;
    default:
      return 0.8;
  }
}
function calculateCoreMetricScore(config2, metrics, timeWeighted) {
  const { optimizationGoal, targetAcos, targetRoas } = config2;
  if (metrics.totalSpend < 0.5 && metrics.totalSales < 0.5) {
    return { score: 0, detail: "\u6570\u636E\u4E0D\u8DB3\uFF0C\u6682\u65E0\u6CD5\u8BC4\u4F30" };
  }
  const effectiveAcos = timeWeighted ? timeWeighted.weightedAcos : metrics.avgAcos;
  const effectiveRoas = timeWeighted ? timeWeighted.weightedRoas : metrics.avgRoas;
  const dataSource = timeWeighted ? "\u65F6\u95F4\u8870\u51CF\u52A0\u6743" : "\u7B80\u5355\u5E73\u5747";
  if ((optimizationGoal === "target_acos" || targetAcos) && targetAcos && targetAcos > 0) {
    if (effectiveAcos <= 0 && metrics.totalSales > 0) {
      return { score: 100, detail: `\u5B8C\u7F8E\uFF1A\u6709\u9500\u552E\u65E0\u82B1\u8D39\uFF0CACoS=0%\uFF08\u76EE\u6807\u2264${targetAcos}%\uFF09[${dataSource}]` };
    }
    if (effectiveAcos <= 0) {
      return { score: 0, detail: `\u65E0\u6709\u6548\u6570\u636E\uFF08\u76EE\u6807ACoS\u2264${targetAcos}%\uFF09` };
    }
    const ratio = targetAcos / effectiveAcos;
    let score2;
    if (ratio >= 1) {
      score2 = 100;
    } else if (ratio >= 0.8) {
      score2 = 70 + (ratio - 0.8) / 0.2 * 30;
    } else if (ratio >= 0.5) {
      score2 = 30 + (ratio - 0.5) / 0.3 * 40;
    } else {
      score2 = Math.max(5, ratio / 0.5 * 30);
    }
    return {
      score: Math.round(score2),
      detail: `${dataSource}ACoS ${effectiveAcos.toFixed(1)}% / \u76EE\u6807\u2264${targetAcos}%\uFF08\u8FBE\u6210\u7387${(ratio * 100).toFixed(0)}%\uFF09`
    };
  }
  if ((optimizationGoal === "target_roas" || targetRoas) && targetRoas && targetRoas > 0) {
    if (effectiveRoas <= 0) {
      return { score: 5, detail: `ROAS=0\uFF08\u76EE\u6807\u2265${targetRoas}\uFF09` };
    }
    const ratio = effectiveRoas / targetRoas;
    let score2;
    if (ratio >= 1) {
      score2 = 100;
    } else if (ratio >= 0.8) {
      score2 = 70 + (ratio - 0.8) / 0.2 * 30;
    } else if (ratio >= 0.5) {
      score2 = 30 + (ratio - 0.5) / 0.3 * 40;
    } else {
      score2 = Math.max(5, ratio / 0.5 * 30);
    }
    return {
      score: Math.round(score2),
      detail: `${dataSource}ROAS ${effectiveRoas.toFixed(2)} / \u76EE\u6807\u2265${targetRoas}\uFF08\u8FBE\u6210\u7387${(ratio * 100).toFixed(0)}%\uFF09`
    };
  }
  if (optimizationGoal === "maximize_sales") {
    const roas2 = effectiveRoas;
    let score2;
    if (roas2 >= 3) score2 = 100;
    else if (roas2 >= 2) score2 = 80 + (roas2 - 2) * 20;
    else if (roas2 >= 1) score2 = 50 + (roas2 - 1) * 30;
    else if (roas2 > 0) score2 = Math.max(10, roas2 * 50);
    else score2 = 5;
    return {
      score: Math.round(score2),
      detail: `${dataSource}ROAS ${roas2.toFixed(2)}\uFF08\u9500\u552E\u6700\u5927\u5316\u6A21\u5F0F\uFF09`
    };
  }
  if (optimizationGoal === "daily_spend_limit" || optimizationGoal === "daily_cost") {
    const dailyLimit = config2.dailySpendLimit || config2.dailyBudget || 0;
    if (dailyLimit <= 0) {
      return { score: 50, detail: "\u672A\u8BBE\u7F6E\u82B1\u8D39\u4E0A\u9650\u76EE\u6807" };
    }
    const avgDailySpend = timeWeighted ? timeWeighted.weightedDailySpend : metrics.totalSpend / Math.max(1, 30);
    const ratio = avgDailySpend / dailyLimit;
    let score2;
    if (ratio <= 1 && ratio >= 0.7) {
      score2 = 100;
    } else if (ratio < 0.7 && ratio >= 0.3) {
      score2 = 60 + (ratio - 0.3) / 0.4 * 40;
    } else if (ratio < 0.3) {
      score2 = Math.max(20, ratio / 0.3 * 60);
    } else if (ratio <= 1.2) {
      score2 = 80;
    } else {
      score2 = Math.max(10, 80 - (ratio - 1.2) * 100);
    }
    return {
      score: Math.round(Math.min(100, Math.max(5, score2))),
      detail: `${dataSource}\u65E5\u5747\u82B1\u8D39$${avgDailySpend.toFixed(2)} / \u4E0A\u9650$${dailyLimit.toFixed(2)}`
    };
  }
  const roas = effectiveRoas;
  let score = roas >= 2 ? 80 : roas >= 1 ? 60 : Math.max(20, roas * 60);
  return {
    score: Math.round(score),
    detail: `${dataSource}ROAS ${roas.toFixed(2)}\uFF08\u901A\u7528\u8BC4\u4F30\uFF09`
  };
}
function calculateTrendScore(trendData, config2, timeWeighted, multiWindow) {
  if (multiWindow) {
    return calculateMultiWindowTrendScore(multiWindow, config2, timeWeighted);
  }
  const { before, after } = trendData;
  if (!before || !after) {
    if (after && after.days > 0 && after.totalSpend > 0) {
      const afterRoas = after.totalSpend > 0 ? after.totalSales / after.totalSpend : 0;
      const score2 = afterRoas >= 2 ? 70 : afterRoas >= 1 ? 55 : 40;
      return { score: score2, detail: `\u65B0\u4F18\u5316\u76EE\u6807\uFF0CROAS=${afterRoas.toFixed(2)}\uFF08\u65E0\u5386\u53F2\u5BF9\u6BD4\uFF09` };
    }
    return { score: 50, detail: "\u6570\u636E\u4E0D\u8DB3\uFF0C\u65E0\u6CD5\u8FDB\u884C\u8D8B\u52BF\u5BF9\u6BD4" };
  }
  if (before.days < 3 || after.days < 3) {
    return { score: 50, detail: `\u6570\u636E\u5929\u6570\u4E0D\u8DB3\uFF08\u524D${before.days}\u5929/\u540E${after.days}\u5929\uFF09` };
  }
  const beforeAcos = before.totalSales > 0 ? before.totalSpend / before.totalSales * 100 : 999;
  const afterAcos = after.totalSales > 0 ? after.totalSpend / after.totalSales * 100 : 999;
  const beforeDailySales = before.totalSales / before.days;
  const afterDailySales = after.totalSales / after.days;
  const beforeDailyOrders = before.totalOrders / before.days;
  const afterDailyOrders = after.totalOrders / after.days;
  let trendPoints = 0;
  let maxPoints = 0;
  const improvements = [];
  maxPoints += 30;
  if (beforeAcos < 900 && afterAcos < 900) {
    const acosImprovement = (beforeAcos - afterAcos) / Math.max(beforeAcos, 1);
    if (acosImprovement > 0.15) {
      trendPoints += 30;
      improvements.push(`ACoS\u2193${(acosImprovement * 100).toFixed(0)}%`);
    } else if (acosImprovement > 0.05) {
      trendPoints += 22;
      improvements.push(`ACoS\u2193${(acosImprovement * 100).toFixed(0)}%`);
    } else if (acosImprovement > -0.05) {
      trendPoints += 15;
      improvements.push("ACoS\u6301\u5E73");
    } else if (acosImprovement > -0.15) {
      trendPoints += 8;
      improvements.push(`ACoS\u2191${(-acosImprovement * 100).toFixed(0)}%`);
    } else {
      trendPoints += 0;
      improvements.push(`ACoS\u2191${(-acosImprovement * 100).toFixed(0)}%`);
    }
  } else {
    trendPoints += 15;
  }
  maxPoints += 30;
  if (beforeDailySales > 0) {
    const salesGrowth = (afterDailySales - beforeDailySales) / beforeDailySales;
    if (salesGrowth > 0.2) {
      trendPoints += 30;
      improvements.push(`\u65E5\u9500\u2191${(salesGrowth * 100).toFixed(0)}%`);
    } else if (salesGrowth > 0.05) {
      trendPoints += 22;
      improvements.push(`\u65E5\u9500\u2191${(salesGrowth * 100).toFixed(0)}%`);
    } else if (salesGrowth > -0.05) {
      trendPoints += 15;
      improvements.push("\u65E5\u9500\u6301\u5E73");
    } else if (salesGrowth > -0.2) {
      trendPoints += 8;
      improvements.push(`\u65E5\u9500\u2193${(-salesGrowth * 100).toFixed(0)}%`);
    } else {
      trendPoints += 0;
      improvements.push(`\u65E5\u9500\u2193${(-salesGrowth * 100).toFixed(0)}%`);
    }
  } else if (afterDailySales > 0) {
    trendPoints += 25;
    improvements.push("\u5F00\u59CB\u4EA7\u751F\u9500\u552E");
  } else {
    trendPoints += 10;
  }
  maxPoints += 20;
  if (beforeDailyOrders > 0) {
    const ordersGrowth = (afterDailyOrders - beforeDailyOrders) / beforeDailyOrders;
    if (ordersGrowth > 0.15) {
      trendPoints += 20;
      improvements.push(`\u65E5\u5355\u2191${(ordersGrowth * 100).toFixed(0)}%`);
    } else if (ordersGrowth > 0) {
      trendPoints += 15;
    } else if (ordersGrowth > -0.1) {
      trendPoints += 10;
    } else {
      trendPoints += 3;
    }
  } else if (afterDailyOrders > 0) {
    trendPoints += 18;
  } else {
    trendPoints += 5;
  }
  maxPoints += 20;
  if (timeWeighted) {
    if (timeWeighted.trendDirection === "improving") {
      trendPoints += 20;
      improvements.push("\u8FD1\u671F\u8D8B\u52BF\u5411\u597D");
    } else if (timeWeighted.trendDirection === "stable") {
      trendPoints += 12;
      improvements.push("\u8FD1\u671F\u8D8B\u52BF\u7A33\u5B9A");
    } else {
      trendPoints += 4;
      improvements.push("\u8FD1\u671F\u8D8B\u52BF\u4E0B\u884C");
    }
  } else {
    trendPoints += 10;
  }
  maxPoints += 10;
  if (beforeAcos < 900 && afterAcos < 900 && afterAcos > (config2.targetAcos || 30)) {
    const acosImprovement = (beforeAcos - afterAcos) / Math.max(beforeAcos, 1);
    if (acosImprovement > 0.1 && timeWeighted?.trendDirection === "improving") {
      trendPoints += 10;
      improvements.push(`v268\u65B9\u5411\u6B63\u786E\u52A0\u5206: ACoS\u672A\u8FBE\u6807\u4F46\u6301\u7EED\u6539\u5584${(acosImprovement * 100).toFixed(0)}%`);
    } else if (acosImprovement > 0.05) {
      trendPoints += 6;
    } else {
      trendPoints += 2;
    }
  } else {
    trendPoints += 5;
  }
  const score = maxPoints > 0 ? Math.round(trendPoints / maxPoints * 100) : 50;
  const detail = improvements.length > 0 ? improvements.join("\uFF0C") : "\u8D8B\u52BF\u6570\u636E\u8BA1\u7B97\u4E2D";
  return { score: Math.min(100, Math.max(5, score)), detail };
}
function calculateMultiWindowTrendScore(multiWindow, config2, timeWeighted) {
  let totalPoints = 0;
  let maxPoints = 0;
  const improvements = [];
  const windows = [
    { label: "7\u5929", data: multiWindow.recent7d },
    { label: "14\u5929", data: multiWindow.recent14d },
    { label: "30\u5929", data: multiWindow.recent30d },
    { label: "60\u5929", data: multiWindow.recent60d },
    { label: "90\u5929", data: multiWindow.recent90d }
  ].filter((w) => w.data && w.data.totalSpend > 0);
  if (windows.length < 2) {
    return { score: 50, detail: "\u591A\u65F6\u95F4\u7A97\u53E3\u6570\u636E\u4E0D\u8DB3" };
  }
  maxPoints += 40;
  const shortWindow = windows[0];
  const longWindow = windows[windows.length - 1];
  if (shortWindow.data && longWindow.data && shortWindow.data.totalSales > 0 && longWindow.data.totalSales > 0) {
    const shortAcos = shortWindow.data.totalSpend / shortWindow.data.totalSales * 100;
    const longAcos = longWindow.data.totalSpend / longWindow.data.totalSales * 100;
    const acosImprovement = (longAcos - shortAcos) / Math.max(longAcos, 1);
    if (acosImprovement > 0.15) {
      totalPoints += 40;
      improvements.push(`\u8FD1\u671FACoS\u6BD4\u957F\u671F\u2193${(acosImprovement * 100).toFixed(0)}%`);
    } else if (acosImprovement > 0.05) {
      totalPoints += 30;
      improvements.push(`\u8FD1\u671FACoS\u6539\u5584\u4E2D`);
    } else if (acosImprovement > -0.05) {
      totalPoints += 20;
      improvements.push("ACoS\u8D8B\u52BF\u7A33\u5B9A");
    } else if (acosImprovement > -0.15) {
      totalPoints += 10;
      improvements.push("ACoS\u8FD1\u671F\u4E0A\u5347");
    } else {
      totalPoints += 2;
      improvements.push("ACoS\u8FD1\u671F\u6076\u5316");
    }
  } else {
    totalPoints += 20;
  }
  maxPoints += 30;
  if (shortWindow.data && longWindow.data) {
    const shortDailySales = shortWindow.data.totalSales / Math.max(shortWindow.data.days, 1);
    const longDailySales = longWindow.data.totalSales / Math.max(longWindow.data.days, 1);
    if (longDailySales > 0) {
      const salesGrowth = (shortDailySales - longDailySales) / longDailySales;
      if (salesGrowth > 0.2) {
        totalPoints += 30;
        improvements.push(`\u8FD1\u671F\u65E5\u9500\u2191${(salesGrowth * 100).toFixed(0)}%`);
      } else if (salesGrowth > 0.05) {
        totalPoints += 22;
      } else if (salesGrowth > -0.05) {
        totalPoints += 15;
      } else if (salesGrowth > -0.2) {
        totalPoints += 8;
      } else {
        totalPoints += 2;
      }
    } else {
      totalPoints += shortDailySales > 0 ? 25 : 10;
    }
  } else {
    totalPoints += 15;
  }
  maxPoints += 30;
  if (multiWindow.preOptimization && shortWindow.data) {
    const preAcos = multiWindow.preOptimization.totalSales > 0 ? multiWindow.preOptimization.totalSpend / multiWindow.preOptimization.totalSales * 100 : 999;
    const postAcos = shortWindow.data.totalSales > 0 ? shortWindow.data.totalSpend / shortWindow.data.totalSales * 100 : 999;
    if (preAcos < 900 && postAcos < 900) {
      const improvement = (preAcos - postAcos) / Math.max(preAcos, 1);
      if (improvement > 0.2) {
        totalPoints += 30;
        improvements.push(`\u4F18\u5316\u540EACoS\u2193${(improvement * 100).toFixed(0)}%`);
      } else if (improvement > 0.05) {
        totalPoints += 22;
        improvements.push(`\u4F18\u5316\u540E\u6709\u6539\u5584`);
      } else if (improvement > -0.05) {
        totalPoints += 15;
      } else {
        totalPoints += 5;
        improvements.push("\u4F18\u5316\u540EACoS\u4E0A\u5347");
      }
    } else {
      totalPoints += 15;
    }
  } else {
    totalPoints += 15;
  }
  const score = maxPoints > 0 ? Math.round(totalPoints / maxPoints * 100) : 50;
  const detail = improvements.length > 0 ? improvements.join("\uFF0C") : "\u591A\u7A97\u53E3\u8D8B\u52BF\u8BA1\u7B97\u4E2D";
  return { score: Math.min(100, Math.max(5, score)), detail };
}
function calculateBudgetEfficiencyScore(config2, metrics, timeWeighted) {
  const dailyBudget = config2.dailyBudget || config2.dailySpendLimit || 0;
  if (dailyBudget <= 0) {
    if (metrics.totalSpend > 0 && metrics.totalSales > 0) {
      const roas2 = timeWeighted ? timeWeighted.weightedRoas : metrics.avgRoas;
      const score2 = roas2 >= 2 ? 80 : roas2 >= 1 ? 65 : 45;
      return { score: score2, detail: `\u672A\u8BBE\u7F6E\u9884\u7B97\u4E0A\u9650\uFF0CROAS=${roas2.toFixed(2)}` };
    }
    return { score: 50, detail: "\u672A\u8BBE\u7F6E\u9884\u7B97\uFF0C\u6682\u65E0\u6CD5\u8BC4\u4F30\u6548\u7387" };
  }
  const avgDailySpend = timeWeighted ? timeWeighted.weightedDailySpend : metrics.totalSpend / Math.max(1, timeWeighted?.effectiveDataDays || 30);
  const dataSource = timeWeighted ? "\u52A0\u6743" : "\u5E73\u5747";
  const utilizationRate = avgDailySpend / dailyBudget;
  let score;
  let detail;
  if (utilizationRate >= 0.75 && utilizationRate <= 1.05) {
    score = 95;
    detail = `${dataSource}\u65E5\u5747\u82B1\u8D39$${avgDailySpend.toFixed(2)}\uFF0C\u5229\u7528\u7387${(utilizationRate * 100).toFixed(0)}%\uFF08\u6700\u4F73\uFF09`;
  } else if (utilizationRate >= 0.5 && utilizationRate < 0.75) {
    score = 65 + (utilizationRate - 0.5) / 0.25 * 30;
    detail = `${dataSource}\u65E5\u5747\u82B1\u8D39$${avgDailySpend.toFixed(2)}\uFF0C\u5229\u7528\u7387${(utilizationRate * 100).toFixed(0)}%\uFF08\u504F\u4F4E\uFF09`;
  } else if (utilizationRate >= 0.2 && utilizationRate < 0.5) {
    score = 35 + (utilizationRate - 0.2) / 0.3 * 30;
    detail = `${dataSource}\u65E5\u5747\u82B1\u8D39$${avgDailySpend.toFixed(2)}\uFF0C\u5229\u7528\u7387${(utilizationRate * 100).toFixed(0)}%\uFF08\u504F\u4F4E\uFF09`;
  } else if (utilizationRate < 0.2) {
    score = Math.max(10, utilizationRate / 0.2 * 35);
    detail = `${dataSource}\u65E5\u5747\u82B1\u8D39$${avgDailySpend.toFixed(2)}\uFF0C\u5229\u7528\u7387${(utilizationRate * 100).toFixed(0)}%\uFF08\u6781\u4F4E\uFF09`;
  } else if (utilizationRate <= 1.2) {
    score = 80;
    detail = `${dataSource}\u65E5\u5747\u82B1\u8D39$${avgDailySpend.toFixed(2)}\uFF0C\u5229\u7528\u7387${(utilizationRate * 100).toFixed(0)}%\uFF08\u7565\u8D85\uFF09`;
  } else {
    score = Math.max(15, 80 - (utilizationRate - 1.2) * 80);
    detail = `${dataSource}\u65E5\u5747\u82B1\u8D39$${avgDailySpend.toFixed(2)}\uFF0C\u5229\u7528\u7387${(utilizationRate * 100).toFixed(0)}%\uFF08\u8D85\u652F\uFF09`;
  }
  const roas = timeWeighted ? timeWeighted.weightedRoas : metrics.avgRoas;
  if (roas >= 2) score = Math.min(100, score + 5);
  else if (roas < 0.5 && metrics.totalSpend > 0) score = Math.max(10, score - 10);
  return { score: Math.round(Math.min(100, Math.max(5, score))), detail };
}
function calculateConversionEfficiencyScore(metrics, config2, timeWeighted) {
  if (metrics.totalClicks < 5 || metrics.totalSpend < 1) {
    return { score: 0, detail: "\u70B9\u51FB/\u82B1\u8D39\u6570\u636E\u4E0D\u8DB3" };
  }
  let totalPoints = 0;
  let maxPoints = 0;
  const details = [];
  const roas = timeWeighted ? timeWeighted.weightedRoas : metrics.avgRoas;
  const cvr = timeWeighted ? timeWeighted.weightedCvr : metrics.cvr;
  const cpc = timeWeighted ? timeWeighted.weightedCpc : metrics.cpc;
  maxPoints += 40;
  if (roas >= 4) {
    totalPoints += 40;
    details.push(`ROAS ${roas.toFixed(2)}(\u4F18\u79C0)`);
  } else if (roas >= 2.5) {
    totalPoints += 32;
    details.push(`ROAS ${roas.toFixed(2)}(\u826F\u597D)`);
  } else if (roas >= 1.5) {
    totalPoints += 24;
    details.push(`ROAS ${roas.toFixed(2)}(\u4E00\u822C)`);
  } else if (roas >= 1) {
    totalPoints += 16;
    details.push(`ROAS ${roas.toFixed(2)}(\u504F\u4F4E)`);
  } else if (roas > 0) {
    totalPoints += 8;
    details.push(`ROAS ${roas.toFixed(2)}(\u4E8F\u635F)`);
  } else {
    totalPoints += 0;
    details.push("ROAS=0");
  }
  const CATEGORY_CVR_BENCHMARK = {
    // @ts-ignore
    "electronics": 10,
    "computers": 9,
    "cell_phones": 8,
    "video_games": 12,
    "home_kitchen": 7,
    "sports_outdoors": 6,
    "toys_games": 10,
    "clothing": 4,
    "beauty": 8,
    "health": 7,
    "baby": 9,
    "pet_supplies": 8,
    "grocery": 18,
    "luxury": 3,
    "default": 8
  };
  const productCategory = config2.productCategory || "default";
  const categoryCvrBenchmark = CATEGORY_CVR_BENCHMARK[productCategory] || CATEGORY_CVR_BENCHMARK["default"];
  maxPoints += 30;
  const cvrRatio = cvr / categoryCvrBenchmark;
  if (cvrRatio >= 1.5) {
    totalPoints += 30;
    details.push(`CVR ${cvr.toFixed(1)}%(\u8D85\u8D8A\u54C1\u7C7B\u57FA\u51C6${categoryCvrBenchmark}%)`);
  } else if (cvrRatio >= 1) {
    totalPoints += 25;
    details.push(`CVR ${cvr.toFixed(1)}%(\u8FBE\u5230\u54C1\u7C7B\u57FA\u51C6)`);
  } else if (cvrRatio >= 0.7) {
    totalPoints += 18;
    details.push(`CVR ${cvr.toFixed(1)}%`);
  } else if (cvrRatio >= 0.4) {
    totalPoints += 12;
  } else if (cvr > 0) {
    totalPoints += 5;
  } else {
    totalPoints += 0;
  }
  maxPoints += 30;
  if (cpc > 0 && metrics.totalOrders > 0) {
    const costPerOrder = metrics.totalSpend / metrics.totalOrders;
    const avgOrderValue = metrics.totalSales / metrics.totalOrders;
    const costRatio = avgOrderValue > 0 ? costPerOrder / avgOrderValue : 1;
    if (costRatio <= 0.15) {
      totalPoints += 30;
      details.push(`\u5355\u5747\u6210\u672C\u5360\u6BD4${(costRatio * 100).toFixed(0)}%`);
    } else if (costRatio <= 0.25) {
      totalPoints += 24;
    } else if (costRatio <= 0.4) {
      totalPoints += 16;
    } else if (costRatio <= 0.6) {
      totalPoints += 10;
    } else {
      totalPoints += 4;
    }
  } else if (cpc > 0) {
    totalPoints += 5;
    details.push(`CPC $${cpc.toFixed(2)}\uFF0C\u6682\u65E0\u8F6C\u5316`);
  }
  const score = maxPoints > 0 ? Math.round(totalPoints / maxPoints * 100) : 0;
  const detail = details.join("\uFF0C") || "\u8F6C\u5316\u6570\u636E\u8BA1\u7B97\u4E2D";
  return { score: Math.min(100, Math.max(0, score)), detail };
}
function calculateGradualProgressScore(config2, metrics, timeWeighted, multiWindow) {
  const targetAcos = config2.targetAcos || 0;
  const targetRoas = config2.targetRoas || 0;
  if (!timeWeighted) {
    const targetAcosVal = config2.targetAcos || 0;
    const targetRoasVal = config2.targetRoas || 0;
    if (targetAcosVal > 0 && metrics.avgAcos > 0) {
      const gap = Math.abs(metrics.avgAcos - targetAcosVal) / targetAcosVal;
      const baseScore = metrics.avgAcos <= targetAcosVal ? 75 : gap < 0.3 ? 55 : gap < 0.6 ? 40 : 25;
      return { score: baseScore, detail: `\u57FA\u4E8EACoS\u4E0E\u76EE\u6807\u5DEE\u8DDD\u8BC4\u4F30(\u5DEE\u8DDD${(gap * 100).toFixed(0)}%)` };
    }
    if (targetRoasVal > 0 && metrics.avgRoas > 0) {
      const gap = Math.abs(metrics.avgRoas - targetRoasVal) / targetRoasVal;
      const baseScore = metrics.avgRoas >= targetRoasVal ? 75 : gap < 0.3 ? 55 : gap < 0.6 ? 40 : 25;
      return { score: baseScore, detail: `\u57FA\u4E8EROAS\u4E0E\u76EE\u6807\u5DEE\u8DDD\u8BC4\u4F30(\u5DEE\u8DDD${(gap * 100).toFixed(0)}%)` };
    }
    return { score: 50, detail: "\u9700\u8981\u66F4\u591A\u6570\u636E\u8BC4\u4F30\u6E10\u8FDB\u4F18\u5316\u8FDB\u5EA6" };
  }
  let score = 50;
  const details = [];
  const confidence = timeWeighted.dataConfidence;
  if (confidence === "high") {
    score += 10;
    details.push("\u6570\u636E\u5145\u8DB3");
  } else if (confidence === "medium") {
    score += 5;
    details.push("\u6570\u636E\u4E2D\u7B49");
  } else if (confidence === "low") {
    score += 0;
    details.push("\u6570\u636E\u504F\u5C11");
  } else {
    score -= 5;
    details.push("\u6570\u636E\u6781\u5C11");
  }
  if (timeWeighted.trendDirection === "improving") {
    score += 20;
    details.push("\u6307\u6807\u6301\u7EED\u6539\u5584");
  } else if (timeWeighted.trendDirection === "stable") {
    score += 10;
    details.push("\u6307\u6807\u4FDD\u6301\u7A33\u5B9A");
  } else {
    score -= 5;
    details.push("\u6307\u6807\u6709\u4E0B\u884C\u8D8B\u52BF");
  }
  if (multiWindow) {
    const windows = [
      multiWindow.recent90d,
      multiWindow.recent60d,
      multiWindow.recent30d,
      multiWindow.recent14d,
      multiWindow.recent7d
    ].filter((w) => w && w.totalSpend > 0);
    if (windows.length >= 3) {
      const windowAcos = windows.map((w) => {
        if (!w || w.totalSales <= 0) return null;
        return w.totalSpend / w.totalSales * 100;
      }).filter((a) => a !== null);
      if (windowAcos.length >= 3) {
        let improvingCount = 0;
        for (let i = 1; i < windowAcos.length; i++) {
          if (windowAcos[i] < windowAcos[i - 1]) improvingCount++;
        }
        const improvingRatio = improvingCount / (windowAcos.length - 1);
        if (improvingRatio >= 0.7) {
          score += 15;
          details.push("ACoS\u5448\u6301\u7EED\u6539\u5584\u8D8B\u52BF");
        } else if (improvingRatio >= 0.5) {
          score += 8;
          details.push("ACoS\u6709\u6539\u5584\u8FF9\u8C61");
        } else {
          score -= 5;
          details.push("ACoS\u6539\u5584\u4E0D\u660E\u663E");
        }
      }
    }
  }
  if (targetAcos > 0) {
    const currentAcos = timeWeighted.weightedAcos;
    const gap = Math.abs(currentAcos - targetAcos) / targetAcos;
    if (currentAcos <= targetAcos) {
      score += 10;
      details.push("\u5DF2\u8FBE\u6210ACoS\u76EE\u6807");
    } else if (gap < 0.2) {
      score += 5;
      details.push(`\u8DDD\u76EE\u6807\u5DEE\u8DDD${(gap * 100).toFixed(0)}%`);
    } else if (gap < 0.5) {
      score += 0;
      details.push(`\u8DDD\u76EE\u6807\u5DEE\u8DDD${(gap * 100).toFixed(0)}%`);
    } else {
      score -= 5;
      details.push(`\u8DDD\u76EE\u6807\u5DEE\u8DDD\u8F83\u5927(${(gap * 100).toFixed(0)}%)`);
    }
  }
  if (multiWindow && targetAcos > 0) {
    const w7 = multiWindow.recent7d;
    const w30 = multiWindow.recent30d;
    if (w7 && w30 && w7.totalSales > 0 && w30.totalSales > 0) {
      const acos7d = w7.totalSpend / w7.totalSales * 100;
      const acos30d = w30.totalSpend / w30.totalSales * 100;
      const weeklyImprovement = (acos30d - acos7d) / Math.max(acos30d, 1);
      if (weeklyImprovement > 0.15) {
        score += 8;
        details.push(`v268\u4F18\u5316\u901F\u5EA6\u4F18\u79C0: ACoS\u5468\u964D${(weeklyImprovement * 100).toFixed(0)}%`);
      } else if (weeklyImprovement > 0.05) {
        score += 4;
        details.push(`\u4F18\u5316\u901F\u5EA6\u826F\u597D`);
      } else if (weeklyImprovement > 0) {
        score += 2;
      }
    }
  }
  return {
    score: Math.min(100, Math.max(5, score)),
    detail: details.join("\uFF0C") || "\u6E10\u8FDB\u4F18\u5316\u8BC4\u4F30\u4E2D"
  };
}
function calculateDefaultProfitScore(metrics) {
  if (metrics.totalSpend < 0.01 || metrics.totalSales < 0.01) {
    return { score: 0, detail: "\u6570\u636E\u4E0D\u8DB3\uFF0C\u65E0\u6CD5\u8BC4\u4F30\u5E7F\u544A\u6295\u653E\u6548\u7387" };
  }
  const roas = metrics.totalSpend > 0 ? metrics.totalSales / metrics.totalSpend : 0;
  const actualAcos = metrics.avgAcos;
  const adNetValue = metrics.totalSales - metrics.totalSpend;
  let score = 0;
  if (roas >= 7) score += 40;
  else if (roas >= 5) score += 35 + (roas - 5) / 2 * 5;
  else if (roas >= 4) score += 30 + (roas - 4) * 5;
  else if (roas >= 2.5) score += 20 + (roas - 2.5) / 1.5 * 10;
  else if (roas >= 1.5) score += 10 + (roas - 1.5) * 10;
  else if (roas >= 1) score += 4 + (roas - 1) * 12;
  else score += roas * 4;
  if (actualAcos <= 0) score += 0;
  else if (actualAcos <= 10) score += 35;
  else if (actualAcos <= 15) score += 30 + (15 - actualAcos) / 5 * 5;
  else if (actualAcos <= 25) score += 20 + (25 - actualAcos) / 10 * 10;
  else if (actualAcos <= 35) score += 10 + (35 - actualAcos) / 10 * 10;
  else if (actualAcos <= 50) score += 3 + (50 - actualAcos) / 15 * 7;
  else score += Math.max(0, 3 - (actualAcos - 50) / 20 * 3);
  if (metrics.totalSpend >= 200 && roas >= 2.5) score += 25;
  else if (metrics.totalSpend >= 100 && roas >= 2) score += 20;
  else if (metrics.totalSpend >= 50 && roas >= 1.5) score += 15;
  else if (metrics.totalSpend >= 20 && roas >= 1) score += 10;
  else if (metrics.totalSpend >= 10) score += 5;
  else score += 2;
  score = Math.min(100, Math.max(0, Math.round(score)));
  const efficiencyStatus = adNetValue > 0 ? "\u6B63\u5411" : "\u8D1F\u5411";
  return {
    score,
    detail: `\u5E7F\u544A\u6548\u7387\u8BC4\u4F30: ROAS=${roas.toFixed(2)}x, ACOS=${actualAcos.toFixed(1)}%, \u82B1\u8D39$${metrics.totalSpend.toFixed(2)}, \u9500\u552E$${metrics.totalSales.toFixed(2)}, \u6295\u4EA7\u51C0\u503C${efficiencyStatus}$${Math.abs(adNetValue).toFixed(2)}`
  };
}
function calculateAlgorithmEfficacyScore(algorithmData) {
  if (!algorithmData || algorithmData.totalOperations === 0) {
    return { score: 50, detail: "\u6682\u65E0\u7B97\u6CD5\u6267\u884C\u6570\u636E\uFF0C\u4F7F\u7528\u57FA\u7840\u5206" };
  }
  let score = 0;
  const details = [];
  const posRate = algorithmData.positiveRate;
  if (posRate >= 70) {
    score += 40;
    details.push(`\u6B63\u5411\u7387${posRate.toFixed(0)}%(\u4F18\u79C0)`);
  } else if (posRate >= 55) {
    score += 30;
    details.push(`\u6B63\u5411\u7387${posRate.toFixed(0)}%(\u826F\u597D)`);
  } else if (posRate >= 40) {
    score += 20;
    details.push(`\u6B63\u5411\u7387${posRate.toFixed(0)}%(\u4E00\u822C)`);
  } else if (posRate >= 25) {
    score += 10;
    details.push(`\u6B63\u5411\u7387${posRate.toFixed(0)}%(\u504F\u4F4E)`);
  } else {
    score += 5;
    details.push(`\u6B63\u5411\u7387${posRate.toFixed(0)}%(\u5F85\u6539\u5584)`);
  }
  const { advanced, ruleEngine, conservative } = algorithmData.tierDistribution;
  if (advanced >= 50) {
    score += 25;
    details.push(`\u9AD8\u7EA7\u7B97\u6CD5${advanced}%`);
  } else if (advanced >= 30) {
    score += 20;
    details.push(`\u9AD8\u7EA7\u7B97\u6CD5${advanced}%`);
  } else if (advanced >= 10) {
    score += 15;
    details.push(`\u9AD8\u7EA7\u7B97\u6CD5${advanced}%`);
  } else if (ruleEngine >= 70) {
    score += 12;
    details.push(`\u89C4\u5219\u5F15\u64CE\u4E3B\u5BFC${ruleEngine}%`);
  } else {
    score += 8;
    details.push(`\u4FDD\u5B88\u7B56\u7565${conservative}%`);
  }
  const conf = algorithmData.avgConfidence;
  if (conf >= 0.7) {
    score += 20;
  } else if (conf >= 0.5) {
    score += 15;
  } else if (conf >= 0.3) {
    score += 10;
  } else {
    score += 5;
  }
  details.push(`\u7F6E\u4FE1\u5EA6${(conf * 100).toFixed(0)}%`);
  const corrections = algorithmData.evolutionCorrections;
  if (corrections === 0) {
    score += 15;
    details.push("\u65E0\u7EA0\u9519(\u7A33\u5B9A)");
  } else if (corrections <= 3) {
    score += 12;
    details.push(`\u7EA0\u9519${corrections}\u6B21`);
  } else if (corrections <= 10) {
    score += 8;
    details.push(`\u7EA0\u9519${corrections}\u6B21`);
  } else {
    score += 4;
    details.push(`\u7EA0\u9519${corrections}\u6B21(\u8F83\u591A)`);
  }
  if (algorithmData.improvementTrend === "improving") {
    score = Math.min(100, score + 5);
    details.push("\u7B97\u6CD5\u6548\u679C\u6301\u7EED\u6539\u5584");
  } else if (algorithmData.improvementTrend === "declining") {
    score = Math.max(5, score - 5);
    details.push("\u7B97\u6CD5\u6548\u679C\u6709\u4E0B\u6ED1\u8D8B\u52BF");
  }
  return {
    score: Math.min(100, Math.max(5, score)),
    detail: details.join("\uFF0C") || "NextGen\u7B97\u6CD5\u8BC4\u4F30\u4E2D"
  };
}
function calculateGoalProgress(config2, metrics, trendData, timeWeighted, multiWindow, algorithmData, profitData) {
  if (config2.campaignCount === 0 && metrics.totalSpend < 0.01 && metrics.totalSales < 0.01) {
    return {
      totalScore: 0,
      dimensions: [],
      summary: "\u6682\u65E0\u5E7F\u544A\u6D3B\u52A8\u6570\u636E",
      level: "poor"
    };
  }
  const weights = getWeights(config2.strategyTemplateId);
  const confidenceMultiplier = timeWeighted ? getConfidenceMultiplier(timeWeighted.dataConfidence) : 0.8;
  const coreMetric = calculateCoreMetricScore(config2, metrics, timeWeighted);
  let trend;
  if (trendData || multiWindow) {
    trend = calculateTrendScore(trendData || { before: null, after: null }, config2, timeWeighted, multiWindow);
  } else if (timeWeighted) {
    const trendDir = timeWeighted.trendDirection;
    let baseScore;
    if (trendDir === "improving") {
      const roas = timeWeighted.weightedRoas || 0;
      baseScore = roas >= 3 ? 78 : roas >= 2 ? 72 : roas >= 1 ? 65 : 58;
    } else if (trendDir === "stable") {
      baseScore = 55;
    } else {
      baseScore = 32;
    }
    trend = { score: baseScore, detail: `\u57FA\u4E8E\u65F6\u95F4\u8870\u51CF\u8D8B\u52BF\u4FE1\u53F7: ${trendDir} (ROAS=${(timeWeighted.weightedRoas || 0).toFixed(2)})` };
  } else {
    const currentRoas = metrics.totalSpend > 0 ? metrics.totalSales / metrics.totalSpend : 0;
    const inferredScore = currentRoas >= 3 ? 65 : currentRoas >= 2 ? 55 : currentRoas >= 1 ? 45 : 35;
    trend = { score: inferredScore, detail: `\u8D8B\u52BF\u6570\u636E\u4E0D\u8DB3\uFF0C\u57FA\u4E8E\u5F53\u524DROAS(${currentRoas.toFixed(2)})\u63A8\u65AD` };
  }
  const budgetEff = calculateBudgetEfficiencyScore(config2, metrics, timeWeighted);
  const convEff = calculateConversionEfficiencyScore(metrics, config2, timeWeighted);
  const gradualProgress = calculateGradualProgressScore(config2, metrics, timeWeighted, multiWindow);
  const algEfficacy = calculateAlgorithmEfficacyScore(algorithmData);
  const profitHealth = profitData ? { score: profitData.profitHealthScore, detail: profitData.detail } : calculateDefaultProfitScore(metrics);
  const dimensions = [
    {
      name: "coreMetric",
      nameZh: "\u6307\u6807\u8FBE\u6210",
      score: coreMetric.score,
      weight: weights.coreMetric,
      weighted: Math.round(coreMetric.score * weights.coreMetric / 100),
      detail: coreMetric.detail
    },
    {
      name: "trend",
      nameZh: "\u8D8B\u52BF\u6539\u5584",
      score: trend.score,
      weight: weights.trend,
      weighted: Math.round(trend.score * weights.trend / 100),
      detail: trend.detail
    },
    {
      name: "budgetEfficiency",
      nameZh: "\u9884\u7B97\u6548\u7387",
      score: budgetEff.score,
      weight: weights.budgetEfficiency,
      weighted: Math.round(budgetEff.score * weights.budgetEfficiency / 100),
      detail: budgetEff.detail
    },
    {
      name: "conversionEfficiency",
      nameZh: "\u8F6C\u5316\u6548\u7387",
      score: convEff.score,
      weight: weights.conversionEfficiency,
      weighted: Math.round(convEff.score * weights.conversionEfficiency / 100),
      detail: convEff.detail
    },
    {
      name: "gradualProgress",
      nameZh: "\u6E10\u8FDB\u4F18\u5316",
      score: gradualProgress.score,
      weight: weights.gradualProgress,
      weighted: Math.round(gradualProgress.score * weights.gradualProgress / 100),
      detail: gradualProgress.detail
    },
    {
      name: "algorithmEfficacy",
      nameZh: "\u7B97\u6CD5\u6548\u80FD",
      score: algEfficacy.score,
      weight: weights.algorithmEfficacy,
      weighted: Math.round(algEfficacy.score * weights.algorithmEfficacy / 100),
      detail: algEfficacy.detail
    },
    {
      name: "profitHealth",
      nameZh: "\u5E7F\u544A\u6548\u7387",
      // @ts-ignore
      score: profitHealth.score,
      weight: weights.profitHealth,
      weighted: Math.round(profitHealth.score * weights.profitHealth / 100),
      detail: profitHealth.detail
    }
  ];
  let totalScore = dimensions.reduce((sum2, d) => sum2 + d.weighted, 0);
  if (coreMetric.score < 50) {
    const penaltyFactor = 0.6 + coreMetric.score / 50 * 0.4;
    totalScore = Math.round(totalScore * penaltyFactor);
  }
  if (confidenceMultiplier < 1) {
    totalScore = Math.round(50 + (totalScore - 50) * confidenceMultiplier);
  }
  let level;
  if (totalScore >= 85) level = "excellent";
  else if (totalScore >= 65) level = "good";
  else if (totalScore >= 40) level = "fair";
  else level = "poor";
  const levelLabels = { excellent: "\u4F18\u79C0", good: "\u826F\u597D", fair: "\u4E00\u822C", poor: "\u5F85\u6539\u5584" };
  const topDimension = dimensions.reduce((a, b) => a.score > b.score ? a : b);
  const weakDimension = dimensions.reduce((a, b) => a.score < b.score ? a : b);
  let summary = `\u7EFC\u5408\u8BC4\u5206${totalScore}\u5206\uFF08${levelLabels[level]}\uFF09`;
  if (topDimension.score > 70) {
    summary += `\uFF0C${topDimension.nameZh}\u8868\u73B0\u7A81\u51FA`;
  }
  if (weakDimension.score < 50 && weakDimension.score < topDimension.score - 20) {
    summary += `\uFF0C${weakDimension.nameZh}\u9700\u5173\u6CE8`;
  }
  if (timeWeighted) {
    const trendLabels = { improving: "\u6301\u7EED\u6539\u5584\u4E2D", stable: "\u4FDD\u6301\u7A33\u5B9A", declining: "\u9700\u8981\u5173\u6CE8" };
    summary += `\uFF0C\u6574\u4F53\u8D8B\u52BF${trendLabels[timeWeighted.trendDirection]}`;
  }
  return {
    // @ts-ignore
    totalScore: Math.min(100, Math.max(0, totalScore)),
    dimensions,
    summary,
    level
  };
}
var STRATEGY_WEIGHTS, DEFAULT_WEIGHTS2;
var init_goalProgressAlgorithm = __esm({
  "server/algorithm/goalProgressAlgorithm.ts"() {
    "use strict";
    STRATEGY_WEIGHTS = {
      // v376: 核心指标权重提升，其他维度等比例缩减
      "aggressive-growth": { coreMetric: 35, trend: 18, budgetEfficiency: 3, conversionEfficiency: 12, gradualProgress: 14, algorithmEfficacy: 8, profitHealth: 10 },
      "balanced": { coreMetric: 40, trend: 12, budgetEfficiency: 7, conversionEfficiency: 10, gradualProgress: 13, algorithmEfficacy: 6, profitHealth: 12 },
      "profit-focused": { coreMetric: 45, trend: 4, budgetEfficiency: 6, conversionEfficiency: 8, gradualProgress: 10, algorithmEfficacy: 5, profitHealth: 22 },
      "seasonal-boost": { coreMetric: 35, trend: 20, budgetEfficiency: 5, conversionEfficiency: 10, gradualProgress: 12, algorithmEfficacy: 6, profitHealth: 12 },
      "brand-defense": { coreMetric: 40, trend: 5, budgetEfficiency: 12, conversionEfficiency: 10, gradualProgress: 13, algorithmEfficacy: 8, profitHealth: 12 },
      // v270 P1-2 + v271 + v376: 以下6个策略模板已补齐权重配置，并提升核心指标权重
      // 清仓策略: 核心指标提升，同时保留趋势和转化效率的重要性
      "inventory-clearance": { coreMetric: 30, trend: 20, budgetEfficiency: 5, conversionEfficiency: 14, gradualProgress: 12, algorithmEfficacy: 8, profitHealth: 11 },
      // 竞争攻击策略: 核心指标提升，同时保留渐进优化的重要性
      "competitor-attack": { coreMetric: 30, trend: 16, budgetEfficiency: 3, conversionEfficiency: 10, gradualProgress: 20, algorithmEfficacy: 10, profitHealth: 11 },
      // 市场扩张策略: 核心指标提升，同时保留算法效能的重要性
      "market-expansion": { coreMetric: 30, trend: 18, budgetEfficiency: 3, conversionEfficiency: 10, gradualProgress: 16, algorithmEfficacy: 11, profitHealth: 12 },
      // 季节性模式策略: 核心指标提升，同时保留趋势的重要性
      "seasonal-pattern": { coreMetric: 35, trend: 20, budgetEfficiency: 5, conversionEfficiency: 10, gradualProgress: 10, algorithmEfficacy: 6, profitHealth: 14 },
      // 下滑管理策略: 核心指标提升，同时保留预算效率的重要性
      "decline-management": { coreMetric: 40, trend: 7, budgetEfficiency: 12, conversionEfficiency: 10, gradualProgress: 8, algorithmEfficacy: 5, profitHealth: 18 },
      // 紧急响应策略: 核心指标最高，同时保留预算效率和利润维度
      "emergency-response": { coreMetric: 45, trend: 3, budgetEfficiency: 14, conversionEfficiency: 8, gradualProgress: 6, algorithmEfficacy: 7, profitHealth: 17 }
    };
    DEFAULT_WEIGHTS2 = { coreMetric: 40, trend: 12, budgetEfficiency: 7, conversionEfficiency: 10, gradualProgress: 13, algorithmEfficacy: 6, profitHealth: 12 };
    __name(getWeights, "getWeights");
    __name(getConfidenceMultiplier, "getConfidenceMultiplier");
    __name(calculateCoreMetricScore, "calculateCoreMetricScore");
    __name(calculateTrendScore, "calculateTrendScore");
    __name(calculateMultiWindowTrendScore, "calculateMultiWindowTrendScore");
    __name(calculateBudgetEfficiencyScore, "calculateBudgetEfficiencyScore");
    __name(calculateConversionEfficiencyScore, "calculateConversionEfficiencyScore");
    __name(calculateGradualProgressScore, "calculateGradualProgressScore");
    __name(calculateDefaultProfitScore, "calculateDefaultProfitScore");
    __name(calculateAlgorithmEfficacyScore, "calculateAlgorithmEfficacyScore");
    __name(calculateGoalProgress, "calculateGoalProgress");
  }
});

