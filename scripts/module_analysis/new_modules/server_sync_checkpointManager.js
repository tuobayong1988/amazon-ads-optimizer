// server/sync/checkpointManager.ts
async function saveSyncCheckpoint(accountId, tier2, checkpoint) {
  const db = await getDb();
  if (!db) {
    log76.warn(`[v548] \u4FDD\u5B58\u68C0\u67E5\u70B9\u5931\u8D25: \u6570\u636E\u5E93\u4E0D\u53EF\u7528, \u8D26\u6237${accountId}`);
    return false;
  }
  try {
    const checkpointJson = JSON.stringify(checkpoint);
    const now = (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ");
    // P3v8: 确保表存在
    try { await db.execute(sql.raw("CREATE TABLE IF NOT EXISTS sync_checkpoints_v2 (id INT AUTO_INCREMENT PRIMARY KEY, account_id INT NOT NULL, tier VARCHAR(20) NOT NULL DEFAULT 'standard', checkpoint_data JSON, interrupt_reason VARCHAR(255), completed_steps_count INT DEFAULT 0, total_synced INT DEFAULT 0, elapsed_ms INT DEFAULT 0, saved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, UNIQUE KEY uk_account_tier (account_id, tier)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4")); } catch(_e) {}
    await db.execute(sql`
      INSERT INTO sync_checkpoints_v2 (
        account_id, tier, checkpoint_data, interrupt_reason,
        completed_steps_count, total_synced, elapsed_ms,
        saved_at, updated_at
      ) VALUES (
        ${accountId}, ${tier2}, ${checkpointJson}, ${checkpoint.interruptReason},
        ${checkpoint.completedSteps.length}, ${checkpoint.totalSynced}, ${checkpoint.elapsedMs},
        ${now}, ${now}
      )
      ON DUPLICATE KEY UPDATE
        checkpoint_data = VALUES(checkpoint_data),
        interrupt_reason = VALUES(interrupt_reason),
        completed_steps_count = VALUES(completed_steps_count),
        total_synced = VALUES(total_synced),
        elapsed_ms = VALUES(elapsed_ms),
        saved_at = VALUES(saved_at),
        updated_at = VALUES(updated_at)
    `);
    log76.info(`[v548] \u68C0\u67E5\u70B9\u5DF2\u4FDD\u5B58 - \u8D26\u6237${accountId} ${tier2}\u5C42, \u5DF2\u5B8C\u6210${checkpoint.completedSteps.length}\u6B65, \u540C\u6B65${checkpoint.totalSynced}\u6761, \u4E2D\u65AD\u539F\u56E0: ${checkpoint.interruptReason}, \u8BB0\u5F55\u7EA7\u65AD\u70B9: ${Object.keys(checkpoint.recordCheckpoints).length}\u4E2A`);
    return true;
  } catch (error48) {
    log76.warn(`[v548] \u4FDD\u5B58\u68C0\u67E5\u70B9\u5931\u8D25: ${error48.message}`);
    return false;
  }
}
async function loadSyncCheckpoint(accountId, tier2) {
  const db = await getDb();
  if (!db) return null;
  try {
    const CHECKPOINT_MAX_AGE_HOURS = 4;
    const result = await db.execute(sql`
      SELECT checkpoint_data, saved_at
      FROM sync_checkpoints_v2
      WHERE account_id = ${accountId} 
        AND tier = ${tier2}
        AND saved_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL ${CHECKPOINT_MAX_AGE_HOURS} HOUR)
      ORDER BY saved_at DESC
      LIMIT 1
    `);
    const rows = result[0] || [];
    if (!rows || rows.length === 0) return null;
    const row = rows[0];
    const checkpoint = JSON.parse(row.checkpoint_data);
    log76.info(`[v548] \u68C0\u67E5\u70B9\u5DF2\u52A0\u8F7D - \u8D26\u6237${accountId} ${tier2}\u5C42, \u5DF2\u5B8C\u6210${checkpoint.completedSteps.length}\u6B65, \u8BB0\u5F55\u7EA7\u65AD\u70B9: ${Object.keys(checkpoint.recordCheckpoints).length}\u4E2A, \u4E2D\u65AD\u539F\u56E0: ${checkpoint.interruptReason}`);
    return checkpoint;
  } catch (error48) {
    log76.warn(`[v548] \u52A0\u8F7D\u68C0\u67E5\u70B9\u5931\u8D25: ${error48.message}`);
    return null;
  }
}
async function clearSyncCheckpoint(accountId, tier2) {
  const db = await getDb();
  if (!db) return false;
  try {
    await db.execute(sql`
      DELETE FROM sync_checkpoints_v2
      WHERE account_id = ${accountId} AND tier = ${tier2}
    `);
    log76.info(`[v548] \u68C0\u67E5\u70B9\u5DF2\u6E05\u9664 - \u8D26\u6237${accountId} ${tier2}\u5C42`);
    return true;
  } catch (error48) {
    log76.warn(`[v548] \u6E05\u9664\u68C0\u67E5\u70B9\u5931\u8D25: ${error48.message}`);
    return false;
  }
}
function buildRecoveryStrategy(checkpoint) {
  const skipSteps = new Set(checkpoint.completedSteps);
  const recordRecovery = {};
  for (const [stepId, stepCp] of Object.entries(checkpoint.stepCheckpoints)) {
    if (stepCp.status === "in_progress" && checkpoint.recordCheckpoints[stepId]) {
      recordRecovery[stepId] = checkpoint.recordCheckpoints[stepId];
    }
  }
  const resumeInfo = `\u8DF3\u8FC7${skipSteps.size}\u4E2A\u5DF2\u5B8C\u6210\u6B65\u9AA4, ${Object.keys(recordRecovery).length}\u4E2A\u6B65\u9AA4\u4ECE\u8BB0\u5F55\u7EA7\u65AD\u70B9\u6062\u590D (\u4E2D\u65AD\u539F\u56E0: ${checkpoint.interruptReason}, \u5DF2\u8017\u65F6: ${Math.round(checkpoint.elapsedMs / 1e3)}s)`;
  return { skipSteps, recordRecovery, resumeInfo };
}
var log76;
var init_checkpointManager = __esm({
  "server/sync/checkpointManager.ts"() {
    "use strict";
    init_drizzle_orm();
    init_db2();
    init_logger();
    log76 = createModuleLogger("CheckpointManager");
    __name(saveSyncCheckpoint, "saveSyncCheckpoint");
    __name(loadSyncCheckpoint, "loadSyncCheckpoint");
    __name(clearSyncCheckpoint, "clearSyncCheckpoint");
    __name(buildRecoveryStrategy, "buildRecoveryStrategy");
  }
});

