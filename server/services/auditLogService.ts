/**
 * v361: 统一审计日志服务
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
 */

import { createModuleLogger } from '../utils/logger';
import { getDb } from '../db/connection';
import { sql } from 'drizzle-orm';

const log = createModuleLogger('AuditLog');

// ==================== 类型定义 ====================

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
let tableCreated = false;

// ==================== 核心函数 ====================

/**
 * 确保审计日志表存在
 */
async function ensureAuditTable(): Promise<boolean> {
  if (tableCreated) return true;
  
  try {
    const db = await getDb();
    if (!db) return false;
    
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        action VARCHAR(64) NOT NULL,
        user_id INT,
        user_name VARCHAR(128),
        account_id INT,
        entity_type VARCHAR(64),
        entity_id VARCHAR(128),
        entity_name VARCHAR(256),
        previous_value TEXT,
        new_value TEXT,
        source VARCHAR(32) DEFAULT 'system',
        result VARCHAR(16) DEFAULT 'success',
        error_message TEXT,
        metadata JSON,
        ip_address VARCHAR(64),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_audit_action (action),
        INDEX idx_audit_user (user_id),
        INDEX idx_audit_account (account_id),
        INDEX idx_audit_created (created_at),
        INDEX idx_audit_entity (entity_type, entity_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    
    tableCreated = true;
    log.info('[AuditLog] 审计日志表已就绪');
    return true;
  } catch (err) {
    log.error(`[AuditLog] 创建审计日志表失败: ${(err as Error).message}`);
    return false;
  }
}

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
    flushBuffer().catch(err => {
      log.error(`[AuditLog] 刷新缓冲区失败: ${(err as Error).message}`);
    });
  }
  
  // 确保定时刷新器运行
  if (!flushTimer) {
    flushTimer = setInterval(() => {
      flushBuffer().catch(err => {
        log.error(`[AuditLog] 定时刷新失败: ${(err as Error).message}`);
      });
    }, FLUSH_INTERVAL_MS);
  }
}

/**
 * 刷新缓冲区到数据库
 */
async function flushBuffer(): Promise<void> {
  if (buffer.length === 0) return;
  
  const entries = [...buffer];
  buffer = [];
  
  try {
    const ready = await ensureAuditTable();
    if (!ready) {
      log.warn(`[AuditLog] 数据库不可用，${entries.length}条审计日志将丢失`);
      return;
    }
    
    const db = await getDb();
    if (!db) return;
    
    // 批量插入
    const values = entries.map(e => ({
      action: e.action,
      userId: e.userId || null,
      userName: e.userName || null,
      accountId: e.accountId || null,
      entityType: e.entityType || null,
      entityId: e.entityId != null ? String(e.entityId) : null,
      entityName: e.entityName || null,
      previousValue: e.previousValue ? (typeof e.previousValue === 'string' ? e.previousValue : JSON.stringify(e.previousValue)) : null,
      newValue: e.newValue ? (typeof e.newValue === 'string' ? e.newValue : JSON.stringify(e.newValue)) : null,
      source: e.source || 'system',
      result: e.result || 'success',
      errorMessage: e.errorMessage || null,
      metadata: e.metadata ? JSON.stringify(e.metadata) : null,
      ipAddress: e.ipAddress || null,
    }));
    
    // 使用原生SQL批量插入
    for (const v of values) {
      await db.execute(sql`
        INSERT INTO audit_logs (action, user_id, user_name, account_id, entity_type, entity_id, entity_name, previous_value, new_value, source, result, error_message, metadata, ip_address)
        VALUES (${v.action}, ${v.userId}, ${v.userName}, ${v.accountId}, ${v.entityType}, ${v.entityId}, ${v.entityName}, ${v.previousValue}, ${v.newValue}, ${v.source}, ${v.result}, ${v.errorMessage}, ${v.metadata}, ${v.ipAddress})
      `);
    }
    
    log.debug(`[AuditLog] 已写入${entries.length}条审计日志`);
  } catch (err) {
    log.error(`[AuditLog] 写入审计日志失败: ${(err as Error).message}`);
    // 将失败的条目放回缓冲区（最多保留BUFFER_SIZE条）
    buffer = [...entries.slice(-Math.floor(BUFFER_SIZE / 2)), ...buffer].slice(0, BUFFER_SIZE);
  }
}

/**
 * 查询审计日志
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
  const ready = await ensureAuditTable();
  if (!ready) return { logs: [], total: 0 };
  
  const db = await getDb();
  if (!db) return { logs: [], total: 0 };
  
  const conditions: string[] = ['1=1'];
  if (params.userId) conditions.push(`user_id = ${Number(params.userId)}`);
  if (params.accountId) conditions.push(`account_id = ${Number(params.accountId)}`);
  if (params.action) conditions.push(`action = '${params.action.replace(/'/g, "''")}'`);
  if (params.entityType) conditions.push(`entity_type = '${params.entityType.replace(/'/g, "''")}'`);
  if (params.startDate) conditions.push(`created_at >= '${params.startDate}'`);
  if (params.endDate) conditions.push(`created_at <= '${params.endDate}'`);
  
  const whereClause = conditions.join(' AND ');
  const limit = Math.min(params.limit || 50, 500);
  const offset = params.offset || 0;
  
  const [logs, countResult] = await Promise.all([
    db.execute(sql.raw(`SELECT * FROM audit_logs WHERE ${whereClause} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`)),
    db.execute(sql.raw(`SELECT COUNT(*) as total FROM audit_logs WHERE ${whereClause}`)),
  ]);
  
  const total = Number((countResult as unknown as Array<Record<string, unknown>>)[0]?.total || 0);
  
  return {
    logs: logs as unknown as Record<string, unknown>[],
    total,
  };
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
