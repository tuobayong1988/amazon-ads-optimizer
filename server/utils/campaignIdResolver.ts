/**
 * Amazon Ads Optimizer — Campaign ID Resolver (v222)
 * 
 * 本模块是 campaignId 数据完整性的最终防线。
 * 
 * ═══════════════════════════════════════════════════════════════════
 * 设计原则：
 * 
 * 1. 所有写入 bidding_logs 和 optimization_events 的 campaignId
 *    必须经过本模块的 safeCampaignIdForInsert() 函数
 * 
 * 2. 当传入的 campaignId 无效（0, '', null, undefined, 本地ID）时，
 *    自动通过 adGroupId → adGroup.campaignId 链路解析正确的 Amazon ID
 * 
 * 3. 如果所有解析路径都失败，写入 'UNRESOLVED' 标记而非 0，
 *    便于后续追踪和修复
 * 
 * 4. 本模块依赖 db.ts 的查询函数，因此不能被 idTypes.ts 引用
 *    （idTypes.ts 是底层模块，不能有数据库依赖）
 * ═══════════════════════════════════════════════════════════════════
 */

import { createModuleLogger } from './logger';
import { classifyCampaignId, isValidAmazonId } from './idTypes';

const log = createModuleLogger('CampaignIdResolver');

// ==================== 缓存层 ====================
// adGroupId(int) → Amazon campaignId(string) 的内存缓存
// 避免每次写入都查询数据库
const adGroupToCampaignCache = new Map<number, string>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10分钟缓存过期
const cacheTimestamps = new Map<number, number>();

function getCachedCampaignId(adGroupId: number): string | undefined {
  const ts = cacheTimestamps.get(adGroupId);
  if (ts && Date.now() - ts < CACHE_TTL_MS) {
    return adGroupToCampaignCache.get(adGroupId);
  }
  // 过期清理
  adGroupToCampaignCache.delete(adGroupId);
  cacheTimestamps.delete(adGroupId);
  return undefined;
}

function setCachedCampaignId(adGroupId: number, campaignId: string): void {
  adGroupToCampaignCache.set(adGroupId, campaignId);
  cacheTimestamps.set(adGroupId, Date.now());
  // 防止缓存无限增长
  if (adGroupToCampaignCache.size > 5000) {
    const oldestKey = adGroupToCampaignCache.keys().next().value;
    if (oldestKey !== undefined) {
      adGroupToCampaignCache.delete(oldestKey);
      cacheTimestamps.delete(oldestKey);
    }
  }
}

// ==================== 解析上下文 ====================

/**
 * 解析上下文 — 提供尽可能多的线索帮助解析 campaignId
 */
export interface CampaignIdContext {
  /** 原始 campaignId 值（可能是 0, null, 本地ID 等） */
  campaignId?: string | number | null;
  /** keyword 或 productTarget 的本地 ID */
  targetLocalId?: number | null;
  /** 目标类型（keyword 或 product_target） */
  targetType?: 'keyword' | 'product_target' | string;
  /** adGroup 的本地 ID */
  adGroupId?: number | null;
  /** 调用来源（用于日志追踪） */
  caller: string;
}

// ==================== 核心解析函数 ====================

/**
 * 安全的 campaignId 写入函数 — 所有 INSERT bidding_logs/optimization_events 必须使用
 * 
 * 解析优先级：
 * 1. 如果传入的 campaignId 已经是有效的 Amazon ID → 直接返回
 * 2. 如果传入了 adGroupId → 通过 adGroup.campaignId 解析
 * 3. 如果传入了 targetLocalId → 通过 keyword/productTarget.adGroupId → adGroup.campaignId 解析
 * 4. 如果所有路径都失败 → 返回 'UNRESOLVED'
 * 
 * @returns 有效的 Amazon Campaign ID 或 'UNRESOLVED'
 */
export async function safeCampaignIdForInsert(ctx: CampaignIdContext): Promise<string> {
  // 步骤1：检查传入的 campaignId 是否已经有效
  if (ctx.campaignId != null) {
    const str = String(ctx.campaignId).trim();
    if (str !== '' && str !== '0' && str !== 'null' && str !== 'undefined') {
      const classification = classifyCampaignId(str);
      if (classification === 'amazon') {
        return str; // 已经是有效的 Amazon ID
      }
      // 如果是 'ambiguous'（如5-9位数字），也接受（可能是较短的 Amazon ID）
      if (classification === 'ambiguous' && isValidAmazonId(str)) {
        return str;
      }
      // 如果是 'local'，需要解析
      log.warn(`[${ctx.caller}] campaignId(${str}) 被分类为 ${classification}，尝试通过上下文解析`);
    }
  }

  // 步骤2：通过 adGroupId 解析
  let resolvedAdGroupId = ctx.adGroupId;

  // 如果没有 adGroupId，尝试通过 targetLocalId 获取
  if (!resolvedAdGroupId && ctx.targetLocalId) {
    resolvedAdGroupId = await resolveAdGroupIdFromTarget(ctx.targetLocalId, ctx.targetType || 'keyword');
  }

  if (resolvedAdGroupId) {
    const campaignId = await resolveCampaignIdFromAdGroup(resolvedAdGroupId);
    if (campaignId) {
      log.debug(`[${ctx.caller}] campaignId 解析成功: adGroupId=${resolvedAdGroupId} → campaignId=${campaignId}`);
      return campaignId;
    }
  }

  // 步骤3：所有路径都失败
  log.error(`[${ctx.caller}] ⛔ campaignId 解析失败! 原始值=${ctx.campaignId}, adGroupId=${ctx.adGroupId}, targetLocalId=${ctx.targetLocalId}. 写入 UNRESOLVED`);
  return 'UNRESOLVED';
}

/**
 * 同步版本的 campaignId 检查 — 仅验证，不解析
 * 用于不方便使用 async 的场景（如 Drizzle values 对象构建）
 * 
 * @returns 有效的 campaignId 字符串，或 'UNRESOLVED'
 */
export function quickValidateCampaignId(value: string | number | null | undefined, caller: string): string {
  if (value == null) return 'UNRESOLVED';
  const str = String(value).trim();
  if (str === '' || str === '0' || str === 'null' || str === 'undefined') {
    log.warn(`[${caller}] quickValidate: campaignId 无效(${value})，标记为 UNRESOLVED`);
    return 'UNRESOLVED';
  }
  const classification = classifyCampaignId(str);
  if (classification === 'local') {
    log.warn(`[${caller}] quickValidate: campaignId(${str}) 疑似本地ID，标记为 UNRESOLVED`);
    return 'UNRESOLVED';
  }
  return str;
}

// ==================== 内部解析函数 ====================

/**
 * 通过 adGroup 本地 ID 解析 Amazon campaignId
 * 使用缓存减少数据库查询
 */
async function resolveCampaignIdFromAdGroup(adGroupId: number): Promise<string | null> {
  // 先查缓存
  const cached = getCachedCampaignId(adGroupId);
  if (cached) return cached;

  try {
    // 延迟导入避免循环依赖
    const { getAdGroupById } = await import('../db');
    const adGroup = await getAdGroupById(adGroupId);
    if (adGroup && adGroup.campaignId) {
      const campaignId = String(adGroup.campaignId).trim();
      if (isValidAmazonId(campaignId) && classifyCampaignId(campaignId) !== 'local') {
        setCachedCampaignId(adGroupId, campaignId);
        return campaignId;
      }
    }
    log.warn(`[CampaignIdResolver] adGroupId=${adGroupId} 未找到有效的 campaignId`);
    return null;
  } catch (err: any) {
    log.error(`[CampaignIdResolver] 通过 adGroupId=${adGroupId} 解析 campaignId 失败: ${err.message}`);
    return null;
  }
}

/**
 * 通过 keyword/productTarget 本地 ID 解析 adGroupId
 */
async function resolveAdGroupIdFromTarget(targetLocalId: number, targetType: string): Promise<number | null> {
  try {
    // 延迟导入避免循环依赖
    const { getKeywordById, getProductTargetById } = await import('../db');
    
    if (targetType === 'product_target') {
      const target = await getProductTargetById(targetLocalId);
      return target?.adGroupId || null;
    } else {
      // 默认按 keyword 处理
      const keyword = await getKeywordById(targetLocalId);
      return keyword?.adGroupId || null;
    }
  } catch (err: any) {
    log.error(`[CampaignIdResolver] 通过 ${targetType} id=${targetLocalId} 解析 adGroupId 失败: ${err.message}`);
    return null;
  }
}

// ==================== 批量解析工具 ====================

/**
 * 批量预热缓存 — 在批量操作前调用，减少逐条查询
 * 
 * @param adGroupIds 需要预热的 adGroup 本地 ID 列表
 */
export async function preloadCampaignIdCache(adGroupIds: number[]): Promise<void> {
  const uncachedIds = adGroupIds.filter(id => !getCachedCampaignId(id));
  if (uncachedIds.length === 0) return;

  try {
    const { getDb } = await import('../db');
    const { adGroups } = await import('../../drizzle/schema');
    const { inArray } = await import('drizzle-orm');
    
    const db = await getDb();
    if (!db) return;

    const results = await db.select({
      id: adGroups.id,
      campaignId: adGroups.campaignId,
    }).from(adGroups).where(inArray(adGroups.id, uncachedIds));

    for (const row of results) {
      if (row.campaignId && isValidAmazonId(row.campaignId)) {
        setCachedCampaignId(row.id, row.campaignId);
      }
    }
    log.debug(`[CampaignIdResolver] 预热缓存: ${results.length}/${uncachedIds.length} 个 adGroup 的 campaignId`);
  } catch (err: any) {
    log.error(`[CampaignIdResolver] 预热缓存失败: ${err.message}`);
  }
}

/**
 * 获取缓存统计信息（用于监控）
 */
export function getCacheStats(): { size: number; maxSize: number } {
  return {
    size: adGroupToCampaignCache.size,
    maxSize: 5000,
  };
}
