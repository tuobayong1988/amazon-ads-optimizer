/**
 * 用户偏好路由
 * v234.5: 修复 - 使用team_members表（ctx.user.id来自team_members而非users表）
 */
import { protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { getDb } from "../db";
import { sql } from "drizzle-orm";
import { createModuleLogger } from '../utils/logger';

const log = createModuleLogger('Route_user');

// 缓存：是否已确认 preferences 列存在于 team_members 表
let columnEnsured = false;

async function ensurePreferencesColumn(db: any) {
  if (columnEnsured) return;
  
  try {
    await db.execute(sql`SELECT preferences FROM team_members LIMIT 1`);
    columnEnsured = true;
  } catch (error: any) {
    try {
      await db.execute(sql`ALTER TABLE team_members ADD COLUMN preferences JSON DEFAULT NULL`);
      log.info('[User] preferences column added to team_members table');
      columnEnsured = true;
    } catch (alterError: any) {
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
  getPreferences: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return {};
    
    try {
      await ensurePreferencesColumn(db);
      
      const result = await db.execute(
        sql`SELECT preferences FROM team_members WHERE id = ${ctx.user.id} LIMIT 1`
      ) as any;
      
      // drizzle-orm/mysql2 返回 [rows, fields]
      const rows = result[0];
      if (Array.isArray(rows) && rows.length > 0) {
        const prefs = rows[0].preferences;
        if (prefs) {
          return typeof prefs === 'string' ? JSON.parse(prefs) : prefs;
        }
      }
      return {};
    } catch (error: any) {
      log.warn('[User] Failed to get preferences:', error?.message);
      return {};
    }
  }),

  // 更新用户偏好设置
  updatePreferences: protectedProcedure
    .input(z.object({
      key: z.string(),
      value: z.any(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { success: false };
      
      try {
        await ensurePreferencesColumn(db);
        
        // 获取当前偏好
        const result = await db.execute(
          sql`SELECT preferences FROM team_members WHERE id = ${ctx.user.id} LIMIT 1`
        ) as any;
        
        const rows = result[0];
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
        const updateResult = await db.execute(
          sql`UPDATE team_members SET preferences = ${prefsJson} WHERE id = ${ctx.user.id}`
        ) as any;
        
        const affectedRows = updateResult[0]?.affectedRows ?? 0;
        
        if (affectedRows === 0) {
          log.warn(`[User] No rows affected when updating preferences for user ${ctx.user.id}`);
          return { success: false, error: 'User not found' };
        }
        
        log.info(`[User] Preferences updated for user ${ctx.user.id}, key: ${input.key}`);
        return { success: true };
      } catch (error: any) {
        log.error('[User] Failed to update preferences:', error?.message);
        return { success: false, error: error?.message };
      }
    }),
});
