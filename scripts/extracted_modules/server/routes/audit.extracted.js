// Extracted from production dist/index.js
// Original module: server/routes/audit.ts
// Lines: 80

var auditRouter;
var init_audit = __esm({
  "server/routes/audit.ts"() {
    "use strict";
    init_trpc();
    init_zod();
    auditRouter = router({
      // 获取审计日志列表
      list: protectedProcedure.input(external_exports.object({
        actionTypes: external_exports.array(external_exports.string()).optional(),
        targetTypes: external_exports.array(external_exports.string()).optional(),
        accountId: external_exports.number().optional(),
        status: external_exports.string().optional(),
        startDate: external_exports.date().optional(),
        endDate: external_exports.date().optional(),
        search: external_exports.string().optional(),
        page: external_exports.number().default(1),
        pageSize: external_exports.number().default(20),
        viewAll: external_exports.boolean().optional(),
        // 管理员查看所有用户日志
        filterUserId: external_exports.number().optional()
        // 管理员筛选特定用户
      })).query(async ({ ctx, input }) => {
        const { getAuditLogs: getAuditLogs2 } = await Promise.resolve().then(() => (init_auditService(), auditService_exports));
        const isAdmin = ctx.user.role === "admin" && ctx.user.organizationId === 1;
        const userId = isAdmin && input.viewAll ? input.filterUserId || void 0 : ctx.user.id;
        return getAuditLogs2({
          ...input,
          userId
        });
      }),
      // v370.4: 数据隔离 - 获取单个审计日志详情
      getById: protectedProcedure.input(external_exports.object({ id: external_exports.number() })).query(async ({ ctx, input }) => {
        const { getAuditLogById: getAuditLogById2 } = await Promise.resolve().then(() => (init_auditService(), auditService_exports));
        const log216 = await getAuditLogById2(input.id);
        if (log216 && log216.userId !== ctx.user.id && !(ctx.user.role === "admin" && ctx.user.organizationId === 1)) {
          throw new (await Promise.resolve().then(() => (init_dist(), dist_exports))).TRPCError({ code: "FORBIDDEN", message: "Access denied" });
        }
        return log216;
      }),
      // 获取用户操作统计（管理员可查看全部用户的汇总统计）
      userStats: protectedProcedure.input(external_exports.object({ days: external_exports.number().default(30), viewAll: external_exports.boolean().optional() })).query(async ({ ctx, input }) => {
        const { getUserAuditStats: getUserAuditStats2 } = await Promise.resolve().then(() => (init_auditService(), auditService_exports));
        const isAdmin = ctx.user.role === "admin" && ctx.user.organizationId === 1;
        const userId = isAdmin && input.viewAll !== false ? void 0 : ctx.user.id;
        return getUserAuditStats2(userId, input.days);
      }),
      // 获取账号操作统计
      accountStats: protectedProcedure.input(external_exports.object({ accountId: external_exports.number(), days: external_exports.number().default(30) })).query(async ({ ctx, input }) => {
        const { getAccountAuditStats: getAccountAuditStats2 } = await Promise.resolve().then(() => (init_auditService(), auditService_exports));
        return getAccountAuditStats2(input.accountId, input.days);
      }),
      // 导出审计日志
      export: protectedProcedure.input(external_exports.object({
        actionTypes: external_exports.array(external_exports.string()).optional(),
        accountId: external_exports.number().optional(),
        startDate: external_exports.date().optional(),
        endDate: external_exports.date().optional()
      })).mutation(async ({ ctx, input }) => {
        const { exportAuditLogsToCSV: exportAuditLogsToCSV2 } = await Promise.resolve().then(() => (init_auditService(), auditService_exports));
        const csv = await exportAuditLogsToCSV2({
          ...input,
          userId: ctx.user.id
        });
        return { csv };
      }),
      // 获取操作类型和描述
      // v360: P3-2安全加固 - 操作类型元数据也需要认证
      getActionTypes: protectedProcedure.query(async () => {
        const { ACTION_CATEGORIES: ACTION_CATEGORIES2, ACTION_DESCRIPTIONS: ACTION_DESCRIPTIONS2, TARGET_TYPE_DESCRIPTIONS: TARGET_TYPE_DESCRIPTIONS2 } = await Promise.resolve().then(() => (init_auditService(), auditService_exports));
        return {
          categories: ACTION_CATEGORIES2,
          actionDescriptions: ACTION_DESCRIPTIONS2,
          targetTypeDescriptions: TARGET_TYPE_DESCRIPTIONS2
        };
      })
    });
  }
});

