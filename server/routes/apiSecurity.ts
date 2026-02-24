/**
 * API安全路由
 * 从 routers.ts 拆分的独立路由模块
 */
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as apiSecurityService from '../apiSecurityService';
import { eq, and, gte, lte, desc } from 'drizzle-orm';


// ==================== API Security Router ====================
export const apiSecurityRouter = router({
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
