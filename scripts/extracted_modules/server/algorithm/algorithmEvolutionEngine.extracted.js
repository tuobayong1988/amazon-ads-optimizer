// Extracted from production dist/index.js
// Original module: server/algorithm/algorithmEvolutionEngine.ts
// Lines: 637

async function runEffectTracking() {
  log183.info("[EvolutionEngine] \u5F00\u59CB\u6548\u679C\u8FFD\u8E2A...");
  const tracked7d = await trackEffectsForPeriod(7);
  const tracked14d = await trackEffectsForPeriod(14);
  const tracked30d = await trackEffectsForPeriod(30);
  log183.info(`[EvolutionEngine] \u6548\u679C\u8FFD\u8E2A\u5B8C\u6210: 7d=${tracked7d}, 14d=${tracked14d}, 30d=${tracked30d}`);
  return { tracked7d, tracked14d, tracked30d };
}
async function trackEffectsForPeriod(period) {
  const db = await getDb();
  if (!db) return 0;
  const now = /* @__PURE__ */ new Date();
  const targetDate = new Date(now.getTime() - period * 24 * 60 * 60 * 1e3);
  const bufferStart = new Date(targetDate.getTime() - 24 * 60 * 60 * 1e3);
  const bufferEnd = new Date(targetDate.getTime() + 24 * 60 * 60 * 1e3);
  const startStr = bufferStart.toISOString().slice(0, 19).replace("T", " ");
  const endStr = bufferEnd.toISOString().slice(0, 19).replace("T", " ");
  let trackingField;
  if (period === 7) trackingField = "actual_profit_7d";
  else if (period === 14) trackingField = "actual_profit_14d";
  else trackingField = "actual_profit_30d";
  try {
    const events = await db.select().from(optimizationEvents2).where(and(
      eq(optimizationEvents2.eventCategory, "bid_adjustment"),
      ne(optimizationEvents2.status, "rolled_back"),
      eq(optimizationEvents2.apiSyncStatus, "synced"),
      gte(optimizationEvents2.createdAt, startStr),
      lte(optimizationEvents2.createdAt, endStr),
      // v361: 使用白名单验证动态列名
      trackingField === "actual_profit_7d" ? sql`actual_profit_7d IS NULL` : trackingField === "actual_profit_14d" ? sql`actual_profit_14d IS NULL` : sql`actual_profit_30d IS NULL`
    )).limit(200);
    let processed = 0;
    for (const event of events) {
      try {
        const eventDate = new Date(event.createdAt);
        const endDate = new Date(eventDate.getTime() + period * 24 * 60 * 60 * 1e3);
        const perfData = await getEventPerformanceData(db, event, eventDate, endDate);
        if (!perfData) continue;
        const effectScore = calculateEffectScore3(event, perfData, period);
        const updateData = {
          trackingUpdatedAt: now.toISOString().slice(0, 19).replace("T", " ")
        };
        if (period === 7) {
          updateData.actualProfit7D = (perfData.sales - perfData.spend).toFixed(2);
          updateData.actualSpend7D = perfData.spend.toFixed(2);
          updateData.actualRevenue7D = perfData.sales.toFixed(2);
          updateData.actualImpressions7D = perfData.impressions;
          updateData.actualClicks7D = perfData.clicks;
          updateData.actualConversions7D = perfData.orders;
        } else if (period === 14) {
          updateData.actualProfit14D = (perfData.sales - perfData.spend).toFixed(2);
        } else {
          updateData.actualProfit30D = (perfData.sales - perfData.spend).toFixed(2);
        }
        await db.update(optimizationEvents2).set(updateData).where(eq(optimizationEvents2.id, event.id));
        processed++;
      } catch (error48) {
        log183.warn(`[EvolutionEngine] \u8FFD\u8E2A\u4E8B\u4EF6 ${event.id} \u5931\u8D25:`, error48.message);
      }
    }
    return processed;
  } catch (error48) {
    log183.warn(`[EvolutionEngine] ${period}\u5929\u6548\u679C\u8FFD\u8E2A\u5931\u8D25:`, error48.message);
    return 0;
  }
}
async function getEventPerformanceData(db, event, startDate, endDate) {
  try {
    const startStr = startDate.toISOString().slice(0, 10);
    const endStr = endDate.toISOString().slice(0, 10);
    let result;
    if (event.keywordId) {
      const { keywords: keywords10 } = await Promise.resolve().then(() => (init_schema2(), schema_exports));
      const kwData = await db.select().from(keywords10).where(eq(keywords10.id, event.keywordId)).limit(1);
      if (kwData.length > 0) {
        const kw = kwData[0];
        result = {
          // @ts-ignore
          spend: parseFloat(kw.spend || "0"),
          // @ts-ignore
          sales: parseFloat(kw.sales || "0"),
          // @ts-ignore
          impressions: kw.impressions || 0,
          // @ts-ignore
          clicks: kw.clicks || 0,
          // @ts-ignore
          orders: kw.orders || 0
        };
      }
    } else if (event.campaignId) {
      const { campaigns: campaigns6 } = await Promise.resolve().then(() => (init_schema2(), schema_exports));
      const campData = await db.select().from(campaigns6).where(eq(campaigns6.id, event.campaignId)).limit(1);
      if (campData.length > 0) {
        const camp = campData[0];
        result = {
          // @ts-ignore
          spend: parseFloat(camp.spend || "0"),
          // @ts-ignore
          sales: parseFloat(camp.sales || "0"),
          // @ts-ignore
          impressions: camp.impressions || 0,
          // @ts-ignore
          clicks: camp.clicks || 0,
          // @ts-ignore
          orders: camp.orders || 0
        };
      }
    }
    return result || null;
  } catch (error48) {
    log183.warn(`[EvolutionEngine] \u83B7\u53D6\u4E8B\u4EF6 ${event.id} \u6548\u679C\u6570\u636E\u5931\u8D25:`, error48.message);
    return null;
  }
}
function calculateEffectScore3(event, perfData, period) {
  const previousBid = parseFloat(event.previousBid || "0");
  const newBid = parseFloat(event.newBid || "0");
  if (previousBid <= 0 || newBid <= 0) return 0;
  const bidDirection = newBid > previousBid ? "increase" : "decrease";
  const roas = perfData.spend > 0 ? perfData.sales / perfData.spend : 0;
  const acos = perfData.sales > 0 ? perfData.spend / perfData.sales * 100 : 100;
  let score = 0;
  if (bidDirection === "increase") {
    if (roas >= 3) score += 30;
    else if (roas >= 2) score += 15;
    else if (roas >= 1) score += 0;
    else score -= 20;
    if (perfData.impressions > 100) score += 10;
    if (perfData.clicks > 5) score += 10;
    if (perfData.orders > 0) score += 20;
  } else {
    if (acos < 30) score += 30;
    else if (acos < 50) score += 15;
    else if (acos < 80) score += 0;
    else score -= 15;
    if (perfData.orders > 0) score += 20;
    if (perfData.sales > perfData.spend) score += 20;
  }
  const profit = perfData.sales - perfData.spend;
  if (profit > 0) score += 10;
  else score -= 10;
  return Math.max(-100, Math.min(100, score));
}
async function evaluateTargetPerformance(targetId, period = 14) {
  const db = await getDb();
  if (!db) return null;
  const now = /* @__PURE__ */ new Date();
  const startDate = new Date(now.getTime() - period * 24 * 60 * 60 * 1e3);
  const startStr = startDate.toISOString().slice(0, 19).replace("T", " ");
  try {
    const events = await db.select().from(optimizationEvents2).where(and(
      eq(optimizationEvents2.performanceGroupId, targetId),
      eq(optimizationEvents2.eventCategory, "bid_adjustment"),
      eq(optimizationEvents2.apiSyncStatus, "synced"),
      ne(optimizationEvents2.status, "rolled_back"),
      gte(optimizationEvents2.createdAt, startStr)
    ));
    if (events.length === 0) {
      return null;
    }
    let successfulEvents = 0;
    let failedEvents = 0;
    let neutralEvents = 0;
    let totalROASChange = 0;
    let totalACoSChange = 0;
    let totalProfitChange = 0;
    let totalEffectScore = 0;
    const algorithmMap = /* @__PURE__ */ new Map();
    const rangeMap = /* @__PURE__ */ new Map();
    for (const event of events) {
      const previousBid = parseFloat(event.previousBid || "0");
      const newBid = parseFloat(event.newBid || "0");
      const profit7d = event.actualProfit7D ? parseFloat(event.actualProfit7D) : null;
      const expectedProfit = event.expectedProfitIncrease ? parseFloat(event.expectedProfitIncrease) : 0;
      let effectScore = 0;
      if (profit7d !== null) {
        if (profit7d > 0) {
          effectScore = Math.min(100, profit7d * 10);
          successfulEvents++;
        } else if (profit7d < -5) {
          effectScore = Math.max(-100, profit7d * 5);
          failedEvents++;
        } else {
          effectScore = 0;
          neutralEvents++;
        }
        totalProfitChange += profit7d;
      } else {
        if (event.status === "success") {
          effectScore = 10;
          neutralEvents++;
        } else {
          effectScore = -10;
          failedEvents++;
        }
      }
      totalEffectScore += effectScore;
      const algo = event.performanceData?.algorithmUsed || "unknown";
      const algoStats = algorithmMap.get(algo) || { count: 0, totalScore: 0, successCount: 0 };
      algoStats.count++;
      algoStats.totalScore += effectScore;
      if (effectScore > 0) algoStats.successCount++;
      algorithmMap.set(algo, algoStats);
      if (previousBid > 0) {
        const changePercent = Math.abs((newBid - previousBid) / previousBid * 100);
        let range;
        if (changePercent < 5) range = "0-5%";
        else if (changePercent < 10) range = "5-10%";
        else if (changePercent < 20) range = "10-20%";
        else if (changePercent < 30) range = "20-30%";
        else range = "30%+";
        const rangeStats = rangeMap.get(range) || { count: 0, totalScore: 0, successCount: 0 };
        rangeStats.count++;
        rangeStats.totalScore += effectScore;
        if (effectScore > 0) rangeStats.successCount++;
        rangeMap.set(range, rangeStats);
      }
    }
    const evaluation = {
      targetId,
      period,
      evaluatedAt: now.toISOString(),
      totalEvents: events.length,
      successfulEvents,
      failedEvents,
      neutralEvents,
      avgROASChange: totalROASChange / events.length,
      avgACoSChange: totalACoSChange / events.length,
      avgProfitChange: totalProfitChange / events.length,
      overallEffectScore: totalEffectScore / events.length,
      algorithmPerformance: Array.from(algorithmMap.entries()).map(([algo, stats4]) => ({
        algorithm: algo,
        count: stats4.count,
        avgEffectScore: stats4.count > 0 ? stats4.totalScore / stats4.count : 0,
        successRate: stats4.count > 0 ? stats4.successCount / stats4.count * 100 : 0
      })),
      rangePerformance: Array.from(rangeMap.entries()).map(([range, stats4]) => ({
        range,
        count: stats4.count,
        avgEffectScore: stats4.count > 0 ? stats4.totalScore / stats4.count : 0,
        successRate: stats4.count > 0 ? stats4.successCount / stats4.count * 100 : 0
      }))
    };
    return evaluation;
  } catch (error48) {
    log183.warn(`[EvolutionEngine] \u8BC4\u4F30\u4F18\u5316\u76EE\u6807 ${targetId} \u6548\u679C\u5931\u8D25:`, error48.message);
    return null;
  }
}
async function getTargetAlgorithmConfig(targetId) {
  const db = await getDb();
  if (!db) return { ...DEFAULT_TARGET_ALGORITHM_CONFIG };
  try {
    const groups = await db.select().from(performanceGroups).where(eq(performanceGroups.id, targetId)).limit(1);
    if (groups.length > 0) {
      const group = groups[0];
      const storedConfig = group.algorithmConfig;
      if (storedConfig && typeof storedConfig === "object") {
        return { ...DEFAULT_TARGET_ALGORITHM_CONFIG, ...storedConfig };
      }
    }
  } catch (error48) {
    log183.warn(`[EvolutionEngine] \u83B7\u53D6\u76EE\u6807 ${targetId} \u7B97\u6CD5\u914D\u7F6E\u5931\u8D25:`, error48.message);
  }
  return { ...DEFAULT_TARGET_ALGORITHM_CONFIG };
}
function calculateParameterAdjustments(currentConfig, evaluation) {
  const adjustments = [];
  if (evaluation.totalEvents < MIN_EVENTS_FOR_EVOLUTION) {
    log183.info(`[EvolutionEngine] \u4E8B\u4EF6\u6570\u4E0D\u8DB3(${evaluation.totalEvents}/${MIN_EVENTS_FOR_EVOLUTION})\uFF0C\u8DF3\u8FC7\u53C2\u6570\u8C03\u6574`);
    return adjustments;
  }
  const successRate = evaluation.totalEvents > 0 ? evaluation.successfulEvents / evaluation.totalEvents * 100 : 0;
  const largeRange = evaluation.rangePerformance.find((r) => r.range === "20-30%" || r.range === "30%+");
  const smallRange = evaluation.rangePerformance.find((r) => r.range === "0-5%" || r.range === "5-10%");
  if (largeRange && largeRange.count >= 3 && largeRange.successRate < 40) {
    const reduction = LEARNING_RATE * (50 - largeRange.successRate) / 50;
    const newMaxIncrease = clamp(
      currentConfig.maxBidIncreasePercent * (1 - reduction),
      PARAM_BOUNDS.maxBidIncreasePercent.min,
      PARAM_BOUNDS.maxBidIncreasePercent.max
    );
    const newMaxDecrease = clamp(
      currentConfig.maxBidDecreasePercent * (1 - reduction * 0.7),
      PARAM_BOUNDS.maxBidDecreasePercent.min,
      PARAM_BOUNDS.maxBidDecreasePercent.max
    );
    if (Math.abs(newMaxIncrease - currentConfig.maxBidIncreasePercent) > 1) {
      adjustments.push({
        parameter: "maxBidIncreasePercent",
        previousValue: currentConfig.maxBidIncreasePercent,
        newValue: Math.round(newMaxIncrease),
        reason: `\u5927\u5E45\u8C03\u6574(${largeRange.range})\u6210\u529F\u7387\u4EC5${largeRange.successRate.toFixed(0)}%\uFF0C\u7F29\u5C0F\u63D0\u4EF7\u5E45\u5EA6`,
        confidence: Math.min(90, largeRange.count * 10),
        basedOnEvents: largeRange.count
      });
    }
    if (Math.abs(newMaxDecrease - currentConfig.maxBidDecreasePercent) > 1) {
      adjustments.push({
        parameter: "maxBidDecreasePercent",
        previousValue: currentConfig.maxBidDecreasePercent,
        newValue: Math.round(newMaxDecrease),
        reason: `\u5927\u5E45\u8C03\u6574\u6548\u679C\u4E0D\u4F73\uFF0C\u540C\u6B65\u7F29\u5C0F\u964D\u4EF7\u5E45\u5EA6`,
        confidence: Math.min(85, largeRange.count * 8),
        basedOnEvents: largeRange.count
      });
    }
  } else if (smallRange && smallRange.count >= 5 && smallRange.successRate > 70 && successRate > 60) {
    const expansion = LEARNING_RATE * (smallRange.successRate - 70) / 100;
    const newMaxIncrease = clamp(
      currentConfig.maxBidIncreasePercent * (1 + expansion),
      PARAM_BOUNDS.maxBidIncreasePercent.min,
      PARAM_BOUNDS.maxBidIncreasePercent.max
    );
    if (newMaxIncrease - currentConfig.maxBidIncreasePercent > 1) {
      adjustments.push({
        parameter: "maxBidIncreasePercent",
        previousValue: currentConfig.maxBidIncreasePercent,
        newValue: Math.round(newMaxIncrease),
        reason: `\u5C0F\u5E45\u8C03\u6574\u6210\u529F\u7387${smallRange.successRate.toFixed(0)}%\uFF0C\u6574\u4F53\u6210\u529F\u7387${successRate.toFixed(0)}%\uFF0C\u9002\u5EA6\u6269\u5927\u5E45\u5EA6`,
        confidence: Math.min(80, smallRange.count * 5),
        basedOnEvents: smallRange.count
      });
    }
  }
  if (evaluation.algorithmPerformance.length >= 2) {
    const totalAlgoEvents = evaluation.algorithmPerformance.reduce((sum2, a) => sum2 + a.count, 0);
    if (totalAlgoEvents >= MIN_EVENTS_FOR_EVOLUTION) {
      const newWeights = { ...currentConfig.algorithmWeights };
      let weightsChanged = false;
      for (const algoPerf of evaluation.algorithmPerformance) {
        const algoKey = algoPerf.algorithm;
        if (!(algoKey in newWeights)) continue;
        const currentWeight = newWeights[algoKey];
        if (algoPerf.avgEffectScore > 20 && algoPerf.count >= 3) {
          const increase = LEARNING_RATE * (algoPerf.avgEffectScore / 100) * 0.5;
          newWeights[algoKey] = Math.min(0.6, currentWeight + increase);
          weightsChanged = true;
        } else if (algoPerf.avgEffectScore < -10 && algoPerf.count >= 3) {
          const decrease = LEARNING_RATE * Math.abs(algoPerf.avgEffectScore / 100) * 0.5;
          newWeights[algoKey] = Math.max(0.05, currentWeight - decrease);
          weightsChanged = true;
        }
      }
      if (weightsChanged) {
        const totalWeight = Object.values(newWeights).reduce((sum2, w) => sum2 + w, 0);
        for (const key of Object.keys(newWeights)) {
          newWeights[key] = newWeights[key] / totalWeight;
        }
        adjustments.push({
          parameter: "algorithmWeights",
          previousValue: 0,
          // 用JSON表示
          newValue: 0,
          reason: `\u57FA\u4E8E${totalAlgoEvents}\u6B21\u4F18\u5316\u6548\u679C\uFF0C\u8C03\u6574\u7B97\u6CD5\u6743\u91CD: ` + Object.entries(newWeights).map(([k, v]) => `${k}=${(v * 100).toFixed(0)}%`).join(", "),
          confidence: Math.min(85, totalAlgoEvents * 3),
          basedOnEvents: totalAlgoEvents
        });
        adjustments[adjustments.length - 1]._newWeights = newWeights;
      }
    }
  }
  if (evaluation.totalEvents >= 20) {
    if (successRate > 65 && evaluation.overallEffectScore > 15) {
      const newExplorationRate = clamp(
        currentConfig.explorationRate * (1 - LEARNING_RATE),
        PARAM_BOUNDS.explorationRate.min,
        PARAM_BOUNDS.explorationRate.max
      );
      if (Math.abs(newExplorationRate - currentConfig.explorationRate) > 0.01) {
        adjustments.push({
          parameter: "explorationRate",
          previousValue: currentConfig.explorationRate,
          newValue: parseFloat(newExplorationRate.toFixed(3)),
          reason: `\u6210\u529F\u7387${successRate.toFixed(0)}%\uFF0C\u6548\u679C\u5206${evaluation.overallEffectScore.toFixed(0)}\uFF0C\u964D\u4F4E\u63A2\u7D22\u7387\u4EE5\u5229\u7528\u5DF2\u9A8C\u8BC1\u7B56\u7565`,
          confidence: 75,
          basedOnEvents: evaluation.totalEvents
        });
      }
    } else if (successRate < 45) {
      const newExplorationRate = clamp(
        currentConfig.explorationRate * (1 + LEARNING_RATE),
        PARAM_BOUNDS.explorationRate.min,
        PARAM_BOUNDS.explorationRate.max
      );
      if (Math.abs(newExplorationRate - currentConfig.explorationRate) > 0.01) {
        adjustments.push({
          parameter: "explorationRate",
          previousValue: currentConfig.explorationRate,
          newValue: parseFloat(newExplorationRate.toFixed(3)),
          reason: `\u6210\u529F\u7387\u4EC5${successRate.toFixed(0)}%\uFF0C\u63D0\u9AD8\u63A2\u7D22\u7387\u4EE5\u53D1\u73B0\u66F4\u4F18\u7B56\u7565`,
          confidence: 70,
          basedOnEvents: evaluation.totalEvents
        });
      }
    }
  }
  if (evaluation.totalEvents >= 15) {
    if (successRate < 40 && evaluation.overallEffectScore < -5) {
      const newThreshold = clamp(
        currentConfig.confidenceThreshold + LEARNING_RATE * 0.5,
        PARAM_BOUNDS.confidenceThreshold.min,
        PARAM_BOUNDS.confidenceThreshold.max
      );
      if (newThreshold - currentConfig.confidenceThreshold > 0.02) {
        adjustments.push({
          parameter: "confidenceThreshold",
          previousValue: currentConfig.confidenceThreshold,
          newValue: parseFloat(newThreshold.toFixed(2)),
          reason: `\u6210\u529F\u7387${successRate.toFixed(0)}%\uFF0C\u6548\u679C\u5206${evaluation.overallEffectScore.toFixed(0)}\uFF0C\u63D0\u9AD8\u7F6E\u4FE1\u5EA6\u9608\u503C\u51CF\u5C11\u4F4E\u8D28\u91CF\u8C03\u6574`,
          confidence: 80,
          basedOnEvents: evaluation.totalEvents
        });
      }
    } else if (successRate > 70 && currentConfig.confidenceThreshold > 0.4) {
      const newThreshold = clamp(
        currentConfig.confidenceThreshold - LEARNING_RATE * 0.3,
        PARAM_BOUNDS.confidenceThreshold.min,
        PARAM_BOUNDS.confidenceThreshold.max
      );
      if (currentConfig.confidenceThreshold - newThreshold > 0.02) {
        adjustments.push({
          parameter: "confidenceThreshold",
          previousValue: currentConfig.confidenceThreshold,
          newValue: parseFloat(newThreshold.toFixed(2)),
          reason: `\u6210\u529F\u7387${successRate.toFixed(0)}%\u8868\u73B0\u4F18\u79C0\uFF0C\u9002\u5EA6\u964D\u4F4E\u9608\u503C\u5141\u8BB8\u66F4\u591A\u4F18\u5316`,
          confidence: 70,
          basedOnEvents: evaluation.totalEvents
        });
      }
    }
  }
  return adjustments;
}
function applyAdjustments(config2, adjustments) {
  const newConfig = { ...config2 };
  for (const adj of adjustments) {
    switch (adj.parameter) {
      case "maxBidIncreasePercent":
        newConfig.maxBidIncreasePercent = adj.newValue;
        break;
      case "maxBidDecreasePercent":
        newConfig.maxBidDecreasePercent = adj.newValue;
        break;
      case "explorationRate":
        newConfig.explorationRate = adj.newValue;
        break;
      case "confidenceThreshold":
        newConfig.confidenceThreshold = adj.newValue;
        break;
      case "algorithmWeights":
        if (adj._newWeights) {
          newConfig.algorithmWeights = adj._newWeights;
        }
        break;
    }
  }
  newConfig.evolutionGeneration++;
  newConfig.lastEvolutionAt = (/* @__PURE__ */ new Date()).toISOString();
  newConfig.totalEvolutionCycles++;
  return newConfig;
}
async function runEvolutionCycle2(targetId) {
  log183.info(`[EvolutionEngine] \u5F00\u59CB\u8FDB\u5316\u5468\u671F: targetId=${targetId}`);
  const db = await getDb();
  if (!db) return null;
  try {
    const groups = await db.select().from(performanceGroups).where(eq(performanceGroups.id, targetId)).limit(1);
    if (groups.length === 0) {
      log183.info(`[EvolutionEngine] \u4F18\u5316\u76EE\u6807 ${targetId} \u4E0D\u5B58\u5728`);
      return null;
    }
    const group = groups[0];
    const currentConfig = await getTargetAlgorithmConfig(targetId);
    const evaluation = await evaluateTargetPerformance(targetId, 14);
    if (!evaluation) {
      log183.info(`[EvolutionEngine] \u4F18\u5316\u76EE\u6807 ${targetId} \u65E0\u8DB3\u591F\u6570\u636E\u8FDB\u884C\u8BC4\u4F30`);
      return null;
    }
    const adjustments = calculateParameterAdjustments(currentConfig, evaluation);
    let newConfig = currentConfig;
    if (adjustments.length > 0) {
      newConfig = applyAdjustments(currentConfig, adjustments);
      await db.insert(optimizationEvents2).values({
        performanceGroupId: targetId,
        // @ts-ignore
        performanceGroupName: group.name,
        // @ts-ignore
        accountId: group.accountId,
        eventCategory: "settings_change",
        actionType: "settings_update",
        changeReason: `\u7B97\u6CD5\u8FDB\u5316\u7B2C${newConfig.evolutionGeneration}\u4EE3: ${adjustments.map((a) => a.reason).join("; ")}`,
        previousValue: JSON.stringify(currentConfig),
        newValue: JSON.stringify(newConfig),
        // @ts-ignore
        status: "success",
        apiSyncStatus: "internal",
        // v513: 内部系统事件，不需要Amazon API同步
        performanceData: JSON.stringify({
          // @ts-ignore
          type: "algorithm_evolution",
          generation: newConfig.evolutionGeneration,
          evaluation: {
            totalEvents: evaluation.totalEvents,
            successRate: evaluation.totalEvents > 0 ? evaluation.successfulEvents / evaluation.totalEvents * 100 : 0,
            overallEffectScore: evaluation.overallEffectScore
            // @ts-ignore
          },
          adjustments: adjustments.map((a) => ({
            parameter: a.parameter,
            previousValue: a.previousValue,
            newValue: a.newValue,
            reason: a.reason
            // @ts-ignore
          }))
        }),
        createdAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ")
      });
      log183.info(`[EvolutionEngine] \u4F18\u5316\u76EE\u6807 ${group.name} \u5B8C\u6210\u7B2C${newConfig.evolutionGeneration}\u4EE3\u8FDB\u5316\uFF0C${adjustments.length}\u9879\u53C2\u6570\u8C03\u6574`);
    } else {
      log183.info(`[EvolutionEngine] \u4F18\u5316\u76EE\u6807 ${group.name} \u5F53\u524D\u53C2\u6570\u8868\u73B0\u826F\u597D\uFF0C\u65E0\u9700\u8C03\u6574`);
    }
    const report = {
      targetId,
      // @ts-ignore
      targetName: group.name,
      generation: newConfig.evolutionGeneration,
      executedAt: (/* @__PURE__ */ new Date()).toISOString(),
      evaluation,
      adjustments,
      expectedImprovement: adjustments.length > 0 ? adjustments.reduce((sum2, a) => sum2 + a.confidence, 0) / adjustments.length * 0.1 : 0
    };
    return report;
  } catch (error48) {
    log183.warn(`[EvolutionEngine] \u8FDB\u5316\u5468\u671F\u6267\u884C\u5931\u8D25 (targetId=${targetId}):`, error48.message);
    return null;
  }
}
async function runGlobalEvolution() {
  log183.info("[EvolutionEngine] ========== \u5F00\u59CB\u5168\u5C40\u8FDB\u5316\u5468\u671F ==========");
  const db = await getDb();
  if (!db) return { totalTargets: 0, evolvedTargets: 0, skippedTargets: 0, reports: [] };
  const result = {
    totalTargets: 0,
    evolvedTargets: 0,
    skippedTargets: 0,
    reports: []
  };
  try {
    const activeTargets = await db.select({
      id: performanceGroups.id,
      name: performanceGroups.name
    }).from(performanceGroups).where(eq(performanceGroups.status, "active"));
    result.totalTargets = activeTargets.length;
    for (const target of activeTargets) {
      try {
        const report = await runEvolutionCycle2(target.id);
        if (report) {
          result.evolvedTargets++;
          result.reports.push(report);
        } else {
          result.skippedTargets++;
        }
      } catch (error48) {
        log183.warn(`[EvolutionEngine] \u76EE\u6807 ${target.name} \u8FDB\u5316\u5931\u8D25:`, error48.message);
        result.skippedTargets++;
      }
    }
    log183.info(`[EvolutionEngine] \u5168\u5C40\u8FDB\u5316\u5B8C\u6210: \u603B\u76EE\u6807=${result.totalTargets}, \u5DF2\u8FDB\u5316=${result.evolvedTargets}, \u8DF3\u8FC7=${result.skippedTargets}`);
  } catch (error48) {
    log183.warn("[EvolutionEngine] \u5168\u5C40\u8FDB\u5316\u5931\u8D25:", error48.message);
  }
  return result;
}
async function getEffectiveBidConfig(targetId) {
  const config2 = await getTargetAlgorithmConfig(targetId);
  return {
    maxChangePercent: config2.maxBidIncreasePercent / 100,
    explorationRate: config2.explorationRate,
    confidenceThreshold: config2.confidenceThreshold,
    algorithmWeights: config2.algorithmWeights
  };
}
function clamp(value, min2, max2) {
  return Math.min(max2, Math.max(min2, value));
}
var log183, DEFAULT_TARGET_ALGORITHM_CONFIG, PARAM_BOUNDS, LEARNING_RATE, MIN_EVENTS_FOR_EVOLUTION;
var init_algorithmEvolutionEngine = __esm({
  "server/algorithm/algorithmEvolutionEngine.ts"() {
    "use strict";
    init_logger();
    init_db2();
    init_schema2();
    init_drizzle_orm();
    log183 = createModuleLogger("EvolutionEngine");
    DEFAULT_TARGET_ALGORITHM_CONFIG = {
      maxBidIncreasePercent: 30,
      maxBidDecreasePercent: 20,
      minBidChangeThreshold: 0.01,
      algorithmWeights: {
        time_decay: 0.35,
        ucb: 0.25,
        bayesian: 0.2,
        market_curve: 0.2
      },
      explorationRate: 0.2,
      confidenceThreshold: 0.3,
      cooldownHours: 24,
      evolutionGeneration: 0,
      lastEvolutionAt: null,
      totalEvolutionCycles: 0,
      cumulativeImprovement: 0
    };
    PARAM_BOUNDS = {
      maxBidIncreasePercent: { min: 10, max: 50 },
      maxBidDecreasePercent: { min: 5, max: 40 },
      explorationRate: { min: 0.05, max: 0.5 },
      confidenceThreshold: { min: 0.1, max: 0.8 },
      cooldownHours: { min: 6, max: 72 }
    };
    LEARNING_RATE = 0.15;
    MIN_EVENTS_FOR_EVOLUTION = 10;
    __name(runEffectTracking, "runEffectTracking");
    __name(trackEffectsForPeriod, "trackEffectsForPeriod");
    __name(getEventPerformanceData, "getEventPerformanceData");
    __name(calculateEffectScore3, "calculateEffectScore");
    __name(evaluateTargetPerformance, "evaluateTargetPerformance");
    __name(getTargetAlgorithmConfig, "getTargetAlgorithmConfig");
    __name(calculateParameterAdjustments, "calculateParameterAdjustments");
    __name(applyAdjustments, "applyAdjustments");
    __name(runEvolutionCycle2, "runEvolutionCycle");
    __name(runGlobalEvolution, "runGlobalEvolution");
    __name(getEffectiveBidConfig, "getEffectiveBidConfig");
    __name(clamp, "clamp");
  }
});

