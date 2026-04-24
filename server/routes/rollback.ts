/**
 * v732.3: 越权操作回滚端点
 * 
 * 用于回滚AutoCorrector越权修改的关键词出价
 * 仅管理员可访问
 * 
 * v732.2: 简化SQL查询，使用分步查询避免复杂JOIN问题
 * v732.3: 添加异步后台回滚模式，解决504 Gateway Timeout
 *         triggerRollback 立即返回，后台逐批执行
 *         rollbackStatus 查询后台回滚进度
 */
import { adminProcedure, router } from "../_core/trpc";
import { getDb } from '../db';
import * as db from '../db';
import { sql } from 'drizzle-orm';
import * as amazonApiHelper from '../services/amazonApiHelper';
import { createModuleLogger } from "../utils/logger";
import { z } from 'zod';

const log = createModuleLogger('v732-Rollback');

// 全局回滚状态存储
const rollbackState: {
  running: boolean;
  accountId: number | null;
  totalTargets: number;
  processed: number;
  successCount: number;
  failedCount: number;
  errors: string[];
  startedAt: string | null;
  completedAt: string | null;
  currentBatch: number;
  totalBatches: number;
  accountQueue: number[];
  accountResults: Array<{ accountId: number; success: number; failed: number }>;
} = {
  running: false,
  accountId: null,
  totalTargets: 0,
  processed: 0,
  successCount: 0,
  failedCount: 0,
  errors: [],
  startedAt: null,
  completedAt: null,
  currentBatch: 0,
  totalBatches: 0,
  accountQueue: [],
  accountResults: [],
};

/**
 * Step 1: 查询所有越权bid_adjustment事件
 */
async function getUnauthorizedBidChanges(accountId: number) {
  const database = await getDb();
  if (!database) throw new Error('Database connection failed');

  // @ts-expect-error - Drizzle raw SQL
  const eventsResult = await database.execute(sql`
    SELECT 
      oe.id as event_id,
      oe.account_id,
      oe.keyword_id,
      oe.keyword_text,
      oe.previous_bid,
      oe.new_bid,
      oe.campaign_id,
      oe.campaign_name,
      oe.change_reason,
      oe.created_at,
      oe.performance_group_id
    FROM optimization_events oe
    WHERE oe.event_category = 'bid_adjustment'
      AND oe.action_type IN ('bid_increase', 'bid_decrease', 'bid_auto_adjust', 'auto_correction', 'dayparting_bid')
      AND oe.status = 'success'
      AND oe.previous_bid IS NOT NULL
      AND oe.previous_bid > 0
      AND oe.created_at > DATE_SUB(NOW(), INTERVAL 30 DAY)
      AND oe.account_id = ${accountId}
    ORDER BY oe.keyword_id, oe.created_at ASC
  `);
  
  const events = ((eventsResult as unknown[][])[0] || eventsResult) as Record<string, unknown>[];
  log.info(`[v732-Rollback] Step1: 账户${accountId} 找到 ${events.length} 条bid_adjustment事件`);

  // Step 2: 获取所有活跃的performance_group IDs
  // @ts-expect-error - Drizzle raw SQL
  const pgResult = await database.execute(sql`
    SELECT id FROM performance_groups 
    WHERE auto_optimize = 1 AND status = 'active'
  `);
  const activePgIds = new Set(
    (((pgResult as unknown[][])[0] || pgResult) as Record<string, unknown>[])
      .map(r => Number(r.id))
  );

  // Step 3: 过滤越权事件
  const unauthorizedEvents = events.filter(e => {
    const pgId = e.performance_group_id;
    if (pgId === null || pgId === undefined) return true;
    return !activePgIds.has(Number(pgId));
  });
  log.info(`[v732-Rollback] Step3: 账户${accountId} 过滤后 ${unauthorizedEvents.length} 条越权事件`);

  // Step 4: 获取关键词当前信息
  const kwIds = [...new Set(
    unauthorizedEvents
      .map(e => e.keyword_id)
      .filter(id => id !== null && id !== undefined && String(id) !== '')
  )];

  const keywordInfoMap = new Map<string, Record<string, unknown>>();
  
  if (kwIds.length > 0) {
    for (let i = 0; i < kwIds.length; i += 500) {
      const batch = kwIds.slice(i, i + 500);
      const idList = batch.map(id => String(id)).join(',');
      // @ts-expect-error - Drizzle raw SQL
      const kwResult = await database.execute(sql`
        SELECT id, bid, keywordId, keywordStatus
        FROM keywords 
        WHERE id IN (${sql.raw(idList)})
      `);
      const kwRows = ((kwResult as unknown[][])[0] || kwResult) as Record<string, unknown>[];
      for (const kw of kwRows) {
        keywordInfoMap.set(String(kw.id), kw);
      }
    }
  }

  return unauthorizedEvents.map(e => ({
    ...e,
    internal_keyword_id: e.keyword_id ? Number(e.keyword_id) : null,
    current_bid: e.keyword_id ? keywordInfoMap.get(String(e.keyword_id))?.bid : null,
    amazon_keyword_id: e.keyword_id ? keywordInfoMap.get(String(e.keyword_id))?.keywordId : null,
    keywordStatus: e.keyword_id ? keywordInfoMap.get(String(e.keyword_id))?.keywordStatus : null,
  }));
}

function computeRollbackTargets(events: Record<string, unknown>[]) {
  const keywordMap = new Map<string, {
    internalKeywordId: number;
    amazonKeywordId: string;
    keywordText: string;
    accountId: number;
    originalBid: number;
    currentBid: number;
    latestNewBid: number;
    eventCount: number;
    firstEventDate: string;
    lastEventDate: string;
    campaignName: string;
  }>();

  for (const event of events) {
    const kwId = String(event.keyword_id || event.internal_keyword_id || '');
    if (!kwId || kwId === 'null' || kwId === 'undefined' || kwId === '') continue;
    
    const amazonKwId = String(event.amazon_keyword_id || '');
    if (!amazonKwId || amazonKwId === 'null' || amazonKwId === 'undefined' || amazonKwId === '') continue;

    const prevBid = parseFloat(String(event.previous_bid));
    if (isNaN(prevBid) || prevBid <= 0) continue;

    const existing = keywordMap.get(kwId);
    if (!existing) {
      keywordMap.set(kwId, {
        internalKeywordId: Number(event.internal_keyword_id || event.keyword_id),
        amazonKeywordId: amazonKwId,
        keywordText: String(event.keyword_text || ''),
        accountId: Number(event.account_id),
        originalBid: prevBid,
        currentBid: parseFloat(String(event.current_bid || 0)),
        latestNewBid: parseFloat(String(event.new_bid)),
        eventCount: 1,
        firstEventDate: String(event.created_at),
        lastEventDate: String(event.created_at),
        campaignName: String(event.campaign_name || ''),
      });
    } else {
      existing.eventCount++;
      existing.latestNewBid = parseFloat(String(event.new_bid));
      existing.lastEventDate = String(event.created_at);
    }
  }

  const targets: Array<typeof keywordMap extends Map<string, infer V> ? V : never> = [];
  for (const [, target] of keywordMap) {
    if (target.currentBid <= 0) continue;
    const bidDiff = Math.abs(target.currentBid - target.latestNewBid);
    if (bidDiff < 0.02 && target.originalBid > 0) {
      targets.push(target);
    }
  }

  return targets;
}

/**
 * 后台执行单个账户的回滚
 */
async function executeAccountRollback(accountId: number, batchSize: number) {
  try {
    rollbackState.accountId = accountId;
    log.info(`[v732-Rollback] 后台回滚开始: accountId=${accountId}`);
    
    const events = await getUnauthorizedBidChanges(accountId);
    const targets = computeRollbackTargets(events);
    
    if (targets.length === 0) {
      log.info(`[v732-Rollback] 账户${accountId}: 无需回滚`);
      rollbackState.accountResults.push({ accountId, success: 0, failed: 0 });
      return;
    }
    
    rollbackState.totalTargets += targets.length;
    rollbackState.totalBatches += Math.ceil(targets.length / batchSize);
    
    let acctSuccess = 0;
    let acctFailed = 0;
    const database = await getDb();
    
    for (let i = 0; i < targets.length; i += batchSize) {
      const batch = targets.slice(i, i + batchSize);
      rollbackState.currentBatch++;
      
      const adjustments = batch.map(t => ({
        keywordId: t.internalKeywordId,
        newBid: t.originalBid,
        reason: `v732-rollback: 恢复越权操作前的原始出价 (${t.currentBid} → ${t.originalBid})`,
      }));
      
      try {
        const syncResult = await amazonApiHelper.syncBidAdjustmentsToAmazon(accountId, adjustments);
        
        for (const t of batch) {
          const itemResult = syncResult.itemResults.get(t.internalKeywordId);
          if (itemResult?.status === 'synced') {
            try {
              await db.updateKeyword(t.internalKeywordId, { bid: String(t.originalBid) });
              acctSuccess++;
              rollbackState.successCount++;
              
              if (database) {
                await database.execute(sql`
                  INSERT INTO optimization_events 
                  (account_id, event_category, action_type, keyword_id, keyword_text, 
                   previous_bid, new_bid, change_reason, status, api_sync_status, created_at)
                  VALUES 
                  (${accountId}, 'bid_adjustment', 'auto_correction', ${String(t.internalKeywordId)}, ${t.keywordText},
                   ${t.currentBid}, ${t.originalBid}, ${'v732-rollback: 恢复越权操作前的原始出价'}, 'success', 'synced', NOW())
                `);
              }
            } catch (dbErr: unknown) {
              log.warn(`[v732-Rollback] DB更新失败 keyword=${t.internalKeywordId}: ${(dbErr as Error).message}`);
            }
          } else {
            acctFailed++;
            rollbackState.failedCount++;
            const errMsg = `keyword ${t.keywordText} (${t.internalKeywordId}): ${itemResult?.error || 'unknown error'}`;
            if (rollbackState.errors.length < 200) rollbackState.errors.push(errMsg);
          }
        }
        
        rollbackState.processed += batch.length;
        log.info(`[v732-Rollback] 账户${accountId} 批次${Math.floor(i/batchSize)+1}: 进度=${rollbackState.processed}/${rollbackState.totalTargets}`);
        
        // 批次间延迟
        if (i + batchSize < targets.length) {
          await new Promise(resolve => setTimeout(resolve, 1500));
        }
      } catch (batchErr: unknown) {
        acctFailed += batch.length;
        rollbackState.failedCount += batch.length;
        rollbackState.processed += batch.length;
        const errMsg = `账户${accountId}批次${Math.floor(i/batchSize)+1}失败: ${(batchErr as Error).message}`;
        log.error(`[v732-Rollback] ${errMsg}`);
        if (rollbackState.errors.length < 200) rollbackState.errors.push(errMsg);
      }
    }
    
    rollbackState.accountResults.push({ accountId, success: acctSuccess, failed: acctFailed });
    log.info(`[v732-Rollback] 账户${accountId} 完成: 成功=${acctSuccess}, 失败=${acctFailed}`);
    
  } catch (err: unknown) {
    log.error(`[v732-Rollback] 账户${accountId} 异常: ${(err as Error).message}`);
    rollbackState.accountResults.push({ accountId, success: 0, failed: -1 });
    if (rollbackState.errors.length < 200) {
      rollbackState.errors.push(`账户${accountId}异常: ${(err as Error).message}`);
    }
  }
}

/**
 * 后台执行多账户回滚队列
 */
async function runRollbackQueue(accountIds: number[], batchSize: number) {
  rollbackState.running = true;
  rollbackState.startedAt = new Date().toISOString();
  rollbackState.completedAt = null;
  rollbackState.accountQueue = [...accountIds];
  
  for (const accountId of accountIds) {
    await executeAccountRollback(accountId, batchSize);
    // 账户间延迟
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  
  rollbackState.running = false;
  rollbackState.completedAt = new Date().toISOString();
  log.info(`[v732-Rollback] 全部回滚完成: 成功=${rollbackState.successCount}, 失败=${rollbackState.failedCount}`);
}

export const rollbackRouter = router({
  // v732: 查看需要回滚的越权操作摘要（按单个账户查询）
  auditSummary: adminProcedure
    .input(z.object({ accountId: z.number().optional() }).optional())
    .query(async ({ input }) => {
      const accountId = input?.accountId;
      if (!accountId) {
        return { error: 'accountId is required for auditSummary' };
      }
      const events = await getUnauthorizedBidChanges(accountId);
      const targets = computeRollbackTargets(events);
      
      const totalBidDiff = targets.reduce((sum, t) => sum + Math.abs(t.currentBid - t.originalBid), 0);
      const maxBidDiff = targets.reduce((max, t) => Math.max(max, Math.abs(t.currentBid - t.originalBid)), 0);
      
      return {
        accountId,
        totalEvents: events.length,
        totalKeywordsToRollback: targets.length,
        totalBidDifference: parseFloat(totalBidDiff.toFixed(2)),
        avgBidDifference: targets.length > 0 ? parseFloat((totalBidDiff / targets.length).toFixed(3)) : 0,
        maxBidDifference: parseFloat(maxBidDiff.toFixed(2)),
        sampleTargets: targets.slice(0, 10).map(t => ({
          keywordText: t.keywordText,
          originalBid: t.originalBid,
          currentBid: t.currentBid,
          campaignName: t.campaignName,
        })),
      };
    }),

  // v732: 执行回滚 - 同步模式（适合小账户）
  executeRollback: adminProcedure
    .input(z.object({ 
      accountId: z.number(),
      dryRun: z.boolean().default(true),
      batchSize: z.number().default(50),
    }))
    .mutation(async ({ input }) => {
      const { accountId, dryRun, batchSize } = input;
      
      const events = await getUnauthorizedBidChanges(accountId);
      const targets = computeRollbackTargets(events);
      
      if (targets.length === 0) {
        return { success: true, message: '没有需要回滚的关键词', rollbackCount: 0, dryRun };
      }
      
      if (dryRun) {
        return {
          success: true,
          dryRun: true,
          message: `模拟回滚: ${targets.length} 个关键词将被恢复原始出价`,
          rollbackCount: targets.length,
          targets: targets.map(t => ({
            keywordText: t.keywordText,
            originalBid: t.originalBid,
            currentBid: t.currentBid,
            bidChange: parseFloat((t.originalBid - t.currentBid).toFixed(2)),
            campaignName: t.campaignName,
          })),
        };
      }
      
      let successCount = 0;
      let failedCount = 0;
      const errors: string[] = [];
      const database = await getDb();
      
      for (let i = 0; i < targets.length; i += batchSize) {
        const batch = targets.slice(i, i + batchSize);
        
        const adjustments = batch.map(t => ({
          keywordId: t.internalKeywordId,
          newBid: t.originalBid,
          reason: `v732-rollback: 恢复越权操作前的原始出价 (${t.currentBid} → ${t.originalBid})`,
        }));
        
        try {
          const syncResult = await amazonApiHelper.syncBidAdjustmentsToAmazon(accountId, adjustments);
          
          for (const t of batch) {
            const itemResult = syncResult.itemResults.get(t.internalKeywordId);
            if (itemResult?.status === 'synced') {
              try {
                await db.updateKeyword(t.internalKeywordId, { bid: String(t.originalBid) });
                successCount++;
                if (database) {
                  await database.execute(sql`
                    INSERT INTO optimization_events 
                    (account_id, event_category, action_type, keyword_id, keyword_text, 
                     previous_bid, new_bid, change_reason, status, api_sync_status, created_at)
                    VALUES 
                    (${accountId}, 'bid_adjustment', 'auto_correction', ${String(t.internalKeywordId)}, ${t.keywordText},
                     ${t.currentBid}, ${t.originalBid}, ${'v732-rollback: 恢复越权操作前的原始出价'}, 'success', 'synced', NOW())
                  `);
                }
              } catch (dbErr: unknown) {
                log.warn(`[v732-Rollback] DB更新失败: ${(dbErr as Error).message}`);
              }
            } else {
              failedCount++;
              errors.push(`keyword ${t.keywordText} (${t.internalKeywordId}): ${itemResult?.error || 'unknown error'}`);
            }
          }
          
          if (i + batchSize < targets.length) {
            await new Promise(resolve => setTimeout(resolve, 1500));
          }
        } catch (batchErr: unknown) {
          failedCount += batch.length;
          errors.push(`批次失败: ${(batchErr as Error).message}`);
        }
      }
      
      return {
        success: true,
        dryRun: false,
        message: `回滚完成: ${successCount} 成功, ${failedCount} 失败`,
        rollbackCount: successCount,
        failedCount,
        errors: errors.slice(0, 50),
      };
    }),

  // v732.3: 触发异步后台回滚（立即返回，不会超时）
  triggerRollback: adminProcedure
    .input(z.object({ 
      accountIds: z.array(z.number()),
      batchSize: z.number().default(20),
    }))
    .mutation(async ({ input }) => {
      const { accountIds, batchSize } = input;
      
      if (rollbackState.running) {
        return {
          success: false,
          message: '已有回滚任务正在运行，请等待完成后再试',
          currentState: { ...rollbackState },
        };
      }
      
      // 重置状态
      rollbackState.running = false;
      rollbackState.accountId = null;
      rollbackState.totalTargets = 0;
      rollbackState.processed = 0;
      rollbackState.successCount = 0;
      rollbackState.failedCount = 0;
      rollbackState.errors = [];
      rollbackState.startedAt = null;
      rollbackState.completedAt = null;
      rollbackState.currentBatch = 0;
      rollbackState.totalBatches = 0;
      rollbackState.accountQueue = [];
      rollbackState.accountResults = [];
      
      // 启动后台任务（不await，立即返回）
      runRollbackQueue(accountIds, batchSize).catch(err => {
        log.error(`[v732-Rollback] 后台回滚队列异常: ${(err as Error).message}`);
        rollbackState.running = false;
        rollbackState.completedAt = new Date().toISOString();
      });
      
      return {
        success: true,
        message: `已启动后台回滚任务: ${accountIds.length} 个账户, batchSize=${batchSize}`,
        accountIds,
      };
    }),

  // v732.3: 查询后台回滚进度
  rollbackStatus: adminProcedure
    .query(async () => {
      return {
        ...rollbackState,
        errors: rollbackState.errors.slice(0, 50), // 只返回前50条错误
      };
    }),
});
