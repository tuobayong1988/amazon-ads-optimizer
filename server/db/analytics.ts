/**
 * v361: 分析与统计
 * 从db.ts拆分的子模块
 */

import { and, count, eq, not, sql } from 'drizzle-orm';
import { getDb } from './connection';
import { safeInClause } from '../utils/safeSql';
import { createModuleLogger } from '../utils/logger';
import { adGroups, campaigns, dailyPerformance, keywords, productTargets } from '../../drizzle/schema';

const log = createModuleLogger('DB:analytics');

// 获取本地数据统计
export async function getLocalDataStats(accountId: number) {
  const db = await getDb();
  if (!db) {
    return {
      spCampaigns: 0,
      sbCampaigns: 0,
      sdCampaigns: 0,
      adGroups: 0,
      keywords: 0,
      productTargets: 0,
    };
  }

  // 统计各类数据的数量 - 使用原生SQL查询避免类型问题
  const [spCampaignsResult] = await db.select({ count: sql<number>`count(*)` })
    .from(campaigns)
    .where(sql`${campaigns.accountId} = ${accountId} AND (${campaigns.campaignType} = 'sp_auto' OR ${campaigns.campaignType} = 'sp_manual')`);
  
  const [sbCampaignsResult] = await db.select({ count: sql<number>`count(*)` })
    .from(campaigns)
    .where(sql`${campaigns.accountId} = ${accountId} AND ${campaigns.campaignType} = 'sb'`);
  
  const [sdCampaignsResult] = await db.select({ count: sql<number>`count(*)` })
    .from(campaigns)
    .where(sql`${campaigns.accountId} = ${accountId} AND ${campaigns.campaignType} = 'sd'`);
  
  const [adGroupsResult] = await db.select({ count: sql<number>`count(*)` })
    .from(adGroups)
    .innerJoin(campaigns, eq(adGroups.campaignId, campaigns.campaignId))
    .where(eq(campaigns.accountId, accountId));
  
  const [keywordsResult] = await db.select({ count: sql<number>`count(*)` })
    .from(keywords)
    .innerJoin(adGroups, eq(keywords.adGroupId, adGroups.id))
    .innerJoin(campaigns, eq(adGroups.campaignId, campaigns.campaignId))
    .where(eq(campaigns.accountId, accountId));
  
  const [productTargetsResult] = await db.select({ count: sql<number>`count(*)` })
    .from(productTargets)
    .innerJoin(adGroups, eq(productTargets.adGroupId, adGroups.id))
    .innerJoin(campaigns, eq(adGroups.campaignId, campaigns.campaignId))
    .where(eq(campaigns.accountId, accountId));

  return {
    spCampaigns: Number(spCampaignsResult?.count || 0),
    sbCampaigns: Number(sbCampaignsResult?.count || 0),
    sdCampaigns: Number(sdCampaignsResult?.count || 0),
    adGroups: Number(adGroupsResult?.count || 0),
    keywords: Number(keywordsResult?.count || 0),
    productTargets: Number(productTargetsResult?.count || 0),
  };
}


// 获取账户绩效汇总

// 获取账户绩效汇总
export async function getAccountPerformanceSummary(
  accountId: number,
  startDate?: Date,
  endDate?: Date
): Promise<{
  totalSpend: number;
  totalSales: number;
  totalOrders: number;
  totalImpressions: number;
  totalClicks: number;
} | null> {
  const db = await getDb();
  if (!db) return null;
  
  try {
    // 如果有时间范围，从日报表查询；否则从 campaigns 表查询累计数据
    if (startDate && endDate) {
      // 将Date对象转换为YYYY-MM-DD格式字符串，与数据库中的日期格式匹配
      const startDateStr = startDate.toISOString().split('T')[0];
      const endDateStr = endDate.toISOString().split('T')[0];
      
      // v104: 从daily_performance表查询指定时间范围的数据
      // 使用 spend_usd/sales_usd（如果有）进行USD汇总，否则回退到 spend/sales
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
        sql`DATE(${dailyPerformance.date}) >= ${startDateStr}`,
        sql`DATE(${dailyPerformance.date}) <= ${endDateStr}`
      ));
      
      return {
        totalSpend: Number(result?.totalSpend || 0),
        totalSales: Number(result?.totalSales || 0),
        totalOrders: Number(result?.totalOrders || 0),
        totalImpressions: Number(result?.totalImpressions || 0),
        totalClicks: Number(result?.totalClicks || 0),
      };
    }
    
    // 无时间范围时，从campaigns表查询累计数据
    const [result] = await db.select({
      totalSpend: sql<number>`COALESCE(SUM(${campaigns.spend}), 0)`,
      totalSales: sql<number>`COALESCE(SUM(${campaigns.sales}), 0)`,
      totalOrders: sql<number>`COALESCE(SUM(${campaigns.orders}), 0)`,
      totalImpressions: sql<number>`COALESCE(SUM(${campaigns.impressions}), 0)`,
      totalClicks: sql<number>`COALESCE(SUM(${campaigns.clicks}), 0)`,
    })
    .from(campaigns)
    .where(eq(campaigns.accountId, accountId));
    
    return {
      totalSpend: Number(result?.totalSpend || 0),
      totalSales: Number(result?.totalSales || 0),
      totalOrders: Number(result?.totalOrders || 0),
      totalImpressions: Number(result?.totalImpressions || 0),
      totalClicks: Number(result?.totalClicks || 0),
    };
  } catch (error) {
    log.error('[getAccountPerformanceSummary] Error:', error);
    return null;
  }
}


// 获取每日趋势数据

// 获取每日趋势数据
export async function getDailyTrendData(accountIds: number[], days: number, timeRange?: string, customStartDate?: string, customEndDate?: string): Promise<{
  date: string;
  spend: number;
  sales: number;
  orders: number;
  acos: number;
}[]> {
  const db = await getDb();
  if (!db) return [];
  
  try {
    // 优先使用前端传入的日期字符串（已根据站点时区计算）
    let startDateStr: string;
    let endDateStr: string;
    
    if (customStartDate && customEndDate) {
      // 前端传入的日期已经是YYYY-MM-DD格式
      startDateStr = customStartDate;
      endDateStr = customEndDate;
    } else {
      // 如果没有传入日期，使用默认计算（回退方案）
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
    
    // v104: 使用 spend_usd/sales_usd 进行USD汇总
    const results = await db.execute(sql`
      SELECT 
        DATE(date) as report_date,
        COALESCE(SUM(CASE WHEN spend_usd > 0 THEN spend_usd ELSE spend END), 0) as spend,
        COALESCE(SUM(CASE WHEN sales_usd > 0 THEN sales_usd ELSE sales END), 0) as sales,
        COALESCE(SUM(orders), 0) as orders
      FROM daily_performance
      WHERE accountId IN (${safeInClause(accountIds)})
        AND DATE(date) >= ${startDateStr}
        AND DATE(date) <= ${endDateStr}
      GROUP BY DATE(date)
      ORDER BY DATE(date)
    `) as unknown;
    
    // @ts-ignore
    const rows = results[0] || results;
    
    return (rows as any[]).map((r: Record<string, any>) => {
      const spend = Number(r.spend) || 0;
      const sales = Number(r.sales) || 0;
      const acos = spend > 0 && sales > 0 ? (spend / sales) * 100 : 0;
      
      // 格式化日期为 M/D 格式，使用report_date字段
      let dateStr = 'N/A';
      const dateValue = r.report_date || r.date;
      if (dateValue) {
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
  } catch (error) {
    log.error('[getDailyTrendData] Error:', error);
    return [];
  }
}


// 获取数据可用日期范围和最后同步时间

// 获取数据可用日期范围和最后同步时间
export async function getDataDateRange(accountIds: number[]): Promise<{
  minDate: string;
  maxDate: string;
  hasData: boolean;
  lastSyncAt?: string; // 最后同步时间
}> {
  const db = await getDb();
  if (!db) {
    const now = new Date();
    const minDate = new Date(now);
    minDate.setDate(minDate.getDate() - 90);
    return {
      minDate: minDate.toISOString().split('T')[0],
      maxDate: now.toISOString().split('T')[0],
      hasData: false,
    };
  }
  
  try {
    // 从daily_performance表获取最早和最晚的数据日期
    const results = await db.execute(sql`
      SELECT 
        MIN(DATE(date)) as min_date,
        MAX(DATE(date)) as max_date
      FROM daily_performance
      WHERE accountId IN (${safeInClause(accountIds)})
    `) as unknown;
    
    // @ts-ignore
    const rows = results[0] || results;
    const row = Array.isArray(rows) ? rows[0] : rows;
    
    if (row && row.min_date && row.max_date) {
      // 获取最后同步时间
      const syncResults = await db.execute(sql`
        SELECT MAX(lastSyncAt) as last_sync
        FROM amazon_api_credentials
        WHERE accountId IN (${safeInClause(accountIds)})
      `) as unknown;
      // @ts-ignore
      const syncRows = syncResults[0] || syncResults;
      const syncRow = Array.isArray(syncRows) ? syncRows[0] : syncRows;
      
      return {
        minDate: row.min_date,
        maxDate: row.max_date,
        hasData: true,
        lastSyncAt: syncRow?.last_sync || undefined,
      };
    }
    
    // 如果daily_performance没有数据，尝试从campaigns表获取
    const campaignResults = await db.execute(sql`
      SELECT 
        MIN(DATE(createdAt)) as min_date,
        MAX(DATE(updatedAt)) as max_date
      FROM campaigns
      WHERE accountId IN (${safeInClause(accountIds)})
    `) as unknown;
    
    // @ts-ignore
    const campaignRows = campaignResults[0] || campaignResults;
    const campaignRow = Array.isArray(campaignRows) ? campaignRows[0] : campaignRows;
    
    if (campaignRow && campaignRow.min_date && campaignRow.max_date) {
      return {
        minDate: campaignRow.min_date,
        maxDate: campaignRow.max_date,
        hasData: true,
      };
    }
    
    // 没有数据时返回默认90天范围
    const now = new Date();
    const minDate = new Date(now);
    minDate.setDate(minDate.getDate() - 90);
    return {
      minDate: minDate.toISOString().split('T')[0],
      maxDate: now.toISOString().split('T')[0],
      hasData: false,
    };
  } catch (error) {
    log.error('[getDataDateRange] Error:', error);
    const now = new Date();
    const minDate = new Date(now);
    minDate.setDate(minDate.getDate() - 90);
    return {
      minDate: minDate.toISOString().split('T')[0],
      maxDate: now.toISOString().split('T')[0],
      hasData: false,
    };
  }
}

// 获取广告活动的位置绩效数据

// 获取广告活动的位置绩效数据
export async function getPlacementPerformanceByCampaignId(campaignId: number | string) {
  const db = await getDb();
  if (!db) return [];
  
  try {
    // v165: 修复SQL列名错误 - 实际列名是campaignId/placement/date（非campaign_id/placement_type/report_date）
    // 聚合所有日期的数据，按位置类型汇总，展示累计绩效
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
    
    return (result as unknown) || [];
  } catch (error) {
    log.error('[getPlacementPerformanceByCampaignId] Error:', error);
    return [];
  }
}


/**
 * 更新广告活动的预算使用情况（快照模式，直接覆盖）
 * 用于处理AMS的budget-usage消息
 * 
 * ⚠️ 重要: 预算数据是快照(Snapshot)，不是累加!
 * 参考文档: https://advertising.amazon.com/API/docs/en-us/guides/amazon-marketing-stream/overview
 */

/**
 * 更新广告活动的预算使用情况（快照模式，直接覆盖）
 * 用于处理AMS的budget-usage消息
 * 
 * ⚠️ 重要: 预算数据是快照(Snapshot)，不是累加!
 * 参考文档: https://advertising.amazon.com/API/docs/en-us/guides/amazon-marketing-stream/overview
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
