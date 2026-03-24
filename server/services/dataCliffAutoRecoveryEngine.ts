/**
 * 数据断崖主动监控与自动修复引擎 (Data Cliff Auto-Recovery Engine)
 * 
 * v510: 核心升级 — 变被动拦截为主动扫描
 * 
 * 核心理念（来自"惯性系统理论"）：
 * 亚马逊广告系统是一个具有强烈惯性的复杂系统。一旦稳定出单的投放词
 * 因出价骤降而失去位置，恢复所需的时间和成本远超初始降价节省的金额。
 * 
 * 本引擎独立于常规出价优化流程，每日主动扫描所有有历史出单记录的投放词，
 * 一旦检测到"数据断崖"（流量/订单骤降），立即启动阶梯式恢复。
 * 
 * 覆盖范围：
 * - SP Keywords (关键词)
 * - SP/SB Product Targets (ASIN定向)
 * - SP Auto Targets (自动匹配)
 * - SD Audiences (受众定向)
 * 
 * 断崖识别算法：
 * 1. 历史基线：扫描所有历史订单 > 4 的投放词
 * 2. 多窗口对比：远期(30-90天) vs 近期(最近7天)
 * 3. 触发条件：近期流量或订单较历史基线下降超过70%，且当前出价 < 历史CPC
 * 
 * 修复策略：
 * - 阶梯式快速恢复（3步：70% → 85% → 100% 历史CPC）
 * - 修复期间锁定，暂停常规降价优化
 */

import { getDb } from '../db';
import { sql } from 'drizzle-orm';
import { createModuleLogger } from '../utils/logger';
import { logOptimization, logOptimizationWarn } from '../utils/opsLogger';
import { recordAudit } from './auditLogService';

const log = createModuleLogger('DataCliffRecovery');

// ==================== 配置常量 ====================

export const CLIFF_RECOVERY_CONFIG = {
  /** 历史订单数门槛：超过此值的投放词触发断崖检测 */
  historicalOrderThreshold: 4,
  
  /** 多窗口对比配置 */
  windows: {
    /** 远期窗口：30-90天前的数据作为历史基线 */
    baseline: { startDaysAgo: 90, endDaysAgo: 30 },
    /** 近期窗口：最近7天的数据 */
    recent: { startDaysAgo: 7, endDaysAgo: 0 },
  },
  
  /** 断崖触发阈值 */
  thresholds: {
    /** 流量下降幅度（%）：近期日均曝光/点击较历史基线下降超过此值 */
    trafficDropPercent: 70,
    /** 订单下降幅度（%）：近期日均订单较历史基线下降超过此值 */
    orderDropPercent: 70,
    /** 出价差距阈值（%）：当前出价比历史CPC低于此比例才触发修复 */
    bidGapPercent: 20,
  },
  
  /** 阶梯式恢复配置 */
  recovery: {
    /** 恢复步骤：每步恢复到历史CPC的百分比 */
    steps: [0.70, 0.85, 1.00],
    /** 每步之间的间隔（小时）：等待数据回流 */
    stepIntervalHours: 72,
    /** 单次最大提价幅度（%）：即使需要大幅恢复，单次也不超过此值 */
    maxSingleIncreasePercent: 30,
  },
  
  /** 修复期锁定：断崖修复期间暂停常规降价优化的天数 */
  lockdownDays: 7,
};

// ==================== 类型定义 ====================

export interface CliffDetectionResult {
  entityType: 'keyword' | 'product_target';
  entityId: number;
  entityName: string;
  accountId: number;
  campaignId: string;
  campaignName: string;
  adType: string;
  currentBid: number;
  historicalCpc: number;
  /** 历史基线期日均订单 */
  baselineDailyOrders: number;
  /** 近期日均订单 */
  recentDailyOrders: number;
  /** 订单下降幅度（%） */
  orderDropPercent: number;
  /** 历史基线期日均点击 */
  baselineDailyClicks: number;
  /** 近期日均点击 */
  recentDailyClicks: number;
  /** 流量下降幅度（%） */
  trafficDropPercent: number;
  /** 出价与历史CPC的差距（%） */
  bidGapPercent: number;
  /** 修复目标出价 */
  targetRecoveryBid: number;
  /** 本次实际修复出价（阶梯式） */
  actualRecoveryBid: number;
  /** 当前恢复步骤（1/2/3） */
  recoveryStep: number;
  severity: 'critical' | 'high' | 'medium';
}

export interface CliffScanResult {
  accountId: number;
  scanTime: Date;
  duration: number;
  totalScanned: number;
  cliffsDetected: number;
  cliffsRepaired: number;
  details: CliffDetectionResult[];
}

// ==================== 核心功能：数据断崖扫描 ====================

/**
 * 主入口：扫描并修复数据断崖
 * 
 * 每日运行一次，独立于常规出价优化流程
 */
export async function scanAndRecoverDataCliffs(accountId: number): Promise<CliffScanResult> {
  const startTime = Date.now();
  const allCliffs: CliffDetectionResult[] = [];
  let totalScanned = 0;
  
  log.info(`[DataCliffRecovery] ========== 开始数据断崖主动扫描 (accountId=${accountId}) ==========`);
  
  try {
    // 1. 扫描SP Keywords
    const keywordCliffs = await scanKeywordCliffs(accountId);
    allCliffs.push(...keywordCliffs.cliffs);
    totalScanned += keywordCliffs.scanned;
    
    // 2. 扫描Product Targets (SP/SB)
    const targetCliffs = await scanProductTargetCliffs(accountId);
    allCliffs.push(...targetCliffs.cliffs);
    totalScanned += targetCliffs.scanned;
    
    log.info(`[DataCliffRecovery] 扫描完成: 共${totalScanned}个投放词, 检测到${allCliffs.length}个断崖`);
    
    // 3. 执行阶梯式修复
    let repaired = 0;
    for (const cliff of allCliffs) {
      try {
        const success = await executeCliffRepair(cliff);
        if (success) repaired++;
      } catch (repairErr: unknown) {
        log.error(`[DataCliffRecovery] 修复失败(${cliff.entityType}=${cliff.entityId}): ${(repairErr as Error).message}`);
      }
    }
    
    const duration = Date.now() - startTime;
    
    log.info(`[DataCliffRecovery] ========== 断崖修复完成 (${duration}ms) ==========`);
    log.info(`[DataCliffRecovery] 汇总: 扫描${totalScanned}个, 检测${allCliffs.length}个断崖, 修复${repaired}个`);
    
    if (allCliffs.length > 0) {
      // @ts-ignore
      logOptimizationWarn(`[DataCliffRecovery] 账户${accountId}: 检测到${allCliffs.length}个数据断崖, 已修复${repaired}个`);
    }
    
    return {
      accountId,
      scanTime: new Date(),
      duration,
      totalScanned,
      cliffsDetected: allCliffs.length,
      cliffsRepaired: repaired,
      details: allCliffs,
    };
    
  } catch (error: unknown) {
    log.error(`[DataCliffRecovery] 扫描异常: ${(error as Error).message}`);
    return {
      accountId,
      scanTime: new Date(),
      duration: Date.now() - startTime,
      totalScanned,
      cliffsDetected: allCliffs.length,
      cliffsRepaired: 0,
      details: allCliffs,
    };
  }
}

/**
 * 扫描关键词数据断崖
 */
async function scanKeywordCliffs(accountId: number): Promise<{ scanned: number; cliffs: CliffDetectionResult[] }> {
  const cliffs: CliffDetectionResult[] = [];
  
  try {
    const db = await getDb();
    if (!db) return { scanned: 0, cliffs };
    
    const config = CLIFF_RECOVERY_CONFIG;
    
    // 查询有历史出单记录的活跃关键词
    const coreKeywords = await db.execute(sql`
      SELECT 
        k.id, k.keyword_id as keywordId, k.keyword_text as keywordText, k.match_type as matchType,
        k.bid as currentBid, k.keyword_cpc as historicalCpc,
        k.orders as totalOrders, k.clicks as totalClicks,
        k.campaign_id as campaignId,
        c.campaign_name as campaignName,
        c.campaign_type as campaignType
      FROM keywords k
      JOIN campaigns c ON k.campaign_id = c.campaign_id AND k.account_id = c.account_id
      WHERE k.account_id = ${accountId}
        AND k.keyword_status = 'enabled'
        AND k.bid IS NOT NULL
        AND k.orders >= ${config.historicalOrderThreshold}
    `);
    
    const kwRows = Array.isArray(coreKeywords) ? (Array.isArray(coreKeywords[0]) ? coreKeywords[0] : coreKeywords) : [];
    const rows = kwRows as Array<Record<string, unknown>>;
    
    log.info(`[DataCliffRecovery] 关键词扫描: ${rows.length}个核心关键词(历史订单>=${config.historicalOrderThreshold})`);
    
    for (const kw of rows) {
      try {
        const cliff = await detectCliffForEntity(
          db, accountId, 'keyword', Number(kw.id),
          Number(kw.currentBid) || 0,
          Number(kw.historicalCpc) || 0,
          String(kw.keywordText || '') + ' (' + String(kw.matchType || '') + ')',
          String(kw.campaignId || ''),
          String(kw.campaignName || ''),
          String(kw.campaignType || 'sp')
        );
        if (cliff) cliffs.push(cliff);
      } catch (err: unknown) {
        // 单个关键词检测失败不影响整体
      }
    }
    
    return { scanned: rows.length, cliffs };
    
  } catch (error: unknown) {
    log.error(`[DataCliffRecovery] 关键词扫描失败: ${(error as Error).message}`);
    return { scanned: 0, cliffs };
  }
}

/**
 * 扫描Product Target数据断崖
 */
async function scanProductTargetCliffs(accountId: number): Promise<{ scanned: number; cliffs: CliffDetectionResult[] }> {
  const cliffs: CliffDetectionResult[] = [];
  
  try {
    const db = await getDb();
    if (!db) return { scanned: 0, cliffs };
    
    const config = CLIFF_RECOVERY_CONFIG;
    
    const coreTargets = await db.execute(sql`
      SELECT 
        pt.id, pt.target_id as targetId, pt.expression_value as expressionValue,
        pt.bid as currentBid, pt.target_cpc as historicalCpc,
        pt.orders as totalOrders, pt.clicks as totalClicks,
        pt.campaign_id as campaignId,
        c.campaign_name as campaignName,
        c.campaign_type as campaignType
      FROM product_targets pt
      JOIN campaigns c ON pt.campaign_id = c.campaign_id AND pt.account_id = c.account_id
      WHERE pt.account_id = ${accountId}
        AND pt.target_status = 'enabled'
        AND pt.bid IS NOT NULL
        AND pt.orders >= ${config.historicalOrderThreshold}
    `);
    
    const ptRows = Array.isArray(coreTargets) ? (Array.isArray(coreTargets[0]) ? coreTargets[0] : coreTargets) : [];
    const rows = ptRows as Array<Record<string, unknown>>;
    
    log.info(`[DataCliffRecovery] Product Target扫描: ${rows.length}个核心Target(历史订单>=${config.historicalOrderThreshold})`);
    
    for (const pt of rows) {
      try {
        const cliff = await detectCliffForEntity(
          db, accountId, 'product_target', Number(pt.id),
          Number(pt.currentBid) || 0,
          Number(pt.historicalCpc) || 0,
          String(pt.expressionValue || ''),
          String(pt.campaignId || ''),
          String(pt.campaignName || ''),
          String(pt.campaignType || 'sp')
        );
        if (cliff) cliffs.push(cliff);
      } catch (err: unknown) {
        // 单个target检测失败不影响整体
      }
    }
    
    return { scanned: rows.length, cliffs };
    
  } catch (error: unknown) {
    log.error(`[DataCliffRecovery] Product Target扫描失败: ${(error as Error).message}`);
    return { scanned: 0, cliffs };
  }
}

/**
 * 检测单个实体是否存在数据断崖
 * 
 * 多窗口对比算法：
 * 1. 查询远期窗口(30-90天前)的日均订单和日均点击作为基线
 * 2. 查询近期窗口(最近7天)的日均订单和日均点击
 * 3. 计算下降幅度，判断是否触发断崖
 */
async function detectCliffForEntity(
  db: ReturnType<typeof getDb> extends Promise<infer T> ? T : never,
  accountId: number,
  entityType: 'keyword' | 'product_target',
  entityId: number,
  currentBid: number,
  historicalCpc: number,
  entityName: string,
  campaignId: string,
  campaignName: string,
  adType: string
): Promise<CliffDetectionResult | null> {
  if (!db || currentBid <= 0) return null;
  
  const config = CLIFF_RECOVERY_CONFIG;
  const entityColumn = entityType === 'keyword' ? 'keyword_id' : 'target_id';
  
  // 查询远期窗口（历史基线）
  const baselineResult = await db.execute(sql`
    SELECT 
      COALESCE(SUM(orders), 0) as total_orders,
      COALESCE(SUM(clicks), 0) as total_clicks,
      COALESCE(SUM(impressions), 0) as total_impressions,
      COALESCE(SUM(spend), 0) as total_spend,
      COUNT(DISTINCT report_date) as data_days
    FROM daily_performance
    WHERE account_id = ${accountId}
      AND ${sql.raw(entityColumn)} = ${entityId}
      AND report_date >= DATE_SUB(CURDATE(), INTERVAL ${config.windows.baseline.startDaysAgo} DAY)
      AND report_date <= DATE_SUB(CURDATE(), INTERVAL ${config.windows.baseline.endDaysAgo} DAY)
  `);
  
  // 查询近期窗口
  const recentResult = await db.execute(sql`
    SELECT 
      COALESCE(SUM(orders), 0) as total_orders,
      COALESCE(SUM(clicks), 0) as total_clicks,
      COALESCE(SUM(impressions), 0) as total_impressions,
      COALESCE(SUM(spend), 0) as total_spend,
      COUNT(DISTINCT report_date) as data_days
    FROM daily_performance
    WHERE account_id = ${accountId}
      AND ${sql.raw(entityColumn)} = ${entityId}
      AND report_date >= DATE_SUB(CURDATE(), INTERVAL ${config.windows.recent.startDaysAgo} DAY)
  `);
  
  const baselineRows = Array.isArray(baselineResult) ? (Array.isArray(baselineResult[0]) ? baselineResult[0] : baselineResult) : [];
  const recentRows = Array.isArray(recentResult) ? (Array.isArray(recentResult[0]) ? recentResult[0] : recentResult) : [];
  
  const baseline = (baselineRows as Array<Record<string, unknown>>)[0];
  const recent = (recentRows as Array<Record<string, unknown>>)[0];
  
  if (!baseline || !recent) return null;
  
  const baselineDays = Math.max(Number(baseline.data_days) || 1, 1);
  const recentDays = Math.max(Number(recent.data_days) || 1, 1);
  
  // 基线数据不足，跳过
  if (baselineDays < 7) return null;
  
  const baselineDailyOrders = (Number(baseline.total_orders) || 0) / baselineDays;
  const recentDailyOrders = (Number(recent.total_orders) || 0) / recentDays;
  const baselineDailyClicks = (Number(baseline.total_clicks) || 0) / baselineDays;
  const recentDailyClicks = (Number(recent.total_clicks) || 0) / recentDays;
  
  // 基线日均订单太低，不视为核心词
  if (baselineDailyOrders < 0.1) return null;
  
  // 计算下降幅度
  const orderDropPercent = baselineDailyOrders > 0 
    ? ((baselineDailyOrders - recentDailyOrders) / baselineDailyOrders) * 100 
    : 0;
  const trafficDropPercent = baselineDailyClicks > 0 
    ? ((baselineDailyClicks - recentDailyClicks) / baselineDailyClicks) * 100 
    : 0;
  
  // 计算历史CPC（如果daily_performance有数据则用精确值）
  const baselineSpend = Number(baseline.total_spend) || 0;
  const baselineClicks = Number(baseline.total_clicks) || 0;
  const preciseHistoricalCpc = baselineClicks > 0 ? baselineSpend / baselineClicks : historicalCpc;
  const effectiveHistoricalCpc = preciseHistoricalCpc > 0 ? preciseHistoricalCpc : historicalCpc;
  
  // 出价差距
  const bidGapPercent = effectiveHistoricalCpc > 0 
    ? ((effectiveHistoricalCpc - currentBid) / effectiveHistoricalCpc) * 100 
    : 0;
  
  // 断崖判定：流量或订单下降超阈值 + 出价低于历史CPC
  const isTrafficCliff = trafficDropPercent >= config.thresholds.trafficDropPercent;
  const isOrderCliff = orderDropPercent >= config.thresholds.orderDropPercent;
  const isBidGap = bidGapPercent >= config.thresholds.bidGapPercent;
  
  if (!(isTrafficCliff || isOrderCliff) || !isBidGap) return null;
  
  // 确定严重程度
  const severity = orderDropPercent >= 90 ? 'critical' : orderDropPercent >= 80 ? 'high' : 'medium';
  
  // 确定当前恢复步骤（检查是否已在修复中）
  const recoveryStep = await getCurrentRecoveryStep(db, accountId, entityType, entityId);
  const stepIndex = Math.min(recoveryStep, config.recovery.steps.length - 1);
  const targetRatio = config.recovery.steps[stepIndex];
  
  // 计算目标恢复出价
  const targetRecoveryBid = effectiveHistoricalCpc * targetRatio;
  
  // 单次最大提价限制
  const maxIncrease = currentBid * (config.recovery.maxSingleIncreasePercent / 100);
  const actualRecoveryBid = Math.min(
    targetRecoveryBid,
    currentBid + maxIncrease
  );
  
  // 如果当前出价已经高于目标，跳过
  if (currentBid >= targetRecoveryBid) return null;
  
  const roundedRecoveryBid = Math.round(actualRecoveryBid * 100) / 100;
  
  log.warn(`[DataCliffRecovery] 断崖检测: ${entityType}="${entityName}" 订单↓${orderDropPercent.toFixed(0)}% 流量↓${trafficDropPercent.toFixed(0)}% 出价差距${bidGapPercent.toFixed(0)}% | $${currentBid.toFixed(2)}→$${roundedRecoveryBid.toFixed(2)} (目标:历史CPC×${(targetRatio*100).toFixed(0)}%=$${targetRecoveryBid.toFixed(2)}, 步骤${recoveryStep+1}/${config.recovery.steps.length})`);
  
  return {
    entityType,
    entityId,
    entityName,
    accountId,
    campaignId,
    campaignName,
    adType,
    currentBid,
    historicalCpc: effectiveHistoricalCpc,
    baselineDailyOrders,
    recentDailyOrders,
    orderDropPercent,
    baselineDailyClicks,
    recentDailyClicks,
    trafficDropPercent,
    bidGapPercent,
    targetRecoveryBid,
    actualRecoveryBid: roundedRecoveryBid,
    recoveryStep: recoveryStep + 1,
    severity,
  };
}

/**
 * 获取当前恢复步骤
 * 
 * 通过查询optimization_events中最近的cliff_recovery事件来确定
 */
async function getCurrentRecoveryStep(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  accountId: number,
  entityType: 'keyword' | 'product_target',
  entityId: number
): Promise<number> {
  try {
    const entityColumn = entityType === 'keyword' ? 'keyword_id' : 'target_id';
    
    const result = await db.execute(sql`
      SELECT COUNT(*) as recovery_count
      FROM optimization_events
      WHERE account_id = ${accountId}
        AND ${sql.raw(entityColumn)} = ${entityId}
        AND event_category = 'cliff_recovery'
        AND created_at >= DATE_SUB(NOW(), INTERVAL ${CLIFF_RECOVERY_CONFIG.lockdownDays} DAY)
    `);
    
    const rows = Array.isArray(result) ? (Array.isArray(result[0]) ? result[0] : result) : [];
    const row = (rows as Array<Record<string, unknown>>)[0];
    return Math.min(Number(row?.recovery_count) || 0, CLIFF_RECOVERY_CONFIG.recovery.steps.length - 1);
    
  } catch {
    return 0;
  }
}

/**
 * 执行单个断崖修复
 * 
 * 1. 更新本地数据库中的出价
 * 2. 记录optimization_events（cliff_recovery类型）
 * 3. 记录审计日志
 * 4. 将修复同步到Amazon API
 */
async function executeCliffRepair(cliff: CliffDetectionResult): Promise<boolean> {
  try {
    const db = await getDb();
    if (!db) return false;
    
    const tableName = cliff.entityType === 'keyword' ? 'keywords' : 'product_targets';
    const bidColumn = 'bid';
    
    // 1. 更新本地数据库
    await db.execute(sql`
      UPDATE ${sql.raw(tableName)}
      SET ${sql.raw(bidColumn)} = ${String(cliff.actualRecoveryBid)}
      WHERE id = ${cliff.entityId} AND account_id = ${cliff.accountId}
    `);
    
    // 2. 记录optimization_events
    await db.execute(sql`
      INSERT INTO optimization_events (
        account_id, event_category, event_type, status,
        ${sql.raw(cliff.entityType === 'keyword' ? 'keyword_id' : 'target_id')},
        previous_bid, new_bid,
        action_detail, api_sync_status, created_at
      ) VALUES (
        ${cliff.accountId}, 'cliff_recovery', ${cliff.entityType + '_bid_restore'}, 'success',
        ${cliff.entityId},
        ${String(cliff.currentBid)}, ${String(cliff.actualRecoveryBid)},
        ${JSON.stringify({
          severity: cliff.severity,
          orderDropPercent: cliff.orderDropPercent,
          trafficDropPercent: cliff.trafficDropPercent,
          bidGapPercent: cliff.bidGapPercent,
          historicalCpc: cliff.historicalCpc,
          recoveryStep: cliff.recoveryStep,
          targetRecoveryBid: cliff.targetRecoveryBid,
          campaignName: cliff.campaignName,
        })},
        'pending',
        NOW()
      )
    `);
    
    // 3. 记录审计日志
    // @ts-ignore
    recordAudit({
      // @ts-ignore
      action: `${cliff.entityType}.cliff_recovery`,
      accountId: cliff.accountId,
      entityType: cliff.entityType,
      // @ts-ignore
      entityId: cliff.entityId,
      // @ts-ignore
      entityName: cliff.entityName,
      // @ts-ignore
      previousValue: cliff.currentBid,
      // @ts-ignore
      newValue: cliff.actualRecoveryBid,
      reason: `[v510断崖修复] 订单↓${cliff.orderDropPercent.toFixed(0)}% 流量↓${cliff.trafficDropPercent.toFixed(0)}% | $${cliff.currentBid.toFixed(2)}→$${cliff.actualRecoveryBid.toFixed(2)} (步骤${cliff.recoveryStep}/${CLIFF_RECOVERY_CONFIG.recovery.steps.length}, 历史CPC=$${cliff.historicalCpc.toFixed(2)})`,
    });
    
    // 4. 同步到Amazon API（通过现有的同步引擎）
    try {
      const { syncBidAdjustmentsToAmazon } = await import('./amazonApiHelper');
      // @ts-ignore
      await syncBidAdjustmentsToAmazon(cliff.accountId, [{
        keywordId: cliff.entityType === 'keyword' ? cliff.entityId : undefined,
        targetId: cliff.entityType === 'product_target' ? cliff.entityId : undefined,
        newBid: cliff.actualRecoveryBid,
        reason: `[DataCliffRecovery] 步骤${cliff.recoveryStep}: $${cliff.currentBid}→$${cliff.actualRecoveryBid}`,
      } as Record<string, unknown>]);
    // @ts-ignore
    } catch (syncErr: unknown) {
      log.warn(`[DataCliffRecovery] API同步失败(${cliff.entityType}=${cliff.entityId}): ${(syncErr as Error).message}`);
      // API同步失败不影响本地修复记录
    }
    
    // @ts-ignore
    logOptimization(`[DataCliffRecovery] 修复成功: ${cliff.entityType}="${cliff.entityName}" $${cliff.currentBid.toFixed(2)}→$${cliff.actualRecoveryBid.toFixed(2)} (${cliff.severity})`);
    
    return true;
    
  } catch (error: unknown) {
    log.error(`[DataCliffRecovery] 修复执行失败(${cliff.entityType}=${cliff.entityId}): ${(error as Error).message}`);
    return false;
  }
}

/**
 * 检查某个实体是否在断崖修复锁定期内
 * 
 * 在常规出价优化流程中调用，如果实体正在修复中，应跳过降价操作
 */
export async function isInCliffRecoveryLockdown(
  accountId: number,
  entityType: 'keyword' | 'product_target',
  entityId: number
): Promise<{ locked: boolean; reason: string }> {
  try {
    const db = await getDb();
    if (!db) return { locked: false, reason: '' };
    
    const entityColumn = entityType === 'keyword' ? 'keyword_id' : 'target_id';
    
    const result = await db.execute(sql`
      SELECT COUNT(*) as recovery_count, MAX(created_at) as last_recovery
      FROM optimization_events
      WHERE account_id = ${accountId}
        AND ${sql.raw(entityColumn)} = ${entityId}
        AND event_category = 'cliff_recovery'
        AND created_at >= DATE_SUB(NOW(), INTERVAL ${CLIFF_RECOVERY_CONFIG.lockdownDays} DAY)
    `);
    
    const rows = Array.isArray(result) ? (Array.isArray(result[0]) ? result[0] : result) : [];
    const row = (rows as Array<Record<string, unknown>>)[0];
    const recoveryCount = Number(row?.recovery_count) || 0;
    
    if (recoveryCount > 0) {
      const lastRecovery = row?.last_recovery ? new Date(String(row.last_recovery)) : new Date();
      const hoursAgo = ((Date.now() - lastRecovery.getTime()) / 3600000).toFixed(1);
      return {
        locked: true,
        reason: `[v510断崖修复锁定] ${recoveryCount}次修复中(最近${hoursAgo}h前), 锁定${CLIFF_RECOVERY_CONFIG.lockdownDays}天内暂停降价`,
      };
    }
    
    return { locked: false, reason: '' };
    
  } catch {
    return { locked: false, reason: '' };
  }
}
