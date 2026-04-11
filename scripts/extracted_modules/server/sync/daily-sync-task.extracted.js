// Extracted from production dist/index.js
// Original module: server/sync/daily-sync-task.ts
// Lines: 87

function buildPerformanceRecord(row, campaignId, date6) {
  const impressions = parseInt(row.impressions || "0");
  const clicks = parseInt(row.clicks || "0");
  const spend = parseFloat(row.cost || "0");
  const sales = parseFloat(row.sales7d || "0");
  const orders = parseInt(row.purchases7d || "0");
  return {
    campaignId: parseInt(campaignId, 10) || 0,
    // @ts-ignore
    accountId: parseInt(row.accountId || "0", 10) || 0,
    date: date6,
    impressions,
    clicks,
    spend: String(spend),
    sales: String(sales),
    // @ts-ignore
    orders,
    // @ts-ignore
    dailyAcos: sales > 0 ? String(spend / sales * 100) : null,
    // @ts-ignore
    dailyRoas: spend > 0 ? String(sales / spend) : null,
    // @ts-ignore
    ctr: impressions > 0 ? String(clicks / impressions * 100) : null,
    cvr: clicks > 0 ? String(orders / clicks * 100) : null,
    cpc: clicks > 0 ? String(spend / clicks) : null,
    // @ts-ignore
    sales7D: String(parseFloat(row.sales7d || "0")),
    // @ts-ignore
    orders7D: parseInt(row.purchases7d || "0"),
    // @ts-ignore
    sales30D: String(parseFloat(row.sales30d || "0")),
    // @ts-ignore
    orders30D: parseInt(row.purchases30d || "0")
  };
}
async function syncAllCampaignsDailyData(config2, date6) {
  log176.info(`[Daily Sync] \u5F00\u59CB\u540C\u6B65\u6240\u6709\u5E7F\u544A\u6D3B\u52A8\u7684\u6570\u636E, \u65E5\u671F: ${date6}`);
  const apiClient = new AmazonAdsApiClient({
    clientId: config2.clientId,
    clientSecret: config2.clientSecret,
    refreshToken: config2.refreshToken,
    profileId: config2.profileId,
    region: config2.region
  });
  let successCount = 0;
  let failedCount = 0;
  try {
    log176.info("[Daily Sync] \u8BF7\u6C42SP\u5E7F\u544A\u6D3B\u52A8\u62A5\u544A...");
    const spReportId = await apiClient.requestSpCampaignReport(date6, date6);
    const spData = await apiClient.waitAndDownloadReport(spReportId);
    log176.info(`[Daily Sync] SP\u62A5\u544A\u4E0B\u8F7D\u5B8C\u6210, \u5171 ${spData.length} \u6761\u8BB0\u5F55`);
    for (const row of spData) {
      try {
        const record2 = buildPerformanceRecord(row, row.campaignId?.toString() || "", date6);
        await createDailyPerformance(record2);
        successCount++;
      } catch (error48) {
        log176.warn(`[Daily Sync] \u5B58\u50A8\u5E7F\u544A\u6D3B\u52A8 ${row.campaignId} \u5931\u8D25:`, error48.message);
        failedCount++;
      }
    }
    log176.info(`[Daily Sync] \u540C\u6B65\u5B8C\u6210, \u6210\u529F: ${successCount}, \u5931\u8D25: ${failedCount}`);
    return { success: successCount, failed: failedCount };
  } catch (error48) {
    log176.warn("[Daily Sync] \u540C\u6B65\u5931\u8D25:", error48.message);
    throw error48;
  }
}
function getYesterdayDate() {
  const yesterday = /* @__PURE__ */ new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return yesterday.toISOString().split("T")[0];
}
var log176;
var init_daily_sync_task = __esm({
  "server/sync/daily-sync-task.ts"() {
    "use strict";
    init_logger();
    init_amazonAdsApi();
    init_db2();
    log176 = createModuleLogger("Dailysynctask");
    __name(buildPerformanceRecord, "buildPerformanceRecord");
    __name(syncAllCampaignsDailyData, "syncAllCampaignsDailyData");
    __name(getYesterdayDate, "getYesterdayDate");
  }
});

