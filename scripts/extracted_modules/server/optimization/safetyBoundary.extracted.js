// Extracted from production dist/index.js
// Original module: server/optimization/safetyBoundary.ts
// Lines: 43

function applyBidSafetyBoundary(currentBid, suggestedBid) {
  const maxAllowed = currentBid * (1 + SAFETY_LIMITS.BID.MAX_INCREASE_PERCENT / 100);
  const minAllowed = currentBid * (1 - SAFETY_LIMITS.BID.MAX_DECREASE_PERCENT / 100);
  return Math.max(minAllowed, Math.min(maxAllowed, suggestedBid));
}
var SAFETY_LIMITS;
var init_safetyBoundary = __esm({
  "server/optimization/safetyBoundary.ts"() {
    "use strict";
    init_db2();
    init_schema2();
    SAFETY_LIMITS = {
      BUDGET: {
        MAX_INCREASE_PERCENT: 15,
        // 预算最大上调幅度(v2: 从25%降低到15%增加安全性)
        MAX_DECREASE_PERCENT: 15
        // 预算最大下调幅度(v2: 从25%降低到15%增加安全性)
      },
      BID: {
        MAX_INCREASE_PERCENT: 10,
        // 竞价最大上调幅度
        MAX_DECREASE_PERCENT: 20
        // 竞价最大下调幅度(v2: 从10%增加到20%以支持critical风险账户紧急止损)
      },
      PLACEMENT: {
        MAX_INCREASE_PERCENT: 25,
        // 位置最大上调幅度
        MAX_DECREASE_PERCENT: 25,
        // 位置最大下调幅度
        ABSOLUTE_MAX: 200
        // 位置调整绝对上限
      },
      DATA_WINDOW: {
        TOTAL_DAYS: 14,
        // 数据窗口总天数(v2: 从7天增加到14天以获取更稳定的数据)
        EXCLUDE_RECENT_DAYS: 2
        // 排除最近天数
      }
    };
    __name(applyBidSafetyBoundary, "applyBidSafetyBoundary");
  }
});

