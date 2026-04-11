// Extracted from production dist/index.js
// Original module: server/budget/daypartingService.ts
// Lines: 575

async function resolveAmazonCampaignId2(localCampaignId) {
  const db = await getDb();
  if (!db) return String(localCampaignId);
  const result = await db.select({ campaignId: campaigns.campaignId }).from(campaigns).where(eq(campaigns.id, localCampaignId)).limit(1);
  return result.length > 0 ? String(result[0].campaignId) : String(localCampaignId);
}
async function analyzeWeeklyPerformance(campaignId, lookbackDays = 30) {
  const db = await getDb();
  if (!db) return [];
  const startDate = /* @__PURE__ */ new Date();
  startDate.setDate(startDate.getDate() - lookbackDays);
  const result = await db.select({
    dayOfWeek: sql`DAYOFWEEK(${dailyPerformance.date}) - 1`,
    // MySQL DAYOFWEEK返回1-7，转为0-6
    avgSpend: sql`AVG(${dailyPerformance.spend})`,
    avgSales: sql`AVG(${dailyPerformance.sales})`,
    avgClicks: sql`AVG(${dailyPerformance.clicks})`,
    avgImpressions: sql`AVG(${dailyPerformance.impressions})`,
    dataPoints: sql`COUNT(*)`
  }).from(dailyPerformance).where(
    and(
      eq(dailyPerformance.campaignId, await resolveAmazonCampaignId2(campaignId)),
      // v438: 统一使用Amazon ID
      sql`${dailyPerformance.date} >= ${startDate.toISOString()}`
    )
  ).groupBy(sql`DAYOFWEEK(${dailyPerformance.date})`);
  return result.map((row) => {
    const avgSpend = parseFloat(row.avgSpend || "0");
    const avgSales = parseFloat(row.avgSales || "0");
    const avgAcos = avgSales > 0 ? avgSpend / avgSales * 100 : 0;
    const avgRoas = avgSpend > 0 ? avgSales / avgSpend : 0;
    const performanceScore = Math.min(100, Math.max(0, avgRoas * 25));
    return {
      // @ts-ignore
      dayOfWeek: row.dayOfWeek,
      // @ts-ignore
      dayLabel: DAY_OF_WEEK_LABELS[row.dayOfWeek] || `Day ${row.dayOfWeek}`,
      // @ts-ignore
      avgSpend,
      // @ts-ignore
      avgSales,
      // @ts-ignore
      avgAcos,
      avgRoas,
      // @ts-ignore
      avgClicks: parseFloat(row.avgClicks || "0"),
      // @ts-ignore
      avgImpressions: parseFloat(row.avgImpressions || "0"),
      // @ts-ignore
      dataPoints: row.dataPoints,
      performanceScore
    };
  });
}
async function analyzeHourlyPerformance(campaignId, lookbackDays = 30) {
  const db = await getDb();
  if (!db) return [];
  const endDate = /* @__PURE__ */ new Date();
  endDate.setDate(endDate.getDate() - ATTRIBUTION_DELAY_DAYS);
  const startDate = /* @__PURE__ */ new Date();
  startDate.setDate(startDate.getDate() - lookbackDays - ATTRIBUTION_DELAY_DAYS);
  const result = await db.select({
    dayOfWeek: hourlyPerformance.dayOfWeek,
    hour: hourlyPerformance.hour,
    avgSpend: sql`AVG(${hourlyPerformance.spend})`,
    avgSales: sql`AVG(${hourlyPerformance.sales})`,
    avgClicks: sql`AVG(${hourlyPerformance.clicks})`,
    avgOrders: sql`AVG(${hourlyPerformance.orders})`,
    avgImpressions: sql`AVG(${hourlyPerformance.impressions})`,
    dataPoints: sql`COUNT(*)`
  }).from(hourlyPerformance).where(
    and(
      eq(hourlyPerformance.campaignId, await resolveAmazonCampaignId2(campaignId)),
      // v438: 统一使用Amazon ID
      gte(hourlyPerformance.date, startDate.toISOString().split("T")[0]),
      lte(hourlyPerformance.date, endDate.toISOString().split("T")[0])
      // 排除最近3天
    )
  ).groupBy(hourlyPerformance.dayOfWeek, hourlyPerformance.hour);
  const maxClicks = Math.max(...result.map((r) => parseFloat(r.avgClicks || "0")), 1);
  const maxImpressions = Math.max(...result.map((r) => parseFloat(r.avgImpressions || "0")), 1);
  return result.map((row) => {
    const avgSpend = parseFloat(row.avgSpend || "0");
    const avgSales = parseFloat(row.avgSales || "0");
    const avgClicks = parseFloat(row.avgClicks || "0");
    const avgOrders = parseFloat(row.avgOrders || "0");
    const avgImpressions = parseFloat(row.avgImpressions || "0");
    const avgCvr = avgClicks > 0 ? avgOrders / avgClicks * 100 : 0;
    const avgCpc = avgClicks > 0 ? avgSpend / avgClicks : 0;
    const avgAcos = avgSales > 0 ? avgSpend / avgSales * 100 : 0;
    const avgRoas = avgSpend > 0 ? avgSales / avgSpend : 0;
    const avgCtr = avgImpressions > 0 ? avgClicks / avgImpressions * 100 : 0;
    const normalizedClicks = avgClicks / maxClicks;
    const normalizedCtr = avgCtr / Math.max(...result.map((r) => {
      const imp = parseFloat(r.avgImpressions || "0");
      const clk = parseFloat(r.avgClicks || "0");
      return imp > 0 ? clk / imp * 100 : 0;
    }), 1);
    const trafficScore = normalizedClicks * 0.4 + normalizedCtr * 0.6;
    const performanceScore = Math.min(100, Math.max(0, avgRoas * 25));
    return {
      // @ts-ignore
      dayOfWeek: row.dayOfWeek,
      // @ts-ignore
      hour: row.hour,
      avgSpend,
      avgSales,
      avgClicks,
      avgCvr,
      avgCpc,
      avgAcos,
      avgCtr,
      avgImpressions,
      trafficScore,
      // @ts-ignore
      dataPoints: row.dataPoints,
      performanceScore
    };
  });
}
function calculateOptimalBudgetAllocation(weeklyData, options = { optimizationGoal: "maximize_sales" }) {
  const { optimizationGoal, targetAcos, targetRoas, maxMultiplier = 2, minMultiplier = 0.2 } = options;
  const scores = weeklyData.map((day2) => {
    let score = 0;
    switch (optimizationGoal) {
      // @ts-ignore
      case "maximize_sales":
        score = day2.avgRoas;
        break;
      // @ts-ignore
      case "target_acos":
        score = targetAcos ? 100 - Math.abs(day2.avgAcos - targetAcos) : day2.avgRoas * 25;
        break;
      case "target_roas":
        score = targetRoas ? 100 - Math.abs(day2.avgRoas - targetRoas) * 10 : day2.avgRoas * 25;
        break;
      case "minimize_acos":
        score = day2.avgAcos > 0 ? 100 / day2.avgAcos : 0;
        break;
    }
    return { ...day2, score: Math.max(0, score) };
  });
  const totalScore = scores.reduce((sum2, day2) => sum2 + day2.score, 0);
  const avgScore = totalScore / scores.length || 1;
  return scores.map((day2) => {
    let multiplier = day2.score / avgScore;
    multiplier = Math.max(minMultiplier, Math.min(maxMultiplier, multiplier));
    const budgetPercentage = multiplier / 7 * 100;
    let reason = "";
    if (multiplier > 1.2) {
      reason = `${day2.dayLabel}\u8868\u73B0\u4F18\u5F02\uFF0C\u5EFA\u8BAE\u589E\u52A0\u9884\u7B97`;
    } else if (multiplier < 0.8) {
      reason = `${day2.dayLabel}\u8868\u73B0\u8F83\u5F31\uFF0C\u5EFA\u8BAE\u51CF\u5C11\u9884\u7B97`;
    } else {
      reason = `${day2.dayLabel}\u8868\u73B0\u6B63\u5E38\uFF0C\u7EF4\u6301\u6807\u51C6\u9884\u7B97`;
    }
    return {
      // @ts-ignore
      dayOfWeek: day2.dayOfWeek,
      budgetMultiplier: Math.round(multiplier * 100) / 100,
      budgetPercentage: Math.round(budgetPercentage * 100) / 100,
      reason
    };
  });
}
function calculateOptimalBidAdjustments(hourlyData, options = { optimizationGoal: "maximize_sales" }) {
  const { optimizationGoal, targetAcos, targetRoas, maxMultiplier = 2, minMultiplier = 0.2 } = options;
  const scores = hourlyData.map((hourData) => {
    let score = 0;
    const avgRoas = hourData.avgSpend > 0 ? hourData.avgSales / hourData.avgSpend : 0;
    switch (optimizationGoal) {
      // @ts-ignore
      case "maximize_sales":
        score = hourData.avgCvr * 10 + avgRoas * 20;
        break;
      case "target_acos":
        score = targetAcos ? 100 - Math.abs(hourData.avgAcos - targetAcos) : avgRoas * 25;
        break;
      case "target_roas":
        score = targetRoas ? 100 - Math.abs(avgRoas - targetRoas) * 10 : avgRoas * 25;
        break;
      case "minimize_acos":
        score = hourData.avgAcos > 0 ? 100 / hourData.avgAcos : 0;
        break;
    }
    return { ...hourData, score: Math.max(0, score) };
  });
  const avgScore = scores.reduce((sum2, h) => sum2 + h.score, 0) / scores.length || 1;
  const avgTrafficScore = scores.reduce((sum2, h) => sum2 + (h.trafficScore || 0), 0) / scores.length || 0.5;
  return scores.map((hourData) => {
    let multiplier = hourData.score / avgScore;
    const trafficScore = hourData.trafficScore || 0;
    const avgRoas = hourData.avgSpend > 0 ? hourData.avgSales / hourData.avgSpend : 0;
    const targetRoasValue = targetRoas || 2;
    const isHighTrafficLowConversion = trafficScore > 0.8 && avgRoas < targetRoasValue;
    if (isHighTrafficLowConversion && multiplier < 1) {
      multiplier = Math.max(0.9, multiplier);
    }
    const deviation = multiplier - 1;
    let amplifiedDeviation = deviation * 3;
    if (Math.abs(amplifiedDeviation) < 0.05 && deviation !== 0) {
      amplifiedDeviation = deviation > 0 ? 0.05 : -0.05;
    }
    const hour2 = hourData.hour;
    let timeBonus = 0;
    if (hour2 >= 0 && hour2 <= 5) {
      timeBonus = -0.05;
    } else if (hour2 >= 6 && hour2 <= 8) {
      timeBonus = 0.02;
    } else if (hour2 >= 19 && hour2 <= 22) {
      timeBonus = 0.05;
    } else if (hour2 === 23) {
      timeBonus = -0.02;
    }
    multiplier = 1 + amplifiedDeviation + timeBonus;
    multiplier = Math.max(minMultiplier, Math.min(maxMultiplier, multiplier));
    multiplier = Math.round(multiplier * 100) / 100;
    let reason = "";
    if (isHighTrafficLowConversion) {
      reason = "\u9AD8\u6D41\u91CF\u65F6\u6BB5\uFF08\u53EF\u80FD\u4E3A\u79CD\u8349\u65F6\u6BB5\uFF09\uFF0C\u4EC5\u8F7B\u5FAE\u8C03\u6574\u4FDD\u6301\u66DD\u5149";
    } else if (multiplier > 1.15) {
      reason = "\u9AD8\u8F6C\u5316\u65F6\u6BB5\uFF0C\u5EFA\u8BAE\u63D0\u9AD8\u51FA\u4EF7";
    } else if (multiplier < 0.85) {
      reason = "\u4F4E\u6548\u65F6\u6BB5\uFF0C\u5EFA\u8BAE\u964D\u4F4E\u51FA\u4EF7";
    } else {
      reason = "\u6B63\u5E38\u65F6\u6BB5\uFF0C\u7EF4\u6301\u6807\u51C6\u51FA\u4EF7";
    }
    return {
      // @ts-ignore
      dayOfWeek: hourData.dayOfWeek,
      // @ts-ignore
      hour: hourData.hour,
      bidMultiplier: Math.round(multiplier * 100) / 100,
      trafficScore,
      isHighTrafficLowConversion,
      reason
    };
  });
}
async function createDaypartingStrategy(data) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(daypartingStrategies).values(data);
  return result[0].insertId;
}
async function getDaypartingStrategies(accountId) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(daypartingStrategies).where(eq(daypartingStrategies.accountId, accountId)).orderBy(desc(daypartingStrategies.updatedAt));
}
async function getDaypartingStrategy(strategyId) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(daypartingStrategies).where(eq(daypartingStrategies.id, strategyId)).limit(1);
  return result[0] || null;
}
async function getDaypartingStrategyByCampaignId(campaignId) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(daypartingStrategies).where(eq(daypartingStrategies.campaignId, String(campaignId))).limit(1);
  return result[0] || null;
}
async function ensureDaypartingStrategy(accountId, campaignId, campaignName, options = {}) {
  const existing = await getDaypartingStrategyByCampaignId(campaignId);
  if (existing) return existing;
  const db = await getDb();
  if (!db) return null;
  try {
    const strategyId = await createDaypartingStrategy({
      accountId,
      // v438: 修复ID混用 - campaignId必须存Amazon原始ID字符串，不能用Number()转换（会导致精度丢失）
      // @ts-expect-error - type assertion
      campaignId: String(campaignId),
      name: `\u81EA\u52A8\u5206\u65F6\u7B56\u7565 - ${campaignName}`,
      strategyType: "both",
      // @ts-expect-error - type assertion
      daypartingOptGoal: options.optimizationGoal || "maximize_sales",
      daypartingTargetAcos: options.targetAcos?.toString(),
      daypartingTargetRoas: options.targetRoas?.toString(),
      analysisLookbackDays: 30,
      daypartingStatus: "active",
      lastAnalyzedAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ")
    });
    const defaultBidRules = [];
    for (let dayOfWeek = 0; dayOfWeek <= 6; dayOfWeek++) {
      for (let hour2 = 0; hour2 < 24; hour2++) {
        defaultBidRules.push({
          strategyId,
          dayOfWeek,
          hour: hour2,
          bidMultiplier: "1.00",
          hourDataPoints: 0,
          hourIsEnabled: 1
        });
      }
    }
    await saveBidRules(strategyId, defaultBidRules);
    log96.info(`[DaypartingService] v157: \u81EA\u52A8\u521B\u5EFA\u5206\u65F6\u7B56\u7565 strategyId=${strategyId} for campaign ${campaignName} (${campaignId})`);
    return await getDaypartingStrategy(strategyId);
  } catch (err) {
    log96.warn(`[DaypartingService] v157: \u81EA\u52A8\u521B\u5EFA\u5206\u65F6\u7B56\u7565\u5931\u8D25: ${err.message}`);
    return null;
  }
}
async function updateDaypartingStrategy(strategyId, data) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(daypartingStrategies).set(data).where(eq(daypartingStrategies.id, strategyId));
}
async function saveBudgetRules(strategyId, rules) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(daypartingBudgetRules).where(eq(daypartingBudgetRules.strategyId, strategyId));
  if (rules.length > 0) {
    await db.insert(daypartingBudgetRules).values(
      // @ts-ignore
      rules.map((rule) => ({ ...rule, strategyId }))
    );
  }
}
async function getBudgetRules(strategyId) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(daypartingBudgetRules).where(eq(daypartingBudgetRules.strategyId, strategyId)).orderBy(daypartingBudgetRules.dayOfWeek);
}
async function saveBidRules(strategyId, rules) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(hourpartingBidRules).where(eq(hourpartingBidRules.strategyId, strategyId));
  if (rules.length > 0) {
    await db.insert(hourpartingBidRules).values(
      // @ts-ignore
      rules.map((rule) => ({ ...rule, strategyId }))
    );
  }
}
async function getBidRules(strategyId) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(hourpartingBidRules).where(eq(hourpartingBidRules.strategyId, strategyId)).orderBy(hourpartingBidRules.dayOfWeek, hourpartingBidRules.hour);
}
async function logStrategyExecution(data) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(daypartingExecutionLogs).values(data);
}
async function getExecutionLogs(strategyId, limit = 50) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(daypartingExecutionLogs).where(eq(daypartingExecutionLogs.strategyId, strategyId)).orderBy(desc(daypartingExecutionLogs.executedAt)).limit(limit);
}
async function generateOptimalStrategy(accountId, campaignId, options) {
  const weeklyData = await analyzeWeeklyPerformance(campaignId, options.lookbackDays || 30);
  const hourlyData = await analyzeHourlyPerformance(campaignId, options.lookbackDays || 30);
  const budgetAllocation = calculateOptimalBudgetAllocation(weeklyData, {
    // @ts-ignore
    optimizationGoal: options.optimizationGoal,
    // @ts-ignore
    targetAcos: options.targetAcos,
    // @ts-ignore
    targetRoas: options.targetRoas
    // @ts-ignore
  });
  const bidAdjustments = calculateOptimalBidAdjustments(hourlyData, {
    optimizationGoal: options.optimizationGoal,
    targetAcos: options.targetAcos,
    targetRoas: options.targetRoas
  });
  const strategyId = await createDaypartingStrategy({
    accountId,
    campaignId: String(campaignId),
    name: options.name,
    strategyType: "both",
    daypartingOptGoal: options.optimizationGoal,
    daypartingTargetAcos: options.targetAcos?.toString(),
    daypartingTargetRoas: options.targetRoas?.toString(),
    analysisLookbackDays: options.lookbackDays || 30,
    daypartingStatus: "draft",
    lastAnalyzedAt: (/* @__PURE__ */ new Date()).toISOString()
  });
  await saveBudgetRules(
    strategyId,
    budgetAllocation.map((rule) => ({
      // @ts-ignore
      dayOfWeek: rule.dayOfWeek,
      // @ts-ignore
      budgetMultiplier: rule.budgetMultiplier.toString(),
      // @ts-ignore
      budgetPercentage: rule.budgetPercentage.toString(),
      // @ts-ignore
      avgSpend: weeklyData.find((d) => d.dayOfWeek === rule.dayOfWeek)?.avgSpend.toString(),
      // @ts-ignore
      avgSales: weeklyData.find((d) => d.dayOfWeek === rule.dayOfWeek)?.avgSales.toString(),
      // @ts-ignore
      avgAcos: weeklyData.find((d) => d.dayOfWeek === rule.dayOfWeek)?.avgAcos.toString(),
      // @ts-ignore
      avgRoas: weeklyData.find((d) => d.dayOfWeek === rule.dayOfWeek)?.avgRoas.toString(),
      // @ts-ignore
      dataPoints: weeklyData.find((d) => d.dayOfWeek === rule.dayOfWeek)?.dataPoints || 0,
      isEnabled: 1
    }))
  );
  await saveBidRules(
    strategyId,
    bidAdjustments.map((rule) => ({
      // @ts-ignore
      dayOfWeek: rule.dayOfWeek,
      // @ts-ignore
      hour: rule.hour,
      // @ts-ignore
      bidMultiplier: rule.bidMultiplier.toString(),
      // @ts-ignore
      avgClicks: hourlyData.find((h) => h.dayOfWeek === rule.dayOfWeek && h.hour === rule.hour)?.avgClicks.toString(),
      // @ts-ignore
      avgSpend: hourlyData.find((h) => h.dayOfWeek === rule.dayOfWeek && h.hour === rule.hour)?.avgSpend.toString(),
      // @ts-ignore
      avgSales: hourlyData.find((h) => h.dayOfWeek === rule.dayOfWeek && h.hour === rule.hour)?.avgSales.toString(),
      // @ts-ignore
      avgCvr: hourlyData.find((h) => h.dayOfWeek === rule.dayOfWeek && h.hour === rule.hour)?.avgCvr.toString(),
      // @ts-ignore
      avgCpc: hourlyData.find((h) => h.dayOfWeek === rule.dayOfWeek && h.hour === rule.hour)?.avgCpc.toString(),
      // @ts-ignore
      avgAcos: hourlyData.find((h) => h.dayOfWeek === rule.dayOfWeek && h.hour === rule.hour)?.avgAcos.toString(),
      // @ts-ignore
      dataPoints: hourlyData.find((h) => h.dayOfWeek === rule.dayOfWeek && h.hour === rule.hour)?.dataPoints || 0,
      isEnabled: 1
    }))
  );
  return {
    strategyId,
    weeklyAnalysis: weeklyData,
    hourlyAnalysis: hourlyData,
    budgetAllocation,
    bidAdjustments
  };
}
async function getHourlyRule(strategyId, dayOfWeek, hour2) {
  const bidRules = await getBidRules(strategyId);
  const rule = bidRules.find((r) => r.dayOfWeek === dayOfWeek && r.hour === hour2);
  if (!rule) return null;
  return {
    dayOfWeek: rule.dayOfWeek,
    hour: rule.hour,
    bidMultiplier: parseFloat(rule.bidMultiplier || "1"),
    isEnabled: rule.ruleEnabled ?? true
  };
}
async function validateDaypartingDataSufficiency(campaignId, lookbackDays = 30) {
  const db = await getDb();
  const failedChecks = [];
  if (!db) {
    return {
      isValid: false,
      continuousDays: 0,
      totalClicks: 0,
      totalSpend: 0,
      avgDataPointsPerSlot: 0,
      failedChecks: ["\u6570\u636E\u5E93\u4E0D\u53EF\u7528"],
      recommendation: "\u6570\u636E\u5E93\u8FDE\u63A5\u5931\u8D25\uFF0C\u65E0\u6CD5\u6821\u9A8C"
    };
  }
  const amazonCampaignId = await resolveAmazonCampaignId2(campaignId);
  const summaryResult = await db.execute(sql`
    SELECT 
      COUNT(DISTINCT DATE(report_date)) as active_days,
      SUM(CAST(clicks AS UNSIGNED)) as total_clicks,
      SUM(CAST(spend AS DECIMAL(10,2))) as total_spend,
      MIN(report_date) as first_date,
      MAX(report_date) as last_date
    FROM daily_performance
    WHERE campaign_id = ${amazonCampaignId}
      AND report_date >= DATE_SUB(CURDATE(), INTERVAL ${lookbackDays + ATTRIBUTION_DELAY_DAYS} DAY)
      AND report_date <= DATE_SUB(CURDATE(), INTERVAL ${ATTRIBUTION_DELAY_DAYS} DAY)
  `);
  const rows = Array.isArray(summaryResult) ? Array.isArray(summaryResult[0]) ? summaryResult[0] : summaryResult : [];
  const summary = rows[0] || {};
  const continuousDays = Number(summary.active_days) || 0;
  const totalClicks = Number(summary.total_clicks) || 0;
  const totalSpend = Number(summary.total_spend) || 0;
  const hourlyResult = await db.execute(sql`
    SELECT 
      day_of_week, hour,
      COUNT(*) as data_points
    FROM hourly_performance
    WHERE campaign_id = ${amazonCampaignId}
      AND date >= DATE_SUB(CURDATE(), INTERVAL ${lookbackDays + ATTRIBUTION_DELAY_DAYS} DAY)
      AND date <= DATE_SUB(CURDATE(), INTERVAL ${ATTRIBUTION_DELAY_DAYS} DAY)
    GROUP BY day_of_week, hour
  `);
  const hourlyRows = Array.isArray(hourlyResult) ? Array.isArray(hourlyResult[0]) ? hourlyResult[0] : hourlyResult : [];
  const hourlyDataPoints = hourlyRows.map((r) => Number(r.data_points) || 0);
  const avgDataPointsPerSlot = hourlyDataPoints.length > 0 ? hourlyDataPoints.reduce((sum2, dp) => sum2 + dp, 0) / (7 * 12) : 0;
  const thresholds = DAYPARTING_DATA_THRESHOLDS;
  if (continuousDays < thresholds.minContinuousDays) {
    failedChecks.push(`\u6295\u653E\u5929\u6570\u4E0D\u8DB3: ${continuousDays}\u5929 < ${thresholds.minContinuousDays}\u5929`);
  }
  if (totalClicks < thresholds.minTotalClicks) {
    failedChecks.push(`\u603B\u70B9\u51FB\u4E0D\u8DB3: ${totalClicks}\u6B21 < ${thresholds.minTotalClicks}\u6B21`);
  }
  if (totalSpend < thresholds.minTotalSpend) {
    failedChecks.push(`\u603B\u82B1\u8D39\u4E0D\u8DB3: $${totalSpend.toFixed(2)} < $${thresholds.minTotalSpend}`);
  }
  if (avgDataPointsPerSlot < thresholds.minDataPointsPerSlot) {
    failedChecks.push(`\u65F6\u6BB5\u6570\u636E\u5BC6\u5EA6\u4E0D\u8DB3: \u5E73\u5747${avgDataPointsPerSlot.toFixed(1)}\u70B9/\u65F6\u6BB5 < ${thresholds.minDataPointsPerSlot}\u70B9/\u65F6\u6BB5`);
  }
  const isValid = failedChecks.length === 0;
  let recommendation = "";
  if (isValid) {
    recommendation = "\u6570\u636E\u5145\u5206\uFF0C\u53EF\u4EE5\u542F\u7528\u5206\u65F6\u7ADE\u4EF7";
  } else if (continuousDays < 14) {
    recommendation = `\u5E7F\u544A\u6D3B\u52A8\u6295\u653E\u65F6\u95F4\u8FC7\u77ED(${continuousDays}\u5929)\uFF0C\u5EFA\u8BAE\u81F3\u5C11\u6295\u653E30\u5929\u540E\u518D\u542F\u7528\u5206\u65F6\u7ADE\u4EF7`;
  } else if (totalClicks < 20) {
    recommendation = `\u70B9\u51FB\u91CF\u8FC7\u5C11(${totalClicks}\u6B21)\uFF0C\u5F53\u524D\u6570\u636E\u65E0\u6CD5\u652F\u6491\u5206\u65F6\u5206\u6790\uFF0C\u5EFA\u8BAE\u5148\u4F18\u5316\u57FA\u7840\u51FA\u4EF7\u63D0\u5347\u6D41\u91CF`;
  } else {
    recommendation = `\u6570\u636E\u91CF\u63A5\u8FD1\u95E8\u69DB\u4F46\u5C1A\u672A\u8FBE\u6807\uFF0C\u5EFA\u8BAE\u7EE7\u7EED\u79EF\u7D2F${thresholds.minContinuousDays - continuousDays}\u5929\u6570\u636E\u540E\u518D\u542F\u7528`;
  }
  return {
    isValid,
    continuousDays,
    totalClicks,
    totalSpend,
    avgDataPointsPerSlot,
    failedChecks,
    recommendation
  };
}
var log96, DAY_OF_WEEK_LABELS, HOUR_LABELS, ATTRIBUTION_DELAY_DAYS, DAYPARTING_DATA_THRESHOLDS;
var init_daypartingService = __esm({
  "server/budget/daypartingService.ts"() {
    "use strict";
    init_logger();
    init_drizzle_orm();
    init_db2();
    init_schema2();
    log96 = createModuleLogger("DaypartingService");
    DAY_OF_WEEK_LABELS = ["\u5468\u65E5", "\u5468\u4E00", "\u5468\u4E8C", "\u5468\u4E09", "\u5468\u56DB", "\u5468\u4E94", "\u5468\u516D"];
    HOUR_LABELS = Array.from({ length: 24 }, (_, i) => `${i.toString().padStart(2, "0")}:00`);
    __name(resolveAmazonCampaignId2, "resolveAmazonCampaignId");
    __name(analyzeWeeklyPerformance, "analyzeWeeklyPerformance");
    ATTRIBUTION_DELAY_DAYS = 3;
    __name(analyzeHourlyPerformance, "analyzeHourlyPerformance");
    __name(calculateOptimalBudgetAllocation, "calculateOptimalBudgetAllocation");
    __name(calculateOptimalBidAdjustments, "calculateOptimalBidAdjustments");
    __name(createDaypartingStrategy, "createDaypartingStrategy");
    __name(getDaypartingStrategies, "getDaypartingStrategies");
    __name(getDaypartingStrategy, "getDaypartingStrategy");
    __name(getDaypartingStrategyByCampaignId, "getDaypartingStrategyByCampaignId");
    __name(ensureDaypartingStrategy, "ensureDaypartingStrategy");
    __name(updateDaypartingStrategy, "updateDaypartingStrategy");
    __name(saveBudgetRules, "saveBudgetRules");
    __name(getBudgetRules, "getBudgetRules");
    __name(saveBidRules, "saveBidRules");
    __name(getBidRules, "getBidRules");
    __name(logStrategyExecution, "logStrategyExecution");
    __name(getExecutionLogs, "getExecutionLogs");
    __name(generateOptimalStrategy, "generateOptimalStrategy");
    __name(getHourlyRule, "getHourlyRule");
    DAYPARTING_DATA_THRESHOLDS = {
      /** 最少连续投放天数 */
      minContinuousDays: 30,
      /** 最少总点击数 */
      minTotalClicks: 50,
      /** 最少总花费（美元） */
      minTotalSpend: 20,
      /** 每个时段最少数据点数 */
      minDataPointsPerSlot: 3,
      /** 分时调整最大上浮比例（从±40%收紧到±20%） */
      maxBidMultiplierUp: 1.2,
      /** 分时调整最大下浮比例 */
      maxBidMultiplierDown: 0.8
    };
    __name(validateDaypartingDataSufficiency, "validateDaypartingDataSufficiency");
  }
});

