// Extracted from production dist/index.js
// Original module: server/algorithm/algorithmOptimizationService.ts
// Lines: 435

function getAlgorithmParameters() {
  return { ...currentParameters };
}
function updateAlgorithmParameters(updates) {
  currentParameters = { ...currentParameters, ...updates };
  return currentParameters;
}
function resetAlgorithmParameters() {
  currentParameters = { ...DEFAULT_ALGORITHM_PARAMETERS };
  return currentParameters;
}
async function calculateAlgorithmPerformance(accountId, days = 30) {
  const db = await getDb();
  if (!db) return null;
  const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1e3);
  let records = await db.select().from(bidAdjustmentHistory).where(
    sql`${bidAdjustmentHistory.status} != 'rolled_back'`
  );
  if (accountId) {
    records = records.filter((r) => r.accountId === accountId);
  }
  records = records.filter((r) => {
    const adjustedAt = r.appliedAt ? new Date(r.appliedAt) : null;
    return adjustedAt && adjustedAt >= cutoffDate;
  });
  const totalAdjustments = records.length;
  const tracked7d = records.filter((r) => r.actualProfit7D !== null);
  const tracked14d = records.filter((r) => r.actualProfit14D !== null);
  const tracked30d = records.filter((r) => r.actualProfit30D !== null);
  const metrics = {
    totalAdjustments,
    trackedAdjustments: tracked7d.length,
    trackingRate: totalAdjustments > 0 ? tracked7d.length / totalAdjustments * 100 : 0,
    accuracy7d: calculateAccuracy(tracked7d, "actualProfit7D"),
    accuracy14d: calculateAccuracy(tracked14d, "actualProfit14D"),
    accuracy30d: calculateAccuracy(tracked30d, "actualProfit30D"),
    mae7d: calculateMAE(tracked7d, "actualProfit7D"),
    mae14d: calculateMAE(tracked14d, "actualProfit14D"),
    mae30d: calculateMAE(tracked30d, "actualProfit30D"),
    rmse7d: calculateRMSE(tracked7d, "actualProfit7D"),
    rmse14d: calculateRMSE(tracked14d, "actualProfit14D"),
    rmse30d: calculateRMSE(tracked30d, "actualProfit30D"),
    directionAccuracy7d: calculateDirectionAccuracy(tracked7d, "actualProfit7D"),
    directionAccuracy14d: calculateDirectionAccuracy(tracked14d, "actualProfit14D"),
    directionAccuracy30d: calculateDirectionAccuracy(tracked30d, "actualProfit30D"),
    totalEstimatedProfit: records.reduce((sum2, r) => sum2 + parseFloat(String(r.expectedProfitIncrease || 0)), 0),
    totalActualProfit7d: tracked7d.reduce((sum2, r) => sum2 + parseFloat(String(r.actualProfit7D || 0)), 0),
    totalActualProfit14d: tracked14d.reduce((sum2, r) => sum2 + parseFloat(String(r.actualProfit14D || 0)), 0),
    totalActualProfit30d: tracked30d.reduce((sum2, r) => sum2 + parseFloat(String(r.actualProfit30D || 0)), 0)
  };
  return metrics;
}
function calculateAccuracy(records, actualField) {
  if (records.length === 0) return null;
  let totalEstimated = 0;
  let totalActual = 0;
  for (const record2 of records) {
    totalEstimated += parseFloat(String(record2.expectedProfitIncrease || 0));
    totalActual += parseFloat(String(record2[actualField] || 0));
  }
  if (totalEstimated === 0) {
    return totalActual >= 0 ? 100 : 0;
  }
  const accuracy = Math.min(100, Math.max(0, (1 - Math.abs(totalActual - totalEstimated) / Math.abs(totalEstimated)) * 100));
  return Math.round(accuracy * 100) / 100;
}
function calculateMAE(records, actualField) {
  if (records.length === 0) return null;
  let totalError = 0;
  for (const record2 of records) {
    const estimated = parseFloat(String(record2.expectedProfitIncrease || 0));
    const actual = parseFloat(String(record2[actualField] || 0));
    totalError += Math.abs(actual - estimated);
  }
  return Math.round(totalError / records.length * 100) / 100;
}
function calculateRMSE(records, actualField) {
  if (records.length === 0) return null;
  let totalSquaredError = 0;
  for (const record2 of records) {
    const estimated = parseFloat(String(record2.expectedProfitIncrease || 0));
    const actual = parseFloat(String(record2[actualField] || 0));
    totalSquaredError += Math.pow(actual - estimated, 2);
  }
  return Math.round(Math.sqrt(totalSquaredError / records.length) * 100) / 100;
}
function calculateDirectionAccuracy(records, actualField) {
  if (records.length === 0) return null;
  let correctCount = 0;
  for (const record2 of records) {
    const estimated = parseFloat(String(record2.expectedProfitIncrease || 0));
    const actual = parseFloat(String(record2[actualField] || 0));
    if (estimated > 0 && actual > 0 || estimated < 0 && actual < 0 || estimated === 0 && actual === 0) {
      correctCount++;
    }
  }
  return Math.round(correctCount / records.length * 100 * 100) / 100;
}
async function analyzeByAdjustmentType(accountId, days = 30) {
  const db = await getDb();
  if (!db) return [];
  const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1e3);
  let records = await db.select().from(bidAdjustmentHistory).where(
    and(
      sql`${bidAdjustmentHistory.status} != 'rolled_back'`,
      isNotNull(bidAdjustmentHistory.actualProfit7D)
    )
  );
  if (accountId) {
    records = records.filter((r) => r.accountId === accountId);
  }
  records = records.filter((r) => {
    const adjustedAt = r.appliedAt ? new Date(r.appliedAt) : null;
    return adjustedAt && adjustedAt >= cutoffDate;
  });
  const byType = {};
  for (const record2 of records) {
    const type = record2.adjustmentType || "unknown";
    if (!byType[type]) byType[type] = [];
    byType[type].push(record2);
  }
  const results = [];
  for (const [type, typeRecords] of Object.entries(byType)) {
    const totalEstimated = typeRecords.reduce((sum2, r) => sum2 + parseFloat(String(r.expectedProfitIncrease || 0)), 0);
    const totalActual = typeRecords.reduce((sum2, r) => sum2 + parseFloat(String(r.actualProfit7D || 0)), 0);
    const accuracy = calculateAccuracy(typeRecords, "actualProfit7D") || 0;
    const mae = calculateMAE(typeRecords, "actualProfit7D") || 0;
    results.push({
      dimension: "adjustmentType",
      value: type,
      // @ts-ignore
      count: typeRecords.length,
      accuracy,
      mae,
      // @ts-expect-error - runtime type mismatch
      totalEstimated,
      // @ts-expect-error - runtime type mismatch
      totalActual,
      recommendation: generateTypeRecommendation(type, accuracy, mae, typeRecords.length)
    });
  }
  return results.sort((a, b) => b.count - a.count);
}
async function analyzeByBidChangeRange(accountId, days = 30) {
  const db = await getDb();
  if (!db) return [];
  const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1e3);
  let records = await db.select().from(bidAdjustmentHistory).where(
    and(
      sql`${bidAdjustmentHistory.status} != 'rolled_back'`,
      isNotNull(bidAdjustmentHistory.actualProfit7D)
    )
  );
  if (accountId) {
    records = records.filter((r) => r.accountId === accountId);
  }
  records = records.filter((r) => {
    const adjustedAt = r.appliedAt ? new Date(r.appliedAt) : null;
    return adjustedAt && adjustedAt >= cutoffDate;
  });
  const ranges = [
    { min: -100, max: -20, label: "\u5927\u5E45\u964D\u4EF7 (>20%)" },
    { min: -20, max: -10, label: "\u4E2D\u5E45\u964D\u4EF7 (10-20%)" },
    { min: -10, max: -5, label: "\u5C0F\u5E45\u964D\u4EF7 (5-10%)" },
    { min: -5, max: 5, label: "\u5FAE\u8C03 (<5%)" },
    { min: 5, max: 10, label: "\u5C0F\u5E45\u63D0\u4EF7 (5-10%)" },
    { min: 10, max: 20, label: "\u4E2D\u5E45\u63D0\u4EF7 (10-20%)" },
    { min: 20, max: 100, label: "\u5927\u5E45\u63D0\u4EF7 (>20%)" }
  ];
  const results = [];
  for (const range of ranges) {
    const rangeRecords = records.filter((r) => {
      const change = parseFloat(String(r.bidChangePercent || 0));
      return change >= range.min && change < range.max;
    });
    if (rangeRecords.length === 0) continue;
    const totalEstimated = rangeRecords.reduce((sum2, r) => sum2 + parseFloat(String(r.expectedProfitIncrease || 0)), 0);
    const totalActual = rangeRecords.reduce((sum2, r) => sum2 + parseFloat(String(r.actualProfit7D || 0)), 0);
    const accuracy = calculateAccuracy(rangeRecords, "actualProfit7D") || 0;
    const mae = calculateMAE(rangeRecords, "actualProfit7D") || 0;
    results.push({
      dimension: "bidChangeRange",
      value: range.label,
      count: rangeRecords.length,
      accuracy,
      mae,
      totalEstimated,
      totalActual,
      recommendation: generateRangeRecommendation(range.label, accuracy, mae, rangeRecords.length)
    });
  }
  return results;
}
function generateTypeRecommendation(type, accuracy, mae, count11) {
  if (count11 < 5) {
    return "\u6837\u672C\u91CF\u4E0D\u8DB3\uFF0C\u5EFA\u8BAE\u6536\u96C6\u66F4\u591A\u6570\u636E\u540E\u518D\u8BC4\u4F30";
  }
  if (accuracy >= 80) {
    return `${type}\u7C7B\u578B\u8C03\u6574\u8868\u73B0\u4F18\u79C0\uFF0C\u5EFA\u8BAE\u7EE7\u7EED\u4F7F\u7528\u5F53\u524D\u7B56\u7565`;
  } else if (accuracy >= 60) {
    return `${type}\u7C7B\u578B\u8C03\u6574\u8868\u73B0\u826F\u597D\uFF0C\u53EF\u9002\u5F53\u589E\u52A0\u4F7F\u7528\u9891\u7387`;
  } else if (accuracy >= 40) {
    return `${type}\u7C7B\u578B\u8C03\u6574\u8868\u73B0\u4E00\u822C\uFF0C\u5EFA\u8BAE\u4F18\u5316\u53C2\u6570\u6216\u51CF\u5C11\u4F7F\u7528`;
  } else {
    return `${type}\u7C7B\u578B\u8C03\u6574\u8868\u73B0\u8F83\u5DEE\uFF0C\u5EFA\u8BAE\u6682\u505C\u4F7F\u7528\u5E76\u5206\u6790\u539F\u56E0`;
  }
}
function generateRangeRecommendation(range, accuracy, mae, count11) {
  if (count11 < 5) {
    return "\u6837\u672C\u91CF\u4E0D\u8DB3\uFF0C\u5EFA\u8BAE\u6536\u96C6\u66F4\u591A\u6570\u636E\u540E\u518D\u8BC4\u4F30";
  }
  if (accuracy >= 80) {
    return `${range}\u8303\u56F4\u8C03\u6574\u6548\u679C\u4F18\u79C0\uFF0C\u53EF\u4F5C\u4E3A\u4F18\u5148\u9009\u62E9`;
  } else if (accuracy >= 60) {
    return `${range}\u8303\u56F4\u8C03\u6574\u6548\u679C\u826F\u597D\uFF0C\u5EFA\u8BAE\u4FDD\u6301\u5F53\u524D\u7B56\u7565`;
  } else if (accuracy >= 40) {
    return `${range}\u8303\u56F4\u8C03\u6574\u6548\u679C\u4E00\u822C\uFF0C\u5EFA\u8BAE\u7F29\u5C0F\u8C03\u6574\u5E45\u5EA6`;
  } else {
    return `${range}\u8303\u56F4\u8C03\u6574\u6548\u679C\u8F83\u5DEE\uFF0C\u5EFA\u8BAE\u907F\u514D\u6B64\u5E45\u5EA6\u7684\u8C03\u6574`;
  }
}
async function generateOptimizationSuggestions(accountId, days = 30) {
  const suggestions = [];
  const metrics = await calculateAlgorithmPerformance(accountId, days);
  const byType = await analyzeByAdjustmentType(accountId, days);
  const byRange = await analyzeByBidChangeRange(accountId, days);
  if (metrics.accuracy7d !== null) {
    if (metrics.accuracy7d < 50) {
      suggestions.push({
        id: `suggestion_${Date.now()}_1`,
        category: "parameter",
        priority: "critical",
        title: "\u7B97\u6CD5\u51C6\u786E\u7387\u8FC7\u4F4E",
        description: `\u5F53\u524D7\u5929\u51C6\u786E\u7387\u4EC5\u4E3A${metrics.accuracy7d.toFixed(1)}%\uFF0C\u8FDC\u4F4E\u4E8E\u671F\u671B\u6C34\u5E73\u3002\u5EFA\u8BAE\u5168\u9762\u5BA1\u67E5\u7B97\u6CD5\u53C2\u6570\u548C\u6570\u636E\u8D28\u91CF\u3002`,
        impact: "\u53EF\u80FD\u5BFC\u81F4\u5927\u91CF\u65E0\u6548\u6216\u8D1F\u9762\u7684\u51FA\u4EF7\u8C03\u6574",
        currentValue: `${metrics.accuracy7d.toFixed(1)}%`,
        suggestedValue: "70%+",
        expectedImprovement: "\u63D0\u9AD8\u51C6\u786E\u7387\u81F3\u5C1120\u4E2A\u767E\u5206\u70B9",
        confidence: 90,
        basedOn: `\u57FA\u4E8E${metrics.trackedAdjustments}\u6761\u8FFD\u8E2A\u6570\u636E`,
        createdAt: /* @__PURE__ */ new Date()
      });
    } else if (metrics.accuracy7d < 70) {
      suggestions.push({
        id: `suggestion_${Date.now()}_2`,
        category: "parameter",
        priority: "high",
        title: "\u7B97\u6CD5\u51C6\u786E\u7387\u9700\u8981\u63D0\u5347",
        description: `\u5F53\u524D7\u5929\u51C6\u786E\u7387\u4E3A${metrics.accuracy7d.toFixed(1)}%\uFF0C\u6709\u8F83\u5927\u63D0\u5347\u7A7A\u95F4\u3002\u5EFA\u8BAE\u4F18\u5316\u5173\u952E\u53C2\u6570\u3002`,
        impact: "\u90E8\u5206\u51FA\u4EF7\u8C03\u6574\u53EF\u80FD\u672A\u8FBE\u5230\u9884\u671F\u6548\u679C",
        currentValue: `${metrics.accuracy7d.toFixed(1)}%`,
        suggestedValue: "75%+",
        expectedImprovement: "\u63D0\u9AD8\u51C6\u786E\u738710-15\u4E2A\u767E\u5206\u70B9",
        confidence: 80,
        basedOn: `\u57FA\u4E8E${metrics.trackedAdjustments}\u6761\u8FFD\u8E2A\u6570\u636E`,
        createdAt: /* @__PURE__ */ new Date()
      });
    }
  }
  if (metrics.directionAccuracy7d !== null && metrics.directionAccuracy7d < 60) {
    suggestions.push({
      id: `suggestion_${Date.now()}_3`,
      category: "strategy",
      priority: "high",
      title: "\u9884\u6D4B\u65B9\u5411\u51C6\u786E\u7387\u4E0D\u8DB3",
      description: `\u5F53\u524D\u9884\u6D4B\u6DA8\u8DCC\u65B9\u5411\u51C6\u786E\u7387\u4EC5\u4E3A${metrics.directionAccuracy7d.toFixed(1)}%\uFF0C\u63A5\u8FD1\u968F\u673A\u6C34\u5E73\u3002\u5EFA\u8BAE\u589E\u52A0\u66F4\u591A\u5E02\u573A\u4FE1\u53F7\u4F5C\u4E3A\u9884\u6D4B\u4F9D\u636E\u3002`,
      impact: "\u53EF\u80FD\u5BFC\u81F4\u53CD\u5411\u64CD\u4F5C\uFF0C\u9020\u6210\u635F\u5931",
      currentValue: `${metrics.directionAccuracy7d.toFixed(1)}%`,
      suggestedValue: "70%+",
      expectedImprovement: "\u51CF\u5C11\u53CD\u5411\u8C03\u6574\u5E26\u6765\u7684\u635F\u5931",
      confidence: 85,
      basedOn: `\u57FA\u4E8E${metrics.trackedAdjustments}\u6761\u8FFD\u8E2A\u6570\u636E\u7684\u65B9\u5411\u5206\u6790`,
      createdAt: /* @__PURE__ */ new Date()
    });
  }
  if (metrics.mae7d !== null && metrics.mae7d > 50) {
    suggestions.push({
      id: `suggestion_${Date.now()}_4`,
      category: "parameter",
      priority: "medium",
      title: "\u9884\u6D4B\u8BEF\u5DEE\u8F83\u5927",
      description: `\u5F53\u524D\u5E73\u5747\u7EDD\u5BF9\u8BEF\u5DEE\u4E3A$${metrics.mae7d.toFixed(2)}\uFF0C\u9884\u6D4B\u7CBE\u5EA6\u6709\u5F85\u63D0\u9AD8\u3002\u5EFA\u8BAE\u8C03\u6574\u5229\u6DA6\u8BA1\u7B97\u53C2\u6570\u3002`,
      impact: "\u9884\u4F30\u5229\u6DA6\u4E0E\u5B9E\u9645\u5229\u6DA6\u5DEE\u8DDD\u8F83\u5927",
      currentValue: `$${metrics.mae7d.toFixed(2)}`,
      suggestedValue: "<$30",
      expectedImprovement: "\u63D0\u9AD8\u9884\u6D4B\u7CBE\u5EA6\uFF0C\u51CF\u5C11\u8BEF\u5DEE",
      confidence: 75,
      basedOn: `\u57FA\u4E8E${metrics.trackedAdjustments}\u6761\u8FFD\u8E2A\u6570\u636E\u7684\u8BEF\u5DEE\u5206\u6790`,
      createdAt: /* @__PURE__ */ new Date()
    });
  }
  for (const typePerf of byType) {
    if (typePerf.count >= 10 && typePerf.accuracy < 40) {
      suggestions.push({
        id: `suggestion_${Date.now()}_type_${typePerf.value}`,
        category: "strategy",
        priority: "medium",
        title: `${typePerf.value}\u7C7B\u578B\u8C03\u6574\u6548\u679C\u4E0D\u4F73`,
        description: `${typePerf.value}\u7C7B\u578B\u7684\u8C03\u6574\u51C6\u786E\u7387\u4EC5\u4E3A${typePerf.accuracy.toFixed(1)}%\uFF0C\u5EFA\u8BAE\u51CF\u5C11\u6B64\u7C7B\u8C03\u6574\u7684\u4F7F\u7528\u9891\u7387\u6216\u4F18\u5316\u76F8\u5173\u53C2\u6570\u3002`,
        impact: `\u5F71\u54CD${typePerf.count}\u6B21\u8C03\u6574\u7684\u6548\u679C`,
        currentValue: `\u51C6\u786E\u7387${typePerf.accuracy.toFixed(1)}%`,
        suggestedValue: "\u51C6\u786E\u738760%+",
        expectedImprovement: "\u51CF\u5C11\u65E0\u6548\u8C03\u6574\uFF0C\u63D0\u9AD8\u6574\u4F53ROI",
        confidence: 70,
        basedOn: `\u57FA\u4E8E${typePerf.count}\u6761${typePerf.value}\u7C7B\u578B\u8C03\u6574\u6570\u636E`,
        createdAt: /* @__PURE__ */ new Date()
      });
    }
  }
  const poorRanges = byRange.filter((r) => r.count >= 5 && r.accuracy < 50);
  if (poorRanges.length > 0) {
    const rangeNames = poorRanges.map((r) => r.value).join("\u3001");
    suggestions.push({
      id: `suggestion_${Date.now()}_range`,
      category: "parameter",
      priority: "medium",
      title: "\u90E8\u5206\u8C03\u6574\u5E45\u5EA6\u6548\u679C\u4E0D\u4F73",
      description: `\u4EE5\u4E0B\u8C03\u6574\u5E45\u5EA6\u7684\u6548\u679C\u8F83\u5DEE\uFF1A${rangeNames}\u3002\u5EFA\u8BAE\u8C03\u6574maxBidIncreasePercent\u548CmaxBidDecreasePercent\u53C2\u6570\uFF0C\u907F\u514D\u8FD9\u4E9B\u5E45\u5EA6\u8303\u56F4\u3002`,
      impact: "\u51CF\u5C11\u5927\u5E45\u5EA6\u8C03\u6574\u5E26\u6765\u7684\u98CE\u9669",
      currentValue: `\u5F53\u524D\u6700\u5927\u63D0\u4EF7${currentParameters.maxBidIncreasePercent}%\uFF0C\u6700\u5927\u964D\u4EF7${currentParameters.maxBidDecreasePercent}%`,
      suggestedValue: "\u6839\u636E\u6570\u636E\u8C03\u6574\u5E45\u5EA6\u9650\u5236",
      expectedImprovement: "\u63D0\u9AD8\u6574\u4F53\u8C03\u6574\u6210\u529F\u7387",
      confidence: 65,
      // @ts-ignore
      basedOn: `\u57FA\u4E8E${poorRanges.reduce((sum2, r) => sum2 + r.count, 0)}\u6761\u8C03\u6574\u6570\u636E`,
      createdAt: /* @__PURE__ */ new Date()
    });
  }
  if (metrics.totalAdjustments < 50) {
    suggestions.push({
      id: `suggestion_${Date.now()}_data`,
      category: "strategy",
      priority: "low",
      title: "\u6570\u636E\u91CF\u4E0D\u8DB3",
      description: `\u5F53\u524D\u4EC5\u6709${metrics.totalAdjustments}\u6761\u8C03\u6574\u8BB0\u5F55\uFF0C\u5EFA\u8BAE\u79EF\u7D2F\u66F4\u591A\u6570\u636E\u540E\u518D\u8FDB\u884C\u6DF1\u5165\u5206\u6790\u548C\u4F18\u5316\u3002`,
      impact: "\u5206\u6790\u7ED3\u679C\u53EF\u80FD\u4E0D\u591F\u51C6\u786E",
      expectedImprovement: "\u83B7\u5F97\u66F4\u53EF\u9760\u7684\u4F18\u5316\u5EFA\u8BAE",
      confidence: 50,
      basedOn: `\u5F53\u524D\u6570\u636E\u91CF${metrics.totalAdjustments}\u6761`,
      createdAt: /* @__PURE__ */ new Date()
    });
  }
  if (metrics.trackingRate < 50) {
    suggestions.push({
      id: `suggestion_${Date.now()}_tracking`,
      category: "strategy",
      priority: "medium",
      title: "\u6548\u679C\u8FFD\u8E2A\u7387\u8F83\u4F4E",
      description: `\u5F53\u524D\u6548\u679C\u8FFD\u8E2A\u7387\u4EC5\u4E3A${metrics.trackingRate.toFixed(1)}%\uFF0C\u5927\u91CF\u8C03\u6574\u7F3A\u5C11\u6548\u679C\u6570\u636E\u3002\u5EFA\u8BAE\u68C0\u67E5\u6548\u679C\u8FFD\u8E2A\u5B9A\u65F6\u4EFB\u52A1\u662F\u5426\u6B63\u5E38\u8FD0\u884C\u3002`,
      impact: "\u65E0\u6CD5\u51C6\u786E\u8BC4\u4F30\u7B97\u6CD5\u6548\u679C",
      currentValue: `${metrics.trackingRate.toFixed(1)}%`,
      suggestedValue: "80%+",
      expectedImprovement: "\u83B7\u5F97\u66F4\u5B8C\u6574\u7684\u6548\u679C\u6570\u636E",
      confidence: 80,
      basedOn: `${metrics.totalAdjustments}\u6761\u8C03\u6574\u4E2D\u4EC5${metrics.trackedAdjustments}\u6761\u6709\u8FFD\u8E2A\u6570\u636E`,
      createdAt: /* @__PURE__ */ new Date()
    });
  }
  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  return suggestions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
}
function getParameterTuningSuggestions(metrics, byRange) {
  const suggestions = [];
  const largeIncrease = byRange.find((r) => r.value.includes("\u5927\u5E45\u63D0\u4EF7"));
  if (largeIncrease && largeIncrease.accuracy < 50 && largeIncrease.count >= 5) {
    suggestions.push({
      parameter: "maxBidIncreasePercent",
      current: currentParameters.maxBidIncreasePercent,
      suggested: Math.max(15, currentParameters.maxBidIncreasePercent - 10),
      reason: `\u5927\u5E45\u63D0\u4EF7\u51C6\u786E\u7387\u4EC5${largeIncrease.accuracy.toFixed(1)}%\uFF0C\u5EFA\u8BAE\u964D\u4F4E\u6700\u5927\u63D0\u4EF7\u5E45\u5EA6`
    });
  }
  const largeDecrease = byRange.find((r) => r.value.includes("\u5927\u5E45\u964D\u4EF7"));
  if (largeDecrease && largeDecrease.accuracy < 50 && largeDecrease.count >= 5) {
    suggestions.push({
      parameter: "maxBidDecreasePercent",
      current: currentParameters.maxBidDecreasePercent,
      suggested: Math.max(10, currentParameters.maxBidDecreasePercent - 5),
      reason: `\u5927\u5E45\u964D\u4EF7\u51C6\u786E\u7387\u4EC5${largeDecrease.accuracy.toFixed(1)}%\uFF0C\u5EFA\u8BAE\u964D\u4F4E\u6700\u5927\u964D\u4EF7\u5E45\u5EA6`
    });
  }
  if (metrics.accuracy7d !== null && metrics.accuracy7d < 60) {
    suggestions.push({
      parameter: "minConfidenceThreshold",
      current: currentParameters.minConfidenceThreshold,
      suggested: Math.min(85, currentParameters.minConfidenceThreshold + 10),
      reason: `\u6574\u4F53\u51C6\u786E\u7387\u8F83\u4F4E(${metrics.accuracy7d.toFixed(1)}%)\uFF0C\u5EFA\u8BAE\u63D0\u9AD8\u7F6E\u4FE1\u5EA6\u9608\u503C\u4EE5\u51CF\u5C11\u4F4E\u8D28\u91CF\u8C03\u6574`
    });
  }
  if (metrics.totalAdjustments > 100 && metrics.accuracy7d !== null && metrics.accuracy7d < 70) {
    suggestions.push({
      parameter: "minDataPoints",
      current: currentParameters.minDataPoints,
      suggested: Math.min(20, currentParameters.minDataPoints + 5),
      reason: `\u6570\u636E\u5145\u8DB3\u4F46\u51C6\u786E\u7387\u4E0D\u9AD8\uFF0C\u5EFA\u8BAE\u589E\u52A0\u6700\u5C0F\u6570\u636E\u70B9\u8981\u6C42\u4EE5\u63D0\u9AD8\u9884\u6D4B\u8D28\u91CF`
    });
  }
  return suggestions;
}
var DEFAULT_ALGORITHM_PARAMETERS, currentParameters;
var init_algorithmOptimizationService = __esm({
  "server/algorithm/algorithmOptimizationService.ts"() {
    "use strict";
    init_db2();
    init_schema2();
    init_drizzle_orm();
    DEFAULT_ALGORITHM_PARAMETERS = {
      maxBidIncreasePercent: 30,
      maxBidDecreasePercent: 20,
      minBidChangePercent: 5,
      profitMarginPercent: 30,
      conversionValueMultiplier: 1,
      maxDailyAdjustments: 100,
      cooldownPeriodHours: 24,
      minConfidenceThreshold: 70,
      minDataPoints: 10
    };
    currentParameters = { ...DEFAULT_ALGORITHM_PARAMETERS };
    __name(getAlgorithmParameters, "getAlgorithmParameters");
    __name(updateAlgorithmParameters, "updateAlgorithmParameters");
    __name(resetAlgorithmParameters, "resetAlgorithmParameters");
    __name(calculateAlgorithmPerformance, "calculateAlgorithmPerformance");
    __name(calculateAccuracy, "calculateAccuracy");
    __name(calculateMAE, "calculateMAE");
    __name(calculateRMSE, "calculateRMSE");
    __name(calculateDirectionAccuracy, "calculateDirectionAccuracy");
    __name(analyzeByAdjustmentType, "analyzeByAdjustmentType");
    __name(analyzeByBidChangeRange, "analyzeByBidChangeRange");
    __name(generateTypeRecommendation, "generateTypeRecommendation");
    __name(generateRangeRecommendation, "generateRangeRecommendation");
    __name(generateOptimizationSuggestions, "generateOptimizationSuggestions");
    __name(getParameterTuningSuggestions, "getParameterTuningSuggestions");
  }
});

