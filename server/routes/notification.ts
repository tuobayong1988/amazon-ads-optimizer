/**
 * 通知与协作路由
 * 从 routers.ts 拆分的独立路由模块
 */
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as db from "../db";
import * as notificationService from '../notificationService';
import { eq, and, gte, lte, desc } from 'drizzle-orm';


// ==================== Notification Router ====================
export const notificationRouter = router({
  // Get notification settings
  getSettings: protectedProcedure
    .query(async ({ ctx }: any) => {
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
    .mutation(async ({ ctx }: any) => {
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
    .mutation(async ({ ctx, input }: any) => {
      await db.markNotificationAsRead(input.id);
      return { success: true };
    }),
});


// ==================== Collaboration Notification Router ====================
export const collaborationRouter = router({
  // 获取用户通知列表
  list: protectedProcedure
    .input(z.object({
      status: z.string().optional(),
      page: z.number().default(1),
      pageSize: z.number().default(20),
    }))
    .query(async ({ ctx, input }) => {
      const { getUserNotifications } = await import("../collaborationNotificationService");
      return getUserNotifications({
        userId: ctx.user.id,
        ...input,
      });
    }),

  // 获取通知统计
  stats: protectedProcedure.query(async ({ ctx }: any) => {
    const { getNotificationStats } = await import("../collaborationNotificationService");
    return getNotificationStats(ctx.user.id);
  }),

  // 标记通知为已读
  markAsRead: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }: any) => {
      const { markNotificationAsRead } = await import("../collaborationNotificationService");
      return markNotificationAsRead(input.id);
    }),

  // 标记所有通知为已读
  markAllAsRead: protectedProcedure.mutation(async ({ ctx }: any) => {
    const { markAllNotificationsAsRead } = await import("../collaborationNotificationService");
    const count = await markAllNotificationsAsRead(ctx.user.id);
    return { count };
  }),

  // 获取用户通知偏好设置
  getPreferences: protectedProcedure.query(async ({ ctx }: any) => {
    const { getUserNotificationPreferences } = await import("../collaborationNotificationService");
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
      const { updateUserNotificationPreferences } = await import("../collaborationNotificationService");
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
      // @ts-ignore
      return updateUserNotificationPreferences(ctx.user.id, convertedInput as unknown);
    }),

  // 获取重要操作类型列表
  getImportantActions: protectedProcedure.query(async () => {
    const { IMPORTANT_ACTIONS, ACTION_PRIORITY, ACTION_NOTIFICATION_TEMPLATES } = await import("../collaborationNotificationService");
    return {
      importantActions: IMPORTANT_ACTIONS,
      actionPriority: ACTION_PRIORITY,
      actionTemplates: ACTION_NOTIFICATION_TEMPLATES,
    };
  }),
});
