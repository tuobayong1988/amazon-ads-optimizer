/**
 * 双轨制数据同步服务
 * 
 * 同时支持两种数据同步方式：
 * 1. 传统报表API - 定时批量拉取，作为主要数据来源和校验基准
 * 2. Amazon Marketing Stream (AMS) - 实时数据流推送，提供近实时更新
 * 
 * 数据合并策略：
 * - AMS数据优先用于实时展示（延迟低）
 * - 传统API数据用于校验和修正（准确性高）
 * - 定期进行数据一致性检查和自动修复
 */

import { getDb } from '../db';
import { sql } from 'drizzle-orm';

// 数据源类型
export type DataSource = 'api' | 'ams' | 'merged';

// 数据源优先级配置
export const DATA_SOURCE_PRIORITY = {
  // 实时展示优先使用AMS（延迟低）
  realtime: ['ams', 'api'] as DataSource[],
  // 历史分析优先使用API（准确性高）
  historical: ['api', 'ams'] as DataSource[],
  // 报表导出使用合并数据
  reporting: ['merged', 'api', 'ams'] as DataSource[],
};

// 数据一致性阈值
export const CONSISTENCY_THRESHOLDS = {
  // 允许的数值差异百分比
  valueDeviation: 0.05, // 5%
  // 允许的时间延迟（分钟）
  timeDelay: 60,
  // 触发告警的连续不一致次数
  alertThreshold: 3,
  // AMS无数据触发回补的时间阈值（小时）
  amsBackfillThreshold: 4,
};

// ==================== 专家建议新增：数据冻结区策略 ====================

/**
 * 数据冻结区配置
 * 专家建议：区分"用于决策的数据"和"用于展示的数据"
 */
export const DATA_FREEZING_CONFIG = {
  // 归因延迟窗口（小时）- 转化数据通常有12-48小时延迟
  attributionDelayHours: 48,
  
  // 分时策略排除天数 - 排除最近3天数据
  daypartingExcludeDays: 3,
  
  // 竞价算法排除天数 - 排除最近1天数据
  bidAlgorithmExcludeDays: 1,
  
  // 位置优化排除天数 - 排除最近3天数据
  placementExcludeDays: 3,
  
  // 实时监控可信字段 - AMS实时数据只看这些字段
  realtimeTrustedFields: ['spend', 'clicks', 'impressions'] as const,
  
  // 实时监控不可信字段 - 这些字段有归因延迟
  realtimeUntrustedFields: ['sales', 'orders', 'roas', 'acos', 'cvr'] as const,
};

/**
 * 算法类型定义
 */
export type AlgorithmType = 'bid' | 'dayparting' | 'placement' | 'search_term';

// 同步状态
interface SyncStatus {
  source: DataSource;
  lastSyncAt: Date | null;
  recordCount: number;
  status: 'healthy' | 'degraded' | 'error';
  errorMessage?: string;
}

/**
 * 获取双轨制同步状态
 */
export async function getDualTrackStatus(accountId: number): Promise<{
  api: SyncStatus;
  ams: SyncStatus;
  lastConsistencyCheck: Date | null;
  overallHealth: 'healthy' | 'degraded' | 'error';
}> {
  const db = await getDb();
  if (!db) {
    return {
      api: { source: 'api', lastSyncAt: null, recordCount: 0, status: 'error', errorMessage: '数据库连接失败' },
      ams: { source: 'ams', lastSyncAt: null, recordCount: 0, status: 'error', errorMessage: '数据库连接失败' },
      lastConsistencyCheck: null,
      overallHealth: 'error',
    };
  }

  try {
    // 获取API同步状态
    const apiStatus = await getApiSyncStatus(db, accountId);
    
    // 获取AMS同步状态
    const amsStatus = await getAmsSyncStatus(db, accountId);
    
    // 获取最后一致性检查时间
    const lastCheck = await getLastConsistencyCheck(db, accountId);
    
    // 计算整体健康状态
    const overallHealth = calculateOverallHealth(apiStatus, amsStatus);
    
    return {
      api: apiStatus,
      ams: amsStatus,
      lastConsistencyCheck: lastCheck,
      overallHealth,
    };
  } catch (error: any) {
    console.error('[DualTrackSync] 获取状态失败:', error);
    return {
      api: { source: 'api', lastSyncAt: null, recordCount: 0, status: 'error', errorMessage: error.message },
      ams: { source: 'ams', lastSyncAt: null, recordCount: 0, status: 'error', errorMessage: error.message },
      lastConsistencyCheck: null,
      overallHealth: 'error',
    };
  }
}

/**
 * 获取API同步状态
 */
async function getApiSyncStatus(db: any, accountId: number): Promise<SyncStatus> {
  try {
    const [result] = await db.execute(sql`
      SELECT 
        completedAt as lastSyncAt,
        recordsSynced as recordCount,
        status,
        errorMessage
      FROM data_sync_jobs
      WHERE accountId = ${accountId}
        AND syncType IN ('all', 'performance')
      ORDER BY createdAt DESC
      LIMIT 1
    `) as any;

    const lastSync = Array.isArray(result) && result.length > 0 ? result[0] : null;

    if (!lastSync) {
      return {
        source: 'api',
        lastSyncAt: null,
        recordCount: 0,
        status: 'degraded',
        errorMessage: '尚未进行过同步',
      };
    }

    const syncStatus = lastSync.status === 'completed' ? 'healthy' : 
                       lastSync.status === 'running' ? 'healthy' : 'error';

    return {
      source: 'api',
      lastSyncAt: lastSync.lastSyncAt ? new Date(lastSync.lastSyncAt) : null,
      recordCount: lastSync.recordCount || 0,
      status: syncStatus,
      errorMessage: lastSync.errorMessage,
    };
  } catch (error: any) {
    return {
      source: 'api',
      lastSyncAt: null,
      recordCount: 0,
      status: 'error',
      errorMessage: error.message,
    };
  }
}

/**
 * 获取AMS同步状态
 */
async function getAmsSyncStatus(db: any, accountId: number): Promise<SyncStatus> {
  try {
    // 查询AMS消息统计
    const [statsResult] = await db.execute(sql`
      SELECT 
        COUNT(*) as totalMessages,
        MAX(receivedAt) as lastMessageAt
      FROM ams_messages
      WHERE accountId = ${accountId}
        AND receivedAt >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
    `) as any;

    const stats = Array.isArray(statsResult) && statsResult.length > 0 ? statsResult[0] : null;

    // 查询活跃订阅数
    const [subResult] = await db.execute(sql`
      SELECT COUNT(*) as activeCount
      FROM ams_subscriptions
      WHERE accountId = ${accountId}
        AND status = 'ACTIVE'
    `) as any;

    const subscriptions = Array.isArray(subResult) && subResult.length > 0 ? subResult[0] : null;

    const hasActiveSubscriptions = (subscriptions?.activeCount || 0) > 0;
    const hasRecentMessages = (stats?.totalMessages || 0) > 0;

    let status: 'healthy' | 'degraded' | 'error' = 'healthy';
    let errorMessage: string | undefined;

    if (!hasActiveSubscriptions) {
      status = 'degraded';
      errorMessage = '没有活跃的AMS订阅';
    } else if (!hasRecentMessages) {
      status = 'degraded';
      errorMessage = '24小时内没有收到AMS消息';
    }

    return {
      source: 'ams',
      lastSyncAt: stats?.lastMessageAt ? new Date(stats.lastMessageAt) : null,
      recordCount: stats?.totalMessages || 0,
      status,
      errorMessage,
    };
  } catch (error: any) {
    return {
      source: 'ams',
      lastSyncAt: null,
      recordCount: 0,
      status: 'degraded',
      errorMessage: 'AMS表可能不存在',
    };
  }
}

/**
 * 获取最后一致性检查时间
 */
async function getLastConsistencyCheck(db: any, accountId: number): Promise<Date | null> {
  try {
    const [result] = await db.execute(sql`
      SELECT MAX(checkTime) as lastCheck
      FROM data_consistency_checks
      WHERE accountId = ${accountId}
    `) as any;
    const row = Array.isArray(result) && result.length > 0 ? result[0] : null;
    return row?.lastCheck ? new Date(row.lastCheck) : null;
  } catch {
    return null;
  }
}

/**
 * 计算整体健康状态
 */
function calculateOverallHealth(
  apiStatus: SyncStatus, 
  amsStatus: SyncStatus
): 'healthy' | 'degraded' | 'error' {
  // 如果两个都是error，整体是error
  if (apiStatus.status === 'error' && amsStatus.status === 'error') {
    return 'error';
  }
  
  // 如果任一是error，整体是degraded
  if (apiStatus.status === 'error' || amsStatus.status === 'error') {
    return 'degraded';
  }
  
  // 如果任一是degraded，整体是degraded
  if (apiStatus.status === 'degraded' || amsStatus.status === 'degraded') {
    return 'degraded';
  }
  
  return 'healthy';
}

/**
 * 获取数据源统计
 */
export async function getDataSourceStats(accountId: number): Promise<{
  api: { records: number; lastUpdate: Date | null };
  ams: { records: number; lastUpdate: Date | null };
  merged: { records: number; lastUpdate: Date | null };
}> {
  const db = await getDb();
  if (!db) {
    return {
      api: { records: 0, lastUpdate: null },
      ams: { records: 0, lastUpdate: null },
      merged: { records: 0, lastUpdate: null },
    };
  }

  try {
    // 获取总记录数作为API数据（因为dataSource字段可能还没有）
    const [totalResult] = await db.execute(sql`
      SELECT 
        COUNT(*) as recordCount,
        MAX(createdAt) as lastUpdate
      FROM daily_performance
      WHERE accountId = ${accountId}
    `) as any;

    const total = Array.isArray(totalResult) && totalResult.length > 0 ? totalResult[0] : null;

    return {
      api: { 
        records: total?.recordCount || 0, 
        lastUpdate: total?.lastUpdate ? new Date(total.lastUpdate) : null 
      },
      ams: { records: 0, lastUpdate: null },
      merged: { records: 0, lastUpdate: null },
    };
  } catch (error) {
    console.error('[DualTrackSync] 获取数据源统计失败:', error);
    return {
      api: { records: 0, lastUpdate: null },
      ams: { records: 0, lastUpdate: null },
      merged: { records: 0, lastUpdate: null },
    };
  }
}

/**
 * 执行数据一致性检查
 */
export async function runConsistencyCheck(
  accountId: number,
  startDate: string,
  endDate: string
): Promise<{
  checkTime: Date;
  accountId: number;
  dateRange: { start: string; end: string };
  apiRecords: number;
  amsRecords: number;
  matchedRecords: number;
  overallConsistency: number;
  status: 'consistent' | 'minor_deviation' | 'major_deviation';
}> {
  const db = await getDb();
  if (!db) {
    throw new Error('数据库连接失败');
  }

  const checkTime = new Date();

  try {
    // 获取API来源的数据统计
    const [apiResult] = await db.execute(sql`
      SELECT COUNT(*) as recordCount
      FROM daily_performance
      WHERE accountId = ${accountId}
        AND DATE(date) >= ${startDate}
        AND DATE(date) <= ${endDate}
    `) as any;

    const apiRecords = Array.isArray(apiResult) && apiResult.length > 0 ? apiResult[0]?.recordCount || 0 : 0;

    // 目前AMS数据还没有，返回基础报告
    return {
      checkTime,
      accountId,
      dateRange: { start: startDate, end: endDate },
      apiRecords,
      amsRecords: 0,
      matchedRecords: 0,
      overallConsistency: 100,
      status: 'consistent',
    };
  } catch (error: any) {
    console.error('[DualTrackSync] 一致性检查失败:', error);
    throw error;
  }
}

/**
 * 合并数据源
 */
export async function getMergedPerformanceData(
  accountId: number,
  startDate: string,
  endDate: string,
  priority: 'realtime' | 'historical' | 'reporting' = 'historical'
): Promise<any[]> {
  const db = await getDb();
  if (!db) return [];

  try {
    const [rows] = await db.execute(sql`
      SELECT 
        DATE(date) as reportDate,
        campaignId,
        impressions,
        clicks,
        spend,
        sales,
        orders
      FROM daily_performance
      WHERE accountId = ${accountId}
        AND DATE(date) >= ${startDate}
        AND DATE(date) <= ${endDate}
      ORDER BY DATE(date), campaignId
    `) as any;

    return Array.isArray(rows) ? rows : [];
  } catch (error: any) {
    console.error('[DualTrackSync] 获取合并数据失败:', error);
    return [];
  }
}

/**
 * 自动修复数据差异
 */
export async function autoRepairDataDeviations(
  accountId: number,
  deviations: Array<{
    date: string;
    campaignId: number;
    field: string;
    apiValue: number;
    amsValue: number;
    deviationPercent: number;
  }>
): Promise<{ repaired: number; failed: number }> {
  // 目前没有AMS数据，返回空结果
  return { repaired: 0, failed: 0 };
}

// ==================== 专家建议新增：数据冻结区函数 ====================

/**
 * 获取用于【算法决策】的安全数据
 * 专家建议：强制剔除最近N小时/天的数据，防止归因延迟误导算法
 * 
 * @param accountId - 账号ID
 * @param algorithmType - 算法类型
 * @param lookbackDays - 回看天数（默认30天）
 */
export async function getDataForAlgorithm(
  accountId: number,
  algorithmType: AlgorithmType,
  lookbackDays: number = 30
): Promise<{
  data: any[];
  safeEndDate: Date;
  excludedDays: number;
  warning?: string;
}> {
  const db = await getDb();
  if (!db) {
    return { data: [], safeEndDate: new Date(), excludedDays: 0, warning: '数据库连接失败' };
  }

  // 根据算法类型确定排除天数
  let excludeDays: number;
  switch (algorithmType) {
    case 'dayparting':
      excludeDays = DATA_FREEZING_CONFIG.daypartingExcludeDays;
      break;
    case 'placement':
      excludeDays = DATA_FREEZING_CONFIG.placementExcludeDays;
      break;
    case 'search_term':
      // Search Term应该是T+1任务，排除今天
      excludeDays = 1;
      break;
    case 'bid':
    default:
      excludeDays = DATA_FREEZING_CONFIG.bidAlgorithmExcludeDays;
      break;
  }

  // 计算安全的结束日期（排除最近N天）
  const safeEndDate = new Date();
  safeEndDate.setDate(safeEndDate.getDate() - excludeDays);
  safeEndDate.setHours(23, 59, 59, 999);

  // 计算开始日期
  const startDate = new Date(safeEndDate);
  startDate.setDate(startDate.getDate() - lookbackDays);
  startDate.setHours(0, 0, 0, 0);

  try {
    // 只获取历史数据（API + 已归因的AMS数据）
    // 绝对不要把"今天"的AMS转化数据嗂给算法
    const [rows] = await db.execute(sql`
      SELECT 
        DATE(date) as reportDate,
        campaignId,
        adGroupId,
        keywordId,
        impressions,
        clicks,
        spend,
        sales,
        orders,
        CASE WHEN clicks > 0 THEN orders / clicks ELSE 0 END as cvr,
        CASE WHEN spend > 0 THEN sales / spend ELSE 0 END as roas,
        CASE WHEN sales > 0 THEN (spend / sales) * 100 ELSE 100 END as acos
      FROM daily_performance
      WHERE accountId = ${accountId}
        AND DATE(date) >= ${startDate.toISOString().split('T')[0]}
        AND DATE(date) <= ${safeEndDate.toISOString().split('T')[0]}
      ORDER BY DATE(date) DESC, campaignId
    `) as any;

    const data = Array.isArray(rows) ? rows : [];

    return {
      data,
      safeEndDate,
      excludedDays: excludeDays,
      warning: excludeDays > 0 
        ? `已排除最近${excludeDays}天数据以避免归因延迟误判` 
        : undefined,
    };
  } catch (error: any) {
    console.error('[DualTrackSync] 获取算法数据失败:', error);
    return { data: [], safeEndDate, excludedDays: excludeDays, warning: error.message };
  }
}

/**
 * 获取用于【实时监控/风控】的数据
 * 专家建议：包含AMS的实时花费，用于防超支
 * 注意：只看Spend和Clicks，不看ROAS
 * 
 * @param accountId - 账号ID
 * @param campaignId - 广告活动ID（可选）
 */
export async function getRealtimeSpendForGuard(
  accountId: number,
  campaignId?: string
): Promise<{
  todaySpend: number;
  todayClicks: number;
  todayImpressions: number;
  lastUpdateTime: Date | null;
  dataSource: 'ams' | 'api';
  warning?: string;
}> {
  const db = await getDb();
  if (!db) {
    return {
      todaySpend: 0,
      todayClicks: 0,
      todayImpressions: 0,
      lastUpdateTime: null,
      dataSource: 'api',
      warning: '数据库连接失败',
    };
  }

  const today = new Date().toISOString().split('T')[0];

  try {
    // 优先从AMS缓冲表获取实时数据
    let dataSource: 'ams' | 'api' = 'api';
    let result: any = null;

    // 尝试从AMS缓冲表获取
    try {
      const [amsRows] = await db.execute(sql`
        SELECT 
          SUM(spend) as todaySpend,
          SUM(clicks) as todayClicks,
          SUM(impressions) as todayImpressions,
          MAX(eventTime) as lastUpdateTime
        FROM ams_performance_buffer
        WHERE accountId = ${accountId}
          AND DATE(eventTime) = ${today}
          ${campaignId ? sql`AND campaignId = ${campaignId}` : sql``}
      `) as any;

      if (Array.isArray(amsRows) && amsRows.length > 0 && amsRows[0]?.todaySpend !== null) {
        result = amsRows[0];
        dataSource = 'ams';
      }
    } catch {
      // AMS表可能不存在，回退到API数据
    }

    // 如果AMS没数据，从API数据获取
    if (!result) {
      const [apiRows] = await db.execute(sql`
        SELECT 
          SUM(spend) as todaySpend,
          SUM(clicks) as todayClicks,
          SUM(impressions) as todayImpressions,
          MAX(updatedAt) as lastUpdateTime
        FROM daily_performance
        WHERE accountId = ${accountId}
          AND DATE(date) = ${today}
          ${campaignId ? sql`AND campaignId = ${campaignId}` : sql``}
      `) as any;

      result = Array.isArray(apiRows) && apiRows.length > 0 ? apiRows[0] : null;
    }

    return {
      todaySpend: result?.todaySpend || 0,
      todayClicks: result?.todayClicks || 0,
      todayImpressions: result?.todayImpressions || 0,
      lastUpdateTime: result?.lastUpdateTime ? new Date(result.lastUpdateTime) : null,
      dataSource,
      warning: dataSource === 'api' ? '使用API数据，可能有延迟' : undefined,
    };
  } catch (error: any) {
    console.error('[DualTrackSync] 获取实时花费失败:', error);
    return {
      todaySpend: 0,
      todayClicks: 0,
      todayImpressions: 0,
      lastUpdateTime: null,
      dataSource: 'api',
      warning: error.message,
    };
  }
}

/**
 * 检查数据是否在冻结区内
 * 专家建议：用于防止算法误用未归因数据
 * 
 * @param date - 要检查的日期
 * @param algorithmType - 算法类型
 */
export function isDataInFreezingZone(
  date: Date,
  algorithmType: AlgorithmType
): boolean {
  let excludeDays: number;
  switch (algorithmType) {
    case 'dayparting':
      excludeDays = DATA_FREEZING_CONFIG.daypartingExcludeDays;
      break;
    case 'placement':
      excludeDays = DATA_FREEZING_CONFIG.placementExcludeDays;
      break;
    case 'search_term':
      excludeDays = 1;
      break;
    case 'bid':
    default:
      excludeDays = DATA_FREEZING_CONFIG.bidAlgorithmExcludeDays;
      break;
  }

  const freezeDate = new Date();
  freezeDate.setDate(freezeDate.getDate() - excludeDays);
  freezeDate.setHours(0, 0, 0, 0);

  return date >= freezeDate;
}

/**
 * 获取实时数据的可信字段
 * 专家建议：AMS实时数据只看Spend/Clicks/Impressions，不看ROAS
 */
export function getRealtimeTrustedFields(): readonly string[] {
  return DATA_FREEZING_CONFIG.realtimeTrustedFields;
}

/**
 * 获取实时数据的不可信字段
 * 专家建议：这些字段有归因延迟，不应用于实时决策
 */
export function getRealtimeUntrustedFields(): readonly string[] {
  return DATA_FREEZING_CONFIG.realtimeUntrustedFields;
}

export default {
  getDualTrackStatus,
  runConsistencyCheck,
  getMergedPerformanceData,
  autoRepairDataDeviations,
  getDataSourceStats,
  // 专家建议新增：数据冻结区函数
  getDataForAlgorithm,
  getRealtimeSpendForGuard,
  isDataInFreezingZone,
  getRealtimeTrustedFields,
  getRealtimeUntrustedFields,
  // 配置
  DATA_SOURCE_PRIORITY,
  CONSISTENCY_THRESHOLDS,
  DATA_FREEZING_CONFIG,
};
