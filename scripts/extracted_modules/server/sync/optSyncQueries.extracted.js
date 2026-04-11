// Extracted from production dist/index.js
// Original module: server/sync/optSyncQueries.ts
// Lines: 789

async function getCampaignTypeById(conn, campaignInternalId) {
  try {
    const [rows] = await conn.execute(
      `SELECT c.${C.campaignType}, c.${C.costType}, a.${A.marketplace} as marketplace 
       FROM ${C.table} c 
       LEFT JOIN ad_accounts a ON c.${C.accountId} = a.${A.id} 
       WHERE c.${C.id} = ? OR c.${C.campaignId} = ? LIMIT 1`,
      [campaignInternalId, String(campaignInternalId)]
    );
    if (rows.length > 0) {
      const row = rows[0];
      return {
        campaignType: String(row.campaignType || row[C.campaignType] || "sp_manual"),
        costType: String(row.costType || row[C.costType] || "cpc"),
        marketplace: String(row.marketplace || "US")
      };
    }
    return null;
  } catch (err) {
    log88.warn(`[OptSyncQueries] getCampaignTypeById\u5931\u8D25: ${err.message}`);
    return null;
  }
}
async function getCampaignTypeByKeywordId(conn, keywordInternalId) {
  try {
    const [rows] = await conn.execute(
      `SELECT c.${C.campaignType}, c.${C.costType}, a.${A.marketplace} as marketplace 
       FROM ${K.table} k
       INNER JOIN ${AG.table} ag ON k.${K.internalAdGroupId} = ag.${AG.id}
       INNER JOIN ${C.table} c ON ag.${AG.campaignId} = c.${C.campaignId}
       LEFT JOIN ad_accounts a ON c.${C.accountId} = a.${A.id}
       WHERE k.${K.id} = ? LIMIT 1`,
      [keywordInternalId]
    );
    if (rows.length > 0) {
      const row = rows[0];
      return {
        campaignType: String(row.campaignType || row[C.campaignType] || "sp_manual"),
        costType: String(row.costType || row[C.costType] || "cpc"),
        marketplace: String(row.marketplace || "US")
      };
    }
    return null;
  } catch (err) {
    log88.warn(`[OptSyncQueries] getCampaignTypeByKeywordId\u5931\u8D25: ${err.message}`);
    return null;
  }
}
async function getKeywordDetailById(conn, keywordInternalId) {
  try {
    const [rows] = await conn.execute(
      `SELECT k.${K.keywordId}, k.${K.campaignId} AS amazonCampaignId, ag.${AG.adGroupId} AS amazonAdGroupId
       FROM ${K.table} k
       INNER JOIN ${AG.table} ag ON k.${K.internalAdGroupId} = ag.${AG.id}
       WHERE k.${K.id} = ? LIMIT 1`,
      [keywordInternalId]
    );
    if (rows.length > 0) {
      const row = rows[0];
      return {
        keywordId: String(row.keywordId || row[K.keywordId] || ""),
        amazonCampaignId: String(row.amazonCampaignId || ""),
        amazonAdGroupId: String(row.amazonAdGroupId || "")
      };
    }
    return null;
  } catch (err) {
    log88.warn(`[OptSyncQueries] getKeywordDetailById\u5931\u8D25: ${err.message}`);
    return null;
  }
}
async function getCampaignDetailByAmazonId(conn, amazonCampaignId) {
  try {
    const [rows] = await conn.execute(
      `SELECT c.${C.adFormat}, c.${C.campaignName}, a.${A.marketplace} FROM ${C.table} c
       LEFT JOIN ad_accounts a ON c.${C.accountId} = a.${A.id}
       WHERE c.${C.campaignId} = ? LIMIT 1`,
      [amazonCampaignId]
    );
    if (rows.length > 0) {
      const row = rows[0];
      return {
        adFormat: row[C.adFormat] ? String(row[C.adFormat]) : null,
        campaignName: String(row.campaignName || row[C.campaignName] || ""),
        marketplace: String(row.marketplace || "US")
      };
    }
    return null;
  } catch (err) {
    log88.warn(`[OptSyncQueries] getCampaignDetailByAmazonId\u5931\u8D25: ${err.message}`);
    return null;
  }
}
async function getCampaignTypeByProductTargetId(conn, productTargetInternalId) {
  try {
    const [rows] = await conn.execute(
      `SELECT c.${C.campaignType}, c.${C.costType}, a.${A.marketplace} FROM ${PT.table} pt
       INNER JOIN ${AG.table} ag ON pt.${PT.internalAdGroupId} = ag.${AG.id}
       INNER JOIN ${C.table} c ON ag.${AG.campaignId} = c.${C.campaignId}
       LEFT JOIN ad_accounts a ON c.${C.accountId} = a.${A.id}
       WHERE pt.${PT.id} = ? LIMIT 1`,
      [productTargetInternalId]
    );
    if (rows.length > 0) {
      const row = rows[0];
      return {
        campaignType: String(row.campaignType || row[C.campaignType] || "sp_manual"),
        costType: String(row.costType || row[C.costType] || "cpc"),
        marketplace: String(row.marketplace || "US")
      };
    }
    return null;
  } catch (err) {
    log88.warn(`[OptSyncQueries] getCampaignTypeByProductTargetId\u5931\u8D25: ${err.message}`);
    return null;
  }
}
async function getFirstAdGroupIdByCampaignId(conn, amazonCampaignId) {
  try {
    const [rows] = await conn.execute(
      `SELECT ag.${AG.adGroupId} FROM ${AG.table} ag 
       WHERE ag.${AG.campaignId} = ? LIMIT 1`,
      [amazonCampaignId]
    );
    if (rows.length > 0) {
      return String(rows[0].adGroupId || rows[0][AG.adGroupId] || "");
    }
    return null;
  } catch (err) {
    log88.warn(`[OptSyncQueries] getFirstAdGroupIdByCampaignId\u5931\u8D25: ${err.message}`);
    return null;
  }
}
async function getKeywordAmazonId2(conn, keywordInternalId, excludeSkip = false) {
  try {
    const skipFilter = excludeSkip ? ` AND ${K.keywordId} NOT LIKE 'SKIP_%'` : "";
    const [rows] = await conn.execute(
      `SELECT ${K.keywordId} FROM ${K.table} WHERE ${K.id} = ? AND ${K.keywordId} IS NOT NULL${skipFilter} LIMIT 1`,
      [keywordInternalId]
    );
    if (rows.length > 0) {
      return String(rows[0][K.keywordId] || rows[0].keywordId || "");
    }
    return null;
  } catch (err) {
    log88.warn(`[OptSyncQueries] getKeywordAmazonId\u5931\u8D25: ${err.message}`);
    return null;
  }
}
async function getProductTargetAmazonId(conn, productTargetInternalId) {
  try {
    const [rows] = await conn.execute(
      `SELECT ${PT.targetId} FROM ${PT.table} WHERE ${PT.id} = ? AND ${PT.targetId} IS NOT NULL LIMIT 1`,
      [productTargetInternalId]
    );
    if (rows.length > 0) {
      return String(rows[0][PT.targetId] || rows[0].targetId || "");
    }
    return null;
  } catch (err) {
    log88.warn(`[OptSyncQueries] getProductTargetAmazonId\u5931\u8D25: ${err.message}`);
    return null;
  }
}
async function getCampaignAmazonId2(conn, campaignInternalId) {
  try {
    const [rows] = await conn.execute(
      `SELECT ${C.campaignId} FROM ${C.table} WHERE ${C.id} = ? AND ${C.campaignId} IS NOT NULL LIMIT 1`,
      [campaignInternalId]
    );
    if (rows.length > 0) {
      return String(rows[0][C.campaignId] || rows[0].campaignId || "");
    }
    return null;
  } catch (err) {
    log88.warn(`[OptSyncQueries] getCampaignAmazonId\u5931\u8D25: ${err.message}`);
    return null;
  }
}
async function getCampaignIdAndType(conn, campaignInternalId) {
  try {
    const [rows] = await conn.execute(
      `SELECT ${C.campaignId}, ${C.campaignType} FROM ${C.table} WHERE ${C.id} = ? LIMIT 1`,
      [campaignInternalId]
    );
    if (rows.length > 0) {
      const row = rows[0];
      return {
        campaignId: String(row[C.campaignId] || row.campaignId || ""),
        campaignType: String(row[C.campaignType] || row.campaignType || "sp_manual")
      };
    }
    return null;
  } catch (err) {
    log88.warn(`[OptSyncQueries] getCampaignIdAndType\u5931\u8D25: ${err.message}`);
    return null;
  }
}
async function getCampaignTypeByAmazonOrInternalId(conn, amazonCampaignId, internalId) {
  try {
    const [rows] = await conn.execute(
      `SELECT ${C.campaignType} FROM ${C.table} WHERE ${C.campaignId} = ? OR ${C.id} = ? LIMIT 1`,
      [amazonCampaignId, internalId || 0]
    );
    if (rows.length > 0) {
      const row = rows[0];
      return String(row[C.campaignType] || row.campaignType || "sp_manual");
    }
    return "sp_manual";
  } catch (err) {
    return "sp_manual";
  }
}
async function entityExists(conn, tableName, entityId) {
  const ALLOWED_TABLES = [K.table, PT.table, C.table, AG.table];
  if (!ALLOWED_TABLES.includes(tableName)) {
    log88.warn(`[OptSyncQueries] entityExists: \u975E\u6CD5\u8868\u540D ${tableName}`);
    return false;
  }
  try {
    const [rows] = await conn.execute(
      `SELECT id FROM ${tableName} WHERE id = ? LIMIT 1`,
      [entityId]
    );
    return rows.length > 0;
  } catch (err) {
    return false;
  }
}
async function updateTaskAmazonEntityId(conn, taskId, amazonEntityId) {
  await conn.execute(
    "UPDATE optimization_tasks SET amazon_entity_id = ? WHERE id = ?",
    [amazonEntityId, taskId]
  );
}
async function markTasksProcessing(conn, taskIds) {
  if (taskIds.length === 0) return;
  await conn.execute(
    `UPDATE optimization_tasks SET status = 'processing', processing_started_at = NOW() WHERE id IN (${taskIds.join(",")})`
  );
}
async function markTaskSynced(conn, taskId) {
  await conn.execute(
    `UPDATE optimization_tasks SET status = 'synced', completed_at = NOW() WHERE id = ?`,
    [taskId]
  );
  try {
    await conn.execute(
      `UPDATE optimization_events oe
       INNER JOIN optimization_tasks ot ON ot.event_id = oe.id
       SET oe.api_sync_status = 'synced', oe.api_synced_at = NOW()
       WHERE ot.id = ? AND ot.event_id IS NOT NULL`,
      [taskId]
    );
  } catch (e) {
    const msg = e.message;
    if (!msg.includes("Unknown column") && !msg.includes("doesn't exist")) {
      log88.warn(`[v509] markTaskSynced event\u56DE\u5199\u5931\u8D25: ${msg}`);
    }
  }
}
async function markTaskFailed(conn, taskId, errorMessage) {
  await conn.execute(
    `UPDATE optimization_tasks SET status = 'failed', error_message = ?, completed_at = NOW() WHERE id = ?`,
    [errorMessage.substring(0, 1e3), taskId]
  );
  try {
    await conn.execute(
      `UPDATE optimization_events oe
       INNER JOIN optimization_tasks ot ON ot.event_id = oe.id
       SET oe.api_sync_status = 'failed', oe.error_message = CONCAT(COALESCE(oe.error_message, ''), ' | ', ?)
       WHERE ot.id = ? AND ot.event_id IS NOT NULL`,
      [errorMessage.substring(0, 500), taskId]
    );
  } catch (e) {
    const msg = e.message;
    if (!msg.includes("Unknown column") && !msg.includes("doesn't exist")) {
      log88.warn(`[v509] markTaskFailed event\u56DE\u5199\u5931\u8D25: ${msg}`);
    }
  }
}
async function markTasksFailed(conn, taskIds, errorMessage) {
  if (taskIds.length === 0) return;
  await conn.execute(
    `UPDATE optimization_tasks SET status = 'failed', error_message = ?, completed_at = NOW() WHERE id IN (${taskIds.join(",")})`,
    [errorMessage.substring(0, 1e3)]
  );
  try {
    await conn.execute(
      `UPDATE optimization_events oe
       INNER JOIN optimization_tasks ot ON ot.event_id = oe.id
       SET oe.api_sync_status = 'failed', oe.error_message = CONCAT(COALESCE(oe.error_message, ''), ' | ', ?)
       WHERE ot.id IN (${taskIds.join(",")}) AND ot.event_id IS NOT NULL`,
      [errorMessage.substring(0, 500)]
    );
  } catch (e) {
    const msg = e.message;
    if (!msg.includes("Unknown column") && !msg.includes("doesn't exist")) {
      log88.warn(`[v509] markTasksFailed event\u56DE\u5199\u5931\u8D25: ${msg}`);
    }
  }
}
async function markTaskForRetry(conn, taskId, currentRetryCount, errorMessage) {
  const newRetryCount = (currentRetryCount || 0) + 1;
  let isUnrecoverable = false;
  try {
    const { classifyError: classifyError2 } = await Promise.resolve().then(() => (init_amazonApiErrorMapper(), amazonApiErrorMapper_exports));
    const mapping = classifyError2(errorMessage);
    isUnrecoverable = mapping.strategy !== "retry" && mapping.strategy !== "throttle_retry";
  } catch {
    const UNRECOVERABLE_PATTERNS = ["entityNotFoundError", "malformedValueError", "ENTITY_NOT_FOUND"];
    isUnrecoverable = UNRECOVERABLE_PATTERNS.some((p) => errorMessage.includes(p));
  }
  if (isUnrecoverable) {
    await conn.execute(
      `UPDATE optimization_tasks SET status = 'permanently_failed', error_message = ?, retry_count = ?, completed_at = NOW() WHERE id = ?`,
      [`[v509-unrecoverable] ${errorMessage}`.substring(0, 1e3), newRetryCount, taskId]
    );
    try {
      await conn.execute(
        `UPDATE optimization_events oe
         INNER JOIN optimization_tasks ot ON ot.event_id = oe.id
         SET oe.api_sync_status = 'permanently_failed', oe.error_message = CONCAT(COALESCE(oe.error_message, ''), ' | ', ?)
         WHERE ot.id = ? AND ot.event_id IS NOT NULL`,
        [`[v509-unrecoverable] ${errorMessage}`.substring(0, 500), taskId]
      );
    } catch (e) {
      const msg = e.message;
      if (!msg.includes("Unknown column") && !msg.includes("doesn't exist")) {
        log88.warn(`[v509] markTaskForRetry permanently_failed event\u56DE\u5199\u5931\u8D25: ${msg}`);
      }
    }
    return;
  }
  const MAX_RETRIES2 = 5;
  if (newRetryCount >= MAX_RETRIES2) {
    await conn.execute(
      `UPDATE optimization_tasks SET status = 'permanently_failed', error_message = ?, retry_count = ?, completed_at = NOW() WHERE id = ?`,
      [`\u8D85\u8FC7\u6700\u5927\u91CD\u8BD5\u6B21\u6570(${MAX_RETRIES2}): ${errorMessage}`.substring(0, 1e3), newRetryCount, taskId]
    );
    try {
      await conn.execute(
        `UPDATE optimization_events oe
         INNER JOIN optimization_tasks ot ON ot.event_id = oe.id
         SET oe.api_sync_status = 'permanently_failed', oe.error_message = CONCAT(COALESCE(oe.error_message, ''), ' | \u8D85\u8FC7\u6700\u5927\u91CD\u8BD5\u6B21\u6570')
         WHERE ot.id = ? AND ot.event_id IS NOT NULL`,
        [taskId]
      );
    } catch (e) {
      const msg = e.message;
      if (!msg.includes("Unknown column") && !msg.includes("doesn't exist")) {
        log88.warn(`[v509] markTaskForRetry max_retries event\u56DE\u5199\u5931\u8D25: ${msg}`);
      }
    }
  } else {
    const retryDelayMinutes = [1, 5, 15, 30, 60][newRetryCount - 1] || 60;
    await conn.execute(
      `UPDATE optimization_tasks SET status = 'retry', error_message = ?, retry_count = ?, next_retry_at = DATE_ADD(NOW(), INTERVAL ? MINUTE) WHERE id = ?`,
      [errorMessage.substring(0, 1e3), newRetryCount, retryDelayMinutes, taskId]
    );
  }
}
async function updateKeywordBid2(conn, keywordInternalId, newBid) {
  await conn.execute(
    `UPDATE ${K.table} SET ${K.bid} = ?, updatedAt = NOW() WHERE ${K.id} = ?`,
    [newBid, keywordInternalId]
  );
}
async function updateProductTargetBid2(conn, productTargetInternalId, newBid) {
  await conn.execute(
    `UPDATE ${PT.table} SET ${PT.bid} = ?, updatedAt = NOW() WHERE ${PT.id} = ?`,
    [newBid, productTargetInternalId]
  );
}
async function updateEntityStatus(conn, tableName, entityId, newStatus) {
  const TABLE_STATUS_COLUMN = {
    [K.table]: K.keywordStatus,
    [PT.table]: PT.targetStatus,
    [C.table]: C.campaignStatus,
    [AG.table]: AG.adGroupStatus
  };
  const statusColumn = TABLE_STATUS_COLUMN[tableName];
  if (!statusColumn) {
    throw new Error(`[updateEntityStatus] \u975E\u6CD5\u8868\u540D: ${tableName}`);
  }
  const statusValue = newStatus === "enabled" ? "enabled" : "paused";
  await conn.execute(
    `UPDATE ${tableName} SET ${statusColumn} = ?, updatedAt = NOW() WHERE id = ?`,
    [statusValue, entityId]
  );
}
async function archiveCampaign(conn, internalId, amazonCampaignId) {
  await conn.execute(
    `UPDATE ${C.table} SET ${C.campaignStatus} = 'amazon_deleted' WHERE ${C.id} = ? OR ${C.campaignId} = ?`,
    [internalId, amazonCampaignId]
  );
  await conn.execute(
    `UPDATE ${K.table} SET ${K.keywordStatus} = 'amazon_deleted' 
     WHERE ${K.campaignId} = ? AND ${K.keywordStatus} != 'amazon_deleted'`,
    [amazonCampaignId]
  );
  await conn.execute(
    `UPDATE ${PT.table} SET ${PT.targetStatus} = 'amazon_deleted' 
     WHERE ${PT.campaignId} = ? AND ${PT.targetStatus} != 'amazon_deleted'`,
    [amazonCampaignId]
  );
  await conn.execute(
    `UPDATE ${AG.table} SET ${AG.adGroupStatus} = 'amazon_deleted' 
     WHERE ${AG.campaignId} = ? AND ${AG.adGroupStatus} != 'amazon_deleted'`,
    [amazonCampaignId]
  );
}
async function archiveAdGroup(conn, internalId, amazonAdGroupId) {
  await conn.execute(
    `UPDATE ${AG.table} SET ${AG.adGroupStatus} = 'archived' WHERE ${AG.id} = ? OR ${AG.adGroupId} = ?`,
    [internalId, amazonAdGroupId]
  );
}
async function updateKeywordAmazonId(conn, keywordInternalId, amazonKeywordId, accountId, campaignId) {
  await conn.execute(
    `UPDATE ${K.table} SET ${K.keywordId} = ?, 
     ${K.accountId} = COALESCE(${K.accountId}, ?),
     ${K.campaignId} = COALESCE(${K.campaignId}, ?)
     WHERE ${K.id} = ? AND ${K.keywordId} IS NULL`,
    [amazonKeywordId, accountId || null, campaignId || null, keywordInternalId]
  );
}
async function cleanupZombieTasks(conn) {
  try {
    const zombieSql = `UPDATE optimization_tasks SET status = 'retry', retry_count = retry_count + 1, 
       error_message = CONCAT(IFNULL(error_message,''), ' | v457: \u50F5\u5C38\u4EFB\u52A1\u81EA\u52A8\u91CD\u7F6E(processing\u8D85\u8FC715\u5206\u949F)') 
       WHERE status = 'processing' AND processing_started_at < DATE_SUB(NOW(), INTERVAL 15 MINUTE)`;
    const [result] = await safeExecute(conn, zombieSql, [], "cleanupZombieTasks");
    return result?.affectedRows || 0;
  } catch (err) {
    log88.warn(`[OptSyncQueries] \u50F5\u5C38\u4EFB\u52A1\u6E05\u7406\u5931\u8D25: ${err.message}`);
    return 0;
  }
}
async function cleanupDeletedKeywordTasks(conn) {
  try {
    const kwCleanSql1 = `UPDATE optimization_tasks ot
       LEFT JOIN ${K.table} k ON ot.target_entity_id = k.${K.id}
       SET ot.status = 'failed', ot.error_message = CONCAT(IFNULL(ot.error_message,''), ' | v457: \u76EE\u6807keyword\u5DF2\u88AB\u5220\u9664')
       WHERE ot.target_entity_type = 'keyword' AND ot.status IN ('pending', 'retry') AND k.${K.id} IS NULL AND ot.target_entity_id IS NOT NULL`;
    const [result1] = await safeExecute(conn, kwCleanSql1, [], "cleanupDeletedKeywordTasks.orphan");
    const count1 = result1?.affectedRows || 0;
    const kwCleanSql2 = `UPDATE optimization_tasks ot
       INNER JOIN ${K.table} k ON ot.target_entity_id = k.${K.id}
       SET ot.status = 'cancelled', ot.error_message = CONCAT(IFNULL(ot.error_message,''), ' | v479: keyword\u5DF2\u5728Amazon\u7AEF\u5220\u9664/\u5F52\u6863')
       WHERE ot.target_entity_type = 'keyword' AND ot.status IN ('pending', 'retry') AND k.keywordStatus IN ('amazon_deleted', 'archived')`;
    const [result2] = await safeExecute(conn, kwCleanSql2, [], "cleanupDeletedKeywordTasks.amazonDeleted");
    const count22 = result2?.affectedRows || 0;
    if (count22 > 0) {
      log88.warn(`[OptSyncQueries] v479: \u53D6\u6D88${count22}\u4E2A\u5F15\u7528amazon_deleted/archived keyword\u7684\u4EFB\u52A1`);
    }
    return count1 + count22;
  } catch (err) {
    log88.warn(`[OptSyncQueries] keyword\u4EFB\u52A1\u6E05\u7406\u5931\u8D25: ${err.message}`);
    return 0;
  }
}
async function cleanupDeletedProductTargetTasks(conn) {
  try {
    const ptCleanSql1 = `UPDATE optimization_tasks ot
       LEFT JOIN ${PT.table} pt ON ot.target_entity_id = pt.${PT.id}
       SET ot.status = 'failed', ot.error_message = CONCAT(IFNULL(ot.error_message,''), ' | v457: \u76EE\u6807product_target\u5DF2\u88AB\u5220\u9664')
       WHERE ot.target_entity_type = 'product_target' AND ot.status IN ('pending', 'retry') AND pt.${PT.id} IS NULL AND ot.target_entity_id IS NOT NULL`;
    const [result1] = await safeExecute(conn, ptCleanSql1, [], "cleanupDeletedPTTasks.orphan");
    const count1 = result1?.affectedRows || 0;
    const ptCleanSql2 = `UPDATE optimization_tasks ot
       INNER JOIN ${PT.table} pt ON ot.target_entity_id = pt.${PT.id}
       SET ot.status = 'cancelled', ot.error_message = CONCAT(IFNULL(ot.error_message,''), ' | v479: product_target\u5DF2\u5728Amazon\u7AEF\u5220\u9664/\u5F52\u6863')
       WHERE ot.target_entity_type = 'product_target' AND ot.status IN ('pending', 'retry') AND pt.targetStatus IN ('amazon_deleted', 'archived')`;
    const [result2] = await safeExecute(conn, ptCleanSql2, [], "cleanupDeletedPTTasks.amazonDeleted");
    const count22 = result2?.affectedRows || 0;
    if (count22 > 0) {
      log88.warn(`[OptSyncQueries] v479: \u53D6\u6D88${count22}\u4E2A\u5F15\u7528amazon_deleted/archived product_target\u7684\u4EFB\u52A1`);
    }
    return count1 + count22;
  } catch (err) {
    log88.warn(`[OptSyncQueries] product_target\u4EFB\u52A1\u6E05\u7406\u5931\u8D25: ${err.message}`);
    return 0;
  }
}
async function getBatchTaskStats(conn, batchId) {
  try {
    const [stats4] = await conn.execute(
      `SELECT status, COUNT(*) as cnt FROM optimization_tasks WHERE batch_id = ? GROUP BY status`,
      [batchId]
    );
    let synced = 0, failed = 0, pending = 0, retry = 0, permanentlyFailed = 0;
    for (const s of stats4) {
      if (s.status === "synced") synced = Number(s.cnt);
      else if (s.status === "failed") failed += Number(s.cnt);
      else if (s.status === "permanently_failed") permanentlyFailed += Number(s.cnt);
      else if (s.status === "pending" || s.status === "processing") pending += Number(s.cnt);
      else if (s.status === "retry") retry = Number(s.cnt);
    }
    return { synced, failed, pending, retry, permanentlyFailed };
  } catch (err) {
    log88.warn(`[OptSyncQueries] getBatchTaskStats\u5931\u8D25: ${err.message}`);
    return { synced: 0, failed: 0, pending: 0, retry: 0, permanentlyFailed: 0 };
  }
}
async function updateLogsSyncStatus(conn, batchId, logSyncStatus, synced, failed, pending, retry) {
  await conn.execute(
    `UPDATE optimization_logs 
     SET api_sync_status = ?, 
         action_detail = JSON_SET(COALESCE(action_detail, '{}'), 
           '$.syncBatchId', ?,
           '$.syncSummary', JSON_OBJECT('synced', ?, 'failed', ?, 'pending', ?, 'retry', ?))
     WHERE action_detail LIKE CONCAT('%', ?, '%') 
       AND created_at >= DATE_SUB(NOW(), INTERVAL 1 DAY)`,
    [logSyncStatus, batchId, synced, failed, pending, retry, batchId]
  );
}
async function getRecoverableFailedTasks(conn, limit = 200) {
  try {
    const [rows] = await conn.execute(
      `SELECT ot.id, ot.target_entity_type, ot.target_entity_id, ot.task_type
       FROM optimization_tasks ot
       WHERE ot.status IN ('permanently_failed', 'failed')
         AND (ot.amazon_entity_id IS NULL OR ot.amazon_entity_id = '')
         AND ot.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
       LIMIT ${Number(limit) || 200}`
    );
    return rows;
  } catch (err) {
    log88.warn(`[OptSyncQueries] getRecoverableFailedTasks\u5931\u8D25: ${err.message}`);
    return [];
  }
}
async function recoverTask(conn, taskId, amazonId) {
  await conn.execute(
    `UPDATE optimization_tasks SET status = 'pending', amazon_entity_id = ?, retry_count = 0, error_message = 'v457: \u81EA\u52A8\u6062\u590D - Amazon ID\u5DF2\u53EF\u7528' WHERE id = ?`,
    [amazonId, taskId]
  );
}
async function getPendingTasks(conn, options) {
  let query = `SELECT * FROM optimization_tasks WHERE status IN ('pending', 'retry')`;
  const params = [];
  if (options?.batchId) {
    query += ` AND batch_id = ?`;
    params.push(options.batchId);
  }
  if (options?.accountId) {
    query += ` AND account_id = ?`;
    params.push(options.accountId);
  }
  query += ` AND (status = 'pending' OR (status = 'retry' AND (next_retry_at IS NULL OR next_retry_at <= NOW())))`;
  query += ` ORDER BY priority ASC, created_at ASC`;
  if (options?.maxTasks) {
    query += ` LIMIT ${Number(options.maxTasks)}`;
  }
  const [rows] = await conn.execute(query, params);
  return rows;
}
async function insertTasks(conn, batchId, tasks) {
  const INSERT_BATCH = 500;
  for (let i = 0; i < tasks.length; i += INSERT_BATCH) {
    const batch = tasks.slice(i, i + INSERT_BATCH);
    const placeholders = batch.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())").join(", ");
    const values = [];
    for (const t2 of batch) {
      values.push(
        batchId,
        t2.optimizationTargetId,
        t2.accountId,
        t2.taskType,
        t2.priority,
        t2.targetEntityType,
        t2.targetEntityId,
        t2.amazonEntityId || null,
        t2.targetEntityName || null,
        t2.action,
        t2.oldValue || null,
        t2.newValue || null,
        t2.changeReason || null,
        t2.algorithmUsed || null,
        t2.confidenceScore || null,
        t2.campaignId || null,
        t2.campaignName || null,
        t2.adGroupId || null,
        t2.eventId || null,
        // v509: optimization_events.id 外键
        "pending"
      );
    }
    const insertSql = `INSERT INTO optimization_tasks 
       (batch_id, optimization_target_id, account_id, task_type, priority,
        target_entity_type, target_entity_id, amazon_entity_id, target_entity_name,
        action, old_value, new_value, change_reason, algorithm_used, confidence_score,
        campaign_id, campaign_name, ad_group_id, event_id, status, created_at)
       VALUES ${placeholders}`;
    await safeExecute(conn, insertSql, values, "insertTasks");
  }
}
async function markKeywordDeleted(conn, internalId, amazonKeywordId) {
  await conn.execute(
    `UPDATE ${K.table} SET ${K.keywordStatus} = 'amazon_deleted' WHERE ${K.id} = ? OR ${K.keywordId} = ?`,
    [internalId, amazonKeywordId]
  );
}
async function markKeywordAndAdGroupDeleted(conn, internalKeywordId, amazonKeywordId) {
  await conn.execute(
    `UPDATE ${K.table} SET ${K.keywordStatus} = 'amazon_deleted' WHERE ${K.id} = ? OR ${K.keywordId} = ?`,
    [internalKeywordId, amazonKeywordId]
  );
  try {
    await conn.execute(
      `UPDATE ${AG.table} ag
       INNER JOIN ${K.table} k ON k.${K.internalAdGroupId} = ag.${AG.id}
       SET ag.${AG.adGroupStatus} = 'amazon_deleted'
       WHERE (k.${K.id} = ? OR k.${K.keywordId} = ?)
         AND ag.${AG.adGroupStatus} != 'amazon_deleted'`,
      [internalKeywordId, amazonKeywordId]
    );
    log88.info(`[v529] \u5E7F\u544A\u7EC4\u4E0D\u5B58\u5728Bug\u4FEE\u590D: \u5DF2\u5C06\u5E7F\u544A\u7EC4\u6807\u8BB0\u4E3Aamazon_deleted (keywordId=${internalKeywordId})`);
  } catch (e) {
    log88.warn(`[v529] \u6807\u8BB0\u5E7F\u544A\u7EC4amazon_deleted\u5931\u8D25: ${e.message}`);
  }
}
async function markTargetDeleted(conn, internalId, amazonTargetId) {
  await conn.execute(
    `UPDATE ${PT.table} SET ${PT.targetStatus} = 'amazon_deleted' WHERE ${PT.id} = ? OR ${PT.targetId} = ?`,
    [internalId, amazonTargetId]
  );
}
async function getProductTargetDetailById(conn, productTargetInternalId) {
  try {
    const [rows] = await conn.execute(
      `SELECT pt.${PT.targetId}, pt.${PT.campaignId} AS amazonCampaignId, ag.${AG.adGroupId} AS amazonAdGroupId
       FROM ${PT.table} pt
       INNER JOIN ${AG.table} ag ON pt.${PT.internalAdGroupId} = ag.${AG.id}
       WHERE pt.${PT.id} = ? LIMIT 1`,
      [productTargetInternalId]
    );
    if (rows.length > 0) {
      const row = rows[0];
      return {
        targetId: String(row.targetId || row[PT.targetId] || ""),
        amazonCampaignId: String(row.amazonCampaignId || ""),
        amazonAdGroupId: String(row.amazonAdGroupId || "")
      };
    }
    return null;
  } catch (err) {
    log88.warn(`[OptSyncQueries] v471: getProductTargetDetailById\u5931\u8D25: ${err.message}`);
    return null;
  }
}
async function getCampaignTypeByAdGroupInternalId(conn, adGroupInternalId) {
  try {
    const [rows] = await conn.execute(
      `SELECT c.${C.campaignType} FROM ${AG.table} ag
       INNER JOIN ${C.table} c ON ag.${AG.campaignId} = c.${C.campaignId}
       WHERE ag.${AG.id} = ? LIMIT 1`,
      [adGroupInternalId]
    );
    if (rows.length > 0) {
      const row = rows[0];
      return String(row.campaignType || row[C.campaignType] || "sp_manual");
    }
    return "sp_manual";
  } catch (err) {
    log88.warn(`[OptSyncQueries] v471: getCampaignTypeByAdGroupInternalId\u5931\u8D25: ${err.message}`);
    return "sp_manual";
  }
}
var log88, C, AG, K, PT, A;
var init_optSyncQueries = __esm({
  "server/sync/optSyncQueries.ts"() {
    "use strict";
    init_schema2();
    init_logger();
    init_typeSafeQueryBuilder();
    log88 = createModuleLogger("OptSyncQueries");
    C = {
      table: "campaigns",
      id: campaigns.id.name,
      // 'id'
      accountId: campaigns.accountId.name,
      // 'accountId'
      campaignId: campaigns.campaignId.name,
      // 'campaignId'
      campaignName: campaigns.campaignName.name,
      // 'campaignName'
      campaignType: campaigns.campaignType.name,
      // 'campaignType'
      campaignStatus: campaigns.campaignStatus.name,
      // 'campaignStatus'
      costType: campaigns.costType.name,
      // 'cost_type'
      adFormat: campaigns.adFormat.name
      // 'ad_format'
    };
    AG = {
      table: "ad_groups",
      id: adGroups.id.name,
      // 'id'
      campaignId: adGroups.campaignId.name,
      // 'campaignId'
      adGroupId: adGroups.adGroupId.name,
      // 'adGroupId'
      adGroupStatus: adGroups.adGroupStatus.name
      // 'adGroupStatus' or 'status'
    };
    K = {
      table: "keywords",
      id: keywords.id.name,
      // 'id'
      keywordId: keywords.keywordId.name,
      // 'keywordId'
      campaignId: keywords.campaignId.name,
      // 'campaignId'
      accountId: keywords.accountId.name,
      // 'accountId'
      internalAdGroupId: keywords.internalAdGroupId.name,
      // 'internal_ad_group_id'
      bid: keywords.bid.name,
      // 'bid'
      keywordStatus: keywords.keywordStatus.name
      // 'keywordStatus'
    };
    PT = {
      table: "product_targets",
      id: productTargets.id.name,
      // 'id'
      targetId: productTargets.targetId.name,
      // 'targetId'
      campaignId: productTargets.campaignId.name,
      // 'campaignId'
      accountId: productTargets.accountId.name,
      // 'accountId'
      internalAdGroupId: productTargets.internalAdGroupId.name,
      // 'internal_ad_group_id'
      bid: productTargets.bid.name,
      // 'bid'
      targetStatus: productTargets.targetStatus.name
      // 'targetStatus'
    };
    A = {
      id: adAccounts.id.name,
      // 'id'
      marketplace: adAccounts.marketplace.name
      // 'marketplace'
    };
    __name(getCampaignTypeById, "getCampaignTypeById");
    __name(getCampaignTypeByKeywordId, "getCampaignTypeByKeywordId");
    __name(getKeywordDetailById, "getKeywordDetailById");
    __name(getCampaignDetailByAmazonId, "getCampaignDetailByAmazonId");
    __name(getCampaignTypeByProductTargetId, "getCampaignTypeByProductTargetId");
    __name(getFirstAdGroupIdByCampaignId, "getFirstAdGroupIdByCampaignId");
    __name(getKeywordAmazonId2, "getKeywordAmazonId");
    __name(getProductTargetAmazonId, "getProductTargetAmazonId");
    __name(getCampaignAmazonId2, "getCampaignAmazonId");
    __name(getCampaignIdAndType, "getCampaignIdAndType");
    __name(getCampaignTypeByAmazonOrInternalId, "getCampaignTypeByAmazonOrInternalId");
    __name(entityExists, "entityExists");
    __name(updateTaskAmazonEntityId, "updateTaskAmazonEntityId");
    __name(markTasksProcessing, "markTasksProcessing");
    __name(markTaskSynced, "markTaskSynced");
    __name(markTaskFailed, "markTaskFailed");
    __name(markTasksFailed, "markTasksFailed");
    __name(markTaskForRetry, "markTaskForRetry");
    __name(updateKeywordBid2, "updateKeywordBid");
    __name(updateProductTargetBid2, "updateProductTargetBid");
    __name(updateEntityStatus, "updateEntityStatus");
    __name(archiveCampaign, "archiveCampaign");
    __name(archiveAdGroup, "archiveAdGroup");
    __name(updateKeywordAmazonId, "updateKeywordAmazonId");
    __name(cleanupZombieTasks, "cleanupZombieTasks");
    __name(cleanupDeletedKeywordTasks, "cleanupDeletedKeywordTasks");
    __name(cleanupDeletedProductTargetTasks, "cleanupDeletedProductTargetTasks");
    __name(getBatchTaskStats, "getBatchTaskStats");
    __name(updateLogsSyncStatus, "updateLogsSyncStatus");
    __name(getRecoverableFailedTasks, "getRecoverableFailedTasks");
    __name(recoverTask, "recoverTask");
    __name(getPendingTasks, "getPendingTasks");
    __name(insertTasks, "insertTasks");
    __name(markKeywordDeleted, "markKeywordDeleted");
    __name(markKeywordAndAdGroupDeleted, "markKeywordAndAdGroupDeleted");
    __name(markTargetDeleted, "markTargetDeleted");
    __name(getProductTargetDetailById, "getProductTargetDetailById");
    __name(getCampaignTypeByAdGroupInternalId, "getCampaignTypeByAdGroupInternalId");
  }
});

