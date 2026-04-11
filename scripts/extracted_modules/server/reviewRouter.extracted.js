// Extracted from production dist/index.js
// Original module: server/reviewRouter.ts
// Lines: 263

var reviewRouter;
var init_reviewRouter = __esm({
  "server/reviewRouter.ts"() {
    "use strict";
    init_zod();
    init_trpc();
    init_ngramAnalysis();
    init_trafficMigration();
    reviewRouter = router({
      // ==================== N-Gram否词审核 ====================
      /**
       * 获取N-Gram分析摘要
       */
      getNgramSummary: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        campaignIds: external_exports.array(external_exports.number()).optional(),
        days: external_exports.number().default(30)
      })).query(async ({ input }) => {
        return await getNgramAnalysisSummary(input.accountId, input.campaignIds, input.days);
      }),
      /**
       * 获取否词建议列表（供审核）
       */
      getNegativeSuggestions: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        campaignIds: external_exports.array(external_exports.number()).optional(),
        days: external_exports.number().default(30)
        // @ts-ignore
      })).query(async ({ input }) => {
        return await generateNegativeKeywordSuggestions(input.accountId, input.campaignIds, input.days);
      }),
      /**
       * 获取N-Gram详细分析报告
       */
      getNgramAnalysisReport: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        campaignIds: external_exports.array(external_exports.number()).optional(),
        // @ts-ignore
        days: external_exports.number().default(30)
      })).query(async ({ input }) => {
        return await generateNgramAnalysisReport(input.accountId, input.campaignIds, input.days);
      }),
      /**
       * 批量审核否词建议
       */
      reviewNegativeSuggestions: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        campaignId: external_exports.number(),
        adGroupId: external_exports.number().nullable(),
        decisions: external_exports.array(external_exports.object({
          ngram: external_exports.string(),
          matchType: external_exports.enum(["phrase", "exact"]),
          // @ts-ignore
          action: external_exports.enum(["accept", "reject"])
        }))
      })).mutation(async ({ input, ctx }) => {
        const accepted = input.decisions.filter((d) => d.action === "accept");
        const rejected = input.decisions.filter((d) => d.action === "reject");
        let addedCount = 0;
        const errors = [];
        if (accepted.length > 0) {
          const result = await executeNegativeKeywords(
            input.accountId,
            input.campaignId,
            input.adGroupId,
            // @ts-expect-error - array method type inference
            accepted.map((a) => ({ keyword: a.ngram, matchType: a.matchType }))
          );
          addedCount = result.addedCount;
          errors.push(...result.errors);
        }
        return {
          success: errors.length === 0,
          acceptedCount: accepted.length,
          rejectedCount: rejected.length,
          addedCount,
          errors
        };
      }),
      /**
       * 一键接受全部否词建议
       */
      acceptAllNegativeSuggestions: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        // @ts-ignore
        campaignId: external_exports.number(),
        adGroupId: external_exports.number().nullable(),
        days: external_exports.number().default(30)
      })).mutation(async ({ input }) => {
        const suggestions = await generateNegativeKeywordSuggestions(
          input.accountId,
          [input.campaignId],
          input.days
        );
        const result = await executeNegativeKeywords(
          input.accountId,
          input.campaignId,
          input.adGroupId,
          suggestions.map((s) => ({ keyword: s.ngram, matchType: s.matchType }))
        );
        return {
          success: result.success,
          totalSuggestions: suggestions.length,
          addedCount: result.addedCount,
          errors: result.errors
        };
      }),
      // ==================== 流量迁移审核 ====================
      /**
       * 获取迁移摘要
       */
      getMigrationSummary: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        campaignIds: external_exports.array(external_exports.number()).optional(),
        days: external_exports.number().default(30)
      })).query(async ({ input }) => {
        return await getMigrationSummary(input.accountId, input.campaignIds, input.days);
      }),
      /**
       * 获取迁移建议列表（供审核）
       */
      getMigrationSuggestions: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        campaignIds: external_exports.array(external_exports.number()).optional(),
        days: external_exports.number().default(30),
        targetRoas: external_exports.number().default(3)
      })).query(async ({ input }) => {
        return await generateMigrationSuggestions(
          input.accountId,
          input.campaignIds,
          input.days,
          input.targetRoas
        );
      }),
      /**
       * 获取流量冲突列表（供审核）
       */
      getTrafficConflicts: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        campaignIds: external_exports.array(external_exports.number()).optional(),
        days: external_exports.number().default(30)
      })).query(async ({ input }) => {
        return await detectTrafficConflicts3(input.accountId, input.campaignIds, input.days);
      }),
      /**
       * 批量审核迁移建议
       */
      reviewMigrationSuggestions: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        decisions: external_exports.array(external_exports.object({
          searchTerm: external_exports.string(),
          sourceCampaignId: external_exports.number(),
          action: external_exports.enum(["accept", "reject"])
        }))
      })).mutation(async ({ input }) => {
        const accepted = input.decisions.filter((d) => d.action === "accept");
        const rejected = input.decisions.filter((d) => d.action === "reject");
        let addedCount = 0;
        const errors = [];
        if (accepted.length > 0) {
          const result = await executeTrafficIsolation(
            input.accountId,
            // @ts-expect-error - array method type inference
            accepted.map((a) => ({
              searchTerm: a.searchTerm,
              campaignId: a.sourceCampaignId
            }))
          );
          addedCount = result.addedCount;
          errors.push(...result.errors);
        }
        return {
          success: errors.length === 0,
          acceptedCount: accepted.length,
          rejectedCount: rejected.length,
          addedCount,
          errors
        };
      }),
      /**
       * 批量审核冲突消解建议
       */
      reviewConflictResolutions: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        decisions: external_exports.array(external_exports.object({
          searchTerm: external_exports.string(),
          winnerCampaignId: external_exports.number(),
          loserCampaignIds: external_exports.array(external_exports.number()),
          action: external_exports.enum(["accept", "reject"])
        }))
      })).mutation(async ({ input }) => {
        const accepted = input.decisions.filter((d) => d.action === "accept");
        const rejected = input.decisions.filter((d) => d.action === "reject");
        let addedCount = 0;
        const errors = [];
        for (const decision of accepted) {
          const result = await executeTrafficIsolation(
            input.accountId,
            // @ts-expect-error - array method type inference
            decision.loserCampaignIds.map((campaignId) => ({
              searchTerm: decision.searchTerm,
              campaignId
            }))
          );
          addedCount += result.addedCount;
          errors.push(...result.errors);
        }
        return {
          success: errors.length === 0,
          acceptedCount: accepted.length,
          rejectedCount: rejected.length,
          addedCount,
          errors
        };
      }),
      /**
       * 一键接受全部冲突消解建议
       */
      acceptAllConflictResolutions: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        campaignIds: external_exports.array(external_exports.number()).optional(),
        days: external_exports.number().default(30)
      })).mutation(async ({ input }) => {
        const conflicts = await detectTrafficConflicts3(
          input.accountId,
          input.campaignIds,
          input.days
        );
        let addedCount = 0;
        const errors = [];
        for (const conflict of conflicts) {
          const result = await executeTrafficIsolation(
            input.accountId,
            conflict.losers.map((loser) => ({
              searchTerm: conflict.searchTerm,
              campaignId: loser.campaignId
            }))
          );
          addedCount += result.addedCount;
          errors.push(...result.errors);
        }
        return {
          success: errors.length === 0,
          totalConflicts: conflicts.length,
          addedCount,
          errors
        };
      }),
      // ==================== 审核历史 ====================
      /**
       * 获取审核历史
       */
      getReviewHistory: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        type: external_exports.enum(["negative", "migration", "conflict"]).optional(),
        limit: external_exports.number().default(50)
      })).query(async ({ input }) => {
        return [];
      })
    });
  }
});

