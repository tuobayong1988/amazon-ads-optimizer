/**
 * 算法优化路由
 * 从 routers.ts 拆分的独立路由模块
 */
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as algorithmOptimizationService from '../algorithm/algorithmOptimizationService';
import * as algorithmEffectService from '../algorithm/algorithmEffectService';
import * as holidayConfigService from '../system/holidayConfigService';
import * as algorithmEvolutionEngine from '../algorithm/algorithmEvolutionEngine';
import { runAutoCorrection, getScanHistory, getLastScanResult, getScanStatus, getConfig as getAutoCorrectorConfig, getLatestHealthReport } from '../optimization/optimizationAutoCorrector';
import { apiCache } from '../services/apiCacheService';
import { verifyAccountAccess } from '../utils/accessControl';


// ==================== Algorithm Optimization Router ====================
export const algorithmOptimizationRouter = router({
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
    .mutation(async ({ ctx, input }: any) => {
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
    .query(async ({ input, ctx }: any) => {
      if (input.accountId) await verifyAccountAccess(ctx.user.id, input.accountId);
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
    .query(async ({ input, ctx }: any) => {
      if (input.accountId) await verifyAccountAccess(ctx.user.id, input.accountId);
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
    .query(async ({ input, ctx }: any) => {
      if (input.accountId) await verifyAccountAccess(ctx.user.id, input.accountId);
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
    .query(async ({ input, ctx }: any) => {
      if (input.accountId) await verifyAccountAccess(ctx.user.id, input.accountId);
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
    .query(async ({ input, ctx }: any) => {
      if (input.accountId) await verifyAccountAccess(ctx.user.id, input.accountId);
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


// ==================== Algorithm Effect Tracking Router ====================
export const algorithmEffectRouter = router({
  // 获取算法效果统计
  getStats: protectedProcedure
    .input(z.object({
      accountId: z.number().optional(),
      days: z.number().optional().default(30)
    }))
    .query(async ({ ctx, input }) => {
      // v268 性能优化: 算法效果统计缓存（TTL 5分钟）
      const cacheKey = apiCache.generateKey('algorithmEffect.getStats', ctx.user.id, input);
      const cached = apiCache.get<any>(cacheKey);
      if (cached) return cached;

      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - input.days);
      const result = await algorithmEffectService.getAlgorithmEffectStats(
        ctx.user.id,
        input.accountId,
        startDate,
        endDate
      );
      apiCache.set(cacheKey, result, 5 * 60 * 1000);
      return result;
    }),

  // 获取效果趋势
  getTrend: protectedProcedure
    .input(z.object({
      accountId: z.number().optional(),
      days: z.number().optional().default(30)
    }))
    .query(async ({ ctx, input }) => {
      return algorithmEffectService.getEffectTrend(
        ctx.user.id,
        input.accountId,
        input.days
      );
    }),

  // 获取最近的效果记录
  getRecent: protectedProcedure
    .input(z.object({
      accountId: z.number().optional(),
      limit: z.number().optional().default(50)
    }))
    .query(async ({ ctx, input }) => {
      return algorithmEffectService.getRecentEffectRecords(
        ctx.user.id,
        input.accountId,
        input.limit
      );
    }),

  // 获取待更新效果的记录
  getPending: protectedProcedure.query(async ({ ctx }: any) => {
    return algorithmEffectService.getPendingEffectRecords(ctx.user.id);
  }),
});


// ==================== Algorithm Evolution Engine Router (v152) ====================
export const algorithmEvolutionRouter = router({
  // 获取优化目标的算法配置
  getTargetConfig: protectedProcedure
    .input(z.object({ targetId: z.number() }))
    .query(async ({ ctx, input }: any) => {
      return algorithmEvolutionEngine.getTargetAlgorithmConfig(input.targetId);
    }),

  // 获取优化目标的效果评估
  evaluateTarget: protectedProcedure
    .input(z.object({
      targetId: z.number(),
      period: z.enum(['7', '14', '30']).optional().default('14'),
    }))
    .query(async ({ ctx, input }: any) => {
      const period = parseInt(input.period) as 7 | 14 | 30;
      return algorithmEvolutionEngine.evaluateTargetPerformance(input.targetId, period);
    }),

  // 手动触发单个目标的进化周期
  runEvolutionCycle: protectedProcedure
    .input(z.object({ targetId: z.number() }))
    .mutation(async ({ ctx, input }: any) => {
      return algorithmEvolutionEngine.runEvolutionCycle(input.targetId);
    }),

  // 手动触发全局进化
  runGlobalEvolution: protectedProcedure
    .mutation(async () => {
      return algorithmEvolutionEngine.runGlobalEvolution();
    }),

  // 手动触发效果追踪
  runEffectTracking: protectedProcedure
    .mutation(async () => {
      return algorithmEvolutionEngine.runEffectTracking();
    }),

  // 获取有效出价配置（供前端展示进化后的参数）
  getEffectiveBidConfig: protectedProcedure
    .input(z.object({ targetId: z.number() }))
    .query(async ({ ctx, input }: any) => {
      return algorithmEvolutionEngine.getEffectiveBidConfig(input.targetId);
    }),

  // v167: 手动触发自动纠错
  runAutoCorrection: protectedProcedure
    .input(z.object({ accountId: z.number().optional() }))
    .mutation(async ({ input, ctx }: any) => {
      if (input.accountId) await verifyAccountAccess(ctx.user.id, input.accountId);
      return runAutoCorrection(input.accountId);
    }),
});


// ==================== Holiday Configuration Router ====================
export const holidayConfigRouter = router({
  // 获取节假日配置列表
  list: protectedProcedure
    .input(z.object({
      marketplace: z.string().optional()
    }).optional())
    .query(async ({ ctx, input }) => {
      return holidayConfigService.getHolidayConfigs(
        ctx.user.id,
        input?.marketplace
      );
    }),

  // 初始化系统默认节假日
  initializeDefaults: protectedProcedure
    .input(z.object({
      marketplace: z.string()
    }))
    .mutation(async ({ ctx, input }) => {
      return holidayConfigService.initializeSystemHolidays(
        ctx.user.id,
        input.marketplace
      );
    }),

  // 创建节假日配置
  create: protectedProcedure
    .input(z.object({
      marketplace: z.string(),
      name: z.string(),
      startDate: z.string(),
      endDate: z.string(),
      bidMultiplier: z.string(),
      budgetMultiplier: z.string(),
      priority: z.enum(['high', 'medium', 'low']),
      preHolidayDays: z.number().optional().default(7)
    }))
    .mutation(async ({ ctx, input }) => {
      return holidayConfigService.createHolidayConfig({
        userId: ctx.user.id,
        ...input,
        isActive: 1,
        isSystemDefault: 0
      });
    }),

  // 更新节假日配置
  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      bidMultiplier: z.string().optional(),
      budgetMultiplier: z.string().optional(),
      priority: z.enum(['high', 'medium', 'low']).optional(),
      preHolidayDays: z.number().optional()
    }))
    .mutation(async ({ ctx, input }: any) => {
      const { id, ...data } = input;
      return holidayConfigService.updateHolidayConfig(id, data);
    }),

  // 删除节假日配置
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }: any) => {
      return holidayConfigService.deleteHolidayConfig(input.id);
    }),

  // 切换节假日配置的启用状态
  toggle: protectedProcedure
    .input(z.object({
      id: z.number(),
      isActive: z.boolean()
    }))
    .mutation(async ({ ctx, input }: any) => {
      return holidayConfigService.toggleHolidayConfig(input.id, input.isActive);
    }),

  // 获取即将到来的节假日
  getUpcoming: protectedProcedure
    .input(z.object({
      marketplace: z.string().optional(),
      days: z.number().optional().default(30)
    }).optional())
    .query(async ({ ctx, input }) => {
      return holidayConfigService.getUpcomingHolidays(
        ctx.user.id,
        input?.marketplace,
        input?.days
      );
    }),

  // 获取支持的站点列表
  getMarketplaces: protectedProcedure.query(async () => {
    return holidayConfigService.getSupportedMarketplaces();
  }),

  // 获取指定日期的调整乘数
  getMultipliers: protectedProcedure
    .input(z.object({
      marketplace: z.string(),
      date: z.string().optional()
    }))
    .query(async ({ ctx, input }) => {
      const date = input.date ? new Date(input.date) : new Date();
      return holidayConfigService.getDateAdjustmentMultipliersFromDb(
        ctx.user.id,
        input.marketplace,
        date
      );
    }),
});
