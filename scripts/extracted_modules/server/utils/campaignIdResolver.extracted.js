// Extracted from production dist/index.js
// Original module: server/utils/campaignIdResolver.ts
// Lines: 152

var campaignIdResolver_exports = {};
__export(campaignIdResolver_exports, {
  getCacheStats: () => getCacheStats,
  preloadCampaignIdCache: () => preloadCampaignIdCache,
  quickValidateCampaignId: () => quickValidateCampaignId,
  safeCampaignIdForInsert: () => safeCampaignIdForInsert
});
function getCachedCampaignId(adGroupId) {
  const ts = cacheTimestamps.get(adGroupId);
  if (ts && Date.now() - ts < CACHE_TTL_MS) {
    return adGroupToCampaignCache.get(adGroupId);
  }
  adGroupToCampaignCache.delete(adGroupId);
  cacheTimestamps.delete(adGroupId);
  return void 0;
}
function setCachedCampaignId(adGroupId, campaignId) {
  adGroupToCampaignCache.set(adGroupId, campaignId);
  cacheTimestamps.set(adGroupId, Date.now());
  if (adGroupToCampaignCache.size > 5e3) {
    const oldestKey = adGroupToCampaignCache.keys().next().value;
    if (oldestKey !== void 0) {
      adGroupToCampaignCache.delete(oldestKey);
      cacheTimestamps.delete(oldestKey);
    }
  }
}
async function safeCampaignIdForInsert(ctx) {
  if (ctx.campaignId != null) {
    const str = String(ctx.campaignId).trim();
    if (str !== "" && str !== "0" && str !== "null" && str !== "undefined") {
      const classification = classifyCampaignId(str);
      if (classification === "amazon") {
        return str;
      }
      if (classification === "ambiguous" && isValidAmazonId(str)) {
        return str;
      }
      log10.warn(`[${ctx.caller}] campaignId(${str}) \u88AB\u5206\u7C7B\u4E3A ${classification}\uFF0C\u5C1D\u8BD5\u901A\u8FC7\u4E0A\u4E0B\u6587\u89E3\u6790`);
    }
  }
  let resolvedAdGroupId = ctx.adGroupId;
  if (!resolvedAdGroupId && ctx.targetLocalId) {
    resolvedAdGroupId = await resolveAdGroupIdFromTarget(ctx.targetLocalId, ctx.targetType || "keyword");
  }
  if (resolvedAdGroupId) {
    const campaignId = await resolveCampaignIdFromAdGroup(resolvedAdGroupId);
    if (campaignId) {
      log10.debug(`[${ctx.caller}] campaignId \u89E3\u6790\u6210\u529F: adGroupId=${resolvedAdGroupId} \u2192 campaignId=${campaignId}`);
      return campaignId;
    }
  }
  log10.warn(`[${ctx.caller}] \u26D4 campaignId \u89E3\u6790\u5931\u8D25! \u539F\u59CB\u503C=${ctx.campaignId}, adGroupId=${ctx.adGroupId}, targetLocalId=${ctx.targetLocalId}. \u5199\u5165 UNRESOLVED`);
  return "UNRESOLVED";
}
function quickValidateCampaignId(value, caller) {
  if (value == null) return "UNRESOLVED";
  const str = String(value).trim();
  if (str === "" || str === "0" || str === "null" || str === "undefined") {
    log10.warn(`[${caller}] quickValidate: campaignId \u65E0\u6548(${value})\uFF0C\u6807\u8BB0\u4E3A UNRESOLVED`);
    return "UNRESOLVED";
  }
  const classification = classifyCampaignId(str);
  if (classification === "local") {
    log10.warn(`[${caller}] quickValidate: campaignId(${str}) \u7591\u4F3C\u672C\u5730ID\uFF0C\u6807\u8BB0\u4E3A UNRESOLVED`);
    return "UNRESOLVED";
  }
  return str;
}
async function resolveCampaignIdFromAdGroup(adGroupId) {
  const cached2 = getCachedCampaignId(adGroupId);
  if (cached2) return cached2;
  try {
    const adGroup = await queryAdGroupById(adGroupId);
    if (adGroup && adGroup.campaignId) {
      const campaignId = String(adGroup.campaignId).trim();
      if (isValidAmazonId(campaignId) && classifyCampaignId(campaignId) !== "local") {
        setCachedCampaignId(adGroupId, campaignId);
        return campaignId;
      }
    }
    log10.warn(`[CampaignIdResolver] adGroupId=${adGroupId} \u672A\u627E\u5230\u6709\u6548\u7684 campaignId`);
    return null;
  } catch (err) {
    log10.warn(`[CampaignIdResolver] \u901A\u8FC7 adGroupId=${adGroupId} \u89E3\u6790 campaignId \u5931\u8D25: ${err.message}`);
    return null;
  }
}
async function resolveAdGroupIdFromTarget(targetLocalId, targetType) {
  try {
    if (targetType === "product_target") {
      const target = await queryProductTargetById(targetLocalId);
      return target?.adGroupId ? Number(target.adGroupId) : null;
    } else {
      const keyword = await queryKeywordById(targetLocalId);
      return keyword?.adGroupId ? Number(keyword.adGroupId) : null;
    }
  } catch (err) {
    log10.warn(`[CampaignIdResolver] \u901A\u8FC7 ${targetType} id=${targetLocalId} \u89E3\u6790 adGroupId \u5931\u8D25: ${err.message}`);
    return null;
  }
}
async function preloadCampaignIdCache(adGroupIds) {
  const uncachedIds = adGroupIds.filter((id) => !getCachedCampaignId(id));
  if (uncachedIds.length === 0) return;
  try {
    const db = await queryDb();
    if (!db) return;
    const { adGroups: adGroups6 } = await Promise.resolve().then(() => (init_schema2(), schema_exports));
    const { inArray: inArray13 } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
    const results = await db.select({
      id: adGroups6.id,
      campaignId: adGroups6.campaignId
    }).from(adGroups6).where(inArray13(adGroups6.id, uncachedIds));
    for (const row of results) {
      if (row.campaignId && isValidAmazonId(row.campaignId)) {
        setCachedCampaignId(row.id, row.campaignId);
      }
    }
    log10.debug(`[CampaignIdResolver] \u9884\u70ED\u7F13\u5B58: ${results.length}/${uncachedIds.length} \u4E2A adGroup \u7684 campaignId`);
  } catch (err) {
    log10.warn(`[CampaignIdResolver] \u9884\u70ED\u7F13\u5B58\u5931\u8D25: ${err.message}`);
  }
}
function getCacheStats() {
  return {
    size: adGroupToCampaignCache.size,
    maxSize: 5e3
  };
}
var log10, adGroupToCampaignCache, CACHE_TTL_MS, cacheTimestamps;
var init_campaignIdResolver = __esm({
  "server/utils/campaignIdResolver.ts"() {
    "use strict";
    init_logger();
    init_idTypes();
    init_dbQueryProvider();
    log10 = createModuleLogger("CampaignIdResolver");
    adGroupToCampaignCache = /* @__PURE__ */ new Map();
    CACHE_TTL_MS = 10 * 60 * 1e3;
    cacheTimestamps = /* @__PURE__ */ new Map();
    __name(getCachedCampaignId, "getCachedCampaignId");
    __name(setCachedCampaignId, "setCachedCampaignId");
    __name(safeCampaignIdForInsert, "safeCampaignIdForInsert");
    __name(quickValidateCampaignId, "quickValidateCampaignId");
    __name(resolveCampaignIdFromAdGroup, "resolveCampaignIdFromAdGroup");
    __name(resolveAdGroupIdFromTarget, "resolveAdGroupIdFromTarget");
    __name(preloadCampaignIdCache, "preloadCampaignIdCache");
    __name(getCacheStats, "getCacheStats");
  }
});

