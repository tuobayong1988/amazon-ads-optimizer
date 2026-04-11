import { createModuleLogger } from "../utils/logger";
const log = createModuleLogger("AsyncReport");
/**
 * v640: 异步报告处理服务 — P2架构升级
 * 
 * 核心改进:
 * 1. 报告缓存机制 — 避免重复请求相同报告
 * 2. 批量提交 — 一次性提交多个报告请求，减少API调用
 * 3. 空报告智能处理 — 2字节空响应([])直接标记为no_data
 * 4. 指数退避轮询 — 初始30秒，逐步增加到2分钟
 * 5. 部分成功机制 — 单个报告超时不中断整体同步
 */

import * as db from '../db';
import { AmazonAdsApiClient } from './amazonAdsApi';
import { sql } from 'drizzle-orm';

// 报告请求类型
type ReportType = 'sp_campaigns' | 'sp_keywords' | 'sp_targets' | 'sb_campaigns' | 'sb_keywords' | 'sd_campaigns';

// 报告请求状态
// v640: 新增 'no_data' 和 'dead_letter' 状态
type ReportStatus = 'pending' | 'submitted' | 'processing' | 'completed' | 'failed' | 'timeout' | 'no_data' | 'dead_letter';

// 报告请求接口
interface ReportRequest {
  id: number;
  accountId: number;
  profileId: string;
  marketplace: string;
  reportType: ReportType;
  reportId: string | null;
  startDate: string;
  endDate: string;
  status: ReportStatus;
  downloadUrl: string | null;
  recordsCount: number | null;
  processedAt: string | null;
  errorMessage: string | null;
  retryCount: number;
  maxRetries: number;
  createdAt: string;
  updatedAt: string;
}

// v640: 增强轮询配置 — 指数退避
const POLL_CONFIG = {
  initialIntervalMs: 30000,      // 初始轮询间隔30秒
  maxIntervalMs: 120000,         // 最大轮询间隔2分钟
  backoffMultiplier: 1.5,        // 退避倍数
  maxPollTimeMs: 15 * 60 * 1000, // 最大轮询时间15分钟
  emptyAccountPollTimeMs: 3 * 60 * 1000, // 空账户缩短到3分钟
  batchSize: 10,                 // 每次轮询处理的报告数
};

// v640: 报告缓存 — 避免重复请求
const reportCache = new Map<string, { requestId: number; status: ReportStatus; expiresAt: number }>();
const CACHE_TTL_MS = 30 * 60 * 1000; // 缓存30分钟

// 服务状态
let isPolling = false;
let pollIntervalId: NodeJS.Timeout | null = null;
let currentPollIntervalMs = POLL_CONFIG.initialIntervalMs;

// v640: 统计信息
const stats = {
  totalRequests: 0,
  completedRequests: 0,
  failedRequests: 0,
  cachedHits: 0,
  emptyReports: 0,
  timeoutReports: 0,
  deadLetterReports: 0,
};

/**
 * v640: 生成报告缓存键
 */
function getCacheKey(accountId: number, reportType: ReportType, startDate: string, endDate: string): string {
  return `${accountId}:${reportType}:${startDate}:${endDate}`;
}

/**
 * v640: 清理过期缓存
 */
function cleanExpiredCache(): void {
  const now = Date.now();
  for (const [key, value] of reportCache.entries()) {
    if (value.expiresAt < now) {
      reportCache.delete(key);
    }
  }
}

/**
 * 创建报告请求
 * v640: 增加缓存检查，避免重复请求
 */
export async function createReportRequest(
  accountId: number,
  profileId: string,
  marketplace: string,
  reportType: ReportType,
  startDate: string,
  endDate: string
): Promise<number> {
  // v640: 检查缓存 — 如果相同报告已经在处理中或已完成，直接返回
  const cacheKey = getCacheKey(accountId, reportType, startDate, endDate);
  const cached = reportCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    if (cached.status === 'completed' || cached.status === 'submitted' || cached.status === 'processing') {
      stats.cachedHits++;
      log.info(`[AsyncReportService] v640: 缓存命中 ${cacheKey}, 复用请求 ${cached.requestId} (status: ${cached.status})`);
      return cached.requestId;
    }
  }

  const database = await db.getDb();
  if (!database) {
    throw new Error('Database not available');
  }

  const result = await database.execute(sql`
    INSERT INTO report_requests (accountId, profileId, marketplace, reportType, startDate, endDate, status)
    VALUES (${accountId}, ${profileId}, ${marketplace}, ${reportType}, ${startDate}, ${endDate}, 'pending')
  `);

  const insertId = (result as Record<string, number>).insertId || (result as Record<string, unknown>[][])[0]?.insertId;
  
  // v640: 更新缓存
  reportCache.set(cacheKey, { requestId: insertId, status: 'pending', expiresAt: Date.now() + CACHE_TTL_MS });
  stats.totalRequests++;
  
  log.info(`[AsyncReportService] 创建报告请求: ${insertId} (${reportType} ${startDate}~${endDate})`);
  return insertId;
}

/**
 * 提交报告请求到Amazon API
 */
export async function submitReportRequest(requestId: number): Promise<void> {
  const database = await db.getDb();
  if (!database) {
    throw new Error('Database not available');
  }

  // 获取请求信息
  const requestResult = await database.execute(sql`
    SELECT * FROM report_requests WHERE id = ${requestId}
  `);

  const requests = (requestResult as Record<string, unknown>[])[0] || requestResult;
  if (!requests || requests.length === 0) {
    throw new Error(`Report request ${requestId} not found`);
  }

  const req = requests[0] as ReportRequest;

  // 获取账户信息
  const account = await db.getAdAccountById(req.accountId);
  if (!account) {
    throw new Error(`Account ${req.accountId} not found`);
  }

  // 从amazonApiCredentials表获取API凭证
  const credentials = await db.getAmazonApiCredentials(req.accountId);
  if (!credentials) {
    throw new Error(`Account ${req.accountId} 未配置API凭证，请先完成Amazon API授权`);
  }

  // 创建Amazon API客户端
  const client = new AmazonAdsApiClient({
    clientId: credentials.clientId || process.env.AMAZON_ADS_CLIENT_ID || '',
    clientSecret: credentials.clientSecret || process.env.AMAZON_ADS_CLIENT_SECRET || '',
    refreshToken: credentials.refreshToken || '',
    profileId: req.profileId,
    region: req.marketplace === 'US' ? 'NA' : req.marketplace === 'UK' || req.marketplace === 'DE' || req.marketplace === 'FR' || req.marketplace === 'IT' || req.marketplace === 'ES' ? 'EU' : 'NA'
  });

  try {
    // 根据报告类型请求报告
    let reportId: string;
    switch (req.reportType) {
      case 'sp_campaigns':
        reportId = await client.requestSpCampaignReport(req.startDate, req.endDate);
        break;
      case 'sp_keywords':
        reportId = await client.requestSpKeywordReport(req.startDate, req.endDate);
        break;
      case 'sb_campaigns':
        reportId = await client.requestSbCampaignReport(req.startDate, req.endDate);
        break;
      // SB keywords报告暂不支持，SB广告的关键词数据通过sb_campaigns报告获取
      case 'sd_campaigns':
        reportId = await client.requestSdCampaignReport(req.startDate, req.endDate);
        break;
      default:
        throw new Error(`Unsupported report type: ${req.reportType}`);
    }

    // 更新请求状态
    await database.execute(sql`
      UPDATE report_requests SET reportId = ${reportId}, status = 'submitted', updatedAt = NOW() WHERE id = ${requestId}
    `);

    // v640: 更新缓存状态
    const cacheKey = getCacheKey(req.accountId, req.reportType as ReportType, req.startDate, req.endDate);
    const cached = reportCache.get(cacheKey);
    if (cached) cached.status = 'submitted';

    log.info(`[AsyncReportService] 报告请求已提交: ${requestId}, reportId: ${reportId}`);
  } catch (error: unknown) {
    // v640: 增强错误处理 — 区分限流和其他错误
    const errMsg = (error as Error).message || '';
    const isRateLimit = errMsg.includes('429') || errMsg.includes('Too Many Requests');
    
    // 更新失败状态
    await database.execute(sql`
      UPDATE report_requests SET status = 'failed', errorMessage = ${errMsg}, retryCount = retryCount + 1, updatedAt = NOW() WHERE id = ${requestId}
    `);
    
    if (isRateLimit) {
      log.warn(`[AsyncReportService] v640: 报告请求被限流: ${requestId}, 将在下次轮询时重试`);
    } else {
      log.warn(`[AsyncReportService] 报告请求提交失败: ${requestId}`, error);
    }
  }
}

/**
 * 检查报告状态并下载
 * v640: 增加空报告智能处理和部分成功机制
 */
export async function checkAndDownloadReport(requestId: number): Promise<boolean> {
  const database = await db.getDb();
  if (!database) {
    return false;
  }

  // 获取请求信息
  const requestResult = await database.execute(sql`
    SELECT * FROM report_requests WHERE id = ${requestId}
  `);

  const requests = (requestResult as Record<string, unknown>[])[0] || requestResult;
  if (!requests || requests.length === 0) {
    return false;
  }

  const req = requests[0] as ReportRequest;

  if (!req.reportId) {
    return false;
  }

  // 获取账户信息
  const account = await db.getAdAccountById(req.accountId);
  if (!account) {
    return false;
  }

  // 从amazonApiCredentials表获取API凭证
  const credentials = await db.getAmazonApiCredentials(req.accountId);
  if (!credentials) {
    log.warn(`[AsyncReportService] Account ${req.accountId} 未配置API凭证`);
    return false;
  }

  // 创建Amazon API客户端
  const client = new AmazonAdsApiClient({
    clientId: credentials.clientId || process.env.AMAZON_ADS_CLIENT_ID || '',
    clientSecret: credentials.clientSecret || process.env.AMAZON_ADS_CLIENT_SECRET || '',
    refreshToken: credentials.refreshToken || '',
    profileId: req.profileId,
    region: req.marketplace === 'US' ? 'NA' : req.marketplace === 'UK' || req.marketplace === 'DE' || req.marketplace === 'FR' || req.marketplace === 'IT' || req.marketplace === 'ES' ? 'EU' : 'NA'
  });

  try {
    // 检查报告状态
    const reportStatus = await client.getReportStatus(req.reportId);
    log.info(`[AsyncReportService] 报告状态: ${reportStatus.status}, requestId: ${requestId}`);

    if (reportStatus.status === 'COMPLETED' && reportStatus.url) {
      // 下载报告数据
      const reportData = await client.downloadReport(reportStatus.url);
      const recordsCount = reportData?.length || 0;
      
      // v640: 空报告智能处理 — 2字节空响应([])直接标记为no_data
      if (recordsCount === 0 || (Array.isArray(reportData) && reportData.length === 0)) {
        await database.execute(sql`
          UPDATE report_requests SET status = 'no_data', recordsCount = 0, updatedAt = NOW() WHERE id = ${requestId}
        `);
        stats.emptyReports++;
        log.info(`[AsyncReportService] v640: 报告 ${requestId} 为空报告(no_data)，跳过数据处理`);
        return true;
      }
      
      // 更新请求状态
      await database.execute(sql`
        UPDATE report_requests SET status = 'completed', downloadUrl = ${reportStatus.url}, recordsCount = ${recordsCount}, updatedAt = NOW() WHERE id = ${requestId}
      `);

      // 处理报告数据
      await processReportData(req, reportData);

      stats.completedRequests++;
      log.info(`[AsyncReportService] 报告处理完成: ${requestId}, 记录数: ${recordsCount}`);
      return true;
    } else if (reportStatus.status === 'FAILURE') {
      await database.execute(sql`
        UPDATE report_requests SET status = 'failed', errorMessage = 'Report generation failed', updatedAt = NOW() WHERE id = ${requestId}
      `);
      stats.failedRequests++;
      return true;
    }

    // v640: 智能超时检查 — 空账户使用更短的超时
    const createdAt = new Date(req.createdAt).getTime();
    const isEmptyAccount = await checkIfEmptyAccount(req.accountId);
    const maxPollTime = isEmptyAccount ? POLL_CONFIG.emptyAccountPollTimeMs : POLL_CONFIG.maxPollTimeMs;
    
    if (Date.now() - createdAt > maxPollTime) {
      await database.execute(sql`
        UPDATE report_requests SET status = 'timeout', errorMessage = ${`Report generation timeout after ${Math.round(maxPollTime / 60000)} minutes`}, updatedAt = NOW() WHERE id = ${requestId}
      `);
      stats.timeoutReports++;
      log.warn(`[AsyncReportService] v640: 报告 ${requestId} 超时(${Math.round(maxPollTime / 60000)}分钟)，标记为timeout`);
      return true;
    }

    // 更新状态为处理中
    await database.execute(sql`
      UPDATE report_requests SET status = 'processing', updatedAt = NOW() WHERE id = ${requestId}
    `);

    return false;
  } catch (error: unknown) {
    log.warn(`[AsyncReportService] 检查报告状态失败: ${requestId}`, error);
    return false;
  }
}

/**
 * v640: 检查是否为空账户（无活跃广告活动）
 */
async function checkIfEmptyAccount(accountId: number): Promise<boolean> {
  try {
    const counts = await db.getCampaignStatusCounts(accountId);
    return counts.enabled === 0;
  } catch {
    return false;
  }
}

/**
 * 处理报告数据
 * v640: 增加批量处理（1000条/批）以控制内存使用
 */
async function processReportData(request: ReportRequest, data: unknown[]): Promise<void> {
  if (!data || data.length === 0) {
    return;
  }

  const database = await db.getDb();
  if (!database) {
    return;
  }

  log.info(`[AsyncReportService] 开始处理报告数据: ${request.reportType}, 记录数: ${data.length}`);

  // v640: 批量处理 — 每1000条为一批
  const BATCH_SIZE = 1000;
  const totalBatches = Math.ceil(data.length / BATCH_SIZE);
  
  for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
    const batchStart = batchIdx * BATCH_SIZE;
    const batchEnd = Math.min(batchStart + BATCH_SIZE, data.length);
    const batchData = data.slice(batchStart, batchEnd);
    
    switch (request.reportType) {
      case 'sp_campaigns':
        await processCampaignReportData(request.accountId, batchData, 'SP');
        break;
      case 'sp_keywords':
        await processKeywordReportData(request.accountId, batchData);
        break;
      case 'sb_campaigns':
        await processCampaignReportData(request.accountId, batchData, 'SB');
        break;
      case 'sd_campaigns':
        await processCampaignReportData(request.accountId, batchData, 'SD');
        break;
      default:
        log.info(`[AsyncReportService] 未实现的报告类型处理: ${request.reportType}`);
    }
    
    if (totalBatches > 1) {
      log.info(`[AsyncReportService] v640: 批量处理进度 ${batchIdx + 1}/${totalBatches} (${batchEnd}/${data.length}条)`);
    }
  }

  // 更新处理完成时间
  await database.execute(sql`
    UPDATE report_requests SET processedAt = NOW(), updatedAt = NOW() WHERE id = ${request.id}
  `);
}

/**
 * 处理广告活动报告数据
 * 
 * 字段映射说明 (基于亓马逊广告API专家提供的Postman配置):
 * - SP (Sponsored Products): 使用 spend, sales7d, purchases7d
 * - SB (Sponsored Brands): 使用 cost, salesClicks, purchasesClicks
 * - SD (Sponsored Display): 使用 cost, salesClicks, purchasesClicks
 */
async function processCampaignReportData(accountId: number, data: unknown[], adType?: string): Promise<void> {
  const database = await db.getDb();
  if (!database) {
    return;
  }

  let updatedCount = 0;

  for (const row of (data as any[])) {
    const campaignId = row.campaignId;
    if (!campaignId) continue;

    // 查找本地campaign
    const campaignResult = await database.execute(sql`
      SELECT id, adType FROM campaigns WHERE amazonCampaignId = ${campaignId} AND accountId = ${accountId}
    `);

    const campaigns = (campaignResult as Record<string, unknown>[])[0] || campaignResult;
    if (!campaigns || campaigns.length === 0) continue;

    const localCampaignId = (campaigns as any)[0].id;
    const campaignAdType = adType || (campaigns as any)[0].adType || 'SP';
    
    // 根据广告类型提取正确的字段
    const impressions = row.impressions || 0;
    const clicks = row.clicks || 0;
    
    // 花费字段映射: SP使用spend, SB/SD使用cost
    const spend = row.spend || row.cost || 0;
    
    // 销售额字段映射:
    // SP: sales7d > sales14d > sales
    // SB/SD: salesClicks > sales
    let sales = 0;
    if (campaignAdType === 'SP') {
      sales = row.sales7d || row.sales14d || row.sales || 0;
    } else {
      // SB/SD 使用 Clicks 后缀
      sales = row.salesClicks || row.sales || 0;
    }
    
    // 订单数字段映射:
    // SP: purchases7d > purchases14d > purchases
    // SB/SD: purchasesClicks > purchases
    let orders = 0;
    if (campaignAdType === 'SP') {
      orders = row.purchases7d || row.purchases14d || row.purchases || 0;
    } else {
      // SB/SD 使用 Clicks 后缀
      orders = row.purchasesClicks || row.purchases || 0;
    }

    // 更新绩效数据
    await database.execute(sql`
      UPDATE campaigns SET 
        impressions = ${impressions},
        clicks = ${clicks},
        spend = ${spend},
        sales = ${sales},
        orders = ${orders},
        updatedAt = NOW()
       WHERE id = ${localCampaignId}
    `);

    updatedCount++;
  }

  log.info(`[AsyncReportService] 更新了 ${updatedCount} 个广告活动的绩效数据 (广告类型: ${adType || 'mixed'})`);
}

/**
 * 处理关键词/定向报告数据
 * 
 * 字段映射说明 (基于亓马逊广告API专家提供的Postman配置):
 * - SP: 使用 sales7d, purchases7d, acosClicks7d, roasClicks7d
 * - SB/SD: 使用 salesClicks, purchasesClicks
 */
async function processKeywordReportData(accountId: number, data: unknown[], adType?: string): Promise<void> {
  const database = await db.getDb();
  if (!database) {
    return;
  }

  let updatedCount = 0;
  const detectedAdType = adType || 'SP';

  for (const row of (data as any[])) {
    // 支持多种ID字段: keywordId, targetId
    const keywordId = row.keywordId || row.targetId;
    if (!keywordId) continue;

    const impressions = row.impressions || 0;
    const clicks = row.clicks || 0;
    
    // 花费字段映射
    const spend = row.spend || row.cost || 0;
    
    // 销售额字段映射
    let sales = 0;
    if (detectedAdType === 'SP') {
      sales = row.sales7d || row.sales14d || row.sales || 0;
    } else {
      sales = row.salesClicks || row.sales || 0;
    }
    
    // 订单数字段映射
    let orders = 0;
    if (detectedAdType === 'SP') {
      orders = row.purchases7d || row.purchases14d || row.purchases || 0;
    } else {
      orders = row.purchasesClicks || row.purchases || 0;
    }

    // 更新关键词绩效数据
    await database.execute(sql`
      UPDATE keywords SET 
        impressions = ${impressions},
        clicks = ${clicks},
        spend = ${spend},
        sales = ${sales},
        orders = ${orders},
        updatedAt = NOW()
       WHERE amazonKeywordId = ${keywordId}
    `);

    updatedCount++;
  }

  log.info(`[AsyncReportService] 更新了 ${updatedCount} 个关键词/定向的绩效数据 (广告类型: ${detectedAdType})`);
}

/**
 * 启动报告轮询服务
 * v640: 使用指数退避轮询间隔
 */
export function startReportPolling(): void {
  if (isPolling) {
    log.info('[AsyncReportService] 报告轮询服务已在运行');
    return;
  }

  isPolling = true;
  currentPollIntervalMs = POLL_CONFIG.initialIntervalMs;
  log.info(`[AsyncReportService] v640: 启动报告轮询服务 (初始间隔: ${currentPollIntervalMs / 1000}秒)`);

  // v640: 使用递归setTimeout实现指数退避
  const schedulePoll = async () => {
    if (!isPolling) return;
    
    const hadWork = await pollPendingReports();
    
    // v640: 有待处理报告时使用较短间隔，无报告时逐步增加间隔
    if (hadWork) {
      currentPollIntervalMs = POLL_CONFIG.initialIntervalMs;
    } else {
      currentPollIntervalMs = Math.min(
        currentPollIntervalMs * POLL_CONFIG.backoffMultiplier,
        POLL_CONFIG.maxIntervalMs
      );
    }
    
    pollIntervalId = setTimeout(schedulePoll, currentPollIntervalMs);
  };
  
  pollIntervalId = setTimeout(schedulePoll, currentPollIntervalMs);
}

/**
 * 停止报告轮询服务
 */
export function stopReportPolling(): void {
  if (!isPolling) {
    return;
  }

  isPolling = false;
  if (pollIntervalId) {
    clearTimeout(pollIntervalId);
    pollIntervalId = null;
  }
  log.info('[AsyncReportService] 报告轮询服务已停止');
}

/**
 * 轮询待处理的报告
 * v640: 返回是否有待处理报告，用于指数退避
 */
async function pollPendingReports(): Promise<boolean> {
  const database = await db.getDb();
  if (!database) {
    return false;
  }

  try {
    // v640: 定期清理过期缓存
    cleanExpiredCache();
    
    // 获取待处理的报告请求
    const pendingResult = await database.execute(sql`
      SELECT id, status FROM report_requests WHERE status IN ('pending', 'submitted', 'processing') ORDER BY createdAt ASC LIMIT ${POLL_CONFIG.batchSize}
    `);

    const pendingRequests = (pendingResult as Record<string, unknown>[])[0] || pendingResult;
    if (!pendingRequests || pendingRequests.length === 0) {
      return false;
    }

    log.info(`[AsyncReportService] 发现 ${pendingRequests.length} 个待处理报告`);

    for (const req of (pendingRequests as any[])) {
      const status = req.status;

      if (status === 'pending') {
        // 提交报告请求
        await submitReportRequest(req.id);
      } else if (status === 'submitted' || status === 'processing') {
        // 检查报告状态
        await checkAndDownloadReport(req.id);
      }
    }
    
    return true;
  } catch (error: unknown) {
    log.warn('[AsyncReportService] 轮询报告失败:', error);
    return false;
  }
}

/**
 * 批量创建绩效数据同步请求
 * v640: 增加按天分段创建请求，支持大账户分段同步
 */
export async function createPerformanceSyncRequests(
  accountId: number,
  startDate: string,
  endDate: string,
  options?: { segmentByDay?: boolean }
): Promise<number[]> {
  const account = await db.getAdAccountById(accountId);
  if (!account) {
    throw new Error(`Account ${accountId} not found`);
  }

  const requestIds: number[] = [];
  const profileId = account.profileId || '';
  const marketplace = account.marketplace || '';

  // v640: 按天分段创建请求（大账户分段同步）
  if (options?.segmentByDay) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dayStr = d.toISOString().split('T')[0];
      
      // 每天创建SP/SB/SD三种报告请求
      for (const reportType of ['sp_campaigns', 'sp_keywords', 'sb_campaigns', 'sd_campaigns'] as ReportType[]) {
        const id = await createReportRequest(accountId, profileId, marketplace, reportType, dayStr, dayStr);
        requestIds.push(id);
      }
    }
    
    log.info(`[AsyncReportService] v640: 按天分段创建了 ${requestIds.length} 个绩效数据同步请求 (${startDate}~${endDate})`);
  } else {
    // 原有逻辑：整段日期范围创建请求
    // 创建广告活动报告请求
    const campaignRequestId = await createReportRequest(accountId, profileId, marketplace, 'sp_campaigns', startDate, endDate);
    requestIds.push(campaignRequestId);

    // 创建关键词报告请求
    const keywordRequestId = await createReportRequest(accountId, profileId, marketplace, 'sp_keywords', startDate, endDate);
    requestIds.push(keywordRequestId);

    // 创建SB品牌广告报告请求
    const sbCampaignRequestId = await createReportRequest(accountId, profileId, marketplace, 'sb_campaigns', startDate, endDate);
    requestIds.push(sbCampaignRequestId);

    // 创建SD展示广告报告请求
    const sdCampaignRequestId = await createReportRequest(accountId, profileId, marketplace, 'sd_campaigns', startDate, endDate);
    requestIds.push(sdCampaignRequestId);

    log.info(`[AsyncReportService] 创建了 ${requestIds.length} 个绩效数据同步请求 (SP/SB/SD)`);
  }
  
  return requestIds;
}

/**
 * 获取报告请求状态
 */
export async function getReportRequestStatus(requestId: number): Promise<ReportRequest | null> {
  const database = await db.getDb();
  if (!database) {
    return null;
  }

  const result = await database.execute(sql`
    SELECT * FROM report_requests WHERE id = ${requestId}
  `);

  const requests = (result as Record<string, unknown>[])[0] || result;
  if (!requests || requests.length === 0) {
    return null;
  }

  return requests[0] as ReportRequest;
}

/**
 * 获取账户的报告请求列表
 */
export async function getAccountReportRequests(accountId: number, limit: number = 20): Promise<ReportRequest[]> {
  const database = await db.getDb();
  if (!database) {
    return [];
  }

  const result = await database.execute(sql`
    SELECT * FROM report_requests WHERE accountId = ${accountId} ORDER BY createdAt DESC LIMIT ${sql.raw(String(limit))}
  `);

  const requests = (result as Record<string, unknown>[])[0] || result;
  return requests as ReportRequest[];
}

/**
 * 获取服务状态
 * v640: 增加统计信息
 */
export function getServiceStatus(): { isPolling: boolean; stats: typeof stats; cacheSize: number; currentPollIntervalMs: number } {
  return { 
    isPolling, 
    stats: { ...stats },
    cacheSize: reportCache.size,
    currentPollIntervalMs,
  };
}
