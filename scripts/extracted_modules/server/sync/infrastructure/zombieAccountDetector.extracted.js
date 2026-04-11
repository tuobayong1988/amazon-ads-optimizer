// Extracted from production dist/index.js
// Original module: server/sync/infrastructure/zombieAccountDetector.ts
// Lines: 157

var zombieAccountDetector_exports = {};
__export(zombieAccountDetector_exports, {
  detectAndPauseZombieAccounts: () => detectAndPauseZombieAccounts
});
async function detectAndPauseZombieAccounts() {
  const result = {
    checkedAccounts: 0,
    detectedZombies: [],
    pausedAccounts: 0,
    errors: []
  };
  try {
    const { getDb: getDb3 } = await Promise.resolve().then(() => (init_db2(), db_exports));
    const database = await getDb3();
    if (!database) {
      result.errors.push("\u6570\u636E\u5E93\u4E0D\u53EF\u7528");
      return result;
    }
    const activeAccounts = await database.execute(sql`
      SELECT id, accountName, marketplace
      FROM ad_accounts
      WHERE status = 'active'
    `);
    const accounts = activeAccounts[0] || activeAccounts;
    if (!Array.isArray(accounts) || accounts.length === 0) {
      log130.info("[ZombieDetector] \u6CA1\u6709active\u72B6\u6001\u7684\u8D26\u6237\u9700\u8981\u68C0\u67E5");
      return result;
    }
    result.checkedAccounts = accounts.length;
    log130.info(`[ZombieDetector] \u5F00\u59CB\u68C0\u67E5 ${accounts.length} \u4E2Aactive\u8D26\u6237\u7684\u540C\u6B65\u5065\u5EB7\u72B6\u6001`);
    for (const account of accounts) {
      try {
        const accountId = account.id;
        const accountName2 = account.accountName || `Account-${accountId}`;
        const marketplace = account.marketplace || "Unknown";
        const recentSyncs = await database.execute(sql`
          SELECT recordsSynced, completedAt
          FROM data_sync_jobs
          WHERE accountId = ${accountId}
            AND status = 'completed'
          ORDER BY completedAt DESC
          LIMIT ${sql.raw(String(CHECK_WINDOW_SIZE))}
        `);
        const syncRows = recentSyncs[0] || recentSyncs;
        if (!Array.isArray(syncRows) || syncRows.length < CHECK_WINDOW_SIZE) {
          continue;
        }
        let consecutiveZeros = 0;
        for (const sync of syncRows) {
          const synced = Number(sync.recordsSynced) || 0;
          if (synced === 0) {
            consecutiveZeros++;
          } else {
            break;
          }
        }
        let lastNonZeroSyncAt = null;
        for (const sync of syncRows) {
          if (Number(sync.recordsSynced) > 0) {
            lastNonZeroSyncAt = sync.completedAt ? new Date(sync.completedAt).toISOString() : null;
            break;
          }
        }
        if (!lastNonZeroSyncAt && consecutiveZeros >= CHECK_WINDOW_SIZE) {
          const olderSync = await database.execute(sql`
 SELECT completedAt
 FROM data_sync_jobs
 WHERE accountId = ${accountId}
 AND status = 'completed'
 AND recordsSynced > 0
 ORDER BY completedAt DESC
 LIMIT 1
 `);
          const olderRows = olderSync[0] || olderSync;
          if (Array.isArray(olderRows) && olderRows.length > 0) {
            lastNonZeroSyncAt = olderRows[0].completedAt ? new Date(olderRows[0].completedAt).toISOString() : null;
          }
        }
        if (consecutiveZeros >= CONSECUTIVE_ZERO_THRESHOLD) {
          const zombie = {
            accountId,
            accountName: accountName2,
            marketplace,
            consecutiveZeroSyncs: consecutiveZeros,
            lastNonZeroSyncAt,
            autoPaused: false
          };
          try {
            await database.execute(sql`
              UPDATE ad_accounts
              SET status = 'paused'
              WHERE id = ${accountId} AND status = 'active'
            `);
            zombie.autoPaused = true;
            result.pausedAccounts++;
            const pauseMsg = `\u{1F507} \u81EA\u52A8\u6682\u505C\u50F5\u5C38\u8D26\u6237: ${accountId}(${accountName2}, ${marketplace}) \u2014 \u8FDE\u7EED${consecutiveZeros}\u6B21\u540C\u6B650\u6761\u8BB0\u5F55, \u6700\u540E\u6709\u6570\u636E: ${lastNonZeroSyncAt || "\u4ECE\u672A"}`;
            log130.warn(`[ZombieDetector] ${pauseMsg}`);
            logSyncWarn("ZombieDetector", pauseMsg, {
              accountId,
              accountName: accountName2,
              marketplace,
              consecutiveZeros,
              lastNonZeroSyncAt,
              action: "auto_paused"
            });
          } catch (pauseErr) {
            const errMsg = `\u6682\u505C\u8D26\u6237${accountId}\u5931\u8D25: ${pauseErr.message}`;
            log130.warn(`[ZombieDetector] ${errMsg}`);
            result.errors.push(errMsg);
          }
          result.detectedZombies.push(zombie);
        }
      } catch (accountErr) {
        const errMsg = `\u68C0\u67E5\u8D26\u6237${account.id}\u5931\u8D25: ${accountErr.message}`;
        log130.warn(`[ZombieDetector] ${errMsg}`);
        result.errors.push(errMsg);
      }
    }
    if (result.detectedZombies.length > 0) {
      log130.warn(`[ZombieDetector] \u68C0\u6D4B\u5B8C\u6210: \u68C0\u67E5${result.checkedAccounts}\u4E2A\u8D26\u6237, \u53D1\u73B0${result.detectedZombies.length}\u4E2A\u50F5\u5C38\u8D26\u6237, \u81EA\u52A8\u6682\u505C${result.pausedAccounts}\u4E2A`);
      logSyncWarn("ZombieDetector", `\u50F5\u5C38\u8D26\u6237\u68C0\u6D4B\u5B8C\u6210`, {
        checkedAccounts: result.checkedAccounts,
        detectedZombies: result.detectedZombies.length,
        pausedAccounts: result.pausedAccounts,
        zombies: result.detectedZombies.map((z2) => ({
          id: z2.accountId,
          name: z2.accountName,
          market: z2.marketplace,
          zeros: z2.consecutiveZeroSyncs,
          paused: z2.autoPaused
        }))
      });
    } else {
      log130.info(`[ZombieDetector] \u68C0\u6D4B\u5B8C\u6210: \u68C0\u67E5${result.checkedAccounts}\u4E2A\u8D26\u6237, \u6240\u6709\u8D26\u6237\u540C\u6B65\u6B63\u5E38`);
    }
    return result;
  } catch (error48) {
    const errMsg = `\u50F5\u5C38\u8D26\u6237\u68C0\u6D4B\u5931\u8D25: ${error48.message}`;
    log130.warn(`[ZombieDetector] ${errMsg}`);
    result.errors.push(errMsg);
    return result;
  }
}
var log130, CONSECUTIVE_ZERO_THRESHOLD, CHECK_WINDOW_SIZE;
var init_zombieAccountDetector = __esm({
  "server/sync/infrastructure/zombieAccountDetector.ts"() {
    "use strict";
    init_logger();
    init_drizzle_orm();
    init_opsLogger();
    log130 = createModuleLogger("zombieAccountDetector");
    CONSECUTIVE_ZERO_THRESHOLD = 10;
    CHECK_WINDOW_SIZE = 10;
    __name(detectAndPauseZombieAccounts, "detectAndPauseZombieAccounts");
  }
});

