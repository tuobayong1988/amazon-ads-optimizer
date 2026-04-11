// Extracted from production dist/index.js
// Original module: server/system/auditService.ts
// Lines: 314

var auditService_exports = {};
__export(auditService_exports, {
  ACTION_CATEGORIES: () => ACTION_CATEGORIES,
  ACTION_DESCRIPTIONS: () => ACTION_DESCRIPTIONS,
  TARGET_TYPE_DESCRIPTIONS: () => TARGET_TYPE_DESCRIPTIONS,
  cleanupOldAuditLogs: () => cleanupOldAuditLogs,
  createAuditLog: () => createAuditLog2,
  exportAuditLogsToCSV: () => exportAuditLogsToCSV,
  getAccountAuditStats: () => getAccountAuditStats,
  getAuditLogById: () => getAuditLogById,
  getAuditLogs: () => getAuditLogs,
  getUserAuditStats: () => getUserAuditStats,
  logAudit: () => logAudit
});
async function createAuditLog2(data) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(auditLogs).values(data);
  const [log216] = await db.select().from(auditLogs).where(eq(auditLogs.id, result[0]?.insertId || 0));
  return log216;
}
async function logAudit(params) {
  const description = params.description || ACTION_DESCRIPTIONS[params.actionType] || "\u672A\u77E5\u64CD\u4F5C";
  return createAuditLog2({
    ...params,
    description
  });
}
async function getAuditLogs(params) {
  const {
    userId,
    actionTypes,
    targetTypes,
    accountId,
    status,
    startDate,
    endDate,
    search,
    page = 1,
    pageSize = 20
  } = params;
  const conditions = [];
  if (userId) {
    conditions.push(eq(auditLogs.userId, userId));
  }
  if (actionTypes && actionTypes.length > 0) {
    conditions.push(inArray(auditLogs.actionType, actionTypes));
  }
  if (targetTypes && targetTypes.length > 0) {
    conditions.push(inArray(auditLogs.targetType, targetTypes));
  }
  if (accountId) {
    conditions.push(eq(auditLogs.accountId, accountId));
  }
  if (status) {
    conditions.push(eq(auditLogs.status, status));
  }
  if (startDate) {
    const startDateStr = startDate.toISOString().slice(0, 19).replace("T", " ");
    conditions.push(gte(auditLogs.createdAt, startDateStr));
  }
  if (endDate) {
    const endDateStr = endDate.toISOString().slice(0, 19).replace("T", " ");
    conditions.push(lte(auditLogs.createdAt, endDateStr));
  }
  if (search) {
    conditions.push(
      sql`(${auditLogs.description} LIKE ${`%${search}%`} OR ${auditLogs.targetName} LIKE ${`%${search}%`} OR ${auditLogs.userName} LIKE ${`%${search}%`})`
    );
  }
  const whereClause = conditions.length > 0 ? and(...conditions) : void 0;
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [countResult] = await db.select({ count: sql`COUNT(*)` }).from(auditLogs).where(whereClause);
  const total = countResult?.count || 0;
  const offset = (page - 1) * pageSize;
  const logs = await db.select().from(auditLogs).where(whereClause).orderBy(desc(auditLogs.createdAt)).limit(pageSize).offset(offset);
  return { logs, total };
}
async function getAuditLogById(id) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [log216] = await db.select().from(auditLogs).where(eq(auditLogs.id, id));
  return log216 || null;
}
async function getUserAuditStats(userId, days = 30) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const startDate = /* @__PURE__ */ new Date();
  startDate.setDate(startDate.getDate() - days);
  const startDateStr = startDate.toISOString().slice(0, 19).replace("T", " ");
  const userCondition = userId ? eq(auditLogs.userId, userId) : void 0;
  const [totalResult] = await db.select({ count: sql`COUNT(*)` }).from(auditLogs).where(and(userCondition, gte(auditLogs.createdAt, startDateStr)));
  const totalActions = totalResult?.count || 0;
  const typeStats = await db.select({
    actionType: auditLogs.actionType,
    count: sql`COUNT(*)`
  }).from(auditLogs).where(and(userCondition, gte(auditLogs.createdAt, startDateStr))).groupBy(auditLogs.actionType);
  const actionsByType = {};
  for (const stat of typeStats) {
    actionsByType[stat.actionType] = stat.count;
  }
  let dayStats = [];
  try {
    dayStats = await db.select({
      date: sql`DATE_FORMAT(${auditLogs.createdAt}, '%Y-%m-%d')`,
      count: sql`COUNT(*)`
    }).from(auditLogs).where(and(userCondition, gte(auditLogs.createdAt, startDateStr))).groupBy(sql`DATE_FORMAT(${auditLogs.createdAt}, '%Y-%m-%d')`).orderBy(sql`DATE_FORMAT(${auditLogs.createdAt}, '%Y-%m-%d')`);
  } catch (error48) {
    log90.warn("Failed to get audit logs by day:", error48);
    dayStats = [];
  }
  const actionsByDay = dayStats.map((stat) => ({
    date: stat.date,
    count: stat.count
  }));
  const recentActions = await db.select().from(auditLogs).where(userCondition ? eq(auditLogs.userId, userId) : void 0).orderBy(desc(auditLogs.createdAt)).limit(10);
  return {
    totalActions,
    actionsByType,
    actionsByDay,
    recentActions
  };
}
async function getAccountAuditStats(accountId, days = 30) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const startDate = /* @__PURE__ */ new Date();
  startDate.setDate(startDate.getDate() - days);
  const startDateStr = startDate.toISOString().slice(0, 19).replace("T", " ");
  const [totalResult] = await db.select({ count: sql`COUNT(*)` }).from(auditLogs).where(and(eq(auditLogs.accountId, accountId), gte(auditLogs.createdAt, startDateStr)));
  const totalActions = totalResult?.count || 0;
  const typeStats = await db.select({
    actionType: auditLogs.actionType,
    count: sql`COUNT(*)`
  }).from(auditLogs).where(and(eq(auditLogs.accountId, accountId), gte(auditLogs.createdAt, startDateStr))).groupBy(auditLogs.actionType);
  const actionsByType = {};
  for (const stat of typeStats) {
    actionsByType[stat.actionType] = stat.count;
  }
  const userStats = await db.select({
    userId: auditLogs.userId,
    userName: auditLogs.userName,
    count: sql`COUNT(*)`
  }).from(auditLogs).where(and(eq(auditLogs.accountId, accountId), gte(auditLogs.createdAt, startDateStr))).groupBy(auditLogs.userId, auditLogs.userName);
  const actionsByUser = userStats.map((stat) => ({
    userId: stat.userId || 0,
    userName: stat.userName || (stat.userId === 0 || !stat.userId ? "\u7CFB\u7EDF\u81EA\u52A8\u4F18\u5316" : "\u672A\u77E5\u7528\u6237"),
    // v375: 修复系统自动操作显示为"未知用户"的问题
    count: stat.count
  }));
  return {
    totalActions,
    actionsByType,
    actionsByUser
  };
}
async function exportAuditLogsToCSV(params) {
  const { logs } = await getAuditLogs({
    ...params,
    page: 1,
    pageSize: 1e4
    // 最多导出10000条
  });
  const headers = [
    "ID",
    "\u65F6\u95F4",
    "\u64CD\u4F5C\u7528\u6237",
    "\u7528\u6237\u90AE\u7BB1",
    "\u64CD\u4F5C\u7C7B\u578B",
    "\u64CD\u4F5C\u63CF\u8FF0",
    "\u76EE\u6807\u7C7B\u578B",
    "\u76EE\u6807\u540D\u79F0",
    "\u5173\u8054\u8D26\u53F7",
    "\u72B6\u6001",
    "IP\u5730\u5740"
    // @ts-ignore
  ];
  const rows = logs.map((log216) => [
    // @ts-ignore
    log216.id,
    // @ts-ignore
    String(log216.createdAt),
    // @ts-ignore
    log216.userName || "",
    // @ts-ignore
    log216.userEmail || "",
    // @ts-ignore
    ACTION_DESCRIPTIONS[log216.actionType] || log216.actionType,
    // @ts-ignore
    log216.description || "",
    // @ts-ignore
    TARGET_TYPE_DESCRIPTIONS[log216.targetType || ""] || log216.targetType || "",
    // @ts-ignore
    log216.targetName || "",
    // @ts-ignore
    log216.accountName || "",
    // @ts-ignore
    log216.status,
    // @ts-ignore
    log216.ipAddress || ""
  ]);
  const csvContent = [
    headers.join(","),
    // @ts-ignore
    ...rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
  ].join("\n");
  return csvContent;
}
async function cleanupOldAuditLogs(retentionDays = 365) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const cutoffDate = /* @__PURE__ */ new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
  const result = await db.delete(auditLogs).where(lte(auditLogs.createdAt, cutoffDate.toISOString()));
  return result.affectedRows || 0;
}
var log90, ACTION_CATEGORIES, ACTION_DESCRIPTIONS, TARGET_TYPE_DESCRIPTIONS;
var init_auditService = __esm({
  "server/system/auditService.ts"() {
    "use strict";
    init_logger();
    init_db2();
    init_schema2();
    init_drizzle_orm();
    log90 = createModuleLogger("AuditService");
    ACTION_CATEGORIES = {
      account: ["account_create", "account_update", "account_delete", "account_connect", "account_disconnect"],
      campaign: ["campaign_create", "campaign_update", "campaign_delete", "campaign_pause", "campaign_enable"],
      bid: ["bid_adjust_single", "bid_adjust_batch", "bid_rollback"],
      negative: ["negative_add_single", "negative_add_batch", "negative_remove"],
      performance_group: ["performance_group_create", "performance_group_update", "performance_group_delete"],
      automation: ["automation_enable", "automation_disable", "automation_config_update"],
      scheduler: ["scheduler_task_create", "scheduler_task_update", "scheduler_task_delete", "scheduler_task_run"],
      team: ["team_member_invite", "team_member_update", "team_member_remove", "team_permission_update"],
      data: ["data_import", "data_export"],
      settings: ["settings_update", "notification_config_update"]
    };
    ACTION_DESCRIPTIONS = {
      // 账号管理
      account_create: "\u521B\u5EFA\u5E7F\u544A\u8D26\u53F7",
      account_update: "\u66F4\u65B0\u5E7F\u544A\u8D26\u53F7",
      account_delete: "\u5220\u9664\u5E7F\u544A\u8D26\u53F7",
      account_connect: "\u8FDE\u63A5\u5E7F\u544A\u8D26\u53F7",
      account_disconnect: "\u65AD\u5F00\u5E7F\u544A\u8D26\u53F7\u8FDE\u63A5",
      // 广告活动管理
      campaign_create: "\u521B\u5EFA\u5E7F\u544A\u6D3B\u52A8",
      campaign_update: "\u66F4\u65B0\u5E7F\u544A\u6D3B\u52A8",
      campaign_delete: "\u5220\u9664\u5E7F\u544A\u6D3B\u52A8",
      campaign_pause: "\u6682\u505C\u5E7F\u544A\u6D3B\u52A8",
      campaign_enable: "\u542F\u7528\u5E7F\u544A\u6D3B\u52A8",
      // 出价调整
      bid_adjust_single: "\u5355\u4E2A\u51FA\u4EF7\u8C03\u6574",
      bid_adjust_batch: "\u6279\u91CF\u51FA\u4EF7\u8C03\u6574",
      bid_rollback: "\u51FA\u4EF7\u56DE\u6EDA",
      // 否定词管理
      negative_add_single: "\u6DFB\u52A0\u5355\u4E2A\u5426\u5B9A\u8BCD",
      negative_add_batch: "\u6279\u91CF\u6DFB\u52A0\u5426\u5B9A\u8BCD",
      negative_remove: "\u79FB\u9664\u5426\u5B9A\u8BCD",
      // 绩效组管理
      performance_group_create: "\u521B\u5EFA\u7EE9\u6548\u7EC4",
      performance_group_update: "\u66F4\u65B0\u7EE9\u6548\u7EC4",
      performance_group_delete: "\u5220\u9664\u7EE9\u6548\u7EC4",
      // 自动化设置
      automation_enable: "\u542F\u7528\u81EA\u52A8\u5316",
      automation_disable: "\u7981\u7528\u81EA\u52A8\u5316",
      automation_config_update: "\u66F4\u65B0\u81EA\u52A8\u5316\u914D\u7F6E",
      // 定时任务
      scheduler_task_create: "\u521B\u5EFA\u5B9A\u65F6\u4EFB\u52A1",
      scheduler_task_update: "\u66F4\u65B0\u5B9A\u65F6\u4EFB\u52A1",
      scheduler_task_delete: "\u5220\u9664\u5B9A\u65F6\u4EFB\u52A1",
      scheduler_task_run: "\u624B\u52A8\u8FD0\u884C\u5B9A\u65F6\u4EFB\u52A1",
      // 团队管理
      team_member_invite: "\u9080\u8BF7\u56E2\u961F\u6210\u5458",
      team_member_update: "\u66F4\u65B0\u56E2\u961F\u6210\u5458",
      team_member_remove: "\u79FB\u9664\u56E2\u961F\u6210\u5458",
      team_permission_update: "\u66F4\u65B0\u6210\u5458\u6743\u9650",
      // 数据导入导出
      data_import: "\u5BFC\u5165\u6570\u636E",
      data_export: "\u5BFC\u51FA\u6570\u636E",
      // 系统设置
      settings_update: "\u66F4\u65B0\u7CFB\u7EDF\u8BBE\u7F6E",
      notification_config_update: "\u66F4\u65B0\u901A\u77E5\u914D\u7F6E",
      // 其他
      other: "\u5176\u4ED6\u64CD\u4F5C"
    };
    TARGET_TYPE_DESCRIPTIONS = {
      account: "\u5E7F\u544A\u8D26\u53F7",
      campaign: "\u5E7F\u544A\u6D3B\u52A8",
      ad_group: "\u5E7F\u544A\u7EC4",
      keyword: "\u5173\u952E\u8BCD",
      product_target: "\u5546\u54C1\u5B9A\u4F4D",
      performance_group: "\u7EE9\u6548\u7EC4",
      negative_keyword: "\u5426\u5B9A\u8BCD",
      bid: "\u51FA\u4EF7",
      automation: "\u81EA\u52A8\u5316",
      scheduler: "\u5B9A\u65F6\u4EFB\u52A1",
      team_member: "\u56E2\u961F\u6210\u5458",
      permission: "\u6743\u9650",
      settings: "\u8BBE\u7F6E",
      data: "\u6570\u636E",
      other: "\u5176\u4ED6"
    };
    __name(createAuditLog2, "createAuditLog");
    __name(logAudit, "logAudit");
    __name(getAuditLogs, "getAuditLogs");
    __name(getAuditLogById, "getAuditLogById");
    __name(getUserAuditStats, "getUserAuditStats");
    __name(getAccountAuditStats, "getAccountAuditStats");
    __name(exportAuditLogsToCSV, "exportAuditLogsToCSV");
    __name(cleanupOldAuditLogs, "cleanupOldAuditLogs");
  }
});

