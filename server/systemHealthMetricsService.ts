/**
 * systemHealthMetricsService.ts - v260 系统健康核心指标服务
 * 
 * P0: 持续监控与参数调优
 * 提供回滚率、算法激活率、ACoS趋势等核心健康指标的实时计算
 * 
 * P1: 双向出价策略精细化
 * 提供提价操作分析和动态提价模型参数建议
 * 
 * 核心指标:
 * 1. 回滚率 (Rollback Rate) — 被纠错器回滚的出价调整占总调整的比例
 * 2. 算法激活率 (Algorithm Activation Rate) — 高级算法参与决策的比例
 * 3. ACoS趋势 (ACoS Trend) — 死亡螺旋是否被遏制的关键指标
 * 4. 提价操作分析 (Bid Increase Analysis) — v259双向出价策略的效果评估
 * 5. 熔断触发率 (Circuit Breaker Rate) — 熔断保护机制的触发频率
 */

import { getDb } from './db';
import { sql } from 'drizzle-orm';
import { createModuleLogger } from './utils/logger';

const log = createModuleLogger('SystemHealth');

// ==================== 类型定义 ====================

export interface SystemHealthMetrics {
  /** 计算时间 */
  calculatedAt: string;
  /** 账户ID */
  accountId: number;
  /** 回滚率指标 */
  rollbackRate: {
    /** 总出价调整次数 */
    totalAdjustments: number;
    /** 被回滚的次数 */
    rolledBackCount: number;
    /** 回滚率 (0-100%) */
    rate: number;
    /** 健康状态: healthy(<10%), warning(10-30%), critical(>30%) */
    status: 'healthy' | 'warning' | 'critical';
    /** 趋势: 与前一周期对比 */
    trend: 'improving' | 'stable' | 'worsening';
    /** 前一周期回滚率 */
    previousRate: number;
  };
  /** 算法激活率指标 */
  algorithmActivation: {
    /** 总决策次数 */
    totalDecisions: number;
    /** 各算法使用次数 */
    algorithmCounts: Record<string, number>;
    /** 高级算法(非rule_engine/conservative)使用比例 (0-100%) */
    advancedRate: number;
    /** 健康状态 */
    status: 'healthy' | 'warning' | 'critical';
    /** 各算法占比 */
    algorithmRates: Record<string, number>;
  };
  /** ACoS趋势指标 */
  acosTrend: {
    /** 当前ACoS (%) */
    currentAcos: number;
    /** 7天前ACoS (%) */
    acos7dAgo: number;
    /** 14天前ACoS (%) */
    acos14dAgo: number;
    /** 趋势方向 */
    direction: 'improving' | 'stable' | 'worsening';
    /** 变化幅度 (百分点) */
    changePoints: number;
    /** 是否处于死亡螺旋 */
    deathSpiralDetected: boolean;
  };
  /** 提价操作分析 (P1) */
  bidIncreaseAnalysis: {
    /** 提价操作总数 */
    totalIncreases: number;
    /** 平均提价幅度 (%) */
    avgIncreasePercent: number;
    /** 提价后ACoS改善的比例 (%) */
    successRate: number;
    /** 各提价场景统计 */
    byScenario: {
      scenario: string;
      count: number;
      avgPercent: number;
    }[];
  };
  /** 熔断触发率 */
  circuitBreakerRate: {
    /** 总出价决策次数 */
    totalDecisions: number;
    /** 熔断触发次数 */
    trippedCount: number;
    /** 触发率 (0-100%) */
    rate: number;
    /** 各触发原因统计 */
    byReason: Record<string, number>;
  };
}

// ==================== 核心计算函数 ====================

/**
 * 计算回滚率 (v266 P0-2 优化)
 * 
 * v266优化: 区分"被动回滚"(算法冲突导致的真正回滚)和"主动纠正"(纠错器的正常微调)
 * 
 * 真正回滚率 = 被动回滚数 / 总出价调整数
 * 广义回滚率 = (被动回滚 + 主动纠正) / 总出价调整数
 * 
 * 判断标准:
 * - status='rolled_back' 且 change_reason包含'回滚'或'rollback' → 被动回滚(算法冲突)
 * - status='rolled_back' 且 change_reason包含'AutoCorrector'和'纠正' → 主动纠正(正常行为)
 * - 主动纠正中调整幅度<15%的视为"微调"，不计入回滚率
 */
async function calculateRollbackRate(
  accountId: number,
  days: number = 7
): Promise<SystemHealthMetrics['rollbackRate']> {
  const db = await getDb();
  if (!db) {
    return { totalAdjustments: 0, rolledBackCount: 0, rate: 0, status: 'healthy', trend: 'stable', previousRate: 0 };
  }

  try {
    // 当前周期: 最近N天
    // v266: 精细化回滚率计算
    // 1. 总调整数: 只计算真正的出价调整(bid_increase/bid_decrease)，排除纠错器自身的调整
    // 2. 被动回滚: status='rolled_back' 且调整幅度>=15%(排除纠错器微调)
    // 3. 排除纠错器自身产生的事件，避免重复计数
    const currentPeriodQuery = sql`
      SELECT 
        COUNT(CASE WHEN change_reason NOT LIKE '%AutoCorrector%' THEN 1 END) as total_original,
        COUNT(*) as total_all,
        SUM(CASE 
          WHEN status = 'rolled_back' 
            AND change_reason NOT LIKE '%AutoCorrector%'
            AND ABS(CAST(new_value AS DECIMAL(10,4)) - CAST(previous_value AS DECIMAL(10,4))) / NULLIF(CAST(previous_value AS DECIMAL(10,4)), 0) >= 0.15
          THEN 1 
          ELSE 0 
        END) as hard_rollback,
        SUM(CASE 
          WHEN (status = 'rolled_back' OR (change_reason LIKE '%AutoCorrector%' AND change_reason LIKE '%纠正%'))
            AND change_reason NOT LIKE '%AutoCorrector%'
          THEN 1 
          ELSE 0 
        END) as soft_rollback
      FROM optimization_events
      WHERE account_id = ${accountId}
        AND event_category = 'bid_adjustment'
        AND action_type IN ('bid_increase', 'bid_decrease')
        AND created_at > DATE_SUB(NOW(), INTERVAL ${days} DAY)
    `;
    const currentResult = await db.execute(currentPeriodQuery);
    const currentRows = (currentResult as Record<string, unknown>[])[0] || currentResult;
    const totalOriginal = Number(currentRows?.[0]?.total_original) || 0;
    const hardRollback = Number(currentRows?.[0]?.hard_rollback) || 0;
    const softRollback = Number(currentRows?.[0]?.soft_rollback) || 0;
    
    // v266: 使用“真正回滚率”作为主指标，排除纠错器正常微调
    const total = totalOriginal;
    const rolledBack = hardRollback;
    const rate = total > 0 ? (rolledBack / total) * 100 : 0;

    // 前一周期: N天前到2N天前
    const previousPeriodQuery = sql`
      SELECT 
        COUNT(CASE WHEN change_reason NOT LIKE '%AutoCorrector%' THEN 1 END) as total_original,
        SUM(CASE 
          WHEN status = 'rolled_back' 
            AND change_reason NOT LIKE '%AutoCorrector%'
            AND ABS(CAST(new_value AS DECIMAL(10,4)) - CAST(previous_value AS DECIMAL(10,4))) / NULLIF(CAST(previous_value AS DECIMAL(10,4)), 0) >= 0.15
          THEN 1 
          ELSE 0 
        END) as hard_rollback
      FROM optimization_events
      WHERE account_id = ${accountId}
        AND event_category = 'bid_adjustment'
        AND action_type IN ('bid_increase', 'bid_decrease')
        AND created_at > DATE_SUB(NOW(), INTERVAL ${days * 2} DAY)
        AND created_at <= DATE_SUB(NOW(), INTERVAL ${days} DAY)
    `;
    const previousResult = await db.execute(previousPeriodQuery);
    const previousRows = (previousResult as Record<string, unknown>[])[0] || previousResult;
    const prevTotal = Number(previousRows?.[0]?.total_original) || 0;
    const prevRolledBack = Number(previousRows?.[0]?.hard_rollback) || 0;
    const previousRate = prevTotal > 0 ? (prevRolledBack / prevTotal) * 100 : 0;

    // 判断趋势
    const trend = rate < previousRate - 2 ? 'improving' : rate > previousRate + 2 ? 'worsening' : 'stable';
    // 判断健康状态
    const status = rate < 10 ? 'healthy' : rate < 30 ? 'warning' : 'critical';
    
    log.info(`[RollbackRate] v266: 账户${accountId} 原始调整=${totalOriginal}, 硬回滚=${hardRollback}, 软回滚=${softRollback}, 真正回滚率=${rate.toFixed(1)}%`);

    return { totalAdjustments: total, rolledBackCount: rolledBack, rate: Math.round(rate * 10) / 10, status, trend, previousRate: Math.round(previousRate * 10) / 10 };
  } catch (error: any) {
    log.warn(`[RollbackRate] 计算异常: ${error.message}`);
    return { totalAdjustments: 0, rolledBackCount: 0, rate: 0, status: 'healthy', trend: 'stable', previousRate: 0 };
  }
}

/**
 * 计算算法激活率
 * 
 * 从optimization_events的change_reason和action_detail中解析算法名称
 * 高级算法: ucb, linucb, sigmoid_curve, cql, ensemble
 * 基础算法: rule_engine, rule_based, conservative
 */
async function calculateAlgorithmActivation(
  accountId: number,
  days: number = 7
): Promise<SystemHealthMetrics['algorithmActivation']> {
  const db = await getDb();
  if (!db) {
    return { totalDecisions: 0, algorithmCounts: {}, advancedRate: 0, status: 'critical', algorithmRates: {} };
  }

  try {
    const query = sql`
      SELECT 
        change_reason,
        action_detail,
        COUNT(*) as cnt
      FROM optimization_events
      WHERE account_id = ${accountId}
        AND event_category = 'bid_adjustment'
        AND status = 'success'
        AND created_at > DATE_SUB(NOW(), INTERVAL ${days} DAY)
      GROUP BY change_reason, action_detail
    `;
    const result = await db.execute(query);
    const rows = (result as any)[0] || result;

    const algorithmCounts: Record<string, number> = {};
    let totalDecisions = 0;

    if (Array.isArray(rows)) {
      for (const row of rows) {
        const count = Number(row.cnt) || 0;
        const algorithm = parseAlgorithmName(row.change_reason, row.action_detail);
        algorithmCounts[algorithm] = (algorithmCounts[algorithm] || 0) + count;
        totalDecisions += count;
      }
    }

    // 计算高级算法比例
    const advancedAlgorithms = ['ucb', 'linucb', 'sigmoid_curve', 'cql', 'ensemble'];
    let advancedCount = 0;
    for (const alg of advancedAlgorithms) {
      advancedCount += algorithmCounts[alg] || 0;
    }
    const advancedRate = totalDecisions > 0 ? (advancedCount / totalDecisions) * 100 : 0;

    // 计算各算法占比
    const algorithmRates: Record<string, number> = {};
    for (const [alg, count] of Object.entries(algorithmCounts)) {
      algorithmRates[alg] = totalDecisions > 0 ? Math.round((count / totalDecisions) * 1000) / 10 : 0;
    }

    const status = advancedRate > 30 ? 'healthy' : advancedRate > 10 ? 'warning' : 'critical';

    return {
      totalDecisions,
      algorithmCounts,
      advancedRate: Math.round(advancedRate * 10) / 10,
      status,
      algorithmRates,
    };
  } catch (error: any) {
    log.warn(`[AlgorithmActivation] 计算异常: ${error.message}`);
    return { totalDecisions: 0, algorithmCounts: {}, advancedRate: 0, status: 'critical', algorithmRates: {} };
  }
}

/**
 * 计算ACoS趋势
 */
async function calculateAcosTrend(
  accountId: number
): Promise<SystemHealthMetrics['acosTrend']> {
  const db = await getDb();
  if (!db) {
    return { currentAcos: 0, acos7dAgo: 0, acos14dAgo: 0, direction: 'stable', changePoints: 0, deathSpiralDetected: false };
  }

  try {
    // 最近3天ACoS
    const recentQuery = sql`
      SELECT 
        SUM(spend) as total_spend,
        SUM(sales) as total_sales
      FROM daily_performance
      WHERE account_id = ${accountId}
        AND date >= DATE_SUB(CURDATE(), INTERVAL 3 DAY)
    `;
    const recentResult = await db.execute(recentQuery);
    const recentRows = (recentResult as Record<string, unknown>[])[0] || recentResult;
    const recentSpend = Number(recentRows?.[0]?.total_spend) || 0;
    const recentSales = Number(recentRows?.[0]?.total_sales) || 0;
    const currentAcos = recentSales > 0 ? (recentSpend / recentSales) * 100 : 0;

    // 7天前的3天ACoS
    const week1Query = sql`
      SELECT 
        SUM(spend) as total_spend,
        SUM(sales) as total_sales
      FROM daily_performance
      WHERE account_id = ${accountId}
        AND date >= DATE_SUB(CURDATE(), INTERVAL 10 DAY)
        AND date < DATE_SUB(CURDATE(), INTERVAL 7 DAY)
    `;
    const week1Result = await db.execute(week1Query);
    const week1Rows = (week1Result as Record<string, unknown>[])[0] || week1Result;
    const week1Spend = Number(week1Rows?.[0]?.total_spend) || 0;
    const week1Sales = Number(week1Rows?.[0]?.total_sales) || 0;
    const acos7dAgo = week1Sales > 0 ? (week1Spend / week1Sales) * 100 : 0;

    // 14天前的3天ACoS
    const week2Query = sql`
      SELECT 
        SUM(spend) as total_spend,
        SUM(sales) as total_sales
      FROM daily_performance
      WHERE account_id = ${accountId}
        AND date >= DATE_SUB(CURDATE(), INTERVAL 17 DAY)
        AND date < DATE_SUB(CURDATE(), INTERVAL 14 DAY)
    `;
    const week2Result = await db.execute(week2Query);
    const week2Rows = (week2Result as Record<string, unknown>[])[0] || week2Result;
    const week2Spend = Number(week2Rows?.[0]?.total_spend) || 0;
    const week2Sales = Number(week2Rows?.[0]?.total_sales) || 0;
    const acos14dAgo = week2Sales > 0 ? (week2Spend / week2Sales) * 100 : 0;

    // 判断趋势
    const changePoints = currentAcos - acos7dAgo;
    const direction = changePoints < -3 ? 'improving' : changePoints > 3 ? 'worsening' : 'stable';

    // 死亡螺旋检测: ACoS连续两周恶化且当前>50%
    const deathSpiralDetected = currentAcos > 50 && currentAcos > acos7dAgo && acos7dAgo > acos14dAgo;

    return {
      currentAcos: Math.round(currentAcos * 10) / 10,
      acos7dAgo: Math.round(acos7dAgo * 10) / 10,
      acos14dAgo: Math.round(acos14dAgo * 10) / 10,
      direction,
      changePoints: Math.round(changePoints * 10) / 10,
      deathSpiralDetected,
    };
  } catch (error: any) {
    log.warn(`[AcosTrend] 计算异常: ${error.message}`);
    return { currentAcos: 0, acos7dAgo: 0, acos14dAgo: 0, direction: 'stable', changePoints: 0, deathSpiralDetected: false };
  }
}

/**
 * P1: 提价操作分析
 * 分析v259双向出价策略的提价效果
 */
async function calculateBidIncreaseAnalysis(
  accountId: number,
  days: number = 14
): Promise<SystemHealthMetrics['bidIncreaseAnalysis']> {
  const db = await getDb();
  if (!db) {
    return { totalIncreases: 0, avgIncreasePercent: 0, successRate: 0, byScenario: [] };
  }

  try {
    const query = sql`
      SELECT 
        change_reason,
        previous_bid,
        new_bid,
        bid_change_percent,
        created_at
      FROM optimization_events
      WHERE account_id = ${accountId}
        AND event_category = 'bid_adjustment'
        AND action_type = 'bid_increase'
        AND status = 'success'
        AND created_at > DATE_SUB(NOW(), INTERVAL ${days} DAY)
      ORDER BY created_at DESC
      LIMIT 1000
    `;
    const result = await db.execute(query);
    const rows = (result as any)[0] || result;

    if (!Array.isArray(rows) || rows.length === 0) {
      return { totalIncreases: 0, avgIncreasePercent: 0, successRate: 0, byScenario: [] };
    }

    const scenarioMap = new Map<string, { count: number; totalPercent: number }>();
    let totalPercent = 0;

    for (const row of rows) {
      const percent = Math.abs(Number(row.bid_change_percent) || 0);
      totalPercent += percent;

      const scenario = classifyBidIncreaseScenario(row.change_reason);
      if (!scenarioMap.has(scenario)) {
        scenarioMap.set(scenario, { count: 0, totalPercent: 0 });
      }
      const stats = scenarioMap.get(scenario)!;
      stats.count++;
      stats.totalPercent += percent;
    }

    const byScenario = Array.from(scenarioMap.entries()).map(([scenario, stats]) => ({
      scenario,
      count: stats.count,
      avgPercent: Math.round((stats.totalPercent / stats.count) * 10) / 10,
    })).sort((a, b) => b.count - a.count);

    return {
      totalIncreases: rows.length,
      avgIncreasePercent: Math.round((totalPercent / rows.length) * 10) / 10,
      successRate: 0, // 需要后续数据验证才能计算
      byScenario,
    };
  } catch (error: any) {
    log.warn(`[BidIncreaseAnalysis] 计算异常: ${error.message}`);
    return { totalIncreases: 0, avgIncreasePercent: 0, successRate: 0, byScenario: [] };
  }
}

/**
 * 计算熔断触发率
 */
async function calculateCircuitBreakerRate(
  accountId: number,
  days: number = 7
): Promise<SystemHealthMetrics['circuitBreakerRate']> {
  const db = await getDb();
  if (!db) {
    return { totalDecisions: 0, trippedCount: 0, rate: 0, byReason: {} };
  }

  try {
    // 总出价决策数
    const totalQuery = sql`
      SELECT COUNT(*) as total
      FROM optimization_events
      WHERE account_id = ${accountId}
        AND event_category = 'bid_adjustment'
        AND created_at > DATE_SUB(NOW(), INTERVAL ${days} DAY)
    `;
    const totalResult = await db.execute(totalQuery);
    const totalRows = (totalResult as Record<string, unknown>[])[0] || totalResult;
    const totalDecisions = Number(totalRows?.[0]?.total) || 0;

    // 熔断触发数
    const trippedQuery = sql`
      SELECT 
        change_reason,
        COUNT(*) as cnt
      FROM optimization_events
      WHERE account_id = ${accountId}
        AND event_category = 'bid_adjustment'
        AND created_at > DATE_SUB(NOW(), INTERVAL ${days} DAY)
        AND (change_reason LIKE '%熔断%' OR change_reason LIKE '%circuit_breaker%' OR change_reason LIKE '%提价恢复%' OR change_reason LIKE '%曝光保护%')
      GROUP BY change_reason
    `;
    const trippedResult = await db.execute(trippedQuery);
    const trippedRows = (trippedResult as Record<string, unknown>[])[0] || trippedResult;

    let trippedCount = 0;
    const byReason: Record<string, number> = {};

    if (Array.isArray(trippedRows)) {
      for (const row of trippedRows) {
        const count = Number(row.cnt) || 0;
        trippedCount += count;
        const reason = classifyCircuitBreakerReason(row.change_reason);
        byReason[reason] = (byReason[reason] || 0) + count;
      }
    }

    const rate = totalDecisions > 0 ? (trippedCount / totalDecisions) * 100 : 0;

    return {
      totalDecisions,
      trippedCount,
      rate: Math.round(rate * 10) / 10,
      byReason,
    };
  } catch (error: any) {
    log.warn(`[CircuitBreakerRate] 计算异常: ${error.message}`);
    return { totalDecisions: 0, trippedCount: 0, rate: 0, byReason: {} };
  }
}

// ==================== 辅助函数 ====================

/**
 * 从change_reason和action_detail中解析算法名称
 */
function parseAlgorithmName(changeReason?: string | null, actionDetail?: string | null): string {
  const text = `${changeReason || ''} ${actionDetail || ''}`.toLowerCase();
  
  if (text.includes('ensemble') || text.includes('融合')) return 'ensemble';
  if (text.includes('cql') || text.includes('离线强化')) return 'cql';
  if (text.includes('linucb') || text.includes('上下文赌博机')) return 'linucb';
  if (text.includes('sigmoid') || text.includes('曲线利润')) return 'sigmoid_curve';
  if (text.includes('ucb') || text.includes('探索-利用') || text.includes('探索利用')) return 'ucb';
  if (text.includes('rule_engine') || text.includes('rule_based') || text.includes('规则引擎') || text.includes('规则')) return 'rule_engine';
  if (text.includes('conservative') || text.includes('保守策略') || text.includes('维持')) return 'conservative';
  if (text.includes('autocorrect') || text.includes('纠正') || text.includes('纠错')) return 'auto_corrector';
  if (text.includes('熔断') || text.includes('提价恢复') || text.includes('曝光保护')) return 'circuit_breaker';
  
  return 'unknown';
}

/**
 * 分类提价场景
 */
function classifyBidIncreaseScenario(changeReason?: string | null): string {
  const text = (changeReason || '').toLowerCase();
  
  if (text.includes('双向出价') || text.includes('acos极优')) return 'v259双向出价-ACOS极优';
  if (text.includes('曝光保护')) return 'v259曝光保护提价';
  if (text.includes('提价恢复') || text.includes('熔断')) return 'v259熔断提价恢复';
  if (text.includes('零曝光') || text.includes('探索')) return '零曝光探索提价';
  if (text.includes('acos优秀') || text.includes('acos达标')) return 'ACOS达标微调提价';
  if (text.includes('低曝光零点击')) return '低曝光零点击探索';
  
  return '其他提价';
}

/**
 * 分类熔断触发原因
 */
function classifyCircuitBreakerReason(changeReason?: string | null): string {
  const text = (changeReason || '').toLowerCase();
  
  if (text.includes('累计降幅')) return '7天累计降幅超限';
  if (text.includes('连续') && text.includes('降价')) return '连续降价超限';
  if (text.includes('底线') || text.includes('bid_floor')) return '最低出价保护';
  if (text.includes('曝光保护')) return '曝光下降保护';
  
  return '其他熔断';
}

// ==================== 主入口函数 ====================

/**
 * 获取系统健康核心指标
 * 
 * 整合所有P0/P1监控指标，提供一站式健康评估
 */
export async function getSystemHealthMetrics(
  accountId: number,
  days: number = 7
): Promise<SystemHealthMetrics> {
  log.info(`[SystemHealth] 计算账户${accountId}的健康指标 (${days}天窗口)`);

  const [rollbackRate, algorithmActivation, acosTrend, bidIncreaseAnalysis, circuitBreakerRate] = await Promise.all([
    calculateRollbackRate(accountId, days),
    calculateAlgorithmActivation(accountId, days),
    calculateAcosTrend(accountId),
    calculateBidIncreaseAnalysis(accountId, days * 2), // 提价分析用更长窗口
    calculateCircuitBreakerRate(accountId, days),
  ]);

  const metrics: SystemHealthMetrics = {
    calculatedAt: new Date().toISOString(),
    accountId,
    rollbackRate,
    algorithmActivation,
    acosTrend,
    bidIncreaseAnalysis,
    circuitBreakerRate,
  };

  log.info(`[SystemHealth] 账户${accountId}健康指标: 回滚率=${rollbackRate.rate}%(${rollbackRate.status}), 高级算法=${algorithmActivation.advancedRate}%(${algorithmActivation.status}), ACoS趋势=${acosTrend.direction}(${acosTrend.currentAcos}%)`);

  return metrics;
}
