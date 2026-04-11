// Extracted from production dist/index.js
// Original module: server/routes/dailySync.ts
// Lines: 145

function getRegionFromMarketplace(marketplace) {
  const naMarketplaces = ["US", "CA", "MX", "BR"];
  const euMarketplaces = ["UK", "DE", "FR", "IT", "ES", "NL", "SE", "PL", "BE", "TR", "AE", "SA", "EG"];
  const feMarketplaces = ["JP", "AU", "SG", "IN"];
  if (naMarketplaces.includes(marketplace)) return "NA";
  if (euMarketplaces.includes(marketplace)) return "EU";
  if (feMarketplaces.includes(marketplace)) return "FE";
  return "NA";
}
function generateDateRange(startDate, endDate) {
  const dates = [];
  const start = new Date(startDate);
  const end = new Date(endDate);
  const current = new Date(start);
  while (current <= end) {
    dates.push(current.toISOString().split("T")[0]);
    current.setDate(current.getDate() + 1);
  }
  return dates;
}
var dailySyncRouter;
var init_dailySync = __esm({
  "server/routes/dailySync.ts"() {
    "use strict";
    init_trpc();
    init_zod();
    init_daily_sync_task();
    init_db2();
    init_accessControl();
    dailySyncRouter = router({
      /**
       * 手动触发每日同步任务
       */
      triggerSync: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        date: external_exports.string().optional()
        // YYYY-MM-DD格式,不传则同步昨天的数据
      })).mutation(async ({ ctx, input }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        const account = await getAdAccountById(input.accountId);
        if (!account) {
          throw new Error("\u8D26\u53F7\u4E0D\u5B58\u5728");
        }
        const credentials = await getAmazonApiCredentials(input.accountId);
        if (!credentials) {
          throw new Error("\u672A\u627E\u5230Amazon Ads API\u51ED\u8BC1");
        }
        const config2 = {
          clientId: credentials.clientId,
          clientSecret: credentials.clientSecret,
          refreshToken: credentials.refreshToken,
          profileId: account.profileId || "",
          region: getRegionFromMarketplace(account.marketplace),
          storeId: account.accountId
        };
        const syncDate = input.date || getYesterdayDate();
        const result = await syncAllCampaignsDailyData(config2, syncDate);
        return {
          success: true,
          date: syncDate,
          successCount: result.success,
          failedCount: result.failed
        };
      }),
      /**
       * 获取同步任务状态
       */
      getSyncStatus: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number()
      })).query(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        const endDate = /* @__PURE__ */ new Date();
        const startDate = /* @__PURE__ */ new Date();
        startDate.setDate(startDate.getDate() - 30);
        const recentData = await getDailyPerformanceByDateRange(
          input.accountId,
          startDate,
          endDate
        );
        const latestSync = recentData.length > 0 ? recentData[recentData.length - 1] : null;
        return {
          lastSyncDate: latestSync?.date || null,
          lastSyncTime: latestSync?.createdAt || null,
          status: latestSync ? "completed" : "never_synced",
          recentSyncCount: recentData.length
        };
      }),
      /**
       * 批量同步多个日期的数据
       */
      batchSync: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        startDate: external_exports.string(),
        // YYYY-MM-DD
        endDate: external_exports.string()
        // YYYY-MM-DD
      })).mutation(async ({ ctx, input }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        const account = await getAdAccountById(input.accountId);
        if (!account) {
          throw new Error("\u8D26\u53F7\u4E0D\u5B58\u5728");
        }
        const credentials = await getAmazonApiCredentials(input.accountId);
        if (!credentials) {
          throw new Error("\u672A\u627E\u5230Amazon Ads API\u51ED\u8BC1");
        }
        const config2 = {
          clientId: credentials.clientId,
          clientSecret: credentials.clientSecret,
          refreshToken: credentials.refreshToken,
          profileId: account.profileId || "",
          region: getRegionFromMarketplace(account.marketplace),
          storeId: account.accountId
        };
        const dates = generateDateRange(input.startDate, input.endDate);
        const results = [];
        for (const date6 of dates) {
          try {
            const result = await syncAllCampaignsDailyData(config2, date6);
            results.push({
              date: date6,
              success: true,
              successCount: result.success,
              failedCount: result.failed
            });
          } catch (error48) {
            results.push({
              date: date6,
              success: false,
              error: error48.message
            });
          }
        }
        return {
          success: true,
          results,
          totalDates: dates.length
        };
      })
    });
    __name(getRegionFromMarketplace, "getRegionFromMarketplace");
    __name(generateDateRange, "generateDateRange");
  }
});

