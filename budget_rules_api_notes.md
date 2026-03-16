# Amazon Ads Budget Rules API - Complete Reference

## API Endpoints

### SP Budget Rules
1. **GET /sp/budgetRules** - 列出所有budget rules (支持nextToken分页, pageSize参数)
2. **POST /sp/budgetRules** - 创建budget rules (最多25条)
3. **PUT /sp/budgetRules** - 更新budget rules
4. **GET /sp/budgetRules/{budgetRuleId}** - 获取单个budget rule详情
5. **GET /sp/campaigns/{campaignId}/budgetRules** - 获取campaign关联的budget rules
6. **POST /sp/campaigns/{campaignId}/budgetRules** - 关联budget rule到campaign
7. **DELETE /sp/campaigns/{campaignId}/budgetRules/{budgetRuleId}** - 取消关联

### SB/SD Budget Rules
- 类似端点，前缀分别为 /sb/ 和 /sd/

## Budget Rule Schema (SPBudgetRuleDetails)

```json
{
  "budgetRulesDetails": [
    {
      "name": "Black Friday Budget Boost",
      "ruleType": "SCHEDULE" | "PERFORMANCE",
      "duration": {
        "eventTypeRuleDuration": {
          "eventId": "string",       // 来自budget rules recommendation API
          "eventName": "string",     // 只读
          "startDate": "YYYYMMDD",   // 只读
          "endDate": "YYYYMMDD"      // 只读
        },
        "dateRangeTypeRuleDuration": {
          "startDate": "YYYYMMDD",   // 必填，>=当前日期
          "endDate": "YYYYMMDD"      // 必填，>=startDate
        }
      },
      "recurrence": {
        "type": "DAILY",
        "daysOfWeek": ["MONDAY", "TUESDAY", ...],  // 可选，DAILY时不需要
        "intraDaySchedule": [                        // 分时段（部分marketplace不支持）
          {
            "startTime": "HH:mm:ss",
            "endTime": "HH:mm:ss"
          }
        ]
      },
      "budgetIncreaseBy": {
        "type": "PERCENT",           // 目前只支持PERCENT
        "value": 100                 // 增加百分比
      },
      "performanceMeasureCondition": {  // 仅PERFORMANCE类型
        "metricName": "ACOS" | "CTR" | "CVR" | "ROAS",
        "comparisonOperator": "GREATER_THAN" | "LESS_THAN" | "EQUAL_TO" | "LESS_THAN_OR_EQUAL_TO" | "GREATER_THAN_OR_EQUAL_TO",
        "threshold": 20.0
      }
    }
  ]
}
```

## Response Schema (from list/get)

```json
{
  "budgetRules": [
    {
      "ruleId": "string",
      "name": "string",
      "ruleType": "SCHEDULE" | "PERFORMANCE",
      "ruleStatus": "ACTIVE" | "PAUSED",
      "duration": { ... },
      "recurrence": { ... },
      "budgetIncreaseBy": { ... },
      "performanceMeasureCondition": { ... },
      "associatedCampaignIds": ["campaignId1", "campaignId2"],
      "createdDate": "string",
      "lastUpdatedDate": "string"
    }
  ],
  "nextToken": "string"
}
```

## Campaign List API中的Budget字段
- `effectiveBudget` - 应用budget rules后的实际预算（campaign list API返回）
- 需要单独调用budget rules API获取具体规则详情

## 需要实现的功能
1. 在amazonAdsApi.ts中添加listSpBudgetRules方法
2. 在amazonAdsApi.ts中添加getSpCampaignBudgetRules方法
3. 创建budget_rules数据库表
4. 在campaignSync.ts中添加budget rules同步步骤
5. 在unifiedSyncEngine.ts中注册budget rules同步步骤
6. 前端展示campaign的budget rules信息
