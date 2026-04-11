// Extracted from production dist/index.js
// Original module: server/routes/crossAccount.ts
// Lines: 354

var crossAccountRouter;
var init_crossAccount = __esm({
  "server/routes/crossAccount.ts"() {
    "use strict";
    init_trpc();
    init_zod();
    init_dist();
    init_db2();
    crossAccountRouter = router({
      // 获取所有账号的汇总数据
      getSummary: protectedProcedure.input(external_exports.object({
        startDate: external_exports.string().optional(),
        endDate: external_exports.string().optional()
      }).optional()).query(async ({ ctx, input }) => {
        const accounts = await getAccountsForUser(ctx.user);
        if (accounts.length === 0) {
          return {
            totalAccounts: 0,
            connectedAccounts: 0,
            totalSpend: 0,
            totalSales: 0,
            totalImpressions: 0,
            totalClicks: 0,
            totalOrders: 0,
            avgAcos: 0,
            avgRoas: 0,
            avgCtr: 0,
            avgCvr: 0,
            accountsData: [],
            marketplaceDistribution: {},
            dailyTrend: []
          };
        }
        const accountsData = await Promise.all(
          accounts.map(async (account) => {
            const performanceGroups8 = await getPerformanceGroupsByAccountId(account.id);
            let totalSpend2 = 0;
            let totalSales2 = 0;
            let totalImpressions2 = 0;
            let totalClicks2 = 0;
            let totalOrders2 = 0;
            for (const pg of performanceGroups8) {
              const campaigns6 = await getCampaignsByPerformanceGroupId(pg.id);
              for (const campaign of campaigns6) {
                totalSpend2 += parseFloat(campaign.spend || "0");
                totalSales2 += parseFloat(campaign.sales || "0");
                totalImpressions2 += campaign.impressions || 0;
                totalClicks2 += campaign.clicks || 0;
                totalOrders2 += campaign.orders || 0;
              }
            }
            const acos = totalSales2 > 0 ? totalSpend2 / totalSales2 * 100 : 0;
            const roas = totalSpend2 > 0 ? totalSales2 / totalSpend2 : 0;
            const ctr = totalImpressions2 > 0 ? totalClicks2 / totalImpressions2 * 100 : 0;
            const cvr = totalClicks2 > 0 ? totalOrders2 / totalClicks2 * 100 : 0;
            return {
              id: account.id,
              accountName: account.accountName,
              storeName: account.storeName,
              storeColor: account.storeColor,
              marketplace: account.marketplace,
              connectionStatus: account.connectionStatus,
              spend: totalSpend2,
              sales: totalSales2,
              impressions: totalImpressions2,
              clicks: totalClicks2,
              orders: totalOrders2,
              acos,
              roas,
              ctr,
              cvr
              // @ts-ignore
            };
          })
          // @ts-ignore
        );
        const totalSpend = accountsData.reduce((sum2, a) => sum2 + a.spend, 0);
        const totalSales = accountsData.reduce((sum2, a) => sum2 + a.sales, 0);
        const totalImpressions = accountsData.reduce((sum2, a) => sum2 + a.impressions, 0);
        const totalClicks = accountsData.reduce((sum2, a) => sum2 + a.clicks, 0);
        const totalOrders = accountsData.reduce((sum2, a) => sum2 + a.orders, 0);
        const avgAcos = totalSales > 0 ? totalSpend / totalSales * 100 : 0;
        const avgRoas = totalSpend > 0 ? totalSales / totalSpend : 0;
        const avgCtr = totalImpressions > 0 ? totalClicks / totalImpressions * 100 : 0;
        const avgCvr = totalClicks > 0 ? totalOrders / totalClicks * 100 : 0;
        const marketplaceDistribution = {};
        for (const account of accountsData) {
          if (!marketplaceDistribution[account.marketplace]) {
            marketplaceDistribution[account.marketplace] = { count: 0, spend: 0, sales: 0 };
          }
          marketplaceDistribution[account.marketplace].count++;
          marketplaceDistribution[account.marketplace].spend += account.spend;
          marketplaceDistribution[account.marketplace].sales += account.sales;
        }
        return {
          totalAccounts: accounts.length,
          connectedAccounts: accounts.filter((a) => a.connectionStatus === "connected").length,
          totalSpend,
          totalSales,
          totalImpressions,
          totalClicks,
          totalOrders,
          avgAcos,
          avgRoas,
          avgCtr,
          avgCvr,
          accountsData,
          marketplaceDistribution,
          dailyTrend: []
          // 可以后续实现每日趋势
        };
      }),
      // 获取账号对比数据
      getComparison: protectedProcedure.input(external_exports.object({
        accountIds: external_exports.array(external_exports.number()),
        metric: external_exports.enum(["spend", "sales", "acos", "roas", "impressions", "clicks", "orders", "ctr", "cvr"])
      })).query(async ({ ctx, input }) => {
        const accounts = await getAccountsForUser(ctx.user);
        const selectedAccounts = accounts.filter((a) => input.accountIds.includes(a.id));
        const comparisonData = await Promise.all(
          // @ts-ignore
          selectedAccounts.map(async (account) => {
            const performanceGroups8 = await getPerformanceGroupsByAccountId(account.id);
            let totalSpend = 0;
            let totalSales = 0;
            let totalImpressions = 0;
            let totalClicks = 0;
            let totalOrders = 0;
            for (const pg of performanceGroups8) {
              const campaigns6 = await getCampaignsByPerformanceGroupId(pg.id);
              for (const campaign of campaigns6) {
                totalSpend += parseFloat(campaign.spend || "0");
                totalSales += parseFloat(campaign.sales || "0");
                totalImpressions += campaign.impressions || 0;
                totalClicks += campaign.clicks || 0;
                totalOrders += campaign.orders || 0;
              }
            }
            const metrics = {
              spend: totalSpend,
              sales: totalSales,
              acos: totalSales > 0 ? totalSpend / totalSales * 100 : 0,
              roas: totalSpend > 0 ? totalSales / totalSpend : 0,
              impressions: totalImpressions,
              clicks: totalClicks,
              orders: totalOrders,
              ctr: totalImpressions > 0 ? totalClicks / totalImpressions * 100 : 0,
              cvr: totalClicks > 0 ? totalOrders / totalClicks * 100 : 0
            };
            return {
              id: account.id,
              name: account.storeName || account.accountName,
              color: account.storeColor || "#3B82F6",
              marketplace: account.marketplace,
              value: metrics[input.metric]
            };
          })
        );
        return comparisonData;
      }),
      // 导出账号配置
      exportAccounts: protectedProcedure.input(external_exports.object({
        format: external_exports.enum(["json", "csv"]),
        accountIds: external_exports.array(external_exports.number()).optional()
      })).mutation(async ({ ctx, input }) => {
        let accounts = await getAccountsForUser(ctx.user);
        if (input.accountIds && input.accountIds.length > 0) {
          accounts = accounts.filter((a) => input.accountIds.includes(a.id));
        }
        const exportData = accounts.map((a) => ({
          accountId: a.accountId,
          accountName: a.accountName,
          storeName: a.storeName,
          storeDescription: a.storeDescription,
          storeColor: a.storeColor,
          marketplace: a.marketplace,
          marketplaceId: a.marketplaceId,
          profileId: a.profileId,
          sellerId: a.sellerId,
          isDefault: a.isDefault,
          sortOrder: a.sortOrder
        }));
        if (input.format === "json") {
          return {
            format: "json",
            data: JSON.stringify(exportData, null, 2),
            filename: `amazon-accounts-${(/* @__PURE__ */ new Date()).toISOString().split("T")[0]}.json`
          };
        } else {
          const headers = ["accountId", "accountName", "storeName", "storeDescription", "storeColor", "marketplace", "marketplaceId", "profileId", "sellerId", "isDefault", "sortOrder"];
          const csvRows = [
            headers.join(","),
            ...exportData.map(
              (row) => headers.map((h) => {
                const value = row[h];
                if (value === null || value === void 0) return "";
                if (typeof value === "string" && (value.includes(",") || value.includes('"'))) {
                  return `"${value.replace(/"/g, '""')}"`;
                }
                return String(value);
              }).join(",")
            )
          ];
          return {
            format: "csv",
            data: csvRows.join("\n"),
            filename: `amazon-accounts-${(/* @__PURE__ */ new Date()).toISOString().split("T")[0]}.csv`
          };
        }
      }),
      // 导入账号配置
      importAccounts: protectedProcedure.input(external_exports.object({
        data: external_exports.string(),
        format: external_exports.enum(["json", "csv"]),
        overwrite: external_exports.boolean().optional()
      })).mutation(async ({ ctx, input }) => {
        let accountsToImport = [];
        if (input.format === "json") {
          try {
            accountsToImport = JSON.parse(input.data);
          } catch (e) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "JSON\u683C\u5F0F\u65E0\u6548" });
          }
        } else {
          const lines = input.data.split("\n").filter((l) => l.trim());
          if (lines.length < 2) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "CSV\u6587\u4EF6\u4E3A\u7A7A\u6216\u683C\u5F0F\u9519\u8BEF" });
          }
          const headers = lines[0].split(",").map((h) => h.trim());
          for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
            const row = {};
            headers.forEach((h, idx) => {
              row[h] = values[idx] || "";
            });
            if (row.accountId && row.accountName && row.marketplace) {
              accountsToImport.push({
                accountId: row.accountId,
                accountName: row.accountName,
                storeName: row.storeName || void 0,
                storeDescription: row.storeDescription || void 0,
                storeColor: row.storeColor || void 0,
                marketplace: row.marketplace,
                marketplaceId: row.marketplaceId || void 0,
                // @ts-ignore
                profileId: row.profileId || void 0,
                sellerId: row.sellerId || void 0,
                isDefault: row.isDefault === "true"
                // @ts-ignore
              });
            }
          }
        }
        if (accountsToImport.length === 0) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "\u6CA1\u6709\u627E\u5230\u6709\u6548\u7684\u8D26\u53F7\u6570\u636E" });
        }
        const existingAccounts = await getAccountsForUser(ctx.user);
        const existingAccountIds = new Set(existingAccounts.map((a) => a.accountId));
        let imported = 0;
        let skipped = 0;
        let updated = 0;
        for (const account of accountsToImport) {
          if (existingAccountIds.has(account.accountId)) {
            if (input.overwrite) {
              const existing = existingAccounts.find((a) => a.accountId === account.accountId);
              if (existing) {
                await updateAdAccount(existing.id, {
                  // @ts-ignore
                  accountName: account.accountName,
                  // @ts-ignore
                  storeName: account.storeName,
                  // @ts-ignore
                  storeDescription: account.storeDescription,
                  // @ts-ignore
                  storeColor: account.storeColor,
                  // @ts-ignore
                  marketplace: account.marketplace,
                  // @ts-ignore
                  marketplaceId: account.marketplaceId,
                  // @ts-ignore
                  profileId: account.profileId,
                  // @ts-ignore
                  sellerId: account.sellerId
                });
                updated++;
              }
            } else {
              skipped++;
            }
          } else {
            await createAdAccount({
              userId: ctx.user.id,
              organizationId: ctx.user.organizationId,
              // @ts-ignore
              ...account,
              // @ts-ignore
              isDefault: account.isDefault ? 1 : 0,
              connectionStatus: "pending"
            });
            imported++;
          }
        }
        return {
          total: accountsToImport.length,
          imported,
          updated,
          skipped
        };
      }),
      // 预览导入数据
      previewImport: protectedProcedure.input(external_exports.object({
        data: external_exports.string(),
        format: external_exports.enum(["json", "csv"])
      })).mutation(async ({ ctx, input }) => {
        let accountsToImport = [];
        if (input.format === "json") {
          try {
            accountsToImport = JSON.parse(input.data);
          } catch (e) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "JSON\u683C\u5F0F\u65E0\u6548" });
          }
        } else {
          const lines = input.data.split("\n").filter((l) => l.trim());
          if (lines.length < 2) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "CSV\u6587\u4EF6\u4E3A\u7A7A\u6216\u683C\u5F0F\u9519\u8BEF" });
          }
          const headers = lines[0].split(",").map((h) => h.trim());
          for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
            const row = {};
            headers.forEach((h, idx) => {
              row[h] = values[idx] || "";
            });
            if (row.accountId && row.accountName && row.marketplace) {
              accountsToImport.push({
                accountId: row.accountId,
                accountName: row.accountName,
                storeName: row.storeName || void 0,
                marketplace: row.marketplace
              });
            }
          }
        }
        const existingAccounts = await getAccountsForUser(ctx.user);
        const existingAccountIds = new Set(existingAccounts.map((a) => a.accountId));
        return accountsToImport.map((a) => ({
          ...a,
          exists: existingAccountIds.has(a.accountId)
        }));
      })
    });
  }
});

