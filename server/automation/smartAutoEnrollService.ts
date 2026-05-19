// @ts-nocheck
/**
 * server/automation/smartAutoEnrollService.ts
 * 
 * Auto-converted from production bundle to TypeScript source.
 * Version: v621147 (production)
 */

import { campaigns, dailyPerformance, adAccounts } from '../../drizzle/schema';
import { getDb } from '../db';
import { sql, eq, and, desc, isNull } from 'drizzle-orm';

export async function autoEnrollAccount(accountId, dryRun = false) {
  const db_instance = await getDb();
  if (!db_instance) {
    return { accountId, status: "error", message: "\u6570\u636E\u5E93\u8FDE\u63A5\u4E0D\u53EF\u7528" };
  }
  try {
    const existingGroups = await db_instance.select({ id: performanceGroups.id }).from(performanceGroups).where(eq(performanceGroups.accountId, accountId));
    if (existingGroups.length > 0) {
      const unmanagedHighSpend = await findUnmanagedHighSpendCampaigns(db_instance, accountId);
      if (unmanagedHighSpend.length === 0) {
        return { accountId, status: "already_managed", message: `\u5DF2\u6709${existingGroups.length}\u4E2A\u4F18\u5316\u76EE\u6807\uFF0C\u65E0\u9700\u81EA\u52A8\u7EB3\u7BA1` };
      }
      if (!dryRun) {
        const targetGroupId = existingGroups[0].id;
        const toEnroll = unmanagedHighSpend.slice(0, AUTO_ENROLL_CONFIG.maxCampaignsPerAutoGroup);
        for (const camp of toEnroll) {
          await db_instance.update(campaigns).set({ performanceGroupId: targetGroupId }).where(eq(campaigns.id, camp.id));
        }
        log131.info(`[fix24] \u8D26\u6237${accountId}: \u5C06${toEnroll.length}\u4E2A\u672A\u7EB3\u7BA1\u9AD8\u82B1\u8D39Campaign\u5206\u914D\u5230PG#${targetGroupId}`);
        return {
          accountId,
          status: "enrolled",
          message: `\u5C06${toEnroll.length}\u4E2A\u672A\u7EB3\u7BA1\u9AD8\u82B1\u8D39Campaign\u5206\u914D\u5230\u5DF2\u6709PG#${targetGroupId}`,
          performanceGroupId: targetGroupId,
          enrolledCampaignCount: toEnroll.length,
          totalActiveCampaigns: unmanagedHighSpend.length
        };
      } else {
        return {
          accountId,
          status: "enrolled",
          message: `[DRY RUN] \u5C06${unmanagedHighSpend.length}\u4E2A\u672A\u7EB3\u7BA1\u9AD8\u82B1\u8D39Campaign\u5206\u914D\u5230\u5DF2\u6709PG#${existingGroups[0].id}`,
          enrolledCampaignCount: unmanagedHighSpend.length
        };
      }
    }
    const activeCampaigns = await db_instance.select({
      id: campaigns.id,
      campaignId: campaigns.campaignId,
      campaignName: campaigns.campaignName,
      campaignType: campaigns.campaignType
    }).from(campaigns).where(and(
      eq(campaigns.accountId, accountId),
      eq(campaigns.campaignStatus, "enabled")
    ));
    if (activeCampaigns.length === 0) {
      return { accountId, status: "no_active_campaigns", message: "\u6CA1\u6709\u6D3B\u8DC3\u7684\u5E7F\u544A\u6D3B\u52A8" };
    }
    const highSpendCampaigns = await findUnmanagedHighSpendCampaigns(db_instance, accountId);
    if (highSpendCampaigns.length === 0) {
      return {
        accountId,
        status: "skipped",
        message: `\u6709${activeCampaigns.length}\u4E2A\u6D3B\u8DC3Campaign\uFF0C\u4F46\u65E5\u5747\u82B1\u8D39\u5747\u4F4E\u4E8E$${AUTO_ENROLL_CONFIG.minDailySpendUSD}`,
        totalActiveCampaigns: activeCampaigns.length
      };
    }
    if (dryRun) {
      const typeGroups = groupCampaignsByType(highSpendCampaigns);
      const groupInfo = Object.entries(typeGroups).map(
        ([type, camps]) => `${AUTO_ENROLL_CONFIG.typeNameMap[type] || type}: ${camps.length}\u4E2A`
      ).join(", ");
      return {
        accountId,
        status: "enrolled",
        message: `[DRY RUN] \u5C06\u521B\u5EFA${Object.keys(typeGroups).length}\u4E2APG\u5E76\u7EB3\u7BA1${highSpendCampaigns.length}\u4E2ACampaign (${groupInfo})`,
        enrolledCampaignCount: highSpendCampaigns.length,
        totalActiveCampaigns: activeCampaigns.length,
        groupsCreated: Object.keys(typeGroups).length
      };
    }
    if (AUTO_ENROLL_CONFIG.groupByType) {
      return await createGroupedPGs(db_instance, accountId, highSpendCampaigns, activeCampaigns.length);
    }
    return await createSinglePG(db_instance, accountId, highSpendCampaigns, activeCampaigns.length);
  } catch (error48) {
    log131.warn(`[fix24] \u8D26\u6237${accountId}\u81EA\u52A8\u7EB3\u7BA1\u5931\u8D25: ${error48.message}`);
    return { accountId, status: "error", message: error48.message };
  }
}
async function createGroupedPGs(db_instance, accountId, highSpendCampaigns, totalActiveCampaigns) {
  const typeGroups = groupCampaignsByType(highSpendCampaigns);
  const enrollmentDetails = [];
  let totalEnrolled = 0;
  let firstGroupId;
  for (const [campaignType, typeCampaigns] of Object.entries(typeGroups)) {
    const typeName = AUTO_ENROLL_CONFIG.typeNameMap[campaignType] || campaignType;
    const groupName = `${AUTO_ENROLL_CONFIG.autoGroupNamePrefix}${typeName} ACOS ${AUTO_ENROLL_CONFIG.defaultTargetAcos}%`;
    const [newGroup] = await db_instance.insert(performanceGroups).values({
      userId: 1,
      accountId,
      name: groupName,
      description: `fix24\u81EA\u52A8\u7EB3\u7BA1\uFF1A${typeName}\u7C7B\u578BCampaign\u7684\u4F18\u5316\u76EE\u6807\uFF08\u7CFB\u7EDF\u81EA\u52A8\u521B\u5EFA\uFF09`,
      optimizationGoal: AUTO_ENROLL_CONFIG.defaultOptimizationGoal,
      targetAcos: AUTO_ENROLL_CONFIG.defaultTargetAcos
    });
    const newGroupId = newGroup?.insertId || newGroup?.id;
    if (!newGroupId) {
      log131.warn(`[fix24-patch] \u8D26\u6237${accountId}: \u521B\u5EFA${typeName}\u7C7B\u578BPG\u5931\u8D25`);
      continue;
    }
    if (!firstGroupId) firstGroupId = newGroupId;
    const toEnroll = typeCampaigns.slice(0, AUTO_ENROLL_CONFIG.maxCampaignsPerAutoGroup);
    for (const camp of toEnroll) {
      await db_instance.update(campaigns).set({ performanceGroupId: newGroupId }).where(eq(campaigns.id, camp.id));
    }
    enrollmentDetails.push({ type: typeName, pgId: newGroupId, count: toEnroll.length });
    totalEnrolled += toEnroll.length;
    log131.info(`[fix24-patch] \u8D26\u6237${accountId}: \u521B\u5EFAPG#${newGroupId}(${groupName})\uFF0C\u7EB3\u7BA1${toEnroll.length}\u4E2A${typeName}Campaign`);
  }
  const detailStr = enrollmentDetails.map((d) => `${d.type}:${d.count}\u4E2A\u2192PG#${d.pgId}`).join(", ");
  return {
    accountId,
    status: "enrolled",
    message: `\u6309\u7C7B\u578B\u521B\u5EFA${enrollmentDetails.length}\u4E2APG\uFF0C\u5171\u7EB3\u7BA1${totalEnrolled}\u4E2ACampaign (${detailStr})`,
    performanceGroupId: firstGroupId,
    enrolledCampaignCount: totalEnrolled,
    totalActiveCampaigns,
    groupsCreated: enrollmentDetails.length,
    enrollmentDetails
  };
}
async function createSinglePG(db_instance, accountId, highSpendCampaigns, totalActiveCampaigns) {
  const groupName = `${AUTO_ENROLL_CONFIG.autoGroupNamePrefix}ACOS ${AUTO_ENROLL_CONFIG.defaultTargetAcos}%`;
  const [newGroup] = await db_instance.insert(performanceGroups).values({
    userId: 1,
    accountId,
    name: groupName,
    description: "fix24\u81EA\u52A8\u7EB3\u7BA1\uFF1A\u7CFB\u7EDF\u6839\u636E\u82B1\u8D39\u6570\u636E\u81EA\u52A8\u521B\u5EFA\u7684\u4F18\u5316\u76EE\u6807",
    optimizationGoal: AUTO_ENROLL_CONFIG.defaultOptimizationGoal,
    targetAcos: AUTO_ENROLL_CONFIG.defaultTargetAcos
  });
  const newGroupId = newGroup?.insertId || newGroup?.id;
  if (!newGroupId) {
    return { accountId, status: "error", message: "\u521B\u5EFAPerformance Group\u5931\u8D25\uFF1A\u65E0\u6CD5\u83B7\u53D6ID" };
  }
  const toEnroll = highSpendCampaigns.slice(0, AUTO_ENROLL_CONFIG.maxCampaignsPerAutoGroup);
  for (const camp of toEnroll) {
    await db_instance.update(campaigns).set({ performanceGroupId: newGroupId }).where(eq(campaigns.id, camp.id));
  }
  log131.info(`[fix24] \u8D26\u6237${accountId}: \u81EA\u52A8\u521B\u5EFAPG#${newGroupId}(${groupName})\uFF0C\u7EB3\u7BA1${toEnroll.length}/${totalActiveCampaigns}\u4E2ACampaign`);
  return {
    accountId,
    status: "enrolled",
    message: `\u81EA\u52A8\u521B\u5EFAPG#${newGroupId}(${groupName})\uFF0C\u7EB3\u7BA1${toEnroll.length}\u4E2ACampaign`,
    performanceGroupId: newGroupId,
    enrolledCampaignCount: toEnroll.length,
    totalActiveCampaigns
  };
}
function groupCampaignsByType(campaigns6) {
  const groups = {};
  for (const camp of campaigns6) {
    const type = camp.campaignType || "sp_manual";
    if (!groups[type]) groups[type] = [];
    groups[type].push(camp);
  }
  return groups;
}
async function findUnmanagedHighSpendCampaigns(db_instance, accountId) {
  const daysAgo = /* @__PURE__ */ new Date();
  daysAgo.setDate(daysAgo.getDate() - AUTO_ENROLL_CONFIG.spendAnalysisDays);
  const dateStr = daysAgo.toISOString().split("T")[0];
  const result = await db_instance.select({
    id: campaigns.id,
    campaignId: campaigns.campaignId,
    campaignName: campaigns.campaignName,
    campaignType: campaigns.campaignType,
    avgDailySpend: sql`COALESCE(SUM(${dailyPerformance.spend}) / ${AUTO_ENROLL_CONFIG.spendAnalysisDays}, 0)`
  }).from(campaigns).leftJoin(dailyPerformance, and(
    eq(dailyPerformance.campaignId, campaigns.campaignId),
    eq(dailyPerformance.accountId, campaigns.accountId),
    sql`DATE(${dailyPerformance.date}) >= ${dateStr}`
  )).where(and(
    eq(campaigns.accountId, accountId),
    eq(campaigns.campaignStatus, "enabled"),
    isNull(campaigns.performanceGroupId)
  )).groupBy(campaigns.id, campaigns.campaignId, campaigns.campaignName, campaigns.campaignType).having(sql`COALESCE(SUM(${dailyPerformance.spend}) / ${AUTO_ENROLL_CONFIG.spendAnalysisDays}, 0) >= ${AUTO_ENROLL_CONFIG.minDailySpendUSD}`).orderBy(desc(sql`COALESCE(SUM(${dailyPerformance.spend}), 0)`)).limit(AUTO_ENROLL_CONFIG.maxCampaignsPerAutoGroup);
  return result.map((r) => ({
    id: r.id,
    campaignId: r.campaignId,
    campaignName: r.campaignName,
    campaignType: r.campaignType || "sp_manual",
    avgDailySpend: parseFloat(r.avgDailySpend) || 0
  }));
}
export async function scanAndAutoEnrollAll(dryRun = false) {
  const db_instance = await getDb();
  if (!db_instance) {
    return {
      scanTime: (/* @__PURE__ */ new Date()).toISOString(),
      totalAccountsScanned: 0,
      accountsEnrolled: 0,
      accountsSkipped: 0,
      accountsAlreadyManaged: 0,
      accountsNoActiveCampaigns: 0,
      accountsError: 0,
      totalCampaignsEnrolled: 0,
      results: []
    };
  }
  const { adAccounts: adAccounts3 } = await Promise.resolve().then(() => (init_schema2(), schema_exports));
  const accounts = await db_instance.select({
    id: adAccounts3.id,
    accountName: adAccounts3.accountName
  }).from(adAccounts3).where(and(eq(adAccounts3.status, "active"), eq(adAccounts3.connectionStatus, "connected")));
  log131.info(`[fix24] [v620-fix12] \u5F00\u59CB\u81EA\u52A8\u7EB3\u7BA1\u626B\u63CF: ${accounts.length}\u4E2A\u5DF2\u6388\u6743\u6D3B\u8DC3\u8D26\u6237, dryRun=${dryRun}`);
  const results = [];
  for (const account of accounts) {
    const result = await autoEnrollAccount(account.id, dryRun);
    result.accountName = account.accountName || void 0;
    results.push(result);
  }
  const summary = {
    scanTime: (/* @__PURE__ */ new Date()).toISOString(),
    totalAccountsScanned: accounts.length,
    accountsEnrolled: results.filter((r) => r.status === "enrolled").length,
    accountsSkipped: results.filter((r) => r.status === "skipped").length,
    accountsAlreadyManaged: results.filter((r) => r.status === "already_managed").length,
    accountsNoActiveCampaigns: results.filter((r) => r.status === "no_active_campaigns").length,
    accountsError: results.filter((r) => r.status === "error").length,
    totalCampaignsEnrolled: results.reduce((sum2, r) => sum2 + (r.enrolledCampaignCount || 0), 0),
    results
  };
  log131.info(`[fix24] \u81EA\u52A8\u7EB3\u7BA1\u626B\u63CF\u5B8C\u6210: \u626B\u63CF${summary.totalAccountsScanned}\u4E2A\u8D26\u6237, \u7EB3\u7BA1${summary.accountsEnrolled}\u4E2A, \u8DF3\u8FC7${summary.accountsSkipped}\u4E2A, \u5DF2\u7BA1\u7406${summary.accountsAlreadyManaged}\u4E2A`);
  return summary;
}
export async function postSyncAutoEnrollCheck(accountId, syncType) {
  try {
    if (syncType !== "full" && syncType !== "nightly") return;
    const result = await autoEnrollAccount(accountId, false);
    if (result.status === "enrolled") {
      log131.info(`[fix24-patch] [PostSync] \u8D26\u6237${accountId}\u81EA\u52A8\u7EB3\u7BA1\u6210\u529F: ${result.message}`);
    } else if (result.status === "skipped") {
      log131.debug(`[fix24-patch] [PostSync] \u8D26\u6237${accountId}\u8DF3\u8FC7\u7EB3\u7BA1: ${result.message}`);
    }
  } catch (err) {
    log131.warn(`[fix24-patch] [PostSync] \u8D26\u6237${accountId}\u81EA\u52A8\u7EB3\u7BA1\u68C0\u67E5\u5931\u8D25: ${err.message}`);
  }
}
var log131, AUTO_ENROLL_CONFIG;
