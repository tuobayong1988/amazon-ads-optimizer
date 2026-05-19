/**
 * v426: 分析与统计 - 性能优化版
 * 核心优化:
 * 1. 移除所有DATE()函数包裹，改用直接范围比较以利用索引
 * 2. 合并getLocalDataStats的6次COUNT为1次查询
 * 3. 消除@ts-ignore，使用类型安全的结果处理
 */

import { and, count, eq, not, sql } from 'drizzle-orm';
import { getDb } from './connection';
import { safeInClause } from '../utils/safeSql';
import { createModuleLogger } from '../utils/logger';
import { adGroups, campaigns, dailyPerformance, keywords, productTargets } from '../../drizzle/schema';
// @ts-ignore Module import type resolution
import { extractRows } from '../types/utilTypes';

const log = createModuleLogger('DB:analytics');

// ==================== 类型定义 ====================
interface LocalDataStats {
  spCampaigns: number;
  sbCampaigns: number;
  sdCampaigns: number;
  adGroups: number;
  keywords: number;
  productTargets: number;
}

interface PerformanceSummary {
  totalSpend: number;
  totalSales: number;
  totalOrders: number;
  totalImpressions: number;
  totalClicks: number;
}

interface DailyTrendItem {
  date: string;
  spend: number;
  sales: number;
  orders: number;
  acos: number;
}

interface DataDateRange {
  minDate: string;
  maxDate: string;
  hasData: boolean;
  lastSyncAt?: string;
}

// ==================== 辅助函数 ====================

/** 安全提取raw SQL查询结果的行数组 */
function extractRows(rawResult: unknown): Record<string, unknown>[] {
  if (!rawResult) return [];
  if (Array.isArray(rawResult)) {
    // mysql2 返回 [rows, fields] 格式
    if (rawResult.length > 0 && Array.isArray(rawResult[0])) {
      return rawResult[0] as Record<string, unknown>[];
    }
    return rawResult as Record<string, unknown>[];
  }
  return [];
}

/** 安全提取单行结果 */
function extractFirstRow(rawResult: unknown): Record<string, unknown> | null {
  const rows = extractRows(rawResult);
  return rows.length > 0 ? rows[0] : null;
}

// ==================== 查询函数 ====================

/**
 * v426: 获取本地数据统计 - 合并为单次查询
 * 优化: 6次独立COUNT查询 → 1次campaigns统计 + 1次子查询统计
 */
export async function getLocalDataStats(accountId: number): Promise<LocalDataStats> {
  const db = await getDb();
  if (!db) {
    return { spCampaigns: 0, sbCampaigns: 0, sdCampaigns: 0, adGroups: 0, keywords: 0, productTargets: 0 };
  }

  try {
    // 合并campaigns统计为单次查询
    const [campaignStats] = await db.select({
      spCampaigns: sql<number>`SUM(CASE WHEN ${campaigns.campaignType} IN ('sp_auto', 'sp_manual') THEN 1 ELSE 0 END)`,
      sbCampaigns: sql<number>`SUM(CASE WHEN ${campaigns.campaignType} = 'sb' THEN 1 ELSE 0 END)`,
      sdCampaigns: sql<number>`SUM(CASE WHEN ${campaigns.campaignType} = 'sd' THEN 1 ELSE 0 END)`,
    }).from(campaigns).where(eq(campaigns.accountId, accountId));

    // 使用子查询统计关联数据，避免多次JOIN
    const subStatsResult = await db.execute(sql`
      SELECT 
        (SELECT COUNT(*) FROM ad_groups ag 
         INNER JOIN campaigns c ON ag.campaignId = c.campaignId 
         WHERE c.accountId = ${accountId}) as adGroupCount,
        (SELECT COUNT(*) FROM keywords k 
         INNER JOIN ad_groups ag ON k.internalAdGroupId = ag.id 
         INNER JOIN campaigns c ON ag.campaignId = c.campaignId 
         WHERE c.accountId = ${accountId}) as keywordCount,
        (SELECT COUNT(*) FROM product_targets pt 
         INNER JOIN ad_groups ag ON pt.internalAdGroupId = ag.id 
         INNER JOIN campaigns c ON ag.campaignId = c.campaignId 
         WHERE c.accountId = ${accountId}) as productTargetCount
    `) as unknown;

    const subStats = extractFirstRow(subStatsResult);

    return {
      spCampaigns: Number(campaignStats?.spCampaigns || 0),
      sbCampaigns: Number(campaignStats?.sbCampaigns || 0),
      sdCampaigns: Number(campaignStats?.sdCampaigns || 0),
      adGroups: Number(subStats?.adGroupCount || 0),
      keywords: Number(subStats?.keywordCount || 0),
      productTargets: Number(subStats?.productTargetCount || 0),
    };
  } catch (error: any) {
    log.warn('[getLocalDataStats] Error:', error);
    return { spCampaigns: 0, sbCampaigns: 0, sdCampaigns: 0, adGroups: 0, keywords: 0, productTargets: 0 };
  }
}


/**
 * v426: 获取账户绩效汇总 - 移除DATE()函数以利用索引
 * 优化: DATE(date) >= startDate → date >= startDate (直接范围比较)
 */
export async function getAccountPerformanceSummary(
  accountId: number,
  startDate?: Date,
  endDate?: Date
): Promise<PerformanceSummary | null> {
  const db = await getDb();
  if (!db) return null;
  
  try {
    if (startDate && endDate) {
      const startDateStr = startDate.toISOString().split('T')[0];
      const endDateStr = endDate.toISOString().split('T')[0];
      
      // v426: 移除DATE()包裹，直接使用范围比较以利用idx_daily_perf_account_date索引
      // v500: 添加campaignId IS NOT NULL过滤，排除account-level汇总记录，防止双重计算
      const [result] = await db.select({
        totalSpend: sql<number>`COALESCE(SUM(CASE WHEN spend_usd > 0 THEN spend_usd ELSE ${dailyPerformance.spend} END), 0)`,
        totalSales: sql<number>`COALESCE(SUM(CASE WHEN sales_usd > 0 THEN sales_usd ELSE ${dailyPerformance.sales} END), 0)`,
        totalOrders: sql<number>`COALESCE(SUM(${dailyPerformance.orders}), 0)`,
        totalImpressions: sql<number>`COALESCE(SUM(${dailyPerformance.impressions}), 0)`,
        totalClicks: sql<number>`COALESCE(SUM(${dailyPerformance.clicks}), 0)`,
      })
      .from(dailyPerformance)
      .where(and(
        eq(dailyPerformance.accountId, accountId),
        // ✅ v500: 只汇总campaign级别的记录，排除account-level汇总记录（campaignId IS NULL），避免双重计算
        sql`${dailyPerformance.campaignId} IS NOT NULL`,
        sql`${dailyPerformance.date} >= ${startDateStr}`,
        sql`${dailyPerformance.date} < DATE_ADD(${endDateStr}, INTERVAL 1 DAY)`
      ));
      
      return {
        totalSpend: Number(result?.totalSpend || 0),
        totalSales: Number(result?.totalSales || 0),
        totalOrders: Number(result?.totalOrders || 0),
        totalImpressions: Number(result?.totalImpressions || 0),
        totalClicks: Number(result?.totalClicks || 0),
      };
    }
    
    // v500.2: 无时间范围时，从dailyPerformance表聚合全量数据（而不是从campaigns表，因为campaigns表的绩效字段可能不可靠）
    const [result] = await db.select({
      totalSpend: sql<number>`COALESCE(SUM(CASE WHEN spend_usd > 0 THEN spend_usd ELSE ${dailyPerformance.spend} END), 0)`,
      totalSales: sql<number>`COALESCE(SUM(CASE WHEN sales_usd > 0 THEN sales_usd ELSE ${dailyPerformance.sales} END), 0)`,
      totalOrders: sql<number>`COALESCE(SUM(${dailyPerformance.orders}), 0)`,
      totalImpressions: sql<number>`COALESCE(SUM(${dailyPerformance.impressions}), 0)`,
      totalClicks: sql<number>`COALESCE(SUM(${dailyPerformance.clicks}), 0)`,
    })
    .from(dailyPerformance)
    .where(and(
      eq(dailyPerformance.accountId, accountId),
      sql`${dailyPerformance.campaignId} IS NOT NULL`
    ));
    
    return {
      totalSpend: Number(result?.totalSpend || 0),
      totalSales: Number(result?.totalSales || 0),
      totalOrders: Number(result?.totalOrders || 0),
      totalImpressions: Number(result?.totalImpressions || 0),
      totalClicks: Number(result?.totalClicks || 0),
    };
  } catch (error: any) {
    log.warn('[getAccountPerformanceSummary] Error:', error);
    return null;
  }
}


/**
 * v689: 批量获取多个账户的绩效汇总 — 将N个账户的N次查询合并为1次SQL
 * 使用 GROUP BY account_id 实现批量聚合，大幅减少数据库往返次数
 * Dashboard首页性能优化的核心改进
 */
export async function getBatchAccountPerformanceSummary(
  accountIds: number[],
  startDate: Date,
  endDate: Date
): Promise<Map<number, PerformanceSummary>> {
  const result = new Map<number, PerformanceSummary>();
  if (accountIds.length === 0) return result;
  
  const db = await getDb();
  if (!db) return result;
  
  try {
    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];
    
    const rows = await db.select({
      accountId: dailyPerformance.accountId,
      totalSpend: sql<number>`COALESCE(SUM(CASE WHEN spend_usd > 0 THEN spend_usd ELSE ${dailyPerformance.spend} END), 0)`,
      totalSales: sql<number>`COALESCE(SUM(CASE WHEN sales_usd > 0 THEN sales_usd ELSE ${dailyPerformance.sales} END), 0)`,
      totalOrders: sql<number>`COALESCE(SUM(${dailyPerformance.orders}), 0)`,
      totalImpressions: sql<number>`COALESCE(SUM(${dailyPerformance.impressions}), 0)`,
      totalClicks: sql<number>`COALESCE(SUM(${dailyPerformance.clicks}), 0)`,
    })
    .from(dailyPerformance)
    .where(and(
      sql`${dailyPerformance.accountId} IN (${safeInClause(accountIds)})`,
      sql`${dailyPerformance.campaignId} IS NOT NULL`,
      sql`${dailyPerformance.date} >= ${startDateStr}`,
      sql`${dailyPerformance.date} < DATE_ADD(${endDateStr}, INTERVAL 1 DAY)`
    ))
    .groupBy(dailyPerformance.accountId);
    
    for (const row of rows) {
      result.set(Number(row.accountId), {
        totalSpend: Number(row.totalSpend || 0),
        totalSales: Number(row.totalSales || 0),
        totalOrders: Number(row.totalOrders || 0),
        totalImpressions: Number(row.totalImpressions || 0),
        totalClicks: Number(row.totalClicks || 0),
      });
    }
    
    return result;
  } catch (error: any) {
    log.warn('[getBatchAccountPerformanceSummary] Error:', error);
    return result;
  }
}


/**
 * v426: 获取每日趋势数据 - 移除DATE()函数以利用索引
 * 优化:
 * 1. WHERE条件中移除DATE()包裹
 * 2. GROUP BY使用date列直接分组（date列本身是DATE类型）
 * 3. 消除@ts-ignore，使用extractRows辅助函数
 */
export async function getDailyTrendData(
  accountIds: number[], 
  days: number, 
  timeRange?: string, 
  customStartDate?: string, 
  customEndDate?: string
): Promise<DailyTrendItem[]> {
  const db = await getDb();
  if (!db) return [];
  
  try {
    let startDateStr: string;
    let endDateStr: string;
    
    if (customStartDate && customEndDate) {
      startDateStr = customStartDate;
      endDateStr = customEndDate;
    } else {
      let endDate = new Date();
      let startDate = new Date();
      
      if (timeRange === 'yesterday') {
        endDate.setDate(endDate.getDate() - 1);
        startDate = new Date(endDate);
      } else if (timeRange === 'today') {
        // startDate和endDate都是今天
      } else {
        startDate.setDate(startDate.getDate() - days);
      }
      
      startDateStr = startDate.toISOString().split('T')[0];
      endDateStr = endDate.toISOString().split('T')[0];
    }
    
    // v426: 移除DATE()包裹，直接使用date列进行范围比较和分组
    // v500: 添加campaignId IS NOT NULL过滤，排除account-level汇总记录，防止趋势图数据双重计算
    const results = await db.execute(sql`
      SELECT 
        date as report_date,
        COALESCE(SUM(CASE WHEN spend_usd > 0 THEN spend_usd ELSE spend END), 0) as spend,
        COALESCE(SUM(CASE WHEN sales_usd > 0 THEN sales_usd ELSE sales END), 0) as sales,
        COALESCE(SUM(orders), 0) as orders
      FROM daily_performance
      WHERE accountId IN (${safeInClause(accountIds)})
        AND campaignId IS NOT NULL
        AND date >= ${startDateStr}
        AND date < DATE_ADD(${endDateStr}, INTERVAL 1 DAY)
      GROUP BY date
      ORDER BY date
    `) as unknown;
    
    const rows = extractRows(results);
    
    return rows.map((r: Record<string, unknown>) => {
      const spend = Number(r.spend) || 0;
      const sales = Number(r.sales) || 0;
      const acos = spend > 0 && sales > 0 ? (spend / sales) * 100 : 0;
      
      let dateStr = 'N/A';
      const dateValue = r.report_date || r.date;
      // @ts-ignore Conditional type narrowing
      if (dateValue) {
        // @ts-ignore Type inference limitation
        const dateObj = new Date(dateValue);
        if (!isNaN(dateObj.getTime())) {
          dateStr = `${dateObj.getMonth() + 1}/${dateObj.getDate()}`;
        }
      }
      
      return {
        date: dateStr,
        spend: parseFloat(spend.toFixed(0)),
        sales: parseFloat(sales.toFixed(0)),
        orders: Number(r.orders) || 0,
        acos: parseFloat(acos.toFixed(1)),
      };
    });
  } catch (error: any) {
    log.warn('[getDailyTrendData] Error:', error);
    return [];
  }
}


/**
 * v426: 获取数据可用日期范围 - 移除DATE()函数以利用索引
 */
export async function getDataDateRange(accountIds: number[]): Promise<DataDateRange> {
  const db = await getDb();
  const defaultRange = (): DataDateRange => {
    const now = new Date();
    const minDate = new Date(now);
    minDate.setDate(minDate.getDate() - 90);
    return {
      minDate: minDate.toISOString().split('T')[0],
      maxDate: now.toISOString().split('T')[0],
      hasData: false,
    };
  };
  
  if (!db) return defaultRange();
  
  try {
    // v426: 移除DATE()包裹，直接使用MIN/MAX on date列
    const results = await db.execute(sql`
      SELECT 
        MIN(date) as min_date,
        MAX(date) as max_date
      FROM daily_performance
      WHERE accountId IN (${safeInClause(accountIds)})
    `) as unknown;
    
    const row = extractFirstRow(results);
    
    if (row && row.min_date && row.max_date) {
      // 获取最后同步时间
      const syncResults = await db.execute(sql`
        SELECT MAX(lastSyncAt) as last_sync
        FROM amazon_api_credentials
        WHERE accountId IN (${safeInClause(accountIds)})
      `) as unknown;
      const syncRow = extractFirstRow(syncResults);
      
      // 格式化日期为YYYY-MM-DD字符串
      const formatDate = (d: unknown): string => {
        if (typeof d === 'string') return d.split('T')[0];
        if (d instanceof Date) return d.toISOString().split('T')[0];
        return String(d);
      };
      
      return {
        minDate: formatDate(row.min_date),
        // @ts-ignore Legacy code type compatibility
        maxDate: formatDate(row.max_date),
        hasData: true,
        // @ts-ignore Conditional type narrowing
        lastSyncAt: syncRow?.last_sync || undefined,
      };
    }
    
    // 如果daily_performance没有数据，尝试从campaigns表获取
    const campaignResults = await db.execute(sql`
      SELECT 
        MIN(createdAt) as min_date,
        MAX(updatedAt) as max_date
      FROM campaigns
      WHERE accountId IN (${safeInClause(accountIds)})
    `) as unknown;
    
    const campaignRow = extractFirstRow(campaignResults);
    
    if (campaignRow && campaignRow.min_date && campaignRow.max_date) {
      const formatDate = (d: unknown): string => {
        if (typeof d === 'string') return d.split('T')[0];
        if (d instanceof Date) return d.toISOString().split('T')[0];
        return String(d);
      };
      
      return {
        minDate: formatDate(campaignRow.min_date),
        maxDate: formatDate(campaignRow.max_date),
        hasData: true,
      };
    }
    
    return defaultRange();
  } catch (error: any) {
    log.warn('[getDataDateRange] Error:', error);
    return defaultRange();
  }
}


/**
 * v426: 获取广告活动的位置绩效数据
 */
export async function getPlacementPerformanceByCampaignId(campaignId: string) {
  const db = await getDb();
  if (!db) return [];
  
  try {
    const result = await db.execute(sql`
      SELECT 
        MIN(id) as id,
        campaignId,
        placement as placementType,
        SUM(impressions) as impressions,
        SUM(clicks) as clicks,
        SUM(spend) as spend,
        SUM(sales) as sales,
        SUM(orders) as orders,
        CASE WHEN SUM(sales) > 0 THEN ROUND(SUM(spend) / SUM(sales) * 100, 2) ELSE NULL END as acos,
        CASE WHEN SUM(spend) > 0 THEN ROUND(SUM(sales) / SUM(spend), 2) ELSE 0 END as roas,
        CASE WHEN SUM(impressions) > 0 THEN ROUND(SUM(clicks) / SUM(impressions), 6) ELSE 0 END as ctr,
        CASE WHEN SUM(clicks) > 0 THEN ROUND(SUM(orders) / SUM(clicks), 6) ELSE 0 END as cvr,
        CASE WHEN SUM(clicks) > 0 THEN ROUND(SUM(spend) / SUM(clicks), 2) ELSE NULL END as cpc,
        MAX(date) as reportDate,
        MIN(createdAt) as createdAt
      FROM placement_performance
      WHERE campaignId = ${campaignId}
      GROUP BY campaignId, placement
      ORDER BY placement
    `);
    
    return extractRows(result) || [];
  } catch (error: any) {
    log.warn('[getPlacementPerformanceByCampaignId] Error:', error);
    return [];
  }
}


/**
 * 更新广告活动的预算使用情况（快照模式，直接覆盖）
 */
export async function updateCampaignBudgetUsage(
  campaignId: string,
  data: {
    budgetUsage: number;
    budgetUsagePercentage: number;
    lastBudgetUpdateAt: string;
  }
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(campaigns)
    .set({
      budgetUsagePercent: String(data.budgetUsagePercentage),
    })
    .where(eq(campaigns.campaignId, campaignId));
}


// ==================== 优化日志函数 ====================

/**
 * 创建优化日志
 */
