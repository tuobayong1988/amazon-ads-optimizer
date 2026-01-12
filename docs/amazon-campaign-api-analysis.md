# Amazon Campaign API 详细分析

## 概述

Amazon Ads API提供了三种广告类型的Campaign管理API：
- **SP (Sponsored Products)** - 商品推广
- **SD (Sponsored Display)** - 展示型推广
- **SB (Sponsored Brands)** - 品牌推广

## SP Campaign API (Sponsored Products)

### 端点
- **List**: `POST /sp/campaigns/list`
- **Create**: `POST /sp/campaigns`
- **Update**: `PUT /sp/campaigns`
- **Delete**: `POST /sp/campaigns/delete`

### Headers
```
Amazon-Advertising-API-ClientId: {{client_id}}
Authorization: Bearer {{access_token}}
Amazon-Advertising-API-Scope: {{profileId}}
Accept: application/vnd.spCampaign.v3+json
Content-Type: application/vnd.spCampaign.v3+json
```

### 请求体示例 (List)
```json
{
  "stateFilter": {
    "include": ["ENABLED"]
  },
  "maxResults": 10
}
```

### SP响应字段

| 字段 | 类型 | 说明 |
|------|------|------|
| campaignId | string | 广告活动ID |
| name | string | 广告活动名称 |
| state | enum | 状态：ENABLED, PAUSED, ARCHIVED |
| targetingType | enum | 定向类型：AUTO, MANUAL |
| **startDate** | string | **开始日期（YYYY-MM-DD格式）** |
| endDate | string | 结束日期（可选） |
| budget.budget | number | 日预算金额 |
| budget.budgetType | enum | 预算类型：DAILY |

## SD Campaign API (Sponsored Display)

### 端点
- **List**: `GET /sd/campaigns`
- **Extended**: `GET /sd/campaigns/extended`

### SD响应字段

| 字段 | 类型 | 说明 |
|------|------|------|
| campaignId | number | 广告活动ID |
| name | string | 广告活动名称 |
| state | enum | 状态：enabled, paused, archived |
| **startDate** | string | **开始日期（YYYYMMDD格式）** |
| budget | number | 日预算金额 |

## SB Campaign API (Sponsored Brands)

### 端点
- **List**: `POST /sb/v4/campaigns/list`

### SB响应字段

| 字段 | 类型 | 说明 |
|------|------|------|
| campaignId | string | 广告活动ID |
| name | string | 广告活动名称 |
| state | enum | 状态：ENABLED, PAUSED, ARCHIVED |
| **startDate** | string | **开始日期（YYYY-MM-DD格式）** |
| budget | number | 日预算金额 |

## startDate字段格式对比

| 广告类型 | startDate格式 | 示例 |
|---------|--------------|------|
| SP | YYYY-MM-DD | 2022-08-11 |
| SD | YYYYMMDD | 20220126 |
| SB | YYYY-MM-DD | 2023-02-20 |

## 关键发现

所有Campaign API都返回startDate字段，需要处理两种日期格式。
