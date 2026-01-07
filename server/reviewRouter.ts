/**
 * 人工审核API路由
 * 
 * 提供否词建议和迁移建议的审核接口
 */

import { z } from "zod";
import { router, protectedProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { 
  generateNegativeKeywordSuggestions, 
  executeNegativeKeywords,
  getNgramAnalysisSummary,
  generateNgramAnalysisReport,
} from "./ngramAnalysis";
import {
  generateMigrationSuggestions,
  detectTrafficConflicts,
  executeTrafficIsolation,
  getMigrationSummary,
} from "./trafficMigration";
import { getDb } from "./db";
// 审核历史表暂未创建
import { eq, and, inArray, sql } from "drizzle-orm";

export const reviewRouter = router({
  // ==================== N-Gram否词审核 ====================
  
  /**
   * 获取N-Gram分析摘要
   */
  getNgramSummary: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      campaignIds: z.array(z.number()).optional(),
      days: z.number().default(30),
    }))
    .query(async ({ input }) => {
      return await getNgramAnalysisSummary(input.accountId, input.campaignIds, input.days);
    }),
  
  /**
   * 获取否词建议列表（供审核）
   */
  getNegativeSuggestions: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      campaignIds: z.array(z.number()).optional(),
      days: z.number().default(30),
    }))
    .query(async ({ input }) => {
      return await generateNegativeKeywordSuggestions(input.accountId, input.campaignIds, input.days);
    }),
  
  /**
   * 获取N-Gram详细分析报告
   */
  getNgramAnalysisReport: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      campaignIds: z.array(z.number()).optional(),
      days: z.number().default(30),
    }))
    .query(async ({ input }) => {
      return await generateNgramAnalysisReport(input.accountId, input.campaignIds, input.days);
    }),
  
  /**
   * 批量审核否词建议
   */
  reviewNegativeSuggestions: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      campaignId: z.number(),
      adGroupId: z.number().nullable(),
      decisions: z.array(z.object({
        ngram: z.string(),
        matchType: z.enum(['phrase', 'exact']),
        action: z.enum(['accept', 'reject']),
      })),
    }))
    .mutation(async ({ input, ctx }) => {
      const accepted = input.decisions.filter(d => d.action === 'accept');
      const rejected = input.decisions.filter(d => d.action === 'reject');
      
      // 执行接受的否词
      let addedCount = 0;
      const errors: string[] = [];
      
      if (accepted.length > 0) {
        const result = await executeNegativeKeywords(
          input.accountId,
          input.campaignId,
          input.adGroupId,
          accepted.map(a => ({ keyword: a.ngram, matchType: a.matchType }))
        );
        addedCount = result.addedCount;
        errors.push(...result.errors);
      }
      
      // 记录审核历史（如果表存在）
      // await recordNegativeReviewHistory(ctx.user.id, input.decisions);
      
      return {
        success: errors.length === 0,
        acceptedCount: accepted.length,
        rejectedCount: rejected.length,
        addedCount,
        errors,
      };
    }),
  
  /**
   * 一键接受全部否词建议
   */
  acceptAllNegativeSuggestions: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      campaignId: z.number(),
      adGroupId: z.number().nullable(),
      days: z.number().default(30),
    }))
    .mutation(async ({ input }) => {
      // 获取所有建议
      const suggestions = await generateNegativeKeywordSuggestions(
        input.accountId,
        [input.campaignId],
        input.days
      );
      
      // 执行全部否词
      const result = await executeNegativeKeywords(
        input.accountId,
        input.campaignId,
        input.adGroupId,
        suggestions.map(s => ({ keyword: s.ngram, matchType: s.matchType }))
      );
      
      return {
        success: result.success,
        totalSuggestions: suggestions.length,
        addedCount: result.addedCount,
        errors: result.errors,
      };
    }),
  
  // ==================== 流量迁移审核 ====================
  
  /**
   * 获取迁移摘要
   */
  getMigrationSummary: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      campaignIds: z.array(z.number()).optional(),
      days: z.number().default(30),
    }))
    .query(async ({ input }) => {
      return await getMigrationSummary(input.accountId, input.campaignIds, input.days);
    }),
  
  /**
   * 获取迁移建议列表（供审核）
   */
  getMigrationSuggestions: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      campaignIds: z.array(z.number()).optional(),
      days: z.number().default(30),
      targetRoas: z.number().default(3.0),
    }))
    .query(async ({ input }) => {
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
  getTrafficConflicts: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      campaignIds: z.array(z.number()).optional(),
      days: z.number().default(30),
    }))
    .query(async ({ input }) => {
      return await detectTrafficConflicts(input.accountId, input.campaignIds, input.days);
    }),
  
  /**
   * 批量审核迁移建议
   */
  reviewMigrationSuggestions: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      decisions: z.array(z.object({
        searchTerm: z.string(),
        sourceCampaignId: z.number(),
        action: z.enum(['accept', 'reject']),
      })),
    }))
    .mutation(async ({ input }) => {
      const accepted = input.decisions.filter(d => d.action === 'accept');
      const rejected = input.decisions.filter(d => d.action === 'reject');
      
      // 执行接受的隔离
      let addedCount = 0;
      const errors: string[] = [];
      
      if (accepted.length > 0) {
        const result = await executeTrafficIsolation(
          input.accountId,
          accepted.map(a => ({
            searchTerm: a.searchTerm,
            campaignId: a.sourceCampaignId,
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
        errors,
      };
    }),
  
  /**
   * 批量审核冲突消解建议
   */
  reviewConflictResolutions: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      decisions: z.array(z.object({
        searchTerm: z.string(),
        winnerCampaignId: z.number(),
        loserCampaignIds: z.array(z.number()),
        action: z.enum(['accept', 'reject']),
      })),
    }))
    .mutation(async ({ input }) => {
      const accepted = input.decisions.filter(d => d.action === 'accept');
      const rejected = input.decisions.filter(d => d.action === 'reject');
      
      // 执行接受的冲突消解
      let addedCount = 0;
      const errors: string[] = [];
      
      for (const decision of accepted) {
        // 在所有loser campaign中添加精准否定
        const result = await executeTrafficIsolation(
          input.accountId,
          decision.loserCampaignIds.map(campaignId => ({
            searchTerm: decision.searchTerm,
            campaignId,
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
        errors,
      };
    }),
  
  /**
   * 一键接受全部冲突消解建议
   */
  acceptAllConflictResolutions: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      campaignIds: z.array(z.number()).optional(),
      days: z.number().default(30),
    }))
    .mutation(async ({ input }) => {
      // 获取所有冲突
      const conflicts = await detectTrafficConflicts(
        input.accountId,
        input.campaignIds,
        input.days
      );
      
      // 执行全部隔离
      let addedCount = 0;
      const errors: string[] = [];
      
      for (const conflict of conflicts) {
        const result = await executeTrafficIsolation(
          input.accountId,
          conflict.losers.map(loser => ({
            searchTerm: conflict.searchTerm,
            campaignId: loser.campaignId,
          }))
        );
        addedCount += result.addedCount;
        errors.push(...result.errors);
      }
      
      return {
        success: errors.length === 0,
        totalConflicts: conflicts.length,
        addedCount,
        errors,
      };
    }),
  
  // ==================== 审核历史 ====================
  
  /**
   * 获取审核历史
   */
  getReviewHistory: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      type: z.enum(['negative', 'migration', 'conflict']).optional(),
      limit: z.number().default(50),
    }))
    .query(async ({ input }) => {
      // 返回空数组，因为审核历史表可能不存在
      return [];
    }),
});

export type ReviewRouter = typeof reviewRouter;
