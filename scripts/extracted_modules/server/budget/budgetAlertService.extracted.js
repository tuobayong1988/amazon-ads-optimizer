// Extracted from production dist/index.js
// Original module: server/budget/budgetAlertService.ts
// Lines: 171

async function getAlertSettings(userId, accountId) {
  const db = await getDb();
  if (!db) return null;
  const conditions = [eq(budgetAlertSettings.userId, userId)];
  if (accountId) conditions.push(eq(budgetAlertSettings.accountId, accountId));
  const settings = await db.select().from(budgetAlertSettings).where(and(...conditions)).limit(1);
  return settings[0] || null;
}
async function saveAlertSettings(userId, settings) {
  const db = await getDb();
  if (!db) return null;
  const existing = await getAlertSettings(userId, settings.accountId ?? void 0);
  if (existing) {
    await db.update(budgetAlertSettings).set({ ...settings, updatedAt: (/* @__PURE__ */ new Date()).toISOString() }).where(eq(budgetAlertSettings.id, existing.id));
    return { ...existing, ...settings };
  } else {
    const result = await db.insert(budgetAlertSettings).values({ userId, ...settings });
    return { id: result[0].insertId, userId, ...settings };
  }
}
async function analyzeBudgetConsumption(userId, accountId) {
  const db = await getDb();
  if (!db) return [];
  const settings = await getAlertSettings(userId, accountId);
  const thresholds = {
    overspending: Number(settings?.overspendingThreshold) || DEFAULT_SETTINGS.overspendingThreshold,
    underspending: Number(settings?.underspendingThreshold) || DEFAULT_SETTINGS.underspendingThreshold,
    nearDepletion: Number(settings?.nearDepletionThreshold) || DEFAULT_SETTINGS.nearDepletionThreshold
  };
  const conditions = [eq(campaigns.campaignStatus, "enabled")];
  if (accountId) conditions.push(eq(campaigns.accountId, accountId));
  const activeCampaigns = await db.select().from(campaigns).where(and(...conditions));
  const today = /* @__PURE__ */ new Date();
  today.setHours(0, 0, 0, 0);
  const marketplace = accountId ? await getAccountMarketplace(accountId) : "US";
  const hoursElapsed = Math.max(getLocalHour(/* @__PURE__ */ new Date(), marketplace), 1);
  const results = [];
  for (const campaign of activeCampaigns) {
    const todayStr = today.toISOString().split("T")[0];
    const todayPerformance = await db.select().from(dailyPerformance).where(and(eq(dailyPerformance.campaignId, String(campaign.campaignId)), sql`${dailyPerformance.date} >= ${todayStr}`, sql`${dailyPerformance.date} < DATE_ADD(${todayStr}, INTERVAL 1 DAY)`)).limit(1);
    const dailyBudget = Number(campaign.maxBid) * 100 || 100;
    const currentSpend = todayPerformance[0]?.spend ? Number(todayPerformance[0].spend) : 0;
    const expectedSpend = dailyBudget / 24 * hoursElapsed;
    const spendRate = currentSpend / hoursElapsed;
    const projectedDailySpend = spendRate * 24;
    const deviationPercent = expectedSpend > 0 ? (currentSpend - expectedSpend) / expectedSpend * 100 : 0;
    let alertType = null;
    let severity = "low";
    let recommendation = "";
    const consumptionPercent = currentSpend / dailyBudget * 100;
    if (consumptionPercent >= 100) {
      alertType = "budget_depleted";
      severity = "critical";
      recommendation = `\u9884\u7B97\u5DF2\u8017\u5C3D\uFF0C\u5EFA\u8BAE\u589E\u52A0\u9884\u7B97\u6216\u6682\u505C\u5E7F\u544A\u6D3B\u52A8\u4EE5\u63A7\u5236\u6210\u672C\u3002`;
    } else if (consumptionPercent >= thresholds.nearDepletion) {
      alertType = "near_depletion";
      severity = "high";
      recommendation = `\u9884\u7B97\u5373\u5C06\u8017\u5C3D\uFF08\u5DF2\u6D88\u8017${consumptionPercent.toFixed(1)}%\uFF09\uFF0C\u5EFA\u8BAE\u5173\u6CE8\u5E76\u51C6\u5907\u8C03\u6574\u9884\u7B97\u3002`;
    } else if (deviationPercent >= thresholds.overspending - 100) {
      alertType = "overspending";
      severity = deviationPercent >= 50 ? "high" : "medium";
      recommendation = `\u6D88\u8017\u901F\u5EA6\u8FC7\u5FEB\uFF08\u504F\u5DEE${deviationPercent.toFixed(1)}%\uFF09\uFF0C\u9884\u8BA1\u65E5\u6D88\u8017$${projectedDailySpend.toFixed(2)}\uFF0C\u8D85\u51FA\u9884\u7B97\u3002\u5EFA\u8BAE\u964D\u4F4E\u51FA\u4EF7\u6216\u8C03\u6574\u6295\u653E\u65F6\u6BB5\u3002`;
    } else if (deviationPercent <= -(100 - thresholds.underspending)) {
      alertType = "underspending";
      severity = deviationPercent <= -70 ? "high" : "medium";
      recommendation = `\u6D88\u8017\u901F\u5EA6\u8FC7\u6162\uFF08\u504F\u5DEE${deviationPercent.toFixed(1)}%\uFF09\uFF0C\u53EF\u80FD\u9519\u5931\u6D41\u91CF\u673A\u4F1A\u3002\u5EFA\u8BAE\u68C0\u67E5\u5E7F\u544A\u72B6\u6001\u3001\u63D0\u9AD8\u51FA\u4EF7\u6216\u6269\u5C55\u5173\u952E\u8BCD\u3002`;
    }
    results.push({ campaignId: campaign.campaignId, campaignName: campaign.campaignName, dailyBudget, currentSpend, expectedSpend, spendRate, projectedDailySpend, deviationPercent, hoursElapsed, alertType, severity, recommendation });
  }
  return results;
}
async function createBudgetAlert(userId, analysis, accountId) {
  const db = await getDb();
  if (!db || !analysis.alertType) return null;
  const alertData = {
    // @ts-ignore
    userId,
    accountId: accountId ?? null,
    campaignId: String(analysis.campaignId),
    alertType: analysis.alertType,
    severity: analysis.severity,
    dailyBudget: analysis.dailyBudget.toString(),
    currentSpend: analysis.currentSpend.toString(),
    expectedSpend: analysis.expectedSpend.toString(),
    spendRate: analysis.spendRate.toString(),
    projectedDailySpend: analysis.projectedDailySpend.toString(),
    deviationPercent: analysis.deviationPercent.toString(),
    recommendation: analysis.recommendation
  };
  const result = await db.insert(budgetConsumptionAlerts).values(alertData);
  return result[0].insertId;
}
async function runBudgetConsumptionCheck(userId, accountId, sendNotifications = true) {
  const analyses = await analyzeBudgetConsumption(userId, accountId);
  const alertDetails = [];
  let alertCount = 0;
  for (const analysis of analyses) {
    if (analysis.alertType) {
      const db = await getDb();
      if (db) {
        const existingAlert = await db.select().from(budgetConsumptionAlerts).where(and(eq(budgetConsumptionAlerts.campaignId, String(analysis.campaignId)), eq(budgetConsumptionAlerts.alertType, analysis.alertType), eq(budgetConsumptionAlerts.status, "active"))).limit(1);
        if (existingAlert.length === 0) {
          await createBudgetAlert(userId, analysis, accountId);
          alertCount++;
          alertDetails.push(analysis);
          if (sendNotifications) await sendBudgetAlertNotification(analysis);
        }
      }
    }
  }
  return { analyzed: analyses.length, alerts: alertCount, alertDetails };
}
async function sendBudgetAlertNotification(analysis) {
  const alertTypeNames = { overspending: "\u9884\u7B97\u6D88\u8017\u8FC7\u5FEB", underspending: "\u9884\u7B97\u6D88\u8017\u8FC7\u6162", budget_depleted: "\u9884\u7B97\u5DF2\u8017\u5C3D", near_depletion: "\u9884\u7B97\u5373\u5C06\u8017\u5C3D" };
  const severityEmoji = { low: "\u2139\uFE0F", medium: "\u26A0\uFE0F", high: "\u{1F536}", critical: "\u{1F534}" };
  if (!analysis.alertType) return;
  const title = `${severityEmoji[analysis.severity]} \u9884\u7B97\u9884\u8B66: ${alertTypeNames[analysis.alertType]}`;
  const content = `\u5E7F\u544A\u6D3B\u52A8: ${analysis.campaignName}
\u9884\u8B66\u7C7B\u578B: ${alertTypeNames[analysis.alertType]}
\u4E25\u91CD\u7A0B\u5EA6: ${analysis.severity}

\u5F53\u524D\u6D88\u8017: $${analysis.currentSpend.toFixed(2)}
\u65E5\u9884\u7B97: $${analysis.dailyBudget.toFixed(2)}
\u9884\u671F\u6D88\u8017: $${analysis.expectedSpend.toFixed(2)}
\u504F\u5DEE: ${analysis.deviationPercent.toFixed(1)}%

\u5EFA\u8BAE: ${analysis.recommendation}`;
  await notifyOwner({ title, content });
}
async function getAlerts(userId, options = {}) {
  const db = await getDb();
  if (!db) return { alerts: [], total: 0 };
  const conditions = [eq(budgetConsumptionAlerts.userId, userId)];
  if (options.accountId) conditions.push(eq(budgetConsumptionAlerts.accountId, options.accountId));
  if (options.status) conditions.push(eq(budgetConsumptionAlerts.status, options.status));
  if (options.alertType) conditions.push(eq(budgetConsumptionAlerts.alertType, options.alertType));
  const alerts = await db.select().from(budgetConsumptionAlerts).where(and(...conditions)).orderBy(desc(budgetConsumptionAlerts.createdAt)).limit(options.limit || 50).offset(options.offset || 0);
  const countResult = await db.select({ count: sql`count(*)` }).from(budgetConsumptionAlerts).where(and(...conditions));
  return { alerts, total: countResult[0]?.count || 0 };
}
async function acknowledgeAlert(alertId, userId) {
  const db = await getDb();
  if (!db) return false;
  await db.update(budgetConsumptionAlerts).set({ status: "acknowledged", acknowledgedAt: (/* @__PURE__ */ new Date()).toISOString() }).where(and(eq(budgetConsumptionAlerts.id, alertId), eq(budgetConsumptionAlerts.userId, userId)));
  return true;
}
var DEFAULT_SETTINGS;
var init_budgetAlertService = __esm({
  "server/budget/budgetAlertService.ts"() {
    "use strict";
    init_drizzle_orm();
    init_db2();
    init_algorithmUtils();
    init_schema2();
    init_notification();
    DEFAULT_SETTINGS = {
      overspendingThreshold: 120,
      underspendingThreshold: 50,
      nearDepletionThreshold: 90
    };
    __name(getAlertSettings, "getAlertSettings");
    __name(saveAlertSettings, "saveAlertSettings");
    __name(analyzeBudgetConsumption, "analyzeBudgetConsumption");
    __name(createBudgetAlert, "createBudgetAlert");
    __name(runBudgetConsumptionCheck, "runBudgetConsumptionCheck");
    __name(sendBudgetAlertNotification, "sendBudgetAlertNotification");
    __name(getAlerts, "getAlerts");
    __name(acknowledgeAlert, "acknowledgeAlert");
  }
});

