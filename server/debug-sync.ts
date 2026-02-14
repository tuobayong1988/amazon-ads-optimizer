/**
 * 调试同步API端点
 * 用于诊断同步问题,返回详细的同步过程信息
 */

import { publicProcedure, router } from './trpc';
import { z } from 'zod';
import { getDb } from './db';
import { AmazonSyncService } from './amazonSyncService';

export const debugSyncRouter = router({
  /**
   * 测试API连接并返回原始数据
   */
  testApiConnection: publicProcedure
    .input(z.object({
      accountId: z.number(),
    }))
    .query(async ({ input }) => {
      const db = getDb();
      if (!db) {
        return { success: false, error: '数据库连接失败' };
      }

      try {
        // 获取API凭证
        const credentials = await db.getAmazonCredentials(input.accountId);
        if (!credentials) {
          return { success: false, error: '未找到API凭证' };
        }

        // 获取账号信息
        const account = await db.getAdAccountById(input.accountId);
        const marketplace = account?.marketplace || 'US';

        // 创建同步服务
        const syncService = await AmazonSyncService.createFromCredentials(
          {
            clientId: credentials.clientId,
            clientSecret: credentials.clientSecret,
            refreshToken: credentials.refreshToken,
            profileId: credentials.profileId,
            region: credentials.region as 'NA' | 'EU' | 'FE',
          },
          input.accountId,
          1, // userId
          marketplace
        );

        // 调用API
        const apiResponse = await (syncService as any).client.listSpCampaigns();

        return {
          success: true,
          data: {
            accountId: input.accountId,
            marketplace,
            profileId: credentials.profileId,
            region: credentials.region,
            apiResponseCount: Array.isArray(apiResponse) ? apiResponse.length : 0,
            apiResponse: apiResponse,
            timestamp: new Date().toISOString(),
          }
        };
      } catch (error: any) {
        return {
          success: false,
          error: error.message,
          stack: error.stack,
          details: error.response?.data || error.toString(),
        };
      }
    }),

  /**
   * 检查数据库中的campaigns数据
   */
  checkDatabaseCampaigns: publicProcedure
    .input(z.object({
      accountId: z.number(),
    }))
    .query(async ({ input }) => {
      const db = getDb();
      if (!db) {
        return { success: false, error: '数据库连接失败' };
      }

      try {
        const campaigns = await db.getCampaignsByAccount(input.accountId);
        
        return {
          success: true,
          data: {
            accountId: input.accountId,
            campaignCount: campaigns.length,
            campaigns: campaigns.slice(0, 10), // 只返回前10个
            timestamp: new Date().toISOString(),
          }
        };
      } catch (error: any) {
        return {
          success: false,
          error: error.message,
          stack: error.stack,
        };
      }
    }),

  /**
   * 检查sync_tasks表
   */
  checkSyncTasks: publicProcedure
    .input(z.object({
      accountId: z.number(),
      limit: z.number().default(10),
    }))
    .query(async ({ input }) => {
      const db = getDb();
      if (!db) {
        return { success: false, error: '数据库连接失败' };
      }

      try {
        // 直接查询sync_tasks表
        const tasks = await (db as any).query(
          `SELECT * FROM sync_tasks 
           WHERE account_id = ? 
           ORDER BY created_at DESC 
           LIMIT ?`,
          [input.accountId, input.limit]
        );

        return {
          success: true,
          data: {
            accountId: input.accountId,
            taskCount: tasks.length,
            tasks: tasks,
            timestamp: new Date().toISOString(),
          }
        };
      } catch (error: any) {
        return {
          success: false,
          error: error.message,
          stack: error.stack,
        };
      }
    }),
});
