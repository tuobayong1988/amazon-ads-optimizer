/**
 * v649: 异步报告服务 — P2-3 架构升级
 * 
 * 核心改进:
 * 1. processReportData 多类型路由器 — 根据 syncType 分发到对应处理函数
 * 2. submitPendingJobs 修复 — 根据 syncType/reportName 调用正确的报告请求方法，跳过已有 reportId 的任务
 * 3. 批量预加载 campaigns — 消除 N+1 查询
 * 4. 支持所有报告类型: campaign绩效、关键词绩效、搜索词、定向、广告位
 * 5. 归因回溯（SP 14天，SB/SD 30天）
 * 6. 新店铺分段式初始化（90天热数据+365天冷数据）
 */

import { getDb } from '../../db';
import { reportJobs, amazonApiCredentials, amsPerformanceData, campaigns, keywords, searchTerms, productTargets, adGroups, dailyPerformance, placementPerformance, negativeKeywords } from '../../../drizzle/schema';
import { eq, and, inArray, sql, isNull, or } from 'drizzle-orm';
import { AmazonAdsApiClient } from '../amazonAdsApi';
import { createModuleLogger } from '../../utils/logger';

const log = createModuleLogger('AsyncReport');

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
    sliceSize: 3,
  },
  coldData: {
    startDay: 91,
    endDay: 365,
    sliceSize: 14,
  },
};

interface ReportJobInput {
  accountId: number;
  profileId: string;
  adType: 'SP' | 'SB' | 'SD';
  startDate: string;
  endDate: string;
}

interface ExtendedReportJobInput {
  accountId: number;
  profileId: string;
  reportType: string;
  adProduct: string;
  startDate: string;
  endDate: string;
  priority?: 'high' | 'low';
  metadata?: Record<string, unknown>;
}

// v649: 解析 requestPayload 的辅助函数
interface ParsedPayload {
  adType?: string;
  syncType?: string;
  reportName?: string;
  source?: string;
  startDate?: string;
  endDate?: string;
  accountId?: number;
}

function parsePayload(job: { requestPayload: unknown }): ParsedPayload {
  if (!job.requestPayload) return {};
  if (typeof job.requestPayload === 'string') {
    try {
      return JSON.parse(job.requestPayload);
    } catch {
      return {};
    }
  }
  if (typeof job.requestPayload === 'object') {
    return job.requestPayload as ParsedPayload;
  }
  return {};
}

/**
 * v649: 根据 syncType 和 reportName 确定正确的报告请求方法
 */
function getReportRequestMethod(
  apiClient: AmazonAdsApiClient,
  payload: ParsedPayload,
  adProduct: string
): ((startDate: string, endDate: string) => Promise<string>) | null {
  const syncType = payload.syncType || '';
  const reportName = (payload.reportName || '').toLowerCase();
  const adType = (payload.adType || '').toUpperCase();

  // 1. 通过 syncType 精确匹配
  if (syncType === 'performance' || syncType === 'campaign_performance') {
    if (adType === 'SP' || adProduct === 'SPONSORED_PRODUCTS') {
      return (s, e) => apiClient.requestSpCampaignReport(s, e);
    } else if (adType === 'SB' || adProduct === 'SPONSORED_BRANDS') {
      return (s, e) => apiClient.requestSbCampaignReport(s, e);
    } else if (adType === 'SD' || adProduct === 'SPONSORED_DISPLAY') {
      return (s, e) => apiClient.requestSdCampaignReport(s, e);
    }
  }

  if (syncType === 'keyword_performance') {
    if (adType === 'SP' || adProduct === 'SPONSORED_PRODUCTS') {
      return (s, e) => apiClient.requestSpKeywordReport(s, e);
    } else if (adType === 'SB' || adProduct === 'SPONSORED_BRANDS') {
      // SB关键词通过sbCampaigns报告获取
      return (s, e) => apiClient.requestSbCampaignReport(s, e);
    }
  }

  if (syncType === 'search_term_sync') {
    if (reportName.includes('sb') || adType === 'SB') {
      return (s, e) => apiClient.requestSbSearchTermReport(s, e);
    }
    // 默认SP搜索词
    return (s, e) => apiClient.requestSpSearchTermReport(s, e);
  }

  if (syncType === 'targeting_sync' || syncType === 'sd_sync' || syncType === 'sb_sync') {
    // 通过 reportName 进一步区分
    if (reportName.includes('sb定向') || reportName.includes('sb targeting')) {
      return (s, e) => apiClient.requestSbTargetingReport(s, e);
    }
    if (reportName.includes('sd定向') || reportName.includes('sd targeting') || adType === 'SD') {
      return (s, e) => apiClient.requestSdTargetingReport(s, e);
    }
    if (reportName.includes('自动定向') || reportName.includes('auto targeting')) {
      return (s, e) => apiClient.requestSpAutoTargetingReport(s, e);
    }
    if (reportName.includes('sb搜索词') || reportName.includes('sb search')) {
      return (s, e) => apiClient.requestSbSearchTermReport(s, e);
    }
    if (reportName.includes('sb广告位') || reportName.includes('sb placement')) {
      return (s, e) => apiClient.requestSbCampaignPlacementReport(s, e);
    }
    if (reportName.includes('sp广告位') || reportName.includes('sp placement')) {
      return (s, e) => apiClient.requestSpPlacementReport(s, e);
    }
    // 根据 syncType 默认行为
    if (syncType === 'sd_sync') {
      return (s, e) => apiClient.requestSdTargetingReport(s, e);
    }
    if (syncType === 'sb_sync') {
      return (s, e) => apiClient.requestSbTargetingReport(s, e);
    }
  }

  if (syncType === 'placement_sync') {
    if (reportName.includes('sb') || adType === 'SB') {
      return (s, e) => apiClient.requestSbCampaignPlacementReport(s, e);
    }
    return (s, e) => apiClient.requestSpPlacementReport(s, e);
  }

  // 2. 旧版兼容：通过 adType/adProduct 回退到 campaign 报告
  if (adType === 'SP' || adProduct === 'SPONSORED_PRODUCTS') {
    return (s, e) => apiClient.requestSpCampaignReport(s, e);
  } else if (adType === 'SB' || adProduct === 'SPONSORED_BRANDS') {
    return (s, e) => apiClient.requestSbCampaignReport(s, e);
  } else if (adType === 'SD' || adProduct === 'SPONSORED_DISPLAY') {
    return (s, e) => apiClient.requestSdCampaignReport(s, e);
  }

  return null;
}

/**
 * 异步报告服务类
 */
export class AsyncReportService {
  private apiClientCache = new Map<number, { client: AmazonAdsApiClient; expiresAt: number }>();

  /**
   * 初始化API客户端（带缓存）
   */
  private async initApiClient(accountId: number): Promise<AmazonAdsApiClient> {
    // v649: 缓存API客户端5分钟，避免重复初始化
    const cached = this.apiClientCache.get(accountId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.client;
    }

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

    const { safeDecrypt } = await import('../../utils/cryptoService');
    const decryptedCreds = {
      ...credentials,
      clientSecret: safeDecrypt(credentials.clientSecret),
      refreshToken: safeDecrypt(credentials.refreshToken as string),
    };

    // @ts-expect-error - type assertion
    const client = new AmazonAdsApiClient(decryptedCreds as unknown);

    // 缓存5分钟
    this.apiClientCache.set(accountId, { client, expiresAt: Date.now() + 5 * 60 * 1000 });

    return client;
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

    for (const adType of ['SP', 'SB', 'SD'] as const) {
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

    log.debug(`[AsyncReportService] Created ${jobIds.length} initialization jobs for account ${accountId}`);
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

    log.debug(`[AsyncReportService] Created ${jobIds.length} attribution jobs for account ${accountId}`);
    return jobIds;
  }

  /**
   * v649: 提交待处理的报告任务（重写）
   * 
   * 改进:
   * 1. 跳过已有 reportId 的任务（避免重复提交）
   * 2. 根据 syncType/reportName 调用正确的报告请求方法
   * 3. 支持所有报告类型（不仅仅是 campaign 报告）
   */
  async submitPendingJobs(limit: number = 10): Promise<number> {
    const db = await getDb();
    if (!db) {
      log.info('[AsyncReportService] Database not available, skipping submit');
      return 0;
    }

    // v649: 只获取没有 reportId 的 pending 任务（跳过已提交但状态未更新的）
    const pendingJobs = await db
      .select()
      .from(reportJobs)
      .where(
        and(
          eq(reportJobs.status, 'pending'),
          or(
            isNull(reportJobs.reportId),
            sql`${reportJobs.reportId} = ''`
          )
        )
      )
      .orderBy(reportJobs.createdAt)
      .limit(limit);

    if (pendingJobs.length === 0) return 0;

    let submittedCount = 0;

    for (const job of pendingJobs) {
      try {
        const apiClient = await this.initApiClient(job.accountId);
        apiClient.setProfileId(job.profileId);

        // v649: 解析 payload 确定正确的报告请求方法
        const payload = parsePayload(job);
        const requestMethod = getReportRequestMethod(apiClient, payload, job.adProduct);

        if (!requestMethod) {
          log.warn(`[v649:AsyncReport] Cannot determine report request method for job ${job.id}, payload: ${JSON.stringify(payload)}, adProduct: ${job.adProduct}`);
          await db
            .update(reportJobs)
            .set({
              status: 'failed',
              errorMessage: `v649: Unknown report type - syncType=${payload.syncType}, adType=${payload.adType}, adProduct=${job.adProduct}`,
            })
            .where(eq(reportJobs.id, job.id));
          continue;
        }

        // 提交报告请求
        const reportId = await requestMethod(job.startDate, job.endDate);

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
        log.debug(`[v649:AsyncReport] Submitted job ${job.id} (syncType=${payload.syncType || 'default'}) with reportId ${reportId}`);

        // 提交间隔，避免限流
        if (submittedCount < pendingJobs.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (error: unknown) {
        const errorMessage = (error as Error).message || 'Unknown error';
        // @ts-expect-error - Axios error response access
        const statusCode = (error as Error & { response?: unknown }).response?.status || (error as { status?: number }).status;

        log.warn(`[v649:AsyncReport] Failed to submit job ${job.id}:`, {
          message: errorMessage,
          statusCode,
          accountId: job.accountId,
          profileId: job.profileId,
        });

        let newStatus: 'pending' | 'submitted' | 'processing' | 'completed' | 'failed' | 'expired' = 'pending';
        let shouldRetry = true;

        if (statusCode === 403) {
          newStatus = 'failed' as const;
          shouldRetry = false;
          log.warn(`[v649:AsyncReport] Job ${job.id} failed with 403 - API authorization issue`);
        } else if (statusCode === 429) {
          log.warn(`[v649:AsyncReport] Job ${job.id} hit rate limit, will retry later`);
        } else if (statusCode === 401) {
          log.warn(`[v649:AsyncReport] Job ${job.id} token expired, will retry`);
        } else if (statusCode >= 500) {
          log.warn(`[v649:AsyncReport] Job ${job.id} server error, will retry`);
        }

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
      log.info('[AsyncReportService] Database not available, skipping check');
      return { completed: 0, failed: 0, pending: 0 };
    }

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
          await db
            .update(reportJobs)
            .set({
              status: 'completed',
              downloadUrl: status.url,
              completedAt: new Date().toISOString(),
            })
            .where(eq(reportJobs.id, job.id));

          completed++;
          log.debug(`[AsyncReportService] Job ${job.id} completed, URL: ${status.url?.substring(0, 50)}...`);
        } else if (status.status === 'FAILED') {
          await db
            .update(reportJobs)
            .set({
              status: 'failed',
              errorMessage: status.failureReason || 'Report generation failed',
            })
            .where(eq(reportJobs.id, job.id));

          failed++;
          log.warn(`[AsyncReportService] Job ${job.id} failed: ${status.failureReason}`);
        } else {
          // v649: 检查超时（提交超过20分钟的任务标记为失败）
          const submittedAt = job.submittedAt ? new Date(job.submittedAt).getTime() : Date.now();
          const elapsed = Date.now() - submittedAt;
          if (elapsed > 20 * 60 * 1000) {
            await db
              .update(reportJobs)
              .set({
                status: 'failed',
                errorMessage: `v649: Report generation timeout after ${Math.round(elapsed / 60000)} minutes`,
              })
              .where(eq(reportJobs.id, job.id));
            failed++;
            log.warn(`[v649:AsyncReport] Job ${job.id} timed out after ${Math.round(elapsed / 60000)} minutes`);
          } else {
            await db
              .update(reportJobs)
              .set({ status: 'processing' })
              .where(eq(reportJobs.id, job.id));
            pending++;
          }
        }
      } catch (error: unknown) {
        log.warn(`[AsyncReportService] Error checking job ${job.id}:`, (error as Error).message);
        failed++;
      }
    }

    return { completed, failed, pending };
  }

  /**
   * v649: 下载并处理完成的报告（重写为多类型路由器）
   * 
   * 根据 requestPayload.syncType 分发到对应的处理函数:
   * - performance/campaign_performance → processCampaignPerformanceData
   * - keyword_performance → processKeywordPerformanceData
   * - search_term_sync → processSearchTermData
   * - targeting_sync/sd_sync/sb_sync → processTargetingData
   * - placement_sync → processPlacementData
   */
  async processCompletedJobs(limit: number = 5): Promise<number> {
    const db = await getDb();
    if (!db) {
      log.info('[AsyncReportService] Database not available, skipping process');
      return 0;
    }

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
          log.debug(`[v649:AsyncReport] Job ${job.id} has no data`);
          await db
            .update(reportJobs)
            .set({
              processedAt: new Date().toISOString(),
              recordsProcessed: 0,
            })
            .where(eq(reportJobs.id, job.id));
          processedCount++;
          continue;
        }

        // v649: 解析 payload 确定处理方式
        const payload = parsePayload(job);
        const syncType = payload.syncType || 'performance';
        const adType = (payload.adType || 'SP').toUpperCase() as 'SP' | 'SB' | 'SD';

        log.info(`[v649:AsyncReport] Processing job ${job.id}: syncType=${syncType}, adType=${adType}, records=${reportData.length}`);

        let recordsProcessed = 0;

        // v649: 多类型路由器
        switch (syncType) {
          case 'performance':
          case 'campaign_performance':
            recordsProcessed = await this.processCampaignPerformanceData(
              job.accountId, adType, reportData
            );
            break;

          case 'keyword_performance':
            // 检查 reportName 区分关键词绩效和广告位
            if (payload.reportName && (payload.reportName.includes('广告位') || payload.reportName.includes('placement'))) {
              recordsProcessed = await this.processPlacementData(
                job.accountId, adType, reportData
              );
            } else {
              recordsProcessed = await this.processKeywordPerformanceData(
                job.accountId, adType, reportData
              );
            }
            break;

          case 'search_term_sync':
            // 检查 reportName 区分搜索词和自动定向
            if (payload.reportName && (payload.reportName.includes('自动定向') || payload.reportName.includes('auto'))) {
              recordsProcessed = await this.processTargetingData(
                job.accountId, 'SP', reportData
              );
            } else {
              recordsProcessed = await this.processSearchTermData(
                job.accountId, adType, reportData
              );
            }
            break;

          case 'targeting_sync':
          case 'sd_sync':
          case 'sb_sync':
            // 检查 reportName 区分定向、搜索词、广告位
            if (payload.reportName && (payload.reportName.includes('搜索词') || payload.reportName.includes('search'))) {
              recordsProcessed = await this.processSearchTermData(
                job.accountId, adType, reportData
              );
            } else if (payload.reportName && (payload.reportName.includes('广告位') || payload.reportName.includes('placement'))) {
              recordsProcessed = await this.processPlacementData(
                job.accountId, adType, reportData
              );
            } else {
              recordsProcessed = await this.processTargetingData(
                job.accountId, adType, reportData
              );
            }
            break;

          case 'placement_sync':
            recordsProcessed = await this.processPlacementData(
              job.accountId, adType, reportData
            );
            break;

          default:
            // 默认按 campaign 绩效处理（向后兼容）
            log.info(`[v649:AsyncReport] Unknown syncType '${syncType}', falling back to campaign performance`);
            recordsProcessed = await this.processCampaignPerformanceData(
              job.accountId, adType, reportData
            );
            break;
        }

        // 更新任务状态
        await db
          .update(reportJobs)
          .set({
            processedAt: new Date().toISOString(),
            recordsProcessed,
          })
          .where(eq(reportJobs.id, job.id));

        processedCount++;
        log.info(`[v649:AsyncReport] Job ${job.id} processed: ${recordsProcessed} records (syncType=${syncType})`);
      } catch (error: unknown) {
        log.warn(`[v649:AsyncReport] Error processing job ${job.id}:`, (error as Error).message);

        await db
          .update(reportJobs)
          .set({
            errorMessage: `v649: ${(error as Error).message}`,
          })
          .where(eq(reportJobs.id, job.id));
      }
    }

    return processedCount;
  }

  /**
   * v649: 处理 Campaign 绩效报告数据（批量预加载，消除 N+1）
   */
  private async processCampaignPerformanceData(
    accountId: number,
    adType: 'SP' | 'SB' | 'SD',
    data: unknown[]
  ): Promise<number> {
    const db = await getDb();
    if (!db) throw new Error('Database not available');

    // v649: 批量预加载 campaigns，消除 N+1 查询
    const allCampaigns = await db
      .select({ id: campaigns.id, campaignId: campaigns.campaignId, campaignName: campaigns.campaignName })
      .from(campaigns)
      .where(eq(campaigns.accountId, accountId));

    const campaignByIdMap = new Map<string, { id: number; campaignId: string }>();
    for (const c of allCampaigns) {
      campaignByIdMap.set(String(c.campaignId), { id: c.id, campaignId: c.campaignId });
    }

    log.info(`[v649:AsyncReport] Preloaded ${allCampaigns.length} campaigns for account ${accountId}`);

    let processedCount = 0;
    const BATCH_SIZE = 500;

    for (let i = 0; i < data.length; i += BATCH_SIZE) {
      const batch = data.slice(i, i + BATCH_SIZE);

      for (const row of batch as Record<string, unknown>[]) {
        try {
          const campaignId = row.campaignId as string;
          const date = row.date as string;
          if (!campaignId) continue;

          const campaign = campaignByIdMap.get(String(campaignId));

          // 提取字段（根据广告类型使用不同字段名）
          const impressions = parseInt(String(row.impressions || 0)) || 0;
          const clicks = parseInt(String(row.clicks || 0)) || 0;
          const spend = parseFloat(String(row.cost || row.spend || 0)) || 0;

          let sales = 0;
          let orders = 0;
          if (adType === 'SP') {
            sales = parseFloat(String(row.sales7d || row.sales14d || row.sales || 0)) || 0;
            orders = parseInt(String(row.purchases7d || row.purchases14d || row.purchases || 0)) || 0;
          } else {
            sales = parseFloat(String(row.salesClicks || row.sales || 0)) || 0;
            orders = parseInt(String(row.purchasesClicks || row.purchases || 0)) || 0;
          }

          // Upsert 到 ams_performance_data 表
          if (date) {
            const existingRecord = await db
              .select({ id: amsPerformanceData.id })
              .from(amsPerformanceData)
              .where(
                and(
                  eq(amsPerformanceData.accountId, accountId),
                  eq(amsPerformanceData.campaignId, String(campaignId)),
                  eq(amsPerformanceData.reportDate, date)
                )
              )
              .limit(1);

            if (existingRecord.length > 0) {
              await db
                .update(amsPerformanceData)
                .set({
                  impressions,
                  clicks,
                  spend: spend.toString(),
                  sales: sales.toString(),
                  orders,
                  dataSource: 'api',
                })
                .where(eq(amsPerformanceData.id, existingRecord[0].id));
            } else {
              await db.insert(amsPerformanceData).values({
                accountId,
                campaignId: String(campaignId),
                reportDate: date,
                dataSetId: `api-${adType.toLowerCase()}`,
                impressions,
                clicks,
                spend: spend.toString(),
                sales: sales.toString(),
                orders,
                dataSource: 'api',
              });
            }
          }

          // 同时更新 campaigns 表汇总数据
          if (campaign) {
            await db
              .update(campaigns)
              .set({
                impressions: sql`COALESCE(${campaigns.impressions}, 0) + ${impressions}`,
                clicks: sql`COALESCE(${campaigns.clicks}, 0) + ${clicks}`,
                spend: sql`COALESCE(${campaigns.spend}, 0) + ${spend}`,
                sales: sql`COALESCE(${campaigns.sales}, 0) + ${sales}`,
                orders: sql`COALESCE(${campaigns.orders}, 0) + ${orders}`,
              })
              .where(eq(campaigns.id, campaign.id));
          }

          processedCount++;
        } catch (error: unknown) {
          log.warn(`[v649:AsyncReport] Error processing campaign row:`, (error as Error).message);
        }
      }

      if (data.length > BATCH_SIZE) {
        log.info(`[v649:AsyncReport] Campaign performance batch progress: ${Math.min(i + BATCH_SIZE, data.length)}/${data.length}`);
      }
    }

    return processedCount;
  }

  /**
   * v649: 处理关键词绩效报告数据
   */
  private async processKeywordPerformanceData(
    accountId: number,
    adType: 'SP' | 'SB' | 'SD',
    data: unknown[]
  ): Promise<number> {
    const db = await getDb();
    if (!db) throw new Error('Database not available');

    // 批量预加载 keywords
    const allKeywords = await db
      .select({ id: keywords.id, amazonKeywordId: keywords.amazonKeywordId })
      .from(keywords)
      .where(eq(keywords.accountId, accountId));

    const keywordMap = new Map<string, number>();
    for (const kw of allKeywords) {
      if (kw.amazonKeywordId) {
        keywordMap.set(String(kw.amazonKeywordId), kw.id);
      }
    }

    log.info(`[v649:AsyncReport] Preloaded ${allKeywords.length} keywords for account ${accountId}`);

    let processedCount = 0;

    for (const row of data as Record<string, unknown>[]) {
      try {
        const keywordId = row.keywordId || row.targetId;
        if (!keywordId) continue;

        const impressions = parseInt(String(row.impressions || 0)) || 0;
        const clicks = parseInt(String(row.clicks || 0)) || 0;
        const spend = parseFloat(String(row.spend || row.cost || 0)) || 0;

        let sales = 0;
        let orders = 0;
        if (adType === 'SP') {
          sales = parseFloat(String(row.sales7d || row.sales14d || row.sales || 0)) || 0;
          orders = parseInt(String(row.purchases7d || row.purchases14d || row.purchases || 0)) || 0;
        } else {
          sales = parseFloat(String(row.salesClicks || row.sales || 0)) || 0;
          orders = parseInt(String(row.purchasesClicks || row.purchases || 0)) || 0;
        }

        // 更新 keywords 表
        const localKeywordId = keywordMap.get(String(keywordId));
        if (localKeywordId) {
          await db
            .update(keywords)
            .set({
              impressions,
              clicks,
              spend: String(spend),
              sales: String(sales),
              orders,
            })
            .where(eq(keywords.id, localKeywordId));
          processedCount++;
        }
      } catch (error: unknown) {
        log.warn(`[v649:AsyncReport] Error processing keyword row:`, (error as Error).message);
      }
    }

    return processedCount;
  }

  /**
   * v649: 处理搜索词报告数据
   */
  private async processSearchTermData(
    accountId: number,
    adType: 'SP' | 'SB' | 'SD',
    data: unknown[]
  ): Promise<number> {
    const db = await getDb();
    if (!db) throw new Error('Database not available');

    // 批量预加载关联数据
    const allCampaigns = await db
      .select({ id: campaigns.id, campaignId: campaigns.campaignId })
      .from(campaigns)
      .where(eq(campaigns.accountId, accountId));
    const campaignMap = new Map<string, { id: number; campaignId: string }>();
    for (const c of allCampaigns) {
      campaignMap.set(String(c.campaignId), c);
    }

    const allAdGroups = await db
      .select({ id: adGroups.id, adGroupId: adGroups.adGroupId })
      .from(adGroups)
      .where(eq(adGroups.accountId, accountId));
    const adGroupMap = new Map<string, { id: number }>();
    for (const ag of allAdGroups) {
      adGroupMap.set(ag.adGroupId, { id: ag.id });
    }

    // 预加载已有搜索词
    const allSearchTerms = await db
      .select({ id: searchTerms.id, campaignId: searchTerms.campaignId, adGroupId: searchTerms.internalAdGroupId, searchTerm: searchTerms.searchTerm })
      .from(searchTerms)
      .where(eq(searchTerms.accountId, accountId));
    const existingMap = new Map<string, number>();
    for (const st of allSearchTerms) {
      const key = `${st.campaignId}:${st.adGroupId}:${(st.searchTerm || '').toLowerCase()}`;
      existingMap.set(key, st.id);
    }

    log.info(`[v649:AsyncReport] Preloaded: campaigns=${allCampaigns.length}, adGroups=${allAdGroups.length}, searchTerms=${allSearchTerms.length}`);

    let processedCount = 0;
    let skipped = 0;

    for (const row of data as Record<string, unknown>[]) {
      try {
        const searchTermText = row.searchTerm || row.query;
        if (!searchTermText) continue;

        const campaign = campaignMap.get(String(row.campaignId));
        if (!campaign) { skipped++; continue; }

        const adGroup = adGroupMap.get(String(row.adGroupId));
        if (!adGroup) { skipped++; continue; }

        const impressions = parseInt(String(row.impressions || 0)) || 0;
        const clicks = parseInt(String(row.clicks || 0)) || 0;
        const spend = parseFloat(String(row.cost || row.spend || 0)) || 0;

        let sales = 0;
        let orders = 0;
        if (adType === 'SP') {
          sales = parseFloat(String(row.sales7d || row.sales || 0)) || 0;
          orders = parseInt(String(row.purchases7d || row.purchases || 0)) || 0;
        } else {
          sales = parseFloat(String(row.salesClicks || row.sales || 0)) || 0;
          orders = parseInt(String(row.purchasesClicks || row.purchases || 0)) || 0;
        }

        // v650: 修复 #1 campaignId 使用 Amazon Campaign ID (varchar)，与 searchTermSync.ts 一致
        const existKey = `${campaign.campaignId}:${adGroup.id}:${String(searchTermText).toLowerCase()}`;
        const existingId = existingMap.get(existKey);

        // v650: 修复 #2 判断 searchTermTargetType（必填 NOT NULL 字段）
        const isProductTarget = !!(row.targetId && !row.keywordId);
        const searchTermTargetType: 'keyword' | 'product_target' = isProductTarget ? 'product_target' : 'keyword';

        // v650: 计算派生指标（与 searchTermSync.ts 一致）
        const searchTermAcos = sales > 0 ? String((spend / sales) * 100) : null;
        const searchTermRoas = spend > 0 ? String(sales / spend) : null;
        const searchTermCtr = impressions > 0 ? String(clicks / impressions) : null;
        const searchTermCvr = clicks > 0 ? String(orders / clicks) : null;
        const searchTermCpc = clicks > 0 ? String(spend / clicks) : null;

        if (existingId) {
          // v650: 修复 #3 字段名使用 searchTermImpressions 等（与 schema 一致）
          await db
            .update(searchTerms)
            .set({
              searchTermImpressions: impressions,
              searchTermClicks: clicks,
              searchTermSpend: String(spend),
              searchTermSales: String(sales),
              searchTermOrders: orders,
              searchTermAcos,
              searchTermRoas,
              searchTermCtr,
              searchTermCvr,
              searchTermCpc,
            })
            .where(eq(searchTerms.id, existingId));
        } else {
          // 插入新搜索词
          try {
            // v650: 修复 #4 移除不存在的 adType 字段，补充 searchTermTargetType
            await db.insert(searchTerms).values({
              accountId,
              campaignId: campaign.campaignId, // v650: Amazon Campaign ID (varchar)
              internalAdGroupId: adGroup.id,
              searchTerm: String(searchTermText),
              searchTermTargetType,
              searchTermImpressions: impressions,
              searchTermClicks: clicks,
              searchTermSpend: String(spend),
              searchTermSales: String(sales),
              searchTermOrders: orders,
              searchTermAcos,
              searchTermRoas,
              searchTermCtr,
              searchTermCvr,
              searchTermCpc,
            });
          } catch (insertErr: unknown) {
            // 可能是重复插入，忽略
            if (!(insertErr as Error).message?.includes('Duplicate')) {
              log.warn(`[v650:AsyncReport] Insert search term failed:`, (insertErr as Error).message);
            }
          }
        }

        processedCount++;
      } catch (error: unknown) {
        log.warn(`[v649:AsyncReport] Error processing search term row:`, (error as Error).message);
      }
    }

    if (skipped > 0) {
      log.info(`[v649:AsyncReport] Search term processing: ${processedCount} processed, ${skipped} skipped (no matching campaign/adGroup)`);
    }

    return processedCount;
  }

  /**
   * v649: 处理定向报告数据（SP自动定向、SD定向、SB定向）
   */
  private async processTargetingData(
    accountId: number,
    adType: 'SP' | 'SB' | 'SD',
    data: unknown[]
  ): Promise<number> {
    const db = await getDb();
    if (!db) throw new Error('Database not available');

    // 批量预加载
    const allAdGroups = await db
      .select({ id: adGroups.id, adGroupId: adGroups.adGroupId, campaignId: adGroups.campaignId })
      .from(adGroups)
      .where(eq(adGroups.accountId, accountId));
    const adGroupMap = new Map<string, { id: number; campaignId: number | null }>();
    for (const ag of allAdGroups) {
      adGroupMap.set(ag.adGroupId, { id: ag.id, campaignId: ag.campaignId });
    }

    const allTargets = await db
      .select({ id: productTargets.id, targetId: productTargets.targetId })
      .from(productTargets)
      .where(eq(productTargets.accountId, accountId));
    const targetMap = new Map<string, number>();
    for (const t of allTargets) {
      if (t.targetId) {
        targetMap.set(String(t.targetId), t.id);
      }
    }

    log.info(`[v649:AsyncReport] Preloaded: adGroups=${allAdGroups.length}, targets=${allTargets.length}`);

    let processedCount = 0;

    for (const row of data as Record<string, unknown>[]) {
      try {
        const targetId = row.targetId || row.keywordId;
        if (!targetId) continue;

        const impressions = parseInt(String(row.impressions || 0)) || 0;
        const clicks = parseInt(String(row.clicks || 0)) || 0;
        const spend = parseFloat(String(row.cost || row.spend || 0)) || 0;

        let sales = 0;
        let orders = 0;
        if (adType === 'SP') {
          sales = parseFloat(String(row.sales7d || row.sales || 0)) || 0;
          orders = parseInt(String(row.purchases7d || row.purchases || 0)) || 0;
        } else {
          sales = parseFloat(String(row.salesClicks || row.sales || 0)) || 0;
          orders = parseInt(String(row.purchasesClicks || row.purchases || 0)) || 0;
        }

        // 更新 product_targets 表
        const localTargetId = targetMap.get(String(targetId));
        if (localTargetId) {
          await db
            .update(productTargets)
            .set({
              impressions,
              clicks,
              spend: String(spend),
              sales: String(sales),
              orders,
            })
            .where(eq(productTargets.id, localTargetId));
          processedCount++;
        }
      } catch (error: unknown) {
        log.warn(`[v649:AsyncReport] Error processing targeting row:`, (error as Error).message);
      }
    }

    return processedCount;
  }

  /**
   * v649: 处理广告位报告数据（SP/SB placement）
   */
  private async processPlacementData(
    accountId: number,
    adType: 'SP' | 'SB' | 'SD',
    data: unknown[]
  ): Promise<number> {
    const db = await getDb();
    if (!db) throw new Error('Database not available');

    // 批量预加载 campaigns: amazonCampaignId -> campaignId(varchar)
    const allCampaigns = await db
      .select({ id: campaigns.id, campaignId: campaigns.campaignId })
      .from(campaigns)
      .where(eq(campaigns.accountId, accountId));
    const campaignMap = new Map<string, string>();
    for (const c of allCampaigns) {
      campaignMap.set(String(c.campaignId), String(c.campaignId));
    }

    log.info(`[v649:AsyncReport] Preloaded ${allCampaigns.length} campaigns for placement processing`);

    // v649: placement值映射（与syncPerformance.ts一致）
    const placementMap: Record<string, 'top_of_search' | 'product_page' | 'rest_of_search'> = {
      'TOP_OF_SEARCH': 'top_of_search',
      'DETAIL_PAGE': 'product_page',
      'OTHER': 'rest_of_search',
      'Top of Search on-Amazon': 'top_of_search',
      'Detail Page on-Amazon': 'product_page',
      'Other on-Amazon': 'rest_of_search',
      'TOP_OF_SEARCH_ON_AMAZON': 'top_of_search',
      'DETAIL_PAGE_ON_AMAZON': 'product_page',
      'OTHER_ON_AMAZON': 'rest_of_search',
      'top_of_search': 'top_of_search',
      'product_page': 'product_page',
      'rest_of_search': 'rest_of_search',
      'detail_page': 'product_page',
      'other': 'rest_of_search',
      'Top of search': 'top_of_search',
      'Product page': 'product_page',
      'Rest of search': 'rest_of_search',
      'Remarketing off-Amazon': 'rest_of_search',
      'REMARKETING_OFF_AMAZON': 'rest_of_search',
    };

    let processedCount = 0;

    for (const row of data as Record<string, unknown>[]) {
      try {
        const rawCampaignId = String(row.campaignId || '');
        const rawPlacement = String(row.placementClassification || row.campaignPlacement || row.placement || 'OTHER');
        const reportDate = String(row.date || new Date().toISOString().split('T')[0]);
        if (!rawCampaignId || !rawPlacement) continue;

        // 确认campaign存在
        const amazonCampaignId = campaignMap.get(rawCampaignId);
        if (!amazonCampaignId) continue;

        // 映射placement值到枚举
        const placement = placementMap[rawPlacement] || 'rest_of_search';

        const impressions = parseInt(String(row.impressions || 0)) || 0;
        const clicks = parseInt(String(row.clicks || 0)) || 0;
        const cost = parseFloat(String(row.cost || row.spend || 0)) || 0;

        let sales = 0;
        let orders = 0;
        if (adType === 'SP') {
          sales = parseFloat(String(row.sales7d || row.sales || 0)) || 0;
          orders = parseInt(String(row.purchases7d || row.purchases || 0)) || 0;
        } else {
          sales = parseFloat(String(row.salesClicks || row.sales || 0)) || 0;
          orders = parseInt(String(row.purchasesClicks || row.purchases || 0)) || 0;
        }

        const perfData = {
          campaignId: amazonCampaignId, // varchar(50): Amazon的campaignId
          accountId,
          placement,
          date: reportDate,
          impressions,
          clicks,
          spend: String(cost),
          sales: String(sales),
          orders,
          ctr: impressions > 0 ? String(clicks / impressions) : null,
          cpc: clicks > 0 ? String(cost / clicks) : null,
          cvr: clicks > 0 ? String(orders / clicks) : null,
          acos: sales > 0 ? String((cost / sales) * 100) : null,
          roas: cost > 0 ? String(sales / cost) : null,
          updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
        };

        // v649: 使用UPSERT策略（与syncPerformance.ts一致）
        try {
          await db.insert(placementPerformance).values({
            ...perfData,
            createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
          }).onDuplicateKeyUpdate({
            set: {
              impressions: perfData.impressions,
              clicks: perfData.clicks,
              spend: perfData.spend,
              sales: perfData.sales,
              orders: perfData.orders,
              ctr: perfData.ctr,
              cpc: perfData.cpc,
              cvr: perfData.cvr,
              acos: perfData.acos,
              roas: perfData.roas,
              updatedAt: perfData.updatedAt,
            }
          });
          processedCount++;
        } catch (insertErr: unknown) {
          if (!(insertErr as Error).message?.includes('Duplicate')) {
            log.warn(`[v649:AsyncReport] Placement upsert failed:`, (insertErr as Error).message);
          }
        }
      } catch (error: unknown) {
        log.warn(`[v649:AsyncReport] Error processing placement row:`, (error as Error).message);
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
      // @ts-ignore
      .where(
        and(
          inArray(reportJobs.status, ['completed', 'failed', 'expired']),
          sql`${reportJobs.createdAt} < ${cutoffDate.toISOString()}`
        )
      );

    // @ts-ignore
    return (result as Record<string, unknown>).rowsAffected || 0;
  }
}

// 导出单例
export const asyncReportService = new AsyncReportService();
