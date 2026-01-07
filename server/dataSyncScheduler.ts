/**
 * Data Sync Scheduler Service - 定时数据同步调度服务
 * 支持每2小时自动同步Amazon广告数据
 */

import * as db from './db';
import { AmazonSyncService } from './amazonSyncService';
import { notifyOwner } from './_core/notification';

// 调度器状态
interface SchedulerStatus {
  isRunning: boolean;
  lastRunTime: Date | null;
  nextRunTime: Date | null;
  totalSyncs: number;
  successfulSyncs: number;
  failedSyncs: number;
  errors: string[];
}

let schedulerStatus: SchedulerStatus = {
  isRunning: false,
  lastRunTime: null,
  nextRunTime: null,
  totalSyncs: 0,
  successfulSyncs: 0,
  failedSyncs: 0,
  errors: [],
};

let schedulerInterval: NodeJS.Timeout | null = null;

// 频率到毫秒的映射
const frequencyToMs: Record<string, number> = {
  'hourly': 60 * 60 * 1000,
  'every_2_hours': 2 * 60 * 60 * 1000,
  'every_4_hours': 4 * 60 * 60 * 1000,
  'every_6_hours': 6 * 60 * 60 * 1000,
  'every_12_hours': 12 * 60 * 60 * 1000,
  'daily': 24 * 60 * 60 * 1000,
  'weekly': 7 * 24 * 60 * 60 * 1000,
};

/**
 * 获取调度器状态
 */
export function getSchedulerStatus(): SchedulerStatus {
  return { ...schedulerStatus };
}

/**
 * 启动定时同步调度器
 * @param intervalMs 执行间隔（毫秒），默认每2小时
 */
export function startDataSyncScheduler(intervalMs: number = 2 * 60 * 60 * 1000): void {
  if (schedulerStatus.isRunning) {
    console.log('[DataSyncScheduler] 定时同步调度器已在运行中');
    return;
  }

  schedulerStatus.isRunning = true;
  schedulerStatus.nextRunTime = new Date(Date.now() + intervalMs);

  console.log(`[DataSyncScheduler] 定时同步调度器已启动，执行间隔: ${intervalMs / 1000 / 60} 分钟`);

  // 设置定时执行
  schedulerInterval = setInterval(async () => {
    schedulerStatus.nextRunTime = new Date(Date.now() + intervalMs);
    await executeScheduledSync();
  }, intervalMs);
}

/**
 * 停止定时同步调度器
 */
export function stopDataSyncScheduler(): void {
  if (!schedulerStatus.isRunning) {
    console.log('[DataSyncScheduler] 定时同步调度器未在运行');
    return;
  }

  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }

  schedulerStatus.isRunning = false;
  schedulerStatus.nextRunTime = null;

  console.log('[DataSyncScheduler] 定时同步调度器已停止');
}

/**
 * 执行定时同步任务
 */
async function executeScheduledSync(): Promise<void> {
  console.log(`[DataSyncScheduler] 开始执行定时同步任务 - ${new Date().toISOString()}`);

  try {
    // 获取所有启用了定时同步的账号
    const schedules = await db.getEnabledSyncSchedules();

    if (schedules.length === 0) {
      console.log('[DataSyncScheduler] 没有启用的定时同步配置');
      return;
    }

    for (const schedule of schedules) {
      // 检查是否应该执行同步
      if (!shouldExecuteSync(schedule)) {
        continue;
      }

      try {
        await executeSyncForAccount(schedule);
        schedulerStatus.successfulSyncs++;
      } catch (error: any) {
        schedulerStatus.failedSyncs++;
        schedulerStatus.errors.push(`账号 ${schedule.accountId} 同步失败: ${error.message}`);
        console.error(`[DataSyncScheduler] 账号 ${schedule.accountId} 同步失败:`, error);
      }

      schedulerStatus.totalSyncs++;
    }

    schedulerStatus.lastRunTime = new Date();
    // 只保留最近10条错误
    schedulerStatus.errors = schedulerStatus.errors.slice(-10);

  } catch (error: any) {
    console.error('[DataSyncScheduler] 定时同步任务执行失败:', error);
    schedulerStatus.errors.push(`任务执行失败: ${error.message}`);
  }
}

/**
 * 检查是否应该执行同步
 */
function shouldExecuteSync(schedule: db.DataSyncSchedule): boolean {
  if (!schedule.isEnabled) {
    return false;
  }

  const now = new Date();
  const frequency = schedule.frequency || 'daily';
  const intervalMs = frequencyToMs[frequency] || frequencyToMs['daily'];

  // 如果有上次运行时间，检查是否已经过了间隔时间
  if (schedule.lastRunAt) {
    const lastRun = new Date(schedule.lastRunAt);
    const timeSinceLastRun = now.getTime() - lastRun.getTime();
    
    if (timeSinceLastRun < intervalMs) {
      return false;
    }
  }

  // 检查首选时间（如果设置了）
  if (schedule.preferredTime) {
    const [hours, minutes] = schedule.preferredTime.split(':').map(Number);
    const currentHours = now.getHours();
    const currentMinutes = now.getMinutes();

    // 允许5分钟的时间窗口
    const preferredMinutes = hours * 60 + minutes;
    const currentTotalMinutes = currentHours * 60 + currentMinutes;
    const diff = Math.abs(currentTotalMinutes - preferredMinutes);

    if (diff > 5 && diff < (24 * 60 - 5)) {
      return false;
    }
  }

  // 检查首选星期几（如果是每周同步）
  if (frequency === 'weekly' && schedule.preferredDayOfWeek !== null && schedule.preferredDayOfWeek !== undefined) {
    const currentDay = now.getDay();
    if (currentDay !== schedule.preferredDayOfWeek) {
      return false;
    }
  }

  return true;
}

/**
 * 为指定账号执行同步
 */
async function executeSyncForAccount(schedule: db.DataSyncSchedule): Promise<void> {
  console.log(`[DataSyncScheduler] 开始同步账号 ${schedule.accountId}`);

  // 获取账号信息
  const account = await db.getAdAccountById(schedule.accountId);
  if (!account) {
    throw new Error(`账号 ${schedule.accountId} 不存在`);
  }

  // 创建同步服务实例 - 需要从凭证存储获取完整凭证
  const credentials = await (db as any).getApiCredentialsByAccountId?.(schedule.accountId) || account;
  if (!credentials) {
    throw new Error(`账号 ${schedule.accountId} 未配置API凭证`);
  }
  
  const syncService = await AmazonSyncService.createFromCredentials(
    {
      clientId: credentials.clientId || '',
      clientSecret: credentials.clientSecret || '',
      refreshToken: credentials.refreshToken || '',
      profileId: account.profileId || '',
      region: (credentials.region as 'NA' | 'EU' | 'FE') || 'NA'
    },
    schedule.accountId,
    schedule.userId
  );

  // 执行同步
  const result = await syncService.syncAll();

  // 更新调度记录
  await db.updateSyncScheduleLastRun(schedule.id);

  // 记录同步日志
  await db.createSyncLog({
    userId: schedule.userId,
    accountId: schedule.accountId,
    syncType: 'full_sync',
    status: 'completed',
    recordsSynced: result.campaigns + result.adGroups + result.keywords + result.targets,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    isIncremental: false,
    spCampaigns: result.spCampaigns || 0,
    sbCampaigns: result.sbCampaigns || 0,
    sdCampaigns: result.sdCampaigns || 0,
    adGroupsSynced: result.adGroups,
    keywordsSynced: result.keywords,
    targetsSynced: result.targets,
  });

  console.log(`[DataSyncScheduler] 账号 ${schedule.accountId} 同步完成:`, result);

  // 发送通知（如果配置了）
  if (result.campaigns > 0 || result.adGroups > 0) {
    try {
      await notifyOwner({
        title: `定时同步完成 - ${account.accountName || account.sellerId}`,
        content: `同步结果: ${result.campaigns} 个广告活动, ${result.adGroups} 个广告组, ${result.keywords} 个关键词, ${result.targets} 个商品定位`
      });
    } catch (e) {
      console.error('[DataSyncScheduler] 发送通知失败:', e);
    }
  }
}

/**
 * 手动触发同步
 */
export async function triggerManualSync(userId: number, accountId: number): Promise<{
  success: boolean;
  message: string;
  result?: any;
}> {
  try {
    const account = await db.getAdAccountById(accountId);
    if (!account) {
      return { success: false, message: '账号不存在' };
    }

    const credentials = await (db as any).getApiCredentialsByAccountId?.(accountId) || account;
    if (!credentials) {
      return { success: false, message: '账号未配置API凭证' };
    }

    const syncService = await AmazonSyncService.createFromCredentials(
      {
        clientId: credentials.clientId || '',
        clientSecret: credentials.clientSecret || '',
        refreshToken: credentials.refreshToken || '',
        profileId: account.profileId || '',
        region: (credentials.region as 'NA' | 'EU' | 'FE') || 'NA'
      },
      accountId,
      userId
    );

    const result = await syncService.syncAll();

    return {
      success: true,
      message: '同步完成',
      result
    };
  } catch (error: any) {
    return {
      success: false,
      message: `同步失败: ${error.message}`
    };
  }
}

/**
 * 创建或更新定时同步配置
 */
export async function upsertSyncSchedule(params: {
  userId: number;
  accountId: number;
  syncType?: string;
  frequency: string;
  preferredTime?: string;
  preferredDayOfWeek?: number;
  isEnabled: boolean;
}): Promise<db.DataSyncSchedule> {
  // 检查是否已存在配置
  const existing = await db.getSyncScheduleByAccountId(params.userId, params.accountId);

  if (existing) {
    // 更新现有配置
    await db.updateSyncSchedule(existing.id, {
      syncType: params.syncType || 'full_sync',
      frequency: params.frequency,
      preferredTime: params.preferredTime,
      preferredDayOfWeek: params.preferredDayOfWeek,
      isEnabled: params.isEnabled,
    });
    return { ...existing, ...params } as unknown as db.DataSyncSchedule;
  } else {
    // 创建新配置
    const id = await db.createSyncSchedule({
      userId: params.userId,
      accountId: params.accountId,
      syncType: params.syncType || 'full_sync',
      frequency: params.frequency,
      preferredTime: params.preferredTime,
      preferredDayOfWeek: params.preferredDayOfWeek,
      isEnabled: params.isEnabled,
    });
    return {
      id,
      userId: params.userId,
      accountId: params.accountId,
      syncType: params.syncType || 'full_sync',
      frequency: params.frequency,
      preferredTime: params.preferredTime || null,
      preferredDayOfWeek: params.preferredDayOfWeek || null,
      isEnabled: params.isEnabled ? 1 : 0,
      lastRunAt: null,
      nextRunAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as db.DataSyncSchedule;
  }
}

/**
 * 获取账号的定时同步配置
 */
export async function getSyncSchedule(userId: number, accountId: number): Promise<db.DataSyncSchedule | null> {
  return db.getSyncScheduleByAccountId(userId, accountId);
}

/**
 * 删除定时同步配置
 */
export async function deleteSyncSchedule(scheduleId: number): Promise<void> {
  await db.deleteSyncSchedule(scheduleId);
}

// 服务器启动时自动启动调度器（每2小时）
// 注意：这会在模块加载时执行
// startDataSyncScheduler(2 * 60 * 60 * 1000);
