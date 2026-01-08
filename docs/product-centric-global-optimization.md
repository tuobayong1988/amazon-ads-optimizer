# 以产品为中心的跨渠道全局优化算法

**版本**: 1.0  
**作者**: Manus AI  
**更新日期**: 2026年1月8日

---

## 一、核心理念转变

### 1.1 从渠道优化到产品优化

传统的广告优化方法是按渠道独立运行优化算法，每个渠道有自己的优化逻辑和决策。这种方法存在以下问题：

| 问题 | 描述 | 影响 |
|-----|------|------|
| **数据孤岛** | 各渠道搜索词数据独立分析 | 无法发现跨渠道的共性问题 |
| **重复否定** | 同一低效词根需要在多个渠道分别否定 | 操作繁琐，容易遗漏 |
| **自我竞争** | 同一产品在不同渠道竞争同一搜索词 | 推高CPC，浪费预算 |
| **预算碎片** | 各渠道独立分配预算 | 无法实现全局最优 |

**新的核心理念**：以**产品/ASIN**为中心，将同一产品在所有广告渠道的数据聚合分析，实现全局最优解。

### 1.2 产品广告矩阵

一个产品通常会投放到多个广告渠道，形成如下的广告矩阵：

```
产品A (ASIN: B0XXXXXX)
│
├── 【搜索广告渠道】（产生搜索词）
│   │
│   ├── SP自动广告
│   │   ├── 紧密匹配 → 搜索词
│   │   ├── 宽泛匹配 → 搜索词
│   │   ├── 同类商品 → 搜索词 + 搜索ASIN
│   │   └── 关联商品 → 搜索词 + 搜索ASIN
│   │
│   ├── SP手动-关键词广告
│   │   ├── 精确匹配 → 搜索词
│   │   ├── 词组匹配 → 搜索词
│   │   └── 广泛匹配 → 搜索词
│   │
│   ├── SP手动-商品定向广告 ★
│   │   └── ASIN/类目定向 → 搜索词 + 搜索ASIN
│   │   （around the target原则：广告出现在目标ASIN的
│   │    商品详情页和相关搜索结果页）
│   │
│   ├── SB视频-关键词定向
│   │   ├── 精确匹配 → 搜索词
│   │   ├── 词组匹配 → 搜索词
│   │   └── 广泛匹配 → 搜索词
│   │
│   ├── SB视频-商品定向 ★
│   │   └── ASIN/类目定向 → 搜索词 + 搜索ASIN
│   │
│   ├── SB商品集合-关键词定向 → 搜索词
│   │
│   └── SB商品集合-商品定向 ★
│       └── ASIN/类目定向 → 搜索词 + 搜索ASIN
│
├── 【纯商品定向渠道】（仅产生搜索ASIN，无搜索词）
│   └── SD商品定向 → 搜索ASIN（展示广告，无搜索词）
│
└── 【受众定向渠道】（产生展示数据）
    ├── SD浏览再营销
    ├── SD购买再营销
    └── SD相似受众

★ 重要发现：商品定向广告遵循"around the target"原则，
   广告不仅出现在目标ASIN的商品详情页，还会出现在
   与目标ASIN相关的搜索结果页上，因此也会产生搜索词报告！
```

---

## 二、全局优化架构

### 2.1 数据聚合层

```typescript
interface ProductAdMatrix {
  // 产品基本信息
  asin: string;
  productName: string;
  category: string;
  productAttributes: string[]; // 产品属性关键词
  
  // 搜索广告渠道数据
  searchAdChannels: {
    spAuto: SpAutoAdData;
    spManualKeyword: SpManualKeywordData;
    sbVideoKeyword: SbVideoKeywordData;
    sbProductCollection: SbProductCollectionData;
  };
  
  // 商品定向渠道数据
  productTargetingChannels: {
    spManualProduct: SpManualProductData;
    sbVideoProduct: SbVideoProductData;
    sdProductTargeting: SdProductTargetingData;
  };
  
  // 受众定向渠道数据
  audienceChannels: {
    sdViewsRemarketing: SdAudienceData;
    sdPurchasesRemarketing: SdAudienceData;
    sdSimilarAudiences: SdAudienceData;
  };
  
  // 聚合后的全局数据
  aggregatedData: {
    allSearchTerms: AggregatedSearchTerm[];
    allTargetedAsins: AggregatedTargetedAsin[];
    totalSpend: number;
    totalSales: number;
    overallAcos: number;
    overallRoas: number;
  };
}

interface AggregatedSearchTerm {
  searchTerm: string;
  
  // 来源渠道
  sources: {
    channel: string;
    campaignId: string;
    adGroupId: string;
    matchType: string;
  }[];
  
  // 聚合指标
  totalImpressions: number;
  totalClicks: number;
  totalSpend: number;
  totalSales: number;
  totalOrders: number;
  
  // 计算指标
  aggregatedCtr: number;
  aggregatedCvr: number;
  aggregatedAcos: number;
  aggregatedRoas: number;
}
```

### 2.2 全局优化引擎

```typescript
interface GlobalOptimizationEngine {
  // 1. 搜索词全局分析
  analyzeSearchTermsGlobally(matrix: ProductAdMatrix): GlobalSearchTermAnalysis;
  
  // 2. N-Gram全局降噪
  performGlobalNGramAnalysis(matrix: ProductAdMatrix): GlobalNGramResult;
  
  // 3. 跨渠道否定词同步
  generateGlobalNegatives(analysis: GlobalNGramResult): GlobalNegativeRecommendation;
  
  // 4. 预算全局分配
  allocateBudgetGlobally(matrix: ProductAdMatrix): GlobalBudgetAllocation;
  
  // 5. 竞价全局协调
  coordinateBidsGlobally(matrix: ProductAdMatrix): GlobalBidCoordination;
  
  // 6. 生成全局优化建议
  generateGlobalRecommendations(matrix: ProductAdMatrix): GlobalOptimizationPlan;
}
```

---

## 三、搜索词全局分析算法

### 3.1 跨渠道搜索词聚合

将同一产品在所有搜索广告渠道产生的搜索词聚合到一起：

```typescript
function aggregateSearchTerms(matrix: ProductAdMatrix): AggregatedSearchTerm[] {
  const searchTermMap = new Map<string, AggregatedSearchTerm>();
  
  // ===========================================
  // SP广告搜索词收集
  // ===========================================
  
  // 1. SP自动广告搜索词（紧密匹配、宽泛匹配、同类商品、关联商品）
  for (const term of matrix.searchAdChannels.spAuto.searchTerms) {
    addOrMergeSearchTerm(searchTermMap, term, 'SP_AUTO');
  }
  
  // 2. SP手动-关键词广告搜索词
  for (const term of matrix.searchAdChannels.spManualKeyword.searchTerms) {
    addOrMergeSearchTerm(searchTermMap, term, 'SP_MANUAL_KEYWORD');
  }
  
  // 3. SP手动-商品定向广告搜索词 ★
  //    重要：商品定向广告遵循"around the target"原则
  //    广告不仅出现在目标ASIN的商品详情页，还会出现在相关搜索结果页
  //    因此也会产生搜索词报告！
  for (const term of matrix.productTargetingChannels.spManualProduct.searchTerms) {
    addOrMergeSearchTerm(searchTermMap, term, 'SP_MANUAL_PRODUCT');
  }
  
  // ===========================================
  // SB广告搜索词收集
  // ===========================================
  
  // 4. SB视频-关键词定向搜索词
  for (const term of matrix.searchAdChannels.sbVideoKeyword.searchTerms) {
    addOrMergeSearchTerm(searchTermMap, term, 'SB_VIDEO_KEYWORD');
  }
  
  // 5. SB视频-商品定向搜索词 ★
  //    同样遵循"around the target"原则
  for (const term of matrix.productTargetingChannels.sbVideoProduct.searchTerms) {
    addOrMergeSearchTerm(searchTermMap, term, 'SB_VIDEO_PRODUCT');
  }
  
  // 6. SB商品集合-关键词定向搜索词
  for (const term of matrix.searchAdChannels.sbProductCollection.searchTerms) {
    addOrMergeSearchTerm(searchTermMap, term, 'SB_PRODUCT_COLLECTION_KEYWORD');
  }
  
  // 7. SB商品集合-商品定向搜索词 ★
  //    同样遵循"around the target"原则
  for (const term of matrix.searchAdChannels.sbProductCollectionProduct?.searchTerms || []) {
    addOrMergeSearchTerm(searchTermMap, term, 'SB_PRODUCT_COLLECTION_PRODUCT');
  }
  
  return Array.from(searchTermMap.values());
}

function addOrMergeSearchTerm(
  map: Map<string, AggregatedSearchTerm>,
  term: SearchTermData,
  channel: string
): void {
  const normalized = term.searchTerm.toLowerCase().trim();
  
  if (map.has(normalized)) {
    // 合并数据
    const existing = map.get(normalized)!;
    existing.sources.push({
      channel,
      campaignId: term.campaignId,
      adGroupId: term.adGroupId,
      matchType: term.matchType
    });
    existing.totalImpressions += term.impressions;
    existing.totalClicks += term.clicks;
    existing.totalSpend += term.spend;
    existing.totalSales += term.sales;
    existing.totalOrders += term.orders;
    
    // 重新计算聚合指标
    existing.aggregatedCtr = existing.totalClicks / existing.totalImpressions;
    existing.aggregatedCvr = existing.totalOrders / existing.totalClicks;
    existing.aggregatedAcos = existing.totalSpend / existing.totalSales;
    existing.aggregatedRoas = existing.totalSales / existing.totalSpend;
  } else {
    // 新增
    map.set(normalized, {
      searchTerm: normalized,
      sources: [{
        channel,
        campaignId: term.campaignId,
        adGroupId: term.adGroupId,
        matchType: term.matchType
      }],
      totalImpressions: term.impressions,
      totalClicks: term.clicks,
      totalSpend: term.spend,
      totalSales: term.sales,
      totalOrders: term.orders,
      aggregatedCtr: term.clicks / term.impressions,
      aggregatedCvr: term.orders / term.clicks,
      aggregatedAcos: term.spend / term.sales,
      aggregatedRoas: term.sales / term.spend
    });
  }
}
```

### 3.2 搜索词全局分类

基于聚合后的数据，对搜索词进行全局分类：

```typescript
interface GlobalSearchTermClassification {
  // 高价值词（跨渠道表现优秀）
  highValueTerms: AggregatedSearchTerm[];
  
  // 潜力词（部分渠道表现好）
  potentialTerms: AggregatedSearchTerm[];
  
  // 低效词（跨渠道表现差）
  inefficientTerms: AggregatedSearchTerm[];
  
  // 与产品属性不匹配的词
  mismatchedTerms: AggregatedSearchTerm[];
  
  // 完全无关的词
  irrelevantTerms: AggregatedSearchTerm[];
}

function classifySearchTermsGlobally(
  aggregatedTerms: AggregatedSearchTerm[],
  productAttributes: string[],
  targetAcos: number
): GlobalSearchTermClassification {
  const result: GlobalSearchTermClassification = {
    highValueTerms: [],
    potentialTerms: [],
    inefficientTerms: [],
    mismatchedTerms: [],
    irrelevantTerms: []
  };
  
  for (const term of aggregatedTerms) {
    // 计算与产品属性的匹配度
    const matchScore = calculateAttributeMatchScore(term.searchTerm, productAttributes);
    
    if (matchScore < 0.1) {
      // 完全无关
      result.irrelevantTerms.push(term);
    } else if (matchScore < 0.3) {
      // 与产品属性不匹配
      result.mismatchedTerms.push(term);
    } else if (term.aggregatedAcos <= targetAcos * 0.8 && term.totalOrders >= 2) {
      // 高价值词
      result.highValueTerms.push(term);
    } else if (term.aggregatedAcos <= targetAcos && term.totalOrders >= 1) {
      // 潜力词
      result.potentialTerms.push(term);
    } else {
      // 低效词
      result.inefficientTerms.push(term);
    }
  }
  
  return result;
}

function calculateAttributeMatchScore(
  searchTerm: string,
  productAttributes: string[]
): number {
  const termWords = searchTerm.toLowerCase().split(/\s+/);
  let matchedWords = 0;
  
  for (const word of termWords) {
    for (const attr of productAttributes) {
      if (attr.toLowerCase().includes(word) || word.includes(attr.toLowerCase())) {
        matchedWords++;
        break;
      }
    }
  }
  
  return matchedWords / termWords.length;
}
```

---

## 四、N-Gram全局降噪算法

### 4.1 跨渠道N-Gram分析

将所有渠道的搜索词合并后进行N-Gram分析，识别需要全局否定的词根：

```typescript
interface GlobalNGramAnalysis {
  // 单词词根分析
  unigrams: NGramResult[];
  
  // 双词组合分析
  bigrams: NGramResult[];
  
  // 三词组合分析
  trigrams: NGramResult[];
  
  // 需要全局否定的词根
  globalNegativeRoots: NegativeRootRecommendation[];
}

interface NGramResult {
  ngram: string;
  frequency: number;
  
  // 跨渠道聚合指标
  totalImpressions: number;
  totalClicks: number;
  totalSpend: number;
  totalSales: number;
  totalOrders: number;
  
  // 出现在哪些渠道
  channels: string[];
  
  // 计算指标
  aggregatedAcos: number;
  aggregatedRoas: number;
  
  // 与产品属性匹配度
  attributeMatchScore: number;
}

interface NegativeRootRecommendation {
  root: string;
  reason: 'IRRELEVANT' | 'MISMATCHED' | 'HIGH_ACOS' | 'NO_CONVERSION';
  
  // 影响范围
  affectedSearchTerms: string[];
  affectedChannels: string[];
  
  // 预期效果
  expectedSavings: number;
  expectedImpressionsLost: number;
  
  // 置信度
  confidence: number;
}

function performGlobalNGramAnalysis(
  aggregatedTerms: AggregatedSearchTerm[],
  productAttributes: string[],
  targetAcos: number
): GlobalNGramAnalysis {
  // 1. 提取所有N-Gram
  const unigramMap = new Map<string, NGramResult>();
  const bigramMap = new Map<string, NGramResult>();
  const trigramMap = new Map<string, NGramResult>();
  
  for (const term of aggregatedTerms) {
    const words = term.searchTerm.split(/\s+/);
    
    // 提取Unigram
    for (const word of words) {
      addNGramData(unigramMap, word, term);
    }
    
    // 提取Bigram
    for (let i = 0; i < words.length - 1; i++) {
      const bigram = `${words[i]} ${words[i + 1]}`;
      addNGramData(bigramMap, bigram, term);
    }
    
    // 提取Trigram
    for (let i = 0; i < words.length - 2; i++) {
      const trigram = `${words[i]} ${words[i + 1]} ${words[i + 2]}`;
      addNGramData(trigramMap, trigram, term);
    }
  }
  
  // 2. 计算属性匹配度
  for (const ngram of unigramMap.values()) {
    ngram.attributeMatchScore = calculateAttributeMatchScore(ngram.ngram, productAttributes);
  }
  for (const ngram of bigramMap.values()) {
    ngram.attributeMatchScore = calculateAttributeMatchScore(ngram.ngram, productAttributes);
  }
  for (const ngram of trigramMap.values()) {
    ngram.attributeMatchScore = calculateAttributeMatchScore(ngram.ngram, productAttributes);
  }
  
  // 3. 识别需要全局否定的词根
  const globalNegativeRoots = identifyGlobalNegativeRoots(
    Array.from(unigramMap.values()),
    Array.from(bigramMap.values()),
    Array.from(trigramMap.values()),
    productAttributes,
    targetAcos
  );
  
  return {
    unigrams: Array.from(unigramMap.values()),
    bigrams: Array.from(bigramMap.values()),
    trigrams: Array.from(trigramMap.values()),
    globalNegativeRoots
  };
}

function identifyGlobalNegativeRoots(
  unigrams: NGramResult[],
  bigrams: NGramResult[],
  trigrams: NGramResult[],
  productAttributes: string[],
  targetAcos: number
): NegativeRootRecommendation[] {
  const recommendations: NegativeRootRecommendation[] = [];
  
  // 分析所有N-Gram
  const allNgrams = [...unigrams, ...bigrams, ...trigrams];
  
  for (const ngram of allNgrams) {
    // 跳过数据量太少的
    if (ngram.frequency < 3 || ngram.totalClicks < 5) continue;
    
    let reason: NegativeRootRecommendation['reason'] | null = null;
    let confidence = 0;
    
    // 判断是否需要否定
    if (ngram.attributeMatchScore < 0.1) {
      // 完全无关的词根
      reason = 'IRRELEVANT';
      confidence = 0.9;
    } else if (ngram.attributeMatchScore < 0.3 && ngram.aggregatedAcos > targetAcos * 1.5) {
      // 与产品属性不匹配且ACoS高
      reason = 'MISMATCHED';
      confidence = 0.8;
    } else if (ngram.totalOrders === 0 && ngram.totalSpend > 50) {
      // 无转化且花费高
      reason = 'NO_CONVERSION';
      confidence = 0.85;
    } else if (ngram.aggregatedAcos > targetAcos * 2 && ngram.frequency >= 5) {
      // ACoS极高且出现频繁
      reason = 'HIGH_ACOS';
      confidence = 0.75;
    }
    
    if (reason) {
      recommendations.push({
        root: ngram.ngram,
        reason,
        affectedSearchTerms: [], // 需要回溯查找
        affectedChannels: ngram.channels,
        expectedSavings: ngram.totalSpend * 0.8, // 预估节省80%花费
        expectedImpressionsLost: ngram.totalImpressions,
        confidence
      });
    }
  }
  
  // 按置信度和预期节省排序
  return recommendations.sort((a, b) => {
    const scoreA = a.confidence * a.expectedSavings;
    const scoreB = b.confidence * b.expectedSavings;
    return scoreB - scoreA;
  });
}
```

### 4.2 全局否定词同步

识别出需要否定的词根后，在所有相关渠道同时执行否定：

```typescript
interface GlobalNegativeAction {
  root: string;
  
  // 需要执行否定的渠道和位置
  actions: {
    channel: string;
    campaignId: string;
    adGroupId?: string; // 广告组层级否定
    negativeType: 'NEGATIVE_EXACT' | 'NEGATIVE_PHRASE';
  }[];
  
  // 执行状态
  status: 'PENDING' | 'EXECUTED' | 'FAILED';
}

function generateGlobalNegativeActions(
  recommendations: NegativeRootRecommendation[],
  matrix: ProductAdMatrix
): GlobalNegativeAction[] {
  const actions: GlobalNegativeAction[] = [];
  
  for (const rec of recommendations) {
    const action: GlobalNegativeAction = {
      root: rec.root,
      actions: [],
      status: 'PENDING'
    };
    
    // 在所有受影响的渠道添加否定
    for (const channel of rec.affectedChannels) {
      switch (channel) {
        case 'SP_AUTO':
          // SP自动广告：在广告活动层级添加否定关键词
          action.actions.push({
            channel,
            campaignId: matrix.searchAdChannels.spAuto.campaignId,
            negativeType: rec.root.includes(' ') ? 'NEGATIVE_PHRASE' : 'NEGATIVE_EXACT'
          });
          break;
          
        case 'SP_MANUAL_KEYWORD':
          // SP手动关键词广告：在广告组层级添加否定关键词
          action.actions.push({
            channel,
            campaignId: matrix.searchAdChannels.spManualKeyword.campaignId,
            adGroupId: matrix.searchAdChannels.spManualKeyword.adGroupId,
            negativeType: rec.root.includes(' ') ? 'NEGATIVE_PHRASE' : 'NEGATIVE_EXACT'
          });
          break;
          
        case 'SB_VIDEO_KEYWORD':
          // SB视频广告：在广告活动层级添加否定关键词
          action.actions.push({
            channel,
            campaignId: matrix.searchAdChannels.sbVideoKeyword.campaignId,
            negativeType: rec.root.includes(' ') ? 'NEGATIVE_PHRASE' : 'NEGATIVE_EXACT'
          });
          break;
          
        case 'SB_PRODUCT_COLLECTION':
          // SB商品集合广告：在广告活动层级添加否定关键词
          action.actions.push({
            channel,
            campaignId: matrix.searchAdChannels.sbProductCollection.campaignId,
            negativeType: rec.root.includes(' ') ? 'NEGATIVE_PHRASE' : 'NEGATIVE_EXACT'
          });
          break;
      }
    }
    
    actions.push(action);
  }
  
  return actions;
}
```

---

## 五、跨渠道预算分配算法

### 5.1 边际ROAS均衡原则

在最优状态下，同一产品在所有渠道的边际ROAS应该相等。

```typescript
interface ChannelMarginalAnalysis {
  channel: string;
  currentBudget: number;
  currentRoas: number;
  marginalRoas: number; // 边际ROAS
  elasticity: number; // 预算弹性
}

interface GlobalBudgetAllocation {
  totalBudget: number;
  
  // 各渠道分配
  channelAllocations: {
    channel: string;
    allocatedBudget: number;
    expectedRoas: number;
    expectedSales: number;
  }[];
  
  // 全局预期指标
  expectedTotalSales: number;
  expectedOverallRoas: number;
  expectedOverallAcos: number;
}

function allocateBudgetGlobally(
  matrix: ProductAdMatrix,
  totalBudget: number
): GlobalBudgetAllocation {
  // 1. 计算各渠道的边际ROAS
  const channelAnalyses = calculateChannelMarginalRoas(matrix);
  
  // 2. 使用拉格朗日乘数法求解最优分配
  const optimalAllocation = solveBudgetAllocation(channelAnalyses, totalBudget);
  
  return optimalAllocation;
}

function calculateChannelMarginalRoas(
  matrix: ProductAdMatrix
): ChannelMarginalAnalysis[] {
  const analyses: ChannelMarginalAnalysis[] = [];
  
  // 分析SP自动广告
  if (matrix.searchAdChannels.spAuto) {
    const data = matrix.searchAdChannels.spAuto;
    analyses.push({
      channel: 'SP_AUTO',
      currentBudget: data.dailyBudget,
      currentRoas: data.sales / data.spend,
      marginalRoas: calculateMarginalRoas(data),
      elasticity: calculateBudgetElasticity(data)
    });
  }
  
  // 分析SP手动关键词广告
  if (matrix.searchAdChannels.spManualKeyword) {
    const data = matrix.searchAdChannels.spManualKeyword;
    analyses.push({
      channel: 'SP_MANUAL_KEYWORD',
      currentBudget: data.dailyBudget,
      currentRoas: data.sales / data.spend,
      marginalRoas: calculateMarginalRoas(data),
      elasticity: calculateBudgetElasticity(data)
    });
  }
  
  // 分析SB视频广告
  if (matrix.searchAdChannels.sbVideoKeyword) {
    const data = matrix.searchAdChannels.sbVideoKeyword;
    analyses.push({
      channel: 'SB_VIDEO_KEYWORD',
      currentBudget: data.dailyBudget,
      currentRoas: data.sales / data.spend,
      marginalRoas: calculateMarginalRoas(data),
      elasticity: calculateBudgetElasticity(data)
    });
  }
  
  // ... 其他渠道
  
  return analyses;
}

function solveBudgetAllocation(
  analyses: ChannelMarginalAnalysis[],
  totalBudget: number
): GlobalBudgetAllocation {
  // 按边际ROAS排序
  const sorted = [...analyses].sort((a, b) => b.marginalRoas - a.marginalRoas);
  
  const allocations: GlobalBudgetAllocation['channelAllocations'] = [];
  let remainingBudget = totalBudget;
  let totalExpectedSales = 0;
  
  // 贪心分配：优先分配给边际ROAS最高的渠道
  for (const channel of sorted) {
    if (remainingBudget <= 0) break;
    
    // 计算该渠道的最优预算（基于边际分析）
    const optimalBudget = calculateOptimalChannelBudget(channel, remainingBudget);
    const expectedSales = estimateSales(channel, optimalBudget);
    
    allocations.push({
      channel: channel.channel,
      allocatedBudget: optimalBudget,
      expectedRoas: expectedSales / optimalBudget,
      expectedSales
    });
    
    remainingBudget -= optimalBudget;
    totalExpectedSales += expectedSales;
  }
  
  const totalAllocated = totalBudget - remainingBudget;
  
  return {
    totalBudget,
    channelAllocations: allocations,
    expectedTotalSales: totalExpectedSales,
    expectedOverallRoas: totalExpectedSales / totalAllocated,
    expectedOverallAcos: totalAllocated / totalExpectedSales
  };
}
```

### 5.2 避免自我竞争

检测同一产品在不同渠道是否在竞争同一搜索词：

```typescript
interface SelfCompetitionDetection {
  searchTerm: string;
  competingChannels: {
    channel: string;
    bid: number;
    impressionShare: number;
  }[];
  
  // 建议
  recommendation: 'CONSOLIDATE' | 'DIFFERENTIATE' | 'MAINTAIN';
  suggestedAction: string;
}

function detectSelfCompetition(
  aggregatedTerms: AggregatedSearchTerm[]
): SelfCompetitionDetection[] {
  const competitions: SelfCompetitionDetection[] = [];
  
  for (const term of aggregatedTerms) {
    // 只分析出现在多个渠道的搜索词
    if (term.sources.length <= 1) continue;
    
    const channelBids = term.sources.map(s => ({
      channel: s.channel,
      bid: getBidForChannel(s), // 获取该渠道的竞价
      impressionShare: getImpressionShareForChannel(s) // 获取展示份额
    }));
    
    // 如果多个渠道都在竞争同一词，可能存在自我竞争
    const totalImpressionShare = channelBids.reduce((sum, c) => sum + c.impressionShare, 0);
    
    let recommendation: SelfCompetitionDetection['recommendation'];
    let suggestedAction: string;
    
    if (totalImpressionShare > 0.8) {
      // 展示份额已经很高，可以整合到一个渠道
      recommendation = 'CONSOLIDATE';
      suggestedAction = `建议将"${term.searchTerm}"整合到表现最好的渠道，其他渠道添加否定`;
    } else if (channelBids.some(c => c.bid > channelBids[0].bid * 1.5)) {
      // 竞价差异大，可能在自我竞争
      recommendation = 'DIFFERENTIATE';
      suggestedAction = `建议调整各渠道竞价，避免自我竞争`;
    } else {
      recommendation = 'MAINTAIN';
      suggestedAction = '当前状态合理，无需调整';
    }
    
    competitions.push({
      searchTerm: term.searchTerm,
      competingChannels: channelBids,
      recommendation,
      suggestedAction
    });
  }
  
  return competitions;
}
```

---

## 六、全局优化决策引擎

### 6.1 综合优化建议生成

```typescript
interface GlobalOptimizationPlan {
  // 产品信息
  asin: string;
  productName: string;
  
  // 优化建议汇总
  summary: {
    totalExpectedSavings: number;
    totalExpectedSalesIncrease: number;
    expectedAcosImprovement: number;
    expectedRoasImprovement: number;
  };
  
  // 具体优化动作
  actions: {
    // 全局否定词
    globalNegatives: GlobalNegativeAction[];
    
    // 预算重新分配
    budgetReallocation: GlobalBudgetAllocation;
    
    // 竞价调整
    bidAdjustments: {
      channel: string;
      targetId: string;
      currentBid: number;
      suggestedBid: number;
      reason: string;
    }[];
    
    // 关键词迁移
    keywordMigrations: {
      searchTerm: string;
      fromChannel: string;
      toChannel: string;
      suggestedMatchType: string;
      suggestedBid: number;
    }[];
    
    // 暂停建议
    pauseRecommendations: {
      channel: string;
      targetId: string;
      reason: string;
    }[];
  };
  
  // 执行优先级
  prioritizedActions: {
    priority: 'HIGH' | 'MEDIUM' | 'LOW';
    action: string;
    expectedImpact: number;
  }[];
}

function generateGlobalOptimizationPlan(
  matrix: ProductAdMatrix,
  targetAcos: number
): GlobalOptimizationPlan {
  // 1. 聚合搜索词
  const aggregatedTerms = aggregateSearchTerms(matrix);
  
  // 2. 全局N-Gram分析
  const ngramAnalysis = performGlobalNGramAnalysis(
    aggregatedTerms,
    matrix.productAttributes,
    targetAcos
  );
  
  // 3. 生成全局否定动作
  const globalNegatives = generateGlobalNegativeActions(
    ngramAnalysis.globalNegativeRoots,
    matrix
  );
  
  // 4. 全局预算分配
  const budgetReallocation = allocateBudgetGlobally(
    matrix,
    calculateTotalBudget(matrix)
  );
  
  // 5. 检测自我竞争
  const selfCompetitions = detectSelfCompetition(aggregatedTerms);
  
  // 6. 生成竞价调整建议
  const bidAdjustments = generateBidAdjustments(matrix, targetAcos);
  
  // 7. 生成关键词迁移建议
  const keywordMigrations = generateMigrationRecommendations(
    aggregatedTerms,
    targetAcos
  );
  
  // 8. 生成暂停建议
  const pauseRecommendations = generatePauseRecommendations(matrix, targetAcos);
  
  // 9. 计算预期效果
  const summary = calculateExpectedImpact(
    globalNegatives,
    budgetReallocation,
    bidAdjustments
  );
  
  // 10. 排序优先级
  const prioritizedActions = prioritizeActions(
    globalNegatives,
    budgetReallocation,
    bidAdjustments,
    keywordMigrations,
    pauseRecommendations
  );
  
  return {
    asin: matrix.asin,
    productName: matrix.productName,
    summary,
    actions: {
      globalNegatives,
      budgetReallocation,
      bidAdjustments,
      keywordMigrations,
      pauseRecommendations
    },
    prioritizedActions
  };
}
```

---

## 七、算法优势总结

### 7.1 与传统方法对比

| 维度 | 传统渠道独立优化 | 产品中心全局优化 | 优势说明 |
|-----|----------------|----------------|---------|
| **数据分析** | 各渠道独立分析 | 跨渠道聚合分析 | 发现更多优化机会 |
| **否定词管理** | 各渠道分别否定 | 一次识别，全局同步 | 效率提升，避免遗漏 |
| **预算分配** | 各渠道固定预算 | 边际ROAS均衡分配 | 全局ROI最大化 |
| **竞价协调** | 各渠道独立竞价 | 检测并避免自我竞争 | 降低CPC，节省预算 |
| **关键词迁移** | 仅SP自动→手动 | 跨渠道智能迁移 | 更灵活的流量管理 |

### 7.2 核心功能清单

本全局优化算法支持以下核心功能：

| 功能 | 描述 | 适用范围 |
|-----|------|---------|
| **搜索词全局分析** | 聚合所有搜索渠道的搜索词数据 | SP自动/手动关键词, SB全部 |
| **N-Gram全局降噪** | 识别跨渠道的低效词根 | 所有搜索渠道 |
| **全局否定同步** | 一次识别，所有渠道同步否定 | 所有支持否定的渠道 |
| **预算全局分配** | 基于边际ROAS的最优分配 | 所有渠道 |
| **自我竞争检测** | 识别同一产品的渠道内竞争 | 所有搜索渠道 |
| **竞价全局协调** | 避免自我竞争，优化整体CPC | 所有渠道 |
| **关键词智能迁移** | 跨渠道的关键词迁移建议 | SP自动→手动, 跨渠道 |
| **暂停建议** | 识别需要暂停的低效广告 | 所有渠道 |

### 7.3 预期效果

基于全局优化算法，预期可以实现：

| 指标 | 预期改善 | 说明 |
|-----|---------|------|
| **ACoS** | 降低10-20% | 通过全局否定和预算优化 |
| **ROAS** | 提升15-25% | 通过边际ROAS均衡分配 |
| **CPC** | 降低5-15% | 通过避免自我竞争 |
| **操作效率** | 提升50%+ | 一次分析，全局执行 |

---

## References

1. Amazon Advertising API Documentation
2. Adspert PPC AI Algorithm
3. AdLabs Amazon PPC Bid Optimization Formulas
