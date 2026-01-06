import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as db from "./db";
import * as bidOptimizer from "./bidOptimizer";
import { AmazonAdsApiClient, validateCredentials, API_ENDPOINTS, MARKETPLACE_TO_REGION } from './amazonAdsApi';
import * as adAutomation from './adAutomation';
import { AmazonSyncService, runAutoBidOptimization } from './amazonSyncService';
import * as notificationService from './notificationService';
import * as schedulerService from './schedulerService';
import * as batchOperationService from './batchOperationService';
import * as correctionService from './correctionService';

// ==================== Ad Account Router ====================
const adAccountRouter = router({
  // 获取用户所有账号列表
  list: protectedProcedure.query(async ({ ctx }) => {
    return db.getAdAccountsByUserId(ctx.user.id);
  }),
  
  // 获取单个账号详情
  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return db.getAdAccountById(input.id);
    }),
  
  // 获取默认账号
  getDefault: protectedProcedure.query(async ({ ctx }) => {
    return db.getDefaultAdAccount(ctx.user.id);
  }),
  
  // 创建新账号
  create: protectedProcedure
    .input(z.object({
      accountId: z.string(),
      accountName: z.string(),
      storeName: z.string().optional(),
      storeDescription: z.string().optional(),
      storeColor: z.string().optional(),
      marketplace: z.string(),
      marketplaceId: z.string().optional(),
      profileId: z.string().optional(),
      sellerId: z.string().optional(),
      isDefault: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // 如果设置为默认账号，先取消其他默认
      if (input.isDefault) {
        const accounts = await db.getAdAccountsByUserId(ctx.user.id);
        for (const acc of accounts) {
          if (acc.isDefault) {
            await db.updateAdAccount(acc.id, { isDefault: false });
          }
        }
      }
      
      const id = await db.createAdAccount({
        userId: ctx.user.id,
        ...input,
        connectionStatus: 'pending',
      });
      return { id };
    }),
  
  // 更新账号信息
  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      accountName: z.string().optional(),
      storeName: z.string().optional(),
      storeDescription: z.string().optional(),
      storeColor: z.string().optional(),
      marketplace: z.string().optional(),
      marketplaceId: z.string().optional(),
      profileId: z.string().optional(),
      sellerId: z.string().optional(),
      conversionValueType: z.enum(["sales", "units", "custom"]).optional(),
      conversionValueSource: z.enum(["platform", "custom"]).optional(),
      intradayBiddingEnabled: z.boolean().optional(),
      defaultMaxBid: z.string().optional(),
      status: z.enum(["active", "paused", "archived"]).optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await db.updateAdAccount(id, data);
      return { success: true };
    }),
  
  // 删除账号
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      // 验证账号属于当前用户
      const account = await db.getAdAccountById(input.id);
      if (!account || account.userId !== ctx.user.id) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '账号不存在' });
      }
      await db.deleteAdAccount(input.id);
      return { success: true };
    }),
  
  // 设置默认账号
  setDefault: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      // 验证账号属于当前用户
      const account = await db.getAdAccountById(input.id);
      if (!account || account.userId !== ctx.user.id) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '账号不存在' });
      }
      await db.setDefaultAdAccount(ctx.user.id, input.id);
      return { success: true };
    }),
  
  // 调整账号排序
  reorder: protectedProcedure
    .input(z.object({ accountIds: z.array(z.number()) }))
    .mutation(async ({ ctx, input }) => {
      await db.reorderAdAccounts(ctx.user.id, input.accountIds);
      return { success: true };
    }),
  
  // 更新账号连接状态
  updateConnectionStatus: protectedProcedure
    .input(z.object({
      id: z.number(),
      status: z.enum(['connected', 'disconnected', 'error', 'pending']),
      errorMessage: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // 验证账号属于当前用户
      const account = await db.getAdAccountById(input.id);
      if (!account || account.userId !== ctx.user.id) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '账号不存在' });
      }
      await db.updateAdAccountConnectionStatus(input.id, input.status, input.errorMessage);
      return { success: true };
    }),
  
  // 获取账号统计信息
  getStats: protectedProcedure.query(async ({ ctx }) => {
    const accounts = await db.getAdAccountsByUserId(ctx.user.id);
    const stats = {
      total: accounts.length,
      connected: accounts.filter(a => a.connectionStatus === 'connected').length,
      disconnected: accounts.filter(a => a.connectionStatus === 'disconnected').length,
      error: accounts.filter(a => a.connectionStatus === 'error').length,
      pending: accounts.filter(a => a.connectionStatus === 'pending').length,
      byMarketplace: {} as Record<string, number>,
    };
    
    for (const account of accounts) {
      stats.byMarketplace[account.marketplace] = (stats.byMarketplace[account.marketplace] || 0) + 1;
    }
    
    return stats;
  }),
});

// ==================== Performance Group Router ====================
const performanceGroupRouter = router({
  list: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .query(async ({ input }) => {
      return db.getPerformanceGroupsByAccountId(input.accountId);
    }),
  
  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return db.getPerformanceGroupById(input.id);
    }),
  
  create: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      name: z.string(),
      description: z.string().optional(),
      optimizationGoal: z.enum(["maximize_sales", "target_acos", "target_roas", "daily_spend_limit", "daily_cost"]),
      targetAcos: z.string().optional(),
      targetRoas: z.string().optional(),
      dailySpendLimit: z.string().optional(),
      dailyCostTarget: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const id = await db.createPerformanceGroup({
        userId: ctx.user.id,
        ...input,
      });
      return { id };
    }),
  
  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().optional(),
      description: z.string().optional(),
      optimizationGoal: z.enum(["maximize_sales", "target_acos", "target_roas", "daily_spend_limit", "daily_cost"]).optional(),
      targetAcos: z.string().optional(),
      targetRoas: z.string().optional(),
      dailySpendLimit: z.string().optional(),
      dailyCostTarget: z.string().optional(),
      status: z.enum(["active", "paused", "archived"]).optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await db.updatePerformanceGroup(id, data);
      return { success: true };
    }),
  
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.deletePerformanceGroup(input.id);
      return { success: true };
    }),
  
  getCampaigns: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return db.getCampaignsByPerformanceGroupId(input.id);
    }),
  
  assignCampaign: protectedProcedure
    .input(z.object({
      campaignId: z.number(),
      performanceGroupId: z.number().nullable(),
    }))
    .mutation(async ({ input }) => {
      await db.assignCampaignToPerformanceGroup(input.campaignId, input.performanceGroupId);
      return { success: true };
    }),
});

// ==================== Campaign Router ====================
const campaignRouter = router({
  list: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .query(async ({ input }) => {
      return db.getCampaignsByAccountId(input.accountId);
    }),
  
  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return db.getCampaignById(input.id);
    }),
  
  create: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      campaignId: z.string(),
      campaignName: z.string(),
      campaignType: z.enum(["sp_auto", "sp_manual", "sb", "sd"]),
      targetingType: z.enum(["auto", "manual"]).optional(),
      performanceGroupId: z.number().optional(),
      maxBid: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const id = await db.createCampaign(input);
      return { id };
    }),
  
  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      campaignName: z.string().optional(),
      maxBid: z.string().optional(),
      intradayBiddingEnabled: z.boolean().optional(),
      placementTopSearchBidAdjustment: z.number().optional(),
      placementProductPageBidAdjustment: z.number().optional(),
      placementRestBidAdjustment: z.number().optional(),
      status: z.enum(["enabled", "paused", "archived"]).optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await db.updateCampaign(id, data);
      return { success: true };
    }),
  
  getAdGroups: protectedProcedure
    .input(z.object({ campaignId: z.number() }))
    .query(async ({ input }) => {
      return db.getAdGroupsByCampaignId(input.campaignId);
    }),
});

// ==================== Keyword Router ====================
const keywordRouter = router({
  list: protectedProcedure
    .input(z.object({ adGroupId: z.number() }))
    .query(async ({ input }) => {
      return db.getKeywordsByAdGroupId(input.adGroupId);
    }),
  
  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return db.getKeywordById(input.id);
    }),
  
  updateBid: protectedProcedure
    .input(z.object({
      id: z.number(),
      bid: z.string(),
    }))
    .mutation(async ({ input }) => {
      await db.updateKeywordBid(input.id, input.bid);
      return { success: true };
    }),
  
  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      bid: z.string().optional(),
      status: z.enum(["enabled", "paused", "archived"]).optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await db.updateKeyword(id, data);
      return { success: true };
    }),
  
  getMarketCurve: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const keyword = await db.getKeywordById(input.id);
      if (!keyword) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Keyword not found" });
      }
      
      const target: bidOptimizer.OptimizationTarget = {
        id: keyword.id,
        type: "keyword",
        currentBid: parseFloat(keyword.bid),
        impressions: keyword.impressions || 0,
        clicks: keyword.clicks || 0,
        spend: parseFloat(keyword.spend || "0"),
        sales: parseFloat(keyword.sales || "0"),
        orders: keyword.orders || 0,
        matchType: keyword.matchType,
      };
      
      return bidOptimizer.generateMarketCurve(target);
    }),
});

// ==================== Product Target Router ====================
const productTargetRouter = router({
  list: protectedProcedure
    .input(z.object({ adGroupId: z.number() }))
    .query(async ({ input }) => {
      return db.getProductTargetsByAdGroupId(input.adGroupId);
    }),
  
  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return db.getProductTargetById(input.id);
    }),
  
  updateBid: protectedProcedure
    .input(z.object({
      id: z.number(),
      bid: z.string(),
    }))
    .mutation(async ({ input }) => {
      await db.updateProductTargetBid(input.id, input.bid);
      return { success: true };
    }),
});

// ==================== Bidding Log Router ====================
const biddingLogRouter = router({
  list: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      limit: z.number().optional().default(100),
      offset: z.number().optional().default(0),
    }))
    .query(async ({ input }) => {
      const [logs, total] = await Promise.all([
        db.getBiddingLogsByAccountId(input.accountId, input.limit, input.offset),
        db.getBiddingLogsCount(input.accountId),
      ]);
      return { logs, total };
    }),
  
  listByCampaign: protectedProcedure
    .input(z.object({
      campaignId: z.number(),
      limit: z.number().optional().default(100),
    }))
    .query(async ({ input }) => {
      return db.getBiddingLogsByCampaignId(input.campaignId, input.limit);
    }),
});

// ==================== Analytics Router ====================
const analyticsRouter = router({
  getDailyPerformance: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      startDate: z.string(),
      endDate: z.string(),
      campaignId: z.number().optional(),
    }))
    .query(async ({ input }) => {
      return db.getDailyPerformanceByDateRange(
        input.accountId,
        new Date(input.startDate),
        new Date(input.endDate),
        input.campaignId
      );
    }),
  
  getSummary: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      startDate: z.string(),
      endDate: z.string(),
    }))
    .query(async ({ input }) => {
      return db.getPerformanceSummary(
        input.accountId,
        new Date(input.startDate),
        new Date(input.endDate)
      );
    }),
  
  getKPIs: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .query(async ({ input }) => {
      // Get last 30 days performance
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 30);
      
      const summary = await db.getPerformanceSummary(input.accountId, startDate, endDate);
      
      if (!summary) {
        return {
          conversionsPerDay: 0,
          roas: 0,
          totalSales: 0,
          acos: 0,
          revenuePerDay: 0,
          totalSpend: 0,
          totalOrders: 0,
          totalClicks: 0,
          totalImpressions: 0,
        };
      }
      
      const days = 30;
      const totalSpend = parseFloat(summary.totalSpend || "0");
      const totalSales = parseFloat(summary.totalSales || "0");
      
      return {
        conversionsPerDay: (summary.totalConversions || 0) / days,
        roas: totalSpend > 0 ? totalSales / totalSpend : 0,
        totalSales,
        acos: totalSales > 0 ? (totalSpend / totalSales) * 100 : 0,
        revenuePerDay: totalSales / days,
        totalSpend,
        totalOrders: summary.totalOrders || 0,
        totalClicks: summary.totalClicks || 0,
        totalImpressions: summary.totalImpressions || 0,
      };
    }),
});

// ==================== Optimization Router ====================
const optimizationRouter = router({
  runOptimization: protectedProcedure
    .input(z.object({
      performanceGroupId: z.number(),
      dryRun: z.boolean().optional().default(true),
    }))
    .mutation(async ({ input }) => {
      const group = await db.getPerformanceGroupById(input.performanceGroupId);
      if (!group) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Performance group not found" });
      }
      
      const campaigns = await db.getCampaignsByPerformanceGroupId(input.performanceGroupId);
      const results: bidOptimizer.OptimizationResult[] = [];
      
      const config: bidOptimizer.PerformanceGroupConfig = {
        optimizationGoal: group.optimizationGoal || "maximize_sales",
        targetAcos: group.targetAcos ? parseFloat(group.targetAcos) : undefined,
        targetRoas: group.targetRoas ? parseFloat(group.targetRoas) : undefined,
        dailySpendLimit: group.dailySpendLimit ? parseFloat(group.dailySpendLimit) : undefined,
        dailyCostTarget: group.dailyCostTarget ? parseFloat(group.dailyCostTarget) : undefined,
      };
      
      for (const campaign of campaigns) {
        const adGroups = await db.getAdGroupsByCampaignId(campaign.id);
        
        for (const adGroup of adGroups) {
          // Optimize keywords
          const keywords = await db.getKeywordsByAdGroupId(adGroup.id);
          const keywordTargets: bidOptimizer.OptimizationTarget[] = keywords.map(k => ({
            id: k.id,
            type: "keyword" as const,
            currentBid: parseFloat(k.bid),
            impressions: k.impressions || 0,
            clicks: k.clicks || 0,
            spend: parseFloat(k.spend || "0"),
            sales: parseFloat(k.sales || "0"),
            orders: k.orders || 0,
            matchType: k.matchType,
          }));
          
          const keywordResults = bidOptimizer.optimizePerformanceGroup(
            keywordTargets,
            config,
            campaign.maxBid ? parseFloat(campaign.maxBid) : 10.00
          );
          results.push(...keywordResults);
          
          // Optimize product targets
          const targets = await db.getProductTargetsByAdGroupId(adGroup.id);
          const productTargets: bidOptimizer.OptimizationTarget[] = targets.map(t => ({
            id: t.id,
            type: "product_target" as const,
            currentBid: parseFloat(t.bid),
            impressions: t.impressions || 0,
            clicks: t.clicks || 0,
            spend: parseFloat(t.spend || "0"),
            sales: parseFloat(t.sales || "0"),
            orders: t.orders || 0,
          }));
          
          const targetResults = bidOptimizer.optimizePerformanceGroup(
            productTargets,
            config,
            campaign.maxBid ? parseFloat(campaign.maxBid) : 10.00
          );
          results.push(...targetResults);
        }
      }
      
      // If not dry run, apply the changes and log them
      if (!input.dryRun) {
        for (const result of results) {
          if (result.targetType === "keyword") {
            await db.updateKeywordBid(result.targetId, result.newBid.toString());
          } else {
            await db.updateProductTargetBid(result.targetId, result.newBid.toString());
          }
          
          // Get campaign info for logging
          let campaignId = 0;
          let adGroupId = 0;
          let targetName = "";
          let matchType = "";
          
          if (result.targetType === "keyword") {
            const keyword = await db.getKeywordById(result.targetId);
            if (keyword) {
              const adGroup = await db.getAdGroupById(keyword.adGroupId);
              if (adGroup) {
                adGroupId = adGroup.id;
                campaignId = adGroup.campaignId;
              }
              targetName = keyword.keywordText;
              matchType = keyword.matchType;
            }
          } else {
            const target = await db.getProductTargetById(result.targetId);
            if (target) {
              const adGroup = await db.getAdGroupById(target.adGroupId);
              if (adGroup) {
                adGroupId = adGroup.id;
                campaignId = adGroup.campaignId;
              }
              targetName = `ASIN: ${target.targetValue}`;
            }
          }
          
          // Create bidding log
          await db.createBiddingLog({
            accountId: group.accountId,
            campaignId,
            adGroupId,
            targetType: result.targetType,
            targetId: result.targetId,
            targetName,
            matchType: matchType || undefined,
            actionType: result.actionType,
            previousBid: result.previousBid.toString(),
            newBid: result.newBid.toString(),
            bidChangePercent: result.bidChangePercent.toString(),
            reason: result.reason,
            algorithmVersion: "1.0.0",
            isIntradayAdjustment: false,
          });
        }
      }
      
      return {
        totalOptimizations: results.length,
        results,
        applied: !input.dryRun,
      };
    }),
  
  calculatePlacementAdjustments: protectedProcedure
    .input(z.object({
      campaignId: z.number(),
      targetAcos: z.number().optional(),
    }))
    .query(async ({ input }) => {
      // In a real implementation, this would fetch placement-level performance data
      // For now, return default adjustments
      return {
        topSearch: 0,
        productPage: 0,
        rest: 0,
      };
    }),
});

// ==================== Import Router ====================
const importRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return db.getImportJobsByUserId(ctx.user.id);
  }),
  
  create: protectedProcedure
    .input(z.object({
      fileName: z.string(),
      fileUrl: z.string().optional(),
      fileType: z.enum(["csv", "excel"]),
      reportType: z.string().optional(),
      accountId: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const id = await db.createImportJob({
        userId: ctx.user.id,
        ...input,
      });
      return { id };
    }),
  
  updateStatus: protectedProcedure
    .input(z.object({
      id: z.number(),
      status: z.enum(["pending", "processing", "completed", "failed"]),
      processedRows: z.number().optional(),
      totalRows: z.number().optional(),
      errorMessage: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await db.updateImportJob(id, {
        ...data,
        completedAt: data.status === "completed" || data.status === "failed" ? new Date() : undefined,
      });
      return { success: true };
    }),
});

// ==================== Ad Automation Router ====================
const adAutomationRouter = router({
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
      const suggestions = adAutomation.analyzeFunnelMigration(searchTerms, {
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
      const conflicts = adAutomation.detectTrafficConflicts(searchTerms);
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
      const suggestions = adAutomation.analyzeBidAdjustments(targets, {
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
        } catch (error: any) {
          errors.push({ keyword: item.keyword, error: error.message });
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
        } catch (error: any) {
          errors.push({ targetName: item.targetName, error: error.message });
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

// ==================== Amazon API Integration Router ====================

const amazonApiRouter = router({
  // Generate OAuth authorization URL
  getAuthUrl: protectedProcedure
    .input(z.object({
      clientId: z.string(),
      redirectUri: z.string(),
    }))
    .query(({ input }) => {
      const authUrl = AmazonAdsApiClient.generateAuthUrl(
        input.clientId,
        input.redirectUri,
        `user_${Date.now()}`
      );
      return { authUrl };
    }),

  // Exchange authorization code for tokens
  exchangeCode: protectedProcedure
    .input(z.object({
      code: z.string(),
      clientId: z.string(),
      clientSecret: z.string(),
      redirectUri: z.string(),
    }))
    .mutation(async ({ input }) => {
      try {
        const tokens = await AmazonAdsApiClient.exchangeCodeForToken(
          input.code,
          input.clientId,
          input.clientSecret,
          input.redirectUri
        );
        return {
          success: true,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          expiresIn: tokens.expires_in,
        };
      } catch (error: any) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Failed to exchange code: ${error.message}`,
        });
      }
    }),

  // Save API credentials
  saveCredentials: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      clientId: z.string(),
      clientSecret: z.string(),
      refreshToken: z.string(),
      profileId: z.string(),
      region: z.enum(['NA', 'EU', 'FE']),
    }))
    .mutation(async ({ ctx, input }) => {
      // Validate credentials before saving
      const isValid = await validateCredentials({
        clientId: input.clientId,
        clientSecret: input.clientSecret,
        refreshToken: input.refreshToken,
        profileId: input.profileId,
        region: input.region,
      });

      if (!isValid) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Invalid API credentials. Please check your credentials and try again.',
        });
      }

      // Save credentials to database
      await db.saveAmazonApiCredentials({
        accountId: input.accountId,
        clientId: input.clientId,
        clientSecret: input.clientSecret,
        refreshToken: input.refreshToken,
        profileId: input.profileId,
        region: input.region,
      });

      return { success: true };
    }),

  // Get API credentials status
  getCredentialsStatus: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .query(async ({ input }) => {
      const credentials = await db.getAmazonApiCredentials(input.accountId);
      return {
        hasCredentials: !!credentials,
        region: credentials?.region,
        lastSyncAt: credentials?.lastSyncAt,
      };
    }),

  // Get available profiles
  getProfiles: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .query(async ({ input }) => {
      const credentials = await db.getAmazonApiCredentials(input.accountId);
      if (!credentials) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'API credentials not found',
        });
      }

      const client = new AmazonAdsApiClient({
        clientId: credentials.clientId,
        clientSecret: credentials.clientSecret,
        refreshToken: credentials.refreshToken,
        profileId: credentials.profileId,
        region: credentials.region as 'NA' | 'EU' | 'FE',
      });

      const profiles = await client.getProfiles();
      return profiles;
    }),

  // Sync all data from Amazon
  syncAll: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const credentials = await db.getAmazonApiCredentials(input.accountId);
      if (!credentials) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'API credentials not found',
        });
      }

      const syncService = await AmazonSyncService.createFromCredentials(
        {
          clientId: credentials.clientId,
          clientSecret: credentials.clientSecret,
          refreshToken: credentials.refreshToken,
          profileId: credentials.profileId,
          region: credentials.region as 'NA' | 'EU' | 'FE',
        },
        input.accountId,
        ctx.user.id
      );

      const results = await syncService.syncAll();

      // Update last sync time
      await db.updateAmazonApiCredentials(input.accountId, {
        lastSyncAt: new Date(),
      });

      return results;
    }),

  // Sync campaigns only
  syncCampaigns: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const credentials = await db.getAmazonApiCredentials(input.accountId);
      if (!credentials) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'API credentials not found',
        });
      }

      const syncService = await AmazonSyncService.createFromCredentials(
        {
          clientId: credentials.clientId,
          clientSecret: credentials.clientSecret,
          refreshToken: credentials.refreshToken,
          profileId: credentials.profileId,
          region: credentials.region as 'NA' | 'EU' | 'FE',
        },
        input.accountId,
        ctx.user.id
      );

      const count = await syncService.syncSpCampaigns();
      return { synced: count };
    }),

  // Sync performance data
  syncPerformance: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      days: z.number().min(1).max(90).default(30),
    }))
    .mutation(async ({ ctx, input }) => {
      const credentials = await db.getAmazonApiCredentials(input.accountId);
      if (!credentials) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'API credentials not found',
        });
      }

      const syncService = await AmazonSyncService.createFromCredentials(
        {
          clientId: credentials.clientId,
          clientSecret: credentials.clientSecret,
          refreshToken: credentials.refreshToken,
          profileId: credentials.profileId,
          region: credentials.region as 'NA' | 'EU' | 'FE',
        },
        input.accountId,
        ctx.user.id
      );

      const count = await syncService.syncPerformanceData(input.days);
      return { synced: count };
    }),

  // Apply bid adjustment to Amazon
  applyBidAdjustment: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      targetType: z.enum(['keyword', 'product_target']),
      targetId: z.number(),
      newBid: z.number(),
      reason: z.string(),
      campaignId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      const credentials = await db.getAmazonApiCredentials(input.accountId);
      if (!credentials) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'API credentials not found',
        });
      }

      const syncService = await AmazonSyncService.createFromCredentials(
        {
          clientId: credentials.clientId,
          clientSecret: credentials.clientSecret,
          refreshToken: credentials.refreshToken,
          profileId: credentials.profileId,
          region: credentials.region as 'NA' | 'EU' | 'FE',
        },
        input.accountId,
        ctx.user.id
      );

      const success = await syncService.applyBidAdjustment(
        input.targetType,
        input.targetId,
        input.newBid,
        input.reason,
        input.campaignId
      );

      if (!success) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to apply bid adjustment',
        });
      }

      return { success: true };
    }),

  // Run auto optimization with API sync
  runAutoOptimization: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      performanceGroupId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      const credentials = await db.getAmazonApiCredentials(input.accountId);
      if (!credentials) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'API credentials not found',
        });
      }

      const group = await db.getPerformanceGroupById(input.performanceGroupId);
      if (!group) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Performance group not found',
        });
      }

      const syncService = await AmazonSyncService.createFromCredentials(
        {
          clientId: credentials.clientId,
          clientSecret: credentials.clientSecret,
          refreshToken: credentials.refreshToken,
          profileId: credentials.profileId,
          region: credentials.region as 'NA' | 'EU' | 'FE',
        },
        input.accountId,
        ctx.user.id
      );

      const config = {
        optimizationGoal: group.optimizationGoal || 'maximize_sales',
        targetAcos: group.targetAcos ? parseFloat(group.targetAcos) : undefined,
        targetRoas: group.targetRoas ? parseFloat(group.targetRoas) : undefined,
        dailySpendLimit: group.dailySpendLimit ? parseFloat(group.dailySpendLimit) : undefined,
        dailyCostTarget: group.dailyCostTarget ? parseFloat(group.dailyCostTarget) : undefined,
      };

      const results = await runAutoBidOptimization(syncService, input.accountId, config);
      return results;
    }),

  // Get API regions and marketplaces
  getRegions: publicProcedure.query(() => {
    return {
      endpoints: API_ENDPOINTS,
      marketplaceMapping: MARKETPLACE_TO_REGION,
    };
  }),
});

// ==================== Notification Router ====================
const notificationRouter = router({
  // Get notification settings
  getSettings: protectedProcedure
    .query(async ({ ctx }) => {
      const settings = await db.getNotificationSettingsByUserId(ctx.user.id);
      if (!settings) {
        // Return default settings if none exist
        return {
          id: 0,
          userId: ctx.user.id,
          accountId: null,
          emailEnabled: true,
          inAppEnabled: true,
          acosThreshold: '50.00',
          ctrDropThreshold: '30.00',
          conversionDropThreshold: '30.00',
          spendSpikeThreshold: '50.00',
          frequency: 'daily' as const,
          quietHoursStart: 22,
          quietHoursEnd: 8,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      }
      return settings;
    }),

  // Update notification settings
  updateSettings: protectedProcedure
    .input(z.object({
      emailEnabled: z.boolean().optional(),
      inAppEnabled: z.boolean().optional(),
      acosThreshold: z.number().optional(),
      ctrDropThreshold: z.number().optional(),
      conversionDropThreshold: z.number().optional(),
      spendSpikeThreshold: z.number().optional(),
      frequency: z.enum(['immediate', 'hourly', 'daily', 'weekly']).optional(),
      quietHoursStart: z.number().min(0).max(23).optional(),
      quietHoursEnd: z.number().min(0).max(23).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await db.updateNotificationSettingsByUserId(ctx.user.id, input);
      return { success: true };
    }),

  // Send test notification
  sendTest: protectedProcedure
    .mutation(async ({ ctx }) => {
      const success = await notificationService.sendNotification({
        userId: ctx.user.id,
        type: 'system',
        severity: 'info',
        title: '测试通知',
        message: '这是一条测试通知，用于验证通知配置是否正确。',
      });
      return { success };
    }),

  // Get notification history
  getHistory: protectedProcedure
    .input(z.object({
      limit: z.number().optional().default(50),
    }))
    .query(async ({ ctx, input }) => {
      return db.getNotificationHistoryByUserId(ctx.user.id, input.limit);
    }),

  // Mark notification as read
  markAsRead: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.markNotificationAsRead(input.id);
      return { success: true };
    }),
});

// ==================== Scheduler Router ====================
const schedulerRouter = router({
  // Get scheduled tasks
  getTasks: protectedProcedure
    .query(async ({ ctx }) => {
      return db.getScheduledTasksByUserId(ctx.user.id);
    }),

  // Create scheduled task
  createTask: protectedProcedure
    .input(z.object({
      accountId: z.number().optional(),
      taskType: z.enum(['ngram_analysis', 'funnel_migration', 'traffic_conflict', 'smart_bidding', 'health_check', 'data_sync']),
      name: z.string(),
      description: z.string().optional(),
      schedule: z.enum(['hourly', 'daily', 'weekly', 'monthly']).optional().default('daily'),
      runTime: z.string().optional().default('06:00'),
      dayOfWeek: z.number().min(0).max(6).optional(),
      dayOfMonth: z.number().min(1).max(31).optional(),
      enabled: z.boolean().optional().default(true),
      autoApply: z.boolean().optional().default(false),
      requireApproval: z.boolean().optional().default(true),
      parameters: z.record(z.string(), z.any()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const id = await db.createScheduledTask({
        userId: ctx.user.id,
        accountId: input.accountId,
        taskType: input.taskType,
        name: input.name,
        description: input.description,
        schedule: input.schedule,
        runTime: input.runTime,
        dayOfWeek: input.dayOfWeek,
        dayOfMonth: input.dayOfMonth,
        enabled: input.enabled,
        autoApply: input.autoApply,
        requireApproval: input.requireApproval,
        parameters: input.parameters,
      });
      return { id };
    }),

  // Update scheduled task
  updateTask: protectedProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().optional(),
      description: z.string().optional(),
      schedule: z.enum(['hourly', 'daily', 'weekly', 'monthly']).optional(),
      runTime: z.string().optional(),
      dayOfWeek: z.number().min(0).max(6).optional(),
      dayOfMonth: z.number().min(1).max(31).optional(),
      enabled: z.boolean().optional(),
      autoApply: z.boolean().optional(),
      requireApproval: z.boolean().optional(),
      parameters: z.record(z.string(), z.any()).optional(),
    }))
    .mutation(async ({ input }) => {
      await db.updateScheduledTask(input.id, {
        name: input.name,
        description: input.description,
        schedule: input.schedule,
        runTime: input.runTime,
        dayOfWeek: input.dayOfWeek,
        dayOfMonth: input.dayOfMonth,
        enabled: input.enabled,
        autoApply: input.autoApply,
        requireApproval: input.requireApproval,
        parameters: input.parameters,
      });
      return { success: true };
    }),

  // Delete scheduled task
  deleteTask: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.deleteScheduledTask(input.id);
      return { success: true };
    }),

  // Run task manually
  runTask: protectedProcedure
    .input(z.object({
      id: z.number(),
      autoApply: z.boolean().optional().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      const task = await db.getScheduledTaskById(input.id);
      if (!task) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Task not found',
        });
      }

      // Execute task based on type
      let result;
      const accountId = task.accountId || 1; // Default to account 1 if not specified
      
      switch (task.taskType) {
        case 'ngram_analysis':
          const searchTerms = await db.getSearchTermsForAnalysis(accountId);
          result = await schedulerService.executeNgramAnalysis(
            searchTerms.map(t => ({
              searchTerm: t.searchTerm,
              clicks: t.clicks,
              conversions: t.conversions,
              spend: t.spend,
              sales: t.sales,
              impressions: t.impressions || 0,
            })),
            input.autoApply
          );
          break;
        case 'health_check':
          // Get health data from health monitor
          const healthData = await db.getCampaignHealthMetrics(accountId);
          result = await schedulerService.executeHealthCheck(
            healthData.map((h: db.CampaignHealthMetrics) => ({
              campaignId: h.campaignId,
              campaignName: h.campaignName,
              currentAcos: h.currentMetrics.acos,
              previousAcos: h.historicalAverage.acos,
              currentCtr: h.currentMetrics.ctr,
              previousCtr: h.historicalAverage.ctr,
              currentConversionRate: h.currentMetrics.cvr,
              previousConversionRate: h.historicalAverage.cvr,
              currentSpend: h.currentMetrics.spend,
              previousSpend: h.historicalAverage.spend,
            }))
          );
          break;
        default:
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Task type ${task.taskType} is not yet implemented`,
          });
      }

      // Record execution
      await db.recordTaskExecution({
        taskId: task.id,
        userId: ctx.user.id,
        accountId: task.accountId || undefined,
        taskType: task.taskType,
        status: result.status,
        startedAt: result.startedAt,
        completedAt: result.completedAt,
        duration: result.duration,
        itemsProcessed: result.itemsProcessed,
        suggestionsGenerated: result.suggestionsGenerated,
        suggestionsApplied: result.suggestionsApplied,
        errorMessage: result.errorMessage,
        resultSummary: result.resultSummary,
      });

      return result;
    }),

  // Get task execution history
  getExecutionHistory: protectedProcedure
    .input(z.object({
      taskId: z.number(),
      limit: z.number().optional().default(20),
    }))
    .query(async ({ input }) => {
      return db.getTaskExecutionHistory(input.taskId, input.limit);
    }),

  // Get default task configurations
  getDefaultConfigs: protectedProcedure
    .query(async () => {
      return schedulerService.defaultTaskConfigs;
    }),
});
const batchOperationRouter = router({
  // List batch operations
  list: protectedProcedure
    .input(z.object({
      accountId: z.number().optional(),
      status: z.string().optional(),
      operationType: z.string().optional(),
      limit: z.number().optional().default(50),
    }))
    .query(async ({ ctx, input }) => {
      return db.listBatchOperations(ctx.user.id, input);
    }),

  // Get batch operation details
  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const batch = await db.getBatchOperation(input.id);
      if (!batch) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Batch operation not found' });
      }
      const items = await db.getBatchOperationItems(input.id);
      return { ...batch, items };
    }),

  // Create batch operation for negative keywords
  createNegativeKeywordBatch: protectedProcedure
    .input(z.object({
      accountId: z.number().optional(),
      name: z.string(),
      description: z.string().optional(),
      sourceType: z.string().optional(),
      sourceTaskId: z.number().optional(),
      items: z.array(z.object({
        entityType: z.enum(['keyword', 'product_target', 'campaign', 'ad_group']),
        entityId: z.number(),
        entityName: z.string().optional(),
        negativeKeyword: z.string(),
        negativeMatchType: z.enum(['negative_phrase', 'negative_exact']),
        negativeLevel: z.enum(['ad_group', 'campaign']),
      })),
    }))
    .mutation(async ({ ctx, input }) => {
      // Validate items
      for (const item of input.items) {
        const validation = batchOperationService.validateNegativeKeywordItem(item);
        if (!validation.valid) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: validation.error });
        }
      }

      // Create batch operation
      const batchId = await db.createBatchOperation({
        userId: ctx.user.id,
        accountId: input.accountId,
        operationType: 'negative_keyword',
        name: input.name,
        description: input.description,
        requiresApproval: true,
        sourceType: input.sourceType,
        sourceTaskId: input.sourceTaskId,
      });

      // Add items with rollback data
      const itemsWithRollback = input.items.map(item => ({
        ...item,
        previousValue: batchOperationService.prepareRollbackData('negative_keyword', item),
      }));
      await db.addBatchOperationItems(batchId, itemsWithRollback);

      return { batchId, totalItems: input.items.length };
    }),

  // Create batch operation for bid adjustments
  createBidAdjustmentBatch: protectedProcedure
    .input(z.object({
      accountId: z.number().optional(),
      name: z.string(),
      description: z.string().optional(),
      sourceType: z.string().optional(),
      sourceTaskId: z.number().optional(),
      maxBid: z.number().optional().default(100),
      items: z.array(z.object({
        entityType: z.enum(['keyword', 'product_target']),
        entityId: z.number(),
        entityName: z.string().optional(),
        currentBid: z.number(),
        newBid: z.number(),
        bidChangeReason: z.string().optional(),
      })),
    }))
    .mutation(async ({ ctx, input }) => {
      // Validate items
      for (const item of input.items) {
        const validation = batchOperationService.validateBidAdjustmentItem(item, input.maxBid);
        if (!validation.valid) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: `${item.entityName}: ${validation.error}` });
        }
      }

      // Create batch operation
      const batchId = await db.createBatchOperation({
        userId: ctx.user.id,
        accountId: input.accountId,
        operationType: 'bid_adjustment',
        name: input.name,
        description: input.description,
        requiresApproval: true,
        sourceType: input.sourceType,
        sourceTaskId: input.sourceTaskId,
      });

      // Add items with rollback data
      const itemsWithRollback = input.items.map(item => ({
        ...item,
        previousValue: batchOperationService.prepareRollbackData('bid_adjustment', item),
      }));
      await db.addBatchOperationItems(batchId, itemsWithRollback);

      return { batchId, totalItems: input.items.length };
    }),

  // Approve batch operation
  approve: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const batch = await db.getBatchOperation(input.id);
      if (!batch) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Batch operation not found' });
      }
      if (batch.status !== 'pending') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Batch operation is not pending approval' });
      }

      await db.approveBatchOperation(input.id, ctx.user.id);
      return { success: true };
    }),

  // Execute batch operation
  execute: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const batch = await db.getBatchOperation(input.id);
      if (!batch) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Batch operation not found' });
      }
      if (batch.requiresApproval && batch.status !== 'approved') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Batch operation requires approval before execution' });
      }
      if (batch.status === 'executing' || batch.status === 'completed') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Batch operation is already executing or completed' });
      }

      // Update status to executing
      await db.updateBatchOperationStatus(input.id, {
        status: 'executing',
        executedBy: ctx.user.id,
        executedAt: new Date(),
      });

      // Get items and execute
      const items = await db.getBatchOperationItems(input.id);
      let successCount = 0;
      let failedCount = 0;
      const errors: Array<{ itemId: number; error: string }> = [];

      for (const item of items) {
        try {
          // Execute based on operation type
          if (batch.operationType === 'negative_keyword' && item.negativeKeyword) {
            // Add negative keyword
            await db.addNegativeKeyword({
              campaignId: item.entityId,
              adGroupId: item.negativeLevel === 'ad_group' ? item.entityId : undefined,
              keyword: item.negativeKeyword,
              matchType: item.negativeMatchType === 'negative_phrase' ? 'phrase' : 'exact',
              level: item.negativeLevel as 'ad_group' | 'campaign',
            });
          } else if (batch.operationType === 'bid_adjustment' && item.newBid) {
            // Update bid
            if (item.entityType === 'keyword') {
              await db.updateKeyword(item.entityId, { bid: item.newBid });
            } else if (item.entityType === 'product_target') {
              await db.updateProductTargetBid(item.entityId, item.newBid);
            }
          }

          await db.updateBatchOperationItemStatus(item.id, {
            status: 'success',
            executedAt: new Date(),
          });
          successCount++;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          await db.updateBatchOperationItemStatus(item.id, {
            status: 'failed',
            errorMessage,
            executedAt: new Date(),
          });
          failedCount++;
          errors.push({ itemId: item.id, error: errorMessage });
        }
      }

      // Update batch status
      const finalStatus = failedCount === items.length ? 'failed' : 'completed';
      await db.updateBatchOperationStatus(input.id, {
        status: finalStatus,
        processedItems: items.length,
        successItems: successCount,
        failedItems: failedCount,
        completedAt: new Date(),
      });

      return {
        status: finalStatus,
        totalItems: items.length,
        successItems: successCount,
        failedItems: failedCount,
        errors,
      };
    }),

  // Rollback batch operation
  rollback: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const batch = await db.getBatchOperation(input.id);
      if (!batch) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Batch operation not found' });
      }
      if (!batchOperationService.canRollback(batch.status as batchOperationService.BatchStatus, batch.completedAt || undefined)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cannot rollback this batch operation' });
      }

      // Get items and rollback
      const items = await db.getBatchOperationItems(input.id);
      let successCount = 0;

      for (const item of items) {
        if (item.status !== 'success') continue;

        try {
          const rollbackData = item.previousValue ? JSON.parse(item.previousValue) : null;
          
          if (rollbackData?.action === 'remove_negative_keyword') {
            // Remove the negative keyword that was added
            // This would require a delete function
          } else if (rollbackData?.action === 'restore_bid') {
            // Restore original bid
            if (item.entityType === 'keyword') {
              await db.updateKeyword(item.entityId, { bid: rollbackData.originalBid });
            } else if (item.entityType === 'product_target') {
              await db.updateProductTargetBid(item.entityId, rollbackData.originalBid);
            }
          }

          await db.updateBatchOperationItemStatus(item.id, {
            status: 'rolled_back',
          });
          successCount++;
        } catch (error) {
          // Continue with other items even if one fails
        }
      }

      await db.rollbackBatchOperation(input.id, ctx.user.id);

      return { success: true, rolledBackItems: successCount };
    }),

  // Cancel pending batch operation
  cancel: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const batch = await db.getBatchOperation(input.id);
      if (!batch) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Batch operation not found' });
      }
      if (batch.status !== 'pending' && batch.status !== 'approved') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Can only cancel pending or approved operations' });
      }

      await db.updateBatchOperationStatus(input.id, { status: 'cancelled' });
      return { success: true };
    }),

  // Get batch operation summary
  getSummary: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const batch = await db.getBatchOperation(input.id);
      if (!batch) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Batch operation not found' });
      }

      const result: batchOperationService.BatchOperationResult = {
        batchId: batch.id,
        status: batch.status as batchOperationService.BatchStatus,
        totalItems: batch.totalItems || 0,
        processedItems: batch.processedItems || 0,
        successItems: batch.successItems || 0,
        failedItems: batch.failedItems || 0,
        errors: [],
      };

      return batchOperationService.generateBatchSummary(result);
    }),

  // Estimate execution time
  estimateTime: protectedProcedure
    .input(z.object({
      operationType: z.enum(['negative_keyword', 'bid_adjustment', 'keyword_migration', 'campaign_status']),
      itemCount: z.number(),
    }))
    .query(({ input }) => {
      const seconds = batchOperationService.estimateExecutionTime(input.itemCount, input.operationType);
      return { estimatedSeconds: seconds };
    }),
});

// ==================== Correction Review Router ====================
const correctionRouter = router({
  // List correction review sessions
  listSessions: protectedProcedure
    .input(z.object({
      accountId: z.number().optional(),
    }))
    .query(async ({ ctx, input }) => {
      return db.listCorrectionReviewSessions(ctx.user.id, input.accountId);
    }),

  // Get correction review session details
  getSession: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const session = await db.getCorrectionReviewSession(input.id);
      if (!session) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Session not found' });
      }
      return session;
    }),

  // Create new correction review session
  createSession: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      periodDays: z.number().optional().default(14),
    }))
    .mutation(async ({ ctx, input }) => {
      const periodEnd = new Date();
      periodEnd.setDate(periodEnd.getDate() - correctionService.MIN_ANALYSIS_DELAY_DAYS);
      
      const periodStart = new Date(periodEnd);
      periodStart.setDate(periodStart.getDate() - input.periodDays);

      const sessionId = await db.createCorrectionReviewSession({
        userId: ctx.user.id,
        accountId: input.accountId,
        periodStart,
        periodEnd,
      });

      return { sessionId, periodStart, periodEnd };
    }),

  // Analyze bid adjustments for a session
  analyzeSession: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const session = await db.getCorrectionReviewSession(input.sessionId);
      if (!session) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Session not found' });
      }

      // Get bid change records for the period
      const bidChanges = await db.getBidChangeRecords(session.accountId, 30);
      
      // Filter to the session period
      const periodBidChanges = bidChanges.filter(change => {
        const changeDate = new Date(change.changeDate);
        return changeDate >= session.periodStart && changeDate <= session.periodEnd;
      });

      const corrections: correctionService.CorrectionAnalysis[] = [];

      for (const change of periodBidChanges) {
        // Get metrics after attribution window (simulated)
        const metricsAfterAttribution: correctionService.PerformanceMetrics = {
          impressions: Math.floor(Math.random() * 1000),
          clicks: Math.floor(Math.random() * 50),
          spend: Math.random() * 100,
          sales: Math.random() * 500,
          orders: Math.floor(Math.random() * 10),
          acos: Math.random() * 50,
          roas: Math.random() * 5,
          ctr: Math.random() * 5,
          cvr: Math.random() * 10,
        };

        const metricsAtAdjustment: correctionService.PerformanceMetrics = {
          impressions: Math.floor(Math.random() * 1000),
          clicks: Math.floor(Math.random() * 50),
          spend: change.performanceAfter?.spend || 0,
          sales: change.performanceAfter?.sales || 0,
          orders: change.performanceAfter?.conversions || 0,
          acos: change.performanceAfter?.acos || 0,
          roas: change.performanceAfter?.roas || 0,
          ctr: Math.random() * 5,
          cvr: Math.random() * 10,
        };

        const record: correctionService.BidAdjustmentRecord = {
          id: change.id,
          targetId: change.targetId,
          targetName: change.targetName,
          targetType: change.targetType === 'product' ? 'product_target' : 'keyword',
          campaignId: change.campaignId,
          campaignName: change.campaignName,
          originalBid: change.oldBid,
          adjustedBid: change.newBid,
          adjustmentDate: change.changeDate,
          adjustmentReason: change.changeReason,
          metricsAtAdjustment,
        };

        const analysis = correctionService.analyzeBidAdjustment(record, metricsAfterAttribution);
        corrections.push(analysis);

        // Save correction record to database
        await db.addAttributionCorrectionRecord({
          userId: ctx.user.id,
          accountId: session.accountId,
          biddingLogId: change.id,
          campaignId: change.campaignId,
          targetType: record.targetType,
          targetId: change.targetId,
          targetName: change.targetName,
          originalAdjustmentDate: change.changeDate,
          originalBid: change.oldBid,
          adjustedBid: change.newBid,
          adjustmentReason: change.changeReason,
          metricsAtAdjustment: metricsAtAdjustment as unknown as Record<string, unknown>,
          metricsAfterAttribution: metricsAfterAttribution as unknown as Record<string, unknown>,
          wasIncorrect: analysis.wasIncorrect,
          correctionType: analysis.correctionType,
          suggestedBid: analysis.suggestedBid,
          confidenceScore: analysis.confidenceScore,
        });
      }

      // Generate report
      const report = correctionService.generateCorrectionReport(
        input.sessionId,
        session.periodStart,
        session.periodEnd,
        corrections
      );

      // Update session with results
      await db.updateCorrectionReviewSession(input.sessionId, {
        status: 'ready_for_review',
        totalAdjustmentsReviewed: report.totalAdjustmentsReviewed,
        incorrectAdjustments: report.incorrectAdjustments,
        overDecreasedCount: report.overDecreasedCount,
        overIncreasedCount: report.overIncreasedCount,
        correctCount: report.correctCount,
        estimatedLostRevenue: report.estimatedLostRevenue,
        estimatedWastedSpend: report.estimatedWastedSpend,
        potentialRecovery: report.potentialRecovery,
      });

      return report;
    }),

  // Get correction records for a session
  getCorrections: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .query(async ({ input }) => {
      return db.getCorrectionRecordsForSession(input.sessionId);
    }),

  // Apply corrections as batch operation
  applyCorrections: protectedProcedure
    .input(z.object({
      sessionId: z.number(),
      correctionIds: z.array(z.number()),
    }))
    .mutation(async ({ ctx, input }) => {
      const session = await db.getCorrectionReviewSession(input.sessionId);
      if (!session) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Session not found' });
      }

      // Get correction records
      const corrections = await db.getCorrectionRecordsForSession(input.sessionId);
      const selectedCorrections = corrections.filter(c => input.correctionIds.includes(c.id));

      if (selectedCorrections.length === 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'No corrections selected' });
      }

      // Create batch operation for corrections
      const batchId = await db.createBatchOperation({
        userId: ctx.user.id,
        accountId: session.accountId,
        operationType: 'bid_adjustment',
        name: `纠错复盘 - ${new Date().toLocaleDateString()}`,
        description: `基于半月纠错复盘分析的出价纠正`,
        requiresApproval: true,
        sourceType: 'correction_review',
        sourceTaskId: input.sessionId,
      });

      // Add items
      const items = selectedCorrections.map(c => ({
        entityType: c.targetType as 'keyword' | 'product_target',
        entityId: c.targetId,
        targetName: c.targetName || undefined,
        currentBid: parseFloat(c.adjustedBid || '0'),
        newBid: parseFloat(c.suggestedBid || '0'),
        bidChangeReason: `纠错复盘: ${correctionService.formatCorrectionType(c.correctionType as 'over_decreased' | 'over_increased' | 'correct')}`,
      }));

      await db.addBatchOperationItems(batchId, items);

      // Update session
      await db.updateCorrectionReviewSession(input.sessionId, {
        status: 'corrections_applied',
        reviewedAt: new Date(),
        reviewedBy: ctx.user.id,
        correctionBatchId: batchId,
      });

      // Update correction record statuses
      for (const id of input.correctionIds) {
        await db.updateAttributionCorrectionStatus(id, {
          status: 'approved',
        });
      }

      return { batchId, itemCount: items.length };
    }),

  // Dismiss corrections
  dismissCorrections: protectedProcedure
    .input(z.object({
      correctionIds: z.array(z.number()),
    }))
    .mutation(async ({ input }) => {
      for (const id of input.correctionIds) {
        await db.updateAttributionCorrectionStatus(id, {
          status: 'dismissed',
        });
      }
      return { success: true };
    }),

  // Get recommendations
  getRecommendations: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .query(async ({ input }) => {
      const corrections = await db.getCorrectionRecordsForSession(input.sessionId);
      
      // Convert to CorrectionAnalysis format for recommendations
      const analyses: correctionService.CorrectionAnalysis[] = corrections.map(c => ({
        record: {
          id: c.id,
          targetId: c.targetId,
          targetName: c.targetName || '',
          targetType: c.targetType as 'keyword' | 'product_target',
          campaignId: c.campaignId,
          campaignName: '',
          originalBid: parseFloat(c.originalBid || '0'),
          adjustedBid: parseFloat(c.adjustedBid || '0'),
          adjustmentDate: c.originalAdjustmentDate,
          adjustmentReason: c.adjustmentReason || '',
          metricsAtAdjustment: JSON.parse(c.metricsAtAdjustment || '{}'),
        },
        metricsAfterAttribution: JSON.parse(c.metricsAfterAttribution || '{}'),
        wasIncorrect: c.wasIncorrect || false,
        correctionType: (c.correctionType || 'correct') as 'over_decreased' | 'over_increased' | 'correct',
        suggestedBid: parseFloat(c.suggestedBid || '0'),
        confidenceScore: parseFloat(c.confidenceScore || '0'),
        impactAnalysis: {
          estimatedLostRevenue: 0,
          estimatedWastedSpend: 0,
          potentialRecovery: 0,
        },
        explanation: '',
      }));

      return correctionService.generateRecommendations(analyses);
    }),
});

// ==================== Cross Account Summary Router ====================
const crossAccountRouter = router({
  // 获取所有账号的汇总数据
  getSummary: protectedProcedure
    .input(z.object({
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      const accounts = await db.getAdAccountsByUserId(ctx.user.id);
      
      if (accounts.length === 0) {
        return {
          totalAccounts: 0,
          connectedAccounts: 0,
          totalSpend: 0,
          totalSales: 0,
          totalImpressions: 0,
          totalClicks: 0,
          totalOrders: 0,
          avgAcos: 0,
          avgRoas: 0,
          avgCtr: 0,
          avgCvr: 0,
          accountsData: [],
          marketplaceDistribution: {},
          dailyTrend: [],
        };
      }

      // 获取每个账号的数据
      const accountsData = await Promise.all(
        accounts.map(async (account) => {
          // 获取该账号下的所有绩效组
          const performanceGroups = await db.getPerformanceGroupsByAccountId(account.id);
          
          // 汇总该账号的数据
          let totalSpend = 0;
          let totalSales = 0;
          let totalImpressions = 0;
          let totalClicks = 0;
          let totalOrders = 0;

          for (const pg of performanceGroups) {
            // 获取绩效组下的所有广告活动
            const campaigns = await db.getCampaignsByPerformanceGroupId(pg.id);
            for (const campaign of campaigns) {
              totalSpend += parseFloat(campaign.spend || '0');
              totalSales += parseFloat(campaign.sales || '0');
              totalImpressions += campaign.impressions || 0;
              totalClicks += campaign.clicks || 0;
              totalOrders += campaign.orders || 0;
            }
          }

          const acos = totalSales > 0 ? (totalSpend / totalSales) * 100 : 0;
          const roas = totalSpend > 0 ? totalSales / totalSpend : 0;
          const ctr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
          const cvr = totalClicks > 0 ? (totalOrders / totalClicks) * 100 : 0;

          return {
            id: account.id,
            accountName: account.accountName,
            storeName: account.storeName,
            storeColor: account.storeColor,
            marketplace: account.marketplace,
            connectionStatus: account.connectionStatus,
            spend: totalSpend,
            sales: totalSales,
            impressions: totalImpressions,
            clicks: totalClicks,
            orders: totalOrders,
            acos,
            roas,
            ctr,
            cvr,
          };
        })
      );

      // 计算汇总
      const totalSpend = accountsData.reduce((sum, a) => sum + a.spend, 0);
      const totalSales = accountsData.reduce((sum, a) => sum + a.sales, 0);
      const totalImpressions = accountsData.reduce((sum, a) => sum + a.impressions, 0);
      const totalClicks = accountsData.reduce((sum, a) => sum + a.clicks, 0);
      const totalOrders = accountsData.reduce((sum, a) => sum + a.orders, 0);

      const avgAcos = totalSales > 0 ? (totalSpend / totalSales) * 100 : 0;
      const avgRoas = totalSpend > 0 ? totalSales / totalSpend : 0;
      const avgCtr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
      const avgCvr = totalClicks > 0 ? (totalOrders / totalClicks) * 100 : 0;

      // 市场分布
      const marketplaceDistribution: Record<string, { count: number; spend: number; sales: number }> = {};
      for (const account of accountsData) {
        if (!marketplaceDistribution[account.marketplace]) {
          marketplaceDistribution[account.marketplace] = { count: 0, spend: 0, sales: 0 };
        }
        marketplaceDistribution[account.marketplace].count++;
        marketplaceDistribution[account.marketplace].spend += account.spend;
        marketplaceDistribution[account.marketplace].sales += account.sales;
      }

      return {
        totalAccounts: accounts.length,
        connectedAccounts: accounts.filter(a => a.connectionStatus === 'connected').length,
        totalSpend,
        totalSales,
        totalImpressions,
        totalClicks,
        totalOrders,
        avgAcos,
        avgRoas,
        avgCtr,
        avgCvr,
        accountsData,
        marketplaceDistribution,
        dailyTrend: [], // 可以后续实现每日趋势
      };
    }),

  // 获取账号对比数据
  getComparison: protectedProcedure
    .input(z.object({
      accountIds: z.array(z.number()),
      metric: z.enum(['spend', 'sales', 'acos', 'roas', 'impressions', 'clicks', 'orders', 'ctr', 'cvr']),
    }))
    .query(async ({ ctx, input }) => {
      const accounts = await db.getAdAccountsByUserId(ctx.user.id);
      const selectedAccounts = accounts.filter(a => input.accountIds.includes(a.id));
      
      const comparisonData = await Promise.all(
        selectedAccounts.map(async (account) => {
          const performanceGroups = await db.getPerformanceGroupsByAccountId(account.id);
          
          let totalSpend = 0;
          let totalSales = 0;
          let totalImpressions = 0;
          let totalClicks = 0;
          let totalOrders = 0;

          for (const pg of performanceGroups) {
            const campaigns = await db.getCampaignsByPerformanceGroupId(pg.id);
            for (const campaign of campaigns) {
              totalSpend += parseFloat(campaign.spend || '0');
              totalSales += parseFloat(campaign.sales || '0');
              totalImpressions += campaign.impressions || 0;
              totalClicks += campaign.clicks || 0;
              totalOrders += campaign.orders || 0;
            }
          }

          const metrics = {
            spend: totalSpend,
            sales: totalSales,
            acos: totalSales > 0 ? (totalSpend / totalSales) * 100 : 0,
            roas: totalSpend > 0 ? totalSales / totalSpend : 0,
            impressions: totalImpressions,
            clicks: totalClicks,
            orders: totalOrders,
            ctr: totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0,
            cvr: totalClicks > 0 ? (totalOrders / totalClicks) * 100 : 0,
          };

          return {
            id: account.id,
            name: account.storeName || account.accountName,
            color: account.storeColor || '#3B82F6',
            marketplace: account.marketplace,
            value: metrics[input.metric],
          };
        })
      );

      return comparisonData;
    }),

  // 导出账号配置
  exportAccounts: protectedProcedure
    .input(z.object({
      format: z.enum(['json', 'csv']),
      accountIds: z.array(z.number()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      let accounts = await db.getAdAccountsByUserId(ctx.user.id);
      
      if (input.accountIds && input.accountIds.length > 0) {
        accounts = accounts.filter(a => input.accountIds!.includes(a.id));
      }

      // 移除敏感信息
      const exportData = accounts.map(a => ({
        accountId: a.accountId,
        accountName: a.accountName,
        storeName: a.storeName,
        storeDescription: a.storeDescription,
        storeColor: a.storeColor,
        marketplace: a.marketplace,
        marketplaceId: a.marketplaceId,
        profileId: a.profileId,
        sellerId: a.sellerId,
        isDefault: a.isDefault,
        sortOrder: a.sortOrder,
      }));

      if (input.format === 'json') {
        return {
          format: 'json',
          data: JSON.stringify(exportData, null, 2),
          filename: `amazon-accounts-${new Date().toISOString().split('T')[0]}.json`,
        };
      } else {
        // CSV格式
        const headers = ['accountId', 'accountName', 'storeName', 'storeDescription', 'storeColor', 'marketplace', 'marketplaceId', 'profileId', 'sellerId', 'isDefault', 'sortOrder'];
        const csvRows = [
          headers.join(','),
          ...exportData.map(row => 
            headers.map(h => {
              const value = row[h as keyof typeof row];
              if (value === null || value === undefined) return '';
              if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
                return `"${value.replace(/"/g, '""')}"`;
              }
              return String(value);
            }).join(',')
          ),
        ];
        return {
          format: 'csv',
          data: csvRows.join('\n'),
          filename: `amazon-accounts-${new Date().toISOString().split('T')[0]}.csv`,
        };
      }
    }),

  // 导入账号配置
  importAccounts: protectedProcedure
    .input(z.object({
      data: z.string(),
      format: z.enum(['json', 'csv']),
      overwrite: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      let accountsToImport: Array<{
        accountId: string;
        accountName: string;
        storeName?: string;
        storeDescription?: string;
        storeColor?: string;
        marketplace: string;
        marketplaceId?: string;
        profileId?: string;
        sellerId?: string;
        isDefault?: boolean;
      }> = [];

      if (input.format === 'json') {
        try {
          accountsToImport = JSON.parse(input.data);
        } catch (e) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'JSON格式无效' });
        }
      } else {
        // 解析CSV
        const lines = input.data.split('\n').filter(l => l.trim());
        if (lines.length < 2) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'CSV文件为空或格式错误' });
        }
        
        const headers = lines[0].split(',').map(h => h.trim());
        for (let i = 1; i < lines.length; i++) {
          const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
          const row: Record<string, string> = {};
          headers.forEach((h, idx) => {
            row[h] = values[idx] || '';
          });
          
          if (row.accountId && row.accountName && row.marketplace) {
            accountsToImport.push({
              accountId: row.accountId,
              accountName: row.accountName,
              storeName: row.storeName || undefined,
              storeDescription: row.storeDescription || undefined,
              storeColor: row.storeColor || undefined,
              marketplace: row.marketplace,
              marketplaceId: row.marketplaceId || undefined,
              profileId: row.profileId || undefined,
              sellerId: row.sellerId || undefined,
              isDefault: row.isDefault === 'true',
            });
          }
        }
      }

      if (accountsToImport.length === 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: '没有找到有效的账号数据' });
      }

      // 获取现有账号
      const existingAccounts = await db.getAdAccountsByUserId(ctx.user.id);
      const existingAccountIds = new Set(existingAccounts.map(a => a.accountId));

      let imported = 0;
      let skipped = 0;
      let updated = 0;

      for (const account of accountsToImport) {
        if (existingAccountIds.has(account.accountId)) {
          if (input.overwrite) {
            // 更新现有账号
            const existing = existingAccounts.find(a => a.accountId === account.accountId);
            if (existing) {
              await db.updateAdAccount(existing.id, {
                accountName: account.accountName,
                storeName: account.storeName,
                storeDescription: account.storeDescription,
                storeColor: account.storeColor,
                marketplace: account.marketplace,
                marketplaceId: account.marketplaceId,
                profileId: account.profileId,
                sellerId: account.sellerId,
              });
              updated++;
            }
          } else {
            skipped++;
          }
        } else {
          // 创建新账号
          await db.createAdAccount({
            userId: ctx.user.id,
            ...account,
            connectionStatus: 'pending',
          });
          imported++;
        }
      }

      return {
        total: accountsToImport.length,
        imported,
        updated,
        skipped,
      };
    }),

  // 预览导入数据
  previewImport: protectedProcedure
    .input(z.object({
      data: z.string(),
      format: z.enum(['json', 'csv']),
    }))
    .mutation(async ({ ctx, input }) => {
      let accountsToImport: Array<{
        accountId: string;
        accountName: string;
        storeName?: string;
        marketplace: string;
      }> = [];

      if (input.format === 'json') {
        try {
          accountsToImport = JSON.parse(input.data);
        } catch (e) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'JSON格式无效' });
        }
      } else {
        const lines = input.data.split('\n').filter(l => l.trim());
        if (lines.length < 2) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'CSV文件为空或格式错误' });
        }
        
        const headers = lines[0].split(',').map(h => h.trim());
        for (let i = 1; i < lines.length; i++) {
          const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
          const row: Record<string, string> = {};
          headers.forEach((h, idx) => {
            row[h] = values[idx] || '';
          });
          
          if (row.accountId && row.accountName && row.marketplace) {
            accountsToImport.push({
              accountId: row.accountId,
              accountName: row.accountName,
              storeName: row.storeName || undefined,
              marketplace: row.marketplace,
            });
          }
        }
      }

      // 检查哪些账号已存在
      const existingAccounts = await db.getAdAccountsByUserId(ctx.user.id);
      const existingAccountIds = new Set(existingAccounts.map(a => a.accountId));

      return accountsToImport.map(a => ({
        ...a,
        exists: existingAccountIds.has(a.accountId),
      }));
    }),
});

// ==================== Team Member Router ====================
const teamRouter = router({
  // 获取团队成员列表
  list: protectedProcedure.query(async ({ ctx }) => {
    return db.getTeamMembersByOwner(ctx.user.id);
  }),

  // 获取单个团队成员
  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return db.getTeamMemberById(input.id);
    }),

  // 邀请新成员
  invite: protectedProcedure
    .input(z.object({
      email: z.string().email(),
      name: z.string().optional(),
      role: z.enum(["admin", "editor", "viewer"]),
    }))
    .mutation(async ({ ctx, input }) => {
      // 检查是否已邀请
      const existing = await db.getTeamMemberByEmail(ctx.user.id, input.email);
      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: "该邮箱已被邀请" });
      }

      // 生成邀请令牌
      const inviteToken = Math.random().toString(36).substring(2) + Date.now().toString(36);
      const inviteExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7天过期

      const member = await db.createTeamMember({
        ownerId: ctx.user.id,
        email: input.email,
        name: input.name,
        role: input.role,
        status: "pending",
        inviteToken,
        inviteExpiresAt,
      });

      // TODO: 发送邀请邮件

      return member;
    }),

  // 更新成员信息
  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().optional(),
      role: z.enum(["admin", "editor", "viewer"]).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const member = await db.getTeamMemberById(input.id);
      if (!member || member.ownerId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "成员不存在" });
      }

      await db.updateTeamMember(input.id, {
        name: input.name,
        role: input.role,
      });

      return { success: true };
    }),

  // 删除成员
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const member = await db.getTeamMemberById(input.id);
      if (!member || member.ownerId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "成员不存在" });
      }

      await db.deleteTeamMember(input.id);
      return { success: true };
    }),

  // 重新发送邀请
  resendInvite: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const member = await db.getTeamMemberById(input.id);
      if (!member || member.ownerId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "成员不存在" });
      }

      if (member.status !== "pending") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "只能重新发送待接受的邀请" });
      }

      // 生成新的邀请令牌
      const inviteToken = Math.random().toString(36).substring(2) + Date.now().toString(36);
      const inviteExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      await db.updateTeamMember(input.id, {
        inviteToken,
        inviteExpiresAt,
      });

      // TODO: 发送邀请邮件

      return { success: true };
    }),

  // 设置成员的账号权限
  setPermissions: protectedProcedure
    .input(z.object({
      memberId: z.number(),
      permissions: z.array(z.object({
        accountId: z.number(),
        permissionLevel: z.enum(["full", "edit", "view"]),
        canExport: z.boolean().optional(),
        canManageCampaigns: z.boolean().optional(),
        canAdjustBids: z.boolean().optional(),
        canManageNegatives: z.boolean().optional(),
      })),
    }))
    .mutation(async ({ ctx, input }) => {
      const member = await db.getTeamMemberById(input.memberId);
      if (!member || member.ownerId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "成员不存在" });
      }

      await db.setAccountPermissions(input.memberId, input.permissions);
      return { success: true };
    }),

  // 获取成员的账号权限
  getPermissions: protectedProcedure
    .input(z.object({ memberId: z.number() }))
    .query(async ({ ctx, input }) => {
      const member = await db.getTeamMemberById(input.memberId);
      if (!member || member.ownerId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "成员不存在" });
      }

      return db.getPermissionsByTeamMember(input.memberId);
    }),

  // 获取账号的所有权限
  getAccountPermissions: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .query(async ({ input }) => {
      return db.getPermissionsByAccount(input.accountId);
    }),
});

// ==================== Email Report Router ====================
const emailReportRouter = router({
  // 获取订阅列表
  list: protectedProcedure.query(async ({ ctx }) => {
    return db.getEmailSubscriptionsByUser(ctx.user.id);
  }),

  // 获取单个订阅
  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const subscription = await db.getEmailSubscriptionById(input.id);
      if (!subscription || subscription.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "订阅不存在" });
      }
      return subscription;
    }),

  // 创建订阅
  create: protectedProcedure
    .input(z.object({
      name: z.string().min(1),
      description: z.string().optional(),
      reportType: z.enum([
        "cross_account_summary",
        "account_performance",
        "campaign_performance",
        "keyword_performance",
        "health_alert",
        "optimization_summary"
      ]),
      frequency: z.enum(["daily", "weekly", "monthly"]),
      sendTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
      sendDayOfWeek: z.number().min(0).max(6).optional(),
      sendDayOfMonth: z.number().min(1).max(31).optional(),
      timezone: z.string().optional(),
      recipients: z.array(z.string().email()),
      ccRecipients: z.array(z.string().email()).optional(),
      accountIds: z.array(z.number()).optional(),
      includeCharts: z.boolean().optional(),
      includeDetails: z.boolean().optional(),
      dateRange: z.enum(["last_7_days", "last_14_days", "last_30_days", "last_month", "custom"]).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // 计算下次发送时间
      const nextSendAt = calculateNextSendTime(input.frequency, input.sendTime || "09:00", input.sendDayOfWeek, input.sendDayOfMonth);

      const subscription = await db.createEmailSubscription({
        userId: ctx.user.id,
        name: input.name,
        description: input.description,
        reportType: input.reportType,
        frequency: input.frequency,
        sendTime: input.sendTime || "09:00",
        sendDayOfWeek: input.sendDayOfWeek,
        sendDayOfMonth: input.sendDayOfMonth,
        timezone: input.timezone || "Asia/Shanghai",
        recipients: input.recipients,
        ccRecipients: input.ccRecipients || [],
        accountIds: input.accountIds || [],
        includeCharts: input.includeCharts ?? true,
        includeDetails: input.includeDetails ?? true,
        dateRange: input.dateRange || "last_7_days",
        isActive: true,
        nextSendAt,
      });

      return subscription;
    }),

  // 更新订阅
  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().min(1).optional(),
      description: z.string().optional(),
      frequency: z.enum(["daily", "weekly", "monthly"]).optional(),
      sendTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
      sendDayOfWeek: z.number().min(0).max(6).optional(),
      sendDayOfMonth: z.number().min(1).max(31).optional(),
      timezone: z.string().optional(),
      recipients: z.array(z.string().email()).optional(),
      ccRecipients: z.array(z.string().email()).optional(),
      accountIds: z.array(z.number()).optional(),
      includeCharts: z.boolean().optional(),
      includeDetails: z.boolean().optional(),
      dateRange: z.enum(["last_7_days", "last_14_days", "last_30_days", "last_month", "custom"]).optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const subscription = await db.getEmailSubscriptionById(input.id);
      if (!subscription || subscription.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "订阅不存在" });
      }

      // 如果更新了频率或发送时间，重新计算下次发送时间
      let nextSendAt = subscription.nextSendAt;
      if (input.frequency || input.sendTime || input.sendDayOfWeek !== undefined || input.sendDayOfMonth !== undefined) {
        nextSendAt = calculateNextSendTime(
          input.frequency || subscription.frequency,
          input.sendTime || subscription.sendTime || "09:00",
          input.sendDayOfWeek ?? subscription.sendDayOfWeek ?? undefined,
          input.sendDayOfMonth ?? subscription.sendDayOfMonth ?? undefined
        );
      }

      await db.updateEmailSubscription(input.id, {
        ...input,
        nextSendAt,
      });

      return { success: true };
    }),

  // 删除订阅
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const subscription = await db.getEmailSubscriptionById(input.id);
      if (!subscription || subscription.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "订阅不存在" });
      }

      await db.deleteEmailSubscription(input.id);
      return { success: true };
    }),

  // 切换订阅状态
  toggleActive: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const subscription = await db.getEmailSubscriptionById(input.id);
      if (!subscription || subscription.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "订阅不存在" });
      }

      await db.updateEmailSubscription(input.id, {
        isActive: !subscription.isActive,
      });

      return { success: true, isActive: !subscription.isActive };
    }),

  // 立即发送测试邮件
  sendTest: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const subscription = await db.getEmailSubscriptionById(input.id);
      if (!subscription || subscription.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "订阅不存在" });
      }

      // TODO: 实际发送测试邮件
      // 这里只是模拟发送
      await db.createEmailSendLog({
        subscriptionId: input.id,
        recipients: subscription.recipients || [],
        status: "sent",
        emailSubject: `[测试] ${subscription.name}`,
      });

      return { success: true, message: "测试邮件已发送" };
    }),

  // 获取发送日志
  getSendLogs: protectedProcedure
    .input(z.object({ subscriptionId: z.number(), limit: z.number().optional() }))
    .query(async ({ ctx, input }) => {
      const subscription = await db.getEmailSubscriptionById(input.subscriptionId);
      if (!subscription || subscription.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "订阅不存在" });
      }

      return db.getEmailSendLogsBySubscription(input.subscriptionId, input.limit || 20);
    }),

  // 获取最近的发送日志
  getRecentLogs: protectedProcedure
    .input(z.object({ limit: z.number().optional() }))
    .query(async ({ ctx, input }) => {
      return db.getRecentEmailSendLogs(ctx.user.id, input.limit || 50);
    }),

  // 获取可用的报表类型
  getReportTypes: publicProcedure.query(() => {
    return [
      { id: "cross_account_summary", name: "跨账号汇总报表", description: "所有店铺的整体广告表现汇总" },
      { id: "account_performance", name: "单账号表现报表", description: "单个店铺的详细广告表现" },
      { id: "campaign_performance", name: "广告活动表现报表", description: "广告活动级别的详细数据" },
      { id: "keyword_performance", name: "关键词表现报表", description: "关键词级别的详细数据" },
      { id: "health_alert", name: "健康度告警报表", description: "异常指标和健康度告警" },
      { id: "optimization_summary", name: "优化汇总报表", description: "自动优化执行情况汇总" },
    ];
  }),
});

// 计算下次发送时间的辅助函数
function calculateNextSendTime(
  frequency: string,
  sendTime: string,
  sendDayOfWeek?: number,
  sendDayOfMonth?: number
): Date {
  const now = new Date();
  const [hours, minutes] = sendTime.split(':').map(Number);
  
  const next = new Date(now);
  next.setHours(hours, minutes, 0, 0);

  if (frequency === 'daily') {
    if (next <= now) {
      next.setDate(next.getDate() + 1);
    }
  } else if (frequency === 'weekly') {
    const targetDay = sendDayOfWeek ?? 1; // 默认周一
    const currentDay = next.getDay();
    let daysUntilTarget = targetDay - currentDay;
    if (daysUntilTarget < 0 || (daysUntilTarget === 0 && next <= now)) {
      daysUntilTarget += 7;
    }
    next.setDate(next.getDate() + daysUntilTarget);
  } else if (frequency === 'monthly') {
    const targetDate = sendDayOfMonth ?? 1; // 默认1号
    next.setDate(targetDate);
    if (next <= now) {
      next.setMonth(next.getMonth() + 1);
    }
  }

  return next;
}

// ==================== Main Router ====================
export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  
  adAccount: adAccountRouter,
  performanceGroup: performanceGroupRouter,
  campaign: campaignRouter,
  keyword: keywordRouter,
  productTarget: productTargetRouter,
  biddingLog: biddingLogRouter,
  analytics: analyticsRouter,
  optimization: optimizationRouter,
  import: importRouter,
  amazonApi: amazonApiRouter,
  adAutomation: adAutomationRouter,
  notification: notificationRouter,
  scheduler: schedulerRouter,
  batchOperation: batchOperationRouter,
  correction: correctionRouter,
  crossAccount: crossAccountRouter,
  team: teamRouter,
  emailReport: emailReportRouter,
});

export type AppRouter = typeof appRouter;
