// Extracted from production dist/index.js
// Original module: server/postDeployCommandRevalidator.ts
// Lines: 616

var postDeployCommandRevalidator_exports = {};
__export(postDeployCommandRevalidator_exports, {
  revalidateTarget: () => revalidateTarget,
  runFullRevalidation: () => runFullRevalidation
});
async function revalidatePendingCommands(targetId, targetName, accountId) {
  const result = { total: 0, kept: 0, cancelled: 0, retriggered: 0, errors: 0 };
  try {
    const database = await getDb();
    if (!database) return result;
    const pendingEvents = await database.execute(
      sql`SELECT /*+ MAX_EXECUTION_TIME(60000) */ oe.id, oe.action_type, oe.event_category, oe.keyword_id, oe.keyword_text,
                 oe.campaign_id, oe.campaign_name, oe.previous_bid, oe.new_bid,
                 oe.previous_value, oe.new_value, oe.created_at, oe.error_message,
                 k.bid as current_bid, k.keywordId as amazon_keyword_id, k.matchType,
                 pt.bid as pt_current_bid, pt.targetId as amazon_target_id,
                 c.dailyBudget as campaign_budget, c.campaignId as amazon_campaign_id
          FROM optimization_events oe
          LEFT JOIN keywords k ON oe.keyword_id = k.id
          LEFT JOIN product_targets pt ON oe.action_type IN ('product_target_create') AND oe.keyword_id = pt.id
          LEFT JOIN campaigns c ON oe.campaign_id = c.id
          WHERE oe.performance_group_id = ${targetId}
            AND oe.api_sync_status = 'pending'
            AND oe.action_type IN (
              'bid_increase', 'bid_decrease', 'bid_set', 'bid_auto_adjust',
              'budget_increase', 'budget_decrease', 'budget_set',
              'target_pause', 'target_enable',
              'keyword_create', 'negative_keyword_add', 'product_target_create'
            )
            AND oe.created_at > DATE_SUB(NOW(), INTERVAL ${sql.raw(String(REVALIDATION_CONFIG.pendingExpiryDays))} DAY)
          ORDER BY oe.created_at DESC
          LIMIT ${sql.raw(String(REVALIDATION_CONFIG.maxPendingPerTarget))}`
    );
    const rows = Array.isArray(pendingEvents) ? Array.isArray(pendingEvents[0]) ? pendingEvents[0] : pendingEvents : [];
    if (rows.length === 0) {
      log115.info(`[CmdRevalidator] [${targetName}] \u65E0pending\u6307\u4EE4\u9700\u8981\u91CD\u8BC4\u4F30`);
      return result;
    }
    result.total = rows.length;
    log115.info(`[CmdRevalidator] [${targetName}] \u53D1\u73B0${rows.length}\u6761pending\u6307\u4EE4\u9700\u8981\u91CD\u8BC4\u4F30`);
    for (const row of rows) {
      try {
        const evaluation = evaluatePendingCommand(row, targetName);
        if (evaluation.shouldCancel) {
          await database.execute(
            sql`UPDATE optimization_events 
                SET api_sync_status = 'not_applicable',
                    api_sync_detail = ${JSON.stringify({
              cancelledBy: `v${SYSTEM_VERSION}-revalidator`,
              reason: evaluation.reason,
              evaluatedAt: (/* @__PURE__ */ new Date()).toISOString()
            })}
                WHERE id = ${row.id}`
          );
          result.cancelled++;
          recordAudit({
            action: "optimization.auto_bid",
            accountId,
            entityType: row.action_type?.includes("budget") ? "campaign" : "keyword",
            entityId: row.keyword_id || row.campaign_id,
            entityName: row.keyword_text || row.campaign_name,
            previousValue: { action: row.action_type, value: row.new_bid || row.new_value },
            newValue: { status: "cancelled", reason: evaluation.reason },
            source: "system",
            result: "success",
            metadata: { module: "postDeployRevalidator", version: SYSTEM_VERSION }
          });
        } else {
          await database.execute(
            sql`UPDATE optimization_events 
                SET api_sync_status = 'pending',
                    error_message = NULL,
                    api_sync_detail = ${JSON.stringify({
              retriggeredBy: `v${SYSTEM_VERSION}-revalidator`,
              reason: evaluation.reason,
              evaluatedAt: (/* @__PURE__ */ new Date()).toISOString()
            })}
                WHERE id = ${row.id}`
          );
          result.retriggered++;
          result.kept++;
        }
      } catch (evalErr) {
        result.errors++;
        log115.warn(`[CmdRevalidator] [${targetName}] pending\u91CD\u8BC4\u4F30\u5355\u6761\u5931\u8D25(id=${row.id}): ${evalErr.message}`);
      }
    }
    log115.info(`[CmdRevalidator] [${targetName}] pending\u91CD\u8BC4\u4F30\u5B8C\u6210: \u603B\u8BA1=${result.total}, \u4FDD\u7559\u5E76\u91CD\u89E6\u53D1=${result.retriggered}, \u53D6\u6D88=${result.cancelled}`);
  } catch (err) {
    const cause = err?.cause;
    const causeMsg = cause ? ` | cause: ${String(cause?.message || cause)}` : "";
    log115.warn(`[CmdRevalidator] [${targetName}] pending\u91CD\u8BC4\u4F30\u5931\u8D25: ${err.message}${causeMsg}`);
  }
  return result;
}
function evaluatePendingCommand(row, targetName) {
  const actionType = row.action_type;
  if (["bid_increase", "bid_decrease", "bid_set", "bid_auto_adjust"].includes(actionType)) {
    const newBid = parseFloat(String(row.new_bid || row.new_value || 0));
    const prevBid = parseFloat(String(row.previous_bid || row.previous_value || 0));
    const currentBid = parseFloat(String(row.current_bid || row.pt_current_bid || 0));
    if (!row.amazon_keyword_id && !row.amazon_target_id) {
      return { shouldCancel: true, reason: `\u7F3A\u5C11Amazon ID\uFF0C\u65E0\u6CD5\u6267\u884C\u51FA\u4EF7\u8C03\u6574` };
    }
    if (actionType === "bid_increase" && currentBid >= newBid) {
      return { shouldCancel: true, reason: `\u5F53\u524D\u51FA\u4EF7$${currentBid.toFixed(2)}\u5DF2>=\u76EE\u6807$${newBid.toFixed(2)}\uFF0C\u5DF2\u88AB\u540E\u7EED\u64CD\u4F5C\u8986\u76D6` };
    }
    if (actionType === "bid_decrease" && currentBid <= newBid) {
      return { shouldCancel: true, reason: `\u5F53\u524D\u51FA\u4EF7$${currentBid.toFixed(2)}\u5DF2<=\u76EE\u6807$${newBid.toFixed(2)}\uFF0C\u5DF2\u88AB\u540E\u7EED\u64CD\u4F5C\u8986\u76D6` };
    }
    const safeNewBid = applyBidSafetyBoundary(currentBid, newBid);
    if (Math.abs(safeNewBid - newBid) > 0.01) {
      return { shouldCancel: true, reason: `\u51FA\u4EF7$${newBid.toFixed(2)}\u8D85\u51FA\u5B89\u5168\u8FB9\u754C(\u5141\u8BB8\u8303\u56F4: $${(currentBid * (1 - SAFETY_LIMITS.BID.MAX_DECREASE_PERCENT / 100)).toFixed(2)}-$${(currentBid * (1 + SAFETY_LIMITS.BID.MAX_INCREASE_PERCENT / 100)).toFixed(2)})` };
    }
    if (newBid < REVALIDATION_CONFIG.absoluteMinBid) {
      return { shouldCancel: true, reason: `\u76EE\u6807\u51FA\u4EF7$${newBid.toFixed(2)}\u4F4E\u4E8E\u7EDD\u5BF9\u4E0B\u9650$${REVALIDATION_CONFIG.absoluteMinBid}` };
    }
    if (newBid > REVALIDATION_CONFIG.absoluteMaxBid * 2) {
      return { shouldCancel: true, reason: `\u76EE\u6807\u51FA\u4EF7$${newBid.toFixed(2)}\u8D85\u8FC7\u7EDD\u5BF9\u4E0A\u9650$${(REVALIDATION_CONFIG.absoluteMaxBid * 2).toFixed(2)}` };
    }
    if (prevBid > 0) {
      const changePercent = Math.abs(newBid - prevBid) / prevBid;
      if (changePercent > 0.4) {
        return { shouldCancel: true, reason: `\u8C03\u6574\u5E45\u5EA6${(changePercent * 100).toFixed(1)}%\u8D85\u8FC740%\u5B89\u5168\u9608\u503C` };
      }
    }
    return { shouldCancel: false, reason: `v${SYSTEM_VERSION}\u91CD\u8BC4\u4F30\u901A\u8FC7: \u51FA\u4EF7$${currentBid.toFixed(2)}\u2192$${newBid.toFixed(2)}\u5728\u5B89\u5168\u8FB9\u754C\u5185` };
  }
  if (["budget_increase", "budget_decrease", "budget_set"].includes(actionType)) {
    const newBudget = parseFloat(String(row.new_value || 0));
    const prevBudget = parseFloat(String(row.previous_value || 0));
    const currentBudget = parseFloat(String(row.campaign_budget || 0));
    if (!row.amazon_campaign_id) {
      return { shouldCancel: true, reason: "\u7F3A\u5C11Amazon Campaign ID\uFF0C\u65E0\u6CD5\u6267\u884C\u9884\u7B97\u8C03\u6574" };
    }
    if (prevBudget > 0) {
      const changePercent = Math.abs(newBudget - prevBudget) / prevBudget;
      if (changePercent > 0.5) {
        return { shouldCancel: true, reason: `\u9884\u7B97\u8C03\u6574\u5E45\u5EA6${(changePercent * 100).toFixed(1)}%\u8D85\u8FC750%\u5B89\u5168\u9608\u503C` };
      }
    }
    if (currentBudget > 0 && Math.abs(currentBudget - newBudget) < 0.01) {
      return { shouldCancel: true, reason: `\u5F53\u524D\u9884\u7B97$${currentBudget.toFixed(2)}\u5DF2\u7B49\u4E8E\u76EE\u6807\u503C\uFF0C\u65E0\u9700\u8C03\u6574` };
    }
    return { shouldCancel: false, reason: `v${SYSTEM_VERSION}\u91CD\u8BC4\u4F30\u901A\u8FC7: \u9884\u7B97\u8C03\u6574\u5728\u5B89\u5168\u8303\u56F4\u5185` };
  }
  if (["target_pause", "target_enable"].includes(actionType)) {
    if (!row.amazon_keyword_id && !row.amazon_target_id) {
      return { shouldCancel: true, reason: "\u7F3A\u5C11Amazon ID\uFF0C\u65E0\u6CD5\u6267\u884C\u72B6\u6001\u53D8\u66F4" };
    }
    return { shouldCancel: false, reason: `v${SYSTEM_VERSION}\u91CD\u8BC4\u4F30\u901A\u8FC7: \u72B6\u6001\u53D8\u66F4\u6307\u4EE4\u6709\u6548` };
  }
  if (["keyword_create", "negative_keyword_add", "product_target_create"].includes(actionType)) {
    if (!row.amazon_campaign_id && actionType !== "product_target_create") {
      return { shouldCancel: true, reason: "\u7F3A\u5C11Amazon Campaign ID\uFF0C\u65E0\u6CD5\u521B\u5EFA\u5173\u952E\u8BCD" };
    }
    return { shouldCancel: false, reason: `v${SYSTEM_VERSION}\u91CD\u8BC4\u4F30\u901A\u8FC7: \u521B\u5EFA\u6307\u4EE4\u6709\u6548` };
  }
  return { shouldCancel: false, reason: `v${SYSTEM_VERSION}\u91CD\u8BC4\u4F30\u901A\u8FC7: \u9ED8\u8BA4\u4FDD\u7559` };
}
async function auditAndCorrectHistoricalCommands(targetId, targetName, accountId) {
  const result = { total: 0, reasonable: 0, unreasonable: 0, correctionGenerated: 0, errors: 0 };
  try {
    const database = await getDb();
    if (!database) return result;
    const syncedEvents = await database.execute(
      sql`SELECT /*+ MAX_EXECUTION_TIME(60000) */ oe.id, oe.action_type, oe.event_category, oe.keyword_id, oe.keyword_text,
 oe.campaign_id, oe.campaign_name, oe.internal_ad_group_id,
 oe.previous_bid, oe.new_bid, oe.previous_value, oe.new_value,
 oe.created_at, oe.algorithm_version,
 k.bid as current_bid, k.keywordId as amazon_keyword_id, k.matchType, k.keywordStatus as keyword_status,
 c.dailyBudget as campaign_budget, c.campaignId as amazon_campaign_id,
 pg.targetAcos as target_acos
 FROM optimization_events oe
 LEFT JOIN keywords k ON oe.keyword_id = k.id
 LEFT JOIN campaigns c ON oe.campaign_id = c.id
 LEFT JOIN performance_groups pg ON oe.performance_group_id = pg.id
 WHERE oe.performance_group_id = ${targetId}
 AND oe.api_sync_status = 'synced'
 AND oe.action_type IN ('bid_increase', 'bid_decrease', 'bid_set', 'bid_auto_adjust',
 'budget_increase', 'budget_decrease', 'budget_set')
 AND oe.created_at > DATE_SUB(NOW(), INTERVAL ${sql.raw(String(REVALIDATION_CONFIG.auditLookbackDays))} DAY)
 ORDER BY oe.created_at DESC
 LIMIT ${sql.raw(String(REVALIDATION_CONFIG.maxSyncedPerTarget))}`
    );
    const rows = Array.isArray(syncedEvents) ? Array.isArray(syncedEvents[0]) ? syncedEvents[0] : syncedEvents : [];
    if (rows.length === 0) {
      log115.info(`[CmdRevalidator] [${targetName}] \u65E0\u8FD1\u671Fsynced\u6307\u4EE4\u9700\u8981\u5BA1\u8BA1`);
      return result;
    }
    result.total = rows.length;
    log115.info(`[CmdRevalidator] [${targetName}] \u5BA1\u8BA1${rows.length}\u6761\u5DF2\u6267\u884C\u6307\u4EE4...`);
    const latestByEntity = /* @__PURE__ */ new Map();
    for (const row of rows) {
      const entityKey = `${row.action_type?.includes("budget") ? "campaign" : "keyword"}_${row.keyword_id || row.campaign_id}`;
      if (!latestByEntity.has(entityKey)) {
        latestByEntity.set(entityKey, row);
      }
    }
    for (const [entityKey, row] of latestByEntity) {
      try {
        const audit = auditSyncedCommand(row, targetName);
        if (audit.isUnreasonable) {
          result.unreasonable++;
          if (audit.correctionBid !== void 0 || audit.correctionBudget !== void 0) {
            try {
              await generateCorrectionCommand(database, row, audit, targetId, targetName, accountId);
              result.correctionGenerated++;
              recordAudit({
                action: "optimization.auto_bid",
                accountId,
                // @ts-ignore
                entityType: row.action_type?.includes("budget") ? "campaign" : "keyword",
                // @ts-ignore
                entityId: row.keyword_id || row.campaign_id,
                // @ts-ignore
                entityName: row.keyword_text || row.campaign_name,
                previousValue: {
                  originalAction: row.action_type,
                  originalValue: row.new_bid || row.new_value,
                  sourceEventId: row.id
                },
                newValue: {
                  correctionBid: audit.correctionBid,
                  correctionBudget: audit.correctionBudget,
                  reason: audit.reason
                },
                source: "system",
                result: "success",
                metadata: {
                  module: "postDeployRevalidator",
                  version: SYSTEM_VERSION,
                  auditType: "historical_correction"
                }
              });
            } catch (genErr) {
              result.errors++;
              log115.warn(`[CmdRevalidator] [${targetName}] \u751F\u6210\u7EA0\u6B63\u6307\u4EE4\u5931\u8D25(id=${row.id}): ${genErr.message}`);
            }
          }
        } else {
          result.reasonable++;
        }
      } catch (auditErr) {
        result.errors++;
        log115.warn(`[CmdRevalidator] [${targetName}] \u5BA1\u8BA1\u5355\u6761\u5931\u8D25(id=${row.id}): ${auditErr.message}`);
      }
    }
    log115.info(`[CmdRevalidator] [${targetName}] \u5386\u53F2\u5BA1\u8BA1\u5B8C\u6210: \u603B\u8BA1=${result.total}, \u5408\u7406=${result.reasonable}, \u4E0D\u5408\u7406=${result.unreasonable}, \u751F\u6210\u7EA0\u6B63=${result.correctionGenerated}`);
  } catch (err) {
    const cause = err?.cause;
    const causeMsg = cause ? ` | cause: ${String(cause?.message || cause)}` : "";
    log115.warn(`[CmdRevalidator] [${targetName}] \u5386\u53F2\u6307\u4EE4\u5BA1\u8BA1\u5931\u8D25: ${err.message}${causeMsg}`);
  }
  return result;
}
function auditSyncedCommand(row, targetName) {
  const actionType = row.action_type;
  if (["bid_increase", "bid_decrease", "bid_set", "bid_auto_adjust"].includes(actionType)) {
    const executedBid = parseFloat(String(row.new_bid || row.new_value || 0));
    const prevBid = parseFloat(String(row.previous_bid || row.previous_value || 0));
    const currentBid = parseFloat(String(row.current_bid || 0));
    if (prevBid <= 0 || executedBid <= 0) {
      return { isUnreasonable: false, reason: "\u6570\u636E\u4E0D\u5B8C\u6574\uFF0C\u8DF3\u8FC7\u5BA1\u8BA1" };
    }
    if (["bid_decrease", "bid_set", "bid_auto_adjust"].includes(actionType) && executedBid < prevBid) {
      const decreasePercent = (prevBid - executedBid) / prevBid;
      if (decreasePercent > 0.3) {
        const reasonableBid = prevBid * (1 - SAFETY_LIMITS.BID.MAX_DECREASE_PERCENT / 100);
        const correctionBid = Math.max(REVALIDATION_CONFIG.absoluteMinBid, reasonableBid);
        return {
          isUnreasonable: true,
          reason: `\u964D\u4EF7\u5E45\u5EA6${(decreasePercent * 100).toFixed(1)}%\u8D85\u8FC730%\u5B89\u5168\u9608\u503C(${prevBid.toFixed(2)}\u2192${executedBid.toFixed(2)})`,
          correctionBid
        };
      }
    }
    if (["bid_increase", "bid_set", "bid_auto_adjust"].includes(actionType) && executedBid > prevBid) {
      const increasePercent = (executedBid - prevBid) / prevBid;
      if (increasePercent > 0.5) {
        const reasonableBid = prevBid * (1 + SAFETY_LIMITS.BID.MAX_INCREASE_PERCENT / 100);
        const correctionBid = Math.min(REVALIDATION_CONFIG.absoluteMaxBid, reasonableBid);
        return {
          isUnreasonable: true,
          reason: `\u63D0\u4EF7\u5E45\u5EA6${(increasePercent * 100).toFixed(1)}%\u8D85\u8FC750%\u5B89\u5168\u9608\u503C(${prevBid.toFixed(2)}\u2192${executedBid.toFixed(2)})`,
          correctionBid
        };
      }
    }
    if (executedBid < REVALIDATION_CONFIG.absoluteMinBid && prevBid >= 0.1) {
      return {
        isUnreasonable: true,
        reason: `\u51FA\u4EF7\u964D\u81F3$${executedBid.toFixed(2)}\uFF0C\u4F4E\u4E8E\u6700\u4F4E\u9650$${REVALIDATION_CONFIG.absoluteMinBid}\uFF0C\u53EF\u80FD\u5BFC\u81F4\u96F6\u66DD\u5149`,
        correctionBid: Math.max(REVALIDATION_CONFIG.absoluteMinBid, prevBid * 0.5)
      };
    }
    if (executedBid > REVALIDATION_CONFIG.absoluteMaxBid * 1.5) {
      return {
        isUnreasonable: true,
        reason: `\u51FA\u4EF7$${executedBid.toFixed(2)}\u8D85\u8FC7\u5B89\u5168\u4E0A\u9650$${(REVALIDATION_CONFIG.absoluteMaxBid * 1.5).toFixed(2)}`,
        correctionBid: Math.min(REVALIDATION_CONFIG.absoluteMaxBid, prevBid * 1.1)
      };
    }
    return { isUnreasonable: false, reason: "\u51FA\u4EF7\u8C03\u6574\u5728\u5408\u7406\u8303\u56F4\u5185" };
  }
  if (["budget_increase", "budget_decrease", "budget_set"].includes(actionType)) {
    const executedBudget = parseFloat(String(row.new_value || 0));
    const prevBudget = parseFloat(String(row.previous_value || 0));
    if (prevBudget <= 0 || executedBudget <= 0) {
      return { isUnreasonable: false, reason: "\u6570\u636E\u4E0D\u5B8C\u6574\uFF0C\u8DF3\u8FC7\u5BA1\u8BA1" };
    }
    if (executedBudget < prevBudget) {
      const decreasePercent = (prevBudget - executedBudget) / prevBudget;
      if (decreasePercent > 0.4) {
        const reasonableBudget = prevBudget * (1 - SAFETY_LIMITS.BUDGET.MAX_DECREASE_PERCENT / 100);
        return {
          isUnreasonable: true,
          reason: `\u9884\u7B97\u964D\u5E45${(decreasePercent * 100).toFixed(1)}%\u8D85\u8FC740%\u5B89\u5168\u9608\u503C`,
          correctionBudget: reasonableBudget
        };
      }
    }
    if (executedBudget > prevBudget) {
      const increasePercent = (executedBudget - prevBudget) / prevBudget;
      if (increasePercent > 1) {
        const reasonableBudget = prevBudget * (1 + SAFETY_LIMITS.BUDGET.MAX_INCREASE_PERCENT / 100);
        return {
          isUnreasonable: true,
          reason: `\u9884\u7B97\u6DA8\u5E45${(increasePercent * 100).toFixed(1)}%\u8D85\u8FC7100%\u5B89\u5168\u9608\u503C`,
          correctionBudget: reasonableBudget
        };
      }
    }
    return { isUnreasonable: false, reason: "\u9884\u7B97\u8C03\u6574\u5728\u5408\u7406\u8303\u56F4\u5185" };
  }
  return { isUnreasonable: false, reason: "\u975E\u51FA\u4EF7/\u9884\u7B97\u6307\u4EE4\uFF0C\u8DF3\u8FC7\u5BA1\u8BA1" };
}
async function generateCorrectionCommand(database, originalRow, audit, targetId, targetName, accountId) {
  const isBidCorrection = audit.correctionBid !== void 0;
  const correctionValue = isBidCorrection ? audit.correctionBid : audit.correctionBudget;
  const currentValue = isBidCorrection ? parseFloat(String(originalRow.current_bid || originalRow.new_bid || 0)) : parseFloat(String(originalRow.campaign_budget || originalRow.new_value || 0));
  const isIncrease = correctionValue > currentValue;
  let correctionActionType;
  let correctionCategory;
  if (isBidCorrection) {
    correctionActionType = isIncrease ? "bid_increase" : "bid_decrease";
    correctionCategory = "bid_adjustment";
  } else {
    correctionActionType = isIncrease ? "budget_increase" : "budget_decrease";
    correctionCategory = "budget_adjustment";
  }
  await database.execute(
    sql`INSERT INTO optimization_events 
        (performance_group_id, performance_group_name, account_id, account_name,
         event_category, action_type, 
         keyword_id, keyword_text, campaign_id, campaign_name, internal_ad_group_id,
         previous_bid, new_bid, previous_value, new_value,
         change_reason, algorithm_version, status, api_sync_status,
         action_detail)
        VALUES (
          ${targetId}, ${targetName}, ${accountId}, ${originalRow.account_name || null},
          ${correctionCategory}, ${correctionActionType},
          ${isBidCorrection ? originalRow.keyword_id : null}, 
          ${isBidCorrection ? originalRow.keyword_text : null},
          ${originalRow.campaign_id || null}, ${originalRow.campaign_name || null},
          ${originalRow.internal_ad_group_id || null},
          ${isBidCorrection ? String(currentValue) : null},
          ${isBidCorrection ? String(correctionValue) : null},
          ${!isBidCorrection ? String(currentValue) : null},
          ${!isBidCorrection ? String(correctionValue) : null},
          ${`v${SYSTEM_VERSION}\u81EA\u52A8\u7EA0\u9519: ${audit.reason}`},
          ${`v${SYSTEM_VERSION}`}, 'success', 'pending',
          ${JSON.stringify({
      type: "auto_correction",
      sourceEventId: originalRow.id,
      originalAction: originalRow.action_type,
      originalValue: originalRow.new_bid || originalRow.new_value,
      correctionValue,
      auditReason: audit.reason,
      generatedBy: `v${SYSTEM_VERSION}-revalidator`,
      generatedAt: (/* @__PURE__ */ new Date()).toISOString()
    })}
        )`
  );
  log115.info(`[CmdRevalidator] [${targetName}] \u751F\u6210\u7EA0\u6B63\u6307\u4EE4: ${correctionActionType} ${isBidCorrection ? "bid" : "budget"} $${currentValue.toFixed(2)}\u2192$${correctionValue.toFixed(2)} (\u539F\u56E0: ${audit.reason})`);
}
async function runFullRevalidation() {
  const triggeredAt = /* @__PURE__ */ new Date();
  const errors = [];
  const targetResults = [];
  log115.info(`[CmdRevalidator] v${SYSTEM_VERSION}: \u5F00\u59CB\u5168\u91CF\u6307\u4EE4\u91CD\u8BC4\u4F30\u4E0E\u7EA0\u9519...`);
  auditSystemAction("system.deploy", {
    description: `v${SYSTEM_VERSION} \u90E8\u7F72\u540E\u6307\u4EE4\u91CD\u8BC4\u4F30\u4E0E\u7EA0\u9519\u542F\u52A8`,
    metadata: { version: SYSTEM_VERSION, triggeredAt: triggeredAt.toISOString() }
  });
  try {
    const { getEnabledOptimizationTargets: getEnabledOptimizationTargets2 } = await Promise.resolve().then(() => (init_optimizationTargetEngine(), optimizationTargetEngine_exports));
    const targets = await getEnabledOptimizationTargets2();
    if (targets.length === 0) {
      log115.info(`[CmdRevalidator] \u6CA1\u6709\u6D3B\u8DC3\u7684\u4F18\u5316\u76EE\u6807\uFF0C\u8DF3\u8FC7\u91CD\u8BC4\u4F30`);
      return {
        version: SYSTEM_VERSION,
        triggeredAt,
        // @ts-ignore
        completedAt: /* @__PURE__ */ new Date(),
        targetsProcessed: 0,
        totalPendingRevalidated: 0,
        totalPendingCancelled: 0,
        totalPendingRetriggered: 0,
        // @ts-ignore
        totalHistoricalAudited: 0,
        totalCorrectionsGenerated: 0,
        targetResults: [],
        errors: []
        // @ts-ignore
      };
    }
    log115.info(`[CmdRevalidator] \u5BF9 ${targets.length} \u4E2A\u6D3B\u8DC3\u4F18\u5316\u76EE\u6807\u6267\u884C\u91CD\u8BC4\u4F30...`);
    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];
      const startTime = Date.now();
      try {
        const pendingResult = await revalidatePendingCommands(
          // @ts-ignore
          target.id,
          target.name,
          target.accountId
        );
        const auditResult = await auditAndCorrectHistoricalCommands(
          // @ts-ignore
          target.id,
          target.name,
          target.accountId
          // @ts-ignore
        );
        const targetResult = {
          // @ts-ignore
          targetId: target.id,
          // @ts-ignore
          targetName: target.name,
          // @ts-ignore
          accountId: target.accountId,
          pendingRevalidation: pendingResult,
          historicalAudit: auditResult,
          errors: [],
          duration: Date.now() - startTime
        };
        targetResults.push(targetResult);
        log115.info(`[CmdRevalidator] [${target.name}] \u5B8C\u6210 (${targetResult.duration}ms): pending=${pendingResult.total}(\u4FDD\u7559${pendingResult.kept},\u53D6\u6D88${pendingResult.cancelled}), \u5386\u53F2=${auditResult.total}(\u5408\u7406${auditResult.reasonable},\u7EA0\u6B63${auditResult.correctionGenerated})`);
      } catch (targetErr) {
        const errMsg = `\u76EE\u6807${target.name}(${target.id})\u5904\u7406\u5931\u8D25: ${targetErr.message}`;
        errors.push(errMsg);
        log115.warn(`[CmdRevalidator] ${errMsg}`);
        targetResults.push({
          // @ts-ignore
          targetId: target.id,
          // @ts-ignore
          targetName: target.name,
          // @ts-ignore
          accountId: target.accountId,
          pendingRevalidation: { total: 0, kept: 0, cancelled: 0, retriggered: 0, errors: 1 },
          historicalAudit: { total: 0, reasonable: 0, unreasonable: 0, correctionGenerated: 0, errors: 1 },
          errors: [errMsg],
          duration: Date.now() - startTime
        });
      }
      if (i < targets.length - 1 && (i + 1) % REVALIDATION_CONFIG.batchSize === 0) {
        await new Promise((resolve) => setTimeout(resolve, REVALIDATION_CONFIG.batchDelayMs));
      }
    }
  } catch (err) {
    errors.push(`\u5168\u91CF\u91CD\u8BC4\u4F30\u5931\u8D25: ${err.message}`);
    log115.warn(`[CmdRevalidator] \u5168\u91CF\u91CD\u8BC4\u4F30\u5931\u8D25: ${err.message}`);
  }
  const fullResult = {
    version: SYSTEM_VERSION,
    triggeredAt,
    completedAt: /* @__PURE__ */ new Date(),
    targetsProcessed: targetResults.length,
    totalPendingRevalidated: targetResults.reduce((sum2, r) => sum2 + r.pendingRevalidation.total, 0),
    totalPendingCancelled: targetResults.reduce((sum2, r) => sum2 + r.pendingRevalidation.cancelled, 0),
    totalPendingRetriggered: targetResults.reduce((sum2, r) => sum2 + r.pendingRevalidation.retriggered, 0),
    totalHistoricalAudited: targetResults.reduce((sum2, r) => sum2 + r.historicalAudit.total, 0),
    totalCorrectionsGenerated: targetResults.reduce((sum2, r) => sum2 + r.historicalAudit.correctionGenerated, 0),
    targetResults,
    errors
  };
  auditSystemAction("system.deploy", {
    description: `v${SYSTEM_VERSION} \u90E8\u7F72\u540E\u6307\u4EE4\u91CD\u8BC4\u4F30\u4E0E\u7EA0\u9519\u5B8C\u6210`,
    metadata: {
      version: SYSTEM_VERSION,
      duration: fullResult.completedAt.getTime() - triggeredAt.getTime(),
      targetsProcessed: fullResult.targetsProcessed,
      pendingRevalidated: fullResult.totalPendingRevalidated,
      pendingCancelled: fullResult.totalPendingCancelled,
      pendingRetriggered: fullResult.totalPendingRetriggered,
      historicalAudited: fullResult.totalHistoricalAudited,
      correctionsGenerated: fullResult.totalCorrectionsGenerated
    }
  });
  try {
    const database = await getDb();
    if (database) {
      await database.execute(
        sql`INSERT INTO optimization_events 
            (account_id, event_category, action_type, action_detail, change_reason, 
             algorithm_version, status, api_sync_status)
            VALUES (0, 'settings_change', 'auto_correction',
                    ${JSON.stringify({
          type: "post_deploy_revalidation",
          version: SYSTEM_VERSION,
          targetsProcessed: fullResult.targetsProcessed,
          pendingRevalidated: fullResult.totalPendingRevalidated,
          pendingCancelled: fullResult.totalPendingCancelled,
          pendingRetriggered: fullResult.totalPendingRetriggered,
          historicalAudited: fullResult.totalHistoricalAudited,
          correctionsGenerated: fullResult.totalCorrectionsGenerated,
          duration: fullResult.completedAt.getTime() - triggeredAt.getTime()
        })},
                    ${`v${SYSTEM_VERSION} \u90E8\u7F72\u540E\u91CD\u8BC4\u4F30: ${fullResult.targetsProcessed}\u76EE\u6807, pending=${fullResult.totalPendingRevalidated}(\u53D6\u6D88${fullResult.totalPendingCancelled},\u91CD\u89E6\u53D1${fullResult.totalPendingRetriggered}), \u5386\u53F2\u7EA0\u6B63=${fullResult.totalCorrectionsGenerated}`},
                    ${`v${SYSTEM_VERSION}`}, 'success', 'not_applicable')`
      );
    }
  } catch (logErr) {
    log115.warn(`[CmdRevalidator] \u8BB0\u5F55\u91CD\u8BC4\u4F30\u7ED3\u679C\u5931\u8D25: ${logErr.message}`);
  }
  log115.info(`[CmdRevalidator] ========================================`);
  log115.info(`[CmdRevalidator] v${SYSTEM_VERSION} \u5168\u91CF\u6307\u4EE4\u91CD\u8BC4\u4F30\u4E0E\u7EA0\u9519\u5B8C\u6210!`);
  log115.info(`[CmdRevalidator] \u76EE\u6807: ${fullResult.targetsProcessed}\u4E2A`);
  log115.info(`[CmdRevalidator] Pending: ${fullResult.totalPendingRevalidated}\u6761\u8BC4\u4F30, ${fullResult.totalPendingCancelled}\u6761\u53D6\u6D88, ${fullResult.totalPendingRetriggered}\u6761\u91CD\u89E6\u53D1`);
  log115.info(`[CmdRevalidator] \u5386\u53F2: ${fullResult.totalHistoricalAudited}\u6761\u5BA1\u8BA1, ${fullResult.totalCorrectionsGenerated}\u6761\u7EA0\u6B63`);
  log115.info(`[CmdRevalidator] \u8017\u65F6: ${((fullResult.completedAt.getTime() - triggeredAt.getTime()) / 1e3).toFixed(1)}\u79D2`);
  log115.info(`[CmdRevalidator] ========================================`);
  return fullResult;
}
async function revalidateTarget(targetId) {
  const startTime = Date.now();
  try {
    const { getOptimizationTargetConfig: getOptimizationTargetConfig2 } = await Promise.resolve().then(() => (init_optimizationTargetEngine(), optimizationTargetEngine_exports));
    const config2 = await getOptimizationTargetConfig2(targetId);
    if (!config2) {
      return {
        targetId,
        targetName: "unknown",
        accountId: 0,
        pendingRevalidation: { total: 0, kept: 0, cancelled: 0, retriggered: 0, errors: 0 },
        historicalAudit: { total: 0, reasonable: 0, unreasonable: 0, correctionGenerated: 0, errors: 0 },
        errors: ["\u4F18\u5316\u76EE\u6807\u4E0D\u5B58\u5728\u6216\u5DF2\u7981\u7528"],
        duration: Date.now() - startTime
      };
    }
    const pendingResult = await revalidatePendingCommands(targetId, config2.name, config2.accountId);
    const auditResult = await auditAndCorrectHistoricalCommands(targetId, config2.name, config2.accountId);
    return {
      targetId,
      targetName: config2.name,
      accountId: config2.accountId,
      pendingRevalidation: pendingResult,
      historicalAudit: auditResult,
      errors: [],
      duration: Date.now() - startTime
    };
  } catch (err) {
    return {
      targetId,
      targetName: "unknown",
      accountId: 0,
      pendingRevalidation: { total: 0, kept: 0, cancelled: 0, retriggered: 0, errors: 1 },
      historicalAudit: { total: 0, reasonable: 0, unreasonable: 0, correctionGenerated: 0, errors: 1 },
      errors: [err.message],
      duration: Date.now() - startTime
    };
  }
}
var log115, REVALIDATION_CONFIG;
var init_postDeployCommandRevalidator = __esm({
  "server/postDeployCommandRevalidator.ts"() {
    "use strict";
    init_db2();
    init_drizzle_orm();
    init_logger();
    init_systemVersion();
    init_auditLogService2();
    init_safetyBoundary();
    init_bidOptimizer();
    log115 = createModuleLogger("CmdRevalidator");
    REVALIDATION_CONFIG = {
      /** 单次重评估的最大pending指令数 */
      maxPendingPerTarget: 500,
      /** 单次审计的最大synced指令数 */
      maxSyncedPerTarget: 300,
      /** pending指令的最大有效天数 */
      pendingExpiryDays: 7,
      /** synced指令的回溯审计天数 */
      auditLookbackDays: 3,
      /** 纠正指令的最大出价调整幅度（相对于当前出价） */
      maxCorrectionChangePercent: 0.15,
      /** 出价绝对下限 */
      absoluteMinBid: DEFAULT_MIN_BID,
      /** 出价绝对上限 */
      absoluteMaxBid: DEFAULT_MAX_BID_CPC,
      /** 批量处理大小 */
      batchSize: 50,
      /** 批次间等待时间(ms) */
      batchDelayMs: 500
    };
    __name(revalidatePendingCommands, "revalidatePendingCommands");
    __name(evaluatePendingCommand, "evaluatePendingCommand");
    __name(auditAndCorrectHistoricalCommands, "auditAndCorrectHistoricalCommands");
    __name(auditSyncedCommand, "auditSyncedCommand");
    __name(generateCorrectionCommand, "generateCorrectionCommand");
    __name(runFullRevalidation, "runFullRevalidation");
    __name(revalidateTarget, "revalidateTarget");
  }
});

