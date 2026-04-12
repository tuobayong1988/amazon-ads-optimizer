/**
 * 优化任务批量同步引擎 (v137)
 * 
 * 将优化决策的制定与Amazon API同步解耦：
 * - Phase 1 (Decision): optimizationTargetEngine 只做决策，将任务写入 optimization_tasks 队列
 * - Phase 2 (Sync): 本引擎从队列读取任务，按类型分组批量调用 Amazon API
 * - Phase 3 (Confirm): 更新任务状态和日志同步状态
 * 
 * 借鉴数据同步的分层分切片分优先级设计：
 * - 按账号切片（不同账号使用不同API凭证）
 * - 按任务类型分组（同类型合并为批量API调用）
 * - 按优先级排序（P0紧急 > P1高 > P2中 > P3低）
 */

import * as db from '../db';
import * as amazonApiHelper from '../services/amazonApiHelper';
import { randomUUID } from 'crypto';
import { isShuttingDown, registerActiveTask, unregisterActiveTask } from '../utils/taskLifecycle';
import { createModuleLogger } from '../utils/logger';
import { clampBidToConstraint } from '../utils/amazonBidConstraints';
import * as Q from './optSyncQueries';

const log = createModuleLogger('OptSyncEngine');

// ============================================================
// 类型定义
// ============================================================

export interface OptimizationTask {
  batchId: string;
  optimizationTargetId: number;
  accountId: number;
  taskType: string;
  priority: number;
  targetEntityType: string;
  targetEntityId: number;
  amazonEntityId?: string;
  targetEntityName?: string;
  action: string;
  oldValue?: string;
  newValue?: string;
  changeReason?: string;
  algorithmUsed?: string;
  confidenceScore?: number;
  campaignId?: number;
  campaignName?: string;
  adGroupId?: number;
  eventId?: number;  // v509: optimization_events.id 外键关联
}

export interface BatchSyncResult {
  batchId: string;
  totalTasks: number;
  synced: number;
  failed: number;
  skipped: number;
  errors: string[];
  duration: number; // ms
}

// 批量大小配置
const BATCH_CONFIG: Record<string, { maxBatchSize: number; delayMs: number }> = {
  'bid_adjustment':        { maxBatchSize: 1000, delayMs: 200 },
  'keyword_status':        { maxBatchSize: 1000, delayMs: 200 },
  'campaign_status':       { maxBatchSize: 100,  delayMs: 200 },
  'adgroup_status':        { maxBatchSize: 100,  delayMs: 200 },
  'negative_keyword':      { maxBatchSize: 100,  delayMs: 500 },
  'new_keyword':           { maxBatchSize: 100,  delayMs: 500 },
  'placement_adjustment':  { maxBatchSize: 10,   delayMs: 200 },
  'budget_adjustment':     { maxBatchSize: 10,   delayMs: 200 },
  'dayparting_adjustment': { maxBatchSize: 1000, delayMs: 200 },
  'negative_product_target': { maxBatchSize: 50, delayMs: 500 },
};

// ============================================================
// Phase 1: 任务入队（供 optimizationTargetEngine 调用）
// ============================================================

/**
 * 将优化决策批量写入任务队列
 * @returns batchId 批次ID
 */
export async function enqueueTasks(tasks: OptimizationTask[]): Promise<string> {
  if (tasks.length === 0) return '';
  
  const batchId = tasks[0].batchId || randomUUID();
  
  // v523.2: 预过滤 - 过滤掉引用已删除实体的任务
  let filteredTasks = tasks;
  try {
    const { filterDeletedEntities } = await import('./entityStateAlignment');
    
    // 收集所有实体ID并按类型分组
    const keywordIds: number[] = [];
    const targetIds: number[] = [];
    for (const t of tasks) {
      const task = t as Record<string, unknown>;
      if (task.targetEntityType === 'keyword' && task.targetEntityId) {
        keywordIds.push(Number(task.targetEntityId));
      } else if (task.targetEntityType === 'product_target' && task.targetEntityId) {
        targetIds.push(Number(task.targetEntityId));
      }
    }
    
    // 批量检查已删除实体
    const deletedKeywords = keywordIds.length > 0 ? await filterDeletedEntities('keyword', keywordIds) : new Set<number>();
    const deletedTargets = targetIds.length > 0 ? await filterDeletedEntities('product_target', targetIds) : new Set<number>();
    
    if (deletedKeywords.size > 0 || deletedTargets.size > 0) {
      filteredTasks = tasks.filter(t => {
        const task = t as Record<string, unknown>;
        if (task.targetEntityType === 'keyword' && deletedKeywords.has(Number(task.targetEntityId))) return false;
        if (task.targetEntityType === 'product_target' && deletedTargets.has(Number(task.targetEntityId))) return false;
        return true;
      });
      const removed = tasks.length - filteredTasks.length;
      if (removed > 0) {
        log.warn(`[SyncEngine] v523.2: 预过滤移除 ${removed} 个引用已删除实体的任务 (kw=${deletedKeywords.size}, tgt=${deletedTargets.size})`);
      }
    }
  } catch (filterErr: unknown) {
    log.debug(`[SyncEngine] v523.2: 预过滤失败，继续使用原始任务列表: ${(filterErr as Error).message}`);
  }
  
  if (filteredTasks.length === 0) {
    log.info(`[SyncEngine] v523.2: 所有任务均引用已删除实体，跳过入队`);
    return '';
  }
  
  log.debug(`[SyncEngine] 入队任务: batchId=${batchId}, 总计=${filteredTasks.length}条${filteredTasks.length < tasks.length ? ` (原始${tasks.length}条, 过滤${tasks.length - filteredTasks.length}条)` : ''}`);
  
  // v350: 使用连接池获取直接连接，替代独立 createConnection
  const conn = await db.getDirectConnection();
  
  try {
    // v457: 使用类型安全查询模块批量插入任务
    await Q.insertTasks(conn, batchId, filteredTasks);
    
    log.info(`[SyncEngine] ✅ 入队完成: batchId=${batchId}, ${filteredTasks.length}条任务`);
  } finally {
    conn.release(); // v350: 归还连接到池，而不是关闭
  }
  
  return batchId;
}

// ============================================================
// Phase 2: 批量同步引擎
// ============================================================

/**
 * 执行批量同步 - 主入口
 * 从队列读取pending任务，按账号→类型→优先级分组，批量调用Amazon API
 */
export async function executeBatchSync(options?: {
  batchId?: string;       // 指定批次ID（不指定则处理所有pending）
  accountId?: number;     // 指定账号
  maxTasks?: number;      // 最大处理数量
  dryRun?: boolean;
}): Promise<BatchSyncResult> {
  const startTime = Date.now();
  const result: BatchSyncResult = {
    batchId: options?.batchId || 'all',
    totalTasks: 0,
    synced: 0,
    failed: 0,
    skipped: 0,
    errors: [],
    duration: 0,
  };
  
  // v185: 检查系统是否正在关闭
  if (isShuttingDown()) {
    log.info('[SyncEngine] 系统正在关闭，跳过批量同步');
    result.duration = Date.now() - startTime;
    return result;
  }
  
  log.info(`[SyncEngine] ========== 开始批量同步 ==========`);
  log.debug(`[SyncEngine] 参数: batchId=${options?.batchId || 'all'}, accountId=${options?.accountId || 'all'}, maxTasks=${options?.maxTasks || 'unlimited'}`);
  
  // v350: 使用连接池获取直接连接，替代独立createConnection
  const conn = await db.getDirectConnection(60_000); // 60秒超时，因为同步任务可能较长
  
  // v457: 僵尸任务清理 — 使用类型安全查询
  try {
    const zombieCount = await Q.cleanupZombieTasks(conn);
    if (zombieCount > 0) {
      log.warn(`[SyncEngine] v457: 清理${zombieCount}个僵尸任务(processing超过15分钟)`);
    }
  } catch (zombieErr: unknown) {
    log.warn(`[SyncEngine] v457: 僵尸任务清理失败: ${(zombieErr as Error).message}`);
  }
  
  // v457: 失效引用前置清理 — 使用类型安全查询
  try {
    const kwCleanCount = await Q.cleanupDeletedKeywordTasks(conn);
    if (kwCleanCount > 0) {
      log.warn(`[SyncEngine] v457: 清理${kwCleanCount}个引用已删除keyword的任务`);
    }
    
    const ptCleanCount = await Q.cleanupDeletedProductTargetTasks(conn);
    if (ptCleanCount > 0) {
      log.warn(`[SyncEngine] v457: 清理${ptCleanCount}个引用已删除product_target的任务`);
    }
  } catch (cleanErr: unknown) {
    log.warn(`[SyncEngine] v429: 失效引用清理失败: ${(cleanErr as Error).message}`);
  }
  
  const accountGroups = new Map<number, Record<string, unknown>[]>();
  try {
    // v457: 使用类型安全查询读取待处理任务
    const rows = await Q.getPendingTasks(conn, {
      batchId: options?.batchId,
      accountId: options?.accountId,
      maxTasks: options?.maxTasks,
    });
    result.totalTasks = rows.length;
    
    if (rows.length === 0) {
      log.info(`[SyncEngine] 没有待处理的同步任务`);
      result.duration = Date.now() - startTime;
      return result;
    }
    
    log.info(`[SyncEngine] 读取到 ${rows.length} 条待同步任务`);
    
    // 2. 按账号分组
    for (const row of (rows as unknown[])) {
      // @ts-expect-error v653: untyped task row from mysql2 execute result
      const accId = row.account_id;
      if (!accountGroups.has(accId)) accountGroups.set(accId, []);
      // @ts-expect-error v653: untyped task row from mysql2 execute result
      accountGroups.get(accId)!.push(row);
    }
    
    log.debug(`[SyncEngine] 分为 ${accountGroups.size} 个账号组`);
    
    // 3. v352: 逐账号串行处理，账号间加入延迟，降低API并发压力
    const ACCOUNT_SYNC_DELAY_MS = 3000; // 账号间延迟3秒
    const TYPE_SYNC_DELAY_MS = 1000;    // 任务类型间延迟1秒
    let accountIndex = 0;
    const totalAccountGroups = accountGroups.size;
    
    for (const [accountId, accountTasks] of accountGroups) {
      accountIndex++;
      log.info(`[SyncEngine] [v352] --- 处理账号 [${accountIndex}/${totalAccountGroups}] ${accountId}: ${accountTasks.length} 条任务 ---`);
      
      // 按任务类型分组
      const typeGroups = new Map<string, Record<string, unknown>[]>();
      for (const task of accountTasks) {
        const type = task.task_type;
        // @ts-expect-error v653: untyped task row from mysql2 execute result
        if (!typeGroups.has(type)) typeGroups.set(type, []);
        // @ts-expect-error v653: untyped task row from mysql2 execute result
        typeGroups.get(type)!.push(task);
      }
      
      // v352: 按类型串行处理，类型间加入延迟
      let typeIndex = 0;
      const totalTypes = typeGroups.size;
      for (const [taskType, typeTasks] of typeGroups) {
        typeIndex++;
        log.info(`[SyncEngine] [v352] 处理 ${taskType} [${typeIndex}/${totalTypes}]: ${typeTasks.length} 条`);
        
        try {
          const typeResult = await syncTasksByType(conn, accountId, taskType, typeTasks, options?.dryRun);
          result.synced += typeResult.synced;
          result.failed += typeResult.failed;
          result.skipped += typeResult.skipped;
          if (typeResult.errors.length > 0) {
            result.errors.push(...typeResult.errors.slice(0, 5));
          }
        } catch (err: unknown) {
          log.warn(`[SyncEngine] ${taskType} 处理异常: ${(err as Error).message}`);
          result.errors.push(`${taskType}: ${(err as Error).message}`);
          // 标记该类型所有任务为失败
          const taskIds = typeTasks.map((t: Record<string, unknown>) => t.id);
          // @ts-expect-error v653: untyped task row from mysql2 execute result
          await markTasksFailed(conn, taskIds, (err as Error).message);
          result.failed += typeTasks.length;
        }
        
        // v352: 任务类型间延迟
        if (typeIndex < totalTypes) {
          log.debug(`[SyncEngine] [v352] 任务类型间延迟 ${TYPE_SYNC_DELAY_MS}ms`);
          await new Promise(resolve => setTimeout(resolve, TYPE_SYNC_DELAY_MS));
        }
      }
      
      // v352: 账号间延迟
      if (accountIndex < totalAccountGroups) {
        log.info(`[SyncEngine] [v352] 账号间延迟 ${ACCOUNT_SYNC_DELAY_MS}ms`);
        await new Promise(resolve => setTimeout(resolve, ACCOUNT_SYNC_DELAY_MS));
      }
    }
    
    // 4. 更新对应的 optimization_logs 的 api_sync_status
    if (options?.batchId) {
      await updateLogsSyncStatus(conn, options.batchId);
    }
    
  } finally {
    conn.release(); // v350: 归还连接到池
  }
  
  result.duration = Date.now() - startTime;
  log.info(`[SyncEngine] ========== 批量同步完成 ==========`);
  log.warn(`[SyncEngine] 总计=${result.totalTasks}, 成功=${result.synced}, 失败=${result.failed}, 跳过=${result.skipped}, 耗时=${result.duration}ms`);
  
  // v221: 记录优化操作到审计日志，修复审计日志页面显示0次出价调整的问题
  if (result.synced > 0) {
    try {
      const { logAudit } = await import('../system/auditService');
      for (const [accountId, accountTasks] of accountGroups) {
        const bidTasks = accountTasks.filter((t: Record<string, unknown>) => t.task_type === 'bid_adjustment');
        const statusTasks = accountTasks.filter((t: Record<string, unknown>) => t.task_type === 'campaign_status' || t.task_type === 'keyword_status');
        const budgetTasks = accountTasks.filter((t: Record<string, unknown>) => t.task_type === 'budget_adjustment');
        
        // v375: 为所有操作类型添加审计日志，并修复userName显示"未知用户"问题
        const negKeywordTasks = accountTasks.filter((t: Record<string, unknown>) => t.task_type === 'negative_keyword');
        const newKeywordTasks = accountTasks.filter((t: Record<string, unknown>) => t.task_type === 'new_keyword');
        const placementTasks = accountTasks.filter((t: Record<string, unknown>) => t.task_type === 'placement_adjustment');
        const daypartingTasks = accountTasks.filter((t: Record<string, unknown>) => t.task_type === 'dayparting_adjustment');
        
        if (bidTasks.length > 0) {
          await logAudit({
            userId: 0,
            userName: '系统自动优化', // v375: 修复审计日志显示"未知用户"问题
            actionType: 'bid_adjust_batch',
            targetType: 'keyword',
            targetId: String(accountId),
            description: `自动优化: 批量调整 ${bidTasks.length} 个投放词出价`,
            accountId,
          });
        }
        if (statusTasks.length > 0) {
          await logAudit({
            userId: 0,
            userName: '系统自动优化',
            actionType: 'campaign_update',
            targetType: 'campaign',
            targetId: String(accountId),
            description: `自动优化: 批量变更 ${statusTasks.length} 个广告活动/关键词状态`,
            accountId,
          });
        }
        if (budgetTasks.length > 0) {
          await logAudit({
            userId: 0,
            userName: '系统自动优化',
            actionType: 'campaign_update',
            targetType: 'campaign',
            targetId: String(accountId),
            description: `自动优化: 批量调整 ${budgetTasks.length} 个广告活动预算`,
            accountId,
          });
        }
        // v375: 新增否定关键词审计日志
        if (negKeywordTasks.length > 0) {
          await logAudit({
            userId: 0,
            userName: '系统自动优化',
            actionType: 'campaign_update',
            targetType: 'keyword',
            targetId: String(accountId),
            description: `自动优化: 批量添加 ${negKeywordTasks.length} 个否定关键词`,
            accountId,
          });
        }
        // v375: 新增搜索词收割审计日志
        if (newKeywordTasks.length > 0) {
          await logAudit({
            userId: 0,
            userName: '系统自动优化',
            actionType: 'campaign_update',
            targetType: 'keyword',
            targetId: String(accountId),
            description: `自动优化: 搜索词收割 - 新增 ${newKeywordTasks.length} 个投放关键词`,
            accountId,
          });
        }
        // v375: 新增位置倾斜审计日志
        if (placementTasks.length > 0) {
          await logAudit({
            userId: 0,
            userName: '系统自动优化',
            actionType: 'campaign_update',
            targetType: 'campaign',
            targetId: String(accountId),
            description: `自动优化: 调整 ${placementTasks.length} 个广告活动位置倾斜`,
            accountId,
          });
        }
        // v375: 新增分时调整审计日志
        if (daypartingTasks.length > 0) {
          await logAudit({
            userId: 0,
            userName: '系统自动优化',
            actionType: 'campaign_update',
            targetType: 'campaign',
            targetId: String(accountId),
            description: `自动优化: 分时调整 ${daypartingTasks.length} 个广告活动`,
            accountId,
          });
        }
      }
    } catch (auditErr: unknown) {
      log.warn(`[SyncEngine] v221: 记录审计日志失败: ${(auditErr as Error).message}`);
    }
  }
  
  // v219: 优化命令执行后触发确认同步，从 Amazon 回读最新状态防止重复优化
  if (result.synced > 0) {
    try {
      const { confirmationSync } = await import('./unifiedSyncEngine');
      // 收集受影响的账户和实体类型
      const affectedAccounts = new Map<number, Set<string>>();
      for (const [accountId, accountTasks] of accountGroups) {
        const entities = new Set<string>();
        for (const task of accountTasks) {
          if (task.task_type === 'bid_adjustment') {
            if (task.target_entity_type === 'keyword') entities.add('keywords');
            if (task.target_entity_type === 'product_target') entities.add('targets');
          } else if (task.task_type === 'campaign_status') {
            entities.add('campaigns');
          } else if (task.task_type === 'budget_adjustment') {
            entities.add('budgets');
          } else if (task.task_type === 'keyword_status') {
            entities.add('keywords');
          }
        }
        if (entities.size > 0) {
          affectedAccounts.set(accountId, entities);
        }
      }
      
      // v359: 使用可靠确认服务替代fire-and-forget模式
      const { submitReliableConfirmation } = await import('../services/commandConfirmationService');
      for (const [accountId, entities] of affectedAccounts) {
        const entityArray = Array.from(entities) as ('campaigns' | 'ad_groups' | 'keywords' | 'targets' | 'budgets')[];
        // 根据任务类型确定操作类型
        const hasKeywords = entityArray.includes('keywords');
        const hasBudgets = entityArray.includes('budgets');
        const hasCampaigns = entityArray.includes('campaigns');
        const opType = hasKeywords ? 'bid_change' : hasBudgets ? 'budget_change' : hasCampaigns ? 'status_change' : 'general';
        const requestId = submitReliableConfirmation(accountId, entityArray, 'optimizationSyncEngine', opType);
        log.info(`[SyncEngine] v359: 提交可靠确认请求 - 账户${accountId}: ${requestId}`);
      }
    } catch (confirmErr: unknown) {
      log.warn(`[SyncEngine] v219: 触发确认同步异常: ${(confirmErr as Error).message}`);
    }
  }
  
  return result;
}

/**
 * 按任务类型批量同步到Amazon
 */
async function syncTasksByType(
  // @ts-expect-error - runtime type mismatch
  conn: DbInstance,
  accountId: number,
  taskType: string,
  tasks: unknown[],
  dryRun?: boolean
): Promise<{ synced: number; failed: number; skipped: number; errors: string[] }> {
  const result = { synced: 0, failed: 0, skipped: 0, errors: [] as string[] };
  const config = BATCH_CONFIG[taskType] || { maxBatchSize: 100, delayMs: 500 };
  
  // 获取Amazon API服务
  const syncService = await amazonApiHelper.getAmazonSyncService(accountId);
  if (!syncService) {
    const msg = `账号 ${accountId} 无法获取API服务`;
    result.errors.push(msg);
    result.failed = tasks.length;
    // @ts-expect-error v653: untyped task row from mysql2 execute result
    await markTasksFailed(conn, tasks.map((t: Record<string, unknown>) => t.id), msg);
    return result;
  }
  
  // v457: 标记任务为processing — 使用类型安全查询
  // @ts-expect-error v653: untyped task row from mysql2 execute result
  const taskIds = tasks.map((t: Record<string, unknown>) => t.id);
  if (taskIds.length > 0) {
    await Q.markTasksProcessing(conn, taskIds as number[]);
  }
  
  if (dryRun) {
    log.info(`[SyncEngine] [DryRun] 跳过 ${tasks.length} 条 ${taskType} 任务`);
    result.skipped = tasks.length;
    return result;
  }
  
  // 按批次处理
  for (let i = 0; i < tasks.length; i += config.maxBatchSize) {
    const batch = tasks.slice(i, i + config.maxBatchSize);
    
    try {
      // @ts-expect-error v653: untyped task row from mysql2 execute result
      const batchResult = await executeBatchByType(conn, syncService, taskType, batch);
      result.synced += batchResult.synced;
      result.failed += batchResult.failed;
      result.errors.push(...batchResult.errors);
    } catch (err: unknown) {
      log.warn(`[SyncEngine] 批次 ${i / config.maxBatchSize + 1} 异常: ${(err as Error).message}`);
      result.errors.push((err as Error).message);
      // @ts-expect-error v653: untyped task row from mysql2 execute result
      await markTasksFailed(conn, batch.map((t: Record<string, unknown>) => t.id), (err as Error).message);
      result.failed += batch.length;
    }
    
    // 批间延迟
    if (i + config.maxBatchSize < tasks.length) {
      await new Promise(resolve => setTimeout(resolve, config.delayMs));
    }
  }
  
  return result;
}

/**
 * 执行单个批次的Amazon API同步
 */
async function executeBatchByType(
  // @ts-expect-error - runtime type mismatch
  conn: DbInstance,
  syncService: Record<string, unknown>,
  taskType: string,
  batch: unknown[]
): Promise<{ synced: number; failed: number; skipped: number; errors: string[] }> {
  const result = { synced: 0, failed: 0, skipped: 0, errors: [] as string[] };
  
  switch (taskType) {
    case 'bid_adjustment': {
      // v138: 先尝试从数据库查找缺失的Amazon ID
      for (const t of (batch as unknown[])) {
        // @ts-expect-error v653: untyped task row from mysql2 execute result
        if (!t.amazon_entity_id && t.target_entity_id) {
          try {
            // @ts-expect-error v653: untyped task row from mysql2 execute result
            if (t.target_entity_type === 'keyword') {
              // @ts-expect-error v653: untyped task row from mysql2 execute result
              const kwAmazonId = await Q.getKeywordAmazonId(conn, t.target_entity_id);
              if (kwAmazonId) {
                // @ts-expect-error v653: untyped task row from mysql2 execute result
                t.amazon_entity_id = kwAmazonId;
                // @ts-expect-error v653: untyped task row from mysql2 execute result
                await Q.updateTaskAmazonEntityId(conn, t.id, kwAmazonId);
                // @ts-expect-error v653: untyped task row from mysql2 execute result
                log.debug(`[SyncEngine] v457: 自动查找到keyword Amazon ID: local=${t.target_entity_id} -> amazon=${t.amazon_entity_id}`);
              }
            // @ts-expect-error v653: untyped task row from mysql2 execute result
            } else if (t.target_entity_type === 'product_target') {
              // @ts-expect-error v653: untyped task row from mysql2 execute result
              const ptAmazonId = await Q.getProductTargetAmazonId(conn, t.target_entity_id);
              if (ptAmazonId) {
                // @ts-expect-error v653: untyped task row from mysql2 execute result
                t.amazon_entity_id = ptAmazonId;
                // @ts-expect-error v653: untyped task row from mysql2 execute result
                await Q.updateTaskAmazonEntityId(conn, t.id, ptAmazonId);
                // @ts-expect-error v653: untyped task row from mysql2 execute result
                log.debug(`[SyncEngine] v457: 自动查找到product_target Amazon ID: local=${t.target_entity_id} -> amazon=${t.amazon_entity_id}`);
              }
            }
          } catch (lookupErr: unknown) {
            log.warn(`[SyncEngine] v138: 查找Amazon ID失败: ${(lookupErr as Error).message}`);
          }
        }
      }
      
      // v428: P2修复 — Amazon ID前置校验，检查target_entity_id对应的记录是否仍然存在
      // 避免对已删除的关键词/定向发送API请求
      const validatedBatch: unknown[] = [];
      for (const t of (batch as unknown[])) {
        // @ts-expect-error v653: untyped task row from mysql2 execute result
        if (t.target_entity_id) {
          try {
            // @ts-expect-error v653: untyped task row from mysql2 execute result
            const checkTable = t.target_entity_type === 'keyword' ? 'keywords' : 'product_targets';
            // @ts-expect-error v653: untyped task row from mysql2 execute result
            const exists = await Q.entityExists(conn, checkTable, t.target_entity_id);
            if (!exists) {
              // @ts-expect-error v653: untyped task row from mysql2 execute result
              await markTaskFailed(conn, t.id, `v428: 目标实体已不存在 (${checkTable}.id=${t.target_entity_id})`);
              result.failed++;
              continue;
            }
          } catch { /* 校验失败不阻塞执行 */ }
        }
        validatedBatch.push(t);
      }
      
      // 分离keyword和product_target
      // @ts-expect-error v653: untyped task row from mysql2 execute result
      const kwTasks = validatedBatch.filter((t: Record<string, unknown>) => t.target_entity_type === 'keyword' && t.amazon_entity_id);
      // @ts-expect-error v653: untyped task row from mysql2 execute result
      const ptTasks = validatedBatch.filter((t: Record<string, unknown>) => t.target_entity_type === 'product_target' && t.amazon_entity_id);
      // @ts-expect-error v653: untyped task row from mysql2 execute result
      const noIdTasks = validatedBatch.filter((t: Record<string, unknown>) => !t.amazon_entity_id);
      
      // v429: 使用集中式entityIdResolver批量解析缺失的Amazon ID（替代v141的逐个即时回填）
      // entityIdResolver内置10分钟缓存，显著降低数据库查询压力
      if (noIdTasks.length > 0) {
        log.debug(`[SyncEngine] v429: ${noIdTasks.length}条任务缺少Amazon ID，使用entityIdResolver批量解析...`);
        try {
          const { batchResolveKeywordIds, batchResolveProductTargetIds } = await import('../services/entityIdResolver');
          
          // 分离keyword和product_target的无ID任务
          // @ts-expect-error v653: untyped task row from mysql2 execute result
          const noIdKwTasks = noIdTasks.filter((t: Record<string, unknown>) => t.target_entity_type === 'keyword');
          // @ts-expect-error v653: untyped task row from mysql2 execute result
          const noIdPtTasks = noIdTasks.filter((t: Record<string, unknown>) => t.target_entity_type === 'product_target');
          
          // 批量解析keyword IDs
          if (noIdKwTasks.length > 0) {
            // @ts-expect-error v653: untyped task row from mysql2 execute result
            const kwIds = noIdKwTasks.map((t: Record<string, unknown>) => t.target_entity_id);
            // @ts-expect-error v653: untyped task row from mysql2 execute result
            const kwResult = await batchResolveKeywordIds(kwIds);
            for (const t of noIdKwTasks) {
              // @ts-expect-error v653: untyped task row from mysql2 execute result
              const resolved = kwResult.resolved.get(t.target_entity_id);
              if (resolved) {
                // @ts-expect-error v653: untyped task row from mysql2 execute result
                t.amazon_entity_id = resolved.amazonId;
                // @ts-expect-error v653: untyped task row from mysql2 execute result
                await Q.updateTaskAmazonEntityId(conn, t.id, resolved.amazonId);
                kwTasks.push(t);
                // @ts-expect-error v653: untyped task row from mysql2 execute result
                log.debug(`[SyncEngine] v457: ✅ 批量解析keyword: id=${t.target_entity_id} -> ${resolved.amazonId}`);
              } else {
                // 回退到旧的amazonIdResolver即时回填（处理keywordId为NULL需要通过API创建的情况）
                try {
                  const { resolveKeywordIdOnDemand } = await import('../services/amazonIdResolver');
                  // @ts-expect-error v653: untyped task row from mysql2 execute result
                  const resolvedId = await resolveKeywordIdOnDemand(t.account_id, t.target_entity_id);
                  if (resolvedId) {
                    // @ts-expect-error v653: untyped task row from mysql2 execute result
                    t.amazon_entity_id = resolvedId;
                    // @ts-expect-error v653: untyped task row from mysql2 execute result
                    await Q.updateTaskAmazonEntityId(conn, t.id, resolvedId);
                    kwTasks.push(t);
                    // @ts-expect-error v653: untyped task row from mysql2 execute result
                    log.info(`[SyncEngine] v457: ✅ 回退即时回填成功: keyword id=${t.target_entity_id} -> ${resolvedId}`);
                  } else {
                    // @ts-expect-error v653: untyped task row from mysql2 execute result
                    await markTaskFailed(conn, t.id, '缺少Amazon ID（entityIdResolver+即时回填均失败）');
                    result.failed++;
                  }
                } catch (fallbackErr: unknown) {
                  // @ts-expect-error v653: untyped task row from mysql2 execute result
                  await markTaskFailed(conn, t.id, `ID解析失败: ${(fallbackErr as Error).message}`);
                  result.failed++;
                }
              }
            }
          }
          
          // 批量解析product_target IDs
          if (noIdPtTasks.length > 0) {
            // @ts-expect-error v653: untyped task row from mysql2 execute result
            const ptIds = noIdPtTasks.map((t: Record<string, unknown>) => t.target_entity_id);
            // @ts-expect-error v653: untyped task row from mysql2 execute result
            const ptResult = await batchResolveProductTargetIds(ptIds);
            for (const t of noIdPtTasks) {
              // @ts-expect-error v653: untyped task row from mysql2 execute result
              const resolved = ptResult.resolved.get(t.target_entity_id);
              if (resolved) {
                // @ts-expect-error v653: untyped task row from mysql2 execute result
                t.amazon_entity_id = resolved.amazonId;
                // @ts-expect-error v653: untyped task row from mysql2 execute result
                await Q.updateTaskAmazonEntityId(conn, t.id, resolved.amazonId);
                ptTasks.push(t);
                // @ts-expect-error v653: untyped task row from mysql2 execute result
                log.debug(`[SyncEngine] v457: ✅ 批量解析product_target: id=${t.target_entity_id} -> ${resolved.amazonId}`);
              } else {
                try {
                  const { resolveProductTargetIdOnDemand } = await import('../services/amazonIdResolver');
                  // @ts-expect-error v653: untyped task row from mysql2 execute result
                  const resolvedId = await resolveProductTargetIdOnDemand(t.account_id, t.target_entity_id);
                  if (resolvedId) {
                    // @ts-expect-error v653: untyped task row from mysql2 execute result
                    t.amazon_entity_id = resolvedId;
                    // @ts-expect-error v653: untyped task row from mysql2 execute result
                    await Q.updateTaskAmazonEntityId(conn, t.id, resolvedId);
                    ptTasks.push(t);
                    // @ts-expect-error v653: untyped task row from mysql2 execute result
                    log.info(`[SyncEngine] v457: ✅ 回退即时回填成功: product_target id=${t.target_entity_id} -> ${resolvedId}`);
                  } else {
                    // @ts-expect-error v653: untyped task row from mysql2 execute result
                    await markTaskFailed(conn, t.id, '缺少Amazon ID（entityIdResolver+即时回填均失败）');
                    result.failed++;
                  }
                } catch (fallbackErr: unknown) {
                  // @ts-expect-error v653: untyped task row from mysql2 execute result
                  await markTaskFailed(conn, t.id, `ID解析失败: ${(fallbackErr as Error).message}`);
                  result.failed++;
                }
              }
            }
          }
        } catch (resolverErr: unknown) {
          // entityIdResolver未初始化时回退到旧的amazonIdResolver
          log.warn(`[SyncEngine] v429: entityIdResolver不可用，回退到amazonIdResolver: ${(resolverErr as Error).message}`);
          try {
            const { resolveKeywordIdOnDemand, resolveProductTargetIdOnDemand } = await import('../services/amazonIdResolver');
            for (const t of noIdTasks) {
              try {
                let resolvedId: string | null = null;
                // @ts-expect-error v653: untyped task row from mysql2 execute result
                if (t.target_entity_type === 'keyword') {
                  // @ts-expect-error v653: untyped task row from mysql2 execute result
                  resolvedId = await resolveKeywordIdOnDemand(t.account_id, t.target_entity_id);
                // @ts-expect-error v653: untyped task row from mysql2 execute result
                } else if (t.target_entity_type === 'product_target') {
                  // @ts-expect-error v653: untyped task row from mysql2 execute result
                  resolvedId = await resolveProductTargetIdOnDemand(t.account_id, t.target_entity_id);
                }
                if (resolvedId) {
                  // @ts-expect-error v653: untyped task row from mysql2 execute result
                  t.amazon_entity_id = resolvedId;
                  // @ts-expect-error v653: untyped task row from mysql2 execute result
                  await Q.updateTaskAmazonEntityId(conn, t.id, resolvedId);
                  // @ts-expect-error v653: untyped task row from mysql2 execute result
                  if (t.target_entity_type === 'keyword') kwTasks.push(t); else ptTasks.push(t);
                } else {
                  // @ts-expect-error v653: untyped task row from mysql2 execute result
                  await markTaskFailed(conn, t.id, '缺少Amazon ID（已尝试即时回填）');
                  result.failed++;
                }
              } catch (resolveErr: unknown) {
                // @ts-expect-error v653: untyped task row from mysql2 execute result
                await markTaskFailed(conn, t.id, `即时回填异常: ${(resolveErr as Error).message}`);
                result.failed++;
              }
            }
          } catch (importErr: unknown) {
            // @ts-expect-error v653: untyped task row from mysql2 execute result
            await markTasksFailed(conn, noIdTasks.map((t: Record<string, unknown>) => t.id), '缺少Amazon ID（所有解析器均不可用）');
            result.failed += noIdTasks.length;
          }
        }
      }
      
      // v224: 区分SP和SB关键词，使用不同的API端点
      // SB/SBV广告活动的关键词需要使用SB API，SP广告活动使用SP API
      if (kwTasks.length > 0) {
        // 查询每个关键词所属campaign的类型
        const spKwTasks: unknown[] = [];
        const sbKwTasks: unknown[] = [];
        
        for (const t of kwTasks) {
          try {
            let campaignType = 'sp_manual'; // 默认SP
            let kwMarketplace = 'US'; // v434: 默认US，动态获取
            let kwCostType = 'cpc'; // v434: 默认CPC
            // v456: 使用类型安全查询替代原生SQL，避免列名硬编码错误
            // @ts-expect-error v653: untyped task row from mysql2 execute result
            if (t.campaign_id) {
              // @ts-expect-error v653: untyped task row from mysql2 execute result
              const campInfo = await Q.getCampaignTypeById(conn, t.campaign_id);
              if (campInfo) {
                campaignType = campInfo.campaignType;
                kwMarketplace = campInfo.marketplace;
                kwCostType = campInfo.costType;
              }
            // @ts-expect-error v653: untyped task row from mysql2 execute result
            } else if (t.target_entity_id) {
              // @ts-expect-error v653: untyped task row from mysql2 execute result
              const kwCampInfo = await Q.getCampaignTypeByKeywordId(conn, t.target_entity_id);
              if (kwCampInfo) {
                campaignType = kwCampInfo.campaignType;
                kwMarketplace = kwCampInfo.marketplace;
                kwCostType = kwCampInfo.costType;
              }
            }
            // v434: 保存marketplace和costType到任务对象，供后续bid constraint使用
            // @ts-expect-error v653: untyped task row from mysql2 execute result
            t._marketplace = kwMarketplace;
            // @ts-expect-error v653: untyped task row from mysql2 execute result
            t._costType = kwCostType;
            
            if (campaignType === 'sb') {
              sbKwTasks.push(t);
            } else {
              spKwTasks.push(t);
            }
          } catch (typeErr: unknown) {
            log.warn(`[SyncEngine] v224: 查询campaign类型失败: ${(typeErr as Error).message}, 默认使用SP API`);
            spKwTasks.push(t);
          }
        }
        
        if (sbKwTasks.length > 0) {
          log.info(`[SyncEngine] v224: 检测到${sbKwTasks.length}个SB关键词，使用SB API同步出价`);
        }
        
        // SP关键词出价同步
        if (spKwTasks.length > 0) {
          try {
            // v434: SP keyword bid约束保护 — 确保竞价在Amazon允许范围内
            // @ts-expect-error v653: untyped task row from mysql2 execute result
            const spBidUpdates = spKwTasks.map((t: Record<string, unknown>) => {
              // @ts-expect-error v653: untyped task row from mysql2 execute result
              const rawBid = Number(parseFloat(t.new_value).toFixed(2));
              const spMarketplace = t._marketplace || 'US';
              // @ts-expect-error v653: untyped task row from mysql2 execute result
              const { clampedBid, wasAdjusted, constraint, adTypeKey } = clampBidToConstraint(rawBid, 'sp_manual', spMarketplace, 'cpc');
              if (wasAdjusted) {
                log.info(`[SyncEngine] v434: SP keyword ${t.amazon_entity_id} bid $${rawBid} 超出${adTypeKey}约束[$${constraint.minBid}~$${constraint.maxBid}]，调整为$${clampedBid}`);
              }
              return {
                keywordId: String(t.amazon_entity_id),
                bid: clampedBid,
              };
            });
            // @ts-expect-error v653: untyped task row from mysql2 execute result
            const apiResult: unknown = await (syncService as Record<string, unknown>).client.updateKeywordBids(spBidUpdates);
            
            const failedIds = new Map<string, string>();
            // @ts-expect-error v653: untyped task row from mysql2 execute result
            if (apiResult.errors && apiResult.errors.length > 0) {
              // @ts-expect-error v653: untyped task row from mysql2 execute result
              for (const err of apiResult.errors) {
                // v444: 增强错误记录 - 保存完整错误信息
                const errDetail = err.details || (err as Record<string, unknown>).code || JSON.stringify(err).substring(0, 200) || 'API_ERROR';
                failedIds.set(String(err.keywordId), errDetail);
              }
            }
            
            for (const t of spKwTasks) {
              // @ts-expect-error v653: untyped task row from mysql2 execute result
              const spFailReason = failedIds.get(String(t.amazon_entity_id));
              if (spFailReason) {
                // v431: DUPLICATE视为成功 — bid已是目标值
                if (spFailReason === 'DUPLICATE' || spFailReason.includes('DUPLICATE')) {
                  // @ts-expect-error v653: untyped task row from mysql2 execute result
                  log.info(`[SyncEngine] v431: SP keyword ${t.amazon_entity_id} DUPLICATE视为成功`);
                  // @ts-expect-error v653: untyped task row from mysql2 execute result
                  await markTaskSynced(conn, t.id);
                  // @ts-expect-error v653: untyped task row from mysql2 execute result
                  await updateLocalBid(conn, 'keyword', t.target_entity_id, t.new_value);
                  result.synced++;
                } else {
                  // v509: 使用统一错误码映射表替代硬编码字符串匹配
                  const { classifyError, shouldMarkEntityDeleted } = await import('../services/amazonApiErrorMapper');
                  const spErrorMapping = classifyError(spFailReason);
                  if (shouldMarkEntityDeleted(spFailReason)) {
                    // @ts-expect-error v653: untyped task row from mysql2 execute result
                    await markTaskFailed(conn, t.id, `[v509-${spErrorMapping.code}] ${spFailReason}`);
                    try {
                      // @ts-expect-error v653: untyped task row from mysql2 execute result
                      await Q.markKeywordDeleted(conn, t.target_entity_id, String(t.amazon_entity_id));
                      // @ts-expect-error v653: untyped task row from mysql2 execute result
                      log.warn(`[SyncEngine] v509: SP Keyword ${t.amazon_entity_id} 错误码=${spErrorMapping.code}, 已标记为amazon_deleted`);
                    } catch (markErr: unknown) {
                      log.warn(`[SyncEngine] v509: 标记Keyword deleted失败: ${(markErr as Error).message}`);
                    }
                  } else {
                    // @ts-expect-error v653: untyped task row from mysql2 execute result
                    await markTaskForRetry(conn, t.id, t.retry_count, spFailReason);
                  }
                  result.failed++;
                }
              } else {
                // @ts-expect-error v653: untyped task row from mysql2 execute result
                await markTaskSynced(conn, t.id);
                // @ts-expect-error v653: untyped task row from mysql2 execute result
                await updateLocalBid(conn, 'keyword', t.target_entity_id, t.new_value);
                result.synced++;
              }
            }
            
            log.warn(`[SyncEngine] SP关键词出价批量同步: 发送=${spKwTasks.length}, 成功=${spKwTasks.length - failedIds.size}, 失败=${failedIds.size}`);
          } catch (err: unknown) {
            log.warn(`[SyncEngine] SP关键词出价批量API调用失败: ${(err as Error).message}`);
            for (const t of spKwTasks) {
              // @ts-expect-error v653: untyped task row from mysql2 execute result
              await markTaskForRetry(conn, t.id, t.retry_count, (err as Error).message);
            }
            result.failed += spKwTasks.length;
            result.errors.push(`SP关键词出价API失败: ${(err as Error).message}`);
          }
        }
        
        // v429: SB关键词出价同步 — 使用SB v3 API (PUT /sb/keywords)
        // 修复v428/v428.2的403/406错误：v3端点要求adGroupId和campaignId为必填字段
        if (sbKwTasks.length > 0) {
          try {
            // v429: 为每个SB关键词任务查询关联的Amazon adGroupId和campaignId
            const sbUpdates: Array<{ keywordId: string; bid: number; adGroupId: string; campaignId: string }> = [];
            const sbSkippedTasks: unknown[] = [];
            
            for (const t of sbKwTasks) {
              try {
                // v456: 使用类型安全查询替代原生SQL
                // @ts-expect-error v653: untyped task row from mysql2 execute result
                const kwDetail = await Q.getKeywordDetailById(conn, t.target_entity_id);
                
                if (kwDetail && kwDetail.amazonAdGroupId && kwDetail.amazonCampaignId) {
                  // v436: SB keyword最侎bid保护 — 增强ad_format获取，支持campaign名称推断
                  // @ts-expect-error v653: untyped task row from mysql2 execute result
                  let sbBid = Number(parseFloat(t.new_value).toFixed(2));
                  let sbAdFormat: string | null = null;
                  let sbMarketplace = 'US';
                  const campDetail = await Q.getCampaignDetailByAmazonId(conn, kwDetail.amazonCampaignId);
                  if (campDetail) {
                    sbAdFormat = campDetail.adFormat;
                    sbMarketplace = campDetail.marketplace;
                    // v436: 如果ad_format为NULL，从campaign名称推断
                    if (!sbAdFormat && campDetail.campaignName) {
                      const campName = campDetail.campaignName.toUpperCase();
                      if (campName.includes('SBV') || campName.includes('VIDEO')) {
                        sbAdFormat = 'video';
                        log.info(`[SyncEngine] v436: 从campaign名称推断SBV: ${campDetail.campaignName}`);
                      }
                    }
                  }
                  // v436: 也从任务的campaign_name推断
                  // @ts-expect-error v653: untyped task row from mysql2 execute result
                  if (!sbAdFormat && t.campaign_name) {
                    // @ts-expect-error v653: untyped task row from mysql2 execute result
                    const taskCampName = String(t.campaign_name).toUpperCase();
                    if (taskCampName.includes('SBV') || taskCampName.includes('VIDEO')) {
                      sbAdFormat = 'video';
                    }
                  }
                  const { clampedBid: clampedSbBid, wasAdjusted: sbWasAdjusted, constraint: sbConstraint, adTypeKey: sbAdTypeKey } = clampBidToConstraint(sbBid, 'sb', sbMarketplace, 'cpc', sbAdFormat);
                  if (sbWasAdjusted) {
                    log.info(`[SyncEngine] v434: SB keyword bid $${sbBid} 超出${sbAdTypeKey}约束[$${sbConstraint.minBid}~$${sbConstraint.maxBid}]，调整为$${clampedSbBid} (marketplace=${sbMarketplace})`);
                  }
                  sbBid = clampedSbBid;
                  sbUpdates.push({
                    // @ts-expect-error v653: untyped task row from mysql2 execute result
                    keywordId: String(t.amazon_entity_id),
                    bid: sbBid,
                    adGroupId: String(kwDetail.amazonAdGroupId),
                    campaignId: String(kwDetail.amazonCampaignId),
                  });
                } else {
                  // 无法获取关联ID，标记失败
                  // @ts-expect-error v653: untyped task row from mysql2 execute result
                  await markTaskFailed(conn, t.id, 'v429: 无法获取SB关键词的adGroupId或campaignId');
                  result.failed++;
                  sbSkippedTasks.push(t);
                }
              } catch (detailErr: unknown) {
                // @ts-expect-error v653: untyped task row from mysql2 execute result
                await markTaskForRetry(conn, t.id, t.retry_count, `v429: 查询SB关键词详情失败: ${(detailErr as Error).message}`);
                result.failed++;
                sbSkippedTasks.push(t);
              }
            }
            
            // 过滤掉已跳过的任务
            const activeSbTasks = sbKwTasks.filter(t => !sbSkippedTasks.includes(t));
            
            if (sbUpdates.length > 0) {
              log.info(`[SyncEngine] v429: SB关键词出价准备完成: 有效=${sbUpdates.length}, 跳过=${sbSkippedTasks.length}`);
            }
            
            // v429: 调用修复后的updateSbKeywordBids，现在传递完整的adGroupId和campaignId
            const sbApiResult = sbUpdates.length > 0 
              // @ts-expect-error v653: untyped task row from mysql2 execute result
              ? await (syncService as Record<string, unknown>).client.updateSbKeywordBids(sbUpdates)
              : { successes: [], errors: [] };
            
            // v428: 构建keywordId到失败原因的映射
            const sbFailedIds = new Map<string, string>();
            if (sbApiResult.errors && sbApiResult.errors.length > 0) {
              for (const err of sbApiResult.errors) {
                // v444: 增强错误记录 - 保存完整错误信息
                const sbErrDetail = err.details || err.code || JSON.stringify(err).substring(0, 200) || 'SB_API_ERROR';
                sbFailedIds.set(String(err.keywordId), sbErrDetail);
              }
            }
            
            for (const t of activeSbTasks) {
              // @ts-expect-error v653: untyped task row from mysql2 execute result
              const failReason = sbFailedIds.get(String(t.amazon_entity_id));
              if (failReason) {
                // v431: DUPLICATE视为成功 — 表示bid已经是目标值，无需重试
                if (failReason === 'DUPLICATE' || failReason.includes('DUPLICATE')) {
                  // @ts-expect-error v653: untyped task row from mysql2 execute result
                  log.info(`[SyncEngine] v431: SB keyword ${t.amazon_entity_id} DUPLICATE视为成功（bid已是目标值）`);
                  // @ts-expect-error v653: untyped task row from mysql2 execute result
                  await markTaskSynced(conn, t.id);
                  // @ts-expect-error v653: untyped task row from mysql2 execute result
                  await updateLocalBid(conn, 'keyword', t.target_entity_id, t.new_value);
                  result.synced++;
                } else {
                  // v509: 使用统一错误码映射表替代硬编码字符串匹配
                  const { classifyError: classifySbError, shouldMarkEntityDeleted: shouldMarkSbDeleted } = await import('../services/amazonApiErrorMapper');
                  const sbErrorMapping = classifySbError(failReason);
                  if (shouldMarkSbDeleted(failReason)) {
                    // @ts-expect-error v653: untyped task row from mysql2 execute result
                    await markTaskFailed(conn, t.id, `[v509-${sbErrorMapping.code}] ${failReason}`);
                    try {
                      // @ts-expect-error v653: untyped task row from mysql2 execute result
                      await Q.markKeywordDeleted(conn, t.target_entity_id, String(t.amazon_entity_id));
                      // @ts-expect-error v653: untyped task row from mysql2 execute result
                      log.warn(`[SyncEngine] v509: SB Keyword ${t.amazon_entity_id} 错误码=${sbErrorMapping.code}, 已标记为amazon_deleted`);
                    } catch (markErr: unknown) {
                      log.warn(`[SyncEngine] v509: 标记SB Keyword deleted失败: ${(markErr as Error).message}`);
                    }
                  } else {
                    // @ts-expect-error v653: untyped task row from mysql2 execute result
                    await markTaskForRetry(conn, t.id, t.retry_count, failReason);
                  }
                  result.failed++;
                }
              } else {
                // @ts-expect-error v653: untyped task row from mysql2 execute result
                await markTaskSynced(conn, t.id);
                // @ts-expect-error v653: untyped task row from mysql2 execute result
                await updateLocalBid(conn, 'keyword', t.target_entity_id, t.new_value);
                result.synced++;
              }
            }
            
            log.warn(`[SyncEngine] v429: SB关键词出价批量同步: 发送=${sbUpdates.length}, 成功=${sbUpdates.length - sbFailedIds.size}, 失败=${sbFailedIds.size}, 跳过=${sbSkippedTasks.length}`);
          } catch (err: unknown) {
            log.warn(`[SyncEngine] v429: SB关键词出价批量API调用失败: ${(err as Error).message}`);
            for (const t of sbKwTasks) {
              // @ts-expect-error v653: untyped task row from mysql2 execute result
              await markTaskForRetry(conn, t.id, t.retry_count, (err as Error).message);
            }
            result.failed += sbKwTasks.length;
            result.errors.push(`SB关键词出价API失败: ${(err as Error).message}`);
          }
        }
      }
      
      // v471: 批量更新商品定向出价 — 根据campaign类型路由到正确的SP/SB/SD API端点
      // 之前所有product target都走SP端点(/sp/targets)，导致SB和SD的商品定向竞价调整失败
      if (ptTasks.length > 0) {
        // v471: 先按campaign类型分组
        const spPtTasks: unknown[] = [];
        const sbPtTasks: unknown[] = [];
        const sdPtTasks: unknown[] = [];
        
        for (const t of ptTasks) {
          // @ts-expect-error v653: untyped task row from mysql2 execute result
          const ptCampInfo = await Q.getCampaignTypeByProductTargetId(conn, t.target_entity_id);
          const ptCampType = ptCampInfo?.campaignType || 'sp_manual';
          // @ts-expect-error v653: untyped task row from mysql2 execute result
          t._ptCampType = ptCampType;
          // @ts-expect-error v653: untyped task row from mysql2 execute result
          t._ptCostType = ptCampInfo?.costType || 'cpc';
          // @ts-expect-error v653: untyped task row from mysql2 execute result
          t._ptMarketplace = ptCampInfo?.marketplace || 'US';
          
          if (ptCampType === 'sb') {
            sbPtTasks.push(t);
          } else if (ptCampType === 'sd') {
            sdPtTasks.push(t);
          } else {
            spPtTasks.push(t);
          }
        }
        
        if (sbPtTasks.length > 0 || sdPtTasks.length > 0) {
          log.info(`[SyncEngine] v471: 商品定向按类型分组: SP=${spPtTasks.length}, SB=${sbPtTasks.length}, SD=${sdPtTasks.length}`);
        }
        
        // === SP商品定向 — 使用 updateProductTargetBids (PUT /sp/targets) ===
        if (spPtTasks.length > 0) {
          try {
            // @ts-expect-error v653: untyped task row from mysql2 execute result
            const spPtBidUpdates = spPtTasks.map((t: Record<string, unknown>) => {
              // @ts-expect-error v653: untyped task row from mysql2 execute result
              const rawBid = Number(parseFloat(t.new_value).toFixed(2));
              // @ts-expect-error v653: untyped task row from mysql2 execute result
              const { clampedBid, wasAdjusted, constraint, adTypeKey } = clampBidToConstraint(rawBid, t._ptCampType || 'sp_manual', t._ptMarketplace || 'US', t._ptCostType || 'cpc');
              if (wasAdjusted) {
                log.info(`[SyncEngine] v434: SP product target ${t.amazon_entity_id} bid $${rawBid} 超出${adTypeKey}约束[$${constraint.minBid}~$${constraint.maxBid}]，调整为$${clampedBid}`);
              }
              return { targetId: String(t.amazon_entity_id), bid: clampedBid };
            });
            // @ts-expect-error v653: untyped task row from mysql2 execute result
            const apiResult: unknown = await (syncService as Record<string, unknown>).client.updateProductTargetBids(spPtBidUpdates);
            
            const failedIds = new Map<string, string>();
            // @ts-expect-error v653: untyped task row from mysql2 execute result
            if (apiResult.errors && apiResult.errors.length > 0) {
              // @ts-expect-error v653: untyped task row from mysql2 execute result
              for (const err of apiResult.errors) {
                const ptErrDetail = err.details || (err as Record<string, unknown>).code || JSON.stringify(err).substring(0, 200) || 'API_ERROR';
                failedIds.set(String(err.targetId), ptErrDetail);
              }
            }
            
            for (const t of spPtTasks) {
              // @ts-expect-error v653: untyped task row from mysql2 execute result
              const ptFailReason = failedIds.get(String(t.amazon_entity_id));
              if (ptFailReason) {
                // v509: 统一错误码映射
                const { shouldMarkEntityDeleted: shouldMarkPtDeleted, classifyError: classifyPtError } = await import('../services/amazonApiErrorMapper');
                if (shouldMarkPtDeleted(ptFailReason)) {
                  const ptMapping = classifyPtError(ptFailReason);
                  // @ts-expect-error v653: untyped task row from mysql2 execute result
                  await markTaskFailed(conn, t.id, `[v509-${ptMapping.code}] ${ptFailReason}`);
                  // @ts-expect-error v653: untyped task row from mysql2 execute result
                  try { await Q.markTargetDeleted(conn, t.target_entity_id, String(t.amazon_entity_id)); } catch (_: any) {}
                } else {
                  // @ts-expect-error v653: untyped task row from mysql2 execute result
                  await markTaskForRetry(conn, t.id, t.retry_count, ptFailReason);
                }
                result.failed++;
              } else {
                // @ts-expect-error v653: untyped task row from mysql2 execute result
                await markTaskSynced(conn, t.id);
                // @ts-expect-error v653: untyped task row from mysql2 execute result
                await updateLocalBid(conn, 'product_target', t.target_entity_id, t.new_value);
                result.synced++;
              }
            }
            log.warn(`[SyncEngine] v471: SP商品定向出价同步: 发送=${spPtTasks.length}, 成功=${spPtTasks.length - failedIds.size}, 失败=${failedIds.size}`);
          } catch (err: unknown) {
            // @ts-expect-error v653: untyped task row from mysql2 execute result
            for (const t of spPtTasks) { await markTaskForRetry(conn, t.id, t.retry_count, (err as Error).message); }
            result.failed += spPtTasks.length;
            result.errors.push(`SP商品定向出价API失败: ${(err as Error).message}`);
          }
        }
        
        // === SB商品定向 — 使用 updateSbTargetBids (PUT /sb/v4/targets) ===
        if (sbPtTasks.length > 0) {
          try {
            const sbPtUpdates: Array<{ targetId: string; bid: number; adGroupId: string; campaignId: string }> = [];
            const sbPtSkipped: unknown[] = [];
            
            for (const t of sbPtTasks) {
              // @ts-expect-error v653: untyped task row from mysql2 execute result
              const rawBid = Number(parseFloat(t.new_value).toFixed(2));
              // @ts-expect-error v653: untyped task row from mysql2 execute result
              const { clampedBid, wasAdjusted, constraint, adTypeKey } = clampBidToConstraint(rawBid, 'sb', t._ptMarketplace || 'US', t._ptCostType || 'cpc');
              if (wasAdjusted) {
                // @ts-expect-error v653: untyped task row from mysql2 execute result
                log.info(`[SyncEngine] v471: SB product target ${t.amazon_entity_id} bid $${rawBid} 超出${adTypeKey}约束[$${constraint.minBid}~$${constraint.maxBid}]，调整为$${clampedBid}`);
              }
              // SB API需要adGroupId和campaignId
              // @ts-expect-error v653: untyped task row from mysql2 execute result
              const ptDetail = await Q.getProductTargetDetailById(conn, t.target_entity_id);
              if (ptDetail && ptDetail.amazonAdGroupId && ptDetail.amazonCampaignId) {
                sbPtUpdates.push({
                  // @ts-expect-error v653: untyped task row from mysql2 execute result
                  targetId: String(t.amazon_entity_id),
                  bid: clampedBid,
                  adGroupId: String(ptDetail.amazonAdGroupId),
                  campaignId: String(ptDetail.amazonCampaignId),
                });
              } else {
                // @ts-expect-error v653: untyped task row from mysql2 execute result
                await markTaskFailed(conn, t.id, 'v471: 无法获取SB商品定向的adGroupId或campaignId');
                result.failed++;
                sbPtSkipped.push(t);
              }
            }
            
            const activeSbPtTasks = sbPtTasks.filter(t => !sbPtSkipped.includes(t));
            
            if (sbPtUpdates.length > 0) {
              // @ts-expect-error v653: untyped task row from mysql2 execute result
              const sbApiResult = await (syncService as Record<string, unknown>).client.updateSbTargetBids(sbPtUpdates);
              const sbFailedIds = new Map<string, string>();
              if (sbApiResult.errors && sbApiResult.errors.length > 0) {
                for (const err of sbApiResult.errors) {
                  sbFailedIds.set(String(err.targetId), err.details || err.code || 'SB_API_ERROR');
                }
              }
              
              for (const t of activeSbPtTasks) {
                // @ts-expect-error v653: untyped task row from mysql2 execute result
                const failReason = sbFailedIds.get(String(t.amazon_entity_id));
                if (failReason) {
                  // v509: 统一错误码映射
                  const { shouldMarkEntityDeleted: shouldMarkSbPtDeleted, classifyError: classifySbPtError } = await import('../services/amazonApiErrorMapper');
                  if (shouldMarkSbPtDeleted(failReason)) {
                    const sbPtMapping = classifySbPtError(failReason);
                    // @ts-expect-error v653: untyped task row from mysql2 execute result
                    await markTaskFailed(conn, t.id, `[v509-${sbPtMapping.code}] ${failReason}`);
                    // @ts-expect-error v653: untyped task row from mysql2 execute result
                    try { await Q.markTargetDeleted(conn, t.target_entity_id, String(t.amazon_entity_id)); } catch (_: any) {}
                  } else {
                    // @ts-expect-error v653: untyped task row from mysql2 execute result
                    await markTaskForRetry(conn, t.id, t.retry_count, failReason);
                  }
                  result.failed++;
                } else {
                  // @ts-expect-error v653: untyped task row from mysql2 execute result
                  await markTaskSynced(conn, t.id);
                  // @ts-expect-error v653: untyped task row from mysql2 execute result
                  await updateLocalBid(conn, 'product_target', t.target_entity_id, t.new_value);
                  result.synced++;
                }
              }
              log.warn(`[SyncEngine] v471: SB商品定向出价同步: 发送=${sbPtUpdates.length}, 成功=${sbPtUpdates.length - sbFailedIds.size}, 失败=${sbFailedIds.size}, 跳过=${sbPtSkipped.length}`);
            }
          } catch (err: unknown) {
            // @ts-expect-error v653: untyped task row from mysql2 execute result
            for (const t of sbPtTasks) { await markTaskForRetry(conn, t.id, t.retry_count, (err as Error).message); }
            result.failed += sbPtTasks.length;
            result.errors.push(`SB商品定向出价API失败: ${(err as Error).message}`);
          }
        }
        
        // === SD商品定向 — 使用 updateSdTargetBids (PUT /sd/targets) ===
        if (sdPtTasks.length > 0) {
          try {
            // @ts-expect-error v653: untyped task row from mysql2 execute result
            const sdPtBidUpdates = sdPtTasks.map((t: Record<string, unknown>) => {
              // @ts-expect-error v653: untyped task row from mysql2 execute result
              const rawBid = Number(parseFloat(t.new_value).toFixed(2));
              // @ts-expect-error v653: untyped task row from mysql2 execute result
              const { clampedBid, wasAdjusted, constraint, adTypeKey } = clampBidToConstraint(rawBid, 'sd', t._ptMarketplace || 'US', t._ptCostType || 'cpc');
              if (wasAdjusted) {
                log.info(`[SyncEngine] v471: SD product target ${t.amazon_entity_id} bid $${rawBid} 超出${adTypeKey}约束[$${constraint.minBid}~$${constraint.maxBid}]，调整为$${clampedBid}`);
              }
              return { targetId: String(t.amazon_entity_id), bid: clampedBid };
            });
            
            // @ts-expect-error v653: untyped task row from mysql2 execute result
            await (syncService as Record<string, unknown>).client.updateSdTargetBids(sdPtBidUpdates);
            
            // SD API (旧版) 不返回详细的per-item结果，假设全部成功
            for (const t of sdPtTasks) {
              // @ts-expect-error v653: untyped task row from mysql2 execute result
              await markTaskSynced(conn, t.id);
              // @ts-expect-error v653: untyped task row from mysql2 execute result
              await updateLocalBid(conn, 'product_target', t.target_entity_id, t.new_value);
              result.synced++;
            }
            log.warn(`[SyncEngine] v471: SD商品定向出价同步: 发送=${sdPtTasks.length}, 全部成功`);
          } catch (err: unknown) {
            // @ts-expect-error v653: untyped task row from mysql2 execute result
            for (const t of sdPtTasks) { await markTaskForRetry(conn, t.id, t.retry_count, (err as Error).message); }
            result.failed += sdPtTasks.length;
            result.errors.push(`SD商品定向出价API失败: ${(err as Error).message}`);
          }
        }
      }
      break;
    }
    
    case 'keyword_status': {
      // v429: 使用entityIdResolver批量解析keyword_status任务的Amazon ID
      // 替代v138的逐个数据库查询和v141的即时回填
      const validTasks: unknown[] = [];
      const noIdTasks: unknown[] = [];
      
      // 先将已有Amazon ID的任务分到validTasks
      for (const t of (batch as unknown[])) {
        // @ts-expect-error v653: untyped task row from mysql2 execute result
        if (t.amazon_entity_id) {
          validTasks.push(t);
        } else {
          noIdTasks.push(t);
        }
      }
      
      // 批量解析缺失的Amazon ID
      if (noIdTasks.length > 0) {
        try {
          const { batchResolveKeywordIds } = await import('../services/entityIdResolver');
          // @ts-expect-error v653: untyped task row from mysql2 execute result
          const kwIds = noIdTasks.map((t: Record<string, unknown>) => t.target_entity_id);
          // @ts-expect-error v653: untyped task row from mysql2 execute result
          const kwResult = await batchResolveKeywordIds(kwIds);
          
          for (const t of noIdTasks) {
            // @ts-expect-error v653: untyped task row from mysql2 execute result
            const resolved = kwResult.resolved.get(t.target_entity_id);
            if (resolved) {
              // @ts-expect-error v653: untyped task row from mysql2 execute result
              t.amazon_entity_id = resolved.amazonId;
              // @ts-expect-error v653: untyped task row from mysql2 execute result
              await Q.updateTaskAmazonEntityId(conn, t.id, resolved.amazonId);
              validTasks.push(t);
              // @ts-expect-error v653: untyped task row from mysql2 execute result
              log.debug(`[SyncEngine] v457: ✅ keyword_status批量解析: id=${t.target_entity_id} -> ${resolved.amazonId}`);
            } else {
              // 回退到amazonIdResolver即时回填
              try {
                const { resolveKeywordIdOnDemand } = await import('../services/amazonIdResolver');
                // @ts-expect-error v653: untyped task row from mysql2 execute result
                const resolvedId = await resolveKeywordIdOnDemand(t.account_id, t.target_entity_id);
                if (resolvedId) {
                  // @ts-expect-error v653: untyped task row from mysql2 execute result
                  t.amazon_entity_id = resolvedId;
                  // @ts-expect-error v653: untyped task row from mysql2 execute result
                  await Q.updateTaskAmazonEntityId(conn, t.id, resolvedId);
                  validTasks.push(t);
                } else {
                  // @ts-expect-error v653: untyped task row from mysql2 execute result
                  await markTaskFailed(conn, t.id, '缺少Amazon ID（entityIdResolver+即时回填均失败）');
                  result.failed++;
                }
              } catch (fallbackErr: unknown) {
                // @ts-expect-error v653: untyped task row from mysql2 execute result
                await markTaskFailed(conn, t.id, `ID解析失败: ${(fallbackErr as Error).message}`);
                result.failed++;
              }
            }
          }
        } catch (resolverErr: unknown) {
          // entityIdResolver不可用时回退
          log.warn(`[SyncEngine] v457: entityIdResolver不可用，回退到amazonIdResolver`);
          try {
            const { resolveKeywordIdOnDemand } = await import('../services/amazonIdResolver');
            for (const t of noIdTasks) {
              try {
                // @ts-expect-error v653: untyped task row from mysql2 execute result
                const resolvedId = await resolveKeywordIdOnDemand(t.account_id, t.target_entity_id);
                if (resolvedId) {
                  // @ts-expect-error v653: untyped task row from mysql2 execute result
                  t.amazon_entity_id = resolvedId;
                  // @ts-expect-error v653: untyped task row from mysql2 execute result
                  await Q.updateTaskAmazonEntityId(conn, t.id, resolvedId);
                  validTasks.push(t);
                } else {
                  // @ts-expect-error v653: untyped task row from mysql2 execute result
                  await markTaskFailed(conn, t.id, '缺少Amazon ID（已尝试即时回填）');
                  result.failed++;
                }
              } catch (resolveErr: unknown) {
                // @ts-expect-error v653: untyped task row from mysql2 execute result
                await markTaskFailed(conn, t.id, `即时回填异常: ${(resolveErr as Error).message}`);
                result.failed++;
              }
            }
          } catch (importErr: unknown) {
            // @ts-expect-error v653: untyped task row from mysql2 execute result
            await markTasksFailed(conn, noIdTasks.map((t: Record<string, unknown>) => t.id), '缺少Amazon ID（所有解析器均不可用）');
            result.failed += noIdTasks.length;
          }
        }
      }
      
      if (validTasks.length > 0) {
        // v471: 按campaign类型分组，SP和SB关键词状态更新使用不同的API端点
        // 之前所有keyword状态变更都走SP端点，导致SB关键词状态调整失败
        const spKwTasks: unknown[] = [];
        const sbKwTasks: unknown[] = [];
        
        for (const t of validTasks) {
          // @ts-expect-error v653: untyped task row from mysql2 execute result
          const kwCampInfo = await Q.getCampaignTypeByKeywordId(conn, t.target_entity_id);
          const kwCampType = (kwCampInfo?.campaignType || 'sp_manual').toLowerCase();
          if (kwCampType === 'sb') {
            sbKwTasks.push(t);
          } else {
            spKwTasks.push(t);
          }
        }
        
        if (sbKwTasks.length > 0) {
          log.info(`[SyncEngine] v471: 关键词状态按类型分组: SP=${spKwTasks.length}, SB=${sbKwTasks.length}`);
        }
        
        // === SP关键词状态 — 使用 updateKeywordStatus (PUT /sp/keywords) ===
        if (spKwTasks.length > 0) {
          try {
            // @ts-expect-error v653: untyped task row from mysql2 execute result
            const apiResult: unknown = await (syncService as Record<string, unknown>).client.updateKeywordStatus(
              // @ts-expect-error v653: untyped task row from mysql2 execute result
              spKwTasks.map((t: Record<string, unknown>) => ({
                keywordId: String(t.amazon_entity_id),
                state: t.new_value as 'enabled' | 'paused' | 'archived',
              }))
            );
            
            const failedIdMap = new Map<string, string>();
            // @ts-expect-error v653: untyped task row from mysql2 execute result
            if (apiResult.errors && apiResult.errors.length > 0) {
              // @ts-expect-error v653: untyped task row from mysql2 execute result
              for (const err of apiResult.errors) {
                const errDetail = err.details || err.description || err.code || err.message || 'UNKNOWN_ERROR';
                failedIdMap.set(String(err.keywordId), `v431: keyword_status API错误: ${errDetail}`);
              }
            }
            
            for (const t of spKwTasks) {
              // @ts-expect-error v653: untyped task row from mysql2 execute result
              const statusFailReason = failedIdMap.get(String(t.amazon_entity_id));
              if (statusFailReason) {
                // v509: 统一错误码映射
                const { shouldMarkEntityDeleted: shouldMarkKwDeleted } = await import('../services/amazonApiErrorMapper');
                if (shouldMarkKwDeleted(statusFailReason)) {
                  // @ts-expect-error v653: untyped task row from mysql2 execute result
                  await markTaskFailed(conn, t.id, `[v509-entity-deleted] ${statusFailReason}`);
                  // @ts-expect-error v653: untyped task row from mysql2 execute result
                  try { await Q.markKeywordDeleted(conn, t.target_entity_id, String(t.amazon_entity_id)); } catch (_: any) {}
                // @ts-expect-error v653: untyped task row from mysql2 execute result
                } else if (t.retry_count >= 10) {
                  // @ts-expect-error v653: untyped task row from mysql2 execute result
                  await markTaskFailed(conn, t.id, `[v509-max-retries] ${statusFailReason}`);
                } else {
                  // @ts-expect-error v653: untyped task row from mysql2 execute result
                  await markTaskForRetry(conn, t.id, t.retry_count, statusFailReason);
                }
                result.failed++;
              } else {
                // @ts-expect-error v653: untyped task row from mysql2 execute result
                await markTaskSynced(conn, t.id);
                // @ts-expect-error v653: untyped task row from mysql2 execute result
                await updateLocalStatus(conn, 'keywords', t.target_entity_id, t.new_value);
                result.synced++;
              }
            }
            log.warn(`[SyncEngine] v471: SP关键词状态同步: 发送=${spKwTasks.length}, 成功=${spKwTasks.length - failedIdMap.size}, 失败=${failedIdMap.size}`);
          } catch (err: unknown) {
            // @ts-expect-error v653: untyped task row from mysql2 execute result
            for (const t of spKwTasks) { await markTaskForRetry(conn, t.id, t.retry_count, (err as Error).message); }
            result.failed += spKwTasks.length;
          }
        }
        
        // === SB关键词状态 — 使用 updateSbKeywordStatus (PUT /sb/keywords) ===
        if (sbKwTasks.length > 0) {
          try {
            // SB API需要adGroupId和campaignId
            const sbKwUpdates: Array<{ keywordId: string; state: 'enabled' | 'paused' | 'archived'; adGroupId: string; campaignId: string }> = [];
            const sbKwSkipped: unknown[] = [];
            
            for (const t of sbKwTasks) {
              // @ts-expect-error v653: untyped task row from mysql2 execute result
              const kwDetail = await Q.getKeywordDetailById(conn, t.target_entity_id);
              if (kwDetail && kwDetail.amazonAdGroupId && kwDetail.amazonCampaignId) {
                sbKwUpdates.push({
                  // @ts-expect-error v653: untyped task row from mysql2 execute result
                  keywordId: String(t.amazon_entity_id),
                  // @ts-expect-error v653: untyped task row from mysql2 execute result
                  state: t.new_value as 'enabled' | 'paused' | 'archived',
                  adGroupId: String(kwDetail.amazonAdGroupId),
                  campaignId: String(kwDetail.amazonCampaignId),
                });
              } else {
                // @ts-expect-error v653: untyped task row from mysql2 execute result
                await markTaskFailed(conn, t.id, 'v471: 无法获取SB关键词的adGroupId或campaignId');
                result.failed++;
                sbKwSkipped.push(t);
              }
            }
            
            const activeSbKwTasks = sbKwTasks.filter(t => !sbKwSkipped.includes(t));
            
            if (sbKwUpdates.length > 0) {
              // @ts-expect-error v653: untyped task row from mysql2 execute result
              const sbApiResult = await (syncService as Record<string, unknown>).client.updateSbKeywordStatus(sbKwUpdates);
              
              const sbFailedIds = new Map<string, string>();
              if (sbApiResult.errors && sbApiResult.errors.length > 0) {
                for (const err of sbApiResult.errors) {
                  sbFailedIds.set(String(err.keywordId), err.details || err.code || 'SB_API_ERROR');
                }
              }
              
              for (const t of activeSbKwTasks) {
                // @ts-expect-error v653: untyped task row from mysql2 execute result
                const failReason = sbFailedIds.get(String(t.amazon_entity_id));
                if (failReason) {
                  // v509: 统一错误码映射
                  const { shouldMarkEntityDeleted: shouldMarkSbKwDeleted } = await import('../services/amazonApiErrorMapper');
                  if (shouldMarkSbKwDeleted(failReason)) {
                    // @ts-expect-error v653: untyped task row from mysql2 execute result
                    await markTaskFailed(conn, t.id, `[v509-entity-deleted] ${failReason}`);
                    // @ts-expect-error v653: untyped task row from mysql2 execute result
                    try { await Q.markKeywordDeleted(conn, t.target_entity_id, String(t.amazon_entity_id)); } catch (_: any) {}
                  // @ts-expect-error v653: untyped task row from mysql2 execute result
                  } else if (t.retry_count >= 10) {
                    // @ts-expect-error v653: untyped task row from mysql2 execute result
                    await markTaskFailed(conn, t.id, `[v509-max-retries] ${failReason}`);
                  } else {
                    // @ts-expect-error v653: untyped task row from mysql2 execute result
                    await markTaskForRetry(conn, t.id, t.retry_count, failReason);
                  }
                  result.failed++;
                } else {
                  // @ts-expect-error v653: untyped task row from mysql2 execute result
                  await markTaskSynced(conn, t.id);
                  // @ts-expect-error v653: untyped task row from mysql2 execute result
                  await updateLocalStatus(conn, 'keywords', t.target_entity_id, t.new_value);
                  result.synced++;
                }
              }
              log.warn(`[SyncEngine] v471: SB关键词状态同步: 发送=${sbKwUpdates.length}, 成功=${sbKwUpdates.length - sbFailedIds.size}, 失败=${sbFailedIds.size}, 跳过=${sbKwSkipped.length}`);
            }
          } catch (err: unknown) {
            // @ts-expect-error v653: untyped task row from mysql2 execute result
            for (const t of sbKwTasks) { await markTaskForRetry(conn, t.id, t.retry_count, (err as Error).message); }
            result.failed += sbKwTasks.length;
          }
        }
      }
      break;
    }
    
    case 'campaign_status': {
      // v471: 广告活动状态更新 — 根据campaign类型路由到正确的SP/SB/SD API
      // 之前所有campaign状态变更都走updateSpCampaign，导致SB/SD广告活动状态调整失败
      for (const t of (batch as unknown[])) {
        try {
          // @ts-expect-error v653: untyped task row from mysql2 execute result
          if (!t.amazon_entity_id) {
            // @ts-expect-error v653: untyped task row from mysql2 execute result
            await markTaskFailed(conn, t.id, '缺少Amazon Campaign ID');
            result.failed++;
            continue;
          }
          
          // v471: 查询campaign类型以路由到正确的API
          // @ts-expect-error v653: untyped task row from mysql2 execute result
          const campTypeInfo = await Q.getCampaignTypeById(conn, t.target_entity_id);
          const campType = (campTypeInfo?.campaignType || 'sp_manual').toLowerCase();
          // @ts-expect-error v653: untyped task row from mysql2 execute result
          const stateValue = t.new_value === 'enabled' ? 'ENABLED' : 'PAUSED';
          
          if (campType === 'sb') {
            // SB: PUT /sb/v4/campaigns
            // @ts-expect-error v653: untyped task row from mysql2 execute result
            await (syncService as Record<string, unknown>).client.updateSbCampaign(
              // @ts-expect-error v653: untyped task row from mysql2 execute result
              String(t.amazon_entity_id),
              { state: stateValue }
            );
            // @ts-expect-error v653: untyped task row from mysql2 execute result
            log.info(`[SyncEngine] v471: ✅ SB广告活动状态同步: ${t.target_entity_name} → ${t.new_value}`);
          } else if (campType === 'sd') {
            // SD: PUT /sd/campaigns
            // @ts-expect-error v653: untyped task row from mysql2 execute result
            await (syncService as Record<string, unknown>).client.updateSdCampaign(
              // @ts-expect-error v653: untyped task row from mysql2 execute result
              String(t.amazon_entity_id),
              { state: stateValue.toLowerCase() }  // SD API使用小写state
            );
            // @ts-expect-error v653: untyped task row from mysql2 execute result
            log.info(`[SyncEngine] v471: ✅ SD广告活动状态同步: ${t.target_entity_name} → ${t.new_value}`);
          } else {
            // SP: PUT /sp/campaigns
            // @ts-expect-error v653: untyped task row from mysql2 execute result
            await (syncService as Record<string, unknown>).client.updateSpCampaign(
              // @ts-expect-error v653: untyped task row from mysql2 execute result
              String(t.amazon_entity_id),
              { state: stateValue }
            );
            // @ts-expect-error v653: untyped task row from mysql2 execute result
            log.info(`[SyncEngine] ✅ SP广告活动状态同步: ${t.target_entity_name} → ${t.new_value}`);
          }
          
          // @ts-expect-error v653: untyped task row from mysql2 execute result
          await markTaskSynced(conn, t.id);
          // @ts-expect-error v653: untyped task row from mysql2 execute result
          await updateLocalStatus(conn, 'campaigns', t.target_entity_id, t.new_value);
          result.synced++;
        } catch (err: unknown) {
          const errMsg = (err as Error).message;
          // v509: 统一错误码映射
          const { shouldMarkEntityDeleted: shouldMarkCampaignDeleted, classifyError: classifyCampaignError } = await import('../services/amazonApiErrorMapper');
          if (shouldMarkCampaignDeleted(errMsg)) {
            const campaignMapping = classifyCampaignError(errMsg);
            // @ts-expect-error v653: untyped task row from mysql2 execute result
            await markTaskFailed(conn, t.id, `[v509-${campaignMapping.code}] ${errMsg}`);
            try {
              // @ts-expect-error v653: untyped task row from mysql2 execute result
              await Q.archiveCampaign(conn, t.target_entity_id, String(t.amazon_entity_id));
              // @ts-expect-error v653: untyped task row from mysql2 execute result
              log.warn(`[SyncEngine] v509: Campaign ${t.target_entity_name} (${t.amazon_entity_id}) 错误码=${campaignMapping.code}, 已标记为archived`);
            } catch (markErr: unknown) {
              log.warn(`[SyncEngine] v509: 标记Campaign archived失败: ${(markErr as Error).message}`);
            }
          } else {
            // @ts-expect-error v653: untyped task row from mysql2 execute result
            await markTaskForRetry(conn, t.id, t.retry_count, errMsg);
          }
          result.failed++;
          // @ts-expect-error v653: untyped task row from mysql2 execute result
          result.errors.push(`Campaign ${t.target_entity_name}: ${errMsg}`);
        }
        
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      break;
    }
    
    case 'adgroup_status': {
      // v471: 广告组状态更新 — 根据campaign类型路由到正确的SP/SD API
      // 之前所有adgroup状态变更都走updateSpAdGroupStatus，导致SD广告组状态调整失败
      // 注意：SB不支持独立的adGroup状态更新，SB的adGroup状态跟随campaign状态
      // @ts-expect-error v653: untyped task row from mysql2 execute result
      const validAdGroupTasks = (batch as unknown[]).filter(t => t.amazon_entity_id);
      // @ts-expect-error v653: untyped task row from mysql2 execute result
      const invalidAdGroupTasks = (batch as unknown[]).filter(t => !t.amazon_entity_id);
      
      for (const t of invalidAdGroupTasks) {
        // @ts-expect-error v653: untyped task row from mysql2 execute result
        await markTaskFailed(conn, t.id, '缺少Amazon AdGroup ID');
        result.failed++;
      }
      
      if (validAdGroupTasks.length > 0) {
        // v471: 按campaign类型分组
        const spAgTasks: unknown[] = [];
        const sdAgTasks: unknown[] = [];
        
        for (const t of validAdGroupTasks) {
          // @ts-expect-error v653: untyped task row from mysql2 execute result
          const agCampType = await Q.getCampaignTypeByAdGroupInternalId(conn, t.target_entity_id);
          if (agCampType === 'sd') {
            sdAgTasks.push(t);
          } else {
            // SP + SP自动 + SB(回退到SP) 都走SP端点
            spAgTasks.push(t);
          }
        }
        
        if (sdAgTasks.length > 0) {
          log.info(`[SyncEngine] v471: 广告组状态按类型分组: SP=${spAgTasks.length}, SD=${sdAgTasks.length}`);
        }
        
        // === SP广告组 ===
        if (spAgTasks.length > 0) {
          try {
            // @ts-expect-error v653: untyped task row from mysql2 execute result
            const agResult = await (syncService as Record<string, unknown>).client.updateSpAdGroupStatus(
              spAgTasks.map((t: unknown) => ({
                // @ts-expect-error v653: untyped task row from mysql2 execute result
                adGroupId: String(t.amazon_entity_id),
                // @ts-expect-error v653: untyped task row from mysql2 execute result
                state: t.new_value === 'enabled' ? 'enabled' : 'paused',
              }))
            );
            
            const agFailedIds = new Map<string, string>();
            if (agResult.errors && agResult.errors.length > 0) {
              for (const err of agResult.errors) {
                agFailedIds.set(String(err.adGroupId), err.details || err.code || 'API_ERROR');
              }
            }
            
            for (const t of spAgTasks) {
              // @ts-expect-error v653: untyped task row from mysql2 execute result
              const failReason = agFailedIds.get(String(t.amazon_entity_id));
              if (failReason) {
                // v509: 统一错误码映射
                const { shouldMarkEntityDeleted: shouldMarkSpAgDeleted } = await import('../services/amazonApiErrorMapper');
                if (shouldMarkSpAgDeleted(failReason)) {
                  // @ts-expect-error v653: untyped task row from mysql2 execute result
                  await markTaskFailed(conn, t.id, `[v509-entity-archived] ${failReason}`);
                  // @ts-expect-error v653: untyped task row from mysql2 execute result
                  try { await Q.archiveAdGroup(conn, t.target_entity_id, String(t.amazon_entity_id)); } catch (_: any) {}
                } else {
                  // @ts-expect-error v653: untyped task row from mysql2 execute result
                  await markTaskForRetry(conn, t.id, t.retry_count, `v509: SP AdGroup状态更新失败: ${failReason}`);
                }
                result.failed++;
              } else {
                // @ts-expect-error v653: untyped task row from mysql2 execute result
                await markTaskSynced(conn, t.id);
                // @ts-expect-error v653: untyped task row from mysql2 execute result
                await updateLocalStatus(conn, 'ad_groups', t.target_entity_id, t.new_value);
                result.synced++;
                // @ts-expect-error v653: untyped task row from mysql2 execute result
                log.info(`[SyncEngine] ✅ SP广告组状态同步: ${t.target_entity_name} → ${t.new_value}`);
              }
            }
            log.warn(`[SyncEngine] v471: SP广告组状态同步: 发送=${spAgTasks.length}, 成功=${spAgTasks.length - agFailedIds.size}, 失败=${agFailedIds.size}`);
          } catch (err: unknown) {
            // @ts-expect-error v653: untyped task row from mysql2 execute result
            for (const t of spAgTasks) { await markTaskForRetry(conn, t.id, t.retry_count, (err as Error).message); }
            result.failed += spAgTasks.length;
          }
        }
        
        // === SD广告组 — 使用 updateSdAdGroupStatus (PUT /sd/adGroups) ===
        if (sdAgTasks.length > 0) {
          try {
            // @ts-expect-error v653: untyped task row from mysql2 execute result
            const sdAgResult = await (syncService as Record<string, unknown>).client.updateSdAdGroupStatus(
              sdAgTasks.map((t: unknown) => ({
                // @ts-expect-error v653: untyped task row from mysql2 execute result
                adGroupId: String(t.amazon_entity_id),
                // @ts-expect-error v653: untyped task row from mysql2 execute result
                state: t.new_value === 'enabled' ? 'enabled' : 'paused',
              }))
            );
            
            const sdAgFailedIds = new Map<string, string>();
            if (sdAgResult.errors && sdAgResult.errors.length > 0) {
              for (const err of sdAgResult.errors) {
                sdAgFailedIds.set(String(err.adGroupId), err.details || err.code || 'API_ERROR');
              }
            }
            
            for (const t of sdAgTasks) {
              // @ts-expect-error v653: untyped task row from mysql2 execute result
              const failReason = sdAgFailedIds.get(String(t.amazon_entity_id));
              if (failReason) {
                // v509: 统一错误码映射
                const { shouldMarkEntityDeleted: shouldMarkSdAgDeleted } = await import('../services/amazonApiErrorMapper');
                if (shouldMarkSdAgDeleted(failReason)) {
                  // @ts-expect-error v653: untyped task row from mysql2 execute result
                  await markTaskFailed(conn, t.id, `[v509-entity-archived] ${failReason}`);
                  // @ts-expect-error v653: untyped task row from mysql2 execute result
                  try { await Q.archiveAdGroup(conn, t.target_entity_id, String(t.amazon_entity_id)); } catch (_: any) {}
                } else {
                  // @ts-expect-error v653: untyped task row from mysql2 execute result
                  await markTaskForRetry(conn, t.id, t.retry_count, `v509: SD AdGroup状态更新失败: ${failReason}`);
                }
                result.failed++;
              } else {
                // @ts-expect-error v653: untyped task row from mysql2 execute result
                await markTaskSynced(conn, t.id);
                // @ts-expect-error v653: untyped task row from mysql2 execute result
                await updateLocalStatus(conn, 'ad_groups', t.target_entity_id, t.new_value);
                result.synced++;
                // @ts-expect-error v653: untyped task row from mysql2 execute result
                log.info(`[SyncEngine] v471: ✅ SD广告组状态同步: ${t.target_entity_name} → ${t.new_value}`);
              }
            }
            log.warn(`[SyncEngine] v471: SD广告组状态同步: 发送=${sdAgTasks.length}, 成功=${sdAgTasks.length - sdAgFailedIds.size}, 失败=${sdAgFailedIds.size}`);
          } catch (err: unknown) {
            // @ts-expect-error v653: untyped task row from mysql2 execute result
            for (const t of sdAgTasks) { await markTaskForRetry(conn, t.id, t.retry_count, (err as Error).message); }
            result.failed += sdAgTasks.length;
          }
        }
      }
      break;
    }
    
    case 'negative_keyword': {
      // v189: 否定词批量创建 - 增强自动回填Amazon campaignId
      // v395: P1修复 — 同时获取campaignType，过滤掉SB/SD类型（SP API不支持）
      // 先尝试回填缺少的campaign_id，并获取campaignType
      for (const t of (batch as unknown[])) {
        // @ts-expect-error v653: untyped task row from mysql2 execute result
        if (!t.campaign_id && t.target_entity_id) {
          try {
            // @ts-expect-error v653: untyped task row from mysql2 execute result
            const campInfo = await Q.getCampaignIdAndType(conn, t.target_entity_id);
            if (campInfo && campInfo.campaignId) {
              // @ts-expect-error v653: untyped task row from mysql2 execute result
              t.campaign_id = campInfo.campaignId;
              // @ts-expect-error v653: untyped task row from mysql2 execute result
              t.amazon_entity_id = campInfo.campaignId;
              // @ts-expect-error v653: untyped task row from mysql2 execute result
              t._campaignType = campInfo.campaignType || 'sp_manual';
            }
          } catch (lookupErr: unknown) {
            // 忽略查找失败
          }
        // @ts-expect-error v653: untyped task row from mysql2 execute result
        } else if (t.campaign_id && !t._campaignType) {
          // v457: 使用类型安全查询获取campaignType
          try {
            // @ts-expect-error v653: untyped task row from mysql2 execute result
            t._campaignType = await Q.getCampaignTypeByAmazonOrInternalId(conn, t.campaign_id, 0);
          } catch (lookupErr: unknown) {
            // 忽略查找失败
          }
        }
      }
      
      // v395: 过滤掉SB/SD类型的campaign（SP否定词API不支持SB/SD）
      // @ts-expect-error v653: untyped task row from mysql2 execute result
      const spTasks = (batch as unknown[]).filter((t: Record<string, unknown>) => {
        // @ts-expect-error v653: untyped task row from mysql2 execute result
        const cType = (t._campaignType || 'sp_manual').toLowerCase();
        return cType.startsWith('sp') || cType === '' || !t._campaignType;
      });
      // @ts-expect-error v653: untyped task row from mysql2 execute result
      const nonSpTasks = (batch as unknown[]).filter((t: Record<string, unknown>) => {
        // @ts-expect-error v653: untyped task row from mysql2 execute result
        const cType = (t._campaignType || '').toLowerCase();
        return cType === 'sb' || cType === 'sd';
      });
      
      // v428: P2修复 — SB否定词使用SB专用API（POST /sb/negativeKeywords）而不是直接跳过
      // SD不支持否定关键词，仅支持否定产品定向，所以SD仍然跳过
      // @ts-expect-error v653: untyped task row from mysql2 execute result
      const sbNegTasks = nonSpTasks.filter((t: Record<string, unknown>) => {
        // @ts-expect-error v653: untyped task row from mysql2 execute result
        const cType = (t._campaignType || '').toLowerCase();
        return cType === 'sb';
      });
      // @ts-expect-error v653: untyped task row from mysql2 execute result
      const sdNegTasks = nonSpTasks.filter((t: Record<string, unknown>) => {
        // @ts-expect-error v653: untyped task row from mysql2 execute result
        const cType = (t._campaignType || '').toLowerCase();
        return cType === 'sd';
      });
      
      // SD否定词任务直接跳过（SD不支持否定关键词）
      for (const t of sdNegTasks) {
        // @ts-expect-error v653: untyped task row from mysql2 execute result
        await markTaskFailed(conn, t.id, `v428: SD不支持否定关键词，仅支持否定产品定向`);
        result.skipped = (result.skipped || 0) + 1;
      }
      
      // v428: SB否定词使用SB专用API (POST /sb/negativeKeywords)
      if (sbNegTasks.length > 0) {
        // @ts-expect-error v653: untyped task row from mysql2 execute result
        const sbNegValidTasks = sbNegTasks.filter((t: Record<string, unknown>) => t.campaign_id || t.amazon_entity_id);
        if (sbNegValidTasks.length > 0) {
          try {
            // v428: 需要回填adGroupId，SB否定词需要adGroupId
            for (const t of sbNegValidTasks) {
              // @ts-expect-error v653: untyped task row from mysql2 execute result
              if (!t.ad_group_id && t.target_entity_id) {
                try {
                  // v456: 使用类型安全查询替代原生SQL，修复 ag.internalCampaignId 不存在的问题
                  // @ts-expect-error v653: untyped task row from mysql2 execute result
                  const agId = await Q.getFirstAdGroupIdByCampaignId(conn, String(t.amazon_entity_id || t.campaign_id));
                  // @ts-expect-error v653: untyped task row from mysql2 execute result
                  if (agId) t.ad_group_id = agId;
                } catch { /* ignore */ }
              }
            }
            
            // @ts-expect-error v653: untyped task row from mysql2 execute result
            const sbNegApiResults = await (syncService as Record<string, unknown>).client.createSbNegativeKeywords(
              // @ts-expect-error v653: untyped task row from mysql2 execute result
              sbNegValidTasks.map((t: Record<string, unknown>) => ({
                campaignId: String(t.amazon_entity_id || t.campaign_id),
                adGroupId: t.ad_group_id ? String(t.ad_group_id) : '0',
                keywordText: t.target_entity_name,
                // @ts-expect-error v653: untyped task row from mysql2 execute result
                matchType: (t.action || '').includes('exact') || (t.action || '').includes('Exact')
                  ? 'negativeExact' as const : 'negativePhrase' as const,
              }))
            );
            // createSbNegativeKeywords返回数组，每个元素包含结果
            // @ts-expect-error v653: untyped task row from mysql2 execute result
            const sbNegSuccessCount = Array.isArray(sbNegApiResults) ? sbNegApiResults.filter((r: unknown) => r.code === 'SUCCESS' || r.negativeKeywordId).length : 0;
            if (sbNegSuccessCount > 0 || (Array.isArray(sbNegApiResults) && sbNegApiResults.length > 0)) {
              for (const t of sbNegValidTasks) {
                // @ts-expect-error v653: untyped task row from mysql2 execute result
                await markTaskSynced(conn, t.id);
              }
              result.synced += sbNegValidTasks.length;
              log.info(`[SyncEngine] v428: SB否定词同步成功: ${sbNegValidTasks.length}个`);
            } else {
              for (const t of sbNegValidTasks) {
                // @ts-expect-error v653: untyped task row from mysql2 execute result
                await markTaskForRetry(conn, t.id, t.retry_count, 'SB否定词API返回空结果');
              }
              result.failed += sbNegValidTasks.length;
            }
          } catch (sbNegErr: unknown) {
            log.warn(`[SyncEngine] v428: SB否定词API调用失败: ${(sbNegErr as Error).message}`);
            for (const t of sbNegValidTasks) {
              // @ts-expect-error v653: untyped task row from mysql2 execute result
              await markTaskForRetry(conn, t.id, t.retry_count, (sbNegErr as Error).message);
            }
            result.failed += sbNegValidTasks.length;
          }
        }
        // 无法回填campaign_id的SB任务
        // @ts-expect-error v653: untyped task row from mysql2 execute result
        const sbNegInvalidTasks = sbNegTasks.filter((t: Record<string, unknown>) => !t.campaign_id && !t.amazon_entity_id);
        for (const t of sbNegInvalidTasks) {
          // @ts-expect-error v653: untyped task row from mysql2 execute result
          await markTaskFailed(conn, t.id, 'v428: SB否定词缺少Amazon Campaign ID');
          result.failed++;
        }
      }
      
      // @ts-expect-error v653: untyped task row from mysql2 execute result
      const validTasks = spTasks.filter((t: Record<string, unknown>) => t.campaign_id || t.amazon_entity_id);
      // @ts-expect-error v653: untyped task row from mysql2 execute result
      const invalidTasks = spTasks.filter((t: Record<string, unknown>) => !t.campaign_id && !t.amazon_entity_id);
      
      // 标记无法处理的任务
      for (const t of invalidTasks) {
        // @ts-expect-error v653: untyped task row from mysql2 execute result
        await markTaskFailed(conn, t.id, '缺少Amazon Campaign ID且无法回填');
        result.failed++;
      }
      
      if (validTasks.length > 0) {
        // v189: 使用amazonApiHelper.syncNegativeKeywordsToAmazon以获得更好的错误处理
        try {
          const negSyncResult = await amazonApiHelper.syncNegativeKeywordsToAmazon(
            // @ts-expect-error v653: untyped task row from mysql2 execute result
            validTasks[0].account_id,
            // @ts-expect-error v653: untyped task row from mysql2 execute result
            validTasks.map((t: Record<string, unknown>) => ({
              campaignId: String(t.amazon_entity_id || t.campaign_id),  // v356: 统一使用String类型传递Amazon ID
              keywordText: t.target_entity_name,
              // @ts-expect-error v653: untyped task row from mysql2 execute result
              matchType: (t.action || '').includes('exact') || (t.action || '').includes('Exact') 
                ? 'negativeExact' as const : 'negativePhrase' as const,
              level: 'campaign' as const,
            }))
          );
          
          if (negSyncResult.failed === 0 && negSyncResult.success > 0) {
            // 全部成功
            for (const t of validTasks) {
              // @ts-expect-error v653: untyped task row from mysql2 execute result
              await markTaskSynced(conn, t.id);
            }
            result.synced += validTasks.length;
          } else if (negSyncResult.success > 0) {
            // 部分成功 - 标记所有为成功（批量API无法区分单个失败）
            for (const t of validTasks) {
              // @ts-expect-error v653: untyped task row from mysql2 execute result
              await markTaskSynced(conn, t.id);
            }
            result.synced += validTasks.length;
            log.warn(`[SyncEngine] v189: 否定词部分成功: 成功=${negSyncResult.success}, 失败=${negSyncResult.failed}`);
          } else {
            // v431: 全部失败 — 检查是否包含DUPLICATE/duplicates错误，如果是则视为成功
            const errorStr = negSyncResult.errors.join('; ');
            const hasDuplicate = errorStr.includes('duplicate') || errorStr.includes('DUPLICATE') || errorStr.includes('duplicates in entity name');
            const hasOnlyDuplicateAndOther = negSyncResult.errors.every((e: string) => 
              e.includes('duplicate') || e.includes('DUPLICATE') || e.includes('duplicates in entity name') || e.includes('otherError') || e.includes('internalServerError')
            );
            if (hasDuplicate && hasOnlyDuplicateAndOther && negSyncResult.errors.length > 0) {
              log.info(`[SyncEngine] v431: 否定词DUPLICATE/otherError，视为成功（已存在）: ${errorStr.substring(0, 200)}`);
              for (const t of validTasks) {
                // @ts-expect-error v653: untyped task row from mysql2 execute result
                await markTaskSynced(conn, t.id);
              }
              result.synced += validTasks.length;
            } else {
              for (const t of validTasks) {
                // @ts-expect-error v653: untyped task row from mysql2 execute result
                await markTaskForRetry(conn, t.id, t.retry_count, errorStr);
              }
              result.failed += validTasks.length;
            }
          }
        } catch (err: unknown) {
          for (const t of validTasks) {
            // @ts-expect-error v653: untyped task row from mysql2 execute result
            await markTaskForRetry(conn, t.id, t.retry_count, (err as Error).message);
          }
          result.failed += validTasks.length;
        }
      }
      break;
    }
    
    case 'new_keyword': {
      // @ts-expect-error v653: untyped task row from mysql2 execute result
      const validTasks = batch.filter((t: Record<string, unknown>) => t.ad_group_id);
      
      if (validTasks.length > 0) {
        try {
          // @ts-expect-error v653: untyped task row from mysql2 execute result
          const createResult = await (syncService as Record<string, unknown>).client.createSpKeywords(
            // @ts-expect-error v653: untyped task row from mysql2 execute result
            validTasks.map((t: Record<string, unknown>) => ({
              adGroupId: Number(t.ad_group_id),
              campaignId: Number(t.campaign_id),
              keywordText: t.target_entity_name,
              // @ts-expect-error v653: untyped task row from mysql2 execute result
              matchType: (t.action.replace('create_', '') || 'broad') as 'exact' | 'phrase' | 'broad',
              // @ts-expect-error v653: untyped task row from mysql2 execute result
              bid: parseFloat(t.new_value) || 0.5,
              state: 'enabled' as const,
            }))
          );
          
          for (let i = 0; i < validTasks.length; i++) {
            const t = validTasks[i];
            const created = createResult?.createdKeywords?.[i];
            if (created && created.code === 'SUCCESS' && created.keywordId) {
              // @ts-expect-error v653: untyped task row from mysql2 execute result
              await markTaskSynced(conn, t.id);
              // v357: 更新本地关键词的Amazon keywordId，同时回填accountId和campaignId
              // @ts-expect-error v653: untyped task row from mysql2 execute result
              if (t.target_entity_id) {
                // @ts-expect-error v653: untyped task row from mysql2 execute result
                await Q.updateKeywordAmazonId(conn, t.target_entity_id, String(created.keywordId), t.account_id, t.campaign_id);
                // @ts-expect-error v653: untyped task row from mysql2 execute result
                log.info(`[SyncEngine] v357: keyword已同步: localId=${t.target_entity_id}, amazonKeywordId=${created.keywordId}`);
              }
              result.synced++;
            } else {
              // @ts-expect-error v653: untyped task row from mysql2 execute result
              await markTaskForRetry(conn, t.id, t.retry_count, created?.code || 'CREATE_FAILED');
              result.failed++;
            }
          }
        } catch (err: unknown) {
          for (const t of validTasks) {
            // @ts-expect-error v653: untyped task row from mysql2 execute result
            await markTaskForRetry(conn, t.id, t.retry_count, (err as Error).message);
          }
          result.failed += validTasks.length;
        }
      }
      break;
    }
    
    case 'placement_adjustment': {
      // v471: 位置倾斜调整 — 根据campaign类型路由到正确的SP/SB API
      // 之前所有placement都走updateSpCampaign，导致SB广告的位置倾斜调整失败
      // 注意：SD不支持位置倾斜
      for (const t of (batch as unknown[])) {
        try {
          // @ts-expect-error v653: untyped task row from mysql2 execute result
          const placementType = t.action; // e.g., 'top_of_search', 'product_pages'
          // @ts-expect-error v653: untyped task row from mysql2 execute result
          const multiplier = parseFloat(t.new_value) || 0;
          
          // v189: 如果缺少Amazon Campaign ID，尝试自动回填
          // @ts-expect-error v653: untyped task row from mysql2 execute result
          let amazonCampaignId = t.amazon_entity_id;
          // @ts-expect-error v653: untyped task row from mysql2 execute result
          if (!amazonCampaignId && t.target_entity_id) {
            try {
              // @ts-expect-error v653: untyped task row from mysql2 execute result
              const campId = await Q.getCampaignAmazonId(conn, t.target_entity_id);
              if (campId) {
                amazonCampaignId = campId;
                // @ts-expect-error v653: untyped task row from mysql2 execute result
                await Q.updateTaskAmazonEntityId(conn, t.id, campId);
              }
            } catch (lookupErr: unknown) {
              log.warn(`[SyncEngine] v457: 查找Amazon campaignId失败: ${(lookupErr as Error).message}`);
            }
          }
          
          if (amazonCampaignId) {
            // v471: 查询campaign类型以路由到正确的API
            // @ts-expect-error v653: untyped task row from mysql2 execute result
            const placeCampInfo = await Q.getCampaignTypeById(conn, t.target_entity_id);
            const placeCampType = (placeCampInfo?.campaignType || 'sp_manual').toLowerCase();
            
            if (placeCampType === 'sb') {
              // SB: 使用 updateSbCampaign (PUT /sb/v4/campaigns)
              // SB v4 位置倾斜格式: bidding.bidAdjustments[{predicate, percentage}]
              // predicate: "placementTop" = 搜索结果顶部, "placementProductPage" = 商品页面
              const sbPredicate = placementType === 'top_of_search' ? 'placementTop'
                : placementType === 'rest_of_search' ? 'placementRestOfSearch'
                : 'placementProductPage';
              // @ts-expect-error v653: untyped task row from mysql2 execute result
              await (syncService as Record<string, unknown>).client.updateSbCampaign(
                String(amazonCampaignId),
                {
                  bidding: {
                    bidAdjustments: [{
                      predicate: sbPredicate,
                      percentage: Math.round(multiplier * 100),
                    }]
                  }
                }
              );
              log.info(`[SyncEngine] v471: ✅ SB位置倾斜同步: Campaign ${amazonCampaignId}, ${sbPredicate}=${Math.round(multiplier * 100)}%`);
            } else if (placeCampType === 'sd') {
              // SD不支持位置倾斜，标记为失败
              // @ts-expect-error v653: untyped task row from mysql2 execute result
              await markTaskFailed(conn, t.id, 'v471: SD广告不支持位置倾斜调整');
              result.failed++;
              continue;
            } else {
              // SP: 使用 updateSpCampaign (PUT /sp/campaigns)
              const v3PlacementType = placementType === 'top_of_search' ? 'PLACEMENT_TOP' 
                : placementType === 'rest_of_search' ? 'PLACEMENT_REST_OF_SEARCH'
                : 'PLACEMENT_PRODUCT_PAGE';
              // @ts-expect-error v653: untyped task row from mysql2 execute result
              await (syncService as Record<string, unknown>).client.updateSpCampaign(
                String(amazonCampaignId),
                {
                  dynamicBidding: {
                    placementBidding: [{
                      placement: v3PlacementType,
                      percentage: Math.round(multiplier * 100),
                    }]
                  }
                }
              );
              log.info(`[SyncEngine] ✅ SP位置倾斜同步: Campaign ${amazonCampaignId}, ${v3PlacementType}=${Math.round(multiplier * 100)}%`);
            }
            
            // @ts-expect-error v653: untyped task row from mysql2 execute result
            await markTaskSynced(conn, t.id);
            result.synced++;
          } else {
            // @ts-expect-error v653: untyped task row from mysql2 execute result
            await markTaskFailed(conn, t.id, '缺少Amazon Campaign ID且无法回填');
            result.failed++;
          }
        } catch (err: unknown) {
          // @ts-expect-error v653: untyped task row from mysql2 execute result
          await markTaskForRetry(conn, t.id, t.retry_count, (err as Error).message);
          result.failed++;
        }
        
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      break;
    }
    
    case 'negative_product_target': {
      // v523: 否定产品定向批量创建 — 使用 amazonApiHelper.syncNegativeProductTargetsToAmazon
      // 任务结构: target_entity_type='campaign', action='add_negative_product_target'
      // target_entity_name = ASIN, amazon_entity_id = Amazon campaignId, campaign_id = internal campaign id
      for (const t of (batch as unknown[])) {
        try {
          // @ts-expect-error v653: untyped task row from mysql2 execute result
          const asin = String(t.target_entity_name || t.new_value || '').trim();
          // @ts-expect-error v653: untyped task row from mysql2 execute result
          const amazonCampaignId = String(t.amazon_entity_id || '');
          
          if (!asin || !amazonCampaignId) {
            // @ts-expect-error v653: untyped task row from mysql2 execute result
            await markTaskFailed(conn, t.id, 'v523: 缺少ASIN或Amazon Campaign ID');
            result.failed++;
            continue;
          }
          
          // 查询campaign类型以路由到正确的API
          // @ts-expect-error v653: untyped task row from mysql2 execute result
          const campTypeInfo = await Q.getCampaignTypeById(conn, t.target_entity_id);
          const campType = (campTypeInfo?.campaignType || 'sp_manual').toLowerCase();
          const apiCampType = campType.startsWith('sb') ? 'sb' as const
            : campType.startsWith('sd') ? 'sd' as const
            : 'sp' as const;
          
          const negResult = await amazonApiHelper.syncNegativeProductTargetsToAmazon(
            // @ts-expect-error v653: untyped task row from mysql2 execute result
            t.account_id,
            [{
              campaignId: amazonCampaignId,
              asin: asin,
              campaignType: apiCampType,
              negativeScope: 'campaign' as const,
            }]
          );
          
          if (negResult.success > 0) {
            // @ts-expect-error v653: untyped task row from mysql2 execute result
            await markTaskSynced(conn, t.id);
            result.synced++;
            log.info(`[SyncEngine] v523: ✅ 否定产品定向同步: Campaign ${amazonCampaignId}, ASIN=${asin}`);
          } else {
            const errMsg = negResult.errors.join('; ') || 'API返回失败';
            // @ts-expect-error v653: untyped task row from mysql2 execute result
            await markTaskForRetry(conn, t.id, t.retry_count, `v523: ${errMsg}`);
            result.failed++;
          }
        } catch (err: unknown) {
          // @ts-expect-error v653: untyped task row from mysql2 execute result
          await markTaskForRetry(conn, t.id, t.retry_count, (err as Error).message);
          result.failed++;
        }
        
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      break;
    }
    
    case 'budget_adjustment': {
      // v189: 使用amazonApiHelper.syncBudgetAdjustmentToAmazon以支持SP/SB/SD不同类型的campaign
      for (const t of (batch as unknown[])) {
        try {
          // @ts-expect-error v653: untyped task row from mysql2 execute result
          let amazonCampaignId = t.amazon_entity_id;
          let campaignType = 'sp_manual';
          
          // v457: 使用类型安全查询回填Amazon Campaign ID
          // @ts-expect-error v653: untyped task row from mysql2 execute result
          if (!amazonCampaignId && t.target_entity_id) {
            try {
              // @ts-expect-error v653: untyped task row from mysql2 execute result
              const campInfo = await Q.getCampaignIdAndType(conn, t.target_entity_id);
              if (campInfo && campInfo.campaignId) {
                amazonCampaignId = campInfo.campaignId;
                campaignType = campInfo.campaignType || 'sp_manual';
                // @ts-expect-error v653: untyped task row from mysql2 execute result
                await Q.updateTaskAmazonEntityId(conn, t.id, amazonCampaignId);
                // @ts-expect-error v653: untyped task row from mysql2 execute result
                log.debug(`[SyncEngine] v457: 回填Amazon campaignId: local=${t.target_entity_id} -> amazon=${amazonCampaignId}`);
              }
            } catch (lookupErr: unknown) {
              log.warn(`[SyncEngine] v457: 查找Amazon campaignId失败: ${(lookupErr as Error).message}`);
            }
          } else if (amazonCampaignId) {
            // 查询campaign类型以选择正确的API
            // @ts-expect-error v653: untyped task row from mysql2 execute result
            campaignType = await Q.getCampaignTypeByAmazonOrInternalId(conn, String(amazonCampaignId), t.target_entity_id || 0);
          }
          
          if (amazonCampaignId) {
            // @ts-expect-error v653: untyped task row from mysql2 execute result
            const newBudget = parseFloat(t.new_value) || 0;
            const budgetSyncResult = await amazonApiHelper.syncBudgetAdjustmentToAmazon(
              // @ts-expect-error v653: untyped task row from mysql2 execute result
              t.account_id,
              String(amazonCampaignId),
              newBudget,
              // @ts-expect-error v653: untyped task row from mysql2 execute result
              t.change_reason || '预算调整重试',
              campaignType
            );
            
            if (budgetSyncResult) {
              // @ts-expect-error v653: untyped task row from mysql2 execute result
              await markTaskSynced(conn, t.id);
              result.synced++;
            } else {
              // @ts-expect-error v653: untyped task row from mysql2 execute result
              await markTaskForRetry(conn, t.id, t.retry_count, 'API返回false');
              result.failed++;
            }
          } else {
            // @ts-expect-error v653: untyped task row from mysql2 execute result
            await markTaskFailed(conn, t.id, '缺少Amazon Campaign ID且无法回填');
            result.failed++;
          }
        } catch (err: unknown) {
          // @ts-expect-error v653: untyped task row from mysql2 execute result
          await markTaskForRetry(conn, t.id, t.retry_count, (err as Error).message);
          result.failed++;
        }
        
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      break;
    }
    
    default: {
      log.warn(`[SyncEngine] 未知任务类型: ${taskType}, 跳过 ${batch.length} 条`);
      result.skipped = batch.length;
    }
  }
  
  return result;
}

// ============================================================
// 辅助函数：任务状态管理
// ============================================================

// v457: 委托给类型安全查询模块
async function markTaskSynced(conn: unknown, taskId: number) {
  await Q.markTaskSynced(conn, taskId);
}

// v457: 委托给类型安全查询模块
async function markTaskFailed(conn: unknown, taskId: number, errorMessage: string) {
  await Q.markTaskFailed(conn, taskId, errorMessage);
}

// v457: 委托给类型安全查询模块
async function markTasksFailed(conn: unknown, taskIds: number[], errorMessage: string) {
  await Q.markTasksFailed(conn, taskIds, errorMessage);
}

// v457: 委托给类型安全查询模块
async function markTaskForRetry(conn: unknown, taskId: number, currentRetryCount: number, errorMessage: string) {
  await Q.markTaskForRetry(conn, taskId, currentRetryCount, errorMessage);
}

// v457: 委托给类型安全查询模块
async function updateLocalBid(conn: unknown, entityType: string, entityId: number, newBid: string) {
  if (entityType === 'keyword') {
    await Q.updateKeywordBid(conn, entityId, newBid);
  } else if (entityType === 'product_target') {
    await Q.updateProductTargetBid(conn, entityId, newBid);
  }
}

// v457: 委托给类型安全查询模块
async function updateLocalStatus(conn: unknown, tableName: string, entityId: number, newStatus: string) {
  await Q.updateEntityStatus(conn, tableName, entityId, newStatus);
}

// ============================================================
// Phase 3: 更新日志同步状态
// ============================================================

/**
 * 根据batch的同步结果，更新optimization_logs的api_sync_status
 */
// v457: 委托给类型安全查询模块
async function updateLogsSyncStatus(conn: unknown, batchId: string) {
  try {
    const stats = await Q.getBatchTaskStats(conn, batchId);
    
    let logSyncStatus: string;
    if (stats.pending + stats.retry > 0) {
      logSyncStatus = 'syncing';
    } else if (stats.failed === 0 && stats.synced > 0) {
      logSyncStatus = 'synced';
    } else if (stats.synced === 0 && stats.failed > 0) {
      logSyncStatus = 'failed';
    } else {
      logSyncStatus = 'partial';
    }
    
    await Q.updateLogsSyncStatus(conn, batchId, logSyncStatus, stats.synced, stats.failed, stats.pending, stats.retry);
    
    log.warn(`[SyncEngine] 更新日志同步状态: batchId=${batchId}, status=${logSyncStatus}, synced=${stats.synced}, failed=${stats.failed}`);
  } catch (err: unknown) {
    log.warn(`[SyncEngine] 更新日志同步状态失败: ${(err as Error).message}`);
  }
}

// ============================================================
// 重试调度器
// ============================================================

/**
 * 处理失败重试任务
 * 由调度器每5分钟调用一次
 */
export async function processRetryTasks(): Promise<{ processed: number; synced: number; failed: number }> {
  log.debug(`[SyncEngine] v199: 检查重试任务...`);
  
  // v196: 先尝试重置permanently_failed任务（如果Amazon ID已经可用）
  await resetRecoverableFailedTasks();
  
  // v199: 移除maxTasks限制，确保处理所有待重试任务
  // 原先的maxTasks: 500导致大量任务积压无法及时处理
  const result = await executeBatchSync();
  
  log.warn(`[SyncEngine] v199: 重试任务处理完成: 总计=${result.totalTasks}, 成功=${result.synced}, 失败=${result.failed}`);
  
  return {
    processed: result.totalTasks,
    synced: result.synced,
    failed: result.failed,
  };
}

/**
 * v196: 自动重置可恢复的permanently_failed任务
 * 检查永久失败的任务是否现在有了Amazon ID（通过绩效同步回填等），如果有则重新入队
 */
async function resetRecoverableFailedTasks(): Promise<number> {
  // v457: 使用类型安全查询模块
  const conn = await db.getDirectConnection();
  
  try {
    const failedTasks = await Q.getRecoverableFailedTasks(conn);
    if (failedTasks.length === 0) return 0;
    
    let recovered = 0;
    for (const task of failedTasks) {
      let amazonId: string | null = null;
      
      if (task.target_entity_type === 'keyword') {
        // @ts-expect-error v653: untyped task row from mysql2 execute result
        amazonId = await Q.getKeywordAmazonId(conn, task.target_entity_id, true);
      } else if (task.target_entity_type === 'product_target') {
        // @ts-expect-error v653: untyped task row from mysql2 execute result
        amazonId = await Q.getProductTargetAmazonId(conn, task.target_entity_id);
      } else if (task.target_entity_type === 'campaign') {
        // @ts-expect-error v653: untyped task row from mysql2 execute result
        amazonId = await Q.getCampaignAmazonId(conn, task.target_entity_id);
      }
      
      if (amazonId) {
        // @ts-expect-error v653: untyped task row from mysql2 execute result
        await Q.recoverTask(conn, task.id, amazonId);
        recovered++;
      }
    }
    
    if (recovered > 0) {
      log.warn(`[SyncEngine] v457: 自动恢复了${recovered}/${failedTasks.length}个失败任务`);
    }
    return recovered;
  } catch (err: unknown) {
    log.warn(`[SyncEngine] v457: 重置失败任务异常: ${(err as Error).message}`);
    return 0;
  } finally {
    conn.release();
  }
}

/**
 * 获取批次同步状态摘要
 */
export async function getBatchStatus(batchId: string): Promise<{
  total: number;
  synced: number;
  failed: number;
  pending: number;
  retry: number;
  permanentlyFailed: number;
}> {
  // v457: 使用类型安全查询模块
  const conn = await db.getDirectConnection();
  
  try {
    const stats = await Q.getBatchTaskStats(conn, batchId);
    return {
      total: stats.synced + stats.failed + stats.pending + stats.retry + stats.permanentlyFailed,
      synced: stats.synced,
      failed: stats.failed,
      pending: stats.pending,
      retry: stats.retry,
      permanentlyFailed: stats.permanentlyFailed,
    };
  } finally {
    conn.release();
  }
}
