// server/sync/dateGapBackfillService.ts
var dateGapBackfillService_exports = {};
__export(dateGapBackfillService_exports, {
  detectAndQueueBackfill: () => detectAndQueueBackfill,
  scanAllAccountsGaps: () => scanAllAccountsGaps
});
function getAllRows2(result) {
  if (Array.isArray(result) && result.length > 0) {
    const rows = result[0];
    if (Array.isArray(rows)) {
      return rows;
    }
  }
  return [];
}
async function detectAndQueueBackfill(accountId) {
  const conn = await getDirectConnection();
  try {
    const sampleResult = await conn.execute(
      `SELECT dp.campaignId, c.campaignName, SUM(dp.spend) as totalSpend
      FROM daily_performance dp
      INNER JOIN campaigns c ON dp.campaignId = c.campaignId AND dp.accountId = c.accountId
      WHERE dp.accountId = ? AND dp.spend > 0 
        AND dp.date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
      GROUP BY dp.campaignId, c.campaignName
      HAVING totalSpend > 0
      ORDER BY totalSpend DESC
      LIMIT ?`,
      [accountId, BACKFILL_CONFIG.maxDaysBack, BACKFILL_CONFIG.maxCampaignsToCheck]
    );
    const sampleCampaigns = getAllRows2(sampleResult);
    if (sampleCampaigns.length === 0) {
      return { accountId, gapsDetected: 0, gapsQueued: 0, gaps: [], message: "\u65E0\u6709\u82B1\u8D39\u7684Campaign" };
    }
    const allGaps = [];
    for (const sc of sampleCampaigns) {
      const dateResult = await conn.execute(
        `SELECT DATE_FORMAT(date, '%Y-%m-%d') as dateStr FROM daily_performance 
        WHERE accountId = ? AND campaignId = ? 
          AND date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
        ORDER BY date ASC`,
        [accountId, sc.campaignId, BACKFILL_CONFIG.maxDaysBack]
      );
      const dateRows = getAllRows2(dateResult);
      if (dateRows.length < 2) continue;
      for (let i = 1; i < dateRows.length; i++) {
        const prevDate = new Date(dateRows[i - 1].dateStr);
        const currDate = new Date(dateRows[i].dateStr);
        const diffDays = Math.round((currDate.getTime() - prevDate.getTime()) / 864e5);
        if (diffDays > BACKFILL_CONFIG.minGapDays && diffDays <= BACKFILL_CONFIG.maxGapDays) {
          allGaps.push({
            accountId,
            campaignId: String(sc.campaignId),
            campaignName: sc.campaignName || "",
            gapStart: dateRows[i - 1].dateStr,
            gapEnd: dateRows[i].dateStr,
            gapDays: diffDays - 1
          });
        }
      }
    }
    if (allGaps.length === 0) {
      return { accountId, gapsDetected: 0, gapsQueued: 0, gaps: [], message: "\u65E0\u65E5\u671F\u65AD\u6863" };
    }
    const uniqueGapDates = /* @__PURE__ */ new Map();
    for (const gap of allGaps) {
      const key = `${gap.gapStart}|${gap.gapEnd}`;
      if (!uniqueGapDates.has(key)) {
        uniqueGapDates.set(key, gap);
      }
    }
    const uniqueGaps = Array.from(uniqueGapDates.values());
    const gapsToQueue = uniqueGaps.slice(0, BACKFILL_CONFIG.maxGapsToBackfill);
    for (const gap of gapsToQueue) {
      log134.info(`[fix24-patch] \u8D26\u6237${accountId}: \u68C0\u6D4B\u5230\u65E5\u671F\u65AD\u6863 ${gap.gapStart} \u2192 ${gap.gapEnd} (${gap.gapDays}\u5929), Campaign: ${gap.campaignName}`);
    }
    return {
      accountId,
      gapsDetected: uniqueGaps.length,
      gapsQueued: gapsToQueue.length,
      gaps: gapsToQueue,
      message: `\u68C0\u6D4B\u5230${uniqueGaps.length}\u5904\u65AD\u6863\uFF0C\u5DF2\u6392\u961F${gapsToQueue.length}\u5904\u5F85\u8865\u507F`
    };
  } finally {
    conn.release();
  }
}
async function scanAllAccountsGaps() {
  const conn = await getDirectConnection();
  try {
    const accountResult = await conn.execute(
      `SELECT DISTINCT accountId FROM daily_performance 
       WHERE date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
       ORDER BY accountId`,
      [BACKFILL_CONFIG.maxDaysBack]
    );
    const accountRows = getAllRows2(accountResult);
    const results = [];
    let accountsWithGaps = 0;
    let totalGaps = 0;
    let totalQueued = 0;
    for (const row of accountRows) {
      try {
        const result = await detectAndQueueBackfill(Number(row.accountId));
        results.push(result);
        if (result.gapsDetected > 0) {
          accountsWithGaps++;
          totalGaps += result.gapsDetected;
          totalQueued += result.gapsQueued;
        }
      } catch (err) {
        log134.warn(`\u68C0\u67E5\u8D26\u6237${row.accountId}\u65AD\u6863\u5931\u8D25: ${err.message}`);
      }
    }
    return {
      summary: {
        totalAccounts: accountRows.length,
        accountsWithGaps,
        totalGaps,
        totalQueued
      },
      accounts: results.filter((r) => r.gapsDetected > 0)
    };
  } finally {
    conn.release();
  }
}
var log134, BACKFILL_CONFIG;
var init_dateGapBackfillService = __esm({
  "server/sync/dateGapBackfillService.ts"() {
    "use strict";
    init_logger();
    init_connection();
    log134 = createModuleLogger("DateGapBackfill");
    BACKFILL_CONFIG = {
      // 最多检查的Campaign数量
      maxCampaignsToCheck: 20,
      // 最多补偿的断档数量
      maxGapsToBackfill: 3,
      // 只补偿最近N天内的断档
      maxDaysBack: 14,
      // 断档天数阈值（超过此天数才补偿）
      minGapDays: 1,
      // 断档天数上限（超过此天数可能是正常的无花费期间）
      maxGapDays: 5
    };
    __name(getAllRows2, "getAllRows");
    __name(detectAndQueueBackfill, "detectAndQueueBackfill");
    __name(scanAllAccountsGaps, "scanAllAccountsGaps");
  }
});

