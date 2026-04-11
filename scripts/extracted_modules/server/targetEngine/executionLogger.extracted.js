// Extracted from production dist/index.js
// Original module: server/targetEngine/executionLogger.ts
// Lines: 438

async function recordExecutionLog(result) {
  try {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    if (result.bidOptimization.executed && result.bidOptimization.adjustmentsCount > 0) {
      log112.debug(`[recordExecutionLog] v250: \u51FA\u4EF7\u8C03\u6574\u65E5\u5FD7(\u53CC\u5199): details=${result.bidOptimization.details.length}`);
      for (const detail of result.bidOptimization.details) {
        if (detail.action === "safety_pause" || detail.action === "safety_summary") {
          try {
            await createOptimizationLog({
              performanceGroupId: result.targetId,
              performanceGroupName: result.targetName,
              accountId: result.accountId || detail.accountId || 0,
              logCategory: "safety_check",
              actionType: detail.action === "safety_summary" ? "safety_summary" : "safety_pause",
              campaignId: detail.amazonCampaignId || String(detail.localCampaignId || ""),
              campaignName: detail.campaignName,
              actionDetail: JSON.stringify(detail),
              previousValue: null,
              newValue: null,
              changeReason: detail.reason || `\u5B89\u5168\u68C0\u67E5`,
              status: "success",
              apiSyncStatus: "not_applicable",
              createdAt: now,
              executedAt: now
            });
          } catch (safetyLogErr) {
            log112.warn(`[recordExecutionLog] v335: \u5B89\u5168\u68C0\u67E5\u65E5\u5FD7\u5199\u5165\u5931\u8D25: ${safetyLogErr.message}`);
          }
          continue;
        }
        const itemSyncStatus = detail.apiSyncStatus || "pending";
        const itemSyncDetail = detail.apiSyncDetail || null;
        let itemErrorMessage = null;
        if (itemSyncStatus === "failed" && itemSyncDetail) {
          try {
            const parsed = JSON.parse(itemSyncDetail);
            itemErrorMessage = parsed.error || null;
          } catch (e) {
            itemErrorMessage = null;
          }
        }
        try {
          const enhancedBidDetail = {
            ...detail,
            v357_amazonKeywordId: detail.amazonKeywordId || detail.keywordId || "",
            v357_amazonCampaignId: detail.amazonCampaignId || ""
          };
          const { eventId: bidEventId } = await createOptimizationLog({
            performanceGroupId: result.targetId,
            performanceGroupName: result.targetName,
            accountId: result.accountId || detail.accountId || 0,
            logCategory: "bid_adjustment",
            actionType: (detail.newBid ?? 0) > (detail.currentBid ?? 0) ? "bid_increase" : "bid_decrease",
            campaignId: detail.amazonCampaignId || String(detail.localCampaignId || ""),
            campaignName: detail.campaignName,
            actionDetail: JSON.stringify(enhancedBidDetail),
            // v357: 使用增强后的detail
            previousValue: `${(typeof detail.currentBid === "number" ? detail.currentBid : 0).toFixed(2)}`,
            newValue: `${(typeof detail.newBid === "number" ? detail.newBid : 0).toFixed(2)}`,
            changeReason: detail.reason || `\u51FA\u4EF7\u8C03\u6574 ${detail.changePercent || "0"}%`,
            status: itemSyncStatus === "synced" ? "success" : itemSyncStatus === "failed" ? "failed" : "success",
            apiSyncStatus: itemSyncStatus,
            apiSyncDetail: itemSyncDetail,
            apiSyncedAt: itemSyncStatus === "synced" ? now : null,
            errorMessage: itemErrorMessage,
            createdAt: now,
            executedAt: now,
            // v258: 传递结构化归因和护栏信息
            reasonDetails: detail.reasonDetails ? JSON.stringify(detail.reasonDetails) : void 0,
            guardrailInfo: detail.guardrailInfo ? JSON.stringify(detail.guardrailInfo) : void 0
          });
          if (bidEventId) {
            detail.eventId = bidEventId;
          }
        } catch (insertError) {
          log112.warn(`[recordExecutionLog] \u51FA\u4EF7\u65E5\u5FD7\u5199\u5165\u5931\u8D25: ${insertError.message}`, { keywordId: detail.keywordId, itemSyncStatus });
        }
      }
    }
    if (result.placementOptimization.executed && result.placementOptimization.adjustmentsCount > 0) {
      for (const detail of result.placementOptimization.details) {
        await createOptimizationLog({
          performanceGroupId: result.targetId,
          // @ts-ignore
          performanceGroupName: result.targetName,
          // @ts-ignore
          accountId: result.accountId || detail.accountId || 0,
          // v167: 优先使用result.accountId
          // @ts-ignore
          logCategory: "placement_adjustment",
          // @ts-ignore
          actionType: "placement_adjust",
          // @ts-ignore
          campaignId: detail.amazonCampaignId || String(detail.localCampaignId || ""),
          // @ts-ignore
          campaignName: detail.campaignName,
          actionDetail: JSON.stringify(detail),
          // @ts-ignore
          previousValue: detail.previousValue || `${detail.placement}: ${detail.currentMultiplier}%`,
          // @ts-ignore
          newValue: detail.newValue || `${detail.placement}: ${detail.suggestedMultiplier}%`,
          // @ts-ignore
          changeReason: detail.reason || `\u4F4D\u7F6E\u4F18\u5316: ${detail.placement} ${detail.currentMultiplier}% \u2192 ${detail.suggestedMultiplier}%`,
          status: detail.apiSyncStatus === "synced" ? "success" : detail.apiSyncStatus === "failed" ? "failed" : "success",
          // @ts-ignore
          apiSyncStatus: detail.apiSyncStatus || "not_applicable",
          // @ts-ignore
          apiSyncDetail: detail.apiSyncDetail || null,
          apiSyncedAt: detail.apiSyncStatus === "synced" ? now : null,
          createdAt: now,
          executedAt: now
        });
      }
    }
    if (result.searchTermAnalysis.executed) {
      for (const detail of result.searchTermAnalysis.details) {
        const actionTypeMap = {
          // @ts-ignore
          "add_negative": "negative_keyword_add",
          "add_negative_product_target": "negative_product_target_add",
          "brand_protect_skip": "search_term_brand_protect",
          "exploration_protect_skip": "search_term_exploration_protect",
          "keyword_permanently_failed_skip": "search_term_permanent_fail_skip",
          "keyword_validation_failed": "search_term_validation_fail",
          "add_product_target": "product_target_create",
          "add_keyword": "keyword_create"
        };
        const actionType = actionTypeMap[detail.action] || "keyword_create";
        const enhancedDetail = {
          ...detail,
          // v357: 明确记录尝试创建的文本和目标广告组/活动
          v357_targetText: detail.searchTerm || detail.keyword || "",
          v357_targetAdGroupId: detail.adGroupId || detail.targetAdGroupId || "",
          v357_targetCampaignId: detail.campaignId || detail.localCampaignId || "",
          // @ts-ignore
          v357_amazonKeywordId: detail.amazonKeywordId || detail.createdKeywordId || "",
          // @ts-ignore
          v357_amazonTargetId: detail.amazonTargetId || detail.createdTargetId || ""
        };
        await createOptimizationLog({
          // @ts-ignore
          performanceGroupId: result.targetId,
          // @ts-ignore
          performanceGroupName: result.targetName,
          // @ts-ignore
          accountId: result.accountId || detail.accountId || 0,
          // @ts-ignore
          logCategory: "optimization_settings",
          // @ts-expect-error - type assertion
          actionType,
          // @ts-ignore
          campaignId: detail.amazonCampaignId || String(detail.localCampaignId || ""),
          // @ts-ignore
          campaignName: detail.campaignName,
          actionDetail: JSON.stringify(enhancedDetail),
          // v357: 使用增强后的detail
          previousValue: "",
          // @ts-ignore
          newValue: detail.searchTerm || "",
          // @ts-ignore
          changeReason: detail.reason || "",
          status: detail.apiSyncStatus === "synced" ? "success" : detail.apiSyncStatus === "failed" ? "failed" : "success",
          // @ts-ignore
          apiSyncStatus: detail.apiSyncStatus || "not_applicable",
          // @ts-ignore
          apiSyncDetail: detail.apiSyncDetail || null,
          // @ts-ignore
          apiSyncedAt: detail.apiSyncStatus === "synced" ? now : null,
          createdAt: now,
          executedAt: now
          // @ts-ignore
        });
      }
    }
    if (result.daypartingOptimization.executed && result.daypartingOptimization.adjustmentsCount > 0) {
      for (const detail of result.daypartingOptimization.details) {
        await createOptimizationLog({
          performanceGroupId: result.targetId,
          performanceGroupName: result.targetName,
          // @ts-ignore
          accountId: result.accountId || detail.accountId || 0,
          // v167: 优先使用result.accountId
          logCategory: "bid_adjustment",
          actionType: "dayparting_bid",
          // @ts-ignore
          campaignId: detail.amazonCampaignId || String(detail.localCampaignId || ""),
          // @ts-ignore
          campaignName: detail.campaignName,
          actionDetail: JSON.stringify(detail),
          // v175: 不再带$符号存储
          // @ts-ignore
          previousValue: `${detail.baseBid?.toFixed(2) || "0.00"}`,
          // @ts-ignore
          newValue: `${detail.adjustedBid?.toFixed(2) || "0.00"}`,
          // @ts-ignore
          changeReason: detail.reason || `\u5206\u65F6\u7ADE\u4EF7: ${detail.hour}:00 \u4E58\u6570${detail.bidMultiplier}x`,
          // @ts-ignore
          status: detail.apiSyncStatus === "synced" ? "success" : detail.apiSyncStatus === "failed" ? "failed" : "success",
          // @ts-ignore
          apiSyncStatus: detail.apiSyncStatus || "pending",
          // v508: 分时竞价需要同步到Amazon，默认应为pending
          // @ts-ignore
          apiSyncDetail: detail.apiSyncDetail || null,
          // @ts-ignore
          apiSyncedAt: detail.apiSyncStatus === "synced" ? now : null,
          createdAt: now,
          executedAt: now
        });
      }
    }
    if (result.budgetAllocation.executed && result.budgetAllocation.adjustmentsCount > 0) {
      for (const detail of result.budgetAllocation.details) {
        await createOptimizationLog({
          performanceGroupId: result.targetId,
          performanceGroupName: result.targetName,
          // @ts-ignore
          accountId: result.accountId || detail.accountId || 0,
          // v167: 优先使用result.accountId
          // @ts-ignore
          logCategory: "budget_adjustment",
          actionType: "budget_adjustment",
          // @ts-ignore
          campaignId: detail.amazonCampaignId || String(detail.localCampaignId || ""),
          // @ts-ignore
          campaignName: detail.campaignName,
          // @ts-ignore
          actionDetail: JSON.stringify(detail),
          // v175: 不再带$符号存储，避免AutoCorrector解析NaN
          // @ts-ignore
          previousValue: `${detail.currentBudget?.toFixed(2) || "0.00"}`,
          // @ts-ignore
          newValue: `${detail.suggestedBudget?.toFixed(2) || "0.00"}`,
          // @ts-ignore
          changeReason: detail.reason || `\u9884\u7B97\u8C03\u6574 ${detail.changePercent}%`,
          status: detail.apiSyncStatus === "synced" ? "success" : detail.apiSyncStatus === "failed" ? "failed" : "success",
          // @ts-ignore
          apiSyncStatus: detail.apiSyncStatus || "not_applicable",
          // @ts-ignore
          apiSyncDetail: detail.apiSyncDetail || null,
          apiSyncedAt: detail.apiSyncStatus === "synced" ? now : null,
          createdAt: now,
          executedAt: now
        });
      }
    }
    if (result.daypartingBudgetOptimization?.executed && result.daypartingBudgetOptimization.adjustmentsCount > 0) {
      for (const detail of result.daypartingBudgetOptimization.details) {
        if (detail.error) continue;
        await createOptimizationLog({
          // @ts-ignore
          performanceGroupId: result.targetId,
          // @ts-ignore
          performanceGroupName: result.targetName,
          // @ts-ignore
          accountId: result.accountId || detail.accountId || 0,
          // @ts-ignore
          logCategory: "budget_adjustment",
          // @ts-ignore
          actionType: "budget_adjustment",
          // @ts-ignore
          campaignId: detail.amazonCampaignId || String(detail.localCampaignId || ""),
          // @ts-ignore
          campaignName: detail.campaignName,
          actionDetail: JSON.stringify(detail),
          // @ts-ignore
          previousValue: `${detail.currentBudget?.toFixed(2) || "0.00"}`,
          // @ts-ignore
          newValue: `${detail.adjustedBudget?.toFixed(2) || "0.00"}`,
          // @ts-ignore
          changeReason: detail.reason || `\u5206\u65F6\u9884\u7B97: \u661F\u671F${detail.dayOfWeek} \u500D\u6570${detail.budgetMultiplier}x`,
          status: detail.apiSyncStatus === "synced" ? "success" : detail.apiSyncStatus === "failed" ? "failed" : "success",
          // @ts-ignore
          apiSyncStatus: detail.apiSyncStatus || "not_applicable",
          // @ts-ignore
          apiSyncDetail: detail.apiSyncDetail || null,
          apiSyncedAt: detail.apiSyncStatus === "synced" ? now : null,
          // @ts-ignore
          createdAt: now,
          // @ts-ignore
          executedAt: now
        });
      }
    }
    if (result.keywordStatusChanges.executed) {
      for (const detail of result.keywordStatusChanges.details) {
        await createOptimizationLog({
          performanceGroupId: result.targetId,
          performanceGroupName: result.targetName,
          // @ts-ignore
          accountId: result.accountId || detail.accountId || 0,
          // v167: 优先使用result.accountId
          logCategory: "bid_adjustment",
          actionType: detail.action === "add_negative" ? "negative_keyword_add" : detail.newStatus === "paused" ? "target_pause" : "target_enable",
          // @ts-ignore
          campaignId: detail.amazonCampaignId || String(detail.localCampaignId || ""),
          // @ts-ignore
          campaignName: detail.campaignName,
          actionDetail: JSON.stringify(detail),
          // @ts-ignore
          previousValue: detail.currentStatus || "",
          // @ts-ignore
          newValue: detail.action || "",
          // @ts-ignore
          changeReason: detail.reason || "",
          // @ts-ignore
          status: detail.apiSyncStatus === "synced" ? "success" : detail.apiSyncStatus === "failed" ? "failed" : "success",
          // @ts-ignore
          apiSyncStatus: detail.apiSyncStatus || "not_applicable",
          // @ts-ignore
          apiSyncDetail: detail.apiSyncDetail || null,
          apiSyncedAt: detail.apiSyncStatus === "synced" ? now : null,
          // @ts-ignore
          createdAt: now,
          // @ts-ignore
          executedAt: now
        });
      }
    }
    if (result.campaignStatusChanges.executed) {
      for (const detail of result.campaignStatusChanges.details) {
        if (detail.error) continue;
        await createOptimizationLog({
          performanceGroupId: result.targetId,
          performanceGroupName: result.targetName,
          // @ts-ignore
          accountId: result.accountId || detail.accountId || 0,
          // v167: 优先使用result.accountId
          logCategory: "bid_adjustment",
          actionType: detail.newStatus === "paused" ? "bid_decrease" : "bid_increase",
          // @ts-ignore
          campaignId: detail.amazonCampaignId || String(detail.localCampaignId || ""),
          // @ts-ignore
          campaignName: detail.campaignName,
          actionDetail: JSON.stringify(detail),
          // @ts-ignore
          previousValue: detail.previousStatus || "",
          // @ts-ignore
          newValue: detail.newStatus || "",
          // @ts-ignore
          changeReason: detail.reason || "",
          status: detail.apiSyncStatus === "synced" ? "success" : detail.apiSyncStatus === "failed" ? "failed" : "success",
          // @ts-ignore
          apiSyncStatus: detail.apiSyncStatus || "not_applicable",
          // @ts-ignore
          apiSyncDetail: detail.apiSyncDetail || null,
          apiSyncedAt: detail.apiSyncStatus === "synced" ? now : null,
          createdAt: now,
          executedAt: now
        });
      }
    }
    if (result.adGroupStatusChanges.executed) {
      for (const detail of result.adGroupStatusChanges.details) {
        if (detail.error) continue;
        await createOptimizationLog({
          performanceGroupId: result.targetId,
          performanceGroupName: result.targetName,
          // @ts-ignore
          accountId: result.accountId || detail.accountId || 0,
          // v167: 优先使用result.accountId
          logCategory: "optimization_settings",
          actionType: detail.action === "pause" ? "adgroup_pause" : "adgroup_enable",
          // @ts-ignore
          campaignId: detail.amazonCampaignId || String(detail.localCampaignId || ""),
          // @ts-ignore
          campaignName: detail.campaignName,
          actionDetail: JSON.stringify(detail),
          // @ts-ignore
          previousValue: detail.currentStatus || "",
          // @ts-ignore
          newValue: detail.newStatus || "",
          // @ts-ignore
          changeReason: detail.reason || `\u5E7F\u544A\u7EC4 "${detail.adGroupName}" ${detail.action === "pause" ? "\u6682\u505C" : "\u542F\u7528"}`,
          status: detail.apiSyncStatus === "synced" ? "success" : detail.apiSyncStatus === "failed" ? "failed" : "success",
          // @ts-ignore
          apiSyncStatus: detail.apiSyncStatus || "not_applicable",
          // @ts-ignore
          apiSyncDetail: detail.apiSyncDetail || null,
          apiSyncedAt: detail.apiSyncStatus === "synced" ? now : null,
          createdAt: now,
          executedAt: now
        });
      }
    }
    try {
      const dbInstance = await getDb();
      const { performanceGroups: performanceGroups8 } = await Promise.resolve().then(() => (init_schema2(), schema_exports));
      const { eq: eqOp } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
      await dbInstance.update(performanceGroups8).set({ lastOptimizationAt: /* @__PURE__ */ new Date() }).where(eqOp(performanceGroups8.id, result.targetId));
      log112.info(`[OptimizationTargetEngine] \u5DF2\u66F4\u65B0 last_optimization_at: targetId=${result.targetId}`);
    } catch (updateErr) {
      try {
        const directConn = await getDirectConnection();
        try {
          await directConn.execute(
            "UPDATE performance_groups SET last_optimization_at = NOW() WHERE id = ?",
            [result.targetId]
          );
          log112.info(`[OptimizationTargetEngine] \u5DF2\u901A\u8FC7\u8FDE\u63A5\u6C60\u66F4\u65B0 last_optimization_at: targetId=${result.targetId}`);
        } finally {
          directConn.release();
        }
      } catch (directErr) {
        log112.warn(`[OptimizationTargetEngine] \u66F4\u65B0last_optimization_at\u5931\u8D25: ${directErr.message}`);
      }
    }
    log112.info(`[OptimizationTargetEngine] \u6267\u884C\u65E5\u5FD7\u5DF2\u5199\u5165\u6570\u636E\u5E93: ${result.targetName}`, {
      status: result.status,
      bidAdjustments: result.bidOptimization.adjustmentsCount,
      placementAdjustments: result.placementOptimization.adjustmentsCount,
      negativeKeywords: result.searchTermAnalysis.negativeKeywordsAdded,
      newKeywords: result.searchTermAnalysis.newKeywordsAdded,
      keywordsPaused: result.keywordStatusChanges.pausedCount,
      keywordsEnabled: result.keywordStatusChanges.enabledCount,
      campaignsPaused: result.campaignStatusChanges.pausedCount,
      campaignsEnabled: result.campaignStatusChanges.enabledCount,
      adGroupsPaused: result.adGroupStatusChanges.pausedCount,
      adGroupsEnabled: result.adGroupStatusChanges.enabledCount
    });
  } catch (error48) {
    log112.warn(`[OptimizationTargetEngine] \u65E5\u5FD7\u5199\u5165\u5931\u8D25:`, error48.message);
    log112.info(`[OptimizationTargetEngine] \u6267\u884C\u5B8C\u6210(\u65E5\u5FD7\u56DE\u9000): ${result.targetName}`, {
      status: result.status,
      errors: result.errors.length
    });
  }
}
var log112;
var init_executionLogger = __esm({
  "server/targetEngine/executionLogger.ts"() {
    "use strict";
    init_db2();
    init_logger();
    log112 = createModuleLogger("TargetEngine");
    __name(recordExecutionLog, "recordExecutionLog");
  }
});

