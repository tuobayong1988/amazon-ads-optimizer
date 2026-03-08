/**
 * 审计日志路由
 * 从 routers.ts 拆分的独立路由模块
 */
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and, gte, lte, desc } from 'drizzle-orm';


// ==================== Audit Log Router ====================
export const auditRouter = router({
  // 获取审计日志列表
  list: protectedProcedure
    .input(z.object({
      actionTypes: z.array(z.string()).optional(),
      targetTypes: z.array(z.string()).optional(),
      accountId: z.number().optional(),
      status: z.string().optional(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
      search: z.string().optional(),
      page: z.number().default(1),
      pageSize: z.number().default(20),
      viewAll: z.boolean().optional(), // 管理员查看所有用户日志
      filterUserId: z.number().optional(), // 管理员筛选特定用户
    }))
    .query(async ({ ctx, input }) => {
      const { getAuditLogs } = await import("../auditService");
      // 管理员可以查看所有用户的日志
      const isAdmin = ctx.user.role === 'admin';
      const userId = isAdmin && input.viewAll ? (input.filterUserId || undefined) : ctx.user.id;
      return getAuditLogs({
        ...input,
        userId,
      });
    }),

  // 获取单个审计日志详情
  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const { getAuditLogById } = await import("../auditService");
      return getAuditLogById(input.id);
    }),

  // 获取用户操作统计（管理员可查看全部用户的汇总统计）
  userStats: protectedProcedure
    .input(z.object({ days: z.number().default(30), viewAll: z.boolean().optional() }))
    .query(async ({ ctx, input }) => {
      const { getUserAuditStats } = await import("../auditService");
      const isAdmin = ctx.user.role === 'admin';
      // 管理员默认查看所有用户的汇总统计，普通用户只看自己的
      const userId = (isAdmin && input.viewAll !== false) ? undefined : ctx.user.id;
      return getUserAuditStats(userId, input.days);
    }),

  // 获取账号操作统计
  accountStats: protectedProcedure
    .input(z.object({ accountId: z.number(), days: z.number().default(30) }))
    .query(async ({ input }) => {
      const { getAccountAuditStats } = await import("../auditService");
      return getAccountAuditStats(input.accountId, input.days);
    }),

  // 导出审计日志
  export: protectedProcedure
    .input(z.object({
      actionTypes: z.array(z.string()).optional(),
      accountId: z.number().optional(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { exportAuditLogsToCSV } = await import("../auditService");
      const csv = await exportAuditLogsToCSV({
        ...input,
        userId: ctx.user.id,
      });
      return { csv };
    }),

  // 获取操作类型和描述
  // v360: P3-2安全加固 - 操作类型元数据也需要认证
  getActionTypes: protectedProcedure.query(async () => {
    const { ACTION_CATEGORIES, ACTION_DESCRIPTIONS, TARGET_TYPE_DESCRIPTIONS } = await import("../auditService");
    return {
      categories: ACTION_CATEGORIES,
      actionDescriptions: ACTION_DESCRIPTIONS,
      targetTypeDescriptions: TARGET_TYPE_DESCRIPTIONS,
    };
  }),
});
