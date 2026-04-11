// Extracted from production dist/index.js
// Original module: server/routes/analytics.ts
// Lines: 402

async function getAccountCurrency(accountId) {
  const cached2 = accountCurrencyCache2.get(accountId);
  if (cached2 && Date.now() < cached2.expireAt) {
    return cached2.currency;
  }
  let currency = "USD";
  try {
    const { getDb: getDb3 } = await Promise.resolve().then(() => (init_connection(), connection_exports));
    const dbInstance = await getDb3();
    if (dbInstance) {
      const { amazonApiCredentials: amazonApiCredentials3 } = await Promise.resolve().then(() => (init_schema2(), schema_exports));
      const [cred] = await dbInstance.select({ currencyCode: amazonApiCredentials3.currencyCode }).from(amazonApiCredentials3).where(eq(amazonApiCredentials3.accountId, accountId)).limit(1);
      if (cred?.currencyCode) {
        currency = cred.currencyCode;
      }
    }
  } catch (e) {
  }
  accountCurrencyCache2.set(accountId, { currency, expireAt: Date.now() + 15 * 60 * 1e3 });
  return currency;
}
var log161, accountCurrencyCache2, analyticsRouter, advancedAnalyticsRouter;
var init_analytics2 = __esm({
  "server/routes/analytics.ts"() {
    "use strict";
    init_trpc();
    init_zod();
    init_db2();
    init_advancedAnalyticsService();
    init_drizzle_orm();
    init_accessControl();
    init_apiCacheService();
    init_logger();
    log161 = createModuleLogger("Route_analytics");
    accountCurrencyCache2 = /* @__PURE__ */ new Map();
    __name(getAccountCurrency, "getAccountCurrency");
    analyticsRouter = router({
      getDailyPerformance: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        startDate: external_exports.string(),
        // @ts-ignore
        endDate: external_exports.string(),
        campaignId: external_exports.number().optional()
      })).query(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        return getDailyPerformanceByDateRange(
          input.accountId,
          new Date(input.startDate),
          new Date(input.endDate),
          input.campaignId
        );
      }),
      getSummary: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        startDate: external_exports.string(),
        endDate: external_exports.string()
      })).query(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        return getPerformanceSummary(
          input.accountId,
          new Date(input.startDate),
          new Date(input.endDate)
        );
      }),
      /**
       * 获取趋势数据（真实数据）
       * v386: 添加2分钟API缓存
       */
      getTrendData: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        days: external_exports.number().optional().default(30),
        startDate: external_exports.string().optional(),
        // YYYY-MM-DD
        endDate: external_exports.string().optional()
        // YYYY-MM-DD
      })).query(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        const cacheKey = apiCache.generateKey("analytics.getTrendData", ctx.user.id, input);
        const cached2 = apiCache.get(cacheKey);
        if (cached2) return cached2;
        const endDate = input.endDate ? new Date(input.endDate) : /* @__PURE__ */ new Date();
        const startDate = input.startDate ? new Date(input.startDate) : (() => {
          const d = /* @__PURE__ */ new Date();
          d.setDate(d.getDate() - input.days);
          return d;
        })();
        const dailyAggregated = await getDailyPerformanceAggregatedByDate(
          input.accountId,
          startDate,
          endDate
        );
        if (!dailyAggregated || dailyAggregated.length === 0) {
          return [];
        }
        const result = dailyAggregated.map((day2) => {
          const sales = parseFloat(day2.totalSales || "0");
          const spend = parseFloat(day2.totalSpend || "0");
          const impressions = Number(day2.totalImpressions) || 0;
          const clicks = Number(day2.totalClicks) || 0;
          const orders = Number(day2.totalOrders) || 0;
          return {
            date: day2.date ? new Date(day2.date).toLocaleDateString("zh-CN", { month: "short", day: "numeric" }) : "N/A",
            fullDate: day2.date || (/* @__PURE__ */ new Date()).toISOString().split("T")[0],
            sales,
            spend,
            // @ts-ignore
            impressions,
            clicks,
            orders,
            // ✅ 加权计算派生指标
            acos: sales > 0 ? spend / sales * 100 : 0,
            roas: spend > 0 ? sales / spend : 0,
            ctr: impressions > 0 ? clicks / impressions * 100 : 0,
            cvr: clicks > 0 ? orders / clicks * 100 : 0,
            cpc: clicks > 0 ? spend / clicks : 0
          };
        });
        apiCache.set(cacheKey, result, 2 * 60 * 1e3);
        return result;
      }),
      /**
       * 获取周对比数据（真实数据）
       * v386: 添加2分钟API缓存
       */
      getWeeklyComparison: protectedProcedure.input(external_exports.object({ accountId: external_exports.number() })).query(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        const cacheKey = apiCache.generateKey("analytics.getWeeklyComparison", ctx.user.id, input);
        const cached2 = apiCache.get(cacheKey);
        if (cached2) return cached2;
        const today = /* @__PURE__ */ new Date();
        const dayOfWeek = today.getDay();
        const thisWeekStart = new Date(today);
        thisWeekStart.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
        thisWeekStart.setHours(0, 0, 0, 0);
        const lastWeekStart = new Date(thisWeekStart);
        lastWeekStart.setDate(lastWeekStart.getDate() - 7);
        const lastWeekEnd = new Date(thisWeekStart);
        lastWeekEnd.setDate(lastWeekEnd.getDate() - 1);
        lastWeekEnd.setHours(23, 59, 59, 999);
        const [thisWeekData, lastWeekData] = await Promise.all([
          getDailyPerformanceAggregatedByDate(input.accountId, thisWeekStart, today),
          getDailyPerformanceAggregatedByDate(input.accountId, lastWeekStart, lastWeekEnd)
        ]);
        const weekDays = ["\u5468\u4E00", "\u5468\u4E8C", "\u5468\u4E09", "\u5468\u56DB", "\u5468\u4E94", "\u5468\u516D", "\u5468\u65E5"];
        const result = weekDays.map((name2, index2) => {
          const thisWeekDay = thisWeekData?.find((d) => {
            const date6 = new Date(d.date);
            const dow = date6.getDay();
            return (dow === 0 ? 6 : dow - 1) === index2;
          });
          const lastWeekDay = lastWeekData?.find((d) => {
            const date6 = new Date(d.date);
            const dow = date6.getDay();
            return (dow === 0 ? 6 : dow - 1) === index2;
          });
          return {
            name: name2,
            thisWeek: parseFloat(thisWeekDay?.totalSales || "0"),
            lastWeek: parseFloat(lastWeekDay?.totalSales || "0")
          };
        });
        apiCache.set(cacheKey, result, 2 * 60 * 1e3);
        return result;
      }),
      /**
       * 获取KPI汇总
       * v386: 添加2分钟API缓存 + 货币查询缓存
       */
      getKPIs: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        startDate: external_exports.string().optional(),
        // YYYY-MM-DD
        endDate: external_exports.string().optional()
        // YYYY-MM-DD
      })).query(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        const cacheKey = apiCache.generateKey("analytics.getKPIs", ctx.user.id, input);
        const cached2 = apiCache.get(cacheKey);
        if (cached2) return cached2;
        const endDate = input.endDate ? new Date(input.endDate) : /* @__PURE__ */ new Date();
        const startDate = input.startDate ? new Date(input.startDate) : new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1e3);
        const diffMs = endDate.getTime() - startDate.getTime();
        const days = Math.max(1, Math.ceil(diffMs / (24 * 60 * 60 * 1e3)) + 1);
        const [summary, accountCurrency] = await Promise.all([
          getPerformanceSummary(input.accountId, startDate, endDate),
          getAccountCurrency(input.accountId)
        ]);
        const emptyResult = {
          conversionsPerDay: 0,
          roas: 0,
          totalSales: 0,
          acos: 0,
          revenuePerDay: 0,
          totalSpend: 0,
          totalOrders: 0,
          totalClicks: 0,
          totalImpressions: 0,
          ctr: 0,
          cvr: 0,
          cpc: 0,
          days,
          startDate: startDate.toISOString().split("T")[0],
          endDate: endDate.toISOString().split("T")[0],
          currency: accountCurrency,
          dataMaturity: null
        };
        if (!summary) {
          apiCache.set(cacheKey, emptyResult, 2 * 60 * 1e3);
          return emptyResult;
        }
        const totalSpend = parseFloat(summary.totalSpend || "0");
        const totalSales = parseFloat(summary.totalSales || "0");
        const totalClicks = summary.totalClicks || 0;
        const totalImpressions = summary.totalImpressions || 0;
        const totalOrders = summary.totalOrders || 0;
        const now = /* @__PURE__ */ new Date();
        const daysSinceEnd = Math.ceil((now.getTime() - endDate.getTime()) / (24 * 60 * 60 * 1e3));
        const spDataMaturity = daysSinceEnd >= 7 ? "finalized" : "pending";
        const sbSdDataMaturity = daysSinceEnd >= 14 ? "finalized" : "pending";
        const result = {
          conversionsPerDay: totalOrders / days,
          // ✅ 加权计算派生指标，而非简单平均
          roas: totalSpend > 0 ? totalSales / totalSpend : 0,
          totalSales,
          acos: totalSales > 0 ? totalSpend / totalSales * 100 : 0,
          revenuePerDay: totalSales / days,
          totalSpend,
          totalOrders,
          totalClicks,
          totalImpressions,
          // ✅ 新增派生指标
          ctr: totalImpressions > 0 ? totalClicks / totalImpressions * 100 : 0,
          cvr: totalClicks > 0 ? totalOrders / totalClicks * 100 : 0,
          cpc: totalClicks > 0 ? totalSpend / totalClicks : 0,
          days,
          startDate: startDate.toISOString().split("T")[0],
          endDate: endDate.toISOString().split("T")[0],
          currency: accountCurrency,
          // ✅ 归因期数据成熟度标注
          dataMaturity: {
            sp: spDataMaturity,
            sb: sbSdDataMaturity,
            // @ts-ignore
            sd: sbSdDataMaturity,
            overall: spDataMaturity === "finalized" && sbSdDataMaturity === "finalized" ? "finalized" : "pending",
            message: spDataMaturity === "finalized" && sbSdDataMaturity === "finalized" ? "\u6240\u6709\u5E7F\u544A\u7C7B\u578B\u7684\u5F52\u56E0\u6570\u636E\u5DF2\u7A33\u5B9A" : daysSinceEnd < 7 ? `\u8FD1${daysSinceEnd}\u5929\u6570\u636E\u5C1A\u5728\u5F52\u56E0\u7A97\u53E3\u5185\uFF08SP:7\u5929, SB/SD:14\u5929\uFF09\uFF0C\u8F6C\u5316\u6570\u636E\u53EF\u80FD\u4E0D\u5B8C\u6574` : `SB/SD\u5E7F\u544A\u7684\u8FD1${14 - daysSinceEnd}\u5929\u6570\u636E\u5C1A\u5728\u5F52\u56E0\u7A97\u53E3\u5185\uFF0C\u8F6C\u5316\u6570\u636E\u53EF\u80FD\u4E0D\u5B8C\u6574`
          }
        };
        apiCache.set(cacheKey, result, 2 * 60 * 1e3);
        return result;
      }),
      /**
       * 区域级别数据对比
       * v386: 添加5分钟API缓存（跨账户查询较重）
       */
      getRegionComparison: protectedProcedure.input(external_exports.object({
        userId: external_exports.number(),
        startDate: external_exports.string().optional(),
        endDate: external_exports.string().optional()
      })).query(async ({ ctx, input }) => {
        const cacheKey = apiCache.generateKey("analytics.getRegionComparison", ctx.user.id, input);
        const cached2 = apiCache.get(cacheKey);
        if (cached2) return cached2;
        const REGIONS = {
          NA: { name: "\u5317\u7F8E\u533A\u57DF", flag: "\u{1F1FA}\u{1F1F8}", marketplaces: ["US", "CA", "MX", "BR"] },
          EU: { name: "\u6B27\u6D32\u533A\u57DF", flag: "\u{1F1EA}\u{1F1FA}", marketplaces: ["UK", "DE", "FR", "IT", "ES", "NL", "SE", "PL", "AE", "SA", "IN"] },
          FE: { name: "\u8FDC\u4E1C\u533A\u57DF", flag: "\u{1F30F}", marketplaces: ["JP", "AU", "SG"] }
        };
        const accounts = await getAccountsForUser(ctx.user);
        const endDate = input.endDate ? new Date(input.endDate) : /* @__PURE__ */ new Date();
        const startDate = input.startDate ? new Date(input.startDate) : new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1e3);
        const regionData = {};
        for (const [regionId, regionInfo] of Object.entries(REGIONS)) {
          regionData[regionId] = {
            region: regionId,
            regionName: regionInfo.name,
            flag: regionInfo.flag,
            accountCount: 0,
            totalSales: 0,
            totalSpend: 0,
            totalOrders: 0,
            totalClicks: 0,
            totalImpressions: 0,
            acos: 0,
            roas: 0,
            ctr: 0,
            cvr: 0,
            marketplaces: []
          };
        }
        const accountIds = accounts.map((a) => a.id);
        const summaryMap = /* @__PURE__ */ new Map();
        if (accountIds.length > 0) {
          const batchSize = 10;
          for (let i = 0; i < accountIds.length; i += batchSize) {
            const batch = accountIds.slice(i, i + batchSize);
            const results = await Promise.all(
              // @ts-ignore
              batch.map(async (id) => {
                const summary = await getPerformanceSummary(id, startDate, endDate);
                return { id, summary };
              })
            );
            for (const { id, summary } of results) {
              if (summary) summaryMap.set(id, summary);
            }
          }
        }
        for (const account of accounts) {
          let accountRegion = "NA";
          for (const [regionId, regionInfo] of Object.entries(REGIONS)) {
            if (regionInfo.marketplaces.includes(account.marketplace)) {
              accountRegion = regionId;
              break;
            }
          }
          const summary = summaryMap.get(account.id);
          if (summary) {
            const sales = parseFloat(summary.totalSales || "0");
            const spend = parseFloat(summary.totalSpend || "0");
            const orders = summary.totalOrders || 0;
            const clicks = summary.totalClicks || 0;
            const impressions = summary.totalImpressions || 0;
            regionData[accountRegion].accountCount++;
            regionData[accountRegion].totalSales += sales;
            regionData[accountRegion].totalSpend += spend;
            regionData[accountRegion].totalOrders += orders;
            regionData[accountRegion].totalClicks += clicks;
            regionData[accountRegion].totalImpressions += impressions;
            if (!regionData[accountRegion].marketplaces.includes(account.marketplace)) {
              regionData[accountRegion].marketplaces.push(account.marketplace);
            }
          }
        }
        for (const regionId of Object.keys(regionData)) {
          const data = regionData[regionId];
          data.acos = data.totalSales > 0 ? data.totalSpend / data.totalSales * 100 : 0;
          data.roas = data.totalSpend > 0 ? data.totalSales / data.totalSpend : 0;
          data.ctr = data.totalImpressions > 0 ? data.totalClicks / data.totalImpressions * 100 : 0;
          data.cvr = data.totalClicks > 0 ? data.totalOrders / data.totalClicks * 100 : 0;
        }
        const result = Object.values(regionData).filter((r) => r.accountCount > 0);
        apiCache.set(cacheKey, result, 5 * 60 * 1e3);
        return result;
      })
    });
    advancedAnalyticsRouter = router({
      // 获取高级分析仪表盘汇总
      getSummary: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number().optional(),
        performanceGroupId: external_exports.number().optional(),
        days: external_exports.number().optional().default(30)
      })).query(async ({ ctx, input }) => {
        return getAdvancedAnalyticsSummary(input);
      }),
      // 获取归因分析结果
      getAttribution: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number().optional(),
        performanceGroupId: external_exports.number().optional(),
        days: external_exports.number().optional().default(30),
        limit: external_exports.number().optional().default(20),
        offset: external_exports.number().optional().default(0),
        eventCategory: external_exports.string().optional()
      })).query(async ({ ctx, input }) => {
        return getAttributionAnalysis(input);
      }),
      // 获取趋势分析
      getTrendAnalysis: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        performanceGroupId: external_exports.number().optional(),
        days: external_exports.number().optional().default(30),
        metrics: external_exports.array(external_exports.string()).optional()
      })).query(async ({ ctx, input }) => {
        return getTrendAnalysis(input);
      }),
      // 获取异常检测结果
      getAnomalies: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        performanceGroupId: external_exports.number().optional(),
        days: external_exports.number().optional().default(30),
        sensitivity: external_exports.number().optional().default(2)
      })).query(async ({ ctx, input }) => {
        return detectAnomalies3(input);
      }),
      // 获取策略ROI对比
      getStrategyROI: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number().optional(),
        performanceGroupId: external_exports.number().optional(),
        days: external_exports.number().optional().default(30),
        groupBy: external_exports.enum(["strategy", "actionType", "eventCategory"]).optional().default("strategy")
      })).query(async ({ ctx, input }) => {
        return getStrategyROIComparison(input);
      }),
      // 手动触发效果追踪任务
      triggerEffectTracking: protectedProcedure.mutation(async () => {
        const results = await runAllUnifiedTrackingTasks();
        return { success: true, message: "\u6548\u679C\u8FFD\u8E2A\u4EFB\u52A1\u6267\u884C\u5B8C\u6210", results };
      })
    });
  }
});

