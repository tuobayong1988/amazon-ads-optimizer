// Extracted from production dist/index.js
// Original module: server/sync/entityStateAlignment.ts
// Lines: 484

var entityStateAlignment_exports = {};
__export(entityStateAlignment_exports, {
  alignAllAccountEntityStates: () => alignAllAccountEntityStates,
  alignEntityStates: () => alignEntityStates,
  filterDeletedEntities: () => filterDeletedEntities,
  forwardAlign: () => forwardAlign,
  getAlignmentHealth: () => getAlignmentHealth,
  getCurrentSyncVersion: () => getCurrentSyncVersion,
  isEntityDeleted: () => isEntityDeleted,
  markEntitiesVerified: () => markEntitiesVerified,
  markEntityVerified: () => markEntityVerified,
  nextSyncVersion: () => nextSyncVersion,
  shouldAllowStateUpdate: () => shouldAllowStateUpdate,
  startAlignmentScheduler: () => startAlignmentScheduler,
  stopAlignmentScheduler: () => stopAlignmentScheduler
});
function nextSyncVersion() {
  return ++globalSyncVersion;
}
function getCurrentSyncVersion() {
  return globalSyncVersion;
}
function markEntityVerified(entityType, entityId, syncVersion) {
  const key = `${entityType}:${entityId}`;
  entityVerificationMap.set(key, {
    lastVerifiedAt: /* @__PURE__ */ new Date(),
    syncVersion
  });
}
function markEntitiesVerified(entityType, entityIds, syncVersion) {
  const now = /* @__PURE__ */ new Date();
  for (const id of entityIds) {
    entityVerificationMap.set(`${entityType}:${id}`, {
      lastVerifiedAt: now,
      syncVersion
    });
  }
}
function shouldAllowStateUpdate(entityType, entityId, incomingSyncVersion) {
  const key = `${entityType}:${entityId}`;
  const existing = entityVerificationMap.get(key);
  if (!existing) return true;
  return incomingSyncVersion >= existing.syncVersion;
}
async function forwardAlign(accountId, entityType, amazonEntityIds, campaignId) {
  const result = { aligned: 0, entityIds: [] };
  if (amazonEntityIds.length === 0) return result;
  const database = await getDb();
  if (!database) return result;
  const { sql: sql15 } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
  try {
    const amazonIdSet = new Set(amazonEntityIds.map((id) => String(id)));
    const tableName = entityType === "keyword" ? "keywords" : "product_targets";
    const statusCol = entityType === "keyword" ? "keywordStatus" : "targetStatus";
    const amazonIdCol = entityType === "keyword" ? "keywordId" : "targetId";
    let localQuery = `
      SELECT id, ${amazonIdCol} as amazonId 
      FROM ${tableName} 
      WHERE account_id = ${Number(accountId)}
        AND ${statusCol} NOT IN ('amazon_deleted', 'archived', 'deleted')
    `;
    if (campaignId) {
      localQuery += ` AND campaign_id = ${Number(campaignId)}`;
    }
    const [localRows] = await database.execute(sql15.raw(localQuery));
    if (!Array.isArray(localRows) || localRows.length === 0) return result;
    const missingEntities = [];
    for (const row of localRows) {
      const amazonId = String(row.amazonId);
      if (amazonId && !amazonIdSet.has(amazonId)) {
        missingEntities.push(Number(row.id));
      }
    }
    if (missingEntities.length === 0) return result;
    const missingRatio = missingEntities.length / localRows.length;
    if (missingRatio > 0.5 && missingEntities.length > 10) {
      log89.warn(`[v525] \u6B63\u5411\u5BF9\u9F50\u5B89\u5168\u9608\u503C\u89E6\u53D1: \u8D26\u6237${accountId} ${entityType} ${missingEntities.length}/${localRows.length} (${(missingRatio * 100).toFixed(1)}%) \u5B9E\u4F53\u7F3A\u5931, \u7591\u4F3CAPI\u5206\u9875\u4E0D\u5B8C\u6574, \u8DF3\u8FC7\u6807\u8BB0`);
      logSyncWarn("EntityStateAlignment", `\u6B63\u5411\u5BF9\u9F50\u5B89\u5168\u9608\u503C\u89E6\u53D1`, {
        accountId,
        entityType,
        missing: missingEntities.length,
        total: localRows.length
      });
      return result;
    }
    const BATCH_SIZE = 500;
    for (let i = 0; i < missingEntities.length; i += BATCH_SIZE) {
      const batch = missingEntities.slice(i, i + BATCH_SIZE);
      const idList = batch.join(",");
      await database.execute(
        sql15.raw(`UPDATE ${tableName} SET ${statusCol} = 'amazon_deleted', updatedAt = NOW() WHERE id IN (${idList}) AND ${statusCol} NOT IN ('amazon_deleted', 'archived')`)
      );
    }
    result.aligned = missingEntities.length;
    result.entityIds = missingEntities;
    for (const id of missingEntities) {
      deletedEntityCache.set(`${entityType}:${id}`, Date.now());
    }
    if (missingEntities.length > 0) {
      log89.warn(`[v525] \u6B63\u5411\u5BF9\u9F50: \u8D26\u6237${accountId} \u6807\u8BB0 ${missingEntities.length} \u4E2A ${entityType} \u4E3A amazon_deleted`);
      logSync("EntityStateAlignment", `\u6B63\u5411\u5BF9\u9F50\u5B8C\u6210`, {
        accountId,
        entityType,
        aligned: missingEntities.length
      });
    }
    if (missingEntities.length > 0) {
      for (let i = 0; i < missingEntities.length; i += BATCH_SIZE) {
        const batch = missingEntities.slice(i, i + BATCH_SIZE);
        const idList = batch.join(",");
        await database.execute(
          sql15.raw(`
            UPDATE optimization_tasks 
            SET status = 'cancelled', 
                error_message = CONCAT(COALESCE(error_message, ''), ' | v525: \u6B63\u5411\u5BF9\u9F50-\u5B9E\u4F53\u5728Amazon\u7AEF\u4E0D\u5B58\u5728'),
                completed_at = NOW()
            WHERE target_entity_id IN (${idList})
              AND account_id = ${Number(accountId)}
              AND status IN ('pending', 'retry')
          `)
        );
      }
    }
  } catch (err) {
    log89.warn(`[v525] \u6B63\u5411\u5BF9\u9F50\u5931\u8D25: \u8D26\u6237${accountId} ${entityType}: ${err.message}`);
  }
  return result;
}
async function isEntityDeleted(entityType, entityId) {
  const cacheKey = `${entityType}:${entityId}`;
  const cachedTime = deletedEntityCache.get(cacheKey);
  if (cachedTime && Date.now() - cachedTime < CACHE_TTL_MS2) {
    return true;
  }
  const database = await getDb();
  if (!database) return false;
  const { sql: sql15 } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
  try {
    if (entityType === "keyword") {
      const [rows] = await database.execute(
        sql15.raw(`SELECT keywordStatus FROM keywords WHERE id = ${Number(entityId)} LIMIT 1`)
      );
      if (Array.isArray(rows) && rows.length > 0 && rows[0].keywordStatus === "amazon_deleted") {
        deletedEntityCache.set(cacheKey, Date.now());
        return true;
      }
    } else {
      const [rows] = await database.execute(
        sql15.raw(`SELECT targetStatus FROM product_targets WHERE id = ${Number(entityId)} LIMIT 1`)
      );
      if (Array.isArray(rows) && rows.length > 0 && rows[0].targetStatus === "amazon_deleted") {
        deletedEntityCache.set(cacheKey, Date.now());
        return true;
      }
    }
  } catch (err) {
    log89.debug(`[v525] isEntityDeleted \u67E5\u8BE2\u5931\u8D25: ${err.message}`);
  }
  return false;
}
async function filterDeletedEntities(entityType, entityIds) {
  const deletedIds = /* @__PURE__ */ new Set();
  if (entityIds.length === 0) return deletedIds;
  const uncachedIds = [];
  for (const id of entityIds) {
    const cacheKey = `${entityType}:${id}`;
    const cachedTime = deletedEntityCache.get(cacheKey);
    if (cachedTime && Date.now() - cachedTime < CACHE_TTL_MS2) {
      deletedIds.add(id);
    } else {
      uncachedIds.push(id);
    }
  }
  if (uncachedIds.length === 0) return deletedIds;
  const database = await getDb();
  if (!database) return deletedIds;
  const { sql: sql15 } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
  try {
    const BATCH_SIZE = 500;
    for (let i = 0; i < uncachedIds.length; i += BATCH_SIZE) {
      const batch = uncachedIds.slice(i, i + BATCH_SIZE);
      const idList = batch.join(",");
      if (entityType === "keyword") {
        const [rows] = await database.execute(
          sql15.raw(`SELECT id FROM keywords WHERE id IN (${idList}) AND keywordStatus = 'amazon_deleted'`)
        );
        if (Array.isArray(rows)) {
          for (const row of rows) {
            const id = Number(row.id);
            deletedIds.add(id);
            deletedEntityCache.set(`keyword:${id}`, Date.now());
          }
        }
      } else {
        const [rows] = await database.execute(
          sql15.raw(`SELECT id FROM product_targets WHERE id IN (${idList}) AND targetStatus = 'amazon_deleted'`)
        );
        if (Array.isArray(rows)) {
          for (const row of rows) {
            const id = Number(row.id);
            deletedIds.add(id);
            deletedEntityCache.set(`target:${id}`, Date.now());
          }
        }
      }
    }
  } catch (err) {
    log89.debug(`[v525] filterDeletedEntities \u6279\u91CF\u67E5\u8BE2\u5931\u8D25: ${err.message}`);
  }
  return deletedIds;
}
async function alignEntityStates(accountId, incremental = false) {
  const startTime = Date.now();
  const result = {
    accountId,
    keywordsAligned: 0,
    productTargetsAligned: 0,
    tasksCancelled: 0,
    forwardAligned: 0,
    reverseAligned: 0,
    errors: [],
    durationMs: 0
  };
  log89.info(`[v525] \u53CD\u5411\u5BF9\u9F50\u5F00\u59CB: \u8D26\u6237 ${accountId}, \u6A21\u5F0F=${incremental ? "\u589E\u91CF" : "\u5168\u91CF"}`);
  const database = await getDb();
  if (!database) {
    result.errors.push("\u6570\u636E\u5E93\u4E0D\u53EF\u7528");
    result.durationMs = Date.now() - startTime;
    return result;
  }
  const { sql: sql15 } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
  const timeFilter = incremental && lastAlignmentTime ? `AND ot.completed_at >= '${lastAlignmentTime.toISOString().slice(0, 19).replace("T", " ")}'` : `AND ot.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)`;
  try {
    const [keywordRows] = await database.execute(
      sql15.raw(`
        SELECT DISTINCT ot.target_entity_id, ot.amazon_entity_id
        FROM optimization_tasks ot
        INNER JOIN keywords k ON ot.target_entity_id = k.id
        WHERE ot.account_id = ${Number(accountId)}
          AND ot.target_entity_type = 'keyword'
          AND ot.status IN ('permanently_failed', 'failed')
          AND ot.error_message LIKE '%entityNotFound%'
          ${timeFilter}
          AND k.keywordStatus NOT IN ('amazon_deleted', 'archived')
      `)
    );
    const keywordEntityIds = [];
    if (Array.isArray(keywordRows)) {
      for (const row of keywordRows) {
        keywordEntityIds.push(Number(row.target_entity_id));
      }
    }
    if (keywordEntityIds.length > 0) {
      const BATCH_SIZE = 500;
      for (let i = 0; i < keywordEntityIds.length; i += BATCH_SIZE) {
        const batch = keywordEntityIds.slice(i, i + BATCH_SIZE);
        const idList = batch.join(",");
        await database.execute(
          sql15.raw(`UPDATE keywords SET keywordStatus = 'amazon_deleted', updatedAt = NOW() WHERE id IN (${idList}) AND keywordStatus NOT IN ('amazon_deleted', 'archived')`)
        );
      }
      result.keywordsAligned = keywordEntityIds.length;
      result.reverseAligned += keywordEntityIds.length;
      for (const id of keywordEntityIds) {
        deletedEntityCache.set(`keyword:${id}`, Date.now());
      }
      log89.warn(`[v525] \u53CD\u5411\u5BF9\u9F50: \u8D26\u6237 ${accountId} \u6807\u8BB0 ${keywordEntityIds.length} \u4E2A keyword \u4E3A amazon_deleted`);
    }
    const [targetRows] = await database.execute(
      sql15.raw(`
        SELECT DISTINCT ot.target_entity_id, ot.amazon_entity_id
        FROM optimization_tasks ot
        INNER JOIN product_targets pt ON ot.target_entity_id = pt.id
        WHERE ot.account_id = ${Number(accountId)}
          AND ot.target_entity_type = 'product_target'
          AND ot.status IN ('permanently_failed', 'failed')
          AND ot.error_message LIKE '%entityNotFound%'
          ${timeFilter}
          AND pt.targetStatus NOT IN ('amazon_deleted', 'archived')
      `)
    );
    const targetEntityIds = [];
    if (Array.isArray(targetRows)) {
      for (const row of targetRows) {
        targetEntityIds.push(Number(row.target_entity_id));
      }
    }
    if (targetEntityIds.length > 0) {
      const BATCH_SIZE = 500;
      for (let i = 0; i < targetEntityIds.length; i += BATCH_SIZE) {
        const batch = targetEntityIds.slice(i, i + BATCH_SIZE);
        const idList = batch.join(",");
        await database.execute(
          sql15.raw(`UPDATE product_targets SET targetStatus = 'amazon_deleted', updatedAt = NOW() WHERE id IN (${idList}) AND targetStatus NOT IN ('amazon_deleted', 'archived')`)
        );
      }
      result.productTargetsAligned = targetEntityIds.length;
      result.reverseAligned += targetEntityIds.length;
      for (const id of targetEntityIds) {
        deletedEntityCache.set(`target:${id}`, Date.now());
      }
      log89.warn(`[v525] \u53CD\u5411\u5BF9\u9F50: \u8D26\u6237 ${accountId} \u6807\u8BB0 ${targetEntityIds.length} \u4E2A product_target \u4E3A amazon_deleted`);
    }
    const allDeletedEntityIds = [...keywordEntityIds, ...targetEntityIds];
    if (allDeletedEntityIds.length > 0) {
      const BATCH_SIZE = 500;
      let totalCancelled = 0;
      for (let i = 0; i < allDeletedEntityIds.length; i += BATCH_SIZE) {
        const batch = allDeletedEntityIds.slice(i, i + BATCH_SIZE);
        const idList = batch.join(",");
        const [cancelResult] = await database.execute(
          sql15.raw(`
            UPDATE optimization_tasks 
            SET status = 'cancelled', 
                error_message = CONCAT(COALESCE(error_message, ''), ' | v525: \u53CD\u5411\u5BF9\u9F50-\u5B9E\u4F53\u5DF2\u5728Amazon\u7AEF\u5220\u9664'),
                completed_at = NOW()
            WHERE target_entity_id IN (${idList})
              AND account_id = ${Number(accountId)}
              AND status IN ('pending', 'retry')
          `)
        );
        totalCancelled += cancelResult?.affectedRows || 0;
      }
      result.tasksCancelled = totalCancelled;
      if (totalCancelled > 0) {
        log89.warn(`[v525] \u53CD\u5411\u5BF9\u9F50: \u8D26\u6237 ${accountId} \u53D6\u6D88 ${totalCancelled} \u4E2A\u5F15\u7528\u5DF2\u5220\u9664\u5B9E\u4F53\u7684\u5F85\u5904\u7406\u4EFB\u52A1`);
      }
    }
    log89.info(`[v525] \u53CD\u5411\u5BF9\u9F50\u5B8C\u6210: \u8D26\u6237 ${accountId}, keywords=${result.keywordsAligned}, targets=${result.productTargetsAligned}, cancelled=${result.tasksCancelled}`);
  } catch (err) {
    const errMsg = err.message;
    result.errors.push(errMsg);
    log89.warn(`[v525] \u53CD\u5411\u5BF9\u9F50\u5931\u8D25: \u8D26\u6237 ${accountId}, \u9519\u8BEF: ${errMsg}`);
  }
  result.durationMs = Date.now() - startTime;
  return result;
}
async function alignAllAccountEntityStates(incremental = false) {
  const summary = {
    totalAccounts: 0,
    totalKeywordsAligned: 0,
    totalTargetsAligned: 0,
    totalTasksCancelled: 0,
    accountResults: []
  };
  log89.info(`[v525] \u5168\u8D26\u6237\u53CD\u5411\u5BF9\u9F50\u5F00\u59CB, \u6A21\u5F0F=${incremental ? "\u589E\u91CF" : "\u5168\u91CF"}...`);
  const database = await getDb();
  if (!database) {
    log89.warn("[v525] \u6570\u636E\u5E93\u4E0D\u53EF\u7528\uFF0C\u8DF3\u8FC7\u5168\u8D26\u6237\u5BF9\u9F50");
    return summary;
  }
  const { sql: sql15 } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
  try {
    const timeFilter = incremental && lastAlignmentTime ? `AND ot.completed_at >= '${lastAlignmentTime.toISOString().slice(0, 19).replace("T", " ")}'` : `AND ot.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)`;
    const [accountRows] = await database.execute(
      sql15.raw(`
        SELECT DISTINCT ot.account_id
        FROM optimization_tasks ot
        INNER JOIN ad_accounts a ON ot.account_id = a.id
        WHERE ot.status IN ('permanently_failed', 'failed')
          AND ot.error_message LIKE '%entityNotFound%'
          ${timeFilter}
          AND a.status = 'active'
      `)
    );
    const accountIds = [];
    if (Array.isArray(accountRows)) {
      for (const row of accountRows) {
        accountIds.push(Number(row.account_id));
      }
    }
    summary.totalAccounts = accountIds.length;
    log89.info(`[v525] \u53D1\u73B0 ${accountIds.length} \u4E2A\u8D26\u6237\u9700\u8981\u53CD\u5411\u5BF9\u9F50`);
    for (const accountId of accountIds) {
      const result = await alignEntityStates(accountId, incremental);
      summary.accountResults.push(result);
      summary.totalKeywordsAligned += result.keywordsAligned;
      summary.totalTargetsAligned += result.productTargetsAligned;
      summary.totalTasksCancelled += result.tasksCancelled;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    lastAlignmentTime = /* @__PURE__ */ new Date();
    cleanupCache();
    log89.info(`[v525] \u5168\u8D26\u6237\u53CD\u5411\u5BF9\u9F50\u5B8C\u6210: ${summary.totalAccounts}\u4E2A\u8D26\u6237, keywords=${summary.totalKeywordsAligned}, targets=${summary.totalTargetsAligned}, cancelled=${summary.totalTasksCancelled}`);
  } catch (err) {
    log89.warn(`[v525] \u5168\u8D26\u6237\u53CD\u5411\u5BF9\u9F50\u5931\u8D25: ${err.message}`);
  }
  return summary;
}
function getAlignmentHealth() {
  return {
    cacheSize: deletedEntityCache.size,
    verificationMapSize: entityVerificationMap.size,
    globalSyncVersion,
    lastAlignmentTime: lastAlignmentTime?.toISOString() || null,
    schedulerRunning: alignmentInterval !== null
  };
}
function startAlignmentScheduler() {
  if (alignmentInterval) {
    log89.info("[v525] \u5BF9\u9F50\u8C03\u5EA6\u5668\u5DF2\u5728\u8FD0\u884C\uFF0C\u8DF3\u8FC7\u91CD\u590D\u542F\u52A8");
    return;
  }
  const INTERVAL_MS = 30 * 60 * 1e3;
  alignmentInterval = setInterval(async () => {
    try {
      log89.info("[v525] \u72EC\u7ACB\u589E\u91CF\u53CD\u5411\u5BF9\u9F50\u626B\u63CF\u5F00\u59CB...");
      const result = await alignAllAccountEntityStates(true);
      const totalAligned = result.totalKeywordsAligned + result.totalTargetsAligned;
      if (totalAligned > 0 || result.totalTasksCancelled > 0) {
        log89.warn(`[v525] \u589E\u91CF\u5BF9\u9F50\u53D1\u73B0\u95EE\u9898: aligned=${totalAligned}, cancelled=${result.totalTasksCancelled}`);
      } else {
        log89.info("[v525] \u589E\u91CF\u5BF9\u9F50\u626B\u63CF\u5B8C\u6210\uFF0C\u65E0\u65B0\u7684\u4E0D\u4E00\u81F4\u5B9E\u4F53");
      }
    } catch (err) {
      log89.warn(`[v525] \u72EC\u7ACB\u589E\u91CF\u5BF9\u9F50\u5931\u8D25: ${err.message}`);
    }
  }, INTERVAL_MS);
  setInterval(() => {
    const cutoff = Date.now() - CACHE_TTL_MS2;
    let cleaned = 0;
    for (const [key, record2] of entityVerificationMap.entries()) {
      if (record2.lastVerifiedAt.getTime() < cutoff) {
        entityVerificationMap.delete(key);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      log89.debug(`[v525] \u6E05\u7406 ${cleaned} \u4E2A\u8FC7\u671F\u9A8C\u8BC1\u8BB0\u5F55, \u5269\u4F59 ${entityVerificationMap.size} \u4E2A`);
    }
  }, 6 * 60 * 60 * 1e3);
  log89.info(`[v525] \u53CC\u5411\u72B6\u6001\u5BF9\u9F50\u8C03\u5EA6\u5668\u5DF2\u542F\u52A8 (\u53CD\u5411\u5BF9\u9F50\u95F4\u9694: 30\u5206\u949F)`);
}
function stopAlignmentScheduler() {
  if (alignmentInterval) {
    clearInterval(alignmentInterval);
    alignmentInterval = null;
    log89.info("[v525] \u53CC\u5411\u72B6\u6001\u5BF9\u9F50\u8C03\u5EA6\u5668\u5DF2\u505C\u6B62");
  }
}
function cleanupCache() {
  const now = Date.now();
  let cleaned = 0;
  for (const [key, timestamp2] of deletedEntityCache.entries()) {
    if (now - timestamp2 > CACHE_TTL_MS2) {
      deletedEntityCache.delete(key);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    log89.debug(`[v525] \u6E05\u7406 ${cleaned} \u4E2A\u8FC7\u671F\u7F13\u5B58\u6761\u76EE, \u5269\u4F59 ${deletedEntityCache.size} \u4E2A`);
  }
}
var log89, globalSyncVersion, entityVerificationMap, deletedEntityCache, CACHE_TTL_MS2, lastAlignmentTime, alignmentInterval;
var init_entityStateAlignment = __esm({
  "server/sync/entityStateAlignment.ts"() {
    "use strict";
    init_db2();
    init_logger();
    init_opsLogger();
    log89 = createModuleLogger("EntityStateAlignment");
    globalSyncVersion = 0;
    __name(nextSyncVersion, "nextSyncVersion");
    __name(getCurrentSyncVersion, "getCurrentSyncVersion");
    entityVerificationMap = /* @__PURE__ */ new Map();
    __name(markEntityVerified, "markEntityVerified");
    __name(markEntitiesVerified, "markEntitiesVerified");
    __name(shouldAllowStateUpdate, "shouldAllowStateUpdate");
    deletedEntityCache = /* @__PURE__ */ new Map();
    CACHE_TTL_MS2 = 24 * 60 * 60 * 1e3;
    lastAlignmentTime = null;
    alignmentInterval = null;
    __name(forwardAlign, "forwardAlign");
    __name(isEntityDeleted, "isEntityDeleted");
    __name(filterDeletedEntities, "filterDeletedEntities");
    __name(alignEntityStates, "alignEntityStates");
    __name(alignAllAccountEntityStates, "alignAllAccountEntityStates");
    __name(getAlignmentHealth, "getAlignmentHealth");
    __name(startAlignmentScheduler, "startAlignmentScheduler");
    __name(stopAlignmentScheduler, "stopAlignmentScheduler");
    __name(cleanupCache, "cleanupCache");
  }
});

