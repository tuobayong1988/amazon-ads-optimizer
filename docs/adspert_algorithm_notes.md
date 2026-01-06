# Adspert 核心算法深度研究笔记

## 一、Adspert概述

Adspert是德国专注广告领域15年的AI软件公司，其核心价值主张是通过预测型人工智能(Predictive AI)帮助亚马逊卖家实现广告利润最大化，而不仅仅是销量最大化。系统支持24/7自动化不间断优化。

### 支持的广告类型

| 广告类型 | 子类型 | 竞价管理 | 否定关键词 | 否定产品定位 | 展示位置调整 |
|---------|--------|---------|----------|------------|------------|
| Sponsored Products (SP) | 自动广告 | ✓ | ✓ | ✓ | ✓ |
| Sponsored Products (SP) | 手动广告 | ✓ | ✓ | ✓ | ✓ |
| Sponsored Brands (SB) | 品牌广告 | ✓ | ✓ | - | - |
| Sponsored Brands (SB) | 视频广告 | ✓ | ✓ | - | - |
| Sponsored Display (SD) | 产品定位 | ✓ | - | - | - |
| Sponsored Display (SD) | 受众定位 | ✓ | - | - | - |

---

## 二、核心算法1：市场曲线 (Market Curve)

### 2.1 算法来源与原理

市场曲线方法源自金融市场的量化分析方法，核心思想是通过建立出价(CPC)与各项指标之间的函数关系，找到最优出价点。

### 2.2 关键字执行参数的确定

在使用不同变量连续运行CPC弹性测试时，系统会考虑以下参数：
- **转换延迟** (Conversion Delay)：考虑归因窗口期
- **继承** (Inheritance)：从相似关键词/产品继承数据
- **历史数据** (Historical Data)：利用历史表现预测未来

### 2.3 市场曲线的四个维度

1. **展现曲线 (Impression Curve)**
   - 描述CPC与展现量的关系
   - 从"不在第一页"到"饱和"的连续变化
   - 公式：`Impressions = f(CPC)`

2. **点击率曲线 (CTR Curve)**
   - 描述展示位置与点击率的关系
   - 最高位置通常有更高的CTR
   - 公式：`CTR = g(Position)`

3. **支出曲线 (Spend Curve)**
   - 描述CPC与总支出的关系
   - 公式：`Spend = CPC × Clicks = CPC × Impressions × CTR`

4. **有效每次点击费用 (Effective CPC)**
   - 实际支付的平均点击成本
   - 考虑竞价动态和质量分

### 2.4 利润曲线与投资回报率曲线

对于每个关键词，系统计算：

**利润曲线 (Profit Curve)**：
```
Profit(CPC) = Revenue(CPC) - Cost(CPC)
            = Clicks(CPC) × CVR × AOV - Clicks(CPC) × CPC
            = Clicks(CPC) × (CVR × AOV - CPC)
```

**投资回报率曲线 (ROI Curve)**：
```
ROI(CPC) = (Revenue(CPC) - Cost(CPC)) / Cost(CPC)
         = (CVR × AOV - CPC) / CPC
         = (CVR × AOV / CPC) - 1
```

### 2.5 最优出价点计算

**利润最大化出价点**：
```
Max Profit CPC = argmax[Profit(CPC)]
               = argmax[Clicks(CPC) × (CVR × AOV - CPC)]
```

通过对利润函数求导并令其为0，可以找到最优CPC：
```
d(Profit)/d(CPC) = 0
```

### 2.6 最佳预算分配公式

```
最佳预算分配 = α × CPC_KW1 + β × CPC_KW2 + ... + φ × CPC_KWN
```

其中α, β, ..., φ是各关键词的预算权重，基于各关键词的边际利润贡献确定。

---

## 三、核心算法2：决策树 (Decision Tree)

### 3.1 决策树的输入特征

**活动信息**：
- 广告系列/广告组的命名结构（如：类别A > 子类别Aa > 品牌X）
- 目标和绩效组（每天成本）
- 预算
- 活动类型（产品广告、品牌广告等）
- 广告组合

**产品信息 (MWS)**：
- 标题
- 品牌（耐克、阿迪达斯等）
- 产品类别（家居、厨房等）
- 库存（缺货 vs 10件）
- 价格（5欧元、5000欧元等）
- 重量/高度/长度
- 制造商

**广告信息**：
- 匹配类型（广泛、短语、精确）
- 长尾关键词（字数）
- 不同的单词组合，搜索查询中的相似单词（词袋和自然语言处理）
- 关键词类型：品牌/竞争对手/通用/产品

### 3.2 决策树的分叉标准

**核心分叉指标**：
- **转化率 (CR - Conversion Rate)**
- **转化价值 (CV - Conversion Value)**

### 3.3 决策树示例结构

```
Account (根节点)
├── CR: 1.65%
├── CV: 291€
│
├── Generic (通用词)
│   ├── CR: 0.81%
│   ├── CV: 284€
│   │
│   ├── Samsung
│   │   ├── CR: 0.65%
│   │   └── CV: 262€
│   │
│   └── Apple
│       ├── CR: 1.26%
│       └── CV: 465€
│
└── Brand (品牌词)
    ├── CR: 2.83%
    ├── CV: 311€
    │
    ├── Broad match
    │   ├── CR: 2.46%
    │   └── CV: 293€
    │
    └── Exact match
        ├── CR: 4.26%
        └── CV: 323€
```

### 3.4 决策树的预测能力

**关键洞察**：Adspert决策树的分叉标准基于转化率和转化价值，由此可以预测**每一个关键词的最佳转化率和转化价值**，尤其是**长尾关键词，预测非常有效**。

**预测原理**：
1. 对于新关键词或数据不足的关键词，通过决策树找到其所属的叶节点
2. 使用该叶节点的平均CR和CV作为预测值
3. 结合市场曲线计算最优出价

**长尾关键词预测优势**：
- 长尾关键词通常数据稀疏
- 通过决策树的层级继承机制，可以从相似关键词群体获得可靠的预测值
- 避免了因数据不足导致的出价不准确

---

## 四、核心算法3：展示位置竞价调整 (Placement Bid Adjustments)

### 4.1 三大算法的协同工作

```
┌─────────────────┐
│  01. Market     │
│     Curve       │
└────────┬────────┘
         │
         ├──────────────────────┐
         │                      │
         ▼                      ▼
┌─────────────────┐    ┌─────────────────┐
│  02. Decision   │    │  03. Bid        │
│     Tree        │    │  Adjustments    │
└─────────────────┘    └─────────────────┘
                              │
                              ▼
                    针对每个维度进行优化
```

### 4.2 Adspert的展示位置竞价调整策略

**核心理念**：
> "由于Adspert在**竞价对象层面**上设置出价，并在**竞价对象层面**上估算广告利润（收入 - 广告支出），我们将为亚马逊设置**较低的展示位置竞价调整**，以便**更细致地**进行针对竞价对象出价。"

### 4.3 展示位置竞价调整的实现逻辑

**亚马逊展示位置类型**：
1. **搜索顶部 (Top of Search)** - 搜索结果首页顶部
2. **商品详情页 (Product Pages)** - 商品详情页面
3. **其余位置 (Rest of Search)** - 其他搜索结果位置

**Adspert的策略**：
1. 在关键词/ASIN层面设置精确的基础出价
2. 将展示位置调整设置为较低值（如0%或接近0%）
3. 这样可以让基础出价更精确地控制实际竞价

**为什么设置较低的展示位置调整**：
- 如果展示位置调整过高，实际出价 = 基础出价 × (1 + 调整比例)
- 这会导致基础出价的精确控制被稀释
- 较低的调整让系统能更精确地优化每个竞价对象

### 4.4 广告利润计算公式

在竞价对象层面估算广告利润：

```
广告利润 = 收入 - 广告支出
        = (转化数 × 平均订单价值) - (点击数 × 实际CPC)
        = Clicks × CVR × AOV - Clicks × CPC
        = Clicks × (CVR × AOV - CPC)
```

---

## 五、算法实现建议

### 5.1 市场曲线建模

```typescript
interface MarketCurveModel {
  // 展现曲线参数
  impressionCurve: {
    baseImpressions: number;
    cpcElasticity: number;  // CPC弹性系数
    saturationPoint: number; // 饱和点
  };
  
  // 点击率曲线参数
  ctrCurve: {
    baseCTR: number;
    positionFactor: number;
  };
  
  // 转化参数
  conversionParams: {
    cvr: number;  // 转化率
    aov: number;  // 平均订单价值
  };
}

// 计算利润最大化出价
function calculateOptimalBid(model: MarketCurveModel): number {
  // 利润 = Clicks × (CVR × AOV - CPC)
  // 对CPC求导，找到利润最大化点
  const { cvr, aov } = model.conversionParams;
  
  // 简化模型：假设点击量与CPC成对数关系
  // Clicks = k × ln(CPC + 1)
  // Profit = k × ln(CPC + 1) × (CVR × AOV - CPC)
  // 求导后：最优CPC ≈ CVR × AOV / 2 (在某些假设下)
  
  return cvr * aov * 0.5; // 简化计算
}
```

### 5.2 决策树预测

```typescript
interface DecisionTreeNode {
  feature?: string;  // 分叉特征
  threshold?: any;   // 分叉阈值
  left?: DecisionTreeNode;
  right?: DecisionTreeNode;
  
  // 叶节点数据
  isLeaf: boolean;
  predictedCR?: number;  // 预测转化率
  predictedCV?: number;  // 预测转化价值
  sampleCount?: number;  // 样本数量
}

function predictKeywordPerformance(
  tree: DecisionTreeNode,
  keyword: KeywordFeatures
): { cr: number; cv: number } {
  let node = tree;
  
  while (!node.isLeaf) {
    const featureValue = keyword[node.feature!];
    if (featureValue <= node.threshold) {
      node = node.left!;
    } else {
      node = node.right!;
    }
  }
  
  return {
    cr: node.predictedCR!,
    cv: node.predictedCV!
  };
}
```

### 5.3 展示位置竞价调整

```typescript
interface PlacementBidStrategy {
  // 基础出价（在关键词/ASIN层面精确设置）
  baseBid: number;
  
  // 展示位置调整（设置较低值以保持精确控制）
  placementAdjustments: {
    topOfSearch: number;      // 建议: 0-20%
    productPages: number;     // 建议: 0-20%
    restOfSearch: number;     // 基准: 0%
  };
}

// 计算各位置的实际出价
function calculateEffectiveBids(strategy: PlacementBidStrategy) {
  const { baseBid, placementAdjustments } = strategy;
  
  return {
    topOfSearch: baseBid * (1 + placementAdjustments.topOfSearch / 100),
    productPages: baseBid * (1 + placementAdjustments.productPages / 100),
    restOfSearch: baseBid * (1 + placementAdjustments.restOfSearch / 100)
  };
}

// 估算各位置的广告利润
function estimatePlacementProfit(
  placement: string,
  effectiveBid: number,
  metrics: PlacementMetrics
): number {
  const { clicks, cvr, aov } = metrics;
  return clicks * (cvr * aov - effectiveBid);
}
```

---

## 六、Adspert成功案例数据

| 案例 | 行业 | ACoS变化 | 销售额变化 | 其他指标 |
|------|------|---------|----------|---------|
| 深圳工业数字化头部卖家 | 3D打印 | -9.3% | +32.78% | 3个月内 |
| 深圳电脑配件头部卖家 | 电脑配件 | -2.42% | +32.27% | 曝光+8.29%, 点击+18.88%, 转化+24.86% |
| 杭州户外家居头部卖家 | 户外家居 | -3.86% | +116% | 曝光+55%, 点击+71%, 转化+127% |

---

## 七、关键结论

1. **市场曲线**是基础，用于建立CPC与各项指标的函数关系
2. **决策树**解决数据稀疏问题，特别适合长尾关键词预测
3. **展示位置调整**应设置较低值，让基础出价更精确地控制竞价
4. 三大算法协同工作，实现**竞价对象层面**的精确利润优化
5. 核心目标是**广告利润最大化**，而非单纯的销量或ACoS优化
