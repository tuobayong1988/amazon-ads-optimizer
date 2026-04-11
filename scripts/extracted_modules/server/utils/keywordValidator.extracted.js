// Extracted from production dist/index.js
// Original module: server/utils/keywordValidator.ts
// Lines: 125

function sanitizeAndValidateKeyword(text2, mode = "positive") {
  let sanitized = (text2 || "").trim();
  sanitized = sanitized.replace(CONTROL_CHARS_REGEX, "");
  sanitized = sanitized.replace(INVALID_CHARS_REGEX, " ");
  sanitized = sanitized.replace(/\s+/g, " ").trim();
  if (!sanitized || sanitized.length === 0) {
    return {
      isValid: false,
      sanitizedText: "",
      reasonCode: "EMPTY_AFTER_SANITIZE",
      reasonMessage: `\u5173\u952E\u8BCD"${text2}"\u6E05\u6D17\u540E\u4E3A\u7A7A\uFF0C\u5305\u542B\u7684\u5168\u90E8\u662F\u65E0\u6548\u5B57\u7B26`
    };
  }
  if (sanitized.length > MAX_KEYWORD_CHARS) {
    return {
      isValid: false,
      sanitizedText: sanitized,
      reasonCode: "EXCEEDS_MAX_LENGTH",
      reasonMessage: `\u5173\u952E\u8BCD\u957F\u5EA6${sanitized.length}\u8D85\u8FC7Amazon\u9650\u5236\u7684${MAX_KEYWORD_CHARS}\u5B57\u7B26`
    };
  }
  const words = sanitized.split(/\s+/);
  const wordCount = words.length;
  if (mode === "positive" && wordCount > MAX_POSITIVE_WORD_COUNT) {
    return {
      isValid: false,
      sanitizedText: sanitized,
      reasonCode: "EXCEEDS_MAX_WORDS",
      reasonMessage: `\u5173\u952E\u8BCD\u8BCD\u6570${wordCount}\u8D85\u8FC7Amazon\u9650\u5236\u7684${MAX_POSITIVE_WORD_COUNT}\u4E2A\u8BCD`
    };
  }
  if (mode === "negative_phrase" && wordCount > MAX_NEGATIVE_PHRASE_WORD_COUNT) {
    return {
      isValid: false,
      sanitizedText: sanitized,
      reasonCode: "EXCEEDS_MAX_WORDS_NEG_PHRASE",
      reasonMessage: `\u5426\u5B9A\u77ED\u8BED\u8BCD\u6570${wordCount}\u8D85\u8FC7Amazon\u9650\u5236\u7684${MAX_NEGATIVE_PHRASE_WORD_COUNT}\u4E2A\u8BCD`
    };
  }
  if (mode === "negative_exact" && wordCount > MAX_NEGATIVE_EXACT_WORD_COUNT) {
    return {
      isValid: false,
      sanitizedText: sanitized,
      reasonCode: "EXCEEDS_MAX_WORDS_NEG_EXACT",
      reasonMessage: `\u5426\u5B9A\u7CBE\u786E\u8BCD\u6570${wordCount}\u8D85\u8FC7Amazon\u9650\u5236\u7684${MAX_NEGATIVE_EXACT_WORD_COUNT}\u4E2A\u8BCD`
    };
  }
  return {
    isValid: true,
    sanitizedText: sanitized
  };
}
function isAsinSearchTerm(searchTerm) {
  const cleaned = searchTerm.trim().toUpperCase();
  if (/^B0[A-Z0-9]{8}$/.test(cleaned)) return true;
  if (/^B0[A-Z0-9]{8,}$/.test(cleaned)) return true;
  return false;
}
function canAddPositiveKeyword(campaignTargetingType, campaignName) {
  if (campaignTargetingType === "auto") return false;
  if (campaignName && isProductTargetingCampaign(campaignName)) return false;
  return true;
}
function isProductTargetingCampaign(campaignName) {
  if (!campaignName) return false;
  const name2 = campaignName.toUpperCase();
  const ptPatterns = [
    /[-_\s]POE[-_\s]/,
    // POE = Product + Other + Exact
    /[-_\s]POB[-_\s]/,
    // POB = Product + Other + Broad  
    /[-_\s]PT[-_\s]/,
    // PT = Product Targeting
    /[-_\s]ASIN[-_\s]/,
    // ASIN定向
    /PRODUCT[\s_-]?TARGET/i
    // Product Targeting / Product_Target
  ];
  return ptPatterns.some((pattern) => pattern.test(`-${name2}-`));
}
async function adGroupHasProductTargets(adGroupId, conn) {
  let ownConn = false;
  try {
    if (!conn) {
      conn = await getDirectConnection();
      ownConn = true;
    }
    const [rows] = await conn.execute(
      "SELECT COUNT(*) AS cnt FROM product_targets WHERE internal_ad_group_id = ? AND targetId IS NOT NULL LIMIT 1",
      [adGroupId]
    );
    return (rows[0]?.cnt || 0) > 0;
  } catch (err) {
    log33.warn(`[KeywordValidator] \u68C0\u67E5\u5E7F\u544A\u7EC4product targets\u5931\u8D25: ${err.message}`);
    return false;
  } finally {
    if (ownConn && conn) {
      try {
        conn.release();
      } catch (_) {
      }
    }
  }
}
var log33, INVALID_CHARS_REGEX, CONTROL_CHARS_REGEX, MAX_KEYWORD_CHARS, MAX_POSITIVE_WORD_COUNT, MAX_NEGATIVE_PHRASE_WORD_COUNT, MAX_NEGATIVE_EXACT_WORD_COUNT;
var init_keywordValidator = __esm({
  "server/utils/keywordValidator.ts"() {
    "use strict";
    init_logger();
    init_db2();
    log33 = createModuleLogger("KeywordValidator");
    INVALID_CHARS_REGEX = /[^a-zA-Z0-9\s\-\u00C0-\u024F\u1E00-\u1EFF]/g;
    CONTROL_CHARS_REGEX = /[\u0000-\u001F\u007F-\u009F\uFFFE\uFFFF\uFEFF\uFFFC\uFFFD\u200B-\u200F\u2028-\u202F\u2060-\u206F\uE000-\uF8FF\uFE00-\uFE0F]/g;
    MAX_KEYWORD_CHARS = 80;
    MAX_POSITIVE_WORD_COUNT = 10;
    MAX_NEGATIVE_PHRASE_WORD_COUNT = 4;
    MAX_NEGATIVE_EXACT_WORD_COUNT = 10;
    __name(sanitizeAndValidateKeyword, "sanitizeAndValidateKeyword");
    __name(isAsinSearchTerm, "isAsinSearchTerm");
    __name(canAddPositiveKeyword, "canAddPositiveKeyword");
    __name(isProductTargetingCampaign, "isProductTargetingCampaign");
    __name(adGroupHasProductTargets, "adGroupHasProductTargets");
  }
});

