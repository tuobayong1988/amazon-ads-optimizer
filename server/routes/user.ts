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
    // 直接尝试查询 preferences 列，如果不存在会报错
    await db.execute(sql`SELECT preferences FROM users LIMIT 1`);
    columnEnsured = true;
  } catch (error: any) {
    // 列不存在，添加它
    try {
      await db.execute(sql`ALTER TABLE users ADD COLUMN preferences JSON DEFAULT NULL`);
      console.log('[User] preferences column added to users table');
      columnEnsured = true;
    } catch (alterError: any) {
      if (alterError?.message?.includes('Duplicate column')) {
        columnEnsured = true;
      } else {
        console.error('[User] Failed to add preferences column:', alterError?.message);
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
      
      // drizzle-orm/mysql2 的 db.execute() 返回 [rows, fields] 元组
      const [rows] = await db.execute(
        sql`SELECT preferences FROM users WHERE id = ${ctx.user.id} LIMIT 1`
      ) as any;
      
      const row = Array.isArray(rows) ? rows[0] : rows;
      
      if (row && row.preferences) {
        const prefs = row.preferences;
        return typeof prefs === 'string' ? JSON.parse(prefs) : prefs;
      }
      return {};
    } catch (error: any) {
      console.warn('[User] Failed to get preferences:', error?.message);
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
        
        // 获取当前偏好 - 使用正确的 [rows, fields] 解构
        const [rows] = await db.execute(
          sql`SELECT preferences FROM users WHERE id = ${ctx.user.id} LIMIT 1`
        ) as any;
        
        const row = Array.isArray(rows) ? rows[0] : rows;
        
        let currentPrefs: Record<string, any> = {};
        if (row && row.preferences) {
          const prefs = row.preferences;
          currentPrefs = typeof prefs === 'string' ? JSON.parse(prefs) : prefs;
        }
        
        // 合并更新
        currentPrefs[input.key] = input.value;
        
        const prefsJson = JSON.stringify(currentPrefs);
        
        // 保存 - 使用MySQL的JSON类型兼容方式
        await db.execute(
          sql`UPDATE users SET preferences = CAST(${prefsJson} AS JSON) WHERE id = ${ctx.user.id}`
        );
        
        console.log(`[User] Preferences updated for user ${ctx.user.id}, key: ${input.key}`);
        return { success: true };
      } catch (error: any) {
        console.error('[User] Failed to update preferences:', error?.message);
        return { success: false, error: error?.message };
      }
    }),
});
