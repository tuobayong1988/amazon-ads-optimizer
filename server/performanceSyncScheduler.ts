/**
 * 绩效数据定期同步调度器
 * 实现每日自动同步绩效数据
 */

import * as db from './db';
import { createPerformanceSyncRequests, startReportPolling, stopReportPolling } from './asyncReportService';
import { sql } from 'drizzle-orm';

// 调度器状态
interface SchedulerStatus {
  isRunning: boolean;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  totalSyncs: number;
  failedSyncs: number;
  errors: string[];
}

const schedulerStatus: SchedulerStatus = {
  isRunning: false,
  lastRunAt: null,
  nextRunAt: null,
  totalSyncs: 0,
  failedSyncs: 0,
  errors: [],
};

let schedulerIntervalId: NodeJS.Timeout | null = null;

// 默认同步时间（每天凌晨2点）
const DEFAULT_SYNC_HOUR = 2;
const DEFAULT_SYNC_MINUTE = 0;

// 检查间隔（每5分钟检查一次是否需要同步）
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

/**
 * 启动绩效数据同步调度器
 */
export function startPerformanceSyncScheduler(): void {
  if (schedulerStatus.isRunning) {
    console.log('[PerformanceSyncScheduler] 调度器已在运行');
    return;
  }

  schedulerStatus.isRunning = true;
  console.log('[PerformanceSyncScheduler] 启动绩效数据同步调度器...');

  // 启动报告轮询服务
  startReportPolling();

  // 计算下次同步时间
  schedulerStatus.nextRunAt = calculateNextSyncTime();
  console.log(`[PerformanceSyncScheduler] 下次同步时间: ${schedulerStatus.nextRunAt.toISOString()}`);

  // 启动定时检查
  schedulerIntervalId = setInterval(async () => {
    await checkAndExecuteSync();
  }, CHECK_INTERVAL_MS);

  console.log('[PerformanceSyncScheduler] 调度器已启动');
}

/**
 * 停止绩效数据同步调度器
 */
export function stopPerformanceSyncScheduler(): void {
  if (!schedulerStatus.isRunning) {
    console.log('[PerformanceSyncScheduler] 调度器未在运行');
    return;
  }

  schedulerStatus.isRunning = false;

  if (schedulerIntervalId) {
    clearInterval(schedulerIntervalId);
    schedulerIntervalId = null;
  }

  // 停止报告轮询服务
  stopReportPolling();

  console.log('[PerformanceSyncScheduler] 调度器已停止');
}

/**
 * 计算下次同步时间
 */
function calculateNextSyncTime(): Date {
  const now = new Date();
  const nextSync = new Date(now);
  
  nextSync.setHours(DEFAULT_SYNC_HOUR, DEFAULT_SYNC_MINUTE, 0, 0);
  
  // 如果今天的同步时间已过，设置为明天
  if (nextSync <= now) {
    nextSync.setDate(nextSync.getDate() + 1);
  }
  
  return nextSync;
}

/**
 * 检查并执行同步
 */
async function checkAndExecuteSync(): Promise<void> {
  const now = new Date();
  
  if (!schedulerStatus.nextRunAt || now < schedulerStatus.nextRunAt) {
    return;
  }

  console.log('[PerformanceSyncScheduler] 开始执行定时同步...');
  schedulerStatus.lastRunAt = now;

  try {
    await executePerformanceSync();
    schedulerStatus.totalSyncs++;
  } catch (error: any) {
    schedulerStatus.failedSyncs++;
    schedulerStatus.errors.push(`同步失败: ${error.message}`);
    console.error('[PerformanceSyncScheduler] 同步失败:', error);
  }

  // 计算下次同步时间
  schedulerStatus.nextRunAt = calculateNextSyncTime();
  console.log(`[PerformanceSyncScheduler] 下次同步时间: ${schedulerStatus.nextRunAt.toISOString()}`);

  // 保留最近10条错误
  if (schedulerStatus.errors.length > 10) {
    schedulerStatus.errors = schedulerStatus.errors.slice(-10);
  }
}

/**
 * 执行绩效数据同步
 */
async function executePerformanceSync(): Promise<void> {
  const database = await db.getDb();
  if (!database) {
    throw new Error('Database not available');
  }

  // 获取所有启用了绩效同步的账户
  const accountsResult = await database.execute(sql`
    SELECT DISTINCT a.id, a.accountId, a.profileId, a.marketplace
    FROM ad_accounts a
    WHERE a.profileId IS NOT NULL AND a.profileId != ''
  `);

  const accounts = (accountsResult as any[])[0] || accountsResult;
  if (!accounts || accounts.length === 0) {
    console.log('[PerformanceSyncScheduler] 没有需要同步的账户');
    return;
  }

  console.log(`[PerformanceSyncScheduler] 发现 ${accounts.length} 个账户需要同步`);

  // 计算日期范围（最近7天）
  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - 7);

  const startDateStr = startDate.toISOString().split('T')[0];
  const endDateStr = endDate.toISOString().split('T')[0];

  // 为每个账户创建同步请求
  for (const account of accounts) {
    try {
      await createPerformanceSyncRequests(account.id, startDateStr, endDateStr);
      console.log(`[PerformanceSyncScheduler] 已为账户 ${account.id} 创建同步请求`);
    } catch (error: any) {
      console.error(`[PerformanceSyncScheduler] 账户 ${account.id} 创建同步请求失败:`, error);
    }
  }
}

/**
 * 手动触发绩效数据同步
 */
export async function triggerManualSync(accountId?: number): Promise<{ success: boolean; message: string; requestIds?: number[] }> {
  const database = await db.getDb();
  if (!database) {
    return { success: false, message: 'Database not available' };
  }

  // 计算日期范围（最近7天）
  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - 7);

  const startDateStr = startDate.toISOString().split('T')[0];
  const endDateStr = endDate.toISOString().split('T')[0];

  try {
    if (accountId) {
      // 同步指定账户
      const requestIds = await createPerformanceSyncRequests(accountId, startDateStr, endDateStr);
      return { success: true, message: `已创建 ${requestIds.length} 个同步请求`, requestIds };
    } else {
      // 同步所有账户
      const accountsResult = await database.execute(sql`
        SELECT DISTINCT a.id FROM ad_accounts a WHERE a.profileId IS NOT NULL AND a.profileId != ''
      `);

      const accounts = (accountsResult as any[])[0] || accountsResult;
      const allRequestIds: number[] = [];

      for (const account of accounts) {
        const requestIds = await createPerformanceSyncRequests(account.id, startDateStr, endDateStr);
        allRequestIds.push(...requestIds);
      }

      return { success: true, message: `已为 ${accounts.length} 个账户创建 ${allRequestIds.length} 个同步请求`, requestIds: allRequestIds };
    }
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

/**
 * 获取调度器状态
 */
export function getSchedulerStatus(): SchedulerStatus {
  return { ...schedulerStatus };
}

/**
 * 更新同步配置
 */
export async function updateSyncConfig(
  accountId: number,
  config: {
    isEnabled?: boolean;
    syncFrequency?: 'hourly' | 'every_4_hours' | 'every_12_hours' | 'daily';
    syncTime?: string;
    lookbackDays?: number;
  }
): Promise<boolean> {
  const database = await db.getDb();
  if (!database) {
    return false;
  }

  try {
    // 检查是否存在配置
    const existingResult = await database.execute(sql`
      SELECT id FROM performance_sync_config WHERE accountId = ${accountId}
    `);

    const existing = (existingResult as any[])[0] || existingResult;

    if (existing && existing.length > 0) {
      // 更新现有配置
      const updates: string[] = [];
      if (config.isEnabled !== undefined) updates.push(`isEnabled = ${config.isEnabled ? 1 : 0}`);
      if (config.syncFrequency) updates.push(`syncFrequency = '${config.syncFrequency}'`);
      if (config.syncTime) updates.push(`syncTime = '${config.syncTime}'`);
      if (config.lookbackDays) updates.push(`lookbackDays = ${config.lookbackDays}`);
      updates.push('updatedAt = NOW()');

      await database.execute(sql.raw(`UPDATE performance_sync_config SET ${updates.join(', ')} WHERE accountId = ${accountId}`));
    } else {
      // 创建新配置
      await database.execute(sql`
        INSERT INTO performance_sync_config (accountId, isEnabled, syncFrequency, syncTime, lookbackDays)
        VALUES (${accountId}, ${config.isEnabled ? 1 : 0}, ${config.syncFrequency || 'daily'}, ${config.syncTime || '02:00'}, ${config.lookbackDays || 7})
      `);
    }

    return true;
  } catch (error: any) {
    console.error('[PerformanceSyncScheduler] 更新配置失败:', error);
    return false;
  }
}

/**
 * 获取账户的同步配置
 */
export async function getSyncConfig(accountId: number): Promise<any | null> {
  const database = await db.getDb();
  if (!database) {
    return null;
  }

  try {
    const result = await database.execute(sql`
      SELECT * FROM performance_sync_config WHERE accountId = ${accountId}
    `);

    const configs = (result as any[])[0] || result;
    return configs && configs.length > 0 ? configs[0] : null;
  } catch (error: any) {
    console.error('[PerformanceSyncScheduler] 获取配置失败:', error);
    return null;
  }
}
