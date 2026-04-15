/**
 * v679: 统一自动优化权限检查中间件
 * 
 * 设计目标：
 * 1. 提供统一的API来检查campaign/keyword/target是否允许被自动操作
 * 2. 所有自动操作路径（正常优化、纠错监控、分时竞价等）都必须通过此中间件
 * 3. 带缓存的高性能实现，避免每次操作都查询数据库
 * 4. 记录所有被拦截的操作到审计日志
 * 
 * 使用方式：
 * ```typescript
 * import { AutoOptimizeGuard } from '../services/autoOptimizeGuard';
 * 
 * // 初始化（每次批量操作前调用一次）
 * const guard = await AutoOptimizeGuard.create(accountId);
 * 
 * // 检查单个campaign
 * if (!guard.isCampaignAllowed(campaignId)) {
 *   log.info(`Campaign ${campaignId} 的自动优化已关闭，跳过`);
 *   continue;
 * }
 * 
 * // 批量过滤
 * const allowedCampaigns = guard.filterAllowedCampaigns(campaignIds);
 * 
 * // 检查整个账户
 * if (guard.isAccountFullyDisabled()) {
 *   log.info(`账户 ${accountId} 所有优化目标已关闭，跳过`);
 *   return;
 * }
 * ```
 */

import { createModuleLogger } from '../utils/logger';
import { getDb } from '../db/connection';
import { performanceGroups, campaigns } from '../../drizzle/schema';
import { eq, and, inArray, or, sql } from 'drizzle-orm';
import { recordAudit } from './auditLogService';

const log = createModuleLogger('AutoOptimizeGuard');

// ==================== 缓存管理 ====================

interface AccountGuardCache {
  /** 缓存创建时间 */
  createdAt: number;
  /** 账户下所有已禁用自动优化的campaign IDs */
  disabledCampaignIds: Set<number>;
  /** 账户下所有已启用自动优化的campaign IDs */
  enabledCampaignIds: Set<number>;
  /** 账户是否完全禁用（所有PG都关闭了auto_optimize或status!=active） */
  fullyDisabled: boolean;
  /** 账户下的PG状态摘要 */
  pgSummary: Array<{
    pgId: number;
    pgName: string;
    autoOptimize: number;
    status: string;
    campaignCount: number;
  }>;
}

// 全局缓存，TTL 5分钟
const CACHE_TTL_MS = 5 * 60 * 1000;
const guardCache = new Map<number, AccountGuardCache>();

// 定期清理过期缓存
setInterval(() => {
  const now = Date.now();
  for (const [accountId, cache] of guardCache.entries()) {
    if (now - cache.createdAt > CACHE_TTL_MS) {
      guardCache.delete(accountId);
    }
  }
}, 60 * 1000); // 每分钟清理一次

// ==================== 核心类 ====================

export class AutoOptimizeGuard {
  private cache: AccountGuardCache;
  private accountId: number;
  private source: string;

  private constructor(accountId: number, cache: AccountGuardCache, source: string) {
    this.accountId = accountId;
    this.cache = cache;
    this.source = source;
  }

  /**
   * 创建Guard实例（带缓存）
   * @param accountId 账户ID
   * @param source 操作来源标识（用于审计日志），如 'auto_correction', 'optimization', 'dayparting'
   * @param forceRefresh 是否强制刷新缓存
   */
  static async create(accountId: number, source: string = 'unknown', forceRefresh: boolean = false): Promise<AutoOptimizeGuard> {
    const now = Date.now();
    const cached = guardCache.get(accountId);
    
    if (!forceRefresh && cached && (now - cached.createdAt < CACHE_TTL_MS)) {
      return new AutoOptimizeGuard(accountId, cached, source);
    }

    // 从数据库加载
    const cache = await AutoOptimizeGuard.loadFromDatabase(accountId);
    guardCache.set(accountId, cache);
    return new AutoOptimizeGuard(accountId, cache, source);
  }

  /**
   * 从数据库加载账户的auto_optimize状态
   */
  private static async loadFromDatabase(accountId: number): Promise<AccountGuardCache> {
    const db = await getDb();
    if (!db) {
      log.warn(`[AutoOptimizeGuard] 数据库不可用，默认允许所有操作`);
      return {
        createdAt: Date.now(),
        disabledCampaignIds: new Set(),
        enabledCampaignIds: new Set(),
        fullyDisabled: false,
        pgSummary: [],
      };
    }

    try {
      // 1. 获取账户下所有PG及其auto_optimize状态
      const pgs = await db.select({
        id: performanceGroups.id,
        name: performanceGroups.name,
        autoOptimize: performanceGroups.autoOptimize,
        status: performanceGroups.status,
      }).from(performanceGroups)
        .where(eq(performanceGroups.accountId, accountId));

      if (pgs.length === 0) {
        return {
          createdAt: Date.now(),
          disabledCampaignIds: new Set(),
          enabledCampaignIds: new Set(),
          fullyDisabled: false,
          pgSummary: [],
        };
      }

      // 2. 分类PG为启用/禁用
      const enabledPgIds: number[] = [];
      const disabledPgIds: number[] = [];
      const pgSummary: AccountGuardCache['pgSummary'] = [];

      for (const pg of pgs) {
        const isEnabled = pg.autoOptimize === 1 && pg.status === 'active';
        if (isEnabled) {
          enabledPgIds.push(pg.id);
        } else {
          disabledPgIds.push(pg.id);
        }
        pgSummary.push({
          pgId: pg.id,
          pgName: pg.name || `PG#${pg.id}`,
          autoOptimize: pg.autoOptimize ?? 1,
          status: pg.status || 'active',
          campaignCount: 0, // 后面填充
        });
      }

      // 3. 获取禁用PG下的campaign IDs
      const disabledCampaignIds = new Set<number>();
      if (disabledPgIds.length > 0) {
        const disabledCampaigns = await db.select({
          id: campaigns.id,
          pgId: campaigns.performanceGroupId,
        }).from(campaigns)
          .where(inArray(campaigns.performanceGroupId, disabledPgIds));
        
        for (const c of disabledCampaigns) {
          disabledCampaignIds.add(c.id);
          // 更新pgSummary中的campaignCount
          const pgEntry = pgSummary.find(p => p.pgId === c.pgId);
          if (pgEntry) pgEntry.campaignCount++;
        }
      }

      // 4. 获取启用PG下的campaign IDs
      const enabledCampaignIds = new Set<number>();
      if (enabledPgIds.length > 0) {
        const enabledCampaigns = await db.select({
          id: campaigns.id,
          pgId: campaigns.performanceGroupId,
        }).from(campaigns)
          .where(inArray(campaigns.performanceGroupId, enabledPgIds));
        
        for (const c of enabledCampaigns) {
          enabledCampaignIds.add(c.id);
          const pgEntry = pgSummary.find(p => p.pgId === c.pgId);
          if (pgEntry) pgEntry.campaignCount++;
        }
      }

      const fullyDisabled = enabledPgIds.length === 0;

      log.debug(`[AutoOptimizeGuard] 账户${accountId}: ${pgs.length}个PG, ${enabledPgIds.length}个启用, ${disabledPgIds.length}个禁用, ${disabledCampaignIds.size}个campaigns被排除`);

      return {
        createdAt: Date.now(),
        disabledCampaignIds,
        enabledCampaignIds,
        fullyDisabled,
        pgSummary,
      };
    } catch (err: any) {
      log.warn(`[AutoOptimizeGuard] 加载账户${accountId}状态失败: ${(err as Error).message}，默认允许所有操作`);
      return {
        createdAt: Date.now(),
        disabledCampaignIds: new Set(),
        enabledCampaignIds: new Set(),
        fullyDisabled: false,
        pgSummary: [],
      };
    }
  }

  // ==================== 检查方法 ====================

  /**
   * 检查整个账户是否完全禁用自动优化
   */
  isAccountFullyDisabled(): boolean {
    return this.cache.fullyDisabled;
  }

  /**
   * 检查单个campaign是否允许自动操作
   * 如果campaign不在任何PG中（未纳管），默认不允许自动操作
   */
  isCampaignAllowed(campaignId: number): boolean {
    if (this.cache.fullyDisabled) return false;
    if (this.cache.disabledCampaignIds.has(campaignId)) return false;
    // 如果campaign在启用的PG中，允许
    if (this.cache.enabledCampaignIds.has(campaignId)) return true;
    // 如果campaign不在任何PG中（未纳管），默认不允许自动操作
    return false;
  }

  /**
   * 批量过滤，返回允许自动操作的campaign IDs
   */
  filterAllowedCampaigns(campaignIds: number[]): number[] {
    if (this.cache.fullyDisabled) return [];
    return campaignIds.filter(id => this.isCampaignAllowed(id));
  }

  /**
   * 批量过滤，返回被禁止的campaign IDs
   */
  filterDisabledCampaigns(campaignIds: number[]): number[] {
    return campaignIds.filter(id => !this.isCampaignAllowed(id));
  }

  /**
   * 获取被禁用的campaign IDs集合
   */
  getDisabledCampaignIds(): Set<number> {
    return this.cache.disabledCampaignIds;
  }

  /**
   * 获取PG状态摘要（用于日志）
   */
  getPgSummary(): AccountGuardCache['pgSummary'] {
    return this.cache.pgSummary;
  }

  /**
   * 获取禁用的PG名称列表（用于日志）
   */
  getDisabledPgNames(): string[] {
    return this.cache.pgSummary
      .filter(pg => pg.autoOptimize !== 1 || pg.status !== 'active')
      .map(pg => pg.pgName);
  }

  /**
   * 记录被拦截的操作到审计日志
   */
  recordBlockedOperation(params: {
    operationType: string;
    campaignId?: number;
    entityType?: string;
    entityId?: string | number;
    entityName?: string;
    details?: string;
  }): void {
    recordAudit({
      action: 'optimization.auto_bid',
      accountId: this.accountId,
      entityType: params.entityType || 'campaign',
      entityId: params.entityId || params.campaignId,
      entityName: params.entityName,
      source: 'system',
      result: 'failure',
      errorMessage: `[AutoOptimizeGuard] 操作被拦截: ${params.operationType} | 来源: ${this.source} | 原因: 自动优化已关闭`,
      metadata: {
        blockedBy: 'autoOptimizeGuard',
        operationType: params.operationType,
        source: this.source,
        details: params.details,
      },
    });
  }

  // ==================== 静态工具方法 ====================

  /**
   * 清除指定账户的缓存（当用户修改auto_optimize设置时调用）
   */
  static invalidateCache(accountId: number): void {
    guardCache.delete(accountId);
    log.info(`[AutoOptimizeGuard] 已清除账户${accountId}的缓存`);
  }

  /**
   * 清除所有缓存
   */
  static invalidateAllCache(): void {
    guardCache.clear();
    log.info(`[AutoOptimizeGuard] 已清除所有缓存`);
  }

  /**
   * 获取缓存统计信息
   */
  static getCacheStats(): { size: number; accounts: number[] } {
    return {
      size: guardCache.size,
      accounts: Array.from(guardCache.keys()),
    };
  }
}

// ==================== 便捷函数 ====================

/**
 * 快速检查账户是否完全禁用自动优化
 * 适用于只需要做账户级别检查的场景
 */
export async function isAccountAutoOptimizeDisabled(accountId: number): Promise<boolean> {
  const guard = await AutoOptimizeGuard.create(accountId, 'quick_check');
  return guard.isAccountFullyDisabled();
}

/**
 * 快速过滤允许自动操作的campaign IDs
 * 适用于只需要做campaign级别过滤的场景
 */
export async function filterAutoOptimizeAllowedCampaigns(
  accountId: number, 
  campaignIds: number[],
  source: string = 'unknown'
): Promise<number[]> {
  const guard = await AutoOptimizeGuard.create(accountId, source);
  return guard.filterAllowedCampaigns(campaignIds);
}
