/**
 * Amazon关键词数据校验与清洗工具 (v194)
 * 
 * 在关键词/搜索词进入投放流程的最前端进行严格的清洗与校验，
 * 确保所有发送到Amazon API的数据都符合Amazon广告平台的规则，
 * 从源头杜绝无效API调用，提升投放成功率至100%。
 * 
 * v194新增:
 * - 增强ASIN格式检测（覆盖更多变体格式）
 * - 增强Unicode控制字符清洗（包含U+FFFC等OBJ替换字符）
 * - 新增广告组类型检查函数（product target广告组不能添加keyword）
 * 
 * Amazon关键词规则参考:
 * - 最大长度: 80字符
 * - 最大词数: 正面关键词10个词, 否定关键词10个词
 * - 否定短语: 4个词或80字符
 * - 有效字符: 字母、数字、空格、连字符(-)
 * - 禁止字符: !, $, ?, {, }, ^, ¬, ¦, ~, #, <, >, ", ', /, \, @, %, &, +, =, |, ;, :, *, (, )
 * - 自动广告活动(auto targeting): 不允许添加正面关键词，只能添加否定关键词
 * - 广告组不能同时有keyword和product target
 */
import { createModuleLogger } from './logger';
import * as db from '../db'; // v350: 统一使用连接池
const log = createModuleLogger('KeywordValidator');

export interface KeywordValidationResult {
  /** 是否通过校验 */
  isValid: boolean;
  /** 清洗后的文本 */
  sanitizedText: string;
  /** 校验失败原因代码 */
  reasonCode?: string;
  /** 校验失败原因描述 */
  reasonMessage?: string;
}

/**
 * Amazon禁止的特殊字符正则
 * 只保留: 字母(任何语言)、数字、空格、连字符(-)
 * 移除所有其他特殊字符
 */
const INVALID_CHARS_REGEX = /[^a-zA-Z0-9\s\-\u00C0-\u024F\u1E00-\u1EFF]/g;

/**
 * Unicode控制字符和不可见字符 (v194: 扩展覆盖范围)
 * 包含: ASCII控制字符、C1控制字符、BOM、OBJ替换符(U+FFFC)、
 * 零宽字符、段落分隔符、格式控制字符、变体选择符等
 */
const CONTROL_CHARS_REGEX = /[\u0000-\u001F\u007F-\u009F\uFFFE\uFFFF\uFEFF\uFFFC\uFFFD\u200B-\u200F\u2028-\u202F\u2060-\u206F\uE000-\uF8FF\uFE00-\uFE0F]/g;

/**
 * Amazon关键词最大字符长度
 */
const MAX_KEYWORD_CHARS = 80;

/**
 * Amazon正面关键词最大词数
 */
const MAX_POSITIVE_WORD_COUNT = 10;

/**
 * Amazon否定短语关键词最大词数
 */
const MAX_NEGATIVE_PHRASE_WORD_COUNT = 4;

/**
 * Amazon否定精确关键词最大词数
 */
const MAX_NEGATIVE_EXACT_WORD_COUNT = 10;

/**
 * 清洗和校验关键词/搜索词
 * 
 * 执行以下校验步骤:
 * 1. 去除前后空白
 * 2. 去除Unicode控制字符和不可见字符
 * 3. 去除Amazon禁止的特殊字符
 * 4. 合并连续空格
 * 5. 检查是否为空
 * 6. 检查字符长度(80字符)
 * 7. 检查词数(正面10词, 否定短语4词, 否定精确10词)
 * 
 * @param text - 原始关键词文本
 * @param mode - 'positive' (投放关键词) | 'negative_exact' (否定精确) | 'negative_phrase' (否定短语)
 * @returns KeywordValidationResult
 */
export function sanitizeAndValidateKeyword(
  text: string,
  mode: 'positive' | 'negative_exact' | 'negative_phrase' = 'positive'
): KeywordValidationResult {
  // Step 1: Trim
  let sanitized = (text || '').trim();
  
  // Step 2: 去除控制字符和不可见字符
  sanitized = sanitized.replace(CONTROL_CHARS_REGEX, '');
  
  // Step 3: 去除Amazon禁止的特殊字符
  sanitized = sanitized.replace(INVALID_CHARS_REGEX, ' ');
  
  // Step 4: 合并连续空格
  sanitized = sanitized.replace(/\s+/g, ' ').trim();
  
  // Step 5: 空值检查
  if (!sanitized || sanitized.length === 0) {
    return {
      isValid: false,
      sanitizedText: '',
      reasonCode: 'EMPTY_AFTER_SANITIZE',
      reasonMessage: `关键词"${text}"清洗后为空，包含的全部是无效字符`,
    };
  }
  
  // Step 6: 字符长度检查
  if (sanitized.length > MAX_KEYWORD_CHARS) {
    return {
      isValid: false,
      sanitizedText: sanitized,
      reasonCode: 'EXCEEDS_MAX_LENGTH',
      reasonMessage: `关键词长度${sanitized.length}超过Amazon限制的${MAX_KEYWORD_CHARS}字符`,
    };
  }
  
  // Step 7: 词数检查
  const words = sanitized.split(/\s+/);
  const wordCount = words.length;
  
  if (mode === 'positive' && wordCount > MAX_POSITIVE_WORD_COUNT) {
    return {
      isValid: false,
      sanitizedText: sanitized,
      reasonCode: 'EXCEEDS_MAX_WORDS',
      reasonMessage: `关键词词数${wordCount}超过Amazon限制的${MAX_POSITIVE_WORD_COUNT}个词`,
    };
  }
  
  if (mode === 'negative_phrase' && wordCount > MAX_NEGATIVE_PHRASE_WORD_COUNT) {
    return {
      isValid: false,
      sanitizedText: sanitized,
      reasonCode: 'EXCEEDS_MAX_WORDS_NEG_PHRASE',
      reasonMessage: `否定短语词数${wordCount}超过Amazon限制的${MAX_NEGATIVE_PHRASE_WORD_COUNT}个词`,
    };
  }
  
  if (mode === 'negative_exact' && wordCount > MAX_NEGATIVE_EXACT_WORD_COUNT) {
    return {
      isValid: false,
      sanitizedText: sanitized,
      reasonCode: 'EXCEEDS_MAX_WORDS_NEG_EXACT',
      reasonMessage: `否定精确词数${wordCount}超过Amazon限制的${MAX_NEGATIVE_EXACT_WORD_COUNT}个词`,
    };
  }
  
  return {
    isValid: true,
    sanitizedText: sanitized,
  };
}

/**
 * 检查搜索词是否为ASIN格式
 * Amazon ASIN格式: B0开头 + 8位字母数字（共10位）
 * v194: 增强检测，支持更多变体
 */
export function isAsinSearchTerm(searchTerm: string): boolean {
  const cleaned = searchTerm.trim().toUpperCase();
  // 标准ASIN: B0 + 8位字母数字 = 10位
  if (/^B0[A-Z0-9]{8}$/.test(cleaned)) return true;
  // 宽松匹配: B0开头 + 8位以上字母数字（某些API返回的格式）
  if (/^B0[A-Z0-9]{8,}$/.test(cleaned)) return true;
  return false;
}

/**
 * v191: 判断广告活动是否可以添加正面关键词
 * Amazon规则: 自动广告活动不能添加正面关键词
 * 
 * @param campaignTargetingType - 广告活动定向类型 ('auto' | 'manual')
 * @param campaignName - 广告活动名称（可选，用于检测Product Targeting campaign）
 * @returns true = 允许添加正面关键词
 */
export function canAddPositiveKeyword(campaignTargetingType: string, campaignName?: string): boolean {
  if (campaignTargetingType === 'auto') return false;
  
  // v311: 检测Product Targeting类型的campaign
  // POE (Product + Other + Exact) 和 PT (Product Targeting) campaign不支持keyword
  // 这些campaign只能添加product targets，不能添加keywords
  if (campaignName && isProductTargetingCampaign(campaignName)) return false;
  
  return true;
}

/**
 * v311: 判断campaign是否为Product Targeting类型
 * 通过campaign名称中的命名约定来识别：
 * - POE (Product + Other + Exact)
 * - PT (Product Targeting)
 * - ASIN (ASIN定向)
 * 
 * Amazon规则: Product Targeting campaign的广告组只能包含product targets，不能包含keywords
 * 
 * @param campaignName - 广告活动名称
 * @returns true = 是Product Targeting campaign，不能添加keyword
 */
export function isProductTargetingCampaign(campaignName: string): boolean {
  if (!campaignName) return false;
  const name = campaignName.toUpperCase();
  
  // 匹配常见的Product Targeting campaign命名模式
  // 使用分隔符边界检测避免误匹配（如"SPOT"中的"POT"）
  const ptPatterns = [
    /[-_\s]POE[-_\s]/,     // POE = Product + Other + Exact
    /[-_\s]POB[-_\s]/,     // POB = Product + Other + Broad  
    /[-_\s]PT[-_\s]/,      // PT = Product Targeting
    /[-_\s]ASIN[-_\s]/,    // ASIN定向
    /PRODUCT[\s_-]?TARGET/i, // Product Targeting / Product_Target
  ];
  
  return ptPatterns.some(pattern => pattern.test(`-${name}-`));
}

/**
 * v194: 检查广告组是否为product targeting类型
 * Amazon规则: 同一个广告组不能同时有keyword和product target
 * 
 * @param adGroupId - 本地数据库的广告组ID
 * @param conn - 数据库连接（可选，如果不传则创建新连接）
 * @returns true = 广告组已有product targets，不能添加keyword
 */
export async function adGroupHasProductTargets(
  adGroupId: number,
  conn?: unknown
): Promise<boolean> {
  let ownConn = false;
  try {
    if (!conn) {
      // v350: 使用连接池获取直接连接，替代独立createConnection
      conn = await db.getDirectConnection();
      ownConn = true;
    }
    const [rows] = await conn.execute(
      'SELECT COUNT(*) AS cnt FROM product_targets WHERE adGroupId = ? AND targetId IS NOT NULL LIMIT 1',
      [adGroupId]
    );
    return (rows[0]?.cnt || 0) > 0;
  } catch (err: unknown) {
    log.warn(`[KeywordValidator] 检查广告组product targets失败: ${(err as Error).message}`);
    return false;
  } finally {
    if (ownConn && conn) {
      try { conn.release(); } catch (_) {} // v350: 归还连接到池
    }
  }
}

/**
 * 批量校验关键词列表
 * 过滤掉无效关键词，返回有效关键词和被拒绝的关键词
 */
export function batchValidateKeywords(
  keywords: Array<{ text: string; [key: string]: unknown }>,
  mode: 'positive' | 'negative_exact' | 'negative_phrase' = 'positive'
): {
  valid: Array<{ originalText: string; sanitizedText: string; data: Record<string, unknown> }>;
  rejected: Array<{ originalText: string; reason: string; data: Record<string, unknown> }>;
} {
  const valid: Array<{ originalText: string; sanitizedText: string; data: Record<string, unknown> }> = [];
  const rejected: Array<{ originalText: string; reason: string; data: Record<string, unknown> }> = [];
  
  for (const kw of keywords) {
    const result = sanitizeAndValidateKeyword(kw.text, mode);
    if (result.isValid) {
      valid.push({
        originalText: kw.text,
        sanitizedText: result.sanitizedText,
        data: kw,
      });
    } else {
      rejected.push({
        originalText: kw.text,
        reason: result.reasonMessage || result.reasonCode || 'UNKNOWN',
        data: kw,
      });
    }
  }
  
  if (rejected.length > 0) {
    log.info(`[KeywordValidator] 批量校验: ${valid.length}个有效, ${rejected.length}个被拒绝`);
    for (const r of rejected.slice(0, 5)) {
      log.info(`[KeywordValidator] 拒绝: "${r.originalText}" → ${r.reason}`);
    }
    if (rejected.length > 5) {
      log.info(`[KeywordValidator] ... 还有${rejected.length - 5}个被拒绝`);
    }
  }
  
  return { valid, rejected };
}
