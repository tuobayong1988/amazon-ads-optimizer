/**
 * server/sync/performanceIntegrityChecker.ts
 * 
 * Auto-converted from production bundle to TypeScript source.
 * Version: v621147 (production)
 */

import { campaigns } from '../../drizzle/schema';

function getFirstRow(result) {
  if (Array.isArray(result) && result.length > 0) {
    const rows = result[0];
    if (Array.isArray(rows) && rows.length > 0) {
      return rows[0];
    }
  }
  return null;
}
function getAllRows(result) {
  if (Array.isArray(result) && result.length > 0) {
    const rows = result[0];
    if (Array.isArray(rows)) {
      return rows;
    }
  }
  return [];
}
export async function checkAccountPerformanceCoverage(accountId) {
  const conn = await getDirectConnection();
  const warnings = [];
  try {
    const campaignResult = await conn.execute(
      `SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN campaignStatus = 'enabled' THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN campaignStatus = 'enabled' AND CAST(dailyBudget AS DECIMAL) > 0 THEN 1 ELSE 0 END) as activeWithBudget
      FROM campaigns WHERE accountId = ?`,
      [accountId]
    );
    const campaignStats = getFirstRow(campaignResult);
    const totalCampaigns = Number(campaignStats?.total || 0);
    const activeCampaigns = Number(campaignStats?.active || 0);
    const perfResult = await conn.execute(
      `SELECT 
        COUNT(DISTINCT dp.campaignId) as withPerfAll,
        COUNT(DISTINCT CASE WHEN dp.spend > 0 THEN dp.campaignId END) as withSpendAll,
        MAX(dp.date) as lastDate,
        MIN(dp.date) as oldestDate,
        COUNT(*) as totalRecords
      FROM daily_performance dp
      WHERE dp.accountId = ?`,
      [accountId]
    );
    const perfStats = getFirstRow(perfResult);
    const lastSyncDate = perfStats?.lastDate || null;
    const oldestDataDate = perfStats?.oldestDate || null;
    const totalPerfRecords = Number(perfStats?.totalRecords || 0);
    const activePerfResult = await conn.execute(
      `SELECT 
        COUNT(DISTINCT CASE WHEN dpAll.campaignId IS NOT NULL THEN c.campaignId END) as activeWithPerf,
        COUNT(DISTINCT CASE WHEN dpSpend.campaignId IS NOT NULL THEN c.campaignId END) as activeWithSpend
      FROM campaigns c
      LEFT JOIN (
        SELECT DISTINCT accountId, campaignId
        FROM daily_performance WHERE accountId = ?
      ) dpAll ON c.campaignId = dpAll.campaignId AND c.accountId = dpAll.accountId
      LEFT JOIN (
        SELECT DISTINCT accountId, campaignId
        FROM daily_performance WHERE accountId = ? AND spend > 0
      ) dpSpend ON c.campaignId = dpSpend.campaignId AND c.accountId = dpSpend.accountId
      WHERE c.accountId = ? AND c.campaignStatus = 'enabled'`,
      [accountId, accountId, accountId]
    );
    const activePerfStats = getFirstRow(activePerfResult);
    const campaignsWithPerfData = Number(activePerfStats?.activeWithPerf || 0);
    const campaignsWithSpend = Number(activePerfStats?.activeWithSpend || 0);
    const coverageRate = activeCampaigns > 0 ? Math.min(campaignsWithPerfData / activeCampaigns, 1) : 0;
    const spendCoverageRate = activeCampaigns > 0 ? Math.min(campaignsWithSpend / activeCampaigns, 1) : 0;
    const coverageByType = {};
    const typeResult = await conn.execute(
      `SELECT 
        c.campaignType,
        COUNT(*) as total,
        SUM(CASE WHEN dp.campaignId IS NOT NULL THEN 1 ELSE 0 END) as withPerf
      FROM campaigns c
      LEFT JOIN (
        SELECT DISTINCT accountId, campaignId FROM daily_performance WHERE accountId = ?
      ) dp ON c.campaignId = dp.campaignId AND c.accountId = dp.accountId
      WHERE c.accountId = ? AND c.campaignStatus = 'enabled'
      GROUP BY c.campaignType`,
      [accountId, accountId]
    );
    const typeRows = getAllRows(typeResult);
    for (const row of typeRows) {
      const typeName = row.campaignType || "unknown";
      const total = Number(row.total || 0);
      const withPerf = Number(row.withPerf || 0);
      coverageByType[typeName] = {
        total,
        withPerf,
        rate: total > 0 ? withPerf / total : 0
      };
    }
    const missingResult = await conn.execute(
      `SELECT c.campaignId, c.campaignName, c.campaignStatus, c.campaignType, c.dailyBudget
      FROM campaigns c
      WHERE c.accountId = ? AND c.campaignStatus = 'enabled' AND CAST(c.dailyBudget AS DECIMAL) > 0
      AND c.campaignId NOT IN (
        SELECT DISTINCT dp.campaignId FROM daily_performance dp WHERE dp.accountId = ?
      )
      ORDER BY CAST(c.dailyBudget AS DECIMAL) DESC
      LIMIT 50`,
      [accountId, accountId]
    );
    const missingRows = getAllRows(missingResult);
    const missingCampaigns = missingRows.map((r) => ({
      campaignId: String(r.campaignId),
      campaignName: r.campaignName || "",
      status: r.campaignStatus || "",
      campaignType: r.campaignType || "",
      dailyBudget: String(r.dailyBudget || "0")
    }));
    const dateGaps = [];
    const sampleResult = await conn.execute(
      `SELECT DISTINCT dp.campaignId, c.campaignName
      FROM daily_performance dp
      INNER JOIN campaigns c ON dp.campaignId = c.campaignId AND dp.accountId = c.accountId
      WHERE dp.accountId = ? AND dp.spend > 0
      ORDER BY dp.spend DESC
      LIMIT 10`,
      [accountId]
    );
    const sampleCampaigns = getAllRows(sampleResult);
    for (const sc of sampleCampaigns) {
      const dateResult = await conn.execute(
        `SELECT date FROM daily_performance 
        WHERE accountId = ? AND campaignId = ? AND date >= DATE_SUB(CURDATE(), INTERVAL 14 DAY)
        ORDER BY date ASC`,
        [accountId, sc.campaignId]
      );
      const dateRows = getAllRows(dateResult);
      if (dateRows.length > 1) {
        for (let i = 1; i < dateRows.length; i++) {
          const prevDate = new Date(dateRows[i - 1].date);
          const currDate = new Date(dateRows[i].date);
          const diffDays = Math.round((currDate.getTime() - prevDate.getTime()) / 864e5);
          if (diffDays > 1) {
            dateGaps.push({
              campaignId: String(sc.campaignId),
              campaignName: sc.campaignName || "",
              gapStart: dateRows[i - 1].date,
              gapEnd: dateRows[i].date,
              gapDays: diffDays - 1
            });
          }
        }
      }
    }
    if (coverageRate < 0.5 && activeCampaigns > 0) {
      warnings.push(`CRITICAL: \u7EE9\u6548\u6570\u636E\u8986\u76D6\u7387\u4EC5${(coverageRate * 100).toFixed(1)}%\uFF0C${activeCampaigns - campaignsWithPerfData}\u4E2A\u6D3B\u8DC3Campaign\u65E0\u7EE9\u6548\u6570\u636E`);
    } else if (coverageRate < 0.8 && activeCampaigns > 0) {
      warnings.push(`WARNING: \u7EE9\u6548\u6570\u636E\u8986\u76D6\u7387${(coverageRate * 100).toFixed(1)}%\uFF0C\u5EFA\u8BAE\u68C0\u67E5\u7F3A\u5931\u7684Campaign`);
    }
    if (spendCoverageRate < 0.3 && activeCampaigns > 0) {
      warnings.push(`CRITICAL: \u4EC5${(spendCoverageRate * 100).toFixed(1)}%\u7684Campaign\u6709\u82B1\u8D39\u6570\u636E\uFF0C\u7B97\u6CD5\u65E0\u6CD5\u6709\u6548\u5DE5\u4F5C`);
    }
    if (lastSyncDate) {
      const daysSinceSync = Math.round((Date.now() - new Date(lastSyncDate).getTime()) / 864e5);
      if (daysSinceSync > 3) {
        warnings.push(`WARNING: \u6700\u65B0\u7EE9\u6548\u6570\u636E\u5DF2\u8FC7\u671F${daysSinceSync}\u5929\uFF08\u6700\u540E\u65E5\u671F: ${lastSyncDate}\uFF09`);
      }
    } else if (activeCampaigns > 0) {
      warnings.push(`CRITICAL: \u8BE5\u8D26\u6237\u65E0\u4EFB\u4F55\u7EE9\u6548\u6570\u636E`);
    }
    if (dateGaps.length > 0) {
      warnings.push(`WARNING: \u68C0\u6D4B\u5230${dateGaps.length}\u5904\u65E5\u671F\u65AD\u6863\uFF0C\u53EF\u80FD\u5F71\u54CD\u7B97\u6CD5\u7684\u65F6\u95F4\u5E8F\u5217\u5206\u6790`);
    }
    if (missingCampaigns.length > 0) {
      const topMissing = missingCampaigns.slice(0, 3).map((m) => `${m.campaignName}($${m.dailyBudget}/\u5929)`).join(", ");
      warnings.push(`INFO: ${missingCampaigns.length}\u4E2A\u6709\u9884\u7B97\u7684\u6D3B\u8DC3Campaign\u7F3A\u5C11\u7EE9\u6548\u6570\u636E\uFF0C\u5305\u62EC: ${topMissing}`);
    }
    for (const [typeName, typeData] of Object.entries(coverageByType)) {
      if (typeData.total > 0 && typeData.rate < 0.5) {
        warnings.push(`WARNING: ${typeName}\u7C7B\u578B\u8986\u76D6\u7387\u4EC5${(typeData.rate * 100).toFixed(0)}% (${typeData.withPerf}/${typeData.total})\uFF0C\u53EF\u80FD\u5B58\u5728\u8BE5\u7C7B\u578B\u7684\u540C\u6B65\u95EE\u9898`);
      }
    }
    return {
      accountId,
      totalCampaigns,
      activeCampaigns,
      campaignsWithPerfData,
      campaignsWithSpend,
      coverageRate,
      spendCoverageRate,
      dateGaps,
      missingCampaigns,
      lastSyncDate,
      oldestDataDate,
      totalPerfRecords,
      warnings,
      coverageByType
    };
  } finally {
    conn.release();
  }
}
export async function checkAllAccountsCoverage() {
  const conn = await getDirectConnection();
  try {
    const accountResult = await conn.execute(
      `SELECT DISTINCT c.accountId 
      FROM campaigns c
      INNER JOIN ad_accounts a ON c.accountId = a.id
      WHERE c.campaignStatus = 'enabled' AND (a.status = 'active' OR a.status IS NULL OR a.status = '')
      ORDER BY c.accountId`
    );
    const accountRows = getAllRows(accountResult);
    const accounts = [];
    let healthyCount = 0;
    let warningCount = 0;
    let criticalCount = 0;
    let totalActive = 0;
    let totalWithPerf = 0;
    for (const row of accountRows) {
      try {
        const report = await checkAccountPerformanceCoverage(Number(row.accountId));
        accounts.push(report);
        totalActive += report.activeCampaigns;
        totalWithPerf += report.campaignsWithPerfData;
        const hasCritical = report.warnings.some((w) => w.startsWith("CRITICAL"));
        const hasWarning = report.warnings.some((w) => w.startsWith("WARNING"));
        if (hasCritical) criticalCount++;
        else if (hasWarning) warningCount++;
        else healthyCount++;
      } catch (err) {
        log133.warn(`\u68C0\u67E5\u8D26\u6237${row.accountId}\u8986\u76D6\u7387\u5931\u8D25: ${err.message}`);
      }
    }
    return {
      summary: {
        totalAccounts: accounts.length,
        healthyAccounts: healthyCount,
        warningAccounts: warningCount,
        criticalAccounts: criticalCount,
        overallCoverageRate: totalActive > 0 ? totalWithPerf / totalActive : 0
      },
      accounts
    };
  } finally {
    conn.release();
  }
}
export async function postSyncCoverageCheck(accountId, syncType) {
  try {
    const report = await checkAccountPerformanceCoverage(accountId);
    if (report.warnings.length > 0) {
      log133.warn(`[PostSync] \u8D26\u6237${accountId} ${syncType}\u540C\u6B65\u540E\u8986\u76D6\u7387\u68C0\u67E5:`, {
        coverageRate: `${(report.coverageRate * 100).toFixed(1)}%`,
        spendCoverageRate: `${(report.spendCoverageRate * 100).toFixed(1)}%`,
        activeCampaigns: report.activeCampaigns,
        withPerfData: report.campaignsWithPerfData,
        withSpend: report.campaignsWithSpend,
        coverageByType: report.coverageByType,
        warnings: report.warnings
      });
    } else {
      log133.info(`[PostSync] \u8D26\u6237${accountId} ${syncType}\u540C\u6B65\u540E\u8986\u76D6\u7387\u6B63\u5E38: ${(report.coverageRate * 100).toFixed(1)}% (${report.campaignsWithPerfData}/${report.activeCampaigns})`);
    }
  } catch (err) {
    log133.warn(`[PostSync] \u8D26\u6237${accountId}\u8986\u76D6\u7387\u68C0\u67E5\u5931\u8D25: ${err.message}`);
  }
}
var log133;
