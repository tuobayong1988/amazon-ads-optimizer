# Campaigns表Schema更新计划

## 当前字段 vs 亚马逊后台字段对比

### 已有字段
| 亚马逊后台 | 当前schema | 状态 |
|-----------|-----------|------|
| Campaigns | campaignName | ✅ |
| Status | campaignStatus | ✅ |
| Type | campaignType | ✅ |
| Targeting | targetingType | ✅ |
| Start date | startDate | ✅ |
| End date | endDate | ✅ |
| Budget | dailyBudget | ✅ |
| Impressions | impressions | ✅ |
| Clicks | clicks | ✅ |
| Spend | spend | ✅ |
| Sales | sales | ✅ |
| Orders | orders | ✅ |
| ACOS | acos | ✅ |
| ROAS | roas | ✅ |
| CTR | ctr | ✅ |
| CPC | cpc | ✅ |

### 需要添加的字段
| 亚马逊后台 | 建议字段名 | 类型 | 说明 |
|-----------|-----------|------|------|
| State | state | enum | 广告活动状态(enabled/paused/archived/pending) |
| Country | countryCode | varchar(10) | 国家代码 |
| Retailer | retailer | varchar(255) | 零售商 |
| Portfolio | portfolioId | varchar(64) | 组合ID |
| Portfolio | portfolioName | varchar(255) | 组合名称 |
| Campaign bidding strategy | biddingStrategy | enum | 竞价策略 |
| Avg. time in budget | avgTimeInBudget | decimal | 平均预算内时间(%) |
| Budget (converted) | budgetConverted | decimal | 转换后预算 |
| Cost type | costType | enum | 计费类型(CPC/vCPM/CPM) |
| Top-of-search impression share | topOfSearchImpressionShare | decimal | 搜索顶部曝光份额 |
| Top-of-search bid adjustment | topOfSearchBidAdjustment | int | 搜索顶部出价调整(%) |
| Spend (converted) | spendConverted | decimal | 转换后花费 |
| CPC (converted) | cpcConverted | decimal | 转换后CPC |
| Detail page views | detailPageViews | int | 详情页浏览 |
| Brand Store page views | brandStorePageViews | int | 品牌店铺浏览 |
| Sales (converted) | salesConverted | decimal | 转换后销售额 |
| NTB orders | ntbOrders | int | 新客订单 |
| % of orders NTB | ntbOrdersPercent | decimal | 新客订单占比 |
| NTB sales (converted) | ntbSalesConverted | decimal | 新客销售额(转换) |
| NTB sales | ntbSales | decimal | 新客销售额 |
| % of sales NTB | ntbSalesPercent | decimal | 新客销售额占比 |
| Long-term sales (converted) | longTermSalesConverted | decimal | 长期销售额(转换) |
| Long-term sales | longTermSales | decimal | 长期销售额 |
| Long-term ROAS | longTermRoas | decimal | 长期ROAS |
| Cumulative reach | cumulativeReach | int | 累计触达 |
| Household reach | householdReach | int | 家庭触达 |
| Viewable impressions | viewableImpressions | int | 可见曝光 |
| CPM (converted) | cpmConverted | decimal | 转换后CPM |
| CPM | cpm | decimal | CPM |
| VCPM (converted) | vcpmConverted | decimal | 转换后VCPM |
| VCPM | vcpm | decimal | VCPM |
| Video first quartile | videoFirstQuartile | int | 视频25%播放 |
| Video midpoint | videoMidpoint | int | 视频50%播放 |
| Video third quartile | videoThirdQuartile | int | 视频75%播放 |
| Video complete | videoComplete | int | 视频完整播放 |
| Video unmute | videoUnmute | int | 视频取消静音 |
| VTR | vtr | decimal | 视频播放率 |
| vCTR | vctr | decimal | 可见点击率 |

## 前端列顺序（按亚马逊后台顺序）
1. campaignStatus (State)
2. campaignName (Campaigns)
3. countryCode (Country)
4. state (Status)
5. campaignType (Type)
6. targetingType (Targeting)
7. retailer (Retailer)
8. portfolioName (Portfolio)
9. biddingStrategy (Campaign bidding strategy)
10. startDate (Start date)
11. endDate (End date)
12. avgTimeInBudget (Avg. time in budget)
13. budgetConverted (Budget converted)
14. dailyBudget (Budget)
15. costType (Cost type)
16. impressions (Impressions)
17. topOfSearchImpressionShare (Top-of-search impression share)
18. topOfSearchBidAdjustment (Top-of-search bid adjustment)
19. clicks (Clicks)
20. ctr (CTR)
21. spendConverted (Spend converted)
22. spend (Spend)
23. cpcConverted (CPC converted)
24. cpc (CPC)
25. detailPageViews (Detail page views)
26. brandStorePageViews (Brand Store page views)
27. orders (Orders)
28. salesConverted (Sales converted)
29. sales (Sales)
30. acos (ACOS)
31. roas (ROAS)
32. ntbOrders (NTB orders)
33. ntbOrdersPercent (% of orders NTB)
34. ntbSalesConverted (NTB sales converted)
35. ntbSales (NTB sales)
36. ntbSalesPercent (% of sales NTB)
37. longTermSalesConverted (Long-term sales converted)
38. longTermSales (Long-term sales)
39. longTermRoas (Long-term ROAS)
40. cumulativeReach (Cumulative reach)
41. householdReach (Household reach)
42. viewableImpressions (Viewable impressions)
43. cpmConverted (CPM converted)
44. cpm (CPM)
45. vcpmConverted (VCPM converted)
46. vcpm (VCPM)
47. videoFirstQuartile (Video first quartile)
48. videoMidpoint (Video midpoint)
49. videoThirdQuartile (Video third quartile)
50. videoComplete (Video complete)
51. videoUnmute (Video unmute)
52. vtr (VTR)
53. vctr (vCTR)
