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
import { createModuleLogger } from '../utils/logger';

const log = createModuleLogger('Route_campaign');

// ==================== Campaign Router ====================
export const campaignRouter = router({
  list: protectedProcedure
    .input(z.object({ 
      accountId: z.number().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      marketplace: z.string().optional(),
      timeRange: z.enum(['today', 'yesterday', '7days', '14days', '30days', '60days', '90days', 'custom']).optional(),
    }))
    .query(async ({ ctx, input }: any) => {
      // v361: 数据隔离修复 - 必须提供accountId，不允许查询全部广告活动
      if (!input.accountId) {
        return [];
      }
      
      // v376: P1数据隔离修复 - 验证当前用户有权访问该accountId
      const { verifyAccountAccess } = await import('../utils/accessControl');
      await verifyAccountAccess(ctx.user.id, input.accountId);
      
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
        log.info(`[campaign.list] 站点时区日期计算: marketplace=${input.marketplace}, timeRange=${input.timeRange}, startDate=${startDate}, endDate=${endDate}, todayDate=${todayDate}`);
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
  // v361: 数据隔离修复 - accountId改为必填
  listUnassigned: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .query(async ({ ctx, input }: any) => {
      // v376: P1数据隔离修复 - 验证当前用户有权访问该accountId
      const { verifyAccountAccess } = await import('../utils/accessControl');
      await verifyAccountAccess(ctx.user.id, input.accountId);
      return db.getUnassignedCampaigns(input.accountId);
    }),
  
  // v370.4: 数据隔离 - 验证campaign归属
  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }: any) => {
      const { verifyCampaignAccess } = await import('../utils/accessControl');
      await verifyCampaignAccess(ctx.user.id, input.id);
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
    .mutation(async ({ ctx, input }: any) => {
      const id = await db.createCampaign(input);
      return { id };
    }),
  
  // v370.4: 数据隔离 - update方法验证campaign归属（通过input.id）
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
      // v370.4: 数据隔离 - 验证campaign归属
      const { verifyCampaignAccess } = await import('../utils/accessControl');
      await verifyCampaignAccess(ctx.user.id, input.id);
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
        // @ts-ignore
        const campaignType = ((previousCampaign as unknown).campaignType || 'sp_manual').toLowerCase();
        
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
          } catch (e: unknown) {
            apiSyncResults.push({ field: 'campaignStatus', success: false, error: (e as Error).message });
            log.error(`[campaign.update] 状态同步失败:`, (e as Error).message);
          }
        }
        
        // 同步日预算变更到Amazon (SP类型)
        // @ts-ignore
        if (input.dailyBudget && input.dailyBudget !== (previousCampaign as unknown).dailyBudget) {
          try {
            const { syncBudgetAdjustmentToAmazon } = await import('../services/amazonApiHelper');
            const success = await syncBudgetAdjustmentToAmazon(
              previousCampaign.accountId,
              amazonCampaignId,
              parseFloat(input.dailyBudget),
              '用户手动更新日预算'
            );
            apiSyncResults.push({ field: 'dailyBudget', success });
          } catch (e: unknown) {
            apiSyncResults.push({ field: 'dailyBudget', success: false, error: (e as Error).message });
            log.error(`[campaign.update] 预算同步失败:`, (e as Error).message);
          }
        }
        
        // 同步位置出价调整到Amazon (SP类型)
        if ((input.placementTopSearchBidAdjustment !== undefined || input.placementProductPageBidAdjustment !== undefined) 
            && (campaignType === 'sp_manual' || campaignType === 'sp_auto')) {
          try {
            const { syncPlacementAdjustmentToAmazon } = await import('../services/amazonApiHelper');
            // @ts-ignore
            const topPercent = input.placementTopSearchBidAdjustment ?? (previousCampaign as unknown).placementTopSearchBidAdjustment ?? 0;
            // @ts-ignore
            const productPercent = input.placementProductPageBidAdjustment ?? (previousCampaign as unknown).placementProductPageBidAdjustment ?? 0;
            const success = await syncPlacementAdjustmentToAmazon(
              previousCampaign.accountId,
              amazonCampaignId,
              topPercent,
              productPercent,
              '用户手动更新位置出价调整'
            );
            apiSyncResults.push({ field: 'placementAdjustment', success });
          } catch (e: unknown) {
            apiSyncResults.push({ field: 'placementAdjustment', success: false, error: (e as Error).message });
            log.error(`[campaign.update] 位置调整同步失败:`, (e as Error).message);
          }
        }
        
        log.info(`[campaign.update] Amazon API同步结果:`, JSON.stringify(apiSyncResults));
        
        // v219: 单个广告活动更新后触发确认同步
        const successfulSyncs = apiSyncResults.filter(r => r.success);
        if (successfulSyncs.length > 0) {
          try {
            // v359: 使用可靠确认服务
            const { submitReliableConfirmation } = await import('../services/commandConfirmationService');
            const entities: ('campaigns' | 'keywords' | 'targets' | 'budgets')[] = ['campaigns'];
            if (successfulSyncs.some(r => r.field === 'dailyBudget')) entities.push('budgets');
            const hasBudget = entities.includes('budgets');
            submitReliableConfirmation(previousCampaign.accountId, entities, 'campaignUpdate', hasBudget ? 'budget_change' : 'status_change');
          } catch (e: unknown) { log.debug(`确认同步触发忽略: ${e instanceof Error ? (e as Error).message : e}`); }
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
    .query(async ({ ctx, input }: any) => {
      // v381: 修复致命ID混淆bug — 前端传入本地自增ID，需要先查campaign获取Amazon campaignId
      const campaign = await db.getCampaignById(input.campaignId);
      if (!campaign) return [];
      return db.getAdGroupsByCampaignId(campaign.campaignId);
    }),
  
  // 获取广告活动详情（包含广告组、关键词、搜索词等）
  getDetail: protectedProcedure
    .input(z.object({ campaignId: z.number() }))
    .query(async ({ ctx, input }: any) => {
      // v381: 修复ID混淆 — getCampaignDetailWithStats内部需要Amazon campaignId
      const campaign = await db.getCampaignById(input.campaignId);
      if (!campaign) return null;
      return db.getCampaignDetailWithStats(campaign.campaignId);
    }),
  
  // 获取广告位置表现数据
  getPlacementStats: protectedProcedure
    .input(z.object({ campaignId: z.number() }))
    .query(async ({ ctx, input }: any) => {
      // v381: 修复ID混淆
      const campaign = await db.getCampaignById(input.campaignId);
      if (!campaign) return null;
      return db.getCampaignPlacementStats(campaign.campaignId);
    }),
  
  // 获取广告位置绩效数据（用于CampaignDetail页面）
  getPlacementPerformance: protectedProcedure
    .input(z.object({ campaignId: z.number() }))
    .query(async ({ ctx, input }: any) => {
      // v381: 修复致命ID混淆bug — placement_performance.campaignId是Amazon ID
      const campaign = await db.getCampaignById(input.campaignId);
      if (!campaign) return [];
      return db.getPlacementPerformanceByCampaignId(campaign.campaignId);
    }),
  
  // 获取广告活动所有投放词（关键词+商品定向）
  getTargets: protectedProcedure
    .input(z.object({ campaignId: z.number() }))
    .query(async ({ ctx, input }: any) => {
      // v381: 修复致命ID混淆bug — getCampaignTargets内部通过adGroups.campaignId查询
      const campaign = await db.getCampaignById(input.campaignId);
      if (!campaign) return { keywords: [], productTargets: [] };
      return db.getCampaignTargets(campaign.campaignId);
    }),
  
  // 获取搜索词报告
  getSearchTerms: protectedProcedure
    .input(z.object({ campaignId: z.number() }))
    .query(async ({ ctx, input }: any) => {
      // v381: 修复致命ID混淆bug — search_terms.campaignId是Amazon ID
      const campaign = await db.getCampaignById(input.campaignId);
      if (!campaign) return [];
      const rawTerms = await db.getSearchTermsByCampaignId(campaign.campaignId);
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
    .query(async ({ ctx, input }: any) => {
      // v381: 修复致命ID混淆bug — negative_keywords.campaignId是Amazon ID
      const campaign = await db.getCampaignById(input.campaignId);
      if (!campaign) return [];
      return db.getNegativeKeywordsByCampaignId(campaign.campaignId);
    }),
  
  // AI摘要功能 - 生成广告活动表现摘要
  generateAISummary: protectedProcedure
    .input(z.object({ campaignId: z.number() }))
    .mutation(async ({ ctx, input }: any) => {
      const { invokeLLM } = await import("../_core/llm");
      
      // 获取广告活动详情
      const campaign = await db.getCampaignById(input.campaignId);
      if (!campaign) {
        throw new TRPCError({ code: "NOT_FOUND", message: "广告活动不存在" });
      }
      
      // v381: 修复ID混淆 — 使用Amazon campaignId
      const adGroups = await db.getAdGroupsByCampaignId(campaign.campaignId);
      let totalKeywords = 0;
      let topKeywords: any[] = [];
      
      for (const adGroup of adGroups) {
        const keywords = await db.getKeywordsByAdGroupId(adGroup.id);
        totalKeywords += keywords.length;
        // 收集表现最好的关键词
        topKeywords.push(...keywords.filter(k => parseFloat(k.sales || "0") > 0));
      }
      
      // 按销售额排序取前5个
      topKeywords.sort((a: any, b: any) => parseFloat(b.sales || "0") - parseFloat(a.sales || "0"));
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
${topKeywords.map((k: any, i: any) => `${i + 1}. "${k.keywordText}" - 销售额: $${parseFloat(k.sales || "0").toFixed(2)}, ACoS: ${parseFloat(k.sales || "0") > 0 ? (parseFloat(k.spend || "0") / parseFloat(k.sales || "0") * 100).toFixed(2) : "N/A"}%`).join("\n")}

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
        log.error("AI摘要生成失败:", error);
        throw new TRPCError({ 
          code: "INTERNAL_SERVER_ERROR", 
          message: "AI摘要生成失败，请稍后重试" 
        });
      }
    }),
  
  // AI智能分析（包含可执行建议和效果预估）
  generateAIAnalysis: protectedProcedure
    .input(z.object({ campaignId: z.number() }))
    .mutation(async ({ ctx, input }: any) => {
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
    .query(async ({ ctx, input }: any) => {
      return db.getAiOptimizationExecutionsByCampaign(input.campaignId);
    }),
  
  // v370.4: 获取AI优化执行详情（executionId关联到campaign，需要验证）
  getAIOptimizationDetail: protectedProcedure
    .input(z.object({ executionId: z.number() }))
    .query(async ({ ctx, input }: any) => {
      const detail = await db.getAiOptimizationExecutionDetail(input.executionId);
      // v370.4: 验证执行记录关联的campaign归属
      if (detail && (detail as any).campaignId) {
        const { verifyCampaignAccess } = await import('../utils/accessControl');
        await verifyCampaignAccess(ctx.user.id, (detail as any).campaignId);
      }
      return detail;
    }),

  // 更新广告活动的策略模板推荐
  updateStrategyRecommendations: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .mutation(async ({ ctx, input }: any) => {
      const { updateAllCampaignRecommendations } = await import('../strategyRecommendationService');
      const updated = await updateAllCampaignRecommendations(input.accountId);
      return { updated };
    }),

  // v381: 获取广告活动变更历史（对应Amazon后台的History tab）
  getChangeHistory: protectedProcedure
    .input(z.object({
      campaignId: z.number(),
      page: z.number().optional().default(1),
      pageSize: z.number().optional().default(50),
    }))
    .query(async ({ ctx, input }: any) => {
      try {
        // 获取campaign信息以确定 Amazon campaignId
        const campaign = await db.getCampaignById(input.campaignId);
        if (!campaign) {
          return { records: [], total: 0, page: input.page, pageSize: input.pageSize };
        }
        const amazonCampaignId = campaign.campaignId;
        const accountId = campaign.accountId;
        
        if (!accountId) {
          return { records: [], total: 0, page: input.page, pageSize: input.pageSize };
        }

        // 并行获取出价调整历史和预算调整历史
        const { getBidAdjustmentHistory } = await import('../db/bidAdjustment');
        const { getDb } = await import('../db/connection');
        const dbConn = await getDb();
        
        const [bidHistory, budgetRecords] = await Promise.all([
          getBidAdjustmentHistory({
            accountId,
            campaignId: Number(amazonCampaignId) || undefined,
            page: input.page,
            pageSize: input.pageSize,
          }),
          dbConn ? dbConn.select().from(
            (await import('../../drizzle/schema')).budgetHistory
          ).where(
            and(
              eq((await import('../../drizzle/schema')).budgetHistory.campaignId, amazonCampaignId),
            )
          ).orderBy(desc((await import('../../drizzle/schema')).budgetHistory.createdAt))
          .limit(input.pageSize) : [],
        ]);

        // 合并并按时间排序
        const allRecords: any[] = [];
        
        // 出价调整记录
        for (const record of (bidHistory.records || [])) {
          allRecords.push({
            id: `bid_${record.id}`,
            type: 'bid_adjustment',
            typeLabel: '出价调整',
            target: record.keywordText || `Keyword #${record.keywordId}`,
            matchType: record.matchType,
            previousValue: `$${record.previousBid}`,
            newValue: `$${record.newBid}`,
            changePercent: record.bidChangePercent ? `${record.bidChangePercent}%` : null,
            reason: record.adjustmentReason,
            source: record.adjustmentType,
            status: record.status,
            appliedBy: record.appliedBy,
            timestamp: record.appliedAt,
          });
        }
        
        // 预算调整记录
        for (const record of (budgetRecords || [])) {
          allRecords.push({
            id: `budget_${record.id}`,
            type: 'budget_adjustment',
            typeLabel: '预算调整',
            target: '日预算',
            matchType: null,
            previousValue: `$${record.previousBudget}`,
            newValue: `$${record.newBudget}`,
            changePercent: record.changePercent ? `${record.changePercent}%` : null,
            reason: record.reason,
            source: record.source,
            status: 'applied',
            appliedBy: null,
            timestamp: record.createdAt,
          });
        }
        
        // 按时间降序排列
        allRecords.sort((a, b) => {
          const timeA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
          const timeB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
          return timeB - timeA;
        });
        
        return {
          records: allRecords.slice(0, input.pageSize),
          total: allRecords.length,
          page: input.page,
          pageSize: input.pageSize,
        };
      } catch (error: any) {
        log.error('Failed to get campaign change history:', error);
        return { records: [], total: 0, page: input.page, pageSize: input.pageSize };
      }
    }),
});
