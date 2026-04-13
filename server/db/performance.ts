/**
 * v361: 绩效数据管理
 * 从db.ts拆分的子模块
 */

import { and, eq, not, sql } from 'drizzle-orm';
import { DailyPerformance, InsertDailyPerformance, InsertMarketCurveData, dailyPerformance, marketCurveData, amsProcessedMessages } from '../../drizzle/schema';
import { getDb } from './connection';
import { guardCampaignIdParam, guardCampaignIdInsert } from '../utils/idTypes';
import { createModuleLogger } from '../utils/logger';

const log = createModuleLogger('DB:performance');

// ==================== Daily Performance Functions ====================
/**
 * v361: UPSERT模式 - 基于唯一约束避免重复插入
 */
export async function createDailyPerformance(perf: InsertDailyPerformance) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(dailyPerformance).values(perf).onDuplicateKeyUpdate({
    set: {
      impressions: sql`VALUES(impressions)`,
      clicks: sql`VALUES(clicks)`,
      spend: sql`VALUES(spend)`,
      sales: sql`VALUES(sales)`,
      orders: sql`VALUES(orders)`,
    },
  });
  return result[0].insertId;
}

export async function getDailyPerformanceByDateRange(
  accountId: number,
  startDate: Date,
  endDate: Date,
  campaignId?: number | string
) {
  const db = await getDb();
  if (!db) return [];
  
  const startDateStr = startDate.toISOString().split('T')[0];
  const endDateStr = endDate.toISOString().split('T')[0];
  const conditions = [
    eq(dailyPerformance.accountId, accountId),
    sql`${dailyPerformance.date} >= ${startDateStr}`,
    sql`${dailyPerformance.date} <= ${endDateStr}`
  ];
  
  if (campaignId) {
    // v208: 入口守卫 — campaignId必须是Amazon ID
    const campaignIdStr = guardCampaignIdParam(campaignId, 'getDailyPerformanceByDateRange');
    conditions.push(eq(dailyPerformance.campaignId, campaignIdStr));
  }
  
  return db.select()
    .from(dailyPerformance)
    .where(and(...conditions))
    .orderBy(dailyPerformance.date);
}

/**
 * 按天聚合绩效数据 - 确保每天只有一条汇总记录
 * 
 * ❗ 重要设计原则：
 * 1. 只汇总 campaign 级别的记录（campaignId IS NOT NULL）
 * 2. 按日期 GROUP BY，确保同一天多个campaign的数据被正确汇总而非重复展示
 * 3. 用于趋势图、日历视图等按天展示的场景
 */

/**
 * 按天聚合绩效数据 - 确保每天只有一条汇总记录
 * 
 * ❗ 重要设计原则：
 * 1. 只汇总 campaign 级别的记录（campaignId IS NOT NULL）
 * 2. 按日期 GROUP BY，确保同一天多个campaign的数据被正确汇总而非重复展示
 * 3. 用于趋势图、日历视图等按天展示的场景
 */
export async function getDailyPerformanceAggregatedByDate(
  accountId: number,
  startDate: Date,
  endDate: Date
) {
  const db = await getDb();
  if (!db) return [];
  
  const startDateStr = startDate.toISOString().split('T')[0];
  const endDateStr = endDate.toISOString().split('T')[0];
  
  return db.select({
    date: sql<string>`DATE(${dailyPerformance.date})`.as('date'),
    totalImpressions: sql<number>`COALESCE(SUM(${dailyPerformance.impressions}), 0)`.as('totalImpressions'),
    totalClicks: sql<number>`COALESCE(SUM(${dailyPerformance.clicks}), 0)`.as('totalClicks'),
    totalSpend: sql<string>`COALESCE(SUM(${dailyPerformance.spend}), '0')`.as('totalSpend'),
    totalSales: sql<string>`COALESCE(SUM(${dailyPerformance.sales}), '0')`.as('totalSales'),
    totalOrders: sql<number>`COALESCE(SUM(${dailyPerformance.orders}), 0)`.as('totalOrders'),
  })
    .from(dailyPerformance)
    .where(and(
      eq(dailyPerformance.accountId, accountId),
      // ✅ 只汇总campaign级别的记录
      sql`${dailyPerformance.campaignId} IS NOT NULL`,
      sql`DATE(${dailyPerformance.date}) >= ${startDateStr}`,
      sql`DATE(${dailyPerformance.date}) <= ${endDateStr}`
    ))
    .groupBy(sql`DATE(${dailyPerformance.date})`)
    .orderBy(sql`DATE(${dailyPerformance.date})`);
}

/**
 * 获取指定账号和日期范围的绩效汇总
 * 
 * ❗ 重要设计原则：
 * 1. 只汇总 campaign 级别的记录（campaignId IS NOT NULL），排除账户级汇总记录，避免双重计算
 * 2. 使用 SUM 汇总曝光/点击/花费/销售额/订单数
 * 3. ACoS/RoAS/CTR/CVR 等派生指标由调用方基于汇总值计算（加权计算）
 */

/**
 * 获取指定账号和日期范围的绩效汇总
 * 
 * ❗ 重要设计原则：
 * 1. 只汇总 campaign 级别的记录（campaignId IS NOT NULL），排除账户级汇总记录，避免双重计算
 * 2. 使用 SUM 汇总曝光/点击/花费/销售额/订单数
 * 3. ACoS/RoAS/CTR/CVR 等派生指标由调用方基于汇总值计算（加权计算）
 */
export async function getPerformanceSummary(accountId: number, startDate: Date, endDate: Date) {
  const db = await getDb();
  if (!db) return null;
  
  const result = await db.select({
    totalImpressions: sql<number>`COALESCE(SUM(impressions), 0)`,
    totalClicks: sql<number>`COALESCE(SUM(clicks), 0)`,
    totalSpend: sql<string>`COALESCE(SUM(spend), '0')`,
    totalSales: sql<string>`COALESCE(SUM(sales), '0')`,
    totalOrders: sql<number>`COALESCE(SUM(orders), 0)`,
    totalConversions: sql<number>`COALESCE(SUM(conversions), 0)`,
  })
    .from(dailyPerformance)
    .where(and(
      eq(dailyPerformance.accountId, accountId),
      // ✅ 只汇总campaign级别的记录，排除账户级汇总记录（campaignId IS NULL）
      sql`${dailyPerformance.campaignId} IS NOT NULL`,
      sql`DATE(${dailyPerformance.date}) >= ${startDate.toISOString().split('T')[0]}`,
      sql`DATE(${dailyPerformance.date}) <= ${endDate.toISOString().split('T')[0]}`
    ));
  
  return result[0];
}

// ==================== AMS Data Functions ====================

/**
 * 获取指定日期和账号的绩效数据
 * 注意：当前dailyPerformance表没有adType字段，按账号+日期查询
 */

// ==================== AMS Data Functions ====================

/**
 * 获取指定日期和账号的绩效数据
 * 注意：当前dailyPerformance表没有adType字段，按账号+日期查询
 */
export async function getDailyPerformanceByAccountAndDate(
  accountId: number,
  date: string,
  campaignId?: number | string | null
): Promise<DailyPerformance | null> {
  const db = await getDb();
  if (!db) return null;
  
  const conditions = [
    eq(dailyPerformance.accountId, accountId),
    sql`DATE(${dailyPerformance.date}) = ${date}`,
  ];
  
  // v186: dailyPerformance.campaignId在DB中是varchar类型
  if (campaignId !== undefined && campaignId !== null) {
    conditions.push(eq(dailyPerformance.campaignId, String(campaignId)));
  } else {
    conditions.push(sql`${dailyPerformance.campaignId} IS NULL`);
  }
  
  const result = await db.select()
    .from(dailyPerformance)
    .where(and(...conditions))
    .limit(1);
  
  return result[0] || null;
}

/**
 * 从SQS/AMS插入或更新绩效数据
 * 
 * ⚠️ 重要设计原则：使用【覆盖写入】而非累加
 * AMS实时数据流会持续推送同一天的最新快照数据，
 * 每次写入都应该用最新值覆盖旧值，而不是累加。
 * 这确保了无论一天内触发多少次同步，数据始终是准确的。
 * 
 * 不覆盖已被API校准的数据（isFinalized=1），
 * 因为API报告数据经过归因窗口校准，比AMS实时数据更准确。
 */

/**
 * 从SQS/AMS插入或更新绩效数据
 * 
 * v442: 重构为【累加模式】
 * Amazon Marketing Stream推送的是增量delta记录（delta records），
 * 同一campaign同一天会收到多条消息（每小时一条、每keyword/placement一条）。
 * 必须对所有delta记录做SUM聚合，而不是用最后一条覆盖。
 * 
 * 使用idempotency_id去重：AMS保证至少一次投递（at-least-once），
 * 重复消息必须跳过，否则会导致数据重复累加。
 * 
 * 参考: https://advertising.amazon.com/API/docs/en-us/guides/amazon-marketing-stream/aggregating-data
 * 
 * 不修改已被API校准的数据（isFinalized=1），
 * 因为API报告数据经过归因窗口校准，比AMS实时数据更准确。
 */
export async function upsertDailyPerformanceFromAms(data: {
  accountId: number;
  date: string;
  impressions: number;
  clicks: number;
  cost: number;
  adType?: string;  // SP, SB, SD
  campaignId?: string | null;  // v439: Amazon原始campaignId（varchar）
  idempotencyId?: string;  // v442: AMS消息幂等性ID，用于去重
  datasetId?: string;  // v442: 数据集ID（sp-traffic等）
}): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // v442: idempotency_id去重 — 防止重复消息导致delta重复累加
  if (data.idempotencyId) {
    try {
      // INSERT IGNORE: 如果idempotency_id已存在则静默跳过（返回affectedRows=0）
      const result = await db.execute(sql`
        INSERT IGNORE INTO ams_processed_messages (idempotency_id, dataset_id)
        VALUES (${data.idempotencyId}, ${data.datasetId || null})
      `);
      // @ts-expect-error Dynamic type assertion
      if ((result as Record<string, unknown>)[0]?.affectedRows === 0) {
        // 已处理过的消息，跳过
        log.debug(`[AMS DB] 跳过重复消息: idempotencyId=${data.idempotencyId}`);
        return;
      }
    } catch (e: unknown) {
      // 去重表写入失败不应阻断主流程，仅记录警告
      log.warn(`[AMS DB] idempotency去重检查失败: ${(e as Error).message}`);
    }
  }
  
  // v442: AMS delta数据允许负数（合法的修正值），不再过滤
  const deltaImpressions = data.impressions;
  const deltaClicks = data.clicks;
  const deltaCost = data.cost;
  
  // === 1. 写入campaign维度的记录（如果有campaignId） ===
  if (data.campaignId) {
    // v439: 写入前验证campaignId格式，拦截本地ID
    const safeCampaignId = guardCampaignIdInsert(data.campaignId, 'daily_performance');
    const existingCampaign = await getDailyPerformanceByAccountAndDate(
      data.accountId,
      data.date,
      safeCampaignId
    );
    
    if (existingCampaign?.isFinalized) {
      // 已校准的campaign级数据不修改
      log.info(`[AMS DB] 跳过已校准campaign数据: ${data.date} campaignId=${data.campaignId}`);
    } else if (existingCampaign) {
      // v442: 累加模式 — 将delta增量累加到已有值上
      const newImpressions = Math.max(0, (existingCampaign.impressions || 0) + deltaImpressions);
      const newClicks = Math.max(0, (existingCampaign.clicks || 0) + deltaClicks);
      const newSpend = Math.max(0, parseFloat(String(existingCampaign.spend || '0')) + deltaCost);
      await db.update(dailyPerformance)
        .set({
          impressions: newImpressions,
          clicks: newClicks,
          spend: String(newSpend.toFixed(2)),
          dataSource: 'ams',
        })
        .where(eq(dailyPerformance.id, existingCampaign.id));
    } else {
      // 首条delta记录：直接插入（负数delta在首条时归零保护）
      // @ts-expect-error - Drizzle query builder type
      await db.insert(dailyPerformance).values({
        accountId: data.accountId,
        campaignId: safeCampaignId,
        date: data.date,
        impressions: Math.max(0, deltaImpressions),
        clicks: Math.max(0, deltaClicks),
        spend: String(Math.max(0, deltaCost).toFixed(2)),
        sales: '0',
        orders: 0,
        conversions: 0,
        dataSource: 'ams',
        isFinalized: 0,
      } as Record<string, unknown>);
    }
  }
  
  // v500.2: 移除账户级别汇总记录的维护逻辑
  // 原因：向daily_performance写入campaignId=NULL的账户级汇总记录会导致聚合查询时双重计算
  // （campaign级数据 + account级汇总数据一起SUM）。账户级汇总应在查询层实时计算，而不是存储层写入。
}

/**
 * v442: 更新转化数据（销售额和订单数）
 * 
 * 重构为【累加模式】：转化数据也是delta增量记录，
 * 同一campaign同一天会收到多条转化消息（不同归因窗口、不同keyword）。
 * idempotency_id去重已在调用层（sqsConsumerService）完成。
 */
export async function updateDailyPerformanceConversion(data: {
  accountId: number;
  date: string;
  sales: number;
  orders: number;
  adType?: string;  // SP, SB, SD
  campaignId?: string | null;  // v439: Amazon原始campaignId（varchar）
  idempotencyId?: string;  // v442: AMS消息幂等性ID
  datasetId?: string;  // v442: 数据集ID
}): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // v442: idempotency_id去重
  if (data.idempotencyId) {
    try {
      const result = await db.execute(sql`
 INSERT IGNORE INTO ams_processed_messages (idempotency_id, dataset_id)
 VALUES (${data.idempotencyId}, ${data.datasetId || null})
 `);
      // @ts-expect-error Dynamic type assertion
      if ((result as Record<string, unknown>)[0]?.affectedRows === 0) {
        log.debug(`[AMS DB] 跳过重复转化消息: idempotencyId=${data.idempotencyId}`);
        return;
      }
    } catch (e: unknown) {
      log.warn(`[AMS DB] 转化idempotency去重检查失败: ${(e as Error).message}`);
    }
  }
  
  const deltaSales = data.sales;
  const deltaOrders = data.orders;
  
  // === 1. 累加campaign维度的转化数据（如果有campaignId） ===
  if (data.campaignId) {
    const safeCampaignId = guardCampaignIdInsert(data.campaignId, 'daily_performance');
    const existingCampaign = await getDailyPerformanceByAccountAndDate(
      data.accountId,
      data.date,
      safeCampaignId
    );
    
    if (existingCampaign && !existingCampaign.isFinalized) {
      // v442: 累加模式
      const newSales = Math.max(0, parseFloat(String(existingCampaign.sales || '0')) + deltaSales);
      const newOrders = Math.max(0, (existingCampaign.orders || 0) + deltaOrders);
      await db.update(dailyPerformance)
        .set({
          sales: String(newSales.toFixed(2)),
          orders: newOrders,
          dataSource: 'ams',
        })
        .where(eq(dailyPerformance.id, existingCampaign.id));
    }
  }
  
  // === 2. 同时累加账户级别汇总记录 ===
  const existing = await getDailyPerformanceByAccountAndDate(
    data.accountId,
    data.date,
    null
  );
  
  if (existing?.isFinalized) {
    log.info(`[AMS DB] 跳过已校准转化数据: ${data.date} accountId=${data.accountId}`);
    return;
  }
  
  if (existing) {
    // v442: 累加模式
    const newSales = Math.max(0, parseFloat(String(existing.sales || '0')) + deltaSales);
    const newOrders = Math.max(0, (existing.orders || 0) + deltaOrders);
    await db.update(dailyPerformance)
      .set({
        sales: String(newSales.toFixed(2)),
        orders: newOrders,
        dataSource: 'ams',
      })
      .where(eq(dailyPerformance.id, existing.id));
  }
}

/**
 * 标记数据为已校准（由API数据覆盖后调用）
 */

/**
 * 标记数据为已校准（由API数据覆盖后调用）
 */
export async function markDailyPerformanceAsFinalized(
  accountId: number,
  date: string
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(dailyPerformance)
    .set({
      isFinalized: 1,
      dataSource: 'api',
    })
    .where(and(
      eq(dailyPerformance.accountId, accountId),
      sql`DATE(${dailyPerformance.date}) = ${date}`
    ));
}

/**
 * 删除指定账号和日期范围的绩效数据
 * 用于全量同步前清除旧数据，确保覆盖写入而非累积
 * 
 * @param accountId 账号ID
 * @param startDate 开始日期 (YYYY-MM-DD)
 * @param endDate 结束日期 (YYYY-MM-DD)
 * @returns 删除的记录数
 */

/**
 * 删除指定账号和日期范围的绩效数据
 * 用于全量同步前清除旧数据，确保覆盖写入而非累积
 * 
 * @param accountId 账号ID
 * @param startDate 开始日期 (YYYY-MM-DD)
 * @param endDate 结束日期 (YYYY-MM-DD)
 * @returns 删除的记录数
 */
export async function deleteDailyPerformanceByDateRange(
  accountId: number,
  startDate: string,
  endDate: string
): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.delete(dailyPerformance)
    .where(and(
      eq(dailyPerformance.accountId, accountId),
      sql`DATE(${dailyPerformance.date}) >= ${startDate}`,
      sql`DATE(${dailyPerformance.date}) <= ${endDate}`
    ));
  
  // @ts-expect-error - MySQL affectedRows
  return (result as Record<string, unknown>[][])[0]?.affectedRows || 0;
}

// ==================== Market Curve Data Functions ====================

// ==================== Market Curve Data Functions ====================
export async function upsertMarketCurveData(data: InsertMarketCurveData) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.insert(marketCurveData).values(data).onDuplicateKeyUpdate({
    set: {
      estimatedImpressions: data.estimatedImpressions,
      estimatedClicks: data.estimatedClicks,
      estimatedConversions: data.estimatedConversions,
      estimatedSpend: data.estimatedSpend,
      estimatedSales: data.estimatedSales,
      curveMarginalRevenue: data.curveMarginalRevenue,
      curveMarginalCost: data.curveMarginalCost,
      marginalProfit: data.marginalProfit,
      curveTrafficCeiling: data.curveTrafficCeiling,
      optimalBidPoint: data.optimalBidPoint,
    }
  });
}

export async function getMarketCurveData(targetType: "keyword" | "product_target", targetId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select()
    .from(marketCurveData)
    .where(and(
      eq(marketCurveData.curveTargetType, targetType),
      eq(marketCurveData.curveTargetId, targetId)
    ))
    .orderBy(marketCurveData.bidLevel);
}

// ==================== Import Job Functions ====================
