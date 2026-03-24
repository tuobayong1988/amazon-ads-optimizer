/**
 * v362: 统一审计日志服务
 * 
 * 重构说明：
 * v361版本的auditLogService使用原生SQL创建独立的audit_logs表，
 * 与Drizzle schema中已定义的auditLogs表字段不匹配，导致INSERT失败。
 * 
 * v362重构：完全基于Drizzle schema的auditLogs表定义，
 * 使用Drizzle ORM进行数据写入，确保字段完全一致。
 * 
 * 记录所有敏感操作的审计日志，包括：
 * - 账户管理（创建、删除、修改凭证）
 * - 广告操作（竞价调整、预算修改、暂停/启用）
 * - 系统配置变更
 * - 数据同步操作
 * - 用户登录/登出
 * 
 * 设计原则：
 * 1. 异步写入，不阻塞主业务流程
 * 2. 结构化日志，便于查询和分析
 * 3. 不可篡改，仅追加写入
 * 4. 与Drizzle schema完全一致
 */

import { createModuleLogger } from '../utils/logger';
import { getDb } from '../db/connection';
import { auditLogs } from '../../drizzle/schema';
import { desc, eq, and, gte, lte, inArray, sql } from 'drizzle-orm';

const log = createModuleLogger('AuditLog');

// ==================== 类型定义 ====================

// 与Drizzle schema中auditLogs.actionType的enum完全一致
export type DrizzleActionType = 
  | 'account_create' | 'account_update' | 'account_delete' | 'account_connect' | 'account_disconnect'
  | 'campaign_create' | 'campaign_update' | 'campaign_delete' | 'campaign_pause' | 'campaign_enable'
  | 'bid_adjust_single' | 'bid_adjust_batch' | 'bid_rollback'
  | 'negative_add_single' | 'negative_add_batch' | 'negative_remove'
  | 'performance_group_create' | 'performance_group_update' | 'performance_group_delete'
  | 'automation_enable' | 'automation_disable' | 'automation_config_update'
  | 'scheduler_task_create' | 'scheduler_task_update' | 'scheduler_task_delete' | 'scheduler_task_run'
  | 'team_member_invite' | 'team_member_update' | 'team_member_remove' | 'team_permission_update'
  | 'data_import' | 'data_export'
  | 'settings_update' | 'notification_config_update'
  | 'other';

// 与Drizzle schema中auditLogs.targetType的enum完全一致
export type DrizzleTargetType = 
  | 'account' | 'campaign' | 'ad_group' | 'keyword' | 'product_target'
  | 'performance_group' | 'negative_keyword' | 'bid' | 'automation'
  | 'scheduler' | 'team_member' | 'permission' | 'settings' | 'data' | 'other';

// v361兼容类型 -> Drizzle类型的映射
export type AuditAction = 
  // 账户操作
  | 'account.create' | 'account.delete' | 'account.update' | 'account.credentials_update'
  // 广告操作
  | 'campaign.pause' | 'campaign.enable' | 'campaign.budget_change'
  | 'keyword.bid_change' | 'keyword.pause' | 'keyword.enable' | 'keyword.create' | 'keyword.delete'
  | 'negative_keyword.add' | 'negative_keyword.remove'
  | 'target.create' | 'target.update' | 'target.delete'
  | 'placement.adjust'
  // 同步操作
  | 'sync.manual_trigger' | 'sync.schedule_update' | 'sync.full_sync'
  // 优化操作
  | 'optimization.auto_bid' | 'optimization.auto_budget' | 'optimization.strategy_change'
  // 系统操作
  | 'system.config_change' | 'system.migration' | 'system.deploy'
  // 用户操作
  | 'user.login' | 'user.logout' | 'user.settings_change'
  // 团队操作
  | 'team.invite' | 'team.remove' | 'team.permission_change';

/**
 * 将v361风格的action映射到Drizzle schema的actionType enum
 */
function mapActionToDrizzle(action: AuditAction): DrizzleActionType {
  const mapping: Record<AuditAction, DrizzleActionType> = {
    'account.create': 'account_create',
    'account.delete': 'account_delete',
    'account.update': 'account_update',
    'account.credentials_update': 'account_update',
    'campaign.pause': 'campaign_pause',
    'campaign.enable': 'campaign_enable',
    'campaign.budget_change': 'campaign_update',
    'keyword.bid_change': 'bid_adjust_single',
    'keyword.pause': 'campaign_pause',
    'keyword.enable': 'campaign_enable',
    'keyword.create': 'other',
    'keyword.delete': 'other',
    'negative_keyword.add': 'negative_add_single',
    'negative_keyword.remove': 'negative_remove',
    'target.create': 'other',
    'target.update': 'other',
    'target.delete': 'other',
    'placement.adjust': 'other',
    'sync.manual_trigger': 'scheduler_task_run',
    'sync.schedule_update': 'scheduler_task_update',
    'sync.full_sync': 'scheduler_task_run',
    'optimization.auto_bid': 'bid_adjust_single',
    'optimization.auto_budget': 'campaign_update',
    'optimization.strategy_change': 'automation_config_update',
    'system.config_change': 'settings_update',
    'system.migration': 'other',
    'system.deploy': 'other',
    'user.login': 'other',
    'user.logout': 'other',
    'user.settings_change': 'settings_update',
    'team.invite': 'team_member_invite',
    'team.remove': 'team_member_remove',
    'team.permission_change': 'team_permission_update',
  };
  return mapping[action] || 'other';
}

/**
 * 将v361风格的entityType映射到Drizzle schema的targetType enum
 */
function mapEntityTypeToDrizzle(entityType?: string): DrizzleTargetType | undefined {
  if (!entityType) return undefined;
  const mapping: Record<string, DrizzleTargetType> = {
    'account': 'account',
    'campaign': 'campaign',
    'ad_group': 'ad_group',
    'keyword': 'keyword',
    'product_target': 'product_target',
    'performance_group': 'performance_group',
    'negative_keyword': 'negative_keyword',
    'bid': 'bid',
    'automation': 'automation',
    'scheduler': 'scheduler',
    'team_member': 'team_member',
    'team': 'team_member',
    'permission': 'permission',
    'settings': 'settings',
    'data': 'data',
    'system': 'other',
  };
  return mapping[entityType] || 'other';
}

export interface AuditLogEntry {
  /** 操作类型 */
  action: AuditAction;
  /** 操作用户ID */
  userId?: number;
  /** 操作用户名 */
  userName?: string;
  /** 关联账户ID */
  accountId?: number;
  /** 操作对象类型 (campaign, keyword, account, etc.) */
  entityType?: string;
  /** 操作对象ID */
  entityId?: string | number;
  /** 操作对象名称 */
  entityName?: string;
  /** 变更前的值 */
  previousValue?: string | Record<string, unknown>;
  /** 变更后的值 */
  newValue?: string | Record<string, unknown>;
  /** 操作来源 (api, ui, scheduler, system) */
  source?: 'api' | 'ui' | 'scheduler' | 'system' | 'migration';
  /** 操作结果 */
  result?: 'success' | 'failure' | 'partial';
  /** 错误信息（如果失败） */
  errorMessage?: string;
  /** 额外元数据 */
  metadata?: Record<string, unknown>;
  /** IP地址 */
  ipAddress?: string;
}

// ==================== 内存缓冲区 ====================

const BUFFER_SIZE = 100;
const FLUSH_INTERVAL_MS = 5000; // 5秒刷新一次
let buffer: Array<AuditLogEntry & { timestamp: string }> = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;

// ==================== 核心函数 ====================

/**
 * 记录审计日志（异步，不阻塞主流程）
 */
export function recordAudit(entry: AuditLogEntry): void {
  const timestampedEntry = {
    ...entry,
    timestamp: new Date().toISOString(),
  };
  
  buffer.push(timestampedEntry);
  
  // 同时输出到结构化日志
  log.info(`[AUDIT] ${entry.action} | user=${entry.userId || 'system'} | entity=${entry.entityType}:${entry.entityId} | result=${entry.result || 'success'}`);
  
  // 缓冲区满时立即刷新
  if (buffer.length >= BUFFER_SIZE) {
    flushBuffer().catch((err: any) => {
      log.warn(`[AuditLog] 刷新缓冲区失败: ${(err as Error).message}`);
    });
  }
  
  // 确保定时刷新器运行
  if (!flushTimer) {
    flushTimer = setInterval(() => {
      flushBuffer().catch((err: any) => {
        log.warn(`[AuditLog] 定时刷新失败: ${(err as Error).message}`);
      });
    }, FLUSH_INTERVAL_MS);
  }
}

/**
 * 刷新缓冲区到数据库 - 使用Drizzle ORM写入
 */
async function flushBuffer(): Promise<void> {
  if (buffer.length === 0) return;
  
  const entries = [...buffer];
  buffer = [];
  
  try {
    const db = await getDb();
    if (!db) {
      log.warn(`[AuditLog] 数据库不可用，${entries.length}条审计日志将丢失`);
      return;
    }
    
    // 逐条插入，使用Drizzle ORM确保字段匹配
    for (const e of entries) {
      try {
        const drizzleActionType = mapActionToDrizzle(e.action);
        const drizzleTargetType = mapEntityTypeToDrizzle(e.entityType);
        const drizzleStatus = e.result === 'failure' ? 'failed' : (e.result === 'partial' ? 'partial' : 'success');
        
        // 构建description字段
        const description = e.metadata?.description 
          ? String(e.metadata.description) 
          : `${e.action}: ${e.entityType || ''}${e.entityId ? '#' + e.entityId : ''}`;
        
        // @ts-expect-error - Drizzle enum类型兼容
        // v454: 为NOT NULL字段提供默认值，确保系统级操作也能正常写入
        await db.insert(auditLogs).values({
          actionType: drizzleActionType,
          userId: e.userId || 0,  // v454: 系统操作使用userId=0
          userName: e.userName || 'system',
          accountId: e.accountId || 0,  // v454: 系统操作使用accountId=0
          targetType: drizzleTargetType || null,
          targetId: e.entityId != null ? String(e.entityId) : null,
          targetName: e.entityName || null,
          description: description,
          previousValue: e.previousValue ? (typeof e.previousValue === 'string' ? e.previousValue : JSON.stringify(e.previousValue)) : null,
          newValue: e.newValue ? (typeof e.newValue === 'string' ? e.newValue : JSON.stringify(e.newValue)) : null,
          metadata: e.metadata ? JSON.stringify(e.metadata) : null,
          ipAddress: e.ipAddress || null,
          status: drizzleStatus,
          errorMessage: e.errorMessage || null,
        } as Record<string, unknown>);
      } catch (insertErr: any) {
        log.warn(`[AuditLog] 单条审计日志写入失败: ${(insertErr as Error).message} | action=${e.action}`);
      }
    }
    
    log.debug(`[AuditLog] 已写入${entries.length}条审计日志`);
  } catch (err: any) {
    log.warn(`[AuditLog] 写入审计日志失败: ${(err as Error).message}`);
    // 将失败的条目放回缓冲区（最多保留BUFFER_SIZE/2条）
    buffer = [...entries.slice(-Math.floor(BUFFER_SIZE / 2)), ...buffer].slice(0, BUFFER_SIZE);
  }
}

/**
 * 查询审计日志 - 使用Drizzle ORM查询
 */
export async function queryAuditLogs(params: {
  userId?: number;
  accountId?: number;
  action?: AuditAction;
  entityType?: string;
  entityId?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}): Promise<{ logs: Record<string, unknown>[]; total: number }> {
  const db = await getDb();
  if (!db) return { logs: [], total: 0 };
  
  try {
    const conditions = [];
    if (params.userId) conditions.push(eq(auditLogs.userId, params.userId));
    if (params.accountId) conditions.push(eq(auditLogs.accountId, params.accountId));
    if (params.action) {
      const drizzleAction = mapActionToDrizzle(params.action);
      conditions.push(eq(auditLogs.actionType, drizzleAction));
    }
    if (params.entityType) {
      const drizzleTarget = mapEntityTypeToDrizzle(params.entityType);
      if (drizzleTarget) {
        conditions.push(eq(auditLogs.targetType, drizzleTarget));
      }
    }
    if (params.startDate) conditions.push(gte(auditLogs.createdAt, params.startDate));
    if (params.endDate) conditions.push(lte(auditLogs.createdAt, params.endDate));
    
    const limit = Math.min(params.limit || 50, 500);
    const offset = params.offset || 0;
    
    const whereCondition = conditions.length > 0 ? and(...conditions) : undefined;
    
    const logs = await db.select().from(auditLogs)
      .where(whereCondition)
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit)
      .offset(offset);
    
    const [countResult] = await db.select({ count: sql<number>`COUNT(*)` }).from(auditLogs).where(whereCondition);
    const total = Number(countResult?.count || 0);
    
    return {
      logs: logs as unknown as Record<string, unknown>[],
      total,
    };
  } catch (err: any) {
    log.warn(`[AuditLog] 查询审计日志失败: ${(err as Error).message}`);
    return { logs: [], total: 0 };
  }
}

/**
 * 关闭审计日志服务（优雅关闭时调用）
 */
export async function shutdownAuditService(): Promise<void> {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  
  // 最后一次刷新
  await flushBuffer();
  log.info('[AuditLog] 审计日志服务已关闭');
}

// ==================== 便捷方法 ====================

/**
 * 记录账户操作审计
 */
export function auditAccountAction(
  action: 'account.create' | 'account.delete' | 'account.update' | 'account.credentials_update',
  userId: number,
  accountId: number,
  details?: { previousValue?: Record<string, unknown>; newValue?: Record<string, unknown>; entityName?: string }
): void {
  recordAudit({
    action,
    userId,
    accountId,
    entityType: 'account',
    entityId: accountId,
    entityName: details?.entityName,
    previousValue: details?.previousValue,
    newValue: details?.newValue,
    source: 'api',
    result: 'success',
  });
}

/**
 * 记录竞价调整审计
 */
export function auditBidChange(
  userId: number,
  accountId: number,
  keywordId: string | number,
  keywordText: string,
  previousBid: number,
  newBid: number,
  source: 'api' | 'ui' | 'scheduler' | 'system' = 'system'
): void {
  recordAudit({
    action: 'keyword.bid_change',
    userId,
    accountId,
    entityType: 'keyword',
    entityId: keywordId,
    entityName: keywordText,
    previousValue: { bid: previousBid },
    newValue: { bid: newBid },
    source,
    result: 'success',
    metadata: {
      changePercent: previousBid > 0 ? ((newBid - previousBid) / previousBid * 100).toFixed(2) : 'N/A',
    },
  });
}

/**
 * 记录系统操作审计
 */
export function auditSystemAction(
  action: 'system.config_change' | 'system.migration' | 'system.deploy',
  details: { description: string; metadata?: Record<string, unknown> }
): void {
  recordAudit({
    action,
    entityType: 'system',
    source: 'system',
    result: 'success',
    metadata: {
      description: details.description,
      ...details.metadata,
    },
  });
}
