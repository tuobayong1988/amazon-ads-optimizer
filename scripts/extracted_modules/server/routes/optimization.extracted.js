// Extracted from production dist/index.js
// Original module: server/routes/optimization.ts
// Lines: 440

var log162, optimizationRouter, unifiedOptimizationRouter;
var init_optimization = __esm({
  "server/routes/optimization.ts"() {
    "use strict";
    init_trpc();
    init_zod();
    init_dist();
    init_db2();
    init_amazonSyncService();
    init_unifiedOptimizationEngine();
    init_nextGenBidOrchestrator();
    init_logger();
    log162 = createModuleLogger("Route_optimization");
    optimizationRouter = router({
      // v230: 新增getMetrics、getRecentActions、getTrends方法，修复前端AutoOptimizationDashboard页面失效问题
      // @ts-ignore
      getMetrics: protectedProcedure.query(async ({ ctx }) => {
        const dbInstance = await getDb();
        if (!dbInstance) {
          return { totalActionsToday: 0, completedActions: 0, failedActions: 0, pendingActions: 0, totalROIImprovement: 0, totalCostSavings: 0, averageActionDuration: 0, successRate: 0 };
        }
        try {
          const { optimizationLogs: optimizationLogs2, adAccounts: adAccounts3 } = await Promise.resolve().then(() => (init_schema2(), schema_exports));
          const { sql: sqlTag } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
          const todayStart = /* @__PURE__ */ new Date();
          todayStart.setHours(0, 0, 0, 0);
          const todayStr = todayStart.toISOString();
          const userAccountRows = await dbInstance.select({ id: adAccounts3.id }).from(adAccounts3).where(sqlTag`${adAccounts3.userId} = ${ctx.user.id}`);
          const userAccountIds = userAccountRows.map((r) => r.id);
          if (userAccountIds.length === 0) {
            return { totalActionsToday: 0, completedActions: 0, failedActions: 0, pendingActions: 0, totalROIImprovement: 0, totalCostSavings: 0, averageActionDuration: 0, successRate: 0 };
          }
          const accountFilter = sqlTag`account_id IN (${sqlTag.raw(userAccountIds.join(","))})`;
          const [stats4] = await dbInstance.select({
            total: sqlTag`COUNT(*)`,
            completed: sqlTag`SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END)`,
            failed: sqlTag`SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END)`
          }).from(optimizationLogs2).where(sqlTag`created_at >= ${todayStr} AND ${accountFilter}`);
          const total = Number(stats4?.total || 0);
          const completed = Number(stats4?.completed || 0);
          const failed = Number(stats4?.failed || 0);
          return {
            totalActionsToday: total,
            completedActions: completed,
            failedActions: failed,
            pendingActions: Math.max(0, total - completed - failed),
            totalROIImprovement: 0,
            totalCostSavings: 0,
            averageActionDuration: 0,
            successRate: total > 0 ? Math.round(completed / total * 100) : 0
          };
        } catch (error48) {
          log162.warn("[optimization.getMetrics] \u67E5\u8BE2\u5931\u8D25:", error48.message);
          return { totalActionsToday: 0, completedActions: 0, failedActions: 0, pendingActions: 0, totalROIImprovement: 0, totalCostSavings: 0, averageActionDuration: 0, successRate: 0 };
        }
      }),
      // @ts-ignore
      getRecentActions: protectedProcedure.input(external_exports.object({ limit: external_exports.number().optional().default(10) })).query(async ({ input, ctx }) => {
        const dbInstance = await getDb();
        if (!dbInstance) return [];
        try {
          const { optimizationLogs: optimizationLogs2, adAccounts: adAccounts3 } = await Promise.resolve().then(() => (init_schema2(), schema_exports));
          const { desc: desc29, sql: sqlTag } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
          const userAccountRows = await dbInstance.select({ id: adAccounts3.id }).from(adAccounts3).where(sqlTag`${adAccounts3.userId} = ${ctx.user.id}`);
          const userAccountIds = userAccountRows.map((r) => r.id);
          if (userAccountIds.length === 0) return [];
          const accountFilter = sqlTag`account_id IN (${sqlTag.raw(userAccountIds.join(","))})`;
          const logs = await dbInstance.select().from(optimizationLogs2).where(accountFilter).orderBy(desc29(optimizationLogs2.id)).limit(input.limit);
          return logs.map((log216) => ({
            id: log216.id,
            campaignId: log216.campaignId,
            campaignName: log216.campaignName || "",
            actionType: log216.actionType,
            actionDescription: log216.changeReason || "",
            previousValue: log216.previousValue || "",
            newValue: log216.newValue || "",
            expectedImpact: "neutral",
            expectedImpactPercent: 0,
            status: log216.status === "success" ? "completed" : log216.status === "failed" ? "failed" : "pending",
            createdAt: log216.createdAt ? String(log216.createdAt) : (/* @__PURE__ */ new Date()).toISOString(),
            completedAt: log216.executedAt ? String(log216.executedAt) : void 0
          }));
        } catch (error48) {
          log162.warn("[optimization.getRecentActions] \u67E5\u8BE2\u5931\u8D25:", error48.message);
          return [];
        }
      }),
      getTrends: protectedProcedure.input(external_exports.object({ days: external_exports.number().optional().default(7) })).query(async ({ input, ctx }) => {
        const dbInstance = await getDb();
        if (!dbInstance) return [];
        try {
          const { sql: sqlTag } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
          const { optimizationLogs: optimizationLogs2, adAccounts: adAccounts3 } = await Promise.resolve().then(() => (init_schema2(), schema_exports));
          const startDate = /* @__PURE__ */ new Date();
          startDate.setDate(startDate.getDate() - input.days);
          const startStr = startDate.toISOString().slice(0, 10);
          const userAccountRows = await dbInstance.select({ id: adAccounts3.id }).from(adAccounts3).where(sqlTag`${adAccounts3.userId} = ${ctx.user.id}`);
          const userAccountIds = userAccountRows.map((r) => r.id);
          if (userAccountIds.length === 0) return [];
          const accountFilter = sqlTag`account_id IN (${sqlTag.raw(userAccountIds.join(","))})`;
          const rows = await dbInstance.select({
            date: sqlTag`DATE(created_at)`,
            actions: sqlTag`COUNT(*)`
          }).from(optimizationLogs2).where(sqlTag`created_at >= ${startStr} AND ${accountFilter}`).groupBy(sqlTag`DATE(created_at)`).orderBy(sqlTag`DATE(created_at)`);
          return rows.map((r) => ({
            date: String(r.date),
            actions: Number(r.actions || 0),
            roiImprovement: 0,
            costSavings: 0
          }));
        } catch (error48) {
          log162.warn("[optimization.getTrends] \u67E5\u8BE2\u5931\u8D25:", error48.message);
          return [];
        }
      }),
      runOptimization: protectedProcedure.input(external_exports.object({
        performanceGroupId: external_exports.number(),
        dryRun: external_exports.boolean().optional().default(true)
      })).mutation(async ({ ctx, input }) => {
        const group = await getPerformanceGroupById(input.performanceGroupId);
        if (!group) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Performance group not found" });
        }
        const campaigns6 = await getCampaignsByPerformanceGroupId(input.performanceGroupId);
        const results = [];
        const groupConfig = {
          optimizationGoal: group.optimizationGoal || "maximize_sales",
          targetAcos: group.targetAcos ? parseFloat(group.targetAcos) : void 0,
          targetRoas: group.targetRoas ? parseFloat(group.targetRoas) : void 0,
          // @ts-ignore
          dailySpendLimit: group.dailySpendLimit ? parseFloat(group.dailySpendLimit) : void 0,
          // @ts-ignore
          dailyCostTarget: group.dailyCostTarget ? parseFloat(group.dailyCostTarget) : void 0,
          maxBid: group.maxBid ? parseFloat(group.maxBid) : 10
        };
        for (const campaign of campaigns6) {
          const adGroups6 = await getAdGroupsByCampaignId(campaign.campaignId);
          const maxBidLimit = campaign.maxBid ? parseFloat(campaign.maxBid) : groupConfig.maxBid || 10;
          for (const adGroup of adGroups6) {
            const keywords10 = await getKeywordsByAdGroupId(adGroup.id);
            const keywordTargets = keywords10.filter((k) => k.keywordStatus === "enabled" && parseFloat(k.bid) > 0).map((k) => ({
              id: k.id,
              type: "keyword",
              currentBid: parseFloat(k.bid),
              impressions: k.impressions || 0,
              clicks: k.clicks || 0,
              spend: parseFloat(k.spend || "0"),
              sales: parseFloat(k.sales || "0"),
              orders: k.orders || 0,
              matchType: k.matchType
            }));
            if (keywordTargets.length > 0) {
              const nextGenKeywordResults = await batchCalculateNextGenBids(
                group.accountId,
                keywordTargets,
                groupConfig,
                maxBidLimit
              );
              for (const ngr of nextGenKeywordResults) {
                if (ngr.actionType !== "hold") {
                  results.push({
                    targetId: ngr.targetId,
                    targetType: ngr.targetType === "keyword" ? "keyword" : "product_target",
                    previousBid: ngr.previousBid,
                    newBid: ngr.newBid,
                    actionType: ngr.actionType,
                    bidChangePercent: ngr.bidChangePercent,
                    reason: ngr.reason
                  });
                }
              }
            }
            const targets = await getProductTargetsByAdGroupId(adGroup.id);
            const productTargets5 = targets.filter((t2) => t2.targetStatus === "enabled" && parseFloat(t2.bid) > 0).map((t2) => ({
              id: t2.id,
              type: "product_target",
              currentBid: parseFloat(t2.bid),
              impressions: t2.impressions || 0,
              clicks: t2.clicks || 0,
              spend: parseFloat(t2.spend || "0"),
              sales: parseFloat(t2.sales || "0"),
              orders: t2.orders || 0
            }));
            if (productTargets5.length > 0) {
              const nextGenPtResults = await batchCalculateNextGenBids(
                group.accountId,
                productTargets5,
                groupConfig,
                maxBidLimit
              );
              for (const ngr of nextGenPtResults) {
                if (ngr.actionType !== "hold") {
                  results.push({
                    targetId: ngr.targetId,
                    targetType: ngr.targetType === "keyword" ? "keyword" : "product_target",
                    previousBid: ngr.previousBid,
                    newBid: ngr.newBid,
                    actionType: ngr.actionType,
                    bidChangePercent: ngr.bidChangePercent,
                    reason: ngr.reason
                  });
                }
              }
            }
          }
        }
        if (!input.dryRun) {
          const credentials = await getAmazonApiCredentials(group.accountId);
          let syncService = null;
          if (credentials) {
            try {
              const accountInfo = await getAdAccountById(group.accountId);
              const marketplace = accountInfo?.marketplace || "US";
              syncService = await AmazonSyncService.createFromCredentials(
                {
                  clientId: credentials.clientId,
                  clientSecret: credentials.clientSecret,
                  refreshToken: credentials.refreshToken,
                  profileId: credentials.profileId,
                  region: credentials.region
                },
                group.accountId,
                0,
                // system user
                marketplace
              );
            } catch (apiError) {
              log162.warn("[runOptimization] \u521B\u5EFAAmazon API\u5BA2\u6237\u7AEF\u5931\u8D25:", apiError.message);
            }
          } else {
            log162.warn("[runOptimization] \u672A\u627E\u5230API\u51ED\u8BC1\uFF0C\u4EC5\u66F4\u65B0\u672C\u5730\u6570\u636E\u5E93");
          }
          let apiSuccessCount = 0;
          let apiFailCount = 0;
          for (const result of results) {
            let campaignId = 0;
            let adGroupId = 0;
            let targetName = "";
            let matchType = "";
            let amazonId = "";
            if (result.targetType === "keyword") {
              const keyword = await getKeywordById(result.targetId);
              if (keyword) {
                const adGroup = keyword.internalAdGroupId ? await getAdGroupById(keyword.internalAdGroupId) : null;
                if (adGroup) {
                  adGroupId = adGroup.id;
                  campaignId = adGroup.String(campaignId);
                }
                targetName = keyword.keywordText;
                matchType = keyword.matchType;
                amazonId = keyword.keywordId || "";
              }
            } else {
              const target = await getProductTargetById(result.targetId);
              if (target) {
                const adGroup = target.internalAdGroupId ? await getAdGroupById(target.internalAdGroupId) : null;
                if (adGroup) {
                  adGroupId = adGroup.id;
                  campaignId = adGroup.String(campaignId);
                }
                targetName = `ASIN: ${target.targetValue}`;
                amazonId = target.targetId || "";
              }
            }
            let apiSuccess = false;
            if (syncService && amazonId) {
              try {
                if (result.targetType === "keyword") {
                  await syncService.client.updateKeywordBids([{
                    keywordId: String(amazonId),
                    bid: Number(result.newBid.toFixed(2))
                  }]);
                } else {
                  await syncService.client.updateProductTargetBids([{
                    targetId: String(amazonId),
                    bid: Number(result.newBid.toFixed(2))
                  }]);
                }
                apiSuccess = true;
                apiSuccessCount++;
              } catch (apiError) {
                log162.warn(`[runOptimization] Amazon API\u8C03\u7528\u5931\u8D25 (${result.targetType} ${result.targetId}):`, apiError.message);
                apiFailCount++;
              }
            }
            if (result.targetType === "keyword") {
              await updateKeywordBid(result.targetId, result.newBid.toString());
            } else {
              await updateProductTargetBid(result.targetId, result.newBid.toString());
            }
            await createBiddingLog({
              accountId: group.accountId,
              campaignId: String(campaignId),
              internalAdGroupId: adGroupId || 0,
              // v421: 使用internalAdGroupId
              logTargetType: result.targetType,
              targetId: result.targetId,
              targetName,
              logMatchType: matchType || void 0,
              actionType: result.actionType,
              previousBid: result.previousBid.toString(),
              newBid: result.newBid.toString(),
              bidChangePercent: result.bidChangePercent.toString(),
              reason: `${apiSuccess ? "[API\u2705]" : syncService ? "[API\u274C]" : "[\u4EC5\u672C\u5730]"} ${result.reason}`,
              algorithmVersion: "1.0.0",
              isIntradayAdjustment: 0
            });
          }
          log162.info(`[runOptimization] \u6267\u884C\u5B8C\u6210: API\u6210\u529F=${apiSuccessCount}, API\u5931\u8D25=${apiFailCount}, \u603B\u8BA1=${results.length}`);
        }
        return {
          totalOptimizations: results.length,
          results,
          applied: !input.dryRun
        };
      }),
      calculatePlacementAdjustments: protectedProcedure.input(external_exports.object({
        campaignId: external_exports.number(),
        targetAcos: external_exports.number().optional()
      })).query(async ({ ctx, input }) => {
        return {
          topSearch: 0,
          productPage: 0,
          rest: 0
        };
      })
    });
    unifiedOptimizationRouter = router({
      // 获取广告活动的优化状态
      getCampaignState: protectedProcedure.input(external_exports.object({ campaignId: external_exports.number() })).query(async ({ ctx, input }) => {
        return getCampaignOptimizationState(input.campaignId);
      }),
      // 获取绩效组的优化状态
      getPerformanceGroupState: protectedProcedure.input(external_exports.object({ groupId: external_exports.number() })).query(async ({ ctx, input }) => {
        return getPerformanceGroupOptimizationState(input.groupId);
      }),
      // 运行统一优化分析
      // @ts-ignore
      runAnalysis: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        campaignIds: external_exports.array(external_exports.number()).optional(),
        performanceGroupIds: external_exports.array(external_exports.number()).optional(),
        optimizationTypes: external_exports.array(external_exports.enum([
          "bid_adjustment",
          "placement_tilt",
          "dayparting",
          "negative_keyword",
          "funnel_migration",
          "budget_reallocation",
          "correction",
          "traffic_isolation"
        ])).optional()
      })).mutation(async ({ ctx, input }) => {
        return runUnifiedOptimizationAnalysis(
          input.accountId,
          {
            campaignIds: input.campaignIds,
            performanceGroupIds: input.performanceGroupIds,
            optimizationTypes: input.optimizationTypes
          }
        );
      }),
      // 执行单个优化决策
      executeDecision: protectedProcedure.input(external_exports.object({
        decisionId: external_exports.string(),
        executedBy: external_exports.enum(["auto", "manual"]).optional()
      })).mutation(async ({ ctx, input }) => {
        return executeOptimizationDecision(
          input.decisionId,
          input.executedBy || "manual"
        );
      }),
      // 批量执行优化决策
      batchExecuteDecisions: protectedProcedure.input(external_exports.object({
        decisionIds: external_exports.array(external_exports.string()),
        executedBy: external_exports.enum(["auto", "manual"]).optional()
      })).mutation(async ({ ctx, input }) => {
        return batchExecuteOptimizationDecisions(
          input.decisionIds,
          input.executedBy || "manual"
        );
      }),
      // 获取优化摘要
      getSummary: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        campaignId: external_exports.number().optional(),
        performanceGroupId: external_exports.number().optional()
      })).query(async ({ ctx, input }) => {
        return getOptimizationSummary(
          input.accountId,
          // @ts-ignore
          {
            campaignId: input.campaignId,
            performanceGroupId: input.performanceGroupId
          }
        );
      }),
      // 更新广告活动优化设置
      updateCampaignSettings: protectedProcedure.input(external_exports.object({
        campaignId: external_exports.number(),
        autoOptimizationEnabled: external_exports.boolean().optional(),
        executionMode: external_exports.enum(["full_auto", "semi_auto", "manual", "disabled"]).optional(),
        optimizationTypes: external_exports.object({
          bidAdjustment: external_exports.boolean().optional(),
          placementTilt: external_exports.boolean().optional(),
          dayparting: external_exports.boolean().optional(),
          negativeKeyword: external_exports.boolean().optional()
        }).optional()
      })).mutation(async ({ ctx, input }) => {
        return updateCampaignOptimizationSettings(
          input.campaignId,
          {
            autoOptimizationEnabled: input.autoOptimizationEnabled,
            executionMode: input.executionMode,
            optimizationTypes: input.optimizationTypes
          }
        );
      }),
      // 更新绩效组优化设置
      updatePerformanceGroupSettings: protectedProcedure.input(external_exports.object({
        groupId: external_exports.number(),
        autoOptimizationEnabled: external_exports.boolean().optional(),
        executionMode: external_exports.enum(["full_auto", "semi_auto", "manual", "disabled"]).optional(),
        targetAcos: external_exports.number().optional(),
        targetRoas: external_exports.number().optional()
      })).mutation(async ({ ctx, input }) => {
        return updatePerformanceGroupOptimizationSettings(
          input.groupId,
          {
            autoOptimizationEnabled: input.autoOptimizationEnabled,
            executionMode: input.executionMode,
            targetAcos: input.targetAcos,
            targetRoas: input.targetRoas
          }
        );
      })
    });
  }
});

