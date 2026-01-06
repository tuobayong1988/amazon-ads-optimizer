/**
 * Budget Alert Service - 预算消耗预警服务
 * 监控广告活动预算消耗速度，发送异常预警
 */

import { eq, and, desc, gte, sql } from "drizzle-orm";
import { getDb } from "./db";
import {
  budgetConsumptionAlerts,
  budgetAlertSettings,
  campaigns,
  dailyPerformance,
  InsertBudgetConsumptionAlert,
  InsertBudgetAlertSetting,
} from "../drizzle/schema";
import { notifyOwner } from "./_core/notification";

export type AlertType = "overspending" | "underspending" | "budget_depleted" | "near_depletion";
export type AlertSeverity = "low" | "medium" | "high" | "critical";

interface ConsumptionAnalysis {
  campaignId: number;
  campaignName: string;
  dailyBudget: number;
  currentSpend: number;
  expectedSpend: number;
  spendRate: number;
  projectedDailySpend: number;
  deviationPercent: number;
  hoursElapsed: number;
  alertType: AlertType | null;
  severity: AlertSeverity;
  recommendation: string;
}

const DEFAULT_SETTINGS = {
  overspendingThreshold: 120,
  underspendingThreshold: 50,
  nearDepletionThreshold: 90,
};

export async function getAlertSettings(userId: number, accountId?: number) {
  const db = await getDb();
  if (!db) return null;
  const conditions = [eq(budgetAlertSettings.userId, userId)];
  if (accountId) conditions.push(eq(budgetAlertSettings.accountId, accountId));
  const settings = await db.select().from(budgetAlertSettings).where(and(...conditions)).limit(1);
  return settings[0] || null;
}

export async function saveAlertSettings(userId: number, settings: Partial<InsertBudgetAlertSetting>) {
  const db = await getDb();
  if (!db) return null;
  const existing = await getAlertSettings(userId, settings.accountId ?? undefined);
  if (existing) {
    await db.update(budgetAlertSettings).set({ ...settings, updatedAt: new Date() }).where(eq(budgetAlertSettings.id, existing.id));
    return { ...existing, ...settings };
  } else {
    const result = await db.insert(budgetAlertSettings).values({ userId, ...settings });
    return { id: result[0].insertId, userId, ...settings };
  }
}

export async function analyzeBudgetConsumption(userId: number, accountId?: number): Promise<ConsumptionAnalysis[]> {
  const db = await getDb();
  if (!db) return [];
  const settings = await getAlertSettings(userId, accountId);
  const thresholds = {
    overspending: Number(settings?.overspendingThreshold) || DEFAULT_SETTINGS.overspendingThreshold,
    underspending: Number(settings?.underspendingThreshold) || DEFAULT_SETTINGS.underspendingThreshold,
    nearDepletion: Number(settings?.nearDepletionThreshold) || DEFAULT_SETTINGS.nearDepletionThreshold,
  };
  const conditions = [eq(campaigns.status, "enabled")];
  if (accountId) conditions.push(eq(campaigns.accountId, accountId));
  const activeCampaigns = await db.select().from(campaigns).where(and(...conditions));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const hoursElapsed = Math.max(new Date().getHours(), 1);
  const results: ConsumptionAnalysis[] = [];
  for (const campaign of activeCampaigns) {
    const todayPerformance = await db.select().from(dailyPerformance).where(and(eq(dailyPerformance.campaignId, campaign.id), gte(dailyPerformance.date, today))).limit(1);
    const dailyBudget = Number(campaign.maxBid) * 100 || 100;
    const currentSpend = todayPerformance[0]?.spend ? Number(todayPerformance[0].spend) : 0;
    const expectedSpend = (dailyBudget / 24) * hoursElapsed;
    const spendRate = currentSpend / hoursElapsed;
    const projectedDailySpend = spendRate * 24;
    const deviationPercent = expectedSpend > 0 ? ((currentSpend - expectedSpend) / expectedSpend) * 100 : 0;
    let alertType: AlertType | null = null;
    let severity: AlertSeverity = "low";
    let recommendation = "";
    const consumptionPercent = (currentSpend / dailyBudget) * 100;
    if (consumptionPercent >= 100) {
      alertType = "budget_depleted";
      severity = "critical";
      recommendation = `预算已耗尽，建议增加预算或暂停广告活动以控制成本。`;
    } else if (consumptionPercent >= thresholds.nearDepletion) {
      alertType = "near_depletion";
      severity = "high";
      recommendation = `预算即将耗尽（已消耗${consumptionPercent.toFixed(1)}%），建议关注并准备调整预算。`;
    } else if (deviationPercent >= thresholds.overspending - 100) {
      alertType = "overspending";
      severity = deviationPercent >= 50 ? "high" : "medium";
      recommendation = `消耗速度过快（偏差${deviationPercent.toFixed(1)}%），预计日消耗$${projectedDailySpend.toFixed(2)}，超出预算。建议降低出价或调整投放时段。`;
    } else if (deviationPercent <= -(100 - thresholds.underspending)) {
      alertType = "underspending";
      severity = deviationPercent <= -70 ? "high" : "medium";
      recommendation = `消耗速度过慢（偏差${deviationPercent.toFixed(1)}%），可能错失流量机会。建议检查广告状态、提高出价或扩展关键词。`;
    }
    results.push({ campaignId: campaign.id, campaignName: campaign.campaignName, dailyBudget, currentSpend, expectedSpend, spendRate, projectedDailySpend, deviationPercent, hoursElapsed, alertType, severity, recommendation });
  }
  return results;
}

export async function createBudgetAlert(userId: number, analysis: ConsumptionAnalysis, accountId?: number): Promise<number | null> {
  const db = await getDb();
  if (!db || !analysis.alertType) return null;
  const alertData: InsertBudgetConsumptionAlert = {
    userId, accountId: accountId ?? null, campaignId: analysis.campaignId, alertType: analysis.alertType, severity: analysis.severity,
    dailyBudget: analysis.dailyBudget.toString(), currentSpend: analysis.currentSpend.toString(), expectedSpend: analysis.expectedSpend.toString(),
    spendRate: analysis.spendRate.toString(), projectedDailySpend: analysis.projectedDailySpend.toString(), deviationPercent: analysis.deviationPercent.toString(),
    recommendation: analysis.recommendation,
  };
  const result = await db.insert(budgetConsumptionAlerts).values(alertData);
  return result[0].insertId;
}

export async function runBudgetConsumptionCheck(userId: number, accountId?: number, sendNotifications: boolean = true) {
  const analyses = await analyzeBudgetConsumption(userId, accountId);
  const alertDetails: ConsumptionAnalysis[] = [];
  let alertCount = 0;
  for (const analysis of analyses) {
    if (analysis.alertType) {
      const db = await getDb();
      if (db) {
        const existingAlert = await db.select().from(budgetConsumptionAlerts).where(and(eq(budgetConsumptionAlerts.campaignId, analysis.campaignId), eq(budgetConsumptionAlerts.alertType, analysis.alertType), eq(budgetConsumptionAlerts.status, "active"))).limit(1);
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

async function sendBudgetAlertNotification(analysis: ConsumptionAnalysis) {
  const alertTypeNames: Record<AlertType, string> = { overspending: "预算消耗过快", underspending: "预算消耗过慢", budget_depleted: "预算已耗尽", near_depletion: "预算即将耗尽" };
  const severityEmoji: Record<AlertSeverity, string> = { low: "ℹ️", medium: "⚠️", high: "🔶", critical: "🔴" };
  if (!analysis.alertType) return;
  const title = `${severityEmoji[analysis.severity]} 预算预警: ${alertTypeNames[analysis.alertType]}`;
  const content = `广告活动: ${analysis.campaignName}\n预警类型: ${alertTypeNames[analysis.alertType]}\n严重程度: ${analysis.severity}\n\n当前消耗: $${analysis.currentSpend.toFixed(2)}\n日预算: $${analysis.dailyBudget.toFixed(2)}\n预期消耗: $${analysis.expectedSpend.toFixed(2)}\n偏差: ${analysis.deviationPercent.toFixed(1)}%\n\n建议: ${analysis.recommendation}`;
  await notifyOwner({ title, content });
}

export async function getAlerts(userId: number, options: { accountId?: number; status?: "active" | "acknowledged" | "resolved"; alertType?: AlertType; limit?: number; offset?: number } = {}) {
  const db = await getDb();
  if (!db) return { alerts: [], total: 0 };
  const conditions = [eq(budgetConsumptionAlerts.userId, userId)];
  if (options.accountId) conditions.push(eq(budgetConsumptionAlerts.accountId, options.accountId));
  if (options.status) conditions.push(eq(budgetConsumptionAlerts.status, options.status));
  if (options.alertType) conditions.push(eq(budgetConsumptionAlerts.alertType, options.alertType));
  const alerts = await db.select().from(budgetConsumptionAlerts).where(and(...conditions)).orderBy(desc(budgetConsumptionAlerts.createdAt)).limit(options.limit || 50).offset(options.offset || 0);
  const countResult = await db.select({ count: sql<number>`count(*)` }).from(budgetConsumptionAlerts).where(and(...conditions));
  return { alerts, total: countResult[0]?.count || 0 };
}

export async function acknowledgeAlert(alertId: number, userId: number) {
  const db = await getDb();
  if (!db) return false;
  await db.update(budgetConsumptionAlerts).set({ status: "acknowledged", acknowledgedAt: new Date() }).where(and(eq(budgetConsumptionAlerts.id, alertId), eq(budgetConsumptionAlerts.userId, userId)));
  return true;
}

export async function resolveAlert(alertId: number, userId: number) {
  const db = await getDb();
  if (!db) return false;
  await db.update(budgetConsumptionAlerts).set({ status: "resolved", resolvedAt: new Date() }).where(and(eq(budgetConsumptionAlerts.id, alertId), eq(budgetConsumptionAlerts.userId, userId)));
  return true;
}

export async function getAlertStats(userId: number, accountId?: number) {
  const db = await getDb();
  if (!db) return null;
  const conditions = [eq(budgetConsumptionAlerts.userId, userId)];
  if (accountId) conditions.push(eq(budgetConsumptionAlerts.accountId, accountId));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayConditions = [...conditions, gte(budgetConsumptionAlerts.createdAt, today)];
  const [activeCount, todayCount, byType] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(budgetConsumptionAlerts).where(and(...conditions, eq(budgetConsumptionAlerts.status, "active"))),
    db.select({ count: sql<number>`count(*)` }).from(budgetConsumptionAlerts).where(and(...todayConditions)),
    db.select({ alertType: budgetConsumptionAlerts.alertType, count: sql<number>`count(*)` }).from(budgetConsumptionAlerts).where(and(...conditions)).groupBy(budgetConsumptionAlerts.alertType),
  ]);
  return { activeAlerts: activeCount[0]?.count || 0, todayAlerts: todayCount[0]?.count || 0, byType: byType.reduce((acc, item) => { acc[item.alertType] = item.count; return acc; }, {} as Record<string, number>) };
}
