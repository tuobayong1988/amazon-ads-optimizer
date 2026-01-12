# Amazon Ads API 完整研究报告

## 概述

本报告基于对Amazon Ads API官方文档、Postman集合和第三方资源的深入研究，整理了API的完整使用指南，重点关注数据同步和广告活动开始日期(startDate)的获取。

## 一、API架构概览

### 1.1 API端点

Amazon Ads API根据地区提供不同的端点：

| 地区 | 端点 | 覆盖市场 |
|------|------|---------|
| NA | https://advertising-api.amazon.com | US, CA, MX, BR |
| EU | https://advertising-api-eu.amazon.com | UK, DE, FR, IT, ES, NL, SE, PL, TR, AE, SA, EG, IN |
| FE | https://advertising-api-fe.amazon.com | JP, AU, SG |

### 1.2 认证流程

1. **OAuth 2.0授权**: 用户授权后获取authorization code
2. **Token交换**: 使用code换取access_token和refresh_token
3. **Token刷新**: access_token过期后使用refresh_token刷新

### 1.3 必需的请求头

```
Amazon-Advertising-API-ClientId: {client_id}
Amazon-Advertising-API-Scope: {profile_id}
Authorization: Bearer {access_token}
Content-Type: application/json
```

## 二、Campaign管理API

### 2.1 SP Campaign API (Sponsored Products)

**端点**: `POST /sp/campaigns/list`

**Headers**:
```
Accept: application/vnd.spCampaign.v3+json
Content-Type: application/vnd.spCampaign.v3+json
```

**请求体**:
```json
{
  "stateFilter": {
    "include": ["ENABLED", "PAUSED"]
  },
  "maxResults": 100,
  "nextToken": "..."
}
```

**响应字段**:

| 字段 | 类型 | 说明 |
|------|------|------|
| campaignId | string | 广告活动ID |
| name | string | 广告活动名称 |
| state | enum | ENABLED, PAUSED, ARCHIVED |
| targetingType | enum | AUTO, MANUAL |
| **startDate** | string | **开始日期 (YYYY-MM-DD)** |
| endDate | string | 结束日期（可选） |
| budget.budget | number | 日预算 |
| budget.budgetType | enum | DAILY |
| dynamicBidding | object | 动态竞价设置 |

### 2.2 SD Campaign API (Sponsored Display)

**端点**: `GET /sd/campaigns`

**响应字段**:

| 字段 | 类型 | 说明 |
|------|------|------|
| campaignId | number | 广告活动ID |
| name | string | 广告活动名称 |
| state | enum | enabled, paused, archived |
| **startDate** | string | **开始日期 (YYYYMMDD)** |
| budget | number | 日预算 |
| tactic | string | 策略代码 |
| costType | enum | cpc, vcpm |

### 2.3 SB Campaign API (Sponsored Brands)

**端点**: `POST /sb/v4/campaigns/list`

**Headers**:
```
Accept: application/vnd.sbcampaignresource.v4+json
```

**响应字段**:

| 字段 | 类型 | 说明 |
|------|------|------|
| campaignId | string | 广告活动ID |
| name | string | 广告活动名称 |
| state | enum | ENABLED, PAUSED, ARCHIVED |
| **startDate** | string | **开始日期 (YYYY-MM-DD)** |
| budget | number | 日预算 |
| brandEntityId | string | 品牌实体ID |

### 2.4 startDate字段格式对比

| 广告类型 | API版本 | startDate格式 | 示例 |
|---------|---------|--------------|------|
| SP | v3 | YYYY-MM-DD | 2022-08-11 |
| SD | - | YYYYMMDD | 20220126 |
| SB | v4 | YYYY-MM-DD | 2023-02-20 |

**重要**: 需要在代码中处理两种日期格式的转换。

## 三、Report API v3

### 3.1 报告请求流程

1. **创建报告**: `POST /reporting/reports`
2. **检查状态**: `GET /reporting/reports/{reportId}`
3. **下载报告**: 使用返回的URL下载GZIP压缩的JSON

### 3.2 支持的报告类型

| reportTypeId | 说明 | 支持的广告类型 |
|--------------|------|---------------|
| spCampaigns | 广告活动报告 | SP |
| spTargeting | 定向报告 | SP |
| spSearchTerm | 搜索词报告 | SP |
| spAdvertisedProduct | 广告产品报告 | SP |
| spPurchasedProduct | 购买产品报告 | SP |
| sbPurchasedProduct | 购买产品报告 | SB |

### 3.3 可用列

#### 维度列
- campaignId, campaignName
- adGroupId, adGroupName
- adId
- keywordId, keyword
- targeting, matchType
- searchTerm
- advertisedAsin, advertisedSku
- purchasedAsin, productName

#### 日期列
- date - 报告日期
- **startDate** - 广告活动开始日期
- **endDate** - 广告活动结束日期

#### 性能指标列
- impressions, clicks, cost
- purchases1d/7d/14d/30d
- sales1d/7d/14d/30d
- unitsSoldClicks1d/7d/14d/30d
- acos7d, roas7d
- clickThroughRate, costPerClick

### 3.4 报告请求示例

```json
{
    "name": "SP campaigns report",
    "startDate": "2024-01-01",
    "endDate": "2024-01-31",
    "configuration": {
        "adProduct": "SPONSORED_PRODUCTS",
        "groupBy": ["campaign"],
        "columns": [
            "campaignId",
            "campaignName",
            "startDate",
            "endDate",
            "impressions",
            "clicks",
            "cost",
            "purchases7d",
            "sales7d"
        ],
        "reportTypeId": "spCampaigns",
        "timeUnit": "SUMMARY",
        "format": "GZIP_JSON"
    }
}
```

### 3.5 timeUnit选项

| 值 | 说明 |
|----|------|
| DAILY | 按天分组数据 |
| SUMMARY | 汇总整个日期范围 |

## 四、速率限制

### 4.1 初始限制

| 限制类型 | 值 |
|---------|---|
| TPS | 1请求/秒 |
| TPD | 8,640请求/天 |

### 4.2 动态调整

基于过去30天收入：
- 每5美分 → +1 TPD
- 每$4,320 → +1 TPS（最高10）

### 4.3 错误处理

| 状态码 | 说明 | 处理方式 |
|-------|------|---------|
| 429 | 速率限制 | 指数退避重试 |
| 401 | Token过期 | 刷新Token |
| 415 | 不支持的媒体类型 | 检查Content-Type |

## 五、数据同步策略

### 5.1 获取startDate的推荐方案

**方案1: Campaign List API（推荐）**
- 优点：同步响应，无需等待
- 适用：实时获取campaign配置

**方案2: Report API**
- 优点：可批量获取历史数据
- 适用：需要关联性能数据时

### 5.2 同步频率建议

| 数据类型 | 推荐频率 | API |
|---------|---------|-----|
| Campaign配置 | 每小时 | Campaign List API |
| 日常性能数据 | 每天 | Report API (DAILY) |
| 汇总性能数据 | 按需 | Report API (SUMMARY) |

### 5.3 增量同步策略

```typescript
// 使用lastUpdatedTime过滤
const body = {
  lastUpdatedTimeFilter: {
    startTime: lastSyncTime.toISOString()
  },
  maxResults: 100
};
```

### 5.4 分页处理

所有List API都支持分页：

```typescript
let nextToken: string | undefined;
const allItems: any[] = [];

do {
  const response = await api.list({ nextToken, maxResults: 100 });
  allItems.push(...response.items);
  nextToken = response.nextToken;
} while (nextToken);
```

## 六、代码实现建议

### 6.1 日期格式转换

```typescript
function normalizeStartDate(dateStr: string): string {
  if (!dateStr) return '';
  
  // YYYY-MM-DD格式
  if (dateStr.includes('-')) {
    return dateStr;
  }
  
  // YYYYMMDD格式 (SD API)
  if (dateStr.length === 8) {
    return `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
  }
  
  return dateStr;
}
```

### 6.2 指数退避重试

```typescript
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries = 5,
  baseDelay = 1000
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      if (error.response?.status === 429 && i < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, i);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw error;
    }
  }
  throw new Error('Max retries exceeded');
}
```

### 6.3 请求队列

```typescript
class RateLimitedQueue {
  private queue: Array<() => Promise<any>> = [];
  private processing = false;
  private minInterval = 1000; // 1 TPS

  async add<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          resolve(await fn());
        } catch (e) {
          reject(e);
        }
      });
      this.process();
    });
  }

  private async process() {
    if (this.processing) return;
    this.processing = true;
    
    while (this.queue.length > 0) {
      const fn = this.queue.shift()!;
      await fn();
      await new Promise(r => setTimeout(r, this.minInterval));
    }
    
    this.processing = false;
  }
}
```

## 七、关键发现总结

### 7.1 startDate字段

1. **所有Campaign API都返回startDate字段**
   - SP: YYYY-MM-DD格式
   - SD: YYYYMMDD格式
   - SB: YYYY-MM-DD格式

2. **Report API也支持startDate列**
   - 在spAdvertisedProduct和spTargeting报告中可用
   - 返回的是campaign的开始日期，不是报告日期

### 7.2 数据同步

1. **使用Campaign List API获取实时配置**
   - 包括startDate、状态、预算等

2. **使用Report API获取性能数据**
   - 支持多种报告类型和指标
   - 异步生成，需要轮询状态

3. **实现适当的速率限制处理**
   - 指数退避重试
   - 请求队列控制并发

### 7.3 API版本差异

| 广告类型 | Campaign API | Report API |
|---------|-------------|------------|
| SP | v3 | v3 |
| SD | - | v2 |
| SB | v4 | v3 (部分) |

## 八、参考资源

- [Amazon Ads API Documentation](https://advertising.amazon.com/API/docs/en-us/)
- [Amazon Ads API Postman Collection](https://github.com/amzn/ads-advanced-tools-docs)
- [Report API v3 Migration Guide](https://advertising.amazon.com/API/docs/en-us/reference/migration-guides/reporting-v2-v3)
