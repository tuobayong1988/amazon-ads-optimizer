/**
 * 用户偏好路由
 * v234.5: 修复 - 使用team_members表（ctx.user.id来自team_members而非users表）
 */
import { protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { DbInstance, getDb } from "../db";
import { sql } from "drizzle-orm";
import { createModuleLogger } from '../utils/logger';

const log = createModuleLogger('Route_user');

// 缓存：是否已确认 preferences 列存在于 team_members 表
let columnEnsured = false;

async function ensurePreferencesColumn(db: DbInstance) {
  if (columnEnsured) return;
  
  try {
    // @ts-expect-error - Drizzle raw SQL execution
    await db.execute(sql`SELECT preferences FROM team_members LIMIT 1`) as unknown;
    columnEnsured = true;
  } catch (error: unknown) {
    try {
      // @ts-expect-error - Drizzle raw SQL execution
      await db.execute(sql`ALTER TABLE team_members ADD COLUMN preferences JSON DEFAULT NULL`) as unknown;
      log.info('[User] preferences column added to team_members table');
      columnEnsured = true;
    } catch (alterError: unknown) {
      // @ts-expect-error - error message access
      if (alterError?.message?.includes('Duplicate column')) {
        columnEnsured = true;
      } else {
        throw alterError;
      }
    }
  }
}

export const userRouter = router({
  // 获取用户偏好设置
  // @ts-ignore
  getPreferences: protectedProcedure.query(async ({ ctx }: unknown) => {
    const db = await getDb();
    if (!db) return {};
    
    try {
      await ensurePreferencesColumn(db);
      
      // @ts-expect-error - Drizzle raw SQL execution
      const result = await db.execute() as unknown;
      
      // drizzle-orm/mysql2 返回 [rows, fields]
      // @ts-expect-error - any type assertion
      const rows = result[0] as unknown;
      if (Array.isArray(rows) && rows.length > 0) {
        const prefs = rows[0].preferences;
        if (prefs) {
          return typeof prefs === 'string' ? JSON.parse(prefs) : prefs;
        }
      }
      return {};
    } catch (error: unknown) {
      // @ts-expect-error - error message access
      log.warn('[User] Failed to get preferences:', error?.message);
      return {};
    }
  }),

  // 更新用户偏好设置
  updatePreferences: protectedProcedure
    .input(z.object({
      key: z.string(),
      value: z.unknown(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { success: false };
      
      try {
        await ensurePreferencesColumn(db);
        
        // 获取当前偏好
        // @ts-expect-error - Drizzle raw SQL execution
        const result = await db.execute() as unknown;
        
        // @ts-expect-error - any type assertion
        const rows = result[0] as unknown;
        const row = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
        
        let currentPrefs: Record<string, unknown> = {};
        if (row && row.preferences) {
          const prefs = row.preferences;
          currentPrefs = typeof prefs === 'string' ? JSON.parse(prefs) : prefs;
        }
        
        // 合并更新
        currentPrefs[input.key] = input.value;
        const prefsJson = JSON.stringify(currentPrefs);
        
        // 保存到team_members表
        // @ts-expect-error - Drizzle raw SQL execution
        const updateResult = await db.execute() as unknown;
        
        // @ts-expect-error - MySQL affectedRows
        const affectedRows = updateResult[0]?.affectedRows ?? 0;
        
        if (affectedRows === 0) {
          log.warn(`[User] No rows affected when updating preferences for user ${ctx.user.id}`);
          return { success: false, error: 'User not found' };
        }
        
        log.info(`[User] Preferences updated for user ${ctx.user.id}, key: ${input.key}`);
        return { success: true };
      } catch (error: unknown) {
        log.warn(`[User] Failed to update preferences: ${(error as Error)?.message || String(error)}`);
        // @ts-expect-error - error message access
        return { success: false, error: error?.message };
      }
    }),
});
