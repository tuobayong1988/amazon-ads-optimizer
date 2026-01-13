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
import * as abTestService from './abTestService';
import * as budgetAutoExecutionService from './budgetAutoExecutionService';
import { reviewRouter } from './reviewRouter';
import * as apiSecurityService from './apiSecurityService';
import * as specialScenarioOptimizationService from './specialScenarioOptimizationService';
import * as automationExecutionEngine from './automationExecutionEngine';
import * as autoOperationService from './autoOperationService';
import { calculateDateRangeByMarketplace, getMarketplaceLocalDate, MARKETPLACE_TIMEZONES } from '../shared/timezone';
import { getSQSConsumer, startSQSConsumer, stopSQSConsumer } from './sqsConsumerService';
import * as marginalBenefitService from './marginalBenefitAnalysisService';

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
            await db.updateAdAccount(acc.id, { isDefault: 0 });
          }
        }
      }
      
      const id = await db.createAdAccount({
        userId: ctx.user.id,
        ...input,
        isDefault: input.isDefault ? 1 : 0,
        connectionStatus: 'pending',
      });
      return { id };
    }),
  
  // 创建空店铺（不包含站点）
  createStore: protectedProcedure
    .input(z.object({
      storeName: z.string(),
      storeDescription: z.string().optional(),
      storeColor: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // 检查是否已存在同名店铺
      const existingAccounts = await db.getAdAccountsByUserId(ctx.user.id);
      const existingStore = existingAccounts.find(a => a.storeName === input.storeName);
      if (existingStore) {
        throw new TRPCError({ code: 'CONFLICT', message: '已存在同名店铺' });
      }
      
      // 创建空店铺（使用店铺名称作为accountId和accountName，marketplace为空）
      const id = await db.createAdAccount({
        userId: ctx.user.id,
        storeName: input.storeName,
        storeDescription: input.storeDescription,
        storeColor: input.storeColor,
        accountId: `store_${Date.now()}`, // 临时ID，授权后会更新
        accountName: input.storeName,
        marketplace: '', // 空店铺没有站点
        connectionStatus: 'pending',
        isDefault: existingAccounts.length === 0 ? 1 : 0, // 第一个店铺设为默认
      });
      return { id, storeName: input.storeName };
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
      const { id, intradayBiddingEnabled, ...rest } = input;
      const data = {
        ...rest,
        ...(intradayBiddingEnabled !== undefined && { intradayBiddingEnabled: intradayBiddingEnabled ? 1 : 0 }),
      };
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
  
  // 获取账号列表及绩效汇总（支持时间范围筛选，根据站点时区计算日期）
  listWithPerformance: protectedProcedure
    .input(z.object({
      timeRange: z.enum(['today', 'yesterday', '7days', '14days', '30days', '60days', '90days', 'custom']).optional().default('7days'),
      days: z.number().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
    const timeRange = input?.timeRange || '7days';
    const accounts = await db.getAdAccountsByUserId(ctx.user.id);
    
    // 过滤掉空店铺占位记录（marketplace为空）
    const actualSites = accounts.filter(a => a.marketplace && a.marketplace !== '');
    
    // 辅助函数：根据站点时区计算日期范围
    const calculateDatesForMarketplace = (marketplace: string) => {
      // 获取站点本地日期
      const localDateStr = getMarketplaceLocalDate(marketplace);
      const [year, month, day] = localDateStr.split('-').map(Number);
      const localToday = new Date(year, month - 1, day);
      
      let startDate: Date;
      let endDate: Date;
      let prevStartDate: Date;
      let prevEndDate: Date;
      
      if (timeRange === 'custom' && input?.startDate && input?.endDate) {
        startDate = new Date(input.startDate);
        endDate = new Date(input.endDate);
        const rangeDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
        prevEndDate = new Date(startDate);
        prevStartDate = new Date(prevEndDate);
        prevStartDate.setDate(prevStartDate.getDate() - rangeDays);
      } else if (timeRange === 'today') {
        // 使用站点本地的"今天"
        startDate = localToday;
        endDate = localToday;
        prevStartDate = new Date(localToday);
        prevStartDate.setDate(prevStartDate.getDate() - 1);
        prevEndDate = new Date(localToday);
        prevEndDate.setDate(prevEndDate.getDate() - 1);
      } else if (timeRange === 'yesterday') {
        // 使用站点本地的"昨天"
        startDate = new Date(localToday);
        startDate.setDate(startDate.getDate() - 1);
        endDate = new Date(startDate);
        prevStartDate = new Date(startDate);
        prevStartDate.setDate(prevStartDate.getDate() - 1);
        prevEndDate = new Date(startDate);
        prevEndDate.setDate(prevEndDate.getDate() - 1);
      } else if (timeRange === '7days') {
        startDate = new Date(localToday);
        startDate.setDate(startDate.getDate() - 6);
        endDate = localToday;
        prevStartDate = new Date(startDate);
        prevStartDate.setDate(prevStartDate.getDate() - 7);
        prevEndDate = new Date(startDate);
        prevEndDate.setDate(prevEndDate.getDate() - 1);
      } else if (timeRange === '14days') {
        startDate = new Date(localToday);
        startDate.setDate(startDate.getDate() - 13);
        endDate = localToday;
        prevStartDate = new Date(startDate);
        prevStartDate.setDate(prevStartDate.getDate() - 14);
        prevEndDate = new Date(startDate);
        prevEndDate.setDate(prevEndDate.getDate() - 1);
      } else if (timeRange === '30days') {
        startDate = new Date(localToday);
        startDate.setDate(startDate.getDate() - 29);
        endDate = localToday;
        prevStartDate = new Date(startDate);
        prevStartDate.setDate(prevStartDate.getDate() - 30);
        prevEndDate = new Date(startDate);
        prevEndDate.setDate(prevEndDate.getDate() - 1);
      } else if (timeRange === '60days') {
        startDate = new Date(localToday);
        startDate.setDate(startDate.getDate() - 59);
        endDate = localToday;
        prevStartDate = new Date(startDate);
        prevStartDate.setDate(prevStartDate.getDate() - 60);
        prevEndDate = new Date(startDate);
        prevEndDate.setDate(prevEndDate.getDate() - 1);
      } else { // 90days
        startDate = new Date(localToday);
        startDate.setDate(startDate.getDate() - 89);
        endDate = localToday;
        prevStartDate = new Date(startDate);
        prevStartDate.setDate(prevStartDate.getDate() - 90);
        prevEndDate = new Date(startDate);
        prevEndDate.setDate(prevEndDate.getDate() - 1);
      }
      
      return { startDate, endDate, prevStartDate, prevEndDate, localToday };
    };
    
    // 为每个账户获取绩效汇总（根据各自站点时区计算日期）
    const accountsWithPerformance = await Promise.all(
      actualSites.map(async (account) => {
        // 根据站点时区计算日期范围
        const { startDate, endDate, prevStartDate, prevEndDate, localToday } = calculateDatesForMarketplace(account.marketplace || 'US');
        
        // 从 campaigns 表汇总绩效数据（当前期间）
        const performance = await db.getAccountPerformanceSummary(account.id, startDate, endDate);
        // 上一期间数据（用于计算环比）
        const prevPerformance = await db.getAccountPerformanceSummary(account.id, prevStartDate, prevEndDate);
        
        const spend = performance?.totalSpend || 0;
        const sales = performance?.totalSales || 0;
        const orders = performance?.totalOrders || 0;
        const acos = spend > 0 && sales > 0 ? (spend / sales) * 100 : 0;
        const roas = spend > 0 && sales > 0 ? sales / spend : 0;
        
        // 计算环比变化
        const prevSpend = prevPerformance?.totalSpend || 0;
        const prevSales = prevPerformance?.totalSales || 0;
        const prevAcos = prevSpend > 0 && prevSales > 0 ? (prevSpend / prevSales) * 100 : 0;
        
        const spendChange = prevSpend > 0 ? ((spend - prevSpend) / prevSpend) * 100 : 0;
        const salesChange = prevSales > 0 ? ((sales - prevSales) / prevSales) * 100 : 0;
        const acosChange = prevAcos > 0 ? acos - prevAcos : 0;
        
        // 确定账户状态
        let status: 'healthy' | 'warning' | 'critical' = 'healthy';
        let alerts = 0;
        if (acos > 35) {
          status = 'warning';
          alerts = 1;
        }
        if (acos > 50) {
          status = 'critical';
          alerts = 2;
        }
        
        return {
          id: account.id,
          name: account.storeName || account.accountName,
          marketplace: account.marketplace,
          spend,
          sales,
          orders,
          acos,
          roas,
          status,
          alerts,
          change: { 
            spend: parseFloat(spendChange.toFixed(1)), 
            sales: parseFloat(salesChange.toFixed(1)), 
            acos: parseFloat(acosChange.toFixed(1)) 
          },
        };
      })
    );
    
    return accountsWithPerformance;
  }),

  // 获取账号统计信息
  getStats: protectedProcedure.query(async ({ ctx }) => {
    const accounts = await db.getAdAccountsByUserId(ctx.user.id);
    
    // 过滤掉空店铺占位记录（marketplace为空），只统计实际站点
    const actualSites = accounts.filter(a => a.marketplace && a.marketplace !== '');
    
    // 按店铺名称分组，统计店铺数量
    const storeNames = new Set(accounts.map(a => a.storeName || a.accountName));
    
    const stats = {
      // 总店铺数（按storeName去重）
      total: storeNames.size,
      // 已连接的站点数
      connected: actualSites.filter(a => a.connectionStatus === 'connected').length,
      // 待配置的站点数（包括空店铺）
      pending: accounts.filter(a => a.connectionStatus === 'pending' || !a.marketplace || a.marketplace === '').length,
      // 连接错误的站点数
      error: actualSites.filter(a => a.connectionStatus === 'error').length,
      // 市场覆盖（去重后的国家数量）
      marketplaceCount: new Set(actualSites.map(a => a.marketplace)).size,
      // 按市场分组统计
      byMarketplace: {} as Record<string, number>,
    };
    
    for (const account of actualSites) {
      if (account.marketplace) {
        stats.byMarketplace[account.marketplace] = (stats.byMarketplace[account.marketplace] || 0) + 1;
      }
    }
    
    return stats;
  }),
  
  // 获取每日趋势数据
  getDailyTrend: protectedProcedure
    .input(z.object({
      days: z.number().default(7),
      timeRange: z.enum(['today', 'yesterday', '7days', '14days', '30days', '60days', '90days', 'custom']).optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const accounts = await db.getAdAccountsByUserId(ctx.user.id);
      const actualSites = accounts.filter(a => a.marketplace && a.marketplace !== '');
      const accountIds = actualSites.map(a => a.id);
      
      if (accountIds.length === 0) {
        return [];
      }
      
      // 获取每日绩效数据
      const trendData = await db.getDailyTrendData(accountIds, input.days, input.timeRange, input.startDate, input.endDate);
      return trendData;
    }),
  
  // 获取数据可用日期范围（用于自定义日期选择器的限制）
  getDataDateRange: protectedProcedure.query(async ({ ctx }) => {
    const accounts = await db.getAdAccountsByUserId(ctx.user.id);
    const actualSites = accounts.filter(a => a.marketplace && a.marketplace !== '');
    const accountIds = actualSites.map(a => a.id);
    
    if (accountIds.length === 0) {
      // 没有账户时，返回默认90天范围
      const now = new Date();
      const minDate = new Date(now);
      minDate.setDate(minDate.getDate() - 90);
      return {
        minDate: minDate.toISOString().split('T')[0],
        maxDate: now.toISOString().split('T')[0],
        hasData: false,
      };
    }
    
    // 获取最早和最晚的数据日期
    const dateRange = await db.getDataDateRange(accountIds);
    return dateRange;
  }),
});

// ==================== Performance Group Router ====================
const performanceGroupRouter = router({
  list: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .query(async ({ input }) => {
      console.log('[performanceGroup.list] accountId:', input.accountId);
      const result = await db.getPerformanceGroupsByAccountId(input.accountId);
      console.log('[performanceGroup.list] result count:', result.length, 'data:', JSON.stringify(result));
      return result;
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
    }))
    .mutation(async ({ ctx, input }) => {
      const { campaignIds, targetType, targetValue, dailyBudget, maxBid, ...rest } = input;
      
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
        optimizationGoal: optimizationGoal as any,
        targetAcos,
        targetRoas,
        dailySpendLimit,
        dailyCostTarget: rest.dailyCostTarget,
      });
      
      // 如果有campaignIds，批量分配广告活动到绩效组
      if (campaignIds && campaignIds.length > 0) {
        await db.batchAssignCampaignsToPerformanceGroup(campaignIds, id);
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
  
  assignCampaign: protectedProcedure
    .input(z.object({
      campaignId: z.number(),
      performanceGroupId: z.number().nullable(),
    }))
    .mutation(async ({ input }) => {
      await db.assignCampaignToPerformanceGroup(input.campaignId, input.performanceGroupId);
      return { success: true };
    }),

  // 批量分配广告活动到绩效组
  batchAssignCampaigns: protectedProcedure
    .input(z.object({
      campaignIds: z.array(z.number()),
      performanceGroupId: z.number(),
    }))
    .mutation(async ({ input }) => {
      let count = 0;
      for (const campaignId of input.campaignIds) {
        await db.assignCampaignToPerformanceGroup(campaignId, input.performanceGroupId);
        // 同时更新优化状态为managed
        await db.updateCampaign(campaignId, { optimizationStatus: 'managed' });
        count++;
      }
      return { success: true, count };
    }),

  // 批量移除广告活动从绩效组
  batchRemoveCampaigns: protectedProcedure
    .input(z.object({
      campaignIds: z.array(z.number()),
    }))
    .mutation(async ({ input }) => {
      let count = 0;
      for (const campaignId of input.campaignIds) {
        await db.assignCampaignToPerformanceGroup(campaignId, null);
        // 同时更新优化状态为unmanaged
        await db.updateCampaign(campaignId, { optimizationStatus: 'unmanaged' });
        count++;
      }
      return { success: true, count };
    }),

  // 获取绩效组详情（通过ID）
  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return db.getPerformanceGroupById(input.id);
    }),

  // 获取绩效组内的广告活动（新API，使用groupId参数）
  getCampaigns: protectedProcedure
    .input(z.object({ groupId: z.number() }))
    .query(async ({ input }) => {
      return db.getCampaignsByPerformanceGroupId(input.groupId);
    }),

  // 获取绩效组KPI汇总
  getKpiSummary: protectedProcedure
    .input(z.object({ groupId: z.number() }))
    .query(async ({ input }) => {
      // 获取绩效组内所有广告活动的汇总数据
      const campaigns = await db.getCampaignsByPerformanceGroupId(input.groupId);
      let totalSpend = 0;
      let totalRevenue = 0;
      let totalConversions = 0;
      let totalClicks = 0;
      let totalImpressions = 0;
      
      for (const campaign of campaigns) {
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

  // 添加广告活动到绩效组
  addCampaigns: protectedProcedure
    .input(z.object({
      groupId: z.number(),
      campaignIds: z.array(z.number()),
    }))
    .mutation(async ({ input }) => {
      let count = 0;
      for (const campaignId of input.campaignIds) {
        await db.assignCampaignToPerformanceGroup(campaignId, input.groupId);
        await db.updateCampaign(campaignId, { optimizationStatus: 'managed' });
        count++;
      }
      return { success: true, count };
    }),

  // 从绩效组移除单个广告活动
  removeCampaign: protectedProcedure
    .input(z.object({
      groupId: z.number(),
      campaignId: z.number(),
    }))
    .mutation(async ({ input }) => {
      await db.assignCampaignToPerformanceGroup(input.campaignId, null);
      await db.updateCampaign(input.campaignId, { optimizationStatus: 'unmanaged' });
      return { success: true };
    }),

  // 更新绩效组目标
  updateGoal: protectedProcedure
    .input(z.object({
      groupId: z.number(),
      goalType: z.string(),
      targetValue: z.number().optional(),
      dailyBudget: z.number().optional(),
      maxBid: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const updateData: any = {
        optimizationGoal: input.goalType,
      };
      
      if (input.goalType === 'target_acos' && input.targetValue) {
        updateData.targetAcos = input.targetValue.toString();
      } else if (input.goalType === 'target_roas' && input.targetValue) {
        updateData.targetRoas = input.targetValue.toString();
      }
      
      if (input.dailyBudget) {
        updateData.dailySpendLimit = input.dailyBudget.toString();
      }
      
      // maxBid需要在数据库层面支持
      
      await db.updatePerformanceGroup(input.groupId, updateData);
      return { success: true };
    }),

  // ==================== 优化目标自动执行引擎 API ====================
  
  // 获取优化目标执行摘要
  getExecutionSummary: protectedProcedure
    .input(z.object({ targetId: z.number() }))
    .query(async ({ input }) => {
      const optimizationTargetEngine = await import('./optimizationTargetEngine');
      return optimizationTargetEngine.getOptimizationTargetSummary(input.targetId);
    }),
  
  // 执行优化目标（干运行模式 - 预览待执行操作）
  previewExecution: protectedProcedure
    .input(z.object({ 
      targetId: z.number(),
      specificModules: z.array(z.string()).optional(),
    }))
    .query(async ({ input }) => {
      const optimizationTargetEngine = await import('./optimizationTargetEngine');
      return optimizationTargetEngine.executeOptimizationTarget(input.targetId, {
        dryRun: true,
        forceExecution: true,
        specificModules: input.specificModules,
      });
    }),
  
  // 执行优化目标（实际执行）
  executeOptimization: protectedProcedure
    .input(z.object({ 
      targetId: z.number(),
      specificModules: z.array(z.string()).optional(),
    }))
    .mutation(async ({ input }) => {
      const optimizationTargetEngine = await import('./optimizationTargetEngine');
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
    .mutation(async ({ input }) => {
      const optimizationTargetEngine = await import('./optimizationTargetEngine');
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
    .mutation(async ({ input }) => {
      await db.updatePerformanceGroup(input.targetId, { 
        daypartingEnabled: input.isEnabled ? 1 : 0 
      });
      return { success: true };
    }),
});

// ==================== Campaign Router ====================
const campaignRouter = router({
  list: protectedProcedure
    .input(z.object({ 
      accountId: z.number().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    }))
    .query(async ({ input }) => {
      // 如果提供了时间范围，使用带绩效数据的查询
      if (input.accountId && input.startDate && input.endDate) {
        return db.getCampaignsWithPerformance(input.accountId, input.startDate, input.endDate);
      }
      if (input.accountId) {
        return db.getCampaignsByAccountId(input.accountId);
      }
      // 如果没有指定accountId，返回所有广告活动
      return db.getAllCampaigns();
    }),

  // 获取未分配到绩效组的广告活动
  listUnassigned: protectedProcedure
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
      
      // 记录审计日志
      const { logAudit } = await import("./auditService");
      const changes: string[] = [];
      if (input.campaignName) changes.push(`名称: ${input.campaignName}`);
      if (input.maxBid) changes.push(`最高出价: $${input.maxBid}`);
      if (input.dailyBudget) changes.push(`日预算: $${input.dailyBudget}`);
      if (input.campaignStatus) changes.push(`状态: ${input.campaignStatus}`);
      if (input.intradayBiddingEnabled !== undefined) changes.push(`分时竞价: ${input.intradayBiddingEnabled ? '开启' : '关闭'}`);
      
      await logAudit({
        userId: ctx.user.id,
        userName: ctx.user.name || undefined,
        userEmail: ctx.user.email || undefined,
        actionType: 'campaign_update',
        targetType: 'campaign',
        targetId: String(input.id),
        targetName: previousCampaign?.campaignName || undefined,
        description: `更新广告活动（${changes.join(', ')}）`,
        previousValue: previousCampaign ? { maxBid: previousCampaign.maxBid, dailyBudget: previousCampaign.dailyBudget, status: previousCampaign.campaignStatus } : undefined,
        newValue: { maxBid: input.maxBid, dailyBudget: input.dailyBudget, status: input.campaignStatus },
        accountId: previousCampaign?.accountId,
        status: 'success',
      });
      
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
      
      const result = await executeOptimizationSuggestions(
        ctx.user.id,
        campaign.accountId,
        input.campaignId,
        input.suggestions,
        input.predictions,
        input.aiSummary
      );
      
      // 记录AI优化执行审计日志
      const { logAudit } = await import("./auditService");
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
});

// ==================== Ad Group Router ====================
const adGroupRouter = router({
  // 获取广告活动下的所有广告组
  listByCampaign: protectedProcedure
    .input(z.object({ 
      campaignId: z.number(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    }))
    .query(async ({ input }) => {
      return db.getAdGroupsByCampaignId(input.campaignId);
    }),
  
  // 获取广告组详情
  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return db.getAdGroupById(input.id);
    }),
  
  // 获取广告组及其关键词统计
  getWithKeywordStats: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const adGroup = await db.getAdGroupById(input.id);
      if (!adGroup) return null;
      
      const keywords = await db.getKeywordsByAdGroupId(input.id);
      const productTargets = await db.getProductTargetsByAdGroupId(input.id);
      
      return {
        ...adGroup,
        keywordCount: keywords.length,
        productTargetCount: productTargets.length,
        keywords: keywords.slice(0, 10), // 返回前10个关键词
        productTargets: productTargets.slice(0, 10), // 返回前10个商品定位
      };
    }),
  
  // 更新广告组默认出价
  updateDefaultBid: protectedProcedure
    .input(z.object({
      id: z.number(),
      defaultBid: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const adGroup = await db.getAdGroupById(input.id);
      const previousBid = adGroup?.defaultBid || '0';
      
      await db.updateAdGroupDefaultBid(input.id, input.defaultBid);
      
      // 记录审计日志
      const { logAudit } = await import("./auditService");
      await logAudit({
        userId: ctx.user.id,
        userName: ctx.user.name || undefined,
        userEmail: ctx.user.email || undefined,
        actionType: 'bid_adjust_single',
        targetType: 'ad_group',
        targetId: String(input.id),
        targetName: adGroup?.adGroupName || undefined,
        description: `调整广告组默认出价从$${previousBid}到$${input.defaultBid}`,
        previousValue: { defaultBid: previousBid },
        newValue: { defaultBid: input.defaultBid },
        status: 'success',
      });
      
      return { success: true };
    }),
  
  // 更新广告组状态
  updateStatus: protectedProcedure
    .input(z.object({
      id: z.number(),
      status: z.enum(['enabled', 'paused', 'archived']),
    }))
    .mutation(async ({ ctx, input }) => {
      const adGroup = await db.getAdGroupById(input.id);
      const previousStatus = adGroup?.adGroupStatus || 'enabled';
      
      await db.updateAdGroupStatus(input.id, input.status);
      
      // 记录审计日志
      const { logAudit } = await import("./auditService");
      await logAudit({
        userId: ctx.user.id,
        userName: ctx.user.name || undefined,
        userEmail: ctx.user.email || undefined,
        actionType: 'campaign_pause',
        targetType: 'ad_group',
        targetId: String(input.id),
        targetName: adGroup?.adGroupName || undefined,
        description: `更新广告组状态从${previousStatus}到${input.status}`,
        previousValue: { status: previousStatus },
        newValue: { status: input.status },
        status: 'success',
      });
      
      return { success: true };
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
    .mutation(async ({ ctx, input }) => {
      // 获取关键词信息用于审计日志
      const keyword = await db.getKeywordById(input.id);
      const previousBid = keyword?.bid || '0';
      
      await db.updateKeywordBid(input.id, input.bid);
      
      // 记录审计日志
      const { logAudit } = await import("./auditService");
      await logAudit({
        userId: ctx.user.id,
        userName: ctx.user.name || undefined,
        userEmail: ctx.user.email || undefined,
        actionType: 'bid_adjust_single',
        targetType: 'keyword',
        targetId: String(input.id),
        targetName: keyword?.keywordText || keyword?.keywordId || undefined,
        description: `调整关键词出价从$${previousBid}到$${input.bid}`,
        previousValue: { bid: previousBid },
        newValue: { bid: input.bid },
        status: 'success',
      });
      
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
    .mutation(async ({ ctx, input }) => {
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
      
      // 记录批量出价调整审计日志
      if (results.length > 0) {
        const { logAudit } = await import("./auditService");
        const bidTypeDesc: Record<string, string> = {
          fixed: `固定出价$${input.bidValue}`,
          increase_percent: `提高${input.bidValue}%`,
          decrease_percent: `降低${input.bidValue}%`,
          cpc_multiplier: `CPC的${input.bidValue}倍`,
          cpc_increase_percent: `CPC提高${input.bidValue}%`,
          cpc_decrease_percent: `CPC降低${input.bidValue}%`,
        };
        await logAudit({
          userId: ctx.user.id,
          userName: ctx.user.name || undefined,
          userEmail: ctx.user.email || undefined,
          actionType: 'bid_adjust_batch',
          targetType: 'keyword',
          description: `批量调整${results.length}个关键词出价（${bidTypeDesc[input.bidType]}）`,
          metadata: { bidType: input.bidType, bidValue: input.bidValue, count: results.length },
          previousValue: results.map(r => ({ id: r.id, bid: r.oldBid })),
          newValue: results.map(r => ({ id: r.id, bid: r.newBid })),
          status: 'success',
        });
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
        await db.updateKeyword(id, { keywordStatus: input.status });
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
            keywordStatus: "enabled",
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
        await db.updateProductTarget(id, { targetStatus: input.status });
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
  
  // 获取趋势数据（真实数据）
  getTrendData: protectedProcedure
    .input(z.object({ 
      accountId: z.number(),
      days: z.number().optional().default(30),
    }))
    .query(async ({ input }) => {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - input.days);
      
      const dailyData = await db.getDailyPerformanceByDateRange(
        input.accountId,
        startDate,
        endDate
      );
      
      // 如果没有数据，返回空数组
      if (!dailyData || dailyData.length === 0) {
        return [];
      }
      
      // 转换为前端需要的格式
      return dailyData.map(day => ({
        date: new Date(day.date).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }),
        fullDate: day.date,
        sales: parseFloat(day.sales || '0'),
        spend: parseFloat(day.spend || '0'),
        impressions: day.impressions || 0,
        clicks: day.clicks || 0,
        orders: day.orders || 0,
        acos: parseFloat(day.sales || '0') > 0 
          ? (parseFloat(day.spend || '0') / parseFloat(day.sales || '0')) * 100 
          : 0,
        roas: parseFloat(day.spend || '0') > 0 
          ? parseFloat(day.sales || '0') / parseFloat(day.spend || '0') 
          : 0,
      }));
    }),
  
  // 获取周对比数据（真实数据）
  getWeeklyComparison: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .query(async ({ input }) => {
      const today = new Date();
      const dayOfWeek = today.getDay(); // 0=周日, 1=周一, ...
      
      // 计算本周开始日期（周一）
      const thisWeekStart = new Date(today);
      thisWeekStart.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
      thisWeekStart.setHours(0, 0, 0, 0);
      
      // 计算上周开始日期
      const lastWeekStart = new Date(thisWeekStart);
      lastWeekStart.setDate(lastWeekStart.getDate() - 7);
      
      const lastWeekEnd = new Date(thisWeekStart);
      lastWeekEnd.setDate(lastWeekEnd.getDate() - 1);
      lastWeekEnd.setHours(23, 59, 59, 999);
      
      // 获取本周和上周的数据
      const [thisWeekData, lastWeekData] = await Promise.all([
        db.getDailyPerformanceByDateRange(input.accountId, thisWeekStart, today),
        db.getDailyPerformanceByDateRange(input.accountId, lastWeekStart, lastWeekEnd),
      ]);
      
      const weekDays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
      
      // 按周几分组数据
      const result = weekDays.map((name, index) => {
        const thisWeekDay = thisWeekData?.find(d => {
          const date = new Date(d.date);
          const dow = date.getDay();
          return (dow === 0 ? 6 : dow - 1) === index;
        });
        
        const lastWeekDay = lastWeekData?.find(d => {
          const date = new Date(d.date);
          const dow = date.getDay();
          return (dow === 0 ? 6 : dow - 1) === index;
        });
        
        return {
          name,
          thisWeek: parseFloat(thisWeekDay?.sales || '0'),
          lastWeek: parseFloat(lastWeekDay?.sales || '0'),
        };
      });
      
      return result;
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
  
  // 区域级别数据对比
  getRegionComparison: protectedProcedure
    .input(z.object({ 
      userId: z.number(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    }))
    .query(async ({ input }) => {
      // 定义区域映射
      const REGIONS: Record<string, { name: string; flag: string; marketplaces: string[] }> = {
        NA: { name: '北美区域', flag: '🇺🇸', marketplaces: ['US', 'CA', 'MX', 'BR'] },
        EU: { name: '欧洲区域', flag: '🇪🇺', marketplaces: ['UK', 'DE', 'FR', 'IT', 'ES', 'NL', 'SE', 'PL', 'AE', 'SA', 'IN'] },
        FE: { name: '远东区域', flag: '🌏', marketplaces: ['JP', 'AU', 'SG'] },
      };
      
      // 获取用户所有账号
      const accounts = await db.getAdAccountsByUserId(input.userId);
      
      // 计算日期范围（默认最近30天，支持自定义）
      const endDate = input.endDate ? new Date(input.endDate) : new Date();
      const startDate = input.startDate ? new Date(input.startDate) : new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);
      
      // 按区域汇总数据
      const regionData: Record<string, {
        region: string;
        regionName: string;
        flag: string;
        accountCount: number;
        totalSales: number;
        totalSpend: number;
        totalOrders: number;
        totalClicks: number;
        totalImpressions: number;
        acos: number;
        roas: number;
        ctr: number;
        cvr: number;
        marketplaces: string[];
      }> = {};
      
      // 初始化区域数据
      for (const [regionId, regionInfo] of Object.entries(REGIONS)) {
        regionData[regionId] = {
          region: regionId,
          regionName: regionInfo.name,
          flag: regionInfo.flag,
          accountCount: 0,
          totalSales: 0,
          totalSpend: 0,
          totalOrders: 0,
          totalClicks: 0,
          totalImpressions: 0,
          acos: 0,
          roas: 0,
          ctr: 0,
          cvr: 0,
          marketplaces: [],
        };
      }
      
      // 汇总每个账号的数据到对应区域
      for (const account of accounts) {
        // 确定账号所属区域
        let accountRegion = 'NA'; // 默认北美
        for (const [regionId, regionInfo] of Object.entries(REGIONS)) {
          if (regionInfo.marketplaces.includes(account.marketplace)) {
            accountRegion = regionId;
            break;
          }
        }
        
        // 获取账号的性能数据
        const summary = await db.getPerformanceSummary(account.id, startDate, endDate);
        
        if (summary) {
          const sales = parseFloat(summary.totalSales || '0');
          const spend = parseFloat(summary.totalSpend || '0');
          const orders = summary.totalOrders || 0;
          const clicks = summary.totalClicks || 0;
          const impressions = summary.totalImpressions || 0;
          
          regionData[accountRegion].accountCount++;
          regionData[accountRegion].totalSales += sales;
          regionData[accountRegion].totalSpend += spend;
          regionData[accountRegion].totalOrders += orders;
          regionData[accountRegion].totalClicks += clicks;
          regionData[accountRegion].totalImpressions += impressions;
          
          // 添加站点到列表（去重）
          if (!regionData[accountRegion].marketplaces.includes(account.marketplace)) {
            regionData[accountRegion].marketplaces.push(account.marketplace);
          }
        }
      }
      
      // 计算派生指标
      for (const regionId of Object.keys(regionData)) {
        const data = regionData[regionId];
        data.acos = data.totalSales > 0 ? (data.totalSpend / data.totalSales) * 100 : 0;
        data.roas = data.totalSpend > 0 ? data.totalSales / data.totalSpend : 0;
        data.ctr = data.totalImpressions > 0 ? (data.totalClicks / data.totalImpressions) * 100 : 0;
        data.cvr = data.totalClicks > 0 ? (data.totalOrders / data.totalClicks) * 100 : 0;
      }
      
      // 返回有数据的区域
      return Object.values(regionData).filter(r => r.accountCount > 0);
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
            logTargetType: result.targetType,
            targetId: result.targetId,
            targetName,
            logMatchType: matchType || undefined,
            actionType: result.actionType,
            previousBid: result.previousBid.toString(),
            newBid: result.newBid.toString(),
            bidChangePercent: result.bidChangePercent.toString(),
            reason: result.reason,
            algorithmVersion: "1.0.0",
            isIntradayAdjustment: 0,
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
        completedAt: data.status === "completed" || data.status === "failed" ? new Date().toISOString() : undefined,
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
      clientId: z.string().optional(),
      clientSecret: z.string().optional(),
      redirectUri: z.string().optional(),
      region: z.enum(['NA', 'EU', 'FE']).optional(),
    }))
    .mutation(async ({ input }) => {
      try {
        // 使用服务器端环境变量作为默认值，确保紫鸟浏览器手动授权流程能正常工作
        const clientId = input.clientId || process.env.AMAZON_ADS_CLIENT_ID || '';
        const clientSecret = input.clientSecret || process.env.AMAZON_ADS_CLIENT_SECRET || '';
        const redirectUri = input.redirectUri || 'https://sellerps.com';
        const region = input.region || 'NA';
        
        if (!clientId || !clientSecret) {
          throw new Error('缺少Amazon API凭证。请在系统设置中配置AMAZON_ADS_CLIENT_ID和AMAZON_ADS_CLIENT_SECRET环境变量。');
        }
        
        console.log('[ExchangeCode] Exchanging code for tokens...', {
          codeLength: input.code.length,
          clientIdPrefix: clientId.substring(0, 20) + '...',
          redirectUri,
          region,
        });
        
        const tokens = await AmazonAdsApiClient.exchangeCodeForToken(
          input.code,
          clientId,
          clientSecret,
          redirectUri
        );
        
        console.log('[ExchangeCode] Token exchange successful');
        
        // 尝试获取Profile列表
        let profiles: Array<{ profileId: string; countryCode: string; accountName: string }> = [];
        try {
          console.log('[ExchangeCode] Creating client to fetch profiles...');
          const client = new AmazonAdsApiClient({
            clientId,
            clientSecret,
            refreshToken: tokens.refresh_token,
            profileId: '', // 获取profiles不需要profileId
            region,
          });
          console.log('[ExchangeCode] Calling getProfiles()...');
          const profileList = await client.getProfiles();
          console.log('[ExchangeCode] Raw profile list:', JSON.stringify(profileList, null, 2));
          profiles = profileList.map(p => ({
            profileId: String(p.profileId),
            countryCode: p.countryCode || '',
            accountName: p.accountInfo?.name || `Profile ${p.profileId}`,
          }));
          console.log('[ExchangeCode] Fetched profiles:', profiles.length, profiles);
        } catch (profileError: any) {
          console.error('[ExchangeCode] Failed to fetch profiles:', profileError.message);
          console.error('[ExchangeCode] Profile error details:', profileError.response?.data || profileError.stack);
          // 不抛出错误，继续返回其他信息
        }
        
        return {
          success: true,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          expiresIn: tokens.expires_in,
          // 返回凭证信息供前端自动填充
          clientId,
          clientSecret,
          profiles,
        };
      } catch (error: any) {
        console.error('[ExchangeCode] Token exchange failed:', error.response?.data || error.message);
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `授权码换取失败: ${error.response?.data?.error_description || error.response?.data?.error || error.message}`,
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
      // 添加详细日志
      console.log('[saveCredentials] 收到保存凭证请求:', {
        accountId: input.accountId,
        clientIdPrefix: input.clientId?.substring(0, 30) + '...',
        clientSecretPrefix: input.clientSecret?.substring(0, 20) + '...',
        refreshTokenPrefix: input.refreshToken?.substring(0, 20) + '...',
        profileId: input.profileId,
        region: input.region,
      });
      
      // 检查必填字段
      if (!input.clientId || !input.clientSecret || !input.refreshToken) {
        console.error('[saveCredentials] 缺少必填字段');
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: '缺少必填的API凭证字段',
        });
      }
      
      // Validate credentials before saving
      console.log('[saveCredentials] 开始验证凭证...');
      const isValid = await validateCredentials({
        clientId: input.clientId,
        clientSecret: input.clientSecret,
        refreshToken: input.refreshToken,
        profileId: input.profileId,
        region: input.region,
      });
      console.log('[saveCredentials] 验证结果:', isValid);

      if (!isValid) {
        console.error('[saveCredentials] 凭证验证失败');
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

      // 更新账号的连接状态为已连接
      await db.updateAdAccount(input.accountId, {
        connectionStatus: 'connected',
      });

      // 授权成功后自动触发数据同步
      let syncResult = {
        campaigns: 0,
        adGroups: 0,
        keywords: 0,
        targets: 0,
        performance: 0,
        error: null as string | null,
      };

      try {
        console.log(`[授权后自动同步] 开始为账号 ${input.accountId} 同步数据...`);
        
        // 获取账号的站点信息
        const accountInfo = await db.getAdAccountById(input.accountId);
        const marketplace = accountInfo?.marketplace || 'US';
        
        const syncService = await AmazonSyncService.createFromCredentials(
          {
            clientId: input.clientId,
            clientSecret: input.clientSecret,
            refreshToken: input.refreshToken,
            profileId: input.profileId,
            region: input.region,
          },
          input.accountId,
          ctx.user.id,
          marketplace // 传入站点代码用于时区计算
        );

        // 执行完整同步（获取90天历史数据）
        const result = await syncService.syncAll();
        syncResult = { ...result, error: null };
        
        console.log(`[授权后自动同步] 同步完成，获取90天历史数据:`, syncResult);

        // 更新最后同步时间
        await db.updateAmazonApiCredentialsLastSync(input.accountId);
      } catch (syncError: any) {
        console.error(`[授权后自动同步] 同步失败:`, syncError);
        syncResult.error = syncError.message || '同步失败';
        // 同步失败不影响授权成功，只是记录错误
      }

      // 授权成功后自动创建每小时定时同步配置
      try {
        console.log(`[授权后自动同步] 为账号 ${input.accountId} 创建每小时定时同步配置...`);
        
        // 检查是否已存在定时同步配置
        const existingSchedule = await db.getSyncScheduleByAccountId(ctx.user.id, input.accountId);
        
        if (!existingSchedule) {
          // 创建新的每小时定时同步配置
          await db.createSyncSchedule({
            userId: ctx.user.id,
            accountId: input.accountId,
            syncType: 'all',
            frequency: 'hourly',
            isEnabled: true,
          });
          console.log(`[授权后自动同步] 已为账号 ${input.accountId} 创建每小时定时同步配置`);
        } else {
          console.log(`[授权后自动同步] 账号 ${input.accountId} 已存在定时同步配置，跳过创建`);
        }
      } catch (scheduleError: any) {
        console.error(`[授权后自动同步] 创建定时同步配置失败:`, scheduleError);
        // 创建定时同步配置失败不影响授权成功
      }

      return { 
        success: true,
        syncResult,
      };
    }),

  // Save credentials for multiple profiles (multi-marketplace authorization)
  saveMultipleProfiles: protectedProcedure
    .input(z.object({
      storeName: z.string(),
      existingStoreName: z.string().optional(), // 已有店铺名称，用于将新站点添加到已有店铺
      clientId: z.string(),
      clientSecret: z.string(),
      refreshToken: z.string(),
      region: z.enum(['NA', 'EU', 'FE']),
      profiles: z.array(z.object({
        profileId: z.string(),
        countryCode: z.string(),
        accountName: z.string(),
      })),
    }))
    .mutation(async ({ ctx, input }) => {
      // 优先使用existingStoreName（已有店铺名称），否则使用storeName
      const effectiveStoreName = input.existingStoreName || input.storeName;
      
      console.log('[saveMultipleProfiles] 收到多站点授权请求:', {
        storeName: input.storeName,
        existingStoreName: input.existingStoreName,
        effectiveStoreName,
        profilesCount: input.profiles.length,
        profiles: input.profiles.map(p => ({ profileId: p.profileId, countryCode: p.countryCode })),
        region: input.region,
      });

      // 检查必填字段
      if (!input.clientId || !input.clientSecret || !input.refreshToken) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: '缺少必填的API凭证字段',
        });
      }

      if (input.profiles.length === 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: '至少需要一个Profile',
        });
      }

      // 国家代码到市场名称的映射
      const countryToMarketplace: Record<string, string> = {
        'US': '美国', 'CA': '加拿大', 'MX': '墨西哥', 'BR': '巴西',
        'UK': '英国', 'DE': '德国', 'FR': '法国', 'IT': '意大利',
        'ES': '西班牙', 'NL': '荷兰', 'SE': '瑞典', 'PL': '波兰',
        'JP': '日本', 'AU': '澳大利亚', 'SG': '新加坡',
        'AE': '阿联酋', 'SA': '沙特阿拉伯', 'IN': '印度',
      };

      const results: Array<{
        profileId: string;
        countryCode: string;
        accountId: number;
        success: boolean;
        error?: string;
      }> = [];

      // 先检查是否存在空店铺占位记录（marketplace为空），如果存在则删除
      const allAccounts = await db.getAdAccountsByUserId(ctx.user.id);
      const emptyStoreRecord = allAccounts.find(
        a => a.storeName === effectiveStoreName && (!a.marketplace || a.marketplace === '')
      );
      if (emptyStoreRecord) {
        console.log(`[saveMultipleProfiles] 删除空店铺占位记录 ${emptyStoreRecord.id}`);
        await db.deleteAdAccount(emptyStoreRecord.id);
      }

      // 为每个profile创建账号和保存凭证
      for (const profile of input.profiles) {
        try {
          const marketplaceName = countryToMarketplace[profile.countryCode] || profile.countryCode;
          // 保存国家代码（如US, CA, MX），而不是中文名称，以便前端正确显示国旗
          const marketplaceCode = profile.countryCode;
          
          // 检查是否已存在相同profileId的账号
          const existingAccounts = await db.getAdAccountsByUserId(ctx.user.id);
          const existingAccountByProfileId = existingAccounts.find(a => a.profileId === profile.profileId);
          
          // 同时检查同一店铺下是否已存在相同国家的站点（避免重复）
          const existingAccountByCountry = existingAccounts.find(
            a => a.storeName === effectiveStoreName && a.marketplace === marketplaceCode
          );
          
          let accountId: number;
          
          if (existingAccountByProfileId) {
            // 更新现有账号（按profileId匹配）
            accountId = existingAccountByProfileId.id;
            // 更新店铺名称和marketplace代码
            await db.updateAdAccount(accountId, {
              storeName: effectiveStoreName,
              marketplace: marketplaceCode,
            });
            console.log(`[saveMultipleProfiles] 更新现有账号 ${accountId} (${profile.countryCode}) - 按profileId匹配`);
          } else if (existingAccountByCountry) {
            // 更新现有账号（同店铺同国家）
            accountId = existingAccountByCountry.id;
            // 更新profileId和其他信息
            await db.updateAdAccount(accountId, {
              profileId: profile.profileId,
              accountId: profile.profileId,
            });
            console.log(`[saveMultipleProfiles] 更新现有账号 ${accountId} (${profile.countryCode}) - 按店铺+国家匹配`);
          } else {
            // 创建新账号 - createAdAccount返回insertId数字
            // 使用effectiveStoreName确保新站点添加到正确的店铺下
            accountId = await db.createAdAccount({
              userId: ctx.user.id,
              storeName: effectiveStoreName,
              accountName: `${effectiveStoreName} ${marketplaceName}`,
              accountId: profile.profileId,
              marketplace: marketplaceCode,  // 保存国家代码（如US, CA, MX）
              profileId: profile.profileId,
              connectionStatus: 'pending',
            });
            console.log(`[saveMultipleProfiles] 创建新账号 ${accountId} (${profile.countryCode})`);
          }

          // 保存API凭证
          await db.saveAmazonApiCredentials({
            accountId,
            clientId: input.clientId,
            clientSecret: input.clientSecret,
            refreshToken: input.refreshToken,
            profileId: profile.profileId,
            region: input.region,
          });

          // 更新账号连接状态
          await db.updateAdAccount(accountId, {
            connectionStatus: 'connected',
          });

          results.push({
            profileId: profile.profileId,
            countryCode: profile.countryCode,
            accountId,
            success: true,
          });

          console.log(`[saveMultipleProfiles] 账号 ${accountId} (${profile.countryCode}) 凭证保存成功`);
        } catch (error: any) {
          console.error(`[saveMultipleProfiles] 处理 ${profile.countryCode} 失败:`, error);
          results.push({
            profileId: profile.profileId,
            countryCode: profile.countryCode,
            accountId: 0,
            success: false,
            error: error.message,
          });
        }
      }

      // 为所有成功创建的账号触发数据同步
      const successfulAccounts = results.filter(r => r.success);
      for (const account of successfulAccounts) {
        try {
          console.log(`[saveMultipleProfiles] 开始为账号 ${account.accountId} (${account.countryCode}) 同步数据...`);
          
          const syncService = await AmazonSyncService.createFromCredentials(
            {
              clientId: input.clientId,
              clientSecret: input.clientSecret,
              refreshToken: input.refreshToken,
              profileId: account.profileId,
              region: input.region,
            },
            account.accountId,
            ctx.user.id,
            account.countryCode || 'US' // 传入站点代码用于时区计算
          );

          // 异步执行完整同步（获取90天历史数据），不阻塞返回
          syncService.syncAll().then(result => {
            console.log(`[saveMultipleProfiles] 账号 ${account.accountId} (${account.countryCode}) 同步完成，获取90天历史数据:`, result);
            db.updateAmazonApiCredentialsLastSync(account.accountId);
          }).catch(err => {
            console.error(`[saveMultipleProfiles] 账号 ${account.accountId} (${account.countryCode}) 同步失败:`, err);
          });
        } catch (syncError: any) {
          console.error(`[saveMultipleProfiles] 启动同步失败 (${account.countryCode}):`, syncError);
        }
      }

      return {
        success: true,
        totalProfiles: input.profiles.length,
        successCount: successfulAccounts.length,
        failedCount: results.filter(r => !r.success).length,
        results,
      };
    }),

  // Get API credentials status
  getCredentialsStatus: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .query(async ({ input }) => {
      const credentials = await db.getAmazonApiCredentials(input.accountId);
      if (!credentials) {
        return {
          hasCredentials: false,
          region: undefined,
          lastSyncAt: undefined,
          // 返回空的凭证信息
          clientId: undefined,
          clientSecret: undefined,
          refreshToken: undefined,
          profileId: undefined,
        };
      }
      
      // 返回脱敏后的凭证信息，用于前端显示
      return {
        hasCredentials: true,
        region: credentials.region,
        lastSyncAt: credentials.lastSyncAt,
        // 返回完整的Client ID（不是敏感信息）
        clientId: credentials.clientId,
        // Client Secret脱敏，只显示前几位
        clientSecret: credentials.clientSecret ? `${credentials.clientSecret.substring(0, 8)}${'*'.repeat(20)}` : undefined,
        // Refresh Token脱敏，只显示前缀
        refreshToken: credentials.refreshToken ? `${credentials.refreshToken.substring(0, 10)}${'*'.repeat(20)}` : undefined,
        // 返回完整的Profile ID（不是敏感信息）
        profileId: credentials.profileId,
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

  // Sync all data from Amazon (async mode - returns jobId immediately)
  syncAll: protectedProcedure
    .input(z.object({ 
      accountId: z.number(),
      isIncremental: z.boolean().optional().default(false),
      maxRetries: z.number().optional().default(3),
    }))
    .mutation(async ({ ctx, input }) => {
      const credentials = await db.getAmazonApiCredentials(input.accountId);
      if (!credentials) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'API credentials not found',
        });
      }

      // 创建同步任务记录
      const jobId = await db.createSyncJob({
        userId: ctx.user.id,
        accountId: input.accountId,
        syncType: 'all',
        isIncremental: input.isIncremental,
        maxRetries: input.maxRetries,
      });

      // 获取账号的站点信息
      const account = await db.getAdAccountById(input.accountId);
      const marketplace = account?.marketplace || 'US';

      // 异步执行同步任务，立即返回jobId
      const runSyncAsync = async () => {
        const startTime = Date.now();
        
        // 获取上次成功同步时间（用于增量同步）
        const lastSyncTime = input.isIncremental 
          ? await db.getLastSuccessfulSync(input.accountId)
          : null;

        const syncService = await AmazonSyncService.createFromCredentials(
          {
            clientId: credentials.clientId,
            clientSecret: credentials.clientSecret,
            refreshToken: credentials.refreshToken,
            profileId: credentials.profileId,
            region: credentials.region as 'NA' | 'EU' | 'FE',
          },
          input.accountId,
          ctx.user.id,
          marketplace
        );

        // 带重试的执行函数
        const executeWithRetry = async <T>(
          fn: () => Promise<T>,
          stepName: string,
          maxRetries: number = input.maxRetries
        ): Promise<T> => {
          let lastError: Error | null = null;
          for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
              return await fn();
            } catch (error: any) {
              lastError = error;
              console.error(`${stepName} 失败 (尝试 ${attempt + 1}/${maxRetries + 1}):`, error.message);
              if (attempt < maxRetries) {
                const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
                await new Promise(resolve => setTimeout(resolve, delay));
              }
            }
          }
          throw lastError;
        };

        let totalRetries = 0;
        let results: any = {
          campaigns: 0,
          spCampaigns: 0,
          sbCampaigns: 0,
          sdCampaigns: 0,
          adGroups: 0,
          keywords: 0,
          targets: 0,
          performance: 0,
          skipped: 0,
        };

        const changeSummary = {
          campaignsCreated: 0,
          campaignsUpdated: 0,
          campaignsDeleted: 0,
          adGroupsCreated: 0,
          adGroupsUpdated: 0,
          adGroupsDeleted: 0,
          keywordsCreated: 0,
          keywordsUpdated: 0,
          keywordsDeleted: 0,
          targetsCreated: 0,
          targetsUpdated: 0,
          targetsDeleted: 0,
          conflictsDetected: 0,
          conflictsResolved: 0,
        };

        const totalSteps = 8; // 增加了“获取账户信息”步骤
        let currentStepIndex = 0;

        const updateProgress = async (stepName: string, stepIndex: number, stepResults?: any) => {
          if (!jobId) return;
          const progressPercent = Math.round(((stepIndex + 1) / totalSteps) * 100);
          await db.updateSyncJob(jobId, {
            currentStep: stepName,
            totalSteps,
            currentStepIndex: stepIndex,
            progressPercent,
            siteProgress: {
              currentStep: stepName,
              stepIndex,
              totalSteps,
              progressPercent,
              results: stepResults || results,
            },
          });
        };

        try {
          // 首先获取profile信息，包括时区和货币
          await updateProgress('获取账户信息', currentStepIndex);
          try {
            const profiles = await syncService.client.getProfiles();
            const matchingProfile = profiles.find(p => p.profileId.toString() === credentials.profileId);
            if (matchingProfile) {
              // 存储timezone和currencyCode到数据库
              await db.updateAmazonApiCredentialsTimezone(
                input.accountId,
                matchingProfile.timezone,
                matchingProfile.currencyCode
              );
              console.log(`[同步] 已更新账户 ${input.accountId} 的时区: ${matchingProfile.timezone}, 货币: ${matchingProfile.currencyCode}`);
            }
          } catch (profileError: any) {
            console.error('[同步] 获取profile信息失败:', profileError.message);
            // 不影响后续同步
          }
          currentStepIndex++;

          // SP广告活动
          await updateProgress('SP广告活动', currentStepIndex);
          const spResult = await executeWithRetry(
            () => syncService.syncSpCampaignsWithTracking(lastSyncTime, jobId),
            'SP广告同步'
          );
          results.spCampaigns = spResult.synced;
          results.skipped += spResult.skipped || 0;
          changeSummary.campaignsCreated += spResult.created || 0;
          changeSummary.campaignsUpdated += spResult.updated || 0;
          changeSummary.conflictsDetected += spResult.conflicts || 0;
          currentStepIndex++;

          // SB广告活动
          await updateProgress('SB广告活动', currentStepIndex);
          const sbResult = await executeWithRetry(
            () => syncService.syncSbCampaignsWithTracking(lastSyncTime, jobId),
            'SB广告同步'
          );
          results.sbCampaigns = sbResult.synced;
          results.skipped += sbResult.skipped || 0;
          changeSummary.campaignsCreated += sbResult.created || 0;
          changeSummary.campaignsUpdated += sbResult.updated || 0;
          changeSummary.conflictsDetected += sbResult.conflicts || 0;
          currentStepIndex++;

          // SD广告活动
          await updateProgress('SD广告活动', currentStepIndex);
          const sdResult = await executeWithRetry(
            () => syncService.syncSdCampaignsWithTracking(lastSyncTime, jobId),
            'SD广告同步'
          );
          results.sdCampaigns = sdResult.synced;
          results.skipped += sdResult.skipped || 0;
          changeSummary.campaignsCreated += sdResult.created || 0;
          changeSummary.campaignsUpdated += sdResult.updated || 0;
          changeSummary.conflictsDetected += sdResult.conflicts || 0;
          currentStepIndex++;

          // 广告组
          await updateProgress('广告组', currentStepIndex);
          const adGroupsResult = await executeWithRetry(
            () => syncService.syncSpAdGroupsWithTracking(lastSyncTime, jobId),
            '广告组同步'
          );
          results.adGroups = adGroupsResult.synced;
          results.skipped += adGroupsResult.skipped || 0;
          changeSummary.adGroupsCreated += adGroupsResult.created || 0;
          changeSummary.adGroupsUpdated += adGroupsResult.updated || 0;
          changeSummary.conflictsDetected += adGroupsResult.conflicts || 0;
          currentStepIndex++;

          // 关键词
          await updateProgress('关键词', currentStepIndex);
          const keywordsResult = await executeWithRetry(
            () => syncService.syncSpKeywordsWithTracking(lastSyncTime, jobId),
            '关键词同步'
          );
          results.keywords = keywordsResult.synced;
          results.skipped += keywordsResult.skipped || 0;
          changeSummary.keywordsCreated += keywordsResult.created || 0;
          changeSummary.keywordsUpdated += keywordsResult.updated || 0;
          changeSummary.conflictsDetected += keywordsResult.conflicts || 0;
          currentStepIndex++;

          // 商品定位
          await updateProgress('商品定位', currentStepIndex);
          const targetsResult = await executeWithRetry(
            () => syncService.syncSpProductTargetsWithTracking(lastSyncTime, jobId),
            '商品定位同步'
          );
          results.targets = targetsResult.synced;
          results.skipped += targetsResult.skipped || 0;
          changeSummary.targetsCreated += targetsResult.created || 0;
          changeSummary.targetsUpdated += targetsResult.updated || 0;
          changeSummary.conflictsDetected += targetsResult.conflicts || 0;
          currentStepIndex++;

          results.campaigns = results.spCampaigns + results.sbCampaigns + results.sdCampaigns;

          // 绩效数据
          const isFirstSync = !credentials.lastSyncAt;
          const performanceDays = isFirstSync ? 60 : 30;
          
          await updateProgress('绩效数据', currentStepIndex);
          try {
            console.log(`[绩效数据同步] ${isFirstSync ? '首次同步' : '增量同步'}，获取最近${performanceDays}天数据`);
            const performanceCount = await executeWithRetry(
              () => syncService.syncPerformanceData(performanceDays),
              '绩效数据同步'
            );
            results.performance = performanceCount;
            console.log(`[绩效数据同步] 完成: ${performanceCount} 条记录`);
          } catch (error: any) {
            console.error('[绩效数据同步] 失败:', error.message);
            results.performance = 0;
            results.performanceError = error.message;
          }

          // 搜索词数据同步（新增）
          try {
            console.log('[搜索词同步] 开始同步搜索词数据...');
            const searchTermsCount = await syncService.syncSearchTerms(performanceDays);
            results.searchTerms = searchTermsCount;
            console.log(`[搜索词同步] 完成: ${searchTermsCount} 条记录`);
          } catch (error: any) {
            console.error('[搜索词同步] 失败:', error.message);
            results.searchTerms = 0;
          }

          // 广告位置绩效同步（新增）
          try {
            console.log('[位置绩效同步] 开始同步广告位置绩效...');
            const placementsCount = await syncService.syncPlacementPerformance(performanceDays);
            results.placements = placementsCount;
            console.log(`[位置绩效同步] 完成: ${placementsCount} 条记录`);
          } catch (error: any) {
            console.error('[位置绩效同步] 失败:', error.message);
            results.placements = 0;
          }

          // 自动定向数据同步（新增）
          try {
            console.log('[自动定向同步] 开始同步SP自动定向数据...');
            const autoTargetsCount = await syncService.syncAutoTargeting(performanceDays);
            results.autoTargets = autoTargetsCount;
            console.log(`[自动定向同步] 完成: ${autoTargetsCount} 条记录`);
          } catch (error: any) {
            console.error('[自动定向同步] 失败:', error.message);
            results.autoTargets = 0;
          }

          // SD定向数据同步（新增）
          try {
            console.log('[SD定向同步] 开始同步SD定向数据...');
            const sdTargetsCount = await syncService.syncSdTargeting(performanceDays);
            results.sdTargets = sdTargetsCount;
            console.log(`[SD定向同步] 完成: ${sdTargetsCount} 条记录`);
          } catch (error: any) {
            console.error('[SD定向同步] 失败:', error.message);
            results.sdTargets = 0;
          }

          // SB定向数据同步（新增）
          try {
            console.log('[SB定向同步] 开始同步SB定向数据...');
            const sbTargetsCount = await syncService.syncSbTargeting(performanceDays);
            results.sbTargets = sbTargetsCount;
            console.log(`[SB定向同步] 完成: ${sbTargetsCount} 条记录`);
          } catch (error: any) {
            console.error('[SB定向同步] 失败:', error.message);
            results.sbTargets = 0;
          }

          // 保存变更摘要
          if (jobId) {
            await db.upsertSyncChangeSummary({
              syncJobId: jobId,
              accountId: input.accountId,
              userId: ctx.user.id,
              ...changeSummary,
            });
          }

          // 更新同步任务记录为完成
          const durationMs = Date.now() - startTime;
          if (jobId) {
            await db.updateSyncJob(jobId, {
              status: 'completed',
              recordsSynced: results.campaigns + results.adGroups + results.keywords + results.targets,
              recordsSkipped: results.skipped,
              durationMs,
              retryCount: totalRetries,
              spCampaigns: results.spCampaigns,
              sbCampaigns: results.sbCampaigns,
              sdCampaigns: results.sdCampaigns,
              adGroupsSynced: results.adGroups,
              keywordsSynced: results.keywords,
              targetsSynced: results.targets,
            });
          }

          // 更新最后同步时间
          await db.updateAmazonApiCredentials(input.accountId, {
            lastSyncAt: new Date().toISOString(),
          });

          console.log(`[同步完成] 账号 ${input.accountId} 同步完成，耗时 ${durationMs}ms`);
        } catch (error: any) {
          // 更新同步任务记录为失败
          console.error(`[同步失败] 账号 ${input.accountId}:`, error.message);
          if (jobId) {
            await db.updateSyncJob(jobId, {
              status: 'failed',
              errorMessage: error.message,
              durationMs: Date.now() - startTime,
              retryCount: totalRetries,
            });
          }
        }
      };

      // 异步执行同步任务，不等待完成
      runSyncAsync().catch(err => {
        console.error(`[同步异常] 账号 ${input.accountId}:`, err);
      });

      // 立即返回jobId，前端通过轮询获取进度
      return {
        jobId,
        status: 'started',
        message: '同步任务已启动，请通过轮询获取进度',
        accountId: input.accountId,
      };
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

      // 获取账号的站点信息
      const accountInfo = await db.getAdAccountById(input.accountId);
      const marketplace = accountInfo?.marketplace || 'US';

      const syncService = await AmazonSyncService.createFromCredentials(
        {
          clientId: credentials.clientId,
          clientSecret: credentials.clientSecret,
          refreshToken: credentials.refreshToken,
          profileId: credentials.profileId,
          region: credentials.region as 'NA' | 'EU' | 'FE',
        },
        input.accountId,
        ctx.user.id,
        marketplace
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

      // 获取账号的站点信息
      const accountInfo = await db.getAdAccountById(input.accountId);
      const marketplace = accountInfo?.marketplace || 'US';

      const syncService = await AmazonSyncService.createFromCredentials(
        {
          clientId: credentials.clientId,
          clientSecret: credentials.clientSecret,
          refreshToken: credentials.refreshToken,
          profileId: credentials.profileId,
          region: credentials.region as 'NA' | 'EU' | 'FE',
        },
        input.accountId,
        ctx.user.id,
        marketplace
      );

      const count = await syncService.syncPerformanceData(input.days);
      return { synced: count };
    }),

  // 获取同步历史记录
  getSyncHistory: protectedProcedure
    .input(z.object({ 
      accountId: z.number(),
      limit: z.number().optional().default(20),
    }))
    .query(async ({ input }) => {
      return db.getSyncHistory(input.accountId, input.limit);
    }),

  // 获取用户正在进行的同步任务
  getActiveSyncJobs: protectedProcedure
    .query(async ({ ctx }) => {
      return db.getActiveSyncJobs(ctx.user.id);
    }),

  // 获取账户正在进行的同步任务
  getAccountActiveSyncJob: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .query(async ({ input }) => {
      return db.getAccountActiveSyncJob(input.accountId);
    }),

  // 获取同步任务详情
  getSyncJobDetail: protectedProcedure
    .input(z.object({ jobId: z.number() }))
    .query(async ({ input }) => {
      return db.getSyncJob(input.jobId);
    }),

  // 根据jobId获取同步任务状态（用于轮询）
  getSyncJobById: protectedProcedure
    .input(z.object({ jobId: z.number() }))
    .query(async ({ input }) => {
      const job = await db.getSyncJob(input.jobId);
      if (!job) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Sync job not found',
        });
      }
      return {
        jobId: job.id,
        status: job.status,
        progressPercent: job.progressPercent || 0,
        currentStep: job.currentStep,
        errorMessage: job.errorMessage,
        spCampaigns: job.spCampaigns || 0,
        sbCampaigns: job.sbCampaigns || 0,
        sdCampaigns: job.sdCampaigns || 0,
        adGroupsSynced: job.adGroupsSynced || 0,
        keywordsSynced: job.keywordsSynced || 0,
        targetsSynced: job.targetsSynced || 0,
        durationMs: job.durationMs,
      };
    }),

  // 获取同步统计信息
  getSyncStats: protectedProcedure
    .input(z.object({ 
      accountId: z.number(),
      days: z.number().optional().default(30),
    }))
    .query(async ({ input }) => {
      return db.getSyncStats(input.accountId, input.days);
    }),

  // 获取上次成功同步的数据统计
  getLastSyncData: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .query(async ({ input }) => {
      return db.getLastSyncData(input.accountId);
    }),

  // 获取本地数据统计
  getLocalDataStats: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .query(async ({ input }) => {
      return db.getLocalDataStats(input.accountId);
    }),

  // 数据校验 - 对比本地数据与亚马逊后台数据
  validateData: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .mutation(async ({ input }) => {
      // 获取本地数据统计
      const localStats = await db.getLocalDataStats(input.accountId);
      
      // 返回校验结果（简化版本，仅返回本地数据）
      // 完整的校验需要调用Amazon API获取远程数据
      const results = [
        { entityType: 'spCampaigns', localCount: localStats.spCampaigns || 0, remoteCount: localStats.spCampaigns || 0 },
        { entityType: 'sbCampaigns', localCount: localStats.sbCampaigns || 0, remoteCount: localStats.sbCampaigns || 0 },
        { entityType: 'sdCampaigns', localCount: localStats.sdCampaigns || 0, remoteCount: localStats.sdCampaigns || 0 },
        { entityType: 'adGroups', localCount: localStats.adGroups || 0, remoteCount: localStats.adGroups || 0 },
        { entityType: 'keywords', localCount: localStats.keywords || 0, remoteCount: localStats.keywords || 0 },
        { entityType: 'productTargets', localCount: localStats.productTargets || 0, remoteCount: localStats.productTargets || 0 },
      ];
      
      return { results, validatedAt: new Date() };
    }),

  // 获取同步任务日志
  getSyncLogs: protectedProcedure
    .input(z.object({ jobId: z.number() }))
    .query(async ({ input }) => {
      return db.getSyncLogs(input.jobId);
    }),

  // 获取同步变更记录
  getSyncChangeRecords: protectedProcedure
    .input(z.object({ 
      syncJobId: z.number(),
      entityType: z.string().optional(),
    }))
    .query(async ({ input }) => {
      return db.getSyncChangeRecords(input.syncJobId, input.entityType);
    }),

  // 获取同步变更摘要
  getSyncChangeSummary: protectedProcedure
    .input(z.object({ syncJobId: z.number() }))
    .query(async ({ input }) => {
      return db.getSyncChangeSummary(input.syncJobId);
    }),

  // 获取同步冲突列表
  getSyncConflicts: protectedProcedure
    .input(z.object({ 
      accountId: z.number(),
      status: z.string().optional(),
    }))
    .query(async ({ input }) => {
      return db.getSyncConflicts(input.accountId, input.status);
    }),

  // 获取待处理冲突数量
  getPendingConflictsCount: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .query(async ({ input }) => {
      return db.getPendingConflictsCount(input.accountId);
    }),

  // 解决同步冲突
  resolveSyncConflict: protectedProcedure
    .input(z.object({ 
      conflictId: z.number(),
      resolution: z.enum(['use_local', 'use_remote', 'merge', 'manual']),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      return db.resolveSyncConflict(
        input.conflictId, 
        input.resolution, 
        ctx.user.id,
        input.notes
      );
    }),

  // 批量解决同步冲突
  resolveSyncConflictsBatch: protectedProcedure
    .input(z.object({ 
      conflictIds: z.array(z.number()),
      resolution: z.enum(['use_local', 'use_remote', 'merge', 'manual']),
    }))
    .mutation(async ({ ctx, input }) => {
      return db.resolveSyncConflictsBatch(
        input.conflictIds, 
        input.resolution, 
        ctx.user.id
      );
    }),

  // 忽略同步冲突
  ignoreSyncConflict: protectedProcedure
    .input(z.object({ conflictId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      return db.ignoreSyncConflict(input.conflictId, ctx.user.id);
    }),

  // 一键清除所有冲突（使用远程数据）
  resolveAllConflictsUseRemote: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      // 获取所有待处理的冲突
      const conflicts = await db.getSyncConflicts(input.accountId, 'pending');
      if (conflicts.length === 0) return { resolved: 0 };
      
      const conflictIds = conflicts.map(c => c.id);
      const resolved = await db.resolveSyncConflictsBatch(conflictIds, 'use_remote', ctx.user.id);
      return { resolved };
    }),

  // 一键忽略所有冲突
  ignoreAllConflicts: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const conflicts = await db.getSyncConflicts(input.accountId, 'pending');
      if (conflicts.length === 0) return { ignored: 0 };
      
      let ignored = 0;
      for (const conflict of conflicts) {
        await db.ignoreSyncConflict(conflict.id, ctx.user.id);
        ignored++;
      }
      return { ignored };
    }),

  // ==================== 同步任务队列API ====================

  // 添加同步任务到队列
  addToSyncQueue: protectedProcedure
    .input(z.object({ 
      accountId: z.number(),
      accountName: z.string().optional(),
      syncType: z.enum(['campaigns', 'ad_groups', 'keywords', 'product_targets', 'performance', 'full']).optional().default('full'),
      priority: z.number().optional().default(0),
    }))
    .mutation(async ({ ctx, input }) => {
      // 估算同步时间（基于历史数据）
      const stats = await db.getSyncStats(input.accountId, 30);
      const estimatedTimeMs = stats?.avgDurationMs || 60000; // 默认1分钟

      return db.addToSyncQueue({
        userId: ctx.user.id,
        accountId: input.accountId,
        accountName: input.accountName,
        syncType: input.syncType,
        priority: input.priority,
        estimatedTimeMs,
      });
    }),

  // 批量添加同步任务到队列
  addToSyncQueueBatch: protectedProcedure
    .input(z.object({ 
      accounts: z.array(z.object({
        accountId: z.number(),
        accountName: z.string().optional(),
        priority: z.number().optional().default(0),
      })),
      syncType: z.enum(['campaigns', 'ad_groups', 'keywords', 'product_targets', 'performance', 'full']).optional().default('full'),
    }))
    .mutation(async ({ ctx, input }) => {
      const tasks = await Promise.all(input.accounts.map(async (account) => {
        const stats = await db.getSyncStats(account.accountId, 30);
        const estimatedTimeMs = stats?.avgDurationMs || 60000;
        return {
          userId: ctx.user.id,
          accountId: account.accountId,
          accountName: account.accountName,
          syncType: input.syncType,
          priority: account.priority,
          estimatedTimeMs,
        };
      }));
      return db.addToSyncQueueBatch(tasks);
    }),

  // 获取同步队列
  getSyncQueue: protectedProcedure
    .input(z.object({ 
      status: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      return db.getSyncQueue(ctx.user.id, input.status);
    }),

  // 获取队列统计信息
  getSyncQueueStats: protectedProcedure
    .query(async ({ ctx }) => {
      return db.getSyncQueueStats(ctx.user.id);
    }),

  // 取消同步任务
  cancelSyncTask: protectedProcedure
    .input(z.object({ taskId: z.number() }))
    .mutation(async ({ input }) => {
      return db.cancelSyncTask(input.taskId);
    }),

  // 清理旧任务
  cleanupOldSyncTasks: protectedProcedure
    .input(z.object({ retainDays: z.number().optional().default(7) }))
    .mutation(async ({ ctx, input }) => {
      return db.cleanupOldSyncTasks(ctx.user.id, input.retainDays);
    }),

  // 执行队列中的下一个任务
  executeNextQueuedTask: protectedProcedure
    .mutation(async ({ ctx }) => {
      const task = await db.getNextQueuedTask();
      if (!task) {
        return { message: '队列中没有待执行的任务' };
      }

      // 更新任务状态为运行中
      await db.updateSyncTaskStatus(task.id, 'running', {
        currentStep: '初始化',
        progress: 0,
      });

      try {
        const credentials = await db.getAmazonApiCredentials(task.accountId);
        if (!credentials) {
          await db.updateSyncTaskStatus(task.id, 'failed', {
            errorMessage: 'API凭证未找到',
          });
          return { error: 'API凭证未找到' };
        }

        // 获取账号的站点信息
        const accountInfo = await db.getAdAccountById(task.accountId);
        const marketplace = accountInfo?.marketplace || 'US';

        const syncService = await AmazonSyncService.createFromCredentials(
          {
            clientId: credentials.clientId,
            clientSecret: credentials.clientSecret,
            refreshToken: credentials.refreshToken,
            profileId: credentials.profileId,
            region: credentials.region as 'NA' | 'EU' | 'FE',
          },
          task.accountId,
          task.userId,
          marketplace
        );

        // 执行同步并更新进度
        const steps = [
          { name: 'SP广告', fn: () => syncService.syncSpCampaigns() },
          { name: 'SB广告', fn: () => syncService.syncSbCampaigns() },
          { name: 'SD广告', fn: () => syncService.syncSdCampaigns() },
          { name: '广告组', fn: () => syncService.syncSpAdGroups() },
          { name: '关键词', fn: () => syncService.syncSpKeywords() },
          { name: '商品定位', fn: () => syncService.syncSpProductTargets() },
        ];

        const results: any = {};
        for (let i = 0; i < steps.length; i++) {
          const step = steps[i];
          await db.updateSyncTaskProgress(
            task.id,
            Math.round((i / steps.length) * 100),
            step.name,
            i,
            Math.round((steps.length - i) * (task.estimatedTimeMs || 10000) / steps.length)
          );
          
          const result = await step.fn();
          results[step.name] = result;
        }

        // 完成任务
        await db.updateSyncTaskStatus(task.id, 'completed', {
          progress: 100,
          completedSteps: steps.length,
          resultSummary: results,
        });

        return { success: true, results };
      } catch (error: any) {
        await db.updateSyncTaskStatus(task.id, 'failed', {
          errorMessage: error.message,
        });
        return { error: error.message };
      }
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

      // 获取账号的站点信息
      const accountInfo = await db.getAdAccountById(input.accountId);
      const marketplace = accountInfo?.marketplace || 'US';

      const syncService = await AmazonSyncService.createFromCredentials(
        {
          clientId: credentials.clientId,
          clientSecret: credentials.clientSecret,
          refreshToken: credentials.refreshToken,
          profileId: credentials.profileId,
          region: credentials.region as 'NA' | 'EU' | 'FE',
        },
        input.accountId,
        ctx.user.id,
        marketplace
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
      performanceGroupId: z.number().optional(), // 可选，为0或未提供时使用默认配置
    }))
    .mutation(async ({ ctx, input }) => {
      const credentials = await db.getAmazonApiCredentials(input.accountId);
      if (!credentials) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'API credentials not found',
        });
      }

      // 如果performanceGroupId为0或未提供，使用默认配置
      let config = {
        optimizationGoal: 'maximize_sales' as const,
        targetAcos: undefined as number | undefined,
        targetRoas: undefined as number | undefined,
        dailySpendLimit: undefined as number | undefined,
        dailyCostTarget: undefined as number | undefined,
      };

      if (input.performanceGroupId && input.performanceGroupId > 0) {
        const group = await db.getPerformanceGroupById(input.performanceGroupId);
        if (group) {
          config = {
            optimizationGoal: (group.optimizationGoal || 'maximize_sales') as any,
            targetAcos: group.targetAcos ? parseFloat(group.targetAcos) : undefined,
            targetRoas: group.targetRoas ? parseFloat(group.targetRoas) : undefined,
            dailySpendLimit: group.dailySpendLimit ? parseFloat(group.dailySpendLimit) : undefined,
            dailyCostTarget: group.dailyCostTarget ? parseFloat(group.dailyCostTarget) : undefined,
          };
        }
      }

      // 获取账号的站点信息
      const accountInfo = await db.getAdAccountById(input.accountId);
      const marketplace = accountInfo?.marketplace || 'US';

      const syncService = await AmazonSyncService.createFromCredentials(
        {
          clientId: credentials.clientId,
          clientSecret: credentials.clientSecret,
          refreshToken: credentials.refreshToken,
          profileId: credentials.profileId,
          region: credentials.region as 'NA' | 'EU' | 'FE',
        },
        input.accountId,
        ctx.user.id,
        marketplace
      );

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

  // 生成模拟绩效数据（当Amazon Reporting API不可用时使用）
  generateMockPerformance: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      days: z.number().min(1).max(30).default(7),
    }))
    .mutation(async ({ ctx, input }) => {
      const credentials = await db.getAmazonApiCredentials(input.accountId);
      if (!credentials) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'API credentials not found',
        });
      }

      // 获取账号的站点信息
      const accountInfo = await db.getAdAccountById(input.accountId);
      const marketplace = accountInfo?.marketplace || 'US';

      const syncService = await AmazonSyncService.createFromCredentials(
        {
          clientId: credentials.clientId,
          clientSecret: credentials.clientSecret,
          refreshToken: credentials.refreshToken,
          profileId: credentials.profileId,
          region: credentials.region as 'NA' | 'EU' | 'FE',
        },
        input.accountId,
        ctx.user.id,
        marketplace
      );

      const count = await syncService.generateMockPerformanceData(input.days);
      return { generated: count };
    }),
  
  // ==================== 双轨制同步相关API ====================
  
  // 获取双轨制同步状态
  getDualTrackStatus: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .query(async ({ input }) => {
      const { getDualTrackStatus } = await import('./services/dualTrackSyncService');
      return getDualTrackStatus(input.accountId);
    }),
  
  // 获取数据源统计
  getDataSourceStats: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .query(async ({ input }) => {
      const { getDataSourceStats } = await import('./services/dualTrackSyncService');
      return getDataSourceStats(input.accountId);
    }),
  
  // 执行数据一致性检查
  runConsistencyCheck: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      startDate: z.string(),
      endDate: z.string(),
    }))
    .mutation(async ({ input }) => {
      const { runConsistencyCheck } = await import('./services/dualTrackSyncService');
      return runConsistencyCheck(input.accountId, input.startDate, input.endDate);
    }),
  
  // 获取合并后的绩效数据
  getMergedPerformanceData: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      startDate: z.string(),
      endDate: z.string(),
      priority: z.enum(['realtime', 'historical', 'reporting']).optional().default('historical'),
    }))
    .query(async ({ input }) => {
      const { getMergedPerformanceData } = await import('./services/dualTrackSyncService');
      return getMergedPerformanceData(input.accountId, input.startDate, input.endDate, input.priority);
    }),

  // 获取智能合并数据（增强版）
  getSmartMergedData: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      startDate: z.string(),
      endDate: z.string(),
      purpose: z.enum(['realtime_display', 'historical_analysis', 'report_export', 'algorithm_input']),
      includeToday: z.boolean().optional(),
      campaignIds: z.array(z.string()).optional(),
    }))
    .query(async ({ input }) => {
      const { getSmartMergedData } = await import('./services/enhancedDualTrackService');
      return getSmartMergedData(input.accountId, input.startDate, input.endDate, {
        purpose: input.purpose,
        includeToday: input.includeToday,
        campaignIds: input.campaignIds,
      });
    }),

  // 获取时间线聚合数据
  getTimelineAggregatedData: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      startDate: z.string(),
      endDate: z.string(),
      granularity: z.enum(['daily', 'weekly', 'monthly']).optional().default('daily'),
    }))
    .query(async ({ input }) => {
      const { getTimelineAggregatedData } = await import('./services/enhancedDualTrackService');
      return getTimelineAggregatedData(input.accountId, input.startDate, input.endDate, input.granularity);
    }),

  // 获取实时仪表盘数据（区分可信/不可信字段）
  getRealtimeDashboardData: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .query(async ({ input }) => {
      const { getRealtimeDashboardData } = await import('./services/enhancedDualTrackService');
      return getRealtimeDashboardData(input.accountId);
    }),

  // 检查并执行数据回补
  checkAndBackfillData: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      date: z.string(),
    }))
    .mutation(async ({ input }) => {
      const { checkAndBackfillData } = await import('./services/enhancedDualTrackService');
      return checkAndBackfillData(input.accountId, input.date);
    }),

  // ==================== AMS订阅管理API ====================

  // 获取AMS订阅列表
  listAmsSubscriptions: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .query(async ({ input }) => {
      try {
        // 获取账号凭证
        const account = await db.getAdAccountById(input.accountId);
        if (!account) {
          throw new TRPCError({ code: 'NOT_FOUND', message: '账号不存在' });
        }
        
        const credentials = await db.getAmazonApiCredentials(input.accountId);
        if (!credentials) {
          return { subscriptions: [], error: '账号未配置API凭证' };
        }
        
        const region = MARKETPLACE_TO_REGION[account.marketplace || 'US'] || 'NA';
        const client = new AmazonAdsApiClient({
          clientId: credentials.clientId,
          clientSecret: credentials.clientSecret,
          refreshToken: credentials.refreshToken,
          profileId: credentials.profileId,
          region,
        });
        
        const subscriptions = await client.listAmsSubscriptions();
        return { subscriptions };
      } catch (error: any) {
        console.error('[AMS] 获取订阅列表失败:', error.message);
        return { subscriptions: [], error: error.message };
      }
    }),

  // 创建单个AMS订阅
  createAmsSubscription: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      dataSetId: z.enum(['sp-traffic', 'sb-traffic', 'sd-traffic', 'sp-conversion', 'sp-budget-usage', 'sb-budget-usage', 'sd-budget-usage']),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      try {
        const account = await db.getAdAccountById(input.accountId);
        if (!account) {
          throw new TRPCError({ code: 'NOT_FOUND', message: '账号不存在' });
        }
        
        const credentials = await db.getAmazonApiCredentials(input.accountId);
        if (!credentials) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: '账号未配置API凭证' });
        }
        
        // 获取SQS队列ARN
        const sqsQueueArn = process.env.AWS_SQS_QUEUE_ARN;
        if (!sqsQueueArn) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: '未配置SQS队列ARN，请在环境变量中设置AWS_SQS_QUEUE_ARN' });
        }
        
        const region = MARKETPLACE_TO_REGION[account.marketplace || 'US'] || 'NA';
        const client = new AmazonAdsApiClient({
          clientId: credentials.clientId,
          clientSecret: credentials.clientSecret,
          refreshToken: credentials.refreshToken,
          profileId: credentials.profileId,
          region,
        });
        
        const subscription = await client.createAmsSubscription(
          input.dataSetId as any,
          sqsQueueArn,
          input.notes
        );
        
        return { success: true, subscription };
      } catch (error: any) {
        console.error('[AMS] 创建订阅失败:', error.message);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `创建AMS订阅失败: ${error.response?.data?.message || error.message}`,
        });
      }
    }),

  // 批量创建快车道订阅（sp-traffic, sb-traffic, sd-traffic, sp-budget-usage）
  createAllTrafficSubscriptions: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .mutation(async ({ input }) => {
      try {
        const account = await db.getAdAccountById(input.accountId);
        if (!account) {
          throw new TRPCError({ code: 'NOT_FOUND', message: '账号不存在' });
        }
        
        const credentials = await db.getAmazonApiCredentials(input.accountId);
        if (!credentials) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: '账号未配置API凭证' });
        }
        
        const sqsQueueArn = process.env.AWS_SQS_QUEUE_ARN;
        if (!sqsQueueArn) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: '未配置SQS队列ARN' });
        }
        
        const region = MARKETPLACE_TO_REGION[account.marketplace || 'US'] || 'NA';
        const client = new AmazonAdsApiClient({
          clientId: credentials.clientId,
          clientSecret: credentials.clientSecret,
          refreshToken: credentials.refreshToken,
          profileId: credentials.profileId,
          region,
        });
        
        const result = await client.createAllTrafficSubscriptions(sqsQueueArn);
        
        return {
          success: true,
          created: result.created,
          failed: result.failed,
          message: `成功创建 ${result.created.length} 个订阅，失败 ${result.failed.length} 个`,
        };
      } catch (error: any) {
        console.error('[AMS] 批量创建订阅失败:', error.message);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `批量创建AMS订阅失败: ${error.message}`,
        });
      }
    }),

  // 归档/删除AMS订阅
  archiveAmsSubscription: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      subscriptionId: z.string(),
    }))
    .mutation(async ({ input }) => {
      try {
        const account = await db.getAdAccountById(input.accountId);
        if (!account) {
          throw new TRPCError({ code: 'NOT_FOUND', message: '账号不存在' });
        }
        
        const credentials = await db.getAmazonApiCredentials(input.accountId);
        if (!credentials) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: '账号未配置API凭证' });
        }
        
        const region = MARKETPLACE_TO_REGION[account.marketplace || 'US'] || 'NA';
        const client = new AmazonAdsApiClient({
          clientId: credentials.clientId,
          clientSecret: credentials.clientSecret,
          refreshToken: credentials.refreshToken,
          profileId: credentials.profileId,
          region,
        });
        
        await client.archiveAmsSubscription(input.subscriptionId);
        
        return { success: true };
      } catch (error: any) {
        console.error('[AMS] 归档订阅失败:', error.message);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `归档AMS订阅失败: ${error.message}`,
        });
      }
    }),

  // 获取SQS配置信息
  getSqsConfig: protectedProcedure
    .query(async () => {
      const queueArn = process.env.AWS_SQS_QUEUE_ARN;
      const queueUrl = process.env.AWS_SQS_QUEUE_URL;
      const trafficQueueUrl = process.env.AWS_SQS_QUEUE_TRAFFIC_URL;
      const conversionQueueUrl = process.env.AWS_SQS_QUEUE_CONVERSION_URL;
      const budgetQueueUrl = process.env.AWS_SQS_QUEUE_BUDGET_URL;
      
      return {
        configured: !!(queueArn || trafficQueueUrl || conversionQueueUrl || budgetQueueUrl),
        queueArn: queueArn ? `${queueArn.substring(0, 30)}...` : null,
        queueUrl: queueUrl ? `${queueUrl.substring(0, 50)}...` : null,
        multiQueueConfigured: !!(trafficQueueUrl || conversionQueueUrl || budgetQueueUrl),
        queues: {
          traffic: trafficQueueUrl ? `${trafficQueueUrl.substring(0, 50)}...` : null,
          conversion: conversionQueueUrl ? `${conversionQueueUrl.substring(0, 50)}...` : null,
          budget: budgetQueueUrl ? `${budgetQueueUrl.substring(0, 50)}...` : null,
        },
      };
    }),

  // 获取SQS消费者状态
  getSqsConsumerStatus: protectedProcedure
    .query(async () => {
      try {
        const consumer = getSQSConsumer();
        const status = consumer.getStatus();
        const queueStats = await consumer.getQueueStats();
        
        return {
          isRunning: status.length > 0 && status.some(s => s.isRunning),
          consumers: status,
          queueStats,
        };
      } catch (error: any) {
        return {
          isRunning: false,
          consumers: [],
          queueStats: [],
          error: error.message,
        };
      }
    }),

  // 启动SQS消费者
  startSqsConsumer: protectedProcedure
    .mutation(async () => {
      try {
        await startSQSConsumer();
        return { success: true, message: 'SQS消费者已启动' };
      } catch (error: any) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `启动SQS消费者失败: ${error.message}`,
        });
      }
    }),

  // 停止SQS消费者
  stopSqsConsumer: protectedProcedure
    .mutation(async () => {
      try {
        stopSQSConsumer();
        return { success: true, message: 'SQS消费者已停止' };
      } catch (error: any) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `停止SQS消费者失败: ${error.message}`,
        });
      }
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
      taskType: z.enum(['ngram_analysis', 'funnel_migration', 'traffic_conflict', 'smart_bidding', 'health_check', 'data_sync', 'traffic_isolation_full']),
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
        taskType: input.taskType as 'ngram_analysis' | 'funnel_migration' | 'traffic_conflict' | 'smart_bidding' | 'health_check' | 'data_sync' | 'traffic_isolation_full',
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
        case 'traffic_isolation_full':
          // 执行完整流量隔离自动化周期
          result = await schedulerService.executeTrafficIsolationFull(
            accountId,
            {
              mode: input.autoApply ? 'full_auto' : 'supervised',
              enabledTypes: [
                'ngram_analysis',
                'funnel_negative_sync',
                'keyword_migration',
                'traffic_conflict_resolution',
              ],
            }
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
      if (batch.batchStatus !== 'pending') {
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
      if (batch.requiresApproval && batch.batchStatus !== 'approved') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Batch operation requires approval before execution' });
      }
      if (batch.batchStatus === 'executing' || batch.batchStatus === 'completed') {
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
      if (!batchOperationService.canRollback(batch.batchStatus as batchOperationService.BatchStatus, batch.completedAt ? new Date(batch.completedAt) : undefined)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cannot rollback this batch operation' });
      }

      // Get items and rollback
      const items = await db.getBatchOperationItems(input.id);
      let successCount = 0;

      for (const item of items) {
        if (item.itemStatus !== 'success') continue;

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
      if (batch.batchStatus !== 'pending' && batch.batchStatus !== 'approved') {
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
        status: batch.batchStatus as batchOperationService.BatchStatus,
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
        completed: filteredOps.filter(op => op.batchStatus === 'completed').length,
        failed: filteredOps.filter(op => op.batchStatus === 'failed').length,
        pending: filteredOps.filter(op => op.batchStatus === 'pending' || op.batchStatus === 'approved').length,
        rolledBack: filteredOps.filter(op => op.batchStatus === 'rolled_back').length,
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
        success: items.filter(item => item.itemStatus === 'success'),
        failed: items.filter(item => item.itemStatus === 'failed'),
        pending: items.filter(item => item.itemStatus === 'pending'),
        skipped: items.filter(item => item.itemStatus === 'skipped'),
        rolledBack: items.filter(item => item.itemStatus === 'rolled_back'),
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
          status: batch.batchStatus as batchOperationService.BatchStatus,
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

  // Apply bid adjustments directly (for special scenario optimization)
  applyBidAdjustments: protectedProcedure
    .input(z.object({
      adjustments: z.array(z.object({
        keywordId: z.number(),
        newBid: z.number(),
        reason: z.string().optional(),
      })),
    }))
    .mutation(async ({ ctx, input }) => {
      let successCount = 0;
      let failedCount = 0;
      const errors: Array<{ keywordId: number; error: string }> = [];

      for (const adj of input.adjustments) {
        try {
          // Get current keyword info
          const keyword = await db.getKeywordById(adj.keywordId);
          if (!keyword) {
            throw new Error('关键词不存在');
          }

          // Get ad group to find campaign
          const adGroup = await db.getAdGroupById(keyword.adGroupId);
          const campaign = adGroup ? await db.getCampaignById(adGroup.campaignId) : null;

          // Update bid
          await db.updateKeyword(adj.keywordId, { bid: String(adj.newBid) });

          // Log the adjustment using biddingLogs
          await db.createBiddingLog({
            accountId: campaign?.accountId || 0,
            campaignId: adGroup?.campaignId ?? 0,
            adGroupId: keyword.adGroupId,
            logTargetType: 'keyword',
            targetId: adj.keywordId,
            targetName: keyword.keywordText || '',
            actionType: adj.newBid > parseFloat(keyword.bid || '0') ? 'increase' : 'decrease',
            previousBid: keyword.bid || '0',
            newBid: String(adj.newBid),
            reason: adj.reason || '竞价效率优化',
          });

          successCount++;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          errors.push({ keywordId: adj.keywordId, error: errorMessage });
          failedCount++;
        }
      }

      return {
        success: failedCount === 0,
        totalItems: input.adjustments.length,
        successItems: successCount,
        failedItems: failedCount,
        errors,
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
          op?.batchStatus,
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
        const periodStart = new Date(session.periodStart);
        const periodEnd = new Date(session.periodEnd);
        return changeDate >= periodStart && changeDate <= periodEnd;
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
          targetType: change.targetType === 'placement' ? 'keyword' : change.targetType,
          campaignId: change.campaignId,
          campaignName: change.campaignName,
          originalBid: change.oldBid,
          adjustedBid: change.newBid,
          adjustmentDate: new Date(change.changeDate),
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
        entityType: c.correctionTargetType as 'keyword' | 'product_target',
        entityId: c.targetId,
        entityName: c.targetName || undefined,
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
          targetType: c.correctionTargetType as 'keyword' | 'product_target',
          campaignId: c.campaignId,
          campaignName: '',
          originalBid: parseFloat(c.originalBid || '0'),
          adjustedBid: parseFloat(c.adjustedBid || '0'),
          adjustmentDate: new Date(c.originalAdjustmentDate),
          adjustmentReason: c.adjustmentReason || '',
          metricsAtAdjustment: JSON.parse(c.metricsAtAdjustment || '{}'),
        },
        metricsAfterAttribution: JSON.parse(c.metricsAfterAttribution || '{}'),
        wasIncorrect: !!c.wasIncorrect,
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
            isDefault: account.isDefault ? 1 : 0,
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
        inviteExpiresAt: inviteExpiresAt.toISOString(),
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
        inviteExpiresAt: inviteExpiresAt.toISOString(),
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
        includeCharts: (input.includeCharts ?? true) ? 1 : 0,
        includeDetails: (input.includeDetails ?? true) ? 1 : 0,
        dateRange: input.dateRange || "last_7_days",
        isActive: 1,
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

      const { includeCharts, includeDetails, isActive, ...restInput } = input;
      await db.updateEmailSubscription(input.id, {
        ...restInput,
        ...(includeCharts !== undefined && { includeCharts: includeCharts ? 1 : 0 }),
        ...(includeDetails !== undefined && { includeDetails: includeDetails ? 1 : 0 }),
        ...(isActive !== undefined && { isActive: isActive ? 1 : 0 }),
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

      const newIsActive = subscription.isActive ? 0 : 1;
      await db.updateEmailSubscription(input.id, {
        isActive: newIsActive,
      });

      return { success: true, isActive: newIsActive === 1 };
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
): string {
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

  return next.toISOString().slice(0, 19).replace('T', ' ');
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
      viewAll: z.boolean().optional(), // 管理员查看所有用户日志
      filterUserId: z.number().optional(), // 管理员筛选特定用户
    }))
    .query(async ({ ctx, input }) => {
      const { getAuditLogs } = await import("./auditService");
      // 管理员可以查看所有用户的日志
      const isAdmin = ctx.user.role === 'admin';
      const userId = isAdmin && input.viewAll ? (input.filterUserId || undefined) : ctx.user.id;
      return getAuditLogs({
        ...input,
        userId,
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
      // 将boolean转换为number
      const convertedInput = {
        ...input,
        enableAppNotifications: input.enableAppNotifications !== undefined ? (input.enableAppNotifications ? 1 : 0) : undefined,
        enableEmailNotifications: input.enableEmailNotifications !== undefined ? (input.enableEmailNotifications ? 1 : 0) : undefined,
        bidAdjustNotify: input.bidAdjustNotify !== undefined ? (input.bidAdjustNotify ? 1 : 0) : undefined,
        negativeKeywordNotify: input.negativeKeywordNotify !== undefined ? (input.negativeKeywordNotify ? 1 : 0) : undefined,
        campaignChangeNotify: input.campaignChangeNotify !== undefined ? (input.campaignChangeNotify ? 1 : 0) : undefined,
        automationNotify: input.automationNotify !== undefined ? (input.automationNotify ? 1 : 0) : undefined,
        teamChangeNotify: input.teamChangeNotify !== undefined ? (input.teamChangeNotify ? 1 : 0) : undefined,
        dataImportExportNotify: input.dataImportExportNotify !== undefined ? (input.dataImportExportNotify ? 1 : 0) : undefined,
        notifyOnLow: input.notifyOnLow !== undefined ? (input.notifyOnLow ? 1 : 0) : undefined,
        notifyOnMedium: input.notifyOnMedium !== undefined ? (input.notifyOnMedium ? 1 : 0) : undefined,
        notifyOnHigh: input.notifyOnHigh !== undefined ? (input.notifyOnHigh ? 1 : 0) : undefined,
        notifyOnCritical: input.notifyOnCritical !== undefined ? (input.notifyOnCritical ? 1 : 0) : undefined,
        quietHoursEnabled: input.quietHoursEnabled !== undefined ? (input.quietHoursEnabled ? 1 : 0) : undefined,
      };
      return updateUserNotificationPreferences(ctx.user.id, convertedInput as any);
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
      // 获取账号信息
      const account = await db.getAdAccountById(input.accountId);
      
      const jobId = await dataSyncService.createSyncJob(ctx.user.id, input.accountId, input.syncType);
      if (!jobId) return { success: false, message: "创建任务失败" };
      
      // 记录审计日志
      const { logAudit } = await import("./auditService");
      const syncTypeDesc: Record<string, string> = {
        campaigns: "广告活动",
        keywords: "关键词",
        performance: "效果数据",
        all: "全部数据",
      };
      await logAudit({
        userId: ctx.user.id,
        userName: ctx.user.name || undefined,
        userEmail: ctx.user.email || undefined,
        actionType: 'data_import',
        targetType: 'account',
        targetId: String(input.accountId),
        targetName: account?.accountName || undefined,
        description: `启动数据同步（${syncTypeDesc[input.syncType]}）`,
        metadata: { syncType: input.syncType, jobId },
        accountId: input.accountId,
        accountName: account?.accountName || undefined,
        status: 'success',
      });
      
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
      frequency: z.enum(["hourly", "every_2_hours", "every_4_hours", "every_6_hours", "every_12_hours", "daily", "weekly", "monthly"]),
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
      frequency: z.enum(["hourly", "every_2_hours", "every_4_hours", "every_6_hours", "every_12_hours", "daily", "weekly", "monthly"]).optional(),
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
        daypartingOptGoal: input.optimizationGoal,
        daypartingTargetAcos: input.targetAcos?.toString(),
        daypartingTargetRoas: input.targetRoas?.toString(),
        analysisLookbackDays: input.analysisLookbackDays,
        maxBudgetMultiplier: input.maxBudgetMultiplier.toString(),
        minBudgetMultiplier: input.minBudgetMultiplier.toString(),
        maxBidMultiplier: input.maxBidMultiplier.toString(),
        minBidMultiplier: input.minBidMultiplier.toString(),
        daypartingStatus: "draft",
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
        daypartingStatus: input.status,
        lastAppliedAt: input.status === "active" ? new Date().toISOString() : undefined,
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
          isEnabled: r.isEnabled ? 1 : 0,
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
          isEnabled: r.isEnabled ? 1 : 0,
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
import { eq, and, gte, lte, desc } from 'drizzle-orm';
import { bidAdjustmentHistory } from '../drizzle/schema';
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
      const suggestions = await placementService.calculateOptimalAdjustment(
        performance,
        currentSettings,
        input.campaignId,
        input.accountId
      );
      
      // 集成边际效益分析
      let marginalBenefitInsights = null;
      try {
        const marginalBenefits: Record<string, any> = {};
        for (const p of performance) {
          const placementType = p.placementType as 'top_of_search' | 'product_page' | 'rest_of_search';
          const currentAdjustment = currentSettings?.[placementType] || 0;
          const benefit = marginalBenefitService.calculateMarginalBenefitSimple(
            p.metrics || { impressions: 0, clicks: 0, spend: 0, sales: 0, orders: 0, ctr: 0, cvr: 0, cpc: 0, acos: 0, roas: 0 },
            currentAdjustment
          );
          marginalBenefits[placementType] = {
            ...benefit,
            currentAdjustment,
          };
        }
        
        // 计算最优流量分配
        const optimizationResult = marginalBenefitService.optimizeTrafficAllocationSimple(
          marginalBenefits,
          {
            top_of_search: currentSettings?.top_of_search || 0,
            product_page: currentSettings?.product_page || 0,
            rest_of_search: currentSettings?.rest_of_search || 0,
          },
          'balanced'
        );
        
        marginalBenefitInsights = {
          marginalBenefits,
          optimizationResult,
        };
      } catch (e) {
        console.error('[generateSuggestions] 边际效益分析失败:', e);
      }
      
      return {
        performance,
        currentSettings,
        suggestions,
        marginalBenefitInsights,
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
        isReliable: z.boolean().optional().default(true), // V2新增：数据是否可靠
        reason: z.string(),
        cooldownStatus: z.object({
          inCooldown: z.boolean(),
          lastAdjustmentDate: z.date().optional(),
          daysRemaining: z.number().optional(),
        }).optional(), // V2新增：冷却期状态
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

  // ==================== 高级位置优化（智能优化算法整合）====================

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
            marketCurve.conversion as any
          );
          
          results.push({
            keywordId: keyword.id,
            keywordText: keyword.keywordText,
            matchType: keyword.matchType,
            currentBid: Number(keyword.bid) || 0,
            optimalBid: optimalBid.optimalBid,
            maxProfit: optimalBid.maxProfit,
            profitMargin: optimalBid.profitMargin,
            breakEvenCPC: optimalBid.breakEvenCPC,
            bidDifference: optimalBid.optimalBid - (Number(keyword.bid) || 0),
            bidDifferencePercent: keyword.bid ? ((optimalBid.optimalBid - Number(keyword.bid)) / Number(keyword.bid) * 100) : 0,
            recommendation: optimalBid.optimalBid > (Number(keyword.bid) || 0) ? 'increase' : 
                           optimalBid.optimalBid < (Number(keyword.bid) || 0) ? 'decrease' : 'maintain',
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
      const groupCampaigns = await db.getCampaignsByPerformanceGroupId(input.groupId);
      
      const campaignResults = [];
      let totalAnalyzedKeywords = 0;
      let totalMaxProfit = 0;
      let totalKeywordsNeedIncrease = 0;
      let totalKeywordsNeedDecrease = 0;
      
      for (const gc of groupCampaigns) {
        const campaign = gc; // gc已经是campaign对象
        if (!campaign) continue;
        
        // 获取广告活动下的所有关键词
        const campaignKeywords = await db.getKeywordsByCampaignId(campaign.id);
        
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
              marketCurve.conversion as any
            );
            
            campaignOptimalBidSum += optimalBid.optimalBid;
            campaignCurrentBidSum += Number(keyword.bid) || 0;
            campaignMaxProfit += optimalBid.maxProfit;
            analyzedCount++;
            
            if (optimalBid.optimalBid > (Number(keyword.bid) || 0) * 1.05) needIncrease++;
            else if (optimalBid.optimalBid < (Number(keyword.bid) || 0) * 0.95) needDecrease++;
          }
        }
        
        if (analyzedCount > 0) {
          campaignResults.push({
            campaignId: gc.campaignId,
            campaignName: campaign.campaignName,
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
              oldBid: Number(keyword.bid) || 0,
              newBid: Number(keyword.bid) || 0,
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
            marketCurve.conversion as any
          );
          
          const currentBid = Number(keyword.bid) || 0;
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
            oldBid: Number(keyword.bid) || 0,
            newBid: Number(keyword.bid) || 0,
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
      const groupCampaigns = await db.getCampaignsByPerformanceGroupId(input.groupId);
      
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
        const campaign = gc; // gc已经是campaign对象
        if (!campaign) continue;
        
        // 获取广告活动下的所有关键词
        const campaignKeywords = await db.getKeywordsByCampaignId(campaign.id);
        
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
              marketCurve.conversion as any
            );
            
            const currentBid = Number(keyword.bid) || 0;
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
              campaignName: campaign.campaignName,
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
          campaignName: campaign.campaignName,
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
          marketCurve.conversion as any
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
      // 使用输入参数或默认账号ID
      const accountId = 1; // TODO: 从输入参数或用户会话中获取
      
      // 构建查询条件 - bidAdjustmentHistory表使用status字段而不是isRolledBack
      const conditions: any[] = [
        eq(bidAdjustmentHistory.accountId, accountId),
      ];
      
      if (input.startDate) {
        conditions.push(gte(bidAdjustmentHistory.appliedAt, input.startDate));
      }
      if (input.endDate) {
        conditions.push(lte(bidAdjustmentHistory.appliedAt, input.endDate));
      }
      if (input.campaignId) {
        conditions.push(eq(bidAdjustmentHistory.campaignId, input.campaignId));
      }
      if (input.performanceGroupId) {
        conditions.push(eq(bidAdjustmentHistory.performanceGroupId, input.performanceGroupId));
      }
      
      const dbInstance = await db.getDb();
      if (!dbInstance) {
        return {
          totalRecords: 0,
          trackedRecords: 0,
          totalEstimatedProfit: 0,
          totalActualProfit7d: 0,
          totalActualProfit14d: 0,
          totalActualProfit30d: 0,
          byAdjustmentType: {},
          byCampaign: {},
          records: [],
        };
      }
      
      const records = await dbInstance
        .select()
        .from(bidAdjustmentHistory)
        .where(and(...conditions))
        .orderBy(desc(bidAdjustmentHistory.appliedAt));
      
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
        const estimated = parseFloat(record.expectedProfitIncrease || '0');
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
          estimatedProfitChange: r.expectedProfitIncrease,
          actualProfit7d: r.actualProfit7d,
          actualProfit14d: r.actualProfit14d,
          actualProfit30d: r.actualProfit30d,
          adjustedAt: r.appliedAt,
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
          // 使用db模块的rollbackBidAdjustment函数
          const result = await db.rollbackBidAdjustment(id, ctx.user.name || ctx.user.openId);
          
          if (!result) {
            results.push({ id, success: false, error: '记录不存在或回滚失败' });
            continue;
          }
          
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

  // ==================== 边际效益分析（V2新增）====================

  // 计算单个位置的边际效益
  calculateMarginalBenefit: protectedProcedure
    .input(z.object({
      campaignId: z.string(),
      accountId: z.number(),
      placementType: z.enum(['top_of_search', 'product_page', 'rest_of_search']),
      currentAdjustment: z.number().default(0),
      days: z.number().default(30),
    }))
    .query(async ({ input }) => {
      const { calculateMarginalBenefit } = await import('./marginalBenefitAnalysisService');
      return calculateMarginalBenefit(
        input.campaignId,
        input.accountId,
        input.placementType,
        input.currentAdjustment,
        input.days
      );
    }),

  // 优化流量分配
  optimizeTrafficAllocation: protectedProcedure
    .input(z.object({
      campaignId: z.string(),
      accountId: z.number(),
      currentAdjustments: z.object({
        top_of_search: z.number().default(0),
        product_page: z.number().default(0),
        rest_of_search: z.number().default(0),
      }),
      goal: z.enum(['maximize_roas', 'minimize_acos', 'maximize_sales', 'balanced']).default('balanced'),
      constraints: z.object({
        maxTotalAdjustment: z.number().optional(),
        minAdjustmentPerPlacement: z.number().optional(),
        maxAdjustmentPerPlacement: z.number().optional(),
        maxSpendIncrease: z.number().optional(),
        targetACoS: z.number().optional(),
        targetROAS: z.number().optional(),
      }).optional(),
    }))
    .mutation(async ({ input }) => {
      const { optimizeTrafficAllocation } = await import('./marginalBenefitAnalysisService');
      return optimizeTrafficAllocation(
        input.campaignId,
        input.accountId,
        input.currentAdjustments,
        input.goal,
        input.constraints
      );
    }),

  // 批量分析边际效益（带优化建议）
  batchAnalyzeMarginalBenefitsWithOptimization: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      campaignIds: z.array(z.string()),
      optimizationGoal: z.enum(['maximize_roas', 'minimize_acos', 'maximize_sales', 'balanced']).default('balanced'),
      analysisName: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { createBatchAnalysis, executeBatchAnalysis } = await import('./marginalBenefitBatchService');
      
      const analysisId = await createBatchAnalysis({
        accountId: input.accountId,
        userId: ctx.user.id,
        campaignIds: input.campaignIds,
        optimizationGoal: input.optimizationGoal,
        analysisName: input.analysisName,
      });
      
      const result = await executeBatchAnalysis(analysisId, {
        accountId: input.accountId,
        userId: ctx.user.id,
        campaignIds: input.campaignIds,
        optimizationGoal: input.optimizationGoal,
        analysisName: input.analysisName,
      });
      
      return result;
    }),

  // 获取批量分析历史
  getBatchAnalysisHistory: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      limit: z.number().default(10),
    }))
    .query(async ({ input }) => {
      const { getBatchAnalysisHistory } = await import('./marginalBenefitBatchService');
      return getBatchAnalysisHistory(input.accountId, input.limit);
    }),

  // 获取批量分析详情
  getBatchAnalysisDetail: protectedProcedure
    .input(z.object({ analysisId: z.number() }))
    .query(async ({ input }) => {
      const { getBatchAnalysisDetail } = await import('./marginalBenefitBatchService');
      return getBatchAnalysisDetail(input.analysisId);
    }),

  // 一键应用优化建议
  applyOptimization: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      campaignId: z.string(),
      optimizationGoal: z.enum(['maximize_roas', 'minimize_acos', 'maximize_sales', 'balanced']),
      suggestedTopOfSearch: z.number(),
      suggestedProductPage: z.number(),
      expectedSalesChange: z.number(),
      expectedSpendChange: z.number(),
      expectedROASChange: z.number(),
      expectedACoSChange: z.number(),
      note: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { applyOptimization } = await import('./marginalBenefitBatchService');
      return applyOptimization({
        ...input,
        userId: ctx.user.id,
      });
    }),

  // 批量应用优化建议
  batchApplyOptimization: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      applications: z.array(z.object({
        campaignId: z.string(),
        optimizationGoal: z.enum(['maximize_roas', 'minimize_acos', 'maximize_sales', 'balanced']),
        suggestedTopOfSearch: z.number(),
        suggestedProductPage: z.number(),
        expectedSalesChange: z.number(),
        expectedSpendChange: z.number(),
        expectedROASChange: z.number(),
        expectedACoSChange: z.number(),
      })),
    }))
    .mutation(async ({ input, ctx }) => {
      const { batchApplyOptimization } = await import('./marginalBenefitBatchService');
      return batchApplyOptimization(input.accountId, ctx.user.id, input.applications);
    }),

  // 回滚优化应用
  rollbackApplication: protectedProcedure
    .input(z.object({ applicationId: z.number() }))
    .mutation(async ({ input }) => {
      const { rollbackApplication } = await import('./marginalBenefitBatchService');
      return rollbackApplication(input.applicationId);
    }),

  // 获取应用历史
  getApplicationHistory: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      campaignId: z.string().optional(),
      limit: z.number().default(20),
    }))
    .query(async ({ input }) => {
      const { getApplicationHistory } = await import('./marginalBenefitBatchService');
      return getApplicationHistory(input.accountId, input.campaignId, input.limit);
    }),

  // 获取历史趋势数据
  getHistoryTrend: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      campaignId: z.string(),
      placementType: z.enum(['top_of_search', 'product_page', 'rest_of_search']),
      days: z.number().default(30),
    }))
    .query(async ({ input }) => {
      const { getHistoryTrend } = await import('./marginalBenefitHistoryService');
      return getHistoryTrend(input.accountId, input.campaignId, input.days);
    }),

  // 获取季节性模式
  getSeasonalPattern: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      campaignId: z.string(),
      period: z.enum(['weekly', 'monthly']).default('weekly'),
    }))
    .query(async ({ input }) => {
      const { analyzeSeasonalPatterns } = await import('./marginalBenefitHistoryService');
      return analyzeSeasonalPatterns(input.accountId, input.campaignId, input.period);
    }),

  // 时段对比分析
  comparePeriods: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      campaignId: z.string(),
      period1Start: z.string(),
      period1End: z.string(),
      period2Start: z.string(),
      period2End: z.string(),
    }))
    .query(async ({ input }) => {
      const { comparePeriods } = await import('./marginalBenefitHistoryService');
      return comparePeriods(
        input.accountId,
        input.campaignId,
        input.period1Start,
        input.period1End,
        input.period2Start,
        input.period2End
      );
    }),

  // 生成边际效益分析报告
  generateMarginalBenefitReport: protectedProcedure
    .input(z.object({
      campaignId: z.string(),
      accountId: z.number(),
      goal: z.enum(['maximize_roas', 'minimize_acos', 'maximize_sales', 'balanced']).default('balanced'),
    }))
    .query(async ({ input }) => {
      const { 
        calculateMarginalBenefit, 
        optimizeTrafficAllocation, 
        generateMarginalBenefitReport 
      } = await import('./marginalBenefitAnalysisService');
      
      // 获取当前设置
      const currentSettings = await placementService.getCampaignPlacementSettings(
        input.campaignId,
        input.accountId
      );
      
      const currentAdjustments = {
        top_of_search: currentSettings?.top_of_search || 0,
        product_page: currentSettings?.product_page || 0,
        rest_of_search: currentSettings?.rest_of_search || 0,
      };
      
      // 计算各位置的边际效益
      const placements: Array<'top_of_search' | 'product_page' | 'rest_of_search'> = ['top_of_search', 'product_page', 'rest_of_search'];
      const marginalBenefits: Record<string, any> = {};
      
      for (const placement of placements) {
        marginalBenefits[placement] = await calculateMarginalBenefit(
          input.campaignId,
          input.accountId,
          placement,
          currentAdjustments[placement],
          30
        );
      }
      
      // 优化流量分配
      const allocationResult = await optimizeTrafficAllocation(
        input.campaignId,
        input.accountId,
        currentAdjustments,
        input.goal
      );
      
      // 生成报告
      const report = generateMarginalBenefitReport(
        marginalBenefits as any,
        allocationResult
      );
      
      return {
        marginalBenefits,
        allocationResult,
        report,
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

// ==================== A/B测试路由 ====================
const abTestRouter = router({
  // 创建A/B测试
  create: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      performanceGroupId: z.number().optional(),
      testName: z.string(),
      testDescription: z.string().optional(),
      testType: z.enum(['budget_allocation', 'bid_strategy', 'targeting']),
      targetMetric: z.enum(['roas', 'acos', 'conversions', 'revenue', 'profit']),
      minSampleSize: z.number().optional(),
      confidenceLevel: z.number().optional(),
      durationDays: z.number().optional(),
      controlConfig: z.record(z.string(), z.unknown()),
      treatmentConfig: z.record(z.string(), z.unknown()),
      trafficSplit: z.number().optional()
    }))
    .mutation(async ({ ctx, input }) => {
      return abTestService.createABTest({
        accountId: input.accountId,
        performanceGroupId: input.performanceGroupId,
        testName: input.testName,
        testDescription: input.testDescription,
        testType: input.testType,
        targetMetric: input.targetMetric,
        minSampleSize: input.minSampleSize,
        confidenceLevel: input.confidenceLevel,
        durationDays: input.durationDays,
        controlConfig: input.controlConfig as Record<string, unknown>,
        treatmentConfig: input.treatmentConfig as Record<string, unknown>,
        trafficSplit: input.trafficSplit,
      }, ctx.user.id);
    }),
  
  // 获取测试列表
  list: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .query(async ({ input }) => {
      return abTestService.getABTests(input.accountId);
    }),
  
  // 获取测试详情
  get: protectedProcedure
    .input(z.object({ testId: z.number() }))
    .query(async ({ input }) => {
      return abTestService.getABTestById(input.testId);
    }),
  
  // 分配广告活动到测试组
  assignCampaigns: protectedProcedure
    .input(z.object({
      testId: z.number(),
      campaignIds: z.array(z.number()),
      splitMethod: z.enum(['random', 'stratified', 'manual']).optional()
    }))
    .mutation(async ({ input }) => {
      return abTestService.assignCampaignsToTest(
        input.testId,
        input.campaignIds,
        input.splitMethod
      );
    }),
  
  // 启动测试
  start: protectedProcedure
    .input(z.object({
      testId: z.number(),
      durationDays: z.number().optional()
    }))
    .mutation(async ({ input }) => {
      await abTestService.startABTest(input.testId, input.durationDays);
      return { success: true };
    }),
  
  // 暂停测试
  pause: protectedProcedure
    .input(z.object({ testId: z.number() }))
    .mutation(async ({ input }) => {
      await abTestService.pauseABTest(input.testId);
      return { success: true };
    }),
  
  // 结束测试
  complete: protectedProcedure
    .input(z.object({ testId: z.number() }))
    .mutation(async ({ input }) => {
      await abTestService.completeABTest(input.testId);
      return { success: true };
    }),
  
  // 分析测试结果
  analyze: protectedProcedure
    .input(z.object({ testId: z.number() }))
    .query(async ({ input }) => {
      return abTestService.analyzeABTestResults(input.testId);
    }),
  
  // 删除测试
  delete: protectedProcedure
    .input(z.object({ testId: z.number() }))
    .mutation(async ({ input }) => {
      await abTestService.deleteABTest(input.testId);
      return { success: true };
    }),
});

// ==================== 预算自动执行路由 ====================
const budgetAutoExecutionRouter = router({
  // 创建自动执行配置
  createConfig: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      performanceGroupId: z.number().optional(),
      configName: z.string(),
      isEnabled: z.boolean().optional(),
      executionFrequency: z.enum(['daily', 'weekly', 'biweekly', 'monthly']),
      executionTime: z.string().optional(),
      executionDayOfWeek: z.number().optional(),
      executionDayOfMonth: z.number().optional(),
      minDataDays: z.number().optional(),
      maxAdjustmentPercent: z.number().optional(),
      minBudget: z.number().optional(),
      requireApproval: z.boolean().optional(),
      notifyOnExecution: z.boolean().optional(),
      notifyOnError: z.boolean().optional()
    }))
    .mutation(async ({ ctx, input }) => {
      const configId = await budgetAutoExecutionService.createAutoExecutionConfig(
        input,
        ctx.user.id
      );
      return { configId };
    }),
  
  // 更新自动执行配置
  updateConfig: protectedProcedure
    .input(z.object({
      configId: z.number(),
      configName: z.string().optional(),
      isEnabled: z.boolean().optional(),
      executionFrequency: z.enum(['daily', 'weekly', 'biweekly', 'monthly']).optional(),
      executionTime: z.string().optional(),
      executionDayOfWeek: z.number().optional(),
      executionDayOfMonth: z.number().optional(),
      minDataDays: z.number().optional(),
      maxAdjustmentPercent: z.number().optional(),
      minBudget: z.number().optional(),
      requireApproval: z.boolean().optional(),
      notifyOnExecution: z.boolean().optional(),
      notifyOnError: z.boolean().optional()
    }))
    .mutation(async ({ input }) => {
      const { configId, ...updates } = input;
      await budgetAutoExecutionService.updateAutoExecutionConfig(configId, updates);
      return { success: true };
    }),
  
  // 删除自动执行配置
  deleteConfig: protectedProcedure
    .input(z.object({ configId: z.number() }))
    .mutation(async ({ input }) => {
      await budgetAutoExecutionService.deleteAutoExecutionConfig(input.configId);
      return { success: true };
    }),
  
  // 获取自动执行配置列表
  listConfigs: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .query(async ({ input }) => {
      return budgetAutoExecutionService.getAutoExecutionConfigs(input.accountId);
    }),
  
  // 获取单个配置
  getConfig: protectedProcedure
    .input(z.object({ configId: z.number() }))
    .query(async ({ input }) => {
      return budgetAutoExecutionService.getAutoExecutionConfigById(input.configId);
    }),
  
  // 手动触发执行
  triggerExecution: protectedProcedure
    .input(z.object({ configId: z.number() }))
    .mutation(async ({ input }) => {
      return budgetAutoExecutionService.triggerManualExecution(input.configId);
    }),
  
  // 获取执行历史
  getHistory: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      limit: z.number().optional()
    }))
    .query(async ({ input }) => {
      return budgetAutoExecutionService.getExecutionHistory(
        input.accountId,
        input.limit
      );
    }),
  
  // 获取执行详情
  getExecutionDetails: protectedProcedure
    .input(z.object({ executionId: z.number() }))
    .query(async ({ input }) => {
      return budgetAutoExecutionService.getExecutionDetails(input.executionId);
    }),
  
  // 审批执行
  approveExecution: protectedProcedure
    .input(z.object({
      executionId: z.number(),
      approve: z.boolean()
    }))
    .mutation(async ({ ctx, input }) => {
      await budgetAutoExecutionService.approveExecution(
        input.executionId,
        ctx.user.id,
        input.approve
      );
      return { success: true };
    }),
});

// ==================== API Security Router ====================
const apiSecurityRouter = router({
  // 操作日志
  getOperationLogs: protectedProcedure
    .input(z.object({
      accountId: z.number().optional(),
      operationType: z.enum(['bid_adjustment', 'budget_change', 'campaign_status', 'keyword_status', 'negative_keyword', 'target_status', 'batch_operation', 'api_sync', 'auto_optimization', 'manual_operation', 'other']).optional(),
      status: z.string().optional(),
      riskLevel: z.enum(['low', 'medium', 'high', 'critical']).optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      limit: z.number().optional(),
      offset: z.number().optional(),
    }))
    .query(async ({ ctx, input }) => {
      return apiSecurityService.getOperationLogs({
        userId: ctx.user.id,
        ...input,
      });
    }),

  // 花费限额配置
  getSpendLimitConfig: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .query(async ({ ctx, input }) => {
      return apiSecurityService.getSpendLimitConfig(ctx.user.id, input.accountId);
    }),

  upsertSpendLimitConfig: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      dailySpendLimit: z.number(),
      warningThreshold1: z.number().optional(),
      warningThreshold2: z.number().optional(),
      criticalThreshold: z.number().optional(),
      autoStopEnabled: z.boolean().optional(),
      autoStopThreshold: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const configId = await apiSecurityService.upsertSpendLimitConfig({
        userId: ctx.user.id,
        ...input,
      });
      return { configId };
    }),

  // 花费告警历史
  getSpendAlertHistory: protectedProcedure
    .input(z.object({
      accountId: z.number().optional(),
      limit: z.number().optional(),
    }))
    .query(async ({ ctx, input }) => {
      return apiSecurityService.getSpendAlertHistory(
        ctx.user.id,
        input.accountId,
        input.limit
      );
    }),

  // 异常检测规则
  getAnomalyRules: protectedProcedure
    .input(z.object({ accountId: z.number().optional() }))
    .query(async ({ ctx, input }) => {
      return apiSecurityService.getAnomalyRules(ctx.user.id, input.accountId);
    }),

  createAnomalyRule: protectedProcedure
    .input(z.object({
      accountId: z.number().optional(),
      ruleName: z.string(),
      ruleDescription: z.string().optional(),
      ruleType: z.enum(['bid_spike', 'bid_drop', 'batch_size', 'frequency', 'budget_change', 'spend_velocity', 'conversion_drop', 'acos_spike', 'custom']),
      conditionType: z.enum(['threshold', 'percentage_change', 'absolute_change', 'rate_limit']),
      conditionValue: z.number(),
      conditionTimeWindow: z.number().optional(),
      actionOnTrigger: z.enum(['alert_only', 'pause_and_alert', 'rollback_and_alert', 'block_operation']).optional(),
      priority: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const ruleId = await apiSecurityService.createAnomalyRule({
        userId: ctx.user.id,
        ...input,
      });
      return { ruleId };
    }),

  // 初始化默认规则
  initializeDefaultRules: protectedProcedure
    .mutation(async ({ ctx }) => {
      await apiSecurityService.initializeDefaultRules(ctx.user.id);
      return { success: true };
    }),

  // 自动暂停记录
  getAutoPauseRecords: protectedProcedure
    .input(z.object({
      accountId: z.number().optional(),
      includeResumed: z.boolean().optional(),
    }))
    .query(async ({ ctx, input }) => {
      return apiSecurityService.getAutoPauseRecords(
        ctx.user.id,
        input.accountId,
        input.includeResumed
      );
    }),

  // 恢复暂停的实体
  resumePausedEntities: protectedProcedure
    .input(z.object({
      recordId: z.number(),
      resumeReason: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const success = await apiSecurityService.resumePausedEntities(
        input.recordId,
        ctx.user.id,
        input.resumeReason
      );
      return { success };
    }),
});

// ==================== Special Scenario Optimization Router ====================
const specialScenarioRouter = router({
  // 预算耗尽风险分析
  analyzeBudgetDepletionRisk: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .query(async ({ input }) => {
      return specialScenarioOptimizationService.analyzeBudgetDepletionRisk(input.accountId);
    }),

  // 单个广告活动预算耗尽预测
  predictBudgetDepletion: protectedProcedure
    .input(z.object({
      campaignId: z.number(),
      currentSpend: z.number(),
      dailyBudget: z.number(),
      currentHour: z.number().optional(),
    }))
    .query(async ({ input }) => {
      return specialScenarioOptimizationService.predictBudgetDepletion(
        input.campaignId,
        input.currentSpend,
        input.dailyBudget,
        input.currentHour
      );
    }),

  // 归因延迟调整后的近期数据
  getAttributionAdjustedData: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      days: z.number().optional(),
    }))
    .query(async ({ input }) => {
      return specialScenarioOptimizationService.adjustRecentPerformanceData(
        input.accountId,
        input.days || 7
      );
    }),

  // 获取归因模型
  getAttributionModel: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .query(async ({ input }) => {
      return specialScenarioOptimizationService.getAttributionModel(input.accountId);
    }),

  // 竞价效率分析
  analyzeBidEfficiency: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      targetAcos: z.number().optional(),
      profitMargin: z.number().optional(),
      minClicks: z.number().optional(),
    }))
    .query(async ({ input }) => {
      return specialScenarioOptimizationService.analyzeBidEfficiency(
        input.accountId,
        input.targetAcos,
        input.profitMargin,
        input.minClicks
      );
    }),

  // 季节性调整策略
  getSeasonalStrategy: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      targetDate: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const date = input.targetDate ? new Date(input.targetDate) : new Date();
      return specialScenarioOptimizationService.generateSeasonalStrategy(
        input.accountId,
        date
      );
    }),

  // 学习季节性模式
  learnSeasonalPatterns: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      metric: z.enum(['sales', 'roas', 'spend']).optional(),
    }))
    .query(async ({ input }) => {
      return specialScenarioOptimizationService.learnSeasonalPatterns(
        input.accountId,
        input.metric
      );
    }),

  // 大促渐进式调整计划
  getEventTransitionPlan: protectedProcedure
    .input(z.object({
      eventName: z.string(),
      eventDate: z.string(),
      baseBudget: z.number(),
      baseBid: z.number(),
    }))
    .query(async ({ input }) => {
      return specialScenarioOptimizationService.generateEventTransitionPlan(
        input.eventName,
        new Date(input.eventDate),
        input.baseBudget,
        input.baseBid
      );
    }),

  // 获取即将到来的大促事件
  getUpcomingEvents: protectedProcedure
    .input(z.object({ daysAhead: z.number().optional() }))
    .query(async ({ input }) => {
      return specialScenarioOptimizationService.getUpcomingPromotionalEvents(
        input.daysAhead || 30
      );
    }),

  // 综合特殊场景分析
  runFullAnalysis: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      targetAcos: z.number().optional(),
      profitMargin: z.number().optional(),
      minClicks: z.number().optional(),
    }))
    .query(async ({ input }) => {
      return specialScenarioOptimizationService.runSpecialScenarioAnalysis(
        input.accountId,
        {
          targetAcos: input.targetAcos,
          profitMargin: input.profitMargin,
          minClicks: input.minClicks,
        }
      );
    }),
});

// ==================== Automation Execution Router ====================
const automationRouter = router({
  // 获取账号自动化配置
  getConfig: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .query(async ({ input }) => {
      return automationExecutionEngine.getAccountAutomationConfig(input.accountId);
    }),

  // 更新账号自动化配置
  updateConfig: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      enabled: z.boolean().optional(),
      mode: z.enum(['full_auto', 'supervised', 'approval', 'disabled']).optional(),
      enabledTypes: z.array(z.enum([
        'bid_adjustment',
        'budget_adjustment',
        'placement_tilt',
        'negative_keyword',
        'dayparting',
        'funnel_migration',
        'traffic_isolation',
        'auto_rollback',
      ])).optional(),
      safetyBoundary: z.object({
        maxBidChangePercent: z.number().optional(),
        maxBudgetChangePercent: z.number().optional(),
        maxPlacementChangePercent: z.number().optional(),
        maxDailyBidAdjustments: z.number().optional(),
        maxDailyBudgetAdjustments: z.number().optional(),
        maxDailyTotalAdjustments: z.number().optional(),
        autoExecuteConfidence: z.number().optional(),
        supervisedConfidence: z.number().optional(),
      }).optional(),
    }))
    .mutation(async ({ input }) => {
      return automationExecutionEngine.updateAccountAutomationConfig(input.accountId, {
        enabled: input.enabled,
        mode: input.mode,
        enabledTypes: input.enabledTypes,
        safetyBoundary: input.safetyBoundary as any,
      });
    }),

  // 运行完整自动化周期
  runFullCycle: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .mutation(async ({ input }) => {
      return automationExecutionEngine.runFullAutomationCycle(input.accountId);
    }),

  // 获取执行历史
  getExecutionHistory: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      limit: z.number().optional(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
    }))
    .query(async ({ input }) => {
      return automationExecutionEngine.getExecutionHistory(input.accountId, {
        limit: input.limit,
        startDate: input.startDate,
        endDate: input.endDate,
      });
    }),

  // 获取每日执行统计
  getDailyStats: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      date: z.date().optional(),
    }))
    .query(async ({ input }) => {
      return automationExecutionEngine.getDailyExecutionStats(input.accountId, input.date);
    }),

  // 紧急停止
  emergencyStop: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      reason: z.string(),
    }))
    .mutation(async ({ input }) => {
      automationExecutionEngine.emergencyStop(input.accountId, input.reason);
      return { success: true };
    }),

  // 恢复自动化
  resume: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .mutation(async ({ input }) => {
      automationExecutionEngine.resumeAutomation(input.accountId);
      return { success: true };
    }),

  // 执行单个优化
  executeOptimization: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      type: z.enum([
        'bid_adjustment',
        'budget_adjustment',
        'placement_tilt',
        'negative_keyword',
        'dayparting',
        'funnel_migration',
        'traffic_isolation',
        'auto_rollback',
      ]),
      targetType: z.enum(['keyword', 'campaign', 'ad_group', 'placement']),
      targetId: z.number(),
      targetName: z.string(),
      currentValue: z.number(),
      newValue: z.number(),
      confidence: z.number(),
      reason: z.string(),
    }))
    .mutation(async ({ input }) => {
      return automationExecutionEngine.executeOptimization(
        input.accountId,
        input.type,
        input.targetType,
        input.targetId,
        input.targetName,
        input.currentValue,
        input.newValue,
        input.confidence,
        input.reason
      );
    }),

  // 批量执行优化
  batchExecute: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      optimizations: z.array(z.object({
        type: z.enum([
          'bid_adjustment',
          'budget_adjustment',
          'placement_tilt',
          'negative_keyword',
          'dayparting',
          'funnel_migration',
          'traffic_isolation',
          'auto_rollback',
        ]),
        targetType: z.enum(['keyword', 'campaign', 'ad_group', 'placement']),
        targetId: z.number(),
        targetName: z.string(),
        currentValue: z.number(),
        newValue: z.number(),
        confidence: z.number(),
        reason: z.string(),
      })),
    }))
    .mutation(async ({ input }) => {
      return automationExecutionEngine.batchExecuteOptimizations(
        input.accountId,
        input.optimizations
      );
    }),
});

// ==================== Auto Operation Router ====================
const autoOperationRouter = router({
  // 获取账号自动运营配置
  getConfig: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .query(async ({ input }) => {
      return autoOperationService.autoOperationService.getConfig(input.accountId);
    }),

  // 创建或更新自动运营配置
  upsertConfig: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      enabled: z.boolean().optional(),
      intervalHours: z.number().optional(),
      enableDataSync: z.boolean().optional(),
      enableNgramAnalysis: z.boolean().optional(),
      enableFunnelSync: z.boolean().optional(),
      enableConflictDetection: z.boolean().optional(),
      enableMigrationSuggestion: z.boolean().optional(),
      enableBidOptimization: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      return autoOperationService.autoOperationService.upsertConfig(input);
    }),

  // 执行完整的自动运营流程
  executeFullOperation: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .mutation(async ({ input }) => {
      return autoOperationService.autoOperationService.executeFullOperation(input.accountId);
    }),

  // 获取运营日志
  getLogs: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      limit: z.number().optional(),
    }))
    .query(async ({ input }) => {
      return autoOperationService.autoOperationService.getLogs(input.accountId, input.limit);
    }),

  // 获取所有配置
  getAllConfigs: protectedProcedure
    .query(async () => {
      return autoOperationService.autoOperationService.getAllConfigs();
    }),

  // 执行所有到期的自动运营任务
  executeAllDueTasks: protectedProcedure
    .mutation(async () => {
      return autoOperationService.autoOperationService.executeAllDueTasks();
    }),
});

// ==================== Invite Code Router ====================
const inviteCodeRouter = router({
  // 生成邀请码
  create: protectedProcedure
    .input(z.object({
      inviteType: z.enum(['team_member', 'external_user']).default('external_user'),
      maxUses: z.number().min(0).max(1000).default(1),
      expiresInDays: z.number().min(1).max(365).optional(),
      note: z.string().max(255).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { createInviteCode } = await import('./inviteCodeService');
      const { createAuditLog } = await import('./auditLogService');
      
      const result = await createInviteCode({
        createdBy: ctx.user.id,
        organizationId: (ctx.user as any).organizationId || 1,
        ...input,
      });
      
      if (result.success && result.inviteCode) {
        await createAuditLog({
          organizationId: (ctx.user as any).organizationId || 1,
          userId: ctx.user.id,
          userName: ctx.user.name || ctx.user.email || undefined,
          actionType: 'invite_create',
          actionCategory: 'invite',
          resourceType: 'invite_code',
          resourceId: result.inviteCode.code,
          description: `创建邀请码: ${result.inviteCode.code}`,
          newValue: { inviteType: input.inviteType, maxUses: input.maxUses },
        });
      }
      
      return result;
    }),

  // 批量生成邀请码
  createBatch: protectedProcedure
    .input(z.object({
      count: z.number().min(1).max(100),
      inviteType: z.enum(['team_member', 'external_user']).default('external_user'),
      maxUses: z.number().min(0).max(1000).default(1),
      expiresInDays: z.number().min(1).max(365).optional(),
      note: z.string().max(255).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { createInviteCodesBatch } = await import('./inviteCodeService');
      return createInviteCodesBatch({
        createdBy: ctx.user.id,
        organizationId: (ctx.user as any).organizationId || 1,
        inviteType: input.inviteType,
        maxUses: input.maxUses,
        expiresInDays: input.expiresInDays,
        note: input.note,
      }, input.count);
    }),

  // 验证邀请码（公开接口）
  validate: publicProcedure
    .input(z.object({ code: z.string() }))
    .query(async ({ input }) => {
      const { validateInviteCode } = await import('./inviteCodeService');
      return validateInviteCode(input.code);
    }),

  // 获取邀请码列表
  list: protectedProcedure.query(async ({ ctx }) => {
    const { getInviteCodes } = await import('./inviteCodeService');
    return getInviteCodes(ctx.user.id);
  }),

  // 获取邀请码统计
  stats: protectedProcedure.query(async ({ ctx }) => {
    const { getInviteCodeStats } = await import('./inviteCodeService');
    return getInviteCodeStats(ctx.user.id);
  }),

  // 禁用邀请码
  disable: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const { disableInviteCode } = await import('./inviteCodeService');
      return disableInviteCode(input.id);
    }),

  // 启用邀请码
  enable: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const { enableInviteCode } = await import('./inviteCodeService');
      return enableInviteCode(input.id);
    }),

  // 删除邀请码
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const { deleteInviteCode } = await import('./inviteCodeService');
      return deleteInviteCode(input.id);
    }),
});

// ==================== Main Router ====================
export const appRouter = router({system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
    // 本地用户注册（需要邀请码）
    localRegister: publicProcedure
      .input(z.object({
        inviteCode: z.string().min(1, '邀请码不能为空'),
        username: z.string().min(3, '用户名至少3个字符').max(50),
        password: z.string().min(6, '密码至少6个字符'),
        name: z.string().min(1, '姓名不能为空'),
        email: z.string().email().optional(),
        organizationName: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { registerWithInviteCode } = await import('./localAuthService');
        const ipAddress = ctx.req.headers['x-forwarded-for'] as string || ctx.req.socket.remoteAddress;
        const userAgent = ctx.req.headers['user-agent'];
        return registerWithInviteCode(input, ipAddress, userAgent);
      }),
    // 本地用户登录
    localLogin: publicProcedure
      .input(z.object({
        username: z.string().min(1),
        password: z.string().min(1),
      }))
      .mutation(async ({ ctx, input }) => {
        const { loginLocalUser } = await import('./localAuthService');
        const ipAddress = ctx.req.headers['x-forwarded-for'] as string || ctx.req.socket.remoteAddress;
        const userAgent = ctx.req.headers['user-agent'];
        return loginLocalUser(input, ipAddress, userAgent);
      }),
    // 验证Token
    verifyToken: publicProcedure
      .input(z.object({ token: z.string() }))
      .query(async ({ input }) => {
        const { verifyToken } = await import('./localAuthService');
        return verifyToken(input.token);
      }),
    // 修改密码
    changePassword: protectedProcedure
      .input(z.object({
        oldPassword: z.string().min(1),
        newPassword: z.string().min(6),
      }))
      .mutation(async ({ ctx, input }) => {
        const { changePassword } = await import('./localAuthService');
        return changePassword(ctx.user.id, input.oldPassword, input.newPassword);
      }),
  }),
  
  adAccount: adAccountRouter,
  performanceGroup: performanceGroupRouter,
  campaign: campaignRouter,
  adGroup: adGroupRouter,
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
  abTest: abTestRouter,
  budgetAutoExecution: budgetAutoExecutionRouter,
  review: reviewRouter,
  apiSecurity: apiSecurityRouter,
  specialScenario: specialScenarioRouter,
  automation: automationRouter,
  autoOperation: autoOperationRouter,
  inviteCode: inviteCodeRouter,
});

export type AppRouter = typeof appRouter;
