// Extracted from production dist/index.js
// Original module: server/targetEngine/placementExecutor.ts
// Lines: 178

async function executePlacementOptimization(config2, campaigns6, dryRun) {
  const details = [];
  let adjustmentsCount = 0;
  let accountComboMap = /* @__PURE__ */ new Map();
  try {
    const dbConn = await getDb();
    if (dbConn) {
      const allCombos = await getComboAnalysisForAccount(dbConn, config2.accountId);
      for (const combo of allCombos) {
        if (!accountComboMap.has(combo.campaignId)) {
          accountComboMap.set(combo.campaignId, []);
        }
        accountComboMap.get(combo.campaignId).push(combo);
      }
      log107.info(`[PlacementOptimization] v183: \u52A0\u8F7D${allCombos.length}\u4E2A\u6295\u653E\u8BCD\u7684\u7EC4\u5408\u5206\u6790\u7ED3\u679C`);
    }
  } catch (comboErr) {
    log107.warn(`[PlacementOptimization] v183: \u52A0\u8F7D\u7EC4\u5408\u5206\u6790\u7ED3\u679C\u5931\u8D25: ${comboErr.message}`);
  }
  let placementCampaignIndex = 0;
  for (const campaign of campaigns6) {
    if (placementCampaignIndex > 0) {
      await new Promise((resolve) => setTimeout(resolve, 5e3));
    }
    placementCampaignIndex++;
    const campaignLocalId = getCampaignLocalId(campaign);
    const campaignAmazonId = getCampaignAmazonId(campaign);
    try {
      const analysis = await analyzePlacementPerformance(campaignAmazonId, config2.accountId);
      const suggestions = await generatePlacementSuggestions(
        campaignAmazonId,
        // @ts-ignore
        config2.accountId
      );
      if (suggestions.length === 0) {
        log107.info(`[PlacementOptimization] v353\u8BCA\u65AD: Campaign "${campaign.campaignName}" (${campaignAmazonId}) \u751F\u62100\u6761\u5EFA\u8BAE, analysis=${JSON.stringify({
          hasData: !!analysis,
          // @ts-ignore
          dataPoints: analysis?.dataPoints || 0,
          // @ts-ignore
          placements: analysis?.placements?.length || 0
        })}`);
      } else {
        log107.info(`[PlacementOptimization] v353\u8BCA\u65AD: Campaign "${campaign.campaignName}" (${campaignAmazonId}) \u751F\u6210${suggestions.length}\u6761\u5EFA\u8BAE: ${suggestions.map((s) => `${s.placement}: ${s.currentMultiplier}\u2192${s.suggestedMultiplier}%`).join(", ")}`);
      }
      const campaignCombos = accountComboMap.get(campaignLocalId) || [];
      const goldenCombos = campaignCombos.filter((c) => c.comboCategory === "golden" && c.confidenceLevel !== "insufficient");
      let topOfSearchGoldenCount = 0;
      let productPageGoldenCount = 0;
      for (const combo of goldenCombos) {
        if (combo.bestPlacement === "top_of_search") topOfSearchGoldenCount++;
        if (combo.bestPlacement === "product_page") productPageGoldenCount++;
      }
      for (const suggestion of suggestions) {
        let comboAdjustedMultiplier = suggestion.suggestedMultiplier;
        let comboReason = "";
        if (goldenCombos.length > 0) {
          if (suggestion.placement === "top_of_search" && topOfSearchGoldenCount > goldenCombos.length * 0.5) {
            const boost = Math.min(suggestion.suggestedMultiplier * 0.1, 20);
            comboAdjustedMultiplier = Math.min(suggestion.suggestedMultiplier + boost, 900);
            comboReason = ` [v183: ${topOfSearchGoldenCount}\u4E2A\u9EC4\u91D1\u7EC4\u5408\u504F\u597D\u641C\u7D22\u9876\u90E8, +${boost.toFixed(0)}%]`;
          } else if (suggestion.placement === "product_page" && productPageGoldenCount > goldenCombos.length * 0.5) {
            const boost = Math.min(suggestion.suggestedMultiplier * 0.1, 20);
            comboAdjustedMultiplier = Math.min(suggestion.suggestedMultiplier + boost, 900);
            comboReason = ` [v183: ${productPageGoldenCount}\u4E2A\u9EC4\u91D1\u7EC4\u5408\u504F\u597D\u5546\u54C1\u9875, +${boost.toFixed(0)}%]`;
          }
        }
        const adjustment = {
          // @ts-ignore
          accountId: config2.accountId,
          localCampaignId: campaignLocalId,
          amazonCampaignId: campaignAmazonId,
          // @ts-ignore
          campaignName: campaign.campaignName,
          // @ts-ignore
          placement: suggestion.placement,
          // @ts-ignore
          currentMultiplier: suggestion.currentMultiplier,
          suggestedMultiplier: comboAdjustedMultiplier,
          // @ts-ignore
          originalSuggestedMultiplier: suggestion.suggestedMultiplier,
          // @ts-ignore
          reason: suggestion.reason + comboReason,
          algorithmUsed: "placement_optimizer",
          // v335: 添加算法标识
          apiSyncStatus: dryRun ? "pending" : "pending",
          comboGoldenCount: goldenCombos.length
        };
        details.push(adjustment);
        if (!dryRun && comboAdjustedMultiplier !== suggestion.currentMultiplier) {
          await applyPlacementAdjustment(
            // @ts-ignore
            campaignAmazonId,
            // @ts-ignore
            config2.accountId,
            // @ts-ignore
            { ...suggestion, suggestedMultiplier: comboAdjustedMultiplier }
            // @ts-ignore
          );
          adjustmentsCount++;
        }
      }
      if (!dryRun && suggestions.length > 0) {
        let placementSyncSuccess = false;
        let placementSyncError = "";
        try {
          const amazonCampaignId = campaignAmazonId;
          const topSuggestion = suggestions.find((s) => s.placement === "top_of_search");
          const productSuggestion = suggestions.find((s) => s.placement === "product_page");
          if (topSuggestion || productSuggestion) {
            const syncResult = await syncPlacementAdjustmentToAmazon(
              config2.accountId,
              amazonCampaignId,
              // @ts-ignore
              topSuggestion?.suggestedMultiplier || campaign.placementTopSearchBidAdjustment || 0,
              // @ts-ignore
              productSuggestion?.suggestedMultiplier || campaign.placementProductPageBidAdjustment || 0,
              `\u4F4D\u7F6E\u4F18\u5316: Top=${topSuggestion?.suggestedMultiplier || 0}%, Product=${productSuggestion?.suggestedMultiplier || 0}%`
            );
            placementSyncSuccess = syncResult;
          }
        } catch (apiError) {
          placementSyncError = apiError.message;
          log107.warn(`[PlacementOptimization] Amazon API\u540C\u6B65\u5931\u8D25 (Campaign ${campaign.campaignName}):`, apiError.message);
        }
        for (const d of details.filter((d2) => d2.localCampaignId === campaignLocalId)) {
          d.apiSyncStatus = placementSyncSuccess ? "synced" : placementSyncError ? "failed" : "pending";
          d.apiSyncDetail = placementSyncError ? JSON.stringify({ error: placementSyncError }) : null;
        }
        if (placementSyncSuccess) {
          try {
            const amazonCampaignIdForVerify = campaignAmazonId;
            const topSuggestion = suggestions?.find((s) => s.placement === "top_of_search");
            const productSuggestion = suggestions?.find((s) => s.placement === "product_page");
            schedulePlacementVerification(
              config2.accountId,
              [{
                localCampaignId: campaignLocalId,
                amazonCampaignId: amazonCampaignIdForVerify,
                // @ts-ignore
                expectedTopOfSearch: topSuggestion?.suggestedMultiplier,
                // @ts-ignore
                expectedProductPage: productSuggestion?.suggestedMultiplier
              }]
            );
          } catch (verifyErr) {
            log107.warn(`[PlacementOptimization] v166: \u6CE8\u518C\u9A8C\u8BC1\u4EFB\u52A1\u5931\u8D25(\u4E0D\u5F71\u54CD\u4E3B\u6D41\u7A0B): ${verifyErr.message}`);
          }
        }
      }
    } catch (error48) {
      details.push({
        localCampaignId: campaignLocalId,
        amazonCampaignId: campaignAmazonId,
        // @ts-ignore
        campaignName: campaign.campaignName,
        error: error48.message
      });
    }
  }
  return { executed: true, adjustmentsCount: dryRun ? details.length : adjustmentsCount, details };
}
var log107;
var init_placementExecutor = __esm({
  "server/targetEngine/placementExecutor.ts"() {
    "use strict";
    init_db2();
    init_placementOptimizationService();
    init_amazonApiHelper();
    init_multiDimComboAnalyzer();
    init_postOptimizationVerifier();
    init_logger();
    init_idTypes();
    log107 = createModuleLogger("TargetEngine");
    __name(executePlacementOptimization, "executePlacementOptimization");
  }
});

