# Amazon Report API v3 新增指标

## 重要发现

根据第三方文档整理，Report API v3引入了以下新指标：

### 新增的日期相关指标
- **startDate** - 广告活动开始日期
- **endDate** - 广告活动结束日期
- **date** - 报告日期

### 新增的性能指标
- purchaseClickRate1d/7d/14d/30d - 购买点击率
- costPerClick - 每次点击成本
- acos7d - 7天ACOS
- roas7d - 7天ROAS
- clickThroughRate - 点击率
- impressions1y - 年度展示量
- clicks1y - 年度点击量
- spend1y - 年度花费
- costPerClick1y - 年度每次点击成本
- attributionType - 归因类型
- productName - 产品名称
- productCategory - 产品类别
- acosClicks7d/14d - 点击ACOS
- roasClicks7d/14d - 点击ROAS

## Report API v3 支持的报告类型

| 报告类型 | Sponsored Products | Sponsored Brands |
|---------|-------------------|------------------|
| Campaign | ✓ | - |
| Targeting | ✓ | - |
| Search term | ✓ | - |
| Advertised product | ✓ | - |
| Purchased product | ✓ | ✓ |

## 关键结论

**Report API v3 支持 `startDate` 列！**

这意味着我们可以通过Report API获取广告活动的开始日期。

### 使用Report API获取startDate的方法

请求示例：
```json
{
    "name": "SP campaigns report",
    "startDate": "2024-01-01",
    "endDate": "2024-01-31",
    "configuration": {
        "adProduct": "SPONSORED_PRODUCTS",
        "groupBy": ["campaign"],
        "columns": ["campaignId", "campaignName", "startDate", "endDate", "impressions", "clicks", "cost"],
        "reportTypeId": "spCampaigns",
        "timeUnit": "SUMMARY",
        "format": "GZIP_JSON"
    }
}
```

## 下一步

1. 验证Report API v3是否真的支持startDate列
2. 如果支持，修改代码使用Report API获取startDate
3. 如果不支持，考虑其他方案
