/**
 * 搜索词与ASIN智能投放匹配算法 (v191)
 * 
 * 核心设计理念：
 * ============
 * 
 * 广泛匹配（Broad）：
 *   - 目的1: 发掘更多的"流量"，扩大搜索词覆盖面
 *   - 目的2: 以相对低的成本实现曝光
 *   - 适用场景: 新发现的有潜力搜索词，数据量不足以判断精准价值
 *   - 出价策略: 相对保守，用于探索
 * 
 * 短语匹配（Phrase）：
 *   - 目的: 兼顾流量精准度 + 以可控方式获得更多订单
 *   - 核心优势: 订单规模最大，整体利润规模最大
 *   - 适用场景: 已验证有转化能力的搜索词，需要规模化投放
 *   - 出价策略: 中等偏高，追求订单规模
 * 
 * 精确匹配（Exact）：
 *   - 目的1: 拉升"特定词"的自然排名
 *   - 目的2: 将高点击率、高转化率、重复多次曝光/点击/转化的高利润词价值榨干
 *   - 核心优势: 单一订单投产最高
 *   - 适用场景: 经过充分验证的核心出单词
 *   - 出价策略: 可以较高，追求单词利润最大化
 * 
 * ASIN商品定向：
 *   - 精确定向（Exact）: 已验证的高转化竞品ASIN，精准抢占流量
 *   - 扩展定向（Expanded）: 有潜力的ASIN，让Amazon扩展到类似商品
 * 
 * 算法核心逻辑：
 * =============
 * 不是简单地"高绩效=精确匹配"，而是基于搜索词的数据成熟度和战略目的来分配匹配方式：
 * 
 * 1. 数据成熟度评估: 根据曝光、点击、转化的数据量判断该搜索词的数据是否足够可靠
 * 2. 绩效评估: 基于CVR、ACoS、订单数、重复转化频率评估搜索词的价值等级
 * 3. 战略匹配: 根据价值等级和数据成熟度，分配最合适的匹配方式
 * 4. 出价建议: 根据匹配方式和搜索词表现，给出合理的出价建议
 */

import { sanitizeAndValidateKeyword, isAsinSearchTerm, canAddPositiveKeyword } from '../utils/keywordValidator';

// ==================== 类型定义 ====================

/** 搜索词表现数据（输入） */
export interface SearchTermPerformance {
  /** 搜索词文本 */
  searchTerm: string;
  /** 点击数 */
  clicks: number;
  /** 曝光数 */
  impressions: number;
  /** 订单数 */
  orders: number;
  /** 花费 */
  spend: number;
  /** 销售额 */
  sales: number;
  /** 来源广告活动的定向类型 */
  campaignTargetingType: 'auto' | 'manual';
  /** 来源广告活动的广告类型 - v2: 强制必填，用于否定策略分发 */
  campaignType: 'sp_auto' | 'sp_manual' | 'sb' | 'sd';
  /** 优化目标的目标ACoS（百分比，如30表示30%） */
  targetAcos: number;
  /** 该搜索词出现的天数（数据跨度） */
  dataSpanDays?: number;
  /** 该搜索词的历史转化次数（跨多个时间段的累计） */
  historicalConversions?: number;
}

/** 投放决策结果（输出） */
export interface TargetingDecision {
  /** 决策动作 - v2: 新增 CREATE_NEGATIVE_PRODUCT_TARGET 用于否定ASIN/产品 */
  action: 'CREATE_KEYWORD' | 'CREATE_PRODUCT_TARGET' | 'CREATE_NEGATIVE_KEYWORD' | 'CREATE_NEGATIVE_PRODUCT_TARGET' | 'MONITOR' | 'SKIP';
  /** 投放的词或ASIN */
  targetValue: string;
  /** 关键词匹配方式 */
  matchType?: 'exact' | 'phrase' | 'broad';
  /** 商品定向匹配方式 */
  productTargetingType?: 'exact' | 'expanded';
  /** 否定关键词匹配方式 */
  negativeMatchType?: 'negative_exact' | 'negative_phrase';
  /** v2: 否定类型 - keyword(否定关键词) 或 product(否定产品/ASIN) */
  negativeType?: 'keyword' | 'product';
  /** v2: 否定层级 - campaign(广告活动级) 或 ad_group(广告组级) */
  negativeScope?: 'campaign' | 'ad_group';
  /** v2: 来源广告活动类型 */
  campaignType?: 'sp' | 'sb' | 'sd';
  /** 建议出价 */
  suggestedBid?: number;
  /** 决策原因 */
  reason: string;
  /** 决策置信度 (0-1) */
  confidence: number;
  /** 数据成熟度等级 */
  dataMaturityLevel: 'insufficient' | 'emerging' | 'moderate' | 'mature' | 'proven';
  /** 搜索词价值等级 */
  valueLevel: 'high_profit' | 'profitable' | 'potential' | 'marginal' | 'negative' | 'unknown';
}

// ==================== 核心算法 ====================

/**
 * 搜索词智能投放决策
 * 
 * 这是整个投放算法的核心入口函数。
 * 根据搜索词的表现数据，综合评估数据成熟度和价值等级，
 * 输出最合适的投放方式（匹配类型）、出价建议和决策原因。
 */
export function decideTargeting(data: SearchTermPerformance): TargetingDecision {
  const { searchTerm, clicks, impressions, orders, spend, sales, 
          campaignTargetingType, campaignType, targetAcos } = data;
  
  // ========== Step 1: 判断搜索词类型 ==========
  const isAsin = isAsinSearchTerm(searchTerm);
  
  // ========== Step 2: 数据校验与清洗 ==========
  if (!isAsin) {
    const validation = sanitizeAndValidateKeyword(searchTerm, 'positive');
    if (!validation.isValid) {
      return {
        action: 'SKIP',
        targetValue: searchTerm,
        reason: `数据校验失败: ${validation.reasonMessage}`,
        confidence: 1.0,
        dataMaturityLevel: 'insufficient',
        valueLevel: 'unknown',
      };
    }
  }
  
  // ========== Step 3: 计算核心指标 ==========
  const cvr = clicks > 0 ? (orders / clicks) * 100 : 0;          // 转化率 (%)
  const acos = sales > 0 ? (spend / sales) * 100 : (spend > 0 ? 999 : 0); // ACoS (%)
  const roas = spend > 0 ? sales / spend : 0;                     // ROAS
  const cpc = clicks > 0 ? spend / clicks : 0;                    // CPC
  const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0; // CTR (%)
  const aov = orders > 0 ? sales / orders : 0;                    // 客单价
  
  // ========== Step 4: 评估数据成熟度 ==========
  const dataMaturity = assessDataMaturity(data);
  
  // ========== Step 5: 评估搜索词价值 ==========
  const valueLevel = assessValueLevel(cvr, acos, orders, clicks, targetAcos);
  
  // ========== Step 6: v2 - 基于广告活动类型的分发器 ==========
  // 根据campaignType调用不同的处理子模块
  const normalizedCampaignType = normalizeCampaignType(campaignType);
  
  // ========== Step 6a: ASIN投放决策 ==========
  if (isAsin) {
    return decideAsinTargetingV2(data, cvr, acos, orders, clicks, dataMaturity, valueLevel, normalizedCampaignType);
  }
  
  // ========== Step 6b: 关键词否定/投放决策 ==========
  // 根据广告类型分发到不同的处理函数
  switch (normalizedCampaignType) {
    case 'sp':
      // SP广告: 支持全部否定功能
      if (!canAddPositiveKeyword(campaignTargetingType)) {
        return decideAutoTargetingAction(data, cvr, acos, orders, clicks, dataMaturity, valueLevel);
      }
      return decideKeywordTargeting(data, cvr, acos, roas, cpc, aov, orders, clicks, dataMaturity, valueLevel);
    
    case 'sb':
      // SB广告: 仅支持Ad Group级否定关键词和否定产品
      return decideSbKeywordTargeting(data, cvr, acos, roas, cpc, aov, orders, clicks, dataMaturity, valueLevel);
    
    case 'sd':
      // SD广告: 不支持否定关键词，关键词类型的搜索词只能监控
      return decideSdKeywordTargeting(data, cvr, acos, roas, cpc, aov, orders, clicks, dataMaturity, valueLevel);
    
    default:
      // 默认回退到SP逻辑
      if (!canAddPositiveKeyword(campaignTargetingType)) {
        return decideAutoTargetingAction(data, cvr, acos, orders, clicks, dataMaturity, valueLevel);
      }
      return decideKeywordTargeting(data, cvr, acos, roas, cpc, aov, orders, clicks, dataMaturity, valueLevel);
  }
}

/**
 * v2: 将campaignType标准化为简化类型 (sp/sb/sd)
 */
function normalizeCampaignType(campaignType: string): 'sp' | 'sb' | 'sd' {
  if (campaignType === 'sp_auto' || campaignType === 'sp_manual' || campaignType === 'sp') return 'sp';
  if (campaignType === 'sb') return 'sb';
  if (campaignType === 'sd') return 'sd';
  return 'sp'; // 默认回退到SP
}

// ==================== 数据成熟度评估 ====================

/**
 * 评估搜索词的数据成熟度
 * 
 * 数据成熟度决定了我们对该搜索词表现判断的可信程度。
 * 数据量越大、时间跨度越长，判断越可靠。
 */
function assessDataMaturity(data: SearchTermPerformance): 'insufficient' | 'emerging' | 'moderate' | 'mature' | 'proven' {
  const { clicks, impressions, orders, dataSpanDays, historicalConversions } = data;
  
  // proven: 充分验证的核心词（多次转化、长时间跨度）
  if (orders >= 5 && clicks >= 30 && (dataSpanDays || 0) >= 14) return 'proven';
  if ((historicalConversions || orders) >= 8) return 'proven';
  
  // mature: 成熟数据（有足够转化和点击）
  if (orders >= 3 && clicks >= 20) return 'mature';
  
  // moderate: 中等数据（有转化但数据量一般）
  if (orders >= 2 && clicks >= 10) return 'moderate';
  
  // emerging: 初步数据（有少量转化或较多点击）
  if (orders >= 1 || clicks >= 15) return 'emerging';
  
  // insufficient: 数据不足
  return 'insufficient';
}

// ==================== 价值等级评估 ====================

/**
 * 评估搜索词的价值等级
 * 
 * 基于转化率、ACoS、订单数综合评估搜索词的商业价值。
 */
function assessValueLevel(
  cvr: number, acos: number, orders: number, clicks: number, targetAcos: number
): 'high_profit' | 'profitable' | 'potential' | 'marginal' | 'negative' | 'unknown' {
  
  // 数据不足，无法判断
  if (clicks < 5) return 'unknown';
  
  // 高利润词: 高转化率 + ACoS远低于目标
  if (orders >= 3 && cvr >= 10 && acos < targetAcos * 0.7) return 'high_profit';
  
  // 盈利词: 有稳定转化 + ACoS在目标范围内
  if (orders >= 2 && acos <= targetAcos) return 'profitable';
  
  // 潜力词: 有转化但ACoS偏高，或数据量不足以确认
  if (orders >= 1 && acos <= targetAcos * 1.5) return 'potential';
  
  // 边际词: 有少量转化但ACoS过高
  if (orders >= 1 && acos > targetAcos * 1.5) return 'marginal';
  
  // 负面词: 高点击无转化
  if (clicks >= 10 && orders === 0) return 'negative';
  
  return 'unknown';
}

// ==================== 关键词投放决策（核心） ====================

/**
 * 关键词投放决策
 * 
 * 核心逻辑:
 * - 广泛匹配: 发掘流量 + 低成本曝光 → 数据不足但有潜力的词
 * - 短语匹配: 精准流量 + 订单规模最大 → 已验证有转化能力的词（主力投放）
 * - 精确匹配: 拉升排名 + 榨干价值 → 经过充分验证的核心出单词
 */
function decideKeywordTargeting(
  data: SearchTermPerformance,
  cvr: number, acos: number, roas: number, cpc: number, aov: number,
  orders: number, clicks: number,
  dataMaturity: string, valueLevel: string
): TargetingDecision {
  const { searchTerm, targetAcos, spend, sales } = data;
  const cleanText = sanitizeAndValidateKeyword(searchTerm, 'positive').sanitizedText || searchTerm;
  
  // ===== 否定关键词决策 =====
  // v251: 引入花费/客单价比率，替代简单的点击数阈值
  // 解决同行评论中指出的"假阳性"问题：
  // - 高客单价产品($200+): 15次点击花$15远低于产品价格，不应否定
  // - 低客单价产品($10): 15次点击花$15已超过产品价格，应该否定
  // 新策略: 同时满足点击数阈值 AND 花费超过客单价×目标ACoS×1.5（归因延迟容忍）才否定
  const spendThreshold = aov > 0 ? aov * (targetAcos / 100) * 1.5 : spend; // 归因延迟容忍1.5x
  const spendExceeded = spend >= spendThreshold;
  
  // 高点击无转化 + 花费超过客单价容忍线 → 否定精确
  if (clicks >= 15 && orders === 0 && spendExceeded) {
    return {
      action: 'CREATE_NEGATIVE_KEYWORD',
      targetValue: cleanText,
      negativeMatchType: 'negative_exact',
      negativeType: 'keyword',  // v2: 明确否定类型
      negativeScope: 'campaign',  // v2: SP Manual支持Campaign级
      campaignType: 'sp',  // v2: 来源广告类型
      reason: `高点击无转化: ${clicks}次点击, 0订单, 花费$${spend.toFixed(2)}(AOV=$${aov.toFixed(0)}, 超过容忍线$${spendThreshold.toFixed(2)})`,
      confidence: Math.min(0.95, 0.6 + clicks / 100),
      dataMaturityLevel: dataMaturity as any,
      valueLevel: 'negative',
    };
  }
  
  // 高点击无转化但花费未超过容忍线 → 继续观察（可能是高客单价产品）
  if (clicks >= 15 && orders === 0 && !spendExceeded) {
    return {
      action: 'MONITOR',
      targetValue: cleanText,
      reason: `高点击无转化但花费未达客单价容忍线: ${clicks}次点击, 花费$${spend.toFixed(2)}(AOV=$${aov.toFixed(0)}, 容忍线$${spendThreshold.toFixed(2)}), 继续观察`,
      confidence: 0.5,
      dataMaturityLevel: dataMaturity as any,
      valueLevel: 'unknown',
    };
  }
  
  // 中等点击无转化 → 继续观察
  if (clicks >= 8 && clicks < 15 && orders === 0) {
    return {
      action: 'MONITOR',
      targetValue: cleanText,
      reason: `中等点击无转化: ${clicks}次点击, 0订单, 花费$${spend.toFixed(2)}, 需要更多数据`,
      confidence: 0.5,
      dataMaturityLevel: dataMaturity as any,
      valueLevel: 'unknown',
    };
  }
  
  // ===== 精确匹配决策 =====
  // 条件: 数据成熟度达到proven或mature + 高利润词
  // 目的: 拉升自然排名 + 榨干高利润词价值
  if (
    (dataMaturity === 'proven' || (dataMaturity === 'mature' && valueLevel === 'high_profit')) &&
    (valueLevel === 'high_profit' || valueLevel === 'profitable')
  ) {
    // 精确匹配出价: 基于CVR和AOV计算最优出价
    // 精确匹配的出价可以较高，因为追求单词利润最大化
    const optimalBid = calculateOptimalBid(cvr, aov, targetAcos, 'exact');
    
    return {
      action: 'CREATE_KEYWORD',
      targetValue: cleanText,
      matchType: 'exact',
      suggestedBid: optimalBid,
      reason: `[精确收割] ${orders}单, CVR=${cvr.toFixed(1)}%, ACoS=${acos.toFixed(1)}%, ` +
              `数据成熟度=${dataMaturity}, 价值=${valueLevel}`,
      confidence: Math.min(0.95, 0.7 + orders / 20),
      dataMaturityLevel: dataMaturity as any,
      valueLevel: valueLevel as any,
    };
  }
  
  // ===== 短语匹配决策 =====
  // 条件: 数据成熟度至少moderate + 有盈利能力
  // 目的: 兼顾精准度和订单规模，是主力投放方式
  if (
    (dataMaturity === 'mature' || dataMaturity === 'moderate') &&
    (valueLevel === 'profitable' || valueLevel === 'potential' || valueLevel === 'high_profit')
  ) {
    // 短语匹配出价: 中等偏高，追求订单规模
    const optimalBid = calculateOptimalBid(cvr, aov, targetAcos, 'phrase');
    
    return {
      action: 'CREATE_KEYWORD',
      targetValue: cleanText,
      matchType: 'phrase',
      suggestedBid: optimalBid,
      reason: `[短语投放] ${orders}单, CVR=${cvr.toFixed(1)}%, ACoS=${acos.toFixed(1)}%, ` +
              `数据成熟度=${dataMaturity}, 价值=${valueLevel}`,
      confidence: Math.min(0.90, 0.6 + orders / 15),
      dataMaturityLevel: dataMaturity as any,
      valueLevel: valueLevel as any,
    };
  }
  
  // ===== 广泛匹配决策 =====
  // 条件: 有初步转化数据但不足以确认价值
  // 目的: 以低成本探索更多流量
  if (
    dataMaturity === 'emerging' &&
    (valueLevel === 'potential' || valueLevel === 'profitable' || valueLevel === 'unknown')
  ) {
    // 广泛匹配出价: 相对保守，用于探索
    const optimalBid = calculateOptimalBid(cvr, aov, targetAcos, 'broad');
    
    return {
      action: 'CREATE_KEYWORD',
      targetValue: cleanText,
      matchType: 'broad',
      suggestedBid: optimalBid,
      reason: `[广泛探索] ${orders}单, ${clicks}次点击, CVR=${cvr.toFixed(1)}%, ` +
              `数据成熟度=${dataMaturity}, 价值=${valueLevel}`,
      confidence: Math.min(0.75, 0.4 + orders / 10),
      dataMaturityLevel: dataMaturity as any,
      valueLevel: valueLevel as any,
    };
  }
  
  // ===== 边际词处理 =====
  // ACoS过高但有转化 → 暂不投放，继续观察
  if (valueLevel === 'marginal') {
    return {
      action: 'MONITOR',
      targetValue: cleanText,
      reason: `边际搜索词: ${orders}单, ACoS=${acos.toFixed(1)}%(目标${targetAcos}%), 暂不投放`,
      confidence: 0.6,
      dataMaturityLevel: dataMaturity as any,
      valueLevel: 'marginal',
    };
  }
  
  // ===== 默认: 数据不足，继续观察 =====
  return {
    action: 'MONITOR',
    targetValue: cleanText,
    reason: `数据不足: ${clicks}次点击, ${orders}单, 需要更多数据`,
    confidence: 0.3,
    dataMaturityLevel: dataMaturity as any,
    valueLevel: valueLevel as any,
  };
}

// ==================== ASIN投放决策 ====================

/**
 * v2: ASIN商品定向投放决策（感知广告活动类型）
 * 
 * 核心改进:
 * 1. ASIN否定现在返回 CREATE_NEGATIVE_PRODUCT_TARGET（而非错误的 CREATE_NEGATIVE_KEYWORD）
 * 2. 根据广告活动类型设置正确的 negativeScope
 * 3. SD广告仅支持Ad Group级否定产品，且仅限上下文定向
 */
function decideAsinTargetingV2(
  data: SearchTermPerformance,
  cvr: number, acos: number, orders: number, clicks: number,
  dataMaturity: string, valueLevel: string,
  normalizedCampaignType: 'sp' | 'sb' | 'sd'
): TargetingDecision {
  const { searchTerm, targetAcos, spend, sales } = data;
  const aov = orders > 0 ? sales / orders : 0;
  
  // v251: ASIN否定引入花费/客单价比率
  const spendThreshold = aov > 0 ? aov * (targetAcos / 100) * 1.5 : spend;
  const spendExceeded = spend >= spendThreshold;
  
  // v2: 根据广告类型确定否定层级
  // SP: 支持Campaign和Ad Group级，默认用Campaign级（影响范围更广）
  // SB: 仅支持Ad Group级
  // SD: 仅支持Ad Group级（且仅限上下文定向）
  const negativeScope: 'campaign' | 'ad_group' = normalizedCampaignType === 'sp' ? 'campaign' : 'ad_group';
  
  // 高点击无转化ASIN + 花费超标 → 否定产品定向
  if (clicks >= 15 && orders === 0 && spendExceeded) {
    return {
      action: 'CREATE_NEGATIVE_PRODUCT_TARGET',  // v2: 修正！ASIN应用否定产品定向
      targetValue: searchTerm.trim(),
      negativeType: 'product',
      negativeScope: negativeScope,
      campaignType: normalizedCampaignType,
      reason: `[否定ASIN-${normalizedCampaignType.toUpperCase()}] 高点击无转化: ${clicks}次点击, 花费$${spend.toFixed(2)}${aov > 0 ? `(AOV=$${aov.toFixed(0)})` : ''}, 层级=${negativeScope}`,
      confidence: Math.min(0.90, 0.5 + clicks / 50),
      dataMaturityLevel: dataMaturity as any,
      valueLevel: 'negative',
    };
  }
  
  // 高点击无转化ASIN但花费未超标 → 观察
  if (clicks >= 15 && orders === 0 && !spendExceeded) {
    return {
      action: 'MONITOR',
      targetValue: searchTerm.trim(),
      reason: `高点击无转化ASIN但花费未达容忍线: ${clicks}次点击, 花费$${spend.toFixed(2)}(AOV=$${aov.toFixed(0)}), 继续观察`,
      confidence: 0.5,
      dataMaturityLevel: dataMaturity as any,
      valueLevel: 'unknown',
    };
  }
  
  // 高绩效ASIN → 精确定向
  if (
    orders >= 3 && 
    acos <= targetAcos * 1.1 &&
    (dataMaturity === 'proven' || dataMaturity === 'mature')
  ) {
    const optimalBid = calculateOptimalBid(cvr, aov, targetAcos, 'exact');
    return {
      action: 'CREATE_PRODUCT_TARGET',
      targetValue: searchTerm.trim(),
      productTargetingType: 'exact',
      suggestedBid: optimalBid,
      reason: `[精确ASIN定向] ${orders}单, CVR=${cvr.toFixed(1)}%, ACoS=${acos.toFixed(1)}%`,
      confidence: Math.min(0.90, 0.6 + orders / 15),
      dataMaturityLevel: dataMaturity as any,
      valueLevel: valueLevel as any,
    };
  }
  
  // 中等绩效ASIN → 扩展定向
  if (
    orders >= 1 && 
    acos <= targetAcos * 1.5 &&
    (dataMaturity === 'moderate' || dataMaturity === 'mature' || dataMaturity === 'emerging')
  ) {
    const optimalBid = calculateOptimalBid(cvr, aov, targetAcos, 'broad');
    return {
      action: 'CREATE_PRODUCT_TARGET',
      targetValue: searchTerm.trim(),
      productTargetingType: 'expanded',
      suggestedBid: optimalBid,
      reason: `[扩展ASIN定向] ${orders}单, CVR=${cvr.toFixed(1)}%, ACoS=${acos.toFixed(1)}%`,
      confidence: Math.min(0.80, 0.5 + orders / 10),
      dataMaturityLevel: dataMaturity as any,
      valueLevel: valueLevel as any,
    };
  }
  
  // 数据不足 → 观察
  return {
    action: 'MONITOR',
    targetValue: searchTerm.trim(),
    reason: `ASIN数据不足: ${clicks}次点击, ${orders}单`,
    confidence: 0.3,
    dataMaturityLevel: dataMaturity as any,
    valueLevel: valueLevel as any,
  };
}

// 保留原始函数作为向后兼容封装
function decideAsinTargeting(
  data: SearchTermPerformance,
  cvr: number, acos: number, orders: number, clicks: number,
  dataMaturity: string, valueLevel: string
): TargetingDecision {
  return decideAsinTargetingV2(data, cvr, acos, orders, clicks, dataMaturity, valueLevel, 'sp');
}

// ==================== 自动广告活动决策 ====================

/**
 * 自动广告活动的搜索词处理
 * 
 * 自动广告活动不能添加正面关键词，只能:
 * 1. 否定无效搜索词
 * 2. 标记高绩效词等待手动广告活动收割
 */
function decideAutoTargetingAction(
  data: SearchTermPerformance,
  cvr: number, acos: number, orders: number, clicks: number,
  dataMaturity: string, valueLevel: string
): TargetingDecision {
  const { searchTerm, spend, sales, targetAcos } = data;
  const cleanText = sanitizeAndValidateKeyword(searchTerm, 'negative_exact').sanitizedText || searchTerm;
  
  // v251: 自动广告也引入花费/客单价比率，但阈值更低（自动广告更积极否定）
  const aov = orders > 0 ? sales / orders : 0;
  // 自动广告的花费容忍线较低（1.2x），因为无法精细控制匹配
  const spendThreshold = aov > 0 ? aov * (targetAcos / 100) * 1.2 : 0;
  const spendExceeded = aov === 0 || spend >= spendThreshold; // 无AOV数据时回退到纯点击数逻辑
  
  // 高点击无转化 + 花费超标 → 否定精确
  if (clicks >= 15 && orders === 0 && spendExceeded) {
    return {
      action: 'CREATE_NEGATIVE_KEYWORD',
      targetValue: cleanText,
      negativeMatchType: 'negative_exact',
      negativeType: 'keyword',  // v2: 明确否定类型
      negativeScope: 'campaign',  // v2: SP Auto支持Campaign级
      campaignType: 'sp',  // v2: 自动广告属于SP
      reason: `[自动广告] 高点击无转化: ${clicks}次点击, 花费$${spend.toFixed(2)}${aov > 0 ? `(AOV=$${aov.toFixed(0)})` : ''}`,
      confidence: Math.min(0.95, 0.6 + clicks / 100),
      dataMaturityLevel: dataMaturity as any,
      valueLevel: 'negative',
    };
  }
  
  // 中等点击无转化 + 花费超标 → 否定精确（自动广告更积极）
  if (clicks >= 10 && orders === 0 && spendExceeded) {
    return {
      action: 'CREATE_NEGATIVE_KEYWORD',
      targetValue: cleanText,
      negativeMatchType: 'negative_exact',
      negativeType: 'keyword',  // v2
      negativeScope: 'campaign',  // v2
      campaignType: 'sp',  // v2
      reason: `[自动广告] 中等点击无转化: ${clicks}次点击, 花费$${spend.toFixed(2)}${aov > 0 ? `(AOV=$${aov.toFixed(0)})` : ''}`,
      confidence: Math.min(0.85, 0.5 + clicks / 50),
      dataMaturityLevel: dataMaturity as any,
      valueLevel: 'negative',
    };
  }
  
  // 点击超过10但花费未超标 → 观察（可能是高客单价产品）
  if (clicks >= 10 && orders === 0 && !spendExceeded) {
    return {
      action: 'MONITOR',
      targetValue: cleanText,
      reason: `[自动广告] 点击${clicks}次无转化但花费未达客单价容忍线: 花费$${spend.toFixed(2)}(AOV=$${aov.toFixed(0)}), 继续观察`,
      confidence: 0.5,
      dataMaturityLevel: dataMaturity as any,
      valueLevel: 'unknown',
    };
  }
  
  // 有转化的词 → 不在自动广告操作，等待手动收割
  return {
    action: 'MONITOR',
    targetValue: cleanText,
    reason: `[自动广告] ${orders > 0 ? '有转化词等待手动收割' : '数据不足继续观察'}: ${clicks}点击, ${orders}单`,
    confidence: 0.5,
    dataMaturityLevel: dataMaturity as any,
    valueLevel: valueLevel as any,
  };
}

// ==================== 出价计算 ====================

/**
 * 计算最优出价
 * 
 * 基于 CVR × AOV × 目标ACoS 的公式，并根据匹配方式调整:
 * - 精确匹配: 出价可以较高（×1.0），追求单词利润最大化
 * - 短语匹配: 出价中等偏高（×0.9），追求订单规模
 * - 广泛匹配: 出价保守（×0.75），用于探索
 */
function calculateOptimalBid(
  cvr: number,    // 转化率 (百分比, 如 10 表示 10%)
  aov: number,    // 客单价
  targetAcos: number, // 目标ACoS (百分比, 如 30 表示 30%)
  matchType: 'exact' | 'phrase' | 'broad'
): number {
  // 基础出价公式: CVR × AOV × 目标ACoS
  const baseBid = (cvr / 100) * aov * (targetAcos / 100);
  
  // 匹配方式系数
  const matchTypeMultiplier: Record<string, number> = {
    'exact': 1.0,    // 精确匹配: 全额出价
    'phrase': 0.90,  // 短语匹配: 90%出价
    'broad': 0.75,   // 广泛匹配: 75%出价
  };
  
  const multiplier = matchTypeMultiplier[matchType] || 0.85;
  let finalBid = baseBid * multiplier;
  
  // 出价安全边界
  finalBid = Math.max(0.10, finalBid);  // 最低$0.10
  finalBid = Math.min(10.00, finalBid); // 最高$10.00
  
  // 保留2位小数
  return Math.round(finalBid * 100) / 100;
}

// ==================== 批量决策 ====================

/**
 * 批量搜索词投放决策
 * 
 * 对一批搜索词进行统一的投放决策，并按决策类型分组返回。
 */
export function batchDecideTargeting(
  searchTerms: SearchTermPerformance[]
): {
  keywords: { exact: TargetingDecision[]; phrase: TargetingDecision[]; broad: TargetingDecision[] };
  productTargets: { exact: TargetingDecision[]; expanded: TargetingDecision[] };
  negativeKeywords: TargetingDecision[];  // v2: 否定关键词
  negativeProductTargets: TargetingDecision[];  // v2: 否定产品定向
  negatives: TargetingDecision[];  // v2: 向后兼容，包含所有否定
  monitors: TargetingDecision[];
  skipped: TargetingDecision[];
  summary: {
    total: number;
    exactKeywords: number;
    phraseKeywords: number;
    broadKeywords: number;
    exactAsinTargets: number;
    expandedAsinTargets: number;
    negativeKeywords: number;  // v2
    negativeProductTargets: number;  // v2
    negatives: number;
    monitors: number;
    skipped: number;
  };
} {
  const result = {
    keywords: { exact: [] as TargetingDecision[], phrase: [] as TargetingDecision[], broad: [] as TargetingDecision[] },
    productTargets: { exact: [] as TargetingDecision[], expanded: [] as TargetingDecision[] },
    negativeKeywords: [] as TargetingDecision[],
    negativeProductTargets: [] as TargetingDecision[],
    negatives: [] as TargetingDecision[],
    monitors: [] as TargetingDecision[],
    skipped: [] as TargetingDecision[],
    summary: {
      total: searchTerms.length,
      exactKeywords: 0, phraseKeywords: 0, broadKeywords: 0,
      exactAsinTargets: 0, expandedAsinTargets: 0,
      negativeKeywords: 0, negativeProductTargets: 0,
      negatives: 0, monitors: 0, skipped: 0,
    },
  };
  
  for (const st of searchTerms) {
    const decision = decideTargeting(st);
    
    switch (decision.action) {
      case 'CREATE_KEYWORD':
        if (decision.matchType === 'exact') {
          result.keywords.exact.push(decision);
          result.summary.exactKeywords++;
        } else if (decision.matchType === 'phrase') {
          result.keywords.phrase.push(decision);
          result.summary.phraseKeywords++;
        } else {
          result.keywords.broad.push(decision);
          result.summary.broadKeywords++;
        }
        break;
      case 'CREATE_PRODUCT_TARGET':
        if (decision.productTargetingType === 'exact') {
          result.productTargets.exact.push(decision);
          result.summary.exactAsinTargets++;
        } else {
          result.productTargets.expanded.push(decision);
          result.summary.expandedAsinTargets++;
        }
        break;
      case 'CREATE_NEGATIVE_KEYWORD':
        result.negativeKeywords.push(decision);
        result.negatives.push(decision);  // v2: 向后兼容
        result.summary.negativeKeywords++;
        result.summary.negatives++;
        break;
      case 'CREATE_NEGATIVE_PRODUCT_TARGET':  // v2: 新增否定产品定向处理
        result.negativeProductTargets.push(decision);
        result.negatives.push(decision);  // v2: 向后兼容
        result.summary.negativeProductTargets++;
        result.summary.negatives++;
        break;
      case 'MONITOR':
        result.monitors.push(decision);
        result.summary.monitors++;
        break;
      case 'SKIP':
        result.skipped.push(decision);
        result.summary.skipped++;
        break;
    }
  }
  
  console.log(`[TargetingAlgorithm] v2 批量决策完成: 总计${result.summary.total}个搜索词`);
  console.log(`  精确匹配关键词: ${result.summary.exactKeywords}, 短语匹配: ${result.summary.phraseKeywords}, 广泛匹配: ${result.summary.broadKeywords}`);
  console.log(`  精确ASIN定向: ${result.summary.exactAsinTargets}, 扩展ASIN定向: ${result.summary.expandedAsinTargets}`);
  console.log(`  否定关键词: ${result.summary.negativeKeywords}, 否定产品: ${result.summary.negativeProductTargets}, 观察中: ${result.summary.monitors}, 跳过: ${result.summary.skipped}`);
  
  return result;
}


// ==================== v2: SB广告关键词决策 ====================

/**
 * v2: Sponsored Brands 关键词投放决策
 * 
 * SB广告的否定限制:
 * - 否定关键词: 仅支持 Ad Group 级
 * - 否定产品: 仅支持 Ad Group 级
 * - 不支持 Campaign 级否定
 * 
 * SB广告的投放逻辑与SP Manual类似，但否定层级固定为ad_group
 */
function decideSbKeywordTargeting(
  data: SearchTermPerformance,
  cvr: number, acos: number, roas: number, cpc: number, aov: number,
  orders: number, clicks: number,
  dataMaturity: string, valueLevel: string
): TargetingDecision {
  const { searchTerm, targetAcos, spend, sales } = data;
  const cleanText = sanitizeAndValidateKeyword(searchTerm, 'positive').sanitizedText || searchTerm;
  
  // 花费/客单价比率
  const spendThreshold = aov > 0 ? aov * (targetAcos / 100) * 1.5 : spend;
  const spendExceeded = spend >= spendThreshold;
  
  // ===== 否定关键词决策 =====
  // SB广告: 否定层级固定为 ad_group（不支持Campaign级）
  if (clicks >= 15 && orders === 0 && spendExceeded) {
    return {
      action: 'CREATE_NEGATIVE_KEYWORD',
      targetValue: cleanText,
      negativeMatchType: 'negative_exact',
      negativeType: 'keyword',
      negativeScope: 'ad_group',  // SB仅支持Ad Group级
      campaignType: 'sb',
      reason: `[SB否定关键词] 高点击无转化: ${clicks}次点击, 花费$${spend.toFixed(2)}, 层级=ad_group`,
      confidence: Math.min(0.95, 0.6 + clicks / 100),
      dataMaturityLevel: dataMaturity as any,
      valueLevel: 'negative',
    };
  }
  
  // 高点击无转化但花费未超标 → 观察
  if (clicks >= 15 && orders === 0 && !spendExceeded) {
    return {
      action: 'MONITOR',
      targetValue: cleanText,
      reason: `[SB] 高点击无转化但花费未达容忍线: ${clicks}次点击, 花费$${spend.toFixed(2)}(AOV=$${aov.toFixed(0)}), 继续观察`,
      confidence: 0.5,
      dataMaturityLevel: dataMaturity as any,
      valueLevel: 'unknown',
    };
  }
  
  // 中等点击无转化 → 观察
  if (clicks >= 8 && clicks < 15 && orders === 0) {
    return {
      action: 'MONITOR',
      targetValue: cleanText,
      reason: `[SB] 中等点击无转化: ${clicks}次点击, 需要更多数据`,
      confidence: 0.5,
      dataMaturityLevel: dataMaturity as any,
      valueLevel: 'unknown',
    };
  }
  
  // ===== 精确匹配决策 =====
  if (
    (dataMaturity === 'proven' || (dataMaturity === 'mature' && valueLevel === 'high_profit')) &&
    (valueLevel === 'high_profit' || valueLevel === 'profitable')
  ) {
    const optimalBid = calculateOptimalBid(cvr, aov, targetAcos, 'exact');
    return {
      action: 'CREATE_KEYWORD',
      targetValue: cleanText,
      matchType: 'exact',
      suggestedBid: optimalBid,
      reason: `[SB精确收割] ${orders}单, CVR=${cvr.toFixed(1)}%, ACoS=${acos.toFixed(1)}%`,
      confidence: Math.min(0.95, 0.7 + orders / 20),
      dataMaturityLevel: dataMaturity as any,
      valueLevel: valueLevel as any,
    };
  }
  
  // ===== 短语匹配决策 =====
  if (
    (dataMaturity === 'mature' || dataMaturity === 'moderate') &&
    (valueLevel === 'profitable' || valueLevel === 'potential' || valueLevel === 'high_profit')
  ) {
    const optimalBid = calculateOptimalBid(cvr, aov, targetAcos, 'phrase');
    return {
      action: 'CREATE_KEYWORD',
      targetValue: cleanText,
      matchType: 'phrase',
      suggestedBid: optimalBid,
      reason: `[SB短语投放] ${orders}单, CVR=${cvr.toFixed(1)}%, ACoS=${acos.toFixed(1)}%`,
      confidence: Math.min(0.90, 0.6 + orders / 15),
      dataMaturityLevel: dataMaturity as any,
      valueLevel: valueLevel as any,
    };
  }
  
  // ===== 广泛匹配决策 =====
  if (
    dataMaturity === 'emerging' &&
    (valueLevel === 'potential' || valueLevel === 'profitable' || valueLevel === 'unknown')
  ) {
    const optimalBid = calculateOptimalBid(cvr, aov, targetAcos, 'broad');
    return {
      action: 'CREATE_KEYWORD',
      targetValue: cleanText,
      matchType: 'broad',
      suggestedBid: optimalBid,
      reason: `[SB广泛探索] ${orders}单, ${clicks}次点击`,
      confidence: Math.min(0.75, 0.4 + orders / 10),
      dataMaturityLevel: dataMaturity as any,
      valueLevel: valueLevel as any,
    };
  }
  
  // 边际词或数据不足 → 观察
  return {
    action: 'MONITOR',
    targetValue: cleanText,
    reason: `[SB] ${valueLevel === 'marginal' ? '边际搜索词' : '数据不足'}: ${clicks}次点击, ${orders}单`,
    confidence: 0.3,
    dataMaturityLevel: dataMaturity as any,
    valueLevel: valueLevel as any,
  };
}

// ==================== v2: SD广告关键词决策 ====================

/**
 * v2: Sponsored Display 关键词投放决策
 * 
 * SD广告的否定限制:
 * - 不支持否定关键词！
 * - 仅支持否定产品定向（Ad Group级，且仅限上下文定向）
 * - 受众定向广告完全不支持否定
 * 
 * 因此，当SD广告中出现无效的关键词类型搜索词时，系统只能标记为MONITOR
 */
function decideSdKeywordTargeting(
  data: SearchTermPerformance,
  cvr: number, acos: number, roas: number, cpc: number, aov: number,
  orders: number, clicks: number,
  dataMaturity: string, valueLevel: string
): TargetingDecision {
  const { searchTerm, targetAcos, spend } = data;
  const cleanText = sanitizeAndValidateKeyword(searchTerm, 'positive').sanitizedText || searchTerm;
  
  // SD广告不支持否定关键词，所有关键词类型的搜索词只能监控
  // 即使是高点击无转化的词，也无法通过API否定
  if (clicks >= 15 && orders === 0) {
    return {
      action: 'MONITOR',
      targetValue: cleanText,
      reason: `[SD-无法否定关键词] 高点击无转化: ${clicks}次点击, 花费$${spend.toFixed(2)}, SD不支持否定关键词`,
      confidence: 0.5,
      dataMaturityLevel: dataMaturity as any,
      valueLevel: 'negative',
    };
  }
  
  // 其他情况也只能监控
  return {
    action: 'MONITOR',
    targetValue: cleanText,
    reason: `[SD] ${orders > 0 ? '有转化词' : '数据不足'}: ${clicks}次点击, ${orders}单, SD关键词仅支持监控`,
    confidence: 0.3,
    dataMaturityLevel: dataMaturity as any,
    valueLevel: valueLevel as any,
  };
}
