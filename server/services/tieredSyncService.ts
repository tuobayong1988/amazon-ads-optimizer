/**
 * 智能分层同步服务 - 方案五
 * 
 * 核心思想：不是所有数据都需要同样的粒度
 * 
 * 数据分层：
 * - 实时层（最近7天）：1天切片，全部报告类型，合并广告类型
 * - 热数据层（8-30天）：7天切片，全部报告类型，合并广告类型
 * - 温数据层（31-90天）：15天切片，Campaign+AdGroup，合并广告类型
 * - 冷数据层（91-365天）：30天切片，仅Campaign，合并广告类型
 * 
 * 增量重试机制：
 * - 记录已成功处理的数据范围
 * - 只重试失败的部分
 * - 支持断点续传
 */

import { getDb } from '../db';
import { reportJobs, adAccounts } from '../../drizzle/schema';
import { eq, and, sql, gte, lte, inArray } from 'drizzle-orm';
import { AmazonAdsApiClient } from '../amazonAdsApi';

// 数据层级定义
export type DataTier = 'realtime' | 'hot' | 'warm' | 'cold';

// 报告类型
export type ReportType = 'campaign' | 'adGroup' | 'keyword' | 'target';

// 智能分层配置
const TIER_CONFIG: Record<DataTier, {
  name: string;
  startDay: number;
  endDay: number;
  sliceSize: number;
  reportTypes: ReportType[];
  priority: 'critical' | 'high' | 'medium' | 'low';
  description: string;
}> = {
  realtime: {
    name: '实时层',
    startDay: 0,
    endDay: 7,
    sliceSize: 1,
    reportTypes: ['campaign', 'adGroup', 'keyword', 'target'],
    priority: 'critical',
    description: '最近7天数据，算法决策最需要，最高粒度',
  },
  hot: {
    name: '热数据层',
    startDay: 8,
    endDay: 30,
    sliceSize: 7,
    reportTypes: ['campaign', 'adGroup', 'keyword', 'target'],
    priority: 'high',
    description: '8-30天数据，归因回溯期，需要完整数据',
  },
  warm: {
    name: '温数据层',
    startDay: 31,
    endDay: 90,
    sliceSize: 15,
    reportTypes: ['campaign', 'adGroup'],
    priority: 'medium',
    description: '31-90天数据，趋势分析用，中等粒度',
  },
  cold: {
    name: '冷数据层',
    startDay: 91,
    endDay: 365,
    sliceSize: 30,
    reportTypes: ['campaign'],
    priority: 'low',
    description: '91-365天数据，历史基线，只需Campaign汇总',
  },
};

// 报告类型到Amazon API的映射
const REPORT_TYPE_MAPPING: Record<ReportType, {
  spReportType: string;
  sbReportType: string;
  sdReportType: string;
}> = {
  campaign: {
    spReportType: 'spCampaigns',
    sbReportType: 'sbCampaigns',
    sdReportType: 'sdCampaigns',
  },
  adGroup: {
    spReportType: 'spAdGroups',
    sbReportType: 'sbAdGroups',
    sdReportType: 'sdAdGroups',
  },
  keyword: {
    spReportType: 'spKeywords',
    sbReportType: 'sbKeywords',
    sdReportType: 'sdTargets', // SD没有keyword，用target代替
  },
  target: {
    spReportType: 'spTargets',
    sbReportType: 'sbTargets',
    sdReportType: 'sdTargets',
  },
};

// 任务进度追踪
interface TaskProgress {
  taskId: number;
  tier: DataTier;
  reportType: ReportType;
  startDate: string;
  endDate: string;
  processedRanges: Array<{ start: string; end: string }>;
  failedRanges: Array<{ start: string; end: string; error: string; retryCount: number }>;
  status: 'pending' | 'submitted' | 'processing' | 'completed' | 'failed' | 'expired';
  lastCheckpoint: string | null;
}

// 分层任务输入
interface TieredTaskInput {
  accountId: number;
  profileId: string;
  tier: DataTier;
  reportType: ReportType;
  startDate: string;
  endDate: string;
  metadata?: Record<string, any>;
}

/**
 * 智能分层同步服务类
 */
export class TieredSyncService {
  
  /**
   * 获取分层配置
   */
  getTierConfig() {
    return TIER_CONFIG;
  }

  /**
   * 计算各层任务数量
   */
  calculateTaskCounts(): {
    tier: DataTier;
    name: string;
    slices: number;
    reportTypes: number;
    totalTasks: number;
    description: string;
  }[] {
    const result = [];
    
    for (const [tier, config] of Object.entries(TIER_CONFIG) as [DataTier, typeof TIER_CONFIG[DataTier]][]) {
      const days = config.endDay - config.startDay;
      const slices = Math.ceil(days / config.sliceSize);
      const reportTypes = config.reportTypes.length;
      // 每个切片 × 每种报告类型 = 任务数（广告类型合并在一个请求中）
      const totalTasks = slices * reportTypes;
      
      result.push({
        tier,
        name: config.name,
        slices,
        reportTypes,
        totalTasks,
        description: config.description,
      });
    }
    
    return result;
  }

  /**
   * 获取总任务数
   */
  getTotalTaskCount(): number {
    return this.calculateTaskCounts().reduce((sum, t) => sum + t.totalTasks, 0);
  }

  /**
   * 生成日期切片
   */
  private generateDateSlices(
    startDay: number,
    endDay: number,
    sliceSize: number
  ): Array<{ startDate: string; endDate: string }> {
    const slices: Array<{ startDate: string; endDate: string }> = [];
    const today = new Date();
    
    let currentDay = startDay;
    while (currentDay < endDay) {
      const sliceEndDay = Math.min(currentDay + sliceSize, endDay);
      
      const startDate = new Date(today);
      startDate.setDate(startDate.getDate() - sliceEndDay);
      
      const endDate = new Date(today);
      endDate.setDate(endDate.getDate() - currentDay - 1);
      
      slices.push({
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0],
      });
      
      currentDay = sliceEndDay;
    }
    
    return slices;
  }

  /**
   * 创建分层初始化任务
   */
  async createTieredInitializationTasks(
    accountId: number,
    profileId: string
  ): Promise<{
    totalTasks: number;
    tasksByTier: Record<DataTier, number>;
    taskIds: number[];
  }> {
    const db = await getDb();
    if (!db) throw new Error('Database not available');

    const taskIds: number[] = [];
    const tasksByTier: Record<DataTier, number> = {
      realtime: 0,
      hot: 0,
      warm: 0,
      cold: 0,
    };

    // 按优先级顺序处理各层
    const tierOrder: DataTier[] = ['realtime', 'hot', 'warm', 'cold'];
    
    for (const tier of tierOrder) {
      const config = TIER_CONFIG[tier];
      const slices = this.generateDateSlices(config.startDay, config.endDay, config.sliceSize);
      
      for (const slice of slices) {
        for (const reportType of config.reportTypes) {
          // 创建任务（合并SP/SB/SD在一个任务中）
          const [result] = await db.insert(reportJobs).values({
            accountId,
            profileId,
            reportType: `tiered_${tier}_${reportType}`,
            adProduct: 'ALL', // 合并所有广告类型
            startDate: slice.startDate,
            endDate: slice.endDate,
            status: 'pending',
            priority: config.priority,
            retryCount: 0,
            metadata: JSON.stringify({
              tier,
              reportType,
              tierConfig: config,
              processedRanges: [],
              failedRanges: [],
            }),
            createdAt: new Date().toISOString(),
          });
          
          taskIds.push(result.insertId);
          tasksByTier[tier]++;
        }
      }
    }

    console.log(`[TieredSyncService] Created ${taskIds.length} tiered initialization tasks for account ${accountId}`);
    console.log(`[TieredSyncService] Tasks by tier:`, tasksByTier);

    return {
      totalTasks: taskIds.length,
      tasksByTier,
      taskIds,
    };
  }

  /**
   * 获取任务进度
   */
  async getTaskProgress(taskId: number): Promise<TaskProgress | null> {
    const db = await getDb();
    if (!db) return null;

    const [task] = await db
      .select()
      .from(reportJobs)
      .where(eq(reportJobs.id, taskId))
      .limit(1);

    if (!task) return null;

    const metadata = task.metadata ? JSON.parse(task.metadata as string) : {};

    return {
      taskId: task.id,
      tier: metadata.tier || 'unknown',
      reportType: metadata.reportType || 'unknown',
      startDate: task.startDate || '',
      endDate: task.endDate || '',
      processedRanges: metadata.processedRanges || [],
      failedRanges: metadata.failedRanges || [],
      status: task.status,
      lastCheckpoint: metadata.lastCheckpoint || null,
    };
  }

  /**
   * 更新任务进度（断点续传支持）
   */
  async updateTaskProgress(
    taskId: number,
    update: {
      processedRange?: { start: string; end: string };
      failedRange?: { start: string; end: string; error: string };
      status?: TaskProgress['status'];
      checkpoint?: string;
    }
  ): Promise<void> {
    const db = await getDb();
    if (!db) return;

    const progress = await this.getTaskProgress(taskId);
    if (!progress) return;

    const metadata: any = {
      tier: progress.tier,
      reportType: progress.reportType,
      processedRanges: progress.processedRanges,
      failedRanges: progress.failedRanges,
      lastCheckpoint: progress.lastCheckpoint,
    };

    // 添加已处理范围
    if (update.processedRange) {
      metadata.processedRanges.push(update.processedRange);
    }

    // 添加失败范围
    if (update.failedRange) {
      const existingFailed = metadata.failedRanges.find(
        (r: any) => r.start === update.failedRange!.start && r.end === update.failedRange!.end
      );
      if (existingFailed) {
        existingFailed.retryCount = (existingFailed.retryCount || 0) + 1;
        existingFailed.error = update.failedRange.error;
      } else {
        metadata.failedRanges.push({
          ...update.failedRange,
          retryCount: 1,
        });
      }
    }

    // 更新检查点
    if (update.checkpoint) {
      metadata.lastCheckpoint = update.checkpoint;
    }

    // 更新数据库
    const newStatus = update.status || progress.status;
    // 确保状态是有效的枚举值
    const validStatuses = ['pending', 'submitted', 'processing', 'completed', 'failed', 'expired'] as const;
    const finalStatus = validStatuses.includes(newStatus as any) ? newStatus as typeof validStatuses[number] : 'pending';
    
    await db
      .update(reportJobs)
      .set({
        status: finalStatus,
        metadata: JSON.stringify(metadata),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(reportJobs.id, taskId));
  }

  /**
   * 获取需要重试的失败范围
   */
  async getFailedRangesForRetry(
    taskId: number,
    maxRetries: number = 3
  ): Promise<Array<{ start: string; end: string }>> {
    const progress = await this.getTaskProgress(taskId);
    if (!progress) return [];

    return progress.failedRanges
      .filter(r => r.retryCount < maxRetries)
      .map(r => ({ start: r.start, end: r.end }));
  }

  /**
   * 检查任务是否可以标记为完成
   */
  async checkTaskCompletion(taskId: number): Promise<{
    isComplete: boolean;
    hasFailures: boolean;
    completionPercent: number;
  }> {
    const progress = await this.getTaskProgress(taskId);
    if (!progress) {
      return { isComplete: false, hasFailures: false, completionPercent: 0 };
    }

    const totalDays = this.calculateDaysBetween(progress.startDate, progress.endDate);
    const processedDays = progress.processedRanges.reduce((sum, r) => {
      return sum + this.calculateDaysBetween(r.start, r.end);
    }, 0);
    const failedDays = progress.failedRanges.reduce((sum, r) => {
      return sum + this.calculateDaysBetween(r.start, r.end);
    }, 0);

    const completionPercent = totalDays > 0 ? Math.round((processedDays / totalDays) * 100) : 0;
    const hasFailures = progress.failedRanges.length > 0;
    const isComplete = processedDays + failedDays >= totalDays;

    return { isComplete, hasFailures, completionPercent };
  }

  /**
   * 计算两个日期之间的天数
   */
  private calculateDaysBetween(start: string, end: string): number {
    const startDate = new Date(start);
    const endDate = new Date(end);
    const diffTime = Math.abs(endDate.getTime() - startDate.getTime());
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
  }

  /**
   * 获取初始化进度统计
   */
  async getInitializationStats(accountId: number): Promise<{
    totalTasks: number;
    completedTasks: number;
    failedTasks: number;
    pendingTasks: number;
    processingTasks: number;
    progressByTier: Record<DataTier, {
      total: number;
      completed: number;
      failed: number;
      pending: number;
      processing: number;
      percent: number;
    }>;
    overallPercent: number;
  }> {
    const db = await getDb();
    if (!db) {
      return {
        totalTasks: 0,
        completedTasks: 0,
        failedTasks: 0,
        pendingTasks: 0,
        processingTasks: 0,
        progressByTier: {
          realtime: { total: 0, completed: 0, failed: 0, pending: 0, processing: 0, percent: 0 },
          hot: { total: 0, completed: 0, failed: 0, pending: 0, processing: 0, percent: 0 },
          warm: { total: 0, completed: 0, failed: 0, pending: 0, processing: 0, percent: 0 },
          cold: { total: 0, completed: 0, failed: 0, pending: 0, processing: 0, percent: 0 },
        },
        overallPercent: 0,
      };
    }

    // 获取所有分层任务
    const tasks = await db
      .select()
      .from(reportJobs)
      .where(
        and(
          eq(reportJobs.accountId, accountId),
          sql`${reportJobs.reportType} LIKE 'tiered_%'`
        )
      );

    const progressByTier: Record<DataTier, {
      total: number;
      completed: number;
      failed: number;
      pending: number;
      processing: number;
      percent: number;
    }> = {
      realtime: { total: 0, completed: 0, failed: 0, pending: 0, processing: 0, percent: 0 },
      hot: { total: 0, completed: 0, failed: 0, pending: 0, processing: 0, percent: 0 },
      warm: { total: 0, completed: 0, failed: 0, pending: 0, processing: 0, percent: 0 },
      cold: { total: 0, completed: 0, failed: 0, pending: 0, processing: 0, percent: 0 },
    };

    let totalTasks = 0;
    let completedTasks = 0;
    let failedTasks = 0;
    let pendingTasks = 0;
    let processingTasks = 0;

    for (const task of tasks) {
      const metadata = task.metadata ? JSON.parse(task.metadata as string) : {};
      const tier = metadata.tier as DataTier;
      
      if (!tier || !progressByTier[tier]) continue;

      totalTasks++;
      progressByTier[tier].total++;

      switch (task.status) {
        case 'completed':
          completedTasks++;
          progressByTier[tier].completed++;
          break;
        case 'failed':
          failedTasks++;
          progressByTier[tier].failed++;
          break;
        case 'pending':
          pendingTasks++;
          progressByTier[tier].pending++;
          break;
        case 'submitted':
        case 'processing':
          processingTasks++;
          progressByTier[tier].processing++;
          break;
      }
    }

    // 计算各层完成百分比
    for (const tier of Object.keys(progressByTier) as DataTier[]) {
      const tierStats = progressByTier[tier];
      tierStats.percent = tierStats.total > 0 
        ? Math.round((tierStats.completed / tierStats.total) * 100) 
        : 0;
    }

    const overallPercent = totalTasks > 0 
      ? Math.round((completedTasks / totalTasks) * 100) 
      : 0;

    return {
      totalTasks,
      completedTasks,
      failedTasks,
      pendingTasks,
      processingTasks,
      progressByTier,
      overallPercent,
    };
  }

  /**
   * 重试失败的任务（增量重试）
   */
  async retryFailedTasks(accountId: number, maxRetries: number = 3): Promise<{
    retriedCount: number;
    skippedCount: number;
  }> {
    const db = await getDb();
    if (!db) return { retriedCount: 0, skippedCount: 0 };

    // 获取失败的任务
    const failedTasks = await db
      .select()
      .from(reportJobs)
      .where(
        and(
          eq(reportJobs.accountId, accountId),
          eq(reportJobs.status, 'failed'),
          sql`${reportJobs.reportType} LIKE 'tiered_%'`
        )
      );

    let retriedCount = 0;
    let skippedCount = 0;

    for (const task of failedTasks) {
      const metadata = task.metadata ? JSON.parse(task.metadata as string) : {};
      const failedRanges = metadata.failedRanges || [];
      
      // 检查是否还有可重试的范围
      const retryableRanges = failedRanges.filter((r: any) => r.retryCount < maxRetries);
      
      if (retryableRanges.length > 0) {
        // 重置任务状态为pending，只处理失败的范围
        await db
          .update(reportJobs)
          .set({
            status: 'pending',
            metadata: JSON.stringify({
              ...metadata,
              retryMode: true,
              rangesToProcess: retryableRanges.map((r: any) => ({ start: r.start, end: r.end })),
            }),
            updatedAt: new Date().toISOString(),
          })
          .where(eq(reportJobs.id, task.id));
        
        retriedCount++;
      } else {
        skippedCount++;
      }
    }

    console.log(`[TieredSyncService] Retried ${retriedCount} tasks, skipped ${skippedCount} (max retries exceeded)`);

    return { retriedCount, skippedCount };
  }
}

// 导出单例
export const tieredSyncService = new TieredSyncService();
