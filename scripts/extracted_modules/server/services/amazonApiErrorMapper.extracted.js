// Extracted from production dist/index.js
// Original module: server/services/amazonApiErrorMapper.ts
// Lines: 339

var amazonApiErrorMapper_exports = {};
__export(amazonApiErrorMapper_exports, {
  classifyError: () => classifyError,
  getAllErrorMappings: () => getAllErrorMappings,
  getEntityMarkStatus: () => getEntityMarkStatus,
  isEntityNotFoundError: () => isEntityNotFoundError,
  isRetryableError: () => isRetryableError,
  isThrottleError: () => isThrottleError,
  shouldMarkEntityDeleted: () => shouldMarkEntityDeleted,
  summarizeErrors: () => summarizeErrors
});
function classifyError(errorMessage) {
  const lowerMessage = errorMessage.toLowerCase();
  let parsedMessage = lowerMessage;
  try {
    const parsed = JSON.parse(errorMessage);
    parsedMessage = JSON.stringify(parsed).toLowerCase();
  } catch {
  }
  for (const mapping of ERROR_MAPPINGS) {
    for (const pattern of mapping.patterns) {
      if (parsedMessage.includes(pattern)) {
        log87.debug(`[v509] \u9519\u8BEF\u5206\u7C7B: "${errorMessage.substring(0, 100)}" \u2192 ${mapping.code} (${mapping.strategy})`);
        return mapping;
      }
    }
  }
  log87.warn(`[v509] \u672A\u77E5\u9519\u8BEF\u7C7B\u578B\uFF0C\u4F7F\u7528\u9ED8\u8BA4\u6620\u5C04: "${errorMessage.substring(0, 200)}"`);
  return {
    code: "UNKNOWN",
    patterns: [],
    strategy: "retry",
    taskStatus: "failed",
    eventSyncStatus: "failed",
    markEntityStatus: null,
    description: "\u672A\u77E5\u9519\u8BEF\uFF0C\u5C1D\u8BD5\u91CD\u8BD5",
    maxRetries: 3,
    severity: "medium"
  };
}
function isEntityNotFoundError(errorMessage) {
  const mapping = classifyError(errorMessage);
  return mapping.code === "ENTITY_NOT_FOUND" || mapping.code === "ENTITY_STATE_ERROR" || mapping.code === "KEYWORD_AD_GROUP_NOT_FOUND" || mapping.code === "CAMPAIGN_NOT_FOUND";
}
function isRetryableError(errorMessage) {
  const mapping = classifyError(errorMessage);
  return mapping.strategy === "retry" || mapping.strategy === "throttle_retry";
}
function isThrottleError(errorMessage) {
  const mapping = classifyError(errorMessage);
  return mapping.strategy === "throttle_retry";
}
function shouldMarkEntityDeleted(errorMessage) {
  const mapping = classifyError(errorMessage);
  return mapping.markEntityStatus === "amazon_deleted" || mapping.markEntityStatus === "amazon_archived";
}
function getEntityMarkStatus(errorMessage) {
  const mapping = classifyError(errorMessage);
  return mapping.markEntityStatus || null;
}
function getAllErrorMappings() {
  return [...ERROR_MAPPINGS];
}
function summarizeErrors(errors) {
  const summary = {};
  for (const error48 of errors) {
    const mapping = classifyError(error48);
    if (!summary[mapping.strategy]) {
      summary[mapping.strategy] = { count: 0, codes: /* @__PURE__ */ new Set() };
    }
    summary[mapping.strategy].count++;
    summary[mapping.strategy].codes.add(mapping.code);
  }
  const result = {};
  for (const [strategy, data] of Object.entries(summary)) {
    result[strategy] = { count: data.count, codes: Array.from(data.codes) };
  }
  return result;
}
var log87, ERROR_MAPPINGS;
var init_amazonApiErrorMapper = __esm({
  "server/services/amazonApiErrorMapper.ts"() {
    "use strict";
    init_logger();
    log87 = createModuleLogger("ApiErrorMapper");
    ERROR_MAPPINGS = [
      // ==================== 实体不存在类 ====================
      {
        code: "ENTITY_NOT_FOUND",
        patterns: [
          "entitynotfounderror",
          "entity_not_found",
          "could not find",
          "not found",
          "does not exist"
        ],
        strategy: "mark_deleted",
        taskStatus: "permanently_failed",
        eventSyncStatus: "permanently_failed",
        markEntityStatus: "amazon_deleted",
        description: "\u5B9E\u4F53\u5728Amazon\u7AEF\u5DF2\u4E0D\u5B58\u5728\uFF08\u5DF2\u88AB\u5220\u9664\u6216\u4ECE\u672A\u521B\u5EFA\u6210\u529F\uFF09",
        severity: "medium"
      },
      {
        code: "ENTITY_STATE_ERROR",
        patterns: [
          "entitystateerror",
          "entity_state_error",
          "archived entity",
          "entity is archived"
        ],
        strategy: "mark_archived",
        taskStatus: "permanently_failed",
        eventSyncStatus: "permanently_failed",
        markEntityStatus: "amazon_archived",
        description: "\u5B9E\u4F53\u5728Amazon\u7AEF\u5DF2\u5F52\u6863\uFF0C\u65E0\u6CD5\u4FEE\u6539",
        severity: "medium"
      },
      {
        code: "KEYWORD_AD_GROUP_NOT_FOUND",
        patterns: [
          "keyword_cannot_find_ad_group",
          "ad group not found",
          "adgroup not found",
          "cannot find ad group",
          "cannot find the adgroup"
          // v522: Amazon实际返回的错误消息格式
        ],
        strategy: "mark_deleted",
        taskStatus: "permanently_failed",
        eventSyncStatus: "permanently_failed",
        markEntityStatus: "amazon_deleted",
        description: "\u5173\u952E\u8BCD\u6240\u5C5E\u7684\u5E7F\u544A\u7EC4\u5728Amazon\u7AEF\u5DF2\u4E0D\u5B58\u5728",
        severity: "high"
      },
      {
        code: "CAMPAIGN_NOT_FOUND",
        patterns: [
          "campaign not found",
          "campaign does not exist",
          "invalid campaign"
        ],
        strategy: "mark_deleted",
        taskStatus: "permanently_failed",
        eventSyncStatus: "permanently_failed",
        markEntityStatus: "amazon_deleted",
        // v531: 修复Campaign不存在时未标记实体状态的Bug
        description: "\u5E7F\u544A\u6D3B\u52A8\u5728Amazon\u7AEF\u5DF2\u4E0D\u5B58\u5728",
        severity: "high"
      },
      // ==================== 参数错误类 ====================
      {
        code: "MALFORMED_VALUE",
        patterns: [
          "malformedvalueerror",
          "malformed_value",
          "invalid value",
          "value is not valid"
        ],
        strategy: "permanently_fail",
        taskStatus: "permanently_failed",
        eventSyncStatus: "permanently_failed",
        markEntityStatus: null,
        description: "\u8BF7\u6C42\u53C2\u6570\u503C\u683C\u5F0F\u9519\u8BEF\uFF08\u5982\u51FA\u4EF7\u8D85\u51FA\u8303\u56F4\uFF09",
        severity: "high"
      },
      {
        code: "INVALID_ARGUMENT",
        patterns: [
          "invalid_argument",
          "invalidargument",
          "bad request",
          "invalid parameter"
        ],
        strategy: "permanently_fail",
        taskStatus: "permanently_failed",
        eventSyncStatus: "permanently_failed",
        markEntityStatus: null,
        description: "\u8BF7\u6C42\u53C2\u6570\u65E0\u6548",
        severity: "high"
      },
      {
        code: "DUPLICATE_VALUE",
        patterns: [
          "duplicatevalueerror",
          "duplicate_value",
          "already exists",
          "duplicate entry"
        ],
        strategy: "skip",
        taskStatus: "synced",
        // 重复意味着已经存在，视为成功
        eventSyncStatus: "synced",
        markEntityStatus: null,
        description: "\u5B9E\u4F53\u5DF2\u5B58\u5728\uFF08\u91CD\u590D\u521B\u5EFA\uFF09\uFF0C\u89C6\u4E3A\u6210\u529F",
        severity: "low"
      },
      // ==================== 限流/服务端错误类 ====================
      {
        code: "THROTTLED",
        patterns: [
          "too many requests",
          "throttl",
          "rate limit",
          "\u8BF7\u6C42\u8FC7\u4E8E\u9891\u7E41",
          "status=429"
        ],
        strategy: "throttle_retry",
        taskStatus: "failed",
        eventSyncStatus: "failed",
        markEntityStatus: null,
        description: "API\u9650\u6D41\uFF0C\u9700\u8981\u964D\u901F\u91CD\u8BD5",
        maxRetries: 5,
        severity: "medium"
      },
      {
        code: "SERVER_ERROR",
        patterns: [
          "internal server error",
          "status=500",
          "status=502",
          "status=503",
          "service unavailable",
          "gateway timeout"
        ],
        strategy: "retry",
        taskStatus: "failed",
        eventSyncStatus: "failed",
        markEntityStatus: null,
        description: "Amazon\u670D\u52A1\u7AEF\u9519\u8BEF\uFF0C\u53EF\u91CD\u8BD5",
        maxRetries: 3,
        severity: "medium"
      },
      {
        code: "NETWORK_ERROR",
        patterns: [
          "econnreset",
          "etimedout",
          "econnrefused",
          "network error",
          "socket hang up"
        ],
        strategy: "retry",
        taskStatus: "failed",
        eventSyncStatus: "failed",
        markEntityStatus: null,
        description: "\u7F51\u7EDC\u8FDE\u63A5\u9519\u8BEF\uFF0C\u53EF\u91CD\u8BD5",
        maxRetries: 3,
        severity: "medium"
      },
      // ==================== 权限/认证类 ====================
      {
        code: "AUTH_EXPIRED",
        patterns: [
          "status=401",
          "unauthorized",
          "token expired",
          "invalid token"
        ],
        strategy: "retry",
        taskStatus: "failed",
        eventSyncStatus: "failed",
        markEntityStatus: null,
        description: "\u8BA4\u8BC1\u8FC7\u671F\uFF0C\u9700\u8981\u5237\u65B0Token\u540E\u91CD\u8BD5",
        maxRetries: 2,
        severity: "high"
      },
      {
        code: "PERMISSION_DENIED",
        patterns: [
          "status=403",
          "forbidden",
          "permission_denied",
          "access denied"
        ],
        strategy: "skip",
        taskStatus: "permanently_failed",
        eventSyncStatus: "not_applicable",
        markEntityStatus: null,
        description: "\u6743\u9650\u4E0D\u8DB3\uFF08\u5982\u8D26\u6237\u672A\u5F00\u901A\u8BE5\u5E7F\u544A\u7C7B\u578B\uFF09",
        severity: "low"
      },
      // ==================== 业务逻辑类 ====================
      {
        code: "BID_BELOW_MINIMUM",
        patterns: [
          "bid below minimum",
          "minimum bid",
          "bid must be at least",
          "bid too low"
        ],
        strategy: "permanently_fail",
        taskStatus: "permanently_failed",
        eventSyncStatus: "permanently_failed",
        markEntityStatus: null,
        description: "\u51FA\u4EF7\u4F4E\u4E8EAmazon\u6700\u4F4E\u9650\u5236",
        severity: "medium"
      },
      {
        code: "BID_ABOVE_MAXIMUM",
        patterns: [
          "bid above maximum",
          "maximum bid",
          "bid must not exceed",
          "bid too high"
        ],
        strategy: "permanently_fail",
        taskStatus: "permanently_failed",
        eventSyncStatus: "permanently_failed",
        markEntityStatus: null,
        description: "\u51FA\u4EF7\u8D85\u8FC7Amazon\u6700\u9AD8\u9650\u5236",
        severity: "medium"
      },
      {
        code: "BUDGET_BELOW_MINIMUM",
        patterns: [
          "budget below minimum",
          "minimum budget",
          "budget must be at least"
        ],
        strategy: "permanently_fail",
        taskStatus: "permanently_failed",
        eventSyncStatus: "permanently_failed",
        markEntityStatus: null,
        description: "\u9884\u7B97\u4F4E\u4E8EAmazon\u6700\u4F4E\u9650\u5236",
        severity: "medium"
      }
    ];
    __name(classifyError, "classifyError");
    __name(isEntityNotFoundError, "isEntityNotFoundError");
    __name(isRetryableError, "isRetryableError");
    __name(isThrottleError, "isThrottleError");
    __name(shouldMarkEntityDeleted, "shouldMarkEntityDeleted");
    __name(getEntityMarkStatus, "getEntityMarkStatus");
    __name(getAllErrorMappings, "getAllErrorMappings");
    __name(summarizeErrors, "summarizeErrors");
  }
});

