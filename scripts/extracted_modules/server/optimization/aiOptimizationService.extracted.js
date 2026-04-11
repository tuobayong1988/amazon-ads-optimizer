// Extracted from production dist/index.js
// Original module: server/optimization/aiOptimizationService.ts
// Lines: 448

var aiOptimizationService_exports = {};
__export(aiOptimizationService_exports, {
  executeOptimizationSuggestions: () => executeOptimizationSuggestions,
  executeReviewAnalysis: () => executeReviewAnalysis,
  generateAIAnalysisWithSuggestions: () => generateAIAnalysisWithSuggestions
});
async function generateAIAnalysisWithSuggestions(campaignId) {
  const campaign = await getCampaignById(campaignId);
  if (!campaign) {
    throw new Error("\u5E7F\u544A\u6D3B\u52A8\u4E0D\u5B58\u5728");
  }
  const adGroups6 = await getAdGroupsByCampaignId(campaign.campaignId);
  let allKeywords = [];
  let allProductTargets = [];
  for (const adGroup of adGroups6) {
    const keywords10 = await getKeywordsByAdGroupId(adGroup.id);
    const productTargets5 = await getProductTargetsByAdGroupId(adGroup.id);
    allKeywords.push(...keywords10.map((k) => ({ ...k, adGroupName: adGroup.adGroupName })));
    allProductTargets.push(...productTargets5.map((pt) => ({ ...pt, adGroupName: adGroup.adGroupName })));
  }
  const searchTerms8 = await getSearchTermsByCampaignId(campaign.campaignId);
  const spend = parseFloat(campaign.spend || "0");
  const sales = parseFloat(campaign.sales || "0");
  const acos = sales > 0 ? spend / sales * 100 : 0;
  const roas = spend > 0 ? sales / spend : 0;
  const clicks = campaign.clicks || 0;
  const impressions = campaign.impressions || 0;
  const ctr = impressions > 0 ? clicks / impressions * 100 : 0;
  const orders = campaign.orders || 0;
  const cvr = clicks > 0 ? orders / clicks * 100 : 0;
  const suggestions = [];
  for (const keyword of allKeywords) {
    const kSpend = parseFloat(keyword.spend || "0");
    const kSales = parseFloat(keyword.sales || "0");
    const kClicks = keyword.clicks || 0;
    const kOrders = keyword.orders || 0;
    const kAcos = kSales > 0 ? kSpend / kSales * 100 : 999;
    const kCvr = kClicks > 0 ? kOrders / kClicks * 100 : 0;
    const kCpc = kClicks > 0 ? kSpend / kClicks : 0;
    const currentBid = parseFloat(keyword.bid || "0");
    if (kSpend > 10 && kOrders === 0) {
      suggestions.push({
        type: "bid_adjustment",
        targetType: "keyword",
        // @ts-ignore
        targetId: keyword.id,
        // @ts-ignore
        targetText: keyword.keywordText,
        action: kSpend > 50 ? "pause" : "bid_decrease",
        currentValue: `$${currentBid.toFixed(2)}`,
        suggestedValue: kSpend > 50 ? "\u6682\u505C" : `$${(currentBid * 0.7).toFixed(2)}`,
        reason: `\u82B1\u8D39$${kSpend.toFixed(2)}\u4F46\u65E0\u8F6C\u5316\uFF0C\u5EFA\u8BAE${kSpend > 50 ? "\u6682\u505C" : "\u964D\u4F4E\u51FA\u4EF730%"}`,
        priority: kSpend > 50 ? "high" : "medium",
        expectedImpact: {
          spendChange: kSpend > 50 ? -kSpend : -kSpend * 0.3,
          acosChange: kSpend > 50 ? -5 : -2
        }
      });
    } else if (kAcos > 50 && kOrders > 0) {
      const targetBid = kCpc * (30 / kAcos);
      suggestions.push({
        type: "bid_adjustment",
        targetType: "keyword",
        // @ts-ignore
        targetId: keyword.id,
        // @ts-ignore
        targetText: keyword.keywordText,
        action: "bid_decrease",
        currentValue: `$${currentBid.toFixed(2)}`,
        suggestedValue: `$${Math.max(0.1, targetBid).toFixed(2)}`,
        reason: `ACoS ${kAcos.toFixed(1)}%\u8FC7\u9AD8\uFF0C\u5EFA\u8BAE\u964D\u4F4E\u51FA\u4EF7\u81F3$${Math.max(0.1, targetBid).toFixed(2)}`,
        priority: kAcos > 80 ? "high" : "medium",
        expectedImpact: {
          // @ts-ignore
          acosChange: -(kAcos - 30) * 0.5
          // @ts-ignore
        }
      });
    } else if (kCvr > 15 && kAcos < 20 && kClicks > 5) {
      suggestions.push({
        type: "bid_adjustment",
        targetType: "keyword",
        // @ts-ignore
        targetId: keyword.id,
        // @ts-ignore
        targetText: keyword.keywordText,
        action: "bid_increase",
        // @ts-ignore
        currentValue: `$${currentBid.toFixed(2)}`,
        suggestedValue: `$${(currentBid * 1.3).toFixed(2)}`,
        reason: `\u8F6C\u5316\u7387${kCvr.toFixed(1)}%\u4F18\u79C0\uFF0CACoS\u4EC5${kAcos.toFixed(1)}%\uFF0C\u5EFA\u8BAE\u63D0\u9AD8\u51FA\u4EF730%\u4E89\u53D6\u66F4\u591A\u6D41\u91CF`,
        priority: "high",
        // @ts-ignore
        expectedImpact: {
          // @ts-ignore
          salesChange: kSales * 0.3,
          spendChange: kSpend * 0.3
        }
      });
    } else if (keyword.status === "paused" && kSales > 50 && kAcos < 30) {
      suggestions.push({
        type: "status_change",
        targetType: "keyword",
        // @ts-ignore
        targetId: keyword.id,
        // @ts-ignore
        targetText: keyword.keywordText,
        action: "enable",
        currentValue: "\u6682\u505C",
        suggestedValue: "\u542F\u7528",
        reason: `\u5386\u53F2\u9500\u552E\u989D$${kSales.toFixed(2)}\uFF0CACoS ${kAcos.toFixed(1)}%\uFF0C\u5EFA\u8BAE\u91CD\u65B0\u542F\u7528`,
        priority: "medium",
        expectedImpact: {
          salesChange: kSales * 0.5
        }
      });
    }
  }
  for (const searchTerm of searchTerms8) {
    const stSpend = parseFloat(searchTerm.searchTermSpend || "0");
    const stSales = parseFloat(searchTerm.searchTermSales || "0");
    const stClicks = searchTerm.searchTermClicks || 0;
    const stOrders = searchTerm.searchTermOrders || 0;
    const stAcos = stSales > 0 ? stSpend / stSales * 100 : 999;
    if (stSpend > 15 && stOrders === 0 && stClicks > 10) {
      suggestions.push({
        type: "negative_keyword",
        targetType: "search_term",
        targetText: searchTerm.searchTerm,
        action: stClicks > 30 ? "negate_exact" : "negate_phrase",
        currentValue: "\u65E0",
        suggestedValue: stClicks > 30 ? "\u7CBE\u51C6\u5426\u5B9A" : "\u8BCD\u7EC4\u5426\u5B9A",
        reason: `\u82B1\u8D39$${stSpend.toFixed(2)}\uFF0C${stClicks}\u6B21\u70B9\u51FB\u65E0\u8F6C\u5316\uFF0C\u5EFA\u8BAE\u6DFB\u52A0\u4E3A\u5426\u5B9A\u8BCD`,
        priority: stSpend > 30 ? "high" : "medium",
        expectedImpact: {
          spendChange: -stSpend * 0.8
        }
      });
    } else if (stAcos > 100 && stSpend > 10) {
      suggestions.push({
        type: "negative_keyword",
        targetType: "search_term",
        targetText: searchTerm.searchTerm,
        action: "negate_phrase",
        currentValue: "\u65E0",
        suggestedValue: "\u8BCD\u7EC4\u5426\u5B9A",
        reason: `ACoS ${stAcos.toFixed(1)}%\u8FC7\u9AD8\uFF0C\u5EFA\u8BAE\u6DFB\u52A0\u4E3A\u5426\u5B9A\u8BCD`,
        priority: "medium",
        expectedImpact: {
          spendChange: -stSpend * 0.7,
          acosChange: -2
        }
      });
    }
  }
  suggestions.sort((a, b) => {
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    return priorityOrder[a.priority] - priorityOrder[b.priority];
  });
  const topSuggestions = suggestions.slice(0, 20);
  const predictions = generatePredictions(spend, sales, acos, roas, topSuggestions);
  const summary = await generateSummaryWithLLM(campaign, { spend, sales, acos, roas, ctr, cvr, impressions, clicks, orders }, topSuggestions);
  return {
    summary,
    metrics: { spend, sales, acos, roas, ctr, cvr, impressions, clicks, orders },
    suggestions: topSuggestions,
    predictions
  };
}
function generatePredictions(currentSpend, currentSales, currentAcos, currentRoas, suggestions) {
  let totalSpendChange = 0;
  let totalSalesChange = 0;
  for (const suggestion of suggestions) {
    if (suggestion.expectedImpact) {
      totalSpendChange += suggestion.expectedImpact.spendChange || 0;
      totalSalesChange += suggestion.expectedImpact.salesChange || 0;
    }
  }
  const confidence = Math.min(0.85, 0.5 + suggestions.length * 0.02);
  const periods = ["7_days", "14_days", "30_days"];
  const multipliers = { "7_days": 0.3, "14_days": 0.6, "30_days": 1 };
  return periods.map((period) => {
    const mult = multipliers[period];
    const predictedSpendChange = totalSpendChange * mult;
    const predictedSalesChange = totalSalesChange * mult;
    const predictedSpend = Math.max(0, currentSpend + predictedSpendChange);
    const predictedSales = Math.max(0, currentSales + predictedSalesChange);
    const predictedAcos = predictedSales > 0 ? predictedSpend / predictedSales * 100 : currentAcos;
    const predictedRoas = predictedSpend > 0 ? predictedSales / predictedSpend : currentRoas;
    return {
      period,
      predictedSpend,
      predictedSales,
      predictedAcos,
      predictedRoas,
      spendChangePercent: currentSpend > 0 ? predictedSpendChange / currentSpend * 100 : 0,
      salesChangePercent: currentSales > 0 ? predictedSalesChange / currentSales * 100 : 0,
      // @ts-ignore
      acosChangePercent: currentAcos > 0 ? (predictedAcos - currentAcos) / currentAcos * 100 : 0,
      roasChangePercent: currentRoas > 0 ? (predictedRoas - currentRoas) / currentRoas * 100 : 0,
      confidence: confidence * mult,
      rationale: `\u57FA\u4E8E${suggestions.length}\u6761\u4F18\u5316\u5EFA\u8BAE\uFF0C\u9884\u8BA1${period === "7_days" ? "7\u5929" : period === "14_days" ? "14\u5929" : "30\u5929"}\u540E\u6548\u679C\u9010\u6B65\u663E\u73B0`
    };
  });
}
async function generateSummaryWithLLM(campaign, metrics, suggestions) {
  const suggestionsSummary = suggestions.slice(0, 5).map(
    (s, i) => (
      // @ts-ignore
      `${i + 1}. [${s.priority === "high" ? "\u9AD8\u4F18\u5148\u7EA7" : s.priority === "medium" ? "\u4E2D\u4F18\u5148\u7EA7" : "\u4F4E\u4F18\u5148\u7EA7"}] ${s.reason}`
    )
  ).join("\n");
  const prompt = `\u4F60\u662F\u4E00\u4E2A\u4E13\u4E1A\u7684\u4E9A\u9A6C\u900A\u5E7F\u544A\u4F18\u5316\u4E13\u5BB6\u3002\u8BF7\u6839\u636E\u4EE5\u4E0B\u5E7F\u544A\u6D3B\u52A8\u6570\u636E\u548CAI\u751F\u6210\u7684\u4F18\u5316\u5EFA\u8BAE\uFF0C\u751F\u6210\u4E00\u4EFD\u7B80\u6D01\u7684\u4E2D\u6587\u5206\u6790\u6458\u8981\u3002

// @ts-ignore
\u5E7F\u544A\u6D3B\u52A8: ${campaign.campaignName}
\u6838\u5FC3\u6307\u6807:
// @ts-ignore
- \u82B1\u8D39: $${metrics.spend.toFixed(2)}
// @ts-ignore
- \u9500\u552E\u989D: $${metrics.sales.toFixed(2)}
// @ts-ignore
- ACoS: ${metrics.acos.toFixed(2)}%
// @ts-ignore
- ROAS: ${metrics.roas.toFixed(2)}
// @ts-ignore
- \u70B9\u51FB\u7387: ${metrics.ctr.toFixed(2)}%
// @ts-ignore
- \u8F6C\u5316\u7387: ${metrics.cvr.toFixed(2)}%

AI\u8BC6\u522B\u7684\u4F18\u5316\u5EFA\u8BAE (\u5171${suggestions.length}\u6761):
${suggestionsSummary}

\u8BF7\u63D0\u4F9B:
1. \u6574\u4F53\u8868\u73B0\u8BC4\u4EF7\uFF08\u4E00\u53E5\u8BDD\uFF09
2. \u4E3B\u8981\u95EE\u9898\u8BCA\u65AD\uFF082-3\u70B9\uFF09
3. \u4F18\u5316\u5EFA\u8BAE\u6982\u8FF0\uFF08\u8BF4\u660E\u6267\u884C\u8FD9\u4E9B\u5EFA\u8BAE\u7684\u9884\u671F\u6548\u679C\uFF09

\u8BF7\u7528\u7B80\u6D01\u7684\u4E2D\u6587\u56DE\u590D\uFF0C\u4F7F\u7528Markdown\u683C\u5F0F\u3002`;
  try {
    const response = await invokeLLM({
      messages: [
        { role: "system", content: "\u4F60\u662F\u4E00\u4E2A\u4E13\u4E1A\u7684\u4E9A\u9A6C\u900A\u5E7F\u544A\u4F18\u5316\u987E\u95EE\uFF0C\u64C5\u957F\u5206\u6790\u5E7F\u544A\u6570\u636E\u5E76\u63D0\u4F9B\u53EF\u6267\u884C\u7684\u4F18\u5316\u5EFA\u8BAE\u3002" },
        { role: "user", content: prompt }
      ]
    });
    const content = response.choices[0]?.message?.content;
    return typeof content === "string" ? content : "\u65E0\u6CD5\u751F\u6210\u6458\u8981";
  } catch (error48) {
    log157.warn("LLM\u6458\u8981\u751F\u6210\u5931\u8D25:", error48);
    return `## \u5E7F\u544A\u6D3B\u52A8\u5206\u6790

\u5F53\u524DACoS\u4E3A${metrics.acos.toFixed(1)}%\uFF0CROAS\u4E3A${metrics.roas.toFixed(2)}\u3002

\u7CFB\u7EDF\u5DF2\u8BC6\u522B${suggestions.length}\u6761\u4F18\u5316\u5EFA\u8BAE\uFF0C\u5EFA\u8BAE\u6267\u884C\u4EE5\u6539\u5584\u5E7F\u544A\u8868\u73B0\u3002`;
  }
}
async function executeOptimizationSuggestions(userId, accountId, campaignId, suggestions, predictions, aiSummary) {
  const campaign = await getCampaignById(campaignId);
  if (!campaign) {
    throw new Error("\u5E7F\u544A\u6D3B\u52A8\u4E0D\u5B58\u5728");
  }
  const spend = parseFloat(campaign.spend || "0");
  const sales = parseFloat(campaign.sales || "0");
  const acos = sales > 0 ? spend / sales * 100 : 0;
  const roas = spend > 0 ? sales / spend : 0;
  const types = new Set(suggestions.map((s) => s.type));
  let executionType = "mixed";
  if (types.size === 1) {
    const firstType = types.values().next().value;
    if (firstType === "bid_adjustment" || firstType === "status_change" || firstType === "negative_keyword") {
      executionType = firstType;
    }
  }
  const executionId = await createAiOptimizationExecution({
    userId,
    accountId,
    campaignId: String(campaignId),
    executionName: `AI\u4F18\u5316\u6267\u884C - ${(/* @__PURE__ */ new Date()).toLocaleDateString("zh-CN")}`,
    aiExecType: executionType,
    totalActions: suggestions.length,
    aiAnalysisSummary: aiSummary,
    baselineSpend: spend.toString(),
    baselineSales: sales.toString(),
    baselineAcos: acos.toString(),
    baselineRoas: roas.toString(),
    baselineClicks: campaign.clicks || 0,
    baselineImpressions: campaign.impressions || 0,
    baselineOrders: campaign.orders || 0
  });
  const actions = suggestions.map((s) => ({
    executionId,
    actionType: mapActionType(s.action),
    targetType: s.targetType,
    targetId: s.targetId,
    targetText: s.targetText,
    previousValue: s.currentValue,
    newValue: s.suggestedValue,
    changeReason: s.reason
  }));
  await createAiOptimizationActions(actions);
  const predictionRecords = predictions.map((p) => ({
    executionId,
    predictionPeriod: p.period,
    predictedSpend: p.predictedSpend.toString(),
    predictedSales: p.predictedSales.toString(),
    predictedAcos: p.predictedAcos.toString(),
    predictedRoas: p.predictedRoas.toString(),
    spendChangePercent: p.spendChangePercent.toString(),
    salesChangePercent: p.salesChangePercent.toString(),
    acosChangePercent: p.acosChangePercent.toString(),
    roasChangePercent: p.roasChangePercent.toString(),
    confidenceLevel: p.confidence.toString(),
    predictionRationale: p.rationale
  }));
  await createAiOptimizationPredictions(predictionRecords);
  const now = /* @__PURE__ */ new Date();
  for (const prediction of predictions) {
    const daysToAdd = prediction.period === "7_days" ? 7 : prediction.period === "14_days" ? 14 : 30;
    const scheduledAt = new Date(now.getTime() + daysToAdd * 24 * 60 * 60 * 1e3).toISOString();
    const predictionRecords2 = await getAiOptimizationPredictionsByExecution(executionId);
    const predictionRecord = predictionRecords2.find((p) => p.predictionPeriod === prediction.period);
    if (predictionRecord) {
      await createAiOptimizationReview({
        executionId,
        // @ts-ignore
        predictionId: predictionRecord.id,
        reviewPeriod: prediction.period,
        scheduledAt
      });
    }
  }
  let successCount = 0;
  let failedCount = 0;
  await updateAiOptimizationExecution(executionId, { aiExecStatus: "executing" });
  const actionRecords = await getAiOptimizationActionsByExecution(executionId);
  for (const action of actionRecords) {
    try {
      await executeAction(action);
      await updateAiOptimizationAction(action.id, {
        aiActionStatus: "success",
        aiActionExecutedAt: (/* @__PURE__ */ new Date()).toISOString()
      });
      successCount++;
    } catch (error48) {
      await updateAiOptimizationAction(action.id, {
        aiActionStatus: "failed",
        // aiActionErrorMessage: (error as Error).message,
        aiActionExecutedAt: (/* @__PURE__ */ new Date()).toISOString()
      });
      failedCount++;
    }
  }
  const finalStatus = failedCount === 0 ? "completed" : (
    // @ts-ignore
    successCount === 0 ? "failed" : "partially_completed"
  );
  await updateAiOptimizationExecution(executionId, {
    aiExecStatus: finalStatus,
    successfulActions: successCount,
    failedActions: failedCount,
    completedAt: (/* @__PURE__ */ new Date()).toISOString()
    // @ts-ignore
  });
  return {
    executionId,
    // @ts-ignore
    results: { success: successCount, failed: failedCount }
    // @ts-ignore
  };
}
function mapActionType(action) {
  const mapping = {
    "bid_increase": "bid_increase",
    "bid_decrease": "bid_decrease",
    "bid_set": "bid_set",
    "enable": "enable_target",
    "pause": "pause_target",
    // @ts-ignore
    "negate_phrase": "add_negative_phrase",
    // @ts-ignore
    "negate_exact": "add_negative_exact"
    // @ts-ignore
  };
  return mapping[action] || "bid_set";
}
async function executeAction(action) {
  switch (action.actionType) {
    case "bid_increase":
    case "bid_decrease":
    case "bid_set":
      if (action.targetType === "keyword" && action.targetId) {
        const newBid = parseFloat(action.newValue?.replace("$", "") || "0");
        if (newBid > 0) {
          await updateKeywordBid(action.targetId, newBid.toFixed(2));
        }
      } else if (action.targetType === "product_target" && action.targetId) {
        const newBid = parseFloat(action.newValue?.replace("$", "") || "0");
        if (newBid > 0) {
          await updateProductTargetBid(action.targetId, newBid.toFixed(2));
        }
      }
      break;
    case "enable_target":
      if (action.targetType === "keyword" && action.targetId) {
        await updateKeyword(action.targetId, { keywordStatus: "enabled" });
      } else if (action.targetType === "product_target" && action.targetId) {
        await updateProductTarget(action.targetId, { targetStatus: "enabled" });
      }
      break;
    case "pause_target":
      if (action.targetType === "keyword" && action.targetId) {
        await updateKeyword(action.targetId, { keywordStatus: "paused" });
      } else if (action.targetType === "product_target" && action.targetId) {
        await updateProductTarget(action.targetId, { targetStatus: "paused" });
      }
      break;
    case "add_negative_phrase":
    case "add_negative_exact":
      log157.info(`\u6DFB\u52A0\u5426\u5B9A\u8BCD: ${action.targetText} (${action.actionType})`);
      break;
    default:
      throw new Error(`\u672A\u77E5\u64CD\u4F5C\u7C7B\u578B: ${action.actionType}`);
  }
}
async function executeReviewAnalysis(reviewId) {
  const db_instance = await getDb();
  if (!db_instance) return;
  const reviews = await getAiOptimizationReviewsByExecution(0);
}
var log157;
var init_aiOptimizationService = __esm({
  "server/optimization/aiOptimizationService.ts"() {
    "use strict";
    init_logger();
    init_db2();
    init_llm();
    log157 = createModuleLogger("AiOptimizationService");
    __name(generateAIAnalysisWithSuggestions, "generateAIAnalysisWithSuggestions");
    __name(generatePredictions, "generatePredictions");
    __name(generateSummaryWithLLM, "generateSummaryWithLLM");
    __name(executeOptimizationSuggestions, "executeOptimizationSuggestions");
    __name(mapActionType, "mapActionType");
    __name(executeAction, "executeAction");
    __name(executeReviewAnalysis, "executeReviewAnalysis");
  }
});

