import { createModuleLogger } from './utils/logger';
const log = createModuleLogger('Dailysynctask');
/**
 * 每日数据同步任务
 * 
 * 功能:
 * 1. 每天从Amazon Ads API获取前一天的绩效数据
 * 2. 存储到dailyPerformance表
 * 3. 支持手动触发和定时执行
 * 
 * v143: 修复db.insert编译错误，改用db封装函数
 */

import { AmazonAdsApiClient } from './amazonAdsApi';
import * as db from './db';

export interface SyncTaskConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  profileId: string;
  region: 'NA' | 'EU' | 'FE';
  storeId: string;
}

/**
 * 将API返回的行数据转换为DailyPerformance插入格式
 */
function buildPerformanceRecord(row: any, campaignId: string, date: string) {
  const impressions = parseInt(row.impressions || '0');
  const clicks = parseInt(row.clicks || '0');
  const spend = parseFloat(row.cost || '0');
  const sales = parseFloat(row.sales7d || '0');
  const orders = parseInt(row.purchases7d || '0');
  
  return {
    campaignId: parseInt(campaignId, 10) || 0,
    accountId: parseInt(row.accountId || '0', 10) || 0,
    date: date,
    impressions,
    clicks,
    spend: String(spend),
    sales: String(sales),
    orders,
    dailyAcos: sales > 0 ? String((spend / sales) * 100) : null,
    dailyRoas: spend > 0 ? String(sales / spend) : null,
    ctr: impressions > 0 ? String((clicks / impressions) * 100) : null,
    cvr: clicks > 0 ? String((orders / clicks) * 100) : null,
    cpc: clicks > 0 ? String(spend / clicks) : null,
    sales7D: String(parseFloat(row.sales7d || '0')),
    orders7D: parseInt(row.purchases7d || '0'),
    sales30D: String(parseFloat(row.sales30d || '0')),
    orders30D: parseInt(row.purchases30d || '0'),
  };
}

/**
 * 同步单个广告活动的每日数据
 */
export async function syncCampaignDailyData(
  apiData: any[],
  campaignId: string,
  date: string
): Promise<void> {
  try {
    // 查找该广告活动的数据
    const campaignData = apiData.find(
      (row: any) => row.campaignId?.toString() === campaignId
    );
    
    if (!campaignData) {
      log.info(`[Daily Sync] 未找到广告活动 ${campaignId} 的数据`);
      return;
    }
    
    // 使用db封装函数存储到数据库
    const record = buildPerformanceRecord(campaignData, campaignId, date);
    await db.createDailyPerformance(record as any);
    
    log.info(`[Daily Sync] 成功同步广告活动 ${campaignId} 的数据`);
  } catch (error: any) {
    log.error(`[Daily Sync] 同步广告活动 ${campaignId} 失败:`, error.message);
    throw error;
  }
}

/**
 * 同步所有广告活动的每日数据
 */
export async function syncAllCampaignsDailyData(
  config: SyncTaskConfig,
  date: string
): Promise<{ success: number; failed: number }> {
  log.info(`[Daily Sync] 开始同步所有广告活动的数据, 日期: ${date}`);
  
  // 创建API客户端
  const apiClient = new AmazonAdsApiClient({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    refreshToken: config.refreshToken,
    profileId: config.profileId,
    region: config.region,
  });

  let successCount = 0;
  let failedCount = 0;

  try {
    // 请求SP广告活动报告
    log.info('[Daily Sync] 请求SP广告活动报告...');
    const spReportId = await apiClient.requestSpCampaignReport(date, date);
    const spData = await apiClient.waitAndDownloadReport(spReportId);
    log.info(`[Daily Sync] SP报告下载完成, 共 ${spData.length} 条记录`);
    
    // 存储SP数据
    for (const row of spData) {
      try {
        const record = buildPerformanceRecord(row, row.campaignId?.toString() || '', date);
        await db.createDailyPerformance(record as any);
        successCount++;
      } catch (error: any) {
        log.error(`[Daily Sync] 存储广告活动 ${row.campaignId} 失败:`, error.message);
        failedCount++;
      }
    }
    
    // TODO: 同步SB和SD广告活动数据
    // const sbReportId = await apiClient.requestSbCampaignReport(date, date);
    // const sdReportId = await apiClient.requestSdCampaignReport(date, date);
    
    log.info(`[Daily Sync] 同步完成, 成功: ${successCount}, 失败: ${failedCount}`);
    return { success: successCount, failed: failedCount };
  } catch (error: any) {
    log.error('[Daily Sync] 同步失败:', error.message);
    throw error;
  }
}

/**
 * 获取昨天的日期字符串 (YYYY-MM-DD)
 */
export function getYesterdayDate(): string {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return yesterday.toISOString().split('T')[0];
}
