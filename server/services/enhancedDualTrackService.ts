/**
 * 增强版双轨制数据协同服务
 * 
 * 优化Amazon广告API和AMS实时数据流的协同同步：
 * 1. 智能数据融合 - 根据数据新鲜度和可靠性自动选择数据源
 * 2. 去重机制 - 避免API和AMS数据重复计算
 * 3. 实时展示优化 - 区分可信和不可信字段
 * 4. 数据回补 - 当AMS数据缺失时自动使用API数据
 * 5. 时间线数据聚合 - 支持不同时间范围的数据查询
 */

import { getDb } from '../db';
import { sql } from 'drizzle-orm';
import {
  DATA_SOURCE_PRIORITY,
  CONSISTENCY_THRESHOLDS,
  DATA_FREEZING_CONFIG,
  DataSource,
  AlgorithmType,
} from './dualTrackSyncService';

// ==================== 增强配置 ====================

/**
 * 数据新鲜度配置（分钟）
 */
export const DATA_FRESHNESS_CONFIG = {
  // AMS数据被认为是新鲜的最大时间
  amsMaxAge: 15,
  // API数据被认为是新鲜的最大时间
  apiMaxAge: 60,
  // 触发数据回补的AMS无数据时间
  amsBackfillTrigger: 30,
};

/**
 * 数据融合策略
 */
export type MergeStrategy = 
  | 'ams_priority'      // AMS优先（实时展示）
  | 'api_priority'      // API优先（历史分析）
  | 'weighted_merge'    // 加权合并（报表导出）
  | 'latest_wins';      // 最新数据优先

// ==================== 智能数据融合 ====================

/**
 * 智能获取合并后的绩效数据
 * 根据使用场景自动选择最佳数据源和融合策略
 */
export async function getSmartMergedData(
  accountId: number,
  startDate: string,
  endDate: string,
  options: {
    purpose: 'realtime_display' | 'historical_analysis' | 'report_export' | 'algorithm_input';
    includeToday?: boolean;
    campaignIds?: string[];
  }
): Promise<{
  data: any[];
  dataSource: DataSource;
  freshness: 'fresh' | 'stale' | 'mixed';
  warnings: string[];
}> {
  const db = await getDb();
  if (!db) {
    return { data: [], dataSource: 'api', freshness: 'stale', warnings: ['数据库连接失败'] };
  }

  const warnings: string[] = [];
  const today = new Date().toISOString().split('T')[0];
  
  // 根据用途确定策略
  let strategy: MergeStrategy;
  let excludeRecentDays = 0;
  
  switch (options.purpose) {
    case 'realtime_display':
      strategy = 'ams_priority';
      break;
    case 'historical_analysis':
      strategy = 'api_priority';
      excludeRecentDays = 1; // 排除今天
      break;
    case 'report_export':
      strategy = 'weighted_merge';
      break;
    case 'algorithm_input':
      strategy = 'api_priority';
      excludeRecentDays = DATA_FREEZING_CONFIG.bidAlgorithmExcludeDays;
      warnings.push(`已排除最近${excludeRecentDays}天数据以避免归因延迟误判`);
      break;
    default:
      strategy = 'api_priority';
  }

  // 调整日期范围
  let effectiveEndDate = endDate;
  if (excludeRecentDays > 0) {
    const adjustedEnd = new Date();
    adjustedEnd.setDate(adjustedEnd.getDate() - excludeRecentDays);
    effectiveEndDate = adjustedEnd.toISOString().split('T')[0];
    if (effectiveEndDate < startDate) {
      return { data: [], dataSource: 'api', freshness: 'stale', warnings: ['日期范围无效'] };
    }
  }

  try {
    // 获取API数据
    const apiData = await getApiPerformanceData(db, accountId, startDate, effectiveEndDate, options.campaignIds);
    
    // 获取AMS数据（仅当需要实时数据时）
    let amsData: any[] = [];
    if (strategy === 'ams_priority' && options.includeToday !== false) {
      amsData = await getAmsPerformanceData(db, accountId, today, options.campaignIds);
    }

    // 根据策略融合数据
    const mergedData = mergeDataByStrategy(apiData, amsData, strategy, today);
    
    // 判断数据新鲜度
    const freshness = determineFreshness(apiData, amsData, strategy);
    
    // 确定主要数据源
    const dataSource: DataSource = amsData.length > 0 && strategy === 'ams_priority' ? 'ams' : 'api';

    return {
      data: mergedData,
      dataSource,
      freshness,
      warnings,
    };
  } catch (error: any) {
    console.error('[EnhancedDualTrack] 获取合并数据失败:', error);
    return { data: [], dataSource: 'api', freshness: 'stale', warnings: [error.message] };
  }
}

/**
 * 获取API绩效数据
 */
async function getApiPerformanceData(
  db: any,
  accountId: number,
  startDate: string,
  endDate: string,
  campaignIds?: string[]
): Promise<any[]> {
  try {
    let query = sql`
      SELECT 
        DATE(date) as reportDate,
        campaignId,
        adGroupId,
        impressions,
        clicks,
        spend,
        sales,
        orders,
        CASE WHEN clicks > 0 THEN orders / clicks * 100 ELSE 0 END as cvr,
        CASE WHEN spend > 0 THEN sales / spend ELSE 0 END as roas,
        CASE WHEN sales > 0 THEN (spend / sales) * 100 ELSE 100 END as acos,
        updatedAt,
        'api' as dataSource
      FROM daily_performance
      WHERE accountId = ${accountId}
        AND DATE(date) >= ${startDate}
        AND DATE(date) <= ${endDate}
    `;

    const [rows] = await db.execute(query) as any;
    return Array.isArray(rows) ? rows : [];
  } catch (error) {
    console.error('[EnhancedDualTrack] 获取API数据失败:', error);
    return [];
  }
}

/**
 * 获取AMS实时绩效数据
 */
async function getAmsPerformanceData(
  db: any,
  accountId: number,
  date: string,
  campaignIds?: string[]
): Promise<any[]> {
  try {
    const [rows] = await db.execute(sql`
      SELECT 
        DATE(eventTime) as reportDate,
        campaignId,
        adGroupId,
        SUM(impressions) as impressions,
        SUM(clicks) as clicks,
        SUM(spend) as spend,
        SUM(sales) as sales,
        SUM(orders) as orders,
        MAX(eventTime) as lastUpdateTime,
        'ams' as dataSource
      FROM ams_performance_buffer
      WHERE accountId = ${accountId}
        AND DATE(eventTime) = ${date}
      GROUP BY DATE(eventTime), campaignId, adGroupId
    `) as any;

    return Array.isArray(rows) ? rows : [];
  } catch (error) {
    // AMS表可能不存在
    return [];
  }
}

/**
 * 根据策略融合数据
 */
function mergeDataByStrategy(
  apiData: any[],
  amsData: any[],
  strategy: MergeStrategy,
  today: string
): any[] {
  switch (strategy) {
    case 'ams_priority':
      return mergeAmsFirst(apiData, amsData, today);
    case 'api_priority':
      return mergeApiFirst(apiData, amsData);
    case 'weighted_merge':
      return weightedMerge(apiData, amsData);
    case 'latest_wins':
      return latestWinsMerge(apiData, amsData);
    default:
      return apiData;
  }
}

/**
 * AMS优先合并（用于实时展示）
 * 今天的数据用AMS，历史数据用API
 */
function mergeAmsFirst(apiData: any[], amsData: any[], today: string): any[] {
  // 过滤掉API中今天的数据
  const historicalApiData = apiData.filter(d => d.reportDate !== today);
  
  // 合并历史API数据和今天的AMS数据
  return [...historicalApiData, ...amsData];
}

/**
 * API优先合并（用于历史分析）
 */
function mergeApiFirst(apiData: any[], amsData: any[]): any[] {
  // API数据为主，AMS数据仅用于填补空白
  const apiDates = new Set(apiData.map(d => `${d.reportDate}-${d.campaignId}`));
  const missingAmsData = amsData.filter(d => !apiDates.has(`${d.reportDate}-${d.campaignId}`));
  
  return [...apiData, ...missingAmsData];
}

/**
 * 加权合并（用于报表导出）
 * API数据权重更高（准确性），AMS数据用于补充
 */
function weightedMerge(apiData: any[], amsData: any[]): any[] {
  const mergedMap = new Map<string, any>();
  
  // 先添加API数据（权重1.0）
  for (const item of apiData) {
    const key = `${item.reportDate}-${item.campaignId}`;
    mergedMap.set(key, { ...item, weight: 1.0 });
  }
  
  // 添加AMS数据（权重0.8，仅当API数据不存在时）
  for (const item of amsData) {
    const key = `${item.reportDate}-${item.campaignId}`;
    if (!mergedMap.has(key)) {
      mergedMap.set(key, { ...item, weight: 0.8 });
    }
  }
  
  return Array.from(mergedMap.values());
}

/**
 * 最新数据优先合并
 */
function latestWinsMerge(apiData: any[], amsData: any[]): any[] {
  const mergedMap = new Map<string, any>();
  
  // 合并所有数据，按更新时间排序
  const allData = [...apiData, ...amsData].sort((a, b) => {
    const timeA = new Date(a.updatedAt || a.lastUpdateTime || 0).getTime();
    const timeB = new Date(b.updatedAt || b.lastUpdateTime || 0).getTime();
    return timeB - timeA;
  });
  
  // 保留每个key的最新数据
  for (const item of allData) {
    const key = `${item.reportDate}-${item.campaignId}`;
    if (!mergedMap.has(key)) {
      mergedMap.set(key, item);
    }
  }
  
  return Array.from(mergedMap.values());
}

/**
 * 判断数据新鲜度
 */
function determineFreshness(
  apiData: any[],
  amsData: any[],
  strategy: MergeStrategy
): 'fresh' | 'stale' | 'mixed' {
  const now = Date.now();
  
  // 检查AMS数据新鲜度
  const amsIsFresh = amsData.some(d => {
    const updateTime = new Date(d.lastUpdateTime || 0).getTime();
    return (now - updateTime) < DATA_FRESHNESS_CONFIG.amsMaxAge * 60 * 1000;
  });
  
  // 检查API数据新鲜度
  const apiIsFresh = apiData.some(d => {
    const updateTime = new Date(d.updatedAt || 0).getTime();
    return (now - updateTime) < DATA_FRESHNESS_CONFIG.apiMaxAge * 60 * 1000;
  });
  
  if (strategy === 'ams_priority' && amsIsFresh) return 'fresh';
  if (strategy === 'api_priority' && apiIsFresh) return 'fresh';
  if (amsIsFresh || apiIsFresh) return 'mixed';
  return 'stale';
}

// ==================== 数据回补机制 ====================

/**
 * 检查并执行数据回补
 * 当AMS数据缺失时，自动使用API数据填补
 */
export async function checkAndBackfillData(
  accountId: number,
  date: string
): Promise<{
  needsBackfill: boolean;
  backfilledRecords: number;
  message: string;
}> {
  const db = await getDb();
  if (!db) {
    return { needsBackfill: false, backfilledRecords: 0, message: '数据库连接失败' };
  }

  try {
    // 检查AMS数据是否存在
    const [amsResult] = await db.execute(sql`
      SELECT COUNT(*) as count
      FROM ams_performance_buffer
      WHERE accountId = ${accountId}
        AND DATE(eventTime) = ${date}
    `) as any;

    const amsCount = Array.isArray(amsResult) && amsResult.length > 0 ? amsResult[0]?.count || 0 : 0;

    if (amsCount > 0) {
      return { needsBackfill: false, backfilledRecords: 0, message: 'AMS数据正常' };
    }

    // AMS数据缺失，检查API数据
    const [apiResult] = await db.execute(sql`
      SELECT COUNT(*) as count
      FROM daily_performance
      WHERE accountId = ${accountId}
        AND DATE(date) = ${date}
    `) as any;

    const apiCount = Array.isArray(apiResult) && apiResult.length > 0 ? apiResult[0]?.count || 0 : 0;

    if (apiCount === 0) {
      return { needsBackfill: false, backfilledRecords: 0, message: '无可用数据进行回补' };
    }

    // 标记需要回补，但实际回补由调度任务执行
    return {
      needsBackfill: true,
      backfilledRecords: apiCount,
      message: `检测到${date}的AMS数据缺失，可使用${apiCount}条API数据进行回补`,
    };
  } catch (error: any) {
    console.error('[EnhancedDualTrack] 数据回补检查失败:', error);
    return { needsBackfill: false, backfilledRecords: 0, message: error.message };
  }
}

// ==================== 时间线数据聚合 ====================

/**
 * 获取时间线聚合数据
 * 支持不同时间范围的数据查询和聚合
 */
export async function getTimelineAggregatedData(
  accountId: number,
  startDate: string,
  endDate: string,
  granularity: 'daily' | 'weekly' | 'monthly' = 'daily'
): Promise<{
  timeline: Array<{
    period: string;
    impressions: number;
    clicks: number;
    spend: number;
    sales: number;
    orders: number;
    ctr: number;
    cvr: number;
    acos: number;
    roas: number;
  }>;
  totals: {
    impressions: number;
    clicks: number;
    spend: number;
    sales: number;
    orders: number;
    ctr: number;
    cvr: number;
    acos: number;
    roas: number;
  };
  dataSource: DataSource;
}> {
  const db = await getDb();
  if (!db) {
    return {
      timeline: [],
      totals: { impressions: 0, clicks: 0, spend: 0, sales: 0, orders: 0, ctr: 0, cvr: 0, acos: 0, roas: 0 },
      dataSource: 'api',
    };
  }

  try {
    // 根据粒度确定分组方式
    let dateGrouping: string;
    switch (granularity) {
      case 'weekly':
        dateGrouping = 'YEARWEEK(date, 1)';
        break;
      case 'monthly':
        dateGrouping = "DATE_FORMAT(date, '%Y-%m')";
        break;
      default:
        dateGrouping = 'DATE(date)';
    }

    const [rows] = await db.execute(sql`
      SELECT 
        ${sql.raw(dateGrouping)} as period,
        SUM(impressions) as impressions,
        SUM(clicks) as clicks,
        SUM(spend) as spend,
        SUM(sales) as sales,
        SUM(orders) as orders
      FROM daily_performance
      WHERE accountId = ${accountId}
        AND DATE(date) >= ${startDate}
        AND DATE(date) <= ${endDate}
      GROUP BY ${sql.raw(dateGrouping)}
      ORDER BY period
    `) as any;

    const timeline = (Array.isArray(rows) ? rows : []).map((row: any) => ({
      period: String(row.period),
      impressions: Number(row.impressions) || 0,
      clicks: Number(row.clicks) || 0,
      spend: Number(row.spend) || 0,
      sales: Number(row.sales) || 0,
      orders: Number(row.orders) || 0,
      ctr: row.impressions > 0 ? (row.clicks / row.impressions) * 100 : 0,
      cvr: row.clicks > 0 ? (row.orders / row.clicks) * 100 : 0,
      acos: row.sales > 0 ? (row.spend / row.sales) * 100 : 0,
      roas: row.spend > 0 ? row.sales / row.spend : 0,
    }));

    // 计算总计
    const totals = timeline.reduce(
      (acc, item) => ({
        impressions: acc.impressions + item.impressions,
        clicks: acc.clicks + item.clicks,
        spend: acc.spend + item.spend,
        sales: acc.sales + item.sales,
        orders: acc.orders + item.orders,
        ctr: 0,
        cvr: 0,
        acos: 0,
        roas: 0,
      }),
      { impressions: 0, clicks: 0, spend: 0, sales: 0, orders: 0, ctr: 0, cvr: 0, acos: 0, roas: 0 }
    );

    // 计算总计的比率指标
    totals.ctr = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0;
    totals.cvr = totals.clicks > 0 ? (totals.orders / totals.clicks) * 100 : 0;
    totals.acos = totals.sales > 0 ? (totals.spend / totals.sales) * 100 : 0;
    totals.roas = totals.spend > 0 ? totals.sales / totals.spend : 0;

    return { timeline, totals, dataSource: 'api' };
  } catch (error: any) {
    console.error('[EnhancedDualTrack] 获取时间线数据失败:', error);
    return {
      timeline: [],
      totals: { impressions: 0, clicks: 0, spend: 0, sales: 0, orders: 0, ctr: 0, cvr: 0, acos: 0, roas: 0 },
      dataSource: 'api',
    };
  }
}

// ==================== 实时数据展示优化 ====================

/**
 * 获取实时仪表盘数据
 * 区分可信和不可信字段
 */
export async function getRealtimeDashboardData(
  accountId: number
): Promise<{
  trusted: {
    todaySpend: number;
    todayClicks: number;
    todayImpressions: number;
    lastUpdate: Date | null;
  };
  untrusted: {
    todaySales: number;
    todayOrders: number;
    todayRoas: number;
    todayAcos: number;
    warning: string;
  };
  dataSource: 'ams' | 'api';
}> {
  const db = await getDb();
  const today = new Date().toISOString().split('T')[0];
  
  const defaultResult = {
    trusted: { todaySpend: 0, todayClicks: 0, todayImpressions: 0, lastUpdate: null },
    untrusted: { todaySales: 0, todayOrders: 0, todayRoas: 0, todayAcos: 0, warning: '转化数据有12-48小时归因延迟' },
    dataSource: 'api' as const,
  };

  if (!db) return defaultResult;

  try {
    // 尝试获取AMS实时数据
    let dataSource: 'ams' | 'api' = 'api';
    let result: any = null;

    try {
      const [amsRows] = await db.execute(sql`
        SELECT 
          SUM(spend) as spend,
          SUM(clicks) as clicks,
          SUM(impressions) as impressions,
          SUM(sales) as sales,
          SUM(orders) as orders,
          MAX(eventTime) as lastUpdate
        FROM ams_performance_buffer
        WHERE accountId = ${accountId}
          AND DATE(eventTime) = ${today}
      `) as any;

      if (Array.isArray(amsRows) && amsRows.length > 0 && amsRows[0]?.spend !== null) {
        result = amsRows[0];
        dataSource = 'ams';
      }
    } catch {
      // AMS表可能不存在
    }

    // 回退到API数据
    if (!result) {
      const [apiRows] = await db.execute(sql`
        SELECT 
          SUM(spend) as spend,
          SUM(clicks) as clicks,
          SUM(impressions) as impressions,
          SUM(sales) as sales,
          SUM(orders) as orders,
          MAX(updatedAt) as lastUpdate
        FROM daily_performance
        WHERE accountId = ${accountId}
          AND DATE(date) = ${today}
      `) as any;

      result = Array.isArray(apiRows) && apiRows.length > 0 ? apiRows[0] : null;
    }

    if (!result) return defaultResult;

    const spend = Number(result.spend) || 0;
    const sales = Number(result.sales) || 0;

    return {
      trusted: {
        todaySpend: spend,
        todayClicks: Number(result.clicks) || 0,
        todayImpressions: Number(result.impressions) || 0,
        lastUpdate: result.lastUpdate ? new Date(result.lastUpdate) : null,
      },
      untrusted: {
        todaySales: sales,
        todayOrders: Number(result.orders) || 0,
        todayRoas: spend > 0 ? sales / spend : 0,
        todayAcos: sales > 0 ? (spend / sales) * 100 : 0,
        warning: '转化数据有12-48小时归因延迟，仅供参考',
      },
      dataSource,
    };
  } catch (error: any) {
    console.error('[EnhancedDualTrack] 获取实时仪表盘数据失败:', error);
    return defaultResult;
  }
}

// ==================== 导出 ====================

export default {
  getSmartMergedData,
  checkAndBackfillData,
  getTimelineAggregatedData,
  getRealtimeDashboardData,
  DATA_FRESHNESS_CONFIG,
};
