# Amazon广告分渠道智能优化算法设计文档

**版本**: 2.0  
**作者**: Manus AI  
**更新日期**: 2026年1月8日

---

## 目录

1. [概述](#概述)
2. [Amazon广告产品体系](#amazon广告产品体系)
3. [SP商品推广广告优化算法](#sp商品推广广告优化算法)
4. [SB品牌广告优化算法](#sb品牌广告优化算法)
5. [SD展示广告优化算法](#sd展示广告优化算法)
6. [全局预算分配算法](#全局预算分配算法)
7. [核心算法组件](#核心算法组件)
8. [算法对比与优势](#算法对比与优势)

---

## 概述

本文档详细描述了针对Amazon三大广告产品（SP、SB、SD）的智能优化算法设计。算法设计基于以下核心原则：

1. **分渠道特性**：每种广告类型有独特的竞价机制、转化路径和优化目标
2. **数据驱动**：基于市场曲线建模、边际分析和决策树的科学决策
3. **全局最优**：通过跨渠道预算分配追求整体ROI最大化
4. **安全边界**：设置合理的调整上限，防止算法失控

---

## Amazon广告产品体系

### 广告类型完整分类

| 广告产品 | 子类型 | 定向方式 | 竞价机制 | 落地页 |
|---------|-------|---------|---------|-------|
| **SP商品推广** | 自动广告 | 紧密/宽泛/同类/关联 | CPC | 商品详情页 |
| | 手动-关键词 | 精确/词组/广泛 | CPC | 商品详情页 |
| | 手动-商品定向 | ASIN/类目 | CPC | 商品详情页 |
| **SB品牌广告** | 商品集合 | 关键词/ASIN/类目 | CPC/vCPM | 旗舰店/自定义/PDP |
| | 品牌旗舰店聚焦 | 关键词/ASIN/类目 | CPC/vCPM | 旗舰店子页面 |
| | 视频广告(单品) | 关键词/ASIN/类目 | CPC/vCPM | PDP |
| | 视频广告(多ASIN) | 关键词/ASIN/类目 | CPC/vCPM | 旗舰店+PDP |
| | 品牌视频 | 关键词/ASIN/类目 | CPC/vCPM | 旗舰店 |
| **SD展示广告** | 浏览再营销 | 受众 | CPC/vCPM | 商品详情页 |
| | 购买再营销 | 受众 | CPC/vCPM | 商品详情页 |
| | 相似受众 | 受众 | CPC/vCPM | 商品详情页 |
| | 商品定向 | ASIN/类目 | CPC/vCPM | 商品详情页 |

### 竞价机制详解

**CPC (Cost Per Click)**：
- 按点击付费
- 适用于转化导向的广告活动
- 优化目标：ACoS、ROAS、转化率

**vCPM (Cost Per 1000 Viewable Impressions)**：
- 按千次可见展示付费
- 适用于品牌曝光导向的广告活动
- 优化目标：展示份额、品牌搜索提升、覆盖效率

---

## SP商品推广广告优化算法

### 1. 自动广告四种匹配类型

SP自动广告包含四种匹配类型，每种类型有不同的优化策略：

| 匹配类型 | 定向逻辑 | 优化重点 | 竞价策略 |
|---------|---------|---------|---------|
| **紧密匹配** | 高相关搜索词 | 追求转化 | 积极竞价 |
| **宽泛匹配** | 松散相关搜索词 | 筛选有效词 | 保守竞价 |
| **同类商品** | 类似商品浏览者 | 抢占份额 | 竞争性竞价 |
| **关联商品** | 互补商品浏览者 | 交叉销售 | 稳定竞价 |

**优化算法**：

```typescript
interface AutoTargetOptimization {
  targetType: 'close_match' | 'loose_match' | 'substitutes' | 'complements';
  
  // 根据匹配类型调整目标ACoS
  adjustedTargetAcos: number; // 紧密=目标, 宽泛=目标×0.8, 同类=目标×1.1, 关联=目标×0.9
  
  // 应用市场曲线计算最优竞价
  optimalBid: number;
  
  // 决策树判断
  action: 'increase' | 'decrease' | 'pause' | 'maintain';
}
```

### 2. 手动广告-关键词定向

这是SP广告的核心，需要完整应用市场曲线建模、边际分析和决策树逻辑。

**关键词分层优化**：

| 层级 | 定义 | 数据要求 | 优化方法 | 调整幅度 |
|-----|------|---------|---------|---------|
| **头部词** | 高流量关键词 | 点击≥50, 转化≥5 | 市场曲线+边际分析 | ±5-15% |
| **腰部词** | 中等流量关键词 | 点击≥20, 转化≥2 | 决策树+规则 | ±10-25% |
| **长尾词** | 低流量关键词 | 点击<20 | 贝叶斯先验+决策树 | ±15-30% |

**核心优化公式**：

```
1. 高ACoS关键词（ACoS > Target ACoS）：
   New Bid = RPC × Target ACoS
   其中 RPC = Sales / Clicks

2. 高花费无转化关键词（Spend > Target CPA 且 Orders = 0）：
   New Bid = (AOV / Clicks) × Target ACoS
   其中 Target CPA = Target ACoS × AOV

3. 低ACoS关键词（ACoS < Target ACoS × 0.8）：
   New Bid = Current Bid × (1 + 调整系数)
   调整系数 = 5-10%，根据ACoS与目标的差距动态调整

4. 低曝光关键词（Clicks < 平均点击转化数）：
   New Bid = Current Bid × 1.05
```

### 3. 广告位置竞价调整

| 位置 | 调整范围 | 优化逻辑 |
|-----|---------|---------|
| Top of Search | 0-900% | 根据位置ROAS与整体ROAS对比调整 |
| Product Pages | 0-900% | 根据位置转化率与整体对比调整 |
| Rest of Search | 基础竞价 | 作为基准 |

**位置调整算法**：

```typescript
function calculatePlacementModifier(
  placementRoas: number,
  overallRoas: number,
  currentModifier: number
): number {
  const roasRatio = placementRoas / overallRoas;
  
  if (roasRatio > 1.2) {
    // 位置表现优于整体，提高竞价
    return Math.min(currentModifier * 1.1, 900);
  } else if (roasRatio < 0.8) {
    // 位置表现差于整体，降低竞价
    return Math.max(currentModifier * 0.9, 0);
  }
  return currentModifier;
}
```

---

## SB品牌广告优化算法

### 1. 广告格式分类

SB广告有三种主要格式，每种格式有不同的优化重点：

| 格式 | 落地页 | 核心指标 | 优化重点 |
|-----|-------|---------|---------|
| **商品集合** | 旗舰店/自定义/PDP | CTR, CVR, ACoS | 商品组合优化 |
| **品牌旗舰店聚焦** | 旗舰店子页面 | 页面访问量, 停留时间 | 页面内容优化 |
| **视频广告** | PDP/旗舰店 | 观看率, 完播率, CTR | 视频创意+搜索优化 |

### 2. SB视频广告优化（关键更新）

**重要发现**：SB视频广告虽然归类为品牌广告，但其本质是**搜索广告**，通过搜索词触发，需要应用完整的搜索广告优化逻辑。

**视频广告类型**：

| 类型 | 展示商品数 | 落地页 | 点击行为 |
|-----|-----------|-------|---------|
| 单品视频 | 1个 | 商品详情页 | 直接到PDP |
| 多ASIN视频 | 1-3个 | 旗舰店+PDP | 商品→PDP, 品牌元素→旗舰店 |
| 品牌视频 | 多个 | 品牌旗舰店 | 到旗舰店 |

**多ASIN视频广告性能数据**（Amazon官方）：
- 3-ASIN视频 vs 1-ASIN视频：CTR提高43.9%，ROAS提高34.0%

**CPC模式优化算法**：

```typescript
interface SBVideoOptimization {
  // 1. 应用搜索广告核心逻辑
  searchOptimization: {
    marketCurve: MarketCurveModel;
    marginalAnalysis: MarginalAnalysisResult;
    decisionTree: DecisionTreeResult;
  };
  
  // 2. 视频特有指标
  videoMetrics: {
    viewRate: number;           // 观看率
    completionRate: number;     // 完播率
    videoFirstQuartile: number; // 25%观看
    videoMidpoint: number;      // 50%观看
    videoThirdQuartile: number; // 75%观看
  };
  
  // 3. 新客户价值
  newToBrandMetrics: {
    ntbSales: number;           // 新客户销售额
    ntbOrders: number;          // 新客户订单数
    ntbPercentage: number;      // 新客户占比
    customerLTV: number;        // 客户生命周期价值
  };
  
  // 4. 综合优化决策
  optimizationDecision: {
    bidAdjustment: number;
    action: 'increase' | 'decrease' | 'maintain';
    confidence: number;
  };
}
```

**vCPM模式优化算法**：

当广告目标是"增加品牌印象份额"时，使用vCPM竞价：

```typescript
interface SBVcpmOptimization {
  // 展示效率指标
  impressionMetrics: {
    impressions: number;
    viewableImpressions: number;
    topOfSearchImpressionShare: number;
    effectiveCPM: number; // Cost / Impressions * 1000
  };
  
  // 品牌价值指标
  brandMetrics: {
    brandedSearchLift: number;  // 品牌搜索提升
    brandAwareness: number;     // 品牌认知度
    shareOfVoice: number;       // 声量份额
  };
  
  // 优化决策
  optimizationDecision: {
    targetImpressionShare: number;
    maxCPM: number;
    action: 'increase_share' | 'optimize_efficiency' | 'maintain';
  };
}
```

### 3. 新客户指标处理

SB广告独有的新客户指标需要特殊处理：

```typescript
function calculateAdjustedAcos(
  standardAcos: number,
  ntbPercentage: number,
  customerLTV: number,
  averageOrderValue: number
): number {
  // 新客户的长期价值调整
  const ltvMultiplier = customerLTV / averageOrderValue;
  const ntbValueAdjustment = ntbPercentage * (ltvMultiplier - 1);
  
  // 调整后的ACoS考虑新客户长期价值
  return standardAcos / (1 + ntbValueAdjustment);
}
```

---

## SD展示广告优化算法

### 1. 定向类型分类

| 定向类型 | 描述 | 优化重点 |
|---------|------|---------|
| **浏览再营销** | 浏览过商品但未购买 | 转化率优化 |
| **购买再营销** | 已购买过的用户 | 复购率优化 |
| **相似受众** | 与现有客户相似 | 覆盖扩展 |
| **商品定向** | 浏览特定商品/类目 | 竞品拦截 |
| **兴趣定向** | 特定兴趣用户 | 品牌曝光 |
| **生活方式定向** | 特定生活方式 | 品牌曝光 |

### 2. SD广告的特殊性

SD广告与SP/SB的核心差异：

1. **双重归因**：同时考虑点击归因和浏览归因
2. **频次控制**：需要控制展示频次避免用户疲劳
3. **计费方式**：支持CPC和vCPM两种模式

**浏览归因处理**：

```typescript
interface SDAttributionModel {
  // 点击归因（14天）
  clickAttribution: {
    sales: number;
    orders: number;
    units: number;
  };
  
  // 浏览归因（14天）
  viewAttribution: {
    sales: number;
    orders: number;
    units: number;
  };
  
  // 综合归因（去重后）
  totalAttribution: {
    sales: number;
    orders: number;
    units: number;
  };
}

function calculateEffectiveRoas(
  attribution: SDAttributionModel,
  cost: number,
  viewAttributionWeight: number = 0.3 // 浏览归因权重
): number {
  const weightedSales = 
    attribution.clickAttribution.sales + 
    attribution.viewAttribution.sales * viewAttributionWeight;
  
  return weightedSales / cost;
}
```

### 3. 频次控制算法

```typescript
function evaluateFrequencyHealth(
  impressions: number,
  reach: number,
  conversions: number
): FrequencyRecommendation {
  const frequency = impressions / reach;
  const conversionRate = conversions / reach;
  
  if (frequency > 10 && conversionRate < 0.01) {
    return {
      status: 'over_exposure',
      recommendation: 'expand_audience',
      suggestedFrequencyCap: 7
    };
  } else if (frequency < 3 && conversionRate > 0.02) {
    return {
      status: 'under_exposure',
      recommendation: 'increase_bid',
      suggestedFrequencyCap: null
    };
  }
  
  return {
    status: 'healthy',
    recommendation: 'maintain',
    suggestedFrequencyCap: null
  };
}
```

### 4. CPC vs vCPM选择建议

```typescript
function recommendCostType(
  currentCTR: number,
  currentCVR: number,
  campaignGoal: 'awareness' | 'consideration' | 'conversion'
): 'CPC' | 'vCPM' {
  // 转化导向使用CPC
  if (campaignGoal === 'conversion') {
    return 'CPC';
  }
  
  // 品牌认知导向使用vCPM
  if (campaignGoal === 'awareness') {
    return 'vCPM';
  }
  
  // 考虑阶段根据CTR决定
  // CTR极低时，vCPM可能更经济
  if (currentCTR < 0.001) {
    return 'vCPM';
  }
  
  return 'CPC';
}
```

---

## 全局预算分配算法

### 1. 跨渠道预算分配原则

**边际ROAS均衡原则**：在最优状态下，所有渠道的边际ROAS应该相等。

```typescript
interface ChannelPerformance {
  channelId: string;
  channelType: 'SP' | 'SB' | 'SD';
  currentBudget: number;
  currentRoas: number;
  marginalRoas: number; // 边际ROAS
  budgetUtilization: number;
}

function optimizeBudgetAllocation(
  channels: ChannelPerformance[],
  totalBudget: number
): Map<string, number> {
  // 按边际ROAS排序
  const sortedChannels = [...channels].sort(
    (a, b) => b.marginalRoas - a.marginalRoas
  );
  
  const allocation = new Map<string, number>();
  let remainingBudget = totalBudget;
  
  // 贪心分配：优先分配给边际ROAS最高的渠道
  for (const channel of sortedChannels) {
    if (remainingBudget <= 0) break;
    
    // 计算该渠道的最优预算
    const optimalBudget = calculateOptimalChannelBudget(
      channel,
      remainingBudget
    );
    
    allocation.set(channel.channelId, optimalBudget);
    remainingBudget -= optimalBudget;
  }
  
  return allocation;
}
```

### 2. Scenarios模型

提供不同预算水平下的预期效果预测：

```typescript
interface BudgetScenario {
  budgetLevel: 'conservative' | 'moderate' | 'aggressive';
  totalBudget: number;
  expectedSales: number;
  expectedRoas: number;
  expectedAcos: number;
  channelAllocation: Map<string, number>;
  confidenceInterval: {
    lower: number;
    upper: number;
  };
}

function generateScenarios(
  currentPerformance: ChannelPerformance[],
  currentTotalBudget: number
): BudgetScenario[] {
  return [
    generateScenario(currentPerformance, currentTotalBudget * 0.8, 'conservative'),
    generateScenario(currentPerformance, currentTotalBudget, 'moderate'),
    generateScenario(currentPerformance, currentTotalBudget * 1.2, 'aggressive')
  ];
}
```

---

## 核心算法组件

### 1. 市场曲线建模

市场曲线描述了竞价与流量之间的关系：

```typescript
interface MarketCurveModel {
  // 曲线参数
  parameters: {
    saturationPoint: number;    // 饱和点
    elasticity: number;         // 弹性系数
    baselineTraffic: number;    // 基础流量
  };
  
  // 预测函数
  predictTraffic(bid: number): number;
  predictCost(bid: number): number;
  predictConversions(bid: number): number;
}

function buildMarketCurve(
  historicalData: BidPerformanceData[]
): MarketCurveModel {
  // 使用对数函数拟合：Traffic = a * ln(bid) + b
  const { a, b } = fitLogarithmicCurve(historicalData);
  
  return {
    parameters: {
      saturationPoint: Math.exp((1 - b) / a),
      elasticity: a,
      baselineTraffic: b
    },
    predictTraffic: (bid) => a * Math.log(bid) + b,
    predictCost: (bid) => bid * (a * Math.log(bid) + b),
    predictConversions: (bid) => (a * Math.log(bid) + b) * conversionRate
  };
}
```

### 2. 边际分析

计算竞价变化的边际效益：

```typescript
interface MarginalAnalysis {
  currentBid: number;
  currentProfit: number;
  marginalRevenue: number;  // 边际收入
  marginalCost: number;     // 边际成本
  marginalProfit: number;   // 边际利润
  optimalBid: number;       // 最优竞价（边际利润=0）
}

function performMarginalAnalysis(
  marketCurve: MarketCurveModel,
  currentBid: number,
  conversionRate: number,
  averageOrderValue: number
): MarginalAnalysis {
  const delta = 0.01; // 竞价变化量
  
  const currentTraffic = marketCurve.predictTraffic(currentBid);
  const newTraffic = marketCurve.predictTraffic(currentBid + delta);
  
  const marginalTraffic = newTraffic - currentTraffic;
  const marginalConversions = marginalTraffic * conversionRate;
  const marginalRevenue = marginalConversions * averageOrderValue;
  const marginalCost = delta * newTraffic + (currentBid + delta) * marginalTraffic;
  
  return {
    currentBid,
    currentProfit: calculateProfit(currentBid, marketCurve, conversionRate, averageOrderValue),
    marginalRevenue,
    marginalCost,
    marginalProfit: marginalRevenue - marginalCost,
    optimalBid: findOptimalBid(marketCurve, conversionRate, averageOrderValue)
  };
}
```

### 3. 决策树逻辑

```typescript
interface DecisionTreeNode {
  condition: (data: KeywordData) => boolean;
  trueAction: DecisionTreeNode | OptimizationAction;
  falseAction: DecisionTreeNode | OptimizationAction;
}

const keywordDecisionTree: DecisionTreeNode = {
  condition: (data) => data.clicks >= 20,
  trueAction: {
    // 有足够数据
    condition: (data) => data.orders > 0,
    trueAction: {
      // 有转化
      condition: (data) => data.acos > data.targetAcos,
      trueAction: { action: 'decrease_bid', method: 'rpc_formula' },
      falseAction: {
        condition: (data) => data.acos < data.targetAcos * 0.8,
        trueAction: { action: 'increase_bid', percentage: 0.1 },
        falseAction: { action: 'maintain' }
      }
    },
    falseAction: {
      // 无转化
      condition: (data) => data.spend > data.targetCpa,
      trueAction: { action: 'decrease_bid', method: 'anticipated_rpc' },
      falseAction: { action: 'maintain' }
    }
  },
  falseAction: {
    // 数据不足，使用贝叶斯先验
    condition: (data) => data.clicks < 10,
    trueAction: { action: 'increase_bid', percentage: 0.05 },
    falseAction: { action: 'maintain' }
  }
};
```

---

## 算法对比与优势

### 与Adspert算法对比

| 维度 | Adspert | 我们的算法 | 优势说明 |
|-----|---------|-----------|---------|
| **市场曲线** | 对数函数建模 | 对数函数+分段线性 | 更好处理极端情况 |
| **边际分析** | 基础边际计算 | 边际分析+置信区间 | 考虑不确定性 |
| **决策树** | 固定规则 | 动态决策树+贝叶斯 | 适应数据稀疏 |
| **预算分配** | 边际ROAS均衡 | 边际ROAS+约束优化 | 考虑预算约束 |
| **SB视频** | 通用品牌逻辑 | 搜索核心+视频指标 | 针对性优化 |
| **SD归因** | 点击归因 | 点击+浏览加权归因 | 更全面评估 |

### 与行业常规做法对比

| 维度 | 行业常规 | 我们的算法 | 优势说明 |
|-----|---------|-----------|---------|
| **高ACoS处理** | RPC × Target ACoS | 市场曲线+边际分析 | 考虑市场竞争 |
| **低ACoS处理** | 固定+5-10% | 决策树动态调整 | 更灵活 |
| **无转化处理** | Anticipated RPC | 贝叶斯先验+决策树 | 考虑不确定性 |
| **新客户价值** | 忽略 | LTV调整ACoS | 长期价值 |

### 安全边界设置

| 边界类型 | 默认值 | 说明 |
|---------|-------|------|
| 最低竞价 | $0.10 | 防止竞价过低失去曝光 |
| 最高竞价 | $10.00 | 防止竞价失控 |
| 单次调整上限 | ±50% | 防止剧烈波动 |
| 学习期 | 7-14天 | 新广告不做大幅调整 |
| 人工审核阈值 | ±30% | 超过需人工确认 |

---

## References

1. Amazon Advertising - Sponsored Brands Complete Guide
2. Amazon Advertising - Cost per 1000 viewable impressions (vCPM)
3. Amazon Advertising API Documentation
4. Perpetua - Amazon Sponsored Brands Ultimate Guide
5. Perpetua - Multi-ASIN Sponsored Brands Video Ads
6. AdLabs - Amazon PPC Bid Optimization Formulas
7. Adspert - PPC AI Algorithm Documentation
