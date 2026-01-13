/**
 * 异步报告处理服务
 * 实现报告请求队列、后台轮询和自动数据处理
 */

import * as db from './db';
import { AmazonAdsApiClient } from './amazonAdsApi';
import { sql } from 'drizzle-orm';

// 报告请求类型
type ReportType = 'sp_campaigns' | 'sp_keywords' | 'sp_targets' | 'sb_campaigns' | 'sb_keywords' | 'sd_campaigns';

// 报告请求状态
type ReportStatus = 'pending' | 'submitted' | 'processing' | 'completed' | 'failed' | 'timeout';

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

// 轮询配置
const POLL_INTERVAL_MS = 30000; // 30秒轮询一次
const MAX_POLL_TIME_MS = 15 * 60 * 1000; // 最大轮询时间15分钟

// 服务状态
let isPolling = false;
let pollIntervalId: NodeJS.Timeout | null = null;

/**
 * 创建报告请求
 */
export async function createReportRequest(
  accountId: number,
  profileId: string,
  marketplace: string,
  reportType: ReportType,
  startDate: string,
  endDate: string
): Promise<number> {
  const database = await db.getDb();
  if (!database) {
    throw new Error('Database not available');
  }

  const result = await database.execute(sql`
    INSERT INTO report_requests (accountId, profileId, marketplace, reportType, startDate, endDate, status)
    VALUES (${accountId}, ${profileId}, ${marketplace}, ${reportType}, ${startDate}, ${endDate}, 'pending')
  `);

  const insertId = (result as any).insertId || (result as any)[0]?.insertId;
  console.log(`[AsyncReportService] 创建报告请求: ${insertId}`);
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

  const requests = (requestResult as any[])[0] || requestResult;
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

    console.log(`[AsyncReportService] 报告请求已提交: ${requestId}, reportId: ${reportId}`);
  } catch (error: any) {
    // 更新失败状态
    await database.execute(sql`
      UPDATE report_requests SET status = 'failed', errorMessage = ${error.message}, retryCount = retryCount + 1, updatedAt = NOW() WHERE id = ${requestId}
    `);
    console.error(`[AsyncReportService] 报告请求提交失败: ${requestId}`, error);
  }
}

/**
 * 检查报告状态并下载
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

  const requests = (requestResult as any[])[0] || requestResult;
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
    console.error(`[AsyncReportService] Account ${req.accountId} 未配置API凭证`);
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
    console.log(`[AsyncReportService] 报告状态: ${reportStatus.status}, requestId: ${requestId}`);

    if (reportStatus.status === 'COMPLETED' && reportStatus.url) {
      // 下载报告数据
      const reportData = await client.downloadReport(reportStatus.url);
      const recordsCount = reportData?.length || 0;
      
      // 更新请求状态
      await database.execute(sql`
        UPDATE report_requests SET status = 'completed', downloadUrl = ${reportStatus.url}, recordsCount = ${recordsCount}, updatedAt = NOW() WHERE id = ${requestId}
      `);

      // 处理报告数据
      await processReportData(req, reportData);

      console.log(`[AsyncReportService] 报告处理完成: ${requestId}, 记录数: ${recordsCount}`);
      return true;
    } else if (reportStatus.status === 'FAILURE') {
      await database.execute(sql`
        UPDATE report_requests SET status = 'failed', errorMessage = 'Report generation failed', updatedAt = NOW() WHERE id = ${requestId}
      `);
      return true;
    }

    // 检查是否超时
    const createdAt = new Date(req.createdAt).getTime();
    if (Date.now() - createdAt > MAX_POLL_TIME_MS) {
      await database.execute(sql`
        UPDATE report_requests SET status = 'timeout', errorMessage = 'Report generation timeout', updatedAt = NOW() WHERE id = ${requestId}
      `);
      return true;
    }

    // 更新状态为处理中
    await database.execute(sql`
      UPDATE report_requests SET status = 'processing', updatedAt = NOW() WHERE id = ${requestId}
    `);

    return false;
  } catch (error: any) {
    console.error(`[AsyncReportService] 检查报告状态失败: ${requestId}`, error);
    return false;
  }
}

/**
 * 处理报告数据
 */
async function processReportData(request: ReportRequest, data: any[]): Promise<void> {
  if (!data || data.length === 0) {
    return;
  }

  const database = await db.getDb();
  if (!database) {
    return;
  }

  console.log(`[AsyncReportService] 开始处理报告数据: ${request.reportType}, 记录数: ${data.length}`);

  switch (request.reportType) {
    case 'sp_campaigns':
      await processCampaignReportData(request.accountId, data, 'SP');
      break;
    case 'sp_keywords':
      await processKeywordReportData(request.accountId, data);
      break;
    case 'sb_campaigns':
      await processCampaignReportData(request.accountId, data, 'SB');
      break;
    // SB keywords报告暂不支持
    case 'sd_campaigns':
      await processCampaignReportData(request.accountId, data, 'SD');
      break;
    default:
      console.log(`[AsyncReportService] 未实现的报告类型处理: ${request.reportType}`);
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
async function processCampaignReportData(accountId: number, data: any[], adType?: string): Promise<void> {
  const database = await db.getDb();
  if (!database) {
    return;
  }

  let updatedCount = 0;

  for (const row of data) {
    const campaignId = row.campaignId;
    if (!campaignId) continue;

    // 查找本地campaign
    const campaignResult = await database.execute(sql`
      SELECT id, adType FROM campaigns WHERE amazonCampaignId = ${campaignId} AND accountId = ${accountId}
    `);

    const campaigns = (campaignResult as any[])[0] || campaignResult;
    if (!campaigns || campaigns.length === 0) continue;

    const localCampaignId = campaigns[0].id;
    const campaignAdType = adType || campaigns[0].adType || 'SP';
    
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

  console.log(`[AsyncReportService] 更新了 ${updatedCount} 个广告活动的绩效数据 (广告类型: ${adType || 'mixed'})`);
}

/**
 * 处理关键词/定向报告数据
 * 
 * 字段映射说明 (基于亓马逊广告API专家提供的Postman配置):
 * - SP: 使用 sales7d, purchases7d, acosClicks7d, roasClicks7d
 * - SB/SD: 使用 salesClicks, purchasesClicks
 */
async function processKeywordReportData(accountId: number, data: any[], adType?: string): Promise<void> {
  const database = await db.getDb();
  if (!database) {
    return;
  }

  let updatedCount = 0;
  const detectedAdType = adType || 'SP';

  for (const row of data) {
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

  console.log(`[AsyncReportService] 更新了 ${updatedCount} 个关键词/定向的绩效数据 (广告类型: ${detectedAdType})`);
}

/**
 * 启动报告轮询服务
 */
export function startReportPolling(): void {
  if (isPolling) {
    console.log('[AsyncReportService] 报告轮询服务已在运行');
    return;
  }

  isPolling = true;
  console.log('[AsyncReportService] 启动报告轮询服务...');

  pollIntervalId = setInterval(async () => {
    await pollPendingReports();
  }, POLL_INTERVAL_MS);
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
    clearInterval(pollIntervalId);
    pollIntervalId = null;
  }
  console.log('[AsyncReportService] 报告轮询服务已停止');
}

/**
 * 轮询待处理的报告
 */
async function pollPendingReports(): Promise<void> {
  const database = await db.getDb();
  if (!database) {
    return;
  }

  try {
    // 获取待处理的报告请求
    const pendingResult = await database.execute(sql`
      SELECT id, status FROM report_requests WHERE status IN ('pending', 'submitted', 'processing') ORDER BY createdAt ASC LIMIT 10
    `);

    const pendingRequests = (pendingResult as any[])[0] || pendingResult;
    if (!pendingRequests || pendingRequests.length === 0) {
      return;
    }

    console.log(`[AsyncReportService] 发现 ${pendingRequests.length} 个待处理报告`);

    for (const req of pendingRequests) {
      const status = req.status;

      if (status === 'pending') {
        // 提交报告请求
        await submitReportRequest(req.id);
      } else if (status === 'submitted' || status === 'processing') {
        // 检查报告状态
        await checkAndDownloadReport(req.id);
      }
    }
  } catch (error: any) {
    console.error('[AsyncReportService] 轮询报告失败:', error);
  }
}

/**
 * 批量创建绩效数据同步请求
 */
export async function createPerformanceSyncRequests(
  accountId: number,
  startDate: string,
  endDate: string
): Promise<number[]> {
  const account = await db.getAdAccountById(accountId);
  if (!account) {
    throw new Error(`Account ${accountId} not found`);
  }

  const requestIds: number[] = [];

  // 创建广告活动报告请求
  const campaignRequestId = await createReportRequest(
    accountId,
    account.profileId || '',
    account.marketplace || '',
    'sp_campaigns',
    startDate,
    endDate
  );
  requestIds.push(campaignRequestId);

  // 创建关键词报告请求
  const keywordRequestId = await createReportRequest(
    accountId,
    account.profileId || '',
    account.marketplace || '',
    'sp_keywords',
    startDate,
    endDate
  );
  requestIds.push(keywordRequestId);

  // 创建SB品牌广告报告请求
  const sbCampaignRequestId = await createReportRequest(
    accountId,
    account.profileId || '',
    account.marketplace || '',
    'sb_campaigns',
    startDate,
    endDate
  );
  requestIds.push(sbCampaignRequestId);

  // 创建SD展示广告报告请求
  const sdCampaignRequestId = await createReportRequest(
    accountId,
    account.profileId || '',
    account.marketplace || '',
    'sd_campaigns',
    startDate,
    endDate
  );
  requestIds.push(sdCampaignRequestId);

  console.log(`[AsyncReportService] 创建了 ${requestIds.length} 个绩效数据同步请求 (SP/SB/SD)`);
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

  const requests = (result as any[])[0] || result;
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
    SELECT * FROM report_requests WHERE accountId = ${accountId} ORDER BY createdAt DESC LIMIT ${limit}
  `);

  const requests = (result as any[])[0] || result;
  return requests as ReportRequest[];
}

/**
 * 获取服务状态
 */
export function getServiceStatus(): { isPolling: boolean } {
  return { isPolling };
}
