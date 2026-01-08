# Amazon广告优化算法完整复盘与特殊场景分析

## 一、已覆盖的算法场景总览

### 1.1 核心算法模块

| 模块 | 子模块 | 状态 | 文档位置 |
|-----|-------|:----:|---------|
| **竞价优化** | 市场曲线建模 | ✅ | comprehensive-optimization-algorithm-design.md |
| | 边际分析算法 | ✅ | comprehensive-optimization-algorithm-design.md |
| | 决策树竞价调整 | ✅ | comprehensive-optimization-algorithm-design.md |
| | 分时竞价(Dayparting) | ✅ | channel-optimization-feature-matrix.md |
| | 位置竞价调整 | ✅ | amazon-ads-feature-support-matrix.md |
| **搜索词分析** | 双层N-Gram分析 | ✅ | dual-layer-ngram-algorithm.md |
| | 搜索词智能分类 | ✅ | algorithm-features-and-analysis.md |
| | 搜索词来源聚合 | ✅ | negative-targeting-support-matrix.md |
| **否定词管理** | 全局否定同步 | ✅ | negative-targeting-support-matrix.md |
| | 否定能力矩阵 | ✅ | negative-targeting-support-matrix.md |
| **预算分配** | 跨渠道预算分配 | ✅ | product-centric-global-optimization.md |
| | 分时预算规则 | ✅ | amazon-ads-feature-support-matrix.md |
| **特殊场景** | 新品推广期优化 | ✅ | new-product-launch-optimization.md |
| | 新广告活动冷启动 | ✅ | new-campaign-cold-start-optimization.md |
| | 学习期保护机制 | ✅ | new-campaign-cold-start-optimization.md |

### 1.2 广告类型覆盖

| 广告类型 | 竞价优化 | 搜索词分析 | 否定管理 | 位置调整 | 分时调整 |
|---------|:-------:|:---------:|:-------:|:-------:|:-------:|
| SP自动广告 | ✅ | ✅ | ✅ | ✅ | ✅ |
| SP手动-关键词 | ✅ | ✅ | ✅ | ✅ | ✅ |
| SP手动-商品定向 | ✅ | ✅ | ✅(ASIN) | ✅ | ✅ |
| SB商品集合 | ✅ | ✅ | ✅ | ⚠️ | ✅ |
| SB旗舰店聚焦 | ✅ | ✅ | ✅ | ⚠️ | ✅ |
| SB视频-单品 | ✅ | ✅ | ✅ | ⚠️ | ✅ |
| SB视频-多ASIN | ✅ | ✅ | ✅ | ⚠️ | ✅ |
| SD受众定向 | ✅ | ❌ | ❌ | ❌ | ✅ |
| SD商品定向 | ✅ | ❌ | ✅(ASIN) | ❌ | ✅ |

---

## 二、尚未充分覆盖的特殊场景

经过全面复盘，以下是尚未充分考虑或需要补充的特殊场景：

### 2.1 预算耗尽场景

**问题描述**：当广告活动预算在一天内提前耗尽时，会导致：
- 后续时段无法获得曝光
- 可能错过高转化时段
- 数据分析出现偏差（只有部分时段数据）

**需要补充的算法**：

```typescript
interface BudgetDepletionAnalysis {
  // 预算耗尽检测
  isDepletedEarly: boolean;
  depletionTime: string;  // 耗尽时间点
  missedImpressions: number;  // 估计错过的曝光
  missedConversions: number;  // 估计错过的转化
  
  // 建议
  recommendations: {
    increaseBudget: boolean;
    suggestedBudget: number;
    adjustDayparting: boolean;
    reduceBids: boolean;
  };
}

function analyzeBudgetDepletion(campaign: CampaignData): BudgetDepletionAnalysis {
  // 检测预算是否提前耗尽
  const hourlySpend = campaign.hourlySpendData;
  const depletionHour = findDepletionHour(hourlySpend, campaign.dailyBudget);
  
  if (depletionHour && depletionHour < 20) { // 20:00前耗尽
    // 估算错过的机会
    const avgHourlyPerformance = calculateAvgHourlyPerformance(campaign);
    const missedHours = 24 - depletionHour;
    
    return {
      isDepletedEarly: true,
      depletionTime: `${depletionHour}:00`,
      missedImpressions: avgHourlyPerformance.impressions * missedHours,
      missedConversions: avgHourlyPerformance.conversions * missedHours,
      recommendations: generateBudgetRecommendations(campaign, depletionHour)
    };
  }
  
  return { isDepletedEarly: false, /* ... */ };
}
```

### 2.2 竞价过高导致的预算快速消耗

**问题描述**：竞价设置过高可能导致：
- 预算快速消耗
- CPC远高于必要水平
- 虽然获得曝光但ROI不佳

**需要补充的算法**：

```typescript
interface BidEfficiencyAnalysis {
  // 竞价效率分析
  actualCpc: number;
  suggestedBid: number;
  bidEfficiency: number;  // 实际CPC / 建议竞价
  
  // 过度竞价检测
  isOverbidding: boolean;
  overbidAmount: number;
  potentialSavings: number;
  
  // 建议
  recommendations: string[];
}

function analyzeBidEfficiency(keyword: KeywordData): BidEfficiencyAnalysis {
  const actualCpc = keyword.spend / keyword.clicks;
  const targetCpc = keyword.targetAcos * keyword.cvr * keyword.productPrice;
  
  // 如果实际CPC远高于目标CPC，可能存在过度竞价
  const bidEfficiency = actualCpc / targetCpc;
  
  if (bidEfficiency > 1.5) {
    return {
      actualCpc,
      suggestedBid: targetCpc * 1.1,
      bidEfficiency,
      isOverbidding: true,
      overbidAmount: actualCpc - targetCpc,
      potentialSavings: (actualCpc - targetCpc) * keyword.clicks,
      recommendations: [
        `当前CPC($${actualCpc.toFixed(2)})高于目标CPC($${targetCpc.toFixed(2)})${((bidEfficiency - 1) * 100).toFixed(0)}%`,
        `建议降低竞价至$${(targetCpc * 1.1).toFixed(2)}`,
        `预计可节省$${((actualCpc - targetCpc) * keyword.clicks).toFixed(2)}/周`
      ]
    };
  }
  
  return { isOverbidding: false, /* ... */ };
}
```

### 2.3 季节性和大促场景

**问题描述**：Prime Day、黑五、圣诞等大促期间：
- 竞争加剧，CPC飙升
- 转化率可能提高
- 历史模型可能失效
- 需要提前准备和事后恢复

**需要补充的算法**：

```typescript
interface SeasonalityAdjustment {
  // 季节性检测
  currentPeriod: 'normal' | 'pre_prime' | 'prime_day' | 'pre_bf' | 'black_friday' | 
                 'cyber_monday' | 'pre_christmas' | 'christmas' | 'post_holiday';
  
  // 调整系数
  bidMultiplier: number;
  budgetMultiplier: number;
  acosToleranceMultiplier: number;
  
  // 策略建议
  strategy: SeasonalStrategy;
}

interface SeasonalStrategy {
  phase: 'preparation' | 'execution' | 'recovery';
  actions: string[];
  duration: number;  // 天数
}

function getSeasonalityAdjustment(date: Date): SeasonalityAdjustment {
  const period = detectSeasonalPeriod(date);
  
  const adjustments: Record<string, SeasonalityAdjustment> = {
    'pre_prime': {
      currentPeriod: 'pre_prime',
      bidMultiplier: 1.2,      // 提前提高竞价抢占位置
      budgetMultiplier: 1.5,   // 增加预算
      acosToleranceMultiplier: 1.3,  // 接受更高ACoS
      strategy: {
        phase: 'preparation',
        actions: [
          '提前7天开始提高竞价',
          '增加预算储备',
          '检查库存充足性',
          '暂停低效关键词释放预算'
        ],
        duration: 7
      }
    },
    'prime_day': {
      currentPeriod: 'prime_day',
      bidMultiplier: 1.5,      // 大幅提高竞价
      budgetMultiplier: 3.0,   // 大幅增加预算
      acosToleranceMultiplier: 1.5,  // 接受更高ACoS（转化率也会提高）
      strategy: {
        phase: 'execution',
        actions: [
          '全力投放，最大化曝光',
          '实时监控预算消耗',
          '关注库存状态',
          '暂停算法自动调整，人工监控'
        ],
        duration: 2
      }
    },
    'post_holiday': {
      currentPeriod: 'post_holiday',
      bidMultiplier: 0.8,      // 降低竞价
      budgetMultiplier: 0.7,   // 减少预算
      acosToleranceMultiplier: 0.9,  // 收紧ACoS目标
      strategy: {
        phase: 'recovery',
        actions: [
          '逐步恢复正常竞价',
          '清理大促期间的异常数据',
          '重新评估关键词表现',
          '恢复算法自动优化'
        ],
        duration: 14
      }
    }
    // ... 其他季节
  };
  
  return adjustments[period] || getDefaultAdjustment();
}
```

### 2.4 库存不足/断货场景

**问题描述**：当产品库存不足或断货时：
- 继续投放广告会浪费预算
- 断货会影响Listing权重
- 需要提前预警和自动暂停

**需要补充的算法**：

```typescript
interface InventoryAwareOptimization {
  // 库存状态
  currentStock: number;
  dailySalesVelocity: number;
  daysOfStock: number;
  
  // 风险等级
  riskLevel: 'safe' | 'warning' | 'critical' | 'out_of_stock';
  
  // 广告调整建议
  adAdjustment: {
    shouldReduceAds: boolean;
    bidMultiplier: number;
    budgetMultiplier: number;
    shouldPause: boolean;
  };
}

function analyzeInventoryRisk(product: ProductData): InventoryAwareOptimization {
  const daysOfStock = product.currentStock / product.dailySalesVelocity;
  
  let riskLevel: InventoryAwareOptimization['riskLevel'];
  let adAdjustment: InventoryAwareOptimization['adAdjustment'];
  
  if (product.currentStock === 0) {
    riskLevel = 'out_of_stock';
    adAdjustment = {
      shouldReduceAds: true,
      bidMultiplier: 0,
      budgetMultiplier: 0,
      shouldPause: true  // 立即暂停广告
    };
  } else if (daysOfStock < 7) {
    riskLevel = 'critical';
    adAdjustment = {
      shouldReduceAds: true,
      bidMultiplier: 0.3,  // 大幅降低竞价
      budgetMultiplier: 0.3,
      shouldPause: false
    };
  } else if (daysOfStock < 14) {
    riskLevel = 'warning';
    adAdjustment = {
      shouldReduceAds: true,
      bidMultiplier: 0.7,  // 适度降低竞价
      budgetMultiplier: 0.7,
      shouldPause: false
    };
  } else {
    riskLevel = 'safe';
    adAdjustment = {
      shouldReduceAds: false,
      bidMultiplier: 1.0,
      budgetMultiplier: 1.0,
      shouldPause: false
    };
  }
  
  return {
    currentStock: product.currentStock,
    dailySalesVelocity: product.dailySalesVelocity,
    daysOfStock,
    riskLevel,
    adAdjustment
  };
}
```

### 2.5 竞品价格战场景

**问题描述**：当竞品大幅降价时：
- 自身产品转化率可能下降
- 需要调整广告策略应对
- 可能需要暂时收缩或调整定位

**需要补充的算法**：

```typescript
interface CompetitivePriceAnalysis {
  // 竞品价格监控
  competitorPrices: {
    asin: string;
    currentPrice: number;
    priceChange: number;  // 变化百分比
    priceChangeDate: Date;
  }[];
  
  // 价格竞争力
  priceCompetitiveness: 'leader' | 'competitive' | 'disadvantaged' | 'severely_disadvantaged';
  
  // 广告策略建议
  adStrategy: {
    adjustBids: boolean;
    bidMultiplier: number;
    focusOnValueProps: boolean;  // 是否强调非价格优势
    targetDifferentAudience: boolean;  // 是否调整受众定向
  };
}

function analyzeCompetitivePricing(product: ProductData): CompetitivePriceAnalysis {
  const competitorPrices = await getCompetitorPrices(product.asin);
  const avgCompetitorPrice = calculateAvgPrice(competitorPrices);
  const priceRatio = product.price / avgCompetitorPrice;
  
  let priceCompetitiveness: CompetitivePriceAnalysis['priceCompetitiveness'];
  let adStrategy: CompetitivePriceAnalysis['adStrategy'];
  
  if (priceRatio <= 0.9) {
    priceCompetitiveness = 'leader';
    adStrategy = {
      adjustBids: true,
      bidMultiplier: 1.2,  // 价格优势，可以更积极
      focusOnValueProps: false,
      targetDifferentAudience: false
    };
  } else if (priceRatio <= 1.1) {
    priceCompetitiveness = 'competitive';
    adStrategy = {
      adjustBids: false,
      bidMultiplier: 1.0,
      focusOnValueProps: false,
      targetDifferentAudience: false
    };
  } else if (priceRatio <= 1.3) {
    priceCompetitiveness = 'disadvantaged';
    adStrategy = {
      adjustBids: true,
      bidMultiplier: 0.8,  // 价格劣势，降低竞价
      focusOnValueProps: true,  // 强调品质、服务等非价格优势
      targetDifferentAudience: false
    };
  } else {
    priceCompetitiveness = 'severely_disadvantaged';
    adStrategy = {
      adjustBids: true,
      bidMultiplier: 0.5,  // 大幅降低竞价
      focusOnValueProps: true,
      targetDifferentAudience: true  // 考虑定向不同受众（如品质敏感型）
    };
  }
  
  return {
    competitorPrices,
    priceCompetitiveness,
    adStrategy
  };
}
```

### 2.6 Review/Rating变化场景

**问题描述**：当产品评价发生变化时：
- 差评增加会降低转化率
- 评分下降会影响广告效果
- 需要动态调整广告策略

**需要补充的算法**：

```typescript
interface ReviewImpactAnalysis {
  // 评价状态
  currentRating: number;
  ratingChange: number;  // 近期变化
  recentNegativeReviews: number;
  
  // 转化率影响预估
  estimatedCvrImpact: number;  // 预估转化率变化
  
  // 广告调整建议
  adAdjustment: {
    shouldReduceSpend: boolean;
    bidMultiplier: number;
    focusOnDefense: boolean;  // 是否转向防守策略
  };
}

function analyzeReviewImpact(product: ProductData): ReviewImpactAnalysis {
  const ratingChange = product.currentRating - product.previousRating;
  
  // 评分下降对转化率的影响（经验公式）
  // 每下降0.1星，转化率下降约5%
  const estimatedCvrImpact = ratingChange * 0.5;
  
  let adAdjustment: ReviewImpactAnalysis['adAdjustment'];
  
  if (product.currentRating < 3.5 || ratingChange < -0.3) {
    // 评分过低或大幅下降
    adAdjustment = {
      shouldReduceSpend: true,
      bidMultiplier: 0.5,
      focusOnDefense: true  // 转向防守，减少新客获取
    };
  } else if (product.currentRating < 4.0 || ratingChange < -0.1) {
    // 评分一般或小幅下降
    adAdjustment = {
      shouldReduceSpend: true,
      bidMultiplier: 0.8,
      focusOnDefense: false
    };
  } else {
    // 评分正常
    adAdjustment = {
      shouldReduceSpend: false,
      bidMultiplier: 1.0,
      focusOnDefense: false
    };
  }
  
  return {
    currentRating: product.currentRating,
    ratingChange,
    recentNegativeReviews: product.recentNegativeReviews,
    estimatedCvrImpact,
    adAdjustment
  };
}
```

### 2.7 广告疲劳场景

**问题描述**：长期投放同一广告可能导致：
- CTR逐渐下降（用户审美疲劳）
- 转化率下降
- 需要识别并建议更换创意

**需要补充的算法**：

```typescript
interface AdFatigueAnalysis {
  // 疲劳检测
  adAge: number;  // 广告运行天数
  ctrTrend: 'increasing' | 'stable' | 'declining';
  ctrDeclineRate: number;  // CTR下降速率
  
  // 疲劳程度
  fatigueLevel: 'none' | 'mild' | 'moderate' | 'severe';
  
  // 建议
  recommendations: {
    refreshCreative: boolean;
    testNewHeadline: boolean;
    testNewImage: boolean;
    pauseAndRelaunch: boolean;
  };
}

function analyzeAdFatigue(ad: AdData): AdFatigueAnalysis {
  const adAge = daysSince(ad.createdAt);
  const ctrHistory = ad.weeklyCtrHistory;
  
  // 计算CTR趋势
  const ctrTrend = calculateTrend(ctrHistory);
  const ctrDeclineRate = calculateDeclineRate(ctrHistory);
  
  let fatigueLevel: AdFatigueAnalysis['fatigueLevel'];
  
  if (ctrDeclineRate > 0.3 && adAge > 60) {
    fatigueLevel = 'severe';
  } else if (ctrDeclineRate > 0.2 && adAge > 45) {
    fatigueLevel = 'moderate';
  } else if (ctrDeclineRate > 0.1 && adAge > 30) {
    fatigueLevel = 'mild';
  } else {
    fatigueLevel = 'none';
  }
  
  return {
    adAge,
    ctrTrend,
    ctrDeclineRate,
    fatigueLevel,
    recommendations: {
      refreshCreative: fatigueLevel === 'severe' || fatigueLevel === 'moderate',
      testNewHeadline: fatigueLevel !== 'none',
      testNewImage: fatigueLevel === 'severe',
      pauseAndRelaunch: fatigueLevel === 'severe' && adAge > 90
    }
  };
}
```

### 2.8 多变体产品场景

**问题描述**：同一父ASIN下有多个变体时：
- 各变体可能有不同的表现
- 需要协调各变体的广告投放
- 避免变体之间自我竞争

**需要补充的算法**：

```typescript
interface VariantCoordinationStrategy {
  // 变体分析
  parentAsin: string;
  variants: {
    asin: string;
    price: number;
    rating: number;
    salesRank: number;
    adPerformance: {
      acos: number;
      roas: number;
      cvr: number;
    };
  }[];
  
  // 主推变体识别
  heroVariant: string;
  
  // 协调策略
  strategy: {
    variantBudgetAllocation: Record<string, number>;  // 各变体预算分配
    variantBidMultipliers: Record<string, number>;    // 各变体竞价系数
    crossVariantNegatives: string[];  // 跨变体否定词
  };
}

function coordinateVariantAds(parentAsin: string): VariantCoordinationStrategy {
  const variants = await getVariants(parentAsin);
  
  // 识别主推变体（综合评分最高）
  const heroVariant = identifyHeroVariant(variants);
  
  // 计算各变体的预算分配
  const budgetAllocation = calculateVariantBudgetAllocation(variants, heroVariant);
  
  // 计算各变体的竞价系数
  const bidMultipliers = calculateVariantBidMultipliers(variants, heroVariant);
  
  // 识别跨变体否定词（避免变体间自我竞争）
  const crossVariantNegatives = identifyCrossVariantNegatives(variants);
  
  return {
    parentAsin,
    variants,
    heroVariant,
    strategy: {
      variantBudgetAllocation: budgetAllocation,
      variantBidMultipliers: bidMultipliers,
      crossVariantNegatives
    }
  };
}

function identifyHeroVariant(variants: Variant[]): string {
  // 综合评分 = 销量权重 × 销量排名 + 评分权重 × 评分 + 广告效率权重 × ROAS
  const scores = variants.map(v => ({
    asin: v.asin,
    score: 0.4 * (1 / v.salesRank) + 0.3 * v.rating + 0.3 * v.adPerformance.roas
  }));
  
  return scores.sort((a, b) => b.score - a.score)[0].asin;
}
```

### 2.9 跨站点/多市场场景

**问题描述**：同一产品在多个Amazon站点投放时：
- 各站点竞争环境不同
- 需要协调跨站点预算
- 汇率波动影响成本计算

**需要补充的算法**：

```typescript
interface CrossMarketOptimization {
  // 市场分析
  markets: {
    marketplace: 'US' | 'UK' | 'DE' | 'JP' | 'CA' | 'FR' | 'IT' | 'ES' | 'AU';
    currency: string;
    exchangeRate: number;
    performance: {
      acos: number;
      roas: number;
      spend: number;
      revenue: number;
    };
    competitiveness: 'low' | 'medium' | 'high';
  }[];
  
  // 跨市场预算分配
  budgetAllocation: Record<string, number>;
  
  // 统一货币下的表现对比
  normalizedPerformance: {
    marketplace: string;
    normalizedAcos: number;
    normalizedRoas: number;
    efficiency: number;
  }[];
}

function optimizeCrossMarket(productId: string): CrossMarketOptimization {
  const markets = await getMarketData(productId);
  
  // 统一货币计算（转换为USD）
  const normalizedPerformance = markets.map(m => ({
    marketplace: m.marketplace,
    normalizedAcos: m.performance.acos,  // ACoS是比率，不需要转换
    normalizedRoas: m.performance.roas,
    efficiency: m.performance.roas / getMarketBenchmark(m.marketplace).avgRoas
  }));
  
  // 基于效率分配预算
  const totalBudget = markets.reduce((sum, m) => sum + m.performance.spend, 0);
  const budgetAllocation = calculateEfficiencyBasedAllocation(
    normalizedPerformance,
    totalBudget
  );
  
  return {
    markets,
    budgetAllocation,
    normalizedPerformance
  };
}
```

### 2.10 广告账户健康度场景

**问题描述**：广告账户整体健康状况影响优化效果：
- 账户结构是否合理
- 是否存在重复/冲突的广告
- 预算分配是否均衡

**需要补充的算法**：

```typescript
interface AccountHealthAnalysis {
  // 账户结构分析
  structure: {
    totalCampaigns: number;
    activeCampaigns: number;
    campaignsPerProduct: number;
    avgKeywordsPerCampaign: number;
  };
  
  // 健康指标
  healthMetrics: {
    budgetUtilization: number;      // 预算利用率
    impressionShare: number;        // 展示份额
    duplicateTargeting: number;     // 重复定向数量
    conflictingNegatives: number;   // 冲突否定词数量
    orphanedCampaigns: number;      // 孤立广告活动数量
  };
  
  // 健康评分
  healthScore: number;  // 0-100
  
  // 问题和建议
  issues: {
    severity: 'low' | 'medium' | 'high';
    description: string;
    recommendation: string;
  }[];
}

function analyzeAccountHealth(accountId: string): AccountHealthAnalysis {
  const campaigns = await getAllCampaigns(accountId);
  
  // 检测重复定向
  const duplicates = detectDuplicateTargeting(campaigns);
  
  // 检测冲突否定词
  const conflicts = detectConflictingNegatives(campaigns);
  
  // 检测孤立广告活动（长期无数据）
  const orphaned = detectOrphanedCampaigns(campaigns);
  
  // 计算健康评分
  const healthScore = calculateHealthScore({
    duplicates: duplicates.length,
    conflicts: conflicts.length,
    orphaned: orphaned.length,
    budgetUtilization: calculateBudgetUtilization(campaigns)
  });
  
  // 生成问题列表
  const issues = generateIssuesList(duplicates, conflicts, orphaned);
  
  return {
    structure: analyzeStructure(campaigns),
    healthMetrics: {
      budgetUtilization: calculateBudgetUtilization(campaigns),
      impressionShare: calculateImpressionShare(campaigns),
      duplicateTargeting: duplicates.length,
      conflictingNegatives: conflicts.length,
      orphanedCampaigns: orphaned.length
    },
    healthScore,
    issues
  };
}
```

### 2.11 归因窗口和数据延迟场景

**问题描述**：Amazon广告数据存在延迟和归因窗口限制：
- 数据延迟2-3天
- 7天/14天归因窗口
- 需要考虑数据不完整性

**需要补充的算法**：

```typescript
interface AttributionAwareOptimization {
  // 数据完整性评估
  dataCompleteness: {
    date: Date;
    completenessLevel: 'partial' | 'mostly_complete' | 'complete';
    estimatedMissingConversions: number;
  };
  
  // 归因调整
  attributionAdjustment: {
    rawAcos: number;
    adjustedAcos: number;  // 考虑延迟归因后的预估ACoS
    confidenceInterval: [number, number];
  };
}

function applyAttributionAdjustment(data: CampaignData): AttributionAwareOptimization {
  const dataAge = daysSince(data.date);
  
  // 数据完整性评估
  let completenessLevel: 'partial' | 'mostly_complete' | 'complete';
  let estimatedMissingConversions: number;
  
  if (dataAge < 3) {
    completenessLevel = 'partial';
    estimatedMissingConversions = data.conversions * 0.3;  // 预估还有30%转化未归因
  } else if (dataAge < 7) {
    completenessLevel = 'mostly_complete';
    estimatedMissingConversions = data.conversions * 0.1;  // 预估还有10%转化未归因
  } else {
    completenessLevel = 'complete';
    estimatedMissingConversions = 0;
  }
  
  // 调整ACoS计算
  const adjustedConversions = data.conversions + estimatedMissingConversions;
  const adjustedSales = adjustedConversions * data.avgOrderValue;
  const adjustedAcos = data.spend / adjustedSales;
  
  return {
    dataCompleteness: {
      date: data.date,
      completenessLevel,
      estimatedMissingConversions
    },
    attributionAdjustment: {
      rawAcos: data.spend / data.sales,
      adjustedAcos,
      confidenceInterval: [adjustedAcos * 0.9, adjustedAcos * 1.1]
    }
  };
}
```

### 2.12 广告组/关键词数量限制场景

**问题描述**：Amazon对广告组和关键词数量有限制：
- 每个广告活动最多1000个广告组
- 每个广告组最多1000个关键词
- 需要合理规划结构

**需要补充的算法**：

```typescript
interface StructureLimitManagement {
  // 当前使用情况
  usage: {
    campaignId: string;
    adGroupCount: number;
    maxAdGroups: number;
    keywordsPerAdGroup: Record<string, number>;
    maxKeywordsPerAdGroup: number;
  };
  
  // 是否接近限制
  nearingLimit: boolean;
  
  // 结构优化建议
  restructuringRecommendations: {
    action: 'merge_ad_groups' | 'split_campaign' | 'archive_inactive' | 'none';
    details: string;
  };
}

function manageStructureLimits(campaignId: string): StructureLimitManagement {
  const campaign = await getCampaignDetails(campaignId);
  
  const adGroupCount = campaign.adGroups.length;
  const nearingAdGroupLimit = adGroupCount > 800;  // 80%阈值
  
  // 检查关键词数量
  const keywordsPerAdGroup = campaign.adGroups.reduce((acc, ag) => {
    acc[ag.id] = ag.keywords.length;
    return acc;
  }, {} as Record<string, number>);
  
  const nearingKeywordLimit = Object.values(keywordsPerAdGroup).some(count => count > 800);
  
  let restructuringRecommendations;
  
  if (nearingAdGroupLimit) {
    // 建议合并低效广告组或拆分广告活动
    const inactiveAdGroups = campaign.adGroups.filter(ag => ag.impressions === 0);
    if (inactiveAdGroups.length > 50) {
      restructuringRecommendations = {
        action: 'archive_inactive' as const,
        details: `建议归档${inactiveAdGroups.length}个无效广告组`
      };
    } else {
      restructuringRecommendations = {
        action: 'split_campaign' as const,
        details: '建议将广告活动拆分为多个，按产品线或匹配类型分组'
      };
    }
  } else if (nearingKeywordLimit) {
    restructuringRecommendations = {
      action: 'merge_ad_groups' as const,
      details: '建议合并相似广告组，或将低效关键词归档'
    };
  } else {
    restructuringRecommendations = {
      action: 'none' as const,
      details: '结构健康，无需调整'
    };
  }
  
  return {
    usage: {
      campaignId,
      adGroupCount,
      maxAdGroups: 1000,
      keywordsPerAdGroup,
      maxKeywordsPerAdGroup: 1000
    },
    nearingLimit: nearingAdGroupLimit || nearingKeywordLimit,
    restructuringRecommendations
  };
}
```

---

## 三、特殊场景优先级排序

基于影响范围和发生频率，对上述特殊场景进行优先级排序：

| 优先级 | 场景 | 影响范围 | 发生频率 | 建议处理方式 |
|:-----:|------|:-------:|:-------:|------------|
| P0 | 预算耗尽 | 高 | 高 | 实时监控+自动预警 |
| P0 | 库存不足/断货 | 高 | 中 | 实时监控+自动暂停 |
| P1 | 季节性和大促 | 高 | 中 | 提前规划+策略切换 |
| P1 | 归因窗口和数据延迟 | 中 | 高 | 算法内置调整 |
| P1 | 竞价过高 | 中 | 中 | 效率分析+自动调整 |
| P2 | 竞品价格战 | 中 | 低 | 监控+建议 |
| P2 | Review/Rating变化 | 中 | 低 | 监控+建议 |
| P2 | 多变体产品 | 中 | 中 | 协调策略 |
| P3 | 广告疲劳 | 低 | 低 | 定期检测+建议 |
| P3 | 跨站点/多市场 | 中 | 低 | 统一分析+建议 |
| P3 | 账户健康度 | 低 | 低 | 定期审计 |
| P3 | 结构限制 | 低 | 低 | 监控+预警 |

---

## 四、算法完整性检查清单

### 4.1 数据输入层

| 检查项 | 状态 | 说明 |
|-------|:----:|------|
| SP广告数据获取 | ✅ | 已实现 |
| SB广告数据获取 | ✅ | 已实现 |
| SD广告数据获取 | ✅ | 已实现 |
| 搜索词报告获取 | ✅ | 已实现 |
| 库存数据获取 | ⚠️ | 需要补充 |
| 竞品价格数据获取 | ⚠️ | 需要补充 |
| Review/Rating数据获取 | ⚠️ | 需要补充 |

### 4.2 算法处理层

| 检查项 | 状态 | 说明 |
|-------|:----:|------|
| 市场曲线建模 | ✅ | 已实现 |
| 边际分析 | ✅ | 已实现 |
| 决策树竞价 | ✅ | 已实现 |
| 双层N-Gram | ✅ | 已实现 |
| 全局否定同步 | ✅ | 已实现 |
| 预算耗尽检测 | ⚠️ | 需要补充 |
| 季节性调整 | ⚠️ | 需要补充 |
| 库存风险评估 | ⚠️ | 需要补充 |
| 归因调整 | ⚠️ | 需要补充 |

### 4.3 输出执行层

| 检查项 | 状态 | 说明 |
|-------|:----:|------|
| 竞价调整执行 | ✅ | 已实现 |
| 预算调整执行 | ✅ | 已实现 |
| 否定词添加执行 | ✅ | 已实现 |
| 广告暂停/启用 | ✅ | 已实现 |
| 库存联动暂停 | ⚠️ | 需要补充 |
| 大促策略切换 | ⚠️ | 需要补充 |

---

## 五、总结与建议

### 5.1 已覆盖的核心能力

我们的广告优化算法已经覆盖了以下核心能力：

1. **竞价优化**：市场曲线建模、边际分析、决策树、分时竞价、位置竞价
2. **搜索词分析**：双层N-Gram、智能分类、来源聚合
3. **否定词管理**：全局同步、能力适配
4. **预算分配**：跨渠道分配、分时规则
5. **特殊场景**：新品推广、新广告活动冷启动、学习期保护

### 5.2 需要补充的特殊场景

建议按优先级补充以下特殊场景的处理算法：

**P0（必须）**：
- 预算耗尽检测和预警
- 库存不足/断货联动

**P1（重要）**：
- 季节性和大促策略
- 归因窗口调整
- 竞价效率分析

**P2（建议）**：
- 竞品价格监控
- Review/Rating影响分析
- 多变体协调

**P3（可选）**：
- 广告疲劳检测
- 跨站点优化
- 账户健康审计
- 结构限制管理

### 5.3 下一步行动建议

1. **短期**：实现P0级别的预算耗尽和库存联动功能
2. **中期**：实现P1级别的季节性调整和归因调整
3. **长期**：逐步完善P2和P3级别的功能

---

*文档更新时间：2026年1月*
