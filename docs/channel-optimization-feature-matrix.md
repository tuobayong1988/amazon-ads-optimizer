# Amazon广告分渠道优化功能映射矩阵

**版本**: 1.0  
**作者**: Manus AI  
**更新日期**: 2026年1月8日

---

## 一、优化功能清单

本系统支持以下核心优化功能：

| 功能编号 | 功能名称 | 功能描述 |
|---------|---------|---------|
| F1 | **分时预算** | 根据不同时段的转化效率动态调整预算分配 |
| F2 | **分时竞价** | 84个时段（7天×12时段）独立控制竞价系数 |
| F3 | **位置倾斜** | 调整不同广告位置的竞价倍数（搜索顶部、商品页、其他位置） |
| F4 | **竞价调整** | 基于市场曲线、边际分析、决策树的智能竞价优化 |
| F5 | **搜索词分析** | 分析客户搜索词表现，识别高价值词和低效词 |
| F6 | **搜索ASIN分析** | 分析商品定向ASIN的表现，优化ASIN定向策略 |
| F7 | **关键词迁移** | 将高价值搜索词从自动广告迁移到手动广告 |
| F8 | **否定词管理** | 添加否定关键词或否定ASIN，排除低效流量 |
| F9 | **暂停/启用** | 暂停低效广告或启用高潜力广告 |

---

## 二、广告类型完整分类

### 2.1 SP商品推广广告 (Sponsored Products)

| 子类型 | 定向方式 | 匹配类型 | 竞价机制 |
|-------|---------|---------|---------|
| **SP自动广告** | 系统自动匹配 | 紧密匹配、宽泛匹配、同类商品、关联商品 | CPC |
| **SP手动-关键词** | 手动选择关键词 | 精确匹配、词组匹配、广泛匹配 | CPC |
| **SP手动-商品定向** | 手动选择ASIN/类目 | ASIN定向、类目定向 | CPC |

### 2.2 SB品牌广告 (Sponsored Brands)

| 子类型 | 定向方式 | 落地页 | 竞价机制 |
|-------|---------|-------|---------|
| **SB商品集合** | 关键词/ASIN/类目 | 旗舰店、自定义页、PDP | CPC / vCPM |
| **SB品牌旗舰店聚焦** | 关键词/ASIN/类目 | 旗舰店子页面 | CPC / vCPM |
| **SB视频广告-单品** | 关键词/ASIN/类目 | 商品详情页 | CPC / vCPM |
| **SB视频广告-多ASIN** | 关键词/ASIN/类目 | 旗舰店+PDP | CPC / vCPM |
| **SB品牌视频** | 关键词/ASIN/类目 | 品牌旗舰店 | CPC / vCPM |

### 2.3 SD展示广告 (Sponsored Display)

| 子类型 | 定向方式 | 展示位置 | 竞价机制 |
|-------|---------|---------|---------|
| **SD浏览再营销** | 受众定向 | 站内外展示位 | CPC / vCPM |
| **SD购买再营销** | 受众定向 | 站内外展示位 | CPC / vCPM |
| **SD相似受众** | 受众定向 | 站内外展示位 | CPC / vCPM |
| **SD商品定向** | ASIN/类目定向 | 站内外展示位 | CPC / vCPM |
| **SD兴趣定向** | 受众定向 | 站内外展示位 | CPC / vCPM |
| **SD生活方式定向** | 受众定向 | 站内外展示位 | CPC / vCPM |

---

## 三、功能支持矩阵

### 3.1 SP商品推广广告功能支持

| 功能 | SP自动广告 | SP手动-关键词 | SP手动-商品定向 | 说明 |
|-----|:----------:|:-------------:|:---------------:|------|
| **F1 分时预算** | ✅ | ✅ | ✅ | 所有SP广告支持 |
| **F2 分时竞价** | ✅ | ✅ | ✅ | 所有SP广告支持 |
| **F3 位置倾斜** | ✅ | ✅ | ✅ | 搜索顶部/商品页/其他位置 |
| **F4 竞价调整** | ✅ | ✅ | ✅ | 市场曲线+边际分析+决策树 |
| **F5 搜索词分析** | ✅ | ✅ | ✅ | **商品定向广告也有搜索词报告**（around the target原则） |
| **F6 搜索ASIN分析** | ✅ | ❌ | ✅ | 自动广告和商品定向有ASIN报告 |
| **F7 关键词迁移** | ✅ | ❌ | ❌ | 从自动广告迁移到手动广告 |
| **F8 否定词管理** | ✅ | ✅ | ✅ | 否定关键词/否定ASIN |
| **F9 暂停/启用** | ✅ | ✅ | ✅ | 所有SP广告支持 |

### 3.2 SB品牌广告功能支持

| 功能 | SB商品集合 | SB旗舰店聚焦 | SB视频-单品 | SB视频-多ASIN | SB品牌视频 | 说明 |
|-----|:----------:|:------------:|:-----------:|:-------------:|:----------:|------|
| **F1 分时预算** | ✅ | ✅ | ✅ | ✅ | ✅ | 所有SB广告支持 |
| **F2 分时竞价** | ✅ | ✅ | ✅ | ✅ | ✅ | 所有SB广告支持 |
| **F3 位置倾斜** | ✅ | ✅ | ⚠️ | ⚠️ | ⚠️ | 视频广告位置选项有限 |
| **F4 竞价调整** | ✅ | ✅ | ✅ | ✅ | ✅ | CPC模式使用搜索广告逻辑 |
| **F5 搜索词分析** | ✅ | ✅ | ✅ | ✅ | ✅ | **所有SB广告都是搜索触发** |
| **F6 搜索ASIN分析** | ✅ | ✅ | ✅ | ✅ | ✅ | ASIN定向时可用 |
| **F7 关键词迁移** | ❌ | ❌ | ❌ | ❌ | ❌ | SB广告不支持迁移 |
| **F8 否定词管理** | ✅ | ✅ | ✅ | ✅ | ✅ | 否定关键词/否定ASIN |
| **F9 暂停/启用** | ✅ | ✅ | ✅ | ✅ | ✅ | 所有SB广告支持 |

**重要说明**：SB视频广告虽然归类为品牌广告，但其本质是**搜索广告**，通过搜索词触发，因此需要完整应用搜索词分析功能。

### 3.3 SD展示广告功能支持

| 功能 | SD浏览再营销 | SD购买再营销 | SD相似受众 | SD商品定向 | SD兴趣定向 | SD生活方式 | 说明 |
|-----|:------------:|:------------:|:----------:|:----------:|:----------:|:----------:|------|
| **F1 分时预算** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 所有SD广告支持 |
| **F2 分时竞价** | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | 效果有限，展示广告时段敏感度低 |
| **F3 位置倾斜** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | SD广告无位置竞价调整 |
| **F4 竞价调整** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 考虑浏览归因 |
| **F5 搜索词分析** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | SD广告无搜索词报告 |
| **F6 搜索ASIN分析** | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | 仅商品定向有ASIN报告 |
| **F7 关键词迁移** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | SD广告不支持迁移 |
| **F8 否定词管理** | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | 仅商品定向支持否定ASIN |
| **F9 暂停/启用** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 所有SD广告支持 |

---

## 四、功能适配算法

### 4.1 功能适配器设计

```typescript
interface OptimizationFeatureAdapter {
  // 获取广告类型支持的功能列表
  getSupportedFeatures(adType: AdType): OptimizationFeature[];
  
  // 检查特定功能是否支持
  isFeatureSupported(adType: AdType, feature: OptimizationFeature): boolean;
  
  // 获取功能的适配参数
  getFeatureParams(adType: AdType, feature: OptimizationFeature): FeatureParams;
}

type AdType = 
  | 'SP_AUTO' 
  | 'SP_MANUAL_KEYWORD' 
  | 'SP_MANUAL_PRODUCT'
  | 'SB_PRODUCT_COLLECTION'
  | 'SB_STORE_SPOTLIGHT'
  | 'SB_VIDEO_SINGLE'
  | 'SB_VIDEO_MULTI_ASIN'
  | 'SB_BRAND_VIDEO'
  | 'SD_VIEWS_REMARKETING'
  | 'SD_PURCHASES_REMARKETING'
  | 'SD_SIMILAR_AUDIENCES'
  | 'SD_PRODUCT_TARGETING'
  | 'SD_INTEREST_TARGETING'
  | 'SD_LIFESTYLE_TARGETING';

type OptimizationFeature = 
  | 'DAYPARTING_BUDGET'
  | 'DAYPARTING_BID'
  | 'PLACEMENT_MODIFIER'
  | 'BID_OPTIMIZATION'
  | 'SEARCH_TERM_ANALYSIS'
  | 'SEARCH_ASIN_ANALYSIS'
  | 'KEYWORD_MIGRATION'
  | 'NEGATIVE_TARGETING'
  | 'PAUSE_ENABLE';
```

### 4.2 功能支持映射表

```typescript
const FEATURE_SUPPORT_MATRIX: Record<AdType, OptimizationFeature[]> = {
  // SP广告
  SP_AUTO: [
    'DAYPARTING_BUDGET', 'DAYPARTING_BID', 'PLACEMENT_MODIFIER',
    'BID_OPTIMIZATION', 'SEARCH_TERM_ANALYSIS', 'SEARCH_ASIN_ANALYSIS',
    'KEYWORD_MIGRATION', 'NEGATIVE_TARGETING', 'PAUSE_ENABLE'
  ],
  SP_MANUAL_KEYWORD: [
    'DAYPARTING_BUDGET', 'DAYPARTING_BID', 'PLACEMENT_MODIFIER',
    'BID_OPTIMIZATION', 'SEARCH_TERM_ANALYSIS',
    'NEGATIVE_TARGETING', 'PAUSE_ENABLE'
  ],
  SP_MANUAL_PRODUCT: [
    'DAYPARTING_BUDGET', 'DAYPARTING_BID', 'PLACEMENT_MODIFIER',
    'BID_OPTIMIZATION', 'SEARCH_ASIN_ANALYSIS',
    'NEGATIVE_TARGETING', 'PAUSE_ENABLE'
  ],
  
  // SB广告 - 所有类型都支持搜索词分析（因为都是搜索触发）
  SB_PRODUCT_COLLECTION: [
    'DAYPARTING_BUDGET', 'DAYPARTING_BID', 'PLACEMENT_MODIFIER',
    'BID_OPTIMIZATION', 'SEARCH_TERM_ANALYSIS', 'SEARCH_ASIN_ANALYSIS',
    'NEGATIVE_TARGETING', 'PAUSE_ENABLE'
  ],
  SB_STORE_SPOTLIGHT: [
    'DAYPARTING_BUDGET', 'DAYPARTING_BID', 'PLACEMENT_MODIFIER',
    'BID_OPTIMIZATION', 'SEARCH_TERM_ANALYSIS', 'SEARCH_ASIN_ANALYSIS',
    'NEGATIVE_TARGETING', 'PAUSE_ENABLE'
  ],
  SB_VIDEO_SINGLE: [
    'DAYPARTING_BUDGET', 'DAYPARTING_BID',
    'BID_OPTIMIZATION', 'SEARCH_TERM_ANALYSIS', 'SEARCH_ASIN_ANALYSIS',
    'NEGATIVE_TARGETING', 'PAUSE_ENABLE'
  ],
  SB_VIDEO_MULTI_ASIN: [
    'DAYPARTING_BUDGET', 'DAYPARTING_BID',
    'BID_OPTIMIZATION', 'SEARCH_TERM_ANALYSIS', 'SEARCH_ASIN_ANALYSIS',
    'NEGATIVE_TARGETING', 'PAUSE_ENABLE'
  ],
  SB_BRAND_VIDEO: [
    'DAYPARTING_BUDGET', 'DAYPARTING_BID',
    'BID_OPTIMIZATION', 'SEARCH_TERM_ANALYSIS', 'SEARCH_ASIN_ANALYSIS',
    'NEGATIVE_TARGETING', 'PAUSE_ENABLE'
  ],
  
  // SD广告 - 功能受限
  SD_VIEWS_REMARKETING: [
    'DAYPARTING_BUDGET', 'BID_OPTIMIZATION', 'PAUSE_ENABLE'
  ],
  SD_PURCHASES_REMARKETING: [
    'DAYPARTING_BUDGET', 'BID_OPTIMIZATION', 'PAUSE_ENABLE'
  ],
  SD_SIMILAR_AUDIENCES: [
    'DAYPARTING_BUDGET', 'BID_OPTIMIZATION', 'PAUSE_ENABLE'
  ],
  SD_PRODUCT_TARGETING: [
    'DAYPARTING_BUDGET', 'BID_OPTIMIZATION', 'SEARCH_ASIN_ANALYSIS',
    'NEGATIVE_TARGETING', 'PAUSE_ENABLE'
  ],
  SD_INTEREST_TARGETING: [
    'DAYPARTING_BUDGET', 'BID_OPTIMIZATION', 'PAUSE_ENABLE'
  ],
  SD_LIFESTYLE_TARGETING: [
    'DAYPARTING_BUDGET', 'BID_OPTIMIZATION', 'PAUSE_ENABLE'
  ]
};
```

---

## 五、分渠道优化算法详解

### 5.1 SP广告优化算法

#### 5.1.1 SP自动广告

SP自动广告是最完整的广告类型，支持所有优化功能：

**搜索词分析流程**：
1. 获取搜索词报告数据
2. 按四种匹配类型（紧密/宽泛/同类/关联）分组分析
3. 识别高价值搜索词（低ACoS、高转化）
4. 识别低效搜索词（高ACoS、无转化）
5. 生成迁移建议（高价值词→手动广告）
6. 生成否定建议（低效词→否定关键词）

**搜索ASIN分析流程**：
1. 获取商品定向报告数据
2. 分析各ASIN的表现（ACoS、转化率、ROAS）
3. 识别高效ASIN（建议提高竞价）
4. 识别低效ASIN（建议否定或降低竞价）

**关键词迁移流程**：
1. 从搜索词报告中筛选高价值词
2. 判断最佳匹配类型（精确/词组/广泛）
3. 计算建议竞价
4. 生成迁移计划
5. 迁移后在原广告中添加否定

#### 5.1.2 SP手动-关键词广告

**搜索词分析流程**：
1. 获取搜索词报告数据
2. 分析各搜索词与投放关键词的匹配关系
3. 识别需要精确匹配的高价值词
4. 识别需要否定的低效词
5. 生成优化建议

**竞价调整流程**：
1. 按关键词分层（头部/腰部/长尾）
2. 头部词：市场曲线+边际分析
3. 腰部词：决策树+规则
4. 长尾词：贝叶斯先验+决策树

#### 5.1.3 SP手动-商品定向广告

**搜索ASIN分析流程**：
1. 获取商品定向报告数据
2. 分析各定向ASIN的表现
3. 识别高效ASIN（建议提高竞价或扩展类似ASIN）
4. 识别低效ASIN（建议否定或降低竞价）

**否定ASIN管理**：
- 支持广告组层级否定ASIN
- 支持广告活动层级否定ASIN

### 5.2 SB广告优化算法

#### 5.2.1 SB商品集合/旗舰店聚焦

这两种格式的优化逻辑相似：

**搜索词分析流程**：
1. 获取搜索词报告数据
2. 分析搜索词与品牌/商品的相关性
3. 识别品牌词（包含品牌名称的搜索词）
4. 识别高价值通用词
5. 生成否定建议（低效词）

**新客户指标处理**：
1. 获取新客户销售额(NTB Sales)
2. 计算新客户占比(NTB%)
3. 计算客户LTV调整后的ACoS
4. 基于调整后ACoS进行竞价优化

**位置倾斜**：
- 搜索顶部：0-900%调整
- 搜索底部：基础竞价

#### 5.2.2 SB视频广告（关键更新）

**核心认知**：SB视频广告虽然是品牌广告，但本质是**搜索广告**，通过搜索词触发。

**搜索词分析流程**（与SP手动关键词类似）：
1. 获取搜索词报告数据
2. 分析搜索词表现（CTR、CVR、ACoS）
3. 识别高价值搜索词
4. 识别低效搜索词
5. 生成否定建议

**视频特有指标**：
1. 观看率(View Rate)
2. 完播率(Completion Rate)
3. 25%/50%/75%观看点

**竞价调整**：
- CPC模式：应用完整的搜索广告优化逻辑（市场曲线+边际分析+决策树）
- vCPM模式：优化展示效率和品牌印象份额

**多ASIN视频特殊处理**：
1. 分析各商品的点击分布
2. 分析品牌旗舰店vs商品详情页的转化率差异
3. 优化商品组合建议

### 5.3 SD广告优化算法

#### 5.3.1 SD受众定向广告

SD受众定向广告（浏览再营销、购买再营销、相似受众、兴趣定向、生活方式定向）的优化功能相对有限：

**竞价调整**：
1. 考虑双重归因（点击归因+浏览归因）
2. 计算有效ROAS = (点击归因销售额 + 浏览归因销售额×权重) / 花费
3. 基于有效ROAS进行竞价调整

**频次控制**：
1. 监控展示频次（Impressions / Reach）
2. 频次过高时建议扩大受众或降低竞价
3. 频次过低时建议提高竞价

**CPC vs vCPM选择**：
1. 转化导向使用CPC
2. 品牌认知导向使用vCPM
3. CTR极低时建议切换到vCPM

#### 5.3.2 SD商品定向广告

SD商品定向是SD广告中功能最完整的类型：

**搜索ASIN分析**：
1. 获取商品定向报告数据
2. 分析各定向ASIN的表现
3. 识别高效ASIN
4. 识别低效ASIN

**否定ASIN管理**：
- 支持否定特定ASIN
- 支持否定特定类目

---

## 六、vCPM模式特殊处理

当广告使用vCPM竞价时，优化逻辑需要调整：

### 6.1 适用场景

| 广告类型 | vCPM适用条件 |
|---------|-------------|
| SB广告 | 广告目标选择"增加品牌印象份额" |
| SD广告 | 优化目标选择"覆盖优化" |

### 6.2 vCPM优化算法

```typescript
interface VcpmOptimization {
  // 展示效率指标
  metrics: {
    impressions: number;
    viewableImpressions: number;
    effectiveCPM: number; // Cost / Impressions * 1000
    topOfSearchImpressionShare: number;
  };
  
  // 优化目标
  goals: {
    targetImpressionShare: number;
    maxCPM: number;
  };
  
  // 优化决策
  decision: {
    action: 'increase_cpm' | 'decrease_cpm' | 'maintain';
    newCPM: number;
    reason: string;
  };
}

function optimizeVcpmBid(
  currentCPM: number,
  currentImpressionShare: number,
  targetImpressionShare: number,
  maxCPM: number
): VcpmOptimization['decision'] {
  if (currentImpressionShare < targetImpressionShare * 0.9) {
    // 展示份额不足，提高CPM
    const newCPM = Math.min(currentCPM * 1.1, maxCPM);
    return {
      action: 'increase_cpm',
      newCPM,
      reason: `展示份额${currentImpressionShare}%低于目标${targetImpressionShare}%`
    };
  } else if (currentImpressionShare > targetImpressionShare * 1.1) {
    // 展示份额超标，可以降低CPM节省成本
    return {
      action: 'decrease_cpm',
      newCPM: currentCPM * 0.95,
      reason: `展示份额${currentImpressionShare}%超过目标，可优化成本`
    };
  }
  
  return {
    action: 'maintain',
    newCPM: currentCPM,
    reason: '展示份额在目标范围内'
  };
}
```

---

## 七、实现优先级

### 7.1 第一优先级（核心功能）

| 功能 | 适用广告类型 | 实现复杂度 |
|-----|------------|-----------|
| 竞价调整 | 所有类型 | 高 |
| 搜索词分析 | SP自动/手动关键词, SB全部 | 中 |
| 否定词管理 | SP全部, SB全部, SD商品定向 | 低 |
| 暂停/启用 | 所有类型 | 低 |

### 7.2 第二优先级（增强功能）

| 功能 | 适用广告类型 | 实现复杂度 |
|-----|------------|-----------|
| 分时竞价 | SP全部, SB全部 | 中 |
| 位置倾斜 | SP全部, SB商品集合/旗舰店 | 中 |
| 关键词迁移 | SP自动 | 中 |
| 搜索ASIN分析 | SP自动/商品定向, SB全部, SD商品定向 | 中 |

### 7.3 第三优先级（高级功能）

| 功能 | 适用广告类型 | 实现复杂度 |
|-----|------------|-----------|
| 分时预算 | 所有类型 | 高 |
| vCPM优化 | SB全部, SD全部 | 高 |
| 新客户LTV调整 | SB全部 | 中 |

---

## References

1. Amazon Advertising API Documentation
2. Amazon Sponsored Products Developer Guide
3. Amazon Sponsored Brands Developer Guide
4. Amazon Sponsored Display Developer Guide
