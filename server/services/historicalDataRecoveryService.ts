/**
 * 历史数据主动回溯与"矿渣提炼"服务 (Historical Data Recovery Service)
 * 
 * v510: 核心升级 — 主动挖掘被过度优化压制的历史优质投放词
 * 
 * 核心理念（来自"矿渣提炼"原则）：
 * 很多投放词在历史上曾经稳定出单，但因为前期过度降价优化导致出价远低于
 * 历史CPC，最终失去竞争力不再出单。这些词不是"废词"，而是被压制的"矿渣"。
 * 通过将出价恢复到历史出单期CPC水平，可以重新激活这些词的出单能力。
 * 
 * 与断崖修复引擎的区别：
 * - 断崖修复：检测"正在发生"的断崖（近期流量骤降），紧急修复
 * - 矿渣提炼：检测"已经沉寂"的历史优质词（长期无出单），渐进恢复
 * 
 * 筛选条件：
 * 1. 历史订单 >= 10（证明该词有出单能力）
 * 2. 最近30天零订单或极低订单（已沉寂）
 * 3. 当前出价 < 历史出单期CPC × 0.70（出价被压制）
 * 4. 关键词/Target状态为enabled（未被手动暂停）
 * 
 * 恢复策略：
 * - 每次恢复不超过当前出价的20%
 * - 恢复目标：历史出单期CPC × 0.85
 * - 每周最多恢复一批，避免预算冲击
 */

import { getDb } from '../db';
import { sql } from 'drizzle-orm';
import { createModuleLogger } from '../utils/logger';
import { logOptimization, logOptimizationWarn } from '../utils/opsLogger';
import { recordAudit } from './auditLogService';

const log = createModuleLogger('HistoricalRecovery');

// ==================== 配置常量 ====================

export const RECOVERY_CONFIG = {
  /** 历史订单门槛：超过此值的词视为"有出单能力" */
  historicalOrderThreshold: 10,
  
  /** 沉寂判定：最近N天零订单或极低订单 */
  dormantDays: 30,
  /** 极低订单阈值：最近dormantDays天内订单低于此值视为沉寂 */
  dormantOrderThreshold: 1,
  
  /** 出价压制判定：当前出价低于历史CPC的此比例 */
  bidSuppressionRatio: 0.70,
  
  /** 恢复目标：历史CPC的此比例 */
  recoveryTargetRatio: 0.85,
  
  /** 单次最大提价幅度（%） */
  maxSingleIncreasePercent: 20,
  
  /** 每批最多恢复的投放词数量（防止预算冲击） */
  maxRecoveryBatchSize: 20,
  
  /** 恢复间隔：两次恢复之间至少间隔N天 */
  recoveryIntervalDays: 7,
};

// ==================== 类型定义 ====================

export interface RecoveryCandidate {
  entityType: 'keyword' | 'product_target';
  entityId: number;
  entityName: string;
  accountId: number;
  campaignId: string;
  campaignName: string;
  adType: string;
  currentBid: number;
  historicalCpc: number;
  historicalOrders: number;
  recentOrders: number;
  bidGapPercent: number;
  proposedBid: number;
  priority: number; // 基于历史订单量和出价差距的优先级
}

export interface RecoveryScanResult {
  accountId: number;
  scanTime: Date;
  duration: number;
  totalScanned: number;
  candidatesFound: number;
  recovered: number;
  candidates: RecoveryCandidate[];
}

// ==================== 核心功能 ====================

/**
 * 主入口：扫描并恢复被压制的历史优质投放词
 * 
 * 每周运行一次，独立于常规优化和断崖修复
 */
export async function scanAndRecoverDormantTargets(accountId: number): Promise<RecoveryScanResult> {
  const startTime = Date.now();
  const allCandidates: RecoveryCandidate[] = [];
  let totalScanned = 0;
  
  log.info(`[HistoricalRecovery] ========== 开始矿渣提炼扫描 (accountId=${accountId}) ==========`);
  
  try {
    // 1. 扫描沉寂的关键词
    const kwResult = await scanDormantKeywords(accountId);
    allCandidates.push(...kwResult.candidates);
    totalScanned += kwResult.scanned;
    
    // 2. 扫描沉寂的Product Targets
    const ptResult = await scanDormantProductTargets(accountId);
    allCandidates.push(...ptResult.candidates);
    totalScanned += ptResult.scanned;
    
    // 3. 按优先级排序（历史订单多 + 出价差距大 = 高优先级）
    allCandidates.sort((a, b) => b.priority - a.priority);
    
    // 4. 限制批量大小，防止预算冲击
    const batch = allCandidates.slice(0, RECOVERY_CONFIG.maxRecoveryBatchSize);
    
    log.info(`[HistoricalRecovery] 扫描完成: 共${totalScanned}个投放词, 发现${allCandidates.length}个候选, 本批恢复${batch.length}个`);
    
    // 5. 执行恢复
    let recovered = 0;
    for (const candidate of batch) {
      try {
        const success = await executeRecovery(candidate);
        if (success) recovered++;
      } catch (err: unknown) {
        log.warn(`[HistoricalRecovery] 恢复失败(${candidate.entityType}=${candidate.entityId}): ${(err as Error).message}`);
      }
    }
    
    const duration = Date.now() - startTime;
    
    log.info(`[HistoricalRecovery] ========== 矿渣提炼完成 (${duration}ms) ==========`);
    log.info(`[HistoricalRecovery] 汇总: 扫描${totalScanned}个, 候选${allCandidates.length}个, 恢复${recovered}个`);
    
    if (recovered > 0) {
      // @ts-ignore
      logOptimization(`[HistoricalRecovery] 账户${accountId}: 恢复${recovered}个沉寂投放词出价`);
    }
    
    return {
      accountId,
      scanTime: new Date(),
      duration,
      totalScanned,
      candidatesFound: allCandidates.length,
      recovered,
      candidates: batch,
    };
    
  } catch (error: unknown) {
    log.error(`[HistoricalRecovery] 扫描异常: ${(error as Error).message}`);
    return {
      accountId,
      scanTime: new Date(),
      duration: Date.now() - startTime,
      totalScanned,
      candidatesFound: 0,
      recovered: 0,
      candidates: [],
    };
  }
}

/**
 * 扫描沉寂的关键词
 */
async function scanDormantKeywords(accountId: number): Promise<{ scanned: number; candidates: RecoveryCandidate[] }> {
  const candidates: RecoveryCandidate[] = [];
  
  try {
    const db = await getDb();
    if (!db) return { scanned: 0, candidates };
    
    const config = RECOVERY_CONFIG;
    
    // 查询历史出单优质但近期沉寂的关键词
    // 条件：历史订单>=10, enabled, 有出价, 当前出价<历史CPC×0.70
    const result = await db.execute(sql`
      SELECT 
        k.id, k.keyword_id as keywordId, k.keyword_text as keywordText, k.match_type as matchType,
        k.bid as currentBid, k.keyword_cpc as historicalCpc,
        k.orders as totalOrders, k.clicks as totalClicks,
        k.campaign_id as campaignId,
        c.campaign_name as campaignName,
        c.campaign_type as campaignType,
        COALESCE((
          SELECT SUM(dp.orders) 
          FROM daily_performance dp 
          WHERE dp.keyword_id = k.id 
            AND dp.account_id = k.account_id
            AND dp.report_date >= DATE_SUB(CURDATE(), INTERVAL ${config.dormantDays} DAY)
        ), 0) as recent_orders
      FROM keywords k
      JOIN campaigns c ON k.campaign_id = c.campaign_id AND k.account_id = c.account_id
      WHERE k.account_id = ${accountId}
        AND k.keyword_status = 'enabled'
        AND k.bid IS NOT NULL
        AND k.orders >= ${config.historicalOrderThreshold}
        AND k.keyword_cpc > 0
        AND CAST(k.bid AS DECIMAL(10,2)) < k.keyword_cpc * ${config.bidSuppressionRatio}
    `);
    
    const rows = Array.isArray(result) ? (Array.isArray(result[0]) ? result[0] : result) : [];
    const kwRows = rows as Array<Record<string, unknown>>;
    
    log.info(`[HistoricalRecovery] 关键词扫描: ${kwRows.length}个候选(历史订单>=${config.historicalOrderThreshold}, 出价被压制)`);
    
    for (const kw of kwRows) {
      const recentOrders = Number(kw.recent_orders) || 0;
      
      // 近期仍在出单的词不需要恢复
      if (recentOrders > config.dormantOrderThreshold) continue;
      
      // 检查是否已在恢复间隔内
      const lastRecovery = await getLastRecoveryTime(db, accountId, 'keyword', Number(kw.id));
      if (lastRecovery && (Date.now() - lastRecovery.getTime()) < config.recoveryIntervalDays * 86400000) continue;
      
      const currentBid = Number(kw.currentBid) || 0;
      const historicalCpc = Number(kw.historicalCpc) || 0;
      const totalOrders = Number(kw.totalOrders) || 0;
      const bidGapPercent = ((historicalCpc - currentBid) / historicalCpc) * 100;
      
      // 计算恢复出价
      const targetBid = historicalCpc * config.recoveryTargetRatio;
      const maxIncrease = currentBid * (config.maxSingleIncreasePercent / 100);
      const proposedBid = Math.round(Math.min(targetBid, currentBid + maxIncrease) * 100) / 100;
      
      if (proposedBid <= currentBid + 0.01) continue;
      
      // 优先级 = 历史订单量 × 出价差距比例
      const priority = totalOrders * (bidGapPercent / 100);
      
      candidates.push({
        entityType: 'keyword',
        entityId: Number(kw.id),
        entityName: `${kw.keywordText} (${kw.matchType})`,
        accountId,
        campaignId: String(kw.campaignId || ''),
        campaignName: String(kw.campaignName || ''),
        adType: String(kw.campaignType || 'sp'),
        currentBid,
        historicalCpc,
        historicalOrders: totalOrders,
        recentOrders,
        bidGapPercent,
        proposedBid,
        priority,
      });
    }
    
    return { scanned: kwRows.length, candidates };
    
  } catch (error: unknown) {
    log.error(`[HistoricalRecovery] 关键词扫描失败: ${(error as Error).message}`);
    return { scanned: 0, candidates };
  }
}

/**
 * 扫描沉寂的Product Targets
 */
async function scanDormantProductTargets(accountId: number): Promise<{ scanned: number; candidates: RecoveryCandidate[] }> {
  const candidates: RecoveryCandidate[] = [];
  
  try {
    const db = await getDb();
    if (!db) return { scanned: 0, candidates };
    
    const config = RECOVERY_CONFIG;
    
    const result = await db.execute(sql`
      SELECT 
        pt.id, pt.target_id as targetId, pt.expression_value as expressionValue,
        pt.bid as currentBid, pt.target_cpc as historicalCpc,
        pt.orders as totalOrders, pt.clicks as totalClicks,
        pt.campaign_id as campaignId,
        c.campaign_name as campaignName,
        c.campaign_type as campaignType,
        COALESCE((
          SELECT SUM(dp.orders) 
          FROM daily_performance dp 
          WHERE dp.target_id = pt.id 
            AND dp.account_id = pt.account_id
            AND dp.report_date >= DATE_SUB(CURDATE(), INTERVAL ${config.dormantDays} DAY)
        ), 0) as recent_orders
      FROM product_targets pt
      JOIN campaigns c ON pt.campaign_id = c.campaign_id AND pt.account_id = c.account_id
      WHERE pt.account_id = ${accountId}
        AND pt.target_status = 'enabled'
        AND pt.bid IS NOT NULL
        AND pt.orders >= ${config.historicalOrderThreshold}
        AND pt.target_cpc > 0
        AND CAST(pt.bid AS DECIMAL(10,2)) < pt.target_cpc * ${config.bidSuppressionRatio}
    `);
    
    const rows = Array.isArray(result) ? (Array.isArray(result[0]) ? result[0] : result) : [];
    const ptRows = rows as Array<Record<string, unknown>>;
    
    log.info(`[HistoricalRecovery] Product Target扫描: ${ptRows.length}个候选`);
    
    for (const pt of ptRows) {
      const recentOrders = Number(pt.recent_orders) || 0;
      if (recentOrders > config.dormantOrderThreshold) continue;
      
      const lastRecovery = await getLastRecoveryTime(db, accountId, 'product_target', Number(pt.id));
      if (lastRecovery && (Date.now() - lastRecovery.getTime()) < config.recoveryIntervalDays * 86400000) continue;
      
      const currentBid = Number(pt.currentBid) || 0;
      const historicalCpc = Number(pt.historicalCpc) || 0;
      const totalOrders = Number(pt.totalOrders) || 0;
      const bidGapPercent = ((historicalCpc - currentBid) / historicalCpc) * 100;
      
      const targetBid = historicalCpc * config.recoveryTargetRatio;
      const maxIncrease = currentBid * (config.maxSingleIncreasePercent / 100);
      const proposedBid = Math.round(Math.min(targetBid, currentBid + maxIncrease) * 100) / 100;
      
      if (proposedBid <= currentBid + 0.01) continue;
      
      const priority = totalOrders * (bidGapPercent / 100);
      
      candidates.push({
        entityType: 'product_target',
        entityId: Number(pt.id),
        entityName: String(pt.expressionValue || ''),
        accountId,
        campaignId: String(pt.campaignId || ''),
        campaignName: String(pt.campaignName || ''),
        adType: String(pt.campaignType || 'sp'),
        currentBid,
        historicalCpc,
        historicalOrders: totalOrders,
        recentOrders,
        bidGapPercent,
        proposedBid,
        priority,
      });
    }
    
    return { scanned: ptRows.length, candidates };
    
  } catch (error: unknown) {
    log.error(`[HistoricalRecovery] Product Target扫描失败: ${(error as Error).message}`);
    return { scanned: 0, candidates };
  }
}

/**
 * 获取上次恢复时间
 */
async function getLastRecoveryTime(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  accountId: number,
  entityType: 'keyword' | 'product_target',
  entityId: number
): Promise<Date | null> {
  try {
    const entityColumn = entityType === 'keyword' ? 'keyword_id' : 'target_id';
    
    const result = await db.execute(sql`
      SELECT MAX(created_at) as last_recovery
      FROM optimization_events
      WHERE account_id = ${accountId}
        AND ${sql.raw(entityColumn)} = ${entityId}
        AND event_category = 'historical_recovery'
    `);
    
    const rows = Array.isArray(result) ? (Array.isArray(result[0]) ? result[0] : result) : [];
    const row = (rows as Array<Record<string, unknown>>)[0];
    
    if (row?.last_recovery) {
      return new Date(String(row.last_recovery));
    }
    return null;
    
  } catch {
    return null;
  }
}

/**
 * 执行单个恢复操作
 */
async function executeRecovery(candidate: RecoveryCandidate): Promise<boolean> {
  try {
    const db = await getDb();
    if (!db) return false;
    
    const tableName = candidate.entityType === 'keyword' ? 'keywords' : 'product_targets';
    
    // 1. 更新本地数据库
    await db.execute(sql`
      UPDATE ${sql.raw(tableName)}
      SET bid = ${String(candidate.proposedBid)}
      WHERE id = ${candidate.entityId} AND account_id = ${candidate.accountId}
    `);
    
    // 2. 记录optimization_events
    await db.execute(sql`
      INSERT INTO optimization_events (
        account_id, event_category, event_type, status,
        ${sql.raw(candidate.entityType === 'keyword' ? 'keyword_id' : 'target_id')},
        previous_bid, new_bid,
        action_detail, api_sync_status, created_at
      ) VALUES (
        ${candidate.accountId}, 'historical_recovery', ${candidate.entityType + '_bid_restore'}, 'success',
        ${candidate.entityId},
        ${String(candidate.currentBid)}, ${String(candidate.proposedBid)},
        ${JSON.stringify({
          historicalCpc: candidate.historicalCpc,
          historicalOrders: candidate.historicalOrders,
          recentOrders: candidate.recentOrders,
          bidGapPercent: candidate.bidGapPercent,
          priority: candidate.priority,
          campaignName: candidate.campaignName,
        })},
        'pending',
        NOW()
      )
    `);
    
    // 3. 记录审计日志
    // @ts-ignore
    recordAudit({
      // @ts-ignore
      action: `${candidate.entityType}.historical_recovery`,
      accountId: candidate.accountId,
      entityType: candidate.entityType,
      // @ts-ignore
      entityId: candidate.entityId,
      // @ts-ignore
      entityName: candidate.entityName,
      // @ts-ignore
      previousValue: candidate.currentBid,
      // @ts-ignore
      newValue: candidate.proposedBid,
      reason: `[v510矿渣提炼] 历史${candidate.historicalOrders}单, 近30天${candidate.recentOrders}单, 出价差距${candidate.bidGapPercent.toFixed(0)}% | $${candidate.currentBid.toFixed(2)}→$${candidate.proposedBid.toFixed(2)} (目标:历史CPC×85%=$${(candidate.historicalCpc * 0.85).toFixed(2)})`,
    });
    
    // 4. 同步到Amazon API
    try {
      const { syncBidAdjustmentsToAmazon } = await import('./amazonApiHelper');
      // @ts-ignore
      await syncBidAdjustmentsToAmazon(candidate.accountId, [{
        keywordId: candidate.entityType === 'keyword' ? candidate.entityId : undefined,
        targetId: candidate.entityType === 'product_target' ? candidate.entityId : undefined,
        newBid: candidate.proposedBid,
        reason: `[HistoricalRecovery] $${candidate.currentBid}→$${candidate.proposedBid}`,
      } as Record<string, unknown>]);
    } catch (syncErr: unknown) {
      log.warn(`[HistoricalRecovery] API同步失败(${candidate.entityType}=${candidate.entityId}): ${(syncErr as Error).message}`);
    }
    
    log.info(`[HistoricalRecovery] 恢复成功: ${candidate.entityType}="${candidate.entityName}" $${candidate.currentBid.toFixed(2)}→$${candidate.proposedBid.toFixed(2)} (历史${candidate.historicalOrders}单, CPC=$${candidate.historicalCpc.toFixed(2)})`);
    
    return true;
    
  } catch (error: unknown) {
    log.error(`[HistoricalRecovery] 恢复执行失败(${candidate.entityType}=${candidate.entityId}): ${(error as Error).message}`);
    return false;
  }
}
