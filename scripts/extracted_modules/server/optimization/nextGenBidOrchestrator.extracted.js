// Extracted from production dist/index.js
// Original module: server/optimization/nextGenBidOrchestrator.ts
// Lines: 1529

var nextGenBidOrchestrator_exports = {};
__export(nextGenBidOrchestrator_exports, {
  batchCalculateNextGenBids: () => batchCalculateNextGenBids,
  calculateNextGenBid: () => calculateNextGenBid,
  executeBudgetOptimization: () => executeBudgetOptimization,
  executeKeywordGraphAnalysis: () => executeKeywordGraphAnalysis,
  executeModelTraining: () => executeModelTraining,
  executeNextGenMaintenanceTasks: () => executeNextGenMaintenanceTasks,
  updateLinUCBFromReward: () => updateLinUCBFromReward
});
function getBidCooldownConfig(adType) {
  let cooldownHours;
  const normalizedAdType = (adType || "").toLowerCase().replace("sponsored_", "").replace("sponsored", "");
  switch (normalizedAdType) {
    case "sb":
      cooldownHours = getConfig("safety.cooldown_hours_sb");
      break;
    case "sd":
      cooldownHours = getConfig("safety.cooldown_hours_sd");
      break;
    case "sp":
      cooldownHours = getConfig("safety.cooldown_hours_sp");
      break;
    default:
      cooldownHours = getConfig("safety.cooldown_hours");
  }
  return {
    cooldownHours,
    minAdjustmentPercent: getConfig("safety.min_adjustment_percent"),
    minAdjustmentAbsolute: 0.02,
    // 绝对值保持固定
    maxAdjustmentsPerDay: getConfig("safety.max_adjustments_per_day")
  };
}
async function checkBidDirectionConsistency(accountId, keywordId, targetId) {
  if (!keywordId && !targetId) return { isOscillating: false, reason: "" };
  try {
    const db = await getDb();
    if (!db) return { isOscillating: false, reason: "" };
    const { sql: sql15 } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
    const entityCondition = keywordId ? sql15`keyword_id = ${keywordId}` : sql15`target_id = ${targetId}`;
    const [rows] = await db.execute(sql15`
      SELECT action_type, new_value, previous_value, created_at
      FROM optimization_events
      WHERE account_id = ${accountId}
        AND ${entityCondition}
        AND event_category = 'bid_adjustment'
        AND action_type IN ('bid_increase', 'bid_decrease')
        AND created_at > DATE_SUB(NOW(), INTERVAL 72 HOUR)
      ORDER BY created_at DESC
      LIMIT 4
    `);
    if (!rows || rows.length < 3) return { isOscillating: false, reason: "" };
    const directions = rows.slice(0, 3).map((r) => r.action_type === "bid_increase" ? "up" : "down");
    const isOscillating = directions[0] !== directions[1] && directions[1] !== directions[2] || // 或者4次调整中方向变化超过2次
    rows.length >= 4 && (() => {
      const dirs4 = rows.slice(0, 4).map((r) => r.action_type === "bid_increase" ? "up" : "down");
      let changes = 0;
      for (let i = 1; i < dirs4.length; i++) {
        if (dirs4[i] !== dirs4[i - 1]) changes++;
      }
      return changes >= 2;
    })();
    if (isOscillating) {
      return {
        isOscillating: true,
        reason: `72h\u5185\u51FA\u4EF7\u65B9\u5411\u5E8F\u5217=[${directions.join("\u2192")}]\uFF0C\u68C0\u6D4B\u5230\u632F\u8361\u6A21\u5F0F`
      };
    }
    return { isOscillating: false, reason: "" };
  } catch (err) {
    return { isOscillating: false, reason: "" };
  }
}
async function isInCooldownPeriod(accountId, keywordId, targetId) {
  if (!keywordId && !targetId) return { inCooldown: false, reason: "", recentAdjustments: 0 };
  try {
    const db = await getDb();
    if (!db) return { inCooldown: false, reason: "", recentAdjustments: 0 };
    const { optimizationEvents: optimizationEvents9 } = await Promise.resolve().then(() => (init_schema2(), schema_exports));
    const { and: andOp, eq: eqOp, gte: gteOp, sql: sqlOp } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
    const hoursAgo24 = new Date(Date.now() - 24 * 36e5).toISOString();
    const cooldownCutoff = new Date(Date.now() - BID_COOLDOWN_CONFIG.cooldownHours * 36e5).toISOString();
    const conditions = [
      eqOp(optimizationEvents9.accountId, accountId),
      sqlOp`${optimizationEvents9.eventCategory} = 'bid_adjustment'`,
      sqlOp`${optimizationEvents9.status} = 'success'`,
      gteOp(optimizationEvents9.createdAt, hoursAgo24)
    ];
    if (keywordId) {
      conditions.push(eqOp(optimizationEvents9.keywordId, keywordId));
    } else if (targetId) {
      conditions.push(eqOp(optimizationEvents9.targetId, targetId));
    }
    const recentEvents = await db.select({
      id: optimizationEvents9.id,
      createdAt: optimizationEvents9.createdAt
    }).from(optimizationEvents9).where(andOp(...conditions)).orderBy(sqlOp`created_at DESC`).limit(10);
    const recentAdjustments = recentEvents.length;
    if (recentAdjustments >= BID_COOLDOWN_CONFIG.maxAdjustmentsPerDay) {
      return {
        inCooldown: true,
        reason: `24h\u5185\u5DF2\u8C03\u6574${recentAdjustments}\u6B21(\u4E0A\u9650${BID_COOLDOWN_CONFIG.maxAdjustmentsPerDay}\u6B21)`,
        recentAdjustments
      };
    }
    if (recentEvents.length > 0) {
      const lastAdjustTime = new Date(recentEvents[0].createdAt);
      if (lastAdjustTime.getTime() > new Date(cooldownCutoff).getTime()) {
        const hoursAgo = ((Date.now() - lastAdjustTime.getTime()) / 36e5).toFixed(1);
        return {
          inCooldown: true,
          reason: `\u8DDD\u4E0A\u6B21\u8C03\u6574\u4EC5${hoursAgo}h(\u51B7\u5374\u671F${BID_COOLDOWN_CONFIG.cooldownHours}h)`,
          recentAdjustments
        };
      }
    }
    return { inCooldown: false, reason: "", recentAdjustments };
  } catch (error48) {
    log63.warn(`[CooldownCheck] \u51B7\u5374\u68C0\u67E5\u5F02\u5E38: ${error48.message}`);
    return { inCooldown: false, reason: "", recentAdjustments: 0 };
  }
}
function meetsMinimumAdjustment(currentBid, newBid) {
  const absoluteDiff = Math.abs(newBid - currentBid);
  const percentDiff = currentBid > 0 ? absoluteDiff / currentBid : 0;
  return absoluteDiff >= BID_COOLDOWN_CONFIG.minAdjustmentAbsolute && percentDiff >= BID_COOLDOWN_CONFIG.minAdjustmentPercent;
}
async function checkCircuitBreaker(accountId, keywordId, targetId, currentBid, proposedBid) {
  if (!keywordId && !targetId) return { tripped: false, reason: "", guardrailInfo: {} };
  if (!proposedBid || !currentBid || proposedBid >= currentBid) {
    return { tripped: false, reason: "", guardrailInfo: {} };
  }
  try {
    const db = await getDb();
    if (!db) return { tripped: false, reason: "", guardrailInfo: {} };
    const { optimizationEvents: optimizationEvents9 } = await Promise.resolve().then(() => (init_schema2(), schema_exports));
    const { and: andOp, eq: eqOp, gte: gteOp, sql: sqlOp, desc: descOp } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
    const daysAgo7 = new Date(Date.now() - 7 * 24 * 36e5).toISOString();
    const conditions = [
      eqOp(optimizationEvents9.accountId, accountId),
      sqlOp`${optimizationEvents9.eventCategory} = 'bid_adjustment'`,
      sqlOp`${optimizationEvents9.status} = 'success'`,
      gteOp(optimizationEvents9.createdAt, daysAgo7)
    ];
    if (keywordId) {
      conditions.push(eqOp(optimizationEvents9.keywordId, keywordId));
    } else if (targetId) {
      conditions.push(eqOp(optimizationEvents9.targetId, targetId));
    }
    const recentEvents = await db.select({
      id: optimizationEvents9.id,
      previousBid: optimizationEvents9.previousBid,
      newBid: optimizationEvents9.newBid,
      createdAt: optimizationEvents9.createdAt
    }).from(optimizationEvents9).where(andOp(...conditions)).orderBy(sqlOp`created_at DESC`).limit(20);
    const guardrailInfo = {
      recentEventsCount: recentEvents.length,
      circuitBreakerConfig: BID_CIRCUIT_BREAKER_CONFIG
    };
    if (recentEvents.length === 0) {
      return { tripped: false, reason: "", guardrailInfo };
    }
    const oldestEvent = recentEvents[recentEvents.length - 1];
    const initialBid = parseFloat(String(oldestEvent.previousBid)) || currentBid;
    const cumulativeDecrease = initialBid > 0 ? (initialBid - (proposedBid || currentBid)) / initialBid : 0;
    guardrailInfo.initialBid7d = initialBid;
    guardrailInfo.cumulativeDecrease7d = cumulativeDecrease;
    if (cumulativeDecrease > BID_CIRCUIT_BREAKER_CONFIG.maxCumulativeDecreasePercent7d) {
      const recoveryBid = (currentBid || 0) * (1 + BID_CIRCUIT_BREAKER_CONFIG.recoveryBoostPercent);
      guardrailInfo.recoveryMode = "cumulative_decrease_recovery";
      guardrailInfo.recoveryBid = recoveryBid;
      return {
        tripped: true,
        reason: `[v259\u7194\u65AD-\u63D0\u4EF7\u6062\u590D] 7\u5929\u7D2F\u8BA1\u964D\u5E45${(cumulativeDecrease * 100).toFixed(1)}%\u8D85\u8FC7\u4E0A\u9650${BID_CIRCUIT_BREAKER_CONFIG.maxCumulativeDecreasePercent7d * 100}%: \u521D\u59CB$${initialBid.toFixed(2)}\u2192\u5F53\u524D$${currentBid?.toFixed(2)}, \u6267\u884C${BID_CIRCUIT_BREAKER_CONFIG.recoveryBoostPercent * 100}%\u63D0\u4EF7\u6062\u590D\u2192$${recoveryBid.toFixed(2)}`,
        guardrailInfo
      };
    }
    let consecutiveDecreases = 0;
    for (const evt of recentEvents) {
      const prevBid = parseFloat(String(evt.previousBid)) || 0;
      const newBid = parseFloat(String(evt.newBid)) || 0;
      if (newBid < prevBid - 5e-3) {
        consecutiveDecreases++;
      } else {
        break;
      }
    }
    guardrailInfo.consecutiveDecreases = consecutiveDecreases;
    if (consecutiveDecreases >= BID_CIRCUIT_BREAKER_CONFIG.maxConsecutiveDecreases) {
      const recoveryBid = (currentBid || 0) * (1 + BID_CIRCUIT_BREAKER_CONFIG.recoveryBoostPercent * 0.5);
      guardrailInfo.recoveryMode = "consecutive_decrease_recovery";
      guardrailInfo.recoveryBid = recoveryBid;
      return {
        tripped: true,
        reason: `[v259\u7194\u65AD-\u63D0\u4EF7\u6062\u590D] \u5DF2\u8FDE\u7EED${consecutiveDecreases}\u6B21\u964D\u4EF7(\u4E0A\u9650${BID_CIRCUIT_BREAKER_CONFIG.maxConsecutiveDecreases}\u6B21): \u6267\u884C${BID_CIRCUIT_BREAKER_CONFIG.recoveryBoostPercent * 50}%\u63D0\u4EF7\u6062\u590D\u2192$${recoveryBid.toFixed(2)}`,
        guardrailInfo
      };
    }
    const ratioFloor = initialBid * BID_CIRCUIT_BREAKER_CONFIG.minBidFloorRatio;
    let dynamicFloor = ratioFloor;
    let floorSource = "ratio_fallback";
    try {
      const { getDynamicBidFloor: getDynamicBidFloor2 } = await Promise.resolve().then(() => (init_historicalCpcFloorService(), historicalCpcFloorService_exports));
      const entityType = keywordId ? "keyword" : "product_target";
      const entityId = keywordId || targetId || 0;
      const floorResult = await getDynamicBidFloor2(accountId, entityType, entityId, currentBid || 0);
      dynamicFloor = Math.max(floorResult.dynamicFloor, ratioFloor);
      floorSource = floorResult.source;
      guardrailInfo.historicalCpc = floorResult.historicalCpc;
      guardrailInfo.historicalOrders = floorResult.historicalOrders;
      guardrailInfo.floorPeriod = floorResult.periodDescription;
    } catch (floorErr) {
      log63.warn(`[CircuitBreaker] \u52A8\u6001\u5E95\u7EBF\u67E5\u8BE2\u5931\u8D25\uFF0C\u56DE\u9000\u56FA\u5B9A\u6BD4\u4F8B: ${floorErr.message}`);
    }
    guardrailInfo.bidFloor = dynamicFloor;
    guardrailInfo.bidFloorSource = floorSource;
    guardrailInfo.ratioFloor = ratioFloor;
    if (proposedBid < dynamicFloor) {
      const recoveryBid = dynamicFloor * (1 + BID_CIRCUIT_BREAKER_CONFIG.recoveryBoostPercent * 0.5);
      guardrailInfo.recoveryMode = "dynamic_floor_recovery";
      guardrailInfo.recoveryBid = recoveryBid;
      return {
        tripped: true,
        reason: `[v510\u52A8\u6001\u5E95\u7EBF\u4FDD\u62A4] \u62DF\u8C03\u51FA\u4EF7$${proposedBid.toFixed(2)}\u4F4E\u4E8E\u52A8\u6001\u5E95\u7EBF$${dynamicFloor.toFixed(2)}(\u6765\u6E90:${floorSource}): \u6062\u590D\u5230$${recoveryBid.toFixed(2)}`,
        guardrailInfo
      };
    }
    return { tripped: false, reason: "", guardrailInfo };
  } catch (error48) {
    log63.warn(`[CircuitBreaker] \u7194\u65AD\u68C0\u67E5\u5F02\u5E38\uFF0C\u5B89\u5168\u62D2\u7EDD: ${error48.message}`);
    return { tripped: true, reason: `\u7194\u65AD\u68C0\u67E5\u5F02\u5E38(\u5B89\u5168\u62D2\u7EDD): ${error48.message}`, guardrailInfo: {} };
  }
}
function safetyValidate(currentBid, proposedBid, config2, maxBidLimit) {
  if (!isFinite(proposedBid) || isNaN(proposedBid)) {
    return currentBid > 0 ? currentBid : config2.minBid;
  }
  if (!isFinite(currentBid) || isNaN(currentBid)) {
    return Math.max(config2.minBid, Math.min(config2.maxBid, proposedBid));
  }
  let safeBid = proposedBid;
  const effectiveMaxBid = maxBidLimit ? Math.min(config2.maxBid, maxBidLimit) : config2.maxBid;
  safeBid = Math.max(config2.minBid, Math.min(effectiveMaxBid, safeBid));
  if (currentBid > 0) {
    // v608: Symmetric safety - enforce ±20% max change per user requirement
    const maxIncrease = currentBid * (1 + config2.maxBidChangePercent);
    const maxDecrease = currentBid * (1 - config2.maxBidChangePercent);
    safeBid = Math.max(maxDecrease, Math.min(maxIncrease, safeBid));
  }
  safeBid = Math.round(safeBid * 100) / 100;
  safeBid = Math.max(config2.minBid, safeBid);
  return safeBid;
}
function ruleEngineDecision(target, groupConfig) {
  const currentBid = target.currentBid;
  const impressions = target.impressions || 0;
  const clicks = target.clicks || 0;
  const spend = target.spend || 0;
  const sales = target.sales || 0;
  const orders = target.orders || 0;
  const rawAcos = groupConfig.targetAcos || 0.3;
  const targetAcos = rawAcos > 1 ? rawAcos / 100 : rawAcos;
  const maxBid = groupConfig.maxBid || 10;
  const categoryElasticity = (() => {
    const cat = groupConfig.productCategory || "default";
    const ELASTICITY = {
      "electronics": 1.2,
      "computers": 1.1,
      "cell_phones": 1.15,
      "video_games": 1,
      "home_kitchen": 0.85,
      "sports_outdoors": 0.8,
      "toys_games": 0.9,
      "clothing": 0.75,
      "beauty": 0.7,
      "health": 0.65,
      "baby": 0.5,
      "pet_supplies": 0.55,
      "grocery": 0.4,
      "luxury": 0.3,
      "default": 0.8
    };
    return ELASTICITY[cat] || ELASTICITY["default"];
  })();
  const elasticityModifier = Math.max(0.7, Math.min(1.3, categoryElasticity / 0.8));
  const dailyDataForImpression = target.dailyData;
  if (dailyDataForImpression && dailyDataForImpression.length >= 7) {
    const recent3d = dailyDataForImpression.slice(-3);
    const earlier4d = dailyDataForImpression.slice(-7, -3);
    const recentAvgImpressions = recent3d.reduce((sum2, d) => sum2 + (d.impressions || 0), 0) / Math.max(recent3d.length, 1);
    const earlierAvgImpressions = earlier4d.reduce((sum2, d) => sum2 + (d.impressions || 0), 0) / Math.max(earlier4d.length, 1);
    if (earlierAvgImpressions > 50 && recentAvgImpressions < earlierAvgImpressions * BID_CIRCUIT_BREAKER_CONFIG.minImpressionProtectionRatio) {
      const totalRecoveryBoost = Math.min(0.15, BID_CIRCUIT_BREAKER_CONFIG.recoveryBoostPercent);
      const stepRecoveryBoost = totalRecoveryBoost / (BID_CIRCUIT_BREAKER_CONFIG.recoverySteps || 3);
      const recoveryBid = currentBid * (1 + stepRecoveryBoost);
      const impressionDropPct = ((1 - recentAvgImpressions / earlierAvgImpressions) * 100).toFixed(0);
      return {
        bid: recoveryBid,
        confidence: 0.55,
        reason: `[v268\u66DD\u5149\u4FDD\u62A4-\u6E10\u8FDB\u6062\u590D] \u8FD1\u671F\u66DD\u5149\u5747\u503C${recentAvgImpressions.toFixed(0)}\u8F83\u5386\u53F2\u57FA\u7EBF${earlierAvgImpressions.toFixed(0)}\u4E0B\u964D${impressionDropPct}%: \u6E10\u8FDB\u63D0\u4EF7${(stepRecoveryBoost * 100).toFixed(1)}%(\u603B\u76EE\u6807${(totalRecoveryBoost * 100).toFixed(0)}%\u5206${BID_CIRCUIT_BREAKER_CONFIG.recoverySteps}\u6B65)`
      };
    }
    const hasHistoricalPerformance = dailyDataForImpression.some((d) => (d.impressions || 0) > 100);
    if (recentAvgImpressions < 20 && currentBid < 0.5 && hasHistoricalPerformance) {
      const targetSBForRecovery = target.suggestedBid;
      const suggestedBid = targetSBForRecovery && targetSBForRecovery > 0 ? targetSBForRecovery : (groupConfig.maxBid || 10) * 0.15;
      const competitiveRecoveryBid = Math.max(currentBid * 1.5, suggestedBid * 0.8);
      const cappedRecoveryBid = Math.min(competitiveRecoveryBid, (groupConfig.maxBid || 10) * 0.6);
      return {
        bid: cappedRecoveryBid,
        confidence: 0.5,
        reason: `[v268\u7ADE\u4E89\u529B\u6062\u590D] \u66DD\u5149\u6301\u7EED\u4F4E\u8FF7(\u5747\u503C${recentAvgImpressions.toFixed(0)})\u4E14\u51FA\u4EF7\u8F83\u4F4E($${currentBid.toFixed(2)}): \u63D0\u5347\u81F3$${cappedRecoveryBid.toFixed(2)}\u6062\u590D\u5E02\u573A\u7ADE\u4E89\u529B`
      };
    }
  }
  const deterministicHash = /* @__PURE__ */ __name((id, seed = 0) => {
    let h = (id * 2654435761 + seed >>> 0) % 1e4;
    return h / 1e4;
  }, "deterministicHash");
  const entityId = Number(target.keywordId || target.targetId || 0);
  if (impressions === 0) {
    const suggestedBid = target.suggestedBid || void 0;
    const suggestedBidRangeStart = target.suggestedBidRangeStart || void 0;
    const suggestedBidRangeEnd = target.suggestedBidRangeEnd || void 0;
    if (suggestedBid && suggestedBid > 0) {
      let targetBid;
      if (suggestedBidRangeStart && suggestedBidRangeEnd && suggestedBidRangeEnd > suggestedBidRangeStart) {
        targetBid = (suggestedBidRangeStart + suggestedBidRangeEnd) / 2;
      } else {
        targetBid = suggestedBid;
      }
      const suggestedBidCeiling = suggestedBidRangeEnd ? Math.min(suggestedBidRangeEnd * 1.5, maxBid * 0.8) : Math.min(targetBid * 1.5, maxBid * 0.8);
      const suggestedBidFloor = suggestedBidRangeStart ? suggestedBidRangeStart * 0.5 : targetBid * 0.5;
      const safeBid = Math.max(suggestedBidFloor, Math.min(targetBid, suggestedBidCeiling, maxBid));
      if (currentBid >= safeBid * 0.9) {
        return {
          bid: currentBid,
          confidence: 0.5,
          reason: `[v434] \u96F6\u66DD\u5149\u4F46\u51FA\u4EF7\u5DF2\u63A5\u8FD1\u5EFA\u8BAE\u7ADE\u4EF7($${currentBid.toFixed(2)} vs \u5EFA\u8BAE$${safeBid.toFixed(2)}): \u7EF4\u6301\u51FA\u4EF7\uFF0C\u5EFA\u8BAE\u68C0\u67E5\u5173\u952E\u8BCD\u76F8\u5173\u6027`
        };
      }
      const bidGap = safeBid - currentBid;
      const stepBid = currentBid + bidGap * 0.7;
      const finalBid = Math.max(suggestedBidFloor, Math.min(stepBid, suggestedBidCeiling, maxBid));
      return {
        bid: finalBid,
        confidence: 0.65,
        reason: `[v434] \u96F6\u66DD\u5149\u63A2\u7D22(\u5EFA\u8BAE\u7ADE\u4EF7\u5F15\u5BFC): \u4ECE$${currentBid.toFixed(2)}\u5411\u5EFA\u8BAE\u7ADE\u4EF7$${safeBid.toFixed(2)}\u903C\u8FD1\u81F3$${finalBid.toFixed(2)} (\u5EFA\u8BAE\u8303\u56F4=$${(suggestedBidRangeStart || 0).toFixed(2)}-$${(suggestedBidRangeEnd || 0).toFixed(2)}, \u52A8\u6001\u4E0A\u4E0B\u754C=$${suggestedBidFloor.toFixed(2)}-$${suggestedBidCeiling.toFixed(2)})`
      };
    }
    const explorationCeiling = maxBid * 0.4;
    if (currentBid >= explorationCeiling) {
      return {
        bid: currentBid,
        confidence: 0.3,
        reason: `\u96F6\u66DD\u5149\u4F46\u51FA\u4EF7\u5DF2\u8FBE\u63A2\u7D22\u4E0A\u9650($${currentBid.toFixed(2)} >= $${explorationCeiling.toFixed(2)}): \u7EF4\u6301\u51FA\u4EF7\uFF0C\u5EFA\u8BAE\u68C0\u67E5\u5173\u952E\u8BCD\u76F8\u5173\u6027`
      };
    }
    const baseBoostRatio = Math.min(0.15, 0.05 + deterministicHash(entityId, 1) * 0.1);
    const boostRatio = baseBoostRatio * elasticityModifier;
    const newBid = currentBid * (1 + boostRatio);
    const cappedBid = Math.min(newBid, explorationCeiling, maxBid);
    return {
      bid: cappedBid,
      confidence: 0.4,
      reason: `\u96F6\u66DD\u5149\u63A2\u7D22: \u63D0\u5347${(boostRatio * 100).toFixed(0)}%\u4EE5\u83B7\u53D6\u66DD\u5149\u6570\u636E`
    };
  }
  if (clicks === 0 && impressions > 0) {
    if (impressions < 100) {
      const lowClickCeiling = maxBid * 0.5;
      if (currentBid >= lowClickCeiling) {
        return {
          bid: currentBid,
          confidence: 0.3,
          reason: `\u4F4E\u66DD\u5149\u96F6\u70B9\u51FB(${impressions}\u6B21)\u4F46\u51FA\u4EF7\u5DF2\u8FBE\u4E0A\u9650($${currentBid.toFixed(2)}): \u7EF4\u6301\u51FA\u4EF7\u89C2\u5BDF`
        };
      }
      const baseBoostRatio = Math.min(0.1, 0.03 + deterministicHash(entityId, 2) * 0.07);
      const boostRatio = baseBoostRatio * elasticityModifier;
      const newBid = Math.min(currentBid * (1 + boostRatio), lowClickCeiling);
      return {
        bid: newBid,
        confidence: 0.35,
        reason: `\u4F4E\u66DD\u5149\u96F6\u70B9\u51FB(${impressions}\u6B21): \u5C0F\u5E45\u63D0\u5347${(boostRatio * 100).toFixed(0)}%`
      };
    } else {
      const baseReduceRatio = Math.min(0.15, 0.05 + impressions / 1e3 * 0.1);
      const reduceRatio = baseReduceRatio * elasticityModifier;
      return {
        bid: currentBid * (1 - reduceRatio),
        confidence: 0.5,
        reason: `\u9AD8\u66DD\u5149\u96F6\u70B9\u51FB(${impressions}\u6B21): \u964D\u4F4E${(reduceRatio * 100).toFixed(0)}%`
      };
    }
  }
  if (orders === 0 && clicks > 0) {
    const cpc = spend / clicks;
    const realAov = groupConfig.groupAvgAov || 30;
    // v601 P1-2: Aggressive reduction for high-spend zero-conversion keywords
    if (spend > realAov * 2 && clicks > 20) {
      // Spent 2x AOV with 20+ clicks and zero orders = likely poor relevance
      const aggressiveReduce = Math.min(0.20, 0.15 + (spend / (realAov * 4)) * 0.05); // v608: cap at 20% per user requirement
      return {
        bid: currentBid * (1 - aggressiveReduce),
        confidence: 0.80,
        reason: `[v601-P1-2] 零转化高花费紧急降价: ${clicks}次点击花费$${spend.toFixed(2)}(>${realAov.toFixed(0)}x2), 降低${(aggressiveReduce * 100).toFixed(0)}%`
      };
    }
    if (spend > realAov * 1 && clicks > 10) {
      // Spent 1x AOV with 10+ clicks = concerning
      const moderateReduce = Math.min(0.20, 0.10 + (spend / (realAov * 3)) * 0.05); // v608: cap at 20% per user requirement
      return {
        bid: currentBid * (1 - moderateReduce),
        confidence: 0.70,
        reason: `[v601-P1-2] 零转化中等花费降价: ${clicks}次点击花费$${spend.toFixed(2)}, 降低${(moderateReduce * 100).toFixed(0)}%`
      };
    }
    let zeroConvTrendDir = "stable";
    let zeroConvTrendStr = 0;
    const dailyData = target.dailyData;
    if (dailyData && dailyData.length >= 7) {
      try {
        const rawData = dailyData.map((d) => ({
          date: d.date instanceof Date ? d.date.toISOString() : String(d.date),
          impressions: 0,
          clicks: d.clicks || 0,
          spend: d.spend || 0,
          sales: d.sales || 0,
          orders: d.orders || 0
        }));
        const twMetrics = calculateTimeWeightedMetrics(rawData);
        zeroConvTrendDir = twMetrics.trendSignal.direction;
        zeroConvTrendStr = twMetrics.trendSignal.strength;
      } catch {
      }
    }
    const zeroConvTrendLabel = zeroConvTrendDir !== "stable" ? `, \u8D8B\u52BF=${zeroConvTrendDir}` : "";
    const minSpendForDecision = realAov * targetAcos * 0.8;
    if (clicks < 8 || spend < minSpendForDecision) {
      const protectionReason = clicks < 8 ? `\u70B9\u51FB\u4E0D\u8DB3(${clicks}<8)` : `\u82B1\u8D39\u4E0D\u8DB3($${spend.toFixed(2)}<$${minSpendForDecision.toFixed(2)})`;
      return {
        bid: currentBid,
        confidence: 0.35,
        reason: `\u96F6\u8F6C\u5316\u4FDD\u62A4\u671F(${protectionReason}${zeroConvTrendLabel}): v268\u5F52\u56E0\u5EF6\u8FDF\u4FDD\u62A4\uFF0C\u7EF4\u6301\u89C2\u5BDF\u7B49\u5F85\u5F52\u56E0\u5B8C\u6210`
      };
    }
    const baseTolerance = 2.5;
    const attributionToleranceFactor = zeroConvTrendDir === "improving" ? baseTolerance * (1 + zeroConvTrendStr * 0.25) : zeroConvTrendDir === "declining" ? baseTolerance * (1 - zeroConvTrendStr * 0.15) : baseTolerance;
    const maxAcceptableSpend = realAov * targetAcos * attributionToleranceFactor;
    const ctr = impressions > 0 ? clicks / impressions : 0;
    const isHighCtr = ctr > 8e-3;
    if (spend > maxAcceptableSpend) {
      const spendRatio = spend / maxAcceptableSpend;
      const maxReduce = isHighCtr ? 0.1 : 0.15;
      const reduceRatio = Math.min(maxReduce, (spendRatio - 1) * 0.1);
      return {
        bid: currentBid * (1 - reduceRatio),
        confidence: 0.45,
        reason: `\u96F6\u8F6C\u5316\u9AD8\u82B1\u8D39($${spend.toFixed(2)}, AOV=$${realAov.toFixed(0)}, ${spendRatio.toFixed(1)}x\u8D85\u6807, CTR=${(ctr * 100).toFixed(2)}%${zeroConvTrendLabel}): v258\u6E29\u548C\u964D\u4F4E${(reduceRatio * 100).toFixed(0)}%(\u4E0A\u9650${maxReduce * 100}%)`
      };
    }
    if (clicks >= 10) {
      const maxReduce = isHighCtr ? 0.05 : 0.07;
      const reduceRatio = Math.min(maxReduce, clicks / 300);
      return {
        bid: currentBid * (1 - reduceRatio),
        confidence: 0.4,
        reason: `\u96F6\u8F6C\u5316${clicks}\u6B21\u70B9\u51FB($${spend.toFixed(2)}, CTR=${(ctr * 100).toFixed(2)}%${zeroConvTrendLabel}): v258\u6E29\u548C\u964D\u4F4E${(reduceRatio * 100).toFixed(1)}%`
      };
    }
    return {
      bid: currentBid,
      confidence: 0.4,
      reason: `\u96F6\u8F6C\u5316\u4F46\u82B1\u8D39\u53EF\u63A7($${spend.toFixed(2)}, ${clicks}\u6B21\u70B9\u51FB, CTR=${(ctr * 100).toFixed(2)}%): \u7EF4\u6301\u51FA\u4EF7\u89C2\u5BDF`
    };
  }
  if (orders > 0 && sales > 0) {
    const actualAcos = spend / sales;
    const acosRatio = actualAcos / targetAcos;
    const acosDeviationPct = ((acosRatio - 1) * 100).toFixed(1);
    const acosDirection = acosRatio < 1 ? "below_target" : acosRatio <= 1.5 ? "slightly_above" : acosRatio <= 2 ? "moderately_above" : acosRatio <= 3 ? "severely_above" : "extremely_above";
    const acosZone = acosRatio < 0.5 ? "boost_zone" : acosRatio < 0.7 ? "growth_zone" : acosRatio <= 1 ? "target_zone" : acosRatio <= 1.5 ? "caution_zone" : acosRatio <= 2 ? "reduce_zone" : acosRatio <= 3 ? "danger_zone" : "emergency_zone";
    log63.debug(`[v360-BidDecision] ACoS\u504F\u5DEE\u5206\u6790: actual=${(actualAcos * 100).toFixed(1)}%, target=${(targetAcos * 100).toFixed(1)}%, ratio=${acosRatio.toFixed(2)}, deviation=${acosDeviationPct}%, direction=${acosDirection}, zone=${acosZone}`);
    const dataConfidence = clicks < 5 ? 0.5 : clicks < 20 ? 0.5 + (clicks - 5) * 0.023 : Math.min(1, 0.85 + (clicks - 20) * 3e-3);
    const ctr = impressions > 0 ? clicks / impressions : 0;
    const ctrBonus = ctr > 0.01 ? 1.1 : ctr > 5e-3 ? 1.05 : 1;
    const ctrPenalty = ctr < 2e-3 && impressions > 200 ? 0.85 : 1;
    let trendDirection = "stable";
    let trendStrength = 0;
    const dailyData = target.dailyData;
    if (dailyData && dailyData.length >= 7) {
      try {
        const rawData = dailyData.map((d) => ({
          date: d.date instanceof Date ? d.date.toISOString() : String(d.date),
          impressions: 0,
          clicks: d.clicks || 0,
          spend: d.spend || 0,
          sales: d.sales || 0,
          orders: d.orders || 0
        }));
        const twMetrics = calculateTimeWeightedMetrics(rawData);
        trendDirection = twMetrics.trendSignal.direction;
        trendStrength = twMetrics.trendSignal.strength;
      } catch {
      }
    }
    const trendBoostFactor = trendDirection === "improving" ? 1 + trendStrength * 0.15 : trendDirection === "declining" ? 1 - trendStrength * 0.1 : 1;
    const trendReduceFactor = trendDirection === "declining" ? 1 + trendStrength * 0.15 : trendDirection === "improving" ? 1 - trendStrength * 0.1 : 1;
    const trendLabel = trendDirection !== "stable" ? `, \u8D8B\u52BF=${trendDirection}(${(trendStrength * 100).toFixed(0)}%)` : "";
    if (acosRatio < 0.5) {
      const cvr = clicks > 0 ? orders / clicks : 0;
      const isHighCtr = ctr > 0.01;
      const isHighCvr = cvr > 0.05;
      const dynamicMaxBoost = isHighCtr && isHighCvr ? 0.20 : ( // v608: cap at 20%
        isHighCtr && !isHighCvr ? 0.15 : (
          !isHighCtr && isHighCvr ? 0.18 : (
            0.10
          )
        )
      );
      const rawBoostRatio = Math.min(dynamicMaxBoost, (1 - acosRatio) * 0.3);
      const boostRatio = rawBoostRatio * dataConfidence * ctrBonus * trendBoostFactor * elasticityModifier;
      const newBid = Math.min(currentBid * (1 + boostRatio), maxBid * 0.85);
      const qualityLabel = isHighCtr && isHighCvr ? "\u660E\u661F\u8BCD" : isHighCtr ? "\u9AD8\u6D41\u91CF" : isHighCvr ? "\u9AD8\u8F6C\u5316" : "\u4FDD\u5B88";
      return {
        bid: newBid,
        confidence: 0.65 + dataConfidence * 0.2,
        reason: `[v260\u52A8\u6001\u63D0\u4EF7] ACOS\u6781\u4F18(${(actualAcos * 100).toFixed(1)}% vs \u76EE\u6807${(targetAcos * 100).toFixed(1)}%, ${clicks}\u6B21\u70B9\u51FB, CTR=${(ctr * 100).toFixed(2)}%, CVR=${(cvr * 100).toFixed(1)}%${trendLabel}): ${qualityLabel}\u63D0\u5347${(boostRatio * 100).toFixed(1)}%(\u4E0A\u9650${dynamicMaxBoost * 100}%)`
      };
    } else if (acosRatio < 0.7) {
      const cvr = clicks > 0 ? orders / clicks : 0;
      const isHighCvr = cvr > 0.05;
      const dynamicMaxBoost = isHighCvr ? 0.20 : 0.15; // v608: cap at 20%
      const rawBoostRatio = Math.min(dynamicMaxBoost, (1 - acosRatio) * 0.25);
      const boostRatio = rawBoostRatio * dataConfidence * ctrBonus * trendBoostFactor * elasticityModifier;
      return {
        bid: currentBid * (1 + boostRatio),
        confidence: 0.5 + dataConfidence * 0.2,
        reason: `[v260] ACOS\u4F18\u79C0(${(actualAcos * 100).toFixed(1)}% vs \u76EE\u6807${(targetAcos * 100).toFixed(1)}%, ${clicks}\u6B21\u70B9\u51FB, CTR=${(ctr * 100).toFixed(2)}%, CVR=${(cvr * 100).toFixed(1)}%${trendLabel}): \u63D0\u5347${(boostRatio * 100).toFixed(1)}%(\u4E0A\u9650${dynamicMaxBoost * 100}%, \u7F6E\u4FE1\u5EA6${(dataConfidence * 100).toFixed(0)}%)`
      };
    } else if (acosRatio <= 1) {
      const rawAdjustRatio = (1 - acosRatio) * 0.15;
      const minEffectiveRatio = currentBid > 0 ? 0.02 / currentBid : 0.03;
      const baseAdjustRatio = rawAdjustRatio > 1e-3 ? Math.max(rawAdjustRatio, minEffectiveRatio) : rawAdjustRatio;
      const adjustRatio = baseAdjustRatio * dataConfidence * ctrBonus * trendBoostFactor * elasticityModifier;
      return {
        bid: currentBid * (1 + adjustRatio),
        confidence: 0.55 + dataConfidence * 0.15,
        reason: `ACOS\u8FBE\u6807(${(actualAcos * 100).toFixed(1)}%, ${clicks}\u6B21\u70B9\u51FB${trendLabel}): \u5FAE\u8C03${(adjustRatio * 100).toFixed(1)}%${rawAdjustRatio < minEffectiveRatio ? "(\u7CBE\u5EA6\u653E\u5927)" : ""}`
      };
    } else if (acosRatio <= 1.5) {
      const rawReduceRatio = Math.min(0.15, (acosRatio - 1) * 0.25);
      const minEffectiveRatio = currentBid > 0 ? 0.02 / currentBid : 0.03;
      const baseReduceRatio = rawReduceRatio > 1e-3 ? Math.max(rawReduceRatio, minEffectiveRatio) : rawReduceRatio;
      const reduceRatio = baseReduceRatio * dataConfidence * ctrPenalty * trendReduceFactor * elasticityModifier;
      return {
        bid: currentBid * (1 - reduceRatio),
        confidence: 0.5 + dataConfidence * 0.15,
        reason: `ACOS\u504F\u9AD8(${(actualAcos * 100).toFixed(1)}%, ${clicks}\u6B21\u70B9\u51FB, CTR=${(ctr * 100).toFixed(2)}%${trendLabel}): \u964D\u4F4E${(reduceRatio * 100).toFixed(1)}%${rawReduceRatio < minEffectiveRatio ? "(\u7CBE\u5EA6\u653E\u5927)" : ""}`
      };
    } else if (acosRatio <= 2) {
      // v608: 150-200% ACoS reduction capped at 20%
      const isHighCtr = ctr > 8e-3;
      const maxReduceLimit = isHighCtr ? 0.15 : 0.20;
      const baseReduceRatio = (acosRatio - 1) * 0.22;
      const rawReduceRatio = Math.min(maxReduceLimit, baseReduceRatio);
      const reduceRatio = rawReduceRatio * dataConfidence * ctrPenalty * trendReduceFactor * elasticityModifier;
      return {
        bid: currentBid * (1 - reduceRatio),
        confidence: 0.5 + dataConfidence * 0.15,
        reason: `ACOS\u8D85\u6807(${(actualAcos * 100).toFixed(1)}%, ${clicks}\u6B21\u70B9\u51FB, CTR=${(ctr * 100).toFixed(2)}%${trendLabel}): v259\u6E29\u548C\u964D\u4F4E${(reduceRatio * 100).toFixed(1)}%(\u4E0A\u9650${maxReduceLimit * 100}%)`
      };
    } else if (acosRatio <= 3) {
      // v608: 200-300% ACoS reduction capped at 20%
      const isHighCtr = ctr > 8e-3;
      const maxReduceLimit = isHighCtr ? 0.18 : 0.20;
      const baseReduceRatio = (acosRatio - 1) * 0.18;
      const rawReduceRatio = Math.min(maxReduceLimit, baseReduceRatio);
      const reduceRatio = rawReduceRatio * dataConfidence * trendReduceFactor * elasticityModifier;
      return {
        bid: currentBid * (1 - reduceRatio),
        confidence: 0.5 + dataConfidence * 0.2,
        reason: `ACOS\u4E25\u91CD\u8D85\u6807(${(actualAcos * 100).toFixed(1)}%, ${clicks}\u6B21\u70B9\u51FB, CTR=${(ctr * 100).toFixed(2)}%, \u7F6E\u4FE1\u5EA6${(dataConfidence * 100).toFixed(0)}%${trendLabel}): v259\u964D\u4F4E${(reduceRatio * 100).toFixed(1)}%(\u4E0A\u9650${maxReduceLimit * 100}%)`
      };
    } else {
      // v608: ACoS emergency intervention - capped at 20% per user requirement
      const isHighCtr = ctr > 8e-3;
      let maxReduceLimit, baseReduceRatio;
      if (acosRatio > 5) {
        // ACoS > 5x target: emergency slash (capped at 20%)
        maxReduceLimit = 0.20;
        baseReduceRatio = Math.min(maxReduceLimit, 0.15 + (acosRatio - 5) * 0.02);
      } else {
        // ACoS 3-5x target: aggressive reduction (capped at 20%)
        maxReduceLimit = 0.20;
        baseReduceRatio = Math.min(maxReduceLimit, 0.12 + (acosRatio - 3) * 0.04);
      }
      const rawReduceRatio = Math.min(maxReduceLimit, baseReduceRatio);
      const reduceRatio = rawReduceRatio * dataConfidence * trendReduceFactor * elasticityModifier;
      return {
        bid: currentBid * (1 - reduceRatio),
        confidence: 0.6 + dataConfidence * 0.2,
        reason: `ACOS\u6781\u7AEF\u8D85\u6807(${(actualAcos * 100).toFixed(1)}% vs \u76EE\u6807${(targetAcos * 100).toFixed(1)}%, acosRatio=${acosRatio.toFixed(1)}x, ${clicks}\u6B21\u70B9\u51FB, CTR=${(ctr * 100).toFixed(2)}%${trendLabel}): v332\u6FC0\u8FDB\u964D\u4F4E${(reduceRatio * 100).toFixed(1)}%(\u4E0A\u9650${maxReduceLimit * 100}%)`
      };
    }
  }
  return {
    bid: currentBid,
    confidence: 0.3,
    reason: "\u6570\u636E\u4E0D\u8DB3\u4EE5\u505A\u51FA\u5224\u65AD: \u7EF4\u6301\u5F53\u524D\u51FA\u4EF7"
  };
}
async function calculateNextGenBid(accountId, target, groupConfig, maxBidLimit) {
  const rawTargetAcos = groupConfig.targetAcos || DEFAULT_SAFETY.targetAcos;
  const normalizedTargetAcos = rawTargetAcos > 1 ? rawTargetAcos / 100 : rawTargetAcos;
  const evolvedMaxIncrease = groupConfig._evolvedMaxChangePercent;
  const evolvedMaxDecrease = groupConfig._evolvedMaxDecreasePercent;
  const evolvedConfidenceMultiplier = groupConfig._confidenceMultiplier || 1;
  const effectiveMaxChange = evolvedMaxIncrease ? Math.min(evolvedMaxIncrease, 0.20) : 0.20; // v608: user requirement ±20% max change
  const safetyConfig = {
    maxBidChangePercent: effectiveMaxChange,
    minBid: DEFAULT_SAFETY.minBid,
    maxBid: groupConfig.maxBid || DEFAULT_SAFETY.maxBid,
    targetAcos: normalizedTargetAcos
  };
  if (evolvedMaxIncrease) {
    log63.debug(`[NextGenBid] v267 \u81EA\u6211\u8FDB\u5316\u53C2\u6570\u5DF2\u6FC0\u6D3B: maxIncrease=${(evolvedMaxIncrease * 100).toFixed(0)}%, maxDecrease=${(evolvedMaxDecrease * 100).toFixed(0)}%, confidenceMultiplier=${evolvedConfidenceMultiplier.toFixed(2)}`);
  }
  const normalizedConfig = {
    // @ts-ignore
    ...groupConfig,
    targetAcos: normalizedTargetAcos
  };
  // v608: Move cooldown check BEFORE algorithm selection so it applies to ALL paths (advanced + rule engine)
  const earlyKeywordId = target.type === "keyword" ? target.id : void 0;
  const earlyTargetId = target.type === "product_target" ? target.id : void 0;
  const cooldownResult = await isInCooldownPeriod(
    accountId,
    earlyKeywordId,
    earlyTargetId
  );
  if (cooldownResult.inCooldown) {
    log63.debug(`[NextGenOrchestrator] v608\u51B7\u5374\u4FDD\u62A4(\u5168\u5C40): target=${target.id}, ${cooldownResult.reason}`);
    return buildResult2(
      target,
      target.currentBid,
      "cooldown_hold",
      0.5,
      `[\u51B7\u5374\u4FDD\u62A4] ${cooldownResult.reason}: \u7EF4\u6301\u5F53\u524D\u51FA\u4EF7\u907F\u514D\u632F\u8361`,
      "guardrail"
    );
  }
  // v608: Direction consistency check also moved to global scope
  try {
    const dirCheck = await checkBidDirectionConsistency(
      accountId,
      earlyKeywordId,
      earlyTargetId
    );
    if (dirCheck.isOscillating) {
      log63.debug(`[NextGenOrchestrator] v608\u65B9\u5411\u4FDD\u62A4(\u5168\u5C40): target=${target.id}, ${dirCheck.reason}`);
      return buildResult2(
        target,
        target.currentBid,
        "direction_hold",
        0.5,
        `[v608\u65B9\u5411\u4FDD\u62A4] ${dirCheck.reason}: \u68C0\u6D4B\u5230\u51FA\u4EF7\u632F\u8361\u6A21\u5F0F\uFF0C\u5F3A\u5236hold\u7B49\u5F85\u6570\u636E\u7A33\u5B9A`,
        "guardrail"
      );
    }
  } catch (earlyDirErr) {
    log63.warn(`[NextGenOrchestrator] v608\u65B9\u5411\u68C0\u67E5\u5F02\u5E38: ${earlyDirErr.message}`);
  }
  try {
    const keywordId = target.type === "keyword" ? target.id : void 0;
    const targetId = target.type === "product_target" ? target.id : void 0;
    const traceCtx = startAlgorithmTrace(
      accountId,
      target.type === "keyword" ? "keyword" : "product_target",
      target.id,
      // @ts-ignore
      target.amazonCampaignId,
      // @ts-expect-error - dynamic property access
      normalizedConfig.strategyTemplate
    );
    const metaDecision = await selectBestAlgorithm(
      accountId,
      keywordId,
      targetId,
      void 0,
      target.currentBid,
      normalizedConfig.strategyTemplate || null
    );
    const isAdvancedAlgorithm = !["rule_based", "ucb"].includes(metaDecision.selectedAlgorithm);
    const isUcbExploration = metaDecision.selectedAlgorithm === "ucb" && Math.abs(metaDecision.confidence - 0.4) < 0.01 && Math.abs(metaDecision.recommendedBid - target.currentBid) > 5e-3;
    const dynamicConfidenceThreshold = (() => {
      switch (metaDecision.selectedAlgorithm) {
        case "ensemble":
          return 0.3;
        // v273: 从0.35降至0.30，融合算法本身已有多算法交叉验证
        case "cql":
          return 0.2;
        // v273: 从0.25降至0.20，CQL冷启动期更积极探索
        case "linucb":
          return 0.2;
        // v273: 从0.25降至0.20，LinUCB冷启动期更积极探索
        case "sigmoid_curve":
          return 0.25;
        // v273: 从0.30降至0.25，Sigmoid有曲线拟合保证
        // @ts-ignore
        default:
          return 0.25;
      }
    })();
    const evolvedThreshold = dynamicConfidenceThreshold * (1 / evolvedConfidenceMultiplier);
    const hasValidBid = metaDecision.recommendedBid > 0 && metaDecision.confidence > evolvedThreshold;
    if ((isAdvancedAlgorithm || isUcbExploration) && hasValidBid) { // v608: restore advanced algorithms with proper fusion
      const safeBid = safetyValidate(target.currentBid, metaDecision.recommendedBid, safetyConfig, maxBidLimit);
      const advRlCampaignId = String(target.amazonCampaignId || target.campaignId || "");
      const advRlAdGroupId = Number(target.internalAdGroupId || target.adGroupId || 0);
      recordBidAction({
        accountId,
        // @ts-ignore
        keywordId,
        targetId,
        campaignId: advRlCampaignId || void 0,
        adGroupId: advRlAdGroupId || void 0,
        bidBefore: target.currentBid,
        bidAfter: safeBid,
        actionSource: metaDecision.selectedAlgorithm === "linucb" ? "linucb" : metaDecision.selectedAlgorithm === "cql" ? "cql" : "rule_based"
      }).catch((err) => log63.warn("[NextGenOrchestrator] RL recording error:", err));
      try {
        completeAlgorithmTrace(traceCtx, {
          accountId,
          entityType: target.type === "keyword" ? "keyword" : "product_target",
          entityId: target.id,
          // @ts-ignore
          campaignId: target.amazonCampaignId,
          // @ts-expect-error - dynamic property access
          strategyTemplateId: normalizedConfig.strategyTemplate,
          metaSelection: {
            // @ts-ignore
            algorithmScores: metaDecision.algorithmScores?.map((s) => ({ algorithm: s.algorithm, score: s.score, eligible: s.eligible })) || [],
            selectedAlgorithm: metaDecision.selectedAlgorithm,
            fusionMode: metaDecision.fusionMode || "single",
            fusionThreshold: 0.15,
            fusionDetail: metaDecision.fusionDetail || ""
          },
          finalDecision: {
            recommendedBid: safeBid,
            confidence: metaDecision.confidence,
            currentBid: target.currentBid,
            bidChangePercent: target.currentBid > 0 ? (safeBid - target.currentBid) / target.currentBid * 100 : 0
          }
        });
      } catch (_traceErr) {
      }
      return buildResult2(
        target,
        safeBid,
        metaDecision.selectedAlgorithm,
        metaDecision.confidence,
        // @ts-ignore
        `[\u9AD8\u7EA7\u7B97\u6CD5:${metaDecision.selectedAlgorithm}] ${metaDecision.reasoning}`,
        "advanced",
        metaDecision
      );
    }
  } catch (advancedError) {
    log63.warn(`[NextGenOrchestrator] \u9AD8\u7EA7\u7B97\u6CD5\u5F02\u5E38(target=${target.id}), \u964D\u7EA7\u5230\u89C4\u5219\u5F15\u64CE: ${advancedError.message}`);
  }
  try {
    const coldStartTarget = {
      id: target.id,
      type: target.type === "keyword" ? "keyword" : "product_target",
      currentBid: target.currentBid,
      // @ts-ignore
      suggestedBid: target.suggestedBid,
      // @ts-ignore
      suggestedBidRangeStart: target.suggestedBidRangeStart,
      // @ts-ignore
      suggestedBidRangeEnd: target.suggestedBidRangeEnd,
      // @ts-ignore
      matchType: target.matchType,
      // @ts-ignore
      keywordText: target.keywordText,
      // @ts-ignore
      adGroupId: target.internalAdGroupId,
      // @ts-ignore
      campaignId: target.amazonCampaignId,
      // @ts-ignore
      clicks: target.clicks,
      // @ts-ignore
      impressions: target.impressions,
      // @ts-ignore
      spend: target.spend,
      // @ts-ignore
      sales: target.sales,
      // @ts-ignore
      orders: target.orders,
      // @ts-ignore
      createdAt: target.createdAt
    };
    const coldStartResult = await getColdStartBidOverride(
      accountId,
      coldStartTarget,
      normalizedTargetAcos
    );
    if (coldStartResult) {
      const safeBid = safetyValidate(
        target.currentBid,
        coldStartResult.recommendedBid,
        safetyConfig,
        maxBidLimit
      );
      log63.debug(`[NextGenOrchestrator] v490\u51B7\u542F\u52A8\u9A71\u52A8: target=${target.id}, \u7B56\u7565=${coldStartResult.strategy}, \u5148\u9A8C\u6743\u91CD=${(coldStartResult.priorWeight * 100).toFixed(0)}%, \u5EFA\u8BAE\u7ADE\u4EF7=$${coldStartResult.suggestedBidInfo.suggestedBid.toFixed(2)}, \u63A8\u8350\u51FA\u4EF7=$${coldStartResult.recommendedBid.toFixed(2)}, \u5B89\u5168\u51FA\u4EF7=$${safeBid.toFixed(2)}`);
      const keywordId = target.type === "keyword" ? target.id : void 0;
      const targetId = target.type === "product_target" ? target.id : void 0;
      const rlCampaignId = String(target.amazonCampaignId || target.campaignId || "");
      const rlAdGroupId = Number(target.internalAdGroupId || target.adGroupId || 0);
      recordBidAction({
        accountId,
        keywordId,
        targetId,
        campaignId: rlCampaignId || void 0,
        adGroupId: rlAdGroupId || void 0,
        bidBefore: target.currentBid,
        bidAfter: safeBid,
        actionSource: "cold_start"
      }).catch((err) => log63.warn("[NextGenOrchestrator] RL recording error:", err));
      return buildResult2(
        target,
        safeBid,
        `cold_start_${coldStartResult.strategy}`,
        coldStartResult.confidence,
        `${coldStartResult.reason}`,
        "rule_engine"
      );
    }
  } catch (coldStartErr) {
    log63.warn(`[NextGenOrchestrator] v490\u51B7\u542F\u52A8\u5F15\u64CE\u5F02\u5E38(target=${target.id}): ${coldStartErr.message}`);
  }
  // v608: cooldown + direction checks moved to top of calculateNextGenBid (applies to ALL paths)
  try {
    const ruleResult = ruleEngineDecision(target, normalizedConfig);
    let safeBid = safetyValidate(target.currentBid, ruleResult.bid, safetyConfig, maxBidLimit);
    let finalReason = ruleResult.reason;
    if (!meetsMinimumAdjustment(target.currentBid, safeBid)) {
      safeBid = target.currentBid;
      finalReason += " | v257: \u8C03\u6574\u5E45\u5EA6\u4F4E\u4E8E\u6700\u5C0F\u9608\u503C\uFF0C\u7EF4\u6301\u4E0D\u53D8";
    }
    if (safeBid < target.currentBid - 5e-3) {
      try {
        const { isInCliffRecoveryLockdown: isInCliffRecoveryLockdown2 } = await Promise.resolve().then(() => (init_dataCliffAutoRecoveryEngine(), dataCliffAutoRecoveryEngine_exports));
        const lockdown = await isInCliffRecoveryLockdown2(
          accountId,
          target.type === "keyword" ? "keyword" : "product_target",
          target.id
        );
        if (lockdown.locked) {
          log63.debug(`[NextGenOrchestrator] v510\u65AD\u5D16\u9501\u5B9A: target=${target.id}, ${lockdown.reason}`);
          return buildResult2(
            target,
            target.currentBid,
            "cliff_lockdown_hold",
            0.6,
            `${lockdown.reason}: \u7EF4\u6301\u5F53\u524D\u51FA\u4EF7\u7B49\u5F85\u6D41\u91CF\u6062\u590D`,
            "guardrail"
          );
        }
      } catch (lockdownErr) {
        log63.warn(`[NextGenOrchestrator] v510\u65AD\u5D16\u9501\u5B9A\u68C0\u67E5\u5F02\u5E38: ${lockdownErr.message}`);
      }
    }
    if (safeBid < target.currentBid - 5e-3) {
      const keywordId2 = target.type === "keyword" ? target.id : void 0;
      const targetIdForCB = target.type === "product_target" ? target.id : void 0;
      const cbResult = await checkCircuitBreaker(accountId, keywordId2, targetIdForCB, target.currentBid, safeBid);
      if (cbResult.tripped) {
        log63.warn(`[NextGenOrchestrator] v259\u7194\u65AD\u63D0\u4EF7\u6062\u590D: target=${target.id}, ${cbResult.reason}`);
        if (cbResult.guardrailInfo.recoveryBid && cbResult.guardrailInfo.recoveryBid > target.currentBid) {
          safeBid = safetyValidate(target.currentBid, cbResult.guardrailInfo.recoveryBid, safetyConfig, maxBidLimit);
          finalReason = `[v259\u63D0\u4EF7\u6062\u590D] ${cbResult.reason}`;
        } else {
          safeBid = target.currentBid;
          finalReason += ` | ${cbResult.reason}`;
        }
        finalReason += ` | guardrail: ${JSON.stringify({
          consecutiveDecreases: cbResult.guardrailInfo.consecutiveDecreases,
          cumulativeDecrease7d: cbResult.guardrailInfo.cumulativeDecrease7d,
          initialBid7d: cbResult.guardrailInfo.initialBid7d,
          recoveryMode: cbResult.guardrailInfo.recoveryMode,
          recoveryBid: cbResult.guardrailInfo.recoveryBid
        })}`;
      }
    }
    const isEffectivelyHold = Math.abs(safeBid - target.currentBid) <= 5e-3;
    const entityId = Number(target.id);
    const hourSeed = Math.floor(Date.now() / (4 * 36e5));
    const explorationHash = (entityId * 2654435761 + hourSeed * 1597334677 >>> 0) % 100;
    const EXPLORATION_RATE_HOLD = 30;
    const EXPLORATION_RATE_ACTIVE = 10;
    const shouldExplore = isEffectivelyHold ? explorationHash < EXPLORATION_RATE_HOLD && target.currentBid > 0.05 : explorationHash < EXPLORATION_RATE_ACTIVE;
    if (shouldExplore) {
      const directionHash = (entityId * 1103515245 + hourSeed >>> 0) % 100;
      const gradientHash = Math.abs((entityId * 2654435761 + hourSeed * 40503 >>> 0) % 100);
      const gradientVal = gradientHash;
      let explorationRatio;
      if (gradientVal < 50) {
        explorationRatio = 0.03 + gradientVal / 50 * 0.02;
      } else if (gradientVal < 80) {
        explorationRatio = 0.05 + (gradientVal - 50) / 30 * 0.03;
      } else {
        explorationRatio = 0.08 + (gradientVal - 80) / 20 * 0.04;
      }
      const minExplorationRatio = target.currentBid > 0 ? 0.02 / target.currentBid : 0.03;
      explorationRatio = Math.max(minExplorationRatio, explorationRatio);
      let explorationBid;
      if (isEffectivelyHold) {
        explorationBid = directionHash < 50 ? target.currentBid * (1 + explorationRatio) : target.currentBid * (1 - explorationRatio);
      } else {
        const perturbRatio = explorationRatio * 0.3;
        explorationBid = directionHash < 50 ? safeBid * (1 + perturbRatio) : safeBid * (1 - perturbRatio);
      }
      safeBid = safetyValidate(target.currentBid, explorationBid, safetyConfig, maxBidLimit);
      const exploreType = isEffectivelyHold ? "RL\u63A2\u7D22" : "RL\u6270\u52A8";
      const exploreDir = directionHash < 50 ? "\u4E0A\u63A2" : "\u4E0B\u63A2";
      finalReason += ` | v257${exploreType}: ${exploreDir}${(explorationRatio * 100).toFixed(1)}%`;
      log63.debug(`[NextGenOrchestrator] v257\u4E3B\u52A8\u63A2\u7D22: target=${target.id}, \u7C7B\u578B=${exploreType}, \u65B9\u5411=${exploreDir}, \u5E45\u5EA6=${(explorationRatio * 100).toFixed(1)}%, $${target.currentBid.toFixed(2)} \u2192 $${safeBid.toFixed(2)}`);
    }
    const keywordId = target.type === "keyword" ? target.id : void 0;
    const targetId = target.type === "product_target" ? target.id : void 0;
    const ruleRlCampaignId = String(target.amazonCampaignId || target.campaignId || "");
    const ruleRlAdGroupId = Number(target.internalAdGroupId || target.adGroupId || 0);
    recordBidAction({
      accountId,
      keywordId,
      targetId,
      campaignId: ruleRlCampaignId || void 0,
      adGroupId: ruleRlAdGroupId || void 0,
      bidBefore: target.currentBid,
      bidAfter: safeBid,
      actionSource: "rule_based"
    }).catch((err) => log63.warn("[NextGenOrchestrator] RL recording error:", err));
    return buildResult2(
      target,
      safeBid,
      "rule_engine",
      ruleResult.confidence,
      `[\u89C4\u5219\u5F15\u64CE] ${finalReason}`,
      "rule_engine"
    );
  } catch (ruleError) {
    log63.warn(`[NextGenOrchestrator] \u89C4\u5219\u5F15\u64CE\u5F02\u5E38(target=${target.id}): ${ruleError.message}`);
  }
  return buildResult2(
    target,
    target.currentBid,
    "conservative",
    0.1,
    "[\u4FDD\u5B88\u7B56\u7565] \u7B97\u6CD5\u5F02\u5E38\uFF0C\u7EF4\u6301\u5F53\u524D\u51FA\u4EF7",
    "conservative"
  );
}
function buildResult2(target, newBid, algorithmUsed, confidence, reason, tier2, metaDecision) {
  const bidChangePercent = target.currentBid > 0 ? (newBid - target.currentBid) / target.currentBid * 100 : 0;
  let actionType = "hold";
  if (Math.abs(newBid - target.currentBid) > 5e-3) {
    actionType = newBid > target.currentBid ? "increase" : "decrease";
  }
  const reasonDetails = {
    triggerRule: tier2 === "advanced" ? `\u9AD8\u7EA7\u7B97\u6CD5:${algorithmUsed}` : tier2 === "conservative" ? "\u4FDD\u5B88\u7B56\u7565:\u7B97\u6CD5\u5F02\u5E38\u5146\u5E95" : tier2 === "guardrail" ? `\u62A4\u680F\u4FDD\u62A4:${algorithmUsed}` : `\u89C4\u5219\u5F15\u64CE:${reason.split(":")[0]?.replace("[\u89C4\u5219\u5F15\u64CE] ", "") || algorithmUsed}`,
    coreMetrics: {
      // @ts-ignore
      clicks: target.clicks,
      // @ts-ignore
      impressions: target.impressions,
      // @ts-ignore
      spend: target.spend,
      // @ts-ignore
      sales: target.sales,
      // @ts-ignore
      orders: target.orders
    },
    algorithmChoice: `${tier2}/${algorithmUsed}`,
    dataConfidence: confidence
  };
  const guardrailInfo = {
    cooldownActive: algorithmUsed === "cooldown_hold",
    circuitBreakerTripped: reason.includes("\u7194\u65AD") || reason.includes("circuit_breaker"),
    arbitrationApplied: false,
    minAdjustmentFiltered: reason.includes("\u8C03\u6574\u5E45\u5EA6\u4F4E\u4E8E\u6700\u5C0F\u9608\u503C"),
    maxBidCapped: reason.includes("max_bid"),
    // v259新增护栏标识
    bidRecoveryTriggered: reason.includes("\u63D0\u4EF7\u6062\u590D") || reason.includes("recovery_bid") || reason.includes("\u7194\u65AD\u63D0\u4EF7"),
    exposureProtectionActive: reason.includes("\u66DD\u5149\u4FDD\u62A4") || reason.includes("exposure_protection") || reason.includes("\u66DD\u5149\u5927\u5E45\u4E0B\u964D"),
    bidirectionalBid: actionType === "increase" && (reason.includes("ACOS\u6781\u4F18") || reason.includes("ACOS\u4F18\u79C0") || reason.includes("\u53CC\u5411\u51FA\u4EF7")),
    // @ts-ignore
    details: reason.includes("guardrail") ? reason.split("guardrail:")[1]?.trim() : void 0
  };
  const correctionLayers = {
    gtoApplied: false,
    gtoCompositeModifier: void 0,
    gtoActiveEngines: void 0,
    cascadeFusionApplied: metaDecision?.fusionMode === "cascade_ensemble",
    cascadeFusionAlgorithms: metaDecision?.fusionMode === "cascade_ensemble" ? metaDecision.algorithmScores?.filter((s) => s.eligible).slice(0, 2).map((s) => s.algorithm) : void 0,
    cascadeFusionDetail: metaDecision?.fusionDetail || void 0,
    causalInferenceApplied: false
  };
  const metaLearningDetail = metaDecision ? {
    candidateAlgorithms: metaDecision.algorithmScores?.map((s) => ({
      algorithm: s.algorithm,
      score: s.score,
      eligible: s.eligible,
      reason: s.reason
    })) || [],
    selectedAlgorithm: metaDecision.selectedAlgorithm,
    selectionReason: metaDecision.reasoning,
    fusionMode: metaDecision.fusionMode || "single",
    fusionDetail: metaDecision.fusionDetail || "",
    // @ts-ignore
    dynamicConfidenceThreshold: 0,
    // 将在调用处填充
    // @ts-ignore
    evolvedConfidenceMultiplier: 1
    // 将在调用处填充
    // @ts-ignore
  } : void 0;
  return {
    targetId: target.id,
    targetType: target.type,
    previousBid: target.currentBid,
    newBid,
    actionType,
    // @ts-ignore
    bidChangePercent: Math.round(bidChangePercent * 100) / 100,
    // @ts-ignore
    reason,
    algorithmUsed,
    confidence,
    // @ts-ignore
    metaDecision,
    algorithmTier: tier2,
    // @ts-ignore
    reasonDetails,
    guardrailInfo,
    correctionLayers,
    metaLearningDetail
  };
}
async function batchCalculateNextGenBids(accountId, targets, groupConfig, maxBidLimit) {
  let gtoModifiers = /* @__PURE__ */ new Map();
  try {
    const currentHour = (/* @__PURE__ */ new Date()).getUTCHours();
    const totalSpend = targets.reduce((s, t2) => s + t2.spend, 0);
    const totalSales = targets.reduce((s, t2) => s + t2.sales, 0);
    const totalOrders = targets.reduce((s, t2) => s + t2.orders, 0);
    const valueTargets = targets.filter((t2) => t2.orders > 0);
    const drawingTargets = targets.filter((t2) => t2.orders === 0 && t2.clicks >= 5);
    const gtoContext = {
      accountId,
      currentHour,
      totalDailyBudget: groupConfig.maxBid ? groupConfig.maxBid * targets.length * 0.5 : 100,
      // @ts-ignore
      ventureSpentToday: drawingTargets.reduce((s, t2) => s + t2.spend, 0),
      // @ts-ignore
      ventureSalesToday: drawingTargets.reduce((s, t2) => s + t2.sales, 0),
      pulseHistory: /* @__PURE__ */ new Map(),
      // 将在未来版本中从数据库加载
      hourlySignals: [],
      // 将在未来版本中从 hourly_performance 表加载
      // @ts-ignore
      corePoolRoas: totalSpend > 0 ? totalSales / totalSpend : 1,
      targetRoas: groupConfig.targetAcos ? 1 / (groupConfig.targetAcos > 1 ? groupConfig.targetAcos / 100 : groupConfig.targetAcos) : 3.33,
      totalExploredKeywords: drawingTargets.length,
      graduatedKeywords: Math.round(valueTargets.length * 0.1)
      // 估算毕业率
    };
    gtoModifiers = batchCalculateGTOModifiers(targets, groupConfig, gtoContext);
    log63.info(`[NextGenOrchestrator] GTO\u4FEE\u6B63\u5C42\u5DF2\u542F\u7528: ${gtoModifiers.size}\u4E2A\u76EE\u6807\u83B7\u5F97\u4FEE\u6B63\u7CFB\u6570`);
  } catch (gtoError) {
    log63.warn(`[NextGenOrchestrator] GTO\u4FEE\u6B63\u5C42\u5F02\u5E38(\u5DF2\u964D\u7EA7): ${gtoError.message}`);
  }
  let nashRanges = /* @__PURE__ */ new Map();
  try {
    const nashTargets = targets.map((t2) => {
      const targetSuggestedBid = t2.suggestedBid;
      const targetSuggestedBidRangeStart = t2.suggestedBidRangeStart;
      const targetSuggestedBidRangeEnd = t2.suggestedBidRangeEnd;
      return {
        id: t2.id,
        type: t2.type,
        currentBid: t2.currentBid,
        suggestedBid: targetSuggestedBid && targetSuggestedBid > 0 ? targetSuggestedBid : void 0,
        suggestedBidRangeStart: targetSuggestedBidRangeStart && targetSuggestedBidRangeStart > 0 ? targetSuggestedBidRangeStart : void 0,
        suggestedBidRangeEnd: targetSuggestedBidRangeEnd && targetSuggestedBidRangeEnd > 0 ? targetSuggestedBidRangeEnd : void 0
      };
    });
    nashRanges = await batchPreloadNashRanges(accountId, nashTargets);
    log63.info(`[NextGenOrchestrator] v490\u7EB3\u4EC0\u5747\u8861\u5C42\u5DF2\u542F\u7528: ${nashRanges.size}\u4E2A\u76EE\u6807\u83B7\u5F97\u5747\u8861\u533A\u95F4`);
  } catch (nashError) {
    log63.warn(`[NextGenOrchestrator] v490\u7EB3\u4EC0\u5747\u8861\u5C42\u5F02\u5E38(\u5DF2\u964D\u7EA7): ${nashError.message}`);
  }
  let causalMap = /* @__PURE__ */ new Map();
  try {
    const causalDb = await getDb();
    if (!causalDb) throw new Error("DB not available for causal inference");
    const recentDate = /* @__PURE__ */ new Date();
    recentDate.setDate(recentDate.getDate() - 7);
    const causalResults = await causalDb.select({
      keywordId: causalInferenceResults.keywordId,
      targetId: causalInferenceResults.targetId,
      optimalBid: causalInferenceResults.optimalBid,
      upliftScore: causalInferenceResults.upliftScore,
      incrementalProfit: causalInferenceResults.incrementalProfit,
      confidenceInterval: causalInferenceResults.confidenceInterval,
      sampleSize: causalInferenceResults.sampleSize
    }).from(causalInferenceResults).where(and(
      eq(causalInferenceResults.accountId, accountId),
      gte(causalInferenceResults.analysisDate, recentDate.toISOString().split("T")[0])
    )).orderBy(desc(causalInferenceResults.createdAt)).limit(500);
    for (const cr of causalResults) {
      const key = cr.keywordId ? `kw_${cr.keywordId}` : cr.targetId ? `tg_${cr.targetId}` : null;
      if (key && !causalMap.has(key)) {
        causalMap.set(key, {
          optimalBid: Number(cr.optimalBid) || 0,
          upliftScore: Number(cr.upliftScore) || 0,
          incrementalProfit: Number(cr.incrementalProfit) || 0,
          confidence: cr.confidenceInterval ? Math.max(0, 1 - Number(cr.confidenceInterval)) : 0.5,
          sampleSize: cr.sampleSize || 0
        });
      }
    }
    if (causalMap.size > 0) {
      log63.info(`[NextGenOrchestrator] v274 \u56E0\u679C\u63A8\u65AD\u4FE1\u53F7\u5DF2\u52A0\u8F7D: ${causalMap.size}\u4E2A\u5173\u952E\u8BCD/\u5B9A\u5411`);
    }
  } catch (causalErr) {
    log63.warn(`[NextGenOrchestrator] v274 \u56E0\u679C\u63A8\u65AD\u52A0\u8F7D\u5F02\u5E38(\u5DF2\u964D\u7EA7): ${causalErr.message}`);
  }
  let paretoTiers = /* @__PURE__ */ new Map();
  try {
    const campaignIds = targets.map((t2) => t2.amazonCampaignId || t2.campaignId).filter(Boolean);
    if (campaignIds.length > 0) {
      paretoTiers = await batchGetParetoTiers(accountId, campaignIds);
      log63.info(`[NextGenOrchestrator] v490\u5E15\u7D2F\u6258\u5206\u5C42\u5DF2\u542F\u7528: ${paretoTiers.size}\u4E2A\u5E7F\u544A\u6D3B\u52A8\u83B7\u5F97\u5206\u5C42\u6743\u91CD`);
    }
  } catch (paretoError) {
    log63.warn(`[NextGenOrchestrator] v490\u5E15\u7D2F\u6258\u5206\u5C42\u5F02\u5E38(\u5DF2\u964D\u7EA7): ${paretoError.message}`);
  }
  let trendSignals = /* @__PURE__ */ new Map();
  try {
    const forecastCampaignIds = targets.map((t2) => t2.amazonCampaignId || t2.campaignId).filter(Boolean);
    if (forecastCampaignIds.length > 0) {
      trendSignals = await batchForecastCampaignTrends(accountId, forecastCampaignIds);
      log63.info(`[NextGenOrchestrator] v490\u65F6\u5E8F\u9884\u6D4B\u5DF2\u542F\u7528: ${trendSignals.size}\u4E2A\u5E7F\u544A\u6D3B\u52A8\u83B7\u5F97\u8D8B\u52BF\u4FE1\u53F7`);
    }
  } catch (forecastError) {
    log63.warn(`[NextGenOrchestrator] v490\u65F6\u5E8F\u9884\u6D4B\u5F02\u5E38(\u5DF2\u964D\u7EA7): ${forecastError.message}`);
  }
  const results = [];
  for (const target of targets) {
    const result = await calculateNextGenBid(accountId, target, groupConfig, maxBidLimit);
    // v608c: 冷却保护和方向保护的结果不应被后续修正层覆盖
    const isGuardrailHold = result.algorithmUsed === "cooldown_hold" || result.algorithmUsed === "direction_hold";
    if (isGuardrailHold) {
      results.push(result);
      continue;
    }
    const causalKey = target.type === "keyword" ? `kw_${target.id}` : target.type === "product_target" ? `tg_${target.id}` : null;
    const causalData = causalKey ? causalMap.get(causalKey) : null;
    if (causalData && causalData.optimalBid > 0 && causalData.sampleSize >= 3 && causalData.confidence > 0.3) {
      const causalWeight = Math.min(0.3, causalData.confidence * 0.3);
      const blendedBid = result.newBid * (1 - causalWeight) + causalData.optimalBid * causalWeight;
      const causalCorrectedBid = Math.round(blendedBid * 100) / 100;
      const maxCausalDelta = result.newBid * 0.15;
      const finalCausalBid = Math.max(
        result.newBid - maxCausalDelta,
        Math.min(result.newBid + maxCausalDelta, causalCorrectedBid)
      );
      result.causalAdjustment = {
        optimalBid: causalData.optimalBid,
        upliftScore: causalData.upliftScore,
        incrementalProfit: causalData.incrementalProfit,
        confidence: causalData.confidence,
        applied: Math.abs(finalCausalBid - result.newBid) > 5e-3
      };
      if (result.causalAdjustment.applied) {
        result.newBid = finalCausalBid;
        result.reason += ` | \u56E0\u679C\u4FEE\u6B63: uplift=${causalData.upliftScore.toFixed(3)}, \u6700\u4F18\u51FA\u4EF7=$${causalData.optimalBid.toFixed(2)}`;
      }
      if (result.correctionLayers) {
        result.correctionLayers.causalInferenceApplied = result.causalAdjustment.applied;
      }
    }
    const gtoMod = gtoModifiers.get(target.id);
    if (gtoMod && gtoMod.compositeModifier !== 1) {
      const baseBid = result.newBid;
      const gtoCorrectedBid = Math.round(baseBid * gtoMod.compositeModifier * 100) / 100;
      const safetyConfig = {
        maxBidChangePercent: DEFAULT_SAFETY.maxBidChangePercent,
        minBid: DEFAULT_SAFETY.minBid,
        maxBid: groupConfig.maxBid || DEFAULT_SAFETY.maxBid,
        targetAcos: groupConfig.targetAcos && groupConfig.targetAcos > 1 ? groupConfig.targetAcos / 100 : groupConfig.targetAcos || DEFAULT_SAFETY.targetAcos
      };
      const safeBid = safetyValidate(target.currentBid, gtoCorrectedBid, safetyConfig, maxBidLimit);
      result.newBid = safeBid;
      result.bidChangePercent = target.currentBid > 0 ? Math.round((safeBid - target.currentBid) / target.currentBid * 1e4) / 100 : 0;
      result.actionType = Math.abs(safeBid - target.currentBid) > 5e-3 ? safeBid > target.currentBid ? "increase" : "decrease" : "hold";
      result.reason += ` | GTO\u4FEE\u6B63: ${gtoMod.reasoning}`;
      result.gtoModifier = gtoMod;
      if (result.correctionLayers) {
        result.correctionLayers.gtoApplied = true;
        result.correctionLayers.gtoCompositeModifier = gtoMod.compositeModifier;
        const activeEngines = [];
        if (gtoMod.breakdown) {
          if (gtoMod.breakdown.evModifier !== 1) activeEngines.push("ev_analysis");
          if (gtoMod.breakdown.explorationModifier !== 1) activeEngines.push("exploration");
          if (gtoMod.breakdown.budgetModifier !== 1) activeEngines.push("budget_pool");
          if (gtoMod.breakdown.windowModifier !== 1) activeEngines.push("opportunity_window");
          if (gtoMod.breakdown.portfolioModifier !== 1) activeEngines.push("portfolio_role");
          if (gtoMod.breakdown.competitionModifier !== 1) activeEngines.push("competition");
        }
        result.correctionLayers.gtoActiveEngines = activeEngines;
      }
    }
    const nashKey = `${target.type}_${target.id}`;
    const nashRange = nashRanges.get(nashKey);
    if (nashRange && nashRange.confidence >= 0.25) {
      const nashResult = applyNashConstraint(result.newBid, nashRange, target.currentBid);
      result.nashEquilibrium = {
        bidFloor: nashRange.bidFloor,
        // @ts-ignore
        bidCeiling: nashRange.bidCeiling,
        // @ts-ignore
        optimalBid: nashRange.optimalBid,
        confidence: nashRange.confidence,
        // @ts-ignore
        source: nashRange.source,
        constrained: nashResult.wasConstrained
        // @ts-ignore
      };
      if (nashResult.wasConstrained) {
        result.newBid = nashResult.constrainedBid;
        result.bidChangePercent = target.currentBid > 0 ? Math.round((nashResult.constrainedBid - target.currentBid) / target.currentBid * 1e4) / 100 : 0;
        result.actionType = Math.abs(nashResult.constrainedBid - target.currentBid) > 5e-3 ? nashResult.constrainedBid > target.currentBid ? "increase" : "decrease" : "hold";
        result.reason += ` | ${nashResult.constraintReason}`;
      }
    }
    const campaignIdStr = String(target.amazonCampaignId || target.campaignId || "");
    const paretoResult = campaignIdStr ? paretoTiers.get(campaignIdStr) : null;
    if (paretoResult) {
      const paretoAdj = applyParetoWeight(target.currentBid, result.newBid, paretoResult);
      result.paretoTier = {
        // @ts-ignore
        tier: paretoResult.tier,
        // @ts-ignore
        rank: paretoResult.paretoRank,
        // @ts-ignore
        profitContribution: paretoResult.profitContribution,
        // @ts-ignore
        bidWeightMultiplier: paretoResult.bidWeightMultiplier,
        // @ts-ignore
        budgetWeightMultiplier: paretoResult.budgetWeightMultiplier,
        // @ts-ignore
        applied: paretoAdj.paretoApplied,
        // @ts-ignore
        reason: paretoAdj.reason
      };
      if (paretoAdj.paretoApplied) {
        result.newBid = paretoAdj.adjustedBid;
        result.bidChangePercent = target.currentBid > 0 ? Math.round((paretoAdj.adjustedBid - target.currentBid) / target.currentBid * 1e4) / 100 : 0;
        result.actionType = Math.abs(paretoAdj.adjustedBid - target.currentBid) > 5e-3 ? paretoAdj.adjustedBid > target.currentBid ? "increase" : "decrease" : "hold";
        result.reason += ` | ${paretoAdj.reason}`;
      }
    }
    const trendCampaignId = String(target.amazonCampaignId || target.campaignId || "");
    const trendSignal = trendCampaignId ? trendSignals.get(trendCampaignId) : null;
    if (trendSignal && trendSignal.direction !== "stable" && trendSignal.strength >= 0.1) {
      const trendAdj = applyTrendModifier(target.currentBid, result.newBid, trendSignal);
      result.trendForecast = {
        // @ts-ignore
        direction: trendSignal.direction,
        // @ts-ignore
        strength: trendSignal.strength,
        // @ts-ignore
        bidModifier: trendSignal.bidModifier,
        // @ts-ignore
        applied: trendAdj.applied,
        // @ts-ignore
        reason: trendAdj.reason
      };
      if (trendAdj.applied) {
        result.newBid = trendAdj.adjustedBid;
        result.bidChangePercent = target.currentBid > 0 ? Math.round((trendAdj.adjustedBid - target.currentBid) / target.currentBid * 1e4) / 100 : 0;
        result.actionType = Math.abs(trendAdj.adjustedBid - target.currentBid) > 5e-3 ? trendAdj.adjustedBid > target.currentBid ? "increase" : "decrease" : "hold";
        result.reason += ` | ${trendAdj.reason}`;
      }
    }
    {
      const tierWeightMultiplier = (() => {
        switch (result.algorithmTier) {
          // @ts-ignore
          case "cold_start":
            return 0.4;
          // 冷启动期：迁移权重最高（自身数据最少）
          case "rule_engine":
            return 0.3;
          // 规则引擎：迁移权重较高
          case "advanced":
            return 0.15;
          // 高级算法：迁移权重保守（仅作为参考信号）
          case "conservative":
            return 0.25;
          // 保守策略：迁移权重中等
          default:
            return 0.2;
        }
      })();
      try {
        const transferParams = await getTransferPriorForCampaign(accountId, String(target.amazonCampaignId || target.campaignId || ""));
        if (transferParams && transferParams.transferWeight > 0) {
          const effectiveWeight = transferParams.transferWeight * tierWeightMultiplier;
          const blendedBid = blendTransferWithOwn(
            transferParams.suggestedBid,
            result.newBid,
            effectiveWeight
          );
          result.crossProductTransfer = {
            applied: Math.abs(blendedBid - result.newBid) > 5e-3,
            transferWeight: effectiveWeight,
            sourceCampaigns: transferParams.sourceInfo.campaignNames.slice(0, 3),
            suggestedBid: transferParams.suggestedBid,
            confidence: transferParams.confidence,
            reason: `\u8DE8\u54C1\u8FC1\u79FB(${result.algorithmTier}): \u6765\u6E90=${transferParams.sourceInfo.campaignNames.length}\u4E2A\u6D3B\u52A8, \u539F\u59CB\u6743\u91CD=${transferParams.transferWeight.toFixed(2)}, tier\u7CFB\u6570=${tierWeightMultiplier}, \u6709\u6548\u6743\u91CD=${effectiveWeight.toFixed(2)}, \u7F6E\u4FE1\u5EA6=${transferParams.confidence}`
          };
          if (result.crossProductTransfer.applied) {
            result.newBid = Math.round(blendedBid * 100) / 100;
            result.reason += ` | v491-\u8DE8\u54C1\u8FC1\u79FB\u878D\u5408(${result.algorithmTier})`;
          }
        }
      } catch {
      }
    }
    results.push(result);
  }
  const advanced = results.filter((r) => r.algorithmTier === "advanced").length;
  const ruleEngine = results.filter((r) => r.algorithmTier === "rule_engine").length;
  const conservative = results.filter((r) => r.algorithmTier === "conservative").length;
  const guardrail = results.filter((r) => r.algorithmTier === "guardrail").length;
  const changed = results.filter((r) => r.actionType !== "hold").length;
  const gtoApplied = results.filter((r) => r.gtoModifier && r.gtoModifier.compositeModifier !== 1).length;
  const causalApplied = results.filter((r) => r.causalAdjustment?.applied).length;
  const nashConstrained = results.filter((r) => r.nashEquilibrium?.constrained).length;
  const nashLoaded = results.filter((r) => r.nashEquilibrium).length;
  const paretoApplied = results.filter((r) => r.paretoTier?.applied).length;
  const paretoLoaded = results.filter((r) => r.paretoTier).length;
  const trendApplied = results.filter((r) => r.trendForecast?.applied).length;
  const trendLoaded = results.filter((r) => r.trendForecast).length;
  const transferApplied = results.filter((r) => r.crossProductTransfer?.applied).length;
  const transferLoaded = results.filter((r) => r.crossProductTransfer).length;
  log63.info(`[NextGenOrchestrator] v490\u6279\u91CF\u51FA\u4EF7\u5B8C\u6210: \u603B\u8BA1=${targets.length}, \u9AD8\u7EA7\u7B97\u6CD5=${advanced}, \u89C4\u5219\u5F15\u64CE=${ruleEngine}, \u62A4\u680F\u4FDD\u62A4=${guardrail}, \u4FDD\u5B88\u7B56\u7565=${conservative}, \u5B9E\u9645\u8C03\u6574=${changed}, GTO\u4FEE\u6B63=${gtoApplied}, \u56E0\u679C\u4FEE\u6B63=${causalApplied}, \u7EB3\u4EC0\u5747\u8861\u52A0\u8F7D=${nashLoaded}, \u7EB3\u4EC0\u7EA6\u675F=${nashConstrained}, \u5E15\u7D2F\u6258\u52A0\u8F7D=${paretoLoaded}, \u5E15\u7D2F\u6258\u8C03\u6574=${paretoApplied}, \u65F6\u5E8F\u9884\u6D4B\u52A0\u8F7D=${trendLoaded}, \u65F6\u5E8F\u9884\u6D4B\u8C03\u6574=${trendApplied}, \u8DE8\u54C1\u8FC1\u79FB\u52A0\u8F7D=${transferLoaded}, \u8DE8\u54C1\u8FC1\u79FB\u8C03\u6574=${transferApplied}`);
  return results;
}
async function executeNextGenMaintenanceTasks(accountId) {
  const results = {
    featuresCached: 0,
    sigmoidFitted: { fitted: 0, skipped: 0, errors: 0 },
    rewardsBackfilled: 0,
    causalAnalysis: { analyzed: 0, significant: 0, errors: 0 },
    algorithmResultsBackfilled: 0
  };
  try {
    log63.info(`[NextGenMaintenance] \u5F00\u59CB\u7279\u5F81\u63D0\u53D6: \u8D26\u6237${accountId}`);
    results.featuresCached = await batchExtractAndCacheFeatures(accountId);
  } catch (err) {
    log63.warn(`[NextGenMaintenance] \u7279\u5F81\u63D0\u53D6\u5931\u8D25: ${err.message}`);
  }
  try {
    log63.info(`[NextGenMaintenance] \u5F00\u59CBSigmoid\u66F2\u7EBF\u62DF\u5408`);
    results.sigmoidFitted = await batchFitSigmoidCurves(accountId);
  } catch (err) {
    log63.warn(`[NextGenMaintenance] Sigmoid\u62DF\u5408\u5931\u8D25: ${err.message}`);
  }
  try {
    log63.info(`[NextGenMaintenance] \u5F00\u59CBReward\u56DE\u586B`);
    results.rewardsBackfilled = await backfillRewards(accountId);
  } catch (err) {
    log63.warn(`[NextGenMaintenance] Reward\u56DE\u586B\u5931\u8D25: ${err.message}`);
  }
  try {
    log63.info(`[NextGenMaintenance] \u5F00\u59CB\u56E0\u679C\u63A8\u65AD\u5206\u6790`);
    results.causalAnalysis = await batchCausalAnalysis(accountId);
  } catch (err) {
    log63.warn(`[NextGenMaintenance] \u56E0\u679C\u5206\u6790\u5931\u8D25: ${err.message}`);
  }
  try {
    log63.info(`[NextGenMaintenance] \u5F00\u59CB\u7B97\u6CD5\u7ED3\u679C\u56DE\u586B`);
    results.algorithmResultsBackfilled = await backfillAlgorithmResults(accountId);
  } catch (err) {
    log63.warn(`[NextGenMaintenance] \u7B97\u6CD5\u7ED3\u679C\u56DE\u586B\u5931\u8D25: ${err.message}`);
  }
  let conflictsResult = { resolved: 0, ignored: 0, skipped: 0 };
  try {
    log63.info(`[NextGenMaintenance] \u5F00\u59CB\u81EA\u52A8\u51B2\u7A81\u89E3\u51B3`);
    conflictsResult = await autoResolveConflicts(accountId);
  } catch (err) {
    log63.warn(`[NextGenMaintenance] \u81EA\u52A8\u51B2\u7A81\u89E3\u51B3\u5931\u8D25: ${err.message}`);
  }
  log63.info(`[NextGenMaintenance] \u7EF4\u62A4\u5B8C\u6210(\u8D26\u6237${accountId}): \u7279\u5F81=${results.featuresCached}, Sigmoid=${results.sigmoidFitted.fitted}, Reward=${results.rewardsBackfilled}, \u56E0\u679C=${results.causalAnalysis.analyzed}, \u7B97\u6CD5\u56DE\u586B=${results.algorithmResultsBackfilled}, \u51B2\u7A81\u89E3\u51B3=${conflictsResult.resolved}+${conflictsResult.ignored}`);
  return results;
}
async function executeModelTraining(accountId) {
  try {
    log63.info(`[NextGenTraining] \u5F00\u59CBCQL\u6A21\u578B\u8BAD\u7EC3: \u8D26\u6237${accountId}`);
    await trainCQL(accountId);
    log63.info(`[NextGenTraining] CQL\u8BAD\u7EC3\u5B8C\u6210: \u8D26\u6237${accountId}`);
  } catch (error48) {
    log63.warn(`[NextGenTraining] CQL\u8BAD\u7EC3\u5931\u8D25(\u8D26\u6237${accountId}): ${error48.message}`);
  }
}
async function executeBudgetOptimization(accountId) {
  try {
    log63.info(`[NextGenBudget] \u5F00\u59CB\u9884\u7B97\u7EC4\u5408\u4F18\u5316: \u8D26\u6237${accountId}`);
    const result = await optimizeBudgetPortfolio(accountId);
    if (result) {
      log63.info(`[NextGenBudget] \u9884\u7B97\u4F18\u5316\u5B8C\u6210: ${result.allocations.length}\u4E2A\u5E7F\u544A\u6D3B\u52A8, \u9884\u671F\u5229\u6DA6=$${result.expectedTotalProfit.toFixed(2)}`);
    }
  } catch (error48) {
    log63.warn(`[NextGenBudget] \u9884\u7B97\u4F18\u5316\u5931\u8D25(\u8D26\u6237${accountId}): ${error48.message}`);
  }
}
async function executeKeywordGraphAnalysis(accountId) {
  try {
    log63.info(`[NextGenKeyword] \u5F00\u59CB\u5173\u952E\u8BCD\u56FE\u8C31\u5206\u6790: \u8D26\u6237${accountId}`);
    await buildKeywordGraph(accountId);
    const opportunities = await discoverOpportunities(accountId);
    const negatives = await discoverNegativeCandidates(accountId);
    log63.info(`[NextGenKeyword] \u56FE\u8C31\u5206\u6790\u5B8C\u6210: ${opportunities.length}\u4E2A\u6269\u5C55\u673A\u4F1A, ${negatives.length}\u4E2A\u5426\u5B9A\u8BCD\u5019\u9009`);
  } catch (error48) {
    log63.warn(`[NextGenKeyword] \u56FE\u8C31\u5206\u6790\u5931\u8D25(\u8D26\u6237${accountId}): ${error48.message}`);
  }
}
async function updateLinUCBFromReward(accountId, armType, context, reward) {
  try {
    await updateArm(accountId, armType, context, reward);
  } catch (error48) {
    log63.warn(`[NextGenOrchestrator] LinUCB\u66F4\u65B0\u5931\u8D25: ${error48.message}`);
  }
}
var log63, BID_COOLDOWN_CONFIG, BID_CIRCUIT_BREAKER_CONFIG, DEFAULT_SAFETY;
var init_nextGenBidOrchestrator = __esm({
  "server/optimization/nextGenBidOrchestrator.ts"() {
    "use strict";
    init_db2();
    init_contextualFeatureService();
    init_rlDataRecorder();
    init_sigmoidCurveFitter();
    init_contextualBanditService();
    init_causalInferenceEngine();
    init_schema2();
    init_drizzle_orm();
    init_offlineRLService();
    init_metaLearningSelector();
    init_budgetPortfolioOptimizer();
    init_keywordGraphService();
    init_postOptimizationVerifier();
    init_logger();
    init_gtoIntegrationOrchestrator();
    init_nashEquilibriumEngine();
    init_suggestedBidColdStartEngine();
    init_paretoTierEngine();
    init_timeSeriesForecastEngine();
    init_crossProductTransferEngine();
    init_timeDecayWeightedDataService();
    init_systemConfigService();
    init_algorithmObservabilityService();
    log63 = createModuleLogger("NextGen");
    __name(getBidCooldownConfig, "getBidCooldownConfig");
    BID_COOLDOWN_CONFIG = getBidCooldownConfig();
    BID_CIRCUIT_BREAKER_CONFIG = {
      /** v266 P0-3: 降低熔断触发阈值，使熔断机制能真正生效 */
      /** 7天内累计降价幅度上限（百分比）：超过此值触发熔断 */
      maxCumulativeDecreasePercent7d: 0.10,
      // v510: 从20%收紧至15%，配合冷却期延长更早触发熔断
      /** 连续降价次数上限：超过此值强制hold一个周期 */
      maxConsecutiveDecreases: 1,
      // v266: 从3次降至2次，连续2次降价即触发熔断
      /** 最低出价保护：出价不得低于初始出价的此比例 */
      minBidFloorRatio: 0.7,
      // v266: 从40%提升到50%，提高出价底线保护
      /** 归因延迟保护窗口（小时）：最近N小时内的数据权重降低 */
      attributionDelayHours: 48,
      /** 归因延迟数据权重折扣：最近48h内数据的权重 */
      recentDataWeightDiscount: 0.6,
      /** v268 P0-1: 熔断触发时的提价恢复比例 — 从10%提升到15%，分3步渐进执行 */
      recoveryBoostPercent: 0.15,
      // v268: 从10%提升到15%，更积极地恢复曝光
      /** v268 P0-1: 渐进恢复步骤数 — 将恢复提价分成多步执行，避免一次性大幅提价 */
      recoverySteps: 3,
      /** v259: 最低曝光保护阈值 — 曝光低于历史基线此比例时暂停所有降价 */
      minImpressionProtectionRatio: 0.6
      // v266: 从50%提升到60%，更早保护曝光
    };
    __name(checkBidDirectionConsistency, "checkBidDirectionConsistency");
    __name(isInCooldownPeriod, "isInCooldownPeriod");
    __name(meetsMinimumAdjustment, "meetsMinimumAdjustment");
    __name(checkCircuitBreaker, "checkCircuitBreaker");
    DEFAULT_SAFETY = {
      maxBidChangePercent: 0.20,
      // v608: 用户要求±20%最大调整幅度
      minBid: 0.02,
      maxBid: 10,
      targetAcos: 0.3
    };
    __name(safetyValidate, "safetyValidate");
    __name(ruleEngineDecision, "ruleEngineDecision");
    __name(calculateNextGenBid, "calculateNextGenBid");
    __name(buildResult2, "buildResult");
    __name(batchCalculateNextGenBids, "batchCalculateNextGenBids");
    __name(executeNextGenMaintenanceTasks, "executeNextGenMaintenanceTasks");
    __name(executeModelTraining, "executeModelTraining");
    __name(executeBudgetOptimization, "executeBudgetOptimization");
    __name(executeKeywordGraphAnalysis, "executeKeywordGraphAnalysis");
    __name(updateLinUCBFromReward, "updateLinUCBFromReward");
  }
});

