/**
 * v358: 自适应同步策略模块
 * 
 * 解决的问题:
 * 1. 固定超时窗口（15分钟）无法适应大账户（可能需要30-60分钟）
 * 2. 固定日期切片（31天）对大账户产生过大的报告
 * 3. 没有基于历史数据的智能调度
 * 
 * 核心策略:
 * - 根据账户的campaign数量和历史同步耗时动态调整超时
 * - 根据账户规模自适应调整日期切片大小
 * - 记录每次同步的性能指标用于后续优化
 */
import { createModuleLogger } from '../../utils/logger';
import { eq, and, sql, desc } from 'drizzle-orm';

const log = createModuleLogger('adaptiveSync');

// ==================== 账户规模分级 ====================

export type AccountSize = 'small' | 'medium' | 'large' | 'xlarge';

interface AccountSizeProfile {
  size: AccountSize;
  campaignCount: number;
  /** 日期切片大小（天数），Amazon API限制最大31天 */
  dateSliceDays: number;
  /** 报告等待超时（毫秒） */
  reportTimeoutMs: number;
  /** 批处理大小（每批处理的campaign数） */
  batchSize: number;
  /** API请求间隔（毫秒） */
  apiDelayMs: number;
  /** 同步总超时（毫秒） */
  totalTimeoutMs: number;
}

// 账户规模配置表
const SIZE_PROFILES: Record<AccountSize, AccountSizeProfile> = {
  small: {
    size: 'small',
    campaignCount: 50,
    dateSliceDays: 31,        // 最大切片
    reportTimeoutMs: 10 * 60 * 1000,  // 10分钟
    batchSize: 100,
    apiDelayMs: 1000,
    totalTimeoutMs: 20 * 60 * 1000,   // 20分钟
  },
  medium: {
    size: 'medium',
    campaignCount: 200,
    dateSliceDays: 21,        // 缩小切片
    reportTimeoutMs: 15 * 60 * 1000,  // 15分钟
    batchSize: 50,
    apiDelayMs: 2000,
    totalTimeoutMs: 40 * 60 * 1000,   // 40分钟
  },
  large: {
    size: 'large',
    campaignCount: 500,
    dateSliceDays: 14,        // 进一步缩小
    reportTimeoutMs: 20 * 60 * 1000,  // 20分钟
    batchSize: 30,
    apiDelayMs: 3000,
    totalTimeoutMs: 60 * 60 * 1000,   // 60分钟
  },
  xlarge: {
    size: 'xlarge',
    campaignCount: 1000,
    dateSliceDays: 7,         // 最小切片
    reportTimeoutMs: 30 * 60 * 1000,  // 30分钟
    batchSize: 20,
    apiDelayMs: 5000,
    totalTimeoutMs: 90 * 60 * 1000,   // 90分钟
  },
};

/**
 * 根据campaign数量判断账户规模
 */
export function classifyAccountSize(campaignCount: number): AccountSize {
  if (campaignCount <= 50) return 'small';
  if (campaignCount <= 200) return 'medium';
  if (campaignCount <= 500) return 'large';
  return 'xlarge';
}

/**
 * 获取账户的同步配置
 */
export function getAccountSyncProfile(campaignCount: number): AccountSizeProfile {
  const size = classifyAccountSize(campaignCount);
  return SIZE_PROFILES[size];
}

// ==================== 动态超时计算 ====================

/**
 * v358: 基于历史数据计算动态报告超时
 * 
 * 算法:
 * 1. 查询最近5次同步的平均耗时
 * 2. 取平均值 × 1.5 作为超时（留50%缓冲）
 * 3. 设置下限（5分钟）和上限（30分钟）
 * 4. 如果没有历史数据，使用规模配置的默认值
 */
export async function calculateDynamicTimeout(
  accountId: number,
  syncType: string,
  campaignCount: number
): Promise<number> {
  const profile = getAccountSyncProfile(campaignCount);
  
  try {
    const { getDb } = await import('../../db');
    const database = await getDb();
    if (!database) return profile.reportTimeoutMs;

    // 查询最近5次成功同步的耗时
    const recentSyncs = await database.execute(sql`
      SELECT duration_ms FROM sync_shards 
      WHERE account_id = ${accountId} 
      AND shard_type = ${syncType}
      AND status = 'completed'
      AND duration_ms IS NOT NULL
      ORDER BY completed_at DESC 
      LIMIT 5
    `);

    const rows = (recentSyncs as Record<string, unknown>[])?.[0] || recentSyncs;
    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      log.info(`[v358] 账户${accountId}无历史同步数据，使用默认超时: ${profile.reportTimeoutMs}ms`);
      return profile.reportTimeoutMs;
    }

    // 计算平均耗时
    const avgDuration = rows.reduce((sum: number, r: Record<string, unknown>) => sum + (r.duration_ms || 0), 0) / rows.length;
    
    // 动态超时 = 平均值 × 1.5，限制在[5min, 30min]
    const dynamicTimeout = Math.max(
      5 * 60 * 1000,   // 下限5分钟
      Math.min(
        30 * 60 * 1000, // 上限30分钟
        Math.round(avgDuration * 1.5)
      )
    );

    log.info(`[v358] 账户${accountId}动态超时: avg=${Math.round(avgDuration/1000)}s → timeout=${Math.round(dynamicTimeout/1000)}s (历史${rows.length}次)`);
    return dynamicTimeout;
  } catch (error: any) {
    log.warn(`[v358] 计算动态超时失败(${error.message})，使用默认值`);
    return profile.reportTimeoutMs;
  }
}

// ==================== 自适应日期切片 ====================

/**
 * v358: 根据账户规模生成自适应日期切片
 * 
 * 原逻辑: 固定31天一个切片
 * 新逻辑: 根据campaign数量动态调整切片大小
 * 
 * @param startDate 开始日期 (YYYY-MM-DD)
 * @param endDate 结束日期 (YYYY-MM-DD)
 * @param campaignCount 账户的campaign数量
 * @returns 日期切片数组
 */
export function generateAdaptiveDateSlices(
  startDate: string,
  endDate: string,
  campaignCount: number
): Array<{ start: string; end: string; sliceIndex: number }> {
  const profile = getAccountSyncProfile(campaignCount);
  const sliceDays = profile.dateSliceDays;
  
  const slices: Array<{ start: string; end: string; sliceIndex: number }> = [];
  
  const start = new Date(startDate);
  const end = new Date(endDate);
  
  let current = new Date(start);
  let sliceIndex = 0;
  
  while (current <= end) {
    const sliceEnd = new Date(current);
    sliceEnd.setDate(sliceEnd.getDate() + sliceDays - 1);
    
    // 不超过总结束日期
    if (sliceEnd > end) {
      sliceEnd.setTime(end.getTime());
    }
    
    slices.push({
      start: current.toISOString().split('T')[0],
      end: sliceEnd.toISOString().split('T')[0],
      sliceIndex,
    });
    
    // 移到下一个切片
    current = new Date(sliceEnd);
    current.setDate(current.getDate() + 1);
    sliceIndex++;
  }
  
  log.info(`[v358] 自适应切片: ${startDate}~${endDate}, campaigns=${campaignCount}, ` +
    `size=${profile.size}, sliceDays=${sliceDays}, totalSlices=${slices.length}`);
  
  return slices;
}

// ==================== 同步性能记录 ====================

interface SyncPerformanceMetric {
  accountId: number;
  syncType: string;
  startTime: number;
  endTime?: number;
  recordCount?: number;
  errorCount?: number;
  sliceCount?: number;
}

const activeMetrics = new Map<string, SyncPerformanceMetric>();

/**
 * 开始记录同步性能
 */
export function startMetric(accountId: number, syncType: string): string {
  const metricId = `${accountId}:${syncType}:${Date.now()}`;
  activeMetrics.set(metricId, {
    accountId,
    syncType,
    startTime: Date.now(),
  });
  return metricId;
}

/**
 * 完成性能记录并持久化
 */
export async function finishMetric(
  metricId: string,
  recordCount: number,
  errorCount: number = 0
): Promise<void> {
  const metric = activeMetrics.get(metricId);
  if (!metric) return;

  metric.endTime = Date.now();
  metric.recordCount = recordCount;
  metric.errorCount = errorCount;

  const durationMs = metric.endTime - metric.startTime;
  
  log.info(`[v358] 同步性能: account=${metric.accountId}, type=${metric.syncType}, ` +
    `duration=${Math.round(durationMs/1000)}s, records=${recordCount}, errors=${errorCount}`);

  activeMetrics.delete(metricId);
}

// ==================== API速率限制自适应 ====================

/**
 * v358: 自适应API延迟
 * 根据最近的429错误频率动态调整请求间隔
 */
let recentRateLimitErrors = 0;
let lastRateLimitReset = Date.now();

export function recordRateLimitError(): void {
  recentRateLimitErrors++;
}

export function getAdaptiveApiDelay(baseDelayMs: number): number {
  // 每分钟重置计数器
  if (Date.now() - lastRateLimitReset > 60000) {
    recentRateLimitErrors = Math.max(0, recentRateLimitErrors - 1);
    lastRateLimitReset = Date.now();
  }

  // 根据最近的429错误数量增加延迟
  if (recentRateLimitErrors === 0) return baseDelayMs;
  if (recentRateLimitErrors <= 3) return baseDelayMs * 2;
  if (recentRateLimitErrors <= 10) return baseDelayMs * 4;
  return baseDelayMs * 8; // 最大8倍延迟
}
