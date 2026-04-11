// Extracted from production dist/index.js
// Original module: server/routes/performanceGroup.ts
// Lines: 995

var log156, performanceGroupRouter;
var init_performanceGroup = __esm({
  "server/routes/performanceGroup.ts"() {
    "use strict";
    init_trpc();
    init_zod();
    init_dist();
    init_db2();
    init_unifiedOptimizationEngine();
    init_goalProgressAlgorithm();
    init_advancedAnalyticsService();
    init_amazonApiHelper();
    init_logger();
    init_accessControl();
    init_apiCacheService();
    log156 = createModuleLogger("Route_performanceGroup");
    performanceGroupRouter = router({
      list: protectedProcedure.input(external_exports.object({ accountId: external_exports.number() })).query(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        log156.info("[performanceGroup.list] accountId:", input.accountId);
        const result = await getPerformanceGroupsByAccountId(input.accountId);
        log156.info("[performanceGroup.list] result count:", result.length);
        const enrichedResult = await Promise.all(result.map(async (group) => {
          try {
            const campaigns6 = await getCampaignsByPerformanceGroupId(group.id);
            let totalSpend = 0;
            let totalSales = 0;
            let totalOrders = 0;
            let totalClicks = 0;
            let totalImpressions = 0;
            for (const campaign of campaigns6) {
              totalSpend += Number(campaign.spend) || 0;
              totalSales += Number(campaign.sales) || 0;
              totalOrders += campaign.orders || 0;
              totalClicks += campaign.clicks || 0;
              totalImpressions += campaign.impressions || 0;
            }
            const avgAcos = totalSales > 0 ? totalSpend / totalSales * 100 : 0;
            const avgRoas = totalSpend > 0 ? totalSales / totalSpend : 0;
            const ctr = totalImpressions > 0 ? totalClicks / totalImpressions * 100 : 0;
            const cvr = totalClicks > 0 ? totalOrders / totalClicks * 100 : 0;
            const cpc = totalClicks > 0 ? totalSpend / totalClicks : 0;
            let goalProgressResult = null;
            try {
              const metrics = {
                totalSpend,
                totalSales,
                totalOrders,
                totalClicks,
                totalImpressions,
                avgAcos,
                avgRoas,
                ctr,
                cvr,
                cpc
              };
              const groupConfig = {
                id: group.id,
                optimizationGoal: group.optimizationGoal || "maximize_sales",
                targetAcos: Number(group.targetAcos) || null,
                targetRoas: Number(group.targetRoas) || null,
                dailyBudget: Number(group.dailyBudget) || null,
                dailySpendLimit: Number(group.dailySpendLimit) || null,
                maxBid: Number(group.maxBid) || null,
                strategyTemplateId: group.strategyTemplateId || null,
                strategyTemplateName: group.strategyTemplateName || null,
                status: group.status || "active",
                createdAt: group.createdAt || (/* @__PURE__ */ new Date()).toISOString(),
                campaignCount: campaigns6.length
              };
              let trendData;
              let timeWeighted;
              let multiWindow;
              try {
                const [trendResult, twResult, mwResult] = await Promise.all([
                  getGoalProgressTrendData(group.id, group.createdAt || (/* @__PURE__ */ new Date()).toISOString()).catch(() => null),
                  getTimeWeightedMetricsForGoalProgress(group.id).catch(() => null),
                  getMultiWindowTrendData(group.id, group.createdAt || (/* @__PURE__ */ new Date()).toISOString()).catch(() => null)
                ]);
                if (trendResult) trendData = trendResult;
                if (twResult) timeWeighted = twResult;
                if (mwResult) multiWindow = mwResult;
              } catch (dataErr) {
                log156.info(`[performanceGroup.list] Data fetch failed for group ${group.id}:`, dataErr);
              }
              let algorithmData;
              try {
                const { getAlgorithmEfficacyForTarget: getAlgorithmEfficacyForTarget2 } = await Promise.resolve().then(() => (init_algorithmEfficacyService(), algorithmEfficacyService_exports));
                algorithmData = await getAlgorithmEfficacyForTarget2(group.id);
              } catch (algErr) {
              }
              let effectiveMetrics = metrics;
              if (timeWeighted) {
                effectiveMetrics = {
                  ...metrics,
                  avgAcos: timeWeighted.weightedAcos,
                  avgRoas: timeWeighted.weightedRoas,
                  cvr: timeWeighted.weightedCvr,
                  cpc: timeWeighted.weightedCpc
                };
              }
              goalProgressResult = calculateGoalProgress(groupConfig, effectiveMetrics, trendData, timeWeighted, multiWindow, algorithmData);
            } catch (progressErr) {
              log156.warn(`[performanceGroup.list] Goal progress calc failed for group ${group.id}:`, progressErr);
            }
            return {
              ...group,
              campaignCount: campaigns6.length,
              totalSpend,
              totalSales,
              totalOrders,
              totalClicks,
              totalImpressions,
              avgAcos,
              avgRoas,
              ctr,
              cvr,
              cpc,
              // v162: 多维度目标达成度
              goalProgress: goalProgressResult ? goalProgressResult.totalScore : null,
              goalProgressDetail: goalProgressResult ? {
                dimensions: goalProgressResult.dimensions,
                summary: goalProgressResult.summary,
                level: goalProgressResult.level
              } : null
            };
          } catch (error48) {
            log156.warn(`[performanceGroup.list] Error enriching group ${group.id}:`, error48);
            return {
              ...group,
              campaignCount: 0,
              totalSpend: 0,
              totalSales: 0,
              // @ts-ignore
              totalOrders: 0,
              totalClicks: 0,
              totalImpressions: 0,
              avgAcos: 0,
              avgRoas: 0,
              ctr: 0,
              cvr: 0,
              cpc: 0,
              goalProgress: null,
              goalProgressDetail: null
            };
          }
        }));
        return enrichedResult;
      }),
      // v370.4: 数据隔离 - 验证绩效组归属
      get: protectedProcedure.input(external_exports.object({ id: external_exports.number() })).query(async ({ ctx, input }) => {
        const { verifyPerformanceGroupAccess: verifyPerformanceGroupAccess2 } = await Promise.resolve().then(() => (init_accessControl(), accessControl_exports));
        await verifyPerformanceGroupAccess2(ctx.user.id, input.id);
        return getPerformanceGroupById(input.id);
      }),
      create: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        name: external_exports.string(),
        description: external_exports.string().optional(),
        optimizationGoal: external_exports.enum(["maximize_sales", "target_acos", "target_roas", "daily_spend_limit", "daily_cost"]).optional(),
        targetType: external_exports.enum(["maximize_sales", "target_acos", "target_roas", "target_cpa"]).optional(),
        targetValue: external_exports.number().optional(),
        targetAcos: external_exports.string().optional(),
        targetRoas: external_exports.string().optional(),
        dailySpendLimit: external_exports.string().optional(),
        dailyBudget: external_exports.number().optional(),
        maxBid: external_exports.number().optional(),
        dailyCostTarget: external_exports.string().optional(),
        campaignIds: external_exports.array(external_exports.number()).optional(),
        strategyTemplateId: external_exports.string().optional(),
        strategyTemplateName: external_exports.string().optional()
      })).mutation(async ({ ctx, input }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        const { campaignIds, targetType, targetValue, dailyBudget, maxBid, strategyTemplateId, strategyTemplateName, ...rest } = input;
        const optimizationGoal = targetType || rest.optimizationGoal || "target_acos";
        let targetAcos = rest.targetAcos;
        let targetRoas = rest.targetRoas;
        let dailySpendLimit = rest.dailySpendLimit;
        if (targetType === "target_acos" && targetValue) {
          targetAcos = targetValue.toString();
        } else if (targetType === "target_roas" && targetValue) {
          targetRoas = targetValue.toString();
        }
        if (dailyBudget) {
          dailySpendLimit = dailyBudget.toString();
        }
        const id = await createPerformanceGroup({
          userId: ctx.user.id,
          accountId: rest.accountId,
          name: rest.name,
          description: rest.description,
          // @ts-expect-error - type assertion
          optimizationGoal,
          targetAcos,
          targetRoas,
          dailySpendLimit,
          dailyCostTarget: rest.dailyCostTarget,
          ...dailyBudget ? { dailyBudget: dailyBudget.toString() } : {},
          ...maxBid ? { maxBid: maxBid.toString() } : {},
          ...strategyTemplateId ? { strategyTemplateId } : {},
          ...strategyTemplateName ? { strategyTemplateName } : {}
        });
        if (campaignIds && campaignIds.length > 0) {
          await batchAssignCampaignsToPerformanceGroup(campaignIds, id);
        }
        try {
          const { triggerInitialOptimization: triggerInitialOptimization2 } = await Promise.resolve().then(() => (init_optimizationScheduler(), optimizationScheduler_exports));
          triggerInitialOptimization2(id, { triggeredBy: "create" }).catch((err) => {
            log156.warn(`[Router] \u521B\u5EFA\u4F18\u5316\u76EE\u6807\u540E\u89E6\u53D1\u9996\u6B21\u4F18\u5316\u5931\u8D25:`, err);
          });
        } catch (e) {
          log156.warn("[Router] \u5BFC\u5165optimizationScheduler\u5931\u8D25:", e);
        }
        return { id };
      }),
      update: protectedProcedure.input(external_exports.object({
        id: external_exports.number(),
        name: external_exports.string().optional(),
        description: external_exports.string().optional(),
        optimizationGoal: external_exports.enum(["maximize_sales", "target_acos", "target_roas", "daily_spend_limit", "daily_cost"]).optional(),
        targetAcos: external_exports.string().optional(),
        targetRoas: external_exports.string().optional(),
        dailySpendLimit: external_exports.string().optional(),
        dailyCostTarget: external_exports.string().optional(),
        dailyBudget: external_exports.string().optional(),
        maxBid: external_exports.string().optional(),
        status: external_exports.enum(["active", "paused", "archived"]).optional(),
        strategyTemplateId: external_exports.string().optional(),
        strategyTemplateName: external_exports.string().optional()
      })).mutation(async ({ ctx, input }) => {
        const { verifyPerformanceGroupAccess: verifyPerformanceGroupAccess2 } = await Promise.resolve().then(() => (init_accessControl(), accessControl_exports));
        await verifyPerformanceGroupAccess2(ctx.user.id, input.id);
        const { id, ...data } = input;
        await updatePerformanceGroup(id, data);
        if (data.status) {
          try {
            const { onTargetStatusChanged: onTargetStatusChanged2 } = await Promise.resolve().then(() => (init_optimizationScheduler(), optimizationScheduler_exports));
            onTargetStatusChanged2(id, data.status).catch((err) => {
              log156.warn(`[Router] \u72B6\u6001\u53D8\u66F4\u89E6\u53D1\u5931\u8D25:`, err);
            });
          } catch (e) {
            log156.warn("[Router] \u5BFC\u5165optimizationScheduler\u5931\u8D25:", e);
          }
        }
        return { success: true };
      }),
      // v370.4: 数据隔离 - 验证绩效组归属
      delete: protectedProcedure.input(external_exports.object({ id: external_exports.number() })).mutation(async ({ ctx, input }) => {
        const { verifyPerformanceGroupAccess: verifyPerformanceGroupAccess2 } = await Promise.resolve().then(() => (init_accessControl(), accessControl_exports));
        await verifyPerformanceGroupAccess2(ctx.user.id, input.id);
        await deletePerformanceGroup(input.id);
        return { success: true };
      }),
      assignCampaign: protectedProcedure.input(external_exports.object({
        campaignId: external_exports.number(),
        performanceGroupId: external_exports.number().nullable()
      })).mutation(async ({ ctx, input }) => {
        await assignCampaignToPerformanceGroup(input.campaignId, input.performanceGroupId);
        return { success: true };
      }),
      // 批量分配广告活动到绩效组
      batchAssignCampaigns: protectedProcedure.input(external_exports.object({
        campaignIds: external_exports.array(external_exports.number()),
        performanceGroupId: external_exports.number()
      })).mutation(async ({ ctx, input }) => {
        let count11 = 0;
        for (const campaignId of input.campaignIds) {
          await assignCampaignToPerformanceGroup(campaignId, input.performanceGroupId);
          await updateCampaign(campaignId, { optimizationStatus: "managed" });
          count11++;
        }
        try {
          const { onCampaignsAdded: onCampaignsAdded2 } = await Promise.resolve().then(() => (init_optimizationScheduler(), optimizationScheduler_exports));
          onCampaignsAdded2(input.performanceGroupId, input.campaignIds).catch((err) => {
            log156.warn(`[Router] \u6279\u91CF\u5206\u914D\u540E\u89E6\u53D1\u4F18\u5316\u5931\u8D25:`, err);
          });
        } catch (e) {
          log156.warn("[Router] \u5BFC\u5165optimizationScheduler\u5931\u8D25:", e);
        }
        return { success: true, count: count11 };
      }),
      // 批量移除广告活动从绩效组
      batchRemoveCampaigns: protectedProcedure.input(external_exports.object({
        campaignIds: external_exports.array(external_exports.number())
      })).mutation(async ({ ctx, input }) => {
        let count11 = 0;
        for (const campaignId of input.campaignIds) {
          await assignCampaignToPerformanceGroup(campaignId, null);
          await updateCampaign(campaignId, { optimizationStatus: "unmanaged" });
          count11++;
        }
        return { success: true, count: count11 };
      }),
      // v153: 批量更新广告活动状态（暂停/启用），同时同步到Amazon API
      batchUpdateCampaignStatus: protectedProcedure.input(external_exports.object({
        groupId: external_exports.number(),
        campaignIds: external_exports.array(external_exports.number()),
        newStatus: external_exports.enum(["enabled", "paused"])
      })).mutation(async ({ ctx, input }) => {
        const group = await getPerformanceGroupById(input.groupId);
        if (!group) throw new TRPCError({ code: "NOT_FOUND", message: "\u7EE9\u6548\u7EC4\u4E0D\u5B58\u5728" });
        const campaigns6 = await getCampaignsByPerformanceGroupId(input.groupId);
        const targetCampaigns = campaigns6.filter((c) => input.campaignIds.includes(c.id));
        if (targetCampaigns.length === 0) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "\u672A\u627E\u5230\u6307\u5B9A\u7684\u5E7F\u544A\u6D3B\u52A8" });
        }
        let localUpdated = 0;
        for (const campaign of targetCampaigns) {
          await updateCampaign(campaign.id, { campaignStatus: input.newStatus });
          localUpdated++;
        }
        const statusChanges = targetCampaigns.filter((c) => c.campaignId && c.campaignId !== "0" && c.campaignId !== "").map((c) => ({
          campaignId: c.id,
          amazonCampaignId: String(c.campaignId),
          newStatus: input.newStatus,
          campaignName: c.campaignName || `Campaign ${c.id}`,
          // @ts-ignore
          campaignType: c.campaignType || "sp_manual",
          reason: `\u6279\u91CF${input.newStatus === "paused" ? "\u6682\u505C" : "\u542F\u7528"}\u64CD\u4F5C`
        }));
        log156.info(`[batchUpdateCampaignStatus] \u51C6\u5907\u540C\u6B65${statusChanges.length}\u4E2Acampaign\u72B6\u6001\u5230Amazon (\u603B\u8BA1${targetCampaigns.length}\u4E2A)`);
        let apiResult = { success: 0, failed: 0, errors: [] };
        if (statusChanges.length > 0 && group.accountId) {
          try {
            apiResult = await syncCampaignStatusToAmazon(group.accountId, statusChanges);
          } catch (syncError) {
            log156.warn(`[batchUpdateCampaignStatus] API\u540C\u6B65\u5F02\u5E38:`, syncError.message);
            apiResult.failed = statusChanges.length;
            apiResult.errors.push(`API\u540C\u6B65\u8FC7\u7A0B\u53D1\u751F\u5F02\u5E38: ${syncError.message}`);
          }
        }
        try {
          const dbInstance = await getDb();
          if (dbInstance) {
            for (const campaign of targetCampaigns) {
              const wasApiSynced = statusChanges.some((sc) => sc.campaignId === campaign.id);
              const apiStatus = wasApiSynced ? apiResult.success > 0 ? "synced" : "failed" : "not_applicable";
              await dbInstance.execute(
                `INSERT INTO optimization_events (account_id, performance_group_id, campaign_id, campaign_name, event_category, action_type, change_reason, api_sync_status, created_at)
               VALUES (?, ?, ?, ?, 'campaign_action', ?, ?, ?, NOW())`,
                // @ts-ignore
                [
                  group.accountId,
                  input.groupId,
                  campaign.id,
                  campaign.campaignName || `Campaign ${campaign.id}`,
                  input.newStatus === "enabled" ? "campaign_enable" : "campaign_pause",
                  `\u7528\u6237\u624B\u52A8\u6279\u91CF${input.newStatus === "enabled" ? "\u542F\u7528" : "\u6682\u505C"}\u64CD\u4F5C`,
                  apiStatus
                ]
              );
            }
            log156.info(`[batchUpdateCampaignStatus] v454: \u5DF2\u8BB0\u5F55${targetCampaigns.length}\u6761campaign_action\u4E8B\u4EF6\u5230optimization_events`);
          }
        } catch (eventErr) {
          log156.warn(`[batchUpdateCampaignStatus] v454: \u8BB0\u5F55optimization_events\u5931\u8D25: ${eventErr.message}`);
        }
        if (apiResult.success > 0 && group.accountId) {
          try {
            const { submitReliableConfirmation: submitReliableConfirmation2 } = await Promise.resolve().then(() => (init_commandConfirmationService(), commandConfirmationService_exports));
            submitReliableConfirmation2(group.accountId, ["campaigns"], "batchUpdateCampaignStatus", "status_change");
          } catch (e) {
            log156.debug(`\u786E\u8BA4\u540C\u6B65\u89E6\u53D1\u5FFD\u7565: ${e instanceof Error ? e.message : e}`);
          }
        }
        return {
          success: true,
          localUpdated,
          apiSynced: apiResult.success,
          apiFailed: apiResult.failed,
          apiErrors: apiResult.errors.slice(0, 5)
        };
      }),
      // v153: 批量从绩效组移除广告活动（带groupId验证）
      batchRemoveCampaignsFromGroup: protectedProcedure.input(external_exports.object({
        // @ts-ignore
        groupId: external_exports.number(),
        campaignIds: external_exports.array(external_exports.number())
      })).mutation(async ({ ctx, input }) => {
        const { verifyPerformanceGroupAccess: verifyPerformanceGroupAccess2 } = await Promise.resolve().then(() => (init_accessControl(), accessControl_exports));
        await verifyPerformanceGroupAccess2(ctx.user.id, input.groupId);
        if (!input.campaignIds || input.campaignIds.length === 0) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "\u8BF7\u9009\u62E9\u81F3\u5C11\u4E00\u4E2A\u5E7F\u544A\u6D3B\u52A8" });
        }
        let count11 = 0;
        const errors = [];
        for (const campaignId of input.campaignIds) {
          try {
            await assignCampaignToPerformanceGroup(campaignId, null);
            await updateCampaign(campaignId, { optimizationStatus: "unmanaged" });
            count11++;
          } catch (err) {
            errors.push(`\u5E7F\u544A\u6D3B\u52A8 ${campaignId} \u79FB\u9664\u5931\u8D25: ${err.message}`);
          }
        }
        return { success: count11 > 0, count: count11, errors: errors.length > 0 ? errors : void 0 };
      }),
      // v370.4: 数据隔离 - 获取绩效组详情（通过ID）
      getById: protectedProcedure.input(external_exports.object({ id: external_exports.number() })).query(async ({ ctx, input }) => {
        const { verifyPerformanceGroupAccess: verifyPerformanceGroupAccess2 } = await Promise.resolve().then(() => (init_accessControl(), accessControl_exports));
        await verifyPerformanceGroupAccess2(ctx.user.id, input.id);
        return getPerformanceGroupById(input.id);
      }),
      // v484: 数据隔离 + 时间范围绩效数据 - 获取绩效组内的广告活动
      getCampaigns: protectedProcedure.input(external_exports.object({
        groupId: external_exports.number(),
        startDate: external_exports.string().optional(),
        endDate: external_exports.string().optional()
      })).query(async ({ ctx, input }) => {
        const { verifyPerformanceGroupAccess: verifyPerformanceGroupAccess2 } = await Promise.resolve().then(() => (init_accessControl(), accessControl_exports));
        await verifyPerformanceGroupAccess2(ctx.user.id, input.groupId);
        if (input.startDate && input.endDate) {
          return getCampaignsByPerformanceGroupIdWithPerformance(
            input.groupId,
            input.startDate,
            input.endDate
          );
        }
        const endDate = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
        const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1e3).toISOString().split("T")[0];
        return getCampaignsByPerformanceGroupIdWithPerformance(
          // @ts-ignore
          input.groupId,
          startDate,
          endDate
        );
      }),
      // v484: 数据隔离 + 时间范围绩效数据 - 获取绩效组KPI汇总
      getKpiSummary: protectedProcedure.input(external_exports.object({
        groupId: external_exports.number(),
        startDate: external_exports.string().optional(),
        endDate: external_exports.string().optional()
      })).query(async ({ ctx, input }) => {
        const { verifyPerformanceGroupAccess: verifyPerformanceGroupAccess2 } = await Promise.resolve().then(() => (init_accessControl(), accessControl_exports));
        await verifyPerformanceGroupAccess2(ctx.user.id, input.groupId);
        const endDate = input.endDate || (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
        const startDate = input.startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1e3).toISOString().split("T")[0];
        const campaigns6 = await getCampaignsByPerformanceGroupIdWithPerformance(
          input.groupId,
          startDate,
          endDate
        );
        let totalSpend = 0;
        let totalRevenue = 0;
        let totalConversions = 0;
        let totalClicks = 0;
        let totalImpressions = 0;
        for (const campaign of campaigns6) {
          totalSpend += Number(campaign.spend) || 0;
          totalRevenue += Number(campaign.sales) || 0;
          totalConversions += campaign.orders || 0;
          totalClicks += campaign.clicks || 0;
          totalImpressions += campaign.impressions || 0;
        }
        const acos = totalRevenue > 0 ? totalSpend / totalRevenue * 100 : 0;
        const roas = totalSpend > 0 ? totalRevenue / totalSpend : 0;
        const ctr = totalImpressions > 0 ? totalClicks / totalImpressions * 100 : 0;
        const cvr = totalClicks > 0 ? totalConversions / totalClicks * 100 : 0;
        return {
          totalSpend,
          totalRevenue,
          totalConversions,
          totalClicks,
          totalImpressions,
          acos,
          roas,
          ctr,
          cvr,
          // @ts-ignore
          campaignCount: campaigns6.length
        };
      }),
      // v370.4: 数据隔离 - 添加广告活动到绩效组
      addCampaigns: protectedProcedure.input(external_exports.object({
        groupId: external_exports.number(),
        campaignIds: external_exports.array(external_exports.number())
      })).mutation(async ({ ctx, input }) => {
        const { verifyPerformanceGroupAccess: verifyPerformanceGroupAccess2 } = await Promise.resolve().then(() => (init_accessControl(), accessControl_exports));
        await verifyPerformanceGroupAccess2(ctx.user.id, input.groupId);
        let count11 = 0;
        for (const campaignId of input.campaignIds) {
          await assignCampaignToPerformanceGroup(campaignId, input.groupId);
          await updateCampaign(campaignId, { optimizationStatus: "managed" });
          count11++;
        }
        try {
          const { onCampaignsAdded: onCampaignsAdded2 } = await Promise.resolve().then(() => (init_optimizationScheduler(), optimizationScheduler_exports));
          onCampaignsAdded2(input.groupId, input.campaignIds).catch((err) => {
            log156.warn(`[Router] \u6DFB\u52A0\u5E7F\u544A\u6D3B\u52A8\u540E\u89E6\u53D1\u4F18\u5316\u5931\u8D25:`, err);
          });
        } catch (e) {
          log156.warn("[Router] \u5BFC\u5165optimizationScheduler\u5931\u8D25:", e);
        }
        return { success: true, count: count11 };
      }),
      // v370.4: 数据隔离 - 从绩效组移除单个广告活动
      removeCampaign: protectedProcedure.input(external_exports.object({
        groupId: external_exports.number(),
        campaignId: external_exports.number()
      })).mutation(async ({ ctx, input }) => {
        const { verifyPerformanceGroupAccess: verifyPerformanceGroupAccess2 } = await Promise.resolve().then(() => (init_accessControl(), accessControl_exports));
        await verifyPerformanceGroupAccess2(ctx.user.id, input.groupId);
        await assignCampaignToPerformanceGroup(input.campaignId, null);
        await updateCampaign(input.campaignId, { optimizationStatus: "unmanaged" });
        return { success: true };
      }),
      // v370.4: 数据隔离 - 更新绩效组目标
      updateGoal: protectedProcedure.input(external_exports.object({
        groupId: external_exports.number(),
        goalType: external_exports.string(),
        targetValue: external_exports.number().optional(),
        dailyBudget: external_exports.number().optional(),
        maxBid: external_exports.number().optional(),
        strategyTemplateName: external_exports.string().optional(),
        strategyTemplateId: external_exports.string().optional(),
        autoOptimize: external_exports.boolean().optional()
      })).mutation(async ({ ctx, input }) => {
        const { verifyPerformanceGroupAccess: verifyPerformanceGroupAccess2 } = await Promise.resolve().then(() => (init_accessControl(), accessControl_exports));
        await verifyPerformanceGroupAccess2(ctx.user.id, input.groupId);
        const updateData = {
          // @ts-ignore
          optimizationGoal: input.goalType
        };
        if (input.goalType === "target_acos" && input.targetValue) {
          updateData.targetAcos = input.targetValue.toString();
        } else if (input.goalType === "target_roas" && input.targetValue) {
          updateData.targetRoas = input.targetValue.toString();
        }
        if (input.dailyBudget !== void 0) {
          updateData.dailyBudget = input.dailyBudget.toString();
          updateData.dailySpendLimit = input.dailyBudget.toString();
        }
        if (input.maxBid !== void 0) {
          updateData.maxBid = input.maxBid.toString();
        }
        if (input.strategyTemplateName !== void 0) {
          updateData.strategyTemplateName = input.strategyTemplateName;
          updateData.strategyTemplateId = input.strategyTemplateName || null;
        }
        if (input.strategyTemplateId !== void 0) {
          updateData.strategyTemplateId = input.strategyTemplateId;
        }
        if (input.autoOptimize !== void 0) {
          updateData.autoOptimize = input.autoOptimize ? 1 : 0;
        }
        await updatePerformanceGroup(input.groupId, updateData);
        return { success: true };
      }),
      // ==================== 优化目标自动执行引擎 API ====================
      // v370.4: 数据隔离 - 获取优化目标执行摘要
      // v451: 添加2分钟API缓存解决大数据量下的超时问题
      getExecutionSummary: protectedProcedure.input(external_exports.object({ targetId: external_exports.number() })).query(async ({ ctx, input }) => {
        const { verifyPerformanceGroupAccess: verifyPerformanceGroupAccess2 } = await Promise.resolve().then(() => (init_accessControl(), accessControl_exports));
        await verifyPerformanceGroupAccess2(ctx.user.id, input.targetId);
        const cacheKey = apiCache.generateKey("performanceGroup.getExecutionSummary", ctx.user.id, input);
        const cached2 = apiCache.get(cacheKey);
        if (cached2) {
          log156.info(`[Cache HIT] getExecutionSummary targetId=${input.targetId}`);
          return cached2;
        }
        const optimizationTargetEngine = await Promise.resolve().then(() => (init_optimizationTargetEngine(), optimizationTargetEngine_exports));
        const result = await optimizationTargetEngine.getOptimizationTargetSummary(input.targetId);
        apiCache.set(cacheKey, result, 2 * 60 * 1e3);
        return result;
      }),
      // v370.4: 数据隔离 - 执行优化目标（干运行模式）
      previewExecution: protectedProcedure.input(external_exports.object({
        targetId: external_exports.number(),
        specificModules: external_exports.array(external_exports.string()).optional()
      })).query(async ({ ctx, input }) => {
        const { verifyPerformanceGroupAccess: verifyPerformanceGroupAccess2 } = await Promise.resolve().then(() => (init_accessControl(), accessControl_exports));
        await verifyPerformanceGroupAccess2(ctx.user.id, input.targetId);
        const optimizationTargetEngine = await Promise.resolve().then(() => (init_optimizationTargetEngine(), optimizationTargetEngine_exports));
        return optimizationTargetEngine.executeOptimizationTarget(input.targetId, {
          dryRun: true,
          forceExecution: true,
          specificModules: input.specificModules
        });
      }),
      // v370.4: 数据隔离 - 执行优化目标（实际执行）
      executeOptimization: protectedProcedure.input(external_exports.object({
        targetId: external_exports.number(),
        specificModules: external_exports.array(external_exports.string()).optional()
      })).mutation(async ({ ctx, input }) => {
        const { verifyPerformanceGroupAccess: verifyPerformanceGroupAccess2 } = await Promise.resolve().then(() => (init_accessControl(), accessControl_exports));
        await verifyPerformanceGroupAccess2(ctx.user.id, input.targetId);
        const optimizationTargetEngine = await Promise.resolve().then(() => (init_optimizationTargetEngine(), optimizationTargetEngine_exports));
        return optimizationTargetEngine.executeOptimizationTarget(input.targetId, {
          dryRun: false,
          specificModules: input.specificModules
        });
      }),
      // 批量执行所有启用的优化目标
      executeAllEnabled: protectedProcedure.input(external_exports.object({
        // @ts-ignore
        accountId: external_exports.number().optional(),
        dryRun: external_exports.boolean().optional().default(false)
      })).mutation(async ({ ctx, input }) => {
        const optimizationTargetEngine = await Promise.resolve().then(() => (init_optimizationTargetEngine(), optimizationTargetEngine_exports));
        return optimizationTargetEngine.executeAllEnabledTargets(input.accountId, {
          dryRun: input.dryRun
        });
      }),
      // 启用/禁用优化目标
      toggleEnabled: protectedProcedure.input(external_exports.object({
        // @ts-ignore
        targetId: external_exports.number(),
        isEnabled: external_exports.boolean()
      })).mutation(async ({ ctx, input }) => {
        await updatePerformanceGroup(input.targetId, {
          daypartingEnabled: input.isEnabled ? 1 : 0
        });
        return { success: true };
      }),
      // ==================== 优化日志 API ====================
      // 获取优化目标的日志列表
      // @ts-ignore
      getLogs: protectedProcedure.input(external_exports.object({
        performanceGroupId: external_exports.number(),
        category: external_exports.enum(["all", "performance_target", "bid_adjustment", "placement_adjustment", "optimization_settings"]).optional().default("all"),
        startDate: external_exports.string().optional(),
        endDate: external_exports.string().optional(),
        page: external_exports.number().optional().default(1),
        pageSize: external_exports.number().optional().default(50)
      })).query(async ({ ctx, input }) => {
        return getOptimizationLogs(input);
      }),
      // v137: 获取同步任务队列状态
      getSyncQueueStatus: protectedProcedure.input(external_exports.object({
        batchId: external_exports.string().optional(),
        optimizationTargetId: external_exports.number().optional()
      })).query(async ({ ctx, input }) => {
        const syncEngine = await Promise.resolve().then(() => (init_optimizationSyncEngine(), optimizationSyncEngine_exports));
        if (input.batchId) {
          return syncEngine.getBatchStatus(input.batchId);
        }
        return { total: 0, synced: 0, failed: 0, pending: 0, retry: 0, permanentlyFailed: 0 };
      }),
      // v137: 手动触发重试同步
      retrySyncTasks: protectedProcedure.input(external_exports.object({
        batchId: external_exports.string().optional(),
        accountId: external_exports.number().optional()
      })).mutation(async ({ ctx, input }) => {
        const syncEngine = await Promise.resolve().then(() => (init_optimizationSyncEngine(), optimizationSyncEngine_exports));
        return syncEngine.executeBatchSync({
          batchId: input.batchId,
          accountId: input.accountId
        });
      }),
      // 获取日志统计信息
      getLogStats: protectedProcedure.input(external_exports.object({
        performanceGroupId: external_exports.number(),
        days: external_exports.number().optional().default(30)
      })).query(async ({ ctx, input }) => {
        return getOptimizationLogStats(input.performanceGroupId, input.days);
      }),
      // 获取绩效趋势数据 (使用真实历史数据)
      getTrendData: protectedProcedure.input(external_exports.object({
        performanceGroupId: external_exports.number(),
        days: external_exports.number().optional().default(30)
      })).query(async ({ ctx, input }) => {
        const { performanceGroupId: performanceGroupId2, days } = input;
        const group = await getPerformanceGroupById(performanceGroupId2);
        if (!group) {
          throw new TRPCError({ code: "NOT_FOUND", message: "\u4F18\u5316\u76EE\u6807\u4E0D\u5B58\u5728" });
        }
        const endDate = /* @__PURE__ */ new Date();
        const startDate = /* @__PURE__ */ new Date();
        startDate.setDate(startDate.getDate() - days);
        const { getDailyPerformanceByPerformanceGroup: getDailyPerformanceByPerformanceGroup2 } = await Promise.resolve().then(() => (init_db_performance_trend(), db_performance_trend_exports));
        const dailyData = await getDailyPerformanceByPerformanceGroup2(
          performanceGroupId2,
          startDate,
          endDate
        );
        if (!dailyData || dailyData.length === 0) {
          return [];
        }
        return dailyData.map((day2) => {
          const sales = parseFloat(day2.totalSales || "0");
          const spend = parseFloat(day2.totalSpend || "0");
          const impressions = Number(day2.totalImpressions) || 0;
          const clicks = Number(day2.totalClicks) || 0;
          const orders = Number(day2.totalOrders) || 0;
          return {
            date: day2.date ? new Date(day2.date).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" }) : "N/A",
            fullDate: day2.date || (/* @__PURE__ */ new Date()).toISOString().split("T")[0],
            // @ts-ignore
            spend,
            sales,
            impressions,
            clicks,
            orders,
            // 计算派生指标
            acos: sales > 0 ? spend / sales * 100 : 0,
            roas: spend > 0 ? sales / spend : 0,
            ctr: impressions > 0 ? clicks / impressions * 100 : 0,
            cvr: clicks > 0 ? orders / clicks * 100 : 0,
            cpc: clicks > 0 ? spend / clicks : 0
          };
        });
      }),
      // 添加优化日志
      addLog: protectedProcedure.input(external_exports.object({
        performanceGroupId: external_exports.number(),
        logCategory: external_exports.enum(["performance_target", "bid_adjustment", "placement_adjustment", "optimization_settings"]),
        actionType: external_exports.string(),
        campaignId: external_exports.number().optional(),
        campaignName: external_exports.string().optional(),
        strategyTemplateId: external_exports.number().optional(),
        strategyTemplateName: external_exports.string().optional(),
        actionDetail: external_exports.string().optional(),
        previousValue: external_exports.string().optional(),
        newValue: external_exports.string().optional(),
        // @ts-ignore
        changeReason: external_exports.string().optional(),
        status: external_exports.enum(["pending", "success", "failed", "rolled_back"]).optional().default("success")
      })).mutation(async ({ ctx, input }) => {
        const group = await getPerformanceGroupById(input.performanceGroupId);
        if (!group) {
          throw new TRPCError({ code: "NOT_FOUND", message: "\u4F18\u5316\u76EE\u6807\u4E0D\u5B58\u5728" });
        }
        const account = await getAdAccountById(group.accountId);
        const logId = await createOptimizationLog({
          performanceGroupId: input.performanceGroupId,
          performanceGroupName: group.name,
          accountId: group.accountId,
          accountName: account?.accountName || "",
          userId: ctx.user.id,
          userName: ctx.user.name || ctx.user.email || "",
          // @ts-expect-error - type assertion
          logCategory: input.logCategory,
          // @ts-expect-error - type assertion
          actionType: input.actionType,
          // @ts-ignore
          campaignId: input.campaignId,
          campaignName: input.campaignName,
          strategyTemplateId: input.strategyTemplateId,
          strategyTemplateName: input.strategyTemplateName,
          actionDetail: input.actionDetail,
          previousValue: input.previousValue,
          newValue: input.newValue,
          changeReason: input.changeReason,
          // @ts-expect-error - string type assertion
          status: input.status,
          // @ts-ignore
          executedAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ")
        });
        return { id: logId, success: true };
      }),
      // ==================== v144: 统一历史与追踪 API ====================
      // 获取优化目标下所有广告活动的出价调整历史
      getBidAdjustmentHistory: protectedProcedure.input(external_exports.object({
        performanceGroupId: external_exports.number(),
        campaignId: external_exports.number().optional(),
        adjustmentType: external_exports.enum(["manual", "auto_optimal", "auto_dayparting", "auto_placement", "batch_campaign", "batch_group"]).optional(),
        startDate: external_exports.string().optional(),
        endDate: external_exports.string().optional(),
        page: external_exports.number().optional().default(1),
        // @ts-ignore
        pageSize: external_exports.number().optional().default(50)
      })).query(async ({ ctx, input }) => {
        const group = await getPerformanceGroupById(input.performanceGroupId);
        if (!group) throw new Error("Performance group not found");
        const result = await getOptimizationEvents({
          performanceGroupId: input.performanceGroupId,
          accountId: group.accountId,
          eventCategory: "bid_adjustment",
          campaignId: input.campaignId,
          startDate: input.startDate,
          endDate: input.endDate,
          limit: input.pageSize,
          // @ts-ignore
          offset: (input.page - 1) * input.pageSize
        });
        return {
          records: result.events.map((e) => ({
            ...e,
            appliedAt: e.createdAt,
            adjustmentType: e.adjustmentType || e.actionType,
            adjustmentReason: e.changeReason,
            status: e.status === "success" ? "applied" : e.status
            // @ts-ignore
          })),
          total: result.total,
          page: input.page,
          pageSize: input.pageSize,
          totalPages: Math.ceil(result.total / input.pageSize)
        };
      }),
      // v146: 出价调整统计 - 重定向到统一事件表
      getBidAdjustmentStats: protectedProcedure.input(external_exports.object({
        performanceGroupId: external_exports.number(),
        days: external_exports.number().optional().default(30)
      })).query(async ({ ctx, input }) => {
        const group = await getPerformanceGroupById(input.performanceGroupId);
        if (!group) throw new Error("Performance group not found");
        return getOptimizationEventStats({
          performanceGroupId: input.performanceGroupId,
          accountId: group.accountId,
          days: input.days
        });
      }),
      // v146: 效果追踪统计 - 重定向到统一事件表
      getBidAdjustmentTrackingStats: protectedProcedure.input(external_exports.object({
        performanceGroupId: external_exports.number(),
        days: external_exports.number().optional().default(30)
      })).query(async ({ ctx, input }) => {
        const group = await getPerformanceGroupById(input.performanceGroupId);
        if (!group) throw new Error("Performance group not found");
        return getOptimizationEventStats({
          performanceGroupId: input.performanceGroupId,
          accountId: group.accountId,
          // @ts-ignore
          days: input.days
        });
      }),
      // v146: 回滚出价调整 - 重定向到统一事件表
      rollbackBidAdjustment: protectedProcedure.input(external_exports.object({
        adjustmentId: external_exports.number()
      })).mutation(async ({ input, ctx }) => {
        return rollbackOptimizationEvent(input.adjustmentId, ctx.user.name || ctx.user.openId);
      }),
      // v146: 批量回滚 - 重定向到统一事件表
      batchRollbackBidAdjustments: protectedProcedure.input(external_exports.object({
        adjustmentIds: external_exports.array(external_exports.number())
      })).mutation(async ({ input, ctx }) => {
        const results = [];
        for (const id of input.adjustmentIds) {
          try {
            const result = await rollbackOptimizationEvent(id, ctx.user.name || ctx.user.openId);
            results.push({ id, success: true, result });
          } catch (error48) {
            results.push({ id, success: false, error: error48.message });
          }
        }
        return { results, total: results.length, succeeded: results.filter((r) => r.success).length };
      }),
      // 运行效果追踪任务
      runEffectTracking: protectedProcedure.input(external_exports.object({
        period: external_exports.enum(["7d", "14d", "30d"]).optional()
      })).mutation(async ({ ctx, input }) => {
        if (input.period) {
          const { runEffectTrackingTask: runEffectTrackingTask2 } = await Promise.resolve().then(() => (init_effectTrackingScheduler(), effectTrackingScheduler_exports));
          const periodMap = { "7d": 7, "14d": 14, "30d": 30 };
          return runEffectTrackingTask2(periodMap[input.period] || 7);
        } else {
          const { runAllTrackingTasks: runAllTrackingTasks2 } = await Promise.resolve().then(() => (init_effectTrackingScheduler(), effectTrackingScheduler_exports));
          return runAllTrackingTasks2();
        }
      }),
      // 生成效果追踪报告
      generateTrackingReport: protectedProcedure.input(external_exports.object({
        performanceGroupId: external_exports.number(),
        startDate: external_exports.string().optional(),
        endDate: external_exports.string().optional(),
        page: external_exports.number().optional().default(1),
        pageSize: external_exports.number().optional().default(50)
      })).query(async ({ ctx, input }) => {
        const group = await getPerformanceGroupById(input.performanceGroupId);
        if (!group) throw new Error("Performance group not found");
        const result = await getOptimizationEvents({
          performanceGroupId: input.performanceGroupId,
          accountId: group.accountId,
          eventCategory: "bid_adjustment",
          startDate: input.startDate,
          endDate: input.endDate,
          // @ts-ignore
          limit: input.pageSize,
          offset: (input.page - 1) * input.pageSize
        });
        const allRecords = result.events.map((e) => ({
          ...e,
          appliedAt: e.createdAt,
          adjustmentType: e.adjustmentType || e.actionType
        }));
        const trackedRecords = allRecords.filter(
          (r) => r.actualProfit7D !== null || r.actualProfit14D !== null || r.actualProfit30D !== null
        );
        return {
          records: trackedRecords,
          total: trackedRecords.length,
          allRecords,
          // @ts-ignore
          allTotal: result.total,
          page: input.page,
          pageSize: input.pageSize
        };
      }),
      // ==================== v145: 统一优化事件 API ====================
      // 查询统一优化事件
      getOptimizationEvents: protectedProcedure.input(external_exports.object({
        performanceGroupId: external_exports.number(),
        eventCategory: external_exports.string().optional(),
        actionType: external_exports.string().optional(),
        status: external_exports.string().optional(),
        campaignId: external_exports.number().optional(),
        startDate: external_exports.string().optional(),
        endDate: external_exports.string().optional(),
        page: external_exports.number().optional().default(1),
        pageSize: external_exports.number().optional().default(50)
      })).query(async ({ ctx, input }) => {
        const group = await getPerformanceGroupById(input.performanceGroupId);
        if (!group) throw new Error("Performance group not found");
        const result = await getOptimizationEvents({
          performanceGroupId: input.performanceGroupId,
          // @ts-ignore
          accountId: group.accountId,
          eventCategory: input.eventCategory,
          actionType: input.actionType,
          status: input.status,
          campaignId: input.campaignId,
          startDate: input.startDate,
          endDate: input.endDate,
          limit: input.pageSize,
          offset: (input.page - 1) * input.pageSize
        });
        return { ...result, page: input.page, pageSize: input.pageSize };
      }),
      // 获取统一优化事件统计
      getOptimizationEventStats: protectedProcedure.input(external_exports.object({
        performanceGroupId: external_exports.number(),
        days: external_exports.number().optional().default(30)
      })).query(async ({ ctx, input }) => {
        const group = await getPerformanceGroupById(input.performanceGroupId);
        if (!group) throw new Error("Performance group not found");
        return getOptimizationEventStats({
          performanceGroupId: input.performanceGroupId,
          accountId: group.accountId,
          days: input.days
        });
      }),
      // 回滚统一优化事件
      rollbackOptimizationEvent: protectedProcedure.input(external_exports.object({
        eventId: external_exports.number()
      })).mutation(async ({ input, ctx }) => {
        return rollbackOptimizationEvent(input.eventId, ctx.user.name || ctx.user.openId);
      }),
      // 数据迁移API - 将旧表数据迁移到optimization_events
      migrateToUnifiedEvents: protectedProcedure.input(external_exports.object({
        performanceGroupId: external_exports.number(),
        sourceTables: external_exports.array(external_exports.enum(["bidding_logs", "bid_adjustment_history", "optimization_logs"])).optional()
      })).mutation(async ({ ctx, input }) => {
        const group = await getPerformanceGroupById(input.performanceGroupId);
        if (!group) throw new Error("Performance group not found");
        const results = {};
        const tables = input.sourceTables || ["bidding_logs", "bid_adjustment_history", "optimization_logs"];
        if (tables.includes("bidding_logs")) {
          results.biddingLogs = await migrateFromBiddingLogs(group.accountId);
        }
        if (tables.includes("bid_adjustment_history")) {
          results.bidAdjustmentHistory = await migrateFromBidAdjustmentHistory(group.accountId);
        }
        if (tables.includes("optimization_logs")) {
          results.optimizationLogs = await migrateFromOptimizationLogs(input.performanceGroupId);
        }
        return { success: true, migrated: results, total: Object.values(results).reduce((a, b) => a + b, 0) };
      }),
      // ==================== v151: 统一分析API入口 ====================
      // 将原来分散在 advancedAnalytics / algorithmEffect / unifiedOptimization 中的分析功能
      // 统一通过 performanceGroup 路由提供，前端可以在优化目标详情页直接调用
      // 获取优化目标的综合分析摘要（融合多个分析服务的结果）
      getUnifiedAnalytics: protectedProcedure.input(external_exports.object({
        groupId: external_exports.number(),
        days: external_exports.number().optional().default(30)
      })).query(async ({ ctx, input }) => {
        const group = await Promise.resolve().then(() => (init_db2(), db_exports)).then((m) => m.getPerformanceGroupById(input.groupId));
        if (!group) throw new Error("\u4F18\u5316\u76EE\u6807\u4E0D\u5B58\u5728");
        const [attribution, summary] = await Promise.allSettled([
          getAttributionAnalysis({
            performanceGroupId: input.groupId,
            days: input.days,
            limit: 10,
            offset: 0
          }),
          getAdvancedAnalyticsSummary({
            performanceGroupId: input.groupId,
            days: input.days
          })
        ]);
        return {
          groupId: input.groupId,
          groupName: group.name,
          attribution: attribution.status === "fulfilled" ? attribution.value : null,
          summary: summary.status === "fulfilled" ? summary.value : null
        };
      }),
      // 获取优化目标的优化状态（代替原 unifiedOptimization.getPerformanceGroupState）
      getOptimizationState: protectedProcedure.input(external_exports.object({ groupId: external_exports.number() })).query(async ({ ctx, input }) => {
        return getPerformanceGroupOptimizationState(input.groupId);
      })
    });
  }
});

