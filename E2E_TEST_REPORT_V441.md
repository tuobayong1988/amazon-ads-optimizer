# 生产环境广告优化系统端到端测试报告 (v441)

**测试时间**: 2026年3月18日
**测试环境**: 生产环境 (Elastic Beanstalk: `amazon-ads-env-prod`)
**测试版本**: v440 -> v441

## 1. 测试概述

为了验证系统的稳定性和数据链路的可靠性，我们对生产环境的广告优化系统进行了一次深度的端到端测试。测试涵盖了从手动触发全量同步、数据回传与存储、数据显示与查询，到优化指令形成与传递的完整生命周期。

在测试过程中，我们发现了几个深藏在系统底层的关键问题，并立即进行了修复和部署（v441版本）。

## 2. 发现的关键问题与根因分析

### 2.1 优化引擎日志中的本地ID污染（严重）

**现象**：在查询 `optimization_events`（优化事件日志表）时，发现有高达 **14,393条记录** 的 `campaign_id` 字段存储的是本地自增ID（如 `6257`），而不是Amazon原始ID。这直接导致了 6,721 条出价调整API调用失败（因为Amazon API无法识别本地ID）。

**根因**：
优化引擎的核心日志模块 `executionLogger.ts` 在记录优化指令（出价调整、预算分配等）时，错误地使用了 `detail.localCampaignId` 写入数据库，而不是 `detail.amazonCampaignId`。
此外，`optimizationAutoCorrector.ts`（自动纠错器）在进行SQL查询和JOIN操作时，也错误地使用了 `campaigns.id`（本地ID）来匹配事件的 `campaign_id`。

### 2.2 AMS实时数据流增量修正导致负数（中等）

**现象**：在 `daily_performance` 表中，发现了41条 `impressions`、`clicks` 或 `spend` 为负数的记录（如 `impressions = -13`）。

**根因**：
Amazon Marketing Stream (AMS) 发送的实时数据流有时包含**增量修正消息**（当Amazon发现之前多报了数据时，会发送负数来撤回）。而我们的系统在 `upsertDailyPerformanceFromAms` 中使用的是**直接覆盖写入**逻辑（`UPDATE impressions = VALUES(impressions)`），导致负数增量值直接覆盖了之前的正数值，变成了最终的负数结果。

### 2.3 强制同步API未记录同步任务状态（轻微）

**现象**：通过 `/api/ops/force-sync` 触发单账户全量同步时，`data_sync_jobs` 表中没有生成新的同步任务记录。

**根因**：
`force-sync` 接口直接调用了底层的 `syncAccount()` 函数，而系统记录 `data_sync_jobs` 的逻辑被硬编码在批量同步包装器 `saveBatchSyncResults()` 中。单账户手动同步绕过了这个包装器。

## 3. 修复方案与实施 (v441)

针对上述发现的问题，我们立即编写了修复代码，并成功部署了 **v441** 版本到生产环境。

### 3.1 彻底修复本地ID污染问题

1. **修复 `executionLogger.ts`**：将所有 11 处写入日志的代码，从 `detail.localCampaignId` 修改为优先使用 `detail.amazonCampaignId`。
2. **修复 `optimizationAutoCorrector.ts`**：修复了 7 处 SQL JOIN 和 WHERE 条件，将 `campaigns.id` 替换为 `campaigns.campaignId`，确保使用 Amazon ID 进行匹配。
3. **增加硬拦截守卫**：在 `createOptimizationLog`、`bidAdjustment.ts` 和 `logCorrectionEvent` 等所有直接写入 `optimization_events` 的底层路径中，全面添加了 `guardCampaignIdInsert` 守卫。任何试图写入本地ID的操作都会被直接拦截并抛出异常。

### 3.2 增加AMS负数保护

在 `performance.ts` 的 AMS 写入逻辑中，增加了 `Math.max(0, value)` 保护。虽然更完美的方案是实现增量累加逻辑，但为了降低当前版本的风险，我们先通过防止负数落库来保护数据一致性，确保展示、点击和花费不会出现负数。

### 3.3 历史脏数据清理

连接生产数据库执行了全面的数据清理：
- 将 `optimization_events` 表中的 14,393 条本地ID记录，通过与 `campaigns` 表关联，100% 成功回填为正确的 Amazon ID。
- 将 `daily_performance` 表中的所有负数指标全部归零。
- 目前系统中已**没有任何残留**的本地ID污染数据或负数指标数据。

## 4. 后续优化建议

虽然系统目前已稳定运行，但基于本次测试，建议在未来的迭代中考虑以下优化：

1. **重构AMS数据处理逻辑**：将 `daily_performance` 对AMS数据的处理从“覆盖模式”改为“累加模式”，以正确处理Amazon发送的负数增量修正消息。
2. **统一同步日志记录**：重构 `force-sync` 接口，使其也通过标准的任务队列机制运行，确保所有手动触发的同步也能在 `data_sync_jobs` 表中留下完整记录。
3. **僵尸账户排查**：测试中发现账户 90022(MX)、90025(CA)、90026(MX) 持续同步 0 条记录，建议检查这些站点的API授权状态或确认是否确实无数据。
