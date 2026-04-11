// Extracted from production dist/index.js
// Original module: server/services/historicalCpcFloorService.ts
// Lines: 108

var historicalCpcFloorService_exports = {};
__export(historicalCpcFloorService_exports, {
  getDynamicBidFloor: () => getDynamicBidFloor,
  getKeywordCpcFloor: () => getKeywordCpcFloor,
  getTargetCpcFloor: () => getTargetCpcFloor
});
async function getKeywordCpcFloor(accountId, keywordId, currentBid, minBidFloorRatio = 0.5) {
  const ratioFloor = currentBid * minBidFloorRatio;
  try {
    const db = await getDb();
    if (!db) {
      return { dynamicFloor: ratioFloor, historicalCpc: 0, source: "ratio_fallback", historicalOrders: 0, periodDescription: "DB\u4E0D\u53EF\u7528" };
    }
    const kwResult = await db.execute(sql`
      SELECT keywordCpc, orders
      FROM keywords
      WHERE id = ${keywordId} AND accountId = ${accountId}
    `);
    const kwRows = Array.isArray(kwResult) ? Array.isArray(kwResult[0]) ? kwResult[0] : kwResult : [];
    const kwRow = kwRows[0];
    if (kwRow) {
      const keywordCpc = Number(kwRow.keywordCpc) || 0;
      const orders = Number(kwRow.orders) || 0;
      if (keywordCpc > 0 && orders >= 4) {
        const dynamicFloor = Math.max(keywordCpc * 0.85, ratioFloor);
        log61.info(`[CpcFloor] keyword=${keywordId}: \u6C47\u603BCPC=$${keywordCpc.toFixed(2)} (${orders}\u5355), \u52A8\u6001\u5E95\u7EBF=$${dynamicFloor.toFixed(2)}`);
        return {
          dynamicFloor,
          historicalCpc: keywordCpc,
          source: "historical_cpc",
          historicalOrders: orders,
          periodDescription: `keywords\u8868\u6C47\u603B(${orders}\u5355)`
        };
      }
    }
    return {
      dynamicFloor: ratioFloor,
      historicalCpc: 0,
      source: "no_data",
      historicalOrders: 0,
      periodDescription: "\u65E0\u5386\u53F2\u51FA\u5355\u6570\u636E"
    };
  } catch (error48) {
    log61.warn(`[CpcFloor] \u67E5\u8BE2\u5931\u8D25(keyword=${keywordId}): ${error48.message}`);
    return { dynamicFloor: ratioFloor, historicalCpc: 0, source: "ratio_fallback", historicalOrders: 0, periodDescription: "\u67E5\u8BE2\u5F02\u5E38" };
  }
}
async function getTargetCpcFloor(accountId, targetId, currentBid, minBidFloorRatio = 0.5) {
  const ratioFloor = currentBid * minBidFloorRatio;
  try {
    const db = await getDb();
    if (!db) {
      return { dynamicFloor: ratioFloor, historicalCpc: 0, source: "ratio_fallback", historicalOrders: 0, periodDescription: "DB\u4E0D\u53EF\u7528" };
    }
    const ptResult = await db.execute(sql`
      SELECT targetCpc, orders
      FROM product_targets
      WHERE id = ${targetId} AND accountId = ${accountId}
    `);
    const ptRows = Array.isArray(ptResult) ? Array.isArray(ptResult[0]) ? ptResult[0] : ptResult : [];
    const ptRow = ptRows[0];
    if (ptRow) {
      const targetCpc = Number(ptRow.targetCpc) || 0;
      const orders = Number(ptRow.orders) || 0;
      if (targetCpc > 0 && orders >= 4) {
        const dynamicFloor = Math.max(targetCpc * 0.85, ratioFloor);
        return {
          dynamicFloor,
          historicalCpc: targetCpc,
          source: "historical_cpc",
          historicalOrders: orders,
          periodDescription: `product_targets\u8868\u6C47\u603B(${orders}\u5355)`
        };
      }
    }
    return {
      dynamicFloor: ratioFloor,
      historicalCpc: 0,
      source: "no_data",
      historicalOrders: 0,
      periodDescription: "\u65E0\u5386\u53F2\u51FA\u5355\u6570\u636E"
    };
  } catch (error48) {
    log61.warn(`[CpcFloor] \u67E5\u8BE2\u5931\u8D25(target=${targetId}): ${error48.message}`);
    return { dynamicFloor: ratioFloor, historicalCpc: 0, source: "ratio_fallback", historicalOrders: 0, periodDescription: "\u67E5\u8BE2\u5F02\u5E38" };
  }
}
async function getDynamicBidFloor(accountId, entityType, entityId, currentBid, minBidFloorRatio = 0.5) {
  if (entityType === "keyword") {
    return getKeywordCpcFloor(accountId, entityId, currentBid, minBidFloorRatio);
  } else {
    return getTargetCpcFloor(accountId, entityId, currentBid, minBidFloorRatio);
  }
}
var log61;
var init_historicalCpcFloorService = __esm({
  "server/services/historicalCpcFloorService.ts"() {
    "use strict";
    init_db2();
    init_drizzle_orm();
    init_logger();
    log61 = createModuleLogger("HistoricalCpcFloor");
    __name(getKeywordCpcFloor, "getKeywordCpcFloor");
    __name(getTargetCpcFloor, "getTargetCpcFloor");
    __name(getDynamicBidFloor, "getDynamicBidFloor");
  }
});

