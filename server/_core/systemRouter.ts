import { z } from "zod";
import { notifyOwner } from "./notification";
import { adminProcedure, publicProcedure, router } from "./trpc";
import { sql } from "drizzle-orm";
import { getDb } from "../db";

export const systemRouter = router({
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
      z.object({
        title: z.string().min(1, "title is required"),
        content: z.string().min(1, "content is required"),
      })
    )
    .mutation(async ({ input }) => {
      const delivered = await notifyOwner(input);
      return {
        success: delivered,
      } as const;
    }),

  // 数据库迁移端点 - 仅管理员可用
  runMigration: adminProcedure
    .input(
      z.object({
        migrationName: z.string().min(1),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const results: string[] = [];

      if (input.migrationName === '0020_add_bidding_logs_columns') {
        // 添加bidding_logs表缺失的列
        try {
          await db.execute(sql`ALTER TABLE bidding_logs ADD COLUMN execution_status enum('pending','success','failed','skipped') DEFAULT 'pending'`);
          results.push('Added execution_status column');
        } catch (e: any) {
          if (e.message?.includes('Duplicate column')) {
            results.push('execution_status column already exists');
          } else {
            results.push(`Error adding execution_status: ${e.message}`);
          }
        }

        try {
          await db.execute(sql`ALTER TABLE bidding_logs ADD COLUMN api_response_id varchar(128) DEFAULT NULL`);
          results.push('Added api_response_id column');
        } catch (e: any) {
          if (e.message?.includes('Duplicate column')) {
            results.push('api_response_id column already exists');
          } else {
            results.push(`Error adding api_response_id: ${e.message}`);
          }
        }

        try {
          await db.execute(sql`ALTER TABLE bidding_logs ADD COLUMN error_message text DEFAULT NULL`);
          results.push('Added error_message column');
        } catch (e: any) {
          if (e.message?.includes('Duplicate column')) {
            results.push('error_message column already exists');
          } else {
            results.push(`Error adding error_message: ${e.message}`);
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
    .query(async ({ input }) => {
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
