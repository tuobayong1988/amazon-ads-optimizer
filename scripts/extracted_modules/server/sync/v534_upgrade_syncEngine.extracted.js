// Extracted from production dist/index.js
// Original module: server/sync/v534_upgrade_syncEngine.ts
// Lines: 47

async function cleanupStaleDbSyncJobs() {
  try {
    const database = await getDb();
    if (!database) return 0;
    const result = await database.execute(sql`
      UPDATE data_sync_jobs 
      SET status = 'failed', 
          errorMessage = CONCAT(COALESCE(errorMessage, ''), ' [v534] 进程重启导致任务中断，已自动标记为失败'),
          completedAt = NOW(),
          updated_at = NOW()
      WHERE status = 'running'
    `);
    const affected = result[0]?.affectedRows || 0;
    if (affected > 0) {
      log75.warn(`[v534] \u8FDB\u7A0B\u542F\u52A8\u6E05\u7406: \u5DF2\u5C06 ${affected} \u4E2A\u50F5\u5C38\u540C\u6B65\u4EFB\u52A1\u6807\u8BB0\u4E3Afailed`);
    }
    const pendingResult = await database.execute(sql`
      UPDATE data_sync_jobs 
      SET status = 'cancelled', 
          errorMessage = '[v534] 超时pending任务自动取消',
          completedAt = NOW(),
          updated_at = NOW()
      WHERE status = 'pending' 
        AND createdAt < DATE_SUB(NOW(), INTERVAL 2 HOUR)
    `);
    const pendingAffected = pendingResult[0]?.affectedRows || 0;
    if (pendingAffected > 0) {
      log75.warn(`[v534] \u8FDB\u7A0B\u542F\u52A8\u6E05\u7406: \u5DF2\u53D6\u6D88 ${pendingAffected} \u4E2A\u8D85\u65F6pending\u4EFB\u52A1`);
    }
    return affected + pendingAffected;
  } catch (e) {
    log75.warn(`[v534] \u50F5\u5C38\u4EFB\u52A1\u6E05\u7406\u5931\u8D25: ${e.message}`);
    return 0;
  }
}
var log75;
var init_v534_upgrade_syncEngine = __esm({
  "server/sync/v534_upgrade_syncEngine.ts"() {
    "use strict";
    init_db2();
    init_drizzle_orm();
    init_logger();
    log75 = createModuleLogger("v534:SyncUpgrade");
    __name(cleanupStaleDbSyncJobs, "cleanupStaleDbSyncJobs");
  }
});

