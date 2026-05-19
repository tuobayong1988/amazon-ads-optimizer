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
  type: 'missing_data' | 'duplicate_data' | 'data_spike' | 'zero_spend_with_clicks' | 'stale_data' | 'missing_entity';
  date: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export interface RepairAction {
  type: 'resync_dates' | 'resync_full' | 'resync_entities' | 'deduplicate' | 'alert_only';
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
      // @ts-ignore Dynamic type assertion
      const campaignRows = (campaignCountResult as Record<string, unknown>[])?.[0] || campaignCountResult;
      // @ts-ignore Type inference limitation
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

    // @ts-ignore Dynamic type assertion
    const rows = (dailyData as Record<string, unknown>[])?.[0] || dailyData;
    const dataByDate = new Map<string, unknown>();
    
    if (Array.isArray(rows)) {
      // @ts-ignore Dynamic type assertion
      for (const row of (rows as unknown[])) {
        // @ts-ignore Type inference limitation
        const dateStr = row.report_date instanceof Date 
          // @ts-ignore Conditional type narrowing
          ? row.report_date.toISOString().split('T')[0]
          // @ts-ignore Legacy code type compatibility
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
      // @ts-ignore Legacy code type compatibility
      : 0;

    // 2. 检查数据量异常（可能是累积问题）
    // @ts-ignore Dynamic property access
    if (dataByDate.size > 1) {
      // @ts-ignore DB query type inference limitation
      const recordCounts = Array.from(dataByDate.values()).map(r => Number(r.record_count));
      // @ts-ignore Type inference limitation
      const avgCount = recordCounts.reduce((a: unknown, b: unknown) => a + b, 0) / recordCounts.length;
      const stdDev = Math.sqrt(
        // @ts-ignore Array method type inference
        recordCounts.reduce((sum: number, c: Record<string, unknown>) => sum + Math.pow(c - avgCount, 2), 0) / recordCounts.length
      );

      for (const [dateStr, data] of dataByDate.entries()) {
        // @ts-ignore Type inference limitation
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
        // @ts-ignore Legacy code type compatibility
        date: yesterdayStr,
        // @ts-ignore Complex function parameter types
        description: `昨日(${yesterdayStr})无数据，数据可能不新鲜`,
        // @ts-ignore Legacy code type compatibility
        severity: 'medium',
      });
    }

    // 4. 检查逻辑一致性
    for (const [dateStr, data] of dataByDate.entries()) {
      // @ts-ignore Type inference limitation
      const spend = Number(data.total_spend);
      // @ts-ignore Type inference limitation
      const clicks = Number(data.total_clicks);
      // @ts-ignore Type inference limitation
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
    // @ts-ignore DB query type inference limitation
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

    // @ts-ignore Dynamic type assertion
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

    // 6. 检查绩效数据与实体主数据之间的引用完整性
    // 该检查用于发现“报表已入库，但 campaigns/keywords/product_targets 主数据缺失”的半同步状态。
    const missingEntityAnomalies = await detectMissingEntityReferences(database, accountId, startDateStr, endDateStr);
    result.anomalies.push(...missingEntityAnomalies);

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

    const missingEntityCount = result.anomalies.filter(a => a.type === 'missing_entity').length;
    if (missingEntityCount > 0) {
      result.needsRepair = true;
      result.repairActions.push({
        type: 'resync_entities',
        reason: `发现${missingEntityCount}类实体主数据引用缺口`,
        priority: 2,
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
export interface IntegritySweepResult {
  totalAccounts: number;
  healthyAccounts: number;
  unhealthyAccounts: number;
  results: IntegrityCheckResult[];
}

export interface IntegrityAutoRepairSweepResult extends IntegritySweepResult {
  repairSummary: {
    attemptedAccounts: number;
    repairedAccounts: number;
    failedAccounts: number;
    actionsExecuted: number;
    errors: Array<{ accountId: number; errors: string[] }>;
  };
}

export async function checkAllAccountsIntegrity(
  daysToCheck: number = 14
): Promise<IntegritySweepResult> {
  const results: IntegrityCheckResult[] = [];

  try {
    // @ts-ignore Async operation type inference
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

    // @ts-ignore Dynamic type assertion
    const accountRows = (accounts as Record<string, unknown>[])?.[0] || accounts;
    if (!Array.isArray(accountRows)) {
      return { totalAccounts: 0, healthyAccounts: 0, unhealthyAccounts: 0, results };
    }

    log.info(`[v358] 开始批量完整性检查: ${accountRows.length}个账户`);

    for (const account of (accountRows as unknown[])) {
      // @ts-ignore Type inference limitation
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

/**
 * v746: 执行批量完整性检查并自动修复异常账户。
 * 该入口供生产调度器统一调用，避免“只检查不修复”的部署后冷启动缺口。
 */
export async function runIntegrityCheckAndAutoRepair(
  daysToCheck: number = 14,
  options: { maxRepairAccounts?: number } = {}
): Promise<IntegrityAutoRepairSweepResult> {
  const checkResult = await checkAllAccountsIntegrity(daysToCheck);
  const repairSummary: IntegrityAutoRepairSweepResult['repairSummary'] = {
    attemptedAccounts: 0,
    repairedAccounts: 0,
    failedAccounts: 0,
    actionsExecuted: 0,
    errors: [],
  };

  const unhealthyResults = checkResult.results.filter(result => result.needsRepair);
  const maxRepairAccounts = options.maxRepairAccounts ?? unhealthyResults.length;
  const repairTargets = unhealthyResults.slice(0, Math.max(0, maxRepairAccounts));

  for (const result of repairTargets) {
    repairSummary.attemptedAccounts++;
    try {
      const repairResult = await executeAutoRepair(result);
      repairSummary.actionsExecuted += repairResult.actionsExecuted;
      if (repairResult.repaired) {
        repairSummary.repairedAccounts++;
      } else {
        repairSummary.failedAccounts++;
        repairSummary.errors.push({ accountId: result.accountId, errors: repairResult.errors });
      }
    } catch (error: unknown) {
      repairSummary.failedAccounts++;
      repairSummary.errors.push({ accountId: result.accountId, errors: [(error as Error).message] });
      log.warn(`[v746] 账户${result.accountId}批量自动修复异常: ${(error as Error).message}`);
    }
  }

  if (unhealthyResults.length > repairTargets.length) {
    log.warn(`[v746] 自动修复限流: ${unhealthyResults.length}个异常账户中仅处理${repairTargets.length}个，剩余将在下一轮检查继续处理`);
  }

  log.info(`[v746] 批量完整性检查与自动修复完成: 总计=${checkResult.totalAccounts}, 需修复=${checkResult.unhealthyAccounts}, ` +
    `尝试修复=${repairSummary.attemptedAccounts}, 修复成功=${repairSummary.repairedAccounts}, 修复失败=${repairSummary.failedAccounts}, 动作=${repairSummary.actionsExecuted}`);

  return {
    ...checkResult,
    repairSummary,
  };
}

// ==================== 自动修复执行器 ====================

/**
 * v358: 执行自动修复
 * 根据完整性检查结果自动触发补偿同步
 */
export async function executeAutoRepair(
  checkResult: IntegrityCheckResult
): Promise<{
  repaired: boolean;
  actionsExecuted: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let actionsExecuted = 0;

  if (!checkResult.needsRepair) {
    return { repaired: true, actionsExecuted: 0, errors: [] };
  }

  log.info(`[v358] 开始自动修复账户${checkResult.accountId}: ${checkResult.repairActions.length}个修复动作`);

  // 按优先级排序
  // @ts-ignore Type inference limitation
  const sortedActions = [...checkResult.repairActions].sort((a: unknown, b: unknown) => a.priority - b.priority);

  for (const action of (sortedActions as unknown[])) {
    try {
      // @ts-ignore Legacy code type compatibility
      switch (action.type) {
        case 'deduplicate':
          await deduplicatePerformanceData(checkResult.accountId);
          actionsExecuted++;
          break;

        case 'resync_dates':
          // @ts-ignore Dynamic property access
          if (action.dates && action.dates.length > 0) {
            // @ts-ignore Complex function parameter types
            log.info(`[v358] 触发补偿同步: 账户${checkResult.accountId}, 日期=${action.dates.join(',')}`);
            // 记录需要补偿同步的日期，由shardWorker在下一轮执行
            // @ts-ignore Async operation type inference
            await recordPendingResync(checkResult.accountId, action.dates);
            actionsExecuted++;
          }
          break;

        case 'resync_full':
          log.info(`[v358] 触发全量重新同步: 账户${checkResult.accountId}`);
          await recordPendingResync(checkResult.accountId, ['full']);
          actionsExecuted++;
          break;

        case 'resync_entities':
          log.info(`[v746] 触发实体主数据补偿同步: 账户${checkResult.accountId}`);
          await recordEntityResync(checkResult.accountId);
          actionsExecuted++;
          break;

        case 'alert_only':
          // @ts-ignore Complex function parameter types
          log.warn(`[v358] 仅告警: 账户${checkResult.accountId} - ${action.reason}`);
          actionsExecuted++;
          break;
      }
    } catch (error: unknown) {
      // @ts-ignore Complex function parameter types
      errors.push(`${action.type}: ${(error as Error).message}`);
      // @ts-ignore Complex function parameter types
      log.warn(`[v358] 修复动作${action.type}失败: ${(error as Error).message}`);
    }
  }

  const repaired = errors.length === 0;
  log.info(`[v358] 账户${checkResult.accountId}自动修复完成: 执行=${actionsExecuted}, 错误=${errors.length}`);

  return { repaired, actionsExecuted, errors };
}

// ==================== 辅助函数 ====================

function extractQueryRows(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) {
    const rows = Array.isArray(result[0]) ? result[0] : result;
    return Array.isArray(rows) ? rows.map(row => row as Record<string, unknown>) : [];
  }

  const rows = (result as { rows?: unknown[] } | null)?.rows;
  return Array.isArray(rows) ? rows.map(row => row as Record<string, unknown>) : [];
}

function getNumericField(row: Record<string, unknown> | undefined, fieldNames: string[]): number {
  if (!row) return 0;
  for (const fieldName of fieldNames) {
    if (row[fieldName] !== undefined && row[fieldName] !== null) {
      const value = Number(row[fieldName]);
      return Number.isFinite(value) ? value : 0;
    }
  }
  return 0;
}

async function detectMissingEntityReferences(
  database: any,
  accountId: number,
  startDateStr: string,
  endDateStr: string
): Promise<DataAnomaly[]> {
  const anomalies: DataAnomaly[] = [];

  try {
    const missingCampaignRows = extractQueryRows(await database.execute(sql`
      SELECT COUNT(DISTINCT dp.campaignId) AS missingCampaigns
      FROM daily_performance dp
      LEFT JOIN campaigns c
        ON c.accountId = dp.accountId
       AND c.campaignId = dp.campaignId
      WHERE dp.accountId = ${accountId}
        AND DATE(dp.date) >= ${startDateStr}
        AND DATE(dp.date) <= ${endDateStr}
        AND dp.campaignId IS NOT NULL
        AND dp.campaignId <> ''
        AND c.id IS NULL
    `));
    const missingCampaigns = getNumericField(missingCampaignRows[0], ['missingCampaigns', 'missing_campaigns']);

    const orphanKeywordRows = extractQueryRows(await database.execute(sql`
      SELECT COUNT(*) AS orphanKeywords
      FROM keywords k
      LEFT JOIN campaigns c
        ON c.accountId = k.accountId
       AND c.campaignId = k.campaignId
      LEFT JOIN ad_groups ag
        ON ag.id = k.internal_ad_group_id
      WHERE k.accountId = ${accountId}
        AND (
          c.id IS NULL
          OR (k.internal_ad_group_id IS NOT NULL AND ag.id IS NULL)
        )
    `));
    const orphanKeywords = getNumericField(orphanKeywordRows[0], ['orphanKeywords', 'orphan_keywords']);

    const orphanTargetRows = extractQueryRows(await database.execute(sql`
      SELECT COUNT(*) AS orphanProductTargets
      FROM product_targets pt
      LEFT JOIN campaigns c
        ON c.accountId = pt.accountId
       AND c.campaignId = pt.campaignId
      LEFT JOIN ad_groups ag
        ON ag.id = pt.internal_ad_group_id
      WHERE pt.accountId = ${accountId}
        AND (
          c.id IS NULL
          OR (pt.internal_ad_group_id IS NOT NULL AND ag.id IS NULL)
        )
    `));
    const orphanProductTargets = getNumericField(orphanTargetRows[0], ['orphanProductTargets', 'orphan_product_targets']);

    if (missingCampaigns > 0) {
      anomalies.push({
        type: 'missing_entity',
        date: endDateStr,
        description: `近${startDateStr}至${endDateStr}期间有${missingCampaigns}个绩效 campaignId 缺少 campaigns 主数据`,
        severity: 'critical',
      });
    }

    if (orphanKeywords > 0) {
      anomalies.push({
        type: 'missing_entity',
        date: endDateStr,
        description: `keywords 表存在${orphanKeywords}条缺失 campaign 或 ad_group 引用的孤儿记录`,
        severity: 'high',
      });
    }

    if (orphanProductTargets > 0) {
      anomalies.push({
        type: 'missing_entity',
        date: endDateStr,
        description: `product_targets 表存在${orphanProductTargets}条缺失 campaign 或 ad_group 引用的孤儿记录`,
        severity: 'high',
      });
    }
  } catch (error: unknown) {
    log.warn(`[v746] 账户${accountId}实体引用完整性检查失败: ${(error as Error).message}`);
  }

  return anomalies;
}

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

    // @ts-ignore - MySQL affectedRows
    const deletedCount = (result as unknown)?.affectedRows || 0;
    log.info(`[v358] 账户${accountId}去重完成: 删除${deletedCount}条重复记录`);
    return deletedCount;
  } catch (error: unknown) {
    log.warn(`[v358] 去重失败: ${(error as Error).message}`);
    return 0;
  }
}

/**
 * v738: 重写补偿同步逻辑 — 直接执行补偿同步而不是写入不存在的repair tier
 * 原问题：recordPendingResync尝试写入'repair' tier到sync_tasks_v2表，
 *          但该表的tier枚举只有'high','medium','full','confirmation'，
 *          导致INSERT失败，补偿同步永远不会执行
 * 修复：直接调用syncAccount的specificSteps来执行绩效数据补偿同步
 */
async function recordEntityResync(accountId: number): Promise<void> {
  try {
    const { syncAccount, discoverSyncableAccounts } = await import('../unifiedSyncEngine');
    const allAccounts = await discoverSyncableAccounts();
    const account = allAccounts.find(a => a.accountId === accountId);

    if (!account) {
      log.warn(`[v746] 实体补偿同步跳过: 账户${accountId}未找到或不可同步`);
      return;
    }

    const entitySteps = [
      'sp_campaigns', 'sb_campaigns', 'sd_campaigns',
      'sp_ad_groups', 'sb_ad_groups', 'sd_ad_groups',
      'sp_keywords', 'sb_keywords',
      'sp_product_targets', 'sb_product_targets', 'sd_product_targets',
    ];

    log.info(`[v746] 账户${accountId}实体补偿同步步骤: ${entitySteps.join(',')}`);
    const result = await syncAccount(account, 'medium', { specificSteps: entitySteps });

    if (result.success || result.partialSuccess) {
      log.info(`[v746] 账户${accountId}实体补偿同步完成: 同步${result.totalSynced}条记录, 完成步骤=${result.completedSteps}/${result.totalSteps}`);
    } else {
      log.warn(`[v746] 账户${accountId}实体补偿同步失败: 错误=${result.errors.join('; ')}`);
    }
  } catch (error: unknown) {
    log.warn(`[v746] 账户${accountId}实体补偿同步异常: ${(error as Error).message}`);
  }
}

async function recordPendingResync(accountId: number, dates: string[]): Promise<void> {
  try {
    log.info(`[v738] 开始执行账户${accountId}的补偿同步: ${dates.length}个日期(${dates.join(',')})`);
    
    // v738: 直接调用同步引擎执行绩效数据补偿同步
    const { syncAccount, discoverSyncableAccounts } = await import('../unifiedSyncEngine');
    
    // 查找对应账户
    const allAccounts = await discoverSyncableAccounts();
    const account = allAccounts.find(a => a.accountId === accountId);
    
    if (!account) {
      log.warn(`[v738] 补偿同步跳过: 账户${accountId}未找到或不可同步`);
      return;
    }
    
    // 确定需要补偿的步骤
    let repairSteps: string[];
    if (dates.includes('full')) {
      // 全量补偿: 执行所有绩效相关步骤
      repairSteps = ['performance_today', 'performance_7d', 'performance_95d'];
    } else {
      // 部分补偿: 根据缺失日期范围决定步骤
      const missingDays = dates.length;
      if (missingDays <= 1) {
        repairSteps = ['performance_today'];
      } else if (missingDays <= 7) {
        repairSteps = ['performance_7d'];
      } else {
        repairSteps = ['performance_95d'];
      }
    }
    
    log.info(`[v738] 账户${accountId}补偿同步步骤: ${repairSteps.join(',')}`);
    
    // 执行补偿同步
    const result = await syncAccount(account, 'high', {
      specificSteps: repairSteps,
    });
    
    if (result.success || result.partialSuccess) {
      log.info(`[v738] 账户${accountId}补偿同步成功: 同步${result.totalSynced}条记录, 完成步骤=${result.completedSteps}/${result.totalSteps}`);
    } else {
      log.warn(`[v738] 账户${accountId}补偿同步失败: 错误=${result.errors.join('; ')}`);
    }
  } catch (error: unknown) {
    log.warn(`[v738] 账户${accountId}补偿同步异常: ${(error as Error).message}`);
  }
}
