// Extracted from production dist/index.js
// Original module: server/utils/migrateCampaignIds.ts
// Lines: 210

function extractCount3(result) {
  if (!result) return 0;
  const row = Array.isArray(result[0]) ? result[0][0] : result[0];
  return Number(row?.cnt || row?.count || 0);
}
async function hasRecordsToMigrate(db, tableName) {
  try {
    const result = await db.execute(sql.raw(`
      SELECT 1 as found FROM \`${tableName}\` 
      WHERE LENGTH(campaignId) < ${AMAZON_ID_MIN_LENGTH} 
        AND campaignId REGEXP '^[0-9]+$'
      LIMIT 1
    `));
    const rows = Array.isArray(result[0]) ? result[0] : result;
    return rows.length > 0;
  } catch (e) {
    log207.warn(`\u68C0\u67E5\u8868 ${tableName} \u662F\u5426\u9700\u8981\u8FC1\u79FB\u5931\u8D25: ${e.message}`);
    return false;
  }
}
async function findRecordsToMigrate(db, tableName) {
  const records = [];
  try {
    const directResult = await db.execute(sql.raw(`
      SELECT t.id, c.campaignId as correctCampaignId
      FROM \`${tableName}\` t
      INNER JOIN campaigns c ON CAST(c.id AS CHAR) = t.campaignId
      WHERE LENGTH(t.campaignId) < ${AMAZON_ID_MIN_LENGTH}
        AND t.campaignId REGEXP '^[0-9]+$'
      LIMIT 500
    `));
    const rows = Array.isArray(directResult[0]) ? directResult[0] : directResult;
    for (const row of rows) {
      if (row?.id && row?.correctCampaignId) {
        records.push({ id: Number(row.id), correctCampaignId: String(row.correctCampaignId) });
      }
    }
  } catch (e) {
    log207.warn(`${tableName}: \u76F4\u63A5\u6620\u5C04\u67E5\u8BE2\u5931\u8D25: ${e.message}`);
  }
  if (tableName === "bidding_logs") {
    try {
      const adGroupResult = await db.execute(sql.raw(`
        SELECT t.id, ag.campaignId as correctCampaignId
        FROM bidding_logs t
        INNER JOIN ad_groups ag ON t.adGroupId = CAST(ag.id AS CHAR)
        WHERE (LENGTH(t.campaignId) < ${AMAZON_ID_MIN_LENGTH} AND t.campaignId REGEXP '^[0-9]+$')
          OR t.campaignId LIKE 'ORPHAN_%'
          OR t.campaignId = 'UNRESOLVED'
        LIMIT 500
      `));
      const existingIds = new Set(records.map((r) => r.id));
      const rows = Array.isArray(adGroupResult[0]) ? adGroupResult[0] : adGroupResult;
      for (const row of rows) {
        if (row?.id && row?.correctCampaignId && !existingIds.has(Number(row.id))) {
          records.push({ id: Number(row.id), correctCampaignId: String(row.correctCampaignId) });
        }
      }
    } catch (e) {
      log207.warn(`bidding_logs: adGroupId\u94FE\u8DEF\u67E5\u8BE2\u5931\u8D25: ${e.message}`);
    }
  }
  return records;
}
async function migrateTable(db, tableName) {
  const errors = [];
  const needsMigration = await hasRecordsToMigrate(db, tableName);
  let hasOrphanRecords = false;
  if (tableName === "bidding_logs") {
    try {
      const orphanCheck = await db.execute(sql.raw(`
        SELECT 1 as found FROM bidding_logs 
        WHERE campaignId LIKE 'ORPHAN_%' OR campaignId = 'UNRESOLVED'
        LIMIT 1
      `));
      const rows = Array.isArray(orphanCheck[0]) ? orphanCheck[0] : orphanCheck;
      hasOrphanRecords = rows.length > 0;
    } catch (e) {
    }
  }
  if (!needsMigration && !hasOrphanRecords) {
    return { table: tableName, suspectedCount: 0, updatedCount: 0, failedCount: 0, skippedOrphans: 0, errors };
  }
  const recordsToMigrate = await findRecordsToMigrate(db, tableName);
  if (recordsToMigrate.length === 0) {
    const countResult = await db.execute(sql.raw(`
      SELECT COUNT(*) as cnt FROM \`${tableName}\` 
      WHERE LENGTH(campaignId) < ${AMAZON_ID_MIN_LENGTH} AND campaignId REGEXP '^[0-9]+$'
    `));
    const orphanCount = extractCount3(countResult);
    if (orphanCount > 0) {
      log207.info(`  ${tableName}: ${orphanCount} \u6761\u8BB0\u5F55\u65E0\u6CD5\u6620\u5C04\u5230 campaigns \u8868\uFF08\u5B64\u7ACB\u8BB0\u5F55\uFF09\uFF0C\u8DF3\u8FC7`);
    }
    return { table: tableName, suspectedCount: orphanCount, updatedCount: 0, failedCount: 0, skippedOrphans: orphanCount, errors };
  }
  log207.info(`  ${tableName}: \u627E\u5230 ${recordsToMigrate.length} \u6761\u8BB0\u5F55\u9700\u8981\u8FC1\u79FB`);
  let updatedCount = 0;
  let failedCount = 0;
  for (const record2 of recordsToMigrate) {
    try {
      await db.execute(sql.raw(
        // @ts-ignore
        `UPDATE \`${tableName}\` SET campaignId = '${record2.correctCampaignId}' WHERE id = ${record2.id}`
      ));
      updatedCount++;
    } catch (e) {
      failedCount++;
      const errMsg = `id=${record2.id} \u2192 ${record2.correctCampaignId} \u5931\u8D25: ${e.message}`;
      errors.push(errMsg);
      if (failedCount <= 3) {
        log207.warn(`  ${tableName}: ${errMsg}`);
      }
    }
  }
  return {
    table: tableName,
    suspectedCount: recordsToMigrate.length,
    updatedCount,
    failedCount,
    skippedOrphans: 0,
    errors
  };
}
async function migrateCampaignIdsToAmazonIds() {
  const db = await getDb();
  if (!db) {
    log207.warn("\u6570\u636E\u5E93\u4E0D\u53EF\u7528\uFF0C\u8DF3\u8FC7 campaignId \u6570\u636E\u8FC1\u79FB");
    return;
  }
  log207.info("=== v222 campaignId \u6570\u636E\u8FC1\u79FB\u68C0\u67E5 ===");
  logMigration("CampaignIdMigration", `v222 campaignId \u6570\u636E\u8FC1\u79FB\u68C0\u67E5\u5F00\u59CB`, {
    tables: [...TABLES_TO_MIGRATE],
    strategy: "select-then-update-by-pk"
  });
  let totalSuspected = 0;
  let totalUpdated = 0;
  let totalFailed = 0;
  let totalOrphans = 0;
  let allErrors = [];
  for (const tableName of TABLES_TO_MIGRATE) {
    try {
      const result = await migrateTable(db, tableName);
      totalSuspected += result.suspectedCount;
      totalUpdated += result.updatedCount;
      totalFailed += result.failedCount;
      totalOrphans += result.skippedOrphans;
      allErrors = allErrors.concat(result.errors);
      if (result.suspectedCount > 0 || result.updatedCount > 0) {
        const logMsg = `${result.table}: ${result.updatedCount}/${result.suspectedCount} \u6761\u5DF2\u4FEE\u590D` + (result.failedCount > 0 ? `, ${result.failedCount} \u6761\u5931\u8D25` : "") + (result.skippedOrphans > 0 ? `, ${result.skippedOrphans} \u6761\u5B64\u7ACB\u8DF3\u8FC7` : "");
        log207.info(`  ${logMsg}`);
        logMigration("CampaignIdMigration", `\u8868${result.table}\u8FC1\u79FB\u5B8C\u6210`, {
          table: result.table,
          suspected: result.suspectedCount,
          updated: result.updatedCount,
          failed: result.failedCount,
          orphans: result.skippedOrphans,
          errors: result.errors.length > 0 ? result.errors : void 0
        });
      }
    } catch (tableErr) {
      log207.warn(`  \u8FC1\u79FB\u8868 ${tableName} \u5F02\u5E38: ${tableErr.message}`);
      allErrors.push(`${tableName}: ${tableErr.message}`);
    }
  }
  if (totalSuspected === 0 && totalOrphans === 0) {
    log207.info("\u6240\u6709\u8868\u7684 campaignId \u5DF2\u7ECF\u662F Amazon ID\uFF0C\u65E0\u9700\u8FC1\u79FB \u2713");
    logMigration("CampaignIdMigration", "\u6240\u6709\u8868\u7684 campaignId \u5DF2\u7ECF\u662F Amazon ID\uFF0C\u65E0\u9700\u8FC1\u79FB");
  } else {
    const summary = `\u8FC1\u79FB\u5B8C\u6210: ${totalUpdated}/${totalSuspected} \u6761\u5DF2\u4FEE\u590D` + (totalFailed > 0 ? `, ${totalFailed} \u6761\u5931\u8D25` : "") + (totalOrphans > 0 ? `, ${totalOrphans} \u6761\u5B64\u7ACB\u8DF3\u8FC7` : "");
    log207.info(`=== ${summary} ===`);
    logMigration("CampaignIdMigration", summary, {
      totalSuspected,
      totalUpdated,
      totalFailed,
      totalOrphans,
      errors: allErrors.length > 0 ? allErrors : void 0
    });
    if (totalFailed > 0) {
      logMigrationError("CampaignIdMigration", `${totalFailed} \u6761\u8BB0\u5F55\u8FC1\u79FB\u5931\u8D25`, {
        errors: allErrors
      });
    }
  }
}
var log207, TABLES_TO_MIGRATE, AMAZON_ID_MIN_LENGTH;
var init_migrateCampaignIds = __esm({
  "server/utils/migrateCampaignIds.ts"() {
    "use strict";
    init_db2();
    init_drizzle_orm();
    init_logger();
    init_opsLogger();
    log207 = createModuleLogger("migrateCampaignIds");
    TABLES_TO_MIGRATE = [
      "negative_keywords",
      "bidding_logs",
      "daily_performance",
      "search_terms",
      "ad_groups",
      "placement_performance"
    ];
    AMAZON_ID_MIN_LENGTH = 10;
    __name(extractCount3, "extractCount");
    __name(hasRecordsToMigrate, "hasRecordsToMigrate");
    __name(findRecordsToMigrate, "findRecordsToMigrate");
    __name(migrateTable, "migrateTable");
    __name(migrateCampaignIdsToAmazonIds, "migrateCampaignIdsToAmazonIds");
  }
});

