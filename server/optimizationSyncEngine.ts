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

import * as db from './db';
import * as amazonApiHelper from './services/amazonApiHelper';
import { randomUUID } from 'crypto';
import { isShuttingDown, registerActiveTask, unregisterActiveTask } from './deployLifecycleManager';
import { createModuleLogger } from './utils/logger';

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
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  
  log.debug(`[SyncEngine] 入队任务: batchId=${batchId}, 总计=${tasks.length}条`);
  
  // 使用直接SQL批量插入，避免ORM开销
  const mysql2 = await import('mysql2/promise');
  const conn = await mysql2.createConnection({
    host: process.env.DATABASE_HOST || 'amazon-ads-optimizer-db.ci7y0uwu0aid.us-east-1.rds.amazonaws.com',
    user: process.env.DATABASE_USER || 'admin',
    password: process.env.DATABASE_PASSWORD || 'Mucers2025',
    database: process.env.DATABASE_NAME || 'amazon_ads_optimizer',
  });
  
  try {
    // 分批插入（每批500条）
    const INSERT_BATCH = 500;
    for (let i = 0; i < tasks.length; i += INSERT_BATCH) {
      const batch = tasks.slice(i, i + INSERT_BATCH);
      const placeholders = batch.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
      const values: any[] = [];
      
      for (const t of batch) {
        values.push(
          batchId, t.optimizationTargetId, t.accountId,
          t.taskType, t.priority,
          t.targetEntityType, t.targetEntityId, t.amazonEntityId || null, t.targetEntityName || null,
          t.action, t.oldValue || null, t.newValue || null,
          t.changeReason || null, t.algorithmUsed || null, t.confidenceScore || null,
          t.campaignId || null, t.campaignName || null, t.adGroupId || null,
          'pending', now
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
    await conn.end();
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
  
  const mysql2 = await import('mysql2/promise');
  const conn = await mysql2.createConnection({
    host: process.env.DATABASE_HOST || 'amazon-ads-optimizer-db.ci7y0uwu0aid.us-east-1.rds.amazonaws.com',
    user: process.env.DATABASE_USER || 'admin',
    password: process.env.DATABASE_PASSWORD || 'Mucers2025',
    database: process.env.DATABASE_NAME || 'amazon_ads_optimizer',
  });
  
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
    const accountGroups = new Map<number, any[]>();
    for (const row of rows) {
      const accId = row.account_id;
      if (!accountGroups.has(accId)) accountGroups.set(accId, []);
      accountGroups.get(accId)!.push(row);
    }
    
    log.debug(`[SyncEngine] 分为 ${accountGroups.size} 个账号组`);
    
    // 3. 逐账号处理
    for (const [accountId, accountTasks] of accountGroups) {
      log.info(`[SyncEngine] --- 处理账号 ${accountId}: ${accountTasks.length} 条任务 ---`);
      
      // 按任务类型分组
      const typeGroups = new Map<string, any[]>();
      for (const task of accountTasks) {
        const type = task.task_type;
        if (!typeGroups.has(type)) typeGroups.set(type, []);
        typeGroups.get(type)!.push(task);
      }
      
      // 按类型批量处理
      for (const [taskType, typeTasks] of typeGroups) {
        log.info(`[SyncEngine] 处理 ${taskType}: ${typeTasks.length} 条`);
        
        try {
          const typeResult = await syncTasksByType(conn, accountId, taskType, typeTasks, options?.dryRun);
          result.synced += typeResult.synced;
          result.failed += typeResult.failed;
          result.skipped += typeResult.skipped;
          if (typeResult.errors.length > 0) {
            result.errors.push(...typeResult.errors.slice(0, 5));
          }
        } catch (err: any) {
          log.error(`[SyncEngine] ${taskType} 处理异常: ${err.message}`);
          result.errors.push(`${taskType}: ${err.message}`);
          // 标记该类型所有任务为失败
          const taskIds = typeTasks.map((t: any) => t.id);
          await markTasksFailed(conn, taskIds, err.message);
          result.failed += typeTasks.length;
        }
      }
    }
    
    // 4. 更新对应的 optimization_logs 的 api_sync_status
    if (options?.batchId) {
      await updateLogsSyncStatus(conn, options.batchId);
    }
    
  } finally {
    await conn.end();
  }
  
  result.duration = Date.now() - startTime;
  log.info(`[SyncEngine] ========== 批量同步完成 ==========`);
  log.warn(`[SyncEngine] 总计=${result.totalTasks}, 成功=${result.synced}, 失败=${result.failed}, 跳过=${result.skipped}, 耗时=${result.duration}ms`);
  
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
      
      // 异步触发确认同步（不阻塞当前流程）
      for (const [accountId, entities] of affectedAccounts) {
        confirmationSync(accountId, Array.from(entities) as any[], 'optimizationSyncEngine').then(syncResult => {
          if (syncResult) {
            log.info(`[SyncEngine] v219: 确认同步完成 - 账户 ${accountId}: ${syncResult.completedSteps}/${syncResult.totalSteps}步成功`);
          }
        }).catch(err => {
          log.error(`[SyncEngine] v219: 确认同步失败 - 账户 ${accountId}: ${err.message}`);
        });
      }
    } catch (confirmErr: any) {
      log.error(`[SyncEngine] v219: 触发确认同步异常: ${confirmErr.message}`);
    }
  }
  
  return result;
}

/**
 * 按任务类型批量同步到Amazon
 */
async function syncTasksByType(
  conn: any,
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
    await markTasksFailed(conn, tasks.map((t: any) => t.id), msg);
    return result;
  }
  
  // 标记任务为processing
  const taskIds = tasks.map((t: any) => t.id);
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  if (taskIds.length > 0) {
    await conn.execute(
      `UPDATE optimization_tasks SET status = 'processing', processing_started_at = ? WHERE id IN (${taskIds.join(',')})`,
      [now]
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
    } catch (err: any) {
      log.error(`[SyncEngine] 批次 ${i / config.maxBatchSize + 1} 异常: ${err.message}`);
      result.errors.push(err.message);
      await markTasksFailed(conn, batch.map((t: any) => t.id), err.message);
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
  conn: any,
  syncService: any,
  taskType: string,
  batch: any[]
): Promise<{ synced: number; failed: number; skipped: number; errors: string[] }> {
  const result = { synced: 0, failed: 0, skipped: 0, errors: [] as string[] };
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  
  switch (taskType) {
    case 'bid_adjustment': {
      // v138: 先尝试从数据库查找缺失的Amazon ID
      for (const t of batch) {
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
          } catch (lookupErr: any) {
            log.warn(`[SyncEngine] v138: 查找Amazon ID失败: ${lookupErr.message}`);
          }
        }
      }
      
      // 分离keyword和product_target
      const kwTasks = batch.filter((t: any) => t.target_entity_type === 'keyword' && t.amazon_entity_id);
      const ptTasks = batch.filter((t: any) => t.target_entity_type === 'product_target' && t.amazon_entity_id);
      const noIdTasks = batch.filter((t: any) => !t.amazon_entity_id);
      
      // v141: 对无Amazon ID的任务使用即时回填机制
      if (noIdTasks.length > 0) {
        log.debug(`[SyncEngine] v141: ${noIdTasks.length}条任务缺少Amazon ID，尝试即时回填...`);
        try {
          const { resolveKeywordIdOnDemand, resolveProductTargetIdOnDemand } = await import('./services/amazonIdResolver');
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
                await conn.execute(
                  'UPDATE optimization_tasks SET amazon_entity_id = ? WHERE id = ?',
                  [resolvedId, t.id]
                );
                // 重新分配到对应的任务队列
                if (t.target_entity_type === 'keyword') {
                  kwTasks.push(t);
                } else {
                  ptTasks.push(t);
                }
                log.info(`[SyncEngine] v141: ✅ 即时回填成功: ${t.target_entity_type} id=${t.target_entity_id} -> ${resolvedId}`);
              } else {
                await markTaskFailed(conn, t.id, '缺少Amazon ID（已尝试即时回填）');
                result.failed++;
              }
            } catch (resolveErr: any) {
              await markTaskFailed(conn, t.id, `即时回填异常: ${resolveErr.message}`);
              result.failed++;
            }
          }
        } catch (importErr: any) {
          await markTasksFailed(conn, noIdTasks.map((t: any) => t.id), '缺少Amazon ID（即时回填模块加载失败）');
          result.failed += noIdTasks.length;
        }
      }
      
      // 批量更新关键词出价
      if (kwTasks.length > 0) {
        try {
          const apiResult = await syncService.client.updateKeywordBids(
            kwTasks.map((t: any) => ({
              keywordId: String(t.amazon_entity_id),
              bid: Number(parseFloat(t.new_value).toFixed(2)),
            }))
          );
          
          // 解析API响应，区分成功和失败
          const successIds = new Set<string>();
          const failedIds = new Map<string, string>();
          
          if (apiResult.errors && apiResult.errors.length > 0) {
            for (const err of apiResult.errors) {
              failedIds.set(String(err.keywordId), err.details || err.code || 'API_ERROR');
            }
          }
          
          for (const t of kwTasks) {
            if (failedIds.has(String(t.amazon_entity_id))) {
              await markTaskFailed(conn, t.id, failedIds.get(String(t.amazon_entity_id))!);
              result.failed++;
            } else {
              await markTaskSynced(conn, t.id);
              // 更新本地数据库出价
              await updateLocalBid(conn, 'keyword', t.target_entity_id, t.new_value);
              result.synced++;
            }
          }
          
          log.warn(`[SyncEngine] 关键词出价批量同步: 发送=${kwTasks.length}, 成功=${kwTasks.length - failedIds.size}, 失败=${failedIds.size}`);
        } catch (err: any) {
          log.error(`[SyncEngine] 关键词出价批量API调用失败: ${err.message}`);
          // API调用整体失败，所有任务标记为失败并设置重试
          for (const t of kwTasks) {
            await markTaskForRetry(conn, t.id, t.retry_count, err.message);
          }
          result.failed += kwTasks.length;
          result.errors.push(`关键词出价API失败: ${err.message}`);
        }
      }
      
      // 批量更新商品定向出价
      if (ptTasks.length > 0) {
        try {
          const apiResult = await syncService.client.updateProductTargetBids(
            ptTasks.map((t: any) => ({
              targetId: String(t.amazon_entity_id),
              bid: Number(parseFloat(t.new_value).toFixed(2)),
            }))
          );
          
          const failedIds = new Map<string, string>();
          if (apiResult.errors && apiResult.errors.length > 0) {
            for (const err of apiResult.errors) {
              failedIds.set(String(err.targetId), err.details || err.code || 'API_ERROR');
            }
          }
          
          for (const t of ptTasks) {
            if (failedIds.has(String(t.amazon_entity_id))) {
              await markTaskFailed(conn, t.id, failedIds.get(String(t.amazon_entity_id))!);
              result.failed++;
            } else {
              await markTaskSynced(conn, t.id);
              await updateLocalBid(conn, 'product_target', t.target_entity_id, t.new_value);
              result.synced++;
            }
          }
          
          log.warn(`[SyncEngine] 商品定向出价批量同步: 发送=${ptTasks.length}, 成功=${ptTasks.length - failedIds.size}, 失败=${failedIds.size}`);
        } catch (err: any) {
          for (const t of ptTasks) {
            await markTaskForRetry(conn, t.id, t.retry_count, err.message);
          }
          result.failed += ptTasks.length;
          result.errors.push(`商品定向出价API失败: ${err.message}`);
        }
      }
      break;
    }
    
    case 'keyword_status': {
      // v138: 先尝试从数据库查找缺失的Amazon ID
      for (const t of batch) {
        if (!t.amazon_entity_id && t.target_entity_id) {
          try {
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
              log.debug(`[SyncEngine] v138: keyword_status自动查找到Amazon ID: local=${t.target_entity_id} -> amazon=${t.amazon_entity_id}`);
            }
          } catch (lookupErr: any) {
            log.warn(`[SyncEngine] v138: keyword_status查找Amazon ID失败: ${lookupErr.message}`);
          }
        }
      }
      
      const validTasks = batch.filter((t: any) => t.amazon_entity_id);
      const noIdTasks = batch.filter((t: any) => !t.amazon_entity_id);
      
      // v141: 对无Amazon ID的任务使用即时回填机制
      if (noIdTasks.length > 0) {
        try {
          const { resolveKeywordIdOnDemand } = await import('./services/amazonIdResolver');
          for (const t of noIdTasks) {
            try {
              const resolvedId = await resolveKeywordIdOnDemand(t.account_id, t.target_entity_id);
              if (resolvedId) {
                t.amazon_entity_id = resolvedId;
                await conn.execute('UPDATE optimization_tasks SET amazon_entity_id = ? WHERE id = ?', [resolvedId, t.id]);
                validTasks.push(t);
                log.debug(`[SyncEngine] v141: ✅ keyword_status即时回填: id=${t.target_entity_id} -> ${resolvedId}`);
              } else {
                await markTaskFailed(conn, t.id, '缺少Amazon ID（已尝试即时回填）');
                result.failed++;
              }
            } catch (resolveErr: any) {
              await markTaskFailed(conn, t.id, `即时回填异常: ${resolveErr.message}`);
              result.failed++;
            }
          }
        } catch (importErr: any) {
          await markTasksFailed(conn, noIdTasks.map((t: any) => t.id), '缺少Amazon ID（即时回填模块加载失败）');
          result.failed += noIdTasks.length;
        }
      }
      
      if (validTasks.length > 0) {
        try {
          const apiResult = await syncService.client.updateKeywordStatus(
            validTasks.map((t: any) => ({
              keywordId: String(t.amazon_entity_id),
              state: t.new_value as 'enabled' | 'paused' | 'archived',
            }))
          );
          
          const failedIds = new Set<string>();
          if (apiResult.errors && apiResult.errors.length > 0) {
            for (const err of apiResult.errors) {
              failedIds.add(String(err.keywordId));
            }
          }
          
          for (const t of validTasks) {
            if (failedIds.has(String(t.amazon_entity_id))) {
              await markTaskFailed(conn, t.id, 'API返回错误');
              result.failed++;
            } else {
              await markTaskSynced(conn, t.id);
              await updateLocalStatus(conn, 'keywords', t.target_entity_id, t.new_value);
              result.synced++;
            }
          }
          
          log.warn(`[SyncEngine] 关键词状态批量同步: 发送=${validTasks.length}, 成功=${validTasks.length - failedIds.size}`);
        } catch (err: any) {
          for (const t of validTasks) {
            await markTaskForRetry(conn, t.id, t.retry_count, err.message);
          }
          result.failed += validTasks.length;
        }
      }
      break;
    }
    
    case 'campaign_status': {
      // 广告活动状态逐个更新（Amazon API不支持批量更新Campaign状态）
      for (const t of batch) {
        try {
          if (!t.amazon_entity_id) {
            await markTaskFailed(conn, t.id, '缺少Amazon Campaign ID');
            result.failed++;
            continue;
          }
          
          await syncService.client.updateSpCampaign(
            String(t.amazon_entity_id),
            { state: t.new_value === 'enabled' ? 'ENABLED' : 'PAUSED' }
          );
          
          await markTaskSynced(conn, t.id);
          await updateLocalStatus(conn, 'campaigns', t.target_entity_id, t.new_value);
          result.synced++;
          
          log.info(`[SyncEngine] ✅ 广告活动状态同步: ${t.target_entity_name} → ${t.new_value}`);
        } catch (err: any) {
          await markTaskForRetry(conn, t.id, t.retry_count, err.message);
          result.failed++;
          result.errors.push(`Campaign ${t.target_entity_name}: ${err.message}`);
        }
        
        // 每个API调用间延迟200ms
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      break;
    }
    
    case 'adgroup_status': {
      for (const t of batch) {
        try {
          if (!t.amazon_entity_id) {
            await markTaskFailed(conn, t.id, '缺少Amazon AdGroup ID');
            result.failed++;
            continue;
          }
          
          await syncService.client.updateSpAdGroup(
            String(t.amazon_entity_id),
            { state: t.new_value === 'enabled' ? 'ENABLED' : 'PAUSED' }
          );
          
          await markTaskSynced(conn, t.id);
          await updateLocalStatus(conn, 'ad_groups', t.target_entity_id, t.new_value);
          result.synced++;
          
          log.info(`[SyncEngine] ✅ 广告组状态同步: ${t.target_entity_name} → ${t.new_value}`);
        } catch (err: any) {
          await markTaskForRetry(conn, t.id, t.retry_count, err.message);
          result.failed++;
        }
        
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      break;
    }
    
    case 'negative_keyword': {
      // v189: 否定词批量创建 - 增强自动回填Amazon campaignId
      // 先尝试回填缺少的campaign_id
      for (const t of batch) {
        if (!t.campaign_id && t.target_entity_id) {
          try {
            const [rows] = await conn.execute(
              'SELECT campaignId FROM campaigns WHERE id = ? LIMIT 1',
              [t.target_entity_id]
            ) as any[];
            if (rows.length > 0 && rows[0].campaignId) {
              t.campaign_id = rows[0].campaignId;
              t.amazon_entity_id = rows[0].campaignId;
            }
          } catch (lookupErr: any) {
            // 忽略查找失败
          }
        }
      }
      
      const validTasks = batch.filter((t: any) => t.campaign_id || t.amazon_entity_id);
      const invalidTasks = batch.filter((t: any) => !t.campaign_id && !t.amazon_entity_id);
      
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
            validTasks.map((t: any) => ({
              campaignId: Number(t.amazon_entity_id || t.campaign_id),
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
            // 全部失败
            for (const t of validTasks) {
              await markTaskForRetry(conn, t.id, t.retry_count, negSyncResult.errors.join('; '));
            }
            result.failed += validTasks.length;
          }
        } catch (err: any) {
          for (const t of validTasks) {
            await markTaskForRetry(conn, t.id, t.retry_count, err.message);
          }
          result.failed += validTasks.length;
        }
      }
      break;
    }
    
    case 'new_keyword': {
      const validTasks = batch.filter((t: any) => t.ad_group_id);
      
      if (validTasks.length > 0) {
        try {
          const createResult = await syncService.client.createSpKeywords(
            validTasks.map((t: any) => ({
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
              // 更新本地关键词的Amazon keywordId
              if (t.target_entity_id) {
                await conn.execute(
                  'UPDATE keywords SET keywordId = ? WHERE id = ? AND keywordId IS NULL',
                  [String(created.keywordId), t.target_entity_id]
                );
              }
              result.synced++;
            } else {
              await markTaskFailed(conn, t.id, created?.code || 'CREATE_FAILED');
              result.failed++;
            }
          }
        } catch (err: any) {
          for (const t of validTasks) {
            await markTaskForRetry(conn, t.id, t.retry_count, err.message);
          }
          result.failed += validTasks.length;
        }
      }
      break;
    }
    
    case 'placement_adjustment': {
      for (const t of batch) {
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
            } catch (lookupErr: any) {
              log.warn(`[SyncEngine] v189: 查找Amazon campaignId失败: ${lookupErr.message}`);
            }
          }
          
          if (amazonCampaignId) {
            await syncService.client.updateSpCampaign(
              String(amazonCampaignId),
              {
                bidding: {
                  strategy: 'LEGACY_FOR_SALES',
                  adjustments: [{
                    predicate: placementType === 'top_of_search' ? 'placementTop' : 'placementProductPage',
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
        } catch (err: any) {
          await markTaskForRetry(conn, t.id, t.retry_count, err.message);
          result.failed++;
        }
        
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      break;
    }
    
    case 'budget_adjustment': {
      // v189: 使用amazonApiHelper.syncBudgetAdjustmentToAmazon以支持SP/SB/SD不同类型的campaign
      for (const t of batch) {
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
            } catch (lookupErr: any) {
              log.warn(`[SyncEngine] v189: 查找Amazon campaignId失败: ${lookupErr.message}`);
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
            } catch (lookupErr: any) {
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
        } catch (err: any) {
          await markTaskForRetry(conn, t.id, t.retry_count, err.message);
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

async function markTaskSynced(conn: any, taskId: number) {
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  await conn.execute(
    `UPDATE optimization_tasks SET status = 'synced', completed_at = ? WHERE id = ?`,
    [now, taskId]
  );
}

async function markTaskFailed(conn: any, taskId: number, errorMessage: string) {
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  await conn.execute(
    `UPDATE optimization_tasks SET status = 'failed', error_message = ?, completed_at = ? WHERE id = ?`,
    [errorMessage.substring(0, 1000), now, taskId]
  );
}

async function markTasksFailed(conn: any, taskIds: number[], errorMessage: string) {
  if (taskIds.length === 0) return;
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  await conn.execute(
    `UPDATE optimization_tasks SET status = 'failed', error_message = ?, completed_at = ? WHERE id IN (${taskIds.join(',')})`,
    [errorMessage.substring(0, 1000), now]
  );
}

async function markTaskForRetry(conn: any, taskId: number, currentRetryCount: number, errorMessage: string) {
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const newRetryCount = (currentRetryCount || 0) + 1;
  
  // v190: 增加重试次数到5次，延长退避时间，确保更高的最终成功率
  // 重试策略: 1分钟 -> 5分钟 -> 15分钟 -> 30分钟 -> 60分钟
  // 总等待时间约111分钟（近两小时），足以覆盖大多数临时性API故障
  const MAX_RETRIES = 5;
  
  if (newRetryCount >= MAX_RETRIES) {
    // 超过最大重试次数，标记为永久失败
    await conn.execute(
      `UPDATE optimization_tasks SET status = 'permanently_failed', error_message = ?, retry_count = ?, completed_at = ? WHERE id = ?`,
      [`超过最大重试次数(${MAX_RETRIES}): ${errorMessage}`.substring(0, 1000), newRetryCount, now, taskId]
    );
  } else {
    // 设置重试时间（指数退避）
    const retryDelayMinutes = [1, 5, 15, 30, 60][newRetryCount - 1] || 60;
    const nextRetry = new Date(Date.now() + retryDelayMinutes * 60 * 1000);
    const nextRetryStr = nextRetry.toISOString().slice(0, 19).replace('T', ' ');
    
    await conn.execute(
      `UPDATE optimization_tasks SET status = 'retry', error_message = ?, retry_count = ?, next_retry_at = ? WHERE id = ?`,
      [errorMessage.substring(0, 1000), newRetryCount, nextRetryStr, taskId]
    );
  }
}

async function updateLocalBid(conn: any, entityType: string, entityId: number, newBid: string) {
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  if (entityType === 'keyword') {
    await conn.execute('UPDATE keywords SET bid = ?, updatedAt = ? WHERE id = ?', [newBid, now, entityId]);
  } else if (entityType === 'product_target') {
    await conn.execute('UPDATE product_targets SET bid = ?, updatedAt = ? WHERE id = ?', [newBid, now, entityId]);
  }
}

async function updateLocalStatus(conn: any, tableName: string, entityId: number, newStatus: string) {
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const statusValue = newStatus === 'enabled' ? 'enabled' : 'paused';
  await conn.execute(`UPDATE ${tableName} SET status = ?, updatedAt = ? WHERE id = ?`, [statusValue, now, entityId]);
}

// ============================================================
// Phase 3: 更新日志同步状态
// ============================================================

/**
 * 根据batch的同步结果，更新optimization_logs的api_sync_status
 */
async function updateLogsSyncStatus(conn: any, batchId: string) {
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
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
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
  } catch (err: any) {
    log.error(`[SyncEngine] 更新日志同步状态失败: ${err.message}`);
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
  const mysql2 = await import('mysql2/promise');
  const conn = await mysql2.createConnection({
    host: process.env.DATABASE_HOST || 'amazon-ads-optimizer-db.ci7y0uwu0aid.us-east-1.rds.amazonaws.com',
    user: process.env.DATABASE_USER || 'admin',
    password: process.env.DATABASE_PASSWORD || 'Mucers2025',
    database: process.env.DATABASE_NAME || 'amazon_ads_optimizer',
  });
  
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
  } catch (err: any) {
    log.error(`[SyncEngine] v196: 重置失败任务异常: ${err.message}`);
    return 0;
  } finally {
    await conn.end();
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
  const mysql2 = await import('mysql2/promise');
  const conn = await mysql2.createConnection({
    host: process.env.DATABASE_HOST || 'amazon-ads-optimizer-db.ci7y0uwu0aid.us-east-1.rds.amazonaws.com',
    user: process.env.DATABASE_USER || 'admin',
    password: process.env.DATABASE_PASSWORD || 'Mucers2025',
    database: process.env.DATABASE_NAME || 'amazon_ads_optimizer',
  });
  
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
    await conn.end();
  }
}
