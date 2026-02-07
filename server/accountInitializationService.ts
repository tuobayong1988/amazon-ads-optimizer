/**
 * Account Initialization Service - 新账号初始化服务
 * 
 * 统一处理新租户/店铺/站点接入时的所有初始化操作：
 * 1. 全量数据同步（90天历史数据）
 * 2. 自动创建定时同步配置（每小时增量同步）
 * 3. 自动创建AMS实时数据流订阅（9个数据集）
 * 
 * 所有账号接入入口（saveCredentials、saveMultipleProfiles、batchAuth）
 * 都应调用此服务的 initializeAccount 方法，确保一致性。
 */

import * as db from './db';
import { AmazonSyncService } from './amazonSyncService';
import { AmazonAdsApiClient, MARKETPLACE_TO_REGION } from './amazonAdsApi';

// 初始化结果
export interface AccountInitializationResult {
  accountId: number;
  marketplace: string;
  syncResult: {
    success: boolean;
    campaigns?: number;
    adGroups?: number;
    keywords?: number;
    targets?: number;
    error?: string;
  };
  scheduleResult: {
    success: boolean;
    scheduleId?: number;
    error?: string;
  };
  amsResult: {
    success: boolean;
    subscriptionsCreated?: number;
    subscriptionsFailed?: number;
    error?: string;
  };
}

/**
 * 初始化新接入的账号
 * 
 * 执行三步初始化：
 * 1. 全量同步 - 获取90天历史数据
 * 2. 创建定时同步 - 每小时自动增量同步
 * 3. 创建AMS订阅 - 9个实时数据流
 * 
 * 所有步骤都是独立的，某一步失败不影响其他步骤。
 * 
 * @param params 初始化参数
 * @returns 初始化结果
 */
export async function initializeAccount(params: {
  accountId: number;
  userId: number;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  profileId: string;
  region: 'NA' | 'EU' | 'FE';
  marketplace: string;  // 站点代码，如 'US', 'JP'
}): Promise<AccountInitializationResult> {
  const { accountId, userId, clientId, clientSecret, refreshToken, profileId, region, marketplace } = params;
  
  console.log(`[AccountInit] 开始初始化账号 ${accountId} (${marketplace})...`);
  
  const result: AccountInitializationResult = {
    accountId,
    marketplace,
    syncResult: { success: false },
    scheduleResult: { success: false },
    amsResult: { success: false },
  };

  // ==================== 步骤1: 全量数据同步 ====================
  try {
    console.log(`[AccountInit] 步骤1: 启动全量数据同步 (${marketplace})...`);
    
    const syncService = await AmazonSyncService.createFromCredentials(
      { clientId, clientSecret, refreshToken, profileId, region },
      accountId,
      userId,
      marketplace
    );

    // 异步执行全量同步（获取90天历史数据），不阻塞后续步骤
    syncService.syncAll().then(async (syncData) => {
      console.log(`[AccountInit] 账号 ${accountId} (${marketplace}) 全量同步完成:`, syncData);
      await db.updateAmazonApiCredentialsLastSync(accountId);
    }).catch(err => {
      console.error(`[AccountInit] 账号 ${accountId} (${marketplace}) 全量同步失败:`, err);
    });

    result.syncResult = { success: true };
    console.log(`[AccountInit] 步骤1完成: 全量同步已启动`);
  } catch (syncError: any) {
    console.error(`[AccountInit] 步骤1失败: 全量同步启动失败:`, syncError);
    result.syncResult = { success: false, error: syncError.message };
  }

  // ==================== 步骤2: 创建定时同步配置 ====================
  try {
    console.log(`[AccountInit] 步骤2: 创建定时同步配置 (${marketplace})...`);
    
    // 检查是否已存在定时同步配置
    const existingSchedule = await db.getSyncScheduleByAccountId(userId, accountId);
    
    if (!existingSchedule) {
      const scheduleId = await db.createSyncSchedule({
        userId,
        accountId,
        syncType: 'all',
        frequency: 'hourly',
        isEnabled: true,
      });
      
      result.scheduleResult = { success: true, scheduleId: scheduleId as number };
      console.log(`[AccountInit] 步骤2完成: 已创建每小时定时同步配置 (scheduleId=${scheduleId})`);
    } else {
      // 已存在配置，确保它是启用的
      if (!existingSchedule.isEnabled) {
        await db.updateSyncSchedule(existingSchedule.id, {
          isEnabled: true,
          frequency: 'hourly',
        });
        console.log(`[AccountInit] 步骤2完成: 已重新启用现有定时同步配置`);
      } else {
        console.log(`[AccountInit] 步骤2完成: 定时同步配置已存在且已启用`);
      }
      result.scheduleResult = { success: true, scheduleId: existingSchedule.id };
    }
  } catch (scheduleError: any) {
    console.error(`[AccountInit] 步骤2失败: 创建定时同步配置失败:`, scheduleError);
    result.scheduleResult = { success: false, error: scheduleError.message };
  }

  // ==================== 步骤3: 创建AMS实时数据流订阅 ====================
  try {
    console.log(`[AccountInit] 步骤3: 创建AMS实时数据流订阅 (${marketplace})...`);
    
    // 构建SQS队列ARN映射
    const urlToArn = (url: string | undefined): string | undefined => {
      if (!url) return undefined;
      let match = url.match(/sqs\.([^.]+)\.amazonaws\.com\/(\d+)\/(.+)/);
      if (match) {
        const [, awsRegion, awsAccountId, queueName] = match;
        return `arn:aws:sqs:${awsRegion}:${awsAccountId}:${queueName}`;
      }
      match = url.match(/queue\.amazonaws\.com\/(\d+)\/(.+)/);
      if (match) {
        const [, awsAccountId, queueName] = match;
        const awsRegion = process.env.AWS_REGION || 'us-east-1';
        return `arn:aws:sqs:${awsRegion}:${awsAccountId}:${queueName}`;
      }
      return url;
    };

    const queueArnMapping: Record<string, string | undefined> = {
      'sp-traffic': urlToArn(process.env.AWS_SQS_QUEUE_TRAFFIC_URL),
      'sp-conversion': urlToArn(process.env.AWS_SQS_QUEUE_CONVERSION_URL),
      'sp-budget-usage': urlToArn(process.env.AWS_SQS_QUEUE_BUDGET_URL),
      'sb-traffic': urlToArn(process.env.AWS_SQS_QUEUE_SB_TRAFFIC_URL),
      'sb-conversion': urlToArn(process.env.AWS_SQS_QUEUE_SB_CONVERSION_URL),
      'sb-budget-usage': urlToArn(process.env.AWS_SQS_QUEUE_SB_BUDGET_URL),
      'sd-traffic': urlToArn(process.env.AWS_SQS_QUEUE_SD_TRAFFIC_URL),
      'sd-conversion': urlToArn(process.env.AWS_SQS_QUEUE_SD_CONVERSION_URL),
      'sd-budget-usage': urlToArn(process.env.AWS_SQS_QUEUE_SD_BUDGET_URL),
    };

    const configuredQueues = Object.entries(queueArnMapping).filter(([_, arn]) => arn);
    const sqsQueueArn = process.env.AWS_SQS_QUEUE_ARN;

    if (configuredQueues.length === 0 && !sqsQueueArn) {
      console.warn(`[AccountInit] 步骤3跳过: 未配置SQS队列环境变量，AMS订阅将在用户手动配置后创建`);
      result.amsResult = { success: false, error: '未配置SQS队列环境变量' };
    } else {
      const apiRegion = MARKETPLACE_TO_REGION[marketplace] || region;
      const client = new AmazonAdsApiClient({
        clientId,
        clientSecret,
        refreshToken,
        profileId,
        region: apiRegion,
      });

      // 使用队列映射或单一ARN创建订阅
      const amsArg = configuredQueues.length > 0 
        ? (queueArnMapping as Record<string, string>)
        : sqsQueueArn!;
      
      const amsCreateResult = await client.createAllTrafficSubscriptions(amsArg);
      
      result.amsResult = {
        success: true,
        subscriptionsCreated: amsCreateResult.created.length,
        subscriptionsFailed: amsCreateResult.failed.length,
      };

      // 验证订阅状态
      if (amsCreateResult.created.length > 0) {
        const activeCount = amsCreateResult.created.filter(s => s.status === 'ACTIVE').length;
        console.log(`[AccountInit] 步骤3完成: AMS订阅创建 ${amsCreateResult.created.length} 个 (ACTIVE: ${activeCount}), 失败 ${amsCreateResult.failed.length} 个`);
        
        if (activeCount < amsCreateResult.created.length) {
          console.warn(`[AccountInit] ⚠️ 部分AMS订阅未激活，请检查SQS队列权限`);
        }
      } else {
        console.warn(`[AccountInit] 步骤3: 没有新创建的AMS订阅（可能已存在）`);
      }
    }
  } catch (amsError: any) {
    console.error(`[AccountInit] 步骤3失败: AMS订阅创建失败:`, amsError);
    result.amsResult = { success: false, error: amsError.message };
  }

  console.log(`[AccountInit] 账号 ${accountId} (${marketplace}) 初始化完成:`, {
    sync: result.syncResult.success ? '✅' : '❌',
    schedule: result.scheduleResult.success ? '✅' : '❌',
    ams: result.amsResult.success ? '✅' : '❌',
  });

  return result;
}

/**
 * 批量初始化多个账号
 * 用于 saveMultipleProfiles 和 batchAuth 场景
 */
export async function initializeMultipleAccounts(accounts: Array<{
  accountId: number;
  userId: number;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  profileId: string;
  region: 'NA' | 'EU' | 'FE';
  marketplace: string;
}>): Promise<AccountInitializationResult[]> {
  console.log(`[AccountInit] 开始批量初始化 ${accounts.length} 个账号...`);
  
  const results: AccountInitializationResult[] = [];
  
  for (const account of accounts) {
    try {
      const result = await initializeAccount(account);
      results.push(result);
      
      // 每个账号之间间隔1秒，避免API限流
      if (accounts.indexOf(account) < accounts.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (error: any) {
      console.error(`[AccountInit] 账号 ${account.accountId} 初始化异常:`, error);
      results.push({
        accountId: account.accountId,
        marketplace: account.marketplace,
        syncResult: { success: false, error: error.message },
        scheduleResult: { success: false, error: error.message },
        amsResult: { success: false, error: error.message },
      });
    }
  }
  
  const successCount = results.filter(r => r.syncResult.success).length;
  console.log(`[AccountInit] 批量初始化完成: ${successCount}/${accounts.length} 个账号成功`);
  
  return results;
}
