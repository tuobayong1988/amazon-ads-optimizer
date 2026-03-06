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
import { getDb } from './db';
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
} from '../drizzle/schema';
import { createModuleLogger } from './utils/logger';

const log = createModuleLogger('SyncService');
import {
  AmazonAdsApiClient,
  createAmazonAdsClient,
  AmazonApiCredentials,
  SpCampaign,
} from './amazonAdsApi';
import { calculateBidAdjustment, OptimizationTarget, PerformanceGroupConfig } from './bidOptimizer';
import { getMarketplaceDateRange, getMarketplaceCurrentDate, getMarketplaceYesterday, getMarketplaceHistoricalDateRange } from './utils/timezone';
import { getExchangeRateByMarketplace } from './services/exchangeRateService';
import { registerSyncServiceFactory } from './services/syncServiceProvider';

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
    
    const conditions: any[] = [
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
      .where(and(...conditions))
      .limit(1);
    
    return (result[0]?.count || 0) > 0;
  } catch (error) {
    // 查询失败时不阻塞同步，默认不保护（以API为准）
    log.warn('v150: 查询优化事件失败，默认以API为准:', (error as any).message);
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
          const fallbackKeywordIds = new Set(fallbackRows.map((r: any) => Number(r.kw_id)).filter(id => id > 0 && keywordIds.includes(id)));
          if (fallbackKeywordIds.size > 0) {
            log.debug(`v212: Fallback查询optimization_logs找到${fallbackKeywordIds.size}个需要保护的关键词`);
            for (const id of fallbackKeywordIds) protectedSet.add(id);
          }
        }
      } catch (fallbackErr) {
        log.warn('v212: Fallback查询optimization_logs失败:', (fallbackErr as any).message);
      }
    }
    
    log.info(`v212: 查询完成, 输入${keywordIds.length}个关键词, 保护${protectedSet.size}个`);
    return protectedSet;
  } catch (error) {
    log.error('v212: ❌ 批量查询优化关键词失败，保护机制降级！', (error as any).message);
    log.error('v212: 错误详情:', (error as any).stack?.substring(0, 300));
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
    log.error('v212: ❌ 批量查询优化广告活动失败:', (error as any).message);
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
    return new AmazonSyncService(client, accountId, userId, marketplace);
  }

  /**
   * 完整同步所有数据
   * 每次同步都获取60天历史数据（包含当日），确保数据完整性和归因窗口期数据准确
   */
  async syncAll(options?: { performanceDays?: number }): Promise<{
    campaigns: number;
    adGroups: number;
    keywords: number;
    targets: number;
    performance: number;
    spCampaigns?: number;
    sbCampaigns?: number;
    sdCampaigns?: number;
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
    };

    // 同步SP广告活动
    const spResult = await this.syncSpCampaigns();
    results.spCampaigns = typeof spResult === 'number' ? spResult : spResult.synced;
    results.campaigns += results.spCampaigns;
    
    // 同步SB广告活动
    const sbResult = await this.syncSbCampaigns();
    results.sbCampaigns = typeof sbResult === 'number' ? sbResult : sbResult.synced;
    results.campaigns += results.sbCampaigns;
    
    // 同步SD广告活动
    const sdResult = await this.syncSdCampaigns();
    results.sdCampaigns = typeof sdResult === 'number' ? sdResult : sdResult.synced;
    results.campaigns += results.sdCampaigns;
    
    // ==================== 同步广告组（SP + SB + SD） ====================
    const spAdGroupResult = await this.syncSpAdGroups();
    results.adGroups += typeof spAdGroupResult === 'number' ? spAdGroupResult : spAdGroupResult.synced;

    try {
      const sbAdGroupResult = await this.syncSbAdGroups();
      results.adGroups += sbAdGroupResult.synced;
    } catch (e: any) {
      log.error('SB广告组同步失败:', e.message);
    }

    try {
      const sdAdGroupResult = await this.syncSdAdGroups();
      results.adGroups += sdAdGroupResult.synced;
    } catch (e: any) {
      log.error('SD广告组同步失败:', e.message);
    }
    
    // ==================== 同步关键词投放（SP + SB） ====================
    const spKeywordResult = await this.syncSpKeywords();
    results.keywords += typeof spKeywordResult === 'number' ? spKeywordResult : spKeywordResult.synced;

    try {
      const sbKeywordResult = await this.syncSbKeywords();
      results.keywords += sbKeywordResult.synced;
    } catch (e: any) {
      log.error('SB关键词同步失败:', e.message);
    }
    
    // ==================== 同步商品定位（SP + SB + SD） ====================
    const spTargetResult = await this.syncSpProductTargets();
    results.targets += typeof spTargetResult === 'number' ? spTargetResult : spTargetResult.synced;

    try {
      const sbTargetResult = await this.syncSbProductTargets();
      results.targets += sbTargetResult.synced;
    } catch (e: any) {
      log.error('SB商品定位同步失败:', e.message);
    }

    try {
      const sdTargetResult = await this.syncSdProductTargets();
      results.targets += sdTargetResult.synced;
    } catch (e: any) {
      log.error('SD商品定位同步失败:', e.message);
    }

    // ==================== 同步否定关键词 ====================
    try {
      log.info(`开始同步SP否定关键词...`);
      const negResult = await this.syncSpNegativeKeywords();
      log.info(`SP否定关键词同步完成: ${negResult.synced}条新增, ${negResult.updated}条更新`);
    } catch (e: any) {
      log.error('SP否定关键词同步失败:', e.message);
    }
    // ==================== 同步SP否定商品定向 ====================
    try {
      log.info(`开始同步SP否定商品定向...`);
      const negPtResult = await this.syncSpNegativeProductTargets();
      log.info(`SP否定商品定向同步完成: ${negPtResult.synced}条新增, ${negPtResult.updated}条更新`);
    } catch (e: any) {
      log.error('SP否定商品定向同步失败:', e.message);
    }
    // ==================== 同步SP搜索词 ====================
    try {
      log.info(`开始同步SP搜索词数据...`);
      const spSearchTermSynced = await this.syncSearchTerms(90); // v337.2: SP搜索词扩展到90天
      log.info(`SP搜索词同步完成: ${spSearchTermSynced}条`);
    } catch (e: any) {
      log.error('SP搜索词同步失败:', e.message);
    }
    // ==================== 同步SB搜索词 ====================
    try {
      log.info(`开始同步SB搜索词数据...`);
      const sbSearchTermSynced = await this.syncSbSearchTerms(60); // v337.2: SB搜索词扩展到60天
      log.info(`SB搜索词同步完成: ${sbSearchTermSynced}条`);
    } catch (e: any) {
      log.error('SB搜索词同步失败:', e.message);
    }
    // ==================== 同步SB广告素材（品牌广告创意） ====================
    try {
      log.info(`开始同步SB广告素材...`);
      const sbAdsResult = await this.syncSbAds();
      log.info(`SB广告素材同步完成: ${sbAdsResult.synced}条同步, ${sbAdsResult.skipped}条跳过`);
    } catch (e: any) {
      log.error('SB广告素材同步失败:', e.message);
    }

    // ==================== 同步SB否定关键词 ====================
    try {
      log.info(`开始同步SB否定关键词...`);
      const sbNegKwResult = await this.syncSbNegativeKeywords();
      log.info(`SB否定关键词同步完成: ${sbNegKwResult.synced}条新增, ${sbNegKwResult.updated}条更新`);
    } catch (e: any) {
      log.error('SB否定关键词同步失败:', e.message);
    }

    // ==================== 同步SB否定商品定向 ====================
    try {
      log.info(`开始同步SB否定商品定向...`);
      const sbNegTgtResult = await this.syncSbNegativeTargets();
      log.info(`SB否定商品定向同步完成: ${sbNegTgtResult.synced}条新增, ${sbNegTgtResult.updated}条更新`);
    } catch (e: any) {
      log.error('SB否定商品定向同步失败:', e.message);
    }

    // ==================== 同步SP广告位绩效 ====================
    try {
      log.info(`开始同步SP广告位绩效数据...`);
      const placementSynced = await this.syncPlacementPerformance(90); // v337.2: SP广告位扩展到90天
      log.info(`SP广告位绩效同步完成: ${placementSynced}条`);
    } catch (e: any) {
      log.error('SP广告位绩效同步失败:', e.message);
    }

    // ==================== 同步SB广告位绩效 ====================
    try {
      log.info(`开始同步SB广告位绩效数据...`);
      const sbPlacementSynced = await this.syncSbPlacementPerformance(60); // v337.2: SB广告位扩展到60天
      log.info(`SB广告位绩效同步完成: ${sbPlacementSynced}条`);
    } catch (e: any) {
      log.error('SB广告位绩效同步失败:', e.message);
    }

    // ==================== 同步SP自动定向报告 ====================
    try {
      log.info(`开始同步SP自动定向报告数据...`);
      const autoTargetSynced = await this.syncAutoTargeting(90); // v337.2: SP自动定向扩展到90天
      log.info(`SP自动定向报告同步完成: ${autoTargetSynced}条`);
    } catch (e: any) {
      log.error('SP自动定向报告同步失败:', e.message);
    }

    // ==================== 同步SD定向报告 ====================
    try {
      log.info(`开始同步SD定向报告数据...`);
      const sdTargetSynced = await this.syncSdTargeting(90); // v337.2: SD定向扩展到90天
      log.info(`SD定向报告同步完成: ${sdTargetSynced}条`);
    } catch (e: any) {
      log.error('SD定向报告同步失败:', e.message);
    }

    // ==================== 同步SB定向报告 ====================
    try {
      log.info(`开始同步SB定向报告数据...`);
      const sbTargetSynced = await this.syncSbTargeting(60); // v337.2: SB定向扩展到60天
      log.info(`SB定向报告同步完成: ${sbTargetSynced}条`);
    } catch (e: any) {
      log.error('SB定向报告同步失败:', e.message);
    }
    
    // ==================== 解析SB素材Asset URL ====================
    try {
      log.info(`开始解析SB广告素材URL...`);
      const assetUrlsSynced = await this.syncAssetUrls();
      log.info(`SB素材URL解析完成: ${assetUrlsSynced}个广告组已更新`);
    } catch (e: any) {
      log.error('SB素材URL解析失败:', e.message);
    }

    // 同步绩效数据（快慢双轨架构：API只拉取T-1及之前的历史数据）
    // 重要：亚马逊的销售数据在7-14天内会变动（用户点击后过几天才买）
    // 因此每次同步都需要回溯过去14天的数据，覆盖旧记录
    // 这能确保存下来的数据和亚马逊后台最终结算的数据一致
    // v339: performanceDays支持外部传入，默认14天归因回溯
    // unifiedSyncEngine full tier会传入90天，常规同步保持14天
    const performanceDays = options?.performanceDays || 14;
    log.info(`v339: 同步最近${performanceDays}天历史绩效数据（归因回溯机制，覆盖旧记录）`);
    results.performance += await this.syncPerformanceData(performanceDays);

    // ✅ 修复P0-4/P1-1: 同步关键词级别绩效数据（之前缺失，导致keywords表绩效全为0）
    try {
      log.info(`开始同步关键词级别绩效数据...`);
      const keywordPerfSynced = await this.syncKeywordPerformanceData(performanceDays);
      log.info(`关键词绩效数据同步完成: ${keywordPerfSynced}条`);
    } catch (kwPerfError: any) {
      log.error('关键词绩效数据同步失败:', kwPerfError.message);
    }

    // ✅ 修复P1-2: 同步商品定位级别绩效数据
    try {
      log.info(`开始同步商品定位级别绩效数据...`);
      const targetPerfSynced = await this.syncProductTargetPerformanceData(performanceDays);
      log.info(`商品定位绩效数据同步完成: ${targetPerfSynced}条`);
    } catch (ptPerfError: any) {
      log.error('商品定位绩效数据同步失败:', ptPerfError.message);
    }

    // ✅ 同步广告组级别绩效数据（SP/SB/SD）
    try {
      log.info(`开始同步广告组级别绩效数据...`);
      const adGroupPerfSynced = await this.syncAdGroupPerformanceData(performanceDays);
      log.info(`广告组绩效数据同步完成: ${adGroupPerfSynced}条`);
    } catch (agPerfError: any) {
      log.error('广告组绩效数据同步失败:', agPerfError.message);
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
      results.spCampaigns = typeof spResult === 'number' ? spResult : spResult.synced;
      results.campaigns += results.spCampaigns;
    } catch (error: any) {
      log.error('SP广告活动同步失败:', error.message);
    }
    
    try {
      const sbResult = await this.syncSbCampaigns();
      results.sbCampaigns = typeof sbResult === 'number' ? sbResult : sbResult.synced;
      results.campaigns += results.sbCampaigns;
    } catch (error: any) {
      log.error('SB广告活动同步失败:', error.message);
    }
    
    try {
      const sdResult = await this.syncSdCampaigns();
      results.sdCampaigns = typeof sdResult === 'number' ? sdResult : sdResult.synced;
      results.campaigns += results.sdCampaigns;
    } catch (error: any) {
      log.error('SD广告活动同步失败:', error.message);
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
      results.adGroups += typeof spAdGroupResult === 'number' ? spAdGroupResult : spAdGroupResult.synced;
    } catch (e: any) {
      log.error('SP广告组同步失败:', e.message);
    }

    try {
      const sbAdGroupResult = await this.syncSbAdGroups();
      results.adGroups += sbAdGroupResult.synced;
    } catch (e: any) {
      log.error('SB广告组同步失败:', e.message);
    }

    try {
      const sdAdGroupResult = await this.syncSdAdGroups();
      results.adGroups += sdAdGroupResult.synced;
    } catch (e: any) {
      log.error('SD广告组同步失败:', e.message);
    }
    
    // ==================== 同步关键词投放（SP + SB） ====================
    try {
      const spKeywordResult = await this.syncSpKeywords();
      results.keywords += typeof spKeywordResult === 'number' ? spKeywordResult : spKeywordResult.synced;
    } catch (e: any) {
      log.error('SP关键词同步失败:', e.message);
    }

    try {
      const sbKeywordResult = await this.syncSbKeywords();
      results.keywords += sbKeywordResult.synced;
    } catch (e: any) {
      log.error('SB关键词同步失败:', e.message);
    }
    
    // ==================== 同步商品定位（SP + SB + SD） ====================
    try {
      const spTargetResult = await this.syncSpProductTargets();
      results.targets += typeof spTargetResult === 'number' ? spTargetResult : spTargetResult.synced;
    } catch (e: any) {
      log.error('SP商品定位同步失败:', e.message);
    }

    try {
      const sbTargetResult = await this.syncSbProductTargets();
      results.targets += sbTargetResult.synced;
    } catch (e: any) {
      log.error('SB商品定位同步失败:', e.message);
    }

    try {
      const sdTargetResult = await this.syncSdProductTargets();
      results.targets += sdTargetResult.synced;
    } catch (e: any) {
      log.error('SD商品定位同步失败:', e.message);
    }

    // v196: 中频同步时同时同步搜索词数据（7天窗口），确保搜索词数据不滞后
    try {
      log.info(`v196: 中频同步 - 开始同步SP搜索词数据(7天)...`);
      const spSearchTermSynced = await this.syncSearchTerms(7);
      log.info(`v196: 中频同步 - SP搜索词同步完成: ${spSearchTermSynced}条`);
    } catch (e: any) {
      log.error('v196: 中频同步 - SP搜索词同步失败:', e.message);
    }

    log.info(`全渠道广告组和定位同步完成: 广告组=${results.adGroups}, 关键词=${results.keywords}, 定位=${results.targets}`);

    return results;
  }

  /**
   * 同步搜索词数据
   * 使用Report API v3获取客户搜索词和绩效数据
   */
  async syncSearchTerms(days: number = 14): Promise<number> {
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

      // v339: 分批请求报告，合并所有批次的数据
      let allReportData: any[] = [];
      for (let batch = 0; batch < batches; batch++) {
        const endDateObj = new Date(rangeEndDate);
        endDateObj.setDate(endDateObj.getDate() - (batch * MAX_DAYS_PER_REQUEST));
        const startDateObj = new Date(endDateObj);
        const daysInBatch = Math.min(MAX_DAYS_PER_REQUEST, totalDays - (batch * MAX_DAYS_PER_REQUEST));
        startDateObj.setDate(startDateObj.getDate() - daysInBatch + 1);
        const batchStartDate = startDateObj.toISOString().split('T')[0];
        const batchEndDate = endDateObj.toISOString().split('T')[0];
        log.info(`v339: SP搜索词第${batch + 1}/${batches}批: ${batchStartDate} - ${batchEndDate} (共${daysInBatch}天)`);
        try {
          const reportId = await this.client.requestSpSearchTermReport(batchStartDate, batchEndDate);
          const reportData = await this.client.waitAndDownloadReport(reportId, 300000);
          if (reportData && reportData.length > 0) {
            allReportData = allReportData.concat(reportData);
            log.info(`v339: 第${batch + 1}批获取到 ${reportData.length} 条数据`);
          } else {
            log.debug(`v339: 第${batch + 1}批数据为空`);
          }
          // 批次之间延迟，避免触发API速率限制
          if (batch < batches - 1) {
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        } catch (batchError: any) {
          log.error(`v339: SP搜索词第${batch + 1}批请求失败:`, batchError.message);
          // 继续下一批，不中断整个同步
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
      for (const c of allCampaigns) {
        campaignMap.set(String(c.campaignId), { id: c.id });
      }

      // 2. 预加载adGroups: amazonAdGroupId -> localAdGroup
      const allAdGroups = await db
        .select({ id: adGroups.id, adGroupId: adGroups.adGroupId })
        .from(adGroups)
        .where(eq((adGroups as any).accountId, this.accountId));
      const adGroupMap = new Map<string, { id: number }>();
      for (const ag of allAdGroups) {
        adGroupMap.set(String(ag.adGroupId), { id: ag.id });
      }

      // 3. 预加载keywords: adGroupId:keywordText -> keyword
      const allKeywords = await db
        .select({ id: keywords.id, adGroupId: keywords.adGroupId, keywordText: keywords.keywordText, matchType: keywords.matchType })
        .from(keywords)
        .where(eq((keywords as any).accountId, this.accountId));
      const keywordMap = new Map<string, { id: number; matchType: string | null }>();
      for (const kw of allKeywords) {
        const key = `${kw.adGroupId}:${(kw.keywordText || '').toLowerCase()}`;
        keywordMap.set(key, { id: kw.id, matchType: kw.matchType });
      }

      // 4. 预加载productTargets: adGroupId:targetValue -> target
      const allTargets = await db
        .select({ id: productTargets.id, adGroupId: productTargets.adGroupId, targetValue: productTargets.targetValue, targetMatchType: productTargets.targetMatchType })
        .from(productTargets)
        .where(eq((productTargets as any).accountId, this.accountId));
      const targetMap = new Map<string, { id: number; targetMatchType: string | null }>();
      for (const t of allTargets) {
        const key = `${t.adGroupId}:${(t.targetValue || '').toLowerCase()}`;
        targetMap.set(key, { id: t.id, targetMatchType: t.targetMatchType });
      }

      // 5. 预加载已有搜索词: accountId:campaignLocalId:adGroupLocalId:searchTerm -> existing
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

      for (const row of reportData) {
        // 查找对应的campaign（从Map查找，O(1)）
        const campaign = campaignMap.get(String(row.campaignId));
        if (!campaign) { skipped++; continue; }

        // 查找对应的adGroup（从Map查找，O(1)）
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
        
        // 尝试关联到本地投放词记录（从Map查找，O(1)）
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

        const searchTermData = {
          accountId: this.accountId,
          campaignId: (campaign as any).campaignId,
          adGroupId: adGroup.id,
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
          reportStartDate: startDate,
          reportEndDate: endDate,
          sourceMatchType: sourceMatchType,
          sourceTargetType: sourceTargetType,
          searchTermType: searchTermType,
          searchTermUnitsOrdered: unitsOrdered,
          updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
        };

        // 检查是否已存在（从Map查找，O(1)）
        const existingKey = `${campaign.id}:${adGroup.id}:${searchTermText.toLowerCase()}`;
        const existingId = existingMap.get(existingKey);

        if (existingId) {
          await db
            .update(searchTerms)
            .set(searchTermData)
            .where(eq(searchTerms.id, existingId));
        } else {
          await db.insert(searchTerms).values({
            ...searchTermData,
            createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
          });
        }
        synced++;
      }

      log.info(`v196: 搜索词同步完成: 同步=${synced}, 跳过=${skipped} (无匹配campaign/adGroup)`);
      return synced;
    } catch (error) {
      log.error('v196: 同步搜索词失败:', error);
      return 0;
    }
  }

  /**
   * 同步SP自动定向数据
   * 获取自动广告的匹配组数据（紧密匹配、宽泛匹配、同类商品、关联商品）
   */
  async syncAutoTargeting(days: number = 14): Promise<number> {
    const db = await getDb();
    if (!db) return 0;
    try {
      // v339: Amazon API单次请求最多31天，需要分批请求
      const MAX_DAYS_PER_REQUEST = 31;
      const totalDays = Math.min(days, 90);
      const { startDate: rangeStartDate, endDate: rangeEndDate } = getMarketplaceDateRange(this.marketplace, totalDays);
      const batches = Math.ceil(totalDays / MAX_DAYS_PER_REQUEST);
      log.info(`v339: 开始同步SP自动定向数据: 共${totalDays}天，分${batches}批请求 (站点: ${this.marketplace})`);

      let allReportData: any[] = [];
      for (let batch = 0; batch < batches; batch++) {
        const endDateObj = new Date(rangeEndDate);
        endDateObj.setDate(endDateObj.getDate() - (batch * MAX_DAYS_PER_REQUEST));
        const startDateObj = new Date(endDateObj);
        const daysInBatch = Math.min(MAX_DAYS_PER_REQUEST, totalDays - (batch * MAX_DAYS_PER_REQUEST));
        startDateObj.setDate(startDateObj.getDate() - daysInBatch + 1);
        const batchStartDate = startDateObj.toISOString().split('T')[0];
        const batchEndDate = endDateObj.toISOString().split('T')[0];
        log.info(`v339: SP自动定向第${batch + 1}/${batches}批: ${batchStartDate} - ${batchEndDate} (共${daysInBatch}天)`);
        try {
          const reportId = await this.client.requestSpAutoTargetingReport(batchStartDate, batchEndDate);
          const batchData = await this.client.waitAndDownloadReport(reportId, 300000);
          if (batchData && batchData.length > 0) {
            allReportData = allReportData.concat(batchData);
            log.info(`v339: 第${batch + 1}批获取到 ${batchData.length} 条数据`);
          }
          if (batch < batches - 1) await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (batchError: any) {
          log.error(`v339: SP自动定向第${batch + 1}批请求失败:`, batchError.message);
        }
      }

      const reportData = allReportData;
      if (!reportData || reportData.length === 0) {
        log.debug('v339: 所有批次自动定向报告数据为空');
        return 0;
      }
      log.info(`v339: 共获取到 ${reportData.length} 条自动定向数据（${batches}批合并）`);;
      let synced = 0;

      for (const row of reportData) {
        // 只处理自动定向数据
        if (row.targetingType !== 'AUTO') continue;

        // 查找对应的adGroup
        const [adGroup] = await db
          .select()
          .from(adGroups)
          .where(eq(adGroups.adGroupId, String(row.adGroupId)))
          .limit(1);

        if (!adGroup) continue;

        // 检查是否已存在
        const [existing] = await db
          .select()
          .from(productTargets)
          .where(
            and(
              eq(productTargets.adGroupId, adGroup.id),
              eq(productTargets.targetId, String(row.targetId))
            )
          )
          .limit(1);

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

        const targetData = {
          adGroupId: adGroup.id,
          campaignId: Number(adGroup.campaignId),
          targetId: String(row.targetId),
          targetType,
          targetValue,
          targetExpression: targetingExpression,
          bid: '0.00', // 自动定向没有单独的出价
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
          updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
        };

        if (existing) {
          await db
            .update(productTargets)
            .set(targetData)
            .where(eq(productTargets.id, existing.id));
        } else {
          await db.insert(productTargets).values({
            ...targetData,
            createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
          });
        }
        synced++;
      }

      log.info(`自动定向同步完成: ${synced} 条记录`);
      return synced;
    } catch (error) {
      log.error('同步自动定向失败:', error);
      return 0;
    }
  }

  /**
   * 完整同步所有广告数据
   * 包括广告活动、广告组、投放词、搜索词、位置绩效
   */
  async syncAllAdData(days: number = 14): Promise<{
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
      results.campaigns = (typeof spResult === 'number' ? spResult : spResult.synced) +
                         (typeof sbResult === 'number' ? sbResult : sbResult.synced) +
                         (typeof sdResult === 'number' ? sdResult : sdResult.synced);

      // 2. 同步广告组（SP + SB + SD）
      const adGroupResult = await this.syncSpAdGroups();
      results.adGroups = typeof adGroupResult === 'number' ? adGroupResult : adGroupResult.synced;
      try {
        const sbAdGroupResult = await this.syncSbAdGroups();
        results.adGroups += sbAdGroupResult.synced;
      } catch (e: any) { log.error('[SyncAllAd] SB广告组同步失败:', e.message); }
      try {
        const sdAdGroupResult = await this.syncSdAdGroups();
        results.adGroups += sdAdGroupResult.synced;
      } catch (e: any) { log.error('[SyncAllAd] SD广告组同步失败:', e.message); }

      // 3. 同步投放词（SP + SB）
      const keywordResult = await this.syncSpKeywords();
      results.keywords = typeof keywordResult === 'number' ? keywordResult : keywordResult.synced;
      try {
        const sbKeywordResult = await this.syncSbKeywords();
        results.keywords += sbKeywordResult.synced;
      } catch (e: any) { log.error('[SyncAllAd] SB关键词同步失败:', e.message); }

      // 4. 同步商品定向（SP + SB + SD）
      const targetResult = await this.syncSpProductTargets();
      results.targets = typeof targetResult === 'number' ? targetResult : targetResult.synced;
      try {
        const sbPtResult = await this.syncSbProductTargets();
        results.targets += sbPtResult.synced;
      } catch (e: any) { log.error('[SyncAllAd] SB商品定向同步失败:', e.message); }
      try {
        const sdPtResult = await this.syncSdProductTargets();
        results.targets += sdPtResult.synced;
      } catch (e: any) { log.error('[SyncAllAd] SD商品定向同步失败:', e.message); }

      // 5. 同步自动定向
      const autoTargetResult = await this.syncAutoTargeting(days);
      results.targets += autoTargetResult;

      // 6. 同步SD定向报告
      const sdTargetResult = await this.syncSdTargeting(days);
      results.targets += sdTargetResult;

      // 7. 同步SB定向报告
      const sbTargetResult = await this.syncSbTargeting(days);
      results.keywords += sbTargetResult;

      // 8. 同步否定关键词和否定商品定向
      try {
        const negKwResult = await this.syncSpNegativeKeywords();
        log.info(`[SyncAllAd] SP否定关键词: ${negKwResult.synced}新增, ${negKwResult.updated}更新`);
      } catch (e: any) { log.error('[SyncAllAd] SP否定关键词同步失败:', e.message); }
      try {
        const negPtResult = await this.syncSpNegativeProductTargets();
        log.info(`[SyncAllAd] SP否定商品定向: ${negPtResult.synced}新增, ${negPtResult.updated}更新`);
      } catch (e: any) { log.error('[SyncAllAd] SP否定商品定向同步失败:', e.message); }

      // 9. 同步搜索词（SP + SB）
      results.searchTerms = await this.syncSearchTerms(days);
      try {
        const sbStSynced = await this.syncSbSearchTerms(days);
        results.searchTerms += sbStSynced;
      } catch (e: any) { log.error('[SyncAllAd] SB搜索词同步失败:', e.message); }

      // 10. 同步位置绩效
      results.placements = await this.syncPlacementPerformance(days);

      log.info(`完整同步完成:`, results);
    } catch (error) {
      log.error('完整同步失败:', error);
    }

    return results;
  }

  /**
   * 仅同步绩效数据（低频同步）
   * 用于获取历史绩效数据
   * 
   * 重要：默认14天归因回溯，确保数据与亚马逊后台一致
   */
  async syncPerformanceOnly(days: number = 14): Promise<{
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
      results.performance = await this.syncPerformanceData(days);
      log.info(`绩效数据同步完成: ${results.performance} 条记录`);
    } catch (error) {
      log.error('绩效数据同步失败:', error);
    }
    // v192: 同步关键词级别绩效数据（之前仅在syncAll中执行，导致keywords表绩效全为0）
    try {
      log.info(`开始同步关键词级别绩效数据（${days}天）...`);
      results.keywordPerf = await this.syncKeywordPerformanceData(days);
      log.info(`关键词绩效数据同步完成: ${results.keywordPerf}条`);
    } catch (kwPerfError: any) {
      log.error('关键词绩效数据同步失败:', kwPerfError.message);
    }
    // v192: 同步商品定位级别绩效数据
    try {
      log.info(`开始同步商品定位级别绩效数据（${days}天）...`);
      results.targetPerf = await this.syncProductTargetPerformanceData(days);
      log.info(`商品定位绩效数据同步完成: ${results.targetPerf}条`);
    } catch (ptPerfError: any) {
      log.error('商品定位绩效数据同步失败:', ptPerfError.message);
    }
    return results;
  }

  /**
   * 解析SB广告组中的素材ID为实际URL
   * 查找所有有assetId但没有对应URL的广告组，调用Creative Asset Library API解析
   */
  async syncAssetUrls(): Promise<number> {
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
      for (const row of adGroupsNeedingUrls) {
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
      for (const row of adGroupsNeedingUrls) {
        const updates: any = {};
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
    } catch (error: any) {
      log.error('syncAssetUrls失败:', error.message);
      throw error;
    }
  }
}

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
    results.performance = await syncService.syncPerformanceData(90);
    log.info(`首次同步完成: ${results.performance} 条历史绩效记录`);
  } catch (error) {
    log.error('首次同步失败:', error);
  }

  return results;
}
