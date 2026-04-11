// Extracted from production dist/index.js
// Original module: server/system/collaborationNotificationService.ts
// Lines: 381

var collaborationNotificationService_exports = {};
__export(collaborationNotificationService_exports, {
  ACTION_NOTIFICATION_TEMPLATES: () => ACTION_NOTIFICATION_TEMPLATES,
  ACTION_PRIORITY: () => ACTION_PRIORITY,
  IMPORTANT_ACTIONS: () => IMPORTANT_ACTIONS,
  createCollaborationNotification: () => createCollaborationNotification,
  createNotificationRule: () => createNotificationRule,
  deleteNotificationRule: () => deleteNotificationRule,
  getNotificationRules: () => getNotificationRules,
  getNotificationStats: () => getNotificationStats,
  getUserNotificationPreferences: () => getUserNotificationPreferences,
  getUserNotifications: () => getUserNotifications,
  markAllNotificationsAsRead: () => markAllNotificationsAsRead,
  markNotificationAsRead: () => markNotificationAsRead2,
  triggerCollaborationNotification: () => triggerCollaborationNotification,
  updateNotificationRule: () => updateNotificationRule,
  updateUserNotificationPreferences: () => updateUserNotificationPreferences
});
async function createNotificationRule(data) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(collaborationNotificationRules).values(data);
  const [rule] = await db.select().from(collaborationNotificationRules).where(eq(collaborationNotificationRules.id, result.insertId));
  return rule;
}
async function getNotificationRules(userId) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.select().from(collaborationNotificationRules).where(eq(collaborationNotificationRules.userId, userId)).orderBy(desc(collaborationNotificationRules.createdAt));
}
async function updateNotificationRule(id, data) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(collaborationNotificationRules).set(data).where(eq(collaborationNotificationRules.id, id));
  const [rule] = await db.select().from(collaborationNotificationRules).where(eq(collaborationNotificationRules.id, id));
  return rule || null;
}
async function deleteNotificationRule(id) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(collaborationNotificationRules).where(eq(collaborationNotificationRules.id, id));
  return true;
}
async function getUserNotificationPreferences(userId) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [existing] = await db.select().from(userNotificationPreferences).where(eq(userNotificationPreferences.userId, userId));
  if (existing) return existing;
  const [result] = await db.insert(userNotificationPreferences).values({ userId });
  const [newPref] = await db.select().from(userNotificationPreferences).where(eq(userNotificationPreferences.id, result.insertId));
  return newPref;
}
async function updateUserNotificationPreferences(userId, data) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await getUserNotificationPreferences(userId);
  await db.update(userNotificationPreferences).set(data).where(eq(userNotificationPreferences.userId, userId));
  const [updated] = await db.select().from(userNotificationPreferences).where(eq(userNotificationPreferences.userId, userId));
  return updated;
}
async function createCollaborationNotification(data) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(collaborationNotifications).values(data);
  const [notification] = await db.select().from(collaborationNotifications).where(eq(collaborationNotifications.id, result.insertId));
  return notification;
}
async function getUserNotifications(params) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const { userId, status, page = 1, pageSize = 20 } = params;
  const conditions = [eq(collaborationNotifications.recipientUserId, userId)];
  if (status) {
    conditions.push(eq(collaborationNotifications.status, status));
  }
  const whereClause = and(...conditions);
  const [countResult] = await db.select({ count: sql`COUNT(*)` }).from(collaborationNotifications).where(whereClause);
  const total = countResult?.count || 0;
  const [unreadResult] = await db.select({ count: sql`COUNT(*)` }).from(collaborationNotifications).where(and(eq(collaborationNotifications.recipientUserId, userId), eq(collaborationNotifications.status, "sent")));
  const unreadCount = unreadResult?.count || 0;
  const offset = (page - 1) * pageSize;
  const notifications = await db.select().from(collaborationNotifications).where(whereClause).orderBy(desc(collaborationNotifications.createdAt)).limit(pageSize).offset(offset);
  return { notifications, total, unreadCount };
}
async function markNotificationAsRead2(id) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(collaborationNotifications).set({ status: "read", readAt: (/* @__PURE__ */ new Date()).toISOString() }).where(eq(collaborationNotifications.id, id));
  return true;
}
async function markAllNotificationsAsRead(userId) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.update(collaborationNotifications).set({ status: "read", readAt: (/* @__PURE__ */ new Date()).toISOString() }).where(and(eq(collaborationNotifications.recipientUserId, userId), eq(collaborationNotifications.status, "sent")));
  return result.affectedRows || 0;
}
async function triggerCollaborationNotification(params) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const {
    actionType,
    actionUserId,
    actionUserName,
    targetType,
    targetId,
    targetName,
    accountId,
    accountName: accountName2,
    metadata,
    auditLogId
  } = params;
  if (!IMPORTANT_ACTIONS.includes(actionType)) {
    return 0;
  }
  const template = ACTION_NOTIFICATION_TEMPLATES[actionType] || {
    title: "\u64CD\u4F5C\u901A\u77E5",
    content: "{userName} \u6267\u884C\u4E86\u64CD\u4F5C"
  };
  const priority = ACTION_PRIORITY[actionType] || ACTION_PRIORITY.default;
  const title = template.title;
  let content = template.content.replace("{userName}", actionUserName).replace("{targetName}", targetName || "").replace("{count}", metadata?.count?.toString() || "");
  if (accountName2) {
    content += ` (\u8D26\u53F7: ${accountName2})`;
  }
  const members = await db.select().from(teamMembers).where(and(eq(teamMembers.status, "active")));
  const recipients = members.filter((m) => m.memberId !== actionUserId);
  if (recipients.length === 0) {
    return 0;
  }
  let notificationCount = 0;
  for (const recipient of recipients) {
    const prefs = await getUserNotificationPreferences(recipient.memberId || 0);
    if (!prefs.enableAppNotifications) continue;
    if (priority === "low" && !prefs.notifyOnLow) continue;
    if (priority === "medium" && !prefs.notifyOnMedium) continue;
    if (priority === "high" && !prefs.notifyOnHigh) continue;
    if (priority === "critical" && !prefs.notifyOnCritical) continue;
    if (actionType.startsWith("bid_") && !prefs.bidAdjustNotify) continue;
    if (actionType.startsWith("negative_") && !prefs.negativeKeywordNotify) continue;
    if (actionType.startsWith("campaign_") && !prefs.campaignChangeNotify) continue;
    if (actionType.startsWith("automation_") && !prefs.automationNotify) continue;
    if (actionType.startsWith("team_") && !prefs.teamChangeNotify) continue;
    if (actionType.startsWith("data_") && !prefs.dataImportExportNotify) continue;
    if (prefs.quietHoursEnabled && prefs.quietHoursStart && prefs.quietHoursEnd) {
      const now = /* @__PURE__ */ new Date();
      const currentTime = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
      if (currentTime >= prefs.quietHoursStart && currentTime <= prefs.quietHoursEnd) {
        continue;
      }
    }
    await createCollaborationNotification({
      ruleId: null,
      auditLogId: auditLogId || null,
      title,
      content,
      actionType,
      actionUserId,
      actionUserName,
      targetType: targetType || null,
      targetId: targetId || null,
      // @ts-ignore
      targetName: targetName || null,
      // @ts-ignore
      accountId: accountId || null,
      accountName: accountName2 || null,
      channel: "app",
      recipientUserId: recipient.memberId || 0,
      recipientEmail: recipient.email,
      status: "sent",
      sentAt: (/* @__PURE__ */ new Date()).toISOString(),
      priority
    });
    notificationCount++;
    if (prefs.enableEmailNotifications && (priority === "high" || priority === "critical")) {
      await createCollaborationNotification({
        ruleId: null,
        auditLogId: auditLogId || null,
        title,
        content,
        actionType,
        actionUserId,
        actionUserName,
        targetType: targetType || null,
        // @ts-ignore
        targetId: targetId || null,
        targetName: targetName || null,
        // @ts-ignore
        accountId: accountId || null,
        accountName: accountName2 || null,
        channel: "email",
        recipientUserId: recipient.memberId || 0,
        recipientEmail: recipient.email,
        status: "pending",
        priority
      });
    }
  }
  return notificationCount;
}
async function getNotificationStats(userId) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [totalResult] = await db.select({ count: sql`COUNT(*)` }).from(collaborationNotifications).where(eq(collaborationNotifications.recipientUserId, userId));
  const totalNotifications = totalResult?.count || 0;
  const [unreadResult] = await db.select({ count: sql`COUNT(*)` }).from(collaborationNotifications).where(and(eq(collaborationNotifications.recipientUserId, userId), eq(collaborationNotifications.status, "sent")));
  const unreadCount = unreadResult?.count || 0;
  const priorityStats = await db.select({
    priority: collaborationNotifications.priority,
    count: sql`COUNT(*)`
  }).from(collaborationNotifications).where(eq(collaborationNotifications.recipientUserId, userId)).groupBy(collaborationNotifications.priority);
  const byPriority = {};
  for (const stat of priorityStats) {
    if (stat.priority) {
      byPriority[stat.priority] = stat.count;
    }
  }
  const actionStats = await db.select({
    actionType: collaborationNotifications.actionType,
    count: sql`COUNT(*)`
  }).from(collaborationNotifications).where(eq(collaborationNotifications.recipientUserId, userId)).groupBy(collaborationNotifications.actionType);
  const byActionType = {};
  for (const stat of actionStats) {
    if (stat.actionType) {
      byActionType[stat.actionType] = stat.count;
    }
  }
  const recentNotifications = await db.select().from(collaborationNotifications).where(eq(collaborationNotifications.recipientUserId, userId)).orderBy(desc(collaborationNotifications.createdAt)).limit(10);
  return {
    totalNotifications,
    unreadCount,
    byPriority,
    byActionType,
    recentNotifications
  };
}
var IMPORTANT_ACTIONS, ACTION_PRIORITY, ACTION_NOTIFICATION_TEMPLATES;
var init_collaborationNotificationService = __esm({
  "server/system/collaborationNotificationService.ts"() {
    "use strict";
    init_db2();
    init_schema2();
    init_drizzle_orm();
    IMPORTANT_ACTIONS = [
      // 出价调整
      "bid_adjust_single",
      "bid_adjust_batch",
      "bid_rollback",
      // 否定词管理
      "negative_add_single",
      "negative_add_batch",
      "negative_remove",
      // 广告活动管理
      "campaign_create",
      "campaign_delete",
      "campaign_pause",
      "campaign_enable",
      // 自动化设置
      "automation_enable",
      "automation_disable",
      "automation_config_update",
      // 团队管理
      "team_member_invite",
      "team_member_remove",
      "team_permission_update",
      // 数据导入导出
      "data_import",
      "data_export"
    ];
    ACTION_PRIORITY = {
      // 高优先级
      bid_adjust_batch: "high",
      bid_rollback: "high",
      negative_add_batch: "high",
      campaign_delete: "high",
      automation_enable: "high",
      automation_disable: "high",
      team_member_remove: "high",
      team_permission_update: "high",
      // 中优先级
      bid_adjust_single: "medium",
      negative_add_single: "medium",
      negative_remove: "medium",
      campaign_create: "medium",
      campaign_pause: "medium",
      campaign_enable: "medium",
      automation_config_update: "medium",
      team_member_invite: "medium",
      data_import: "medium",
      data_export: "medium",
      // 低优先级
      default: "low"
    };
    ACTION_NOTIFICATION_TEMPLATES = {
      bid_adjust_single: {
        title: "\u51FA\u4EF7\u8C03\u6574\u901A\u77E5",
        content: "{userName} \u8C03\u6574\u4E86 {targetName} \u7684\u51FA\u4EF7"
      },
      bid_adjust_batch: {
        title: "\u6279\u91CF\u51FA\u4EF7\u8C03\u6574\u901A\u77E5",
        content: "{userName} \u8FDB\u884C\u4E86\u6279\u91CF\u51FA\u4EF7\u8C03\u6574\uFF0C\u5171 {count} \u4E2A\u76EE\u6807"
      },
      bid_rollback: {
        title: "\u51FA\u4EF7\u56DE\u6EDA\u901A\u77E5",
        content: "{userName} \u56DE\u6EDA\u4E86\u51FA\u4EF7\u8C03\u6574"
      },
      negative_add_single: {
        title: "\u5426\u5B9A\u8BCD\u6DFB\u52A0\u901A\u77E5",
        content: "{userName} \u6DFB\u52A0\u4E86\u5426\u5B9A\u8BCD {targetName}"
      },
      negative_add_batch: {
        title: "\u6279\u91CF\u5426\u5B9A\u8BCD\u6DFB\u52A0\u901A\u77E5",
        content: "{userName} \u6279\u91CF\u6DFB\u52A0\u4E86\u5426\u5B9A\u8BCD\uFF0C\u5171 {count} \u4E2A"
      },
      negative_remove: {
        title: "\u5426\u5B9A\u8BCD\u79FB\u9664\u901A\u77E5",
        content: "{userName} \u79FB\u9664\u4E86\u5426\u5B9A\u8BCD {targetName}"
      },
      campaign_create: {
        title: "\u5E7F\u544A\u6D3B\u52A8\u521B\u5EFA\u901A\u77E5",
        content: "{userName} \u521B\u5EFA\u4E86\u65B0\u7684\u5E7F\u544A\u6D3B\u52A8 {targetName}"
      },
      campaign_delete: {
        title: "\u5E7F\u544A\u6D3B\u52A8\u5220\u9664\u901A\u77E5",
        content: "{userName} \u5220\u9664\u4E86\u5E7F\u544A\u6D3B\u52A8 {targetName}"
      },
      campaign_pause: {
        title: "\u5E7F\u544A\u6D3B\u52A8\u6682\u505C\u901A\u77E5",
        content: "{userName} \u6682\u505C\u4E86\u5E7F\u544A\u6D3B\u52A8 {targetName}"
      },
      campaign_enable: {
        title: "\u5E7F\u544A\u6D3B\u52A8\u542F\u7528\u901A\u77E5",
        content: "{userName} \u542F\u7528\u4E86\u5E7F\u544A\u6D3B\u52A8 {targetName}"
      },
      automation_enable: {
        title: "\u81EA\u52A8\u5316\u542F\u7528\u901A\u77E5",
        content: "{userName} \u542F\u7528\u4E86\u81EA\u52A8\u5316\u529F\u80FD"
      },
      automation_disable: {
        title: "\u81EA\u52A8\u5316\u7981\u7528\u901A\u77E5",
        content: "{userName} \u7981\u7528\u4E86\u81EA\u52A8\u5316\u529F\u80FD"
      },
      automation_config_update: {
        title: "\u81EA\u52A8\u5316\u914D\u7F6E\u66F4\u65B0\u901A\u77E5",
        content: "{userName} \u66F4\u65B0\u4E86\u81EA\u52A8\u5316\u914D\u7F6E"
      },
      team_member_invite: {
        title: "\u56E2\u961F\u6210\u5458\u9080\u8BF7\u901A\u77E5",
        content: "{userName} \u9080\u8BF7\u4E86\u65B0\u6210\u5458 {targetName} \u52A0\u5165\u56E2\u961F"
      },
      team_member_remove: {
        title: "\u56E2\u961F\u6210\u5458\u79FB\u9664\u901A\u77E5",
        content: "{userName} \u79FB\u9664\u4E86\u56E2\u961F\u6210\u5458 {targetName}"
      },
      team_permission_update: {
        title: "\u6743\u9650\u53D8\u66F4\u901A\u77E5",
        content: "{userName} \u66F4\u65B0\u4E86 {targetName} \u7684\u6743\u9650"
      },
      data_import: {
        title: "\u6570\u636E\u5BFC\u5165\u901A\u77E5",
        content: "{userName} \u5BFC\u5165\u4E86\u6570\u636E"
      },
      data_export: {
        title: "\u6570\u636E\u5BFC\u51FA\u901A\u77E5",
        content: "{userName} \u5BFC\u51FA\u4E86\u6570\u636E"
      }
    };
    __name(createNotificationRule, "createNotificationRule");
    __name(getNotificationRules, "getNotificationRules");
    __name(updateNotificationRule, "updateNotificationRule");
    __name(deleteNotificationRule, "deleteNotificationRule");
    __name(getUserNotificationPreferences, "getUserNotificationPreferences");
    __name(updateUserNotificationPreferences, "updateUserNotificationPreferences");
    __name(createCollaborationNotification, "createCollaborationNotification");
    __name(getUserNotifications, "getUserNotifications");
    __name(markNotificationAsRead2, "markNotificationAsRead");
    __name(markAllNotificationsAsRead, "markAllNotificationsAsRead");
    __name(triggerCollaborationNotification, "triggerCollaborationNotification");
    __name(getNotificationStats, "getNotificationStats");
  }
});

