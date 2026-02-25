/**
 * 用户偏好路由
 * v234: 支持用户自定义Dashboard布局等偏好设置
 */
import { protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { getDb } from "../db";
import { sql } from "drizzle-orm";

export const userRouter = router({
  // 获取用户偏好设置
  getPreferences: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return {};
    
    try {
      // 先确保 preferences 列存在（首次运行时自动创建）
      await db.execute(sql`
        ALTER TABLE users ADD COLUMN IF NOT EXISTS preferences JSON DEFAULT NULL
      `).catch(() => {});
      
      const [row] = await db.execute(
        sql`SELECT preferences FROM users WHERE id = ${ctx.user.id} LIMIT 1`
      );
      
      if (row && (row as any).preferences) {
        const prefs = (row as any).preferences;
        return typeof prefs === 'string' ? JSON.parse(prefs) : prefs;
      }
      return {};
    } catch (error) {
      console.warn('[User] Failed to get preferences:', error);
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
        // 先确保 preferences 列存在
        await db.execute(sql`
          ALTER TABLE users ADD COLUMN IF NOT EXISTS preferences JSON DEFAULT NULL
        `).catch(() => {});
        
        // 获取当前偏好
        const [row] = await db.execute(
          sql`SELECT preferences FROM users WHERE id = ${ctx.user.id} LIMIT 1`
        );
        
        let currentPrefs: Record<string, any> = {};
        if (row && (row as any).preferences) {
          const prefs = (row as any).preferences;
          currentPrefs = typeof prefs === 'string' ? JSON.parse(prefs) : prefs;
        }
        
        // 合并更新
        currentPrefs[input.key] = input.value;
        
        // 保存
        await db.execute(
          sql`UPDATE users SET preferences = ${JSON.stringify(currentPrefs)} WHERE id = ${ctx.user.id}`
        );
        
        return { success: true };
      } catch (error) {
        console.warn('[User] Failed to update preferences:', error);
        return { success: false };
      }
    }),
});
