/**
 * v359: 安全护栏动态配置管理API
 * 
 * 提供护栏参数的运行时动态调整能力
 * 支持全局、广告类型、账户三级配置
 */
import { z } from 'zod';
import { router, protectedProcedure } from '../_core/trpc';
import { createModuleLogger } from '../utils/logger';

const log = createModuleLogger('GuardrailConfigAPI');

const overrideSchema = z.object({
  bid: z.object({
    maxSingleChangePercent: z.number().min(0.05).max(0.50).optional(),
    maxDailyChangePercent: z.number().min(0.10).max(0.60).optional(),
    minBid: z.number().min(0.01).max(0.10).optional(),
    maxBid: z.number().min(50).max(500).optional(),
    consecutiveSameDirectionSlowdown: z.number().min(2).max(7).optional(),
    slowdownFactor: z.number().min(0.3).max(0.8).optional(),
  }).optional(),
  budget: z.object({
    maxSingleChangePercent: z.number().min(0.10).max(0.50).optional(),
    maxDailyChangePercent: z.number().min(0.15).max(0.70).optional(),
    minDailyBudget: z.number().min(0.50).max(5).optional(),
    maxDailyBudget: z.number().min(10000).max(100000).optional(),
  }).optional(),
  placement: z.object({
    maxSingleChangePct: z.number().min(10).max(50).optional(),
    maxTotalAdjustment: z.number().min(100).max(900).optional(),
    minTotalAdjustment: z.number().min(-80).max(0).optional(),
  }).optional(),
  emergency: z.object({
    salesDropThreshold: z.number().min(0.20).max(0.70).optional(),
    spendSurgeThreshold: z.number().min(1.5).max(5.0).optional(),
    ordersDropThreshold: z.number().min(0.25).max(0.80).optional(),
    lookbackDays: z.number().min(1).max(14).optional(),
  }).optional(),
});

export const guardrailConfigRouter = router({
  /**
   * 获取有效护栏配置（合并后的最终值）
   */
  getEffective: protectedProcedure
    .input(z.object({
      accountId: z.number().optional(),
      adType: z.enum(['sp', 'sb', 'sd', 'default']).optional(),
    }).optional())
    .query(async ({ ctx, input }: unknown) => {
      try {
        const { getGuardrailConfigService } = await import('../services/guardrailConfigService');
        const service = getGuardrailConfigService();
        const config = service.getEffectiveConfig(input?.accountId, input?.adType);
        return { success: true, error: null, config };
      } catch (e: unknown) {
        return { success: false, error: (e as Error).message, config: null };
      }
    }),

  /**
   * 获取所有配置覆盖
   */
  getAllOverrides: protectedProcedure
    .query(async () => {
      try {
        const { getGuardrailConfigService } = await import('../services/guardrailConfigService');
        const service = getGuardrailConfigService();
        return { success: true, error: null, overrides: service.getAllOverrides() };
      } catch (e: unknown) {
        return { success: false, error: (e as Error).message, overrides: [] };
      }
    }),

  /**
   * 获取硬编界限
   */
  getHardLimits: protectedProcedure
    .query(async () => {
      try {
        const { getGuardrailConfigService } = await import('../services/guardrailConfigService');
        const service = getGuardrailConfigService();
        return { success: true, error: null, limits: service.getHardLimits() };
      } catch (e: unknown) {
        return { success: false, error: (e as Error).message, limits: null };
      }
    }),

  /**
   * 设置配置覆盖
   */
  setOverride: protectedProcedure
    .input(z.object({
      scope: z.enum(['global', 'adType', 'account']),
      scopeKey: z.string(),
      overrides: overrideSchema,
    }))
    .mutation(async ({ input, ctx }: unknown) => {
      try {
        const { getGuardrailConfigService } = await import('../services/guardrailConfigService');
        const service = getGuardrailConfigService();
        const result = service.setConfigOverride(
          input.scope,
          input.scopeKey,
          input.overrides,
          ctx.user?.email || 'unknown'
        );
        return { success: result.success, errors: result.errors };
      } catch (e: unknown) {
        return { success: false, errors: [(e as Error).message] };
      }
    }),

  /**
   * 删除配置覆盖
   */
  removeOverride: protectedProcedure
    .input(z.object({
      scope: z.enum(['global', 'adType', 'account']),
      scopeKey: z.string(),
    }))
    .mutation(async ({ ctx, input }: unknown) => {
      try {
        const { getGuardrailConfigService } = await import('../services/guardrailConfigService');
        const service = getGuardrailConfigService();
        const removed = service.removeConfigOverride(input.scope, input.scopeKey);
        return { success: true, removed };
      } catch (e: unknown) {
        return { success: false, removed: false, error: (e as Error).message };
      }
    }),
});
