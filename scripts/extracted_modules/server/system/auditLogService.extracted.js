// Extracted from production dist/index.js
// Original module: server/system/auditLogService.ts
// Lines: 204

var auditLogService_exports = {};
__export(auditLogService_exports, {
  createAuditLog: () => createAuditLog,
  logBidAdjust: () => logBidAdjust,
  logInviteCode: () => logInviteCode,
  logLogin: () => logLogin,
  logStrategy: () => logStrategy,
  logSync: () => logSync2,
  queryAuditLogs: () => queryAuditLogs
});
async function createAuditLog(input) {
  const db = await getDb();
  if (!db) return { success: false, error: "\u6570\u636E\u5E93\u8FDE\u63A5\u5931\u8D25" };
  try {
    const now = (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ");
    await db.execute(sql`
      INSERT INTO audit_logs (
        userId, userName, actionType,
        targetType, targetId, targetName, description,
        previousValue, newValue, ipAddress, userAgent, requestId,
        status, errorMessage, createdAt
      ) VALUES (
        ${input.userId || null},
        ${input.userName || null},
        ${input.actionType},
        ${input.resourceType || null},
        ${input.resourceId || null},
        ${input.resourceName || null},
        ${input.description || null},
        ${input.oldValue ? JSON.stringify(input.oldValue) : null},
        ${input.newValue ? JSON.stringify(input.newValue) : null},
        ${input.ipAddress || null},
        ${input.userAgent || null},
        ${input.requestId || null},
        ${input.status || "success"},
        ${input.errorMessage || null},
        ${now}
      )
    `);
    return { success: true };
  } catch (error48) {
    log31.warn("[AuditLog] \u521B\u5EFA\u5BA1\u8BA1\u65E5\u5FD7\u5931\u8D25:", error48);
    return { success: false, error: error48.message };
  }
}
async function queryAuditLogs(query) {
  const db = await getDb();
  if (!db) return { logs: [], total: 0 };
  try {
    const conditions = [];
    if (query.organizationId) conditions.push(sql`organization_id = ${query.organizationId}`);
    if (query.userId) conditions.push(sql`user_id = ${query.userId}`);
    if (query.actionType) conditions.push(sql`action_type = ${query.actionType}`);
    if (query.actionCategory) conditions.push(sql`action_category = ${query.actionCategory}`);
    if (query.resourceType) conditions.push(sql`resource_type = ${query.resourceType}`);
    if (query.status) conditions.push(sql`status = ${query.status}`);
    if (query.startDate) conditions.push(sql`created_at >= ${query.startDate}`);
    if (query.endDate) conditions.push(sql`created_at <= ${query.endDate}`);
    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 500);
    const offset = Math.max(Number(query.offset) || 0, 0);
    let whereClause = sql``;
    if (conditions.length > 0) {
      whereClause = sql`WHERE ${conditions.reduce((acc, cond, idx) => idx === 0 ? cond : sql`${acc} AND ${cond}`)}`;
    }
    const countResult = await db.execute(sql`SELECT COUNT(*) as total FROM audit_logs ${whereClause}`);
    const total = countResult[0]?.[0]?.total || 0;
    const result = await db.execute(sql`
      SELECT * FROM audit_logs ${whereClause}
      ORDER BY created_at DESC LIMIT ${sql.raw(String(limit))} OFFSET ${offset}
    `);
    const rows = result[0] || [];
    const logs = rows.map((row) => ({
      id: row.id,
      organizationId: row.organization_id,
      userId: row.user_id,
      userName: row.user_name,
      actionType: row.action_type,
      actionCategory: row.action_category,
      resourceType: row.resource_type,
      // @ts-ignore
      resourceId: row.resource_id,
      // @ts-ignore
      resourceName: row.resource_name,
      description: row.description,
      // @ts-ignore
      oldValue: row.old_value ? JSON.parse(row.old_value) : null,
      // @ts-ignore
      newValue: row.new_value ? JSON.parse(row.new_value) : null,
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      requestId: row.request_id,
      status: row.status,
      errorMessage: row.error_message,
      createdAt: row.created_at
    }));
    return { logs, total };
  } catch (error48) {
    log31.warn("[AuditLog] \u67E5\u8BE2\u5BA1\u8BA1\u65E5\u5FD7\u5931\u8D25:", error48);
    return { logs: [], total: 0 };
  }
}
async function logLogin(userId, userName, organizationId, ipAddress, userAgent, success2 = true, errorMessage) {
  await createAuditLog({
    organizationId,
    userId,
    userName,
    actionType: "login",
    actionCategory: "auth",
    resourceType: "user",
    resourceId: String(userId),
    resourceName: userName,
    description: success2 ? "\u7528\u6237\u767B\u5F55\u6210\u529F" : "\u7528\u6237\u767B\u5F55\u5931\u8D25",
    ipAddress,
    userAgent,
    status: success2 ? "success" : "failed",
    errorMessage
  });
}
async function logSync2(userId, userName, organizationId, accountId, accountName2, syncType, success2 = true, details, errorMessage) {
  await createAuditLog({
    organizationId,
    userId,
    userName,
    actionType: "sync",
    actionCategory: "sync",
    resourceType: "ad_account",
    resourceId: String(accountId),
    resourceName: accountName2,
    description: `${syncType}\u6570\u636E\u540C\u6B65${success2 ? "\u6210\u529F" : "\u5931\u8D25"}`,
    newValue: details,
    status: success2 ? "success" : "failed",
    errorMessage
  });
}
async function logBidAdjust(userId, userName, organizationId, resourceType, resourceId, resourceName, oldBid, newBid, reason) {
  await createAuditLog({
    organizationId,
    userId,
    userName,
    actionType: "bid_adjust",
    actionCategory: "optimization",
    resourceType,
    resourceId,
    resourceName,
    description: reason || `\u51FA\u4EF7\u4ECE $${oldBid.toFixed(2)} \u8C03\u6574\u4E3A $${newBid.toFixed(2)}`,
    oldValue: { bid: oldBid },
    newValue: { bid: newBid },
    status: "success"
  });
}
async function logStrategy(userId, userName, organizationId, actionType, strategyId, strategyName, details) {
  const descriptions = {
    "strategy_create": "\u521B\u5EFA\u4F18\u5316\u7B56\u7565",
    "strategy_update": "\u66F4\u65B0\u4F18\u5316\u7B56\u7565",
    "strategy_delete": "\u5220\u9664\u4F18\u5316\u7B56\u7565",
    "strategy_execute": "\u6267\u884C\u4F18\u5316\u7B56\u7565"
  };
  await createAuditLog({
    organizationId,
    userId,
    userName,
    actionType,
    actionCategory: "strategy",
    resourceType: "strategy",
    resourceId: strategyId,
    resourceName: strategyName,
    description: descriptions[actionType],
    newValue: details,
    status: "success"
  });
}
async function logInviteCode(userId, userName, organizationId, actionType, inviteCode, details) {
  await createAuditLog({
    organizationId,
    userId,
    userName,
    actionType,
    actionCategory: "invite",
    resourceType: "invite_code",
    resourceId: inviteCode,
    resourceName: inviteCode,
    description: actionType === "invite_create" ? "\u521B\u5EFA\u9080\u8BF7\u7801" : "\u4F7F\u7528\u9080\u8BF7\u7801\u6CE8\u518C",
    newValue: details,
    status: "success"
  });
}
var log31;
var init_auditLogService = __esm({
  "server/system/auditLogService.ts"() {
    "use strict";
    init_logger();
    init_db2();
    init_drizzle_orm();
    log31 = createModuleLogger("AuditLogService");
    __name(createAuditLog, "createAuditLog");
    __name(queryAuditLogs, "queryAuditLogs");
    __name(logLogin, "logLogin");
    __name(logSync2, "logSync");
    __name(logBidAdjust, "logBidAdjust");
    __name(logStrategy, "logStrategy");
    __name(logInviteCode, "logInviteCode");
  }
});

