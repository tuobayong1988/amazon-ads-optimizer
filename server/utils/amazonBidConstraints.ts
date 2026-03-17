/**
 * v434: Amazon广告各类型最低/最高竞价约束配置
 * 
 * 数据来源: https://advertising.amazon.com/API/docs/en-us/concepts/limits
 * 
 * 不同广告类型(SP/SB/SD)、计费方式(CPC/vCPM)、子类型(Standard/Video)
 * 和市场(Marketplace)的最低竞价各不相同，必须严格遵守。
 * 
 * 关键差异:
 * - SP CPC: USD $0.02 (最低)
 * - SB CPC Standard: USD $0.10 (SP的5倍)
 * - SB CPC Video: USD $0.25 (SP的12.5倍)
 * - SD CPC: USD $0.02 (与SP相同)
 * - SD vCPM: USD $1.00 (完全不同的计费单位)
 * - SB vCPM (BIS): 需要更高的最低竞价
 */

export interface BidConstraint {
  minBid: number;
  maxBid: number;
}

/**
 * 按Marketplace定义的完整竞价约束表
 * 
 * 结构: marketplace -> adType -> constraint
 * adType: 'sp_cpc' | 'sb_cpc' | 'sbv_cpc' | 'sd_cpc' | 'sd_vcpm' | 'sb_vcpm'
 */
const BID_CONSTRAINTS: Record<string, Record<string, BidConstraint>> = {
  US: {
    sp_cpc:   { minBid: 0.02, maxBid: 1000 },
    sb_cpc:   { minBid: 0.10, maxBid: 49 },
    sbv_cpc:  { minBid: 0.25, maxBid: 49 },
    sd_cpc:   { minBid: 0.02, maxBid: 1000 },
    sd_vcpm:  { minBid: 1.00, maxBid: 1000 },
    sb_vcpm:  { minBid: 1.00, maxBid: 1000 },  // SB BIS vCPM
  },
  CA: {
    sp_cpc:   { minBid: 0.02, maxBid: 1000 },
    sb_cpc:   { minBid: 0.10, maxBid: 49 },
    sbv_cpc:  { minBid: 0.15, maxBid: 49 },
    sd_cpc:   { minBid: 0.02, maxBid: 1000 },
    sd_vcpm:  { minBid: 1.00, maxBid: 1000 },
    sb_vcpm:  { minBid: 1.00, maxBid: 1000 },
  },
  MX: {
    sp_cpc:   { minBid: 0.10, maxBid: 20000 },
    sb_cpc:   { minBid: 0.10, maxBid: 20000 },
    sbv_cpc:  { minBid: 0.15, maxBid: 20000 },
    sd_cpc:   { minBid: 0.10, maxBid: 20000 },
    sd_vcpm:  { minBid: 5.00, maxBid: 20000 },
    sb_vcpm:  { minBid: 5.00, maxBid: 20000 },
  },
  UK: {
    sp_cpc:   { minBid: 0.02, maxBid: 1000 },
    sb_cpc:   { minBid: 0.10, maxBid: 31 },
    sbv_cpc:  { minBid: 0.15, maxBid: 31 },
    sd_cpc:   { minBid: 0.02, maxBid: 1000 },
    sd_vcpm:  { minBid: 1.00, maxBid: 1000 },
    sb_vcpm:  { minBid: 1.00, maxBid: 1000 },
  },
  DE: {
    sp_cpc:   { minBid: 0.02, maxBid: 1000 },
    sb_cpc:   { minBid: 0.10, maxBid: 39 },
    sbv_cpc:  { minBid: 0.15, maxBid: 39 },
    sd_cpc:   { minBid: 0.02, maxBid: 1000 },
    sd_vcpm:  { minBid: 1.00, maxBid: 1000 },
    sb_vcpm:  { minBid: 1.00, maxBid: 1000 },
  },
  FR: {
    sp_cpc:   { minBid: 0.02, maxBid: 1000 },
    sb_cpc:   { minBid: 0.10, maxBid: 39 },
    sbv_cpc:  { minBid: 0.15, maxBid: 39 },
    sd_cpc:   { minBid: 0.02, maxBid: 1000 },
    sd_vcpm:  { minBid: 1.00, maxBid: 1000 },
    sb_vcpm:  { minBid: 1.00, maxBid: 1000 },
  },
  ES: {
    sp_cpc:   { minBid: 0.02, maxBid: 1000 },
    sb_cpc:   { minBid: 0.10, maxBid: 39 },
    sbv_cpc:  { minBid: 0.15, maxBid: 39 },
    sd_cpc:   { minBid: 0.02, maxBid: 1000 },
    sd_vcpm:  { minBid: 1.00, maxBid: 1000 },
    sb_vcpm:  { minBid: 1.00, maxBid: 1000 },
  },
  IT: {
    sp_cpc:   { minBid: 0.02, maxBid: 1000 },
    sb_cpc:   { minBid: 0.10, maxBid: 39 },
    sbv_cpc:  { minBid: 0.15, maxBid: 39 },
    sd_cpc:   { minBid: 0.02, maxBid: 1000 },
    sd_vcpm:  { minBid: 1.00, maxBid: 1000 },
    sb_vcpm:  { minBid: 1.00, maxBid: 1000 },
  },
  NL: {
    sp_cpc:   { minBid: 0.02, maxBid: 1000 },
    sb_cpc:   { minBid: 0.10, maxBid: 39 },
    sbv_cpc:  { minBid: 0.15, maxBid: 39 },
    sd_cpc:   { minBid: 0.02, maxBid: 1000 },
    sd_vcpm:  { minBid: 1.00, maxBid: 1000 },
    sb_vcpm:  { minBid: 1.00, maxBid: 1000 },
  },
  JP: {
    sp_cpc:   { minBid: 2, maxBid: 100000 },
    sb_cpc:   { minBid: 10, maxBid: 7760 },
    sbv_cpc:  { minBid: 15, maxBid: 7760 },
    sd_cpc:   { minBid: 2, maxBid: 100000 },
    sd_vcpm:  { minBid: 100, maxBid: 100000 },
    sb_vcpm:  { minBid: 100, maxBid: 100000 },
  },
  AU: {
    sp_cpc:   { minBid: 0.02, maxBid: 1410 },
    sb_cpc:   { minBid: 0.10, maxBid: 70 },
    sbv_cpc:  { minBid: 0.15, maxBid: 70 },
    sd_cpc:   { minBid: 0.20, maxBid: 1000 },
    sd_vcpm:  { minBid: 1.00, maxBid: 1000 },
    sb_vcpm:  { minBid: 1.00, maxBid: 1000 },
  },
  AE: {
    sp_cpc:   { minBid: 0.24, maxBid: 184 },
    sb_cpc:   { minBid: 0.40, maxBid: 184 },
    sbv_cpc:  { minBid: 0.60, maxBid: 184 },
    sd_cpc:   { minBid: 0.20, maxBid: 3670 },
    sd_vcpm:  { minBid: 1.00, maxBid: 3670 },
    sb_vcpm:  { minBid: 1.00, maxBid: 3670 },
  },
  BR: {
    sp_cpc:   { minBid: 0.07, maxBid: 3700 },
    sb_cpc:   { minBid: 0.53, maxBid: 200 },
    sbv_cpc:  { minBid: 0.80, maxBid: 25000 },
    sd_cpc:   { minBid: 0.07, maxBid: 3700 },
    sd_vcpm:  { minBid: 2.00, maxBid: 3700 },
    sb_vcpm:  { minBid: 2.00, maxBid: 3700 },
  },
  SG: {
    sp_cpc:   { minBid: 0.02, maxBid: 1100 },
    sb_cpc:   { minBid: 0.14, maxBid: 100 },
    sbv_cpc:  { minBid: 0.20, maxBid: 1400 },
    sd_cpc:   { minBid: 0.14, maxBid: 1410 },
    sd_vcpm:  { minBid: 4.00, maxBid: 1410 },
    sb_vcpm:  { minBid: 4.00, maxBid: 1410 },
  },
  SE: {
    sp_cpc:   { minBid: 0.18, maxBid: 9300 },
    sb_cpc:   { minBid: 0.90, maxBid: 500 },
    sbv_cpc:  { minBid: 1.30, maxBid: 500 },
    sd_cpc:   { minBid: 0.18, maxBid: 1000 },
    sd_vcpm:  { minBid: 1.00, maxBid: 1000 },
    sb_vcpm:  { minBid: 1.00, maxBid: 1000 },
  },
  IN: {
    sp_cpc:   { minBid: 1.00, maxBid: 5000 },
    sb_cpc:   { minBid: 1.00, maxBid: 500 },
    sbv_cpc:  { minBid: 1.50, maxBid: 500 },
    sd_cpc:   { minBid: 1.00, maxBid: 5000 },
    sd_vcpm:  { minBid: 4.00, maxBid: 5000 },
    sb_vcpm:  { minBid: 4.00, maxBid: 5000 },
  },
  PL: {
    sp_cpc:   { minBid: 0.04, maxBid: 2000 },
    sb_cpc:   { minBid: 0.20, maxBid: 200 },
    sbv_cpc:  { minBid: 0.30, maxBid: 200 },
    sd_cpc:   { minBid: 0.02, maxBid: 1000 },
    sd_vcpm:  { minBid: 1.00, maxBid: 1000 },
    sb_vcpm:  { minBid: 1.00, maxBid: 1000 },
  },
  SA: {
    sp_cpc:   { minBid: 0.10, maxBid: 3670 },
    sb_cpc:   { minBid: 0.40, maxBid: 184 },
    sbv_cpc:  { minBid: 0.60, maxBid: 184 },
    sd_cpc:   { minBid: 0.10, maxBid: 3670 },
    sd_vcpm:  { minBid: 4.00, maxBid: 3670 },
    sb_vcpm:  { minBid: 4.00, maxBid: 3670 },
  },
};

/**
 * 判断广告类型键
 * 
 * @param campaignType - 'sp_auto' | 'sp_manual' | 'sb' | 'sd'
 * @param costType - 'cpc' | 'vcpm'
 * @param adFormat - 'video' | 'brandVideo' | 'productCollection' | 'storeSpotlight' | null
 * @returns adType key for BID_CONSTRAINTS lookup
 */
function getAdTypeKey(
  campaignType: string,
  costType: string = 'cpc',
  adFormat?: string | null
): string {
  const ct = (costType || 'cpc').toLowerCase();
  
  if (campaignType === 'sp_auto' || campaignType === 'sp_manual') {
    return 'sp_cpc'; // SP只有CPC
  }
  
  if (campaignType === 'sb') {
    if (ct === 'vcpm') return 'sb_vcpm';
    // SB CPC: 区分Standard和Video
    const fmt = (adFormat || '').toLowerCase();
    if (fmt === 'video' || fmt === 'brandvideo') {
      return 'sbv_cpc'; // SB Video CPC — 最低竞价更高
    }
    return 'sb_cpc'; // SB Standard CPC
  }
  
  if (campaignType === 'sd') {
    if (ct === 'vcpm') return 'sd_vcpm';
    return 'sd_cpc';
  }
  
  // 默认fallback: SP CPC
  return 'sp_cpc';
}

/**
 * 获取指定广告类型和市场的竞价约束
 * 
 * @param campaignType - Campaign类型: 'sp_auto' | 'sp_manual' | 'sb' | 'sd'
 * @param marketplace - 市场代码: 'US' | 'CA' | 'MX' | 'UK' | 'DE' | 'JP' 等
 * @param costType - 计费方式: 'cpc' | 'vcpm'
 * @param adFormat - 广告格式: 'video' | 'brandVideo' | 'productCollection' | 'storeSpotlight' | null
 * @returns BidConstraint { minBid, maxBid }
 */
export function getBidConstraint(
  campaignType: string,
  marketplace: string = 'US',
  costType: string = 'cpc',
  adFormat?: string | null
): BidConstraint {
  const mkt = (marketplace || 'US').toUpperCase();
  const adTypeKey = getAdTypeKey(campaignType, costType, adFormat);
  
  // 优先使用精确的marketplace配置
  const mktConstraints = BID_CONSTRAINTS[mkt];
  if (mktConstraints && mktConstraints[adTypeKey]) {
    return mktConstraints[adTypeKey];
  }
  
  // Fallback: 使用US配置
  const usConstraints = BID_CONSTRAINTS['US'];
  if (usConstraints[adTypeKey]) {
    return usConstraints[adTypeKey];
  }
  
  // 最终fallback
  return { minBid: 0.02, maxBid: 1000 };
}

/**
 * 将竞价限制在Amazon允许的范围内
 * 
 * @param bid - 原始竞价
 * @param campaignType - Campaign类型
 * @param marketplace - 市场代码
 * @param costType - 计费方式
 * @param adFormat - 广告格式
 * @returns 限制后的竞价（保留2位小数）
 */
export function clampBidToConstraint(
  bid: number,
  campaignType: string,
  marketplace: string = 'US',
  costType: string = 'cpc',
  adFormat?: string | null
): { clampedBid: number; wasAdjusted: boolean; constraint: BidConstraint; adTypeKey: string } {
  const constraint = getBidConstraint(campaignType, marketplace, costType, adFormat);
  const adTypeKey = getAdTypeKey(campaignType, costType, adFormat);
  let clampedBid = bid;
  let wasAdjusted = false;
  
  if (bid < constraint.minBid) {
    clampedBid = constraint.minBid;
    wasAdjusted = true;
  } else if (bid > constraint.maxBid) {
    clampedBid = constraint.maxBid;
    wasAdjusted = true;
  }
  
  clampedBid = Math.round(clampedBid * 100) / 100;
  
  return { clampedBid, wasAdjusted, constraint, adTypeKey };
}

/**
 * 计算基于Amazon建议竞价的动态初始竞价
 * 
 * 对于新的投放词/ASIN/受众，使用Amazon建议竞价范围来设定初始竞价：
 * - 最低可按建议最低竞价的50%
 * - 最高可按建议最高竞价的150%
 * - 默认使用建议中位数竞价
 * 
 * 最终结果会被Amazon的绝对最低/最高竞价约束
 * 
 * @param suggestedBid - Amazon建议竞价（中位数）
 * @param suggestedRangeLow - Amazon建议竞价范围下限
 * @param suggestedRangeHigh - Amazon建议竞价范围上限
 * @param dynamicCoefficient - 动态系数 (0.5 ~ 1.5)，默认1.0使用建议中位数
 * @param campaignType - Campaign类型
 * @param marketplace - 市场代码
 * @param costType - 计费方式
 * @param adFormat - 广告格式
 * @returns 计算后的初始竞价
 */
export function calculateDynamicInitialBid(
  suggestedBid: number,
  suggestedRangeLow: number | undefined,
  suggestedRangeHigh: number | undefined,
  dynamicCoefficient: number = 1.0,
  campaignType: string,
  marketplace: string = 'US',
  costType: string = 'cpc',
  adFormat?: string | null
): { initialBid: number; constraint: BidConstraint; calculation: string } {
  const constraint = getBidConstraint(campaignType, marketplace, costType, adFormat);
  
  // 计算动态竞价范围
  const rangeLow = suggestedRangeLow || suggestedBid * 0.7;
  const rangeHigh = suggestedRangeHigh || suggestedBid * 1.3;
  
  // 动态系数映射:
  // coefficient=0.5 → 使用建议最低竞价的50% (最保守)
  // coefficient=1.0 → 使用建议中位数 (默认)
  // coefficient=1.5 → 使用建议最高竞价的150% (最激进)
  let initialBid: number;
  let calculation: string;
  
  if (dynamicCoefficient <= 0.5) {
    // 最保守: 建议最低竞价 × 50%
    initialBid = rangeLow * 0.5;
    calculation = `建议最低$${rangeLow.toFixed(2)} × 50% = $${initialBid.toFixed(2)}`;
  } else if (dynamicCoefficient < 1.0) {
    // 保守到中性: 在 rangeLow×50% 和 suggestedBid 之间线性插值
    const minTarget = rangeLow * 0.5;
    const ratio = (dynamicCoefficient - 0.5) / 0.5; // 0~1
    initialBid = minTarget + (suggestedBid - minTarget) * ratio;
    calculation = `插值(系数${dynamicCoefficient}): $${minTarget.toFixed(2)} ~ $${suggestedBid.toFixed(2)} → $${initialBid.toFixed(2)}`;
  } else if (dynamicCoefficient === 1.0) {
    // 中性: 使用建议中位数
    initialBid = suggestedBid;
    calculation = `建议中位数 = $${suggestedBid.toFixed(2)}`;
  } else if (dynamicCoefficient <= 1.5) {
    // 中性到激进: 在 suggestedBid 和 rangeHigh×150% 之间线性插值
    const maxTarget = rangeHigh * 1.5;
    const ratio = (dynamicCoefficient - 1.0) / 0.5; // 0~1
    initialBid = suggestedBid + (maxTarget - suggestedBid) * ratio;
    calculation = `插值(系数${dynamicCoefficient}): $${suggestedBid.toFixed(2)} ~ $${maxTarget.toFixed(2)} → $${initialBid.toFixed(2)}`;
  } else {
    // 超激进: 使用建议最高竞价 × 150%
    initialBid = rangeHigh * 1.5;
    calculation = `建议最高$${rangeHigh.toFixed(2)} × 150% = $${initialBid.toFixed(2)}`;
  }
  
  // 应用Amazon绝对竞价约束
  initialBid = Math.max(constraint.minBid, Math.min(constraint.maxBid, initialBid));
  initialBid = Math.round(initialBid * 100) / 100;
  
  return { initialBid, constraint, calculation };
}

/**
 * 获取所有支持的marketplace列表
 */
export function getSupportedMarketplaces(): string[] {
  return Object.keys(BID_CONSTRAINTS);
}

/**
 * 获取指定marketplace的所有广告类型竞价约束
 */
export function getAllConstraintsForMarketplace(marketplace: string = 'US'): Record<string, BidConstraint> {
  const mkt = (marketplace || 'US').toUpperCase();
  return BID_CONSTRAINTS[mkt] || BID_CONSTRAINTS['US'];
}
