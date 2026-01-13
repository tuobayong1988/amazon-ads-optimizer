/**
 * 账号初始化服务
 * 负责新店铺接入后的数据初始化流程
 * 
 * 初始化窗口期：6-8小时
 * 
 * 初始化阶段：
 * 1. 热数据（90天）- 高优先级，7天切片
 * 2. 冷数据（91-365天）- 低优先级，30天切片
 * 3. 结构数据 - 广告活动、广告组、关键词、定位
 */

import { getDb } from '../db';
import { adAccounts, accountInitializationProgress, reportJobs } from '../../drizzle/schema';
import { eq, and, sql } from 'drizzle-orm';
import { AsyncReportService } from './asyncReportService';

// 初始化配置
const INITIALIZATION_CONFIG = {
  // 热数据配置
  hotData: {
    days: 90,
    sliceSize: 7, // 7天一个切片
    priority: 'high',
  },
  // 冷数据配置
  coldData: {
    startDay: 91,
    endDay: 365,
    sliceSize: 30, // 30天一个切片
    priority: 'low',
  },
  // 广告类型
  adProducts: ['SPONSORED_PRODUCTS', 'SPONSORED_BRANDS', 'SPONSORED_DISPLAY'] as const,
  // 报告类型
  reportTypes: {
    SPONSORED_PRODUCTS: ['spCampaigns', 'spAdGroups', 'spKeywords', 'spTargets'],
    SPONSORED_BRANDS: ['sbCampaigns', 'sbAdGroups', 'sbKeywords', 'sbTargets'],
    SPONSORED_DISPLAY: ['sdCampaigns', 'sdAdGroups', 'sdTargets'],
  },
};

// 初始化阶段
type InitializationPhase = 'hot_data' | 'cold_data' | 'structure_data';

// 初始化状态
type InitializationStatus = 'pending' | 'initializing' | 'completed' | 'failed';

export class AccountInitializationService {
  private asyncReportService: AsyncReportService;

  constructor() {
    this.asyncReportService = new AsyncReportService();
  }

  /**
   * 开始账号初始化
   */
  async startInitialization(accountId: number): Promise<{
    success: boolean;
    message: string;
    phases?: { phase: string; totalTasks: number }[];
  }> {
    const db = await getDb();
    if (!db) return { success: false, message: '数据库不可用' };

    // 获取账号信息
    const [account] = await db
      .select()
      .from(adAccounts)
      .where(eq(adAccounts.id, accountId))
      .limit(1);

    if (!account) {
      return { success: false, message: '账号不存在' };
    }

    if (!account.profileId) {
      return { success: false, message: '账号未配置profileId' };
    }

    // 检查是否已在初始化中
    if (account.initializationStatus === 'initializing') {
      return { success: false, message: '账号正在初始化中' };
    }

    // 检查是否已完成初始化
    if (account.initializationStatus === 'completed') {
      return { success: false, message: '账号已完成初始化' };
    }

    console.log(`[AccountInit] 开始初始化账号 ${accountId} (${account.accountName})`);

    // 更新账号状态为初始化中
    await db
      .update(adAccounts)
      .set({
        initializationStatus: 'initializing',
        initializationStartedAt: sql`NOW()`,
        initializationProgress: 0,
        initializationError: null,
      })
      .where(eq(adAccounts.id, accountId));

    // 创建初始化阶段记录
    const phases: { phase: InitializationPhase; totalTasks: number }[] = [];

    // 1. 热数据阶段
    const hotDataTasks = await this.createHotDataTasks(accountId, account.profileId);
    phases.push({ phase: 'hot_data', totalTasks: hotDataTasks });

    // 2. 冷数据阶段
    const coldDataTasks = await this.createColdDataTasks(accountId, account.profileId);
    phases.push({ phase: 'cold_data', totalTasks: coldDataTasks });

    // 3. 结构数据阶段（广告活动、广告组等）
    const structureTasks = await this.createStructureDataTasks(accountId, account.profileId);
    phases.push({ phase: 'structure_data', totalTasks: structureTasks });

    // 初始化进度记录
    for (const { phase, totalTasks } of phases) {
      await db
        .insert(accountInitializationProgress)
        .values({
          accountId,
          phase,
          phaseStatus: 'pending',
          totalTasks,
          completedTasks: 0,
          failedTasks: 0,
        })
        .onDuplicateKeyUpdate({
          set: {
            phaseStatus: 'pending',
            totalTasks,
            completedTasks: 0,
            failedTasks: 0,
            startedAt: null,
            completedAt: null,
            errorMessage: null,
          },
        });
    }

    const totalTasks = phases.reduce((sum, p) => sum + p.totalTasks, 0);
    console.log(`[AccountInit] 账号 ${accountId} 初始化任务创建完成，共 ${totalTasks} 个任务`);

    return {
      success: true,
      message: `初始化任务已创建，共 ${totalTasks} 个任务`,
      phases: phases.map(p => ({ phase: p.phase, totalTasks: p.totalTasks })),
    };
  }

  /**
   * 创建热数据任务（最近90天）
   */
  private async createHotDataTasks(accountId: number, profileId: string): Promise<number> {
    const { days, sliceSize } = INITIALIZATION_CONFIG.hotData;
    let taskCount = 0;

    // 计算日期切片
    const today = new Date();
    const slices: { startDate: string; endDate: string }[] = [];

    for (let i = 0; i < days; i += sliceSize) {
      const endDay = Math.min(i + sliceSize - 1, days - 1);
      const startDate = new Date(today);
      startDate.setDate(startDate.getDate() - endDay - 1);
      const endDate = new Date(today);
      endDate.setDate(endDate.getDate() - i - 1);

      slices.push({
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0],
      });
    }

    // 为每个广告类型创建报告任务
    for (const adProduct of INITIALIZATION_CONFIG.adProducts) {
      const reportTypes = INITIALIZATION_CONFIG.reportTypes[adProduct];
      
      for (const reportType of reportTypes) {
        for (const slice of slices) {
          await this.asyncReportService.createReportJobExtended({
            accountId,
            profileId,
            reportType,
            adProduct,
            startDate: slice.startDate,
            endDate: slice.endDate,
            priority: 'high',
            metadata: {
              initPhase: 'hot_data',
              isInitialization: true,
            },
          });
          taskCount++;
        }
      }
    }

    console.log(`[AccountInit] 账号 ${accountId} 热数据任务创建完成: ${taskCount} 个`);
    return taskCount;
  }

  /**
   * 创建冷数据任务（91-365天）
   */
  private async createColdDataTasks(accountId: number, profileId: string): Promise<number> {
    const { startDay, endDay, sliceSize } = INITIALIZATION_CONFIG.coldData;
    let taskCount = 0;

    // 计算日期切片
    const today = new Date();
    const slices: { startDate: string; endDate: string }[] = [];

    for (let i = startDay; i <= endDay; i += sliceSize) {
      const sliceEnd = Math.min(i + sliceSize - 1, endDay);
      const startDate = new Date(today);
      startDate.setDate(startDate.getDate() - sliceEnd - 1);
      const endDate = new Date(today);
      endDate.setDate(endDate.getDate() - i);

      slices.push({
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0],
      });
    }

    // 为每个广告类型创建报告任务（冷数据只拉取Campaign级别）
    for (const adProduct of INITIALIZATION_CONFIG.adProducts) {
      const reportType = adProduct === 'SPONSORED_PRODUCTS' ? 'spCampaigns' :
                        adProduct === 'SPONSORED_BRANDS' ? 'sbCampaigns' : 'sdCampaigns';
      
      for (const slice of slices) {
        await this.asyncReportService.createReportJob({
          accountId,
          profileId,
          reportType,
          adProduct,
          startDate: slice.startDate,
          endDate: slice.endDate,
          priority: 'low',
          metadata: {
            initPhase: 'cold_data',
            isInitialization: true,
          },
        });
        taskCount++;
      }
    }

    console.log(`[AccountInit] 账号 ${accountId} 冷数据任务创建完成: ${taskCount} 个`);
    return taskCount;
  }

  /**
   * 创建结构数据任务（广告活动、广告组等）
   */
  private async createStructureDataTasks(accountId: number, profileId: string): Promise<number> {
    // 结构数据通过现有的同步服务获取，这里只记录任务数
    // 实际同步由 amazonSyncService 处理
    let taskCount = 0;

    // 每个广告类型需要同步：广告活动、广告组、关键词/定位
    for (const adProduct of INITIALIZATION_CONFIG.adProducts) {
      // 广告活动
      taskCount++;
      // 广告组
      taskCount++;
      // 关键词/定位
      taskCount++;
    }

    console.log(`[AccountInit] 账号 ${accountId} 结构数据任务创建完成: ${taskCount} 个`);
    return taskCount;
  }

  /**
   * 获取初始化进度
   */
  async getInitializationProgress(accountId: number): Promise<{
    status: InitializationStatus;
    progress: number;
    phases: {
      phase: string;
      status: string;
      totalTasks: number;
      completedTasks: number;
      failedTasks: number;
      progressPercent: number;
    }[];
    estimatedTimeRemaining?: number; // 分钟
    startedAt?: string;
    completedAt?: string;
    error?: string;
  }> {
    const db = await getDb();
    if (!db) throw new Error('数据库不可用');

    // 获取账号状态
    const [account] = await db
      .select()
      .from(adAccounts)
      .where(eq(adAccounts.id, accountId))
      .limit(1);

    if (!account) {
      throw new Error('账号不存在');
    }

    // 获取各阶段进度
    const progressRecords = await db
      .select()
      .from(accountInitializationProgress)
      .where(eq(accountInitializationProgress.accountId, accountId));

    const phases = progressRecords.map(record => ({
      phase: record.phase,
      status: record.phaseStatus,
      totalTasks: record.totalTasks,
      completedTasks: record.completedTasks,
      failedTasks: record.failedTasks,
      progressPercent: record.totalTasks > 0 
        ? Math.round((record.completedTasks / record.totalTasks) * 100) 
        : 0,
    }));

    // 计算总进度
    const totalTasks = phases.reduce((sum: number, p: { totalTasks: number }) => sum + p.totalTasks, 0);
    const completedTasks = phases.reduce((sum: number, p: { completedTasks: number }) => sum + p.completedTasks, 0);
    const overallProgress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

    // 估算剩余时间（假设每个任务平均需要30秒）
    const remainingTasks = totalTasks - completedTasks;
    const estimatedTimeRemaining = Math.ceil(remainingTasks * 0.5); // 分钟

    return {
      status: (account.initializationStatus || 'pending') as InitializationStatus,
      progress: overallProgress,
      phases,
      estimatedTimeRemaining: account.initializationStatus === 'initializing' ? estimatedTimeRemaining : undefined,
      startedAt: account.initializationStartedAt || undefined,
      completedAt: account.initializationCompletedAt || undefined,
      error: account.initializationError || undefined,
    };
  }

  /**
   * 更新阶段进度
   */
  async updatePhaseProgress(
    accountId: number,
    phase: InitializationPhase,
    completedTasks: number,
    failedTasks: number = 0
  ): Promise<void> {
    const db = await getDb();
    if (!db) return;

    // 获取阶段记录
    const [record] = await db
      .select()
      .from(accountInitializationProgress)
      .where(
        and(
          eq(accountInitializationProgress.accountId, accountId),
          eq(accountInitializationProgress.phase, phase)
        )
      )
      .limit(1);

    if (!record) return;

    const newCompletedTasks = record.completedTasks + completedTasks;
    const newFailedTasks = record.failedTasks + failedTasks;
    const isCompleted = newCompletedTasks + newFailedTasks >= record.totalTasks;

    await db
      .update(accountInitializationProgress)
      .set({
        completedTasks: newCompletedTasks,
        failedTasks: newFailedTasks,
        phaseStatus: isCompleted ? (newFailedTasks > 0 ? 'failed' : 'completed') : 'in_progress',
        startedAt: record.startedAt || sql`NOW()`,
        completedAt: isCompleted ? sql`NOW()` : null,
      })
      .where(
        and(
          eq(accountInitializationProgress.accountId, accountId),
          eq(accountInitializationProgress.phase, phase)
        )
      );

    // 检查是否所有阶段都完成
    await this.checkAndUpdateOverallStatus(accountId);
  }

  /**
   * 检查并更新整体初始化状态
   */
  private async checkAndUpdateOverallStatus(accountId: number): Promise<void> {
    const db = await getDb();
    if (!db) return;

    const progressRecords = await db
      .select()
      .from(accountInitializationProgress)
      .where(eq(accountInitializationProgress.accountId, accountId));

    const allCompleted = progressRecords.every(r => r.phaseStatus === 'completed');
    const anyFailed = progressRecords.some(r => r.phaseStatus === 'failed');

    // 计算总进度
    const totalTasks = progressRecords.reduce((sum, r) => sum + r.totalTasks, 0);
    const completedTasks = progressRecords.reduce((sum, r) => sum + r.completedTasks, 0);
    const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

    if (allCompleted) {
      await db
        .update(adAccounts)
        .set({
          initializationStatus: 'completed',
          initializationCompletedAt: sql`NOW()`,
          initializationProgress: 100,
        })
        .where(eq(adAccounts.id, accountId));

      console.log(`[AccountInit] 账号 ${accountId} 初始化完成！`);
    } else if (anyFailed) {
      const failedPhases = progressRecords
        .filter(r => r.phaseStatus === 'failed')
        .map(r => r.phase)
        .join(', ');

      await db
        .update(adAccounts)
        .set({
          initializationStatus: 'failed',
          initializationProgress: progress,
          initializationError: `以下阶段失败: ${failedPhases}`,
        })
        .where(eq(adAccounts.id, accountId));
    } else {
      // 更新进度
      await db
        .update(adAccounts)
        .set({
          initializationProgress: progress,
        })
        .where(eq(adAccounts.id, accountId));
    }
  }

  /**
   * 重试失败的初始化
   */
  async retryFailedInitialization(accountId: number): Promise<{
    success: boolean;
    message: string;
  }> {
    const db = await getDb();
    if (!db) return { success: false, message: '数据库不可用' };

    // 获取失败的阶段
    const failedPhases = await db
      .select()
      .from(accountInitializationProgress)
      .where(
        and(
          eq(accountInitializationProgress.accountId, accountId),
          eq(accountInitializationProgress.phaseStatus, 'failed')
        )
      );

    if (failedPhases.length === 0) {
      return { success: false, message: '没有失败的阶段需要重试' };
    }

    // 重置失败阶段的状态
    for (const phase of failedPhases) {
      await db
        .update(accountInitializationProgress)
        .set({
          phaseStatus: 'pending',
          completedTasks: 0,
          failedTasks: 0,
          startedAt: null,
          completedAt: null,
          errorMessage: null,
        })
        .where(eq(accountInitializationProgress.id, phase.id));
    }

    // 更新账号状态
    await db
      .update(adAccounts)
      .set({
        initializationStatus: 'initializing',
        initializationError: null,
      })
      .where(eq(adAccounts.id, accountId));

    return {
      success: true,
      message: `已重置 ${failedPhases.length} 个失败阶段，将重新初始化`,
    };
  }

  /**
   * 检查账号是否已完成初始化
   */
  async isInitializationCompleted(accountId: number): Promise<boolean> {
    const db = await getDb();
    if (!db) return false;

    const [account] = await db
      .select({ status: adAccounts.initializationStatus })
      .from(adAccounts)
      .where(eq(adAccounts.id, accountId))
      .limit(1);

    return account?.status === 'completed';
  }

  /**
   * 获取需要初始化的账号列表
   */
  async getPendingInitializationAccounts(): Promise<{
    id: number;
    accountName: string;
    marketplace: string;
    status: string;
  }[]> {
    const db = await getDb();
    if (!db) return [];

    const accounts = await db
      .select({
        id: adAccounts.id,
        accountName: adAccounts.accountName,
        marketplace: adAccounts.marketplace,
        status: adAccounts.initializationStatus,
      })
      .from(adAccounts)
      .where(eq(adAccounts.initializationStatus, 'pending'));

    return accounts.map(a => ({
      id: a.id,
      accountName: a.accountName,
      marketplace: a.marketplace,
      status: a.status || 'pending',
    }));
  }
}

// 导出单例
export const accountInitializationService = new AccountInitializationService();
