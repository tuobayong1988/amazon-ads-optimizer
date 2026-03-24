/**
 * 数据同步路由
 * 从 routers.ts 拆分的独立路由模块
 */
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as db from "../db";
import * as dataSyncService from "../sync/dataSyncService";
import { asyncReportService } from '../sync/scheduling/asyncReportService';
import { reportJobScheduler } from '../services/reportJobScheduler';
import { accountInitializationService } from '../services/accountInitializationService';
import { smartSyncService } from '../sync/scheduling/smartSyncService';
import { tieredSyncService } from '../sync/scheduling/tieredSyncService';
import { eq, and, gte, lte, desc } from 'drizzle-orm';
import { createModuleLogger } from '../utils/logger';

const log = createModuleLogger('DataSyncRoute');


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
      const { logAudit } = await import("../system/auditService");
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
      dataSyncService.executeSyncJob(jobId).catch((err: Error) => log.warn(`同步任务执行失败 (jobId=${jobId}):`, (err as Error).message));
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
    // @ts-ignore
    .query(async ({ ctx, input }: unknown) => {
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
    // @ts-ignore
    .input(z.object({ accountId: z.number() }))
    // @ts-ignore
    .query(async ({ ctx, input }: unknown) => {
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
  // @ts-ignore
  triggerSchedule: protectedProcedure
    .input(z.object({ scheduleId: z.number() }))
    // @ts-ignore
    .mutation(async ({ ctx, input }: unknown) => {
      return dataSyncService.executeScheduledSync(input.scheduleId);
    }),

  // 获取调度执行历史
  getScheduleHistory: protectedProcedure
    .input(z.object({ scheduleId: z.number(), limit: z.number().default(20) }))
    // @ts-ignore
    .query(async ({ ctx, input }: unknown) => {
      return dataSyncService.getScheduleHistory(input.scheduleId, input.limit);
    }),

  // 获取调度详细执行历史
  getScheduleExecutionHistory: protectedProcedure
    .input(z.object({ scheduleId: z.number(), limit: z.number().default(50) }))
    // @ts-ignore
    .query(async ({ ctx, input }: unknown) => {
      return dataSyncService.getScheduleExecutionHistory(input.scheduleId, input.limit);
    // @ts-ignore
    }),

  // 获取调度执行统计
  getScheduleExecutionStats: protectedProcedure
    .input(z.object({ scheduleId: z.number() }))
    // @ts-ignore
    .query(async ({ ctx, input }: unknown) => {
      // @ts-ignore
      return dataSyncService.getScheduleExecutionStats(input.scheduleId);
    }),

  // 手动触发调度执行（带重试）
  triggerScheduleWithRetry: protectedProcedure
    .input(z.object({ scheduleId: z.number() }))
    // @ts-ignore
    .mutation(async ({ ctx, input }: unknown) => {
      return dataSyncService.executeScheduledSyncWithRetry(input.scheduleId);
    // @ts-ignore
    }),
});


export const reportJobsRouter = router({
  // 获取报告任务统计
  // v370.4: 多租户数据隔离 - 只统计当前用户的报告任务
  // @ts-ignore
  getStats: protectedProcedure.query(async ({ ctx }: unknown) => {
    try {
      const { getDb } = await import('../db/connection');
      const { adAccounts, reportJobs } = await import('../../drizzle/schema');
      const { eq, sql: sqlTag, inArray } = await import('drizzle-orm');
      const dbInstance = await getDb();
      if (!dbInstance) return { pending: 0, submitted: 0, processing: 0, completed: 0, failed: 0 };
      const userAccountRows = await dbInstance.select({ id: adAccounts.id }).from(adAccounts).where(eq(adAccounts.userId, ctx.user.id));
      // @ts-ignore
      const userAccountIds = userAccountRows.map((r: unknown) => r.id);
      if (userAccountIds.length === 0) return { pending: 0, submitted: 0, processing: 0, completed: 0, failed: 0 };
      const stats = await dbInstance.select({
        status: reportJobs.status,
        count: sqlTag<number>`count(*)`,
      }).from(reportJobs)
        .where(sqlTag`${reportJobs.accountId} IN (${sqlTag.raw(userAccountIds.join(','))})`)
        .groupBy(reportJobs.status);
      const result: Record<string, number> = { pending: 0, submitted: 0, processing: 0, completed: 0, failed: 0 };
      for (const stat of stats) {
        if (stat.status && stat.status in result) result[stat.status] = Number(stat.count);
      }
      return result;
    } catch {
      return asyncReportService.getJobStats();
    }
  }),

  // 获取调度器状态
  getSchedulerStatus: protectedProcedure.query(async () => {
    return reportJobScheduler.getStatus();
  }),

  // 手动触发一次处理周期
  runOnce: protectedProcedure.mutation(async () => {
    // @ts-ignore
    return reportJobScheduler.runOnce();
  }),

  // 创建归因回溯任务
  createAttributionJobs: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      profileId: z.string(),
    }))
    // @ts-ignore
    .mutation(async ({ ctx, input }: unknown) => {
      // @ts-ignore
      const jobIds = await asyncReportService.createAttributionJobs(input.accountId, input.profileId);
      return { success: true, jobCount: jobIds.length, jobIds };
    }),

  // 创建初始化任务（新店铺）
  createInitializationJobs: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      // @ts-ignore
      profileId: z.string(),
    }))
    // @ts-ignore
    .mutation(async ({ ctx, input }: unknown) => {
      const jobIds = await asyncReportService.createInitializationJobs(input.accountId, input.profileId);
      return { success: true, jobCount: jobIds.length, jobIds };
    }),

  // 清理过期任务
  cleanupExpiredJobs: protectedProcedure
    .input(z.object({ daysOld: z.number().default(7) }))
    // @ts-ignore
    .mutation(async ({ ctx, input }: unknown) => {
      const count = await asyncReportService.cleanupExpiredJobs(input.daysOld);
      return { success: true, deletedCount: count };
    // @ts-ignore
    }),

  // 开始账号初始化
  startInitialization: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    // @ts-ignore
    .mutation(async ({ ctx, input }: unknown) => {
      // @ts-ignore
      return accountInitializationService.startInitialization(input.accountId);
    }),

  // 获取初始化进度
  getInitializationProgress: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    // @ts-ignore
    .query(async ({ ctx, input }: unknown) => {
      return accountInitializationService.getInitializationProgress(input.accountId);
    }),

  // 重试失败的初始化
  retryFailedInitialization: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    // @ts-ignore
    .mutation(async ({ ctx, input }: unknown) => {
      // @ts-ignore
      return accountInitializationService.retryFailedInitialization(input.accountId);
    // @ts-ignore
    }),

  // 获取待初始化的账号列表
  // v370.4: 多租户数据隔离 - 只返回当前用户的账户
  // @ts-ignore
  getPendingInitializationAccounts: protectedProcedure.query(async ({ ctx }: unknown) => {
    const allPending = await accountInitializationService.getPendingInitializationAccounts();
    // 过滤只返回当前用户的账户
    try {
      // @ts-ignore
      const { getDb } = await import('../db/connection');
      const { adAccounts } = await import('../../drizzle/schema');
      const { eq } = await import('drizzle-orm');
      const dbInstance = await getDb();
      if (!dbInstance) return allPending;
      const userAccountRows = await dbInstance.select({ id: adAccounts.id }).from(adAccounts).where(eq(adAccounts.userId, ctx.user.id));
      // @ts-ignore
      const userAccountIds = new Set(userAccountRows.map((r: unknown) => r.id));
      // @ts-ignore
      return allPending.filter((a: unknown) => userAccountIds.has(a.id));
    } catch {
      return [];
    }
  }),

  // 执行智能同步
  executeSmartSync: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    // @ts-ignore
    .mutation(async ({ ctx, input }: unknown) => {
      return smartSyncService.executeSmartSync(input.accountId);
    }),

  // 获取同步统计
  getSyncStats: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    // @ts-ignore
    .query(async ({ ctx, input }: unknown) => {
      return smartSyncService.getSyncStats(input.accountId);
    }),

  // 获取任务数量对比
  getTaskComparison: protectedProcedure.query(async () => {
    return smartSyncService.getTaskComparison();
  // @ts-ignore
  }),

  // ===== 智能分层同步（方案五） =====
  
  // 获取分层配置
  getTierConfig: protectedProcedure.query(async () => {
    return tieredSyncService.getTierConfig();
  // @ts-ignore
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
    // @ts-ignore
    .mutation(async ({ ctx, input }: unknown) => {
      return tieredSyncService.createTieredInitializationTasks(input.accountId, input.profileId);
    }),

  // 获取分层初始化进度
  getTieredInitializationStats: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    // @ts-ignore
    .query(async ({ ctx, input }: unknown) => {
      return tieredSyncService.getInitializationStats(input.accountId);
    // @ts-ignore
    }),

  // 获取任务进度（断点续传支持）
  getTaskProgress: protectedProcedure
    .input(z.object({ taskId: z.number() }))
    // @ts-ignore
    .query(async ({ ctx, input }: unknown) => {
      return tieredSyncService.getTaskProgress(input.taskId);
    }),

  // 重试失败的任务（增量重试）
  retryFailedTieredTasks: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      maxRetries: z.number().default(3),
    }))
    // @ts-ignore
    .mutation(async ({ ctx, input }: unknown) => {
      return tieredSyncService.retryFailedTasks(input.accountId, input.maxRetries);
    }),

  // 检查任务完成状态
  checkTaskCompletion: protectedProcedure
    .input(z.object({ taskId: z.number() }))
    // @ts-ignore
    .query(async ({ ctx, input }: unknown) => {
      return tieredSyncService.checkTaskCompletion(input.taskId);
    }),
});
