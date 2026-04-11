// Extracted from production dist/index.js
// Original module: server/sync/infrastructure/shardManager.ts
// Lines: 48

async function acquireLock2(lockKey, holderId, ttlMs = 3e5) {
  const db = await getDb();
  if (!db) return false;
  try {
    const ttlSeconds = Math.ceil(ttlMs / 1e3);
    await db.delete(syncLocks).where(lte(syncLocks.expiresAt, sql`NOW()`));
    await db.execute(sql`INSERT INTO sync_locks (lock_key, holder_id, acquired_at, expires_at) VALUES (${lockKey}, ${holderId}, NOW(), DATE_ADD(NOW(), INTERVAL ${sql.raw(String(ttlSeconds))} SECOND))`);
    log168.info(`[v518] \u9501\u8D85\u65F6\u8BBE\u7F6E: ${lockKey}, TTL=${Math.round(ttlMs / 6e4)}\u5206\u949F`);
    log168.debug(`[v358] \u83B7\u53D6\u9501\u6210\u529F: ${lockKey} by ${holderId}`);
    return true;
  } catch (error48) {
    if (error48.code === "ER_DUP_ENTRY" || error48.message?.includes("Duplicate")) {
      log168.debug(`[v358] \u9501\u5DF2\u88AB\u5360\u7528: ${lockKey}`);
      return false;
    }
    log168.warn(`[v358] \u83B7\u53D6\u9501\u5F02\u5E38: ${error48.message}`);
    return false;
  }
}
async function releaseLock3(lockKey, holderId) {
  const db = await getDb();
  if (!db) return false;
  try {
    await db.delete(syncLocks).where(and(
      eq(syncLocks.lockKey, lockKey),
      eq(syncLocks.holderId, holderId)
    ));
    log168.debug(`[v358] \u91CA\u653E\u9501\u6210\u529F: ${lockKey}`);
    return true;
  } catch (error48) {
    log168.warn(`[v358] \u91CA\u653E\u9501\u5931\u8D25: ${error48.message}`);
    return false;
  }
}
var log168;
var init_shardManager = __esm({
  "server/sync/infrastructure/shardManager.ts"() {
    "use strict";
    init_drizzle_orm();
    init_db2();
    init_schema2();
    init_logger();
    log168 = createModuleLogger("shardManager");
    __name(acquireLock2, "acquireLock");
    __name(releaseLock3, "releaseLock");
  }
});

