import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as db from "./db";
import * as bidOptimizer from "./bidOptimizer";

// ==================== Ad Account Router ====================
const adAccountRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return db.getAdAccountsByUserId(ctx.user.id);
  }),
  
  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return db.getAdAccountById(input.id);
    }),
  
  create: protectedProcedure
    .input(z.object({
      accountId: z.string(),
      accountName: z.string(),
      marketplace: z.string(),
      profileId: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const id = await db.createAdAccount({
        userId: ctx.user.id,
        ...input,
      });
      return { id };
    }),
  
  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      accountName: z.string().optional(),
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
});

export type AppRouter = typeof appRouter;
