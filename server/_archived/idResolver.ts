/**
 * Amazon Ads Optimizer — Unified ID Resolver Service (v206)
 * 
 * 中央ID解析服务，提供：
 * 1. 双向查找：本地ID ↔ Amazon ID
 * 2. 内存缓存（TTL 1小时），减少重复DB查询
 * 3. 批量解析，减少N+1查询
 * 4. 运行时ID类型验证和自动纠正
 * 
 * ═══════════════════════════════════════════════════════════════════
 * 使用规则：
 * - 调用Amazon API前 → 必须通过此模块获取Amazon ID
 * - 更新本地DB前   → 必须通过此模块获取本地ID
 * - 跨表JOIN时     → 查阅 idTypes.ts 的 ID_DICTIONARY
 * ═══════════════════════════════════════════════════════════════════
 */

import { createModuleLogger } from './logger';
import {
  isValidAmazonId,
  classifyCampaignId,
  getCampaignAmazonId,
  getKeywordAmazonId,
  getTargetAmazonId,
  buildKeywordIdMap,
  buildTargetIdMap,
} from './idTypes';

const log = createModuleLogger('IdResolver');

// ==================== 缓存层 ====================

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

class IdCache<K, V> {
  private cache = new Map<string, CacheEntry<V>>();
  private ttlMs: number;
  private name: string;
  private hits = 0;
  private misses = 0;

  constructor(name: string, ttlMinutes: number = 60) {
    this.name = name;
    this.ttlMs = ttlMinutes * 60 * 1000;
  }

  get(key: K): V | undefined {
    const entry = this.cache.get(String(key));
    if (!entry) {
      this.misses++;
      return undefined;
    }
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(String(key));
      this.misses++;
      return undefined;
    }
    this.hits++;
    return entry.value;
  }

  set(key: K, value: V): void {
    this.cache.set(String(key), {
      value,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  invalidate(key: K): void {
    this.cache.delete(String(key));
  }

  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  getStats(): { name: string; size: number; hits: number; misses: number; hitRate: string } {
    const total = this.hits + this.misses;
    return {
      name: this.name,
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? `${((this.hits / total) * 100).toFixed(1)}%` : 'N/A',
    };
  }
}

// 缓存实例
const campaignLocalToAmazon = new IdCache<number, string>('campaign:local→amazon', 60);
const campaignAmazonToLocal = new IdCache<string, number>('campaign:amazon→local', 60);
const keywordLocalToAmazon = new IdCache<number, string>('keyword:local→amazon', 60);
const targetLocalToAmazon = new IdCache<number, string>('target:local→amazon', 60);

// ==================== 数据库访问（延迟导入避免循环依赖） ====================

async function getDbConnection() {
  // 延迟导入，避免循环依赖
  const { getDb } = await import('../db');
  return getDb();
}

async function getSchemaImports() {
  const schema = await import('../../drizzle/schema');
  const { eq, and } = await import('drizzle-orm');
  return { schema, eq, and };
}

// ==================== Campaign ID 解析 ====================

/**
 * 本地Campaign ID → Amazon Campaign ID
 * 
 * @param localCampaignId - campaigns.id (int)
 * @returns campaigns.campaignId (varchar) 即Amazon Campaign ID
 */
export async function resolveAmazonCampaignId(localCampaignId: number): Promise<string | null> {
  // 1. 检查缓存
  const cached = campaignLocalToAmazon.get(localCampaignId);
  if (cached) return cached;

  // 2. 查询DB
  try {
    const db = await getDbConnection();
    if (!db) return null;
    const { schema, eq } = await getSchemaImports();
    
    const [campaign] = await db
      .select({ campaignId: schema.campaigns.campaignId })
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, localCampaignId))
      .limit(1);

    if (campaign?.campaignId) {
      const amazonId = String(campaign.campaignId);
      // 双向缓存
      campaignLocalToAmazon.set(localCampaignId, amazonId);
      campaignAmazonToLocal.set(amazonId, localCampaignId);
      return amazonId;
    }
  } catch (err: unknown) {
    log.error(`[IdResolver] resolveAmazonCampaignId(${localCampaignId}) 失败: ${err.message}`);
  }
  return null;
}

/**
 * Amazon Campaign ID → 本地Campaign ID
 * 
 * @param amazonCampaignId - campaigns.campaignId (varchar)
 * @param accountId - 可选，用于缩小查询范围
 * @returns campaigns.id (int) 即本地主键
 */
export async function resolveLocalCampaignId(
  amazonCampaignId: string,
  accountId?: number
): Promise<number | null> {
  const amazonIdStr = String(amazonCampaignId).trim();
  
  // 1. 检查缓存
  const cached = campaignAmazonToLocal.get(amazonIdStr);
  if (cached) return cached;

  // 2. 查询DB
  try {
    const db = await getDbConnection();
    if (!db) return null;
    const { schema, eq, and } = await getSchemaImports();
    
    const conditions: unknown[] = [eq(schema.campaigns.campaignId, amazonIdStr)];
    if (accountId) {
      conditions.push(eq(schema.campaigns.accountId, accountId));
    }
    
    const [campaign] = await db
      .select({ id: schema.campaigns.id, campaignId: schema.campaigns.campaignId })
      .from(schema.campaigns)
      .where(and(...conditions))
      .limit(1);

    if (campaign) {
      // 双向缓存
      campaignAmazonToLocal.set(amazonIdStr, campaign.id);
      campaignLocalToAmazon.set(campaign.id, amazonIdStr);
      return campaign.id;
    }
  } catch (err: unknown) {
    log.error(`[IdResolver] resolveLocalCampaignId(${amazonIdStr}) 失败: ${err.message}`);
  }
  return null;
}

// ==================== Keyword ID 解析 ====================

/**
 * 本地Keyword ID → Amazon Keyword ID
 * 
 * @param localKeywordId - keywords.id (int)
 * @returns keywords.keywordId (varchar) 即Amazon Keyword ID，null表示尚未同步
 */
export async function resolveAmazonKeywordId(localKeywordId: number): Promise<string | null> {
  const cached = keywordLocalToAmazon.get(localKeywordId);
  if (cached) return cached;

  try {
    const db = await getDbConnection();
    if (!db) return null;
    const { schema, eq } = await getSchemaImports();
    
    const [kw] = await db
      .select({ keywordId: schema.keywords.keywordId })
      .from(schema.keywords)
      .where(eq(schema.keywords.id, localKeywordId))
      .limit(1);

    if (kw?.keywordId) {
      const amazonId = String(kw.keywordId);
      if (isValidAmazonId(amazonId)) {
        keywordLocalToAmazon.set(localKeywordId, amazonId);
        return amazonId;
      }
    }
  } catch (err: unknown) {
    log.error(`[IdResolver] resolveAmazonKeywordId(${localKeywordId}) 失败: ${err.message}`);
  }
  return null;
}

/**
 * 本地ProductTarget ID → Amazon Target ID
 */
export async function resolveAmazonTargetId(localTargetId: number): Promise<string | null> {
  const cached = targetLocalToAmazon.get(localTargetId);
  if (cached) return cached;

  try {
    const db = await getDbConnection();
    if (!db) return null;
    const { schema, eq } = await getSchemaImports();
    
    const [pt] = await db
      .select({ targetId: schema.productTargets.targetId })
      .from(schema.productTargets)
      .where(eq(schema.productTargets.id, localTargetId))
      .limit(1);

    if (pt?.targetId) {
      const amazonId = String(pt.targetId);
      if (isValidAmazonId(amazonId)) {
        targetLocalToAmazon.set(localTargetId, amazonId);
        return amazonId;
      }
    }
  } catch (err: unknown) {
    log.error(`[IdResolver] resolveAmazonTargetId(${localTargetId}) 失败: ${err.message}`);
  }
  return null;
}

// ==================== 批量解析 ====================

/**
 * 批量预热Campaign ID缓存
 * 在优化执行前调用，避免逐个查询
 */
export async function preloadCampaignIds(accountId: number): Promise<number> {
  try {
    const db = await getDbConnection();
    if (!db) return 0;
    const { schema, eq } = await getSchemaImports();
    
    const campaigns = await db
      .select({ id: schema.campaigns.id, campaignId: schema.campaigns.campaignId })
      .from(schema.campaigns)
      .where(eq(schema.campaigns.accountId, accountId));

    for (const c of campaigns) {
      const amazonId = String(c.campaignId);
      campaignLocalToAmazon.set(c.id, amazonId);
      campaignAmazonToLocal.set(amazonId, c.id);
    }

    log.debug(`[IdResolver] 预热Campaign ID缓存: accountId=${accountId}, 加载${campaigns.length}条`);
    return campaigns.length;
  } catch (err: unknown) {
    log.error(`[IdResolver] preloadCampaignIds 失败: ${err.message}`);
    return 0;
  }
}

/**
 * 批量预热Keyword ID缓存（按campaign的Amazon ID）
 */
export async function preloadKeywordIds(amazonCampaignId: string): Promise<number> {
  try {
    const db = await getDbConnection();
    if (!db) return 0;
    const { schema, eq } = await getSchemaImports();
    
    // keywords → adGroups → campaigns (通过Amazon campaignId)
    const adGroupsList = await db
      .select({ id: schema.adGroups.id })
      .from(schema.adGroups)
      .where(eq(schema.adGroups.campaignId, amazonCampaignId));

    let loaded = 0;
    for (const ag of adGroupsList) {
      const kws = await db
        .select({ id: schema.keywords.id, keywordId: schema.keywords.keywordId })
        .from(schema.keywords)
        .where(eq(schema.keywords.internalAdGroupId, ag.id));

      for (const kw of kws) {
        if (kw.keywordId && isValidAmazonId(String(kw.keywordId))) {
          keywordLocalToAmazon.set(kw.id, String(kw.keywordId));
          loaded++;
        }
      }
    }

    log.debug(`[IdResolver] 预热Keyword ID缓存: campaign=${amazonCampaignId}, 加载${loaded}条`);
    return loaded;
  } catch (err: unknown) {
    log.error(`[IdResolver] preloadKeywordIds 失败: ${err.message}`);
    return 0;
  }
}

// ==================== 智能campaignId参数处理 ====================

/**
 * 【核心函数】将调用者传入的campaignId参数安全转换为Amazon campaignId
 * 
 * 这是所有需要Amazon campaignId的查询函数的统一入口：
 * - 如果传入的已经是Amazon ID → 直接返回
 * - 如果传入的是本地int ID → 通过DB查找对应的Amazon ID
 * - 如果无法确定 → 尝试两种方式查找
 * 
 * @param value - 调用者传入的campaignId（可能是本地int或Amazon varchar）
 * @param context - 调用来源描述（用于日志）
 * @returns Amazon campaignId字符串
 */
export async function toAmazonCampaignId(
  value: string | number,
  context: string = 'unknown'
): Promise<string> {
  const str = String(value).trim();
  const classification = classifyCampaignId(value);

  if (classification === 'amazon') {
    // 已经是Amazon ID
    return str;
  }

  if (classification === 'local') {
    // 本地ID → 需要查DB转换
    log.warn(`[IdResolver] ⚠️ toAmazonCampaignId: 收到本地ID(${value}), 调用来源: ${context}. 正在转换为Amazon ID...`);
    const amazonId = await resolveAmazonCampaignId(Number(value));
    if (amazonId) {
      return amazonId;
    }
    log.error(`[IdResolver] ⛔ 无法将本地campaignId(${value})转换为Amazon ID! 调用来源: ${context}`);
    // 返回原值的字符串形式（可能导致下游查询返回空，但至少不会崩溃）
    return str;
  }

  // ambiguous → 尝试作为Amazon ID直接使用
  log.debug(`[IdResolver] campaignId(${value})类型不确定，按Amazon ID处理. 来源: ${context}`);
  return str;
}

// ==================== 缓存管理 ====================

/**
 * 清除所有ID缓存（用于数据同步后刷新）
 */
export function clearAllCaches(): void {
  campaignLocalToAmazon.clear();
  campaignAmazonToLocal.clear();
  keywordLocalToAmazon.clear();
  targetLocalToAmazon.clear();
  log.info(`[IdResolver] 所有ID缓存已清除`);
}

/**
 * 获取缓存统计信息
 */
export function getCacheStats() {
  return {
    campaigns: {
      localToAmazon: campaignLocalToAmazon.getStats(),
      amazonToLocal: campaignAmazonToLocal.getStats(),
    },
    keywords: keywordLocalToAmazon.getStats(),
    targets: targetLocalToAmazon.getStats(),
  };
}

// ==================== 导出idTypes中的工具函数（统一入口） ====================

export {
  isValidAmazonId,
  isValidLocalId,
  classifyCampaignId,
  getCampaignAmazonId,
  getCampaignLocalId,
  getAdGroupAmazonId,
  getKeywordAmazonId,
  getTargetAmazonId,
  buildKeywordIdMap,
  buildTargetIdMap,
  ensureAmazonCampaignId,
} from './idTypes';
