/**
 * 审计日志服务 - 记录所有用户操作
 */

import { getDb } from "./db";
import { sql } from "drizzle-orm";

export type ActionType = 
  | 'login' | 'logout' | 'register'
  | 'create' | 'update' | 'delete'
  | 'sync' | 'export' | 'import'
  | 'authorize' | 'revoke'
  | 'enable' | 'disable'
  | 'bid_adjust' | 'budget_adjust'
  | 'strategy_create' | 'strategy_update' | 'strategy_delete' | 'strategy_execute'
  | 'campaign_create' | 'campaign_update' | 'campaign_pause' | 'campaign_resume'
  | 'invite_create' | 'invite_use'
  | 'permission_grant' | 'permission_revoke'
  | 'settings_update';

export type ActionCategory = 
  | 'auth' | 'user' | 'team' | 'organization'
  | 'ad_account' | 'campaign' | 'ad_group' | 'keyword' | 'product_target'
  | 'strategy' | 'optimization' | 'sync' | 'report'
  | 'invite' | 'permission' | 'settings' | 'system';

export type ResourceType = 
  | 'user' | 'team_member' | 'organization' | 'invite_code'
  | 'ad_account' | 'campaign' | 'ad_group' | 'keyword' | 'product_target'
  | 'strategy' | 'rule' | 'report' | 'sync_job'
  | 'api_credential' | 'permission' | 'settings';

export interface AuditLog {
  id: number;
  organizationId: number | null;
  userId: number | null;
  userName: string | null;
  actionType: ActionType;
  actionCategory: ActionCategory | null;
  resourceType: ResourceType | null;
  resourceId: string | null;
  resourceName: string | null;
  description: string | null;
  oldValue: any;
  newValue: any;
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
  status: 'success' | 'failed' | 'pending';
  errorMessage: string | null;
  createdAt: string;
}

export interface CreateAuditLogInput {
  organizationId?: number;
  userId?: number;
  userName?: string;
  actionType: ActionType;
  actionCategory?: ActionCategory;
  resourceType?: ResourceType;
  resourceId?: string;
  resourceName?: string;
  description?: string;
  oldValue?: any;
  newValue?: any;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
  status?: 'success' | 'failed' | 'pending';
  errorMessage?: string;
}

export interface AuditLogQuery {
  organizationId?: number;
  userId?: number;
  actionType?: ActionType;
  actionCategory?: ActionCategory;
  resourceType?: ResourceType;
  status?: 'success' | 'failed' | 'pending';
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}

export async function createAuditLog(input: CreateAuditLogInput): Promise<{ success: boolean; error?: string }> {
  const db = await getDb();
  if (!db) return { success: false, error: '数据库连接失败' };
  
  try {
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    
    await db.execute(sql`
      INSERT INTO audit_logs (
        organization_id, user_id, user_name, action_type, action_category,
        resource_type, resource_id, resource_name, description,
        old_value, new_value, ip_address, user_agent, request_id,
        status, error_message, created_at
      ) VALUES (
        ${input.organizationId || null},
        ${input.userId || null},
        ${input.userName || null},
        ${input.actionType},
        ${input.actionCategory || null},
        ${input.resourceType || null},
        ${input.resourceId || null},
        ${input.resourceName || null},
        ${input.description || null},
        ${input.oldValue ? JSON.stringify(input.oldValue) : null},
        ${input.newValue ? JSON.stringify(input.newValue) : null},
        ${input.ipAddress || null},
        ${input.userAgent || null},
        ${input.requestId || null},
        ${input.status || 'success'},
        ${input.errorMessage || null},
        ${now}
      )
    `);
    
    return { success: true };
  } catch (error: any) {
    console.error('[AuditLog] 创建审计日志失败:', error);
    return { success: false, error: error.message };
  }
}

export async function queryAuditLogs(query: AuditLogQuery): Promise<{ logs: AuditLog[]; total: number }> {
  const db = await getDb();
  if (!db) return { logs: [], total: 0 };
  
  try {
    const conditions: string[] = [];
    
    if (query.organizationId) conditions.push(`organization_id = ${query.organizationId}`);
    if (query.userId) conditions.push(`user_id = ${query.userId}`);
    if (query.actionType) conditions.push(`action_type = '${query.actionType}'`);
    if (query.actionCategory) conditions.push(`action_category = '${query.actionCategory}'`);
    if (query.resourceType) conditions.push(`resource_type = '${query.resourceType}'`);
    if (query.status) conditions.push(`status = '${query.status}'`);
    if (query.startDate) conditions.push(`created_at >= '${query.startDate}'`);
    if (query.endDate) conditions.push(`created_at <= '${query.endDate}'`);
    
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = query.limit || 50;
    const offset = query.offset || 0;
    
    const countResult = await db.execute(sql.raw(`SELECT COUNT(*) as total FROM audit_logs ${whereClause}`));
    const total = (countResult as any)[0]?.[0]?.total || 0;
    
    const result = await db.execute(sql.raw(`
      SELECT * FROM audit_logs ${whereClause}
      ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}
    `));
    
    const rows = (result as any)[0] || [];
    const logs: AuditLog[] = rows.map((row: any) => ({
      id: row.id,
      organizationId: row.organization_id,
      userId: row.user_id,
      userName: row.user_name,
      actionType: row.action_type,
      actionCategory: row.action_category,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      resourceName: row.resource_name,
      description: row.description,
      oldValue: row.old_value ? JSON.parse(row.old_value) : null,
      newValue: row.new_value ? JSON.parse(row.new_value) : null,
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      requestId: row.request_id,
      status: row.status,
      errorMessage: row.error_message,
      createdAt: row.created_at,
    }));
    
    return { logs, total };
  } catch (error) {
    console.error('[AuditLog] 查询审计日志失败:', error);
    return { logs: [], total: 0 };
  }
}

export async function logLogin(userId: number, userName: string, organizationId: number, ipAddress?: string, userAgent?: string, success: boolean = true, errorMessage?: string): Promise<void> {
  await createAuditLog({
    organizationId, userId, userName,
    actionType: 'login', actionCategory: 'auth',
    resourceType: 'user', resourceId: String(userId), resourceName: userName,
    description: success ? '用户登录成功' : '用户登录失败',
    ipAddress, userAgent, status: success ? 'success' : 'failed', errorMessage,
  });
}

export async function logSync(userId: number, userName: string, organizationId: number, accountId: number, accountName: string, syncType: string, success: boolean = true, details?: any, errorMessage?: string): Promise<void> {
  await createAuditLog({
    organizationId, userId, userName,
    actionType: 'sync', actionCategory: 'sync',
    resourceType: 'ad_account', resourceId: String(accountId), resourceName: accountName,
    description: `${syncType}数据同步${success ? '成功' : '失败'}`,
    newValue: details, status: success ? 'success' : 'failed', errorMessage,
  });
}

export async function logBidAdjust(userId: number, userName: string, organizationId: number, resourceType: 'keyword' | 'product_target', resourceId: string, resourceName: string, oldBid: number, newBid: number, reason?: string): Promise<void> {
  await createAuditLog({
    organizationId, userId, userName,
    actionType: 'bid_adjust', actionCategory: 'optimization',
    resourceType, resourceId, resourceName,
    description: reason || `出价从 $${oldBid.toFixed(2)} 调整为 $${newBid.toFixed(2)}`,
    oldValue: { bid: oldBid }, newValue: { bid: newBid }, status: 'success',
  });
}

export async function logStrategy(userId: number, userName: string, organizationId: number, actionType: 'strategy_create' | 'strategy_update' | 'strategy_delete' | 'strategy_execute', strategyId: string, strategyName: string, details?: any): Promise<void> {
  const descriptions: Record<string, string> = {
    'strategy_create': '创建优化策略', 'strategy_update': '更新优化策略',
    'strategy_delete': '删除优化策略', 'strategy_execute': '执行优化策略',
  };
  await createAuditLog({
    organizationId, userId, userName, actionType, actionCategory: 'strategy',
    resourceType: 'strategy', resourceId: strategyId, resourceName: strategyName,
    description: descriptions[actionType], newValue: details, status: 'success',
  });
}

export async function logInviteCode(userId: number, userName: string, organizationId: number, actionType: 'invite_create' | 'invite_use', inviteCode: string, details?: any): Promise<void> {
  await createAuditLog({
    organizationId, userId, userName, actionType, actionCategory: 'invite',
    resourceType: 'invite_code', resourceId: inviteCode, resourceName: inviteCode,
    description: actionType === 'invite_create' ? '创建邀请码' : '使用邀请码注册',
    newValue: details, status: 'success',
  });
}
