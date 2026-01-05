/**
 * 广告自动化核心算法模块
 * 基于亚马逊运营流程文档实现的自动化功能
 * 
 * 重要说明：
 * - 关键词广告（Keyword Targeting）：否定词可以在广告组层级或活动层级设置
 * - 产品定位广告（Product Targeting）：否定词只能在活动层级设置
 */

// ============================================
// 类型定义
// ============================================

export interface SearchTermData {
  searchTerm: string;
  clicks: number;
  conversions: number;
  spend: number;
  sales: number;
  impressions: number;
  // 新增：广告类型信息
  campaignType?: 'sp_auto' | 'sp_manual' | 'sb' | 'sd';
  targetingType?: 'keyword' | 'product'; // 关键词定位 or 产品定位
}

export interface NgramAnalysisResult {
  ngram: string;
  frequency: number;
  totalClicks: number;
  totalConversions: number;
  totalSpend: number;
  conversionRate: number;
  isNegativeCandidate: boolean;
  reason: string;
  affectedTerms: string[];
  // 新增：否定层级建议
  suggestedNegativeLevel: 'ad_group' | 'campaign';
  hasProductTargeting: boolean; // 是否包含产品定位广告的搜索词
}

export interface CampaignSearchTerm {
  searchTerm: string;
  campaignId: number;
  campaignName: string;
  campaignType: 'sp_auto' | 'sp_manual' | 'sb' | 'sd';
  targetingType: 'keyword' | 'product'; // 关键词定位 or 产品定位
  matchType: 'broad' | 'phrase' | 'exact' | 'auto' | 'product';
  clicks: number;
  conversions: number;
  spend: number;
  sales: number;
  roas: number;
  acos: number;
  cpc: number;
  adGroupId?: number;
  adGroupName?: string;
}

export interface MigrationSuggestion {
  searchTerm: string;
  fromCampaign: string;
  fromMatchType: 'broad' | 'phrase' | 'exact' | 'auto' | 'product';
  toMatchType: 'broad' | 'phrase' | 'exact';
  reason: string;
  suggestedBid: number;
  currentCpc: number;
  conversions: number;
  roas: number;
  priority: 'high' | 'medium' | 'low';
  // 新增：原活动否定建议
  negativeInOriginal: boolean;
  negativeLevel: 'ad_group' | 'campaign'; // 产品定位只能campaign级别
}

export interface TrafficConflict {
  searchTerm: string;
  campaigns: {
    campaignId: number;
    campaignName: string;
    campaignType: 'sp_auto' | 'sp_manual' | 'sb' | 'sd';
    targetingType: 'keyword' | 'product';
    matchType: string;
    clicks: number;
    conversions: number;
    spend: number;
    sales: number;
    roas: number;
    ctr: number;
    cvr: number;
  }[];
  recommendation: {
    winnerCampaign: string;
    winnerCampaignType: 'sp_auto' | 'sp_manual' | 'sb' | 'sd';
    winnerTargetingType: 'keyword' | 'product';
    loserCampaigns: {
      name: string;
      campaignType: 'sp_auto' | 'sp_manual' | 'sb' | 'sd';
      targetingType: 'keyword' | 'product';
      negativeLevel: 'ad_group' | 'campaign'; // 根据广告类型决定
    }[];
    action: 'negative_exact' | 'negative_phrase';
    reason: string;
  };
  totalWastedSpend: number;
}

export interface BidAdjustmentSuggestion {
  targetId: number;
  targetType: 'keyword' | 'product_target';
  targetName: string;
  campaignName: string;
  currentBid: number;
  suggestedBid: number;
  adjustmentPercent: number;
  adjustmentType: 'increase' | 'decrease' | 'maintain';
  reason: string;
  priority: 'urgent' | 'high' | 'medium' | 'low';
  metrics: {
    impressions: number;
    clicks: number;
    conversions: number;
    spend: number;
    sales: number;
    acos: number;
    roas: number;
    ctr: number;
    cvr: number;
  };
}

export interface BidTarget {
  id: number;
  type: 'keyword' | 'product_target';
  name: string;
  campaignId: number;
  campaignName: string;
  currentBid: number;
  impressions: number;
  clicks: number;
  conversions: number;
  spend: number;
  sales: number;
  targetAcos?: number;
  targetRoas?: number;
  lastBidChange?: Date;
  daysSinceLastChange?: number;
}

export type SearchTermRelevance = 'high' | 'weak' | 'seemingly_related' | 'unrelated';

export interface SearchTermClassification {
  searchTerm: string;
  relevance: SearchTermRelevance;
  confidence: number;
  reason: string;
  suggestedAction: 'target' | 'monitor' | 'negative_phrase' | 'negative_exact';
  matchTypeSuggestion?: 'exact' | 'phrase' | 'broad';
}

// ============================================
// 1. N-Gram词根分析与批量降噪
// ============================================

/**
 * 将搜索词拆分为N-gram词根
 */
export function tokenize(searchTerm: string): string[] {
  return searchTerm
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(word => word.length > 1);
}

/**
 * 生成N-gram组合（1-gram和2-gram）
 */
export function generateNgrams(tokens: string[], maxN: number = 2): string[] {
  const ngrams: string[] = [...tokens]; // 1-grams
  
  // 生成2-grams
  if (maxN >= 2) {
    for (let i = 0; i < tokens.length - 1; i++) {
      ngrams.push(`${tokens[i]} ${tokens[i + 1]}`);
    }
  }
  
  return ngrams;
}

/**
 * N-Gram词根分析 - 识别高频无效词根
 * 分析"1点击0转化"搜索词的共同特征
 * 
 * 重要：会根据搜索词来源的广告类型决定否定层级
 * - 关键词广告的搜索词：可以在广告组层级否定
 * - 产品定位广告的搜索词：只能在活动层级否定
 */
export function analyzeNgrams(searchTerms: SearchTermData[]): NgramAnalysisResult[] {
  // 筛选出无效搜索词（有点击但无转化）
  const ineffectiveTerms = searchTerms.filter(
    term => term.clicks >= 1 && term.conversions === 0
  );
  
  // 统计每个N-gram的出现频率和相关数据
  const ngramStats: Map<string, {
    frequency: number;
    totalClicks: number;
    totalConversions: number;
    totalSpend: number;
    terms: string[];
    hasProductTargeting: boolean;
  }> = new Map();
  
  for (const term of ineffectiveTerms) {
    const tokens = tokenize(term.searchTerm);
    const ngrams = generateNgrams(tokens);
    const isProductTargeting = term.targetingType === 'product';
    
    for (const ngram of ngrams) {
      const existing = ngramStats.get(ngram) || {
        frequency: 0,
        totalClicks: 0,
        totalConversions: 0,
        totalSpend: 0,
        terms: [],
        hasProductTargeting: false
      };
      
      existing.frequency++;
      existing.totalClicks += term.clicks;
      existing.totalConversions += term.conversions;
      existing.totalSpend += term.spend;
      existing.terms.push(term.searchTerm);
      if (isProductTargeting) {
        existing.hasProductTargeting = true;
      }
      
      ngramStats.set(ngram, existing);
    }
  }
  
  // 转换为结果数组并筛选高频无效词根
  const results: NgramAnalysisResult[] = [];
  
  // 预定义的常见负面词根
  const knownNegativePatterns = [
    'cheap', 'free', 'used', 'broken', 'repair', 'fix', 
    'diy', 'homemade', 'alternative', 'substitute',
    'wholesale', 'bulk', 'clearance', 'discount',
    'how to', 'what is', 'review', 'vs', 'versus'
  ];
  
  for (const [ngram, stats] of Array.from(ngramStats.entries())) {
    // 只考虑出现频率>=3的词根
    if (stats.frequency >= 3) {
      const conversionRate = stats.totalConversions / stats.totalClicks;
      const isKnownNegative = knownNegativePatterns.some(
        pattern => ngram.includes(pattern)
      );
      
      let reason = '';
      let isNegativeCandidate = false;
      
      if (conversionRate === 0 && stats.frequency >= 5) {
        isNegativeCandidate = true;
        reason = `出现${stats.frequency}次，${stats.totalClicks}次点击，0转化，浪费$${stats.totalSpend.toFixed(2)}`;
      } else if (isKnownNegative) {
        isNegativeCandidate = true;
        reason = `匹配已知负面词根模式`;
      } else if (conversionRate < 0.01 && stats.totalClicks >= 10) {
        isNegativeCandidate = true;
        reason = `转化率仅${(conversionRate * 100).toFixed(2)}%，低于1%阈值`;
      }
      
      // 决定否定层级
      // 如果包含产品定位广告的搜索词，建议在活动层级否定
      const suggestedNegativeLevel = stats.hasProductTargeting ? 'campaign' : 'ad_group';
      
      results.push({
        ngram,
        frequency: stats.frequency,
        totalClicks: stats.totalClicks,
        totalConversions: stats.totalConversions,
        totalSpend: stats.totalSpend,
        conversionRate,
        isNegativeCandidate,
        reason,
        affectedTerms: stats.terms,
        suggestedNegativeLevel,
        hasProductTargeting: stats.hasProductTargeting
      });
    }
  }
  
  // 按频率降序排序
  return results.sort((a, b) => b.frequency - a.frequency);
}

// ============================================
// 2. 广告漏斗自动迁移系统
// ============================================

/**
 * 广告漏斗迁移分析
 * 广泛匹配 → 短语匹配：3次以上成交
 * 短语匹配 → 精准匹配：10次以上成交且ROAS>5
 * 
 * 重要：迁移后需要在原活动否定该词
 * - 关键词广告：可以在广告组层级否定
 * - 产品定位广告：只能在活动层级否定
 */
export function analyzeFunnelMigration(
  searchTerms: CampaignSearchTerm[],
  config: {
    broadToPhrase: { minConversions: number; minRoas: number };
    phraseToExact: { minConversions: number; minRoas: number };
    bidIncreasePercent: number;
  } = {
    broadToPhrase: { minConversions: 3, minRoas: 1 },
    phraseToExact: { minConversions: 10, minRoas: 5 },
    bidIncreasePercent: 20
  }
): MigrationSuggestion[] {
  const suggestions: MigrationSuggestion[] = [];
  
  for (const term of searchTerms) {
    // 决定否定层级
    const negativeLevel = term.targetingType === 'product' ? 'campaign' : 'ad_group';
    
    // 广泛匹配 → 短语匹配
    if (term.matchType === 'broad' || term.matchType === 'auto') {
      if (term.conversions >= config.broadToPhrase.minConversions && 
          term.roas >= config.broadToPhrase.minRoas) {
        const suggestedBid = term.cpc * (1 + config.bidIncreasePercent / 100);
        
        suggestions.push({
          searchTerm: term.searchTerm,
          fromCampaign: term.campaignName,
          fromMatchType: term.matchType,
          toMatchType: 'phrase',
          reason: `${term.conversions}次成交，ROAS ${term.roas.toFixed(2)}，符合迁移条件`,
          suggestedBid: Math.round(suggestedBid * 100) / 100,
          currentCpc: term.cpc,
          conversions: term.conversions,
          roas: term.roas,
          priority: term.conversions >= 5 ? 'high' : 'medium',
          negativeInOriginal: true,
          negativeLevel
        });
      }
    }
    
    // 短语匹配 → 精准匹配
    if (term.matchType === 'phrase') {
      if (term.conversions >= config.phraseToExact.minConversions && 
          term.roas >= config.phraseToExact.minRoas) {
        const suggestedBid = term.cpc * (1 + config.bidIncreasePercent / 100);
        
        suggestions.push({
          searchTerm: term.searchTerm,
          fromCampaign: term.campaignName,
          fromMatchType: 'phrase',
          toMatchType: 'exact',
          reason: `${term.conversions}次成交，ROAS ${term.roas.toFixed(2)}，高价值流量`,
          suggestedBid: Math.round(suggestedBid * 100) / 100,
          currentCpc: term.cpc,
          conversions: term.conversions,
          roas: term.roas,
          priority: term.roas >= 8 ? 'high' : 'medium',
          negativeInOriginal: true,
          negativeLevel
        });
      }
    }
    
    // 产品定位广告的高转化搜索词 → 建议创建关键词广告
    if (term.targetingType === 'product' && term.conversions >= 5 && term.roas >= 3) {
      suggestions.push({
        searchTerm: term.searchTerm,
        fromCampaign: term.campaignName,
        fromMatchType: 'product',
        toMatchType: 'phrase', // 建议先用短语匹配测试
        reason: `产品定位广告中发现高转化搜索词（${term.conversions}次成交），建议创建关键词广告`,
        suggestedBid: Math.round(term.cpc * 1.1 * 100) / 100,
        currentCpc: term.cpc,
        conversions: term.conversions,
        roas: term.roas,
        priority: 'high',
        negativeInOriginal: false, // 产品定位广告不需要否定这个搜索词
        negativeLevel: 'campaign' // 如果需要否定，只能在活动层级
      });
    }
  }
  
  // 按优先级和转化数排序
  return suggestions.sort((a, b) => {
    if (a.priority !== b.priority) {
      return a.priority === 'high' ? -1 : 1;
    }
    return b.conversions - a.conversions;
  });
}

// ============================================
// 3. 流量隔离与冲突检测
// ============================================

/**
 * 流量冲突检测
 * 检测同一搜索词在多个广告活动中出现的情况
 * 
 * 重要：根据失败活动的类型决定否定层级
 * - 关键词广告：可以在广告组层级否定
 * - 产品定位广告：只能在活动层级否定
 */
export function detectTrafficConflicts(
  searchTerms: CampaignSearchTerm[]
): TrafficConflict[] {
  // 按搜索词分组
  const termGroups: Map<string, CampaignSearchTerm[]> = new Map();
  
  for (const term of searchTerms) {
    const key = term.searchTerm.toLowerCase();
    const existing = termGroups.get(key) || [];
    existing.push(term);
    termGroups.set(key, existing);
  }
  
  const conflicts: TrafficConflict[] = [];
  
  for (const [searchTerm, terms] of Array.from(termGroups.entries())) {
    // 只处理在多个活动中出现的搜索词
    if (terms.length > 1) {
      // 计算每个活动的综合得分
      const campaignScores = terms.map((t: CampaignSearchTerm) => {
        const cvr = t.clicks > 0 ? t.conversions / t.clicks : 0;
        const ctr = t.clicks > 0 ? t.clicks / (t.clicks + 100) : 0; // 假设曝光数据
        
        // 综合得分 = ROAS权重 + 转化率权重 + 转化数权重
        const score = (t.roas * 0.4) + (cvr * 100 * 0.3) + (t.conversions * 0.3);
        
        return {
          campaignId: t.campaignId,
          campaignName: t.campaignName,
          campaignType: t.campaignType,
          targetingType: t.targetingType,
          matchType: t.matchType,
          clicks: t.clicks,
          conversions: t.conversions,
          spend: t.spend,
          sales: t.sales,
          roas: t.roas,
          ctr,
          cvr,
          score
        };
      });
      
      // 找出表现最好的活动
      campaignScores.sort((a, b) => b.score - a.score);
      const winner = campaignScores[0];
      const losers = campaignScores.slice(1);
      
      // 计算浪费的花费（表现差的活动的花费）
      const wastedSpend = losers.reduce((sum, l) => sum + l.spend, 0);
      
      // 为每个失败活动决定否定层级
      const loserCampaigns = losers.map(l => ({
        name: l.campaignName,
        campaignType: l.campaignType,
        targetingType: l.targetingType,
        negativeLevel: l.targetingType === 'product' ? 'campaign' as const : 'ad_group' as const
      }));
      
      conflicts.push({
        searchTerm,
        campaigns: campaignScores.map(c => ({
          campaignId: c.campaignId,
          campaignName: c.campaignName,
          campaignType: c.campaignType,
          targetingType: c.targetingType,
          matchType: c.matchType,
          clicks: c.clicks,
          conversions: c.conversions,
          spend: c.spend,
          sales: c.sales,
          roas: c.roas,
          ctr: c.ctr,
          cvr: c.cvr
        })),
        recommendation: {
          winnerCampaign: winner.campaignName,
          winnerCampaignType: winner.campaignType,
          winnerTargetingType: winner.targetingType,
          loserCampaigns,
          action: 'negative_exact',
          reason: `${winner.campaignName}表现最佳（ROAS: ${winner.roas.toFixed(2)}, CVR: ${(winner.cvr * 100).toFixed(1)}%），建议在其他活动中否定此词`
        },
        totalWastedSpend: Math.round(wastedSpend * 100) / 100
      });
    }
  }
  
  // 按浪费花费降序排序
  return conflicts.sort((a, b) => b.totalWastedSpend - a.totalWastedSpend);
}

// ============================================
// 4. 智能竞价调整系统
// ============================================

/**
 * 智能竞价调整分析
 * 包含爬坡机制、纠错机制、分时策略
 */
export function analyzeBidAdjustments(
  targets: BidTarget[],
  config: {
    rampUpPercent: number;        // 爬坡增幅（默认5%）
    maxBidMultiplier: number;     // 最大出价倍数
    minImpressions: number;       // 最小曝光阈值
    correctionWindow: number;     // 纠错窗口（天）
    targetAcos: number;           // 目标ACoS
    targetRoas: number;           // 目标ROAS
  } = {
    rampUpPercent: 5,
    maxBidMultiplier: 3,
    minImpressions: 100,
    correctionWindow: 14,
    targetAcos: 30,
    targetRoas: 3.33
  }
): BidAdjustmentSuggestion[] {
  const suggestions: BidAdjustmentSuggestion[] = [];
  
  for (const target of targets) {
    const ctr = target.impressions > 0 ? target.clicks / target.impressions : 0;
    const cvr = target.clicks > 0 ? target.conversions / target.clicks : 0;
    const acos = target.sales > 0 ? (target.spend / target.sales) * 100 : 0;
    const roas = target.spend > 0 ? target.sales / target.spend : 0;
    
    const effectiveTargetAcos = target.targetAcos || config.targetAcos;
    const effectiveTargetRoas = target.targetRoas || config.targetRoas;
    
    let suggestedBid = target.currentBid;
    let adjustmentType: 'increase' | 'decrease' | 'maintain' = 'maintain';
    let reason = '';
    let priority: 'urgent' | 'high' | 'medium' | 'low' = 'low';
    
    // 场景1: 爬坡机制 - 曝光不足
    if (target.impressions < config.minImpressions) {
      suggestedBid = target.currentBid * (1 + config.rampUpPercent / 100);
      adjustmentType = 'increase';
      reason = `曝光不足（${target.impressions}次），建议提升${config.rampUpPercent}%竞价以获取更多曝光`;
      priority = 'high';
    }
    // 场景2: 高表现 - ACoS低于目标，可以提高出价抢更多流量
    else if (acos > 0 && acos < effectiveTargetAcos * 0.7 && target.conversions >= 3) {
      const increasePercent = Math.min(20, (effectiveTargetAcos - acos) / effectiveTargetAcos * 30);
      suggestedBid = target.currentBid * (1 + increasePercent / 100);
      adjustmentType = 'increase';
      reason = `ACoS ${acos.toFixed(1)}%远低于目标${effectiveTargetAcos}%，有提价空间`;
      priority = 'medium';
    }
    // 场景3: 低表现 - ACoS高于目标，需要降低出价
    else if (acos > effectiveTargetAcos * 1.3 && target.clicks >= 20) {
      const decreasePercent = Math.min(30, (acos - effectiveTargetAcos) / acos * 40);
      suggestedBid = target.currentBid * (1 - decreasePercent / 100);
      adjustmentType = 'decrease';
      reason = `ACoS ${acos.toFixed(1)}%超出目标${effectiveTargetAcos}%，建议降价`;
      priority = 'high';
    }
    // 场景4: 纠错机制 - 检测可能的错误调价
    else if (target.daysSinceLastChange && target.daysSinceLastChange <= config.correctionWindow) {
      // 如果最近调价后表现变差，可能需要回调
      if (target.conversions >= 2 && roas < effectiveTargetRoas * 0.5) {
        suggestedBid = target.currentBid * 0.9;
        adjustmentType = 'decrease';
        reason = `近期调价后ROAS下降至${roas.toFixed(2)}，建议回调竞价`;
        priority = 'urgent';
      }
    }
    // 场景5: 零转化但有点击 - 可能需要降价或暂停
    else if (target.clicks >= 30 && target.conversions === 0) {
      suggestedBid = target.currentBid * 0.7;
      adjustmentType = 'decrease';
      reason = `${target.clicks}次点击无转化，建议大幅降价或考虑暂停`;
      priority = 'urgent';
    }
    
    // 确保出价在合理范围内
    const maxBid = target.currentBid * config.maxBidMultiplier;
    const minBid = 0.02; // 最低出价
    suggestedBid = Math.max(minBid, Math.min(maxBid, suggestedBid));
    suggestedBid = Math.round(suggestedBid * 100) / 100;
    
    const adjustmentPercent = ((suggestedBid - target.currentBid) / target.currentBid) * 100;
    
    // 只添加需要调整的建议
    if (Math.abs(adjustmentPercent) >= 3) {
      suggestions.push({
        targetId: target.id,
        targetType: target.type,
        targetName: target.name,
        campaignName: target.campaignName,
        currentBid: target.currentBid,
        suggestedBid,
        adjustmentPercent: Math.round(adjustmentPercent * 10) / 10,
        adjustmentType,
        reason,
        priority,
        metrics: {
          impressions: target.impressions,
          clicks: target.clicks,
          conversions: target.conversions,
          spend: target.spend,
          sales: target.sales,
          acos: Math.round(acos * 10) / 10,
          roas: Math.round(roas * 100) / 100,
          ctr: Math.round(ctr * 10000) / 100,
          cvr: Math.round(cvr * 10000) / 100
        }
      });
    }
  }
  
  // 按优先级排序
  const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
  return suggestions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
}

// ============================================
// 5. 搜索词智能分类
// ============================================

/**
 * 搜索词智能分类
 * 基于产品关键词和搜索词特征进行分类
 */
export function classifySearchTerms(
  searchTerms: string[],
  productKeywords: string[],
  productAttributes: {
    category: string;
    brand: string;
    colors?: string[];
    sizes?: string[];
    materials?: string[];
  }
): SearchTermClassification[] {
  const results: SearchTermClassification[] = [];
  
  // 构建产品关键词集合
  const keywordSet = new Set(productKeywords.map(k => k.toLowerCase()));
  const categoryWords = productAttributes.category.toLowerCase().split(/\s+/);
  const brandLower = productAttributes.brand.toLowerCase();
  
  // 负面词根模式
  const negativePatterns = [
    'free', 'cheap', 'used', 'broken', 'repair', 'fix', 'diy',
    'how to', 'what is', 'review', 'vs', 'versus', 'alternative',
    'wholesale', 'bulk', 'clearance'
  ];
  
  // 看似相关但实则无关的模式（颜色、尺寸不匹配）
  const attributeMismatchCheck = (term: string): boolean => {
    const termLower = term.toLowerCase();
    
    // 检查颜色不匹配
    if (productAttributes.colors && productAttributes.colors.length > 0) {
      const allColors = ['red', 'blue', 'green', 'yellow', 'black', 'white', 'pink', 'purple', 'orange', 'brown', 'gray', 'grey'];
      const productColors = productAttributes.colors.map(c => c.toLowerCase());
      
      for (const color of allColors) {
        if (termLower.includes(color) && !productColors.includes(color)) {
          return true;
        }
      }
    }
    
    // 检查尺寸不匹配
    if (productAttributes.sizes && productAttributes.sizes.length > 0) {
      const sizePatterns = ['small', 'medium', 'large', 'xl', 'xxl', 'xs', 'mini', 'jumbo'];
      const productSizes = productAttributes.sizes.map(s => s.toLowerCase());
      
      for (const size of sizePatterns) {
        if (termLower.includes(size) && !productSizes.some(ps => ps.includes(size))) {
          return true;
        }
      }
    }
    
    return false;
  };
  
  for (const term of searchTerms) {
    const termLower = term.toLowerCase();
    const termTokens = tokenize(term);
    
    let relevance: SearchTermRelevance = 'unrelated';
    let confidence = 0;
    let reason = '';
    let suggestedAction: 'target' | 'monitor' | 'negative_phrase' | 'negative_exact' = 'negative_exact';
    let matchTypeSuggestion: 'exact' | 'phrase' | 'broad' | undefined;
    
    // 检查是否包含负面词根
    const hasNegativePattern = negativePatterns.some(p => termLower.includes(p));
    if (hasNegativePattern) {
      relevance = 'unrelated';
      confidence = 0.9;
      reason = '包含负面词根（如cheap, free, used等）';
      suggestedAction = 'negative_phrase';
    }
    // 检查属性不匹配
    else if (attributeMismatchCheck(term)) {
      relevance = 'seemingly_related';
      confidence = 0.75;
      reason = '产品属性不匹配（颜色/尺寸）';
      suggestedAction = 'negative_exact';
    }
    // 检查是否精确匹配产品关键词
    else if (keywordSet.has(termLower)) {
      relevance = 'high';
      confidence = 0.95;
      reason = '精确匹配产品关键词';
      suggestedAction = 'target';
      matchTypeSuggestion = 'exact';
    }
    // 检查是否包含品牌词
    else if (termLower.includes(brandLower)) {
      relevance = 'high';
      confidence = 0.9;
      reason = '包含品牌词';
      suggestedAction = 'target';
      matchTypeSuggestion = 'phrase';
    }
    // 检查是否包含类目词
    else if (categoryWords.some(cw => termLower.includes(cw))) {
      const matchedWords = categoryWords.filter(cw => termLower.includes(cw));
      if (matchedWords.length >= 2) {
        relevance = 'high';
        confidence = 0.8;
        reason = '包含多个类目关键词';
        suggestedAction = 'target';
        matchTypeSuggestion = 'phrase';
      } else {
        relevance = 'weak';
        confidence = 0.6;
        reason = '仅包含部分类目关键词';
        suggestedAction = 'monitor';
        matchTypeSuggestion = 'broad';
      }
    }
    // 检查是否包含产品关键词的部分
    else {
      const matchedKeywords = productKeywords.filter(k => 
        termLower.includes(k.toLowerCase()) || k.toLowerCase().includes(termLower)
      );
      
      if (matchedKeywords.length > 0) {
        relevance = 'weak';
        confidence = 0.5;
        reason = '部分匹配产品关键词';
        suggestedAction = 'monitor';
        matchTypeSuggestion = 'broad';
      } else {
        relevance = 'unrelated';
        confidence = 0.7;
        reason = '与产品关键词无明显关联';
        suggestedAction = 'negative_exact';
      }
    }
    
    results.push({
      searchTerm: term,
      relevance,
      confidence,
      reason,
      suggestedAction,
      matchTypeSuggestion
    });
  }
  
  return results;
}

// ============================================
// 6. 否词前置系统
// ============================================

/**
 * 获取预设的负面词库
 * 用于新活动开启前自动预加载
 */
export function getPresetNegativeKeywords(category: string): string[] {
  // 通用负面词
  const commonNegatives = [
    'free', 'cheap', 'cheapest', 'used', 'broken', 'repair', 'fix',
    'diy', 'homemade', 'alternative', 'substitute', 'replacement',
    'wholesale', 'bulk', 'clearance', 'discount', 'coupon',
    'how to', 'what is', 'review', 'reviews', 'vs', 'versus',
    'reddit', 'amazon', 'ebay', 'walmart', 'aliexpress',
    'download', 'pdf', 'manual', 'instructions'
  ];
  
  // 类目特定的负面词
  const categoryNegatives: Record<string, string[]> = {
    'electronics': ['schematic', 'circuit', 'datasheet', 'pinout', 'driver'],
    'clothing': ['pattern', 'sewing', 'fabric', 'material', 'costume'],
    'toys': ['plans', 'blueprint', 'build', 'make', 'craft'],
    'home': ['rental', 'rent', 'lease', 'apartment'],
    'beauty': ['recipe', 'homemade', 'natural', 'organic diy'],
    'sports': ['rules', 'how to play', 'history', 'olympics']
  };
  
  const categoryLower = category.toLowerCase();
  const specificNegatives = categoryNegatives[categoryLower] || [];
  
  return [...commonNegatives, ...specificNegatives];
}

// ============================================
// 7. 辅助函数
// ============================================

/**
 * 判断广告活动是否为产品定位类型
 */
export function isProductTargetingCampaign(campaignType: string, targetingType?: string): boolean {
  // SP自动广告可能包含产品定位
  if (campaignType === 'sp_auto') {
    return targetingType === 'product';
  }
  // SD广告通常是产品定位
  if (campaignType === 'sd') {
    return true;
  }
  // SP手动广告需要检查targetingType
  if (campaignType === 'sp_manual') {
    return targetingType === 'product';
  }
  return false;
}

/**
 * 获取否定词的推荐层级
 */
export function getNegativeLevelRecommendation(
  campaignType: string,
  targetingType?: string
): 'ad_group' | 'campaign' {
  // 产品定位广告只能在活动层级否定
  if (isProductTargetingCampaign(campaignType, targetingType)) {
    return 'campaign';
  }
  // 关键词广告优先在广告组层级否定（更精细）
  return 'ad_group';
}
