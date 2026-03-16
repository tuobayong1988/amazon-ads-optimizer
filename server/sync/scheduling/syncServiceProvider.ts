/**
 * Amazon Sync Service Provider (v223)
 * 
 * 提供统一的方式获取 AmazonSyncService 实例。
 * 
 * 从 amazonApiHelper.ts 中提取出来，作为独立模块，
 * 打破 amazonSyncService -> amazonIdResolver -> amazonApiHelper -> amazonSyncService 循环依赖。
 * 
 * 使用纯依赖注入模式：由 amazonSyncService.ts 在模块加载时注册工厂函数。
 * 此模块不得导入 amazonSyncService.ts（包括动态导入），否则会重新引入循环依赖。
 */

import * as db from '../../db';
import { createModuleLogger } from '../../utils/logger';

const log = createModuleLogger('SyncServiceProvider');

// ==================== 依赖注入 ====================

type SyncServiceFactory = (
  credentials: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
    profileId: string;
    region: 'NA' | 'EU' | 'FE';
  },
  accountId: number,
  userId: number,
  marketplace: string
) => Promise<any>;

let _syncServiceFactory: SyncServiceFactory | null = null;

/**
 * 注册 SyncService 工厂函数（由 amazonSyncService.ts 在模块加载时调用）
 */
export function registerSyncServiceFactory(factory: SyncServiceFactory): void {
  _syncServiceFactory = factory;
  log.debug('SyncService 工厂函数已注册');
}

/**
 * 检查工厂函数是否已注册
 */
export function isSyncServiceFactoryRegistered(): boolean {
  return _syncServiceFactory !== null;
}

/**
 * 根据 accountId 创建 AmazonSyncService 实例
 * 自动从数据库加载 API 凭证和账号信息
 * 
 * v190: 添加重试机制 - DB临时中断或网络波动时自动重试
 */
export async function getAmazonSyncService(accountId: number): Promise<any> {
  if (!_syncServiceFactory) {
    throw new Error(
      '[SyncServiceProvider] SyncService 工厂函数尚未注册。' +
      '请确保 amazonSyncService.ts 已被导入并完成初始化。'
    );
  }

  const MAX_RETRIES = 2;
  const RETRY_DELAY_MS = 3000;
  
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      // 获取账号信息
      const account = await db.getAdAccountById(accountId);
      if (!account) {
        log.error(`[SyncServiceProvider] 账号 ${accountId} 不存在`);
        return null;
      }
      
      // 获取API凭证
      const credentials = await db.getAmazonApiCredentials(accountId);
      if (!credentials) {
        log.error(`[SyncServiceProvider] 账号 ${accountId} 未配置API凭证`);
        return null;
      }
      
      // 验证凭证完整性
      if (!credentials.clientId || !credentials.clientSecret || !credentials.refreshToken) {
        log.error(`[SyncServiceProvider] 账号 ${accountId} API凭证不完整`);
        return null;
      }
      
      if (!account.profileId) {
        log.error(`[SyncServiceProvider] 账号 ${accountId} 缺少profileId`);
        return null;
      }
      
      // 通过工厂函数创建SyncService实例
      const syncService = await _syncServiceFactory(
        {
          clientId: credentials.clientId || '',
          clientSecret: credentials.clientSecret || '',
          refreshToken: credentials.refreshToken || '',
          profileId: account.profileId || '',
          region: (credentials.region as 'NA' | 'EU' | 'FE') || 'NA'
        },
        accountId,
        account.userId,
        account.marketplace || 'US'
      );
      
      return syncService;
    } catch (error: unknown) {
      const isRetryable = (error as Error & { code?: string }).code === 'ECONNRESET' || (error as Error & { code?: string }).code === 'ETIMEDOUT' || 
                          (error as Error & { code?: string }).code === 'ECONNREFUSED' || (error as Error & { code?: string }).code === 'PROTOCOL_CONNECTION_LOST' ||
                          (error as Error).message?.includes('Connection lost') || (error as Error).message?.includes('ECONNRESET');
      
      if (isRetryable && attempt < MAX_RETRIES) {
        const waitTime = RETRY_DELAY_MS * (attempt + 1);
        log.warn(`[SyncServiceProvider] 创建SyncService失败(可重试), 第${attempt + 1}次重试, 等待${waitTime}ms... (accountId=${accountId}): ${(error as Error).message}`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }
      
      log.error(`[SyncServiceProvider] 创建SyncService失败 (accountId=${accountId}, 已重试${attempt}次):`, (error as Error).message);
      return null;
    }
  }
  return null;
}
