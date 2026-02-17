/**
 * Data Sync Scheduler Service - 定时数据同步调度服务
 * 实现分层同步策略，根据Amazon API速率限制优化同步频率
 * 
 * 同步策略：
 * - 高频同步（每15分钟）：广告活动状态、预算
 * - 中频同步（每30分钟）：广告组、关键词、定位
 * - 低频同步（每2小时）：完整数据同步
 */

import * as db from './db';
import { AmazonSyncService } from './amazonSyncService';
import { notifyOwner } from './_core/notification';
import * as automationExecutionEngine from './automationExecutionEngine';
import * as searchTermHarvester from './searchTermHarvester';
import { detectRiskSignals } from './attributionWindowHelper';

// 同步层级定义
export type SyncTier = 'high' | 'medium' | 'low' | 'full';

// 同步层级配置
const SYNC_TIER_CONFIG: Record<SyncTier, {
  intervalMs: number;
  description: string;
  syncTypes: string[];
}> = {
  high: {
    intervalMs: 15 * 60 * 1000, // 15分钟
    description: '高频同步 - 广告活动状态和预算',
    syncTypes: ['campaigns_status', 'budgets'],
  },
  medium: {
    intervalMs: 30 * 60 * 1000, // 30分钟
    description: '中频同步 - 广告组、关键词、定位',
    syncTypes: ['ad_groups', 'keywords', 'targets'],
  },
  low: {
    intervalMs: 60 * 60 * 1000, // 1小时
    description: '低频同步 - 完整数据同步',
    syncTypes: ['full_sync'],
  },
  full: {
    intervalMs: 30 * 60 * 1000, // 30分钟（完整同步，获取60天历史数据）
    description: '完整同步 - 所有数据（60天历史）',
    syncTypes: ['all'],
  },
};

// 调度器状态
interface SchedulerStatus {
  isRunning: boolean;
  lastRunTime: Date | null;
  nextRunTime: Date | null;
  totalSyncs: number;
  successfulSyncs: number;
  failedSyncs: number;
  errors: string[];
  currentTier: SyncTier | null;
  tierLastRun: Record<SyncTier, Date | null>;
}

let schedulerStatus: SchedulerStatus = {
  isRunning: false,
  lastRunTime: null,
  nextRunTime: null,
  totalSyncs: 0,
  successfulSyncs: 0,
  failedSyncs: 0,
  errors: [],
  currentTier: null,
  tierLastRun: {
    high: null,
    medium: null,
    low: null,
    full: null,
  },
};

let schedulerIntervals: Record<SyncTier, NodeJS.Timeout | null> = {
  high: null,
  medium: null,
  low: null,
  full: null,
};

// API请求队列，用于控制请求速率
interface QueuedRequest {
  accountId: number;
  userId: number;
  tier: SyncTier;
  timestamp: number;
}

const requestQueue: QueuedRequest[] = [];
let isProcessingQueue = false;

// 请求间隔（毫秒）- 每个API调用之间的最小间隔
const REQUEST_INTERVAL_MS = 200;

// 频率到毫秒的映射（用于用户自定义配置）
const frequencyToMs: Record<string, number> = {
  'every_15_minutes': 15 * 60 * 1000,
  'every_30_minutes': 30 * 60 * 1000,
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
 * 启动分层同步调度器
 * @param defaultIntervalMs 默认执行间隔（毫秒），用于完整同步，默认30分钟
 */
export function startDataSyncScheduler(defaultIntervalMs: number = 30 * 60 * 1000): void {
  if (schedulerStatus.isRunning) {
    console.log('[DataSyncScheduler] 定时同步调度器已在运行中');
    return;
  }

  schedulerStatus.isRunning = true;
  
  // 启动分层同步
  console.log('[DataSyncScheduler] 启动分层同步调度器...');
  
  // 高频同步：每15分钟
  schedulerIntervals.high = setInterval(async () => {
    await executeLayeredSync('high');
  }, SYNC_TIER_CONFIG.high.intervalMs);
  console.log(`[DataSyncScheduler] 高频同步已启动，间隔: ${SYNC_TIER_CONFIG.high.intervalMs / 1000 / 60} 分钟`);

  // 中频同步：每30分钟
  schedulerIntervals.medium = setInterval(async () => {
    await executeLayeredSync('medium');
  }, SYNC_TIER_CONFIG.medium.intervalMs);
  console.log(`[DataSyncScheduler] 中频同步已启动，间隔: ${SYNC_TIER_CONFIG.medium.intervalMs / 1000 / 60} 分钟`);

  // 低频/完整同步：使用传入的间隔（默认1小时）
  schedulerIntervals.full = setInterval(async () => {
    await executeScheduledSync();
  }, defaultIntervalMs);
  
  schedulerStatus.nextRunTime = new Date(Date.now() + defaultIntervalMs);
  console.log(`[DataSyncScheduler] 完整同步已启动，间隔: ${defaultIntervalMs / 1000 / 60} 分钟`);
  console.log(`[DataSyncScheduler] 定时同步调度器已启动，执行间隔: ${defaultIntervalMs / 1000 / 60} 分钟`);
}

/**
 * 停止定时同步调度器
 */
export function stopDataSyncScheduler(): void {
  if (!schedulerStatus.isRunning) {
    console.log('[DataSyncScheduler] 定时同步调度器未在运行');
    return;
  }

  // 停止所有层级的调度器
  Object.keys(schedulerIntervals).forEach((tier) => {
    const interval = schedulerIntervals[tier as SyncTier];
    if (interval) {
      clearInterval(interval);
      schedulerIntervals[tier as SyncTier] = null;
    }
  });

  schedulerStatus.isRunning = false;
  schedulerStatus.nextRunTime = null;
  schedulerStatus.currentTier = null;

  console.log('[DataSyncScheduler] 定时同步调度器已停止');
}

/**
 * 执行分层同步
 */
async function executeLayeredSync(tier: SyncTier): Promise<void> {
  console.log(`[DataSyncScheduler] 开始执行${SYNC_TIER_CONFIG[tier].description} - ${new Date().toISOString()}`);
  schedulerStatus.currentTier = tier;

  try {
    // 获取所有启用了定时同步的账号
    const schedules = await db.getEnabledSyncSchedules();

    if (schedules.length === 0) {
      console.log('[DataSyncScheduler] 没有启用的定时同步配置');
      return;
    }

    for (const schedule of schedules) {
      // 将请求加入队列
      addToQueue({
        accountId: schedule.accountId,
        userId: schedule.userId,
        tier,
        timestamp: Date.now(),
      });
    }

    // 处理队列
    await processQueue();

    schedulerStatus.tierLastRun[tier] = new Date();
    console.log(`[DataSyncScheduler] ${SYNC_TIER_CONFIG[tier].description}完成`);

  } catch (error: any) {
    console.error(`[DataSyncScheduler] ${tier}层同步执行失败:`, error);
    schedulerStatus.errors.push(`${tier}层同步失败: ${error.message}`);
  }

  schedulerStatus.currentTier = null;
}

/**
 * 添加请求到队列
 */
function addToQueue(request: QueuedRequest): void {
  requestQueue.push(request);
}

/**
 * 处理请求队列（带速率限制）
 */
async function processQueue(): Promise<void> {
  if (isProcessingQueue) {
    return;
  }

  isProcessingQueue = true;

  while (requestQueue.length > 0) {
    const request = requestQueue.shift();
    if (!request) continue;

    try {
      await executeTieredSyncForAccount(request);
      schedulerStatus.successfulSyncs++;
    } catch (error: any) {
      schedulerStatus.failedSyncs++;
      schedulerStatus.errors.push(`账号 ${request.accountId} ${request.tier}层同步失败: ${error.message}`);
      console.error(`[DataSyncScheduler] 账号 ${request.accountId} ${request.tier}层同步失败:`, error);
    }

    schedulerStatus.totalSyncs++;

    // 请求间隔，避免触发速率限制
    if (requestQueue.length > 0) {
      await sleep(REQUEST_INTERVAL_MS);
    }
  }

  isProcessingQueue = false;
  // 只保留最近10条错误
  schedulerStatus.errors = schedulerStatus.errors.slice(-10);
}

/**
 * 为指定账号执行分层同步
 */
async function executeTieredSyncForAccount(request: QueuedRequest): Promise<void> {
  const { accountId, userId, tier } = request;
  console.log(`[DataSyncScheduler] 开始${tier}层同步账号 ${accountId}`);

  // 获取账号信息
  const account = await db.getAdAccountById(accountId);
  if (!account) {
    throw new Error(`账号 ${accountId} 不存在`);
  }

  // 获取API凭证 - 从amazonApiCredentials表获取
  const credentials = await db.getAmazonApiCredentials(accountId);
  if (!credentials) {
    throw new Error(`账号 ${accountId} 未配置API凭证，请先完成Amazon API授权`);
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
    userId,
    account.marketplace || 'US'
  );

  // 根据层级执行不同的同步
  let result;
  switch (tier) {
    case 'high':
      // 高频同步：同步广告活动状态（SP/SB/SD全覆盖）
      result = await syncService.syncCampaignsOnly();
      // 同时同步当日绩效数据（T-1归因回溯）
      try {
        await syncService.syncPerformanceOnly(1);
      } catch (e: any) {
        console.error(`[DataSyncScheduler] 账号 ${accountId} 高频绩效同步失败:`, e.message);
      }
      break;
    case 'medium':
      // 中频同步：同步广告组、关键词、定位（SP/SB/SD全覆盖）
      result = await syncService.syncAdGroupsAndTargeting();
      // 同时同步7天绩效数据（归因窗口期数据更新）
      try {
        await syncService.syncPerformanceOnly(7);
      } catch (e: any) {
        console.error(`[DataSyncScheduler] 账号 ${accountId} 中频绩效同步失败:`, e.message);
      }
      break;
    case 'low':
    case 'full':
    default:
      // 完整同步：覆盖式全量同步，确保数据与亚马逊后台一致
      // 包含所有层级：广告活动、广告组、关键词、定位、否定词、搜索词、广告位、素材URL、绩效数据
      result = await syncService.syncAll();
      break;
  }

  console.log(`[DataSyncScheduler] 账号 ${accountId} ${tier}层同步完成:`, result);
}

/**
 * 执行定时同步任务（完整同步）
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
      
      // 请求间隔
      await sleep(REQUEST_INTERVAL_MS);
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
  const frequency = schedule.frequency || 'hourly';
  const intervalMs = frequencyToMs[frequency] || frequencyToMs['hourly'];

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
 * 为指定账号执行完整同步
 */
async function executeSyncForAccount(schedule: db.DataSyncSchedule): Promise<void> {
  console.log(`[DataSyncScheduler] 开始同步账号 ${schedule.accountId}`);

  // 获取账号信息
  const account = await db.getAdAccountById(schedule.accountId);
  if (!account) {
    throw new Error(`账号 ${schedule.accountId} 不存在`);
  }

  // 创建同步服务实例 - 从amazonApiCredentials表获取完整凭证
  const credentials = await db.getAmazonApiCredentials(schedule.accountId);
  if (!credentials) {
    throw new Error(`账号 ${schedule.accountId} 未配置API凭证，请先完成Amazon API授权`);
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
    schedule.userId,
    account.marketplace || 'US'
  );

  // 执行完整同步（获取90天数据）
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

  // ✅ 数据同步完成后，自动更新策略模板推荐
  try {
    const { updateAllCampaignRecommendations } = await import('./strategyRecommendationService');
    const recUpdated = await updateAllCampaignRecommendations(schedule.accountId);
    console.log(`[DataSyncScheduler] 账号 ${schedule.accountId} 策略模板推荐已更新: ${recUpdated} 个广告活动`);
  } catch (recError: any) {
    console.error(`[DataSyncScheduler] 账号 ${schedule.accountId} 策略模板推荐更新失败:`, recError.message);
  }

  // ✅ 数据同步完成后，自动触发优化执行（闭环调度）
  try {
    const autoConfig = automationExecutionEngine.getAccountAutomationConfig(schedule.accountId);
    if (autoConfig.enabled) {
      console.log(`[DataSyncScheduler] 账号 ${schedule.accountId} 自动优化已启用，触发优化执行...`);
      const optimizationResult = await automationExecutionEngine.runFullAutomationCycle(schedule.accountId);
      console.log(`[DataSyncScheduler] 账号 ${schedule.accountId} 自动优化完成:`, {
        analyzed: optimizationResult.summary.totalAnalyzed,
        executed: optimizationResult.summary.totalExecuted,
        skipped: optimizationResult.summary.totalSkipped,
        blocked: optimizationResult.summary.totalBlocked,
      });
    } else {
      console.log(`[DataSyncScheduler] 账号 ${schedule.accountId} 自动优化未启用，跳过优化执行`);
    }
  } catch (autoOptError: any) {
    console.error(`[DataSyncScheduler] 账号 ${schedule.accountId} 自动优化执行失败:`, autoOptError.message);
  }

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

    const credentials = await db.getAmazonApiCredentials(accountId);
    if (!credentials) {
      return { success: false, message: '账号未配置API凭证，请先完成Amazon API授权' };
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
      userId,
      account.marketplace || 'US'
    );

    // 手动触发同步（获取90天数据）
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

/**
 * 辅助函数：延迟执行
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 指数退避重试
 */
export async function withExponentialBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelayMs: number = 1000
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      
      // 如果是429错误，使用指数退避
      if (error.response?.status === 429 || error.message?.includes('429')) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        console.log(`[DataSyncScheduler] 遇到速率限制，等待 ${delay}ms 后重试 (尝试 ${attempt + 1}/${maxRetries})`);
        await sleep(delay);
      } else {
        // 其他错误直接抛出
        throw error;
      }
    }
  }
  
  throw lastError || new Error('重试次数已用尽');
}

// ==================== v122: 重构分层优化调度器 ====================
// 核心修复：
// 1. 修复模块隔离 - 每个调度任务只执行对应的优化模块，不再全量执行
// 2. 集成日内节奏服务 - 高频监控预算消耗速度和异常流量
// 3. 新增分时竞价调度 - 每小时根据时段动态调整出价
// 4. 新增位置优化调度 - 每天凌晨3:00独立执行位置倾斜优化
// 5. 新增搜索词否定调度 - 每天凌晨4:00独立执行搜索词否定分析
// 6. 使用执行锁防止重复执行
// 7. 使用marketplace时区感知的调度时间

/**
 * v122 优化调度频率表（修复版）
 * 
 * | 任务               | 频率        | 时间              | 执行模块                          |
 * |--------------------|-------------|-------------------|-----------------------------------|
 * | 日内节奏监控       | 每30分钟    | 全天              | intradayPacing (仅监控+调整分时)  |
 * | 高频风控扫描       | 每2小时     | 全天              | riskScan (仅风控，不含优化)       |
 * | 分时竞价调整       | 每小时      | 全天              | dayparting (仅分时竞价)           |
 * | 每日出价优化       | 每天1次     | 凌晨2:00          | bid + keyword + coordination      |
 * | 每日位置优化       | 每天1次     | 凌晨3:00          | placement                         |
 * | 每日搜索词否定     | 每天1次     | 凌晨4:00          | searchterm                        |
 * | 预算智能分配       | 每天2次     | 早8:00 + 晚18:00  | budget                            |
 * | 搜索词收割         | 每周1次     | 周一凌晨5:00      | searchTermHarvester (独立服务)    |
 * | 绩效周报           | 每周1次     | 周一上午9:00      | report                            |
 */

type OptimizationTaskType = 
  | 'intraday_pacing'
  | 'risk_scan' 
  | 'dayparting_adjustment'
  | 'daily_bid_optimization' 
  | 'daily_placement_optimization'
  | 'daily_search_term_negation'
  | 'budget_allocation' 
  | 'search_term_harvest' 
  | 'weekly_report';

interface OptimizationScheduleConfig {
  type: OptimizationTaskType;
  description: string;
  intervalMs: number;
  cronHours?: number[];     // 指定小时执行
  cronDayOfWeek?: number;   // 指定星期几执行 (0=Sunday)
  specificModules?: string[];  // v122: 该任务只执行的优化模块
}

const OPTIMIZATION_SCHEDULE: Record<OptimizationTaskType, OptimizationScheduleConfig> = {
  intraday_pacing: {
    type: 'intraday_pacing',
    description: '日内节奏监控 - 预算消耗速度监控和异常流量检测',
    intervalMs: 30 * 60 * 1000, // 每30分钟
    specificModules: [], // 独立执行，不走优化目标引擎
  },
  risk_scan: {
    type: 'risk_scan',
    description: '高频风控扫描 - 零曝光风暴、异常花销、CPC飙升检测',
    intervalMs: 2 * 60 * 60 * 1000, // 每2小时（从4小时缩短到2小时）
    specificModules: [], // 仅风控，不执行优化模块
  },
  dayparting_adjustment: {
    type: 'dayparting_adjustment',
    description: '分时竞价调整 - 根据当前时段动态调整出价乘数',
    intervalMs: 60 * 60 * 1000, // 每小时
    specificModules: ['dayparting', 'coordination'], // 仅分时竞价+协调
  },
  daily_bid_optimization: {
    type: 'daily_bid_optimization',
    description: '每日出价优化 - 基于策略模板的自动出价调整',
    intervalMs: 24 * 60 * 60 * 1000,
    cronHours: [2], // 凌晨2:00
    specificModules: ['bid', 'keyword', 'coordination'], // 仅出价+关键词状态+协调
  },
  daily_placement_optimization: {
    type: 'daily_placement_optimization',
    description: '每日位置优化 - 广告位置倾斜比例调整',
    intervalMs: 24 * 60 * 60 * 1000,
    cronHours: [3], // 凌晨3:00
    specificModules: ['placement'], // 仅位置优化
  },
  daily_search_term_negation: {
    type: 'daily_search_term_negation',
    description: '每日搜索词否定 - 自动否定低效搜索词',
    intervalMs: 24 * 60 * 60 * 1000,
    cronHours: [4], // 凌晨4:00
    specificModules: ['searchterm'], // 仅搜索词分析
  },
  budget_allocation: {
    type: 'budget_allocation',
    description: '预算智能分配 - 早晚两次预算分配',
    intervalMs: 12 * 60 * 60 * 1000,
    cronHours: [8, 18], // 早8:00 + 晚18:00
    specificModules: ['budget'], // 仅预算分配
  },
  search_term_harvest: {
    type: 'search_term_harvest',
    description: '搜索词收割 - 每周自动收割高转化搜索词并添加否定词',
    intervalMs: 7 * 24 * 60 * 60 * 1000,
    cronHours: [5], // 凌晨5:00
    cronDayOfWeek: 1, // 周一
    specificModules: [], // 独立执行，使用searchTermHarvester服务
  },
  weekly_report: {
    type: 'weekly_report',
    description: '绩效周报 - 每周自动生成广告优化报告',
    intervalMs: 7 * 24 * 60 * 60 * 1000,
    cronHours: [9], // 上午9:00
    cronDayOfWeek: 1, // 周一
    specificModules: [],
  },
};

let optimizationIntervals: Record<OptimizationTaskType, NodeJS.Timeout | null> = {
  intraday_pacing: null,
  risk_scan: null,
  dayparting_adjustment: null,
  daily_bid_optimization: null,
  daily_placement_optimization: null,
  daily_search_term_negation: null,
  budget_allocation: null,
  search_term_harvest: null,
  weekly_report: null,
};

// v122: 执行锁 - 防止同一任务重复执行
const executionLocks: Record<string, boolean> = {};
// v122: 上次执行时间记录 - 防止同一小时内重复执行
const lastExecutionHour: Record<string, string> = {};

/**
 * 获取执行锁
 */
function acquireLock(taskType: string): boolean {
  if (executionLocks[taskType]) {
    console.log(`[OptimizationScheduler] 任务 ${taskType} 正在执行中，跳过`);
    return false;
  }
  executionLocks[taskType] = true;
  return true;
}

/**
 * 释放执行锁
 */
function releaseLock(taskType: string): void {
  executionLocks[taskType] = false;
}

/**
 * 检查是否应该在当前小时执行（防止同一小时重复执行）
 */
function shouldExecuteThisHour(taskType: string): boolean {
  const now = new Date();
  const hourKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}`;
  if (lastExecutionHour[taskType] === hourKey) {
    return false;
  }
  lastExecutionHour[taskType] = hourKey;
  return true;
}

/**
 * 启动分层优化调度器 (v122 重构版)
 * 核心改进：每个任务只执行对应的优化模块，不再全量执行
 */
export function startOptimizationScheduler(): void {
  console.log('[OptimizationScheduler] 启动v122分层优化调度器...');
  
  // 0. 日内节奏监控 - 每30分钟
  optimizationIntervals.intraday_pacing = setInterval(async () => {
    await executeOptimizationTask('intraday_pacing');
  }, OPTIMIZATION_SCHEDULE.intraday_pacing.intervalMs);
  console.log(`[OptimizationScheduler] 日内节奏监控已启动，间隔: 30分钟`);
  
  // 1. 高频风控扫描 - 每2小时（仅风控，不含优化）
  optimizationIntervals.risk_scan = setInterval(async () => {
    await executeOptimizationTask('risk_scan');
  }, OPTIMIZATION_SCHEDULE.risk_scan.intervalMs);
  console.log(`[OptimizationScheduler] 高频风控扫描已启动，间隔: 2小时`);
  
  // 2. 分时竞价调整 - 每小时
  optimizationIntervals.dayparting_adjustment = setInterval(async () => {
    await executeOptimizationTask('dayparting_adjustment');
  }, OPTIMIZATION_SCHEDULE.dayparting_adjustment.intervalMs);
  console.log(`[OptimizationScheduler] 分时竞价调整已启动，间隔: 1小时`);
  
  // 3. 每日出价优化 - 凌晨2:00（仅出价+关键词+协调）
  optimizationIntervals.daily_bid_optimization = setInterval(async () => {
    const hour = new Date().getHours();
    if (hour === 2 && shouldExecuteThisHour('daily_bid_optimization')) {
      await executeOptimizationTask('daily_bid_optimization');
    }
  }, 60 * 60 * 1000);
  console.log(`[OptimizationScheduler] 每日出价优化已启动，执行时间: 凌晨2:00`);
  
  // 4. 每日位置优化 - 凌晨3:00（仅位置倾斜）
  optimizationIntervals.daily_placement_optimization = setInterval(async () => {
    const hour = new Date().getHours();
    if (hour === 3 && shouldExecuteThisHour('daily_placement_optimization')) {
      await executeOptimizationTask('daily_placement_optimization');
    }
  }, 60 * 60 * 1000);
  console.log(`[OptimizationScheduler] 每日位置优化已启动，执行时间: 凌晨3:00`);
  
  // 5. 每日搜索词否定 - 凌晨4:00（仅搜索词否定分析）
  optimizationIntervals.daily_search_term_negation = setInterval(async () => {
    const hour = new Date().getHours();
    if (hour === 4 && shouldExecuteThisHour('daily_search_term_negation')) {
      await executeOptimizationTask('daily_search_term_negation');
    }
  }, 60 * 60 * 1000);
  console.log(`[OptimizationScheduler] 每日搜索词否定已启动，执行时间: 凌晨4:00`);
  
  // 6. 预算智能分配 - 早8:00和晚18:00（仅预算分配）
  optimizationIntervals.budget_allocation = setInterval(async () => {
    const hour = new Date().getHours();
    if ((hour === 8 || hour === 18) && shouldExecuteThisHour('budget_allocation')) {
      await executeOptimizationTask('budget_allocation');
    }
  }, 60 * 60 * 1000);
  console.log(`[OptimizationScheduler] 预算智能分配已启动，执行时间: 早8:00 + 晚18:00`);
  
  // 7. 搜索词收割 - 周一凌晨5:00
  optimizationIntervals.search_term_harvest = setInterval(async () => {
    const now = new Date();
    if (now.getDay() === 1 && now.getHours() === 5 && shouldExecuteThisHour('search_term_harvest')) {
      await executeOptimizationTask('search_term_harvest');
    }
  }, 60 * 60 * 1000);
  console.log(`[OptimizationScheduler] 搜索词收割已启动，执行时间: 周一凌晨5:00`);
  
  // 8. 绩效周报 - 周一上午9:00
  optimizationIntervals.weekly_report = setInterval(async () => {
    const now = new Date();
    if (now.getDay() === 1 && now.getHours() === 9 && shouldExecuteThisHour('weekly_report')) {
      await executeOptimizationTask('weekly_report');
    }
  }, 60 * 60 * 1000);
  console.log(`[OptimizationScheduler] 绩效周报已启动，执行时间: 周一上午9:00`);
  
  console.log('[OptimizationScheduler] v122分层优化调度器启动完成');
  console.log('[OptimizationScheduler] 调度频率表:');
  Object.values(OPTIMIZATION_SCHEDULE).forEach(config => {
    const modules = config.specificModules?.length ? config.specificModules.join(', ') : '独立执行';
    console.log(`  - ${config.description} | 模块: ${modules}`);
  });
}

/**
 * 停止优化调度器
 */
export function stopOptimizationScheduler(): void {
  Object.keys(optimizationIntervals).forEach((type) => {
    const interval = optimizationIntervals[type as OptimizationTaskType];
    if (interval) {
      clearInterval(interval);
      optimizationIntervals[type as OptimizationTaskType] = null;
    }
  });
  console.log('[OptimizationScheduler] 分层优化调度器已停止');
}

/**
 * 执行优化任务 (v122 重构版)
 * 
 * 核心修复：
 * 1. 每个任务只执行对应的 specificModules，不再全量执行所有优化模块
 * 2. 风控扫描不再调用 executeAllEnabledTargets（之前每4小时执行全量优化）
 * 3. 新增日内节奏监控和分时竞价独立调度
 * 4. 使用执行锁防止重复执行
 */
async function executeOptimizationTask(taskType: OptimizationTaskType): Promise<void> {
  // 获取执行锁
  if (!acquireLock(taskType)) return;
  
  const config = OPTIMIZATION_SCHEDULE[taskType];
  console.log(`[OptimizationScheduler] 开始执行: ${config.description} - ${new Date().toISOString()}`);
  
  try {
    // 直接导入优化目标引擎
    const { executeAllEnabledTargets, getEnabledOptimizationTargets } = await import('./optimizationTargetEngine');
    
    switch (taskType) {
      // ==================== 日内节奏监控（每30分钟）====================
      case 'intraday_pacing': {
        console.log(`[OptimizationScheduler] 执行日内节奏监控`);
        try {
          const { checkAllCampaignsPacing, applyIntradayAdjustment } = await import('./services/intradayPacingService');
          const targets = await getEnabledOptimizationTargets();
          const checkedAccountIds = new Set<number>();
          
          for (const target of targets) {
            if (checkedAccountIds.has(target.accountId)) continue;
            checkedAccountIds.add(target.accountId);
            
            try {
              const adjustments = await checkAllCampaignsPacing(target.accountId);
              const criticalCount = adjustments.filter(a => a.pacingStatus === 'critical' || a.anomalyDetected).length;
              const overspendCount = adjustments.filter(a => a.pacingStatus === 'overspending').length;
              const underspendCount = adjustments.filter(a => a.pacingStatus === 'underspending').length;
              
              // 自动应用调整（仅对critical和overspending的Campaign）
              for (const adj of adjustments) {
                if (adj.suggestedAction !== 'none' && (adj.pacingStatus === 'critical' || adj.pacingStatus === 'overspending')) {
                  await applyIntradayAdjustment(adj);
                }
              }
              
              console.log(`[OptimizationScheduler] 账号 ${target.accountId} 日内节奏检查完成: ` +
                `${adjustments.length}个Campaign, 危急=${criticalCount}, 超速=${overspendCount}, 欠速=${underspendCount}`);
            } catch (pacingError: any) {
              console.error(`[OptimizationScheduler] 账号 ${target.accountId} 日内节奏检查异常:`, pacingError.message);
            }
          }
        } catch (pacingError: any) {
          console.error(`[OptimizationScheduler] 日内节奏监控异常:`, pacingError.message);
        }
        break;
      }
      
      // ==================== 高频风控扫描（每2小时，仅风控）====================
      case 'risk_scan': {
        // v122修复：风控扫描仅执行风险检测，不再调用executeAllEnabledTargets
        console.log(`[OptimizationScheduler] 执行风控扫描(仅风控，不含优化)`);
        try {
          const targets = await getEnabledOptimizationTargets();
          const scannedAccountIds = new Set<number>();
          
          for (const target of targets) {
            if (scannedAccountIds.has(target.accountId)) continue;
            scannedAccountIds.add(target.accountId);
            
            try {
              const riskCampaigns = await db.getCampaignsByAccountId(target.accountId);
              const enabledCampaigns = riskCampaigns.filter((c: any) => c.campaignStatus === 'enabled');
              let totalRisks = 0;
              for (const campaign of enabledCampaigns) {
                const riskResult = await detectRiskSignals(target.accountId, campaign.id);
                if (riskResult.hasRisk) {
                  totalRisks += riskResult.risks.length;
                  for (const risk of riskResult.risks) {
                    console.warn(`[RiskScan] Campaign ${campaign.campaignName}: ` +
                      `[${risk.severity}] ${risk.description}`);
                  }
                }
              }
              console.log(`[OptimizationScheduler] 账号 ${target.accountId} 风控扫描完成: ${enabledCampaigns.length}个Campaign, ${totalRisks}个风险信号`);
            } catch (riskError: any) {
              console.error(`[OptimizationScheduler] 账号 ${target.accountId} 风控扫描异常:`, riskError.message);
            }
          }
        } catch (riskError: any) {
          console.error(`[OptimizationScheduler] 风控扫描异常:`, riskError.message);
        }
        // v122修复：删除了此处的 executeAllEnabledTargets() 调用
        // 之前风控扫描会执行全量优化（出价+位置+分时+搜索词+预算+关键词），导致所有模块的独立调度频率失效
        break;
      }
      
      // ==================== 分时竞价调整（每小时）====================
      case 'dayparting_adjustment': {
        console.log(`[OptimizationScheduler] 执行分时竞价调整`);
        try {
          // v122: 仅执行分时竞价模块
          const daypartingResults = await executeAllEnabledTargets(undefined, { 
            dryRun: false, 
            specificModules: ['dayparting', 'coordination'] 
          });
          console.log(`[OptimizationScheduler] 分时竞价调整完成: ${daypartingResults.length}个目标`);
          for (const r of daypartingResults) {
            console.log(`  - ${r.targetName}: 分时调整=${r.daypartingOptimization.adjustmentsCount}`);
          }
        } catch (daypartingError: any) {
          console.error(`[OptimizationScheduler] 分时竞价调整失败:`, daypartingError.message);
        }
        break;
      }
        
      // ==================== 每日出价优化（凌晨2:00）====================
      case 'daily_bid_optimization': {
        console.log(`[OptimizationScheduler] 执行每日出价优化`);
        try {
          // v122修复：仅执行出价+关键词状态+协调模块
          const bidResults = await executeAllEnabledTargets(undefined, { 
            dryRun: false, 
            specificModules: ['bid', 'keyword', 'coordination'] 
          });
          console.log(`[OptimizationScheduler] 出价优化完成: ${bidResults.length}个目标`);
          for (const r of bidResults) {
            console.log(`  - ${r.targetName}: 出价调整=${r.bidOptimization.adjustmentsCount}, 关键词暂停=${r.keywordStatusChanges.pausedCount}, 关键词启用=${r.keywordStatusChanges.enabledCount}`);
          }
        } catch (bidError: any) {
          console.error(`[OptimizationScheduler] 出价优化失败:`, bidError.message);
        }
        break;
      }
      
      // ==================== 每日位置优化（凌晨3:00）====================
      case 'daily_placement_optimization': {
        console.log(`[OptimizationScheduler] 执行每日位置优化`);
        try {
          // v122: 仅执行位置优化模块
          const placementResults = await executeAllEnabledTargets(undefined, { 
            dryRun: false, 
            specificModules: ['placement'] 
          });
          console.log(`[OptimizationScheduler] 位置优化完成: ${placementResults.length}个目标`);
          for (const r of placementResults) {
            console.log(`  - ${r.targetName}: 位置调整=${r.placementOptimization.adjustmentsCount}`);
          }
        } catch (placementError: any) {
          console.error(`[OptimizationScheduler] 位置优化失败:`, placementError.message);
        }
        break;
      }
      
      // ==================== 每日搜索词否定（凌晨4:00）====================
      case 'daily_search_term_negation': {
        console.log(`[OptimizationScheduler] 执行每日搜索词否定分析`);
        try {
          // v122: 仅执行搜索词分析模块
          const searchTermResults = await executeAllEnabledTargets(undefined, { 
            dryRun: false, 
            specificModules: ['searchterm'] 
          });
          console.log(`[OptimizationScheduler] 搜索词否定完成: ${searchTermResults.length}个目标`);
          for (const r of searchTermResults) {
            console.log(`  - ${r.targetName}: 否定词添加=${r.searchTermAnalysis.negativeKeywordsAdded}, 新关键词=${r.searchTermAnalysis.newKeywordsAdded}`);
          }
        } catch (searchTermError: any) {
          console.error(`[OptimizationScheduler] 搜索词否定失败:`, searchTermError.message);
        }
        break;
      }
        
      // ==================== 预算智能分配（早8:00+晚18:00）====================
      case 'budget_allocation': {
        console.log(`[OptimizationScheduler] 执行预算智能分配`);
        try {
          // v122修复：仅执行预算分配模块
          const budgetResults = await executeAllEnabledTargets(undefined, { 
            dryRun: false, 
            specificModules: ['budget'] 
          });
          console.log(`[OptimizationScheduler] 预算分配完成: ${budgetResults.length}个目标`);
          for (const r of budgetResults) {
            console.log(`  - ${r.targetName}: 预算调整=${r.budgetAllocation.adjustmentsCount}`);
          }
        } catch (budgetError: any) {
          console.error(`[OptimizationScheduler] 预算分配失败:`, budgetError.message);
        }
        break;
      }
        
      // ==================== 搜索词收割（周一凌晨5:00）====================
      case 'search_term_harvest': {
        console.log(`[OptimizationScheduler] 执行搜索词收割`);
        try {
          const targets = await getEnabledOptimizationTargets();
          const harvestedAccountIds = new Set<number>();
          
          for (const target of targets) {
            if (harvestedAccountIds.has(target.accountId)) continue;
            harvestedAccountIds.add(target.accountId);
            
            try {
              const harvestResult = await searchTermHarvester.batchHarvestSearchTerms(
                target.accountId,
                { dryRun: false }
              );
              console.log(`[OptimizationScheduler] 账号 ${target.accountId} 搜索词收割完成: ` +
                `候选=${harvestResult.summary.total}, ` +
                `成功=${harvestResult.summary.success}, ` +
                `失败=${harvestResult.summary.failed}, ` +
                `回滚=${harvestResult.summary.rolledBack}`);
            } catch (harvestError: any) {
              console.error(`[OptimizationScheduler] 账号 ${target.accountId} 搜索词收割异常:`, harvestError.message);
            }
          }
        } catch (harvestError: any) {
          console.error(`[OptimizationScheduler] 搜索词收割异常:`, harvestError.message);
        }
        break;
      }
        
      // ==================== 绩效周报（周一上午9:00）====================
      case 'weekly_report': {
        console.log(`[OptimizationScheduler] 生成绩效周报`);
        // TODO: 实现绩效周报生成逻辑
        break;
      }
    }
    
    console.log(`[OptimizationScheduler] ${config.description} 执行完成`);
    
  } catch (error: any) {
    console.error(`[OptimizationScheduler] ${taskType} 执行失败:`, error.message);
  } finally {
    // 确保释放执行锁
    releaseLock(taskType);
  }
}

// 导出同步层级配置和优化调度配置供外部使用
export { SYNC_TIER_CONFIG, frequencyToMs, OPTIMIZATION_SCHEDULE };
