// Extracted from production dist/index.js
// Original module: server/sync/v534_upgrade_reconciliation.ts
// Lines: 217

async function runReconciliation() {
  const result = {
    totalScanned: 0,
    matched: 0,
    mismatched: 0,
    failed: 0,
    errors: []
  };
  try {
    const database = await getDb();
    const readDb2 = await getReadDb(); // P4: Use read replica for heavy SELECT
    if (!database) {
      result.errors.push("Database not available");
      return result;
    }
    const pendingKeywords = await (readDb2 || database).execute(sql`
      SELECT k.id, k.keywordId, k.bid, k.pending_bid, k.bid_sync_status, 
             k.accountId, k.campaignId, k.internal_ad_group_id, k.keywordText, k.matchType,
             k.updatedAt,
             a.profileId, a.marketplace,
             c.clientId, c.clientSecret, c.refreshToken
      FROM keywords k
      JOIN ad_accounts a ON k.accountId = a.id
      JOIN amazon_api_credentials c ON k.accountId = c.accountId
      WHERE k.bid_sync_status = 'pending_confirmation'
        AND k.updatedAt < DATE_SUB(NOW(), INTERVAL ${RECONCILIATION_CONFIG.pendingTimeoutMinutes} MINUTE)
      ORDER BY k.updatedAt ASC
      LIMIT ${RECONCILIATION_CONFIG.batchSize}
    `);
    const keywords10 = pendingKeywords[0] || [];
    result.totalScanned = keywords10.length;
    if (keywords10.length === 0) {
      log77.info("[v534] \u5BF9\u8D26: \u6CA1\u6709\u9700\u8981\u5BF9\u8D26\u7684pending_confirmation\u5173\u952E\u8BCD");
      return result;
    }
    log77.info(`[v534] \u5BF9\u8D26: \u53D1\u73B0 ${keywords10.length} \u4E2Apending_confirmation\u5173\u952E\u8BCD\u9700\u8981\u5BF9\u8D26`);
    const accountGroups = /* @__PURE__ */ new Map();
    for (const kw of keywords10) {
      const accountId = Number(kw.accountId);
      if (!accountGroups.has(accountId)) {
        accountGroups.set(accountId, []);
      }
      accountGroups.get(accountId).push(kw);
    }
    for (const [accountId, kwGroup] of accountGroups) {
      try {
        const firstKw = kwGroup[0];
        const { AmazonAdsApiClient: AmazonAdsApiClient4 } = await Promise.resolve().then(() => (init_amazonAdsApi(), amazonAdsApi_exports));
        const { MARKETPLACE_TO_REGION: MARKETPLACE_TO_REGION2 } = await Promise.resolve().then(() => (init_amazonAdsApi(), amazonAdsApi_exports));
        const region = MARKETPLACE_TO_REGION2[String(firstKw.marketplace)] || "NA";
        const client = new AmazonAdsApiClient4({
          clientId: String(firstKw.clientId),
          clientSecret: String(firstKw.clientSecret),
          refreshToken: String(firstKw.refreshToken),
          profileId: String(firstKw.profileId),
          region
        });
        const keywordIds = kwGroup.map((kw) => String(kw.keywordId));
        let amazonKeywords = [];
        try {
          amazonKeywords = await client.getKeywordsByIds(keywordIds);
        } catch (apiErr) {
          log77.warn(`[v534] \u5BF9\u8D26: \u8D26\u6237${accountId} API\u67E5\u8BE2\u5931\u8D25: ${apiErr.message}`);
          result.failed += kwGroup.length;
          result.errors.push(`\u8D26\u6237${accountId}: ${apiErr.message}`);
          continue;
        }
        const amazonBidMap = /* @__PURE__ */ new Map();
        for (const ak of amazonKeywords) {
          amazonBidMap.set(String(ak.keywordId), Number(ak.bid) || 0);
        }
        for (const kw of kwGroup) {
          const amazonBid = amazonBidMap.get(String(kw.keywordId));
          const pendingBid = Number(kw.pending_bid) || 0;
          if (amazonBid === void 0) {
            result.failed++;
            continue;
          }
          const bidDiff = Math.abs(amazonBid - pendingBid);
          if (bidDiff <= RECONCILIATION_CONFIG.bidToleranceDollar) {
            await database.execute(sql`
              UPDATE keywords 
              SET bid_sync_status = 'synced',
                  bid = ${amazonBid},
                  pending_bid = NULL,
                  updated_at = NOW()
              WHERE id = ${kw.id}
            `);
            result.matched++;
            await database.execute(sql`
              UPDATE optimization_events 
              SET api_sync_status = 'synced',
                  api_sync_detail = ${`[v534\u5BF9\u8D26] Amazon\u786E\u8BA4bid=$${amazonBid.toFixed(2)}\u4E0Epending_bid=$${pendingBid.toFixed(2)}\u4E00\u81F4`},
                  apiSyncedAt = NOW()
              WHERE keywordId = ${kw.id}
                AND apiSyncStatus = 'pending'
              ORDER BY createdAt DESC 
              LIMIT 1
            `);
          } else {
            log77.warn(`[v534] \u5BF9\u8D26\u4E0D\u4E00\u81F4: keyword=${kw.keywordId}, Amazon=$${amazonBid.toFixed(2)}, pending=$${pendingBid.toFixed(2)}, diff=$${bidDiff.toFixed(2)}`);
            await database.execute(sql`
              INSERT INTO optimization_tasks (accountId, task_type, entity_type, entity_id, payload, status, priority, created_at)
              VALUES (
                ${accountId}, 
                'bid_reconciliation', 
                'keyword', 
                ${kw.keywordId},
                ${JSON.stringify({
              keywordId: kw.keywordId,
              keywordText: kw.keywordText,
              currentAmazonBid: amazonBid,
              desiredBid: pendingBid,
              source: "v534_reconciliation"
            })},
                'pending',
                'high',
                NOW()
              )
            `);
            await database.execute(sql`
              UPDATE keywords 
              SET bid_sync_status = 'retry_pending',
                  updated_at = NOW()
              WHERE id = ${kw.id}
            `);
            result.mismatched++;
          }
        }
        log77.info(`[v534] \u5BF9\u8D26: \u8D26\u6237${accountId} \u5B8C\u6210 - matched=${result.matched}, mismatched=${result.mismatched}`);
      } catch (accountErr) {
        log77.warn(`[v534] \u5BF9\u8D26: \u8D26\u6237${accountId} \u5904\u7406\u5931\u8D25: ${accountErr.message}`);
        result.failed += kwGroup.length;
        result.errors.push(`\u8D26\u6237${accountId}: ${accountErr.message}`);
      }
    }
    log77.info(`[v534] \u5BF9\u8D26\u5B8C\u6210: scanned=${result.totalScanned}, matched=${result.matched}, mismatched=${result.mismatched}, failed=${result.failed}`);
  } catch (e) {
    log77.warn(`[v534] \u5BF9\u8D26\u670D\u52A1\u5F02\u5E38: ${e.message}`);
    result.errors.push(e.message);
  }
  return result;
}
async function backfillMissingValues() {
  try {
    const database = await getDb();
    if (!database) return 0;
    const result = await database.execute(sql`
      UPDATE optimization_events 
      SET previousValue = CONCAT('$', previousBid),
          newValue = CONCAT('$', newBid)
      WHERE (previousValue IS NULL OR newValue IS NULL)
        AND previousBid IS NOT NULL 
        AND newBid IS NOT NULL
        AND eventCategory = 'bid_adjustment'
        AND createdAt > DATE_SUB(NOW(), INTERVAL 7 DAY)
    `);
    const affected = result[0]?.affectedRows || 0;
    if (affected > 0) {
      log77.info(`[v534] \u5386\u53F2\u6570\u636E\u56DE\u586B: \u5DF2\u4FEE\u590D ${affected} \u6761optimization_events\u7684previousValue/newValue`);
    }
    return affected;
  } catch (e) {
    log77.warn(`[v534] \u5386\u53F2\u6570\u636E\u56DE\u586B\u5931\u8D25: ${e.message}`);
    return 0;
  }
}
function startReconciliationScheduler() {
  // P5: Skip in web process if worker is handling it
  const _p5WorkerActive = process.env.P5_WORKER_ENABLED === "true" && !process.env.P5_IS_WORKER;
  if (_p5WorkerActive) {
    log77.info("[P5] Reconciliation delegated to worker process, skipping in web process");
    return;
  }
  if (reconciliationTimer) {
    clearInterval(reconciliationTimer);
  }
  setTimeout(async () => {
    log77.info("[v534] \u5BF9\u8D26\u670D\u52A1\u542F\u52A8\uFF0C\u9996\u6B21\u5BF9\u8D26\u5F00\u59CB...");
    await runReconciliation();
    reconciliationTimer = setInterval(async () => {
      try {
        await runReconciliation();
      } catch (e) {
        log77.warn(`[v534] \u5B9A\u65F6\u5BF9\u8D26\u5931\u8D25: ${e.message}`);
      }
    }, RECONCILIATION_CONFIG.intervalMinutes * 60 * 1e3);
  }, 5 * 60 * 1e3);
  log77.info(`[v534] \u5BF9\u8D26\u8C03\u5EA6\u5668\u5DF2\u6CE8\u518C\uFF0C\u95F4\u9694=${RECONCILIATION_CONFIG.intervalMinutes}\u5206\u949F`);
}
var log77, RECONCILIATION_CONFIG, reconciliationTimer;
var init_v534_upgrade_reconciliation = __esm({
  "server/sync/v534_upgrade_reconciliation.ts"() {
    "use strict";
    init_db2();
    init_drizzle_orm();
    init_logger();
    log77 = createModuleLogger("v534:Reconciliation");
    RECONCILIATION_CONFIG = {
      // pending_confirmation超过此时间（分钟）后触发主动对账
      pendingTimeoutMinutes: 15,
      // 每次对账的最大批量大小
      batchSize: 50,
      // 对账间隔（分钟）
      intervalMinutes: 10,
      // 最大重试次数
      maxRetries: 3,
      // 对账结果：bid一致的容差（$0.01）
      bidToleranceDollar: 0.01
    };
    __name(runReconciliation, "runReconciliation");
    __name(backfillMissingValues, "backfillMissingValues");
    reconciliationTimer = null;
    __name(startReconciliationScheduler, "startReconciliationScheduler");
  }
});

