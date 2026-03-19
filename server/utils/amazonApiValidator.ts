/**
 * Amazon Ads Optimizer — API Parameter Pre-flight Validator (v418)
 * 
 * API参数预检验证层，在请求发送前验证所有参数是否符合Amazon API规范。
 * 
 * ═══════════════════════════════════════════════════════════════════
 * 设计目标：
 * 
 * 1. 在开发阶段捕获reportTypeId、groupBy、columns等配置错误
 *    （类似BUG-A1 sdMatchedTarget和BUG-A2 sbCampaigns的错误）
 * 2. 在运行时验证写入类API（update/create）的ID参数格式
 * 3. 提供清晰的错误信息，帮助快速定位问题
 * 4. 基于Amazon官方Postman集合派生的验证规则
 * 
 * 使用方式：
 * - 报告请求前：validateReportRequest(config)
 * - 写入API前：validateEntityUpdate(entityType, updates)
 * - 开发时：runFullValidation() 检查所有静态配置
 * ═══════════════════════════════════════════════════════════════════
 */

import { createModuleLogger } from './logger';
// isValidAmazonId from idTypes accepts Record<string, unknown> but works with string/number at runtime
import { isValidAmazonId } from './idTypes';

const log = createModuleLogger('ApiValidator');

// ==================== 验证规则定义 ====================

/** Amazon Ads API V3 所有有效的 reportTypeId */
export const VALID_REPORT_TYPE_IDS = new Set([
  // SP (Sponsored Products)
  'spCampaigns', 'spTargeting', 'spSearchTerm', 'spAdvertisedProduct',
  'spPurchasedProduct', 'spAdGroup', 'spGrossAndInvalids',
  // SB (Sponsored Brands)
  'sbCampaigns', 'sbTargeting', 'sbSearchTerm', 'sbCampaignPlacement',
  'sbAds', 'sbAdGroup', 'sbGrossAndInvalids',
  // SD (Sponsored Display)
  'sdCampaigns', 'sdTargeting', 'sdAdvertisedProduct',
  'sdAdGroup', 'sdPurchasedProduct', 'sdGrossAndInvalids',
]);

/** reportTypeId → 有效的 adProduct 映射 */
export const REPORT_TYPE_AD_PRODUCT: Record<string, string> = {
  spCampaigns: 'SPONSORED_PRODUCTS',
  spTargeting: 'SPONSORED_PRODUCTS',
  spSearchTerm: 'SPONSORED_PRODUCTS',
  spAdvertisedProduct: 'SPONSORED_PRODUCTS',
  spPurchasedProduct: 'SPONSORED_PRODUCTS',
  spAdGroup: 'SPONSORED_PRODUCTS',
  spGrossAndInvalids: 'SPONSORED_PRODUCTS',
  sbCampaigns: 'SPONSORED_BRANDS',
  sbTargeting: 'SPONSORED_BRANDS',
  sbSearchTerm: 'SPONSORED_BRANDS',
  sbCampaignPlacement: 'SPONSORED_BRANDS',
  sbAds: 'SPONSORED_BRANDS',
  sbAdGroup: 'SPONSORED_BRANDS',
  sbGrossAndInvalids: 'SPONSORED_BRANDS',
  sdCampaigns: 'SPONSORED_DISPLAY',
  sdTargeting: 'SPONSORED_DISPLAY',
  sdAdvertisedProduct: 'SPONSORED_DISPLAY',
  sdAdGroup: 'SPONSORED_DISPLAY',
  sdPurchasedProduct: 'SPONSORED_DISPLAY',
  sdGrossAndInvalids: 'SPONSORED_DISPLAY',
};

/** reportTypeId → 有效的 groupBy 组合（基于Postman集合） */
export const VALID_GROUP_BY: Record<string, string[][]> = {
  // SP
  spCampaigns: [['campaign'], ['adGroup', 'campaign'], ['campaign', 'placement']],
  spTargeting: [['targeting']],
  spSearchTerm: [['searchTerm']],
  spAdvertisedProduct: [['advertiser']],
  spPurchasedProduct: [['asin']],
  spAdGroup: [['adGroup']],
  spGrossAndInvalids: [['campaign']],
  // SB
  sbCampaigns: [['campaign']],
  sbTargeting: [['targeting']],
  sbSearchTerm: [['searchTerm']],
  sbCampaignPlacement: [['campaignPlacement']],
  sbAds: [['ads']],
  sbAdGroup: [['adGroup']],
  sbGrossAndInvalids: [['campaign']],
  // SD
  sdCampaigns: [['campaign'], ['campaign', 'matchedTarget']],
  sdTargeting: [['targeting'], ['matchedTarget']],
  sdAdvertisedProduct: [['advertiser']],
  sdAdGroup: [['adGroup']],
  sdPurchasedProduct: [['asin']],
  sdGrossAndInvalids: [['campaign']],
};

/** 有效的 timeUnit 值 */
export const VALID_TIME_UNITS = new Set(['DAILY', 'SUMMARY']);

/** 有效的 adProduct 值 */
export const VALID_AD_PRODUCTS = new Set([
  'SPONSORED_PRODUCTS', 'SPONSORED_BRANDS', 'SPONSORED_DISPLAY',
]);

// ==================== 常用字段名集合（基于Postman集合） ====================

/** SP报告中常见的有效列名 */
const SP_COMMON_COLUMNS = new Set([
  'acosClicks14d', 'acosClicks7d', 'adGroupId', 'adGroupName', 'adId',
  'adKeywordStatus', 'adStatus', 'advertisedAsin', 'advertisedSku',
  'attributedSalesSameSku14d', 'attributedSalesSameSku1d',
  'attributedSalesSameSku30d', 'attributedSalesSameSku7d',
  'campaignApplicableBudgetRuleId', 'campaignApplicableBudgetRuleName',
  'campaignBiddingStrategy', 'campaignBudgetAmount',
  'campaignBudgetCurrencyCode', 'campaignBudgetType',
  'campaignId', 'campaignName', 'campaignRuleBasedBudgetAmount',
  'campaignStatus', 'clickThroughRate', 'clicks', 'cost', 'costPerClick',
  'date', 'endDate', 'impressions', 'keyword', 'keywordBid', 'keywordId',
  'keywordType', 'kindleEditionNormalizedPagesRead14d',
  'kindleEditionNormalizedPagesRoyalties14d', 'matchType',
  'placementClassification', 'portfolioId',
  'purchases14d', 'purchases1d', 'purchases30d', 'purchases7d',
  'purchasesSameSku14d', 'purchasesSameSku1d', 'purchasesSameSku30d',
  'purchasesSameSku7d', 'roasClicks14d', 'roasClicks7d',
  'sales14d', 'sales1d', 'sales30d', 'sales7d', 'salesOtherSku7d',
  'searchTerm', 'spend', 'startDate', 'targeting',
  'topOfSearchImpressionShare',
  'unitsSoldClicks14d', 'unitsSoldClicks1d', 'unitsSoldClicks30d',
  'unitsSoldClicks7d', 'unitsSoldOtherSku7d',
  'unitsSoldSameSku14d', 'unitsSoldSameSku1d', 'unitsSoldSameSku30d',
  'unitsSoldSameSku7d',
  // Gross & Invalid Traffic
  'grossClickThroughs', 'grossImpressions',
  'invalidClickThroughRate', 'invalidClickThroughs',
  'invalidImpressionRate', 'invalidImpressions',
  // Purchased Product
  'purchasedAsin', 'salesOtherSku14d',
  'unitsSoldOtherSku14d',
]);

/** SB报告中常见的有效列名 */
const SB_COMMON_COLUMNS = new Set([
  'acosClicks14d', 'acosClicks7d', 'adGroupId', 'adGroupName',
  'adId', 'adStatus',
  'attributedSalesSameSku14d', 'attributedSalesSameSku7d',
  'campaignBudgetAmount', 'campaignBudgetCurrencyCode',
  'campaignBudgetType', 'campaignId', 'campaignName', 'campaignStatus',
  'clickThroughRate', 'clicks', 'cost', 'costPerClick',
  'date', 'dpv14d', 'impressions',
  'keywordBid', 'keywordId', 'keywordStatus', 'keywordText', 'keywordType',
  'matchType', 'placementClassification', 'portfolioId',
  'purchases14d', 'purchases7d', 'purchasesSameSku14d', 'purchasesSameSku7d',
  'roasClicks14d', 'roasClicks7d',
  'sales14d', 'sales7d', 'searchTerm', 'spend',
  'targeting', 'topOfSearchImpressionShare',
  'unitsSoldClicks14d', 'unitsSoldClicks7d',
  'unitsSoldSameSku14d', 'unitsSoldSameSku7d',
  'video5SecondViewRate', 'video5SecondViews',
  'videoCompleteViews', 'videoFirstQuartileViews',
  'videoMidpointViews', 'videoThirdQuartileViews',
  'videoUnmutes', 'viewableImpressions', 'viewClickThroughRate',
  // Gross & Invalid Traffic
  'grossClickThroughs', 'grossImpressions',
  'invalidClickThroughRate', 'invalidClickThroughs',
  'invalidImpressionRate', 'invalidImpressions',
]);

/** SD报告中常见的有效列名 */
const SD_COMMON_COLUMNS = new Set([
  'acosClicks14d', 'acosClicks7d', 'adGroupId', 'adGroupName',
  'adId', 'advertisedAsin', 'advertisedSku',
  'attributedSalesSameSku14d', 'attributedSalesSameSku7d',
  'campaignBudgetAmount', 'campaignBudgetCurrencyCode',
  'campaignBudgetType', 'campaignId', 'campaignName', 'campaignStatus',
  'clickThroughRate', 'clicks', 'cost', 'costPerClick',
  'date', 'dpv14d', 'impressions',
  'matchedTarget', 'portfolioId',
  'purchases14d', 'purchases7d', 'purchasesSameSku14d', 'purchasesSameSku7d',
  'roasClicks14d', 'roasClicks7d',
  'sales14d', 'sales7d', 'spend', 'targeting',
  'unitsSoldClicks14d', 'unitsSoldClicks7d',
  'unitsSoldSameSku14d', 'unitsSoldSameSku7d',
  'viewableImpressions', 'viewAttributedConversions14d',
  'viewAttributedSales14d', 'viewAttributedUnitsOrdered14d',
  'viewImpressions', 'viewClickThroughRate',
  // Gross & Invalid Traffic
  'grossClickThroughs', 'grossImpressions',
  'invalidClickThroughRate', 'invalidClickThroughs',
  'invalidImpressionRate', 'invalidImpressions',
  // Purchased Product
  'purchasedAsin', 'salesOtherSku14d', 'unitsSoldOtherSku14d',
]);

// ==================== 验证结果类型 ====================

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// ==================== 报告请求验证 ====================

export interface ReportRequestConfig {
  adProduct?: string;
  reportTypeId: string;
  groupBy: string[];
  columns: string[];
  timeUnit?: string;
}

/**
 * 验证报告请求配置是否符合Amazon API规范
 * 
 * @param config - 报告请求配置
 * @param callerName - 调用方名称（用于日志）
 * @returns 验证结果
 */
export function validateReportRequest(config: ReportRequestConfig, callerName?: string): ValidationResult {
  const result: ValidationResult = { valid: true, errors: [], warnings: [] };
  const prefix = callerName ? `[${callerName}] ` : '';

  // 1. 验证 reportTypeId
  if (!VALID_REPORT_TYPE_IDS.has(config.reportTypeId)) {
    result.valid = false;
    result.errors.push(
      `${prefix}Invalid reportTypeId: '${config.reportTypeId}'. ` +
      `Valid values: ${Array.from(VALID_REPORT_TYPE_IDS).join(', ')}`
    );
    return result; // 无法继续验证
  }

  // 2. 验证 adProduct 与 reportTypeId 的一致性
  if (config.adProduct) {
    const expectedAdProduct = REPORT_TYPE_AD_PRODUCT[config.reportTypeId];
    if (config.adProduct !== expectedAdProduct) {
      result.valid = false;
      result.errors.push(
        `${prefix}adProduct mismatch: reportTypeId '${config.reportTypeId}' requires ` +
        `adProduct '${expectedAdProduct}', but got '${config.adProduct}'`
      );
    }
  }

  // 3. 验证 groupBy
  const validGroupBys = VALID_GROUP_BY[config.reportTypeId];
  if (validGroupBys) {
    const sortedInput = [...config.groupBy].sort();
    const isValid = validGroupBys.some(valid => {
      const sortedValid = [...valid].sort();
      return sortedInput.length === sortedValid.length &&
        sortedInput.every((v, i) => v === sortedValid[i]);
    });

    if (!isValid) {
      result.valid = false;
      result.errors.push(
        `${prefix}Invalid groupBy for reportTypeId '${config.reportTypeId}': ` +
        `got [${config.groupBy.join(', ')}], ` +
        `valid combinations: ${validGroupBys.map(g => `[${g.join(', ')}]`).join(' | ')}`
      );
    }
  }

  // 4. 验证 timeUnit
  if (config.timeUnit && !VALID_TIME_UNITS.has(config.timeUnit)) {
    result.valid = false;
    result.errors.push(
      `${prefix}Invalid timeUnit: '${config.timeUnit}'. Valid values: DAILY, SUMMARY`
    );
  }

  // 5. 验证 columns（警告级别 - 不阻止请求但记录可疑列名）
  if (config.columns.length > 0) {
    const adProductPrefix = config.reportTypeId.substring(0, 2);
    let validColumns: Set<string>;
    switch (adProductPrefix) {
      case 'sp': validColumns = SP_COMMON_COLUMNS; break;
      case 'sb': validColumns = SB_COMMON_COLUMNS; break;
      case 'sd': validColumns = SD_COMMON_COLUMNS; break;
      default: validColumns = new Set();
    }

    const unknownColumns = config.columns.filter(c => !validColumns.has(c));
    if (unknownColumns.length > 0) {
      result.warnings.push(
        `${prefix}Potentially unknown columns for ${config.reportTypeId}: ` +
        `[${unknownColumns.join(', ')}]. These may be valid but are not in the known column set.`
      );
    }
  }

  // 6. 验证 timeUnit:SUMMARY 不应包含 'date' 列
  if (config.timeUnit === 'SUMMARY' && config.columns.includes('date')) {
    result.valid = false;
    result.errors.push(
      `${prefix}Column 'date' is not compatible with timeUnit 'SUMMARY'. ` +
      `Remove 'date' from columns or use timeUnit 'DAILY'.`
    );
  }

  return result;
}

// ==================== 实体更新验证 ====================

export type EntityUpdateType = 
  | 'keyword_bid' 
  | 'keyword_status' 
  | 'target_bid' 
  | 'target_status'
  | 'campaign_budget' 
  | 'campaign_status'
  | 'adGroup_status'
  | 'create_keyword'
  | 'create_negative_keyword'
  | 'create_negative_target'
  | 'create_product_target';

/**
 * 验证实体更新请求中的ID参数
 * 确保传给Amazon API的ID是有效的Amazon ID格式
 * 
 * @param updateType - 更新类型
 * @param params - 更新参数
 * @returns 验证结果
 */
export function validateEntityUpdate(
  updateType: EntityUpdateType,
  params: Record<string, unknown>
): ValidationResult {
  const result: ValidationResult = { valid: true, errors: [], warnings: [] };

  switch (updateType) {
    case 'keyword_bid':
    case 'keyword_status':
      if (!params.keywordId || !isValidAmazonId(params.keywordId)) {
        result.valid = false;
        result.errors.push(`Invalid Amazon keywordId: '${params.keywordId}'. Must be a numeric string.`);
      }
      if (updateType === 'keyword_bid' && (typeof params.bid !== 'number' || params.bid <= 0)) {
        result.valid = false;
        result.errors.push(`Invalid bid value: ${params.bid}. Must be a positive number.`);
      }
      break;

    case 'target_bid':
    case 'target_status':
      if (!params.targetId || !isValidAmazonId(params.targetId)) {
        result.valid = false;
        result.errors.push(`Invalid Amazon targetId: '${params.targetId}'. Must be a numeric string.`);
      }
      if (updateType === 'target_bid' && (typeof params.bid !== 'number' || params.bid <= 0)) {
        result.valid = false;
        result.errors.push(`Invalid bid value: ${params.bid}. Must be a positive number.`);
      }
      break;

    case 'campaign_budget':
    case 'campaign_status':
      if (!params.campaignId || !isValidAmazonId(params.campaignId)) {
        result.valid = false;
        result.errors.push(`Invalid Amazon campaignId: '${params.campaignId}'. Must be a numeric string.`);
      }
      break;

    case 'adGroup_status':
      if (!params.adGroupId || !isValidAmazonId(params.adGroupId)) {
        result.valid = false;
        result.errors.push(`Invalid Amazon adGroupId: '${params.adGroupId}'. Must be a numeric string.`);
      }
      break;

    case 'create_keyword':
      if (!params.adGroupId || !isValidAmazonId(params.adGroupId)) {
        result.valid = false;
        result.errors.push(`Invalid Amazon adGroupId for keyword creation: '${params.adGroupId}'.`);
      }
      if (!params.campaignId || !isValidAmazonId(params.campaignId)) {
        result.valid = false;
        result.errors.push(`Invalid Amazon campaignId for keyword creation: '${params.campaignId}'.`);
      }
      if (!params.keywordText || typeof params.keywordText !== 'string' || params.keywordText.trim().length === 0) {
        result.valid = false;
        result.errors.push(`Invalid keywordText: must be a non-empty string.`);
      }
      if (!params.matchType || !['EXACT', 'PHRASE', 'BROAD'].includes(params.matchType)) {
        result.valid = false;
        result.errors.push(`Invalid matchType: '${params.matchType}'. Must be EXACT, PHRASE, or BROAD.`);
      }
      break;

    case 'create_negative_keyword':
      if (!params.campaignId || !isValidAmazonId(params.campaignId)) {
        result.valid = false;
        result.errors.push(`Invalid Amazon campaignId for negative keyword: '${params.campaignId}'.`);
      }
      // adGroupId is optional for campaign-level negative keywords
      if (params.adGroupId && !isValidAmazonId(params.adGroupId)) {
        result.valid = false;
        result.errors.push(`Invalid Amazon adGroupId for negative keyword: '${params.adGroupId}'.`);
      }
      break;

    case 'create_negative_target':
      if (!params.adGroupId || !isValidAmazonId(params.adGroupId)) {
        result.valid = false;
        result.errors.push(`Invalid Amazon adGroupId for negative target: '${params.adGroupId}'.`);
      }
      if (!params.campaignId || !isValidAmazonId(params.campaignId)) {
        result.valid = false;
        result.errors.push(`Invalid Amazon campaignId for negative target: '${params.campaignId}'.`);
      }
      break;

    case 'create_product_target':
      if (!params.adGroupId || !isValidAmazonId(params.adGroupId)) {
        result.valid = false;
        result.errors.push(`Invalid Amazon adGroupId for product target: '${params.adGroupId}'.`);
      }
      if (!params.campaignId || !isValidAmazonId(params.campaignId)) {
        result.valid = false;
        result.errors.push(`Invalid Amazon campaignId for product target: '${params.campaignId}'.`);
      }
      break;
  }

  // 通用检查：确保没有内部ID被误传
  for (const [key, value] of Object.entries(params)) {
    if (key.endsWith('Id') && typeof value === 'number' && key !== 'bid') {
      // 如果ID字段是数字类型，可能是内部ID被误传
      if (value < 1000000000) { // Amazon ID通常是10位以上的数字
        result.warnings.push(
          `Suspicious ${key}=${value}: looks like an internal ID (< 10 digits). ` +
          `Amazon IDs are typically 10+ digit numeric strings.`
        );
      }
    }
  }

  return result;
}

// ==================== 批量验证 ====================

/**
 * 批量验证实体更新列表
 */
export function validateBatchEntityUpdates(
  updateType: EntityUpdateType,
  updates: Record<string, unknown>[]
): ValidationResult {
  const result: ValidationResult = { valid: true, errors: [], warnings: [] };

  for (let i = 0; i < updates.length; i++) {
    const itemResult = validateEntityUpdate(updateType, updates[i]);
    if (!itemResult.valid) {
      result.valid = false;
      result.errors.push(...itemResult.errors.map(e => `[item ${i}] ${e}`));
    }
    result.warnings.push(...itemResult.warnings.map(w => `[item ${i}] ${w}`));
  }

  return result;
}

// ==================== 运行时验证钩子 ====================

/** 验证模式：'strict' 抛出异常, 'warn' 仅记录日志, 'silent' 不做任何事 */
let validationMode: 'strict' | 'warn' | 'silent' = 'warn';

/**
 * 设置验证模式
 * - 'strict': 验证失败时抛出异常（推荐在开发环境使用）
 * - 'warn': 验证失败时记录警告日志（推荐在生产环境使用）
 * - 'silent': 不执行验证（性能敏感场景）
 */
export function setValidationMode(mode: 'strict' | 'warn' | 'silent'): void {
  validationMode = mode;
  log.info(`Validation mode set to: ${mode}`);
}

/**
 * 预检验证钩子 - 在API请求发送前调用
 * 根据当前验证模式决定行为
 */
export function preflightValidateReport(config: ReportRequestConfig, callerName?: string): void {
  if (validationMode === 'silent') return;

  const result = validateReportRequest(config, callerName);

  if (result.warnings.length > 0) {
    for (const warning of result.warnings) {
      log.warn(`[Preflight] ${warning}`);
    }
  }

  if (!result.valid) {
    const errorMsg = `API Report Request Validation Failed:\n${result.errors.join('\n')}`;
    if (validationMode === 'strict') {
      throw new Error(errorMsg);
    } else {
      log.warn(`[Preflight] ${errorMsg}`);
    }
  }
}

/**
 * 预检验证钩子 - 在实体更新API请求发送前调用
 */
export function preflightValidateEntityUpdate(
  updateType: EntityUpdateType,
  params: Record<string, unknown>,
  callerName?: string
): void {
  if (validationMode === 'silent') return;

  const result = validateEntityUpdate(updateType, params);
  const prefix = callerName ? `[${callerName}] ` : '';

  if (result.warnings.length > 0) {
    for (const warning of result.warnings) {
      log.warn(`[Preflight] ${prefix}${warning}`);
    }
  }

  if (!result.valid) {
    const errorMsg = `${prefix}Entity Update Validation Failed:\n${result.errors.join('\n')}`;
    if (validationMode === 'strict') {
      throw new Error(errorMsg);
    } else {
      log.warn(`[Preflight] ${errorMsg}`);
    }
  }
}

// ==================== 静态配置全量检查 ====================

/**
 * 对系统中所有报告请求配置进行全量检查
 * 适合在部署前或CI/CD中运行
 * 
 * @param configs - 所有报告请求配置的数组
 * @returns 全量验证结果
 */
export function runFullValidation(
  configs: Array<{ name: string; config: ReportRequestConfig }>
): { passed: number; failed: number; warnings: number; details: string[] } {
  let passed = 0;
  let failed = 0;
  let warningCount = 0;
  const details: string[] = [];

  for (const { name, config } of configs) {
    const result = validateReportRequest(config, name);
    if (result.valid) {
      passed++;
      if (result.warnings.length > 0) {
        warningCount += result.warnings.length;
        details.push(`⚠️ ${name}: ${result.warnings.join('; ')}`);
      }
    } else {
      failed++;
      details.push(`❌ ${name}: ${result.errors.join('; ')}`);
    }
  }

  details.unshift(`\n=== API Validation Summary: ${passed} passed, ${failed} failed, ${warningCount} warnings ===\n`);
  return { passed, failed, warnings: warningCount, details };
}
