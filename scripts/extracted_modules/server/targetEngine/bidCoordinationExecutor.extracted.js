// Extracted from production dist/index.js
// Original module: server/targetEngine/bidCoordinationExecutor.ts
// Lines: 129

async function executeBidCoordination(config2, campaigns6, bidDetails, placementDetails, daypartingDetails, dryRun) {
  const details = [];
  let campaignsCoordinated = 0;
  let circuitBreakerTriggered = 0;
  for (const campaign of campaigns6) {
    const campaignLocalId = getCampaignLocalId(campaign);
    const campaignAmazonId = getCampaignAmazonId(campaign);
    try {
      const proposals = [];
      const bidSuggestions = bidDetails.filter((d) => d.localCampaignId === campaignLocalId);
      for (const suggestion of bidSuggestions) {
        if (suggestion.newBid && suggestion.currentBid) {
          const multiplier = suggestion.newBid / suggestion.currentBid;
          proposals.push(createBidProposal(
            campaignLocalId,
            "campaign",
            // @ts-ignore
            "base_algo",
            {
              suggestedMultiplier: multiplier,
              confidence: 0.85,
              // @ts-ignore
              reason: suggestion.reason || "\u57FA\u4E8E\u5E02\u573A\u66F2\u7EBF\u7684\u6700\u4F18\u51FA\u4EF7\u8C03\u6574"
            }
          ));
        }
      }
      const placementSuggestions = placementDetails.filter((d) => d.localCampaignId === campaignLocalId);
      for (const suggestion of placementSuggestions) {
        if (suggestion.suggestedMultiplier !== void 0) {
          proposals.push(createBidProposal(
            // @ts-ignore
            campaignLocalId,
            "campaign",
            "placement",
            {
              // @ts-ignore
              suggestedMultiplier: 1 + (suggestion.suggestedMultiplier - suggestion.currentMultiplier) / 100,
              confidence: 0.75,
              // @ts-ignore
              reason: suggestion.reason || "\u4F4D\u7F6E\u6548\u7387\u4F18\u5316"
            }
            // @ts-ignore
          ));
        }
      }
      const daypartingSuggestions = daypartingDetails.filter((d) => d.localCampaignId === campaignLocalId);
      for (const suggestion of daypartingSuggestions) {
        if (suggestion.bidMultiplier && suggestion.bidMultiplier !== 1) {
          proposals.push(createBidProposal(
            campaignLocalId,
            "campaign",
            "dayparting",
            {
              // @ts-ignore
              suggestedMultiplier: suggestion.bidMultiplier,
              confidence: 0.8,
              // @ts-ignore
              reason: `\u5206\u65F6\u7B56\u7565: ${suggestion.hour}:00 \u4E58\u6570${suggestion.bidMultiplier}`
            }
          ));
        }
      }
      if (proposals.length === 0) continue;
      const currentBaseBid = parseFloat(campaign.defaultBid || "1");
      const currentPlacementMultiplier = parseFloat(campaign.topOfSearchMultiplier || "0");
      const currentDaypartingMultiplier = 1;
      const coordinatedResult = await applyCoordinatedBids(
        campaignAmazonId,
        config2.accountId,
        proposals,
        currentBaseBid,
        currentPlacementMultiplier,
        currentDaypartingMultiplier
      );
      const coordinationDetail = {
        localCampaignId: campaignLocalId,
        amazonCampaignId: campaignAmazonId,
        // @ts-ignore
        campaignName: campaign.campaignName,
        proposalsCount: proposals.length,
        originalBaseBid: coordinatedResult.originalBaseBid,
        finalBaseBid: coordinatedResult.finalBaseBid,
        theoreticalMaxCPC: coordinatedResult.theoreticalMaxCPC,
        effectiveMultiplier: coordinatedResult.effectiveMultiplier,
        circuitBreakerTriggered: coordinatedResult.circuitBreakerTriggered,
        // @ts-ignore
        circuitBreakerReason: coordinatedResult.circuitBreakerReason,
        warnings: coordinatedResult.warnings,
        algorithmUsed: "bid_coordinator"
        // v335
      };
      details.push(coordinationDetail);
      campaignsCoordinated++;
      if (coordinatedResult.circuitBreakerTriggered) {
        circuitBreakerTriggered++;
      }
      if (!dryRun && coordinatedResult.finalBaseBid !== coordinatedResult.originalBaseBid) {
        log111.info(`[BidCoordination] \u5E7F\u544A\u6D3B\u52A8 ${campaign.campaign.campaignName} \u4EF7\u534F\u8C03\u5B8C\u6210:`, {
          original: coordinatedResult.originalBaseBid,
          final: coordinatedResult.finalBaseBid,
          maxCPC: coordinatedResult.theoreticalMaxCPC,
          circuitBreaker: coordinatedResult.circuitBreakerTriggered
        });
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
  return { executed: true, campaignsCoordinated, circuitBreakerTriggered, details };
}
var log111;
var init_bidCoordinationExecutor = __esm({
  "server/targetEngine/bidCoordinationExecutor.ts"() {
    "use strict";
    init_bidCoordinator();
    init_logger();
    init_idTypes();
    log111 = createModuleLogger("TargetEngine");
    __name(executeBidCoordination, "executeBidCoordination");
  }
});

