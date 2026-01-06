# Adspert 核心算法实现方案

本文档详细描述如何将Adspert的三大核心算法（市场曲线、决策树、展示位置竞价调整）实现到Amazon Ads Optimizer系统中。

---

## 一、算法架构概述

Adspert的核心竞争力在于其三大算法的协同工作，实现在**竞价对象层面**（关键词、ASIN、受众）的精确利润优化。

### 1.1 算法协同关系

```
┌─────────────────────────────────────────────────────────────────┐
│                        输入层                                    │
│  用户目标 + Amazon数据 + 历史数据 + 产品信息                      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      市场曲线建模                                │
│  • 展现曲线 (Impressions vs CPC)                                │
│  • 点击率曲线 (CTR vs Position)                                 │
│  • 支出曲线 (Spend vs CPC)                                      │
│  • 利润曲线 (Profit vs CPC)                                     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        决策树预测                                │
│  • 预测转化率 (CR)                                              │
│  • 预测转化价值 (CV)                                            │
│  • 解决长尾关键词数据稀疏问题                                    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    展示位置竞价调整                              │
│  • 在竞价对象层面设置精确基础出价                                │
│  • 设置较低的位置调整比例                                        │
│  • 计算各位置的广告利润                                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        输出层                                    │
│  最优CPC出价 + 展示位置调整 + 预算分配建议                        │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 核心公式

**广告利润公式**（Adspert的核心优化目标）：

```
广告利润 = 收入 - 广告支出
        = Clicks × CVR × AOV - Clicks × CPC
        = Clicks × (CVR × AOV - CPC)
```

其中：
- **Clicks**: 点击数
- **CVR**: 转化率 (Conversion Rate)
- **AOV**: 平均订单价值 (Average Order Value)
- **CPC**: 每次点击成本 (Cost Per Click)

---

## 二、市场曲线算法实现

### 2.1 数据结构设计

```typescript
// 市场曲线模型
interface MarketCurveModel {
  keywordId: string;
  campaignId: string;
  
  // 曲线参数
  curves: {
    // 展现曲线: Impressions = a × ln(CPC + b) + c
    impression: {
      a: number;  // 对数系数
      b: number;  // 偏移量
      c: number;  // 基础展现
      r2: number; // 拟合优度
    };
    
    // 点击率曲线: CTR = baseCTR × (1 + positionBonus × positionScore)
    ctr: {
      baseCTR: number;
      positionBonus: number;
      topOfSearchBonus: number;
    };
    
    // 转化参数
    conversion: {
      cvr: number;           // 转化率
      aov: number;           // 平均订单价值
      conversionDelay: number; // 归因延迟(天)
    };
  };
  
  // 计算结果
  optimalBid: number;
  maxProfit: number;
  profitMargin: number;
  
  // 元数据
  dataPoints: number;      // 数据点数量
  confidence: number;      // 置信度
  lastUpdated: Date;
}
```

### 2.2 市场曲线建模算法

```typescript
/**
 * 市场曲线建模服务
 * 基于历史数据建立CPC与各指标的函数关系
 */
export class MarketCurveService {
  
  /**
   * 构建展现曲线
   * 使用对数回归: Impressions = a × ln(CPC + b) + c
   */
  buildImpressionCurve(dataPoints: BidPerformanceData[]): ImpressionCurve {
    // 数据预处理
    const validPoints = dataPoints.filter(p => p.impressions > 0 && p.cpc > 0);
    
    if (validPoints.length < 10) {
      // 数据不足，使用默认曲线
      return this.getDefaultImpressionCurve();
    }
    
    // 对数回归拟合
    // y = a × ln(x + b) + c
    // 使用最小二乘法求解参数
    const result = this.logarithmicRegression(
      validPoints.map(p => p.cpc),
      validPoints.map(p => p.impressions)
    );
    
    return {
      a: result.a,
      b: result.b,
      c: result.c,
      r2: result.r2
    };
  }
  
  /**
   * 计算利润最大化出价
   * Profit(CPC) = Clicks(CPC) × (CVR × AOV - CPC)
   * 
   * 对CPC求导并令其为0，找到最优点
   */
  calculateOptimalBid(model: MarketCurveModel): OptimalBidResult {
    const { curves } = model;
    const { cvr, aov } = curves.conversion;
    
    // 利润函数: P(cpc) = I(cpc) × CTR × (CVR × AOV - cpc)
    // 其中 I(cpc) = a × ln(cpc + b) + c
    
    // 数值方法求解最优CPC
    // 在合理范围内搜索利润最大化点
    const minCPC = 0.01;
    const maxCPC = cvr * aov * 2; // 最大不超过预期收入的2倍
    const step = 0.01;
    
    let optimalCPC = minCPC;
    let maxProfit = -Infinity;
    
    for (let cpc = minCPC; cpc <= maxCPC; cpc += step) {
      const impressions = this.calculateImpressions(cpc, curves.impression);
      const ctr = this.calculateCTR(cpc, curves.ctr);
      const clicks = impressions * ctr;
      const profit = clicks * (cvr * aov - cpc);
      
      if (profit > maxProfit) {
        maxProfit = profit;
        optimalCPC = cpc;
      }
    }
    
    // 使用黄金分割法精确搜索
    optimalCPC = this.goldenSectionSearch(
      (cpc) => this.calculateProfit(cpc, curves),
      optimalCPC - step,
      optimalCPC + step
    );
    
    return {
      optimalBid: optimalCPC,
      maxProfit: this.calculateProfit(optimalCPC, curves),
      profitMargin: (cvr * aov - optimalCPC) / (cvr * aov),
      breakEvenCPC: cvr * aov
    };
  }
  
  /**
   * 计算利润
   */
  private calculateProfit(cpc: number, curves: MarketCurveModel['curves']): number {
    const impressions = this.calculateImpressions(cpc, curves.impression);
    const ctr = this.calculateCTR(cpc, curves.ctr);
    const clicks = impressions * ctr;
    const { cvr, aov } = curves.conversion;
    
    return clicks * (cvr * aov - cpc);
  }
  
  /**
   * 黄金分割搜索最优点
   */
  private goldenSectionSearch(
    f: (x: number) => number,
    a: number,
    b: number,
    tolerance: number = 0.001
  ): number {
    const phi = (1 + Math.sqrt(5)) / 2;
    const resphi = 2 - phi;
    
    let x1 = a + resphi * (b - a);
    let x2 = b - resphi * (b - a);
    let f1 = f(x1);
    let f2 = f(x2);
    
    while (Math.abs(b - a) > tolerance) {
      if (f1 > f2) {
        b = x2;
        x2 = x1;
        f2 = f1;
        x1 = a + resphi * (b - a);
        f1 = f(x1);
      } else {
        a = x1;
        x1 = x2;
        f1 = f2;
        x2 = b - resphi * (b - a);
        f2 = f(x2);
      }
    }
    
    return (a + b) / 2;
  }
}
```

### 2.3 预算分配优化

```typescript
/**
 * 最佳预算分配
 * 基于各关键词的边际利润贡献分配预算
 */
export function optimizeBudgetAllocation(
  keywords: KeywordWithMarketCurve[],
  totalBudget: number
): BudgetAllocation[] {
  // 计算每个关键词在最优出价点的边际利润
  const marginalProfits = keywords.map(kw => ({
    keywordId: kw.id,
    optimalBid: kw.marketCurve.optimalBid,
    marginalProfit: calculateMarginalProfit(kw.marketCurve),
    expectedClicks: calculateExpectedClicks(kw.marketCurve, kw.marketCurve.optimalBid)
  }));
  
  // 按边际利润排序
  marginalProfits.sort((a, b) => b.marginalProfit - a.marginalProfit);
  
  // 贪心分配预算
  const allocations: BudgetAllocation[] = [];
  let remainingBudget = totalBudget;
  
  for (const kw of marginalProfits) {
    if (remainingBudget <= 0) break;
    
    const requiredBudget = kw.optimalBid * kw.expectedClicks;
    const allocatedBudget = Math.min(requiredBudget, remainingBudget);
    
    allocations.push({
      keywordId: kw.keywordId,
      allocatedBudget,
      expectedProfit: kw.marginalProfit * (allocatedBudget / requiredBudget),
      bidAmount: kw.optimalBid
    });
    
    remainingBudget -= allocatedBudget;
  }
  
  return allocations;
}
```

---

## 三、决策树预测算法实现

### 3.1 数据结构设计

```typescript
// 决策树节点
interface DecisionTreeNode {
  id: string;
  
  // 分叉条件（非叶节点）
  splitFeature?: string;  // 分叉特征
  splitValue?: any;       // 分叉阈值
  splitType?: 'numeric' | 'categorical';
  
  // 子节点
  left?: DecisionTreeNode;   // 小于等于阈值
  right?: DecisionTreeNode;  // 大于阈值
  children?: Map<string, DecisionTreeNode>; // 分类特征的子节点
  
  // 叶节点数据
  isLeaf: boolean;
  prediction?: {
    cr: number;           // 预测转化率
    cv: number;           // 预测转化价值
    crStdDev: number;     // 转化率标准差
    cvStdDev: number;     // 转化价值标准差
  };
  
  // 统计信息
  sampleCount: number;
  impurity: number;  // 不纯度（用于剪枝）
}

// 关键词特征
interface KeywordFeatures {
  // 广告信息
  matchType: 'broad' | 'phrase' | 'exact';
  wordCount: number;           // 关键词字数
  keywordType: 'brand' | 'competitor' | 'generic' | 'product';
  
  // 活动信息
  campaignType: 'sp_auto' | 'sp_manual' | 'sb' | 'sd';
  adGroupName: string;
  
  // 产品信息
  productCategory: string;
  productBrand: string;
  productPrice: number;
  productRating: number;
  
  // 历史表现（如果有）
  historicalCR?: number;
  historicalCV?: number;
  impressions?: number;
  clicks?: number;
}
```

### 3.2 决策树构建算法

```typescript
/**
 * 决策树构建服务
 * 使用CART算法构建回归树
 */
export class DecisionTreeBuilder {
  
  private minSamplesLeaf = 20;      // 叶节点最小样本数
  private maxDepth = 10;            // 最大深度
  private minImpurityDecrease = 0.01; // 最小不纯度降低
  
  /**
   * 构建决策树
   */
  buildTree(
    data: KeywordPerformanceData[],
    features: string[],
    targetCR: string = 'conversionRate',
    targetCV: string = 'conversionValue'
  ): DecisionTreeNode {
    return this.buildNode(data, features, 0);
  }
  
  private buildNode(
    data: KeywordPerformanceData[],
    features: string[],
    depth: number
  ): DecisionTreeNode {
    // 停止条件
    if (
      data.length < this.minSamplesLeaf * 2 ||
      depth >= this.maxDepth ||
      this.calculateImpurity(data) < this.minImpurityDecrease
    ) {
      return this.createLeafNode(data);
    }
    
    // 找最佳分叉点
    const bestSplit = this.findBestSplit(data, features);
    
    if (!bestSplit || bestSplit.gain < this.minImpurityDecrease) {
      return this.createLeafNode(data);
    }
    
    // 分割数据
    const { leftData, rightData } = this.splitData(data, bestSplit);
    
    // 递归构建子树
    return {
      id: generateId(),
      splitFeature: bestSplit.feature,
      splitValue: bestSplit.value,
      splitType: bestSplit.type,
      left: this.buildNode(leftData, features, depth + 1),
      right: this.buildNode(rightData, features, depth + 1),
      isLeaf: false,
      sampleCount: data.length,
      impurity: this.calculateImpurity(data)
    };
  }
  
  /**
   * 找最佳分叉点
   * 使用方差减少作为分叉标准
   */
  private findBestSplit(
    data: KeywordPerformanceData[],
    features: string[]
  ): BestSplit | null {
    let bestSplit: BestSplit | null = null;
    let bestGain = 0;
    
    const parentImpurity = this.calculateImpurity(data);
    
    for (const feature of features) {
      const featureType = this.getFeatureType(feature);
      
      if (featureType === 'numeric') {
        // 数值特征：尝试不同的分割点
        const values = data.map(d => d[feature]).filter(v => v != null).sort((a, b) => a - b);
        const uniqueValues = [...new Set(values)];
        
        for (let i = 0; i < uniqueValues.length - 1; i++) {
          const threshold = (uniqueValues[i] + uniqueValues[i + 1]) / 2;
          const { leftData, rightData } = this.splitDataNumeric(data, feature, threshold);
          
          if (leftData.length < this.minSamplesLeaf || rightData.length < this.minSamplesLeaf) {
            continue;
          }
          
          const gain = this.calculateInformationGain(parentImpurity, leftData, rightData);
          
          if (gain > bestGain) {
            bestGain = gain;
            bestSplit = { feature, value: threshold, type: 'numeric', gain };
          }
        }
      } else {
        // 分类特征：按类别分割
        const categories = [...new Set(data.map(d => d[feature]))];
        
        for (const category of categories) {
          const { leftData, rightData } = this.splitDataCategorical(data, feature, category);
          
          if (leftData.length < this.minSamplesLeaf || rightData.length < this.minSamplesLeaf) {
            continue;
          }
          
          const gain = this.calculateInformationGain(parentImpurity, leftData, rightData);
          
          if (gain > bestGain) {
            bestGain = gain;
            bestSplit = { feature, value: category, type: 'categorical', gain };
          }
        }
      }
    }
    
    return bestSplit;
  }
  
  /**
   * 计算不纯度（方差）
   * 同时考虑CR和CV的方差
   */
  private calculateImpurity(data: KeywordPerformanceData[]): number {
    if (data.length === 0) return 0;
    
    const crVariance = this.calculateVariance(data.map(d => d.conversionRate));
    const cvVariance = this.calculateVariance(data.map(d => d.conversionValue));
    
    // 归一化后加权平均
    return 0.5 * crVariance + 0.5 * cvVariance;
  }
  
  /**
   * 创建叶节点
   */
  private createLeafNode(data: KeywordPerformanceData[]): DecisionTreeNode {
    const crValues = data.map(d => d.conversionRate);
    const cvValues = data.map(d => d.conversionValue);
    
    return {
      id: generateId(),
      isLeaf: true,
      prediction: {
        cr: this.mean(crValues),
        cv: this.mean(cvValues),
        crStdDev: this.stdDev(crValues),
        cvStdDev: this.stdDev(cvValues)
      },
      sampleCount: data.length,
      impurity: this.calculateImpurity(data)
    };
  }
}
```

### 3.3 决策树预测服务

```typescript
/**
 * 决策树预测服务
 * 用于预测关键词的转化率和转化价值
 */
export class DecisionTreePredictor {
  
  private tree: DecisionTreeNode;
  
  constructor(tree: DecisionTreeNode) {
    this.tree = tree;
  }
  
  /**
   * 预测关键词表现
   */
  predict(features: KeywordFeatures): PredictionResult {
    const leafNode = this.traverse(this.tree, features);
    
    return {
      predictedCR: leafNode.prediction!.cr,
      predictedCV: leafNode.prediction!.cv,
      confidence: this.calculateConfidence(leafNode),
      sampleCount: leafNode.sampleCount,
      crRange: {
        low: leafNode.prediction!.cr - leafNode.prediction!.crStdDev,
        high: leafNode.prediction!.cr + leafNode.prediction!.crStdDev
      },
      cvRange: {
        low: leafNode.prediction!.cv - leafNode.prediction!.cvStdDev,
        high: leafNode.prediction!.cv + leafNode.prediction!.cvStdDev
      }
    };
  }
  
  /**
   * 遍历决策树找到叶节点
   */
  private traverse(node: DecisionTreeNode, features: KeywordFeatures): DecisionTreeNode {
    if (node.isLeaf) {
      return node;
    }
    
    const featureValue = features[node.splitFeature!];
    
    if (node.splitType === 'numeric') {
      if (featureValue <= node.splitValue) {
        return this.traverse(node.left!, features);
      } else {
        return this.traverse(node.right!, features);
      }
    } else {
      // 分类特征
      if (featureValue === node.splitValue) {
        return this.traverse(node.left!, features);
      } else {
        return this.traverse(node.right!, features);
      }
    }
  }
  
  /**
   * 计算预测置信度
   * 基于样本数量和标准差
   */
  private calculateConfidence(node: DecisionTreeNode): number {
    const sampleFactor = Math.min(node.sampleCount / 100, 1);
    const varianceFactor = 1 - Math.min(
      (node.prediction!.crStdDev / node.prediction!.cr) * 0.5 +
      (node.prediction!.cvStdDev / node.prediction!.cv) * 0.5,
      1
    );
    
    return sampleFactor * 0.5 + varianceFactor * 0.5;
  }
  
  /**
   * 为长尾关键词预测
   * 当关键词自身数据不足时，使用决策树预测
   */
  predictForLongTailKeyword(
    keyword: KeywordWithHistory,
    minDataThreshold: number = 50
  ): PredictionResult {
    // 如果关键词有足够的历史数据，使用实际数据
    if (keyword.clicks >= minDataThreshold && keyword.conversions >= 5) {
      return {
        predictedCR: keyword.conversions / keyword.clicks,
        predictedCV: keyword.revenue / keyword.conversions,
        confidence: 0.9,
        sampleCount: keyword.clicks,
        source: 'historical'
      };
    }
    
    // 否则使用决策树预测
    const features = this.extractFeatures(keyword);
    const prediction = this.predict(features);
    
    // 如果有部分历史数据，进行贝叶斯更新
    if (keyword.clicks > 0) {
      return this.bayesianUpdate(prediction, keyword);
    }
    
    return {
      ...prediction,
      source: 'decision_tree'
    };
  }
  
  /**
   * 贝叶斯更新
   * 结合决策树预测和实际观测数据
   */
  private bayesianUpdate(
    prior: PredictionResult,
    observed: KeywordWithHistory
  ): PredictionResult {
    // 先验权重基于决策树的样本数
    const priorWeight = prior.sampleCount / (prior.sampleCount + observed.clicks);
    const observedWeight = 1 - priorWeight;
    
    const observedCR = observed.conversions / Math.max(observed.clicks, 1);
    const observedCV = observed.revenue / Math.max(observed.conversions, 1);
    
    return {
      predictedCR: prior.predictedCR * priorWeight + observedCR * observedWeight,
      predictedCV: prior.predictedCV * priorWeight + observedCV * observedWeight,
      confidence: Math.min(prior.confidence + observedWeight * 0.3, 0.95),
      sampleCount: prior.sampleCount + observed.clicks,
      source: 'bayesian_update'
    };
  }
}
```

---

## 四、展示位置竞价调整实现

### 4.1 Adspert的核心策略

根据Adspert PPT的关键洞察：

> "由于Adspert在**竞价对象层面**上设置出价，并在**竞价对象层面**上估算广告利润（收入 - 广告支出），我们将为亚马逊设置**较低的展示位置竞价调整**，以便**更细致地**进行针对竞价对象出价。"

### 4.2 实现策略

```typescript
/**
 * 展示位置竞价调整服务
 * 实现Adspert的精细化竞价策略
 */
export class PlacementBidAdjustmentService {
  
  /**
   * 计算展示位置调整
   * 核心策略：设置较低的位置调整，让基础出价更精确地控制竞价
   */
  calculatePlacementAdjustments(
    keywordPerformance: KeywordPlacementPerformance,
    optimizationGoal: 'profit' | 'revenue' | 'acos'
  ): PlacementAdjustments {
    const { topOfSearch, productPages, restOfSearch } = keywordPerformance;
    
    // 计算各位置的效率指标
    const topEfficiency = this.calculatePlacementEfficiency(topOfSearch, optimizationGoal);
    const productEfficiency = this.calculatePlacementEfficiency(productPages, optimizationGoal);
    const restEfficiency = this.calculatePlacementEfficiency(restOfSearch, optimizationGoal);
    
    // 找到基准位置（效率最高的位置）
    const maxEfficiency = Math.max(topEfficiency, productEfficiency, restEfficiency);
    
    // 计算相对调整比例
    // Adspert策略：设置较低的调整值（0-50%范围内）
    const adjustments = {
      topOfSearch: this.calculateRelativeAdjustment(topEfficiency, maxEfficiency),
      productPages: this.calculateRelativeAdjustment(productEfficiency, maxEfficiency),
      restOfSearch: 0  // 基准位置，不调整
    };
    
    // 限制调整范围
    return {
      topOfSearch: Math.min(Math.max(adjustments.topOfSearch, -50), 50),
      productPages: Math.min(Math.max(adjustments.productPages, -50), 50),
      restOfSearch: 0
    };
  }
  
  /**
   * 计算位置效率
   * 效率 = 广告利润 / 广告支出
   */
  private calculatePlacementEfficiency(
    metrics: PlacementMetrics,
    goal: 'profit' | 'revenue' | 'acos'
  ): number {
    if (metrics.spend === 0) return 0;
    
    switch (goal) {
      case 'profit':
        // 利润效率 = (收入 - 支出) / 支出
        return (metrics.revenue - metrics.spend) / metrics.spend;
        
      case 'revenue':
        // 收入效率 = 收入 / 支出 (ROAS)
        return metrics.revenue / metrics.spend;
        
      case 'acos':
        // ACoS效率 = 1 / ACoS (越低越好，所以取倒数)
        const acos = metrics.spend / Math.max(metrics.revenue, 0.01);
        return 1 / acos;
    }
  }
  
  /**
   * 计算相对调整比例
   * 基于效率差异计算调整百分比
   */
  private calculateRelativeAdjustment(
    efficiency: number,
    baseEfficiency: number
  ): number {
    if (baseEfficiency === 0) return 0;
    
    // 效率差异比例
    const efficiencyRatio = efficiency / baseEfficiency;
    
    // 转换为调整百分比
    // 效率比为1时，调整为0%
    // 效率比为1.5时，调整为+25%
    // 效率比为0.5时，调整为-25%
    return (efficiencyRatio - 1) * 50;
  }
  
  /**
   * 在竞价对象层面估算广告利润
   */
  estimateBidObjectProfit(
    bidObject: BidObject,
    baseBid: number,
    placementAdjustments: PlacementAdjustments
  ): BidObjectProfitEstimate {
    const placements = ['topOfSearch', 'productPages', 'restOfSearch'] as const;
    
    let totalProfit = 0;
    let totalSpend = 0;
    let totalRevenue = 0;
    
    const placementEstimates: PlacementProfitEstimate[] = [];
    
    for (const placement of placements) {
      const adjustment = placementAdjustments[placement];
      const effectiveBid = baseBid * (1 + adjustment / 100);
      
      // 预测该位置的表现
      const predicted = this.predictPlacementPerformance(
        bidObject,
        placement,
        effectiveBid
      );
      
      const spend = predicted.clicks * effectiveBid;
      const revenue = predicted.clicks * predicted.cvr * predicted.aov;
      const profit = revenue - spend;
      
      placementEstimates.push({
        placement,
        effectiveBid,
        predictedClicks: predicted.clicks,
        predictedCVR: predicted.cvr,
        predictedAOV: predicted.aov,
        estimatedSpend: spend,
        estimatedRevenue: revenue,
        estimatedProfit: profit
      });
      
      totalSpend += spend;
      totalRevenue += revenue;
      totalProfit += profit;
    }
    
    return {
      bidObjectId: bidObject.id,
      baseBid,
      placementAdjustments,
      placementEstimates,
      totalEstimatedSpend: totalSpend,
      totalEstimatedRevenue: totalRevenue,
      totalEstimatedProfit: totalProfit,
      estimatedROAS: totalRevenue / Math.max(totalSpend, 0.01),
      estimatedACoS: totalSpend / Math.max(totalRevenue, 0.01)
    };
  }
  
  /**
   * 优化展示位置调整以最大化利润
   */
  optimizePlacementAdjustments(
    bidObject: BidObject,
    baseBid: number,
    constraints: OptimizationConstraints
  ): OptimizedPlacementResult {
    // 使用网格搜索找到最优调整组合
    const adjustmentRange = [-50, -40, -30, -20, -10, 0, 10, 20, 30, 40, 50];
    
    let bestResult: BidObjectProfitEstimate | null = null;
    let bestProfit = -Infinity;
    
    for (const topAdj of adjustmentRange) {
      for (const productAdj of adjustmentRange) {
        const adjustments: PlacementAdjustments = {
          topOfSearch: topAdj,
          productPages: productAdj,
          restOfSearch: 0
        };
        
        const estimate = this.estimateBidObjectProfit(bidObject, baseBid, adjustments);
        
        // 检查约束条件
        if (this.meetsConstraints(estimate, constraints)) {
          if (estimate.totalEstimatedProfit > bestProfit) {
            bestProfit = estimate.totalEstimatedProfit;
            bestResult = estimate;
          }
        }
      }
    }
    
    return {
      optimizedAdjustments: bestResult?.placementAdjustments || { topOfSearch: 0, productPages: 0, restOfSearch: 0 },
      profitEstimate: bestResult,
      improvementOverBaseline: bestResult 
        ? (bestProfit - this.calculateBaselineProfit(bidObject, baseBid)) / Math.abs(this.calculateBaselineProfit(bidObject, baseBid))
        : 0
    };
  }
}
```

### 4.3 整合三大算法

```typescript
/**
 * Adspert风格的综合优化服务
 * 整合市场曲线、决策树和展示位置调整
 */
export class AdspertStyleOptimizer {
  
  private marketCurveService: MarketCurveService;
  private decisionTreePredictor: DecisionTreePredictor;
  private placementService: PlacementBidAdjustmentService;
  
  /**
   * 为竞价对象计算最优出价策略
   */
  async optimizeBidObject(
    bidObject: BidObject,
    historicalData: BidObjectHistory,
    optimizationGoal: OptimizationGoal
  ): Promise<OptimizedBidStrategy> {
    
    // 1. 使用决策树预测转化参数（特别是长尾关键词）
    const prediction = this.decisionTreePredictor.predictForLongTailKeyword({
      ...bidObject,
      clicks: historicalData.totalClicks,
      conversions: historicalData.totalConversions,
      revenue: historicalData.totalRevenue
    });
    
    // 2. 构建市场曲线模型
    const marketCurve = await this.marketCurveService.buildMarketCurve(
      bidObject.id,
      historicalData.bidPerformanceData,
      {
        cvr: prediction.predictedCR,
        aov: prediction.predictedCV,
        conversionDelay: 7 // 默认7天归因窗口
      }
    );
    
    // 3. 计算利润最大化基础出价
    const optimalBidResult = this.marketCurveService.calculateOptimalBid(marketCurve);
    
    // 4. 计算展示位置调整
    const placementAdjustments = this.placementService.calculatePlacementAdjustments(
      historicalData.placementPerformance,
      optimizationGoal.type === 'profit' ? 'profit' : 
      optimizationGoal.type === 'revenue' ? 'revenue' : 'acos'
    );
    
    // 5. 优化展示位置调整以最大化利润
    const optimizedPlacements = this.placementService.optimizePlacementAdjustments(
      bidObject,
      optimalBidResult.optimalBid,
      {
        maxACoS: optimizationGoal.targetACoS,
        minROAS: optimizationGoal.targetROAS,
        maxSpend: optimizationGoal.dailyBudget
      }
    );
    
    // 6. 估算最终利润
    const profitEstimate = this.placementService.estimateBidObjectProfit(
      bidObject,
      optimalBidResult.optimalBid,
      optimizedPlacements.optimizedAdjustments
    );
    
    return {
      bidObjectId: bidObject.id,
      
      // 基础出价（在竞价对象层面精确设置）
      recommendedBaseBid: optimalBidResult.optimalBid,
      
      // 展示位置调整（设置较低值以保持精确控制）
      placementAdjustments: optimizedPlacements.optimizedAdjustments,
      
      // 预测指标
      predictions: {
        cr: prediction.predictedCR,
        cv: prediction.predictedCV,
        confidence: prediction.confidence
      },
      
      // 利润估算
      profitEstimate: {
        estimatedProfit: profitEstimate.totalEstimatedProfit,
        estimatedRevenue: profitEstimate.totalEstimatedRevenue,
        estimatedSpend: profitEstimate.totalEstimatedSpend,
        estimatedROAS: profitEstimate.estimatedROAS,
        estimatedACoS: profitEstimate.estimatedACoS
      },
      
      // 优化建议
      recommendations: this.generateRecommendations(
        bidObject,
        optimalBidResult,
        optimizedPlacements,
        prediction
      )
    };
  }
  
  /**
   * 生成优化建议
   */
  private generateRecommendations(
    bidObject: BidObject,
    optimalBid: OptimalBidResult,
    placements: OptimizedPlacementResult,
    prediction: PredictionResult
  ): OptimizationRecommendation[] {
    const recommendations: OptimizationRecommendation[] = [];
    
    // 出价调整建议
    if (Math.abs(optimalBid.optimalBid - bidObject.currentBid) / bidObject.currentBid > 0.1) {
      recommendations.push({
        type: 'bid_adjustment',
        priority: 'high',
        description: `建议将基础出价从 $${bidObject.currentBid.toFixed(2)} 调整为 $${optimalBid.optimalBid.toFixed(2)}`,
        expectedImpact: `预计利润提升 ${((optimalBid.maxProfit - bidObject.currentProfit) / Math.abs(bidObject.currentProfit) * 100).toFixed(1)}%`,
        action: {
          field: 'baseBid',
          currentValue: bidObject.currentBid,
          recommendedValue: optimalBid.optimalBid
        }
      });
    }
    
    // 展示位置调整建议
    if (placements.improvementOverBaseline > 0.05) {
      recommendations.push({
        type: 'placement_adjustment',
        priority: 'medium',
        description: `优化展示位置调整可提升利润`,
        expectedImpact: `预计利润提升 ${(placements.improvementOverBaseline * 100).toFixed(1)}%`,
        action: {
          field: 'placementAdjustments',
          currentValue: bidObject.currentPlacementAdjustments,
          recommendedValue: placements.optimizedAdjustments
        }
      });
    }
    
    // 数据置信度建议
    if (prediction.confidence < 0.7) {
      recommendations.push({
        type: 'data_collection',
        priority: 'low',
        description: `当前预测置信度较低 (${(prediction.confidence * 100).toFixed(0)}%)，建议收集更多数据`,
        expectedImpact: '提高预测准确性',
        action: {
          field: 'monitoring',
          recommendedDuration: '2-4周'
        }
      });
    }
    
    return recommendations;
  }
}
```

---

## 五、数据库表结构设计

### 5.1 市场曲线模型表

```sql
CREATE TABLE market_curve_models (
  id VARCHAR(36) PRIMARY KEY,
  account_id VARCHAR(36) NOT NULL,
  bid_object_type ENUM('keyword', 'asin', 'audience') NOT NULL,
  bid_object_id VARCHAR(36) NOT NULL,
  
  -- 展现曲线参数
  impression_curve_a DECIMAL(10, 6),
  impression_curve_b DECIMAL(10, 6),
  impression_curve_c DECIMAL(10, 6),
  impression_curve_r2 DECIMAL(5, 4),
  
  -- 点击率曲线参数
  ctr_base DECIMAL(8, 6),
  ctr_position_bonus DECIMAL(8, 6),
  ctr_top_search_bonus DECIMAL(8, 6),
  
  -- 转化参数
  cvr DECIMAL(8, 6),
  aov DECIMAL(12, 2),
  conversion_delay_days INT DEFAULT 7,
  
  -- 计算结果
  optimal_bid DECIMAL(10, 4),
  max_profit DECIMAL(12, 2),
  profit_margin DECIMAL(5, 4),
  break_even_cpc DECIMAL(10, 4),
  
  -- 元数据
  data_points INT,
  confidence DECIMAL(5, 4),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  INDEX idx_account_object (account_id, bid_object_type, bid_object_id),
  INDEX idx_updated (updated_at)
);
```

### 5.2 决策树模型表

```sql
CREATE TABLE decision_tree_models (
  id VARCHAR(36) PRIMARY KEY,
  account_id VARCHAR(36) NOT NULL,
  model_type ENUM('cr_prediction', 'cv_prediction') NOT NULL,
  
  -- 模型数据（JSON格式存储树结构）
  tree_structure JSON NOT NULL,
  
  -- 模型统计
  total_samples INT,
  tree_depth INT,
  leaf_count INT,
  avg_leaf_samples DECIMAL(10, 2),
  
  -- 性能指标
  training_r2 DECIMAL(5, 4),
  validation_r2 DECIMAL(5, 4),
  mean_absolute_error DECIMAL(10, 6),
  
  -- 元数据
  feature_importance JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  INDEX idx_account_type (account_id, model_type)
);
```

### 5.3 展示位置表现表

```sql
CREATE TABLE placement_performance (
  id VARCHAR(36) PRIMARY KEY,
  account_id VARCHAR(36) NOT NULL,
  campaign_id VARCHAR(36) NOT NULL,
  bid_object_type ENUM('keyword', 'asin') NOT NULL,
  bid_object_id VARCHAR(36) NOT NULL,
  placement ENUM('top_of_search', 'product_pages', 'rest_of_search') NOT NULL,
  date DATE NOT NULL,
  
  -- 表现指标
  impressions INT DEFAULT 0,
  clicks INT DEFAULT 0,
  spend DECIMAL(12, 4) DEFAULT 0,
  sales DECIMAL(12, 2) DEFAULT 0,
  orders INT DEFAULT 0,
  
  -- 计算指标
  ctr DECIMAL(8, 6),
  cvr DECIMAL(8, 6),
  acos DECIMAL(8, 6),
  roas DECIMAL(10, 4),
  cpc DECIMAL(10, 4),
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE INDEX idx_unique_record (account_id, campaign_id, bid_object_id, placement, date),
  INDEX idx_date (date),
  INDEX idx_campaign (campaign_id)
);
```

### 5.4 优化建议历史表

```sql
CREATE TABLE optimization_recommendations (
  id VARCHAR(36) PRIMARY KEY,
  account_id VARCHAR(36) NOT NULL,
  bid_object_type ENUM('keyword', 'asin', 'audience') NOT NULL,
  bid_object_id VARCHAR(36) NOT NULL,
  
  -- 建议内容
  recommendation_type ENUM('bid_adjustment', 'placement_adjustment', 'data_collection') NOT NULL,
  priority ENUM('high', 'medium', 'low') NOT NULL,
  description TEXT,
  expected_impact TEXT,
  
  -- 建议值
  current_value JSON,
  recommended_value JSON,
  
  -- 状态
  status ENUM('pending', 'applied', 'rejected', 'expired') DEFAULT 'pending',
  applied_at TIMESTAMP NULL,
  applied_by VARCHAR(36) NULL,
  
  -- 效果追踪
  actual_impact JSON,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP,
  
  INDEX idx_account_status (account_id, status),
  INDEX idx_object (bid_object_type, bid_object_id)
);
```

---

## 六、实施计划

### 第一阶段：基础设施（1-2周）
1. 创建数据库表结构
2. 实现数据采集服务（展示位置表现数据）
3. 实现基础的市场曲线建模

### 第二阶段：核心算法（2-3周）
1. 实现完整的市场曲线服务
2. 实现决策树构建和预测服务
3. 实现展示位置竞价调整服务

### 第三阶段：整合优化（1-2周）
1. 整合三大算法
2. 实现综合优化服务
3. 实现优化建议生成

### 第四阶段：前端界面（1-2周）
1. 创建市场曲线可视化组件
2. 创建决策树可视化组件
3. 创建优化建议展示界面

### 第五阶段：测试与优化（1周）
1. 编写单元测试
2. 进行性能优化
3. 文档完善

---

## 七、总结

本实现方案基于Adspert的核心算法原理，将三大算法（市场曲线、决策树、展示位置竞价调整）整合为一个完整的广告优化系统。关键特点包括：

1. **竞价对象层面的精确优化**：在关键词/ASIN层面设置精确的基础出价
2. **较低的展示位置调整**：保持精确控制，避免调整比例过高稀释基础出价的效果
3. **决策树预测**：解决长尾关键词数据稀疏问题
4. **利润最大化**：以广告利润（收入-支出）为核心优化目标

通过这套算法体系，可以实现类似Adspert的智能广告优化效果。
