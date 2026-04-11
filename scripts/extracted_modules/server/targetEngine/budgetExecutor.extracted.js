// Extracted from production dist/index.js
// Original module: server/targetEngine/budgetExecutor.ts
// Lines: 232

function isBudgetQuarantined(campaignKey) {
  const state = budgetFailureCounters.get(campaignKey);
  if (!state) return false;
  if (state.quarantinedUntil > Date.now()) return true;
  if (state.quarantinedUntil > 0 && state.quarantinedUntil <= Date.now()) {
    state.count = 0;
    state.quarantinedUntil = 0;
  }
  return false;
}
function recordBudgetFailure(campaignKey, campaignName) {
  const state = budgetFailureCounters.get(campaignKey) || { count: 0, lastFailTime: 0, quarantinedUntil: 0 };
  state.count++;
  state.lastFailTime = Date.now();
  if (state.count >= BUDGET_QUARANTINE_THRESHOLD) {
    state.quarantinedUntil = Date.now() + BUDGET_QUARANTINE_DURATION_MS;
    log109.warn(`[BudgetAllocation] v614i-fix8: Campaign ${campaignName} (${campaignKey}) \u8FDE\u7EED\u5931\u8D25${state.count}\u6B21\uFF0C\u5DF2\u9694\u79BB${BUDGET_QUARANTINE_DURATION_MS / 6e4}\u5206\u949F`);
  }
  budgetFailureCounters.set(campaignKey, state);
}
function recordBudgetSuccess(campaignKey) {
  budgetFailureCounters.delete(campaignKey);
}
async function executeBudgetAllocation(config2, campaigns6, dryRun) {
  const details = [];
  let adjustmentsCount = 0;
  try {
    let portfolioResult = null;
    try {
      portfolioResult = await optimizeBudgetPortfolio(
        config2.accountId,
        config2.id,
        config2.dailyBudget || void 0
      );
      if (portfolioResult) {
        log109.info(`[BudgetAllocation] v360: budgetPortfolioOptimizer\u6210\u529F, ${portfolioResult.allocations.length}\u6761\u5206\u914D, \u603B\u9884\u7B97=$${portfolioResult.totalBudget}`);
      }
    } catch (portfolioErr) {
      log109.warn(`[BudgetAllocation] v360: budgetPortfolioOptimizer\u5931\u8D25\uFF0C\u56DE\u9000\u5230intelligentBudgetAllocationService: ${portfolioErr.message}`);
    }
    const budgetConfig = config2.dailyBudget ? { targetTotalBudget: config2.dailyBudget } : void 0;
    const budgetResult = await generateBudgetAllocationSuggestions(
      config2.id,
      budgetConfig ? { ...getDefaultAllocationConfig(), ...budgetConfig } : void 0
    );
    log109.info(`[BudgetAllocation] v353\u8BCA\u65AD: \u76EE\u6807${config2.id} \u751F\u6210${budgetResult.suggestions.length}\u6761\u9884\u7B97\u5EFA\u8BAE, campaigns=${campaigns6.length}`);
    let skippedBelowThreshold = 0;
    let appliedCount = 0;
    for (const suggestion of budgetResult.suggestions) {
      const campaign = campaigns6.find((c) => c.id === suggestion.campaignId);
      if (!campaign) {
        log109.warn(`[BudgetAllocation] v354: suggestion.campaignId=${suggestion.campaignId} (amazonId=${suggestion.amazonCampaignId}) \u672A\u5728campaigns\u5217\u8868\u4E2D\u627E\u5230\u5339\u914D`);
        continue;
      }
      let finalBudget = suggestion.suggestedBudget;
      const campaignPerf = budgetResult.suggestions.find((s) => s.campaignId === suggestion.campaignId);
      const twMetrics = campaignPerf?.timeWeightedMetrics;
      if (twMetrics && Math.abs(suggestion.suggestedBudget - suggestion.currentBudget) > 0.5) {
        const gradualResult = applyGradualBudgetAdjustment(
          suggestion.currentBudget,
          twMetrics.weightedDailySpend || suggestion.currentBudget,
          suggestion.suggestedBudget,
          twMetrics
        );
        finalBudget = gradualResult.gradualBudget;
        log109.debug(`[BudgetAllocation] v163: \u6E10\u8FDB\u5F0F\u9884\u7B97 - Campaign ${campaign.campaignName}: $${suggestion.currentBudget.toFixed(0)}\u2192$${finalBudget.toFixed(0)} (\u7B97\u6CD5\u76EE\u6807$${suggestion.suggestedBudget.toFixed(0)}, \u8BA2\u5355\u4FDD\u62A4=${gradualResult.orderProtectionActive})`);
      }
      const adjustment = {
        accountId: config2.accountId,
        // @ts-ignore
        campaignId: suggestion.campaignId,
        // v354: 本地ID
        amazonCampaignId: suggestion.amazonCampaignId,
        // v354: Amazon ID
        // @ts-ignore
        campaignName: campaign.campaignName,
        currentBudget: suggestion.currentBudget,
        suggestedBudget: finalBudget,
        // v163: 使用渐进式调整后的预算
        changeAmount: finalBudget - suggestion.currentBudget,
        changePercent: ((finalBudget - suggestion.currentBudget) / suggestion.currentBudget * 100).toFixed(2),
        reason: `[v163\u6E10\u8FDB] ${suggestion.reasons?.join(", ") || ""}`,
        // @ts-expect-error - dynamic property access
        expectedImpact: suggestion.expectedRoasChange || 0,
        algorithmUsed: "budget_allocator",
        // v335
        apiSyncStatus: "pending"
      };
      details.push(adjustment);
      if (!dryRun && Math.abs(finalBudget - suggestion.currentBudget) <= 0.5) {
        adjustment.apiSyncStatus = "not_applicable";
        adjustment.apiSyncDetail = JSON.stringify({ reason: `\u8C03\u6574\u91D1\u989D$${Math.abs(finalBudget - suggestion.currentBudget).toFixed(2)}\u4F4E\u4E8E$0.50\u9608\u503C\uFF0C\u65E0\u9700\u540C\u6B65` });
      }
      if (!dryRun && Math.abs(finalBudget - suggestion.currentBudget) > 0.5) {
        const campaignQuarantineKey = `${config2.accountId}_${suggestion.campaignId}`;
        if (isBudgetQuarantined(campaignQuarantineKey)) {
          adjustment.apiSyncStatus = "quarantined";
          adjustment.apiSyncDetail = JSON.stringify({ reason: "\u8FDE\u7EED\u5931\u8D25\u5DF2\u9694\u79BB\uFF0C\u7B49\u5F85\u51B7\u5374\u540E\u91CD\u8BD5" });
          log109.info(`[BudgetAllocation] v614i-fix8: Campaign ${campaign.campaignName} \u5728\u9694\u79BB\u671F\u5185\uFF0C\u8DF3\u8FC7\u9884\u7B97\u540C\u6B65`);
          continue;
        }
        const campaignType = (campaign.campaignType || "sp_manual").toLowerCase();
        if (campaignType.startsWith("sp")) {
          try {
            const amazonCampaignIdForBR = suggestion.amazonCampaignId || getCampaignAmazonId(campaign);
            let apiClient;
            try {
              const syncService = await getAmazonSyncService2(config2.accountId);
              if (syncService?.client?.listSpCampaignBudgetRules) apiClient = syncService.client;
            } catch {
            }
            const brAnalysis = await analyzeBudgetRules(
              config2.accountId,
              String(amazonCampaignIdForBR),
              apiClient
            );
            if (brAnalysis.hasRules) {
              await updateCampaign(suggestion.campaignId, {
                hasBudgetRules: brAnalysis.totalRuleCount > 0 ? 1 : 0,
                budgetRulesCount: brAnalysis.totalRuleCount
              });
              if (brAnalysis.shouldSkipBudgetAdjustment) {
                adjustment.apiSyncStatus = "skipped_budget_rules";
                adjustment.apiSyncDetail = JSON.stringify({
                  reason: brAnalysis.skipReason,
                  activeRules: brAnalysis.activeRuleCount,
                  totalRules: brAnalysis.totalRuleCount,
                  rulesSummary: brAnalysis.rulesSummary.map((r) => r.description),
                  dataSource: brAnalysis.dataSource
                });
                log109.info(`[BudgetAllocation] v614i-fix22: Campaign ${campaign.campaignName} Budget Rules\u667A\u80FD\u534F\u540C: \u8DF3\u8FC7 \u2014 ${brAnalysis.skipReason}`);
                continue;
              } else if (brAnalysis.budgetAdjustmentCap < 1) {
                const maxAllowedBudget = suggestion.currentBudget * brAnalysis.budgetAdjustmentCap;
                if (finalBudget > maxAllowedBudget) {
                  const cappedBudget = Math.round(maxAllowedBudget * 100) / 100;
                  log109.info(`[BudgetAllocation] v614i-fix22: Campaign ${campaign.campaignName} Budget Rules\u534F\u540C: \u9884\u7B97\u4E0A\u9650\u4ECE$${finalBudget.toFixed(2)}\u964D\u81F3$${cappedBudget.toFixed(2)} (cap=${(brAnalysis.budgetAdjustmentCap * 100).toFixed(0)}%, ${brAnalysis.skipReason})`);
                  finalBudget = cappedBudget;
                  adjustment.suggestedBudget = finalBudget;
                  adjustment.changeAmount = finalBudget - suggestion.currentBudget;
                  adjustment.changePercent = ((finalBudget - suggestion.currentBudget) / suggestion.currentBudget * 100).toFixed(2);
                  adjustment.apiSyncDetail = JSON.stringify({
                    budgetCapped: true,
                    reason: brAnalysis.skipReason,
                    cap: brAnalysis.budgetAdjustmentCap
                  });
                }
              }
            }
          } catch (brCheckErr) {
            log109.warn(`[BudgetAllocation] v614i-fix22: Budget Rules\u5206\u6790\u5931\u8D25 (Campaign ${campaign.campaignName}): ${brCheckErr.message}\uFF0C\u7EE7\u7EED\u6267\u884C\u9884\u7B97\u8C03\u6574`);
          }
        }
        try {
          const amazonCampaignId = suggestion.amazonCampaignId || getCampaignAmazonId(campaign);
          const budgetSyncResult = await syncBudgetAdjustmentToAmazon(
            config2.accountId,
            amazonCampaignId,
            finalBudget,
            // v163: 使用渐进式调整后的预算
            `v163\u6E10\u8FDB\u5F0F\u9884\u7B97\u4F18\u5316: $${suggestion.currentBudget.toFixed(2)} -> $${finalBudget.toFixed(2)}`
          );
          if (budgetSyncResult) {
            await updateCampaign(suggestion.campaignId, {
              dailyBudget: finalBudget.toFixed(2),
              lastOptimizedAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " "),
              pendingBudget: finalBudget.toFixed(2),
              budgetSyncStatus: "pending_confirmation"
            });
            adjustmentsCount++;
            adjustment.apiSyncStatus = "synced";
            recordBudgetSuccess(campaignQuarantineKey);
            try {
              scheduleBudgetVerification(
                config2.accountId,
                [{
                  localCampaignId: suggestion.campaignId,
                  // v354: 现在正确传入本地ID
                  amazonCampaignId: suggestion.amazonCampaignId || amazonCampaignId,
                  // v354: 使用Amazon ID
                  expectedBudget: finalBudget
                }]
              );
            } catch (verifyErr) {
              log109.warn(`[BudgetAllocation] v166: \u6CE8\u518C\u9A8C\u8BC1\u4EFB\u52A1\u5931\u8D25(\u4E0D\u5F71\u54CD\u4E3B\u6D41\u7A0B): ${verifyErr.message}`);
            }
          } else {
            adjustment.apiSyncStatus = "failed";
            recordBudgetFailure(campaignQuarantineKey, campaign.campaignName);
            log109.warn(`[BudgetAllocation] v148: API\u540C\u6B65\u5931\u8D25\uFF0C\u8DF3\u8FC7DB\u66F4\u65B0 (Campaign ${campaign.campaignName})`);
          }
        } catch (apiError) {
          adjustment.apiSyncStatus = "failed";
          adjustment.apiSyncDetail = JSON.stringify({ error: apiError.message });
          recordBudgetFailure(campaignQuarantineKey, campaign.campaignName);
          log109.warn(`[BudgetAllocation] v148: API\u540C\u6B65\u5931\u8D25\uFF0C\u8DF3\u8FC7DB\u66F4\u65B0 (Campaign ${campaign.campaignName}):`, apiError.message);
        }
      }
    }
  } catch (error48) {
    details.push({ error: error48.message });
  }
  const budgetApplied = details.filter((d) => d.apiSyncStatus === "synced").length;
  const budgetNotApplicable = details.filter((d) => d.apiSyncStatus === "not_applicable").length;
  const budgetFailed = details.filter((d) => d.apiSyncStatus === "failed").length;
  log109.info(`[BudgetAllocation] v353\u8BCA\u65AD\u6C47\u603B: \u5171${details.length}\u6761\u5EFA\u8BAE, \u5DF2\u5E94\u7528=${budgetApplied}, \u4F4E\u4E8E\u9608\u503C=${budgetNotApplicable}, \u5931\u8D25=${budgetFailed}`);
  return { executed: true, adjustmentsCount: dryRun ? details.length : adjustmentsCount, details };
}
var budgetFailureCounters, BUDGET_QUARANTINE_THRESHOLD, BUDGET_QUARANTINE_DURATION_MS, log109;
var init_budgetExecutor = __esm({
  "server/targetEngine/budgetExecutor.ts"() {
    "use strict";
    init_db2();
    init_intelligentBudgetAllocationService();
    init_budgetPortfolioOptimizer();
    init_amazonApiHelper();
    init_gradualOptimizationEngine();
    init_postOptimizationVerifier();
    init_logger();
    init_idTypes();
    init_budgetRulesCoordinator();
    budgetFailureCounters = /* @__PURE__ */ new Map();
    BUDGET_QUARANTINE_THRESHOLD = 3;
    BUDGET_QUARANTINE_DURATION_MS = 30 * 60 * 1e3;
    __name(isBudgetQuarantined, "isBudgetQuarantined");
    __name(recordBudgetFailure, "recordBudgetFailure");
    __name(recordBudgetSuccess, "recordBudgetSuccess");
    log109 = createModuleLogger("TargetEngine");
    __name(executeBudgetAllocation, "executeBudgetAllocation");
  }
});

