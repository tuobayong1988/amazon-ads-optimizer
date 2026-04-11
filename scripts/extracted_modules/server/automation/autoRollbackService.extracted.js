// Extracted from production dist/index.js
// Original module: server/automation/autoRollbackService.ts
// Lines: 279

function getRollbackRules() {
  return [...rollbackRules];
}
function getRollbackRule(ruleId) {
  return rollbackRules.find((r) => r.id === ruleId);
}
function createRollbackRule(rule) {
  const newRule = {
    ...rule,
    id: `rule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    createdAt: /* @__PURE__ */ new Date(),
    updatedAt: /* @__PURE__ */ new Date()
  };
  rollbackRules.push(newRule);
  return newRule;
}
function updateRollbackRule(ruleId, updates) {
  const index2 = rollbackRules.findIndex((r) => r.id === ruleId);
  if (index2 === -1) return null;
  rollbackRules[index2] = {
    ...rollbackRules[index2],
    ...updates,
    updatedAt: /* @__PURE__ */ new Date()
  };
  return rollbackRules[index2];
}
function deleteRollbackRule(ruleId) {
  const index2 = rollbackRules.findIndex((r) => r.id === ruleId);
  if (index2 === -1) return false;
  rollbackRules.splice(index2, 1);
  return true;
}
function evaluateAdjustment(record2, rule) {
  if (!rule.enabled) return null;
  let actualProfit = null;
  let trackingDays = 0;
  if (rule.conditions.minTrackingDays <= 7 && record2.actualProfit7D !== null) {
    actualProfit = parseFloat(String(record2.actualProfit7D));
    trackingDays = 7;
  } else if (rule.conditions.minTrackingDays <= 14 && record2.actualProfit14D !== null) {
    actualProfit = parseFloat(String(record2.actualProfit14D));
    trackingDays = 14;
  } else if (rule.conditions.minTrackingDays <= 30 && record2.actualProfit30D !== null) {
    actualProfit = parseFloat(String(record2.actualProfit30D));
    trackingDays = 30;
  }
  if (actualProfit === null) return null;
  const estimatedProfit = parseFloat(String(record2.estimatedProfitChange || 0));
  const bidChange = parseFloat(String(record2.bidChangePercent || 0));
  if (!rule.conditions.includeNegativeAdjustments && bidChange < 0) {
    return null;
  }
  let profitDifferencePercent;
  if (estimatedProfit === 0) {
    profitDifferencePercent = actualProfit < 0 ? 0 : 100;
  } else if (estimatedProfit > 0) {
    profitDifferencePercent = actualProfit / estimatedProfit * 100;
  } else {
    profitDifferencePercent = actualProfit <= estimatedProfit ? 100 : actualProfit / estimatedProfit * 100;
  }
  if (profitDifferencePercent >= rule.conditions.profitThresholdPercent) {
    return null;
  }
  const suggestion = {
    id: `suggestion_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    ruleId: rule.id,
    ruleName: rule.name,
    adjustmentId: record2.id,
    keywordId: record2.keywordId,
    keywordText: record2.keywordText || "",
    campaignId: record2.campaignId,
    campaignName: record2.campaignName || "",
    previousBid: parseFloat(String(record2.previousBid)),
    newBid: parseFloat(String(record2.newBid)),
    bidChangePercent: bidChange,
    adjustedAt: new Date(record2.adjustedAt),
    estimatedProfit,
    actualProfit,
    profitDifferencePercent: Math.round(profitDifferencePercent * 100) / 100,
    trackingDays,
    status: "pending",
    priority: rule.actions.notificationPriority,
    reason: generateRollbackReason(rule, estimatedProfit, actualProfit, profitDifferencePercent, trackingDays),
    createdAt: /* @__PURE__ */ new Date()
  };
  return suggestion;
}
function generateRollbackReason(rule, estimatedProfit, actualProfit, profitDifferencePercent, trackingDays) {
  const profitDiff = actualProfit - estimatedProfit;
  const direction = profitDiff < 0 ? "\u4F4E\u4E8E" : "\u9AD8\u4E8E";
  return `\u6839\u636E\u89C4\u5219"${rule.name}"\uFF1A${trackingDays}\u5929\u5B9E\u9645\u5229\u6DA6($${actualProfit.toFixed(2)})${direction}\u9884\u4F30\u5229\u6DA6($${estimatedProfit.toFixed(2)})${Math.abs(100 - profitDifferencePercent).toFixed(1)}%\uFF0C\u89E6\u53D1\u56DE\u6EDA\u5EFA\u8BAE\u3002`;
}
async function runRollbackEvaluation(accountId) {
  const db = await getDb();
  if (!db) return { evaluated: 0, suggestions: [] };
  let query = db.select().from(bidAdjustmentHistory).where(
    and(
      sql`${bidAdjustmentHistory.status} != 'rolled_back'`,
      // 至少有7天追踪数据
      isNotNull(bidAdjustmentHistory.actualProfit7D)
    )
  );
  const records = await query;
  const filteredRecords = accountId ? records.filter((r) => r.accountId === accountId) : records;
  const newSuggestions = [];
  const enabledRules = rollbackRules.filter((r) => r.enabled);
  for (const record2 of filteredRecords) {
    for (const rule of enabledRules) {
      const existingSuggestion = rollbackSuggestions.find(
        // @ts-ignore
        (s) => s.adjustmentId === record2.id && s.ruleId === rule.id && s.status === "pending"
      );
      if (existingSuggestion) continue;
      const suggestion = evaluateAdjustment(record2, rule);
      if (suggestion) {
        newSuggestions.push(suggestion);
        rollbackSuggestions.push(suggestion);
      }
    }
  }
  return {
    evaluated: filteredRecords.length,
    suggestions: newSuggestions
  };
}
function getRollbackSuggestions(filters) {
  let suggestions = [...rollbackSuggestions];
  if (filters?.status) {
    suggestions = suggestions.filter((s) => s.status === filters.status);
  }
  if (filters?.priority) {
    suggestions = suggestions.filter((s) => s.priority === filters.priority);
  }
  if (filters?.ruleId) {
    suggestions = suggestions.filter((s) => s.ruleId === filters.ruleId);
  }
  return suggestions.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}
function getRollbackSuggestion(suggestionId) {
  return rollbackSuggestions.find((s) => s.id === suggestionId);
}
function reviewRollbackSuggestion(suggestionId, action, reviewedBy, reviewNote) {
  const index2 = rollbackSuggestions.findIndex((s) => s.id === suggestionId);
  if (index2 === -1) return null;
  rollbackSuggestions[index2] = {
    ...rollbackSuggestions[index2],
    status: action === "approve" ? "approved" : "rejected",
    reviewedAt: /* @__PURE__ */ new Date(),
    reviewedBy,
    reviewNote
  };
  return rollbackSuggestions[index2];
}
async function executeRollbackSuggestion(suggestionId) {
  const suggestion = rollbackSuggestions.find((s) => s.id === suggestionId);
  if (!suggestion) {
    return { success: false, message: "\u5EFA\u8BAE\u4E0D\u5B58\u5728" };
  }
  if (suggestion.status !== "approved") {
    return { success: false, message: "\u5EFA\u8BAE\u5C1A\u672A\u6279\u51C6" };
  }
  const index2 = rollbackSuggestions.findIndex((s) => s.id === suggestionId);
  rollbackSuggestions[index2] = {
    ...rollbackSuggestions[index2],
    status: "executed"
  };
  return { success: true, message: "\u56DE\u6EDA\u5EFA\u8BAE\u5DF2\u6267\u884C" };
}
function getRollbackSuggestionStats() {
  const stats4 = {
    total: rollbackSuggestions.length,
    pending: 0,
    approved: 0,
    rejected: 0,
    executed: 0,
    byPriority: { low: 0, medium: 0, high: 0 },
    byRule: {}
  };
  for (const suggestion of rollbackSuggestions) {
    stats4[suggestion.status]++;
    stats4.byPriority[suggestion.priority]++;
    stats4.byRule[suggestion.ruleId] = (stats4.byRule[suggestion.ruleId] || 0) + 1;
  }
  return stats4;
}
function cleanupOldSuggestions() {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1e3);
  const originalCount = rollbackSuggestions.length;
  rollbackSuggestions = rollbackSuggestions.filter(
    (s) => s.status === "pending" || s.createdAt > thirtyDaysAgo
  );
  return originalCount - rollbackSuggestions.length;
}
var DEFAULT_ROLLBACK_RULES, rollbackRules, rollbackSuggestions;
var init_autoRollbackService = __esm({
  "server/automation/autoRollbackService.ts"() {
    "use strict";
    init_db2();
    init_schema2();
    init_drizzle_orm();
    DEFAULT_ROLLBACK_RULES = [
      {
        id: "rule_severe_underperform",
        name: "\u4E25\u91CD\u6548\u679C\u4E0D\u4F73",
        description: "\u5B9E\u9645\u6548\u679C\u4F4E\u4E8E\u9884\u4F3070%\u4EE5\u4E0A\uFF0C\u5EFA\u8BAE\u7ACB\u5373\u56DE\u6EDA",
        enabled: true,
        conditions: {
          profitThresholdPercent: 30,
          // 实际效果只有预估的30%或更低
          minTrackingDays: 7,
          minSampleCount: 1,
          includeNegativeAdjustments: false
        },
        actions: {
          autoRollback: false,
          sendNotification: true,
          notificationPriority: "high"
        },
        createdAt: /* @__PURE__ */ new Date(),
        updatedAt: /* @__PURE__ */ new Date()
      },
      {
        id: "rule_moderate_underperform",
        name: "\u4E2D\u5EA6\u6548\u679C\u4E0D\u4F73",
        description: "\u5B9E\u9645\u6548\u679C\u4F4E\u4E8E\u9884\u4F3050%\uFF0C\u5EFA\u8BAE\u8003\u8651\u56DE\u6EDA",
        enabled: true,
        conditions: {
          profitThresholdPercent: 50,
          minTrackingDays: 14,
          minSampleCount: 3,
          includeNegativeAdjustments: false
        },
        actions: {
          autoRollback: false,
          sendNotification: true,
          notificationPriority: "medium"
        },
        createdAt: /* @__PURE__ */ new Date(),
        updatedAt: /* @__PURE__ */ new Date()
      },
      {
        id: "rule_long_term_underperform",
        name: "\u957F\u671F\u6548\u679C\u4E0D\u4F73",
        description: "30\u5929\u540E\u5B9E\u9645\u6548\u679C\u4ECD\u4F4E\u4E8E\u9884\u4F3040%\uFF0C\u5F3A\u70C8\u5EFA\u8BAE\u56DE\u6EDA",
        enabled: true,
        conditions: {
          profitThresholdPercent: 40,
          minTrackingDays: 30,
          minSampleCount: 1,
          includeNegativeAdjustments: true
        },
        actions: {
          autoRollback: false,
          sendNotification: true,
          notificationPriority: "high"
        },
        createdAt: /* @__PURE__ */ new Date(),
        updatedAt: /* @__PURE__ */ new Date()
      }
    ];
    rollbackRules = [...DEFAULT_ROLLBACK_RULES];
    rollbackSuggestions = [];
    __name(getRollbackRules, "getRollbackRules");
    __name(getRollbackRule, "getRollbackRule");
    __name(createRollbackRule, "createRollbackRule");
    __name(updateRollbackRule, "updateRollbackRule");
    __name(deleteRollbackRule, "deleteRollbackRule");
    __name(evaluateAdjustment, "evaluateAdjustment");
    __name(generateRollbackReason, "generateRollbackReason");
    __name(runRollbackEvaluation, "runRollbackEvaluation");
    __name(getRollbackSuggestions, "getRollbackSuggestions");
    __name(getRollbackSuggestion, "getRollbackSuggestion");
    __name(reviewRollbackSuggestion, "reviewRollbackSuggestion");
    __name(executeRollbackSuggestion, "executeRollbackSuggestion");
    __name(getRollbackSuggestionStats, "getRollbackSuggestionStats");
    __name(cleanupOldSuggestions, "cleanupOldSuggestions");
  }
});

