/**
 * 自动化执行路由
 * 从 routers.ts 拆分的独立路由模块
 */
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as automationExecutionEngine from '../automation/automationExecutionEngine';
import * as autoOperationService from '../automation/autoOperationService';
import { verifyAccountAccess } from '../utils/accessControl';


// ==================== Automation Execution Router ====================
export const automationRouter = router({
  // 获取账号自动化配置
  getConfig: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .query(async ({ input, ctx }: any) => {
      await verifyAccountAccess(ctx.user.id, input.accountId);
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
    .mutation(async ({ input, ctx }: any) => {
      await verifyAccountAccess(ctx.user.id, input.accountId);
      return automationExecutionEngine.updateAccountAutomationConfig(input.accountId, {
        enabled: input.enabled,
        mode: input.mode,
        enabledTypes: input.enabledTypes,
        // @ts-ignore
        safetyBoundary: input.safetyBoundary as unknown,
      });
    }),

  // 运行完整自动化周期
  runFullCycle: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .mutation(async ({ input, ctx }: any) => {
      await verifyAccountAccess(ctx.user.id, input.accountId);
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
    .query(async ({ input, ctx }: any) => {
      await verifyAccountAccess(ctx.user.id, input.accountId);
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
    .query(async ({ input, ctx }: any) => {
      await verifyAccountAccess(ctx.user.id, input.accountId);
      return automationExecutionEngine.getDailyExecutionStats(input.accountId, input.date);
    }),

  // 紧急停止
  emergencyStop: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      reason: z.string(),
    }))
    .mutation(async ({ input, ctx }: any) => {
      await verifyAccountAccess(ctx.user.id, input.accountId);
      automationExecutionEngine.emergencyStop(input.accountId, input.reason);
      return { success: true };
    }),

  // 恢复自动化
  resume: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .mutation(async ({ input, ctx }: any) => {
      await verifyAccountAccess(ctx.user.id, input.accountId);
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
    .mutation(async ({ input, ctx }: any) => {
      await verifyAccountAccess(ctx.user.id, input.accountId);
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
    .mutation(async ({ input, ctx }: any) => {
      await verifyAccountAccess(ctx.user.id, input.accountId);
      return automationExecutionEngine.batchExecuteOptimizations(
        input.accountId,
        input.optimizations
      );
    }),
});


// ==================== Auto Operation Router ====================
export const autoOperationRouter = router({
  // 获取账号自动运营配置
  getConfig: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .query(async ({ input, ctx }: any) => {
      await verifyAccountAccess(ctx.user.id, input.accountId);
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
    .mutation(async ({ input, ctx }: any) => {
      await verifyAccountAccess(ctx.user.id, input.accountId);
      return autoOperationService.autoOperationService.upsertConfig(input);
    }),

  // 执行完整的自动运营流程
  executeFullOperation: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .mutation(async ({ input, ctx }: any) => {
      await verifyAccountAccess(ctx.user.id, input.accountId);
      return autoOperationService.autoOperationService.executeFullOperation(input.accountId);
    }),

  // 获取运营日志
  getLogs: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      limit: z.number().optional(),
    }))
    .query(async ({ input, ctx }: any) => {
      await verifyAccountAccess(ctx.user.id, input.accountId);
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
