# 双层N-Gram分析算法设计

## 一、算法概述

### 核心问题

在Amazon广告生态中，不同广告类型的搜索词归属关系存在本质差异：

1. **单品广告**：搜索词可以明确归属到单一商品（ASIN）
2. **多品广告**：搜索词可能与广告中的任一商品相关，甚至与品牌整体相关

传统的单层N-Gram分析无法正确处理这种差异，可能导致：
- 将多品广告的搜索词错误归属到单一商品
- 误否定与其他商品相关的有效搜索词
- 遗漏品牌级别的低效词根

### 解决方案：双层N-Gram分析

```
┌─────────────────────────────────────────────────────────────────┐
│                        双层N-Gram分析架构                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    品牌级N-Gram分析                       │   │
│  │  ┌─────────────────────────────────────────────────┐    │   │
│  │  │ 数据来源：                                        │    │   │
│  │  │ • SB商品集合广告（3+个ASIN）                      │    │   │
│  │  │ • SB旗舰店聚焦广告（品牌旗舰店）                  │    │   │
│  │  │ • SB视频-多ASIN广告（1-3个ASIN）                  │    │   │
│  │  └─────────────────────────────────────────────────┘    │   │
│  │                          ↓                               │   │
│  │  识别品牌级低效词根 → 在所有SB广告中执行否定             │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    商品级N-Gram分析                       │   │
│  │  ┌─────────────────────────────────────────────────┐    │   │
│  │  │ 商品1数据来源：                                   │    │   │
│  │  │ • SP自动广告                                      │    │   │
│  │  │ • SP手动-关键词广告                               │    │   │
│  │  │ • SP手动-商品定向广告                             │    │   │
│  │  │ • SB视频-单品广告                                 │    │   │
│  │  └─────────────────────────────────────────────────┘    │   │
│  │                          ↓                               │   │
│  │  识别商品级低效词根 → 在该商品的所有广告中执行否定       │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 二、广告类型分类

### 单品广告（搜索词明确归属单一ASIN）

| 广告类型 | ASIN数量 | 搜索词归属 | 分析层级 |
|---------|:-------:|----------|:-------:|
| SP自动广告 | 1 | 明确归属广告组ASIN | 商品级 |
| SP手动-关键词广告 | 1 | 明确归属广告组ASIN | 商品级 |
| SP手动-商品定向广告 | 1 | 明确归属广告组ASIN | 商品级 |
| SB视频-单品广告 | 1 | 明确归属广告ASIN | 商品级 |

### 多品广告（搜索词无法明确归属单一ASIN）

| 广告类型 | ASIN数量 | 搜索词归属 | 分析层级 |
|---------|:-------:|----------|:-------:|
| SB商品集合广告 | 3+ | 可能与任一ASIN相关 | 品牌级 |
| SB旗舰店聚焦广告 | 多个 | 可能与品牌整体相关 | 品牌级 |
| SB视频-多ASIN广告 | 1-3 | 可能与任一ASIN相关 | 品牌级 |

---

## 三、双层分析流程

### 第一层：商品级N-Gram分析

```typescript
interface ProductLevelAnalysis {
  productId: string;           // ASIN
  productName: string;         // 商品名称
  searchTermSources: {
    channel: string;           // 广告渠道
    searchTerms: SearchTerm[]; // 搜索词列表
  }[];
  ngramResults: {
    unigrams: NgramResult[];   // 单词分析
    bigrams: NgramResult[];    // 双词组合
    trigrams: NgramResult[];   // 三词组合
  };
  negativeRecommendations: NegativeKeyword[];
}

async function analyzeProductLevel(
  productId: string,
  dateRange: DateRange
): Promise<ProductLevelAnalysis> {
  // 1. 收集该商品的所有单品广告搜索词
  const searchTerms = await collectProductSearchTerms(productId, [
    'SP_AUTO',
    'SP_MANUAL_KEYWORD',
    'SP_MANUAL_PRODUCT',
    'SB_VIDEO_SINGLE'
  ], dateRange);
  
  // 2. 执行N-Gram分析
  const ngramResults = performNgramAnalysis(searchTerms);
  
  // 3. 识别低效词根
  const inefficientNgrams = identifyInefficient(ngramResults, {
    minClicks: 10,
    maxAcos: 0.5,
    minConversions: 0
  });
  
  // 4. 生成否定建议
  const negativeRecommendations = generateNegatives(
    inefficientNgrams,
    productId
  );
  
  return {
    productId,
    productName: await getProductName(productId),
    searchTermSources: searchTerms,
    ngramResults,
    negativeRecommendations
  };
}
```

### 第二层：品牌级N-Gram分析

```typescript
interface BrandLevelAnalysis {
  brandId: string;             // 品牌ID
  brandName: string;           // 品牌名称
  searchTermSources: {
    channel: string;           // 广告渠道
    campaignId: string;        // 广告活动ID
    productsInAd: string[];    // 广告中的ASIN列表
    searchTerms: SearchTerm[]; // 搜索词列表
  }[];
  ngramResults: {
    unigrams: NgramResult[];
    bigrams: NgramResult[];
    trigrams: NgramResult[];
  };
  negativeRecommendations: NegativeKeyword[];
}

async function analyzeBrandLevel(
  brandId: string,
  dateRange: DateRange
): Promise<BrandLevelAnalysis> {
  // 1. 收集该品牌的所有多品广告搜索词
  const searchTerms = await collectBrandSearchTerms(brandId, [
    'SB_COLLECTION',
    'SB_STORE_SPOTLIGHT',
    'SB_VIDEO_MULTI_ASIN'
  ], dateRange);
  
  // 2. 执行N-Gram分析
  const ngramResults = performNgramAnalysis(searchTerms);
  
  // 3. 识别低效词根
  const inefficientNgrams = identifyInefficient(ngramResults, {
    minClicks: 20,  // 品牌级阈值更高
    maxAcos: 0.4,
    minConversions: 0
  });
  
  // 4. 生成否定建议
  const negativeRecommendations = generateBrandNegatives(
    inefficientNgrams,
    brandId
  );
  
  return {
    brandId,
    brandName: await getBrandName(brandId),
    searchTermSources: searchTerms,
    ngramResults,
    negativeRecommendations
  };
}
```

---

## 四、否定执行策略

### 商品级否定执行

当商品级N-Gram分析识别出低效词根时，在该商品的所有广告中执行否定：

```typescript
async function executeProductNegatives(
  productId: string,
  negativeKeywords: NegativeKeyword[]
): Promise<ExecutionResult> {
  const results: ExecutionResult[] = [];
  
  // 获取该商品的所有广告活动
  const campaigns = await getProductCampaigns(productId);
  
  for (const campaign of campaigns) {
    // 根据广告类型确定否定能力
    const negativeCapability = getNegativeCapability(campaign.type);
    
    if (negativeCapability.canNegateKeywords) {
      // 执行否定关键词
      const keywordResult = await addNegativeKeywords(
        campaign.id,
        negativeKeywords.filter(n => n.type === 'keyword'),
        negativeCapability.keywordLevel // 广告活动或广告组层级
      );
      results.push(keywordResult);
    }
    
    // 注意：SP手动-商品定向不支持否定关键词，跳过
  }
  
  return aggregateResults(results);
}
```

### 品牌级否定执行

当品牌级N-Gram分析识别出低效词根时，在该品牌的所有SB广告中执行否定：

```typescript
async function executeBrandNegatives(
  brandId: string,
  negativeKeywords: NegativeKeyword[]
): Promise<ExecutionResult> {
  const results: ExecutionResult[] = [];
  
  // 获取该品牌的所有SB广告活动
  const sbCampaigns = await getBrandSBCampaigns(brandId);
  
  for (const campaign of sbCampaigns) {
    // SB广告都支持否定关键词和否定ASIN
    const keywordResult = await addNegativeKeywords(
      campaign.id,
      negativeKeywords.filter(n => n.type === 'keyword'),
      'ad_group' // SB广告在广告组层级否定
    );
    results.push(keywordResult);
  }
  
  return aggregateResults(results);
}
```

---

## 五、跨层级协调

### 词根去重

同一个词根可能在商品级和品牌级都被识别为低效，需要去重：

```typescript
function deduplicateNgrams(
  productAnalyses: ProductLevelAnalysis[],
  brandAnalysis: BrandLevelAnalysis
): DeduplicatedResult {
  const allProductNgrams = new Set<string>();
  
  // 收集所有商品级识别的词根
  for (const product of productAnalyses) {
    for (const ngram of product.negativeRecommendations) {
      allProductNgrams.add(ngram.keyword.toLowerCase());
    }
  }
  
  // 品牌级词根去除已在商品级处理的
  const uniqueBrandNgrams = brandAnalysis.negativeRecommendations
    .filter(n => !allProductNgrams.has(n.keyword.toLowerCase()));
  
  return {
    productNegatives: productAnalyses.map(p => ({
      productId: p.productId,
      negatives: p.negativeRecommendations
    })),
    brandNegatives: uniqueBrandNgrams
  };
}
```

### 优先级规则

1. **商品级优先**：如果某词根在商品级被识别为低效，优先在商品级处理
2. **品牌级补充**：品牌级处理商品级未覆盖的词根
3. **全局保护**：品牌级识别的词根在所有SB广告中否定，提供全局保护

---

## 六、完整分析流程

```typescript
interface DualLayerAnalysisResult {
  brandId: string;
  brandName: string;
  productAnalyses: ProductLevelAnalysis[];
  brandAnalysis: BrandLevelAnalysis;
  executionPlan: {
    productNegatives: {
      productId: string;
      negatives: NegativeKeyword[];
      targetCampaigns: string[];
    }[];
    brandNegatives: {
      negatives: NegativeKeyword[];
      targetCampaigns: string[];
    };
  };
  summary: {
    totalSearchTermsAnalyzed: number;
    productLevelNgramsIdentified: number;
    brandLevelNgramsIdentified: number;
    estimatedSavings: number;
  };
}

async function performDualLayerAnalysis(
  brandId: string,
  dateRange: DateRange
): Promise<DualLayerAnalysisResult> {
  // 1. 获取品牌下的所有商品
  const products = await getBrandProducts(brandId);
  
  // 2. 商品级分析（并行执行）
  const productAnalyses = await Promise.all(
    products.map(p => analyzeProductLevel(p.id, dateRange))
  );
  
  // 3. 品牌级分析
  const brandAnalysis = await analyzeBrandLevel(brandId, dateRange);
  
  // 4. 跨层级协调和去重
  const deduplicatedResult = deduplicateNgrams(productAnalyses, brandAnalysis);
  
  // 5. 生成执行计划
  const executionPlan = generateExecutionPlan(deduplicatedResult);
  
  // 6. 计算预期效果
  const summary = calculateSummary(productAnalyses, brandAnalysis);
  
  return {
    brandId,
    brandName: await getBrandName(brandId),
    productAnalyses,
    brandAnalysis,
    executionPlan,
    summary
  };
}
```

---

## 七、否定执行渠道矩阵

### 商品级否定执行渠道

| 执行渠道 | 否定关键词 | 否定ASIN | 否定层级 |
|---------|:---------:|:--------:|---------|
| SP自动广告 | ✅ | ✅ | 广告活动/广告组 |
| SP手动-关键词 | ✅ | ❌ | 广告活动/广告组 |
| SP手动-商品定向 | ❌ | ✅ | 广告活动/广告组 |
| SB视频-单品 | ✅ | ✅ | 广告组 |

### 品牌级否定执行渠道

| 执行渠道 | 否定关键词 | 否定ASIN | 否定层级 |
|---------|:---------:|:--------:|---------|
| SB商品集合-关键词 | ✅ | ✅ | 广告组 |
| SB商品集合-商品定向 | ✅ | ✅ | 广告组 |
| SB视频-多ASIN | ✅ | ✅ | 广告组 |
| SB旗舰店聚焦 | ✅ | ✅ | 广告组 |

---

## 八、算法优势

### 与传统单层分析对比

| 维度 | 传统单层分析 | 双层N-Gram分析 |
|-----|------------|---------------|
| 数据归属 | 所有搜索词归属到单一商品 | 区分单品/多品广告 |
| 误否定风险 | 高（多品广告搜索词可能误归属） | 低（分层处理） |
| 品牌保护 | 无 | 品牌级否定提供全局保护 |
| 分析准确性 | 中等 | 高 |
| 执行效率 | 可能重复否定 | 去重后精准执行 |

### 核心优势

1. **避免误否定**：多品广告的搜索词不会错误归属到单一商品
2. **双重保护**：商品级+品牌级双重否定保护
3. **精准执行**：根据广告类型的否定能力精准执行
4. **效率提升**：跨层级去重，避免重复操作

---

## 九、实施建议

### 阶段一：基础实现

1. 实现广告类型分类逻辑
2. 实现商品级N-Gram分析
3. 实现品牌级N-Gram分析
4. 实现基础否定执行

### 阶段二：优化增强

1. 实现跨层级协调和去重
2. 优化否定执行策略
3. 添加执行效果追踪
4. 实现自动化调度

### 阶段三：智能升级

1. 引入机器学习优化阈值
2. 实现动态词根识别
3. 添加季节性调整
4. 实现A/B测试框架

---

*文档更新时间：2026年1月*
