# 亚马逊广告API研究文档

## 1. Sponsored Products (SP) 商品推广广告

### 1.1 自动广告匹配类型
- **close_match (紧密匹配)**: 与商品高度相关的搜索词
- **loose_match (宽泛匹配)**: 与商品松散相关的搜索词
- **substitutes (同类商品)**: 浏览过类似商品的顾客
- **complements (关联商品)**: 浏览过互补商品的顾客

### 1.2 竞价位置调整
- **top_of_search**: 搜索结果顶部位置，最高可调整900%
- **product_page**: 商品详情页位置，最高可调整900%
- **rest_of_search**: 其他搜索位置

### 1.3 竞价策略
- **legacyForSales**: 传统销售优化
- **autoForSales**: 自动销售优化
- **manual**: 手动竞价
- **ruleBased**: 基于规则的竞价

### 1.4 搜索词报告
- 提供搜索词级别的绩效数据
- 包含展示量、点击量、花费、销售额、订单数
- 可用于识别高绩效和低绩效搜索词

## 2. Sponsored Brands (SB) 品牌广告

### 2.1 广告类型
- **product_collection**: 商品集合广告
- **store_spotlight**: 品牌旗舰店聚焦广告
- **video**: 视频广告

### 2.2 落地页类型
- **store**: 品牌旗舰店
- **product_list**: 商品列表页
- **custom_url**: 自定义URL

### 2.3 关键词定向
- 支持精确匹配、短语匹配、广泛匹配
- 支持否定关键词
- 支持品牌关键词保护

### 2.4 商品定向
- 支持ASIN定向
- 支持品类定向
- 支持品牌定向

### 2.5 创意管理
- 标题文案优化
- 商品选择优化
- 品牌Logo管理

## 3. Sponsored Display (SD) 展示广告

### 3.1 定向策略 (Tactic)
- **T00020**: 浏览再营销（查看过商品的用户）
- **T00030**: 购买再营销（购买过商品的用户）
- **contextual**: 上下文定向（基于商品或品类）
- **audiences**: 受众定向（基于兴趣或行为）

### 3.2 计费方式
- **CPC**: 按点击付费
- **vCPM**: 按可见千次展示付费

### 3.3 优化目标
- **reach**: 触达优化
- **page_visits**: 页面访问优化
- **conversions**: 转化优化

### 3.4 受众类型
- **views**: 查看过商品的受众
- **purchases**: 购买过商品的受众
- **similar_products**: 相似商品受众
- **categories**: 品类受众
- **audiences**: Amazon受众（生活方式、兴趣等）

### 3.5 回溯窗口
- 7天、14天、30天、60天、90天

## 4. 搜索词分析

### 4.1 搜索词分类
- **high_performer**: 高绩效（低ACoS，高转化）
- **potential**: 潜力词（有转化但数据不足）
- **low_performer**: 低绩效（高ACoS，低转化）
- **negative_candidate**: 否定候选（无转化，高花费）

### 4.2 优化建议类型
- **add_as_keyword**: 添加为关键词
- **add_as_negative**: 添加为否定关键词
- **increase_bid**: 提高竞价
- **decrease_bid**: 降低竞价
- **monitor**: 继续观察

## 5. API端点汇总

### 5.1 SP广告端点
- `/sp/campaigns` - 广告活动管理
- `/sp/adGroups` - 广告组管理
- `/sp/keywords` - 关键词管理
- `/sp/negativeKeywords` - 否定关键词管理
- `/sp/targets` - 商品定向管理
- `/sp/productAds` - 商品广告管理

### 5.2 SB广告端点
- `/sb/campaigns` - 品牌广告活动管理
- `/sb/adGroups` - 广告组管理
- `/sb/keywords` - 关键词管理
- `/sb/negativeKeywords` - 否定关键词管理
- `/sb/targets` - 商品定向管理

### 5.3 SD广告端点
- `/sd/campaigns` - 展示广告活动管理
- `/sd/adGroups` - 广告组管理
- `/sd/targets` - 定向管理
- `/sd/negativeTargets` - 否定定向管理

### 5.4 报告端点
- `/reporting/reports` - 报告请求
- 支持搜索词报告、关键词报告、商品报告等
