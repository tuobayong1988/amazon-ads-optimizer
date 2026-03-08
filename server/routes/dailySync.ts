/**
 * 每日数据同步路由
 */
import { router, protectedProcedure } from '../_core/trpc';
import { z } from 'zod';
import * as dailySyncTask from '../daily-sync-task';
import * as db from '../db';

export const dailySyncRouter = router({
  /**
   * 手动触发每日同步任务
   */
  triggerSync: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      date: z.string().optional(), // YYYY-MM-DD格式,不传则同步昨天的数据
    }))
    .mutation(async ({ ctx, input }) => {
      // 获取账号信息
      const account = await db.getAdAccountById(input.accountId);
      if (!account) {
        throw new Error('账号不存在');
      }

      // 获取Amazon Ads API配置
      const credentials = await db.getAmazonApiCredentials(input.accountId);
      if (!credentials) {
        throw new Error('未找到Amazon Ads API凭证');
      }

      // 构建同步配置
      const config: dailySyncTask.SyncTaskConfig = {
        clientId: credentials.clientId,
        clientSecret: credentials.clientSecret,
        refreshToken: credentials.refreshToken,
        profileId: account.profileId || '',
        region: getRegionFromMarketplace(account.marketplace),
        storeId: account.accountId,
      };

      // 确定同步日期
      const syncDate = input.date || dailySyncTask.getYesterdayDate();

      // 执行同步
      const result = await dailySyncTask.syncAllCampaignsDailyData(config, syncDate);

      return {
        success: true,
        date: syncDate,
        successCount: result.success,
        failedCount: result.failed,
      };
    }),

  /**
   * 获取同步任务状态
   */
  getSyncStatus: protectedProcedure
    .input(z.object({
      accountId: z.number(),
    }))
    .query(async ({ input }) => {
      // 查询最近的同步记录 - 使用现有的getDailyPerformanceByDateRange函数
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 30); // 查询30天内的数据
      
      const recentData = await db.getDailyPerformanceByDateRange(
        input.accountId,
        startDate,
        endDate
      );
      
      const latestSync = recentData.length > 0 ? recentData[recentData.length - 1] : null;
      
      return {
        lastSyncDate: latestSync?.date || null,
        lastSyncTime: latestSync?.createdAt || null,
        status: latestSync ? 'completed' : 'never_synced',
        recentSyncCount: recentData.length,
      };
    }),

  /**
   * 批量同步多个日期的数据
   */
  batchSync: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      startDate: z.string(), // YYYY-MM-DD
      endDate: z.string(),   // YYYY-MM-DD
    }))
    .mutation(async ({ ctx, input }) => {
      // 获取账号信息
      const account = await db.getAdAccountById(input.accountId);
      if (!account) {
        throw new Error('账号不存在');
      }

      // 获取Amazon Ads API配置
      const credentials = await db.getAmazonApiCredentials(input.accountId);
      if (!credentials) {
        throw new Error('未找到Amazon Ads API凭证');
      }

      // 构建同步配置
      const config: dailySyncTask.SyncTaskConfig = {
        clientId: credentials.clientId,
        clientSecret: credentials.clientSecret,
        refreshToken: credentials.refreshToken,
        profileId: account.profileId || '',
        region: getRegionFromMarketplace(account.marketplace),
        storeId: account.accountId,
      };

      // 生成日期列表
      const dates = generateDateRange(input.startDate, input.endDate);
      
      const results = [];
      for (const date of dates) {
        try {
          const result = await dailySyncTask.syncAllCampaignsDailyData(config, date);
          results.push({
            date,
            success: true,
            successCount: result.success,
            failedCount: result.failed,
          });
        } catch (error: unknown) {
          results.push({
            date,
            success: false,
            error: (error as Error).message,
          });
        }
      }

      return {
        success: true,
        results,
        totalDates: dates.length,
      };
    }),
});

/**
 * 根据marketplace获取region
 */
function getRegionFromMarketplace(marketplace: string): 'NA' | 'EU' | 'FE' {
  const naMarketplaces = ['US', 'CA', 'MX', 'BR'];
  const euMarketplaces = ['UK', 'DE', 'FR', 'IT', 'ES', 'NL', 'SE', 'PL', 'BE', 'TR', 'AE', 'SA', 'EG'];
  const feMarketplaces = ['JP', 'AU', 'SG', 'IN'];

  if (naMarketplaces.includes(marketplace)) return 'NA';
  if (euMarketplaces.includes(marketplace)) return 'EU';
  if (feMarketplaces.includes(marketplace)) return 'FE';
  
  return 'NA'; // 默认返回NA
}

/**
 * 生成日期范围数组
 */
function generateDateRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const start = new Date(startDate);
  const end = new Date(endDate);
  
  const current = new Date(start);
  while (current <= end) {
    dates.push(current.toISOString().split('T')[0]);
    current.setDate(current.getDate() + 1);
  }
  
  return dates;
}
