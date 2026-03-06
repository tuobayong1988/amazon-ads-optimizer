# 统一智能冷启动机制设计方案 (v1.0)

**作者:** Manus AI
**日期:** 2026-03-06
**状态:** 草案

## 1. 概述

本文档旨在设计一个统一的“智能冷启动”（Smart Cold-Start）机制，以解决系统在多种场景下（版本升级、新账户授权、API凭证刷新、新店铺/站点接入）初次面对大量历史数据时，优化启动速度慢、效率低下的问题。该机制的核心目标是：在触发事件发生后，立即对存量历史数据进行一次性的、深度的、快速的分析与优化，然后无缝衔接到常规的、高频的增量优化轨道，确保新算法、新账户第一时间发挥最大效用。

## 2. 核心问题与目标

根据对现有系统架构的审计，我们发现以下核心问题：

- **新账户初始化不足**: `accountInitializationService` 在新账户接入后虽执行了全量数据同步，但仅创建了常规的定时任务，未立即触发深度优化。导致新客户需要等待数个调度周期（最长可达24-48小时）才能看到初步的否定词、关键词等优化动作。
- **版本升级优化无差别**: `deployLifecycleManager` 在版本升级后会触发重优化，但对所有数据一视同仁，未区分近期数据和历史数据，导致优化资源未优先向最需要修正的历史数据倾斜。
- **场景覆盖不全**: 系统缺乏对“API凭证刷新”、“新增店铺/站点”等场景的感知，这些场景本质上与新账户接入类似，都引入了新的历史数据集，应触发同等的冷启动流程。

**设计目标**

- **统一化**: 创建一个可被不同模块调用的、统一的冷启动服务。
- **场景化**: 明确定义并覆盖四大触发场景。
- **分层化**: 实现按数据年龄（近期 vs. 历史）分层的差异化优化策略。
- **即时性**: 从触发到完成首次批量优化，全程自动化，将等待时间从天级缩短至小时级。

## 3. 设计方案

我们将引入一个新的核心服务 `coldStartService.ts`，并对现有模块进行改造以集成该服务。

### 3.1. 新增核心服务: `coldStartService.ts`

该服务将作为冷启动流程的统一协调器，对外暴露核心方法 `triggerColdStart(accountId, reason)`。

| 模块/函数 | 描述 |
| :--- | :--- |
| `triggerColdStart(accountId, reason)` | 接收账户ID和触发原因，作为冷启动流程的唯一入口。该函数将异步执行，避免阻塞调用方。 |
| `runHistoricalDataOptimization(accountId)` | **冷启动核心引擎**。负责执行针对历史数据的批量优化。它将调用 `optimizationTargetEngine` 并传入特定参数，强制对 **30-90天** 的数据执行一次性的、全面的分析和优化。 |
| `runRecentDataMonitoring(accountId)` | 负责处理近期数据。在冷启动场景下，此函数会确保常规的、高频的调度任务（如6小时一次的否定词优化）被立即触发一次，然后交由常规调度器 `dataSyncScheduler` 管理。 |
| `isColdStartNeeded(accountId)` | (可选) 一个辅助函数，用于判断一个账户是否需要执行冷启动，例如通过检查 `amazon_api_credentials` 表中的 `last_cold_start_at` 字段。 |

### 3.2. 引入数据年龄分层 (Data Age Stratification)

这是实现“智能”冷启动的关键。我们将修改核心优化和数据同步模块，使其能够接收和处理时间范围参数。

- **`optimizationTargetEngine.ts`**: `executeOptimizationTarget` 方法将增加一个可选的 `options` 参数，其中包含 `dateRange: { start: Date, end: Date }`。当此参数存在时，所有内部的数据查询（如获取搜索词、绩效数据）都将严格限制在该日期范围内。
- **`amazonSyncService.ts`**: 现有的 `syncAll` 方法虽然能拉取长周期数据，但我们将增强其灵活性，确保在冷启动时可以精确控制不同报告（搜索词、广告位、自动定向等）的回溯天数，例如统一拉取90天。

**数据分层策略:**

| 数据层级 | 时间范围 | 处理方式 | 核心任务 |
| :--- | :--- | :--- | :--- |
| **历史数据 (Historical)** | 30-90天前 | **一次性批量优化** | Ngram分析、全局否定词、高曝光低点击ASIN否定、无效搜索词否定、成熟关键词收割。 |
| **近期数据 (Recent)** | 过去7-14天 | **高频持续监控** | 按常规调度（6小时/12小时）执行，侧重于快速响应市场变化的竞价调整和短期表现差的否定。 |

### 3.3. 现有模块改造与集成

我们将改造以下模块，在关键节点调用 `coldStartService`。

1.  **`accountInitializationService.ts`**: 在 `initializeAccount` 和 `initializeMultipleAccounts` 函数成功完成数据同步后，调用 `coldStartService.tribusggerColdStart(accountId, 'new_account_setup')`。

2.  **`routes/amazonApi.ts`**: 在 `saveCredentials` 和 `saveMultipleProfiles` 接口中，当检测到是“刷新凭证”或“新增店铺/站点”时，同样调用 `coldStartService.triggerColdStart(accountId, 'credential_refresh_or_new_profile')`。

3.  **`deployLifecycleManager.ts`**: 在 `orchestrateStartup` 函数中，增加一个新的步骤，用于检测版本号变更。如果发生变更，则遍历所有账户，调用 `coldStartService.triggerColdStart(accountId, 'system_version_upgrade')`。

### 3.4. 数据库与状态管理

为了防止重复执行和方便追踪，我们将在 `amazon_api_credentials` 表中增加两个字段：

- `last_cold_start_at` (DATETIME, nullable): 记录上次成功执行冷启动的时间。
- `last_cold_start_version` (INT, nullable): 记录上次执行冷启动时的系统版本号。

`triggerColdStart` 函数在执行前会检查这些字段，例如“版本升级”场景的冷启动，对于一个给定的账户，只会在该版本首次部署时执行一次。

## 4. 实施计划

| 阶段 | 任务 | 涉及文件 | 预估工作量 |
| :--- | :--- | :--- | :--- |
| 1 | **创建 `coldStartService.ts`** | `server/coldStartService.ts` | 1 天 |
| 2 | **改造 `optimizationTargetEngine`** | `server/optimizationTargetEngine.ts` | 1 天 |
| 3 | **改造 `accountInitializationService`** | `server/accountInitializationService.ts` | 0.5 天 |
| 4 | **改造 `routes/amazonApi.ts`** | `server/routes/amazonApi.ts` | 0.5 天 |
| 5 | **改造 `deployLifecycleManager.ts`** | `server/deployLifecycleManager.ts` | 1 天 |
| 6 | **数据库迁移** | `migrations/XXXX_add_cold_start_fields.sql` | 0.5 天 |
| 7 | **测试与验证** | - | 2 天 |

## 5. 风险与对策

- **风险**: 批量历史数据处理可能导致短时API限流或系统高负载。
- **对策**: 在 `coldStartService` 中引入批处理和节流机制。对账户内的优化目标分批处理，每批之间设置延迟（如1分钟），确保平稳执行。

- **风险**: 错误的老数据可能导致错误的优化决策。
- **对策**: 冷启动优化将更侧重于“确定性”高的优化，如基于Ngram的全局否定和基于明确阈值（如 >1000曝光, 0点击）的ASIN否定，避免执行有风险的竞价调整。
