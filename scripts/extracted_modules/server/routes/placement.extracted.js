// Extracted from production dist/index.js
// Original module: server/routes/placement.ts
// Lines: 1286

var log163, placementRouter;
var init_placement = __esm({
  "server/routes/placement.ts"() {
    "use strict";
    init_trpc();
    init_zod();
    init_dist();
    init_db2();
    init_marginalBenefitAnalysisService();
    init_placementOptimizationService();
    init_drizzle_orm();
    init_schema2();
    init_advancedPlacementService();
    init_marketCurveService();
    init_decisionTreeService();
    init_logger();
    init_accessControl();
    log163 = createModuleLogger("Route_placement");
    placementRouter = router({
      // 获取广告活动的位置表现数据
      getPerformance: protectedProcedure.input(external_exports.object({
        campaignId: external_exports.string(),
        accountId: external_exports.number(),
        days: external_exports.number().default(7)
      })).query(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        return getCampaignPlacementPerformance(
          input.campaignId,
          input.accountId,
          input.days
        );
      }),
      // 获取广告活动的位置倾斜设置
      getSettings: protectedProcedure.input(external_exports.object({
        campaignId: external_exports.string(),
        accountId: external_exports.number()
        // @ts-ignore
      })).query(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        return getCampaignPlacementSettings(
          input.campaignId,
          input.accountId
        );
      }),
      // 生成位置倾斜建议
      generateSuggestions: protectedProcedure.input(external_exports.object({
        campaignId: external_exports.string(),
        accountId: external_exports.number(),
        // @ts-ignore
        days: external_exports.number().default(7)
      })).mutation(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        const performance = await getCampaignPlacementPerformance(
          input.campaignId,
          input.accountId,
          input.days
        );
        const currentSettings = await getCampaignPlacementSettings(
          input.campaignId,
          input.accountId
        );
        const suggestions = await calculateOptimalAdjustment(
          performance,
          currentSettings,
          input.campaignId,
          input.accountId
        );
        let marginalBenefitInsights = null;
        try {
          const marginalBenefits = {};
          for (const p of performance) {
            const placementType = p.placementType;
            const currentAdjustment = currentSettings?.[placementType] || 0;
            const benefit = calculateMarginalBenefitSimple(
              p.metrics || { impressions: 0, clicks: 0, spend: 0, sales: 0, orders: 0, ctr: 0, cvr: 0, cpc: 0, acos: 0, roas: 0 },
              currentAdjustment
            );
            marginalBenefits[placementType] = {
              ...benefit,
              currentAdjustment
            };
          }
          const optimizationResult = optimizeTrafficAllocationSimple(
            // @ts-ignore
            marginalBenefits,
            {
              top_of_search: currentSettings?.top_of_search || 0,
              product_page: currentSettings?.product_page || 0,
              rest_of_search: currentSettings?.rest_of_search || 0
            },
            "balanced"
          );
          marginalBenefitInsights = {
            marginalBenefits,
            optimizationResult
          };
        } catch (e) {
          log163.warn("[generateSuggestions] \u8FB9\u9645\u6548\u76CA\u5206\u6790\u5931\u8D25:", e);
        }
        return {
          performance,
          currentSettings,
          suggestions,
          marginalBenefitInsights
        };
      }),
      // 应用位置倾斜调整
      applyAdjustments: protectedProcedure.input(external_exports.object({
        campaignId: external_exports.string(),
        accountId: external_exports.number(),
        adjustments: external_exports.array(external_exports.object({
          placementType: external_exports.enum(["top_of_search", "product_page", "rest_of_search"]),
          currentAdjustment: external_exports.number(),
          suggestedAdjustment: external_exports.number(),
          adjustmentDelta: external_exports.number(),
          efficiencyScore: external_exports.number(),
          confidence: external_exports.number(),
          // 0-1的置信度数值
          isReliable: external_exports.boolean().optional().default(true),
          // V2新增：数据是否可靠
          reason: external_exports.string(),
          cooldownStatus: external_exports.object({
            inCooldown: external_exports.boolean(),
            lastAdjustmentDate: external_exports.date().optional(),
            // @ts-ignore
            daysRemaining: external_exports.number().optional()
          }).optional()
          // V2新增：冷却期状态
        }))
      })).mutation(async ({ ctx, input }) => {
        await updatePlacementSettings(
          input.campaignId,
          input.accountId,
          input.adjustments
        );
        return { success: true };
      }),
      // 执行单个广告活动的位置优化
      // @ts-ignore
      optimizeCampaign: protectedProcedure.input(external_exports.object({
        campaignId: external_exports.string(),
        accountId: external_exports.number()
      })).mutation(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        return executeAutomaticPlacementOptimization(
          input.campaignId,
          input.accountId
        );
      }),
      // 批量执行位置优化
      batchOptimize: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        campaignIds: external_exports.array(external_exports.string()).optional()
      })).mutation(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        return batchExecutePlacementOptimization(
          input.accountId,
          input.campaignIds
        );
      }),
      // 获取位置调整历史记录
      getHistory: protectedProcedure.input(external_exports.object({
        campaignId: external_exports.string().optional(),
        accountId: external_exports.number(),
        limit: external_exports.number().default(50)
      })).query(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        return [];
      }),
      // ==================== 高级位置优化（智能优化算法整合）====================
      // 分析广告活动的位置利润优化
      analyzeProfitOptimization: protectedProcedure.input(external_exports.object({
        campaignId: external_exports.string(),
        accountId: external_exports.number()
      })).query(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        return analyzeCampaignPlacementProfit(
          input.accountId,
          input.campaignId
        );
      }),
      // 分析单个竞价对象的利润
      analyzeBidObjectProfit: protectedProcedure.input(external_exports.object({
        // @ts-ignore
        accountId: external_exports.number(),
        campaignId: external_exports.string(),
        bidObjectType: external_exports.enum(["keyword", "asin"]),
        bidObjectId: external_exports.string(),
        bidObjectText: external_exports.string(),
        currentBaseBid: external_exports.number(),
        currentTopAdjustment: external_exports.number().default(0),
        currentProductAdjustment: external_exports.number().default(0)
      })).query(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        return analyzeBidObjectProfit(
          input.accountId,
          input.campaignId,
          input.bidObjectType,
          input.bidObjectId,
          input.bidObjectText,
          input.currentBaseBid,
          input.currentTopAdjustment,
          // @ts-ignore
          input.currentProductAdjustment
        );
      }),
      // 获取待处理的优化建议
      getPendingRecommendations: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        campaignId: external_exports.string().optional()
      })).query(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        return getPendingRecommendations(
          input.accountId,
          input.campaignId
        );
      }),
      // 应用优化建议
      applyRecommendation: protectedProcedure.input(external_exports.object({
        recommendationId: external_exports.number()
      })).mutation(async ({ input, ctx }) => {
        return applyOptimizationRecommendation(
          // @ts-ignore
          input.recommendationId,
          ctx.user.id
        );
      }),
      // 生成利润曲线可视化数据
      getProfitCurveData: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        bidObjectType: external_exports.enum(["keyword", "asin"]),
        bidObjectId: external_exports.string()
      })).query(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        return generateProfitVisualizationData(
          input.accountId,
          input.bidObjectType,
          input.bidObjectId
          // @ts-ignore
        );
      }),
      // ==================== 市场曲线相关 ====================
      // 构建关键词的市场曲线模型
      buildMarketCurve: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        campaignId: external_exports.string(),
        keywordId: external_exports.number(),
        daysBack: external_exports.number().default(30)
      })).mutation(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        const model = await buildMarketCurveForKeyword(
          input.accountId,
          // @ts-ignore
          input.campaignId,
          input.keywordId,
          input.daysBack
        );
        return model;
      }),
      // 获取市场曲线模型
      getMarketCurve: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        bidObjectType: external_exports.enum(["keyword", "asin", "audience"]),
        bidObjectId: external_exports.string()
      })).query(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        return getMarketCurveModel(
          input.accountId,
          input.bidObjectType,
          input.bidObjectId
        );
      }),
      // 批量更新市场曲线模型
      updateAllMarketCurves: protectedProcedure.input(external_exports.object({
        // @ts-ignore
        accountId: external_exports.number()
      })).mutation(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        return updateAllMarketCurveModels(input.accountId);
      }),
      // ==================== 决策树相关 ====================
      // 训练决策树模型
      trainDecisionTree: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        modelType: external_exports.enum(["cr_prediction", "cv_prediction"])
      })).mutation(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        const result = await trainDecisionTreeModel(
          input.accountId,
          input.modelType
        );
        const modelId = await saveDecisionTreeModel(
          input.accountId,
          input.modelType,
          result
        );
        return {
          modelId,
          // @ts-ignore
          depth: result.depth,
          leafCount: result.leafCount,
          trainingR2: result.trainingR2,
          totalSamples: result.totalSamples,
          featureImportance: result.featureImportance
        };
      }),
      // 预测关键词表现
      predictKeywordPerformance: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        matchType: external_exports.enum(["broad", "phrase", "exact"]),
        wordCount: external_exports.number(),
        keywordType: external_exports.enum(["brand", "competitor", "generic", "product"]),
        avgBid: external_exports.number()
      })).query(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        return predictKeywordPerformance(
          input.accountId,
          {
            matchType: input.matchType,
            wordCount: input.wordCount,
            keywordType: input.keywordType,
            avgBid: input.avgBid
          }
          // @ts-ignore
        );
      }),
      // 批量预测并保存关键词预测结果
      batchPredictKeywords: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number()
      })).mutation(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        return batchPredictAndSaveKeywords(input.accountId);
      }),
      // 获取关键词预测摘要
      getKeywordPredictionSummary: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number()
      })).query(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        return getKeywordPredictionSummary(input.accountId);
      }),
      // ==================== 利润最大化出价点实时计算 ====================
      // 获取广告活动的利润最大化出价点
      getCampaignOptimalBids: protectedProcedure.input(external_exports.object({
        campaignId: external_exports.string(),
        accountId: external_exports.number()
      })).query(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        const campaignKeywords = await getKeywordsByCampaignId(input.campaignId);
        const results = [];
        for (const keyword of campaignKeywords) {
          const marketCurve = await getMarketCurveModel(
            input.accountId,
            "keyword",
            String(keyword.id)
          );
          if (marketCurve) {
            const optimalBid = calculateOptimalBid2(
              // @ts-expect-error - type assertion
              marketCurve.impressionCurve,
              marketCurve.ctrCurve,
              marketCurve.conversion
            );
            results.push({
              // @ts-ignore
              keywordId: keyword.id,
              // @ts-ignore
              keywordText: keyword.keywordText,
              matchType: keyword.matchType,
              currentBid: Number(keyword.bid) || 0,
              optimalBid: optimalBid.optimalBid,
              maxProfit: optimalBid.maxProfit,
              profitMargin: optimalBid.profitMargin,
              breakEvenCpc: optimalBid.breakEvenCpc,
              bidDifference: optimalBid.optimalBid - (Number(keyword.bid) || 0),
              bidDifferencePercent: keyword.bid ? (optimalBid.optimalBid - Number(keyword.bid)) / Number(keyword.bid) * 100 : 0,
              recommendation: optimalBid.optimalBid > (Number(keyword.bid) || 0) ? "increase" : optimalBid.optimalBid < (Number(keyword.bid) || 0) ? "decrease" : "maintain"
            });
          }
        }
        const summary = {
          totalKeywords: campaignKeywords.length,
          // @ts-ignore
          analyzedKeywords: results.length,
          // @ts-ignore
          avgOptimalBid: results.length > 0 ? results.reduce((sum2, r) => sum2 + r.optimalBid, 0) / results.length : 0,
          // @ts-ignore
          avgCurrentBid: results.length > 0 ? results.reduce((sum2, r) => sum2 + r.currentBid, 0) / results.length : 0,
          // @ts-ignore
          totalMaxProfit: results.reduce((sum2, r) => sum2 + r.maxProfit, 0),
          keywordsNeedIncrease: results.filter((r) => r.recommendation === "increase").length,
          keywordsNeedDecrease: results.filter((r) => r.recommendation === "decrease").length,
          keywordsMaintain: results.filter((r) => r.recommendation === "maintain").length
        };
        return {
          summary,
          keywords: results
        };
      }),
      // 获取绩效组的利润最大化出价点汇总
      getPerformanceGroupOptimalBids: protectedProcedure.input(external_exports.object({
        groupId: external_exports.number(),
        accountId: external_exports.number()
      })).query(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        const group = await getPerformanceGroupById(input.groupId);
        if (!group) {
          throw new TRPCError({ code: "NOT_FOUND", message: "\u7EE9\u6548\u7EC4\u4E0D\u5B58\u5728" });
        }
        const groupCampaigns = await getCampaignsByPerformanceGroupId(input.groupId);
        const campaignResults = [];
        let totalAnalyzedKeywords = 0;
        let totalMaxProfit = 0;
        let totalKeywordsNeedIncrease = 0;
        let totalKeywordsNeedDecrease = 0;
        for (const gc of groupCampaigns) {
          const campaign = gc;
          if (!campaign) continue;
          const campaignKeywords = await getKeywordsByCampaignId(campaign.campaignId);
          let campaignOptimalBidSum = 0;
          let campaignCurrentBidSum = 0;
          let campaignMaxProfit = 0;
          let analyzedCount = 0;
          let needIncrease = 0;
          let needDecrease = 0;
          for (const keyword of campaignKeywords) {
            const marketCurve = await getMarketCurveModel(
              input.accountId,
              "keyword",
              String(keyword.id)
            );
            if (marketCurve) {
              const optimalBid = calculateOptimalBid2(
                // @ts-expect-error - type assertion
                marketCurve.impressionCurve,
                marketCurve.ctrCurve,
                marketCurve.conversion
              );
              campaignOptimalBidSum += optimalBid.optimalBid;
              campaignCurrentBidSum += Number(keyword.bid) || 0;
              campaignMaxProfit += optimalBid.maxProfit;
              analyzedCount++;
              if (optimalBid.optimalBid > (Number(keyword.bid) || 0) * 1.05) needIncrease++;
              else if (optimalBid.optimalBid < (Number(keyword.bid) || 0) * 0.95) needDecrease++;
            }
          }
          if (analyzedCount > 0) {
            campaignResults.push({
              campaignId: gc.campaignId,
              campaignName: campaign.campaignName,
              totalKeywords: campaignKeywords.length,
              // @ts-ignore
              analyzedKeywords: analyzedCount,
              avgOptimalBid: campaignOptimalBidSum / analyzedCount,
              avgCurrentBid: campaignCurrentBidSum / analyzedCount,
              maxProfit: campaignMaxProfit,
              keywordsNeedIncrease: needIncrease,
              keywordsNeedDecrease: needDecrease,
              optimizationScore: Math.round((1 - Math.abs(campaignOptimalBidSum - campaignCurrentBidSum) / Math.max(campaignOptimalBidSum, 1)) * 100)
            });
            totalAnalyzedKeywords += analyzedCount;
            totalMaxProfit += campaignMaxProfit;
            totalKeywordsNeedIncrease += needIncrease;
            totalKeywordsNeedDecrease += needDecrease;
          }
        }
        const groupSummary = {
          groupId: input.groupId,
          groupName: group.name,
          totalCampaigns: groupCampaigns.length,
          analyzedCampaigns: campaignResults.length,
          // @ts-ignore
          totalAnalyzedKeywords,
          totalMaxProfit: Math.round(totalMaxProfit * 100) / 100,
          avgOptimizationScore: campaignResults.length > 0 ? Math.round(campaignResults.reduce((sum2, c) => sum2 + c.optimizationScore, 0) / campaignResults.length) : 0,
          keywordsNeedIncrease: totalKeywordsNeedIncrease,
          keywordsNeedDecrease: totalKeywordsNeedDecrease,
          overallRecommendation: totalKeywordsNeedIncrease > totalKeywordsNeedDecrease ? "increase_bids" : totalKeywordsNeedDecrease > totalKeywordsNeedIncrease ? "decrease_bids" : "maintain"
        };
        return {
          summary: groupSummary,
          campaigns: campaignResults
        };
      }),
      // 一键应用广告活动的最优出价
      applyCampaignOptimalBids: protectedProcedure.input(external_exports.object({
        campaignId: external_exports.string(),
        accountId: external_exports.number(),
        keywordIds: external_exports.array(external_exports.number()).optional(),
        // 可选，指定要应用的关键词，不指定则应用所有
        minBidDifferencePercent: external_exports.number().default(5)
        // 最小差距百分比，低于此值不调整
      })).mutation(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        const campaignKeywords = await getKeywordsByCampaignId(input.campaignId);
        const keywordsToProcess = input.keywordIds ? campaignKeywords.filter((k) => input.keywordIds.includes(k.id)) : campaignKeywords;
        const adjustments = [];
        let appliedCount = 0;
        let skippedCount = 0;
        let errorCount = 0;
        let totalExpectedProfitIncrease = 0;
        for (const keyword of keywordsToProcess) {
          try {
            const marketCurve = await getMarketCurveModel(
              input.accountId,
              "keyword",
              String(keyword.id)
            );
            if (!marketCurve) {
              adjustments.push({
                keywordId: keyword.id,
                keywordText: keyword.keywordText || "",
                oldBid: Number(keyword.bid) || 0,
                newBid: Number(keyword.bid) || 0,
                bidChange: 0,
                bidChangePercent: 0,
                expectedProfitIncrease: 0,
                status: "skipped",
                reason: "\u65E0\u5E02\u573A\u66F2\u7EBF\u6570\u636E"
              });
              skippedCount++;
              continue;
            }
            const optimalBid = calculateOptimalBid2(
              // @ts-expect-error - type assertion
              marketCurve.impressionCurve,
              marketCurve.ctrCurve,
              marketCurve.conversion
            );
            const currentBid = Number(keyword.bid) || 0;
            const bidDifferencePercent = currentBid > 0 ? Math.abs((optimalBid.optimalBid - currentBid) / currentBid * 100) : 100;
            if (bidDifferencePercent < input.minBidDifferencePercent) {
              adjustments.push({
                keywordId: keyword.id,
                keywordText: keyword.keywordText || "",
                oldBid: currentBid,
                newBid: currentBid,
                bidChange: 0,
                bidChangePercent: 0,
                expectedProfitIncrease: 0,
                status: "skipped",
                reason: `\u5DEE\u8DDD\u4EC5${bidDifferencePercent.toFixed(1)}%\uFF0C\u4F4E\u4E8E\u9608\u503C${input.minBidDifferencePercent}%`
              });
              skippedCount++;
              continue;
            }
            const newBid = Math.round(optimalBid.optimalBid * 100) / 100;
            await updateKeywordBid(keyword.id, newBid);
            const bidChange = newBid - currentBid;
            const expectedProfitIncrease = optimalBid.maxProfit * 0.1;
            adjustments.push({
              keywordId: keyword.id,
              keywordText: keyword.keywordText || "",
              oldBid: currentBid,
              newBid,
              bidChange,
              bidChangePercent: currentBid > 0 ? bidChange / currentBid * 100 : 0,
              expectedProfitIncrease,
              status: "applied"
            });
            appliedCount++;
            totalExpectedProfitIncrease += expectedProfitIncrease;
            await recordBidAdjustment({
              accountId: input.accountId,
              campaignId: parseInt(input.campaignId),
              keywordId: keyword.id,
              keywordText: keyword.keywordText || "",
              matchType: keyword.matchType || "",
              previousBid: currentBid,
              newBid,
              adjustmentType: "auto_optimal",
              adjustmentReason: "\u5229\u6DA6\u6700\u5927\u5316\u51FA\u4EF7\u70B9\u4F18\u5316",
              expectedProfitIncrease,
              appliedBy: String(ctx.user.id),
              status: "applied"
            });
          } catch (error48) {
            adjustments.push({
              keywordId: keyword.id,
              keywordText: keyword.keywordText || "",
              oldBid: Number(keyword.bid) || 0,
              newBid: Number(keyword.bid) || 0,
              bidChange: 0,
              bidChangePercent: 0,
              expectedProfitIncrease: 0,
              status: "error",
              reason: error48 instanceof Error ? error48.message : "\u672A\u77E5\u9519\u8BEF"
              // @ts-ignore
            });
            errorCount++;
          }
        }
        return {
          success: true,
          summary: {
            totalKeywords: keywordsToProcess.length,
            appliedCount,
            skippedCount,
            errorCount,
            totalExpectedProfitIncrease: Math.round(totalExpectedProfitIncrease * 100) / 100
          },
          adjustments,
          appliedAt: (/* @__PURE__ */ new Date()).toISOString(),
          appliedBy: ctx.user.id
        };
      }),
      // 一键应用绩效组的所有最优出价
      applyGroupOptimalBids: protectedProcedure.input(external_exports.object({
        groupId: external_exports.number(),
        accountId: external_exports.number(),
        minBidDifferencePercent: external_exports.number().default(5)
      })).mutation(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        const group = await getPerformanceGroupById(input.groupId);
        if (!group) {
          throw new TRPCError({ code: "NOT_FOUND", message: "\u7EE9\u6548\u7EC4\u4E0D\u5B58\u5728" });
        }
        const groupCampaigns = await getCampaignsByPerformanceGroupId(input.groupId);
        const campaignResults = [];
        let totalApplied = 0;
        let totalSkipped = 0;
        let totalErrors = 0;
        let totalProfitIncrease = 0;
        for (const gc of groupCampaigns) {
          const campaign = gc;
          if (!campaign) continue;
          const campaignKeywords = await getKeywordsByCampaignId(campaign.campaignId);
          let appliedCount = 0;
          let skippedCount = 0;
          let errorCount = 0;
          let campaignProfitIncrease = 0;
          for (const keyword of campaignKeywords) {
            try {
              const marketCurve = await getMarketCurveModel(
                input.accountId,
                "keyword",
                String(keyword.id)
              );
              if (!marketCurve) {
                skippedCount++;
                continue;
              }
              const optimalBid = calculateOptimalBid2(
                // @ts-expect-error - type assertion
                marketCurve.impressionCurve,
                marketCurve.ctrCurve,
                marketCurve.conversion
              );
              const currentBid = Number(keyword.bid) || 0;
              const bidDifferencePercent = currentBid > 0 ? Math.abs((optimalBid.optimalBid - currentBid) / currentBid * 100) : 100;
              if (bidDifferencePercent < input.minBidDifferencePercent) {
                skippedCount++;
                continue;
              }
              const newBid = Math.round(optimalBid.optimalBid * 100) / 100;
              await updateKeywordBid(keyword.id, newBid);
              appliedCount++;
              campaignProfitIncrease += optimalBid.maxProfit * 0.1;
              await recordBidAdjustment({
                accountId: input.accountId,
                campaignId: parseInt(gc.campaignId),
                campaignName: campaign.campaignName,
                performanceGroupId: input.groupId,
                performanceGroupName: group.name,
                keywordId: keyword.id,
                keywordText: keyword.keywordText || "",
                matchType: keyword.matchType || "",
                previousBid: currentBid,
                newBid,
                adjustmentType: "batch_group",
                adjustmentReason: "\u7EE9\u6548\u7EC4\u6279\u91CF\u5229\u6DA6\u6700\u5927\u5316\u4F18\u5316",
                expectedProfitIncrease: optimalBid.maxProfit * 0.1,
                appliedBy: String(ctx.user.id),
                status: "applied"
              });
            } catch (error48) {
              errorCount++;
            }
          }
          campaignResults.push({
            campaignId: gc.campaignId,
            campaignName: campaign.campaignName,
            appliedCount,
            skippedCount,
            errorCount,
            totalExpectedProfitIncrease: Math.round(campaignProfitIncrease * 100) / 100
          });
          totalApplied += appliedCount;
          totalSkipped += skippedCount;
          totalErrors += errorCount;
          totalProfitIncrease += campaignProfitIncrease;
        }
        return {
          success: true,
          // @ts-ignore
          groupId: input.groupId,
          groupName: group.name,
          summary: {
            totalCampaigns: groupCampaigns.length,
            processedCampaigns: campaignResults.length,
            totalApplied,
            totalSkipped,
            totalErrors,
            totalExpectedProfitIncrease: Math.round(totalProfitIncrease * 100) / 100
          },
          campaigns: campaignResults,
          appliedAt: (/* @__PURE__ */ new Date()).toISOString(),
          appliedBy: ctx.user.id
        };
      }),
      // 获取出价调整历史记录
      getBidAdjustmentHistory: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        campaignId: external_exports.number().optional(),
        performanceGroupId: external_exports.number().optional(),
        adjustmentType: external_exports.enum(["manual", "auto_optimal", "auto_dayparting", "auto_placement", "batch_campaign", "batch_group"]).optional(),
        startDate: external_exports.string().optional(),
        endDate: external_exports.string().optional(),
        page: external_exports.number().default(1),
        pageSize: external_exports.number().default(50)
      })).query(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        const result = await getOptimizationEvents({
          accountId: input.accountId,
          performanceGroupId: input.performanceGroupId,
          // @ts-ignore
          eventCategory: "bid_adjustment",
          campaignId: input.campaignId,
          startDate: input.startDate,
          endDate: input.endDate,
          limit: input.pageSize,
          offset: (input.page - 1) * input.pageSize
        });
        return {
          records: result.events.map((e) => ({
            ...e,
            appliedAt: e.createdAt,
            adjustmentType: e.adjustmentType || e.actionType,
            adjustmentReason: e.changeReason,
            status: e.status === "success" ? "applied" : e.status
          })),
          total: result.total,
          // @ts-ignore
          page: input.page,
          pageSize: input.pageSize,
          totalPages: Math.ceil(result.total / input.pageSize)
        };
      }),
      // 获取出价调整历史统计 - v146: 重定向到统一事件表
      getBidAdjustmentStats: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        days: external_exports.number().default(30)
      })).query(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        return getOptimizationEventStats({
          accountId: input.accountId,
          days: input.days
        });
      }),
      // 快速计算单个关键词的最优出价点
      calculateKeywordOptimalBid: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        keywordId: external_exports.number(),
        // 如果没有市场曲线模型，可以使用默认参数
        cvr: external_exports.number().optional(),
        aov: external_exports.number().optional()
      })).query(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        const marketCurve = await getMarketCurveModel(
          input.accountId,
          "keyword",
          String(input.keywordId)
        );
        if (marketCurve) {
          const optimalBid2 = calculateOptimalBid2(
            // @ts-expect-error - type assertion
            marketCurve.impressionCurve,
            marketCurve.ctrCurve,
            marketCurve.conversion
          );
          return {
            // @ts-ignore
            hasModel: true,
            ...optimalBid2
          };
        }
        const cvr = input.cvr || 0.05;
        const aov = input.aov || 30;
        const defaultImpressionCurve = { a: 1e3, b: 0.5, c: 500, r2: 0.8 };
        const defaultCtrCurve = { baseCtr: 0.01, positionBonus: 0.5, topSearchCtrBonus: 0.3 };
        const defaultConversion = { cvr, aov, conversionDelayDays: 7 };
        const optimalBid = calculateOptimalBid2(
          defaultImpressionCurve,
          defaultCtrCurve,
          defaultConversion
        );
        return {
          hasModel: false,
          // @ts-ignore
          ...optimalBid,
          note: "\u4F7F\u7528\u9ED8\u8BA4\u53C2\u6570\u8BA1\u7B97\uFF0C\u5EFA\u8BAE\u6784\u5EFA\u5E02\u573A\u66F2\u7EBF\u6A21\u578B\u4EE5\u83B7\u53D6\u66F4\u7CBE\u786E\u7684\u7ED3\u679C"
        };
      }),
      // 回滚出价调整
      rollbackBidAdjustment: protectedProcedure.input(external_exports.object({
        adjustmentId: external_exports.number()
      })).mutation(async ({ input, ctx }) => {
        return rollbackOptimizationEvent(input.adjustmentId, ctx.user.name || ctx.user.openId);
      }),
      // 获取单条调整记录详情 - v146: 从统一事件表查询
      getBidAdjustmentById: protectedProcedure.input(external_exports.object({
        adjustmentId: external_exports.number()
      })).query(async ({ ctx, input }) => {
        const result = await getOptimizationEvents({ limit: 1, offset: 0 });
        return result.events.find((e) => e.id === input.adjustmentId) || null;
      }),
      // 获取效果追踪统计 - v146: 重定向到统一事件表
      getBidAdjustmentTrackingStats: protectedProcedure.input(external_exports.object({
        // @ts-ignore
        accountId: external_exports.number(),
        days: external_exports.number().default(30)
      })).query(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        return getOptimizationEventStats({
          accountId: input.accountId,
          days: input.days
        });
      }),
      // 批量导入出价调整历史
      importBidAdjustmentHistory: protectedProcedure.input(external_exports.object({
        // @ts-ignore
        accountId: external_exports.number(),
        records: external_exports.array(external_exports.object({
          campaignId: external_exports.number().optional(),
          campaignName: external_exports.string().optional(),
          performanceGroupId: external_exports.number().optional(),
          performanceGroupName: external_exports.string().optional(),
          keywordId: external_exports.number().optional(),
          keywordText: external_exports.string().optional(),
          matchType: external_exports.string().optional(),
          previousBid: external_exports.number(),
          newBid: external_exports.number(),
          adjustmentType: external_exports.enum(["manual", "auto_optimal", "auto_dayparting", "auto_placement", "batch_campaign", "batch_group"]).default("manual"),
          adjustmentReason: external_exports.string().optional(),
          expectedProfitIncrease: external_exports.number().optional(),
          appliedBy: external_exports.string().optional(),
          appliedAt: external_exports.string().optional(),
          status: external_exports.enum(["applied", "pending", "failed", "rolled_back"]).default("applied")
        }))
      })).mutation(async ({ input, ctx }) => {
        const recordsWithAccount = input.records.map((r) => ({
          ...r,
          accountId: input.accountId,
          appliedBy: r.appliedBy || ctx.user.name || ctx.user.openId
        }));
        return importBidAdjustmentHistory(recordsWithAccount);
      }),
      // 获取需要效果追踪的调整记录
      getAdjustmentsNeedingTracking: protectedProcedure.input(external_exports.object({
        daysAgo: external_exports.number().default(7)
      })).query(async ({ ctx, input }) => {
        return getAdjustmentsNeedingTracking(input.daysAgo);
      }),
      // 更新效果追踪数据
      updateBidAdjustmentTracking: protectedProcedure.input(external_exports.object({
        adjustmentId: external_exports.number(),
        trackingData: external_exports.object({
          actualProfit7D: external_exports.number().optional(),
          actualProfit14D: external_exports.number().optional(),
          actualProfit30D: external_exports.number().optional(),
          actualImpressions7d: external_exports.number().optional(),
          actualClicks7d: external_exports.number().optional(),
          actualConversions7d: external_exports.number().optional(),
          actualSpend7D: external_exports.number().optional(),
          actualRevenue7D: external_exports.number().optional()
        })
      })).mutation(async ({ ctx, input }) => {
        return updateBidAdjustmentTracking(input.adjustmentId, input.trackingData);
      }),
      // 运行效果追踪定时任务
      runEffectTrackingTask: protectedProcedure.input(external_exports.object({
        period: external_exports.number().default(7)
        // 7, 14, 或 30 天
      })).mutation(async ({ ctx, input }) => {
        const { runEffectTrackingTask: runEffectTrackingTask2 } = await Promise.resolve().then(() => (init_effectTrackingScheduler(), effectTrackingScheduler_exports));
        return runEffectTrackingTask2(input.period);
      }),
      // 运行所有效果追踪任务
      runAllTrackingTasks: protectedProcedure.mutation(async () => {
        const { runAllTrackingTasks: runAllTrackingTasks2 } = await Promise.resolve().then(() => (init_effectTrackingScheduler(), effectTrackingScheduler_exports));
        return runAllTrackingTasks2();
      }),
      // 获取效果追踪统计摘要
      getTrackingStatsSummary: protectedProcedure.query(async () => {
        const { getTrackingStatsSummary: getTrackingStatsSummary2 } = await Promise.resolve().then(() => (init_effectTrackingScheduler(), effectTrackingScheduler_exports));
        return getTrackingStatsSummary2();
      }),
      // 生成效果追踪报告
      generateTrackingReport: protectedProcedure.input(external_exports.object({
        startDate: external_exports.string().optional(),
        endDate: external_exports.string().optional(),
        campaignId: external_exports.number().optional(),
        performanceGroupId: external_exports.number().optional()
      })).query(async ({ input, ctx }) => {
        const accountId = 1;
        const conditions = [
          eq(bidAdjustmentHistory.accountId, accountId)
        ];
        if (input.startDate) {
          conditions.push(gte(bidAdjustmentHistory.appliedAt, input.startDate));
        }
        if (input.endDate) {
          conditions.push(lte(bidAdjustmentHistory.appliedAt, input.endDate));
        }
        if (input.campaignId) {
          conditions.push(eq(bidAdjustmentHistory.campaignId, String(input.campaignId)));
        }
        if (input.performanceGroupId) {
          conditions.push(eq(bidAdjustmentHistory.performanceGroupId, input.performanceGroupId));
        }
        const dbInstance = await getDb();
        if (!dbInstance) {
          return {
            totalRecords: 0,
            trackedRecords: 0,
            totalEstimatedProfit: 0,
            totalActualProfit7d: 0,
            totalActualProfit14d: 0,
            // @ts-ignore
            totalActualProfit30d: 0,
            byAdjustmentType: {},
            byCampaign: {},
            records: []
          };
        }
        const records = await dbInstance.select().from(bidAdjustmentHistory).where(and(...conditions)).orderBy(desc(bidAdjustmentHistory.appliedAt));
        let totalRecords = records.length;
        let trackedRecords = 0;
        let totalEstimatedProfit = 0;
        let totalActualProfit7d = 0;
        let totalActualProfit14d = 0;
        let totalActualProfit30d = 0;
        let count7d = 0, count14d = 0, count30d = 0;
        const byAdjustmentType = {};
        const byCampaign = {};
        for (const record2 of records) {
          const estimated = parseFloat(record2.expectedProfitIncrease || "0");
          totalEstimatedProfit += estimated;
          const type = record2.adjustmentType || "unknown";
          if (!byAdjustmentType[type]) {
            byAdjustmentType[type] = { count: 0, estimated: 0, actual: 0 };
          }
          byAdjustmentType[type].count++;
          byAdjustmentType[type].estimated += estimated;
          if (record2.campaignId) {
            if (!byCampaign[record2.campaignId]) {
              byCampaign[record2.campaignId] = { name: record2.campaignName || "", count: 0, estimated: 0, actual: 0 };
            }
            byCampaign[record2.campaignId].count++;
            byCampaign[record2.campaignId].estimated += estimated;
          }
          if (record2.actualProfit7D !== null) {
            const actual = parseFloat(record2.actualProfit7D);
            totalActualProfit7d += actual;
            count7d++;
            trackedRecords++;
            byAdjustmentType[type].actual += actual;
            if (record2.campaignId && byCampaign[record2.campaignId]) {
              byCampaign[record2.campaignId].actual += actual;
            }
          }
          if (record2.actualProfit14D !== null) {
            totalActualProfit14d += parseFloat(record2.actualProfit14D);
            count14d++;
          }
          if (record2.actualProfit30D !== null) {
            totalActualProfit30d += parseFloat(record2.actualProfit30D);
            count30d++;
          }
        }
        const calculateAccuracy2 = /* @__PURE__ */ __name((estimated, actual) => {
          if (estimated === 0) return actual >= 0 ? 100 : 0;
          return Math.min(100, Math.max(0, (1 - Math.abs(actual - estimated) / Math.abs(estimated)) * 100));
        }, "calculateAccuracy");
        return {
          summary: {
            totalRecords,
            trackedRecords,
            trackingRate: totalRecords > 0 ? Math.round(trackedRecords / totalRecords * 100) : 0,
            totalEstimatedProfit: Math.round(totalEstimatedProfit * 100) / 100,
            totalActualProfit7d: Math.round(totalActualProfit7d * 100) / 100,
            totalActualProfit14d: Math.round(totalActualProfit14d * 100) / 100,
            totalActualProfit30d: Math.round(totalActualProfit30d * 100) / 100,
            accuracy7d: count7d > 0 ? Math.round(calculateAccuracy2(totalEstimatedProfit, totalActualProfit7d) * 100) / 100 : null,
            accuracy14d: count14d > 0 ? Math.round(calculateAccuracy2(totalEstimatedProfit, totalActualProfit14d) * 100) / 100 : null,
            accuracy30d: count30d > 0 ? Math.round(calculateAccuracy2(totalEstimatedProfit, totalActualProfit30d) * 100) / 100 : null
          },
          byAdjustmentType: Object.entries(byAdjustmentType).map(([type, data]) => ({
            type,
            ...data,
            accuracy: calculateAccuracy2(data.estimated, data.actual)
          })),
          byCampaign: Object.entries(byCampaign).map(([id, data]) => ({
            campaignId: parseInt(id),
            ...data,
            accuracy: calculateAccuracy2(data.estimated, data.actual)
          })),
          records: records.slice(0, 100).map((r) => ({
            id: r.id,
            keywordText: r.keywordText,
            campaignName: r.campaignName,
            adjustmentType: r.adjustmentType,
            previousBid: r.previousBid,
            newBid: r.newBid,
            estimatedProfitChange: r.expectedProfitIncrease,
            actualProfit7D: r.actualProfit7D,
            actualProfit14D: r.actualProfit14D,
            actualProfit30D: r.actualProfit30D,
            adjustedAt: r.appliedAt
          }))
        };
      }),
      // 批量回滚出价调整
      batchRollbackBidAdjustments: protectedProcedure.input(external_exports.object({
        adjustmentIds: external_exports.array(external_exports.number())
      })).mutation(async ({ input, ctx }) => {
        const results = [];
        for (const id of input.adjustmentIds) {
          try {
            const result = await rollbackOptimizationEvent(id, ctx.user.name || ctx.user.openId);
            if (!result) {
              results.push({ id, success: false, error: "\u8BB0\u5F55\u4E0D\u5B58\u5728\u6216\u56DE\u6EDA\u5931\u8D25" });
              continue;
            }
            results.push({ id, success: true });
          } catch (error48) {
            results.push({ id, success: false, error: error48.message });
          }
        }
        const successCount = results.filter((r) => r.success).length;
        const failCount = results.filter((r) => !r.success).length;
        return {
          success: failCount === 0,
          message: `\u6279\u91CF\u56DE\u6EDA\u5B8C\u6210: ${successCount} \u6210\u529F, ${failCount} \u5931\u8D25`,
          // @ts-ignore
          results,
          successCount,
          failCount
        };
      }),
      // ==================== 边际效益分析（V2新增）====================
      // 计算单个位置的边际效益
      calculateMarginalBenefit: protectedProcedure.input(external_exports.object({
        campaignId: external_exports.string(),
        accountId: external_exports.number(),
        placementType: external_exports.enum(["top_of_search", "product_page", "rest_of_search"]),
        currentAdjustment: external_exports.number().default(0),
        days: external_exports.number().default(30)
      })).query(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        const { calculateMarginalBenefit: calculateMarginalBenefit2 } = await Promise.resolve().then(() => (init_marginalBenefitAnalysisService(), marginalBenefitAnalysisService_exports));
        return calculateMarginalBenefit2(
          input.campaignId,
          input.accountId,
          input.placementType,
          input.currentAdjustment,
          input.days
        );
      }),
      // 优化流量分配
      optimizeTrafficAllocation: protectedProcedure.input(external_exports.object({
        campaignId: external_exports.string(),
        accountId: external_exports.number(),
        currentAdjustments: external_exports.object({
          top_of_search: external_exports.number().default(0),
          product_page: external_exports.number().default(0),
          rest_of_search: external_exports.number().default(0)
        }),
        goal: external_exports.enum(["maximize_roas", "minimize_acos", "maximize_sales", "balanced"]).default("balanced"),
        constraints: external_exports.object({
          maxTotalAdjustment: external_exports.number().optional(),
          minAdjustmentPerPlacement: external_exports.number().optional(),
          maxAdjustmentPerPlacement: external_exports.number().optional(),
          maxSpendIncrease: external_exports.number().optional(),
          targetACoS: external_exports.number().optional(),
          targetROAS: external_exports.number().optional()
          // @ts-ignore
        }).optional()
      })).mutation(async ({ ctx, input }) => {
        const { optimizeTrafficAllocation: optimizeTrafficAllocation2 } = await Promise.resolve().then(() => (init_marginalBenefitAnalysisService(), marginalBenefitAnalysisService_exports));
        return optimizeTrafficAllocation2(
          input.campaignId,
          input.accountId,
          input.currentAdjustments,
          // @ts-ignore
          input.goal,
          input.constraints
        );
      }),
      // 批量分析边际效益（带优化建议）
      batchAnalyzeMarginalBenefitsWithOptimization: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        campaignIds: external_exports.array(external_exports.string()),
        optimizationGoal: external_exports.enum(["maximize_roas", "minimize_acos", "maximize_sales", "balanced"]).default("balanced"),
        analysisName: external_exports.string().optional()
      })).mutation(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        const { createBatchAnalysis: createBatchAnalysis2, executeBatchAnalysis: executeBatchAnalysis2 } = await Promise.resolve().then(() => (init_marginalBenefitBatchService(), marginalBenefitBatchService_exports));
        const analysisId = await createBatchAnalysis2({
          // @ts-ignore
          accountId: input.accountId,
          userId: ctx.user.id,
          campaignIds: input.campaignIds,
          optimizationGoal: input.optimizationGoal,
          analysisName: input.analysisName
        });
        const result = await executeBatchAnalysis2(analysisId, {
          accountId: input.accountId,
          userId: ctx.user.id,
          campaignIds: input.campaignIds,
          optimizationGoal: input.optimizationGoal,
          analysisName: input.analysisName
        });
        return result;
      }),
      // 获取批量分析历史
      getBatchAnalysisHistory: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        limit: external_exports.number().default(10)
        // @ts-ignore
      })).query(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        const { getBatchAnalysisHistory: getBatchAnalysisHistory2 } = await Promise.resolve().then(() => (init_marginalBenefitBatchService(), marginalBenefitBatchService_exports));
        return getBatchAnalysisHistory2(input.accountId, input.limit);
      }),
      // 获取批量分析详情
      getBatchAnalysisDetail: protectedProcedure.input(external_exports.object({ analysisId: external_exports.number() })).query(async ({ ctx, input }) => {
        const { getBatchAnalysisDetail: getBatchAnalysisDetail2 } = await Promise.resolve().then(() => (init_marginalBenefitBatchService(), marginalBenefitBatchService_exports));
        return getBatchAnalysisDetail2(input.analysisId);
      }),
      // 一键应用优化建议
      applyOptimization: protectedProcedure.input(external_exports.object({
        // @ts-ignore
        accountId: external_exports.number(),
        campaignId: external_exports.string(),
        optimizationGoal: external_exports.enum(["maximize_roas", "minimize_acos", "maximize_sales", "balanced"]),
        suggestedTopOfSearch: external_exports.number(),
        suggestedProductPage: external_exports.number(),
        expectedSalesChange: external_exports.number(),
        expectedSpendChange: external_exports.number(),
        expectedROASChange: external_exports.number(),
        expectedACoSChange: external_exports.number(),
        note: external_exports.string().optional()
      })).mutation(async ({ input, ctx }) => {
        const { applyOptimization: applyOptimization2 } = await Promise.resolve().then(() => (init_marginalBenefitBatchService(), marginalBenefitBatchService_exports));
        return applyOptimization2({
          ...input,
          userId: ctx.user.id
        });
      }),
      // 批量应用优化建议
      batchApplyOptimization: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        applications: external_exports.array(external_exports.object({
          campaignId: external_exports.string(),
          optimizationGoal: external_exports.enum(["maximize_roas", "minimize_acos", "maximize_sales", "balanced"]),
          // @ts-ignore
          suggestedTopOfSearch: external_exports.number(),
          suggestedProductPage: external_exports.number(),
          expectedSalesChange: external_exports.number(),
          expectedSpendChange: external_exports.number(),
          expectedROASChange: external_exports.number(),
          expectedACoSChange: external_exports.number()
        }))
      })).mutation(async ({ input, ctx }) => {
        const { batchApplyOptimization: batchApplyOptimization2 } = await Promise.resolve().then(() => (init_marginalBenefitBatchService(), marginalBenefitBatchService_exports));
        return batchApplyOptimization2(input.accountId, ctx.user.id, input.applications);
      }),
      // 回滚优化应用
      rollbackApplication: protectedProcedure.input(external_exports.object({ applicationId: external_exports.number() })).mutation(async ({ ctx, input }) => {
        const { rollbackApplication: rollbackApplication2 } = await Promise.resolve().then(() => (init_marginalBenefitBatchService(), marginalBenefitBatchService_exports));
        return rollbackApplication2(input.applicationId);
      }),
      // 获取应用历史
      getApplicationHistory: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        campaignId: external_exports.string().optional(),
        limit: external_exports.number().default(20)
      })).query(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        const { getApplicationHistory: getApplicationHistory2 } = await Promise.resolve().then(() => (init_marginalBenefitBatchService(), marginalBenefitBatchService_exports));
        return getApplicationHistory2(input.accountId, input.campaignId, input.limit);
      }),
      // 获取历史趋势数据
      getHistoryTrend: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        campaignId: external_exports.string(),
        placementType: external_exports.enum(["top_of_search", "product_page", "rest_of_search"]),
        days: external_exports.number().default(30)
      })).query(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        const { getHistoryTrend: getHistoryTrend2 } = await Promise.resolve().then(() => (init_marginalBenefitHistoryService(), marginalBenefitHistoryService_exports));
        return getHistoryTrend2(input.accountId, input.campaignId, input.days);
      }),
      // 获取季节性模式
      getSeasonalPattern: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        campaignId: external_exports.string(),
        period: external_exports.enum(["weekly", "monthly"]).default("weekly")
      })).query(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        const { analyzeSeasonalPatterns: analyzeSeasonalPatterns2 } = await Promise.resolve().then(() => (init_marginalBenefitHistoryService(), marginalBenefitHistoryService_exports));
        return analyzeSeasonalPatterns2(input.accountId, input.campaignId, input.period);
      }),
      // 时段对比分析
      comparePeriods: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        campaignId: external_exports.string(),
        period1Start: external_exports.string(),
        period1End: external_exports.string(),
        period2Start: external_exports.string(),
        period2End: external_exports.string()
      })).query(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        const { comparePeriods: comparePeriods2 } = await Promise.resolve().then(() => (init_marginalBenefitHistoryService(), marginalBenefitHistoryService_exports));
        return comparePeriods2(
          input.accountId,
          input.campaignId,
          input.period1Start,
          input.period1End,
          input.period2Start,
          input.period2End
        );
      }),
      // 生成边际效益分析报告
      generateMarginalBenefitReport: protectedProcedure.input(external_exports.object({
        campaignId: external_exports.string(),
        accountId: external_exports.number(),
        goal: external_exports.enum(["maximize_roas", "minimize_acos", "maximize_sales", "balanced"]).default("balanced")
      })).query(async ({ input, ctx }) => {
        await verifyAccountAccess(ctx.user.id, input.accountId);
        const {
          calculateMarginalBenefit: calculateMarginalBenefit2,
          optimizeTrafficAllocation: optimizeTrafficAllocation2,
          generateMarginalBenefitReport: generateMarginalBenefitReport2
        } = await Promise.resolve().then(() => (init_marginalBenefitAnalysisService(), marginalBenefitAnalysisService_exports));
        const currentSettings = await getCampaignPlacementSettings(
          input.campaignId,
          input.accountId
        );
        const currentAdjustments = {
          top_of_search: currentSettings?.top_of_search || 0,
          product_page: currentSettings?.product_page || 0,
          rest_of_search: currentSettings?.rest_of_search || 0
        };
        const placements = ["top_of_search", "product_page", "rest_of_search"];
        const marginalBenefits = {};
        for (const placement of placements) {
          marginalBenefits[placement] = await calculateMarginalBenefit2(
            input.campaignId,
            input.accountId,
            placement,
            currentAdjustments[placement],
            30
          );
        }
        const allocationResult = await optimizeTrafficAllocation2(
          input.campaignId,
          input.accountId,
          currentAdjustments,
          input.goal
        );
        const report = generateMarginalBenefitReport2(
          // @ts-expect-error - type assertion
          marginalBenefits,
          allocationResult
        );
        return {
          marginalBenefits,
          allocationResult,
          report
        };
      })
    });
  }
});

