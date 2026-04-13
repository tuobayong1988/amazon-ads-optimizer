import { z } from "zod";
import { notifyOwner } from "./notification";
import { adminProcedure, publicProcedure, router } from "./trpc";
import { sql } from "drizzle-orm";
import { getDb, getPoolStats, getDirectConnection } from "../db";

export const systemRouter = router({
  // v350: 连接池监控API
  dbPoolStats: adminProcedure
    .query(async () => {
      const stats = getPoolStats();
      return {
        ...stats,
        timestamp: new Date().toISOString(),
      };
    }),

  // v350: 手动触发数据清理
  cleanupOldData: adminProcedure
    .input(z.object({
      retentionDays: z.number().min(7).max(90).default(30),
    }))
    // @ts-expect-error Complex function parameter types
    .mutation(async ({ input }: unknown) => {
      const conn = await getDirectConnection(120_000); // 2分钟超时
      const results: string[] = [];
      try {
        // 清理sync_conflicts
        const [r1] = await conn.execute(
          `DELETE FROM sync_conflicts WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)`,
          [input.retentionDays]
        // @ts-expect-error Dynamic type assertion
        ) as unknown[];
        // @ts-expect-error Complex function parameter types
        results.push(`sync_conflicts: 删除${r1.affectedRows}条`);

        // 清理sync_change_records
        const [r2] = await conn.execute(
          `DELETE FROM sync_change_records WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)`,
          // @ts-expect-error Legacy code type compatibility
          [input.retentionDays]
        ) as unknown[];
        // @ts-expect-error Complex function parameter types
        results.push(`sync_change_records: 删除${r2.affectedRows}条`);

        // 清理system_logs
        const [r3] = await conn.execute(
          // @ts-expect-error Conditional type narrowing
          `DELETE FROM system_logs WHERE timestamp < DATE_SUB(NOW(), INTERVAL ? DAY)`,
          [input.retentionDays]
        ) as unknown[];
        // @ts-expect-error Complex function parameter types
        results.push(`system_logs: 删除${r3.affectedRows}条`);

        // 清理optimization_tasks已完成的任务
        // @ts-expect-error DB query type inference limitation
        const [r4] = await conn.execute(
          `DELETE FROM optimization_tasks WHERE status IN ('synced', 'permanently_failed') AND created_at < DATE_SUB(NOW(), INTERVAL ? DAY)`,
          [input.retentionDays]
        ) as unknown[];
        // @ts-expect-error Complex function parameter types
        results.push(`optimization_tasks: 删除${r4.affectedRows}条`);

        return { success: true, results };
      } finally {
        conn.release();
      }
    }),

  health: publicProcedure
    .input(
      z.object({
        timestamp: z.number().min(0, "timestamp cannot be negative"),
      })
    )
    .query(() => ({
      ok: true,
    })),

  notifyOwner: adminProcedure
    .input(
      // @ts-expect-error Complex function parameter types
      z.object({
        title: z.string().min(1, "title is required"),
        content: z.string().min(1, "content is required"),
      })
    )
    // @ts-expect-error Complex function parameter types
    .mutation(async ({ input }: unknown) => {
      const delivered = await notifyOwner(input);
      return {
        success: delivered,
      } as const;
    }),

  // 数据库迁移端点 - 仅管理员可用
  // @ts-expect-error Legacy code type compatibility
  runMigration: adminProcedure
    .input(
      z.object({
        migrationName: z.string().min(1),
      })
    )
    // @ts-expect-error Complex function parameter types
    .mutation(async ({ input }: unknown) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const results: string[] = [];

      if (input.migrationName === '0020_add_bidding_logs_columns') {
        // 添加bidding_logs表缺失的列
        try {
          await db.execute(sql`ALTER TABLE bidding_logs ADD COLUMN execution_status enum('pending','success','failed','skipped') DEFAULT 'pending'`);
          results.push('Added execution_status column');
        } catch (e: unknown) {
          if ((e as Error).message?.includes('Duplicate column')) {
            results.push('execution_status column already exists');
          } else {
            results.push(`Error adding execution_status: ${(e as Error).message}`);
          }
        }

        try {
          await db.execute(sql`ALTER TABLE bidding_logs ADD COLUMN api_response_id varchar(128) DEFAULT NULL`);
          results.push('Added api_response_id column');
        } catch (e: unknown) {
          if ((e as Error).message?.includes('Duplicate column')) {
            results.push('api_response_id column already exists');
          } else {
            results.push(`Error adding api_response_id: ${(e as Error).message}`);
          }
        }

        try {
          await db.execute(sql`ALTER TABLE bidding_logs ADD COLUMN error_message text DEFAULT NULL`) as unknown;
          results.push('Added error_message column');
        } catch (e: unknown) {
          if ((e as Error).message?.includes('Duplicate column')) {
            results.push('error_message column already exists');
          } else {
            results.push(`Error adding error_message: ${(e as Error).message}`);
          }
        }
      } else {
        throw new Error(`Unknown migration: ${input.migrationName}`);
      }

      return { success: true, results };
    }),

  // 诊断端点 - 查询缺少Amazon keywordId的关键词
  diagnoseKeywords: adminProcedure
    .input(z.object({ accountId: z.number() }))
    // @ts-expect-error Complex function parameter types
    .query(async ({ input }: unknown) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      
      const result = await db.execute(sql`
        SELECT 
          COUNT(*) as total_keywords,
          SUM(CASE WHEN keyword_id IS NULL OR keyword_id = '' THEN 1 ELSE 0 END) as missing_keyword_id,
          SUM(CASE WHEN keyword_id IS NOT NULL AND keyword_id != '' THEN 1 ELSE 0 END) as has_keyword_id
        FROM keywords 
        WHERE account_id = ${input.accountId}
      `);
      
      const biddingResult = await db.execute(sql`
        SELECT 
          execution_status,
          COUNT(*) as count
        FROM bidding_logs 
        WHERE account_id = ${input.accountId}
        GROUP BY execution_status
        ORDER BY count DESC
      `);
      
      return { keywords: result[0], biddingLogs: biddingResult };
    }),
});
