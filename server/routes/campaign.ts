/**
 * 广告活动管理路由
 * 从 routers.ts 拆分的独立路由模块
 */
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as db from "../db";
import { calculateDateRangeByMarketplace, getMarketplaceLocalDate, MARKETPLACE_TIMEZONES } from '../../shared/timezone';
import { syncCampaignStatusToAmazon } from '../services/amazonApiHelper';
import { eq, and, gte, lte, desc } from 'drizzle-orm';

// ==================== Campaign Router ====================
export const campaignRouter = router({
  list: publicProcedure
    .input(z.object({ 
      accountId: z.number().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      marketplace: z.string().optional(),
      timeRange: z.enum(['today', 'yesterday', '7days', '14days', '30days', '60days', '90days', 'custom']).optional(),
    }))
    .query(async ({ input }) => {
      if (!input.accountId) {
        return db.getAllCampaigns();
      }
      
      // v122h: 使用站点时区计算正确的日期范围
      let startDate = input.startDate;
      let endDate = input.endDate;
      
      // v122h: 计算站点本地时间的“今天”
      let todayDate: string | undefined;
      
      if (input.marketplace && input.timeRange && input.timeRange !== 'custom') {
        // 根据站点时区计算正确的“今天”/“昨天”等日期
        const { calculateDateRangeByMarketplace, getMarketplaceLocalDate } = await import('../../shared/timezone');
        const dateRange = calculateDateRangeByMarketplace(input.marketplace, input.timeRange);
        startDate = dateRange.startDate;
        endDate = dateRange.endDate;
        todayDate = getMarketplaceLocalDate(input.marketplace);
        console.log(`[campaign.list] 站点时区日期计算: marketplace=${input.marketplace}, timeRange=${input.timeRange}, startDate=${startDate}, endDate=${endDate}, todayDate=${todayDate}`);
      } else if (input.marketplace) {
        // custom时间范围也需要站点本地时间的“今天”
        const { getMarketplaceLocalDate } = await import('../../shared/timezone');
        todayDate = getMarketplaceLocalDate(input.marketplace);
      }
      
      if (startDate && endDate) {
        return db.getCampaignsWithPerformance(input.accountId, startDate, endDate, todayDate);
      }
      
      return db.getCampaignsByAccountId(input.accountId);
    }),

  // 获取未分配到绩效组的广告活动
  listUnassigned: publicProcedure
    .input(z.object({ accountId: z.number().optional() }))
    .query(async ({ input }) => {
      return db.getUnassignedCampaigns(input.accountId);
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
      campaignStatus: z.enum(["enabled", "paused", "archived"]).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // 获取更新前的广告活动信息
      const previousCampaign = await db.getCampaignById(input.id);
      
      const { id, intradayBiddingEnabled, ...rest } = input;
      const data = {
        ...rest,
        ...(intradayBiddingEnabled !== undefined && { intradayBiddingEnabled: intradayBiddingEnabled ? 1 : 0 }),
      };
      await db.updateCampaign(id, data);
      
      // v159: 同步变更到Amazon API
      const apiSyncResults: { field: string; success: boolean; error?: string }[] = [];
      
      if (previousCampaign && previousCampaign.accountId && previousCampaign.campaignId) {
        const amazonCampaignId = String(previousCampaign.campaignId);
        const campaignType = ((previousCampaign as any).campaignType || 'sp_manual').toLowerCase();
        
        // 同步状态变更到Amazon
        if (input.campaignStatus && input.campaignStatus !== previousCampaign.campaignStatus) {
          try {
            const { syncCampaignStatusToAmazon } = await import('../services/amazonApiHelper');
            const result = await syncCampaignStatusToAmazon(previousCampaign.accountId, [{
              campaignId: id,
              amazonCampaignId,
              newStatus: input.campaignStatus as 'enabled' | 'paused' | 'archived',
              campaignName: previousCampaign.campaignName || `Campaign ${id}`,
              campaignType,
              reason: '用户手动更新campaign状态',
            }]);
            apiSyncResults.push({ field: 'campaignStatus', success: result.success > 0, error: result.errors[0] });
          } catch (e: any) {
            apiSyncResults.push({ field: 'campaignStatus', success: false, error: e.message });
            console.error(`[campaign.update] 状态同步失败:`, e.message);
          }
        }
        
        // 同步日预算变更到Amazon (SP类型)
        if (input.dailyBudget && input.dailyBudget !== (previousCampaign as any).dailyBudget) {
          try {
            const { syncBudgetAdjustmentToAmazon } = await import('../services/amazonApiHelper');
            const success = await syncBudgetAdjustmentToAmazon(
              previousCampaign.accountId,
              amazonCampaignId,
              parseFloat(input.dailyBudget),
              '用户手动更新日预算'
            );
            apiSyncResults.push({ field: 'dailyBudget', success });
          } catch (e: any) {
            apiSyncResults.push({ field: 'dailyBudget', success: false, error: e.message });
            console.error(`[campaign.update] 预算同步失败:`, e.message);
          }
        }
        
        // 同步位置出价调整到Amazon (SP类型)
        if ((input.placementTopSearchBidAdjustment !== undefined || input.placementProductPageBidAdjustment !== undefined) 
            && (campaignType === 'sp_manual' || campaignType === 'sp_auto')) {
          try {
            const { syncPlacementAdjustmentToAmazon } = await import('../services/amazonApiHelper');
            const topPercent = input.placementTopSearchBidAdjustment ?? (previousCampaign as any).placementTopSearchBidAdjustment ?? 0;
            const productPercent = input.placementProductPageBidAdjustment ?? (previousCampaign as any).placementProductPageBidAdjustment ?? 0;
            const success = await syncPlacementAdjustmentToAmazon(
              previousCampaign.accountId,
              amazonCampaignId,
              topPercent,
              productPercent,
              '用户手动更新位置出价调整'
            );
            apiSyncResults.push({ field: 'placementAdjustment', success });
          } catch (e: any) {
            apiSyncResults.push({ field: 'placementAdjustment', success: false, error: e.message });
            console.error(`[campaign.update] 位置调整同步失败:`, e.message);
          }
        }
        
        console.log(`[campaign.update] Amazon API同步结果:`, JSON.stringify(apiSyncResults));
        
        // v219: 单个广告活动更新后触发确认同步
        const successfulSyncs = apiSyncResults.filter(r => r.success);
        if (successfulSyncs.length > 0) {
          try {
            const { confirmationSync } = await import('../unifiedSyncEngine');
            const entities: ('campaigns' | 'keywords' | 'targets' | 'budgets')[] = ['campaigns'];
            if (successfulSyncs.some(r => r.field === 'dailyBudget')) entities.push('budgets');
            confirmationSync(previousCampaign.accountId, entities, 'campaignUpdate').catch((err: any) => {
              console.error(`[campaign.update] v219: 确认同步失败:`, err.message);
            });
          } catch (e) { /* ignore */ }
        }
      }
      
      // 记录审计日志
      const { logAudit } = await import("../auditService");
      const changes: string[] = [];
      if (input.campaignName) changes.push(`名称: ${input.campaignName}`);
      if (input.maxBid) changes.push(`最高出价: $${input.maxBid}`);
      if (input.dailyBudget) changes.push(`日预算: $${input.dailyBudget}`);
      if (input.campaignStatus) changes.push(`状态: ${input.campaignStatus}`);
      if (input.intradayBiddingEnabled !== undefined) changes.push(`分时竞价: ${input.intradayBiddingEnabled ? '开启' : '关闭'}`);
      
      const apiFailures = apiSyncResults.filter(r => !r.success);
      await logAudit({
        userId: ctx.user.id,
        userName: ctx.user.name || undefined,
        userEmail: ctx.user.email || undefined,
        actionType: 'campaign_update',
        targetType: 'campaign',
        targetId: String(input.id),
        targetName: previousCampaign?.campaignName || undefined,
        description: `更新广告活动（${changes.join(', ')}）` + (apiFailures.length > 0 ? ` [API同步失败: ${apiFailures.map(f => f.field).join(', ')}]` : ''),
        previousValue: previousCampaign ? { maxBid: previousCampaign.maxBid, dailyBudget: previousCampaign.dailyBudget, status: previousCampaign.campaignStatus } : undefined,
        newValue: { maxBid: input.maxBid, dailyBudget: input.dailyBudget, status: input.campaignStatus },
        accountId: previousCampaign?.accountId,
        status: apiFailures.length > 0 ? 'partial' : 'success',
      });
      
      return { 
        success: true, 
        apiSync: apiSyncResults.length > 0 ? {
          total: apiSyncResults.length,
          success: apiSyncResults.filter(r => r.success).length,
          failed: apiFailures.length,
          errors: apiFailures.map(f => `${f.field}: ${f.error}`).slice(0, 5),
        } : undefined,
      };
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
  
  // 获取广告位置绩效数据（用于CampaignDetail页面）
  getPlacementPerformance: protectedProcedure
    .input(z.object({ campaignId: z.number() }))
    .query(async ({ input }) => {
      return db.getPlacementPerformanceByCampaignId(input.campaignId);
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
      const rawTerms = await db.getSearchTermsByCampaignId(input.campaignId);
      // 数据映射：将数据库字段名转换为前端友好的字段名
      return rawTerms.map(t => ({
        id: t.id,
        accountId: t.accountId,
        campaignId: t.campaignId,
        adGroupId: t.adGroupId,
        searchTerm: t.searchTerm,
        targetType: t.searchTermTargetType,     // keyword | product_target
        targetId: t.searchTermTargetId,
        targetText: t.targetText,                // 来源投放词/ASIN文本
        matchType: t.searchTermMatchType,        // 来源投放词的匹配类型
        impressions: t.searchTermImpressions || 0,
        clicks: t.searchTermClicks || 0,
        spend: t.searchTermSpend || '0',
        sales: t.searchTermSales || '0',
        orders: t.searchTermOrders || 0,
        acos: t.searchTermAcos,
        roas: t.searchTermRoas,
        ctr: t.searchTermCtr,
        cvr: t.searchTermCvr,
        cpc: t.searchTermCpc,
        reportStartDate: t.reportStartDate,
        reportEndDate: t.reportEndDate,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      }));
    }),
  
  // 获取否定关键词列表
  getNegativeKeywords: protectedProcedure
    .input(z.object({ campaignId: z.number() }))
    .query(async ({ input }) => {
      return db.getNegativeKeywordsByCampaignId(input.campaignId);
    }),
  
  // AI摘要功能 - 生成广告活动表现摘要
  generateAISummary: protectedProcedure
    .input(z.object({ campaignId: z.number() }))
    .mutation(async ({ input }) => {
      const { invokeLLM } = await import("../_core/llm");
      
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
- 状态：${campaign.campaignStatus}
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
      const { generateAIAnalysisWithSuggestions } = await import("../aiOptimizationService");
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
      const { executeOptimizationSuggestions } = await import("../aiOptimizationService");
      
      // 获取广告活动信息
      const campaign = await db.getCampaignById(input.campaignId);
      if (!campaign) {
        throw new TRPCError({ code: "NOT_FOUND", message: "广告活动不存在" });
      }
      
      const result = await executeOptimizationSuggestions(
        ctx.user.id,
        campaign.accountId,
        input.campaignId,
        input.suggestions,
        input.predictions,
        input.aiSummary
      );
      
      // 记录AI优化执行审计日志
      const { logAudit } = await import("../auditService");
      await logAudit({
        userId: ctx.user.id,
        userName: ctx.user.name || undefined,
        userEmail: ctx.user.email || undefined,
        actionType: 'automation_config_update',
        targetType: 'campaign',
        targetId: String(input.campaignId),
        targetName: campaign.campaignName || undefined,
        description: `执行AI优化建议（${input.suggestions.length}条建议）`,
        metadata: { suggestionsCount: input.suggestions.length, aiSummary: input.aiSummary },
        accountId: campaign.accountId,
        status: 'success',
      });
      
      return result;
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

  // 更新广告活动的策略模板推荐
  updateStrategyRecommendations: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .mutation(async ({ input }) => {
      const { updateAllCampaignRecommendations } = await import('../strategyRecommendationService');
      const updated = await updateAllCampaignRecommendations(input.accountId);
      return { updated };
    }),
});
