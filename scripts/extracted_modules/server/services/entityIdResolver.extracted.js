// Extracted from production dist/index.js
// Original module: server/services/entityIdResolver.ts
// Lines: 409

var entityIdResolver_exports = {};
__export(entityIdResolver_exports, {
  batchResolveKeywordIds: () => batchResolveKeywordIds,
  batchResolveProductTargetIds: () => batchResolveProductTargetIds,
  clearAllCaches: () => clearAllCaches,
  getCacheStats: () => getCacheStats2,
  initEntityIdResolver: () => initEntityIdResolver,
  resolveAdGroupId: () => resolveAdGroupId,
  resolveAmazonAdGroupId: () => resolveAmazonAdGroupId,
  resolveAmazonCampaignId: () => resolveAmazonCampaignId,
  resolveCampaignId: () => resolveCampaignId,
  resolveKeywordId: () => resolveKeywordId,
  resolveProductTargetId: () => resolveProductTargetId,
  safeResolveAmazonAdGroupId: () => safeResolveAmazonAdGroupId,
  safeResolveAmazonCampaignId: () => safeResolveAmazonCampaignId,
  safeResolveAmazonKeywordId: () => safeResolveAmazonKeywordId,
  validateAmazonId: () => validateAmazonId
});
function initEntityIdResolver(provider) {
  _dbProvider = provider;
  log36.info("EntityIdResolver initialized with database provider");
}
function getDb2() {
  if (!_dbProvider) {
    throw new Error("EntityIdResolver not initialized. Call initEntityIdResolver() first.");
  }
  return _dbProvider;
}
async function resolveCampaignId(internalId) {
  const cached2 = campaignCache.get(internalId);
  if (cached2) return cached2;
  const db = getDb2();
  const campaign = await db.getCampaignByInternalId(internalId);
  if (!campaign) {
    throw new Error(`Campaign not found: internalId=${internalId}`);
  }
  const result = {
    internalId: campaign.id,
    amazonId: campaign.campaignId,
    entityType: "campaign",
    amazonCampaignId: campaign.campaignId
  };
  campaignCache.set(internalId, result);
  reverseCampaignCache.set(campaign.campaignId, campaign.id);
  return result;
}
async function resolveAdGroupId(internalId) {
  const cached2 = adGroupCache.get(internalId);
  if (cached2) return cached2;
  const db = getDb2();
  const adGroup = await db.getAdGroupByInternalId(internalId);
  if (!adGroup) {
    throw new Error(`AdGroup not found: internalId=${internalId}`);
  }
  const result = {
    internalId: adGroup.id,
    amazonId: adGroup.adGroupId,
    entityType: "adGroup",
    amazonAdGroupId: adGroup.adGroupId,
    amazonCampaignId: adGroup.campaignId,
    internalAdGroupId: adGroup.id
  };
  adGroupCache.set(internalId, result);
  reverseAdGroupCache.set(adGroup.adGroupId, adGroup.id);
  return result;
}
async function resolveKeywordId(internalId) {
  const cached2 = keywordCache.get(internalId);
  if (cached2) return cached2;
  const db = getDb2();
  const keyword = await db.getKeywordByInternalId(internalId);
  if (!keyword) {
    throw new Error(`Keyword not found: internalId=${internalId}`);
  }
  if (!keyword.keywordId) {
    throw new Error(`Keyword Amazon ID not available: internalId=${internalId}, keywordId is null`);
  }
  let amazonAdGroupId;
  let amazonCampaignId;
  if (keyword.internalAdGroupId) {
    try {
      const adGroupResolved = await resolveAdGroupId(keyword.internalAdGroupId);
      amazonAdGroupId = adGroupResolved.amazonAdGroupId;
      amazonCampaignId = adGroupResolved.amazonCampaignId;
    } catch (e) {
      log36.warn(`Failed to resolve adGroup for keyword ${internalId}: ${e.message}`);
    }
  }
  const result = {
    internalId: keyword.id,
    amazonId: keyword.keywordId,
    entityType: "keyword",
    amazonAdGroupId,
    amazonCampaignId,
    internalAdGroupId: keyword.internalAdGroupId
  };
  keywordCache.set(internalId, result);
  reverseKeywordCache.set(keyword.keywordId, keyword.id);
  return result;
}
async function resolveProductTargetId(internalId) {
  const cached2 = productTargetCache.get(internalId);
  if (cached2) return cached2;
  const db = getDb2();
  const target = await db.getProductTargetByInternalId(internalId);
  if (!target) {
    throw new Error(`ProductTarget not found: internalId=${internalId}`);
  }
  if (!target.targetId) {
    throw new Error(`ProductTarget Amazon ID not available: internalId=${internalId}, targetId is null`);
  }
  let amazonAdGroupId;
  let amazonCampaignId;
  if (target.internalAdGroupId) {
    try {
      const adGroupResolved = await resolveAdGroupId(target.internalAdGroupId);
      amazonAdGroupId = adGroupResolved.amazonAdGroupId;
      amazonCampaignId = adGroupResolved.amazonCampaignId;
    } catch (e) {
      log36.warn(`Failed to resolve adGroup for productTarget ${internalId}: ${e.message}`);
    }
  }
  const result = {
    internalId: target.id,
    amazonId: target.targetId,
    entityType: "productTarget",
    amazonAdGroupId,
    amazonCampaignId,
    internalAdGroupId: target.internalAdGroupId
  };
  productTargetCache.set(internalId, result);
  reverseTargetCache.set(target.targetId, target.id);
  return result;
}
async function resolveAmazonCampaignId(amazonId) {
  const cached2 = reverseCampaignCache.get(amazonId);
  if (cached2 !== void 0) return cached2;
  const db = getDb2();
  const campaign = await db.getCampaignByAmazonId(amazonId);
  if (!campaign) {
    throw new Error(`Campaign not found: amazonId=${amazonId}`);
  }
  reverseCampaignCache.set(amazonId, campaign.id);
  return campaign.id;
}
async function resolveAmazonAdGroupId(amazonId) {
  const cached2 = reverseAdGroupCache.get(amazonId);
  if (cached2 !== void 0) return cached2;
  const db = getDb2();
  const adGroup = await db.getAdGroupByAmazonId(amazonId);
  if (!adGroup) {
    throw new Error(`AdGroup not found: amazonId=${amazonId}`);
  }
  reverseAdGroupCache.set(amazonId, adGroup.id);
  return adGroup.id;
}
async function batchResolveKeywordIds(internalIds) {
  const result = {
    resolved: /* @__PURE__ */ new Map(),
    failed: [],
    errors: []
  };
  const uncachedIds = [];
  for (const id of internalIds) {
    const cached2 = keywordCache.get(id);
    if (cached2) {
      result.resolved.set(id, cached2);
    } else {
      uncachedIds.push(id);
    }
  }
  if (uncachedIds.length === 0) return result;
  const db = getDb2();
  const keywords10 = await db.getKeywordsByInternalIds(uncachedIds);
  const keywordMap = new Map(keywords10.map((k) => [k.id, k]));
  for (const id of uncachedIds) {
    const keyword = keywordMap.get(id);
    if (!keyword || !keyword.keywordId) {
      result.failed.push(id);
      result.errors.push(`Keyword ${id}: ${!keyword ? "not found" : "Amazon ID is null"}`);
      continue;
    }
    try {
      let amazonAdGroupId;
      let amazonCampaignId;
      if (keyword.internalAdGroupId) {
        try {
          const adGroupResolved = await resolveAdGroupId(keyword.internalAdGroupId);
          amazonAdGroupId = adGroupResolved.amazonAdGroupId;
          amazonCampaignId = adGroupResolved.amazonCampaignId;
        } catch {
        }
      }
      const resolved = {
        internalId: keyword.id,
        amazonId: keyword.keywordId,
        entityType: "keyword",
        amazonAdGroupId,
        amazonCampaignId,
        internalAdGroupId: keyword.internalAdGroupId
      };
      keywordCache.set(id, resolved);
      reverseKeywordCache.set(keyword.keywordId, id);
      result.resolved.set(id, resolved);
    } catch (e) {
      result.failed.push(id);
      result.errors.push(`Keyword ${id}: ${e.message}`);
    }
  }
  return result;
}
async function batchResolveProductTargetIds(internalIds) {
  const result = {
    resolved: /* @__PURE__ */ new Map(),
    failed: [],
    errors: []
  };
  const uncachedIds = [];
  for (const id of internalIds) {
    const cached2 = productTargetCache.get(id);
    if (cached2) {
      result.resolved.set(id, cached2);
    } else {
      uncachedIds.push(id);
    }
  }
  if (uncachedIds.length === 0) return result;
  const db = getDb2();
  const targets = await db.getProductTargetsByInternalIds(uncachedIds);
  const targetMap = new Map(targets.map((t2) => [t2.id, t2]));
  for (const id of uncachedIds) {
    const target = targetMap.get(id);
    if (!target || !target.targetId) {
      result.failed.push(id);
      result.errors.push(`ProductTarget ${id}: ${!target ? "not found" : "Amazon ID is null"}`);
      continue;
    }
    try {
      let amazonAdGroupId;
      let amazonCampaignId;
      if (target.internalAdGroupId) {
        try {
          const adGroupResolved = await resolveAdGroupId(target.internalAdGroupId);
          amazonAdGroupId = adGroupResolved.amazonAdGroupId;
          amazonCampaignId = adGroupResolved.amazonCampaignId;
        } catch {
        }
      }
      const resolved = {
        internalId: target.id,
        amazonId: target.targetId,
        entityType: "productTarget",
        amazonAdGroupId,
        amazonCampaignId,
        internalAdGroupId: target.internalAdGroupId
      };
      productTargetCache.set(id, resolved);
      reverseTargetCache.set(target.targetId, id);
      result.resolved.set(id, resolved);
    } catch (e) {
      result.failed.push(id);
      result.errors.push(`ProductTarget ${id}: ${e.message}`);
    }
  }
  return result;
}
async function safeResolveAmazonCampaignId(internalId, fallbackAdGroupInternalId) {
  if (internalId && internalId > 0) {
    try {
      const resolved = await resolveCampaignId(internalId);
      return resolved.amazonId;
    } catch {
    }
  }
  if (fallbackAdGroupInternalId && fallbackAdGroupInternalId > 0) {
    try {
      const adGroupResolved = await resolveAdGroupId(fallbackAdGroupInternalId);
      if (adGroupResolved.amazonCampaignId) {
        return adGroupResolved.amazonCampaignId;
      }
    } catch {
    }
  }
  log36.warn(`Failed to resolve Amazon Campaign ID: internalId=${internalId}, fallbackAdGroupId=${fallbackAdGroupInternalId}`);
  return "UNRESOLVED";
}
async function safeResolveAmazonAdGroupId(internalAdGroupId) {
  if (!internalAdGroupId || internalAdGroupId <= 0) {
    return "UNRESOLVED";
  }
  try {
    const resolved = await resolveAdGroupId(internalAdGroupId);
    return resolved.amazonId;
  } catch {
    log36.warn(`Failed to resolve Amazon AdGroup ID: internalId=${internalAdGroupId}`);
    return "UNRESOLVED";
  }
}
async function safeResolveAmazonKeywordId(internalKeywordId) {
  if (!internalKeywordId || internalKeywordId <= 0) {
    return "UNRESOLVED";
  }
  try {
    const resolved = await resolveKeywordId(internalKeywordId);
    return resolved.amazonId;
  } catch {
    log36.warn(`Failed to resolve Amazon Keyword ID: internalId=${internalKeywordId}`);
    return "UNRESOLVED";
  }
}
function validateAmazonId(id, entityType) {
  if (id === null || id === void 0) return false;
  const strId = String(id);
  if (!isValidAmazonId(strId)) {
    log36.warn(`Invalid Amazon ${entityType} ID: "${strId}"`);
    return false;
  }
  return true;
}
function clearAllCaches() {
  campaignCache.clear();
  adGroupCache.clear();
  keywordCache.clear();
  productTargetCache.clear();
  reverseCampaignCache.clear();
  reverseAdGroupCache.clear();
  reverseKeywordCache.clear();
  reverseTargetCache.clear();
  log36.info("All EntityIdResolver caches cleared");
}
function getCacheStats2() {
  return {
    campaigns: campaignCache.size,
    adGroups: adGroupCache.size,
    keywords: keywordCache.size,
    productTargets: productTargetCache.size,
    reverseCampaigns: reverseCampaignCache.size,
    reverseAdGroups: reverseAdGroupCache.size,
    reverseKeywords: reverseKeywordCache.size,
    reverseTargets: reverseTargetCache.size
  };
}
var log36, IdCache, campaignCache, adGroupCache, keywordCache, productTargetCache, reverseCampaignCache, reverseAdGroupCache, reverseKeywordCache, reverseTargetCache, _dbProvider;
var init_entityIdResolver = __esm({
  "server/services/entityIdResolver.ts"() {
    "use strict";
    init_logger();
    init_idTypes();
    log36 = createModuleLogger("EntityIdResolver");
    IdCache = class {
      static {
        __name(this, "IdCache");
      }
      cache = /* @__PURE__ */ new Map();
      ttlMs;
      constructor(ttlMs = 10 * 60 * 1e3) {
        this.ttlMs = ttlMs;
      }
      get(key) {
        const strKey = String(key);
        const entry = this.cache.get(strKey);
        if (!entry) return void 0;
        if (Date.now() - entry.timestamp > this.ttlMs) {
          this.cache.delete(strKey);
          return void 0;
        }
        return entry.value;
      }
      set(key, value) {
        this.cache.set(String(key), { value, timestamp: Date.now() });
      }
      invalidate(key) {
        this.cache.delete(String(key));
      }
      clear() {
        this.cache.clear();
      }
      get size() {
        return this.cache.size;
      }
    };
    campaignCache = new IdCache();
    adGroupCache = new IdCache();
    keywordCache = new IdCache();
    productTargetCache = new IdCache();
    reverseCampaignCache = new IdCache();
    reverseAdGroupCache = new IdCache();
    reverseKeywordCache = new IdCache();
    reverseTargetCache = new IdCache();
    _dbProvider = null;
    __name(initEntityIdResolver, "initEntityIdResolver");
    __name(getDb2, "getDb");
    __name(resolveCampaignId, "resolveCampaignId");
    __name(resolveAdGroupId, "resolveAdGroupId");
    __name(resolveKeywordId, "resolveKeywordId");
    __name(resolveProductTargetId, "resolveProductTargetId");
    __name(resolveAmazonCampaignId, "resolveAmazonCampaignId");
    __name(resolveAmazonAdGroupId, "resolveAmazonAdGroupId");
    __name(batchResolveKeywordIds, "batchResolveKeywordIds");
    __name(batchResolveProductTargetIds, "batchResolveProductTargetIds");
    __name(safeResolveAmazonCampaignId, "safeResolveAmazonCampaignId");
    __name(safeResolveAmazonAdGroupId, "safeResolveAmazonAdGroupId");
    __name(safeResolveAmazonKeywordId, "safeResolveAmazonKeywordId");
    __name(validateAmazonId, "validateAmazonId");
    __name(clearAllCaches, "clearAllCaches");
    __name(getCacheStats2, "getCacheStats");
  }
});

