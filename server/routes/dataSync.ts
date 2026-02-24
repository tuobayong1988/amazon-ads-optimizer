/**
 * 数据同步路由
 * 从 routers.ts 拆分的独立路由模块
 */
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as db from "../db";
import * as dataSyncService from "../dataSyncService";
import { asyncReportService } from '../services/asyncReportService';
import { reportJobScheduler } from '../services/reportJobScheduler';
import { accountInitializationService } from '../services/accountInitializationService';
import { smartSyncService } from '../services/smartSyncService';
import { tieredSyncService } from '../services/tieredSyncService';
import { eq, and, gte, lte, desc } from 'drizzle-orm';


export const dataSyncRouter = router({
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
      const { logAudit } = await import("../auditService");
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


export const reportJobsRouter = router({
  // 获取报告任务统计
  getStats: protectedProcedure.query(async () => {
    return asyncReportService.getJobStats();
  }),

  // 获取调度器状态
  getSchedulerStatus: protectedProcedure.query(async () => {
    return reportJobScheduler.getStatus();
  }),

  // 手动触发一次处理周期
  runOnce: protectedProcedure.mutation(async () => {
    return reportJobScheduler.runOnce();
  }),

  // 创建归因回溯任务
  createAttributionJobs: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      profileId: z.string(),
    }))
    .mutation(async ({ input }) => {
      const jobIds = await asyncReportService.createAttributionJobs(input.accountId, input.profileId);
      return { success: true, jobCount: jobIds.length, jobIds };
    }),

  // 创建初始化任务（新店铺）
  createInitializationJobs: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      profileId: z.string(),
    }))
    .mutation(async ({ input }) => {
      const jobIds = await asyncReportService.createInitializationJobs(input.accountId, input.profileId);
      return { success: true, jobCount: jobIds.length, jobIds };
    }),

  // 清理过期任务
  cleanupExpiredJobs: protectedProcedure
    .input(z.object({ daysOld: z.number().default(7) }))
    .mutation(async ({ input }) => {
      const count = await asyncReportService.cleanupExpiredJobs(input.daysOld);
      return { success: true, deletedCount: count };
    }),

  // 开始账号初始化
  startInitialization: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .mutation(async ({ input }) => {
      return accountInitializationService.startInitialization(input.accountId);
    }),

  // 获取初始化进度
  getInitializationProgress: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .query(async ({ input }) => {
      return accountInitializationService.getInitializationProgress(input.accountId);
    }),

  // 重试失败的初始化
  retryFailedInitialization: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .mutation(async ({ input }) => {
      return accountInitializationService.retryFailedInitialization(input.accountId);
    }),

  // 获取待初始化的账号列表
  getPendingInitializationAccounts: protectedProcedure.query(async () => {
    return accountInitializationService.getPendingInitializationAccounts();
  }),

  // 执行智能同步
  executeSmartSync: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .mutation(async ({ input }) => {
      return smartSyncService.executeSmartSync(input.accountId);
    }),

  // 获取同步统计
  getSyncStats: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .query(async ({ input }) => {
      return smartSyncService.getSyncStats(input.accountId);
    }),

  // 获取任务数量对比
  getTaskComparison: protectedProcedure.query(async () => {
    return smartSyncService.getTaskComparison();
  }),

  // ===== 智能分层同步（方案五） =====
  
  // 获取分层配置
  getTierConfig: protectedProcedure.query(async () => {
    return tieredSyncService.getTierConfig();
  }),

  // 计算各层任务数量
  calculateTieredTaskCounts: protectedProcedure.query(async () => {
    return tieredSyncService.calculateTaskCounts();
  }),

  // 创建分层初始化任务
  createTieredInitializationTasks: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      profileId: z.string(),
    }))
    .mutation(async ({ input }) => {
      return tieredSyncService.createTieredInitializationTasks(input.accountId, input.profileId);
    }),

  // 获取分层初始化进度
  getTieredInitializationStats: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .query(async ({ input }) => {
      return tieredSyncService.getInitializationStats(input.accountId);
    }),

  // 获取任务进度（断点续传支持）
  getTaskProgress: protectedProcedure
    .input(z.object({ taskId: z.number() }))
    .query(async ({ input }) => {
      return tieredSyncService.getTaskProgress(input.taskId);
    }),

  // 重试失败的任务（增量重试）
  retryFailedTieredTasks: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      maxRetries: z.number().default(3),
    }))
    .mutation(async ({ input }) => {
      return tieredSyncService.retryFailedTasks(input.accountId, input.maxRetries);
    }),

  // 检查任务完成状态
  checkTaskCompletion: protectedProcedure
    .input(z.object({ taskId: z.number() }))
    .query(async ({ input }) => {
      return tieredSyncService.checkTaskCompletion(input.taskId);
    }),
});
