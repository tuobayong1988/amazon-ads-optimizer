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
  
  log.debug(`[SyncEngine] 入队任务: batchId=${batchId}, 总计=${tasks.length}条`);
  
  // v350: 使用连接池获取直接连接，替代独立createConnection
  const conn = await db.getDirectConnection();
  
  try {
    // 分批插入（每批500条）
    const INSERT_BATCH = 500;
    for (let i = 0; i < tasks.length; i += INSERT_BATCH) {
      const batch = tasks.slice(i, i + INSERT_BATCH);
      // v429.1: 使用SQL NOW()替代JS toISOString()，避免时区不一致
      const placeholders = batch.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())').join(', ');
      const values: any[] = [];
      
      for (const t of (batch as any[])) {
        values.push(
          batchId, t.optimizationTargetId, t.accountId,
          t.taskType, t.priority,
          t.targetEntityType, t.targetEntityId, t.amazonEntityId || null, t.targetEntityName || null,
          t.action, t.oldValue || null, t.newValue || null,
          t.changeReason || null, t.algorithmUsed || null, t.confidenceScore || null,
          t.campaignId || null, t.campaignName || null, t.adGroupId || null,
          'pending'
        );
      }
      
      await conn.execute(
        `INSERT INTO optimization_tasks 
         (batch_id, optimization_target_id, account_id, task_type, priority,
          target_entity_type, target_entity_id, amazon_entity_id, target_entity_name,
          action, old_value, new_value, change_reason, algorithm_used, confidence_score,
          campaign_id, campaign_name, ad_group_id, status, created_at)
         VALUES ${placeholders}`,
        values
      );
    }
    
    log.info(`[SyncEngine] ✅ 入队完成: batchId=${batchId}, ${tasks.length}条任务`);
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
  
  // v429: P1修复 — 僵尸任务清理：将超过15分钟仍在processing状态的任务重置为retry
  // v428使用的是30分钟窗口，v429缩短到15分钟以更快恢复被中断的任务
  try {
    const [zombieResult] = await conn.execute(
      `UPDATE optimization_tasks SET status = 'retry', retry_count = retry_count + 1, 
       error_message = CONCAT(IFNULL(error_message,''), ' | v429: 僵尸任务自动重置(processing超过15分钟)') 
       WHERE status = 'processing' AND processing_started_at < DATE_SUB(NOW(), INTERVAL 15 MINUTE)`
    ) as any[];
    const zombieCount = (zombieResult as any)?.affectedRows || 0;
    if (zombieCount > 0) {
      log.warn(`[SyncEngine] v429: 清理${zombieCount}个僵尸任务(processing超过15分钟)`);
    }
  } catch (zombieErr: unknown) {
    log.error(`[SyncEngine] v429: 僵尸任务清理失败: ${(zombieErr as Error).message}`);
  }
  
  // v429: P1修复 — 失效引用前置清理：将引用已删除实体的retry任务标记为cancelled
  // 避免无效的API重试消耗资源
  try {
    // 清理引用已删除keyword的任务
    const [kwCleanResult] = await conn.execute(
      `UPDATE optimization_tasks ot
       LEFT JOIN keywords k ON ot.target_entity_id = k.id
       SET ot.status = 'failed', ot.error_message = CONCAT(IFNULL(ot.error_message,''), ' | v429: 目标keyword已被删除')
       WHERE ot.target_entity_type = 'keyword' AND ot.status IN ('pending', 'retry') AND k.id IS NULL AND ot.target_entity_id IS NOT NULL`
    ) as any[];
    const kwCleanCount = (kwCleanResult as any)?.affectedRows || 0;
    if (kwCleanCount > 0) {
      log.warn(`[SyncEngine] v429: 清理${kwCleanCount}个引用已删除keyword的任务`);
    }
    
    // 清理引用已删除product_target的任务
    const [ptCleanResult] = await conn.execute(
      `UPDATE optimization_tasks ot
       LEFT JOIN product_targets pt ON ot.target_entity_id = pt.id
       SET ot.status = 'failed', ot.error_message = CONCAT(IFNULL(ot.error_message,''), ' | v429: 目标product_target已被删除')
       WHERE ot.target_entity_type = 'product_target' AND ot.status IN ('pending', 'retry') AND pt.id IS NULL AND ot.target_entity_id IS NOT NULL`
    ) as any[];
    const ptCleanCount = (ptCleanResult as any)?.affectedRows || 0;
    if (ptCleanCount > 0) {
      log.warn(`[SyncEngine] v429: 清理${ptCleanCount}个引用已删除product_target的任务`);
    }
  } catch (cleanErr: unknown) {
    log.error(`[SyncEngine] v429: 失效引用清理失败: ${(cleanErr as Error).message}`);
  }
  
  const accountGroups = new Map<number, Record<string, any>[]>();
  try {
    // 1. 读取待处理任务
    let query = `SELECT * FROM optimization_tasks WHERE status IN ('pending', 'retry')`;
    const params: any[] = [];
    
    if (options?.batchId) {
      query += ` AND batch_id = ?`;
      params.push(options.batchId);
    }
    if (options?.accountId) {
      query += ` AND account_id = ?`;
      params.push(options.accountId);
    }
    // 重试任务需要检查next_retry_at
    query += ` AND (status = 'pending' OR (status = 'retry' AND (next_retry_at IS NULL OR next_retry_at <= NOW())))`;
    query += ` ORDER BY priority ASC, created_at ASC`;
    
    if (options?.maxTasks) {
      query += ` LIMIT ${Number(options.maxTasks)}`;
    }
    
    const [rows] = await conn.execute(query, params) as any[];
    result.totalTasks = rows.length;
    
    if (rows.length === 0) {
      log.info(`[SyncEngine] 没有待处理的同步任务`);
      result.duration = Date.now() - startTime;
      return result;
    }
    
    log.info(`[SyncEngine] 读取到 ${rows.length} 条待同步任务`);
    
    // 2. 按账号分组
    for (const row of (rows as any[])) {
      const accId = row.account_id;
      if (!accountGroups.has(accId)) accountGroups.set(accId, []);
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
      const typeGroups = new Map<string, Record<string, any>[]>();
      for (const task of accountTasks) {
        const type = task.task_type;
        if (!typeGroups.has(type)) typeGroups.set(type, []);
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
          log.error(`[SyncEngine] ${taskType} 处理异常: ${(err as Error).message}`);
          result.errors.push(`${taskType}: ${(err as Error).message}`);
          // 标记该类型所有任务为失败
          const taskIds = typeTasks.map((t: Record<string, any>) => t.id);
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
        const bidTasks = accountTasks.filter((t: Record<string, any>) => t.task_type === 'bid_adjustment');
        const statusTasks = accountTasks.filter((t: Record<string, any>) => t.task_type === 'campaign_status' || t.task_type === 'keyword_status');
        const budgetTasks = accountTasks.filter((t: Record<string, any>) => t.task_type === 'budget_adjustment');
        
        // v375: 为所有操作类型添加审计日志，并修复userName显示"未知用户"问题
        const negKeywordTasks = accountTasks.filter((t: Record<string, any>) => t.task_type === 'negative_keyword');
        const newKeywordTasks = accountTasks.filter((t: Record<string, any>) => t.task_type === 'new_keyword');
        const placementTasks = accountTasks.filter((t: Record<string, any>) => t.task_type === 'placement_adjustment');
        const daypartingTasks = accountTasks.filter((t: Record<string, any>) => t.task_type === 'dayparting_adjustment');
        
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
      log.error(`[SyncEngine] v219: 触发确认同步异常: ${(confirmErr as Error).message}`);
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
  tasks: any[],
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
    await markTasksFailed(conn, tasks.map((t: Record<string, any>) => t.id), msg);
    return result;
  }
  
  // 标记任务为processing
  // v429.1: 使用SQL NOW()替代JS toISOString()，避免时区不一致
  const taskIds = tasks.map((t: Record<string, any>) => t.id);
  if (taskIds.length > 0) {
    await conn.execute(
      `UPDATE optimization_tasks SET status = 'processing', processing_started_at = NOW() WHERE id IN (${taskIds.join(',')})`,
    );
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
      const batchResult = await executeBatchByType(conn, syncService, taskType, batch);
      result.synced += batchResult.synced;
      result.failed += batchResult.failed;
      result.errors.push(...batchResult.errors);
    } catch (err: unknown) {
      log.error(`[SyncEngine] 批次 ${i / config.maxBatchSize + 1} 异常: ${(err as Error).message}`);
      result.errors.push((err as Error).message);
      await markTasksFailed(conn, batch.map((t: Record<string, any>) => t.id), (err as Error).message);
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
  syncService: Record<string, any>,
  taskType: string,
  batch: any[]
): Promise<{ synced: number; failed: number; skipped: number; errors: string[] }> {
  const result = { synced: 0, failed: 0, skipped: 0, errors: [] as string[] };
  
  switch (taskType) {
    case 'bid_adjustment': {
      // v138: 先尝试从数据库查找缺失的Amazon ID
      for (const t of (batch as any[])) {
        if (!t.amazon_entity_id && t.target_entity_id) {
          try {
            if (t.target_entity_type === 'keyword') {
              const [kwRows] = await conn.execute(
                'SELECT keywordId FROM keywords WHERE id = ? AND keywordId IS NOT NULL LIMIT 1',
                [t.target_entity_id]
              ) as any[];
              if (kwRows[0]?.keywordId) {
                t.amazon_entity_id = kwRows[0].keywordId;
                await conn.execute(
                  'UPDATE optimization_tasks SET amazon_entity_id = ? WHERE id = ?',
                  [t.amazon_entity_id, t.id]
                );
                log.debug(`[SyncEngine] v138: 自动查找到keyword Amazon ID: local=${t.target_entity_id} -> amazon=${t.amazon_entity_id}`);
              }
            } else if (t.target_entity_type === 'product_target') {
              const [ptRows] = await conn.execute(
                'SELECT targetId FROM product_targets WHERE id = ? AND targetId IS NOT NULL LIMIT 1',
                [t.target_entity_id]
              ) as any[];
              if (ptRows[0]?.targetId) {
                t.amazon_entity_id = ptRows[0].targetId;
                await conn.execute(
                  'UPDATE optimization_tasks SET amazon_entity_id = ? WHERE id = ?',
                  [t.amazon_entity_id, t.id]
                );
                log.debug(`[SyncEngine] v138: 自动查找到product_target Amazon ID: local=${t.target_entity_id} -> amazon=${t.amazon_entity_id}`);
              }
            }
          } catch (lookupErr: unknown) {
            log.warn(`[SyncEngine] v138: 查找Amazon ID失败: ${(lookupErr as Error).message}`);
          }
        }
      }
      
      // v428: P2修复 — Amazon ID前置校验，检查target_entity_id对应的记录是否仍然存在
      // 避免对已删除的关键词/定向发送API请求
      const validatedBatch: any[] = [];
      for (const t of (batch as any[])) {
        if (t.target_entity_id) {
          try {
            const checkTable = t.target_entity_type === 'keyword' ? 'keywords' : 'product_targets';
            const [existRows] = await conn.execute(
              `SELECT id FROM ${checkTable} WHERE id = ? LIMIT 1`,
              [t.target_entity_id]
            ) as any[];
            if (existRows.length === 0) {
              await markTaskFailed(conn, t.id, `v428: 目标实体已不存在 (${checkTable}.id=${t.target_entity_id})`);
              result.failed++;
              continue;
            }
          } catch { /* 校验失败不阻塞执行 */ }
        }
        validatedBatch.push(t);
      }
      
      // 分离keyword和product_target
      const kwTasks = validatedBatch.filter((t: Record<string, any>) => t.target_entity_type === 'keyword' && t.amazon_entity_id);
      const ptTasks = validatedBatch.filter((t: Record<string, any>) => t.target_entity_type === 'product_target' && t.amazon_entity_id);
      const noIdTasks = validatedBatch.filter((t: Record<string, any>) => !t.amazon_entity_id);
      
      // v429: 使用集中式entityIdResolver批量解析缺失的Amazon ID（替代v141的逐个即时回填）
      // entityIdResolver内置10分钟缓存，显著降低数据库查询压力
      if (noIdTasks.length > 0) {
        log.debug(`[SyncEngine] v429: ${noIdTasks.length}条任务缺少Amazon ID，使用entityIdResolver批量解析...`);
        try {
          const { batchResolveKeywordIds, batchResolveProductTargetIds } = await import('../services/entityIdResolver');
          
          // 分离keyword和product_target的无ID任务
          const noIdKwTasks = noIdTasks.filter((t: Record<string, any>) => t.target_entity_type === 'keyword');
          const noIdPtTasks = noIdTasks.filter((t: Record<string, any>) => t.target_entity_type === 'product_target');
          
          // 批量解析keyword IDs
          if (noIdKwTasks.length > 0) {
            const kwIds = noIdKwTasks.map((t: Record<string, any>) => t.target_entity_id);
            const kwResult = await batchResolveKeywordIds(kwIds);
            for (const t of noIdKwTasks) {
              const resolved = kwResult.resolved.get(t.target_entity_id);
              if (resolved) {
                t.amazon_entity_id = resolved.amazonId;
                await conn.execute('UPDATE optimization_tasks SET amazon_entity_id = ? WHERE id = ?', [resolved.amazonId, t.id]);
                kwTasks.push(t);
                log.debug(`[SyncEngine] v429: ✅ 批量解析keyword: id=${t.target_entity_id} -> ${resolved.amazonId}`);
              } else {
                // 回退到旧的amazonIdResolver即时回填（处理keywordId为NULL需要通过API创建的情况）
                try {
                  const { resolveKeywordIdOnDemand } = await import('../services/amazonIdResolver');
                  const resolvedId = await resolveKeywordIdOnDemand(t.account_id, t.target_entity_id);
                  if (resolvedId) {
                    t.amazon_entity_id = resolvedId;
                    await conn.execute('UPDATE optimization_tasks SET amazon_entity_id = ? WHERE id = ?', [resolvedId, t.id]);
                    kwTasks.push(t);
                    log.info(`[SyncEngine] v429: ✅ 回退即时回填成功: keyword id=${t.target_entity_id} -> ${resolvedId}`);
                  } else {
                    await markTaskFailed(conn, t.id, '缺少Amazon ID（entityIdResolver+即时回填均失败）');
                    result.failed++;
                  }
                } catch (fallbackErr: unknown) {
                  await markTaskFailed(conn, t.id, `ID解析失败: ${(fallbackErr as Error).message}`);
                  result.failed++;
                }
              }
            }
          }
          
          // 批量解析product_target IDs
          if (noIdPtTasks.length > 0) {
            const ptIds = noIdPtTasks.map((t: Record<string, any>) => t.target_entity_id);
            const ptResult = await batchResolveProductTargetIds(ptIds);
            for (const t of noIdPtTasks) {
              const resolved = ptResult.resolved.get(t.target_entity_id);
              if (resolved) {
                t.amazon_entity_id = resolved.amazonId;
                await conn.execute('UPDATE optimization_tasks SET amazon_entity_id = ? WHERE id = ?', [resolved.amazonId, t.id]);
                ptTasks.push(t);
                log.debug(`[SyncEngine] v429: ✅ 批量解析product_target: id=${t.target_entity_id} -> ${resolved.amazonId}`);
              } else {
                try {
                  const { resolveProductTargetIdOnDemand } = await import('../services/amazonIdResolver');
                  const resolvedId = await resolveProductTargetIdOnDemand(t.account_id, t.target_entity_id);
                  if (resolvedId) {
                    t.amazon_entity_id = resolvedId;
                    await conn.execute('UPDATE optimization_tasks SET amazon_entity_id = ? WHERE id = ?', [resolvedId, t.id]);
                    ptTasks.push(t);
                    log.info(`[SyncEngine] v429: ✅ 回退即时回填成功: product_target id=${t.target_entity_id} -> ${resolvedId}`);
                  } else {
                    await markTaskFailed(conn, t.id, '缺少Amazon ID（entityIdResolver+即时回填均失败）');
                    result.failed++;
                  }
                } catch (fallbackErr: unknown) {
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
                if (t.target_entity_type === 'keyword') {
                  resolvedId = await resolveKeywordIdOnDemand(t.account_id, t.target_entity_id);
                } else if (t.target_entity_type === 'product_target') {
                  resolvedId = await resolveProductTargetIdOnDemand(t.account_id, t.target_entity_id);
                }
                if (resolvedId) {
                  t.amazon_entity_id = resolvedId;
                  await conn.execute('UPDATE optimization_tasks SET amazon_entity_id = ? WHERE id = ?', [resolvedId, t.id]);
                  if (t.target_entity_type === 'keyword') kwTasks.push(t); else ptTasks.push(t);
                } else {
                  await markTaskFailed(conn, t.id, '缺少Amazon ID（已尝试即时回填）');
                  result.failed++;
                }
              } catch (resolveErr: unknown) {
                await markTaskFailed(conn, t.id, `即时回填异常: ${(resolveErr as Error).message}`);
                result.failed++;
              }
            }
          } catch (importErr: unknown) {
            await markTasksFailed(conn, noIdTasks.map((t: Record<string, any>) => t.id), '缺少Amazon ID（所有解析器均不可用）');
            result.failed += noIdTasks.length;
          }
        }
      }
      
      // v224: 区分SP和SB关键词，使用不同的API端点
      // SB/SBV广告活动的关键词需要使用SB API，SP广告活动使用SP API
      if (kwTasks.length > 0) {
        // 查询每个关键词所属campaign的类型
        const spKwTasks: any[] = [];
        const sbKwTasks: any[] = [];
        
        for (const t of kwTasks) {
          try {
            let campaignType = 'sp_manual'; // 默认SP
            if (t.campaign_id) {
              const [campRows] = await conn.execute(
                'SELECT campaignType FROM campaigns WHERE id = ? OR campaignId = ? LIMIT 1',
                [t.campaign_id, String(t.campaign_id)]
              ) as any[];
              if (campRows.length > 0 && campRows[0].campaignType) {
                campaignType = campRows[0].campaignType;
              }
            } else if (t.target_entity_id) {
              // v429: 修复字段名bug — keywords表中字段名是internal_ad_group_id，不是adGroupId
              const [kwCampRows] = await conn.execute(
                `SELECT c.campaignType FROM keywords k
                 INNER JOIN ad_groups ag ON k.internal_ad_group_id = ag.id
                 INNER JOIN campaigns c ON ag.campaignId = c.campaignId
                 WHERE k.id = ? LIMIT 1`,
                [t.target_entity_id]
              ) as any[];
              if (kwCampRows.length > 0 && kwCampRows[0].campaignType) {
                campaignType = kwCampRows[0].campaignType;
              }
            }
            
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
            const apiResult: any = await (syncService as any).client.updateKeywordBids(
              spKwTasks.map((t: Record<string, any>) => ({
                keywordId: String(t.amazon_entity_id),
                bid: Number(parseFloat(t.new_value).toFixed(2)),
              }))
            );
            
            const failedIds = new Map<string, string>();
            if (apiResult.errors && apiResult.errors.length > 0) {
              for (const err of apiResult.errors) {
                failedIds.set(String(err.keywordId), err.details || (err as any).code || 'API_ERROR');
              }
            }
            
            for (const t of spKwTasks) {
              const spFailReason = failedIds.get(String(t.amazon_entity_id));
              if (spFailReason) {
                // v431: DUPLICATE视为成功 — bid已是目标值
                if (spFailReason === 'DUPLICATE' || spFailReason.includes('DUPLICATE')) {
                  log.info(`[SyncEngine] v431: SP keyword ${t.amazon_entity_id} DUPLICATE视为成功`);
                  await markTaskSynced(conn, t.id);
                  await updateLocalBid(conn, 'keyword', t.target_entity_id, t.new_value);
                  result.synced++;
                } else {
                  await markTaskForRetry(conn, t.id, t.retry_count, spFailReason);
                  result.failed++;
                }
              } else {
                await markTaskSynced(conn, t.id);
                await updateLocalBid(conn, 'keyword', t.target_entity_id, t.new_value);
                result.synced++;
              }
            }
            
            log.warn(`[SyncEngine] SP关键词出价批量同步: 发送=${spKwTasks.length}, 成功=${spKwTasks.length - failedIds.size}, 失败=${failedIds.size}`);
          } catch (err: unknown) {
            log.error(`[SyncEngine] SP关键词出价批量API调用失败: ${(err as Error).message}`);
            for (const t of spKwTasks) {
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
            const sbSkippedTasks: any[] = [];
            
            for (const t of sbKwTasks) {
              try {
                const [kwDetailRows] = await conn.execute(
                  `SELECT k.keywordId, k.campaignId AS amazonCampaignId, ag.adGroupId AS amazonAdGroupId
                   FROM keywords k
                   INNER JOIN ad_groups ag ON k.internal_ad_group_id = ag.id
                   WHERE k.id = ? LIMIT 1`,
                  [t.target_entity_id]
                ) as any[];
                
                if (kwDetailRows.length > 0 && kwDetailRows[0].amazonAdGroupId && kwDetailRows[0].amazonCampaignId) {
                  // v431: SB keyword最低bid保护 — Amazon SB Keywords API要求bid >= $0.25
                  const SB_MIN_BID = 0.25;
                  let sbBid = Number(parseFloat(t.new_value).toFixed(2));
                  if (sbBid < SB_MIN_BID) {
                    log.info(`[SyncEngine] v431: SB keyword bid $${sbBid} 低于最低要求$${SB_MIN_BID}，自动调整为$${SB_MIN_BID}`);
                    sbBid = SB_MIN_BID;
                  }
                  sbUpdates.push({
                    keywordId: String(t.amazon_entity_id),
                    bid: sbBid,
                    adGroupId: String(kwDetailRows[0].amazonAdGroupId),
                    campaignId: String(kwDetailRows[0].amazonCampaignId),
                  });
                } else {
                  // 无法获取关联ID，标记失败
                  await markTaskFailed(conn, t.id, 'v429: 无法获取SB关键词的adGroupId或campaignId');
                  result.failed++;
                  sbSkippedTasks.push(t);
                }
              } catch (detailErr: unknown) {
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
              ? await (syncService as any).client.updateSbKeywordBids(sbUpdates)
              : { successes: [], errors: [] };
            
            // v428: 构建keywordId到失败原因的映射
            const sbFailedIds = new Map<string, string>();
            if (sbApiResult.errors && sbApiResult.errors.length > 0) {
              for (const err of sbApiResult.errors) {
                sbFailedIds.set(String(err.keywordId), err.details || err.code || 'SB_API_ERROR');
              }
            }
            
            for (const t of activeSbTasks) {
              const failReason = sbFailedIds.get(String(t.amazon_entity_id));
              if (failReason) {
                // v431: DUPLICATE视为成功 — 表示bid已经是目标值，无需重试
                if (failReason === 'DUPLICATE' || failReason.includes('DUPLICATE')) {
                  log.info(`[SyncEngine] v431: SB keyword ${t.amazon_entity_id} DUPLICATE视为成功（bid已是目标值）`);
                  await markTaskSynced(conn, t.id);
                  await updateLocalBid(conn, 'keyword', t.target_entity_id, t.new_value);
                  result.synced++;
                } else {
                  await markTaskForRetry(conn, t.id, t.retry_count, failReason);
                  result.failed++;
                }
              } else {
                await markTaskSynced(conn, t.id);
                await updateLocalBid(conn, 'keyword', t.target_entity_id, t.new_value);
                result.synced++;
              }
            }
            
            log.warn(`[SyncEngine] v429: SB关键词出价批量同步: 发送=${sbUpdates.length}, 成功=${sbUpdates.length - sbFailedIds.size}, 失败=${sbFailedIds.size}, 跳过=${sbSkippedTasks.length}`);
          } catch (err: unknown) {
            log.error(`[SyncEngine] v429: SB关键词出价批量API调用失败: ${(err as Error).message}`);
            for (const t of sbKwTasks) {
              await markTaskForRetry(conn, t.id, t.retry_count, (err as Error).message);
            }
            result.failed += sbKwTasks.length;
            result.errors.push(`SB关键词出价API失败: ${(err as Error).message}`);
          }
        }
      }
      
      // 批量更新商品定向出价
      if (ptTasks.length > 0) {
        try {
          const apiResult: any = await (syncService as any).client.updateProductTargetBids(
            ptTasks.map((t: Record<string, any>) => ({
              targetId: String(t.amazon_entity_id),
              bid: Number(parseFloat(t.new_value).toFixed(2)),
            }))
          );
          
          const failedIds = new Map<string, string>();
          if (apiResult.errors && apiResult.errors.length > 0) {
            for (const err of apiResult.errors) {
              failedIds.set(String(err.targetId), err.details || (err as any).code || 'API_ERROR');
            }
          }
          
          for (const t of ptTasks) {
            if (failedIds.has(String(t.amazon_entity_id))) {
              await markTaskForRetry(conn, t.id, t.retry_count, failedIds.get(String(t.amazon_entity_id))!);
              result.failed++;
            } else {
              await markTaskSynced(conn, t.id);
              await updateLocalBid(conn, 'product_target', t.target_entity_id, t.new_value);
              result.synced++;
            }
          }
          
          log.warn(`[SyncEngine] 商品定向出价批量同步: 发送=${ptTasks.length}, 成功=${ptTasks.length - failedIds.size}, 失败=${failedIds.size}`);
        } catch (err: unknown) {
          for (const t of ptTasks) {
            await markTaskForRetry(conn, t.id, t.retry_count, (err as Error).message);
          }
          result.failed += ptTasks.length;
          result.errors.push(`商品定向出价API失败: ${(err as Error).message}`);
        }
      }
      break;
    }
    
    case 'keyword_status': {
      // v429: 使用entityIdResolver批量解析keyword_status任务的Amazon ID
      // 替代v138的逐个数据库查询和v141的即时回填
      const validTasks: any[] = [];
      const noIdTasks: any[] = [];
      
      // 先将已有Amazon ID的任务分到validTasks
      for (const t of (batch as any[])) {
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
          const kwIds = noIdTasks.map((t: Record<string, any>) => t.target_entity_id);
          const kwResult = await batchResolveKeywordIds(kwIds);
          
          for (const t of noIdTasks) {
            const resolved = kwResult.resolved.get(t.target_entity_id);
            if (resolved) {
              t.amazon_entity_id = resolved.amazonId;
              await conn.execute('UPDATE optimization_tasks SET amazon_entity_id = ? WHERE id = ?', [resolved.amazonId, t.id]);
              validTasks.push(t);
              log.debug(`[SyncEngine] v429: ✅ keyword_status批量解析: id=${t.target_entity_id} -> ${resolved.amazonId}`);
            } else {
              // 回退到amazonIdResolver即时回填
              try {
                const { resolveKeywordIdOnDemand } = await import('../services/amazonIdResolver');
                const resolvedId = await resolveKeywordIdOnDemand(t.account_id, t.target_entity_id);
                if (resolvedId) {
                  t.amazon_entity_id = resolvedId;
                  await conn.execute('UPDATE optimization_tasks SET amazon_entity_id = ? WHERE id = ?', [resolvedId, t.id]);
                  validTasks.push(t);
                } else {
                  await markTaskFailed(conn, t.id, '缺少Amazon ID（entityIdResolver+即时回填均失败）');
                  result.failed++;
                }
              } catch (fallbackErr: unknown) {
                await markTaskFailed(conn, t.id, `ID解析失败: ${(fallbackErr as Error).message}`);
                result.failed++;
              }
            }
          }
        } catch (resolverErr: unknown) {
          // entityIdResolver不可用时回退
          log.warn(`[SyncEngine] v429: entityIdResolver不可用，回退到amazonIdResolver`);
          try {
            const { resolveKeywordIdOnDemand } = await import('../services/amazonIdResolver');
            for (const t of noIdTasks) {
              try {
                const resolvedId = await resolveKeywordIdOnDemand(t.account_id, t.target_entity_id);
                if (resolvedId) {
                  t.amazon_entity_id = resolvedId;
                  await conn.execute('UPDATE optimization_tasks SET amazon_entity_id = ? WHERE id = ?', [resolvedId, t.id]);
                  validTasks.push(t);
                } else {
                  await markTaskFailed(conn, t.id, '缺少Amazon ID（已尝试即时回填）');
                  result.failed++;
                }
              } catch (resolveErr: unknown) {
                await markTaskFailed(conn, t.id, `即时回填异常: ${(resolveErr as Error).message}`);
                result.failed++;
              }
            }
          } catch (importErr: unknown) {
            await markTasksFailed(conn, noIdTasks.map((t: Record<string, any>) => t.id), '缺少Amazon ID（所有解析器均不可用）');
            result.failed += noIdTasks.length;
          }
        }
      }
      
      if (validTasks.length > 0) {
        try {
          const apiResult: any = await (syncService as any).client.updateKeywordStatus(
            validTasks.map((t: Record<string, any>) => ({
              keywordId: String(t.amazon_entity_id),
              state: t.new_value as 'enabled' | 'paused' | 'archived',
            }))
          );
          
          // v431: 增强错误信息记录 — 保留API返回的具体错误码和描述
          const failedIdMap = new Map<string, string>();
          if (apiResult.errors && apiResult.errors.length > 0) {
            for (const err of apiResult.errors) {
              const errDetail = err.details || err.description || err.code || err.message || 'UNKNOWN_ERROR';
              failedIdMap.set(String(err.keywordId), `v431: keyword_status API错误: ${errDetail}`);
              log.error(`[SyncEngine] v431: keyword_status失败: keywordId=${err.keywordId}, code=${err.code}, details=${errDetail}`);
            }
          }
          
          for (const t of validTasks) {
            const statusFailReason = failedIdMap.get(String(t.amazon_entity_id));
            if (statusFailReason) {
              await markTaskForRetry(conn, t.id, t.retry_count, statusFailReason);
              result.failed++;
            } else {
              await markTaskSynced(conn, t.id);
              await updateLocalStatus(conn, 'keywords', t.target_entity_id, t.new_value);
              result.synced++;
            }
          }
          
          log.warn(`[SyncEngine] v431: 关键词状态批量同步: 发送=${validTasks.length}, 成功=${validTasks.length - failedIdMap.size}, 失败=${failedIdMap.size}`);
        } catch (err: unknown) {
          for (const t of validTasks) {
            await markTaskForRetry(conn, t.id, t.retry_count, (err as Error).message);
          }
          result.failed += validTasks.length;
        }
      }
      break;
    }
    
    case 'campaign_status': {
      // 广告活动状态逐个更新（Amazon API不支持批量更新Campaign状态）
      for (const t of (batch as any[])) {
        try {
          if (!t.amazon_entity_id) {
            await markTaskFailed(conn, t.id, '缺少Amazon Campaign ID');
            result.failed++;
            continue;
          }
          
          await (syncService as any).client.updateSpCampaign(
            String(t.amazon_entity_id),
            { state: t.new_value === 'enabled' ? 'ENABLED' : 'PAUSED' }
          );
          
          await markTaskSynced(conn, t.id);
          await updateLocalStatus(conn, 'campaigns', t.target_entity_id, t.new_value);
          result.synced++;
          
          log.info(`[SyncEngine] ✅ 广告活动状态同步: ${t.target_entity_name} → ${t.new_value}`);
        } catch (err: unknown) {
          await markTaskForRetry(conn, t.id, t.retry_count, (err as Error).message);
          result.failed++;
          result.errors.push(`Campaign ${t.target_entity_name}: ${(err as Error).message}`);
        }
        
        // 每个API调用间延迟200ms
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      break;
    }
    
    case 'adgroup_status': {
      // v431: 修复方法名 updateSpAdGroup → updateSpAdGroupStatus，使用批量API
      const validAdGroupTasks = (batch as any[]).filter(t => t.amazon_entity_id);
      const invalidAdGroupTasks = (batch as any[]).filter(t => !t.amazon_entity_id);
      
      // 标记缺少ID的任务为失败
      for (const t of invalidAdGroupTasks) {
        await markTaskFailed(conn, t.id, '缺少Amazon AdGroup ID');
        result.failed++;
      }
      
      if (validAdGroupTasks.length > 0) {
        try {
          const agResult = await (syncService as any).client.updateSpAdGroupStatus(
            validAdGroupTasks.map((t: any) => ({
              adGroupId: String(t.amazon_entity_id),
              state: t.new_value === 'enabled' ? 'enabled' : 'paused',
            }))
          );
          
          const agFailedIds = new Map<string, string>();
          if (agResult.errors && agResult.errors.length > 0) {
            for (const err of agResult.errors) {
              agFailedIds.set(String(err.adGroupId), err.details || err.code || 'API_ERROR');
            }
          }
          
          for (const t of validAdGroupTasks) {
            const failReason = agFailedIds.get(String(t.amazon_entity_id));
            if (failReason) {
              await markTaskForRetry(conn, t.id, t.retry_count, `v431: AdGroup状态更新失败: ${failReason}`);
              result.failed++;
            } else {
              await markTaskSynced(conn, t.id);
              await updateLocalStatus(conn, 'ad_groups', t.target_entity_id, t.new_value);
              result.synced++;
              log.info(`[SyncEngine] ✅ 广告组状态同步: ${t.target_entity_name} → ${t.new_value}`);
            }
          }
          
          log.warn(`[SyncEngine] v431: 广告组状态批量同步: 发送=${validAdGroupTasks.length}, 成功=${validAdGroupTasks.length - agFailedIds.size}, 失败=${agFailedIds.size}`);
        } catch (err: unknown) {
          for (const t of validAdGroupTasks) {
            await markTaskForRetry(conn, t.id, t.retry_count, (err as Error).message);
          }
          result.failed += validAdGroupTasks.length;
        }
      }
      break;
    }
    
    case 'negative_keyword': {
      // v189: 否定词批量创建 - 增强自动回填Amazon campaignId
      // v395: P1修复 — 同时获取campaignType，过滤掉SB/SD类型（SP API不支持）
      // 先尝试回填缺少的campaign_id，并获取campaignType
      for (const t of (batch as any[])) {
        if (!t.campaign_id && t.target_entity_id) {
          try {
            const [rows] = await conn.execute(
              'SELECT campaignId, campaignType FROM campaigns WHERE id = ? LIMIT 1',
              [t.target_entity_id]
            ) as any[];
            if (rows.length > 0 && rows[0].campaignId) {
              t.campaign_id = rows[0].campaignId;
              t.amazon_entity_id = rows[0].campaignId;
              t._campaignType = rows[0].campaignType || 'sp_manual';
            }
          } catch (lookupErr: unknown) {
            // 忽略查找失败
          }
        } else if (t.campaign_id && !t._campaignType) {
          // v395: 已有campaign_id但缺少campaignType，尝试查询
          try {
            const [rows] = await conn.execute(
              'SELECT campaignType FROM campaigns WHERE campaignId = ? LIMIT 1',
              [t.campaign_id]
            ) as any[];
            if (rows.length > 0) {
              t._campaignType = rows[0].campaignType || 'sp_manual';
            }
          } catch (lookupErr: unknown) {
            // 忽略查找失败
          }
        }
      }
      
      // v395: 过滤掉SB/SD类型的campaign（SP否定词API不支持SB/SD）
      const spTasks = (batch as any[]).filter((t: Record<string, any>) => {
        const cType = (t._campaignType || 'sp_manual').toLowerCase();
        return cType.startsWith('sp') || cType === '' || !t._campaignType;
      });
      const nonSpTasks = (batch as any[]).filter((t: Record<string, any>) => {
        const cType = (t._campaignType || '').toLowerCase();
        return cType === 'sb' || cType === 'sd';
      });
      
      // v428: P2修复 — SB否定词使用SB专用API（POST /sb/negativeKeywords）而不是直接跳过
      // SD不支持否定关键词，仅支持否定产品定向，所以SD仍然跳过
      const sbNegTasks = nonSpTasks.filter((t: Record<string, any>) => {
        const cType = (t._campaignType || '').toLowerCase();
        return cType === 'sb';
      });
      const sdNegTasks = nonSpTasks.filter((t: Record<string, any>) => {
        const cType = (t._campaignType || '').toLowerCase();
        return cType === 'sd';
      });
      
      // SD否定词任务直接跳过（SD不支持否定关键词）
      for (const t of sdNegTasks) {
        await markTaskFailed(conn, t.id, `v428: SD不支持否定关键词，仅支持否定产品定向`);
        result.skipped = (result.skipped || 0) + 1;
      }
      
      // v428: SB否定词使用SB专用API (POST /sb/negativeKeywords)
      if (sbNegTasks.length > 0) {
        const sbNegValidTasks = sbNegTasks.filter((t: Record<string, any>) => t.campaign_id || t.amazon_entity_id);
        if (sbNegValidTasks.length > 0) {
          try {
            // v428: 需要回填adGroupId，SB否定词需要adGroupId
            for (const t of sbNegValidTasks) {
              if (!t.ad_group_id && t.target_entity_id) {
                try {
                  const [agRows] = await conn.execute(
                    'SELECT ag.adGroupId FROM ad_groups ag JOIN campaigns c ON ag.internalCampaignId = c.id WHERE c.campaignId = ? LIMIT 1',
                    [t.amazon_entity_id || t.campaign_id]
                  ) as any[];
                  if (agRows.length > 0) t.ad_group_id = agRows[0].adGroupId;
                } catch { /* ignore */ }
              }
            }
            
            const sbNegApiResults = await (syncService as any).client.createSbNegativeKeywords(
              sbNegValidTasks.map((t: Record<string, any>) => ({
                campaignId: String(t.amazon_entity_id || t.campaign_id),
                adGroupId: t.ad_group_id ? String(t.ad_group_id) : '0',
                keywordText: t.target_entity_name,
                matchType: (t.action || '').includes('exact') || (t.action || '').includes('Exact')
                  ? 'negativeExact' as const : 'negativePhrase' as const,
              }))
            );
            // createSbNegativeKeywords返回数组，每个元素包含结果
            const sbNegSuccessCount = Array.isArray(sbNegApiResults) ? sbNegApiResults.filter((r: any) => r.code === 'SUCCESS' || r.negativeKeywordId).length : 0;
            if (sbNegSuccessCount > 0 || (Array.isArray(sbNegApiResults) && sbNegApiResults.length > 0)) {
              for (const t of sbNegValidTasks) {
                await markTaskSynced(conn, t.id);
              }
              result.synced += sbNegValidTasks.length;
              log.info(`[SyncEngine] v428: SB否定词同步成功: ${sbNegValidTasks.length}个`);
            } else {
              for (const t of sbNegValidTasks) {
                await markTaskForRetry(conn, t.id, t.retry_count, 'SB否定词API返回空结果');
              }
              result.failed += sbNegValidTasks.length;
            }
          } catch (sbNegErr: unknown) {
            log.error(`[SyncEngine] v428: SB否定词API调用失败: ${(sbNegErr as Error).message}`);
            for (const t of sbNegValidTasks) {
              await markTaskForRetry(conn, t.id, t.retry_count, (sbNegErr as Error).message);
            }
            result.failed += sbNegValidTasks.length;
          }
        }
        // 无法回填campaign_id的SB任务
        const sbNegInvalidTasks = sbNegTasks.filter((t: Record<string, any>) => !t.campaign_id && !t.amazon_entity_id);
        for (const t of sbNegInvalidTasks) {
          await markTaskFailed(conn, t.id, 'v428: SB否定词缺少Amazon Campaign ID');
          result.failed++;
        }
      }
      
      const validTasks = spTasks.filter((t: Record<string, any>) => t.campaign_id || t.amazon_entity_id);
      const invalidTasks = spTasks.filter((t: Record<string, any>) => !t.campaign_id && !t.amazon_entity_id);
      
      // 标记无法处理的任务
      for (const t of invalidTasks) {
        await markTaskFailed(conn, t.id, '缺少Amazon Campaign ID且无法回填');
        result.failed++;
      }
      
      if (validTasks.length > 0) {
        // v189: 使用amazonApiHelper.syncNegativeKeywordsToAmazon以获得更好的错误处理
        try {
          const negSyncResult = await amazonApiHelper.syncNegativeKeywordsToAmazon(
            validTasks[0].account_id,
            validTasks.map((t: Record<string, any>) => ({
              campaignId: String(t.amazon_entity_id || t.campaign_id),  // v356: 统一使用String类型传递Amazon ID
              keywordText: t.target_entity_name,
              matchType: (t.action || '').includes('exact') || (t.action || '').includes('Exact') 
                ? 'negativeExact' as const : 'negativePhrase' as const,
              level: 'campaign' as const,
            }))
          );
          
          if (negSyncResult.failed === 0 && negSyncResult.success > 0) {
            // 全部成功
            for (const t of validTasks) {
              await markTaskSynced(conn, t.id);
            }
            result.synced += validTasks.length;
          } else if (negSyncResult.success > 0) {
            // 部分成功 - 标记所有为成功（批量API无法区分单个失败）
            for (const t of validTasks) {
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
                await markTaskSynced(conn, t.id);
              }
              result.synced += validTasks.length;
            } else {
              for (const t of validTasks) {
                await markTaskForRetry(conn, t.id, t.retry_count, errorStr);
              }
              result.failed += validTasks.length;
            }
          }
        } catch (err: unknown) {
          for (const t of validTasks) {
            await markTaskForRetry(conn, t.id, t.retry_count, (err as Error).message);
          }
          result.failed += validTasks.length;
        }
      }
      break;
    }
    
    case 'new_keyword': {
      const validTasks = batch.filter((t: Record<string, any>) => t.ad_group_id);
      
      if (validTasks.length > 0) {
        try {
          const createResult = await (syncService as any).client.createSpKeywords(
            validTasks.map((t: Record<string, any>) => ({
              adGroupId: Number(t.ad_group_id),
              campaignId: Number(t.campaign_id),
              keywordText: t.target_entity_name,
              matchType: (t.action.replace('create_', '') || 'broad') as 'exact' | 'phrase' | 'broad',
              bid: parseFloat(t.new_value) || 0.5,
              state: 'enabled' as const,
            }))
          );
          
          for (let i = 0; i < validTasks.length; i++) {
            const t = validTasks[i];
            const created = createResult?.createdKeywords?.[i];
            if (created && created.code === 'SUCCESS' && created.keywordId) {
              await markTaskSynced(conn, t.id);
              // v357: 更新本地关键词的Amazon keywordId，同时回填accountId和campaignId
              if (t.target_entity_id) {
                await conn.execute(
                  `UPDATE keywords SET keywordId = ?, 
                   accountId = COALESCE(accountId, ?),
                   campaignId = COALESCE(campaignId, ?)
                   WHERE id = ? AND keywordId IS NULL`,
                  [String(created.keywordId), t.account_id || null, t.campaign_id || null, t.target_entity_id]
                );
                log.info(`[SyncEngine] v357: keyword已同步: localId=${t.target_entity_id}, amazonKeywordId=${created.keywordId}`);
              }
              result.synced++;
            } else {
              await markTaskForRetry(conn, t.id, t.retry_count, created?.code || 'CREATE_FAILED');
              result.failed++;
            }
          }
        } catch (err: unknown) {
          for (const t of validTasks) {
            await markTaskForRetry(conn, t.id, t.retry_count, (err as Error).message);
          }
          result.failed += validTasks.length;
        }
      }
      break;
    }
    
    case 'placement_adjustment': {
      for (const t of (batch as any[])) {
        try {
          // 位置倾斜通过Campaign的bidding策略更新
          const placementType = t.action; // e.g., 'top_of_search', 'product_pages'
          const multiplier = parseFloat(t.new_value) || 0;
          
          // v189: 如果缺少Amazon Campaign ID，尝试自动回填
          let amazonCampaignId = t.amazon_entity_id;
          if (!amazonCampaignId && t.target_entity_id) {
            try {
              const [rows] = await conn.execute(
                'SELECT campaignId FROM campaigns WHERE id = ? LIMIT 1',
                [t.target_entity_id]
              ) as any[];
              if (rows.length > 0 && rows[0].campaignId) {
                amazonCampaignId = rows[0].campaignId;
                await conn.execute(
                  'UPDATE optimization_tasks SET amazon_entity_id = ? WHERE id = ?',
                  [amazonCampaignId, t.id]
                );
                log.debug(`[SyncEngine] v189: 回填位置倾斜Amazon campaignId: local=${t.target_entity_id} -> amazon=${amazonCampaignId}`);
              }
            } catch (lookupErr: unknown) {
              log.warn(`[SyncEngine] v189: 查找Amazon campaignId失败: ${(lookupErr as Error).message}`);
            }
          }
          
          if (amazonCampaignId) {
            // v423: 使用API v3的dynamicBidding.placementBidding格式
            const v3PlacementType = placementType === 'top_of_search' ? 'PLACEMENT_TOP' 
              : placementType === 'rest_of_search' ? 'PLACEMENT_REST_OF_SEARCH'
              : 'PLACEMENT_PRODUCT_PAGE';
            await (syncService as any).client.updateSpCampaign(
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
            
            await markTaskSynced(conn, t.id);
            result.synced++;
          } else {
            await markTaskFailed(conn, t.id, '缺少Amazon Campaign ID且无法回填');
            result.failed++;
          }
        } catch (err: unknown) {
          await markTaskForRetry(conn, t.id, t.retry_count, (err as Error).message);
          result.failed++;
        }
        
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      break;
    }
    
    case 'budget_adjustment': {
      // v189: 使用amazonApiHelper.syncBudgetAdjustmentToAmazon以支持SP/SB/SD不同类型的campaign
      for (const t of (batch as any[])) {
        try {
          let amazonCampaignId = t.amazon_entity_id;
          let campaignType = 'sp_manual';
          
          // v189: 如果缺少Amazon Campaign ID，尝试通过本地ID回填
          if (!amazonCampaignId && t.target_entity_id) {
            try {
              const [rows] = await conn.execute(
                'SELECT campaignId, campaignType FROM campaigns WHERE id = ? LIMIT 1',
                [t.target_entity_id]
              ) as any[];
              if (rows.length > 0 && rows[0].campaignId) {
                amazonCampaignId = rows[0].campaignId;
                campaignType = rows[0].campaignType || 'sp_manual';
                await conn.execute(
                  'UPDATE optimization_tasks SET amazon_entity_id = ? WHERE id = ?',
                  [amazonCampaignId, t.id]
                );
                log.debug(`[SyncEngine] v189: 回填Amazon campaignId: local=${t.target_entity_id} -> amazon=${amazonCampaignId}`);
              }
            } catch (lookupErr: unknown) {
              log.warn(`[SyncEngine] v189: 查找Amazon campaignId失败: ${(lookupErr as Error).message}`);
            }
          } else if (amazonCampaignId) {
            // 查询campaign类型以选择正确的API
            try {
              const [campRows] = await conn.execute(
                'SELECT campaignType FROM campaigns WHERE campaignId = ? OR id = ? LIMIT 1',
                [String(amazonCampaignId), t.target_entity_id || 0]
              ) as any[];
              if (campRows.length > 0 && campRows[0].campaignType) {
                campaignType = campRows[0].campaignType;
              }
            } catch (lookupErr: unknown) {
              // 查询失败时默认使用sp_manual
            }
          }
          
          if (amazonCampaignId) {
            const newBudget = parseFloat(t.new_value) || 0;
            const budgetSyncResult = await amazonApiHelper.syncBudgetAdjustmentToAmazon(
              t.account_id,
              String(amazonCampaignId),
              newBudget,
              t.change_reason || '预算调整重试',
              campaignType
            );
            
            if (budgetSyncResult) {
              await markTaskSynced(conn, t.id);
              result.synced++;
            } else {
              await markTaskForRetry(conn, t.id, t.retry_count, 'API返回false');
              result.failed++;
            }
          } else {
            await markTaskFailed(conn, t.id, '缺少Amazon Campaign ID且无法回填');
            result.failed++;
          }
        } catch (err: unknown) {
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

// @ts-expect-error - runtime type mismatch
async function markTaskSynced(conn: DbInstance, taskId: number) {
  // v429.1: 使用SQL NOW()替代JS toISOString()，避免时区不一致
  await conn.execute(
    `UPDATE optimization_tasks SET status = 'synced', completed_at = NOW() WHERE id = ?`,
    [taskId]
  );
}

// @ts-expect-error - runtime type mismatch
async function markTaskFailed(conn: DbInstance, taskId: number, errorMessage: string) {
  // v429.1: 使用SQL NOW()替代JS toISOString()，避免时区不一致
  await conn.execute(
    `UPDATE optimization_tasks SET status = 'failed', error_message = ?, completed_at = NOW() WHERE id = ?`,
    [errorMessage.substring(0, 1000), taskId]
  );
}

// @ts-expect-error - runtime type mismatch
async function markTasksFailed(conn: DbInstance, taskIds: number[], errorMessage: string) {
  if (taskIds.length === 0) return;
  // v429.1: 使用SQL NOW()替代JS toISOString()，避免时区不一致
  await conn.execute(
    `UPDATE optimization_tasks SET status = 'failed', error_message = ?, completed_at = NOW() WHERE id IN (${taskIds.join(',')})`,
    [errorMessage.substring(0, 1000)]
  );
}

// @ts-expect-error - runtime type mismatch
async function markTaskForRetry(conn: DbInstance, taskId: number, currentRetryCount: number, errorMessage: string) {
  // v429.1: 修复时区不一致问题
  // 问题: toISOString()返回UTC时间，但数据库NOW()返回US/Pacific时间
  // 解决: 统一使用SQL的NOW()和DATE_ADD()来设置时间戳，避免JS/DB时区不一致
  const newRetryCount = (currentRetryCount || 0) + 1;
  
  // v190: 增加重试次数到5次，延长退避时间，确保更高的最终成功率
  // 重试策略: 1分钟 -> 5分钟 -> 15分钟 -> 30分钟 -> 60分钟
  // 总等待时间约111分钟（近两小时），足以覆盖大多数临时性API故障
  const MAX_RETRIES = 5;
  
  if (newRetryCount >= MAX_RETRIES) {
    // 超过最大重试次数，标记为永久失败
    await conn.execute(
      `UPDATE optimization_tasks SET status = 'permanently_failed', error_message = ?, retry_count = ?, completed_at = NOW() WHERE id = ?`,
      [`超过最大重试次数(${MAX_RETRIES}): ${errorMessage}`.substring(0, 1000), newRetryCount, taskId]
    );
  } else {
    // v429.1: 使用SQL的DATE_ADD(NOW(), INTERVAL)设置next_retry_at
    // 这样next_retry_at和WHERE条件中的NOW()使用相同时区
    const retryDelayMinutes = [1, 5, 15, 30, 60][newRetryCount - 1] || 60;
    
    await conn.execute(
      `UPDATE optimization_tasks SET status = 'retry', error_message = ?, retry_count = ?, next_retry_at = DATE_ADD(NOW(), INTERVAL ? MINUTE) WHERE id = ?`,
      [errorMessage.substring(0, 1000), newRetryCount, retryDelayMinutes, taskId]
    );
  }
}

// @ts-expect-error - runtime type mismatch
async function updateLocalBid(conn: DbInstance, entityType: string, entityId: number, newBid: string) {
  // v429.1: 使用SQL NOW()替代JS toISOString()，避免时区不一致
  if (entityType === 'keyword') {
    await conn.execute('UPDATE keywords SET bid = ?, updatedAt = NOW() WHERE id = ?', [newBid, entityId]);
  } else if (entityType === 'product_target') {
    await conn.execute('UPDATE product_targets SET bid = ?, updatedAt = NOW() WHERE id = ?', [newBid, entityId]);
  }
}

// @ts-expect-error - runtime type mismatch
async function updateLocalStatus(conn: DbInstance, tableName: string, entityId: number, newStatus: string) {
  // v362: SQL注入防护 - 白名单验证表名
  // v428: P1修复 — 修复列名映射错误，各表的状态列名不同
  const TABLE_STATUS_COLUMN: Record<string, string> = {
    'keywords': 'keywordStatus',
    'product_targets': 'targetStatus',
    'campaigns': 'campaignStatus',
    'ad_groups': 'adGroupStatus',
  };
  const statusColumn = TABLE_STATUS_COLUMN[tableName];
  if (!statusColumn) {
    throw new Error(`[updateLocalStatus] 非法表名: ${tableName}`);
  }
  // v429.1: 使用SQL NOW()替代JS toISOString()，避免时区不一致
  const statusValue = newStatus === 'enabled' ? 'enabled' : 'paused';
  await conn.execute(`UPDATE ${tableName} SET ${statusColumn} = ?, updatedAt = NOW() WHERE id = ?`, [statusValue, entityId]);
}

// ============================================================
// Phase 3: 更新日志同步状态
// ============================================================

/**
 * 根据batch的同步结果，更新optimization_logs的api_sync_status
 */
// @ts-expect-error - runtime type mismatch
async function updateLogsSyncStatus(conn: DbInstance, batchId: string) {
  try {
    // 统计该批次的同步结果
    const [stats] = await conn.execute(
      `SELECT status, COUNT(*) as cnt FROM optimization_tasks WHERE batch_id = ? GROUP BY status`,
      [batchId]
    ) as any[];
    
    let totalSynced = 0, totalFailed = 0, totalPending = 0, totalRetry = 0;
    for (const s of stats) {
      if (s.status === 'synced') totalSynced = s.cnt;
      else if (s.status === 'failed' || s.status === 'permanently_failed') totalFailed += s.cnt;
      else if (s.status === 'pending' || s.status === 'processing') totalPending += s.cnt;
      else if (s.status === 'retry') totalRetry += s.cnt;
    }
    
    let logSyncStatus: string;
    if (totalPending + totalRetry > 0) {
      logSyncStatus = 'syncing';
    } else if (totalFailed === 0 && totalSynced > 0) {
      logSyncStatus = 'synced';
    } else if (totalSynced === 0 && totalFailed > 0) {
      logSyncStatus = 'failed';
    } else {
      logSyncStatus = 'partial';
    }
    
    // 更新该批次对应的所有optimization_logs
    // v429.1: 移除未使用的now变量（时区不一致修复）
    await conn.execute(
      `UPDATE optimization_logs 
       SET api_sync_status = ?, 
           action_detail = JSON_SET(COALESCE(action_detail, '{}'), 
             '$.syncBatchId', ?,
             '$.syncSummary', JSON_OBJECT('synced', ?, 'failed', ?, 'pending', ?, 'retry', ?))
       WHERE action_detail LIKE CONCAT('%', ?, '%') 
         AND created_at >= DATE_SUB(NOW(), INTERVAL 1 DAY)`,
      [logSyncStatus, batchId, totalSynced, totalFailed, totalPending, totalRetry, batchId]
    );
    
    log.warn(`[SyncEngine] 更新日志同步状态: batchId=${batchId}, status=${logSyncStatus}, synced=${totalSynced}, failed=${totalFailed}`);
  } catch (err: unknown) {
    log.error(`[SyncEngine] 更新日志同步状态失败: ${(err as Error).message}`);
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
  // v350: 使用连接池获取直接连接
  const conn = await db.getDirectConnection();
  
  try {
    // 查找永久失败且缺少Amazon ID的任务
    const [failedTasks] = await conn.execute(
      `SELECT ot.id, ot.target_entity_type, ot.target_entity_id, ot.task_type
       FROM optimization_tasks ot
       WHERE ot.status IN ('permanently_failed', 'failed')
         AND (ot.amazon_entity_id IS NULL OR ot.amazon_entity_id = '')
         AND ot.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
       LIMIT 200`
    ) as any[];
    
    if (failedTasks.length === 0) return 0;
    
    let recovered = 0;
    for (const task of failedTasks) {
      let amazonId: string | null = null;
      
      if (task.target_entity_type === 'keyword') {
        const [rows] = await conn.execute(
          'SELECT keywordId FROM keywords WHERE id = ? AND keywordId IS NOT NULL AND keywordId NOT LIKE "SKIP_%" LIMIT 1',
          [task.target_entity_id]
        ) as any[];
        if (rows[0]?.keywordId) amazonId = rows[0].keywordId;
      } else if (task.target_entity_type === 'product_target') {
        const [rows] = await conn.execute(
          'SELECT targetId FROM product_targets WHERE id = ? AND targetId IS NOT NULL LIMIT 1',
          [task.target_entity_id]
        ) as any[];
        if (rows[0]?.targetId) amazonId = rows[0].targetId;
      } else if (task.target_entity_type === 'campaign') {
        const [rows] = await conn.execute(
          'SELECT campaignId FROM campaigns WHERE id = ? AND campaignId IS NOT NULL LIMIT 1',
          [task.target_entity_id]
        ) as any[];
        if (rows[0]?.campaignId) amazonId = rows[0].campaignId;
      }
      
      if (amazonId) {
        await conn.execute(
          `UPDATE optimization_tasks SET status = 'pending', amazon_entity_id = ?, retry_count = 0, error_message = 'v196: 自动恢复 - Amazon ID已可用' WHERE id = ?`,
          [amazonId, task.id]
        );
        recovered++;
      }
    }
    
    if (recovered > 0) {
      log.warn(`[SyncEngine] v196: 自动恢复了${recovered}/${failedTasks.length}个失败任务`);
    }
    return recovered;
  } catch (err: unknown) {
    log.error(`[SyncEngine] v196: 重置失败任务异常: ${(err as Error).message}`);
    return 0;
  } finally {
    conn.release(); // v350: 归还连接到池
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
  // v350: 使用连接池获取直接连接
  const conn = await db.getDirectConnection();
  
  try {
    const [rows] = await conn.execute(
      `SELECT status, COUNT(*) as cnt FROM optimization_tasks WHERE batch_id = ? GROUP BY status`,
      [batchId]
    );
    
    const result = { total: 0, synced: 0, failed: 0, pending: 0, retry: 0, permanentlyFailed: 0 };
    for (const r of (rows as any[])) {
      result.total += r.cnt;
      if (r.status === 'synced') result.synced = r.cnt;
      else if (r.status === 'failed') result.failed = r.cnt;
      else if (r.status === 'pending' || r.status === 'processing') result.pending += r.cnt;
      else if (r.status === 'retry') result.retry = r.cnt;
      else if (r.status === 'permanently_failed') result.permanentlyFailed = r.cnt;
    }
    
    return result;
  } finally {
    conn.release(); // v350: 归还连接到池
  }
}
