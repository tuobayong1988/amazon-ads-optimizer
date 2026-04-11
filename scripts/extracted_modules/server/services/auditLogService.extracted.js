// Extracted from production dist/index.js
// Original module: server/services/auditLogService.ts
// Lines: 189

function mapActionToDrizzle(action) {
  const mapping = {
    "account.create": "account_create",
    "account.delete": "account_delete",
    "account.update": "account_update",
    "account.credentials_update": "account_update",
    "campaign.pause": "campaign_pause",
    "campaign.enable": "campaign_enable",
    "campaign.budget_change": "campaign_update",
    "keyword.bid_change": "bid_adjust_single",
    "keyword.pause": "campaign_pause",
    "keyword.enable": "campaign_enable",
    "keyword.create": "other",
    "keyword.delete": "other",
    "negative_keyword.add": "negative_add_single",
    "negative_keyword.remove": "negative_remove",
    "target.create": "other",
    "target.update": "other",
    "target.delete": "other",
    "placement.adjust": "other",
    "sync.manual_trigger": "scheduler_task_run",
    "sync.schedule_update": "scheduler_task_update",
    "sync.full_sync": "scheduler_task_run",
    "optimization.auto_bid": "bid_adjust_single",
    "optimization.auto_budget": "campaign_update",
    "optimization.strategy_change": "automation_config_update",
    "system.config_change": "settings_update",
    "system.migration": "other",
    "system.deploy": "other",
    "user.login": "other",
    "user.logout": "other",
    "user.settings_change": "settings_update",
    "team.invite": "team_member_invite",
    "team.remove": "team_member_remove",
    "team.permission_change": "team_permission_update"
  };
  return mapping[action] || "other";
}
function mapEntityTypeToDrizzle(entityType) {
  if (!entityType) return void 0;
  const mapping = {
    "account": "account",
    "campaign": "campaign",
    "ad_group": "ad_group",
    "keyword": "keyword",
    "product_target": "product_target",
    "performance_group": "performance_group",
    "negative_keyword": "negative_keyword",
    "bid": "bid",
    "automation": "automation",
    "scheduler": "scheduler",
    "team_member": "team_member",
    "team": "team_member",
    "permission": "permission",
    "settings": "settings",
    "data": "data",
    "system": "other"
  };
  return mapping[entityType] || "other";
}
function recordAudit(entry) {
  const timestampedEntry = {
    ...entry,
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  };
  buffer.push(timestampedEntry);
  log40.info(`[AUDIT] ${entry.action} | user=${entry.userId || "system"} | entity=${entry.entityType}:${entry.entityId} | result=${entry.result || "success"}`);
  if (buffer.length >= BUFFER_SIZE) {
    flushBuffer().catch((err) => {
      log40.warn(`[AuditLog] \u5237\u65B0\u7F13\u51B2\u533A\u5931\u8D25: ${err.message}`);
    });
  }
  if (!flushTimer) {
    flushTimer = setInterval(() => {
      flushBuffer().catch((err) => {
        log40.warn(`[AuditLog] \u5B9A\u65F6\u5237\u65B0\u5931\u8D25: ${err.message}`);
      });
    }, FLUSH_INTERVAL_MS);
  }
}
async function flushBuffer() {
  if (buffer.length === 0) return;
  const entries = [...buffer];
  buffer = [];
  try {
    const db = await getDb();
    if (!db) {
      log40.warn(`[AuditLog] \u6570\u636E\u5E93\u4E0D\u53EF\u7528\uFF0C${entries.length}\u6761\u5BA1\u8BA1\u65E5\u5FD7\u5C06\u4E22\u5931`);
      return;
    }
    for (const e of entries) {
      try {
        const drizzleActionType = mapActionToDrizzle(e.action);
        const drizzleTargetType = mapEntityTypeToDrizzle(e.entityType);
        const drizzleStatus = e.result === "failure" ? "failed" : e.result === "partial" ? "partial" : "success";
        const description = e.metadata?.description ? String(e.metadata.description) : `${e.action}: ${e.entityType || ""}${e.entityId ? "#" + e.entityId : ""}`;
        await db.insert(auditLogs).values({
          actionType: drizzleActionType,
          userId: e.userId || 0,
          // v454: 系统操作使用userId=0
          userName: e.userName || "system",
          accountId: e.accountId || 0,
          // v454: 系统操作使用accountId=0
          targetType: drizzleTargetType || null,
          targetId: e.entityId != null ? String(e.entityId) : null,
          targetName: e.entityName || null,
          description,
          previousValue: e.previousValue ? typeof e.previousValue === "string" ? e.previousValue : JSON.stringify(e.previousValue) : null,
          newValue: e.newValue ? typeof e.newValue === "string" ? e.newValue : JSON.stringify(e.newValue) : null,
          metadata: e.metadata ? JSON.stringify(e.metadata) : null,
          ipAddress: e.ipAddress || null,
          status: drizzleStatus,
          errorMessage: e.errorMessage || null
        });
      } catch (insertErr) {
        log40.warn(`[AuditLog] \u5355\u6761\u5BA1\u8BA1\u65E5\u5FD7\u5199\u5165\u5931\u8D25: ${insertErr.message} | action=${e.action}`);
      }
    }
    log40.debug(`[AuditLog] \u5DF2\u5199\u5165${entries.length}\u6761\u5BA1\u8BA1\u65E5\u5FD7`);
  } catch (err) {
    log40.warn(`[AuditLog] \u5199\u5165\u5BA1\u8BA1\u65E5\u5FD7\u5931\u8D25: ${err.message}`);
    buffer = [...entries.slice(-Math.floor(BUFFER_SIZE / 2)), ...buffer].slice(0, BUFFER_SIZE);
  }
}
function auditAccountAction(action, userId, accountId, details) {
  recordAudit({
    action,
    userId,
    accountId,
    entityType: "account",
    entityId: accountId,
    entityName: details?.entityName,
    previousValue: details?.previousValue,
    newValue: details?.newValue,
    source: "api",
    result: "success"
  });
}
function auditBidChange(userId, accountId, keywordId, keywordText, previousBid, newBid, source = "system") {
  recordAudit({
    action: "keyword.bid_change",
    userId,
    accountId,
    entityType: "keyword",
    entityId: keywordId,
    entityName: keywordText,
    previousValue: { bid: previousBid },
    newValue: { bid: newBid },
    source,
    result: "success",
    metadata: {
      changePercent: previousBid > 0 ? ((newBid - previousBid) / previousBid * 100).toFixed(2) : "N/A"
    }
  });
}
function auditSystemAction(action, details) {
  recordAudit({
    action,
    entityType: "system",
    source: "system",
    result: "success",
    metadata: {
      description: details.description,
      ...details.metadata
    }
  });
}
var log40, BUFFER_SIZE, FLUSH_INTERVAL_MS, buffer, flushTimer;
var init_auditLogService2 = __esm({
  "server/services/auditLogService.ts"() {
    "use strict";
    init_logger();
    init_connection();
    init_schema2();
    log40 = createModuleLogger("AuditLog");
    __name(mapActionToDrizzle, "mapActionToDrizzle");
    __name(mapEntityTypeToDrizzle, "mapEntityTypeToDrizzle");
    BUFFER_SIZE = 100;
    FLUSH_INTERVAL_MS = 5e3;
    buffer = [];
    flushTimer = null;
    __name(recordAudit, "recordAudit");
    __name(flushBuffer, "flushBuffer");
    __name(auditAccountAction, "auditAccountAction");
    __name(auditBidChange, "auditBidChange");
    __name(auditSystemAction, "auditSystemAction");
  }
});

