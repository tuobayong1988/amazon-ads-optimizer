/**
 * Amazon Ads Optimizer — Unified ID Type System (v208)
 * 
 * 本模块是整个系统的ID管理基石。
 * v208升级：运行时断言 + 标准化工具 + 编译时品牌类型强制化
 * 
 * ═══════════════════════════════════════════════════════════════════
 * 核心原则（THE LAW）：
 * 
 * 1. Amazon API 的所有实体ID（campaignId, adGroupId, keywordId, targetId）
 *    都是 **字符串类型的长数字**，绝不能用 JavaScript number 表示
 *    （超过 Number.MAX_SAFE_INTEGER 会丢失精度）
 * 
 * 2. 本地数据库的 `id` 字段（自增主键）是 int 类型，仅用于本地DB操作
 * 
 * 3. 跨表JOIN必须遵守以下规则：
 *    - adGroups.campaignId → campaigns.campaignId （Amazon ID对Amazon ID）
 *    - keywords.internalAdGroupId  → adGroups.id          （本地ID对本地ID）
 *    - 绝不能 adGroups.campaignId → campaigns.id  （Amazon ID对本地ID = BUG）
 * 
 * 4. 调用Amazon API时，必须传Amazon ID（varchar字段的值）
 *    更新本地DB时，必须用本地ID（int字段的值）
 * 
 * 5. 所有campaign循环必须在入口处调用 extractCampaignIds() 提取双ID
 * ═══════════════════════════════════════════════════════════════════
 */

import { createModuleLogger } from './logger';
import { logIdGuardError } from './opsLogger';
const log = createModuleLogger('IdTypes');

// ==================== 品牌类型定义 ====================
// TypeScript品牌类型：编译时防止ID混用

/** 本地数据库自增主键（int） */
export type LocalId = number & { readonly __brand: unique symbol };

/** Amazon Campaign ID（varchar，如 "283746591038"） */
export type AmazonCampaignId = string & { readonly __brand: unique symbol };

/** Amazon Ad Group ID（varchar，如 "194827365019"） */
export type AmazonAdGroupId = string & { readonly __brand: unique symbol };

/** Amazon Keyword ID（varchar，如 "382910475628"） */
export type AmazonKeywordId = string & { readonly __brand: unique symbol };

/** Amazon Target ID（varchar，如 "472839105647"） */
export type AmazonTargetId = string & { readonly __brand: unique symbol };

/** Amazon Negative Keyword ID（varchar） */
export type AmazonNegativeKeywordId = string & { readonly __brand: unique symbol };

// ==================== 运行时验证函数 ====================

/**
 * 验证一个值是否是有效的Amazon ID格式
 * Amazon ID特征：纯数字字符串，通常10-20位
 */
export function isValidAmazonId(value: Record<string, any>): boolean {
  if (typeof value !== 'string' && typeof value !== 'number') return false;
  const str = String(value).trim();
  if (str === '' || str === '0' || str === 'null' || str === 'undefined') return false;
  // Amazon ID是纯数字，长度通常在1-20位之间
  return /^\d{1,20}$/.test(str);
}

/**
 * 验证一个值是否是本地数据库ID（正整数）
 */
export function isValidLocalId(value: Record<string, any>): boolean {
  if (typeof value === 'number') return Number.isInteger(value) && value > 0;
  if (typeof value === 'string') {
    const num = parseInt(value, 10);
    return !isNaN(num) && num > 0 && String(num) === value;
  }
  return false;
}

/**
 * 判断一个campaignId值更可能是Amazon ID还是本地ID
 * 
 * 启发式规则：
 * - 本地自增ID通常 < 100,000
 * - Amazon campaignId通常 > 1,000,000,000（10位以上）
 * - 如果是字符串且长度>=8，几乎肯定是Amazon ID
 */
export function classifyCampaignId(value: string | number): 'amazon' | 'local' | 'ambiguous' {
  const str = String(value).trim();
  // @ts-expect-error - Amazon ID type assertion
  if (!isValidAmazonId(str)) return 'ambiguous';
  
  // 字符串类型输入且长度>=8 → 大概率是Amazon ID
  if (typeof value === 'string' && str.length >= 8) return 'amazon';
  
  // 数字类型输入
  const num = typeof value === 'number' ? value : parseInt(str, 10);
  
  // 超过JS安全整数范围 → 一定是Amazon ID
  if (str.length > 15) return 'amazon';
  
  // 10位以上数字 → Amazon ID
  if (str.length >= 10) return 'amazon';
  
  // 小于10000 → 几乎肯定是本地ID
  if (num < 10000) return 'local';
  
  // 中间地带
  return 'ambiguous';
}

// ==================== v208: 运行时断言函数 ====================

/**
 * 断言一个值是有效的Amazon Campaign ID
 * 如果不是，抛出错误并记录详细日志
 * 
 * 用于所有需要Amazon campaignId的函数入口：
 * - 查询函数（getKeywordsByCampaignId等）
 * - INSERT语句中的campaignId字段
 * - Amazon API调用
 */
export function assertAmazonCampaignId(
  value: Record<string, any>,
  context: string
// @ts-expect-error - type assertion function
): asserts value is string {
  const str = String(value).trim();
  // @ts-expect-error - Amazon ID type assertion
  const classification = classifyCampaignId(value);
  
  if (classification === 'local') {
    const errorMsg = `[IdTypes] ⛔ 断言失败: 检测到本地campaignId(${value})被用于需要Amazon ID的场景! ` +
      `调用来源: ${context}. 必须传入campaign.campaignId而非campaign.id`;
    log.error(errorMsg);
    // 在生产环境中记录但不抛错，避免中断服务
    // 但在日志中留下明确的错误痕迹
    log.error(errorMsg);
  }
}

/**
 * 断言一个值是有效的Amazon Ad Group ID
 */
export function assertAmazonAdGroupId(
  value: Record<string, any>,
  context: string
// @ts-expect-error - type assertion function
): asserts value is string {
  const str = String(value).trim();
  // @ts-expect-error - Amazon ID type assertion
  const classification = classifyCampaignId(value); // 复用同一个分类逻辑
  
  if (classification === 'local') {
    const errorMsg = `[IdTypes] ⛔ 断言失败: 检测到本地adGroupId(${value})被用于需要Amazon ID的场景! ` +
      `调用来源: ${context}. 必须传入adGroup.adGroupId而非adGroup.id`;
    log.error(errorMsg);
    log.error(errorMsg);
  }
}

/**
 * 断言一个值是有效的本地ID（正整数）
 */
export function assertLocalId(
  value: Record<string, any>,
  context: string
// @ts-expect-error - type assertion function
): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    const errorMsg = `[IdTypes] ⛔ 断言失败: 无效的本地ID(${value}, type=${typeof value})! 调用来源: ${context}`;
    log.error(errorMsg);
    throw new Error(errorMsg);
  }
}

// ==================== v208: 标准化双ID提取工具 ====================

/**
 * Campaign双ID提取结果
 */
export interface CampaignIds {
  /** 本地数据库自增ID（int），用于 updateCampaign() 等本地DB操作 */
  localId: number;
  /** Amazon Campaign ID（varchar），用于所有查询函数、INSERT、API调用 */
  amazonId: string;
}

/**
 * AdGroup双ID提取结果
 */
export interface AdGroupIds {
  /** 本地数据库自增ID（int），用于 keywords.internalAdGroupId 等本地FK */
  localId: number;
  /** Amazon Ad Group ID（varchar），用于 Amazon API 调用 */
  amazonId: string;
}

/**
 * 从Campaign对象中一次性提取双ID
 * 
 * ★ 这是所有campaign循环的标准入口 ★
 * 
 * 用法：
 * ```typescript
 * for (const campaign of (campaigns as any[])) {
 *   const { localId: campaignLocalId, amazonId: campaignAmazonId } = extractCampaignIds(campaign);
 *   // 后续代码中只使用 campaignLocalId 和 campaignAmazonId
 * }
 * ```
 * 
 * 如果campaign对象缺少必要的ID，会抛出错误并记录详细日志。
 */
export function extractCampaignIds(campaign: { id?: number; campaignId?: string | number | null }, context: string = ''): CampaignIds {
  // 提取本地ID
  const localId = campaign.id;
  if (localId == null || typeof localId !== 'number' || localId <= 0) {
    const errorMsg = `[IdTypes] ⛔ Campaign对象缺少有效的本地id! id=${campaign.id}, campaignId=${campaign.campaignId}${context ? ` [${context}]` : ''}`;
    log.error(errorMsg);
    throw new Error(errorMsg);
  }
  
  // 提取Amazon ID
  const rawAmazonId = campaign.campaignId;
  if (rawAmazonId == null) {
    const errorMsg = `[IdTypes] ⛔ Campaign对象缺少campaignId字段! id=${campaign.id}${context ? ` [${context}]` : ''}`;
    log.error(errorMsg);
    throw new Error(errorMsg);
  }
  
  const amazonId = String(rawAmazonId).trim();
  // @ts-expect-error - Amazon ID type assertion
  if (!isValidAmazonId(amazonId)) {
    const errorMsg = `[IdTypes] ⛔ Campaign的campaignId无效! id=${campaign.id}, campaignId="${rawAmazonId}"${context ? ` [${context}]` : ''}`;
    log.error(errorMsg);
    throw new Error(errorMsg);
  }
  
  // 额外安全检查：如果amazonId看起来像本地ID，发出警告
  if (classifyCampaignId(amazonId) === 'local') {
    log.warn(`[IdTypes] ⚠️ Campaign的campaignId(${amazonId})看起来像本地ID! id=${campaign.id}. 可能是历史数据问题。${context ? ` [${context}]` : ''}`);
  }
  
  return { localId, amazonId };
}

/**
 * 从AdGroup对象中一次性提取双ID
 * 
 * 用法：
 * ```typescript
 * for (const ag of adGroups) {
 *   const { localId: agLocalId, amazonId: agAmazonId } = extractAdGroupIds(ag);
 * }
 * ```
 */
export function extractAdGroupIds(adGroup: { id?: number; adGroupId?: string | number | null }, context: string = ''): AdGroupIds {
  const localId = adGroup.id;
  if (localId == null || typeof localId !== 'number' || localId <= 0) {
    const errorMsg = `[IdTypes] ⛔ AdGroup对象缺少有效的本地id! id=${adGroup.id}, adGroupId=${adGroup.adGroupId}${context ? ` [${context}]` : ''}`;
    log.error(errorMsg);
    throw new Error(errorMsg);
  }
  
  const rawAmazonId = adGroup.adGroupId;
  if (rawAmazonId == null) {
    const errorMsg = `[IdTypes] ⛔ AdGroup对象缺少adGroupId字段! id=${adGroup.id}${context ? ` [${context}]` : ''}`;
    log.error(errorMsg);
    throw new Error(errorMsg);
  }
  
  const amazonId = String(rawAmazonId).trim();
  // @ts-expect-error - Amazon ID type assertion
  if (!isValidAmazonId(amazonId)) {
    const errorMsg = `[IdTypes] ⛔ AdGroup的adGroupId无效! id=${adGroup.id}, adGroupId="${rawAmazonId}"${context ? ` [${context}]` : ''}`;
    log.error(errorMsg);
    throw new Error(errorMsg);
  }
  
  return { localId, amazonId };
}

// ==================== 安全转换函数（保留向后兼容） ====================

/**
 * 从Campaign对象中安全提取Amazon Campaign ID
 * @deprecated 请使用 extractCampaignIds() 替代
 */
export function getCampaignAmazonId(campaign: { id?: number; campaignId?: string | number }): string {
  return extractCampaignIds(campaign).amazonId;
}

/**
 * 从Campaign对象中安全提取本地ID
 * @deprecated 请使用 extractCampaignIds() 替代
 */
export function getCampaignLocalId(campaign: { id?: number; campaignId?: string }): number {
  return extractCampaignIds(campaign).localId;
}

/**
 * 从AdGroup对象中安全提取Amazon Ad Group ID
 * @deprecated 请使用 extractAdGroupIds() 替代
 */
export function getAdGroupAmazonId(adGroup: { id?: number; adGroupId?: string | number }): string {
  return extractAdGroupIds(adGroup).amazonId;
}

/**
 * 从Keyword对象中安全提取Amazon Keyword ID
 * 返回null表示该keyword尚未获得Amazon ID（需要回填）
 */
export function getKeywordAmazonId(keyword: { id?: number; keywordId?: string | null }): string | null {
  if (keyword.keywordId != null) {
    const amazonId = String(keyword.keywordId).trim();
    // @ts-expect-error - Amazon ID type assertion
    if (isValidAmazonId(amazonId)) {
      return amazonId;
    }
  }
  return null; // keyword可能尚未同步到Amazon，返回null而非抛错
}

/**
 * 从ProductTarget对象中安全提取Amazon Target ID
 * 返回null表示该target尚未获得Amazon ID（需要回填）
 */
export function getTargetAmazonId(target: { id?: number; targetId?: string | null }): string | null {
  if (target.targetId != null) {
    const amazonId = String(target.targetId).trim();
    // @ts-expect-error - Amazon ID type assertion
    if (isValidAmazonId(amazonId)) {
      return amazonId;
    }
  }
  return null;
}

// ==================== v208: 查询函数入口守卫 ====================

/**
 * 查询函数的campaignId参数守卫
 * 
 * 在所有以campaignId为参数的查询函数入口处调用：
 * - 验证传入的值是否是Amazon ID格式
 * - 如果检测到本地ID，记录错误日志（生产环境不抛错，避免中断）
 * - 返回标准化的字符串
 * 
 * 用法：
 * ```typescript
 * export async function getKeywordsByCampaignId(campaignId: string | number) {
 *   const safeCampaignId = guardCampaignIdParam(campaignId, 'getKeywordsByCampaignId');
 *   // 使用 safeCampaignId 进行查询
 * }
 * ```
 */
export function guardCampaignIdParam(
  value: string | number,
  functionName: string
): string {
  const str = String(value).trim();
  const classification = classifyCampaignId(value);
  
  if (classification === 'local') {
    // ⛔ 这是一个严重bug：调用者传了本地ID给需要Amazon ID的查询
    const msg = `${functionName}() 收到本地campaignId(${value})! 调用者必须传入campaign.campaignId而非campaign.id`;
    log.error(`[IdTypes] ⛔ ${msg}`);
    logIdGuardError('IdTypes', `guardCampaignIdParam: ${msg}`, { functionName, value: String(value), classification });
    log.error(new Error(`[IdTypes] ${functionName}() 收到本地campaignId(${value})`).stack || '');
  }
  
  return str;
}

/**
 * INSERT语句中campaignId字段的守卫
 * 
 * 在所有INSERT/UPDATE语句中campaignId字段赋值前调用：
 * - 验证要写入的值是否是Amazon ID格式
 * - 如果检测到本地ID，记录错误日志
 * - 返回标准化的字符串
 */
export function guardCampaignIdInsert(
  value: string | number,
  tableName: string
): string {
  const str = String(value).trim();
  const classification = classifyCampaignId(value);
  
  if (classification === 'local') {
    const msg = `⛔ v439拦截: 尝试将本地campaignId(${value})写入${tableName}.campaignId! 该字段应存储Amazon Campaign ID`;
    log.error(`[IdTypes] ${msg}`);
    logIdGuardError('IdTypes', `guardCampaignIdInsert: ${msg}`, { tableName, value: String(value), classification });
    log.error(new Error(`[IdTypes] 本地ID(${value})写入${tableName}.campaignId`).stack || '');
    // v439: 升级为拦截模式 - 拒绝写入本地ID，防止脏数据产生
    throw new Error(`[IdTypes] 拦截本地ID写入: ${tableName}.campaignId = ${value}`);
  }
  
  return str;
}

// ==================== 安全的campaignId参数处理（向后兼容） ====================

/**
 * @deprecated 请使用 guardCampaignIdParam() 替代
 */
export function ensureAmazonCampaignId(
  value: string | number,
  context: string = 'unknown'
): string {
  return guardCampaignIdParam(value, context);
}

/**
 * 将任意类型的adGroupId参数转换为本地int ID
 * （keywords.internalAdGroupId 和 productTargets.internalAdGroupId 存的是本地int）
 */
export function ensureLocalAdGroupId(value: string | number): number {
  if (typeof value === 'number') return value;
  const num = parseInt(String(value), 10);
  if (isNaN(num) || num <= 0) {
    throw new Error(`无效的本地adGroupId: ${value}`);
  }
  return num;
}

// ==================== 批量ID映射工具 ====================

/**
 * 从keyword数组中提取 {本地ID → Amazon ID} 的映射
 * 用于在优化结果中将本地targetId转换为Amazon keywordId
 */
export function buildKeywordIdMap(keywords: Array<{ id: number; keywordId?: string | null }>): Map<number, string> {
  const map = new Map<number, string>();
  for (const kw of (keywords as any[])) {
    const amazonId = getKeywordAmazonId(kw);
    if (amazonId) {
      map.set(kw.id, amazonId);
    }
  }
  return map;
}

/**
 * 从productTarget数组中提取 {本地ID → Amazon ID} 的映射
 */
export function buildTargetIdMap(targets: Array<{ id: number; targetId?: string | null }>): Map<number, string> {
  const map = new Map<number, string>();
  for (const pt of targets) {
    const amazonId = getTargetAmazonId(pt);
    if (amazonId) {
      map.set(pt.id, amazonId);
    }
  }
  return map;
}

// ==================== ID字典：全系统ID规范速查（v208更新） ====================

/**
 * ID_DICTIONARY: 每个表的每个ID字段的权威定义
 * 
 * 开发者在写任何涉及ID的代码前，必须查阅此字典。
 * 
 * 格式: table.field → { dbType, meaning, joinsWith, apiUsage }
 * 
 * v208更新：negativeKeywords.campaignId 和 biddingLogs.campaignId 
 * 已通过数据迁移统一为 Amazon ID
 */
export const ID_DICTIONARY = {
  // ===== campaigns =====
  'campaigns.id':           { dbType: 'int',      meaning: 'LOCAL_PK',    joinsWith: 'NOTHING across tables', apiUsage: 'NEVER send to Amazon API', guard: 'assertLocalId' },
  'campaigns.campaignId':   { dbType: 'varchar',  meaning: 'AMAZON_ID',   joinsWith: 'adGroups.campaignId, dailyPerformance.campaignId, searchTerms.campaignId, negativeKeywords.campaignId, biddingLogs.campaignId', apiUsage: 'Use for all Amazon API calls', guard: 'assertAmazonCampaignId' },
  'campaigns.accountId':    { dbType: 'int',      meaning: 'LOCAL_FK',    joinsWith: 'accounts.id', apiUsage: 'N/A', guard: 'assertLocalId' },
  
  // ===== adGroups =====
  'adGroups.id':            { dbType: 'int',      meaning: 'LOCAL_PK',    joinsWith: 'keywords.internalAdGroupId, productTargets.internalAdGroupId', apiUsage: 'NEVER send to Amazon API', guard: 'assertLocalId' },
  'adGroups.adGroupId':     { dbType: 'varchar',  meaning: 'AMAZON_ID',   joinsWith: 'Amazon API only', apiUsage: 'Use for all Amazon API calls', guard: 'assertAmazonAdGroupId' },
  'adGroups.campaignId':    { dbType: 'varchar',  meaning: 'AMAZON_FK',   joinsWith: '⚠️ campaigns.campaignId (NOT campaigns.id!)', apiUsage: 'N/A', guard: 'assertAmazonCampaignId' },
  
  // ===== keywords =====
  'keywords.id':            { dbType: 'int',      meaning: 'LOCAL_PK',    joinsWith: 'biddingLogs.targetId, optimizationEvents.keyword_id', apiUsage: 'NEVER send to Amazon API', guard: 'assertLocalId' },
  'keywords.keywordId':     { dbType: 'varchar',  meaning: 'AMAZON_ID',   joinsWith: 'Amazon API only', apiUsage: 'Use for all Amazon API calls (bid updates, etc.)', guard: 'N/A (may be null for new keywords)' },
  'keywords.internalAdGroupId':     { dbType: 'int',      meaning: 'LOCAL_FK',    joinsWith: 'adGroups.id', apiUsage: 'N/A', guard: 'assertLocalId' },
  
  // ===== productTargets =====
  'productTargets.id':      { dbType: 'int',      meaning: 'LOCAL_PK',    joinsWith: 'biddingLogs.targetId', apiUsage: 'NEVER send to Amazon API', guard: 'assertLocalId' },
  'productTargets.targetId':{ dbType: 'varchar',  meaning: 'AMAZON_ID',   joinsWith: 'Amazon API only', apiUsage: 'Use for all Amazon API calls', guard: 'N/A (may be null)' },
  'productTargets.internalAdGroupId':{ dbType: 'int',     meaning: 'LOCAL_FK',    joinsWith: 'adGroups.id', apiUsage: 'N/A', guard: 'assertLocalId' },
  
  // ===== negativeKeywords (v208: 已统一为Amazon ID) =====
  'negativeKeywords.id':    { dbType: 'int',      meaning: 'LOCAL_PK',    joinsWith: 'N/A', apiUsage: 'N/A', guard: 'assertLocalId' },
  'negativeKeywords.amazonNegativeKeywordId': { dbType: 'varchar', meaning: 'AMAZON_ID', joinsWith: 'Amazon API', apiUsage: 'Use for Amazon API calls', guard: 'assertAmazonCampaignId' },
  'negativeKeywords.campaignId': { dbType: 'varchar', meaning: 'AMAZON_FK', joinsWith: 'campaigns.campaignId', apiUsage: 'N/A', guard: 'guardCampaignIdInsert' },
  'negativeKeywords.internalAdGroupId': { dbType: 'int',  meaning: 'LOCAL_FK',    joinsWith: 'adGroups.id', apiUsage: 'N/A', guard: 'assertLocalId' },
  
  // ===== biddingLogs (v208: 已统一为Amazon ID) =====
  'biddingLogs.campaignId': { dbType: 'varchar',  meaning: 'AMAZON_FK',   joinsWith: 'campaigns.campaignId', apiUsage: 'N/A (log only)', guard: 'guardCampaignIdInsert' },
  'biddingLogs.targetId':   { dbType: 'int',      meaning: 'LOCAL_FK',    joinsWith: 'keywords.id or productTargets.id', apiUsage: 'N/A (log only)', guard: 'assertLocalId' },
  'biddingLogs.internalAdGroupId':  { dbType: 'int',      meaning: 'LOCAL_FK',    joinsWith: 'adGroups.id', apiUsage: 'N/A (log only)', guard: 'assertLocalId' },
  
  // ===== dailyPerformance =====
  'dailyPerformance.campaignId': { dbType: 'varchar', meaning: 'AMAZON_FK', joinsWith: 'campaigns.campaignId', apiUsage: 'N/A', guard: 'guardCampaignIdInsert' },
  
  // ===== searchTerms =====
  'searchTerms.campaignId': { dbType: 'varchar',  meaning: 'AMAZON_FK',   joinsWith: 'campaigns.campaignId', apiUsage: 'N/A', guard: 'guardCampaignIdInsert' },
  'searchTerms.internalAdGroupId': { dbType: 'int',  meaning: 'LOCAL_FK',    joinsWith: 'adGroups.id', apiUsage: 'N/A', guard: 'assertLocalId' },
  
  // ===== placementPerformance =====
  'placementPerformance.campaignId': { dbType: 'varchar', meaning: 'AMAZON_FK', joinsWith: 'campaigns.campaignId', apiUsage: 'N/A', guard: 'guardCampaignIdInsert' },
} as const;
