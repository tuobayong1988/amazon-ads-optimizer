# Amazon广告否定定向功能支持矩阵

## 研究来源

基于Amazon Advertising官方API文档、帮助中心文档以及第三方工具文档的研究。

---

## 一、广告类型与搜索词归属分析

### 核心问题

SB品牌广告（商品集合、旗舰店聚焦）是**多商品广告**，一个广告中包含多个ASIN，产生的搜索词可能与其中任何一个商品相关，甚至与品牌整体相关，而不是特定单一商品。

### 广告类型分类

#### 单品广告（搜索词可直接归属到单一商品）

| 广告类型 | ASIN数量 | 搜索词归属 | 参与单品N-Gram分析 |
|---------|:-------:|----------|:-----------------:|
| SP自动广告 | 1 | 明确归属单一ASIN | ✅ |
| SP手动-关键词广告 | 1 | 明确归属单一ASIN | ✅ |
| SP手动-商品定向广告 | 1 | 明确归属单一ASIN | ✅ |
| SB视频-单品广告 | 1 | 明确归属单一ASIN | ✅ |

#### 多品广告（搜索词无法直接归属到单一商品）

| 广告类型 | ASIN数量 | 搜索词归属 | 参与单品N-Gram分析 |
|---------|:-------:|----------|:-----------------:|
| SB商品集合广告 | 3+ | 可能与任一ASIN相关 | ⚠️ 需特殊处理 |
| SB旗舰店聚焦广告 | 多个 | 可能与品牌整体相关 | ⚠️ 需特殊处理 |
| SB视频-多ASIN广告 | 1-3 | 可能与任一ASIN相关 | ⚠️ 需特殊处理 |

### 多品广告搜索词处理策略

#### 策略1：品牌级分析（推荐）

将多品广告的搜索词单独作为**品牌级N-Gram分析**，不参与单一商品的分析。

```
品牌A
├── 商品级N-Gram分析
│   ├── 商品1：SP广告 + SB单品视频广告的搜索词
│   ├── 商品2：SP广告 + SB单品视频广告的搜索词
│   └── 商品3：SP广告 + SB单品视频广告的搜索词
│
└── 品牌级N-Gram分析
    └── SB商品集合 + SB旗舰店聚焦 + SB多ASIN视频的搜索词
```

**优点**：
- 避免将不相关的搜索词错误归属到单一商品
- 品牌级否定可以保护整个品牌的广告投放

**否定执行**：
- 品牌级识别的低效词根 → 在所有SB广告中执行否定
- 商品级识别的低效词根 → 在该商品的所有广告中执行否定

#### 策略2：相关性匹配（高级）

根据搜索词与各商品的相关性，按权重分配到相关商品。

```typescript
function assignSearchTermToProducts(
  searchTerm: string,
  productsInAd: Product[]
): { productId: string; weight: number }[] {
  const assignments = [];
  
  for (const product of productsInAd) {
    // 计算搜索词与商品的相关性
    const relevance = calculateRelevance(searchTerm, product);
    
    // 相关性阈值：只有超过阈值才归属
    if (relevance > 0.5) {
      assignments.push({
        productId: product.id,
        weight: relevance
      });
    }
  }
  
  // 如果没有明确归属，标记为品牌级
  if (assignments.length === 0) {
    return [{ productId: 'BRAND_LEVEL', weight: 1.0 }];
  }
  
  return assignments;
}

function calculateRelevance(searchTerm: string, product: Product): number {
  let score = 0;
  
  // 检查搜索词是否包含商品标题中的关键词
  const titleKeywords = extractKeywords(product.title);
  for (const keyword of titleKeywords) {
    if (searchTerm.toLowerCase().includes(keyword.toLowerCase())) {
      score += 0.3;
    }
  }
  
  // 检查搜索词是否包含商品的核心属性
  for (const attribute of product.attributes) {
    if (searchTerm.toLowerCase().includes(attribute.toLowerCase())) {
      score += 0.2;
    }
  }
  
  // 检查搜索词是否包含商品的品类词
  if (searchTerm.toLowerCase().includes(product.category.toLowerCase())) {
    score += 0.2;
  }
  
  return Math.min(score, 1.0);
}
```

**优点**：
- 更精确的归属
- 可以发现特定商品的问题词

**缺点**：
- 计算复杂度高
- 需要商品属性数据支持

#### 策略3：保守策略

只有当搜索词**明确包含**某商品的独特标识（如型号、颜色、尺寸组合）时才归属到该商品，否则归为品牌级。

```typescript
function conservativeAssignment(
  searchTerm: string,
  productsInAd: Product[]
): string {
  for (const product of productsInAd) {
    // 只有明确匹配才归属
    if (searchTerm.includes(product.modelNumber) ||
        searchTerm.includes(product.uniqueIdentifier)) {
      return product.id;
    }
  }
  
  // 默认归为品牌级
  return 'BRAND_LEVEL';
}
```

### 推荐方案

**默认使用策略1（品牌级分析）**，原因：

1. 实现简单，不容易出错
2. 避免错误归属导致的误否定
3. 品牌级否定本身就有价值
4. 可以在后续版本中升级到策略2

---

## 二、否定定向类型

Amazon广告支持两种否定定向类型：

### 1. 否定关键词（Negative Keywords）
- **否定精确匹配（Negative Exact）**：搜索词必须完全匹配才会被排除
- **否定短语匹配（Negative Phrase）**：搜索词包含该短语即被排除

### 2. 否定商品定向（Negative Product Targeting）
- **否定ASIN**：排除特定商品
- **否定品牌**：排除整个品牌的所有商品

---

## 二、各广告类型否定定向支持详情

### SP商品推广广告

| 广告子类型 | 否定关键词 | 否定ASIN | 否定品牌 | 支持层级 |
|-----------|:---------:|:--------:|:-------:|---------|
| **SP自动广告** | ✅ | ✅ | ✅ | 广告活动 / 广告组 |
| **SP手动-关键词定向** | ✅ | ❌ | ❌ | 广告活动 / 广告组 |
| **SP手动-商品定向** | ❌ | ✅ | ✅ | 广告活动 / 广告组 |

**关键发现**：
- SP自动广告同时支持否定关键词和否定ASIN
- SP手动关键词广告只支持否定关键词，不支持否定ASIN
- SP手动商品定向广告只支持否定ASIN/品牌，不支持否定关键词

### SB品牌广告

| 广告子类型 | 否定关键词 | 否定ASIN | 否定品牌 | 支持层级 |
|-----------|:---------:|:--------:|:-------:|---------|
| **SB商品集合-关键词定向** | ✅ | ✅ | ✅ | 广告组 |
| **SB商品集合-商品定向** | ✅ | ✅ | ✅ | 广告组 |
| **SB视频-关键词定向** | ✅ | ✅ | ✅ | 广告组 |
| **SB视频-商品定向** | ✅ | ✅ | ✅ | 广告组 |
| **SB旗舰店聚焦** | ✅ | ✅ | ✅ | 广告组 |

**关键发现**：
- SB广告的否定定向主要在**广告组层级**
- 所有SB广告类型都同时支持否定关键词和否定ASIN/品牌

### SD展示广告

| 广告子类型 | 否定关键词 | 否定ASIN | 否定品牌 | 支持层级 |
|-----------|:---------:|:--------:|:-------:|---------|
| **SD受众定向** | ❌ | ❌ | ❌ | 不支持 |
| **SD商品定向** | ❌ | ✅ | ✅ | 广告活动 |

**关键发现**：
- SD受众定向广告**完全不支持**否定定向
- SD商品定向广告只支持否定ASIN/品牌，不支持否定关键词
- SD广告不产生搜索词报告

---

## 三、搜索词来源 vs 否定执行能力对比

这是全局优化算法的核心：区分"能产生搜索词"和"能执行否定"两个维度。

| 广告渠道 | 产生搜索词 | 能否定关键词 | 能否定ASIN | 说明 |
|---------|:---------:|:-----------:|:---------:|------|
| SP自动广告 | ✅ | ✅ | ✅ | 完整支持 |
| SP手动-关键词 | ✅ | ✅ | ❌ | 只能否定关键词 |
| SP手动-商品定向 | ✅ | ❌ | ✅ | 只能否定ASIN |
| SB商品集合-关键词 | ✅ | ✅ | ✅ | 完整支持 |
| SB商品集合-商品定向 | ✅ | ✅ | ✅ | 完整支持 |
| SB视频-关键词 | ✅ | ✅ | ✅ | 完整支持 |
| SB视频-商品定向 | ✅ | ✅ | ✅ | 完整支持 |
| SD受众定向 | ❌ | ❌ | ❌ | 不参与搜索词分析 |
| SD商品定向 | ❌ | ❌ | ✅ | 不产生搜索词，但能否定ASIN |

---

## 四、全局否定算法设计

### 核心原则

**即使某个渠道不能直接否定，它产生的搜索词数据仍然应该参与全局N-Gram分析，然后在其他能否定的渠道执行全局否定。**

### 搜索词全局分析流程

```
步骤1：聚合搜索词数据（7个渠道）
├── SP自动广告 → 搜索词
├── SP手动-关键词 → 搜索词
├── SP手动-商品定向 → 搜索词（around the target原则）
├── SB商品集合-关键词 → 搜索词
├── SB商品集合-商品定向 → 搜索词
├── SB视频-关键词 → 搜索词
└── SB视频-商品定向 → 搜索词

步骤2：全局N-Gram分析
├── 识别低效词根（高ACoS、无转化）
├── 识别与产品属性不匹配的词根
└── 识别完全无关的词根组合

步骤3：确定否定执行渠道
├── 对于需要否定的关键词/词根：
│   ├── SP自动广告 → 执行否定关键词
│   ├── SP手动-关键词 → 执行否定关键词
│   ├── SB商品集合-关键词 → 执行否定关键词
│   ├── SB商品集合-商品定向 → 执行否定关键词
│   ├── SB视频-关键词 → 执行否定关键词
│   └── SB视频-商品定向 → 执行否定关键词
│
└── 对于需要否定的ASIN：
    ├── SP自动广告 → 执行否定ASIN
    ├── SP手动-商品定向 → 执行否定ASIN
    ├── SB商品集合-关键词 → 执行否定ASIN
    ├── SB商品集合-商品定向 → 执行否定ASIN
    ├── SB视频-关键词 → 执行否定ASIN
    ├── SB视频-商品定向 → 执行否定ASIN
    └── SD商品定向 → 执行否定ASIN
```

### 特殊情况处理

#### 情况1：SP手动-商品定向产生的搜索词

SP手动-商品定向广告会产生搜索词（around the target原则），但该渠道本身**不支持否定关键词**。

**处理方案**：
1. 将该渠道的搜索词纳入全局N-Gram分析
2. 识别出需要否定的关键词后，在**其他支持否定关键词的渠道**执行否定
3. 这些渠道包括：SP自动、SP手动-关键词、所有SB广告

#### 情况2：SB视频-商品定向产生的搜索词

SB视频-商品定向广告会产生搜索词，且该渠道**同时支持**否定关键词和否定ASIN。

**处理方案**：
1. 将该渠道的搜索词纳入全局N-Gram分析
2. 识别出需要否定的关键词/ASIN后，可以在本渠道和其他渠道同时执行否定

#### 情况3：SD广告

SD广告不产生搜索词，但SD商品定向支持否定ASIN。

**处理方案**：
1. SD广告不参与搜索词分析
2. 当全局分析识别出需要否定的ASIN时，SD商品定向也应该执行否定ASIN

---

## 五、全局否定执行矩阵

### 否定关键词执行渠道

当全局N-Gram分析识别出需要否定的关键词/词根时，在以下渠道执行：

| 执行渠道 | 否定层级 | 优先级 | 说明 |
|---------|---------|:------:|------|
| SP自动广告 | 广告活动/广告组 | 1 | 最重要，自动广告是搜索词的主要来源 |
| SP手动-关键词 | 广告活动/广告组 | 2 | 防止手动广告触发低效词 |
| SB商品集合-关键词 | 广告组 | 3 | 品牌广告也需要排除低效词 |
| SB商品集合-商品定向 | 广告组 | 3 | 虽然是商品定向，但也支持否定关键词 |
| SB视频-关键词 | 广告组 | 3 | 视频广告也需要排除低效词 |
| SB视频-商品定向 | 广告组 | 3 | 虽然是商品定向，但也支持否定关键词 |

**注意**：SP手动-商品定向**不支持**否定关键词，跳过该渠道。

### 否定ASIN执行渠道

当全局分析识别出需要否定的ASIN时，在以下渠道执行：

| 执行渠道 | 否定层级 | 优先级 | 说明 |
|---------|---------|:------:|------|
| SP自动广告 | 广告活动/广告组 | 1 | 排除低效商品定向 |
| SP手动-商品定向 | 广告活动/广告组 | 2 | 排除低效商品定向 |
| SB商品集合-关键词 | 广告组 | 3 | 品牌广告也支持否定ASIN |
| SB商品集合-商品定向 | 广告组 | 3 | 排除低效商品定向 |
| SB视频-关键词 | 广告组 | 3 | 视频广告也支持否定ASIN |
| SB视频-商品定向 | 广告组 | 3 | 排除低效商品定向 |
| SD商品定向 | 广告活动 | 4 | 展示广告也需要排除低效ASIN |

**注意**：SP手动-关键词和SD受众定向**不支持**否定ASIN，跳过这些渠道。

---

## 六、算法伪代码

```typescript
interface NegativeTargetingPlan {
  productId: string;
  negativeKeywords: {
    keyword: string;
    matchType: 'exact' | 'phrase';
    sourceChannels: string[];  // 产生该搜索词的渠道
    executeChannels: string[]; // 执行否定的渠道
  }[];
  negativeAsins: {
    asin: string;
    sourceChannels: string[];
    executeChannels: string[];
  }[];
}

function generateGlobalNegativePlan(productId: string): NegativeTargetingPlan {
  // 1. 聚合所有渠道的搜索词
  const allSearchTerms = aggregateSearchTerms(productId, [
    'SP_AUTO',
    'SP_MANUAL_KEYWORD',
    'SP_MANUAL_PRODUCT',  // 也产生搜索词！
    'SB_COLLECTION_KEYWORD',
    'SB_COLLECTION_PRODUCT',
    'SB_VIDEO_KEYWORD',
    'SB_VIDEO_PRODUCT'
  ]);
  
  // 2. 全局N-Gram分析
  const negativeKeywordCandidates = analyzeNGram(allSearchTerms);
  
  // 3. 确定否定关键词的执行渠道
  const keywordExecuteChannels = [
    'SP_AUTO',
    'SP_MANUAL_KEYWORD',
    // SP_MANUAL_PRODUCT 不支持否定关键词，跳过
    'SB_COLLECTION_KEYWORD',
    'SB_COLLECTION_PRODUCT',
    'SB_VIDEO_KEYWORD',
    'SB_VIDEO_PRODUCT'
  ];
  
  // 4. 确定否定ASIN的执行渠道
  const asinExecuteChannels = [
    'SP_AUTO',
    // SP_MANUAL_KEYWORD 不支持否定ASIN，跳过
    'SP_MANUAL_PRODUCT',
    'SB_COLLECTION_KEYWORD',
    'SB_COLLECTION_PRODUCT',
    'SB_VIDEO_KEYWORD',
    'SB_VIDEO_PRODUCT',
    'SD_PRODUCT'  // SD商品定向也支持否定ASIN
  ];
  
  return {
    productId,
    negativeKeywords: negativeKeywordCandidates.map(kw => ({
      keyword: kw.keyword,
      matchType: kw.matchType,
      sourceChannels: kw.sources,
      executeChannels: keywordExecuteChannels
    })),
    negativeAsins: negativeAsinCandidates.map(asin => ({
      asin: asin.asin,
      sourceChannels: asin.sources,
      executeChannels: asinExecuteChannels
    }))
  };
}
```

---

## 七、总结

### 核心要点

1. **搜索词来源（7个渠道）**：SP全部 + SB全部
2. **能否定关键词（6个渠道）**：SP自动 + SP手动关键词 + SB全部
3. **能否定ASIN（7个渠道）**：SP自动 + SP手动商品定向 + SB全部 + SD商品定向

### 全局优化的价值

- **数据更全面**：聚合7个渠道的搜索词，分析更准确
- **执行更高效**：一次识别，多渠道同步执行
- **覆盖更完整**：即使某渠道不能否定，也能在其他渠道实现全局保护

---

*文档更新时间：2026年1月*
