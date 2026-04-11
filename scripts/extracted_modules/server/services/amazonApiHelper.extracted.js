// Extracted from production dist/index.js
// Original module: server/services/amazonApiHelper.ts
// Lines: 1945

var amazonApiHelper_exports = {};
__export(amazonApiHelper_exports, {
  getAmazonSyncService: () => getAmazonSyncService2,
  syncAdGroupStatusToAmazon: () => syncAdGroupStatusToAmazon,
  syncBidAdjustmentsToAmazon: () => syncBidAdjustmentsToAmazon,
  syncBudgetAdjustmentToAmazon: () => syncBudgetAdjustmentToAmazon,
  syncCampaignStatusToAmazon: () => syncCampaignStatusToAmazon,
  syncKeywordStatusToAmazon: () => syncKeywordStatusToAmazon,
  syncNegativeKeywordsToAmazon: () => syncNegativeKeywordsToAmazon,
  syncNegativeProductTargetsToAmazon: () => syncNegativeProductTargetsToAmazon,
  syncNewKeywordsToAmazon: () => syncNewKeywordsToAmazon,
  syncNewProductTargetsToAmazon: () => syncNewProductTargetsToAmazon,
  syncPlacementAdjustmentToAmazon: () => syncPlacementAdjustmentToAmazon
});
async function getAmazonSyncService2(accountId) {
  return getAmazonSyncService(accountId);
}
async function withRetry(fn, options = {}) {
  const { maxRetries = 5, baseDelayMs = 15000, label = "API", accountId = 0 } = options;
  let lastError = null;
  const endpointType = classifyEndpoint(label);
  const adaptiveTimeout = getAdaptiveTimeout();
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      try {
        await acquireApiPermit(accountId, endpointType);
      } catch (_) {
      }
      const callStartTime = Date.now();
      const result = await fn();
      const callDurationMs = Date.now() - callStartTime;
      try {
        adaptiveTimeout.recordLatency(endpointType, callDurationMs);
        getCircuitBreaker().recordSuccess(accountId, endpointType);
      } catch (_) {
      }
      return result;
    } catch (error48) {
      lastError = error48;
      const isThrottle = error48.response?.status === 429 || error48.message?.includes("\u8BF7\u6C42\u8FC7\u4E8E\u9891\u7E41") || error48.message?.includes("Too Many Requests");
      const isServerError = error48.response?.status >= 500;
      const isNetworkError = error48.code === "ECONNRESET" || error48.code === "ETIMEDOUT" || error48.code === "ECONNABORTED" || error48.code === "EPIPE" || error48.message?.includes("socket hang up") || error48.message?.includes("network timeout");
      const isRetryable = isThrottle || isServerError || isNetworkError;
      if (isThrottle) {
        try {
          getApiRateLimitService().recordExternalThrottle(accountId, endpointType);
        } catch (_) {
        }
      }
      if (!isRetryable) {
        try {
          getCircuitBreaker().recordFailure(accountId, endpointType, false);
        } catch (_) {
        }
      } else if (isServerError || isNetworkError) {
        try {
          getCircuitBreaker().recordFailure(accountId, endpointType, true);
        } catch (_) {
        }
      }
      if (!isRetryable || attempt >= maxRetries) {
        throw error48;
      }
      const maxDelay = isThrottle ? 12e4 : 6e4;
      const jitter = Math.random() * 1e3;
      const delay2 = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelay) + jitter;
      log38.warn(`[AmazonApiHelper] ${label} \u7B2C${attempt + 1}/${maxRetries}\u6B21\u91CD\u8BD5(\u6307\u6570\u9000\u907F)\uFF0C\u7B49\u5F85${Math.round(delay2)}ms... (${isThrottle ? "\u9650\u6D41" : isNetworkError ? "\u7F51\u7EDC\u5F02\u5E38" : "\u670D\u52A1\u5668\u9519\u8BEF"}: ${error48.message?.substring(0, 80)})`);
      await new Promise((resolve) => setTimeout(resolve, delay2));
    }
  }
  throw lastError;
}
async function syncBidAdjustmentsToAmazon(accountId, adjustments) {
  const result = { success: 0, failed: 0, errors: [], itemResults: /* @__PURE__ */ new Map() };
  if (adjustments.length === 0) return result;
  log38.info(`[AmazonApiHelper] v359: \u5F00\u59CB\u6279\u91CF\u540C\u6B65\u51FA\u4EF7\u8C03\u6574: accountId=${accountId}, \u603B\u8BA1=${adjustments.length}\u6761`);
  const syncService = await getAmazonSyncService2(accountId);
  if (!syncService) {
    const errorMsg = `\u65E0\u6CD5\u83B7\u53D6\u8D26\u53F7 ${accountId} \u7684API\u670D\u52A1\uFF08\u51ED\u8BC1\u7F3A\u5931\u6216\u65E0\u6548\uFF09`;
    log38.warn(`[AmazonApiHelper] ${errorMsg}`);
    result.errors.push(errorMsg);
    result.failed = adjustments.length;
    for (const adj of adjustments) {
      result.itemResults.set(adj.keywordId, { status: "failed", error: errorMsg });
    }
    return result;
  }
  const deduped = /* @__PURE__ */ new Map();
  for (const adj of adjustments) {
    const dedupKey = adj.isProductTarget ? (adj.productTargetId || adj.targetId || adj.keywordId) : adj.isSdAudience ? (adj.sdTargetId || adj.keywordId) : adj.keywordId; // fix24-P3v2-2: 按实体类型使用正确的去重key
    deduped.set(dedupKey, adj);
  }
  const uniqueAdjustments = Array.from(deduped.values());
  if (uniqueAdjustments.length < adjustments.length) {
    log38.debug(`[AmazonApiHelper] \u5E42\u7B49\u6027\u53BB\u91CD: ${adjustments.length}\u6761 -> ${uniqueAdjustments.length}\u6761`);
  }
  const keywordAdjustments = uniqueAdjustments.filter((a) => !a.isProductTarget && !a.isSdAudience);
  const productTargetAdjustments = uniqueAdjustments.filter((a) => a.isProductTarget && !a.isSdAudience);
  const sdAudienceAdjustments = uniqueAdjustments.filter((a) => a.isSdAudience);
  const dbInstance = await getDb();
  if (!dbInstance) {
    const errorMsg = "\u6570\u636E\u5E93\u8FDE\u63A5\u5931\u8D25";
    result.errors.push(errorMsg);
    result.failed = uniqueAdjustments.length;
    for (const adj of uniqueAdjustments) {
      result.itemResults.set(adj.keywordId, { status: "failed", error: errorMsg });
    }
    return result;
  }
  const { keywords: keywords10, productTargets: productTargets5 } = await Promise.resolve().then(() => (init_schema2(), schema_exports));
  const { eq: eq12 } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
  const resolvedKeywordBids = [];
  if (keywordAdjustments.length > 0) {
    const { inArray: inArray13 } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
    const { campaigns: campaignsSchema, adGroups: adGroupsSchema } = await Promise.resolve().then(() => (init_schema2(), schema_exports));
    const kwLocalIds = keywordAdjustments.map((a) => a.keywordId);
    const kwResults = await dbInstance.select({
      id: keywords10.id,
      keywordId: keywords10.keywordId,
      keywordStatus: keywords10.keywordStatus,
      campaignId: keywords10.campaignId,
      // Amazon campaign ID (varchar)
      adGroupId: adGroupsSchema.adGroupId
      // v506: 从ad_groups表获取Amazon adGroup ID
    }).from(keywords10).leftJoin(adGroupsSchema, eq12(keywords10.internalAdGroupId, adGroupsSchema.id)).where(inArray13(keywords10.id, kwLocalIds));
    const uniqueCampaignIds = [...new Set(kwResults.map((kw) => kw.campaignId).filter(Boolean))];
    const campaignTypeMap = /* @__PURE__ */ new Map();
    if (uniqueCampaignIds.length > 0) {
      try {
        const campResults = await dbInstance.select({ campaignId: campaignsSchema.campaignId, campaignType: campaignsSchema.campaignType }).from(campaignsSchema).where(inArray13(campaignsSchema.campaignId, uniqueCampaignIds));
        for (const camp of campResults) {
          if (camp.campaignId && camp.campaignType) {
            campaignTypeMap.set(camp.campaignId, camp.campaignType);
          }
        }
        log38.info(`[v502] \u6279\u91CF\u67E5\u8BE2campaign\u7C7B\u578B: ${uniqueCampaignIds.length}\u4E2Acampaign, ${campaignTypeMap.size}\u4E2A\u5DF2\u89E3\u6790`);
      } catch (campErr) {
        log38.warn(`[v502] \u6279\u91CF\u67E5\u8BE2campaign\u7C7B\u578B\u5931\u8D25: ${campErr.message}\uFF0C\u5C06\u9ED8\u8BA4\u4F7F\u7528SP API`);
      }
    }
    const adGroupStatusMap = /* @__PURE__ */ new Map();
    try {
      const uniqueAdGroupIds = [...new Set(kwResults.map((kw) => kw.adGroupId).filter(Boolean))];
      if (uniqueAdGroupIds.length > 0) {
        const agResults = await dbInstance.select({ adGroupId: adGroupsSchema.adGroupId, adGroupStatus: adGroupsSchema.adGroupStatus }).from(adGroupsSchema).where(inArray13(adGroupsSchema.adGroupId, uniqueAdGroupIds));
        for (const ag of agResults) {
          if (ag.adGroupId) adGroupStatusMap.set(ag.adGroupId, ag.adGroupStatus || "enabled");
        }
      }
    } catch (_) {
    }
    const kwIdMap = /* @__PURE__ */ new Map();
    const amazonDeletedKwIds = /* @__PURE__ */ new Set();
    for (const kw of kwResults) {
      const kwStatus = String(kw.keywordStatus || "");
      if (kwStatus === "amazon_deleted" || kwStatus === "archived" || kwStatus === "amazon_archived") {
        amazonDeletedKwIds.add(kw.id);
        continue;
      }
      const agStatus = adGroupStatusMap.get(kw.adGroupId || "");
      if (agStatus === "archived") {
        amazonDeletedKwIds.add(kw.id);
        continue;
      }
      if (kw.keywordId && kw.keywordId !== "0" && kw.keywordId !== "") {
        const campType = campaignTypeMap.get(kw.campaignId) || "sp_manual";
        kwIdMap.set(kw.id, {
          amazonId: kw.keywordId,
          campaignId: kw.campaignId || "",
          adGroupId: kw.adGroupId || "",
          campaignType: campType
        });
      }
    }
    if (amazonDeletedKwIds.size > 0) {
      log38.warn(`[AmazonApiHelper] v477: \u9884\u8FC7\u6EE4${amazonDeletedKwIds.size}\u4E2Aamazon_deleted/archived\u5173\u952E\u8BCD\uFF0C\u8DF3\u8FC7API\u540C\u6B65`);
      for (const deletedId of amazonDeletedKwIds) {
        result.failed++;
        result.errors.push(`keyword ${deletedId}: amazon_deleted/archived\uFF0C\u8DF3\u8FC7\u540C\u6B65`);
        result.itemResults.set(deletedId, { status: "failed", error: "amazon_deleted/archived\uFF0C\u8DF3\u8FC7\u540C\u6B65" });
      }
    }
    log38.info(`[v502] \u6279\u91CF\u89E3\u6790\u5173\u952E\u8BCD: ${kwLocalIds.length}\u4E2A\u8BF7\u6C42, ${kwIdMap.size}\u4E2A\u5DF2\u89E3\u6790, ${amazonDeletedKwIds.size}\u4E2A\u5DF2\u8FC7\u6EE4`);
    for (const adj of keywordAdjustments) {
      if (amazonDeletedKwIds.has(adj.keywordId)) continue;
        if (!adj.keywordId || adj.keywordId === "0" || adj.keywordId === "") { result.failed++; result.errors.push(`keyword ${adj.keywordId}: 无效的本地ID，跳过`); continue; }
        if (!adj.keywordId || adj.keywordId === "0" || adj.keywordId === "") { result.failed++; result.errors.push(`keyword ${adj.keywordId}: 无效的本地ID，跳过`); continue; }
      const kwInfo = kwIdMap.get(adj.keywordId);
      let amazonKeywordId = kwInfo?.amazonId;
      if (!amazonKeywordId) {
        try {
          const { resolveKeywordId: resolveKeywordId2 } = await Promise.resolve().then(() => (init_entityIdResolver(), entityIdResolver_exports));
          const resolved = await resolveKeywordId2(adj.keywordId);
          if (resolved && resolved.amazonId) {
            amazonKeywordId = resolved.amazonId;
          }
        } catch (_) {
        }
      }
      if (!amazonKeywordId) {
        try {
          const { resolveKeywordIdOnDemand: resolveKeywordIdOnDemand2 } = await Promise.resolve().then(() => (init_amazonIdResolver(), amazonIdResolver_exports));
          amazonKeywordId = await resolveKeywordIdOnDemand2(accountId, adj.keywordId) || void 0;
        } catch (resolveErr) {
          log38.warn(`[AmazonApiHelper] v429: \u5373\u65F6\u56DE\u586B\u5F02\u5E38: ${resolveErr.message}`);
        }
      }
      if (amazonKeywordId && amazonKeywordId !== "0" && amazonKeywordId !== "" && !amazonKeywordId.startsWith("SKIP_")) {
        resolvedKeywordBids.push({
          keywordId: String(amazonKeywordId),
          bid: Number(adj.newBid.toFixed(2)),
          localId: adj.keywordId,
          campaignType: kwInfo?.campaignType || "sp_manual",
          adGroupId: kwInfo?.adGroupId || "",
          campaignId: kwInfo?.campaignId || ""
        });
      } else {
        result.failed++;
        const errMsg = `keyword ${adj.keywordId}: \u7F3A\u5C11Amazon ID\uFF08\u53EF\u91CD\u8BD5\uFF09`;
        result.errors.push(errMsg);
        result.itemResults.set(adj.keywordId, { status: "failed", error: "\u7F3A\u5C11Amazon ID\uFF08\u53EF\u91CD\u8BD5\uFF09" });
      }
    }
  }
  const resolvedTargetBids = [];
  if (productTargetAdjustments.length > 0) {
    const { inArray: inArray13 } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
    const { campaigns: campaignsSchema } = await Promise.resolve().then(() => (init_schema2(), schema_exports));
    const ptLocalIds = productTargetAdjustments.map((a) => a.productTargetId || a.keywordId);
    const ptResults = await dbInstance.select({ id: productTargets5.id, targetId: productTargets5.targetId, targetStatus: productTargets5.targetStatus, campaignId: productTargets5.campaignId }).from(productTargets5).where(inArray13(productTargets5.id, ptLocalIds));
    const ptUniqueCampaignIds = [...new Set(ptResults.map((pt) => pt.campaignId).filter(Boolean))];
    const ptCampaignTypeMap = /* @__PURE__ */ new Map();
    if (ptUniqueCampaignIds.length > 0) {
      try {
        const campResults = await dbInstance.select({ campaignId: campaignsSchema.campaignId, campaignType: campaignsSchema.campaignType }).from(campaignsSchema).where(inArray13(campaignsSchema.campaignId, ptUniqueCampaignIds));
        for (const camp of campResults) {
          if (camp.campaignId && camp.campaignType) {
            ptCampaignTypeMap.set(camp.campaignId, camp.campaignType);
          }
        }
        log38.info(`[v502] \u5546\u54C1\u5B9A\u5411campaign\u7C7B\u578B\u67E5\u8BE2: ${ptUniqueCampaignIds.length}\u4E2Acampaign, ${ptCampaignTypeMap.size}\u4E2A\u5DF2\u89E3\u6790`);
      } catch (campErr) {
        log38.warn(`[v502] \u5546\u54C1\u5B9A\u5411campaign\u7C7B\u578B\u67E5\u8BE2\u5931\u8D25: ${campErr.message}\uFF0C\u5C06\u9ED8\u8BA4\u4F7F\u7528SP API`);
      }
    }
    const ptIdMap = /* @__PURE__ */ new Map();
    const amazonDeletedPtIds = /* @__PURE__ */ new Set();
    for (const pt of ptResults) {
      const ptStatus = String(pt.targetStatus || "");
      if (ptStatus === "amazon_deleted" || ptStatus === "archived" || ptStatus === "amazon_archived") {
        amazonDeletedPtIds.add(pt.id);
        continue;
      }
      if (pt.targetId && pt.targetId !== "0" && pt.targetId !== "") {
        const campType = pt.campaignId ? ptCampaignTypeMap.get(pt.campaignId) || "sp_manual" : "sp_manual";
        ptIdMap.set(pt.id, { amazonId: pt.targetId, campaignType: campType });
      }
    }
    if (amazonDeletedPtIds.size > 0) {
      log38.warn(`[AmazonApiHelper] v477: \u9884\u8FC7\u6EE4${amazonDeletedPtIds.size}\u4E2Aamazon_deleted/archived\u5546\u54C1\u5B9A\u5411\uFF0C\u8DF3\u8FC7API\u540C\u6B65`);
      for (const deletedId of amazonDeletedPtIds) {
        result.failed++;
        result.errors.push(`product_target ${deletedId}: amazon_deleted/archived\uFF0C\u8DF3\u8FC7\u540C\u6B65`);
        result.itemResults.set(deletedId, { status: "failed", error: "amazon_deleted/archived\uFF0C\u8DF3\u8FC7\u540C\u6B65" });
      }
    }
    log38.info(`[v502] \u6279\u91CF\u89E3\u6790\u5546\u54C1\u5B9A\u5411: ${ptLocalIds.length}\u4E2A\u8BF7\u6C42, ${ptIdMap.size}\u4E2A\u5DF2\u89E3\u6790, ${amazonDeletedPtIds.size}\u4E2A\u5DF2\u8FC7\u6EE4`);
    for (const adj of productTargetAdjustments) {
      const actualId = adj.productTargetId || adj.keywordId;
      if (amazonDeletedPtIds.has(actualId)) continue;
      const ptInfo = ptIdMap.get(actualId);
      let amazonTargetId = ptInfo?.amazonId;
      if (!amazonTargetId) {
        try {
          const { resolveProductTargetId: resolveProductTargetId2 } = await Promise.resolve().then(() => (init_entityIdResolver(), entityIdResolver_exports));
          const resolved = await resolveProductTargetId2(actualId);
          if (resolved && resolved.amazonId) {
            amazonTargetId = resolved.amazonId;
          }
        } catch (_) {
        }
      }
      if (!amazonTargetId) {
        try {
          const { resolveProductTargetIdOnDemand: resolveProductTargetIdOnDemand2 } = await Promise.resolve().then(() => (init_amazonIdResolver(), amazonIdResolver_exports));
          amazonTargetId = await resolveProductTargetIdOnDemand2(accountId, actualId) || void 0;
        } catch (resolveErr) {
          log38.warn(`[AmazonApiHelper] v429: \u5546\u54C1\u5B9A\u5411\u5373\u65F6\u56DE\u586B\u5F02\u5E38: ${resolveErr.message}`);
        }
      }
      if (amazonTargetId && amazonTargetId !== "0" && amazonTargetId !== "") {
        resolvedTargetBids.push({
          targetId: String(amazonTargetId),
          bid: Number(adj.newBid.toFixed(2)),
          localId: adj.keywordId,
          campaignType: ptInfo?.campaignType || "sp_manual"
        });
      } else {
        result.failed++;
        const errMsg = `product_target ${actualId}: \u7F3A\u5C11Amazon ID\uFF08\u53EF\u91CD\u8BD5\uFF09`;
        result.errors.push(errMsg);
        result.itemResults.set(adj.keywordId, { status: "failed", error: "\u7F3A\u5C11Amazon ID\uFF08\u53EF\u91CD\u8BD5\uFF09" });
      }
    }
  }
  const deduplicatedKeywordBids = Array.from(
    resolvedKeywordBids.reduce(
      (map2, item) => {
        map2.set(item.keywordId, item);
        return map2;
      },
      /* @__PURE__ */ new Map()
    ).values()
  );
  if (deduplicatedKeywordBids.length < resolvedKeywordBids.length) {
    log38.warn(`[AmazonApiHelper] v474: \u5173\u952E\u8BCD\u51FA\u4EF7\u53BB\u91CD: ${resolvedKeywordBids.length} -> ${deduplicatedKeywordBids.length}`);
  }
  const spKeywordBids = deduplicatedKeywordBids.filter((r) => {
    const ct = (r.campaignType || "").toLowerCase();
    return ct.includes("sp") || ct === "" || !ct.includes("sb") && !ct.includes("sd");
  });
  const sbKeywordBids = deduplicatedKeywordBids.filter((r) => (r.campaignType || "").toLowerCase().includes("sb"));
  const sdKeywordBids = deduplicatedKeywordBids.filter((r) => (r.campaignType || "").toLowerCase().includes("sd"));
  log38.info(`[v502] \u5173\u952E\u8BCD\u51FA\u4EF7\u6309\u7C7B\u578B\u5206\u7EC4: SP=${spKeywordBids.length}, SB=${sbKeywordBids.length}, SD=${sdKeywordBids.length}`);
  const SP_MIN_BID = 0.02;
  const SB_MIN_BID = 0.25;
  const SD_MIN_BID = 0.02;
  for (const item of spKeywordBids) {
    if (item.bid < SP_MIN_BID) {
      log38.warn(`[v580] SP\u5173\u952E\u8BCD ${item.keywordId} \u51FA\u4EF7 $${item.bid} \u4F4E\u4E8E\u6700\u4F4E\u9650\u5236 $${SP_MIN_BID}\uFF0C\u81EA\u52A8\u8C03\u6574`);
      item.bid = SP_MIN_BID;
    }
  }
  async function batchUpdateWithBisectRetry(items, apiFn, parseResult, label, minBatchSize = 1) {
    const allSucceeded = [];
    const allFailed = [];
    async function processBatch(batch, depth) {
      if (batch.length === 0) return;
      try {
        const apiResult = await apiFn(batch);
        const { succeeded, failed } = parseResult(apiResult, batch);
        allSucceeded.push(...succeeded);
        if (failed.length > 0 && batch.length > minBatchSize && depth < 5) {
          const failedItems = failed.map((f) => f.item);
          const mid = Math.ceil(failedItems.length / 2);
          log38.info(`[v580] ${label}: \u6279\u6B21\u90E8\u5206\u5931\u8D25(${failed.length}/${batch.length})\uFF0C\u4E8C\u5206\u91CD\u8BD5 depth=${depth + 1}`);
          await new Promise((resolve) => setTimeout(resolve, 2e3 * (depth + 1)));
          await processBatch(failedItems.slice(0, mid), depth + 1);
          await processBatch(failedItems.slice(mid), depth + 1);
        } else {
          allFailed.push(...failed);
        }
      } catch (batchErr) {
        const errMsg = batchErr.message || "unknown";
        if (batch.length > minBatchSize && depth < 5) {
          const mid = Math.ceil(batch.length / 2);
          log38.warn(`[v580] ${label}: \u6574\u6279\u5F02\u5E38(${batch.length}\u9879)\uFF0C\u4E8C\u5206\u62C6\u5206\u91CD\u8BD5 depth=${depth + 1}: ${errMsg.substring(0, 100)}`);
          await new Promise((resolve) => setTimeout(resolve, 3e3 * (depth + 1)));
          await processBatch(batch.slice(0, mid), depth + 1);
          await processBatch(batch.slice(mid), depth + 1);
        } else {
          for (const item of batch) {
            allFailed.push({ item, error: errMsg });
          }
        }
      }
    }
    __name(processBatch, "processBatch");
    await processBatch(items, 0);
    return { succeeded: allSucceeded, permanentlyFailed: allFailed };
  }
  __name(batchUpdateWithBisectRetry, "batchUpdateWithBisectRetry");
  if (spKeywordBids.length > 0) {
    log38.info(`[v580] \u6279\u91CF\u53D1\u9001 ${spKeywordBids.length} \u4E2ASP\u5173\u952E\u8BCD\u51FA\u4EF7\u66F4\u65B0\u5230Amazon (\u542B\u4E8C\u5206\u6CD5\u5BB9\u9519)`);
    try {
      const apiResult = await withRetry(
        // @ts-ignore
        () => syncService.client.updateKeywordBids(
          // @ts-ignore
          spKeywordBids.map((r) => ({ keywordId: r.keywordId, bid: r.bid }))
        ),
        // @ts-ignore
        { maxRetries: 5, baseDelayMs: 5e3, label: `batchUpdateSpKeywordBids-${spKeywordBids.length}`, accountId }
        // @ts-ignore
      );
      const successCount = spKeywordBids.length - (apiResult.errors?.length || 0);
      result.success += successCount;
      const requestId = apiResult.requestIds?.[0] || "";
      const failedKeywordIds = new Set((apiResult.errors || []).map((e) => String(e.keywordId)));
      for (const item of spKeywordBids) {
        if (!failedKeywordIds.has(item.keywordId)) {
          result.itemResults.set(item.localId, { status: "synced", apiResponseId: requestId });
        }
      }
      const entityNotFoundKeywordIds = [];
      if (apiResult.errors && apiResult.errors.length > 0) {
        result.failed += apiResult.errors.length;
        for (const err of apiResult.errors) {
          const localItem = spKeywordBids.find((r) => r.keywordId === String(err.keywordId));
          const errMsg = `SP keyword ${err.keywordId}: ${err.details || err.code || "unknown"}`;
          result.errors.push(errMsg);
          if (localItem) {
            result.itemResults.set(localItem.localId, { status: "failed", error: String(err.details || err.code) });
          }
          const errStr = JSON.stringify(err).toLowerCase();
          if (errStr.includes("entitynotfounderror") || errStr.includes("entity_not_found") || errStr.includes("could not find") || errStr.includes("entitystateerror") || errStr.includes("archived entity")) {
            if (err.keywordId) entityNotFoundKeywordIds.push(String(err.keywordId));
          }
        }
      }
      if (entityNotFoundKeywordIds.length > 0) {
        try {
          const idList = entityNotFoundKeywordIds.map((id) => `'${String(id).replace(/'/g, "''")}'`).join(",");
          await dbInstance.execute(
            sql.raw(`UPDATE keywords SET keywordStatus = 'amazon_deleted' WHERE keywordId IN (${idList})`)
          );
          log38.warn(`[v502] \u5DF2\u6807\u8BB0${entityNotFoundKeywordIds.length}\u4E2ASP\u5173\u952E\u8BCD\u4E3Aamazon_deleted`);
        } catch (markErr) {
          log38.warn(`[v502] \u6807\u8BB0\u8FC7\u671FSP\u5173\u952E\u8BCD\u5931\u8D25: ${markErr.message}`);
        }
      }
      log38.info(`[v502] SP\u5173\u952E\u8BCD\u51FA\u4EF7\u66F4\u65B0\u5B8C\u6210: \u6210\u529F=${successCount}, \u5931\u8D25=${apiResult.errors?.length || 0}`);
    } catch (batchErr) {
      const batchErrMsg = batchErr.message || "";
      log38.warn(`[v580] SP\u5173\u952E\u8BCD\u51FA\u4EF7\u6279\u91CF\u66F4\u65B0\u5F02\u5E38\uFF0C\u542F\u52A8\u4E8C\u5206\u6CD5\u91CD\u8BD5: ${batchErrMsg.substring(0, 100)}`);
      const bisectResult = await batchUpdateWithBisectRetry(
        spKeywordBids,
        async (batch) => {
          await acquireApiPermit(accountId, classifyEndpoint("batchUpdateSpKeywordBids"));
          return syncService.client["updateKeywordBids"](
            batch.map((r) => ({ keywordId: r.keywordId, bid: r.bid }))
          );
        },
        (apiResult, batch) => {
          const res = apiResult;
          const errors = res.errors || [];
          const failedIds = new Set(errors.map((e) => String(e.keywordId)));
          const succeeded = batch.filter((item) => !failedIds.has(item.keywordId));
          const failed = batch.filter((item) => failedIds.has(item.keywordId)).map((item) => {
            const err = errors.find((e) => String(e.keywordId) === item.keywordId);
            return { item, error: String(err?.details || err?.code || "SP_API_ERROR") };
          });
          return { succeeded, failed };
        },
        "SP\u5173\u952E\u8BCD\u51FA\u4EF7"
      );
      result.success += bisectResult.succeeded.length;
      for (const item of bisectResult.succeeded) {
        result.itemResults.set(item.localId, { status: "synced" });
      }
      result.failed += bisectResult.permanentlyFailed.length;
      for (const { item, error: error48 } of bisectResult.permanentlyFailed) {
        result.errors.push(`SP keyword ${item.keywordId}: ${error48}`);
        result.itemResults.set(item.localId, { status: "failed", error: error48 });
      }
      log38.info(`[v580] SP\u5173\u952E\u8BCD\u4E8C\u5206\u6CD5\u91CD\u8BD5\u5B8C\u6210: \u6210\u529F=${bisectResult.succeeded.length}, \u5931\u8D25=${bisectResult.permanentlyFailed.length}`);
    }
  }
  for (const item of sbKeywordBids) {
    if (item.bid < SB_MIN_BID) {
      log38.warn(`[v580] SB\u5173\u952E\u8BCD ${item.keywordId} \u51FA\u4EF7 $${item.bid} \u4F4E\u4E8ESB\u6700\u4F4E\u9650\u5236 $${SB_MIN_BID}\uFF0C\u81EA\u52A8\u8C03\u6574\u4E3A $${SB_MIN_BID}`);
      item.bid = SB_MIN_BID;
    }
  }
  if (sbKeywordBids.length > 0) {
    log38.info(`[v580] \u6279\u91CF\u53D1\u9001 ${sbKeywordBids.length} \u4E2ASB\u5173\u952E\u8BCD\u51FA\u4EF7\u66F4\u65B0\u5230Amazon (\u5DF2\u9884\u6821\u9A8C\u6700\u4F4E\u51FA\u4EF7$${SB_MIN_BID})`);
    const sbUpdatesRaw = sbKeywordBids.filter((r) => r.adGroupId && r.campaignId).map((r) => ({
      keywordId: r.keywordId,
      bid: r.bid,
      adGroupId: r.adGroupId,
      campaignId: r.campaignId
    }));
    const sbUpdatesMap = /* @__PURE__ */ new Map();
    for (const item of sbUpdatesRaw) {
      sbUpdatesMap.set(item.keywordId, item);
    }
    const sbUpdates = Array.from(sbUpdatesMap.values());
    if (sbUpdates.length < sbUpdatesRaw.length) {
      log38.warn(`[v579] SB\u5173\u952E\u8BCD\u51FA\u4EF7\u6309Amazon keywordId\u53BB\u91CD: ${sbUpdatesRaw.length} -> ${sbUpdates.length} (\u79FB\u9664${sbUpdatesRaw.length - sbUpdates.length}\u4E2A\u91CD\u590D)`);
    }
    const sbSkipped = sbKeywordBids.filter((r) => !r.adGroupId || !r.campaignId);
    if (sbSkipped.length > 0) {
      log38.warn(`[v502] ${sbSkipped.length}\u4E2ASB\u5173\u952E\u8BCD\u7F3A\u5C11adGroupId/campaignId\uFF0C\u8DF3\u8FC7`);
      for (const item of sbSkipped) {
        result.failed++;
        result.errors.push(`SB keyword ${item.keywordId}: \u7F3A\u5C11adGroupId\u6216campaignId`);
        result.itemResults.set(item.localId, { status: "failed", error: "\u7F3A\u5C11adGroupId\u6216campaignId" });
      }
    }
    if (sbUpdates.length > 0) {
      try {
        // v587: SB关键词去重 - 按keywordId去重，保留最后一个（最新的出价）
        const sbDeduped = [];
        const sbSeenIds = new Set();
        for (let di = sbUpdates.length - 1; di >= 0; di--) {
          const kid = String(sbUpdates[di].keywordId);
          if (!sbSeenIds.has(kid)) {
            sbSeenIds.add(kid);
            sbDeduped.unshift(sbUpdates[di]);
          }
        }
        if (sbDeduped.length < sbUpdates.length) {
          log38.info(`[v587] SB关键词去重: 原始${sbUpdates.length}个 -> 去重后${sbDeduped.length}个 (移除${sbUpdates.length - sbDeduped.length}个重复)`);
          sbUpdates = sbDeduped;
        }
        if (spKeywordBids.length > 0) {
          await new Promise((resolve) => setTimeout(resolve, 5e3));
        }
        const apiResult = await withRetry(
          // @ts-ignore
          () => syncService.client.updateSbKeywordBids(sbUpdates),
          { maxRetries: 5, baseDelayMs: 5e3, label: `batchUpdateSbKeywordBids-${sbUpdates.length}`, accountId }
        );
        const sbFailedIds = /* @__PURE__ */ new Map();
        if (apiResult.errors && apiResult.errors.length > 0) {
          for (const err of apiResult.errors) {
            sbFailedIds.set(String(err.keywordId), String(err.details || err.code || "SB_API_ERROR"));
          }
        }
        for (const item of sbKeywordBids.filter((r) => r.adGroupId && r.campaignId)) {
          const failReason = sbFailedIds.get(item.keywordId);
          if (failReason) {
            if (failReason.includes("DUPLICATE")) {
              result.success++;
              result.itemResults.set(item.localId, { status: "synced" });
            } else {
              result.failed++;
              result.errors.push(`SB keyword ${item.keywordId}: ${failReason}`);
              result.itemResults.set(item.localId, { status: "failed", error: failReason });
              const failLower = failReason.toLowerCase();
              if (failLower.includes("entitynotfounderror") || failLower.includes("entity_not_found") || failLower.includes("keyword_cannot_find_ad_group") || failLower.includes("invalid_argument") || failLower.includes("cannot find the adgroup")) {
                try {
                  await dbInstance.execute(sql.raw(`UPDATE keywords SET keywordStatus = 'amazon_archived' WHERE keywordId = '${String(item.keywordId).replace(/'/g, "''")}' LIMIT 1`));
                  log38.info(`[v522] SB\u5173\u952E\u8BCD ${item.keywordId} \u6807\u8BB0\u4E3Aamazon_archived (\u539F\u56E0: ${failReason.substring(0, 50)})`);
                } catch (_) {
                }
                if (failLower.includes("cannot find the adgroup") && item.adGroupId) {
                  try {
                    await dbInstance.execute(sql.raw(`UPDATE ad_groups SET adGroupStatus = 'archived' WHERE adGroupId = '${String(item.adGroupId).replace(/'/g, "''")}' LIMIT 1`));
                    log38.warn(`[v522] SB adGroup ${item.adGroupId} \u6807\u8BB0\u4E3Aarchived (Amazon\u7AEF\u5DF2\u4E0D\u5B58\u5728)`);
                  } catch (_) {
                  }
                }
              }
            }
          } else {
            result.success++;
            result.itemResults.set(item.localId, { status: "synced" });
          }
        }
        log38.info(`[v502] SB\u5173\u952E\u8BCD\u51FA\u4EF7\u66F4\u65B0\u5B8C\u6210: \u53D1\u9001=${sbUpdates.length}, \u6210\u529F=${sbUpdates.length - sbFailedIds.size}, \u5931\u8D25=${sbFailedIds.size}`);
      } catch (batchErr) {
        const batchErrMsg = batchErr.message || "";
        log38.warn(`[v580] SB\u5173\u952E\u8BCD\u51FA\u4EF7\u6279\u91CF\u66F4\u65B0\u5F02\u5E38\uFF0C\u542F\u52A8\u4E8C\u5206\u6CD5\u91CD\u8BD5: ${batchErrMsg.substring(0, 100)}`);
        const sbItemsWithIds = sbKeywordBids.filter((r) => r.adGroupId && r.campaignId);
        const bisectResult = await batchUpdateWithBisectRetry(
          sbItemsWithIds,
          async (batch) => {
            await acquireApiPermit(accountId, classifyEndpoint("batchUpdateSbKeywordBids"));
            const batchUpdates = batch.map((r) => ({
              keywordId: r.keywordId,
              bid: r.bid,
              adGroupId: r.adGroupId,
              campaignId: r.campaignId
            }));
            return syncService.client["updateSbKeywordBids"](batchUpdates);
          },
          (apiResult, batch) => {
            const res = apiResult;
            const errors = res.errors || [];
            const failedIds = /* @__PURE__ */ new Map();
            for (const err of errors) {
              failedIds.set(String(err.keywordId), String(err.details || err.code || "SB_API_ERROR"));
            }
            const succeeded = batch.filter((item) => !failedIds.has(item.keywordId));
            const failed = batch.filter((item) => failedIds.has(item.keywordId)).map((item) => ({
              item,
              error: failedIds.get(item.keywordId) || "SB_API_ERROR"
            }));
            return { succeeded, failed };
          },
          "SB\u5173\u952E\u8BCD\u51FA\u4EF7"
        );
        result.success += bisectResult.succeeded.length;
        for (const item of bisectResult.succeeded) {
          result.itemResults.set(item.localId, { status: "synced" });
        }
        result.failed += bisectResult.permanentlyFailed.length;
        for (const { item, error: error48 } of bisectResult.permanentlyFailed) {
          result.errors.push(`SB keyword ${item.keywordId}: ${error48}`);
          result.itemResults.set(item.localId, { status: "failed", error: error48 });
        }
        log38.info(`[v580] SB\u5173\u952E\u8BCD\u4E8C\u5206\u6CD5\u91CD\u8BD5\u5B8C\u6210: \u6210\u529F=${bisectResult.succeeded.length}, \u5931\u8D25=${bisectResult.permanentlyFailed.length}`);
        if (batchErrMsg.toLowerCase().includes("cannot find the adgroup")) {
          try {
            const adGroupIdMatch = batchErrMsg.match(/(\d{10,})\s*$/);
            if (adGroupIdMatch) {
              await dbInstance.execute(sql.raw(`UPDATE ad_groups SET adGroupStatus = 'archived' WHERE adGroupId = '${adGroupIdMatch[1]}' LIMIT 1`));
              await dbInstance.execute(sql.raw(`UPDATE keywords SET keywordStatus = 'amazon_archived' WHERE internal_ad_group_id IN (SELECT id FROM ad_groups WHERE adGroupId = '${adGroupIdMatch[1]}') AND keywordStatus = 'enabled'`));
              log38.warn(`[v522] \u6279\u91CF\u5F02\u5E38: adGroup ${adGroupIdMatch[1]} \u53CA\u5176\u5173\u952E\u8BCD\u5DF2\u6807\u8BB0\u4E3Aarchived/amazon_archived`);
            }
          } catch (_) {
          }
        }
      }
    }
  }
  for (const item of sdKeywordBids) {
    if (item.bid < SD_MIN_BID) {
      log38.warn(`[v580] SD\u5173\u952E\u8BCD ${item.keywordId} \u51FA\u4EF7 $${item.bid} \u4F4E\u4E8E\u6700\u4F4E\u9650\u5236 $${SD_MIN_BID}\uFF0C\u81EA\u52A8\u8C03\u6574`);
      item.bid = SD_MIN_BID;
    }
  }
  for (const item of resolvedTargetBids) {
    const ct = (item.campaignType || "").toLowerCase();
    const minBid = ct.includes("sb") ? SB_MIN_BID : SP_MIN_BID;
    if (item.bid < minBid) {
      log38.warn(`[v580] \u5546\u54C1\u5B9A\u5411 ${item.targetId} \u51FA\u4EF7 $${item.bid} \u4F4E\u4E8E\u6700\u4F4E\u9650\u5236 $${minBid}\uFF0C\u81EA\u52A8\u8C03\u6574`);
      item.bid = minBid;
    }
  }
  if (sdKeywordBids.length > 0) {
    log38.info(`[v502] \u6279\u91CF\u53D1\u9001 ${sdKeywordBids.length} \u4E2ASD\u5173\u952E\u8BCD\u51FA\u4EF7\u66F4\u65B0\u5230Amazon`);
    try {
      if (sdKeywordBids.length > 0 && (spKeywordBids.length > 0 || sbKeywordBids.length > 0)) {
        await new Promise((resolve) => setTimeout(resolve, 5e3));
      }
      const sdApiMethod = syncService.client.updateSdKeywordBids || syncService.client.updateKeywordBids;
      const apiResult = await withRetry(
        () => sdApiMethod.call(
          syncService.client,
          // @ts-ignore
          sdKeywordBids.map((r) => ({ keywordId: r.keywordId, bid: r.bid }))
        ),
        { maxRetries: 5, baseDelayMs: 5e3, label: `batchUpdateSdKeywordBids-${sdKeywordBids.length}`, accountId }
      );
      const successCount = sdKeywordBids.length - (apiResult.errors?.length || 0);
      result.success += successCount;
      const failedIds = new Set((apiResult.errors || []).map((e) => String(e.keywordId)));
      for (const item of sdKeywordBids) {
        if (!failedIds.has(item.keywordId)) {
          result.itemResults.set(item.localId, { status: "synced" });
        } else {
          result.failed++;
          result.itemResults.set(item.localId, { status: "failed", error: "SD API error" });
        }
      }
      log38.info(`[v502] SD\u5173\u952E\u8BCD\u51FA\u4EF7\u66F4\u65B0\u5B8C\u6210: \u6210\u529F=${successCount}, \u5931\u8D25=${apiResult.errors?.length || 0}`);
    } catch (batchErr) {
      log38.warn(`[v502] SD\u5173\u952E\u8BCD\u51FA\u4EF7\u6279\u91CF\u66F4\u65B0\u5F02\u5E38: ${batchErr.message}`);
      result.failed += sdKeywordBids.length;
      for (const item of sdKeywordBids) {
        result.itemResults.set(item.localId, { status: "failed", error: batchErr.message });
      }
    }
  }
  if (deduplicatedKeywordBids.length > 0 && resolvedTargetBids.length > 0) {
    log38.info(`[AmazonApiHelper] v476: API\u6279\u6B21\u95F4\u8282\u6D41 - \u7B49\u5F8510\u79D2\u540E\u53D1\u9001\u5546\u54C1\u5B9A\u5411\u51FA\u4EF7\u66F4\u65B0...`);
    await new Promise((resolve) => setTimeout(resolve, 1e4));
  }
  const spTargetBids = resolvedTargetBids.filter((r) => {
    const ct = (r.campaignType || "").toLowerCase();
    return ct.includes("sp") || ct === "" || !ct.includes("sb") && !ct.includes("sd");
  });
  const sbTargetBids = resolvedTargetBids.filter((r) => (r.campaignType || "").toLowerCase().includes("sb"));
  const sdTargetBids = resolvedTargetBids.filter((r) => (r.campaignType || "").toLowerCase().includes("sd"));
  if (resolvedTargetBids.length > 0) {
    log38.info(`[v502] \u5546\u54C1\u5B9A\u5411\u51FA\u4EF7\u6309\u7C7B\u578B\u5206\u7EC4: SP=${spTargetBids.length}, SB=${sbTargetBids.length}, SD=${sdTargetBids.length}`);
  }
  if (spTargetBids.length > 0) {
    log38.info(`[v502] \u6279\u91CF\u53D1\u9001 ${spTargetBids.length} \u4E2ASP\u5546\u54C1\u5B9A\u5411\u51FA\u4EF7\u66F4\u65B0\u5230Amazon`);
    try {
      const apiResult = await withRetry(
        // @ts-ignore
        () => syncService.client.updateProductTargetBids(
          spTargetBids.map((r) => ({ targetId: r.targetId, bid: r.bid }))
        ),
        { maxRetries: 5, baseDelayMs: 5e3, label: `batchUpdateSpProductTargetBids-${spTargetBids.length}`, accountId }
      );
      const successCount = spTargetBids.length - (apiResult.errors?.length || 0);
      result.success += successCount;
      const requestId = apiResult.requestIds?.[0] || "";
      const failedTargetIds = new Set((apiResult.errors || []).map((e) => String(e.targetId)));
      for (const item of spTargetBids) {
        if (!failedTargetIds.has(item.targetId)) {
          result.itemResults.set(item.localId, { status: "synced", apiResponseId: requestId });
        }
      }
      const entityNotFoundTargetIds = [];
      if (apiResult.errors && apiResult.errors.length > 0) {
        result.failed += apiResult.errors.length;
        for (const err of apiResult.errors) {
          const localItem = spTargetBids.find((r) => r.targetId === String(err.targetId));
          const errMsg = `SP product_target ${err.targetId}: ${err.details || err.code || "unknown"}`;
          result.errors.push(errMsg);
          if (localItem) {
            result.itemResults.set(localItem.localId, { status: "failed", error: String(err.details || err.code) });
          }
          const errStr = JSON.stringify(err).toLowerCase();
          if (errStr.includes("entitynotfounderror") || errStr.includes("entity_not_found") || errStr.includes("could not find") || errStr.includes("entitystateerror") || errStr.includes("archived entity")) {
            if (err.targetId) entityNotFoundTargetIds.push(String(err.targetId));
          }
        }
      }
      if (entityNotFoundTargetIds.length > 0) {
        try {
          const idList = entityNotFoundTargetIds.map((id) => `'${String(id).replace(/'/g, "''")}'`).join(",");
          await dbInstance.execute(
            // @ts-ignore
            sql.raw(`UPDATE product_targets SET targetStatus = 'amazon_deleted' WHERE targetId IN (${idList})`)
          );
          log38.warn(`[v502] \u5DF2\u6807\u8BB0${entityNotFoundTargetIds.length}\u4E2ASP\u5546\u54C1\u5B9A\u5411\u4E3Aamazon_deleted`);
        } catch (markErr) {
          log38.warn(`[v502] \u6807\u8BB0\u8FC7\u671FSP\u5546\u54C1\u5B9A\u5411\u5931\u8D25: ${markErr.message}`);
        }
      }
      log38.info(`[v502] SP\u5546\u54C1\u5B9A\u5411\u51FA\u4EF7\u66F4\u65B0\u5B8C\u6210: \u6210\u529F=${successCount}, \u5931\u8D25=${apiResult.errors?.length || 0}`);
    } catch (batchErr) {
      log38.warn(`[v502] SP\u5546\u54C1\u5B9A\u5411\u51FA\u4EF7\u6279\u91CF\u66F4\u65B0\u5F02\u5E38: ${batchErr.message}`);
      result.failed += spTargetBids.length;
      for (const item of spTargetBids) {
        result.itemResults.set(item.localId, { status: "failed", error: batchErr.message });
      }
      result.errors.push(`SP\u5546\u54C1\u5B9A\u5411\u51FA\u4EF7\u6279\u91CF\u66F4\u65B0\u5F02\u5E38: ${batchErr.message}`);
    }
  }
  if (sbTargetBids.length > 0) {
    log38.info(`[v502] \u6279\u91CF\u53D1\u9001 ${sbTargetBids.length} \u4E2ASB\u5546\u54C1\u5B9A\u5411\u51FA\u4EF7\u66F4\u65B0\u5230Amazon`);
    try {
      if (spTargetBids.length > 0) {
        await new Promise((resolve) => setTimeout(resolve, 5e3));
      }
      const sbApiMethod = syncService.client.updateSbProductTargetBids || syncService.client.updateProductTargetBids;
      const apiResult = await withRetry(
        () => sbApiMethod.call(
          syncService.client,
          sbTargetBids.map((r) => ({ targetId: r.targetId, bid: r.bid }))
        ),
        { maxRetries: 5, baseDelayMs: 5e3, label: `batchUpdateSbProductTargetBids-${sbTargetBids.length}`, accountId }
      );
      const successCount = sbTargetBids.length - (apiResult.errors?.length || 0);
      result.success += successCount;
      const failedIds = new Set((apiResult.errors || []).map((e) => String(e.targetId)));
      for (const item of sbTargetBids) {
        if (!failedIds.has(item.targetId)) {
          result.itemResults.set(item.localId, { status: "synced" });
        } else {
          result.failed++;
          result.itemResults.set(item.localId, { status: "failed", error: "SB API error" });
        }
      }
      log38.info(`[v502] SB\u5546\u54C1\u5B9A\u5411\u51FA\u4EF7\u66F4\u65B0\u5B8C\u6210: \u6210\u529F=${successCount}, \u5931\u8D25=${apiResult.errors?.length || 0}`);
    } catch (batchErr) {
      log38.warn(`[v502] SB\u5546\u54C1\u5B9A\u5411\u51FA\u4EF7\u6279\u91CF\u66F4\u65B0\u5F02\u5E38: ${batchErr.message}`);
      result.failed += sbTargetBids.length;
      for (const item of sbTargetBids) {
        result.itemResults.set(item.localId, { status: "failed", error: batchErr.message });
      }
    }
  }
  if (sdTargetBids.length > 0) {
    log38.info(`[v502] \u6279\u91CF\u53D1\u9001 ${sdTargetBids.length} \u4E2ASD\u5546\u54C1\u5B9A\u5411\u51FA\u4EF7\u66F4\u65B0\u5230Amazon`);
    try {
      if (spTargetBids.length > 0 || sbTargetBids.length > 0) {
        await new Promise((resolve) => setTimeout(resolve, 5e3));
      }
      const sdApiMethod = syncService.client.updateSdProductTargetBids || syncService.client.updateProductTargetBids;
      const apiResult = await withRetry(
        () => sdApiMethod.call(
          syncService.client,
          sdTargetBids.map((r) => ({ targetId: r.targetId, bid: r.bid }))
        ),
        { maxRetries: 5, baseDelayMs: 5e3, label: `batchUpdateSdProductTargetBids-${sdTargetBids.length}`, accountId }
      );
      const successCount = sdTargetBids.length - (apiResult.errors?.length || 0);
      result.success += successCount;
      const failedIds = new Set((apiResult.errors || []).map((e) => String(e.targetId)));
      for (const item of sdTargetBids) {
        if (!failedIds.has(item.targetId)) {
          result.itemResults.set(item.localId, { status: "synced" });
        } else {
          result.failed++;
          result.itemResults.set(item.localId, { status: "failed", error: "SD API error" });
        }
      }
      log38.info(`[v502] SD\u5546\u54C1\u5B9A\u5411\u51FA\u4EF7\u66F4\u65B0\u5B8C\u6210: \u6210\u529F=${successCount}, \u5931\u8D25=${apiResult.errors?.length || 0}`);
    } catch (batchErr) {
      log38.warn(`[v502] SD\u5546\u54C1\u5B9A\u5411\u51FA\u4EF7\u6279\u91CF\u66F4\u65B0\u5F02\u5E38: ${batchErr.message}`);
      result.failed += sdTargetBids.length;
      for (const item of sdTargetBids) {
        result.itemResults.set(item.localId, { status: "failed", error: batchErr.message });
      }
    }
  }
  if (sdAudienceAdjustments.length > 0) {
    log38.info(`[v512] \u6279\u91CF\u53D1\u9001 ${sdAudienceAdjustments.length} \u4E2ASD\u53D7\u4F17\u51FA\u4EF7\u66F4\u65B0\u5230Amazon`);
    try {
      const { sdAudiences: sdAudiencesSchema } = await Promise.resolve().then(() => (init_schema2(), schema_exports));
      const { inArray: inArray13 } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
      const sdAudLocalIds = sdAudienceAdjustments.map((a) => a.keywordId);
      const sdAudRows = await dbInstance.select({ id: sdAudiencesSchema.id, audienceId: sdAudiencesSchema.audienceId, state: sdAudiencesSchema.state }).from(sdAudiencesSchema).where(inArray13(sdAudiencesSchema.id, sdAudLocalIds));
      const sdAudIdMap = /* @__PURE__ */ new Map();
      for (const row of sdAudRows) {
        if (row.state !== "archived" && row.audienceId) {
          sdAudIdMap.set(row.id, row.audienceId);
        }
      }
      const sdAudBids = [];
      for (const adj of sdAudienceAdjustments) {
        const amazonTargetId = sdAudIdMap.get(adj.keywordId);
        if (amazonTargetId) {
          sdAudBids.push({ targetId: amazonTargetId, bid: Number(adj.newBid.toFixed(2)), localId: adj.keywordId });
        } else {
          result.failed++;
          result.errors.push(`sd_audience ${adj.keywordId}: \u7F3A\u5C11Amazon targetId`);
          result.itemResults.set(adj.keywordId, { status: "failed", error: "\u7F3A\u5C11Amazon targetId" });
        }
      }
      if (sdAudBids.length > 0) {
        if (resolvedTargetBids.length > 0 || deduplicatedKeywordBids.length > 0) {
          await new Promise((resolve) => setTimeout(resolve, 5e3));
        }
        const apiResult = await withRetry(
          // @ts-ignore
          () => syncService.client.updateSdTargetBids(
            sdAudBids.map((r) => ({ targetId: r.targetId, bid: r.bid }))
          ),
          { maxRetries: 5, baseDelayMs: 5e3, label: `batchUpdateSdAudienceBids-${sdAudBids.length}`, accountId }
        );
        const failedIds = /* @__PURE__ */ new Set();
        if (apiResult && typeof apiResult === "object" && "errors" in apiResult) {
          const errors = apiResult.errors || [];
          for (const err of errors) {
            failedIds.add(String(err.targetId));
          }
        }
        for (const item of sdAudBids) {
          if (failedIds.has(item.targetId)) {
            result.failed++;
            result.itemResults.set(item.localId, { status: "failed", error: "SD audience API error" });
          } else {
            result.success++;
            result.itemResults.set(item.localId, { status: "synced" });
          }
        }
        log38.info(`[v512] SD\u53D7\u4F17\u51FA\u4EF7\u66F4\u65B0\u5B8C\u6210: \u53D1\u9001=${sdAudBids.length}, \u6210\u529F=${sdAudBids.length - failedIds.size}, \u5931\u8D25=${failedIds.size}`);
      }
    } catch (batchErr) {
      log38.warn(`[v512] SD\u53D7\u4F17\u51FA\u4EF7\u6279\u91CF\u66F4\u65B0\u5F02\u5E38: ${batchErr.message}`);
      result.failed += sdAudienceAdjustments.length;
      for (const item of sdAudienceAdjustments) {
        result.itemResults.set(item.keywordId, { status: "failed", error: batchErr.message });
      }
    }
  }
  const totalAttempts = result.success + result.failed;
  const failureRate = totalAttempts > 0 ? result.failed / totalAttempts * 100 : 0;
  log38.warn(`[AmazonApiHelper] \u51FA\u4EF7\u540C\u6B65\u5B8C\u6210: \u6210\u529F=${result.success}, \u5931\u8D25=${result.failed}, \u6210\u529F\u7387=${(100 - failureRate).toFixed(1)}%`);
  if (result.errors.length > 0) {
    const hasRealErrors = result.errors.some((e) => !e.includes("entityNotFoundError") && !e.includes("entityStateError") && !e.includes("ENTITY_NOT_FOUND"));
    if (hasRealErrors) {
      log38.warn(`[AmazonApiHelper] \u9519\u8BEF\u8BE6\u60C5: ${result.errors.slice(0, 5).join("; ")}`);
    } else {
      log38.warn(`[AmazonApiHelper] v474: \u5DF2\u5220\u9664/\u5F52\u6863\u5B9E\u4F53\u9519\u8BEF(${result.errors.length}\u6761): ${result.errors.slice(0, 3).join("; ").slice(0, 200)}`);
    }
  }
  log38.info(`[AmazonApiHelper] v454: \u51FA\u4EF7\u540C\u6B65\u7EDF\u8BA1 accountId=${accountId}: \u603B\u8BA1=${totalAttempts}, \u6210\u529F=${result.success}, \u5931\u8D25=${result.failed}, \u6210\u529F\u7387=${totalAttempts > 0 ? (result.success / totalAttempts * 100).toFixed(1) : 0}%`);
  const FAILURE_RATE_THRESHOLD = 20;
  if (failureRate > FAILURE_RATE_THRESHOLD && totalAttempts >= 5) {
    log38.warn(`[ALERT] \u26A0\uFE0F Amazon API\u540C\u6B65\u5931\u8D25\u7387\u8FC7\u9AD8! \u5931\u8D25\u7387=${failureRate.toFixed(1)}% (\u9608\u503C=${FAILURE_RATE_THRESHOLD}%), \u6210\u529F=${result.success}, \u5931\u8D25=${result.failed}`);
    log38.warn(`[ALERT] \u8BF7\u68C0\u67E5Amazon API\u51ED\u8BC1\u3001\u914D\u989D\u548C\u7F51\u7EDC\u72B6\u6001`);
    try {
      const dbInstance2 = await getDb();
      if (dbInstance2) {
        const { sql: sql15 } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
        const now = (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ");
        const alertMsg = `Amazon API\u51FA\u4EF7\u540C\u6B65\u5931\u8D25\u7387${failureRate.toFixed(1)}%\uFF08\u6210\u529F${result.success}/\u5931\u8D25${result.failed}\uFF09\uFF0C\u8D85\u8FC7${FAILURE_RATE_THRESHOLD}%\u9608\u503C`;
        const errorSummary = result.errors.slice(0, 3).join("; ");
        await dbInstance2.execute(sql15`INSERT INTO system_alerts (alert_type, alert_level, alert_message, alert_details, account_id, created_at) VALUES (${"api_sync_failure"}, ${"warning"}, ${alertMsg}, ${errorSummary}, ${accountId}, ${now}) ON DUPLICATE KEY UPDATE alert_message = VALUES(alert_message), created_at = VALUES(created_at)`);
      }
    } catch (alertErr) {
      log38.warn(`[ALERT] \u544A\u8B66\u5199\u5165\u6570\u636E\u5E93\u5931\u8D25\uFF08\u8868\u53EF\u80FD\u4E0D\u5B58\u5728\uFF09: ${alertErr.message}`);
    }
  }
  const authErrors = result.errors.filter((e) => {
    if (e.includes("entityNotFoundError") || e.includes("entityStateError") || e.includes("ENTITY_NOT_FOUND")) {
      return false;
    }
    if ((e.includes("status=403") || e.includes("Forbidden") || e.includes("PERMISSION_DENIED")) && (e.includes("/sb/") || e.includes("/sd/") || e.includes("SB/SD\u6743\u9650\u4E0D\u8DB3"))) {
      return false;
    }
    return e.includes("status=401") || e.includes("HTTP 401") || e.includes("Unauthorized") || e.includes("status=403") || e.includes("HTTP 403") || e.includes("Forbidden") || e.includes("Token\u5DF2\u8FC7\u671F") || e.includes("token expired");
  });
  if (authErrors.length > 0) {
    log38.warn(`[ALERT] v333: \u26A0\uFE0F \u53D1\u73B0${authErrors.length}\u6761\u8BA4\u8BC1\u76F8\u5173\u9519\u8BEF! \u8BF7\u7ACB\u5373\u68C0\u67E5accountId=${accountId}\u7684API\u51ED\u8BC1\u6709\u6548\u6027`);
    log38.warn(`[ALERT] v333: \u8BA4\u8BC1\u9519\u8BEF\u8BE6\u60C5: ${authErrors.slice(0, 3).join("; ")}`);
    try {
      const dbInstance2 = await getDb();
      if (dbInstance2) {
        const { sql: sql15 } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
        await dbInstance2.execute(sql15`
          INSERT INTO anomaly_alert_logs (accountId, anomalyType, detectedValue, actionTaken, createdAt)
          VALUES (
            ${accountId},
            ${"AUTH_FAILURE_SYNC"},
            ${"critical"},
            ${JSON.stringify({
          source: "syncBidAdjustmentsToAmazon",
          authErrorCount: authErrors.length,
          totalAttempts,
          errors: authErrors.slice(0, 5),
          alertMessage: `\u51FA\u4EF7\u540C\u6B65\u8FC7\u7A0B\u4E2D\u53D1\u73B0${authErrors.length}\u6761\u8BA4\u8BC1\u5931\u8D25\u9519\u8BEF\uFF0C\u8BF7\u7ACB\u5373\u68C0\u67E5accountId=${accountId}\u7684OAuth Token\u6709\u6548\u6027`
        })},
            NOW()
          )
        `);
        log38.warn(`[ALERT] v333: \u8BA4\u8BC1\u5931\u8D25\u544A\u8B66\u5DF2\u5199\u5165anomaly_alert_logs: accountId=${accountId}, authErrors=${authErrors.length}`);
      }
    } catch (authAlertErr) {
      log38.warn(`[ALERT] v333: \u8BA4\u8BC1\u5931\u8D25\u544A\u8B66\u5199\u5165\u5931\u8D25: ${authAlertErr.message}`);
    }
  }
  return result;
}
async function syncNewKeywordsToAmazon(accountId, newKeywords) {
  const result = {
    success: 0,
    failed: 0,
    errors: [],
    createdKeywords: []
  };
  if (newKeywords.length === 0) return result;
  log38.info(`[AmazonApiHelper] \u5F00\u59CB\u540C\u6B65\u65B0\u5173\u952E\u8BCD\u5230Amazon: accountId=${accountId}, \u603B\u8BA1=${newKeywords.length}\u4E2A`);
  const syncService = await getAmazonSyncService2(accountId);
  if (!syncService) {
    const errorMsg = `\u65E0\u6CD5\u83B7\u53D6\u8D26\u53F7 ${accountId} \u7684API\u670D\u52A1`;
    result.errors.push(errorMsg);
    result.failed = newKeywords.length;
    return result;
  }
  let keywordsToCreate = [...newKeywords];
  const existingKeywordsMap = /* @__PURE__ */ new Map();
  try {
    const adGroupIds = [...new Set(newKeywords.map((k) => String(k.internal_ad_group_id)))];
    for (const agId of adGroupIds) {
      try {
        const existingKws = await syncService.client.listSpKeywords(Number(agId));
        const keySet = /* @__PURE__ */ new Set();
        for (const kw of existingKws) {
          const text2 = (kw.keywordText || "").toLowerCase().trim();
          const mt = (kw.matchType || "").toLowerCase();
          if (text2) keySet.add(`${text2}::${mt}`);
        }
        existingKeywordsMap.set(agId, keySet);
        log38.debug(`[AmazonApiHelper] v337: AdGroup ${agId} \u5DF2\u6709 ${keySet.size} \u4E2A\u5173\u952E\u8BCD`);
      } catch (listErr) {
        log38.warn(`[AmazonApiHelper] v337: \u67E5\u8BE2AdGroup ${agId} \u5173\u952E\u8BCD\u5217\u8868\u5931\u8D25(\u7EE7\u7EED\u521B\u5EFA): ${listErr.message}`);
      }
    }
    const filteredKeywords = [];
    for (const kw of newKeywords) {
      const agKeySet = existingKeywordsMap.get(String(kw.adGroupId));
      const lookupKey = `${kw.keywordText.toLowerCase().trim()}::${kw.matchType.toLowerCase()}`;
      if (agKeySet && agKeySet.has(lookupKey)) {
        result.success++;
        result.createdKeywords.push({
          // @ts-ignore
          localId: kw.localKeywordId,
          amazonKeywordId: 0,
          // @ts-ignore
          keywordText: kw.keywordText
        });
        log38.info(`[AmazonApiHelper] v337: \u5173\u952E\u8BCD\u5DF2\u5B58\u5728\u4E8EAmazon\uFF0C\u8DF3\u8FC7\u521B\u5EFA: "${kw.keywordText}" [${kw.matchType}] in adGroup ${kw.adGroupId}`);
      } else {
        filteredKeywords.push(kw);
      }
    }
    if (filteredKeywords.length < newKeywords.length) {
      log38.info(`[AmazonApiHelper] v337: Amazon\u7AEF\u53BB\u91CD: ${newKeywords.length}\u4E2A -> ${filteredKeywords.length}\u4E2A (${newKeywords.length - filteredKeywords.length}\u4E2A\u5DF2\u5B58\u5728)`);
    }
    keywordsToCreate = filteredKeywords;
    if (keywordsToCreate.length === 0) {
      log38.info(`[AmazonApiHelper] v337: \u6240\u6709\u5173\u952E\u8BCD\u5DF2\u5B58\u5728\u4E8EAmazon\uFF0C\u65E0\u9700\u521B\u5EFA`);
      return result;
    }
  } catch (checkErr) {
    log38.warn(`[AmazonApiHelper] v337: Amazon\u7AEF\u5B58\u5728\u6027\u68C0\u67E5\u5931\u8D25(\u7EE7\u7EED\u6B63\u5E38\u521B\u5EFA): ${checkErr.message}`);
  }
  const BATCH_SIZE = 50;
  const BATCH_DELAY_MS = 2e3;
  const totalBatches = Math.ceil(keywordsToCreate.length / BATCH_SIZE);
  log38.info(`[AmazonApiHelper] \u5206\u6279\u5904\u7406: \u603B\u8BA1${keywordsToCreate.length}\u4E2A\u5173\u952E\u8BCD, \u5206${totalBatches}\u6279, \u6BCF\u6279\u6700\u591A${BATCH_SIZE}\u4E2A`);
  for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
    const batchStart = batchIdx * BATCH_SIZE;
    const batchEnd = Math.min(batchStart + BATCH_SIZE, keywordsToCreate.length);
    const batch = keywordsToCreate.slice(batchStart, batchEnd);
    log38.info(`[AmazonApiHelper] \u5904\u7406\u7B2C${batchIdx + 1}/${totalBatches}\u6279: ${batch.length}\u4E2A\u5173\u952E\u8BCD (\u7D22\u5F15 ${batchStart}-${batchEnd - 1})`);
    try {
      const apiResult = await withRetry(
        // @ts-ignore
        () => syncService.client.createSpKeywords(
          // @ts-ignore
          batch.map((k) => ({
            adGroupId: k.internal_ad_group_id,
            campaignId: k.campaignId,
            keywordText: k.keywordText,
            matchType: k.matchType,
            bid: k.bid,
            state: "enabled"
          }))
        ),
        { maxRetries: 2, baseDelayMs: 3e3, label: `createSpKeywords-batch${batchIdx + 1}`, accountId }
      );
      for (let i = 0; i < apiResult.createdKeywords.length; i++) {
        const created = apiResult.createdKeywords[i];
        const original = batch[i];
        if (created.code === "SUCCESS" && created.keywordId) {
          result.success++;
          result.createdKeywords.push({
            localId: original.localKeywordId,
            amazonKeywordId: created.keywordId,
            keywordText: created.keywordText || original.keywordText
          });
          if (original.localKeywordId) {
            try {
              const rawConn = await getDirectConnection();
              try {
                await rawConn.execute(
                  `UPDATE keywords SET keywordId = ?,
                   accountId = COALESCE(accountId, ?),
                   campaignId = COALESCE(campaignId, ?)
                   WHERE id = ?`,
                  [String(created.keywordId), accountId, String(original.campaignId || ""), original.localKeywordId]
                );
                log38.info(`[AmazonApiHelper] \u2705 v357: \u5173\u952E\u8BCD\u5DF2\u540C\u6B65: "${original.keywordText}" -> amazonKeywordId=${created.keywordId}, accountId=${accountId}`);
              } finally {
                rawConn.release();
              }
            } catch (dbError) {
              log38.warn(`[AmazonApiHelper] v357: \u66F4\u65B0\u672C\u5730keywordId\u5931\u8D25:`, dbError.message);
            }
          }
        } else {
          result.failed++;
          const errorCode = created.code || "UNKNOWN";
          const errorDetail = created.details || created.description || "";
          result.errors.push(`\u5173\u952E\u8BCD\u521B\u5EFA\u5931\u8D25: "${original.keywordText}" - code=${errorCode}`);
          log38.warn(`[AmazonApiHelper] \u274C \u5173\u952E\u8BCD\u521B\u5EFA\u5931\u8D25: "${original.keywordText}", code=${errorCode}, detail=${errorDetail}`);
          const isPermanentError = errorCode === "INVALID_VALUE" || errorCode === "INVALID_ARGUMENT" || errorCode === "ERROR" || // v350: Amazon通用拒绝码，通常为品牌词/受限词
          // @ts-ignore
          errorDetail.toLowerCase().includes("trademark") || // @ts-ignore
          errorDetail.toLowerCase().includes("brand") || // @ts-ignore
          errorDetail.toLowerCase().includes("restricted") || // @ts-ignore
          errorDetail.toLowerCase().includes("not eligible") || // @ts-ignore
          errorDetail.toLowerCase().includes("duplicate");
          if (isPermanentError) {
            try {
              const dbInstance = await getDb();
              if (dbInstance) {
                const { sql: sqlTag } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
                await dbInstance.execute(sqlTag`
                  UPDATE optimization_logs 
                  SET api_sync_status = 'permanently_failed',
                      api_sync_detail = ${JSON.stringify({ code: errorCode, detail: errorDetail, reason: "v351: Amazon\u6C38\u4E45\u6027\u62D2\u7EDD" })}
                  WHERE action_type = 'keyword_create'
                    AND JSON_UNQUOTE(JSON_EXTRACT(action_detail, '$.searchTerm')) = ${original.keywordText}
                    AND api_sync_status = 'failed'
                `);
                log38.warn(`[AmazonApiHelper] v351: \u5173\u952E\u8BCD"${original.keywordText}"\u5DF2\u6807\u8BB0\u4E3A\u6C38\u4E45\u5931\u8D25 (${errorCode})`);
              }
            } catch (markErr) {
              log38.warn(`[AmazonApiHelper] v351: \u6807\u8BB0\u6C38\u4E45\u5931\u8D25\u5F02\u5E38: ${markErr.message}`);
            }
          }
        }
      }
      log38.info(`[AmazonApiHelper] \u7B2C${batchIdx + 1}\u6279\u5B8C\u6210: \u672C\u6279\u6210\u529F=${apiResult.createdKeywords.filter((k) => k.code === "SUCCESS").length}, \u7D2F\u8BA1\u6210\u529F=${result.success}`);
    } catch (error48) {
      const batchFailCount = batch.length;
      result.failed += batchFailCount;
      const errorMsg = `\u7B2C${batchIdx + 1}\u6279\u521B\u5EFA\u5173\u952E\u8BCDAPI\u8C03\u7528\u5931\u8D25: ${error48.message}`;
      result.errors.push(errorMsg);
      log38.warn(`[AmazonApiHelper] \u274C ${errorMsg}`, error48.response?.data ? JSON.stringify(error48.response.data).slice(0, 500) : "");
      if (error48.response?.status === 429) {
        const throttleWait = BATCH_DELAY_MS * 5;
        log38.debug(`[AmazonApiHelper] \u26A0\uFE0F \u9650\u6D41\uFF0C\u7B49\u5F85${throttleWait}ms\u540E\u7EE7\u7EED\u4E0B\u4E00\u6279...`);
        await new Promise((resolve) => setTimeout(resolve, throttleWait));
      }
    }
    if (batchIdx < totalBatches - 1) {
      await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }
  log38.warn(`[AmazonApiHelper] \u65B0\u5173\u952E\u8BCD\u540C\u6B65\u5B8C\u6210: \u6210\u529F=${result.success}, \u5931\u8D25=${result.failed}, \u603B\u8BA1=${newKeywords.length}`);
  return result;
}
async function syncNewProductTargetsToAmazon(accountId, newTargets) {
  const result = { success: 0, failed: 0, errors: [], targetIdMap: /* @__PURE__ */ new Map() };
  if (!newTargets.length) return result;
  const syncService = await getAmazonSyncService2(accountId);
  if (!syncService) {
    result.errors.push("No sync service available");
    result.failed = newTargets.length;
    return result;
  }
  const BATCH_SIZE = 50;
  const BATCH_DELAY_MS = 500;
  for (let i = 0; i < newTargets.length; i += BATCH_SIZE) {
    const batch = newTargets.slice(i, i + BATCH_SIZE);
    try {
      const apiTargets = batch.map((t2) => {
        const expression = t2.targetingType === "exact" ? [{ type: "asinSameAs", value: t2.asin }] : [{ type: "asinExpandedFrom", value: t2.asin }];
        return {
          adGroupId: t2.adGroupId,
          campaignId: t2.campaignId,
          expression,
          expressionType: "manual",
          bid: t2.bid,
          state: "enabled"
        };
      });
      const apiResult = await syncService.client.createSpProductTargets(apiTargets);
      for (let j = 0; j < apiResult.createdTargets.length; j++) {
        const created = apiResult.createdTargets[j];
        if (created.code === "SUCCESS" && created.targetId) {
          result.success++;
          const mapKey = `${batch[j].adGroupId}:${batch[j].asin}`;
          result.targetIdMap.set(mapKey, created.targetId);
        } else {
          result.failed++;
          const errMsg = `ASIN ${batch[j].asin}: ${created.code}`;
          result.errors.push(errMsg);
          log38.warn(`[AmazonApiHelper] v310: \u5546\u54C1\u5B9A\u5411\u521B\u5EFA\u5931\u8D25: ${errMsg}`);
        }
      }
    } catch (batchErr) {
      log38.warn(`[AmazonApiHelper] v310: \u5546\u54C1\u5B9A\u5411\u6279\u6B21\u540C\u6B65\u5931\u8D25: ${batchErr.message}`);
      result.failed += batch.length;
      result.errors.push(`Batch error: ${batchErr.message}`);
    }
    if (i + BATCH_SIZE < newTargets.length) {
      await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }
  log38.warn(`[AmazonApiHelper] v310: \u5546\u54C1\u5B9A\u5411\u540C\u6B65\u5B8C\u6210: \u6210\u529F=${result.success}, \u5931\u8D25=${result.failed}, \u603B\u8BA1=${newTargets.length}`);
  return result;
}
async function syncBudgetAdjustmentToAmazon(accountId, campaignId, newBudget, reason, campaignType) {
  const syncService = await getAmazonSyncService2(accountId);
  if (!syncService) return false;
  try {
    const type = (campaignType || "sp_manual").toLowerCase();
    await withRetry(async () => {
      if (type === "sb") {
        await syncService.client.updateSbCampaign(String(campaignId), {
          budget: newBudget
        });
      } else if (type === "sd") {
        await syncService.client.updateSdCampaign(String(campaignId), {
          // v356: 统一使用String类型传递Amazon ID
          budget: newBudget
        });
      } else {
        await syncService.client.updateSpCampaign(String(campaignId), {
          dailyBudget: newBudget
        });
      }
    }, { label: `\u9884\u7B97\u540C\u6B65 Campaign ${campaignId}`, accountId });
    log38.info(`[AmazonApiHelper] \u9884\u7B97\u540C\u6B65\u6210\u529F: Campaign ${campaignId} (${type}), \u65B0\u9884\u7B97=$${newBudget}`);
    return true;
  } catch (error48) {
    log38.warn(`[AmazonApiHelper] \u9884\u7B97\u540C\u6B65\u5931\u8D25(\u542B\u91CD\u8BD5): Campaign ${campaignId} (${campaignType}):`, error48.message);
    return false;
  }
}
async function syncPlacementAdjustmentToAmazon(accountId, campaignId, topOfSearchPercent, productPagePercent, reason, campaignType) {
  const syncService = await getAmazonSyncService2(accountId);
  if (!syncService) return false;
  const cType = (campaignType || "sp_manual").toLowerCase();
  try {
    if (cType === "sb") {
      await withRetry(async () => {
        const bidAdjustments = [];
        if (Math.round(topOfSearchPercent) > 0) {
          bidAdjustments.push({ predicate: "placementTop", percentage: Math.round(topOfSearchPercent) });
        }
        if (Math.round(productPagePercent) > 0) {
          bidAdjustments.push({ predicate: "placementProductPage", percentage: Math.round(productPagePercent) });
        }
        await syncService.client.updateSbCampaign(String(campaignId), {
          bidding: { bidAdjustments }
        });
      }, { label: `SB\u4F4D\u7F6E\u503E\u659C\u540C\u6B65 Campaign ${campaignId}`, accountId });
      log38.info(`[AmazonApiHelper] v471: SB\u4F4D\u7F6E\u503E\u659C\u540C\u6B65\u6210\u529F: Campaign ${campaignId}, Top=${topOfSearchPercent}%, ProductPage=${productPagePercent}%`);
    } else if (cType === "sd") {
      log38.warn(`[AmazonApiHelper] v471: SD\u5E7F\u544A\u4E0D\u652F\u6301\u4F4D\u7F6E\u503E\u659C\u8C03\u6574\uFF0C\u8DF3\u8FC7: Campaign ${campaignId}`);
      return false;
    } else {
      await withRetry(async () => {
        const placementBidding = [];
        if (Math.round(topOfSearchPercent) > 0) {
          placementBidding.push({ placement: "PLACEMENT_TOP", percentage: Math.round(topOfSearchPercent) });
        }
        if (Math.round(productPagePercent) > 0) {
          placementBidding.push({ placement: "PLACEMENT_PRODUCT_PAGE", percentage: Math.round(productPagePercent) });
        }
        await syncService.client.updateSpCampaign(String(campaignId), {
          dynamicBidding: {
            placementBidding
          }
        });
      }, { label: `SP\u4F4D\u7F6E\u503E\u659C\u540C\u6B65 Campaign ${campaignId}`, accountId });
      log38.info(`[AmazonApiHelper] SP\u4F4D\u7F6E\u503E\u659C\u540C\u6B65\u6210\u529F: Campaign ${campaignId}, Top=${topOfSearchPercent}%, ProductPage=${productPagePercent}%`);
    }
    return true;
  } catch (error48) {
    log38.warn(`[AmazonApiHelper] \u4F4D\u7F6E\u503E\u659C\u540C\u6B65\u5931\u8D25(\u542B\u91CD\u8BD5): Campaign ${campaignId}:`, error48.message);
    return false;
  }
}
function normalizeMatchTypeForComparison(matchType) {
  const lower = (matchType || "").toLowerCase();
  if (lower === "negativephrase" || lower === "negative_phrase") return "negative_phrase";
  if (lower === "negativeexact" || lower === "negative_exact") return "negative_exact";
  return lower;
}
async function syncNegativeKeywordsToAmazon(accountId, negatives) {
  const result = { success: 0, failed: 0, errors: [], keywordIdMap: /* @__PURE__ */ new Map() };
  if (negatives.length === 0) return result;
  // v577: 否定关键词严格本地校验
  const validatedNegatives = [];
  const NEGATIVE_KW_MAX_LENGTH = 80; // Amazon否定关键词最大长度
  const NEGATIVE_KW_MIN_LENGTH = 1;
  const INVALID_CHARS_REGEX = /[\x00-\x1f\x7f<>{}|\\^~\[\]`]/; // 控制字符和特殊字符
  for (const neg of negatives) {
    const kw = (neg.keywordText || "").trim();
    // 长度校验
    if (kw.length < NEGATIVE_KW_MIN_LENGTH || kw.length > NEGATIVE_KW_MAX_LENGTH) {
      result.failed++;
      result.errors.push(`v577校验失败: 否定词"${kw.slice(0,30)}..."长度${kw.length}不在[${NEGATIVE_KW_MIN_LENGTH},${NEGATIVE_KW_MAX_LENGTH}]范围内`);
      log38.warn(`[AmazonApiHelper] v577: 否定词长度校验失败: "${kw.slice(0,30)}..." (长度=${kw.length})`);
      continue;
    }
    // 特殊字符校验
    if (INVALID_CHARS_REGEX.test(kw)) {
      result.failed++;
      result.errors.push(`v577校验失败: 否定词"${kw.slice(0,30)}..."包含非法字符`);
      log38.warn(`[AmazonApiHelper] v577: 否定词包含非法字符: "${kw.slice(0,30)}..."`);
      continue;
    }
    // matchType校验
    const validMatchTypes = ["negativeExact", "negativePhrase", "NEGATIVE_EXACT", "NEGATIVE_PHRASE"];
    if (!validMatchTypes.includes(neg.matchType)) {
      result.failed++;
      result.errors.push(`v577校验失败: 否定词"${kw.slice(0,30)}..."的matchType="${neg.matchType}"无效`);
      log38.warn(`[AmazonApiHelper] v577: 否定词matchType无效: "${kw.slice(0,30)}..." matchType=${neg.matchType}`);
      continue;
    }
    // campaignId必须存在
    if (!neg.campaignId) {
      result.failed++;
      result.errors.push(`v577校验失败: 否定词"${kw.slice(0,30)}..."缺少campaignId`);
      continue;
    }
    // 清洗keywordText
    neg.keywordText = kw;
    validatedNegatives.push(neg);
  }
  if (validatedNegatives.length < negatives.length) {
    log38.info(`[AmazonApiHelper] v577: 否定词校验完成, ${negatives.length}个输入 -> ${validatedNegatives.length}个有效, ${negatives.length - validatedNegatives.length}个被过滤`);
  }
  negatives = validatedNegatives;
  if (negatives.length === 0) return result;
  const syncService = await getAmazonSyncService2(accountId);
  if (!syncService) {
    result.errors.push(`\u65E0\u6CD5\u83B7\u53D6\u8D26\u53F7 ${accountId} \u7684API\u670D\u52A1`);
    result.failed = negatives.length;
    return result;
  }
  // v585: campaignType查询已移至API层面处理（parent program type错误自动跳过）
  // v577: 过滤SB/SD类型的否定词操作（SB/SD不支持通过SP API创建否定关键词）
  // fix24-P3v3-4.1b: 对campaignType为空的否定词，通过DB查询campaignId对应的campaignType
  for (const neg of negatives) {
    if (!neg.campaignType && neg.campaignId) {
      try {
        const conn41b = await getDirectConnection();
        try {
          const [rows41b] = await conn41b.execute(
            "SELECT campaign_type FROM campaigns WHERE campaign_id = ? LIMIT 1",
            [neg.campaignId]
          );
          if (rows41b.length > 0) {
            neg.campaignType = rows41b[0].campaign_type || "";
            log38.debug(`[fix24-P3v3-4.1b] campaignId=${neg.campaignId} -> campaignType=${neg.campaignType}`);
          }
        } finally {
          conn41b.release();
        }
      } catch (e41b) {
        log38.debug(`[fix24-P3v3-4.1b] DB lookup failed for campaignId=${neg.campaignId}: ${e41b.message}`);
      }
    }
  }
  const spNegatives = [];
  const nonSpNegatives = [];
  for (const neg of negatives) {
    const cType = (neg.campaignType || "").toLowerCase();
    if (cType.startsWith("sb") || cType.startsWith("sd")) {
      nonSpNegatives.push(neg);
      log38.info(`[fix24-P3v3-4.1b] 拦截非SP否定词: campaignId=${neg.campaignId}, type=${cType}, keyword=${neg.keywordText}`);
    } else {
      spNegatives.push(neg);
    }
  }
  if (nonSpNegatives.length > 0) {
    log38.info(`[AmazonApiHelper] v577: 拦截 ${nonSpNegatives.length} 个SB/SD类型否定词操作(不支持SP否定词API)`);
    result.success += nonSpNegatives.length; // 标记为跳过成功
  }
  negatives = spNegatives;
  if (negatives.length === 0) return result;
  const campaignLevel = negatives.filter((n) => n.level === "campaign");
  const adGroupLevel = negatives.filter((n) => n.level === "adgroup" && n.adGroupId);
  if (campaignLevel.length > 0) {
    try {
      const uniqueCampaignIds = [...new Set(campaignLevel.map((n) => n.campaignId))];
      const existingNegatives = /* @__PURE__ */ new Set();
      for (const cid of uniqueCampaignIds) {
        try {
          const existing = await syncService.client.listSpCampaignNegativeKeywords(String(cid));
          for (const e of existing) {
            const key = `${e.campaignId}:${(e.keywordText || "").toLowerCase()}:${normalizeMatchTypeForComparison(e.matchType)}`;
            existingNegatives.add(key);
          }
        } catch (listErr) {
          log38.warn(`[AmazonApiHelper] \u67E5\u8BE2campaign ${cid} \u5DF2\u6709\u5426\u5B9A\u8BCD\u5931\u8D25: ${listErr.message}`);
        }
      }
      const newCampaignNegatives = campaignLevel.filter((n) => {
        const key = `${n.campaignId}:${n.keywordText.toLowerCase()}:${normalizeMatchTypeForComparison(n.matchType)}`;
        return !existingNegatives.has(key);
      });
      const skippedCount = campaignLevel.length - newCampaignNegatives.length;
      if (skippedCount > 0) {
        log38.info(`[AmazonApiHelper] \u5E42\u7B49\u6027\u53BB\u91CD: \u8DF3\u8FC7${skippedCount}\u4E2A\u5DF2\u5B58\u5728\u7684campaign\u7EA7\u5426\u5B9A\u8BCD`);
        result.success += skippedCount;
      }
      if (newCampaignNegatives.length > 0) {
        const results = await withRetry(() => syncService.client.createSpCampaignNegativeKeywords(
          newCampaignNegatives.map((n) => ({
            campaignId: n.campaignId,
            keywordText: n.keywordText,
            matchType: n.matchType
          }))
        ), { label: "Campaign\u5426\u5B9A\u8BCD\u521B\u5EFA", accountId });
        for (let ri = 0; ri < results.length; ri++) {
          const r = results[ri];
          if (r.code === "SUCCESS" || r.code === "SUCCESS_DUPLICATE" || r.code === "SKIPPED_NON_SP" || r.keywordId) {
            result.success++;
            const idx = r.index !== void 0 ? r.index : ri;
            if (idx < newCampaignNegatives.length) {
              const neg = newCampaignNegatives[idx];
              const mapKey = `campaign:${neg.campaignId}:${neg.keywordText.toLowerCase()}`;
              if (r.keywordId) {
                result.keywordIdMap.set(mapKey, String(r.keywordId));
              }
              const dupTag = r.code === "SUCCESS_DUPLICATE" ? " (duplicate, \u5DF2\u5B58\u5728)" : "";
              log38.info(`[AmazonApiHelper] \u5426\u5B9A\u8BCD\u521B\u5EFA\u6210\u529F${dupTag}: "${neg.keywordText}" -> keywordId=${r.keywordId}`);
            }
          } else {
            result.failed++;
            const idx = r.index !== void 0 ? r.index : ri;
            const failedKeyword = idx < newCampaignNegatives.length ? newCampaignNegatives[idx].keywordText : "unknown";
            result.errors.push(`Campaign\u5426\u5B9A\u8BCD\u5931\u8D25[${failedKeyword}]: ${r.details}`);
          }
        }
      }
    } catch (error48) {
      const errMsg584 = error48.message || "";
      const errBody584 = error48.response?.data ? JSON.stringify(error48.response.data) : "";
      if (errMsg584.includes("parent program type") || errBody584.includes("parent program type") || errBody584.includes("PARENT_PROGRAM_TYPE")) {
        const failedCampaignIds = campaignLevel.map(n => n.campaignId).join(",");
        log38.warn(`[v584][fix24-P3v3-4.1c] Campaign否定词创建失败(非SP类型campaign): campaignIds=[${failedCampaignIds}], err=${errMsg584.substring(0, 100)}, 标记为跳过`);
        result.success += campaignLevel.length;
      } else {
        result.failed += campaignLevel.length;
        result.errors.push(`Campaign否定词批量创建失败: ${errMsg584}`);
      }
    }
  }
  if (adGroupLevel.length > 0) {
    try {
      const uniqueAdGroupIds = [...new Set(adGroupLevel.map((n) => n.adGroupId))];
      const existingNegatives = /* @__PURE__ */ new Set();
      for (const agId of uniqueAdGroupIds) {
        try {
          const existing = await syncService.client.listSpNegativeKeywords(agId);
          for (const e of existing) {
            const key = `${e.adGroupId}:${(e.keywordText || "").toLowerCase()}:${normalizeMatchTypeForComparison(e.matchType)}`;
            existingNegatives.add(key);
          }
        } catch (listErr) {
          log38.warn(`[AmazonApiHelper] \u67E5\u8BE2adGroup ${agId} \u5DF2\u6709\u5426\u5B9A\u8BCD\u5931\u8D25: ${listErr.message}`);
        }
      }
      const newAdGroupNegatives = adGroupLevel.filter((n) => {
        const key = `${n.adGroupId}:${n.keywordText.toLowerCase()}:${normalizeMatchTypeForComparison(n.matchType)}`;
        return !existingNegatives.has(key);
      });
      const skippedCount = adGroupLevel.length - newAdGroupNegatives.length;
      if (skippedCount > 0) {
        log38.info(`[AmazonApiHelper] \u5E42\u7B49\u6027\u53BB\u91CD: \u8DF3\u8FC7${skippedCount}\u4E2A\u5DF2\u5B58\u5728\u7684adGroup\u7EA7\u5426\u5B9A\u8BCD`);
        result.success += skippedCount;
      }
      if (newAdGroupNegatives.length > 0) {
        const results = await withRetry(() => syncService.client.createSpNegativeKeywords(
          // @ts-ignore
          newAdGroupNegatives.map((n) => ({
            adGroupId: n.adGroupId,
            campaignId: n.campaignId,
            keywordText: n.keywordText,
            matchType: n.matchType
          }))
        ), { label: "AdGroup\u5426\u5B9A\u8BCD\u521B\u5EFA", accountId });
        for (let ri = 0; ri < results.length; ri++) {
          const r = results[ri];
          if (r.code === "SUCCESS" || r.code === "SUCCESS_DUPLICATE" || r.keywordId) {
            result.success++;
            const idx = r.index !== void 0 ? r.index : ri;
            if (idx < newAdGroupNegatives.length) {
              const neg = newAdGroupNegatives[idx];
              const mapKey = `adgroup:${neg.adGroupId}:${neg.keywordText.toLowerCase()}`;
              if (r.keywordId) {
                result.keywordIdMap.set(mapKey, String(r.keywordId));
              }
            }
          } else {
            result.failed++;
            result.errors.push(`AdGroup\u5426\u5B9A\u8BCD\u5931\u8D25: ${r.details}`);
          }
        }
      }
    } catch (error48) {
      result.failed += adGroupLevel.length;
      result.errors.push(`AdGroup\u5426\u5B9A\u8BCD\u6279\u91CF\u521B\u5EFA\u5931\u8D25: ${error48.message}`);
    }
  }
  log38.warn(`[AmazonApiHelper] \u5426\u5B9A\u8BCD\u540C\u6B65\u5B8C\u6210: \u6210\u529F=${result.success}, \u5931\u8D25=${result.failed}`);
  return result;
}
async function syncNegativeProductTargetsToAmazon(accountId, negatives) {
  const result = { success: 0, failed: 0, errors: [] };
  if (negatives.length === 0) return result;
  const syncService = await getAmazonSyncService2(accountId);
  if (!syncService) {
    result.errors.push(`\u65E0\u6CD5\u83B7\u53D6\u8D26\u53F7 ${accountId} \u7684API\u670D\u52A1`);
    result.failed = negatives.length;
    return result;
  }
  const spCampaignLevel = negatives.filter((n) => n.campaignType === "sp" && n.negativeScope === "campaign");
  const spAdGroupLevel = negatives.filter((n) => n.campaignType === "sp" && n.negativeScope === "ad_group");
  const sbAdGroupLevel = negatives.filter((n) => n.campaignType === "sb");
  const sdAdGroupLevel = negatives.filter((n) => n.campaignType === "sd");
  if (spCampaignLevel.length > 0) {
    try {
      const existingNegTargets = /* @__PURE__ */ new Set();
      const uniqueCampaignIds = [...new Set(spCampaignLevel.map((n) => n.campaignId))];
      for (const cid of uniqueCampaignIds) {
        try {
          const existing = await syncService.client.listSpCampaignNegativeTargets(cid);
          for (const e of existing) {
            const expr = e.expression || [];
            for (const ex of expr) {
              if (ex.type === "asinSameAs" && ex.value) {
                existingNegTargets.add(`${e.campaignId}:${ex.value}`);
              }
            }
          }
        } catch (_listErr) {
          log38.warn(`[AmazonApiHelper] v478: \u67E5\u8BE2campaign ${cid} \u5DF2\u6709\u5426\u5B9A\u4EA7\u54C1\u5B9A\u5411\u5931\u8D25`);
        }
      }
      const newSpCampaignLevel = spCampaignLevel.filter((n) => !existingNegTargets.has(`${n.campaignId}:${n.asin}`));
      const skippedCount = spCampaignLevel.length - newSpCampaignLevel.length;
      if (skippedCount > 0) {
        log38.info(`[AmazonApiHelper] v478: \u5E42\u7B49\u6027\u53BB\u91CD: \u8DF3\u8FC7${skippedCount}\u4E2A\u5DF2\u5B58\u5728\u7684campaign\u7EA7\u5426\u5B9A\u4EA7\u54C1\u5B9A\u5411`);
        result.success += skippedCount;
      }
      if (newSpCampaignLevel.length === 0) {
        log38.info(`[AmazonApiHelper] v478: \u6240\u6709SP Campaign\u5426\u5B9A\u4EA7\u54C1\u5B9A\u5411\u5DF2\u5B58\u5728\uFF0C\u8DF3\u8FC7`);
      } else {
        let apiResults;
        try {
          apiResults = await withRetry(() => syncService.client.createSpCampaignNegativeTargets(
            newSpCampaignLevel.map((n) => ({
              campaignId: n.campaignId,
              expression: [{ type: "asinSameAs", value: n.asin }],
              expressionType: "manual"
            }))
          ), { label: "SP Campaign\u5426\u5B9A\u4EA7\u54C1\u5B9A\u5411", accountId });
        } catch (negBatchErr) {
          const negErrBody = negBatchErr.response?.data || negBatchErr.message;
          log38.error(`[v580] SP Campaign\u5426\u5B9A\u4EA7\u54C1\u6279\u91CF\u521B\u5EFA\u5931\u8D25: status=${negBatchErr.response?.status}, detail=${JSON.stringify(negErrBody).slice(0, 500)}`);
          result.failed += newSpCampaignLevel.length;
          result.errors.push(`SP Campaign\u5426\u5B9A\u4EA7\u54C1\u6279\u91CF\u5931\u8D25(${newSpCampaignLevel.length}\u4E2A): ${JSON.stringify(negErrBody).slice(0, 200)}`);
          apiResults = [];
        }
        for (const r of apiResults) {
          if (r.code === "SUCCESS" || r.targetId) {
            result.success++;
          } else {
            const errDetail = JSON.stringify(r).toLowerCase();
            if (errDetail.includes("duplicate") || errDetail.includes("already exists")) {
              result.success++;
              log38.info(`[AmazonApiHelper] v579: SP Campaign\u5426\u5B9A\u4EA7\u54C1\u5B9A\u5411\u5DF2\u5B58\u5728(DUPLICATE_VALUE)\uFF0C\u89C6\u4E3A\u6210\u529F`);
            } else {
              const errDetail584 = (r.details || JSON.stringify(r) || "unknown").toLowerCase();
              if (errDetail584.includes("parent_entity") || errDetail584.includes("parent entity") || errDetail584.includes("does not target these marketplace")) {
                result.success++;
                log38.warn(`[v584] SP Campaign否定产品定向跳过(跨站点campaign): ${r.details || "PARENT_ENTITY_ERROR"}`);
              } else {
                result.failed++;
                result.errors.push(`SP Campaign否定产品失败: ${r.details || "unknown"}`);
              }
            }
          }
        }
      }
    } catch (err) {
      result.failed += spCampaignLevel.length;
      result.errors.push(`SP Campaign\u5426\u5B9A\u4EA7\u54C1\u6279\u91CF\u5931\u8D25: ${err.message}`);
    }
  }
  if (spAdGroupLevel.length > 0) {
    const validSpAdGroup = spAdGroupLevel.filter((n) => {
      if (!n.adGroupId) {
        log38.warn(`[AmazonApiHelper] v601: \u8DF3\u8FC7\u7F3A\u5C11adGroupId\u7684SP AdGroup\u5426\u5B9A\u4EA7\u54C1\u5B9A\u5411 (campaign=${n.campaignId}, asin=${n.asin})`);
        result.failed++;
        result.errors.push(`SP AdGroup\u5426\u5B9A\u4EA7\u54C1\u5931\u8D25: \u7F3A\u5C11adGroupId (campaign=${n.campaignId}, asin=${n.asin})`);
        return false;
      }
      return true;
    });
    if (validSpAdGroup.length === 0) {
      log38.warn(`[AmazonApiHelper] v601: \u6240\u6709SP AdGroup\u5426\u5B9A\u4EA7\u54C1\u5B9A\u5411\u5747\u7F3A\u5C11adGroupId\uFF0C\u8DF3\u8FC7`);
    } else {
      try {
        log38.info(`[AmazonApiHelper] v601: \u53D1\u9001${validSpAdGroup.length}\u4E2ASP AdGroup\u5426\u5B9A\u4EA7\u54C1\u5B9A\u5411\u8BF7\u6C42: ${JSON.stringify(validSpAdGroup.map((n) => ({ cid: n.campaignId, agid: n.adGroupId, asin: n.asin })))}`);
        const apiResults = await withRetry(() => syncService.client.createSpNegativeTargets(
          validSpAdGroup.map((n) => ({
            campaignId: n.campaignId,
            adGroupId: n.adGroupId || "",
            expression: [{ type: "ASIN_SAME_AS", value: n.asin }],
            expressionType: "manual"
          }))
        ), { label: "SP AdGroup\u5426\u5B9A\u4EA7\u54C1\u5B9A\u5411", accountId });
        for (const r of apiResults) {
          if (r.code === "SUCCESS" || r.targetId) {
            result.success++;
          } else {
            const errDetail = JSON.stringify(r).toLowerCase();
            if (errDetail.includes("duplicate") || errDetail.includes("already exists")) {
              result.success++;
              log38.info(`[AmazonApiHelper] v579: SP AdGroup\u5426\u5B9A\u4EA7\u54C1\u5B9A\u5411\u5DF2\u5B58\u5728(DUPLICATE_VALUE)\uFF0C\u89C6\u4E3A\u6210\u529F`);
            } else {
              result.failed++;
              result.errors.push(`SP AdGroup\u5426\u5B9A\u4EA7\u54C1\u5931\u8D25: ${r.details || "unknown"}`);
            }
          }
        }
      } catch (err) {
        result.failed += validSpAdGroup.length;
        result.errors.push(`SP AdGroup\u5426\u5B9A\u4EA7\u54C1\u6279\u91CF\u5931\u8D25: ${err.message}`);
      }
    }
  }
  if (sbAdGroupLevel.length > 0) {
    try {
      const apiResults = await syncService.client.createSbNegativeTargets(
        sbAdGroupLevel.map((n) => ({
          campaignId: n.campaignId,
          adGroupId: n.adGroupId || "",
          expression: [{ type: "ASIN_SAME_AS", value: n.asin }]
        }))
      );
      result.success += apiResults.length;
      log38.info(`[AmazonApiHelper] v2: SB\u5426\u5B9A\u4EA7\u54C1\u5B9A\u5411\u540C\u6B65\u6210\u529F: ${apiResults.length}\u4E2A`);
    } catch (err) {
      result.failed += sbAdGroupLevel.length;
      result.errors.push(`SB\u5426\u5B9A\u4EA7\u54C1\u6279\u91CF\u5931\u8D25: ${err.message}`);
    }
  }
  if (sdAdGroupLevel.length > 0) {
    try {
      const apiResults = await syncService.client.createSdNegativeTargets(
        sdAdGroupLevel.map((n) => ({
          adGroupId: n.adGroupId || "",
          expression: [{ type: "ASIN_SAME_AS", value: n.asin }]
        }))
      );
      result.success += apiResults.length;
      log38.info(`[AmazonApiHelper] v2: SD\u5426\u5B9A\u4EA7\u54C1\u5B9A\u5411\u540C\u6B65\u6210\u529F: ${apiResults.length}\u4E2A`);
    } catch (err) {
      result.failed += sdAdGroupLevel.length;
      result.errors.push(`SD\u5426\u5B9A\u4EA7\u54C1\u6279\u91CF\u5931\u8D25: ${err.message}`);
    }
  }
  log38.warn(`[AmazonApiHelper] v2: \u5426\u5B9A\u4EA7\u54C1\u5B9A\u5411\u540C\u6B65\u5B8C\u6210: \u6210\u529F=${result.success}, \u5931\u8D25=${result.failed}`);
  return result;
}
async function syncKeywordStatusToAmazon(accountId, statusChanges) {
  const result = { success: 0, failed: 0, errors: [] };
  if (statusChanges.length === 0) return result;
  log38.info(`[AmazonApiHelper] \u5F00\u59CB\u540C\u6B65\u5173\u952E\u8BCD\u72B6\u6001\u53D8\u66F4: accountId=${accountId}, \u603B\u8BA1=${statusChanges.length}\u6761`);
  const syncService = await getAmazonSyncService2(accountId);
  if (!syncService) {
    const errorMsg = `\u65E0\u6CD5\u83B7\u53D6\u8D26\u53F7 ${accountId} \u7684API\u670D\u52A1\uFF08\u51ED\u8BC1\u7F3A\u5931\u6216\u65E0\u6548\uFF09`;
    log38.warn(`[AmazonApiHelper] ${errorMsg}`);
    result.errors.push(errorMsg);
    result.failed = statusChanges.length;
    return result;
  }
  const delay2 = /* @__PURE__ */ __name((ms) => new Promise((resolve) => setTimeout(resolve, ms)), "delay");
  const keywordChanges = statusChanges.filter((s) => !s.isProductTarget);
  const productTargetChanges = statusChanges.filter((s) => s.isProductTarget);
  if (keywordChanges.length > 0) {
    log38.info(`[AmazonApiHelper] v199: \u6279\u91CF\u5904\u7406 ${keywordChanges.length} \u4E2A\u5173\u952E\u8BCD\u72B6\u6001\u53D8\u66F4`);
    const dbInstance = await getDb();
    const resolvedKeywordUpdates = [];
    if (dbInstance) {
      const { keywords: keywords10 } = await Promise.resolve().then(() => (init_schema2(), schema_exports));
      const { eq: eq12 } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
      for (const change of keywordChanges) {
        let [kw] = await dbInstance.select({ keywordId: keywords10.keywordId }).from(keywords10).where(eq12(keywords10.id, change.keywordId)).limit(1);
        if (!kw || !kw.keywordId || kw.keywordId === "0" || kw.keywordId === "") {
          try {
            const { resolveKeywordId: resolveKeywordId2 } = await Promise.resolve().then(() => (init_entityIdResolver(), entityIdResolver_exports));
            const resolved = await resolveKeywordId2(change.keywordId);
            if (resolved && resolved.amazonId) {
              kw = { keywordId: resolved.amazonId };
            }
          } catch (_) {
          }
          if (!kw || !kw.keywordId || kw.keywordId === "0" || kw.keywordId === "") {
            try {
              const { resolveKeywordIdOnDemand: resolveKeywordIdOnDemand2 } = await Promise.resolve().then(() => (init_amazonIdResolver(), amazonIdResolver_exports));
              const resolvedId = await resolveKeywordIdOnDemand2(accountId, change.keywordId);
              if (resolvedId) {
                kw = { keywordId: resolvedId };
              }
            } catch (resolveErr) {
              log38.warn(`[AmazonApiHelper] v429: \u5373\u65F6\u56DE\u586B\u5F02\u5E38: ${resolveErr.message}`);
            }
          }
          if (!kw || !kw.keywordId || kw.keywordId === "0" || kw.keywordId === "") {
            result.failed++;
            result.errors.push(`\u5173\u952E\u8BCD ${change.keywordId} \u7F3A\u5C11Amazon keywordId`);
            continue;
          }
        }
        resolvedKeywordUpdates.push({
          keywordId: String(kw.keywordId),
          state: change.newStatus
        });
      }
    } else {
      result.failed += keywordChanges.length;
      result.errors.push("\u6570\u636E\u5E93\u8FDE\u63A5\u5931\u8D25");
    }
    if (resolvedKeywordUpdates.length > 0) {
      try {
        log38.info(`[AmazonApiHelper] v199: \u6279\u91CF\u53D1\u9001 ${resolvedKeywordUpdates.length} \u4E2A\u5173\u952E\u8BCD\u72B6\u6001\u66F4\u65B0\u5230Amazon`);
        const apiResult = await withRetry(
          // @ts-ignore
          () => syncService.client.updateKeywordStatus(resolvedKeywordUpdates),
          { maxRetries: 2, baseDelayMs: 2e3, label: `batchUpdateKeywordStatus-${resolvedKeywordUpdates.length}`, accountId }
          // @ts-ignore
        );
        result.success += apiResult.successCount;
        if (apiResult.errors.length > 0) {
          result.failed += apiResult.errors.length;
          for (const err of apiResult.errors) {
            result.errors.push(`\u5173\u952E\u8BCD ${err.keywordId} \u72B6\u6001\u66F4\u65B0\u5931\u8D25: ${err.details || err.code}`);
          }
        }
        log38.warn(`[AmazonApiHelper] v199: \u5173\u952E\u8BCD\u72B6\u6001\u6279\u91CF\u66F4\u65B0\u5B8C\u6210: \u6210\u529F=${apiResult.successCount}, \u5931\u8D25=${apiResult.errors.length}`);
      } catch (batchErr) {
        log38.warn(`[AmazonApiHelper] v199: \u5173\u952E\u8BCD\u72B6\u6001\u6279\u91CF\u66F4\u65B0\u5F02\u5E38: ${batchErr.message}`);
        result.failed += resolvedKeywordUpdates.length;
        result.errors.push(`\u5173\u952E\u8BCD\u72B6\u6001\u6279\u91CF\u66F4\u65B0\u5F02\u5E38: ${batchErr.message}`);
      }
    }
  }
  if (productTargetChanges.length > 0) {
    log38.info(`[AmazonApiHelper] v199: \u6279\u91CF\u5904\u7406 ${productTargetChanges.length} \u4E2A\u5546\u54C1\u5B9A\u5411\u72B6\u6001\u53D8\u66F4`);
    const ptDbInstance = await getDb();
    const resolvedTargetUpdates = [];
    if (ptDbInstance) {
      const { productTargets: productTargets5 } = await Promise.resolve().then(() => (init_schema2(), schema_exports));
      const { eq: eq12 } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
      for (const change of productTargetChanges) {
        const [pt] = await ptDbInstance.select({ targetId: productTargets5.targetId }).from(productTargets5).where(eq12(productTargets5.id, change.keywordId)).limit(1);
        let resolvedTargetId = pt?.targetId && pt.targetId !== "0" && pt.targetId !== "" ? String(pt.targetId) : null;
        if (!resolvedTargetId) {
          try {
            const { resolveProductTargetId: resolveProductTargetId2 } = await Promise.resolve().then(() => (init_entityIdResolver(), entityIdResolver_exports));
            const resolved = await resolveProductTargetId2(change.keywordId);
            if (resolved && resolved.amazonId) {
              resolvedTargetId = resolved.amazonId;
            }
          } catch (_) {
          }
        }
        if (!resolvedTargetId) {
          try {
            const { resolveProductTargetIdOnDemand: resolveProductTargetIdOnDemand2 } = await Promise.resolve().then(() => (init_amazonIdResolver(), amazonIdResolver_exports));
            resolvedTargetId = await resolveProductTargetIdOnDemand2(accountId, change.keywordId);
          } catch (resolveErr) {
            log38.warn(`[AmazonApiHelper] v429: \u5546\u54C1\u5B9A\u5411\u5373\u65F6\u56DE\u586B\u5F02\u5E38: ${resolveErr.message}`);
          }
        }
        if (resolvedTargetId) {
          resolvedTargetUpdates.push({
            targetId: resolvedTargetId,
            state: change.newStatus
          });
        } else {
          result.failed++;
          result.errors.push(`\u5546\u54C1\u5B9A\u5411 ${change.keywordId} \u7F3A\u5C11Amazon targetId\u4E14\u56DE\u586B\u5931\u8D25`);
        }
      }
    } else {
      result.failed += productTargetChanges.length;
      result.errors.push("\u6570\u636E\u5E93\u8FDE\u63A5\u5931\u8D25");
    }
    if (resolvedTargetUpdates.length > 0) {
      try {
        log38.info(`[AmazonApiHelper] v199: \u6279\u91CF\u53D1\u9001 ${resolvedTargetUpdates.length} \u4E2A\u5546\u54C1\u5B9A\u5411\u72B6\u6001\u66F4\u65B0\u5230Amazon`);
        const apiResult = await withRetry(
          // @ts-ignore
          () => syncService.client.updateProductTargetStatus(resolvedTargetUpdates),
          { maxRetries: 2, baseDelayMs: 2e3, label: `batchUpdateProductTargetStatus-${resolvedTargetUpdates.length}`, accountId }
        );
        result.success += apiResult.successCount;
        if (apiResult.errors.length > 0) {
          result.failed += apiResult.errors.length;
          for (const err of apiResult.errors) {
            result.errors.push(`\u5546\u54C1\u5B9A\u5411 ${err.targetId} \u72B6\u6001\u66F4\u65B0\u5931\u8D25: ${err.details || err.code}`);
          }
        }
        log38.warn(`[AmazonApiHelper] v199: \u5546\u54C1\u5B9A\u5411\u72B6\u6001\u6279\u91CF\u66F4\u65B0\u5B8C\u6210: \u6210\u529F=${apiResult.successCount}, \u5931\u8D25=${apiResult.errors.length}`);
      } catch (batchErr) {
        log38.warn(`[AmazonApiHelper] v199: \u5546\u54C1\u5B9A\u5411\u72B6\u6001\u6279\u91CF\u66F4\u65B0\u5F02\u5E38: ${batchErr.message}`);
        result.failed += resolvedTargetUpdates.length;
        result.errors.push(`\u5546\u54C1\u5B9A\u5411\u72B6\u6001\u6279\u91CF\u66F4\u65B0\u5F02\u5E38: ${batchErr.message}`);
      }
    }
  }
  log38.warn(`[AmazonApiHelper] \u5173\u952E\u8BCD\u72B6\u6001\u540C\u6B65\u5B8C\u6210: \u6210\u529F=${result.success}, \u5931\u8D25=${result.failed}`);
  return result;
}
async function syncCampaignStatusToAmazon(accountId, statusChanges) {
  const result = { success: 0, failed: 0, errors: [] };
  if (statusChanges.length === 0) return result;
  log38.info(`[AmazonApiHelper] v359: \u5F00\u59CB\u6279\u91CF\u540C\u6B65\u5E7F\u544A\u6D3B\u52A8\u72B6\u6001\u53D8\u66F4: accountId=${accountId}, \u603B\u8BA1=${statusChanges.length}\u6761`);
  const syncService = await getAmazonSyncService2(accountId);
  if (!syncService) {
    const errorMsg = `\u65E0\u6CD5\u83B7\u53D6\u8D26\u53F7 ${accountId} \u7684API\u670D\u52A1\uFF08\u51ED\u8BC1\u7F3A\u5931\u6216\u65E0\u6548\uFF09`;
    log38.warn(`[AmazonApiHelper] ${errorMsg}`);
    result.errors.push(errorMsg);
    result.failed = statusChanges.length;
    return result;
  }
  const validChanges = [];
  for (const change of statusChanges) {
    if (!change.amazonCampaignId || change.amazonCampaignId === "0" || change.amazonCampaignId === "") {
      result.failed++;
      result.errors.push(`\u5E7F\u544A\u6D3B\u52A8 "${change.campaignName}" \u7F3A\u5C11Amazon Campaign ID\uFF0C\u65E0\u6CD5\u540C\u6B65\u72B6\u6001`);
    } else {
      validChanges.push(change);
    }
  }
  const CONCURRENCY = 5;
  async function processCampaignUpdate(change) {
    const campaignType = (change.campaignType || "sp_manual").toLowerCase();
    try {
      await withRetry(async () => {
        if (campaignType === "sb") {
          await syncService.client.updateSbCampaign(change.amazonCampaignId, { state: change.newStatus.toUpperCase() });
        } else if (campaignType === "sd") {
          await syncService.client.updateSdCampaign(String(change.amazonCampaignId), { state: change.newStatus.toUpperCase() });
        } else {
          await syncService.client.updateSpCampaign(change.amazonCampaignId, { state: change.newStatus.toUpperCase() });
        }
      }, { maxRetries: 2, baseDelayMs: 2e3, label: `campaignStatus-${change.amazonCampaignId}`, accountId });
      log38.info(`[AmazonApiHelper] \u2705 \u5E7F\u544A\u6D3B\u52A8\u72B6\u6001\u66F4\u65B0\u6210\u529F: "${change.campaignName}" (${campaignType}) -> ${change.newStatus}`);
      return { success: true };
    } catch (error48) {
      const errorMsg = `\u5E7F\u544A\u6D3B\u52A8 "${change.campaignName}" (${change.amazonCampaignId}, ${campaignType}) \u72B6\u6001\u540C\u6B65\u5931\u8D25: ${error48.message}`;
      log38.warn(`[AmazonApiHelper] \u274C ${errorMsg}`);
      try {
        const dbInstance = await getDb();
        if (dbInstance) {
          const { sql: sql15 } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
          await dbInstance.execute(sql15`
 INSERT INTO sync_failures (entity_type, entity_id, amazon_id, operation, error_message, account_id, created_at) 
 VALUES ('campaign', ${change.campaignId || 0}, ${change.amazonCampaignId}, ${"status_change_" + change.newStatus}, ${(error48.message || "").substring(0, 1e3)}, ${accountId}, NOW())
 `);
        }
      } catch (logError) {
        log38.warn(`[AmazonApiHelper] \u65E0\u6CD5\u8BB0\u5F55\u540C\u6B65\u5931\u8D25\u65E5\u5FD7: ${logError.message}`);
      }
      return { success: false, error: errorMsg };
    }
  }
  __name(processCampaignUpdate, "processCampaignUpdate");
  for (let i = 0; i < validChanges.length; i += CONCURRENCY) {
    const batch = validChanges.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.allSettled(batch.map((c) => processCampaignUpdate(c)));
    for (const br of batchResults) {
      if (br.status === "fulfilled" && br.value.success) {
        result.success++;
      } else {
        result.failed++;
        const errMsg = br.status === "fulfilled" ? br.value.error : br.reason.message;
        if (errMsg) result.errors.push(errMsg);
      }
    }
    if (i + CONCURRENCY < validChanges.length) {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  log38.warn(`[AmazonApiHelper] v359: \u5E7F\u544A\u6D3B\u52A8\u72B6\u6001\u540C\u6B65\u5B8C\u6210: \u6210\u529F=${result.success}, \u5931\u8D25=${result.failed}`);
  return result;
}
async function syncAdGroupStatusToAmazon(accountId, statusChanges) {
  const result = { success: 0, failed: 0, errors: [] };
  if (statusChanges.length === 0) return result;
  log38.info(`[AmazonApiHelper] v359: \u5F00\u59CB\u6279\u91CF\u540C\u6B65\u5E7F\u544A\u7EC4\u72B6\u6001\u53D8\u66F4: accountId=${accountId}, \u603B\u8BA1=${statusChanges.length}\u6761`);
  const syncService = await getAmazonSyncService2(accountId);
  if (!syncService) {
    const errorMsg = `\u65E0\u6CD5\u83B7\u53D6\u8D26\u53F7 ${accountId} \u7684API\u670D\u52A1\uFF08\u51ED\u8BC1\u7F3A\u5931\u6216\u65E0\u6548\uFF09`;
    log38.warn(`[AmazonApiHelper] ${errorMsg}`);
    result.errors.push(errorMsg);
    result.failed = statusChanges.length;
    return result;
  }
  const validChanges = statusChanges.filter((c) => c.amazonAdGroupId && c.amazonAdGroupId !== "0" && c.amazonAdGroupId !== "");
  const invalidChanges = statusChanges.filter((c) => !c.amazonAdGroupId || c.amazonAdGroupId === "0" || c.amazonAdGroupId === "");
  for (const invalid of invalidChanges) {
    result.failed++;
    result.errors.push(`\u5E7F\u544A\u7EC4 "${invalid.adGroupName}" \u7F3A\u5C11Amazon AdGroup ID\uFF0C\u65E0\u6CD5\u540C\u6B65\u72B6\u6001`);
  }
  const spChanges = validChanges.filter((c) => {
    const ct = (c.campaignType || "").toLowerCase();
    return ct !== "sd" && ct !== "sponsoreddisplay";
  });
  const sdChanges = validChanges.filter((c) => {
    const ct = (c.campaignType || "").toLowerCase();
    return ct === "sd" || ct === "sponsoreddisplay";
  });
  if (spChanges.length > 0) {
    log38.info(`[AmazonApiHelper] v359: \u6279\u91CF\u53D1\u9001 ${spChanges.length} \u4E2ASP\u5E7F\u544A\u7EC4\u72B6\u6001\u66F4\u65B0`);
    try {
      const apiResult = await withRetry(
        // @ts-ignore
        () => syncService.client.updateSpAdGroupStatus(
          spChanges.map((c) => ({ adGroupId: c.amazonAdGroupId, state: c.newStatus }))
        ),
        { maxRetries: 2, baseDelayMs: 2e3, label: `batchUpdateSpAdGroupStatus-${spChanges.length}`, accountId }
      );
      result.success += apiResult.successCount || 0;
      if (apiResult.errors && apiResult.errors.length > 0) {
        result.failed += apiResult.errors.length;
        for (const err of apiResult.errors) {
          result.errors.push(`SP\u5E7F\u544A\u7EC4 ${err.adGroupId}: ${err.details || err.code || "unknown"}`);
        }
      }
      if (apiResult.successCount === void 0) {
        result.success += spChanges.length - (apiResult.errors?.length || 0);
      }
      log38.info(`[AmazonApiHelper] v359: SP\u5E7F\u544A\u7EC4\u72B6\u6001\u6279\u91CF\u66F4\u65B0\u5B8C\u6210`);
    } catch (batchErr) {
      log38.warn(`[AmazonApiHelper] v359: SP\u5E7F\u544A\u7EC4\u72B6\u6001\u6279\u91CF\u66F4\u65B0\u5F02\u5E38: ${batchErr.message}`);
      result.failed += spChanges.length;
      result.errors.push(`SP\u5E7F\u544A\u7EC4\u72B6\u6001\u6279\u91CF\u66F4\u65B0\u5F02\u5E38: ${batchErr.message}`);
    }
  }
  if (sdChanges.length > 0) {
    log38.info(`[AmazonApiHelper] v359: \u6279\u91CF\u53D1\u9001 ${sdChanges.length} \u4E2ASD\u5E7F\u544A\u7EC4\u72B6\u6001\u66F4\u65B0`);
    try {
      const apiResult = await withRetry(
        // @ts-ignore
        () => syncService.client.updateSdAdGroupStatus(
          sdChanges.map((c) => ({ adGroupId: c.amazonAdGroupId, state: c.newStatus }))
        ),
        { maxRetries: 2, baseDelayMs: 2e3, label: `batchUpdateSdAdGroupStatus-${sdChanges.length}`, accountId }
      );
      result.success += apiResult.successCount || 0;
      if (apiResult.errors && apiResult.errors.length > 0) {
        result.failed += apiResult.errors.length;
        for (const err of apiResult.errors) {
          result.errors.push(`SD\u5E7F\u544A\u7EC4 ${err.adGroupId}: ${err.details || err.code || "unknown"}`);
        }
      }
      if (apiResult.successCount === void 0) {
        result.success += sdChanges.length - (apiResult.errors?.length || 0);
      }
      log38.info(`[AmazonApiHelper] v359: SD\u5E7F\u544A\u7EC4\u72B6\u6001\u6279\u91CF\u66F4\u65B0\u5B8C\u6210`);
    } catch (batchErr) {
      log38.warn(`[AmazonApiHelper] v359: SD\u5E7F\u544A\u7EC4\u72B6\u6001\u6279\u91CF\u66F4\u65B0\u5F02\u5E38: ${batchErr.message}`);
      result.failed += sdChanges.length;
      result.errors.push(`SD\u5E7F\u544A\u7EC4\u72B6\u6001\u6279\u91CF\u66F4\u65B0\u5F02\u5E38: ${batchErr.message}`);
    }
  }
  log38.warn(`[AmazonApiHelper] v359: \u5E7F\u544A\u7EC4\u72B6\u6001\u540C\u6B65\u5B8C\u6210: \u6210\u529F=${result.success}, \u5931\u8D25=${result.failed}`);
  return result;
}
var log38;
var init_amazonApiHelper = __esm({
  "server/services/amazonApiHelper.ts"() {
    "use strict";
    init_db2();
    init_drizzle_orm();
    init_logger();
    init_apiRateLimitService();
    init_circuitBreakerService();
    init_adaptiveTimeoutService();
    init_syncServiceProvider();
    __name(getAmazonSyncService2, "getAmazonSyncService");
    log38 = createModuleLogger("ApiHelper");
    __name(withRetry, "withRetry");
    __name(syncBidAdjustmentsToAmazon, "syncBidAdjustmentsToAmazon");
    __name(syncNewKeywordsToAmazon, "syncNewKeywordsToAmazon");
    __name(syncNewProductTargetsToAmazon, "syncNewProductTargetsToAmazon");
    __name(syncBudgetAdjustmentToAmazon, "syncBudgetAdjustmentToAmazon");
    __name(syncPlacementAdjustmentToAmazon, "syncPlacementAdjustmentToAmazon");
    __name(normalizeMatchTypeForComparison, "normalizeMatchTypeForComparison");
    __name(syncNegativeKeywordsToAmazon, "syncNegativeKeywordsToAmazon");
    __name(syncNegativeProductTargetsToAmazon, "syncNegativeProductTargetsToAmazon");
    __name(syncKeywordStatusToAmazon, "syncKeywordStatusToAmazon");
    __name(syncCampaignStatusToAmazon, "syncCampaignStatusToAmazon");
    __name(syncAdGroupStatusToAmazon, "syncAdGroupStatusToAmazon");
  }
});

