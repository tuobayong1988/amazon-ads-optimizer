/**
 * 每日数据同步任务
 * 
 * 功能:
 * 1. 每天从Amazon Ads API获取前一天的绩效数据
 * 2. 存储到dailyPerformance表
 * 3. 支持手动触发和定时执行
 */

import { AmazonAdsApiClient } from './amazonAdsApi';
import * as db from './db';
import { dailyPerformance } from '../drizzle/schema';

export interface SyncTaskConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  profileId: string;
  region: 'NA' | 'EU' | 'FE';
  storeId: string;
}

/**
 * 同步单个广告活动的每日数据
 */
export async function syncCampaignDailyData(
  config: SyncTaskConfig,
  campaignId: string,
  date: string
): Promise<void> {
  console.log(`[Daily Sync] 开始同步广告活动 ${campaignId} 的数据, 日期: ${date}`);
  
  // 创建API客户端
  const apiClient = new AmazonAdsApiClient({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    refreshToken: config.refreshToken,
    profileId: config.profileId,
    region: config.region,
  });

  try {
    // 请求SP广告活动报告
    const reportId = await apiClient.requestSpCampaignReport(date, date);
    
    // 等待报告完成并下载
    const reportData = await apiClient.waitAndDownloadReport(reportId);
    
    // 查找该广告活动的数据
    const campaignData = reportData.find((row: any) => 
      row.campaignId?.toString() === campaignId
    );
    
    if (!campaignData) {
      console.log(`[Daily Sync] 未找到广告活动 ${campaignId} 的数据`);
      return;
    }
    
    // 存储到数据库
    await db.insert(dailyPerformance).values({
      campaignId: campaignId,
      date: date,
      impressions: parseInt(campaignData.impressions || '0'),
      clicks: parseInt(campaignData.clicks || '0'),
      spend: parseFloat(campaignData.cost || '0'),
      sales: parseFloat(campaignData.sales7d || '0'),
      orders: parseInt(campaignData.purchases7d || '0'),
      dailyAcos: campaignData.sales7d ? 
        (parseFloat(campaignData.cost || '0') / parseFloat(campaignData.sales7d)) * 100 : 0,
      dailyRoas: campaignData.cost ? 
        parseFloat(campaignData.sales7d || '0') / parseFloat(campaignData.cost || '0') : 0,
      ctr: campaignData.impressions ? 
        (parseInt(campaignData.clicks || '0') / parseInt(campaignData.impressions || '0')) * 100 : 0,
      cvr: campaignData.clicks ? 
        (parseInt(campaignData.purchases7d || '0') / parseInt(campaignData.clicks || '0')) * 100 : 0,
      cpc: campaignData.clicks ? 
        parseFloat(campaignData.cost || '0') / parseInt(campaignData.clicks || '0') : 0,
      // 7天归因数据
      sales7d: parseFloat(campaignData.sales7d || '0'),
      orders7d: parseInt(campaignData.purchases7d || '0'),
      // 30天归因数据 (如果有)
      sales30d: parseFloat(campaignData.sales30d || '0'),
      orders30d: parseInt(campaignData.purchases30d || '0'),
    }).onConflictDoUpdate({
      target: [dailyPerformance.campaignId, dailyPerformance.date],
      set: {
        impressions: parseInt(campaignData.impressions || '0'),
        clicks: parseInt(campaignData.clicks || '0'),
        spend: parseFloat(campaignData.cost || '0'),
        sales: parseFloat(campaignData.sales7d || '0'),
        orders: parseInt(campaignData.purchases7d || '0'),
        dailyAcos: campaignData.sales7d ? 
          (parseFloat(campaignData.cost || '0') / parseFloat(campaignData.sales7d)) * 100 : 0,
        dailyRoas: campaignData.cost ? 
          parseFloat(campaignData.sales7d || '0') / parseFloat(campaignData.cost || '0') : 0,
        ctr: campaignData.impressions ? 
          (parseInt(campaignData.clicks || '0') / parseInt(campaignData.impressions || '0')) * 100 : 0,
        cvr: campaignData.clicks ? 
          (parseInt(campaignData.purchases7d || '0') / parseInt(campaignData.clicks || '0')) * 100 : 0,
        cpc: campaignData.clicks ? 
          parseFloat(campaignData.cost || '0') / parseInt(campaignData.clicks || '0') : 0,
        sales7d: parseFloat(campaignData.sales7d || '0'),
        orders7d: parseInt(campaignData.purchases7d || '0'),
        sales30d: parseFloat(campaignData.sales30d || '0'),
        orders30d: parseInt(campaignData.purchases30d || '0'),
      },
    });
    
    console.log(`[Daily Sync] 成功同步广告活动 ${campaignId} 的数据`);
  } catch (error: any) {
    console.error(`[Daily Sync] 同步广告活动 ${campaignId} 失败:`, error.message);
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
  console.log(`[Daily Sync] 开始同步所有广告活动的数据, 日期: ${date}`);
  
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
    console.log('[Daily Sync] 请求SP广告活动报告...');
    const spReportId = await apiClient.requestSpCampaignReport(date, date);
    const spData = await apiClient.waitAndDownloadReport(spReportId);
    console.log(`[Daily Sync] SP报告下载完成, 共 ${spData.length} 条记录`);
    
    // 存储SP数据
    for (const row of spData) {
      try {
        await db.insert(dailyPerformance).values({
          campaignId: row.campaignId?.toString() || '',
          date: date,
          impressions: parseInt(row.impressions || '0'),
          clicks: parseInt(row.clicks || '0'),
          spend: parseFloat(row.cost || '0'),
          sales: parseFloat(row.sales7d || '0'),
          orders: parseInt(row.purchases7d || '0'),
          dailyAcos: row.sales7d ? 
            (parseFloat(row.cost || '0') / parseFloat(row.sales7d)) * 100 : 0,
          dailyRoas: row.cost ? 
            parseFloat(row.sales7d || '0') / parseFloat(row.cost || '0') : 0,
          ctr: row.impressions ? 
            (parseInt(row.clicks || '0') / parseInt(row.impressions || '0')) * 100 : 0,
          cvr: row.clicks ? 
            (parseInt(row.purchases7d || '0') / parseInt(row.clicks || '0')) * 100 : 0,
          cpc: row.clicks ? 
            parseFloat(row.cost || '0') / parseInt(row.clicks || '0') : 0,
          sales7d: parseFloat(row.sales7d || '0'),
          orders7d: parseInt(row.purchases7d || '0'),
          sales30d: parseFloat(row.sales30d || '0'),
          orders30d: parseInt(row.purchases30d || '0'),
        }).onConflictDoUpdate({
          target: [dailyPerformance.campaignId, dailyPerformance.date],
          set: {
            impressions: parseInt(row.impressions || '0'),
            clicks: parseInt(row.clicks || '0'),
            spend: parseFloat(row.cost || '0'),
            sales: parseFloat(row.sales7d || '0'),
            orders: parseInt(row.purchases7d || '0'),
            dailyAcos: row.sales7d ? 
              (parseFloat(row.cost || '0') / parseFloat(row.sales7d)) * 100 : 0,
            dailyRoas: row.cost ? 
              parseFloat(row.sales7d || '0') / parseFloat(row.cost || '0') : 0,
            ctr: row.impressions ? 
              (parseInt(row.clicks || '0') / parseInt(row.impressions || '0')) * 100 : 0,
            cvr: row.clicks ? 
              (parseInt(row.purchases7d || '0') / parseInt(row.clicks || '0')) * 100 : 0,
            cpc: row.clicks ? 
              parseFloat(row.cost || '0') / parseInt(row.clicks || '0') : 0,
            sales7d: parseFloat(row.sales7d || '0'),
            orders7d: parseInt(row.purchases7d || '0'),
            sales30d: parseFloat(row.sales30d || '0'),
            orders30d: parseInt(row.purchases30d || '0'),
          },
        });
        successCount++;
      } catch (error: any) {
        console.error(`[Daily Sync] 存储广告活动 ${row.campaignId} 失败:`, error.message);
        failedCount++;
      }
    }
    
    // TODO: 同步SB和SD广告活动数据
    // const sbReportId = await apiClient.requestSbCampaignReport(date, date);
    // const sdReportId = await apiClient.requestSdCampaignReport(date, date);
    
    console.log(`[Daily Sync] 同步完成, 成功: ${successCount}, 失败: ${failedCount}`);
    return { success: successCount, failed: failedCount };
  } catch (error: any) {
    console.error('[Daily Sync] 同步失败:', error.message);
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

/**
 * 每日定时任务入口
 */
export async function runDailySyncTask(config: SyncTaskConfig): Promise<void> {
  const date = getYesterdayDate();
  console.log(`[Daily Sync Task] 开始执行每日同步任务, 日期: ${date}`);
  
  try {
    const result = await syncAllCampaignsDailyData(config, date);
    console.log(`[Daily Sync Task] 任务完成, 成功: ${result.success}, 失败: ${result.failed}`);
  } catch (error: any) {
    console.error('[Daily Sync Task] 任务失败:', error.message);
    throw error;
  }
}
