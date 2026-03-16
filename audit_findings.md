# 广告系统数据同步全面审计报告

## 审计范围
- SP (Sponsored Products) - Campaign / Ad Group / Keyword / Product Target / Negative Keyword
- SB (Sponsored Brands) - Campaign / Ad Group / Keyword / Product Target / Negative Keyword / Negative Target / Ads
- SD (Sponsored Display) - Campaign / Ad Group / Product Target / Negative Target

## 1. SP Campaigns 层级审计

### 1.1 SP Campaign 同步字段
| 字段 | API返回 | DB存储 | 同步映射 | 前端展示 | 状态 |
|------|---------|--------|----------|----------|------|
| campaignId | ✅ | ✅ | ✅ | ✅ | OK |
| name | ✅ | ✅ campaignName | ✅ | ✅ | OK |
| state | ✅ | ✅ campaignStatus/state | ✅ | ✅ | OK |
| targetingType | ✅ | ✅ | ✅ | ✅ | OK |
| budget | ✅ | ✅ dailyBudget | ✅ | ✅ | OK |
| startDate | ✅ | ✅ | ✅ | ✅ | OK |
| endDate | ✅ | ✅ | ✅ | ✅ | OK |
| portfolioId | ✅ | ✅ | ✅ | ✅ | OK |
| dynamicBidding.strategy | ✅ | ✅ biddingStrategy | ✅(已修复) | ✅ | OK |
| dynamicBidding.placementBidding[TOP] | ✅ | ✅ placementTopSearchBidAdjustment | ✅(已修复) | ✅ | OK |
| dynamicBidding.placementBidding[PRODUCT_PAGE] | ✅ | ✅ placementProductPageBidAdjustment | ✅(已修复) | ✅ | OK |
| dynamicBidding.placementBidding[REST] | ✅ | ✅ placementRestBidAdjustment | ✅(已修复) | ✅ CampaignDetail | OK |

### 1.2 SP Ad Group 同步字段 - 全部正常
### 1.3 SP Keywords 同步字段 - 全部正常
### 1.4 SP Product Targets 同步字段 - 全部正常（含品类定向、品牌定向、ASIN定向等）
### 1.5 SP Negative Keywords 同步字段 - 全部正常

## 2. SB Campaigns 层级审计 - 全部正常
- Campaign: campaignGoal, adFormat, bidOptimization, costType, landingPage等全部同步
- Ad Group: 含creativeType
- Ads/Creative: headline, brandLogo, customImage, video等全部同步
- Keywords/Targets/Negatives: 全部正常

## 3. SD Campaigns 层级审计 - 全部正常
- Campaign: campaignGoal, costType, bidOptimization, tactic等全部同步
- Ad Group: 含tactic
- Product Targets: 全部正常

## 4. 前端展示审计

### 4.1 CampaignDetail.tsx
- ✅ SP auto: 自动定向匹配组展示
- ✅ SP manual: 搜索顶部、商品页出价调整（缺placementRest在设置卡片中）
- ✅ SP auto/manual: 位置出价调整卡片展示了全部3个placement
- ✅ SB: adFormat、landingPageType、campaignGoal、bidOptimization、出价调整tab
- ✅ SD: campaignGoal、costType、bidOptimization、tactic、可见性指标、浏览归因指标

### 4.2 Campaigns列表页
- ✅ topOfSearchBidAdjustment列
- ❌ 缺少 placementProductPageBidAdjustment 列
- ❌ 缺少 placementRestBidAdjustment 列

### 4.3 需修复的前端问题
1. SP manual详情页"SP手动广告设置"卡片只展示2个placement，需添加placementRest
2. Campaigns列表页需添加placementProduct和placementRest列

## 5. 已修复的问题
1. API v3 dynamicBidding数据结构映射（所有同步文件）
2. biddingStrategy大写到驼峰映射
3. placementRestBidAdjustment同步
4. 出价保护逻辑覆盖placementRest

## 6. 待修复的问题
1. 前端列表页缺少placement列
2. 前端SP manual详情页缺少placementRest
3. Budget Rules同步（数据库表已创建，API代码待实现）
4. 同步锁机制冲突
