# Amazon广告产品研究笔记

## 一、Sponsored Brands (SB) 品牌广告完整结构

### 1.1 三种广告格式

| 格式 | 展示位置 | 落地页选项 | 显示商品数 | 定向方式 |
|-----|---------|-----------|-----------|---------|
| **Product Collection** | 搜索顶部、商品详情页、搜索底部 | 品牌旗舰店/子页面、自定义落地页、商品详情页 | 最多3个 | 关键词、ASIN、类目 |
| **Store Spotlight** | 搜索顶部、搜索底部 | 品牌旗舰店及子页面 | 3个(作为店铺页面) | 关键词、ASIN、类目 |
| **Video** | 搜索结果中 | **品牌旗舰店、商品详情页、自定义URL** | 1个(或多个) | 关键词、ASIN、类目 |

### 1.2 SB视频广告的落地页类型（重要发现）

根据Amazon官方文档，SB视频广告支持以下落地页：

1. **商品详情页 (Product Detail Page)** - 单个商品
2. **品牌旗舰店 (Store on Amazon)** - 包括子页面
3. **自定义URL (Custom URL)** - 自定义落地页
4. **新落地页 (New Landing Page)** - 创建新的落地页

**关键发现**：2023年8月起，SB视频广告支持以品牌旗舰店为落地页，可以在视频中展示产品集合。使用品牌旗舰店作为落地页的SB视频广告，平均转化率比使用商品详情页的广告高23%。

### 1.3 SB广告的竞价机制

| 竞价类型 | 适用场景 | 计费方式 | 优化目标 |
|---------|---------|---------|---------|
| **CPC (Cost Per Click)** | 默认模式 | 按点击付费 | 转化、销售 |
| **vCPM (Cost Per 1000 Viewable Impressions)** | 品牌曝光 | 按千次展示付费 | 品牌印象份额 |

**vCPM适用条件**：
- 广告目标选择"Grow Brand Impression Share（增加品牌印象份额）"
- 成功指标为"Top-of-Search Impression Share（搜索顶部展示份额）"

### 1.4 SB广告的目标类型

| 目标 | 竞价类型 | 成功指标 | 适用格式 |
|-----|---------|---------|---------|
| Drive page visits (增加页面访问) | CPC | 点击量、CTR | 全部 |
| Grow brand impression share (增加品牌曝光) | vCPM | 搜索顶部展示份额 | 全部 |
| Acquire new customers (获取新客户) | CPC | 新客户订单、NTB% | 全部 |

---

## 二、Sponsored Display (SD) 展示广告

### 2.1 定向类型

| 定向类型 | 描述 | 竞价选项 |
|---------|------|---------|
| 浏览再营销 (Views Remarketing) | 浏览过商品但未购买的用户 | CPC/vCPM |
| 购买再营销 (Purchases Remarketing) | 已购买过的用户 | CPC/vCPM |
| 相似受众 (Similar Audiences) | 与现有客户相似的用户 | CPC/vCPM |
| 商品定向 (Product Targeting) | 浏览特定商品/类目的用户 | CPC/vCPM |
| 兴趣定向 (Interest Targeting) | 特定兴趣的用户 | CPC/vCPM |
| 生活方式定向 (Lifestyle Targeting) | 特定生活方式的用户 | CPC/vCPM |

### 2.2 SD广告的竞价机制

| 竞价类型 | 适用场景 | 优化目标 |
|---------|---------|---------|
| **CPC** | 转化导向 | Optimize for conversions |
| **vCPM** | 曝光导向 | Optimize for reach |

---

## 三、Sponsored Products (SP) 商品推广

### 3.1 广告类型

| 类型 | 定向方式 | 匹配类型 |
|-----|---------|---------|
| **自动广告** | 系统自动匹配 | 紧密匹配、宽泛匹配、同类商品、关联商品 |
| **手动广告-关键词** | 手动选择关键词 | 精确、词组、广泛 |
| **手动广告-商品定向** | 手动选择ASIN/类目 | ASIN、类目 |

### 3.2 SP广告位置

| 位置 | 描述 | 竞价调整范围 |
|-----|------|-------------|
| Top of Search | 搜索结果首页顶部 | 0-900% |
| Product Pages | 商品详情页 | 0-900% |
| Rest of Search | 搜索结果其他位置 | 基础竞价 |

### 3.3 SP广告竞价策略

| 策略 | 描述 |
|-----|------|
| Dynamic bids - down only | 仅降低竞价（转化可能性低时） |
| Dynamic bids - up and down | 动态调整竞价（上下浮动最多100%） |
| Fixed bids | 固定竞价 |

---

## 四、关键发现总结

### 4.1 SB视频广告的特殊性

1. **不仅仅是单品广告**：SB视频可以链接到品牌旗舰店，展示多个商品
2. **支持vCPM竞价**：当目标是品牌曝光时，可以使用vCPM
3. **搜索核心**：虽然是品牌广告，但通过搜索触发，需要应用搜索广告优化逻辑
4. **落地页多样性**：支持商品详情页、品牌旗舰店、自定义URL

### 4.2 竞价机制差异

| 广告类型 | CPC | vCPM |
|---------|-----|------|
| SP | ✅ | ❌ |
| SB | ✅ | ✅ (品牌曝光目标) |
| SD | ✅ | ✅ (覆盖优化目标) |

### 4.3 优化算法设计要点

1. **SP广告**：纯CPC竞价，使用市场曲线+边际分析
2. **SB广告**：
   - CPC模式：市场曲线+边际分析+新客户价值
   - vCPM模式：展示份额优化+CPM效率分析
3. **SD广告**：
   - CPC模式：点击归因+浏览归因综合分析
   - vCPM模式：覆盖效率+频次控制

---

## References

1. Amazon Advertising - Sponsored Brands Video Guide
2. Amazon Advertising - Cost per 1000 viewable impressions (vCPM)
3. Amazon Advertising - Sponsored Brands goal-based campaigns
4. Amazon Advertising API Documentation
5. Perpetua - Amazon Sponsored Brands Ultimate Guide


---

## 五、SB视频广告的最新功能（2023年8月更新）

### 5.1 多ASIN视频广告 (Multi-ASIN Sponsored Brands Video)

**关键发现**：
- 2023年8月起，SB视频广告支持展示**1-3个商品**
- 之前仅支持单ASIN视频广告

**落地页行为**：
- 点击商品 → 跳转到对应商品详情页(PDP)
- 点击品牌元素（Logo、视频本身） → 跳转到品牌旗舰店

**性能数据（Amazon官方）**：
- 3-ASIN视频广告比1-ASIN视频广告：
  - CTR提高 **43.9%**
  - ROAS提高 **34.0%**

**重要限制**：
- 广告上线后，无法更改商品数量（1个变3个或反之）
- 可以更换商品，但数量固定

### 5.2 SB视频广告的完整落地页类型

根据最新研究，SB视频广告支持以下落地页：

| 落地页类型 | 描述 | 适用场景 |
|-----------|------|---------|
| **商品详情页 (PDP)** | 单个商品页面 | 单品推广 |
| **品牌旗舰店** | 品牌主页或子页面 | 品牌建设、多品展示 |
| **自定义落地页** | 自定义URL | 特殊营销活动 |

### 5.3 SB视频广告的优化要点

1. **搜索核心**：虽然是品牌广告，但通过搜索词触发，需要应用搜索广告优化逻辑
2. **双重落地页**：多ASIN视频同时支持PDP和品牌旗舰店，需要分析两种转化路径
3. **视频指标**：需要关注视频观看率、完播率等视频特有指标
4. **品牌价值**：需要考虑新客户获取(NTB)和品牌搜索提升

---

## 六、算法设计要点更新

### 6.1 SB视频广告优化算法

由于SB视频广告的特殊性，需要设计专门的优化算法：

**CPC模式（转化导向）**：
```
1. 应用市场曲线建模（搜索广告核心逻辑）
2. 边际分析计算最优竞价
3. 决策树判断调整方向
4. 考虑视频特有指标（观看率、完播率）
5. 计算新客户LTV价值
```

**vCPM模式（品牌曝光导向）**：
```
1. 计算有效CPM（eCPM = Cost / Impressions * 1000）
2. 分析搜索顶部展示份额
3. 优化展示效率而非点击效率
4. 控制频次避免用户疲劳
```

### 6.2 多ASIN视频广告的特殊处理

```
1. 分析各商品的点击分布
2. 计算品牌旗舰店vs商品详情页的转化率差异
3. 优化商品组合（哪3个商品一起展示效果最好）
4. 考虑交叉销售和追加销售机会
```


---

## 七、Amazon PPC竞价优化核心公式（行业最佳实践）

### 7.1 四类关键词的优化策略

| 类别 | 定义 | 优化公式 | 调整方向 |
|-----|------|---------|---------|
| **High ACOS** | ACoS > 目标ACoS | New Bid = RPC × Target ACoS | 降低竞价 |
| **High Spend Non-Converting** | 花费 > Target CPA 且无转化 | New Bid = AOV / Clicks × Target ACoS | 降低竞价 |
| **Low ACOS** | ACoS < 目标ACoS × 0.8 | Current Bid × 1.05~1.10 | 提高5-10% |
| **Low Visibility** | 点击数 < 平均点击转化数 | Current Bid × 1.05 | 提高5% |

### 7.2 核心公式详解

**1. Revenue Per Click (RPC) 方法**
```
RPC = Sales / Clicks
New Bid = RPC × Target ACoS

示例：
- Target ACoS = 30%
- RPC = $5 (Sales $50 / Clicks 10)
- New Bid = $5 × 0.30 = $1.50
```

**2. Target CPA 计算**
```
Target CPA = Target ACoS × AOV

示例：
- Target ACoS = 30%
- AOV = $20
- Target CPA = 0.30 × $20 = $6.00
```

**3. High Spend Non-Converting 公式**
```
Anticipated RPC = AOV / Current Clicks
New Bid = Anticipated RPC × Target ACoS

示例：
- AOV = $20
- Current Clicks = 10 (无转化)
- Target ACoS = 30%
- New Bid = ($20 / 10) × 0.30 = $0.60
```

**4. Low ACOS 缓冲区**
```
Low ACOS Threshold = Target ACoS × 0.80

示例：
- Target ACoS = 30%
- Low ACOS Threshold = 30% × 0.80 = 24%
- 只有ACoS < 24%的关键词才提高竞价
```

### 7.3 与我们算法的对比

| 维度 | 行业常规做法 | 我们的算法 | 差异分析 |
|-----|------------|-----------|---------|
| 高ACoS处理 | RPC × Target ACoS | 市场曲线 + 边际分析 | 我们更精确，考虑市场竞争 |
| 低ACoS处理 | 固定+5-10% | 决策树动态调整 | 我们更灵活 |
| 无转化处理 | Anticipated RPC | 贝叶斯先验 + 决策树 | 我们考虑不确定性 |
| 低曝光处理 | 固定+5% | 市场曲线预测 | 我们预测潜在收益 |

### 7.4 改进建议

1. **融合RPC方法**：在边际分析基础上，增加RPC作为参考指标
2. **增加缓冲区逻辑**：Low ACoS判断增加20%缓冲区
3. **Target CPA阈值**：无转化关键词使用Target CPA作为花费阈值
4. **渐进式调整**：低ACoS关键词采用小幅渐进式提价（5-10%）
