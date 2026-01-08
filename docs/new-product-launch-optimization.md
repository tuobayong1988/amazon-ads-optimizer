# 新品推广期优化算法设计

## 一、新品推广期的特殊挑战

### 1.1 数据稀缺性

新品推广期面临的核心挑战是**数据稀缺**，这直接影响了传统优化算法的效果：

| 挑战 | 具体表现 | 对算法的影响 |
|-----|---------|-------------|
| 历史数据不足 | 无法建立可靠的市场曲线模型 | 边际分析算法失效 |
| 转化数据稀疏 | 点击多但转化少，ACoS波动大 | 决策树判断不准确 |
| 搜索词样本少 | N-Gram分析样本量不足 | 词根识别置信度低 |
| 无季节性基准 | 缺乏历史同期对比数据 | 季节性调整无参考 |

### 1.2 新品推广期的阶段划分

```
新品生命周期
│
├── 【冷启动期】0-14天
│   • 几乎无历史数据
│   • 需要快速积累曝光和点击
│   • 目标：验证产品市场匹配度
│
├── 【数据积累期】15-45天
│   • 开始有初步数据
│   • 转化模式逐渐清晰
│   • 目标：识别有效关键词和受众
│
├── 【成长过渡期】46-90天
│   • 数据量接近成熟产品
│   • 可以开始应用标准算法
│   • 目标：优化投产比，扩大规模
│
└── 【成熟运营期】90天+
│   • 完整历史数据
│   • 应用全部优化算法
│   • 目标：持续优化，稳定增长
```

---

## 二、新品冷启动期优化策略（0-14天）

### 2.1 核心原则

在冷启动期，算法的核心目标是**快速积累有效数据**，而不是追求最优ACoS：

| 原则 | 描述 |
|-----|------|
| **曝光优先** | 优先保证足够的曝光量，即使CPC略高 |
| **广泛探索** | 使用广泛匹配和自动广告探索有效关键词 |
| **保守否定** | 除非明确无关，否则不急于否定 |
| **预算保护** | 设置每日预算上限，防止失控 |

### 2.2 竞价策略

#### 2.2.1 初始竞价设定

由于缺乏历史数据，使用**行业基准+贝叶斯先验**设定初始竞价：

```typescript
interface NewProductBidStrategy {
  // 初始竞价计算
  calculateInitialBid(params: {
    category: string;           // 商品类目
    targetAcos: number;         // 目标ACoS
    estimatedCvr: number;       // 预估转化率（基于类目基准）
    estimatedAov: number;       // 预估客单价
    competitiveness: 'low' | 'medium' | 'high'; // 竞争程度
  }): number;
}

function calculateInitialBid(params: NewProductBidParams): number {
  const { targetAcos, estimatedCvr, estimatedAov, competitiveness } = params;
  
  // 基础公式：目标CPC = 目标ACoS × 预估转化率 × 预估客单价
  const baseBid = targetAcos * estimatedCvr * estimatedAov;
  
  // 竞争度调整系数
  const competitivenessMultiplier = {
    low: 0.8,
    medium: 1.0,
    high: 1.2
  }[competitiveness];
  
  // 新品溢价系数（冷启动期需要更高竞价获取曝光）
  const newProductPremium = 1.15; // 15%溢价
  
  return baseBid * competitivenessMultiplier * newProductPremium;
}
```

#### 2.2.2 竞价调整策略

冷启动期采用**保守调整**策略：

| 条件 | 调整幅度 | 说明 |
|-----|:-------:|------|
| 曝光量 < 100/天 | +20% | 曝光不足，需要提高竞价 |
| 曝光量 > 1000/天，CTR < 0.2% | -10% | 曝光充足但点击率低，可能定位不准 |
| 有转化且ACoS < 目标×1.5 | 保持 | 表现可接受，继续观察 |
| 有转化且ACoS > 目标×2 | -15% | ACoS过高，适度降低 |
| 无转化但点击 > 50 | 保持 | 样本量不足，继续观察 |

**关键区别**：冷启动期的调整幅度比成熟期更小（±10-20% vs ±25-50%），调整频率更低（每3天 vs 每天）。

### 2.3 广告结构策略

#### 2.3.1 推荐的新品广告结构

```
新品广告矩阵
│
├── 【SP自动广告】- 必开
│   ├── 紧密匹配：积极竞价
│   ├── 宽泛匹配：中等竞价
│   ├── 同类商品：积极竞价
│   └── 关联商品：保守竞价
│
├── 【SP手动-广泛匹配】- 必开
│   └── 核心关键词（5-10个）：广泛匹配探索
│
├── 【SP手动-商品定向】- 可选
│   └── 竞品ASIN定向（3-5个）
│
└── 【SB视频广告】- 可选（有品牌备案）
    └── 单品视频：核心关键词
```

#### 2.3.2 预算分配建议

| 广告类型 | 预算占比 | 说明 |
|---------|:-------:|------|
| SP自动广告 | 40% | 探索有效关键词 |
| SP手动-广泛匹配 | 35% | 验证核心关键词 |
| SP手动-商品定向 | 15% | 抢占竞品流量 |
| SB视频广告 | 10% | 品牌曝光（可选） |

### 2.4 搜索词处理策略

#### 2.4.1 保守否定原则

冷启动期采用**极度保守**的否定策略：

```typescript
interface ColdStartNegativeStrategy {
  // 否定阈值（比成熟期更严格）
  thresholds: {
    minClicks: 30;        // 最少30次点击才考虑否定（成熟期：10次）
    minSpend: 20;         // 最少$20花费才考虑否定（成熟期：$5）
    maxAcos: 3.0;         // ACoS超过目标3倍才否定（成熟期：2倍）
    minDays: 7;           // 至少观察7天（成熟期：3天）
  };
  
  // 绝对否定词（无论数据如何都否定）
  absoluteNegatives: string[];
}

const coldStartNegativeStrategy: ColdStartNegativeStrategy = {
  thresholds: {
    minClicks: 30,
    minSpend: 20,
    maxAcos: 3.0,
    minDays: 7
  },
  absoluteNegatives: [
    'free', 'cheap', 'used', 'refurbished', 'broken',
    'how to', 'what is', 'review', 'vs', 'alternative'
  ]
};
```

#### 2.4.2 搜索词收集优先

冷启动期的重点是**收集**而非**否定**：

| 操作 | 优先级 | 说明 |
|-----|:------:|------|
| 收集有转化的搜索词 | ⭐⭐⭐⭐⭐ | 为后续手动广告积累关键词 |
| 收集高点击率搜索词 | ⭐⭐⭐⭐ | 可能是潜在高价值词 |
| 否定明显无关词 | ⭐⭐⭐ | 仅否定绝对无关的词 |
| N-Gram分析 | ⭐⭐ | 样本量不足，仅供参考 |

---

## 三、数据积累期优化策略（15-45天）

### 3.1 核心原则

数据积累期开始有初步数据，算法目标是**识别有效关键词和受众**：

| 原则 | 描述 |
|-----|------|
| **验证假设** | 验证冷启动期识别的潜力关键词 |
| **逐步收紧** | 开始收紧无效流量，但仍保持探索 |
| **匹配升级** | 将验证有效的广泛匹配升级为短语匹配 |
| **数据驱动** | 开始使用数据驱动决策，但保持保守 |

### 3.2 竞价策略

#### 3.2.1 分层竞价调整

根据关键词表现分层处理：

```typescript
interface DataAccumulationBidStrategy {
  // 关键词分层
  tiers: {
    // 高价值词：有转化且ACoS < 目标×1.2
    highValue: {
      adjustment: '+10%';
      frequency: '每周';
    };
    // 潜力词：有转化但ACoS在目标×1.2-2之间
    potential: {
      adjustment: '保持';
      frequency: '每周';
    };
    // 观察词：有点击无转化，但点击<30
    observing: {
      adjustment: '保持';
      frequency: '继续观察';
    };
    // 低效词：有点击无转化，点击>30
    inefficient: {
      adjustment: '-20%';
      frequency: '每周';
    };
  };
}
```

#### 3.2.2 市场曲线初步建模

当数据量达到一定阈值时，开始尝试市场曲线建模：

```typescript
function canBuildMarketCurve(keyword: KeywordData): boolean {
  return (
    keyword.dataPoints >= 14 &&      // 至少14天数据
    keyword.totalClicks >= 50 &&     // 至少50次点击
    keyword.bidChanges >= 3          // 至少3次竞价变化
  );
}

function buildPreliminaryMarketCurve(keyword: KeywordData): MarketCurve {
  // 使用贝叶斯方法，结合先验和观测数据
  const prior = getCategoryPrior(keyword.category);
  const observed = keyword.bidClickData;
  
  // 贝叶斯更新
  return bayesianUpdate(prior, observed, {
    priorWeight: 0.4,  // 先验权重较高（数据不足）
    observedWeight: 0.6
  });
}
```

### 3.3 搜索词处理策略

#### 3.3.1 搜索词迁移

开始将验证有效的搜索词迁移到手动广告：

```typescript
interface DataAccumulationMigrationStrategy {
  // 迁移条件（比成熟期更宽松）
  migrationThresholds: {
    minConversions: 2;      // 至少2次转化（成熟期：3次）
    maxAcos: 1.5;           // ACoS < 目标×1.5（成熟期：1.2）
    minClicks: 15;          // 至少15次点击（成熟期：20次）
  };
  
  // 迁移目标
  migrationTarget: 'broad' | 'phrase';  // 数据积累期先迁移到广泛或短语
}
```

#### 3.3.2 N-Gram分析启用

当搜索词样本量达到阈值时，启用N-Gram分析：

```typescript
function canEnableNgramAnalysis(product: ProductData): boolean {
  return (
    product.uniqueSearchTerms >= 100 &&  // 至少100个不同搜索词
    product.totalSearchTermClicks >= 500 // 至少500次搜索词点击
  );
}

// 数据积累期的N-Gram分析使用更高的阈值
const dataAccumulationNgramThresholds = {
  minClicks: 20,      // 成熟期：10
  minSpend: 15,       // 成熟期：5
  maxAcos: 2.5,       // 成熟期：2.0
  minOccurrences: 5   // 成熟期：3
};
```

### 3.4 广告结构优化

#### 3.4.1 广告活动扩展

根据数据表现扩展广告结构：

```
数据积累期广告矩阵扩展
│
├── 【SP自动广告】- 继续运行
│   └── 根据匹配类型表现调整竞价
│
├── 【SP手动-广泛匹配】- 扩展
│   └── 添加自动广告中发现的高价值词
│
├── 【SP手动-短语匹配】- 新增
│   └── 将验证有效的广泛匹配词升级
│
├── 【SP手动-商品定向】- 扩展
│   └── 添加表现好的竞品ASIN
│
└── 【SB视频广告】- 扩展（如适用）
    └── 添加验证有效的关键词
```

---

## 四、成长过渡期优化策略（46-90天）

### 4.1 核心原则

成长过渡期数据量接近成熟产品，开始**逐步应用标准算法**：

| 原则 | 描述 |
|-----|------|
| **算法过渡** | 逐步从保守策略过渡到标准算法 |
| **精准匹配** | 将表现稳定的词升级为精准匹配 |
| **效率优化** | 开始追求ACoS优化，而非仅曝光 |
| **规模扩展** | 在保持效率的前提下扩大规模 |

### 4.2 算法启用条件

```typescript
interface AlgorithmEnablementConditions {
  // 市场曲线建模
  marketCurve: {
    minDataDays: 30;
    minClicks: 100;
    minBidChanges: 5;
    enabled: boolean;
  };
  
  // 边际分析
  marginalAnalysis: {
    minDataDays: 45;
    minConversions: 20;
    enabled: boolean;
  };
  
  // 双层N-Gram分析
  dualLayerNgram: {
    minUniqueSearchTerms: 200;
    minSearchTermClicks: 1000;
    enabled: boolean;
  };
  
  // 分时竞价
  dayparting: {
    minDataDays: 30;
    minDailyClicks: 20;
    enabled: boolean;
  };
}

function checkAlgorithmEnablement(product: ProductData): AlgorithmEnablementConditions {
  const dataAge = daysSinceLaunch(product.launchDate);
  
  return {
    marketCurve: {
      minDataDays: 30,
      minClicks: 100,
      minBidChanges: 5,
      enabled: dataAge >= 30 && product.totalClicks >= 100
    },
    marginalAnalysis: {
      minDataDays: 45,
      minConversions: 20,
      enabled: dataAge >= 45 && product.totalConversions >= 20
    },
    dualLayerNgram: {
      minUniqueSearchTerms: 200,
      minSearchTermClicks: 1000,
      enabled: product.uniqueSearchTerms >= 200 && product.searchTermClicks >= 1000
    },
    dayparting: {
      minDataDays: 30,
      minDailyClicks: 20,
      enabled: dataAge >= 30 && product.avgDailyClicks >= 20
    }
  };
}
```

### 4.3 竞价策略

#### 4.3.1 混合竞价模式

成长过渡期使用**混合竞价模式**，结合规则和算法：

```typescript
function calculateGrowthPhaseBid(keyword: KeywordData): BidRecommendation {
  const enablement = checkAlgorithmEnablement(keyword.product);
  
  if (enablement.marketCurve.enabled && enablement.marginalAnalysis.enabled) {
    // 数据充足：使用市场曲线+边际分析
    const optimalBid = calculateOptimalBidFromCurve(keyword);
    const marginalBid = calculateMarginalOptimalBid(keyword);
    
    // 加权平均（逐步增加算法权重）
    const algorithmWeight = Math.min(0.7, (keyword.dataAge - 30) / 60);
    return {
      bid: optimalBid * algorithmWeight + marginalBid * (1 - algorithmWeight),
      confidence: 'medium',
      source: 'hybrid'
    };
  } else {
    // 数据不足：使用决策树+规则
    return calculateRuleBasedBid(keyword);
  }
}
```

#### 4.3.2 调整幅度渐进

调整幅度从保守逐步过渡到标准：

| 数据天数 | 最大调整幅度 | 调整频率 |
|:-------:|:-----------:|:-------:|
| 46-60天 | ±25% | 每周 |
| 61-75天 | ±35% | 每5天 |
| 76-90天 | ±45% | 每3天 |
| 90天+ | ±50% | 每天 |

### 4.4 广告结构成熟化

```
成长过渡期广告矩阵
│
├── 【SP自动广告】- 优化
│   └── 降低预算占比，作为关键词发现渠道
│
├── 【SP手动-精准匹配】- 新增/扩展
│   └── 将验证有效的短语匹配词升级
│
├── 【SP手动-短语匹配】- 扩展
│   └── 继续承接广泛匹配的有效词
│
├── 【SP手动-广泛匹配】- 收缩
│   └── 仅保留探索性关键词
│
├── 【SP手动-商品定向】- 优化
│   └── 基于数据优化ASIN定向
│
└── 【SB/SD广告】- 扩展（如适用）
    └── 基于SP数据扩展品牌和展示广告
```

---

## 五、新品优化算法的特殊处理

### 5.1 置信度评分系统

为每个优化建议提供置信度评分：

```typescript
interface ConfidenceScore {
  score: number;           // 0-100
  level: 'low' | 'medium' | 'high';
  factors: {
    dataVolume: number;    // 数据量因素
    dataAge: number;       // 数据时长因素
    consistency: number;   // 数据一致性因素
    sampleSize: number;    // 样本量因素
  };
  recommendation: string;  // 基于置信度的建议
}

function calculateConfidence(data: OptimizationData): ConfidenceScore {
  const dataVolumeFactor = Math.min(100, data.clicks / 10);
  const dataAgeFactor = Math.min(100, data.dataAge / 0.9);
  const consistencyFactor = calculateConsistency(data.dailyMetrics);
  const sampleSizeFactor = Math.min(100, data.conversions * 10);
  
  const score = (
    dataVolumeFactor * 0.3 +
    dataAgeFactor * 0.25 +
    consistencyFactor * 0.25 +
    sampleSizeFactor * 0.2
  );
  
  return {
    score,
    level: score < 40 ? 'low' : score < 70 ? 'medium' : 'high',
    factors: {
      dataVolume: dataVolumeFactor,
      dataAge: dataAgeFactor,
      consistency: consistencyFactor,
      sampleSize: sampleSizeFactor
    },
    recommendation: getRecommendation(score)
  };
}

function getRecommendation(score: number): string {
  if (score < 40) {
    return '数据量不足，建议继续观察，暂不执行大幅调整';
  } else if (score < 70) {
    return '数据量中等，建议保守调整，密切监控效果';
  } else {
    return '数据量充足，可以执行标准优化策略';
  }
}
```

### 5.2 贝叶斯先验系统

使用行业基准作为先验，与观测数据结合：

```typescript
interface CategoryPrior {
  category: string;
  priors: {
    avgCvr: number;        // 平均转化率
    avgCtr: number;        // 平均点击率
    avgCpc: number;        // 平均CPC
    avgAcos: number;       // 平均ACoS
    bidClickElasticity: number;  // 出价-点击弹性
  };
  confidence: number;      // 先验置信度
}

function bayesianEstimate(
  prior: number,
  observed: number,
  observedWeight: number,
  priorConfidence: number
): number {
  // 贝叶斯加权平均
  const priorWeight = priorConfidence * (1 - observedWeight);
  const totalWeight = priorWeight + observedWeight;
  
  return (prior * priorWeight + observed * observedWeight) / totalWeight;
}

// 示例：估计新品的转化率
function estimateNewProductCvr(
  categoryPrior: CategoryPrior,
  observedClicks: number,
  observedConversions: number
): number {
  const observedCvr = observedConversions / observedClicks;
  const observedWeight = Math.min(0.9, observedClicks / 100); // 100次点击达到90%权重
  
  return bayesianEstimate(
    categoryPrior.priors.avgCvr,
    observedCvr,
    observedWeight,
    categoryPrior.confidence
  );
}
```

### 5.3 异常检测与保护

新品期需要更敏感的异常检测：

```typescript
interface NewProductProtection {
  // 预算保护
  budgetProtection: {
    maxDailySpend: number;           // 每日最大花费
    maxWeeklySpend: number;          // 每周最大花费
    alertThreshold: number;          // 预警阈值（占预算百分比）
  };
  
  // 竞价保护
  bidProtection: {
    maxBid: number;                  // 最高竞价
    maxBidIncrease: number;          // 单次最大涨幅
    maxBidDecrease: number;          // 单次最大降幅
  };
  
  // 否定保护
  negativeProtection: {
    minClicksBeforeNegative: number; // 否定前最少点击
    minDaysBeforeNegative: number;   // 否定前最少天数
    requireManualApproval: boolean;  // 是否需要人工审批
  };
}

const newProductProtection: NewProductProtection = {
  budgetProtection: {
    maxDailySpend: 100,
    maxWeeklySpend: 500,
    alertThreshold: 0.8
  },
  bidProtection: {
    maxBid: 5.0,
    maxBidIncrease: 0.2,   // 20%
    maxBidDecrease: 0.15   // 15%
  },
  negativeProtection: {
    minClicksBeforeNegative: 30,
    minDaysBeforeNegative: 7,
    requireManualApproval: true
  }
};
```

---

## 六、新品优化算法适用性评估

### 6.1 改进后的适用性

| 场景 | 改进前适用度 | 改进后适用度 | 改进说明 |
|-----|:----------:|:----------:|---------|
| 冷启动期（0-14天） | ⭐⭐ | ⭐⭐⭐⭐ | 贝叶斯先验+保守策略 |
| 数据积累期（15-45天） | ⭐⭐⭐ | ⭐⭐⭐⭐ | 渐进式算法启用 |
| 成长过渡期（46-90天） | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | 混合竞价模式 |
| 成熟运营期（90天+） | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | 完整算法应用 |

### 6.2 新品优化算法优势

| 优势 | 描述 |
|-----|------|
| **阶段适配** | 根据新品生命周期阶段自动调整算法策略 |
| **置信度驱动** | 每个建议都有置信度评分，低置信度时保守处理 |
| **贝叶斯增强** | 使用行业基准作为先验，弥补数据不足 |
| **渐进式启用** | 算法功能随数据积累渐进启用，避免过早优化 |
| **多重保护** | 预算、竞价、否定多重保护机制 |

### 6.3 新品优化算法局限

| 局限 | 描述 | 缓解措施 |
|-----|------|---------|
| **先验依赖** | 贝叶斯先验依赖行业基准的准确性 | 持续更新行业基准数据 |
| **保守倾向** | 保守策略可能错过早期机会 | 提供"激进模式"选项 |
| **人工干预** | 低置信度时需要人工决策 | 提供清晰的决策建议 |

---

## 七、实施建议

### 7.1 新品上架检查清单

```
□ 设置合理的目标ACoS（新品期可以接受更高的ACoS）
□ 配置每日/每周预算上限
□ 选择正确的商品类目（影响先验数据）
□ 准备5-10个核心关键词
□ 识别3-5个主要竞品ASIN
□ 启用新品保护模式
```

### 7.2 阶段性检查点

| 时间点 | 检查内容 | 决策点 |
|:-----:|---------|-------|
| 第7天 | 曝光量、点击率 | 是否需要提高竞价 |
| 第14天 | 首批转化数据 | 是否进入数据积累期 |
| 第30天 | 搜索词表现 | 是否启用N-Gram分析 |
| 第45天 | 整体ACoS趋势 | 是否进入成长过渡期 |
| 第60天 | 关键词分层 | 是否启用市场曲线建模 |
| 第90天 | 全面评估 | 是否进入成熟运营期 |

---

*文档更新时间：2026年1月*
