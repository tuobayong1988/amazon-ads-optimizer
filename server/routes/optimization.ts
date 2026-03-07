/**
 * 优化管理路由
 * 从 routers.ts 拆分的独立路由模块
 */
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import * as db from "../db";
import * as bidOptimizer from "../bidOptimizer";
import { AmazonSyncService } from '../amazonSyncService';
import { runAutoBidOptimization } from '../services/sync/autoBidOptimization';
import * as unifiedOptimizationEngine from '../unifiedOptimizationEngine';
import * as nextGenOrchestrator from '../nextGenBidOrchestrator';
import { eq, and, gte, lte, desc } from 'drizzle-orm';
import { createModuleLogger } from '../utils/logger';

const log = createModuleLogger('Route_optimization');


// ==================== Optimization Router ====================
export const optimizationRouter = router({
  // v230: 新增getMetrics、getRecentActions、getTrends方法，修复前端AutoOptimizationDashboard页面失效问题
  getMetrics: protectedProcedure.query(async () => {
    const dbInstance = await db.getDb();
    if (!dbInstance) {
      return { totalActionsToday: 0, completedActions: 0, failedActions: 0, pendingActions: 0, totalROIImprovement: 0, totalCostSavings: 0, averageActionDuration: 0, successRate: 0 };
    }
    try {
      const { optimizationLogs } = await import('../../drizzle/schema');
      const { sql: sqlTag } = await import('drizzle-orm');
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayStr = todayStart.toISOString();
      
      // 查询今日的优化操作统计
      const [stats] = await dbInstance.select({
        total: sqlTag<number>`COUNT(*)`,
        completed: sqlTag<number>`SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END)`,
        failed: sqlTag<number>`SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END)`,
      }).from(optimizationLogs).where(sqlTag`created_at >= ${todayStr}`);
      
      const total = Number(stats?.total || 0);
      const completed = Number(stats?.completed || 0);
      const failed = Number(stats?.failed || 0);
      
      return {
        totalActionsToday: total,
        completedActions: completed,
        failedActions: failed,
        pendingActions: Math.max(0, total - completed - failed),
        totalROIImprovement: 0,
        totalCostSavings: 0,
        averageActionDuration: 0,
        successRate: total > 0 ? Math.round((completed / total) * 100) : 0,
      };
    } catch (error: any) {
      log.error('[optimization.getMetrics] 查询失败:', error.message);
      return { totalActionsToday: 0, completedActions: 0, failedActions: 0, pendingActions: 0, totalROIImprovement: 0, totalCostSavings: 0, averageActionDuration: 0, successRate: 0 };
    }
  }),

  getRecentActions: protectedProcedure
    .input(z.object({ limit: z.number().optional().default(10) }))
    .query(async ({ input }) => {
      const dbInstance = await db.getDb();
      if (!dbInstance) return [];
      try {
        const { optimizationLogs } = await import('../../drizzle/schema');
        const { desc } = await import('drizzle-orm');
        const logs = await dbInstance.select()
          .from(optimizationLogs)
          .orderBy(desc(optimizationLogs.id))
          .limit(input.limit);
        return logs.map(log => ({
          id: log.id,
          campaignId: log.campaignId,
          campaignName: log.campaignName || '',
          actionType: log.actionType,
          actionDescription: log.changeReason || '',
          previousValue: log.previousValue || '',
          newValue: log.newValue || '',
          expectedImpact: 'neutral' as const,
          expectedImpactPercent: 0,
          status: log.status === 'success' ? 'completed' : log.status === 'failed' ? 'failed' : 'pending',
          createdAt: log.createdAt ? String(log.createdAt) : new Date().toISOString(),
          completedAt: log.executedAt ? String(log.executedAt) : undefined,
        }));
      } catch (error: any) {
        log.error('[optimization.getRecentActions] 查询失败:', error.message);
        return [];
      }
    }),

  getTrends: protectedProcedure
    .input(z.object({ days: z.number().optional().default(7) }))
    .query(async ({ input }) => {
      const dbInstance = await db.getDb();
      if (!dbInstance) return [];
      try {
        const { sql: sqlTag } = await import('drizzle-orm');
        const { optimizationLogs } = await import('../../drizzle/schema');
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - input.days);
        const startStr = startDate.toISOString().slice(0, 10);
        
        const rows = await dbInstance.select({
          date: sqlTag<string>`DATE(created_at)`,
          actions: sqlTag<number>`COUNT(*)`,
        }).from(optimizationLogs)
          .where(sqlTag`DATE(created_at) >= ${startStr}`)
          .groupBy(sqlTag`DATE(created_at)`)
          .orderBy(sqlTag`DATE(created_at)`);
        
        return rows.map(r => ({
          date: String(r.date),
          actions: Number(r.actions || 0),
          roiImprovement: 0,
          costSavings: 0,
        }));
      } catch (error: any) {
        log.error('[optimization.getTrends] 查询失败:', error.message);
        return [];
      }
    }),

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
      
      // v198: 使用NextGen统一出价引擎，替代旧的bidOptimizer.optimizePerformanceGroup
      const groupConfig: bidOptimizer.PerformanceGroupConfig = {
        optimizationGoal: group.optimizationGoal || "maximize_sales",
        targetAcos: group.targetAcos ? parseFloat(group.targetAcos) : undefined,
        targetRoas: group.targetRoas ? parseFloat(group.targetRoas) : undefined,
        dailySpendLimit: group.dailySpendLimit ? parseFloat(group.dailySpendLimit) : undefined,
        dailyCostTarget: group.dailyCostTarget ? parseFloat(group.dailyCostTarget) : undefined,
        maxBid: group.maxBid ? parseFloat(group.maxBid) : 10.00,
      };
      
      for (const campaign of campaigns) {
        // v206: getAdGroupsByCampaignId需要Amazon campaignId（varchar）
        const adGroups = await db.getAdGroupsByCampaignId(campaign.campaignId);
        const maxBidLimit = campaign.maxBid ? parseFloat(campaign.maxBid) : (groupConfig.maxBid || 10.00);
        
        for (const adGroup of adGroups) {
          // v198: 收集关键词并使用NextGen编排器
          const keywords = await db.getKeywordsByAdGroupId(adGroup.id);
          const keywordTargets: bidOptimizer.OptimizationTarget[] = keywords
            .filter(k => k.keywordStatus === 'enabled' && parseFloat(k.bid) > 0)
            .map(k => ({
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
          
          if (keywordTargets.length > 0) {
            const nextGenKeywordResults = await nextGenOrchestrator.batchCalculateNextGenBids(
              group.accountId, keywordTargets, groupConfig, maxBidLimit
            );
            for (const ngr of nextGenKeywordResults) {
              if (ngr.actionType !== 'hold') {
                results.push({
                  targetId: ngr.targetId,
                  targetType: ngr.targetType === 'keyword' ? 'keyword' : 'product_target',
                  previousBid: ngr.previousBid,
                  newBid: ngr.newBid,
                  actionType: ngr.actionType,
                  bidChangePercent: ngr.bidChangePercent,
                  reason: ngr.reason,
                });
              }
            }
          }
          
          // v198: 收集商品定向并使用NextGen编排器
          const targets = await db.getProductTargetsByAdGroupId(adGroup.id);
          const productTargets: bidOptimizer.OptimizationTarget[] = targets
            .filter(t => t.targetStatus === 'enabled' && parseFloat(t.bid) > 0)
            .map(t => ({
              id: t.id,
              type: "product_target" as const,
              currentBid: parseFloat(t.bid),
              impressions: t.impressions || 0,
              clicks: t.clicks || 0,
              spend: parseFloat(t.spend || "0"),
              sales: parseFloat(t.sales || "0"),
              orders: t.orders || 0,
            }));
          
          if (productTargets.length > 0) {
            const nextGenPtResults = await nextGenOrchestrator.batchCalculateNextGenBids(
              group.accountId, productTargets, groupConfig, maxBidLimit
            );
            for (const ngr of nextGenPtResults) {
              if (ngr.actionType !== 'hold') {
                results.push({
                  targetId: ngr.targetId,
                  targetType: ngr.targetType === 'keyword' ? 'keyword' : 'product_target',
                  previousBid: ngr.previousBid,
                  newBid: ngr.newBid,
                  actionType: ngr.actionType,
                  bidChangePercent: ngr.bidChangePercent,
                  reason: ngr.reason,
                });
              }
            }
          }
        }
      }
      
      // If not dry run, apply the changes and log them
      if (!input.dryRun) {
        // ✅ 修复P0-1: 创建Amazon API客户端，确保优化动作传递到Amazon后台
        const credentials = await db.getAmazonApiCredentials(group.accountId);
        let syncService: AmazonSyncService | null = null;
        if (credentials) {
          try {
            const accountInfo = await db.getAdAccountById(group.accountId);
            const marketplace = accountInfo?.marketplace || 'US';
            syncService = await AmazonSyncService.createFromCredentials(
              {
                clientId: credentials.clientId,
                clientSecret: credentials.clientSecret,
                refreshToken: credentials.refreshToken,
                profileId: credentials.profileId,
                region: credentials.region as 'NA' | 'EU' | 'FE',
              },
              group.accountId,
              0, // system user
              marketplace
            );
          } catch (apiError: any) {
            log.error('[runOptimization] 创建Amazon API客户端失败:', apiError.message);
          }
        } else {
          log.warn('[runOptimization] 未找到API凭证，仅更新本地数据库');
        }

        let apiSuccessCount = 0;
        let apiFailCount = 0;

        for (const result of results) {
          // Get campaign info for logging
          let campaignId = 0;
          let adGroupId = 0;
          let targetName = "";
          let matchType = "";
          let amazonId = "";
          
          if (result.targetType === "keyword") {
            const keyword = await db.getKeywordById(result.targetId);
            if (keyword) {
              const adGroup = await db.getAdGroupById(Number(keyword.adGroupId));  // v357: adGroupId现在是string类型
              if (adGroup) {
                adGroupId = adGroup.id;
                campaignId = adGroup.campaignId as any;
              }
              targetName = keyword.keywordText;
              matchType = keyword.matchType;
              amazonId = keyword.keywordId || '';
            }
          } else {
            const target = await db.getProductTargetById(result.targetId);
            if (target) {
              const adGroup = await db.getAdGroupById(Number(target.adGroupId));  // v357: adGroupId现在是string类型
              if (adGroup) {
                adGroupId = adGroup.id;
                campaignId = adGroup.campaignId as any;
              }
              targetName = `ASIN: ${target.targetValue}`;
              amazonId = target.targetId || '';
            }
          }

          // ✅ 通过Amazon API执行出价调整
          let apiSuccess = false;
          if (syncService && amazonId) {
            try {
              // v125: Amazon SP API v3 要求ID为字符串类型
              if (result.targetType === "keyword") {
                await syncService.client.updateKeywordBids([{
                  keywordId: String(amazonId),
                  bid: Number(result.newBid.toFixed(2)),
                }]);
              } else {
                await syncService.client.updateProductTargetBids([{
                  targetId: String(amazonId),
                  bid: Number(result.newBid.toFixed(2)),
                }]);
              }
              apiSuccess = true;
              apiSuccessCount++;
            } catch (apiError: any) {
              log.error(`[runOptimization] Amazon API调用失败 (${result.targetType} ${result.targetId}):`, apiError.message);
              apiFailCount++;
            }
          }

          // 更新本地数据库
          if (result.targetType === "keyword") {
            await db.updateKeywordBid(result.targetId, result.newBid.toString());
          } else {
            await db.updateProductTargetBid(result.targetId, result.newBid.toString());
          }
          
          // Create bidding log with API status
          await db.createBiddingLog({
            accountId: group.accountId,
            campaignId: campaignId as any,
            adGroupId,
            logTargetType: result.targetType,
            targetId: result.targetId,
            targetName,
            logMatchType: matchType || undefined,
            actionType: result.actionType,
            previousBid: result.previousBid.toString(),
            newBid: result.newBid.toString(),
            bidChangePercent: result.bidChangePercent.toString(),
            reason: `${apiSuccess ? '[API✅]' : syncService ? '[API❌]' : '[仅本地]'} ${result.reason}`,
            algorithmVersion: "1.0.0",
            isIntradayAdjustment: 0,
          });
        }

        log.info(`[runOptimization] 执行完成: API成功=${apiSuccessCount}, API失败=${apiFailCount}, 总计=${results.length}`);
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


// ==================== Unified Optimization Router ====================
export const unifiedOptimizationRouter = router({
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
