// Extracted from production dist/index.js
// Original module: server/utils/idTypes.ts
// Lines: 289

var idTypes_exports = {};
__export(idTypes_exports, {
  ID_DICTIONARY: () => ID_DICTIONARY,
  assertAmazonAdGroupId: () => assertAmazonAdGroupId,
  assertAmazonCampaignId: () => assertAmazonCampaignId,
  assertLocalId: () => assertLocalId,
  buildKeywordIdMap: () => buildKeywordIdMap,
  buildTargetIdMap: () => buildTargetIdMap,
  classifyCampaignId: () => classifyCampaignId,
  ensureAmazonCampaignId: () => ensureAmazonCampaignId,
  ensureLocalAdGroupId: () => ensureLocalAdGroupId,
  extractAdGroupIds: () => extractAdGroupIds,
  extractCampaignIds: () => extractCampaignIds,
  getAdGroupAmazonId: () => getAdGroupAmazonId,
  getCampaignAmazonId: () => getCampaignAmazonId,
  getCampaignLocalId: () => getCampaignLocalId,
  getKeywordAmazonId: () => getKeywordAmazonId,
  getTargetAmazonId: () => getTargetAmazonId,
  guardAdGroupIdInsert: () => guardAdGroupIdInsert,
  guardAdGroupIdParam: () => guardAdGroupIdParam,
  guardCampaignIdInsert: () => guardCampaignIdInsert,
  guardCampaignIdParam: () => guardCampaignIdParam,
  isValidAmazonId: () => isValidAmazonId,
  isValidLocalId: () => isValidLocalId
});
function isValidAmazonId(value) {
  if (typeof value !== "string" && typeof value !== "number") return false;
  const str = String(value).trim();
  if (str === "" || str === "0" || str === "null" || str === "undefined") return false;
  return /^\d{1,20}$/.test(str);
}
function isValidLocalId(value) {
  if (typeof value === "number") return Number.isInteger(value) && value > 0;
  if (typeof value === "string") {
    const num = parseInt(value, 10);
    return !isNaN(num) && num > 0 && String(num) === value;
  }
  return false;
}
function classifyCampaignId(value) {
  const str = String(value).trim();
  if (!isValidAmazonId(str)) return "ambiguous";
  if (typeof value === "string" && str.length >= 8) return "amazon";
  const num = typeof value === "number" ? value : parseInt(str, 10);
  if (str.length > 15) return "amazon";
  if (str.length >= 10) return "amazon";
  if (num < 1e4) return "local";
  return "ambiguous";
}
function assertAmazonCampaignId(value, context) {
  const str = String(value).trim();
  const classification = classifyCampaignId(value);
  if (classification === "local") {
    const errorMsg = `[IdTypes] \u26D4 \u65AD\u8A00\u5931\u8D25: \u68C0\u6D4B\u5230\u672C\u5730campaignId(${value})\u88AB\u7528\u4E8E\u9700\u8981Amazon ID\u7684\u573A\u666F! \u8C03\u7528\u6765\u6E90: ${context}. \u5FC5\u987B\u4F20\u5165campaign.campaignId\u800C\u975Ecampaign.id`;
    log6.warn(errorMsg);
    logIdGuardError("IdTypes", `assertAmazonCampaignId: ${errorMsg}`, { context, value: String(value), classification });
    throw new Error(errorMsg);
  }
}
function assertAmazonAdGroupId(value, context) {
  const str = String(value).trim();
  const classification = classifyCampaignId(value);
  if (classification === "local") {
    const errorMsg = `[IdTypes] \u26D4 \u65AD\u8A00\u5931\u8D25: \u68C0\u6D4B\u5230\u672C\u5730adGroupId(${value})\u88AB\u7528\u4E8E\u9700\u8981Amazon ID\u7684\u573A\u666F! \u8C03\u7528\u6765\u6E90: ${context}. \u5FC5\u987B\u4F20\u5165adGroup.adGroupId\u800C\u975EadGroup.id`;
    log6.warn(errorMsg);
    logIdGuardError("IdTypes", `assertAmazonAdGroupId: ${errorMsg}`, { context, value: String(value), classification });
    throw new Error(errorMsg);
  }
}
function assertLocalId(value, context) {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    const errorMsg = `[IdTypes] \u26D4 \u65AD\u8A00\u5931\u8D25: \u65E0\u6548\u7684\u672C\u5730ID(${value}, type=${typeof value})! \u8C03\u7528\u6765\u6E90: ${context}`;
    log6.warn(errorMsg);
    throw new Error(errorMsg);
  }
}
function extractCampaignIds(campaign, context = "") {
  const localId = campaign.id;
  if (localId == null || typeof localId !== "number" || localId <= 0) {
    const errorMsg = `[IdTypes] \u26D4 Campaign\u5BF9\u8C61\u7F3A\u5C11\u6709\u6548\u7684\u672C\u5730id! id=${campaign.id}, campaignId=${campaign.campaignId}${context ? ` [${context}]` : ""}`;
    log6.warn(errorMsg);
    throw new Error(errorMsg);
  }
  const rawAmazonId = campaign.campaignId;
  if (rawAmazonId == null) {
    const errorMsg = `[IdTypes] \u26D4 Campaign\u5BF9\u8C61\u7F3A\u5C11campaignId\u5B57\u6BB5! id=${campaign.id}${context ? ` [${context}]` : ""}`;
    log6.warn(errorMsg);
    throw new Error(errorMsg);
  }
  const amazonId = String(rawAmazonId).trim();
  if (!isValidAmazonId(amazonId)) {
    const errorMsg = `[IdTypes] \u26D4 Campaign\u7684campaignId\u65E0\u6548! id=${campaign.id}, campaignId="${rawAmazonId}"${context ? ` [${context}]` : ""}`;
    log6.warn(errorMsg);
    throw new Error(errorMsg);
  }
  if (classifyCampaignId(amazonId) === "local") {
    log6.warn(`[IdTypes] \u26A0\uFE0F Campaign\u7684campaignId(${amazonId})\u770B\u8D77\u6765\u50CF\u672C\u5730ID! id=${campaign.id}. \u53EF\u80FD\u662F\u5386\u53F2\u6570\u636E\u95EE\u9898\u3002${context ? ` [${context}]` : ""}`);
  }
  return { localId, amazonId };
}
function extractAdGroupIds(adGroup, context = "") {
  const localId = adGroup.id;
  if (localId == null || typeof localId !== "number" || localId <= 0) {
    const errorMsg = `[IdTypes] \u26D4 AdGroup\u5BF9\u8C61\u7F3A\u5C11\u6709\u6548\u7684\u672C\u5730id! id=${adGroup.id}, adGroupId=${adGroup.adGroupId}${context ? ` [${context}]` : ""}`;
    log6.warn(errorMsg);
    throw new Error(errorMsg);
  }
  const rawAmazonId = adGroup.adGroupId;
  if (rawAmazonId == null) {
    const errorMsg = `[IdTypes] \u26D4 AdGroup\u5BF9\u8C61\u7F3A\u5C11adGroupId\u5B57\u6BB5! id=${adGroup.id}${context ? ` [${context}]` : ""}`;
    log6.warn(errorMsg);
    throw new Error(errorMsg);
  }
  const amazonId = String(rawAmazonId).trim();
  if (!isValidAmazonId(amazonId)) {
    const errorMsg = `[IdTypes] \u26D4 AdGroup\u7684adGroupId\u65E0\u6548! id=${adGroup.id}, adGroupId="${rawAmazonId}"${context ? ` [${context}]` : ""}`;
    log6.warn(errorMsg);
    throw new Error(errorMsg);
  }
  return { localId, amazonId };
}
function getCampaignAmazonId(campaign) {
  return extractCampaignIds(campaign).amazonId;
}
function getCampaignLocalId(campaign) {
  return extractCampaignIds(campaign).localId;
}
function getAdGroupAmazonId(adGroup) {
  return extractAdGroupIds(adGroup).amazonId;
}
function getKeywordAmazonId(keyword) {
  if (keyword.keywordId != null) {
    const amazonId = String(keyword.keywordId).trim();
    if (isValidAmazonId(amazonId)) {
      return amazonId;
    }
  }
  return null;
}
function getTargetAmazonId(target) {
  if (target.targetId != null) {
    const amazonId = String(target.targetId).trim();
    if (isValidAmazonId(amazonId)) {
      return amazonId;
    }
  }
  return null;
}
function guardCampaignIdParam(value, functionName) {
  const str = String(value).trim();
  const classification = classifyCampaignId(value);
  if (classification === "local") {
    const msg = `${functionName}() \u6536\u5230\u672C\u5730campaignId(${value})! \u8C03\u7528\u8005\u5FC5\u987B\u4F20\u5165campaign.campaignId\u800C\u975Ecampaign.id`;
    log6.warn(`[IdTypes] \u26D4 ${msg}`);
    logIdGuardError("IdTypes", `guardCampaignIdParam: ${msg}`, { functionName, value: String(value), classification });
    throw new Error(`[IdTypes] ${functionName}() \u6536\u5230\u672C\u5730campaignId(${value})`);
  }
  return str;
}
function guardCampaignIdInsert(value, tableName) {
  const str = String(value).trim();
  const classification = classifyCampaignId(value);
  if (classification === "local") {
    const msg = `\u26D4 v439\u62E6\u622A: \u5C1D\u8BD5\u5C06\u672C\u5730campaignId(${value})\u5199\u5165${tableName}.campaignId! \u8BE5\u5B57\u6BB5\u5E94\u5B58\u50A8Amazon Campaign ID`;
    log6.warn(`[IdTypes] ${msg}`);
    logIdGuardError("IdTypes", `guardCampaignIdInsert: ${msg}`, { tableName, value: String(value), classification });
    log6.warn(new Error(`[IdTypes] \u672C\u5730ID(${value})\u5199\u5165${tableName}.campaignId`).stack || "");
    throw new Error(`[IdTypes] \u62E6\u622A\u672C\u5730ID\u5199\u5165: ${tableName}.campaignId = ${value}`);
  }
  return str;
}
function guardAdGroupIdParam(value, functionName) {
  const str = String(value).trim();
  const classification = classifyCampaignId(value);
  if (classification === "local") {
    const msg = `${functionName}() \u6536\u5230\u672C\u5730adGroupId(${value})! \u8C03\u7528\u8005\u5FC5\u987B\u4F20\u5165adGroup.adGroupId\u800C\u975EadGroup.id`;
    log6.warn(`[IdTypes] \u26D4 ${msg}`);
    logIdGuardError("IdTypes", `guardAdGroupIdParam: ${msg}`, { functionName, value: String(value), classification });
    throw new Error(`[IdTypes] ${functionName}() \u6536\u5230\u672C\u5730adGroupId(${value})`);
  }
  return str;
}
function guardAdGroupIdInsert(value, tableName) {
  const str = String(value).trim();
  const classification = classifyCampaignId(value);
  if (classification === "local") {
    const msg = `\u26D4 v440\u62E6\u622A: \u5C1D\u8BD5\u5C06\u672C\u5730adGroupId(${value})\u5199\u5165${tableName}.adGroupId! \u8BE5\u5B57\u6BB5\u5E94\u5B58\u50A8Amazon Ad Group ID`;
    log6.warn(`[IdTypes] ${msg}`);
    logIdGuardError("IdTypes", `guardAdGroupIdInsert: ${msg}`, { tableName, value: String(value), classification });
    throw new Error(`[IdTypes] \u62E6\u622A\u672C\u5730ID\u5199\u5165: ${tableName}.adGroupId = ${value}`);
  }
  return str;
}
function ensureAmazonCampaignId(value, context = "unknown") {
  return guardCampaignIdParam(value, context);
}
function ensureLocalAdGroupId(value) {
  if (typeof value === "number") return value;
  const num = parseInt(String(value), 10);
  if (isNaN(num) || num <= 0) {
    throw new Error(`\u65E0\u6548\u7684\u672C\u5730adGroupId: ${value}`);
  }
  return num;
}
function buildKeywordIdMap(keywords10) {
  const map2 = /* @__PURE__ */ new Map();
  for (const kw of keywords10) {
    const amazonId = getKeywordAmazonId(kw);
    if (amazonId) {
      map2.set(kw.id, amazonId);
    }
  }
  return map2;
}
function buildTargetIdMap(targets) {
  const map2 = /* @__PURE__ */ new Map();
  for (const pt of targets) {
    const amazonId = getTargetAmazonId(pt);
    if (amazonId) {
      map2.set(pt.id, amazonId);
    }
  }
  return map2;
}
var log6, ID_DICTIONARY;
var init_idTypes = __esm({
  "server/utils/idTypes.ts"() {
    "use strict";
    init_logger();
    init_opsLogger();
    log6 = createModuleLogger("IdTypes");
    __name(isValidAmazonId, "isValidAmazonId");
    __name(isValidLocalId, "isValidLocalId");
    __name(classifyCampaignId, "classifyCampaignId");
    __name(assertAmazonCampaignId, "assertAmazonCampaignId");
    __name(assertAmazonAdGroupId, "assertAmazonAdGroupId");
    __name(assertLocalId, "assertLocalId");
    __name(extractCampaignIds, "extractCampaignIds");
    __name(extractAdGroupIds, "extractAdGroupIds");
    __name(getCampaignAmazonId, "getCampaignAmazonId");
    __name(getCampaignLocalId, "getCampaignLocalId");
    __name(getAdGroupAmazonId, "getAdGroupAmazonId");
    __name(getKeywordAmazonId, "getKeywordAmazonId");
    __name(getTargetAmazonId, "getTargetAmazonId");
    __name(guardCampaignIdParam, "guardCampaignIdParam");
    __name(guardCampaignIdInsert, "guardCampaignIdInsert");
    __name(guardAdGroupIdParam, "guardAdGroupIdParam");
    __name(guardAdGroupIdInsert, "guardAdGroupIdInsert");
    __name(ensureAmazonCampaignId, "ensureAmazonCampaignId");
    __name(ensureLocalAdGroupId, "ensureLocalAdGroupId");
    __name(buildKeywordIdMap, "buildKeywordIdMap");
    __name(buildTargetIdMap, "buildTargetIdMap");
    ID_DICTIONARY = {
      // ===== campaigns =====
      "campaigns.id": { dbType: "int", meaning: "LOCAL_PK", joinsWith: "NOTHING across tables", apiUsage: "NEVER send to Amazon API", guard: "assertLocalId" },
      "campaigns.campaignId": { dbType: "varchar", meaning: "AMAZON_ID", joinsWith: "adGroups.campaignId, dailyPerformance.campaignId, searchTerms.campaignId, negativeKeywords.campaignId, biddingLogs.campaignId", apiUsage: "Use for all Amazon API calls", guard: "assertAmazonCampaignId" },
      "campaigns.accountId": { dbType: "int", meaning: "LOCAL_FK", joinsWith: "accounts.id", apiUsage: "N/A", guard: "assertLocalId" },
      // ===== adGroups =====
      "adGroups.id": { dbType: "int", meaning: "LOCAL_PK", joinsWith: "keywords.internalAdGroupId, productTargets.internalAdGroupId", apiUsage: "NEVER send to Amazon API", guard: "assertLocalId" },
      "adGroups.adGroupId": { dbType: "varchar", meaning: "AMAZON_ID", joinsWith: "Amazon API only", apiUsage: "Use for all Amazon API calls", guard: "assertAmazonAdGroupId" },
      "adGroups.campaignId": { dbType: "varchar", meaning: "AMAZON_FK", joinsWith: "\u26A0\uFE0F campaigns.campaignId (NOT campaigns.id!)", apiUsage: "N/A", guard: "assertAmazonCampaignId" },
      // ===== keywords =====
      "keywords.id": { dbType: "int", meaning: "LOCAL_PK", joinsWith: "biddingLogs.targetId, optimizationEvents.keyword_id", apiUsage: "NEVER send to Amazon API", guard: "assertLocalId" },
      "keywords.keywordId": { dbType: "varchar", meaning: "AMAZON_ID", joinsWith: "Amazon API only", apiUsage: "Use for all Amazon API calls (bid updates, etc.)", guard: "N/A (may be null for new keywords)" },
      "keywords.internalAdGroupId": { dbType: "int", meaning: "LOCAL_FK", joinsWith: "adGroups.id", apiUsage: "N/A", guard: "assertLocalId" },
      // ===== productTargets =====
      "productTargets.id": { dbType: "int", meaning: "LOCAL_PK", joinsWith: "biddingLogs.targetId", apiUsage: "NEVER send to Amazon API", guard: "assertLocalId" },
      "productTargets.targetId": { dbType: "varchar", meaning: "AMAZON_ID", joinsWith: "Amazon API only", apiUsage: "Use for all Amazon API calls", guard: "N/A (may be null)" },
      "productTargets.internalAdGroupId": { dbType: "int", meaning: "LOCAL_FK", joinsWith: "adGroups.id", apiUsage: "N/A", guard: "assertLocalId" },
      // ===== negativeKeywords (v208: 已统一为Amazon ID) =====
      "negativeKeywords.id": { dbType: "int", meaning: "LOCAL_PK", joinsWith: "N/A", apiUsage: "N/A", guard: "assertLocalId" },
      "negativeKeywords.amazonNegativeKeywordId": { dbType: "varchar", meaning: "AMAZON_ID", joinsWith: "Amazon API", apiUsage: "Use for Amazon API calls", guard: "assertAmazonCampaignId" },
      "negativeKeywords.campaignId": { dbType: "varchar", meaning: "AMAZON_FK", joinsWith: "campaigns.campaignId", apiUsage: "N/A", guard: "guardCampaignIdInsert" },
      "negativeKeywords.internalAdGroupId": { dbType: "int", meaning: "LOCAL_FK", joinsWith: "adGroups.id", apiUsage: "N/A", guard: "assertLocalId" },
      // ===== biddingLogs (v208: 已统一为Amazon ID) =====
      "biddingLogs.campaignId": { dbType: "varchar", meaning: "AMAZON_FK", joinsWith: "campaigns.campaignId", apiUsage: "N/A (log only)", guard: "guardCampaignIdInsert" },
      "biddingLogs.targetId": { dbType: "int", meaning: "LOCAL_FK", joinsWith: "keywords.id or productTargets.id", apiUsage: "N/A (log only)", guard: "assertLocalId" },
      "biddingLogs.internalAdGroupId": { dbType: "int", meaning: "LOCAL_FK", joinsWith: "adGroups.id", apiUsage: "N/A (log only)", guard: "assertLocalId" },
      // ===== dailyPerformance =====
      "dailyPerformance.campaignId": { dbType: "varchar", meaning: "AMAZON_FK", joinsWith: "campaigns.campaignId", apiUsage: "N/A", guard: "guardCampaignIdInsert" },
      // ===== searchTerms =====
      "searchTerms.campaignId": { dbType: "varchar", meaning: "AMAZON_FK", joinsWith: "campaigns.campaignId", apiUsage: "N/A", guard: "guardCampaignIdInsert" },
      "searchTerms.internalAdGroupId": { dbType: "int", meaning: "LOCAL_FK", joinsWith: "adGroups.id", apiUsage: "N/A", guard: "assertLocalId" },
      // ===== placementPerformance =====
      "placementPerformance.campaignId": { dbType: "varchar", meaning: "AMAZON_FK", joinsWith: "campaigns.campaignId", apiUsage: "N/A", guard: "guardCampaignIdInsert" }
    };
  }
});

