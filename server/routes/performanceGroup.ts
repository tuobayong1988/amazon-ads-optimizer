/**
 * 绩效组管理路由
 * 从 routers.ts 拆分的独立路由模块
 */
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as db from "../db";
import * as unifiedOptimizationEngine from '../optimization/unifiedOptimizationEngine';
import { calculateGoalProgress, type GoalProgressResult, type PerformanceMetrics, type GroupConfig, type TrendData, type TimeWeightedMetrics, type MultiWindowTrendData, type AlgorithmEfficacyData } from '../algorithm/goalProgressAlgorithm';
import * as advancedAnalyticsService from '../analytics/advancedAnalyticsService';
import { syncCampaignStatusToAmazon } from '../services/amazonApiHelper';
import { eq, and, gte, lte, desc } from 'drizzle-orm';
import { bidAdjustmentHistory } from '../../drizzle/schema';
import { createModuleLogger } from '../utils/logger';
import { verifyAccountAccess } from '../utils/accessControl';
import { apiCache } from '../services/apiCacheService';

const log = createModuleLogger('Route_performanceGroup');

// ==================== 趋势数据辅助函数 ====================
// 生成模拟的趋势数据（当没有真实历史数据时使用）
// v453: 已删除 generateSimulatedTrendData 死代码（系统全部使用真实数据库查询）

// 计算趋势摘要数据
function calculateTrendSummary(data: unknown[]) {
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
  
  const totalImpressions = data.reduce((sum: number, d: Record<string, unknown>) => sum + d.impressions, 0);
  const totalClicks = data.reduce((sum: number, d: Record<string, unknown>) => sum + d.clicks, 0);
  const totalSpend = data.reduce((sum: number, d: Record<string, unknown>) => sum + d.spend, 0);
  const totalSales = data.reduce((sum: number, d: Record<string, unknown>) => sum + d.sales, 0);
  const totalOrders = data.reduce((sum: number, d: Record<string, unknown>) => sum + d.orders, 0);
  
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
    const firstAvg = firstHalf.reduce((sum: number, d: Record<string, unknown>) => sum + (d[metric] || 0), 0) / (firstHalf.length || 1);
    const secondAvg = secondHalf.reduce((sum: number, d: Record<string, unknown>) => sum + (d[metric] || 0), 0) / (secondHalf.length || 1);
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



// ==================== Performance Group Router ====================
export const performanceGroupRouter = router({
  list: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .query(async ({ input, ctx }: unknown) => {
      await verifyAccountAccess(ctx.user.id, input.accountId);
      log.info('[performanceGroup.list] accountId:', input.accountId);
      const result = await db.getPerformanceGroupsByAccountId(input.accountId);
      log.info('[performanceGroup.list] result count:', result.length);
      
      // 为每个绩效组实时计算绩效汇总数据
      const enrichedResult = await Promise.all(result.map(async (group) => {
        try {
          const campaigns = await db.getCampaignsByPerformanceGroupId(group.id);
          let totalSpend = 0;
          let totalSales = 0;
          let totalOrders = 0;
          let totalClicks = 0;
          let totalImpressions = 0;
          
          for (const campaign of (campaigns as unknown[])) {
            totalSpend += Number(campaign.spend) || 0;
            totalSales += Number(campaign.sales) || 0;
            totalOrders += (campaign.orders || 0);
            totalClicks += (campaign.clicks || 0);
            totalImpressions += (campaign.impressions || 0);
          }
          
          const avgAcos = totalSales > 0 ? (totalSpend / totalSales) * 100 : 0;
          const avgRoas = totalSpend > 0 ? totalSales / totalSpend : 0;
          const ctr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
          const cvr = totalClicks > 0 ? (totalOrders / totalClicks) * 100 : 0;
          const cpc = totalClicks > 0 ? totalSpend / totalClicks : 0;
          
          // v164: 多维度目标达成度算法（时间衰减加权 + 多窗口趋势 + 渐进优化进度）
          let goalProgressResult: GoalProgressResult | null = null;
          try {
            const metrics: PerformanceMetrics = {
              totalSpend, totalSales, totalOrders, totalClicks, totalImpressions,
              avgAcos, avgRoas, ctr, cvr, cpc
            };
            const groupConfig: GroupConfig = {
              id: group.id,
              optimizationGoal: group.optimizationGoal || 'maximize_sales',
              targetAcos: Number(group.targetAcos) || null,
              targetRoas: Number(group.targetRoas) || null,
              dailyBudget: Number(group.dailyBudget) || null,
              dailySpendLimit: Number(group.dailySpendLimit) || null,
              maxBid: Number(group.maxBid) || null,
              strategyTemplateId: group.strategyTemplateId || null,
              strategyTemplateName: group.strategyTemplateName || null,
              status: group.status || 'active',
              createdAt: group.createdAt || new Date().toISOString(),
              campaignCount: campaigns.length,
            };
            
            // v164: 并行获取趋势对比数据、时间衰减加权指标、多窗口趋势数据
            let trendData: TrendData | undefined;
            let timeWeighted: TimeWeightedMetrics | undefined;
            let multiWindow: MultiWindowTrendData | undefined;
            
            try {
              const [trendResult, twResult, mwResult] = await Promise.all([
                db.getGoalProgressTrendData(group.id, group.createdAt || new Date().toISOString()).catch(() => null),
                db.getTimeWeightedMetricsForGoalProgress(group.id).catch(() => null),
                db.getMultiWindowTrendData(group.id, group.createdAt || new Date().toISOString()).catch(() => null),
              ]);
              if (trendResult) trendData = trendResult;
              if (twResult) timeWeighted = twResult as TimeWeightedMetrics;
              if (mwResult) multiWindow = mwResult as MultiWindowTrendData;
            } catch (dataErr) {
              log.info(`[performanceGroup.list] Data fetch failed for group ${group.id}:`, dataErr);
            }
            
            // v235: 获取NextGen算法效能数据
            let algorithmData: AlgorithmEfficacyData | undefined;
            try {
              const { getAlgorithmEfficacyForTarget } = await import('../algorithm/algorithmEfficacyService');
              algorithmData = await getAlgorithmEfficacyForTarget(group.id);
            } catch (algErr) {
              // 算法效能数据获取失败不影响主流程
            }
            
            // v373: 修复数据口径不一致问题
            // campaigns表的spend/sales是30天汇总，但timeWeighted使用90天时间衰减加权
            // 当有timeWeighted数据时，用其加权指标覆盖metrics中的核心指标，确保一致性
            let effectiveMetrics = metrics;
            if (timeWeighted) {
              effectiveMetrics = {
                ...metrics,
                avgAcos: timeWeighted.weightedAcos,
                avgRoas: timeWeighted.weightedRoas,
                cvr: timeWeighted.weightedCvr,
                cpc: timeWeighted.weightedCpc,
              };
            }
            
            goalProgressResult = calculateGoalProgress(groupConfig, effectiveMetrics, trendData, timeWeighted, multiWindow, algorithmData);
          } catch (progressErr) {
            log.warn(`[performanceGroup.list] Goal progress calc failed for group ${group.id}:`, progressErr);
          }
          
          return {
            ...group,
            campaignCount: campaigns.length,
            totalSpend,
            totalSales,
            totalOrders,
            totalClicks,
            totalImpressions,
            avgAcos,
            avgRoas,
            ctr,
            cvr,
            cpc,
            // v162: 多维度目标达成度
            goalProgress: goalProgressResult ? goalProgressResult.totalScore : null,
            goalProgressDetail: goalProgressResult ? {
              dimensions: goalProgressResult.dimensions,
              summary: goalProgressResult.summary,
              level: goalProgressResult.level,
            } : null,
          };
        } catch (error) {
          log.warn(`[performanceGroup.list] Error enriching group ${group.id}:`, error);
          return {
            ...group,
            campaignCount: 0,
            totalSpend: 0,
            totalSales: 0,
            totalOrders: 0,
            totalClicks: 0,
            totalImpressions: 0,
            avgAcos: 0,
            avgRoas: 0,
            ctr: 0,
            cvr: 0,
            cpc: 0,
            goalProgress: null,
            goalProgressDetail: null,
          };
        }
      }));
      
      return enrichedResult;
    }),
  
  // v370.4: 数据隔离 - 验证绩效组归属
  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }: unknown) => {
      const { verifyPerformanceGroupAccess } = await import('../utils/accessControl');
      await verifyPerformanceGroupAccess(ctx.user.id, input.id);
      return db.getPerformanceGroupById(input.id);
    }),
  
  create: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      name: z.string(),
      description: z.string().optional(),
      optimizationGoal: z.enum(["maximize_sales", "target_acos", "target_roas", "daily_spend_limit", "daily_cost"]).optional(),
      targetType: z.enum(["maximize_sales", "target_acos", "target_roas", "target_cpa"]).optional(),
      targetValue: z.number().optional(),
      targetAcos: z.string().optional(),
      targetRoas: z.string().optional(),
      dailySpendLimit: z.string().optional(),
      dailyBudget: z.number().optional(),
      maxBid: z.number().optional(),
      dailyCostTarget: z.string().optional(),
      campaignIds: z.array(z.number()).optional(),
      strategyTemplateId: z.string().optional(),
      strategyTemplateName: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await verifyAccountAccess(ctx.user.id, input.accountId);
      const { campaignIds, targetType, targetValue, dailyBudget, maxBid, strategyTemplateId, strategyTemplateName, ...rest } = input;
      
      // 转换targetType到optimizationGoal
      const optimizationGoal = targetType || rest.optimizationGoal || "target_acos";
      
      // 转换targetValue到对应字段
      let targetAcos = rest.targetAcos;
      let targetRoas = rest.targetRoas;
      let dailySpendLimit = rest.dailySpendLimit;
      
      if (targetType === "target_acos" && targetValue) {
        targetAcos = targetValue.toString();
      } else if (targetType === "target_roas" && targetValue) {
        targetRoas = targetValue.toString();
      }
      if (dailyBudget) {
        dailySpendLimit = dailyBudget.toString();
      }
      
      const id = await db.createPerformanceGroup({
        userId: ctx.user.id,
        accountId: rest.accountId,
        name: rest.name,
        description: rest.description,
        // @ts-expect-error - type assertion
        optimizationGoal: optimizationGoal as unknown,
        targetAcos,
        targetRoas,
        dailySpendLimit,
        dailyCostTarget: rest.dailyCostTarget,
        ...(dailyBudget ? { dailyBudget: dailyBudget.toString() } : {}),
        ...(maxBid ? { maxBid: maxBid.toString() } : {}),
        ...(strategyTemplateId ? { strategyTemplateId } : {}),
        ...(strategyTemplateName ? { strategyTemplateName } : {}),
      });
      
      // 如果有campaignIds，批量分配广告活动到绩效组
      if (campaignIds && campaignIds.length > 0) {
        await db.batchAssignCampaignsToPerformanceGroup(campaignIds, id);
      }
      
      // v122h: 创建优化目标后立即触发首次优化
      try {
        const { triggerInitialOptimization } = await import('../optimization/optimizationScheduler');
        // 异步执行，不阻塞API响应
        triggerInitialOptimization(id, { triggeredBy: 'create' }).catch(err => {
          log.warn(`[Router] 创建优化目标后触发首次优化失败:`, err);
        });
      } catch (e) {
        log.warn('[Router] 导入optimizationScheduler失败:', e);
      }
      
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
      dailyBudget: z.string().optional(),
      maxBid: z.string().optional(),
      status: z.enum(["active", "paused", "archived"]).optional(),
      strategyTemplateId: z.string().optional(),
      strategyTemplateName: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }: unknown) => {
      // v370.4: 数据隔离 - 验证绩效组归属
      const { verifyPerformanceGroupAccess } = await import('../utils/accessControl');
      await verifyPerformanceGroupAccess(ctx.user.id, input.id);
      const { id, ...data } = input;
      await db.updatePerformanceGroup(id, data);
      
      // v122h: 状态变更时触发调度器事件
      if (data.status) {
        try {
          const { onTargetStatusChanged } = await import('../optimization/optimizationScheduler');
          onTargetStatusChanged(id, data.status as 'active' | 'paused' | 'archived').catch(err => {
            log.warn(`[Router] 状态变更触发失败:`, err);
          });
        } catch (e) {
          log.warn('[Router] 导入optimizationScheduler失败:', e);
        }
      }
      
      return { success: true };
    }),
  
  // v370.4: 数据隔离 - 验证绩效组归属
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }: unknown) => {
      const { verifyPerformanceGroupAccess } = await import('../utils/accessControl');
      await verifyPerformanceGroupAccess(ctx.user.id, input.id);
      await db.deletePerformanceGroup(input.id);
      return { success: true };
    }),
  
  assignCampaign: protectedProcedure
    .input(z.object({
      campaignId: z.number(),
      performanceGroupId: z.number().nullable(),
    }))
    .mutation(async ({ ctx, input }: unknown) => {
      await db.assignCampaignToPerformanceGroup(input.campaignId, input.performanceGroupId);
      return { success: true };
    }),

  // 批量分配广告活动到绩效组
  batchAssignCampaigns: protectedProcedure
    .input(z.object({
      campaignIds: z.array(z.number()),
      performanceGroupId: z.number(),
    }))
    .mutation(async ({ ctx, input }: unknown) => {
      let count = 0;
      for (const campaignId of input.campaignIds) {
        await db.assignCampaignToPerformanceGroup(campaignId, input.performanceGroupId);
        await db.updateCampaign(campaignId, { optimizationStatus: 'managed' });
        count++;
      }
      
      // v122h: 批量分配后立即触发优化
      try {
        const { onCampaignsAdded } = await import('../optimization/optimizationScheduler');
        onCampaignsAdded(input.performanceGroupId, input.campaignIds).catch(err => {
          log.warn(`[Router] 批量分配后触发优化失败:`, err);
        });
      } catch (e) {
        log.warn('[Router] 导入optimizationScheduler失败:', e);
      }
      
      return { success: true, count };
    }),

  // 批量移除广告活动从绩效组
  batchRemoveCampaigns: protectedProcedure
    .input(z.object({
      campaignIds: z.array(z.number()),
    }))
    .mutation(async ({ ctx, input }: unknown) => {
      let count = 0;
      for (const campaignId of input.campaignIds) {
        await db.assignCampaignToPerformanceGroup(campaignId, null);
        // 同时更新优化状态为unmanaged
        await db.updateCampaign(campaignId, { optimizationStatus: 'unmanaged' });
        count++;
      }
      return { success: true, count };
    }),

  // v153: 批量更新广告活动状态（暂停/启用），同时同步到Amazon API
  batchUpdateCampaignStatus: protectedProcedure
    .input(z.object({
      groupId: z.number(),
      campaignIds: z.array(z.number()),
      newStatus: z.enum(['enabled', 'paused']),
    }))
    .mutation(async ({ ctx, input }: unknown) => {
      const group = await db.getPerformanceGroupById(input.groupId);
      if (!group) throw new TRPCError({ code: 'NOT_FOUND', message: '绩效组不存在' });
      
      // 获取所有需要更新的campaign详情
      const campaigns = await db.getCampaignsByPerformanceGroupId(input.groupId);
      const targetCampaigns = campaigns.filter((c: Record<string, unknown>) => input.campaignIds.includes(c.id));
      
      if (targetCampaigns.length === 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: '未找到指定的广告活动' });
      }
      
      // 1. 更新本地数据库状态
      let localUpdated = 0;
      for (const campaign of (targetCampaigns as unknown[])) {
        await db.updateCampaign(campaign.id, { campaignStatus: input.newStatus } as Record<string, unknown>);
        localUpdated++;
      }
      
      // 2. 同步状态到Amazon API
      // v158修复: campaigns表中Amazon Campaign ID存储在campaignId字段
      // v159修复: 添加campaignType以支持SP/SB/SD三种类型的API同步
      const statusChanges = targetCampaigns
        .filter((c: Record<string, unknown>) => c.campaignId && c.campaignId !== '0' && c.campaignId !== '')
        .map((c: Record<string, unknown>) => ({
          campaignId: c.id,
          amazonCampaignId: String(c.campaignId),
          newStatus: input.newStatus as 'enabled' | 'paused',
          campaignName: c.campaignName || `Campaign ${c.id}`,
          campaignType: c.campaignType || 'sp_manual',
          reason: `批量${input.newStatus === 'paused' ? '暂停' : '启用'}操作`,
        }));
      
      log.info(`[batchUpdateCampaignStatus] 准备同步${statusChanges.length}个campaign状态到Amazon (总计${targetCampaigns.length}个)`);
      
      let apiResult = { success: 0, failed: 0, errors: [] as string[] };
      if (statusChanges.length > 0 && group.accountId) {
        try {
          apiResult = await syncCampaignStatusToAmazon(group.accountId, statusChanges);
        } catch (syncError: unknown) {
          // v161: 捕获API同步过程中的未预期异常，防止500错误
          log.warn(`[batchUpdateCampaignStatus] API同步异常:`, (syncError as Error).message);
          apiResult.failed = statusChanges.length;
          apiResult.errors.push(`API同步过程发生异常: ${(syncError as Error).message}`);
        }
      }
      
      // v454: 记录campaign_action到optimization_events，确保操作可追踪
      try {
        const dbInstance = await db.getDb();
        if (dbInstance) {
          for (const campaign of (targetCampaigns as Array<Record<string, unknown>>)) {
            const wasApiSynced = statusChanges.some(sc => sc.campaignId === campaign.id);
            const apiStatus = wasApiSynced ? (apiResult.success > 0 ? 'synced' : 'failed') : 'not_applicable';
            await dbInstance.execute(
              `INSERT INTO optimization_events (account_id, performance_group_id, campaign_id, campaign_name, event_category, action_type, change_reason, api_sync_status, created_at)
               VALUES (?, ?, ?, ?, 'campaign_action', ?, ?, ?, NOW())`,
              [
                group.accountId,
                input.groupId,
                campaign.id,
                campaign.campaignName || `Campaign ${campaign.id}`,
                input.newStatus === 'enabled' ? 'campaign_enable' : 'campaign_pause',
                `用户手动批量${input.newStatus === 'enabled' ? '启用' : '暂停'}操作`,
                apiStatus,
              ]
            );
          }
          log.info(`[batchUpdateCampaignStatus] v454: 已记录${targetCampaigns.length}条campaign_action事件到optimization_events`);
        }
      } catch (eventErr: unknown) {
        log.warn(`[batchUpdateCampaignStatus] v454: 记录optimization_events失败: ${(eventErr as Error).message}`);
      }

      // v219: 批量状态变更后触发确认同步，从 Amazon 回读最新状态
      if (apiResult.success > 0 && group.accountId) {
        try {
          // v359: 使用可靠确认服务
          const { submitReliableConfirmation } = await import('../services/commandConfirmationService');
          submitReliableConfirmation(group.accountId, ['campaigns'], 'batchUpdateCampaignStatus', 'status_change');
        } catch (e: unknown) { log.debug(`确认同步触发忽略: ${e instanceof Error ? (e as Error).message : e}`); }
      }

      return {
        success: true,
        localUpdated,
        apiSynced: apiResult.success,
        apiFailed: apiResult.failed,
        apiErrors: apiResult.errors.slice(0, 5),
      };
    }),

  // v153: 批量从绩效组移除广告活动（带groupId验证）
  batchRemoveCampaignsFromGroup: protectedProcedure
    .input(z.object({
      groupId: z.number(),
      campaignIds: z.array(z.number()),
    }))
    .mutation(async ({ ctx, input }: unknown) => {
      // v453: 添加访问控制（之前缺失，导致安全隐患）
      const { verifyPerformanceGroupAccess } = await import('../utils/accessControl');
      await verifyPerformanceGroupAccess(ctx.user.id, input.groupId);
      
      // v453: 验证输入
      if (!input.campaignIds || input.campaignIds.length === 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: '请选择至少一个广告活动' });
      }
      
      let count = 0;
      const errors: string[] = [];
      for (const campaignId of input.campaignIds) {
        try {
          await db.assignCampaignToPerformanceGroup(campaignId, null);
          await db.updateCampaign(campaignId, { optimizationStatus: 'unmanaged' });
          count++;
        } catch (err: unknown) {
          errors.push(`广告活动 ${campaignId} 移除失败: ${(err as Error).message}`);
        }
      }
      return { success: count > 0, count, errors: errors.length > 0 ? errors : undefined };
    }),

  // v370.4: 数据隔离 - 获取绩效组详情（通过ID）
  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }: unknown) => {
      const { verifyPerformanceGroupAccess } = await import('../utils/accessControl');
      await verifyPerformanceGroupAccess(ctx.user.id, input.id);
      return db.getPerformanceGroupById(input.id);
    }),

  // v484: 数据隔离 + 时间范围绩效数据 - 获取绩效组内的广告活动
  getCampaigns: protectedProcedure
    .input(z.object({ 
      groupId: z.number(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    }))
    .query(async ({ ctx, input }: unknown) => {
      const { verifyPerformanceGroupAccess } = await import('../utils/accessControl');
      await verifyPerformanceGroupAccess(ctx.user.id, input.groupId);
      
      // v484: 如果提供了时间范围，使用带绩效数据的查询
      if (input.startDate && input.endDate) {
        return db.getCampaignsByPerformanceGroupIdWithPerformance(
          input.groupId, input.startDate, input.endDate
        );
      }
      // 默认使用近30天
      const endDate = new Date().toISOString().split('T')[0];
      const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      return db.getCampaignsByPerformanceGroupIdWithPerformance(
        input.groupId, startDate, endDate
      );
    }),

  // v484: 数据隔离 + 时间范围绩效数据 - 获取绩效组KPI汇总
  getKpiSummary: protectedProcedure
    .input(z.object({ 
      groupId: z.number(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    }))
    .query(async ({ ctx, input }: unknown) => {
      const { verifyPerformanceGroupAccess } = await import('../utils/accessControl');
      await verifyPerformanceGroupAccess(ctx.user.id, input.groupId);
      
      // v484: 使用带绩效数据的查询
      const endDate = input.endDate || new Date().toISOString().split('T')[0];
      const startDate = input.startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const campaigns = await db.getCampaignsByPerformanceGroupIdWithPerformance(
        input.groupId, startDate, endDate
      );
      
      let totalSpend = 0;
      let totalRevenue = 0;
      let totalConversions = 0;
      let totalClicks = 0;
      let totalImpressions = 0;
      
      for (const campaign of (campaigns as unknown[])) {
        totalSpend += Number(campaign.spend) || 0;
        totalRevenue += Number(campaign.sales) || 0;
        totalConversions += campaign.orders || 0;
        totalClicks += campaign.clicks || 0;
        totalImpressions += campaign.impressions || 0;
      }
      
      const acos = totalRevenue > 0 ? (totalSpend / totalRevenue) * 100 : 0;
      const roas = totalSpend > 0 ? totalRevenue / totalSpend : 0;
      const ctr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
      const cvr = totalClicks > 0 ? (totalConversions / totalClicks) * 100 : 0;
      
      return {
        totalSpend,
        totalRevenue,
        totalConversions,
        totalClicks,
        totalImpressions,
        acos,
        roas,
        ctr,
        cvr,
        campaignCount: campaigns.length,
      };
    }),

  // v370.4: 数据隔离 - 添加广告活动到绩效组
  addCampaigns: protectedProcedure
    .input(z.object({
      groupId: z.number(),
      campaignIds: z.array(z.number()),
    }))
    .mutation(async ({ ctx, input }: unknown) => {
      const { verifyPerformanceGroupAccess } = await import('../utils/accessControl');
      await verifyPerformanceGroupAccess(ctx.user.id, input.groupId);
      let count = 0;
      for (const campaignId of input.campaignIds) {
        await db.assignCampaignToPerformanceGroup(campaignId, input.groupId);
        await db.updateCampaign(campaignId, { optimizationStatus: 'managed' });
        count++;
      }
      
      // v122h: 添加广告活动后立即触发优化
      try {
        const { onCampaignsAdded } = await import('../optimization/optimizationScheduler');
        onCampaignsAdded(input.groupId, input.campaignIds).catch(err => {
          log.warn(`[Router] 添加广告活动后触发优化失败:`, err);
        });
      } catch (e) {
        log.warn('[Router] 导入optimizationScheduler失败:', e);
      }
      
      return { success: true, count };
    }),

  // v370.4: 数据隔离 - 从绩效组移除单个广告活动
  removeCampaign: protectedProcedure
    .input(z.object({
      groupId: z.number(),
      campaignId: z.number(),
    }))
    .mutation(async ({ ctx, input }: unknown) => {
      const { verifyPerformanceGroupAccess } = await import('../utils/accessControl');
      await verifyPerformanceGroupAccess(ctx.user.id, input.groupId);
      await db.assignCampaignToPerformanceGroup(input.campaignId, null);
      await db.updateCampaign(input.campaignId, { optimizationStatus: 'unmanaged' });
      return { success: true };
    }),

  // v370.4: 数据隔离 - 更新绩效组目标
  updateGoal: protectedProcedure
    .input(z.object({
      groupId: z.number(),
      goalType: z.string(),
      targetValue: z.number().optional(),
      dailyBudget: z.number().optional(),
      maxBid: z.number().optional(),
      strategyTemplateName: z.string().optional(),
      strategyTemplateId: z.string().optional(),
      autoOptimize: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }: unknown) => {
      // v370.4: 数据隔离
      const { verifyPerformanceGroupAccess } = await import('../utils/accessControl');
      await verifyPerformanceGroupAccess(ctx.user.id, input.groupId);
      const updateData: Record<string, unknown> = {
        optimizationGoal: input.goalType,
      };
      
      if (input.goalType === 'target_acos' && input.targetValue) {
        updateData.targetAcos = input.targetValue.toString();
      } else if (input.goalType === 'target_roas' && input.targetValue) {
        updateData.targetRoas = input.targetValue.toString();
      }
      
      if (input.dailyBudget !== undefined) {
        updateData.dailyBudget = input.dailyBudget.toString();
        updateData.dailySpendLimit = input.dailyBudget.toString();
      }
      
      if (input.maxBid !== undefined) {
        updateData.maxBid = input.maxBid.toString();
      }
      
      if (input.strategyTemplateName !== undefined) {
        updateData.strategyTemplateName = input.strategyTemplateName;
        // 同时保存strategyTemplateId，确保两个字段一致
        updateData.strategyTemplateId = input.strategyTemplateName || null;
      }
      
      if (input.strategyTemplateId !== undefined) {
        updateData.strategyTemplateId = input.strategyTemplateId;
      }
      
      if (input.autoOptimize !== undefined) {
        updateData.autoOptimize = input.autoOptimize ? 1 : 0;
      }
      
      await db.updatePerformanceGroup(input.groupId, updateData);
      return { success: true };
    }),

  // ==================== 优化目标自动执行引擎 API ====================
  
  // v370.4: 数据隔离 - 获取优化目标执行摘要
  // v451: 添加2分钟API缓存解决大数据量下的超时问题
  getExecutionSummary: protectedProcedure
    .input(z.object({ targetId: z.number() }))
    .query(async ({ ctx, input }: unknown) => {
      const { verifyPerformanceGroupAccess } = await import('../utils/accessControl');
      await verifyPerformanceGroupAccess(ctx.user.id, input.targetId);
      
      // v451: 缓存优化 - 执行摘要涉及dry-run计算，非常耗时，添加2分钟缓存
      const cacheKey = apiCache.generateKey('performanceGroup.getExecutionSummary', ctx.user.id, input);
      const cached = apiCache.get<unknown>(cacheKey);
      if (cached) {
        log.info(`[Cache HIT] getExecutionSummary targetId=${input.targetId}`);
        return cached;
      }
      
      const optimizationTargetEngine = await import('../optimization/optimizationTargetEngine');
      const result = await optimizationTargetEngine.getOptimizationTargetSummary(input.targetId);
      
      // 缓存2分钟
      apiCache.set(cacheKey, result, 2 * 60 * 1000);
      return result;
    }),
  
  // v370.4: 数据隔离 - 执行优化目标（干运行模式）
  previewExecution: protectedProcedure
    .input(z.object({ 
      targetId: z.number(),
      specificModules: z.array(z.string()).optional(),
    }))
    .query(async ({ ctx, input }: unknown) => {
      const { verifyPerformanceGroupAccess } = await import('../utils/accessControl');
      await verifyPerformanceGroupAccess(ctx.user.id, input.targetId);
      const optimizationTargetEngine = await import('../optimization/optimizationTargetEngine');
      return optimizationTargetEngine.executeOptimizationTarget(input.targetId, {
        dryRun: true,
        forceExecution: true,
        specificModules: input.specificModules,
      });
    }),
  
  // v370.4: 数据隔离 - 执行优化目标（实际执行）
  executeOptimization: protectedProcedure
    .input(z.object({ 
      targetId: z.number(),
      specificModules: z.array(z.string()).optional(),
    }))
    .mutation(async ({ ctx, input }: unknown) => {
      const { verifyPerformanceGroupAccess } = await import('../utils/accessControl');
      await verifyPerformanceGroupAccess(ctx.user.id, input.targetId);
      const optimizationTargetEngine = await import('../optimization/optimizationTargetEngine');
      return optimizationTargetEngine.executeOptimizationTarget(input.targetId, {
        dryRun: false,
        specificModules: input.specificModules,
      });
    }),
  
  // 批量执行所有启用的优化目标
  executeAllEnabled: protectedProcedure
    .input(z.object({ 
      accountId: z.number().optional(),
      dryRun: z.boolean().optional().default(false),
    }))
    .mutation(async ({ ctx, input }: unknown) => {
      const optimizationTargetEngine = await import('../optimization/optimizationTargetEngine');
      return optimizationTargetEngine.executeAllEnabledTargets(input.accountId, {
        dryRun: input.dryRun,
      });
    }),
  
  // 启用/禁用优化目标
  toggleEnabled: protectedProcedure
    .input(z.object({ 
      targetId: z.number(),
      isEnabled: z.boolean(),
    }))
    .mutation(async ({ ctx, input }: unknown) => {
      await db.updatePerformanceGroup(input.targetId, { 
        daypartingEnabled: input.isEnabled ? 1 : 0 
      });
      return { success: true };
    }),

  // ==================== 优化日志 API ====================
  
  // 获取优化目标的日志列表
  getLogs: protectedProcedure
    .input(z.object({
      performanceGroupId: z.number(),
      category: z.enum(['all', 'performance_target', 'bid_adjustment', 'placement_adjustment', 'optimization_settings']).optional().default('all'),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      page: z.number().optional().default(1),
      pageSize: z.number().optional().default(50),
    }))
    .query(async ({ ctx, input }: unknown) => {
      return db.getOptimizationLogs(input);
    }),

  // v137: 获取同步任务队列状态
  getSyncQueueStatus: protectedProcedure
    .input(z.object({
      batchId: z.string().optional(),
      optimizationTargetId: z.number().optional(),
    }))
    .query(async ({ ctx, input }: unknown) => {
      const syncEngine = await import('../sync/optimizationSyncEngine');
      if (input.batchId) {
        return syncEngine.getBatchStatus(input.batchId);
      }
      return { total: 0, synced: 0, failed: 0, pending: 0, retry: 0, permanentlyFailed: 0 };
    }),
  
  // v137: 手动触发重试同步
  retrySyncTasks: protectedProcedure
    .input(z.object({
      batchId: z.string().optional(),
      accountId: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }: unknown) => {
      const syncEngine = await import('../sync/optimizationSyncEngine');
      return syncEngine.executeBatchSync({
        batchId: input.batchId,
        accountId: input.accountId,
      });
    }),
  
  // 获取日志统计信息
  getLogStats: protectedProcedure
    .input(z.object({
      performanceGroupId: z.number(),
      days: z.number().optional().default(30),
    }))
    .query(async ({ ctx, input }: unknown) => {
      return db.getOptimizationLogStats(input.performanceGroupId, input.days);
    }),

  // 获取绩效趋势数据 (使用真实历史数据)
  getTrendData: protectedProcedure
    .input(z.object({
      performanceGroupId: z.number(),
      days: z.number().optional().default(30),
    }))
    .query(async ({ ctx, input }: unknown) => {
      const { performanceGroupId, days } = input;
      
      // 获取绩效组信息
      const group = await db.getPerformanceGroupById(performanceGroupId);
      if (!group) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '优化目标不存在' });
      }
      
      // 计算日期范围
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      
      // 从数据库获取真实历史数据
      const { getDailyPerformanceByPerformanceGroup } = await import('../db-performance-trend');
      const dailyData = await getDailyPerformanceByPerformanceGroup(
        performanceGroupId,
        startDate,
        endDate
      );
      
      // 如果没有历史数据,返回空数组(前端会显示“暂无数据”)
      if (!dailyData || dailyData.length === 0) {
        return [];
      }
      
      // 转换为前端需要的格式
      return dailyData.map(day => {
        const sales = parseFloat(day.totalSales || '0');
        const spend = parseFloat(day.totalSpend || '0');
        const impressions = Number(day.totalImpressions) || 0;
        const clicks = Number(day.totalClicks) || 0;
        const orders = Number(day.totalOrders) || 0;
        
        return {
          date: day.date ? new Date(day.date).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }) : 'N/A',
          fullDate: day.date || new Date().toISOString().split('T')[0],
          spend,
          sales,
          impressions,
          clicks,
          orders,
          // 计算派生指标
          acos: sales > 0 ? (spend / sales) * 100 : 0,
          roas: spend > 0 ? sales / spend : 0,
          ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
          cvr: clicks > 0 ? (orders / clicks) * 100 : 0,
          cpc: clicks > 0 ? spend / clicks : 0,
        };
      });
    }),

  // 添加优化日志
  addLog: protectedProcedure
    .input(z.object({
      performanceGroupId: z.number(),
      logCategory: z.enum(['performance_target', 'bid_adjustment', 'placement_adjustment', 'optimization_settings']),
      actionType: z.string(),
      campaignId: z.number().optional(),
      campaignName: z.string().optional(),
      strategyTemplateId: z.number().optional(),
      strategyTemplateName: z.string().optional(),
      actionDetail: z.string().optional(),
      previousValue: z.string().optional(),
      newValue: z.string().optional(),
      changeReason: z.string().optional(),
      status: z.enum(['pending', 'success', 'failed', 'rolled_back']).optional().default('success'),
    }))
    .mutation(async ({ ctx, input }) => {
      // 获取绩效组信息
      const group = await db.getPerformanceGroupById(input.performanceGroupId);
      if (!group) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '优化目标不存在' });
      }
      
      // 获取账号信息
      const account = await db.getAdAccountById(group.accountId);
      
      const logId = await db.createOptimizationLog({
        performanceGroupId: input.performanceGroupId,
        performanceGroupName: group.name,
        accountId: group.accountId,
        accountName: account?.accountName || '',
        userId: ctx.user.id,
        userName: ctx.user.name || ctx.user.email || '',
        // @ts-expect-error - type assertion
        logCategory: input.logCategory as unknown,
        // @ts-expect-error - type assertion
        actionType: input.actionType as unknown,
        campaignId: input.campaignId,
        campaignName: input.campaignName,
        strategyTemplateId: input.strategyTemplateId,
        strategyTemplateName: input.strategyTemplateName,
        actionDetail: input.actionDetail,
        previousValue: input.previousValue,
        newValue: input.newValue,
        changeReason: input.changeReason,
        // @ts-expect-error - string type assertion
        status: input.status as string,
        executedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      });
      
      return { id: logId, success: true };
    }),

  // ==================== v144: 统一历史与追踪 API ====================
  // 获取优化目标下所有广告活动的出价调整历史
  getBidAdjustmentHistory: protectedProcedure
    .input(z.object({
      performanceGroupId: z.number(),
      campaignId: z.number().optional(),
      adjustmentType: z.enum(['manual', 'auto_optimal', 'auto_dayparting', 'auto_placement', 'batch_campaign', 'batch_group']).optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      page: z.number().optional().default(1),
      pageSize: z.number().optional().default(50),
    }))
    .query(async ({ ctx, input }: unknown) => {
      // v146: 重定向到统一事件表查询
      const group = await db.getPerformanceGroupById(input.performanceGroupId);
      if (!group) throw new Error('Performance group not found');
      const result = await db.getOptimizationEvents({
        performanceGroupId: input.performanceGroupId,
        accountId: group.accountId,
        eventCategory: 'bid_adjustment',
        campaignId: input.campaignId,
        startDate: input.startDate,
        endDate: input.endDate,
        limit: input.pageSize,
        offset: (input.page - 1) * input.pageSize,
      });
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

  // v146: 出价调整统计 - 重定向到统一事件表
  getBidAdjustmentStats: protectedProcedure
    .input(z.object({
      performanceGroupId: z.number(),
      days: z.number().optional().default(30),
    }))
    .query(async ({ ctx, input }: unknown) => {
      const group = await db.getPerformanceGroupById(input.performanceGroupId);
      if (!group) throw new Error('Performance group not found');
      return db.getOptimizationEventStats({
        performanceGroupId: input.performanceGroupId,
        accountId: group.accountId,
        days: input.days,
      });
    }),

  // v146: 效果追踪统计 - 重定向到统一事件表
  getBidAdjustmentTrackingStats: protectedProcedure
    .input(z.object({
      performanceGroupId: z.number(),
      days: z.number().optional().default(30),
    }))
    .query(async ({ ctx, input }: unknown) => {
      const group = await db.getPerformanceGroupById(input.performanceGroupId);
      if (!group) throw new Error('Performance group not found');
      return db.getOptimizationEventStats({
        performanceGroupId: input.performanceGroupId,
        accountId: group.accountId,
        days: input.days,
      });
    }),

  // v146: 回滚出价调整 - 重定向到统一事件表
  rollbackBidAdjustment: protectedProcedure
    .input(z.object({
      adjustmentId: z.number(),
    }))
    .mutation(async ({ input, ctx }: unknown) => {
      return db.rollbackOptimizationEvent(input.adjustmentId, ctx.user.name || ctx.user.openId);
    }),

  // v146: 批量回滚 - 重定向到统一事件表
  batchRollbackBidAdjustments: protectedProcedure
    .input(z.object({
      adjustmentIds: z.array(z.number()),
    }))
    .mutation(async ({ input, ctx }: unknown) => {
      const results = [];
      for (const id of input.adjustmentIds) {
        try {
          const result = await db.rollbackOptimizationEvent(id, ctx.user.name || ctx.user.openId);
          results.push({ id, success: true, result });
        } catch (error: unknown) {
          results.push({ id, success: false, error: (error as Error).message });
        }
      }
      return { results, total: results.length, succeeded: results.filter(r => r.success).length };
    }),

  // 运行效果追踪任务
  runEffectTracking: protectedProcedure
    .input(z.object({
      period: z.enum(['7d', '14d', '30d']).optional(),
    }))
    .mutation(async ({ ctx, input }: unknown) => {
      if (input.period) {
        const { runEffectTrackingTask } = await import('../scheduler/effectTrackingScheduler');
        const periodMap: Record<string, number> = { '7d': 7, '14d': 14, '30d': 30 };
        return runEffectTrackingTask(periodMap[input.period] || 7);
      } else {
        const { runAllTrackingTasks } = await import('../scheduler/effectTrackingScheduler');
        return runAllTrackingTasks();
      }
    }),

  // 生成效果追踪报告
  generateTrackingReport: protectedProcedure
    .input(z.object({
      performanceGroupId: z.number(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      page: z.number().optional().default(1),
      pageSize: z.number().optional().default(50),
    }))
    .query(async ({ ctx, input }: unknown) => {
      // v146: 重定向到统一事件表查询
      const group = await db.getPerformanceGroupById(input.performanceGroupId);
      if (!group) throw new Error('Performance group not found');
      const result = await db.getOptimizationEvents({
        performanceGroupId: input.performanceGroupId,
        accountId: group.accountId,
        eventCategory: 'bid_adjustment',
        startDate: input.startDate,
        endDate: input.endDate,
        limit: input.pageSize,
        offset: (input.page - 1) * input.pageSize,
      });
      const allRecords = result.events.map((e: Record<string, unknown>) => ({
        ...e,
        appliedAt: e.createdAt,
        adjustmentType: e.adjustmentType || e.actionType,
      }));
      const trackedRecords = allRecords.filter((r: Record<string, unknown>) => 
        r.actualProfit7D !== null || r.actualProfit14D !== null || r.actualProfit30D !== null
      );
      return {
        records: trackedRecords,
        total: trackedRecords.length,
        allRecords,
        allTotal: result.total,
        page: input.page,
        pageSize: input.pageSize,
      };
    }),

  // ==================== v145: 统一优化事件 API ====================
  
  // 查询统一优化事件
  getOptimizationEvents: protectedProcedure
    .input(z.object({
      performanceGroupId: z.number(),
      eventCategory: z.string().optional(),
      actionType: z.string().optional(),
      status: z.string().optional(),
      campaignId: z.number().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      page: z.number().optional().default(1),
      pageSize: z.number().optional().default(50),
    }))
    .query(async ({ ctx, input }: unknown) => {
      const group = await db.getPerformanceGroupById(input.performanceGroupId);
      if (!group) throw new Error('Performance group not found');
      const result = await db.getOptimizationEvents({
        performanceGroupId: input.performanceGroupId,
        accountId: group.accountId,
        eventCategory: input.eventCategory,
        actionType: input.actionType,
        status: input.status,
        campaignId: input.campaignId,
        startDate: input.startDate,
        endDate: input.endDate,
        limit: input.pageSize,
        offset: (input.page - 1) * input.pageSize,
      });
      return { ...result, page: input.page, pageSize: input.pageSize };
    }),

  // 获取统一优化事件统计
  getOptimizationEventStats: protectedProcedure
    .input(z.object({
      performanceGroupId: z.number(),
      days: z.number().optional().default(30),
    }))
    .query(async ({ ctx, input }: unknown) => {
      const group = await db.getPerformanceGroupById(input.performanceGroupId);
      if (!group) throw new Error('Performance group not found');
      return db.getOptimizationEventStats({
        performanceGroupId: input.performanceGroupId,
        accountId: group.accountId,
        days: input.days,
      });
    }),

  // 回滚统一优化事件
  rollbackOptimizationEvent: protectedProcedure
    .input(z.object({
      eventId: z.number(),
    }))
    .mutation(async ({ input, ctx }: unknown) => {
      return db.rollbackOptimizationEvent(input.eventId, ctx.user.name || ctx.user.openId);
    }),

  // 数据迁移API - 将旧表数据迁移到optimization_events
  migrateToUnifiedEvents: protectedProcedure
    .input(z.object({
      performanceGroupId: z.number(),
      sourceTables: z.array(z.enum(['bidding_logs', 'bid_adjustment_history', 'optimization_logs'])).optional(),
    }))
    .mutation(async ({ ctx, input }: unknown) => {
      const group = await db.getPerformanceGroupById(input.performanceGroupId);
      if (!group) throw new Error('Performance group not found');
      
      const results: Record<string, number> = {};
      const tables = input.sourceTables || ['bidding_logs', 'bid_adjustment_history', 'optimization_logs'];
      
      if (tables.includes('bidding_logs')) {
        results.biddingLogs = await db.migrateFromBiddingLogs(group.accountId);
      }
      if (tables.includes('bid_adjustment_history')) {
        results.bidAdjustmentHistory = await db.migrateFromBidAdjustmentHistory(group.accountId);
      }
      if (tables.includes('optimization_logs')) {
        results.optimizationLogs = await db.migrateFromOptimizationLogs(input.performanceGroupId);
      }
      
       return { success: true, migrated: results, total: Object.values(results).reduce((a: unknown, b: unknown) => a + b, 0) };
    }),

  // ==================== v151: 统一分析API入口 ====================
  // 将原来分散在 advancedAnalytics / algorithmEffect / unifiedOptimization 中的分析功能
  // 统一通过 performanceGroup 路由提供，前端可以在优化目标详情页直接调用

  // 获取优化目标的综合分析摘要（融合多个分析服务的结果）
  getUnifiedAnalytics: protectedProcedure
    .input(z.object({
      groupId: z.number(),
      days: z.number().optional().default(30),
    }))
    .query(async ({ ctx, input }: unknown) => {
      const group = await import('../db').then(m => m.getPerformanceGroupById(input.groupId));
      if (!group) throw new Error('优化目标不存在');

      // 并行获取多个分析维度的数据
      const [attribution, summary] = await Promise.allSettled([
        advancedAnalyticsService.getAttributionAnalysis({
          performanceGroupId: input.groupId,
          days: input.days,
          limit: 10,
          offset: 0,
        }),
        advancedAnalyticsService.getAdvancedAnalyticsSummary({
          performanceGroupId: input.groupId,
          days: input.days,
        }),
      ]);

      return {
        groupId: input.groupId,
        groupName: group.name,
        attribution: attribution.status === 'fulfilled' ? attribution.value : null,
        summary: summary.status === 'fulfilled' ? summary.value : null,
      };
    }),

  // 获取优化目标的优化状态（代替原 unifiedOptimization.getPerformanceGroupState）
  getOptimizationState: protectedProcedure
    .input(z.object({ groupId: z.number() }))
    .query(async ({ ctx, input }: unknown) => {
      return unifiedOptimizationEngine.getPerformanceGroupOptimizationState(input.groupId);
    }),
});
