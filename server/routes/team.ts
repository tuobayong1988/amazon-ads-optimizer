/**
 * 团队与邮件路由
 * 从 routers.ts 拆分的独立路由模块
 */
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { calculateNextSendTime } from './_helpers';
import * as db from "../db";
import { eq, and, gte, lte, desc } from 'drizzle-orm';
import { recordAudit } from '../services/auditLogService';


// ==================== Team Member Router ====================
export const teamRouter = router({
  // 获取团队成员列表（P2优化: 自动包含所有者/管理员自身）
  list: protectedProcedure.query(async ({ ctx }: any) => {
    const members = await db.getTeamMembersByOwner(ctx.user.id);
    // P2优化: 将当前用户（所有者）作为第一个成员显示
    const ownerEntry = {
      id: ctx.user.id,
      ownerId: ctx.user.id,
      email: ctx.user.email || '',
      name: ctx.user.name || ctx.user.email || '管理员',
      role: 'owner' as const,
      status: 'active' as const,
      createdAt: ctx.user.createdAt || new Date(),
      isOwner: true,
    };
    return [ownerEntry, ...members];
  }),

  // 获取单个团队成员
  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }: any) => {
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
      // v361: 记录团队邀请审计日志
      recordAudit({
        action: 'team.invite',
        userId: ctx.user.id,
        entityType: 'team_member',
        entityId: member?.id,
        entityName: input.email,
        newValue: { role: input.role, email: input.email },
        source: 'api',
        result: 'success',
      });
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
      // v361: 记录团队成员删除审计日志
      recordAudit({
        action: 'team.remove',
        userId: ctx.user.id,
        entityType: 'team_member',
        entityId: input.id,
        entityName: member.email,
        previousValue: { role: member.role, email: member.email },
        source: 'api',
        result: 'success',
      });
      return { success: true };
    }),
  // 重新发送邀请请
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
    .query(async ({ input }: any) => {
      return db.getPermissionsByAccount(input.accountId);
    }),
});


// ==================== Email Report Router ====================
export const emailReportRouter = router({
  // 获取订阅列表
  list: protectedProcedure.query(async ({ ctx }: any) => {
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
  getReportTypes: protectedProcedure.query(() => {
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


// ==================== Invite Code Router ====================
export const inviteCodeRouter = router({
  // 生成邀请码
  create: protectedProcedure
    .input(z.object({
      inviteType: z.enum(['team_member', 'external_user']).default('external_user'),
      maxUses: z.number().min(0).max(1000).default(1),
      expiresInDays: z.number().min(1).max(365).optional(),
      note: z.string().max(255).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { createInviteCode } = await import('../inviteCodeService');
      const { createAuditLog } = await import('../auditLogService');
      
      const result = await createInviteCode({
        createdBy: ctx.user.id,
        organizationId: (ctx.user as Record<string, any>).organizationId || 1,
        ...input,
      });
      
      if (result.success && result.inviteCode) {
        await createAuditLog({
          organizationId: (ctx.user as Record<string, any>).organizationId || 1,
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
      const { createInviteCodesBatch } = await import('../inviteCodeService');
      return createInviteCodesBatch({
        createdBy: ctx.user.id,
        organizationId: (ctx.user as Record<string, any>).organizationId || 1,
        inviteType: input.inviteType,
        maxUses: input.maxUses,
        expiresInDays: input.expiresInDays,
        note: input.note,
      }, input.count);
    }),

  // 验证邀请码（公开接口）
  validate: protectedProcedure
    .input(z.object({ code: z.string() }))
    .query(async ({ input }: any) => {
      const { validateInviteCode } = await import('../inviteCodeService');
      return validateInviteCode(input.code);
    }),

  // 获取邀请码列表
  list: protectedProcedure.query(async ({ ctx }: any) => {
    const { getInviteCodes } = await import('../inviteCodeService');
    return getInviteCodes(ctx.user.id);
  }),

  // 获取邀请码统计
  stats: protectedProcedure.query(async ({ ctx }: any) => {
    const { getInviteCodeStats } = await import('../inviteCodeService');
    return getInviteCodeStats(ctx.user.id);
  }),

  // 禁用邀请码
  disable: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }: any) => {
      const { disableInviteCode } = await import('../inviteCodeService');
      return disableInviteCode(input.id);
    }),

  // 启用邀请码
  enable: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }: any) => {
      const { enableInviteCode } = await import('../inviteCodeService');
      return enableInviteCode(input.id);
    }),

  // 删除邀请码
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }: any) => {
      const { deleteInviteCode } = await import('../inviteCodeService');
      return deleteInviteCode(input.id);
    }),
});
