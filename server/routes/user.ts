/**
 * 用户偏好路由
 * v234: 支持用户自定义Dashboard布局等偏好设置
 */
import { protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { getDb } from "../db";
import { sql } from "drizzle-orm";

// 缓存：是否已确认 preferences 列存在
let columnEnsured = false;

async function ensurePreferencesColumn(db: any) {
  if (columnEnsured) return;
  
  try {
    await db.execute(sql`SELECT preferences FROM users LIMIT 1`);
    columnEnsured = true;
  } catch (error: any) {
    try {
      await db.execute(sql`ALTER TABLE users ADD COLUMN preferences JSON DEFAULT NULL`);
      console.log('[User] preferences column added to users table');
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
        sql`SELECT id, preferences FROM users WHERE id = ${ctx.user.id} LIMIT 1`
      ) as any;
      
      // result = [rows, fields] for mysql2
      const rows = result[0];
      
      if (Array.isArray(rows) && rows.length > 0) {
        const row = rows[0];
        if (row.preferences) {
          const prefs = row.preferences;
          return typeof prefs === 'string' ? JSON.parse(prefs) : prefs;
        }
        // 有行但preferences为null
        return { _debug: { foundUser: true, userId: row.id, prefsIsNull: true } };
      }
      
      // 没找到用户
      return { _debug: { foundUser: false, searchedId: ctx.user.id, ctxUserType: typeof ctx.user.id } };
    } catch (error: any) {
      return { _error: error?.message };
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
          sql`SELECT id, preferences FROM users WHERE id = ${ctx.user.id} LIMIT 1`
        ) as any;
        
        const rows = result[0];
        const row = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
        
        let currentPrefs: Record<string, any> = {};
        if (row && row.preferences) {
          const prefs = row.preferences;
          currentPrefs = typeof prefs === 'string' ? JSON.parse(prefs) : prefs;
        }
        
        // 合并更新
        currentPrefs[input.key] = input.value;
        const prefsJson = JSON.stringify(currentPrefs);
        
        // 方法1: 使用JSON_SET或直接赋值（不用CAST）
        const updateResult = await db.execute(
          sql`UPDATE users SET preferences = ${prefsJson} WHERE id = ${ctx.user.id}`
        ) as any;
        
        // 检查影响行数
        const affectedRows = updateResult[0]?.affectedRows ?? updateResult?.affectedRows ?? 'unknown';
        
        // 如果方法1不行，尝试使用raw SQL
        if (affectedRows === 0 || affectedRows === 'unknown') {
          // 尝试直接用raw SQL
          await db.execute(sql.raw(
            `UPDATE users SET preferences = '${prefsJson.replace(/'/g, "\\'")}' WHERE id = ${ctx.user.id}`
          ));
        }
        
        // 验证
        const verifyResult = await db.execute(
          sql`SELECT preferences FROM users WHERE id = ${ctx.user.id} LIMIT 1`
        ) as any;
        const verifyRow = verifyResult[0]?.[0];
        
        return { 
          success: true, 
          _debug: {
            affectedRows,
            userId: ctx.user.id,
            userIdType: typeof ctx.user.id,
            foundUser: !!row,
            foundUserId: row?.id,
            wrote: prefsJson.substring(0, 80),
            verifyPrefs: verifyRow?.preferences ? 'has_data' : 'null',
            verifyPrefsType: typeof verifyRow?.preferences,
            updateResultKeys: Object.keys(updateResult[0] || {}),
          }
        };
      } catch (error: any) {
        return { success: false, error: error?.message, stack: error?.stack?.split('\n').slice(0, 3) };
      }
    }),
});
