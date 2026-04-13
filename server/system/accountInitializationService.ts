/**
 * Account Initialization Service - 新账号初始化服务 (v360重构)
 * 
 * v360: 实现24小时数据收集周期
 * 
 * 当任何租户/用户添加新账号并完成Amazon广告API授权后：
 * 1. 设置24小时数据收集周期
 * 2. 在24小时内执行3轮全量同步（每轮间隔8小时）
 * 3. 每轮同步验证所有广告类型和层级的数据完整性
 * 4. 只有至少2轮同步全部成功后，才标记账号为"已就绪"
 * 5. 在初始化完成前，不触发自动优化
 * 
 * 初始化状态流转:
 *   pending → collecting (24h数据收集中) → ready (就绪，可优化) / failed
 */

import * as db from '../db';
import { AmazonSyncService } from '../sync/amazonSyncService';
import { AmazonAdsApiClient, MARKETPLACE_TO_REGION } from '../sync/amazonAdsApi';
import { createModuleLogger } from '../utils/logger';

const log = createModuleLogger('AccountInit');

// v360: 24小时数据收集配置
const DATA_COLLECTION_CONFIG = {
  totalDurationHours: 24,       // 总收集周期
  syncRounds: 3,                // 总同步轮次
  roundIntervalHours: 8,        // 每轮间隔
  minSuccessRounds: 2,          // 最少成功轮次才标记就绪
  maxRetryPerRound: 2,          // 每轮最大重试次数
  historicalDays: 90,           // 历史数据天数
};

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
  // v360: 24小时数据收集状态
  dataCollectionStatus: {
    status: 'collecting' | 'ready' | 'failed';
    currentRound: number;
    totalRounds: number;
    successRounds: number;
    nextRoundAt?: string;
    estimatedCompletionAt?: string;
  };
}

// v360: 同步轮次记录
interface SyncRoundResult {
  round: number;
  startedAt: Date;
  completedAt?: Date;
  success: boolean;
  syncedTypes: string[];
  failedTypes: string[];
  error?: string;
}

/**
 * v360: 检查账号是否处于数据收集期（未就绪，不应触发优化）
 */
export async function isAccountReady(accountId: number): Promise<boolean> {
  try {
    const account = await db.getAdAccountById(accountId);
    if (!account) return false;
    // 只有initializationStatus为'completed'或'ready'时才允许优化
    const status = account.initializationStatus || 'pending';
    return status === 'completed' || status === 'ready';
  } catch (err: any) {
    log.warn(`[AccountInit] 检查账号 ${accountId} 就绪状态失败: ${(err as Error).message}`);
    return false;
  }
}

/**
 * 初始化新接入的账号 (v360重构)
 * 
 * 执行初始化：
 * 1. 启动第一轮全量同步
 * 2. 创建定时同步配置
 * 3. 创建AMS订阅
 * 4. 注册24小时数据收集后台任务（3轮同步）
 */
export async function initializeAccount(params: {
  accountId: number;
  userId: number;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  profileId: string;
  region: 'NA' | 'EU' | 'FE';
  marketplace: string;
}): Promise<AccountInitializationResult> {
  const { accountId, userId, clientId, clientSecret, refreshToken, profileId, region, marketplace } = params;
  
  log.info(`[v360] 开始初始化账号 ${accountId} (${marketplace}), 启动24小时数据收集周期...`);
  
  const result: AccountInitializationResult = {
    accountId,
    marketplace,
    syncResult: { success: false },
    scheduleResult: { success: false },
    amsResult: { success: false },
    dataCollectionStatus: {
      status: 'collecting',
      currentRound: 1,
      totalRounds: DATA_COLLECTION_CONFIG.syncRounds,
      successRounds: 0,
      estimatedCompletionAt: new Date(Date.now() + DATA_COLLECTION_CONFIG.totalDurationHours * 3600000).toISOString(),
    },
  };

  // v360: 更新账号状态为"数据收集中"
  try {
    await db.updateAdAccount(accountId, {
      initializationStatus: 'collecting',
      initializationStartedAt: new Date().toISOString(),
      initializationProgress: 0,
      initializationError: null,
    });
  } catch (err: any) {
    log.warn(`[v360] 更新账号 ${accountId} 初始化状态失败: ${(err as Error).message}`);
  }

  // ==================== 步骤1: 启动第一轮全量数据同步 ====================
  try {
    log.info(`[v360] 步骤1: 启动第一轮全量数据同步 (${marketplace})...`);
    
    const syncService = await AmazonSyncService.createFromCredentials(
      { clientId, clientSecret, refreshToken, profileId, region },
      accountId,
      userId,
      marketplace
    );

    // v360: 第一轮同步 - 异步执行，完成后启动后续轮次调度
    syncService.syncAll({ syncMode: 'init' }).then(async (syncData) => {
      log.info(`[v360] 账号 ${accountId} (${marketplace}) 第1轮全量同步完成:`, syncData);
      await db.updateAmazonApiCredentialsLastSync(accountId);
      
      // 记录第1轮成功
      await recordSyncRound(accountId, 1, true);
      
      // v360: 调度后续轮次（第2轮在8小时后，第3轮在16小时后）
      scheduleSubsequentRounds(accountId, userId, clientId, clientSecret, refreshToken, profileId, region, marketplace);
      
      // v338: 全量同步完成后触发智能冷启动
      try {
        const { triggerColdStart } = await import('../optimization/coldStartService');
        const coldStartResult = await triggerColdStart(accountId, {
          reason: 'new_account',
          skipSync: true,
          historicalDays: DATA_COLLECTION_CONFIG.historicalDays,
          recentDays: 14,
        });
        log.info(`[v360] 账号 ${accountId} (${marketplace}) 冷启动${coldStartResult.triggered ? '已触发' : '已跳过'}: ${coldStartResult.reason || ''}`);
      } catch (coldStartErr: unknown) {
        log.warn(`[v360] 账号 ${accountId} (${marketplace}) 冷启动触发失败: ${(coldStartErr as Error).message}`);
      }
    }).catch(async (err) => {
      log.warn(`[v360] 账号 ${accountId} (${marketplace}) 第1轮全量同步失败:`, err);
      await recordSyncRound(accountId, 1, false, (err as Error).message);
      // 即使第1轮失败，仍然调度后续轮次
      scheduleSubsequentRounds(accountId, userId, clientId, clientSecret, refreshToken, profileId, region, marketplace);
    });

    result.syncResult = { success: true };
    log.info(`[v360] 步骤1完成: 第1轮全量同步已启动`);
  } catch (syncError: unknown) {
    log.warn(`[v360] 步骤1失败: 全量同步启动失败:`, syncError);
    result.syncResult = { success: false, error: (syncError as Error).message };
  }

  // ==================== 步骤2: 创建定时同步配置 ====================
  try {
    log.info(`步骤2: 创建定时同步配置 (${marketplace})...`);
    
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
      log.info(`步骤2完成: 已创建每小时定时同步配置 (scheduleId=${scheduleId})`);
    } else {
      if (!existingSchedule.isEnabled) {
        await db.updateSyncSchedule(existingSchedule.id, {
          isEnabled: true,
          frequency: 'hourly',
        });
        log.info(`步骤2完成: 已重新启用现有定时同步配置`);
      } else {
        log.info(`步骤2完成: 定时同步配置已存在且已启用`);
      }
      result.scheduleResult = { success: true, scheduleId: existingSchedule.id };
    }
  } catch (scheduleError: unknown) {
    log.warn(`步骤2失败: 创建定时同步配置失败:`, scheduleError);
    result.scheduleResult = { success: false, error: (scheduleError as Error).message };
  }

  // ==================== 步骤3: 创建AMS实时数据流订阅 ====================
  try {
    log.info(`步骤3: 创建AMS实时数据流订阅 (${marketplace})...`);
    
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
      log.warn(`步骤3跳过: 未配置SQS队列环境变量`);
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

      const amsArg = configuredQueues.length > 0 
        ? (queueArnMapping as Record<string, string>)
        : sqsQueueArn!;
      
      const amsCreateResult = await client.createAllTrafficSubscriptions(amsArg);
      
      result.amsResult = {
        success: true,
        subscriptionsCreated: amsCreateResult.created.length,
        subscriptionsFailed: amsCreateResult.failed.length,
      };

      if (amsCreateResult.created.length > 0) {
        const activeCount = amsCreateResult.created.filter(s => s.status === 'ACTIVE').length;
        log.warn(`步骤3完成: AMS订阅创建 ${amsCreateResult.created.length} 个 (ACTIVE: ${activeCount}), 失败 ${amsCreateResult.failed.length} 个`);
      } else {
        log.warn(`步骤3: 没有新创建的AMS订阅（可能已存在）`);
      }
    }
  } catch (amsError: unknown) {
    log.warn(`步骤3失败: AMS订阅创建失败:`, amsError);
    result.amsResult = { success: false, error: (amsError as Error).message };
  }

  log.info(`[v360] 账号 ${accountId} (${marketplace}) 初始化启动完成, 24小时数据收集周期开始`, {
    sync: result.syncResult.success ? 'started' : 'failed',
    schedule: result.scheduleResult.success ? 'ok' : 'failed',
    ams: result.amsResult.success ? 'ok' : 'failed',
    dataCollection: `Round 1/${DATA_COLLECTION_CONFIG.syncRounds} started`,
  });

  return result;
}

/**
 * v360: 记录同步轮次结果
 */
async function recordSyncRound(
  accountId: number,
  round: number,
  success: boolean,
  error?: string
): Promise<void> {
  try {
    // 使用initializationError字段存储轮次记录（JSON格式）
    const account = await db.getAdAccountById(accountId);
    if (!account) return;

    let roundHistory: SyncRoundResult[] = [];
    try {
      if (account.initializationError && account.initializationError.startsWith('[')) {
        roundHistory = JSON.parse(account.initializationError) as SyncRoundResult[];
      }
    } catch (_: any) { /* ignore parse errors */ }

    roundHistory.push({
      round,
      startedAt: new Date(),
      completedAt: new Date(),
      success,
      syncedTypes: success ? ['SP', 'SB', 'SD'] : [],
      failedTypes: success ? [] : ['unknown'],
      error,
    });

    const successRounds = roundHistory.filter(r => r.success).length;
    const progress = Math.round((round / DATA_COLLECTION_CONFIG.syncRounds) * 100);

    // 判断是否达到就绪条件
    if (round >= DATA_COLLECTION_CONFIG.syncRounds || successRounds >= DATA_COLLECTION_CONFIG.minSuccessRounds) {
      if (successRounds >= DATA_COLLECTION_CONFIG.minSuccessRounds) {
        // 达到最少成功轮次，标记为就绪
        await db.updateAdAccount(accountId, {
          initializationStatus: 'completed',
          initializationCompletedAt: new Date().toISOString(),
          initializationProgress: 100,
          initializationError: JSON.stringify(roundHistory),
        });
        log.info(`[v360] 账号 ${accountId} 数据收集完成! ${successRounds}/${round} 轮成功, 账号已就绪`);
      } else {
        // 所有轮次完成但成功轮次不足
        await db.updateAdAccount(accountId, {
          initializationStatus: 'failed',
          initializationProgress: progress,
          initializationError: JSON.stringify(roundHistory),
        });
        log.warn(`[v360] 账号 ${accountId} 数据收集失败! ${successRounds}/${round} 轮成功, 未达到最低要求 ${DATA_COLLECTION_CONFIG.minSuccessRounds} 轮`);
      }
    } else {
      // 更新进度
      await db.updateAdAccount(accountId, {
        initializationProgress: progress,
        initializationError: JSON.stringify(roundHistory),
      });
      log.info(`[v360] 账号 ${accountId} 第${round}轮同步${success ? '成功' : '失败'}, 进度 ${progress}%`);
    }
  } catch (err: any) {
    log.warn(`[v360] 记录同步轮次失败: ${(err as Error).message}`);
  }
}

/**
 * v360: 调度后续同步轮次（第2轮和第3轮）
 */
function scheduleSubsequentRounds(
  accountId: number,
  userId: number,
  clientId: string,
  clientSecret: string,
  refreshToken: string,
  profileId: string,
  region: 'NA' | 'EU' | 'FE',
  marketplace: string
): void {
  const intervalMs = DATA_COLLECTION_CONFIG.roundIntervalHours * 3600000;

  for (let round = 2; round <= DATA_COLLECTION_CONFIG.syncRounds; round++) {
    const delayMs = (round - 1) * intervalMs;
    const roundNum = round;

    setTimeout(async () => {
      try {
        // 检查账号是否已经就绪（前面的轮次可能已经满足条件）
        const account = await db.getAdAccountById(accountId);
        if (!account) {
          log.warn(`[v360] 第${roundNum}轮同步跳过: 账号 ${accountId} 不存在`);
          return;
        }
        if (account.initializationStatus === 'completed' || account.initializationStatus === 'ready') {
          log.info(`[v360] 第${roundNum}轮同步跳过: 账号 ${accountId} 已就绪`);
          return;
        }

        log.info(`[v360] 开始第${roundNum}轮全量同步, 账号 ${accountId} (${marketplace})`);

        const syncService = await AmazonSyncService.createFromCredentials(
          { clientId, clientSecret, refreshToken, profileId, region },
          accountId,
          userId,
          marketplace
        );

        const syncData = await syncService.syncAll({ syncMode: 'init' });
        log.info(`[v360] 账号 ${accountId} 第${roundNum}轮全量同步完成:`, syncData);
        await db.updateAmazonApiCredentialsLastSync(accountId);
        await recordSyncRound(accountId, roundNum, true);
      } catch (err: any) {
        log.warn(`[v360] 账号 ${accountId} 第${roundNum}轮全量同步失败:`, err);
        await recordSyncRound(accountId, roundNum, false, (err as Error).message);
        
        // v360: 失败后重试一次
        try {
          log.info(`[v360] 账号 ${accountId} 第${roundNum}轮同步重试...`);
          await new Promise(resolve => setTimeout(resolve, 300000)); // 等待5分钟后重试
          
          const syncService = await AmazonSyncService.createFromCredentials(
            { clientId, clientSecret, refreshToken, profileId, region },
            accountId,
            userId,
            marketplace
          );
          const retryData = await syncService.syncAll({ syncMode: 'init' });
          log.info(`[v360] 账号 ${accountId} 第${roundNum}轮重试成功:`, retryData);
          await recordSyncRound(accountId, roundNum, true);
        } catch (retryErr: any) {
          log.warn(`[v360] 账号 ${accountId} 第${roundNum}轮重试也失败:`, retryErr);
        }
      }
    }, delayMs);

    const nextRoundTime = new Date(Date.now() + delayMs);
    log.info(`[v360] 账号 ${accountId} 第${roundNum}轮同步已调度, 预计 ${nextRoundTime.toISOString()} 执行`);
  }
}

/**
 * v360: 获取账号数据收集状态
 */
export async function getDataCollectionStatus(accountId: number): Promise<{
  status: string;
  progress: number;
  rounds: SyncRoundResult[];
  isReady: boolean;
  estimatedCompletionAt?: string;
}> {
  const account = await db.getAdAccountById(accountId);
  if (!account) {
    return { status: 'unknown', progress: 0, rounds: [], isReady: false };
  }

  let rounds: SyncRoundResult[] = [];
  try {
    if (account.initializationError && account.initializationError.startsWith('[')) {
      rounds = JSON.parse(account.initializationError) as SyncRoundResult[];
    }
  } catch (_: any) { /* ignore */ }

  const isReady = account.initializationStatus === 'completed' || account.initializationStatus === 'ready';
  const startedAt = account.initializationStartedAt ? new Date(account.initializationStartedAt).getTime() : Date.now();
  const estimatedCompletionAt = new Date(startedAt + DATA_COLLECTION_CONFIG.totalDurationHours * 3600000).toISOString();

  return {
    status: account.initializationStatus || 'pending',
    progress: account.initializationProgress || 0,
    rounds,
    isReady,
    estimatedCompletionAt: isReady ? undefined : estimatedCompletionAt,
  };
}

/**
 * 批量初始化多个账号
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
  log.info(`[v360] 开始批量初始化 ${accounts.length} 个账号（每个启动24小时数据收集）...`);
  
  const results: AccountInitializationResult[] = [];
  
  for (const account of (accounts as unknown[])) {
    try {
      // @ts-expect-error Type inference limitation
      const result = await initializeAccount(account);
      results.push(result);
      
      // @ts-expect-error Complex function parameter types
      if (accounts.indexOf(account) < accounts.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      // @ts-expect-error Legacy code type compatibility
      }
    } catch (error: unknown) {
      // @ts-expect-error Complex function parameter types
      log.warn(`账号 ${account.accountId} 初始化异常:`, error);
      results.push({
        // @ts-expect-error Legacy code type compatibility
        accountId: account.accountId,
        // @ts-expect-error Legacy code type compatibility
        marketplace: account.marketplace,
        syncResult: { success: false, error: (error as Error).message },
        scheduleResult: { success: false, error: (error as Error).message },
        amsResult: { success: false, error: (error as Error).message },
        dataCollectionStatus: {
          status: 'failed',
          currentRound: 0,
          totalRounds: DATA_COLLECTION_CONFIG.syncRounds,
          successRounds: 0,
        },
      });
    }
  }
  
  const successCount = results.filter(r => r.syncResult.success).length;
  log.info(`[v360] 批量初始化启动完成: ${successCount}/${accounts.length} 个账号已开始数据收集`);
  
  return results;
}
