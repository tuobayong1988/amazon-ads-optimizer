// Extracted from production dist/index.js
// Original module: server/sync/syncHelpers.ts
// Lines: 131

async function getRecentlyOptimizedKeywordIds(keywordIds, hoursWindow = 24) {
  try {
    if (keywordIds.length === 0) return /* @__PURE__ */ new Set();
    const db = await getDb();
    if (!db) {
      log165.warn("v212: \u6570\u636E\u5E93\u8FDE\u63A5\u4E0D\u53EF\u7528\uFF0C\u4FDD\u62A4\u673A\u5236\u65E0\u6CD5\u5DE5\u4F5C\uFF01");
      return /* @__PURE__ */ new Set();
    }
    const cutoff = new Date(Date.now() - hoursWindow * 60 * 60 * 1e3).toISOString().slice(0, 19).replace("T", " ");
    const results = await db.select({ keywordId: optimizationEvents2.keywordId }).from(optimizationEvents2).where(and(
      eq(optimizationEvents2.eventCategory, "bid_adjustment"),
      // @ts-ignore
      eq(optimizationEvents2.apiSyncStatus, "synced"),
      gte(optimizationEvents2.createdAt, cutoff),
      // @ts-ignore
      inArray(optimizationEvents2.keywordId, keywordIds)
    )).groupBy(optimizationEvents2.keywordId);
    const protectedSet = new Set(results.map((r) => r.keywordId).filter(Boolean));
    if (protectedSet.size === 0 && keywordIds.length > 0) {
      try {
        const fallbackResults = await db.execute(
          sql`SELECT DISTINCT JSON_UNQUOTE(JSON_EXTRACT(action_detail, '$.keywordId')) as kw_id
              FROM optimization_logs
              WHERE log_category = 'bid_adjustment'
                AND api_sync_status IN ('synced', 'partial')
                AND created_at >= ${cutoff}
                AND JSON_EXTRACT(action_detail, '$.keywordId') IS NOT NULL`
          // @ts-ignore
        );
        const fallbackRows = fallbackResults[0] || [];
        if (fallbackRows && fallbackRows.length > 0) {
          const fallbackKeywordIds = new Set(fallbackRows.map((r) => Number(r.kw_id)).filter((id) => id > 0 && keywordIds.includes(id)));
          if (fallbackKeywordIds.size > 0) {
            log165.debug(`v212: Fallback\u67E5\u8BE2optimization_logs\u627E\u5230${fallbackKeywordIds.size}\u4E2A\u9700\u8981\u4FDD\u62A4\u7684\u5173\u952E\u8BCD`);
            for (const id of fallbackKeywordIds) protectedSet.add(id);
          }
        }
      } catch (fallbackErr) {
        log165.warn("v212: Fallback\u67E5\u8BE2optimization_logs\u5931\u8D25:", fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr));
      }
    }
    log165.info(`v212: \u67E5\u8BE2\u5B8C\u6210, \u8F93\u5165${keywordIds.length}\u4E2A\u5173\u952E\u8BCD, \u4FDD\u62A4${protectedSet.size}\u4E2A`);
    return protectedSet;
  } catch (error48) {
    log165.warn("v212: \u6279\u91CF\u67E5\u8BE2\u4F18\u5316\u5173\u952E\u8BCD\u5931\u8D25\uFF0C\u4FDD\u62A4\u673A\u5236\u964D\u7EA7\uFF01", error48 instanceof Error ? error48.message : String(error48));
    return /* @__PURE__ */ new Set();
  }
}
async function getRecentlyOptimizedCampaignIds(campaignIds, hoursWindow = 24) {
  try {
    if (campaignIds.length === 0) return /* @__PURE__ */ new Set();
    const db = await getDb();
    if (!db) {
      log165.warn("v212: \u6570\u636E\u5E93\u8FDE\u63A5\u4E0D\u53EF\u7528\uFF0C\u9884\u7B97\u4FDD\u62A4\u673A\u5236\u65E0\u6CD5\u5DE5\u4F5C\uFF01");
      return /* @__PURE__ */ new Set();
    }
    const cutoff = new Date(Date.now() - hoursWindow * 60 * 60 * 1e3).toISOString().slice(0, 19).replace("T", " ");
    const results = await db.select({ campaignId: optimizationEvents2.campaignId }).from(optimizationEvents2).where(and(
      eq(optimizationEvents2.eventCategory, "budget_adjustment"),
      eq(optimizationEvents2.apiSyncStatus, "synced"),
      gte(optimizationEvents2.createdAt, cutoff),
      // @ts-ignore
      inArray(optimizationEvents2.campaignId, campaignIds)
    )).groupBy(optimizationEvents2.campaignId);
    const protectedSet = new Set(results.map((r) => r.campaignId).filter(Boolean));
    log165.info(`v212: \u9884\u7B97\u4FDD\u62A4\u67E5\u8BE2\u5B8C\u6210, \u8F93\u5165${campaignIds.length}\u4E2A\u5E7F\u544A\u6D3B\u52A8, \u4FDD\u62A4${protectedSet.size}\u4E2A`);
    return protectedSet;
  } catch (error48) {
    log165.warn("v212: \u6279\u91CF\u67E5\u8BE2\u4F18\u5316\u5E7F\u544A\u6D3B\u52A8\u5931\u8D25:", error48 instanceof Error ? error48.message : String(error48));
    return /* @__PURE__ */ new Set();
  }
}
function createSyncProtectionStats() {
  return { bidProtected: 0, bidOverwritten: 0, budgetProtected: 0, budgetOverwritten: 0, protectedEntities: [] };
}
function logSyncProtectionSummary(functionName, stats4) {
  const total = stats4.bidProtected + stats4.bidOverwritten + stats4.budgetProtected + stats4.budgetOverwritten;
  if (total === 0) return;
  log165.info(`${functionName} \u540C\u6B65\u4FDD\u62A4\u6458\u8981: \u51FA\u4EF7\u4FDD\u62A4=${stats4.bidProtected}, \u51FA\u4EF7\u8986\u76D9=${stats4.bidOverwritten}, \u9884\u7B97\u4FDD\u62A4=${stats4.budgetProtected}, \u9884\u7B97\u8986\u76D9=${stats4.budgetOverwritten}`);
  if (stats4.protectedEntities.length > 0) {
    log165.debug(`${functionName} \u88AB\u4FDD\u62A4\u5B9E\u4F53: ${stats4.protectedEntities.slice(0, 20).join(", ")}${stats4.protectedEntities.length > 20 ? ` ...\u7B49${stats4.protectedEntities.length}\u4E2A` : ""}`);
  }
}
function detectConflict(existing, newData, fieldsToCheck) {
  const conflictFields = [];
  const isEmptyValue = /* @__PURE__ */ __name((value) => {
    if (value === void 0 || value === null) return true;
    const strValue = String(value).trim();
    return strValue === "" || strValue === "0" || strValue === "0.00" || strValue === "0.0";
  }, "isEmptyValue");
  for (const field of fieldsToCheck) {
    const existingValue = existing[field];
    const newValue = newData[field];
    if (isEmptyValue(existingValue)) continue;
    if (isEmptyValue(newValue)) continue;
    const existingStr = String(existingValue).trim();
    const newStr = String(newValue).trim();
    if (existingStr !== newStr) {
      conflictFields.push(field);
    }
  }
  return {
    hasConflict: conflictFields.length > 0,
    conflictFields
  };
}
var log165, SYNC_PROTECTION_CONFIG;
var init_syncHelpers = __esm({
  "server/sync/syncHelpers.ts"() {
    "use strict";
    init_drizzle_orm();
    init_db2();
    init_schema2();
    init_logger();
    log165 = createModuleLogger("SyncHelpers");
    SYNC_PROTECTION_CONFIG = {
      /** 出价保护时间窗口（小时） */
      BID_PROTECTION_HOURS: 24,
      /** 预算保护时间窗口（小时） */
      BUDGET_PROTECTION_HOURS: 24,
      /** 出价/预算差异阈值（美元） */
      BID_THRESHOLD: 0.01
    };
    __name(getRecentlyOptimizedKeywordIds, "getRecentlyOptimizedKeywordIds");
    __name(getRecentlyOptimizedCampaignIds, "getRecentlyOptimizedCampaignIds");
    __name(createSyncProtectionStats, "createSyncProtectionStats");
    __name(logSyncProtectionSummary, "logSyncProtectionSummary");
    __name(detectConflict, "detectConflict");
  }
});

