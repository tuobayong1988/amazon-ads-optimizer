/**
 * 系统日志路由
 * 从 routers.ts 拆分的独立路由模块
 */
import { publicProcedure, protectedProcedure, adminProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as db from "../db";
import { logger, LogLevel } from '../utils/logger';


// ==================== v205: System Log Router ====================
export const systemLogRouter = router({
  // v371: 系统日志仅管理员可访问，防止普通用户查看服务器内部日志
  // 查询内存缓冲区日志（实时，最近5000条）
  query: adminProcedure
    .input(z.object({
      level: z.number().min(0).max(4).optional(),
      module: z.string().optional(),
      search: z.string().optional(),
      startTime: z.string().optional(),
      endTime: z.string().optional(),
      limit: z.number().min(1).max(100).optional().default(50),
      cursor: z.number().optional(),
      direction: z.enum(['newer', 'older']).optional().default('older'),
    }))
    // @ts-expect-error Complex function parameter types
    .query(async ({ ctx, input }: unknown) => {
      return logger.query(input);
    }),

  // 获取最新N条日志
  getLatest: adminProcedure
    // @ts-expect-error Complex function parameter types
    .input(z.object({ limit: z.number().min(1).max(100).optional().default(50) }))
    // @ts-expect-error Complex function parameter types
    .query(async ({ ctx, input }: unknown) => {
      return logger.getLatest(input.limit);
    }),

  // 获取错误和警告日志
  // @ts-expect-error Legacy code type compatibility
  getAlerts: adminProcedure
    .input(z.object({ limit: z.number().min(1).max(100).optional().default(50) }))
    // @ts-expect-error Complex function parameter types
    .query(async ({ ctx, input }: unknown) => {
      return logger.getAlerts(input.limit);
    }),

  // 获取特定模块的日志
  getModuleLogs: adminProcedure
    .input(z.object({
      // @ts-expect-error Legacy code type compatibility
      module: z.string(),
      limit: z.number().min(1).max(100).optional().default(50),
    }))
    // @ts-expect-error Complex function parameter types
    .query(async ({ ctx, input }: unknown) => {
      return logger.getModuleLogs(input.module, input.limit);
    }),

  // 获取日志统计信息
  getStats: adminProcedure.query(async () => {
    return logger.getStats();
  }),

  // 获取日志系统运行状态
  getStatus: adminProcedure.query(async () => {
    return logger.getStatus();
  }),

  // 查询数据库持久化日志（历史，WARN及以上）
  queryPersisted: adminProcedure
    .input(z.object({
      level: z.string().optional(),
      module: z.string().optional(),
      search: z.string().optional(),
      startTime: z.string().optional(),
      // @ts-expect-error Legacy code type compatibility
      endTime: z.string().optional(),
      limit: z.number().min(1).max(100).optional().default(50),
      offset: z.number().min(0).optional().default(0),
    }))
    // @ts-expect-error Complex function parameter types
    .query(async ({ ctx, input }: unknown) => {
      const dbInstance = await db.getDb();
      if (!dbInstance) return { logs: [], total: 0 };

      try {
        const conditions: string[] = [];
        if (input.level) conditions.push(`level = '${input.level}'`);
        if (input.module) conditions.push(`module LIKE '%${input.module.replace(/'/g, "''")}%'`);
        if (input.search) conditions.push(`message LIKE '%${input.search.replace(/'/g, "''")}%'`);
        if (input.startTime) conditions.push(`timestamp >= '${input.startTime}'`);
        if (input.endTime) conditions.push(`timestamp <= '${input.endTime}'`);

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        // @ts-expect-error - Drizzle raw SQL execution
        const [rows] = await dbInstance.execute() as unknown;

        // @ts-expect-error - Drizzle raw SQL execution
        const [countResult] = await dbInstance.execute(
          `SELECT COUNT(*) as total FROM system_logs ${whereClause}`
        ) as unknown;

        return {
          logs: rows || [],
          total: countResult?.[0]?.total || 0,
        };
      } catch (err: unknown) {
        // system_logs表可能尚未创建
        // @ts-expect-error - error code check
        if (err?.code === 'ER_NO_SUCH_TABLE') {
          return { logs: [], total: 0, message: 'system_logs表尚未创建，将在下次部署迁移时自动创建' };
        }
        throw err;
      }
    }),

  // 更新日志级别（运行时动态调整）
  // @ts-expect-error Legacy code type compatibility
  updateLevel: adminProcedure
    .input(z.object({
      consoleLevel: z.number().min(0).max(4).optional(),
      dbLevel: z.number().min(0).max(4).optional(),
    }))
    // @ts-expect-error Complex function parameter types
    .mutation(async ({ ctx, input }: unknown) => {
      const updates: Record<string, unknown> = {};
      if (input.consoleLevel !== undefined) updates.consoleLevel = input.consoleLevel;
      if (input.dbLevel !== undefined) updates.dbLevel = input.dbLevel;
      logger.updateConfig(updates);
      return { success: true, message: '日志级别已更新', updates };
    }),
});
