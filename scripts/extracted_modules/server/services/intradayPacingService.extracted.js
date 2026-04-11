// Extracted from production dist/index.js
// Original module: server/services/intradayPacingService.ts
// Lines: 233

var intradayPacingService_exports = {};
__export(intradayPacingService_exports, {
  INTRADAY_CONFIG: () => INTRADAY_CONFIG,
  adjustIntradayPacing: () => adjustIntradayPacing,
  applyIntradayAdjustment: () => applyIntradayAdjustment,
  calculateBudgetRunway: () => calculateBudgetRunway,
  checkAllCampaignsPacing: () => checkAllCampaignsPacing,
  default: () => intradayPacingService_default,
  getCriticalCampaigns: () => getCriticalCampaigns
});
async function adjustIntradayPacing(campaignId, accountId) {
  const realtimeData = await getRealtimeSpendForGuard(accountId, campaignId);
  const dailyBudget = await getCampaignBudget(accountId, campaignId);
  const marketplace = await getAccountMarketplace(accountId);
  const currentHour = getLocalHour(/* @__PURE__ */ new Date(), marketplace);
  const hoursRemaining = Math.max(1, INTRADAY_CONFIG.targetEndHour - currentHour);
  const hoursPassed = currentHour - INTRADAY_CONFIG.startHour;
  const totalHours = INTRADAY_CONFIG.targetEndHour - INTRADAY_CONFIG.startHour;
  const idealSpendPercent = hoursPassed / totalHours;
  const actualSpendPercent = dailyBudget > 0 ? realtimeData.todaySpend / dailyBudget : 0;
  const pacingRatio = idealSpendPercent > 0 ? actualSpendPercent / idealSpendPercent : 1;
  let pacingStatus;
  let suggestedAction = "none";
  let suggestedMultiplier = 1;
  let reason = "";
  if (pacingRatio >= INTRADAY_CONFIG.criticalThreshold) {
    pacingStatus = "critical";
    suggestedAction = "reduce_bid";
    suggestedMultiplier = INTRADAY_CONFIG.criticalMultiplier;
    reason = `\u{1F525} \u70E7\u94B1\u592A\u5FEB\uFF01\u6D88\u8017\u901F\u5EA6\u662F\u7406\u60F3\u7684${(pacingRatio * 100).toFixed(0)}%\uFF0C\u89E6\u53D1\u65E5\u5185\u4FDD\u62A4`;
  } else if (pacingRatio >= INTRADAY_CONFIG.overspendingThreshold) {
    pacingStatus = "overspending";
    suggestedAction = "reduce_bid";
    suggestedMultiplier = INTRADAY_CONFIG.overspendingMultiplier;
    reason = `\u6D88\u8017\u901F\u5EA6\u504F\u5FEB\uFF08${(pacingRatio * 100).toFixed(0)}%\uFF09\uFF0C\u5EFA\u8BAE\u964D\u4F4E\u51FA\u4EF7`;
  } else if (pacingRatio <= INTRADAY_CONFIG.underspendingThreshold) {
    pacingStatus = "underspending";
    suggestedAction = "increase_bid";
    suggestedMultiplier = INTRADAY_CONFIG.underspendingMultiplier;
    reason = `\u6D88\u8017\u901F\u5EA6\u504F\u6162\uFF08${(pacingRatio * 100).toFixed(0)}%\uFF09\uFF0C\u53EF\u4EE5\u9002\u5F53\u63D0\u9AD8\u51FA\u4EF7`;
  } else {
    pacingStatus = "on_track";
    reason = "\u6D88\u8017\u901F\u5EA6\u6B63\u5E38";
  }
  const anomalyResult = detectAnomalies2(
    realtimeData.todayClicks,
    realtimeData.todayImpressions,
    realtimeData.todaySpend,
    currentHour
  );
  if (anomalyResult.detected) {
    suggestedAction = anomalyResult.action;
    reason = anomalyResult.reason;
  }
  return {
    campaignId,
    accountId,
    currentHour,
    dailyBudget,
    todaySpend: realtimeData.todaySpend,
    todayClicks: realtimeData.todayClicks,
    todayImpressions: realtimeData.todayImpressions,
    idealSpendPercent: Math.round(idealSpendPercent * 100) / 100,
    actualSpendPercent: Math.round(actualSpendPercent * 100) / 100,
    pacingStatus,
    suggestedAction,
    suggestedMultiplier,
    reason,
    anomalyDetected: anomalyResult.detected,
    anomalyType: anomalyResult.type
  };
}
async function checkAllCampaignsPacing(accountId) {
  const db = await getDb();
  if (!db) return [];
  try {
    const [rows] = await db.execute(sql`
      SELECT campaignId, dailyBudget
      FROM campaigns
      WHERE accountId = ${accountId}
        AND state = 'enabled'
        AND dailyBudget > 0
    `);
    const campaigns6 = Array.isArray(rows) ? rows : [];
    const results = [];
    for (const campaign of campaigns6) {
      const adjustment = await adjustIntradayPacing(
        // @ts-ignore
        campaign.campaignId,
        accountId
      );
      results.push(adjustment);
    }
    return results;
  } catch (error48) {
    log147.warn("[IntradayPacing] \u6279\u91CF\u68C0\u67E5\u5931\u8D25:", error48);
    return [];
  }
}
async function getCriticalCampaigns(accountId) {
  const allAdjustments = await checkAllCampaignsPacing(accountId);
  return allAdjustments.filter(
    (adj) => adj.pacingStatus === "critical" || adj.anomalyDetected || adj.suggestedAction === "pause"
  );
}
async function applyIntradayAdjustment(adjustment) {
  log147.info("[IntradayPacing] \u5E94\u7528\u8C03\u6574:", {
    campaignId: adjustment.campaignId,
    action: adjustment.suggestedAction,
    multiplier: adjustment.suggestedMultiplier,
    reason: adjustment.reason
  });
  return {
    success: true,
    action: adjustment.suggestedAction,
    previousMultiplier: 1,
    newMultiplier: adjustment.suggestedMultiplier
  };
}
async function getCampaignBudget(accountId, campaignId) {
  const db = await getDb();
  if (!db) return 0;
  try {
    const [rows] = await db.execute(sql`
      SELECT dailyBudget
      FROM campaigns
      WHERE accountId = ${accountId}
        AND campaignId = ${campaignId}
      LIMIT 1
    `);
    const campaign = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
    return campaign?.dailyBudget || 0;
  } catch (error48) {
    log147.warn("[IntradayPacing] \u83B7\u53D6\u9884\u7B97\u5931\u8D25:", error48);
    return 0;
  }
}
function detectAnomalies2(clicks, impressions, spend, currentHour) {
  const avgClicksPerHour = currentHour > 0 ? clicks / currentHour : clicks;
  const ctr = impressions > 0 ? clicks / impressions : 0;
  if (avgClicksPerHour > INTRADAY_CONFIG.clickFraudThreshold || ctr > INTRADAY_CONFIG.clickFraudCtrThreshold) {
    return {
      detected: true,
      type: "click_fraud",
      action: "pause",
      reason: `\u26A0\uFE0F \u68C0\u6D4B\u5230\u5F02\u5E38\u6D41\u91CF\uFF01\u6BCF\u5C0F\u65F6\u70B9\u51FB${avgClicksPerHour.toFixed(0)}\u6B21\uFF0CCTR ${(ctr * 100).toFixed(1)}%\uFF0C\u5EFA\u8BAE\u7D27\u6025\u6682\u505C`
    };
  }
  if (spend > 0 && clicks > INTRADAY_CONFIG.zeroConversionClickThreshold) {
    const avgSpendPerClick = spend / clicks;
    if (avgSpendPerClick > 2) {
      return {
        detected: true,
        type: "budget_drain",
        action: "alert",
        reason: `\u26A0\uFE0F \u6BCF\u6B21\u70B9\u51FB\u6210\u672C\u5F02\u5E38\u9AD8\uFF08$${avgSpendPerClick.toFixed(2)}\uFF09\uFF0C\u8BF7\u68C0\u67E5\u7ADE\u4EF7\u8BBE\u7F6E`
      };
    }
  }
  return {
    detected: false,
    action: "none",
    reason: ""
  };
}
function calculateBudgetRunway(dailyBudget, currentSpend, currentHour, avgSpendPerHour) {
  const remainingBudget = dailyBudget - currentSpend;
  const hoursRemaining = avgSpendPerHour > 0 ? remainingBudget / avgSpendPerHour : 24 - currentHour;
  const projectedEndHour = currentHour + hoursRemaining;
  return {
    remainingBudget,
    hoursRemaining: Math.round(hoursRemaining * 10) / 10,
    projectedEndHour: Math.min(24, Math.round(projectedEndHour)),
    willLastUntilTarget: projectedEndHour >= INTRADAY_CONFIG.targetEndHour
  };
}
var log147, INTRADAY_CONFIG, intradayPacingService_default;
var init_intradayPacingService = __esm({
  "server/services/intradayPacingService.ts"() {
    "use strict";
    init_db2();
    init_drizzle_orm();
    init_dualTrackSyncService();
    init_algorithmUtils();
    init_logger();
    log147 = createModuleLogger("IntradayPacing");
    INTRADAY_CONFIG = {
      // 目标结束时间（小时，24小时制）- 希望预算能撑到这个时间
      targetEndHour: 22,
      // 开始时间（小时）
      startHour: 0,
      // 消耗速度阈值
      overspendingThreshold: 1.5,
      // 超过理想消耗的150%
      criticalThreshold: 2,
      // 超过理想消耗的200%
      underspendingThreshold: 0.5,
      // 低于理想消耗的50%
      // 调整乘数
      overspendingMultiplier: 0.8,
      // 花太快时降低20%
      criticalMultiplier: 0.5,
      // 危急时降低50%
      underspendingMultiplier: 1.2,
      // 花太慢时提高20%
      // 异常检测阈值
      clickFraudThreshold: 100,
      // 单小时点击超过100次
      clickFraudCtrThreshold: 0.15,
      // CTR超过15%可能是异常
      zeroConversionClickThreshold: 50,
      // 50次点击0转化触发警告
      // 最小检查间隔（分钟）
      minCheckInterval: 15
    };
    __name(adjustIntradayPacing, "adjustIntradayPacing");
    __name(checkAllCampaignsPacing, "checkAllCampaignsPacing");
    __name(getCriticalCampaigns, "getCriticalCampaigns");
    __name(applyIntradayAdjustment, "applyIntradayAdjustment");
    __name(getCampaignBudget, "getCampaignBudget");
    __name(detectAnomalies2, "detectAnomalies");
    __name(calculateBudgetRunway, "calculateBudgetRunway");
    intradayPacingService_default = {
      adjustIntradayPacing,
      checkAllCampaignsPacing,
      getCriticalCampaigns,
      applyIntradayAdjustment,
      calculateBudgetRunway,
      INTRADAY_CONFIG
    };
  }
});

