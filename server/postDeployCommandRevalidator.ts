/**
 * PostDeployCommandRevalidator v361
 * 
 * 部署后指令重评估与自动纠错服务
 * 
 * 核心职责:
 * 1. 积压指令重新评估 — 检查所有pending指令是否符合v361新算法逻辑
 *    - 使用安全边界（safetyBoundary）重新验证出价合理性
 *    - 对合理指令重新激发同步，确保亚马逊真正执行
 *    - 对不合理指令取消并记录原因
 * 
 * 2. 历史指令自动纠错 — 回溯审计已执行(synced)指令
 *    - 检测旧算法产生的极端出价/预算调整
 *    - 对不合理的已执行指令生成反向纠正指令
 *    - 纠正指令通过正常同步引擎推送到亚马逊
 * 
 * 3. 审计日志集成 — 所有操作记录到统一审计日志
 * 
 * 设计原则:
 * - 多租户安全: 每次操作都绑定accountId
 * - 幂等性: 同一个版本的重评估不会重复执行
 * - 渐进式: 分批处理，避免API限流
 * - 安全护栏: 纠正指令受安全边界约束
 * - 完整审计: 每个决策都记录到审计日志
 * 
 * 触发方式:
 * - 系统启动时由 postDeployOptimizer 的 correctionActions 触发
 * - 可通过API手动触发
 * 
 * 与现有系统的关系:
 * - 在 postDeployOptimizer 的 revalidate_pending_commands 和 audit_synced_commands 之后运行
 * - 增强版: 使用新算法的安全边界逻辑，而非简单的百分比阈值
 * - 纠正指令通过 optimizationSyncEngine 的正常流程推送到亚马逊
 */

import { getDb } from './db';
import * as db from './db';
import { optimizationEvents, keywords, campaigns, productTargets, performanceGroups } from '../drizzle/schema';
import { eq, and, sql, inArray, desc, gte, or } from 'drizzle-orm';
import { createModuleLogger } from './utils/logger';
import { SYSTEM_VERSION } from './utils/systemVersion';
import { recordAudit, auditSystemAction } from './services/auditLogService';
import { SAFETY_LIMITS, applyBidSafetyBoundary } from './optimization/safetyBoundary';
import { DEFAULT_MAX_BID_CPC, DEFAULT_MIN_BID, MAX_BID_CHANGE_PERCENT } from './optimization/bidOptimizer';

const log = createModuleLogger('CmdRevalidator');

// ==================== 配置 ====================

const REVALIDATION_CONFIG = {
  /** 单次重评估的最大pending指令数 */
  maxPendingPerTarget: 500,
  /** 单次审计的最大synced指令数 */
  maxSyncedPerTarget: 300,
  /** pending指令的最大有效天数 */
  pendingExpiryDays: 7,
  /** synced指令的回溯审计天数 */
  auditLookbackDays: 3,
  /** 纠正指令的最大出价调整幅度（相对于当前出价） */
  maxCorrectionChangePercent: 0.15,
  /** 出价绝对下限 */
  absoluteMinBid: DEFAULT_MIN_BID,
  /** 出价绝对上限 */
  absoluteMaxBid: DEFAULT_MAX_BID_CPC,
  /** 批量处理大小 */
  batchSize: 50,
  /** 批次间等待时间(ms) */
  batchDelayMs: 500,
};

// ==================== 结果类型 ====================

export interface RevalidationResult {
  targetId: number;
  targetName: string;
  accountId: number;
  
  // 积压指令重评估结果
  pendingRevalidation: {
    total: number;
    kept: number;
    cancelled: number;
    retriggered: number;
    errors: number;
  };
  
  // 历史指令纠错结果
  historicalAudit: {
    total: number;
    reasonable: number;
    unreasonable: number;
    correctionGenerated: number;
    errors: number;
  };
  
  errors: string[];
  duration: number;
}

export interface FullRevalidationResult {
  version: number;
  triggeredAt: Date;
  completedAt: Date;
  targetsProcessed: number;
  totalPendingRevalidated: number;
  totalPendingCancelled: number;
  totalPendingRetriggered: number;
  totalHistoricalAudited: number;
  totalCorrectionsGenerated: number;
  targetResults: RevalidationResult[];
  errors: string[];
}

// ==================== 核心函数 ====================

/**
 * 对单个优化目标执行积压指令重新评估
 * 
 * 逻辑:
 * 1. 查询该目标下所有pending的出价/预算/状态变更指令
 * 2. 对每条指令使用新算法的安全边界重新验证
 * 3. 合理指令: 重新激发同步（更新retry_count=0, 确保被同步引擎拾取）
 * 4. 不合理指令: 标记为not_applicable并记录原因
 */
async function revalidatePendingCommands(
  targetId: number,
  targetName: string,
  accountId: number
): Promise<RevalidationResult['pendingRevalidation']> {
  const result = { total: 0, kept: 0, cancelled: 0, retriggered: 0, errors: 0 };
  
  try {
    const database = await getDb();
    if (!database) return result;
    
    // 1. 查询所有pending指令（包括optimization_events和optimization_logs两张表）
    const pendingEvents = await database.execute(
      sql`SELECT oe.id, oe.action_type, oe.event_category, oe.keyword_id, oe.keyword_text,
                 oe.campaign_id, oe.campaign_name, oe.previous_bid, oe.new_bid,
                 oe.previous_value, oe.new_value, oe.created_at, oe.error_message,
                 k.bid as current_bid, k.keywordId as amazon_keyword_id, k.matchType,
                 pt.bid as pt_current_bid, pt.targetId as amazon_target_id,
                 c.dailyBudget as campaign_budget, c.campaignId as amazon_campaign_id
          FROM optimization_events oe
          LEFT JOIN keywords k ON oe.keyword_id = k.id
          LEFT JOIN product_targets pt ON oe.action_type IN ('product_target_create') AND oe.keyword_id = pt.id
          LEFT JOIN campaigns c ON oe.campaign_id = c.id
          WHERE oe.performance_group_id = ${targetId}
            AND oe.api_sync_status = 'pending'
            AND oe.action_type IN (
              'bid_increase', 'bid_decrease', 'bid_set', 'bid_auto_adjust',
              'budget_increase', 'budget_decrease', 'budget_set',
              'target_pause', 'target_enable',
              'keyword_create', 'negative_keyword_add', 'product_target_create'
            )
            AND oe.created_at > DATE_SUB(NOW(), INTERVAL ${REVALIDATION_CONFIG.pendingExpiryDays} DAY)
          ORDER BY oe.created_at DESC
          LIMIT ${REVALIDATION_CONFIG.maxPendingPerTarget}`
    );
    
    const rows = Array.isArray(pendingEvents) 
      ? (Array.isArray((pendingEvents as any)[0]) ? (pendingEvents as any)[0] : pendingEvents)
      : [];
    
    if (rows.length === 0) {
      log.info(`[CmdRevalidator] [${targetName}] 无pending指令需要重评估`);
      return result;
    }
    
    result.total = rows.length;
    log.info(`[CmdRevalidator] [${targetName}] 发现${rows.length}条pending指令需要重评估`);
    
    // 2. 逐条评估
    for (const row of rows) {
      try {
        const evaluation = evaluatePendingCommand(row, targetName);
        
        if (evaluation.shouldCancel) {
          // 取消不合理的指令
          await database.execute(
            sql`UPDATE optimization_events 
                SET api_sync_status = 'not_applicable',
                    api_sync_detail = ${JSON.stringify({
                      cancelledBy: `v${SYSTEM_VERSION}-revalidator`,
                      reason: evaluation.reason,
                      evaluatedAt: new Date().toISOString(),
                    })}
                WHERE id = ${row.id}`
          );
          result.cancelled++;
          
          // 记录审计日志
          recordAudit({
            action: 'optimization.auto_bid',
            accountId,
            entityType: row.action_type?.includes('budget') ? 'campaign' : 'keyword',
            entityId: row.keyword_id || row.campaign_id,
            entityName: row.keyword_text || row.campaign_name,
            previousValue: { action: row.action_type, value: row.new_bid || row.new_value },
            newValue: { status: 'cancelled', reason: evaluation.reason },
            source: 'system',
            result: 'success',
            metadata: { module: 'postDeployRevalidator', version: SYSTEM_VERSION },
          });
        } else {
          // 合理指令: 重新激发同步
          // 重置error_message和retry相关字段，确保同步引擎能重新拾取
          await database.execute(
            sql`UPDATE optimization_events 
                SET api_sync_status = 'pending',
                    error_message = NULL,
                    api_sync_detail = ${JSON.stringify({
                      retriggeredBy: `v${SYSTEM_VERSION}-revalidator`,
                      reason: evaluation.reason,
                      evaluatedAt: new Date().toISOString(),
                    })}
                WHERE id = ${row.id}`
          );
          result.retriggered++;
          result.kept++;
        }
      } catch (evalErr: unknown) {
        result.errors++;
        log.warn(`[CmdRevalidator] [${targetName}] pending重评估单条失败(id=${row.id}): ${(evalErr as Error).message}`);
      }
    }
    
    log.info(`[CmdRevalidator] [${targetName}] pending重评估完成: 总计=${result.total}, 保留并重触发=${result.retriggered}, 取消=${result.cancelled}`);
    
  } catch (err: unknown) {
    log.error(`[CmdRevalidator] [${targetName}] pending重评估失败: ${(err as Error).message}`);
  }
  
  return result;
}

/**
 * 评估单条pending指令是否合理
 */
function evaluatePendingCommand(
  row: Record<string, any>,
  targetName: string
): { shouldCancel: boolean; reason: string } {
  const actionType = row.action_type;
  
  // ===== 出价类指令评估 =====
  if (['bid_increase', 'bid_decrease', 'bid_set', 'bid_auto_adjust'].includes(actionType)) {
    const newBid = parseFloat(String(row.new_bid || row.new_value || 0));
    const prevBid = parseFloat(String(row.previous_bid || row.previous_value || 0));
    const currentBid = parseFloat(String(row.current_bid || row.pt_current_bid || 0));
    
    // 规则1: 缺少Amazon ID的出价指令无法执行
    if (!row.amazon_keyword_id && !row.amazon_target_id) {
      return { shouldCancel: true, reason: `缺少Amazon ID，无法执行出价调整` };
    }
    
    // 规则2: 目标出价已被后续操作覆盖
    if (actionType === 'bid_increase' && currentBid >= newBid) {
      return { shouldCancel: true, reason: `当前出价$${currentBid.toFixed(2)}已>=目标$${newBid.toFixed(2)}，已被后续操作覆盖` };
    }
    if (actionType === 'bid_decrease' && currentBid <= newBid) {
      return { shouldCancel: true, reason: `当前出价$${currentBid.toFixed(2)}已<=目标$${newBid.toFixed(2)}，已被后续操作覆盖` };
    }
    
    // 规则3: 使用安全边界验证出价合理性
    const safeNewBid = applyBidSafetyBoundary(currentBid, newBid);
    if (Math.abs(safeNewBid - newBid) > 0.01) {
      // 出价超出安全边界
      return { shouldCancel: true, reason: `出价$${newBid.toFixed(2)}超出安全边界(允许范围: $${(currentBid * (1 - SAFETY_LIMITS.BID.MAX_DECREASE_PERCENT / 100)).toFixed(2)}-$${(currentBid * (1 + SAFETY_LIMITS.BID.MAX_INCREASE_PERCENT / 100)).toFixed(2)})` };
    }
    
    // 规则4: 出价低于绝对下限
    if (newBid < REVALIDATION_CONFIG.absoluteMinBid) {
      return { shouldCancel: true, reason: `目标出价$${newBid.toFixed(2)}低于绝对下限$${REVALIDATION_CONFIG.absoluteMinBid}` };
    }
    
    // 规则5: 出价高于绝对上限
    if (newBid > REVALIDATION_CONFIG.absoluteMaxBid * 2) {
      return { shouldCancel: true, reason: `目标出价$${newBid.toFixed(2)}超过绝对上限$${(REVALIDATION_CONFIG.absoluteMaxBid * 2).toFixed(2)}` };
    }
    
    // 规则6: 调整幅度过大（>40%）
    if (prevBid > 0) {
      const changePercent = Math.abs(newBid - prevBid) / prevBid;
      if (changePercent > 0.4) {
        return { shouldCancel: true, reason: `调整幅度${(changePercent * 100).toFixed(1)}%超过40%安全阈值` };
      }
    }
    
    // 通过所有检查，指令合理
    return { shouldCancel: false, reason: `v${SYSTEM_VERSION}重评估通过: 出价$${currentBid.toFixed(2)}→$${newBid.toFixed(2)}在安全边界内` };
  }
  
  // ===== 预算类指令评估 =====
  if (['budget_increase', 'budget_decrease', 'budget_set'].includes(actionType)) {
    const newBudget = parseFloat(String(row.new_value || 0));
    const prevBudget = parseFloat(String(row.previous_value || 0));
    const currentBudget = parseFloat(String(row.campaign_budget || 0));
    
    // 规则1: 缺少Amazon Campaign ID
    if (!row.amazon_campaign_id) {
      return { shouldCancel: true, reason: '缺少Amazon Campaign ID，无法执行预算调整' };
    }
    
    // 规则2: 预算调整幅度过大（>50%）
    if (prevBudget > 0) {
      const changePercent = Math.abs(newBudget - prevBudget) / prevBudget;
      if (changePercent > 0.5) {
        return { shouldCancel: true, reason: `预算调整幅度${(changePercent * 100).toFixed(1)}%超过50%安全阈值` };
      }
    }
    
    // 规则3: 预算已被后续操作覆盖
    if (currentBudget > 0 && Math.abs(currentBudget - newBudget) < 0.01) {
      return { shouldCancel: true, reason: `当前预算$${currentBudget.toFixed(2)}已等于目标值，无需调整` };
    }
    
    return { shouldCancel: false, reason: `v${SYSTEM_VERSION}重评估通过: 预算调整在安全范围内` };
  }
  
  // ===== 状态变更指令评估 =====
  if (['target_pause', 'target_enable'].includes(actionType)) {
    if (!row.amazon_keyword_id && !row.amazon_target_id) {
      return { shouldCancel: true, reason: '缺少Amazon ID，无法执行状态变更' };
    }
    return { shouldCancel: false, reason: `v${SYSTEM_VERSION}重评估通过: 状态变更指令有效` };
  }
  
  // ===== 关键词/否定词/商品定向创建指令 =====
  if (['keyword_create', 'negative_keyword_add', 'product_target_create'].includes(actionType)) {
    // 创建类指令一般是合理的，只要有必要的Amazon ID
    if (!row.amazon_campaign_id && actionType !== 'product_target_create') {
      return { shouldCancel: true, reason: '缺少Amazon Campaign ID，无法创建关键词' };
    }
    return { shouldCancel: false, reason: `v${SYSTEM_VERSION}重评估通过: 创建指令有效` };
  }
  
  // 默认: 保留
  return { shouldCancel: false, reason: `v${SYSTEM_VERSION}重评估通过: 默认保留` };
}

/**
 * 对单个优化目标执行历史指令自动纠错
 * 
 * 逻辑:
 * 1. 查询该目标下近期synced的出价/预算调整指令
 * 2. 使用新算法的安全边界检测不合理的已执行指令
 * 3. 对不合理指令生成反向纠正指令（将出价/预算恢复到合理范围）
 * 4. 纠正指令通过正常的optimization_events流程推送到亚马逊
 */
async function auditAndCorrectHistoricalCommands(
  targetId: number,
  targetName: string,
  accountId: number
): Promise<RevalidationResult['historicalAudit']> {
  const result = { total: 0, reasonable: 0, unreasonable: 0, correctionGenerated: 0, errors: 0 };
  
  try {
    const database = await getDb();
    if (!database) return result;
    
    // 1. 查询近期synced的出价调整指令
    const syncedEvents = await database.execute(
      sql`SELECT oe.id, oe.action_type, oe.event_category, oe.keyword_id, oe.keyword_text,
                 oe.campaign_id, oe.campaign_name, oe.ad_group_id,
                 oe.previous_bid, oe.new_bid, oe.previous_value, oe.new_value,
                 oe.created_at, oe.algorithm_version,
                 k.bid as current_bid, k.keywordId as amazon_keyword_id, k.matchType, k.status as keyword_status,
                 c.dailyBudget as campaign_budget, c.campaignId as amazon_campaign_id,
                 pg.target_acos
          FROM optimization_events oe
          LEFT JOIN keywords k ON oe.keyword_id = k.id
          LEFT JOIN campaigns c ON oe.campaign_id = c.id
          LEFT JOIN performance_groups pg ON oe.performance_group_id = pg.id
          WHERE oe.performance_group_id = ${targetId}
            AND oe.api_sync_status = 'synced'
            AND oe.action_type IN ('bid_increase', 'bid_decrease', 'bid_set', 'bid_auto_adjust',
                                    'budget_increase', 'budget_decrease', 'budget_set')
            AND oe.created_at > DATE_SUB(NOW(), INTERVAL ${REVALIDATION_CONFIG.auditLookbackDays} DAY)
          ORDER BY oe.created_at DESC
          LIMIT ${REVALIDATION_CONFIG.maxSyncedPerTarget}`
    );
    
    const rows = Array.isArray(syncedEvents) 
      ? (Array.isArray((syncedEvents as any)[0]) ? (syncedEvents as any)[0] : syncedEvents)
      : [];
    
    if (rows.length === 0) {
      log.info(`[CmdRevalidator] [${targetName}] 无近期synced指令需要审计`);
      return result;
    }
    
    result.total = rows.length;
    log.info(`[CmdRevalidator] [${targetName}] 审计${rows.length}条已执行指令...`);
    
    // 2. 按keyword/campaign分组，只审计每个实体最新的一条（避免重复纠正）
    const latestByEntity = new Map<string, Record<string, any>>();
    for (const row of rows) {
      const entityKey = `${row.action_type?.includes('budget') ? 'campaign' : 'keyword'}_${row.keyword_id || row.campaign_id}`;
      if (!latestByEntity.has(entityKey)) {
        latestByEntity.set(entityKey, row);
      }
    }
    
    // 3. 逐条审计
    for (const [entityKey, row] of latestByEntity) {
      try {
        const audit = auditSyncedCommand(row, targetName);
        
        if (audit.isUnreasonable) {
          result.unreasonable++;
          
          // 生成纠正指令
          if (audit.correctionBid !== undefined || audit.correctionBudget !== undefined) {
            try {
              await generateCorrectionCommand(database, row, audit, targetId, targetName, accountId);
              result.correctionGenerated++;
              
              // 记录审计日志
              recordAudit({
                action: 'optimization.auto_bid',
                accountId,
                entityType: row.action_type?.includes('budget') ? 'campaign' : 'keyword',
                entityId: row.keyword_id || row.campaign_id,
                entityName: row.keyword_text || row.campaign_name,
                previousValue: { 
                  originalAction: row.action_type, 
                  originalValue: row.new_bid || row.new_value,
                  sourceEventId: row.id,
                },
                newValue: { 
                  correctionBid: audit.correctionBid, 
                  correctionBudget: audit.correctionBudget,
                  reason: audit.reason,
                },
                source: 'system',
                result: 'success',
                metadata: { 
                  module: 'postDeployRevalidator', 
                  version: SYSTEM_VERSION,
                  auditType: 'historical_correction',
                },
              });
            } catch (genErr: unknown) {
              result.errors++;
              log.warn(`[CmdRevalidator] [${targetName}] 生成纠正指令失败(id=${row.id}): ${(genErr as Error).message}`);
            }
          }
        } else {
          result.reasonable++;
        }
      } catch (auditErr: unknown) {
        result.errors++;
        log.warn(`[CmdRevalidator] [${targetName}] 审计单条失败(id=${row.id}): ${(auditErr as Error).message}`);
      }
    }
    
    log.info(`[CmdRevalidator] [${targetName}] 历史审计完成: 总计=${result.total}, 合理=${result.reasonable}, 不合理=${result.unreasonable}, 生成纠正=${result.correctionGenerated}`);
    
  } catch (err: unknown) {
    log.error(`[CmdRevalidator] [${targetName}] 历史指令审计失败: ${(err as Error).message}`);
  }
  
  return result;
}

/**
 * 审计单条已执行指令是否合理
 */
function auditSyncedCommand(
  row: Record<string, any>,
  targetName: string
): { isUnreasonable: boolean; reason: string; correctionBid?: number; correctionBudget?: number } {
  const actionType = row.action_type;
  
  // ===== 出价指令审计 =====
  if (['bid_increase', 'bid_decrease', 'bid_set', 'bid_auto_adjust'].includes(actionType)) {
    const executedBid = parseFloat(String(row.new_bid || row.new_value || 0));
    const prevBid = parseFloat(String(row.previous_bid || row.previous_value || 0));
    const currentBid = parseFloat(String(row.current_bid || 0));
    
    if (prevBid <= 0 || executedBid <= 0) {
      return { isUnreasonable: false, reason: '数据不完整，跳过审计' };
    }
    
    // 规则1: 降价幅度超过30%
    if (['bid_decrease', 'bid_set', 'bid_auto_adjust'].includes(actionType) && executedBid < prevBid) {
      const decreasePercent = (prevBid - executedBid) / prevBid;
      if (decreasePercent > 0.30) {
        // 计算合理的纠正出价: 将出价恢复到安全范围内
        const reasonableBid = prevBid * (1 - SAFETY_LIMITS.BID.MAX_DECREASE_PERCENT / 100);
        const correctionBid = Math.max(REVALIDATION_CONFIG.absoluteMinBid, reasonableBid);
        return {
          isUnreasonable: true,
          reason: `降价幅度${(decreasePercent * 100).toFixed(1)}%超过30%安全阈值(${prevBid.toFixed(2)}→${executedBid.toFixed(2)})`,
          correctionBid,
        };
      }
    }
    
    // 规则2: 提价幅度超过50%
    if (['bid_increase', 'bid_set', 'bid_auto_adjust'].includes(actionType) && executedBid > prevBid) {
      const increasePercent = (executedBid - prevBid) / prevBid;
      if (increasePercent > 0.50) {
        const reasonableBid = prevBid * (1 + SAFETY_LIMITS.BID.MAX_INCREASE_PERCENT / 100);
        const correctionBid = Math.min(REVALIDATION_CONFIG.absoluteMaxBid, reasonableBid);
        return {
          isUnreasonable: true,
          reason: `提价幅度${(increasePercent * 100).toFixed(1)}%超过50%安全阈值(${prevBid.toFixed(2)}→${executedBid.toFixed(2)})`,
          correctionBid,
        };
      }
    }
    
    // 规则3: 出价降至极低值（可能导致零曝光）
    if (executedBid < REVALIDATION_CONFIG.absoluteMinBid && prevBid >= 0.10) {
      return {
        isUnreasonable: true,
        reason: `出价降至$${executedBid.toFixed(2)}，低于最低限$${REVALIDATION_CONFIG.absoluteMinBid}，可能导致零曝光`,
        correctionBid: Math.max(REVALIDATION_CONFIG.absoluteMinBid, prevBid * 0.5),
      };
    }
    
    // 规则4: 出价超过绝对上限
    if (executedBid > REVALIDATION_CONFIG.absoluteMaxBid * 1.5) {
      return {
        isUnreasonable: true,
        reason: `出价$${executedBid.toFixed(2)}超过安全上限$${(REVALIDATION_CONFIG.absoluteMaxBid * 1.5).toFixed(2)}`,
        correctionBid: Math.min(REVALIDATION_CONFIG.absoluteMaxBid, prevBid * 1.1),
      };
    }
    
    return { isUnreasonable: false, reason: '出价调整在合理范围内' };
  }
  
  // ===== 预算指令审计 =====
  if (['budget_increase', 'budget_decrease', 'budget_set'].includes(actionType)) {
    const executedBudget = parseFloat(String(row.new_value || 0));
    const prevBudget = parseFloat(String(row.previous_value || 0));
    
    if (prevBudget <= 0 || executedBudget <= 0) {
      return { isUnreasonable: false, reason: '数据不完整，跳过审计' };
    }
    
    // 规则1: 预算降幅超过40%
    if (executedBudget < prevBudget) {
      const decreasePercent = (prevBudget - executedBudget) / prevBudget;
      if (decreasePercent > 0.40) {
        const reasonableBudget = prevBudget * (1 - SAFETY_LIMITS.BUDGET.MAX_DECREASE_PERCENT / 100);
        return {
          isUnreasonable: true,
          reason: `预算降幅${(decreasePercent * 100).toFixed(1)}%超过40%安全阈值`,
          correctionBudget: reasonableBudget,
        };
      }
    }
    
    // 规则2: 预算涨幅超过100%
    if (executedBudget > prevBudget) {
      const increasePercent = (executedBudget - prevBudget) / prevBudget;
      if (increasePercent > 1.0) {
        const reasonableBudget = prevBudget * (1 + SAFETY_LIMITS.BUDGET.MAX_INCREASE_PERCENT / 100);
        return {
          isUnreasonable: true,
          reason: `预算涨幅${(increasePercent * 100).toFixed(1)}%超过100%安全阈值`,
          correctionBudget: reasonableBudget,
        };
      }
    }
    
    return { isUnreasonable: false, reason: '预算调整在合理范围内' };
  }
  
  return { isUnreasonable: false, reason: '非出价/预算指令，跳过审计' };
}

/**
 * 生成纠正指令
 * 将纠正指令写入optimization_events表，由正常的同步引擎推送到亚马逊
 */
async function generateCorrectionCommand(
  database: any,
  originalRow: Record<string, any>,
  audit: { reason: string; correctionBid?: number; correctionBudget?: number },
  targetId: number,
  targetName: string,
  accountId: number
): Promise<void> {
  const isBidCorrection = audit.correctionBid !== undefined;
  const correctionValue = isBidCorrection ? audit.correctionBid! : audit.correctionBudget!;
  const currentValue = isBidCorrection 
    ? parseFloat(String(originalRow.current_bid || originalRow.new_bid || 0))
    : parseFloat(String(originalRow.campaign_budget || originalRow.new_value || 0));
  
  // 确定纠正方向
  const isIncrease = correctionValue > currentValue;
  let correctionActionType: string;
  let correctionCategory: string;
  
  if (isBidCorrection) {
    correctionActionType = isIncrease ? 'bid_increase' : 'bid_decrease';
    correctionCategory = 'bid_adjustment';
  } else {
    correctionActionType = isIncrease ? 'budget_increase' : 'budget_decrease';
    correctionCategory = 'budget_adjustment';
  }
  
  // 插入纠正指令到optimization_events
  await database.execute(
    sql`INSERT INTO optimization_events 
        (performance_group_id, performance_group_name, account_id, account_name,
         event_category, action_type, 
         keyword_id, keyword_text, campaign_id, campaign_name, ad_group_id,
         previous_bid, new_bid, previous_value, new_value,
         change_reason, algorithm_version, status, api_sync_status,
         action_detail)
        VALUES (
          ${targetId}, ${targetName}, ${accountId}, ${originalRow.account_name || null},
          ${correctionCategory}, ${correctionActionType},
          ${isBidCorrection ? originalRow.keyword_id : null}, 
          ${isBidCorrection ? originalRow.keyword_text : null},
          ${originalRow.campaign_id || null}, ${originalRow.campaign_name || null},
          ${originalRow.ad_group_id || null},
          ${isBidCorrection ? String(currentValue) : null},
          ${isBidCorrection ? String(correctionValue) : null},
          ${!isBidCorrection ? String(currentValue) : null},
          ${!isBidCorrection ? String(correctionValue) : null},
          ${`v${SYSTEM_VERSION}自动纠错: ${audit.reason}`},
          ${`v${SYSTEM_VERSION}`}, 'success', 'pending',
          ${JSON.stringify({
            type: 'auto_correction',
            sourceEventId: originalRow.id,
            originalAction: originalRow.action_type,
            originalValue: originalRow.new_bid || originalRow.new_value,
            correctionValue,
            auditReason: audit.reason,
            generatedBy: `v${SYSTEM_VERSION}-revalidator`,
            generatedAt: new Date().toISOString(),
          })}
        )`
  );
  
  log.info(`[CmdRevalidator] [${targetName}] 生成纠正指令: ${correctionActionType} ${isBidCorrection ? 'bid' : 'budget'} $${currentValue.toFixed(2)}→$${correctionValue.toFixed(2)} (原因: ${audit.reason})`);
}

// ==================== 入口函数 ====================

/**
 * 对所有活跃优化目标执行完整的指令重评估与纠错
 */
export async function runFullRevalidation(): Promise<FullRevalidationResult> {
  const triggeredAt = new Date();
  const errors: string[] = [];
  const targetResults: RevalidationResult[] = [];
  
  log.info(`[CmdRevalidator] v${SYSTEM_VERSION}: 开始全量指令重评估与纠错...`);
  
  // 记录系统审计日志
  auditSystemAction('system.deploy', {
    description: `v${SYSTEM_VERSION} 部署后指令重评估与纠错启动`,
    metadata: { version: SYSTEM_VERSION, triggeredAt: triggeredAt.toISOString() },
  });
  
  try {
    // 获取所有活跃优化目标
    const { getEnabledOptimizationTargets } = await import('./optimizationTargetEngine');
    const targets = await getEnabledOptimizationTargets();
    
    if (targets.length === 0) {
      log.info(`[CmdRevalidator] 没有活跃的优化目标，跳过重评估`);
      return {
        version: SYSTEM_VERSION,
        triggeredAt,
        completedAt: new Date(),
        targetsProcessed: 0,
        totalPendingRevalidated: 0,
        totalPendingCancelled: 0,
        totalPendingRetriggered: 0,
        totalHistoricalAudited: 0,
        totalCorrectionsGenerated: 0,
        targetResults: [],
        errors: [],
      };
    }
    
    log.info(`[CmdRevalidator] 对 ${targets.length} 个活跃优化目标执行重评估...`);
    
    // 分批处理
    for (let i = 0; i < targets.length; i++) {
      const target = targets[i] as any;
      const startTime = Date.now();
      
      try {
        // 1. 积压指令重新评估
        const pendingResult = await revalidatePendingCommands(
          target.id, target.name, target.accountId
        );
        
        // 2. 历史指令自动纠错
        const auditResult = await auditAndCorrectHistoricalCommands(
          target.id, target.name, target.accountId
        );
        
        const targetResult: RevalidationResult = {
          targetId: target.id,
          targetName: target.name,
          accountId: target.accountId,
          pendingRevalidation: pendingResult,
          historicalAudit: auditResult,
          errors: [],
          duration: Date.now() - startTime,
        };
        
        targetResults.push(targetResult);
        
        log.info(`[CmdRevalidator] [${target.name}] 完成 (${targetResult.duration}ms): ` +
          `pending=${pendingResult.total}(保留${pendingResult.kept},取消${pendingResult.cancelled}), ` +
          `历史=${auditResult.total}(合理${auditResult.reasonable},纠正${auditResult.correctionGenerated})`);
        
      } catch (targetErr: unknown) {
        const errMsg = `目标${target.name}(${target.id})处理失败: ${(targetErr as Error).message}`;
        errors.push(errMsg);
        log.error(`[CmdRevalidator] ${errMsg}`);
        
        targetResults.push({
          targetId: target.id,
          targetName: target.name,
          accountId: target.accountId,
          pendingRevalidation: { total: 0, kept: 0, cancelled: 0, retriggered: 0, errors: 1 },
          historicalAudit: { total: 0, reasonable: 0, unreasonable: 0, correctionGenerated: 0, errors: 1 },
          errors: [errMsg],
          duration: Date.now() - startTime,
        });
      }
      
      // 批次间等待
      if (i < targets.length - 1 && (i + 1) % REVALIDATION_CONFIG.batchSize === 0) {
        await new Promise(resolve => setTimeout(resolve, REVALIDATION_CONFIG.batchDelayMs));
      }
    }
    
  } catch (err: unknown) {
    errors.push(`全量重评估失败: ${(err as Error).message}`);
    log.error(`[CmdRevalidator] 全量重评估失败: ${(err as Error).message}`);
  }
  
  // 汇总结果
  const fullResult: FullRevalidationResult = {
    version: SYSTEM_VERSION,
    triggeredAt,
    completedAt: new Date(),
    targetsProcessed: targetResults.length,
    totalPendingRevalidated: targetResults.reduce((sum, r) => sum + r.pendingRevalidation.total, 0),
    totalPendingCancelled: targetResults.reduce((sum, r) => sum + r.pendingRevalidation.cancelled, 0),
    totalPendingRetriggered: targetResults.reduce((sum, r) => sum + r.pendingRevalidation.retriggered, 0),
    totalHistoricalAudited: targetResults.reduce((sum, r) => sum + r.historicalAudit.total, 0),
    totalCorrectionsGenerated: targetResults.reduce((sum, r) => sum + r.historicalAudit.correctionGenerated, 0),
    targetResults,
    errors,
  };
  
  // 记录完成审计日志
  auditSystemAction('system.deploy', {
    description: `v${SYSTEM_VERSION} 部署后指令重评估与纠错完成`,
    metadata: {
      version: SYSTEM_VERSION,
      duration: fullResult.completedAt.getTime() - triggeredAt.getTime(),
      targetsProcessed: fullResult.targetsProcessed,
      pendingRevalidated: fullResult.totalPendingRevalidated,
      pendingCancelled: fullResult.totalPendingCancelled,
      pendingRetriggered: fullResult.totalPendingRetriggered,
      historicalAudited: fullResult.totalHistoricalAudited,
      correctionsGenerated: fullResult.totalCorrectionsGenerated,
    },
  });
  
  // 记录到optimization_events
  try {
    const database = await getDb();
    if (database) {
      await database.execute(
        sql`INSERT INTO optimization_events 
            (account_id, event_category, action_type, action_detail, change_reason, 
             algorithm_version, status, api_sync_status)
            VALUES (0, 'settings_change', 'auto_correction',
                    ${JSON.stringify({
                      type: 'post_deploy_revalidation',
                      version: SYSTEM_VERSION,
                      targetsProcessed: fullResult.targetsProcessed,
                      pendingRevalidated: fullResult.totalPendingRevalidated,
                      pendingCancelled: fullResult.totalPendingCancelled,
                      pendingRetriggered: fullResult.totalPendingRetriggered,
                      historicalAudited: fullResult.totalHistoricalAudited,
                      correctionsGenerated: fullResult.totalCorrectionsGenerated,
                      duration: fullResult.completedAt.getTime() - triggeredAt.getTime(),
                    })},
                    ${`v${SYSTEM_VERSION} 部署后重评估: ${fullResult.targetsProcessed}目标, pending=${fullResult.totalPendingRevalidated}(取消${fullResult.totalPendingCancelled},重触发${fullResult.totalPendingRetriggered}), 历史纠正=${fullResult.totalCorrectionsGenerated}`},
                    ${`v${SYSTEM_VERSION}`}, 'success', 'not_applicable')`
      );
    }
  } catch (logErr: unknown) {
    log.warn(`[CmdRevalidator] 记录重评估结果失败: ${(logErr as Error).message}`);
  }
  
  log.info(`[CmdRevalidator] ========================================`);
  log.info(`[CmdRevalidator] v${SYSTEM_VERSION} 全量指令重评估与纠错完成!`);
  log.info(`[CmdRevalidator] 目标: ${fullResult.targetsProcessed}个`);
  log.info(`[CmdRevalidator] Pending: ${fullResult.totalPendingRevalidated}条评估, ${fullResult.totalPendingCancelled}条取消, ${fullResult.totalPendingRetriggered}条重触发`);
  log.info(`[CmdRevalidator] 历史: ${fullResult.totalHistoricalAudited}条审计, ${fullResult.totalCorrectionsGenerated}条纠正`);
  log.info(`[CmdRevalidator] 耗时: ${((fullResult.completedAt.getTime() - triggeredAt.getTime()) / 1000).toFixed(1)}秒`);
  log.info(`[CmdRevalidator] ========================================`);
  
  return fullResult;
}

/**
 * 对指定优化目标执行指令重评估（可通过API手动触发）
 */
export async function revalidateTarget(targetId: number): Promise<RevalidationResult> {
  const startTime = Date.now();
  
  try {
    const { getOptimizationTargetConfig } = await import('./optimizationTargetEngine');
    const config = await getOptimizationTargetConfig(targetId);
    
    if (!config) {
      return {
        targetId,
        targetName: 'unknown',
        accountId: 0,
        pendingRevalidation: { total: 0, kept: 0, cancelled: 0, retriggered: 0, errors: 0 },
        historicalAudit: { total: 0, reasonable: 0, unreasonable: 0, correctionGenerated: 0, errors: 0 },
        errors: ['优化目标不存在或已禁用'],
        duration: Date.now() - startTime,
      };
    }
    
    const pendingResult = await revalidatePendingCommands(targetId, config.name, config.accountId);
    const auditResult = await auditAndCorrectHistoricalCommands(targetId, config.name, config.accountId);
    
    return {
      targetId,
      targetName: config.name,
      accountId: config.accountId,
      pendingRevalidation: pendingResult,
      historicalAudit: auditResult,
      errors: [],
      duration: Date.now() - startTime,
    };
  } catch (err: unknown) {
    return {
      targetId,
      targetName: 'unknown',
      accountId: 0,
      pendingRevalidation: { total: 0, kept: 0, cancelled: 0, retriggered: 0, errors: 1 },
      historicalAudit: { total: 0, reasonable: 0, unreasonable: 0, correctionGenerated: 0, errors: 1 },
      errors: [(err as Error).message],
      duration: Date.now() - startTime,
    };
  }
}
