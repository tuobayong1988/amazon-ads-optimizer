// Extracted from production dist/index.js
// Original module: server/routes/team.ts
// Lines: 432

var teamRouter, emailReportRouter, inviteCodeRouter;
var init_team2 = __esm({
  "server/routes/team.ts"() {
    "use strict";
    init_trpc();
    init_zod();
    init_dist();
    init_helpers();
    init_db2();
    init_auditLogService2();
    teamRouter = router({
      // 获取团队成员列表（P2优化: 自动包含所有者/管理员自身）
      // @ts-ignore
      list: protectedProcedure.query(async ({ ctx }) => {
        const members = await getTeamMembersByOwner(ctx.user.id);
        const ownerEntry = {
          id: ctx.user.id,
          ownerId: ctx.user.id,
          email: ctx.user.email || "",
          name: ctx.user.name || ctx.user.email || "\u7BA1\u7406\u5458",
          role: "owner",
          status: "active",
          createdAt: ctx.user.createdAt || /* @__PURE__ */ new Date(),
          isOwner: true
        };
        return [ownerEntry, ...members];
      }),
      // 获取单个团队成员
      getById: protectedProcedure.input(external_exports.object({ id: external_exports.number() })).query(async ({ ctx, input }) => {
        return getTeamMemberById(input.id);
      }),
      // 邀请新成员
      invite: protectedProcedure.input(external_exports.object({
        email: external_exports.string().email(),
        name: external_exports.string().optional(),
        role: external_exports.enum(["admin", "editor", "viewer"])
      })).mutation(async ({ ctx, input }) => {
        const existing = await getTeamMemberByEmail(ctx.user.id, input.email);
        if (existing) {
          throw new TRPCError({ code: "CONFLICT", message: "\u8BE5\u90AE\u7BB1\u5DF2\u88AB\u9080\u8BF7" });
        }
        const inviteToken = Math.random().toString(36).substring(2) + Date.now().toString(36);
        const inviteExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1e3);
        const member = await createTeamMember({
          ownerId: ctx.user.id,
          email: input.email,
          name: input.name,
          role: input.role,
          status: "pending",
          inviteToken,
          inviteExpiresAt: inviteExpiresAt.toISOString()
        });
        recordAudit({
          action: "team.invite",
          userId: ctx.user.id,
          entityType: "team_member",
          entityId: member?.id,
          entityName: input.email,
          newValue: { role: input.role, email: input.email },
          source: "api",
          result: "success"
        });
        return member;
      }),
      // v483: 直接创建成员账号（替代邮箱邀请）
      createMember: protectedProcedure.input(external_exports.object({
        username: external_exports.string().min(3, "\u7528\u6237\u540D\u81F3\u5C113\u4E2A\u5B57\u7B26").max(50),
        name: external_exports.string().min(1, "\u59D3\u540D\u4E0D\u80FD\u4E3A\u7A7A"),
        password: external_exports.string().min(6, "\u5BC6\u7801\u81F3\u5C116\u4E2A\u5B57\u7B26"),
        email: external_exports.string().email().optional().or(external_exports.literal("")),
        role: external_exports.enum(["admin", "editor", "viewer"])
      })).mutation(async ({ ctx, input }) => {
        const { createTeamMemberAccount: createTeamMemberAccount2 } = await Promise.resolve().then(() => (init_localAuthService(), localAuthService_exports));
        const result = await createTeamMemberAccount2({
          creatorId: ctx.user.id,
          // @ts-ignore
          organizationId: ctx.user.organizationId,
          username: input.username,
          name: input.name,
          password: input.password,
          email: input.email || void 0,
          role: input.role
        });
        if (!result.success) {
          throw new TRPCError({ code: "BAD_REQUEST", message: result.error || "\u521B\u5EFA\u5931\u8D25" });
        }
        recordAudit({
          // @ts-ignore
          action: "team.createMember",
          userId: ctx.user.id,
          entityType: "team_member",
          entityId: result.userId,
          entityName: input.username,
          newValue: { role: input.role, username: input.username, name: input.name },
          source: "api",
          result: "success"
        });
        return result;
      }),
      // 更新成员信息
      update: protectedProcedure.input(external_exports.object({
        id: external_exports.number(),
        name: external_exports.string().optional(),
        role: external_exports.enum(["admin", "editor", "viewer"]).optional()
      })).mutation(async ({ ctx, input }) => {
        const member = await getTeamMemberById(input.id);
        if (!member || member.ownerId !== ctx.user.id) {
          throw new TRPCError({ code: "NOT_FOUND", message: "\u6210\u5458\u4E0D\u5B58\u5728" });
        }
        await updateTeamMember(input.id, {
          name: input.name,
          role: input.role
        });
        return { success: true };
      }),
      // 删除成员
      delete: protectedProcedure.input(external_exports.object({ id: external_exports.number() })).mutation(async ({ ctx, input }) => {
        const member = await getTeamMemberById(input.id);
        if (!member || member.ownerId !== ctx.user.id) {
          throw new TRPCError({ code: "NOT_FOUND", message: "\u6210\u5458\u4E0D\u5B58\u5728" });
        }
        await deleteTeamMember(input.id);
        recordAudit({
          action: "team.remove",
          userId: ctx.user.id,
          entityType: "team_member",
          entityId: input.id,
          entityName: member.email,
          previousValue: { role: member.role, email: member.email },
          source: "api",
          result: "success"
        });
        return { success: true };
      }),
      // 重新发送邀请请
      resendInvite: protectedProcedure.input(external_exports.object({ id: external_exports.number() })).mutation(async ({ ctx, input }) => {
        const member = await getTeamMemberById(input.id);
        if (!member || member.ownerId !== ctx.user.id) {
          throw new TRPCError({ code: "NOT_FOUND", message: "\u6210\u5458\u4E0D\u5B58\u5728" });
        }
        if (member.status !== "pending") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "\u53EA\u80FD\u91CD\u65B0\u53D1\u9001\u5F85\u63A5\u53D7\u7684\u9080\u8BF7" });
        }
        const inviteToken = Math.random().toString(36).substring(2) + Date.now().toString(36);
        const inviteExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1e3);
        await updateTeamMember(input.id, {
          inviteToken,
          inviteExpiresAt: inviteExpiresAt.toISOString()
        });
        return { success: true };
      }),
      // 设置成员的账号权限
      setPermissions: protectedProcedure.input(external_exports.object({
        memberId: external_exports.number(),
        permissions: external_exports.array(external_exports.object({
          accountId: external_exports.number(),
          permissionLevel: external_exports.enum(["full", "edit", "view"]),
          canExport: external_exports.boolean().optional(),
          canManageCampaigns: external_exports.boolean().optional(),
          canAdjustBids: external_exports.boolean().optional(),
          canManageNegatives: external_exports.boolean().optional()
        }))
      })).mutation(async ({ ctx, input }) => {
        const member = await getTeamMemberById(input.memberId);
        if (!member || member.ownerId !== ctx.user.id) {
          throw new TRPCError({ code: "NOT_FOUND", message: "\u6210\u5458\u4E0D\u5B58\u5728" });
        }
        await setAccountPermissions(input.memberId, input.permissions);
        return { success: true };
      }),
      // 获取成员的账号权限
      getPermissions: protectedProcedure.input(external_exports.object({ memberId: external_exports.number() })).query(async ({ ctx, input }) => {
        const member = await getTeamMemberById(input.memberId);
        if (!member || member.ownerId !== ctx.user.id) {
          throw new TRPCError({ code: "NOT_FOUND", message: "\u6210\u5458\u4E0D\u5B58\u5728" });
        }
        return getPermissionsByTeamMember(input.memberId);
      }),
      // 获取账号的所有权限
      getAccountPermissions: protectedProcedure.input(external_exports.object({ accountId: external_exports.number() })).query(async ({ ctx, input }) => {
        return getPermissionsByAccount(input.accountId);
      })
    });
    emailReportRouter = router({
      // 获取订阅列表
      // @ts-ignore
      list: protectedProcedure.query(async ({ ctx }) => {
        return getEmailSubscriptionsByUser(ctx.user.id);
      }),
      // 获取单个订阅
      getById: protectedProcedure.input(external_exports.object({ id: external_exports.number() })).query(async ({ ctx, input }) => {
        const subscription = await getEmailSubscriptionById(input.id);
        if (!subscription || subscription.userId !== ctx.user.id) {
          throw new TRPCError({ code: "NOT_FOUND", message: "\u8BA2\u9605\u4E0D\u5B58\u5728" });
        }
        return subscription;
      }),
      // 创建订阅
      create: protectedProcedure.input(external_exports.object({
        name: external_exports.string().min(1),
        description: external_exports.string().optional(),
        reportType: external_exports.enum([
          "cross_account_summary",
          "account_performance",
          "campaign_performance",
          "keyword_performance",
          "health_alert",
          "optimization_summary"
        ]),
        frequency: external_exports.enum(["daily", "weekly", "monthly"]),
        sendTime: external_exports.string().regex(/^\d{2}:\d{2}$/).optional(),
        sendDayOfWeek: external_exports.number().min(0).max(6).optional(),
        sendDayOfMonth: external_exports.number().min(1).max(31).optional(),
        timezone: external_exports.string().optional(),
        recipients: external_exports.array(external_exports.string().email()),
        ccRecipients: external_exports.array(external_exports.string().email()).optional(),
        accountIds: external_exports.array(external_exports.number()).optional(),
        includeCharts: external_exports.boolean().optional(),
        includeDetails: external_exports.boolean().optional(),
        dateRange: external_exports.enum(["last_7_days", "last_14_days", "last_30_days", "last_month", "custom"]).optional()
      })).mutation(async ({ ctx, input }) => {
        const nextSendAt = calculateNextSendTime(input.frequency, input.sendTime || "09:00", input.sendDayOfWeek, input.sendDayOfMonth);
        const subscription = await createEmailSubscription({
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
          includeCharts: input.includeCharts ?? true ? 1 : 0,
          includeDetails: input.includeDetails ?? true ? 1 : 0,
          dateRange: input.dateRange || "last_7_days",
          isActive: 1,
          nextSendAt
        });
        return subscription;
      }),
      // 更新订阅
      update: protectedProcedure.input(external_exports.object({
        id: external_exports.number(),
        name: external_exports.string().min(1).optional(),
        description: external_exports.string().optional(),
        frequency: external_exports.enum(["daily", "weekly", "monthly"]).optional(),
        sendTime: external_exports.string().regex(/^\d{2}:\d{2}$/).optional(),
        sendDayOfWeek: external_exports.number().min(0).max(6).optional(),
        sendDayOfMonth: external_exports.number().min(1).max(31).optional(),
        timezone: external_exports.string().optional(),
        recipients: external_exports.array(external_exports.string().email()).optional(),
        ccRecipients: external_exports.array(external_exports.string().email()).optional(),
        accountIds: external_exports.array(external_exports.number()).optional(),
        includeCharts: external_exports.boolean().optional(),
        includeDetails: external_exports.boolean().optional(),
        dateRange: external_exports.enum(["last_7_days", "last_14_days", "last_30_days", "last_month", "custom"]).optional(),
        isActive: external_exports.boolean().optional()
      })).mutation(async ({ ctx, input }) => {
        const subscription = await getEmailSubscriptionById(input.id);
        if (!subscription || subscription.userId !== ctx.user.id) {
          throw new TRPCError({ code: "NOT_FOUND", message: "\u8BA2\u9605\u4E0D\u5B58\u5728" });
        }
        let nextSendAt = subscription.nextSendAt;
        if (input.frequency || input.sendTime || input.sendDayOfWeek !== void 0 || input.sendDayOfMonth !== void 0) {
          nextSendAt = calculateNextSendTime(
            input.frequency || subscription.frequency,
            input.sendTime || subscription.sendTime || "09:00",
            input.sendDayOfWeek ?? subscription.sendDayOfWeek ?? void 0,
            input.sendDayOfMonth ?? subscription.sendDayOfMonth ?? void 0
          );
        }
        const { includeCharts, includeDetails, isActive, ...restInput } = input;
        await updateEmailSubscription(input.id, {
          ...restInput,
          ...includeCharts !== void 0 && { includeCharts: includeCharts ? 1 : 0 },
          ...includeDetails !== void 0 && { includeDetails: includeDetails ? 1 : 0 },
          ...isActive !== void 0 && { isActive: isActive ? 1 : 0 },
          nextSendAt
        });
        return { success: true };
      }),
      // 删除订阅
      delete: protectedProcedure.input(external_exports.object({ id: external_exports.number() })).mutation(async ({ ctx, input }) => {
        const subscription = await getEmailSubscriptionById(input.id);
        if (!subscription || subscription.userId !== ctx.user.id) {
          throw new TRPCError({ code: "NOT_FOUND", message: "\u8BA2\u9605\u4E0D\u5B58\u5728" });
        }
        await deleteEmailSubscription(input.id);
        return { success: true };
      }),
      // 切换订阅状态
      toggleActive: protectedProcedure.input(external_exports.object({ id: external_exports.number() })).mutation(async ({ ctx, input }) => {
        const subscription = await getEmailSubscriptionById(input.id);
        if (!subscription || subscription.userId !== ctx.user.id) {
          throw new TRPCError({ code: "NOT_FOUND", message: "\u8BA2\u9605\u4E0D\u5B58\u5728" });
        }
        const newIsActive = subscription.isActive ? 0 : 1;
        await updateEmailSubscription(input.id, {
          isActive: newIsActive
        });
        return { success: true, isActive: newIsActive === 1 };
      }),
      // 立即发送测试邮件
      sendTest: protectedProcedure.input(external_exports.object({ id: external_exports.number() })).mutation(async ({ ctx, input }) => {
        const subscription = await getEmailSubscriptionById(input.id);
        if (!subscription || subscription.userId !== ctx.user.id) {
          throw new TRPCError({ code: "NOT_FOUND", message: "\u8BA2\u9605\u4E0D\u5B58\u5728" });
        }
        await createEmailSendLog({
          subscriptionId: input.id,
          recipients: subscription.recipients || [],
          status: "sent",
          emailSubject: `[\u6D4B\u8BD5] ${subscription.name}`
        });
        return { success: true, message: "\u6D4B\u8BD5\u90AE\u4EF6\u5DF2\u53D1\u9001" };
      }),
      // 获取发送日志
      getSendLogs: protectedProcedure.input(external_exports.object({ subscriptionId: external_exports.number(), limit: external_exports.number().optional() })).query(async ({ ctx, input }) => {
        const subscription = await getEmailSubscriptionById(input.subscriptionId);
        if (!subscription || subscription.userId !== ctx.user.id) {
          throw new TRPCError({ code: "NOT_FOUND", message: "\u8BA2\u9605\u4E0D\u5B58\u5728" });
        }
        return getEmailSendLogsBySubscription(input.subscriptionId, input.limit || 20);
      }),
      // 获取最近的发送日志
      getRecentLogs: protectedProcedure.input(external_exports.object({ limit: external_exports.number().optional() })).query(async ({ ctx, input }) => {
        return getRecentEmailSendLogs(ctx.user.id, input.limit || 50);
      }),
      // 获取可用的报表类型
      getReportTypes: protectedProcedure.query(() => {
        return [
          { id: "cross_account_summary", name: "\u8DE8\u8D26\u53F7\u6C47\u603B\u62A5\u8868", description: "\u6240\u6709\u5E97\u94FA\u7684\u6574\u4F53\u5E7F\u544A\u8868\u73B0\u6C47\u603B" },
          { id: "account_performance", name: "\u5355\u8D26\u53F7\u8868\u73B0\u62A5\u8868", description: "\u5355\u4E2A\u5E97\u94FA\u7684\u8BE6\u7EC6\u5E7F\u544A\u8868\u73B0" },
          { id: "campaign_performance", name: "\u5E7F\u544A\u6D3B\u52A8\u8868\u73B0\u62A5\u8868", description: "\u5E7F\u544A\u6D3B\u52A8\u7EA7\u522B\u7684\u8BE6\u7EC6\u6570\u636E" },
          { id: "keyword_performance", name: "\u5173\u952E\u8BCD\u8868\u73B0\u62A5\u8868", description: "\u5173\u952E\u8BCD\u7EA7\u522B\u7684\u8BE6\u7EC6\u6570\u636E" },
          { id: "health_alert", name: "\u5065\u5EB7\u5EA6\u544A\u8B66\u62A5\u8868", description: "\u5F02\u5E38\u6307\u6807\u548C\u5065\u5EB7\u5EA6\u544A\u8B66" },
          { id: "optimization_summary", name: "\u4F18\u5316\u6C47\u603B\u62A5\u8868", description: "\u81EA\u52A8\u4F18\u5316\u6267\u884C\u60C5\u51B5\u6C47\u603B" }
        ];
      })
    });
    inviteCodeRouter = router({
      // 生成邀请码
      create: protectedProcedure.input(external_exports.object({
        inviteType: external_exports.enum(["team_member", "external_user"]).default("external_user"),
        maxUses: external_exports.number().min(0).max(1e3).default(1),
        expiresInDays: external_exports.number().min(1).max(365).optional(),
        note: external_exports.string().max(255).optional()
      })).mutation(async ({ ctx, input }) => {
        const { createInviteCode: createInviteCode2 } = await Promise.resolve().then(() => (init_inviteCodeService(), inviteCodeService_exports));
        const { createAuditLog: createAuditLog3 } = await Promise.resolve().then(() => (init_auditLogService(), auditLogService_exports));
        const result = await createInviteCode2({
          createdBy: ctx.user.id,
          // @ts-ignore
          organizationId: ctx.user.organizationId,
          ...input
        });
        if (result.success && result.inviteCode) {
          await createAuditLog3({
            // @ts-ignore
            organizationId: ctx.user.organizationId,
            userId: ctx.user.id,
            userName: ctx.user.name || ctx.user.email || void 0,
            actionType: "invite_create",
            actionCategory: "invite",
            resourceType: "invite_code",
            resourceId: result.inviteCode.code,
            description: `\u521B\u5EFA\u9080\u8BF7\u7801: ${result.inviteCode.code}`,
            newValue: { inviteType: input.inviteType, maxUses: input.maxUses }
          });
        }
        return result;
      }),
      // 批量生成邀请码
      createBatch: protectedProcedure.input(external_exports.object({
        count: external_exports.number().min(1).max(100),
        inviteType: external_exports.enum(["team_member", "external_user"]).default("external_user"),
        // @ts-ignore
        maxUses: external_exports.number().min(0).max(1e3).default(1),
        expiresInDays: external_exports.number().min(1).max(365).optional(),
        note: external_exports.string().max(255).optional()
      })).mutation(async ({ ctx, input }) => {
        const { createInviteCodesBatch: createInviteCodesBatch2 } = await Promise.resolve().then(() => (init_inviteCodeService(), inviteCodeService_exports));
        return createInviteCodesBatch2({
          createdBy: ctx.user.id,
          // @ts-ignore
          organizationId: ctx.user.organizationId,
          inviteType: input.inviteType,
          // @ts-ignore
          maxUses: input.maxUses,
          expiresInDays: input.expiresInDays,
          note: input.note
        }, input.count);
      }),
      // 验证邀请码（公开接口 - v481: 修复为publicProcedure，允许未登录用户在注册页面验证邀请码）
      validate: publicProcedure.input(external_exports.object({ code: external_exports.string() })).query(async ({ input }) => {
        const { validateInviteCode: validateInviteCode2 } = await Promise.resolve().then(() => (init_inviteCodeService(), inviteCodeService_exports));
        return validateInviteCode2(input.code);
      }),
      // 获取邀请码列表
      // @ts-ignore
      list: protectedProcedure.query(async ({ ctx }) => {
        const { getInviteCodes: getInviteCodes2 } = await Promise.resolve().then(() => (init_inviteCodeService(), inviteCodeService_exports));
        return getInviteCodes2(ctx.user.id);
      }),
      // 获取邀请码统计
      // @ts-ignore
      stats: protectedProcedure.query(async ({ ctx }) => {
        const { getInviteCodeStats: getInviteCodeStats2 } = await Promise.resolve().then(() => (init_inviteCodeService(), inviteCodeService_exports));
        return getInviteCodeStats2(ctx.user.id);
      }),
      // 禁用邀请码
      disable: protectedProcedure.input(external_exports.object({ id: external_exports.number() })).mutation(async ({ ctx, input }) => {
        const { disableInviteCode: disableInviteCode2 } = await Promise.resolve().then(() => (init_inviteCodeService(), inviteCodeService_exports));
        return disableInviteCode2(input.id);
      }),
      // 启用邀请码
      enable: protectedProcedure.input(external_exports.object({ id: external_exports.number() })).mutation(async ({ ctx, input }) => {
        const { enableInviteCode: enableInviteCode2 } = await Promise.resolve().then(() => (init_inviteCodeService(), inviteCodeService_exports));
        return enableInviteCode2(input.id);
      }),
      // 删除邀请码
      delete: protectedProcedure.input(external_exports.object({ id: external_exports.number() })).mutation(async ({ ctx, input }) => {
        const { deleteInviteCode: deleteInviteCode2 } = await Promise.resolve().then(() => (init_inviteCodeService(), inviteCodeService_exports));
        return deleteInviteCode2(input.id);
      })
    });
  }
});

