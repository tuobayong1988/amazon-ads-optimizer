# Amazon广告API数据能力与可立即实现的特殊场景分析

## 一、API可获取的数据字段分析

### 1.1 广告活动级别数据

| 数据字段 | 来源 | 可用性 | 说明 |
|---------|------|:------:|------|
| campaignId | Campaign API | ✅ | 广告活动唯一标识 |
| campaignName | Campaign API | ✅ | 广告活动名称 |
| campaignType | Campaign API | ✅ | SP/SB/SD类型 |
| targetingType | Campaign API | ✅ | 自动/手动定向 |
| dailyBudget | Campaign API | ✅ | 每日预算 |
| campaignStatus | Campaign API | ✅ | 启用/暂停/归档 |
| placementBidAdjustments | Campaign API | ✅ | 位置竞价调整(TOS/PP/ROS) |
| impressions | Report API | ✅ | 展示次数 |
| clicks | Report API | ✅ | 点击次数 |
| spend | Report API | ✅ | 花费 |
| sales | Report API | ✅ | 销售额 |
| orders | Report API | ✅ | 订单数 |
| acos | 计算值 | ✅ | spend/sales |
| roas | 计算值 | ✅ | sales/spend |
| ctr | 计算值 | ✅ | clicks/impressions |
| cvr | 计算值 | ✅ | orders/clicks |
| cpc | 计算值 | ✅ | spend/clicks |

### 1.2 关键词/定向级别数据

| 数据字段 | 来源 | 可用性 | 说明 |
|---------|------|:------:|------|
| keywordId/targetId | Keyword/Target API | ✅ | 唯一标识 |
| keywordText/targetValue | API | ✅ | 关键词文本/ASIN |
| matchType | API | ✅ | 匹配类型 |
| bid | API | ✅ | 当前出价 |
| status | API | ✅ | 状态 |
| impressions/clicks/spend/sales/orders | Report API | ✅ | 绩效数据 |

### 1.3 搜索词报告数据

| 数据字段 | 来源 | 可用性 | 说明 |
|---------|------|:------:|------|
| searchTerm | Search Term Report | ✅ | 客户搜索词 |
| query | Search Term Report | ✅ | 触发的投放词 |
| matchType | Search Term Report | ✅ | 匹配方式 |
| impressions/clicks/spend/sales/orders | Report | ✅ | 绩效数据 |

### 1.4 **不可直接获取的数据**

| 数据字段 | 原因 | 替代方案 |
|---------|------|---------|
| 库存数量 | 需要SP-API（卖家API） | 用户手动输入或集成SP-API |
| 竞品价格 | 需要Product Advertising API | 第三方工具或手动监控 |
| Review/Rating | 需要Product Advertising API | 第三方工具或手动监控 |
| 小时级花费数据 | 报告API仅支持日级 | 通过分时预算规则间接推算 |
| 预算消耗进度 | 无直接API | 通过当日花费/日预算计算 |

---

## 二、可立即实现的特殊场景分析

基于现有API数据能力，以下场景可以**立即实现**：

### 2.1 ✅ 预算耗尽检测与预警

**数据依赖**：
- dailyBudget（日预算）- ✅ 可获取
- spend（当日花费）- ✅ 可获取（通过当日报告）
- 历史花费模式 - ✅ 可从dailyPerformance表计算

**实现方案**：
```typescript
// 预算消耗率 = 当日花费 / 日预算
// 预算消耗速度 = 当日花费 / 已过去小时数
// 预计耗尽时间 = (日预算 - 当日花费) / 消耗速度

interface BudgetDepletionAnalysis {
  campaignId: number;
  dailyBudget: number;
  currentSpend: number;
  spendRate: number;           // 每小时消耗速度
  consumptionPercent: number;  // 当前消耗百分比
  estimatedDepletionHour: number; // 预计耗尽时间
  riskLevel: 'safe' | 'warning' | 'critical';
  recommendation: string;
}
```

**可行性**：⭐⭐⭐⭐⭐ 完全可行

---

### 2.2 ✅ 归因窗口数据延迟调整

**数据依赖**：
- 历史数据（7天前的数据已完成归因）- ✅ 可获取
- 近期数据（1-3天数据可能不完整）- ✅ 可获取

**实现方案**：
```typescript
// 通过对比历史数据的归因完成模式，估算近期数据的归因调整系数
// 例如：第1天数据通常只有70%的转化归因完成，第3天达到95%

interface AttributionAdjustment {
  dataAge: number;           // 数据天数
  rawAcos: number;           // 原始ACoS
  adjustedAcos: number;      // 调整后ACoS
  adjustmentFactor: number;  // 调整系数
  confidence: number;        // 置信度
}

// 归因调整系数（基于行业经验）
const ATTRIBUTION_FACTORS = {
  day1: 0.70,  // 第1天数据约70%完成归因
  day2: 0.85,  // 第2天约85%
  day3: 0.95,  // 第3天约95%
  day7: 1.00,  // 第7天100%
};
```

**可行性**：⭐⭐⭐⭐⭐ 完全可行

---

### 2.3 ✅ 竞价效率分析（过度竞价检测）

**数据依赖**：
- bid（当前出价）- ✅ 可获取
- cpc（实际CPC）- ✅ 可计算（spend/clicks）
- cvr（转化率）- ✅ 可计算（orders/clicks）
- 产品价格/利润 - ⚠️ 需要用户配置

**实现方案**：
```typescript
// 目标CPC = 目标ACoS × CVR × 产品价格
// 竞价效率 = 实际CPC / 目标CPC
// 如果竞价效率 > 1.5，说明过度竞价

interface BidEfficiencyAnalysis {
  keywordId: number;
  currentBid: number;
  actualCpc: number;
  targetCpc: number;
  bidEfficiency: number;
  isOverbidding: boolean;
  suggestedBid: number;
  potentialSavings: number;
}
```

**可行性**：⭐⭐⭐⭐ 高度可行（需要用户配置产品利润）

---

### 2.4 ✅ 广告疲劳检测

**数据依赖**：
- 历史CTR趋势 - ✅ 可从dailyPerformance计算
- 广告创建时间 - ✅ 可获取

**实现方案**：
```typescript
// 计算CTR的周环比变化趋势
// 如果连续3周CTR下降超过10%，判定为广告疲劳

interface AdFatigueAnalysis {
  campaignId: number;
  adAge: number;              // 广告运行天数
  ctrTrend: number[];         // 周CTR趋势
  ctrDeclineRate: number;     // CTR下降率
  fatigueLevel: 'none' | 'mild' | 'moderate' | 'severe';
  recommendation: string;
}
```

**可行性**：⭐⭐⭐⭐⭐ 完全可行

---

### 2.5 ✅ 账户健康度分析

**数据依赖**：
- 所有广告活动数据 - ✅ 可获取
- 关键词/定向数据 - ✅ 可获取
- 否定词数据 - ✅ 可获取

**实现方案**：
```typescript
// 检测重复定向、冲突否定词、孤立广告活动等问题

interface AccountHealthAnalysis {
  totalCampaigns: number;
  activeCampaigns: number;
  duplicateTargeting: number;      // 重复定向数量
  conflictingNegatives: number;    // 冲突否定词数量
  orphanedCampaigns: number;       // 无数据广告活动
  lowPerformingKeywords: number;   // 低效关键词数量
  healthScore: number;             // 0-100健康评分
  issues: HealthIssue[];
}
```

**可行性**：⭐⭐⭐⭐⭐ 完全可行

---

### 2.6 ✅ 结构限制预警

**数据依赖**：
- 广告组数量 - ✅ 可获取
- 关键词数量 - ✅ 可获取

**实现方案**：
```typescript
// 检测是否接近Amazon的结构限制（1000广告组/活动，1000关键词/广告组）

interface StructureLimitAnalysis {
  campaignId: number;
  adGroupCount: number;
  maxAdGroups: number;
  adGroupUsagePercent: number;
  keywordsPerAdGroup: Record<number, number>;
  nearingLimit: boolean;
  recommendation: string;
}
```

**可行性**：⭐⭐⭐⭐⭐ 完全可行

---

### 2.7 ⚠️ 季节性调整（部分可行）

**数据依赖**：
- 历史绩效数据 - ✅ 可获取
- 大促日历 - ✅ 可硬编码（Prime Day、黑五等）
- 实时竞争环境 - ❌ 无法获取

**实现方案**：
```typescript
// 基于历史数据和预设大促日历，自动调整策略

interface SeasonalAdjustment {
  currentPeriod: 'normal' | 'pre_prime' | 'prime_day' | 'black_friday' | 'christmas';
  bidMultiplier: number;
  budgetMultiplier: number;
  acosToleranceMultiplier: number;
  strategy: SeasonalStrategy;
}
```

**可行性**：⭐⭐⭐⭐ 高度可行（基于预设规则）

---

### 2.8 ❌ 库存联动（需要额外集成）

**数据依赖**：
- 库存数量 - ❌ 需要SP-API
- 销售速度 - ✅ 可从orders计算

**替代方案**：
- 允许用户手动输入库存数量
- 提供SP-API集成选项

**可行性**：⭐⭐ 需要额外开发

---

### 2.9 ❌ 竞品价格监控（需要额外集成）

**数据依赖**：
- 竞品价格 - ❌ 需要Product Advertising API

**替代方案**：
- 允许用户手动输入竞品价格
- 集成第三方价格监控服务

**可行性**：⭐⭐ 需要额外开发

---

## 三、可立即实现的场景优先级排序

| 优先级 | 场景 | 数据可用性 | 实现复杂度 | 业务价值 |
|:-----:|------|:---------:|:---------:|:-------:|
| **P0** | 预算耗尽检测与预警 | ⭐⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐⭐ |
| **P0** | 归因窗口数据延迟调整 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **P1** | 竞价效率分析 | ⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐ |
| **P1** | 季节性调整 | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ |
| **P2** | 广告疲劳检测 | ⭐⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐ |
| **P2** | 账户健康度分析 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ |
| **P3** | 结构限制预警 | ⭐⭐⭐⭐⭐ | ⭐ | ⭐⭐ |

---

## 四、建议立即实现的场景

基于以上分析，建议**立即实现**以下4个场景：

### 4.1 预算耗尽检测与预警（P0）

**原因**：
- 数据完全可用
- 实现简单
- 业务价值极高（避免错过销售机会）

### 4.2 归因窗口数据延迟调整（P0）

**原因**：
- 数据完全可用
- 可显著提高算法准确性
- 避免因数据不完整导致的错误决策

### 4.3 竞价效率分析（P1）

**原因**：
- 数据基本可用
- 可直接节省广告费用
- 与现有竞价优化算法无缝集成

### 4.4 季节性调整（P1）

**原因**：
- 可基于预设规则实现
- 大促期间价值极高
- 避免人工干预

---

*文档更新时间：2026年1月*
