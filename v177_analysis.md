# v177 分析笔记

## 1. keyword_create 失败事件分析

### 数据概况
- 总计 5,123 条 keyword_create 事件（not_applicable）
- 其中 1,658 条有 `code=ERROR` 错误（真正的API失败）
- 其中 3,465 条是旧格式事件（v176清理标记的历史空状态事件）
- 涉及 422 个不同的搜索词
- 这些搜索词都不在 keywords 表中（从未成功创建）

### 失败原因
- 错误信息为 `code=ERROR`（通用错误），可能是：
  1. Amazon API 返回 415 错误（Content-Type 问题，已在 v174 修复）
  2. Amazon API 返回 ERROR 但无详细错误码
  3. 响应解析问题（已在 v175b 修复）

### 失败事件来源
- 来自 `optimizationTargetEngine.ts` 的搜索词分析流程
- 调用 `amazonApiHelper.syncNewKeywordsToAmazon` 创建关键词
- 失败后记录到 optimization_events 的 action_detail 中

### 重试策略设计
- 需要从 optimization_events 中提取失败的搜索词信息
- 重新调用 syncNewKeywordsToAmazon 创建关键词
- 成功后需要：
  1. 更新 optimization_events 状态为 synced
  2. 确保 keywords 表中有对应记录
- 永久失败（DUPLICATE/INVALID）标记为 not_applicable

## 2. 涉及的 Campaign
- campaign_id=34: 2025.12.01-CPC-SP-B0F29R4MFV-KW-Broad-高弱-order1至3-小词3 (账户90021)
- campaign_id=100, 102: 旧campaign（无名称）
- campaign_id=484, 972, 1015, 1253-1460: 各种KW/POE campaign

## 3. 关键注意事项
- 失败事件中 keyword_id 为 NULL（从未在本地创建成功）
- 需要先在本地 keywords 表创建记录，再同步到 Amazon
- 需要获取正确的 adGroupId（从 campaign 关联查询）
- 出价默认 $0.50（与原始代码一致）
