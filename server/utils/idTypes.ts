/**
 * Amazon Ads Optimizer — Unified ID Type System (v206)
 * 
 * 本模块是整个系统的ID管理基石。
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
 *    - keywords.adGroupId  → adGroups.id          （本地ID对本地ID）
 *    - 绝不能 adGroups.campaignId → campaigns.id  （Amazon ID对本地ID = BUG）
 * 
 * 4. 调用Amazon API时，必须传Amazon ID（varchar字段的值）
 *    更新本地DB时，必须用本地ID（int字段的值）
 * ═══════════════════════════════════════════════════════════════════
 */

import { createModuleLogger } from './logger';
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
export function isValidAmazonId(value: any): boolean {
  if (typeof value !== 'string' && typeof value !== 'number') return false;
  const str = String(value).trim();
  if (str === '' || str === '0' || str === 'null' || str === 'undefined') return false;
  // Amazon ID是纯数字，长度通常在1-20位之间
  return /^\d{1,20}$/.test(str);
}

/**
 * 验证一个值是否是本地数据库ID（正整数）
 */
export function isValidLocalId(value: any): boolean {
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
 * - 如果是字符串且长度>=10，几乎肯定是Amazon ID
 */
export function classifyCampaignId(value: string | number): 'amazon' | 'local' | 'ambiguous' {
  const str = String(value).trim();
  if (!isValidAmazonId(str)) return 'ambiguous';
  
  // 字符串类型输入 → 大概率是Amazon ID
  if (typeof value === 'string' && str.length >= 8) return 'amazon';
  
  // 数字类型输入
  const num = typeof value === 'number' ? value : parseInt(str, 10);
  
  // 超过JS安全整数范围 → 一定是Amazon ID（已经丢精度了，但至少能识别）
  if (str.length > 15) return 'amazon';
  
  // 10位以上数字 → Amazon ID
  if (str.length >= 10) return 'amazon';
  
  // 小于10000 → 几乎肯定是本地ID
  if (num < 10000) return 'local';
  
  // 中间地带
  return 'ambiguous';
}

// ==================== 安全转换函数 ====================

/**
 * 从Campaign对象中安全提取Amazon Campaign ID
 * 
 * campaigns表有两个ID：
 * - campaign.id = 本地自增int（用于本地DB操作）
 * - campaign.campaignId = Amazon varchar（用于API调用和跨表JOIN）
 */
export function getCampaignAmazonId(campaign: { id?: number; campaignId?: string | number }): string {
  // 优先使用campaignId字段（这是Amazon ID）
  if (campaign.campaignId != null) {
    const amazonId = String(campaign.campaignId).trim();
    if (isValidAmazonId(amazonId)) {
      return amazonId;
    }
  }
  
  // 如果campaignId不可用，这是一个严重错误
  log.error(`[IdTypes] ⛔ Campaign对象缺少有效的Amazon campaignId! id=${campaign.id}, campaignId=${campaign.campaignId}`);
  throw new Error(`Campaign缺少Amazon campaignId (localId=${campaign.id})`);
}

/**
 * 从Campaign对象中安全提取本地ID
 */
export function getCampaignLocalId(campaign: { id?: number; campaignId?: string }): number {
  if (campaign.id != null && typeof campaign.id === 'number' && campaign.id > 0) {
    return campaign.id;
  }
  log.error(`[IdTypes] ⛔ Campaign对象缺少有效的本地id! id=${campaign.id}`);
  throw new Error(`Campaign缺少本地id`);
}

/**
 * 从AdGroup对象中安全提取Amazon Ad Group ID
 */
export function getAdGroupAmazonId(adGroup: { id?: number; adGroupId?: string | number }): string {
  if (adGroup.adGroupId != null) {
    const amazonId = String(adGroup.adGroupId).trim();
    if (isValidAmazonId(amazonId)) {
      return amazonId;
    }
  }
  log.error(`[IdTypes] ⛔ AdGroup对象缺少有效的Amazon adGroupId! id=${adGroup.id}, adGroupId=${adGroup.adGroupId}`);
  throw new Error(`AdGroup缺少Amazon adGroupId (localId=${adGroup.id})`);
}

/**
 * 从Keyword对象中安全提取Amazon Keyword ID
 * 返回null表示该keyword尚未获得Amazon ID（需要回填）
 */
export function getKeywordAmazonId(keyword: { id?: number; keywordId?: string | null }): string | null {
  if (keyword.keywordId != null) {
    const amazonId = String(keyword.keywordId).trim();
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
    if (isValidAmazonId(amazonId)) {
      return amazonId;
    }
  }
  return null;
}

// ==================== 安全的campaignId参数处理 ====================

/**
 * 将任意类型的campaignId参数转换为Amazon campaignId字符串
 * 
 * 这是所有查询函数的入口守卫：
 * - 如果传入的是Amazon ID字符串 → 直接返回
 * - 如果传入的是本地int ID → 记录警告并尝试转换（但可能产生错误结果）
 * - 如果无法判断 → 记录错误并原样返回字符串
 * 
 * 长期目标：所有调用者都应该传入正确的Amazon ID，消除此函数中的警告
 */
export function ensureAmazonCampaignId(
  value: string | number,
  context: string = 'unknown'
): string {
  const str = String(value).trim();
  const classification = classifyCampaignId(value);
  
  if (classification === 'local') {
    // ⚠️ 这是一个bug信号：调用者传了本地ID，但查询需要Amazon ID
    log.warn(`[IdTypes] ⚠️ 检测到本地campaignId(${value})被用于需要Amazon ID的场景! 调用来源: ${context}. 请修复调用者传入campaign.campaignId而非campaign.id`);
  }
  
  return str;
}

/**
 * 将任意类型的adGroupId参数转换为本地int ID
 * （keywords.adGroupId 和 productTargets.adGroupId 存的是本地int）
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
  for (const kw of keywords) {
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

// ==================== ID字典：全系统ID规范速查 ====================

/**
 * ID_DICTIONARY: 每个表的每个ID字段的权威定义
 * 
 * 开发者在写任何涉及ID的代码前，必须查阅此字典。
 * 
 * 格式: table.field → { dbType, meaning, joinsWith, apiUsage }
 */
export const ID_DICTIONARY = {
  // ===== campaigns =====
  'campaigns.id':           { dbType: 'int',      meaning: 'LOCAL_PK',    joinsWith: 'NOTHING across tables', apiUsage: 'NEVER send to Amazon API' },
  'campaigns.campaignId':   { dbType: 'varchar',  meaning: 'AMAZON_ID',   joinsWith: 'adGroups.campaignId, dailyPerformance.campaignId, searchTerms.campaignId', apiUsage: 'Use for all Amazon API calls' },
  'campaigns.accountId':    { dbType: 'int',      meaning: 'LOCAL_FK',    joinsWith: 'accounts.id', apiUsage: 'N/A' },
  
  // ===== adGroups =====
  'adGroups.id':            { dbType: 'int',      meaning: 'LOCAL_PK',    joinsWith: 'keywords.adGroupId, productTargets.adGroupId', apiUsage: 'NEVER send to Amazon API' },
  'adGroups.adGroupId':     { dbType: 'varchar',  meaning: 'AMAZON_ID',   joinsWith: 'Amazon API only', apiUsage: 'Use for all Amazon API calls' },
  'adGroups.campaignId':    { dbType: 'varchar',  meaning: 'AMAZON_FK',   joinsWith: '⚠️ campaigns.campaignId (NOT campaigns.id!)', apiUsage: 'N/A' },
  
  // ===== keywords =====
  'keywords.id':            { dbType: 'int',      meaning: 'LOCAL_PK',    joinsWith: 'biddingLogs.targetId, optimizationEvents.keyword_id', apiUsage: 'NEVER send to Amazon API' },
  'keywords.keywordId':     { dbType: 'varchar',  meaning: 'AMAZON_ID',   joinsWith: 'Amazon API only', apiUsage: 'Use for all Amazon API calls (bid updates, etc.)' },
  'keywords.adGroupId':     { dbType: 'int',      meaning: 'LOCAL_FK',    joinsWith: 'adGroups.id', apiUsage: 'N/A' },
  
  // ===== productTargets =====
  'productTargets.id':      { dbType: 'int',      meaning: 'LOCAL_PK',    joinsWith: 'biddingLogs.targetId', apiUsage: 'NEVER send to Amazon API' },
  'productTargets.targetId':{ dbType: 'varchar',  meaning: 'AMAZON_ID',   joinsWith: 'Amazon API only', apiUsage: 'Use for all Amazon API calls' },
  'productTargets.adGroupId':{ dbType: 'int',     meaning: 'LOCAL_FK',    joinsWith: 'adGroups.id', apiUsage: 'N/A' },
  
  // ===== negativeKeywords =====
  'negativeKeywords.id':    { dbType: 'int',      meaning: 'LOCAL_PK',    joinsWith: 'N/A', apiUsage: 'N/A' },
  'negativeKeywords.amazonNegativeKeywordId': { dbType: 'varchar', meaning: 'AMAZON_ID', joinsWith: 'Amazon API', apiUsage: 'Use for Amazon API calls' },
  'negativeKeywords.campaignId': { dbType: 'varchar', meaning: 'MIXED_BUG', joinsWith: '⚠️ INCONSISTENT: some rows store local int, some store Amazon ID', apiUsage: 'Needs data migration' },
  'negativeKeywords.adGroupId': { dbType: 'int',  meaning: 'LOCAL_FK',    joinsWith: 'adGroups.id', apiUsage: 'N/A' },
  
  // ===== biddingLogs =====
  'biddingLogs.campaignId': { dbType: 'varchar',  meaning: 'SHOULD_BE_AMAZON', joinsWith: 'campaigns.campaignId', apiUsage: 'N/A (log only)' },
  'biddingLogs.targetId':   { dbType: 'int',      meaning: 'LOCAL_FK',    joinsWith: 'keywords.id or productTargets.id', apiUsage: 'N/A (log only)' },
  'biddingLogs.adGroupId':  { dbType: 'int',      meaning: 'LOCAL_FK',    joinsWith: 'adGroups.id', apiUsage: 'N/A (log only)' },
} as const;
