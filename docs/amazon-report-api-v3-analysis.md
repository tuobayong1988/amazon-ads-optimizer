# Amazon Report API v3 详细分析

## 概述

Report API v3 是Amazon Ads API中用于获取广告性能数据的异步报告接口。

**API端点**: `POST /reporting/reports`

**Content-Type**: `application/vnd.createasyncreportrequest.v3+json`

## 支持的报告类型

### 1. SP Campaigns Report (spCampaigns)
用于获取Sponsored Products广告活动级别的数据。

```json
{
    "name": "SP campaigns report",
    "startDate": "2022-07-05",
    "endDate": "2022-07-10",
    "configuration": {
        "adProduct": "SPONSORED_PRODUCTS",
        "groupBy": ["campaign", "adGroup"],
        "columns": ["adGroupId", "campaignId", "impressions", "clicks", "cost", "purchases1d", "purchases7d", "purchases14d", "purchases30d", "date"],
        "reportTypeId": "spCampaigns",
        "timeUnit": "DAILY",
        "format": "GZIP_JSON"
    }
}
```

### 2. SP Search Term Report (spSearchTerm)
用于获取搜索词级别的数据。

```json
{
    "name": "SP search term report",
    "startDate": "2022-07-05",
    "endDate": "2022-07-10",
    "configuration": {
        "adProduct": "SPONSORED_PRODUCTS",
        "groupBy": ["searchTerm"],
        "columns": ["adGroupId", "campaignId", "keywordId", "targeting", "searchTerm", "impressions", "clicks", "cost", "purchases1d", "purchases7d", "purchases14d", "purchases30d", "date"],
        "reportTypeId": "spSearchTerm",
        "timeUnit": "DAILY",
        "format": "GZIP_JSON"
    }
}
```

### 3. SP Advertised Product Report (spAdvertisedProduct)
用于获取广告产品级别的数据。**支持startDate和endDate列！**

```json
{
    "name": "SP advertised product report",
    "startDate": "2022-07-05",
    "endDate": "2022-07-10",
    "configuration": {
        "adProduct": "SPONSORED_PRODUCTS",
        "groupBy": ["advertiser"],
        "columns": ["adGroupId", "campaignId", "adId", "impressions", "advertisedAsin", "advertisedSku", "clicks", "cost", "purchases1d", "purchases7d", "purchases14d", "purchases30d", "startDate", "endDate"],
        "reportTypeId": "spAdvertisedProduct",
        "timeUnit": "SUMMARY",
        "format": "GZIP_JSON"
    }
}
```

### 4. SP Purchased Product Report (spPurchasedProduct)
用于获取购买产品级别的数据。

```json
{
    "name": "SP purchased product report",
    "startDate": "2022-07-05",
    "endDate": "2022-07-10",
    "configuration": {
        "adProduct": "SPONSORED_PRODUCTS",
        "groupBy": ["asin"],
        "columns": ["adGroupId", "campaignId", "purchasedAsin", "advertisedAsin", "sales1d", "sales7d", "salesOtherSku1d", "salesOtherSku7d"],
        "reportTypeId": "spPurchasedProduct",
        "timeUnit": "DAILY",
        "format": "GZIP_JSON"
    }
}
```

### 5. SP Targeting Report (spTargeting)
用于获取定向级别的数据。**支持startDate和endDate列！**

```json
{
    "name": "SP targeting report",
    "startDate": "2022-07-05",
    "endDate": "2022-07-10",
    "configuration": {
        "adProduct": "SPONSORED_PRODUCTS",
        "groupBy": ["targeting"],
        "columns": ["adGroupId", "campaignId", "targeting", "keywordId", "matchType", "impressions", "clicks", "cost", "purchases1d", "purchases7d", "purchases14d", "purchases30d", "startDate", "endDate"],
        "filters": [
            {
                "field": "keywordType",
                "values": ["TARGETING_EXPRESSION", "TARGETING_EXPRESSION_PREDEFINED"]
            }
        ],
        "reportTypeId": "spTargeting",
        "timeUnit": "SUMMARY",
        "format": "GZIP_JSON"
    }
}
```

### 6. SB Purchased Product Report (sbPurchasedProduct)
用于获取Sponsored Brands购买产品数据。

```json
{
    "name": "SB purchased product report",
    "startDate": "2022-07-05",
    "endDate": "2022-07-10",
    "configuration": {
        "adProduct": "SPONSORED_BRANDS",
        "groupBy": ["purchasedAsin"],
        "columns": ["adGroupName", "campaignName", "purchasedAsin", "productName", "sales14d", "orders14d", "date"],
        "reportTypeId": "sbPurchasedProduct",
        "timeUnit": "DAILY",
        "format": "GZIP_JSON"
    }
}
```

## 关键发现

### startDate和endDate列

**重要**: 在以下报告类型中，可以请求`startDate`和`endDate`列：
- spAdvertisedProduct (广告产品报告)
- spTargeting (定向报告)

这些列返回的是**广告活动的开始日期和结束日期**，而不是报告的日期范围。

### timeUnit选项

| timeUnit | 说明 |
|----------|------|
| DAILY | 按天分组数据 |
| SUMMARY | 汇总整个日期范围的数据 |

### format选项

| format | 说明 |
|--------|------|
| GZIP_JSON | GZIP压缩的JSON格式 |

### groupBy选项

| groupBy | 说明 |
|---------|------|
| campaign | 按广告活动分组 |
| adGroup | 按广告组分组 |
| advertiser | 按广告主分组 |
| targeting | 按定向分组 |
| searchTerm | 按搜索词分组 |
| asin | 按ASIN分组 |
| purchasedAsin | 按购买ASIN分组 |

## 报告请求流程

1. **创建报告请求**: POST /reporting/reports
2. **检查报告状态**: GET /reporting/reports/{reportId}
3. **下载报告**: 当状态为COMPLETED时，使用返回的URL下载报告

## 响应示例

```json
{
    "configuration": {
        "adProduct": "SPONSORED_PRODUCTS",
        "columns": ["adGroupId", "campaignId", "impressions", "clicks", "cost", "purchases1d", "purchases7d", "purchases14d", "purchases30d", "date"],
        "filters": null,
        "format": "GZIP_JSON",
        "groupBy": ["campaign", "adGroup"],
        "reportTypeId": "spCampaigns",
        "timeUnit": "DAILY"
    },
    "createdAt": "2022-07-25T22:44:51.223Z",
    "endDate": "2022-07-10",
    "failureReason": null,
    "fileSize": null,
    "generatedAt": null,
    "name": "SP campaigns report 7/5-7/10",
    "reportId": "06ba6494-8568-4066-949f-abb6a91c0b9c",
    "startDate": "2022-07-05",
    "status": "PENDING",
    "updatedAt": "2022-07-25T22:44:51.223Z",
    "url": null,
    "urlExpiresAt": null
}
```

## 数据同步建议

### 获取广告活动开始日期

**方案1**: 使用Campaign List API
- SP: POST /sp/campaigns/list
- 响应中包含startDate字段

**方案2**: 使用Report API
- 请求spAdvertisedProduct或spTargeting报告
- 在columns中包含startDate列
- 注意：这种方式需要异步等待报告生成

### 推荐方案

对于获取广告活动的开始日期，推荐使用**Campaign List API**，因为：
1. 同步响应，无需等待
2. 直接返回campaign的startDate字段
3. 数据更准确（直接来自campaign配置）

Report API的startDate列更适合用于：
1. 批量获取历史数据
2. 与性能数据一起分析
3. 需要关联其他维度数据时


## SD Report API (v2)

SD报告目前仍使用v2 API。

### 端点
`POST /v2/sd/:recordType/report`

### 请求体示例
```json
{
    "reportDate": "20220101",
    "metrics": "impressions,clicks,cost,attributedDetailPageView14d",
    "tactic": "T00030"
}
```

### recordType选项
- campaigns
- adGroups
- productAds
- targets

### tactic选项
- T00020 - 产品定向
- T00030 - 受众定向

## SB Report API (v2)

SB报告目前仍使用v2 API。

### 端点
`POST /v2/hsa/:recordType/report`

## Report API v3 可用列汇总

根据Postman集合分析，Report API v3支持以下列：

### 维度列
| 列名 | 说明 |
|------|------|
| campaignId | 广告活动ID |
| campaignName | 广告活动名称 |
| adGroupId | 广告组ID |
| adGroupName | 广告组名称 |
| adId | 广告ID |
| keywordId | 关键词ID |
| keyword | 关键词文本 |
| targeting | 定向表达式 |
| matchType | 匹配类型 |
| searchTerm | 搜索词 |
| advertisedAsin | 广告ASIN |
| advertisedSku | 广告SKU |
| purchasedAsin | 购买ASIN |
| productName | 产品名称 |

### 日期列
| 列名 | 说明 |
|------|------|
| date | 报告日期 |
| **startDate** | **广告活动开始日期** |
| **endDate** | **广告活动结束日期** |

### 性能指标列
| 列名 | 说明 |
|------|------|
| impressions | 展示量 |
| clicks | 点击量 |
| cost | 花费 |
| purchases1d | 1天购买量 |
| purchases7d | 7天购买量 |
| purchases14d | 14天购买量 |
| purchases30d | 30天购买量 |
| sales1d | 1天销售额 |
| sales7d | 7天销售额 |
| sales14d | 14天销售额 |
| salesOtherSku1d | 1天其他SKU销售额 |
| salesOtherSku7d | 7天其他SKU销售额 |
| orders14d | 14天订单量 |

## 报告请求流程详解

### 1. 创建报告请求
```
POST /reporting/reports
Content-Type: application/vnd.createasyncreportrequest.v3+json
```

### 2. 检查报告状态
```
GET /reporting/reports/{reportId}
```

状态值：
- PENDING - 等待处理
- PROCESSING - 处理中
- COMPLETED - 完成
- FAILED - 失败

### 3. 下载报告
当状态为COMPLETED时，响应中会包含`url`字段，直接下载该URL即可获取报告数据。

报告格式为GZIP压缩的JSON，需要解压后解析。
