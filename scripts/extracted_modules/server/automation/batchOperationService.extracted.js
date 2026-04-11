// Extracted from production dist/index.js
// Original module: server/automation/batchOperationService.ts
// Lines: 108

function calculateBidChangePercent(currentBid, newBid) {
  if (currentBid === 0) return newBid > 0 ? 100 : 0;
  return (newBid - currentBid) / currentBid * 100;
}
function validateNegativeKeywordItem(item) {
  if (!item.negativeKeyword || item.negativeKeyword.trim().length === 0) {
    return { valid: false, error: "\u5426\u5B9A\u8BCD\u4E0D\u80FD\u4E3A\u7A7A" };
  }
  if (item.negativeKeyword.length > 500) {
    return { valid: false, error: "\u5426\u5B9A\u8BCD\u957F\u5EA6\u4E0D\u80FD\u8D85\u8FC7500\u5B57\u7B26" };
  }
  if (!["negative_phrase", "negative_exact"].includes(item.negativeMatchType)) {
    return { valid: false, error: "\u65E0\u6548\u7684\u5339\u914D\u7C7B\u578B" };
  }
  if (!["ad_group", "campaign"].includes(item.negativeLevel)) {
    return { valid: false, error: "\u65E0\u6548\u7684\u5426\u5B9A\u8BCD\u5C42\u7EA7" };
  }
  return { valid: true };
}
function validateBidAdjustmentItem(item, maxBid = 100) {
  if (item.newBid < 0.02) {
    return { valid: false, error: "\u51FA\u4EF7\u4E0D\u80FD\u4F4E\u4E8E$0.02" };
  }
  if (item.newBid > maxBid) {
    return { valid: false, error: `\u51FA\u4EF7\u4E0D\u80FD\u8D85\u8FC7$${maxBid}` };
  }
  const changePercent = Math.abs(calculateBidChangePercent(item.currentBid, item.newBid));
  if (changePercent > 500) {
    return { valid: false, error: "\u5355\u6B21\u51FA\u4EF7\u8C03\u6574\u5E45\u5EA6\u4E0D\u80FD\u8D85\u8FC7500%" };
  }
  return { valid: true };
}
function generateBatchSummary(result) {
  const successRate = result.totalItems > 0 ? (result.successItems / result.totalItems * 100).toFixed(1) : "0";
  let summary = `\u6279\u91CF\u64CD\u4F5C\u5B8C\u6210
`;
  summary += `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
`;
  summary += `\u603B\u8BA1\u9879\u76EE: ${result.totalItems}
`;
  summary += `\u6210\u529F: ${result.successItems} (${successRate}%)
`;
  summary += `\u5931\u8D25: ${result.failedItems}
`;
  if (result.errors.length > 0) {
    summary += `
\u9519\u8BEF\u8BE6\u60C5:
`;
    result.errors.slice(0, 5).forEach((err, i) => {
      summary += `${i + 1}. \u9879\u76EE #${err.itemId}: ${err.error}
`;
    });
    if (result.errors.length > 5) {
      summary += `... \u8FD8\u6709 ${result.errors.length - 5} \u4E2A\u9519\u8BEF
`;
    }
  }
  return summary;
}
function prepareRollbackData(operationType, item) {
  const rollbackData = {
    operationType,
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  };
  if (operationType === "negative_keyword") {
    const nkItem = item;
    rollbackData.action = "remove_negative_keyword";
    rollbackData.negativeKeyword = nkItem.negativeKeyword;
    rollbackData.negativeMatchType = nkItem.negativeMatchType;
    rollbackData.negativeLevel = nkItem.negativeLevel;
  } else if (operationType === "bid_adjustment") {
    const bidItem = item;
    rollbackData.action = "restore_bid";
    rollbackData.originalBid = bidItem.currentBid;
  }
  return JSON.stringify(rollbackData);
}
function estimateExecutionTime(totalItems, operationType) {
  const timePerItem = {
    negative_keyword: 0.5,
    bid_adjustment: 0.3,
    keyword_migration: 1,
    campaign_status: 0.2
  };
  const baseTime = 5;
  return Math.ceil(baseTime + totalItems * timePerItem[operationType]);
}
function canRollback(status, completedAt) {
  if (status !== "completed") return false;
  if (completedAt) {
    const daysSinceCompletion = (Date.now() - completedAt.getTime()) / (1e3 * 60 * 60 * 24);
    if (daysSinceCompletion > 7) return false;
  }
  return true;
}
var init_batchOperationService = __esm({
  "server/automation/batchOperationService.ts"() {
    "use strict";
    __name(calculateBidChangePercent, "calculateBidChangePercent");
    __name(validateNegativeKeywordItem, "validateNegativeKeywordItem");
    __name(validateBidAdjustmentItem, "validateBidAdjustmentItem");
    __name(generateBatchSummary, "generateBatchSummary");
    __name(prepareRollbackData, "prepareRollbackData");
    __name(estimateExecutionTime, "estimateExecutionTime");
    __name(canRollback, "canRollback");
  }
});

