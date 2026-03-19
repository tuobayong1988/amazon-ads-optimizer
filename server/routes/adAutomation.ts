/**
 * 广告自动化路由
 * 从 routers.ts 拆分的独立路由模块
 */
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as db from "../db";
import * as adAutomation from '../automation/adAutomation';
import { eq, and, gte, lte, desc } from 'drizzle-orm';
import { verifyAccountAccess } from '../utils/accessControl';
import { apiCache } from '../services/apiCacheService';
import { createModuleLogger } from '../utils/logger';
const log = createModuleLogger('Route_adAutomation');


// ==================== Ad Automation Router ====================
export const adAutomationRouter = router({
  // N-Gram词根分析
  analyzeNgrams: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      days: z.number().min(7).max(90).default(30),
    }))
    .query(async ({ input, ctx }: unknown) => {
      await verifyAccountAccess(ctx.user.id, input.accountId);
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
    .query(async ({ input, ctx }: unknown) => {
      await verifyAccountAccess(ctx.user.id, input.accountId);
      const searchTerms = await db.getCampaignSearchTerms(input.accountId);
      // @ts-expect-error - type assertion
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
    .query(async ({ input, ctx }: unknown) => {
      await verifyAccountAccess(ctx.user.id, input.accountId);
      const searchTerms = await db.getCampaignSearchTerms(input.accountId);
      // @ts-expect-error - type assertion
      const conflicts = adAutomation.detectTrafficConflicts(searchTerms as unknown);
      return {
        totalConflicts: conflicts.length,
        totalWastedSpend: conflicts.reduce((sum: number, c: Record<string, unknown>) => sum + c.totalWastedSpend, 0),
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
    .query(async ({ input, ctx }: unknown) => {
      await verifyAccountAccess(ctx.user.id, input.accountId);
      const targets = await db.getBidTargets(input.accountId);
      // @ts-expect-error - type assertion
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
    .query(async ({ input, ctx }: unknown) => {
      await verifyAccountAccess(ctx.user.id, input.accountId);
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
    .query(({ input }: unknown) => {
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
    .mutation(async ({ input, ctx }: unknown) => {
      await verifyAccountAccess(ctx.user.id, input.accountId);
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
    .mutation(async ({ input, ctx }: unknown) => {
      await verifyAccountAccess(ctx.user.id, input.accountId);
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
    .query(async ({ input, ctx }: unknown) => {
      await verifyAccountAccess(ctx.user.id, input.accountId);
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
    .mutation(async ({ input, ctx }: unknown) => {
      await verifyAccountAccess(ctx.user.id, input.accountId);
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
  // v390: 添加缓存层，避免重复计算健康分数
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
    .query(async ({ input, ctx }: unknown) => {
      await verifyAccountAccess(ctx.user.id, input.accountId);
      
      // v390: 缓存健康分析结果 120秒
      const cacheKey = `health.analyze:${ctx.user.id}:${input.accountId}`;
      const cached = apiCache.get<unknown>(cacheKey);
      if (cached) return cached;
      
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
      const totalAlerts = healthScores.reduce((sum: number, h: Record<string, unknown>) => sum + h.alerts.length, 0);
      
      const result = {
        totalCampaigns: healthScores.length,
        criticalCount,
        warningCount,
        healthyCount,
        totalAlerts,
        avgHealthScore: healthScores.length > 0 
          ? Math.round(healthScores.reduce((sum: number, h: Record<string, unknown>) => sum + h.overallScore, 0) / healthScores.length)
          : 0,
        campaigns: healthScores,
      };
      apiCache.set(cacheKey, result, 120 * 1000);
      return result;
    }),

  // v390: 优化getHealthAlerts，复用analyzeCampaignHealth的缓存结果
  getHealthAlerts: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      severity: z.enum(['all', 'critical', 'warning', 'info']).default('all'),
    }))
    .query(async ({ input, ctx }: unknown) => {
      await verifyAccountAccess(ctx.user.id, input.accountId);
      
      // v390: 复用缓存的健康分析结果，避免重复查询和计算
      const healthCacheKey = `health.analyze:${ctx.user.id}:${input.accountId}`;
      let healthResult = apiCache.get<unknown>(healthCacheKey);
      
      if (!healthResult) {
        const campaigns = await db.getCampaignHealthMetrics(input.accountId);
        const healthScores = adAutomation.analyzeCampaignHealth(campaigns);
        healthResult = { campaigns: healthScores };
      }
      
      let allAlerts = (healthResult.campaigns || []).flatMap((h: unknown) => h.alerts || []);
      
      if (input.severity !== 'all') {
        allAlerts = allAlerts.filter((a: unknown) => a.severity === input.severity);
      }
      
      // 按严重程度排序
      const severityOrder: Record<string, number> = { critical: 0, warning: 1, info: 2 };
      allAlerts.sort((a: unknown, b: unknown) => (severityOrder[a.severity] ?? 3) - (severityOrder[b.severity] ?? 3));
      
      return {
        totalAlerts: allAlerts.length,
        criticalCount: allAlerts.filter((a: unknown) => a.severity === 'critical').length,
        warningCount: allAlerts.filter((a: unknown) => a.severity === 'warning').length,
        infoCount: allAlerts.filter((a: unknown) => a.severity === 'info').length,
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
    .query(({ input }: unknown) => {
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
    .query(({ input }: unknown) => {
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
    .mutation(async ({ ctx, input }: unknown) => {
      const validation = adAutomation.validateNegativeKeywordBatch(input.items);
      
      let successCount = 0;
      const errors: { keyword: string; error: string }[] = [];
      const syncTasks: Array<Record<string, unknown>> = [];
      
      for (const item of validation.valid) {
        try {
          await db.addNegativeKeyword({
            campaignId: item.campaignId,
            adGroupId: item.adGroupId,
            keyword: item.keyword,
            matchType: item.matchType,
            level: item.level,
          });
          // v453: 创建Amazon API同步任务，确保否定词真正同步到Amazon
          syncTasks.push({
            accountId: input.accountId,
            taskType: 'negative_keyword',
            targetEntityType: item.level === 'ad_group' ? 'ad_group' : 'campaign',
            targetEntityId: item.campaignId,
            targetEntityName: item.keyword,
            action: item.matchType === 'exact' ? 'add_negative_exact' : 'add_negative_phrase',
            source: 'manual_batch',
            priority: 'high',
          });
          successCount++;
        } catch (error: unknown) {
          errors.push({ keyword: item.keyword, error: (error as Error).message });
        }
      }
      
      // v453: 将同步任务入队到优化同步引擎，确保否定词通过Amazon API真正生效
      if (syncTasks.length > 0) {
        try {
          const { enqueueTasks } = await import('../sync/optimizationSyncEngine');
          await enqueueTasks(syncTasks as unknown[]);
          log.info(`[AdAutomation] v453: 已入队 ${syncTasks.length} 个否定词同步任务到Amazon API`);
        } catch (enqueueErr: unknown) {
          log.error(`[AdAutomation] v453: 否定词同步任务入队失败: ${(enqueueErr as Error).message}`);
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
    .mutation(async ({ ctx, input }: unknown) => {
      const validation = adAutomation.validateBidAdjustmentBatch(input.items);
      
      let successCount = 0;
      const errors: { targetName: string; error: string }[] = [];
      const syncTasks: Array<Record<string, unknown>> = [];
      
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
          // v453: 创建Amazon API同步任务，确保出价调整真正同步到Amazon
          syncTasks.push({
            accountId: input.accountId,
            taskType: item.targetType === 'keyword' ? 'bid' : 'product_target_bid',
            targetEntityType: item.targetType,
            targetEntityId: item.targetId,
            targetEntityName: item.targetName,
            action: 'adjust_bid',
            newValue: String(item.newBid),
            oldValue: String(item.currentBid),
            source: 'manual_batch',
            priority: 'high',
          });
          successCount++;
        } catch (error: unknown) {
          errors.push({ targetName: item.targetName, error: (error as Error).message });
        }
      }
      
      // v453: 将同步任务入队到优化同步引擎，确保出价调整通过Amazon API真正生效
      if (syncTasks.length > 0) {
        try {
          const { enqueueTasks } = await import('../sync/optimizationSyncEngine');
          await enqueueTasks(syncTasks as unknown[]);
          log.info(`[AdAutomation] v453: 已入队 ${syncTasks.length} 个出价调整同步任务到Amazon API`);
        } catch (enqueueErr: unknown) {
          log.error(`[AdAutomation] v453: 出价调整同步任务入队失败: ${(enqueueErr as Error).message}`);
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
    .query(({ input }: unknown) => {
      return adAutomation.generateBatchOperationSummary(input.negativeItems, input.bidItems);
    }),
});
