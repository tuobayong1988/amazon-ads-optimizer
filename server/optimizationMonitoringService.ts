/**
 * optimizationMonitoringService.ts
 * v263 - 自动化监控告警系统
 * 
 * 功能：
 * 1. 提价/降价比例监控 — 当提价/降价比例超过3:1时自动告警
 * 2. ACoS超标监控 — 当ACoS超标幅度超过50%时自动告警
 * 3. 同步成功率监控 — 当同步成功率低于100%时自动告警
 * 4. 算法健康度监控 — 检测算法是否正常运行
 * 5. 版本一致性检查 — 确保SYSTEM_VERSION与部署版本一致
 * 6. v263: 未分配广告活动监控
 * 7. v263: 主动风险预警（ACoS趋势恶化预警）
 */

import { getDb } from './db';
import * as dbService from './db';
import { optimizationEvents, optimizationLogs, adAccounts, campaigns, performanceGroups } from '../drizzle/schema';
import { eq, gte, and, sql, desc, isNull } from 'drizzle-orm';

// ============================================================
// 告警级别和类型定义
// ============================================================

export type AlertSeverity = 'info' | 'warning' | 'critical';
export type AlertCategory = 
  | 'bid_ratio_imbalance'
  | 'acos_overrun'
  | 'sync_failure'
  | 'algorithm_stall'
  | 'version_mismatch'
  | 'budget_overrun'
  | 'zero_optimization'
  | 'unassigned_campaigns'   // v263: 未分配广告活动告警
  | 'proactive_risk_warning'; // v263: 主动风险预警

export interface MonitoringAlert {
  id: string;
  category: AlertCategory;
  severity: AlertSeverity;
  title: string;
  message: string;
  metric: string;
  currentValue: number;
  threshold: number;
  recommendation: string;
  timestamp: Date;
  accountId?: number;
  accountName?: string;
}

export interface MonitoringReport {
  generatedAt: Date;
  systemVersion: number;
  alerts: MonitoringAlert[];
  metrics: {
    bidRaiseCount: number;
    bidLowerCount: number;
    bidRaiseToLowerRatio: number;
    avgAcosOverrun: number;
    syncSuccessRate: number;
    optimizationCount30d: number;
    positiveRate: number;
    activeAlgorithms: string[];
    highRiskAccounts: number;
  };
  healthScore: number; // 0-100
  status: 'healthy' | 'warning' | 'critical';
}

// ============================================================
// 告警阈值配置
// ============================================================

const ALERT_THRESHOLDS = {
  // 提价/降价比例超过此值触发告警
  bidRatioMax: 3.0,
  // ACoS超标幅度超过此百分比触发告警（如目标30%，实际超过45%即超标50%）
  acosOverrunPercent: 50,
  // 同步成功率低于此值触发告警
  syncSuccessRateMin: 100,
  // 30天内优化操作为0触发告警
  minOptimizationCount: 1,
  // 正向率低于此值触发警告
  minPositiveRate: 40,
  // 单账户ACoS超过目标的此倍数触发严重告警
  criticalAcosMultiplier: 2.0,
};

// ============================================================
// 核心监控函数
// ============================================================

/**
 * 生成完整的监控报告
 */
export async function generateMonitoringReport(teamId: number): Promise<MonitoringReport> {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const alerts: MonitoringAlert[] = [];
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  // 1. 检查提价/降价比例
  const bidMetrics = await checkBidRatio(db, teamId, thirtyDaysAgo, alerts);

  // 2. 检查ACoS超标情况
  const acosMetrics = await checkAcosOverrun(db, teamId, alerts);

  // 3. 检查同步成功率
  const syncMetrics = await checkSyncHealth(db, teamId, alerts);

  // 4. 检查算法运行状态
  const algorithmMetrics = await checkAlgorithmHealth(db, teamId, thirtyDaysAgo, alerts);

  // 5. 检查版本一致性
  await checkVersionConsistency(alerts);

  // v263: 新增检查项 — 未分配广告活动监控
  await checkUnassignedCampaigns(db, teamId, alerts);

  // v263: 新增检查项 — 主动风险预警（ACoS趋势恶化预警）
  await checkProactiveRiskWarning(db, teamId, alerts);

  // 计算综合健康分
  const healthScore = calculateHealthScore(alerts);
  const status = healthScore >= 80 ? 'healthy' : healthScore >= 50 ? 'warning' : 'critical';

  return {
    generatedAt: now,
    systemVersion: 263,
    alerts,
    metrics: {
      bidRaiseCount: bidMetrics.raiseCount,
      bidLowerCount: bidMetrics.lowerCount,
      bidRaiseToLowerRatio: bidMetrics.ratio,
      avgAcosOverrun: acosMetrics.avgOverrun,
      syncSuccessRate: syncMetrics.successRate,
      optimizationCount30d: algorithmMetrics.totalOps,
      positiveRate: algorithmMetrics.positiveRate,
      activeAlgorithms: algorithmMetrics.activeAlgorithms,
      highRiskAccounts: acosMetrics.highRiskCount,
    },
    healthScore,
    status,
  };
}

/**
 * 检查提价/降价比例
 * v263: 修复字段名 — direction→actionType, teamId→userId, eventType→eventCategory
 */
async function checkBidRatio(
  db: any,
  teamId: number,
  since: Date,
  alerts: MonitoringAlert[]
): Promise<{ raiseCount: number; lowerCount: number; ratio: number }> {
  try {
    const sinceStr = since.toISOString();
    // v263: 使用actionType (bid_increase/bid_decrease) 替代不存在的direction字段
    const result = await db.select({
      actionType: optimizationEvents.actionType,
      count: sql<number>`count(*)`,
    })
    .from(optimizationEvents)
    .where(
      and(
        eq(optimizationEvents.userId, teamId),
        gte(optimizationEvents.createdAt, sinceStr),
        sql`${optimizationEvents.eventCategory} = 'bid_adjustment'`
      )
    )
    .groupBy(optimizationEvents.actionType);

    let raiseCount = 0;
    let lowerCount = 0;
    for (const row of result) {
      if (row.actionType === 'bid_increase') raiseCount = Number(row.count);
      if (row.actionType === 'bid_decrease') lowerCount = Number(row.count);
    }

    const ratio = lowerCount > 0 ? raiseCount / lowerCount : raiseCount > 0 ? Infinity : 1;

    if (ratio > ALERT_THRESHOLDS.bidRatioMax) {
      alerts.push({
        id: `bid-ratio-${Date.now()}`,
        category: 'bid_ratio_imbalance',
        severity: ratio > 5 ? 'critical' : 'warning',
        title: '提价/降价比例失衡',
        message: `30天内提价${raiseCount}次，降价${lowerCount}次，比例${ratio.toFixed(1)}:1，超过安全阈值${ALERT_THRESHOLDS.bidRatioMax}:1`,
        metric: 'bid_raise_lower_ratio',
        currentValue: ratio,
        threshold: ALERT_THRESHOLDS.bidRatioMax,
        recommendation: '检查算法是否过度激进，考虑降低探索出价上限或切换到更保守的策略模板',
        timestamp: new Date(),
      });
    }

    return { raiseCount, lowerCount, ratio };
  } catch (e) {
    console.error('[MonitoringService] checkBidRatio error:', e);
    return { raiseCount: 0, lowerCount: 0, ratio: 1 };
  }
}

/**
 * 检查ACoS超标情况
 * v263: 修复字段名 — adAccountId→accountId, actualAcos/targetAcos→通过actionDetail JSON提取
 */
async function checkAcosOverrun(
  db: any,
  teamId: number,
  alerts: MonitoringAlert[]
): Promise<{ avgOverrun: number; highRiskCount: number }> {
  try {
    // 查询所有活跃账户的ACoS和目标ACoS
    const accounts = await db.select({
      id: adAccounts.id,
      name: adAccounts.accountName,
      marketplace: adAccounts.marketplace,
    })
    .from(adAccounts)
    .where(eq(adAccounts.userId, teamId));

    let totalOverrun = 0;
    let highRiskCount = 0;
    let accountCount = 0;

    // v263: 修复 — optimizationLogs没有actualAcos/targetAcos字段
    // 改为从actionDetail JSON中提取ACoS数据，或从performanceGroups获取目标ACoS
    for (const account of accounts) {
      // 从optimization_logs的actionDetail中提取最近的ACoS数据
      const latestLog = await db.select({
        actionDetail: optimizationLogs.actionDetail,
        previousValue: optimizationLogs.previousValue,
        newValue: optimizationLogs.newValue,
      })
      .from(optimizationLogs)
      .where(
        and(
          eq(optimizationLogs.accountId, account.id),
          sql`${optimizationLogs.logCategory} = 'bid_adjustment'`
        )
      )
      .orderBy(desc(optimizationLogs.createdAt))
      .limit(1);

      if (latestLog.length > 0 && latestLog[0].actionDetail) {
        try {
          const detail = JSON.parse(latestLog[0].actionDetail);
          const target = Number(detail.targetAcos || detail.target_acos || 0);
          const actual = Number(detail.actualAcos || detail.actual_acos || detail.currentAcos || 0);
          if (target > 0 && actual > 0) {
            const overrunPercent = ((actual - target) / target) * 100;
            totalOverrun += Math.max(0, overrunPercent);
            accountCount++;

            if (overrunPercent > ALERT_THRESHOLDS.acosOverrunPercent) {
              highRiskCount++;
              alerts.push({
                id: `acos-overrun-${account.id}-${Date.now()}`,
                category: 'acos_overrun',
                severity: actual > target * ALERT_THRESHOLDS.criticalAcosMultiplier ? 'critical' : 'warning',
                title: `${account.name} ${account.marketplace} ACoS严重超标`,
                message: `实际ACoS ${actual.toFixed(1)}%，目标${target.toFixed(1)}%，超标${overrunPercent.toFixed(0)}%`,
                metric: 'acos_overrun_percent',
                currentValue: overrunPercent,
                threshold: ALERT_THRESHOLDS.acosOverrunPercent,
                recommendation: overrunPercent > 100
                  ? '建议暂停该账户的高ACoS广告活动，切换到"利润优先"策略'
                  : '建议降低目标ACoS或检查关键词质量',
                timestamp: new Date(),
                accountId: account.id,
                accountName: `${account.name} ${account.marketplace}`,
              });
            }
          }
        } catch {
          // JSON解析失败，跳过
        }
      }
    }

    const avgOverrun = accountCount > 0 ? totalOverrun / accountCount : 0;
    return { avgOverrun, highRiskCount };
  } catch (e) {
    console.error('[MonitoringService] checkAcosOverrun error:', e);
    return { avgOverrun: 0, highRiskCount: 0 };
  }
}

/**
 * 检查同步健康度
 * v263: 修复字段名 — teamId→userId
 */
async function checkSyncHealth(
  db: any,
  teamId: number,
  alerts: MonitoringAlert[]
): Promise<{ successRate: number }> {
  try {
    const result = await db.select({
      status: optimizationEvents.apiSyncStatus,
      count: sql<number>`count(*)`,
    })
    .from(optimizationEvents)
    .where(
      and(
        eq(optimizationEvents.userId, teamId),
        sql`${optimizationEvents.apiSyncStatus} NOT IN ('not_applicable', 'invalid_legacy')`
      )
    )
    .groupBy(optimizationEvents.apiSyncStatus);

    let synced = 0;
    let total = 0;
    for (const row of result) {
      const count = Number(row.count);
      total += count;
      if (row.status === 'synced') synced += count;
    }

    const successRate = total > 0 ? (synced / total) * 100 : 100;

    if (successRate < ALERT_THRESHOLDS.syncSuccessRateMin) {
      alerts.push({
        id: `sync-health-${Date.now()}`,
        category: 'sync_failure',
        severity: successRate < 90 ? 'critical' : 'warning',
        title: '同步成功率低于100%',
        message: `同步成功率${successRate.toFixed(1)}%（${synced}/${total}），目标100%`,
        metric: 'sync_success_rate',
        currentValue: successRate,
        threshold: ALERT_THRESHOLDS.syncSuccessRateMin,
        recommendation: '检查Amazon API连接状态和失败事件的错误日志',
        timestamp: new Date(),
      });
    }

    return { successRate };
  } catch (e) {
    console.error('[MonitoringService] checkSyncHealth error:', e);
    return { successRate: 100 };
  }
}

/**
 * 检查算法运行健康度
 * v263: 修复字段名 — teamId→userId, eventType→eventCategory, isPositive→通过bid变化判断
 */
async function checkAlgorithmHealth(
  db: any,
  teamId: number,
  since: Date,
  alerts: MonitoringAlert[]
): Promise<{ totalOps: number; positiveRate: number; activeAlgorithms: string[] }> {
  try {
    const sinceStr = since.toISOString();
    // 查询30天内的优化操作总数
    const opsResult = await db.select({
      count: sql<number>`count(*)`,
    })
    .from(optimizationEvents)
    .where(
      and(
        eq(optimizationEvents.userId, teamId),
        gte(optimizationEvents.createdAt, sinceStr),
        sql`${optimizationEvents.eventCategory} = 'bid_adjustment'`
      )
    );

    const totalOps = Number(opsResult[0]?.count || 0);

    // v263: 查询正向操作 — 使用status='success'替代不存在的isPositive字段
    // 正向操作定义：成功执行的出价调整
    const positiveResult = await db.select({
      count: sql<number>`count(*)`,
    })
    .from(optimizationEvents)
    .where(
      and(
        eq(optimizationEvents.userId, teamId),
        gte(optimizationEvents.createdAt, sinceStr),
        sql`${optimizationEvents.eventCategory} = 'bid_adjustment'`,
        sql`${optimizationEvents.status} = 'success'`
      )
    );

    const positiveCount = Number(positiveResult[0]?.count || 0);
    const positiveRate = totalOps > 0 ? (positiveCount / totalOps) * 100 : 0;

    // 查询使用的算法类型
    const algorithmResult = await db.select({
      algorithm: optimizationEvents.algorithmVersion,
    })
    .from(optimizationEvents)
    .where(
      and(
        eq(optimizationEvents.userId, teamId),
        gte(optimizationEvents.createdAt, sinceStr),
        sql`${optimizationEvents.algorithmVersion} IS NOT NULL`
      )
    )
    .groupBy(optimizationEvents.algorithmVersion);

    const activeAlgorithms = algorithmResult
      .map((r: { algorithm: string | null }) => r.algorithm)
      .filter((a: string | null): a is string => a !== null);

    // 检查是否有优化操作
    if (totalOps === 0) {
      alerts.push({
        id: `zero-optimization-${Date.now()}`,
        category: 'zero_optimization',
        severity: 'critical',
        title: '30天内零优化操作',
        message: '系统在过去30天内未执行任何出价调整操作',
        metric: 'optimization_count_30d',
        currentValue: 0,
        threshold: ALERT_THRESHOLDS.minOptimizationCount,
        recommendation: '检查dataSyncScheduler是否正常运行，确认优化目标是否已配置',
        timestamp: new Date(),
      });
    }

    // 检查正向率
    if (totalOps > 10 && positiveRate < ALERT_THRESHOLDS.minPositiveRate) {
      alerts.push({
        id: `low-positive-rate-${Date.now()}`,
        category: 'algorithm_stall',
        severity: 'warning',
        title: '算法正向率偏低',
        message: `30天内${totalOps}次优化操作中，成功率仅${positiveRate.toFixed(1)}%，低于${ALERT_THRESHOLDS.minPositiveRate}%阈值`,
        metric: 'positive_rate',
        currentValue: positiveRate,
        threshold: ALERT_THRESHOLDS.minPositiveRate,
        recommendation: '检查规则引擎的出价策略是否过于激进，或数据质量是否存在问题',
        timestamp: new Date(),
      });
    }

    // 检查是否只有单一算法
    if (activeAlgorithms.length <= 1 && totalOps > 0) {
      alerts.push({
        id: `single-algorithm-${Date.now()}`,
        category: 'algorithm_stall',
        severity: 'info',
        title: '仅单一算法在运行',
        message: `当前仅${activeAlgorithms[0] || 'rule_engine'}在运行，高级算法（sigmoid_curve, linucb, cql）尚未激活`,
        metric: 'active_algorithm_count',
        currentValue: activeAlgorithms.length,
        threshold: 3,
        recommendation: '随着数据积累，高级算法应逐步被metaLearningSelector激活。如一个月后仍未激活，需进一步降低冷启动门槛',
        timestamp: new Date(),
      });
    }

    return { totalOps, positiveRate, activeAlgorithms };
  } catch (e) {
    console.error('[MonitoringService] checkAlgorithmHealth error:', e);
    return { totalOps: 0, positiveRate: 0, activeAlgorithms: [] };
  }
}

/**
 * 检查版本一致性
 * v263: 修复版本号比较 — 使用Number()确保类型一致
 */
async function checkVersionConsistency(alerts: MonitoringAlert[]): Promise<void> {
  try {
    // 检查SYSTEM_VERSION是否与预期一致
    const { SYSTEM_VERSION } = await import('./postDeployOptimizer');
    const { SYSTEM_VERSION: UTIL_VERSION } = await import('./utils/systemVersion');

    if (Number(SYSTEM_VERSION) !== Number(UTIL_VERSION)) {
      alerts.push({
        id: `version-mismatch-${Date.now()}`,
        category: 'version_mismatch',
        severity: 'critical',
        title: 'SYSTEM_VERSION不一致',
        message: `postDeployOptimizer.SYSTEM_VERSION=${SYSTEM_VERSION}，systemVersion.SYSTEM_VERSION=${UTIL_VERSION}`,
        metric: 'version_consistency',
        currentValue: 0,
        threshold: 1,
        recommendation: '立即同步两个文件中的SYSTEM_VERSION，确保版本号一致',
        timestamp: new Date(),
      });
    }
  } catch (e) {
    // 版本检查失败不阻塞其他监控
    console.warn('[MonitoringService] checkVersionConsistency error:', e);
  }
}

/**
 * v263: 检查未分配到优化目标的广告活动
 * 未分配的广告活动不会被任何优化算法管理，导致资源浪费和潜在风险
 */
async function checkUnassignedCampaigns(
  db: any,
  teamId: number,
  alerts: MonitoringAlert[]
): Promise<void> {
  try {
    // 查询所有未分配的活跃广告活动
    const unassigned = await db.select({
      id: campaigns.id,
      campaignName: campaigns.campaignName,
      campaignStatus: campaigns.campaignStatus,
      accountId: campaigns.accountId,
      dailyBudget: campaigns.dailyBudget,
    })
    .from(campaigns)
    .where(
      and(
        isNull(campaigns.performanceGroupId),
        eq(campaigns.campaignStatus, 'enabled')
      )
    );

    if (unassigned.length > 0) {
      const totalBudget = unassigned.reduce((sum: number, c: any) => sum + (Number(c.dailyBudget) || 0), 0);
      const severity: AlertSeverity = unassigned.length > 50 ? 'critical' : unassigned.length > 10 ? 'warning' : 'info';
      
      alerts.push({
        id: `unassigned-campaigns-${Date.now()}`,
        category: 'unassigned_campaigns',
        severity,
        title: `${unassigned.length}个活跃广告活动未分配优化目标`,
        message: `共${unassigned.length}个活跃广告活动未被分配到任何优化目标，日均预算合计$${totalBudget.toFixed(2)}，这些广告活动不会被任何优化算法管理`,
        metric: 'unassigned_campaign_count',
        currentValue: unassigned.length,
        threshold: 0,
        recommendation: '建议将这些广告活动分配到合适的优化目标，或创建新的优化目标进行管理',
        timestamp: new Date(),
      });
    }
  } catch (e) {
    console.error('[MonitoringService] checkUnassignedCampaigns error:', e);
  }
}

/**
 * v263: 主动风险预警 — 检测ACoS趋势恶化，在问题变严重之前发出预警
 * 核心逻辑：对比最近7天和前14天的ACoS，如果近7天ACoS比前14天恶化超过20%，发出预警
 */
async function checkProactiveRiskWarning(
  db: any,
  teamId: number,
  alerts: MonitoringAlert[]
): Promise<void> {
  try {
    const accounts = await db.select({
      id: adAccounts.id,
      name: adAccounts.accountName,
      marketplace: adAccounts.marketplace,
    })
    .from(adAccounts)
    .where(eq(adAccounts.userId, teamId));

    for (const account of accounts) {
      try {
        // 查询最近7天和前14天的ACoS
        const [recentResult] = await db.execute(
          sql`SELECT 
                SUM(CAST(spend AS DECIMAL(10,2))) as total_spend,
                SUM(CAST(sales AS DECIMAL(10,2))) as total_sales
              FROM daily_performance 
              WHERE account_id = ${account.id}
                AND date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)`
        ) as any;
        
        const [prevResult] = await db.execute(
          sql`SELECT 
                SUM(CAST(spend AS DECIMAL(10,2))) as total_spend,
                SUM(CAST(sales AS DECIMAL(10,2))) as total_sales
              FROM daily_performance 
              WHERE account_id = ${account.id}
                AND date >= DATE_SUB(CURDATE(), INTERVAL 21 DAY)
                AND date < DATE_SUB(CURDATE(), INTERVAL 7 DAY)`
        ) as any;

        const recentData = recentResult?.[0] || recentResult;
        const prevData = prevResult?.[0] || prevResult;
        
        const recentSpend = Number(recentData?.total_spend) || 0;
        const recentSales = Number(recentData?.total_sales) || 0;
        const prevSpend = Number(prevData?.total_spend) || 0;
        const prevSales = Number(prevData?.total_sales) || 0;

        if (recentSales > 0 && prevSales > 0) {
          const recentAcos = (recentSpend / recentSales) * 100;
          const prevAcos = (prevSpend / prevSales) * 100;
          const deterioration = prevAcos > 0 ? ((recentAcos - prevAcos) / prevAcos) * 100 : 0;

          if (deterioration > 20) {
            alerts.push({
              id: `proactive-risk-${account.id}-${Date.now()}`,
              category: 'proactive_risk_warning',
              severity: deterioration > 50 ? 'critical' : 'warning',
              title: `${account.name} ${account.marketplace} ACoS趋势恶化预警`,
              message: `最近7天ACoS ${recentAcos.toFixed(1)}%，比前14天(${prevAcos.toFixed(1)}%)恶化${deterioration.toFixed(0)}%，需提前干预`,
              metric: 'acos_deterioration_rate',
              currentValue: deterioration,
              threshold: 20,
              recommendation: `建议立即检查该账户的高ACoS关键词，考虑切换到更保守的策略模板或降低目标ACoS`,
              timestamp: new Date(),
              accountId: account.id,
              accountName: `${account.name} ${account.marketplace}`,
            });
          }
        }
      } catch (accountErr) {
        // 单个账户检查失败不影响其他账户
      }
    }
  } catch (e) {
    console.error('[MonitoringService] checkProactiveRiskWarning error:', e);
  }
}

/**
 * 计算综合健康分 (0-100)
 */
function calculateHealthScore(alerts: MonitoringAlert[]): number {
  let score = 100;

  for (const alert of alerts) {
    switch (alert.severity) {
      case 'critical':
        score -= 25;
        break;
      case 'warning':
        score -= 10;
        break;
      case 'info':
        score -= 3;
        break;
    }
  }

  return Math.max(0, Math.min(100, score));
}

/**
 * 格式化监控报告为可读文本（用于日志输出）
 */
export function formatMonitoringReport(report: MonitoringReport): string {
  const lines: string[] = [
    `\n========== 系统监控报告 ==========`,
    `生成时间: ${report.generatedAt.toISOString()}`,
    `系统版本: v${report.systemVersion}`,
    `健康评分: ${report.healthScore}/100 (${report.status.toUpperCase()})`,
    ``,
    `--- 核心指标 ---`,
    `提价次数: ${report.metrics.bidRaiseCount}`,
    `降价次数: ${report.metrics.bidLowerCount}`,
    `提价/降价比: ${report.metrics.bidRaiseToLowerRatio.toFixed(2)}:1`,
    `平均ACoS超标: ${report.metrics.avgAcosOverrun.toFixed(1)}%`,
    `同步成功率: ${report.metrics.syncSuccessRate.toFixed(1)}%`,
    `30天优化操作: ${report.metrics.optimizationCount30d}`,
    `正向率: ${report.metrics.positiveRate.toFixed(1)}%`,
    `活跃算法: ${report.metrics.activeAlgorithms.join(', ') || '无'}`,
    `高风险账户: ${report.metrics.highRiskAccounts}`,
  ];

  if (report.alerts.length > 0) {
    lines.push('', `--- 告警 (${report.alerts.length}) ---`);
    for (const alert of report.alerts) {
      const icon = alert.severity === 'critical' ? '[CRIT]' : alert.severity === 'warning' ? '[WARN]' : '[INFO]';
      lines.push(`${icon} [${alert.severity.toUpperCase()}] ${alert.title}`);
      lines.push(`   ${alert.message}`);
      lines.push(`   建议: ${alert.recommendation}`);
    }
  } else {
    lines.push('', '系统运行正常，无告警');
  }

  lines.push(`\n====================================\n`);
  return lines.join('\n');
}

/**
 * 运行监控检查并输出报告（由定时任务调用）
 */
export async function runMonitoringCheck(teamId: number): Promise<MonitoringReport> {
  console.log('[MonitoringService] Starting monitoring check for team', teamId);
  const report = await generateMonitoringReport(teamId);
  console.log(formatMonitoringReport(report));
  return report;
}
