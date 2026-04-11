// Extracted from production dist/index.js
// Original module: server/system/apiSecurityService.ts
// Lines: 263

async function getOperationLogs(params) {
  const db = await getDb();
  if (!db) return { logs: [], total: 0 };
  try {
    const conditions = [];
    if (params.userId) {
      conditions.push(eq(apiOperationLogs.userId, params.userId));
    }
    if (params.accountId) {
      conditions.push(eq(apiOperationLogs.accountId, params.accountId));
    }
    if (params.operationType) {
      conditions.push(eq(apiOperationLogs.operationType, params.operationType));
    }
    if (params.status) {
      conditions.push(eq(apiOperationLogs.status, params.status));
    }
    if (params.riskLevel) {
      conditions.push(eq(apiOperationLogs.riskLevel, params.riskLevel));
    }
    if (params.startDate) {
      conditions.push(gte(apiOperationLogs.executedAt, params.startDate));
    }
    if (params.endDate) {
      conditions.push(lte(apiOperationLogs.executedAt, params.endDate));
    }
    const whereClause = conditions.length > 0 ? and(...conditions) : void 0;
    const logs = await db.select().from(apiOperationLogs).where(whereClause).orderBy(desc(apiOperationLogs.createdAt)).limit(params.limit || 50).offset(params.offset || 0);
    const countResult = await db.select({ count: sql`COUNT(*)` }).from(apiOperationLogs).where(whereClause);
    return {
      logs,
      total: countResult[0]?.count || 0
    };
  } catch (error48) {
    log190.warn("[ApiSecurity] Failed to get operation logs:", error48);
    return { logs: [], total: 0 };
  }
}
async function upsertSpendLimitConfig(params) {
  const db = await getDb();
  if (!db) return null;
  try {
    const existing = await db.select().from(spendLimitConfigs).where(and(
      eq(spendLimitConfigs.userId, params.userId),
      eq(spendLimitConfigs.accountId, params.accountId)
    )).limit(1);
    if (existing.length > 0) {
      await db.update(spendLimitConfigs).set({
        dailySpendLimit: params.dailySpendLimit.toString(),
        warningThreshold1: (params.warningThreshold1 || 50).toString(),
        warningThreshold2: (params.warningThreshold2 || 80).toString(),
        criticalThreshold: (params.criticalThreshold || 95).toString(),
        autoStopEnabled: params.autoStopEnabled ? 1 : 0,
        autoStopThreshold: (params.autoStopThreshold || 100).toString()
      }).where(eq(spendLimitConfigs.id, existing[0].id));
      return existing[0].id;
    } else {
      const result = await db.insert(spendLimitConfigs).values({
        userId: params.userId,
        accountId: params.accountId,
        dailySpendLimit: params.dailySpendLimit.toString(),
        warningThreshold1: (params.warningThreshold1 || 50).toString(),
        warningThreshold2: (params.warningThreshold2 || 80).toString(),
        criticalThreshold: (params.criticalThreshold || 95).toString(),
        autoStopEnabled: params.autoStopEnabled ? 1 : 0,
        autoStopThreshold: (params.autoStopThreshold || 100).toString()
      });
      return Number(result[0].insertId);
    }
  } catch (error48) {
    log190.warn("[ApiSecurity] Failed to upsert spend limit config:", error48);
    return null;
  }
}
async function getSpendLimitConfig(userId, accountId) {
  const db = await getDb();
  if (!db) return null;
  try {
    const configs = await db.select().from(spendLimitConfigs).where(and(
      eq(spendLimitConfigs.userId, userId),
      eq(spendLimitConfigs.accountId, accountId)
    )).limit(1);
    return configs[0] || null;
  } catch (error48) {
    log190.warn("[ApiSecurity] Failed to get spend limit config:", error48);
    return null;
  }
}
async function getSpendAlertHistory(userId, accountId, limit = 50) {
  const db = await getDb();
  if (!db) return [];
  try {
    const conditions = [eq(spendAlertLogs.userId, userId)];
    if (accountId) {
      conditions.push(eq(spendAlertLogs.accountId, accountId));
    }
    const alerts = await db.select().from(spendAlertLogs).where(and(...conditions)).orderBy(desc(spendAlertLogs.createdAt)).limit(limit);
    return alerts;
  } catch (error48) {
    log190.warn("[ApiSecurity] Failed to get spend alert history:", error48);
    return [];
  }
}
async function createAnomalyRule(params) {
  const db = await getDb();
  if (!db) return null;
  try {
    const anomalyTypeMap = {
      "bid_spike": "bid_spike",
      "bid_drop": "bid_drop",
      "batch_size": "batch_size",
      "budget_change": "budget_change",
      "acos_spike": "acos_spike",
      "spend_velocity": "spend_velocity",
      "conversion_drop": "conversion_drop",
      "frequency": "click_anomaly",
      "custom": "bid_spike"
    };
    const detectionMethodMap = {
      "threshold": "threshold",
      "percentage_change": "percentage_change",
      "absolute_change": "absolute_change",
      "rate_limit": "rate_limit"
    };
    const actionTypeMap = {
      "alert_only": "alert_only",
      "pause_and_alert": "pause_and_alert",
      "rollback_and_alert": "rollback_and_alert",
      "block_operation": "block_operation"
    };
    const result = await db.insert(anomalyDetectionRules).values({
      userId: params.userId,
      accountId: params.accountId || null,
      ruleName: params.ruleName,
      ruleDescription: params.ruleDescription || null,
      anomalyType: anomalyTypeMap[params.ruleType] || "bid_spike",
      detectionMethod: detectionMethodMap[params.conditionType] || "threshold",
      thresholdValue: params.conditionValue.toString(),
      timeWindowMinutes: params.conditionTimeWindow || 60,
      actionType: actionTypeMap[params.actionOnTrigger || "alert_only"] || "alert_only",
      priority: params.priority || 5
    });
    return Number(result[0].insertId);
  } catch (error48) {
    log190.warn("[ApiSecurity] Failed to create anomaly rule:", error48);
    return null;
  }
}
async function getAnomalyRules(userId, accountId) {
  const db = await getDb();
  if (!db) return [];
  try {
    const conditions = [eq(anomalyDetectionRules.userId, userId)];
    if (accountId) {
      conditions.push(eq(anomalyDetectionRules.accountId, accountId));
    }
    const rules = await db.select().from(anomalyDetectionRules).where(and(...conditions)).orderBy(desc(anomalyDetectionRules.priority));
    return rules;
  } catch (error48) {
    log190.warn("[ApiSecurity] Failed to get anomaly rules:", error48);
    return [];
  }
}
async function resumePausedEntities(recordId, userId, resumeReason) {
  const db = await getDb();
  if (!db) return false;
  try {
    await db.update(autoPauseRecords).set({
      isResumed: 1,
      resumedBy: userId,
      resumedAt: (/* @__PURE__ */ new Date()).toISOString(),
      resumeReason
    }).where(eq(autoPauseRecords.id, recordId));
    return true;
  } catch (error48) {
    log190.warn("[ApiSecurity] Failed to resume paused entities:", error48);
    return false;
  }
}
async function getAutoPauseRecords(userId, accountId, includeResumed = false) {
  const db = await getDb();
  if (!db) return [];
  try {
    const conditions = [eq(autoPauseRecords.userId, userId)];
    if (accountId) {
      conditions.push(eq(autoPauseRecords.accountId, accountId));
    }
    if (!includeResumed) {
      conditions.push(eq(autoPauseRecords.isResumed, 0));
    }
    const records = await db.select().from(autoPauseRecords).where(and(...conditions)).orderBy(desc(autoPauseRecords.createdAt));
    return records;
  } catch (error48) {
    log190.warn("[ApiSecurity] Failed to get auto pause records:", error48);
    return [];
  }
}
async function initializeDefaultRules(userId) {
  const defaultRules = [
    {
      ruleName: "\u51FA\u4EF7\u98D9\u5347\u68C0\u6D4B",
      ruleDescription: "\u5F53\u5355\u6B21\u51FA\u4EF7\u8C03\u6574\u8D85\u8FC7200%\u65F6\u89E6\u53D1\u544A\u8B66",
      ruleType: "bid_spike",
      conditionType: "percentage_change",
      conditionValue: 200,
      actionOnTrigger: "alert_only",
      priority: 8
    },
    {
      ruleName: "\u6279\u91CF\u64CD\u4F5C\u6570\u91CF\u68C0\u6D4B",
      ruleDescription: "\u5F53\u5355\u6B21\u6279\u91CF\u64CD\u4F5C\u5F71\u54CD\u8D85\u8FC7100\u4E2A\u76EE\u6807\u65F6\u89E6\u53D1\u544A\u8B66",
      ruleType: "batch_size",
      conditionType: "threshold",
      conditionValue: 100,
      actionOnTrigger: "alert_only",
      priority: 7
    },
    {
      ruleName: "\u9884\u7B97\u5927\u5E45\u53D8\u66F4\u68C0\u6D4B",
      ruleDescription: "\u5F53\u9884\u7B97\u53D8\u66F4\u8D85\u8FC7$500\u65F6\u89E6\u53D1\u544A\u8B66",
      ruleType: "budget_change",
      conditionType: "absolute_change",
      conditionValue: 500,
      actionOnTrigger: "alert_only",
      priority: 6
    },
    {
      ruleName: "ACoS\u5F02\u5E38\u68C0\u6D4B",
      ruleDescription: "\u5F53ACoS\u8D85\u8FC7100%\u65F6\u89E6\u53D1\u544A\u8B66",
      ruleType: "acos_spike",
      conditionType: "threshold",
      conditionValue: 100,
      actionOnTrigger: "alert_only",
      priority: 5
    }
  ];
  for (const rule of defaultRules) {
    await createAnomalyRule({ ...rule, userId });
  }
  log190.info(`[ApiSecurity] Initialized default rules for user ${userId}`);
}
var log190;
var init_apiSecurityService = __esm({
  "server/system/apiSecurityService.ts"() {
    "use strict";
    init_logger();
    init_db2();
    init_schema2();
    init_drizzle_orm();
    init_notification();
    log190 = createModuleLogger("ApiSecurity");
    __name(getOperationLogs, "getOperationLogs");
    __name(upsertSpendLimitConfig, "upsertSpendLimitConfig");
    __name(getSpendLimitConfig, "getSpendLimitConfig");
    __name(getSpendAlertHistory, "getSpendAlertHistory");
    __name(createAnomalyRule, "createAnomalyRule");
    __name(getAnomalyRules, "getAnomalyRules");
    __name(resumePausedEntities, "resumePausedEntities");
    __name(getAutoPauseRecords, "getAutoPauseRecords");
    __name(initializeDefaultRules, "initializeDefaultRules");
  }
});

