/**
 * 团队协作通知服务
 * 当团队成员进行重要操作时，自动通知相关成员
 */

import { getDb } from "./db";
import {
  collaborationNotificationRules,
  collaborationNotifications,
  userNotificationPreferences,
  teamMembers,
  auditLogs,
} from "../drizzle/schema";
import { InferInsertModel, InferSelectModel } from "drizzle-orm";

type InsertCollaborationNotificationRule = InferInsertModel<typeof collaborationNotificationRules>;
type CollaborationNotificationRule = InferSelectModel<typeof collaborationNotificationRules>;
type InsertCollaborationNotification = InferInsertModel<typeof collaborationNotifications>;
type CollaborationNotification = InferSelectModel<typeof collaborationNotifications>;
type InsertUserNotificationPreference = InferInsertModel<typeof userNotificationPreferences>;
type UserNotificationPreference = InferSelectModel<typeof userNotificationPreferences>;
import { eq, and, desc, gte, lte, inArray, sql } from "drizzle-orm";
import { notifyOwner } from "./_core/notification";

// 重要操作类型（需要触发通知的操作）
export const IMPORTANT_ACTIONS = [
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
  "data_export",
] as const;

// 操作类型到通知优先级的映射
export const ACTION_PRIORITY: Record<string, "low" | "medium" | "high" | "critical"> = {
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
  default: "low",
};

// 操作类型到通知标题模板的映射
export const ACTION_NOTIFICATION_TEMPLATES: Record<string, { title: string; content: string }> = {
  bid_adjust_single: {
    title: "出价调整通知",
    content: "{userName} 调整了 {targetName} 的出价",
  },
  bid_adjust_batch: {
    title: "批量出价调整通知",
    content: "{userName} 进行了批量出价调整，共 {count} 个目标",
  },
  bid_rollback: {
    title: "出价回滚通知",
    content: "{userName} 回滚了出价调整",
  },
  negative_add_single: {
    title: "否定词添加通知",
    content: "{userName} 添加了否定词 {targetName}",
  },
  negative_add_batch: {
    title: "批量否定词添加通知",
    content: "{userName} 批量添加了否定词，共 {count} 个",
  },
  negative_remove: {
    title: "否定词移除通知",
    content: "{userName} 移除了否定词 {targetName}",
  },
  campaign_create: {
    title: "广告活动创建通知",
    content: "{userName} 创建了新的广告活动 {targetName}",
  },
  campaign_delete: {
    title: "广告活动删除通知",
    content: "{userName} 删除了广告活动 {targetName}",
  },
  campaign_pause: {
    title: "广告活动暂停通知",
    content: "{userName} 暂停了广告活动 {targetName}",
  },
  campaign_enable: {
    title: "广告活动启用通知",
    content: "{userName} 启用了广告活动 {targetName}",
  },
  automation_enable: {
    title: "自动化启用通知",
    content: "{userName} 启用了自动化功能",
  },
  automation_disable: {
    title: "自动化禁用通知",
    content: "{userName} 禁用了自动化功能",
  },
  automation_config_update: {
    title: "自动化配置更新通知",
    content: "{userName} 更新了自动化配置",
  },
  team_member_invite: {
    title: "团队成员邀请通知",
    content: "{userName} 邀请了新成员 {targetName} 加入团队",
  },
  team_member_remove: {
    title: "团队成员移除通知",
    content: "{userName} 移除了团队成员 {targetName}",
  },
  team_permission_update: {
    title: "权限变更通知",
    content: "{userName} 更新了 {targetName} 的权限",
  },
  data_import: {
    title: "数据导入通知",
    content: "{userName} 导入了数据",
  },
  data_export: {
    title: "数据导出通知",
    content: "{userName} 导出了数据",
  },
};

/**
 * 创建协作通知规则
 */
export async function createNotificationRule(
  data: Omit<InsertCollaborationNotificationRule, "id" | "createdAt" | "updatedAt">
): Promise<CollaborationNotificationRule> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(collaborationNotificationRules).values(data);
  const [rule] = await db
    .select()
    .from(collaborationNotificationRules)
    .where(eq(collaborationNotificationRules.id, result.insertId));
  return rule;
}

/**
 * 获取用户的通知规则列表
 */
export async function getNotificationRules(userId: number): Promise<CollaborationNotificationRule[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db
    .select()
    .from(collaborationNotificationRules)
    .where(eq(collaborationNotificationRules.userId, userId))
    .orderBy(desc(collaborationNotificationRules.createdAt));
}

/**
 * 更新通知规则
 */
export async function updateNotificationRule(
  id: number,
  data: Partial<Omit<InsertCollaborationNotificationRule, "id" | "userId" | "createdAt" | "updatedAt">>
): Promise<CollaborationNotificationRule | null> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(collaborationNotificationRules).set(data).where(eq(collaborationNotificationRules.id, id));
  const [rule] = await db
    .select()
    .from(collaborationNotificationRules)
    .where(eq(collaborationNotificationRules.id, id));
  return rule || null;
}

/**
 * 删除通知规则
 */
export async function deleteNotificationRule(id: number): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(collaborationNotificationRules).where(eq(collaborationNotificationRules.id, id));
  return true;
}

/**
 * 获取或创建用户通知偏好设置
 */
export async function getUserNotificationPreferences(userId: number): Promise<UserNotificationPreference> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const [existing] = await db
    .select()
    .from(userNotificationPreferences)
    .where(eq(userNotificationPreferences.userId, userId));
  
  if (existing) return existing;
  
  // 创建默认偏好设置
  const [result] = await db.insert(userNotificationPreferences).values({ userId });
  const [newPref] = await db
    .select()
    .from(userNotificationPreferences)
    .where(eq(userNotificationPreferences.id, result.insertId));
  return newPref;
}

/**
 * 更新用户通知偏好设置
 */
export async function updateUserNotificationPreferences(
  userId: number,
  data: Partial<Omit<InsertUserNotificationPreference, "id" | "userId" | "createdAt" | "updatedAt">>
): Promise<UserNotificationPreference> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // 确保存在记录
  await getUserNotificationPreferences(userId);
  
  await db
    .update(userNotificationPreferences)
    .set(data)
    .where(eq(userNotificationPreferences.userId, userId));
  
  const [updated] = await db
    .select()
    .from(userNotificationPreferences)
    .where(eq(userNotificationPreferences.userId, userId));
  return updated;
}

/**
 * 创建协作通知
 */
export async function createCollaborationNotification(
  data: Omit<InsertCollaborationNotification, "id" | "createdAt">
): Promise<CollaborationNotification> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(collaborationNotifications).values(data);
  const [notification] = await db
    .select()
    .from(collaborationNotifications)
    .where(eq(collaborationNotifications.id, result.insertId));
  return notification;
}

/**
 * 获取用户的协作通知列表
 */
export async function getUserNotifications(params: {
  userId: number;
  status?: string;
  page?: number;
  pageSize?: number;
}): Promise<{ notifications: CollaborationNotification[]; total: number; unreadCount: number }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const { userId, status, page = 1, pageSize = 20 } = params;
  
  const conditions = [eq(collaborationNotifications.recipientUserId, userId)];
  if (status) {
    conditions.push(eq(collaborationNotifications.status, status as any));
  }
  
  const whereClause = and(...conditions);
  
  // 获取总数
  const [countResult] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(collaborationNotifications)
    .where(whereClause);
  const total = countResult?.count || 0;
  
  // 获取未读数
  const [unreadResult] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(collaborationNotifications)
    .where(and(eq(collaborationNotifications.recipientUserId, userId), eq(collaborationNotifications.status, "sent")));
  const unreadCount = unreadResult?.count || 0;
  
  // 获取分页数据
  const offset = (page - 1) * pageSize;
  const notifications = await db
    .select()
    .from(collaborationNotifications)
    .where(whereClause)
    .orderBy(desc(collaborationNotifications.createdAt))
    .limit(pageSize)
    .offset(offset);
  
  return { notifications, total, unreadCount };
}

/**
 * 标记通知为已读
 */
export async function markNotificationAsRead(id: number): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(collaborationNotifications)
    .set({ status: "read", readAt: new Date().toISOString() })
    .where(eq(collaborationNotifications.id, id));
  return true;
}

/**
 * 标记所有通知为已读
 */
export async function markAllNotificationsAsRead(userId: number): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db
    .update(collaborationNotifications)
    .set({ status: "read", readAt: new Date().toISOString() })
    .where(and(eq(collaborationNotifications.recipientUserId, userId), eq(collaborationNotifications.status, "sent")));
  return (result as any).affectedRows || 0;
}

/**
 * 触发协作通知
 * 当用户执行重要操作时调用此函数
 */
export async function triggerCollaborationNotification(params: {
  actionType: string;
  actionUserId: number;
  actionUserName: string;
  targetType?: string;
  targetId?: string;
  targetName?: string;
  accountId?: number;
  accountName?: string;
  metadata?: Record<string, any>;
  auditLogId?: number;
}): Promise<number> {
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
    accountName,
    metadata,
    auditLogId,
  } = params;
  
  // 检查是否是重要操作
  if (!IMPORTANT_ACTIONS.includes(actionType as any)) {
    return 0;
  }
  
  // 获取通知模板
  const template = ACTION_NOTIFICATION_TEMPLATES[actionType] || {
    title: "操作通知",
    content: "{userName} 执行了操作",
  };
  
  // 获取优先级
  const priority = ACTION_PRIORITY[actionType] || ACTION_PRIORITY.default;
  
  // 生成通知内容
  const title = template.title;
  let content = template.content
    .replace("{userName}", actionUserName)
    .replace("{targetName}", targetName || "")
    .replace("{count}", metadata?.count?.toString() || "");
  
  if (accountName) {
    content += ` (账号: ${accountName})`;
  }
  
  // 获取所有团队成员（排除操作者本人）
  const members = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.status, "active")));
  
  const recipients = members.filter((m) => m.memberId !== actionUserId);
  
  if (recipients.length === 0) {
    return 0;
  }
  
  // 为每个接收者创建通知
  let notificationCount = 0;
  for (const recipient of recipients) {
    // 检查用户通知偏好
    const prefs = await getUserNotificationPreferences(recipient.memberId || 0);
    
    // 检查是否启用应用内通知
    if (!prefs.enableAppNotifications) continue;
    
    // 检查优先级偏好
    if (priority === "low" && !prefs.notifyOnLow) continue;
    if (priority === "medium" && !prefs.notifyOnMedium) continue;
    if (priority === "high" && !prefs.notifyOnHigh) continue;
    if (priority === "critical" && !prefs.notifyOnCritical) continue;
    
    // 检查操作类型偏好
    if (actionType.startsWith("bid_") && !prefs.bidAdjustNotify) continue;
    if (actionType.startsWith("negative_") && !prefs.negativeKeywordNotify) continue;
    if (actionType.startsWith("campaign_") && !prefs.campaignChangeNotify) continue;
    if (actionType.startsWith("automation_") && !prefs.automationNotify) continue;
    if (actionType.startsWith("team_") && !prefs.teamChangeNotify) continue;
    if (actionType.startsWith("data_") && !prefs.dataImportExportNotify) continue;
    
    // 检查免打扰时段
    if (prefs.quietHoursEnabled && prefs.quietHoursStart && prefs.quietHoursEnd) {
      const now = new Date();
      const currentTime = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
      if (currentTime >= prefs.quietHoursStart && currentTime <= prefs.quietHoursEnd) {
        continue;
      }
    }
    
    // 创建应用内通知
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
      targetName: targetName || null,
      accountId: accountId || null,
      accountName: accountName || null,
      channel: "app",
      recipientUserId: recipient.memberId || 0,
      recipientEmail: recipient.email,
      status: "sent",
      sentAt: new Date().toISOString(),
      priority,
    });
    
    notificationCount++;
    
    // 如果启用邮件通知且优先级足够高，也发送邮件
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
        targetId: targetId || null,
        targetName: targetName || null,
        accountId: accountId || null,
        accountName: accountName || null,
        channel: "email",
        recipientUserId: recipient.memberId || 0,
        recipientEmail: recipient.email,
        status: "pending",
        priority,
      });
    }
  }
  
  return notificationCount;
}

/**
 * 获取通知统计
 */
export async function getNotificationStats(userId: number): Promise<{
  totalNotifications: number;
  unreadCount: number;
  byPriority: Record<string, number>;
  byActionType: Record<string, number>;
  recentNotifications: CollaborationNotification[];
}> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // 获取总数
  const [totalResult] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(collaborationNotifications)
    .where(eq(collaborationNotifications.recipientUserId, userId));
  const totalNotifications = totalResult?.count || 0;
  
  // 获取未读数
  const [unreadResult] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(collaborationNotifications)
    .where(and(eq(collaborationNotifications.recipientUserId, userId), eq(collaborationNotifications.status, "sent")));
  const unreadCount = unreadResult?.count || 0;
  
  // 按优先级统计
  const priorityStats = await db
    .select({
      priority: collaborationNotifications.priority,
      count: sql<number>`COUNT(*)`,
    })
    .from(collaborationNotifications)
    .where(eq(collaborationNotifications.recipientUserId, userId))
    .groupBy(collaborationNotifications.priority);
  
  const byPriority: Record<string, number> = {};
  for (const stat of priorityStats) {
    if (stat.priority) {
      byPriority[stat.priority] = stat.count;
    }
  }
  
  // 按操作类型统计
  const actionStats = await db
    .select({
      actionType: collaborationNotifications.actionType,
      count: sql<number>`COUNT(*)`,
    })
    .from(collaborationNotifications)
    .where(eq(collaborationNotifications.recipientUserId, userId))
    .groupBy(collaborationNotifications.actionType);
  
  const byActionType: Record<string, number> = {};
  for (const stat of actionStats) {
    if (stat.actionType) {
      byActionType[stat.actionType] = stat.count;
    }
  }
  
  // 获取最近通知
  const recentNotifications = await db
    .select()
    .from(collaborationNotifications)
    .where(eq(collaborationNotifications.recipientUserId, userId))
    .orderBy(desc(collaborationNotifications.createdAt))
    .limit(10);
  
  return {
    totalNotifications,
    unreadCount,
    byPriority,
    byActionType,
    recentNotifications,
  };
}
