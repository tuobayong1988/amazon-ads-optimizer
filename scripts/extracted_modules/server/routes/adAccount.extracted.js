// Extracted from production dist/index.js
// Original module: server/routes/adAccount.ts
// Lines: 393

async function getAccountsForUser2(user) {
  return getAccountsForUser(user);
}
var adAccountRouter;
var init_adAccount = __esm({
  "server/routes/adAccount.ts"() {
    "use strict";
    init_trpc();
    init_zod();
    init_dist();
    init_db2();
    init_timezone2();
    init_apiCacheService();
    __name(getAccountsForUser2, "getAccountsForUser");
    adAccountRouter = router({
      // v452.8: 安全修复 — 只有系统管理员可查看所有账户，其他用户仅查看自己的账户
      // @ts-ignore
      // v577: 数据隔离修复 — 管理员按组织过滤，不再返回全局所有账户
      list: protectedProcedure.query(async ({ ctx }) => {
        return getAccountsForUser2(ctx.user);
      }),
      // v359: 安全修复 — 获取单个账号详情（需认证，验证归属）
      get: protectedProcedure.input(external_exports.object({ id: external_exports.number() })).query(async ({ ctx, input }) => {
        const account = await getAdAccountById(input.id);
        if (!account) {
          throw new TRPCError({ code: "NOT_FOUND", message: "\u8D26\u53F7\u4E0D\u5B58\u5728" });
        }
        const userOrg = ctx.user.organizationId;
        if (userOrg) {
          if (account.organizationId !== userOrg) {
            throw new TRPCError({ code: "FORBIDDEN", message: "\u65E0\u6743\u8BBF\u95EE\u6B64\u8D26\u53F7" });
          }
        } else if (account.userId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "\u65E0\u6743\u8BBF\u95EE\u6B64\u8D26\u53F7" });
        }
        return account;
      }),
      // v359: 安全修复 — 获取默认账号（需认证，按用户隔离）
      // @ts-ignore
      getDefault: protectedProcedure.input(external_exports.object({ userId: external_exports.number().optional() }).optional()).query(async ({ ctx }) => {
        const accounts = await getAccountsForUser2(ctx.user);
        return accounts.find((a) => a.isDefault) || accounts[0] || null;
      }),
      // 创建新账号
      create: protectedProcedure.input(external_exports.object({
        accountId: external_exports.string(),
        accountName: external_exports.string(),
        storeName: external_exports.string().optional(),
        storeDescription: external_exports.string().optional(),
        storeColor: external_exports.string().optional(),
        marketplace: external_exports.string(),
        marketplaceId: external_exports.string().optional(),
        profileId: external_exports.string().optional(),
        sellerId: external_exports.string().optional(),
        isDefault: external_exports.boolean().optional()
      })).mutation(async ({ ctx, input }) => {
        if (input.isDefault) {
          const accounts = await getAccountsForUser(ctx.user);
          for (const acc of accounts) {
            if (acc.isDefault) {
              await updateAdAccount(acc.id, { isDefault: 0 });
            }
          }
        }
        const id = await createAdAccount({
          userId: ctx.user.id,
          organizationId: ctx.user.organizationId,
          ...input,
          isDefault: input.isDefault ? 1 : 0,
          connectionStatus: "pending"
        });
        return { id };
      }),
      // 创建空店铺（不包含站点）
      createStore: protectedProcedure.input(external_exports.object({
        storeName: external_exports.string(),
        storeDescription: external_exports.string().optional(),
        storeColor: external_exports.string().optional()
      })).mutation(async ({ ctx, input }) => {
        const existingAccounts = await getAccountsForUser(ctx.user);
        const existingStore = existingAccounts.find((a) => a.storeName === input.storeName);
        if (existingStore) {
          throw new TRPCError({ code: "CONFLICT", message: "\u5DF2\u5B58\u5728\u540C\u540D\u5E97\u94FA" });
        }
        const id = await createAdAccount({
          userId: ctx.user.id,
          organizationId: ctx.user.organizationId,
          storeName: input.storeName,
          storeDescription: input.storeDescription,
          storeColor: input.storeColor,
          accountId: `store_${Date.now()}`,
          // 临时ID，授权后会更新
          accountName: input.storeName,
          marketplace: "",
          // 空店铺没有站点
          connectionStatus: "pending",
          isDefault: existingAccounts.length === 0 ? 1 : 0
          // 第一个店铺设为默认
        });
        return { id, storeName: input.storeName };
      }),
      // 更新账号信息
      update: protectedProcedure.input(external_exports.object({
        id: external_exports.number(),
        accountName: external_exports.string().optional(),
        storeName: external_exports.string().optional(),
        storeDescription: external_exports.string().optional(),
        storeColor: external_exports.string().optional(),
        marketplace: external_exports.string().optional(),
        marketplaceId: external_exports.string().optional(),
        profileId: external_exports.string().optional(),
        sellerId: external_exports.string().optional(),
        conversionValueType: external_exports.enum(["sales", "units", "custom"]).optional(),
        conversionValueSource: external_exports.enum(["platform", "custom"]).optional(),
        intradayBiddingEnabled: external_exports.boolean().optional(),
        // @ts-ignore
        defaultMaxBid: external_exports.string().optional(),
        status: external_exports.enum(["active", "paused", "archived"]).optional()
      })).mutation(async ({ ctx, input }) => {
        const { id, intradayBiddingEnabled, ...rest } = input;
        const data = {
          ...rest,
          ...intradayBiddingEnabled !== void 0 && { intradayBiddingEnabled: intradayBiddingEnabled ? 1 : 0 }
        };
        await updateAdAccount(id, data);
        return { success: true };
      }),
      // 删除账号
      delete: protectedProcedure.input(external_exports.object({ id: external_exports.number() })).mutation(async ({ ctx, input }) => {
        const account = await getAdAccountById(input.id);
        if (!account || account.userId !== ctx.user.id) {
          throw new TRPCError({ code: "NOT_FOUND", message: "\u8D26\u53F7\u4E0D\u5B58\u5728" });
        }
        await deleteAdAccount(input.id);
        return { success: true };
      }),
      // 设置默认账号
      setDefault: protectedProcedure.input(external_exports.object({ id: external_exports.number() })).mutation(async ({ ctx, input }) => {
        const account = await getAdAccountById(input.id);
        if (!account || account.userId !== ctx.user.id) {
          throw new TRPCError({ code: "NOT_FOUND", message: "\u8D26\u53F7\u4E0D\u5B58\u5728" });
        }
        await setDefaultAdAccount(ctx.user.id, input.id);
        return { success: true };
      }),
      // 调整账号排序
      reorder: protectedProcedure.input(external_exports.object({ accountIds: external_exports.array(external_exports.number()) })).mutation(async ({ ctx, input }) => {
        await reorderAdAccounts(ctx.user.id, input.accountIds);
        return { success: true };
      }),
      // 更新账号连接状态
      updateConnectionStatus: protectedProcedure.input(external_exports.object({
        id: external_exports.number(),
        status: external_exports.enum(["connected", "disconnected", "error", "pending"]),
        errorMessage: external_exports.string().optional()
      })).mutation(async ({ ctx, input }) => {
        const account = await getAdAccountById(input.id);
        if (!account || account.userId !== ctx.user.id) {
          throw new TRPCError({ code: "NOT_FOUND", message: "\u8D26\u53F7\u4E0D\u5B58\u5728" });
        }
        await updateAdAccountConnectionStatus(input.id, input.status, input.errorMessage);
        return { success: true };
      }),
      // 获取账号列表及绩效汇总（支持时间范围筛选，根据站点时区计算日期）
      listWithPerformance: protectedProcedure.input(external_exports.object({
        timeRange: external_exports.enum(["today", "yesterday", "7days", "14days", "30days", "60days", "90days", "custom", "this_week", "last_week", "this_month", "last_month"]).optional().default("7days"),
        days: external_exports.number().optional(),
        startDate: external_exports.string().optional(),
        endDate: external_exports.string().optional()
      }).optional()).query(async ({ ctx, input }) => {
        const cacheKey = apiCache.generateKey("listWithPerformance", ctx.user.id, input);
        const cached2 = apiCache.get(cacheKey);
        if (cached2) return cached2;
        const timeRange = input?.timeRange || "7days";
        const accounts = await getAccountsForUser2(ctx.user);
        const actualSites = accounts.filter((a) => a.marketplace && a.marketplace !== "");
        const calculateDatesForMarketplace = /* @__PURE__ */ __name((marketplace) => {
          const localDateStr = getMarketplaceLocalDate(marketplace);
          const [year3, month, day2] = localDateStr.split("-").map(Number);
          const localToday = new Date(year3, month - 1, day2);
          let startDate;
          let endDate;
          let prevStartDate;
          let prevEndDate;
          if (timeRange === "custom" && input?.startDate && input?.endDate) {
            startDate = new Date(input.startDate);
            endDate = new Date(input.endDate);
            const rangeDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1e3 * 60 * 60 * 24));
            prevEndDate = new Date(startDate);
            prevStartDate = new Date(prevEndDate);
            prevStartDate.setDate(prevStartDate.getDate() - rangeDays);
          } else if (timeRange === "today") {
            startDate = localToday;
            endDate = localToday;
            prevStartDate = new Date(localToday);
            prevStartDate.setDate(prevStartDate.getDate() - 1);
            prevEndDate = new Date(localToday);
            prevEndDate.setDate(prevEndDate.getDate() - 1);
          } else if (timeRange === "yesterday") {
            startDate = new Date(localToday);
            startDate.setDate(startDate.getDate() - 1);
            endDate = new Date(startDate);
            prevStartDate = new Date(startDate);
            prevStartDate.setDate(prevStartDate.getDate() - 1);
            prevEndDate = new Date(startDate);
            prevEndDate.setDate(prevEndDate.getDate() - 1);
          } else if (timeRange === "7days") {
            startDate = new Date(localToday);
            startDate.setDate(startDate.getDate() - 6);
            endDate = localToday;
            prevStartDate = new Date(startDate);
            prevStartDate.setDate(prevStartDate.getDate() - 7);
            prevEndDate = new Date(startDate);
            prevEndDate.setDate(prevEndDate.getDate() - 1);
          } else if (timeRange === "14days") {
            startDate = new Date(localToday);
            startDate.setDate(startDate.getDate() - 13);
            endDate = localToday;
            prevStartDate = new Date(startDate);
            prevStartDate.setDate(prevStartDate.getDate() - 14);
            prevEndDate = new Date(startDate);
            prevEndDate.setDate(prevEndDate.getDate() - 1);
          } else if (timeRange === "30days") {
            startDate = new Date(localToday);
            startDate.setDate(startDate.getDate() - 29);
            endDate = localToday;
            prevStartDate = new Date(startDate);
            prevStartDate.setDate(prevStartDate.getDate() - 30);
            prevEndDate = new Date(startDate);
            prevEndDate.setDate(prevEndDate.getDate() - 1);
          } else if (timeRange === "60days") {
            startDate = new Date(localToday);
            startDate.setDate(startDate.getDate() - 59);
            endDate = localToday;
            prevStartDate = new Date(startDate);
            prevStartDate.setDate(prevStartDate.getDate() - 60);
            prevEndDate = new Date(startDate);
            prevEndDate.setDate(prevEndDate.getDate() - 1);
          } else {
            startDate = new Date(localToday);
            startDate.setDate(startDate.getDate() - 89);
            endDate = localToday;
            prevStartDate = new Date(startDate);
            prevStartDate.setDate(prevStartDate.getDate() - 90);
            prevEndDate = new Date(startDate);
            prevEndDate.setDate(prevEndDate.getDate() - 1);
          }
          return { startDate, endDate, prevStartDate, prevEndDate, localToday };
        }, "calculateDatesForMarketplace");
        const accountsWithPerformance = await Promise.all(
          actualSites.map(async (account) => {
            const { startDate, endDate, prevStartDate, prevEndDate, localToday } = calculateDatesForMarketplace(account.marketplace || "US");
            const performance = await getAccountPerformanceSummary(account.id, startDate, endDate);
            const prevPerformance = await getAccountPerformanceSummary(account.id, prevStartDate, prevEndDate);
            const spend = performance?.totalSpend || 0;
            const sales = performance?.totalSales || 0;
            const orders = performance?.totalOrders || 0;
            const acos = spend > 0 && sales > 0 ? spend / sales * 100 : 0;
            const roas = spend > 0 && sales > 0 ? sales / spend : 0;
            const prevSpend = prevPerformance?.totalSpend || 0;
            const prevSales = prevPerformance?.totalSales || 0;
            const prevAcos = prevSpend > 0 && prevSales > 0 ? prevSpend / prevSales * 100 : 0;
            const spendChange = prevSpend > 0 ? (spend - prevSpend) / prevSpend * 100 : 0;
            const salesChange = prevSales > 0 ? (sales - prevSales) / prevSales * 100 : 0;
            const acosChange = prevAcos > 0 ? acos - prevAcos : 0;
            let status = "healthy";
            let alerts = 0;
            if (acos > 35) {
              status = "warning";
              alerts = 1;
            }
            if (acos > 50) {
              status = "critical";
              alerts = 2;
            }
            return {
              id: account.id,
              name: account.storeName || account.accountName,
              marketplace: account.marketplace,
              spend,
              sales,
              orders,
              acos,
              roas,
              status,
              alerts,
              change: {
                spend: parseFloat(spendChange.toFixed(1)),
                sales: parseFloat(salesChange.toFixed(1)),
                acos: parseFloat(acosChange.toFixed(1))
              }
            };
          })
        );
        apiCache.set(cacheKey, accountsWithPerformance, 2 * 60 * 1e3);
        return accountsWithPerformance;
      }),
      // 获取账号统计信息
      // @ts-ignore
      getStats: protectedProcedure.query(async ({ ctx }) => {
        const accounts = await getAccountsForUser2(ctx.user);
        const actualSites = accounts.filter((a) => a.marketplace && a.marketplace !== "");
        const storeNames = new Set(accounts.map((a) => a.storeName || a.accountName));
        const stats4 = {
          // 总店铺数（按storeName去重）
          total: storeNames.size,
          // 已连接的站点数
          connected: actualSites.filter((a) => a.connectionStatus === "connected").length,
          // 待配置的站点数（包括空店铺）
          pending: accounts.filter((a) => a.connectionStatus === "pending" || !a.marketplace || a.marketplace === "").length,
          // 连接错误的站点数
          error: actualSites.filter((a) => a.connectionStatus === "error").length,
          // 市场覆盖（去重后的国家数量）
          marketplaceCount: new Set(actualSites.map((a) => a.marketplace)).size,
          // 按市场分组统计
          // @ts-ignore
          byMarketplace: {}
        };
        for (const account of actualSites) {
          if (account.marketplace) {
            stats4.byMarketplace[account.marketplace] = (stats4.byMarketplace[account.marketplace] || 0) + 1;
          }
        }
        return stats4;
      }),
      // 获取每日趋势数据
      getDailyTrend: protectedProcedure.input(external_exports.object({
        days: external_exports.number().default(7),
        timeRange: external_exports.enum(["today", "yesterday", "7days", "14days", "30days", "60days", "90days", "custom"]).optional(),
        startDate: external_exports.string().optional(),
        endDate: external_exports.string().optional()
      })).query(async ({ ctx, input }) => {
        const cacheKey = apiCache.generateKey("getDailyTrend", ctx.user.id, input);
        const cached2 = apiCache.get(cacheKey);
        if (cached2) return cached2;
        const accounts = await getAccountsForUser2(ctx.user);
        const actualSites = accounts.filter((a) => a.marketplace && a.marketplace !== "");
        const accountIds = actualSites.map((a) => a.id);
        if (accountIds.length === 0) {
          return [];
        }
        let startDate = input.startDate;
        let endDate = input.endDate;
        const timeRange = input.timeRange || "7days";
        if (timeRange !== "custom") {
          const localDateStr = getMarketplaceLocalDate("US");
          const [year3, month, day2] = localDateStr.split("-").map(Number);
          const localToday = new Date(year3, month - 1, day2);
          if (timeRange === "today") {
            startDate = localDateStr;
            endDate = localDateStr;
          } else if (timeRange === "yesterday") {
            const yesterday = new Date(localToday);
            yesterday.setDate(yesterday.getDate() - 1);
            const yd = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;
            startDate = yd;
            endDate = yd;
          } else {
            const daysMap = { "7days": 6, "14days": 13, "30days": 29, "60days": 59, "90days": 89 };
            const daysBack = daysMap[timeRange] || 6;
            const sd = new Date(localToday);
            sd.setDate(sd.getDate() - daysBack);
            startDate = `${sd.getFullYear()}-${String(sd.getMonth() + 1).padStart(2, "0")}-${String(sd.getDate()).padStart(2, "0")}`;
            endDate = localDateStr;
          }
        }
        const trendData = await getDailyTrendData(accountIds, input.days, "custom", startDate, endDate);
        apiCache.set(cacheKey, trendData, 2 * 60 * 1e3);
        return trendData;
      }),
      // 获取数据可用日期范围（用于自定义日期选择器的限制）
      // @ts-ignore
      getDataDateRange: protectedProcedure.query(async ({ ctx }) => {
        const accounts = await getAccountsForUser2(ctx.user);
        const actualSites = accounts.filter((a) => a.marketplace && a.marketplace !== "");
        const accountIds = actualSites.map((a) => a.id);
        if (accountIds.length === 0) {
          const now = /* @__PURE__ */ new Date();
          const minDate = new Date(now);
          minDate.setDate(minDate.getDate() - 90);
          return {
            minDate: minDate.toISOString().split("T")[0],
            maxDate: now.toISOString().split("T")[0],
            hasData: false
          };
        }
        const dateRange = await getDataDateRange(accountIds);
        return dateRange;
      })
    });
  }
});

