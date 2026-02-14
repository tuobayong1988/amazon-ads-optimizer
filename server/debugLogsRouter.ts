import { router, protectedProcedure } from './_core/trpc';
import { z } from 'zod';
import { getDb } from './db';
import { sql } from 'drizzle-orm';

export const debugLogsRouter = router({
  /**
   * 读取最近的debug日志
   */
  getRecentLogs: protectedProcedure
    .input(z.object({
      limit: z.number().optional().default(100),
      accountId: z.number().optional(),
      logType: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) {
        return { logs: [], error: '数据库连接失败' };
      }

      try {
        let query = 'SELECT * FROM debug_logs WHERE 1=1';
        const params: any[] = [];

        if (input.accountId) {
          query += ' AND account_id = ?';
          params.push(input.accountId);
        }

        if (input.logType) {
          query += ' AND log_type = ?';
          params.push(input.logType);
        }

        query += ' ORDER BY created_at DESC LIMIT ?';
        params.push(input.limit);

        const logs = await db.execute(sql.raw(query, params));
        
        return {
          logs: logs.rows || [],
          total: logs.rows?.length || 0
        };
      } catch (error: any) {
        return {
          logs: [],
          error: error.message || '查询失败'
        };
      }
    }),

  /**
   * 清空debug日志
   */
  clearLogs: protectedProcedure
    .mutation(async () => {
      const db = await getDb();
      if (!db) {
        return { success: false, error: '数据库连接失败' };
      }

      try {
        await db.execute(sql`DELETE FROM debug_logs`);
        return { success: true };
      } catch (error: any) {
        return {
          success: false,
          error: error.message || '清空失败'
        };
      }
    }),
});
