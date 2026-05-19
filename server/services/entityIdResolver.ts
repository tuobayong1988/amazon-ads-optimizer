/**
 * Amazon Ads Optimizer — Centralized Entity ID Resolver (v418)
 * 
 * 集中式实体ID解析服务，统一处理内部ID与Amazon ID之间的双向转换。
 * 
 * ═══════════════════════════════════════════════════════════════════
 * 设计目标：
 * 
 * 1. 提供单一入口处理所有ID转换需求，降低新功能开发中出错的风险
 * 2. 内置缓存层，避免重复数据库查询
 * 3. 严格的类型安全，编译时防止ID混用
 * 4. 完整的错误处理和日志记录
 * 
 * 使用场景：
 * - 向Amazon API发送请求前：内部ID → Amazon ID
 * - 从Amazon API接收数据后：Amazon ID → 内部ID
 * - 跨表JOIN时：确认正确的ID类型
 * ═══════════════════════════════════════════════════════════════════
 * 
 * ID体系说明（v418重构后）：
 * 
 * | 表名             | 字段                 | 类型       | 存储内容          |
 * |------------------|----------------------|------------|-------------------|
 * | campaigns        | id                   | int (auto) | 内部自增ID        |
 * | campaigns        | campaignId           | varchar    | Amazon Campaign ID|
 * | adGroups         | id                   | int (auto) | 内部自增ID        |
 * | adGroups         | adGroupId            | varchar    | Amazon AdGroup ID |
 * | adGroups         | campaignId           | varchar    | Amazon Campaign ID|
 * | keywords         | id                   | int (auto) | 内部自增ID        |
 * | keywords         | keywordId            | varchar    | Amazon Keyword ID |
 * | keywords         | internalAdGroupId    | int        | adGroups.id       |
 * | productTargets   | id                   | int (auto) | 内部自增ID        |
 * | productTargets   | targetId             | varchar    | Amazon Target ID  |
 * | productTargets   | internalAdGroupId    | int        | adGroups.id       |
 * | searchTerms      | internalAdGroupId    | int        | adGroups.id       |
 * | negativeKeywords | internalAdGroupId    | int        | adGroups.id       |
 */

import { createModuleLogger } from '../utils/logger';
import { isValidAmazonId } from '../utils/idTypes';

const log = createModuleLogger('EntityIdResolver');

// ==================== 类型定义 ====================

/** 实体类型枚举 */
export type EntityType = 'campaign' | 'adGroup' | 'keyword' | 'productTarget' | 'negativeKeyword';

/** ID解析结果 */
export interface ResolvedIds {
  internalId: number;
  amazonId: string;
  entityType: EntityType;
  /** 关联的Amazon Campaign ID（如果适用） */
  amazonCampaignId?: string;
  /** 关联的Amazon AdGroup ID（如果适用） */
  amazonAdGroupId?: string;
  /** 关联的内部AdGroup ID（如果适用） */
  internalAdGroupId?: number;
}

/** 批量解析结果 */
export interface BatchResolveResult {
  resolved: Map<number, ResolvedIds>;
  failed: number[];
  errors: string[];
}

// ==================== 缓存层 ====================

interface CacheEntry<T> {
  value: T;
  timestamp: number;
}

class IdCache<K, V> {
  private cache = new Map<string, CacheEntry<V>>();
  private ttlMs: number;

  constructor(ttlMs: number = 10 * 60 * 1000) {
    this.ttlMs = ttlMs;
  }

  get(key: K): V | undefined {
    const strKey = String(key);
    const entry = this.cache.get(strKey);
    if (!entry) return undefined;
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(strKey);
      return undefined;
    }
    return entry.value;
  }

  set(key: K, value: V): void {
    this.cache.set(String(key), { value, timestamp: Date.now() });
  }

  invalidate(key: K): void {
    this.cache.delete(String(key));
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

// 各实体类型的缓存：内部ID → 完整解析结果
const campaignCache = new IdCache<number, ResolvedIds>();
const adGroupCache = new IdCache<number, ResolvedIds>();
const keywordCache = new IdCache<number, ResolvedIds>();
const productTargetCache = new IdCache<number, ResolvedIds>();

// Amazon ID → 内部ID 的反向缓存
const reverseCampaignCache = new IdCache<string, number>();
const reverseAdGroupCache = new IdCache<string, number>();
const reverseKeywordCache = new IdCache<string, number>();
const reverseTargetCache = new IdCache<string, number>();

// ==================== 数据库查询提供者 ====================

let _dbProvider: DbQueryProvider | null = null;

export interface DbQueryProvider {
  /** 通过内部ID查询campaign */
  getCampaignByInternalId(id: number): Promise<{ id: number; campaignId: string; campaignName?: string } | null>;
  /** 通过Amazon campaignId查询campaign */
  getCampaignByAmazonId(amazonId: string): Promise<{ id: number; campaignId: string; campaignName?: string } | null>;
  /** 通过内部ID查询adGroup */
  getAdGroupByInternalId(id: number): Promise<{ id: number; adGroupId: string; campaignId: string } | null>;
  /** 通过Amazon adGroupId查询adGroup */
  getAdGroupByAmazonId(amazonId: string): Promise<{ id: number; adGroupId: string; campaignId: string } | null>;
  /** 通过内部ID查询keyword */
  getKeywordByInternalId(id: number): Promise<{ id: number; keywordId: string | null; internalAdGroupId: number } | null>;
  /** 通过内部ID查询productTarget */
  getProductTargetByInternalId(id: number): Promise<{ id: number; targetId: string | null; internalAdGroupId: number } | null>;
  /** 批量查询keywords */
  getKeywordsByInternalIds(ids: number[]): Promise<Array<{ id: number; keywordId: string | null; internalAdGroupId: number }>>;
  /** 批量查询productTargets */
  getProductTargetsByInternalIds(ids: number[]): Promise<Array<{ id: number; targetId: string | null; internalAdGroupId: number }>>;
}

/**
 * 初始化EntityIdResolver的数据库查询提供者
 * 必须在应用启动时调用一次
 */
export function initEntityIdResolver(provider: DbQueryProvider): void {
  _dbProvider = provider;
  log.info('EntityIdResolver initialized with database provider');
}

function getDb(): DbQueryProvider {
  if (!_dbProvider) {
    throw new Error('EntityIdResolver not initialized. Call initEntityIdResolver() first.');
  }
  return _dbProvider;
}

// ==================== 核心解析方法 ====================

/**
 * 解析Campaign的内部ID → Amazon ID
 * 
 * @param internalId - campaigns.id (内部自增ID)
 * @returns 完整的ID解析结果，包含Amazon campaignId
 * @throws 如果campaign不存在
 */
export async function resolveCampaignId(internalId: number): Promise<ResolvedIds> {
  // 检查缓存
  const cached = campaignCache.get(internalId);
  if (cached) return cached;

  const db = getDb();
  const campaign = await db.getCampaignByInternalId(internalId);
  if (!campaign) {
    throw new Error(`Campaign not found: internalId=${internalId}`);
  }

  const result: ResolvedIds = {
    internalId: campaign.id,
    amazonId: campaign.campaignId,
    entityType: 'campaign',
    amazonCampaignId: campaign.campaignId,
  };

  // 更新缓存
  campaignCache.set(internalId, result);
  reverseCampaignCache.set(campaign.campaignId, campaign.id);

  return result;
}

/**
 * 解析AdGroup的内部ID → Amazon ID
 * 
 * @param internalId - adGroups.id (内部自增ID)
 * @returns 完整的ID解析结果，包含Amazon adGroupId和campaignId
 */
export async function resolveAdGroupId(internalId: number): Promise<ResolvedIds> {
  const cached = adGroupCache.get(internalId);
  if (cached) return cached;

  const db = getDb();
  const adGroup = await db.getAdGroupByInternalId(internalId);
  if (!adGroup) {
    throw new Error(`AdGroup not found: internalId=${internalId}`);
  }

  const result: ResolvedIds = {
    internalId: adGroup.id,
    amazonId: adGroup.adGroupId,
    entityType: 'adGroup',
    amazonAdGroupId: adGroup.adGroupId,
    amazonCampaignId: adGroup.campaignId,
    internalAdGroupId: adGroup.id,
  };

  adGroupCache.set(internalId, result);
  reverseAdGroupCache.set(adGroup.adGroupId, adGroup.id);

  return result;
}

/**
 * 解析Keyword的内部ID → Amazon ID
 * 自动解析关联的AdGroup和Campaign的Amazon ID
 * 
 * @param internalId - keywords.id (内部自增ID)
 * @returns 完整的ID解析结果，包含Amazon keywordId、adGroupId、campaignId
 */
export async function resolveKeywordId(internalId: number): Promise<ResolvedIds> {
  const cached = keywordCache.get(internalId);
  if (cached) return cached;

  const db = getDb();
  const keyword = await db.getKeywordByInternalId(internalId);
  if (!keyword) {
    throw new Error(`Keyword not found: internalId=${internalId}`);
  }

  if (!keyword.keywordId) {
    throw new Error(`Keyword Amazon ID not available: internalId=${internalId}, keywordId is null`);
  }

  // 自动解析关联的AdGroup
  let amazonAdGroupId: string | undefined;
  let amazonCampaignId: string | undefined;
  if (keyword.internalAdGroupId) {
    try {
      const adGroupResolved = await resolveAdGroupId(keyword.internalAdGroupId);
      amazonAdGroupId = adGroupResolved.amazonAdGroupId;
      amazonCampaignId = adGroupResolved.amazonCampaignId;
    } catch (e: any) {
      log.warn(`Failed to resolve adGroup for keyword ${internalId}: ${(e as Error).message}`);
    }
  }

  const result: ResolvedIds = {
    internalId: keyword.id,
    amazonId: keyword.keywordId,
    entityType: 'keyword',
    amazonAdGroupId,
    amazonCampaignId,
    internalAdGroupId: keyword.internalAdGroupId,
  };

  keywordCache.set(internalId, result);
  reverseKeywordCache.set(keyword.keywordId, keyword.id);

  return result;
}

/**
 * 解析ProductTarget的内部ID → Amazon ID
 * 自动解析关联的AdGroup和Campaign的Amazon ID
 * 
 * @param internalId - productTargets.id (内部自增ID)
 * @returns 完整的ID解析结果
 */
export async function resolveProductTargetId(internalId: number): Promise<ResolvedIds> {
  const cached = productTargetCache.get(internalId);
  if (cached) return cached;

  const db = getDb();
  const target = await db.getProductTargetByInternalId(internalId);
  if (!target) {
    throw new Error(`ProductTarget not found: internalId=${internalId}`);
  }

  if (!target.targetId) {
    throw new Error(`ProductTarget Amazon ID not available: internalId=${internalId}, targetId is null`);
  }

  let amazonAdGroupId: string | undefined;
  let amazonCampaignId: string | undefined;
  if (target.internalAdGroupId) {
    try {
      const adGroupResolved = await resolveAdGroupId(target.internalAdGroupId);
      amazonAdGroupId = adGroupResolved.amazonAdGroupId;
      amazonCampaignId = adGroupResolved.amazonCampaignId;
    } catch (e: any) {
      log.warn(`Failed to resolve adGroup for productTarget ${internalId}: ${(e as Error).message}`);
    }
  }

  const result: ResolvedIds = {
    internalId: target.id,
    amazonId: target.targetId,
    entityType: 'productTarget',
    amazonAdGroupId,
    amazonCampaignId,
    internalAdGroupId: target.internalAdGroupId,
  };

  productTargetCache.set(internalId, result);
  reverseTargetCache.set(target.targetId, target.id);

  return result;
}

// ==================== 反向解析方法 ====================

/**
 * 从Amazon Campaign ID解析内部ID
 */
export async function resolveAmazonCampaignId(amazonId: string): Promise<number> {
  const cached = reverseCampaignCache.get(amazonId);
  if (cached !== undefined) return cached;

  const db = getDb();
  const campaign = await db.getCampaignByAmazonId(amazonId);
  if (!campaign) {
    throw new Error(`Campaign not found: amazonId=${amazonId}`);
  }

  reverseCampaignCache.set(amazonId, campaign.id);
  return campaign.id;
}

/**
 * 从Amazon AdGroup ID解析内部ID
 */
export async function resolveAmazonAdGroupId(amazonId: string): Promise<number> {
  const cached = reverseAdGroupCache.get(amazonId);
  if (cached !== undefined) return cached;

  const db = getDb();
  const adGroup = await db.getAdGroupByAmazonId(amazonId);
  if (!adGroup) {
    throw new Error(`AdGroup not found: amazonId=${amazonId}`);
  }

  reverseAdGroupCache.set(amazonId, adGroup.id);
  return adGroup.id;
}

// ==================== 批量解析方法 ====================

/**
 * 批量解析Keyword的内部ID → Amazon ID
 * 适用于出价批量调整等场景
 */
export async function batchResolveKeywordIds(internalIds: number[]): Promise<BatchResolveResult> {
  const result: BatchResolveResult = {
    resolved: new Map(),
    failed: [],
    errors: [],
  };

  // 先从缓存中获取
  const uncachedIds: number[] = [];
  for (const id of internalIds) {
    const cached = keywordCache.get(id);
    if (cached) {
      result.resolved.set(id, cached);
    } else {
      uncachedIds.push(id);
    }
  }

  if (uncachedIds.length === 0) return result;

  // 批量查询数据库
  const db = getDb();
  const keywords = await db.getKeywordsByInternalIds(uncachedIds);
  const keywordMap = new Map(keywords.map(k => [k.id, k]));

  for (const id of uncachedIds) {
    const keyword = keywordMap.get(id);
    if (!keyword || !keyword.keywordId) {
      result.failed.push(id);
      result.errors.push(`Keyword ${id}: ${!keyword ? 'not found' : 'Amazon ID is null'}`);
      continue;
    }

    try {
      // 解析关联的AdGroup
      let amazonAdGroupId: string | undefined;
      let amazonCampaignId: string | undefined;
      if (keyword.internalAdGroupId) {
        try {
          const adGroupResolved = await resolveAdGroupId(keyword.internalAdGroupId);
          amazonAdGroupId = adGroupResolved.amazonAdGroupId;
          amazonCampaignId = adGroupResolved.amazonCampaignId;
        } catch { /* ignore */ }
      }

      const resolved: ResolvedIds = {
        internalId: keyword.id,
        amazonId: keyword.keywordId,
        entityType: 'keyword',
        amazonAdGroupId,
        amazonCampaignId,
        internalAdGroupId: keyword.internalAdGroupId,
      };

      keywordCache.set(id, resolved);
      reverseKeywordCache.set(keyword.keywordId, id);
      result.resolved.set(id, resolved);
    } catch (e: any) {
      result.failed.push(id);
      result.errors.push(`Keyword ${id}: ${(e as Error).message}`);
    }
  }

  return result;
}

/**
 * 批量解析ProductTarget的内部ID → Amazon ID
 */
export async function batchResolveProductTargetIds(internalIds: number[]): Promise<BatchResolveResult> {
  const result: BatchResolveResult = {
    resolved: new Map(),
    failed: [],
    errors: [],
  };

  const uncachedIds: number[] = [];
  for (const id of internalIds) {
    const cached = productTargetCache.get(id);
    if (cached) {
      result.resolved.set(id, cached);
    } else {
      uncachedIds.push(id);
    }
  }

  if (uncachedIds.length === 0) return result;

  const db = getDb();
  const targets = await db.getProductTargetsByInternalIds(uncachedIds);
  const targetMap = new Map(targets.map(t => [t.id, t]));

  for (const id of uncachedIds) {
    const target = targetMap.get(id);
    if (!target || !target.targetId) {
      result.failed.push(id);
      result.errors.push(`ProductTarget ${id}: ${!target ? 'not found' : 'Amazon ID is null'}`);
      continue;
    }

    try {
      let amazonAdGroupId: string | undefined;
      let amazonCampaignId: string | undefined;
      if (target.internalAdGroupId) {
        try {
          const adGroupResolved = await resolveAdGroupId(target.internalAdGroupId);
          amazonAdGroupId = adGroupResolved.amazonAdGroupId;
          amazonCampaignId = adGroupResolved.amazonCampaignId;
        } catch { /* ignore */ }
      }

      const resolved: ResolvedIds = {
        internalId: target.id,
        amazonId: target.targetId,
        entityType: 'productTarget',
        amazonAdGroupId,
        amazonCampaignId,
        internalAdGroupId: target.internalAdGroupId,
      };

      productTargetCache.set(id, resolved);
      reverseTargetCache.set(target.targetId, id);
      result.resolved.set(id, resolved);
    } catch (e: any) {
      result.failed.push(id);
      result.errors.push(`ProductTarget ${id}: ${(e as Error).message}`);
    }
  }

  return result;
}

// ==================== 安全包装方法 ====================

/**
 * 安全地获取Amazon Campaign ID
 * 如果解析失败，返回 'UNRESOLVED' 而非抛出异常
 * 适用于日志写入等不应因ID解析失败而中断的场景
 */
export async function safeResolveAmazonCampaignId(
  internalId: number | null | undefined,
  fallbackAdGroupInternalId?: number | null
): Promise<string> {
  // 尝试直接解析
  if (internalId && internalId > 0) {
    try {
      const resolved = await resolveCampaignId(internalId);
      return resolved.amazonId;
    } catch { /* fall through */ }
  }

  // 通过AdGroup间接解析
  if (fallbackAdGroupInternalId && fallbackAdGroupInternalId > 0) {
    try {
      const adGroupResolved = await resolveAdGroupId(fallbackAdGroupInternalId);
      if (adGroupResolved.amazonCampaignId) {
        return adGroupResolved.amazonCampaignId;
      }
    } catch { /* fall through */ }
  }

  log.warn(`Failed to resolve Amazon Campaign ID: internalId=${internalId}, fallbackAdGroupId=${fallbackAdGroupInternalId}`);
  return 'UNRESOLVED';
}

/**
 * 安全地获取Amazon AdGroup ID
 */
export async function safeResolveAmazonAdGroupId(
  internalAdGroupId: number | null | undefined
): Promise<string> {
  if (!internalAdGroupId || internalAdGroupId <= 0) {
    return 'UNRESOLVED';
  }

  try {
    const resolved = await resolveAdGroupId(internalAdGroupId);
    return resolved.amazonId;
  } catch {
    log.warn(`Failed to resolve Amazon AdGroup ID: internalId=${internalAdGroupId}`);
    return 'UNRESOLVED';
  }
}

/**
 * 安全地获取Amazon Keyword ID
 */
export async function safeResolveAmazonKeywordId(
  internalKeywordId: number | null | undefined
): Promise<string> {
  if (!internalKeywordId || internalKeywordId <= 0) {
    return 'UNRESOLVED';
  }

  try {
    const resolved = await resolveKeywordId(internalKeywordId);
    return resolved.amazonId;
  } catch {
    log.warn(`Failed to resolve Amazon Keyword ID: internalId=${internalKeywordId}`);
    return 'UNRESOLVED';
  }
}

// ==================== 工具方法 ====================

/**
 * 验证一个ID是否是有效的Amazon ID格式
 * 用于在发送API请求前进行预检
 */
export function validateAmazonId(id: string | number | null | undefined, entityType: EntityType): boolean {
  if (id === null || id === undefined) return false;
  const strId = String(id);
  // @ts-ignore Dynamic type assertion
  if (!isValidAmazonId(strId as unknown)) {
    log.warn(`Invalid Amazon ${entityType} ID: "${strId}"`);
    return false;
  }
  return true;
}

/**
 * 清除所有缓存
 * 在数据同步完成后调用，确保缓存数据是最新的
 */
export function clearAllCaches(): void {
  campaignCache.clear();
  adGroupCache.clear();
  keywordCache.clear();
  productTargetCache.clear();
  reverseCampaignCache.clear();
  reverseAdGroupCache.clear();
  reverseKeywordCache.clear();
  reverseTargetCache.clear();
  log.info('All EntityIdResolver caches cleared');
}

/**
 * 获取缓存统计信息
 */
export function getCacheStats(): Record<string, number> {
  return {
    campaigns: campaignCache.size,
    adGroups: adGroupCache.size,
    keywords: keywordCache.size,
    productTargets: productTargetCache.size,
    reverseCampaigns: reverseCampaignCache.size,
    reverseAdGroups: reverseAdGroupCache.size,
    reverseKeywords: reverseKeywordCache.size,
    reverseTargets: reverseTargetCache.size,
  };
}
