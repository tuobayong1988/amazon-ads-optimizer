// Extracted from production dist/index.js
// Original module: server/routes/adAutomation.ts
// Lines: 491

var log178, adAutomationRouter;
var init_adAutomation2 = __esm({
  "server/routes/adAutomation.ts"() {
    "use strict";
    init_trpc();
    init_zod();
    init_db2();
    init_adAutomation();
    init_accessControl();
    init_apiCacheService();
    init_logger();
    log178 = createModuleLogger("Route_adAutomation");
    adAutomationRouter = router({
      // N-Gram词根分析
      analyzeNgrams: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        days: external_exports.number().min(7).max(90).default(30)
      })).query(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        const searchTerms8 = await getSearchTermsForAnalysis(input.accountId, input.days);
        const results = analyzeNgrams(searchTerms8);
        return {
          totalTermsAnalyzed: searchTerms8.length,
          negativeNgramCandidates: results.filter((r) => r.isNegativeCandidate),
          allNgrams: results.slice(0, 100)
          // 返回前100个
        };
      }),
      // 广告漏斗迁移分析
      analyzeFunnelMigration: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        broadToPhraseMinConversions: external_exports.number().default(3),
        phraseToExactMinConversions: external_exports.number().default(10),
        phraseToExactMinRoas: external_exports.number().default(5)
        // @ts-ignore
      })).query(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        const searchTerms8 = await getCampaignSearchTerms(input.accountId);
        const suggestions = analyzeFunnelMigration(searchTerms8, {
          broadToPhrase: { minConversions: input.broadToPhraseMinConversions, minRoas: 1 },
          phraseToExact: { minConversions: input.phraseToExactMinConversions, minRoas: input.phraseToExactMinRoas },
          bidIncreasePercent: 20
        });
        return {
          totalSuggestions: suggestions.length,
          broadToPhrase: suggestions.filter((s) => s.toMatchType === "phrase"),
          phraseToExact: suggestions.filter((s) => s.toMatchType === "exact")
        };
      }),
      // 流量冲突检测
      // @ts-ignore
      detectTrafficConflicts: protectedProcedure.input(external_exports.object({ accountId: external_exports.number() })).query(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        const searchTerms8 = await getCampaignSearchTerms(input.accountId);
        const conflicts = detectTrafficConflicts(searchTerms8);
        return {
          totalConflicts: conflicts.length,
          // @ts-ignore
          totalWastedSpend: conflicts.reduce((sum2, c) => sum2 + c.totalWastedSpend, 0),
          conflicts: conflicts.slice(0, 50)
          // 返回前50个
        };
      }),
      // 智能竞价调整建议
      analyzeBidAdjustments: protectedProcedure.input(external_exports.object({
        // @ts-ignore
        accountId: external_exports.number(),
        targetAcos: external_exports.number().default(30),
        targetRoas: external_exports.number().default(3.33)
      })).query(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        const targets = await getBidTargets(input.accountId);
        const suggestions = analyzeBidAdjustments2(targets, {
          rampUpPercent: 5,
          maxBidMultiplier: 3,
          minImpressions: 100,
          correctionWindow: 14,
          targetAcos: input.targetAcos,
          targetRoas: input.targetRoas
        });
        return {
          totalSuggestions: suggestions.length,
          urgentCount: suggestions.filter((s) => s.priority === "urgent").length,
          highCount: suggestions.filter((s) => s.priority === "high").length,
          suggestions: suggestions.slice(0, 100)
        };
      }),
      // 搜索词分类
      classifySearchTerms: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        productKeywords: external_exports.array(external_exports.string()),
        // @ts-ignore
        productCategory: external_exports.string(),
        productBrand: external_exports.string(),
        productColors: external_exports.array(external_exports.string()).optional(),
        productSizes: external_exports.array(external_exports.string()).optional()
      })).query(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        const searchTerms8 = await getUniqueSearchTerms(input.accountId);
        const classifications = classifySearchTerms(
          searchTerms8,
          input.productKeywords,
          {
            category: input.productCategory,
            brand: input.productBrand,
            colors: input.productColors,
            sizes: input.productSizes
          }
        );
        return {
          totalClassified: classifications.length,
          highRelevance: classifications.filter((c) => c.relevance === "high"),
          weakRelevance: classifications.filter((c) => c.relevance === "weak"),
          seeminglyRelated: classifications.filter((c) => c.relevance === "seemingly_related"),
          unrelated: classifications.filter((c) => c.relevance === "unrelated")
        };
      }),
      // 获取否词前置列表
      getPresetNegatives: protectedProcedure.input(external_exports.object({
        productCategory: external_exports.string()
      })).query(({ input }) => {
        const presets = getPresetNegativeKeywords(input.productCategory);
        return {
          totalPresets: presets.length,
          presets
        };
      }),
      // 批量应用否定词
      applyNegativeKeywords: protectedProcedure.input(external_exports.object({
        // @ts-ignore
        accountId: external_exports.number(),
        campaignId: external_exports.number(),
        negatives: external_exports.array(external_exports.object({
          keyword: external_exports.string(),
          matchType: external_exports.enum(["phrase", "exact"])
        }))
      })).mutation(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        let addedCount = 0;
        for (const neg of input.negatives) {
          await addNegativeKeyword({
            campaignId: input.campaignId,
            keyword: neg.keyword,
            matchType: neg.matchType
          });
          addedCount++;
        }
        return { addedCount };
      }),
      // 执行漏斗迁移
      executeFunnelMigration: protectedProcedure.input(external_exports.object({
        // @ts-ignore
        accountId: external_exports.number(),
        migrations: external_exports.array(external_exports.object({
          searchTerm: external_exports.string(),
          fromCampaignId: external_exports.number(),
          toMatchType: external_exports.enum(["phrase", "exact"]),
          suggestedBid: external_exports.number()
        }))
      })).mutation(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        let migratedCount = 0;
        for (const migration of input.migrations) {
          await recordMigration({
            accountId: input.accountId,
            searchTerm: migration.searchTerm,
            fromCampaignId: migration.fromCampaignId,
            toMatchType: migration.toMatchType,
            suggestedBid: migration.suggestedBid,
            status: "pending"
          });
          migratedCount++;
        }
        return { migratedCount };
      }),
      // ==================== 半月纠错复盘 ====================
      analyzeBidCorrections: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        attributionWindowDays: external_exports.number().min(7).max(30).default(14)
      })).query(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        const bidChanges = await getBidChangeRecords(input.accountId, 30);
        const corrections = analyzeBidCorrections(bidChanges, input.attributionWindowDays);
        return {
          totalAnalyzed: bidChanges.length,
          totalCorrections: corrections.length,
          urgentCount: corrections.filter((c) => c.priority === "urgent").length,
          highCount: corrections.filter((c) => c.priority === "high").length,
          corrections: corrections.slice(0, 50),
          summary: {
            prematureDecrease: corrections.filter((c) => c.errorType === "premature_decrease").length,
            prematureIncrease: corrections.filter((c) => c.errorType === "premature_increase").length,
            overAdjustment: corrections.filter((c) => c.errorType === "over_adjustment").length,
            attributionDelay: corrections.filter((c) => c.errorType === "attribution_delay").length
          }
        };
      }),
      // 执行纠错操作
      applyCorrections: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        corrections: external_exports.array(external_exports.object({
          targetId: external_exports.number(),
          targetType: external_exports.enum(["keyword", "product"]),
          currentBid: external_exports.number(),
          suggestedBid: external_exports.number(),
          reason: external_exports.string()
        }))
      })).mutation(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        let appliedCount = 0;
        for (const correction of input.corrections) {
          await recordBidChange({
            accountId: input.accountId,
            targetId: correction.targetId,
            targetType: correction.targetType,
            oldBid: correction.currentBid,
            newBid: correction.suggestedBid,
            reason: `\u7EA0\u9519\u590D\u76D8: ${correction.reason}`
          });
          appliedCount++;
        }
        return { appliedCount };
      }),
      // ==================== 广告活动健康度监控 ====================
      // v390: 添加缓存层，避免重复计算健康分数
      // @ts-ignore
      analyzeCampaignHealth: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        acosWarning: external_exports.number().default(35),
        acosCritical: external_exports.number().default(50),
        ctrDropWarning: external_exports.number().default(-20),
        ctrDropCritical: external_exports.number().default(-40),
        cvrDropWarning: external_exports.number().default(-25),
        cvrDropCritical: external_exports.number().default(-50),
        roasMinimum: external_exports.number().default(2)
      })).query(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        const cacheKey = `health.analyze:${ctx.user.id}:${input.accountId}`;
        const cached2 = apiCache.get(cacheKey);
        if (cached2) return cached2;
        const campaigns6 = await getCampaignHealthMetrics(input.accountId);
        const healthScores = analyzeCampaignHealth(campaigns6, {
          // @ts-ignore
          acosWarning: input.acosWarning,
          acosCritical: input.acosCritical,
          ctrDropWarning: input.ctrDropWarning,
          ctrDropCritical: input.ctrDropCritical,
          cvrDropWarning: input.cvrDropWarning,
          cvrDropCritical: input.cvrDropCritical,
          roasMinimum: input.roasMinimum
        });
        const criticalCount = healthScores.filter((h) => h.status === "critical").length;
        const warningCount = healthScores.filter((h) => h.status === "warning").length;
        const healthyCount = healthScores.filter((h) => h.status === "healthy").length;
        const totalAlerts = healthScores.reduce((sum2, h) => sum2 + h.alerts.length, 0);
        const result = {
          totalCampaigns: healthScores.length,
          criticalCount,
          warningCount,
          healthyCount,
          totalAlerts,
          avgHealthScore: healthScores.length > 0 ? Math.round(healthScores.reduce((sum2, h) => sum2 + h.overallScore, 0) / healthScores.length) : 0,
          campaigns: healthScores
        };
        apiCache.set(cacheKey, result, 120 * 1e3);
        return result;
      }),
      // v390: 优化getHealthAlerts，复用analyzeCampaignHealth的缓存结果
      getHealthAlerts: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        severity: external_exports.enum(["all", "critical", "warning", "info"]).default("all")
        // @ts-ignore
      })).query(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        const healthCacheKey = `health.analyze:${ctx.user.id}:${input.accountId}`;
        let healthResult = apiCache.get(healthCacheKey);
        if (!healthResult) {
          const campaigns6 = await getCampaignHealthMetrics(input.accountId);
          const healthScores = analyzeCampaignHealth(campaigns6);
          healthResult = { campaigns: healthScores };
        }
        let allAlerts = (healthResult.campaigns || []).flatMap((h) => h.alerts || []);
        if (input.severity !== "all") {
          allAlerts = allAlerts.filter((a) => a.severity === input.severity);
        }
        const severityOrder = { critical: 0, warning: 1, info: 2 };
        allAlerts.sort((a, b) => (severityOrder[a.severity] ?? 3) - (severityOrder[b.severity] ?? 3));
        return {
          totalAlerts: allAlerts.length,
          // @ts-ignore
          criticalCount: allAlerts.filter((a) => a.severity === "critical").length,
          // @ts-ignore
          warningCount: allAlerts.filter((a) => a.severity === "warning").length,
          // @ts-ignore
          infoCount: allAlerts.filter((a) => a.severity === "info").length,
          alerts: allAlerts
        };
      }),
      // ==================== 批量操作 ====================
      validateBatchNegatives: protectedProcedure.input(external_exports.object({
        items: external_exports.array(external_exports.object({
          keyword: external_exports.string(),
          matchType: external_exports.enum(["phrase", "exact"]),
          level: external_exports.enum(["ad_group", "campaign"]),
          campaignId: external_exports.number(),
          adGroupId: external_exports.number().optional(),
          reason: external_exports.string()
        }))
      })).query(({ input }) => {
        const result = validateNegativeKeywordBatch(input.items);
        return {
          validCount: result.valid.length,
          // @ts-ignore
          invalidCount: result.invalid.length,
          valid: result.valid,
          invalid: result.invalid
        };
      }),
      validateBatchBidAdjustments: protectedProcedure.input(external_exports.object({
        items: external_exports.array(external_exports.object({
          targetId: external_exports.number(),
          targetName: external_exports.string(),
          targetType: external_exports.enum(["keyword", "product"]),
          campaignId: external_exports.number(),
          currentBid: external_exports.number(),
          newBid: external_exports.number(),
          adjustmentPercent: external_exports.number(),
          reason: external_exports.string()
        })),
        maxBid: external_exports.number().default(10),
        minBid: external_exports.number().default(0.02),
        maxAdjustmentPercent: external_exports.number().default(100)
      })).query(({ input }) => {
        const result = validateBidAdjustmentBatch(
          input.items,
          input.maxBid,
          // @ts-ignore
          input.minBid,
          input.maxAdjustmentPercent
        );
        return {
          validCount: result.valid.length,
          invalidCount: result.invalid.length,
          valid: result.valid,
          invalid: result.invalid
        };
      }),
      executeBatchNegatives: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        items: external_exports.array(external_exports.object({
          keyword: external_exports.string(),
          matchType: external_exports.enum(["phrase", "exact"]),
          level: external_exports.enum(["ad_group", "campaign"]),
          campaignId: external_exports.number(),
          adGroupId: external_exports.number().optional(),
          reason: external_exports.string()
        }))
      })).mutation(async ({ ctx, input }) => {
        const validation = validateNegativeKeywordBatch(input.items);
        let successCount = 0;
        const errors = [];
        const syncTasks = [];
        for (const item of validation.valid) {
          try {
            await addNegativeKeyword({
              campaignId: item.campaignId,
              adGroupId: item.adGroupId,
              keyword: item.keyword,
              // @ts-ignore
              matchType: item.matchType,
              level: item.level
            });
            syncTasks.push({
              accountId: input.accountId,
              taskType: "negative_keyword",
              targetEntityType: item.level === "ad_group" ? "ad_group" : "campaign",
              targetEntityId: item.campaignId,
              targetEntityName: item.keyword,
              action: item.matchType === "exact" ? "add_negative_exact" : "add_negative_phrase",
              source: "manual_batch",
              priority: "high"
            });
            successCount++;
          } catch (error48) {
            errors.push({ keyword: item.keyword, error: error48.message });
          }
        }
        if (syncTasks.length > 0) {
          try {
            const { enqueueTasks: enqueueTasks2 } = await Promise.resolve().then(() => (init_optimizationSyncEngine(), optimizationSyncEngine_exports));
            await enqueueTasks2(syncTasks);
            log178.info(`[AdAutomation] v453: \u5DF2\u5165\u961F ${syncTasks.length} \u4E2A\u5426\u5B9A\u8BCD\u540C\u6B65\u4EFB\u52A1\u5230Amazon API`);
          } catch (enqueueErr) {
            log178.warn(`[AdAutomation] v453: \u5426\u5B9A\u8BCD\u540C\u6B65\u4EFB\u52A1\u5165\u961F\u5931\u8D25: ${enqueueErr.message}`);
          }
        }
        return {
          successCount,
          failedCount: validation.invalid.length + errors.length,
          validationErrors: validation.invalid.map((i) => ({ keyword: i.item.keyword, error: i.reason })),
          executionErrors: errors
        };
      }),
      executeBatchBidAdjustments: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        items: external_exports.array(external_exports.object({
          targetId: external_exports.number(),
          targetName: external_exports.string(),
          targetType: external_exports.enum(["keyword", "product"]),
          campaignId: external_exports.number(),
          currentBid: external_exports.number(),
          newBid: external_exports.number(),
          adjustmentPercent: external_exports.number(),
          reason: external_exports.string()
        }))
      })).mutation(async ({ ctx, input }) => {
        const validation = validateBidAdjustmentBatch(input.items);
        let successCount = 0;
        const errors = [];
        const syncTasks = [];
        for (const item of validation.valid) {
          try {
            await recordBidChange({
              accountId: input.accountId,
              targetId: item.targetId,
              targetType: item.targetType,
              oldBid: item.currentBid,
              // @ts-ignore
              newBid: item.newBid,
              reason: item.reason
            });
            syncTasks.push({
              accountId: input.accountId,
              taskType: item.targetType === "keyword" ? "bid" : "product_target_bid",
              targetEntityType: item.targetType,
              targetEntityId: item.targetId,
              targetEntityName: item.targetName,
              action: "adjust_bid",
              newValue: String(item.newBid),
              oldValue: String(item.currentBid),
              source: "manual_batch",
              priority: "high"
            });
            successCount++;
          } catch (error48) {
            errors.push({ targetName: item.targetName, error: error48.message });
          }
        }
        if (syncTasks.length > 0) {
          try {
            const { enqueueTasks: enqueueTasks2 } = await Promise.resolve().then(() => (init_optimizationSyncEngine(), optimizationSyncEngine_exports));
            await enqueueTasks2(syncTasks);
            log178.info(`[AdAutomation] v453: \u5DF2\u5165\u961F ${syncTasks.length} \u4E2A\u51FA\u4EF7\u8C03\u6574\u540C\u6B65\u4EFB\u52A1\u5230Amazon API`);
          } catch (enqueueErr) {
            log178.warn(`[AdAutomation] v453: \u51FA\u4EF7\u8C03\u6574\u540C\u6B65\u4EFB\u52A1\u5165\u961F\u5931\u8D25: ${enqueueErr.message}`);
          }
        }
        return {
          successCount,
          // @ts-ignore
          failedCount: validation.invalid.length + errors.length,
          validationErrors: validation.invalid.map((i) => ({ targetName: i.item.targetName, error: i.reason })),
          executionErrors: errors
        };
      }),
      getBatchOperationSummary: protectedProcedure.input(external_exports.object({
        negativeItems: external_exports.array(external_exports.object({
          keyword: external_exports.string(),
          matchType: external_exports.enum(["phrase", "exact"]),
          level: external_exports.enum(["ad_group", "campaign"]),
          campaignId: external_exports.number(),
          adGroupId: external_exports.number().optional(),
          reason: external_exports.string()
        })),
        bidItems: external_exports.array(external_exports.object({
          targetId: external_exports.number(),
          targetName: external_exports.string(),
          targetType: external_exports.enum(["keyword", "product"]),
          campaignId: external_exports.number(),
          currentBid: external_exports.number(),
          newBid: external_exports.number(),
          adjustmentPercent: external_exports.number(),
          reason: external_exports.string()
        }))
      })).query(({ input }) => {
        return generateBatchOperationSummary(input.negativeItems, input.bidItems);
      })
    });
  }
});

