// Extracted from production dist/index.js
// Original module: server/analytics/attributionWindowHelper.ts
// Lines: 208

function getWindowDateRange(windowType, marketplace = "US") {
  const config2 = windowType === "bid_optimization" ? ATTRIBUTION_WINDOW.BID_OPTIMIZATION : windowType === "risk_control" ? ATTRIBUTION_WINDOW.RISK_CONTROL : ATTRIBUTION_WINDOW.TREND_ANALYSIS;
  const now = /* @__PURE__ */ new Date();
  const endDate = new Date(now.getTime() - config2.endDaysAgo * 24 * 60 * 60 * 1e3);
  const startDate = new Date(now.getTime() - config2.startDaysAgo * 24 * 60 * 60 * 1e3);
  return {
    startDate,
    endDate,
    startDateStr: startDate.toISOString().split("T")[0],
    endDateStr: endDate.toISOString().split("T")[0]
  };
}
async function getCampaignWindowedPerformance(accountId, campaignId, windowType, marketplace = "US") {
  const { startDate, endDate, startDateStr, endDateStr } = getWindowDateRange(windowType, marketplace);
  const dailyData = await getDailyPerformanceByDateRange(
    accountId,
    startDate,
    endDate,
    campaignId
  );
  let impressions = 0, clicks = 0, spend = 0, sales = 0, orders = 0;
  for (const day2 of dailyData) {
    impressions += Number(day2.impressions) || 0;
    clicks += Number(day2.clicks) || 0;
    spend += parseFloat(String(day2.spend || "0"));
    sales += parseFloat(String(day2.sales || "0"));
    orders += Number(day2.orders) || 0;
  }
  const acos = sales > 0 ? spend / sales * 100 : 0;
  const roas = spend > 0 ? sales / spend : 0;
  const cvr = clicks > 0 ? orders / clicks * 100 : 0;
  const cpc = clicks > 0 ? spend / clicks : 0;
  const ctr = impressions > 0 ? clicks / impressions * 100 : 0;
  return {
    windowType,
    startDate: startDateStr,
    endDate: endDateStr,
    impressions,
    clicks,
    spend,
    sales,
    orders,
    acos,
    roas,
    cvr,
    cpc,
    ctr,
    dataDays: dailyData.length,
    isAttributionMature: windowType === "bid_optimization"
  };
}
async function calculateAttributionCorrectionFactor(accountId, campaignId, marketplace = "US") {
  const maturePerf = await getCampaignWindowedPerformance(
    accountId,
    campaignId,
    "bid_optimization",
    marketplace
  );
  const realtimePerf = await getCampaignWindowedPerformance(
    accountId,
    campaignId,
    "risk_control",
    marketplace
  );
  const matureDailySales = maturePerf.dataDays > 0 ? maturePerf.sales / maturePerf.dataDays : 0;
  const realtimeDailySales = realtimePerf.dataDays > 0 ? realtimePerf.sales / realtimePerf.dataDays : 0;
  let correctionFactor = 1;
  if (realtimeDailySales > 0 && matureDailySales > 0) {
    correctionFactor = matureDailySales / realtimeDailySales;
    correctionFactor = Math.max(0.5, Math.min(2, correctionFactor));
  }
  const confidence = Math.min(0.95, 0.3 + maturePerf.clicks / 500 * 0.65);
  return {
    correctionFactor,
    maturePerformance: maturePerf,
    realtimePerformance: realtimePerf,
    confidence
  };
}
function applyAttributionCorrection(rawPerformance, correctionFactor, windowType) {
  if (windowType === "risk_control") {
    return {
      ...rawPerformance,
      corrected: false,
      correctionFactor: 1
    };
  }
  if (windowType === "bid_optimization") {
    return {
      impressions: rawPerformance.impressions,
      clicks: rawPerformance.clicks,
      spend: rawPerformance.spend,
      // 销售和订单乘以校正系数
      sales: rawPerformance.sales * correctionFactor,
      orders: Math.round(rawPerformance.orders * correctionFactor),
      corrected: true,
      correctionFactor
    };
  }
  return {
    ...rawPerformance,
    corrected: false,
    correctionFactor: 1
  };
}
function shouldApplyCorrection(correctionFactor, matureClicks, campaignCreatedDaysAgo) {
  if (matureClicks < 50) return false;
  if (campaignCreatedDaysAgo < 7) return false;
  if (Math.abs(correctionFactor - 1) < 0.1) return false;
  return true;
}
async function detectRiskSignals(accountId, campaignId, marketplace = "US") {
  const { maturePerformance, realtimePerformance } = await calculateAttributionCorrectionFactor(
    accountId,
    campaignId,
    marketplace
  );
  const risks = [];
  const matureDailySpend = maturePerformance.dataDays > 0 ? maturePerformance.spend / maturePerformance.dataDays : 0;
  const realtimeDailySpend = realtimePerformance.dataDays > 0 ? realtimePerformance.spend / realtimePerformance.dataDays : 0;
  if (matureDailySpend > 0 && realtimeDailySpend > matureDailySpend * 2) {
    const ratio = realtimeDailySpend / matureDailySpend;
    risks.push({
      type: "spend_spike",
      severity: ratio > 3 ? "critical" : ratio > 2.5 ? "high" : "medium",
      description: `\u65E5\u5747\u82B1\u8D39\u98D9\u5347: \u5B9E\u65F6$${realtimeDailySpend.toFixed(2)} vs \u6210\u719F$${matureDailySpend.toFixed(2)} (${ratio.toFixed(1)}x)`,
      matureValue: matureDailySpend,
      realtimeValue: realtimeDailySpend
    });
  }
  const matureDailyImpressions = maturePerformance.dataDays > 0 ? maturePerformance.impressions / maturePerformance.dataDays : 0;
  if (matureDailyImpressions > 100 && realtimePerformance.impressions === 0) {
    risks.push({
      type: "zero_impression_storm",
      severity: matureDailyImpressions > 1e3 ? "critical" : "high",
      description: `\u96F6\u66DD\u5149\u98CE\u66B4: \u6210\u719F\u7A97\u53E3\u65E5\u5747${Math.round(matureDailyImpressions)}\u66DD\u5149\uFF0C\u5B9E\u65F6\u7A97\u53E3\u4E3A0`,
      matureValue: matureDailyImpressions,
      realtimeValue: 0
    });
  }
  if (maturePerformance.cpc > 0 && realtimePerformance.cpc > maturePerformance.cpc * 1.5) {
    const ratio = realtimePerformance.cpc / maturePerformance.cpc;
    risks.push({
      type: "cpc_spike",
      severity: ratio > 2 ? "high" : "medium",
      description: `CPC\u98D9\u5347: \u5B9E\u65F6$${realtimePerformance.cpc.toFixed(2)} vs \u6210\u719F$${maturePerformance.cpc.toFixed(2)} (${ratio.toFixed(1)}x)`,
      matureValue: maturePerformance.cpc,
      realtimeValue: realtimePerformance.cpc
    });
  }
  if (maturePerformance.acos > 0 && realtimePerformance.spend > 0) {
    const adjustedRealtimeAcos = realtimePerformance.acos;
    const threshold = maturePerformance.acos * 2.5;
    if (adjustedRealtimeAcos > threshold && adjustedRealtimeAcos > 100) {
      risks.push({
        type: "acos_spike",
        severity: adjustedRealtimeAcos > maturePerformance.acos * 4 ? "high" : "medium",
        description: `ACoS\u5F02\u5E38: \u5B9E\u65F6${adjustedRealtimeAcos.toFixed(1)}% vs \u6210\u719F${maturePerformance.acos.toFixed(1)}% (\u8003\u8651\u5F52\u56E0\u5EF6\u8FDF\u540E\u4ECD\u5F02\u5E38)`,
        matureValue: maturePerformance.acos,
        realtimeValue: adjustedRealtimeAcos
      });
    }
  }
  return {
    hasRisk: risks.length > 0,
    risks
  };
}
var ATTRIBUTION_WINDOW;
var init_attributionWindowHelper = __esm({
  "server/analytics/attributionWindowHelper.ts"() {
    "use strict";
    init_db2();
    ATTRIBUTION_WINDOW = {
      /** Amazon 7天归因窗口的安全边际（天） */
      ATTRIBUTION_LAG_DAYS: 3,
      /** 出价优化数据窗口：D-4 到 D-30（成熟数据） */
      BID_OPTIMIZATION: {
        startDaysAgo: 30,
        // 从30天前开始
        endDaysAgo: 4,
        // 到4天前结束（跳过D-0~D-3）
        description: "\u51FA\u4EF7\u4F18\u5316\u7A97\u53E3(D-4~D-30): \u5F52\u56E0\u5DF2\u7A33\u5B9A\u7684\u6210\u719F\u6570\u636E"
      },
      /** 风控扫描数据窗口：D-0 到 D-3（实时数据） */
      RISK_CONTROL: {
        startDaysAgo: 3,
        // 从3天前开始
        endDaysAgo: 0,
        // 到今天
        description: "\u98CE\u63A7\u626B\u63CF\u7A97\u53E3(D-0~D-3): \u68C0\u6D4B\u5F02\u5E38\u7684\u5B9E\u65F6\u6570\u636E"
      },
      /** 趋势分析数据窗口：D-0 到 D-60（全量数据） */
      TREND_ANALYSIS: {
        startDaysAgo: 60,
        endDaysAgo: 0,
        description: "\u8D8B\u52BF\u5206\u6790\u7A97\u53E3(D-0~D-60): \u957F\u671F\u8D8B\u52BF\u5224\u65AD"
      }
    };
    __name(getWindowDateRange, "getWindowDateRange");
    __name(getCampaignWindowedPerformance, "getCampaignWindowedPerformance");
    __name(calculateAttributionCorrectionFactor, "calculateAttributionCorrectionFactor");
    __name(applyAttributionCorrection, "applyAttributionCorrection");
    __name(shouldApplyCorrection, "shouldApplyCorrection");
    __name(detectRiskSignals, "detectRiskSignals");
  }
});

