/**
 * 位置优化路由
 * 从 routers.ts 拆分的独立路由模块
 */
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as db from "../db";
import * as marginalBenefitService from '../marginalBenefitAnalysisService';
import * as placementService from '../placementOptimizationService';
import { eq, and, gte, lte, desc } from 'drizzle-orm';
import { bidAdjustmentHistory } from '../../drizzle/schema';
import * as advancedPlacementService from '../advancedPlacementService';
import * as marketCurveService from '../marketCurveService';
import * as decisionTreeService from '../decisionTreeService';
import { createModuleLogger } from '../utils/logger';

const log = createModuleLogger('Route_placement');


export const placementRouter = router({
  // 获取广告活动的位置表现数据
  getPerformance: protectedProcedure
    .input(z.object({
      campaignId: z.string(),
      accountId: z.number(),
      days: z.number().default(7),
    }))
    .query(async ({ input }) => {
      return placementService.getCampaignPlacementPerformance(
        input.campaignId,
        input.accountId,
        input.days
      );
    }),

  // 获取广告活动的位置倾斜设置
  getSettings: protectedProcedure
    .input(z.object({
      campaignId: z.string(),
      accountId: z.number(),
    }))
    .query(async ({ input }) => {
      return placementService.getCampaignPlacementSettings(
        input.campaignId,
        input.accountId
      );
    }),

  // 生成位置倾斜建议
  generateSuggestions: protectedProcedure
    .input(z.object({
      campaignId: z.string(),
      accountId: z.number(),
      days: z.number().default(7),
    }))
    .mutation(async ({ input }) => {
      // 获取位置表现数据
      const performance = await placementService.getCampaignPlacementPerformance(
        input.campaignId,
        input.accountId,
        input.days
      );
      
      // 获取当前设置
      const currentSettings = await placementService.getCampaignPlacementSettings(
        input.campaignId,
        input.accountId
      );
      
      // 生成建议
      const suggestions = await placementService.calculateOptimalAdjustment(
        performance,
        currentSettings,
        input.campaignId,
        input.accountId
      );
      
      // 集成边际效益分析
      let marginalBenefitInsights = null;
      try {
        const marginalBenefits: Record<string, unknown> = {};
        for (const p of performance) {
          const placementType = p.placementType as 'top_of_search' | 'product_page' | 'rest_of_search';
          const currentAdjustment = currentSettings?.[placementType] || 0;
          const benefit = marginalBenefitService.calculateMarginalBenefitSimple(
            p.metrics || { impressions: 0, clicks: 0, spend: 0, sales: 0, orders: 0, ctr: 0, cvr: 0, cpc: 0, acos: 0, roas: 0 },
            currentAdjustment
          );
          marginalBenefits[placementType] = {
            ...benefit,
            currentAdjustment,
          };
        }
        
        // 计算最优流量分配
        const optimizationResult = marginalBenefitService.optimizeTrafficAllocationSimple(
          marginalBenefits,
          {
            top_of_search: currentSettings?.top_of_search || 0,
            product_page: currentSettings?.product_page || 0,
            rest_of_search: currentSettings?.rest_of_search || 0,
          },
          'balanced'
        );
        
        marginalBenefitInsights = {
          marginalBenefits,
          optimizationResult,
        };
      } catch (e) {
        log.error('[generateSuggestions] 边际效益分析失败:', e);
      }
      
      return {
        performance,
        currentSettings,
        suggestions,
        marginalBenefitInsights,
      };
    }),

  // 应用位置倾斜调整
  applyAdjustments: protectedProcedure
    .input(z.object({
      campaignId: z.string(),
      accountId: z.number(),
      adjustments: z.array(z.object({
        placementType: z.enum(['top_of_search', 'product_page', 'rest_of_search']),
        currentAdjustment: z.number(),
        suggestedAdjustment: z.number(),
        adjustmentDelta: z.number(),
        efficiencyScore: z.number(),
        confidence: z.number(), // 0-1的置信度数值
        isReliable: z.boolean().optional().default(true), // V2新增：数据是否可靠
        reason: z.string(),
        cooldownStatus: z.object({
          inCooldown: z.boolean(),
          lastAdjustmentDate: z.date().optional(),
          daysRemaining: z.number().optional(),
        }).optional(), // V2新增：冷却期状态
      })),
    }))
    .mutation(async ({ input }) => {
      await placementService.updatePlacementSettings(
        input.campaignId,
        input.accountId,
        input.adjustments
      );
      return { success: true };
    }),

  // 执行单个广告活动的位置优化
  optimizeCampaign: protectedProcedure
    .input(z.object({
      campaignId: z.string(),
      accountId: z.number(),
    }))
    .mutation(async ({ input }) => {
      return placementService.executeAutomaticPlacementOptimization(
        input.campaignId,
        input.accountId
      );
    }),

  // 批量执行位置优化
  batchOptimize: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      campaignIds: z.array(z.string()).optional(),
    }))
    .mutation(async ({ input }) => {
      return placementService.batchExecutePlacementOptimization(
        input.accountId,
        input.campaignIds
      );
    }),

  // 获取位置调整历史记录
  getHistory: protectedProcedure
    .input(z.object({
      campaignId: z.string().optional(),
      accountId: z.number(),
      limit: z.number().default(50),
    }))
    .query(async ({ input }) => {
      // TODO: 实现历史记录查询
      return [];
    }),

  // ==================== 高级位置优化（智能优化算法整合）====================

  // 分析广告活动的位置利润优化
  analyzeProfitOptimization: protectedProcedure
    .input(z.object({
      campaignId: z.string(),
      accountId: z.number(),
    }))
    .query(async ({ input }) => {
      return advancedPlacementService.analyzeCampaignPlacementProfit(
        input.accountId,
        input.campaignId
      );
    }),

  // 分析单个竞价对象的利润
  analyzeBidObjectProfit: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      campaignId: z.string(),
      bidObjectType: z.enum(['keyword', 'asin']),
      bidObjectId: z.string(),
      bidObjectText: z.string(),
      currentBaseBid: z.number(),
      currentTopAdjustment: z.number().default(0),
      currentProductAdjustment: z.number().default(0),
    }))
    .query(async ({ input }) => {
      return advancedPlacementService.analyzeBidObjectProfit(
        input.accountId,
        input.campaignId,
        input.bidObjectType,
        input.bidObjectId,
        input.bidObjectText,
        input.currentBaseBid,
        input.currentTopAdjustment,
        input.currentProductAdjustment
      );
    }),

  // 获取待处理的优化建议
  getPendingRecommendations: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      campaignId: z.string().optional(),
    }))
    .query(async ({ input }) => {
      return advancedPlacementService.getPendingRecommendations(
        input.accountId,
        input.campaignId
      );
    }),

  // 应用优化建议
  applyRecommendation: protectedProcedure
    .input(z.object({
      recommendationId: z.number(),
    }))
    .mutation(async ({ input, ctx }) => {
      return advancedPlacementService.applyOptimizationRecommendation(
        input.recommendationId,
        ctx.user.id
      );
    }),

  // 生成利润曲线可视化数据
  getProfitCurveData: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      bidObjectType: z.enum(['keyword', 'asin']),
      bidObjectId: z.string(),
    }))
    .query(async ({ input }) => {
      return advancedPlacementService.generateProfitVisualizationData(
        input.accountId,
        input.bidObjectType,
        input.bidObjectId
      );
    }),

  // ==================== 市场曲线相关 ====================

  // 构建关键词的市场曲线模型
  buildMarketCurve: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      campaignId: z.string(),
      keywordId: z.number(),
      daysBack: z.number().default(30),
    }))
    .mutation(async ({ input }) => {
      const model = await marketCurveService.buildMarketCurveForKeyword(
        input.accountId,
        input.campaignId,
        input.keywordId,
        input.daysBack
      );
      return model;
    }),

  // 获取市场曲线模型
  getMarketCurve: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      bidObjectType: z.enum(['keyword', 'asin', 'audience']),
      bidObjectId: z.string(),
    }))
    .query(async ({ input }) => {
      return marketCurveService.getMarketCurveModel(
        input.accountId,
        input.bidObjectType,
        input.bidObjectId
      );
    }),

  // 批量更新市场曲线模型
  updateAllMarketCurves: protectedProcedure
    .input(z.object({
      accountId: z.number(),
    }))
    .mutation(async ({ input }) => {
      return marketCurveService.updateAllMarketCurveModels(input.accountId);
    }),

  // ==================== 决策树相关 ====================

  // 训练决策树模型
  trainDecisionTree: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      modelType: z.enum(['cr_prediction', 'cv_prediction']),
    }))
    .mutation(async ({ input }) => {
      const result = await decisionTreeService.trainDecisionTreeModel(
        input.accountId,
        input.modelType
      );
      
      // 保存模型
      const modelId = await decisionTreeService.saveDecisionTreeModel(
        input.accountId,
        input.modelType,
        result
      );
      
      return {
        modelId,
        depth: result.depth,
        leafCount: result.leafCount,
        trainingR2: result.trainingR2,
        totalSamples: result.totalSamples,
        featureImportance: result.featureImportance,
      };
    }),

  // 预测关键词表现
  predictKeywordPerformance: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      matchType: z.enum(['broad', 'phrase', 'exact']),
      wordCount: z.number(),
      keywordType: z.enum(['brand', 'competitor', 'generic', 'product']),
      avgBid: z.number(),
    }))
    .query(async ({ input }) => {
      return decisionTreeService.predictKeywordPerformance(
        input.accountId,
        {
          matchType: input.matchType,
          wordCount: input.wordCount,
          keywordType: input.keywordType,
          avgBid: input.avgBid,
        }
      );
    }),

  // 批量预测并保存关键词预测结果
  batchPredictKeywords: protectedProcedure
    .input(z.object({
      accountId: z.number(),
    }))
    .mutation(async ({ input }) => {
      return decisionTreeService.batchPredictAndSaveKeywords(input.accountId);
    }),

  // 获取关键词预测摘要
  getKeywordPredictionSummary: protectedProcedure
    .input(z.object({
      accountId: z.number(),
    }))
    .query(async ({ input }) => {
      return decisionTreeService.getKeywordPredictionSummary(input.accountId);
    }),

  // ==================== 利润最大化出价点实时计算 ====================

  // 获取广告活动的利润最大化出价点
  getCampaignOptimalBids: protectedProcedure
    .input(z.object({
      campaignId: z.string(),
      accountId: z.number(),
    }))
    .query(async ({ input }) => {
      // 获取广告活动下的所有关键词
      const campaignKeywords = await db.getKeywordsByCampaignId(input.campaignId);
      
      const results = [];
      for (const keyword of campaignKeywords) {
        // 获取市场曲线模型
        const marketCurve = await marketCurveService.getMarketCurveModel(
          input.accountId,
          'keyword',
          String(keyword.id)
        );
        
        if (marketCurve) {
          // 计算最优出价点
          const optimalBid = marketCurveService.calculateOptimalBid(
            marketCurve.impressionCurve as unknown,
            marketCurve.ctrCurve as unknown,
            marketCurve.conversion as unknown
          );
          
          results.push({
            keywordId: keyword.id,
            keywordText: keyword.keywordText,
            matchType: keyword.matchType,
            currentBid: Number(keyword.bid) || 0,
            optimalBid: optimalBid.optimalBid,
            maxProfit: optimalBid.maxProfit,
            profitMargin: optimalBid.profitMargin,
            breakEvenCpc: optimalBid.breakEvenCpc,
            bidDifference: optimalBid.optimalBid - (Number(keyword.bid) || 0),
            bidDifferencePercent: keyword.bid ? ((optimalBid.optimalBid - Number(keyword.bid)) / Number(keyword.bid) * 100) : 0,
            recommendation: optimalBid.optimalBid > (Number(keyword.bid) || 0) ? 'increase' : 
                           optimalBid.optimalBid < (Number(keyword.bid) || 0) ? 'decrease' : 'maintain',
          });
        }
      }
      
      // 计算汇总统计
      const summary = {
        totalKeywords: campaignKeywords.length,
        analyzedKeywords: results.length,
        avgOptimalBid: results.length > 0 ? results.reduce((sum, r) => sum + r.optimalBid, 0) / results.length : 0,
        avgCurrentBid: results.length > 0 ? results.reduce((sum, r) => sum + r.currentBid, 0) / results.length : 0,
        totalMaxProfit: results.reduce((sum, r) => sum + r.maxProfit, 0),
        keywordsNeedIncrease: results.filter(r => r.recommendation === 'increase').length,
        keywordsNeedDecrease: results.filter(r => r.recommendation === 'decrease').length,
        keywordsMaintain: results.filter(r => r.recommendation === 'maintain').length,
      };
      
      return {
        summary,
        keywords: results,
      };
    }),

  // 获取绩效组的利润最大化出价点汇总
  getPerformanceGroupOptimalBids: protectedProcedure
    .input(z.object({
      groupId: z.number(),
      accountId: z.number(),
    }))
    .query(async ({ input }) => {
      // 获取绩效组信息
      const group = await db.getPerformanceGroupById(input.groupId);
      if (!group) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '绩效组不存在' });
      }
      
      // 获取绩效组内的所有广告活动
      const groupCampaigns = await db.getCampaignsByPerformanceGroupId(input.groupId);
      
      const campaignResults = [];
      let totalAnalyzedKeywords = 0;
      let totalMaxProfit = 0;
      let totalKeywordsNeedIncrease = 0;
      let totalKeywordsNeedDecrease = 0;
      
      for (const gc of groupCampaigns) {
        const campaign = gc; // gc已经是campaign对象
        if (!campaign) continue;
        
        // v206: 获取广告活动下的所有关键词（使用Amazon campaignId）
        const campaignKeywords = await db.getKeywordsByCampaignId(campaign.campaignId);
        
        let campaignOptimalBidSum = 0;
        let campaignCurrentBidSum = 0;
        let campaignMaxProfit = 0;
        let analyzedCount = 0;
        let needIncrease = 0;
        let needDecrease = 0;
        
        for (const keyword of campaignKeywords) {
          const marketCurve = await marketCurveService.getMarketCurveModel(
            input.accountId,
            'keyword',
            String(keyword.id)
          );
          
          if (marketCurve) {
            const optimalBid = marketCurveService.calculateOptimalBid(
              marketCurve.impressionCurve as unknown,
              marketCurve.ctrCurve as unknown,
              marketCurve.conversion as unknown
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
            analyzedKeywords: analyzedCount,
            avgOptimalBid: campaignOptimalBidSum / analyzedCount,
            avgCurrentBid: campaignCurrentBidSum / analyzedCount,
            maxProfit: campaignMaxProfit,
            keywordsNeedIncrease: needIncrease,
            keywordsNeedDecrease: needDecrease,
            optimizationScore: Math.round((1 - Math.abs(campaignOptimalBidSum - campaignCurrentBidSum) / Math.max(campaignOptimalBidSum, 1)) * 100),
          });
          
          totalAnalyzedKeywords += analyzedCount;
          totalMaxProfit += campaignMaxProfit;
          totalKeywordsNeedIncrease += needIncrease;
          totalKeywordsNeedDecrease += needDecrease;
        }
      }
      
      // 计算组级别汇总
      const groupSummary = {
        groupId: input.groupId,
        groupName: group.name,
        totalCampaigns: groupCampaigns.length,
        analyzedCampaigns: campaignResults.length,
        totalAnalyzedKeywords,
        totalMaxProfit: Math.round(totalMaxProfit * 100) / 100,
        avgOptimizationScore: campaignResults.length > 0 
          ? Math.round(campaignResults.reduce((sum, c) => sum + c.optimizationScore, 0) / campaignResults.length)
          : 0,
        keywordsNeedIncrease: totalKeywordsNeedIncrease,
        keywordsNeedDecrease: totalKeywordsNeedDecrease,
        overallRecommendation: totalKeywordsNeedIncrease > totalKeywordsNeedDecrease ? 'increase_bids' :
                               totalKeywordsNeedDecrease > totalKeywordsNeedIncrease ? 'decrease_bids' : 'maintain',
      };
      
      return {
        summary: groupSummary,
        campaigns: campaignResults,
      };
    }),

  // 一键应用广告活动的最优出价
  applyCampaignOptimalBids: protectedProcedure
    .input(z.object({
      campaignId: z.string(),
      accountId: z.number(),
      keywordIds: z.array(z.number()).optional(), // 可选，指定要应用的关键词，不指定则应用所有
      minBidDifferencePercent: z.number().default(5), // 最小差距百分比，低于此值不调整
    }))
    .mutation(async ({ input, ctx }) => {
      // 获取广告活动下的所有关键词
      const campaignKeywords = await db.getKeywordsByCampaignId(input.campaignId);
      
      // 如果指定了关键词，则只处理指定的
      const keywordsToProcess = input.keywordIds 
        ? campaignKeywords.filter(k => input.keywordIds!.includes(k.id))
        : campaignKeywords;
      
      const adjustments: Array<{
        keywordId: number;
        keywordText: string;
        oldBid: number;
        newBid: number;
        bidChange: number;
        bidChangePercent: number;
        expectedProfitIncrease: number;
        status: 'applied' | 'skipped' | 'error';
        reason?: string;
      }> = [];
      
      let appliedCount = 0;
      let skippedCount = 0;
      let errorCount = 0;
      let totalExpectedProfitIncrease = 0;
      
      for (const keyword of keywordsToProcess) {
        try {
          // 获取市场曲线模型
          const marketCurve = await marketCurveService.getMarketCurveModel(
            input.accountId,
            'keyword',
            String(keyword.id)
          );
          
          if (!marketCurve) {
            adjustments.push({
              keywordId: keyword.id,
              keywordText: keyword.keywordText || '',
              oldBid: Number(keyword.bid) || 0,
              newBid: Number(keyword.bid) || 0,
              bidChange: 0,
              bidChangePercent: 0,
              expectedProfitIncrease: 0,
              status: 'skipped',
              reason: '无市场曲线数据',
            });
            skippedCount++;
            continue;
          }
          
          // 计算最优出价点
          const optimalBid = marketCurveService.calculateOptimalBid(
            marketCurve.impressionCurve as unknown,
            marketCurve.ctrCurve as unknown,
            marketCurve.conversion as unknown
          );
          
          const currentBid = Number(keyword.bid) || 0;
          const bidDifferencePercent = currentBid > 0 
            ? Math.abs((optimalBid.optimalBid - currentBid) / currentBid * 100)
            : 100;
          
          // 检查差距是否足够大
          if (bidDifferencePercent < input.minBidDifferencePercent) {
            adjustments.push({
              keywordId: keyword.id,
              keywordText: keyword.keywordText || '',
              oldBid: currentBid,
              newBid: currentBid,
              bidChange: 0,
              bidChangePercent: 0,
              expectedProfitIncrease: 0,
              status: 'skipped',
              reason: `差距仅${bidDifferencePercent.toFixed(1)}%，低于阈值${input.minBidDifferencePercent}%`,
            });
            skippedCount++;
            continue;
          }
          
          // 应用新出价
          const newBid = Math.round(optimalBid.optimalBid * 100) / 100; // 保留两位小数
          
          // 更新数据库中的出价
          await db.updateKeywordBid(keyword.id, newBid);
          
          const bidChange = newBid - currentBid;
          const expectedProfitIncrease = optimalBid.maxProfit * 0.1; // 估计利润提升
          
          adjustments.push({
            keywordId: keyword.id,
            keywordText: keyword.keywordText || '',
            oldBid: currentBid,
            newBid: newBid,
            bidChange: bidChange,
            bidChangePercent: currentBid > 0 ? (bidChange / currentBid * 100) : 0,
            expectedProfitIncrease: expectedProfitIncrease,
            status: 'applied',
          });
          
          appliedCount++;
          totalExpectedProfitIncrease += expectedProfitIncrease;
          
          // 记录出价调整历史
          await db.recordBidAdjustment({
            accountId: input.accountId,
            campaignId: parseInt(input.campaignId),
            keywordId: keyword.id,
            keywordText: keyword.keywordText || '',
            matchType: keyword.matchType || '',
            previousBid: currentBid,
            newBid: newBid,
            adjustmentType: 'auto_optimal',
            adjustmentReason: '利润最大化出价点优化',
            expectedProfitIncrease: expectedProfitIncrease,
            appliedBy: String(ctx.user.id),
            status: 'applied',
          });
          
        } catch (error) {
          adjustments.push({
            keywordId: keyword.id,
            keywordText: keyword.keywordText || '',
            oldBid: Number(keyword.bid) || 0,
            newBid: Number(keyword.bid) || 0,
            bidChange: 0,
            bidChangePercent: 0,
            expectedProfitIncrease: 0,
            status: 'error',
            reason: error instanceof Error ? error.message : '未知错误',
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
          totalExpectedProfitIncrease: Math.round(totalExpectedProfitIncrease * 100) / 100,
        },
        adjustments,
        appliedAt: new Date().toISOString(),
        appliedBy: ctx.user.id,
      };
    }),

  // 一键应用绩效组的所有最优出价
  applyGroupOptimalBids: protectedProcedure
    .input(z.object({
      groupId: z.number(),
      accountId: z.number(),
      minBidDifferencePercent: z.number().default(5),
    }))
    .mutation(async ({ input, ctx }) => {
      // 获取绩效组信息
      const group = await db.getPerformanceGroupById(input.groupId);
      if (!group) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '绩效组不存在' });
      }
      
      // 获取绩效组内的所有广告活动
      const groupCampaigns = await db.getCampaignsByPerformanceGroupId(input.groupId);
      
      const campaignResults: Array<{
        campaignId: string;
        campaignName: string;
        appliedCount: number;
        skippedCount: number;
        errorCount: number;
        totalExpectedProfitIncrease: number;
      }> = [];
      
      let totalApplied = 0;
      let totalSkipped = 0;
      let totalErrors = 0;
      let totalProfitIncrease = 0;
      
      for (const gc of groupCampaigns) {
        const campaign = gc; // gc已经是campaign对象
        if (!campaign) continue;
        
        // v206: 获取广告活动下的所有关键词（使用Amazon campaignId）
        const campaignKeywords = await db.getKeywordsByCampaignId(campaign.campaignId);
        
        let appliedCount = 0;
        let skippedCount = 0;
        let errorCount = 0;
        let campaignProfitIncrease = 0;
        
        for (const keyword of campaignKeywords) {
          try {
            const marketCurve = await marketCurveService.getMarketCurveModel(
              input.accountId,
              'keyword',
              String(keyword.id)
            );
            
            if (!marketCurve) {
              skippedCount++;
              continue;
            }
            
            const optimalBid = marketCurveService.calculateOptimalBid(
              marketCurve.impressionCurve as unknown,
              marketCurve.ctrCurve as unknown,
              marketCurve.conversion as unknown
            );
            
            const currentBid = Number(keyword.bid) || 0;
            const bidDifferencePercent = currentBid > 0 
              ? Math.abs((optimalBid.optimalBid - currentBid) / currentBid * 100)
              : 100;
            
            if (bidDifferencePercent < input.minBidDifferencePercent) {
              skippedCount++;
              continue;
            }
            
            const newBid = Math.round(optimalBid.optimalBid * 100) / 100;
            await db.updateKeywordBid(keyword.id, newBid);
            
            appliedCount++;
            campaignProfitIncrease += optimalBid.maxProfit * 0.1;
            
            // 记录出价调整历史
            await db.recordBidAdjustment({
              accountId: input.accountId,
              campaignId: parseInt(gc.campaignId),
              campaignName: campaign.campaignName,
              performanceGroupId: input.groupId,
              performanceGroupName: group.name,
              keywordId: keyword.id,
              keywordText: keyword.keywordText || '',
              matchType: keyword.matchType || '',
              previousBid: currentBid,
              newBid: newBid,
              adjustmentType: 'batch_group',
              adjustmentReason: '绩效组批量利润最大化优化',
              expectedProfitIncrease: optimalBid.maxProfit * 0.1,
              appliedBy: String(ctx.user.id),
              status: 'applied',
            });
            
          } catch (error) {
            errorCount++;
          }
        }
        
        campaignResults.push({
          campaignId: gc.campaignId,
          campaignName: campaign.campaignName,
          appliedCount,
          skippedCount,
          errorCount,
          totalExpectedProfitIncrease: Math.round(campaignProfitIncrease * 100) / 100,
        });
        
        totalApplied += appliedCount;
        totalSkipped += skippedCount;
        totalErrors += errorCount;
        totalProfitIncrease += campaignProfitIncrease;
      }
      
      return {
        success: true,
        groupId: input.groupId,
        groupName: group.name,
        summary: {
          totalCampaigns: groupCampaigns.length,
          processedCampaigns: campaignResults.length,
          totalApplied,
          totalSkipped,
          totalErrors,
          totalExpectedProfitIncrease: Math.round(totalProfitIncrease * 100) / 100,
        },
        campaigns: campaignResults,
        appliedAt: new Date().toISOString(),
        appliedBy: ctx.user.id,
      };
    }),

  // 获取出价调整历史记录
  getBidAdjustmentHistory: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      campaignId: z.number().optional(),
      performanceGroupId: z.number().optional(),
      adjustmentType: z.enum(['manual', 'auto_optimal', 'auto_dayparting', 'auto_placement', 'batch_campaign', 'batch_group']).optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      page: z.number().default(1),
      pageSize: z.number().default(50),
    }))
    .query(async ({ input }) => {
      // v146: 重定向到统一事件表查询
      const result = await db.getOptimizationEvents({
        accountId: input.accountId,
        performanceGroupId: input.performanceGroupId,
        eventCategory: 'bid_adjustment',
        campaignId: input.campaignId,
        startDate: input.startDate,
        endDate: input.endDate,
        limit: input.pageSize,
        offset: (input.page - 1) * input.pageSize,
      });
      // 兼容旧的返回格式
      return {
        records: result.events.map((e: Record<string, unknown>) => ({
          ...e,
          appliedAt: e.createdAt,
          adjustmentType: e.adjustmentType || e.actionType,
          adjustmentReason: e.changeReason,
          status: e.status === 'success' ? 'applied' : e.status,
        })),
        total: result.total,
        page: input.page,
        pageSize: input.pageSize,
        totalPages: Math.ceil(result.total / input.pageSize),
      };
    }),
  
  // 获取出价调整历史统计 - v146: 重定向到统一事件表
  getBidAdjustmentStats: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      days: z.number().default(30),
    }))
    .query(async ({ input }) => {
      return db.getOptimizationEventStats({
        accountId: input.accountId,
        days: input.days,
      });
    }),

  // 快速计算单个关键词的最优出价点
  calculateKeywordOptimalBid: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      keywordId: z.number(),
      // 如果没有市场曲线模型，可以使用默认参数
      cvr: z.number().optional(),
      aov: z.number().optional(),
    }))
    .query(async ({ input }) => {
      // 尝试获取市场曲线模型
      const marketCurve = await marketCurveService.getMarketCurveModel(
        input.accountId,
        'keyword',
        String(input.keywordId)
      );
      
      if (marketCurve) {
        const optimalBid = marketCurveService.calculateOptimalBid(
          marketCurve.impressionCurve as unknown,
          marketCurve.ctrCurve as unknown,
          marketCurve.conversion as unknown
        );
        return {
          hasModel: true,
          ...optimalBid,
        };
      }
      
      // 使用默认参数计算
      const cvr = input.cvr || 0.05;
      const aov = input.aov || 30;
      
      const defaultImpressionCurve = { a: 1000, b: 0.5, c: 500, r2: 0.8 };
      const defaultCtrCurve = { baseCtr: 0.01, positionBonus: 0.5, topSearchCtrBonus: 0.3 };
      const defaultConversion = { cvr, aov, conversionDelayDays: 7 };
      
      const optimalBid = marketCurveService.calculateOptimalBid(
        defaultImpressionCurve,
        defaultCtrCurve,
        defaultConversion
      );
      
      return {
        hasModel: false,
        ...optimalBid,
        note: '使用默认参数计算，建议构建市场曲线模型以获取更精确的结果',
      };
    }),

  // 回滚出价调整
  rollbackBidAdjustment: protectedProcedure
    .input(z.object({
      adjustmentId: z.number(),
    }))
    .mutation(async ({ input, ctx }) => {
      // v146: 重定向到统一事件表回滚
      return db.rollbackOptimizationEvent(input.adjustmentId, ctx.user.name || ctx.user.openId);
    }),

  // 获取单条调整记录详情 - v146: 从统一事件表查询
  getBidAdjustmentById: protectedProcedure
    .input(z.object({
      adjustmentId: z.number(),
    }))
    .query(async ({ input }) => {
      const result = await db.getOptimizationEvents({ limit: 1, offset: 0 });
      return result.events.find((e: Record<string, unknown>) => e.id === input.adjustmentId) || null;
    }),

  // 获取效果追踪统计 - v146: 重定向到统一事件表
  getBidAdjustmentTrackingStats: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      days: z.number().default(30),
    }))
    .query(async ({ input }) => {
      return db.getOptimizationEventStats({
        accountId: input.accountId,
        days: input.days,
      });
    }),

  // 批量导入出价调整历史
  importBidAdjustmentHistory: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      records: z.array(z.object({
        campaignId: z.number().optional(),
        campaignName: z.string().optional(),
        performanceGroupId: z.number().optional(),
        performanceGroupName: z.string().optional(),
        keywordId: z.number().optional(),
        keywordText: z.string().optional(),
        matchType: z.string().optional(),
        previousBid: z.number(),
        newBid: z.number(),
        adjustmentType: z.enum(['manual', 'auto_optimal', 'auto_dayparting', 'auto_placement', 'batch_campaign', 'batch_group']).default('manual'),
        adjustmentReason: z.string().optional(),
        expectedProfitIncrease: z.number().optional(),
        appliedBy: z.string().optional(),
        appliedAt: z.string().optional(),
        status: z.enum(['applied', 'pending', 'failed', 'rolled_back']).default('applied'),
      })),
    }))
    .mutation(async ({ input, ctx }) => {
      const recordsWithAccount = input.records.map(r => ({
        ...r,
        accountId: input.accountId,
        appliedBy: r.appliedBy || ctx.user.name || ctx.user.openId,
      }));
      return db.importBidAdjustmentHistory(recordsWithAccount);
    }),

  // 获取需要效果追踪的调整记录
  getAdjustmentsNeedingTracking: protectedProcedure
    .input(z.object({
      daysAgo: z.number().default(7),
    }))
    .query(async ({ input }) => {
      return db.getAdjustmentsNeedingTracking(input.daysAgo);
    }),

  // 更新效果追踪数据
  updateBidAdjustmentTracking: protectedProcedure
    .input(z.object({
      adjustmentId: z.number(),
      trackingData: z.object({
        actualProfit7D: z.number().optional(),
        actualProfit14D: z.number().optional(),
        actualProfit30D: z.number().optional(),
        actualImpressions7d: z.number().optional(),
        actualClicks7d: z.number().optional(),
        actualConversions7d: z.number().optional(),
        actualSpend7D: z.number().optional(),
        actualRevenue7D: z.number().optional(),
      }),
    }))
    .mutation(async ({ input }) => {
      return db.updateBidAdjustmentTracking(input.adjustmentId, input.trackingData);
    }),

  // 运行效果追踪定时任务
  runEffectTrackingTask: protectedProcedure
    .input(z.object({
      period: z.number().default(7), // 7, 14, 或 30 天
    }))
    .mutation(async ({ input }) => {
      const { runEffectTrackingTask } = await import('../effectTrackingScheduler');
      return runEffectTrackingTask(input.period);
    }),

  // 运行所有效果追踪任务
  runAllTrackingTasks: protectedProcedure
    .mutation(async () => {
      const { runAllTrackingTasks } = await import('../effectTrackingScheduler');
      return runAllTrackingTasks();
    }),

  // 获取效果追踪统计摘要
  getTrackingStatsSummary: protectedProcedure
    .query(async () => {
      const { getTrackingStatsSummary } = await import('../effectTrackingScheduler');
      return getTrackingStatsSummary();
    }),

  // 生成效果追踪报告
  generateTrackingReport: protectedProcedure
    .input(z.object({
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      campaignId: z.number().optional(),
      performanceGroupId: z.number().optional(),
    }))
    .query(async ({ input, ctx }) => {
      // 使用输入参数或默认账号ID
      const accountId = 1; // TODO: 从输入参数或用户会话中获取
      
      // 构建查询条件 - bidAdjustmentHistory表使用status字段而不是isRolledBack
      const conditions: unknown[] = [
        eq(bidAdjustmentHistory.accountId, accountId),
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
      
      const dbInstance = await db.getDb();
      if (!dbInstance) {
        return {
          totalRecords: 0,
          trackedRecords: 0,
          totalEstimatedProfit: 0,
          totalActualProfit7d: 0,
          totalActualProfit14d: 0,
          totalActualProfit30d: 0,
          byAdjustmentType: {},
          byCampaign: {},
          records: [],
        };
      }
      
      const records = await dbInstance
        .select()
        .from(bidAdjustmentHistory)
        .where(and(...conditions))
        .orderBy(desc(bidAdjustmentHistory.appliedAt));
      
      // 计算报告统计
      let totalRecords = records.length;
      let trackedRecords = 0;
      let totalEstimatedProfit = 0;
      let totalActualProfit7d = 0;
      let totalActualProfit14d = 0;
      let totalActualProfit30d = 0;
      let count7d = 0, count14d = 0, count30d = 0;
      
      const byAdjustmentType: Record<string, { count: number; estimated: number; actual: number }> = {};
      const byCampaign: Record<number, { name: string; count: number; estimated: number; actual: number }> = {};
      
      for (const record of records) {
        const estimated = parseFloat(record.expectedProfitIncrease || '0');
        totalEstimatedProfit += estimated;
        
        // 按调整类型分组
        const type = record.adjustmentType || 'unknown';
        if (!byAdjustmentType[type]) {
          byAdjustmentType[type] = { count: 0, estimated: 0, actual: 0 };
        }
        byAdjustmentType[type].count++;
        byAdjustmentType[type].estimated += estimated;
        
        // 按广告活动分组
        if (record.campaignId) {
          if (!(byCampaign as any)[record.campaignId]) {
            (byCampaign as any)[record.campaignId] = { name: record.campaignName || '', count: 0, estimated: 0, actual: 0 };
          }
          (byCampaign as any)[record.campaignId].count++;
          (byCampaign as any)[record.campaignId].estimated += estimated;
        }
        
        // 统计已追踪的记录
        if (record.actualProfit7D !== null) {
          const actual = parseFloat(record.actualProfit7D);
          totalActualProfit7d += actual;
          count7d++;
          trackedRecords++;
          byAdjustmentType[type].actual += actual;
          if (record.campaignId && (byCampaign as any)[record.campaignId]) {
            (byCampaign as any)[record.campaignId].actual += actual;
          }
        }
        if (record.actualProfit14D !== null) {
          totalActualProfit14d += parseFloat(record.actualProfit14D);
          count14d++;
        }
        if (record.actualProfit30D !== null) {
          totalActualProfit30d += parseFloat(record.actualProfit30D);
          count30d++;
        }
      }
      
      // 计算准确率
      const calculateAccuracy = (estimated: number, actual: number) => {
        if (estimated === 0) return actual >= 0 ? 100 : 0;
        return Math.min(100, Math.max(0, (1 - Math.abs(actual - estimated) / Math.abs(estimated)) * 100));
      };
      
      return {
        summary: {
          totalRecords,
          trackedRecords,
          trackingRate: totalRecords > 0 ? Math.round(trackedRecords / totalRecords * 100) : 0,
          totalEstimatedProfit: Math.round(totalEstimatedProfit * 100) / 100,
          totalActualProfit7d: Math.round(totalActualProfit7d * 100) / 100,
          totalActualProfit14d: Math.round(totalActualProfit14d * 100) / 100,
          totalActualProfit30d: Math.round(totalActualProfit30d * 100) / 100,
          accuracy7d: count7d > 0 ? Math.round(calculateAccuracy(totalEstimatedProfit, totalActualProfit7d) * 100) / 100 : null,
          accuracy14d: count14d > 0 ? Math.round(calculateAccuracy(totalEstimatedProfit, totalActualProfit14d) * 100) / 100 : null,
          accuracy30d: count30d > 0 ? Math.round(calculateAccuracy(totalEstimatedProfit, totalActualProfit30d) * 100) / 100 : null,
        },
        byAdjustmentType: Object.entries(byAdjustmentType).map(([type, data]) => ({
          type,
          ...data,
          accuracy: calculateAccuracy(data.estimated, data.actual),
        })),
        byCampaign: Object.entries(byCampaign).map(([id, data]) => ({
          campaignId: parseInt(id),
          ...data,
          accuracy: calculateAccuracy(data.estimated, data.actual),
        })),
        records: records.slice(0, 100).map(r => ({
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
          adjustedAt: r.appliedAt,
        })),
      };
    }),

  // 批量回滚出价调整
  batchRollbackBidAdjustments: protectedProcedure
    .input(z.object({
      adjustmentIds: z.array(z.number()),
    }))
    .mutation(async ({ input, ctx }) => {
      const results: { id: number; success: boolean; error?: string }[] = [];
      
      for (const id of input.adjustmentIds) {
        try {
          // v146: 重定向到统一事件表回滚
          const result = await db.rollbackOptimizationEvent(id, ctx.user.name || ctx.user.openId);
          
          if (!result) {
            results.push({ id, success: false, error: '记录不存在或回滚失败' });
            continue;
          }
          
          results.push({ id, success: true });
        } catch (error: unknown) {
          results.push({ id, success: false, error: (error as Error).message });
        }
      }
      
      const successCount = results.filter(r => r.success).length;
      const failCount = results.filter(r => !r.success).length;
      
      return {
        success: failCount === 0,
        message: `批量回滚完成: ${successCount} 成功, ${failCount} 失败`,
        results,
        successCount,
        failCount,
      };
    }),

  // ==================== 边际效益分析（V2新增）====================

  // 计算单个位置的边际效益
  calculateMarginalBenefit: protectedProcedure
    .input(z.object({
      campaignId: z.string(),
      accountId: z.number(),
      placementType: z.enum(['top_of_search', 'product_page', 'rest_of_search']),
      currentAdjustment: z.number().default(0),
      days: z.number().default(30),
    }))
    .query(async ({ input }) => {
      const { calculateMarginalBenefit } = await import('../marginalBenefitAnalysisService');
      return calculateMarginalBenefit(
        input.campaignId,
        input.accountId,
        input.placementType,
        input.currentAdjustment,
        input.days
      );
    }),

  // 优化流量分配
  optimizeTrafficAllocation: protectedProcedure
    .input(z.object({
      campaignId: z.string(),
      accountId: z.number(),
      currentAdjustments: z.object({
        top_of_search: z.number().default(0),
        product_page: z.number().default(0),
        rest_of_search: z.number().default(0),
      }),
      goal: z.enum(['maximize_roas', 'minimize_acos', 'maximize_sales', 'balanced']).default('balanced'),
      constraints: z.object({
        maxTotalAdjustment: z.number().optional(),
        minAdjustmentPerPlacement: z.number().optional(),
        maxAdjustmentPerPlacement: z.number().optional(),
        maxSpendIncrease: z.number().optional(),
        targetACoS: z.number().optional(),
        targetROAS: z.number().optional(),
      }).optional(),
    }))
    .mutation(async ({ input }) => {
      const { optimizeTrafficAllocation } = await import('../marginalBenefitAnalysisService');
      return optimizeTrafficAllocation(
        input.campaignId,
        input.accountId,
        input.currentAdjustments,
        input.goal,
        input.constraints
      );
    }),

  // 批量分析边际效益（带优化建议）
  batchAnalyzeMarginalBenefitsWithOptimization: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      campaignIds: z.array(z.string()),
      optimizationGoal: z.enum(['maximize_roas', 'minimize_acos', 'maximize_sales', 'balanced']).default('balanced'),
      analysisName: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { createBatchAnalysis, executeBatchAnalysis } = await import('../marginalBenefitBatchService');
      
      const analysisId = await createBatchAnalysis({
        accountId: input.accountId,
        userId: ctx.user.id,
        campaignIds: input.campaignIds,
        optimizationGoal: input.optimizationGoal,
        analysisName: input.analysisName,
      });
      
      const result = await executeBatchAnalysis(analysisId, {
        accountId: input.accountId,
        userId: ctx.user.id,
        campaignIds: input.campaignIds,
        optimizationGoal: input.optimizationGoal,
        analysisName: input.analysisName,
      });
      
      return result;
    }),

  // 获取批量分析历史
  getBatchAnalysisHistory: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      limit: z.number().default(10),
    }))
    .query(async ({ input }) => {
      const { getBatchAnalysisHistory } = await import('../marginalBenefitBatchService');
      return getBatchAnalysisHistory(input.accountId, input.limit);
    }),

  // 获取批量分析详情
  getBatchAnalysisDetail: protectedProcedure
    .input(z.object({ analysisId: z.number() }))
    .query(async ({ input }) => {
      const { getBatchAnalysisDetail } = await import('../marginalBenefitBatchService');
      return getBatchAnalysisDetail(input.analysisId);
    }),

  // 一键应用优化建议
  applyOptimization: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      campaignId: z.string(),
      optimizationGoal: z.enum(['maximize_roas', 'minimize_acos', 'maximize_sales', 'balanced']),
      suggestedTopOfSearch: z.number(),
      suggestedProductPage: z.number(),
      expectedSalesChange: z.number(),
      expectedSpendChange: z.number(),
      expectedROASChange: z.number(),
      expectedACoSChange: z.number(),
      note: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { applyOptimization } = await import('../marginalBenefitBatchService');
      return applyOptimization({
        ...input,
        userId: ctx.user.id,
      });
    }),

  // 批量应用优化建议
  batchApplyOptimization: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      applications: z.array(z.object({
        campaignId: z.string(),
        optimizationGoal: z.enum(['maximize_roas', 'minimize_acos', 'maximize_sales', 'balanced']),
        suggestedTopOfSearch: z.number(),
        suggestedProductPage: z.number(),
        expectedSalesChange: z.number(),
        expectedSpendChange: z.number(),
        expectedROASChange: z.number(),
        expectedACoSChange: z.number(),
      })),
    }))
    .mutation(async ({ input, ctx }) => {
      const { batchApplyOptimization } = await import('../marginalBenefitBatchService');
      return batchApplyOptimization(input.accountId, ctx.user.id, input.applications);
    }),

  // 回滚优化应用
  rollbackApplication: protectedProcedure
    .input(z.object({ applicationId: z.number() }))
    .mutation(async ({ input }) => {
      const { rollbackApplication } = await import('../marginalBenefitBatchService');
      return rollbackApplication(input.applicationId);
    }),

  // 获取应用历史
  getApplicationHistory: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      campaignId: z.string().optional(),
      limit: z.number().default(20),
    }))
    .query(async ({ input }) => {
      const { getApplicationHistory } = await import('../marginalBenefitBatchService');
      return getApplicationHistory(input.accountId, input.campaignId, input.limit);
    }),

  // 获取历史趋势数据
  getHistoryTrend: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      campaignId: z.string(),
      placementType: z.enum(['top_of_search', 'product_page', 'rest_of_search']),
      days: z.number().default(30),
    }))
    .query(async ({ input }) => {
      const { getHistoryTrend } = await import('../marginalBenefitHistoryService');
      return getHistoryTrend(input.accountId, input.campaignId, input.days);
    }),

  // 获取季节性模式
  getSeasonalPattern: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      campaignId: z.string(),
      period: z.enum(['weekly', 'monthly']).default('weekly'),
    }))
    .query(async ({ input }) => {
      const { analyzeSeasonalPatterns } = await import('../marginalBenefitHistoryService');
      return analyzeSeasonalPatterns(input.accountId, input.campaignId, input.period);
    }),

  // 时段对比分析
  comparePeriods: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      campaignId: z.string(),
      period1Start: z.string(),
      period1End: z.string(),
      period2Start: z.string(),
      period2End: z.string(),
    }))
    .query(async ({ input }) => {
      const { comparePeriods } = await import('../marginalBenefitHistoryService');
      return comparePeriods(
        input.accountId,
        input.campaignId,
        input.period1Start,
        input.period1End,
        input.period2Start,
        input.period2End
      );
    }),

  // 生成边际效益分析报告
  generateMarginalBenefitReport: protectedProcedure
    .input(z.object({
      campaignId: z.string(),
      accountId: z.number(),
      goal: z.enum(['maximize_roas', 'minimize_acos', 'maximize_sales', 'balanced']).default('balanced'),
    }))
    .query(async ({ input }) => {
      const { 
        calculateMarginalBenefit, 
        optimizeTrafficAllocation, 
        generateMarginalBenefitReport 
      } = await import('../marginalBenefitAnalysisService');
      
      // 获取当前设置
      const currentSettings = await placementService.getCampaignPlacementSettings(
        input.campaignId,
        input.accountId
      );
      
      const currentAdjustments = {
        top_of_search: currentSettings?.top_of_search || 0,
        product_page: currentSettings?.product_page || 0,
        rest_of_search: currentSettings?.rest_of_search || 0,
      };
      
      // 计算各位置的边际效益
      const placements: Array<'top_of_search' | 'product_page' | 'rest_of_search'> = ['top_of_search', 'product_page', 'rest_of_search'];
      const marginalBenefits: Record<string, unknown> = {};
      
      for (const placement of placements) {
        marginalBenefits[placement] = await calculateMarginalBenefit(
          input.campaignId,
          input.accountId,
          placement,
          currentAdjustments[placement],
          30
        );
      }
      
      // 优化流量分配
      const allocationResult = await optimizeTrafficAllocation(
        input.campaignId,
        input.accountId,
        currentAdjustments,
        input.goal
      );
      
      // 生成报告
      const report = generateMarginalBenefitReport(
        marginalBenefits as unknown,
        allocationResult
      );
      
      return {
        marginalBenefits,
        allocationResult,
        report,
      };
    }),
});
