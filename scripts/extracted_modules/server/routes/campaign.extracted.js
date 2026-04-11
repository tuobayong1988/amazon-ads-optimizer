// Extracted from production dist/index.js
// Original module: server/routes/campaign.ts
// Lines: 673

var log159, campaignRouter;
var init_campaign = __esm({
  "server/routes/campaign.ts"() {
    "use strict";
    init_trpc();
    init_zod();
    init_dist();
    init_db2();
    init_drizzle_orm();
    init_logger();
    init_apiCacheService();
    log159 = createModuleLogger("Route_campaign");
    campaignRouter = router({
      list: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number().optional(),
        startDate: external_exports.string().optional(),
        endDate: external_exports.string().optional(),
        marketplace: external_exports.string().optional(),
        timeRange: external_exports.enum(["today", "yesterday", "7days", "14days", "30days", "60days", "90days", "custom"]).optional()
      })).query(async ({ ctx, input }) => {
        if (!input.accountId) {
          return [];
        }
        const { verifyAccountAccess: verifyAccountAccess2 } = await Promise.resolve().then(() => (init_accessControl(), accessControl_exports));
        await verifyAccountAccess2(ctx.user.id, input.accountId);
        let startDate = input.startDate;
        let endDate = input.endDate;
        let todayDate;
        if (input.marketplace && input.timeRange && input.timeRange !== "custom") {
          const { calculateDateRangeByMarketplace: calculateDateRangeByMarketplace3, getMarketplaceLocalDate: getMarketplaceLocalDate2 } = await Promise.resolve().then(() => (init_timezone2(), timezone_exports));
          const dateRange = calculateDateRangeByMarketplace3(input.marketplace, input.timeRange);
          startDate = dateRange.startDate;
          endDate = dateRange.endDate;
          todayDate = getMarketplaceLocalDate2(input.marketplace);
          log159.info(`[campaign.list] \u7AD9\u70B9\u65F6\u533A\u65E5\u671F\u8BA1\u7B97: marketplace=${input.marketplace}, timeRange=${input.timeRange}, startDate=${startDate}, endDate=${endDate}, todayDate=${todayDate}`);
        } else if (input.marketplace) {
          const { getMarketplaceLocalDate: getMarketplaceLocalDate2 } = await Promise.resolve().then(() => (init_timezone2(), timezone_exports));
          todayDate = getMarketplaceLocalDate2(input.marketplace);
        }
        if (startDate && endDate) {
          const cacheKey = apiCache.generateKey("campaign.list", ctx.user.id, { accountId: input.accountId, startDate, endDate, todayDate });
          const cached2 = apiCache.get(cacheKey);
          if (cached2) return cached2;
          const result = await getCampaignsWithPerformance(input.accountId, startDate, endDate, todayDate);
          apiCache.set(cacheKey, result, 2 * 60 * 1e3);
          return result;
        }
        return getCampaignsByAccountId(input.accountId);
      }),
      // v402: 后端分页版本的广告活动列表
      listPaginated: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        startDate: external_exports.string().optional(),
        endDate: external_exports.string().optional(),
        marketplace: external_exports.string().optional(),
        timeRange: external_exports.enum(["today", "yesterday", "7days", "14days", "30days", "60days", "90days", "custom"]).optional(),
        // 分页参数
        page: external_exports.number().optional().default(1),
        pageSize: external_exports.number().optional().default(25),
        // 排序参数
        sortField: external_exports.string().optional(),
        sortDirection: external_exports.enum(["asc", "desc"]).optional().default("desc"),
        // 基础筛选参数
        search: external_exports.string().optional(),
        campaignType: external_exports.string().optional(),
        campaignStatus: external_exports.string().optional(),
        optimizationStatus: external_exports.string().optional(),
        // 是否使用服务端分页
        serverPagination: external_exports.boolean().optional().default(true)
        // @ts-ignore
      })).query(async ({ ctx, input }) => {
        if (!input.accountId) {
          return { data: [], total: 0, filteredTotal: 0, page: 1, pageSize: 25, totalPages: 0, statusCounts: { enabled: 0, paused: 0, archived: 0, managed: 0, unmanaged: 0 }, typeCounts: {} };
        }
        const { verifyAccountAccess: verifyAccountAccess2 } = await Promise.resolve().then(() => (init_accessControl(), accessControl_exports));
        await verifyAccountAccess2(ctx.user.id, input.accountId);
        let startDate = input.startDate;
        let endDate = input.endDate;
        let todayDate;
        if (input.marketplace && input.timeRange && input.timeRange !== "custom") {
          const { calculateDateRangeByMarketplace: calculateDateRangeByMarketplace3, getMarketplaceLocalDate: getMarketplaceLocalDate2 } = await Promise.resolve().then(() => (init_timezone2(), timezone_exports));
          const dateRange = calculateDateRangeByMarketplace3(input.marketplace, input.timeRange);
          startDate = dateRange.startDate;
          endDate = dateRange.endDate;
          todayDate = getMarketplaceLocalDate2(input.marketplace);
        } else if (input.marketplace) {
          const { getMarketplaceLocalDate: getMarketplaceLocalDate2 } = await Promise.resolve().then(() => (init_timezone2(), timezone_exports));
          todayDate = getMarketplaceLocalDate2(input.marketplace);
        }
        if (!startDate || !endDate) {
          return { data: [], total: 0, filteredTotal: 0, page: 1, pageSize: 25, totalPages: 0, statusCounts: { enabled: 0, paused: 0, archived: 0, managed: 0, unmanaged: 0 }, typeCounts: {} };
        }
        const cacheKey = apiCache.generateKey("campaign.listPaginated", ctx.user.id, {
          accountId: input.accountId,
          startDate,
          endDate,
          todayDate,
          page: input.page,
          pageSize: input.pageSize,
          sortField: input.sortField,
          sortDirection: input.sortDirection,
          search: input.search,
          campaignType: input.campaignType,
          campaignStatus: input.campaignStatus,
          optimizationStatus: input.optimizationStatus,
          serverPagination: input.serverPagination
        });
        const cached2 = apiCache.get(cacheKey);
        if (cached2) return cached2;
        const result = await getCampaignsWithPerformancePaginated({
          accountId: input.accountId,
          startDate,
          endDate,
          todayDate,
          page: input.page,
          pageSize: input.pageSize,
          sortField: input.sortField,
          sortDirection: input.sortDirection,
          search: input.search,
          campaignType: input.campaignType,
          campaignStatus: input.campaignStatus,
          optimizationStatus: input.optimizationStatus,
          serverPagination: input.serverPagination
        });
        apiCache.set(cacheKey, result, 2 * 60 * 1e3);
        return result;
      }),
      // v426: 轻量级广告活动名称列表（仅返回id/name/type/status，用于下拉选择框）
      // @ts-ignore
      listNamesOnly: protectedProcedure.input(external_exports.object({ accountId: external_exports.number() })).query(async ({ ctx, input }) => {
        const { verifyAccountAccess: verifyAccountAccess2 } = await Promise.resolve().then(() => (init_accessControl(), accessControl_exports));
        await verifyAccountAccess2(ctx.user.id, input.accountId);
        const cacheKey = apiCache.generateKey("campaign.listNamesOnly", ctx.user.id, { accountId: input.accountId });
        const cached2 = apiCache.get(cacheKey);
        if (cached2) return cached2;
        const result = await getCampaignNamesOnly(input.accountId);
        apiCache.set(cacheKey, result, 5 * 60 * 1e3);
        return result;
      }),
      // v426: 轻量级广告活动状态统计（替代全量加载）
      statusCounts: protectedProcedure.input(external_exports.object({ accountId: external_exports.number() })).query(async ({ ctx, input }) => {
        const { verifyAccountAccess: verifyAccountAccess2 } = await Promise.resolve().then(() => (init_accessControl(), accessControl_exports));
        await verifyAccountAccess2(ctx.user.id, input.accountId);
        const cacheKey = apiCache.generateKey("campaign.statusCounts", ctx.user.id, { accountId: input.accountId });
        const cached2 = apiCache.get(cacheKey);
        if (cached2) return cached2;
        const result = await getCampaignStatusCounts(input.accountId);
        apiCache.set(cacheKey, result, 5 * 60 * 1e3);
        return result;
      }),
      // 获取未分配到绩效组的广告活动
      // v361: 数据隔离修复 - accountId改为必填
      // v484: 支持时间范围绩效数据
      listUnassigned: protectedProcedure.input(external_exports.object({
        // @ts-ignore
        accountId: external_exports.number(),
        startDate: external_exports.string().optional(),
        endDate: external_exports.string().optional()
      })).query(async ({ ctx, input }) => {
        const { verifyAccountAccess: verifyAccountAccess2 } = await Promise.resolve().then(() => (init_accessControl(), accessControl_exports));
        await verifyAccountAccess2(ctx.user.id, input.accountId);
        if (input.startDate && input.endDate) {
          return getUnassignedCampaignsWithPerformance(
            input.accountId,
            input.startDate,
            input.endDate
          );
        }
        const endDate = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
        const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1e3).toISOString().split("T")[0];
        return getUnassignedCampaignsWithPerformance(
          input.accountId,
          startDate,
          endDate
        );
      }),
      // v370.4: 数据隔离 - 验证campaign归属
      get: protectedProcedure.input(external_exports.object({ id: external_exports.number() })).query(async ({ ctx, input }) => {
        const { verifyCampaignAccess: verifyCampaignAccess2 } = await Promise.resolve().then(() => (init_accessControl(), accessControl_exports));
        await verifyCampaignAccess2(ctx.user.id, input.id);
        return getCampaignById(input.id);
      }),
      create: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        campaignId: external_exports.string(),
        // @ts-ignore
        campaignName: external_exports.string(),
        campaignType: external_exports.enum(["sp_auto", "sp_manual", "sb", "sd"]),
        targetingType: external_exports.enum(["auto", "manual"]).optional(),
        performanceGroupId: external_exports.number().optional(),
        maxBid: external_exports.string().optional()
      })).mutation(async ({ ctx, input }) => {
        const id = await createCampaign(input);
        return { id };
      }),
      // v370.4: 数据隔离 - update方法验证campaign归属（通过input.id）
      update: protectedProcedure.input(external_exports.object({
        id: external_exports.number(),
        campaignName: external_exports.string().optional(),
        maxBid: external_exports.string().optional(),
        dailyBudget: external_exports.string().optional(),
        intradayBiddingEnabled: external_exports.boolean().optional(),
        placementTopSearchBidAdjustment: external_exports.number().optional(),
        placementProductPageBidAdjustment: external_exports.number().optional(),
        placementRestBidAdjustment: external_exports.number().optional(),
        campaignStatus: external_exports.enum(["enabled", "paused", "archived"]).optional()
      })).mutation(async ({ ctx, input }) => {
        const { verifyCampaignAccess: verifyCampaignAccess2 } = await Promise.resolve().then(() => (init_accessControl(), accessControl_exports));
        await verifyCampaignAccess2(ctx.user.id, input.id);
        const previousCampaign = await getCampaignById(input.id);
        const { id, intradayBiddingEnabled, ...rest } = input;
        const data = {
          ...rest,
          ...intradayBiddingEnabled !== void 0 && { intradayBiddingEnabled: intradayBiddingEnabled ? 1 : 0 }
        };
        await updateCampaign(id, data);
        const apiSyncResults = [];
        if (previousCampaign && previousCampaign.accountId && previousCampaign.campaignId) {
          const amazonCampaignId = String(previousCampaign.campaignId);
          const campaignType = (previousCampaign.campaignType || "sp_manual").toLowerCase();
          if (input.campaignStatus && input.campaignStatus !== previousCampaign.campaignStatus) {
            try {
              const { syncCampaignStatusToAmazon: syncCampaignStatusToAmazon2 } = await Promise.resolve().then(() => (init_amazonApiHelper(), amazonApiHelper_exports));
              const result = await syncCampaignStatusToAmazon2(previousCampaign.accountId, [{
                campaignId: id,
                amazonCampaignId,
                newStatus: input.campaignStatus,
                campaignName: previousCampaign.campaignName || `Campaign ${id}`,
                campaignType,
                reason: "\u7528\u6237\u624B\u52A8\u66F4\u65B0campaign\u72B6\u6001"
              }]);
              apiSyncResults.push({ field: "campaignStatus", success: result.success > 0, error: result.errors[0] });
            } catch (e) {
              apiSyncResults.push({ field: "campaignStatus", success: false, error: e.message });
              log159.warn(`[campaign.update] \u72B6\u6001\u540C\u6B65\u5931\u8D25:`, e.message);
            }
          }
          if (input.dailyBudget && input.dailyBudget !== previousCampaign.dailyBudget) {
            try {
              const { syncBudgetAdjustmentToAmazon: syncBudgetAdjustmentToAmazon2 } = await Promise.resolve().then(() => (init_amazonApiHelper(), amazonApiHelper_exports));
              const success2 = await syncBudgetAdjustmentToAmazon2(
                previousCampaign.accountId,
                amazonCampaignId,
                parseFloat(input.dailyBudget),
                "\u7528\u6237\u624B\u52A8\u66F4\u65B0\u65E5\u9884\u7B97"
              );
              apiSyncResults.push({ field: "dailyBudget", success: success2 });
            } catch (e) {
              apiSyncResults.push({ field: "dailyBudget", success: false, error: e.message });
              log159.warn(`[campaign.update] \u9884\u7B97\u540C\u6B65\u5931\u8D25:`, e.message);
            }
          }
          if ((input.placementTopSearchBidAdjustment !== void 0 || input.placementProductPageBidAdjustment !== void 0) && (campaignType === "sp_manual" || campaignType === "sp_auto")) {
            try {
              const { syncPlacementAdjustmentToAmazon: syncPlacementAdjustmentToAmazon2 } = await Promise.resolve().then(() => (init_amazonApiHelper(), amazonApiHelper_exports));
              const topPercent = input.placementTopSearchBidAdjustment ?? previousCampaign.placementTopSearchBidAdjustment ?? 0;
              const productPercent = input.placementProductPageBidAdjustment ?? previousCampaign.placementProductPageBidAdjustment ?? 0;
              const success2 = await syncPlacementAdjustmentToAmazon2(
                previousCampaign.accountId,
                amazonCampaignId,
                // @ts-ignore
                topPercent,
                productPercent,
                "\u7528\u6237\u624B\u52A8\u66F4\u65B0\u4F4D\u7F6E\u51FA\u4EF7\u8C03\u6574"
              );
              apiSyncResults.push({ field: "placementAdjustment", success: success2 });
            } catch (e) {
              apiSyncResults.push({ field: "placementAdjustment", success: false, error: e.message });
              log159.warn(`[campaign.update] \u4F4D\u7F6E\u8C03\u6574\u540C\u6B65\u5931\u8D25:`, e.message);
            }
          }
          log159.info(`[campaign.update] Amazon API\u540C\u6B65\u7ED3\u679C:`, JSON.stringify(apiSyncResults));
          const successfulSyncs = apiSyncResults.filter((r) => r.success);
          if (successfulSyncs.length > 0) {
            try {
              const { submitReliableConfirmation: submitReliableConfirmation2 } = await Promise.resolve().then(() => (init_commandConfirmationService(), commandConfirmationService_exports));
              const entities = ["campaigns"];
              if (successfulSyncs.some((r) => r.field === "dailyBudget")) entities.push("budgets");
              const hasBudget = entities.includes("budgets");
              submitReliableConfirmation2(previousCampaign.accountId, entities, "campaignUpdate", hasBudget ? "budget_change" : "status_change");
            } catch (e) {
              log159.debug(`\u786E\u8BA4\u540C\u6B65\u89E6\u53D1\u5FFD\u7565: ${e instanceof Error ? e.message : e}`);
            }
          }
        }
        const { logAudit: logAudit2 } = await Promise.resolve().then(() => (init_auditService(), auditService_exports));
        const changes = [];
        if (input.campaignName) changes.push(`\u540D\u79F0: ${input.campaignName}`);
        if (input.maxBid) changes.push(`\u6700\u9AD8\u51FA\u4EF7: $${input.maxBid}`);
        if (input.dailyBudget) changes.push(`\u65E5\u9884\u7B97: $${input.dailyBudget}`);
        if (input.campaignStatus) changes.push(`\u72B6\u6001: ${input.campaignStatus}`);
        if (input.intradayBiddingEnabled !== void 0) changes.push(`\u5206\u65F6\u7ADE\u4EF7: ${input.intradayBiddingEnabled ? "\u5F00\u542F" : "\u5173\u95ED"}`);
        const apiFailures = apiSyncResults.filter((r) => !r.success);
        await logAudit2({
          userId: ctx.user.id,
          userName: ctx.user.name || void 0,
          userEmail: ctx.user.email || void 0,
          actionType: "campaign_update",
          targetType: "campaign",
          targetId: String(input.id),
          targetName: previousCampaign?.campaignName || void 0,
          description: `\u66F4\u65B0\u5E7F\u544A\u6D3B\u52A8\uFF08${changes.join(", ")}\uFF09` + (apiFailures.length > 0 ? ` [API\u540C\u6B65\u5931\u8D25: ${apiFailures.map((f) => f.field).join(", ")}]` : ""),
          previousValue: previousCampaign ? { maxBid: previousCampaign.maxBid, dailyBudget: previousCampaign.dailyBudget, status: previousCampaign.campaignStatus } : void 0,
          newValue: { maxBid: input.maxBid, dailyBudget: input.dailyBudget, status: input.campaignStatus },
          accountId: previousCampaign?.accountId,
          status: apiFailures.length > 0 ? "partial" : "success"
        });
        apiCache.invalidateByPrefix("campaign.list");
        return {
          success: true,
          apiSync: apiSyncResults.length > 0 ? {
            total: apiSyncResults.length,
            success: apiSyncResults.filter((r) => r.success).length,
            // @ts-ignore
            failed: apiFailures.length,
            errors: apiFailures.map((f) => `${f.field}: ${f.error}`).slice(0, 5)
          } : void 0
        };
      }),
      getAdGroups: protectedProcedure.input(external_exports.object({ campaignId: external_exports.number() })).query(async ({ ctx, input }) => {
        const campaign = await getCampaignById(input.campaignId);
        if (!campaign) return [];
        return getAdGroupsByCampaignId(campaign.campaignId);
      }),
      // 获取广告活动详情（包含广告组、关键词、搜索词等）
      getDetail: protectedProcedure.input(external_exports.object({ campaignId: external_exports.number() })).query(async ({ ctx, input }) => {
        const campaign = await getCampaignById(input.campaignId);
        if (!campaign) return null;
        return getCampaignDetailWithStats(campaign.campaignId);
      }),
      // 获取广告位置表现数据
      getPlacementStats: protectedProcedure.input(external_exports.object({ campaignId: external_exports.number() })).query(async ({ ctx, input }) => {
        const campaign = await getCampaignById(input.campaignId);
        if (!campaign) return null;
        return getCampaignPlacementStats(campaign.campaignId);
      }),
      // 获取广告位置绩效数据（用于CampaignDetail页面）
      getPlacementPerformance: protectedProcedure.input(external_exports.object({ campaignId: external_exports.number() })).query(async ({ ctx, input }) => {
        const campaign = await getCampaignById(input.campaignId);
        if (!campaign) return [];
        return getPlacementPerformanceByCampaignId(campaign.campaignId);
      }),
      // 获取广告活动所有投放词（关键词+商品定向）
      // @ts-ignore
      getTargets: protectedProcedure.input(external_exports.object({ campaignId: external_exports.number() })).query(async ({ ctx, input }) => {
        const campaign = await getCampaignById(input.campaignId);
        if (!campaign) return { keywords: [], productTargets: [] };
        return getCampaignTargets(campaign.campaignId);
      }),
      // 获取搜索词报告
      getSearchTerms: protectedProcedure.input(external_exports.object({ campaignId: external_exports.number() })).query(async ({ ctx, input }) => {
        const campaign = await getCampaignById(input.campaignId);
        if (!campaign) return [];
        const rawTerms = await getSearchTermsByCampaignId(campaign.campaignId);
        return rawTerms.map((t2) => ({
          id: t2.id,
          accountId: t2.accountId,
          campaignId: t2.campaignId,
          adGroupId: t2.internalAdGroupId,
          searchTerm: t2.searchTerm,
          targetType: t2.searchTermTargetType,
          // keyword | product_target
          targetId: t2.searchTermTargetId,
          targetText: t2.targetText,
          // 来源投放词/ASIN文本
          matchType: t2.searchTermMatchType,
          // 来源投放词的匹配类型
          impressions: t2.searchTermImpressions || 0,
          clicks: t2.searchTermClicks || 0,
          spend: t2.searchTermSpend || "0",
          sales: t2.searchTermSales || "0",
          orders: t2.searchTermOrders || 0,
          acos: t2.searchTermAcos,
          // @ts-ignore
          roas: t2.searchTermRoas,
          ctr: t2.searchTermCtr,
          cvr: t2.searchTermCvr,
          cpc: t2.searchTermCpc,
          reportStartDate: t2.reportStartDate,
          reportEndDate: t2.reportEndDate,
          createdAt: t2.createdAt,
          updatedAt: t2.updatedAt
        }));
      }),
      // 获取否定关键词列表
      getNegativeKeywords: protectedProcedure.input(external_exports.object({ campaignId: external_exports.number() })).query(async ({ ctx, input }) => {
        const campaign = await getCampaignById(input.campaignId);
        if (!campaign) return [];
        return getNegativeKeywordsByCampaignId(campaign.campaignId);
      }),
      // AI摘要功能 - 生成广告活动表现摘要
      generateAISummary: protectedProcedure.input(external_exports.object({ campaignId: external_exports.number() })).mutation(async ({ ctx, input }) => {
        const { invokeLLM: invokeLLM2 } = await Promise.resolve().then(() => (init_llm(), llm_exports));
        const campaign = await getCampaignById(input.campaignId);
        if (!campaign) {
          throw new TRPCError({ code: "NOT_FOUND", message: "\u5E7F\u544A\u6D3B\u52A8\u4E0D\u5B58\u5728" });
        }
        const adGroups6 = await getAdGroupsByCampaignId(campaign.campaignId);
        let totalKeywords = 0;
        let topKeywords = [];
        for (const adGroup of adGroups6) {
          const keywords10 = await getKeywordsByAdGroupId(adGroup.id);
          totalKeywords += keywords10.length;
          topKeywords.push(...keywords10.filter((k) => parseFloat(k.sales || "0") > 0));
        }
        topKeywords.sort((a, b) => parseFloat(b.sales || "0") - parseFloat(a.sales || "0"));
        topKeywords = topKeywords.slice(0, 5);
        const spend = parseFloat(campaign.spend || "0");
        const sales = parseFloat(campaign.sales || "0");
        const acos = sales > 0 ? spend / sales * 100 : 0;
        const roas = spend > 0 ? sales / spend : 0;
        const clicks = campaign.clicks || 0;
        const impressions = campaign.impressions || 0;
        const ctr = impressions > 0 ? clicks / impressions * 100 : 0;
        const orders = campaign.orders || 0;
        const cvr = clicks > 0 ? orders / clicks * 100 : 0;
        const prompt = `\u4F60\u662F\u4E00\u4E2A\u4E13\u4E1A\u7684\u4E9A\u9A6C\u900A\u5E7F\u544A\u4F18\u5316\u4E13\u5BB6\u3002\u8BF7\u6839\u636E\u4EE5\u4E0B\u5E7F\u544A\u6D3B\u52A8\u6570\u636E\uFF0C\u751F\u6210\u4E00\u4EFD\u7B80\u6D01\u7684\u4E2D\u6587\u8868\u73B0\u6458\u8981\u3002

\u5E7F\u544A\u6D3B\u52A8\u4FE1\u606F\uFF1A
- \u540D\u79F0\uFF1A${campaign.campaignName}
- \u7C7B\u578B\uFF1A${campaign.campaignType}
- \u72B6\u6001\uFF1A${campaign.campaignStatus}
// @ts-ignore
- \u65E5\u9884\u7B97\uFF1A$${campaign.dailyBudget || "N/A"}

\u6838\u5FC3\u6307\u6807\uFF1A
- \u82B1\u8D39\uFF1A$${spend.toFixed(2)}
- \u9500\u552E\u989D\uFF1A$${sales.toFixed(2)}
- ACoS\uFF1A${acos.toFixed(2)}%
- ROAS\uFF1A${roas.toFixed(2)}
- \u70B9\u51FB\u7387(CTR)\uFF1A${ctr.toFixed(2)}%
- \u8F6C\u5316\u7387(CVR)\uFF1A${cvr.toFixed(2)}%
- \u5C55\u793A\u6B21\u6570\uFF1A${impressions.toLocaleString()}
- \u70B9\u51FB\u6B21\u6570\uFF1A${clicks.toLocaleString()}
- \u8BA2\u5355\u6570\uFF1A${orders}

\u5E7F\u544A\u7EC4\u6570\u91CF\uFF1A${adGroups6.length}
\u5173\u952E\u8BCD\u6570\u91CF\uFF1A${totalKeywords}

\u8868\u73B0\u6700\u4F73\u5173\u952E\u8BCD\uFF08\u6309\u9500\u552E\u989D\u6392\u5E8F\uFF09\uFF1A
// @ts-ignore
${topKeywords.map((k, i) => `${i + 1}. "${k.keywordText}" - \u9500\u552E\u989D: $${parseFloat(k.sales || "0").toFixed(2)}, ACoS: ${parseFloat(k.sales || "0") > 0 ? (parseFloat(k.spend || "0") / parseFloat(k.sales || "0") * 100).toFixed(2) : "N/A"}%`).join("\n")}

\u8BF7\u63D0\u4F9B\uFF1A
1. \u6574\u4F53\u8868\u73B0\u8BC4\u4EF7\uFF08\u4E00\u53E5\u8BDD\u603B\u7ED3\uFF09
2. \u4E3B\u8981\u4F18\u52BF\uFF082-3\u70B9\uFF09
3. \u9700\u8981\u6539\u8FDB\u7684\u65B9\u9762\uFF082-3\u70B9\uFF09
4. \u5177\u4F53\u4F18\u5316\u5EFA\u8BAE\uFF082-3\u6761\u53EF\u6267\u884C\u7684\u5EFA\u8BAE\uFF09

\u8BF7\u7528\u7B80\u6D01\u7684\u4E2D\u6587\u56DE\u590D\uFF0C\u4F7F\u7528Markdown\u683C\u5F0F\u3002`;
        try {
          const response = await invokeLLM2({
            messages: [
              { role: "system", content: "\u4F60\u662F\u4E00\u4E2A\u4E13\u4E1A\u7684\u4E9A\u9A6C\u900A\u5E7F\u544A\u4F18\u5316\u987E\u95EE\uFF0C\u64C5\u957F\u5206\u6790\u5E7F\u544A\u6570\u636E\u5E76\u63D0\u4F9B\u53EF\u6267\u884C\u7684\u4F18\u5316\u5EFA\u8BAE\u3002" },
              { role: "user", content: prompt }
            ]
          });
          const summary = response.choices[0]?.message?.content || "\u65E0\u6CD5\u751F\u6210\u6458\u8981";
          return {
            summary: typeof summary === "string" ? summary : JSON.stringify(summary),
            metrics: {
              spend,
              sales,
              acos,
              roas,
              ctr,
              cvr,
              impressions,
              clicks,
              orders,
              adGroupCount: adGroups6.length,
              keywordCount: totalKeywords
            },
            topKeywords: topKeywords.map((k) => ({
              // @ts-ignore
              keyword: k.keywordText,
              // @ts-ignore
              sales: parseFloat(k.sales || "0"),
              // @ts-ignore
              acos: parseFloat(k.sales || "0") > 0 ? parseFloat(k.spend || "0") / parseFloat(k.sales || "0") * 100 : null
            })),
            generatedAt: (/* @__PURE__ */ new Date()).toISOString()
          };
        } catch (error48) {
          log159.warn("AI\u6458\u8981\u751F\u6210\u5931\u8D25:", error48);
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "AI\u6458\u8981\u751F\u6210\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5"
          });
        }
      }),
      // AI智能分析（包含可执行建议和效果预估）
      generateAIAnalysis: protectedProcedure.input(external_exports.object({ campaignId: external_exports.number() })).mutation(async ({ ctx, input }) => {
        const { generateAIAnalysisWithSuggestions: generateAIAnalysisWithSuggestions2 } = await Promise.resolve().then(() => (init_aiOptimizationService(), aiOptimizationService_exports));
        return generateAIAnalysisWithSuggestions2(input.campaignId);
      }),
      // 执行AI优化建议
      executeAIOptimization: protectedProcedure.input(external_exports.object({
        campaignId: external_exports.number(),
        suggestions: external_exports.array(external_exports.object({
          type: external_exports.enum(["bid_adjustment", "status_change", "negative_keyword"]),
          targetType: external_exports.enum(["keyword", "product_target", "search_term"]),
          targetId: external_exports.number().optional(),
          targetText: external_exports.string(),
          action: external_exports.enum(["bid_increase", "bid_decrease", "bid_set", "enable", "pause", "negate_phrase", "negate_exact"]),
          currentValue: external_exports.string().optional(),
          suggestedValue: external_exports.string().optional(),
          reason: external_exports.string(),
          priority: external_exports.enum(["high", "medium", "low"]),
          expectedImpact: external_exports.object({
            spendChange: external_exports.number().optional(),
            salesChange: external_exports.number().optional(),
            acosChange: external_exports.number().optional(),
            roasChange: external_exports.number().optional()
          }).optional()
        })),
        predictions: external_exports.array(external_exports.object({
          period: external_exports.enum(["7_days", "14_days", "30_days"]),
          predictedSpend: external_exports.number(),
          predictedSales: external_exports.number(),
          predictedAcos: external_exports.number(),
          predictedRoas: external_exports.number(),
          spendChangePercent: external_exports.number(),
          salesChangePercent: external_exports.number(),
          acosChangePercent: external_exports.number(),
          roasChangePercent: external_exports.number(),
          confidence: external_exports.number(),
          rationale: external_exports.string()
        })),
        aiSummary: external_exports.string()
      })).mutation(async ({ ctx, input }) => {
        const { executeOptimizationSuggestions: executeOptimizationSuggestions2 } = await Promise.resolve().then(() => (init_aiOptimizationService(), aiOptimizationService_exports));
        const campaign = await getCampaignById(input.campaignId);
        if (!campaign) {
          throw new TRPCError({ code: "NOT_FOUND", message: "\u5E7F\u544A\u6D3B\u52A8\u4E0D\u5B58\u5728" });
        }
        const result = await executeOptimizationSuggestions2(
          ctx.user.id,
          campaign.accountId,
          input.campaignId,
          input.suggestions,
          input.predictions,
          input.aiSummary
        );
        const { logAudit: logAudit2 } = await Promise.resolve().then(() => (init_auditService(), auditService_exports));
        await logAudit2({
          userId: ctx.user.id,
          userName: ctx.user.name || void 0,
          userEmail: ctx.user.email || void 0,
          actionType: "automation_config_update",
          // @ts-ignore
          targetType: "campaign",
          targetId: String(input.campaignId),
          targetName: campaign.campaignName || void 0,
          description: `\u6267\u884CAI\u4F18\u5316\u5EFA\u8BAE\uFF08${input.suggestions.length}\u6761\u5EFA\u8BAE\uFF09`,
          metadata: { suggestionsCount: input.suggestions.length, aiSummary: input.aiSummary },
          // @ts-ignore
          accountId: campaign.accountId,
          status: "success"
        });
        return result;
      }),
      // 获取AI优化执行历史
      // @ts-ignore
      getAIOptimizationHistory: protectedProcedure.input(external_exports.object({ campaignId: external_exports.number() })).query(async ({ ctx, input }) => {
        return getAiOptimizationExecutionsByCampaign(input.campaignId);
      }),
      // v370.4: 获取AI优化执行详情（executionId关联到campaign，需要验证）
      getAIOptimizationDetail: protectedProcedure.input(external_exports.object({ executionId: external_exports.number() })).query(async ({ ctx, input }) => {
        const detail = await getAiOptimizationExecutionDetail(input.executionId);
        if (detail && detail.campaignId) {
          const { verifyCampaignAccess: verifyCampaignAccess2 } = await Promise.resolve().then(() => (init_accessControl(), accessControl_exports));
          await verifyCampaignAccess2(ctx.user.id, detail.campaignId);
        }
        return detail;
      }),
      // 更新广告活动的策略模板推荐
      updateStrategyRecommendations: protectedProcedure.input(external_exports.object({ accountId: external_exports.number() })).mutation(async ({ ctx, input }) => {
        const { updateAllCampaignRecommendations: updateAllCampaignRecommendations2 } = await Promise.resolve().then(() => (init_strategyRecommendationService(), strategyRecommendationService_exports));
        const updated = await updateAllCampaignRecommendations2(input.accountId);
        return { updated };
      }),
      // v381: 获取广告活动变更历史（对应Amazon后台的History tab）
      getChangeHistory: protectedProcedure.input(external_exports.object({
        campaignId: external_exports.number(),
        page: external_exports.number().optional().default(1),
        pageSize: external_exports.number().optional().default(50)
      })).query(async ({ ctx, input }) => {
        try {
          const campaign = await getCampaignById(input.campaignId);
          if (!campaign) {
            return { records: [], total: 0, page: input.page, pageSize: input.pageSize };
          }
          const amazonCampaignId = campaign.campaignId;
          const accountId = campaign.accountId;
          if (!accountId) {
            return { records: [], total: 0, page: input.page, pageSize: input.pageSize };
          }
          const { getBidAdjustmentHistory: getBidAdjustmentHistory2 } = await Promise.resolve().then(() => (init_bidAdjustment(), bidAdjustment_exports));
          const { getDb: getDb3 } = await Promise.resolve().then(() => (init_connection(), connection_exports));
          const dbConn = await getDb3();
          const [bidHistory, budgetRecords] = await Promise.all([
            getBidAdjustmentHistory2({
              accountId,
              campaignId: Number(amazonCampaignId) || void 0,
              page: input.page,
              pageSize: input.pageSize
            }),
            dbConn ? dbConn.select().from(
              (await Promise.resolve().then(() => (init_schema2(), schema_exports))).budgetHistory
            ).where(
              and(
                eq((await Promise.resolve().then(() => (init_schema2(), schema_exports))).budgetHistory.campaignId, amazonCampaignId)
              )
            ).orderBy(desc((await Promise.resolve().then(() => (init_schema2(), schema_exports))).budgetHistory.createdAt)).limit(input.pageSize) : []
          ]);
          const allRecords = [];
          for (const record2 of bidHistory.records || []) {
            allRecords.push({
              id: `bid_${record2.id}`,
              type: "bid_adjustment",
              typeLabel: "\u51FA\u4EF7\u8C03\u6574",
              target: record2.keywordText || `Keyword #${record2.keywordId}`,
              matchType: record2.matchType,
              previousValue: `$${record2.previousBid}`,
              newValue: `$${record2.newBid}`,
              changePercent: record2.bidChangePercent ? `${record2.bidChangePercent}%` : null,
              reason: record2.adjustmentReason,
              source: record2.adjustmentType,
              // @ts-ignore
              status: record2.status,
              // @ts-ignore
              appliedBy: record2.appliedBy,
              timestamp: record2.appliedAt
            });
          }
          for (const record2 of budgetRecords || []) {
            allRecords.push({
              id: `budget_${record2.id}`,
              type: "budget_adjustment",
              typeLabel: "\u9884\u7B97\u8C03\u6574",
              target: "\u65E5\u9884\u7B97",
              matchType: null,
              previousValue: `$${record2.previousBudget}`,
              newValue: `$${record2.newBudget}`,
              changePercent: record2.changePercent ? `${record2.changePercent}%` : null,
              reason: record2.reason,
              source: record2.source,
              status: "applied",
              appliedBy: null,
              timestamp: record2.createdAt
            });
          }
          allRecords.sort((a, b) => {
            const timeA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
            const timeB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
            return timeB - timeA;
          });
          return {
            records: allRecords.slice(0, input.pageSize),
            total: allRecords.length,
            page: input.page,
            pageSize: input.pageSize
          };
        } catch (error48) {
          log159.warn("Failed to get campaign change history:", error48);
          return { records: [], total: 0, page: input.page, pageSize: input.pageSize };
        }
      })
    });
  }
});

