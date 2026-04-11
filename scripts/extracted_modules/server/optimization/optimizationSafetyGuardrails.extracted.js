// Extracted from production dist/index.js
// Original module: server/optimization/optimizationSafetyGuardrails.ts
// Lines: 271

async function checkEmergencyBrake(accountId, performanceGroupId2) {
  try {
    let emergencyLimits = SAFETY_LIMITS2.emergency;
    try {
      const configService = getGuardrailConfigService();
      const effectiveConfig = configService.getEffectiveConfig(accountId);
      emergencyLimits = effectiveConfig.emergency;
    } catch {
    }
    const lookback = emergencyLimits.lookbackDays;
    const now = /* @__PURE__ */ new Date();
    const recentEnd = new Date(now);
    const recentStart = new Date(now);
    recentStart.setDate(recentStart.getDate() - lookback);
    const previousEnd = new Date(recentStart);
    const previousStart = new Date(previousEnd);
    previousStart.setDate(previousStart.getDate() - lookback);
    const campaigns6 = await getCampaignsByPerformanceGroupId(performanceGroupId2);
    if (campaigns6.length === 0) {
      return { triggered: false, reason: null, recommendation: "none" };
    }
    let recentSpend = 0, recentSales = 0, recentOrders = 0;
    let previousSpend = 0, previousSales = 0, previousOrders = 0;
    for (const campaign of campaigns6) {
      try {
        const recentData = await getDailyPerformanceByDateRange(accountId, recentStart, recentEnd, campaign.campaignId);
        const previousData = await getDailyPerformanceByDateRange(accountId, previousStart, previousEnd, campaign.campaignId);
        for (const d of recentData) {
          recentSpend += Number(d.spend) || 0;
          recentSales += Number(d.sales) || 0;
          recentOrders += d.orders || 0;
        }
        for (const d of previousData) {
          previousSpend += Number(d.spend) || 0;
          previousSales += Number(d.sales) || 0;
          previousOrders += d.orders || 0;
        }
      } catch (e) {
      }
    }
    if (previousSpend < 10 && previousSales < 10) {
      return { triggered: false, reason: null, recommendation: "none" };
    }
    let hasRecentOptimization = false;
    try {
      const { optimizationLogs: optimizationLogs2 } = await Promise.resolve().then(() => (init_schema2(), schema_exports));
      const dbInstance = await getDb();
      if (dbInstance) {
        const recentOps = await dbInstance.select({ id: optimizationLogs2.id }).from(optimizationLogs2).where(and(
          eq(optimizationLogs2.accountId, accountId),
          sql`created_at >= DATE_SUB(NOW(), INTERVAL ${sql.raw(String(lookback))} DAY)`,
          // @ts-expect-error - type assertion
          eq(optimizationLogs2.status, "applied")
        )).limit(1);
        hasRecentOptimization = recentOps.length > 0;
      }
    } catch (e) {
    }
    if (previousSales > 30) {
      const salesDropRate = (previousSales - recentSales) / previousSales;
      if (salesDropRate >= emergencyLimits.salesDropThreshold) {
        if (hasRecentOptimization) {
          return {
            triggered: true,
            reason: `\u9500\u552E\u989D${lookback}\u5929\u5185\u4E0B\u964D${(salesDropRate * 100).toFixed(0)}%\uFF08$${previousSales.toFixed(0)}\u2192$${recentSales.toFixed(0)}\uFF09\uFF0C\u4E14\u6700\u8FD1\u6709\u4F18\u5316\u64CD\u4F5C`,
            recommendation: "reduce_bids"
          };
        }
        log94.warn(`[EmergencyBrake] v230: \u9500\u552E\u989D\u4E0B\u964D${(salesDropRate * 100).toFixed(0)}%\u4F46\u65E0\u8FD1\u671F\u4F18\u5316\u64CD\u4F5C\uFF0C\u5224\u5B9A\u4E3A\u81EA\u7136\u6CE2\u52A8\uFF0C\u4E0D\u89E6\u53D1\u5236\u52A8`);
      }
    }
    if (previousSpend > 20) {
      const spendSurgeRate = recentSpend / previousSpend;
      if (spendSurgeRate >= emergencyLimits.spendSurgeThreshold && recentSales < previousSales * 1.2) {
        if (hasRecentOptimization) {
          return {
            triggered: true,
            reason: `\u82B1\u8D39${lookback}\u5929\u5185\u6FC0\u589E${((spendSurgeRate - 1) * 100).toFixed(0)}%\u4F46\u9500\u552E\u672A\u540C\u6B65\u589E\u957F\uFF0C\u4E14\u6700\u8FD1\u6709\u4F18\u5316\u64CD\u4F5C`,
            recommendation: "reduce_budgets"
          };
        }
        log94.warn(`[EmergencyBrake] v230: \u82B1\u8D39\u6FC0\u589E${((spendSurgeRate - 1) * 100).toFixed(0)}%\u4F46\u65E0\u8FD1\u671F\u4F18\u5316\u64CD\u4F5C\uFF0C\u5224\u5B9A\u4E3A\u81EA\u7136\u6CE2\u52A8`);
      }
    }
    if (previousOrders > 10) {
      const ordersDropRate = (previousOrders - recentOrders) / previousOrders;
      if (ordersDropRate >= emergencyLimits.ordersDropThreshold) {
        if (hasRecentOptimization) {
          return {
            triggered: true,
            reason: `\u8BA2\u5355${lookback}\u5929\u5185\u4E0B\u964D${(ordersDropRate * 100).toFixed(0)}%\uFF08${previousOrders}\u2192${recentOrders}\uFF09\uFF0C\u4E14\u6700\u8FD1\u6709\u4F18\u5316\u64CD\u4F5C`,
            recommendation: "pause_optimization"
          };
        }
        log94.warn(`[EmergencyBrake] v230: \u8BA2\u5355\u4E0B\u964D${(ordersDropRate * 100).toFixed(0)}%\u4F46\u65E0\u8FD1\u671F\u4F18\u5316\u64CD\u4F5C\uFF0C\u5224\u5B9A\u4E3A\u81EA\u7136\u6CE2\u52A8`);
      }
    }
    return { triggered: false, reason: null, recommendation: "none" };
  } catch (error48) {
    log94.warn(`[EmergencyBrake] Error checking group ${performanceGroupId2}:`, error48);
    return { triggered: false, reason: null, recommendation: "none" };
  }
}
async function assessRiskLevel(accountId, performanceGroupId2) {
  let riskScore = 0;
  const factors = [];
  try {
    const brakeResult = await checkEmergencyBrake(accountId, performanceGroupId2);
    if (brakeResult.triggered) {
      riskScore += 60;
      factors.push(`\u7D27\u6025\u5236\u52A8\u89E6\u53D1: ${brakeResult.reason}`);
    }
    const lookback = 7;
    const now = /* @__PURE__ */ new Date();
    const recentStart = new Date(now);
    recentStart.setDate(recentStart.getDate() - lookback);
    const previousStart = new Date(recentStart);
    previousStart.setDate(previousStart.getDate() - lookback);
    const campaigns6 = await getCampaignsByPerformanceGroupId(performanceGroupId2);
    let recentSpend = 0, recentSales = 0, recentClicks = 0;
    let previousSpend = 0, previousSales = 0, previousClicks = 0;
    for (const campaign of campaigns6) {
      try {
        const recentData = await getDailyPerformanceByDateRange(accountId, recentStart, now, campaign.campaignId);
        const previousData = await getDailyPerformanceByDateRange(accountId, previousStart, recentStart, campaign.campaignId);
        for (const d of recentData) {
          recentSpend += Number(d.spend) || 0;
          recentSales += Number(d.sales) || 0;
          recentClicks += d.clicks || 0;
        }
        for (const d of previousData) {
          previousSpend += Number(d.spend) || 0;
          previousSales += Number(d.sales) || 0;
          previousClicks += d.clicks || 0;
        }
      } catch (e) {
      }
    }
    const recentACoS = recentSales > 0 ? recentSpend / recentSales : 0;
    const previousACoS = previousSales > 0 ? previousSpend / previousSales : 0;
    if (previousACoS > 0 && recentACoS > previousACoS * 1.3) {
      riskScore += 15;
      factors.push(`ACoS\u6076\u5316: ${(previousACoS * 100).toFixed(1)}%\u2192${(recentACoS * 100).toFixed(1)}%`);
    }
    if (previousSpend > 10 && recentSpend > previousSpend * 1.5 && recentSales < previousSales * 1.2) {
      riskScore += 15;
      factors.push(`\u82B1\u8D39\u6548\u7387\u4E0B\u964D: \u82B1\u8D39\u589E${((recentSpend / previousSpend - 1) * 100).toFixed(0)}%\u4F46\u9500\u552E\u4EC5\u589E${((recentSales / previousSales - 1) * 100).toFixed(0)}%`);
    }
    if (previousClicks > 50 && recentClicks < previousClicks * 0.7) {
      riskScore += 10;
      factors.push(`\u70B9\u51FB\u91CF\u4E0B\u964D: ${previousClicks}\u2192${recentClicks}`);
    }
    if (previousSales > 20 && recentSales < previousSales * 0.8) {
      riskScore += 15;
      factors.push(`\u9500\u552E\u989D\u4E0B\u964D: $${previousSales.toFixed(0)}\u2192$${recentSales.toFixed(0)}`);
    }
    let level;
    let autoResponse;
    if (riskScore >= 50) {
      level = "red";
      autoResponse = {
        action: brakeResult.recommendation === "pause_optimization" ? "pause_optimization" : "reduce_bids",
        bidMultiplier: 0.8,
        budgetMultiplier: 0.85,
        cooldownExtension: 2
      };
      log94.warn(`[RiskAssessment] \u{1F534} RED risk (score=${riskScore}) for PG ${performanceGroupId2}: ${factors.join("; ")}`);
    } else if (riskScore >= 25) {
      level = "yellow";
      autoResponse = {
        action: "slow_down",
        bidMultiplier: 0.9,
        budgetMultiplier: 0.95,
        cooldownExtension: 1.5
      };
      log94.info(`[RiskAssessment] \u{1F7E1} YELLOW risk (score=${riskScore}) for PG ${performanceGroupId2}: ${factors.join("; ")}`);
    } else {
      level = "green";
      autoResponse = {
        action: "none",
        bidMultiplier: 1,
        budgetMultiplier: 1,
        cooldownExtension: 1
      };
    }
    return { level, score: Math.min(riskScore, 100), factors, autoResponse };
  } catch (error48) {
    log94.warn(`[RiskAssessment] \u98CE\u9669\u8BC4\u4F30\u5F02\u5E38\uFF0C\u5B89\u5168\u62D2\u7EDD(RED) for PG ${performanceGroupId2}:`, error48);
    return {
      level: "red",
      score: 100,
      factors: [`\u98CE\u9669\u8BC4\u4F30\u5F02\u5E38(\u5B89\u5168\u62D2\u7EDD): ${error48.message}`],
      autoResponse: { action: "reduce_bids", bidMultiplier: 0.8, budgetMultiplier: 0.85, cooldownExtension: 2 }
    };
  }
}
async function preOptimizationSafetyCheck(accountId, performanceGroupId2) {
  const warnings = [];
  const riskAssessment = await assessRiskLevel(accountId, performanceGroupId2);
  if (riskAssessment.level === "red") {
    warnings.push(`\u{1F534} \u9AD8\u98CE\u9669 (\u8BC4\u5206${riskAssessment.score}): ${riskAssessment.factors.join("; ")}`);
    warnings.push(`\u81EA\u52A8\u54CD\u5E94: ${riskAssessment.autoResponse.action}, \u51FA\u4EF7\u4E58\u6570=${riskAssessment.autoResponse.bidMultiplier}, \u51B7\u5374\u5EF6\u957F=${riskAssessment.autoResponse.cooldownExtension}x`);
  } else if (riskAssessment.level === "yellow") {
    warnings.push(`\u{1F7E1} \u4E2D\u98CE\u9669 (\u8BC4\u5206${riskAssessment.score}): ${riskAssessment.factors.join("; ")}`);
    warnings.push(`\u81EA\u52A8\u54CD\u5E94: \u964D\u901F\u6A21\u5F0F, \u51FA\u4EF7\u4E58\u6570=${riskAssessment.autoResponse.bidMultiplier}`);
  }
  return {
    safe: riskAssessment.level !== "red",
    warnings,
    riskAssessment
  };
}
var log94, SAFETY_LIMITS2;
var init_optimizationSafetyGuardrails = __esm({
  "server/optimization/optimizationSafetyGuardrails.ts"() {
    "use strict";
    init_logger();
    init_db2();
    init_drizzle_orm();
    init_guardrailConfigService();
    log94 = createModuleLogger("OptimizationSafetyGuardrails");
    SAFETY_LIMITS2 = {
      bid: {
        maxSingleChangePercent: 0.15,
        // v510: 单次最大调整幅度从20%收紧至15%
        maxDailyChangePercent: 0.25,
        // v510: 每日累计最大调整幅度从30%收紧至25%
        minBid: 0.02,
        // 最低出价 $0.02
        maxBid: 100,
        // 最高出价 $100（绝对上限）
        consecutiveSameDirectionSlowdown: 3,
        // 连续同方向调整N次后降速
        slowdownFactor: 0.5
        // 降速因子（调整幅度减半）
      },
      budget: {
        maxSingleChangePercent: 0.25,
        // 单次最大调整幅度 25%
        maxDailyChangePercent: 0.35,
        // 每日累计最大调整幅度 35%
        minDailyBudget: 1,
        // 最低日预算 $1
        maxDailyBudget: 5e4
        // 最高日预算 $50,000
      },
      placement: {
        maxSingleChangePct: 25,
        // 单次最大调整幅度 25个百分点
        maxTotalAdjustment: 200,
        // 最高位置倾斜 200%
        minTotalAdjustment: -50
        // 最低位置倾斜 -50%
      },
      emergency: {
        salesDropThreshold: 0.4,
        // 销售额下降40%触发紧急制动
        spendSurgeThreshold: 2,
        // 花费激增200%触发紧急制动
        ordersDropThreshold: 0.5,
        // 订单下降50%触发紧急制动
        lookbackDays: 3
        // 紧急制动回看天数
      }
    };
    __name(checkEmergencyBrake, "checkEmergencyBrake");
    __name(assessRiskLevel, "assessRiskLevel");
    __name(preOptimizationSafetyCheck, "preOptimizationSafetyCheck");
  }
});

