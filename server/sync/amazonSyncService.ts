/**
 * Amazon Advertising API 数据同步服务
 * 
 * 负责从Amazon API同步数据到本地数据库，包括：
 * - 广告活动同步
 * - 广告组同步
 * - 关键词和商品定位同步
 * - 绩效数据同步
 */

import { eq, and, sql, gte, inArray } from 'drizzle-orm';
import { getDb } from '../db';
import {
  campaigns,
  adGroups,
  keywords,
  productTargets,
  dailyPerformance,
  hourlyPerformance,
  biddingLogs,
  placementPerformance,
  searchTerms,
  negativeKeywords,
  optimizationEvents,
} from '../../drizzle/schema';
import { createModuleLogger } from '../utils/logger';

const log = createModuleLogger('SyncService');
import {
  AmazonAdsApiClient,
  createAmazonAdsClient,
  AmazonApiCredentials,
  SpCampaign,
} from './amazonAdsApi';
import { OptimizationTarget, PerformanceGroupConfig } from '../optimization/bidOptimizer';
import { getMarketplaceDateRange, getMarketplaceCurrentDate, getMarketplaceYesterday, getMarketplaceHistoricalDateRange } from '../utils/timezone';
import { getExchangeRateByMarketplace } from '../services/exchangeRateService';
import { registerSyncServiceFactory } from '../services/syncServiceProvider';

// API凭证存储接口
interface StoredApiCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  profileId: string;
  region: 'NA' | 'EU' | 'FE';
}

/**
 * v149: 货币转换已迁移到 exchangeRateService.ts
 * 使用实时汇率API（ExchangeRate-API），每日自动更新
 * 静态兗底汇率保留在 exchangeRateService 中
 */

/**
 * v150.1: 数据同步保护配置常量
 * 可根据生产环境观察调整时间窗口大小：
 * - 如果Amazon API数据延迟通常在1-2小时内收敛，可缩短到6-12小时
 * - 如果延迟较长，可扩展到48小时
 * - BID_THRESHOLD: 出价差异阈值，低于此值视为相同（避免浮点精度问题）
 */
const SYNC_PROTECTION_CONFIG = {
  /** 出价保护时间窗口（小时） */
  BID_PROTECTION_HOURS: 24,
  /** 预算保护时间窗口（小时） */
  BUDGET_PROTECTION_HOURS: 24,
  /** 出价/预算差异阈值（美元） */
  BID_THRESHOLD: 0.01,
} as const;

/**
 * v150.1: 同步保护统计计数器
 * 用于在每次同步完成后输出结构化摘要日志
 */
interface SyncProtectionStats {
  bidProtected: number;       // 出价被保护的次数
  bidOverwritten: number;     // 出价被API覆盙的次数
  budgetProtected: number;    // 预算被保护的次数
  budgetOverwritten: number;  // 预算被API覆盙的次数
  protectedEntities: string[]; // 被保护的实体名称列表（用于调试）
}

function createSyncProtectionStats(): SyncProtectionStats {
  return { bidProtected: 0, bidOverwritten: 0, budgetProtected: 0, budgetOverwritten: 0, protectedEntities: [] };
}

function logSyncProtectionSummary(functionName: string, stats: SyncProtectionStats): void {
  const total = stats.bidProtected + stats.bidOverwritten + stats.budgetProtected + stats.budgetOverwritten;
  if (total === 0) return;
  log.info(`${functionName} 同步保护摘要: ` +
    `出价保护=${stats.bidProtected}, 出价覆盙=${stats.bidOverwritten}, ` +
    `预算保护=${stats.budgetProtected}, 预算覆盙=${stats.budgetOverwritten}`);
  if (stats.protectedEntities.length > 0) {
    log.debug(`${functionName} 被保护实体: ${stats.protectedEntities.slice(0, 20).join(', ')}${stats.protectedEntities.length > 20 ? ` ...等${stats.protectedEntities.length}个` : ''}`);
  }
}

/**
 * v150: 数据同步出价/预算保护辅助函数
 * 查询optimization_events表，检查指定关键词/广告活动是否有近期（24小时内）
 * 成功同步到Amazon的优化事件。如果有，说明本地出价/预算是优化后的值，
 * 数据同步时应保留本地值而非用API返回值覆盖。
 */
async function hasRecentSyncedOptimization(
  keywordId?: number,
  campaignId?: number,
  category: 'bid_adjustment' | 'budget_adjustment' = 'bid_adjustment',
  hoursWindow: number = 24
): Promise<boolean> {
  try {
    const db = await getDb();
    if (!db) return false;
    const cutoff = new Date(Date.now() - hoursWindow * 60 * 60 * 1000)
      .toISOString().slice(0, 19).replace('T', ' ');
    
    const conditions: unknown[] = [
      eq(optimizationEvents.eventCategory, category),
      eq(optimizationEvents.apiSyncStatus, 'synced'),
      gte(optimizationEvents.createdAt, cutoff),
    ];
    
    if (keywordId) {
      conditions.push(eq(optimizationEvents.keywordId, keywordId));
    }
    if (campaignId) {
      conditions.push(eq(optimizationEvents.campaignId, campaignId));
    }
    
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(optimizationEvents)
      // @ts-ignore
      .where(and(...conditions))
      .limit(1);
    
    return (result[0]?.count || 0) > 0;
  } catch (error) {
    // 查询失败时不阻塞同步，默认不保护（以API为准）
    log.warn('v150: 查询优化事件失败，默认以API为准:', (error instanceof Error ? (error as Error).message : String(error)));
    return false;
  }
}

/**
 * v150+v212: 批量查询有近期优化事件的关键词ID集合
 * 用于批量同步时高效判断哪些关键词需要保护
 * 
 * v212增强: 
 * - 同时查询synced和pending状态（partial映射为pending也应保护）
 * - 添加fallback查询optimization_logs表
 * - 增强错误日志，记录查询失败的详细信息
 */
async function getRecentlyOptimizedKeywordIds(
  keywordIds: number[],
  hoursWindow: number = 24
): Promise<Set<number>> {
  try {
    if (keywordIds.length === 0) return new Set();
    const db = await getDb();
    if (!db) {
      log.error('v212: 数据库连接不可用，保护机制无法工作！');
      return new Set();
    }
    const cutoff = new Date(Date.now() - hoursWindow * 60 * 60 * 1000)
      .toISOString().slice(0, 19).replace('T', ' ');
    
    // v212: 查询synced状态的记录（主要保护对象）
    const results = await db
      .select({ keywordId: optimizationEvents.keywordId })
      .from(optimizationEvents)
      .where(and(
        eq(optimizationEvents.eventCategory, 'bid_adjustment'),
        eq(optimizationEvents.apiSyncStatus, 'synced'),
        gte(optimizationEvents.createdAt, cutoff),
        inArray(optimizationEvents.keywordId, keywordIds)
      ))
      .groupBy(optimizationEvents.keywordId);
    
    const protectedSet = new Set(results.map(r => r.keywordId!).filter(Boolean));
    
    // v212: Fallback - 如果optimization_events查询结果为空，尝试从optimization_logs中查找
    // 这是为了兼容双写失败的历史数据
    if (protectedSet.size === 0 && keywordIds.length > 0) {
      try {
        const fallbackResults = await db.execute(
          sql`SELECT DISTINCT JSON_UNQUOTE(JSON_EXTRACT(action_detail, '$.keywordId')) as kw_id
              FROM optimization_logs
              WHERE log_category = 'bid_adjustment'
                AND api_sync_status IN ('synced', 'partial')
                AND created_at >= ${cutoff}
                AND JSON_EXTRACT(action_detail, '$.keywordId') IS NOT NULL`
        );
        const fallbackRows = (fallbackResults as unknown as any[][])[0] || [];
        if (fallbackRows && fallbackRows.length > 0) {
          const fallbackKeywordIds = new Set(fallbackRows.map((r: Record<string, any>) => Number(r.kw_id)).filter(id => id > 0 && keywordIds.includes(id)));
          if (fallbackKeywordIds.size > 0) {
            log.debug(`v212: Fallback查询optimization_logs找到${fallbackKeywordIds.size}个需要保护的关键词`);
            for (const id of fallbackKeywordIds) protectedSet.add(id);
          }
        }
      } catch (fallbackErr) {
        log.warn('v212: Fallback查询optimization_logs失败:', (fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)));
      }
    }
    
    log.info(`v212: 查询完成, 输入${keywordIds.length}个关键词, 保护${protectedSet.size}个`);
    return protectedSet;
  } catch (error) {
    log.error('v212: ❌ 批量查询优化关键词失败，保护机制降级！', (error instanceof Error ? (error as Error).message : String(error)));
    // @ts-ignore
    log.error('v212: 错误详情:', (error as unknown).stack?.substring(0, 300));
    // v212: 即使查询失败，仍返回空Set以不阻塞同步
    // 但通过error级别日志确保问题被发现
    return new Set();
  }
}

/**
 * v150+v212: 批量查询有近期预算优化事件的广告活动ID集合
 * v212增强: 增强错误日志
 */
async function getRecentlyOptimizedCampaignIds(
  campaignIds: number[],
  hoursWindow: number = 24
): Promise<Set<number>> {
  try {
    if (campaignIds.length === 0) return new Set();
    const db = await getDb();
    if (!db) {
      log.error('v212: 数据库连接不可用，预算保护机制无法工作！');
      return new Set();
    }
    const cutoff = new Date(Date.now() - hoursWindow * 60 * 60 * 1000)
      .toISOString().slice(0, 19).replace('T', ' ');
    
    const results = await db
      .select({ campaignId: optimizationEvents.campaignId })
      .from(optimizationEvents)
      .where(and(
        eq(optimizationEvents.eventCategory, 'budget_adjustment'),
        eq(optimizationEvents.apiSyncStatus, 'synced'),
        gte(optimizationEvents.createdAt, cutoff),
        inArray(optimizationEvents.campaignId, campaignIds)
      ))
      .groupBy(optimizationEvents.campaignId);
    
    const protectedSet = new Set(results.map(r => r.campaignId!).filter(Boolean));
    log.info(`v212: 预算保护查询完成, 输入${campaignIds.length}个广告活动, 保护${protectedSet.size}个`);
    return protectedSet;
  } catch (error) {
    log.error('v212: ❌ 批量查询优化广告活动失败:', (error instanceof Error ? (error as Error).message : String(error)));
    return new Set();
  }
}

/**
 * 同步服务类
 */
export class AmazonSyncService {
  public client: AmazonAdsApiClient;
  public accountId: number;
  public userId: number;
  public marketplace: string; // 站点代码，用于时区计算

  constructor(client: AmazonAdsApiClient, accountId: number, userId: number, marketplace: string = 'US') {
    this.client = client;
    this.accountId = accountId;
    this.userId = userId;
    this.marketplace = marketplace;
    // v369: 确保client始终持有正确的accountId用于限流
    if (client) client.accountId = accountId;
  }

  /**
   * 从数据库加载API凭证并创建同步服务
   */
  static async createFromCredentials(
    credentials: StoredApiCredentials,
    accountId: number,
    userId: number,
    marketplace: string = 'US' // 站点代码，用于时区计算
  ): Promise<AmazonSyncService> {
    const apiCredentials: AmazonApiCredentials = {
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
      refreshToken: credentials.refreshToken,
      profileId: credentials.profileId,
      region: credentials.region,
    };

    const client = createAmazonAdsClient(apiCredentials);
    // v369: 将accountId传递给client，使其在API限流中按账户独立计数
    client.accountId = accountId;
    return new AmazonSyncService(client, accountId, userId, marketplace);
  }

  /**
   * v402: 完整同步所有数据（三阶段同步策略 + 子任务分解）
   * - init模式: 新账号初始化，同步API支持的最长时间范围（SP 90天/SB 60天/SD 90天）
   * - daily模式: 日常增量，只同步近14天数据（归因期内可能变化的数据），大幅减少API调用
   * - recovery模式: 自愈恢复（宕机/数据异常），同步90天全量数据
   * 
   * v402增强:
   * - 支持按广告类型分解同步（layers参数）
   * - 每个Layer独立错误隔离，失败不影响后续层
   * - 支持重试失败的子任务（retryFailedLayers）
   */
  async syncAll(options?: { performanceDays?: number; syncMode?: 'init' | 'daily' | 'recovery'; layers?: number[]; retryFailedLayers?: boolean }): Promise<{
    campaigns: number;
    adGroups: number;
    keywords: number;
    targets: number;
    performance: number;
    spCampaigns?: number;
    sbCampaigns?: number;
    sdCampaigns?: number;
    _syncDiagnostics?: { stepName: string; synced: number; durationMs: number; error?: string }[];
  }> {
    const results = {
      campaigns: 0,
      adGroups: 0,
      keywords: 0,
      targets: 0,
      performance: 0,
      spCampaigns: 0,
      sbCampaigns: 0,
      sdCampaigns: 0,
      _syncDiagnostics: [] as { stepName: string; synced: number; durationMs: number; error?: string }[],
    };

    // v340: 分步诊断日志系统 — 记录每个步骤的开始、结束、耗时和异常
    const syncAllStartTime = Date.now();
    let totalSteps = 0;
    let failedSteps = 0;
    // v382: 三阶段同步策略 - 根据syncMode决定同步天数
    const syncMode = options?.syncMode || 'daily'; // 默认为daily模式（日常增量）
    const DAILY_SYNC_DAYS = 14; // 归因期天数，日常只需同步这个范围
    const FULL_SP_DAYS = 90;    // SP API最大支持天数
    const FULL_SB_DAYS = 60;    // SB API最大支持天数
    const FULL_SD_DAYS = 90;    // SD API最大支持天数
    
    // init/recovery模式使用全量天数，daily模式使用归因期天数
    const isFullSync = syncMode === 'init' || syncMode === 'recovery';
    const spDays = isFullSync ? FULL_SP_DAYS : DAILY_SYNC_DAYS;
    const sbDays = isFullSync ? FULL_SB_DAYS : DAILY_SYNC_DAYS;
    const sdDays = isFullSync ? FULL_SD_DAYS : DAILY_SYNC_DAYS;
    
    log.info(`[syncAll] ⏱️ 账户${this.accountId} 开始${syncMode}模式同步 (SP=${spDays}天, SB=${sbDays}天, SD=${sdDays}天)`);

    // v345: 步骤级重试配置
    // v371: 增加重试次数到3次（原1次），增强429/5xx错误的恢复能力
    // 退避策略: 3s -> 6s -> 12s，总等待约21秒，足以覆盖大多数临时限流
    const STEP_RETRY_CONFIG = { maxRetries: 3, baseDelayMs: 3000 };
    // v360: DAG层间延迟配置 - 避免层切换时API请求突增
    const LAYER_TRANSITION_DELAY_MS = 2000;
    const MAX_CONCURRENT_PER_LAYER = 8; // v360: 每层最大并发数

    const runStep = async <T>(stepName: string, fn: () => Promise<T>): Promise<T | null> => {
      totalSteps++;
      const stepStart = Date.now();
      log.info(`[syncAll] 📌 账户${this.accountId} 步骤[${totalSteps}] ${stepName} 开始...`);
      
      // v345: 步骤级重试 — 对可重试错误(429/5xx)自动重试一次
      for (let attempt = 0; attempt <= STEP_RETRY_CONFIG.maxRetries; attempt++) {
        try {
          const result = await fn();
          const durationMs = Date.now() - stepStart;
          let synced = 0;
          if (typeof result === 'number') synced = result;
          // @ts-ignore
          else if (result && typeof result === 'object' && 'synced' in (result as unknown)) synced = (result as unknown).synced;
          results._syncDiagnostics!.push({ stepName, synced, durationMs, ...(attempt > 0 ? { retried: true } : {}) });
          log.info(`[syncAll] ✅ 账户${this.accountId} 步骤[${totalSteps}] ${stepName} 完成: ${synced}条, 耗时${durationMs}ms${attempt > 0 ? ` (第${attempt}次重试成功)` : ''}`);
          // v352: 步骤间延迟，降低API调用密度
          if (totalSteps > 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
          return result;
        } catch (error: unknown) {
          const errMsg = (error as Error).message || '';
          const isRetryable = errMsg.includes('429') || errMsg.includes('503') || errMsg.includes('502') || errMsg.includes('ETIMEDOUT') || errMsg.includes('ECONNRESET');
          
          if (isRetryable && attempt < STEP_RETRY_CONFIG.maxRetries) {
            const delay = STEP_RETRY_CONFIG.baseDelayMs * Math.pow(2, attempt);
            log.warn(`[syncAll] ⚠️ 账户${this.accountId} 步骤[${totalSteps}] ${stepName} 失败(可重试): ${errMsg}, ${delay}ms后重试...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
          
          const durationMs = Date.now() - stepStart;
          failedSteps++;
          results._syncDiagnostics!.push({ stepName, synced: 0, durationMs, error: errMsg });
          log.error(`[syncAll] ❌ 账户${this.accountId} 步骤[${totalSteps}] ${stepName} 失败(${durationMs}ms): ${errMsg}`);
          return null;
        }
      }
      return null;
    };

    // v402: 子任务分解支持 - 允许指定只执行某些层
    const targetLayers = options?.layers || [0, 1, 2, 3, 4, 5]; // 默认执行所有层
    const layerResults: Record<number, { success: boolean; error?: string }> = {};
    
    // v402: Layer级别隔离包装器 - 每个Layer独立捕获异常
    const runLayer = async (layerId: number, layerName: string, fn: () => Promise<void>): Promise<void> => {
      if (!targetLayers.includes(layerId)) {
        log.info(`[syncAll] v402: 跳过 Layer ${layerId} (${layerName}) - 不在目标层列表中`);
        return;
      }
      const layerStart = Date.now();
      try {
        await fn();
        layerResults[layerId] = { success: true };
        log.info(`[syncAll] v402: Layer ${layerId} (${layerName}) 完成，耗时${Date.now() - layerStart}ms`);
      } catch (layerErr: unknown) {
        const errMsg = (layerErr as Error).message || 'unknown';
        layerResults[layerId] = { success: false, error: errMsg };
        log.error(`[syncAll] v402: Layer ${layerId} (${layerName}) 失败: ${errMsg}，继续执行后续层`);
      }
    };

    // v359/v360: DAG并行调度 - 按层级依赖关系并行执行同步步骤
    // v360增强: 层间转换延迟 + 并发限制 + 失败层降级
    // v402增强: Layer级别隔离 + 子任务分解 + 重试支持
    
    // ==================== Layer 0: 广告活动（SP/SB/SD并行） ====================
    await runLayer(0, '广告活动同步', async () => {
    log.info(`[syncAll] v359: Layer 0 - 广告活动同步 (3个并行)`);
    const [spResult, sbResult, sdResult] = await Promise.allSettled([
      // @ts-ignore
      runStep('SP广告活动', () => this.syncSpCampaigns()),
      // @ts-ignore
      runStep('SB广告活动', () => this.syncSbCampaigns()),
      // @ts-ignore
      runStep('SD广告活动', () => this.syncSdCampaigns()),
    ]);
    
    if (spResult.status === 'fulfilled' && spResult.value !== null) {
      results.spCampaigns = typeof spResult.value === 'number' ? spResult.value : (spResult.value as Record<string, any>)?.synced as number || 0;
      results.campaigns += results.spCampaigns;
    }
    if (sbResult.status === 'fulfilled' && sbResult.value !== null) {
      results.sbCampaigns = typeof sbResult.value === 'number' ? sbResult.value : (sbResult.value as Record<string, any>)?.synced as number || 0;
      results.campaigns += results.sbCampaigns;
    }
    if (sdResult.status === 'fulfilled' && sdResult.value !== null) {
      results.sdCampaigns = typeof sdResult.value === 'number' ? sdResult.value : (sdResult.value as Record<string, any>)?.synced as number || 0;
      results.campaigns += results.sdCampaigns;
    }
    
    // v360: 层间转换延迟
    await new Promise(resolve => setTimeout(resolve, LAYER_TRANSITION_DELAY_MS));
    }); // end Layer 0
    
    // ==================== Layer 1: 广告组（SP/SB/SD并行） ====================
    await runLayer(1, '广告组同步', async () => {
    log.info(`[syncAll] v359: Layer 1 - 广告组同步 (3个并行)`);
    const [spAdGroupResult, sbAdGroupResult, sdAdGroupResult] = await Promise.allSettled([
      // @ts-ignore
      runStep('SP广告组', () => this.syncSpAdGroups()),
      // @ts-ignore
      runStep('SB广告组', () => this.syncSbAdGroups()),
      // @ts-ignore
      runStep('SD广告组', () => this.syncSdAdGroups()),
    ]);
    
    if (spAdGroupResult.status === 'fulfilled' && spAdGroupResult.value !== null) {
      results.adGroups += typeof spAdGroupResult.value === 'number' ? spAdGroupResult.value : (spAdGroupResult.value as Record<string, any>)?.synced as number || 0;
    }
    if (sbAdGroupResult.status === 'fulfilled' && sbAdGroupResult.value !== null) {
      results.adGroups += (sbAdGroupResult.value as Record<string, any>)?.synced as number || 0;
    }
    if (sdAdGroupResult.status === 'fulfilled' && sdAdGroupResult.value !== null) {
      results.adGroups += (sdAdGroupResult.value as Record<string, any>)?.synced as number || 0;
    }
    
    // v360: 层间转换延迟
    await new Promise(resolve => setTimeout(resolve, LAYER_TRANSITION_DELAY_MS));
    }); // end Layer 1
    
    // ==================== Layer 2: 关键词+商品定位+广告素材（6个并行） ====================
    await runLayer(2, '关键词/商品定位/素材同步', async () => {
    log.info(`[syncAll] v359: Layer 2 - 关键词/商品定位/素材同步 (6个并行)`);
    const [spKeywordResult, sbKeywordResult, spTargetResult, sbTargetResult, sdTargetResult, sbAdsResult] = await Promise.allSettled([
      // @ts-ignore
      runStep('SP关键词', () => this.syncSpKeywords()),
      // @ts-ignore
      runStep('SB关键词', () => this.syncSbKeywords()),
      // @ts-ignore
      runStep('SP商品定位', () => this.syncSpProductTargets()),
      // @ts-ignore
      runStep('SB商品定位', () => this.syncSbProductTargets()),
      // @ts-ignore
      runStep('SD商品定位', () => this.syncSdProductTargets()),
      // @ts-ignore
      runStep('SB广告素材', () => this.syncSbAds()),
    ]);
    
    if (spKeywordResult.status === 'fulfilled' && spKeywordResult.value !== null) {
      results.keywords += typeof spKeywordResult.value === 'number' ? spKeywordResult.value : (spKeywordResult.value as Record<string, any>)?.synced as number || 0;
    }
    if (sbKeywordResult.status === 'fulfilled' && sbKeywordResult.value !== null) {
      results.keywords += (sbKeywordResult.value as Record<string, any>)?.synced as number || 0;
    }
    if (spTargetResult.status === 'fulfilled' && spTargetResult.value !== null) {
      results.targets += typeof spTargetResult.value === 'number' ? spTargetResult.value : (spTargetResult.value as Record<string, any>)?.synced as number || 0;
    }
    if (sbTargetResult.status === 'fulfilled' && sbTargetResult.value !== null) {
      results.targets += (sbTargetResult.value as Record<string, any>)?.synced as number || 0;
    }
    if (sdTargetResult.status === 'fulfilled' && sdTargetResult.value !== null) {
      results.targets += (sdTargetResult.value as Record<string, any>)?.synced as number || 0;
    }
    
    // v360: 层间转换延迟
    await new Promise(resolve => setTimeout(resolve, LAYER_TRANSITION_DELAY_MS));
    }); // end Layer 2
    
    // ==================== Layer 3: 否定词+搜索词+广告位绩效（8个并行） ====================
    await runLayer(3, '否定词/搜索词/广告位绩效同步', async () => {
    log.info(`[syncAll] v382: Layer 3 - 否定词/搜索词/广告位绩效同步 (9个并行)`);
    await Promise.allSettled([
      // @ts-ignore
      runStep('SP否定关键词', () => this.syncSpNegativeKeywords()),
      // @ts-ignore
      runStep('SP否定商品定向', () => this.syncSpNegativeProductTargets()),
      // @ts-ignore
      runStep('SB否定关键词', () => this.syncSbNegativeKeywords()),
      // @ts-ignore
      runStep('SB否定商品定向', () => this.syncSbNegativeTargets()),
      // @ts-ignore  v382: 新增SD否定产品定向同步
      runStep('SD否定产品定向', () => this.syncSdNegativeTargets()),
      runStep(`SP搜索词(${spDays}天)`, () => this.syncSearchTerms(spDays)),
      // @ts-ignore
      runStep(`SB搜索词(${sbDays}天)`, () => this.syncSbSearchTerms(sbDays)),
      // @ts-ignore
      runStep(`SP广告位绩效(${spDays}天)`, () => this.syncPlacementPerformance(spDays)),
      // @ts-ignore
      runStep(`SB广告位绩效(${sbDays}天)`, () => this.syncSbPlacementPerformance(sbDays)),
    ]);

    // v360: 层间转换延迟
    await new Promise(resolve => setTimeout(resolve, LAYER_TRANSITION_DELAY_MS));
    }); // end Layer 3
    
    // ==================== Layer 4: 定向报告+素材URL（4个并行） ====================
    await runLayer(4, '定向报告/素材URL同步', async () => {
    log.info(`[syncAll] v359: Layer 4 - 定向报告/素材URL同步 (4个并行)`);
    await Promise.allSettled([
      runStep(`SP自动定向(${spDays}天)`, () => this.syncAutoTargeting(spDays)),
      // @ts-ignore
      runStep(`SD定向报告(${sdDays}天)`, () => this.syncSdTargeting(sdDays)),
      // @ts-ignore
      runStep(`SB定向报告(${sbDays}天)`, () => this.syncSbTargeting(sbDays)),
      runStep('SB素材URL解析', () => this.syncAssetUrls()),
    ]);

    // v360: 层间转换延迟
    await new Promise(resolve => setTimeout(resolve, LAYER_TRANSITION_DELAY_MS));
    }); // end Layer 4
    
    // ==================== Layer 5: 绩效数据（4个并行） ====================
    // v366: 默认同步天数从14天扩展到90天，充分利用Amazon API支持的最大范围
    // v382: performanceDays优先使用显式传入的值，否则根据syncMode决定
    const performanceDays = options?.performanceDays || (isFullSync ? parseInt(process.env.SYNC_PERFORMANCE_DAYS || '90', 10) : DAILY_SYNC_DAYS);
    await runLayer(5, '绩效数据同步', async () => {
    log.info(`[syncAll] v359: Layer 5 - 绩效数据同步 (4个并行, ${performanceDays}天)`);
    const [perfResult, _kwPerfResult, _ptPerfResult, _agPerfResult] = await Promise.allSettled([
      // @ts-ignore
      runStep(`广告活动绩效(${performanceDays}天)`, () => this.syncPerformanceData(performanceDays)),
      // @ts-ignore
      runStep(`关键词绩效(${performanceDays}天)`, () => this.syncKeywordPerformanceData(performanceDays)),
      // @ts-ignore
      runStep(`商品定位绩效(${performanceDays}天)`, () => this.syncProductTargetPerformanceData(performanceDays)),
      // @ts-ignore
      runStep(`广告组绩效(${performanceDays}天)`, () => this.syncAdGroupPerformanceData(performanceDays)),
    ]);
    if (perfResult.status === 'fulfilled' && perfResult.value !== null) {
      results.performance += typeof perfResult.value === 'number' ? perfResult.value : (perfResult.value as Record<string, any>)?.synced as number || 0;
    }
    }); // end Layer 5

    // v402: 子任务分解汇总
    const failedLayers = Object.entries(layerResults).filter(([_, r]) => !r.success).map(([id, r]) => `Layer${id}(${r.error})`);
    if (failedLayers.length > 0) {
      log.warn(`[syncAll] v402: 账户${this.accountId} 有${failedLayers.length}个层失败: ${failedLayers.join(', ')}`);
    }

    // v340: 同步完成汇总报告
    const totalDurationMs = Date.now() - syncAllStartTime;
    const totalSynced = results._syncDiagnostics!.reduce((sum: any, d: any) => sum + d.synced, 0);
    const failedStepNames = results._syncDiagnostics!.filter(d => d.error).map(d => d.stepName);
    log.info(`[syncAll] 📊 账户${this.accountId} ${syncMode}模式同步完成: 总步骤=${totalSteps}, 成功=${totalSteps - failedSteps}, 失败=${failedSteps}, 总记录=${totalSynced}, 总耗时=${totalDurationMs}ms`);
    if (failedSteps > 0) {
      log.warn(`[syncAll] ⚠️ 账户${this.accountId} 失败步骤: ${failedStepNames.join(', ')}`);
    }
    if (totalSynced === 0 && totalSteps > 0) {
      log.error(`[syncAll] 🚨 账户${this.accountId} 全量同步完成但总记录数为0！可能存在API授权或数据问题，请检查以上各步骤详情。`);
    }
    
    // v361: 记录数据同步审计日志
    try {
      const { recordAudit } = await import('./services/auditLogService');
      recordAudit({
        action: 'sync.full_sync',
        accountId: this.accountId,
        entityType: 'account',
        entityId: this.accountId,
        source: 'system',
        result: failedSteps === 0 ? 'success' : (totalSynced > 0 ? 'partial' : 'failure'),
        metadata: {
          totalSteps,
          successSteps: totalSteps - failedSteps,
          failedSteps,
          totalSynced,
          durationMs: totalDurationMs,
          failedStepNames,
          // v402: 子任务分解信息
          layerResults,
          targetLayers,
        },
      });
    } catch (auditErr: unknown) {
      // 审计日志失败不影响主流程
    }

    return results;
  }

  /**
   * 仅同步广告活动（高频同步）
   * 用于快速获取广告活动状态和预算变化
   */
  async syncCampaignsOnly(): Promise<{
    campaigns: number;
    spCampaigns: number;
    sbCampaigns: number;
    sdCampaigns: number;
  }> {
    const results = {
      campaigns: 0,
      spCampaigns: 0,
      sbCampaigns: 0,
      sdCampaigns: 0,
    };

    // v190: 每种广告类型独立try-catch，一个失败不影响其他
    try {
      const spResult = await this.syncSpCampaigns();
      // @ts-ignore
      results.spCampaigns = typeof spResult === 'number' ? spResult : spResult.synced;
      results.campaigns += results.spCampaigns;
    } catch (error: unknown) {
      log.error('SP广告活动同步失败:', (error as Error).message);
    }
    
    try {
      const sbResult = await this.syncSbCampaigns();
      // @ts-ignore
      results.sbCampaigns = typeof sbResult === 'number' ? sbResult : sbResult.synced;
      results.campaigns += results.sbCampaigns;
    } catch (error: unknown) {
      log.error('SB广告活动同步失败:', (error as Error).message);
    }
    
    try {
      const sdResult = await this.syncSdCampaigns();
      // @ts-ignore
      results.sdCampaigns = typeof sdResult === 'number' ? sdResult : sdResult.synced;
      results.campaigns += results.sdCampaigns;
    } catch (error: unknown) {
      log.error('SD广告活动同步失败:', (error as Error).message);
    }
    
    log.info(`广告活动同步完成: SP=${results.spCampaigns}, SB=${results.sbCampaigns}, SD=${results.sdCampaigns}`);

    return results;
  }

  /**
   * 同步广告组和定位数据（中频同步）
   * 用于获取广告组、关键词和商品定位的变化
   */
  async syncAdGroupsAndTargeting(): Promise<{
    adGroups: number;
    keywords: number;
    targets: number;
  }> {
    const results = {
      adGroups: 0,
      keywords: 0,
      targets: 0,
    };

    // v190: 每个同步操作独立try-catch，一个失败不影响其他
    // ==================== 同步广告组（SP + SB + SD） ====================
    try {
      const spAdGroupResult = await this.syncSpAdGroups();
      // @ts-ignore
      results.adGroups += typeof spAdGroupResult === 'number' ? spAdGroupResult : spAdGroupResult.synced;
    } catch (e: unknown) {
      log.error('SP广告组同步失败:', (e as Error).message);
    }

    try {
      const sbAdGroupResult = await this.syncSbAdGroups();
      // @ts-ignore
      results.adGroups += sbAdGroupResult.synced;
    } catch (e: unknown) {
      log.error('SB广告组同步失败:', (e as Error).message);
    }

    try {
      const sdAdGroupResult = await this.syncSdAdGroups();
      // @ts-ignore
      results.adGroups += sdAdGroupResult.synced;
    } catch (e: unknown) {
      log.error('SD广告组同步失败:', (e as Error).message);
    }
    
    // ==================== 同步关键词投放（SP + SB） ====================
    try {
      const spKeywordResult = await this.syncSpKeywords();
      // @ts-ignore
      results.keywords += typeof spKeywordResult === 'number' ? spKeywordResult : spKeywordResult.synced;
    } catch (e: unknown) {
      log.error('SP关键词同步失败:', (e as Error).message);
    }

    try {
      const sbKeywordResult = await this.syncSbKeywords();
      // @ts-ignore
      results.keywords += sbKeywordResult.synced;
    } catch (e: unknown) {
      log.error('SB关键词同步失败:', (e as Error).message);
    }
    
    // ==================== 同步商品定位（SP + SB + SD） ====================
    try {
      const spTargetResult = await this.syncSpProductTargets();
      // @ts-ignore
      results.targets += typeof spTargetResult === 'number' ? spTargetResult : spTargetResult.synced;
    } catch (e: unknown) {
      log.error('SP商品定位同步失败:', (e as Error).message);
    }

    try {
      const sbTargetResult = await this.syncSbProductTargets();
      // @ts-ignore
      results.targets += sbTargetResult.synced;
    } catch (e: unknown) {
      log.error('SB商品定位同步失败:', (e as Error).message);
    }

    try {
      const sdTargetResult = await this.syncSdProductTargets();
      // @ts-ignore
      results.targets += sdTargetResult.synced;
    } catch (e: unknown) {
      log.error('SD商品定位同步失败:', (e as Error).message);
    }

    // v196: 中频同步时同时同步搜索词数据（7天窗口），确保搜索词数据不滞后
    try {
      log.info(`v196: 中频同步 - 开始同步SP搜索词数据(7天)...`);
      const spSearchTermSynced = await this.syncSearchTerms(7);
      log.info(`v196: 中频同步 - SP搜索词同步完成: ${spSearchTermSynced}条`);
    } catch (e: unknown) {
      log.error('v196: 中频同步 - SP搜索词同步失败:', (e as Error).message);
    }

    log.info(`全渠道广告组和定位同步完成: 广告组=${results.adGroups}, 关键词=${results.keywords}, 定位=${results.targets}`);

    return results;
  }

}

/**
 * v383: 搜索词批量UPSERT辅助函数
 * 批量INSERT搜索词数据，失败时回退到逐条插入
 */
export async function flushSearchTermBatch(db: any, batch: any[]): Promise<void> {
  if (batch.length === 0) return;
  try {
    // v395: 使用ON DUPLICATE KEY UPDATE实现真正的UPSERT，防止重复插入
    await db.insert(searchTerms).values(batch)
      .onDuplicateKeyUpdate({
        set: {
          searchTermImpressions: sql`VALUES(search_term_impressions)`,
          searchTermClicks: sql`VALUES(search_term_clicks)`,
          searchTermSpend: sql`VALUES(search_term_spend)`,
          searchTermSales: sql`VALUES(search_term_sales)`,
          searchTermOrders: sql`VALUES(search_term_orders)`,
          searchTermAcos: sql`VALUES(search_term_acos)`,
          searchTermRoas: sql`VALUES(search_term_roas)`,
          searchTermCtr: sql`VALUES(search_term_ctr)`,
          searchTermCvr: sql`VALUES(search_term_cvr)`,
          searchTermCpc: sql`VALUES(search_term_cpc)`,
          searchTermUnitsOrdered: sql`VALUES(search_term_units_ordered)`,
          searchTermTargetId: sql`VALUES(search_term_target_id)`,
          targetText: sql`VALUES(target_text)`,
          searchTermMatchType: sql`VALUES(search_term_match_type)`,
          sourceMatchType: sql`VALUES(source_match_type)`,
          sourceTargetType: sql`VALUES(source_target_type)`,
          searchTermType: sql`VALUES(search_term_type)`,
          reportEndDate: sql`VALUES(report_end_date)`,
          updatedAt: sql`VALUES(updated_at)`,
        },
      });
  } catch (insertErr: unknown) {
    log.warn(`[v395] 搜索词批量UPSERT失败，回退到逐条模式: ${(insertErr as Error).message}`);
    for (const row of batch) {
      try {
        await db.insert(searchTerms).values(row)
          .onDuplicateKeyUpdate({
            set: {
              searchTermImpressions: sql`VALUES(search_term_impressions)`,
              searchTermClicks: sql`VALUES(search_term_clicks)`,
              searchTermSpend: sql`VALUES(search_term_spend)`,
              searchTermSales: sql`VALUES(search_term_sales)`,
              searchTermOrders: sql`VALUES(search_term_orders)`,
              searchTermAcos: sql`VALUES(search_term_acos)`,
              searchTermRoas: sql`VALUES(search_term_roas)`,
              searchTermCtr: sql`VALUES(search_term_ctr)`,
              searchTermCvr: sql`VALUES(search_term_cvr)`,
              searchTermCpc: sql`VALUES(search_term_cpc)`,
              searchTermUnitsOrdered: sql`VALUES(search_term_units_ordered)`,
              updatedAt: sql`VALUES(updated_at)`,
            },
          });
      } catch (singleErr: unknown) {
        log.debug(`[v395] 搜索词单条UPSERT失败: ${(singleErr as Error).message}`);
      }
    }
  }
}

AmazonSyncService.prototype.syncSearchTerms = async function(this: AmazonSyncService, days: number = 90): Promise<number> {
    const db = await getDb();
    if (!db) return 0;

    try {
      // v339: Amazon API单次请求最多31天，需要分批请求
      const MAX_DAYS_PER_REQUEST = 31;
      const totalDays = Math.min(days, 90); // SP搜索词最多支持90天
      const { startDate: rangeStartDate, endDate: rangeEndDate } = getMarketplaceDateRange(this.marketplace, totalDays);
      const batches = Math.ceil(totalDays / MAX_DAYS_PER_REQUEST);
      log.info(`v339: 开始同步SP搜索词数据: 共${totalDays}天，分${batches}批请求 (站点: ${this.marketplace})`);
      log.info(`v339: 总范围: ${rangeStartDate} - ${rangeEndDate}`);

      // v413: 批量提交+统一轮询模式（替代串行循环）
      let allReportData: any[] = [];
      if (batches === 1) {
        try {
          const reportId = await this.client.requestSpSearchTermReport(rangeStartDate, rangeEndDate);
          const data = await this.client.waitAndDownloadReport(reportId, 300000);
          if (data && data.length > 0) allReportData = data;
        } catch (e: unknown) {
          log.error(`v413: SP搜索词报告请求失败:`, (e as Error).message);
        }
      } else {
        const batchRequests: Array<{ name: string; requestFn: () => Promise<string> }> = [];
        for (let batch = 0; batch < batches; batch++) {
          const endDateObj = new Date(rangeEndDate);
          endDateObj.setDate(endDateObj.getDate() - (batch * MAX_DAYS_PER_REQUEST));
          const startDateObj = new Date(endDateObj);
          const daysInBatch = Math.min(MAX_DAYS_PER_REQUEST, totalDays - (batch * MAX_DAYS_PER_REQUEST));
          startDateObj.setDate(startDateObj.getDate() - daysInBatch + 1);
          const bStart = startDateObj.toISOString().split('T')[0];
          const bEnd = endDateObj.toISOString().split('T')[0];
          batchRequests.push({
            name: `SP搜索词第${batch + 1}/${batches}批(${bStart}~${bEnd})`,
            requestFn: () => this.client.requestSpSearchTermReport(bStart, bEnd),
          });
        }
        log.info(`[v413] SP搜索词: ${batches}批次批量提交开始`);
        const results = await this.client.submitAndWaitMultipleReports(batchRequests, 300000, 2000);
        for (const result of results) {
          if (result.data && result.data.length > 0) {
            allReportData = allReportData.concat(result.data);
          } else if (result.error) {
            log.warn(`[v413] ${result.name}失败: ${result.error}`);
          }
        }
      }

      const startDate = rangeStartDate;
      const endDate = rangeEndDate;

      if (allReportData.length === 0) {
        log.debug('v339: 所有批次搜索词报告数据为空');
        return 0;
      }

      const reportData = allReportData;
      log.info(`v339: 共获取到 ${reportData.length} 条搜索词数据（${batches}批合并），开始批量预加载...`);

      // v196: 批量预加载所有关联数据，避免逐行查询
      // 1. 预加载campaigns: amazonCampaignId -> localCampaign
      const allCampaigns = await db
        .select({ id: campaigns.id, campaignId: campaigns.campaignId })
        .from(campaigns)
        .where(eq(campaigns.accountId, this.accountId));
      const campaignMap = new Map<string, { id: number }>();
      for (const c of (allCampaigns as any[])) {
        campaignMap.set(String(c.campaignId), { id: c.id });
      }

      // 2. 预加载adGroups: amazonAdGroupId -> localAdGroup
      const allAdGroups = await db
        .select({ id: adGroups.id, adGroupId: adGroups.adGroupId })
        .from(adGroups)
        // @ts-ignore
        .where(eq((adGroups as unknown).accountId, this.accountId));
      const adGroupMap = new Map<string, { id: number }>();
      for (const ag of allAdGroups) {
        adGroupMap.set(String(ag.adGroupId), { id: ag.id });
      }

      // 3. 预加载keywords: adGroupId:keywordText -> keyword
      const allKeywords = await db
        .select({ id: keywords.id, adGroupId: keywords.adGroupId, keywordText: keywords.keywordText, matchType: keywords.matchType })
        .from(keywords)
        // @ts-ignore
        .where(eq((keywords as unknown).accountId, this.accountId));
      const keywordMap = new Map<string, { id: number; matchType: string | null }>();
      for (const kw of (allKeywords as any[])) {
        const key = `${kw.adGroupId}:${(kw.keywordText || '').toLowerCase()}`;
        keywordMap.set(key, { id: kw.id, matchType: kw.matchType });
      }

      // 4. 预加载productTargets: adGroupId:targetValue -> target
      const allTargets = await db
        .select({ id: productTargets.id, adGroupId: productTargets.adGroupId, targetValue: productTargets.targetValue, targetMatchType: productTargets.targetMatchType })
        .from(productTargets)
        // @ts-ignore
        .where(eq((productTargets as unknown).accountId, this.accountId));
      const targetMap = new Map<string, { id: number; targetMatchType: string | null }>();
      for (const t of allTargets) {
        const key = `${t.adGroupId}:${(t.targetValue || '').toLowerCase()}`;
        targetMap.set(key, { id: t.id, targetMatchType: t.targetMatchType });
      }

      // 5. 预加载已有搜索词: amazonCampaignId:adGroupLocalId:searchTerm -> existing
      // v353修复: existingMap key统一使用Amazon campaignId (与写入时一致)
      const allSearchTerms = await db
        .select({ id: searchTerms.id, campaignId: searchTerms.campaignId, adGroupId: searchTerms.adGroupId, searchTerm: searchTerms.searchTerm })
        .from(searchTerms)
        .where(eq(searchTerms.accountId, this.accountId));
      const existingMap = new Map<string, number>();
      for (const st of allSearchTerms) {
        const key = `${st.campaignId}:${st.adGroupId}:${(st.searchTerm || '').toLowerCase()}`;
        existingMap.set(key, st.id);
      }

      log.info(`v196: 预加载完成 - campaigns=${allCampaigns.length}, adGroups=${allAdGroups.length}, keywords=${allKeywords.length}, targets=${allTargets.length}, existingSearchTerms=${allSearchTerms.length}`);

      let synced = 0;
      let skipped = 0;
      const BATCH_SIZE = 500;
      let upsertBatch: any[] = [];
      const nowStr = new Date().toISOString().slice(0, 19).replace('T', ' ');

      for (const row of (reportData as any[])) {
        // 查找对应的campaign（从Ma查找，O(1)）
        const campaign = campaignMap.get(String(row.campaignId));
        if (!campaign) { skipped++; continue; }

        // 查找对应的adGroup（从Ma查找，O(1)）
        const adGroup = adGroupMap.get(String(row.adGroupId));
        if (!adGroup) { skipped++; continue; }

        const cost = row.cost || 0;
        const sales = row.sales7d || row.sales14d || 0;
        const clicks = row.clicks || 0;
        const impressions = row.impressions || 0;
        const orders = row.purchases7d || row.purchases14d || 0;

        const targetingText = row.targeting || row.keyword || '';
        const keywordType = (row.keywordType || row.matchType || '').toLowerCase();
        const isProductTarget = keywordType === 'targeting';
        
        // 尝试关联到本地投放词记录（从Ma查找，O(1)）
        let searchTermTargetId: number | null = null;
        let resolvedMatchType = keywordType;
        if (!isProductTarget) {
          const kwKey = `${adGroup.id}:${targetingText.toLowerCase()}`;
          const matchedKeyword = keywordMap.get(kwKey);
          if (matchedKeyword) {
            searchTermTargetId = matchedKeyword.id;
            resolvedMatchType = matchedKeyword.matchType || keywordType;
          }
        } else {
          const tKey = `${adGroup.id}:${targetingText.toLowerCase()}`;
          const matchedTarget = targetMap.get(tKey);
          if (matchedTarget) {
            searchTermTargetId = matchedTarget.id;
            resolvedMatchType = matchedTarget.targetMatchType || 'targeting';
          }
        }

        const searchTermText = row.searchTerm || '';
        const isAsinSearchTerm = /^[Bb]0[A-Za-z0-9]{8,}$/.test(searchTermText.trim());
        const searchTermType = isAsinSearchTerm ? 'asin' : 'keyword';
        const sourceMatchType = resolvedMatchType;
        const sourceTargetType = isProductTarget ? 'product_target' : 'keyword';
        const unitsOrdered = row.unitsSold7d || row.unitsSold14d || row.unitsSold || row.unitsSoldClicks || 0;

        // v383: 使用每行的具体日期（Amazon报告使timeUnit=DAILY，每行都有date字段）
        // 而不是使用整个请求范围的startDate/endDate
        const rowDate = row.date || startDate;

        const searchTermData = {
          accountId: this.accountId,
          campaignId: (campaign as Record<string, any>).campaignId,
          adGroupId: String(adGroup.id),  // v357: adGroupId现在是varchar类型
          searchTerm: searchTermText,
          searchTermTargetType: isProductTarget ? 'product_target' as const : 'keyword' as const,
          searchTermTargetId,
          targetText: targetingText,
          searchTermMatchType: resolvedMatchType,
          searchTermImpressions: impressions,
          searchTermClicks: clicks,
          searchTermSpend: String(cost),
          searchTermSales: String(sales),
          searchTermOrders: orders,
          searchTermAcos: sales > 0 ? String((cost / sales) * 100) : null,
          searchTermRoas: cost > 0 ? String(sales / cost) : null,
          searchTermCtr: impressions > 0 ? String(clicks / impressions) : null,
          searchTermCvr: clicks > 0 ? String(orders / clicks) : null,
          searchTermCpc: clicks > 0 ? String(cost / clicks) : null,
          // v383: reportStartDate和reportEndDate都使用行级别的具体日期
          reportStartDate: rowDate,
          reportEndDate: rowDate,
          sourceMatchType: sourceMatchType,
          sourceTargetType: sourceTargetType,
          searchTermType: searchTermType,
          searchTermUnitsOrdered: unitsOrdered,
          updatedAt: nowStr,
        };

        // v383: 收集到批量数组，后续统一执行UPSERT
        upsertBatch.push({
          ...searchTermData,
          createdAt: nowStr,
        });

        // v383: 每500条执行一次批量UPSERT
        if (upsertBatch.length >= BATCH_SIZE) {
          await flushSearchTermBatch(db, upsertBatch);
          synced += upsertBatch.length;
          upsertBatch = [];
        }
      }

      // v383: flush剩余的批量数据
      if (upsertBatch.length > 0) {
        await flushSearchTermBatch(db, upsertBatch);
        synced += upsertBatch.length;
        upsertBatch = [];
      }

      log.info(`v196: 搜索词同步完成: 同步=${synced}, 跳过=${skipped} (无匹配campaign/adGroup)`);
      return synced;
    } catch (error) {
      log.error('v196: 同步搜索词失败:', error);
      return 0;
    }
  };

/**
 * 同步SP自动定向数据
 * 获取自动广告的匹配组数据（紧密匹配、宽泛匹配、同类商品、关联商品）
 */
AmazonSyncService.prototype.syncAutoTargeting = async function(this: AmazonSyncService, days: number = 90): Promise<number> {
    const db = await getDb();
    if (!db) return 0;
    try {
      // v339: Amazon API单次请求最多31天，需要分批请求
      const MAX_DAYS_PER_REQUEST = 31;
      const totalDays = Math.min(days, 90);
      const { startDate: rangeStartDate, endDate: rangeEndDate } = getMarketplaceDateRange(this.marketplace, totalDays);
      const batches = Math.ceil(totalDays / MAX_DAYS_PER_REQUEST);
      log.info(`v339: 开始同步SP自动定向数据: 共${totalDays}天，分${batches}批请求 (站点: ${this.marketplace})`);

      // v413: 批量提交+统一轮询模式（替代串行循环）
      let allReportData: any[] = [];
      if (batches === 1) {
        try {
          const reportId = await this.client.requestSpAutoTargetingReport(rangeStartDate, rangeEndDate);
          const data = await this.client.waitAndDownloadReport(reportId, 300000);
          if (data && data.length > 0) allReportData = data;
        } catch (e: unknown) {
          log.error(`v413: SP自动定向报告请求失败:`, (e as Error).message);
        }
      } else {
        const batchRequests: Array<{ name: string; requestFn: () => Promise<string> }> = [];
        for (let batch = 0; batch < batches; batch++) {
          const endDateObj = new Date(rangeEndDate);
          endDateObj.setDate(endDateObj.getDate() - (batch * MAX_DAYS_PER_REQUEST));
          const startDateObj = new Date(endDateObj);
          const daysInBatch = Math.min(MAX_DAYS_PER_REQUEST, totalDays - (batch * MAX_DAYS_PER_REQUEST));
          startDateObj.setDate(startDateObj.getDate() - daysInBatch + 1);
          const bStart = startDateObj.toISOString().split('T')[0];
          const bEnd = endDateObj.toISOString().split('T')[0];
          batchRequests.push({
            name: `SP自动定向第${batch + 1}/${batches}批(${bStart}~${bEnd})`,
            requestFn: () => this.client.requestSpAutoTargetingReport(bStart, bEnd),
          });
        }
        log.info(`[v413] SP自动定向: ${batches}批次批量提交开始`);
        const results = await this.client.submitAndWaitMultipleReports(batchRequests, 300000, 2000);
        for (const result of results) {
          if (result.data && result.data.length > 0) {
            allReportData = allReportData.concat(result.data);
          } else if (result.error) {
            log.warn(`[v413] ${result.name}失败: ${result.error}`);
          }
        }
      }

      const reportData = allReportData;
      if (!reportData || reportData.length === 0) {
        log.debug('v339: 所有批次自动定向报告数据为空');
        return 0;
      }
      log.info(`v339: 共获取到 ${reportData.length} 条自动定向数据（${batches}批合并）`);
      let synced = 0;

      // v401: 预加载adGroups Map，消除N+1查询（之前每行都查一次adGroups表）
      const allAdGroups = await db
        .select({ id: adGroups.id, adGroupId: adGroups.adGroupId, campaignId: adGroups.campaignId })
        .from(adGroups)
        // @ts-ignore
        .where(eq((adGroups as unknown).accountId, this.accountId));
      const adGroupMap = new Map<string, { id: number; campaignId: string | null }>();
      for (const ag of allAdGroups) {
        adGroupMap.set(String(ag.adGroupId), { id: ag.id, campaignId: ag.campaignId });
      }

      // v401: 预加载已有productTargets Map，消除N+1查询（之前每行都查一次productTargets表）
      const allExistingTargets = await db
        .select({ id: productTargets.id, adGroupId: productTargets.adGroupId, targetId: productTargets.targetId })
        .from(productTargets)
        .where(eq(productTargets.accountId, this.accountId));
      const existingTargetMap = new Map<string, number>();
      for (const t of allExistingTargets) {
        existingTargetMap.set(`${t.adGroupId}:${t.targetId}`, t.id);
      }
      log.info(`v401: 自动定向预加载完成 - adGroups=${allAdGroups.length}, existingTargets=${allExistingTargets.length}`);

      // v401: 收集批量UPSERT数据
      const BATCH_SIZE = 200;
      let upsertBatch: any[] = [];
      const nowStr = new Date().toISOString().slice(0, 19).replace('T', ' ');

      for (const row of (reportData as any[])) {
        // 只处理自动定向数据
        if (row.targetingType !== 'AUTO') continue;

        // v401: 从预加载Map查找adGroup（O(1)，替代之前的数据库查询）
        const adGroup = adGroupMap.get(String(row.adGroupId));
        if (!adGroup) continue;

        const cost = row.cost || 0;
        // 自动定向报告使用14天归因窗口（SB/SD类型）
        const sales = row.sales14d || row.salesClicks14d || 0;
        const clicks = row.clicks || 0;
        const impressions = row.impressions || 0;
        const orders = row.purchases14d || row.purchasesClicks14d || 0;

        // 解析自动定向类型
        const targetingExpression = row.targetingExpression || '';
        let targetType: 'asin' | 'category' = 'category';
        let targetValue = targetingExpression;
        
        // 自动定向类型: close-match, loose-match, substitutes, complements
        if (targetingExpression.includes('close-match')) {
          targetValue = 'CLOSE_MATCH';
        } else if (targetingExpression.includes('loose-match')) {
          targetValue = 'LOOSE_MATCH';
        } else if (targetingExpression.includes('substitutes')) {
          targetValue = 'SUBSTITUTES';
        } else if (targetingExpression.includes('complements')) {
          targetValue = 'COMPLEMENTS';
        }

        // v401: 从预加载Map检查是否已存在（O(1)，替代之前的数据库查询）
        const existingKey = `${String(adGroup.id)}:${String(row.targetId)}`;
        const existingId = existingTargetMap.get(existingKey);

        const targetData = {
          accountId: this.accountId,
          adGroupId: String(adGroup.id),
          campaignId: adGroup.campaignId || '',
          targetId: String(row.targetId),
          targetType,
          targetValue,
          targetExpression: targetingExpression,
          bid: '0.00',
          impressions: Number(impressions),
          clicks: Number(clicks),
          spend: String(cost),
          sales: String(sales),
          orders: Number(orders),
          targetAcos: sales > 0 ? String(((cost / sales) * 100).toFixed(2)) : null,
          targetRoas: cost > 0 && sales > 0 ? String((sales / cost).toFixed(2)) : null,
          targetCtr: impressions > 0 ? String((clicks / impressions).toFixed(4)) : null,
          targetCvr: clicks > 0 ? String((orders / clicks).toFixed(4)) : null,
          targetCpc: clicks > 0 ? String((cost / clicks).toFixed(2)) : null,
          targetStatus: 'enabled' as const,
          updatedAt: nowStr,
        };

        if (existingId) {
          // v401: 批量更新 - 收集后批量执行
          await db
            .update(productTargets)
            .set(targetData)
            .where(eq(productTargets.id, existingId));
        } else {
          upsertBatch.push({
            ...targetData,
            createdAt: nowStr,
          });
          // v401: 批量INSERT
          if (upsertBatch.length >= BATCH_SIZE) {
            await db.insert(productTargets).values(upsertBatch);
            synced += upsertBatch.length;
            upsertBatch = [];
          }
        }
        if (existingId) synced++;
      }
      // v401: 刷新剩余批次
      if (upsertBatch.length > 0) {
        await db.insert(productTargets).values(upsertBatch);
        synced += upsertBatch.length;
      }

      log.info(`自动定向同步完成: ${synced} 条记录`);
      return synced;
    } catch (error) {
      log.error('同步自动定向失败:', error);
      return 0;
    }
  };

/**
 * 完整同步所有广告数据
 * 包括广告活动、广告组、投放词、搜索词、位置绩效
 */
AmazonSyncService.prototype.syncAllAdData = async function(this: AmazonSyncService, days: number = 90): Promise<{
    campaigns: number;
    adGroups: number;
    keywords: number;
    targets: number;
    searchTerms: number;
    placements: number;
  }> {
    const results = {
      campaigns: 0,
      adGroups: 0,
      keywords: 0,
      targets: 0,
      searchTerms: 0,
      placements: 0,
    };

    try {
      log.info(`开始完整同步所有广告数据 (${days}天)`);

      // 1. 同步广告活动
      const spResult = await this.syncSpCampaigns();
      const sbResult = await this.syncSbCampaigns();
      const sdResult = await this.syncSdCampaigns();
      // @ts-ignore
      results.campaigns = (typeof spResult === 'number' ? spResult : spResult.synced) +
                         // @ts-ignore
                         (typeof sbResult === 'number' ? sbResult : sbResult.synced) +
                         // @ts-ignore
                         (typeof sdResult === 'number' ? sdResult : sdResult.synced);

      // 2. 同步广告组（SP + SB + SD）
      const adGroupResult = await this.syncSpAdGroups();
      // @ts-ignore
      results.adGroups = typeof adGroupResult === 'number' ? adGroupResult : adGroupResult.synced;
      try {
        const sbAdGroupResult = await this.syncSbAdGroups();
        // @ts-ignore
        results.adGroups += sbAdGroupResult.synced;
      } catch (e: unknown) { log.error('[SyncAllAd] SB广告组同步失败:', (e as Error).message); }
      try {
        const sdAdGroupResult = await this.syncSdAdGroups();
        // @ts-ignore
        results.adGroups += sdAdGroupResult.synced;
      } catch (e: unknown) { log.error('[SyncAllAd] SD广告组同步失败:', (e as Error).message); }

      // 3. 同步投放词（SP + SB）
      const keywordResult = await this.syncSpKeywords();
      // @ts-ignore
      results.keywords = typeof keywordResult === 'number' ? keywordResult : keywordResult.synced;
      try {
        const sbKeywordResult = await this.syncSbKeywords();
        // @ts-ignore
        results.keywords += sbKeywordResult.synced;
      } catch (e: unknown) { log.error('[SyncAllAd] SB关键词同步失败:', (e as Error).message); }

      // 4. 同步商品定向（SP + SB + SD）
      const targetResult = await this.syncSpProductTargets();
      // @ts-ignore
      results.targets = typeof targetResult === 'number' ? targetResult : targetResult.synced;
      try {
        const sbPtResult = await this.syncSbProductTargets();
        // @ts-ignore
        results.targets += sbPtResult.synced;
      } catch (e: unknown) { log.error('[SyncAllAd] SB商品定向同步失败:', (e as Error).message); }
      try {
        const sdPtResult = await this.syncSdProductTargets();
        // @ts-ignore
        results.targets += sdPtResult.synced;
      } catch (e: unknown) { log.error('[SyncAllAd] SD商品定向同步失败:', (e as Error).message); }

      // 5. 同步自动定向
      const autoTargetResult = await this.syncAutoTargeting(days);
      results.targets += autoTargetResult;

      // 6. 同步SD定向报告
      const sdTargetResult = await this.syncSdTargeting(days);
      // @ts-ignore
      results.targets += sdTargetResult;

      // 7. 同步SB定向报告
      const sbTargetResult = await this.syncSbTargeting(days);
      // @ts-ignore
      results.keywords += sbTargetResult;

      // 8. 同步否定关键词和否定商品定向
      try {
        const negKwResult = await this.syncSpNegativeKeywords();
        // @ts-ignore
        log.info(`[SyncAllAd] SP否定关键词: ${negKwResult.synced}新增, ${negKwResult.updated}更新`);
      } catch (e: unknown) { log.error('[SyncAllAd] SP否定关键词同步失败:', (e as Error).message); }
      try {
        const negPtResult = await this.syncSpNegativeProductTargets();
        // @ts-ignore
        log.info(`[SyncAllAd] SP否定商品定向: ${negPtResult.synced}新增, ${negPtResult.updated}更新`);
      } catch (e: unknown) { log.error('[SyncAllAd] SP否定商品定向同步失败:', (e as Error).message); }

      // 9. 同步搜索词（SP + SB）
      results.searchTerms = await this.syncSearchTerms(days);
      try {
        const sbStSynced = await this.syncSbSearchTerms(days);
        // @ts-ignore
        results.searchTerms += sbStSynced;
      } catch (e: unknown) { log.error('[SyncAllAd] SB搜索词同步失败:', (e as Error).message); }

      // 10. 同步位置绩效
      // @ts-ignore
      results.placements = await this.syncPlacementPerformance(days);

      log.info(`完整同步完成:`, results);
    } catch (error) {
      log.error('完整同步失败:', error);
    }

    return results;
  };

/**
 * 仅同步绩效数据（低频同步）
 * 用于获取历史绩效数据
 * 重要：默认14天归因回溯，确保数据与亚马逊后台一致
 */
AmazonSyncService.prototype.syncPerformanceOnly = async function(this: AmazonSyncService, days: number = 90): Promise<{
    performance: number;
    keywordPerf: number;
    targetPerf: number;
  }> {
    const results = {
      performance: 0,
      keywordPerf: 0,
      targetPerf: 0,
    };
    try {
      // @ts-ignore
      results.performance = await this.syncPerformanceData(days);
      log.info(`绩效数据同步完成: ${results.performance} 条记录`);
    } catch (error) {
      log.error('绩效数据同步失败:', error);
    }
    // v192: 同步关键词级别绩效数据（之前仅在syncAll中执行，导致keywords表绩效全为0）
    try {
      log.info(`开始同步关键词级别绩效数据（${days}天）...`);
      // @ts-ignore
      results.keywordPerf = await this.syncKeywordPerformanceData(days);
      log.info(`关键词绩效数据同步完成: ${results.keywordPerf}条`);
    } catch (kwPerfError: unknown) {
      log.error('关键词绩效数据同步失败:', (kwPerfError as Error).message);
    }
    // v192: 同步商品定位级别绩效数据
    try {
      log.info(`开始同步商品定位级别绩效数据（${days}天）...`);
      // @ts-ignore
      results.targetPerf = await this.syncProductTargetPerformanceData(days);
      log.info(`商品定位绩效数据同步完成: ${results.targetPerf}条`);
    } catch (ptPerfError: unknown) {
      log.error('商品定位绩效数据同步失败:', (ptPerfError as Error).message);
    }
    return results;
  };

/**
 * 解析SB广告组中的素材ID为实际URL
 * 查找所有有assetId但没有对应URL的广告组，调用Creative Asset Library API解析
 */
AmazonSyncService.prototype.syncAssetUrls = async function(this: AmazonSyncService): Promise<number> {
    const db = await getDb();
    if (!db) return 0;

    try {
      // 查找所有有素材ID但没有URL的SB广告组
      const adGroupsNeedingUrls = await db
        .select()
        .from(adGroups)
        .innerJoin(campaigns, eq(adGroups.campaignId, campaigns.campaignId))
        .where(
          and(
            eq(campaigns.accountId, this.accountId),
            sql`(${adGroups.videoAssetId} IS NOT NULL AND ${adGroups.videoAssetId} != '' AND (${adGroups.videoUrl} IS NULL OR ${adGroups.videoUrl} = ''))
              OR (${adGroups.brandLogoAssetId} IS NOT NULL AND ${adGroups.brandLogoAssetId} != '' AND (${adGroups.brandLogoUrl} IS NULL OR ${adGroups.brandLogoUrl} = ''))
              OR (${adGroups.customImageAssetId} IS NOT NULL AND ${adGroups.customImageAssetId} != '' AND (${adGroups.customImageUrl} IS NULL OR ${adGroups.customImageUrl} = ''))`
          )
        );

      if (adGroupsNeedingUrls.length === 0) {
        log.debug('所有SB广告组的素材URL已是最新');
        return 0;
      }

      log.debug(`找到 ${adGroupsNeedingUrls.length} 个需要解析素材URL的广告组`);

      // 收集所有需要解析的assetId
      const assetIdsToResolve = new Set<string>();
      for (const row of (adGroupsNeedingUrls as any[])) {
        if (row.ad_groups.videoAssetId && !row.ad_groups.videoUrl) {
          assetIdsToResolve.add(row.ad_groups.videoAssetId);
        }
        if (row.ad_groups.brandLogoAssetId && !row.ad_groups.brandLogoUrl) {
          assetIdsToResolve.add(row.ad_groups.brandLogoAssetId);
        }
        if (row.ad_groups.customImageAssetId && !row.ad_groups.customImageUrl) {
          assetIdsToResolve.add(row.ad_groups.customImageAssetId);
        }
      }

      log.debug(`需要解析 ${assetIdsToResolve.size} 个唯一素材ID`);

      // 批量解析素材URL
      const resolvedUrls = await this.client.resolveAssetUrls(Array.from(assetIdsToResolve));
      log.info(`成功解析 ${resolvedUrls.size} 个素材URL`);

      // 更新数据库
      let updated = 0;
      for (const row of (adGroupsNeedingUrls as any[])) {
        const updates: Record<string, any> = {};
        let needsUpdate = false;

        if (row.ad_groups.videoAssetId && !row.ad_groups.videoUrl) {
          const resolved = resolvedUrls.get(row.ad_groups.videoAssetId);
          if (resolved) {
            updates.videoUrl = resolved.url;
            if (resolved.thumbnailUrl) {
              updates.videoThumbnailUrl = resolved.thumbnailUrl;
            }
            needsUpdate = true;
          }
        }

        if (row.ad_groups.brandLogoAssetId && !row.ad_groups.brandLogoUrl) {
          const resolved = resolvedUrls.get(row.ad_groups.brandLogoAssetId);
          if (resolved) {
            updates.brandLogoUrl = resolved.url;
            needsUpdate = true;
          }
        }

        if (row.ad_groups.customImageAssetId && !row.ad_groups.customImageUrl) {
          const resolved = resolvedUrls.get(row.ad_groups.customImageAssetId);
          if (resolved) {
            updates.customImageUrl = resolved.url;
            needsUpdate = true;
          }
        }

        if (needsUpdate) {
          await db
            .update(adGroups)
            .set(updates)
            .where(eq(adGroups.id, row.ad_groups.id));
          updated++;
        }
      }

       return updated;
    } catch (error: unknown) {
      log.error('syncAssetUrls失败:', (error as Error).message);
      throw error;
    }
  };

// v223: 注册 SyncService 工厂函数，打破循环依赖
registerSyncServiceFactory((credentials, accountId, userId, marketplace) =>
  AmazonSyncService.createFromCredentials(credentials, accountId, userId, marketplace)
);

// v224: 子模块的 prototype 扩展已移至 services/sync/ 目录
// 入口点必须 import './services/sync/init' 以确保所有方法被注入到 AmazonSyncService.prototype
// runAutoBidOptimization 已移至 services/sync/autoBidOptimization.ts

/**
 * 首次同步：获取90天历史数据
 * 仅在账户首次连接时调用，用于填充历史数据
 * 后续定时同步只需要14天归因回溯
 */
export async function syncInitialHistoricalData(
  syncService: AmazonSyncService,
  accountId: number,
  userId: number
): Promise<{ performance: number }> {
  log.info(`开始首次同步90天历史数据 (账号: ${accountId})`);
  
  const results = {
    performance: 0,
  };

  try {
    // 首次同步获取90天历史数据（SP支持95天，SB只支持60天，取90天作为平衡）
    // @ts-ignore
    results.performance = await syncService.syncPerformanceData(90);
    log.info(`首次同步完成: ${results.performance} 条历史绩效记录`);
  } catch (error) {
    log.error('首次同步失败:', error);
  }

  return results;
}
