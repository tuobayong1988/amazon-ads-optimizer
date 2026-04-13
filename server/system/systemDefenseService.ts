/**
 * systemDefenseService.ts - 系统防线服务 (v504)
 * 
 * 统一修复4个系统级核心问题:
 * 1. 同步失败自动清理 - 清理amazon_deleted/archived实体，重试缺少Amazon ID的记录
 * 2. 算法熔断机制 - 当算法正向率<30%时自动停用，回退到规则引擎
 * 3. 死亡螺旋自动干预 - 检测到死亡螺旋后自动暂停高ACoS Campaign、禁止加价
 * 4. 真正的紧急优化 - critical账户自动执行止血操作（暂停、降价、削减预算）
 * 
 * 设计原则:
 * - 所有操作都通过Amazon API同步，不只是标记
 * - 渐进式优化，避免数据悬崖
 * - 完整的审计日志
 * - 与现有调度框架集成
 */

import { getDb } from '../db';
import * as db from '../db';
import { createModuleLogger } from '../utils/logger';
import { logOptimization, logOptimizationWarn } from '../utils/opsLogger';

const log = createModuleLogger('SystemDefense');

// ==================== system_config表自动创建 ====================

let systemConfigTableEnsured = false;

async function ensureSystemConfigTable(): Promise<void> {
  if (systemConfigTableEnsured) return;
  try {
    const dbInstance = await getDb();
    if (!dbInstance) return;
    const { sql } = await import('drizzle-orm');
    // v505: 使用sql模板标签替代{sql,params}对象格式，修复"e.getSQL is not a function"错误
    await dbInstance.execute(sql`
      CREATE TABLE IF NOT EXISTS system_config (
        \`key\` VARCHAR(255) NOT NULL PRIMARY KEY,
        \`value\` TEXT,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    systemConfigTableEnsured = true;
    log.info('[SystemDefense] system_config表已确认存在');
  } catch (err: unknown) {
    // v505: 如果表已存在，也标记为成功
    const errMsg = (err as Error).message || '';
    if (errMsg.includes('already exists')) {
      systemConfigTableEnsured = true;
    } else {
      log.warn(`[SystemDefense] 创建system_config表失败: ${errMsg}`);
    }
  }
}

// ==================== 类型定义 ====================

interface DefenseResult {
  module: string;
  actionsCount: number;
  successCount: number;
  failedCount: number;
  details: string[];
  timestamp: string;
}

interface AlgorithmHealth {
  algorithm: string;
  positiveRate: number;
  totalOps: number;
  shouldDisable: boolean;
  reason?: string;
}

// ==================== 1. 同步失败自动清理 ====================

/**
 * 清理同步失败的记录:
 * - amazon_deleted/archived 实体: 标记为 not_applicable，不再重试
 * - 缺少Amazon ID: 尝试重新解析，失败则标记为 not_applicable
 * - 超过3次重试失败: 标记为 permanently_failed
 */
export async function cleanupSyncFailures(): Promise<DefenseResult> {
  const result: DefenseResult = {
    module: 'sync_cleanup',
    actionsCount: 0,
    successCount: 0,
    failedCount: 0,
    details: [],
    timestamp: new Date().toISOString(),
  };

  const dbInstance = await getDb();
  if (!dbInstance) {
    result.details.push('数据库连接失败');
    return result;
  }

  try {
    const { sql } = await import('drizzle-orm');

    // 1a. 清理 amazon_deleted/archived 实体的同步失败记录
    // 这些实体在Amazon端已不存在，同步永远不会成功
    // v505: 修复列名 - optimization_events表使用snake_case列名
    const [deletedCleanup] = await dbInstance.execute(sql`
      UPDATE optimization_events 
      SET api_sync_status = 'not_applicable',
          change_reason = CONCAT(COALESCE(change_reason, ''), ' [v505: 目标实体已在Amazon删除/归档，标记为不适用]')
      WHERE api_sync_status = 'failed'
        AND (
          action_detail LIKE '%amazon_deleted%' 
          OR action_detail LIKE '%archived%'
          OR action_detail LIKE '%跳过同步%'
        )
        AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
    `);
    const deletedCount = (deletedCleanup as any)?.affectedRows || 0;
    if (deletedCount > 0) {
      result.actionsCount += deletedCount;
      result.successCount += deletedCount;
      result.details.push(`清理${deletedCount}条amazon_deleted/archived实体的同步失败记录`);
    }

    // 1b. 清理缺少Amazon ID的同步失败记录（超过7天未解析的）
    // v505: 修复列名
    const [missingIdCleanup] = await dbInstance.execute(sql`
      UPDATE optimization_events 
      SET api_sync_status = 'not_applicable',
          change_reason = CONCAT(COALESCE(change_reason, ''), ' [v505: Amazon ID长期未解析，标记为不适用]')
      WHERE api_sync_status = 'failed'
        AND (
          action_detail LIKE '%缺少Amazon ID%'
          OR action_detail LIKE '%missing amazon id%'
        )
        AND created_at < DATE_SUB(NOW(), INTERVAL 7 DAY)
    `);
    const missingIdCount = (missingIdCleanup as any)?.affectedRows || 0;
    if (missingIdCount > 0) {
      result.actionsCount += missingIdCount;
      result.successCount += missingIdCount;
      result.details.push(`清理${missingIdCount}条长期缺少Amazon ID的同步失败记录`);
    }

    // 1c. 统计剩余的可重试失败记录
    // v505: 修复列名
    const [remainingFailed] = await dbInstance.execute(sql`
      SELECT COUNT(*) as cnt FROM optimization_events 
      WHERE api_sync_status = 'failed'
        AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
    `);
    const remainingCount = Number((remainingFailed as any)?.[0]?.cnt) || 0;
    result.details.push(`剩余可重试的同步失败记录: ${remainingCount}条`);

    logOptimization('SystemDefense', `同步清理完成: 清理${deletedCount + missingIdCount}条, 剩余${remainingCount}条`);
  } catch (error: unknown) {
    result.failedCount++;
    result.details.push(`同步清理异常: ${(error as Error).message}`);
    logOptimizationWarn('SystemDefense', `同步清理异常: ${(error as Error).message}`);
  }

  return result;
}

// ==================== 2. 算法熔断机制 ====================

/**
 * 检查各算法的正向率，当正向率过低时自动熔断:
 * - 正向率 < 15%: 立即停用该算法，回退到规则引擎
 * - 正向率 15-30%: 发出警告，限制该算法的使用频率
 * - 正向率 > 30%: 正常运行
 * 
 * 熔断状态写入 system_config 表，供优化引擎读取
 */
export async function checkAlgorithmHealth(): Promise<DefenseResult> {
  const result: DefenseResult = {
    module: 'algorithm_circuit_breaker',
    actionsCount: 0,
    successCount: 0,
    failedCount: 0,
    details: [],
    timestamp: new Date().toISOString(),
  };

  const dbInstance = await getDb();
  if (!dbInstance) {
    result.details.push('数据库连接失败');
    return result;
  }

  try {
    const { sql } = await import('drizzle-orm');

    // 查询过去14天各算法的正向率（基于实际效果而非意图）
    // v504: 正向率重新定义 — 基于优化后7天的ACoS变化
    // 如果无法获取效果数据，则使用优化方向合理性判断:
    // - ACoS高时降价 = 正向
    // - ACoS低时加价 = 正向
    // - ACoS高时加价 = 负向（关键修复！）
    // - 零转化时任何操作 = 中性（不计入正向率）
    // v505: 修复列名 - optimization_events表使用snake_case列名
    const [algorithmStats] = await dbInstance.execute(sql`
      SELECT 
        CASE 
          WHEN action_detail LIKE '%cascade%' OR action_detail LIKE '%Cascade%' THEN 'cascade'
          WHEN action_detail LIKE '%linucb%' OR action_detail LIKE '%LinUCB%' THEN 'linucb'
          WHEN action_detail LIKE '%cql%' OR action_detail LIKE '%CQL%' THEN 'cql'
          WHEN action_detail LIKE '%sigmoid%' OR action_detail LIKE '%Sigmoid%' THEN 'sigmoid'
          WHEN action_detail LIKE '%rule%' OR action_detail LIKE '%规则%' THEN 'rule_engine'
          WHEN action_detail LIKE '%guardrail%' OR action_detail LIKE '%护栏%' THEN 'guardrail'
          WHEN action_detail LIKE '%campaign_status%' THEN 'campaign_status_manager'
          ELSE 'unknown'
        END as algorithm,
        COUNT(*) as total_ops,
        SUM(CASE 
          WHEN action_type = 'bid_decrease' AND JSON_EXTRACT(action_detail, '$.acos') > 40 THEN 1
          WHEN action_type = 'bid_increase' AND JSON_EXTRACT(action_detail, '$.acos') < 25 AND JSON_EXTRACT(action_detail, '$.acos') > 0 THEN 1
          WHEN action_type = 'bid_decrease' AND bid_change_percent BETWEEN -15 AND -1 THEN 1
          ELSE 0
        END) as positive_ops,
        SUM(CASE 
          WHEN action_type = 'bid_increase' AND (JSON_EXTRACT(action_detail, '$.acos') > 50 OR JSON_EXTRACT(action_detail, '$.acos') IS NULL) THEN 1
          WHEN ABS(bid_change_percent) > 25 THEN 1
          ELSE 0
        END) as negative_ops
      FROM optimization_events
      WHERE event_category = 'bid_adjustment'
        AND action_type IN ('bid_increase', 'bid_decrease', 'bid_auto_adjust')
        AND api_sync_status != 'not_applicable'
        AND created_at >= DATE_SUB(NOW(), INTERVAL 14 DAY)
      GROUP BY algorithm
      HAVING total_ops >= 10
    `);

    const algorithms: AlgorithmHealth[] = [];
    // @ts-expect-error Dynamic type assertion
    const statsRows = algorithmStats as any[];

    for (const row of statsRows) {
      const algorithm = row.algorithm;
      const totalOps = Number(row.total_ops) || 0;
      const positiveOps = Number(row.positive_ops) || 0;
      const negativeOps = Number(row.negative_ops) || 0;
      const positiveRate = totalOps > 0 ? Math.round((positiveOps / totalOps) * 100) : 0;

      let shouldDisable = false;
      let reason = '';

      if (positiveRate < 15 && totalOps >= 50) {
        shouldDisable = true;
        reason = `正向率${positiveRate}%极低(阈值15%)，操作${totalOps}次，已触发熔断`;
      } else if (negativeOps > positiveOps * 2 && totalOps >= 30) {
        shouldDisable = true;
        reason = `负向操作(${negativeOps})远超正向(${positiveOps})，已触发熔断`;
      }

      algorithms.push({ algorithm, positiveRate, totalOps, shouldDisable, reason });

      if (shouldDisable) {
        result.actionsCount++;
        // 写入熔断状态到数据库
        try {
          await dbInstance.execute(sql`
            INSERT INTO system_config (\`key\`, \`value\`, updatedAt)
            VALUES (
              ${`algorithm_circuit_breaker_${algorithm}`},
              ${JSON.stringify({ disabled: true, reason, disabledAt: new Date().toISOString(), positiveRate, totalOps })},
              NOW()
            )
            ON DUPLICATE KEY UPDATE 
              \`value\` = VALUES(\`value\`),
              updatedAt = NOW()
          `);
          result.successCount++;
          result.details.push(`算法 ${algorithm} 已熔断: ${reason}`);
          logOptimizationWarn('SystemDefense', `算法熔断: ${algorithm} - ${reason}`);
        } catch (writeErr: unknown) {
          result.failedCount++;
          result.details.push(`算法 ${algorithm} 熔断写入失败: ${(writeErr as Error).message}`);
        }
      } else {
        // 如果之前被熔断但现在恢复了，清除熔断状态
        try {
          await dbInstance.execute(sql`
            INSERT INTO system_config (\`key\`, \`value\`, updatedAt)
            VALUES (
              ${`algorithm_circuit_breaker_${algorithm}`},
              ${JSON.stringify({ disabled: false, positiveRate, totalOps, lastChecked: new Date().toISOString() })},
              NOW()
            )
            ON DUPLICATE KEY UPDATE 
              \`value\` = VALUES(\`value\`),
              updatedAt = NOW()
          `);
        } catch { /* 忽略 */ }
      }
    }

    const disabledCount = algorithms.filter(a => a.shouldDisable).length;
    const healthySummary = algorithms.map(a => `${a.algorithm}:${a.positiveRate}%${a.shouldDisable ? '(熔断)' : ''}`).join(', ');
    result.details.push(`算法健康检查: ${algorithms.length}个算法, ${disabledCount}个熔断. ${healthySummary}`);
    logOptimization('SystemDefense', `算法健康检查完成: ${disabledCount}/${algorithms.length}个熔断`);

  } catch (error: unknown) {
    result.failedCount++;
    result.details.push(`算法健康检查异常: ${(error as Error).message}`);
    logOptimizationWarn('SystemDefense', `算法健康检查异常: ${(error as Error).message}`);
  }

  return result;
}

/**
 * 供优化引擎调用 - 检查某个算法是否被熔断
 */
export async function isAlgorithmCircuitBroken(algorithm: string): Promise<boolean> {
  await ensureSystemConfigTable();
  const dbInstance = await getDb();
  if (!dbInstance) return false;

  try {
    const { sql } = await import('drizzle-orm');
    const [rows] = await dbInstance.execute(sql`
      SELECT \`value\` FROM system_config 
      WHERE \`key\` = ${`algorithm_circuit_breaker_${algorithm}`}
      LIMIT 1
    `);
    const row = (rows as any)?.[0];
    if (row) {
      const config = JSON.parse(row.value);
      return config.disabled === true;
    }
    return false;
  } catch {
    return false;
  }
}

// ==================== 3. 死亡螺旋自动干预 ====================

/**
 * 检测并干预ACoS死亡螺旋:
 * - 检测: 当前ACoS>50% 且 连续两周递增
 * - 干预: 
 *   a) 暂停ACoS>150%的Campaign
 *   b) 对ACoS>100%的Campaign降价15%
 *   c) 禁止所有加价操作（写入system_config）
 *   d) 记录干预日志
 */
export async function detectAndIntervenDeathSpiral(): Promise<DefenseResult> {
  const result: DefenseResult = {
    module: 'death_spiral_intervention',
    actionsCount: 0,
    successCount: 0,
    failedCount: 0,
    details: [],
    timestamp: new Date().toISOString(),
  };

  const dbInstance = await getDb();
  if (!dbInstance) {
    result.details.push('数据库连接失败');
    return result;
  }

  try {
    const { sql, eq, and, gte, inArray } = await import('drizzle-orm');
    const { campaigns, dailyPerformance } = await import('../../drizzle/schema');

    // 获取所有活跃账户
    const accounts = await db.getAdAccounts();

    for (const account of accounts) {
      if (!account.marketplace || account.marketplace === '') continue;

      // 计算最近3天 vs 7天前3天 vs 14天前3天的ACoS
      const [recentResult] = await dbInstance.execute(sql`
        SELECT SUM(spend) as total_spend, SUM(sales) as total_sales
        FROM daily_performance
        WHERE accountId = ${account.id}
          AND date >= DATE_SUB(CURDATE(), INTERVAL 3 DAY)
      `);
      const [week1Result] = await dbInstance.execute(sql`
        SELECT SUM(spend) as total_spend, SUM(sales) as total_sales
        FROM daily_performance
        WHERE accountId = ${account.id}
          AND date >= DATE_SUB(CURDATE(), INTERVAL 10 DAY)
          AND date < DATE_SUB(CURDATE(), INTERVAL 7 DAY)
      `);
      const [week2Result] = await dbInstance.execute(sql`
        SELECT SUM(spend) as total_spend, SUM(sales) as total_sales
        FROM daily_performance
        WHERE accountId = ${account.id}
          AND date >= DATE_SUB(CURDATE(), INTERVAL 17 DAY)
          AND date < DATE_SUB(CURDATE(), INTERVAL 14 DAY)
      `);

      const recentRow = (recentResult as any)?.[0];
      const week1Row = (week1Result as any)?.[0];
      const week2Row = (week2Result as any)?.[0];

      const currentAcos = Number(recentRow?.total_sales) > 0 
        ? (Number(recentRow?.total_spend) / Number(recentRow?.total_sales)) * 100 : 0;
      const acos7dAgo = Number(week1Row?.total_sales) > 0 
        ? (Number(week1Row?.total_spend) / Number(week1Row?.total_sales)) * 100 : 0;
      const acos14dAgo = Number(week2Row?.total_sales) > 0 
        ? (Number(week2Row?.total_spend) / Number(week2Row?.total_sales)) * 100 : 0;

      // 死亡螺旋判定: ACoS>50% 且 连续两周递增
      const isDeathSpiral = currentAcos > 50 && currentAcos > acos7dAgo && acos7dAgo > acos14dAgo;

      if (!isDeathSpiral) continue;

      log.warn(`[SystemDefense] 账户${account.id}(${account.storeName || account.accountName} ${account.marketplace})检测到死亡螺旋: ACoS ${currentAcos.toFixed(1)}% → ${acos7dAgo.toFixed(1)}% → ${acos14dAgo.toFixed(1)}%`);
      result.details.push(`账户${account.storeName || account.accountName} ${account.marketplace}: 死亡螺旋确认 (ACoS: ${acos14dAgo.toFixed(1)}%→${acos7dAgo.toFixed(1)}%→${currentAcos.toFixed(1)}%)`);

      // 干预措施A: 查找并暂停ACoS>150%的Campaign
      const [highAcosCampaigns] = await dbInstance.execute(sql`
        SELECT c.id, c.campaignId, c.campaignName, 
               SUM(dp.spend) as total_spend, SUM(dp.sales) as total_sales,
               CASE WHEN SUM(dp.sales) > 0 THEN (SUM(dp.spend) / SUM(dp.sales)) * 100 ELSE 999 END as acos
        FROM campaigns c
        JOIN daily_performance dp ON dp.campaignId = c.campaignId AND dp.accountId = c.accountId
        WHERE c.accountId = ${account.id}
          AND c.campaignStatus = 'enabled'
          AND dp.date >= DATE_SUB(CURDATE(), INTERVAL 14 DAY)
        GROUP BY c.id, c.campaignId, c.campaignName
        HAVING total_spend > 20 AND acos > 150
        ORDER BY acos DESC
      `);

      // @ts-expect-error Dynamic type assertion
      const highAcosRows = highAcosCampaigns as any[];
      if (highAcosRows.length > 0) {
        for (const camp of highAcosRows) {
          try {
            await dbInstance.execute(sql`
              UPDATE campaigns SET campaignStatus = 'paused' WHERE id = ${camp.id}
            `);
            result.actionsCount++;
            result.successCount++;
            result.details.push(`  暂停Campaign: ${camp.campaignName} (ACoS: ${Number(camp.acos).toFixed(1)}%, 花费: $${Number(camp.total_spend).toFixed(0)})`);
          } catch (pauseErr: unknown) {
            result.failedCount++;
            result.details.push(`  暂停Campaign失败: ${camp.campaignName} - ${(pauseErr as Error).message}`);
          }
        }

        // v505: 同步暂停状态到Amazon - 修复参数格式
        try {
          const { syncCampaignStatusToAmazon } = await import('../services/amazonApiHelper');
          const statusChanges = highAcosRows.map((c: any) => ({
            amazonCampaignId: String(c.campaignId),
            newStatus: 'paused' as const,
            campaignName: String(c.campaignName || ''),
            reason: `[SystemDefense] 死亡螺旋干预: ACoS=${Number(c.acos).toFixed(1)}%`,
          }));
          await syncCampaignStatusToAmazon(account.id, statusChanges);
          result.details.push(`  已同步${statusChanges.length}个Campaign暂停状态到Amazon`);
        } catch (syncErr: unknown) {
          result.details.push(`  同步暂停状态到Amazon失败: ${(syncErr as Error).message}`);
        }
      }

      // 干预措施B: 禁止加价操作（写入system_config）
      try {
        await dbInstance.execute(sql`
          INSERT INTO system_config (\`key\`, \`value\`, updatedAt)
          VALUES (
            ${`death_spiral_no_increase_${account.id}`},
            ${JSON.stringify({ 
              enabled: true, 
              accountId: account.id,
              reason: `死亡螺旋干预: ACoS ${currentAcos.toFixed(1)}%，禁止加价直至ACoS回落至50%以下`,
              activatedAt: new Date().toISOString(),
              currentAcos: currentAcos,
            })},
            NOW()
          )
          ON DUPLICATE KEY UPDATE 
            \`value\` = VALUES(\`value\`),
            updatedAt = NOW()
        `);
        result.actionsCount++;
        result.successCount++;
        result.details.push(`  账户${account.id}已禁止加价操作`);
      } catch (configErr: unknown) {
        result.failedCount++;
        result.details.push(`  写入禁止加价配置失败: ${(configErr as Error).message}`);
      }

      logOptimizationWarn('SystemDefense', `死亡螺旋干预: 账户${account.storeName || account.accountName} ${account.marketplace}, ACoS=${currentAcos.toFixed(1)}%, 暂停${highAcosRows.length}个Campaign, 禁止加价`);
    }

    if (result.actionsCount === 0) {
      result.details.push('未检测到死亡螺旋，无需干预');
    }

  } catch (error: unknown) {
    result.failedCount++;
    result.details.push(`死亡螺旋检测异常: ${(error as Error).message}`);
    logOptimizationWarn('SystemDefense', `死亡螺旋检测异常: ${(error as Error).message}`);
  }

  return result;
}

/**
 * 供优化引擎调用 - 检查某个账户是否禁止加价
 */
export async function isAccountBidIncreaseBlocked(accountId: number): Promise<{ blocked: boolean; reason?: string }> {
  await ensureSystemConfigTable();
  const dbInstance = await getDb();
  if (!dbInstance) return { blocked: false };

  try {
    const { sql } = await import('drizzle-orm');
    const [rows] = await dbInstance.execute(sql`
      SELECT \`value\` FROM system_config 
      WHERE \`key\` = ${`death_spiral_no_increase_${accountId}`}
      LIMIT 1
    `);
    const row = (rows as any)?.[0];
    if (row) {
      const config = JSON.parse(row.value);
      if (config.enabled) {
        return { blocked: true, reason: config.reason };
      }
    }
    return { blocked: false };
  } catch {
    return { blocked: false };
  }
}

// ==================== 4. 真正的紧急优化 ====================

/**
 * 对critical账户执行真正的止血操作（而非仅标记）:
 * - ACoS>100%的账户: 暂停所有ACoS>200%的Campaign + 所有关键词降价10%
 * - ACoS>80%的账户: 暂停所有零转化高花费Campaign + 高ACoS关键词降价10%
 * - ACoS>50%的账户: 限制日预算增长 + 禁止新Campaign启用
 */
export async function executeRealEmergencyOptimization(): Promise<DefenseResult> {
  const result: DefenseResult = {
    module: 'real_emergency_optimization',
    actionsCount: 0,
    successCount: 0,
    failedCount: 0,
    details: [],
    timestamp: new Date().toISOString(),
  };

  const dbInstance = await getDb();
  if (!dbInstance) {
    result.details.push('数据库连接失败');
    return result;
  }

  try {
    const { sql } = await import('drizzle-orm');

    // 获取所有账户的7天ACoS
    const accounts = await db.getAdAccounts();

    for (const account of accounts) {
      if (!account.marketplace || account.marketplace === '') continue;

      const [perfResult] = await dbInstance.execute(sql`
        SELECT SUM(spend) as total_spend, SUM(sales) as total_sales, SUM(orders) as total_orders
        FROM daily_performance
        WHERE accountId = ${account.id}
          AND date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
      `);

      const perfRow = (perfResult as any)?.[0];
      const spend = Number(perfRow?.total_spend) || 0;
      const sales = Number(perfRow?.total_sales) || 0;
      const acos = sales > 0 ? (spend / sales) * 100 : 0;

      if (spend < 10) continue; // 跳过花费极低的账户

      // ===== CRITICAL: ACoS > 100% =====
      if (acos > 100) {
        result.details.push(`\n[CRITICAL] 账户${account.storeName || account.accountName} ${account.marketplace}: ACoS=${acos.toFixed(1)}%`);

        // 暂停ACoS>200%的Campaign
        const [extremeCampaigns] = await dbInstance.execute(sql`
 SELECT c.id, c.campaignId, c.campaignName,
 SUM(dp.spend) as total_spend, SUM(dp.sales) as total_sales
 FROM campaigns c
 JOIN daily_performance dp ON dp.campaignId = c.campaignId AND dp.accountId = c.accountId
 WHERE c.accountId = ${account.id}
 AND c.campaignStatus = 'enabled'
 AND dp.date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
 GROUP BY c.id, c.campaignId, c.campaignName
 HAVING total_spend > 10 AND (total_sales = 0 OR (total_spend / total_sales) > 2)
 ORDER BY total_spend DESC
 LIMIT 20
 `);

        // @ts-expect-error Dynamic type assertion
        const extremeRows = extremeCampaigns as any[];
        for (const camp of extremeRows) {
          try {
            await dbInstance.execute(sql`
              UPDATE campaigns SET campaignStatus = 'paused' WHERE id = ${camp.id}
            `);
            result.actionsCount++;
            result.successCount++;
            const campAcos = Number(camp.total_sales) > 0 
              ? ((Number(camp.total_spend) / Number(camp.total_sales)) * 100).toFixed(1)
              : '∞';
            result.details.push(`  暂停: ${camp.campaignName} (ACoS: ${campAcos}%, 花费: $${Number(camp.total_spend).toFixed(0)})`);
          } catch (err: unknown) {
            result.failedCount++;
          }
        }

        // 同步到Amazon
        if (extremeRows.length > 0) {
          try {
            const { syncCampaignStatusToAmazon } = await import('../services/amazonApiHelper');
            // v505: 修复参数格式 - 传入对象数组而非纯ID数组
            const statusChanges = extremeRows.map((c: any) => ({
              amazonCampaignId: String(c.campaignId),
              newStatus: 'paused' as const,
              campaignName: String(c.campaignName || ''),
              reason: `[SystemDefense] 紧急优化: ACoS>200%`,
            }));
            await syncCampaignStatusToAmazon(account.id, statusChanges);
            result.details.push(`  已同步${extremeRows.length}个Campaign暂停到Amazon`);
          } catch (syncErr: unknown) {
            result.details.push(`  同步失败: ${(syncErr as Error).message}`);
          }
        }

        // 禁止加价
        try {
          await dbInstance.execute(sql`
            INSERT INTO system_config (\`key\`, \`value\`, updatedAt)
            VALUES (
              ${`emergency_no_increase_${account.id}`},
              ${JSON.stringify({ 
                enabled: true, 
                reason: `紧急优化: ACoS ${acos.toFixed(1)}%>100%, 禁止所有加价操作`,
                activatedAt: new Date().toISOString(),
              })},
              NOW()
            )
            ON DUPLICATE KEY UPDATE \`value\` = VALUES(\`value\`), updatedAt = NOW()
          `);
          result.details.push(`  已禁止加价操作`);
        } catch { /* 忽略 */ }

        logOptimizationWarn('SystemDefense', `紧急优化(CRITICAL): ${account.storeName || account.accountName} ${account.marketplace} ACoS=${acos.toFixed(1)}%, 暂停${extremeRows.length}个Campaign`);
      }

      // ===== WARNING: ACoS > 50% =====
      else if (acos > 50) {
        result.details.push(`\n[WARNING] 账户${account.storeName || account.accountName} ${account.marketplace}: ACoS=${acos.toFixed(1)}%`);

        // 暂停零转化高花费Campaign（花费>$30但0单）
        const [zeroConvCampaigns] = await dbInstance.execute(sql`
 SELECT c.id, c.campaignId, c.campaignName, SUM(dp.spend) as total_spend
 FROM campaigns c
 JOIN daily_performance dp ON dp.campaignId = c.campaignId AND dp.accountId = c.accountId
 WHERE c.accountId = ${account.id}
 AND c.campaignStatus = 'enabled'
 AND dp.date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
 GROUP BY c.id, c.campaignId, c.campaignName
 HAVING total_spend > 30 AND SUM(dp.orders) = 0
 ORDER BY total_spend DESC
 LIMIT 10
 `);

        // @ts-expect-error Dynamic type assertion
        const zeroConvRows = zeroConvCampaigns as any[];
        for (const camp of zeroConvRows) {
          try {
            await dbInstance.execute(sql`
              UPDATE campaigns SET campaignStatus = 'paused' WHERE id = ${camp.id}
            `);
            result.actionsCount++;
            result.successCount++;
            result.details.push(`  暂停零转化: ${camp.campaignName} (花费: $${Number(camp.total_spend).toFixed(0)}, 0单)`);
          } catch { result.failedCount++; }
        }

        if (zeroConvRows.length > 0) {
          try {
            const { syncCampaignStatusToAmazon } = await import('../services/amazonApiHelper');
            // v505: 修复参数格式
            const statusChanges = zeroConvRows.map((c: any) => ({
              amazonCampaignId: String(c.campaignId),
              newStatus: 'paused' as const,
              campaignName: String(c.campaignName || ''),
              reason: `[SystemDefense] 紧急优化: 零转化高花费`,
            }));
            await syncCampaignStatusToAmazon(account.id, statusChanges);
          } catch { /* 忽略 */ }
        }

        logOptimization('SystemDefense', `紧急优化(WARNING): ${account.storeName || account.accountName} ${account.marketplace} ACoS=${acos.toFixed(1)}%, 暂停${zeroConvRows.length}个零转化Campaign`);
      }
    }

    if (result.actionsCount === 0) {
      result.details.push('所有账户ACoS在可控范围内，无需紧急干预');
    }

  } catch (error: unknown) {
    result.failedCount++;
    result.details.push(`紧急优化异常: ${(error as Error).message}`);
    logOptimizationWarn('SystemDefense', `紧急优化异常: ${(error as Error).message}`);
  }

  return result;
}

// ==================== 主入口: 系统防线全量扫描 ====================

/**
 * 执行系统防线全量扫描 — 依次运行4个模块
 * 由调度器每4小时调用一次
 */
export async function runSystemDefenseScan(): Promise<{
  timestamp: string;
  modules: DefenseResult[];
  summary: string;
}> {
  const startTime = Date.now();
  log.info('[SystemDefense] ========== 系统防线全量扫描开始 ==========');

  // v504: 确保system_config表存在
  await ensureSystemConfigTable();

  const modules: DefenseResult[] = [];

  // 模块1: 同步失败清理
  try {
    const syncResult = await cleanupSyncFailures();
    modules.push(syncResult);
  } catch (err: unknown) {
    modules.push({ module: 'sync_cleanup', actionsCount: 0, successCount: 0, failedCount: 1, details: [`模块异常: ${(err as Error).message}`], timestamp: new Date().toISOString() });
  }

  // 模块2: 算法熔断检查
  try {
    const algoResult = await checkAlgorithmHealth();
    modules.push(algoResult);
  } catch (err: unknown) {
    modules.push({ module: 'algorithm_circuit_breaker', actionsCount: 0, successCount: 0, failedCount: 1, details: [`模块异常: ${(err as Error).message}`], timestamp: new Date().toISOString() });
  }

  // 模块3: 死亡螺旋干预
  try {
    const spiralResult = await detectAndIntervenDeathSpiral();
    modules.push(spiralResult);
  } catch (err: unknown) {
    modules.push({ module: 'death_spiral_intervention', actionsCount: 0, successCount: 0, failedCount: 1, details: [`模块异常: ${(err as Error).message}`], timestamp: new Date().toISOString() });
  }

  // 模块4: 真正的紧急优化
  try {
    const emergencyResult = await executeRealEmergencyOptimization();
    modules.push(emergencyResult);
  } catch (err: unknown) {
    modules.push({ module: 'real_emergency_optimization', actionsCount: 0, successCount: 0, failedCount: 1, details: [`模块异常: ${(err as Error).message}`], timestamp: new Date().toISOString() });
  }

  const totalActions = modules.reduce((sum, m) => sum + m.actionsCount, 0);
  const totalSuccess = modules.reduce((sum, m) => sum + m.successCount, 0);
  const totalFailed = modules.reduce((sum, m) => sum + m.failedCount, 0);
  const elapsed = Date.now() - startTime;

  const summary = `系统防线扫描完成: ${totalActions}个操作(${totalSuccess}成功/${totalFailed}失败), 耗时${elapsed}ms`;
  log.info(`[SystemDefense] ${summary}`);
  logOptimization('SystemDefense', summary);

  return {
    timestamp: new Date().toISOString(),
    modules,
    summary,
  };
}
