# 特殊场景算法优化设计文档

## 一、概述

本文档详细设计了基于现有Amazon广告API数据能力可立即实现的四个特殊场景算法优化。这些算法旨在解决当前系统尚未充分覆盖的关键场景，提升广告优化的准确性和效果。

---

## 二、场景一：预算耗尽智能预测与动态调整

### 2.1 问题背景

当前系统的预算预警功能（budgetAlertService.ts）仅基于简单的消耗比例计算，存在以下不足：

1. **线性假设**：假设消耗速度在一天内均匀分布，忽略了流量的时段性波动
2. **缺乏历史模式学习**：未利用历史数据学习该广告活动的消耗模式
3. **无法预测最优耗尽时间**：未考虑何时耗尽预算对整体效果最优

### 2.2 算法设计

#### 2.2.1 历史消耗模式建模

```typescript
interface HourlySpendPattern {
  hour: number;           // 0-23
  avgSpendPercent: number; // 该小时平均消耗占日总消耗的百分比
  stdDev: number;         // 标准差，用于置信区间
  sampleSize: number;     // 样本数量
}

interface CampaignSpendModel {
  campaignId: number;
  weekdayPatterns: HourlySpendPattern[][]; // 7天 × 24小时
  weekendPatterns: HourlySpendPattern[][]; // 周末模式
  seasonalFactors: Record<string, number>; // 季节性调整因子
  lastUpdated: Date;
}
```

#### 2.2.2 预算耗尽时间预测算法

```typescript
/**
 * 预测预算耗尽时间
 * 
 * 算法步骤：
 * 1. 获取当前小时的消耗数据
 * 2. 基于历史模式计算剩余小时的预期消耗
 * 3. 使用蒙特卡洛模拟计算耗尽时间的概率分布
 */
function predictBudgetDepletion(
  campaignId: number,
  currentSpend: number,
  dailyBudget: number,
  currentHour: number,
  spendModel: CampaignSpendModel
): BudgetDepletionPrediction {
  const remainingBudget = dailyBudget - currentSpend;
  const isWeekend = [0, 6].includes(new Date().getDay());
  const patterns = isWeekend ? spendModel.weekendPatterns : spendModel.weekdayPatterns;
  
  // 计算剩余小时的累计预期消耗
  let cumulativeExpectedSpend = 0;
  let depletionHour = 24; // 默认不会耗尽
  
  for (let h = currentHour + 1; h < 24; h++) {
    const hourPattern = patterns[new Date().getDay()][h];
    const expectedHourlySpend = dailyBudget * (hourPattern.avgSpendPercent / 100);
    cumulativeExpectedSpend += expectedHourlySpend;
    
    if (cumulativeExpectedSpend >= remainingBudget && depletionHour === 24) {
      depletionHour = h;
    }
  }
  
  // 计算置信区间
  const confidence95 = calculateConfidenceInterval(patterns, currentHour, remainingBudget);
  
  return {
    predictedDepletionHour: depletionHour,
    confidence: confidence95,
    riskLevel: depletionHour < 18 ? 'high' : depletionHour < 21 ? 'medium' : 'low',
    recommendation: generateRecommendation(depletionHour, dailyBudget, currentSpend)
  };
}
```

#### 2.2.3 最优耗尽时间计算

```typescript
/**
 * 计算最优预算耗尽时间
 * 
 * 原理：分析历史数据中不同耗尽时间对应的ROAS/ACoS表现
 * 找出使整体效果最优的预算耗尽时间点
 */
function calculateOptimalDepletionTime(
  campaignId: number,
  historicalData: DailyPerformance[],
  targetMetric: 'roas' | 'acos' | 'sales'
): OptimalDepletionAnalysis {
  // 按预算耗尽时间分组分析历史表现
  const depletionBuckets: Map<number, PerformanceMetrics[]> = new Map();
  
  for (const day of historicalData) {
    const depletionHour = estimateDepletionHour(day);
    if (!depletionBuckets.has(depletionHour)) {
      depletionBuckets.set(depletionHour, []);
    }
    depletionBuckets.get(depletionHour)!.push(day);
  }
  
  // 计算每个耗尽时间段的平均表现
  const bucketPerformance = Array.from(depletionBuckets.entries()).map(([hour, metrics]) => ({
    depletionHour: hour,
    avgRoas: average(metrics.map(m => m.roas)),
    avgAcos: average(metrics.map(m => m.acos)),
    avgSales: average(metrics.map(m => m.sales)),
    sampleSize: metrics.length
  }));
  
  // 找出最优耗尽时间
  const optimal = bucketPerformance.reduce((best, current) => {
    if (targetMetric === 'roas') return current.avgRoas > best.avgRoas ? current : best;
    if (targetMetric === 'acos') return current.avgAcos < best.avgAcos ? current : best;
    return current.avgSales > best.avgSales ? current : best;
  });
  
  return {
    optimalDepletionHour: optimal.depletionHour,
    expectedImprovement: calculateImprovement(optimal, bucketPerformance),
    confidence: optimal.sampleSize >= 10 ? 'high' : optimal.sampleSize >= 5 ? 'medium' : 'low',
    recommendation: `建议调整预算或出价，使预算在${optimal.depletionHour}:00左右耗尽`
  };
}
```

### 2.3 数据库表设计

```sql
-- 广告活动消耗模式表
CREATE TABLE campaign_spend_patterns (
  id INT AUTO_INCREMENT PRIMARY KEY,
  campaign_id INT NOT NULL,
  day_of_week TINYINT NOT NULL, -- 0-6
  hour_of_day TINYINT NOT NULL, -- 0-23
  avg_spend_percent DECIMAL(5,2) NOT NULL,
  std_dev DECIMAL(5,2),
  sample_size INT DEFAULT 0,
  last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY idx_campaign_day_hour (campaign_id, day_of_week, hour_of_day)
);

-- 预算耗尽预测记录表
CREATE TABLE budget_depletion_predictions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  campaign_id INT NOT NULL,
  prediction_date DATE NOT NULL,
  prediction_hour TINYINT NOT NULL,
  predicted_depletion_hour TINYINT,
  actual_depletion_hour TINYINT,
  confidence DECIMAL(3,2),
  was_accurate TINYINT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## 三、场景二：归因窗口数据延迟智能调整

### 3.1 问题背景

Amazon广告的归因窗口为7-14天，这意味着：
- **第1天数据**：仅约70%的转化被归因
- **第3天数据**：约95%的转化被归因
- **第7天数据**：接近100%的转化被归因

当前系统的correctionService.ts仅在14天后进行事后纠错，未能在决策时主动调整数据。

### 3.2 算法设计

#### 3.2.1 归因完成度模型

```typescript
interface AttributionCompletionModel {
  accountId: number;
  // 按数据天数的归因完成率（基于历史数据学习）
  completionRates: {
    day1: number;  // 默认0.70
    day2: number;  // 默认0.80
    day3: number;  // 默认0.90
    day4: number;  // 默认0.95
    day5: number;  // 默认0.97
    day6: number;  // 默认0.99
    day7: number;  // 默认1.00
  };
  // 按广告类型的调整因子
  campaignTypeFactors: {
    sp_auto: number;
    sp_manual: number;
    sb: number;
    sd: number;
  };
  // 按产品类别的调整因子（高价产品归因更慢）
  categoryFactors: Record<string, number>;
  lastCalibrated: Date;
}
```

#### 3.2.2 归因调整算法

```typescript
/**
 * 调整近期数据的归因延迟
 * 
 * 算法原理：
 * 1. 计算数据的"年龄"（距今天数）
 * 2. 根据归因完成度模型计算调整系数
 * 3. 调整销售额、订单数、ACoS、ROAS等指标
 */
function adjustForAttributionDelay(
  rawMetrics: PerformanceMetrics,
  dataDate: Date,
  model: AttributionCompletionModel,
  campaignType: string
): AdjustedMetrics {
  const dataAge = Math.floor((Date.now() - dataDate.getTime()) / (1000 * 60 * 60 * 24));
  
  // 获取基础归因完成率
  let completionRate = 1.0;
  if (dataAge <= 7) {
    completionRate = model.completionRates[`day${dataAge}` as keyof typeof model.completionRates] || 1.0;
  }
  
  // 应用广告类型调整因子
  const typeFactor = model.campaignTypeFactors[campaignType as keyof typeof model.campaignTypeFactors] || 1.0;
  completionRate *= typeFactor;
  
  // 计算调整系数（归因完成率的倒数）
  const adjustmentFactor = 1 / completionRate;
  
  // 调整销售相关指标
  const adjustedSales = rawMetrics.sales * adjustmentFactor;
  const adjustedOrders = Math.round(rawMetrics.orders * adjustmentFactor);
  
  // 重新计算ACoS和ROAS
  const adjustedAcos = rawMetrics.spend > 0 ? (rawMetrics.spend / adjustedSales) * 100 : 0;
  const adjustedRoas = rawMetrics.spend > 0 ? adjustedSales / rawMetrics.spend : 0;
  
  return {
    ...rawMetrics,
    sales: adjustedSales,
    orders: adjustedOrders,
    acos: adjustedAcos,
    roas: adjustedRoas,
    isAdjusted: true,
    adjustmentFactor,
    completionRate,
    confidence: calculateConfidence(dataAge, rawMetrics.clicks)
  };
}
```

#### 3.2.3 归因模型自动校准

```typescript
/**
 * 基于历史数据自动校准归因完成度模型
 * 
 * 算法步骤：
 * 1. 获取7天前的数据快照和当前数据
 * 2. 计算实际的归因完成率
 * 3. 使用指数移动平均更新模型
 */
async function calibrateAttributionModel(
  accountId: number,
  lookbackDays: number = 30
): Promise<AttributionCompletionModel> {
  const db = await getDb();
  
  // 获取历史数据快照（需要在数据同步时保存快照）
  const snapshots = await db.select()
    .from(performanceSnapshots)
    .where(and(
      eq(performanceSnapshots.accountId, accountId),
      gte(performanceSnapshots.snapshotDate, subDays(new Date(), lookbackDays))
    ));
  
  // 计算每个数据年龄的实际归因完成率
  const completionRates: Record<number, number[]> = {};
  
  for (const snapshot of snapshots) {
    const dataAge = Math.floor((snapshot.snapshotDate.getTime() - snapshot.dataDate.getTime()) / (1000 * 60 * 60 * 24));
    
    // 获取该数据日期的最终数据（7天后的数据）
    const finalData = await getFinalData(snapshot.dataDate, accountId);
    
    if (finalData && finalData.sales > 0) {
      const completionRate = snapshot.sales / finalData.sales;
      if (!completionRates[dataAge]) completionRates[dataAge] = [];
      completionRates[dataAge].push(completionRate);
    }
  }
  
  // 计算平均归因完成率
  const model: AttributionCompletionModel = {
    accountId,
    completionRates: {
      day1: average(completionRates[1] || [0.70]),
      day2: average(completionRates[2] || [0.80]),
      day3: average(completionRates[3] || [0.90]),
      day4: average(completionRates[4] || [0.95]),
      day5: average(completionRates[5] || [0.97]),
      day6: average(completionRates[6] || [0.99]),
      day7: average(completionRates[7] || [1.00]),
    },
    campaignTypeFactors: { sp_auto: 1.0, sp_manual: 1.0, sb: 0.95, sd: 0.90 },
    categoryFactors: {},
    lastCalibrated: new Date()
  };
  
  return model;
}
```

### 3.3 数据库表设计

```sql
-- 绩效数据快照表（用于归因模型校准）
CREATE TABLE performance_snapshots (
  id INT AUTO_INCREMENT PRIMARY KEY,
  account_id INT NOT NULL,
  campaign_id INT,
  data_date DATE NOT NULL,
  snapshot_date DATE NOT NULL,
  impressions INT DEFAULT 0,
  clicks INT DEFAULT 0,
  spend DECIMAL(10,2) DEFAULT 0,
  sales DECIMAL(10,2) DEFAULT 0,
  orders INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_account_data_date (account_id, data_date),
  INDEX idx_snapshot_date (snapshot_date)
);

-- 归因模型配置表
CREATE TABLE attribution_models (
  id INT AUTO_INCREMENT PRIMARY KEY,
  account_id INT NOT NULL UNIQUE,
  completion_rates JSON NOT NULL,
  campaign_type_factors JSON,
  category_factors JSON,
  last_calibrated TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

---

## 四、场景三：竞价效率分析与过度竞价检测

### 4.1 问题背景

许多广告主存在"过度竞价"问题：
- 出价远高于实际CPC，造成不必要的竞价压力
- 未考虑产品利润率，导致ACoS超出盈亏平衡点
- 缺乏对竞价效率的系统性分析

### 4.2 算法设计

#### 4.2.1 竞价效率评分模型

```typescript
interface BidEfficiencyAnalysis {
  keywordId: number;
  keywordText: string;
  matchType: string;
  
  // 当前竞价数据
  currentBid: number;
  actualCpc: number;
  bidToCpcRatio: number;  // 出价/CPC比率
  
  // 效率指标
  targetCpc: number;      // 基于目标ACoS计算的理想CPC
  efficiencyScore: number; // 0-100分
  
  // 问题诊断
  isOverbidding: boolean;
  overbiddingPercent: number;
  
  // 优化建议
  suggestedBid: number;
  expectedSavings: number;
  expectedImpact: {
    impressionChange: number;
    clickChange: number;
    salesChange: number;
  };
}
```

#### 4.2.2 目标CPC计算

```typescript
/**
 * 计算目标CPC（基于产品利润和目标ACoS）
 * 
 * 公式：目标CPC = 目标ACoS × CVR × 产品价格
 * 或：目标CPC = 目标ACoS × 平均订单价值 × CVR
 */
function calculateTargetCpc(
  targetAcos: number,      // 目标ACoS，如0.25表示25%
  cvr: number,             // 转化率，如0.10表示10%
  avgOrderValue: number,   // 平均订单价值
  profitMargin?: number    // 可选：利润率，用于计算盈亏平衡ACoS
): TargetCpcResult {
  // 基础目标CPC
  const targetCpc = targetAcos * cvr * avgOrderValue;
  
  // 盈亏平衡CPC（如果提供了利润率）
  const breakEvenCpc = profitMargin 
    ? profitMargin * cvr * avgOrderValue 
    : targetCpc * 1.5;
  
  // 最大可接受CPC（不应超过盈亏平衡点）
  const maxCpc = breakEvenCpc;
  
  return {
    targetCpc,
    breakEvenCpc,
    maxCpc,
    formula: `${targetAcos} × ${cvr} × ${avgOrderValue} = ${targetCpc.toFixed(2)}`
  };
}
```

#### 4.2.3 过度竞价检测算法

```typescript
/**
 * 检测过度竞价
 * 
 * 判断标准：
 * 1. 出价/CPC比率 > 2.0（出价是实际CPC的2倍以上）
 * 2. 实际CPC > 目标CPC × 1.2（CPC超出目标20%以上）
 * 3. 实际ACoS > 目标ACoS × 1.5（ACoS超出目标50%以上）
 */
function detectOverbidding(
  keyword: KeywordPerformance,
  targetAcos: number,
  profitMargin: number
): OverbiddingAnalysis {
  const { bid, cpc, cvr, acos, sales, spend, clicks } = keyword;
  
  // 计算目标CPC
  const avgOrderValue = sales / (clicks * cvr) || 0;
  const { targetCpc, breakEvenCpc } = calculateTargetCpc(targetAcos, cvr, avgOrderValue, profitMargin);
  
  // 计算竞价效率指标
  const bidToCpcRatio = cpc > 0 ? bid / cpc : 0;
  const cpcToTargetRatio = targetCpc > 0 ? cpc / targetCpc : 0;
  const acosToTargetRatio = targetAcos > 0 ? acos / targetAcos : 0;
  
  // 判断是否过度竞价
  const overbiddingReasons: string[] = [];
  let overbiddingScore = 0;
  
  if (bidToCpcRatio > 2.0) {
    overbiddingReasons.push(`出价是实际CPC的${bidToCpcRatio.toFixed(1)}倍`);
    overbiddingScore += 30;
  }
  
  if (cpcToTargetRatio > 1.2) {
    overbiddingReasons.push(`实际CPC超出目标${((cpcToTargetRatio - 1) * 100).toFixed(0)}%`);
    overbiddingScore += 40;
  }
  
  if (acosToTargetRatio > 1.5) {
    overbiddingReasons.push(`ACoS超出目标${((acosToTargetRatio - 1) * 100).toFixed(0)}%`);
    overbiddingScore += 30;
  }
  
  // 计算建议出价
  const suggestedBid = Math.min(
    targetCpc * 1.5,  // 不超过目标CPC的1.5倍
    breakEvenCpc,     // 不超过盈亏平衡CPC
    cpc * 1.2         // 不超过当前CPC的1.2倍（保证竞争力）
  );
  
  // 计算预期节省
  const expectedSavings = clicks * (bid - suggestedBid);
  
  return {
    isOverbidding: overbiddingScore >= 50,
    overbiddingScore,
    overbiddingReasons,
    currentBid: bid,
    actualCpc: cpc,
    targetCpc,
    breakEvenCpc,
    suggestedBid,
    expectedSavings,
    efficiencyScore: Math.max(0, 100 - overbiddingScore)
  };
}
```

#### 4.2.4 批量竞价效率分析

```typescript
/**
 * 批量分析所有投放词的竞价效率
 */
async function analyzeBidEfficiency(
  accountId: number,
  targetAcos: number,
  profitMargin: number,
  minClicks: number = 10  // 最小点击数要求
): Promise<BidEfficiencyReport> {
  const db = await getDb();
  
  // 获取有足够数据的投放词
  const keywords = await db.select()
    .from(keywords)
    .where(and(
      eq(keywords.accountId, accountId),
      gte(keywords.clicks, minClicks)
    ));
  
  const analyses: BidEfficiencyAnalysis[] = [];
  let totalPotentialSavings = 0;
  let overbiddingCount = 0;
  
  for (const keyword of keywords) {
    const analysis = detectOverbidding(keyword, targetAcos, profitMargin);
    analyses.push({
      keywordId: keyword.id,
      keywordText: keyword.keywordText,
      matchType: keyword.matchType,
      ...analysis
    });
    
    if (analysis.isOverbidding) {
      overbiddingCount++;
      totalPotentialSavings += analysis.expectedSavings;
    }
  }
  
  // 按过度竞价程度排序
  analyses.sort((a, b) => b.overbiddingScore - a.overbiddingScore);
  
  return {
    totalKeywords: keywords.length,
    overbiddingCount,
    overbiddingPercent: (overbiddingCount / keywords.length) * 100,
    totalPotentialSavings,
    analyses,
    topOverbidding: analyses.slice(0, 20),
    recommendations: generateBidEfficiencyRecommendations(analyses)
  };
}
```

### 4.3 数据库表设计

```sql
-- 竞价效率分析记录表
CREATE TABLE bid_efficiency_analyses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  account_id INT NOT NULL,
  analysis_date DATE NOT NULL,
  total_keywords INT DEFAULT 0,
  overbidding_count INT DEFAULT 0,
  total_potential_savings DECIMAL(10,2) DEFAULT 0,
  avg_efficiency_score DECIMAL(5,2),
  target_acos DECIMAL(5,2),
  profit_margin DECIMAL(5,2),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_account_date (account_id, analysis_date)
);

-- 投放词竞价效率详情表
CREATE TABLE keyword_bid_efficiency (
  id INT AUTO_INCREMENT PRIMARY KEY,
  analysis_id INT NOT NULL,
  keyword_id INT NOT NULL,
  current_bid DECIMAL(10,2),
  actual_cpc DECIMAL(10,2),
  target_cpc DECIMAL(10,2),
  efficiency_score DECIMAL(5,2),
  is_overbidding TINYINT DEFAULT 0,
  overbidding_score INT DEFAULT 0,
  suggested_bid DECIMAL(10,2),
  expected_savings DECIMAL(10,2),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_analysis (analysis_id),
  INDEX idx_keyword (keyword_id)
);
```

---

## 五、场景四：季节性智能调整算法

### 5.1 问题背景

当前的seasonalBudgetService.ts主要基于预设的大促日历，缺乏：
1. **自动学习历史季节性模式**
2. **动态调整策略参数**
3. **大促前后的渐进式调整**

### 5.2 算法设计

#### 5.2.1 季节性模式识别

```typescript
interface SeasonalPattern {
  accountId: number;
  
  // 周内模式（周一到周日的相对表现）
  weekdayFactors: number[];  // 长度7，周日=0
  
  // 月内模式（每月1-31日的相对表现）
  monthdayFactors: number[]; // 长度31
  
  // 年内模式（1-12月的相对表现）
  monthlyFactors: number[];  // 长度12
  
  // 大促影响模式
  primeDay: EventPattern;
  blackFriday: EventPattern;
  cyberMonday: EventPattern;
  christmas: EventPattern;
  
  // 模式置信度
  confidence: number;
  lastUpdated: Date;
}

interface EventPattern {
  // 事件前N天的调整因子
  preDays: { day: number; factor: number }[];
  // 事件当天的调整因子
  eventDayFactor: number;
  // 事件后N天的调整因子
  postDays: { day: number; factor: number }[];
}
```

#### 5.2.2 季节性模式学习算法

```typescript
/**
 * 从历史数据学习季节性模式
 * 
 * 算法步骤：
 * 1. 收集至少1年的历史数据
 * 2. 计算每个时间维度的平均表现
 * 3. 归一化为相对因子（平均值=1.0）
 * 4. 识别大促事件的影响模式
 */
async function learnSeasonalPatterns(
  accountId: number,
  metric: 'sales' | 'roas' | 'conversions' = 'sales'
): Promise<SeasonalPattern> {
  const db = await getDb();
  
  // 获取历史数据（至少1年）
  const historicalData = await db.select()
    .from(dailyPerformance)
    .where(and(
      eq(dailyPerformance.accountId, accountId),
      gte(dailyPerformance.date, subYears(new Date(), 1))
    ))
    .orderBy(dailyPerformance.date);
  
  // 计算周内模式
  const weekdayData: number[][] = Array(7).fill(null).map(() => []);
  for (const day of historicalData) {
    const weekday = new Date(day.date).getDay();
    weekdayData[weekday].push(Number(day[metric]) || 0);
  }
  const weekdayAvg = weekdayData.map(arr => average(arr));
  const weekdayOverall = average(weekdayAvg);
  const weekdayFactors = weekdayAvg.map(v => v / weekdayOverall);
  
  // 计算月内模式
  const monthdayData: number[][] = Array(31).fill(null).map(() => []);
  for (const day of historicalData) {
    const monthday = new Date(day.date).getDate() - 1;
    monthdayData[monthday].push(Number(day[metric]) || 0);
  }
  const monthdayAvg = monthdayData.map(arr => arr.length > 0 ? average(arr) : 0);
  const monthdayOverall = average(monthdayAvg.filter(v => v > 0));
  const monthdayFactors = monthdayAvg.map(v => v > 0 ? v / monthdayOverall : 1.0);
  
  // 计算年内月度模式
  const monthlyData: number[][] = Array(12).fill(null).map(() => []);
  for (const day of historicalData) {
    const month = new Date(day.date).getMonth();
    monthlyData[month].push(Number(day[metric]) || 0);
  }
  const monthlyAvg = monthlyData.map(arr => arr.length > 0 ? average(arr) : 0);
  const monthlyOverall = average(monthlyAvg.filter(v => v > 0));
  const monthlyFactors = monthlyAvg.map(v => v > 0 ? v / monthlyOverall : 1.0);
  
  // 识别大促事件模式
  const primeDay = await learnEventPattern(historicalData, 'prime_day');
  const blackFriday = await learnEventPattern(historicalData, 'black_friday');
  const cyberMonday = await learnEventPattern(historicalData, 'cyber_monday');
  const christmas = await learnEventPattern(historicalData, 'christmas');
  
  return {
    accountId,
    weekdayFactors,
    monthdayFactors,
    monthlyFactors,
    primeDay,
    blackFriday,
    cyberMonday,
    christmas,
    confidence: calculatePatternConfidence(historicalData.length),
    lastUpdated: new Date()
  };
}
```

#### 5.2.3 季节性调整策略生成

```typescript
/**
 * 生成当日的季节性调整策略
 */
function generateSeasonalStrategy(
  pattern: SeasonalPattern,
  targetDate: Date = new Date()
): SeasonalAdjustmentStrategy {
  const weekday = targetDate.getDay();
  const monthday = targetDate.getDate() - 1;
  const month = targetDate.getMonth();
  
  // 基础季节性因子（综合周内、月内、年内模式）
  const baseFactor = (
    pattern.weekdayFactors[weekday] * 0.4 +
    pattern.monthdayFactors[monthday] * 0.2 +
    pattern.monthlyFactors[month] * 0.4
  );
  
  // 检查是否接近大促事件
  const eventAdjustment = getEventAdjustment(targetDate, pattern);
  
  // 最终调整因子
  const finalFactor = baseFactor * eventAdjustment.factor;
  
  // 生成具体调整建议
  return {
    date: targetDate,
    baseFactor,
    eventAdjustment,
    finalFactor,
    
    // 预算调整建议
    budgetMultiplier: Math.max(0.5, Math.min(2.0, finalFactor)),
    
    // 出价调整建议
    bidMultiplier: Math.max(0.8, Math.min(1.5, Math.sqrt(finalFactor))),
    
    // ACoS容忍度调整
    acosToleranceMultiplier: finalFactor > 1.2 ? 1.2 : 1.0,
    
    // 策略说明
    explanation: generateStrategyExplanation(baseFactor, eventAdjustment),
    
    // 置信度
    confidence: pattern.confidence
  };
}
```

#### 5.2.4 大促前后渐进式调整

```typescript
/**
 * 生成大促前后的渐进式调整计划
 * 
 * 原理：
 * - 大促前7天开始逐步提高预算和出价
 * - 大促当天达到峰值
 * - 大促后3天逐步恢复正常
 */
function generateEventTransitionPlan(
  eventDate: Date,
  eventPattern: EventPattern,
  baseBudget: number,
  baseBid: number
): EventTransitionPlan {
  const plan: DailyAdjustment[] = [];
  
  // 大促前调整（提前7天开始）
  for (let i = 7; i >= 1; i--) {
    const date = subDays(eventDate, i);
    const preDayConfig = eventPattern.preDays.find(d => d.day === i);
    const factor = preDayConfig?.factor || 1 + (7 - i) * 0.1;
    
    plan.push({
      date,
      phase: 'pre_event',
      daysFromEvent: -i,
      budgetMultiplier: factor,
      bidMultiplier: Math.sqrt(factor),
      recommendedBudget: baseBudget * factor,
      recommendedBid: baseBid * Math.sqrt(factor),
      explanation: `大促前${i}天，建议预算提升${((factor - 1) * 100).toFixed(0)}%`
    });
  }
  
  // 大促当天
  plan.push({
    date: eventDate,
    phase: 'event_day',
    daysFromEvent: 0,
    budgetMultiplier: eventPattern.eventDayFactor,
    bidMultiplier: Math.sqrt(eventPattern.eventDayFactor),
    recommendedBudget: baseBudget * eventPattern.eventDayFactor,
    recommendedBid: baseBid * Math.sqrt(eventPattern.eventDayFactor),
    explanation: `大促当天，建议预算提升${((eventPattern.eventDayFactor - 1) * 100).toFixed(0)}%`
  });
  
  // 大促后调整（持续3天）
  for (let i = 1; i <= 3; i++) {
    const date = addDays(eventDate, i);
    const postDayConfig = eventPattern.postDays.find(d => d.day === i);
    const factor = postDayConfig?.factor || 1 + (3 - i) * 0.2;
    
    plan.push({
      date,
      phase: 'post_event',
      daysFromEvent: i,
      budgetMultiplier: factor,
      bidMultiplier: Math.sqrt(factor),
      recommendedBudget: baseBudget * factor,
      recommendedBid: baseBid * Math.sqrt(factor),
      explanation: `大促后${i}天，建议预算维持提升${((factor - 1) * 100).toFixed(0)}%`
    });
  }
  
  return {
    eventName: getEventName(eventDate),
    eventDate,
    totalDays: plan.length,
    dailyAdjustments: plan,
    estimatedAdditionalSpend: calculateAdditionalSpend(plan, baseBudget),
    estimatedAdditionalSales: estimateAdditionalSales(plan, baseBudget, eventPattern)
  };
}
```

### 5.3 数据库表设计

```sql
-- 季节性模式表
CREATE TABLE seasonal_patterns (
  id INT AUTO_INCREMENT PRIMARY KEY,
  account_id INT NOT NULL UNIQUE,
  weekday_factors JSON NOT NULL,
  monthday_factors JSON NOT NULL,
  monthly_factors JSON NOT NULL,
  prime_day_pattern JSON,
  black_friday_pattern JSON,
  cyber_monday_pattern JSON,
  christmas_pattern JSON,
  confidence DECIMAL(3,2),
  last_updated TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 季节性调整执行记录表
CREATE TABLE seasonal_adjustments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  account_id INT NOT NULL,
  campaign_id INT NOT NULL,
  adjustment_date DATE NOT NULL,
  adjustment_type ENUM('budget', 'bid', 'acos_tolerance') NOT NULL,
  base_value DECIMAL(10,2),
  adjusted_value DECIMAL(10,2),
  multiplier DECIMAL(5,2),
  reason VARCHAR(255),
  event_name VARCHAR(50),
  was_applied TINYINT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_account_date (account_id, adjustment_date)
);
```

---

## 六、实现优先级与时间表

| 优先级 | 场景 | 预计工时 | 依赖 |
|:-----:|------|:-------:|------|
| P0 | 预算耗尽智能预测 | 8h | 无 |
| P0 | 归因窗口数据延迟调整 | 12h | 需要数据快照机制 |
| P1 | 竞价效率分析 | 6h | 需要用户配置利润率 |
| P1 | 季节性智能调整 | 10h | 需要至少3个月历史数据 |

---

## 七、预期效果

### 7.1 预算耗尽智能预测

- **预测准确率**：预计达到85%以上
- **业务价值**：避免预算过早耗尽导致的销售损失，预计提升日销售额5-10%

### 7.2 归因窗口数据延迟调整

- **决策准确率提升**：预计减少30%的错误竞价调整
- **业务价值**：避免因数据不完整导致的过度降价，预计提升ROAS 5-15%

### 7.3 竞价效率分析

- **广告费用节省**：预计节省10-20%的无效竞价支出
- **业务价值**：在保持流量的同时降低CPC，提升整体利润率

### 7.4 季节性智能调整

- **大促期间效果**：预计提升大促期间销售额20-30%
- **业务价值**：自动化季节性调整，减少人工干预，避免错过最佳投放时机

---

*文档版本：1.0*
*更新时间：2026年1月*
*作者：Manus AI*
