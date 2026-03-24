/**
 * 调度器路由
 * 从 routers.ts 拆分的独立路由模块
 */
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as db from "../db";
import * as schedulerService from '../scheduler/schedulerService';
import { eq, and, gte, lte, desc } from 'drizzle-orm';


// ==================== Scheduler Router ====================
export const schedulerRouter = router({
  // Get scheduled tasks
  getTasks: protectedProcedure
    // @ts-ignore
    .query(async ({ ctx }: unknown) => {
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
      parameters: z.record(z.string(), z.unknown()).optional(),
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

  // v370.4: 数据隔离 - Update scheduled task
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
      parameters: z.record(z.string(), z.unknown()).optional(),
    // @ts-ignore
    }))
    // @ts-ignore
    .mutation(async ({ ctx, input }: unknown) => {
      const { verifyScheduledTaskAccess } = await import('../utils/accessControl');
      await verifyScheduledTaskAccess(ctx.user.id, input.id);
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

  // v370.4: 数据隔离 - Delete scheduled task
  // @ts-ignore
  deleteTask: protectedProcedure
    .input(z.object({ id: z.number() }))
    // @ts-ignore
    .mutation(async ({ ctx, input }: unknown) => {
      const { verifyScheduledTaskAccess } = await import('../utils/accessControl');
      await verifyScheduledTaskAccess(ctx.user.id, input.id);
      await db.deleteScheduledTask(input.id);
      return { success: true };
    }),

  // v370.4: 数据隔离 - Run task manually
  runTask: protectedProcedure
    .input(z.object({
      id: z.number(),
      autoApply: z.boolean().optional().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      const { verifyScheduledTaskAccess } = await import('../utils/accessControl');
      await verifyScheduledTaskAccess(ctx.user.id, input.id);
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

  // v370.4: 数据隔离 - Get task execution history
  getExecutionHistory: protectedProcedure
    .input(z.object({
      // @ts-ignore
      taskId: z.number(),
      limit: z.number().optional().default(20),
    }))
    // @ts-ignore
    .query(async ({ ctx, input }: unknown) => {
      const { verifyScheduledTaskAccess } = await import('../utils/accessControl');
      await verifyScheduledTaskAccess(ctx.user.id, input.taskId);
      return db.getTaskExecutionHistory(input.taskId, input.limit);
    }),

  // Get default task configurations
  getDefaultConfigs: protectedProcedure
    .query(async () => {
      return schedulerService.defaultTaskConfigs;
    }),
});
