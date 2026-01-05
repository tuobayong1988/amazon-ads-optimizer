/**
 * 广告自动化核心算法模块
 * 基于亚马逊运营流程文档实现的自动化功能
 */

// ============================================
// 1. N-Gram词根分析与批量降噪
// ============================================

interface SearchTermData {
  searchTerm: string;
  clicks: number;
  conversions: number;
  spend: number;
  sales: number;
  impressions: number;
}

interface NgramAnalysisResult {
  ngram: string;
  frequency: number;
  totalClicks: number;
  totalConversions: number;
  conversionRate: number;
  isNegativeCandidate: boolean;
  reason: string;
  affectedTerms: string[];
}

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
    terms: string[];
  }> = new Map();
  
  for (const term of ineffectiveTerms) {
    const tokens = tokenize(term.searchTerm);
    const ngrams = generateNgrams(tokens);
    
    for (const ngram of ngrams) {
      const existing = ngramStats.get(ngram) || {
        frequency: 0,
        totalClicks: 0,
        totalConversions: 0,
        terms: []
      };
      
      existing.frequency++;
      existing.totalClicks += term.clicks;
      existing.totalConversions += term.conversions;
      existing.terms.push(term.searchTerm);
      
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
        reason = `出现${stats.frequency}次，${stats.totalClicks}次点击，0转化`;
      } else if (isKnownNegative) {
        isNegativeCandidate = true;
        reason = `匹配已知负面词根模式`;
      } else if (conversionRate < 0.01 && stats.totalClicks >= 10) {
        isNegativeCandidate = true;
        reason = `转化率仅${(conversionRate * 100).toFixed(2)}%，低于1%阈值`;
      }
      
      results.push({
        ngram,
        frequency: stats.frequency,
        totalClicks: stats.totalClicks,
        totalConversions: stats.totalConversions,
        conversionRate,
        isNegativeCandidate,
        reason,
        affectedTerms: stats.terms
      });
    }
  }
  
  // 按频率降序排序
  return results.sort((a, b) => b.frequency - a.frequency);
}

// ============================================
// 2. 广告漏斗自动迁移系统
// ============================================

interface CampaignSearchTerm {
  searchTerm: string;
  campaignId: number;
  campaignName: string;
  matchType: 'broad' | 'phrase' | 'exact';
  clicks: number;
  conversions: number;
  spend: number;
  sales: number;
  roas: number;
  acos: number;
  cpc: number;
}

interface MigrationSuggestion {
  searchTerm: string;
  fromCampaign: string;
  fromMatchType: 'broad' | 'phrase' | 'exact';
  toMatchType: 'broad' | 'phrase' | 'exact';
  reason: string;
  suggestedBid: number;
  currentCpc: number;
  conversions: number;
  roas: number;
  priority: 'high' | 'medium' | 'low';
}

/**
 * 广告漏斗迁移分析
 * 广泛匹配 → 短语匹配：3次以上成交
 * 短语匹配 → 精准匹配：10次以上成交且ROAS>5
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
    // 广泛匹配 → 短语匹配
    if (term.matchType === 'broad') {
      if (term.conversions >= config.broadToPhrase.minConversions && 
          term.roas >= config.broadToPhrase.minRoas) {
        const suggestedBid = term.cpc * (1 + config.bidIncreasePercent / 100);
        
        suggestions.push({
          searchTerm: term.searchTerm,
          fromCampaign: term.campaignName,
          fromMatchType: 'broad',
          toMatchType: 'phrase',
          reason: `${term.conversions}次成交，ROAS ${term.roas.toFixed(2)}，符合迁移条件`,
          suggestedBid: Math.round(suggestedBid * 100) / 100,
          currentCpc: term.cpc,
          conversions: term.conversions,
          roas: term.roas,
          priority: term.conversions >= 5 ? 'high' : 'medium'
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
          priority: term.roas >= 8 ? 'high' : 'medium'
        });
      }
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

interface TrafficConflict {
  searchTerm: string;
  campaigns: {
    campaignId: number;
    campaignName: string;
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
    loserCampaigns: string[];
    action: 'negative_exact' | 'negative_phrase';
    reason: string;
  };
  totalWastedSpend: number;
}

/**
 * 流量冲突检测
 * 检测同一搜索词在多个广告活动中出现的情况
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
      campaignScores.sort((a: { score: number }, b: { score: number }) => b.score - a.score);
      const winner = campaignScores[0];
      const losers = campaignScores.slice(1);
      
      // 计算浪费的花费（表现差的活动的花费）
      const wastedSpend = losers.reduce((sum: number, l: typeof campaignScores[0]) => sum + l.spend, 0);
      
      conflicts.push({
        searchTerm,
        campaigns: campaignScores.map((c: typeof campaignScores[0]) => ({
          campaignId: c.campaignId,
          campaignName: c.campaignName,
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
          loserCampaigns: losers.map((l: typeof campaignScores[0]) => l.campaignName),
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

interface BidAdjustmentSuggestion {
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

interface BidTarget {
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

type SearchTermRelevance = 'high' | 'weak' | 'seemingly_related' | 'unrelated';

interface SearchTermClassification {
  searchTerm: string;
  relevance: SearchTermRelevance;
  confidence: number;
  reason: string;
  suggestedAction: 'target' | 'monitor' | 'negative_phrase' | 'negative_exact';
  matchTypeSuggestion?: 'exact' | 'phrase' | 'broad';
}

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
      reason = '包含负面词根模式';
      suggestedAction = 'negative_phrase';
    }
    // 检查属性不匹配（看似相关实则无关）
    else if (attributeMismatchCheck(term)) {
      relevance = 'seemingly_related';
      confidence = 0.8;
      reason = '产品属性（颜色/尺寸）不匹配';
      suggestedAction = 'negative_exact';
    }
    // 检查是否包含产品关键词
    else {
      const matchedKeywords = termTokens.filter(t => keywordSet.has(t));
      const categoryMatch = categoryWords.some(cw => termLower.includes(cw));
      
      if (matchedKeywords.length >= 2 || (matchedKeywords.length >= 1 && categoryMatch)) {
        relevance = 'high';
        confidence = 0.85;
        reason = `匹配${matchedKeywords.length}个产品关键词`;
        suggestedAction = 'target';
        
        // 判断匹配类型建议
        if (termTokens.length <= 3 && matchedKeywords.length === termTokens.length) {
          matchTypeSuggestion = 'exact';
        } else if (categoryMatch) {
          matchTypeSuggestion = 'phrase';
        } else {
          matchTypeSuggestion = 'broad';
        }
      }
      else if (matchedKeywords.length === 1 || categoryMatch) {
        relevance = 'weak';
        confidence = 0.6;
        reason = '部分匹配产品关键词';
        suggestedAction = 'monitor';
        matchTypeSuggestion = 'broad';
      }
      else {
        relevance = 'unrelated';
        confidence = 0.7;
        reason = '未匹配任何产品关键词';
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
// 6. 匹配类型智能决策
// ============================================

interface MatchTypeDecision {
  keyword: string;
  recommendedMatchType: 'exact' | 'phrase' | 'broad';
  confidence: number;
  reasons: string[];
  characteristics: {
    isIdentityKeyword: boolean;      // 绝对定义词
    isLongTailHighIntent: boolean;   // 长尾高意图词
    isBrandKeyword: boolean;         // 品牌词
    isScenarioKeyword: boolean;      // 场景化词
    isAttributeCombo: boolean;       // 属性组合词
  };
}

/**
 * 匹配类型智能决策
 * 基于文档中的决策矩阵判断关键词应该使用的匹配类型
 */
export function decideMatchType(
  keyword: string,
  context: {
    productCategory: string;
    brandName: string;
    competitorBrands?: string[];
    coreAttributes?: string[];
    searchVolume?: number;
    conversionRate?: number;
    competitorSimilarity?: number; // SERP前10名竞品相似度
  }
): MatchTypeDecision {
  const keywordLower = keyword.toLowerCase();
  const tokens = tokenize(keyword);
  const reasons: string[] = [];
  
  // 特征检测
  const characteristics = {
    isIdentityKeyword: false,
    isLongTailHighIntent: false,
    isBrandKeyword: false,
    isScenarioKeyword: false,
    isAttributeCombo: false
  };
  
  // 1. 检测品牌词
  const allBrands = [context.brandName, ...(context.competitorBrands || [])].map(b => b.toLowerCase());
  if (allBrands.some(brand => keywordLower.includes(brand))) {
    characteristics.isBrandKeyword = true;
    reasons.push('包含品牌名称');
  }
  
  // 2. 检测场景化/受众化词
  const scenarioPatterns = ['for', 'gift', 'travel', 'camping', 'office', 'home', 'outdoor', 'indoor', 'kids', 'men', 'women', 'boys', 'girls'];
  if (scenarioPatterns.some(p => keywordLower.includes(p))) {
    characteristics.isScenarioKeyword = true;
    reasons.push('包含场景/受众修饰词');
  }
  
  // 3. 检测绝对定义词
  const categoryWords = context.productCategory.toLowerCase().split(/\s+/);
  const coreAttrs = (context.coreAttributes || []).map(a => a.toLowerCase());
  const matchedCategory = categoryWords.filter(cw => keywordLower.includes(cw));
  const matchedAttrs = coreAttrs.filter(attr => keywordLower.includes(attr));
  
  if (matchedCategory.length >= 1 && matchedAttrs.length >= 1) {
    characteristics.isIdentityKeyword = true;
    reasons.push('包含核心类目词+属性词');
  }
  
  // 4. 检测长尾高意图词
  if (tokens.length >= 3 && !characteristics.isScenarioKeyword) {
    characteristics.isLongTailHighIntent = true;
    reasons.push('长尾词（3+单词），意图明确');
  }
  
  // 5. 检测属性组合词
  const attributePatterns = ['color', 'size', 'material', 'style', 'type'];
  if (tokens.length >= 2 && !characteristics.isScenarioKeyword && !characteristics.isLongTailHighIntent) {
    characteristics.isAttributeCombo = true;
    reasons.push('核心词+属性组合');
  }
  
  // 决策逻辑
  let recommendedMatchType: 'exact' | 'phrase' | 'broad' = 'broad';
  let confidence = 0.5;
  
  // 精准匹配条件
  if (characteristics.isIdentityKeyword) {
    recommendedMatchType = 'exact';
    confidence = 0.9;
    reasons.push('→ 绝对定义词，建议精准匹配');
  }
  else if (characteristics.isLongTailHighIntent && (context.conversionRate || 0) > 0.05) {
    recommendedMatchType = 'exact';
    confidence = 0.85;
    reasons.push('→ 长尾高意图词，建议精准匹配');
  }
  else if (characteristics.isBrandKeyword && !characteristics.isScenarioKeyword) {
    recommendedMatchType = 'exact';
    confidence = 0.88;
    reasons.push('→ 品牌词，建议精准匹配');
  }
  // 短语匹配条件
  else if (characteristics.isAttributeCombo) {
    recommendedMatchType = 'phrase';
    confidence = 0.75;
    reasons.push('→ 属性组合词，建议短语匹配');
  }
  else if (characteristics.isScenarioKeyword) {
    recommendedMatchType = 'phrase';
    confidence = 0.7;
    reasons.push('→ 场景化词，建议短语匹配以覆盖变体');
  }
  // 广泛匹配条件
  else {
    recommendedMatchType = 'broad';
    confidence = 0.6;
    reasons.push('→ 探索性词，建议广泛匹配');
  }
  
  // 根据竞品相似度调整
  if (context.competitorSimilarity && context.competitorSimilarity > 0.9) {
    if (recommendedMatchType === 'phrase') {
      recommendedMatchType = 'exact';
      confidence += 0.05;
      reasons.push('SERP竞品高度相似，升级为精准匹配');
    }
  }
  
  return {
    keyword,
    recommendedMatchType,
    confidence: Math.min(0.95, confidence),
    reasons,
    characteristics
  };
}

// ============================================
// 7. 否词前置系统
// ============================================

interface NegativeKeywordPreset {
  keyword: string;
  matchType: 'phrase' | 'exact';
  category: string;
  reason: string;
}

/**
 * 生成否词前置列表
 * 基于产品类目和历史数据生成应该预先否定的词
 */
export function generateNegativePresets(
  productCategory: string,
  historicalNegatives?: string[]
): NegativeKeywordPreset[] {
  const presets: NegativeKeywordPreset[] = [];
  
  // 通用负面词根（适用于所有类目）
  const universalNegatives = [
    { keyword: 'free', reason: '免费相关，无购买意图' },
    { keyword: 'cheap', reason: '低价导向，可能影响品牌形象' },
    { keyword: 'used', reason: '二手商品搜索' },
    { keyword: 'broken', reason: '损坏/维修相关' },
    { keyword: 'repair', reason: '维修服务搜索' },
    { keyword: 'fix', reason: '修理相关' },
    { keyword: 'diy', reason: 'DIY自制，非购买意图' },
    { keyword: 'how to', reason: '信息搜索，非购买意图' },
    { keyword: 'what is', reason: '信息搜索，非购买意图' },
    { keyword: 'wholesale', reason: '批发搜索，非零售客户' },
    { keyword: 'bulk', reason: '批量采购，非零售客户' },
    { keyword: 'clearance', reason: '清仓搜索' },
    { keyword: 'coupon', reason: '优惠券搜索' },
    { keyword: 'promo code', reason: '促销码搜索' },
    { keyword: 'return', reason: '退货相关' },
    { keyword: 'refund', reason: '退款相关' },
    { keyword: 'complaint', reason: '投诉相关' },
    { keyword: 'lawsuit', reason: '法律诉讼相关' },
    { keyword: 'recall', reason: '召回相关' }
  ];
  
  // 添加通用负面词
  for (const neg of universalNegatives) {
    presets.push({
      keyword: neg.keyword,
      matchType: 'phrase',
      category: '通用负面词',
      reason: neg.reason
    });
  }
  
  // 添加历史否定词
  if (historicalNegatives) {
    for (const neg of historicalNegatives) {
      if (!presets.some(p => p.keyword === neg)) {
        presets.push({
          keyword: neg,
          matchType: 'exact',
          category: '历史否定词',
          reason: '基于历史数据识别的无效词'
        });
      }
    }
  }
  
  return presets;
}

// ============================================
// 8. 半月纠错复盘
// ============================================

interface CorrectionSuggestion {
  targetId: number;
  targetName: string;
  campaignName: string;
  issueType: 'wrong_bid_decrease' | 'wrong_bid_increase' | 'wrong_negative';
  description: string;
  originalValue: number | string;
  currentValue: number | string;
  suggestedAction: string;
  impactEstimate: string;
}

interface HistoricalChange {
  targetId: number;
  targetName: string;
  campaignName: string;
  changeType: 'bid_change' | 'negative_add';
  changeDate: Date;
  oldValue: number | string;
  newValue: number | string;
  // 变更后的表现数据
  postChangeMetrics?: {
    conversions: number;
    spend: number;
    sales: number;
    roas: number;
  };
}

/**
 * 半月纠错复盘分析
 * 检测因归因延迟导致的错误调价/否词
 */
export function analyzeCorrections(
  historicalChanges: HistoricalChange[],
  correctionWindowDays: number = 14
): CorrectionSuggestion[] {
  const suggestions: CorrectionSuggestion[] = [];
  const now = new Date();
  const windowStart = new Date(now.getTime() - correctionWindowDays * 24 * 60 * 60 * 1000);
  
  // 筛选纠错窗口内的变更
  const recentChanges = historicalChanges.filter(
    change => change.changeDate >= windowStart
  );
  
  for (const change of recentChanges) {
    if (change.changeType === 'bid_change' && change.postChangeMetrics) {
      const oldBid = change.oldValue as number;
      const newBid = change.newValue as number;
      const metrics = change.postChangeMetrics;
      
      // 检测错误降价：降价后仍有转化，可能是因为归因延迟导致的误判
      if (newBid < oldBid && metrics.conversions >= 2 && metrics.roas >= 3) {
        suggestions.push({
          targetId: change.targetId,
          targetName: change.targetName,
          campaignName: change.campaignName,
          issueType: 'wrong_bid_decrease',
          description: `降价后仍有${metrics.conversions}次转化，ROAS ${metrics.roas.toFixed(2)}，可能是归因延迟导致的误判`,
          originalValue: oldBid,
          currentValue: newBid,
          suggestedAction: `建议恢复竞价至$${oldBid.toFixed(2)}或更高`,
          impactEstimate: `预计可增加${Math.round(metrics.conversions * 0.3)}次转化`
        });
      }
      
      // 检测错误提价：提价后表现变差
      if (newBid > oldBid * 1.2 && metrics.roas < 2) {
        suggestions.push({
          targetId: change.targetId,
          targetName: change.targetName,
          campaignName: change.campaignName,
          issueType: 'wrong_bid_increase',
          description: `提价${Math.round((newBid/oldBid - 1) * 100)}%后ROAS下降至${metrics.roas.toFixed(2)}`,
          originalValue: oldBid,
          currentValue: newBid,
          suggestedAction: `建议降低竞价至$${(oldBid * 1.1).toFixed(2)}`,
          impactEstimate: `预计可节省$${(metrics.spend * 0.2).toFixed(2)}广告费`
        });
      }
    }
  }
  
  return suggestions;
}

// 导出所有函数
export {
  SearchTermData,
  NgramAnalysisResult,
  CampaignSearchTerm,
  MigrationSuggestion,
  TrafficConflict,
  BidAdjustmentSuggestion,
  BidTarget,
  SearchTermClassification,
  MatchTypeDecision,
  NegativeKeywordPreset,
  CorrectionSuggestion,
  HistoricalChange
};
