# v399-fix2 数据同步模块审计笔记

## 1. 同步架构概述

系统采用DAG并行调度的5层同步架构（v359/v360），按层级依赖关系并行执行：

| 层级 | 同步内容 | 并行数 | 层间延迟 |
|------|---------|--------|---------|
| Layer 0 | SP/SB/SD广告活动 | 3 | 2000ms |
| Layer 1 | SP/SB/SD广告组 | 3 | 2000ms |
| Layer 2 | 关键词+商品定位+素材 | 6 | 2000ms |
| Layer 3 | 否定词+搜索词+广告位绩效 | 9 | 2000ms |
| Layer 4 | 定向报告+素材URL | 4 | 2000ms |
| Layer 5 | 绩效数据(SP/SB/SD+关键词+商品定位+广告组) | 4 | - |

## 2. 三阶段同步策略（v382）

| 模式 | SP天数 | SB天数 | SD天数 | 使用场景 |
|------|--------|--------|--------|---------|
| init | 90 | 60 | 90 | 新账号初始化 |
| daily | 14 | 14 | 14 | 日常增量同步 |
| recovery | 90 | 60 | 90 | 自愈恢复 |

## 3. 覆盖式回填实现分析

### 3.1 daily_performance表 - 正确实现覆盖式
使用 `onDuplicateKeyUpdate` 基于唯一约束 `uk_daily_perf (accountId, campaignId, date, adType)` 实现UPSERT。同一日期+同一广告活动+同一广告类型的数据会被覆盖而非累加。**这是正确的实现方式。**

### 3.2 搜索词表 - 正确实现覆盖式
使用 `flushSearchTermBatch` 函数，通过 `onDuplicateKeyUpdate` 实现UPSERT。同一搜索词的数据会被覆盖。

### 3.3 自动定向数据 - 存在问题
`syncAutoTargeting` 方法使用逐条 `existing` 检查 + `update/insert` 模式，而非批量UPSERT。这种方式：
- 性能差：每条数据需要2次数据库查询（查adGroup + 查existing）
- 存在N+1查询问题
- 但覆盖逻辑本身是正确的（有则更新，无则插入）

## 4. 关键问题发现

### P0 - 严重问题

1. **自动定向同步N+1查询问题**：`syncAutoTargeting` 中对每条数据都执行 `db.select().from(adGroups)` 和 `db.select().from(productTargets)` 查询，在大数据量下会严重拖慢同步速度。

2. **搜索词campaignId使用不一致**：搜索词数据中 `campaignId` 字段存储的是 `campaign.campaignId`（Amazon的campaignId），而不是本地数据库的 `campaign.id`。这可能导致关联查询时出现问题。

### P1 - 重要问题

3. **出价/预算保护机制降级风险**：`getRecentlyOptimizedKeywordIds` 在查询失败时返回空Set，这意味着保护机制完全失效，可能导致优化后的出价被API数据覆盖。

4. **syncAllAdData 方法是串行执行**：与 `syncAll` 的DAG并行不同，`syncAllAdData` 完全串行执行所有步骤，效率低下。

5. **数据保留期clamp使用UTC时间**：`clampStartDateForRetention` 使用 `new Date()` 计算安全日期，但没有考虑站点时区。

### P2 - 一般问题

6. **大量@ts-ignore注释**：代码中有大量 `@ts-ignore` 注释，表明类型系统不够严谨。

7. **步骤级重试配置硬编码**：重试次数、延迟等参数硬编码在代码中，无法通过环境变量调整。

## 5. 数据覆盖式回填总结

| 数据类型 | 覆盖方式 | 是否正确 | 备注 |
|---------|---------|---------|------|
| daily_performance | onDuplicateKeyUpdate | 是 | 基于唯一约束覆盖 |
| 搜索词 | onDuplicateKeyUpdate | 是 | 批量UPSERT |
| 自动定向 | 逐条check+update/insert | 是(但低效) | N+1查询问题 |
| 关键词绩效 | 待确认 | 待确认 | 需要检查syncKeywordPerformanceData |
| 商品定位绩效 | 待确认 | 待确认 | 需要检查syncProductTargetPerformanceData |


## 6. 关键词绩效同步 - 重大问题发现

### P0 - 严重数据累加问题
`syncKeywordPerformanceData` 使用SUMMARY模式报告，在分批请求时（每批31天），同一keyword在不同批次中会出现。虽然v395添加了聚合逻辑（按targetId/keywordId累加），但这个聚合本身就是**累加**而非覆盖。

关键问题：关键词/商品定位的绩效数据直接写入 `keywords` 和 `product_targets` 表的字段中（如impressions, clicks, spend, sales等），**每次同步都会用累加后的数据覆盖这些字段**。这意味着：
- 如果同步90天数据，keywords表中的spend/sales等字段存储的是90天的累计值
- 如果同步14天数据，存储的是14天的累计值
- **不同同步天数会导致不同的绩效数据，这是不精确的**

### P1 - 关键词绩效不是按日存储
与 `daily_performance` 表不同，关键词绩效数据直接更新到 `keywords` 表的汇总字段中，没有按日期维度存储。这导致：
- 无法查看关键词的历史趋势
- 无法精确对比不同时间段的关键词表现
- 同步天数变化会导致数据不一致

### P2 - 小时级数据是模拟生成的
`generateHourlyFromDaily` 使用固定的流量分布模型从daily数据生成hourly数据，这不是真实的小时级数据。对于"分时竞价"功能来说，这个模拟数据的精度可能不够。

## 7. 数据同步完整性评估

| 广告类型 | 广告活动 | 广告组 | 关键词 | 商品定位 | 否定词 | 搜索词 | 绩效数据 | 广告位绩效 |
|---------|---------|--------|--------|---------|--------|--------|---------|----------|
| SP | 有 | 有 | 有 | 有 | 有(关键词+商品) | 有 | 有 | 有 |
| SB | 有 | 有 | 有 | 有 | 有(关键词+商品) | 有 | 有 | 有 |
| SD | 有 | 有 | N/A | 有 | 有(v382新增) | N/A | 有 | N/A |

SD搜索词和SD广告位绩效缺失，但SD广告类型本身不支持搜索词报告，这是正常的。
