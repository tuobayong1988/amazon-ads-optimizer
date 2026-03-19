import { createModuleLogger } from '../utils/logger';
const log = createModuleLogger('Debugsync');
/**
 * 调试同步API端点
 * 用于诊断同步问题,返回详细的同步过程信息
 */

import { protectedProcedure, router } from '../_core/trpc';
import { z } from 'zod';
import * as db from '../db';
import { AmazonSyncService } from '../sync/amazonSyncService';

export const debugSyncRouter = router({
  /**
   * 测试API连接并返回原始数据
   */
  testApiConnection: protectedProcedure
    .input(z.object({
      accountId: z.number(),
    }))
    .query(async ({ input }: unknown) => {
      try {
        // 获取API凭证
        const credentials = await db.getAmazonApiCredentials(input.accountId);
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
        // @ts-expect-error - dynamic property access
        const apiResponse = await (syncService as Record<string, unknown>).client.listSpCampaigns();

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
      } catch (error: unknown) {
        return {
          success: false,
          error: (error as Error).message,
          stack: (error as Error).stack,
          // @ts-expect-error - Axios error response access
          details: (error as Error & { response?: unknown }).response?.data || error.toString(),
        };
      }
    }),

  /**
   * 检查数据库中的campaigns数据
   */
  checkDatabaseCampaigns: protectedProcedure
    .input(z.object({
      accountId: z.number(),
    }))
    .query(async ({ input }: unknown) => {
      try {
        const campaigns = await db.getCampaignsByAccountId(input.accountId);
        
        return {
          success: true,
          data: {
            accountId: input.accountId,
            campaignCount: campaigns.length,
            campaigns: campaigns.slice(0, 10), // 只返回前10个
            timestamp: new Date().toISOString(),
          }
        };
      } catch (error: unknown) {
        return {
          success: false,
          error: (error as Error).message,
          stack: (error as Error).stack,
        };
      }
    }),

  /**
   * 检查sync_tasks表
   */
  checkSyncTasks: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      limit: z.number().default(10),
    }))
    .query(async ({ input }: unknown) => {
      try {
        // 直接查询sync_tasks表
        // @ts-expect-error - dynamic property access
        const tasks = await (db as Record<string, unknown>).query(
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
      } catch (error: unknown) {
        return {
          success: false,
          error: (error as Error).message,
          stack: (error as Error).stack,
        };
      }
    }),

  /**
   * 触发全量同步 - 用于手动触发指定账户的全量数据同步
   */
  triggerFullSync: protectedProcedure
    .input(z.object({
      accountId: z.number(),
    }))
    .mutation(async ({ input }: unknown) => {
      try {
        const credentials = await db.getAmazonApiCredentials(input.accountId);
        if (!credentials) {
          return { success: false, error: '未找到API凭证' };
        }

        const account = await db.getAdAccountById(input.accountId);
        const marketplace = account?.marketplace || 'US';

        const syncService = await AmazonSyncService.createFromCredentials(
          {
            clientId: credentials.clientId,
            clientSecret: credentials.clientSecret,
            refreshToken: credentials.refreshToken,
            profileId: credentials.profileId,
            region: credentials.region as 'NA' | 'EU' | 'FE',
          },
          input.accountId,
          1,
          marketplace
        );

        // 异步执行全量同步，立即返回
        const startTime = new Date().toISOString();
        syncService.syncAll({ syncMode: 'recovery' }).then((result: Record<string, unknown>) => {
          log.info(`[FullSync] Account ${input.accountId} (${account?.storeName} ${marketplace}) completed:`, 
            JSON.stringify(result).substring(0, 500));
        }).catch((err: Error) => {
          log.error(`[FullSync] Account ${input.accountId} (${account?.storeName} ${marketplace}) failed:`, (err as Error).message);
        });

        return {
          success: true,
          message: `全量同步已触发: ${account?.storeName} ${marketplace} (ID: ${input.accountId})`,
          startTime,
        };
      } catch (error: unknown) {
        return {
          success: false,
          error: (error as Error).message,
          stack: (error as Error).stack,
        };
      }
    }),

  /**
   * 批量触发所有账户的全量同步
   */
  triggerFullSyncAll: protectedProcedure
    .mutation(async () => {
      try {
        const accounts = await db.getAdAccounts();
        const activeAccounts = accounts.filter((a: Record<string, unknown>) => 
          a.marketplace && a.marketplace !== '' && a.connectionStatus === 'connected'
        );

        const results: unknown[] = [];
        const startTime = new Date().toISOString();

        for (const account of (activeAccounts as unknown[])) {
          try {
            const credentials = await db.getAmazonApiCredentials(account.id);
            if (!credentials) {
              results.push({ accountId: account.id, store: account.storeName, marketplace: account.marketplace, status: 'skipped', reason: '无API凭证' });
              continue;
            }

            const syncService = await AmazonSyncService.createFromCredentials(
              {
                clientId: credentials.clientId,
                clientSecret: credentials.clientSecret,
                refreshToken: credentials.refreshToken,
                profileId: credentials.profileId,
                region: credentials.region as 'NA' | 'EU' | 'FE',
              },
              account.id,
              1,
              account.marketplace || 'US'
            );

            // 异步执行，不等待完成
            syncService.syncAll({ syncMode: 'recovery' }).then((result: Record<string, unknown>) => {
              log.info(`[FullSyncAll] Account ${account.id} (${account.storeName} ${account.marketplace}) completed`);
            }).catch((err: Error) => {
              log.error(`[FullSyncAll] Account ${account.id} (${account.storeName} ${account.marketplace}) failed:`, (err as Error).message);
            });

            results.push({ accountId: account.id, store: account.storeName, marketplace: account.marketplace, status: 'triggered' });
          } catch (err: unknown) {
            results.push({ accountId: account.id, store: account.storeName, marketplace: account.marketplace, status: 'error', error: (err as Error).message });
          }
        }

        return {
          success: true,
          message: `已触发 ${results.filter(r => r.status === 'triggered').length} 个账户的全量同步`,
          startTime,
          accounts: results,
        };
      } catch (error: unknown) {
        return {
          success: false,
          error: (error as Error).message,
        };
      }
    }),
});
