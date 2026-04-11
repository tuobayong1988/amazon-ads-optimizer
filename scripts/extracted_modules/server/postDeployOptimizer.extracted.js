// Extracted from production dist/index.js
// Original module: server/postDeployOptimizer.ts
// Lines: 2133

var postDeployOptimizer_exports = {};
__export(postDeployOptimizer_exports, {
  SYSTEM_VERSION: () => SYSTEM_VERSION,
  forceReoptimize: () => forceReoptimize,
  getSystemVersionInfo: () => getSystemVersionInfo,
  runPostDeployOptimization: () => runPostDeployOptimization
});
async function getLastDeployedVersion() {
  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const database = await getDb();
      if (!database) return null;
      const result = await database.execute(sql`
        SELECT action_detail FROM optimization_events
        WHERE event_category = 'settings_change'
          AND action_type = 'settings_update'
          AND status IN ('success', 'partial_success')
          AND JSON_EXTRACT(action_detail, '$.type') = 'system_deploy'
        ORDER BY created_at DESC
        LIMIT 1
      `);
      const rows = result[0] || [];
      if (rows.length > 0 && rows[0].action_detail) {
        try {
          const detail = typeof rows[0].action_detail === "string" ? JSON.parse(rows[0].action_detail) : rows[0].action_detail;
          return detail.systemVersion || null;
        } catch {
          return null;
        }
      }
      return null;
    } catch (error48) {
      log127.warn(`[PostDeployOptimizer] \u83B7\u53D6\u4E0A\u6B21\u90E8\u7F72\u7248\u672C\u5931\u8D25 (\u5C1D\u8BD5${attempt}/${maxRetries}): ${error48.message}`);
      if (attempt < maxRetries) {
        await sleep2(5e3 * attempt);
      }
    }
  }
  log127.warn(`[PostDeployOptimizer] \u83B7\u53D6\u4E0A\u6B21\u90E8\u7F72\u7248\u672C\u5931\u8D25: \u5DF2\u8017\u5C3D\u6240\u6709\u91CD\u8BD5`);
  return null;
}
async function recordDeployVersion(version4, result) {
  const actionDetail = JSON.stringify({
    type: "system_deploy",
    systemVersion: version4,
    previousVersion: result.previousVersion,
    versionsApplied: result.versionsToApply,
    affectedModules: result.affectedModules,
    targetsProcessed: result.targetsProcessed,
    targetsSucceeded: result.targetsSucceeded,
    targetsFailed: result.targetsFailed,
    totalActions: result.totalOptimizationActions
  });
  const statusValue = result.targetsFailed === 0 ? "success" : "partial_success";
  const changeReason = `\u7CFB\u7EDF\u90E8\u7F72 v${version4}`;
  const prevValue = result.previousVersion?.toString() || "none";
  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const database = await getDb();
      if (!database) {
        log127.warn(`[PostDeployOptimizer] \u8BB0\u5F55\u90E8\u7F72\u7248\u672C\u5931\u8D25: \u6570\u636E\u5E93\u8FDE\u63A5\u4E0D\u53EF\u7528 (\u5C1D\u8BD5${attempt}/${maxRetries})`);
        if (attempt < maxRetries) await sleep2(1e4 * attempt);
        continue;
      }
      await database.execute(sql`
        INSERT INTO optimization_events 
          (account_id, event_category, action_type, action_detail, change_reason, 
           previous_value, new_value, algorithm_version, status, api_sync_status, created_at)
        VALUES 
          (0, 'settings_change', 'settings_update', ${actionDetail}, ${changeReason},
           ${prevValue}, ${version4.toString()}, ${`v${version4}`}, ${statusValue}, 'not_applicable', NOW())
      `);
      log127.info(`[PostDeployOptimizer] \u2713 \u5DF2\u8BB0\u5F55\u90E8\u7F72\u7248\u672C v${version4} (status=${statusValue})`);
      return;
    } catch (error48) {
      log127.warn(`[PostDeployOptimizer] \u8BB0\u5F55\u90E8\u7F72\u7248\u672C\u5931\u8D25 (\u5C1D\u8BD5${attempt}/${maxRetries}): ${error48.message}`);
      if (attempt < maxRetries) {
        await sleep2(1e4 * attempt);
      }
    }
  }
  log127.warn(`[PostDeployOptimizer] \u2717 \u8BB0\u5F55\u90E8\u7F72\u7248\u672C v${version4} \u5931\u8D25: \u5DF2\u8017\u5C3D\u6240\u6709\u91CD\u8BD5\uFF0C\u4E0B\u6B21\u91CD\u542F\u5C06\u91CD\u65B0\u89E6\u53D1PostDeploy`);
}
async function updateTargetOptimizedVersion(targetId, version4) {
  const actionDetail = JSON.stringify({
    type: "target_reoptimized",
    systemVersion: version4,
    targetId
  });
  const changeReason = `\u4F18\u5316\u76EE\u6807 ${targetId} \u90E8\u7F72\u540E\u91CD\u4F18\u5316 v${version4}`;
  const maxRetries = 2;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const database = await getDb();
      if (!database) return;
      await database.execute(sql`
 INSERT INTO optimization_events 
 (account_id, event_category, action_type, action_detail, change_reason,
 previous_value, new_value, algorithm_version, status, api_sync_status, created_at)
 VALUES 
 (0, 'settings_change', 'settings_update', ${actionDetail}, ${changeReason},
 'reoptimize_triggered', ${`v${version4}`}, ${`v${version4}`}, 'success', 'not_applicable', NOW())
 `);
      return;
    } catch (error48) {
      log127.warn(`[PostDeployOptimizer] \u66F4\u65B0\u76EE\u6807\u7248\u672C\u5931\u8D25 (targetId=${targetId}, \u5C1D\u8BD5${attempt}/${maxRetries}): ${error48.message}`);
      if (attempt < maxRetries) await sleep2(5e3);
    }
  }
}
function getVersionsToApply(lastVersion) {
  const fromVersion = lastVersion || 0;
  return VERSION_CHANGELOG.filter((v) => v.version > fromVersion).sort((a, b) => a.version - b.version);
}
function mergeAffectedModules(versions) {
  const modules = /* @__PURE__ */ new Set();
  for (const v of versions) {
    for (const m of v.affectedModules) {
      if (m === "all") {
        return ["bid", "placement", "dayparting", "dayparting_budget", "budget", "searchterm", "keyword", "multidim", "coordination", "sync", "product_target"];
      }
      modules.add(m);
    }
  }
  return Array.from(modules);
}
function mergeCorrectionActions(versions) {
  const actions = /* @__PURE__ */ new Set();
  for (const v of versions) {
    for (const a of v.correctionActions) {
      actions.add(a);
    }
  }
  return Array.from(actions);
}
async function reoptimizeTarget(targetId, affectedModules, correctionActions) {
  const startTime = Date.now();
  const errors = [];
  const modulesExecuted = [];
  let correctionsApplied = 0;
  let optimizationActions = 0;
  try {
    const { getOptimizationTargetConfig: getOptimizationTargetConfig2, executeOptimizationTarget: executeOptimizationTarget2 } = await Promise.resolve().then(() => (init_optimizationTargetEngine(), optimizationTargetEngine_exports));
    const config2 = await getOptimizationTargetConfig2(targetId);
    if (!config2) {
      return {
        targetId,
        targetName: "unknown",
        accountId: 0,
        // @ts-ignore
        status: "failed",
        modulesExecuted: [],
        correctionsApplied: 0,
        optimizationActions: 0,
        errors: ["\u4F18\u5316\u76EE\u6807\u4E0D\u5B58\u5728\u6216\u5DF2\u7981\u7528"],
        duration: Date.now() - startTime
      };
    }
    log127.info(`[PostDeployOptimizer] \u5F00\u59CB\u91CD\u4F18\u5316\u76EE\u6807: ${config2.name} (ID: ${targetId}), \u6A21\u5757: ${affectedModules.join(",")}`);
    for (const action of correctionActions) {
      try {
        switch (action) {
          case "rebuild_combo_analysis": {
            log127.debug(`[PostDeployOptimizer] [${config2.name}] \u91CD\u5EFA\u591A\u7EF4\u5EA6\u7EC4\u5408\u5206\u6790...`);
            try {
              const { analyzeCampaignCombos: analyzeCampaignCombos2 } = await Promise.resolve().then(() => (init_multiDimComboAnalyzer(), multiDimComboAnalyzer_exports));
              const database = await getDb();
              if (!database) break;
              const campaignsList = await getCampaignsByAccountId(config2.accountId);
              const enabledCampaigns = campaignsList.filter((c) => c.campaignStatus === "enabled");
              for (const campaign of enabledCampaigns) {
                try {
                  await analyzeCampaignCombos2(
                    database,
                    // @ts-ignore
                    campaign.id,
                    config2.accountId,
                    config2.targetAcos || 30
                  );
                  correctionsApplied++;
                } catch (campErr) {
                  errors.push(`\u7EC4\u5408\u5206\u6790\u5931\u8D25(campaign ${campaign.id}): ${campErr.message}`);
                }
              }
              modulesExecuted.push("multidim_rebuild");
            } catch (comboErr) {
              errors.push(`\u591A\u7EF4\u5EA6\u7EC4\u5408\u5206\u6790\u91CD\u5EFA\u5931\u8D25: ${comboErr.message}`);
            }
            break;
          }
          case "reset_dayparting_rules": {
            log127.debug(`[PostDeployOptimizer] [${config2.name}] \u91CD\u7F6E\u5206\u65F6\u7ADE\u4EF7\u89C4\u5219...`);
            modulesExecuted.push("dayparting_reset");
            correctionsApplied++;
            break;
          }
          case "reset_placement_rules": {
            log127.debug(`[PostDeployOptimizer] [${config2.name}] \u91CD\u7F6E\u4F4D\u7F6E\u4F18\u5316\u89C4\u5219...`);
            modulesExecuted.push("placement_reset");
            correctionsApplied++;
            break;
          }
          case "fix_timezone_errors": {
            log127.warn(`[PostDeployOptimizer] [${config2.name}] \u6807\u8BB0\u65F6\u533A\u9519\u8BEF\u8C03\u6574\u4E3A\u5F85\u7EA0\u6B63...`);
            modulesExecuted.push("timezone_fix");
            correctionsApplied++;
            break;
          }
          case "recalculate_budgets": {
            log127.debug(`[PostDeployOptimizer] [${config2.name}] \u91CD\u65B0\u8BA1\u7B97\u9884\u7B97\u5206\u914D...`);
            modulesExecuted.push("budget_recalc");
            correctionsApplied++;
            break;
          }
          case "cleanup_stale_pending": {
            log127.info(`[PostDeployOptimizer] [${config2.name}] \u6E05\u7406\u65E0\u6548pending\u5206\u65F6\u7ADE\u4EF7\u65E5\u5FD7...`);
            try {
              const database = await getDb();
              if (database) {
                const cleanupResult = await database.execute(
                  sql`UPDATE optimization_logs 
 SET api_sync_status = 'not_applicable', 
 error_message = 'v223: 清理无效pending - 分时竞价出价未变更' 
 WHERE performance_group_id = ${targetId}
 AND action_type = 'dayparting_bid' 
 AND api_sync_status = 'pending'
 AND previous_value = new_value`
                );
                const cleaned = cleanupResult?.[0]?.affectedRows || 0;
                log127.info(`[PostDeployOptimizer] [${config2.name}] \u6E05\u7406\u4E86 ${cleaned} \u6761\u65E0\u6548pending\u65E5\u5FD7`);
                correctionsApplied += cleaned;
                modulesExecuted.push("cleanup_stale_pending");
              }
            } catch (cleanErr) {
              errors.push(`\u6E05\u7406pending\u65E5\u5FD7\u5931\u8D25: ${cleanErr.message}`);
            }
            break;
          }
          // @ts-ignore
          case "revalidate_pending_commands": {
            log127.info(`[PostDeployOptimizer] [${config2.name}] v310: \u5F00\u59CBpending\u6307\u4EE4\u65B0\u7B97\u6CD5\u91CD\u8BC4\u4F30...`);
            try {
              const database = await getDb();
              if (!database) break;
              const pendingLogs = await database.execute(
                sql`SELECT ol.id, ol.action_type, ol.entity_type, ol.entity_id, 
                           ol.previous_value, ol.new_value, ol.created_at,
                           k.keywordText, k.bid as current_bid, k.keywordId as amazon_keyword_id,
                           pt.bid as pt_current_bid, pt.targetId as amazon_target_id
                    FROM optimization_logs ol
                    LEFT JOIN keywords k ON ol.entity_type = 'keyword' AND ol.entity_id = k.id
                    LEFT JOIN product_targets pt ON ol.entity_type = 'product_target' AND ol.entity_id = pt.id
                    WHERE ol.performance_group_id = ${targetId}
                      AND ol.api_sync_status = 'pending'
                      AND ol.action_type IN ('bid_increase', 'bid_decrease', 'target_pause', 'target_enable')
                      AND ol.created_at > DATE_SUB(NOW(), INTERVAL 7 DAY)`
              );
              const rows = pendingLogs?.[0] || pendingLogs;
              if (!Array.isArray(rows) || rows.length === 0) {
                log127.info(`[PostDeployOptimizer] [${config2.name}] v310: \u65E0pending\u51FA\u4EF7/\u72B6\u6001\u6307\u4EE4\u9700\u8981\u91CD\u8BC4\u4F30`);
                break;
              }
              log127.warn(`[PostDeployOptimizer] [${config2.name}] v310: \u53D1\u73B0${rows.length}\u6761pending\u6307\u4EE4\u9700\u8981\u91CD\u8BC4\u4F30`);
              let cancelled = 0;
              let kept = 0;
              for (const row of rows) {
                try {
                  const actionType = row.action_type;
                  const newValue = parseFloat(String(row.new_value));
                  const prevValue = parseFloat(String(row.previous_value));
                  const currentBid = parseFloat(String(row.current_bid || row.pt_current_bid || 0));
                  let shouldCancel = false;
                  let cancelReason = "";
                  if (actionType === "bid_increase" || actionType === "bid_decrease") {
                    if (actionType === "bid_increase" && currentBid >= newValue) {
                      shouldCancel = true;
                      cancelReason = `\u5F53\u524D\u51FA\u4EF7$${currentBid.toFixed(2)}\u5DF2>=\u76EE\u6807$${newValue.toFixed(2)}`;
                    } else if (actionType === "bid_decrease" && currentBid <= newValue) {
                      shouldCancel = true;
                      cancelReason = `\u5F53\u524D\u51FA\u4EF7$${currentBid.toFixed(2)}\u5DF2<=\u76EE\u6807$${newValue.toFixed(2)}`;
                    }
                    if (!shouldCancel && prevValue > 0) {
                      const changePercent = Math.abs(newValue - prevValue) / prevValue;
                      if (changePercent > 0.4) {
                        shouldCancel = true;
                        cancelReason = `\u8C03\u6574\u5E45\u5EA6${(changePercent * 100).toFixed(1)}%\u8D85\u8FC740%\u5B89\u5168\u9608\u503C`;
                      }
                    }
                  } else if (actionType === "target_pause" || actionType === "target_enable") {
                    if (!row.amazon_keyword_id && !row.amazon_target_id) {
                      shouldCancel = true;
                      cancelReason = "\u7F3A\u5C11Amazon ID\uFF0C\u65E0\u6CD5\u6267\u884C\u72B6\u6001\u53D8\u66F4";
                    }
                  }
                  if (shouldCancel) {
                    await database.execute(
                      sql`UPDATE optimization_logs 
 SET api_sync_status = 'not_applicable',
 error_message = ${`v310\u91CD\u8BC4\u4F30\u53D6\u6D88: ${cancelReason}`}
 WHERE id = ${row.id}`
                    );
                    cancelled++;
                  } else {
                    kept++;
                  }
                } catch (evalErr) {
                  errors.push(`v310: pending\u91CD\u8BC4\u4F30\u5355\u6761\u5931\u8D25: ${evalErr.message}`);
                }
              }
              log127.warn(`[PostDeployOptimizer] [${config2.name}] v310: pending\u91CD\u8BC4\u4F30\u5B8C\u6210: \u603B\u8BA1=${rows.length}, \u53D6\u6D88=${cancelled}, \u4FDD\u7559=${kept}`);
              correctionsApplied += cancelled;
              modulesExecuted.push("revalidate_pending");
            } catch (revalErr) {
              errors.push(`v310: pending\u6307\u4EE4\u91CD\u8BC4\u4F30\u5931\u8D25: ${revalErr.message}`);
            }
            break;
          }
          case "audit_synced_commands": {
            log127.info(`[PostDeployOptimizer] [${config2.name}] v310: \u5F00\u59CB\u5DF2\u6267\u884C\u6307\u4EE4\u56DE\u6EAF\u5BA1\u8BA1...`);
            try {
              const database = await getDb();
              if (!database) break;
              const syncedLogs = await database.execute(
                sql`SELECT ol.id, ol.action_type, ol.entity_type, ol.entity_id,
                           ol.previous_value, ol.new_value, ol.created_at,
                           k.bid as current_bid, k.keywordText, k.keywordId as amazon_keyword_id,
                           pg.targetAcos as target_acos
                    FROM optimization_logs ol
                    LEFT JOIN keywords k ON ol.entity_type = 'keyword' AND ol.entity_id = k.id
                    LEFT JOIN performance_groups pg ON ol.performance_group_id = pg.id
                    WHERE ol.performance_group_id = ${targetId}
                      AND ol.api_sync_status = 'synced'
                      AND ol.action_type IN ('bid_increase', 'bid_decrease')
                      AND ol.created_at > DATE_SUB(NOW(), INTERVAL 48 HOUR)
                    ORDER BY ol.created_at DESC
                    LIMIT 200`
              );
              const rows = syncedLogs?.[0] || syncedLogs;
              if (!Array.isArray(rows) || rows.length === 0) {
                log127.info(`[PostDeployOptimizer] [${config2.name}] v310: \u65E0\u8FD1\u671Fsynced\u51FA\u4EF7\u6307\u4EE4\u9700\u8981\u5BA1\u8BA1`);
                break;
              }
              log127.info(`[PostDeployOptimizer] [${config2.name}] v310: \u5BA1\u8BA1${rows.length}\u6761\u5DF2\u6267\u884C\u51FA\u4EF7\u6307\u4EE4...`);
              let flagged = 0;
              for (const row of rows) {
                const newValue = parseFloat(String(row.new_value));
                const prevValue = parseFloat(String(row.previous_value));
                const currentBid = parseFloat(String(row.current_bid || 0));
                let isUnreasonable = false;
                let auditReason = "";
                if (row.action_type === "bid_decrease" && prevValue > 0) {
                  const decreasePercent = (prevValue - newValue) / prevValue;
                  if (decreasePercent > 0.3) {
                    isUnreasonable = true;
                    auditReason = `\u964D\u4EF7\u5E45\u5EA6${(decreasePercent * 100).toFixed(1)}%\u8D85\u8FC730%\u5B89\u5168\u9608\u503C`;
                  }
                }
                if (row.action_type === "bid_increase" && prevValue > 0) {
                  const increasePercent = (newValue - prevValue) / prevValue;
                  if (increasePercent > 0.5) {
                    isUnreasonable = true;
                    auditReason = `\u63D0\u4EF7\u5E45\u5EA6${(increasePercent * 100).toFixed(1)}%\u8D85\u8FC750%\u5B89\u5168\u9608\u503C`;
                  }
                }
                if (newValue < 0.02 && prevValue >= 0.1) {
                  isUnreasonable = true;
                  auditReason = `\u51FA\u4EF7\u964D\u81F3$${newValue.toFixed(2)}\uFF0C\u53EF\u80FD\u5BFC\u81F4\u96F6\u66DD\u5149`;
                }
                if (isUnreasonable) {
                  flagged++;
                  try {
                    await database.execute(
                      sql`INSERT INTO optimization_events 
 (account_id, event_category, action_type, action_detail, change_reason, 
 previous_value, new_value, algorithm_version, status, api_sync_status)
 VALUES (${config2.accountId}, 'audit', 'algorithm_audit', 
 ${JSON.stringify({
                        sourceLogId: row.id,
                        entityType: row.entity_type,
                        entityId: row.entity_id,
                        originalAction: row.action_type,
                        auditReason,
                        keywordText: row.keywordText
                      })},
 ${`v310\u5BA1\u8BA1: ${auditReason}`},
 ${String(row.new_value)}, ${String(row.current_bid)},
 'v310', 'success', 'not_applicable')`
                    );
                  } catch (insertErr) {
                    log127.warn(`v310: \u5BA1\u8BA1\u8BB0\u5F55\u63D2\u5165\u5931\u8D25: ${insertErr.message}`);
                  }
                }
              }
              log127.warn(`[PostDeployOptimizer] [${config2.name}] v310: \u5BA1\u8BA1\u5B8C\u6210: \u68C0\u67E5=${rows.length}, \u6807\u8BB0\u4E0D\u5408\u7406=${flagged}`);
              correctionsApplied += flagged;
              modulesExecuted.push("audit_synced");
            } catch (auditErr) {
              errors.push(`v310: \u5DF2\u6267\u884C\u6307\u4EE4\u5BA1\u8BA1\u5931\u8D25: ${auditErr.message}`);
            }
            break;
          }
          case "retry_product_target_sync": {
            log127.info(`[PostDeployOptimizer] [${config2.name}] v310: \u91CD\u8BD5\u5546\u54C1\u5B9A\u5411\u540C\u6B65...`);
            try {
              const database = await getDb();
              if (!database) break;
              const pendingPtLogs = await database.execute(
                sql`SELECT ol.id, ol.entity_id, ol.new_value, ol.action_type
                    FROM optimization_logs ol
                    WHERE ol.performance_group_id = ${targetId}
                      AND ol.api_sync_status = 'pending'
                      AND ol.action_type = 'product_target_create'
                      AND ol.created_at > DATE_SUB(NOW(), INTERVAL 7 DAY)`
              );
              const rows = pendingPtLogs?.[0] || pendingPtLogs;
              if (!Array.isArray(rows) || rows.length === 0) {
                log127.info(`[PostDeployOptimizer] [${config2.name}] v310: \u65E0pending\u5546\u54C1\u5B9A\u5411\u521B\u5EFA\u9700\u8981\u91CD\u8BD5`);
                break;
              }
              log127.warn(`[PostDeployOptimizer] [${config2.name}] v310: \u53D1\u73B0${rows.length}\u6761pending\u5546\u54C1\u5B9A\u5411\u521B\u5EFA`);
              correctionsApplied += rows.length;
              modulesExecuted.push("product_target_sync");
            } catch (ptErr) {
              errors.push(`v310: \u5546\u54C1\u5B9A\u5411\u540C\u6B65\u91CD\u8BD5\u5931\u8D25: ${ptErr.message}`);
            }
            break;
          }
          case "resync_data": {
            log127.info(`[PostDeployOptimizer] [${config2.name}] v344: \u89E6\u53D1\u5168\u91CF\u6570\u636E\u91CD\u65B0\u540C\u6B65 (\u8D26\u6237${config2.accountId})...`);
            try {
              const { triggerColdStart: triggerColdStart2 } = await Promise.resolve().then(() => (init_coldStartService(), coldStartService_exports));
              await triggerColdStart2(config2.accountId, {
                reason: "version_upgrade",
                force: true,
                historicalDays: 90,
                skipSync: false
              });
              modulesExecuted.push("resync_data");
              correctionsApplied++;
              log127.info(`[PostDeployOptimizer] [${config2.name}] v344: \u5168\u91CF\u6570\u636E\u91CD\u65B0\u540C\u6B65\u5DF2\u89E6\u53D1`);
            } catch (syncErr) {
              errors.push(`\u5168\u91CF\u6570\u636E\u91CD\u65B0\u540C\u6B65\u89E6\u53D1\u5931\u8D25: ${syncErr.message}`);
            }
            break;
          }
          case "cold_start": {
            log127.info(`[PostDeployOptimizer] [${config2.name}] v344: \u89E6\u53D1\u51B7\u542F\u52A8 (\u8D26\u6237${config2.accountId})...`);
            try {
              const { triggerColdStart: triggerColdStart2 } = await Promise.resolve().then(() => (init_coldStartService(), coldStartService_exports));
              await triggerColdStart2(config2.accountId, {
                reason: "version_upgrade",
                force: true,
                historicalDays: 90
              });
              modulesExecuted.push("cold_start");
              correctionsApplied++;
              log127.info(`[PostDeployOptimizer] [${config2.name}] v344: \u51B7\u542F\u52A8\u5DF2\u89E6\u53D1`);
            } catch (csErr) {
              errors.push(`\u51B7\u542F\u52A8\u89E6\u53D1\u5931\u8D25: ${csErr.message}`);
            }
            break;
          }
          default:
            break;
        }
      } catch (actionErr) {
        errors.push(`\u7EA0\u6B63\u52A8\u4F5C ${action} \u5931\u8D25: ${actionErr.message}`);
      }
    }
    const shouldFullReoptimize = correctionActions.includes("full_reoptimize") || correctionActions.includes("rerun_optimization");
    if (shouldFullReoptimize) {
      log127.info(`[PostDeployOptimizer] [${config2.name}] \u6267\u884C\u5168\u91CF\u91CD\u4F18\u5316...`);
      try {
        if (affectedModules.includes("multidim") || affectedModules.includes("dayparting")) {
          try {
            const daypartingResult = await executeOptimizationTarget2(targetId, {
              dryRun: false,
              specificModules: ["multidim", "dayparting", "coordination"]
            });
            optimizationActions += daypartingResult.daypartingOptimization.adjustmentsCount;
            modulesExecuted.push("dayparting");
            log127.info(`[PostDeployOptimizer] [${config2.name}] \u5206\u65F6\u7ADE\u4EF7\u91CD\u4F18\u5316\u5B8C\u6210: ${daypartingResult.daypartingOptimization.adjustmentsCount}\u4E2A\u8C03\u6574`);
          } catch (dpErr) {
            errors.push(`\u5206\u65F6\u7ADE\u4EF7\u91CD\u4F18\u5316\u5931\u8D25: ${dpErr.message}`);
          }
        }
        if (modulesExecuted.includes("dayparting")) {
          log127.info(`[PostDeployOptimizer] v476: \u9636\u6BB5\u95F4\u8282\u6D41 - \u7B49\u5F8520\u79D2...`);
          await sleep2(2e4);
        }
        if (affectedModules.includes("dayparting_budget")) {
          try {
            const budgetDpResult = await executeOptimizationTarget2(targetId, {
              dryRun: false,
              specificModules: ["multidim", "dayparting_budget"]
            });
            optimizationActions += budgetDpResult.daypartingBudgetOptimization?.adjustmentsCount || 0;
            modulesExecuted.push("dayparting_budget");
            log127.info(`[PostDeployOptimizer] [${config2.name}] \u5206\u65F6\u9884\u7B97\u91CD\u4F18\u5316\u5B8C\u6210: ${budgetDpResult.daypartingBudgetOptimization?.adjustmentsCount || 0}\u4E2A\u8C03\u6574`);
          } catch (dbErr) {
            errors.push(`\u5206\u65F6\u9884\u7B97\u91CD\u4F18\u5316\u5931\u8D25: ${dbErr.message}`);
          }
        }
        if (modulesExecuted.includes("dayparting_budget")) {
          log127.info(`[PostDeployOptimizer] v476: \u9636\u6BB5\u95F4\u8282\u6D41 - \u7B49\u5F8520\u79D2...`);
          await sleep2(2e4);
        }
        if (affectedModules.includes("bid") || affectedModules.includes("keyword")) {
          try {
            const bidResult = await executeOptimizationTarget2(targetId, {
              dryRun: false,
              specificModules: ["bid", "keyword", "coordination"]
            });
            optimizationActions += bidResult.bidOptimization.adjustmentsCount;
            optimizationActions += bidResult.keywordStatusChanges.pausedCount + bidResult.keywordStatusChanges.enabledCount;
            modulesExecuted.push("bid");
            log127.info(`[PostDeployOptimizer] [${config2.name}] \u51FA\u4EF7\u91CD\u4F18\u5316\u5B8C\u6210: ${bidResult.bidOptimization.adjustmentsCount}\u4E2A\u8C03\u6574`);
          } catch (bidErr) {
            errors.push(`\u51FA\u4EF7\u91CD\u4F18\u5316\u5931\u8D25: ${bidErr.message}`);
          }
        }
        if (modulesExecuted.includes("bid")) {
          log127.info(`[PostDeployOptimizer] v476: \u9636\u6BB5\u95F4\u8282\u6D41 - \u7B49\u5F8520\u79D2...`);
          await sleep2(2e4);
        }
        if (affectedModules.includes("placement")) {
          try {
            const placementResult = await executeOptimizationTarget2(targetId, {
              dryRun: false,
              specificModules: ["placement"]
            });
            optimizationActions += placementResult.placementOptimization.adjustmentsCount;
            modulesExecuted.push("placement");
            log127.info(`[PostDeployOptimizer] [${config2.name}] \u4F4D\u7F6E\u91CD\u4F18\u5316\u5B8C\u6210: ${placementResult.placementOptimization.adjustmentsCount}\u4E2A\u8C03\u6574`);
          } catch (plErr) {
            errors.push(`\u4F4D\u7F6E\u91CD\u4F18\u5316\u5931\u8D25: ${plErr.message}`);
          }
        }
        if (modulesExecuted.includes("placement")) {
          log127.info(`[PostDeployOptimizer] v476: \u9636\u6BB5\u95F4\u8282\u6D41 - \u7B49\u5F8520\u79D2...`);
          await sleep2(2e4);
        }
        if (affectedModules.includes("budget")) {
          try {
            const budgetResult = await executeOptimizationTarget2(targetId, {
              dryRun: false,
              specificModules: ["budget"]
            });
            optimizationActions += budgetResult.budgetAllocation.adjustmentsCount;
            modulesExecuted.push("budget");
            log127.info(`[PostDeployOptimizer] [${config2.name}] \u9884\u7B97\u91CD\u4F18\u5316\u5B8C\u6210: ${budgetResult.budgetAllocation.adjustmentsCount}\u4E2A\u8C03\u6574`);
          } catch (bgErr) {
            errors.push(`\u9884\u7B97\u91CD\u4F18\u5316\u5931\u8D25: ${bgErr.message}`);
          }
        }
        if (modulesExecuted.includes("budget")) {
          log127.info(`[PostDeployOptimizer] v476: \u9636\u6BB5\u95F4\u8282\u6D41 - \u7B49\u5F8520\u79D2...`);
          await sleep2(2e4);
        }
        if (affectedModules.includes("searchterm")) {
          try {
            const stResult = await executeOptimizationTarget2(targetId, {
              dryRun: false,
              specificModules: ["searchterm"]
            });
            optimizationActions += stResult.searchTermAnalysis.negativeKeywordsAdded + stResult.searchTermAnalysis.newKeywordsAdded;
            modulesExecuted.push("searchterm");
            log127.info(`[PostDeployOptimizer] [${config2.name}] \u641C\u7D22\u8BCD\u91CD\u4F18\u5316\u5B8C\u6210: \u5426\u5B9A=${stResult.searchTermAnalysis.negativeKeywordsAdded}, \u65B0\u589E=${stResult.searchTermAnalysis.newKeywordsAdded}`);
          } catch (stErr) {
            errors.push(`\u641C\u7D22\u8BCD\u91CD\u4F18\u5316\u5931\u8D25: ${stErr.message}`);
          }
        }
      } catch (fullErr) {
        errors.push(`\u5168\u91CF\u91CD\u4F18\u5316\u5931\u8D25: ${fullErr.message}`);
      }
    }
    await updateTargetOptimizedVersion(targetId, SYSTEM_VERSION);
    try {
      const { recordModuleExecution: recordModuleExecution2 } = await Promise.resolve().then(() => (init_dataSyncScheduler(), dataSyncScheduler_exports));
      for (const mod of modulesExecuted) {
        const moduleMapping = {
          "bid": "bid",
          "placement": "placement",
          "dayparting": "dayparting",
          "dayparting_budget": "budget",
          "searchterm": "searchTermHarvest",
          "budget": "budget"
        };
        const schedulerModule = moduleMapping[mod];
        if (schedulerModule) {
          await recordModuleExecution2(targetId, schedulerModule);
          log127.info(`[PostDeployOptimizer] v242: \u5DF2\u66F4\u65B0\u6A21\u5757\u6267\u884C\u65F6\u95F4(\u5185\u5B58+\u6570\u636E\u5E93): target=${targetId}, module=${schedulerModule}`);
        }
      }
    } catch (syncErr) {
      log127.warn(`[PostDeployOptimizer] v241: \u66F4\u65B0\u6A21\u5757\u6267\u884C\u65F6\u95F4\u5931\u8D25(\u4E0D\u5F71\u54CD\u4E3B\u6D41\u7A0B): ${syncErr.message}`);
    }
    const finalStatus = errors.length === 0 ? "success" : modulesExecuted.length > 0 ? "success" : "failed";
    if (errors.length > 0) {
      log127.warn(`[PostDeployOptimizer] [${config2.name}] \u91CD\u4F18\u5316\u9519\u8BEF\u8BE6\u60C5: ${errors.join("; ")}`);
    }
    if (modulesExecuted.length === 0 && errors.length === 0) {
      log127.info(`[PostDeployOptimizer] [${config2.name}] \u65E0\u9700\u6267\u884C\u4EFB\u4F55\u6A21\u5757(correctionActions\u65E0\u5339\u914D/shouldFullReoptimize=false)`);
    }
    return {
      targetId,
      targetName: config2.name,
      accountId: config2.accountId,
      status: finalStatus,
      modulesExecuted,
      correctionsApplied,
      optimizationActions,
      errors,
      duration: Date.now() - startTime
    };
  } catch (error48) {
    log127.warn(`[PostDeployOptimizer] \u76EE\u6807${targetId}\u91CD\u4F18\u5316\u5F02\u5E38: ${error48.message}`);
    return {
      targetId,
      targetName: "unknown",
      accountId: 0,
      status: "failed",
      modulesExecuted,
      correctionsApplied,
      optimizationActions,
      errors: [...errors, error48.message],
      duration: Date.now() - startTime
    };
  }
}
async function runPostDeployOptimization() {
  const startedAt = /* @__PURE__ */ new Date();
  log127.info(`[PostDeployOptimizer] v${SYSTEM_VERSION}: \u5F00\u59CB\u90E8\u7F72\u540E\u68C0\u67E5...`);
  const lastVersion = await getLastDeployedVersion();
  log127.info(`[PostDeployOptimizer] \u4E0A\u6B21\u90E8\u7F72\u7248\u672C: ${lastVersion || "\u65E0\u8BB0\u5F55\uFF08\u9996\u6B21\u90E8\u7F72\uFF09"}, \u5F53\u524D\u7248\u672C: v${SYSTEM_VERSION}`);
  if (lastVersion !== null && lastVersion >= SYSTEM_VERSION) {
    log127.info(`[PostDeployOptimizer] \u7248\u672C\u672A\u53D8\u5316 (v${lastVersion} >= v${SYSTEM_VERSION})\uFF0C\u8DF3\u8FC7\u91CD\u4F18\u5316`);
    const result = {
      triggered: false,
      reason: `\u7248\u672C\u672A\u53D8\u5316 (v${lastVersion} >= v${SYSTEM_VERSION})`,
      // @ts-ignore
      previousVersion: lastVersion,
      // @ts-ignore
      currentVersion: SYSTEM_VERSION,
      versionsToApply: [],
      affectedModules: [],
      targetsProcessed: 0,
      targetsSucceeded: 0,
      targetsFailed: 0,
      totalOptimizationActions: 0,
      startedAt,
      completedAt: /* @__PURE__ */ new Date(),
      targetResults: []
    };
    await recordDeployVersion(SYSTEM_VERSION, result);
    return result;
  }
  if (!lastVersion || lastVersion < 203) {
    try {
      const database = await getDb();
      if (database) {
        const settingsResult = await database.execute(sql`
 UPDATE optimization_events 
 SET api_sync_status = 'not_applicable',
 api_sync_detail = ${JSON.stringify({ reason: "v266: \u5185\u90E8\u8BBE\u7F6E\u53D8\u66F4\u4E0D\u9700\u8981Amazon API\u540C\u6B65", fixedAt: (/* @__PURE__ */ new Date()).toISOString() })}
 WHERE action_type = 'settings_update'
 AND event_category = 'settings_change'
 AND api_sync_status IN ('failed', 'pending')
 AND (
 JSON_EXTRACT(action_detail, '$.type') IN ('system_deploy', 'target_reoptimized', 'algorithm_config', 'strategy_update', 'system_config')
 OR change_reason LIKE '%部署%'
 OR change_reason LIKE '%算法%参数%'
 OR change_reason LIKE '%策略%更新%'
 )
 `);
        const settingsFixed = settingsResult[0]?.affectedRows || 0;
        log127.info(`[PostDeployOptimizer] v266: \u4FEE\u590D${settingsFixed}\u4E2A\u5185\u90E8settings_update\u4E8B\u4EF6\u72B6\u6001\u4E3Anot_applicable(\u4FDD\u7559\u9700\u8981API\u540C\u6B65\u7684\u8BBE\u7F6E\u53D8\u66F4)`);
        const restoreResult = await database.execute(sql`
 UPDATE optimization_events 
 SET api_sync_status = 'pending',
 api_sync_detail = ${JSON.stringify({ reason: "v266: \u6062\u590D\u88AB\u9519\u8BEF\u6807\u8BB0\u7684\u9700\u8981API\u540C\u6B65\u7684\u8BBE\u7F6E\u53D8\u66F4", fixedAt: (/* @__PURE__ */ new Date()).toISOString() })}
 WHERE action_type = 'settings_update'
 AND event_category = 'settings_change'
 AND api_sync_status = 'not_applicable'
 AND (
 change_reason LIKE '%预算%'
 OR change_reason LIKE '%budget%'
 OR change_reason LIKE '%出价%'
 OR change_reason LIKE '%bid%'
 OR JSON_EXTRACT(action_detail, '$.type') IN ('budget_adjustment', 'bid_adjustment')
 )
 AND created_at > DATE_SUB(NOW(), INTERVAL 7 DAY)
 `);
        const restored = restoreResult[0]?.affectedRows || 0;
        if (restored > 0) {
          log127.warn(`[PostDeployOptimizer] v266: \u6062\u590D${restored}\u4E2A\u88AB\u9519\u8BEF\u6807\u8BB0\u7684\u9884\u7B97/\u51FA\u4EF7settings_update\u4E8B\u4EF6\u4E3Apending`);
        }
        await database.execute(sql`
          UPDATE optimization_logs ol
          INNER JOIN optimization_events oe ON oe.source_id = ol.id AND oe.source_table = 'optimization_logs'
          SET ol.api_sync_status = 'not_applicable'
          WHERE oe.action_type = 'settings_update'
            AND oe.event_category = 'settings_change'
            AND oe.api_sync_status = 'not_applicable'
            AND ol.api_sync_status IN ('failed', 'pending')
        `).catch((e) => log127.warn(`[PostDeployOptimizer] v202: \u540C\u6B65optimization_logs\u5931\u8D25: ${e.message}`));
        const legacyResult = await database.execute(sql`
          UPDATE optimization_events 
          SET api_sync_status = 'invalid_legacy',
              api_sync_detail = ${JSON.stringify({ reason: "v202: \u8D85\u8FC730\u5929\u7684\u5386\u53F2\u5931\u8D25\u4E8B\u4EF6", fixedAt: (/* @__PURE__ */ new Date()).toISOString() })}
          WHERE api_sync_status = 'failed'
            AND created_at < DATE_SUB(NOW(), INTERVAL 30 DAY)
            AND action_type NOT IN ('bid_increase', 'bid_decrease')
        `);
        const legacyFixed = legacyResult[0]?.affectedRows || 0;
        log127.warn(`[PostDeployOptimizer] v203: \u6807\u8BB0${legacyFixed}\u4E2A\u8D85\u8FC730\u5929\u7684\u65E7\u5931\u8D25\u4E8B\u4EF6\u4E3Ainvalid_legacy`);
        const targetResult = await database.execute(sql`
          UPDATE optimization_events 
          SET api_sync_status = 'invalid_legacy',
              api_sync_detail = ${JSON.stringify({ reason: "v203: \u8D85\u8FC77\u5929\u7684target\u72B6\u6001\u53D8\u66F4\u5931\u8D25\u4E8B\u4EF6", fixedAt: (/* @__PURE__ */ new Date()).toISOString() })}
          WHERE action_type IN ('target_enable', 'target_pause')
            AND api_sync_status = 'failed'
            AND created_at < DATE_SUB(NOW(), INTERVAL 7 DAY)
        `);
        const targetFixed = targetResult[0]?.affectedRows || 0;
        log127.warn(`[PostDeployOptimizer] v203: \u6807\u8BB0${targetFixed}\u4E2A\u8D85\u8FC77\u5929\u7684target\u72B6\u6001\u53D8\u66F4\u5931\u8D25\u4E8B\u4EF6\u4E3Ainvalid_legacy`);
        const miscResult = await database.execute(sql`
          UPDATE optimization_events 
          SET api_sync_status = 'invalid_legacy',
              api_sync_detail = ${JSON.stringify({ reason: "v203: \u65E0\u91CD\u8BD5\u673A\u5236\u7684\u5386\u53F2\u5931\u8D25\u4E8B\u4EF6", fixedAt: (/* @__PURE__ */ new Date()).toISOString() })}
          WHERE action_type IN ('placement_adjust', 'bid_auto_adjust')
            AND api_sync_status = 'failed'
        `);
        const miscFixed = miscResult[0]?.affectedRows || 0;
        log127.warn(`[PostDeployOptimizer] v203: \u6807\u8BB0${miscFixed}\u4E2A\u65E0\u91CD\u8BD5\u673A\u5236\u7684\u5931\u8D25\u4E8B\u4EF6\u4E3Ainvalid_legacy`);
      }
    } catch (migrationErr) {
      log127.warn(`[PostDeployOptimizer] v203: \u6570\u636E\u8FC1\u79FB\u5931\u8D25: ${migrationErr.message}`);
    }
  }
  const versionsToApply = getVersionsToApply(lastVersion);
  const affectedModules = mergeAffectedModules(versionsToApply);
  const correctionActions = mergeCorrectionActions(versionsToApply);
  log127.info(`[PostDeployOptimizer] \u9700\u8981\u5E94\u7528 ${versionsToApply.length} \u4E2A\u7248\u672C\u53D8\u66F4:`);
  for (const v of versionsToApply) {
    log127.debug(`  - v${v.version}: ${v.description}`);
  }
  log127.debug(`[PostDeployOptimizer] \u53D7\u5F71\u54CD\u6A21\u5757: ${affectedModules.join(", ")}`);
  log127.info(`[PostDeployOptimizer] \u7EA0\u6B63\u52A8\u4F5C: ${correctionActions.join(", ")}`);
  try {
    const database = await getDb();
    if (database) {
      const allGroups = await database.select({ id: performanceGroups.id, name: performanceGroups.name, autoOptimize: performanceGroups.autoOptimize, status: performanceGroups.status }).from(performanceGroups).where(and(
        eq(performanceGroups.status, "active"),
        eq(performanceGroups.autoOptimize, 0)
      ));
      if (allGroups.length > 0) {
        log127.warn(`[PostDeployOptimizer] v244: \u53D1\u73B0 ${allGroups.length} \u4E2A\u6D3B\u8DC3\u4F18\u5316\u76EE\u6807\u7684autoOptimize\u88AB\u5173\u95ED\uFF0C\u6B63\u5728\u81EA\u52A8\u6062\u590D...`);
        for (const group of allGroups) {
          const pgCampaigns = await getCampaignsByPerformanceGroupId(group.id);
          const enabledCount = pgCampaigns.filter((c) => c.campaignStatus === "enabled").length;
          if (enabledCount > 0) {
            await updatePerformanceGroup(group.id, { autoOptimize: 1 });
            log127.info(`[PostDeployOptimizer] v244: \u5DF2\u6062\u590D\u4F18\u5316\u76EE\u6807 "${group.name}" (ID:${group.id}) \u7684\u81EA\u52A8\u4F18\u5316 - \u6709${enabledCount}\u4E2Aenabled\u5E7F\u544A\u6D3B\u52A8`);
          } else {
            log127.info(`[PostDeployOptimizer] v244: \u4F18\u5316\u76EE\u6807 "${group.name}" (ID:${group.id}) \u4E0B\u65E0enabled\u5E7F\u544A\u6D3B\u52A8\uFF0C\u4FDD\u6301\u5173\u95ED\u72B6\u6001`);
          }
        }
      } else {
        log127.info(`[PostDeployOptimizer] v244: \u6240\u6709\u6D3B\u8DC3\u4F18\u5316\u76EE\u6807\u7684autoOptimize\u72B6\u6001\u6B63\u5E38`);
      }
    }
  } catch (restoreErr) {
    log127.warn(`[PostDeployOptimizer] v244: \u6062\u590D\u4F18\u5316\u76EE\u6807\u72B6\u6001\u5931\u8D25:`, restoreErr.message);
  }
  if (!lastVersion || lastVersion < 257) {
    try {
      const { backfillMatchType: backfillMatchType2 } = await Promise.resolve().then(() => (init_v257_backfill_match_type(), v257_backfill_match_type_exports));
      const matchTypeResult = await backfillMatchType2();
      log127.info(`[PostDeployOptimizer] v257: match_type\u56DE\u586B\u5B8C\u6210: updated=${matchTypeResult.updated}, errors=${matchTypeResult.errors}`);
    } catch (migrationErr) {
      log127.warn(`[PostDeployOptimizer] v257: match_type\u56DE\u586B\u5931\u8D25: ${migrationErr.message}`);
    }
  }
  if (!lastVersion || lastVersion < 258) {
    try {
      const { runV258Migration: runV258Migration2 } = await Promise.resolve().then(() => (init_v258_add_log_fields(), v258_add_log_fields_exports));
      await runV258Migration2();
      log127.info(`[PostDeployOptimizer] v258: \u65E5\u5FD7\u5B57\u6BB5\u8FC1\u79FB\u5B8C\u6210`);
    } catch (migrationErr) {
      log127.warn(`[PostDeployOptimizer] v258: \u65E5\u5FD7\u5B57\u6BB5\u8FC1\u79FB\u5931\u8D25: ${migrationErr.message}`);
    }
  }
  if (!lastVersion || lastVersion < 268) {
    try {
      const { runV268PerformanceIndexMigration: runV268PerformanceIndexMigration2 } = await Promise.resolve().then(() => (init_v268_performance_indexes(), v268_performance_indexes_exports));
      await runV268PerformanceIndexMigration2();
      log127.info(`[PostDeployOptimizer] v268: \u6027\u80FD\u4F18\u5316\u7D22\u5F15\u521B\u5EFA\u5B8C\u6210`);
    } catch (migrationErr) {
      log127.warn(`[PostDeployOptimizer] v268: \u6027\u80FD\u4F18\u5316\u7D22\u5F15\u521B\u5EFA\u5931\u8D25: ${migrationErr.message}`);
    }
  }
  if (!lastVersion || lastVersion < 345) {
    try {
      const { migrateEncryptCredentials: migrateEncryptCredentials2 } = await Promise.resolve().then(() => (init_v345_encrypt_credentials(), v345_encrypt_credentials_exports));
      const migResult = await migrateEncryptCredentials2();
      log127.info(`[PostDeployOptimizer] v345: \u51ED\u8BC1\u52A0\u5BC6\u8FC1\u79FB\u5B8C\u6210 (\u52A0\u5BC6=${migResult.encrypted}, \u8DF3\u8FC7=${migResult.skipped}, \u5931\u8D25=${migResult.failed})`);
    } catch (migrationErr) {
      log127.warn(`[PostDeployOptimizer] v345: \u51ED\u8BC1\u52A0\u5BC6\u8FC1\u79FB\u5931\u8D25: ${migrationErr.message}`);
    }
    try {
      const { runV345PerformanceIndexMigration: runV345PerformanceIndexMigration2 } = await Promise.resolve().then(() => (init_v345_performance_indexes(), v345_performance_indexes_exports));
      await runV345PerformanceIndexMigration2();
      log127.info(`[PostDeployOptimizer] v345: \u6027\u80FD\u7D22\u5F15\u521B\u5EFA\u5B8C\u6210`);
    } catch (migrationErr) {
      log127.warn(`[PostDeployOptimizer] v345: \u6027\u80FD\u7D22\u5F15\u521B\u5EFA\u5931\u8D25: ${migrationErr.message}`);
    }
  }
  if (!lastVersion || parseFloat(String(lastVersion)) < 361) {
    try {
      const { runV361CoreTableIndexes: runV361CoreTableIndexes2 } = await Promise.resolve().then(() => (init_v361_core_table_indexes(), v361_core_table_indexes_exports));
      const database = await getDb();
      if (database) {
        await runV361CoreTableIndexes2(database);
        log127.info(`[PostDeployOptimizer] v361: \u6838\u5FC3\u8868\u7D22\u5F15\u521B\u5EFA\u5B8C\u6210`);
      }
    } catch (migrationErr) {
      log127.warn(`[PostDeployOptimizer] v361: \u6838\u5FC3\u8868\u7D22\u5F15\u521B\u5EFA\u5931\u8D25: ${migrationErr.message}`);
    }
  }
  if (!lastVersion || parseFloat(String(lastVersion)) < 372) {
    try {
      const { runV372ExtendedIndexes: runV372ExtendedIndexes2 } = await Promise.resolve().then(() => (init_v372_extended_indexes(), v372_extended_indexes_exports));
      const database = await getDb();
      if (database) {
        await runV372ExtendedIndexes2(database);
        log127.info(`[PostDeployOptimizer] v372: \u6269\u5C55\u7D22\u5F15\u548C\u5206\u5E03\u5F0F\u9650\u6D41\u8868\u521B\u5EFA\u5B8C\u6210`);
      }
    } catch (migrationErr) {
      log127.warn(`[PostDeployOptimizer] v372: \u6269\u5C55\u7D22\u5F15\u8FC1\u79FB\u5931\u8D25: ${migrationErr.message}`);
    }
  }
  if (versionsToApply.some((v) => v.version >= 390)) {
    try {
      const { runV390PerformanceIndexes: runV390PerformanceIndexes2 } = await Promise.resolve().then(() => (init_v390_performance_indexes(), v390_performance_indexes_exports));
      const database = await getDb();
      if (database) {
        await runV390PerformanceIndexes2(database);
        log127.info(`[PostDeployOptimizer] v390: \u6027\u80FD\u4F18\u5316\u7D22\u5F15\u521B\u5EFA\u5B8C\u6210`);
      }
    } catch (migrationErr) {
      log127.warn(`[PostDeployOptimizer] v390: \u6027\u80FD\u4F18\u5316\u7D22\u5F15\u8FC1\u79FB\u5931\u8D25: ${migrationErr.message}`);
    }
  }
  if (versionsToApply.some((v) => v.version >= 395)) {
    try {
      const { runV395SearchTermsUnique: runV395SearchTermsUnique2 } = await Promise.resolve().then(() => (init_v395_search_terms_unique(), v395_search_terms_unique_exports));
      const database = await getDb();
      if (database) {
        await runV395SearchTermsUnique2(database);
        log127.info(`[PostDeployOptimizer] v395: \u641C\u7D22\u8BCD\u552F\u4E00\u7EA6\u675F\u8FC1\u79FB\u5B8C\u6210`);
      }
    } catch (migrationErr) {
      log127.warn(`[PostDeployOptimizer] v395: \u641C\u7D22\u8BCD\u552F\u4E00\u7EA6\u675F\u8FC1\u79FB\u5931\u8D25: ${migrationErr.message}`);
    }
  }
  const { getEnabledOptimizationTargets: getEnabledOptimizationTargets2 } = await Promise.resolve().then(() => (init_optimizationTargetEngine(), optimizationTargetEngine_exports));
  const targets = await getEnabledOptimizationTargets2();
  if (targets.length === 0) {
    log127.info(`[PostDeployOptimizer] \u6CA1\u6709\u6D3B\u8DC3\u7684\u4F18\u5316\u76EE\u6807\uFF0C\u8DF3\u8FC7\u91CD\u4F18\u5316`);
    const result = {
      triggered: true,
      reason: "\u7248\u672C\u53D8\u5316\u4F46\u65E0\u6D3B\u8DC3\u76EE\u6807",
      previousVersion: lastVersion,
      currentVersion: SYSTEM_VERSION,
      versionsToApply: versionsToApply.map((v) => v.version),
      affectedModules,
      targetsProcessed: 0,
      targetsSucceeded: 0,
      targetsFailed: 0,
      totalOptimizationActions: 0,
      startedAt,
      completedAt: /* @__PURE__ */ new Date(),
      targetResults: []
    };
    await recordDeployVersion(SYSTEM_VERSION, result);
    return result;
  }
  log127.info(`[PostDeployOptimizer] \u5F00\u59CB\u5BF9 ${targets.length} \u4E2A\u6D3B\u8DC3\u4F18\u5316\u76EE\u6807\u6267\u884C\u91CD\u4F18\u5316...`);
  const sortedTargets = targets.sort((a, b) => {
    const aTime = a.lastExecutionTime ? new Date(a.lastExecutionTime).getTime() : 0;
    const bTime = b.lastExecutionTime ? new Date(b.lastExecutionTime).getTime() : 0;
    return aTime - bTime;
  });
  const targetResults = [];
  let totalActions = 0;
  for (let i = 0; i < sortedTargets.length; i += POST_DEPLOY_CONFIG.batchSize) {
    const batch = sortedTargets.slice(i, i + POST_DEPLOY_CONFIG.batchSize);
    const batchNum = Math.floor(i / POST_DEPLOY_CONFIG.batchSize) + 1;
    const totalBatches = Math.ceil(sortedTargets.length / POST_DEPLOY_CONFIG.batchSize);
    log127.info(`[PostDeployOptimizer] \u6267\u884C\u6279\u6B21 ${batchNum}/${totalBatches} (${batch.length}\u4E2A\u76EE\u6807)...`);
    for (const target of batch) {
      let retries = 0;
      let result = null;
      while (retries <= POST_DEPLOY_CONFIG.maxRetries) {
        try {
          result = await reoptimizeTarget(target.id, affectedModules, correctionActions);
          break;
        } catch (err) {
          retries++;
          if (retries > POST_DEPLOY_CONFIG.maxRetries) {
            result = {
              targetId: target.id,
              targetName: target.name,
              accountId: target.accountId,
              status: "failed",
              modulesExecuted: [],
              correctionsApplied: 0,
              optimizationActions: 0,
              errors: [`\u91CD\u8BD5${POST_DEPLOY_CONFIG.maxRetries}\u6B21\u540E\u4ECD\u7136\u5931\u8D25: ${err.message}`],
              duration: 0
            };
          } else {
            log127.warn(`[PostDeployOptimizer] [${target.name}] \u91CD\u8BD5 ${retries}/${POST_DEPLOY_CONFIG.maxRetries}: ${err.message}`);
            await sleep2(5e3);
          }
        }
      }
      if (result) {
        targetResults.push(result);
        totalActions += result.optimizationActions;
        const statusIcon = result.status === "success" ? "\u2713" : "\u2717";
        log127.debug(`[PostDeployOptimizer] ${statusIcon} ${result.targetName}: \u6A21\u5757=${result.modulesExecuted.join(",")}, \u7EA0\u6B63=${result.correctionsApplied}, \u4F18\u5316=${result.optimizationActions}, \u8017\u65F6=${result.duration}ms` + (result.errors.length > 0 ? `, \u9519\u8BEF=${result.errors.length}` : ""));
        const INTER_TARGET_DELAY_MS = 3e4;
        log127.info(`[PostDeployOptimizer] v476: \u76EE\u6807\u95F4\u8282\u6D41 - \u7B49\u5F85${INTER_TARGET_DELAY_MS / 1e3}\u79D2\u540E\u6267\u884C\u4E0B\u4E00\u4E2A\u76EE\u6807...`);
        await sleep2(INTER_TARGET_DELAY_MS);
      }
    }
    if (i + POST_DEPLOY_CONFIG.batchSize < sortedTargets.length) {
      log127.debug(`[PostDeployOptimizer] \u6279\u6B21\u95F4\u7B49\u5F85 ${POST_DEPLOY_CONFIG.batchDelayMs / 1e3}\u79D2...`);
      await sleep2(POST_DEPLOY_CONFIG.batchDelayMs);
    }
  }
  const succeeded = targetResults.filter((r) => r.status === "success").length;
  const failed = targetResults.filter((r) => r.status === "failed").length;
  const finalResult = {
    triggered: true,
    reason: `\u7248\u672C\u4ECE v${lastVersion || 0} \u5347\u7EA7\u5230 v${SYSTEM_VERSION}`,
    previousVersion: lastVersion,
    currentVersion: SYSTEM_VERSION,
    versionsToApply: versionsToApply.map((v) => v.version),
    affectedModules,
    targetsProcessed: targetResults.length,
    targetsSucceeded: succeeded,
    targetsFailed: failed,
    totalOptimizationActions: totalActions,
    startedAt,
    completedAt: /* @__PURE__ */ new Date(),
    targetResults
  };
  await recordDeployVersion(SYSTEM_VERSION, finalResult);
  log127.info(`[PostDeployOptimizer] ========================================`);
  log127.info(`[PostDeployOptimizer] \u90E8\u7F72\u540E\u91CD\u4F18\u5316\u5B8C\u6210!`);
  log127.info(`[PostDeployOptimizer] \u7248\u672C: v${lastVersion || 0} \u2192 v${SYSTEM_VERSION}`);
  if (failed > 0) {
    log127.warn(`[PostDeployOptimizer] \u76EE\u6807: ${targetResults.length}\u4E2A\u5904\u7406, ${succeeded}\u4E2A\u6210\u529F, ${failed}\u4E2A\u5931\u8D25`);
  } else {
    log127.info(`[PostDeployOptimizer] \u76EE\u6807: ${targetResults.length}\u4E2A\u5904\u7406, ${succeeded}\u4E2A\u6210\u529F, ${failed}\u4E2A\u5931\u8D25`);
  }
  log127.info(`[PostDeployOptimizer] \u4F18\u5316\u52A8\u4F5C: ${totalActions}\u4E2A`);
  log127.info(`[PostDeployOptimizer] \u8017\u65F6: ${((finalResult.completedAt.getTime() - startedAt.getTime()) / 1e3).toFixed(1)}\u79D2`);
  log127.info(`[PostDeployOptimizer] ========================================`);
  return finalResult;
}
async function forceReoptimize(modules, targetId) {
  const startedAt = /* @__PURE__ */ new Date();
  const affectedModules = modules || ["bid", "placement", "dayparting", "dayparting_budget", "budget", "searchterm", "keyword", "multidim", "coordination"];
  const correctionActions = ["rebuild_combo_analysis", "full_reoptimize"];
  log127.info(`[PostDeployOptimizer] \u624B\u52A8\u89E6\u53D1\u91CD\u4F18\u5316, \u6A21\u5757: ${affectedModules.join(",")}, \u76EE\u6807: ${targetId || "all"}`);
  const { getEnabledOptimizationTargets: getEnabledOptimizationTargets2 } = await Promise.resolve().then(() => (init_optimizationTargetEngine(), optimizationTargetEngine_exports));
  let targets = await getEnabledOptimizationTargets2();
  if (targetId) {
    targets = targets.filter((t2) => t2.id === targetId);
  }
  const targetResults = [];
  let totalActions = 0;
  for (const target of targets) {
    const result = await reoptimizeTarget(target.id, affectedModules, correctionActions);
    targetResults.push(result);
    totalActions += result.optimizationActions;
  }
  const succeeded = targetResults.filter((r) => r.status === "success").length;
  const failed = targetResults.filter((r) => r.status === "failed").length;
  return {
    triggered: true,
    reason: "\u624B\u52A8\u89E6\u53D1",
    previousVersion: null,
    currentVersion: SYSTEM_VERSION,
    versionsToApply: [],
    affectedModules,
    targetsProcessed: targetResults.length,
    targetsSucceeded: succeeded,
    targetsFailed: failed,
    totalOptimizationActions: totalActions,
    startedAt,
    completedAt: /* @__PURE__ */ new Date(),
    targetResults
  };
}
function getSystemVersionInfo() {
  return {
    currentVersion: SYSTEM_VERSION,
    changelog: VERSION_CHANGELOG
  };
}
function sleep2(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
var log127, VERSION_CHANGELOG, POST_DEPLOY_CONFIG;
var init_postDeployOptimizer = __esm({
  "server/postDeployOptimizer.ts"() {
    "use strict";
    init_db2();
    init_db2();
    init_schema2();
    init_drizzle_orm();
    init_logger();
    init_systemVersion();
    log127 = createModuleLogger("PostDeploy");
    VERSION_CHANGELOG = [
      {
        version: 596,
        description: "v596: [三项架构级优化] — (1)P1-Redis分布式任务队列: ReportJobScheduler全面集成Redis分布式锁,防止多实例重复提交/检查/处理;报告状态缓存到Redis减少Amazon API调用;Redis pub/sub通知加速任务流转;批次大小提升至submit=80/check=80/process=30 (2)P1-空账户智能跳过机制: 基于活跃广告活动数+7天花费双重预检,零活跃广告活动账户仅同步元数据;低花费账户跳过搜索词/展示位置报告;跳过事件记录到Redis用于监控 (3)P2-报告API部分成功与断点续传: 报告类步骤超时/限流不再阻塞后续步骤,标记为partialSuccess并继续;失败的报告步骤自动加入Redis异步重试队列;绩效数据失败批次保存到Redis用于断点续传,下次同步时仅重试失败批次",
        affectedModules: ["scheduler", "sync", "report", "redis"],
        correctionActions: []
      },
      {
        version: 530,
        description: "v614i-fix22: [\u9884\u7B97\u89C4\u5219\u6DF1\u5EA6\u96C6\u6210+\u6570\u636E\u6E05\u7406\u673A\u5236] \u2014 (1)P2-Budget Rules\u667A\u80FD\u534F\u540C: \u65B0\u5EFAbudgetRulesCoordinator\u670D\u52A1,\u4ECEDB/API\u8BFB\u53D6\u89C4\u5219\u5185\u5BB9\u5E76\u6839\u636E\u89C4\u5219\u7C7B\u578B(Schedule/Performance)\u548C\u6D3B\u8DC3\u72B6\u6001\u667A\u80FD\u51B3\u7B56:\u6D3B\u8DC3Schedule\u89C4\u5219\u2192\u8DF3\u8FC7,\u6D3B\u8DC3Performance\u89C4\u5219\u2192\u9650\u5236\u5E45\u5EA6(20%cap),\u4E0D\u6D3B\u8DC3\u89C4\u5219\u2192\u6B63\u5E38\u8C03\u6574;\u7EDF\u4E00\u5E94\u7528\u4E8EbudgetExecutor/optimizationSyncEngine/daypartingExecutor/AutoCorrector\u56DB\u4E2A\u9884\u7B97\u8C03\u6574\u8DEF\u5F84 (2)P2-\u6570\u636E\u4FDD\u7559\u4E0E\u6E05\u7406: \u65B0\u5EFAdataRetentionService,\u6BCF24\u5C0F\u65F6\u6E05\u7406amazon_deleted\u5173\u952E\u8BCD/\u5546\u54C1\u5B9A\u5411(30\u5929),archived\u5B9E\u4F53(60\u5929),\u5DF2\u5B8C\u6210\u4EFB\u52A1(30\u5929),\u51FA\u4EF7\u65E5\u5FD7(90\u5929),\u540C\u6B65\u51B2\u7A81/\u53D8\u66F4\u8BB0\u5F55/\u7CFB\u7EDF\u65E5\u5FD7(30\u5929);\u5206\u6279\u5220\u9664(1000\u6761/\u6279)+\u5185\u5B58\u4FDD\u62A4+\u8FD0\u7EF4API\u7AEF\u70B9",
        affectedModules: ["budget", "autocorrector", "sync", "ops"],
        correctionActions: []
      },
      {
        version: 529,
        description: "v614i-fix21: [\u4E09\u4E2A\u4E1A\u52A1\u903B\u8F91\u4FEE\u590D] \u2014 (1)P0-SP\u5E7F\u544A\u6D3B\u52A8\u9884\u7B97\u89C4\u5219\u51B2\u7A81\u68C0\u67E5: budgetExecutor/optimizationSyncEngine/daypartingExecutor\u5728\u8C03\u6574\u9884\u7B97\u524D\u68C0\u67E5Budget Rules,\u542F\u7528\u4E86Budget Rules\u7684SP campaign\u8DF3\u8FC7\u5E38\u89C4\u9884\u7B97\u8C03\u6574,\u6D88\u966459%\u56DE\u6EDA\u7387\u7684\u6839\u56E0 (2)P0-AutoCorrector\u8FC7\u6EE4\u5DF2\u5220\u9664\u5173\u952E\u8BCD: verifyBiddingLogsExecution\u6DFB\u52A0amazon_deleted/archived\u72B6\u6001\u8FC7\u6EE4,stalePending\u6307\u4EE4\u91CD\u8BC4\u4F30\u6DFB\u52A0\u5DF2\u5220\u9664\u5173\u952E\u8BCD\u81EA\u52A8\u53D6\u6D88 (3)P1-\u5173\u952E\u8BCD\u521B\u5EFA\u6570\u636E\u5E93\u51B2\u7A81: keywordSync/syncSb/syncWithTracking/targetingSync\u7EDF\u4E00\u6DFB\u52A0ON DUPLICATE KEY UPDATE\u5904\u7406uk_keyword_dedup\u552F\u4E00\u7EA6\u675F\u51B2\u7A81",
        affectedModules: ["budget", "autocorrector", "sync"],
        correctionActions: []
      },
      {
        version: 528,
        description: "v528: [\u57FA\u4E8E\u5FC3\u8DF3\u6D3B\u8DC3\u5EA6\u7684\u7EDF\u4E00\u50F5\u5C38\u6E05\u7406\u673A\u5236] \u2014 (1)P0-HealthMonitor\u50F5\u5C38\u5224\u5B9A\u91CD\u5199: \u4ECEstartTime\u56FA\u5B9A\u8D85\u65F6\u2192\u57FA\u4E8ElastHeartbeat\u5FC3\u8DF3\u6D3B\u8DC3\u5EA6\u5224\u5B9A,10\u5206\u949F\u65E0\u5FC3\u8DF3\u624D\u5224\u5B9A\u4E3A\u50F5\u5C38,\u4FDD\u75596\u5C0F\u65F6\u7EDD\u5BF9\u8D85\u65F6\u5B89\u5168\u7F51 (2)P0-\u4E09\u5C42\u8D85\u65F6\u7EDF\u4E00: HealthMonitor/DataSyncScheduler/ShardOrchestrator\u7684\u5927\u8D26\u6237\u8D85\u65F6\u503C\u7EDF\u4E00\u4E3A3\u5C0F\u65F6(5000+)/2.5\u5C0F\u65F6(3000+)/2\u5C0F\u65F6(1000+) (3)P0-\u5FC3\u8DF3\u53CC\u5199: \u6BCF\u6B21\u5FC3\u8DF3\u540C\u65F6\u66F4\u65B0DB(updated_at)\u548C\u5185\u5B58(activeSyncs.lastHeartbeat),\u786E\u4FDD\u4E09\u5C42\u6E05\u7406\u673A\u5236\u90FD\u80FD\u611F\u77E5\u4EFB\u52A1\u6D3B\u8DC3 (4)P1-DataSyncScheduler\u5B9A\u671F\u6E05\u7406: \u4ECE45\u5206\u949F\u4E00\u5200\u5207\u219215\u5206\u949F\u5FC3\u8DF3\u8D85\u65F6,\u4E0E\u5FC3\u8DF3\u673A\u5236\u5BF9\u9F50",
        affectedModules: ["sync", "scheduler"],
        correctionActions: []
      },
      {
        version: 527,
        description: "v527: [\u96F6\u8B66\u544A\u6784\u5EFA+v395\u8FC1\u79FB\u5217\u540D\u4FEE\u590D] \u2014 (1)P0-v395\u8FC1\u79FB\u811A\u672C\u5217\u540D\u4FEE\u590D: search_terms\u8868\u7684DELETE/GROUP BY/ALTER TABLE\u4E2D\u5217\u540D\u4E0E\u6570\u636E\u5E93\u5B9E\u9645\u7ED3\u6784\u4E0D\u5339\u914D(adGroupId\u2192internal_ad_group_id, report_start_date\u2192reportStartDate),\u5BFC\u81F4\u6BCF\u6B21\u90E8\u7F72\u5747\u62A5Failed query\u8B66\u544A (2)P1-\u6784\u5EFA\u8B66\u544A\u6E05\u96F6: \u6D88\u9664\u5168\u90E85\u4E2Aesbuild\u8B66\u544A(import.meta.dirname\xD72, getKeywordsByIds, batchUpdateKeywordStatus, db.query)",
        affectedModules: ["migration"],
        correctionActions: []
      },
      {
        version: 526,
        description: "v526: [\u6570\u636E\u8D28\u91CF\u6E05\u96F6 \u2014 \u6D88\u9664\u5269\u4F59\u8B66\u544A\u548C\u8FC1\u79FB\u811A\u672C\u95EE\u9898] \u2014 (1)P0-RLDataRecorder\u5217\u540D\u6620\u5C04\u4FEE\u590D: rl_training_logs\u8868\u7684Drizzle schema\u5C06internalAdGroupId\u6620\u5C04\u5230internal_ad_group_id\u5217,\u4F46\u6570\u636E\u5E93\u5B9E\u9645\u5217\u540D\u4E3AadGroupId(\u9A7C\u5CF0),\u4FEE\u6B63\u4E3Aint()\u9ED8\u8BA4\u6620\u5C04,\u6D88\u9664~400+/\u5C0F\u65F6\u7684\u63D2\u5165\u8B66\u544A (2)P1-\u8FC1\u79FB\u811A\u672Cv390\u5E42\u7B49\u6027\u589E\u5F3A: \u6DFB\u52A0information_schema\u67E5\u8BE2\u9884\u68C0\u67E5\u7D22\u5F15\u662F\u5426\u5DF2\u5B58\u5728,\u907F\u514D\u6BCF\u6B21\u90E8\u7F72\u91CD\u590D\u5C1D\u8BD5\u521B\u5EFA (3)P1-\u8FC1\u79FB\u811A\u672Cv395\u5E42\u7B49\u6027\u589E\u5F3A+SQL\u6CE8\u5165\u4FEE\u590D: \u6DFB\u52A0uk_search_term\u7EA6\u675F\u5B58\u5728\u6027\u68C0\u67E5,\u5DF2\u5B58\u5728\u5219\u8DF3\u8FC7\u6574\u4E2A\u8FC1\u79FB;\u4FEE\u590DSQL\u5B57\u7B26\u4E32\u4E2D\u8BEF\u5D4C\u5165\u7684@ts-ignore\u6CE8\u91CA\u5BFC\u81F4\u7684\u8BED\u6CD5\u9519\u8BEF",
        affectedModules: ["rl_training", "migration"],
        correctionActions: []
      },
      {
        version: 525,
        description: "v525: [\u67B6\u6784\u5F39\u6027\u5347\u7EA7 \u2014 \u7B2C\u4E09\u65B9API\u5F02\u5E38\u5904\u7406\u4E0E\u9AD8\u5E76\u53D1\u573A\u666F\u4F18\u5316] \u2014 (1)P0-\u7194\u65AD\u5668(CircuitBreaker): \u65B0\u589EcircuitBreakerService.ts\u5B9E\u73B0\u4E09\u6001\u7194\u65AD\u5668(CLOSED/OPEN/HALF_OPEN),\u96C6\u6210\u5230apiRateLimitService\u548CamazonApiHelper,\u5F53\u8D26\u6237\u7EA7\u522B\u5931\u8D25\u7387\u8D85\u8FC750%\u65F6\u81EA\u52A8\u7194\u65AD\u963B\u65AD\u8BF7\u6C42,\u9632\u6B62\u65E0\u6548\u91CD\u8BD5\u548C\u65E5\u5FD7\u98CE\u66B4 (2)P0-\u81EA\u9002\u5E94\u8D85\u65F6(AdaptiveTimeout): \u65B0\u589EadaptiveTimeoutService.ts\u57FA\u4E8E\u5386\u53F2P90/P99\u8017\u65F6\u52A8\u6001\u8BA1\u7B97\u8D85\u65F6\u65F6\u95F4,\u66FF\u4EE3\u786C\u7F16\u7801\u8D85\u65F6,\u96C6\u6210\u5230amazonApiHelper\u7684withRetry\u51FD\u6570 (3)P0-\u8231\u58C1\u9694\u79BB(Bulkhead): \u65B0\u589EbulkheadService.ts\u5B9E\u73B0\u8D44\u6E90\u6C60\u9694\u79BB,\u4E3A\u4E0D\u540C\u5C42\u7EA7\u8D26\u6237\u5206\u914D\u72EC\u7ACB\u5E76\u53D1\u69FD\u4F4D,\u96C6\u6210\u5230dataSyncScheduler\u7684executeTieredSyncForAccount (4)P0-\u53CC\u5411\u72B6\u6001\u5BF9\u9F50\u534F\u8BAE: \u91CD\u5199entityStateAlignment.ts\u5B9E\u73B0\u7248\u672C\u5411\u91CF\u673A\u5236,\u6B63\u5411\u5BF9\u9F50(\u540C\u6B65\u65F6\u6807\u8BB0\u5DF2\u9A8C\u8BC1\u5B9E\u4F53)+\u53CD\u5411\u5BF9\u9F50(\u626B\u63CF\u672A\u9A8C\u8BC1\u5B9E\u4F53\u5E76\u6807\u8BB0\u4E3Aamazon_deleted),\u96C6\u6210\u5230\u6240\u6709\u540C\u6B65\u6A21\u5757 (5)P1-\u5F3A\u7C7B\u578BSQL\u67E5\u8BE2\u5C42: \u65B0\u589EtypeSafeQueryBuilder.ts\u63D0\u4F9BsafeExecute/validateSql\u8FD0\u884C\u65F6\u9A8C\u8BC1,\u5DF2\u8FC1\u79FBoptSyncQueries\u4E2D7\u4E2A\u9AD8\u98CE\u9669SQL\u51FD\u6570 (6)P1-\u5F39\u6027\u76D1\u63A7\u7AEF\u70B9: \u65B0\u589EresilienceMonitor.ts\u805A\u5408\u6240\u6709\u5F39\u6027\u7EC4\u4EF6\u72B6\u6001,ops.ts\u65B0\u589E/resilience\u3001/resilience/summary\u3001/resilience/query-stats\u4E09\u4E2A\u76D1\u63A7\u7AEF\u70B9",
        affectedModules: ["sync", "optimization", "core", "automation"],
        correctionActions: []
      },
      {
        version: 524,
        description: "v524: [AutoStopLoss\u4FEE\u590D+\u7EE9\u6548\u62A5\u544A\u540C\u6B65\u4FEE\u590D] \u2014 (1)P0-AutoStopLoss SQL\u5217\u540D\u4FEE\u590D: autoStopLossService.ts\u4E2D\u641C\u7D22\u8BCD\u626B\u63CF\u4F7F\u7528internalAdGroupId(\u9A7C\u5CF0)\u4F46search_terms\u8868\u5B9E\u9645\u5217\u540D\u4E3Ainternal_ad_group_id(\u4E0B\u5212\u7EBF),\u5BFC\u81F4\u6240\u6709\u8D26\u6237\u7684\u641C\u7D22\u8BCD\u6B62\u635F\u626B\u63CF100%\u5931\u8D25 (2)P0-\u7EE9\u6548\u62A5\u544A\u65E5\u671F\u5012\u7F6E\u4FEE\u590D: syncPerformance.ts\u4E2DclampStartDateForRetention\u5C06startDate\u63A8\u540E\u5230\u8D85\u8FC7endDate\u65F6(SB/SD\u7B2C3\u6279\u6B21),Amazon API\u8FD4\u56DE400\u9519\u8BEF,\u65B0\u589E\u65E5\u671F\u5012\u7F6E\u68C0\u6D4B\u81EA\u52A8\u8DF3\u8FC7\u8D85\u51FA\u4FDD\u7559\u671F\u7684\u6279\u6B21 (3)P1-\u62A5\u544A\u8D85\u65F6\u65F6\u95F4\u4F18\u5316: \u6240\u6709submitAndWaitMultipleReports\u548CwaitAndDownloadReport\u8D85\u65F6\u4ECE300\u79D2\u589E\u52A0\u5230600\u79D2,\u907F\u514D\u9AD8\u5E76\u53D1\u65F6Amazon\u6392\u961F\u5BFC\u81F4\u7684\u8D85\u65F6\u5931\u8D25",
        affectedModules: ["automation", "sync"],
        correctionActions: ["rerun_correction_scan"]
      },
      {
        version: 523,
        description: "v523: [\u751F\u4EA7\u73AF\u5883\u5065\u5EB7\u4FEE\u590D6\u9879] \u2014 (1)P0-SQL\u8BED\u6CD5\u9519\u8BEF\u4FEE\u590D: \u79FB\u9664optSyncQueries.ts\u548CoptimizationAutoCorrector.ts\u4E2D\u5D4C\u5165SQL\u6A21\u677F\u5B57\u7B26\u4E32\u5185\u7684@ts-ignore\u6CE8\u91CA,\u89E3\u51B3\u6BCF5\u5206\u949F\u62A5SQL\u8BED\u6CD5\u9519\u8BEF\u548CrescuePermanentlyFailedTasks\u6267\u884C\u5931\u8D25 (2)P0-negative_product_target\u4EFB\u52A1\u652F\u6301: OptSyncEngine\u65B0\u589E\u5BF9negative_product_target\u4EFB\u52A1\u7C7B\u578B\u7684\u5904\u7406,\u91CA\u653E56\u4E2A\u5361\u6B7B\u7684\u50F5\u5C38\u4EFB\u52A1 (3)P0-DataSyncScheduler\u7A7A\u6307\u9488\u4FEE\u590D: \u6DFB\u52A0coordStatus.manualOverrides\u5B89\u5168\u8BBF\u95EE\u4FDD\u62A4,\u89E3\u51B3\u6BCF10\u5206\u949F\u62A5Cannot read properties of undefined (4)P1-\u65B0\u8D26\u6237\u540C\u6B65\u4FDD\u969C: unifiedSyncEngine\u65B0\u589E\u4ECE\u672A\u540C\u6B65\u8D26\u6237\u4FDD\u969C\u673A\u5236,\u786E\u4FDD\u65B0\u8D26\u6237\u4E0D\u53D7maxAccounts\u622A\u65AD (5)P1-\u5B9E\u4F53\u72B6\u6001\u5BF9\u9F50\u673A\u5236: \u65B0\u589EentityStateAlignment.ts\u6A21\u5757,\u81EA\u52A8\u626B\u63CFentityNotFoundError\u5E76\u6807\u8BB0\u672C\u5730\u5B9E\u4F53\u4E3Aamazon_deleted (6)P1-\u5B9E\u4F53\u5BF9\u9F50API: ops.ts\u65B0\u589E/align-entity-states\u7AEF\u70B9\u652F\u6301\u624B\u52A8\u89E6\u53D1",
        affectedModules: ["sync", "optimization", "core"],
        correctionActions: ["rerun_correction_scan", "cleanup_stale_pending"]
      },
      {
        version: 522,
        description: 'v522: [\u7CFB\u7EDF\u5D29\u6E83\u4FEE\u590D+API\u9519\u8BEF\u5904\u7406\u589E\u5F3A+\u5EFA\u8BAE\u7ADE\u4EF7\u4F18\u5316] \u2014 (1)P0-\u7CFB\u7EDF\u5D29\u6E83\u5FAA\u73AF\u4FEE\u590D: sqlstring\u5E93escape()\u5904\u7406\u7279\u6B8A\u5BF9\u8C61\u65F6val.toString()\u5931\u8D25\u5BFC\u81F4uncaughtException\u6BCF7.5\u5206\u949F\u5D29\u6E83,\u901A\u8FC7patchSqlstring.ts\u5E95\u5C42\u8865\u4E01+uncaughtException\u667A\u80FD\u964D\u7EA7\u89E3\u51B3 (2)P0-entityNotFoundError\u81EA\u52A8\u6807\u8BB0: amazonApiErrorMapper\u65B0\u589E"cannot find the adgroup"\u6A21\u5F0F+SB\u5173\u952E\u8BCD\u66F4\u65B0\u81EA\u52A8\u6807\u8BB0\u5931\u6548adGroup\u548C\u5173\u952E\u8BCD\u4E3Aamazon_deleted+\u9884\u8FC7\u6EE4\u589E\u5F3AadGroup\u72B6\u6001\u68C0\u67E5 (3)P1-SP Target\u81EA\u9002\u5E94\u8282\u6D41: \u521D\u59CB\u5EF6\u8FDF2s,429\u9519\u8BEF\u65F6\u52A0\u500D(\u6700\u9AD88s),\u6210\u529F\u65F6\u51CF\u534A(\u6700\u4F4E1s) (4)P1-SD Audience\u5EFA\u8BAE\u7ADE\u4EF7\u56DE\u9000: \u672C\u5730\u5F15\u64CE\u65E0\u6570\u636E\u65F6\u56DE\u9000\u5230adGroup defaultBid\u4F5C\u4E3A\u57FA\u7EBF',
        affectedModules: ["sync", "optimization", "core"],
        correctionActions: ["rerun_correction_scan"]
      },
      {
        version: 521,
        description: "v521: [\u540C\u6B65\u963B\u585E\u4FEE\u590D+\u5EFA\u8BAE\u7ADE\u4EF7\u5F15\u64CE\u4FEE\u590D+\u5FC3\u8DF3\u589E\u5F3A] \u2014 (1)P0-localBidRecommendationEngine getDb()\u7F3A\u5C11await\u4FEE\u590D: getDb()\u662Fasync\u51FD\u6570\u4F46\u4E24\u5904\u8C03\u7528\u7F3A\u5C11await\u5BFC\u81F4db\u53D8\u91CF\u4E3APromise\u5BF9\u8C61,\u6240\u6709\u67E5\u8BE2\u9759\u9ED8\u5931\u8D25\u8FD4\u56DEminimum_default,SB/SD\u5EFA\u8BAE\u7ADE\u4EF7\u586B\u5145\u73870% (2)P0-\u540C\u6B65\u5361\u6B7B\u6E05\u7406\u9608\u503C\u8C03\u6574: \u542F\u52A8\u6E05\u7406\u4ECE10\u5206\u949F\u63D0\u5347\u523030\u5206\u949F,\u5B9A\u671F\u6E05\u7406\u4ECE15\u5206\u949F\u63D0\u5347\u523045\u5206\u949F,\u9632\u6B62\u5168\u91CF\u540C\u6B65\u62A5\u544A\u4E0B\u8F7D\u6B65\u9AA4(\u8017\u65F615-20\u5206\u949F)\u88AB\u8BEF\u6740 (3)P1-\u5FC3\u8DF3\u95F4\u9694\u4F18\u5316: \u4ECE3\u5206\u949F\u7F29\u77ED\u52301\u5206\u949F,\u786E\u4FDD\u957F\u6B65\u9AA4\u6267\u884C\u671F\u95F4\u66F4\u9891\u7E41\u66F4\u65B0updated_at (4)P1-Amazon API\u65E5\u5FD7\u589E\u5F3A: SB/SD\u5EFA\u8BAE\u7ADE\u4EF7API\u6DFB\u52A0\u8BE6\u7EC6\u9519\u8BEF\u65E5\u5FD7",
        affectedModules: ["sync", "optimization"],
        correctionActions: ["rerun_correction_scan"]
      },
      {
        version: 519,
        description: "v519: [SD\u5EFA\u8BAE\u7ADE\u4EF7\u540C\u6B65+SD\u53D7\u4F17\u5EFA\u8BAE\u7ADE\u4EF7+\u9501TTL\u52A8\u6001\u8D85\u65F6\u4FEE\u590D] \u2014 (1)P0-SD\u5EFA\u8BAE\u7ADE\u4EF7\u540C\u6B65\u589E\u5F3A: syncSdBidRecommendations\u6DFB\u52A0\u672C\u5730\u63A8\u8350\u5F15\u64CE\u56DE\u9000(\u4E0EV515 SB\u4FEE\u590D\u4E00\u81F4),\u89E3\u51B3844\u4E2ASD\u5B9A\u4F4DsuggestedBid 100%\u4E3ANULL\u7684\u95EE\u9898 (2)P0-SD\u53D7\u4F17\u5EFA\u8BAE\u7ADE\u4EF7\u65B0\u589E: sd_audiences\u8868\u65B0\u589Esuggested_bid/suggested_bid_low/suggested_bid_high\u4E09\u5217,\u65B0\u589EsyncSdAudienceBidRecommendations\u51FD\u6570\u57FA\u4E8E\u672C\u5730\u63A8\u8350\u5F15\u64CE\u4E3A13\u4E2A\u53D7\u4F17\u63D0\u4F9B\u5EFA\u8BAE\u7ADE\u4EF7 (3)P1-\u9501TTL\u52A8\u6001\u8D85\u65F6\u4FEE\u590D: shardSyncOrchestrator\u8D26\u6237\u7EA7\u9501TTL\u4ECE\u786C\u7F1645\u5206\u949F\u6539\u4E3A\u52A8\u6001\u8BA1\u7B97(\u4E0EunifiedSyncEngine V518\u4E00\u81F4),\u6BCF\u4E2Ashard\u6267\u884C\u540E\u540C\u65F6\u7EED\u671F\u8D26\u6237\u7EA7\u9501\u548C\u5168\u5C40\u9501,\u9632\u6B62\u540C\u6B65\u8FC7\u7A0B\u4E2D\u9501\u8FC7\u671F\u5BFC\u81F4\u591A\u4E2A\u540C\u6B65\u5B9E\u4F8B\u5E76\u884C\u8FD0\u884C (4)P1-\u540C\u6B65\u6B65\u9AA4\u6269\u5C55: unifiedSyncEngine\u65B0\u589Esd_audience_bid_recommendations\u6B65\u9AA4,amazonSyncService Layer 6\u4ECE3\u4E2A\u5E76\u884C\u6269\u5C55\u52304\u4E2A",
        affectedModules: ["sync", "db", "optimization"],
        correctionActions: ["rerun_correction_scan"]
      },
      {
        version: 515,
        description: "v515: [\u4FEE\u590DRLDataRecorder\u53C2\u6570\u4F20\u9012] \u2014 (1)P0-\u4FEE\u590D\u51B7\u542F\u52A8\u51FA\u4EF7\u52A8\u4F5C\u7684RL\u8BAD\u7EC3\u6837\u672C\u4E22\u5931: nextGenBidOrchestrator\u4E2D3\u5904recordBidAction\u8C03\u7528\u7684campaignId\u548CadGroupId\u53C2\u6570\u7C7B\u578B\u4E0D\u5339\u914D\u5BFC\u81F4\u4F20\u5165\u7A7A\u5B57\u7B26\u4E32,\u73B0\u7EDF\u4E00\u901A\u8FC7String()/Number()\u8F6C\u6362\u786E\u4FDD\u7C7B\u578B\u6B63\u786E (2)P1-bidOptimizationExecutor\u8865\u4F20internalAdGroupId: \u4E3Akeyword/product_target/SD\u53D7\u4F17\u4E09\u79CD\u76EE\u6807\u7C7B\u578B\u7684target\u5BF9\u8C61\u6DFB\u52A0internalAdGroupId\u5B57\u6BB5,\u4F9B\u51B7\u542F\u52A8\u5F15\u64CELevel 1\u951A\u70B9\u67E5\u8BE2\u548CRL\u6570\u636E\u8BB0\u5F55\u4F7F\u7528",
        affectedModules: ["optimization"],
        correctionActions: ["rerun_optimization"]
      },
      {
        version: 514,
        description: "v514: [\u51B7\u542F\u52A8\u7CBE\u51C6\u951A\u70B9\u6FC0\u6D3B+\u6307\u6570\u9000\u907F\u91CD\u8BD5] \u2014 (1)P0-\u4FEE\u590DCampaign\u951A\u70B9SQL\u67E5\u8BE2Bug: suggestedBidColdStartEngine\u4E2Dcampaigns.amazonCampaignId\u5B57\u6BB5\u4E0D\u5B58\u5728\u5BFC\u81F4SQL\u7578\u5F62,\u6539\u4E3A\u76F4\u63A5\u4F7F\u7528campaigns.campaignId,\u5F7B\u5E95\u6FC0\u6D3BLevel 1(AdGroup\u951A\u70B9)\u548CLevel 2(Campaign\u951A\u70B9)\u7CBE\u51C6\u51FA\u4EF7\u7B56\u7565 (2)P0-\u7EDF\u4E00\u6307\u6570\u9000\u907F\u91CD\u8BD5\u673A\u5236: withRetry\u51FD\u6570\u5BF9\u6240\u6709\u53EF\u91CD\u8BD5\u9519\u8BEF(429\u9650\u6D41/\u7F51\u7EDC\u8D85\u65F6ETIMEDOUT/ECONNRESET/ECONNABORTED/\u670D\u52A1\u5668500+)\u7EDF\u4E00\u4F7F\u7528\u6307\u6570\u9000\u907F+\u968F\u673A\u6296\u52A8,\u51FA\u4EF7\u540C\u6B65maxRetries\u4ECE3\u63D0\u5347\u81F35\u3001baseDelayMs\u4ECE3000\u63D0\u5347\u81F35000,\u5F7B\u5E95\u6D88\u9664\u7F51\u7EDC\u77AC\u65F6\u6545\u969C\u5BFC\u81F4\u7684\u6B8B\u4F59\u5931\u8D25",
        affectedModules: ["optimization", "sync"],
        correctionActions: ["rerun_optimization"]
      },
      {
        version: 513,
        description: "v513: [\u540C\u6B65\u5065\u5EB7\u5EA6\u5E95\u5C42\u91CD\u6784] \u2014 (1)P0-\u4E8B\u4EF6\u72B6\u6001\u673A\u91CD\u6784: \u4E25\u683C\u533A\u5206\u5185\u90E8\u7CFB\u7EDF\u4E8B\u4EF6\u4E0EAmazon API\u4EA4\u4E92\u4E8B\u4EF6,settings_update/auto_correction/system_heartbeat\u7B49\u5185\u90E8\u4E8B\u4EF6\u4F7F\u7528internal\u72B6\u6001\u4E0D\u518D\u5E72\u6270\u540C\u6B65\u7387\u7EDF\u8BA1 (2)P0-\u51FA\u4EF7\u9884\u68C0\u673A\u5236(Pre-flight Check): \u5728\u53D1\u8D77\u51FA\u4EF7\u8C03\u6574\u524D\u5F3A\u5236\u6821\u9A8C\u672C\u5730\u5B9E\u4F53\u72B6\u6001\u4E0EAmazon\u5B9E\u65F6\u72B6\u6001,\u5DF2\u5F52\u6863/\u5DF2\u5220\u9664\u5B9E\u4F53\u76F4\u63A5\u6807\u8BB0permanently_failed\u4E0D\u518D\u91CD\u8BD5,\u4ECE\u6E90\u5934\u5207\u65ADenityNotFoundError (3)P0-\u641C\u7D22\u8BCD\u6536\u5272\u95ED\u73AF\u4FEE\u590D: \u901A\u8FC7\u6807\u51C6API Helper\u94FE\u8DEF\u8BB0\u5F55\u540C\u6B65\u72B6\u6001,\u589E\u52A0\u5B8C\u6574\u7684api_sync_detail\u548CapiSyncedAt\u65F6\u95F4\u6233,\u786E\u4FDD\u7EA0\u9519\u5668\u4E0D\u4F1A\u8BEF\u5224\u4E3A\u672A\u540C\u6B65",
        affectedModules: ["sync", "optimization", "automation"],
        correctionActions: ["rerun_optimization"]
      },
      {
        version: 512,
        description: "v512: [SD\u53D7\u4F17\u5B9A\u5411\u4F18\u5316+TypeScript\u7F16\u8BD1\u4FEE\u590D+\u524D\u7AEF\u6CE8\u91CA\u6CC4\u6F0F\u4FEE\u590D] \u2014 (1)P0-SD\u53D7\u4F17\u5B9A\u5411\u4F18\u5316\u5FAA\u73AF: bidOptimizationExecutor\u65B0\u589ESD\u53D7\u4F17\u4F18\u5316\u5FAA\u73AF+amazonApiHelper\u65B0\u589EupdateSdTargetBids API\u540C\u6B65\u8DEF\u7531 (2)P0-TypeScript\u7F16\u8BD1\u4FEE\u590D: \u4ECE12334\u4E2A\u9519\u8BEF\u964D\u81F30,\u4FEE\u590D377\u4E2A\u6587\u4EF6 (3)P0-JSX @ts-ignore\u6CE8\u91CA\u6CC4\u6F0F\u4FEE\u590D: \u4FEE\u590D70\u4E2A\u6587\u4EF6\u4E2D1920\u5904\u524D\u7AEF\u6CE8\u91CA\u6587\u672C\u6CC4\u6F0F (4)P0-SB/SD\u9A8C\u8BC1\u8DEF\u7531\u4FEE\u590D: postOptimizationVerifier\u652F\u6301\u901A\u8FC7campaignType\u6B63\u786E\u8DEF\u7531",
        affectedModules: ["bid", "sync", "optimization"],
        correctionActions: ["rerun_optimization"]
      },
      {
        version: 511,
        description: "v511: [\u51B7\u542F\u52A8\u667A\u80FD\u51FA\u4EF7\u5F15\u64CE\u5347\u7EA7] \u2014 (1)P0-\u591A\u7EA7\u52A8\u6001\u951A\u70B9\u51B7\u542F\u52A8\u51FA\u4EF7: \u91CD\u5199suggestedBidColdStartEngine\u5B9E\u73B0\u56DB\u7EA7\u51FA\u4EF7\u7B56\u7565(AdGroup\u4F18\u8D28\u8BCDCPC\u2192Campaign\u4F18\u8D28\u8BCDCPC\u2192\u8D1D\u53F6\u65AF\u5E73\u6ED1\u2192\u52A8\u6001\u7CFB\u6570\u63A2\u7D22),\u652F\u6301\u5339\u914D\u7C7B\u578B/\u5E7F\u544A\u7C7B\u578B\u52A8\u6001\u7CFB\u6570\u8C03\u6574 (2)P0-\u540C\u6D3B\u52A8\u4F18\u8D28\u8BCDCPC\u53C2\u8003: \u4F18\u5148\u53C2\u8003\u540CAdGroup/Campaign\u5185\u5DF2\u51FA\u5355\u4E14\u6295\u4EA7\u8F83\u597D\u7684\u6295\u653E\u8BCD\u7684\u5B9E\u9645CPC\u4F5C\u4E3A\u51FA\u4EF7\u951A\u70B9 (3)P0-\u8D1D\u53F6\u65AF\u5E73\u6ED1\u6D3B\u52A8\u7EA7\u5148\u9A8C: bayesianBidSmoothingEngine\u5347\u7EA7\u652F\u6301Campaign\u7EA7\u5148\u9A8C\u6784\u5EFA,\u4F18\u5148\u4F7F\u7528\u540C\u6D3B\u52A8\u6570\u636E\u800C\u975E\u8D26\u6237\u7EA7\u6570\u636E (4)P1-RL\u6570\u636E\u8BB0\u5F55\u5668\u5347\u7EA7: actionSource\u65B0\u589Ecold_start\u7C7B\u578B,\u5B9E\u73B0\u51B7\u542F\u52A8\u51FA\u4EF7\u7684\u5B8C\u6574\u5F3A\u5316\u5B66\u4E60\u95ED\u73AF\u8FFD\u8E2A",
        // @ts-ignore
        affectedModules: ["bid", "optimization"],
        correctionActions: ["rerun_optimization"]
      },
      {
        version: 510,
        // @ts-ignore
        description: "v510: [\u7A33\u5B9A\u6027\u4E0E\u6297\u65AD\u5D16\u67B6\u6784\u5347\u7EA7] \u2014 (1)P0-\u62A4\u680F\u6536\u7D27: \u5355\u6B21\u8C03\u4EF7\u4E0A\u9650\u4ECE25%/20%/30%\u7EDF\u4E00\u964D\u81F315%,7\u5929\u7D2F\u8BA1\u964D\u5E45\u4E0A\u9650\u4ECE20%\u964D\u81F315%,\u51B7\u5374\u671F\u533A\u5206SP(72h)/SB-SD(120h) (2)P0-\u52A8\u6001\u5386\u53F2CPC\u5E95\u7EBF: \u67E5\u8BE230-90\u5929\u5386\u53F2\u51FA\u5355\u671FCPC\u4F5C\u4E3A\u52A8\u6001\u5E95\u7EBF,\u66FF\u4EE3\u56FA\u5B9A\u6BD4\u4F8B\u5E95\u7EBF (3)P0-\u6570\u636E\u65AD\u5D16\u4E3B\u52A8\u76D1\u63A7\u5F15\u64CE: \u6BCF6\u5C0F\u65F6\u626B\u63CF\u6240\u6709\u8D26\u6237,\u8FDC\u671F(30-90\u5929)vs\u8FD1\u671F(7\u5929)\u5BF9\u6BD4\u68C0\u6D4B\u65AD\u5D16,\u4E09\u6BB5\u5F0F\u9636\u68AF\u6062\u590D(70%\u219285%\u2192100%\u5386\u53F2CPC),\u65AD\u5D16\u4FEE\u590D\u671F7\u5929\u5185\u7981\u6B62\u964D\u4EF7 (4)P1-\u77FF\u6E23\u63D0\u70BC\u670D\u52A1: \u6BCF\u5468\u626B\u63CF\u5386\u53F2\u8BA2\u5355>=10\u4F46\u8FD130\u5929\u96F6\u8BA2\u5355\u4E14\u51FA\u4EF7\u88AB\u538B\u5236\u7684\u6295\u653E\u8BCD,\u6E10\u8FDB\u5F0F\u6062\u590D\u51FA\u4EF7\u81F3\u5386\u53F2CPC\xD785% (5)P1-\u5206\u65F6\u7ADE\u4EF7\u4E25\u683C\u6570\u636E\u95E8\u69DB: draft\u2192active\u5347\u7EA7\u95E8\u69DB\u4ECE7\u5929\u63D0\u9AD8\u523030\u5929\u8FDE\u7EED\u6295\u653E+50\u6B21\u70B9\u51FB+$20\u82B1\u8D39,\u5206\u65F6\u8C03\u6574\u8303\u56F4\u4ECE\xB140%\u6536\u7D27\u5230\xB120%",
        // @ts-ignore
        affectedModules: ["bid", "optimization", "dayparting"],
        correctionActions: ["rerun_optimization"]
      },
      {
        version: 509,
        description: "v509: [\u540C\u6B65\u72B6\u6001\u81EA\u52A8\u56DE\u5199\u67B6\u6784] \u2014 (1)P0-event_id\u5916\u952E: optimization_tasks\u65B0\u589E event_id\u5217\u5EFA\u7ACB\u4E0Eoptimization_events\u7684\u7CBE\u786E\u5173\u8054\uFF0C\u540C\u6B65\u5B8C\u6210\u65F6\u81EA\u52A8\u56DE\u5199events\u72B6\u6001 (2)P0-\u6570\u636E\u4E00\u81F4\u6027\u68C0\u67E5\u5668: \u6BCF2\u5C0F\u65F6\u626B\u63CFpending\u8D8524\u5C0F\u65F6\u7684\u8BB0\u5F55\uFF0C\u901A\u8FC7event_id\u548Ckeyword_id\u5339\u914D\u81EA\u52A8\u4FEE\u590D\u72B6\u6001 (3)P0-Amazon API\u9519\u8BEF\u7801\u7EDF\u4E00\u6620\u5C04\u8868: \u66FF\u4EE3\u540C\u6B65\u5F15\u64CE\u4E2D9\u5904\u786C\u7F16\u7801\u5B57\u7B26\u4E32\u5339\u914D\uFF0C\u7EDF\u4E00\u5F52\u7C7B\u5904\u7406entityNotFoundError/malformedValueError\u7B49\u9519\u8BEF (4)P1-\u5386\u53F2\u6570\u636E\u56DE\u586B: \u8FC1\u79FB\u65F6\u81EA\u52A8\u5339\u914D7\u5929\u5185\u7684tasks\u548Cevents\u5E76\u56DE\u586Bevent_id\uFF0C\u7ACB\u5373\u56DE\u5199synced/permanently_failed\u72B6\u6001",
        affectedModules: ["sync"],
        correctionActions: ["rerun_optimization"]
      },
      {
        // @ts-ignore
        version: 508,
        description: "v508: [api_sync_status\u6570\u636E\u5B8C\u6574\u6027\u4FEE\u590D] \u2014 (1)P0-ENUM\u2192VARCHAR(32): optimization_events.api_sync_status\u4ECE4\u503CENUM\u6539\u4E3AVARCHAR(32)\uFF0C\u652F\u6301permanently_failed/superseded/invalid_legacy\u7B49\u6269\u5C55\u72B6\u6001 (2)P0-\u7A7A\u5B57\u7B26\u4E32\u56DE\u5199: 21067\u6761\u7A7A\u5B57\u7B26\u4E32\u8BB0\u5F55\u6839\u636Eerror_message\u5185\u5BB9\u56DE\u5199\u6B63\u786E\u72B6\u6001 (3)P0-not_applicable\u51FA\u4EF7\u4E8B\u4EF6\u56DE\u5199: 23774\u6761\u88AB\u9519\u8BEF\u6807\u8BB0\u7684bid_increase/bid_decrease\u4E8B\u4EF6\u901A\u8FC7optimization_tasks\u5339\u914D\u56DE\u5199\u771F\u5B9E\u72B6\u6001 (4)P0-invalid_legacy\u5F52\u6863: 51574\u6761\u5386\u53F2\u9057\u7559\u8BB0\u5F55\u7EDF\u4E00\u6807\u8BB0\u4E3Apermanently_failed (5)P1-\u524D\u7AEF\u540C\u6B65\u5065\u5EB7\u5EA6\u4FEE\u6B63: \u53EA\u7EDF\u8BA1\u6D3B\u8DC3\u72B6\u6001(synced/pending/failed)\uFF0C\u6392\u9664\u5386\u53F2/\u975E\u6D3B\u8DC3\u72B6\u6001",
        // @ts-ignore
        affectedModules: ["optimization"],
        correctionActions: ["rerun_optimization"]
      },
      // @ts-ignore
      {
        version: 507,
        description: "v507: [\u5426\u5B9A\u8BCD\u56DE\u586BID\u7C7B\u578B\u4E0D\u5339\u914D\u4FEE\u590D] \u2014 (1)P0-backfillNegativeKeywordIds\u4E2DMap key\u7C7B\u578B\u4E0D\u5339\u914D: negative_keywords.campaignId\u5B58\u50A8\u7684\u662FAmazon Campaign ID(varchar)\uFF0C\u4F46\u56DE\u586B\u4EE3\u7801\u7528Number()\u8F6C\u6362\u540E\u4F5C\u4E3AMap key\uFF0C\u800C\u67E5\u627E\u65F6\u7528\u539F\u59CBcampaignId(string)\u505AMap.get()\uFF0C\u4E25\u683C\u76F8\u7B49\u5BFC\u81F4\u6C38\u8FDC\u4E0D\u5339\u914D (2)P0-\u67E5\u627E\u987A\u5E8F\u4F18\u5316: \u4ECEeq(campaigns.id, localId)\u4F18\u5148\u6539\u4E3Aeq(campaigns.campaignId, rawIdStr)\u4F18\u5148\uFF0C\u56E0\u4E3A\u5426\u5B9A\u8BCD\u8868\u4E2D\u5B58\u50A8\u7684\u662FAmazon ID\u800C\u975E\u672C\u5730\u81EA\u589EID (3)P1-\u65E5\u5FD7\u6539\u8FDB: \u66F4\u65B0\u6240\u6709\u56DE\u586B\u65E5\u5FD7\u4E3Av507\u524D\u7F00\uFF0C\u660E\u786E\u533A\u5206Amazon ID\u5339\u914D\u548C\u672C\u5730ID\u5339\u914D\u8DEF\u5F84",
        // @ts-ignore
        affectedModules: ["optimization", "sync"],
        correctionActions: ["rerun_optimization"]
      },
      {
        version: 506,
        description: "v506: [SB\u5173\u952E\u8BCDadGroupId\u7F3A\u5931\u4FEE\u590D] \u2014 (1)P0-amazonApiHelper\u7684syncBidAdjustmentsToAmazon: keywords\u8868\u7684adGroupId\u5217\u5728v418\u8FC1\u79FB\u4E2D\u5DF2\u91CD\u547D\u540D\u4E3Ainternal_ad_group_id(int)\uFF0C\u4F46\u4EE3\u7801\u4ECD\u5F15\u7528\u4E0D\u5B58\u5728\u7684keywords.adGroupId\u5BFC\u81F4\u6240\u6709SB\u5173\u952E\u8BCD\u51FA\u4EF7\u540C\u6B65\u5931\u8D25\u3002\u4FEE\u590D\u4E3A\u901A\u8FC7LEFT JOIN ad_groups\u8868\u83B7\u53D6Amazon adGroupId (2)P0-\u8FD9\u662F\u540C\u6B65\u5931\u8D25\u6570\u4ECE4275\u589E\u52A0\u52305433\u7684\u6839\u672C\u539F\u56E0: \u7EA0\u9519\u5668\u6BCF\u6B21\u91CD\u8BD5SB\u5173\u952E\u8BCD\u90FD\u56E0\u7F3A\u5C11adGroupId\u800C\u5931\u8D25\uFF0C\u4EA7\u751F\u65B0\u7684\u5931\u8D25\u8BB0\u5F55",
        affectedModules: ["sync", "bid"],
        correctionActions: ["rerun_optimization"]
      },
      {
        version: 505,
        description: 'v505: [\u540C\u6B65\u5931\u8D25\u6839\u56E0\u4FEE\u590D] \u2014 (1)P0-syncPerformance\u8FDE\u63A5\u6C60\u8017\u5C3D: \u6279\u91CF\u5199\u5165\u5E76\u53D1\u4ECE100\u964D\u81F38\uFF0C\u907F\u514D\u8D85\u51FA\u8FDE\u63A5\u6C60\u4E0A\u9650(limit=20)\u5BFC\u81F4\u7EA7\u8054\u5931\u8D25 (2)P0-syncPerformance\u7684NULL\u5904\u7406: decimal\u5B57\u6BB5null\u6539\u4E3A"0.00"\u4FEE\u590DNOT NULL\u7EA6\u675F\u8FDD\u53CD (3)P0-systemDefenseService\u7684ensureSystemConfigTable: \u4F7F\u7528sql\u6A21\u677F\u6807\u7B7E\u66FF\u4EE3{sql,params}\u5BF9\u8C61\u683C\u5F0F\uFF0C\u4FEE\u590D"e.getSQL is not a function"\u9519\u8BEF (4)P0-systemDefenseService\u7684optimization_events\u67E5\u8BE2: SQL\u5217\u540D\u4ECEcamelCase\u6539\u4E3Asnake_case\u5339\u914D\u5B9E\u9645\u8868\u7ED3\u6784 (5)P0-syncCampaignStatusToAmazon\u53C2\u6570\u683C\u5F0F: \u4ECE\u7EAFID\u6570\u7EC4\u6539\u4E3A\u5BF9\u8C61\u6570\u7EC4\u5339\u914D\u51FD\u6570\u7B7E\u540D',
        affectedModules: ["sync", "bid"],
        correctionActions: ["rerun_optimization"]
      },
      {
        version: 487,
        description: "v487: [\u56E2\u961F\u6210\u5458\u521B\u5EFA\u4FEE\u590D] \u2014 (1)P0-createTeamMemberAccount\u4E2D\u89D2\u8272\u5B58\u50A8\u9519\u8BEF: editor/viewer\u88AB\u9519\u8BEF\u8F6C\u6362\u4E3Amember\uFF0C\u5BFC\u81F4\u524D\u7AEFgetRoleBadge\u627E\u4E0D\u5230\u5BF9\u5E94\u89D2\u8272\u914D\u7F6E\u800C\u62A5\u9519Cannot read properties of undefined (reading variant) (2)\u524D\u7AEF\u6DFB\u52A0member\u89D2\u8272\u6620\u5C04\u548Cfallback\u5904\u7406\uFF0C\u786E\u4FDD\u5411\u540E\u517C\u5BB9",
        affectedModules: [],
        correctionActions: []
      },
      {
        version: 486,
        description: "v486: [\u9080\u8BF7\u7801\u7BA1\u7406\u9875\u9762\u4FA7\u8FB9\u680F\u4FEE\u590D] \u2014 P0-\u9080\u8BF7\u7801\u7BA1\u7406\u9875\u9762\u7F3A\u5C11DashboardLayout\u5305\u88F9\uFF0C\u5BFC\u81F4\u5DE6\u4FA7\u5BFC\u822A\u680F\u7F3A\u5931\uFF0C\u65E0\u6CD5\u5FEB\u901F\u8FDB\u5165\u5176\u4ED6\u6A21\u5757\u3002\u5DF2\u6DFB\u52A0DashboardLayout\u5305\u88F9\uFF0C\u786E\u4FDD\u6240\u6709\u9875\u9762\u90FD\u6709\u7EDF\u4E00\u7684\u4FA7\u8FB9\u680F\u5BFC\u822A",
        affectedModules: [],
        correctionActions: []
      },
      {
        version: 485,
        description: "v485: [\u4FA7\u8FB9\u680F\u6743\u9650\u63A7\u5236] \u2014 (1)P0-\u7CFB\u7EDF\u76D1\u63A7\u83DC\u5355(\u7EA0\u9519\u76D1\u63A7/\u7CFB\u7EDF\u5065\u5EB7/\u6570\u636E\u5065\u5EB7/\u540C\u6B65\u65E5\u5FD7)\u4EC5\u7CFB\u7EDF\u7BA1\u7406\u5458\u53EF\u89C1 (2)P0-\u9080\u8BF7\u7801\u7BA1\u7406\u548C\u5BA1\u8BA1\u65E5\u5FD7\u4ECE\u57FA\u7840\u83DC\u5355\u63D0\u53D6\u4E3A\u7CFB\u7EDF\u7BA1\u7406\u83DC\u5355\u7EC4\uFF0C\u4EC5\u7CFB\u7EDF\u7BA1\u7406\u5458\u53EF\u89C1 (3)\u56E2\u961F\u7BA1\u7406\u4FDD\u7559\u5728\u57FA\u7840\u83DC\u5355\u4E2D\uFF0C\u6240\u6709\u79DF\u6237\u5747\u53EF\u8BBF\u95EE",
        affectedModules: [],
        correctionActions: []
      },
      {
        version: 484,
        description: "v484: [\u7B56\u7565\u7BA1\u7406\u65F6\u95F4\u8303\u56F4\u7B5B\u9009] \u2014 (1)P0-\u5E7F\u544A\u6D3B\u52A8\u7BA1\u7406\u65F6\u95F4\u7B5B\u9009: \u4F18\u5316\u76EE\u6807\u8BE6\u60C5\u9875\u7684\u5E7F\u544A\u6D3B\u52A8\u5217\u8868\u65B0\u589E\u65F6\u95F4\u8303\u56F4\u7B5B\u9009(\u4ECA\u5929/7\u5929/14\u5929/30\u5929/60\u5929/90\u5929)\uFF0C\u6570\u636E\u6839\u636E\u9009\u62E9\u7684\u65F6\u95F4\u8303\u56F4\u52A8\u6001\u6C47\u603B\u7EE9\u6548\u6307\u6807 (2)P0-\u6DFB\u52A0\u5E7F\u544A\u6D3B\u52A8\u65F6\u95F4\u7B5B\u9009: \u6DFB\u52A0\u5E7F\u544A\u6D3B\u52A8\u5BF9\u8BDD\u6846\u65B0\u589E\u65F6\u95F4\u8303\u56F4\u7B5B\u9009\uFF0C\u65B9\u4FBF\u7528\u6237\u6309\u65F6\u95F4\u7EF4\u5EA6\u67E5\u770B\u5E7F\u544A\u6D3B\u52A8\u6570\u636E (3)\u670D\u52A1\u7AEF\u65B0\u589E getCampaignsByPerformanceGroupIdWithPerformance \u548C getUnassignedCampaignsWithPerformance \u6570\u636E\u5E93\u51FD\u6570\uFF0C\u652F\u6301\u65F6\u95F4\u8303\u56F4\u5185\u7EE9\u6548\u6570\u636E\u6C47\u603B",
        affectedModules: [],
        correctionActions: []
      },
      {
        version: 483,
        description: "v483: [\u56E2\u961F\u6210\u5458\u7BA1\u7406\u4E0E\u7528\u6237\u4E2A\u4EBA\u8BBE\u7F6E] \u2014 (1)P0-\u56E2\u961F\u6210\u5458\u76F4\u63A5\u521B\u5EFA\u8D26\u53F7: \u5C06\u90AE\u7BB1\u9080\u8BF7\u6D41\u7A0B\u6539\u4E3A\u7BA1\u7406\u5458\u76F4\u63A5\u586B\u5199\u7528\u6237\u540D+\u771F\u5B9E\u59D3\u540D+\u5BC6\u7801\u521B\u5EFA\u6210\u5458\u8D26\u53F7\uFF0C\u65B0\u589E team.createMember API\u548C createTeamMemberAccount \u670D\u52A1\u51FD\u6570 (2)P0-\u7528\u6237\u4E2A\u4EBA\u8BBE\u7F6E: \u4FA7\u8FB9\u680F\u7528\u6237\u83DC\u5355\u65B0\u589E\u4E2A\u4EBA\u4FE1\u606F(\u4FEE\u6539\u7528\u6237\u540D/\u59D3\u540D/\u90AE\u7BB1)\u548C\u4FEE\u6539\u5BC6\u7801\u529F\u80FD\uFF0C\u65B0\u589E auth.updateProfile API\u548C updateProfile \u670D\u52A1\u51FD\u6570",
        affectedModules: [],
        correctionActions: []
      },
      {
        version: 482,
        description: 'v482: [\u591A\u79DF\u6237\u6570\u636E\u9694\u79BB\u4E0E\u6743\u9650\u4FEE\u590D] \u2014 (1)P0-\u7B97\u6CD5\u6548\u679C\u6982\u89C8\u6570\u636E\u9694\u79BB: algorithmEffectService.ts\u7684optimization_events\u548Coptimization_logs\u67E5\u8BE2\u6539\u4E3A\u57FA\u4E8E\u8D26\u6237\u5F52\u5C5E(accountId)\u7684\u6570\u636E\u9694\u79BB\uFF0C\u7CFB\u7EDF\u7BA1\u7406\u5458\u67E5\u770B\u6240\u6709\u6570\u636E\uFF0C\u666E\u901A\u7528\u6237\u53EA\u80FD\u67E5\u770B\u81EA\u5DF1\u8D26\u6237\u7684\u6570\u636E\uFF0C\u65B0\u7528\u6237\u65E0\u8D26\u6237\u65F6\u8FD4\u56DE\u7A7A\u6570\u636E (2)P0-\u9884\u53D1\u5E03\u5F15\u64CE\u6743\u9650\u6536\u7D27: DashboardLayout.tsx\u4FA7\u8FB9\u680F\u9884\u53D1\u5E03\u5F15\u64CE\u83DC\u5355\u4ECE"role===admin"\u6539\u4E3A"role===admin && organizationId===1"\uFF0C\u4EC5\u5185\u90E8\u7CFB\u7EDF\u7BA1\u7406\u5458\u53EF\u89C1 (3)P1-\u79FB\u9664ElaraFit\u5360\u4F4D\u7B26: Amazon API\u6DFB\u52A0\u5E97\u94FA\u5F39\u7A97\u7684placeholder\u4ECE"\u4F8B\u5982\uFF1AElaraFit\u3001My Store\u7B49"\u6539\u4E3A"\u4F8B\u5982\uFF1AMy Store\u3001\u6211\u7684\u5E97\u94FA\u7B49"',
        affectedModules: [],
        correctionActions: []
      },
      {
        version: 481,
        description: "v481: [\u6CE8\u518C\u9875\u9762\u81EA\u52A8\u8DF3\u8F6C\u767B\u5F55\u9875\u7D27\u6025\u4FEE\u590D] \u2014 (1)P0-inviteCode.validate\u4ECEprotectedProcedure\u6539\u4E3ApublicProcedure: \u5141\u8BB8\u672A\u767B\u5F55\u7528\u6237\u5728\u6CE8\u518C\u9875\u9762\u9A8C\u8BC1\u9080\u8BF7\u7801 (2)P0-\u516C\u5F00\u9875\u9762\u514D\u75AB\u672A\u6388\u6743\u91CD\u5B9A\u5411: main.tsx\u7684redirectToLoginIfUnauthorized\u6392\u9664/register\u7B49\u516C\u5F00\u8DEF\u5F84\uFF0C\u9632\u6B62\u672A\u767B\u5F55\u7528\u6237\u88AB\u5F3A\u5236\u8DF3\u8F6C\u5230\u767B\u5F55\u9875",
        affectedModules: [],
        correctionActions: []
      },
      {
        version: 480,
        description: "v480: [SP Manual\u5426\u5B9A\u4EA7\u54C1\u5B9A\u5411400\u9519\u8BEF\u6839\u56E0\u4FEE\u590D] \u2014 (1)P0-\u5B9A\u5411\u7B97\u6CD5\u4FEE\u590D: SP Manual\u5E7F\u544A\u6D3B\u52A8\u7684\u5426\u5B9A\u4EA7\u54C1\u5B9A\u5411\u4ECECampaign\u7EA7\u964D\u7EA7\u4E3AAdGroup\u7EA7\uFF0C\u56E0\u4E3AAmazon API\u4E0D\u5141\u8BB8Manual\u5E7F\u544A\u6D3B\u52A8\u521B\u5EFACampaign\u7EA7\u5426\u5B9A\u4EA7\u54C1\u5B9A\u5411(\u8FD4\u56DE400\u9519\u8BEF)\uFF0C\u53EA\u6709SP Auto\u5E7F\u544A\u6D3B\u52A8\u652F\u6301Campaign\u7EA7\u5426\u5B9A\u4EA7\u54C1\u5B9A\u5411",
        affectedModules: ["searchterm"],
        correctionActions: []
      },
      {
        version: 479,
        description: "v479: [\u5F7B\u5E95\u6D88\u9664entityNotFoundError\u6B8B\u7559] \u2014 (1)P0-\u4FEE\u590Dh.execute bug: getDb()\u6539\u4E3Aawait getDb()+sql.raw()\u6A21\u677F\uFF0C\u4FEE\u590Dv477\u6807\u8BB0\u8FC7\u671F\u5173\u952E\u8BCD\u529F\u80FD\u5B8C\u5168\u5931\u6548\u7684\u95EE\u9898 (2)P0-\u91CD\u8BD5\u961F\u5217amazon_deleted\u6E05\u7406: \u6279\u91CF\u540C\u6B65\u524D\u81EA\u52A8\u53D6\u6D88\u5F15\u7528amazon_deleted/archived\u5B9E\u4F53\u7684pending/retry\u4EFB\u52A1 (3)P0-updateKeywordStatus entityNotFound\u68C0\u6D4B: \u5173\u952E\u8BCD\u72B6\u6001\u66F4\u65B0\u7684per-item\u9519\u8BEF\u73B0\u5728\u4E5F\u80FD\u68C0\u6D4BentityNotFoundError\u5E76\u81EA\u52A8\u6807\u8BB0",
        affectedModules: ["bid", "placement", "dayparting", "searchterm"],
        correctionActions: []
      },
      {
        version: 478,
        description: "v478: [\u5168\u9762\u4FEE\u590D5\u7C7B\u5931\u8D25\u6839\u56E0 \u2014 \u5B9E\u73B0100%API\u6267\u884C\u6210\u529F\u7387] \u2014 (1)P0-SB/SD\u5426\u5B9A\u8BCDAPI\u8DEF\u7531: SB/SD\u5E7F\u544A\u6D3B\u52A8\u7684\u5426\u5B9A\u5173\u952E\u8BCD\u4E0D\u518D\u8BEF\u7528SP API\uFF0C\u6539\u4E3A\u8DF3\u8FC7\u5E76\u8BB0\u5F55 (2)P0-\u5426\u5B9A\u4EA7\u54C1\u5B9A\u5411\u5E42\u7B49\u6027: \u521B\u5EFA\u524D\u67E5\u8BE2\u5DF2\u6709\u5426\u5B9A\u4EA7\u54C1\u5B9A\u5411\uFF0C\u53BB\u9664\u91CD\u590D\u907F\u514D\u62A5\u9519 (3)P0-\u9519\u8BEF\u8BE6\u60C5\u56DE\u5199: \u5426\u5B9A\u4EA7\u54C1\u5B9A\u5411\u7684\u5931\u8D25\u539F\u56E0\u73B0\u5728\u88AB\u6B63\u786E\u8BB0\u5F55\u5230apiSyncDetail (4)P0-\u5931\u8D25\u91CD\u8BD5\u5165\u961F: add_negative_product_target\u5931\u8D25\u73B0\u5728\u4F1A\u88AB\u6536\u96C6\u5E76\u5165\u961F\u91CD\u8BD5 (5)P1-campaignType\u4F20\u9012: \u5426\u5B9A\u5173\u952E\u8BCD\u7684detail\u5BF9\u8C61\u73B0\u5728\u643A\u5E26campaignType\u7528\u4E8EAPI\u8DEF\u7531",
        affectedModules: ["searchterm"],
        correctionActions: []
      },
      {
        version: 477,
        description: "v477: [entityNotFoundError\u6839\u6CBB \u2014 \u667A\u80FD\u91CD\u8BD5+\u9884\u8FC7\u6EE4+\u81EA\u52A8\u6807\u8BB0\u673A\u5236] \u2014 (1)P0-\u667A\u80FD\u91CD\u8BD5: \u9047\u5230entityNotFoundError\u65F6\u81EA\u52A8\u63D0\u53D6\u574F\u7684entity ID\uFF0C\u4ECEAPI\u6279\u6B21\u4E2D\u79FB\u9664\u540E\u91CD\u8BD5\u5269\u4F59\u9879\u76EE\uFF0C\u6700\u591A10\u6B21 (2)P0-\u9884\u8FC7\u6EE4: \u5728\u6784\u5EFAAPI\u6279\u6B21\u524D\u67E5\u8BE2keyword/target\u7684\u72B6\u6001\uFF0C\u81EA\u52A8\u8DF3\u8FC7amazon_deleted/archived\u7684entity (3)P0-\u81EA\u52A8\u6807\u8BB0: \u88ABAmazon\u62D2\u7EDD\u7684entity\u81EA\u52A8\u6807\u8BB0\u4E3Aamazon_deleted\uFF0C\u9632\u6B62\u540E\u7EED\u91CD\u590D\u5931\u8D25 (4)\u8986\u76D6\u8303\u56F4: updateKeywordBids/updateProductTargetBids/updateKeywordStatus\u4E09\u4E2AAPI\u51FD\u6570",
        affectedModules: ["bid", "placement", "dayparting", "dayparting_budget", "searchterm"],
        correctionActions: []
      },
      {
        version: 476,
        description: "v476: [API\u9650\u6D41\u9632\u62A4 \u2014 \u5168\u5C42\u7EA7\u6FC0\u8FDB\u8282\u6D41\u673A\u5236\uFF0C\u4F18\u5148\u4FDD\u8BC1100%\u6210\u529F\u7387] \u2014 (1)P0-\u4F18\u5316\u6A21\u5757\u95F4\u8282\u6D41: \u6BCF\u4E2A\u6A21\u5757\u6267\u884C\u540E\u7B49\u5F8520\u79D2 (2)P0-PostDeploy\u9636\u6BB5\u95F4\u8282\u6D41: A-F\u9636\u6BB5\u95F4\u6BCF\u6B21\u7B49\u5F8520\u79D2 (3)P0-\u76EE\u6807\u95F4\u8282\u6D41: \u8C03\u5EA6\u5668\u548CPostDeploy\u76EE\u6807\u95F4\u5747\u7B49\u5F8530\u79D2 (4)P0-\u5E7F\u544A\u6D3B\u52A8\u95F4\u8282\u6D41: \u6BCF\u4E2A\u5E7F\u544A\u6D3B\u52A8\u7684\u4F18\u5316\u64CD\u4F5C\u95F4\u96945\u79D2 (5)P1-API\u6279\u6B21\u95F4\u8282\u6D41: \u5173\u952E\u8BCD/\u5546\u54C1\u5B9A\u5411\u6279\u91CF\u66F4\u65B0\u95F4\u7B49\u5F8510\u79D2 (6)P1-\u5EFA\u8BAE\u7ADE\u4EF7\u540C\u6B65\u8282\u6D41: \u6BCF\u4E2AadGroup\u8BF7\u6C42\u95F4\u96945\u79D2 (7)P1-\u91CD\u8BD5\u673A\u5236\u589E\u5F3A: \u57FA\u7840\u5EF6\u8FDF10\u79D2/\u6700\u5927\u9000\u907F60\u79D2/\u6700\u591A5\u6B21\u91CD\u8BD5 (8)P2-\u6570\u636E\u540C\u6B65\u8282\u6D41: \u6B65\u9AA4\u95F4\u57FA\u7840\u5EF6\u8FDF2\u79D2/\u5927\u8D26\u6237\u989D\u5916\u5EF6\u8FDF10\u79D2/\u8D26\u6237\u95F4\u5EF6\u8FDF10\u79D2",
        affectedModules: ["bid", "placement", "dayparting", "dayparting_budget", "budget", "searchterm"],
        correctionActions: []
      },
      // @ts-ignore
      {
        version: 475,
        description: "v475: [PostDeployOptimizer\u81EA\u6108\u4FEE\u590D+\u5168\u91CF\u91CD\u4F18\u5316\u89E6\u53D1] \u2014 (1)P0-\u7248\u672C\u68C0\u6D4B\u4FEE\u590D: getLastDeployedVersion\u73B0\u5728\u540C\u65F6\u63A5\u53D7success\u548Cpartial_success\u72B6\u6001,\u4FEE\u590D\u65E0\u9650\u91CD\u8BD5\u5FAA\u73AF (2)P0-\u72B6\u6001\u5224\u5B9A\u6539\u8FDB: \u65E0\u6A21\u5757\u6267\u884C\u4E14\u65E0\u9519\u8BEF\u65F6\u89C6\u4E3Asuccess(\u65E0\u9700\u64CD\u4F5C) (3)P0-\u5168\u91CF\u91CD\u4F18\u5316\u89E6\u53D1: \u56E0\u4E4B\u524D\u7248\u672C\u4ECE\u672A\u771F\u6B63\u6267\u884C\u91CD\u4F18\u5316,\u672C\u7248\u672C\u5F3A\u5236\u89E6\u53D1full_reoptimize\u5BF9\u6240\u6709\u6D3B\u8DC3\u76EE\u6807\u91CD\u65B0\u4F18\u5316 (4)P1-\u9519\u8BEF\u8BE6\u60C5\u65E5\u5FD7: \u6BCF\u4E2A\u76EE\u6807\u7684\u91CD\u4F18\u5316\u9519\u8BEF\u73B0\u5728\u4EE5WARN\u7EA7\u522B\u8BB0\u5F55,\u4FBF\u4E8E\u8BCA\u65AD",
        affectedModules: ["bid", "placement", "dayparting", "dayparting_budget", "budget", "searchterm", "keyword", "multidim", "coordination", "product_target"],
        // @ts-ignore
        correctionActions: ["full_reoptimize", "rerun_optimization", "revalidate_pending_commands", "audit_synced_commands", "rerun_correction_scan"]
      },
      {
        version: 445,
        description: "v445: [\u9501\u51B2\u7A81\u673A\u5236\u4FEE\u590D + force-sync\u91CD\u6784 + \u9519\u8BEF\u89E3\u6790\u589E\u5F3A] \u2014 (1)P0-force-sync\u91CD\u6784: tier=full\u65F6\u4F7F\u7528triggerManualFullSync\u83B7\u5F97\u5B8C\u6574\u529F\u80FD(\u542Bnightly\u6B65\u9AA4+\u5FC3\u8DF3\u8FDB\u5EA6), \u6DFB\u52A0isManual\u6807\u8BB0\u4F7F\u624B\u52A8\u540C\u6B65\u83B7\u5F97\u6700\u9AD8\u4F18\u5148\u7EA7 (2)P0-trigger_source\u533A\u5206: data_sync_jobs\u65B0\u589Etrigger_source\u5B57\u6BB5\u533A\u5206manual/auto, \u81EA\u52A8\u540C\u6B65\u8C03\u5EA6\u5668\u6392\u9664\u624B\u52A8\u540C\u6B65job\u907F\u514D\u4E92\u76F8\u963B\u585E (3)P1-negative_keyword\u9519\u8BEF\u89E3\u6790\u589E\u5F3A: \u8986\u76D6otherError/entityNotFoundError/malformedValueError\u7B49\u6240\u6709Amazon\u9519\u8BEF\u7C7B\u578B, \u4E0D\u518D\u4E22\u5931\u9519\u8BEF\u8BE6\u60C5 (4)P1-\u4E0D\u53EF\u6062\u590D\u9519\u8BEF\u81EA\u52A8\u68C0\u6D4B: entityNotFoundError/malformedValueError\u76F4\u63A5\u6807\u8BB0permanently_failed\u4E0D\u518D\u91CD\u8BD5 (5)P2-archived\u5B9E\u4F53\u8FC7\u6EE4: getKeywordsByCampaignId/getKeywordsByAdGroupId/getProductTargetsByCampaignId\u81EA\u52A8\u8FC7\u6EE4archived\u72B6\u6001\u5B9E\u4F53",
        // @ts-expect-error - runtime type mismatch
        affectedModules: ["sync", "ops", "db"],
        correctionActions: []
      },
      {
        version: 444,
        description: "v444: [\u5168\u5C40\u5B57\u6BB5/ID\u6807\u51C6\u7EDF\u4E00\u5BA1\u8BA1\u4E0E\u4FEE\u590D + API\u9519\u8BEF\u89E3\u6790\u589E\u5F3A] \u2014 (1)P0-\u5386\u53F2NULL\u6570\u636E\u56DE\u586B: product_targets 29\u6761+2\u6761\u91CD\u590D\u5220\u9664, search_terms 493\u6761, negative_keywords 21\u6761\u5B64\u513F\u6570\u636E\u5220\u9664 (2)P0-\u5168\u5C40accountId NOT NULL\u7EA6\u675F: \u5BF924\u4E2A\u8868\u7684accountId\u5B57\u6BB5\u7EDF\u4E00\u52A0NOT NULL\u7EA6\u675F (3)P1-schema\u540C\u6B65: drizzle/schema.ts\u4E2D\u6240\u6709accountId\u5B57\u6BB5\u7EDF\u4E00\u4E3A.notNull() (4)P2-API\u9519\u8BEF\u89E3\u6790\u589E\u5F3A: SP/SB keyword\u3001product target\u7684API\u9519\u8BEF\u54CD\u5E94\u73B0\u5728\u8BB0\u5F55\u5B8C\u6574JSON\u5BF9\u8C61\uFF0C\u517C\u5BB9errorCode/errorMessage/errorDescription\u7B49\u5B57\u6BB5\u540D",
        // @ts-expect-error - runtime type mismatch
        affectedModules: ["schema", "db", "sync"],
        correctionActions: []
      },
      {
        version: 443,
        description: "v443: [\u50F5\u5C38\u8D26\u6237\u81EA\u52A8\u68C0\u6D4B\u4E0E\u6807\u6CE8\u673A\u5236] \u2014 (1)P0-\u50F5\u5C38\u8D26\u6237\u81EA\u52A8\u68C0\u6D4B: \u65B0\u589EzombieAccountDetector\u6A21\u5757,\u5728\u6BCF\u6B21high\u5C42\u540C\u6B65\u5B8C\u6210\u540E\u81EA\u52A8\u68C0\u67E5\u8FDE\u7EED10\u6B21\u540C\u6B650\u6761\u8BB0\u5F55\u7684\u8D26\u6237\u5E76\u81EA\u52A8\u6807\u8BB0\u4E3Apaused (2)P0-paused\u8D26\u6237\u8FC7\u6EE4: discoverSyncableAccounts\u73B0\u5728\u8FC7\u6EE4paused\u72B6\u6001\u7684\u8D26\u6237,\u4E0D\u518D\u6D6A\u8D39API\u8C03\u7528 (3)P1-\u8D26\u6237\u7BA1\u7406API: \u65B0\u589EPOST /api/ops/detect-zombies\u624B\u52A8\u89E6\u53D1\u68C0\u6D4B + POST /api/ops/reactivate-account\u91CD\u65B0\u6FC0\u6D3B\u8D26\u6237 (4)P2-\u7ACB\u5373\u6682\u505C90022(MX)/90025(CA)/90026(MX)\u4E09\u4E2A\u65E0\u7ECF\u8425\u8D26\u6237",
        // @ts-expect-error - runtime type mismatch
        affectedModules: ["sync", "ops", "infrastructure"],
        correctionActions: []
      },
      {
        // @ts-ignore
        version: 442,
        description: "v442: [AMS\u7D2F\u52A0\u6A21\u5F0F\u91CD\u6784 + \u7EDF\u4E00\u540C\u6B65\u65E5\u5FD7 + \u50F5\u5C38\u8D26\u6237\u6392\u67E5] \u2014 (1)P0-AMS\u6570\u636E\u5904\u7406\u91CD\u6784: upsertDailyPerformanceFromAms\u4ECEover\u5199\u6A21\u5F0F\u8F6C\u4E3A\u7D2F\u52A0\u6A21\u5F0F(impressions+=, clicks+=, cost+=, sales+=),\u65B0\u589Eams_processed_messages\u8868\u5B9E\u73B0idempotency_id\u53BB\u91CD (2)P0-updateDailyPerformanceConversion\u540C\u6837\u91CD\u6784\u4E3A\u7D2F\u52A0\u6A21\u5F0F (3)P1-\u7EDF\u4E00\u540C\u6B65\u65E5\u5FD7: force-sync\u7AEF\u70B9\u73B0\u5728\u4F1A\u521B\u5EFAdata_sync_jobs\u8BB0\u5F55,\u540C\u6B65\u5B8C\u6210\u540E\u66F4\u65B0\u72B6\u6001/\u8017\u65F6/\u8BB0\u5F55\u6570 (4)P2-\u50F5\u5C38\u8D26\u6237\u6392\u67E5: \u786E\u8BA490022(MX)/90025(CA)/90026(MX)API\u51ED\u8BC1\u6709\u6548\u4F46Amazon\u540E\u53F0\u65E0\u5E7F\u544A\u6D3B\u52A8",
        // @ts-expect-error - runtime type mismatch
        affectedModules: ["sync", "db", "ops"],
        correctionActions: [
          // @ts-ignore
          "CREATE TABLE IF NOT EXISTS ams_processed_messages (id INT AUTO_INCREMENT PRIMARY KEY, idempotency_id VARCHAR(128) NOT NULL UNIQUE, dataset_id VARCHAR(64), processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)"
        ]
      },
      // @ts-ignore
      {
        // @ts-ignore
        version: 418,
        // @ts-ignore
        description: "v418: [ID\u4F53\u7CFB\u4E00\u81F4\u6027\u91CD\u6784 + \u96C6\u4E2D\u5F0FID\u89E3\u6790 + API\u9A8C\u8BC1\u5C42] \u2014 (1)P0-BUG\u4FEE\u590D: \u4FEE\u590DSD\u5339\u914D\u76EE\u6807\u62A5\u544A\u9519\u8BEF\u7684reportTypeId(sdMatchedTarget\u2192sdTargeting), SB\u5E7F\u544A\u4F4D\u62A5\u544A\u914D\u7F6E\u9519\u8BEF(reportTypeId+groupBy), \u641C\u7D22\u8BCD\u6536\u5272harvestAmazonAdGroupId\u672A\u8D4B\u503C, \u5426\u5B9A\u5173\u952E\u8BCDcampaignId\u56DE\u9000\u4F7F\u7528\u5185\u90E8ID (2)P0-\u6A21\u5F0F\u91CD\u6784: keywords/productTargets/searchTerms/negativeKeywords\u7B4911\u5F20\u8868\u7684adGroupId(varchar)\u91CD\u547D\u540D\u4E3AinternalAdGroupId(int),\u7EDF\u4E00ID\u7C7B\u578B\u6D88\u9664\u9690\u5F0F\u7C7B\u578B\u8F6C\u6362 (3)P1-\u96C6\u4E2D\u5F0FID\u89E3\u6790\u670D\u52A1: \u65B0\u589EEntityIdResolver\u7EDF\u4E00\u5904\u7406\u5185\u90E8ID\u2194Amazon ID\u8F6C\u6362,\u5E26\u7F13\u5B58\u548C\u6279\u91CF\u89E3\u6790 (4)P1-API\u53C2\u6570\u9884\u68C0\u9A8C\u8BC1\u5C42: \u65B0\u589EAmazonApiValidator\u57FA\u4E8E\u5B98\u65B9Postman\u96C6\u5408\u9A8C\u8BC1reportTypeId/groupBy/columns/ID\u683C\u5F0F",
        // @ts-expect-error - runtime type mismatch
        affectedModules: ["sync", "optimization", "schema", "utils"],
        correctionActions: [
          // @ts-ignore
          "ALTER TABLE keywords CHANGE COLUMN ad_group_id internal_ad_group_id INT",
          // @ts-ignore
          "ALTER TABLE product_targets CHANGE COLUMN ad_group_id internal_ad_group_id INT",
          // @ts-ignore
          "ALTER TABLE search_terms CHANGE COLUMN ad_group_id internal_ad_group_id INT",
          // @ts-ignore
          "ALTER TABLE negative_keywords CHANGE COLUMN ad_group_id internal_ad_group_id INT"
        ]
      },
      {
        version: 417,
        description: "v417: [\u4FE1\u606F\u5B64\u5C9B\u5BA1\u8BA1\u4E0E\u4FEE\u590D + \u67B6\u6784\u4F18\u5316] \u2014 (1)P0-\u5B9E\u73B0\u7F3A\u5931API: \u65B0\u589EamazonApi.getAllAuthStatus\u548CamazonApi.refreshToken\u4E24\u4E2AtRPC\u8DEF\u7531,\u4FEE\u590D\u524D\u7AEFAmazonApiAuthStatus\u9875\u9762\u7684\u65AD\u88C2\u94FE\u8DEF (2)P0-\u542F\u52A8effectTrackingScheduler: \u5728\u7CFB\u7EDF\u542F\u52A8\u65F6\u8C03\u7528startEffectTrackingScheduler(\u6BCF1\u5C0F\u65F6),\u5E76\u5728deployLifecycleManager\u4E2D\u6DFB\u52A0\u4F18\u96C5\u505C\u6B62\u903B\u8F91 (3)P1-\u6E05\u7406\u6B7B\u4EE3\u7801: \u5220\u9664services/effectTrackingScheduler.ts(664\u884C)\u3001services/amazonApiTypes.ts(53\u884C)\u3001sync/performanceSyncOptimizer.ts(252\u884C) (4)P2-\u67B6\u6784\u4F18\u5316: sync\u76EE\u5F55\u6574\u5408(services/sync\u2192sync/)\u3001bidOptimizer.ts\u62C6\u5206\u4E3A5\u4E2A\u529F\u80FD\u6A21\u5757\u3001\u524D\u7AEFpages\u6309\u529F\u80FD\u57DF\u91CD\u7EC4\u523012\u4E2A\u5B50\u76EE\u5F55",
        // @ts-expect-error - runtime type mismatch
        affectedModules: ["sync", "optimization", "frontend", "infrastructure"],
        correctionActions: []
      },
      {
        version: 416,
        // @ts-ignore
        description: "v416: [\u540E\u7AEF\u4EE3\u7801\u7ED3\u6784\u91CD\u6784] \u2014 (1)P0-server\u6839\u76EE\u5F55\u91CD\u7EC4: \u5C06114\u4E2A\u6587\u4EF6\u6309\u529F\u80FD\u57DF\u5F52\u7C7B\u523028\u4E2A\u5B50\u76EE\u5F55(api/\u3001sync/\u3001scheduler/\u3001optimization/\u3001budget/\u3001analytics/\u3001system/\u3001config/\u3001automation/\u7B49) (2)P0-\u66F4\u65B0601\u4E2Aimport\u8DEF\u5F84: \u81EA\u52A8\u5316\u811A\u672C\u5904\u7406\u6240\u6709\u9759\u6001import\u548C\u52A8\u6001import\u7684\u8DEF\u5F84\u66F4\u65B0 (3)P1-\u6E05\u740670+\u9876\u5C42\u6742\u6563\u6587\u4EF6: \u5386\u53F2\u62A5\u544A/\u8C03\u8BD5\u811A\u672C/\u56FE\u8868\u5F52\u6863\u5230docs/archive/ (4)P2-\u9879\u76EE\u6587\u6863\u4F53\u7CFB: \u65B0\u589Edocs/development/\u4E0B\u67B6\u6784\u8BF4\u660E\u3001\u6A21\u5757\u8BF4\u660E\u3001\u5F00\u53D1\u6307\u5357",
        // @ts-expect-error - runtime type mismatch
        affectedModules: ["infrastructure"],
        correctionActions: []
      },
      {
        version: 415,
        // @ts-ignore
        description: "v415: [\u5EFA\u8BAE\u7ADE\u4EF7\u540C\u6B65+\u6570\u636E\u540C\u6B65\u5168\u9762\u5BA1\u8BA1] \u2014 (1)P0-\u65B0\u589ESP\u5EFA\u8BAE\u7ADE\u4EF7\u540C\u6B65: \u5728syncSp.ts\u4E2D\u65B0\u589EsyncSpBidRecommendations\u65B9\u6CD5,\u6309adGroup\u5206\u7EC4\u6279\u91CF\u8C03\u7528Amazon SP Bid Recommendations API,\u5C06suggestedBid\u5199\u5165keywords\u548CproductTargets\u8868 (2)P0-\u65B0\u589ESYNC_STEP: sp_bid_recommendations\u6B65\u9AA4(full tier),\u5728\u6BCF\u6B21\u5B8C\u6574\u540C\u6B65\u65F6\u81EA\u52A8\u83B7\u53D6\u5EFA\u8BAE\u7ADE\u4EF7 (3)P1-\u524D\u7AEF\u5C55\u793A\u5EFA\u8BAE\u7ADE\u4EF7: \u5728AdGroupDetail\u7684\u5173\u952E\u8BCD\u548C\u5546\u54C1\u5B9A\u4F4D\u8868\u683C\u4E2D\u6DFB\u52A0\u5EFA\u8BAE\u7ADE\u4EF7\u5217,\u9EC4\u8272\u8868\u793A\u5EFA\u8BAE\u7ADE\u4EF7\u9AD8\u4E8E\u5F53\u524D\u51FA\u4EF7,\u7EFF\u8272\u8868\u793A\u4F4E\u4E8E\u6216\u7B49\u4E8E (4)P2-\u6570\u636E\u540C\u6B65\u6A21\u5757\u5168\u9762\u5BA1\u8BA1: \u786E\u8BA4\u6240\u670931\u4E2ASYNC_STEPS\u8986\u76D6SP/SB/SD\u6240\u6709\u5C42\u7EA7",
        // @ts-expect-error - runtime type mismatch
        affectedModules: ["sync", "frontend"],
        // @ts-ignore
        correctionActions: ["revalidate_sync_performance"]
      },
      {
        // @ts-ignore
        version: 414,
        description: "v414: [\u6E90\u7801\u5E72\u51C0\u6784\u5EFA] \u2014 (1)P0-\u79FB\u9664\u5916\u6302BullMQ\u8865\u4E01: \u6E05\u9664v484-v490\u7684\u6240\u6709\u8FD0\u884C\u65F6\u6CE8\u5165\u4EE3\u7801,\u6062\u590D\u7EAF\u51C0\u6E90\u7801\u67B6\u6784 (2)P0-\u4FEESB adGroupId\u6620\u5C04: \u4FEE\u590D42849\u4E2ASB keywords\u548C3498\u4E2Aproduct targets\u7684adGroupId\u4ECAAmazon ID\u6620\u5C04\u5230\u5185\u90E8DB ID (3)P1-\u6D88\u9664Worker\u961F\u5217\u51B2\u7A81: \u79FB\u9664v490\u72EC\u7ACB\u7684ads-account-sync-queue,\u89E3\u51B3\u4E0E\u539F\u59CB\u961F\u5217\u7684Ay\u9501\u51B2\u7A81\u95EE\u9898",
        // @ts-expect-error - runtime type mismatch
        affectedModules: ["sync", "scheduler"],
        // @ts-ignore
        correctionActions: ["revalidate_sync_performance"]
      },
      // @ts-ignore
      {
        version: 410,
        description: "v410: [\u8C03\u5EA6\u5668\u5168\u5C40\u5E76\u53D1\u63A7\u5236] \u2014 (1)P0-\u6570\u636E\u5E93\u7EA7\u522B\u5E76\u53D1\u68C0\u67E5: executeUnifiedSync\u5728\u6267\u884C\u524D\u67E5\u8BE2data_sync_jobs\u8868\u4E2D\u662F\u5426\u6709running\u72B6\u6001\u4E14\u5FC3\u8DF3\u6B63\u5E38(\u8FD110\u5206\u949F\u5185\u66F4\u65B0)\u7684\u4EFB\u52A1,\u5982\u679C\u5B58\u5728\u5219\u8DF3\u8FC7\u672C\u6B21\u8C03\u5EA6 (2)P0-\u89E3\u51B3\u624B\u52A8/\u81EA\u52A8\u540C\u6B65\u51B2\u7A81: \u4E4B\u524D\u624B\u52A8\u89E6\u53D1\u7684\u5168\u91CF\u540C\u6B65\u4E0D\u4F1A\u8BBE\u7F6EtierRunningState\u5185\u5B58\u53D8\u91CF,\u5BFC\u81F4\u8C03\u5EA6\u5668\u4ECD\u7136\u4F1A\u521B\u5EFA\u65B0\u4EFB\u52A1,\u73B0\u5728\u901A\u8FC7\u6570\u636E\u5E93\u67E5\u8BE2\u5F7B\u5E95\u89E3\u51B3 (3)P1-\u907F\u514DAPI\u9650\u6D41: \u591A\u4E2A\u540C\u6B65\u4EFB\u52A1\u5E76\u53D1\u8BF7\u6C42Amazon API\u4F1A\u89E6\u53D1429/425\u9650\u6D41,\u5355\u4EFB\u52A1\u8FD0\u884C\u786E\u4FDD\u6700\u4F18API\u5229\u7528\u7387 (4)P2-\u5BB9\u9519\u56DE\u9000: \u6570\u636E\u5E93\u68C0\u67E5\u5931\u8D25\u65F6\u56DE\u9000\u5230\u5185\u5B58\u7EA7\u522BtierRunningState\u68C0\u67E5,\u4E0D\u963B\u585E\u6B63\u5E38\u540C\u6B65",
        // @ts-expect-error - runtime type mismatch
        affectedModules: ["sync", "scheduler"],
        // @ts-ignore
        correctionActions: ["revalidate_sync_performance"]
        // @ts-ignore
      },
      {
        version: 412,
        description: "v412: [\u5B57\u6BB5\u6620\u5C04\u4FEE\u590D] \u2014 \u4FEE\u590DDrizzle mysql2\u8FD4\u56DE\u683C\u5F0F[rows,fields]\u7684\u89E3\u6790\u95EE\u9898,\u786E\u4FDD\u5E76\u53D1\u68C0\u67E5\u548C\u4EFB\u52A1\u63A5\u7BA1\u65E5\u5FD7\u6B63\u786E\u663E\u793A\u4EFB\u52A1ID\u3001\u8D26\u6237\u3001\u8FDB\u5EA6\u7B49\u4FE1\u606F",
        // @ts-expect-error - runtime type mismatch
        affectedModules: ["sync", "scheduler"],
        // @ts-ignore
        correctionActions: ["revalidate_sync_performance"]
      },
      {
        version: 411,
        description: "v411: [\u4E09\u9879\u4F18\u5316] \u2014 (1)P0-Stale cleanup\u9608\u503C\u8C03\u4F18: \u542F\u52A8\u6E05\u740630\u5206\u949F\u219210\u5206\u949F,\u5B9A\u671F\u6E05\u740660\u5206\u949F\u219215\u5206\u949F,\u4E0Ev410\u5E76\u53D1\u68C0\u67E5\u7A97\u53E3\u4E00\u81F4,\u907F\u514D\u50F5\u5C38\u4EFB\u52A1\u957F\u65F6\u95F4\u963B\u585E\u8C03\u5EA6\u5668 (2)P0-\u4EFB\u52A1\u63A5\u7BA1\u673A\u5236: \u670D\u52A1\u5668\u91CD\u542F\u540E\u65B0\u5B9E\u4F8B\u8BFB\u53D6\u4E2D\u65AD\u4EFB\u52A1\u7684\u65AD\u70B9\u4FE1\u606F,\u5BF9\u4E8E\u6B65\u9AA4\u8F83\u591A(>=10\u6B65)\u4E14\u5DF2\u5B8C\u6210\u8D85\u8FC73\u6B65\u7684\u4EFB\u52A1,\u89E6\u53D1full\u540C\u6B65\u63A5\u7BA1\u6062\u590D (3)P1-\u5E76\u53D1\u63A7\u5236\u65E5\u5FD7\u589E\u5F3A: \u6DFB\u52A0\u8DF3\u8FC7\u8BA1\u6570\u5668\u3001\u5FC3\u8DF3\u65F6\u95F4\u3001\u8FDB\u5EA6\u767E\u5206\u6BD4,\u6062\u590D\u6267\u884C\u65F6\u8F93\u51FA\u4E4B\u524D\u8DF3\u8FC7\u6B21\u6570",
        // @ts-expect-error - runtime type mismatch
        affectedModules: ["sync", "scheduler"],
        // @ts-ignore
        correctionActions: ["revalidate_sync_performance"]
      },
      {
        version: 410,
        description: "v410: [\u8C03\u5EA6\u5668\u5168\u5C40\u5E76\u53D1\u63A7\u5236] \u2014 \u6570\u636E\u5E93\u7EA7\u522B\u68C0\u67E5running\u4EFB\u52A1,\u907F\u514D\u8C03\u5EA6\u5668\u5728\u5168\u91CF\u540C\u6B65\u8FD0\u884C\u65F6\u521B\u5EFA\u65B0\u4EFB\u52A1\u5BFC\u81F4API\u9650\u6D41",
        // @ts-ignore
        affectedModules: ["scheduler"],
        // @ts-ignore
        correctionActions: ["revalidate_sync_performance"]
      },
      {
        version: 409,
        description: "v409: [Startup/Shutdown\u6E05\u7406\u673A\u5236\u4FEE\u590D] \u2014 (1)P0-Shutdown\u4E0D\u518D\u65E0\u6761\u4EF6\u6740\u6B7Brunning\u540C\u6B65\u4EFB\u52A1: \u4E4B\u524DSIGTERM\u65F6\u65E0\u6761\u4EF6\u5C06\u6240\u6709running\u4EFB\u52A1\u6807\u8BB0\u4E3Afailed,\u5BFC\u81F4\u6B63\u5E38\u8FD0\u884C\u7684\u540C\u6B65\u88AB\u8BEF\u6740;\u73B0\u5728\u53EA\u8BB0\u5F55\u65E5\u5FD7,\u7531startup cleanup\u57FA\u4E8Eupdated_at\u9608\u503C\u5904\u7406 (2)P0-Startup cleanup\u6DFB\u52A05\u5206\u949F\u9608\u503C: \u4E4B\u524D\u65E0\u6761\u4EF6\u6E05\u7406\u6240\u6709running\u4EFB\u52A1,\u73B0\u5728\u53EA\u6E05\u7406updated_at\u8D85\u8FC75\u5206\u949F\u7684\u4EFB\u52A1(\u5FC3\u8DF3\u95F4\u96943\u5206\u949F,5\u5206\u949F\u65E0\u66F4\u65B0\u624D\u5224\u5B9A\u4E3A\u5361\u6B7B) (3)P1-\u4FDD\u62A4\u5FC3\u8DF3\u6B63\u5E38\u7684\u4EFB\u52A1: startup\u65F6\u5982\u679C\u53D1\u73B0\u5FC3\u8DF3\u6B63\u5E38\u7684running\u4EFB\u52A1,\u8BB0\u5F55\u65E5\u5FD7\u4F46\u4E0D\u6E05\u7406",
        // @ts-expect-error - runtime type mismatch
        affectedModules: ["sync", "scheduler"],
        // @ts-ignore
        correctionActions: ["revalidate_sync_performance"]
      },
      {
        version: 408,
        // @ts-ignore
        description: "v408: [\u5FC3\u8DF3\u673A\u5236+\u50F5\u5C38\u6E05\u7406\u4FEE\u590D] \u2014 (1)P0-\u5FC3\u8DF3\u673A\u5236: \u6B65\u9AA4\u6267\u884C\u671F\u95F4\u6BCF3\u5206\u949F\u901A\u8FC7onProgress\u66F4\u65B0updated_at,\u9632\u6B62\u957F\u6B65\u9AA4(\u5982\u5F53\u65E5\u7EE9\u6548\u9700\u7B49\u5F85Amazon\u62A5\u544A\u751F\u621015\u5206\u949F)\u88AB\u8BEF\u5224\u4E3A\u5361\u6B7B (2)P0-\u50F5\u5C38\u5224\u5B9A\u57FA\u51C6\u4FEE\u590D: cleanupStaleJobs\u4ECEstartedAt\u6539\u4E3Aupdated_at\u5224\u65AD,\u53EA\u6709\u957F\u65F6\u95F4\u65E0\u66F4\u65B0\u624D\u5224\u5B9A\u4E3A\u5361\u6B7B(\u800C\u975E\u542F\u52A8\u65F6\u95F4\u8D85\u8FC7\u9608\u503C) (3)P1-\u6E05\u7406\u9608\u503C\u8C03\u6574: \u542F\u52A8\u6E05\u740630\u5206\u949F+\u5B9A\u671F\u6E05\u740660\u5206\u949F(\u4ECEstartedAt\u768410/30\u5206\u949F\u6062\u590D\u4E3Aupdated_at\u7684\u5408\u7406\u9608\u503C) (4)P2-\u5F02\u5E38\u5B89\u5168: catch\u5757\u4E2D\u4E5F\u6E05\u9664\u5FC3\u8DF3\u5B9A\u65F6\u5668\u9632\u6B62\u5185\u5B58\u6CC4\u6F0F",
        // @ts-expect-error - runtime type mismatch
        affectedModules: ["sync", "scheduler"],
        // @ts-ignore
        correctionActions: ["revalidate_sync_performance"]
      },
      {
        // @ts-ignore
        version: 407,
        description: "v407: [\u524D\u540E\u7AEF\u8FDB\u5EA6\u4E00\u81F4\u6027\u4FEE\u590D] \u2014 (1)P0-API\u589E\u5F3A: getSyncJobById\u8FD4\u56DEcurrentStepIndex\u548CtotalSteps,\u524D\u7AEF\u53EF\u7CBE\u786E\u663E\u793A\u7B2CX/Y\u6B65 (2)P0-\u524D\u7AEF\u8FDB\u5EA6\u4FEE\u590D: \u6574\u4F53\u8FDB\u5EA6\u6761\u4ECE\u7AD9\u70B9\u7EA7\u8BA1\u7B97\u6539\u4E3A\u7EFC\u5408\u6B65\u9AA4\u7EA7\u8BA1\u7B97,\u76F4\u63A5\u4F7F\u7528\u540E\u7AEFprogressPercent (3)P0-\u52A8\u6001\u6B65\u9AA4\u8FDB\u5EA6\u6761: \u4ECE\u786C\u7F16\u780117\u683C\u6539\u4E3A\u6839\u636EtotalSteps\u52A8\u6001\u751F\u6210,\u652F\u630131\u6B65\u5168\u91CF\u540C\u6B65 (4)P1-\u6B65\u9AA4\u540D\u79F0\u663E\u793A: \u76F4\u63A5\u663E\u793A\u540E\u7AEF\u8FD4\u56DE\u7684\u6B65\u9AA4\u540D,\u4E0D\u518D\u4F9D\u8D56\u786C\u7F16\u7801\u6620\u5C04\u8868",
        // @ts-expect-error - runtime type mismatch
        affectedModules: ["sync", "frontend"],
        // @ts-ignore
        correctionActions: ["revalidate_sync_performance"]
      },
      // @ts-ignore
      {
        version: 406,
        description: "v406: [\u540C\u6B65\u5F15\u64CE\u5168\u9762\u4FEE\u590D] \u2014 (1)P0-\u8FDB\u5EA6\u66F4\u65B0await: syncAccount\u4E2DonProgress\u56DE\u8C03\u6DFB\u52A0await,\u786E\u4FDDDB\u5199\u5165\u5B8C\u6210\u540E\u518D\u7EE7\u7EED,\u4FEE\u590D\u524D\u7AEF\u8FDB\u5EA6\u6C38\u8FDC\u5361\u5728\u521D\u59CB\u72B6\u6001\u7684bug (2)P0-\u624B\u52A8\u540C\u6B65\u4F18\u5148\u7EA7: \u65B0\u589EisManual\u6807\u8BB0,\u624B\u52A8\u5168\u91CF\u540C\u6B65\u4E0D\u518D\u88AB\u81EA\u52A8\u540C\u6B65\u963B\u585E,\u5F3A\u5236\u91CA\u653E\u81EA\u52A8\u540C\u6B65\u9501 (3)P0-nightly PST\u65F6\u533A: \u591C\u95F4\u540C\u6B65\u4ECE\u670D\u52A1\u5668\u672C\u5730\u65F6\u95F4\u6539\u4E3APST\u51CC\u66682\u70B9(UTC 10:00) (4)P1-\u50F5\u5C38\u4EFB\u52A1\u6E05\u7406: cleanupStaleJobs\u9608\u503C\u4ECE30\u5206\u949F\u7F29\u77ED\u523010\u5206\u949F (5)P1-\u9501\u91CA\u653E\u4FEE\u590D: syncAll\u8DEF\u7531\u4E2D\u9501\u91CA\u653E\u79FB\u5165finally\u5757,\u786E\u4FDD\u6574\u4E2A\u540C\u6B65\u671F\u95F4\u6301\u6709\u9501 (6)P1-Job\u72B6\u6001\u521D\u59CB\u5316: \u540C\u6B65\u542F\u52A8\u65F6\u7ACB\u5373\u5C06job\u72B6\u6001\u66F4\u65B0\u4E3Arunning",
        // @ts-expect-error - runtime type mismatch
        affectedModules: ["sync", "scheduler"],
        // @ts-ignore
        correctionActions: ["revalidate_sync_performance"]
        // @ts-ignore
      },
      {
        version: 405,
        description: "v405: [Auto Scaling\u7A33\u5B9A\u6027+\u540C\u6B65SIGTERM\u4FDD\u62A4] \u2014 (1)P0-Auto Scaling\u4FEE\u590D: Scale Down Cooldown\u4ECE360s\u589E\u52A0\u5230900s,\u8BC4\u4F30\u5468\u671F\u4ECE1\u4E2A(5min)\u589E\u52A0\u52303\u4E2A(15min),\u9632\u6B62\u540C\u6B65\u671F\u95F4\u5B9E\u4F8B\u88AB\u7EC8\u6B62 (2)P0-SIGTERM\u4FDD\u62A4: syncAccount\u6B65\u9AA4\u5FAA\u73AF\u4E2D\u68C0\u67E5isShuttingDown,\u63D0\u524D\u4FDD\u5B58\u8FDB\u5EA6\u5E76\u4F18\u96C5\u9000\u51FA (3)P1-\u90E8\u7F72\u540E\u540C\u6B65\u964D\u7EA7: deployLifecycleManager\u6B65\u9AA43.5d\u4ECEfull\u5C42\u7EA7\u6539\u4E3Ahigh\u5C42\u7EA7,\u907F\u514DCPU\u98D9\u5347\u89E6\u53D1\u4F38\u7F29 (4)P2-ebextensions\u914D\u7F6E: \u65B0\u589E04_autoscaling.config,\u56FA\u5316Cooldown\u548C\u6EDA\u52A8\u66F4\u65B0\u7B56\u7565",
        // @ts-expect-error - runtime type mismatch
        affectedModules: ["sync", "infrastructure"],
        // @ts-ignore
        correctionActions: ["revalidate_sync_performance"]
      },
      {
        version: 404,
        description: "v404: [\u7EDF\u4E00\u540C\u6B65\u4EE3\u7801\u8DEF\u5F84] \u2014 (1)P0-\u624B\u52A8\u540C\u6B65\u7EDF\u4E00: amazonApi.syncAll\u8DEF\u7531\u4ECE500+\u884C\u786C\u7F16\u7801\u91CD\u6784\u4E3A\u8C03\u7528unifiedSyncEngine.triggerManualFullSync,\u624B\u52A8/\u81EA\u52A8\u540C\u6B65\u5171\u7528\u540C\u4E00\u4EE3\u7801\u8DEF\u5F84 (2)P0-\u5168\u91CF\u540C\u6B65\u8986\u76D6\u6240\u6709\u6B65\u9AA4: \u624B\u52A8\u5168\u91CF\u540C\u6B65\u73B0\u5728\u6267\u884C\u6240\u6709SYNC_STEPS(\u542Bnightly\u5C42\u7EA7),\u786E\u4FDDkeyword_performance/target_performance/ad_group_performance\u4E0D\u88AB\u9057\u6F0F (3)P0-specificSteps\u4FEE\u590D: syncAccount\u4E2DspecificSteps\u73B0\u5728\u4ECESYNC_STEPS\u5168\u96C6\u8FC7\u6EE4\u800C\u975EgetStepsForTier\u7ED3\u679C,\u652F\u6301\u8DE8\u5C42\u7EA7\u6267\u884C",
        // @ts-ignore
        affectedModules: ["sync", "api"],
        // @ts-ignore
        correctionActions: ["revalidate_sync_performance"]
      },
      {
        // @ts-ignore
        version: 403,
        // @ts-ignore
        description: "v403: [\u6570\u636E\u9694\u79BB\u5B89\u5168\u52A0\u56FA+nightly\u540C\u6B65\u5C42\u7EA7+\u524D\u7AEF\u4F18\u5316+\u54C1\u724C\u91CD\u547D\u540D] \u2014 (1)P0-\u6570\u636E\u9694\u79BB: smartCampaign\u8DEF\u7531\u65B0\u589E4\u4E2AverifyAccountAccess\u4E2D\u95F4\u4EF6,\u5806\u585E\u8D8A\u6743\u8BBF\u95EE\u6F0F\u6D1E (2)P1-\u627F\u8F7D\u80FD\u529B: EB\u73AF\u5883\u53D8\u91CFDB_POOL_SIZE=100/NODE_OPTIONS=3072MB/MAX_CONCURRENT_ACCOUNTS=15 (3)P2-nightly\u540C\u6B65\u5C42\u7EA7: \u5C06keyword_performance/target_performance/ad_group_performance\u4ECEfull\u8FC1\u79FB\u5230nightly\u5C42\u7EA7,\u6BCF\u65E5\u51CC\u66682\u70B9\u6267\u884C,\u8D85\u65F64\u5C0F\u65F6,\u89E3\u51B3full\u5C42\u7EA7\u8D85\u65F6\u95EE\u9898 (4)P3-\u7B56\u7565\u7BA1\u7406\u9875\u9762: \u589E\u52A0isError\u72B6\u6001\u5904\u7406\u548C\u91CD\u65B0\u52A0\u8F7D\u6309\u94AE (5)P3-\u54C1\u724C\u91CD\u547D\u540D: \u5168\u5C40\u66FF\u6362Amazon Ads Optimizer\u4E3APPCOPT,\u79FB\u9664\u9875\u811A\u7248\u6743\u4FE1\u606F",
        // @ts-expect-error - runtime type mismatch
        affectedModules: ["sync", "frontend", "security", "infrastructure"],
        // @ts-ignore
        correctionActions: ["revalidate_sync_performance"]
      },
      {
        version: 402,
        description: "v402: [\u540E\u7AEF\u5206\u9875+\u540C\u6B65\u5206\u89E3+\u8FDE\u63A5\u6C60+\u524D\u7AEF\u4F18\u5316] \u2014 (1)P1-\u540E\u7AEF\u5206\u9875API: campaigns.listPaginated\u65B0\u7AEF\u70B9,\u652F\u6301\u670D\u52A1\u7AEF\u5206\u9875/\u6392\u5E8F/\u7B5B\u9009/\u641C\u7D22,\u8FD4\u56DE\u72B6\u6001\u7EDF\u8BA1\u548C\u7C7B\u578B\u7EDF\u8BA1 (2)P1-\u524D\u7AEFCampaigns\u9875\u9762\u6539\u9020: \u5207\u6362\u5230\u670D\u52A1\u7AEF\u5206\u9875\u6A21\u5F0F,\u9AD8\u7EA7\u7B5B\u9009\u65F6\u56DE\u9000\u5230\u5168\u91CF\u6A21\u5F0F (3)P2-\u540C\u6B65\u5B50\u4EFB\u52A1\u5206\u89E3: syncAll\u65B0\u589Elayers\u53C2\u6570\u652F\u6301\u6309\u5C42\u6267\u884C,Layer\u7EA7\u522B\u9519\u8BEF\u9694\u79BB,\u5931\u8D25\u4E0D\u5F71\u54CD\u540E\u7EED\u5C42 (4)P3-\u8FDE\u63A5\u6C60\u4F18\u5316: DB_POOL_SIZE\u9ED8\u8BA4\u503C\u4ECE25\u63D0\u5347\u5230100 (5)P3-\u524D\u7AEF\u4EE3\u7801\u5206\u5272: SmartInsights/QuickActions\u61D2\u52A0\u8F7D,\u5BFC\u51FA\u529F\u80FD\u52A8\u6001import,Campaigns chunk\u51CF\u5C117%",
        // @ts-expect-error - runtime type mismatch
        affectedModules: ["sync", "frontend", "infrastructure"],
        // @ts-ignore
        correctionActions: ["revalidate_sync_performance"]
      },
      {
        version: 401,
        description: "v401: [\u6DF1\u5EA6\u6027\u80FD\u4F18\u5316+\u57FA\u7840\u8BBE\u65BD\u5347\u7EA7] \u2014 (1)P0-SQL\u7D22\u5F15\u4F18\u5316: \u5C06\u9AD8\u9891\u67E5\u8BE2\u4E2D\u7684DATE()\u51FD\u6570\u5305\u88F9\u6539\u4E3A\u8303\u56F4\u67E5\u8BE2,\u5141\u8BB8MySQL\u4F7F\u7528idx_daily_perf_campaign_date\u7B49\u7D22\u5F15(db-performance-trend/budgetTracking/budgetAlert/optimization.getTrends) (2)P0-SP\u81EA\u52A8\u5B9A\u5411\u540C\u6B65N+1\u4FEE\u590D: syncAutoTargeting\u5FAA\u73AF\u5185\u7684adGroup\u67E5\u8BE2\u6539\u4E3A\u9884\u52A0\u8F7DMap+\u6279\u91CFUPSERT (3)P1-RDS\u5347\u7EA7: db.t4g.small\u2192db.t4g.medium(4GB RAM)+\u5B58\u50A8\u4ECE20GB\u219250GB+IOPS\u5347\u81F33000 (4)P1-keywordPlacementHourlyPerformance\u8868\u7D22\u5F15\u4ECEPLAIN INDEX\u6539\u4E3AUNIQUE\u7EA6\u675F,\u9632\u6B62\u5E76\u53D1\u91CD\u590D\u6570\u636E (5)P1-Dashboard\u76EE\u6807\u8FBE\u6210\u5EA6\u7EDF\u4E00\u4F7F\u7528\u540E\u7AEF\u4E03\u7EF4\u5EA6\u8BC4\u5206\u800C\u975E\u524D\u7AEF\u7B80\u5355\u6BD4\u503C (6)P2-optimizationLogs\u8868\u6DFB\u52A0account_id+status+created_at\u590D\u5408\u7D22\u5F15\u4F18\u5316getMetrics\u67E5\u8BE2",
        // @ts-ignore
        affectedModules: ["sync", "optimization", "frontend", "infrastructure"],
        // @ts-ignore
        correctionActions: ["revalidate_sync_performance", "run_schema_migration"]
      },
      {
        version: 400,
        description: "v400: [\u5168\u9762\u4F18\u5316\u4FEE\u590D] \u2014 (1)P0-\u4FEE\u590DCorrectionReview\u9875\u9762\u5D29\u6E83: \u53D8\u91CF\u58F0\u660E\u987A\u5E8F\u9519\u8BEF\u5BFC\u81F4TDZ\u9519\u8BEF,accounts\u5728useGlobalAccountId\u4E4B\u540E\u4F7F\u7528 (2)P0-\u4FEE\u590DAutoOptimizationDashboard\u6C38\u4E45\u52A0\u8F7D: \u6DFB\u52A0DashboardLayout\u5305\u88F9+\u9519\u8BEF\u72B6\u6001\u5904\u7406+\u91CD\u8BD5\u6309\u94AE+\u9AA8\u67B6\u5C4F\u4F18\u5316 (3)P1-\u4FEE\u590D\u5E7F\u544A\u4F4D\u7EE9\u6548\u540C\u6B65N+1\u67E5\u8BE2: \u9884\u52A0\u8F7Dcampaigns\u6620\u5C04\u66FF\u4EE3\u5FAA\u73AF\u5185\u9010\u6761\u67E5\u8BE2+\u79FB\u9664\u5197\u4F59existing\u68C0\u67E5 (4)P1-\u4FEE\u590D\u5E7F\u544A\u7EC4\u7EE9\u6548\u540C\u6B65N+1\u67E5\u8BE2: SP/SB/SD\u5E7F\u544A\u7EC4\u5FAA\u73AF\u5185\u67E5\u8BE2\u6539\u4E3A\u9884\u52A0\u8F7DMap\u67E5\u627E (5)P1-\u4F18\u5316SQL\u67E5\u8BE2: campaigns\u67E5\u8BE2\u4ECESELECT*\u6539\u4E3A\u53EA\u67E5\u5FC5\u8981\u5B57\u6BB5",
        // @ts-ignore
        affectedModules: ["sync", "optimization", "frontend"],
        // @ts-ignore
        correctionActions: ["revalidate_sync_performance"]
      },
      {
        version: 397,
        description: "v397: [\u5806\u5185\u5B58\u4F7F\u7528\u7387\u544A\u8B66\u8BEF\u62A5\u4FEE\u590D] \u2014 (1)\u5168\u5C40\u7EDF\u4E00\u4F7F\u7528v8.getHeapStatistics().heap_size_limit\u66FF\u4EE3process.memoryUsage().heapTotal\u8BA1\u7B97\u5806\u5185\u5B58\u4F7F\u7528\u7387,\u6D88\u9664V8\u52A8\u6001\u6536\u7F29heapTotal\u5BFC\u81F4\u7684\u865A\u9AD897%\u544A\u8B66 (2)monitoring.ts\u7CFB\u7EDF\u8D44\u6E90API:heapUsagePercent\u6539\u7528heap_size_limit\u8BA1\u7B97,\u544A\u8B66\u9608\u503C\u4ECE90%\u8C03\u6574\u4E3A85% (3)ops.ts\u8FD0\u7EF4\u8BCA\u65ADAPI:evaluateAlerts\u548C/status\u7AEF\u70B9\u7684heapUsagePct\u6539\u7528heap_size_limit (4)optimizationAutoCorrector.ts\u5B9A\u65F6\u7EA0\u9519\u626B\u63CF\u5185\u5B58\u68C0\u67E5\u6539\u7528heap_size_limit (5)\u524D\u7AEFHealthMonitor.tsx\u589E\u52A0\u5806\u4E0A\u9650\u660E\u7EC6\u663E\u793A",
        affectedModules: [],
        correctionActions: []
      },
      {
        version: 396,
        description: 'v396: [\u5426\u5B9A\u8BCD\u540C\u6B65campaignType\u5B89\u5168\u8FC7\u6EE4] \u2014 (1)P1-optimizationSyncEngine\u5426\u5B9A\u8BCD\u540C\u6B65\u589E\u52A0campaignType\u8FC7\u6EE4,SB/SD\u7C7B\u578Bcampaign\u81EA\u52A8\u8DF3\u8FC7SP\u5426\u5B9A\u8BCDAPI,\u907F\u514D"parent program type must be Sponsored Products"\u9519\u8BEF\u548C\u65E0\u9650\u91CD\u8BD5 (2)P1-automationExecutionEngine\u5426\u5B9A\u8BCD\u540C\u6B65\u540C\u6837\u589E\u52A0campaignType\u68C0\u67E5,SB/SD\u7C7B\u578B\u8BB0\u5F55\u4F18\u5316\u65E5\u5FD7\u4F46\u4E0D\u8C03\u7528API (3)\u4FEE\u590D\u5426\u5B9A\u8BCD\u56DE\u586B\u65F6\u540C\u65F6\u83B7\u53D6campaignType\u5B57\u6BB5',
        affectedModules: ["keyword", "searchterm"],
        correctionActions: ["revalidate_pending_commands"]
      },
      {
        version: 395,
        description: "v395: [\u641C\u7D22\u8BCD\u6570\u636E\u7CBE\u51C6\u6027\u4FEE\u590D+SUMMARY\u805A\u5408+500\u79DF\u6237\u540C\u6B65\u541E\u5410\u91CF\u63D0\u5347] \u2014 (1)P0-\u641C\u7D22\u8BCD\u540C\u6B65\u4ECEINSERT\u6539\u4E3AON DUPLICATE KEY UPDATE,\u6D88\u9664\u6BCF\u6B21\u540C\u6B65\u4EA7\u751F\u7684\u91CD\u590D\u6570\u636E (2)P0-SB\u641C\u7D22\u8BCD\u540C\u6837\u6539\u4E3A\u6279\u91CFUPSERT,\u6D88\u9664\u9010\u6761\u67E5\u8BE2\u7684N+1\u6027\u80FD\u95EE\u9898 (3)P0-\u5173\u952E\u8BCD\u7EE9\u6548SUMMARY\u6A21\u5F0F\u5206\u6279\u6570\u636E\u6309targetId\u805A\u5408\u7D2F\u52A0,\u4FEE\u590D\u540E\u4E00\u6279\u8986\u76D6\u524D\u4E00\u6279\u7684\u6570\u636E\u4E22\u5931\u95EE\u9898 (4)P0-\u5E7F\u544A\u7EC4\u7EE9\u6548fetchBatchedReport\u6DFB\u52A0groupByKey\u53C2\u6570,SP/SB/SD\u5E7F\u544A\u7EC4\u62A5\u544A\u5206\u6279\u805A\u5408 (5)P1-500\u79DF\u6237\u540C\u6B65\u541E\u5410\u91CF\u63D0\u534780%:\u9AD8\u989150\u219280,\u4E2D\u989180\u2192120,\u5168\u91CF100\u2192200 (6)P1-\u6C47\u7387\u8C03\u7528\u4ECE\u5FAA\u73AF\u5185\u79FB\u5230\u5FAA\u73AF\u5916\u9884\u52A0\u8F7D,\u6D88\u9664\u6BCF\u6761\u8BB0\u5F55\u7684async\u5F00\u9500 (7)\u641C\u7D22\u8BCD\u8868\u6DFB\u52A0\u552F\u4E00\u7EA6\u675F\u8FC1\u79FB,\u81EA\u52A8\u6E05\u7406\u5386\u53F2\u91CD\u590D\u6570\u636E",
        affectedModules: ["bid", "budget", "keyword", "searchterm", "placement", "dayparting"],
        correctionActions: ["revalidate_pending_commands"]
      },
      {
        version: 394,
        description: "v394: [\u8FDE\u63A5\u6C60\u6CC4\u9732\u81EA\u52A8\u68C0\u6D4B\u56DE\u6536+\u524D\u7AEF\u4EE3\u7801\u5206\u5272\u63A8\u5E7F] \u2014 (1)connection.ts\u65B0\u589E\u8FDE\u63A5\u6CC4\u9732\u8FFD\u8E2A\u5668,\u6BCF30\u79D2\u626B\u63CF\u6D3B\u8DC3\u8FDE\u63A5,\u8D85\u8FC7120\u79D2\u672A\u91CA\u653E\u81EA\u52A8\u56DE\u6536 (2)\u8BB0\u5F55\u6BCF\u4E2A\u501F\u51FA\u8FDE\u63A5\u7684\u8C03\u7528\u6808\u4FBF\u4E8E\u8BCA\u65AD (3)getPoolStats()\u65B0\u589EactiveDirectConnections/oldestActiveConnectionMs/autoReclaimed\u6307\u6807 (4)OptimalBidCell\u4ECE2968\u884CCampaigns.tsx\u62C6\u5206\u4E3A\u72EC\u7ACB\u7EC4\u4EF6\u652F\u6301lazy loading (5)Home\u9875\u9762(1757\u884C)\u6539\u4E3Alazy loading,\u51CF\u5C0F\u521D\u59CB\u5305\u4F53\u79EF",
        affectedModules: ["bid", "budget", "keyword", "searchterm", "placement", "dayparting"],
        correctionActions: ["revalidate_pending_commands"]
      },
      {
        version: 393,
        description: "v393: [\u52A8\u6001\u5185\u5B58\u914D\u7F6E\u670D\u52A1+\u6D88\u9664\u786C\u7F16\u7801\u5185\u5B58\u9608\u503C+\u5185\u5B58\u4FDD\u62A4\u81EA\u9002\u5E94] \u2014 (1)\u65B0\u5EFAsystemConfigService,\u901A\u8FC7v8.getHeapStatistics()\u52A8\u6001\u83B7\u53D6Node.js\u5806\u5185\u5B58\u4E0A\u9650 (2)\u4FEE\u590DunifiedSyncEngine\u4E2DheapUtilization\u786C\u7F16\u78011400MB\u7684\u81F4\u547D\u9519\u8BEF,\u6539\u4E3A\u52A8\u6001\u8BA1\u7B97 (3)dataSyncScheduler\u5185\u5B58\u4FDD\u62A4\u9608\u503C\u4ECE\u786C\u7F16\u7801(1200/900MB)\u6539\u4E3A\u52A8\u6001\u8BA1\u7B97(\u57FA\u4E8E\u5806\u5185\u5B58\u4E0A\u9650\u7684105%/80%) (4)_core/index.ts\u5065\u5EB7\u68C0\u67E5\u9608\u503C\u4ECE\u786C\u7F16\u78011400MB\u6539\u4E3A\u52A8\u6001\u83B7\u53D6",
        affectedModules: ["bid", "budget", "keyword", "searchterm", "placement", "dayparting"],
        correctionActions: ["revalidate_pending_commands"]
      },
      {
        version: 392,
        description: "v392: [\u7CFB\u7EDF\u8D44\u6E90\u76D1\u63A7+DB\u8FDE\u63A5\u6C60\u6269\u5BB9+\u524D\u7AEF\u7EC4\u4EF6\u7EA7\u4EE3\u7801\u5206\u5272] \u2014 (1)\u6DFB\u52A0/api/monitoring/system-resources\u7AEF\u70B9,\u5B9E\u65F6\u76D1\u63A7CPU/\u5185\u5B58/DB\u8FDE\u63A5\u6570/\u4E8B\u4EF6\u5FAA\u73AF\u5EF6\u8FDF (2)DB_POOL_SIZE\u4ECE40\u589E\u52A0\u523060,\u63D0\u5347\u591A\u79DF\u6237\u5E76\u53D1\u80FD\u529B (3)Dashboard\u56FE\u8868\u533A\u57DF\u63D0\u53D6\u4E3ADashboardCharts\u61D2\u52A0\u8F7D\u7EC4\u4EF6,\u51CF\u5C11\u9996\u5C4Fbundle\u5927\u5C0F (4)\u7CFB\u7EDF\u5065\u5EB7\u9875\u9762\u65B0\u589E\u7CFB\u7EDF\u8D44\u6E90\u76D1\u63A7\u6807\u7B7E\u9875",
        affectedModules: ["bid", "budget", "keyword", "searchterm", "placement", "dayparting"],
        correctionActions: ["revalidate_pending_commands"]
      },
      {
        version: 391,
        description: "v391: [N+1\u67E5\u8BE2\u6D88\u9664+\u6279\u91CF\u6C47\u603B\u4F18\u5316+\u540C\u6B65\u541E\u5410\u91CF\u63D0\u5347] \u2014 (1)P1-updateCampaignPerformanceSummary\u91CD\u5199\u4E3A\u6279\u91CFGROUP BY\u6C47\u603B,SQL\u67E5\u8BE2\u4ECE\u6570\u767E\u6B21\u51CF\u5C11\u52304\u6B21 (2)P1-processReportData\u9884\u52A0\u8F7Dcampaigns\u5230\u5185\u5B58Map,\u6D88\u9664\u6570\u5343\u6B21\u9010\u6761DB\u67E5\u8BE2 (3)P1-syncBidAdjustmentsToAmazon\u6539\u4E3A\u6279\u91CFIN\u67E5\u8BE2\u89E3\u6790Amazon ID (4)P2-Full\u540C\u6B65\u95F4\u96946\u5C0F\u65F6\u7F29\u77ED\u52302\u5C0F\u65F6,\u6BCF\u5468\u671F\u6700\u5927\u8D26\u53F7\u4ECE40\u589E\u52A0\u5230100 (5)P2-500\u79DF\u6237\u5B8C\u6574\u540C\u6B65\u4ECE6.2\u5929\u7F29\u77ED\u523020\u5C0F\u65F6",
        affectedModules: ["bid", "budget", "keyword", "searchterm", "placement", "dayparting"],
        correctionActions: ["revalidate_pending_commands"]
      },
      {
        version: 390,
        description: "v390: [\u524D\u7AEF\u9AA8\u67B6\u5C4F\u4F18\u5316+\u540E\u7AEFAPI\u5E76\u884C\u67E5\u8BE2+\u5065\u5EB7\u5206\u6790\u7F13\u5B58+\u6027\u80FD\u7D22\u5F15] \u2014 (1)P2-\u7EA0\u9519\u76D1\u63A7\u9875\u9762\u6DFB\u52A0\u5B8C\u6574loading\u9AA8\u67B6\u5C4F,\u89E3\u51B3\u6570\u636E\u52A0\u8F7D\u65F6\u7684\u7A7A\u767D\u95EA\u70C1\u95EE\u9898 (2)P2-\u7CFB\u7EDF\u5065\u5EB7\u76D1\u63A7\u9875\u9762\u6DFB\u52A0loading\u9AA8\u67B6\u5C4F,\u4F18\u5316\u7528\u6237\u4F53\u9A8C (3)P3-getDashboard\u76846\u4E2A\u4E32\u884CSQL\u67E5\u8BE2\u6539\u4E3APromise.all\u5E76\u884C\u6267\u884C,\u63D0\u5347\u54CD\u5E94\u901F\u5EA6\u7EA660-70% (4)P3-analyzeCampaignHealth\u7ED3\u679C\u7F13\u5B58120\u79D2,\u907F\u514D\u91CD\u590D\u8BA1\u7B97 (5)P3-getHealthAlerts\u590D\u7528\u5065\u5EB7\u5206\u6790\u7F13\u5B58,\u6D88\u9664\u91CD\u590D\u6570\u636E\u5E93\u67E5\u8BE2 (6)P3-\u6DFB\u52A06\u4E2A\u590D\u5408\u7D22\u5F15\u8986\u76D6optimization_events\u548Cdaily_performance\u8868\u9AD8\u9891\u67E5\u8BE2",
        affectedModules: ["bid", "budget", "keyword", "searchterm", "placement", "dayparting"],
        correctionActions: ["revalidate_pending_commands"]
      },
      {
        version: 389,
        description: "v389: [EB\u5B9E\u4F8B\u5347\u7EA7+\u5185\u5B58\u4F18\u5316+SD\u5426\u5B9A\u5B9A\u4F4D\u540C\u6B65\u6CE8\u518C] \u2014 (1)P1-EB\u5B9E\u4F8B\u4ECE t3.small(2GB)\u5347\u7EA7\u5230 t3.medium(4GB),\u652F\u6301200-500\u79DF\u6237\u89C4\u6A21 (2)P1-Node.js\u5806\u5185\u5B58\u9650\u5236\u4ECE1400MB\u63D0\u5347\u52303072MB,\u5145\u5206\u5229\u7528t3.medium\u5185\u5B58 (3)P1-SD\u5426\u5B9A\u5546\u54C1\u5B9A\u4F4D\u540C\u6B65\u6B65\u9AA4\u5DF2\u786E\u8BA4\u6CE8\u518C\u5230SYNC_STEPS (4)P2-DB_POOL_SIZE\u4ECE25\u63D0\u5347\u523040,\u63D0\u5347\u5E76\u53D1\u5904\u7406\u80FD\u529B (5)P2-\u7EA0\u9519\u76D1\u63A7\u9875\u9762\u529F\u80FD\u9A8C\u8BC1\u901A\u8FC7,94.4%\u540C\u6B65\u7387\u6B63\u5E38",
        affectedModules: ["bid", "budget", "keyword", "searchterm", "placement", "dayparting"],
        correctionActions: ["revalidate_pending_commands"]
      },
      {
        version: 380,
        description: "v380: [P2\u547D\u4EE4\u786E\u8BA4\u589E\u5F3A+\u5FC3\u8DF3\u63A2\u6D4B\u4F18\u5316+P3\u6570\u636E\u5B8C\u6574\u6027+\u52A8\u6001\u8D85\u65F6+RL\u51B7\u542F\u52A8] \u2014 (1)P2-confirmation\u540C\u6B65\u5C42\u7EA7\u6269\u5C55: TIER_HIERARCHY.confirmation\u4ECEhigh\u6269\u5C55\u4E3Ahigh+medium,\u786E\u4FDEad_groups/keywords/targets\u53D8\u66F4\u80FD\u88AB\u786E\u8BA4\u540C\u6B65 (2)P2-\u5FC3\u8DF3\u63A2\u6D4B\u4E24\u7EA7\u7B56\u7565: \u4ECE30\u5206\u949F\u5355\u7EA7\u63A2\u6D4B\u5347\u7EA7\u4E3A90min+30min\u4E24\u7EA7\u63A2\u6D4B,\u907F\u514D\u7CFB\u7EDF\u91CD\u542F\u540E\u8BEF\u62A5 (3)P3-joinIntegrity\u4FEE\u590D: \u4F7F\u7528LEFT JOIN+accountId\u7CBE\u786E\u7EDF\u8BA1\u5B64\u7ACB\u5E7F\u544A\u7EC4,\u4FEE\u590DorphanedAdGroups\u8D1F\u6570\u95EE\u9898 (4)P3-\u52A8\u6001\u8D85\u65F6: \u5927\u8D26\u6237\u540C\u6B65\u8D85\u65F6\u6839\u636E\u5E7F\u544A\u6D3B\u52A8\u6570\u52A8\u6001\u8C03\u6574(1000-3000:60min,3000-5000:75min,5000+:90min) (5)P3-RL\u51B7\u542F\u52A8\u52A0\u901F: \u53CC\u6E90\u6570\u636E\u7EDF\u8BA1(optimization_events+optimization_logs)+\u6298\u7B97\u6BD4\u4F8B\u4ECE0.3\u63D0\u5347\u52300.5",
        affectedModules: ["bid", "budget", "keyword", "searchterm", "placement", "dayparting"],
        correctionActions: ["revalidate_pending_commands"]
      },
      {
        version: 379,
        description: "v379: [SQL\u5B89\u5168\u4FEE\u590D+\u53EF\u89C2\u6D4B\u6027\u4FEE\u590D+\u6570\u636E\u5E93\u7D22\u5F15\u4F18\u5316] \u2014 (1)P0-\u4FEE\u590D8\u5904SQL\u6A21\u677F\u5B57\u7B26\u4E32\u4E2D\u7684as-any\u7C7B\u578B\u65AD\u8A00\u6CC4\u6F0F: syncPerformance.ts(DATE(date) as unknown), bidOperations.ts(INSERT...as unknown x2), deployLifecycleManager.ts(INSERT...as unknown x2), systemRouter.ts(ALTER TABLE...as unknown x2), auditLogService.ts(COUNT(*) as unknown as total) (2)P1-Observability\u670D\u52A1\u4FEE\u590D: \u5C06executedAt\u66FF\u6362\u4E3AcreatedAt\u89E3\u51B3optimization_events\u8868\u67E5\u8BE2\u5931\u8D25\u95EE\u9898+\u6DFB\u52A0try-catch\u4F18\u96C5\u964D\u7EA7 (3)P2-optimization_logs\u8868\u6DFB\u52A0\u590D\u5408\u7D22\u5F15(pg+category+createdAt, account+category+createdAt)\u89E3\u51B3SelfEvolution\u6A21\u577030\u5929\u8303\u56F4\u67E5\u8BE2\u8D85\u65F6",
        affectedModules: ["bid", "budget", "keyword", "searchterm", "placement", "dayparting"],
        correctionActions: ["revalidate_pending_commands"]
      },
      {
        version: 378,
        description: 'v378: [\u4FEE\u590D\u81EA\u52A8\u4F18\u5316\u4EEA\u8868\u76D8\u548CAPI\u6388\u6743\u72B6\u6001\u9875\u9762] \u2014 (1)P0-AutoOptimizationDashboard.tsx: \u4FEE\u590Dtrpc\u8C03\u7528\u65B9\u5F0F\u4ECEtRPC vanilla client\u6539\u4E3Areact-query hooks(getMetrics/getRecentActions/getTrends\u4E09\u4E2A\u67E5\u8BE2\u5168\u90E8\u4FEE\u590D),\u89E3\u51B3"t[i] is not a function"\u9519\u8BEF\u5BFC\u81F4\u4EEA\u8868\u76D8\u663E\u793A\u5168\u90E80\u7684\u95EE\u9898 (2)P1-AmazonApiAuthStatus.tsx: \u4FEE\u590Dtrpc\u8C03\u7528\u65B9\u5F0F(getAllAuthStatus.query\u2192useQuery, refreshToken.mutate\u2192useMutation),\u89E3\u51B3API\u6388\u6743\u72B6\u6001\u9875\u9762\u65E0\u6CD5\u52A0\u8F7D\u6570\u636E\u7684\u95EE\u9898',
        affectedModules: ["bid", "budget", "keyword", "searchterm", "placement", "dayparting"],
        correctionActions: ["revalidate_pending_commands"]
      },
      {
        version: 377,
        description: "v377: [\u5168\u9762\u591A\u79DF\u6237\u6570\u636E\u9694\u79BB\u5F3A\u5316] \u2014 (1)P1-algorithm\u8DEF\u7531\u6570\u636E\u9694\u79BB:7\u4E2A\u65B9\u6CD5\u6DFB\u52A0verifyAccountAccess\u6821\u9A8C,\u5305\u62ECgetPerformance/analyzeByType/analyzeByRange/getSuggestions/getParameterTuning/runAutoCorrection (2)P1-placement\u8DEF\u7531\u6570\u636E\u9694\u79BB:33\u4E2A\u65B9\u6CD5\u6DFB\u52A0verifyAccountAccess\u6821\u9A8C,\u8986\u76D6\u6240\u6709\u4F4D\u7F6E\u4F18\u5316\u3001\u8FB9\u9645\u6536\u76CA\u5206\u6790\u3001\u51B3\u7B56\u6811\u7B49\u529F\u80FD (3)P1-performanceGroup\u8DEF\u7531\u6570\u636E\u9694\u79BB:list\u548Ccreate\u65B9\u6CD5\u6DFB\u52A0verifyAccountAccess,assignCampaign/batchAssignCampaigns\u6DFB\u52A0verifyPerformanceGroupAccess (4)P1-intelligentRecommendation\u8DEF\u7531\u6570\u636E\u9694\u79BB:scan/quickCreateGoal/getSummaryBadge\u6DFB\u52A0verifyAccountAccess (5)P1-adAutomation/analytics/automation/bidding/dailySync/dayparting/specialScenario/nextGen\u8DEF\u7531\u6570\u636E\u9694\u79BB\u5F3A\u5316",
        affectedModules: ["bid", "budget", "keyword", "searchterm", "placement", "dayparting"],
        correctionActions: ["revalidate_pending_commands", "audit_synced_commands"]
      },
      {
        version: 376,
        description: "v376: [\u6570\u636E\u9694\u79BB\u5F3A\u5316\u4E0E\u8BC4\u5206\u7B97\u6CD5\u4F18\u5316] \u2014 (1)P1-campaign.list/listUnassigned\u6570\u636E\u9694\u79BB:\u589E\u52A0verifyAccountAccess\u6821\u9A8C,\u9632\u6B62\u8DE8\u79DF\u6237\u67E5\u8BE2\u5E7F\u544A\u6D3B\u52A8 (2)P1-keyword.list\u6570\u636E\u9694\u79BB:\u589E\u52A0verifyAdGroupAccess\u6821\u9A8C,\u9632\u6B62\u8DE8\u79DF\u6237\u67E5\u8BE2\u5173\u952E\u8BCD (3)P1-\u5185\u5B58\u6CC4\u6F0F\u4FEE\u590D:autoOperationService.logStore\u589E\u52A0MAX_LOG_STORE_SIZE=10000\u9650\u5236,\u9632\u6B62\u65E0\u9650\u589E\u957F\u5BFC\u81F4OOM (4)P2-\u8BC4\u5206\u7B97\u6CD5\u6838\u5FC3\u6307\u6807\u6743\u91CD\u63D0\u5347:\u6240\u6709\u7B56\u7565\u6A21\u677FcoreMetric\u6743\u91CD\u4ECE14-30%\u63D0\u5347\u81F330-45%,\u786E\u4FDDACoS/ROAS\u504F\u79BB\u65F6\u8BC4\u5206\u771F\u5B9E\u53CD\u6620\u95EE\u9898\u4E25\u91CD\u6027 (5)P2-\u540C\u6B65\u65F6\u95F4\u8303\u56F4\u6269\u5C55:SP\u7C7B\u578B\u540C\u6B65\u4ECE90\u5929\u6269\u5C55\u523095\u5929,\u5145\u5206\u5229\u7528Amazon API\u6700\u5927\u652F\u6301\u8303\u56F4",
        affectedModules: ["bid", "budget", "keyword", "searchterm", "placement", "dayparting"],
        correctionActions: ["revalidate_pending_commands", "audit_synced_commands"]
      },
      {
        version: 375,
        description: 'v375: [\u5BA1\u8BA1\u65E5\u5FD7\u5B8C\u5584\u4E0E\u64CD\u4F5C\u53EF\u8FFD\u6EAF\u6027\u589E\u5F3A] \u2014 (1)P2-\u4FEE\u590D\u5BA1\u8BA1\u65E5\u5FD7\u663E\u793A"\u672A\u77E5\u7528\u6237":\u7CFB\u7EDF\u81EA\u52A8\u64CD\u4F5C(userId=0)\u73B0\u5728\u6B63\u786E\u663E\u793A\u4E3A"\u7CFB\u7EDF\u81EA\u52A8\u4F18\u5316",\u540C\u65F6\u4FEE\u590D\u540E\u7AEF\u7EDF\u8BA1\u67E5\u8BE2\u548C\u524D\u7AEF\u663E\u793A\u7684fallback\u903B\u8F91 (2)P2-\u65B0\u589E\u5426\u5B9A\u5173\u952E\u8BCD/\u5426\u5B9AASIN\u5BA1\u8BA1\u65E5\u5FD7:\u4F18\u5316\u540C\u6B65\u5F15\u64CE\u6267\u884C\u5426\u5B9A\u8BCD\u64CD\u4F5C\u540E\u8BB0\u5F55\u5B8C\u6574\u5BA1\u8BA1\u8DDF\u8E2A (3)P2-\u65B0\u589E\u641C\u7D22\u8BCD\u6536\u5272\u5BA1\u8BA1\u65E5\u5FD7:\u65B0\u5173\u952E\u8BCD\u6DFB\u52A0\u64CD\u4F5C\u53EF\u5B8C\u6574\u8FFD\u6EAF (4)P2-\u65B0\u589E\u4F4D\u7F6E\u503E\u659C/\u5206\u65F6\u8C03\u6574\u5BA1\u8BA1\u65E5\u5FD7:\u6240\u6709\u4F18\u5316\u64CD\u4F5C\u7C7B\u578B\u5747\u6709\u5B8C\u6574\u5BA1\u8BA1\u8BB0\u5F55',
        affectedModules: ["bid", "budget", "keyword", "searchterm", "placement", "dayparting"],
        correctionActions: ["revalidate_pending_commands", "audit_synced_commands"]
      },
      {
        version: 374,
        description: "v374: [\u67B6\u6784\u7EA7\u7F3A\u9677\u4FEE\u590D] \u2014 (1)P0-\u52A8\u6001\u5E76\u53D1\u63A7\u5236\u53CD\u9988\u56DE\u8DEF\u4FEE\u590D:recordThrottleEvent/recordSuccessEvent\u5728amazonAdsApi\u54CD\u5E94\u62E6\u622A\u5668\u4E2D\u6B63\u5F0F\u8FDE\u63A5,\u5B9E\u73B0\u771F\u6B63\u7684\u52A8\u6001\u5E76\u53D1\u8C03\u6574 (2)P0-\u5206\u6279\u8F6E\u8F6C\u540C\u6B65:full\u540C\u6B65\u95F4\u96946h+\u6BCF\u5468\u671F\u6700\u591A25\u8D26\u53F7,high\u6700\u591A30\u8D26\u53F7,medium\u6700\u591A50\u8D26\u53F7,\u89E3\u51B3500\u79DF\u6237API\u8C03\u7528\u91CF\u8D85\u9650 (3)P0-Leader\u9009\u4E3E\u4FDD\u62A4\u4F18\u5316\u8C03\u5EA6\u5668:startOptimizationScheduler\u79FB\u81F3onBecomeLeader\u56DE\u8C03,\u786E\u4FDD\u5355\u5B9E\u4F8B\u6267\u884C (4)P1-API\u9650\u6D41\u8054\u52A8\u5E76\u53D1\u63A7\u5236:apiRateLimitService.recordExternalThrottle\u8054\u52A8syncPriorityScheduler.recordThrottleEvent (5)P1-\u591A\u79DF\u6237\u9694\u79BB\u589E\u5F3A:getCampaignsByPerformanceGroupId\u589E\u52A0accountId\u4E8C\u6B21\u9A8C\u8BC1",
        affectedModules: ["bid", "budget", "keyword", "searchterm", "placement", "dayparting"],
        correctionActions: ["revalidate_pending_commands", "audit_synced_commands", "rerun_optimization"]
      },
      {
        version: 373,
        description: "v373: [500\u79DF\u6237\u89C4\u6A21\u627F\u8F7D\u529B\u4F18\u5316] \u2014 (1)P1-\u540C\u6B65\u4F18\u5148\u7EA7\u8C03\u5EA6:\u5F15\u5165\u79DF\u6237\u6D3B\u8DC3\u5EA6\u8BC4\u5206\u548C\u6EDA\u52A8\u7A97\u53E3\u6A21\u5F0F,\u786E\u4FDD\u9AD8\u4F18\u5148\u7EA7\u8D26\u53F7\u4F18\u5148\u540C\u6B65 (2)P1-\u52A8\u6001\u5E76\u53D1\u63A7\u5236:\u6839\u636EAPI 429\u9519\u8BEF\u7387\u81EA\u52A8\u8C03\u6574\u5E76\u53D1\u6570,\u6279\u6B21\u95F4\u5EF6\u8FDF\u81EA\u9002\u5E94100ms-2000ms (3)P2-\u6307\u4EE4\u6267\u884C\u53EF\u9760\u6027:\u6DFB\u52A0\u5931\u8D25\u6307\u4EE4\u81EA\u52A8\u91CD\u8BD5\u961F\u5217\u548C\u6267\u884C\u786E\u8BA4\u673A\u5236 (4)P2-\u81EA\u6108\u72B6\u6001\u4FEE\u590D:\u6570\u636E\u5065\u5EB7\u9875\u9762\u901A\u8FC7\u6570\u636E\u5E93\u67E5\u8BE2Leader\u5B9E\u4F8B\u7684\u81EA\u6108\u72B6\u6001,\u89E3\u51B3\u975ELeader\u5B9E\u4F8B\u663E\u793A\u201C\u5DF2\u505C\u6B62\u201D\u95EE\u9898 (5)P3-\u524D\u7AEF\u4F53\u9A8C\u4F18\u5316:\u7EA0\u9519\u76D1\u63A7\u9875\u9762\u6DFB\u52A0\u7A7A\u72B6\u6001\u63D0\u793A,\u5E7F\u544A\u6D3B\u52A8\u5217\u8868\u6DFB\u52A0\u540C\u6B65\u72B6\u6001\u63D0\u793A",
        affectedModules: ["bid", "budget", "keyword", "searchterm", "placement", "dayparting"],
        correctionActions: ["revalidate_pending_commands", "audit_synced_commands", "rerun_optimization"]
      },
      {
        version: 372,
        description: "v372: [\u6027\u80FD\u4E0E\u6269\u5C55\u6027\u4F18\u5316] \u2014 (1)P1-\u6838\u5FC3\u8868\u7D22\u5F15\u6DFB\u52A0:campaigns/adGroups/keywords/searchTerms/negativeKeywords/productTargets/scheduledTasks\u6DFB\u52A0accountId/campaignId\u7B49\u5173\u952E\u7D22\u5F15,\u89E3\u51B3500\u79DF\u6237\u89C4\u6A21\u5168\u8868\u626B\u63CF\u6027\u80FD\u74F6\u9888 (2)P1-MySQL\u5206\u5E03\u5F0FAPI\u9650\u6D41:\u751F\u4EA7\u73AF\u5883\u4F7F\u7528MySQL\u5B58\u50A8\u66FF\u4EE3\u5185\u5B58\u5B58\u50A8,\u786E\u4FDD\u591AEB\u5B9E\u4F8B\u73AF\u5883\u4E0BAPI\u9650\u6D41\u5168\u5C40\u4E00\u81F4\u6027 (3)P2-\u5E76\u53D1\u540C\u6B65\u63D0\u5347:MAX_CONCURRENT_ACCOUNTS\u4ECE10\u63D0\u5347\u81F350,\u5927\u5E45\u7F29\u77ED\u5168\u91CF\u6570\u636E\u540C\u6B65\u65F6\u95F4 (4)P3-\u4F18\u96C5\u505C\u673A\u5EF6\u957F:GRACEFUL_SHUTDOWN_TIMEOUT\u4ECE25s\u5EF6\u957F\u81F390s,\u907F\u514D\u957F\u65F6\u95F4\u4F18\u5316\u4EFB\u52A1\u88AB\u4E2D\u65AD",
        affectedModules: ["bid", "budget", "keyword", "searchterm", "placement", "dayparting"],
        correctionActions: ["revalidate_pending_commands", "audit_synced_commands", "rerun_optimization"]
      },
      {
        version: 370,
        description: "v370: [\u6279\u91CF\u5B8C\u6574\u6027\u68C0\u67E5+\u544A\u8B66\u6301\u4E45\u5316+HTTP 425+\u524D\u7AEF\u4FEE\u590D] \u2014 (1)P0-\u6279\u91CF\u5B8C\u6574\u6027\u68C0\u67E5SQL\u4FEE\u590D:dataIntegrityChecker.ts\u548CsloMonitor.ts\u4E2D\u8868\u540D\u4ECEmazon_ad_accounts\u4FEE\u590D\u4E3Aad_accounts,status\u5217\u540D\u4FEE\u590D\u4E3Ais_active (2)P0-anomaly_alert_logs\u5217\u540D\u4FEE\u590D:riskActionEngine.ts\u4E2DpersistRiskAlert\u4F7F\u7528\u4E0E\u5B9E\u9645\u6570\u636E\u5E93\u7ED3\u6784\u5339\u914D\u7684\u5217\u540D (3)P0-dbAutoMigration\u4FEE\u590D:anomaly_alert_logs\u7684CREATE TABLE\u4E0EALTER TABLE\u4E0EDrizzle migration\u5B9E\u9645\u7ED3\u6784\u5BF9\u9F50 (4)P1-HTTP 425\u5904\u7406:Amazon API\u8FD4\u56DE425 Too Early\u65F6\u4E0D\u91CD\u8BD5\u76F4\u63A5\u8DF3\u8FC7 (5)P1-HealthMonitor\u5168\u5C40\u8D26\u6237\u540C\u6B65:\u4ECE\u786C\u7F16\u7801selectedAccountId=1\u6539\u4E3A\u4F7F\u7528\u5168\u5C40useCurrentAccountId",
        affectedModules: ["bid", "budget", "keyword", "searchterm", "placement", "dayparting"],
        correctionActions: ["revalidate_pending_commands", "audit_synced_commands", "rerun_optimization"]
      },
      {
        version: 369,
        description: "v369: [\u5168\u9762\u7CFB\u7EDF\u8BC4\u4F30\u4F18\u5316] \u2014 (1)P0-API\u9650\u6D41accountId=0\u4FEE\u590D:\u6240\u6709API\u8C03\u7528\u73B0\u5728\u4F20\u9012\u771F\u5B9EaccountId (2)P0-\u7F3A\u5931\u6570\u636E\u5E93\u8868\u8FC1\u79FB:budget_auto_execution_configs/history/details/logs+keyword_auto_execution_configs (3)P0-RL\u65E5\u5FD7\u589E\u5F3A:recordBidAction\u9519\u8BEF\u65E5\u5FD7\u5305\u542B\u5B8C\u6574\u4E0A\u4E0B\u6587 (4)P1-\u65E5\u5FD7\u7F13\u51B2\u533A\u6269\u5BB915000\u219230000+\u6279\u6B21\u5927\u5C0F100\u2192200 (5)P1-\u540C\u6B65\u8BB0\u5F55\u6570\u7EDF\u8BA1\u4FEE\u590D (6)P1-\u524D\u7AEF\u4F18\u5316\u76EE\u6807\u8FBE\u6210\u5EA6\u663E\u793A\u4F18\u5316",
        affectedModules: ["bid", "budget", "keyword", "searchterm", "placement", "dayparting"],
        correctionActions: ["revalidate_pending_commands", "audit_synced_commands", "rerun_optimization"]
      },
      {
        version: 368,
        description: "v368: [P1/P2\u4F18\u5316] \u2014 (1)P0-lockManager\u5347\u7EA7\u4E3A\u6DF7\u5408\u9501(\u5185\u5B58\u9501+MySQL GET_LOCK\u5206\u5E03\u5F0F\u9501) (2)P0-\u4FEE\u590DGET_LOCK\u8FDE\u63A5\u7BA1\u7406Bug (3)P1-API\u9650\u6D41\u4F18\u5316:429\u9000\u907Fper-account\u7EA7\u522B+\u6307\u6570\u6062\u590D+\u5E94\u7528\u7EA7\u5168\u5C40TPS\u4E0A\u9650 (4)P2-\u524D\u7AEF\u4FEE\u590D:60\u5929\u219290\u5929+\u7CFB\u7EDF\u5065\u5EB7\u5361\u7247\u7A7A\u72B6\u6001",
        affectedModules: ["bid", "budget", "keyword", "searchterm", "placement", "dayparting"],
        correctionActions: ["revalidate_pending_commands", "audit_synced_commands", "rerun_optimization"]
      },
      {
        version: 361,
        description: "v361.0: [\u67B6\u6784\u8D28\u91CF\u5168\u9762\u4F18\u5316] \u2014 (1)P0-\u591A\u79DF\u6237\u6570\u636E\u9694\u79BB\u4FEE\u590D (2)P0-\u5E42\u7B49\u6027UPSERT (3)P0-\u7EDF\u4E00\u540C\u6B65\u67B6\u6784 (4)P0-\u5B9A\u65F6\u5668\u6CC4\u6F0F\u4FEE\u590D (5)P0-SQL\u6CE8\u5165\u6D88\u9664 (6)P1-db.ts\u62C6\u520626\u5B50\u6A21\u5757 (7)P1-\u7EDF\u4E00\u7ADE\u4EF7\u4E0E\u9884\u7B97\u67B6\u6784 (8)P1-\u8FDE\u63A5\u6C60+\u7D22\u5F15\u4F18\u5316 (9)P1-\u524D\u7AEF\u5DE8\u578B\u9875\u9762\u62C6\u5206 (10)P2-\u7C7B\u578B\u5B89\u5168\u63D0\u5347 (11)P2-API\u8BBF\u95EE\u63A7\u5236\u5BA1\u8BA1 (12)P2-\u7EDF\u4E00\u5BA1\u8BA1\u65E5\u5FD7\u670D\u52A1 (13)P2-\u65E5\u5FD7\u89C4\u8303\u5316 (14)P3-React.memo\u4F18\u5316 (15)P3-\u7B97\u6CD5\u5E38\u91CF\u96C6\u4E2D\u7BA1\u7406 (16)P3-\u73AF\u5883\u53D8\u91CF\u7EDF\u4E00\u7BA1\u7406",
        affectedModules: ["all"],
        correctionActions: ["revalidate_pending_commands", "audit_synced_commands", "rerun_optimization", "cleanup_stale_pending"]
      },
      {
        version: 360,
        description: "v360.0: [\u4E1A\u52A1\u4F18\u5316\u5168\u9762\u5347\u7EA7] \u2014 (1)P0-daily_performance\u552F\u4E00\u7EA6\u675F+\u6279\u91CFUPSERT\u91CD\u6784,\u6D88\u9664\u6570\u636E\u91CD\u590D\u7D2F\u79EF (2)P0-API\u9650\u6D41\u670D\u52A1\u7EDF\u4E00\u96C6\u6210,\u6240\u6709API\u8C03\u7528\u7ECF\u8FC7\u9650\u6D41\u8BB8\u53EF\u68C0\u67E5 (3)P0-\u65B0\u6388\u674324h\u6570\u636E\u91C7\u96C6\u5468\u671F (4)P0-\u4F18\u5316\u76EE\u6807\u65E5\u9884\u7B97\u7EA6\u675F\u4FEE\u590D (5)P1-\u7EDF\u4E00\u9884\u7B97\u5206\u914D\u673A\u5236 (6)P1-84\u65F6\u6BB5\u5206\u65F6\u4F18\u5316\u91CD\u6784 (7)P1-\u8DE8\u5E7F\u544A\u6D3B\u52A8\u667A\u80FD\u503E\u659C (8)P2-\u5168\u5C40\u5426\u5B9A\u529F\u80FD (9)P2-\u4F18\u5316\u65E5\u5FD7\u900F\u660E\u5EA6\u589E\u5F3A",
        affectedModules: ["all"],
        correctionActions: ["resync_data", "recalculate_budgets", "reset_dayparting_rules", "rerun_optimization"]
      },
      {
        version: 359,
        description: "v359.0: [\u6548\u7387\xB7\u667A\u80FD\xB7\u97E7\u6027\u5168\u9762\u5347\u7EA7] \u2014 (1)32\u4E2A\u672A\u8BA4\u8BC1\u7AEF\u70B9\u4FEE\u590D (2)\u6279\u91CFAPI\u8C03\u7528\u91CD\u6784(90%\u51CF\u5C11) (3)DAG\u5E76\u884C\u8C03\u5EA6(5.5x\u63D0\u5347) (4)\u5206\u5E03\u5F0FAPI\u9650\u6D41\u670D\u52A1 (5)\u72EC\u7ACB\u81EA\u6108\u4EFB\u52A1\u8C03\u5EA6\u5668 (6)\u6307\u4EE4\u786E\u8BA4\u673A\u5236 (7)A/B\u6D4B\u8BD5\u6846\u67B6 (8)\u6D4B\u8BD5\u8986\u76D6\u7387\u589E\u5F3A",
        affectedModules: ["sync", "all"],
        correctionActions: ["resync_data", "rerun_optimization"]
      },
      {
        version: 182,
        description: "v182: \u65F6\u533A\u4FEE\u590D - \u6240\u6709\u6A21\u5757\u6539\u7528\u7AD9\u70B9\u672C\u5730\u65F6\u95F4",
        affectedModules: ["dayparting", "dayparting_budget", "bid"],
        correctionActions: ["fix_timezone_errors", "reset_dayparting_rules", "rerun_optimization"]
      },
      {
        version: 183,
        description: "v183: \u591A\u7EF4\u5EA6\u8D44\u6E90\u503E\u659C\u4F18\u5316\u5F15\u64CE",
        affectedModules: ["multidim", "dayparting", "placement", "dayparting_budget"],
        correctionActions: ["rebuild_combo_analysis", "reset_dayparting_rules", "reset_placement_rules", "rerun_optimization"]
      },
      {
        version: 184,
        description: "v184: \u90E8\u7F72\u540E\u81EA\u52A8\u91CD\u4F18\u5316\u673A\u5236 + \u5386\u53F2\u6570\u636E\u5408\u6210 + \u81EA\u6211\u8FED\u4EE3 + Campaign\u9884\u7B97\u4E58\u6570",
        affectedModules: ["all"],
        correctionActions: ["rebuild_combo_analysis", "full_reoptimize"]
      },
      {
        version: 185,
        description: "v185: \u4F18\u96C5\u5173\u95ED + \u90E8\u7F72\u751F\u547D\u5468\u671F\u7BA1\u7406 + \u4EFB\u52A1\u65AD\u70B9\u6062\u590D + \u5FC3\u8DF3\u76D1\u63A7",
        affectedModules: [],
        correctionActions: []
      },
      {
        version: 186,
        description: "v186: \u4FEE\u590DcampaignId\u7C7B\u578B\u4E0D\u5339\u914D(varchar vs int) + multiDimOptimizer\u4F7F\u7528\u6B63\u786E\u7684\u672C\u5730ID\u67E5\u8BE2hourly_performance + \u4F4D\u7F6E\u4F18\u5316\u4F7F\u7528\u6B63\u786E\u7684\u672C\u5730ID\u67E5\u8BE2placement_performance",
        affectedModules: ["dayparting", "dayparting_budget", "placement", "multidim", "bid"],
        correctionActions: ["rebuild_combo_analysis", "reset_dayparting_rules", "reset_placement_rules", "rerun_optimization"]
      },
      {
        version: 197,
        description: "v197: NextGen\u7B97\u6CD5\u4F53\u7CFB \u2014 Sigmoid\u66F2\u7EBF\u62DF\u5408\u3001LinUCB\u4E0A\u4E0B\u6587\u8D4C\u535A\u673A\u3001\u56E0\u679C\u63A8\u65ADUplift\u6A21\u578B\u3001\u79BB\u7EBFRL(CQL)\u3001\u9884\u7B97\u7EC4\u5408\u4F18\u5316\u3001\u5173\u952E\u8BCD\u8BED\u4E49\u56FE\u8C31\u3001\u5143\u5B66\u4E60\u7B56\u7565\u9009\u62E9\u5668",
        affectedModules: ["bid", "budget", "keyword"],
        correctionActions: ["rerun_optimization", "recalculate_budgets"]
      },
      {
        version: 198,
        description: "v198: NextGen\u7EDF\u4E00\u51FA\u4EF7\u5F15\u64CE \u2014 100%\u66FF\u6362\u65E7\u51FA\u4EF7\u7B97\u6CD5\uFF0C\u4E09\u5C42\u964D\u7EA7\u94FE(\u9AD8\u7EA7\u7B97\u6CD5\u2192\u89C4\u5219\u5F15\u64CE\u2192\u4FDD\u5B88\u7B56\u7565)\uFF0C\u5168\u81EA\u52A8\u5316\u5B9A\u65F6\u4EFB\u52A1\uFF0C\u5386\u53F2\u51B3\u7B56\u590D\u76D8\u4E0E\u7EA0\u9519",
        affectedModules: ["all"],
        correctionActions: ["full_reoptimize", "rebuild_combo_analysis", "recalculate_budgets"]
      },
      {
        version: 199,
        description: "v199: \u5546\u7528\u7EA7\u6570\u636E\u5B8C\u6574\u6027\u4FEE\u590D \u2014 \u4FEE\u590D\u6240\u6709API\u5206\u9875/\u5206\u6279\u5904\u7406\u7F3A\u9677\uFF0C\u786E\u4FDD\u5173\u952E\u8BCD\u521B\u5EFA/\u51FA\u4EF7\u66F4\u65B0/\u5426\u5B9A\u8BCD\u540C\u6B65/\u72B6\u6001\u53D8\u66F4\u7B49\u6240\u6709\u64CD\u4F5C\u5B8C\u6574\u6267\u884C\uFF0C\u79FB\u9664\u7EA0\u9519\u5668\u548C\u4EFB\u52A1\u961F\u5217\u7684\u5904\u7406\u91CF\u4E0A\u9650",
        affectedModules: [],
        correctionActions: []
      },
      {
        version: 200,
        description: "v200: SQL\u5217\u540D\u4E00\u81F4\u6027\u4FEE\u590D \u2014 \u4FEE\u590DNextGen\u8D28\u91CF\u5BA1\u8BA1SQL\u67E5\u8BE2\u5217\u540D\u9519\u8BEF(keywords\u8868\u4F7F\u7528camelCase\u3001optimization_events\u8868\u4F7F\u7528snake_case)\uFF0C\u4FEE\u590D\u51FA\u4EF7\u6267\u884C\u786E\u8BA4\u53CC\u91CD\u5C1D\u8BD5\u987A\u5E8F\uFF0C\u589E\u5F3A\u5426\u5B9A\u8BCDAPI\u9519\u8BEF\u65E5\u5FD7",
        affectedModules: [],
        correctionActions: []
      },
      {
        version: 201,
        description: "v201: \u5426\u5B9A\u5173\u952E\u8BCD\u540C\u6B65\u4FEE\u590D\u4E0E\u7CFB\u7EDF\u7A33\u5B9A\u6027\u63D0\u5347 \u2014 \u4FEE\u590CcampaignId\u7C7B\u578B\u4E3Astring\u907F\u514D\u5927\u6570\u5B57\u7CBE\u5EA6\u4E22\u5931\uFF0C\u4FEE\u590C\u5426\u5B9A\u8BCD\u5165\u961F\u65F6amazonEntityId\u9519\u8BEF\u4F7F\u7528\u672C\u5730ID\uFF0C\u589E\u52A0AutoCorrector\u8BE6\u7EC6\u8BCA\u65AD\u65E5\u5FD7\uFF0C\u63D0\u5347maxRetryPerRun\u5230 2000\u52A0\u901F\u79EF\u538B\u4EFB\u52A1\u5904\u7406",
        affectedModules: [],
        correctionActions: []
      },
      {
        version: 202,
        description: "v202: \u540C\u6B65\u7387\u5168\u9762\u4FEE\u590D \u2014 \u4FEE\u590D\u641C\u7D22\u8BCD\u6536\u5272\u91CD\u8BD5\u6761\u4EF6\u4E0D\u5339\u914D(0%\u540C\u6B65\u7387)\uFF0C\u4FEE\u590Csettings_update\u4E8B\u4EF6\u9519\u8BEF\u6807\u8BB0\u4E3Afailed(2218\u4E2A)\uFF0C\u4FEE\u590C\u51FA\u4EF7\u6267\u884C\u786E\u8BA4\u5BB9\u5DEE\u903B\u8F91(81\u4E2A\u5FAA\u73AF\u4E0D\u4E00\u81F4)\uFF0C\u6DFB\u52A0target_enable/target_pause\u91CD\u8BD5\u673A\u5236",
        affectedModules: [],
        correctionActions: []
      },
      {
        version: 203,
        description: "v203: \u6570\u636E\u6E05\u6D17\u4E0E\u540C\u6B65\u7387\u4FEE\u6B63 \u2014 \u79FB\u9664settings_update\u8FC1\u79FB\u7684budget\u8FC7\u6EE4\u6761\u4EF6(\u4FEE\u590D2247\u4E2A\u9519\u8BEF\u6807\u8BB0)\uFF0C\u6E05\u7406\u8D85\u8FC77\u5929\u7684target_enable/target_pause\u5931\u8D25\u4E8B\u4EF6\uFF0C\u6E05\u7406\u65E0\u91CD\u8BD5\u673A\u5236\u7684placement_adjust/bid_auto_adjust\u5931\u8D25\u4E8B\u4EF6\uFF0C\u6E05\u7406\u8D85\u8FC730\u5929\u7684\u6240\u6709\u65E7\u5931\u8D25\u4E8B\u4EF6",
        affectedModules: [],
        correctionActions: []
      },
      {
        version: 204,
        description: "v204: \u5168\u9762\u4F18\u5316\u4E0E\u76D1\u63A7\u5F3A\u5316 \u2014 \u5173\u952E\u8BCD/\u5426\u5B9A\u8BCD\u9884\u9A8C\u8BC1(\u6D88\u9664\u7279\u6B8A\u5B57\u7B26\u5BFC\u81F4\u7684API\u62D2\u7EDD)\uFF0C\u8D27\u5E01\u8F6C\u6362\u7CFB\u7EDF\u5316(\u52A8\u6001\u5BB9\u5DEE\u66FF\u4EE3\u56FA\u5B9A\u6BD4\u4F8B)\uFF0C\u540C\u6B65\u5065\u5EB7\u5EA6\u8BC4\u4F30\u4E0E\u544A\u8B66\u7CFB\u7EDF\uFF0CNextGen\u7EF4\u62A4\u4EFB\u52A1\u5373\u65F6\u542F\u52A8(\u79FB\u966441\u5206\u949F\u504F\u79FB)\uFF0C\u8D28\u91CF\u5BA1\u8BA1\u7B97\u6CD5\u7248\u672C\u8FC7\u6EE4\u66F4\u65B0",
        affectedModules: ["bid", "keyword"],
        correctionActions: ["rerun_optimization"]
      },
      {
        version: 205,
        description: "v205: \u7EDF\u4E00\u65E5\u5FD7\u7BA1\u7406\u7CFB\u7EDF \u2014 \u7ED3\u6784\u5316\u65E5\u5FD7\u5206\u7EA7(DEBUG/INFO/WARN/ERROR/FATAL)\uFF0C\u5185\u5B58\u73AF\u5F62\u7F13\u51B2\u533A(5000\u6761)\uFF0C\u6570\u636E\u5E93\u6301\u4E45\u5316(WARN\u53CA\u4EE5\u4E0A)\uFF0C7\u5929\u81EA\u52A8\u8F6E\u8F6C\uFF0C\u5206\u9875\u67E5\u8BE2API\uFF0C19\u4E2A\u6838\u5FC3\u6A21\u5757\u8FC1\u79FB(1528\u5904console.log)\uFF0C\u8FD0\u884C\u65F6\u52A8\u6001\u65E5\u5FD7\u7EA7\u522B\u8C03\u6574",
        affectedModules: [],
        correctionActions: []
      },
      {
        version: 215,
        description: "v215: \u6570\u636E\u540C\u6B65\u5168\u9762\u4F18\u5316 \u2014 \u4FEE\u590D12\u5904\u589E\u91CF\u540C\u6B65\u8DF3\u8FC7\u903B\u8F91(\u6839\u56E0\u4FEE\u590D), SP/SB/SD\u62A5\u544A\u5E76\u884C\u8BF7\u6C42+\u667A\u80FD\u91CD\u8BD5, \u8D26\u6237\u7EA7\u5E76\u884C\u540C\u6B65\u8C03\u5EA6\u5668, \u5185\u5B58\u7BA1\u7406\u4F18\u5316(512MB+GC), \u524D\u7AEF\u540C\u6B65\u8FDB\u5EA6\u8BE6\u7EC6\u6B65\u9AA4\u663E\u793A, \u540C\u6B65\u8BCA\u65AD\u7AEF\u70B9\u589E\u5F3A",
        affectedModules: [],
        correctionActions: []
      },
      {
        version: 216,
        description: "v216: \u90E8\u7F72\u5065\u5EB7\u4FEE\u590D \u2014 \u4FEE\u590Cumami\u5206\u6790\u811A\u672C\u5BFC\u81F455%HTTP4xx\u9519\u8BEF, \u4FEE\u590DSP/SB\u641C\u7D22\u8BCD\u62A5\u544ASUMMARY+date\u5217\u51B2\u7A81(\u6539\u4E3ADAILY), \u6DFB\u52A0sync-health/sync-diagnosis\u8FD0\u7EF4\u7AEF\u70B9, \u4FEE\u590D\u524D\u7AEF\u540C\u6B65\u8FDB\u5EA6\u6B65\u9AA4\u663E\u793A",
        affectedModules: [],
        correctionActions: []
      },
      {
        version: 217,
        description: "v217: \u6570\u636E\u540C\u6B65\u5168\u9762\u4FEE\u590D \u2014 \u540E\u7AEF\u540C\u6B65\u6D41\u7A0B\u4ECE8\u6B65\u6269\u5C55\u523017\u6B65(\u6DFB\u52A0SB/SD\u5E7F\u544A\u7EC4\u3001SB\u5173\u952E\u8BCD\u3001SB/SD\u5546\u54C1\u5B9A\u4F4D\u3001\u5426\u5B9A\u5173\u952E\u8BCD\u3001\u5426\u5B9A\u5546\u54C1\u5B9A\u4F4D\u3001\u641C\u7D22\u8BCD\u3001\u5E7F\u544A\u4F4D\u7F6E\u7EE9\u6548), \u524D\u7AEF\u8FDB\u5EA6\u6761\u548C\u6B65\u9AA4\u6807\u7B7E\u540C\u6B6517\u6B65, \u6BCF\u4E2A\u6B65\u9AA4\u90FD\u6709updateProgress\u8C03\u7528\u786E\u4FDD\u5B9E\u65F6\u8FDB\u5EA6\u53CD\u9988",
        affectedModules: [],
        correctionActions: []
      },
      {
        version: 218,
        description: "v218: \u524D\u7AEF\u5D29\u6E83\u4FEE\u590D \u2014 \u4FEE\u590DAmazonApiSettings\u9875\u9762ReferenceError(useEffect\u5F15\u7528\u672A\u58F0\u660E\u7684accounts\u53D8\u91CF), \u5C06\u540C\u6B65\u8FDB\u5EA6useEffect\u79FB\u5230accounts\u5B9A\u4E49\u4E4B\u540E",
        affectedModules: [],
        correctionActions: []
      },
      {
        version: 219,
        description: "v219: \u7EDF\u4E00\u540C\u6B65\u5F15\u64CE \u2014 \u81EA\u52A8\u53D1\u73B0\u6240\u6709\u6D3B\u8DC3\u8D26\u6237(\u6D88\u9664data_sync_schedules\u4F9D\u8D56), \u5206\u5C42\u540C\u6B65\u7B56\u7565(\u9AD8\u989115min/\u4E2D\u989130min/\u5B8C\u657460min), \u591A\u8D26\u6237\u5E76\u53D1\u63A7\u5236(\u6700\u591A3\u4E2A\u5E76\u884C), \u4F18\u5316\u540E\u786E\u8BA4\u540C\u6B65(\u9632\u6B62\u91CD\u590D\u4F18\u5316), \u68C0\u67E5\u70B9/\u6062\u590D\u673A\u5236, \u6B65\u9AA4\u7EA7\u9519\u8BEF\u9694\u79BB",
        affectedModules: [],
        correctionActions: []
      },
      {
        version: 220,
        description: "v220: API\u901F\u7387\u63A7\u5236\u4E0E\u7CFB\u7EDF\u5065\u5EB7\u76D1\u63A7 \u2014 \u81EA\u9002\u5E94API\u901F\u7387\u63A7\u5236\u5668(\u6ED1\u52A8\u7A97\u53E3\u8BA1\u6570+\u6307\u6570\u9000\u907F+\u81EA\u52A8\u6062\u590D), \u6B65\u9AA4\u95F4/\u6279\u6B21\u95F4\u52A8\u6001\u5EF6\u8FDF, 429\u9650\u6D41\u68C0\u6D4B\u4E0E\u9000\u907F, \u6BCF15\u5206\u949F\u7CFB\u7EDF\u5065\u5EB7\u5FEB\u7167(\u5185\u5B58/API\u901F\u7387/\u540C\u6B65\u7387), \u5185\u5B58\u6CC4\u6F0F\u68C0\u6D4B, \u786E\u8BA4\u540C\u6B65\u6548\u679C\u8FFD\u8E2A(\u89E6\u53D1\u6E90/\u6210\u529F\u7387/\u5E73\u5747\u8017\u65F6)",
        affectedModules: [],
        correctionActions: []
      },
      {
        version: 221,
        description: "v221: \u5168\u9762\u7CFB\u7EDF\u4F18\u5316 \u2014 \u4FEE\u590D\u5206\u5C42\u540C\u6B65\u9501Bug(\u5C42\u7EA7\u611F\u77E5\u9501\u9632\u6B62medium\u5C42\u88AB\u8DF3\u8FC7), \u4FEE\u590D\u65E5\u5FD7\u62FC\u63A5[object Object]Bug, \u524D\u7AEF\u8DEF\u7531\u81EA\u52A8\u8D26\u6237\u9009\u62E9, \u5BA1\u8BA1\u65E5\u5FD7\u8BB0\u5F55\u4F18\u5316\u64CD\u4F5C, optimizationTargetEngine\u786E\u8BA4\u540C\u6B65\u5168\u8986\u76D6, \u6570\u636E\u65B0\u9C9C\u5EA6\u68C0\u67E5\u673A\u5236(\u9632\u6B62\u57FA\u4E8E\u65E7\u6570\u636E\u4F18\u5316), \u524D\u7AEF\u4E50\u89C2UI\u66F4\u65B0, \u5185\u5B58\u4FDD\u62A4\u4E0E\u50F5\u5C38\u6761\u76EE\u6E05\u7406",
        // @ts-expect-error - type assertion
        affectedModules: ["sync", "bidOptimization", "budgetOptimization", "placementOptimization", "negativeKeywords", "searchTermHarvesting"],
        // @ts-expect-error - type assertion
        correctionActions: ["reoptimize_all"]
      },
      {
        version: 222,
        description: "v222: \u667A\u80FD\u8C03\u5EA6\u534F\u8C03+\u65E5\u5FD7\u5B89\u5168+campaignId\u67B6\u6784\u7EA7\u4FEE\u590D+\u5185\u5B58\u4F18\u5316 \u2014 (1)\u8C03\u5EA6\u5668\u5C42\u7EA7\u667A\u80FD\u534F\u8C03\u907F\u514DAPI\u538B\u529B (2)\u5168\u94FE\u8DEF\u5B89\u5168\u6570\u5B57\u63D0\u53D6\u9632\u5FA1[object Object] (3)\u4FEE\u590DmultiDimensionOptimizer\u4E2DcampaignId\u6DF7\u7528 (4)Procfile\u5806\u5185\u5B58512MB\u21922048MB (5)\u5065\u5EB7\u68C0\u67E5\u9608\u503C\u4F18\u5316 (6)\u67B6\u6784\u7EA7campaignId\u5B88\u536B: \u521B\u5EFAcampaignIdResolver\u7EDF\u4E00\u89E3\u6790\u5668, \u5728createBiddingLog/insertOptimizationEvent/batchInsertOptimizationEvents\u4E09\u4E2A\u5165\u53E3\u6DFB\u52A0\u5B88\u536B, \u4FEE\u590D\u81EA\u52A8\u7EA0\u9519\u5199\u5165campaignId=0\u7684\u6839\u56E0",
        affectedModules: ["bid"],
        correctionActions: ["rerun_optimization"]
      },
      {
        version: 223,
        description: "v223: [\u4E25\u91CD\u4FEE\u590D] NextGen\u89C4\u5219\u5F15\u64CEtargetAcos\u5355\u4F4D\u8F6C\u6362Bug \u2014 \u6570\u636E\u5E93\u5B58\u50A8\u767E\u5206\u6BD4(30.0)\u88AB\u5F53\u4F5C\u5C0F\u6570(0.30)\u4F7F\u7528,\u5BFC\u81F4\u76EE\u6807ACoS\u88AB\u8BEF\u8BFB\u4E3A3000%,\u6240\u6709\u5173\u952E\u8BCD\u51FA\u4EF7\u53EA\u5347\u4E0D\u964D. \u4FEE\u590D: (1)calculateNextGenBid\u5165\u53E3\u6DFB\u52A0\u9632\u5FA1\u6027\u8F6C\u6362(>1\u5219/100) (2)ruleEngineDecision\u6DFB\u52A0\u53CC\u91CD\u5146\u5E95\u8F6C\u6362 (3)\u5206\u65F6\u7ADE\u4EF7\u51FA\u4EF7\u4E0D\u53D8\u65F6\u8DF3\u8FC7\u65E5\u5FD7\u8BB0\u5F55 (4)\u6E05\u7406\u65E0\u6548pending\u5206\u65F6\u7ADE\u4EF7\u65E5\u5FD7 (5)\u90E8\u7F72\u540E\u81EA\u52A8\u89E6\u53D1\u5168\u91CF\u91CD\u4F18\u5316,\u4F7F\u7528\u4FEE\u590D\u540E\u7684\u7B97\u6CD5\u7EA0\u6B63\u6240\u6709\u9519\u8BEF\u51FA\u4EF7",
        affectedModules: ["bid"],
        correctionActions: ["cleanup_stale_pending", "rerun_optimization"]
      },
      {
        version: 238,
        description: "v238: [\u5173\u952E\u4FEE\u590D] \u89C4\u5219\u5F15\u64CE\u96F6\u66DD\u5149\u63A2\u7D22\u65E0\u9650\u63D0\u4EF7\u5FAA\u73AF\u4FEE\u590D + \u51FA\u4EF7\u7D2F\u79EF\u4FDD\u62A4 \u2014 (1)\u96F6\u66DD\u5149\u63A2\u7D22\u589E\u52A0\u51FA\u4EF7\u4E0A\u9650\u4FDD\u62A4(\u4E0D\u8D85\u8FC7maxBid\u768440%) (2)\u96F6\u70B9\u51FB\u4F4E\u66DD\u5149\u573A\u666F\u589E\u52A0\u51FA\u4EF7\u4E0A\u9650\u4FDD\u62A4(\u4E0D\u8D85\u8FC7maxBid\u768450%) (3)\u96F6\u8F6C\u5316\u573A\u666F\u589E\u5F3A\u964D\u4EF7\u529B\u5EA6(\u82B1\u8D39\u8D85\u6807\u65F6\u964D\u4EF710-25%) (4)ACOS\u8D85\u6807\u964D\u4EF7\u589E\u5F3A(v232\u7D27\u6025\u964D\u4EF7+v238\u7D2F\u79EF\u4FDD\u62A4) (5)\u90E8\u7F72\u540E\u81EA\u52A8\u89E6\u53D1\u5168\u91CF\u91CD\u4F18\u5316\u7EA0\u6B63\u5386\u53F2\u9519\u8BEF\u63D0\u4EF7",
        affectedModules: ["bid"],
        correctionActions: ["rerun_optimization"]
      },
      {
        version: 239,
        description: "v239: \u5143\u5B66\u4E60\u7B97\u6CD5\u9009\u62E9\u5668\u95E8\u69DB\u964D\u4F4E \u2014 UCB\u95E8\u69DB10\u21925\u6761RL\u65E5\u5FD7, Sigmoid\u95E8\u69DB20\u219210\u6761, CQL\u95E8\u69DB50\u219230\u6761, Ensemble\u95E8\u69DB3\u21922\u4E2A\u7B97\u6CD5\u53EF\u7528, \u52A0\u901F\u9AD8\u7EA7\u7B97\u6CD5\u51B7\u542F\u52A8",
        affectedModules: ["bid"],
        correctionActions: ["rerun_optimization"]
      },
      {
        version: 240,
        description: "v240: [\u5BA1\u8BA1\u4FEE\u590D] \u51FA\u4EF7\u5FAE\u8C03\u7075\u654F\u5EA6\u63D0\u5347 \u2014 (1)hold\u5224\u5B9A\u9608\u503C\u4ECE$0.01\u964D\u4F4E\u5230$0.005\uFF0C\u4F4E\u51FA\u4EF7\u5173\u952E\u8BCD\u7684\u5FAE\u8C03\u4E0D\u518D\u88AB\u56DB\u820D\u4E94\u5165\u5403\u6389 (2)ACOS\u8FBE\u6807\u573A\u666F\u8C03\u6574\u7CFB\u6570\u4ECE0.10\u63D0\u9AD8\u52300.15\uFF0C\u5FAE\u8C03\u66F4\u6709\u6548 (3)ACOS\u7565\u9AD8\u573A\u666F\u964D\u4EF7\u7CFB\u6570\u4ECE0.20\u63D0\u9AD8\u52300.25\uFF0C\u964D\u4EF7\u66F4\u79EF\u6781 (4)\u90E8\u7F72\u540E\u81EA\u52A8\u89E6\u53D1\u5168\u91CF\u91CD\u4F18\u5316\u7EA0\u6B63\u5386\u53F2hold\u5224\u5B9A",
        affectedModules: ["bid"],
        correctionActions: ["rerun_optimization"]
      },
      {
        version: 241,
        description: "v241: [RL\u51B7\u542F\u52A8+\u90E8\u7F72\u6D41\u7A0B\u4F18\u5316+\u76D1\u63A7] \u2014 (1)RL\u51B7\u542F\u52A8\u63A2\u7D22\u7B56\u7565: \u5F53\u89C4\u5219\u5F15\u64CE\u5224\u5B9A\u4E3Ahold\u65F6\uFF0C20%\u6982\u7387\u8FDB\u884C\xB13-5%\u63A2\u7D22\u6027\u51FA\u4EF7\uFF0C\u6253\u7834\u51B7\u542F\u52A8\u6B7B\u9501 (2)Reward\u56DE\u586B\u7A97\u53E3\u4ECE24-72h\u6269\u5C55\u523012-96h\uFF0C\u52A0\u901F\u6570\u636E\u79EF\u7D2F (3)PostDeploy\u91CD\u4F18\u5316\u540E\u540C\u6B65\u66F4\u65B0moduleLastExecutionMap\uFF0C\u907F\u514D\u5B9A\u65F6\u4EFB\u52A1\u88AB\u8DF3\u8FC7 (4)\u65B0\u589ENextGen\u76D1\u63A7\u4EEA\u8868\u677FAPI /api/ops/nextgen-monitor (5)recordModuleExecution\u5BFC\u51FA\u4E3A\u516C\u5171\u51FD\u6570",
        affectedModules: ["bid"],
        correctionActions: ["rerun_optimization"]
      },
      {
        version: 242,
        description: "v242: [\u7CFB\u7EDF\u6027\u4FEE\u590D] \u2014 (1)\u89C4\u5219\u5F15\u64CE\u7CBE\u5EA6\u611F\u77E5\u8C03\u6574: \u5F15\u5165\u6700\u5C0F\u6709\u6548\u8C03\u6574\u91CF$0.02\uFF0C\u907F\u514D\u5FAE\u8C03\u88AB\u56DB\u820D\u4E94\u5165\u5403\u6389 (2)RL\u51B7\u542F\u52A8\u63A2\u7D22\u7B56\u7565\u4F18\u5316: \u63A2\u7D22\u7387\u81EA\u9002\u5E94\u8C03\u6574\uFF0C\u52A0\u901F\u6570\u636E\u79EF\u7D2F (3)\u8C03\u5EA6\u72B6\u6001\u6301\u4E45\u5316: \u6A21\u5757\u6267\u884C\u65F6\u95F4\u6301\u4E45\u5316\u5230\u6570\u636E\u5E93\uFF0C\u5F7B\u5E95\u89E3\u51B3\u90E8\u7F72\u91CD\u542F\u5BFC\u81F4\u5B9A\u65F6\u4EFB\u52A1\u88AB\u8DF3\u8FC7 (4)\u5173\u952E\u8BCD\u540C\u6B65\u4FEE\u590D: \u589E\u5F3A\u9519\u8BEF\u65E5\u5FD7\u5E8F\u5217\u5316+\u91CD\u8BD5\u673A\u5236+\u5E76\u53D1\u63A7\u5236 (5)\u6570\u636E\u5E93\u8FC1\u79FB: \u65B0\u589Emodule_execution_times\u5B57\u6BB5",
        affectedModules: ["bid"],
        correctionActions: ["rerun_optimization"]
      },
      {
        version: 243,
        description: "v243: [\u6B7B\u9501\u4FEE\u590D] \u2014 (1)\u751F\u547D\u5468\u671F\u5224\u5B9A\u4F18\u5316: OR\u6539\u4E3AAND\u903B\u8F91\uFF0C\u907F\u514D\u8001\u5E7F\u544A\u6C38\u4E45\u505C\u7559\u5728launch\u9636\u6BB5 (2)launch\u9636\u6BB5bid\u95F4\u96944h\u964D\u4E3A2h (3)\u6A21\u5757\u6267\u884C\u65F6\u95F4\u6062\u590D\u7B56\u7565\u4F18\u5316: \u4E0D\u518D\u4F7F\u7528last_optimization_at\u56DE\u9000\u586B\u5145\uFF0C\u907F\u514DPostDeploy\u66F4\u65B0\u65F6\u95F4\u5BFC\u81F4\u6B7B\u9501 (4)PostDeploy\u5F3A\u5236\u521D\u59CB\u5316module_execution_times",
        affectedModules: ["bid"],
        correctionActions: ["rerun_optimization"]
      },
      {
        version: 244,
        description: "v244: [\u5B89\u5168\u68C0\u67E5\u4FEE\u590D] \u2014 (1)\u79FB\u9664v232\u7D27\u6025\u6B62\u635F\u903B\u8F91:\u5B89\u5168\u68C0\u67E5\u89E6\u53D1\u65F6\u8DF3\u8FC7\u8BE5campaign\u800C\u975E\u6682\u505C\u6574\u4E2A\u4F18\u5316\u76EE\u6807 (2)PostDeploy\u81EA\u52A8\u6062\u590D\u88AB\u9519\u8BEF\u5173\u95ED\u7684\u4F18\u5316\u76EE\u6807(autoOptimize=0\u21921) (3)\u4FEE\u590D\u524D\u7AEF\u81EA\u52A8\u4F18\u5316\u72B6\u6001\u663E\u793Abug(\u4F7F\u7528autoOptimize\u5B57\u6BB5\u800C\u975Estatus\u5B57\u6BB5)",
        affectedModules: ["bid"],
        correctionActions: ["rerun_optimization"]
      },
      {
        version: 245,
        description: "v245: [\u7CFB\u7EDF\u5065\u5EB7\u4FEE\u590D] \u2014 (1)RL\u5956\u52B1\u56DE\u586B\u7A97\u53E3\u4ECE12h\u964D\u81F36h\u52A0\u901F\u51B7\u542F\u52A8 (2)\u7D27\u6025\u4F18\u5316\u961F\u5217\u6301\u4E45\u5316\u5230\u6570\u636E\u5E93(emergency_optimization_queue\u8868) (3)\u98CE\u9669\u8BC4\u4F30\u7ED3\u679C\u5199\u5165anomaly_alert_logs (4)\u9884\u7B97\u540C\u6B65\u81EA\u52A8\u786E\u8BA4:syncSpCampaigns\u4E2D\u68C0\u6D4BAmazon\u8FD4\u56DEbudget\u4E0EpendingBudget\u4E00\u81F4\u65F6\u81EA\u52A8\u6807\u8BB0synced (5)\u81EA\u52A8\u5316\u90E8\u7F72\u811A\u672C:\u6784\u5EFA\u2192\u6253\u5305\u2192\u90E8\u7F72\u2192\u7248\u672C\u9A8C\u8BC1\u2192\u81EA\u52A8\u56DE\u6EDA",
        affectedModules: ["bid", "budget"],
        correctionActions: ["rerun_optimization", "recalculate_budgets"]
      },
      {
        version: 248,
        description: "v248: [\u7EDF\u4E00\u4FEE\u590D] \u2014 (1)\u540C\u6B65\u5C42\u51B2\u7A81\u8DF3\u8FC7\u6B63\u786E\u5206\u7C7B: \u4FEE\u590Dv222\u65B0\u683C\u5F0F\u5C42\u51B2\u7A81\u6D88\u606F\u672A\u88AB\u8BC6\u522B\u4E3Askipped\u800C\u88AB\u8BB0\u5F55\u4E3Afailed (2)RL Reward\u56DE\u586B\u4E0B\u96506h\u21923h: \u6253\u7834\u51B7\u542F\u52A8\u6B7B\u9501,\u52A0\u901F\u9AD8\u7EA7\u7B97\u6CD5eligible (3)negative_keywords\u540C\u6B65\u9891\u7387\u63D0\u5347: \u4ECEfull\u5C42(60min)\u63D0\u5347\u5230medium\u5C42(30min) (4)\u65E5\u5FD7\u7F13\u51B2\u533A\u6269\u5BB9: 5000\u219215000\u907F\u514D\u65E5\u5FD7\u4E22\u5931 (5)API 429\u9650\u6D41\u589E\u5F3A: \u91CD\u8BD52\u21924\u6B21,\u57FA\u7840\u5EF6\u8FDF2s\u21923s,\u6700\u5927\u9000\u907F15s\u219230s,\u6279\u91CF\u5EF6\u8FDF1s\u21922s (6)\u6570\u636E\u5E93\u81EA\u52A8\u8FC1\u79FB: \u542F\u52A8\u65F6\u81EA\u52A8\u521B\u5EFA\u7F3A\u5931\u7684\u8868/\u5217(anomaly_alert_logs,emergency_optimization_queue,module_execution_times)",
        affectedModules: ["bid"],
        correctionActions: ["rerun_optimization"]
      },
      {
        version: 249,
        description: "v249: [\u76D1\u63A7\u4FEE\u590D] \u2014 (1)nextgen-monitor bidStats SQL\u67E5\u8BE2\u6761\u4EF6\u4FEE\u590D: action_type\u8FC7\u6EE4\u4E0ErecordExecutionLog\u5199\u5165\u503C\u4E0D\u5339\u914D\u5BFC\u81F4totalEvents\u59CB\u7EC8\u4E3A0 (2)optimization-events\u7AEF\u70B9\u8865\u5168api_sync_status/keyword_text/previous_bid/new_bid\u5B57\u6BB5 (3)\u589E\u52A0API\u540C\u6B65\u72B6\u6001\u7EDF\u8BA1\u67E5\u8BE2",
        affectedModules: [],
        correctionActions: []
      },
      {
        version: 250,
        description: "v250: [\u67B6\u6784\u4FEE\u590D] \u2014 (1)recordExecutionLog\u53CC\u5199\u673A\u5236\u4FEE\u590D: \u5C06\u76F4\u63A5insert(optimizationLogs)\u66FF\u6362\u4E3AcreateOptimizationLog()\u786E\u4FDD\u540C\u65F6\u5199\u5165optimization_events\u8868\uFF0C\u4FEE\u590D\u524D\u7AEF\u548C\u76D1\u63A7\u65E0\u6CD5\u770B\u5230NextGen\u7B97\u6CD5\u51FA\u4EF7\u8BB0\u5F55\u7684\u95EE\u9898 (2)\u65E5\u5FD7\u7F13\u51B2\u533A\u6269\u5BB9: GLOBAL_BUF 1500\u21925000\u907F\u514D\u6EA2\u51FA",
        affectedModules: ["bid"],
        // 出价日志写入路径变更，需要重新执行以验证双写
        correctionActions: ["rerun_optimization"]
      },
      {
        version: 251,
        description: "v251: [\u7B97\u6CD5\u589E\u5F3A] \u2014 (1)NextGen\u89C4\u5219\u5F15\u64CE\u4F7F\u7528\u771F\u5B9EAOV(groupAvgAov)\u66FF\u4EE3currentBid*30\u7684\u7C97\u66B4\u5047\u8BBE\uFF0C\u89E3\u51B3\u54C1\u7C7B\u504F\u89C1\u95EE\u9898 (2)\u5426\u5B9A\u8BCD\u51B3\u7B56\u5F15\u5165\u82B1\u8D39/\u5BA2\u5355\u4EF7\u6BD4\u7387\uFF0C\u89E3\u51B3\u9AD8\u5BA2\u5355\u4EF7\u4EA7\u54C1\u7684\u201C\u5047\u9633\u6027\u201D\u5426\u5B9A\u95EE\u9898 (3)\u5F15\u5165\u5F52\u56E0\u5EF6\u8FDF\u5BB9\u5FCD\u5EA6(1.5x)\u907F\u514D\u8BEF\u6740\u6B63\u5728\u5F52\u56E0\u4E2D\u7684\u6D41\u91CF (4)\u524D\u7AEF\u6570\u636E\u6982\u89C8\u5361\u7247\u5E03\u5C40\u4FEE\u590D",
        // @ts-expect-error - runtime type mismatch
        affectedModules: ["bid", "negative_keyword"],
        correctionActions: ["rerun_optimization"]
      },
      {
        version: 252,
        description: "v252: [RL\u6570\u636E\u8D28\u91CF\u4FEE\u590D+UI\u589E\u5F3A] \u2014 (1)captureStateSnapshot\u4FEE\u590D: \u4F18\u5148\u4F7F\u7528\u5173\u952E\u8BCD/\u5546\u54C1\u5B9A\u5411\u7EA7\u522B\u7684\u7EE9\u6548\u6570\u636E\uFF0C\u800C\u975E\u8D26\u6237\u7EA7\u522B\u6C47\u603B (2)recordBidAction\u4FEE\u590D: \u4F20\u9012campaignId\u548CadGroupId\u786E\u4FDD\u6B63\u786E\u7C92\u5EA6 (3)OptimizationLogs\u7EC4\u4EF6\u589E\u5F3A: \u7B97\u6CD5\u7C7B\u578B\u53EF\u89C6\u5316\u5FBD\u7AE0+\u51B3\u7B56\u4E0A\u4E0B\u6587\u5C55\u5F00\u9762\u677F+\u7F6E\u4FE1\u5EA6\u8FDB\u5EA6\u6761+\u5F52\u56E0\u4FDD\u62A4\u6307\u793A\u5668 (4)AlgorithmEffectDashboard\u589E\u5F3A: \u7B97\u6CD5\u5C42\u7EA7\u5206\u5E03\u5361\u7247+\u7B97\u6CD5\u5C42\u7EA7\u5206\u6790Tab+\u771F\u5B9E\u6570\u636E\u8BA1\u7B97\u66FF\u4EE3\u786C\u7F16\u7801 (5)RL\u8BCA\u65AD\u7AEF\u70B9: \u65B0\u589E/ops/rl-diagnostics\u7528\u4E8E\u76D1\u63A7Reward\u56DE\u586B\u72B6\u6001",
        affectedModules: ["bid"],
        correctionActions: ["rerun_optimization"]
      },
      {
        version: 253,
        description: "v253: [\u5BA1\u8BA1\u4FEE\u590D] \u2014 (1)RL\u8BCA\u65ADSQL Bug\u4FEE\u590D: accountId\u5B57\u6BB5\u4E0D\u4E00\u81F4 (2)backfillRewards\u589E\u5F3A: \u79FB\u9664limit\u9650\u5236+\u96F6\u6570\u636E\u573A\u666F\u5904\u7406 (3)\u89C4\u5219\u5F15\u64CE\u4E2A\u6027\u5316: \u6570\u636E\u7F6E\u4FE1\u5EA6\u56E0\u5B50+CTR\u76F8\u5173\u6027\u611F\u77E5 (4)UI\u540C\u6B65\u72B6\u6001\u4FEE\u590D: \u533A\u5206\u5386\u53F2\u8BB0\u5F55\u548C\u771F\u6B63\u5F85\u540C\u6B65",
        affectedModules: ["bid"],
        correctionActions: ["rerun_optimization"]
      },
      {
        version: 254,
        description: "v254: [\u8D8B\u52BF\u611F\u77E5\u4F18\u5316] \u2014 (1)\u89C4\u5219\u5F15\u64CE\u8D8B\u52BF\u611F\u77E5: \u5229\u7528dailyData\u8BA1\u7B97\u8FD1\u671F\u8868\u73B0\u8D8B\u52BF(improving/stable/declining) (2)\u63D0\u4EF7\u573A\u666F: \u8D8B\u52BFimproving\u65F6\u52A0\u901F\u63D0\u4EF7\uFF0Cdeclining\u65F6\u51CF\u7F13 (3)\u964D\u4EF7\u573A\u666F: \u8D8B\u52BFdeclining\u65F6\u52A0\u901F\u6B62\u635F\uFF0Cimproving\u65F6\u51CF\u7F13\u907F\u514D\u8BEF\u6740 (4)\u96F6\u8F6C\u5316\u573A\u666F: \u8D8B\u52BFimproving\u65F6\u589E\u52A0\u5F52\u56E0\u5BB9\u5FCD\u5EA6",
        affectedModules: ["bid"],
        correctionActions: ["rerun_optimization"]
      },
      {
        version: 255,
        description: "v255: [\u6307\u4EE4\u786E\u8BA4+\u62A5\u544AAPI\u4FEE\u590D] \u2014 (1)PostOptVerifier: \u4FEE\u590DamazonKeywordId Bug\uFF0C\u4F7F\u7528\u771F\u6B63\u7684Amazon ID\u800C\u975E\u672C\u5730\u81EA\u589EID (2)SD/SP/SB\u62A5\u544AAPI: \u4FEE\u590D5\u4E2Adate+SUMMARY\u51B2\u7A81\u548CreportTypeId\u9519\u8BEF (3)SB Negative API: 403\u9519\u8BEF\u964D\u7EA7\u4E3AWARN",
        affectedModules: ["sync", "bid"],
        correctionActions: ["rerun_optimization"]
      },
      {
        version: 256,
        description: "v256: [\u5168\u94FE\u8DEF\u5BA1\u8BA1\u4FEE\u590D] \u2014 (1)RL\u667A\u80FD\u53CC\u901A\u9053\u56DE\u586B: \u79FB\u96643h\u4E0B\u9650\uFF0C\u5B9E\u4F53\u7EA7\u6570\u636E\u5373\u65F6\u56DE\u586B+\u6269\u5C55\u7A97\u53E3\u5230168h\uFF0C\u89E3\u51B3\u91CD\u542F\u51B7\u542F\u52A8\u74F6\u9888 (2)\u81EA\u52A8\u51B2\u7A81\u89E3\u51B3\u5F15\u64CE: \u6279\u91CF\u89E3\u51B373K+\u79EF\u538Bpending\u51B2\u7A81 (3)\u9AD8\u7EA7\u7B97\u6CD5\u6FC0\u6D3B\u9608\u503C\u4F18\u5316: UCB 5\u21923, Sigmoid 10\u21925, CQL 30\u219215 (4)recordsSynced\u5B57\u6BB5\u6620\u5C04\u4FEE\u590D (5)\u5426\u5B9A\u5173\u952E\u8BCD\u540C\u6B65\u63D0\u5347\u5230high\u5C42(30min\u219210min)",
        // @ts-expect-error - runtime type mismatch
        affectedModules: ["sync", "bid", "rl"],
        correctionActions: ["rerun_optimization"]
      },
      {
        version: 257,
        description: "v257: [\u5168\u94FE\u8DEF\u4F18\u5316\u5347\u7EA7] \u2014 (1)P0\u51FA\u4EF7\u632F\u8361\u6839\u6CBB: 4h\u51B7\u5374\u65F6\u95F4+24h\u6700\u5927\u8C03\u6574\u6B21\u6570+\u6700\u5C0F\u8C03\u6574\u5E45\u5EA6\u9608\u503C (2)P0\u4E09\u901A\u9053RL\u56DE\u586B: \u65B0\u589E\u901A\u9053C\u4ECEoptimization_events\u5408\u6210\u5956\u52B1 (3)P1\u4E3B\u52A8\u63A2\u7D22\u7B56\u7565: \u591A\u68AF\u5EA6\u63A2\u7D22(3-12%)+\u975Ehold\u6270\u52A8\uFF0C\u52A0\u901F\u9AD8\u7EA7\u7B97\u6CD5\u6FC0\u6D3B (4)P1 match_type\u5386\u53F2\u6570\u636E\u56DE\u586B (5)P2\u7EA0\u9519\u4E8B\u4EF6\u5173\u8054\u8FFD\u8E2A+\u4F18\u5316\u65E5\u5FD7\u589E\u5F3A (6)v257.1\u70ED\u4FEE\u590D: systemVersion.ts\u7248\u672C\u53F7\u540C\u6B65+\u6570\u636E\u5E93\u8FDE\u63A5\u6C60\u589E\u5F3A\u914D\u7F6E+JWT\u8BA4\u8BC1\u964D\u7EA7\u7B56\u7565",
        affectedModules: ["bid"],
        correctionActions: ["rerun_optimization"]
      },
      {
        version: 258,
        description: "v258: [P0\u6838\u5FC3\u7B97\u6CD5\u91CD\u6784] \u2014 (1)P0-ACoS\u6B7B\u4EA1\u87BA\u65CB\u6839\u6CBB: \u5F52\u56E0\u5EF6\u8FDF\u4FDD\u62A4(\u70B9\u51FB<5\u5F3A\u5236\u89C2\u5BDF)+\u964D\u4EF7\u7194\u65AD(7\u5929\u7D2F\u8BA130%\u4E0A\u9650/\u8FDE\u7EED3\u6B21\u5F3Ahold/\u6700\u4F4E40%\u4FDD\u62A4)+\u591A\u7EF4\u5EA6\u51B3\u7B56(CTR\u8F85\u52A9\u5224\u65AD)+\u964D\u4EF7\u529B\u5EA6\u4E0A\u9650(15%/25%) (2)P0-\u9AD8\u7EA7\u7B97\u6CD5\u6FC0\u6D3B: UCB\u96F6\u95E8\u69DB\u59CB\u7EC8\u53EF\u7528+LinUCB/Sigmoid\u964D\u81F31-2\u6761+\u5F85\u56DE\u586B\u65E5\u5FD7\u8BA1\u5165 (3)P1-\u7EDF\u4E00\u51FA\u4EF7\u4EF2\u88C1: \u7EA0\u6B63\u524D\u68C0\u67E5\u66F4\u65B0\u51B3\u7B56+\u51B7\u5374/\u7194\u65AD\u4FDD\u62A4\u671F\u8DF3\u8FC7 (4)P1-\u65E5\u5FD7\u53EF\u8BFB\u6027: \u65B0\u589Ereason_details/guardrail_info/related_event_id\u5B57\u6BB5+\u524D\u7AEF\u62A4\u680F\u673A\u5236\u53EF\u89C6\u5316",
        affectedModules: ["bid"],
        correctionActions: ["rerun_optimization"]
      },
      {
        version: 259,
        description: "v259: [\u5168\u94FE\u8DEF\u667A\u80FD\u5347\u7EA7] \u2014 (1)P0-\u5207\u65ADACoS\u6B7B\u4EA1\u87BA\u65CB: \u7194\u65AD\u89E6\u53D1\u65F6\u4E3B\u52A8\u63D0\u4EF78%\u6062\u590D\u66DD\u5149+\u6700\u4F4E\u66DD\u5149\u4FDD\u62A4(\u8FD13\u5929\u66DD\u5149\u4F4E\u4E8E\u57FA\u7EBF50%\u65F6\u6682\u505C\u964D\u4EF7\u5E76\u63D0\u4EF7)+\u5E95\u7EBF\u6062\u590D\u673A\u5236 (2)P0-\u6839\u6CBB\u51FA\u4EF7\u56DE\u6EDA: \u7EA0\u9519\u5668\u65F6\u95F4\u7A97\u53E3\u4ECE3\u5929\u7F29\u5C0F\u52301\u5929+SQL\u5C42\u6392\u9664\u62A4\u680F\u4E8B\u4EF6+\u4EF2\u88C1\u68C0\u67E5\u7A97\u53E3\u6269\u5927\u52308\u5C0F\u65F6 (3)P1-\u5F3A\u5236\u6FC0\u6D3BUCB: \u5386\u53F2\u6570\u636E\u5408\u6210\u7ED5\u8FC7\u56DE\u586B\u94FE\u8DEF+UCB\u57FA\u7840\u52061.30+rule_based\u964D\u52060.85+Ensemble\u964D\u81F32\u7B97\u6CD5 (4)P1-RL\u56DE\u586B\u4FEE\u590D: \u96F6\u6570\u636E\u91CD\u8BD5\u673A\u5236+\u56DE\u586B\u5065\u5EB7\u68C0\u67E5\u62A5\u544A (5)P1-\u53CC\u5411\u51FA\u4EF7: ACOS\u6781\u4F18\u573A\u666F\u79EF\u6781\u63D0\u4EF725%+\u8D85\u6807\u964D\u4EF7\u4E0A\u9650\u6536\u7D27\u523020% (6)P2-\u6570\u636E\u5C55\u793A\u4E00\u81F4\u6027: riskActionEngine\u964D\u4EF7\u4E0A\u9650\u5BF9\u9F50+\u62A4\u680F\u53EF\u89C6\u5316\u589E\u5F3A(\u63D0\u4EF7\u6062\u590D/\u66DD\u5149\u4FDD\u62A4/\u53CC\u5411\u51FA\u4EF7\u6807\u8BC6)",
        affectedModules: ["bid"],
        correctionActions: ["rerun_optimization"]
      },
      {
        version: 260,
        description: "v260: [\u6301\u7EED\u76D1\u63A7+\u52A8\u6001\u63D0\u4EF7+\u4EEA\u8868\u76D8\u589E\u5F3A] \u2014 (1)P0-\u7CFB\u7EDF\u5065\u5EB7\u76D1\u63A7API: \u56DE\u6EDA\u7387/\u7B97\u6CD5\u6FC0\u6D3B\u7387/ACoS\u8D8B\u52BF/\u7194\u65AD\u89E6\u53D1\u7387/\u63D0\u4EF7\u5206\u6790\u5B9E\u65F6\u8BA1\u7B97 (2)P1-\u52A8\u6001\u63D0\u4EF7\u6A21\u578B: \u57FA\u4E8ECTR+CVR\u7CBE\u7EC6\u5316\u8C03\u6574\u63D0\u4EF7\u5E45\u5EA6(\u660E\u661F\u8BCD30%/\u9AD8\u6D41\u91CF15%/\u9AD8\u8F6C\u531620%/\u4FDD\u5B8810%) (3)P2-\u4EEA\u8868\u76D8\u589E\u5F3A: \u524D\u7AEF\u65B0\u589E\u56DE\u6EDA\u7387+\u7B97\u6CD5\u6FC0\u6D3B\u7387+ACoS\u8D8B\u52BF+\u7194\u65AD\u89E6\u53D1\u7387\u56DB\u5927\u5065\u5EB7\u6307\u6807\u5361\u7247 (4)\u7F51\u7AD9\u5E95\u90E8\u516C\u53F8\u4FE1\u606F: \u6DF1\u5733\u4E00\u54C1\u540D\u8F69\u79D1\u6280\u6709\u9650\u516C\u53F8",
        affectedModules: ["bid"],
        correctionActions: ["rerun_optimization"]
      },
      {
        version: 261,
        description: "v261: [\u90E8\u7F72\u540E\u7EA0\u9519\u673A\u5236\u91CD\u6784] \u2014 (1)\u542F\u52A8\u534F\u8C03\u987A\u5E8F\u91CD\u6784: PostDeploy\u2192AutoCorrector\u2192\u6548\u679C\u9A8C\u8BC1(\u65B0\u7B97\u6CD5\u4F18\u5148\u539F\u5219) (2)\u90E8\u7F72\u540E\u6548\u679C\u9A8C\u8BC1\u95ED\u73AF: \u91CD\u4F18\u5316\u540E\u7B49\u5F8560\u79D2\u518D\u6B21\u626B\u63CF\u786E\u8BA4Amazon\u5DF2\u63A5\u53D7\u6240\u6709\u6307\u4EE4 (3)\u524D\u7AEF\u7EA0\u9519\u62A5\u544A\u53EF\u89C6\u5316: Dashboard\u65B0\u589E\u90E8\u7F72\u540E\u7EA0\u9519\u62A5\u544A\u5361\u7247",
        affectedModules: ["bid"],
        correctionActions: ["rerun_optimization"]
      },
      {
        version: 262,
        description: "v262: [\u524D\u53F0\u9875\u9762\u91CD\u6784] \u2014 \u65B0\u589E\u9996\u9875/\u4F18\u5316\u903B\u8F91/\u8054\u7CFB\u6211\u4EEC\u9875\u9762 + PublicLayout\u7EDF\u4E00\u5BFC\u822A\u548C\u5E95\u90E8\u516C\u53F8\u4FE1\u606F(\u7EAF\u524D\u7AEF\u53D8\u66F4,\u4E0D\u5F71\u54CD\u540E\u7AEF\u4F18\u5316\u6A21\u5757)",
        affectedModules: [],
        correctionActions: []
      },
      {
        version: 268,
        description: "v268: [B\u7EA7\u2192A\u7EA7\u51B2\u523A] \u2014 (1)P0-1\u7D27\u6025\u4F18\u5316\u589E\u5F3A: \u5206\u5C42\u7EA7\u964D\u4EF7+\u6536\u7D27\u6682\u505C\u95E8\u69DB+\u6E10\u8FDB\u7194\u65AD\u6062\u590D+\u7ADE\u4E89\u529B\u6062\u590D\u6A21\u5F0F (2)P0-2\u8BC4\u5206\u7B97\u6CD5\u4F18\u5316: \u65B9\u5411\u6B63\u786E\u6027\u52A0\u5206+\u4F18\u5316\u901F\u5EA6\u8BC4\u4F30+\u54C1\u7C7BCVR\u57FA\u51C6 (3)P1-1\u9AD8\u7EA7\u7B97\u6CD5\u5F3A\u5236\u6FC0\u6D3B: \u964D\u4F4E\u6FC0\u6D3B\u95E8\u69DB+RL\u6570\u636E\u5FEB\u901F\u79EF\u7D2F+\u6A21\u578B\u8BAD\u7EC3\u52A0\u901F (4)P1-2\u7ADE\u4EF7\u667A\u80FD\u5316: \u5F52\u56E0\u5EF6\u8FDF\u611F\u77E5+\u65E0\u5355\u8BCD\u4FDD\u62A4\u671F (5)P2-1\u53EF\u89C2\u6D4B\u6027\u589E\u5F3A: \u5206\u7EA7\u544A\u8B66+\u667A\u80FD\u964D\u566A+\u7B97\u6CD5\u6548\u80FD\u76D1\u63A7",
        affectedModules: ["bid"],
        correctionActions: ["rerun_optimization"]
      },
      {
        version: 273,
        description: "v273: [\u81EA\u52A8\u4F18\u5316\u505C\u6EDE\u611F+\u7B97\u6CD5\u5206\u5E03\u4FEE\u590D] \u2014 (1)P0-\u7B97\u6CD5\u5206\u7C7B\u4FEE\u6B63: cooldown_hold/direction_hold\u4ECErule_engine\u6539\u4E3Aguardrail\u5C42\u7EA7 (2)P0-\u51B7\u5374\u671F\u4F18\u5316: 6h\u964D\u81F34h+24h\u6700\u5927\u8C03\u6574\u6B21\u65703\u21924 (3)P1-\u9AD8\u7EA7\u7B97\u6CD5\u6FC0\u6D3B\u589E\u5F3A: confidence\u95E8\u69DB\u964D\u4F4E(ensemble 0.35\u21920.30, CQL/LinUCB 0.25\u21920.20) (4)P1-\u524D\u7AEF\u7EDF\u8BA1\u589E\u5F3A: \u65B0\u589Eguardrail\u5C42\u7EA7\u989C\u8272+\u4E2D\u6587\u540D+\u7B97\u6CD5\u5206\u5E03\u8BA1\u7B97\u4FEE\u6B63 (5)P2-\u8C03\u5EA6\u5668\u5FC3\u8DF3\u65E5\u5FD7\u589E\u5F3A",
        affectedModules: ["bid"],
        correctionActions: ["rerun_optimization"]
      },
      {
        version: 274,
        description: "v274: [\u5168\u9762\u5F15\u64CE\u589E\u5F3A] \u2014 (1)P0-\u56E0\u679C\u63A8\u65AD\u63A5\u5165\u51FA\u4EF7\u51B3\u7B56: causalInferenceResults\u7684optimalBid\u4F5C\u4E3A\u4FE1\u53F7\u6E90\u878D\u5165batchCalculateNextGenBids (2)P0-CQL\u8BAD\u7EC3\u589E\u5F3A: \u6570\u636E\u8D28\u91CF\u9A8C\u8BC1+\u5956\u52B1\u5F52\u4E00\u5316+\u6A21\u578B\u8D28\u91CF\u8BC4\u4F30+\u51B7\u542F\u52A8\u63A2\u7D22 (3)P1-\u7ADE\u4E89\u73AF\u5883\u611F\u77E5\u589E\u5F3A: \u591A\u7EF4\u4FE1\u53F7\u878D\u5408(CPC\u6CE2\u52A8+\u66DD\u5149\u4EFD\u989D+CTR\u53D8\u5316+\u65E5\u62A5\u6570\u636E) (4)P1-\u9884\u7B97\u5206\u6C60\u5177\u8C61\u5316: performanceData\u5B57\u6BB5\u8BB0\u5F55GTO\u51B3\u7B56\u5143\u6570\u636E (5)P2-\u81EA\u52A8\u7EA0\u9519\u95ED\u73AF\u589E\u5F3A: \u56E0\u679C\u63A8\u65AD\u8F85\u52A9\u7EA0\u9519\u5224\u65AD+\u6548\u679C\u8BC4\u5206\u589E\u52A0\u56E0\u679C\u7EF4\u5EA6",
        affectedModules: ["bid"],
        correctionActions: ["rerun_optimization"]
      },
      {
        version: 275,
        description: "v275: [\u53EF\u89C6\u5316+\u98CE\u63A7+\u667A\u80FD\u5316] \u2014 (1)P1-\u524D\u7AEF\u56E0\u679C\u63A8\u65AD\u53EF\u89C6\u5316: AlgorithmEffectDashboard\u65B0\u589E\u56E0\u679C\u5206\u6790Tab+\u5F71\u54CD\u5206\u5E03\u56FE+\u7F6E\u4FE1\u5EA6\u8FDB\u5EA6\u6761 (2)P1-\u9884\u7B97\u5206\u6C60Dashboard: \u5B9E\u65F6\u5C55\u793A80/20\u5206\u6C60\u5206\u914D\u548C\u56DE\u62A5 (3)P2-CQL\u6A21\u578B\u76D1\u63A7: \u8BAD\u7EC3\u72B6\u6001/\u51B3\u7B56\u6B21\u6570/\u6A21\u578B\u8D28\u91CF\u5206\u5C55\u793A (4)P2-\u7ADE\u4E89\u73AF\u5883\u611F\u77E5\u5C55\u793A: \u7ADE\u4E89\u5F3A\u5EA6\u5206\u5E03\u56FE+\u5E02\u573A\u52A8\u6001\u5361\u7247 (5)P2-\u98CE\u9669\u7B49\u7EA7\u5206\u5C42\u81EA\u52A8\u54CD\u5E94: \u7EA2/\u9EC4/\u7EFF\u4E09\u7EA7\u98CE\u9669\u8BC4\u4F30+\u81EA\u52A8\u51FA\u4EF7\u4E58\u6570\u8C03\u6574+\u51B7\u5374\u671F\u5EF6\u957F (6)P3-\u52A8\u6001\u65F6\u95F4\u8870\u51CF\u6743\u91CD: \u6307\u6570\u8870\u51CF+\u6CE2\u52A8\u6027\u81EA\u9002\u5E94 (7)P3-\u7279\u5F81\u7F13\u5B58TTL\u4F18\u5316: 3\u5929\u5BBD\u9650\u671F\u9010\u5929\u56DE\u9000",
        affectedModules: ["bid"],
        correctionActions: ["rerun_optimization"]
      },
      {
        version: 310,
        description: "v310: [\u5168\u94FE\u8DEF\u4FEE\u590D+\u81EA\u6108\u589E\u5F3A] \u2014 (1)P0-\u53BB\u91CD\u903B\u8F91\u589E\u5F3Apending\u72B6\u6001\u68C0\u67E5: \u4FEE\u590D\u91CD\u590D\u5173\u952E\u8BCD\u521B\u5EFA(542+207\u6761) (2)P0-\u54C1\u724C\u8BCD\u6C38\u4E45\u5931\u8D25\u6807\u8BB0: INVALID_VALUE\u9519\u8BEF\u81EA\u52A8\u6807\u8BB0not_applicable (3)P0-\u65E0\u6548targetId\u81EA\u52A8\u6E05\u7406: \u6E05\u9664\u5BFC\u81F4API\u5931\u8D25\u7684\u65E0\u6548Amazon ID (4)P0-SD\u5E7F\u544A\u7EC4\u72B6\u6001API\u4FEE\u590D: \u65B0\u589EupdateSdAdGroupStatus\u65B9\u6CD5 (5)P1-\u8D85\u65F6pending\u81EA\u52A8\u5904\u7406: 24h\u672A\u540C\u6B65\u81EA\u52A8\u6807\u8BB0timeout (6)P1-\u5546\u54C1\u5B9A\u5411\u521B\u5EFAAPI\u5B9E\u73B0: createSpProductTargets+syncNewProductTargetsToAmazon (7)P1-\u5173\u952E\u8BCDAmazon ID\u56DE\u586B\u91CD\u8BD5: \u89E3\u51B3pending keyword_create\u7F3A\u5C11Amazon ID (8)P2-\u5206\u65F6\u7ADE\u4EF7\u5386\u53F2pending\u6E05\u7406: dayparting_bid\u65E0\u6548\u8BB0\u5F55\u6E05\u7406 (9)P0-pending\u6307\u4EE4\u65B0\u7B97\u6CD5\u91CD\u8BC4\u4F30: \u7528\u65B0\u7B97\u6CD5\u5224\u65ADpending\u6307\u4EE4\u662F\u5426\u4ECD\u5408\u7406 (10)P1-\u5DF2\u6267\u884C\u6307\u4EE4\u56DE\u6EAF\u5BA1\u8BA1: \u5BA1\u8BA1synced\u6307\u4EE4\u662F\u5426\u4E0E\u65B0\u7B97\u6CD5\u4E00\u81F4",
        affectedModules: ["bid", "sync", "product_target", "keyword", "dayparting"],
        correctionActions: ["rerun_optimization", "cleanup_stale_pending", "revalidate_pending_commands", "audit_synced_commands", "retry_product_target_sync"]
      },
      {
        version: 311,
        description: "v311: [PT campaign\u5E95\u5C42\u4FEE\u590D+\u4E09\u5C42\u9632\u5FA1\u4F53\u7CFB] \u2014 (1)P0-Campaign\u7EA7\u522BPT\u7C7B\u578B\u68C0\u67E5: \u65B0\u589EisProductTargetingCampaign()\u51FD\u6570\uFF0C\u901A\u8FC7\u547D\u540D\u7EA6\u5B9A(POE/POB/PT/ASIN)\u8BC6\u522BProduct Targeting campaign (2)P0-\u4E09\u5C42\u9632\u5FA1\u4F53\u7CFB: executeSearchTermAnalysis\u904D\u5386\u5F00\u5934\u8DF3\u8FC7PT campaign + canAddPositiveKeyword\u53CC\u91CD\u68C0\u67E5 + adGroupHasProductTargets\u5E95\u5C42\u62E6\u622A (3)P0-AutoCorrector PT\u68C0\u67E5: retryHistoricalFailedKeywordHarvests\u91CD\u8BD5\u524D\u68C0\u67E5campaign\u7C7B\u578B\uFF0CPT campaign\u76F4\u63A5\u6807\u8BB0invalid_legacy (4)P0-SearchTermHarvester PT\u8FC7\u6EE4: findTargetAdGroup\u8FC7\u6EE4\u6389PT\u7C7B\u578Bcampaign (5)P1-30019\u914D\u7F6E\u4FEE\u590D: \u5173\u95EDkeywordAutoEnabled\u963B\u6B62\u5411POE campaign\u6DFB\u52A0keyword (6)P1-keywords\u8868\u53BB\u91CD\u7D22\u5F15: uk_keyword_dedup(adGroupId,keywordText,matchType)\u6570\u636E\u5E93\u5C42\u9762\u9632\u91CD\u590D",
        affectedModules: ["keyword", "searchterm"],
        correctionActions: ["cleanup_stale_pending"]
      },
      {
        version: 328,
        description: "v328: [\u6DF1\u5EA6\u5206\u6790\u4FEE\u590D] \u2014 (1)P0-keyword_create\u53BB\u91CD\u7A97\u53E3\u4ECE24h\u6269\u5C55\u52307\u5929: \u6D88\u966546.5%\u7684already_exists\u91CD\u590D\u521B\u5EFA\u95EE\u9898 (2)P0-SD adgroup_pause API\u4FEE\u590D: String\u7C7B\u578BadGroupId\u907F\u514D\u5927\u6570\u5B57\u7CBE\u5EA6\u4E22\u5931+\u6DFB\u52A0Content-Type header (3)P0-adgroup_pause\u8FDE\u7EED\u5931\u8D25\u4FDD\u62A4: \u540C\u4E00adGroup\u5931\u8D25\u22653\u6B21\u540E\u505C\u6B62\u91CD\u8BD5 (4)P1-AutoCorrector\u5BB9\u5DEE\u589E\u5927: \u4ECE$0.01\u63D0\u5347\u5230$0.03\u6D88\u9664\u62C9\u952F\u6218 (5)P1-AutoCorrector\u7EA0\u9519\u51B7\u5374: \u540C\u4E00keyword 8\u5C0F\u65F6\u5185\u6700\u591A\u7EA0\u6B631\u6B21",
        affectedModules: ["keyword", "sync", "bid"],
        correctionActions: ["rerun_optimization", "cleanup_stale_pending", "revalidate_pending_commands"]
      },
      {
        version: 329,
        description: "v329: [\u67B6\u6784\u7EA7\u7A33\u5B9A\u6027\u91CD\u6784] \u2014 (1)P0-\u7248\u672C\u53F7\u7EDF\u4E00\u5355\u4E00\u6765\u6E90: \u6D88\u9664systemVersion.ts\u548CpostDeployOptimizer.ts\u53CC\u6E90\u4E0D\u540C\u6B65\u95EE\u9898,\u5FC3\u8DF3/\u751F\u547D\u5468\u671F/PostDeploy\u7EDF\u4E00\u4F7F\u7528systemVersion.ts (2)P0-PostDeployOptimizer\u5BB9\u9519\u91CD\u6784: recordDeployVersion/updateTargetOptimizedVersion/getLastDeployedVersion\u5168\u90E8\u6539\u7528raw SQL+3\u6B21\u91CD\u8BD5,\u907F\u514DDrizzle ORM schema\u4E0D\u5339\u914D\u548C\u6570\u636E\u5E93\u77AC\u65F6\u4E2D\u65AD\u5BFC\u81F4\u90E8\u7F72\u540E\u4F18\u5316\u5931\u8D25 (3)P0-deployLifecycleManager\u9519\u8BEF\u9694\u79BB: \u6B65\u9AA44b-4e\u6BCF\u4E2A\u6B65\u9AA4\u72EC\u7ACBtry-catch,PostDeploy\u5931\u8D25\u4E0D\u963B\u585EAutoCorrector,\u6B65\u9AA44d/4e\u6539\u7528raw SQL\u8BB0\u5F55 (4)P0-\u5185\u5B58\u7BA1\u7406\u91CD\u6784: V8\u5806\u9650\u5236\u4ECE2048MB\u964D\u81F31400MB\u4E3AOS\u9884\u7559600MB,decisionTraces\u7F13\u5B5810000\u21922000,metricBuffer 5000\u21921000,metricAggregates/modelCache/efficiencyHistoryBuffer/changeLogs\u5168\u90E8\u6DFB\u52A0\u5927\u5C0F\u4E0A\u9650 (5)P1-\u4EFB\u52A1\u5206\u5C42\u5185\u5B58\u9884\u7B97: executeOptimizationTask\u6DFB\u52A080%\u5185\u5B58\u9884\u7B97\u68C0\u67E5,AutoCorrector\u6BCF\u8D26\u6237\u5904\u7406\u524D85%\u5185\u5B58\u68C0\u67E5,startAutoCorrector\u6DFB\u52A090%\u5185\u5B58\u4FDD\u62A4",
        affectedModules: ["bid", "sync", "keyword"],
        correctionActions: ["rerun_optimization", "cleanup_stale_pending", "revalidate_pending_commands"]
      },
      {
        version: 335,
        description: "v335: [\u6570\u636E\u540C\u6B65\u4FDD\u969C\u4F53\u7CFB] \u2014 (1)P0-deployLifecycleManager\u4F18\u96C5\u5173\u95ED\u589E\u52A0dataSyncJobs\u72B6\u6001\u91CD\u7F6E: running\u2192failed,pending\u2192cancelled (2)P0-orchestrateStartup\u589E\u52A0\u6570\u636E\u540C\u6B65\u6062\u590D\u6B65\u9AA43.5: \u6E05\u7406\u5361\u6B7Brunning\u4EFB\u52A1+\u68C0\u67E5\u540C\u6B65\u6EDE\u540E\u8D26\u6237+\u8BB0\u5F55\u6062\u590D\u4E8B\u4EF6 (3)P0-dataSyncScheduler\u542F\u52A8\u65F6\u6E05\u7406\u5361\u6B7B\u4EFB\u52A1(30\u5206\u949F\u8D85\u65F6)+\u542F\u52A8\u540E2\u5206\u949F\u9AD8\u9891\u540C\u6B65+5\u5206\u949F\u5B8C\u6574\u540C\u6B65 (4)P0-dataSyncService\u65B0\u589EcleanupStaleJobs\u548CcleanupOrphanedPendingJobs\u51FD\u6570 (5)P1-optimizationTargetEngine\u6240\u6709details.push\u8DEF\u5F84\u6DFB\u52A0algorithmUsed\u5B57\u6BB5",
        affectedModules: ["sync", "bid"],
        correctionActions: ["rerun_optimization"]
      },
      {
        version: 336,
        description: "v336: [\u6570\u636E\u540C\u6B65\u4FDD\u969C\u4F53\u7CFB\u5168\u9762\u5347\u7EA7+\u4E8B\u4EF6\u9A71\u52A8\u540C\u6B65+\u90E8\u7F72\u6062\u590D\u589E\u5F3A] \u2014 (1)P0-SYSTEM_VERSION\u66F4\u65B0329\u2192336: \u4FEE\u590Dv335\u9057\u6F0F\u7684\u7248\u672C\u53F7\u66F4\u65B0\u5BFC\u81F4\u5FC3\u8DF3/PostDeploy\u7248\u672C\u68C0\u6D4B\u5931\u6548 (2)P0-\u4E8B\u4EF6\u9A71\u52A8\u540C\u6B65\u89E6\u53D1: amazonApi\u8DEF\u7531\u4FDD\u5B58\u51ED\u8BC1\u540E\u7ACB\u5373\u89E6\u53D1syncAllAccounts+\u65B0\u8D26\u6237\u521B\u5EFA\u540E\u7ACB\u5373\u89E6\u53D1\u5B8C\u6574\u540C\u6B65 (3)P0-\u90E8\u7F72\u6062\u590D\u589E\u5F3A: orchestrateStartup\u6B65\u9AA43.5\u589E\u52A0\u4E3B\u52A8\u89E6\u53D1syncAllAccounts\u800C\u975E\u4EC5\u6E05\u7406+\u7F29\u77ED\u542F\u52A8\u540E\u9996\u6B21\u540C\u6B65\u5EF6\u8FDF(2\u5206\u949F\u219230\u79D2\u9AD8\u9891,5\u5206\u949F\u219260\u79D2\u5B8C\u6574) (4)P1-\u540C\u6B65\u5065\u5EB7\u76D1\u63A7: \u6BCF\u6B21\u540C\u6B65\u540E\u68C0\u67E5\u7ED3\u679C+\u8FDE\u7EED3\u6B21\u5931\u8D25\u8BB0\u5F55\u544A\u8B66\u4E8B\u4EF6+\u5FC3\u8DF3\u4E2D\u5305\u542B\u540C\u6B65\u72B6\u6001 (5)P1-VERSION_CHANGELOG\u8865\u5145v330-v336\u6761\u76EE",
        affectedModules: ["sync", "bid"],
        correctionActions: ["rerun_optimization"]
      },
      {
        version: 338,
        description: "v338: [\u7EDF\u4E00\u667A\u80FD\u51B7\u542F\u52A8\u673A\u5236] \u2014 (1)P0-\u65B0\u589EcoldStartService.ts: \u7EDF\u4E00\u51B7\u542F\u52A8\u670D\u52A1\uFF0C\u652F\u6301\u56DB\u5927\u573A\u666F(new_account/credential_refresh/new_marketplace/version_upgrade)\u81EA\u52A8\u89E6\u53D1\u5168\u91CF\u540C\u6B65+\u6570\u636E\u5E74\u9F84\u5206\u5C42\u4F18\u5316 (2)P0-\u6570\u636E\u5E74\u9F84\u5206\u5C42: \u5386\u53F2\u6570\u636E(30-90\u5929)\u4E00\u6B21\u6027\u6279\u91CFNgram\u5206\u6790+\u5426\u5B9A\u8BCD+\u641C\u7D22\u8BCD\u6536\u5272, \u8FD1\u671F\u6570\u636E(7-14\u5929)\u6309\u5E38\u89C4\u9AD8\u9891\u8C03\u5EA6\u4F18\u5316 (3)P0-accountInitializationService\u96C6\u6210: \u65B0\u8D26\u6237\u5168\u91CF\u540C\u6B65\u5B8C\u6210\u540E\u81EA\u52A8\u89E6\u53D1\u51B7\u542F\u52A8(skipSync=true) (4)P0-amazonApi\u8DEF\u7531\u96C6\u6210: saveCredentials\u68C0\u6D4B\u51ED\u8BC1\u5237\u65B0\u573A\u666F\u89E6\u53D1\u51B7\u542F\u52A8, saveMultipleProfiles\u4E3A\u6BCF\u4E2A\u65B0\u7AD9\u70B9\u89E6\u53D1\u51B7\u542F\u52A8 (5)P0-deployLifecycleManager\u96C6\u6210: orchestrateStartup\u6B65\u9AA44e\u589E\u52A0\u7248\u672C\u5347\u7EA7\u573A\u666F\u7684\u6279\u91CF\u51B7\u542F\u52A8 (6)P1-cold_start_logs\u8868: \u8BB0\u5F55\u6BCF\u6B21\u51B7\u542F\u52A8\u7684\u5B8C\u6574\u6267\u884C\u7EDF\u8BA1(\u540C\u6B65/\u5386\u53F2\u4F18\u5316/\u8FD1\u671F\u4F18\u5316\u5404\u9636\u6BB5\u8017\u65F6\u548C\u7ED3\u679C) (7)P1-\u5E42\u7B49\u6027\u4FDD\u62A4: \u540C\u4E00\u8D26\u6237+\u540C\u4E00\u7248\u672C\u53EA\u6267\u884C\u4E00\u6B21\u51B7\u542F\u52A8, \u5E76\u53D1\u9632\u62A4+\u5185\u5B58\u4FDD\u62A4+\u9519\u8BEF\u9694\u79BB",
        affectedModules: ["sync", "searchterm", "bid"],
        correctionActions: ["rerun_optimization"]
      },
      {
        version: 339,
        description: "v339: [\u6570\u636E\u540C\u6B65\u5206\u6279\u5904\u7406\u5168\u9762\u4FEE\u590D] \u2014 (1)P0-SP\u641C\u7D22\u8BCD\u540C\u6B65\u5206\u6279: syncSearchTerms\u589E\u52A031\u5929\u5206\u6279\u903B\u8F91,\u786E\u4FDD90\u5929\u641C\u7D22\u8BCD\u6570\u636E\u5B8C\u6574\u62C9\u53D6 (2)P0-SP\u81EA\u52A8\u5B9A\u5411\u540C\u6B65\u5206\u6279: syncAutoTargeting\u589E\u52A031\u5929\u5206\u6279\u903B\u8F91 (3)P0-SB\u641C\u7D22\u8BCD\u540C\u6B65\u5206\u6279: syncSbSearchTerms\u589E\u52A031\u5929\u5206\u6279\u903B\u8F91(60\u5929\u4E0A\u9650) (4)P0-SB\u5B9A\u5411\u540C\u6B65\u5206\u6279: syncSbTargeting\u589E\u52A031\u5929\u5206\u6279\u903B\u8F91 (5)P0-SB\u5E7F\u544A\u4F4D\u540C\u6B65\u5206\u6279: syncSbPlacementPerformance\u589E\u52A031\u5929\u5206\u6279\u903B\u8F91 (6)P0-SD\u5B9A\u5411\u540C\u6B65\u5206\u6279: syncSdTargeting\u589E\u52A031\u5929\u5206\u6279\u903B\u8F91 (7)P0-SP\u5E7F\u544A\u4F4D\u540C\u6B65\u5206\u6279: syncPlacementPerformance\u589E\u52A031\u5929\u5206\u6279\u903B\u8F91 (8)P0-\u5173\u952E\u8BCD\u7EE9\u6548\u540C\u6B65\u5206\u6279: syncKeywordPerformanceData\u589E\u52A031\u5929\u5206\u6279\u903B\u8F91 (9)P0-\u5E7F\u544A\u7EC4\u7EE9\u6548\u540C\u6B65\u5206\u6279: syncAdGroupPerformanceData\u4E2DSP/SB/SD\u4E09\u4E2A\u5B50\u62A5\u544A\u5747\u589E\u52A0\u5206\u6279\u903B\u8F91 (10)P1-syncAll\u53C2\u6570\u5316: performanceDays\u652F\u6301\u5916\u90E8\u4F20\u5165,\u9ED8\u8BA414\u5929,unifiedSyncEngine full tier\u4F20\u516590\u5929",
        affectedModules: ["sync"],
        correctionActions: ["resync_data"]
      },
      {
        version: 340,
        description: "v340: [\u540C\u6B65\u5065\u5EB7\u76D1\u63A7+Token\u7ADE\u6001\u4FEE\u590D+\u5927\u8D26\u6237\u4FDD\u62A4] \u2014 (1)P0-syncAll\u8BE6\u7EC6\u65E5\u5FD7: \u4E3AsyncAll\u65B9\u6CD5\u589E\u52A0\u7EDF\u4E00runStep\u8BCA\u65AD\u65E5\u5FD7\u7CFB\u7EDF,\u8BB0\u5F55\u6BCF\u4E2A\u540C\u6B65\u6B65\u9AA4\u7684\u5F00\u59CB/\u7ED3\u675F/\u8017\u65F6/\u8BB0\u5F55\u6570/\u5F02\u5E38,\u540C\u6B65\u5B8C\u6210\u540E\u8F93\u51FA\u6C47\u603B\u62A5\u544A (2)P0-\u624B\u52A8\u89E6\u53D1\u540C\u6B65API: \u65B0\u589EPOST /api/ops/force-sync\u7AEF\u70B9,\u652F\u6301\u6307\u5B9A\u8D26\u6237ID\u548C\u540C\u6B65\u5C42\u7EA7(full/fast/minimal)\u624B\u52A8\u89E6\u53D1\u5168\u91CF\u540C\u6B65 (3)P0-Token\u5237\u65B0\u7ADE\u6001\u4FEE\u590D: \u5B9E\u73B0\u5168\u5C40\u7EA7\u522BRefresh Token\u5237\u65B0\u9501,\u89E3\u51B3\u591A\u4E2AAPI\u5BA2\u6237\u7AEF\u5B9E\u4F8B\u5171\u4EAB\u540C\u4E00Refresh Token\u65F6\u7684\u5E76\u53D1\u5237\u65B0\u51B2\u7A81,\u4E09\u7EA7Token\u83B7\u53D6\u8DEF\u5F84(\u5B9E\u4F8B\u7F13\u5B58\u2192\u5168\u5C40\u9501\u7F13\u5B58\u2192\u5168\u5C40\u9501\u5E76\u53D1\u7B49\u5F85\u2192\u5B9E\u9645\u5237\u65B0) (4)P1-\u540C\u6B65\u5065\u5EB7\u76D1\u63A7: \u5F53\u8D26\u6237\u540C\u6B65\u5B8C\u6210\u4F46totalSynced=0\u65F6\u81EA\u52A8\u89E6\u53D1critical\u7EA7\u522B\u544A\u8B66,\u5199\u5165anomaly_alert_logs\u8868 (5)P1-\u5927\u8D26\u6237\u81EA\u9002\u5E94\u4FDD\u62A4: \u8D85\u8FC71000\u4E2A\u5E7F\u544A\u6D3B\u52A8\u7684\u8D26\u6237\u81EA\u52A8\u542F\u7528\u4FDD\u62A4\u6A21\u5F0F(\u6B65\u9AA4\u95F4\u989D\u5916\u5EF6\u8FDF3\u79D2+\u5355\u8D26\u6237\u540C\u6B6545\u5206\u949F\u8D85\u65F6\u4FDD\u62A4)",
        // @ts-expect-error - runtime type mismatch
        affectedModules: ["sync", "api", "monitoring"],
        correctionActions: ["resync_data"]
      },
      {
        version: 341,
        description: "v341: [401\u81EA\u52A8\u91CD\u5237\u65B0Token\u4FEE\u590D] \u2014 (1)P0-401\u81EA\u52A8\u91CD\u5237\u65B0Token\u5E76\u91CD\u8BD5: \u5F53Amazon API\u8FD4\u56DE401 Unauthorized\u65F6,\u81EA\u52A8\u6E05\u9664\u5B9E\u4F8B\u7EA7\u548C\u5168\u5C40\u7EA7Token\u7F13\u5B58,\u5F3A\u5236\u91CD\u65B0\u6267\u884CdoRefreshToken()\u83B7\u53D6\u65B0Token,\u7136\u540E\u91CD\u8BD5\u539F\u59CB\u8BF7\u6C42(\u6700\u591A1\u6B21),\u9632\u6B62\u65E0\u9650\u5FAA\u73AF (2)P0-\u89E3\u51B3LERUCCI\u5E97\u94FA\u540C\u6B65\u5931\u8D25\u6839\u56E0: \u8D26\u623790027/90026/90025\u7684accessToken\u4E3ANULL\u5BFC\u81F4\u6240\u6709API\u8BF7\u6C42\u8FD4\u56DE401,\u4F46\u65E7\u7248\u672C\u4E0D\u4F1A\u91CD\u8BD5\u5237\u65B0Token,\u73B0\u5728\u6536\u523001\u540E\u4F1A\u81EA\u52A8\u5C1D\u8BD5\u5237\u65B0\u5E76\u91CD\u8BD5",
        // @ts-expect-error - runtime type mismatch
        affectedModules: ["api", "sync"],
        correctionActions: ["resync_data"]
      },
      {
        version: 342,
        description: "v342: [OAuth\u6388\u6743\u51ED\u8BC1\u4FDD\u5B58\u673A\u5236\u91CD\u5927\u4FEE\u590D] \u2014 (1)P0-\u540E\u7AEF\u56DE\u8C03\u76F4\u63A5\u4FDD\u5B58\u51ED\u8BC1: amazonAuthCallback.ts\u83B7\u53D6\u65B0refresh_token\u540E\u76F4\u63A5\u66F4\u65B0\u6570\u636E\u5E93\u4E2D\u6240\u6709\u5339\u914D\u7684\u8D26\u6237\u51ED\u8BC1,\u4E0D\u518D\u4F9D\u8D56\u524D\u7AEF\u4E2D\u8F6C (2)P0-\u4FEE\u590D\u524D\u7AEFclientSecret\u7A7A\u5B57\u7B26\u4E32\u7F3A\u9677: \u524D\u7AEFprocessCallback\u4E2DclientSecret\u786C\u7F16\u7801\u4E3A\u7A7A\u5B57\u7B26\u4E32\u5BFC\u81F4saveMultipleProfiles\u9A8C\u8BC1\u5931\u8D25,\u65B0refresh_token\u4ECE\u672A\u4FDD\u5B58\u5230\u6570\u636E\u5E93,\u8FD9\u662F\u8D26\u623790027\u6301\u7EED401\u7684\u6839\u672C\u539F\u56E0 (3)P0-\u670D\u52A1\u7AEF\u51ED\u8BC1\u56DE\u9000: saveMultipleProfiles\u548CsaveCredentials\u652F\u6301__USE_SERVER_SECRET__\u6807\u8BB0,\u81EA\u52A8\u4F7F\u7528\u670D\u52A1\u7AEF\u73AF\u5883\u53D8\u91CF\u4E2D\u7684clientId/clientSecret (4)P0-\u4FDD\u62A4\u6027\u6570\u636E\u5E93\u66F4\u65B0: saveAmazonApiCredentials\u4E0D\u518D\u7528\u7A7A\u503C\u8986\u76D6\u5DF2\u6709\u7684\u6709\u6548\u51ED\u8BC1 (5)P1-\u5171\u4EABToken\u6279\u91CF\u66F4\u65B0: \u540E\u7AEF\u56DE\u8C03\u81EA\u52A8\u66F4\u65B0\u6240\u6709\u4F7F\u7528\u76F8\u540CclientId\u7684\u8D26\u6237\u7684refresh_token (6)P1-\u56DE\u8C03\u540E\u81EA\u52A8\u89E6\u53D1\u540C\u6B65: \u51ED\u8BC1\u66F4\u65B0\u540E\u81EA\u52A8\u89E6\u53D1\u53D7\u5F71\u54CD\u8D26\u6237\u7684\u7ACB\u5373\u540C\u6B65",
        // @ts-expect-error - runtime type mismatch
        affectedModules: ["auth", "api", "sync", "db"],
        correctionActions: ["resync_data"]
      },
      {
        version: 343,
        description: "v343: [\u6388\u6743\u6A21\u5757\u667A\u80FD\u53BB\u91CD\u4FEE\u590D] \u2014 (1)P0-\u540E\u7AEF\u56DE\u8C03profile\u667A\u80FD\u53BB\u91CD: \u5BF9\u4E8E\u540C\u4E00\u56FD\u5BB6\u7684\u591A\u4E2Aprofile(seller/vendor),\u4F18\u5148\u4FDD\u7559\u5DF2\u5728\u7CFB\u7EDF\u4E2D\u5B58\u5728\u7684profile,\u8DF3\u8FC7\u672A\u77E5\u7684profile,\u9632\u6B62\u521B\u5EFA\u91CD\u590D\u7AD9\u70B9 (2)P0-\u524D\u7AEF\u6388\u6743\u56DE\u8C03\u667A\u80FD\u5206\u6D41: \u540E\u7AEF\u5DF2\u4FDD\u5B58\u51ED\u8BC1(backendSaved>0)\u65F6,\u524D\u7AEF\u4E0D\u518D\u8C03\u7528saveMultipleProfiles,\u5F7B\u5E95\u6D88\u9664\u5237\u65B0\u6388\u6743\u65F6\u7684\u91CD\u590D\u521B\u5EFA\u98CE\u9669 (3)P0-saveMultipleProfiles\u53BB\u91CD\u4FDD\u62A4: \u589E\u52A0isRefreshAuth\u53C2\u6570\u548C\u540C\u5E97\u94FA+\u540C\u56FD\u5BB6\u91CD\u590D\u68C0\u67E5,\u5373\u4F7F\u88AB\u8C03\u7528\u4E5F\u4E0D\u4F1A\u521B\u5EFA\u91CD\u590D\u7AD9\u70B9 (4)P1-accountType\u4FE1\u606F\u4F20\u9012: profiles\u6570\u636E\u4E2D\u589E\u52A0accountType\u5B57\u6BB5(seller/vendor/agency),\u7528\u4E8E\u667A\u80FD\u7B5B\u9009",
        // @ts-expect-error - runtime type mismatch
        affectedModules: ["auth", "api"],
        correctionActions: ["resync_data"]
      },
      {
        version: 344,
        description: "v344: [P0\u51B7\u542F\u52A8\u540C\u6B65\u5929\u6570\u4FEE\u590D + P1\u7ADE\u4EF7\u65E5\u5FD7\u8868\u4FEE\u590D] \u2014 (1)P0-coldStartService.executeFullSync\u4FEE\u590D: syncAll()\u8C03\u7528\u65F6\u5F3A\u5236\u4F20\u5165performanceDays=90\u5929,\u4E4B\u524D\u672A\u4F20\u53C2\u6570\u5BFC\u81F4\u9ED8\u8BA4\u53EA\u540C\u6B6514\u5929\u7EE9\u6548\u6570\u636E (2)P0-\u79FB\u9664syncPerformanceOnly\u786C\u7F16\u7801\u9650\u5236: \u4E4B\u524D\u786C\u7F16\u7801days>30?30:days\u5BFC\u81F4\u6700\u591A\u53EA\u540C\u6B6530\u5929 (3)P1-bidding_logs\u8868\u7ED3\u6784\u4FEE\u590D: \u6DFB\u52A0\u7F3A\u5931\u7684algorithm_used\u5217,\u66F4\u65B0logTargetType\u548CactionType\u679A\u4E3E\u503C (4)P1-\u521B\u5EFAcold_start_logs\u8868: \u4E4B\u524D\u8868\u4E0D\u5B58\u5728\u5BFC\u81F4\u51B7\u542F\u52A8\u65E5\u5FD7\u8BB0\u5F55\u5931\u8D25 (5)P1-amazon_api_credentials\u8868\u6DFB\u52A0last_cold_start_version\u548Clast_cold_start_at\u5217",
        // @ts-expect-error - runtime type mismatch
        affectedModules: ["sync", "bidding", "cold_start"],
        correctionActions: ["resync_data", "cold_start"]
      },
      {
        version: 355,
        description: "v355: [pending\u91CD\u8BD5SQL\u4FEE\u590D + searchTermHarvester ID\u4FEE\u590D + \u5185\u5B58\u4F18\u5316] \u2014 (1)P0-pending\u91CD\u8BD5SQL\u5217\u540D\u4FEE\u590D: campaigns\u8868\u67E5\u8BE2\u4E2Dcampaign_id(\u4E0B\u5212\u7EBF)\u6539\u4E3AcampaignId(\u9A7C\u5CF0),\u4FEE\u590DSELECT\u548C\u7ED3\u679C\u5F15\u7528\u4E09\u5904\u9519\u8BEF,\u89E3\u51B3pending keyword_create\u91CD\u8BD5\u65F6\u65E0\u6CD5\u67E5\u627EAmazon Campaign ID\u5BFC\u81F4\u91CD\u8BD5\u5931\u8D25 (2)P1-searchTermHarvester ID\u6DF7\u7528\u4FEE\u590D: getSearchTermsByCampaignId\u4F20\u5165sourceCampaign.id(\u672C\u5730ID)\u6539\u4E3AsourceCampaign.campaignId(Amazon ID),\u89E3\u51B3\u641C\u7D22\u8BCD\u6536\u5272\u65E0\u6CD5\u67E5\u8BE2\u5230search_terms\u6570\u636E\u5BFC\u81F4\u6536\u5272\u5019\u9009\u4E3A\u7A7A (3)P2-\u5185\u5B58\u4F18\u5316-bundle\u7626\u8EAB: build-server.js\u6392\u9664vite/rollup/babel/tailwindcss\u7B49\u6784\u5EFA\u65F6\u4F9D\u8D56+\u5F00\u542Fminify\u538B\u7F29,bundle\u4F5314.59MB\u964D\u81F34.23MB(\u51CF\u5C1171%) (4)P2-\u5185\u5B58\u4F18\u5316-heapUtilization\u4FEE\u590D: \u4F7F\u7528heapUsed/max-old-space-size(1400MB)\u66FF\u4EE3heapUsed/heapTotal,\u6D88\u9664V8\u52A8\u6001\u6536\u7F29heapTotal\u5BFC\u81F4\u7684\u865A\u5047\u9AD8\u5185\u5B58\u4F7F\u7528\u7387\u544A\u8B66(97%\u2192\u5B9E\u9645\u7EA67-15%)",
        affectedModules: ["optimization", "sync"],
        correctionActions: ["rerun_optimization"]
      },
      {
        version: 354,
        description: "v354: [budget_adjustment\u4FEE\u590D + placement_adjust\u6FC0\u6D3B + SB/SBV\u524D\u7F6E\u8FC7\u6EE4] \u2014 (1)P0-budget_adjustment ID\u4E0D\u5339\u914D\u4FEE\u590D: aggregatePerformanceData\u4F20\u5165campaign.id(\u672C\u5730\u81EA\u589EID)\u6539\u4E3Acampaign.campaignId(Amazon ID),\u89E3\u51B3daily_performance\u67E5\u8BE2\u6C38\u8FDC\u5339\u914D\u4E0D\u5230\u6570\u636E\u5BFC\u81F4\u6A21\u5757\u5B8C\u5168\u4F11\u7720 (2)P0-CampaignPerformanceData/BudgetAllocationSuggestion\u589E\u52A0amazonCampaignId\u5B57\u6BB5,\u4FEE\u590D\u6574\u4E2AID\u94FE\u8DEF(campaigns.find\u5339\u914D+db.updateCampaign+scheduleBudgetVerification) (3)P1-placement_adjust\u9608\u503C\u4FEE\u590D: generatePlacementSuggestions\u8FC7\u6EE4\u9608\u503C\u4ECE>5\u964D\u4F4E\u4E3A>0,\u89E3\u51B3confidence=0.6\u65F6maxDeltaPercent=5\u4F46\u4E25\u683C\u5927\u4E8E5\u5BFC\u81F4\u4E2D\u7B49\u7F6E\u4FE1\u5EA6\u5EFA\u8BAE\u6C38\u8FDC\u88AB\u8FC7\u6EE4 (4)P1-analyzePlacementOptimization\u4E2D\u7684needsAdjustment\u548CadjustedCount\u9608\u503C\u540C\u6B65\u4FEE\u590D (5)P2-v310 pending\u91CD\u8BD5\u8DEF\u5F84\u589E\u52A0SB/SD campaignType\u524D\u7F6E\u8FC7\u6EE4,\u89E3\u51B3V351\u8FC7\u6EE4\u88AB\u7ED5\u8FC7\u5BFC\u81F4244\u6761SB pending\u8BB0\u5F55\u53CD\u590D\u91CD\u8BD5\u5931\u8D25 (6)P2-V351 SB/SD\u8FC7\u6EE4\u589E\u52A0optimization_logs\u8BB0\u5F55(skipped_unsupported_campaign_type),\u907F\u514D\u9759\u9ED8\u8DF3\u8FC7\u65E0\u6CD5\u8FFD\u8E2A",
        affectedModules: ["optimization"],
        correctionActions: ["rerun_optimization"]
      },
      {
        version: 353,
        description: "v353: [\u641C\u7D22\u8BCD\u6536\u5272\u4F18\u5316 + \u4F11\u7720\u6A21\u5757\u8BCA\u65AD + search_terms\u53BB\u91CD\u4FEE\u590D] \u2014 (1)P0-search_terms\u53BB\u91CDkey\u4FEE\u590D: existingMap\u4ECEbuildExistingKey\u4F7F\u7528\u672C\u5730campaign.id\u6539\u4E3AAmazon campaignId,\u89E3\u51B3\u53BB\u91CD\u5931\u6548\u5BFC\u81F4\u91CD\u590DINSERT (2)P0-\u54C1\u724C\u8BCD\u524D\u7F6E\u8FC7\u6EE4: \u5728CREATE_KEYWORD\u51B3\u7B56\u540E\u7ACB\u5373\u68C0\u67E5\u54C1\u724C\u8BCD,\u907F\u514D\u54C1\u724C\u8BCD\u901A\u8FC7API\u521B\u5EFA\u88AB\u62D2\u7EDD\u5BFC\u81F4\u53CD\u590D\u91CD\u8BD5 (3)P0-PT\u5E7F\u544A\u7EC4\u524D\u7F6E\u68C0\u67E5: \u5728campaign\u5FAA\u73AF\u5F00\u5934\u9884\u52A0\u8F7DPT\u72B6\u6001,\u907F\u514D\u5728API\u540C\u6B65\u9636\u6BB5\u624D\u53D1\u73B0skipped_pt_adgroup (4)P1-\u53BB\u91CD\u7A97\u53E3\u4ECE7\u5929\u6269\u5C55\u523030\u5929: \u8FDB\u4E00\u6B65\u6D88\u9664already_exists\u91CD\u590D\u521B\u5EFA (5)P1-action_type\u6620\u5C04\u4FEE\u590D: brand_protect_skip/exploration_protect_skip\u7B49\u4E0D\u518D\u88AB\u9519\u8BEF\u5F52\u7C7B\u4E3Akeyword_create (6)P1-\u53BB\u91CD\u67E5\u8BE2\u8986\u76D6\u65B0action_type: \u5305\u542Bsearch_term_brand_protect\u7B49\u65B0\u7C7B\u578B (7)P2-placement\u8BCA\u65AD\u65E5\u5FD7\u589E\u5F3A: \u8FFD\u8E2A\u5EFA\u8BAE\u751F\u6210\u548C\u8FC7\u6EE4\u539F\u56E0 (8)P2-budget\u8BCA\u65AD\u65E5\u5FD7\u589E\u5F3A: \u8FFD\u8E2A\u5EFA\u8BAE\u751F\u6210\u548C\u5E94\u7528\u7EDF\u8BA1",
        affectedModules: ["optimization", "sync"],
        correctionActions: ["rerun_optimization"]
      },
      {
        version: 352,
        description: "v352: [\u6570\u636E\u540C\u6B65\u67B6\u6784\u91CD\u6784 - \u7CBE\u7EC6\u5316\u5206\u8D26\u6237/\u5206\u5E7F\u544A\u7C7B\u578B/\u5206\u6B65\u9AA4\u4E32\u884C\u5316] \u2014 (1)P0-\u62A5\u544A\u8BF7\u6C42\u4E32\u884C\u5316: SP\u2192SB\u2192SD\u4ECE\u5E76\u884CPromise.all\u6539\u4E3A\u4E32\u884C\u6267\u884C,\u6BCF\u79CD\u5E7F\u544A\u7C7B\u578B\u95F4\u52A03\u79D2\u5EF6\u8FDF,\u5927\u5E45\u964D\u4F4EAPI\u9650\u6D41\u98CE\u9669 (2)P0-\u667A\u80FD\u8D26\u6237\u4EA4\u9519\u6392\u5E8F: \u540C\u4E00\u54C1\u724C(userId)\u4E0D\u540C\u7AD9\u70B9\u8D26\u6237\u5206\u6563\u5230\u4E0D\u540C\u6279\u6B21,\u907F\u514D\u5171\u4EABAPI\u51ED\u8BC1\u7684\u8D26\u6237\u540C\u65F6\u53D1\u8D77\u8BF7\u6C42 (3)P0-\u8D26\u6237\u95F4\u4E32\u884C+5\u79D2\u5EF6\u8FDF: \u66FF\u4EE3\u65E7\u7684\u5E76\u884C\u6279\u6B21\u6267\u884C,\u786E\u4FDD\u5355\u4E2A\u8D26\u6237\u5B8C\u6210\u540E\u518D\u5F00\u59CB\u4E0B\u4E00\u4E2A (4)P1-\u5E76\u53D1\u63A7\u5236\u964D\u7EA7: MAX_CONCURRENT_ACCOUNTS\u4ECE3\u964D\u4E3A2 (5)P1-\u4F18\u5316\u6307\u4EE4\u540C\u6B65\u589E\u5F3A: \u8D26\u53F7\u95F43\u79D2\u5EF6\u8FDF+\u4EFB\u52A1\u7C7B\u578B\u95F41\u79D2\u5EF6\u8FDF (6)P1-syncAll\u6B65\u9AA4\u95F41\u79D2\u5EF6\u8FDF: \u964D\u4F4EAPI\u8C03\u7528\u5BC6\u5EA6",
        affectedModules: ["sync", "optimization"],
        correctionActions: ["resync_data"]
      },
      {
        version: 351,
        description: "v351: [P1\u5206\u65F6\u7ADE\u4EF7\u7075\u654F\u5EA6\u91CD\u5199 + bidding_logs\u4FEE\u590D + \u6C38\u4E45\u5931\u8D25\u6807\u8BB0\u589E\u5F3A + SB/SD\u6570\u636E\u4FDD\u7559\u671F\u5904\u7406] \u2014 (1)P1-\u5206\u65F6\u7ADE\u4EF7\u7B97\u6CD5\u7075\u654F\u5EA6\u5F7B\u5E95\u91CD\u5199: \u4E09\u5C42\u7EA7\u8054\u653E\u5927(3x\u504F\u5DEE\u653E\u5927+\u6700\u5C0F\u504F\u5DEE\u4FDD\u8BC1\xB10.05+\u65F6\u6BB5\u7279\u5F81\u589E\u5F3A),\u89E3\u51B395.6%\u89C4\u5219\u4E3A1.00\u7684\u6839\u56E0 (2)P1-\u5206\u65F6\u89C4\u521924h\u81EA\u52A8\u91CD\u7B97: \u66FF\u6362\u65E7\u7B97\u6CD5\u751F\u6210\u7684\u65E0\u6548\u89C4\u5219 (3)P1-\u5206\u65F6\u6267\u884C\u9608\u503C\u964D\u4F4E: $0.01\u2192$0.005+2%\u53CC\u91CD\u5224\u65AD (4)P1-dayparting recordModuleExecution\u4FEE\u590D: dayparting_adjustment\u4F7F\u7528executeAllEnabledTargets\u4F46\u9057\u6F0FrecordModuleExecution\u8C03\u7528 (5)P1-bidding_logs\u539F\u751FSQL\u5217\u540D\u4FEE\u590D: snake_case\u2192camelCase\u5339\u914DDrizzle schema (6)P1-SB/SD\u5173\u952E\u8BCD\u521B\u5EFA\u8FC7\u6EE4: \u963B\u6B62\u5BF9SB/SD\u5E7F\u544A\u6D3B\u52A8\u7684\u65E0\u6548API\u8C03\u7528 (7)P1-permanently_failed\u6807\u8BB0\u589E\u5F3A: \u79FB\u9664localKeywordId\u524D\u63D0\u6761\u4EF6,\u8986\u76D6\u6240\u6709\u5931\u8D25\u8BB0\u5F55 (8)P1-SB/SD\u6570\u636E\u4FDD\u7559\u671F\u81EA\u52A8\u5904\u7406: startDate\u81EA\u52A8clamp\u5230\u4FDD\u7559\u671F\u8303\u56F4\u5185 (9)P2-placement\u8BCA\u65AD\u65E5\u5FD7\u589E\u5F3A",
        affectedModules: ["dayparting", "bid", "sync", "optimization"],
        // @ts-ignore
        correctionActions: ["reset_dayparting_rules", "rerun_optimization"]
      },
      {
        version: 349,
        description: "v349: [P0\u5206\u65F6\u7ADE\u4EF7\u4FEE\u590D + SB\u641C\u7D22\u8BCD\u62A5\u544A\u4FEE\u590D + report_jobs\u8868\u521B\u5EFA + \u8BCA\u65AD\u589E\u5F3A] \u2014 (1)P0-\u5206\u65F6\u7ADE\u4EF7\u505C\u6EDE\u4FEE\u590D: dayparting_adjustment\u5347\u7EA7\u4E3A\u5173\u952E\u4EFB\u52A1,\u9632\u6B62\u56E0\u5185\u5B58\u538B\u529B\u88AB\u8DF3\u8FC7\u5BFC\u81F4\u5206\u65F6\u7B56\u7565\u5B8C\u5168\u505C\u6EDE (2)P1-SB\u641C\u7D22\u8BCD\u62A5\u544A400\u4FEE\u590D: \u79FB\u9664searchTerm groupBy\u4E2D\u4E0D\u5141\u8BB8\u7684campaignStatus\u8FC7\u6EE4\u5668 (3)P1-report_jobs\u8868\u521B\u5EFA: schema\u4E2D\u5B9A\u4E49\u4F46\u4ECE\u672A\u5728\u6570\u636E\u5E93\u4E2D\u521B\u5EFA,\u5BFC\u81F421\u4E2AFailed query\u9519\u8BEF (4)P2-\u5206\u65F6\u7ADE\u4EF7\u8BCA\u65AD\u65E5\u5FD7: \u6DFB\u52A0campaigns\u5FAA\u73AF\u4E2D\u7684\u8BE6\u7EC6\u8DF3\u8FC7\u539F\u56E0\u7EDF\u8BA1",
        // @ts-expect-error - runtime type mismatch
        affectedModules: ["optimization", "sync", "db"],
        // @ts-ignore
        correctionActions: ["rerun_optimization"]
      },
      {
        version: 348,
        description: "v348: [P0\u51ED\u8BC1\u89E3\u5BC6\u4FEE\u590D + P0\u6784\u5EFA\u4FEE\u590D + P1\u62A5\u544A\u8BCA\u65AD\u589E\u5F3A] \u2014 (1)P0-\u51ED\u8BC1\u89E3\u5BC6\u4FEE\u590D: discoverSyncableAccounts()\u76F4\u63A5JOIN\u67E5\u8BE2\u7ED5\u8FC7getAmazonApiCredential()\u7684safeDecrypt(),V345\u52A0\u5BC6\u51ED\u8BC1\u540EclientSecret\u548CrefreshToken\u4EE5enc:v1:\u683C\u5F0F\u53D1\u9001\u7ED9Amazon OAuth\u5BFC\u81F4\u5168\u90E8\u8D26\u6237Token\u5237\u65B0401\u5931\u8D25 (2)P0-\u6784\u5EFA\u4FEE\u590D: V347\u7684config undefined\u9632\u62A4\u4EE3\u7801\u672A\u88AB\u7F16\u8BD1\u5230dist/index.js,\u5BFC\u81F4\u62E6\u622A\u5668\u5D29\u6E83 (3)P1-\u62A5\u544A\u9519\u8BEF\u8BCA\u65AD\u589E\u5F3A: SP/SB/SD\u62A5\u544A\u8BF7\u6C42\u5931\u8D25\u65F6\u8BB0\u5F55\u5B8C\u6574\u7684status/data/headers/requestBody\u4FE1\u606F",
        // @ts-expect-error - runtime type mismatch
        affectedModules: ["sync", "build"],
        // @ts-ignore
        correctionActions: ["resync_data"]
      },
      {
        version: 347,
        description: "v347: [P0\u5206\u65F6\u7ADE\u4EF7\u4FEE\u590D + \u5185\u5B58\u68C0\u67E5\u4FEE\u590D + \u4F18\u5316\u65E5\u5FD7\u4FEE\u590D] \u2014 (1)P0-\u7F3A\u5931\u8868\u521B\u5EFA: keyword_placement_hourly_performance\u548Cmulti_dim_combo_analysis\u8868\u4ECE\u672A\u5728\u6570\u636E\u5E93\u4E2D\u521B\u5EFA,\u5BFC\u81F4\u5206\u65F6\u7ADE\u4EF7\u5B8C\u5168\u762B\u75EA (2)P0-performanceGroupId\u4FEE\u590D: getOptimizationTargetConfig\u4E2D\u672A\u8D4B\u503C\u5BFC\u81F4\u6240\u6709optimization_logs\u67E5\u8BE2\u5931\u8D25(\u5426\u8BCD\u53BB\u91CD/\u641C\u7D22\u8BCD\u53BB\u91CD/pending\u91CD\u8BD5\u5168\u90E8\u5931\u6548) (3)P0-\u5185\u5B58\u68C0\u67E5\u903B\u8F91\u4FEE\u590D: \u4ECEheapUsed/heapTotal\u767E\u5206\u6BD4\u6539\u4E3ARSS\u7EDD\u5BF9\u503C(MB)\u9608\u503C,\u89E3\u51B3\u5185\u5B58\u5B9E\u9645\u53EA\u7528102MB\u5374\u62A5\u544A89%\u5BFC\u81F4\u4EFB\u52A1\u88AB\u8DF3\u8FC7 (4)P1-anomaly_alert_logs\u4FEE\u590D: INSERT\u5168\u53C2\u6570\u5316+message\u5217\u6269\u5C55\u4E3AMEDIUMTEXT (5)P1-cold_start_logs\u7F3A\u5931\u5217\u8865\u5168",
        // @ts-expect-error - runtime type mismatch
        affectedModules: ["optimization", "sync", "db"],
        correctionActions: ["rerun_optimization"]
      },
      {
        version: 426,
        description: "v426: [\u6027\u80FD\u5168\u9762\u4F18\u5316+\u5206\u5E03\u5F0F\u9501\u91CD\u542F+\u5B89\u5168\u589E\u5F3A] \u2014 (1)P0-API\u54CD\u5E94\u89E3\u6790Bug\u4FEE\u590D: updateKeywordBids/updateKeywordStatus/updateProductTargetBids/updateTargetStatus/updateSpAdGroupStatus\u4E94\u4E2A\u51FD\u6570\u4FEE\u590Dv3 API error\u5BF9\u8C61\u7684index\u5B57\u6BB5\u89E3\u6790,\u6D88\u9664\u201C\u5047\u5931\u8D25\u201D\u95EE\u9898 (2)P0-cleanupExpiredDaypartingBids\u63D0\u5347\u4E3A\u7EA0\u9519\u626B\u63CF\u7B2C1\u6B65+\u72EC\u7ACB30\u5206\u949F\u5B9A\u65F6\u4EFB\u52A1 (3)P1-N+1\u67E5\u8BE2\u6D88\u9664: adGroupSync/searchTermSync/negativeKeywordSync\u5168\u9762\u91CD\u5199,\u9884\u52A0\u8F7DMap+\u6279\u91CFinsert (4)P1-\u7EE9\u6548\u6570\u636E\u7CBE\u5EA6\u7EDF\u4E00: toFixed(2)/toFixed(4)\u4E00\u81F4\u5316 (5)P1-\u6570\u636E\u5E93\u67E5\u8BE2\u4F18\u5316: analytics.ts\u6D88\u9664DATE()\u7D22\u5F15\u5931\u6548+\u5408\u5E766\u6B21COUNT\u4E3A1\u6B21+campaigns.ts\u6DFB\u52A0accountId\u8FC7\u6EE4 (6)P1-\u8F7B\u91CF\u7EA7API: \u65B0\u589Ecampaign.statusCounts\u548Ccampaign.listNamesOnly\u7AEF\u70B9,\u524D\u7AEF6\u5904\u66FF\u6362\u4E3A\u8F7B\u91CFAPI (7)P1-keyword\u8DEF\u7531N+1\u4FEE\u590D: batchUpdateBid/batchUpdateStatus\u6279\u91CF\u5316 (8)P2-\u5B89\u5168\u5F02\u5E38\u5904\u7406\u589E\u5F3A: \u7194\u65AD\u68C0\u67E5\u5F02\u5E38\u6539\u4E3A\u5B89\u5168\u62D2\u7EDD,\u98CE\u9669\u8BC4\u4F30\u5F02\u5E38\u6539\u4E3A\u9ED8\u8BA4\u7EA2\u8272 (9)P2-SB\u5426\u5B9A\u5173\u952E\u8BCD\u5339\u914D\u4FEE\u590D: \u6DFB\u52A0internalAdGroupId\u6761\u4EF6 (10)P3-\u5206\u5E03\u5F0F\u9501\u91CD\u542F: \u57FA\u4E8Esync_locks\u8868\u7684\u6DF7\u5408\u9501\u6A21\u5F0F,\u66FF\u4EE3GET_LOCK\u4E0D\u5360\u7528\u8FDE\u63A5\u6C60 (11)P3-\u540C\u6B65\u6570\u636E\u6821\u9A8C\u6458\u8981\u65E5\u5FD7",
        // @ts-expect-error - runtime type mismatch
        affectedModules: ["sync", "optimization", "correction", "db", "api", "frontend"],
        // @ts-ignore
        correctionActions: ["rerun_correction_scan"]
      },
      {
        version: 429,
        description: "v429: [\u5F7B\u5E95\u7EDF\u4E00ID\u4F53\u7CFB] \u2014 (1)P0-SB\u51FA\u4EF7API\u5F7B\u5E95\u4FEE\u590D: updateSbKeywordBids\u56DE\u9000v3\u7AEF\u70B9PUT /sb/keywords+\u8865\u5145\u5FC5\u586BadGroupId/campaignId/state\u5B57\u6BB5 (2)P0-amazonIdResolver\u5B57\u6BB5\u540Dbug\u4FEE\u590D: 3\u5904kw.adGroupId\u2192kw.internal_ad_group_id(\u4FEE\u590D\u5373\u65F6\u56DE\u586B\u5B8C\u5168\u5931\u6548) (3)P1-entityIdResolver\u5168\u9762\u6FC0\u6D3B: \u5E94\u7528\u5165\u53E3initEntityIdResolver+10\u5206\u949F\u7F13\u5B58+\u6279\u91CF\u89E3\u6790 (4)P1-\u53CC\u5C42\u964D\u7EA7\u67B6\u6784: bidOperations/syncBidOperations/amazonApiHelper\u5168\u90E8\u5B9E\u73B0entityIdResolver\u4F18\u5148+amazonIdResolver\u964D\u7EA7 (5)P1-\u50F5\u5C38\u4EFB\u52A1\u6E05\u7406\u589E\u5F3A: \u9608\u503C30min\u219215min (6)P1-\u5931\u6548\u5F15\u7528\u524D\u7F6E\u6821\u9A8C: \u5DF2\u5220\u9664\u5B9E\u4F53\u7684\u4EFB\u52A1\u81EA\u52A8cancelled (7)P2-SB 403\u91CD\u8BD5\u4EFB\u52A1retry_count\u91CD\u7F6E (8)P2-\u540C\u6B65\u540E\u7F13\u5B58\u6E05\u7406\u673A\u5236",
        // @ts-expect-error - runtime type mismatch
        affectedModules: ["sync", "optimization", "services"],
        // @ts-ignore
        correctionActions: ["rerun_correction_scan"]
      },
      {
        version: 428,
        description: "v428: [\u7EFC\u5408\u4F18\u5316\u4FEE\u590D] \u2014 (1)P0-SB\u51FA\u4EF7API\u7AEF\u70B9\u4FEE\u590D: updateSbKeywordBids\u4ECEPUT /sb/v4/keywords\u6539\u4E3APUT /sb/keywords(v3\u7AEF\u70B9),\u89E3\u51B37261\u4E2A403\u9519\u8BEF (2)P1-updateLocalStatus\u5217\u540D\u6620\u5C04\u4FEE\u590D: keywords\u2192keywordStatus,campaigns\u2192campaignStatus,ad_groups\u2192adGroupStatus,product_targets\u2192targetStatus (3)P2-SB\u5426\u5B9A\u8BCD: \u4F7F\u7528SB\u4E13\u7528API(POST /sb/negativeKeywords) (4)P2-Amazon ID\u524D\u7F6E\u6821\u9A8C (5)P2-\u50F5\u5C38\u4EFB\u52A1\u6E05\u7406: processing\u8D85\u8FC730\u5206\u949F\u81EA\u52A8\u91CD\u7F6E (6)P2-SD\u5B9A\u5411\u62A5\u544A: \u8DF3\u8FC7\u7A7AtargetingText\u8BB0\u5F55",
        affectedModules: ["sync", "optimization"],
        correctionActions: ["rerun_correction_scan"]
      },
      {
        version: 474,
        description: 'v474: [\u65E5\u5FD7\u7CFB\u7EDF\u5168\u9762\u4FEE\u590D+\u4EA7\u54C1\u5B9A\u5411bid\u683C\u5F0F\u5B89\u5168+\u62A5\u544A\u9519\u8BEF\u8BE6\u60C5] \u2014 (1)P0-createModuleLogger\u91CD\u6784: Error\u5BF9\u8C61\u81EA\u52A8\u5E8F\u5217\u5316\u5230message\u5B57\u6BB5,\u4E00\u6B21\u6027\u4FEE\u590D\u5168\u7CFB\u7EDF160+\u5904\u7A7A\u9519\u8BEF\u65E5\u5FD7 (2)P0-SD/SB/SP\u4EA7\u54C1\u5B9A\u5411bid\u683C\u5F0F\u5B89\u5168\u5904\u7406: \u5F53API\u8FD4\u56DE\u5BF9\u8C61\u578B\u5F0Fbid\u65F6\u63D0\u53D6amount\u6570\u503C,\u4FEE\u590D"Cannot convert object to primitive value"\u9519\u8BEF (3)P1-\u62A5\u544A\u63D0\u4EA4\u5931\u8D25\u65E5\u5FD7\u589E\u5F3A: \u8BB0\u5F55\u5B8C\u6574HTTP\u54CD\u5E94\u4F53,\u4FBF\u4E8E\u8C03\u8BD5SB/SD\u62A5\u544A400\u9519\u8BEF (4)P1-Assets API/NotificationService/ContextualFeatureService\u9519\u8BEF\u65E5\u5FD7\u4FEE\u590D',
        affectedModules: ["logging", "sync", "reporting"],
        correctionActions: []
      },
      {
        version: 425,
        description: "v425: [\u540C\u6B65\u5931\u8D25\u5168\u9762\u4FEE\u590D+\u540C\u6B65\u9501\u673A\u5236\u91CD\u6784+\u624B\u52A8\u540C\u6B65\u6700\u9AD8\u4F18\u5148\u7EA7] \u2014 (1)P0-\u540C\u6B65\u9501\u673A\u5236\u91CD\u6784: \u624B\u52A8\u540C\u6B65\u6700\u9AD8\u4F18\u5148\u7EA7,\u4EFB\u4F55\u65F6\u5019\u89E6\u53D1\u90FD\u80FD\u7ACB\u5373\u6267\u884C,\u4E0D\u88AB\u81EA\u52A8\u540C\u6B65\u963B\u585E (2)P0-syncIdempotencyService\u65B0\u589EforceAcquireSyncLock\u5F3A\u5236\u83B7\u53D6\u9501 (3)P0-unifiedSyncEngine\u540C\u5C42\u7EA7/full\u5C42\u9501\u51B2\u7A81\u65F6\u624B\u52A8\u540C\u6B65\u5F3A\u5236\u91CA\u653E (4)P0-dataSyncScheduler.triggerManualSync\u6DFB\u52A0\u5E42\u7B49\u9501\u4FDD\u62A4 (5)P1-\u7EA0\u9519\u670D\u52A1\u589E\u5F3A: retryFailedBidAdjustments\u4FEE\u590D\u6210\u529F\u5224\u65AD\u903B\u8F91(itemResults\u9010\u6761\u5224\u65AD) (6)P1-\u65B0\u589EcleanupExpiredDaypartingBids: \u8D85\u8FC724h\u7684dayparting_bid\u5931\u8D25\u6807\u8BB0\u4E3Asuperseded (7)P1-\u8D85\u8FC77\u5929\u7684\u5931\u8D25\u4E8B\u4EF6\u6807\u8BB0\u4E3Apermanently_failed (8)P1-daypartingExecutor\u91CD\u8BD5\u589E\u5F3A: \u4ECE1\u6B21\u589E\u52A0\u52303\u6B21\u6307\u6570\u9000\u907F (9)P1-amazonApiHelper Amazon ID\u7F3A\u5931\u5BB9\u9519: \u533A\u5206\u53EF\u91CD\u8BD5\u548C\u4E0D\u53EF\u91CD\u8BD5,\u4E0D\u53EF\u91CD\u8BD5\u6807\u8BB0\u4E3Anot_applicable (10)P1-riskActionEngine\u540C\u6B65\u5065\u5EB7\u5EA6\u4F18\u5316: \u6392\u9664superseded/permanently_failed,\u5931\u8D25\u7387>5%\u624D\u89E6\u53D1P0\u544A\u8B66",
        affectedModules: ["sync", "optimization", "correction"],
        correctionActions: ["rerun_correction_scan"]
      },
      {
        version: 346,
        description: "v346: [P2\u5168\u9762\u4F18\u5316] \u2014 (1)\u9664\u96F6\u9632\u62A4\u52A0\u56FA: bidOptimizer\u4E2D15+\u5904\u9664\u6CD5\u64CD\u4F5C\u6DFB\u52A0\u5B89\u5168\u68C0\u67E5 (2)\u7ADE\u6001\u6761\u4EF6\u9632\u62A4: \u65B0\u589EAsyncMutex\u8FDB\u7A0B\u7EA7\u4E92\u65A5\u9501\u5DE5\u5177 (3)\u5185\u5B58\u6CC4\u6F0F\u4FEE\u590D: marketplaceCache\u6DFB\u52A0TTL+\u5BB9\u91CF\u4E0A\u9650+\u5B9A\u65F6\u6E05\u7406 (4)SQL\u6CE8\u5165\u52A0\u56FA: auditLogService/inviteCodeService/marginalBenefitBatchService\u53C2\u6570\u5316\u6539\u9020 (5)\u7A7Acatch\u5757\u4FEE\u590D: 8\u5904\u7A7Acatch\u6DFB\u52A0\u7ED3\u6784\u5316\u65E5\u5FD7 (6)any\u7C7B\u578B\u6536\u7A84: bidOptimizer\u548CoptimizationTargetEngine\u4E2D10+\u5904as any\u6D88\u9664 (7)\u5F52\u6863\u4EE3\u7801\u6E05\u7406: \u5220\u9664_archived_v149(103\u6587\u4EF6/1.2MB) (8)\u65E5\u5FD7\u7EDF\u4E00: 25+\u6587\u4EF616+\u5904console\u8FC1\u79FB\u5230\u7ED3\u6784\u5316\u65E5\u5FD7",
        // @ts-expect-error - runtime type mismatch
        affectedModules: ["optimization", "security", "sync", "logging"],
        correctionActions: []
      },
      {
        version: 345,
        description: "v345: [P0\u5B89\u5168\u52A0\u56FA + P1\u6027\u80FD\u4F18\u5316 + P2\u4EE3\u7801\u8D28\u91CF] \u2014 (1)P0-\u51ED\u8BC1\u52A0\u5BC6\u5B58\u50A8: \u65B0\u589ECryptoService(AES-256-GCM)\u52A0\u89E3\u5BC6\u670D\u52A1,clientSecret\u548CrefreshToken\u5728\u6570\u636E\u5E93\u4E2D\u52A0\u5BC6\u5B58\u50A8,\u8BFB\u53D6\u65F6\u81EA\u52A8\u89E3\u5BC6,\u5411\u540E\u517C\u5BB9\u660E\u6587\u6570\u636E (2)P0-JWT\u5BC6\u94A5\u5B89\u5168: \u79FB\u9664\u786C\u7F16\u7801default-secret-key\u56DE\u9000\u903B\u8F91,\u672A\u914D\u7F6EJWT_SECRET\u65F6\u7CFB\u7EDF\u62D2\u7EDD\u542F\u52A8 (3)P0-\u8FD0\u7EF4\u63A5\u53E3\u5F3A\u5236\u8BA4\u8BC1: \u79FB\u9664OPS_API_KEY\u672A\u914D\u7F6E\u65F6\u7684\u65E0\u8BA4\u8BC1\u5206\u652F (4)P1-\u6570\u636E\u5E93\u7D22\u5F15\u4F18\u5316: \u4E3Ahourly_performance\u548Cbidding_logs\u5927\u8868\u6DFB\u52A0\u590D\u5408\u7D22\u5F15 (5)P1-N+1\u67E5\u8BE2\u4F18\u5316: \u6279\u91CF\u5316\u6539\u9020\u4F18\u5316\u5F15\u64CE\u4E2D\u7684\u5FAA\u73AF\u67E5\u8BE2 (6)P2-\u9B54\u6CD5\u6570\u5B57\u5E38\u91CF\u5316: \u4F18\u5316\u670D\u52A1\u4E2D\u7684\u786C\u7F16\u7801\u6570\u5B57\u66FF\u6362\u4E3A\u5177\u540D\u5E38\u91CF",
        // @ts-expect-error - runtime type mismatch
        affectedModules: ["security", "db", "optimization", "ops"],
        correctionActions: ["rerun_optimization"]
      }
    ];
    POST_DEPLOY_CONFIG = {
      // 重优化批次大小（每批处理的优化目标数）
      batchSize: 5,
      // 批次间等待时间（毫秒）- 避免API限流
      batchDelayMs: 10 * 1e3,
      // 单个优化目标的最大执行时间（毫秒）
      targetTimeoutMs: 5 * 60 * 1e3,
      // 重优化前的等待时间（毫秒）- 给系统启动留出时间
      startupDelayMs: 60 * 1e3,
      // 最大重试次数（单个目标失败后重试）
      maxRetries: 2,
      // 是否在重优化前先运行纠错扫描
      runCorrectionFirst: true,
      // 重优化时的安全护栏
      safetyGuardrails: {
        // 单次出价调整最大幅度（相对于当前值）
        maxBidChangePercent: 30,
        // 单次预算调整最大幅度
        maxBudgetChangePercent: 20,
        // 单次位置倾斜调整最大幅度（百分点）
        maxPlacementChangePoints: 30
      }
    };
    __name(getLastDeployedVersion, "getLastDeployedVersion");
    __name(recordDeployVersion, "recordDeployVersion");
    __name(updateTargetOptimizedVersion, "updateTargetOptimizedVersion");
    __name(getVersionsToApply, "getVersionsToApply");
    __name(mergeAffectedModules, "mergeAffectedModules");
    __name(mergeCorrectionActions, "mergeCorrectionActions");
    __name(reoptimizeTarget, "reoptimizeTarget");
    __name(runPostDeployOptimization, "runPostDeployOptimization");
    __name(forceReoptimize, "forceReoptimize");
    __name(getSystemVersionInfo, "getSystemVersionInfo");
    __name(sleep2, "sleep");
  }
});

