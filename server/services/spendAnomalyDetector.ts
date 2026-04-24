/**
 * v732.4: 资金异常预警与自动熔断服务
 * 
 * 解决问题：
 * AutoCorrector等自动化模块完全绕过了现有的安全护栏（preOptimizationSafetyCheck），
 * 导致越权操作能够大规模修改出价而无任何预警。
 * 
 * 设计目标：
 * 1. 账户级别的日花费/CPC异常波动检测
 * 2. 出价批量修改的异常模式检测（短时间内大量同方向修改）
 * 3. 自动熔断：检测到异常时暂停该账户的所有自动化操作
 * 4. 管理员警报：通过日志和数据库记录通知管理员
 * 5. 手动解除：管理员确认后才能恢复自动化操作
 * 
 * 集成点：
 * - AutoCorrector主循环（runAutoCorrection）
 * - 所有syncBidAdjustmentsToAmazon调用前
 * - 定时巡检任务
 */
import { createModuleLogger } from '../utils/logger';
import { getDb } from '../db/connection';
import { sql } from 'drizzle-orm';

const log = createModuleLogger('SpendAnomalyDetector');

// ==================== 配置常量 ====================
export const ANOMALY_CONFIG = {
  // 出价异常检测
  bid: {
    /** 单次批量操作中，出价变动超过此百分比的关键词占比阈值 */
    batchHighChangeRatioThreshold: 0.5,    // 50%的关键词出价变动超过阈值则触发
    /** 单个关键词出价变动百分比阈值 */
    singleKeywordChangeThreshold: 0.30,     // 单个关键词出价变动超过30%
    /** 短时间内（1小时）同一账户的出价修改次数上限 */
    hourlyBidChangeLimit: 500,
    /** 短时间内（1小时）同一账户的出价修改总金额上限（美元） */
    hourlyBidChangeTotalLimit: 100,         // 1小时内累计出价变动不超过$100
  },
  // 花费异常检测
  spend: {
    /** 日花费相比7天均值的激增倍数阈值 */
    dailySpendSurgeMultiplier: 2.0,         // 日花费超过7天均值的2倍
    /** CPC相比7天均值的激增倍数阈值 */
    cpcSurgeMultiplier: 1.5,                // CPC超过7天均值的1.5倍
    /** 最低花费基准（低于此值不触发检测，避免小账户误报） */
    minBaselineSpend: 10,                   // 7天均值低于$10不检测
  },
  // 熔断配置
  circuitBreaker: {
    /** 熔断后的冷却时间（毫秒） - 默认24小时，需管理员手动解除 */
    cooldownMs: 24 * 60 * 60 * 1000,
    /** 熔断记录保留天数 */
    retentionDays: 90,
  },
};

// ==================== 内存状态 ====================

/** 账户熔断状态 */
interface CircuitBreakerState {
  accountId: number;
  triggeredAt: Date;
  reason: string;
  severity: 'warning' | 'critical';
  /** 是否已被管理员手动解除 */
  manuallyReset: boolean;
  /** 触发时的详细数据 */
  details: {
    metric: string;
    currentValue: number;
    baselineValue: number;
    threshold: number;
  };
}

/** 账户近期操作计数器 */
interface HourlyCounter {
  accountId: number;
  windowStart: Date;
  bidChangeCount: number;
  bidChangeTotalDelta: number;  // 累计出价变动绝对值
}

// 全局状态
const circuitBreakerStates = new Map<number, CircuitBreakerState>();
const hourlyCounters = new Map<number, HourlyCounter>();

// ==================== 核心检测函数 ====================

/**
 * 检查账户是否处于熔断状态
 * 所有自动化操作前必须调用此函数
 */
export function isAccountCircuitBroken(accountId: number): { broken: boolean; reason?: string; triggeredAt?: Date } {
  const state = circuitBreakerStates.get(accountId);
  if (!state) {
    return { broken: false };
  }
  
  // 已被管理员手动解除
  if (state.manuallyReset) {
    return { broken: false };
  }
  
  // 检查冷却时间是否已过
  const elapsed = Date.now() - state.triggeredAt.getTime();
  if (elapsed > ANOMALY_CONFIG.circuitBreaker.cooldownMs) {
    // 冷却期已过，自动解除但记录日志
    log.info(`[SpendAnomaly] 账户${accountId}熔断冷却期已过(${Math.round(elapsed / 3600000)}小时)，自动解除。原因: ${state.reason}`);
    circuitBreakerStates.delete(accountId);
    return { broken: false };
  }
  
  return {
    broken: true,
    reason: state.reason,
    triggeredAt: state.triggeredAt,
  };
}

/**
 * 触发账户熔断
 */
export async function triggerCircuitBreaker(
  accountId: number,
  reason: string,
  severity: 'warning' | 'critical',
  details: CircuitBreakerState['details']
): Promise<void> {
  const state: CircuitBreakerState = {
    accountId,
    triggeredAt: new Date(),
    reason,
    severity,
    manuallyReset: false,
    details,
  };
  
  circuitBreakerStates.set(accountId, state);
  
  // 记录到日志
  log.error(`[SpendAnomaly] 🚨 账户${accountId}触发熔断! 严重级别=${severity}, 原因: ${reason}`);
  log.error(`[SpendAnomaly] 详情: ${details.metric}=${details.currentValue.toFixed(4)}, 基准=${details.baselineValue.toFixed(4)}, 阈值=${details.threshold.toFixed(4)}`);
  
  // 持久化到数据库
  try {
    const database = await getDb();
    if (database) {
      await database.execute(sql`
        INSERT INTO spend_anomaly_alerts 
        (account_id, alert_type, severity, reason, metric_name, current_value, baseline_value, threshold_value, triggered_at, resolved, resolved_at, resolved_by)
        VALUES 
        (${accountId}, 'circuit_breaker', ${severity}, ${reason}, ${details.metric}, 
         ${details.currentValue}, ${details.baselineValue}, ${details.threshold},
         NOW(), 0, NULL, NULL)
      `);
    }
  } catch (dbErr: unknown) {
    log.warn(`[SpendAnomaly] 持久化熔断记录失败: ${(dbErr as Error).message}`);
  }
}

/**
 * 管理员手动解除熔断
 */
export async function resetCircuitBreaker(accountId: number, adminUserId: number): Promise<boolean> {
  const state = circuitBreakerStates.get(accountId);
  if (!state) {
    return false;
  }
  
  state.manuallyReset = true;
  log.info(`[SpendAnomaly] 管理员(userId=${adminUserId})手动解除账户${accountId}的熔断`);
  
  // 更新数据库记录
  try {
    const database = await getDb();
    if (database) {
      await database.execute(sql`
        UPDATE spend_anomaly_alerts 
        SET resolved = 1, resolved_at = NOW(), resolved_by = ${adminUserId}
        WHERE account_id = ${accountId} AND resolved = 0
      `);
    }
  } catch (dbErr: unknown) {
    log.warn(`[SpendAnomaly] 更新熔断解除记录失败: ${(dbErr as Error).message}`);
  }
  
  return true;
}

// ==================== 批量操作前置检测 ====================

/**
 * 在批量出价修改前检测异常
 * 
 * @param accountId 账户ID
 * @param adjustments 待执行的出价调整列表
 * @returns 是否允许继续执行
 */
export async function preBatchBidCheck(
  accountId: number,
  adjustments: Array<{ keywordId: number; newBid: number; currentBid?: number }>
): Promise<{ allowed: boolean; reason?: string; warnings: string[] }> {
  const warnings: string[] = [];
  
  // 1. 检查熔断状态
  const cbState = isAccountCircuitBroken(accountId);
  if (cbState.broken) {
    return {
      allowed: false,
      reason: `账户${accountId}处于熔断状态(${cbState.reason})，所有自动化操作已暂停`,
      warnings: [`熔断触发时间: ${cbState.triggeredAt?.toISOString()}`],
    };
  }
  
  // 2. 检查小时级操作频率
  const counter = getOrCreateHourlyCounter(accountId);
  const newCount = counter.bidChangeCount + adjustments.length;
  if (newCount > ANOMALY_CONFIG.bid.hourlyBidChangeLimit) {
    const reason = `账户${accountId}在1小时内出价修改次数(${newCount})超过上限(${ANOMALY_CONFIG.bid.hourlyBidChangeLimit})`;
    await triggerCircuitBreaker(accountId, reason, 'critical', {
      metric: 'hourly_bid_change_count',
      currentValue: newCount,
      baselineValue: ANOMALY_CONFIG.bid.hourlyBidChangeLimit,
      threshold: ANOMALY_CONFIG.bid.hourlyBidChangeLimit,
    });
    return { allowed: false, reason, warnings };
  }
  
  // 3. 检查出价变动幅度异常
  let highChangeCount = 0;
  let totalDelta = 0;
  
  for (const adj of adjustments) {
    if (adj.currentBid && adj.currentBid > 0) {
      const changePercent = Math.abs(adj.newBid - adj.currentBid) / adj.currentBid;
      totalDelta += Math.abs(adj.newBid - adj.currentBid);
      
      if (changePercent > ANOMALY_CONFIG.bid.singleKeywordChangeThreshold) {
        highChangeCount++;
      }
    }
  }
  
  // 检查高变动占比
  if (adjustments.length > 10) {  // 只对批量操作检测
    const highChangeRatio = highChangeCount / adjustments.length;
    if (highChangeRatio > ANOMALY_CONFIG.bid.batchHighChangeRatioThreshold) {
      const reason = `账户${accountId}批量操作中${(highChangeRatio * 100).toFixed(0)}%的关键词出价变动超过${(ANOMALY_CONFIG.bid.singleKeywordChangeThreshold * 100).toFixed(0)}%`;
      warnings.push(reason);
      
      // 严重异常 - 触发熔断
      if (highChangeRatio > 0.8) {
        await triggerCircuitBreaker(accountId, reason, 'critical', {
          metric: 'batch_high_change_ratio',
          currentValue: highChangeRatio,
          baselineValue: ANOMALY_CONFIG.bid.batchHighChangeRatioThreshold,
          threshold: 0.8,
        });
        return { allowed: false, reason, warnings };
      }
    }
  }
  
  // 检查累计变动金额
  const newTotalDelta = counter.bidChangeTotalDelta + totalDelta;
  if (newTotalDelta > ANOMALY_CONFIG.bid.hourlyBidChangeTotalLimit) {
    const reason = `账户${accountId}在1小时内累计出价变动金额($${newTotalDelta.toFixed(2)})超过上限($${ANOMALY_CONFIG.bid.hourlyBidChangeTotalLimit})`;
    warnings.push(reason);
    
    await triggerCircuitBreaker(accountId, reason, 'warning', {
      metric: 'hourly_bid_change_total',
      currentValue: newTotalDelta,
      baselineValue: ANOMALY_CONFIG.bid.hourlyBidChangeTotalLimit,
      threshold: ANOMALY_CONFIG.bid.hourlyBidChangeTotalLimit,
    });
    return { allowed: false, reason, warnings };
  }
  
  // 更新计数器
  counter.bidChangeCount = newCount;
  counter.bidChangeTotalDelta = newTotalDelta;
  
  if (warnings.length > 0) {
    log.warn(`[SpendAnomaly] 账户${accountId}批量操作警告: ${warnings.join('; ')}`);
  }
  
  return { allowed: true, warnings };
}

// ==================== 定时巡检 ====================

/**
 * 定时巡检所有账户的花费异常
 * 建议每2小时执行一次
 */
export async function runSpendAnomalyCheck(): Promise<{
  checkedAccounts: number;
  anomaliesDetected: number;
  circuitBroken: number;
  details: Array<{ accountId: number; metric: string; value: number; baseline: number }>;
}> {
  const result = {
    checkedAccounts: 0,
    anomaliesDetected: 0,
    circuitBroken: 0,
    details: [] as Array<{ accountId: number; metric: string; value: number; baseline: number }>,
  };
  
  try {
    const database = await getDb();
    if (!database) {
      log.warn('[SpendAnomaly] 无法获取数据库连接，跳过巡检');
      return result;
    }
    
    // 获取所有有活跃优化目标的账户
    const accountsResult = await database.execute(sql`
      SELECT DISTINCT aa.id as account_id
      FROM ad_accounts aa
      INNER JOIN performance_groups pg ON pg.accountId = aa.id
      WHERE pg.auto_optimize = 1 AND pg.status = 'active'
    `);
    const accounts = ((accountsResult as unknown[][])[0] || accountsResult) as Array<{ account_id: number }>;
    
    for (const account of accounts) {
      const accountId = account.account_id;
      result.checkedAccounts++;
      
      try {
        // 查询最近24小时 vs 前7天的花费对比
        const spendResult = await database.execute(sql`
          SELECT 
            COALESCE(SUM(CASE WHEN date >= DATE_SUB(CURDATE(), INTERVAL 1 DAY) THEN spend ELSE 0 END), 0) as recent_spend,
            COALESCE(SUM(CASE WHEN date >= DATE_SUB(CURDATE(), INTERVAL 1 DAY) THEN clicks ELSE 0 END), 0) as recent_clicks,
            COALESCE(AVG(CASE WHEN date < DATE_SUB(CURDATE(), INTERVAL 1 DAY) AND date >= DATE_SUB(CURDATE(), INTERVAL 8 DAY) THEN daily_spend ELSE NULL END), 0) as avg_daily_spend,
            COALESCE(AVG(CASE WHEN date < DATE_SUB(CURDATE(), INTERVAL 1 DAY) AND date >= DATE_SUB(CURDATE(), INTERVAL 8 DAY) THEN daily_cpc ELSE NULL END), 0) as avg_daily_cpc
          FROM (
            SELECT 
              date,
              SUM(spend) as daily_spend,
              SUM(spend) as spend,
              SUM(clicks) as clicks,
              CASE WHEN SUM(clicks) > 0 THEN SUM(spend) / SUM(clicks) ELSE 0 END as daily_cpc
            FROM daily_performance
            WHERE account_id = ${accountId}
              AND date >= DATE_SUB(CURDATE(), INTERVAL 8 DAY)
            GROUP BY date
          ) daily_stats
        `);
        
        const stats = ((spendResult as unknown[][])[0] || spendResult) as Array<Record<string, unknown>>;
        if (!stats || stats.length === 0) continue;
        
        const row = stats[0];
        const recentSpend = Number(row.recent_spend) || 0;
        const recentClicks = Number(row.recent_clicks) || 0;
        const avgDailySpend = Number(row.avg_daily_spend) || 0;
        const avgDailyCpc = Number(row.avg_daily_cpc) || 0;
        
        // 基准太低，跳过检测
        if (avgDailySpend < ANOMALY_CONFIG.spend.minBaselineSpend) continue;
        
        // 检测日花费激增
        if (avgDailySpend > 0) {
          const spendMultiplier = recentSpend / avgDailySpend;
          if (spendMultiplier >= ANOMALY_CONFIG.spend.dailySpendSurgeMultiplier) {
            result.anomaliesDetected++;
            result.details.push({
              accountId,
              metric: 'daily_spend_surge',
              value: recentSpend,
              baseline: avgDailySpend,
            });
            
            const reason = `账户${accountId}日花费($${recentSpend.toFixed(2)})是7天均值($${avgDailySpend.toFixed(2)})的${spendMultiplier.toFixed(1)}倍`;
            log.warn(`[SpendAnomaly] 🔶 ${reason}`);
            
            if (spendMultiplier >= ANOMALY_CONFIG.spend.dailySpendSurgeMultiplier * 1.5) {
              // 超过3倍 - 触发熔断
              await triggerCircuitBreaker(accountId, reason, 'critical', {
                metric: 'daily_spend_surge',
                currentValue: recentSpend,
                baselineValue: avgDailySpend,
                threshold: avgDailySpend * ANOMALY_CONFIG.spend.dailySpendSurgeMultiplier,
              });
              result.circuitBroken++;
            }
          }
        }
        
        // 检测CPC激增
        if (avgDailyCpc > 0 && recentClicks > 0) {
          const recentCpc = recentSpend / recentClicks;
          const cpcMultiplier = recentCpc / avgDailyCpc;
          if (cpcMultiplier >= ANOMALY_CONFIG.spend.cpcSurgeMultiplier) {
            result.anomaliesDetected++;
            result.details.push({
              accountId,
              metric: 'cpc_surge',
              value: recentCpc,
              baseline: avgDailyCpc,
            });
            
            const reason = `账户${accountId}平均CPC($${recentCpc.toFixed(3)})是7天均值($${avgDailyCpc.toFixed(3)})的${cpcMultiplier.toFixed(1)}倍`;
            log.warn(`[SpendAnomaly] 🔶 ${reason}`);
            
            if (cpcMultiplier >= ANOMALY_CONFIG.spend.cpcSurgeMultiplier * 2) {
              await triggerCircuitBreaker(accountId, reason, 'critical', {
                metric: 'cpc_surge',
                currentValue: recentCpc,
                baselineValue: avgDailyCpc,
                threshold: avgDailyCpc * ANOMALY_CONFIG.spend.cpcSurgeMultiplier,
              });
              result.circuitBroken++;
            }
          }
        }
        
      } catch (accountErr: unknown) {
        log.warn(`[SpendAnomaly] 账户${accountId}巡检失败: ${(accountErr as Error).message}`);
      }
    }
    
    log.info(`[SpendAnomaly] 巡检完成: 检查${result.checkedAccounts}个账户, 发现${result.anomaliesDetected}个异常, 触发${result.circuitBroken}个熔断`);
    
  } catch (err: unknown) {
    log.error(`[SpendAnomaly] 巡检异常: ${(err as Error).message}`);
  }
  
  return result;
}

// ==================== 辅助函数 ====================

function getOrCreateHourlyCounter(accountId: number): HourlyCounter {
  const existing = hourlyCounters.get(accountId);
  const now = new Date();
  
  // 如果计数器存在且在同一小时窗口内，返回现有计数器
  if (existing) {
    const elapsed = now.getTime() - existing.windowStart.getTime();
    if (elapsed < 3600000) {  // 1小时
      return existing;
    }
  }
  
  // 创建新的计数器
  const counter: HourlyCounter = {
    accountId,
    windowStart: now,
    bidChangeCount: 0,
    bidChangeTotalDelta: 0,
  };
  hourlyCounters.set(accountId, counter);
  return counter;
}

// ==================== 数据库表初始化 ====================

let tableEnsured = false;

export async function ensureAnomalyAlertTable(): Promise<void> {
  if (tableEnsured) return;
  try {
    const database = await getDb();
    if (!database) return;
    
    await database.execute(sql`
      CREATE TABLE IF NOT EXISTS spend_anomaly_alerts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        account_id INT NOT NULL,
        alert_type VARCHAR(50) NOT NULL,
        severity VARCHAR(20) NOT NULL,
        reason TEXT,
        metric_name VARCHAR(100),
        current_value DECIMAL(15,4),
        baseline_value DECIMAL(15,4),
        threshold_value DECIMAL(15,4),
        triggered_at DATETIME NOT NULL,
        resolved TINYINT(1) DEFAULT 0,
        resolved_at DATETIME,
        resolved_by INT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_account_resolved (account_id, resolved),
        INDEX idx_triggered_at (triggered_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    
    tableEnsured = true;
    log.info('[SpendAnomaly] spend_anomaly_alerts表已确认存在');
  } catch (err: unknown) {
    const errMsg = (err as Error).message || '';
    if (errMsg.includes('already exists')) {
      tableEnsured = true;
    } else {
      log.warn(`[SpendAnomaly] 创建spend_anomaly_alerts表失败: ${errMsg}`);
    }
  }
}

// ==================== 状态查询 ====================

/**
 * 获取所有当前熔断状态（供管理员查看）
 */
export function getAllCircuitBreakerStates(): CircuitBreakerState[] {
  return Array.from(circuitBreakerStates.values()).filter(s => !s.manuallyReset);
}

/**
 * 获取指定账户的历史告警记录
 */
export async function getAccountAlertHistory(accountId: number, limit: number = 50): Promise<unknown[]> {
  try {
    const database = await getDb();
    if (!database) return [];
    
    const result = await database.execute(sql`
      SELECT * FROM spend_anomaly_alerts 
      WHERE account_id = ${accountId}
      ORDER BY triggered_at DESC
      LIMIT ${limit}
    `);
    
    return ((result as unknown[][])[0] || result) as unknown[];
  } catch (err: unknown) {
    log.warn(`[SpendAnomaly] 查询告警历史失败: ${(err as Error).message}`);
    return [];
  }
}
