/**
 * server/services/dataAnomalyDetector.ts
 * 
 * Auto-converted from production bundle to TypeScript source.
 * Version: v621147 (production)
 */

import { campaigns, keywords } from '../../drizzle/schema';
import { getDb } from '../db';
import { sql } from 'drizzle-orm';

export async function runAnomalyDetection() {
  const startTime = Date.now();
  const alerts = [];
  const db = await getDb();
  if (!db) {
    return { totalAnomalies: 0, criticalCount: 0, highCount: 0, mediumCount: 0, lowCount: 0, alerts: [], durationMs: 0 };
  }
  const { sql: sql15 } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
  try {
    try {
      const [negKwRatioRows] = await db.execute(sql15`
        SELECT 
          a.id AS accountId,
          a.accountName,
          COALESCE(kw.kw_count, 0) AS keyword_count,
          COALESCE(nk.nk_count, 0) AS neg_kw_count,
          CASE WHEN COALESCE(kw.kw_count, 0) > 0 
            THEN COALESCE(nk.nk_count, 0) / kw.kw_count 
            ELSE COALESCE(nk.nk_count, 0) 
          END AS ratio
        FROM ad_accounts a
        LEFT JOIN (
          SELECT accountId, COUNT(*) AS kw_count 
          FROM keywords 
          WHERE keywordStatus != 'amazon_deleted'
          GROUP BY accountId
        ) kw ON kw.accountId = a.id
        LEFT JOIN (
          SELECT accountId, COUNT(*) AS nk_count 
          FROM negative_keywords 
          GROUP BY accountId
        ) nk ON nk.accountId = a.id
        WHERE COALESCE(nk.nk_count, 0) > 100
        HAVING ratio > 10 OR (COALESCE(kw.kw_count, 0) < 50 AND COALESCE(nk.nk_count, 0) > 500)
        ORDER BY neg_kw_count DESC
        LIMIT 50
      `);
      for (const row of negKwRatioRows) {
        const severity = row.neg_kw_count > 1e5 ? "critical" : row.neg_kw_count > 1e4 ? "high" : "medium";
        alerts.push({
          accountId: row.accountId,
          accountName: row.accountName,
          anomalyType: "negative_keyword_ratio_anomaly",
          severity,
          description: `\u8D26\u6237${row.accountId}(${row.accountName})\u5426\u5B9A\u8BCD/\u5173\u952E\u8BCD\u6BD4\u4F8B\u5F02\u5E38: ${row.keyword_count}\u4E2A\u5173\u952E\u8BCD vs ${row.neg_kw_count}\u4E2A\u5426\u5B9A\u8BCD (\u6BD4\u4F8B${Number(row.ratio).toFixed(1)}:1)`,
          details: {
            keywordCount: Number(row.keyword_count),
            negativeKeywordCount: Number(row.neg_kw_count),
            ratio: Number(row.ratio)
          },
          suggestedAction: severity === "critical" ? "\u7ACB\u5373\u5BA1\u67E5\u5426\u5B9A\u8BCD\u7B56\u7565\uFF0C\u53EF\u80FD\u5B58\u5728\u6279\u91CF\u8BEF\u64CD\u4F5C\u5BFC\u81F4\u6B63\u5E38\u6D41\u91CF\u88AB\u5927\u9762\u79EF\u5C4F\u853D" : "\u5EFA\u8BAE\u5BA1\u67E5\u5426\u5B9A\u8BCD\u5217\u8868\uFF0C\u6E05\u7406\u65E0\u6548\u6216\u8FC7\u671F\u7684\u5426\u5B9A\u8BCD",
          detectedAt: (/* @__PURE__ */ new Date()).toISOString()
        });
      }
    } catch (e) {
      log66.warn(`[AnomalyDetector] \u5426\u5B9A\u8BCD\u6BD4\u4F8B\u68C0\u6D4B\u5931\u8D25: ${e.message}`);
    }
    try {
      const [massiveNegRows] = await db.execute(sql15`
        SELECT accountId, COUNT(*) AS nk_count
        FROM negative_keywords
        GROUP BY accountId
        HAVING nk_count > 50000
        ORDER BY nk_count DESC
      `);
      for (const row of massiveNegRows) {
        alerts.push({
          accountId: row.accountId,
          anomalyType: "massive_negative_keywords_oom_risk",
          severity: row.nk_count > 5e5 ? "critical" : "high",
          description: `\u8D26\u6237${row.accountId}\u62E5\u6709${row.nk_count}\u4E2A\u5426\u5B9A\u8BCD\uFF0C\u540C\u6B65\u65F6\u5B58\u5728\u5185\u5B58\u6EA2\u51FA(OOM)\u98CE\u9669`,
          details: { negativeKeywordCount: Number(row.nk_count) },
          suggestedAction: "\u5DF2\u542F\u7528\u6D41\u5F0F\u5206\u9875\u5904\u7406(v614i-fix23)\uFF0C\u4F46\u4ECD\u5EFA\u8BAE\u6E05\u7406\u65E0\u6548\u5426\u5B9A\u8BCD\u4EE5\u4F18\u5316\u6027\u80FD",
          detectedAt: (/* @__PURE__ */ new Date()).toISOString()
        });
      }
    } catch (e) {
      log66.warn(`[AnomalyDetector] \u6D77\u91CF\u5426\u5B9A\u8BCD\u68C0\u6D4B\u5931\u8D25: ${e.message}`);
    }
    try {
      const [abnormalBidRows] = await db.execute(sql15`
        SELECT k.id, k.accountId, k.keywordText, k.bid, k.matchType, k.campaignId,
               k.keywordStatus, k.bid_sync_status
        FROM keywords k
        WHERE k.keywordStatus = 'enabled'
          AND (
            CAST(k.bid AS DECIMAL(10,2)) > 50.00
            OR CAST(k.bid AS DECIMAL(10,2)) < 0.02
            OR (k.pending_bid IS NOT NULL AND CAST(k.pending_bid AS DECIMAL(10,2)) > 50.00)
          )
        LIMIT 100
      `);
      if (abnormalBidRows.length > 0) {
        const groupedByAccount = /* @__PURE__ */ new Map();
        for (const row of abnormalBidRows) {
          if (!groupedByAccount.has(row.accountId)) groupedByAccount.set(row.accountId, []);
          groupedByAccount.get(row.accountId).push(row);
        }
        for (const [accountId, rows] of groupedByAccount) {
          const highBids = rows.filter((r) => Number(r.bid) > 50);
          const lowBids = rows.filter((r) => Number(r.bid) < 0.02);
          alerts.push({
            accountId,
            anomalyType: "abnormal_bid_values",
            severity: highBids.length > 0 ? "high" : "medium",
            description: `\u8D26\u6237${accountId}\u5B58\u5728${rows.length}\u4E2A\u5F02\u5E38\u51FA\u4EF7\u5173\u952E\u8BCD: ${highBids.length}\u4E2A\u8D85\u9AD8\u51FA\u4EF7(>$50), ${lowBids.length}\u4E2A\u8D85\u4F4E\u51FA\u4EF7(<$0.02)`,
            details: {
              totalAbnormal: rows.length,
              highBidCount: highBids.length,
              lowBidCount: lowBids.length,
              examples: rows.slice(0, 5).map((r) => ({
                keyword: r.keywordText,
                bid: r.bid,
                matchType: r.matchType
              }))
            },
            suggestedAction: "\u68C0\u67E5\u51FA\u4EF7\u4F18\u5316\u7B97\u6CD5\u662F\u5426\u4EA7\u751F\u4E86\u4E0D\u5408\u7406\u7684\u51FA\u4EF7\u503C\uFF0C\u5EFA\u8BAE\u8BBE\u7F6E\u5168\u5C40\u51FA\u4EF7\u4E0A\u4E0B\u9650\u62A4\u680F",
            detectedAt: (/* @__PURE__ */ new Date()).toISOString()
          });
        }
      }
    } catch (e) {
      log66.warn(`[AnomalyDetector] \u51FA\u4EF7\u5F02\u5E38\u68C0\u6D4B\u5931\u8D25: ${e.message}`);
    }
    try {
      const [spendAnomalyRows] = await db.execute(sql15`
        SELECT 
          dp1.accountId,
          dp1.date AS today_date,
          SUM(CAST(dp1.spend AS DECIMAL(10,2))) AS today_spend,
          dp2.prev_spend,
          CASE WHEN dp2.prev_spend > 0 
            THEN ((SUM(CAST(dp1.spend AS DECIMAL(10,2))) - dp2.prev_spend) / dp2.prev_spend * 100)
            ELSE NULL
          END AS change_pct
        FROM daily_performance dp1
        LEFT JOIN (
          SELECT accountId, SUM(CAST(spend AS DECIMAL(10,2))) AS prev_spend
          FROM daily_performance
          WHERE date = DATE_SUB(CURDATE(), INTERVAL 2 DAY)
          GROUP BY accountId
        ) dp2 ON dp2.accountId = dp1.accountId
        WHERE dp1.date = DATE_SUB(CURDATE(), INTERVAL 1 DAY)
          AND dp2.prev_spend > 5
        GROUP BY dp1.accountId, dp1.date, dp2.prev_spend
        HAVING ABS(change_pct) > 300
        ORDER BY ABS(change_pct) DESC
        LIMIT 20
      `);
      for (const row of spendAnomalyRows) {
        const changePct = Number(row.change_pct);
        const isSpike = changePct > 0;
        alerts.push({
          accountId: row.accountId,
          anomalyType: isSpike ? "spend_spike" : "spend_drop",
          severity: Math.abs(changePct) > 500 ? "critical" : "high",
          description: `\u8D26\u6237${row.accountId}\u82B1\u8D39${isSpike ? "\u98D9\u5347" : "\u9AA4\u964D"}: \u6628\u65E5$${Number(row.today_spend).toFixed(2)} vs \u524D\u65E5$${Number(row.prev_spend).toFixed(2)} (${changePct > 0 ? "+" : ""}${changePct.toFixed(0)}%)`,
          details: {
            todaySpend: Number(row.today_spend),
            prevSpend: Number(row.prev_spend),
            changePct,
            date: row.today_date
          },
          suggestedAction: isSpike ? "\u7D27\u6025\u68C0\u67E5\u662F\u5426\u6709\u9884\u7B97\u89C4\u5219\u6216\u51FA\u4EF7\u8C03\u6574\u5BFC\u81F4\u82B1\u8D39\u5F02\u5E38\u589E\u52A0\uFF0C\u53EF\u80FD\u9700\u8981\u6682\u505C\u76F8\u5173\u5E7F\u544A\u6D3B\u52A8" : "\u68C0\u67E5\u662F\u5426\u6709\u5E7F\u544A\u6D3B\u52A8\u88AB\u610F\u5916\u6682\u505C\u6216\u9884\u7B97\u8017\u5C3D\uFF0C\u53EF\u80FD\u5F71\u54CD\u9500\u552E",
          detectedAt: (/* @__PURE__ */ new Date()).toISOString()
        });
      }
    } catch (e) {
      log66.warn(`[AnomalyDetector] \u82B1\u8D39\u5F02\u5E38\u68C0\u6D4B\u5931\u8D25: ${e.message}`);
    }
    try {
      const [zombieRows] = await db.execute(sql15`
        SELECT 
          c.accountId,
          COUNT(*) AS zombie_count,
          SUM(CAST(c.dailyBudget AS DECIMAL(10,2))) AS wasted_budget
        FROM campaigns c
        LEFT JOIN (
          SELECT campaignId, SUM(impressions) AS total_impressions
          FROM daily_performance
          WHERE date >= DATE_SUB(CURDATE(), INTERVAL 14 DAY)
          GROUP BY campaignId
        ) dp ON dp.campaignId = c.campaignId
        WHERE c.campaignStatus = 'enabled'
          AND CAST(c.dailyBudget AS DECIMAL(10,2)) > 0
          AND COALESCE(dp.total_impressions, 0) = 0
        GROUP BY c.accountId
        HAVING zombie_count >= 5
        ORDER BY wasted_budget DESC
        LIMIT 20
      `);
      for (const row of zombieRows) {
        alerts.push({
          accountId: row.accountId,
          anomalyType: "zombie_campaigns",
          severity: Number(row.wasted_budget) > 100 ? "high" : "medium",
          description: `\u8D26\u6237${row.accountId}\u6709${row.zombie_count}\u4E2A"\u50F5\u5C38"\u5E7F\u544A\u6D3B\u52A8: \u72B6\u6001\u4E3Aenabled\u4F4614\u5929\u5185\u96F6\u5C55\u793A\uFF0C\u65E5\u5747\u9884\u7B97\u6D6A\u8D39$${Number(row.wasted_budget).toFixed(2)}`,
          details: {
            zombieCampaignCount: Number(row.zombie_count),
            wastedDailyBudget: Number(row.wasted_budget)
          },
          suggestedAction: "\u5EFA\u8BAE\u6682\u505C\u8FD9\u4E9B\u65E0\u6548\u5E7F\u544A\u6D3B\u52A8\uFF0C\u6216\u68C0\u67E5\u6295\u653E\u8BCD\u548C\u5426\u5B9A\u8BCD\u8BBE\u7F6E\u662F\u5426\u5BFC\u81F4\u65E0\u6CD5\u83B7\u5F97\u5C55\u793A",
          detectedAt: (/* @__PURE__ */ new Date()).toISOString()
        });
      }
    } catch (e) {
      log66.warn(`[AnomalyDetector] \u50F5\u5C38\u5E7F\u544A\u68C0\u6D4B\u5931\u8D25: ${e.message}`);
    }
    try {
      const [syncGapRows] = await db.execute(sql15`
        SELECT 
          a.id AS accountId,
          a.accountName,
          a.lastSyncAt,
          TIMESTAMPDIFF(HOUR, a.lastSyncAt, NOW()) AS hours_since_sync
        FROM ad_accounts a
        WHERE a.lastSyncAt IS NOT NULL
          AND TIMESTAMPDIFF(HOUR, a.lastSyncAt, NOW()) > 48
          AND a.isActive = 1
        ORDER BY hours_since_sync DESC
        LIMIT 20
      `);
      for (const row of syncGapRows) {
        alerts.push({
          accountId: row.accountId,
          accountName: row.accountName,
          anomalyType: "sync_stale_data",
          severity: Number(row.hours_since_sync) > 168 ? "critical" : "high",
          description: `\u8D26\u6237${row.accountId}(${row.accountName})\u6570\u636E\u5DF2${Number(row.hours_since_sync)}\u5C0F\u65F6\u672A\u540C\u6B65\uFF0C\u6570\u636E\u53EF\u80FD\u4E25\u91CD\u8FC7\u65F6`,
          details: {
            lastSyncAt: row.lastSyncAt,
            hoursSinceSync: Number(row.hours_since_sync)
          },
          suggestedAction: "\u68C0\u67E5\u8BE5\u8D26\u6237\u7684Amazon API\u6388\u6743\u662F\u5426\u8FC7\u671F\uFF0C\u6216\u540C\u6B65\u4EFB\u52A1\u662F\u5426\u6301\u7EED\u5931\u8D25",
          detectedAt: (/* @__PURE__ */ new Date()).toISOString()
        });
      }
    } catch (e) {
      log66.warn(`[AnomalyDetector] \u540C\u6B65\u6570\u636E\u68C0\u6D4B\u5931\u8D25: ${e.message}`);
    }
    try {
      const [pendingRows] = await db.execute(sql15`
        SELECT 
          accountId,
          bid_sync_status,
          COUNT(*) AS cnt
        FROM keywords
        WHERE bid_sync_status IN ('pending', 'pending_confirmation', 'failed')
        GROUP BY accountId, bid_sync_status
        HAVING cnt > 50
        ORDER BY cnt DESC
        LIMIT 30
      `);
      const accountPending = /* @__PURE__ */ new Map();
      for (const row of pendingRows) {
        if (!accountPending.has(row.accountId)) {
          accountPending.set(row.accountId, { pending: 0, failed: 0, pendingConfirm: 0 });
        }
        const entry = accountPending.get(row.accountId);
        if (row.bid_sync_status === "pending") entry.pending = Number(row.cnt);
        else if (row.bid_sync_status === "failed") entry.failed = Number(row.cnt);
        else if (row.bid_sync_status === "pending_confirmation") entry.pendingConfirm = Number(row.cnt);
      }
      for (const [accountId, counts] of accountPending) {
        const total = counts.pending + counts.failed + counts.pendingConfirm;
        alerts.push({
          accountId,
          anomalyType: "optimization_instruction_backlog",
          severity: counts.failed > 100 ? "critical" : total > 200 ? "high" : "medium",
          description: `\u8D26\u6237${accountId}\u4F18\u5316\u6307\u4EE4\u79EF\u538B: ${counts.pending}\u4E2A\u5F85\u6267\u884C, ${counts.pendingConfirm}\u4E2A\u5F85\u786E\u8BA4, ${counts.failed}\u4E2A\u5931\u8D25`,
          details: counts,
          suggestedAction: counts.failed > 0 ? "\u68C0\u67E5Amazon API\u8FDE\u63A5\u72B6\u6001\u548C\u51FA\u4EF7\u5408\u6CD5\u6027\uFF0C\u5927\u91CFfailed\u6307\u4EE4\u53EF\u80FD\u8868\u793AAPI\u6743\u9650\u6216\u53C2\u6570\u95EE\u9898" : "\u68C0\u67E5\u4F18\u5316\u540C\u6B65\u5F15\u64CE\u662F\u5426\u6B63\u5E38\u8FD0\u884C\uFF0C\u6307\u4EE4\u79EF\u538B\u53EF\u80FD\u5BFC\u81F4\u4F18\u5316\u5EF6\u8FDF",
          detectedAt: (/* @__PURE__ */ new Date()).toISOString()
        });
      }
    } catch (e) {
      log66.warn(`[AnomalyDetector] \u6307\u4EE4\u79EF\u538B\u68C0\u6D4B\u5931\u8D25: ${e.message}`);
    }
    const criticalCount = alerts.filter((a) => a.severity === "critical").length;
    const highCount = alerts.filter((a) => a.severity === "high").length;
    const mediumCount = alerts.filter((a) => a.severity === "medium").length;
    const lowCount = alerts.filter((a) => a.severity === "low").length;
    for (const alert of alerts.filter((a) => a.severity === "critical" || a.severity === "high")) {
      try {
        await db.execute(sql15`
          INSERT INTO anomaly_alert_logs (account_id, rule_id, user_id, trigger_value, threshold_value, trigger_description, action_taken, created_at)
          VALUES (${alert.accountId}, ${alert.anomalyType}, 0, ${alert.severity}, 'auto_detect', ${alert.description}, ${alert.suggestedAction}, NOW())
        `);
      } catch (_e) {
      }
    }
    const durationMs = Date.now() - startTime;
    log66.info(`[AnomalyDetector] v614i-fix23: \u5F02\u5E38\u68C0\u6D4B\u5B8C\u6210, \u53D1\u73B0${alerts.length}\u4E2A\u5F02\u5E38 (critical:${criticalCount} high:${highCount} medium:${mediumCount} low:${lowCount}), \u8017\u65F6${durationMs}ms`);
    return {
      totalAnomalies: alerts.length,
      criticalCount,
      highCount,
      mediumCount,
      lowCount,
      alerts,
      durationMs
    };
  } catch (err) {
    log66.warn(`[AnomalyDetector] \u5F02\u5E38\u68C0\u6D4B\u5931\u8D25: ${err.message}`);
    return { totalAnomalies: 0, criticalCount: 0, highCount: 0, mediumCount: 0, lowCount: 0, alerts: [], durationMs: Date.now() - startTime };
  }
}
var log66;



// ============================================================
// v620-fix4: Raw SQL Query Helper
// Uses getDirectConnection() to execute raw SQL with parameter binding
// ============================================================
async function v620RawQuery(sqlStr, params = []) {
  const { getDirectConnection: getDC } = await Promise.resolve().then(() => (init_connection(), connection_exports));
  const conn = await getDC(15000);
  try {
    const [rows] = await conn.execute(sqlStr, params);
    return rows || [];
  } finally {
    if (conn && conn.release) conn.release();
    else if (conn && conn.releaseFunc) conn.releaseFunc();
  }
}


// ============================================================
// P1-1: Operation Review Gateway - Human-in-the-loop review mechanism
// ============================================================

class OperationReviewGateway {
  static RISK_LEVELS = {
    LOW: { label: "low", autoApprove: true, maxBidChangePercent: 0.10 },
    MEDIUM: { label: "medium", autoApprove: true, maxBidChangePercent: 0.20 },
    HIGH: { label: "high", autoApprove: false, maxBidChangePercent: 0.30 },
    CRITICAL: { label: "critical", autoApprove: false, maxBidChangePercent: 1.0 }
  };

  static classifyRisk(operation) {
    const { type, params } = operation;
    if (type === "pause_campaign") {
      if (params.hasOrders && params.orders > 0) return this.RISK_LEVELS.CRITICAL;
      if (params.spend > 50) return this.RISK_LEVELS.HIGH;
      return this.RISK_LEVELS.MEDIUM;
    }
    if (type === "bid_decrease") {
      const decreasePercent = Math.abs(params.changePercent || 0);
      if (decreasePercent > 0.30) return this.RISK_LEVELS.CRITICAL;
      if (decreasePercent > 0.20) return this.RISK_LEVELS.HIGH;
      if (decreasePercent > 0.10) return this.RISK_LEVELS.MEDIUM;
      return this.RISK_LEVELS.LOW;
    }
    if (type === "budget_decrease") {
      const decreasePercent = Math.abs(params.changePercent || 0);
      if (decreasePercent > 0.30) return this.RISK_LEVELS.HIGH;
      return this.RISK_LEVELS.MEDIUM;
    }
    return this.RISK_LEVELS.LOW;
  }

  static async submitForReview(db2, operation) {
    const risk = this.classifyRisk(operation);
    const record = {
      accountId: operation.accountId,
      operationType: operation.type,
      targetId: operation.targetId,
      targetName: operation.targetName || "",
      currentValue: String(operation.currentValue),
      proposedValue: String(operation.proposedValue),
      riskLevel: risk.label,
      reason: operation.reason || "",
      impactEstimate: JSON.stringify(operation.impactEstimate || {}),
      status: risk.autoApprove ? "auto_approved" : "pending_review",
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 72 * 3600 * 1000)
    };

    try {
      const sql = `INSERT INTO operation_reviews 
        (accountId, operationType, targetId, targetName, currentValue, proposedValue, 
         riskLevel, reason, impactEstimate, status, createdAt, expiresAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), DATE_ADD(NOW(), INTERVAL 72 HOUR))`;
      await v620RawQuery(sql, [
        record.accountId, record.operationType, record.targetId, record.targetName,
        record.currentValue, record.proposedValue, record.riskLevel, record.reason,
        record.impactEstimate, record.status
      ]);
    } catch (e) {
      console.error("[ReviewGateway] Failed to insert review record:", e.message);
    }

    if (risk.autoApprove) {
      return { approved: true, riskLevel: risk.label, reviewId: null };
    }
    return { approved: false, riskLevel: risk.label, reviewId: record.targetId };
  }

  static async executeApproved(db2, reviewId, amazonApiHelper) {
    try {
      const rows = await v620RawQuery(
        `SELECT * FROM operation_reviews WHERE id = ? AND status = 'pending_review'`, [reviewId]
      );
      if (!rows || rows.length === 0) return { success: false, error: "Review not found or already processed" };
      
      const review = rows[0];
      let apiResult = { success: false };
      
      if (review.operationType === "pause_campaign") {
        apiResult = await amazonApiHelper.syncCampaignStatusToAmazon(review.accountId, review.targetId, "paused");
        if (apiResult.success) {
          await v620RawQuery(`UPDATE campaigns SET status = 'paused' WHERE id = ?`, [review.targetId]);
        }
      } else if (review.operationType === "bid_decrease") {
        apiResult = await amazonApiHelper.syncBidAdjustmentsToAmazon(review.accountId, [{
          keywordId: review.targetId, newBid: parseFloat(review.proposedValue)
        }]);
        if (apiResult.success) {
          await v620RawQuery(`UPDATE keywords SET bid = ? WHERE id = ?`, [review.proposedValue, review.targetId]);
        }
      } else if (review.operationType === "budget_decrease") {
        apiResult = await amazonApiHelper.syncCampaignBudgetToAmazon(review.accountId, review.targetId, parseFloat(review.proposedValue));
        if (apiResult.success) {
          await v620RawQuery(`UPDATE campaigns SET dailyBudget = ? WHERE id = ?`, [review.proposedValue, review.targetId]);
        }
      }
      
      await v620RawQuery(
        `UPDATE operation_reviews SET status = 'approved', approvedAt = NOW() WHERE id = ?`, [reviewId]
      );
      return { success: true, apiResult };
    } catch (e) {
      console.error("[ReviewGateway] executeApproved error:", e.message);
      return { success: false, error: e.message };
    }
  }

  static async expireStaleReviews(db2) {
    try {
      const result = await v620RawQuery(
        `UPDATE operation_reviews SET status = 'expired' WHERE status = 'pending_review' AND expiresAt < NOW()`
      );
      return { expired: result.affectedRows || 0 };
    } catch (e) {
      return { expired: 0, error: e.message };
    }
  }

  static async getPendingReviews(db2, accountId) {
    try {
      const rows = await v620RawQuery(
        `SELECT * FROM operation_reviews WHERE accountId = ? AND status = 'pending_review' ORDER BY createdAt DESC`,
        [accountId]
      );
      return rows || [];
    } catch (e) {
      return [];
    }
  }

  static async getReviewStats(db2, accountId) {
    try {
      const rows = await v620RawQuery(
        `SELECT status, COUNT(*) as cnt FROM operation_reviews WHERE accountId = ? GROUP BY status`,
        [accountId]
      );
      const stats = { pending: 0, approved: 0, rejected: 0, expired: 0, auto_approved: 0 };
      for (const row of (rows || [])) {
        stats[row.status] = parseInt(row.cnt);
      }
      return stats;
    } catch (e) {
      return { pending: 0, approved: 0, rejected: 0, expired: 0, auto_approved: 0 };
    }
  }
}


var reviewGatewayRouter;



// ============================================================
// P1-2: Impact Predictor - Estimate operation impact before execution
// ============================================================

class ImpactPredictor {
  static async predictBidChange(db2, keywordId, currentBid, proposedBid) {
    try {
      const history = await v620RawQuery(
        `SELECT AVG(clicks) as avgClicks, AVG(spend) as avgSpend, AVG(orders) as avgOrders,
                AVG(sales) as avgSales, AVG(impressions) as avgImpressions
         FROM bid_performance_history 
         WHERE bidObjectId = ? AND orders > 0 
         AND date >= DATE_SUB(NOW(), INTERVAL 60 DAY)`,
        [keywordId]
      );
      
      if (!history || history.length === 0 || !history[0].avgClicks) {
        return { confidence: "low", estimatedImpact: "insufficient_data" };
      }
      
      const h = history[0];
      const bidRatio = proposedBid / currentBid;
      const impressionMultiplier = Math.pow(bidRatio, 1.5);
      const estimatedImpressions = Math.round(h.avgImpressions * impressionMultiplier);
      const ctr = h.avgClicks / Math.max(h.avgImpressions, 1);
      const estimatedClicks = Math.round(estimatedImpressions * ctr);
      const convRate = h.avgOrders / Math.max(h.avgClicks, 1);
      const estimatedOrders = Math.round(estimatedClicks * convRate * 100) / 100;
      const avgOrderValue = h.avgSales / Math.max(h.avgOrders, 1);
      const estimatedSales = Math.round(estimatedOrders * avgOrderValue * 100) / 100;
      const estimatedSpend = Math.round(estimatedClicks * proposedBid * 100) / 100;
      const estimatedAcos = estimatedSales > 0 ? Math.round(estimatedSpend / estimatedSales * 10000) / 100 : 999;
      
      return {
        confidence: h.avgClicks > 10 ? "high" : "medium",
        current: {
          avgImpressions: Math.round(h.avgImpressions),
          avgClicks: Math.round(h.avgClicks),
          avgSpend: Math.round(h.avgSpend * 100) / 100,
          avgOrders: Math.round(h.avgOrders * 100) / 100,
          avgSales: Math.round(h.avgSales * 100) / 100
        },
        predicted: {
          impressions: estimatedImpressions,
          clicks: estimatedClicks,
          spend: estimatedSpend,
          orders: estimatedOrders,
          sales: estimatedSales,
          acos: estimatedAcos
        },
        change: {
          impressionChange: Math.round((impressionMultiplier - 1) * 100) + "%",
          spendChange: Math.round((estimatedSpend / Math.max(h.avgSpend, 0.01) - 1) * 100) + "%",
          revenueChange: Math.round((estimatedSales / Math.max(h.avgSales, 0.01) - 1) * 100) + "%"
        }
      };
    } catch (e) {
      return { confidence: "error", error: e.message };
    }
  }

  static async predictCampaignPause(db2, campaignId) {
    try {
      const perf = await v620RawQuery(
        `SELECT SUM(spend) as totalSpend, SUM(sales) as totalSales, SUM(orders) as totalOrders,
                SUM(clicks) as totalClicks, SUM(impressions) as totalImpressions,
                COUNT(DISTINCT date) as activeDays
         FROM daily_performance 
         WHERE campaignId = ? AND date >= DATE_SUB(NOW(), INTERVAL 30 DAY)`,
        [campaignId]
      );
      
      if (!perf || perf.length === 0) {
        return { confidence: "low", estimatedImpact: "no_recent_data" };
      }
      
      const p = perf[0];
      const dailySpend = p.totalSpend / Math.max(p.activeDays, 1);
      const dailySales = p.totalSales / Math.max(p.activeDays, 1);
      const dailyOrders = p.totalOrders / Math.max(p.activeDays, 1);
      
      return {
        confidence: p.activeDays > 14 ? "high" : "medium",
        lostPerDay: {
          spend: Math.round(dailySpend * 100) / 100,
          sales: Math.round(dailySales * 100) / 100,
          orders: Math.round(dailyOrders * 100) / 100
        },
        lostPer30Days: {
          spend: Math.round(dailySpend * 30 * 100) / 100,
          sales: Math.round(dailySales * 30 * 100) / 100,
          orders: Math.round(dailyOrders * 30 * 100) / 100
        },
        currentAcos: p.totalSales > 0 ? Math.round(p.totalSpend / p.totalSales * 10000) / 100 : 999,
        recommendation: dailyOrders > 0.5 ? "DO_NOT_PAUSE" : (p.totalOrders > 0 ? "REVIEW_REQUIRED" : "SAFE_TO_PAUSE")
      };
    } catch (e) {
      return { confidence: "error", error: e.message };
    }
  }
}


var impactPredictorRouter;



// ============================================================
// P2-1: Core Keyword Manager - Rank-aware optimization with keyword protection
// ============================================================

class CoreKeywordManager {
  static async identifyCoreKeywords(db2, accountId, options = {}) {
    const lookbackDays = options.lookbackDays || 90;
    const minOrders = options.minOrders || 3;
    const maxAcos = options.maxAcos || 50;
    
    try {
      const rows = await v620RawQuery(
        `SELECT k.id, k.keywordText, k.bid, k.campaignId, k.internal_ad_group_id,
                SUM(bph.orders) as totalOrders, SUM(bph.sales) as totalSales,
                SUM(bph.spend) as totalSpend, SUM(bph.clicks) as totalClicks,
                SUM(bph.impressions) as totalImpressions,
                CASE WHEN SUM(bph.sales) > 0 THEN SUM(bph.spend)/SUM(bph.sales)*100 ELSE 999 END as acos,
                CASE WHEN SUM(bph.clicks) > 0 THEN SUM(bph.spend)/SUM(bph.clicks) ELSE 0 END as avgCpc,
                COUNT(DISTINCT DATE(bph.date)) as activeDays
         FROM keywords k
         JOIN campaigns c ON k.campaignId = c.campaignId AND c.accountId = k.accountId
         LEFT JOIN bid_performance_history bph ON bph.bidObjectId = k.keywordId AND bph.bidObjectType = 'keyword' 
           AND bph.date >= DATE_SUB(NOW(), INTERVAL ? DAY)
         WHERE k.accountId = ? AND k.keywordStatus = 'enabled'
         GROUP BY k.id
         HAVING totalOrders >= ? AND acos <= ?
         ORDER BY totalOrders DESC, totalSales DESC`,
        [lookbackDays, accountId, minOrders, maxAcos]
      );
      
      const coreKeywords = (rows || []).map(row => ({
        ...row,
        tier: row.totalOrders >= 20 ? "S" : row.totalOrders >= 10 ? "A" : row.totalOrders >= 5 ? "B" : "C",
        protectionLevel: row.totalOrders >= 10 ? "high" : row.totalOrders >= 5 ? "medium" : "standard",
        minBidFloor: Math.max(row.avgCpc * 0.7, 0.15),
        maxBidCeiling: row.avgCpc * 2.0
      }));
      
      return { total: coreKeywords.length, keywords: coreKeywords };
    } catch (e) {
      console.error("[CoreKeywordManager] identifyCoreKeywords error:", e.message);
      return { total: 0, keywords: [], error: e.message };
    }
  }

  static async syncCoreKeywordsToDb(db2, accountId) {
    const result = await this.identifyCoreKeywords(db2, accountId);
    if (result.total === 0) return { synced: 0 };
    
    let synced = 0;
    for (const kw of result.keywords) {
      try {
        await v620RawQuery(
          `INSERT INTO core_keywords (accountId, keywordId, keywordText, tier, protectionLevel, 
           minBidFloor, maxBidCeiling, totalOrders, totalSales, acos, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
           ON DUPLICATE KEY UPDATE tier = VALUES(tier), protectionLevel = VALUES(protectionLevel),
           minBidFloor = VALUES(minBidFloor), maxBidCeiling = VALUES(maxBidCeiling),
           totalOrders = VALUES(totalOrders), totalSales = VALUES(totalSales), 
           acos = VALUES(acos), updatedAt = NOW()`,
          [accountId, kw.id, kw.keywordText, kw.tier, kw.protectionLevel,
           kw.minBidFloor, kw.maxBidCeiling, kw.totalOrders, kw.totalSales, kw.acos]
        );
        synced++;
      } catch (e) { /* skip individual errors */ }
    }
    return { synced, total: result.total };
  }

  static async checkBidAgainstProtection(db2, keywordId, proposedBid) {
    try {
      const rows = await v620RawQuery(
        `SELECT * FROM core_keywords WHERE keywordId = ?`, [keywordId]
      );
      if (!rows || rows.length === 0) return { isCore: false, allowed: true };
      
      const ck = rows[0];
      if (proposedBid < ck.minBidFloor) {
        return {
          isCore: true, tier: ck.tier, allowed: false,
          reason: `Core keyword (Tier ${ck.tier}): proposed bid $${proposedBid} below floor $${ck.minBidFloor}`,
          adjustedBid: ck.minBidFloor
        };
      }
      return { isCore: true, tier: ck.tier, allowed: true };
    } catch (e) {
      return { isCore: false, allowed: true };
    }
  }
}


var coreKeywordRouter;



// ============================================================
// P2-2: Health Signal Monitor - 5 key health signals dashboard
// ============================================================

// ============================================================
// healthSignal Performance Optimization v620-fix9
// - Redis distributed cache with memory fallback
// - Precomputation cron job (every 10 minutes)
// - 3-tier read priority: Redis -> Memory -> Realtime
// ============================================================
const _healthSignalMemCache = new Map();
const _healthSignalPending = new Map();
const HEALTH_SIGNAL_CACHE_TTL = 5 * 60; // 5 minutes in seconds
const HEALTH_SIGNAL_REDIS_KEY_PREFIX = "hs:report:";
const HEALTH_SIGNAL_PRECOMPUTE_INTERVAL = 30 * 60 * 1000; // 30 minutes (safety net, event-driven is primary)
const _hsPrecomputeTimer = null;

// === Redis Cache Layer ===
async function _hsRedisGet(accountId) {
  try {
    const { getRedis: _gr, isRedisAvailable: _ira } = await Promise.resolve().then(() => (init_redisClient(), redisClient_exports));
    if (!_ira()) return null;
    const redis = _gr();
    if (!redis) return null;
    const raw = await redis.get(HEALTH_SIGNAL_REDIS_KEY_PREFIX + accountId);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}


async function _hsRedisSet(accountId, data) {
  try {
    const { getRedis: _gr, isRedisAvailable: _ira } = await Promise.resolve().then(() => (init_redisClient(), redisClient_exports));
    if (!_ira()) return false;
    const redis = _gr();
    if (!redis) return false;
    await redis.set(
      HEALTH_SIGNAL_REDIS_KEY_PREFIX + accountId,
      JSON.stringify(data),
      "EX",
      HEALTH_SIGNAL_CACHE_TTL
    );
    return true;
  } catch (e) {
    return false;
  }
}


// === Memory Cache Layer (fallback) ===
function _hsMemGet(accountId) {
  const key = `hs_${accountId}`;
  const cached = _healthSignalMemCache.get(key);
  if (cached && (Date.now() - cached.ts) < HEALTH_SIGNAL_CACHE_TTL * 1000) {
    return cached.data;
  }
  _healthSignalMemCache.delete(key);
  return null;
}


function _hsMemSet(accountId, data) {
  const key = `hs_${accountId}`;
  _healthSignalMemCache.set(key, { data, ts: Date.now() });
  if (_healthSignalMemCache.size > 100) {
    const oldest = [..._healthSignalMemCache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
    if (oldest) _healthSignalMemCache.delete(oldest[0]);
  }
}


// === 3-Tier Cache Read ===
async function _hsGetCached(accountId) {
  // Tier 1: Redis (distributed, shared across instances)
  const redisData = await _hsRedisGet(accountId);
  if (redisData) {
    _hsMemSet(accountId, redisData); // warm memory cache
    return { data: redisData, source: "redis" };
  }
  // Tier 2: Memory (local, single instance)
  const memData = _hsMemGet(accountId);
  if (memData) {
    return { data: memData, source: "memory" };
  }
  return null;
}


async function _hsSetCached(accountId, data) {
  _hsMemSet(accountId, data);
  await _hsRedisSet(accountId, data);
}


// === Shared raw query using an existing connection ===
async function _hsQuery(conn, sqlStr, params = []) {
  const [rows] = await conn.execute(sqlStr, params);
  return rows || [];
}


// === Precomputation Cron Job ===
async function _hsPrecomputeAll() {
  try {
    // Memory check: skip if memory usage > 80%
    const memUsage = process.memoryUsage();
    const heapUsedMB = memUsage.heapUsed / 1024 / 1024;
    const heapTotalMB = memUsage.heapTotal / 1024 / 1024;
    if (heapUsedMB / heapTotalMB > 0.8) {
      console.log(`[HealthSignal-Precompute] Skipping: memory usage ${Math.round(heapUsedMB)}/${Math.round(heapTotalMB)}MB (>80%)`);
      return;
    }

    // Get active accounts
    const accounts = await v620RawQuery(
      "SELECT id FROM ad_accounts WHERE status = 'active' AND access_token IS NOT NULL AND access_token != '' ORDER BY id"
    );
    if (!accounts || accounts.length === 0) return;

    console.log(`[HealthSignal-Precompute] Starting precomputation for ${accounts.length} accounts...`);
    let success = 0, failed = 0, skipped = 0;
    const startTime = Date.now();

    for (const acct of accounts) {
      try {
        // Check memory before each account
        const mem = process.memoryUsage();
        if (mem.heapUsed / mem.heapTotal > 0.85) {
          console.log(`[HealthSignal-Precompute] Memory limit reached, stopping. Processed ${success}/${accounts.length}`);
          skipped = accounts.length - success - failed;
          break;
        }

        const report = await HealthSignalMonitor._computeFullReport(acct.id);
        await _hsSetCached(acct.id, report);
        success++;
      } catch (e) {
        failed++;
        // Don't log every failure to avoid log spam
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(`[HealthSignal-Precompute] Done in ${elapsed}ms: ${success} success, ${failed} failed, ${skipped} skipped`);
  } catch (e) {
    console.log(`[HealthSignal-Precompute] Error: ${e.message}`);
  }
}

// === v620-fix10: Event-Driven Single-Account Precompute ===
const _hsEventPrecomputeInFlight = new Set();
async function _hsPrecomputeForAccount(accountId) {
  if (!accountId) return;
  // Dedup: skip if already computing for this account
  if (_hsEventPrecomputeInFlight.has(accountId)) {
    console.log(`[HealthSignal-Event] Skipping account ${accountId}: already computing`);
    return;
  }
  _hsEventPrecomputeInFlight.add(accountId);
  try {
    console.log(`[HealthSignal-Event] Sync completed for account ${accountId}, triggering precompute...`);
    const report = await HealthSignalMonitor._computeFullReport(accountId);
    await _hsSetCached(accountId, report);
    console.log(`[HealthSignal-Event] Precomputed account ${accountId} in ${report.computeTimeMs}ms (overallHealth: ${report.overallHealth})`);
    // Publish event to Redis for cross-instance cache invalidation
    try {
      const { getRedis: _gr, isRedisAvailable: _ira } = await Promise.resolve().then(() => (init_redisClient(), redisClient_exports));
      if (_ira()) {
        const redis = _gr();
        if (redis) {
          await redis.publish("hs:precomputed", JSON.stringify({ accountId, ts: Date.now() }));
        }
      }
    } catch (pubErr) {
      // Non-critical: pub/sub failure doesn't affect precompute result
    }
  } catch (e) {
    console.log(`[HealthSignal-Event] Failed for account ${accountId}: ${e.message}`);
  } finally {
    _hsEventPrecomputeInFlight.delete(accountId);
  }
}


// === v620-fix10: Redis Pub/Sub Subscriber for Cross-Instance Cache Warm ===
const _hsSubInitialized = false;
async function _hsInitSubscriber() {
  if (_hsSubInitialized) return;
  _hsSubInitialized = true;
  try {
    const { getRedis: _gr, isRedisAvailable: _ira } = await Promise.resolve().then(() => (init_redisClient(), redisClient_exports));
    if (!_ira()) return;
    const redis = _gr();
    if (!redis || !redis.duplicate) return;
    // Create a dedicated subscriber connection (Redis requires separate connection for subscribe)
    const sub = redis.duplicate();
    await sub.subscribe("hs:precomputed");
    sub.on("message", (channel, message) => {
      if (channel === "hs:precomputed") {
        try {
          const { accountId } = JSON.parse(message);
          // Invalidate local memory cache so next request fetches fresh data from Redis
          _healthSignalMemCache.delete(`hs_${accountId}`);
        } catch (e) {}
      }
    });
    console.log("[HealthSignal-Event] Redis pub/sub subscriber initialized for cross-instance sync");
  } catch (e) {
    console.log(`[HealthSignal-Event] Subscriber init failed (non-critical): ${e.message}`);
    _hsSubInitialized = false;
  }
}



function startHealthSignalPrecompute() {
  if (_hsPrecomputeTimer) return;
  // v620-fix10: Initialize Redis pub/sub subscriber for cross-instance cache sync
  _hsInitSubscriber().catch(() => {});
  // Initial delay of 60 seconds to let the system stabilize
  setTimeout(() => {
    _hsPrecomputeAll();
    _hsPrecomputeTimer = setInterval(_hsPrecomputeAll, HEALTH_SIGNAL_PRECOMPUTE_INTERVAL);
  }, 60 * 1000);
  console.log("[HealthSignal-Precompute] v620-fix10: Event-driven mode active, safety-net interval: 30min (first run in 60s)");
}


class HealthSignalMonitor {
  // Optimized: merged daily aggregation for TACoS + Conversion + ImpressionShare
  static async _fetchDailyAggregation(conn, accountId, days = 30) {
    const rows = await _hsQuery(conn,
      `SELECT DATE(dp.date) as d,
              SUM(dp.spend) as spend, SUM(dp.sales) as sales,
              SUM(dp.clicks) as clicks, SUM(dp.orders) as orders,
              SUM(dp.impressions) as impressions
       FROM daily_performance dp
       JOIN campaigns c ON dp.campaignId = c.campaignId AND dp.accountId = c.accountId
       WHERE c.accountId = ? AND dp.date >= DATE_SUB(NOW(), INTERVAL ? DAY)
       GROUP BY DATE(dp.date) ORDER BY d`,
      [accountId, days]
    );
    return rows;
  }

  static _deriveTACoS(dailyRows) {
    if (!dailyRows || dailyRows.length === 0) return { tacos: null, trend: "unknown", dataPoints: 0 };
    const totalSpend = dailyRows.reduce((s, r) => s + parseFloat(r.spend || 0), 0);
    const totalSales = dailyRows.reduce((s, r) => s + parseFloat(r.sales || 0), 0);
    const tacos = totalSales > 0 ? (totalSpend / totalSales * 100) : 0;

    const mid = Math.floor(dailyRows.length / 2);
    const firstHalf = dailyRows.slice(0, mid);
    const secondHalf = dailyRows.slice(mid);
    const firstTacos = firstHalf.reduce((s, r) => s + parseFloat(r.spend || 0), 0) /
                       Math.max(firstHalf.reduce((s, r) => s + parseFloat(r.sales || 0), 0), 0.01) * 100;
    const secondTacos = secondHalf.reduce((s, r) => s + parseFloat(r.spend || 0), 0) /
                        Math.max(secondHalf.reduce((s, r) => s + parseFloat(r.sales || 0), 0), 0.01) * 100;
    const trend = secondTacos > firstTacos * 1.1 ? "worsening" :
                  secondTacos < firstTacos * 0.9 ? "improving" : "stable";
    return { tacos: Math.round(tacos * 100) / 100, trend, dataPoints: dailyRows.length, dailyData: dailyRows };
  }

  static _deriveImpressionShare(dailyRows, days = 14) {
    const now = new Date();
    const cutoff = new Date(now.getTime() - days * 86400000);
    const cutoffPrev = new Date(now.getTime() - days * 2 * 86400000);

    let currImpr = 0, prevImpr = 0;
    for (const r of dailyRows) {
      const d = new Date(r.d);
      if (d >= cutoff) {
        currImpr += parseFloat(r.impressions || 0);
      } else if (d >= cutoffPrev) {
        prevImpr += parseFloat(r.impressions || 0);
      }
    }
    const changePercent = prevImpr > 0 ? ((currImpr - prevImpr) / prevImpr * 100) : 0;
    return {
      currentImpressions: currImpr,
      previousImpressions: prevImpr,
      changePercent: Math.round(changePercent * 100) / 100,
      status: changePercent < -15 ? "critical" : changePercent < -5 ? "warning" : "healthy",
      activeCampaigns: 0
    };
  }

  static _deriveConversionHealth(dailyRows, days = 14) {
    const cutoff = new Date(Date.now() - days * 86400000);
    const recentRows = dailyRows.filter(r => new Date(r.d) >= cutoff);

    const totalClicks = recentRows.reduce((s, r) => s + parseInt(r.clicks || 0), 0);
    const totalOrders = recentRows.reduce((s, r) => s + parseInt(r.orders || 0), 0);
    const convRate = totalClicks > 0 ? (totalOrders / totalClicks * 100) : 0;
    const totalSpend = recentRows.reduce((s, r) => s + parseFloat(r.spend || 0), 0);
    const totalSales = recentRows.reduce((s, r) => s + parseFloat(r.sales || 0), 0);
    const acos = totalSales > 0 ? (totalSpend / totalSales * 100) : 0;
    const roas = totalSpend > 0 ? (totalSales / totalSpend) : 0;

    return {
      conversionRate: Math.round(convRate * 100) / 100,
      acos: Math.round(acos * 100) / 100,
      roas: Math.round(roas * 100) / 100,
      totalClicks, totalOrders,
      status: convRate > 10 ? "excellent" : convRate > 5 ? "healthy" : convRate > 2 ? "warning" : "critical"
    };
  }

  static async _fetchBidHealth(conn, accountId) {
    if (!conn) { const rows = await v620RawQuery(
      `SELECT AVG(k.bid) as avgBid, MIN(k.bid) as minBid, MAX(k.bid) as maxBid,
              COUNT(*) as totalKeywords,
              SUM(CASE WHEN k.bid < 0.15 THEN 1 ELSE 0 END) as lowBidCount,
              SUM(CASE WHEN k.keywordStatus = 'enabled' THEN 1 ELSE 0 END) as enabledCount,
              SUM(CASE WHEN k.keywordStatus = 'paused' THEN 1 ELSE 0 END) as pausedCount
       FROM keywords k
       JOIN campaigns c ON k.campaignId = c.campaignId AND c.accountId = k.accountId
       WHERE k.accountId = ?`,
      [accountId]
    ); const r2 = rows?.[0] || {}; const lbp = r2.totalKeywords > 0 ? (r2.lowBidCount / r2.totalKeywords * 100) : 0; return { avgBid: Math.round(parseFloat(r2.avgBid||0)*100)/100, minBid: Math.round(parseFloat(r2.minBid||0)*100)/100, maxBid: Math.round(parseFloat(r2.maxBid||0)*100)/100, totalKeywords: parseInt(r2.totalKeywords||0), enabledKeywords: parseInt(r2.enabledCount||0), pausedKeywords: parseInt(r2.pausedCount||0), lowBidPercent: Math.round(lbp*100)/100, status: lbp > 30 ? "critical" : lbp > 15 ? "warning" : "healthy" }; }
    const rows = await _hsQuery(conn,
      `SELECT AVG(k.bid) as avgBid, MIN(k.bid) as minBid, MAX(k.bid) as maxBid,
              COUNT(*) as totalKeywords,
              SUM(CASE WHEN k.bid < 0.15 THEN 1 ELSE 0 END) as lowBidCount,
              SUM(CASE WHEN k.keywordStatus = 'enabled' THEN 1 ELSE 0 END) as enabledCount,
              SUM(CASE WHEN k.keywordStatus = 'paused' THEN 1 ELSE 0 END) as pausedCount
       FROM keywords k
       JOIN campaigns c ON k.campaignId = c.campaignId AND c.accountId = k.accountId
       WHERE k.accountId = ?`,
      [accountId]
    );
    const r = rows?.[0] || {};
    const lowBidPercent = r.totalKeywords > 0 ? (r.lowBidCount / r.totalKeywords * 100) : 0;
    return {
      avgBid: Math.round(parseFloat(r.avgBid || 0) * 100) / 100,
      minBid: Math.round(parseFloat(r.minBid || 0) * 100) / 100,
      maxBid: Math.round(parseFloat(r.maxBid || 0) * 100) / 100,
      totalKeywords: parseInt(r.totalKeywords || 0),
      enabledKeywords: parseInt(r.enabledCount || 0),
      pausedKeywords: parseInt(r.pausedCount || 0),
      lowBidPercent: Math.round(lowBidPercent * 100) / 100,
      status: lowBidPercent > 30 ? "critical" : lowBidPercent > 15 ? "warning" : "healthy"
    };
  }

  static async _fetchCampaignHealth(conn, accountId) {
    if (!conn) { const rows2 = await v620RawQuery(
      `SELECT campaignStatus as status, COUNT(*) as cnt FROM campaigns WHERE accountId = ? GROUP BY campaignStatus`,
      [accountId]
    ); const st = {}; for (const r2 of (rows2||[])) st[r2.status]=parseInt(r2.cnt); const t=Object.values(st).reduce((s,v)=>s+v,0); const ep=t>0?((st.enabled||0)/t*100):0; return { total:t, byStatus:st, enabledPercent:Math.round(ep*100)/100, status:ep<10?"critical":ep<25?"warning":"healthy" }; }
    const rows = await _hsQuery(conn,
      `SELECT campaignStatus as status, COUNT(*) as cnt FROM campaigns WHERE accountId = ? GROUP BY campaignStatus`,
      [accountId]
    );
    const stats = {};
    for (const r of (rows || [])) stats[r.status] = parseInt(r.cnt);
    const total = Object.values(stats).reduce((s, v) => s + v, 0);
    const enabledPercent = total > 0 ? ((stats.enabled || 0) / total * 100) : 0;
    return {
      total,
      byStatus: stats,
      enabledPercent: Math.round(enabledPercent * 100) / 100,
      status: enabledPercent < 10 ? "critical" : enabledPercent < 25 ? "warning" : "healthy"
    };
  }

  // Legacy wrappers for individual route calls (with cache)
  static async calculateTACoS(db2, accountId, days = 30) {
    try {
      const cached = await _hsGetCached(accountId);
      if (cached) return cached.data.signals.tacos;
      const rows = await v620RawQuery(
        `SELECT DATE(dp.date) as d, SUM(dp.spend) as adSpend, SUM(dp.sales) as adSales
         FROM daily_performance dp
         JOIN campaigns c ON dp.campaignId = c.campaignId AND dp.accountId = c.accountId
         WHERE c.accountId = ? AND dp.date >= DATE_SUB(NOW(), INTERVAL ? DAY)
         GROUP BY DATE(dp.date) ORDER BY d`,
        [accountId, days]
      );
      if (!rows || rows.length === 0) return { tacos: null, trend: "unknown", dataPoints: 0 };
      const mapped = rows.map(r => ({ ...r, spend: r.adSpend, sales: r.adSales }));
      return HealthSignalMonitor._deriveTACoS(mapped);
    } catch (e) { return { tacos: null, trend: "error", error: e.message }; }
  }

  static async calculateImpressionShare(db2, accountId, days = 14) {
    try {
      const cached = await _hsGetCached(accountId);
      if (cached) return cached.data.signals.impressionShare;
      const current = await v620RawQuery(
        `SELECT SUM(dp.impressions) as totalImpressions, SUM(dp.clicks) as totalClicks,
                COUNT(DISTINCT dp.campaignId) as activeCampaigns
         FROM daily_performance dp
         JOIN campaigns c ON dp.campaignId = c.campaignId AND dp.accountId = c.accountId
         WHERE c.accountId = ? AND dp.date >= DATE_SUB(NOW(), INTERVAL ? DAY)`,
        [accountId, days]
      );
      const previous = await v620RawQuery(
        `SELECT SUM(dp.impressions) as totalImpressions
         FROM daily_performance dp
         JOIN campaigns c ON dp.campaignId = c.campaignId AND dp.accountId = c.accountId
         WHERE c.accountId = ? AND dp.date >= DATE_SUB(NOW(), INTERVAL ? DAY) 
         AND dp.date < DATE_SUB(NOW(), INTERVAL ? DAY)`,
        [accountId, days * 2, days]
      );
      const currImpr = parseFloat(current?.[0]?.totalImpressions || 0);
      const prevImpr = parseFloat(previous?.[0]?.totalImpressions || 0);
      const changePercent = prevImpr > 0 ? ((currImpr - prevImpr) / prevImpr * 100) : 0;
      return {
        currentImpressions: currImpr, previousImpressions: prevImpr,
        changePercent: Math.round(changePercent * 100) / 100,
        status: changePercent < -15 ? "critical" : changePercent < -5 ? "warning" : "healthy",
        activeCampaigns: parseInt(current?.[0]?.activeCampaigns || 0)
      };
    } catch (e) { return { status: "error", error: e.message }; }
  }

  static async calculateBidHealth(db2, accountId) {
    try {
      const cached = await _hsGetCached(accountId);
      if (cached) return cached.data.signals.bidHealth;
      return await HealthSignalMonitor._fetchBidHealth(null, accountId);
    } catch (e) { return { status: "error", error: e.message }; }
  }

  static async calculateCampaignHealth(db2, accountId) {
    try {
      const cached = await _hsGetCached(accountId);
      if (cached) return cached.data.signals.campaignHealth;
      return await HealthSignalMonitor._fetchCampaignHealth(null, accountId);
    } catch (e) { return { status: "error", error: e.message }; }
  }

  static async getFullHealthReport(db2, accountId) {
    // 3-tier cache check
    const cached = await _hsGetCached(accountId);
    if (cached) {
      return { ...cached.data, cacheSource: cached.source };
    }

    // Dedup concurrent requests for same account
    const pendingKey = `hs_${accountId}`;
    if (_healthSignalPending.has(pendingKey)) {
      return _healthSignalPending.get(pendingKey);
    }

    const promise = HealthSignalMonitor._computeFullReport(accountId);
    _healthSignalPending.set(pendingKey, promise);
    try {
      const result = await promise;
      await _hsSetCached(accountId, result);
      return { ...result, cacheSource: "realtime" };
    } finally {
      _healthSignalPending.delete(pendingKey);
    }
  }

  static async _computeFullReport(accountId) {
    const { getDirectConnection: getDC } = await Promise.resolve().then(() => (init_connection(), connection_exports));
    const conn = await getDC(15000);
    try {
      const startTime = Date.now();

      // Phase 1: Single merged daily aggregation query
      const dailyRows = await HealthSignalMonitor._fetchDailyAggregation(conn, accountId, 30);

      // Phase 2: Bid health + Campaign health (sequential on same connection)
      const bidHealth = await HealthSignalMonitor._fetchBidHealth(conn, accountId);
      const campaignHealth = await HealthSignalMonitor._fetchCampaignHealth(conn, accountId);

      // Phase 3: Derive all signals from daily aggregation (pure computation)
      const tacos = HealthSignalMonitor._deriveTACoS(dailyRows);
      const impressionShare = HealthSignalMonitor._deriveImpressionShare(dailyRows, 14);
      const conversion = HealthSignalMonitor._deriveConversionHealth(dailyRows, 14);

      impressionShare.activeCampaigns = campaignHealth.byStatus?.enabled || 0;

      const signals = [tacos.trend, impressionShare.status, conversion.status, bidHealth.status, campaignHealth.status];
      const criticalCount = signals.filter(s => s === "critical").length;
      const warningCount = signals.filter(s => s === "warning" || s === "worsening").length;

      let overallHealth = "healthy";
      if (criticalCount >= 2) overallHealth = "critical";
      else if (criticalCount >= 1 || warningCount >= 2) overallHealth = "warning";

      const elapsed = Date.now() - startTime;
      return {
        overallHealth,
        generatedAt: new Date().toISOString(),
        computeTimeMs: elapsed,
        signals: { tacos, impressionShare, conversion, bidHealth, campaignHealth },
        alerts: [
          ...(tacos.trend === "worsening" ? [{ level: "warning", message: "TACoS trending upward - ad efficiency declining" }] : []),
          ...(impressionShare.status === "critical" ? [{ level: "critical", message: `Impressions dropped ${impressionShare.changePercent}% vs previous period` }] : []),
          ...(bidHealth.status === "critical" ? [{ level: "critical", message: `${bidHealth.lowBidPercent}% of keywords have critically low bids` }] : []),
          ...(campaignHealth.status === "critical" ? [{ level: "critical", message: `Only ${campaignHealth.enabledPercent}% of campaigns are active` }] : [])
        ]
      };
    } catch (e) {
      return {
        overallHealth: "error",
        generatedAt: new Date().toISOString(),
        error: e.message,
        signals: {},
        alerts: [{ level: "critical", message: `Health report generation failed: ${e.message}` }]
      };
    } finally {
      if (conn && conn.release) conn.release();
      else if (conn && conn.releaseFunc) conn.releaseFunc();
    }
  }
}


var healthSignalRouter;



// ============================================================
// P3: Sync Orchestrator - Enhanced data sync with pre-checks and incremental sync
// ============================================================

class SyncOrchestrator {
  static syncQueue = [];
  static isProcessing = false;
  static syncStats = new Map();

  static async preCheckAccount(db2, accountId) {
    try {
      const account = await v620RawQuery(
        `SELECT id, accountName, marketplace, status, lastConnectionCheck as lastSyncAt FROM ad_accounts WHERE id = ?`,
        [accountId]
      );
      if (!account || account.length === 0) {
        return { valid: false, reason: "Account not found", accountId };
      }
      
      const acc = account[0];
      if (acc.status === "paused" || acc.status === "archived") {
        return { valid: false, reason: `Account status: ${acc.status}`, accountId };
      }
      
      const campaignCount = await v620RawQuery(
        `SELECT COUNT(*) as cnt FROM campaigns WHERE accountId = ?`, [accountId]
      );
      const kwCount = await v620RawQuery(
        `SELECT COUNT(*) as cnt FROM keywords WHERE accountId = ?`, [accountId]
      );
      
      return {
        valid: true,
        accountId,
        accountName: acc.accountName,
        marketplace: acc.marketplace,
        campaignCount: parseInt(campaignCount?.[0]?.cnt || 0),
        keywordCount: parseInt(kwCount?.[0]?.cnt || 0),
        lastSyncAt: acc.lastSyncAt || acc.lastConnectionCheck,
        isEmpty: parseInt(campaignCount?.[0]?.cnt || 0) === 0
      };
    } catch (e) {
      return { valid: false, reason: e.message, accountId };
    }
  }

  static async getIncrementalSyncCandidates(db2, accountId, sinceHours = 24) {
    try {
      const modifiedKw = await v620RawQuery(
        `SELECT COUNT(*) as cnt FROM keywords 
         WHERE accountId = ? AND updatedAt >= DATE_SUB(NOW(), INTERVAL ? HOUR)`,
        [accountId, sinceHours]
      );
      const modifiedCampaigns = await v620RawQuery(
        `SELECT COUNT(*) as cnt FROM campaigns 
         WHERE accountId = ? AND updatedAt >= DATE_SUB(NOW(), INTERVAL ? HOUR)`,
        [accountId, sinceHours]
      );
      const pendingBids = await v620RawQuery(
        `SELECT COUNT(*) as cnt FROM keywords 
         WHERE accountId = ? AND bid_sync_status = 'pending_confirmation'`,
        [accountId]
      );
      
      return {
        modifiedKeywords: parseInt(modifiedKw?.[0]?.cnt || 0),
        modifiedCampaigns: parseInt(modifiedCampaigns?.[0]?.cnt || 0),
        pendingBidSyncs: parseInt(pendingBids?.[0]?.cnt || 0),
        needsFullSync: false,
        needsIncrementalSync: parseInt(modifiedKw?.[0]?.cnt || 0) > 0 || parseInt(modifiedCampaigns?.[0]?.cnt || 0) > 0
      };
    } catch (e) {
      return { error: e.message };
    }
  }

  static async enqueueSyncTask(task) {
    this.syncQueue.push({
      ...task,
      enqueuedAt: new Date(),
      status: "queued",
      retries: 0,
      maxRetries: 3
    });
    
    if (!this.isProcessing) {
      this.processQueue();
    }
    return { queued: true, queueLength: this.syncQueue.length };
  }

  static async processQueue() {
    if (this.isProcessing || this.syncQueue.length === 0) return;
    this.isProcessing = true;
    
    while (this.syncQueue.length > 0) {
      const task = this.syncQueue.shift();
      try {
        const preCheck = await this.preCheckAccount(task.db, task.accountId);
        if (!preCheck.valid) {
          console.warn(`[SyncOrchestrator] Skipping account ${task.accountId}: ${preCheck.reason}`);
          continue;
        }
        if (preCheck.isEmpty && task.type !== "full_sync") {
          console.warn(`[SyncOrchestrator] Account ${task.accountId} is empty, skipping incremental sync`);
          continue;
        }
        
        if (task.callback) await task.callback(task);
        
        this.syncStats.set(task.accountId, {
          lastSync: new Date(),
          type: task.type,
          success: true
        });
      } catch (e) {
        task.retries++;
        if (task.retries < task.maxRetries) {
          this.syncQueue.push(task);
        } else {
          this.syncStats.set(task.accountId, {
            lastSync: new Date(),
            type: task.type,
            success: false,
            error: e.message
          });
        }
      }
    }
    this.isProcessing = false;
  }

  static getSyncStatus() {
    return {
      queueLength: this.syncQueue.length,
      isProcessing: this.isProcessing,
      accountStats: Object.fromEntries(this.syncStats)
    };
  }
}


var syncOrchestratorRouter;



// ============================================================
// P4: Discovery Governor & Event Calendar
// ============================================================

class DiscoveryGovernor {
  static async classifyTarget(db2, targetId, targetType = "keyword") {
    const table = targetType === "keyword" ? "keywords" : "product_targets";
    const idField = targetType === "keyword" ? "id" : "id";
    
    try {
      const target = await v620RawQuery(
        `SELECT t.*, 
                (SELECT COUNT(*) FROM bid_performance_history bph WHERE bph.bidObjectId = t.keywordId AND bph.bidObjectType = 'keyword' AND bph.orders > 0) as historicalOrders,
                (SELECT MIN(date) FROM bid_performance_history bph WHERE bph.bidObjectId = t.keywordId AND bph.bidObjectType = 'keyword') as firstSeen
         FROM ${table} t WHERE t.${idField} = ?`,
        [targetId]
      );
      
      if (!target || target.length === 0) return { classification: "unknown" };
      
      const t = target[0];
      const daysSinceFirst = t.firstSeen ? Math.floor((Date.now() - new Date(t.firstSeen).getTime()) / 86400000) : 0;
      const orders = parseInt(t.historicalOrders || 0);
      
      if (orders >= 10 && daysSinceFirst > 30) return { classification: "mature", protectionLevel: "high", minAttributionDays: 3 };
      if (orders >= 3 && daysSinceFirst > 14) return { classification: "growing", protectionLevel: "medium", minAttributionDays: 7 };
      if (daysSinceFirst < 14) return { classification: "discovery", protectionLevel: "low", minAttributionDays: 14 };
      return { classification: "standard", protectionLevel: "standard", minAttributionDays: 7 };
    } catch (e) {
      return { classification: "unknown", error: e.message };
    }
  }

  static async getStepDownSchedule(currentBid, targetBid, steps = 3) {
    if (targetBid >= currentBid) return [{ bid: targetBid, step: 1 }];
    
    const schedule = [];
    const stepSize = (currentBid - targetBid) / steps;
    for (let i = 1; i <= steps; i++) {
      schedule.push({
        step: i,
        bid: Math.round((currentBid - stepSize * i) * 100) / 100,
        dayDelay: i * 3
      });
    }
    return schedule;
  }

  static async shouldAllowBidDecrease(db2, targetId, proposedDecrease) {
    const classification = await this.classifyTarget(db2, targetId);
    
    if (classification.classification === "discovery") {
      return {
        allowed: false,
        reason: "Discovery target in attribution window - bid decrease blocked",
        classification: classification.classification,
        suggestion: "Wait until attribution window expires"
      };
    }
    
    if (classification.classification === "growing" && proposedDecrease > 0.15) {
      return {
        allowed: false,
        reason: "Growing target - max 15% decrease allowed",
        classification: classification.classification,
        maxAllowedDecrease: 0.15
      };
    }
    
    return { allowed: true, classification: classification.classification };
  }
}


class EventCalendar {
  static EVENTS = [
    { name: "Prime Day", startMonth: 7, startDay: 8, endMonth: 7, endDay: 17, bidMultiplier: 1.3, budgetMultiplier: 2.0 },
    { name: "Back to School", startMonth: 8, startDay: 1, endMonth: 9, endDay: 5, bidMultiplier: 1.1, budgetMultiplier: 1.3 },
    { name: "Black Friday / Cyber Monday", startMonth: 11, startDay: 15, endMonth: 12, endDay: 5, bidMultiplier: 1.4, budgetMultiplier: 2.5 },
    { name: "Holiday Season", startMonth: 12, startDay: 1, endMonth: 12, endDay: 25, bidMultiplier: 1.3, budgetMultiplier: 2.0 },
    { name: "New Year Sales", startMonth: 12, startDay: 26, endMonth: 1, endDay: 5, bidMultiplier: 1.1, budgetMultiplier: 1.5 },
    { name: "Valentine Day", startMonth: 2, startDay: 1, endMonth: 2, endDay: 15, bidMultiplier: 1.1, budgetMultiplier: 1.3 },
    { name: "Spring Sale", startMonth: 3, startDay: 15, endMonth: 3, endDay: 31, bidMultiplier: 1.1, budgetMultiplier: 1.3 },
    { name: "Mother Day", startMonth: 4, startDay: 25, endMonth: 5, endDay: 12, bidMultiplier: 1.15, budgetMultiplier: 1.4 }
  ];

  static getCurrentEvents(date = new Date()) {
    const month = date.getMonth() + 1;
    const day = date.getDate();
    
    return this.EVENTS.filter(evt => {
      if (evt.startMonth <= evt.endMonth) {
        return (month > evt.startMonth || (month === evt.startMonth && day >= evt.startDay)) &&
               (month < evt.endMonth || (month === evt.endMonth && day <= evt.endDay));
      } else {
        return (month > evt.startMonth || (month === evt.startMonth && day >= evt.startDay)) ||
               (month < evt.endMonth || (month === evt.endMonth && day <= evt.endDay));
      }
    });
  }

  static getUpcomingEvents(days = 30, date = new Date()) {
    const upcoming = [];
    for (let d = 0; d <= days; d++) {
      const checkDate = new Date(date.getTime() + d * 86400000);
      const events = this.getCurrentEvents(checkDate);
      for (const evt of events) {
        if (!upcoming.find(u => u.name === evt.name)) {
          upcoming.push({ ...evt, daysUntil: d });
        }
      }
    }
    return upcoming;
  }

  static shouldBlockDecrease(date = new Date()) {
    const activeEvents = this.getCurrentEvents(date);
    if (activeEvents.length > 0) {
      return {
        blocked: true,
        reason: `Active event: ${activeEvents.map(e => e.name).join(", ")}`,
        events: activeEvents,
        bidMultiplier: Math.max(...activeEvents.map(e => e.bidMultiplier)),
        budgetMultiplier: Math.max(...activeEvents.map(e => e.budgetMultiplier))
      };
    }
    
    const upcoming = this.getUpcomingEvents(7, date);
    if (upcoming.length > 0) {
      return {
        blocked: true,
        reason: `Upcoming event in ${upcoming[0].daysUntil} days: ${upcoming[0].name}`,
        events: upcoming,
        bidMultiplier: 1.0,
        budgetMultiplier: 1.0
      };
    }
    
    return { blocked: false };
  }

  static async addCustomEvent(db2, event) {
    try {
      await v620RawQuery(
        `INSERT INTO custom_events (name, startDate, endDate, bidMultiplier, budgetMultiplier, marketplace, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, NOW())`,
        [event.name, event.startDate, event.endDate, event.bidMultiplier || 1.0, event.budgetMultiplier || 1.0, event.marketplace || "US"]
      );
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
}


var discoveryRouter, eventCalendarRouter;
