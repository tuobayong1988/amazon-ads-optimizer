# Amazon广告类型完整数据结构

## 一、SP商品推广广告 (Sponsored Products)

### 1.1 SP自动广告 (SP Auto)

**广告活动层级**
- campaignId: 广告活动ID
- campaignName: 广告活动名称
- campaignStatus: 状态 (enabled/paused/archived)
- targetingType: auto (自动)
- dailyBudget: 日预算
- budgetType: 预算类型 (daily/lifetime)
- startDate: 开始日期
- endDate: 结束日期
- biddingStrategy: 竞价策略 (legacyForSales/autoForSales/manual)
- portfolioId: 组合ID

**广告组层级**
- adGroupId: 广告组ID
- adGroupName: 广告组名称
- defaultBid: 默认出价
- state: 状态

**自动定向匹配组 (Auto Targeting Groups)**
- CLOSE_MATCH: 紧密匹配 - 与商品高度相关的搜索词
- LOOSE_MATCH: 宽泛匹配 - 与商品松散相关的搜索词
- SUBSTITUTES: 同类商品 - 与您的商品相似的商品详情页
- COMPLEMENTS: 关联商品 - 与您的商品互补的商品详情页

**绩效指标**
- impressions: 曝光数
- clicks: 点击数
- cost/spend: 花费
- sales14d: 14天销售额
- purchases14d/orders: 14天订单数
- unitsSoldClicks14d: 14天销售单位数
- ctr: 点击率
- cvr: 转化率
- acos: 广告销售成本比
- roas: 广告投资回报率
- cpc: 单次点击成本

**搜索词报告**
- searchTerm: 客户搜索词
- matchType: 匹配类型 (auto targeting group)
- 绩效指标同上

### 1.2 SP手动关键词广告 (SP Manual - Keywords)

**广告活动层级** (同SP自动)
- targetingType: manual (手动)

**广告组层级** (同SP自动)

**关键词定向**
- keywordId: 关键词ID
- keywordText: 关键词文本
- matchType: 匹配类型
  - BROAD: 广泛匹配
  - PHRASE: 短语匹配
  - EXACT: 精准匹配
- bid: 出价
- state: 状态

**否定关键词**
- negativeKeywordId: 否定关键词ID
- keywordText: 关键词文本
- matchType: NEGATIVE_EXACT / NEGATIVE_PHRASE
- level: campaign / adGroup

**绩效指标** (同SP自动)

**搜索词报告**
- searchTerm: 客户搜索词
- keywordId: 触发的关键词ID
- keyword: 触发的关键词文本
- matchType: 匹配类型
- 绩效指标同上

### 1.3 SP商品定位广告 (SP Manual - Product Targeting)

**广告活动层级** (同SP自动)
- targetingType: manual (手动)

**广告组层级** (同SP自动)

**商品定向**
- targetId: 定向ID
- targetingExpression: 定向表达式
- targetingType: 定向类型
  - asinSameAs: ASIN定向
  - asinCategorySameAs: 品类定向
  - asinBrandSameAs: 品牌定向
  - asinPriceLessThan/GreaterThan: 价格定向
  - asinReviewRatingLessThan/GreaterThan: 评分定向
- bid: 出价
- state: 状态

**否定商品定向**
- negativeTargetId: 否定定向ID
- targetingExpression: 定向表达式
- level: campaign / adGroup

**绩效指标** (同SP自动)

### 1.4 SP广告位置绩效 (Placement Performance)

**位置类型**
- TOP_OF_SEARCH: 搜索结果顶部（首页）
- DETAIL_PAGE: 商品详情页
- OTHER: 其他位置（搜索结果其余位置）

**位置调整**
- placementTopSearchBidAdjustment: 搜索顶部出价调整 (0-900%)
- placementProductPageBidAdjustment: 商品页出价调整 (0-900%)

**绩效指标** (按位置分组)
- 同上述绩效指标

---

## 二、SB品牌推广广告 (Sponsored Brands)

### 2.1 广告活动层级

**基本信息**
- campaignId: 广告活动ID
- campaignName: 广告活动名称
- campaignStatus: 状态 (enabled/paused/archived)
- budgetType: 预算类型 (daily/lifetime)
- budget: 预算金额
- startDate: 开始日期
- endDate: 结束日期
- portfolioId: 组合ID
- brandEntityId: 品牌实体ID

**竞价策略**
- biddingStrategy: 竞价策略
  - legacyForSales: 传统销售优化
  - autoForSales: 自动销售优化
  - manual: 手动竞价
  - ruleBasedBidding: 基于规则的竞价

**广告格式**
- adFormat: 广告格式
  - productCollection: 商品集
  - video: 品牌视频
  - storeSpotlight: 品牌旗舰店焦点

**落地页**
- landingPageType: 落地页类型
  - store: 品牌旗舰店
  - productList: 商品列表
  - customUrl: 自定义URL
- landingPageUrl: 落地页URL
- storePageId: 旗舰店页面ID

### 2.2 广告组层级

**基本信息**
- adGroupId: 广告组ID
- adGroupName: 广告组名称
- state: 状态
- defaultBid: 默认出价

**创意信息**
- headline: 标题文案
- brandLogoAssetId: 品牌Logo资源ID
- customImageAssetId: 自定义图片资源ID
- videoAssetId: 视频资源ID

### 2.3 定向类型

**关键词定向**
- keywordId: 关键词ID
- keywordText: 关键词文本
- matchType: BROAD / PHRASE / EXACT
- bid: 出价
- state: 状态

**商品定向**
- targetId: 定向ID
- targetingExpression: 定向表达式
- bid: 出价
- state: 状态

**否定定向**
- 否定关键词
- 否定商品定向

### 2.4 绩效指标

**基础指标**
- impressions: 曝光数
- clicks: 点击数
- cost: 花费
- attributedSales14d: 14天归因销售额
- attributedConversions14d: 14天归因转化数

**品牌指标**
- dpv14d: 详情页浏览量 (Detail Page Views)
- newToBrandPurchases14d: 新客购买数 (NTB Orders)
- newToBrandSales14d: 新客销售额 (NTB Sales)
- newToBrandUnitsOrdered14d: 新客订购单位数
- newToBrandOrderRate14d: 新客订单率
- newToBrandSalesPercentage14d: 新客销售占比

**视频指标** (仅视频广告)
- videoCompleteViews: 完整观看数
- videoFirstQuartileViews: 25%观看数
- videoMidpointViews: 50%观看数
- videoThirdQuartileViews: 75%观看数
- videoUnmutes: 取消静音数
- viewableImpressions: 可见曝光数
- vtr: 观看完成率

**品牌旗舰店指标**
- brandedSearches: 品牌搜索数
- brandedSearchesClicks: 品牌搜索点击数

### 2.5 搜索词报告

- searchTerm: 客户搜索词
- keywordId: 触发的关键词ID
- keyword: 触发的关键词文本
- matchType: 匹配类型
- 绩效指标同上

### 2.6 购买商品报告 (Purchased Product Report)

- purchasedAsin: 购买的ASIN
- productName: 商品名称
- productCategory: 商品类别
- attributedSales14d: 归因销售额
- attributedConversions14d: 归因转化数

---

## 三、SD展示型推广广告 (Sponsored Display)

### 3.1 广告活动层级

**基本信息**
- campaignId: 广告活动ID
- campaignName: 广告活动名称
- campaignStatus: 状态 (enabled/paused/archived)
- budgetType: 预算类型 (daily/lifetime)
- budget: 预算金额
- startDate: 开始日期
- endDate: 结束日期
- portfolioId: 组合ID

**计费方式**
- costType: 计费类型
  - CPC: 按点击付费
  - VCPM: 按可见千次曝光付费

**竞价优化**
- bidOptimization: 竞价优化目标
  - reach: 触达优化
  - pageVisits: 页面访问优化
  - conversions: 转化优化

### 3.2 广告组层级

**基本信息**
- adGroupId: 广告组ID
- adGroupName: 广告组名称
- state: 状态
- defaultBid: 默认出价

**定向策略**
- tactic: 定向策略
  - T00001: 商品定向 (Contextual Targeting)
  - T00020: 受众定向 - 浏览再营销 (Views Remarketing)
  - T00030: 受众定向 - 购买再营销 (Purchases Remarketing)
  - T00040: 受众定向 - 亚马逊受众 (Amazon Audiences)

**创意信息**
- creativeType: 创意类型
- headline: 标题
- customImageAssetId: 自定义图片

### 3.3 定向类型

**商品定向 (Contextual Targeting)**
- targetId: 定向ID
- targetingExpression: 定向表达式
  - asinSameAs: ASIN定向
  - asinCategorySameAs: 品类定向
  - asinBrandSameAs: 品牌定向
- bid: 出价
- state: 状态

**受众定向 (Audience Targeting)**
- audienceId: 受众ID
- audienceName: 受众名称
- audienceType: 受众类型
  - views: 浏览再营销
  - purchases: 购买再营销
  - inMarket: 兴趣相关
  - lifestyle: 生活方式
- lookbackDays: 回溯天数 (7/14/30/60/90天)
- bid: 出价
- state: 状态

**否定定向**
- 否定商品定向
- 否定受众

### 3.4 绩效指标

**基础指标**
- impressions: 曝光数
- viewableImpressions: 可见曝光数
- clicks: 点击数
- cost: 花费

**点击归因指标**
- attributedSales14d: 14天点击归因销售额
- attributedConversions14d: 14天点击归因转化数
- attributedUnitsOrdered14d: 14天点击归因订购单位数

**浏览归因指标** (SD特有)
- viewAttributedSales14d: 14天浏览归因销售额
- viewAttributedConversions14d: 14天浏览归因转化数
- viewAttributedUnitsOrdered14d: 14天浏览归因订购单位数

**详情页指标**
- dpv14d: 详情页浏览量
- viewAttributedDpv14d: 浏览归因详情页浏览量

**新客指标**
- newToBrandPurchases14d: 新客购买数
- newToBrandSales14d: 新客销售额
- newToBrandUnitsOrdered14d: 新客订购单位数
- viewAttributedNewToBrandPurchases14d: 浏览归因新客购买数
- viewAttributedNewToBrandSales14d: 浏览归因新客销售额

**VCPM相关指标**
- vcpm: 可见千次曝光成本
- vctr: 可见点击率

**品牌指标**
- brandedSearches: 品牌搜索数
- brandedSearchRate: 品牌搜索率

### 3.5 购买商品报告

- purchasedAsin: 购买的ASIN
- productName: 商品名称
- productCategory: 商品类别
- attributedSales14d: 点击归因销售额
- viewAttributedSales14d: 浏览归因销售额

---

## 四、数据库表结构建议

### 4.1 需要新增/修改的表

**campaigns表扩展字段**
- budgetType: 预算类型
- costType: 计费方式 (SD)
- bidOptimization: 竞价优化目标 (SD)
- adFormat: 广告格式 (SB)
- landingPageType: 落地页类型 (SB)
- landingPageUrl: 落地页URL (SB)

**adGroups表扩展字段**
- tactic: 定向策略 (SD)
- headline: 标题文案 (SB/SD)
- creativeType: 创意类型

**新增: autoTargetingGroups表** (SP自动广告匹配组)
- id
- adGroupId
- targetingGroup: CLOSE_MATCH/LOOSE_MATCH/SUBSTITUTES/COMPLEMENTS
- bid
- state
- 绩效指标

**新增: audiences表** (SD受众定向)
- id
- adGroupId
- audienceId
- audienceName
- audienceType
- lookbackDays
- bid
- state
- 绩效指标

**dailyPerformance表扩展字段**
- viewableImpressions: 可见曝光
- dpv: 详情页浏览量
- ntbOrders: 新客订单
- ntbSales: 新客销售额
- viewAttributedSales: 浏览归因销售额
- viewAttributedOrders: 浏览归因订单数
- videoCompleteViews: 视频完整观看数 (SB视频)
