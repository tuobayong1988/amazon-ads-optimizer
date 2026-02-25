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
        console.error('[User] Failed to add preferences column:', alterError?.message);
        throw alterError;
      }
    }
  }
}

export const userRouter = router({
  // 获取用户偏好设置 - 带调试信息
  getPreferences: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return {};
    
    try {
      await ensurePreferencesColumn(db);
      
      const result = await db.execute(
        sql`SELECT preferences FROM users WHERE id = ${ctx.user.id} LIMIT 1`
      );
      
      // 调试：返回原始结果结构
      const debugInfo: any = {
        resultType: typeof result,
        isArray: Array.isArray(result),
        length: Array.isArray(result) ? result.length : undefined,
      };
      
      // drizzle-orm/mysql2 返回 [rows, fields]
      let rows: any;
      if (Array.isArray(result) && result.length >= 1) {
        rows = result[0]; // 第一个元素是rows数组
        debugInfo.firstElementType = typeof rows;
        debugInfo.firstElementIsArray = Array.isArray(rows);
        if (Array.isArray(rows) && rows.length > 0) {
          debugInfo.firstRow = JSON.stringify(rows[0]);
          debugInfo.firstRowKeys = Object.keys(rows[0] || {});
          const prefs = rows[0]?.preferences;
          debugInfo.prefsType = typeof prefs;
          debugInfo.prefsValue = typeof prefs === 'string' ? prefs.substring(0, 100) : JSON.stringify(prefs)?.substring(0, 100);
          if (prefs) {
            return typeof prefs === 'string' ? JSON.parse(prefs) : prefs;
          }
        }
      }
      
      // 如果上面没有返回，返回调试信息
      return { _debug: debugInfo };
    } catch (error: any) {
      console.warn('[User] Failed to get preferences:', error?.message);
      return { _error: error?.message };
    }
  }),

  // 更新用户偏好设置 - 带调试信息
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
          sql`SELECT preferences FROM users WHERE id = ${ctx.user.id} LIMIT 1`
        ) as any;
        
        let rows = Array.isArray(result) && result.length >= 1 ? result[0] : result;
        let row = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
        
        let currentPrefs: Record<string, any> = {};
        if (row && row.preferences) {
          const prefs = row.preferences;
          currentPrefs = typeof prefs === 'string' ? JSON.parse(prefs) : prefs;
        }
        
        // 合并更新
        currentPrefs[input.key] = input.value;
        
        const prefsJson = JSON.stringify(currentPrefs);
        
        // 保存
        await db.execute(
          sql`UPDATE users SET preferences = CAST(${prefsJson} AS JSON) WHERE id = ${ctx.user.id}`
        );
        
        // 验证写入 - 立即读回
        const verifyResult = await db.execute(
          sql`SELECT preferences FROM users WHERE id = ${ctx.user.id} LIMIT 1`
        ) as any;
        let verifyRows = Array.isArray(verifyResult) && verifyResult.length >= 1 ? verifyResult[0] : verifyResult;
        let verifyRow = Array.isArray(verifyRows) && verifyRows.length > 0 ? verifyRows[0] : null;
        
        return { 
          success: true, 
          _debug: {
            wrote: prefsJson.substring(0, 100),
            readBack: verifyRow?.preferences ? JSON.stringify(verifyRow.preferences).substring(0, 100) : 'null',
            readBackType: typeof verifyRow?.preferences,
            userId: ctx.user.id
          }
        };
      } catch (error: any) {
        console.error('[User] Failed to update preferences:', error?.message);
        return { success: false, error: error?.message };
      }
    }),
});
