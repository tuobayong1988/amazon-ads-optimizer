/**
 * server/services/budgetRulesCoordinator.ts
 * 
 * Auto-converted from production bundle to TypeScript source.
 * Version: v621147 (production)
 */

import { campaignBudgetRules } from '../../drizzle/schema';
import { getDb } from '../db';
import { sql, eq, and } from 'drizzle-orm';

function getPSTTimeInfo() {
  const now = /* @__PURE__ */ new Date();
  const pstOffset = -8 * 60;
  const utcOffset = now.getTimezoneOffset();
  const pstTime = new Date(now.getTime() + (utcOffset + pstOffset) * 60 * 1e3);
  const year3 = pstTime.getFullYear();
  const month = String(pstTime.getMonth() + 1).padStart(2, "0");
  const day2 = String(pstTime.getDate()).padStart(2, "0");
  const date6 = `${year3}${month}${day2}`;
  const dayNames = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
  const dayOfWeekNum = pstTime.getDay();
  return { date: date6, dayOfWeek: dayNames[dayOfWeekNum], dayOfWeekNum };
}
function isScheduleRuleActive(rule) {
  if (rule.ruleStatus !== "ACTIVE") return false;
  const { date: date6, dayOfWeek } = getPSTTimeInfo();
  if (rule.durationStartDate && date6 < rule.durationStartDate) return false;
  if (rule.durationEndDate && date6 > rule.durationEndDate) return false;
  if (rule.recurrenceType === "DAILY" && rule.recurrenceDaysOfWeek) {
    try {
      const days = typeof rule.recurrenceDaysOfWeek === "string" ? JSON.parse(rule.recurrenceDaysOfWeek) : rule.recurrenceDaysOfWeek;
      if (Array.isArray(days) && days.length > 0) {
        if (!days.includes(dayOfWeek)) return false;
      }
    } catch {
    }
  }
  return true;
}
function isPerformanceRulePotentiallyActive(rule) {
  return rule.ruleStatus === "ACTIVE";
}
async function analyzeBudgetRules(accountId, campaignId, apiClient) {
  const defaultResult = {
    hasRules: false,
    activeRuleCount: 0,
    totalRuleCount: 0,
    shouldSkipBudgetAdjustment: false,
    skipReason: "",
    budgetAdjustmentCap: 1,
    rulesSummary: [],
    dataSource: "local_db"
  };
  try {
    const database = await getDb();
    if (!database) return defaultResult;
    const localRules = await database.select().from(campaignBudgetRules).where(
      and(
        eq(campaignBudgetRules.accountId, accountId),
        // campaign_budget_rules.associated_campaign_ids 是JSON数组，包含campaignId
        sql`JSON_CONTAINS(${campaignBudgetRules.associatedCampaignIds}, JSON_QUOTE(${campaignId}))`
      )
    );
    if (localRules.length > 0) {
      return analyzeRulesFromDB(localRules, "local_db");
    }
    if (apiClient) {
      try {
        const apiRules = await apiClient.listSpCampaignBudgetRules(campaignId);
        if (apiRules && apiRules.length > 0) {
          return analyzeRulesFromAPI(apiRules, campaignId);
        }
      } catch (apiErr) {
        log39.debug(`v614i-fix22: API\u67E5\u8BE2Budget Rules\u5931\u8D25(campaign ${campaignId}): ${apiErr.message}`);
      }
    }
    return defaultResult;
  } catch (err) {
    log39.warn(`v614i-fix22: analyzeBudgetRules\u5931\u8D25(account ${accountId}, campaign ${campaignId}): ${err.message}`);
    return defaultResult;
  }
}
function analyzeRulesFromDB(rules, dataSource) {
  const rulesSummary = [];
  let activeScheduleRules = 0;
  let activePerformanceRules = 0;
  let maxBudgetIncrease = 0;
  for (const rule of rules) {
    const ruleType = rule.ruleType || "SCHEDULE";
    const ruleStatus = rule.ruleStatus || "ACTIVE";
    const budgetIncreaseValue = parseFloat(String(rule.budgetIncreaseValue || "0"));
    let isActive = false;
    let description = "";
    if (ruleType === "SCHEDULE") {
      isActive = isScheduleRuleActive({
        ruleStatus,
        durationStartDate: rule.durationStartDate,
        durationEndDate: rule.durationEndDate,
        recurrenceType: rule.recurrenceType,
        recurrenceDaysOfWeek: rule.recurrenceDaysOfWeek
      });
      if (isActive) {
        activeScheduleRules++;
        maxBudgetIncrease = Math.max(maxBudgetIncrease, budgetIncreaseValue);
      }
      const startDate = rule.durationStartDate || "\u672A\u8BBE\u7F6E";
      const endDate = rule.durationEndDate || "\u672A\u8BBE\u7F6E";
      description = `\u65E5\u7A0B\u89C4\u5219: ${startDate}-${endDate}, \u9884\u7B97\u589E\u52A0${budgetIncreaseValue}%`;
      if (rule.eventName) description += ` (\u4E8B\u4EF6: ${rule.eventName})`;
    } else if (ruleType === "PERFORMANCE") {
      isActive = isPerformanceRulePotentiallyActive({ ruleStatus });
      if (isActive) {
        activePerformanceRules++;
        maxBudgetIncrease = Math.max(maxBudgetIncrease, budgetIncreaseValue);
      }
      const metric = rule.performanceMetricName || "\u672A\u77E5";
      const op = rule.performanceComparisonOperator || ">=";
      const threshold = rule.performanceThreshold || "0";
      description = `\u7EE9\u6548\u89C4\u5219: ${metric} ${op} ${threshold}, \u9884\u7B97\u589E\u52A0${budgetIncreaseValue}%`;
    }
    rulesSummary.push({
      ruleId: String(rule.ruleId || ""),
      ruleType,
      ruleStatus,
      isCurrentlyActive: isActive,
      budgetIncreasePercent: budgetIncreaseValue,
      description
    });
  }
  const totalActiveRules = activeScheduleRules + activePerformanceRules;
  let shouldSkip = false;
  let skipReason = "";
  let budgetAdjustmentCap = 1;
  if (activeScheduleRules > 0) {
    shouldSkip = true;
    skipReason = `${activeScheduleRules}\u6761\u65E5\u7A0B\u89C4\u5219\u5F53\u524D\u6D3B\u8DC3(\u6700\u5927\u589E\u5E45${maxBudgetIncrease}%)\uFF0CAmazon\u6B63\u5728\u81EA\u52A8\u7BA1\u7406\u9884\u7B97`;
  } else if (activePerformanceRules > 0) {
    shouldSkip = false;
    const safeIncreaseRoom = Math.max(0, 100 - maxBudgetIncrease);
    budgetAdjustmentCap = 1 + safeIncreaseRoom / 100;
    if (budgetAdjustmentCap < 1.05) {
      shouldSkip = true;
      skipReason = `${activePerformanceRules}\u6761\u7EE9\u6548\u89C4\u5219\u53EF\u80FD\u6D3B\u8DC3(\u6700\u5927\u589E\u5E45${maxBudgetIncrease}%)\uFF0C\u8C03\u6574\u7A7A\u95F4\u4E0D\u8DB3`;
    } else {
      skipReason = `${activePerformanceRules}\u6761\u7EE9\u6548\u89C4\u5219\u53EF\u80FD\u6D3B\u8DC3\uFF0C\u9884\u7B97\u8C03\u6574\u4E0A\u9650\u4E3A${(budgetAdjustmentCap * 100).toFixed(0)}%`;
    }
  }
  return {
    hasRules: rules.length > 0,
    activeRuleCount: totalActiveRules,
    totalRuleCount: rules.length,
    shouldSkipBudgetAdjustment: shouldSkip,
    skipReason,
    budgetAdjustmentCap,
    rulesSummary,
    dataSource
  };
}
function analyzeRulesFromAPI(apiRules, campaignId) {
  const normalizedRules = apiRules.map((rule) => ({
    ruleId: String(rule.ruleId || rule.budgetRuleId || ""),
    ruleType: String(rule.ruleType || "SCHEDULE"),
    ruleStatus: String(rule.ruleStatus || rule.ruleState || "ACTIVE"),
    budgetIncreaseValue: String(rule.budgetIncreaseBy?.value || rule.budget?.percentageAdjust || "0"),
    durationStartDate: rule.duration?.dateRange ? String(rule.duration.dateRange?.startDate || "") : null,
    durationEndDate: rule.duration?.dateRange ? String(rule.duration.dateRange?.endDate || "") : null,
    recurrenceType: rule.recurrence?.type || null,
    recurrenceDaysOfWeek: rule.recurrence?.daysOfWeek || null,
    performanceMetricName: rule.performanceMeasureCondition?.metricName || null,
    performanceComparisonOperator: rule.performanceMeasureCondition?.comparisonOperator || null,
    performanceThreshold: rule.performanceMeasureCondition?.threshold || null,
    eventName: rule.duration?.eventTypeFilter ? String(rule.duration.eventTypeFilter?.eventName || "") : null
  }));
  return analyzeRulesFromDB(normalizedRules, "api_realtime");
}
var log39;
