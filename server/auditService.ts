/**
 * 审计日志服务
 * 记录所有团队成员的操作行为，便于追溯和合规管理
 */

import { getDb } from "./db";
import { auditLogs } from "../drizzle/schema";

// 定义类型
type InsertAuditLog = typeof auditLogs.$inferInsert;
type AuditLog = typeof auditLogs.$inferSelect;
import { eq, and, desc, gte, lte, like, inArray, sql } from "drizzle-orm";

// 操作类型分类
export const ACTION_CATEGORIES = {
  account: ["account_create", "account_update", "account_delete", "account_connect", "account_disconnect"],
  campaign: ["campaign_create", "campaign_update", "campaign_delete", "campaign_pause", "campaign_enable"],
  bid: ["bid_adjust_single", "bid_adjust_batch", "bid_rollback"],
  negative: ["negative_add_single", "negative_add_batch", "negative_remove"],
  performance_group: ["performance_group_create", "performance_group_update", "performance_group_delete"],
  automation: ["automation_enable", "automation_disable", "automation_config_update"],
  scheduler: ["scheduler_task_create", "scheduler_task_update", "scheduler_task_delete", "scheduler_task_run"],
  team: ["team_member_invite", "team_member_update", "team_member_remove", "team_permission_update"],
  data: ["data_import", "data_export"],
  settings: ["settings_update", "notification_config_update"],
} as const;

// 操作类型到中文描述的映射
export const ACTION_DESCRIPTIONS: Record<string, string> = {
  // 账号管理
  account_create: "创建广告账号",
  account_update: "更新广告账号",
  account_delete: "删除广告账号",
  account_connect: "连接广告账号",
  account_disconnect: "断开广告账号连接",
  // 广告活动管理
  campaign_create: "创建广告活动",
  campaign_update: "更新广告活动",
  campaign_delete: "删除广告活动",
  campaign_pause: "暂停广告活动",
  campaign_enable: "启用广告活动",
  // 出价调整
  bid_adjust_single: "单个出价调整",
  bid_adjust_batch: "批量出价调整",
  bid_rollback: "出价回滚",
  // 否定词管理
  negative_add_single: "添加单个否定词",
  negative_add_batch: "批量添加否定词",
  negative_remove: "移除否定词",
  // 绩效组管理
  performance_group_create: "创建绩效组",
  performance_group_update: "更新绩效组",
  performance_group_delete: "删除绩效组",
  // 自动化设置
  automation_enable: "启用自动化",
  automation_disable: "禁用自动化",
  automation_config_update: "更新自动化配置",
  // 定时任务
  scheduler_task_create: "创建定时任务",
  scheduler_task_update: "更新定时任务",
  scheduler_task_delete: "删除定时任务",
  scheduler_task_run: "手动运行定时任务",
  // 团队管理
  team_member_invite: "邀请团队成员",
  team_member_update: "更新团队成员",
  team_member_remove: "移除团队成员",
  team_permission_update: "更新成员权限",
  // 数据导入导出
  data_import: "导入数据",
  data_export: "导出数据",
  // 系统设置
  settings_update: "更新系统设置",
  notification_config_update: "更新通知配置",
  // 其他
  other: "其他操作",
};

// 目标类型到中文描述的映射
export const TARGET_TYPE_DESCRIPTIONS: Record<string, string> = {
  account: "广告账号",
  campaign: "广告活动",
  ad_group: "广告组",
  keyword: "关键词",
  product_target: "商品定位",
  performance_group: "绩效组",
  negative_keyword: "否定词",
  bid: "出价",
  automation: "自动化",
  scheduler: "定时任务",
  team_member: "团队成员",
  permission: "权限",
  settings: "设置",
  data: "数据",
  other: "其他",
};

/**
 * 创建审计日志
 */
export async function createAuditLog(data: Omit<InsertAuditLog, "id" | "createdAt">): Promise<AuditLog> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(auditLogs).values(data);
  const [log] = await db.select().from(auditLogs).where(eq(auditLogs.id, (result as any)[0]?.insertId || 0));
  return log;
}

/**
 * 记录操作审计日志的便捷函数
 */
export async function logAudit(params: {
  userId: number;
  userEmail?: string;
  userName?: string;
  actionType: InsertAuditLog["actionType"];
  targetType?: InsertAuditLog["targetType"];
  targetId?: string;
  targetName?: string;
  description?: string;
  previousValue?: any;
  newValue?: any;
  metadata?: any;
  accountId?: number;
  accountName?: string;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
  status?: "success" | "failed" | "partial";
  errorMessage?: string;
}): Promise<AuditLog> {
  // 如果没有提供描述，使用默认描述
  const description = params.description || ACTION_DESCRIPTIONS[params.actionType] || "未知操作";
  
  return createAuditLog({
    ...params,
    description,
  });
}

/**
 * 获取审计日志列表
 */
export async function getAuditLogs(params: {
  userId?: number;
  actionTypes?: string[];
  targetTypes?: string[];
  accountId?: number;
  status?: string;
  startDate?: Date;
  endDate?: Date;
  search?: string;
  page?: number;
  pageSize?: number;
}): Promise<{ logs: AuditLog[]; total: number }> {
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
    pageSize = 20,
  } = params;

  const conditions = [];

  if (userId) {
    conditions.push(eq(auditLogs.userId, userId));
  }

  if (actionTypes && actionTypes.length > 0) {
    conditions.push(inArray(auditLogs.actionType, actionTypes as any));
  }

  if (targetTypes && targetTypes.length > 0) {
    conditions.push(inArray(auditLogs.targetType, targetTypes as any));
  }

  if (accountId) {
    conditions.push(eq(auditLogs.accountId, accountId));
  }

  if (status) {
    conditions.push(eq(auditLogs.status, status as any));
  }

  if (startDate) {
    // 转换为ISO字符串格式以便与MySQL timestamp字段比较
    const startDateStr = startDate.toISOString().slice(0, 19).replace('T', ' ');
    conditions.push(gte(auditLogs.createdAt, startDateStr));
  }

  if (endDate) {
    const endDateStr = endDate.toISOString().slice(0, 19).replace('T', ' ');
    conditions.push(lte(auditLogs.createdAt, endDateStr));
  }

  if (search) {
    conditions.push(
      sql`(${auditLogs.description} LIKE ${`%${search}%`} OR ${auditLogs.targetName} LIKE ${`%${search}%`} OR ${auditLogs.userName} LIKE ${`%${search}%`})`
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // 获取总数
  const [countResult] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(auditLogs)
    .where(whereClause);
  const total = countResult?.count || 0;

  // 获取分页数据
  const offset = (page - 1) * pageSize;
  const logs = await db
    .select()
    .from(auditLogs)
    .where(whereClause)
    .orderBy(desc(auditLogs.createdAt))
    .limit(pageSize)
    .offset(offset);

  return { logs, total };
}

/**
 * 获取单个审计日志详情
 */
export async function getAuditLogById(id: number): Promise<AuditLog | null> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [log] = await db.select().from(auditLogs).where(eq(auditLogs.id, id));
  return log || null;
}

/**
 * 获取用户的操作统计
 */
export async function getUserAuditStats(userId: number, days: number = 30): Promise<{
  totalActions: number;
  actionsByType: Record<string, number>;
  actionsByDay: { date: string; count: number }[];
  recentActions: AuditLog[];
}> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  // 转换为ISO字符串格式以便与MySQL timestamp字段比较
  const startDateStr = startDate.toISOString().slice(0, 19).replace('T', ' ');

  // 获取总操作数
  const [totalResult] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(auditLogs)
    .where(and(eq(auditLogs.userId, userId), gte(auditLogs.createdAt, startDateStr)));
  const totalActions = totalResult?.count || 0;

  // 按操作类型统计
  const typeStats = await db
    .select({
      actionType: auditLogs.actionType,
      count: sql<number>`COUNT(*)`,
    })
    .from(auditLogs)
    .where(and(eq(auditLogs.userId, userId), gte(auditLogs.createdAt, startDateStr)))
    .groupBy(auditLogs.actionType);

  const actionsByType: Record<string, number> = {};
  for (const stat of typeStats) {
    actionsByType[stat.actionType] = stat.count;
  }

  // 按天统计 - 使用DATE_FORMAT避免DATE函数兼容性问题
  let dayStats: any[] = [];
  try {
    dayStats = await db
      .select({
        date: sql<string>`DATE_FORMAT(${auditLogs.createdAt}, '%Y-%m-%d')`,
        count: sql<number>`COUNT(*)`,
      })
      .from(auditLogs)
      .where(and(eq(auditLogs.userId, userId), gte(auditLogs.createdAt, startDateStr)))
      .groupBy(sql`DATE_FORMAT(${auditLogs.createdAt}, '%Y-%m-%d')`)
      .orderBy(sql`DATE_FORMAT(${auditLogs.createdAt}, '%Y-%m-%d')`);
  } catch (error) {
    console.warn("Failed to get audit logs by day:", error);
    dayStats = [];
  }

  const actionsByDay = dayStats.map((stat: { date: string; count: number }) => ({
    date: stat.date,
    count: stat.count,
  }));

  // 获取最近操作
  const recentActions = await db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.userId, userId))
    .orderBy(desc(auditLogs.createdAt))
    .limit(10);

  return {
    totalActions,
    actionsByType,
    actionsByDay,
    recentActions,
  };
}

/**
 * 获取账号的操作统计
 */
export async function getAccountAuditStats(accountId: number, days: number = 30): Promise<{
  totalActions: number;
  actionsByType: Record<string, number>;
  actionsByUser: { userId: number; userName: string; count: number }[];
}> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  // 转换为ISO字符串格式以便与MySQL timestamp字段比较
  const startDateStr = startDate.toISOString().slice(0, 19).replace('T', ' ');

  // 获取总操作数
  const [totalResult] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(auditLogs)
    .where(and(eq(auditLogs.accountId, accountId), gte(auditLogs.createdAt, startDateStr)));
  const totalActions = totalResult?.count || 0;

  // 按操作类型统计
  const typeStats = await db
    .select({
      actionType: auditLogs.actionType,
      count: sql<number>`COUNT(*)`,
    })
    .from(auditLogs)
    .where(and(eq(auditLogs.accountId, accountId), gte(auditLogs.createdAt, startDateStr)))
    .groupBy(auditLogs.actionType);

  const actionsByType: Record<string, number> = {};
  for (const stat of typeStats) {
    actionsByType[stat.actionType] = stat.count;
  }

  // 按用户统计
  const userStats = await db
    .select({
      userId: auditLogs.userId,
      userName: auditLogs.userName,
      count: sql<number>`COUNT(*)`,
    })
    .from(auditLogs)
    .where(and(eq(auditLogs.accountId, accountId), gte(auditLogs.createdAt, startDateStr)))
    .groupBy(auditLogs.userId, auditLogs.userName) as any;

  const actionsByUser = userStats.map((stat: any) => ({
    userId: stat.userId || 0,
    userName: stat.userName || "未知用户",
    count: stat.count,
  }));

  return {
    totalActions,
    actionsByType,
    actionsByUser,
  };
}

/**
 * 导出审计日志为CSV格式
 */
export async function exportAuditLogsToCSV(params: {
  userId?: number;
  actionTypes?: string[];
  accountId?: number;
  startDate?: Date;
  endDate?: Date;
}): Promise<string> {
  const { logs } = await getAuditLogs({
    ...params,
    page: 1,
    pageSize: 10000, // 最多导出10000条
  });

  const headers = [
    "ID",
    "时间",
    "操作用户",
    "用户邮箱",
    "操作类型",
    "操作描述",
    "目标类型",
    "目标名称",
    "关联账号",
    "状态",
    "IP地址",
  ];

  const rows = logs.map((log) => [
    log.id,
    String(log.createdAt),
    log.userName || "",
    log.userEmail || "",
    ACTION_DESCRIPTIONS[log.actionType] || log.actionType,
    log.description || "",
    TARGET_TYPE_DESCRIPTIONS[log.targetType || ""] || log.targetType || "",
    log.targetName || "",
    log.accountName || "",
    log.status,
    log.ipAddress || "",
  ]);

  const csvContent = [
    headers.join(","),
    ...rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")),
  ].join("\n");

  return csvContent;
}

/**
 * 清理过期的审计日志（保留指定天数）
 */
export async function cleanupOldAuditLogs(retentionDays: number = 365): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

  const result = await db.delete(auditLogs).where(lte(auditLogs.createdAt, cutoffDate.toISOString()));
  return (result as any).affectedRows || 0;
}
