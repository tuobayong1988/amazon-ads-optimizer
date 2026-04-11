// Extracted from production dist/index.js
// Original module: server/optimization/postOptimizationVerifier.ts
// Lines: 788

function generateTaskId(accountId, type) {
  return `verify_${accountId}_${type}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
function scheduleBidVerification(accountId, adjustments) {
  if (adjustments.length === 0) return "";
  const items = adjustments.map((adj) => {
    let fieldName = adj.isProductTarget ? "product_target_bid" : "keyword_bid";
    if (adj.isSdAudience) {
      fieldName = "sd_audience_bid";
    }
    const campType = (adj.campaignType || "").toLowerCase();
    if (campType.includes("sb") && !adj.isSdAudience) {
      fieldName = adj.isProductTarget ? "sb_product_target_bid" : "sb_keyword_bid";
    } else if (campType.includes("sd") && !adj.isSdAudience) {
      fieldName = adj.isProductTarget ? "sd_product_target_bid" : "sd_keyword_bid";
    }
    return {
      type: "bid_adjustment",
      localId: adj.localKeywordId,
      amazonId: adj.amazonKeywordId,
      expectedValue: adj.expectedBid,
      context: {
        campaignId: adj.campaignId,
        adGroupId: adj.adGroupId,
        accountId,
        fieldName
      }
    };
  });
  return scheduleVerificationTask(accountId, items);
}
function scheduleBudgetVerification(accountId, adjustments) {
  if (adjustments.length === 0) return "";
  const items = adjustments.map((adj) => ({
    type: "budget_adjustment",
    localId: adj.localCampaignId,
    amazonId: adj.amazonCampaignId,
    expectedValue: adj.expectedBudget,
    context: { accountId }
  }));
  return scheduleVerificationTask(accountId, items);
}
function schedulePlacementVerification(accountId, adjustments) {
  if (adjustments.length === 0) return "";
  const items = adjustments.map((adj) => ({
    type: "placement_adjustment",
    localId: adj.localCampaignId,
    amazonId: adj.amazonCampaignId,
    expectedValue: {
      topOfSearch: adj.expectedTopOfSearch,
      productPage: adj.expectedProductPage
    },
    context: { accountId }
  }));
  return scheduleVerificationTask(accountId, items);
}
function scheduleNegativeKeywordVerification(accountId, negativeKeywords8) {
  if (negativeKeywords8.length === 0) return "";
  const items = negativeKeywords8.map((nk) => ({
    type: "negative_keyword",
    localId: nk.localId,
    amazonId: nk.amazonKeywordId || "",
    expectedValue: { keywordText: nk.keywordText, matchType: nk.matchType },
    context: {
      campaignId: nk.campaignId,
      adGroupId: nk.internal_ad_group_id,
      accountId
    }
  }));
  return scheduleVerificationTask(accountId, items);
}
function scheduleKeywordStatusVerification(accountId, changes) {
  if (changes.length === 0) return "";
  const items = changes.map((ch) => ({
    type: "keyword_status",
    localId: ch.localKeywordId,
    amazonId: ch.amazonKeywordId,
    expectedValue: ch.expectedState,
    context: {
      adGroupId: ch.adGroupId,
      accountId
    }
  }));
  return scheduleVerificationTask(accountId, items);
}
function scheduleVerificationTask(accountId, items) {
  const taskId = generateTaskId(accountId, items[0]?.type || "mixed");
  const task = {
    id: taskId,
    accountId,
    items,
    createdAt: /* @__PURE__ */ new Date(),
    attempt: 1,
    maxAttempts: 3,
    scheduledAt: new Date(Date.now() + VERIFICATION_DELAYS.firstAttempt * 1e3)
  };
  pendingTasks.set(taskId, task);
  const timer = setTimeout(async () => {
    await executeVerificationTask(taskId);
  }, VERIFICATION_DELAYS.firstAttempt * 1e3);
  activeTimers.set(taskId, timer);
  log51.info(`v166: \u9A8C\u8BC1\u4EFB\u52A1\u5DF2\u6CE8\u518C taskId=${taskId}, accountId=${accountId}, items=${items.length}, \u7C7B\u578B=${items[0]?.type}, \u9996\u6B21\u9A8C\u8BC1\u5C06\u5728${VERIFICATION_DELAYS.firstAttempt}\u79D2\u540E\u6267\u884C`);
  return taskId;
}
async function executeVerificationTask(taskId) {
  const task = pendingTasks.get(taskId);
  if (!task) {
    log51.warn(`\u4EFB\u52A1 ${taskId} \u4E0D\u5B58\u5728\uFF0C\u53EF\u80FD\u5DF2\u88AB\u53D6\u6D88`);
    return;
  }
  log51.info(`v166: \u5F00\u59CB\u6267\u884C\u9A8C\u8BC1\u4EFB\u52A1 taskId=${taskId}, attempt=${task.attempt}/${task.maxAttempts}, items=${task.items.length}`);
  try {
    const syncService = await getAmazonSyncService2(task.accountId);
    if (!syncService) {
      log51.warn(`\u65E0\u6CD5\u83B7\u53D6accountId=${task.accountId}\u7684API\u5BA2\u6237\u7AEF\uFF0C\u8DF3\u8FC7\u9A8C\u8BC1`);
      cleanupTask(taskId);
      return;
    }
    const resultsByType = /* @__PURE__ */ new Map();
    const itemsByType = groupItemsByType(task.items);
    for (const [type, items] of itemsByType.entries()) {
      const results = await verifyByType(syncService, type, items);
      resultsByType.set(type, results);
    }
    const allResults = Array.from(resultsByType.values()).flat();
    const confirmed = allResults.filter((r) => r.status === "confirmed");
    const conflicts = allResults.filter((r) => r.status === "conflict");
    const notFound = allResults.filter((r) => r.status === "not_found");
    const errors = allResults.filter((r) => r.status === "error");
    log51.warn(`v166: \u9A8C\u8BC1\u7ED3\u679C taskId=${taskId} \u2014 \u786E\u8BA4=${confirmed.length}, \u51B2\u7A81=${conflicts.length}, \u672A\u627E\u5230=${notFound.length}, \u9519\u8BEF=${errors.length}`);
    if (confirmed.length > 0) {
      await applyConfirmedResults(confirmed);
    }
    if (conflicts.length > 0) {
      await handleConflicts(conflicts);
    }
    const unresolved = [...notFound, ...errors];
    if (unresolved.length > 0 && task.attempt < task.maxAttempts) {
      task.attempt++;
      task.items = unresolved.map((r) => r.item);
      const delayKey = task.attempt === 2 ? "secondAttempt" : "thirdAttempt";
      const delay2 = VERIFICATION_DELAYS[delayKey];
      task.scheduledAt = new Date(Date.now() + delay2 * 1e3);
      const timer = setTimeout(async () => {
        await executeVerificationTask(taskId);
      }, delay2 * 1e3);
      activeTimers.set(taskId, timer);
      log51.info(`v166: ${unresolved.length}\u9879\u672A\u89E3\u51B3\uFF0C\u5B89\u6392\u7B2C${task.attempt}\u8F6E\u9A8C\u8BC1\uFF0C${delay2}\u79D2\u540E\u6267\u884C`);
    } else {
      if (unresolved.length > 0) {
        log51.warn(`v166: ${unresolved.length}\u9879\u5728${task.maxAttempts}\u8F6E\u9A8C\u8BC1\u540E\u4ECD\u672A\u89E3\u51B3\uFF0C\u4FDD\u6301pending_confirmation\u72B6\u6001\u7B49\u5F85\u5B9A\u65F6\u540C\u6B65`);
      }
      cleanupTask(taskId);
    }
  } catch (error48) {
    log51.warn(`v166: \u9A8C\u8BC1\u4EFB\u52A1\u6267\u884C\u5F02\u5E38 taskId=${taskId}:`, error48.message);
    if (task.attempt < task.maxAttempts) {
      task.attempt++;
      const delay2 = VERIFICATION_DELAYS.thirdAttempt;
      const timer = setTimeout(async () => {
        await executeVerificationTask(taskId);
      }, delay2 * 1e3);
      activeTimers.set(taskId, timer);
    } else {
      cleanupTask(taskId);
    }
  }
}
function groupItemsByType(items) {
  const grouped = /* @__PURE__ */ new Map();
  for (const item of items) {
    const existing = grouped.get(item.type) || [];
    existing.push(item);
    grouped.set(item.type, existing);
  }
  return grouped;
}
async function verifyByType(syncService, type, items) {
  switch (type) {
    case "bid_adjustment":
      return verifyBidAdjustments(syncService, items);
    case "budget_adjustment":
      return verifyBudgetAdjustments(syncService, items);
    case "placement_adjustment":
      return verifyPlacementAdjustments(syncService, items);
    case "negative_keyword":
      return verifyNegativeKeywords(syncService, items);
    case "keyword_status":
      return verifyKeywordStatus(syncService, items);
    case "search_term_migration":
      return verifyBidAdjustments(syncService, items);
    // 搜索词迁移后的新关键词也通过bid验证
    default:
      log51.warn(`\u672A\u77E5\u9A8C\u8BC1\u7C7B\u578B: ${type}`);
      return items.map((item) => ({ item, status: "error", message: `\u672A\u77E5\u7C7B\u578B: ${type}` }));
  }
}
async function verifyBidAdjustments(syncService, items) {
  const results = [];
  const db = await getDb();
  const validItems = [];
  if (db) {
    for (const item of items) {
      try {
        const [rows] = await db.execute(sql.raw(
          `SELECT keywordStatus FROM keywords WHERE id = ${Number(item.localId)} LIMIT 1`
        ));
        const status = rows?.[0]?.keywordStatus || "";
        if (status === "amazon_deleted" || status === "amazon_archived") {
          results.push({ item, status: "confirmed", actualValue: null, message: `v580: \u5B9E\u4F53\u5DF2${status}\uFF0C\u8DF3\u8FC7\u9A8C\u8BC1` });
          continue;
        }
      } catch {
      }
      validItems.push(item);
    }
    log51.info(`[v580] PostOptVerifier: ${items.length}\u9879\u4E2D${items.length - validItems.length}\u9879\u5DF2\u5220\u9664/\u5F52\u6863\uFF0C\u8DF3\u8FC7\u9A8C\u8BC1\uFF0C\u5269\u4F59${validItems.length}\u9879\u5F85\u9A8C\u8BC1`);
  } else {
    validItems.push(...items);
  }
  const byFieldAndAdGroup = /* @__PURE__ */ new Map();
  for (const item of validItems) {
    const fieldName = item.context?.fieldName || "keyword_bid";
    let adGroupId = item.context?.adGroupId || 0;
    if (adGroupId === 0 && db) {
      try {
        const [rows] = await db.execute(sql.raw(
          `SELECT ag.adGroupId FROM keywords k JOIN ad_groups ag ON k.internal_ad_group_id = ag.id WHERE k.id = ${Number(item.localId)} LIMIT 1`
        ));
        const resolvedId = rows?.[0]?.adGroupId;
        if (resolvedId) {
          adGroupId = Number(resolvedId);
          if (item.context) item.context.adGroupId = adGroupId;
          log51.info(`[v580] PostOptVerifier: \u4E3A\u5173\u952E\u8BCD ${item.localId} \u89E3\u6790adGroupId=${adGroupId}`);
        }
      } catch {
      }
    }
    if (!byFieldAndAdGroup.has(fieldName)) {
      byFieldAndAdGroup.set(fieldName, /* @__PURE__ */ new Map());
    }
    const adGroupMap = byFieldAndAdGroup.get(fieldName);
    const existing = adGroupMap.get(adGroupId) || [];
    existing.push(item);
    adGroupMap.set(adGroupId, existing);
  }
  for (const [fieldName, adGroupMap] of byFieldAndAdGroup.entries()) {
    for (const [adGroupId, groupItems] of adGroupMap.entries()) {
      try {
        let amazonItems;
        let idField = "keywordId";
        switch (fieldName) {
          // @ts-ignore
          case "keyword_bid":
            amazonItems = await syncService.client.listSpKeywords(adGroupId || void 0);
            idField = "keywordId";
            break;
          case "product_target_bid":
            amazonItems = await syncService.client.listSpProductTargets(adGroupId || void 0);
            idField = "targetId";
            break;
          case "sb_keyword_bid":
            try {
              amazonItems = await syncService.client.listSbKeywords(adGroupId ? String(adGroupId) : void 0);
              idField = "keywordId";
            } catch (sbErr) {
              log51.warn(`[v512] SB\u5173\u952E\u8BCD\u9A8C\u8BC1API\u8C03\u7528\u5931\u8D25(403\u53EF\u80FD\u662F\u6B63\u5E38\u7684): ${sbErr.message}`);
              amazonItems = [];
            }
            break;
          case "sb_product_target_bid":
            try {
              amazonItems = await syncService.client.listSbTargets(adGroupId ? String(adGroupId) : void 0);
              idField = "targetId";
            } catch (sbErr) {
              log51.warn(`[v512] SB\u5546\u54C1\u5B9A\u5411\u9A8C\u8BC1API\u8C03\u7528\u5931\u8D25: ${sbErr.message}`);
              amazonItems = [];
            }
            break;
          case "sd_keyword_bid":
          case "sd_product_target_bid":
            try {
              amazonItems = await syncService.client.listSdTargets(adGroupId || void 0);
              idField = "targetId";
            } catch (sdErr) {
              log51.warn(`[v512] SD\u5B9A\u5411\u9A8C\u8BC1API\u8C03\u7528\u5931\u8D25: ${sdErr.message}`);
              amazonItems = [];
            }
            break;
          case "sd_audience_bid":
            try {
              amazonItems = await syncService.client.listSdTargets(adGroupId || void 0);
              idField = "targetId";
            } catch (sdErr) {
              log51.warn(`[v512] SD\u53D7\u4F17\u9A8C\u8BC1API\u8C03\u7528\u5931\u8D25: ${sdErr.message}`);
              amazonItems = [];
            }
            break;
          default:
            log51.warn(`[v512] \u672A\u77E5\u7684fieldName: ${fieldName}\uFF0C\u9ED8\u8BA4\u4F7F\u7528SP\u5173\u952E\u8BCDAPI`);
            amazonItems = await syncService.client.listSpKeywords(adGroupId || void 0);
            idField = "keywordId";
        }
        const amazonBidMap = /* @__PURE__ */ new Map();
        for (const apiItem of amazonItems || []) {
          const id = String(apiItem[idField]);
          const bid = typeof apiItem.bid === "object" && apiItem.bid !== null ? apiItem.bid.amount || 0 : apiItem.bid || 0;
          amazonBidMap.set(id, Number(bid));
        }
        for (const item of groupItems) {
          const actualBid = amazonBidMap.get(item.amazonId);
          if (actualBid === void 0) {
            let entityDeleted = false;
            if (db) {
              try {
                const [rows] = await db.execute(sql.raw(
                  `SELECT keywordStatus FROM keywords WHERE id = ${Number(item.localId)} LIMIT 1`
                ));
                const status = rows?.[0]?.keywordStatus || "";
                if (status === "amazon_deleted" || status === "amazon_archived" || status === "archived") {
                  entityDeleted = true;
                  results.push({ item, status: "confirmed", actualValue: null, message: `v580: \u5B9E\u4F53\u5DF2${status}\uFF0C\u89C6\u4E3A\u5DF2\u786E\u8BA4` });
                }
              } catch {
              }
            }
            if (!entityDeleted) {
              results.push({ item, status: "not_found", message: `Amazon\u4E2D\u672A\u627E\u5230ID=${item.amazonId} (${fieldName})` });
            }
            continue;
          }
          const expectedBid = Number(item.expectedValue);
          const tolerance = 0.01;
          if (Math.abs(actualBid - expectedBid) <= tolerance) {
            results.push({ item, status: "confirmed", actualValue: actualBid });
          } else {
            results.push({
              item,
              status: "conflict",
              actualValue: actualBid,
              message: `\u671F\u671B\u51FA\u4EF7=$${expectedBid.toFixed(2)}, Amazon\u5B9E\u9645=$${actualBid.toFixed(2)} (${fieldName})`
            });
          }
        }
      } catch (error48) {
        log51.warn(`\u51FA\u4EF7\u9A8C\u8BC1API\u8C03\u7528\u5931\u8D25 fieldName=${fieldName} adGroupId=${adGroupId}:`, error48.message);
        for (const item of groupItems) {
          results.push({ item, status: "error", message: error48.message });
        }
      }
    }
  }
  return results;
}
async function verifyBudgetAdjustments(syncService, items) {
  const results = [];
  try {
    const amazonCampaigns = await syncService.client.listSpCampaigns();
    const amazonBudgetMap = /* @__PURE__ */ new Map();
    for (const campaign of amazonCampaigns) {
      amazonBudgetMap.set(String(campaign.campaignId), campaign.dailyBudget);
    }
    for (const item of items) {
      const actualBudget = amazonBudgetMap.get(item.amazonId);
      if (actualBudget === void 0) {
        results.push({ item, status: "not_found", message: `Amazon\u4E2D\u672A\u627E\u5230campaignId=${item.amazonId}` });
        continue;
      }
      const expectedBudget = Number(item.expectedValue);
      const tolerance = 0.01;
      if (Math.abs(actualBudget - expectedBudget) <= tolerance) {
        results.push({ item, status: "confirmed", actualValue: actualBudget });
      } else {
        results.push({
          item,
          status: "conflict",
          actualValue: actualBudget,
          message: `\u671F\u671B\u9884\u7B97=$${expectedBudget.toFixed(2)}, Amazon\u5B9E\u9645=$${actualBudget.toFixed(2)}`
        });
      }
    }
  } catch (error48) {
    log51.warn(`\u9884\u7B97\u9A8C\u8BC1API\u8C03\u7528\u5931\u8D25:`, error48.message);
    for (const item of items) {
      results.push({ item, status: "error", message: error48.message });
    }
  }
  return results;
}
async function verifyPlacementAdjustments(syncService, items) {
  const results = [];
  try {
    const amazonCampaigns = await syncService.client.listSpCampaigns();
    const amazonPlacementMap = /* @__PURE__ */ new Map();
    for (const campaign of amazonCampaigns) {
      let topOfSearch = 0, productPage = 0, restOfSearch = 0;
      if (campaign.dynamicBidding?.placementBidding?.length > 0) {
        for (const adj of campaign.dynamicBidding.placementBidding) {
          if (adj.placement === "PLACEMENT_TOP") topOfSearch = adj.percentage;
          if (adj.placement === "PLACEMENT_PRODUCT_PAGE") productPage = adj.percentage;
          if (adj.placement === "PLACEMENT_REST_OF_SEARCH") restOfSearch = adj.percentage;
        }
      } else {
        const adjustments = campaign.bidding?.adjustments || [];
        for (const adj of adjustments) {
          if (adj.predicate === "placementTop") topOfSearch = adj.percentage;
          if (adj.predicate === "placementProductPage") productPage = adj.percentage;
        }
      }
      amazonPlacementMap.set(String(campaign.campaignId), { topOfSearch, productPage, restOfSearch });
    }
    for (const item of items) {
      const actual = amazonPlacementMap.get(item.amazonId);
      if (!actual) {
        results.push({ item, status: "not_found", message: `Amazon\u4E2D\u672A\u627E\u5230campaignId=${item.amazonId}` });
        continue;
      }
      const expected = item.expectedValue;
      let isMatch = true;
      const mismatches = [];
      if (expected.topOfSearch !== void 0 && Math.abs(actual.topOfSearch - expected.topOfSearch) > 1) {
        isMatch = false;
        mismatches.push(`\u641C\u7D22\u9876\u90E8: \u671F\u671B=${expected.topOfSearch}%, \u5B9E\u9645=${actual.topOfSearch}%`);
      }
      if (expected.productPage !== void 0 && Math.abs(actual.productPage - expected.productPage) > 1) {
        isMatch = false;
        mismatches.push(`\u5546\u54C1\u9875\u9762: \u671F\u671B=${expected.productPage}%, \u5B9E\u9645=${actual.productPage}%`);
      }
      if (isMatch) {
        results.push({ item, status: "confirmed", actualValue: actual });
      } else {
        results.push({
          item,
          status: "conflict",
          actualValue: actual,
          message: mismatches.join("; ")
        });
      }
    }
  } catch (error48) {
    log51.warn(`\u4F4D\u7F6E\u503E\u659C\u9A8C\u8BC1API\u8C03\u7528\u5931\u8D25:`, error48.message);
    for (const item of items) {
      results.push({ item, status: "error", message: error48.message });
    }
  }
  return results;
}
async function verifyNegativeKeywords(syncService, items) {
  const results = [];
  const byCampaign = /* @__PURE__ */ new Map();
  for (const item of items) {
    const campaignId = item.context?.campaignId || 0;
    const existing = byCampaign.get(campaignId) || [];
    existing.push(item);
    byCampaign.set(campaignId, existing);
  }
  for (const [campaignId, groupItems] of byCampaign.entries()) {
    try {
      const amazonNegatives = await syncService.client.listSpCampaignNegativeKeywords(campaignId || void 0);
      const amazonNegMap = /* @__PURE__ */ new Map();
      for (const neg of amazonNegatives) {
        const key = `${neg.keywordText}_${neg.matchType}`.toLowerCase();
        amazonNegMap.set(key, neg);
      }
      const adGroupIds = new Set(groupItems.map((i) => i.context?.adGroupId).filter(Boolean));
      for (const adGroupId of adGroupIds) {
        try {
          const adGroupNegatives = await syncService.client.listSpNegativeKeywords(adGroupId);
          for (const neg of adGroupNegatives) {
            const key = `${neg.keywordText}_${neg.matchType}`.toLowerCase();
            amazonNegMap.set(key, neg);
          }
        } catch (e) {
          log51.warn(`\u67E5\u8BE2adGroup ${adGroupId} \u5426\u5B9A\u5173\u952E\u8BCD\u5931\u8D25: ${e.message}`);
        }
      }
      for (const item of groupItems) {
        const expected = item.expectedValue;
        const key = `${expected.keywordText}_${expected.matchType}`.toLowerCase();
        const found = amazonNegMap.get(key);
        if (found) {
          results.push({ item, status: "confirmed", actualValue: found });
        } else {
          results.push({
            item,
            status: "not_found",
            // @ts-expect-error - runtime type mismatch
            message: `\u5426\u8BCD "${expected.keywordText}" (${expected.matchType}) \u5728Amazon\u4E2D\u672A\u627E\u5230`
          });
        }
      }
    } catch (error48) {
      log51.warn(`\u5426\u8BCD\u9A8C\u8BC1API\u8C03\u7528\u5931\u8D25 campaignId=${campaignId}:`, error48.message);
      for (const item of groupItems) {
        results.push({ item, status: "error", message: error48.message });
      }
    }
  }
  return results;
}
async function verifyKeywordStatus(syncService, items) {
  const results = [];
  const byAdGroup = /* @__PURE__ */ new Map();
  for (const item of items) {
    const adGroupId = item.context?.adGroupId || 0;
    const existing = byAdGroup.get(adGroupId) || [];
    existing.push(item);
    byAdGroup.set(adGroupId, existing);
  }
  for (const [adGroupId, groupItems] of byAdGroup.entries()) {
    try {
      const amazonKeywords = await syncService.client.listSpKeywords(adGroupId || void 0);
      const amazonStateMap = /* @__PURE__ */ new Map();
      for (const kw of amazonKeywords) {
        amazonStateMap.set(String(kw.keywordId), kw.state);
      }
      for (const item of groupItems) {
        const actualState = amazonStateMap.get(item.amazonId);
        if (actualState === void 0) {
          results.push({ item, status: "not_found", message: `Amazon\u4E2D\u672A\u627E\u5230keywordId=${item.amazonId}` });
          continue;
        }
        if (actualState.toLowerCase() === String(item.expectedValue).toLowerCase()) {
          results.push({ item, status: "confirmed", actualValue: actualState });
        } else {
          results.push({
            item,
            status: "conflict",
            actualValue: actualState,
            message: `\u671F\u671B\u72B6\u6001=${item.expectedValue}, Amazon\u5B9E\u9645=${actualState}`
          });
        }
      }
    } catch (error48) {
      log51.warn(`\u72B6\u6001\u9A8C\u8BC1API\u8C03\u7528\u5931\u8D25 adGroupId=${adGroupId}:`, error48.message);
      for (const item of groupItems) {
        results.push({ item, status: "error", message: error48.message });
      }
    }
  }
  return results;
}
async function applyConfirmedResults(results) {
  const dbConn = await getDb();
  if (!dbConn) {
    log51.warn("\u6570\u636E\u5E93\u8FDE\u63A5\u5931\u8D25\uFF0C\u65E0\u6CD5\u56DE\u586B\u786E\u8BA4\u7ED3\u679C");
    return;
  }
  try {
    await dbConn.transaction(async (tx) => {
      for (const result of results) {
        const { item } = result;
        switch (item.type) {
          case "bid_adjustment":
          case "search_term_migration": {
            const fn = item.context?.fieldName || "keyword_bid";
            if (fn === "sd_audience_bid") {
              try {
                await tx.update(sdAudiences).set({ bid: String(result.actualValue) }).where(eq(sdAudiences.id, item.localId));
                log51.debug(`v512: \u2705 SD\u53D7\u4F17 ${item.localId} \u51FA\u4EF7\u5DF2\u786E\u8BA4: $${result.actualValue}`);
              } catch (sdAudErr) {
                log51.warn(`v512: SD\u53D7\u4F17\u786E\u8BA4\u56DE\u586B\u5931\u8D25: ${sdAudErr.message}`);
              }
            } else if (fn.includes("product_target")) {
              log51.debug(`v166: \u2705 \u5546\u54C1\u5B9A\u4F4D ${item.localId} \u51FA\u4EF7\u5DF2\u786E\u8BA4: $${result.actualValue} (${fn})`);
            } else {
              await tx.update(keywords).set({
                bid: String(result.actualValue),
                pendingBid: null,
                bidSyncStatus: "synced"
              }).where(eq(keywords.id, item.localId));
              log51.debug(`v166: \u2705 \u5173\u952E\u8BCD ${item.localId} \u51FA\u4EF7\u5DF2\u786E\u8BA4: $${result.actualValue} (${fn})`);
            }
            break;
          }
          case "budget_adjustment": {
            await tx.update(campaigns).set({
              dailyBudget: String(result.actualValue),
              pendingBudget: null,
              budgetSyncStatus: "synced",
              lastSyncedAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ")
            }).where(eq(campaigns.id, item.localId));
            log51.debug(`v166: \u2705 \u5E7F\u544A\u6D3B\u52A8 ${item.localId} \u9884\u7B97\u5DF2\u786E\u8BA4: $${result.actualValue}`);
            break;
          }
          case "placement_adjustment": {
            const updateData = {
              placementSyncStatus: "synced",
              pendingPlacementTop: null,
              pendingPlacementProduct: null,
              lastSyncedAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ")
            };
            if (result.actualValue?.topOfSearch !== void 0) {
              updateData.placementTopSearchBidAdjustment = String(result.actualValue.topOfSearch);
            }
            if (result.actualValue?.productPage !== void 0) {
              updateData.placementProductPageBidAdjustment = String(result.actualValue.productPage);
            }
            await tx.update(campaigns).set(updateData).where(eq(campaigns.id, item.localId));
            log51.debug(`v166: \u2705 \u5E7F\u544A\u6D3B\u52A8 ${item.localId} \u4F4D\u7F6E\u503E\u659C\u5DF2\u786E\u8BA4: top=${result.actualValue?.topOfSearch}%, product=${result.actualValue?.productPage}%`);
            break;
          }
          case "negative_keyword": {
            if (result.actualValue?.keywordId) {
              log51.debug(`v166: \u2705 \u5426\u8BCD ${item.localId} \u5DF2\u786E\u8BA4\u5B58\u5728\u4E8EAmazon (amazonId=${result.actualValue.keywordId})`);
            } else {
              log51.debug(`v166: \u2705 \u5426\u8BCD ${item.localId} \u5DF2\u786E\u8BA4\u5B58\u5728\u4E8EAmazon`);
            }
            break;
          }
          case "keyword_status": {
            log51.info(`v166: \u2705 \u5173\u952E\u8BCD ${item.localId} \u72B6\u6001\u5DF2\u786E\u8BA4: ${result.actualValue}`);
            break;
          }
        }
      }
    });
    log51.info(`v166: \u4E8B\u52A1\u56DE\u586B\u5B8C\u6210, ${results.length}\u9879\u5DF2\u786E\u8BA4\u5E76\u66F4\u65B0`);
  } catch (error48) {
    log51.warn(`v166: \u4E8B\u52A1\u56DE\u586B\u5931\u8D25:`, error48.message);
  }
}
async function handleConflicts(results) {
  const dbConn = await getDb();
  if (!dbConn) return;
  try {
    await dbConn.transaction(async (tx) => {
      for (const result of results) {
        const { item } = result;
        switch (item.type) {
          case "bid_adjustment": {
            if (item.context?.fieldName !== "product_target_bid") {
              await tx.update(keywords).set({
                bid: String(result.actualValue),
                pendingBid: null,
                bidSyncStatus: "conflict"
              }).where(eq(keywords.id, item.localId));
            }
            log51.warn(`v166: \u26A0\uFE0F \u51FA\u4EF7\u51B2\u7A81 keyword=${item.localId}: ${result.message}`);
            break;
          }
          case "budget_adjustment": {
            await tx.update(campaigns).set({
              dailyBudget: String(result.actualValue),
              pendingBudget: null,
              budgetSyncStatus: "conflict",
              lastSyncedAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ")
            }).where(eq(campaigns.id, item.localId));
            log51.warn(`v166: \u26A0\uFE0F \u9884\u7B97\u51B2\u7A81 campaign=${item.localId}: ${result.message}`);
            break;
          }
          case "placement_adjustment": {
            const updateData = {
              placementSyncStatus: "conflict",
              pendingPlacementTop: null,
              pendingPlacementProduct: null,
              lastSyncedAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ")
            };
            if (result.actualValue?.topOfSearch !== void 0) {
              updateData.placementTopSearchBidAdjustment = String(result.actualValue.topOfSearch);
            }
            if (result.actualValue?.productPage !== void 0) {
              updateData.placementProductPageBidAdjustment = String(result.actualValue.productPage);
            }
            await tx.update(campaigns).set(updateData).where(eq(campaigns.id, item.localId));
            log51.warn(`v166: \u26A0\uFE0F \u4F4D\u7F6E\u503E\u659C\u51B2\u7A81 campaign=${item.localId}: ${result.message}`);
            break;
          }
          default: {
            log51.warn(`v166: \u26A0\uFE0F ${item.type}\u51B2\u7A81 id=${item.localId}: ${result.message}`);
          }
        }
      }
    });
    log51.warn(`v166: ${results.length}\u9879\u51B2\u7A81\u5DF2\u5904\u7406\uFF08\u4EE5Amazon\u5B9E\u9645\u503C\u4E3A\u51C6\uFF09`);
  } catch (error48) {
    log51.warn(`v166: \u51B2\u7A81\u5904\u7406\u4E8B\u52A1\u5931\u8D25:`, error48.message);
  }
}
function cleanupTask(taskId) {
  pendingTasks.delete(taskId);
  const timer = activeTimers.get(taskId);
  if (timer) {
    clearTimeout(timer);
    activeTimers.delete(taskId);
  }
}
async function autoResolveConflicts(accountId) {
  const dbConn = await getDb();
  if (!dbConn) return { resolved: 0, ignored: 0, skipped: 0 };
  let resolved = 0;
  let ignored = 0;
  let skipped = 0;
  try {
    const pendingConflicts = await dbConn.select({
      id: syncConflicts.id,
      conflictType: syncConflicts.conflictType,
      suggestedResolution: syncConflicts.suggestedResolution,
      entityType: syncConflicts.entityType,
      entityId: syncConflicts.entityId
    }).from(syncConflicts).where(and(
      eq(syncConflicts.accountId, accountId),
      eq(syncConflicts.resolutionStatus, "pending")
    )).limit(2e3);
    if (pendingConflicts.length === 0) return { resolved: 0, ignored: 0, skipped: 0 };
    const autoResolveIds = [];
    const autoIgnoreIds = [];
    for (const conflict of pendingConflicts) {
      if (conflict.conflictType === "data_mismatch" && conflict.suggestedResolution === "use_remote") {
        autoResolveIds.push(conflict.id);
      } else if (conflict.conflictType === "missing_remote") {
        autoIgnoreIds.push(conflict.id);
      } else if (conflict.conflictType === "status_conflict" && conflict.suggestedResolution === "use_remote") {
        autoResolveIds.push(conflict.id);
      } else {
        skipped++;
      }
    }
    if (autoResolveIds.length > 0) {
      for (let i = 0; i < autoResolveIds.length; i += 500) {
        const batch = autoResolveIds.slice(i, i + 500);
        await dbConn.update(syncConflicts).set({
          resolutionStatus: "resolved",
          resolvedAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " "),
          resolutionNotes: "v257: \u81EA\u52A8\u89E3\u51B3 - \u4EE5\u4E9A\u9A6C\u900A\u5B9E\u9645\u6570\u636E\u4E3A\u51C6 (use_remote)"
        }).where(inArray(syncConflicts.id, batch));
      }
      resolved = autoResolveIds.length;
    }
    if (autoIgnoreIds.length > 0) {
      for (let i = 0; i < autoIgnoreIds.length; i += 500) {
        const batch = autoIgnoreIds.slice(i, i + 500);
        await dbConn.update(syncConflicts).set({
          resolutionStatus: "ignored",
          resolvedAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " "),
          resolutionNotes: "v257: \u81EA\u52A8\u5FFD\u7565 - \u8FDC\u7A0B\u5B9E\u4F53\u4E0D\u5B58\u5728"
        }).where(inArray(syncConflicts.id, batch));
      }
      ignored = autoIgnoreIds.length;
    }
    log51.info(`v257: \u81EA\u52A8\u51B2\u7A81\u89E3\u51B3\u5B8C\u6210 accountId=${accountId}: resolved=${resolved}, ignored=${ignored}, skipped=${skipped}, total=${pendingConflicts.length}`);
  } catch (error48) {
    log51.warn(`v257: \u81EA\u52A8\u51B2\u7A81\u89E3\u51B3\u5931\u8D25 accountId=${accountId}: ${error48.message}`);
  }
  return { resolved, ignored, skipped };
}
var log51, pendingTasks, activeTimers, VERIFICATION_DELAYS;
var init_postOptimizationVerifier = __esm({
  "server/optimization/postOptimizationVerifier.ts"() {
    "use strict";
    init_db2();
    init_schema2();
    init_drizzle_orm();
    init_amazonApiHelper();
    init_logger();
    log51 = createModuleLogger("PostOptVerifier");
    pendingTasks = /* @__PURE__ */ new Map();
    activeTimers = /* @__PURE__ */ new Map();
    VERIFICATION_DELAYS = {
      /** 首次验证延迟：给Amazon 45秒处理时间 */
      firstAttempt: 45,
      /** 第二次验证延迟：3分钟后 */
      secondAttempt: 180,
      /** 第三次验证延迟：10分钟后 */
      thirdAttempt: 600
    };
    __name(generateTaskId, "generateTaskId");
    __name(scheduleBidVerification, "scheduleBidVerification");
    __name(scheduleBudgetVerification, "scheduleBudgetVerification");
    __name(schedulePlacementVerification, "schedulePlacementVerification");
    __name(scheduleNegativeKeywordVerification, "scheduleNegativeKeywordVerification");
    __name(scheduleKeywordStatusVerification, "scheduleKeywordStatusVerification");
    __name(scheduleVerificationTask, "scheduleVerificationTask");
    __name(executeVerificationTask, "executeVerificationTask");
    __name(groupItemsByType, "groupItemsByType");
    __name(verifyByType, "verifyByType");
    __name(verifyBidAdjustments, "verifyBidAdjustments");
    __name(verifyBudgetAdjustments, "verifyBudgetAdjustments");
    __name(verifyPlacementAdjustments, "verifyPlacementAdjustments");
    __name(verifyNegativeKeywords, "verifyNegativeKeywords");
    __name(verifyKeywordStatus, "verifyKeywordStatus");
    __name(applyConfirmedResults, "applyConfirmedResults");
    __name(handleConflicts, "handleConflicts");
    __name(cleanupTask, "cleanupTask");
    __name(autoResolveConflicts, "autoResolveConflicts");
  }
});

