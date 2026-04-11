// Extracted from production dist/index.js
// Original module: server/routes/user.ts
// Lines: 89

async function ensurePreferencesColumn(db) {
  if (columnEnsured) return;
  try {
    await db.execute(sql`SELECT preferences FROM team_members LIMIT 1`);
    columnEnsured = true;
  } catch (error48) {
    try {
      await db.execute(sql`ALTER TABLE team_members ADD COLUMN preferences JSON DEFAULT NULL`);
      log187.info("[User] preferences column added to team_members table");
      columnEnsured = true;
    } catch (alterError) {
      if (alterError?.message?.includes("Duplicate column")) {
        columnEnsured = true;
      } else {
        throw alterError;
      }
    }
  }
}
var log187, columnEnsured, userRouter;
var init_user = __esm({
  "server/routes/user.ts"() {
    "use strict";
    init_trpc();
    init_zod();
    init_db2();
    init_drizzle_orm();
    init_logger();
    log187 = createModuleLogger("Route_user");
    columnEnsured = false;
    __name(ensurePreferencesColumn, "ensurePreferencesColumn");
    userRouter = router({
      // 获取用户偏好设置
      // @ts-ignore
      getPreferences: protectedProcedure.query(async ({ ctx }) => {
        const db = await getDb();
        if (!db) return {};
        try {
          await ensurePreferencesColumn(db);
          const result = await db.execute();
          const rows = result[0];
          if (Array.isArray(rows) && rows.length > 0) {
            const prefs = rows[0].preferences;
            if (prefs) {
              const parsedPrefs = typeof prefs === "string" ? JSON.parse(prefs) : prefs; parsedPrefs.onboardingCompleted = true; return parsedPrefs;
            }
          }
          return { onboardingCompleted: true };
        } catch (error48) {
          log187.warn("[User] Failed to get preferences:", error48?.message);
          return { onboardingCompleted: true };
        }
      }),
      // 更新用户偏好设置
      updatePreferences: protectedProcedure.input(external_exports.object({
        key: external_exports.string(),
        value: external_exports.unknown()
      })).mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) return { success: false };
        try {
          await ensurePreferencesColumn(db);
          const result = await db.execute();
          const rows = result[0];
          const row = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
          let currentPrefs = {};
          if (row && row.preferences) {
            const prefs = row.preferences;
            currentPrefs = typeof prefs === "string" ? JSON.parse(prefs) : prefs;
          }
          currentPrefs[input.key] = input.value;
          const prefsJson = JSON.stringify(currentPrefs);
          const updateResult = await db.execute();
          const affectedRows = updateResult[0]?.affectedRows ?? 0;
          if (affectedRows === 0) {
            log187.warn(`[User] No rows affected when updating preferences for user ${ctx.user.id}`);
            return { success: false, error: "User not found" };
          }
          log187.info(`[User] Preferences updated for user ${ctx.user.id}, key: ${input.key}`);
          return { success: true };
        } catch (error48) {
          log187.warn(`[User] Failed to update preferences: ${error48?.message || String(error48)}`);
          return { success: false, error: error48?.message };
        }
      })
    });
  }
});

