/**
 * Amazon关键词数据校验与清洗工具 (v191)
 * 
 * 在关键词/搜索词进入投放流程的最前端进行严格的清洗与校验，
 * 确保所有发送到Amazon API的数据都符合Amazon广告平台的规则，
 * 从源头杜绝无效API调用，提升投放成功率至100%。
 * 
 * Amazon关键词规则参考:
 * - 最大长度: 80字符
 * - 最大词数: 正面关键词10个词, 否定关键词10个词
 * - 否定短语: 4个词或80字符
 * - 有效字符: 字母、数字、空格、连字符(-)
 * - 禁止字符: !, $, ?, {, }, ^, ¬, ¦, ~, #, <, >, ", ', /, \, @, %, &, +, =, |, ;, :, *, (, )
 * - 自动广告活动(auto targeting): 不允许添加正面关键词，只能添加否定关键词
 */

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
const INVALID_CHARS_REGEX = /[^\p{L}\p{N}\s\-]/gu;

/**
 * Unicode控制字符和不可见字符
 */
const CONTROL_CHARS_REGEX = /[\u0000-\u001F\u007F-\u009F\uFFFE\uFFFF\uFEFF\uFFFC\u200B-\u200F\u2028-\u202F\u2060-\u206F]/g;

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
 * Amazon ASIN格式: B0开头 + 8位以上字母数字
 */
export function isAsinSearchTerm(searchTerm: string): boolean {
  return /^[Bb]0[A-Za-z0-9]{8,}$/.test(searchTerm.trim());
}

/**
 * 检查广告活动是否允许添加正面关键词
 * 自动广告活动(auto targeting)不允许添加正面关键词
 * 
 * @param campaignTargetingType - 广告活动定向类型 ('auto' | 'manual')
 * @returns true = 允许添加正面关键词
 */
export function canAddPositiveKeyword(campaignTargetingType: string): boolean {
  return campaignTargetingType !== 'auto';
}

/**
 * 批量校验关键词列表
 * 过滤掉无效关键词，返回有效关键词和被拒绝的关键词
 */
export function batchValidateKeywords(
  keywords: Array<{ text: string; [key: string]: any }>,
  mode: 'positive' | 'negative_exact' | 'negative_phrase' = 'positive'
): {
  valid: Array<{ originalText: string; sanitizedText: string; data: any }>;
  rejected: Array<{ originalText: string; reason: string; data: any }>;
} {
  const valid: Array<{ originalText: string; sanitizedText: string; data: any }> = [];
  const rejected: Array<{ originalText: string; reason: string; data: any }> = [];
  
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
    console.log(`[KeywordValidator] 批量校验: ${valid.length}个有效, ${rejected.length}个被拒绝`);
    for (const r of rejected.slice(0, 5)) {
      console.log(`[KeywordValidator] 拒绝: "${r.originalText}" → ${r.reason}`);
    }
    if (rejected.length > 5) {
      console.log(`[KeywordValidator] ... 还有${rejected.length - 5}个被拒绝`);
    }
  }
  
  return { valid, rejected };
}
