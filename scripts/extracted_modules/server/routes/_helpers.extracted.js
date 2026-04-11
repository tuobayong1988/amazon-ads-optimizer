// Extracted from production dist/index.js
// Original module: server/routes/_helpers.ts
// Lines: 144

function generateSimulatedTrendData(target, days) {
  const data = [];
  const now = /* @__PURE__ */ new Date();
  const baseImpressions = target.impressions || 1e3;
  const baseClicks = target.clicks || 50;
  const baseSpend = parseFloat(target.spend || "10");
  const baseSales = parseFloat(target.sales || "30");
  const baseOrders = target.orders || 3;
  for (let i = days - 1; i >= 0; i--) {
    const date6 = new Date(now);
    date6.setDate(date6.getDate() - i);
    const variation = 0.7 + Math.random() * 0.6;
    const weekdayFactor = date6.getDay() === 0 || date6.getDay() === 6 ? 0.8 : 1.1;
    const impressions = Math.round(baseImpressions / days * variation * weekdayFactor);
    const clicks = Math.round(baseClicks / days * variation * weekdayFactor);
    const spend = Math.round(baseSpend / days * variation * weekdayFactor * 100) / 100;
    const sales = Math.round(baseSales / days * variation * weekdayFactor * 100) / 100;
    const orders = Math.round(baseOrders / days * variation * weekdayFactor);
    const ctr = impressions > 0 ? clicks / impressions * 100 : 0;
    const cvr = clicks > 0 ? orders / clicks * 100 : 0;
    const acos = sales > 0 ? spend / sales * 100 : 0;
    const roas = spend > 0 ? sales / spend : 0;
    const cpc = clicks > 0 ? spend / clicks : 0;
    data.push({
      date: date6.toISOString().split("T")[0],
      impressions,
      clicks,
      spend,
      sales,
      orders,
      ctr: Math.round(ctr * 100) / 100,
      cvr: Math.round(cvr * 100) / 100,
      acos: Math.round(acos * 100) / 100,
      roas: Math.round(roas * 100) / 100,
      cpc: Math.round(cpc * 100) / 100
    });
  }
  return data;
}
function calculateTrendSummary(data) {
  if (!data || data.length === 0) {
    return {
      totalImpressions: 0,
      totalClicks: 0,
      totalSpend: 0,
      totalSales: 0,
      totalOrders: 0,
      avgCtr: 0,
      avgCvr: 0,
      avgAcos: 0,
      avgRoas: 0,
      avgCpc: 0,
      trend: {
        impressions: "stable",
        clicks: "stable",
        spend: "stable",
        sales: "stable",
        acos: "stable",
        // @ts-ignore
        roas: "stable"
        // @ts-ignore
      }
      // @ts-ignore
    };
  }
  const totalImpressions = data.reduce((sum2, d) => sum2 + d.impressions, 0);
  const totalClicks = data.reduce((sum2, d) => sum2 + d.clicks, 0);
  const totalSpend = data.reduce((sum2, d) => sum2 + d.spend, 0);
  const totalSales = data.reduce((sum2, d) => sum2 + d.sales, 0);
  const totalOrders = data.reduce((sum2, d) => sum2 + d.orders, 0);
  const avgCtr = totalImpressions > 0 ? totalClicks / totalImpressions * 100 : 0;
  const avgCvr = totalClicks > 0 ? totalOrders / totalClicks * 100 : 0;
  const avgAcos = totalSales > 0 ? totalSpend / totalSales * 100 : 0;
  const avgRoas = totalSpend > 0 ? totalSales / totalSpend : 0;
  const avgCpc = totalClicks > 0 ? totalSpend / totalClicks : 0;
  const midPoint = Math.floor(data.length / 2);
  const firstHalf = data.slice(0, midPoint);
  const secondHalf = data.slice(midPoint);
  const calcTrend2 = /* @__PURE__ */ __name((metric) => {
    const firstAvg = firstHalf.reduce((sum2, d) => sum2 + (d[metric] || 0), 0) / (firstHalf.length || 1);
    const secondAvg = secondHalf.reduce((sum2, d) => sum2 + (d[metric] || 0), 0) / (secondHalf.length || 1);
    const change = firstAvg > 0 ? (secondAvg - firstAvg) / firstAvg * 100 : 0;
    if (change > 10) return "up";
    if (change < -10) return "down";
    return "stable";
  }, "calcTrend");
  return {
    totalImpressions,
    totalClicks,
    // @ts-ignore
    totalSpend: Math.round(totalSpend * 100) / 100,
    // @ts-ignore
    totalSales: Math.round(totalSales * 100) / 100,
    totalOrders,
    avgCtr: Math.round(avgCtr * 100) / 100,
    avgCvr: Math.round(avgCvr * 100) / 100,
    avgAcos: Math.round(avgAcos * 100) / 100,
    avgRoas: Math.round(avgRoas * 100) / 100,
    avgCpc: Math.round(avgCpc * 100) / 100,
    trend: {
      impressions: calcTrend2("impressions"),
      clicks: calcTrend2("clicks"),
      spend: calcTrend2("spend"),
      sales: calcTrend2("sales"),
      acos: calcTrend2("acos"),
      roas: calcTrend2("roas")
    }
  };
}
function calculateNextSendTime(frequency, sendTime, sendDayOfWeek, sendDayOfMonth) {
  const now = /* @__PURE__ */ new Date();
  const [hours, minutes] = sendTime.split(":").map(Number);
  const next = new Date(now);
  next.setHours(hours, minutes, 0, 0);
  if (frequency === "daily") {
    if (next <= now) {
      next.setDate(next.getDate() + 1);
    }
  } else if (frequency === "weekly") {
    const targetDay = sendDayOfWeek ?? 1;
    const currentDay = next.getDay();
    let daysUntilTarget = targetDay - currentDay;
    if (daysUntilTarget < 0 || daysUntilTarget === 0 && next <= now) {
      daysUntilTarget += 7;
    }
    next.setDate(next.getDate() + daysUntilTarget);
  } else if (frequency === "monthly") {
    const targetDate = sendDayOfMonth ?? 1;
    next.setDate(targetDate);
    if (next <= now) {
      next.setMonth(next.getMonth() + 1);
    }
  }
  return next.toISOString().slice(0, 19).replace("T", " ");
}
var init_helpers = __esm({
  "server/routes/_helpers.ts"() {
    "use strict";
    __name(generateSimulatedTrendData, "generateSimulatedTrendData");
    __name(calculateTrendSummary, "calculateTrendSummary");
    __name(calculateNextSendTime, "calculateNextSendTime");
  }
});

