# Amazon SP Campaign API 响应格式分析

## 发现来源
Amazon Ads API Postman Collection - List SP campaigns 示例响应

## SP Campaign List API 响应字段

根据Postman Collection中的示例响应，SP Campaign List API (`POST /sp/campaigns/list`) 返回的campaign对象包含以下字段：

```json
{
    "campaigns": [
        {
            "budget": {
                "budget": 15,
                "budgetType": "DAILY"
            },
            "campaignId": "52978233888897",
            "dynamicBidding": {
                "placementBidding": [],
                "strategy": "AUTO_FOR_SALES"
            },
            "name": "Campaign - 8/11/2022 11:28:51",
            "premiumBidAdjustment": false,
            "startDate": "2022-08-11",
            "state": "ENABLED",
            "targetingType": "AUTO"
        },
        {
            "budget": {
                "budget": 100,
                "budgetType": "DAILY"
            },
            "campaignId": "276748589410145",
            "dynamicBidding": {
                "placementBidding": [
                    {
                        "percentage": 900,
                        "placement": "PLACEMENT_TOP"
                    }
                ],
                "strategy": "LEGACY_FOR_SALES"
            },
            "endDate": "2022-11-08",
            "name": "Test SP campaign",
            "premiumBidAdjustment": true,
            "startDate": "2022-10-31",
            "state": "ENABLED",
            "targetingType": "AUTO"
        }
    ],
    "totalResults": 3
}
```

## 关键发现

### startDate字段
**SP Campaign API 确实返回 `startDate` 字段！**

格式：`YYYY-MM-DD`（例如：`"2022-08-11"`）

这个字段表示广告活动的开始日期，也就是创建日期。

### 其他重要字段
| 字段 | 类型 | 说明 |
|------|------|------|
| campaignId | string | 广告活动ID |
| name | string | 广告活动名称 |
| state | enum | 状态：ENABLED, PAUSED, ARCHIVED |
| targetingType | enum | 定向类型：AUTO, MANUAL |
| startDate | string | 开始日期（YYYY-MM-DD格式）|
| endDate | string | 结束日期（可选）|
| budget.budget | number | 日预算金额 |
| budget.budgetType | enum | 预算类型：DAILY |
| dynamicBidding.strategy | enum | 竞价策略 |
| dynamicBidding.placementBidding | array | 位置竞价调整 |
| premiumBidAdjustment | boolean | 是否启用高级竞价调整 |

## 结论

SP Campaign List API (`POST /sp/campaigns/list`) 已经返回了 `startDate` 字段，格式为 `YYYY-MM-DD`。

我们的代码中已经有处理这个字段的逻辑，需要检查为什么实际同步时没有获取到这个值。

## 可能的问题

1. API实际返回的数据中可能没有包含startDate字段
2. 需要在请求中添加特定参数来获取startDate字段
3. 不同版本的API返回的字段可能不同

## 下一步

1. 检查实际API调用的响应数据
2. 确认是否需要添加 `includeExtendedDataFields: true` 参数
3. 查看API文档确认获取startDate的正确方式


## OpenAPI规范确认

根据Amazon SP API的OpenAPI规范文件，`startDate`字段的定义如下：

```yaml
startDate:
  description: The starting date of the campaign. The format of the date is YYYYMMDD.
  type: string
```

**重要发现：**
- `startDate` 是SP Campaign模型的标准字段
- 格式为 `YYYYMMDD`（例如：`20220811`）
- 这与Postman Collection示例中的 `YYYY-MM-DD` 格式不同，可能是API版本差异

## API版本差异

| API版本 | startDate格式 | 示例 |
|---------|--------------|------|
| v2 (OpenAPI) | YYYYMMDD | 20220811 |
| v3 (Postman) | YYYY-MM-DD | 2022-08-11 |

## 当前代码分析

查看 `amazonSyncService.ts` 中的代码，已经有处理两种格式的逻辑：

```typescript
// 解析Amazon API返回的startDate（格式可能是YYYY-MM-DD或YYYYMMDD）
let startDateValue: string | null = null;
if (apiCampaign.startDate) {
  const dateStr = String(apiCampaign.startDate);
  if (dateStr.includes('-')) {
    // YYYY-MM-DD格式
    startDateValue = dateStr;
  } else if (dateStr.length === 8) {
    // YYYYMMDD格式
    startDateValue = `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
  }
}
```

代码已经正确处理了两种日期格式，问题可能在于API实际返回的数据中没有包含startDate字段。
