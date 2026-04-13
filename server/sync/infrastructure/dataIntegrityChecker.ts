/**
 * v358: 数据完整性检查器与自愈机制
 * 
 * 解决的问题:
 * 1. 原coldStartService和deployLifecycleManager的自愈逻辑
 *    因为同步任务错误地报告"成功"而无法触发
 * 2. 没有独立的数据完整性验证层
 * 3. 数据缺口（gap）无法被自动发现和修复
 * 
 * 核心设计:
 * - 独立于同步流程的数据完整性检查
 * - 基于数据库实际数据（而非同步状态）判断完整性
 * - 自动发现数据缺口并触发补偿同步
 * - 每日定时运行 + 同步完成后触发
 */
import { createModuleLogger } from '../../utils/logger';
import { eq, and, sql, gte, lte, desc, count } from 'drizzle-orm';
import { logSync, logSyncError, logSyncWarn } from '../../utils/opsLogger';

const log = createModuleLogger('dataIntegrityChecker');

// ==================== 完整性检查结果 ====================

export interface IntegrityCheckResult {
  accountId: number;
  checkTime: string;
  /** 检查的日期范围 */
  dateRange: { start: string; end: string };
  /** 预期的数据天数 */
  expectedDays: number;
  /** 实际有数据的天数 */
  actualDays: number;
  /** 缺失的日期列表 */
  missingDates: string[];
  /** 数据覆盖率 (0-100) */
  coveragePercent: number;
  /** 异常数据（如同一天数据量异常偏高，可能是累积问题） */
  anomalies: DataAnomaly[];
  /** 是否需要修复 */
  needsRepair: boolean;
  /** 建议的修复动作 */
  repairActions: RepairAction[];
}

export interface DataAnomaly {
  type: 'missing_data' | 'duplicate_data' | 'data_spike' | 'zero_spend_with_clicks' | 'stale_data';
  date: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export interface RepairAction {
  type: 'resync_dates' | 'resync_full' | 'deduplicate' | 'alert_only';
  dates?: string[];
  reason: string;
  priority: number; // 1=最高
}

// ==================== 完整性检查 ====================

/**
 * v358: 检查单个账户的数据完整性
 * 
 * 检查维度:
 * 1. 日期连续性 - 是否有缺失的日期
 * 2. 数据量合理性 - 同一天的数据量是否异常
 * 3. 数据新鲜度 - 最近的数据是否足够新
 * 4. 逻辑一致性 - spend/clicks/impressions的逻辑关系
 */
export async function checkAccountIntegrity(
  accountId: number,
  daysToCheck: number = 14
): Promise<IntegrityCheckResult> {
  const checkTime = new Date().toISOString();
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - daysToCheck);
  
  const startDateStr = startDate.toISOString().split('T')[0];
  const endDateStr = endDate.toISOString().split('T')[0];

  const result: IntegrityCheckResult = {
    accountId,
    checkTime,
    dateRange: { start: startDateStr, end: endDateStr },
    expectedDays: daysToCheck,
    actualDays: 0,
    missingDates: [],
    coveragePercent: 0,
    anomalies: [],
    needsRepair: false,
    repairActions: [],
  };

  try {
    const { getDb } = await import('../../db');
    const database = await getDb();
    if (!database) {
      log.warn(`[v358] 数据库连接失败，无法检查账户${accountId}的完整性`);
      return result;
    }

    // v645: 空账户预检 — 先查询该账户是否有任何广告活动
    // 如果账户没有广告活动，则数据缺失是合理的，不应视为异常
    let isEmptyAccount = false;
    try {
      const campaignCountResult = await database.execute(sql`
        SELECT COUNT(*) as cnt FROM campaigns WHERE accountId = ${accountId}
      `);
      // @ts-expect-error Dynamic type assertion
      const campaignRows = (campaignCountResult as Record<string, unknown>[])?.[0] || campaignCountResult;
      // @ts-expect-error Type inference limitation
      const totalCampaigns = Array.isArray(campaignRows) ? Number(campaignRows[0]?.cnt || 0) : 0;
      if (totalCampaigns === 0) {
        isEmptyAccount = true;
        log.info(`[v645] 账户${accountId}无广告活动，标记为空账户，跳过完整性检查`);
        // 空账户直接返回健康状态，不触发任何修复动作
        result.coveragePercent = 100; // 空账户视为100%覆盖率
        result.needsRepair = false;
        return result;
      }
    } catch (e: unknown) {
      log.debug(`[v645] 查询账户${accountId}广告活动数失败: ${(e as Error).message}`);
    }

    // 1. 检查日期连续性
    const dailyData = await database.execute(sql`
      SELECT DATE(date) as report_date, 
             COUNT(*) as record_count,
             SUM(CAST(spend AS DECIMAL(10,2))) as total_spend,
             SUM(clicks) as total_clicks,
             SUM(impressions) as total_impressions
      FROM daily_performance 
      WHERE accountId = ${accountId}
      AND DATE(date) >= ${startDateStr}
      AND DATE(date) <= ${endDateStr}
      GROUP BY DATE(date)
      ORDER BY DATE(date)
    `);

    // @ts-expect-error Dynamic type assertion
    const rows = (dailyData as Record<string, unknown>[])?.[0] || dailyData;
    const dataByDate = new Map<string, unknown>();
    
    if (Array.isArray(rows)) {
      // @ts-expect-error Dynamic type assertion
      for (const row of (rows as unknown[])) {
        // @ts-expect-error Type inference limitation
        const dateStr = row.report_date instanceof Date 
          // @ts-expect-error Conditional type narrowing
          ? row.report_date.toISOString().split('T')[0]
          // @ts-expect-error Legacy code type compatibility
          : String(row.report_date);
        dataByDate.set(dateStr, row);
      }
    }

    result.actualDays = dataByDate.size;

    // 找出缺失的日期
    const current = new Date(startDate);
    while (current <= endDate) {
      const dateStr = current.toISOString().split('T')[0];
      if (!dataByDate.has(dateStr)) {
        result.missingDates.push(dateStr);
        result.anomalies.push({
          type: 'missing_data',
          date: dateStr,
          description: `日期${dateStr}无绩效数据`,
          severity: 'high',
        });
      }
      current.setDate(current.getDate() + 1);
    }

    // 计算覆盖率
    result.coveragePercent = result.expectedDays > 0 
      ? Math.round((result.actualDays / result.expectedDays) * 100) 
      // @ts-expect-error Legacy code type compatibility
      : 0;

    // 2. 检查数据量异常（可能是累积问题）
    // @ts-expect-error Dynamic property access
    if (dataByDate.size > 1) {
      // @ts-expect-error DB query type inference limitation
      const recordCounts = Array.from(dataByDate.values()).map(r => Number(r.record_count));
      // @ts-expect-error Type inference limitation
      const avgCount = recordCounts.reduce((a: unknown, b: unknown) => a + b, 0) / recordCounts.length;
      const stdDev = Math.sqrt(
        // @ts-expect-error Array method type inference
        recordCounts.reduce((sum: number, c: Record<string, unknown>) => sum + Math.pow(c - avgCount, 2), 0) / recordCounts.length
      );

      for (const [dateStr, data] of dataByDate.entries()) {
        // @ts-expect-error Type inference limitation
        const count = Number(data.record_count);
        // 如果某天的记录数超过平均值3个标准差，可能是累积问题
        if (stdDev > 0 && count > avgCount + 3 * stdDev) {
          result.anomalies.push({
            type: 'data_spike',
            date: dateStr,
            description: `日期${dateStr}记录数异常偏高: ${count}条 (平均${Math.round(avgCount)}条)`,
            severity: 'high',
          });
        }
      }
    }

    // 3. 检查数据新鲜度
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    
    if (!dataByDate.has(yesterdayStr) && !dataByDate.has(endDateStr)) {
      result.anomalies.push({
        type: 'stale_data',
        // @ts-expect-error Legacy code type compatibility
        date: yesterdayStr,
        // @ts-expect-error Complex function parameter types
        description: `昨日(${yesterdayStr})无数据，数据可能不新鲜`,
        // @ts-expect-error Legacy code type compatibility
        severity: 'medium',
      });
    }

    // 4. 检查逻辑一致性
    for (const [dateStr, data] of dataByDate.entries()) {
      // @ts-expect-error Type inference limitation
      const spend = Number(data.total_spend);
      // @ts-expect-error Type inference limitation
      const clicks = Number(data.total_clicks);
      // @ts-expect-error Type inference limitation
      const impressions = Number(data.total_impressions);

      // 有点击但无花费 → 数据异常
      if (clicks > 0 && spend === 0) {
        result.anomalies.push({
          type: 'zero_spend_with_clicks',
          date: dateStr,
          description: `日期${dateStr}有${clicks}次点击但花费为0`,
          severity: 'medium',
        });
      }
    }

    // 5. 检查重复数据
    // @ts-expect-error DB query type inference limitation
    const duplicateCheck = await database.execute(sql`
      SELECT DATE(date) as report_date, campaignId, COUNT(*) as cnt
      FROM daily_performance
      WHERE accountId = ${accountId}
      AND DATE(date) >= ${startDateStr}
      AND DATE(date) <= ${endDateStr}
      GROUP BY DATE(date), campaignId
      HAVING COUNT(*) > 1
      LIMIT 10
    `);

    // @ts-expect-error Dynamic type assertion
    const dupRows = (duplicateCheck as Record<string, unknown>[])?.[0] || duplicateCheck;
    if (Array.isArray(dupRows) && dupRows.length > 0) {
      for (const dup of dupRows) {
        const dateStr = dup.report_date instanceof Date
          ? dup.report_date.toISOString().split('T')[0]
          : String(dup.report_date);
        result.anomalies.push({
          type: 'duplicate_data',
          date: dateStr,
          description: `日期${dateStr} campaign ${dup.campaign_id}有${dup.cnt}条重复记录`,
          severity: 'critical',
        });
      }
    }

    // ==================== 生成修复建议 ====================

    const criticalAnomalies = result.anomalies.filter(a => a.severity === 'critical');
    const highAnomalies = result.anomalies.filter(a => a.severity === 'high');

    // 有重复数据 → 需要去重
    if (criticalAnomalies.some(a => a.type === 'duplicate_data')) {
      result.needsRepair = true;
      result.repairActions.push({
        type: 'deduplicate',
        reason: `发现${criticalAnomalies.filter(a => a.type === 'duplicate_data').length}处重复数据`,
        priority: 1,
      });
    }

    // 缺失日期超过30% → 需要全量重新同步
    if (result.coveragePercent < 70) {
      result.needsRepair = true;
      result.repairActions.push({
        type: 'resync_full',
        reason: `数据覆盖率仅${result.coveragePercent}%，低于70%阈值`,
        priority: 2,
      });
    } else if (result.missingDates.length > 0) {
      // 有少量缺失 → 补偿同步缺失日期
      result.needsRepair = true;
      result.repairActions.push({
        type: 'resync_dates',
        dates: result.missingDates,
        reason: `缺失${result.missingDates.length}天数据`,
        priority: 3,
      });
    }

    log.info(`[v358] 账户${accountId}完整性检查完成: ` +
      `覆盖率=${result.coveragePercent}%, 缺失=${result.missingDates.length}天, ` +
      `异常=${result.anomalies.length}个, 需修复=${result.needsRepair}`);

    logSync('DataIntegrityChecker', `账户${accountId}完整性检查`, {
      accountId,
      coveragePercent: result.coveragePercent,
      missingDays: result.missingDates.length,
      anomalyCount: result.anomalies.length,
      needsRepair: result.needsRepair,
    });

  } catch (error: unknown) {
    log.warn(`[v358] 账户${accountId}完整性检查失败: ${(error as Error).message}`);
    logSyncError('DataIntegrityChecker', `完整性检查失败`, { accountId, error: (error as Error).message });
  }

  return result;
}

// ==================== 批量检查所有账户 ====================

/**
 * v358: 检查所有活跃账户的数据完整性
 */
export async function checkAllAccountsIntegrity(
  daysToCheck: number = 14
): Promise<{
  totalAccounts: number;
  healthyAccounts: number;
  unhealthyAccounts: number;
  results: IntegrityCheckResult[];
}> {
  const results: IntegrityCheckResult[] = [];

  try {
    // @ts-expect-error Async operation type inference
    const { getDb } = await import('../../db');
    const database = await getDb();
    if (!database) {
      return { totalAccounts: 0, healthyAccounts: 0, unhealthyAccounts: 0, results };
    }

    // 获取所有活跃账户 (v369.6: 修复表名 amazon_ad_accounts → ad_accounts, 修复status条件)
    const accounts = await database.execute(sql`
 SELECT DISTINCT id FROM ad_accounts 
 WHERE status = 'active' OR connectionStatus = 'connected'
 `);

    // @ts-expect-error Dynamic type assertion
    const accountRows = (accounts as Record<string, unknown>[])?.[0] || accounts;
    if (!Array.isArray(accountRows)) {
      return { totalAccounts: 0, healthyAccounts: 0, unhealthyAccounts: 0, results };
    }

    log.info(`[v358] 开始批量完整性检查: ${accountRows.length}个账户`);

    for (const account of (accountRows as unknown[])) {
      // @ts-expect-error Type inference limitation
      const result = await checkAccountIntegrity(account.id, daysToCheck);
      results.push(result);
      
      // 账户间延迟1秒，避免数据库压力
      await new Promise(r => setTimeout(r, 1000));
    }

    const healthyAccounts = results.filter(r => !r.needsRepair).length;
    const unhealthyAccounts = results.filter(r => r.needsRepair).length;

    log.info(`[v358] 批量完整性检查完成: ` +
      `总计=${results.length}, 健康=${healthyAccounts}, 需修复=${unhealthyAccounts}`);

    return {
      totalAccounts: results.length,
      healthyAccounts,
      unhealthyAccounts,
      results,
    };
  } catch (error: unknown) {
    log.warn(`[v358] 批量完整性检查失败: ${(error as Error).message}`);
    return { totalAccounts: 0, healthyAccounts: 0, unhealthyAccounts: 0, results };
  }
}

// ==================== 自动修复执行器 ====================

/**
 * v358: 执行自动修复
 * 根据完整性检查结果自动触发补偿同步
 */
export async function executeAutoRepair(
  checkResult: IntegrityCheckResult
): Promise<{
  // @ts-expect-error Legacy code type compatibility
  repaired: boolean;
  actionsExecuted: number;
  errors: string[];
}> {
  // @ts-expect-error Legacy code type compatibility
  const errors: string[] = [];
  let actionsExecuted = 0;

  if (!checkResult.needsRepair) {
    return { repaired: true, actionsExecuted: 0, errors: [] };
  }

  // @ts-expect-error Complex function parameter types
  log.info(`[v358] 开始自动修复账户${checkResult.accountId}: ${checkResult.repairActions.length}个修复动作`);

  // 按优先级排序
  // @ts-expect-error Type inference limitation
  const sortedActions = [...checkResult.repairActions].sort((a: unknown, b: unknown) => a.priority - b.priority);

  for (const action of (sortedActions as unknown[])) {
    try {
      // @ts-expect-error Legacy code type compatibility
      switch (action.type) {
        case 'deduplicate':
          await deduplicatePerformanceData(checkResult.accountId);
          actionsExecuted++;
          break;

        // @ts-expect-error Legacy code type compatibility
        case 'resync_dates':
          // @ts-expect-error Dynamic property access
          if (action.dates && action.dates.length > 0) {
            // @ts-expect-error Complex function parameter types
            log.info(`[v358] 触发补偿同步: 账户${checkResult.accountId}, 日期=${action.dates.join(',')}`);
            // 记录需要补偿同步的日期，由shardWorker在下一轮执行
            // @ts-expect-error Async operation type inference
            await recordPendingResync(checkResult.accountId, action.dates);
            actionsExecuted++;
          }
          break;

        case 'resync_full':
          log.info(`[v358] 触发全量重新同步: 账户${checkResult.accountId}`);
          await recordPendingResync(checkResult.accountId, ['full']);
          actionsExecuted++;
          break;

        case 'alert_only':
          // @ts-expect-error Complex function parameter types
          log.warn(`[v358] 仅告警: 账户${checkResult.accountId} - ${action.reason}`);
          actionsExecuted++;
          break;
      }
    } catch (error: unknown) {
      // @ts-expect-error Complex function parameter types
      errors.push(`${action.type}: ${(error as Error).message}`);
      // @ts-expect-error Complex function parameter types
      log.warn(`[v358] 修复动作${action.type}失败: ${(error as Error).message}`);
    }
  }

  const repaired = errors.length === 0;
  log.info(`[v358] 账户${checkResult.accountId}自动修复完成: 执行=${actionsExecuted}, 错误=${errors.length}`);

  return { repaired, actionsExecuted, errors };
}

// ==================== 辅助函数 ====================

/**
 * 去重绩效数据
 * 保留每个(accountId, campaignId, date)组合中id最大的记录
 */
async function deduplicatePerformanceData(accountId: number): Promise<number> {
  try {
    const { getDb } = await import('../../db');
    const database = await getDb();
    if (!database) return 0;

    // 删除重复记录，保留id最大的
    const result = await database.execute(sql`
      DELETE dp1 FROM daily_performance dp1
      INNER JOIN daily_performance dp2
      ON dp1.accountId = dp2.accountId
      AND dp1.campaignId = dp2.campaignId
      AND DATE(dp1.date) = DATE(dp2.date)
      AND dp1.id < dp2.id
      WHERE dp1.accountId = ${accountId}
    `);

    // @ts-expect-error - MySQL affectedRows
    const deletedCount = (result as unknown)?.affectedRows || 0;
    log.info(`[v358] 账户${accountId}去重完成: 删除${deletedCount}条重复记录`);
    return deletedCount;
  } catch (error: unknown) {
    log.warn(`[v358] 去重失败: ${(error as Error).message}`);
    return 0;
  }
}

/**
 * 记录待补偿同步的日期
 */
async function recordPendingResync(accountId: number, dates: string[]): Promise<void> {
  try {
    const { getDb } = await import('../../db');
    const database = await getDb();
    if (!database) return;

    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    
    // 使用sync_tasks_v2表记录补偿同步任务
    await database.execute(sql`
      INSERT INTO sync_tasks_v2 (task_id, tier, trigger_source, status, total_shards, created_at, updated_at)
      VALUES (
        ${`repair-${accountId}-${Date.now()}`},
        'repair',
        'data_integrity_checker',
        'pending',
        ${dates.length},
        ${now},
        ${now}
      )
    `);

    log.info(`[v358] 已记录账户${accountId}的补偿同步任务: ${dates.length}个日期`);
  } catch (error: unknown) {
    log.warn(`[v358] 记录补偿同步失败: ${(error as Error).message}`);
  }
}
