// Extracted from production dist/index.js
// Original module: server/services/bidCoordinator.ts
// Lines: 139

async function applyCoordinatedBids(campaignId, accountId, proposals, currentBaseBid, currentPlacementMultiplier = 0, currentDaypartingMultiplier = 1) {
  const warnings = [];
  const proposalsBySource = groupProposalsBySource(proposals);
  let baseBidMultiplier = 1;
  let baseBidAbsolute = null;
  for (const [source, sourceProposals] of Object.entries(proposalsBySource)) {
    const weight = COORDINATOR_CONFIG.sourceWeights[source] || 0.5;
    for (const proposal of sourceProposals) {
      if (proposal.suggestedBaseBid !== void 0) {
        if (baseBidAbsolute === null) {
          baseBidAbsolute = proposal.suggestedBaseBid * weight;
        } else {
          baseBidAbsolute = (baseBidAbsolute + proposal.suggestedBaseBid * weight) / 2;
        }
      } else {
        const adjustedMultiplier = 1 + (proposal.suggestedMultiplier - 1) * weight * proposal.confidence;
        baseBidMultiplier *= adjustedMultiplier;
      }
    }
  }
  let newBaseBid = baseBidAbsolute !== null ? baseBidAbsolute : currentBaseBid * baseBidMultiplier;
  const placementMultiplier = 1 + currentPlacementMultiplier / 100;
  const theoreticalMaxCPC = newBaseBid * currentDaypartingMultiplier * placementMultiplier;
  let circuitBreakerTriggered = false;
  let circuitBreakerReason;
  if (theoreticalMaxCPC > COORDINATOR_CONFIG.maxAllowedCPC) {
    circuitBreakerTriggered = true;
    circuitBreakerReason = `\u7406\u8BBA\u6700\u9AD8CPC($${theoreticalMaxCPC.toFixed(2)})\u8D85\u8FC7\u4E0A\u9650($${COORDINATOR_CONFIG.maxAllowedCPC})`;
    newBaseBid = COORDINATOR_CONFIG.maxAllowedCPC / (currentDaypartingMultiplier * placementMultiplier);
    warnings.push(`[\u7194\u65AD] ${circuitBreakerReason}\uFF0CBase Bid\u4ECE$${currentBaseBid.toFixed(2)}\u4E0B\u8C03\u81F3$${newBaseBid.toFixed(2)}`);
  }
  const totalMultiplier = newBaseBid / currentBaseBid * currentDaypartingMultiplier * placementMultiplier;
  if (totalMultiplier > COORDINATOR_CONFIG.maxTotalMultiplier && !circuitBreakerTriggered) {
    warnings.push(`[\u8B66\u544A] \u603B\u4E58\u6570(${totalMultiplier.toFixed(2)}x)\u8D85\u8FC7\u9608\u503C(${COORDINATOR_CONFIG.maxTotalMultiplier}x)`);
  }
  if (theoreticalMaxCPC > COORDINATOR_CONFIG.cpcWarningThreshold && !circuitBreakerTriggered) {
    warnings.push(`[\u8B66\u544A] \u7406\u8BBA\u6700\u9AD8CPC($${theoreticalMaxCPC.toFixed(2)})\u8D85\u8FC7\u8B66\u544A\u9608\u503C($${COORDINATOR_CONFIG.cpcWarningThreshold})`);
  }
  newBaseBid = Math.max(COORDINATOR_CONFIG.minBid, Math.min(COORDINATOR_CONFIG.maxBid, newBaseBid));
  newBaseBid = Math.round(newBaseBid * 100) / 100;
  const effectiveMultiplier = currentBaseBid > 0 ? newBaseBid / currentBaseBid : 1;
  await logCoordinationResult(accountId, campaignId, {
    originalBaseBid: currentBaseBid,
    finalBaseBid: newBaseBid,
    theoreticalMaxCPC: newBaseBid * currentDaypartingMultiplier * placementMultiplier,
    circuitBreakerTriggered,
    proposalCount: proposals.length
  });
  return {
    targetId: parseInt(campaignId) || 0,
    targetType: "campaign",
    originalBaseBid: currentBaseBid,
    finalBaseBid: newBaseBid,
    theoreticalMaxCPC: newBaseBid * currentDaypartingMultiplier * placementMultiplier,
    effectiveMultiplier,
    proposals,
    circuitBreakerTriggered,
    circuitBreakerReason,
    warnings
  };
}
function createBidProposal(targetId, targetType, source, options) {
  return {
    targetId,
    targetType,
    source,
    suggestedMultiplier: options.suggestedMultiplier ?? 1,
    suggestedBaseBid: options.suggestedBaseBid,
    confidence: options.confidence ?? 0.8,
    reason: options.reason,
    timestamp: /* @__PURE__ */ new Date()
  };
}
function groupProposalsBySource(proposals) {
  const grouped = {
    base_algo: [],
    dayparting: [],
    placement: [],
    inventory: [],
    organic_rank: []
  };
  for (const proposal of proposals) {
    if (grouped[proposal.source]) {
      grouped[proposal.source].push(proposal);
    }
  }
  return grouped;
}
async function logCoordinationResult(accountId, campaignId, result) {
  try {
    const db = await getDb();
    if (!db) return;
    log110.info("[BidCoordinator] \u534F\u8C03\u7ED3\u679C:", {
      accountId,
      campaignId,
      ...result,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
  } catch (error48) {
    log110.warn("[BidCoordinator] \u8BB0\u5F55\u65E5\u5FD7\u5931\u8D25:", error48);
  }
}
var log110, COORDINATOR_CONFIG;
var init_bidCoordinator = __esm({
  "server/services/bidCoordinator.ts"() {
    "use strict";
    init_db2();
    init_logger();
    log110 = createModuleLogger("BidCoordinator");
    COORDINATOR_CONFIG = {
      // 硬性CPC上限（美元）
      maxAllowedCPC: 5,
      // 软性CPC警告阈值（美元）
      cpcWarningThreshold: 3,
      // 最大允许的总乘数
      maxTotalMultiplier: 2.5,
      // 熔断后的强制乘数上限
      circuitBreakerMultiplier: 1.5,
      // 最小出价（美元）
      minBid: 0.02,
      // 最大出价（美元）
      maxBid: 100,
      // 各来源的默认权重
      sourceWeights: {
        base_algo: 1,
        dayparting: 0.8,
        placement: 0.7,
        inventory: 1,
        // 库存保护优先级最高
        organic_rank: 0.6
      }
    };
    __name(applyCoordinatedBids, "applyCoordinatedBids");
    __name(createBidProposal, "createBidProposal");
    __name(groupProposalsBySource, "groupProposalsBySource");
    __name(logCoordinationResult, "logCoordinationResult");
  }
});

