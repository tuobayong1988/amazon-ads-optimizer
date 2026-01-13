/**
 * 智能同步策略服务
 * 
 * 根据账号初始化状态自动选择同步策略：
 * 1. 初始化模式：全量拉取历史数据（6-8小时窗口期）
 * 2. 增量模式：只同步T-1天数据 + 归因回溯校验
 * 
 * 优势：
 * - 初始化完成后，日常同步压力降低80%以上
 * - API配额使用更高效
 * - 数据准确性更有保障
 */

import { getDb } from '../db';
import { adAccounts, reportJobs } from '../../drizzle/schema';
import { eq, and, sql, gte, lte } from 'drizzle-orm';
import { accountInitializationService } from './accountInitializationService';
import { AsyncReportService } from './asyncReportService';

// 同步模式
export type SyncMode = 'initialization' | 'incremental';

// 同步配置
const SYNC_CONFIG = {
  // 增量同步配置
  incremental: {
    // 同步T-1天数据
    daysBack: 1,
    // 归因回溯配置
    attribution: {
      SP: 14, // SP广告14天归因窗口
      SB: 30, // SB广告30天归因窗口
      SD: 30, // SD广告30天归因窗口
    },
    // 归因回溯频率（每N天执行一次完整回溯）
    fullAttributionFrequency: 7,
    // 日常只校验最近N天的归因数据
    dailyAttributionCheck: 3,
  },
  // 初始化同步配置
  initialization: {
    hotData: {
      days: 90,
      sliceSize: 3, // 3天一个切片
    },
    coldData: {
      startDay: 91,
      endDay: 365,
      sliceSize: 14, // 14天一个切片
    },
    // 按广告类型拆分
    adTypes: ['SP', 'SB', 'SD'] as const,
  },
};

/**
 * 智能同步服务类
 */
export class SmartSyncService {
  private asyncReportService: AsyncReportService;

  constructor() {
    this.asyncReportService = new AsyncReportService();
  }

  /**
   * 获取账号的同步模式
   */
  async getSyncMode(accountId: number): Promise<SyncMode> {
    const isCompleted = await accountInitializationService.isInitializationCompleted(accountId);
    return isCompleted ? 'incremental' : 'initialization';
  }

  /**
   * 执行智能同步
   * 根据账号状态自动选择同步策略
   */
  async executeSmartSync(accountId: number): Promise<{
    mode: SyncMode;
    tasksCreated: number;
    message: string;
  }> {
    const mode = await this.getSyncMode(accountId);

    if (mode === 'initialization') {
      // 初始化模式：启动或继续初始化流程
      const result = await accountInitializationService.startInitialization(accountId);
      const totalTasks = result.phases?.reduce((sum, p) => sum + p.totalTasks, 0) || 0;
      
      return {
        mode: 'initialization',
        tasksCreated: totalTasks,
        message: result.message,
      };
    } else {
      // 增量模式：只同步增量数据
      const tasksCreated = await this.executeIncrementalSync(accountId);
      
      return {
        mode: 'incremental',
        tasksCreated,
        message: `增量同步任务已创建，共 ${tasksCreated} 个任务`,
      };
    }
  }

  /**
   * 执行增量同步
   * 只同步T-1天数据 + 定期归因回溯
   */
  private async executeIncrementalSync(accountId: number): Promise<number> {
    const db = await getDb();
    if (!db) return 0;
    let tasksCreated = 0;

    // 获取账号信息
    const [account] = await db
      .select()
      .from(adAccounts)
      .where(eq(adAccounts.id, accountId))
      .limit(1);

    if (!account || !account.profileId) {
      console.log(`[SmartSync] 账号 ${accountId} 无效或未配置profileId`);
      return 0;
    }

    const profileId = account.profileId;

    // 1. 同步T-1天数据
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    for (const adType of ['SP', 'SB', 'SD'] as const) {
      await this.asyncReportService.createReportJob({
        accountId,
        profileId,
        adType,
        startDate: yesterdayStr,
        endDate: yesterdayStr,
      });
      tasksCreated++;
    }

    // 2. 检查是否需要归因回溯
    const needsFullAttribution = await this.checkNeedsFullAttribution(accountId);
    
    if (needsFullAttribution) {
      // 完整归因回溯
      const attributionTasks = await this.asyncReportService.createAttributionJobs(accountId, profileId);
      tasksCreated += attributionTasks.length;
      console.log(`[SmartSync] 账号 ${accountId} 执行完整归因回溯，创建 ${attributionTasks.length} 个任务`);
    } else {
      // 日常归因校验（只校验最近几天）
      const dailyTasks = await this.createDailyAttributionCheck(accountId, profileId);
      tasksCreated += dailyTasks;
    }

    console.log(`[SmartSync] 账号 ${accountId} 增量同步完成，共创建 ${tasksCreated} 个任务`);
    return tasksCreated;
  }

  /**
   * 检查是否需要完整归因回溯
   */
  private async checkNeedsFullAttribution(accountId: number): Promise<boolean> {
    const db = await getDb();
    if (!db) return true;

    // 查找最近一次完整归因回溯的时间
    const [lastFullAttribution] = await db
      .select({ completedAt: reportJobs.completedAt })
      .from(reportJobs)
      .where(
        and(
          eq(reportJobs.accountId, accountId),
          eq(reportJobs.status, 'completed'),
          sql`JSON_EXTRACT(request_payload, '$.metadata.isFullAttribution') = true`
        )
      )
      .orderBy(sql`completed_at DESC`)
      .limit(1);

    if (!lastFullAttribution?.completedAt) {
      // 从未执行过完整归因回溯
      return true;
    }

    // 检查距离上次完整归因回溯是否超过配置的天数
    const lastDate = new Date(lastFullAttribution.completedAt);
    const daysSinceLastFull = Math.floor((Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24));
    
    return daysSinceLastFull >= SYNC_CONFIG.incremental.fullAttributionFrequency;
  }

  /**
   * 创建日常归因校验任务
   */
  private async createDailyAttributionCheck(accountId: number, profileId: string): Promise<number> {
    let tasksCreated = 0;
    const { dailyAttributionCheck, attribution } = SYNC_CONFIG.incremental;

    // 只校验最近几天的数据
    const today = new Date();
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - dailyAttributionCheck);

    for (const adType of ['SP', 'SB', 'SD'] as const) {
      // 根据广告类型选择合适的回溯天数
      const maxDays = Math.min(dailyAttributionCheck, attribution[adType]);
      
      const checkStartDate = new Date(today);
      checkStartDate.setDate(checkStartDate.getDate() - maxDays);

      await this.asyncReportService.createReportJob({
        accountId,
        profileId,
        adType,
        startDate: checkStartDate.toISOString().split('T')[0],
        endDate: today.toISOString().split('T')[0],
      });
      tasksCreated++;
    }

    return tasksCreated;
  }

  /**
   * 获取同步统计信息
   */
  async getSyncStats(accountId: number): Promise<{
    mode: SyncMode;
    initializationProgress?: number;
    lastSyncAt?: string;
    pendingTasks: number;
    completedTasks: number;
    failedTasks: number;
    estimatedDailyTasks: number;
  }> {
    const db = await getDb();
    const mode = await this.getSyncMode(accountId);

    if (!db) {
      return {
        mode,
        pendingTasks: 0,
        completedTasks: 0,
        failedTasks: 0,
        estimatedDailyTasks: 0,
      };
    }

    // 获取任务统计
    const stats = await db
      .select({
        status: reportJobs.status,
        count: sql<number>`COUNT(*)`,
      })
      .from(reportJobs)
      .where(eq(reportJobs.accountId, accountId))
      .groupBy(reportJobs.status);

    const statusMap = stats.reduce((acc: Record<string, number>, s: { status: string; count: number }) => {
      acc[s.status] = s.count;
      return acc;
    }, {} as Record<string, number>);

    // 获取初始化进度（如果在初始化中）
    let initializationProgress: number | undefined;
    if (mode === 'initialization') {
      const progress = await accountInitializationService.getInitializationProgress(accountId);
      initializationProgress = progress.progress;
    }

    // 获取最后同步时间
    const database = await db;
    if (!database) {
      return {
        mode,
        initializationProgress,
        lastSyncAt: undefined,
        pendingTasks: 0,
        completedTasks: 0,
        failedTasks: 0,
        estimatedDailyTasks: 0,
      };
    }
    const [lastSync] = await database
      .select({ completedAt: reportJobs.completedAt })
      .from(reportJobs)
      .where(
        and(
          eq(reportJobs.accountId, accountId),
          eq(reportJobs.status, 'completed')
        )
      )
      .orderBy(sql`completed_at DESC`)
      .limit(1);

    // 估算日常任务数
    // 增量模式：3（T-1数据）+ 3（日常归因校验）= 6个任务/天
    // 初始化模式：根据配置计算
    const estimatedDailyTasks = mode === 'incremental' ? 6 : 0;

    return {
      mode,
      initializationProgress,
      lastSyncAt: lastSync?.completedAt || undefined,
      pendingTasks: (statusMap['pending'] || 0) + (statusMap['submitted'] || 0) + (statusMap['processing'] || 0),
      completedTasks: statusMap['completed'] || 0,
      failedTasks: statusMap['failed'] || 0,
      estimatedDailyTasks,
    };
  }

  /**
   * 比较初始化模式和增量模式的任务数量
   * 
   * 新策略（方案四）：
   * - 热数据：3天切片 × 3种广告类型 = 每个时间段9个任务
   * - 冷数据：14天切片 × 3种广告类型 = 每个时间段3个任务
   * - 单个任务数据量大幅降低，处理更稳定
   */
  getTaskComparison(): {
    initialization: { hotData: number; coldData: number; total: number; details: string };
    incremental: { daily: number; weeklyAttribution: number; total: number };
    savingsPercent: number;
  } {
    const { initialization, incremental } = SYNC_CONFIG;

    // 初始化模式任务数（新策略：按广告类型拆分）
    const adTypes = 3; // SP, SB, SD
    
    // 热数据：90天 / 3天切片 = 30个时间段 × 3种广告类型 = 90个任务
    const hotDataSlices = Math.ceil(initialization.hotData.days / initialization.hotData.sliceSize);
    const initHotData = hotDataSlices * adTypes;
    
    // 冷数据：(365-91)/14 ≈ 20个时间段 × 3种广告类型 = 60个任务
    const coldDataDays = initialization.coldData.endDay - initialization.coldData.startDay;
    const coldDataSlices = Math.ceil(coldDataDays / initialization.coldData.sliceSize);
    const initColdData = coldDataSlices * adTypes;
    
    const initTotal = initHotData + initColdData;

    // 增量模式任务数（每天）
    const dailyTasks = adTypes; // T-1数据（3个任务）
    const dailyAttributionTasks = adTypes; // 日常归因校验（3个任务）
    const incrementalDaily = dailyTasks + dailyAttributionTasks;

    // 每周完整归因回溯
    const spAttributionSlices = Math.ceil(incremental.attribution.SP / 7);
    const sbAttributionSlices = Math.ceil(incremental.attribution.SB / 7);
    const sdAttributionSlices = Math.ceil(incremental.attribution.SD / 7);
    const weeklyAttribution = spAttributionSlices + sbAttributionSlices + sdAttributionSlices;

    // 计算节省比例
    // 假设一年运行：初始化模式每天都要跑全量 vs 增量模式
    const yearlyWithoutInit = initTotal * 365;
    const yearlyWithInit = initTotal + (incrementalDaily * 365) + (weeklyAttribution * 52);
    const savingsPercent = Math.round((1 - yearlyWithInit / yearlyWithoutInit) * 100);

    return {
      initialization: {
        hotData: initHotData,
        coldData: initColdData,
        total: initTotal,
        details: `热数据: ${hotDataSlices}切片×${adTypes}类型=${initHotData}任务, 冷数据: ${coldDataSlices}切片×${adTypes}类型=${initColdData}任务`,
      },
      incremental: {
        daily: incrementalDaily,
        weeklyAttribution,
        total: incrementalDaily * 7 + weeklyAttribution, // 每周总任务
      },
      savingsPercent,
    };
  }
}

// 导出单例
export const smartSyncService = new SmartSyncService();
