// Extracted from production dist/index.js
// Original module: server/services/historicalDataRecoveryService.ts
// Lines: 328

var historicalDataRecoveryService_exports = {};
__export(historicalDataRecoveryService_exports, {
  RECOVERY_CONFIG: () => RECOVERY_CONFIG,
  scanAndRecoverDormantTargets: () => scanAndRecoverDormantTargets
});
async function scanAndRecoverDormantTargets(accountId) {
  const startTime = Date.now();
  const allCandidates = [];
  let totalScanned = 0;
  log145.info(`[HistoricalRecovery] ========== \u5F00\u59CB\u77FF\u6E23\u63D0\u70BC\u626B\u63CF (accountId=${accountId}) ==========`);
  try {
    const kwResult = await scanDormantKeywords(accountId);
    allCandidates.push(...kwResult.candidates);
    totalScanned += kwResult.scanned;
    const ptResult = await scanDormantProductTargets(accountId);
    allCandidates.push(...ptResult.candidates);
    totalScanned += ptResult.scanned;
    allCandidates.sort((a, b) => b.priority - a.priority);
    const batch = allCandidates.slice(0, RECOVERY_CONFIG.maxRecoveryBatchSize);
    log145.info(`[HistoricalRecovery] \u626B\u63CF\u5B8C\u6210: \u5171${totalScanned}\u4E2A\u6295\u653E\u8BCD, \u53D1\u73B0${allCandidates.length}\u4E2A\u5019\u9009, \u672C\u6279\u6062\u590D${batch.length}\u4E2A`);
    let recovered = 0;
    for (const candidate of batch) {
      try {
        const success2 = await executeRecovery(candidate);
        if (success2) recovered++;
      } catch (err) {
        log145.warn(`[HistoricalRecovery] \u6062\u590D\u5931\u8D25(${candidate.entityType}=${candidate.entityId}): ${err.message}`);
      }
    }
    const duration3 = Date.now() - startTime;
    log145.info(`[HistoricalRecovery] ========== \u77FF\u6E23\u63D0\u70BC\u5B8C\u6210 (${duration3}ms) ==========`);
    log145.info(`[HistoricalRecovery] \u6C47\u603B: \u626B\u63CF${totalScanned}\u4E2A, \u5019\u9009${allCandidates.length}\u4E2A, \u6062\u590D${recovered}\u4E2A`);
    if (recovered > 0) {
      logOptimization(`[HistoricalRecovery] \u8D26\u6237${accountId}: \u6062\u590D${recovered}\u4E2A\u6C89\u5BC2\u6295\u653E\u8BCD\u51FA\u4EF7`);
    }
    return {
      accountId,
      scanTime: /* @__PURE__ */ new Date(),
      duration: duration3,
      totalScanned,
      candidatesFound: allCandidates.length,
      recovered,
      candidates: batch
    };
  } catch (error48) {
    log145.error(`[HistoricalRecovery] \u626B\u63CF\u5F02\u5E38: ${error48.message}`);
    return {
      accountId,
      scanTime: /* @__PURE__ */ new Date(),
      duration: Date.now() - startTime,
      totalScanned,
      candidatesFound: 0,
      recovered: 0,
      candidates: []
    };
  }
}
async function scanDormantKeywords(accountId) {
  const candidates = [];
  try {
    const db = await getDb();
    if (!db) return { scanned: 0, candidates };
    const config2 = RECOVERY_CONFIG;
    const result = await db.execute(sql`
      SELECT 
        k.id, k.keywordId, k.keywordText, k.matchType,
        k.bid as currentBid, k.keywordCpc as historicalCpc,
        k.orders as totalOrders, k.clicks as totalClicks,
        k.campaignId,
        c.campaignName,
        c.campaignType,
        k.updatedAt
      FROM keywords k
      JOIN campaigns c ON k.campaignId = c.campaignId AND k.accountId = c.accountId
      WHERE k.accountId = ${accountId}
        AND k.keywordStatus = 'enabled'
        AND k.bid IS NOT NULL
        AND k.orders >= ${config2.historicalOrderThreshold}
        AND k.keywordCpc > 0
        AND CAST(k.bid AS DECIMAL(10,2)) < k.keywordCpc * ${config2.bidSuppressionRatio}
    `);
    const rows = Array.isArray(result) ? Array.isArray(result[0]) ? result[0] : result : [];
    const kwRows = rows;
    log145.info(`[HistoricalRecovery] \u5173\u952E\u8BCD\u626B\u63CF: ${kwRows.length}\u4E2A\u5019\u9009(\u5386\u53F2\u8BA2\u5355>=${config2.historicalOrderThreshold}, \u51FA\u4EF7\u88AB\u538B\u5236)`);
    for (const kw of kwRows) {
      /* v608: \u67e5\u8be2\u8fd1\u671f\u8ba2\u5355\u6570\u636e\uff0c\u4e0d\u518d\u786c\u7f16\u7801\u4e3a0 */
      let recentOrders = 0;
      try {
        const recentResult = await db.execute(sql`
          SELECT COALESCE(SUM(orders), 0) as recent_orders
          FROM daily_performance
          WHERE accountId = ${accountId}
            AND campaignId = ${String(kw.campaignId)}
            AND date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
        `);
        const recentRows = Array.isArray(recentResult) ? Array.isArray(recentResult[0]) ? recentResult[0] : recentResult : [];
        recentOrders = Number(recentRows[0]?.recent_orders) || 0;
      } catch (e) { /* \u67e5\u8be2\u5931\u8d25\u4e0d\u5f71\u54cd\u4e3b\u6d41\u7a0b */ }
      const lastRecovery = await getLastRecoveryTime(db, accountId, "keyword", Number(kw.id));
      if (lastRecovery && Date.now() - lastRecovery.getTime() < config2.recoveryIntervalDays * 864e5) continue;
      const currentBid = Number(kw.currentBid) || 0;
      const historicalCpc = Number(kw.historicalCpc) || 0;
      const totalOrders = Number(kw.totalOrders) || 0;
      const bidGapPercent = (historicalCpc - currentBid) / historicalCpc * 100;
      /* v608: \u6c89\u5bc2\u8bcd\u6062\u590d\u4e5f\u4e0d\u53d7\u00b120%\u9650\u5236\uff0c\u76f4\u63a5\u6062\u590d\u5230\u76ee\u6807\u51fa\u4ef7 */
      const targetBid = historicalCpc * config2.recoveryTargetRatio;
      const proposedBid = Math.round(Math.min(targetBid, 15.0) * 100) / 100;
      if (proposedBid <= currentBid + 0.01) continue;
      const priority = totalOrders * (bidGapPercent / 100);
      candidates.push({
        entityType: "keyword",
        entityId: Number(kw.id),
        entityName: `${kw.keywordText} (${kw.matchType})`,
        accountId,
        campaignId: String(kw.campaignId || ""),
        campaignName: String(kw.campaignName || ""),
        adType: String(kw.campaignType || "sp"),
        currentBid,
        historicalCpc,
        historicalOrders: totalOrders,
        recentOrders,
        bidGapPercent,
        proposedBid,
        priority
      });
    }
    return { scanned: kwRows.length, candidates };
  } catch (error48) {
    log145.error(`[HistoricalRecovery] \u5173\u952E\u8BCD\u626B\u63CF\u5931\u8D25: ${error48.message}`);
    return { scanned: 0, candidates };
  }
}
async function scanDormantProductTargets(accountId) {
  const candidates = [];
  try {
    const db = await getDb();
    if (!db) return { scanned: 0, candidates };
    const config2 = RECOVERY_CONFIG;
    const result = await db.execute(sql`
      SELECT 
        pt.id, pt.targetId, pt.targetValue,
        pt.bid as currentBid, pt.targetCpc as historicalCpc,
        pt.orders as totalOrders, pt.clicks as totalClicks,
        pt.campaignId,
        c.campaignName,
        c.campaignType,
        pt.updatedAt
      FROM product_targets pt
      JOIN campaigns c ON pt.campaignId = c.campaignId AND pt.accountId = c.accountId
      WHERE pt.accountId = ${accountId}
        AND pt.targetStatus = 'enabled'
        AND pt.bid IS NOT NULL
        AND pt.orders >= ${config2.historicalOrderThreshold}
        AND pt.targetCpc > 0
        AND CAST(pt.bid AS DECIMAL(10,2)) < pt.targetCpc * ${config2.bidSuppressionRatio}
    `);
    const rows = Array.isArray(result) ? Array.isArray(result[0]) ? result[0] : result : [];
    const ptRows = rows;
    log145.info(`[HistoricalRecovery] Product Target\u626B\u63CF: ${ptRows.length}\u4E2A\u5019\u9009`);
    for (const pt of ptRows) {
      /* v608: \u67e5\u8be2\u8fd1\u671f\u8ba2\u5355\u6570\u636e\uff0c\u4e0d\u518d\u786c\u7f16\u7801\u4e3a0 */
      let recentOrders = 0;
      try {
        const recentResult = await db.execute(sql`
          SELECT COALESCE(SUM(orders), 0) as recent_orders
          FROM daily_performance
          WHERE accountId = ${accountId}
            AND campaignId = ${String(pt.campaignId)}
            AND date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
        `);
        const recentRows = Array.isArray(recentResult) ? Array.isArray(recentResult[0]) ? recentResult[0] : recentResult : [];
        recentOrders = Number(recentRows[0]?.recent_orders) || 0;
      } catch (e) { /* \u67e5\u8be2\u5931\u8d25\u4e0d\u5f71\u54cd\u4e3b\u6d41\u7a0b */ }
      const lastRecovery = await getLastRecoveryTime(db, accountId, "product_target", Number(pt.id));
      if (lastRecovery && Date.now() - lastRecovery.getTime() < config2.recoveryIntervalDays * 864e5) continue;
      const currentBid = Number(pt.currentBid) || 0;
      const historicalCpc = Number(pt.historicalCpc) || 0;
      const totalOrders = Number(pt.totalOrders) || 0;
      const bidGapPercent = (historicalCpc - currentBid) / historicalCpc * 100;
      /* v608: \u6c89\u5bc2\u8bcd\u6062\u590d\u4e5f\u4e0d\u53d7\u00b120%\u9650\u5236\uff0c\u76f4\u63a5\u6062\u590d\u5230\u76ee\u6807\u51fa\u4ef7 */
      const targetBid = historicalCpc * config2.recoveryTargetRatio;
      const proposedBid = Math.round(Math.min(targetBid, 15.0) * 100) / 100;
      if (proposedBid <= currentBid + 0.01) continue;
      const priority = totalOrders * (bidGapPercent / 100);
      candidates.push({
        entityType: "product_target",
        entityId: Number(pt.id),
        entityName: String(pt.targetValue || ""),
        accountId,
        campaignId: String(pt.campaignId || ""),
        campaignName: String(pt.campaignName || ""),
        adType: String(pt.campaignType || "sp"),
        currentBid,
        historicalCpc,
        historicalOrders: totalOrders,
        recentOrders,
        bidGapPercent,
        proposedBid,
        priority
      });
    }
    return { scanned: ptRows.length, candidates };
  } catch (error48) {
    log145.error(`[HistoricalRecovery] Product Target\u626B\u63CF\u5931\u8D25: ${error48.message}`);
    return { scanned: 0, candidates };
  }
}
async function getLastRecoveryTime(db, accountId, entityType, entityId) {
  try {
    const entityColumn = entityType === "keyword" ? "keyword_id" : "target_id";
    const result = await db.execute(sql`
      SELECT MAX(created_at) as last_recovery
      FROM optimization_events
      WHERE account_id = ${accountId}
        AND ${sql.raw(entityColumn)} = ${entityId}
        AND event_category = 'historical_recovery'
    `);
    const rows = Array.isArray(result) ? Array.isArray(result[0]) ? result[0] : result : [];
    const row = rows[0];
    if (row?.last_recovery) {
      return new Date(String(row.last_recovery));
    }
    return null;
  } catch {
    return null;
  }
}
async function executeRecovery(candidate) {
  try {
    const db = await getDb();
    if (!db) return false;
    const tableName = candidate.entityType === "keyword" ? "keywords" : "product_targets";
    await db.execute(sql`
      UPDATE ${sql.raw(tableName)}
      SET bid = ${String(candidate.proposedBid)}
      WHERE id = ${candidate.entityId} AND accountId = ${candidate.accountId}
    `);
    await db.execute(sql`
      INSERT INTO optimization_events (
        account_id, event_category, action_type, status,
        ${sql.raw(candidate.entityType === "keyword" ? "keyword_id" : "target_id")},
        previous_bid, new_bid,
        action_detail, api_sync_status, created_at
      ) VALUES (
        ${candidate.accountId}, 'historical_recovery', ${candidate.entityType + "_bid_restore"}, 'success',
        ${candidate.entityId},
        ${String(candidate.currentBid)}, ${String(candidate.proposedBid)},
        ${JSON.stringify({
      historicalCpc: candidate.historicalCpc,
      historicalOrders: candidate.historicalOrders,
      recentOrders: candidate.recentOrders,
      bidGapPercent: candidate.bidGapPercent,
      priority: candidate.priority,
      campaignName: candidate.campaignName
    })},
        'pending',
        NOW()
      )
    `);
    recordAudit({
      // @ts-ignore
      action: `${candidate.entityType}.historical_recovery`,
      accountId: candidate.accountId,
      entityType: candidate.entityType,
      // @ts-ignore
      entityId: candidate.entityId,
      // @ts-ignore
      entityName: candidate.entityName,
      // @ts-ignore
      previousValue: candidate.currentBid,
      // @ts-ignore
      newValue: candidate.proposedBid,
      reason: `[v510\u77FF\u6E23\u63D0\u70BC] \u5386\u53F2${candidate.historicalOrders}\u5355, \u8FD130\u5929${candidate.recentOrders}\u5355, \u51FA\u4EF7\u5DEE\u8DDD${candidate.bidGapPercent.toFixed(0)}% | $${candidate.currentBid.toFixed(2)}\u2192$${candidate.proposedBid.toFixed(2)} (\u76EE\u6807:\u5386\u53F2CPC\xD785%=$${(candidate.historicalCpc * 0.85).toFixed(2)})`
    });
    try {
      const { syncBidAdjustmentsToAmazon: syncBidAdjustmentsToAmazon2 } = await Promise.resolve().then(() => (init_amazonApiHelper(), amazonApiHelper_exports));
      await syncBidAdjustmentsToAmazon2(candidate.accountId, [{
        keywordId: candidate.entityType === "keyword" ? candidate.entityId : void 0,
        targetId: candidate.entityType === "product_target" ? candidate.entityId : void 0,
        newBid: candidate.proposedBid,
        reason: `[HistoricalRecovery] $${candidate.currentBid}\u2192$${candidate.proposedBid}`
      }]);
    } catch (syncErr) {
      log145.warn(`[HistoricalRecovery] API\u540C\u6B65\u5931\u8D25(${candidate.entityType}=${candidate.entityId}): ${syncErr.message}`);
    }
    log145.info(`[HistoricalRecovery] \u6062\u590D\u6210\u529F: ${candidate.entityType}="${candidate.entityName}" $${candidate.currentBid.toFixed(2)}\u2192$${candidate.proposedBid.toFixed(2)} (\u5386\u53F2${candidate.historicalOrders}\u5355, CPC=$${candidate.historicalCpc.toFixed(2)})`);
    return true;
  } catch (error48) {
    log145.error(`[HistoricalRecovery] \u6062\u590D\u6267\u884C\u5931\u8D25(${candidate.entityType}=${candidate.entityId}): ${error48.message}`);
    return false;
  }
}
var log145, RECOVERY_CONFIG;
var init_historicalDataRecoveryService = __esm({
  "server/services/historicalDataRecoveryService.ts"() {
    "use strict";
    init_db2();
    init_drizzle_orm();
    init_logger();
    init_opsLogger();
    init_auditLogService2();
    log145 = createModuleLogger("HistoricalRecovery");
    RECOVERY_CONFIG = {
      /** 历史订单门槛：超过此值的词视为"有出单能力" */
      historicalOrderThreshold: 10,
      /** 沉寂判定：最近N天零订单或极低订单 */
      dormantDays: 30,
      /** 极低订单阈值：最近dormantDays天内订单低于此值视为沉寂 */
      dormantOrderThreshold: 1,
      /** 出价压制判定：当前出价低于历史CPC的此比例 */
      bidSuppressionRatio: 0.7,
      /** 恢复目标：历史CPC的此比例 */
      recoveryTargetRatio: 0.85,
      /** 单次最大提价幅度（%） */
      maxSingleIncreasePercent: 20,
      /** 每批最多恢复的投放词数量（防止预算冲击） */
      maxRecoveryBatchSize: 20,
      /** 恢复间隔：两次恢复之间至少间隔N天 */
      recoveryIntervalDays: 7
    };
    __name(scanAndRecoverDormantTargets, "scanAndRecoverDormantTargets");
    __name(scanDormantKeywords, "scanDormantKeywords");
    __name(scanDormantProductTargets, "scanDormantProductTargets");
    __name(getLastRecoveryTime, "getLastRecoveryTime");
    __name(executeRecovery, "executeRecovery");
  }
});

