/**
 * Amazon Ads Reporting API v3 配置
 * 
 * 基于亚马逊广告API专家提供的Postman集合优化
 * 参考文档: https://advertising.amazon.com/API/docs/en-us/guides/reporting/v3/report-types
 * 
 * 重要说明:
 * - SP (Sponsored Products): 使用7天归因窗口 (7d后缀)，如 sales7d, purchases7d
 * - SB (Sponsored Brands): 使用Clicks后缀，如 salesClicks, purchasesClicks
 * - SD (Sponsored Display): 使用Clicks后缀，如 salesClicks, purchasesClicks
 */

// SP Campaign 报告配置 (基于专家提供的 spCampaignDailyReport)
export const SP_CAMPAIGN_REPORT_CONFIG = {
  adProduct: 'SPONSORED_PRODUCTS',
  reportTypeId: 'spCampaigns',
  groupBy: ['campaign'],
  timeUnit: 'DAILY',
  format: 'GZIP_JSON',
  // 完整列配置 - 基于专家Postman集合
  columns: [
    // 基础信息
    'date',
    'campaignId',
    'campaignName',
    'campaignStatus',
    'campaignBudgetAmount',
    'campaignBudgetCurrencyCode',
    'campaignBudgetType',
    'campaignRuleBasedBudgetAmount',
    // 流量指标
    'impressions',
    'clicks',
    'clickThroughRate',
    // 花费指标
    'cost',
    'costPerClick',
    // 7天归因销售指标 (SP专用)
    'sales7d',
    'purchases7d',
    'unitsSoldClicks7d',
    // 同SKU指标
    'attributedSalesSameSku7d',
    'unitsSoldSameSku7d',
    'purchasesSameSku7d',
    // 14天归因指标 (可选)
    'sales14d',
    'purchases14d',
    'unitsSoldClicks14d',
    // 30天归因指标 (可选)
    'sales30d',
    'purchases30d',
    'unitsSoldClicks30d',
    // Kindle指标 (可选)
    'kindleEditionNormalizedPagesRead14d',
    'kindleEditionNormalizedPagesRoyalties14d',
  ],
  // 精简列配置 - 仅核心指标
  coreColumns: [
    'date',
    'campaignId',
    'campaignName',
    'campaignStatus',
    'campaignBudgetAmount',
    'campaignBudgetCurrencyCode',
    'impressions',
    'clicks',
    'cost',
    'sales7d',
    'purchases7d',
    'unitsSoldClicks7d',
  ],
};

// SP Campaign + AdGroup 报告配置
export const SP_CAMPAIGN_ADGROUP_REPORT_CONFIG = {
  adProduct: 'SPONSORED_PRODUCTS',
  reportTypeId: 'spCampaigns',
  groupBy: ['adGroup', 'campaign'],
  timeUnit: 'DAILY',
  format: 'GZIP_JSON',
  columns: [
    'date',
    'campaignId',
    'campaignName',
    'campaignStatus',
    'campaignBudgetAmount',
    'campaignBudgetCurrencyCode',
    'adGroupId',
    'adGroupName',
    'impressions',
    'clicks',
    'cost',
    'sales7d',
    'purchases7d',
    'unitsSoldClicks7d',
    'attributedSalesSameSku7d',
    'unitsSoldSameSku7d',
  ],
};

// SP Targeting 报告配置 (关键词/定向)
export const SP_TARGETING_REPORT_CONFIG = {
  adProduct: 'SPONSORED_PRODUCTS',
  reportTypeId: 'spTargeting',
  groupBy: ['targeting'],
  timeUnit: 'DAILY',
  format: 'GZIP_JSON',
  columns: [
    'date',
    'campaignId',
    'campaignName',
    'adGroupId',
    'adGroupName',
    'targetId',
    'targetingExpression',
    'targetingText',
    'keywordType',
    'matchType',
    'adKeywordStatus',
    'impressions',
    'clicks',
    'clickThroughRate',
    'cost',
    'costPerClick',
    'sales7d',
    'purchases7d',
    'unitsSoldClicks7d',
    'acosClicks7d',
    'roasClicks7d',
    // 14天归因
    'sales14d',
    'purchases14d',
    'acosClicks14d',
    'roasClicks14d',
  ],
  coreColumns: [
    'date',
    'campaignId',
    'campaignName',
    'adGroupId',
    'adGroupName',
    'targetId',
    'targetingText',
    'matchType',
    'impressions',
    'clicks',
    'cost',
    'sales7d',
    'purchases7d',
  ],
};

// SP Search Term 报告配置
export const SP_SEARCH_TERM_REPORT_CONFIG = {
  adProduct: 'SPONSORED_PRODUCTS',
  reportTypeId: 'spSearchTerm',
  groupBy: ['searchTerm'],
  timeUnit: 'DAILY',
  format: 'GZIP_JSON',
  columns: [
    'date',
    'campaignId',
    'campaignName',
    'adGroupId',
    'adGroupName',
    'targetId',
    'targetingText',
    'matchType',
    'searchTerm',
    'impressions',
    'clicks',
    'cost',
    'sales7d',
    'purchases7d',
    'unitsSoldClicks7d',
  ],
};

// SB Campaign 报告配置 (基于专家提供的 sbCampaignDailyReport)
export const SB_CAMPAIGN_REPORT_CONFIG = {
  adProduct: 'SPONSORED_BRANDS',
  reportTypeId: 'sbCampaigns',
  groupBy: ['campaign'],
  timeUnit: 'DAILY',
  format: 'GZIP_JSON',
  // 完整列配置 - 基于专家Postman集合
  columns: [
    // 基础信息
    'date',
    'campaignId',
    'campaignName',
    'campaignStatus',
    'campaignBudgetAmount',
    'campaignBudgetCurrencyCode',
    'campaignBudgetType',
    'campaignRuleBasedBudgetAmount',
    'costType',
    'startDate',
    'endDate',
    // 流量指标
    'impressions',
    'clicks',
    'viewClickThroughRate',
    'viewabilityRate',
    'viewableImpressions',
    // 花费指标
    'cost',
    // 销售指标 (SB使用Clicks后缀)
    'sales',
    'salesClicks',
    'salesPromoted',
    'purchases',
    'purchasesClicks',
    'purchasesPromoted',
    'unitsSold',
    'unitsSoldClicks',
    // 详情页浏览
    'detailPageViews',
    'detailPageViewsClicks',
    // 加购指标
    'addToCart',
    'addToCartClicks',
    'addToCartRate',
    'eCPAddToCart',
    // 品牌搜索
    'brandedSearches',
    'brandedSearchesClicks',
    // 新客指标
    'newToBrandPurchases',
    'newToBrandPurchasesClicks',
    'newToBrandPurchasesPercentage',
    'newToBrandPurchasesRate',
    'newToBrandSales',
    'newToBrandSalesClicks',
    'newToBrandSalesPercentage',
    'newToBrandUnitsSold',
    'newToBrandUnitsSoldClicks',
    'newToBrandUnitsSoldPercentage',
    'newToBrandDetailPageViews',
    'newToBrandDetailPageViewsClicks',
    'newToBrandDetailPageViewRate',
    'newToBrandECPDetailPageView',
    // 搜索份额
    'topOfSearchImpressionShare',
    // 视频指标
    'video5SecondViewRate',
    'video5SecondViews',
    'videoCompleteViews',
    'videoFirstQuartileViews',
    'videoMidpointViews',
    'videoThirdQuartileViews',
    'videoUnmutes',
  ],
  // 精简列配置 - 仅核心指标
  coreColumns: [
    'date',
    'campaignId',
    'campaignName',
    'campaignStatus',
    'campaignBudgetAmount',
    'campaignBudgetCurrencyCode',
    'impressions',
    'clicks',
    'cost',
    'sales',
    'salesClicks',
    'purchases',
    'purchasesClicks',
    'unitsSoldClicks',
  ],
  // 筛选条件
  filters: [
    {
      field: 'campaignStatus',
      values: ['ARCHIVED', 'ENABLED', 'PAUSED'],
    },
  ],
};

// SB Targeting 报告配置
export const SB_TARGETING_REPORT_CONFIG = {
  adProduct: 'SPONSORED_BRANDS',
  reportTypeId: 'sbTargeting',
  groupBy: ['targeting'],
  timeUnit: 'DAILY',
  format: 'GZIP_JSON',
  columns: [
    'date',
    'campaignId',
    'campaignName',
    'adGroupId',
    'adGroupName',
    'keywordId',
    'keywordText',
    'keywordStatus',
    'keywordBid',
    'matchType',
    'impressions',
    'clicks',
    'cost',
    'sales',
    'salesClicks',
    'purchases',
    'purchasesClicks',
    'unitsSoldClicks',
    'newToBrandPurchasesClicks',
    'newToBrandSalesClicks',
  ],
  filters: [
    {
      field: 'keywordStatus',
      values: ['ARCHIVED', 'ENABLED', 'PAUSED'],
    },
    {
      field: 'keywordType',
      values: ['TARGETING_EXPRESSION', 'TARGETING_EXPRESSION_PREDEFINED'],
    },
  ],
};

// SB Search Term 报告配置
export const SB_SEARCH_TERM_REPORT_CONFIG = {
  adProduct: 'SPONSORED_BRANDS',
  reportTypeId: 'sbSearchTerm',
  groupBy: ['searchTerm'],
  timeUnit: 'DAILY',
  format: 'GZIP_JSON',
  columns: [
    'date',
    'campaignId',
    'campaignName',
    'adGroupId',
    'adGroupName',
    'keywordId',
    'keywordText',
    'matchType',
    'searchTerm',
    'impressions',
    'clicks',
    'cost',
    'sales',
    'purchases',
  ],
};

// SD Campaign 报告配置 (基于专家提供的 sdCampaignDailyReport)
// ✅ 确认: reportTypeId: 'sdCampaigns' 是正确的（Postman中有954次使用）
export const SD_CAMPAIGN_REPORT_CONFIG = {
  adProduct: 'SPONSORED_DISPLAY',
  reportTypeId: 'sdCampaigns',
  groupBy: ['campaign'],
  timeUnit: 'DAILY',
  format: 'GZIP_JSON',
  // 完整列配置 - 基于专家Postman集合
  columns: [
    // 基础信息
    'date',
    'campaignId',
    'campaignName',
    'campaignBudgetCurrencyCode',
    // 流量指标
    'impressions',
    'impressionsViews',
    'impressionsFrequencyAverage',
    'cumulativeReach',
    'clicks',
    'viewClickThroughRate',
    'viewabilityRate',
    // 花费指标
    'cost',
    'costType',
    // 销售指标 (SD使用Clicks后缀)
    'sales',
    'salesClicks',
    'salesPromotedClicks',
    'purchases',
    'purchasesClicks',
    'purchasesPromotedClicks',
    'unitsSold',
    'unitsSoldClicks',
    // 详情页浏览
    'detailPageViews',
    'detailPageViewsClicks',
    // 加购指标
    'addToCart',
    'addToCartClicks',
    'addToCartViews',
    'addToCartRate',
    'eCPAddToCart',
    // 品牌搜索
    'brandedSearches',
    'brandedSearchesClicks',
    'brandedSearchesViews',
    'brandedSearchRate',
    'eCPBrandSearch',
    // 新客指标
    'newToBrandPurchases',
    'newToBrandPurchasesClicks',
    'newToBrandSales',
    'newToBrandSalesClicks',
    'newToBrandUnitsSold',
    'newToBrandUnitsSoldClicks',
    'newToBrandDetailPageViews',
    'newToBrandDetailPageViewClicks',
    'newToBrandDetailPageViewViews',
    'newToBrandDetailPageViewRate',
    'newToBrandECPDetailPageView',
    // 视频指标
    'videoCompleteViews',
    'videoFirstQuartileViews',
    'videoMidpointViews',
    'videoThirdQuartileViews',
    'videoUnmutes',
  ],
  // 精简列配置 - 仅核心指标
  coreColumns: [
    'date',
    'campaignId',
    'campaignName',
    'campaignBudgetCurrencyCode',
    'impressions',
    'clicks',
    'cost',
    'sales',
    'salesClicks',
    'purchases',
    'purchasesClicks',
    'unitsSoldClicks',
  ],
};

// SD Targeting 报告配置
export const SD_TARGETING_REPORT_CONFIG = {
  adProduct: 'SPONSORED_DISPLAY',
  reportTypeId: 'sdTargeting',
  groupBy: ['targeting'],
  timeUnit: 'DAILY',
  format: 'GZIP_JSON',
  columns: [
    'date',
    'campaignId',
    'campaignName',
    'adGroupId',
    'adGroupName',
    'targetId',
    'targetingExpression',
    'impressions',
    'clicks',
    'cost',
    'sales',
    'salesClicks',
    'purchases',
    'purchasesClicks',
    'unitsSoldClicks',
    'detailPageViewsClicks',
    'newToBrandPurchasesClicks',
    'newToBrandSalesClicks',
  ],
};

// SD AdGroup 报告配置
export const SD_ADGROUP_REPORT_CONFIG = {
  adProduct: 'SPONSORED_DISPLAY',
  reportTypeId: 'sdAdGroup',
  groupBy: ['adGroup'],
  timeUnit: 'DAILY',
  format: 'GZIP_JSON',
  columns: [
    'date',
    'campaignId',
    'campaignName',
    'adGroupId',
    'adGroupName',
    'impressions',
    'clicks',
    'cost',
    'sales',
    'salesClicks',
    'purchases',
    'purchasesClicks',
    'unitsSoldClicks',
  ],
};

/**
 * 字段映射配置
 * 将API返回的字段名映射到统一的内部字段名
 */
export const FIELD_MAPPING = {
  // SP字段映射 (7天归因)
  SP: {
    // 销售额
    sales: ['sales7d', 'sales14d', 'sales30d', 'sales1d'],
    // 订单数
    orders: ['purchases7d', 'purchases14d', 'purchases30d', 'purchases1d'],
    // 售出单位
    unitsSold: ['unitsSoldClicks7d', 'unitsSoldClicks14d', 'unitsSoldClicks30d', 'unitsSoldClicks1d'],
    // 花费
    spend: ['cost', 'spend'],
    // ACoS
    acos: ['acosClicks7d', 'acosClicks14d'],
    // ROAS
    roas: ['roasClicks7d', 'roasClicks14d'],
  },
  // SB字段映射 (Clicks后缀)
  SB: {
    // 销售额
    sales: ['salesClicks', 'sales', 'salesPromoted'],
    // 订单数
    orders: ['purchasesClicks', 'purchases', 'purchasesPromoted'],
    // 售出单位
    unitsSold: ['unitsSoldClicks', 'unitsSold'],
    // 花费
    spend: ['cost'],
    // ACoS
    acos: ['acos'],
    // ROAS
    roas: ['roas'],
  },
  // SD字段映射 (Clicks后缀)
  SD: {
    // 销售额
    sales: ['salesClicks', 'sales', 'salesPromotedClicks'],
    // 订单数
    orders: ['purchasesClicks', 'purchases', 'purchasesPromotedClicks'],
    // 售出单位
    unitsSold: ['unitsSoldClicks', 'unitsSold'],
    // 花费
    spend: ['cost'],
    // ACoS
    acos: ['acos'],
    // ROAS
    roas: ['roas'],
  },
};

/**
 * 从API响应中提取统一的指标值
 */
export function extractMetric(
  data: Record<string, any>,
  adType: 'SP' | 'SB' | 'SD',
  metricName: keyof typeof FIELD_MAPPING.SP
): number {
  const mapping = FIELD_MAPPING[adType];
  const fieldNames = mapping[metricName] || [];
  
  for (const fieldName of fieldNames) {
    const value = data[fieldName];
    if (value !== undefined && value !== null && value !== '') {
      const numValue = typeof value === 'string' ? parseFloat(value) : value;
      if (!isNaN(numValue)) {
        return numValue;
      }
    }
  }
  
  return 0;
}

/**
 * 计算ACoS
 */
export function calculateAcos(spend: number, sales: number): number {
  if (sales === 0) return 0;
  return (spend / sales) * 100;
}

/**
 * 计算ROAS
 */
export function calculateRoas(sales: number, spend: number): number {
  if (spend === 0) return 0;
  return sales / spend;
}

/**
 * 计算CTR
 */
export function calculateCtr(clicks: number, impressions: number): number {
  if (impressions === 0) return 0;
  return (clicks / impressions) * 100;
}

/**
 * 计算CVR (转化率)
 */
export function calculateCvr(orders: number, clicks: number): number {
  if (clicks === 0) return 0;
  return (orders / clicks) * 100;
}

/**
 * 计算CPC
 */
export function calculateCpc(spend: number, clicks: number): number {
  if (clicks === 0) return 0;
  return spend / clicks;
}
