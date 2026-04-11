// Extracted from production dist/index.js
// Original module: server/budget/budgetAutoExecutionService.ts
// Lines: 545

var budgetAutoExecutionService_exports = {};
__export(budgetAutoExecutionService_exports, {
  approveExecution: () => approveExecution,
  calculateNextExecutionTime: () => calculateNextExecutionTime,
  calculateNextExecutionTimeForTest: () => calculateNextExecutionTimeForTest,
  checkAndExecutePendingTasks: () => checkAndExecutePendingTasks,
  createAutoExecutionConfig: () => createAutoExecutionConfig,
  deleteAutoExecutionConfig: () => deleteAutoExecutionConfig,
  executeBudgetAllocation: () => executeBudgetAllocation2,
  formatExecutionReport: () => formatExecutionReport,
  generateExecutionSummary: () => generateExecutionSummary,
  getAutoExecutionConfigById: () => getAutoExecutionConfigById,
  getAutoExecutionConfigs: () => getAutoExecutionConfigs,
  getExecutionDetails: () => getExecutionDetails,
  getExecutionHistory: () => getExecutionHistory,
  getPendingExecutions: () => getPendingExecutions,
  shouldExecuteNowExported: () => shouldExecuteNowExported,
  triggerManualExecution: () => triggerManualExecution,
  updateAutoExecutionConfig: () => updateAutoExecutionConfig,
  validateBudgetAdjustment: () => validateBudgetAdjustment
});
async function createAutoExecutionConfig(config2, userId) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const nextExecutionAt = calculateNextExecutionTime(config2);
  const configData = {
    accountId: config2.accountId,
    performanceGroupId: config2.performanceGroupId,
    configName: config2.configName,
    isEnabled: config2.isEnabled ? 1 : 0,
    executionFrequency: config2.executionFrequency,
    executionTime: config2.executionTime || "06:00",
    executionDayOfWeek: config2.executionDayOfWeek,
    executionDayOfMonth: config2.executionDayOfMonth,
    minDataDays: config2.minDataDays || 7,
    maxAdjustmentPercent: String(config2.maxAdjustmentPercent || 15),
    minBudget: String(config2.minBudget || 5),
    requireApproval: config2.requireApproval ? 1 : 0,
    notifyOnExecution: config2.notifyOnExecution !== false ? 1 : 0,
    notifyOnError: config2.notifyOnError !== false ? 1 : 0,
    nextExecutionAt: nextExecutionAt.toISOString().slice(0, 19).replace("T", " "),
    createdBy: userId
  };
  const result = await db.insert(budgetAutoExecutionConfigs).values(configData);
  return result[0].insertId;
}
async function updateAutoExecutionConfig(configId, updates) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const updateData = {};
  if (updates.configName !== void 0) updateData.configName = updates.configName;
  if (updates.isEnabled !== void 0) updateData.isEnabled = updates.isEnabled ? 1 : 0;
  if (updates.executionFrequency !== void 0) updateData.executionFrequency = updates.executionFrequency;
  if (updates.executionTime !== void 0) updateData.executionTime = updates.executionTime;
  if (updates.executionDayOfWeek !== void 0) updateData.executionDayOfWeek = updates.executionDayOfWeek;
  if (updates.executionDayOfMonth !== void 0) updateData.executionDayOfMonth = updates.executionDayOfMonth;
  if (updates.minDataDays !== void 0) updateData.minDataDays = updates.minDataDays;
  if (updates.maxAdjustmentPercent !== void 0) updateData.maxAdjustmentPercent = String(updates.maxAdjustmentPercent);
  if (updates.minBudget !== void 0) updateData.minBudget = String(updates.minBudget);
  if (updates.requireApproval !== void 0) updateData.requireApproval = updates.requireApproval ? 1 : 0;
  if (updates.notifyOnExecution !== void 0) updateData.notifyOnExecution = updates.notifyOnExecution ? 1 : 0;
  if (updates.notifyOnError !== void 0) updateData.notifyOnError = updates.notifyOnError ? 1 : 0;
  if (updates.executionFrequency || updates.executionTime || updates.executionDayOfWeek || updates.executionDayOfMonth) {
    const currentConfig = await getAutoExecutionConfigById(configId);
    if (currentConfig) {
      const mergedConfig = { ...currentConfig, ...updates };
      const nextExecutionAt = calculateNextExecutionTime(mergedConfig);
      updateData.nextExecutionAt = nextExecutionAt.toISOString().slice(0, 19).replace("T", " ");
    }
  }
  await db.update(budgetAutoExecutionConfigs).set(updateData).where(eq(budgetAutoExecutionConfigs.id, configId));
}
async function deleteAutoExecutionConfig(configId) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(budgetAutoExecutionConfigs).where(eq(budgetAutoExecutionConfigs.id, configId));
}
async function getAutoExecutionConfigs(accountId) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(budgetAutoExecutionConfigs).where(eq(budgetAutoExecutionConfigs.accountId, accountId)).orderBy(desc(budgetAutoExecutionConfigs.createdAt));
}
async function getAutoExecutionConfigById(configId) {
  const db = await getDb();
  if (!db) return null;
  const results = await db.select().from(budgetAutoExecutionConfigs).where(eq(budgetAutoExecutionConfigs.id, configId)).limit(1);
  return results[0] || null;
}
function calculateNextExecutionTime(config2) {
  const now = /* @__PURE__ */ new Date();
  const [hours, minutes] = (config2.executionTime || "06:00").split(":").map(Number);
  const next = new Date(now);
  next.setHours(hours, minutes, 0, 0);
  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }
  switch (config2.executionFrequency) {
    case "daily":
      break;
    case "weekly":
      const targetDayOfWeek = config2.executionDayOfWeek ?? 1;
      while (next.getDay() !== targetDayOfWeek) {
        next.setDate(next.getDate() + 1);
      }
      break;
    case "biweekly":
      const biweeklyDay = config2.executionDayOfWeek ?? 1;
      while (next.getDay() !== biweeklyDay) {
        next.setDate(next.getDate() + 1);
      }
      const weekNumber = Math.floor((next.getTime() - new Date(next.getFullYear(), 0, 1).getTime()) / (7 * 24 * 60 * 60 * 1e3));
      if (weekNumber % 2 !== 0) {
        next.setDate(next.getDate() + 7);
      }
      break;
    case "monthly":
      const targetDay = config2.executionDayOfMonth ?? 1;
      next.setDate(targetDay);
      if (next <= now) {
        next.setMonth(next.getMonth() + 1);
      }
      break;
  }
  return next;
}
async function getPendingExecutions() {
  const db = await getDb();
  if (!db) return [];
  const now = (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ");
  return db.select().from(budgetAutoExecutionConfigs).where(and(
    eq(budgetAutoExecutionConfigs.isEnabled, 1),
    lte(budgetAutoExecutionConfigs.nextExecutionAt, now)
  ));
}
async function executeBudgetAllocation2(configId) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const config2 = await getAutoExecutionConfigById(configId);
  if (!config2) throw new Error("\u914D\u7F6E\u4E0D\u5B58\u5728");
  const executionData = {
    configId,
    accountId: config2.accountId,
    performanceGroupId: config2.performanceGroupId || null,
    executionType: "scheduled",
    startedAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " "),
    status: "running"
  };
  const executionResult = await db.insert(budgetAutoExecutionHistory).values(executionData);
  const executionId = executionResult[0].insertId;
  try {
    const suggestions = await generateBudgetAllocationSuggestions(
      config2.performanceGroupId || 0
    );
    const details = [];
    let totalBudgetBefore = 0;
    let totalBudgetAfter = 0;
    let adjustedCampaigns = 0;
    let skippedCampaigns = 0;
    let errorCampaigns = 0;
    const maxAdjustmentPercent = parseFloat(config2.maxAdjustmentPercent || "15");
    const minBudget = parseFloat(config2.minBudget || "5");
    for (const suggestion of suggestions.suggestions) {
      const budgetBefore = suggestion.currentBudget;
      let budgetAfter = suggestion.suggestedBudget;
      const adjustmentPercent = suggestion.adjustmentPercent;
      totalBudgetBefore += budgetBefore;
      if (Math.abs(adjustmentPercent) > maxAdjustmentPercent) {
        const limitedAdjustment = adjustmentPercent > 0 ? maxAdjustmentPercent : -maxAdjustmentPercent;
        budgetAfter = budgetBefore * (1 + limitedAdjustment / 100);
      }
      budgetAfter = Math.max(budgetAfter, minBudget);
      if (Math.abs(budgetAfter - budgetBefore) < 0.01) {
        skippedCampaigns++;
        details.push({
          campaignId: suggestion.campaignId,
          campaignName: suggestion.campaignName,
          budgetBefore,
          budgetAfter: budgetBefore,
          adjustmentPercent: 0,
          status: "skipped",
          reason: "\u8C03\u6574\u5E45\u5EA6\u592A\u5C0F"
        });
        totalBudgetAfter += budgetBefore;
        continue;
      }
      if (suggestion.riskLevel === "high" && !config2.requireApproval) {
        skippedCampaigns++;
        details.push({
          campaignId: suggestion.campaignId,
          campaignName: suggestion.campaignName,
          budgetBefore,
          budgetAfter: budgetBefore,
          adjustmentPercent: 0,
          status: "skipped",
          reason: "\u9AD8\u98CE\u9669\u8C03\u6574\uFF0C\u5DF2\u8DF3\u8FC7"
        });
        totalBudgetAfter += budgetBefore;
        continue;
      }
      try {
        if (!config2.requireApproval) {
          await db.update(campaigns).set({ dailyBudget: String(budgetAfter) }).where(eq(campaigns.id, suggestion.campaignId));
          adjustedCampaigns++;
          details.push({
            campaignId: suggestion.campaignId,
            campaignName: suggestion.campaignName,
            budgetBefore,
            budgetAfter,
            adjustmentPercent: (budgetAfter - budgetBefore) / budgetBefore * 100,
            status: "applied"
          });
          totalBudgetAfter += budgetAfter;
        } else {
          details.push({
            campaignId: suggestion.campaignId,
            campaignName: suggestion.campaignName,
            budgetBefore,
            budgetAfter,
            adjustmentPercent: (budgetAfter - budgetBefore) / budgetBefore * 100,
            status: "skipped",
            reason: "\u7B49\u5F85\u5BA1\u6279"
          });
          totalBudgetAfter += budgetBefore;
          skippedCampaigns++;
        }
      } catch (error48) {
        errorCampaigns++;
        details.push({
          campaignId: suggestion.campaignId,
          campaignName: suggestion.campaignName,
          budgetBefore,
          budgetAfter: budgetBefore,
          adjustmentPercent: 0,
          status: "error",
          reason: error48 instanceof Error ? error48.message : "\u672A\u77E5\u9519\u8BEF"
        });
        totalBudgetAfter += budgetBefore;
      }
      await db.insert(budgetAutoExecutionDetails).values({
        historyId: executionId,
        campaignId: suggestion.campaignId,
        campaignName: suggestion.campaignName,
        previousBudget: String(budgetBefore),
        newBudget: String(details[details.length - 1].status === "applied" ? budgetAfter : budgetBefore),
        budgetBefore: String(budgetBefore),
        budgetAfter: String(details[details.length - 1].status === "applied" ? budgetAfter : budgetBefore),
        budgetChange: String(budgetAfter - budgetBefore),
        changePercent: String(details[details.length - 1].adjustmentPercent),
        changeReason: suggestion.reasons.join("; "),
        // @ts-expect-error - dynamic property access
        performanceScore: String(suggestion.compositeScore || 0),
        // @ts-ignore
        confidence: String(suggestion.confidence || 0),
        apiSyncStatus: "pending"
      });
    }
    const finalStatus = config2.requireApproval ? "pending_approval" : "completed";
    const summary = {
      totalCampaigns: suggestions.suggestions.length,
      adjustedCampaigns,
      skippedCampaigns,
      errorCampaigns,
      totalBudgetBefore,
      totalBudgetAfter
    };
    await db.update(budgetAutoExecutionHistory).set({
      completedAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " "),
      status: finalStatus === "pending_approval" ? "pending" : "completed",
      campaignsAnalyzed: summary.totalCampaigns,
      campaignsAdjusted: summary.adjustedCampaigns,
      totalBudgetBefore: String(summary.totalBudgetBefore),
      totalBudgetAfter: String(summary.totalBudgetAfter),
      totalBudgetChange: String(summary.totalBudgetAfter - summary.totalBudgetBefore),
      executionDetails: JSON.stringify({
        skippedCampaigns: summary.skippedCampaigns,
        errorCampaigns: summary.errorCampaigns
      })
    }).where(eq(budgetAutoExecutionHistory.id, executionId));
    const nextExecutionAt = calculateNextExecutionTime(config2);
    await db.update(budgetAutoExecutionConfigs).set({
      lastExecutionAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " "),
      nextExecutionAt: nextExecutionAt.toISOString().slice(0, 19).replace("T", " ")
    }).where(eq(budgetAutoExecutionConfigs.id, configId));
    if (config2.notifyOnExecution) {
      await notifyOwner({
        title: "\u9884\u7B97\u81EA\u52A8\u5206\u914D\u6267\u884C\u5B8C\u6210",
        content: `\u914D\u7F6E"${config2.configName}"\u5DF2\u6267\u884C\u5B8C\u6210\u3002
\u603B\u8BA1${summary.totalCampaigns}\u4E2A\u5E7F\u544A\u6D3B\u52A8\uFF0C\u5DF2\u8C03\u6574${summary.adjustedCampaigns}\u4E2A\uFF0C\u8DF3\u8FC7${summary.skippedCampaigns}\u4E2A\uFF0C\u9519\u8BEF${summary.errorCampaigns}\u4E2A\u3002
\u9884\u7B97\u53D8\u5316\uFF1A$${summary.totalBudgetBefore.toFixed(2)} \u2192 $${summary.totalBudgetAfter.toFixed(2)}`
      });
    }
    return {
      executionId,
      status: finalStatus,
      summary,
      details
    };
  } catch (error48) {
    await db.update(budgetAutoExecutionHistory).set({
      completedAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " "),
      status: "failed",
      errorMessage: error48 instanceof Error ? error48.message : "\u672A\u77E5\u9519\u8BEF"
    }).where(eq(budgetAutoExecutionHistory.id, executionId));
    if (config2.notifyOnError) {
      await notifyOwner({
        title: "\u9884\u7B97\u81EA\u52A8\u5206\u914D\u6267\u884C\u5931\u8D25",
        content: `\u914D\u7F6E"${config2.configName}"\u6267\u884C\u5931\u8D25\u3002
\u9519\u8BEF\u4FE1\u606F\uFF1A${error48 instanceof Error ? error48.message : "\u672A\u77E5\u9519\u8BEF"}`
      });
    }
    throw error48;
  }
}
async function getExecutionHistory(accountId, limit = 50) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(budgetAutoExecutionHistory).where(eq(budgetAutoExecutionHistory.accountId, accountId)).orderBy(desc(budgetAutoExecutionHistory.startedAt)).limit(limit);
}
async function getExecutionDetails(executionId) {
  const db = await getDb();
  if (!db) return null;
  const executionResults = await db.select().from(budgetAutoExecutionHistory).where(eq(budgetAutoExecutionHistory.id, executionId)).limit(1);
  if (executionResults.length === 0) return null;
  const details = await db.select().from(budgetAutoExecutionDetails).where(eq(budgetAutoExecutionDetails.historyId, executionId));
  return {
    execution: executionResults[0],
    // @ts-expect-error - array method type inference
    details: details.map((d) => ({
      id: d.id,
      campaignId: d.campaignId,
      campaignName: d.campaignName,
      budgetBefore: d.budgetBefore,
      budgetAfter: d.budgetAfter,
      changePercent: d.changePercent,
      changeReason: d.changeReason,
      performanceScore: d.performanceScore,
      confidence: d.confidence,
      apiSyncStatus: d.apiSyncStatus,
      apiSyncDetail: d.apiSyncDetail
    }))
  };
}
async function approveExecution(executionId, userId, approve) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (approve) {
    const executionData = await getExecutionDetails(executionId);
    if (!executionData) throw new Error("\u6267\u884C\u8BB0\u5F55\u4E0D\u5B58\u5728");
    for (const detail of executionData.details) {
      if (detail.apiSyncStatus === "pending" && detail.changeReason?.includes("\u7B49\u5F85\u5BA1\u6279")) {
        await db.update(campaigns).set({ dailyBudget: detail.budgetAfter }).where(eq(campaigns.id, detail.campaignId));
        await db.update(budgetAutoExecutionDetails).set({ apiSyncStatus: "synced" }).where(eq(budgetAutoExecutionDetails.id, detail.id));
      }
    }
    await db.update(budgetAutoExecutionHistory).set({
      // @ts-expect-error - type assertion
      status: "completed"
    }).where(eq(budgetAutoExecutionHistory.id, executionId));
  } else {
    await db.update(budgetAutoExecutionHistory).set({
      // @ts-expect-error - type assertion
      status: "cancelled"
    }).where(eq(budgetAutoExecutionHistory.id, executionId));
  }
}
async function triggerManualExecution(configId) {
  const result = await executeBudgetAllocation2(configId);
  return {
    executionId: result.executionId,
    status: result.status
  };
}
async function checkAndExecutePendingTasks() {
  const pendingConfigs = await getPendingExecutions();
  let executed = 0;
  let failed = 0;
  const errors = [];
  for (const config2 of pendingConfigs) {
    try {
      await executeBudgetAllocation2(config2.id);
      executed++;
    } catch (error48) {
      failed++;
      errors.push(`\u914D\u7F6E${config2.id}\u6267\u884C\u5931\u8D25: ${error48 instanceof Error ? error48.message : "\u672A\u77E5\u9519\u8BEF"}`);
    }
  }
  return { executed, failed, errors };
}
function shouldExecuteNowExported(config2, now = /* @__PURE__ */ new Date(), marketplace = "US") {
  const [targetHour, targetMinute] = config2.executionTime.split(":").map(Number);
  const currentHour = getLocalHour(now, marketplace);
  const currentDayOfWeek = getLocalDayOfWeek(now, marketplace);
  const tz = MARKETPLACE_TIMEZONES2[marketplace] || "America/Los_Angeles";
  const localDateStr = now.toLocaleDateString("en-US", { timeZone: tz });
  const localDate = new Date(localDateStr);
  const currentMinute = parseInt(now.toLocaleString("en-US", { timeZone: tz, minute: "numeric" }));
  const timeMatch = currentHour === targetHour && Math.abs(currentMinute - targetMinute) <= 5;
  if (!timeMatch) return false;
  switch (config2.executionFrequency) {
    case "daily":
      return true;
    case "weekly":
      return currentDayOfWeek === config2.executionDayOfWeek;
    case "biweekly":
      const weekNumber = Math.floor(now.getTime() / (7 * 24 * 60 * 60 * 1e3));
      return currentDayOfWeek === config2.executionDayOfWeek && weekNumber % 2 === 0;
    case "monthly":
      return localDate.getDate() === config2.executionDayOfMonth;
    default:
      return false;
  }
}
function calculateNextExecutionTimeForTest(config2, now = /* @__PURE__ */ new Date()) {
  const [targetHour, targetMinute] = config2.executionTime.split(":").map(Number);
  const next = new Date(now);
  next.setHours(targetHour, targetMinute, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  switch (config2.executionFrequency) {
    case "daily":
      break;
    case "weekly":
      while (next.getDay() !== config2.executionDayOfWeek) {
        next.setDate(next.getDate() + 1);
      }
      break;
    case "biweekly":
      while (next.getDay() !== config2.executionDayOfWeek) {
        next.setDate(next.getDate() + 1);
      }
      const weekNumber = Math.floor(next.getTime() / (7 * 24 * 60 * 60 * 1e3));
      if (weekNumber % 2 !== 0) {
        next.setDate(next.getDate() + 7);
      }
      break;
    case "monthly":
      if (next.getDate() > (config2.executionDayOfMonth || 1)) {
        next.setMonth(next.getMonth() + 1);
      }
      next.setDate(config2.executionDayOfMonth || 1);
      break;
  }
  return next;
}
function validateBudgetAdjustment(adjustment) {
  const { currentBudget, newBudget, minBudget = 5, maxAdjustmentPercent = 20 } = adjustment;
  if (newBudget < minBudget) {
    return { isValid: false, reason: `\u65B0\u9884\u7B97 $${newBudget} \u4F4E\u4E8E\u6700\u5C0F\u9884\u7B97 $${minBudget}` };
  }
  const adjustmentPercent = Math.abs((newBudget - currentBudget) / currentBudget * 100);
  if (adjustmentPercent > maxAdjustmentPercent) {
    return {
      isValid: false,
      reason: `\u8C03\u6574\u5E45\u5EA6 ${adjustmentPercent.toFixed(1)}% \u8D85\u8FC7\u6700\u5927\u8C03\u6574\u5E45\u5EA6 ${maxAdjustmentPercent}%`
    };
  }
  return { isValid: true };
}
function generateExecutionSummary(details) {
  const summary = {
    totalCampaigns: details.length,
    adjustedCampaigns: 0,
    skippedCampaigns: 0,
    errorCampaigns: 0,
    totalBudgetBefore: 0,
    totalBudgetAfter: 0
  };
  for (const detail of details) {
    summary.totalBudgetBefore += detail.budgetBefore;
    summary.totalBudgetAfter += detail.budgetAfter;
    switch (detail.status) {
      case "applied":
        summary.adjustedCampaigns++;
        break;
      case "skipped":
        summary.skippedCampaigns++;
        break;
      case "error":
        summary.errorCampaigns++;
        break;
    }
  }
  return summary;
}
function formatExecutionReport(execution) {
  const statusLabels = {
    completed: "\u6267\u884C\u5B8C\u6210",
    failed: "\u6267\u884C\u5931\u8D25",
    running: "\u6267\u884C\u4E2D",
    pending_approval: "\u5F85\u5BA1\u6279",
    cancelled: "\u5DF2\u53D6\u6D88"
  };
  const budgetChange = execution.totalBudgetAfter - execution.totalBudgetBefore;
  const budgetChangePercent = (budgetChange / execution.totalBudgetBefore * 100).toFixed(2);
  const duration3 = (execution.executionEndAt.getTime() - execution.executionStartAt.getTime()) / 1e3;
  return `
\u9884\u7B97\u81EA\u52A8\u6267\u884C\u62A5\u544A
================
\u72B6\u6001: ${statusLabels[execution.status] || execution.status}
\u6267\u884C\u65F6\u95F4: ${execution.executionStartAt.toLocaleString()} - ${execution.executionEndAt.toLocaleString()}
\u8017\u65F6: ${duration3.toFixed(0)}\u79D2

\u5E7F\u544A\u6D3B\u52A8\u7EDF\u8BA1:
- \u603B\u8BA1: ${execution.totalCampaigns}
- \u5DF2\u8C03\u6574: ${execution.adjustedCampaigns}
- \u5DF2\u8DF3\u8FC7: ${execution.skippedCampaigns}
- \u9519\u8BEF: ${execution.errorCampaigns}

\u9884\u7B97\u53D8\u5316:
- \u8C03\u6574\u524D: $${execution.totalBudgetBefore.toFixed(2)}
- \u8C03\u6574\u540E: $${execution.totalBudgetAfter.toFixed(2)}
- \u53D8\u5316: ${budgetChange >= 0 ? "+" : ""}$${budgetChange.toFixed(2)} (${budgetChangePercent}%)
  `.trim();
}
var init_budgetAutoExecutionService = __esm({
  "server/budget/budgetAutoExecutionService.ts"() {
    "use strict";
    init_db2();
    init_algorithmUtils();
    init_schema2();
    init_drizzle_orm();
    init_intelligentBudgetAllocationService();
    init_notification();
    __name(createAutoExecutionConfig, "createAutoExecutionConfig");
    __name(updateAutoExecutionConfig, "updateAutoExecutionConfig");
    __name(deleteAutoExecutionConfig, "deleteAutoExecutionConfig");
    __name(getAutoExecutionConfigs, "getAutoExecutionConfigs");
    __name(getAutoExecutionConfigById, "getAutoExecutionConfigById");
    __name(calculateNextExecutionTime, "calculateNextExecutionTime");
    __name(getPendingExecutions, "getPendingExecutions");
    __name(executeBudgetAllocation2, "executeBudgetAllocation");
    __name(getExecutionHistory, "getExecutionHistory");
    __name(getExecutionDetails, "getExecutionDetails");
    __name(approveExecution, "approveExecution");
    __name(triggerManualExecution, "triggerManualExecution");
    __name(checkAndExecutePendingTasks, "checkAndExecutePendingTasks");
    __name(shouldExecuteNowExported, "shouldExecuteNowExported");
    __name(calculateNextExecutionTimeForTest, "calculateNextExecutionTimeForTest");
    __name(validateBudgetAdjustment, "validateBudgetAdjustment");
    __name(generateExecutionSummary, "generateExecutionSummary");
    __name(formatExecutionReport, "formatExecutionReport");
  }
});

