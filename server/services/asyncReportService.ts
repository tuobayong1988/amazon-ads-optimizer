/**
 * 异步报告服务
 * 
 * 功能：
 * 1. 提交报告请求并存储任务
 * 2. 定期检查报告状态
 * 3. 下载完成的报告并处理数据
 * 4. 支持归因回溯（SP 14天，SB/SD 30天）
 * 5. 支持新店铺分段式初始化（90天热数据+365天冷数据）
 */

import { getDb } from '../db';
import { reportJobs, amazonApiCredentials, amsPerformanceData, campaigns } from '../../drizzle/schema';
import { eq, and, inArray, sql, isNull, or } from 'drizzle-orm';
import { AmazonAdsApiClient } from '../amazonAdsApi';

// 报告类型配置
const REPORT_CONFIG = {
  SP: {
    attributionDays: 14,
    reportType: 'spCampaigns',
    adProduct: 'SPONSORED_PRODUCTS',
  },
  SB: {
    attributionDays: 30,
    reportType: 'sbCampaigns',
    adProduct: 'SPONSORED_BRANDS',
  },
  SD: {
    attributionDays: 30,
    reportType: 'sdCampaigns',
    adProduct: 'SPONSORED_DISPLAY',
  },
};

// 日期切片配置
const SLICE_CONFIG = {
  hotData: {
    days: 90,
    sliceSize: 3, // 3天一个切片（降低单个任务数据量）
  },
  coldData: {
    startDay: 91,
    endDay: 365,
    sliceSize: 14, // 14天一个切片（降低单个任务数据量）
  },
};

// 广告类型列表（用于按类型拆分任务）
const AD_TYPES: Array<'SP' | 'SB' | 'SD'> = ['SP', 'SB', 'SD'];

interface ReportJobInput {
  accountId: number;
  profileId: string;
  adType: 'SP' | 'SB' | 'SD';
  startDate: string;
  endDate: string;
}

// 扩展的报告任务输入（用于初始化服务）
interface ExtendedReportJobInput {
  accountId: number;
  profileId: string;
  reportType: string;
  adProduct: string;
  startDate: string;
  endDate: string;
  priority?: 'high' | 'low';
  metadata?: Record<string, any>;
}

/**
 * 异步报告服务类
 */
export class AsyncReportService {
  private apiClient: AmazonAdsApiClient | null = null;

  /**
   * 初始化API客户端
   */
  private async initApiClient(accountId: number): Promise<AmazonAdsApiClient> {
    const db = await getDb();
    if (!db) throw new Error('Database not available');

    const [credentials] = await db
      .select()
      .from(amazonApiCredentials)
      .where(eq(amazonApiCredentials.accountId, accountId))
      .limit(1);

    if (!credentials) {
      throw new Error(`No API credentials found for account ${accountId}`);
    }

    return new AmazonAdsApiClient(credentials as any);
  }

  /**
   * 生成日期切片
   */
  private generateDateSlices(
    totalDays: number,
    sliceSize: number,
    startOffset: number = 1
  ): Array<{ startDate: string; endDate: string }> {
    const slices: Array<{ startDate: string; endDate: string }> = [];
    const now = new Date();

    for (let i = startOffset; i <= totalDays; i += sliceSize) {
      const endOffset = i;
      const sliceStartOffset = Math.min(i + sliceSize - 1, totalDays);

      const endDate = new Date(now);
      endDate.setDate(endDate.getDate() - endOffset);

      const startDate = new Date(now);
      startDate.setDate(startDate.getDate() - sliceStartOffset);

      slices.push({
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0],
      });
    }

    return slices;
  }

  /**
   * 创建报告任务
   */
  async createReportJob(input: ReportJobInput): Promise<number> {
    const db = await getDb();
    if (!db) throw new Error('Database not available');

    const config = REPORT_CONFIG[input.adType];

    const [result] = await db.insert(reportJobs).values({
      accountId: input.accountId,
      profileId: input.profileId,
      reportType: config.reportType,
      adProduct: config.adProduct,
      status: 'pending',
      startDate: input.startDate,
      endDate: input.endDate,
      requestPayload: JSON.stringify({
        adType: input.adType,
        startDate: input.startDate,
        endDate: input.endDate,
      }),
      retryCount: 0,
      maxRetries: 3,
    });

    return result.insertId;
  }

  /**
   * 创建报告任务（扩展版，用于初始化服务）
   */
  async createReportJobExtended(input: ExtendedReportJobInput): Promise<number> {
    const db = await getDb();
    if (!db) throw new Error('Database not available');

    const [result] = await db.insert(reportJobs).values({
      accountId: input.accountId,
      profileId: input.profileId,
      reportType: input.reportType,
      adProduct: input.adProduct,
      status: 'pending',
      startDate: input.startDate,
      endDate: input.endDate,
      requestPayload: JSON.stringify({
        reportType: input.reportType,
        adProduct: input.adProduct,
        startDate: input.startDate,
        endDate: input.endDate,
        priority: input.priority || 'low',
        metadata: input.metadata || {},
      }),
      retryCount: 0,
      maxRetries: 3,
    });

    return result.insertId;
  }

  /**
   * 批量创建报告任务（用于新店铺初始化）
   */
  async createInitializationJobs(accountId: number, profileId: string): Promise<number[]> {
    const jobIds: number[] = [];

    // 为每种广告类型创建任务
    for (const adType of ['SP', 'SB', 'SD'] as const) {
      // 热数据（最近90天）
      const hotSlices = this.generateDateSlices(
        SLICE_CONFIG.hotData.days,
        SLICE_CONFIG.hotData.sliceSize
      );

      for (const slice of hotSlices) {
        const jobId = await this.createReportJob({
          accountId,
          profileId,
          adType,
          startDate: slice.startDate,
          endDate: slice.endDate,
        });
        jobIds.push(jobId);
      }

      // 冷数据（91-365天）
      const coldSlices = this.generateDateSlices(
        SLICE_CONFIG.coldData.endDay,
        SLICE_CONFIG.coldData.sliceSize,
        SLICE_CONFIG.coldData.startDay
      );

      for (const slice of coldSlices) {
        const jobId = await this.createReportJob({
          accountId,
          profileId,
          adType,
          startDate: slice.startDate,
          endDate: slice.endDate,
        });
        jobIds.push(jobId);
      }
    }

    console.log(`[AsyncReportService] Created ${jobIds.length} initialization jobs for account ${accountId}`);
    return jobIds;
  }

  /**
   * 创建归因回溯任务（每日运行）
   */
  async createAttributionJobs(accountId: number, profileId: string): Promise<number[]> {
    const jobIds: number[] = [];

    for (const adType of ['SP', 'SB', 'SD'] as const) {
      const config = REPORT_CONFIG[adType];
      const slices = this.generateDateSlices(config.attributionDays, 7);

      for (const slice of slices) {
        const jobId = await this.createReportJob({
          accountId,
          profileId,
          adType,
          startDate: slice.startDate,
          endDate: slice.endDate,
        });
        jobIds.push(jobId);
      }
    }

    console.log(`[AsyncReportService] Created ${jobIds.length} attribution jobs for account ${accountId}`);
    return jobIds;
  }

  /**
   * 提交待处理的报告任务
   */
  async submitPendingJobs(limit: number = 10): Promise<number> {
    const db = await getDb();
    if (!db) {
      console.log('[AsyncReportService] Database not available, skipping submit');
      return 0;
    }

    // 获取待提交的任务
    const pendingJobs = await db
      .select()
      .from(reportJobs)
      .where(eq(reportJobs.status, 'pending'))
      .orderBy(reportJobs.createdAt)
      .limit(limit);

    let submittedCount = 0;

    for (const job of pendingJobs) {
      try {
        const apiClient = await this.initApiClient(job.accountId);
        apiClient.setProfileId(job.profileId);

        // 根据广告类型提交报告请求
        let reportId: string;
        let payload: { adType?: string } = {};
        
        // 处理requestPayload可能是字符串或对象的情况
        if (job.requestPayload) {
          if (typeof job.requestPayload === 'string') {
            try {
              payload = JSON.parse(job.requestPayload);
            } catch (e) {
              console.log(`[AsyncReportService] Failed to parse requestPayload for job ${job.id}, using adProduct`);
            }
          } else if (typeof job.requestPayload === 'object') {
            payload = job.requestPayload as { adType?: string };
          }
        }
        
        // 如果payload中没有adType，尝试使用adProduct字段
        const adType = payload.adType || (job as any).adProduct;

        switch (adType) {
          case 'SP':
            reportId = await apiClient.requestSpCampaignReport(job.startDate, job.endDate);
            break;
          case 'SB':
            reportId = await apiClient.requestSbCampaignReport(job.startDate, job.endDate);
            break;
          case 'SD':
            reportId = await apiClient.requestSdCampaignReport(job.startDate, job.endDate);
            break;
          default:
            throw new Error(`Unknown ad type: ${payload.adType}`);
        }

        // 更新任务状态
        await db
          .update(reportJobs)
          .set({
            status: 'submitted',
            reportId,
            submittedAt: new Date().toISOString(),
          })
          .where(eq(reportJobs.id, job.id));

        submittedCount++;
        console.log(`[AsyncReportService] Submitted job ${job.id} with reportId ${reportId}`);
      } catch (error: any) {
        const errorMessage = error.message || 'Unknown error';
        const statusCode = error.response?.status || error.status;
        
        // 详细记录错误信息
        console.error(`[AsyncReportService] Failed to submit job ${job.id}:`, {
          message: errorMessage,
          statusCode,
          accountId: job.accountId,
          profileId: job.profileId,
        });

        // 根据错误类型决定处理方式
        let newStatus: 'pending' | 'submitted' | 'processing' | 'completed' | 'failed' | 'expired' = 'pending';
        let shouldRetry = true;
        
        // 403错误通常表示API授权问题，不应重试
        if (statusCode === 403) {
          newStatus = 'failed' as const;
          shouldRetry = false;
          console.warn(`[AsyncReportService] Job ${job.id} failed with 403 - API authorization issue, marking as failed`);
        }
        // 429错误表示速率限制，应该重试但增加延迟
        else if (statusCode === 429) {
          console.warn(`[AsyncReportService] Job ${job.id} hit rate limit, will retry later`);
        }
        // 401错误表示token过期，可以重试（token会自动刷新）
        else if (statusCode === 401) {
          console.warn(`[AsyncReportService] Job ${job.id} token expired, will retry with refreshed token`);
        }
        // 5xx错误表示服务器问题，可以重试
        else if (statusCode >= 500) {
          console.warn(`[AsyncReportService] Job ${job.id} server error, will retry`);
        }

        // 增加重试次数
        const newRetryCount = (job.retryCount || 0) + 1;
        if (shouldRetry && newRetryCount >= (job.maxRetries || 3)) {
          newStatus = 'failed' as const;
        }

        await db
          .update(reportJobs)
          .set({
            retryCount: newRetryCount,
            status: newStatus,
            errorMessage: `[${statusCode || 'N/A'}] ${errorMessage}`,
          })
          .where(eq(reportJobs.id, job.id));
      }
    }

    return submittedCount;
  }

  /**
   * 检查已提交报告的状态
   */
  async checkSubmittedJobs(limit: number = 20): Promise<{ completed: number; failed: number; pending: number }> {
    const db = await getDb();
    if (!db) {
      console.log('[AsyncReportService] Database not available, skipping check');
      return { completed: 0, failed: 0, pending: 0 };
    }

    // 获取已提交但未完成的任务
    const submittedJobs = await db
      .select()
      .from(reportJobs)
      .where(
        or(
          eq(reportJobs.status, 'submitted'),
          eq(reportJobs.status, 'processing')
        )
      )
      .orderBy(reportJobs.submittedAt)
      .limit(limit);

    let completed = 0;
    let failed = 0;
    let pending = 0;

    for (const job of submittedJobs) {
      if (!job.reportId) {
        continue;
      }

      try {
        const apiClient = await this.initApiClient(job.accountId);
        apiClient.setProfileId(job.profileId);

        const status = await apiClient.getReportStatus(job.reportId);

        if (status.status === 'COMPLETED') {
          // 报告完成，更新状态和下载URL
          await db
            .update(reportJobs)
            .set({
              status: 'completed',
              downloadUrl: status.url,
              completedAt: new Date().toISOString(),
            })
            .where(eq(reportJobs.id, job.id));

          completed++;
          console.log(`[AsyncReportService] Job ${job.id} completed, URL: ${status.url?.substring(0, 50)}...`);
        } else if (status.status === 'FAILED') {
          // 报告失败
          await db
            .update(reportJobs)
            .set({
              status: 'failed',
              errorMessage: status.failureReason || 'Report generation failed',
            })
            .where(eq(reportJobs.id, job.id));

          failed++;
          console.log(`[AsyncReportService] Job ${job.id} failed: ${status.failureReason}`);
        } else {
          // 仍在处理中
          await db
            .update(reportJobs)
            .set({ status: 'processing' })
            .where(eq(reportJobs.id, job.id));

          pending++;
        }
      } catch (error: any) {
        console.error(`[AsyncReportService] Error checking job ${job.id}:`, error.message);
        failed++;
      }
    }

    return { completed, failed, pending };
  }

  /**
   * 下载并处理完成的报告
   */
  async processCompletedJobs(limit: number = 5): Promise<number> {
    const db = await getDb();
    if (!db) {
      console.log('[AsyncReportService] Database not available, skipping process');
      return 0;
    }

    // 获取已完成但未处理的任务
    const completedJobs = await db
      .select()
      .from(reportJobs)
      .where(
        and(
          eq(reportJobs.status, 'completed'),
          isNull(reportJobs.processedAt)
        )
      )
      .orderBy(reportJobs.completedAt)
      .limit(limit);

    let processedCount = 0;

    for (const job of completedJobs) {
      if (!job.downloadUrl) {
        continue;
      }

      try {
        const apiClient = await this.initApiClient(job.accountId);

        // 下载报告数据
        const reportData = await apiClient.downloadReport(job.downloadUrl);

        if (!reportData || reportData.length === 0) {
          console.log(`[AsyncReportService] Job ${job.id} has no data`);
          await db
            .update(reportJobs)
            .set({
              processedAt: new Date().toISOString(),
              recordsProcessed: 0,
            })
            .where(eq(reportJobs.id, job.id));
          continue;
        }

        // 处理报告数据
        const payload = JSON.parse(job.requestPayload as string || '{}');
        const recordsProcessed = await this.processReportData(
          job.accountId,
          payload.adType,
          reportData
        );

        // 更新任务状态
        await db
          .update(reportJobs)
          .set({
            processedAt: new Date().toISOString(),
            recordsProcessed,
          })
          .where(eq(reportJobs.id, job.id));

        processedCount++;
        console.log(`[AsyncReportService] Job ${job.id} processed ${recordsProcessed} records`);
      } catch (error: any) {
        console.error(`[AsyncReportService] Error processing job ${job.id}:`, error.message);

        await db
          .update(reportJobs)
          .set({
            errorMessage: error.message,
          })
          .where(eq(reportJobs.id, job.id));
      }
    }

    return processedCount;
  }

  /**
   * 处理报告数据并存储到数据库
   */
  private async processReportData(
    accountId: number,
    adType: 'SP' | 'SB' | 'SD',
    data: any[]
  ): Promise<number> {
    const db = await getDb();
    if (!db) throw new Error('Database not available');

    let processedCount = 0;

    for (const row of data) {
      try {
        const date = row.date;
        const campaignId = row.campaignId;

        if (!date || !campaignId) {
          continue;
        }

        // 查找对应的campaign
        const [campaign] = await db
          .select()
          .from(campaigns)
          .where(
            and(
              eq(campaigns.accountId, accountId),
              eq(campaigns.campaignId, campaignId)
            )
          )
          .limit(1);

        const internalCampaignId = campaign?.id;

        // 准备绩效数据
        const performanceData = {
          accountId,
          campaignId: internalCampaignId || null,
          amazonCampaignId: campaignId,
          date,
          adType,
          impressions: parseInt(row.impressions) || 0,
          clicks: parseInt(row.clicks) || 0,
          spend: parseFloat(row.cost || row.spend) || 0,
          sales: parseFloat(row.sales14d || row.attributedSales14d || row.sales7d || row.attributedSales7d || row.sales) || 0,
          orders: parseInt(row.purchases14d || row.attributedConversions14d || row.purchases7d || row.attributedConversions7d || row.orders) || 0,
          dataSource: 'api' as const,
        };

        // Upsert到ams_performance_data表
        const existingRecord = await db
          .select()
          .from(amsPerformanceData)
          .where(
            and(
              eq(amsPerformanceData.accountId, accountId),
              eq(amsPerformanceData.campaignId, campaignId),
              eq(amsPerformanceData.reportDate, date)
            )
          )
          .limit(1);

        if (existingRecord.length > 0) {
          // 更新现有记录
          await db
            .update(amsPerformanceData)
            .set({
              impressions: performanceData.impressions,
              clicks: performanceData.clicks,
              spend: performanceData.spend.toString(),
              sales: performanceData.sales.toString(),
              orders: performanceData.orders,
              dataSource: 'api',
            })
            .where(eq(amsPerformanceData.id, existingRecord[0].id));
        } else {
          // 插入新记录
          await db.insert(amsPerformanceData).values({
            accountId: performanceData.accountId,
            campaignId: campaignId, // 使用Amazon Campaign ID
            reportDate: performanceData.date,
            dataSetId: `api-${adType.toLowerCase()}`, // 标识数据来源
            impressions: performanceData.impressions,
            clicks: performanceData.clicks,
            spend: performanceData.spend.toString(),
            sales: performanceData.sales.toString(),
            orders: performanceData.orders,
            dataSource: 'api',
          });
        }

        // 同时更新campaigns表的汇总数据
        if (campaign) {
          await db
            .update(campaigns)
            .set({
              impressions: sql`${campaigns.impressions} + ${performanceData.impressions}`,
              clicks: sql`${campaigns.clicks} + ${performanceData.clicks}`,
              spend: sql`${campaigns.spend} + ${performanceData.spend}`,
              sales: sql`${campaigns.sales} + ${performanceData.sales}`,
              orders: sql`${campaigns.orders} + ${performanceData.orders}`,
            })
            .where(eq(campaigns.id, campaign.id));
        }

        processedCount++;
      } catch (error: any) {
        console.error(`[AsyncReportService] Error processing row:`, error.message);
      }
    }

    return processedCount;
  }

  /**
   * 获取任务统计
   */
  async getJobStats(): Promise<{
    pending: number;
    submitted: number;
    processing: number;
    completed: number;
    failed: number;
  }> {
    const db = await getDb();
    if (!db) {
      return { pending: 0, submitted: 0, processing: 0, completed: 0, failed: 0 };
    }

    const stats = await db
      .select({
        status: reportJobs.status,
        count: sql<number>`count(*)`,
      })
      .from(reportJobs)
      .groupBy(reportJobs.status);

    const result = {
      pending: 0,
      submitted: 0,
      processing: 0,
      completed: 0,
      failed: 0,
    };

    for (const stat of stats) {
      if (stat.status in result) {
        result[stat.status as keyof typeof result] = Number(stat.count);
      }
    }

    return result;
  }

  /**
   * 清理过期任务
   */
  async cleanupExpiredJobs(daysOld: number = 7): Promise<number> {
    const db = await getDb();
    if (!db) return 0;

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const result = await db
      .delete(reportJobs)
      .where(
        and(
          inArray(reportJobs.status, ['completed', 'failed', 'expired']),
          sql`${reportJobs.createdAt} < ${cutoffDate.toISOString()}`
        )
      );

    return (result as any).rowsAffected || 0;
  }
}

// 导出单例
export const asyncReportService = new AsyncReportService();
