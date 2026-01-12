# Report API v3 字段研究

## 关键发现

### 1. Top-of-search impression share 不在 v3 API 中
根据 GitHub 讨论 (https://github.com/amzn/ads-advanced-tools-docs/discussions/74):
> "right now impression share metrics are not supported in the version 3 reporting API. This is something the team is working on."

**结论**: `topOfSearchImpressionShare` 字段目前不支持通过 Report API v3 获取。

### 2. 可用的预算相关字段
根据官方文档 (Targeting reports):
- `campaignBudgetAmount` - 预算金额
- `campaignBudgetType` - 预算类型
- `campaignBudgetCurrencyCode` - 预算货币代码

这些字段在以下报告类型中可用:
- spTargeting (SP定向报告)
- sbCampaigns (SB广告活动报告)
- sdCampaigns (SD广告活动报告)

### 3. 当前实现的字段
SP Campaign Report 当前请求的字段:
- date
- campaignId
- campaignName
- campaignStatus
- campaignBudget
- impressions
- clicks
- cost
- purchases14d
- sales14d

### 4. 建议添加的字段
根据 Report API v3 文档，可以添加:
- `campaignBudgetCurrencyCode` - 预算货币代码
- `campaignBudgetType` - 预算类型 (DAILY/LIFETIME)
- `campaignBudgetAmount` - 预算金额 (替代 campaignBudget)

### 5. 绩效数据同步问题
仪表盘显示 $0 的原因可能是:
1. 绩效报告未同步
2. 数据处理逻辑问题
3. 字段映射不正确

需要检查:
- asyncReportService 中的 processCampaignReportData 函数
- 数据库中的绩效字段是否正确更新
