/**
 * 广告自动化路由
 * 从 routers.ts 拆分的独立路由模块
 */
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as db from "../db";
import * as adAutomation from '../adAutomation';
import { eq, and, gte, lte, desc } from 'drizzle-orm';


// ==================== Ad Automation Router ====================
export const adAutomationRouter = router({
  // N-Gram词根分析
  analyzeNgrams: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      days: z.number().min(7).max(90).default(30),
    }))
    .query(async ({ input }) => {
      // 获取搜索词数据
      const searchTerms = await db.getSearchTermsForAnalysis(input.accountId, input.days);
      const results = adAutomation.analyzeNgrams(searchTerms);
      return {
        totalTermsAnalyzed: searchTerms.length,
        negativeNgramCandidates: results.filter(r => r.isNegativeCandidate),
        allNgrams: results.slice(0, 100), // 返回前100个
      };
    }),

  // 广告漏斗迁移分析
  analyzeFunnelMigration: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      broadToPhraseMinConversions: z.number().default(3),
      phraseToExactMinConversions: z.number().default(10),
      phraseToExactMinRoas: z.number().default(5),
    }))
    .query(async ({ input }) => {
      const searchTerms = await db.getCampaignSearchTerms(input.accountId);
      const suggestions = adAutomation.analyzeFunnelMigration(searchTerms as unknown, {
        broadToPhrase: { minConversions: input.broadToPhraseMinConversions, minRoas: 1 },
        phraseToExact: { minConversions: input.phraseToExactMinConversions, minRoas: input.phraseToExactMinRoas },
        bidIncreasePercent: 20,
      });
      return {
        totalSuggestions: suggestions.length,
        broadToPhrase: suggestions.filter(s => s.toMatchType === 'phrase'),
        phraseToExact: suggestions.filter(s => s.toMatchType === 'exact'),
      };
    }),

  // 流量冲突检测
  detectTrafficConflicts: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .query(async ({ input }) => {
      const searchTerms = await db.getCampaignSearchTerms(input.accountId);
      const conflicts = adAutomation.detectTrafficConflicts(searchTerms as unknown);
      return {
        totalConflicts: conflicts.length,
        totalWastedSpend: conflicts.reduce((sum, c) => sum + c.totalWastedSpend, 0),
        conflicts: conflicts.slice(0, 50), // 返回前50个
      };
    }),

  // 智能竞价调整建议
  analyzeBidAdjustments: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      targetAcos: z.number().default(30),
      targetRoas: z.number().default(3.33),
    }))
    .query(async ({ input }) => {
      const targets = await db.getBidTargets(input.accountId);
      const suggestions = adAutomation.analyzeBidAdjustments(targets as unknown, {
        rampUpPercent: 5,
        maxBidMultiplier: 3,
        minImpressions: 100,
        correctionWindow: 14,
        targetAcos: input.targetAcos,
        targetRoas: input.targetRoas,
      });
      return {
        totalSuggestions: suggestions.length,
        urgentCount: suggestions.filter(s => s.priority === 'urgent').length,
        highCount: suggestions.filter(s => s.priority === 'high').length,
        suggestions: suggestions.slice(0, 100),
      };
    }),

  // 搜索词分类
  classifySearchTerms: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      productKeywords: z.array(z.string()),
      productCategory: z.string(),
      productBrand: z.string(),
      productColors: z.array(z.string()).optional(),
      productSizes: z.array(z.string()).optional(),
    }))
    .query(async ({ input }) => {
      const searchTerms = await db.getUniqueSearchTerms(input.accountId);
      const classifications = adAutomation.classifySearchTerms(
        searchTerms,
        input.productKeywords,
        {
          category: input.productCategory,
          brand: input.productBrand,
          colors: input.productColors,
          sizes: input.productSizes,
        }
      );
      return {
        totalClassified: classifications.length,
        highRelevance: classifications.filter(c => c.relevance === 'high'),
        weakRelevance: classifications.filter(c => c.relevance === 'weak'),
        seeminglyRelated: classifications.filter(c => c.relevance === 'seemingly_related'),
        unrelated: classifications.filter(c => c.relevance === 'unrelated'),
      };
    }),

  // 获取否词前置列表
  getPresetNegatives: protectedProcedure
    .input(z.object({
      productCategory: z.string(),
    }))
    .query(({ input }) => {
      const presets = adAutomation.getPresetNegativeKeywords(input.productCategory);
      return {
        totalPresets: presets.length,
        presets,
      };
    }),

  // 批量应用否定词
  applyNegativeKeywords: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      campaignId: z.number(),
      negatives: z.array(z.object({
        keyword: z.string(),
        matchType: z.enum(['phrase', 'exact']),
      })),
    }))
    .mutation(async ({ input }) => {
      // 这里可以调用Amazon API添加否定词
      // 目前先记录到数据库
      let addedCount = 0;
      for (const neg of input.negatives) {
        await db.addNegativeKeyword({
          campaignId: input.campaignId,
          keyword: neg.keyword,
          matchType: neg.matchType,
        });
        addedCount++;
      }
      return { addedCount };
    }),

  // 执行漏斗迁移
  executeFunnelMigration: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      migrations: z.array(z.object({
        searchTerm: z.string(),
        fromCampaignId: z.number(),
        toMatchType: z.enum(['phrase', 'exact']),
        suggestedBid: z.number(),
      })),
    }))
    .mutation(async ({ input }) => {
      // 记录迁移操作
      let migratedCount = 0;
      for (const migration of input.migrations) {
        // 在目标匹配类型的广告组中添加关键词
        // 在原广告组中添加否定词
        await db.recordMigration({
          accountId: input.accountId,
          searchTerm: migration.searchTerm,
          fromCampaignId: migration.fromCampaignId,
          toMatchType: migration.toMatchType,
          suggestedBid: migration.suggestedBid,
          status: 'pending',
        });
        migratedCount++;
      }
      return { migratedCount };
    }),

  // ==================== 半月纠错复盘 ====================
  analyzeBidCorrections: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      attributionWindowDays: z.number().min(7).max(30).default(14),
    }))
    .query(async ({ input }) => {
      // 获取过去30天的出价变更记录
      const bidChanges = await db.getBidChangeRecords(input.accountId, 30);
      const corrections = adAutomation.analyzeBidCorrections(bidChanges, input.attributionWindowDays);
      
      return {
        totalAnalyzed: bidChanges.length,
        totalCorrections: corrections.length,
        urgentCount: corrections.filter(c => c.priority === 'urgent').length,
        highCount: corrections.filter(c => c.priority === 'high').length,
        corrections: corrections.slice(0, 50),
        summary: {
          prematureDecrease: corrections.filter(c => c.errorType === 'premature_decrease').length,
          prematureIncrease: corrections.filter(c => c.errorType === 'premature_increase').length,
          overAdjustment: corrections.filter(c => c.errorType === 'over_adjustment').length,
          attributionDelay: corrections.filter(c => c.errorType === 'attribution_delay').length,
        },
      };
    }),

  // 执行纠错操作
  applyCorrections: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      corrections: z.array(z.object({
        targetId: z.number(),
        targetType: z.enum(['keyword', 'product']),
        currentBid: z.number(),
        suggestedBid: z.number(),
        reason: z.string(),
      })),
    }))
    .mutation(async ({ input }) => {
      let appliedCount = 0;
      for (const correction of input.corrections) {
        await db.recordBidChange({
          accountId: input.accountId,
          targetId: correction.targetId,
          targetType: correction.targetType,
          oldBid: correction.currentBid,
          newBid: correction.suggestedBid,
          reason: `纠错复盘: ${correction.reason}`,
        });
        appliedCount++;
      }
      return { appliedCount };
    }),

  // ==================== 广告活动健康度监控 ====================
  analyzeCampaignHealth: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      acosWarning: z.number().default(35),
      acosCritical: z.number().default(50),
      ctrDropWarning: z.number().default(-20),
      ctrDropCritical: z.number().default(-40),
      cvrDropWarning: z.number().default(-25),
      cvrDropCritical: z.number().default(-50),
      roasMinimum: z.number().default(2),
    }))
    .query(async ({ input }) => {
      const campaigns = await db.getCampaignHealthMetrics(input.accountId);
      const healthScores = adAutomation.analyzeCampaignHealth(campaigns, {
        acosWarning: input.acosWarning,
        acosCritical: input.acosCritical,
        ctrDropWarning: input.ctrDropWarning,
        ctrDropCritical: input.ctrDropCritical,
        cvrDropWarning: input.cvrDropWarning,
        cvrDropCritical: input.cvrDropCritical,
        roasMinimum: input.roasMinimum,
      });
      
      const criticalCount = healthScores.filter(h => h.status === 'critical').length;
      const warningCount = healthScores.filter(h => h.status === 'warning').length;
      const healthyCount = healthScores.filter(h => h.status === 'healthy').length;
      const totalAlerts = healthScores.reduce((sum, h) => sum + h.alerts.length, 0);
      
      return {
        totalCampaigns: healthScores.length,
        criticalCount,
        warningCount,
        healthyCount,
        totalAlerts,
        avgHealthScore: healthScores.length > 0 
          ? Math.round(healthScores.reduce((sum, h) => sum + h.overallScore, 0) / healthScores.length)
          : 0,
        campaigns: healthScores,
      };
    }),

  // 获取健康预警列表
  getHealthAlerts: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      severity: z.enum(['all', 'critical', 'warning', 'info']).default('all'),
    }))
    .query(async ({ input }) => {
      const campaigns = await db.getCampaignHealthMetrics(input.accountId);
      const healthScores = adAutomation.analyzeCampaignHealth(campaigns);
      
      let allAlerts = healthScores.flatMap(h => h.alerts);
      
      if (input.severity !== 'all') {
        allAlerts = allAlerts.filter(a => a.severity === input.severity);
      }
      
      // 按严重程度排序
      const severityOrder = { critical: 0, warning: 1, info: 2 };
      allAlerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
      
      return {
        totalAlerts: allAlerts.length,
        criticalCount: allAlerts.filter(a => a.severity === 'critical').length,
        warningCount: allAlerts.filter(a => a.severity === 'warning').length,
        infoCount: allAlerts.filter(a => a.severity === 'info').length,
        alerts: allAlerts,
      };
    }),

  // ==================== 批量操作 ====================
  validateBatchNegatives: protectedProcedure
    .input(z.object({
      items: z.array(z.object({
        keyword: z.string(),
        matchType: z.enum(['phrase', 'exact']),
        level: z.enum(['ad_group', 'campaign']),
        campaignId: z.number(),
        adGroupId: z.number().optional(),
        reason: z.string(),
      })),
    }))
    .query(({ input }) => {
      const result = adAutomation.validateNegativeKeywordBatch(input.items);
      return {
        validCount: result.valid.length,
        invalidCount: result.invalid.length,
        valid: result.valid,
        invalid: result.invalid,
      };
    }),

  validateBatchBidAdjustments: protectedProcedure
    .input(z.object({
      items: z.array(z.object({
        targetId: z.number(),
        targetName: z.string(),
        targetType: z.enum(['keyword', 'product']),
        campaignId: z.number(),
        currentBid: z.number(),
        newBid: z.number(),
        adjustmentPercent: z.number(),
        reason: z.string(),
      })),
      maxBid: z.number().default(10),
      minBid: z.number().default(0.02),
      maxAdjustmentPercent: z.number().default(100),
    }))
    .query(({ input }) => {
      const result = adAutomation.validateBidAdjustmentBatch(
        input.items,
        input.maxBid,
        input.minBid,
        input.maxAdjustmentPercent
      );
      return {
        validCount: result.valid.length,
        invalidCount: result.invalid.length,
        valid: result.valid,
        invalid: result.invalid,
      };
    }),

  executeBatchNegatives: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      items: z.array(z.object({
        keyword: z.string(),
        matchType: z.enum(['phrase', 'exact']),
        level: z.enum(['ad_group', 'campaign']),
        campaignId: z.number(),
        adGroupId: z.number().optional(),
        reason: z.string(),
      })),
    }))
    .mutation(async ({ input }) => {
      const validation = adAutomation.validateNegativeKeywordBatch(input.items);
      
      let successCount = 0;
      const errors: { keyword: string; error: string }[] = [];
      
      for (const item of validation.valid) {
        try {
          await db.addNegativeKeyword({
            campaignId: item.campaignId,
            adGroupId: item.adGroupId,
            keyword: item.keyword,
            matchType: item.matchType,
            level: item.level,
          });
          successCount++;
        } catch (error: unknown) {
          errors.push({ keyword: item.keyword, error: (error as Error).message });
        }
      }
      
      return {
        successCount,
        failedCount: validation.invalid.length + errors.length,
        validationErrors: validation.invalid.map(i => ({ keyword: i.item.keyword, error: i.reason })),
        executionErrors: errors,
      };
    }),

  executeBatchBidAdjustments: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      items: z.array(z.object({
        targetId: z.number(),
        targetName: z.string(),
        targetType: z.enum(['keyword', 'product']),
        campaignId: z.number(),
        currentBid: z.number(),
        newBid: z.number(),
        adjustmentPercent: z.number(),
        reason: z.string(),
      })),
    }))
    .mutation(async ({ input }) => {
      const validation = adAutomation.validateBidAdjustmentBatch(input.items);
      
      let successCount = 0;
      const errors: { targetName: string; error: string }[] = [];
      
      for (const item of validation.valid) {
        try {
          await db.recordBidChange({
            accountId: input.accountId,
            targetId: item.targetId,
            targetType: item.targetType,
            oldBid: item.currentBid,
            newBid: item.newBid,
            reason: item.reason,
          });
          successCount++;
        } catch (error: unknown) {
          errors.push({ targetName: item.targetName, error: (error as Error).message });
        }
      }
      
      return {
        successCount,
        failedCount: validation.invalid.length + errors.length,
        validationErrors: validation.invalid.map(i => ({ targetName: i.item.targetName, error: i.reason })),
        executionErrors: errors,
      };
    }),

  getBatchOperationSummary: protectedProcedure
    .input(z.object({
      negativeItems: z.array(z.object({
        keyword: z.string(),
        matchType: z.enum(['phrase', 'exact']),
        level: z.enum(['ad_group', 'campaign']),
        campaignId: z.number(),
        adGroupId: z.number().optional(),
        reason: z.string(),
      })),
      bidItems: z.array(z.object({
        targetId: z.number(),
        targetName: z.string(),
        targetType: z.enum(['keyword', 'product']),
        campaignId: z.number(),
        currentBid: z.number(),
        newBid: z.number(),
        adjustmentPercent: z.number(),
        reason: z.string(),
      })),
    }))
    .query(({ input }) => {
      return adAutomation.generateBatchOperationSummary(input.negativeItems, input.bidItems);
    }),
});
