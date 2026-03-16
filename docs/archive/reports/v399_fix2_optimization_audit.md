# v399-fix2 智能优化模块审计笔记

## 1. 优化目标引擎架构

系统采用 `optimizationTargetEngine.ts` 作为统一入口，通过子模块执行器实现各优化策略：

| 模块 | 执行器文件 | 功能 |
|------|-----------|------|
| 出价优化 | bidOptimizationExecutor.ts | 基于绩效数据调整关键词/商品定位出价 |
| 位置优化 | placementExecutor.ts | 调整广告活动位置百分比（首页/商品页） |
| 分时竞价 | daypartingExecutor.ts | 基于小时级规则调整关键词出价 |
| 分时预算 | daypartingExecutor.ts | 基于星期几调整广告活动预算 |
| 搜索词分析 | searchTermExecutor.ts | 智能否词、收割搜索词、ASIN定向 |
| 预算分配 | budgetExecutor.ts | 组合级预算分配优化 |
| 状态变更 | statusChangeExecutor.ts | 关键词/广告组/广告活动暂停/启用 |
| 竞价协调 | bidCoordinationExecutor.ts | 中央竞价协调，统一处理各服务建议 |

## 2. 优化模块完整性评估

### 已实现的优化功能
- [x] 分时竞价（基于小时级数据，多维度组合分析）
- [x] 分时预算（基于星期几调整预算）
- [x] 位置倾斜（首页/商品页百分比调整）
- [x] 智能否词（关键词否定 + 产品否定）
- [x] 智能否ASIN（CREATE_NEGATIVE_PRODUCT_TARGET）
- [x] 搜索词收割（CREATE_KEYWORD + ASIN重定向到product target）
- [x] Ngram自动否定分析
- [x] 品牌词保护
- [x] 探索期保护
- [x] 生命周期感知调度
- [x] 自我进化引擎
- [x] 安全护栏（出价/预算/位置）
- [x] 紧急优化模式
- [x] 失败任务重试队列

### 优化目标达成度进度条
需要在前端确认是否有对应的展示组件。

## 3. 关键问题发现

### P0 - 严重问题

1. **分时竞价基于模拟数据**：`generateHourlyFromDaily` 使用固定的流量分布模型从daily数据生成hourly数据。分时竞价的规则计算 `analyzeHourlyPerformance` 依赖的是这些模拟的小时级数据，而非真实的小时级数据。这意味着分时竞价的精度受限于模拟数据的准确性。

2. **分时竞价修改baseBid但不恢复**：分时竞价将关键词的出价从baseBid调整为adjustedBid（baseBid × multiplier），但代码中没有看到在时段结束后将出价恢复到baseBid的逻辑。这意味着如果某个时段将出价提高了40%，在下一个时段如果multiplier是1.0，则出价不会变回原来的baseBid。

3. **搜索词绩效数据是累计值**：搜索词的clicks/impressions/orders/spend/sales是SUMMARY模式下的累计值（跨多个批次聚合），而非按日期维度的数据。这可能导致否词/收割决策基于不精确的数据。

### P1 - 重要问题

4. **分时竞价对所有关键词逐条API调用**：每个campaign的每个enabled关键词都会单独调用 `syncBidAdjustmentsToAmazon`，在大量关键词的情况下会产生大量API调用，容易触发限流。

5. **搜索词分析对每个campaign逐条查询DB**：`getKeywordsByCampaignId`、`getAdGroupsByCampaignId`、`getSearchTermsByCampaignId` 在循环内被调用，存在N+1查询问题。

6. **否定关键词去重查询在循环内**：每个否定关键词决策都会查询DB检查是否已存在，应该预加载。

## 4. API限流服务评估

### 架构
- 使用令牌桶算法 + 滑动窗口计数器
- 分端点类型（list/mutate/report/snapshot）
- Per-account退避 + 全局TPS上限
- 内存存储（单实例部署）

### 限流配置

| 端点类型 | Per-Account TPS | 全局TPS | Per-Account/分钟 | 全局/分钟 |
|---------|----------------|---------|-----------------|----------|
| list | 8 | 30 | 400 | 1500 |
| mutate | 4 | 15 | 200 | 750 |
| report | 1 | 5 | 30 | 150 |
| snapshot | 1 | 3 | 20 | 60 |

### 问题
1. **内存存储不支持分布式**：如果未来扩展到多实例，限流状态无法共享。
2. **全局TPS上限可能不够**：200-500租户场景下，全局30 TPS的list端点可能不够用。
3. **退避恢复可能过快**：指数恢复策略在高并发下可能导致频繁触发429。

## 5. 多租户数据隔离评估

### 已实现的隔离措施
- v387: 关键词绩效同步添加accountId过滤
- v387: 商品定位绩效同步添加accountId过滤
- v387: 广告组预加载添加accountId过滤
- 搜索词分析中关键词去重检查添加accountId过滤
- 优化目标引擎通过accountId获取campaigns

### 潜在隔离风险
1. **关键词文本匹配兜底策略**：`kwByText` Map按纯文本匹配，如果两个不同账户有相同的关键词文本，可能会匹配到错误的关键词。但由于预加载时已按accountId过滤，这个风险已被消除。
2. **否定关键词去重**：使用campaignId过滤，campaignId在不同账户间是唯一的（Amazon分配），隔离正确。


## 6. 多租户数据隔离详细评估

### 数据同步层隔离

| 模块 | accountId过滤 | 隔离状态 | 备注 |
|------|-------------|---------|------|
| Campaign同步 | ✅ | 正确 | eq(campaigns.accountId, this.accountId) |
| AdGroup同步 | ✅ | 正确 | eq(adGroups.accountId, this.accountId) |
| Keyword同步 | ✅ | 正确 | eq(keywords.accountId, this.accountId) |
| ProductTarget同步 | ✅ | 正确 | eq(productTargets.accountId, this.accountId) |
| SearchTerm同步 | ✅ | 正确 | eq(searchTerms.accountId, this.accountId) |
| 绩效数据预加载 | ✅ v387修复 | 正确 | 关键词/商品定位/广告组均按accountId过滤 |
| DailyPerformance UPSERT | ✅ | 正确 | 唯一约束包含accountId |

### 优化层隔离

| 模块 | 隔离机制 | 状态 |
|------|---------|------|
| 搜索词分析 | performanceGroupId + accountId | ✅ 正确 |
| 分时竞价 | config.accountId → campaigns过滤 | ✅ 正确 |
| 出价优化 | config.accountId | ✅ 正确 |
| 否定关键词去重 | campaignId (Amazon唯一) | ✅ 正确 |
| 锁管理 | accountId + module组合锁 | ✅ 正确 |

### 潜在风险点

1. **kwByText纯文本兜底匹配**：虽然预加载时已按accountId过滤，但如果同一账户内有重复的keywordText，最后一个会覆盖前一个。这不是跨租户问题，但可能导致同一账户内的数据匹配不准确。

2. **分布式锁连接泄漏**：lockManager使用MySQL GET_LOCK，每个锁持有一个连接。在500租户场景下，如果大量账户同时获取锁，可能耗尽连接池。当前连接池大小25，分布式锁清理间隔5分钟，最大持有30分钟。

## 7. 同步调度架构评估（200-500租户）

### 当前配置

| 参数 | 值 | 说明 |
|------|---|------|
| 高频同步间隔 | 15分钟 | 广告活动状态、预算 |
| 中频同步间隔 | 30分钟 | 广告组、关键词、定位 |
| 完整同步间隔 | 2小时 | 所有数据 |
| 高频最大账号数 | 80 | 每周期 |
| 中频最大账号数 | 120 | 每周期 |
| 完整同步最大账号数 | 200 | 每周期 |
| 最大并发账号数 | 15 | 可通过环境变量调整 |
| 连接池大小 | 25 | 可通过环境变量调整 |
| 连接泄露超时 | 120秒 | 自动回收 |

### 500租户场景分析

- 完整同步：每2小时最多200个账号，500个账号需要3个周期（6小时）完成一轮
- 高频同步：每15分钟最多80个账号，500个账号需要7个周期（约2小时）
- 中频同步：每30分钟最多120个账号，500个账号需要5个周期（约2.5小时）

### 关键瓶颈

1. **数据库连接池**：25个连接，15个并发账号 + 分布式锁连接 + 健康检查 = 可能不够
2. **API全局TPS**：list 30 TPS，500个账号每个需要多次API调用，可能导致频繁限流
3. **内存限流存储**：单实例部署，无法水平扩展
4. **单实例瓶颈**：所有同步和优化都在一个Node.js进程中运行
