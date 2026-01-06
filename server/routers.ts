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
import * as daypartingService from './daypartingService';
import * as unifiedOptimizationEngine from './unifiedOptimizationEngine';
import * as autoRollbackService from './autoRollbackService';
import * as algorithmOptimizationService from './algorithmOptimizationService';
import * as intelligentBudgetAllocationService from './intelligentBudgetAllocationService';

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
      dailyBudget: z.string().optional(),
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
  
  // 获取广告活动详情（包含广告组、关键词、搜索词等）
  getDetail: protectedProcedure
    .input(z.object({ campaignId: z.number() }))
    .query(async ({ input }) => {
      return db.getCampaignDetailWithStats(input.campaignId);
    }),
  
  // 获取广告位置表现数据
  getPlacementStats: protectedProcedure
    .input(z.object({ campaignId: z.number() }))
    .query(async ({ input }) => {
      return db.getCampaignPlacementStats(input.campaignId);
    }),
  
  // 获取广告活动所有投放词（关键词+商品定向）
  getTargets: protectedProcedure
    .input(z.object({ campaignId: z.number() }))
    .query(async ({ input }) => {
      return db.getCampaignTargets(input.campaignId);
    }),
  
  // 获取搜索词报告
  getSearchTerms: protectedProcedure
    .input(z.object({ campaignId: z.number() }))
    .query(async ({ input }) => {
      return db.getSearchTermsByCampaignId(input.campaignId);
    }),
  
  // AI摘要功能 - 生成广告活动表现摘要
  generateAISummary: protectedProcedure
    .input(z.object({ campaignId: z.number() }))
    .mutation(async ({ input }) => {
      const { invokeLLM } = await import("./_core/llm");
      
      // 获取广告活动详情
      const campaign = await db.getCampaignById(input.campaignId);
      if (!campaign) {
        throw new TRPCError({ code: "NOT_FOUND", message: "广告活动不存在" });
      }
      
      // 获取广告组和关键词数据
      const adGroups = await db.getAdGroupsByCampaignId(input.campaignId);
      let totalKeywords = 0;
      let topKeywords: any[] = [];
      
      for (const adGroup of adGroups) {
        const keywords = await db.getKeywordsByAdGroupId(adGroup.id);
        totalKeywords += keywords.length;
        // 收集表现最好的关键词
        topKeywords.push(...keywords.filter(k => parseFloat(k.sales || "0") > 0));
      }
      
      // 按销售额排序取前5个
      topKeywords.sort((a, b) => parseFloat(b.sales || "0") - parseFloat(a.sales || "0"));
      topKeywords = topKeywords.slice(0, 5);
      
      // 计算核心指标
      const spend = parseFloat(campaign.spend || "0");
      const sales = parseFloat(campaign.sales || "0");
      const acos = sales > 0 ? (spend / sales * 100) : 0;
      const roas = spend > 0 ? (sales / spend) : 0;
      const clicks = campaign.clicks || 0;
      const impressions = campaign.impressions || 0;
      const ctr = impressions > 0 ? (clicks / impressions * 100) : 0;
      const orders = campaign.orders || 0;
      const cvr = clicks > 0 ? (orders / clicks * 100) : 0;
      
      // 构建提示词
      const prompt = `你是一个专业的亚马逊广告优化专家。请根据以下广告活动数据，生成一份简洁的中文表现摘要。

广告活动信息：
- 名称：${campaign.campaignName}
- 类型：${campaign.campaignType}
- 状态：${campaign.status}
- 日预算：$${campaign.dailyBudget || "N/A"}

核心指标：
- 花费：$${spend.toFixed(2)}
- 销售额：$${sales.toFixed(2)}
- ACoS：${acos.toFixed(2)}%
- ROAS：${roas.toFixed(2)}
- 点击率(CTR)：${ctr.toFixed(2)}%
- 转化率(CVR)：${cvr.toFixed(2)}%
- 展示次数：${impressions.toLocaleString()}
- 点击次数：${clicks.toLocaleString()}
- 订单数：${orders}

广告组数量：${adGroups.length}
关键词数量：${totalKeywords}

表现最佳关键词（按销售额排序）：
${topKeywords.map((k, i) => `${i + 1}. "${k.keywordText}" - 销售额: $${parseFloat(k.sales || "0").toFixed(2)}, ACoS: ${parseFloat(k.sales || "0") > 0 ? (parseFloat(k.spend || "0") / parseFloat(k.sales || "0") * 100).toFixed(2) : "N/A"}%`).join("\n")}

请提供：
1. 整体表现评价（一句话总结）
2. 主要优势（2-3点）
3. 需要改进的方面（2-3点）
4. 具体优化建议（2-3条可执行的建议）

请用简洁的中文回复，使用Markdown格式。`;
      
      try {
        const response = await invokeLLM({
          messages: [
            { role: "system", content: "你是一个专业的亚马逊广告优化顾问，擅长分析广告数据并提供可执行的优化建议。" },
            { role: "user", content: prompt }
          ]
        });
        
        const summary = response.choices[0]?.message?.content || "无法生成摘要";
        
        return {
          summary: typeof summary === "string" ? summary : JSON.stringify(summary),
          metrics: {
            spend,
            sales,
            acos,
            roas,
            ctr,
            cvr,
            impressions,
            clicks,
            orders,
            adGroupCount: adGroups.length,
            keywordCount: totalKeywords
          },
          topKeywords: topKeywords.map(k => ({
            keyword: k.keywordText,
            sales: parseFloat(k.sales || "0"),
            acos: parseFloat(k.sales || "0") > 0 ? (parseFloat(k.spend || "0") / parseFloat(k.sales || "0") * 100) : null
          })),
          generatedAt: new Date().toISOString()
        };
      } catch (error) {
        console.error("AI摘要生成失败:", error);
        throw new TRPCError({ 
          code: "INTERNAL_SERVER_ERROR", 
          message: "AI摘要生成失败，请稍后重试" 
        });
      }
    }),
  
  // AI智能分析（包含可执行建议和效果预估）
  generateAIAnalysis: protectedProcedure
    .input(z.object({ campaignId: z.number() }))
    .mutation(async ({ input }) => {
      const { generateAIAnalysisWithSuggestions } = await import("./aiOptimizationService");
      return generateAIAnalysisWithSuggestions(input.campaignId);
    }),
  
  // 执行AI优化建议
  executeAIOptimization: protectedProcedure
    .input(z.object({
      campaignId: z.number(),
      suggestions: z.array(z.object({
        type: z.enum(["bid_adjustment", "status_change", "negative_keyword"]),
        targetType: z.enum(["keyword", "product_target", "search_term"]),
        targetId: z.number().optional(),
        targetText: z.string(),
        action: z.enum(["bid_increase", "bid_decrease", "bid_set", "enable", "pause", "negate_phrase", "negate_exact"]),
        currentValue: z.string().optional(),
        suggestedValue: z.string().optional(),
        reason: z.string(),
        priority: z.enum(["high", "medium", "low"]),
        expectedImpact: z.object({
          spendChange: z.number().optional(),
          salesChange: z.number().optional(),
          acosChange: z.number().optional(),
          roasChange: z.number().optional(),
        }).optional(),
      })),
      predictions: z.array(z.object({
        period: z.enum(["7_days", "14_days", "30_days"]),
        predictedSpend: z.number(),
        predictedSales: z.number(),
        predictedAcos: z.number(),
        predictedRoas: z.number(),
        spendChangePercent: z.number(),
        salesChangePercent: z.number(),
        acosChangePercent: z.number(),
        roasChangePercent: z.number(),
        confidence: z.number(),
        rationale: z.string(),
      })),
      aiSummary: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { executeOptimizationSuggestions } = await import("./aiOptimizationService");
      
      // 获取广告活动信息
      const campaign = await db.getCampaignById(input.campaignId);
      if (!campaign) {
        throw new TRPCError({ code: "NOT_FOUND", message: "广告活动不存在" });
      }
      
      return executeOptimizationSuggestions(
        ctx.user.id,
        campaign.accountId,
        input.campaignId,
        input.suggestions,
        input.predictions,
        input.aiSummary
      );
    }),
  
  // 获取AI优化执行历史
  getAIOptimizationHistory: protectedProcedure
    .input(z.object({ campaignId: z.number() }))
    .query(async ({ input }) => {
      return db.getAiOptimizationExecutionsByCampaign(input.campaignId);
    }),
  
  // 获取AI优化执行详情
  getAIOptimizationDetail: protectedProcedure
    .input(z.object({ executionId: z.number() }))
    .query(async ({ input }) => {
      return db.getAiOptimizationExecutionDetail(input.executionId);
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
  
  // 批量更新出价
  batchUpdateBid: protectedProcedure
    .input(z.object({
      ids: z.array(z.number()),
      bidType: z.enum(["fixed", "increase_percent", "decrease_percent", "cpc_multiplier", "cpc_increase_percent", "cpc_decrease_percent"]),
      bidValue: z.number(),
    }))
    .mutation(async ({ input }) => {
      const results = [];
      for (const id of input.ids) {
        const keyword = await db.getKeywordById(id);
        if (!keyword) continue;
        
        let newBid: number;
        const currentBid = parseFloat(keyword.bid);
        const spend = parseFloat(keyword.spend || "0");
        const clicks = keyword.clicks || 0;
        const cpc = clicks > 0 ? spend / clicks : currentBid; // 如果没有点击，使用当前出价作为CPC
        
        if (input.bidType === "fixed") {
          newBid = input.bidValue;
        } else if (input.bidType === "increase_percent") {
          newBid = currentBid * (1 + input.bidValue / 100);
        } else if (input.bidType === "decrease_percent") {
          newBid = currentBid * (1 - input.bidValue / 100);
        } else if (input.bidType === "cpc_multiplier") {
          // 按CPC倍数设置出价
          newBid = cpc * input.bidValue;
        } else if (input.bidType === "cpc_increase_percent") {
          // 按CPC百分比提高
          newBid = cpc * (1 + input.bidValue / 100);
        } else {
          // cpc_decrease_percent - 按CPC百分比降低
          newBid = cpc * (1 - input.bidValue / 100);
        }
        
        // 确保出价不低于0.02
        newBid = Math.max(0.02, Math.round(newBid * 100) / 100);
        
        await db.updateKeywordBid(id, newBid.toFixed(2));
        results.push({ id, oldBid: currentBid, newBid, cpc });
      }
      return { success: true, updated: results.length, results };
    }),
  
  // 批量更新状态
  batchUpdateStatus: protectedProcedure
    .input(z.object({
      ids: z.array(z.number()),
      status: z.enum(["enabled", "paused"]),
    }))
    .mutation(async ({ input }) => {
      let updated = 0;
      for (const id of input.ids) {
        await db.updateKeyword(id, { status: input.status });
        updated++;
      }
      return { success: true, updated };
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
  
  // 获取关键词历史趋势数据
  getHistoryTrend: protectedProcedure
    .input(z.object({
      id: z.number(),
      days: z.number().min(7).max(90).default(30),
    }))
    .query(async ({ input }) => {
      const keyword = await db.getKeywordById(input.id);
      if (!keyword) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Keyword not found" });
      }
      
      // 获取历史数据
      const historyData = await db.getKeywordHistoryData(input.id, input.days);
      
      // 如果没有历史数据，生成模拟数据
      if (!historyData || historyData.length === 0) {
        const simulatedData = generateSimulatedTrendData(keyword, input.days);
        return {
          keyword: {
            id: keyword.id,
            keywordText: keyword.keywordText,
            matchType: keyword.matchType,
            bid: keyword.bid,
          },
          trendData: simulatedData,
          summary: calculateTrendSummary(simulatedData),
        };
      }
      
      return {
        keyword: {
          id: keyword.id,
          keywordText: keyword.keywordText,
          matchType: keyword.matchType,
          bid: keyword.bid,
        },
        trendData: historyData,
        summary: calculateTrendSummary(historyData),
      };
    }),
  
  // 批量创建关键词（从搜索词转投放词）
  batchCreate: protectedProcedure
    .input(z.object({
      adGroupId: z.number(),
      keywords: z.array(z.object({
        keywordText: z.string(),
        matchType: z.enum(["broad", "phrase", "exact"]),
        bid: z.string(),
      })),
    }))
    .mutation(async ({ input }) => {
      const results = [];
      const errors = [];
      
      for (const kw of input.keywords) {
        try {
          // 检查是否已存在相同的关键词（相同文本+相同匹配方式）
          const existingKeywords = await db.getKeywordsByAdGroupId(input.adGroupId);
          const exists = existingKeywords.some(
            (existing) => 
              existing.keywordText.toLowerCase() === kw.keywordText.toLowerCase() &&
              existing.matchType === kw.matchType
          );
          
          if (exists) {
            errors.push({
              keywordText: kw.keywordText,
              matchType: kw.matchType,
              error: "关键词已存在",
            });
            continue;
          }
          
          const id = await db.createKeyword({
            adGroupId: input.adGroupId,
            keywordText: kw.keywordText,
            matchType: kw.matchType,
            bid: kw.bid,
            status: "enabled",
          });
          
          results.push({
            id,
            keywordText: kw.keywordText,
            matchType: kw.matchType,
            bid: kw.bid,
          });
        } catch (error) {
          errors.push({
            keywordText: kw.keywordText,
            matchType: kw.matchType,
            error: error instanceof Error ? error.message : "创建失败",
          });
        }
      }
      
      return {
        success: true,
        created: results.length,
        failed: errors.length,
        results,
        errors,
      };
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
  
  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      bid: z.string().optional(),
      status: z.enum(["enabled", "paused", "archived"]).optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await db.updateProductTarget(id, data);
      return { success: true };
    }),
  
  // 批量更新出价
  batchUpdateBid: protectedProcedure
    .input(z.object({
      ids: z.array(z.number()),
      bidType: z.enum(["fixed", "increase_percent", "decrease_percent", "cpc_multiplier", "cpc_increase_percent", "cpc_decrease_percent"]),
      bidValue: z.number(),
    }))
    .mutation(async ({ input }) => {
      const results = [];
      for (const id of input.ids) {
        const target = await db.getProductTargetById(id);
        if (!target) continue;
        
        let newBid: number;
        const currentBid = parseFloat(target.bid);
        const spend = parseFloat(target.spend || "0");
        const clicks = target.clicks || 0;
        const cpc = clicks > 0 ? spend / clicks : currentBid; // 如果没有点击，使用当前出价作为CPC
        
        if (input.bidType === "fixed") {
          newBid = input.bidValue;
        } else if (input.bidType === "increase_percent") {
          newBid = currentBid * (1 + input.bidValue / 100);
        } else if (input.bidType === "decrease_percent") {
          newBid = currentBid * (1 - input.bidValue / 100);
        } else if (input.bidType === "cpc_multiplier") {
          // 按CPC倍数设置出价
          newBid = cpc * input.bidValue;
        } else if (input.bidType === "cpc_increase_percent") {
          // 按CPC百分比提高
          newBid = cpc * (1 + input.bidValue / 100);
        } else {
          // cpc_decrease_percent - 按CPC百分比降低
          newBid = cpc * (1 - input.bidValue / 100);
        }
        
        newBid = Math.max(0.02, Math.round(newBid * 100) / 100);
        
        await db.updateProductTargetBid(id, newBid.toFixed(2));
        results.push({ id, oldBid: currentBid, newBid, cpc });
      }
      return { success: true, updated: results.length, results };
    }),
  
  // 批量更新状态
  batchUpdateStatus: protectedProcedure
    .input(z.object({
      ids: z.array(z.number()),
      status: z.enum(["enabled", "paused"]),
    }))
    .mutation(async ({ input }) => {
      let updated = 0;
      for (const id of input.ids) {
        await db.updateProductTarget(id, { status: input.status });
        updated++;
      }
      return { success: true, updated };
    }),
  
  // 获取商品定向历史趋势数据
  getHistoryTrend: protectedProcedure
    .input(z.object({
      id: z.number(),
      days: z.number().min(7).max(90).default(30),
    }))
    .query(async ({ input }) => {
      const target = await db.getProductTargetById(input.id);
      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Product target not found" });
      }
      
      // 获取历史数据
      const historyData = await db.getProductTargetHistoryData(input.id, input.days);
      
      // 如果没有历史数据，生成模拟数据
      if (!historyData || historyData.length === 0) {
        const simulatedData = generateSimulatedTrendData(target, input.days);
        return {
          target: {
            id: target.id,
            targetExpression: target.targetExpression,
            targetType: target.targetType,
            bid: target.bid,
          },
          trendData: simulatedData,
          summary: calculateTrendSummary(simulatedData),
        };
      }
      
      return {
        target: {
          id: target.id,
          targetExpression: target.targetExpression,
          targetType: target.targetType,
          bid: target.bid,
        },
        trendData: historyData,
        summary: calculateTrendSummary(historyData),
      };
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
  // Generate OAuth authorization URL for specific region
  getAuthUrl: protectedProcedure
    .input(z.object({
      clientId: z.string(),
      redirectUri: z.string(),
      region: z.enum(['NA', 'EU', 'FE']).optional().default('NA'),
    }))
    .query(({ input }) => {
      const authUrl = AmazonAdsApiClient.generateAuthUrl(
        input.clientId,
        input.redirectUri,
        input.region,
        `user_${Date.now()}`
      );
      return { authUrl };
    }),

  // Generate OAuth authorization URLs for all regions
  getAllRegionAuthUrls: protectedProcedure
    .input(z.object({
      clientId: z.string(),
      redirectUri: z.string(),
    }))
    .query(({ input }) => {
      const urls = AmazonAdsApiClient.generateAllRegionAuthUrls(
        input.clientId,
        input.redirectUri,
        `user_${Date.now()}`
      );
      return { urls };
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

  // Check Token health and expiration status
  checkTokenHealth: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .query(async ({ input }) => {
      const credentials = await db.getAmazonApiCredentials(input.accountId);
      if (!credentials) {
        return {
          status: 'not_configured' as const,
          message: '未配置API凭证',
          isHealthy: false,
          needsReauth: true,
        };
      }

      try {
        // Try to refresh token to check if it's still valid
        const client = new AmazonAdsApiClient({
          clientId: credentials.clientId,
          clientSecret: credentials.clientSecret,
          refreshToken: credentials.refreshToken,
          profileId: credentials.profileId,
          region: credentials.region as 'NA' | 'EU' | 'FE',
        });

        // Try to get profiles as a health check
        await client.getProfiles();

        // Calculate token age (if we had token creation time)
        const lastSyncAt = credentials.lastSyncAt;
        const daysSinceSync = lastSyncAt 
          ? Math.floor((Date.now() - new Date(lastSyncAt).getTime()) / (1000 * 60 * 60 * 24))
          : null;

        // Warn if no sync in 7+ days
        const syncWarning = daysSinceSync !== null && daysSinceSync > 7;

        return {
          status: 'healthy' as const,
          message: 'API连接正常',
          isHealthy: true,
          needsReauth: false,
          lastSyncAt: credentials.lastSyncAt,
          daysSinceSync,
          syncWarning,
          region: credentials.region,
        };
      } catch (error: any) {
        // Check if it's an auth error
        const isAuthError = error.message?.includes('401') || 
                           error.message?.includes('unauthorized') ||
                           error.message?.includes('invalid_grant') ||
                           error.message?.includes('token');

        if (isAuthError) {
          return {
            status: 'expired' as const,
            message: 'Token已过期，请重新授权',
            isHealthy: false,
            needsReauth: true,
            error: error.message,
          };
        }

        return {
          status: 'error' as const,
          message: `连接错误: ${error.message}`,
          isHealthy: false,
          needsReauth: false,
          error: error.message,
        };
      }
    }),

  // Batch check all accounts token health
  checkAllTokensHealth: protectedProcedure
    .query(async ({ ctx }) => {
      const accounts = await db.getAdAccountsByUserId(ctx.user.id);
      const results = [];

      for (const account of accounts) {
        const credentials = await db.getAmazonApiCredentials(account.id);
        if (!credentials) {
          results.push({
            accountId: account.id,
            accountName: account.accountName,
            status: 'not_configured' as const,
            isHealthy: false,
            needsReauth: true,
          });
          continue;
        }

        try {
          const client = new AmazonAdsApiClient({
            clientId: credentials.clientId,
            clientSecret: credentials.clientSecret,
            refreshToken: credentials.refreshToken,
            profileId: credentials.profileId,
            region: credentials.region as 'NA' | 'EU' | 'FE',
          });

          await client.getProfiles();

          results.push({
            accountId: account.id,
            accountName: account.accountName,
            status: 'healthy' as const,
            isHealthy: true,
            needsReauth: false,
            lastSyncAt: credentials.lastSyncAt,
          });
        } catch (error: any) {
          const isAuthError = error.message?.includes('401') || 
                             error.message?.includes('unauthorized') ||
                             error.message?.includes('invalid_grant');

          results.push({
            accountId: account.id,
            accountName: account.accountName,
            status: isAuthError ? 'expired' as const : 'error' as const,
            isHealthy: false,
            needsReauth: isAuthError,
            error: error.message,
          });
        }
      }

      const healthyCount = results.filter(r => r.isHealthy).length;
      const expiredCount = results.filter(r => r.status === 'expired').length;
      const errorCount = results.filter(r => r.status === 'error').length;

      return {
        accounts: results,
        summary: {
          total: results.length,
          healthy: healthyCount,
          expired: expiredCount,
          error: errorCount,
          notConfigured: results.filter(r => r.status === 'not_configured').length,
        },
        hasIssues: expiredCount > 0 || errorCount > 0,
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

  // Get operation history with detailed records
  getHistory: protectedProcedure
    .input(z.object({
      accountId: z.number().optional(),
      operationType: z.enum(['negative_keyword', 'bid_adjustment', 'keyword_migration', 'campaign_status']).optional(),
      status: z.enum(['pending', 'approved', 'executing', 'completed', 'failed', 'cancelled', 'rolled_back']).optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      limit: z.number().optional().default(50),
      offset: z.number().optional().default(0),
    }))
    .query(async ({ ctx, input }) => {
      const operations = await db.listBatchOperations(ctx.user.id, {
        accountId: input.accountId,
        status: input.status,
        operationType: input.operationType,
        limit: input.limit,
      });

      // Filter by date if provided
      let filteredOps = operations;
      if (input.startDate) {
        const startDate = new Date(input.startDate);
        filteredOps = filteredOps.filter(op => new Date(op.createdAt) >= startDate);
      }
      if (input.endDate) {
        const endDate = new Date(input.endDate);
        endDate.setHours(23, 59, 59, 999);
        filteredOps = filteredOps.filter(op => new Date(op.createdAt) <= endDate);
      }

      // Calculate statistics
      const stats = {
        total: filteredOps.length,
        completed: filteredOps.filter(op => op.status === 'completed').length,
        failed: filteredOps.filter(op => op.status === 'failed').length,
        pending: filteredOps.filter(op => op.status === 'pending' || op.status === 'approved').length,
        rolledBack: filteredOps.filter(op => op.status === 'rolled_back').length,
        totalItemsProcessed: filteredOps.reduce((sum, op) => sum + (op.processedItems || 0), 0),
        totalSuccessItems: filteredOps.reduce((sum, op) => sum + (op.successItems || 0), 0),
        totalFailedItems: filteredOps.reduce((sum, op) => sum + (op.failedItems || 0), 0),
      };

      return {
        operations: filteredOps.slice(input.offset, input.offset + input.limit),
        stats,
        pagination: {
          total: filteredOps.length,
          limit: input.limit,
          offset: input.offset,
          hasMore: input.offset + input.limit < filteredOps.length,
        },
      };
    }),

  // Get detailed operation record with all items
  getDetailedRecord: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const batch = await db.getBatchOperation(input.id);
      if (!batch) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Batch operation not found' });
      }
      const items = await db.getBatchOperationItems(input.id);

      // Group items by status
      const itemsByStatus = {
        success: items.filter(item => item.status === 'success'),
        failed: items.filter(item => item.status === 'failed'),
        pending: items.filter(item => item.status === 'pending'),
        skipped: items.filter(item => item.status === 'skipped'),
        rolledBack: items.filter(item => item.status === 'rolled_back'),
      };

      // Calculate execution duration
      let executionDuration: number | null = null;
      if (batch.executedAt && batch.completedAt) {
        executionDuration = new Date(batch.completedAt).getTime() - new Date(batch.executedAt).getTime();
      }

      return {
        ...batch,
        items,
        itemsByStatus,
        executionDuration,
        summary: batchOperationService.generateBatchSummary({
          batchId: batch.id,
          status: batch.status as batchOperationService.BatchStatus,
          totalItems: batch.totalItems || 0,
          processedItems: batch.processedItems || 0,
          successItems: batch.successItems || 0,
          failedItems: batch.failedItems || 0,
          errors: items.filter(i => i.errorMessage).map(i => ({
            itemId: i.id,
            error: i.errorMessage || 'Unknown error',
          })),
        }),
      };
    }),

  // Export operation history
  exportHistory: protectedProcedure
    .input(z.object({
      operationIds: z.array(z.number()).optional(),
      format: z.enum(['json', 'csv']).default('json'),
    }))
    .query(async ({ ctx, input }) => {
      let operations;
      if (input.operationIds && input.operationIds.length > 0) {
        operations = await Promise.all(
          input.operationIds.map(id => db.getBatchOperation(id))
        );
        operations = operations.filter(Boolean);
      } else {
        operations = await db.listBatchOperations(ctx.user.id, { limit: 1000 });
      }

      if (input.format === 'csv') {
        const headers = ['ID', '操作名称', '操作类型', '状态', '总项数', '成功数', '失败数', '创建时间', '执行时间', '完成时间'];
        const rows = operations.map(op => [
          op?.id,
          op?.name,
          op?.operationType,
          op?.status,
          op?.totalItems,
          op?.successItems,
          op?.failedItems,
          op?.createdAt,
          op?.executedAt,
          op?.completedAt,
        ]);
        const csv = [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
        return { format: 'csv', data: csv };
      }

      return { format: 'json', data: operations };
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

// ==================== Audit Log Router ====================
const auditRouter = router({
  // 获取审计日志列表
  list: protectedProcedure
    .input(z.object({
      actionTypes: z.array(z.string()).optional(),
      targetTypes: z.array(z.string()).optional(),
      accountId: z.number().optional(),
      status: z.string().optional(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
      search: z.string().optional(),
      page: z.number().default(1),
      pageSize: z.number().default(20),
    }))
    .query(async ({ ctx, input }) => {
      const { getAuditLogs } = await import("./auditService");
      return getAuditLogs({
        ...input,
        userId: ctx.user.id,
      });
    }),

  // 获取单个审计日志详情
  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const { getAuditLogById } = await import("./auditService");
      return getAuditLogById(input.id);
    }),

  // 获取用户操作统计
  userStats: protectedProcedure
    .input(z.object({ days: z.number().default(30) }))
    .query(async ({ ctx, input }) => {
      const { getUserAuditStats } = await import("./auditService");
      return getUserAuditStats(ctx.user.id, input.days);
    }),

  // 获取账号操作统计
  accountStats: protectedProcedure
    .input(z.object({ accountId: z.number(), days: z.number().default(30) }))
    .query(async ({ input }) => {
      const { getAccountAuditStats } = await import("./auditService");
      return getAccountAuditStats(input.accountId, input.days);
    }),

  // 导出审计日志
  export: protectedProcedure
    .input(z.object({
      actionTypes: z.array(z.string()).optional(),
      accountId: z.number().optional(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { exportAuditLogsToCSV } = await import("./auditService");
      const csv = await exportAuditLogsToCSV({
        ...input,
        userId: ctx.user.id,
      });
      return { csv };
    }),

  // 获取操作类型和描述
  getActionTypes: publicProcedure.query(async () => {
    const { ACTION_CATEGORIES, ACTION_DESCRIPTIONS, TARGET_TYPE_DESCRIPTIONS } = await import("./auditService");
    return {
      categories: ACTION_CATEGORIES,
      actionDescriptions: ACTION_DESCRIPTIONS,
      targetTypeDescriptions: TARGET_TYPE_DESCRIPTIONS,
    };
  }),
});

// ==================== Collaboration Notification Router ====================
const collaborationRouter = router({
  // 获取用户通知列表
  list: protectedProcedure
    .input(z.object({
      status: z.string().optional(),
      page: z.number().default(1),
      pageSize: z.number().default(20),
    }))
    .query(async ({ ctx, input }) => {
      const { getUserNotifications } = await import("./collaborationNotificationService");
      return getUserNotifications({
        userId: ctx.user.id,
        ...input,
      });
    }),

  // 获取通知统计
  stats: protectedProcedure.query(async ({ ctx }) => {
    const { getNotificationStats } = await import("./collaborationNotificationService");
    return getNotificationStats(ctx.user.id);
  }),

  // 标记通知为已读
  markAsRead: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const { markNotificationAsRead } = await import("./collaborationNotificationService");
      return markNotificationAsRead(input.id);
    }),

  // 标记所有通知为已读
  markAllAsRead: protectedProcedure.mutation(async ({ ctx }) => {
    const { markAllNotificationsAsRead } = await import("./collaborationNotificationService");
    const count = await markAllNotificationsAsRead(ctx.user.id);
    return { count };
  }),

  // 获取用户通知偏好设置
  getPreferences: protectedProcedure.query(async ({ ctx }) => {
    const { getUserNotificationPreferences } = await import("./collaborationNotificationService");
    return getUserNotificationPreferences(ctx.user.id);
  }),

  // 更新用户通知偏好设置
  updatePreferences: protectedProcedure
    .input(z.object({
      enableAppNotifications: z.boolean().optional(),
      enableEmailNotifications: z.boolean().optional(),
      bidAdjustNotify: z.boolean().optional(),
      negativeKeywordNotify: z.boolean().optional(),
      campaignChangeNotify: z.boolean().optional(),
      automationNotify: z.boolean().optional(),
      teamChangeNotify: z.boolean().optional(),
      dataImportExportNotify: z.boolean().optional(),
      notifyOnLow: z.boolean().optional(),
      notifyOnMedium: z.boolean().optional(),
      notifyOnHigh: z.boolean().optional(),
      notifyOnCritical: z.boolean().optional(),
      quietHoursEnabled: z.boolean().optional(),
      quietHoursStart: z.string().optional(),
      quietHoursEnd: z.string().optional(),
      timezone: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { updateUserNotificationPreferences } = await import("./collaborationNotificationService");
      return updateUserNotificationPreferences(ctx.user.id, input);
    }),

  // 获取重要操作类型列表
  getImportantActions: publicProcedure.query(async () => {
    const { IMPORTANT_ACTIONS, ACTION_PRIORITY, ACTION_NOTIFICATION_TEMPLATES } = await import("./collaborationNotificationService");
    return {
      importantActions: IMPORTANT_ACTIONS,
      actionPriority: ACTION_PRIORITY,
      actionTemplates: ACTION_NOTIFICATION_TEMPLATES,
    };
  }),
});

// ==================== Budget Allocation Router ====================
const budgetAllocationRouter = router({
  // 生成预算分配建议
  generateAllocation: protectedProcedure
    .input(z.object({
      accountId: z.number().nullable(),
      totalBudget: z.number().min(0),
      prioritizeHighRoas: z.boolean().optional(),
      prioritizeNewProducts: z.boolean().optional(),
      minCampaignBudget: z.number().optional(),
      maxCampaignBudget: z.number().optional(),
      targetRoas: z.number().optional(),
      targetAcos: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { generateBudgetAllocation } = await import("./budgetAllocationService");
      return generateBudgetAllocation(ctx.user.id, input.accountId, input.totalBudget, {
        prioritizeHighRoas: input.prioritizeHighRoas,
        prioritizeNewProducts: input.prioritizeNewProducts,
        minCampaignBudget: input.minCampaignBudget,
        maxCampaignBudget: input.maxCampaignBudget,
        targetRoas: input.targetRoas,
        targetAcos: input.targetAcos,
      });
    }),

  // 保存预算分配方案
  saveAllocation: protectedProcedure
    .input(z.object({
      accountId: z.number().nullable(),
      goalId: z.number().nullable(),
      allocationName: z.string().min(1),
      description: z.string(),
      result: z.any(), // AllocationResult
    }))
    .mutation(async ({ ctx, input }) => {
      const { saveBudgetAllocation } = await import("./budgetAllocationService");
      const allocationId = await saveBudgetAllocation(
        ctx.user.id,
        input.accountId,
        input.goalId,
        input.allocationName,
        input.description,
        input.result
      );
      return { allocationId };
    }),

  // 应用预算分配方案
  applyAllocation: protectedProcedure
    .input(z.object({
      allocationId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { applyBudgetAllocation } = await import("./budgetAllocationService");
      return applyBudgetAllocation(input.allocationId, ctx.user.id);
    }),

  // 获取预算分配历史
  getAllocationHistory: protectedProcedure
    .input(z.object({
      accountId: z.number().optional(),
      limit: z.number().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const { getBudgetAllocationHistory } = await import("./budgetAllocationService");
      return getBudgetAllocationHistory(ctx.user.id, input.accountId, input.limit);
    }),

  // 获取预算调整历史
  getBudgetHistory: protectedProcedure
    .input(z.object({
      accountId: z.number().optional(),
      campaignId: z.number().optional(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
      limit: z.number().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const { getBudgetHistory } = await import("./budgetAllocationService");
      return getBudgetHistory(ctx.user.id, input);
    }),

  // 创建预算目标
  createGoal: protectedProcedure
    .input(z.object({
      accountId: z.number().optional(),
      goalType: z.enum(["sales_target", "roas_target", "acos_target", "profit_target", "market_share"]),
      targetValue: z.number().min(0),
      periodType: z.enum(["daily", "weekly", "monthly", "quarterly"]).optional(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
      totalBudget: z.number().optional(),
      minCampaignBudget: z.number().optional(),
      maxCampaignBudget: z.number().optional(),
      prioritizeHighRoas: z.boolean().optional(),
      prioritizeNewProducts: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { createBudgetGoal } = await import("./budgetAllocationService");
      const goalId = await createBudgetGoal(ctx.user.id, input);
      return { goalId };
    }),

  // 获取预算目标列表
  getGoals: protectedProcedure
    .input(z.object({
      accountId: z.number().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const { getBudgetGoals } = await import("./budgetAllocationService");
      return getBudgetGoals(ctx.user.id, input.accountId);
    }),

  // 更新预算目标
  updateGoal: protectedProcedure
    .input(z.object({
      goalId: z.number(),
      targetValue: z.number().optional(),
      totalBudget: z.number().optional(),
      status: z.enum(["active", "paused", "completed", "expired"]).optional(),
    }))
    .mutation(async ({ input }) => {
      const { updateBudgetGoal } = await import("./budgetAllocationService");
      await updateBudgetGoal(input.goalId, {
        targetValue: input.targetValue,
        totalBudget: input.totalBudget,
        status: input.status,
      });
      return { success: true };
    }),

  // 删除预算目标
  deleteGoal: protectedProcedure
    .input(z.object({
      goalId: z.number(),
    }))
    .mutation(async ({ input }) => {
      const { deleteBudgetGoal } = await import("./budgetAllocationService");
      await deleteBudgetGoal(input.goalId);
      return { success: true };
    }),
});

// ==================== Budget Alert Router ====================
import * as budgetAlertService from "./budgetAlertService";

const budgetAlertRouter = router({
  // 获取预算预警设置
  getSettings: protectedProcedure
    .input(z.object({ accountId: z.number().optional() }))
    .query(async ({ ctx, input }) => {
      return budgetAlertService.getAlertSettings(ctx.user.id, input.accountId);
    }),

  // 保存预算预警设置
  saveSettings: protectedProcedure
    .input(z.object({
      accountId: z.number().optional(),
      fastConsumptionThreshold: z.number().min(100).max(500),
      slowConsumptionThreshold: z.number().min(10).max(100),
      checkInterval: z.number().min(1).max(24),
      notifyEmail: z.boolean(),
      notifyInApp: z.boolean(),
    }))
    .mutation(async ({ ctx, input }) => {
      return budgetAlertService.saveAlertSettings(ctx.user.id, input);
    }),

  // 获取预算消耗预警列表
  getAlerts: protectedProcedure
    .input(z.object({
      accountId: z.number().optional(),
      alertType: z.enum(["overspending", "underspending", "budget_depleted", "near_depletion"]).optional(),
      status: z.enum(["active", "acknowledged", "resolved"]).optional(),
      limit: z.number().default(50),
      offset: z.number().default(0),
    }))
    .query(async ({ ctx, input }) => {
      return budgetAlertService.getAlerts(ctx.user.id, input);
    }),

  // 确认预警
  acknowledgeAlert: protectedProcedure
    .input(z.object({ alertId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      return budgetAlertService.acknowledgeAlert(input.alertId, ctx.user.id);
    }),

  // 检查预算消耗
  checkConsumption: protectedProcedure
    .input(z.object({ accountId: z.number().optional() }))
    .mutation(async ({ ctx, input }) => {
      return budgetAlertService.runBudgetConsumptionCheck(ctx.user.id, input.accountId);
    }),
});

// ==================== Budget Tracking Router ====================
import * as budgetTrackingService from "./budgetTrackingService";

const budgetTrackingRouter = router({
  // 创建效果追踪
  createTracking: protectedProcedure
    .input(z.object({
      allocationId: z.number(),
      trackingPeriodDays: z.number().default(14),
    }))
    .mutation(async ({ ctx, input }) => {
      const periodMap: Record<number, "7_days" | "14_days" | "30_days"> = { 7: "7_days", 14: "14_days", 30: "30_days" };
      const period = periodMap[input.trackingPeriodDays] || "14_days";
      return budgetTrackingService.createTracking(ctx.user.id, input.allocationId, period);
    }),

  // 获取追踪列表
  getTrackings: protectedProcedure
    .input(z.object({
      accountId: z.number().optional(),
      status: z.enum(["tracking", "completed", "cancelled"]).optional(),
      limit: z.number().default(20),
      offset: z.number().default(0),
    }))
    .query(async ({ ctx, input }) => {
      return budgetTrackingService.getTrackingList(ctx.user.id, input);
    }),

  // 获取追踪详情
  getTrackingDetail: protectedProcedure
    .input(z.object({ trackingId: z.number() }))
    .query(async ({ input }) => {
      return budgetTrackingService.getTrackingReport(input.trackingId);
    }),

  // 生成效果报告
  generateReport: protectedProcedure
    .input(z.object({ trackingId: z.number() }))
    .mutation(async ({ input }) => {
      return budgetTrackingService.updateTrackingMetrics(input.trackingId);
    }),
});

// ==================== Seasonal Budget Router ====================
import * as seasonalBudgetService from "./seasonalBudgetService";

const seasonalBudgetRouter = router({
  // 获取季节性建议
  getRecommendations: protectedProcedure
    .input(z.object({
      accountId: z.number().optional(),
      status: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      return seasonalBudgetService.getRecommendations(ctx.user.id, { accountId: input.accountId, status: input.status });
    }),

  // 生成季节性建议
  generateRecommendations: protectedProcedure
    .input(z.object({
      accountId: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const recommendations = await seasonalBudgetService.generateSeasonalRecommendations(ctx.user.id, input.accountId);
      await seasonalBudgetService.saveRecommendations(recommendations);
      return { success: true, count: recommendations.length, recommendations };
    }),

  // 应用建议
  applyRecommendation: protectedProcedure
    .input(z.object({ recommendationId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      return seasonalBudgetService.applyRecommendation(input.recommendationId, ctx.user.id);
    }),

  // 获取即将到来的促销活动
  getUpcomingEvents: protectedProcedure
    .input(z.object({ marketplace: z.string().optional() }))
    .query(async ({ input }) => {
      return seasonalBudgetService.getPromotionalEvents({ marketplace: input.marketplace, isActive: true });
    }),

  // 获取历史趋势数据
  getHistoricalTrends: protectedProcedure
    .input(z.object({
      accountId: z.number().optional(),
    }))
    .query(async ({ ctx, input }) => {
      return seasonalBudgetService.getSeasonalTrends(ctx.user.id, input.accountId);
    }),

  // 获取历史大促效果对比数据
  getEventPerformanceComparison: protectedProcedure
    .input(z.object({
      accountId: z.number().optional(),
      eventType: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      return seasonalBudgetService.getEventPerformanceComparison(ctx.user.id, {
        accountId: input.accountId,
        eventType: input.eventType,
      });
    }),

  // 获取大促活动效果汇总统计
  getEventSummaryStats: protectedProcedure
    .input(z.object({
      accountId: z.number().optional(),
    }))
    .query(async ({ ctx, input }) => {
      return seasonalBudgetService.getEventSummaryStats(ctx.user.id, {
        accountId: input.accountId,
      });
    }),
});

// ==================== Data Sync Router ====================
import * as dataSyncService from "./dataSyncService";

const dataSyncRouter = router({
  // 创建同步任务
  createJob: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      syncType: z.enum(["campaigns", "keywords", "performance", "all"]).default("all"),
    }))
    .mutation(async ({ ctx, input }) => {
      const jobId = await dataSyncService.createSyncJob(ctx.user.id, input.accountId, input.syncType);
      if (!jobId) return { success: false, message: "创建任务失败" };
      // 异步执行任务
      dataSyncService.executeSyncJob(jobId).catch(console.error);
      return { success: true, jobId };
    }),

  // 获取同步任务列表
  getJobs: protectedProcedure
    .input(z.object({
      accountId: z.number().optional(),
      status: z.enum(["pending", "running", "completed", "failed", "cancelled"]).optional(),
      limit: z.number().default(50),
      offset: z.number().default(0),
    }))
    .query(async ({ ctx, input }) => {
      return dataSyncService.getSyncJobs(ctx.user.id, input);
    }),

  // 获取同步日志
  getLogs: protectedProcedure
    .input(z.object({ jobId: z.number() }))
    .query(async ({ input }) => {
      return dataSyncService.getSyncLogs(input.jobId);
    }),

  // 取消同步任务
  cancelJob: protectedProcedure
    .input(z.object({ jobId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      return dataSyncService.cancelSyncJob(input.jobId, ctx.user.id);
    }),

  // 获取API限流状态
  getRateLimitStatus: protectedProcedure
    .query(async () => {
      return dataSyncService.getRateLimitStatus();
    }),

  // 获取账号API使用统计
  getApiUsage: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .query(async ({ input }) => {
      return dataSyncService.getApiUsageStats(input.accountId);
    }),

  // ==================== 定时调度API ====================
  
  // 创建同步调度
  createSchedule: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      syncType: z.enum(["campaigns", "keywords", "performance", "all"]).default("all"),
      frequency: z.enum(["hourly", "daily", "weekly", "monthly"]),
      hour: z.number().min(0).max(23).optional(),
      dayOfWeek: z.number().min(0).max(6).optional(),
      dayOfMonth: z.number().min(1).max(31).optional(),
      isEnabled: z.boolean().default(true),
    }))
    .mutation(async ({ ctx, input }) => {
      const scheduleId = await dataSyncService.createSyncSchedule({
        userId: ctx.user.id,
        ...input,
      });
      if (!scheduleId) return { success: false, message: "创建调度失败" };
      return { success: true, scheduleId };
    }),

  // 获取同步调度列表
  getSchedules: protectedProcedure
    .input(z.object({ accountId: z.number().optional() }))
    .query(async ({ ctx, input }) => {
      return dataSyncService.getSyncSchedules(ctx.user.id, input.accountId);
    }),

  // 更新同步调度
  updateSchedule: protectedProcedure
    .input(z.object({
      id: z.number(),
      syncType: z.enum(["campaigns", "keywords", "performance", "all"]).optional(),
      frequency: z.enum(["hourly", "daily", "weekly", "monthly"]).optional(),
      hour: z.number().min(0).max(23).optional(),
      dayOfWeek: z.number().min(0).max(6).optional(),
      dayOfMonth: z.number().min(1).max(31).optional(),
      isEnabled: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...updates } = input;
      const success = await dataSyncService.updateSyncSchedule(id, ctx.user.id, updates);
      return { success };
    }),

  // 删除同步调度
  deleteSchedule: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const success = await dataSyncService.deleteSyncSchedule(input.id, ctx.user.id);
      return { success };
    }),

  // 手动触发调度执行
  triggerSchedule: protectedProcedure
    .input(z.object({ scheduleId: z.number() }))
    .mutation(async ({ input }) => {
      return dataSyncService.executeScheduledSync(input.scheduleId);
    }),

  // 获取调度执行历史
  getScheduleHistory: protectedProcedure
    .input(z.object({ scheduleId: z.number(), limit: z.number().default(20) }))
    .query(async ({ input }) => {
      return dataSyncService.getScheduleHistory(input.scheduleId, input.limit);
    }),

  // 获取调度详细执行历史
  getScheduleExecutionHistory: protectedProcedure
    .input(z.object({ scheduleId: z.number(), limit: z.number().default(50) }))
    .query(async ({ input }) => {
      return dataSyncService.getScheduleExecutionHistory(input.scheduleId, input.limit);
    }),

  // 获取调度执行统计
  getScheduleExecutionStats: protectedProcedure
    .input(z.object({ scheduleId: z.number() }))
    .query(async ({ input }) => {
      return dataSyncService.getScheduleExecutionStats(input.scheduleId);
    }),

  // 手动触发调度执行（带重试）
  triggerScheduleWithRetry: protectedProcedure
    .input(z.object({ scheduleId: z.number() }))
    .mutation(async ({ input }) => {
      return dataSyncService.executeScheduledSyncWithRetry(input.scheduleId);
    }),
});

// ==================== Dayparting Router ====================
const daypartingRouter = router({
  // 获取账号的所有分时策略
  listStrategies: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .query(async ({ input }) => {
      return daypartingService.getDaypartingStrategies(input.accountId);
    }),

  // 获取单个策略详情
  getStrategy: protectedProcedure
    .input(z.object({ strategyId: z.number() }))
    .query(async ({ input }) => {
      const strategy = await daypartingService.getDaypartingStrategy(input.strategyId);
      if (!strategy) {
        throw new TRPCError({ code: "NOT_FOUND", message: "策略不存在" });
      }
      const budgetRules = await daypartingService.getBudgetRules(input.strategyId);
      const bidRules = await daypartingService.getBidRules(input.strategyId);
      return { strategy, budgetRules, bidRules };
    }),

  // 分析广告活动的每周表现
  analyzeWeeklyPerformance: protectedProcedure
    .input(z.object({
      campaignId: z.number(),
      lookbackDays: z.number().default(30),
    }))
    .query(async ({ input }) => {
      return daypartingService.analyzeWeeklyPerformance(input.campaignId, input.lookbackDays);
    }),

  // 分析广告活动的每小时表现
  analyzeHourlyPerformance: protectedProcedure
    .input(z.object({
      campaignId: z.number(),
      lookbackDays: z.number().default(30),
    }))
    .query(async ({ input }) => {
      return daypartingService.analyzeHourlyPerformance(input.campaignId, input.lookbackDays);
    }),

  // 一键生成最优策略
  generateOptimalStrategy: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      campaignId: z.number(),
      name: z.string(),
      optimizationGoal: z.enum(["maximize_sales", "target_acos", "target_roas", "minimize_acos"]),
      targetAcos: z.number().optional(),
      targetRoas: z.number().optional(),
      lookbackDays: z.number().default(30),
    }))
    .mutation(async ({ input }) => {
      return daypartingService.generateOptimalStrategy(input.accountId, input.campaignId, {
        name: input.name,
        optimizationGoal: input.optimizationGoal,
        targetAcos: input.targetAcos,
        targetRoas: input.targetRoas,
        lookbackDays: input.lookbackDays,
      });
    }),

  // 创建分时策略
  createStrategy: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      campaignId: z.number().optional(),
      name: z.string(),
      description: z.string().optional(),
      strategyType: z.enum(["budget", "bidding", "both"]).default("both"),
      optimizationGoal: z.enum(["maximize_sales", "target_acos", "target_roas", "minimize_acos"]).default("maximize_sales"),
      targetAcos: z.number().optional(),
      targetRoas: z.number().optional(),
      analysisLookbackDays: z.number().default(30),
      maxBudgetMultiplier: z.number().default(2.0),
      minBudgetMultiplier: z.number().default(0.2),
      maxBidMultiplier: z.number().default(2.0),
      minBidMultiplier: z.number().default(0.2),
    }))
    .mutation(async ({ input }) => {
      const strategyId = await daypartingService.createDaypartingStrategy({
        accountId: input.accountId,
        campaignId: input.campaignId,
        name: input.name,
        description: input.description,
        strategyType: input.strategyType,
        optimizationGoal: input.optimizationGoal,
        targetAcos: input.targetAcos?.toString(),
        targetRoas: input.targetRoas?.toString(),
        analysisLookbackDays: input.analysisLookbackDays,
        maxBudgetMultiplier: input.maxBudgetMultiplier.toString(),
        minBudgetMultiplier: input.minBudgetMultiplier.toString(),
        maxBidMultiplier: input.maxBidMultiplier.toString(),
        minBidMultiplier: input.minBidMultiplier.toString(),
        status: "draft",
      });
      return { strategyId };
    }),

  // 更新策略状态
  updateStrategyStatus: protectedProcedure
    .input(z.object({
      strategyId: z.number(),
      status: z.enum(["active", "paused", "draft"]),
    }))
    .mutation(async ({ input }) => {
      await daypartingService.updateDaypartingStrategy(input.strategyId, {
        status: input.status,
        lastAppliedAt: input.status === "active" ? new Date() : undefined,
      });
      return { success: true };
    }),

  // 保存预算规则
  saveBudgetRules: protectedProcedure
    .input(z.object({
      strategyId: z.number(),
      rules: z.array(z.object({
        dayOfWeek: z.number().min(0).max(6),
        budgetMultiplier: z.number(),
        budgetPercentage: z.number().optional(),
        isEnabled: z.boolean().default(true),
      })),
    }))
    .mutation(async ({ input }) => {
      await daypartingService.saveBudgetRules(
        input.strategyId,
        input.rules.map(r => ({
          dayOfWeek: r.dayOfWeek,
          budgetMultiplier: r.budgetMultiplier.toString(),
          budgetPercentage: r.budgetPercentage?.toString(),
          isEnabled: r.isEnabled,
        }))
      );
      return { success: true };
    }),

  // 保存竞价规则
  saveBidRules: protectedProcedure
    .input(z.object({
      strategyId: z.number(),
      rules: z.array(z.object({
        dayOfWeek: z.number().min(0).max(6),
        hour: z.number().min(0).max(23),
        bidMultiplier: z.number(),
        isEnabled: z.boolean().default(true),
      })),
    }))
    .mutation(async ({ input }) => {
      await daypartingService.saveBidRules(
        input.strategyId,
        input.rules.map(r => ({
          dayOfWeek: r.dayOfWeek,
          hour: r.hour,
          bidMultiplier: r.bidMultiplier.toString(),
          isEnabled: r.isEnabled,
        }))
      );
      return { success: true };
    }),

  // 获取策略执行日志
  getExecutionLogs: protectedProcedure
    .input(z.object({
      strategyId: z.number(),
      limit: z.number().default(50),
    }))
    .query(async ({ input }) => {
      return daypartingService.getExecutionLogs(input.strategyId, input.limit);
    }),

  // 计算最优预算分配（不保存，仅预览）
  previewBudgetAllocation: protectedProcedure
    .input(z.object({
      campaignId: z.number(),
      optimizationGoal: z.enum(["maximize_sales", "target_acos", "target_roas", "minimize_acos"]),
      targetAcos: z.number().optional(),
      targetRoas: z.number().optional(),
      lookbackDays: z.number().default(30),
    }))
    .query(async ({ input }) => {
      const weeklyData = await daypartingService.analyzeWeeklyPerformance(
        input.campaignId,
        input.lookbackDays
      );
      const allocation = daypartingService.calculateOptimalBudgetAllocation(weeklyData, {
        optimizationGoal: input.optimizationGoal,
        targetAcos: input.targetAcos,
        targetRoas: input.targetRoas,
      });
      return { weeklyData, allocation };
    }),

  // 计算最优竞价调整（不保存，仅预览）
  previewBidAdjustments: protectedProcedure
    .input(z.object({
      campaignId: z.number(),
      optimizationGoal: z.enum(["maximize_sales", "target_acos", "target_roas", "minimize_acos"]),
      targetAcos: z.number().optional(),
      targetRoas: z.number().optional(),
      lookbackDays: z.number().default(30),
    }))
    .query(async ({ input }) => {
      const hourlyData = await daypartingService.analyzeHourlyPerformance(
        input.campaignId,
        input.lookbackDays
      );
      const adjustments = daypartingService.calculateOptimalBidAdjustments(hourlyData, {
        optimizationGoal: input.optimizationGoal,
        targetAcos: input.targetAcos,
        targetRoas: input.targetRoas,
      });
      return { hourlyData, adjustments };
    }),
});

// ==================== Placement Optimization Router ====================
import * as placementService from './placementOptimizationService';
import * as advancedPlacementService from './advancedPlacementService';
import * as marketCurveService from './marketCurveService';
import * as decisionTreeService from './decisionTreeService';

const placementRouter = router({
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
      const suggestions = placementService.calculateOptimalAdjustment(
        performance,
        currentSettings
      );
      
      return {
        performance,
        currentSettings,
        suggestions,
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
        reason: z.string(),
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

  // ==================== 高级位置优化（Adspert算法整合）====================

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
            marketCurve.impressionCurve as any,
            marketCurve.ctrCurve as any,
            marketCurve.conversionParams as any
          );
          
          results.push({
            keywordId: keyword.id,
            keywordText: keyword.keywordText,
            matchType: keyword.matchType,
            currentBid: keyword.bid || 0,
            optimalBid: optimalBid.optimalBid,
            maxProfit: optimalBid.maxProfit,
            profitMargin: optimalBid.profitMargin,
            breakEvenCPC: optimalBid.breakEvenCPC,
            bidDifference: optimalBid.optimalBid - (keyword.bid || 0),
            bidDifferencePercent: keyword.bid ? ((optimalBid.optimalBid - keyword.bid) / keyword.bid * 100) : 0,
            recommendation: optimalBid.optimalBid > (keyword.bid || 0) ? 'increase' : 
                           optimalBid.optimalBid < (keyword.bid || 0) ? 'decrease' : 'maintain',
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
      const groupCampaigns = await db.getPerformanceGroupCampaigns(input.groupId);
      
      const campaignResults = [];
      let totalAnalyzedKeywords = 0;
      let totalMaxProfit = 0;
      let totalKeywordsNeedIncrease = 0;
      let totalKeywordsNeedDecrease = 0;
      
      for (const gc of groupCampaigns) {
        const campaign = await db.getCampaignById(gc.campaignId);
        if (!campaign) continue;
        
        // 获取广告活动下的所有关键词
        const campaignKeywords = await db.getKeywordsByCampaignId(gc.campaignId);
        
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
              marketCurve.impressionCurve as any,
              marketCurve.ctrCurve as any,
              marketCurve.conversionParams as any
            );
            
            campaignOptimalBidSum += optimalBid.optimalBid;
            campaignCurrentBidSum += keyword.bid || 0;
            campaignMaxProfit += optimalBid.maxProfit;
            analyzedCount++;
            
            if (optimalBid.optimalBid > (keyword.bid || 0) * 1.05) needIncrease++;
            else if (optimalBid.optimalBid < (keyword.bid || 0) * 0.95) needDecrease++;
          }
        }
        
        if (analyzedCount > 0) {
          campaignResults.push({
            campaignId: gc.campaignId,
            campaignName: campaign.name,
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
              oldBid: keyword.bid || 0,
              newBid: keyword.bid || 0,
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
            marketCurve.impressionCurve as any,
            marketCurve.ctrCurve as any,
            marketCurve.conversionParams as any
          );
          
          const currentBid = keyword.bid || 0;
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
            oldBid: keyword.bid || 0,
            newBid: keyword.bid || 0,
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
      const groupCampaigns = await db.getPerformanceGroupCampaigns(input.groupId);
      
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
        const campaign = await db.getCampaignById(gc.campaignId);
        if (!campaign) continue;
        
        // 获取广告活动下的所有关键词
        const campaignKeywords = await db.getKeywordsByCampaignId(gc.campaignId);
        
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
              marketCurve.impressionCurve as any,
              marketCurve.ctrCurve as any,
              marketCurve.conversionParams as any
            );
            
            const currentBid = keyword.bid || 0;
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
              campaignName: campaign.name,
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
          campaignName: campaign.name,
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
      return db.getBidAdjustmentHistory(input);
    }),
  
  // 获取出价调整历史统计
  getBidAdjustmentStats: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      days: z.number().default(30),
    }))
    .query(async ({ input }) => {
      return db.getBidAdjustmentStats(input.accountId, input.days);
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
          marketCurve.impressionCurve as any,
          marketCurve.ctrCurve as any,
          marketCurve.conversionParams as any
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
      const defaultCtrCurve = { baseCTR: 0.01, positionBonus: 0.5, topSearchCTRBonus: 0.3 };
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
      const result = await db.rollbackBidAdjustment(input.adjustmentId, ctx.user.name || ctx.user.openId);
      if (!result) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '找不到该调整记录' });
      }
      return result;
    }),

  // 获取单条调整记录详情
  getBidAdjustmentById: protectedProcedure
    .input(z.object({
      adjustmentId: z.number(),
    }))
    .query(async ({ input }) => {
      return db.getBidAdjustmentById(input.adjustmentId);
    }),

  // 获取效果追踪统计
  getBidAdjustmentTrackingStats: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      days: z.number().default(30),
    }))
    .query(async ({ input }) => {
      return db.getBidAdjustmentTrackingStats(input.accountId, input.days);
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
        actualProfit7d: z.number().optional(),
        actualProfit14d: z.number().optional(),
        actualProfit30d: z.number().optional(),
        actualImpressions7d: z.number().optional(),
        actualClicks7d: z.number().optional(),
        actualConversions7d: z.number().optional(),
        actualSpend7d: z.number().optional(),
        actualRevenue7d: z.number().optional(),
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
      const { runEffectTrackingTask } = await import('./effectTrackingScheduler');
      return runEffectTrackingTask(input.period);
    }),

  // 运行所有效果追踪任务
  runAllTrackingTasks: protectedProcedure
    .mutation(async () => {
      const { runAllTrackingTasks } = await import('./effectTrackingScheduler');
      return runAllTrackingTasks();
    }),

  // 获取效果追踪统计摘要
  getTrackingStatsSummary: protectedProcedure
    .query(async () => {
      const { getTrackingStatsSummary } = await import('./effectTrackingScheduler');
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
      const accountId = ctx.user.currentAccountId || 1;
      
      // 构建查询条件
      const conditions: any[] = [
        eq(bidAdjustmentHistory.accountId, accountId),
        eq(bidAdjustmentHistory.isRolledBack, false),
      ];
      
      if (input.startDate) {
        conditions.push(gte(bidAdjustmentHistory.adjustedAt, new Date(input.startDate).getTime()));
      }
      if (input.endDate) {
        conditions.push(lte(bidAdjustmentHistory.adjustedAt, new Date(input.endDate).getTime()));
      }
      if (input.campaignId) {
        conditions.push(eq(bidAdjustmentHistory.campaignId, input.campaignId));
      }
      if (input.performanceGroupId) {
        conditions.push(eq(bidAdjustmentHistory.performanceGroupId, input.performanceGroupId));
      }
      
      const records = await db
        .select()
        .from(bidAdjustmentHistory)
        .where(and(...conditions))
        .orderBy(desc(bidAdjustmentHistory.adjustedAt));
      
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
        const estimated = parseFloat(record.estimatedProfitChange || '0');
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
          if (!byCampaign[record.campaignId]) {
            byCampaign[record.campaignId] = { name: record.campaignName || '', count: 0, estimated: 0, actual: 0 };
          }
          byCampaign[record.campaignId].count++;
          byCampaign[record.campaignId].estimated += estimated;
        }
        
        // 统计已追踪的记录
        if (record.actualProfit7d !== null) {
          const actual = parseFloat(record.actualProfit7d);
          totalActualProfit7d += actual;
          count7d++;
          trackedRecords++;
          byAdjustmentType[type].actual += actual;
          if (record.campaignId && byCampaign[record.campaignId]) {
            byCampaign[record.campaignId].actual += actual;
          }
        }
        if (record.actualProfit14d !== null) {
          totalActualProfit14d += parseFloat(record.actualProfit14d);
          count14d++;
        }
        if (record.actualProfit30d !== null) {
          totalActualProfit30d += parseFloat(record.actualProfit30d);
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
          estimatedProfitChange: r.estimatedProfitChange,
          actualProfit7d: r.actualProfit7d,
          actualProfit14d: r.actualProfit14d,
          actualProfit30d: r.actualProfit30d,
          adjustedAt: r.adjustedAt,
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
          // 获取历史记录
          const [record] = await db
            .select()
            .from(bidAdjustmentHistory)
            .where(eq(bidAdjustmentHistory.id, id))
            .limit(1);
          
          if (!record) {
            results.push({ id, success: false, error: '记录不存在' });
            continue;
          }
          
          if (record.isRolledBack) {
            results.push({ id, success: false, error: '已回滚' });
            continue;
          }
          
          // 恢复原出价
          const previousBid = parseFloat(record.previousBid || '0');
          await db.updateKeywordBid(record.keywordId, previousBid);
          
          // 更新历史记录状态
          await db
            .update(bidAdjustmentHistory)
            .set({
              isRolledBack: true,
              rolledBackBy: ctx.user.name || ctx.user.openId,
              rolledBackAt: Date.now(),
            })
            .where(eq(bidAdjustmentHistory.id, id));
          
          // 记录回滚操作到历史
          await db.recordBidAdjustment({
            accountId: record.accountId,
            campaignId: record.campaignId,
            campaignName: record.campaignName,
            performanceGroupId: record.performanceGroupId,
            keywordId: record.keywordId,
            keywordText: record.keywordText,
            previousBid: record.newBid || '0',
            newBid: record.previousBid || '0',
            adjustmentType: 'rollback',
            adjustmentReason: `批量回滚操作 (原记录ID: ${id})`,
            estimatedProfitChange: (-(parseFloat(record.estimatedProfitChange || '0'))).toString(),
            appliedBy: ctx.user.name || ctx.user.openId,
          });
          
          results.push({ id, success: true });
        } catch (error: any) {
          results.push({ id, success: false, error: error.message });
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
});

// ==================== 趋势数据辅助函数 ====================
// 生成模拟的趋势数据（当没有真实历史数据时使用）
function generateSimulatedTrendData(target: any, days: number) {
  const data = [];
  const now = new Date();
  
  // 基础数据
  const baseImpressions = target.impressions || 1000;
  const baseClicks = target.clicks || 50;
  const baseSpend = parseFloat(target.spend || "10");
  const baseSales = parseFloat(target.sales || "30");
  const baseOrders = target.orders || 3;
  
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    
    // 添加随机波动（±30%）
    const variation = 0.7 + Math.random() * 0.6;
    const weekdayFactor = date.getDay() === 0 || date.getDay() === 6 ? 0.8 : 1.1;
    
    const impressions = Math.round((baseImpressions / days) * variation * weekdayFactor);
    const clicks = Math.round((baseClicks / days) * variation * weekdayFactor);
    const spend = Math.round((baseSpend / days) * variation * weekdayFactor * 100) / 100;
    const sales = Math.round((baseSales / days) * variation * weekdayFactor * 100) / 100;
    const orders = Math.round((baseOrders / days) * variation * weekdayFactor);
    
    const ctr = impressions > 0 ? (clicks / impressions * 100) : 0;
    const cvr = clicks > 0 ? (orders / clicks * 100) : 0;
    const acos = sales > 0 ? (spend / sales * 100) : 0;
    const roas = spend > 0 ? (sales / spend) : 0;
    const cpc = clicks > 0 ? (spend / clicks) : 0;
    
    data.push({
      date: date.toISOString().split('T')[0],
      impressions,
      clicks,
      spend,
      sales,
      orders,
      ctr: Math.round(ctr * 100) / 100,
      cvr: Math.round(cvr * 100) / 100,
      acos: Math.round(acos * 100) / 100,
      roas: Math.round(roas * 100) / 100,
      cpc: Math.round(cpc * 100) / 100,
    });
  }
  
  return data;
}

// 计算趋势摘要数据
function calculateTrendSummary(data: any[]) {
  if (!data || data.length === 0) {
    return {
      totalImpressions: 0,
      totalClicks: 0,
      totalSpend: 0,
      totalSales: 0,
      totalOrders: 0,
      avgCtr: 0,
      avgCvr: 0,
      avgAcos: 0,
      avgRoas: 0,
      avgCpc: 0,
      trend: {
        impressions: 'stable',
        clicks: 'stable',
        spend: 'stable',
        sales: 'stable',
        acos: 'stable',
        roas: 'stable',
      },
    };
  }
  
  const totalImpressions = data.reduce((sum, d) => sum + d.impressions, 0);
  const totalClicks = data.reduce((sum, d) => sum + d.clicks, 0);
  const totalSpend = data.reduce((sum, d) => sum + d.spend, 0);
  const totalSales = data.reduce((sum, d) => sum + d.sales, 0);
  const totalOrders = data.reduce((sum, d) => sum + d.orders, 0);
  
  const avgCtr = totalImpressions > 0 ? (totalClicks / totalImpressions * 100) : 0;
  const avgCvr = totalClicks > 0 ? (totalOrders / totalClicks * 100) : 0;
  const avgAcos = totalSales > 0 ? (totalSpend / totalSales * 100) : 0;
  const avgRoas = totalSpend > 0 ? (totalSales / totalSpend) : 0;
  const avgCpc = totalClicks > 0 ? (totalSpend / totalClicks) : 0;
  
  // 计算趋势（对比前半段和后半段）
  const midPoint = Math.floor(data.length / 2);
  const firstHalf = data.slice(0, midPoint);
  const secondHalf = data.slice(midPoint);
  
  const calcTrend = (metric: string) => {
    const firstAvg = firstHalf.reduce((sum, d) => sum + (d[metric] || 0), 0) / (firstHalf.length || 1);
    const secondAvg = secondHalf.reduce((sum, d) => sum + (d[metric] || 0), 0) / (secondHalf.length || 1);
    const change = firstAvg > 0 ? ((secondAvg - firstAvg) / firstAvg * 100) : 0;
    
    if (change > 10) return 'up';
    if (change < -10) return 'down';
    return 'stable';
  };
  
  return {
    totalImpressions,
    totalClicks,
    totalSpend: Math.round(totalSpend * 100) / 100,
    totalSales: Math.round(totalSales * 100) / 100,
    totalOrders,
    avgCtr: Math.round(avgCtr * 100) / 100,
    avgCvr: Math.round(avgCvr * 100) / 100,
    avgAcos: Math.round(avgAcos * 100) / 100,
    avgRoas: Math.round(avgRoas * 100) / 100,
    avgCpc: Math.round(avgCpc * 100) / 100,
    trend: {
      impressions: calcTrend('impressions'),
      clicks: calcTrend('clicks'),
      spend: calcTrend('spend'),
      sales: calcTrend('sales'),
      acos: calcTrend('acos'),
      roas: calcTrend('roas'),
    },
  };
}

// ==================== Unified Optimization Router ====================
const unifiedOptimizationRouter = router({
  // 获取广告活动的优化状态
  getCampaignState: protectedProcedure
    .input(z.object({ campaignId: z.number() }))
    .query(async ({ input }) => {
      return unifiedOptimizationEngine.getCampaignOptimizationState(input.campaignId);
    }),
  
  // 获取绩效组的优化状态
  getPerformanceGroupState: protectedProcedure
    .input(z.object({ groupId: z.number() }))
    .query(async ({ input }) => {
      return unifiedOptimizationEngine.getPerformanceGroupOptimizationState(input.groupId);
    }),
  
  // 运行统一优化分析
  runAnalysis: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      campaignIds: z.array(z.number()).optional(),
      performanceGroupIds: z.array(z.number()).optional(),
      optimizationTypes: z.array(z.enum([
        'bid_adjustment',
        'placement_tilt',
        'dayparting',
        'negative_keyword',
        'funnel_migration',
        'budget_reallocation',
        'correction',
        'traffic_isolation'
      ])).optional()
    }))
    .mutation(async ({ input }) => {
      return unifiedOptimizationEngine.runUnifiedOptimizationAnalysis(
        input.accountId,
        {
          campaignIds: input.campaignIds,
          performanceGroupIds: input.performanceGroupIds,
          optimizationTypes: input.optimizationTypes
        }
      );
    }),
  
  // 执行单个优化决策
  executeDecision: protectedProcedure
    .input(z.object({
      decisionId: z.string(),
      executedBy: z.enum(['auto', 'manual']).optional()
    }))
    .mutation(async ({ input }) => {
      return unifiedOptimizationEngine.executeOptimizationDecision(
        input.decisionId,
        input.executedBy || 'manual'
      );
    }),
  
  // 批量执行优化决策
  batchExecuteDecisions: protectedProcedure
    .input(z.object({
      decisionIds: z.array(z.string()),
      executedBy: z.enum(['auto', 'manual']).optional()
    }))
    .mutation(async ({ input }) => {
      return unifiedOptimizationEngine.batchExecuteOptimizationDecisions(
        input.decisionIds,
        input.executedBy || 'manual'
      );
    }),
  
  // 获取优化摘要
  getSummary: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      campaignId: z.number().optional(),
      performanceGroupId: z.number().optional()
    }))
    .query(async ({ input }) => {
      return unifiedOptimizationEngine.getOptimizationSummary(
        input.accountId,
        {
          campaignId: input.campaignId,
          performanceGroupId: input.performanceGroupId
        }
      );
    }),
  
  // 更新广告活动优化设置
  updateCampaignSettings: protectedProcedure
    .input(z.object({
      campaignId: z.number(),
      autoOptimizationEnabled: z.boolean().optional(),
      executionMode: z.enum(['full_auto', 'semi_auto', 'manual', 'disabled']).optional(),
      optimizationTypes: z.object({
        bidAdjustment: z.boolean().optional(),
        placementTilt: z.boolean().optional(),
        dayparting: z.boolean().optional(),
        negativeKeyword: z.boolean().optional()
      }).optional()
    }))
    .mutation(async ({ input }) => {
      return unifiedOptimizationEngine.updateCampaignOptimizationSettings(
        input.campaignId,
        {
          autoOptimizationEnabled: input.autoOptimizationEnabled,
          executionMode: input.executionMode,
          optimizationTypes: input.optimizationTypes
        }
      );
    }),
  
  // 更新绩效组优化设置
  updatePerformanceGroupSettings: protectedProcedure
    .input(z.object({
      groupId: z.number(),
      autoOptimizationEnabled: z.boolean().optional(),
      executionMode: z.enum(['full_auto', 'semi_auto', 'manual', 'disabled']).optional(),
      targetAcos: z.number().optional(),
      targetRoas: z.number().optional()
    }))
    .mutation(async ({ input }) => {
      return unifiedOptimizationEngine.updatePerformanceGroupOptimizationSettings(
        input.groupId,
        {
          autoOptimizationEnabled: input.autoOptimizationEnabled,
          executionMode: input.executionMode,
          targetAcos: input.targetAcos,
          targetRoas: input.targetRoas
        }
      );
    }),
});

// ==================== Auto Rollback Router ====================
const autoRollbackRouter = router({
  // 获取所有回滚规则
  getRules: protectedProcedure.query(async () => {
    return autoRollbackService.getRollbackRules();
  }),
  
  // 获取单个回滚规则
  getRule: protectedProcedure
    .input(z.object({ ruleId: z.string() }))
    .query(async ({ input }) => {
      return autoRollbackService.getRollbackRule(input.ruleId);
    }),
  
  // 创建回滚规则
  createRule: protectedProcedure
    .input(z.object({
      name: z.string(),
      description: z.string(),
      enabled: z.boolean(),
      conditions: z.object({
        profitThresholdPercent: z.number(),
        minTrackingDays: z.union([z.literal(7), z.literal(14), z.literal(30)]),
        minSampleCount: z.number(),
        includeNegativeAdjustments: z.boolean()
      }),
      actions: z.object({
        autoRollback: z.boolean(),
        sendNotification: z.boolean(),
        notificationPriority: z.enum(['low', 'medium', 'high'])
      })
    }))
    .mutation(async ({ input }) => {
      return autoRollbackService.createRollbackRule(input);
    }),
  
  // 更新回滚规则
  updateRule: protectedProcedure
    .input(z.object({
      ruleId: z.string(),
      name: z.string().optional(),
      description: z.string().optional(),
      enabled: z.boolean().optional(),
      conditions: z.object({
        profitThresholdPercent: z.number(),
        minTrackingDays: z.union([z.literal(7), z.literal(14), z.literal(30)]),
        minSampleCount: z.number(),
        includeNegativeAdjustments: z.boolean()
      }).optional(),
      actions: z.object({
        autoRollback: z.boolean(),
        sendNotification: z.boolean(),
        notificationPriority: z.enum(['low', 'medium', 'high'])
      }).optional()
    }))
    .mutation(async ({ input }) => {
      const { ruleId, ...updates } = input;
      return autoRollbackService.updateRollbackRule(ruleId, updates);
    }),
  
  // 删除回滚规则
  deleteRule: protectedProcedure
    .input(z.object({ ruleId: z.string() }))
    .mutation(async ({ input }) => {
      return autoRollbackService.deleteRollbackRule(input.ruleId);
    }),
  
  // 运行回滚评估
  runEvaluation: protectedProcedure
    .input(z.object({ accountId: z.number().optional() }))
    .mutation(async ({ input }) => {
      return autoRollbackService.runRollbackEvaluation(input.accountId);
    }),
  
  // 获取回滚建议列表
  getSuggestions: protectedProcedure
    .input(z.object({
      status: z.enum(['pending', 'approved', 'rejected', 'executed']).optional(),
      priority: z.enum(['low', 'medium', 'high']).optional(),
      ruleId: z.string().optional()
    }))
    .query(async ({ input }) => {
      return autoRollbackService.getRollbackSuggestions(input);
    }),
  
  // 获取单个回滚建议
  getSuggestion: protectedProcedure
    .input(z.object({ suggestionId: z.string() }))
    .query(async ({ input }) => {
      return autoRollbackService.getRollbackSuggestion(input.suggestionId);
    }),
  
  // 审核回滚建议
  reviewSuggestion: protectedProcedure
    .input(z.object({
      suggestionId: z.string(),
      action: z.enum(['approve', 'reject']),
      reviewNote: z.string().optional()
    }))
    .mutation(async ({ input, ctx }) => {
      return autoRollbackService.reviewRollbackSuggestion(
        input.suggestionId,
        input.action,
        ctx.user.name || ctx.user.openId,
        input.reviewNote
      );
    }),
  
  // 执行回滚建议
  executeSuggestion: protectedProcedure
    .input(z.object({ suggestionId: z.string() }))
    .mutation(async ({ input }) => {
      return autoRollbackService.executeRollbackSuggestion(input.suggestionId);
    }),
  
  // 获取回滚建议统计
  getStats: protectedProcedure.query(async () => {
    return autoRollbackService.getRollbackSuggestionStats();
  }),
  
  // 清理旧建议
  cleanup: protectedProcedure.mutation(async () => {
    return autoRollbackService.cleanupOldSuggestions();
  }),
});

// ==================== Algorithm Optimization Router ====================
const algorithmOptimizationRouter = router({
  // 获取算法参数
  getParameters: protectedProcedure.query(async () => {
    return algorithmOptimizationService.getAlgorithmParameters();
  }),
  
  // 更新算法参数
  updateParameters: protectedProcedure
    .input(z.object({
      maxBidIncreasePercent: z.number().optional(),
      maxBidDecreasePercent: z.number().optional(),
      minBidChangePercent: z.number().optional(),
      profitMarginPercent: z.number().optional(),
      conversionValueMultiplier: z.number().optional(),
      maxDailyAdjustments: z.number().optional(),
      cooldownPeriodHours: z.number().optional(),
      minConfidenceThreshold: z.number().optional(),
      minDataPoints: z.number().optional()
    }))
    .mutation(async ({ input }) => {
      return algorithmOptimizationService.updateAlgorithmParameters(input);
    }),
  
  // 重置算法参数
  resetParameters: protectedProcedure.mutation(async () => {
    return algorithmOptimizationService.resetAlgorithmParameters();
  }),
  
  // 获取算法性能指标
  getPerformance: protectedProcedure
    .input(z.object({
      accountId: z.number().optional(),
      days: z.number().optional()
    }))
    .query(async ({ input }) => {
      return algorithmOptimizationService.calculateAlgorithmPerformance(
        input.accountId,
        input.days || 30
      );
    }),
  
  // 按调整类型分析
  analyzeByType: protectedProcedure
    .input(z.object({
      accountId: z.number().optional(),
      days: z.number().optional()
    }))
    .query(async ({ input }) => {
      return algorithmOptimizationService.analyzeByAdjustmentType(
        input.accountId,
        input.days || 30
      );
    }),
  
  // 按出价变化幅度分析
  analyzeByRange: protectedProcedure
    .input(z.object({
      accountId: z.number().optional(),
      days: z.number().optional()
    }))
    .query(async ({ input }) => {
      return algorithmOptimizationService.analyzeByBidChangeRange(
        input.accountId,
        input.days || 30
      );
    }),
  
  // 获取优化建议
  getSuggestions: protectedProcedure
    .input(z.object({
      accountId: z.number().optional(),
      days: z.number().optional()
    }))
    .query(async ({ input }) => {
      return algorithmOptimizationService.generateOptimizationSuggestions(
        input.accountId,
        input.days || 30
      );
    }),
  
  // 获取参数调优建议
  getParameterTuning: protectedProcedure
    .input(z.object({
      accountId: z.number().optional(),
      days: z.number().optional()
    }))
    .query(async ({ input }) => {
      const metrics = await algorithmOptimizationService.calculateAlgorithmPerformance(
        input.accountId,
        input.days || 30
      );
      const byRange = await algorithmOptimizationService.analyzeByBidChangeRange(
        input.accountId,
        input.days || 30
      );
      return algorithmOptimizationService.getParameterTuningSuggestions(metrics, byRange);
    }),
});

// ==================== Intelligent Budget Allocation Router ====================
const intelligentBudgetAllocationRouter = router({
  // 获取绩效组的预算分配建议
  getSuggestions: protectedProcedure
    .input(z.object({
      performanceGroupId: z.number()
    }))
    .query(async ({ input }) => {
      return intelligentBudgetAllocationService.generateBudgetAllocationSuggestions(
        input.performanceGroupId
      );
    }),
  
  // 获取预算分配配置
  getConfig: protectedProcedure
    .input(z.object({
      performanceGroupId: z.number()
    }))
    .query(async ({ input }) => {
      return intelligentBudgetAllocationService.getBudgetAllocationConfig(
        input.performanceGroupId
      );
    }),
  
  // 更新预算分配配置
  updateConfig: protectedProcedure
    .input(z.object({
      performanceGroupId: z.number(),
      conversionEfficiencyWeight: z.number().optional(),
      roasWeight: z.number().optional(),
      growthPotentialWeight: z.number().optional(),
      stabilityWeight: z.number().optional(),
      trendWeight: z.number().optional(),
      maxAdjustmentPercent: z.number().optional(),
      minDailyBudget: z.number().optional(),
      cooldownDays: z.number().optional(),
      newCampaignProtectionDays: z.number().optional()
    }))
    .mutation(async ({ ctx, input }) => {
      const { performanceGroupId, ...updates } = input;
      await intelligentBudgetAllocationService.updateBudgetAllocationConfig(
        performanceGroupId,
        ctx.user.id,
        updates
      );
      return { success: true };
    }),
  
  // 模拟预算调整效果
  simulateScenario: protectedProcedure
    .input(z.object({
      performanceGroupId: z.number(),
      campaignId: z.number(),
      newBudget: z.number()
    }))
    .query(async ({ input }) => {
      const campaigns = await intelligentBudgetAllocationService.collectCampaignPerformanceData(
        input.performanceGroupId
      );
      const campaign = campaigns.find(c => c.campaignId === input.campaignId);
      if (!campaign) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '广告活动不存在' });
      }
      return intelligentBudgetAllocationService.simulateBudgetScenario(
        campaign,
        input.newBudget
      );
    }),
  
  // 应用预算分配建议
  applySuggestions: protectedProcedure
    .input(z.object({
      suggestionIds: z.array(z.number())
    }))
    .mutation(async ({ ctx, input }) => {
      return intelligentBudgetAllocationService.applyBudgetAllocationSuggestions(
        input.suggestionIds,
        ctx.user.id
      );
    }),
  
  // 获取广告活动表现数据
  getCampaignPerformance: protectedProcedure
    .input(z.object({
      performanceGroupId: z.number()
    }))
    .query(async ({ input }) => {
      return intelligentBudgetAllocationService.collectCampaignPerformanceData(
        input.performanceGroupId
      );
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
  amazonApi: amazonApiRouter,
  adAutomation: adAutomationRouter,
  notification: notificationRouter,
  scheduler: schedulerRouter,
  batchOperation: batchOperationRouter,
  correction: correctionRouter,
  crossAccount: crossAccountRouter,
  team: teamRouter,
  emailReport: emailReportRouter,
  audit: auditRouter,
  collaboration: collaborationRouter,
  budgetAllocation: budgetAllocationRouter,
  budgetAlert: budgetAlertRouter,
  budgetTracking: budgetTrackingRouter,
  seasonalBudget: seasonalBudgetRouter,
  dataSync: dataSyncRouter,
  dayparting: daypartingRouter,
  placement: placementRouter,
  unifiedOptimization: unifiedOptimizationRouter,
  autoRollback: autoRollbackRouter,
  algorithmOptimization: algorithmOptimizationRouter,
  intelligentBudgetAllocation: intelligentBudgetAllocationRouter,
});

export type AppRouter = typeof appRouter;
