# Amazon Ads Optimizer v505 核心修复报告

## 1. 问题根源分析

在系统防线（System Defense）部署后，同步失败记录从 4,275 增加到 5,433，且自动清理完全没有执行。经过深入排查，我们发现了导致系统级联失败的五个根本原因：

### 1.1 数据库连接池耗尽 (Connection Pool Exhaustion)
在 `syncPerformance.ts` 中，系统使用了 `Promise.all` 并发执行 100 个数据库写入操作。由于 Drizzle ORM 的数据库连接池上限配置为 20，这种高并发直接导致了连接池耗尽（`Too many connections` / `ECONNREFUSED`）。这不仅导致当前的同步任务失败，还阻塞了系统中其他所有需要数据库连接的操作，引发了级联故障。

### 1.2 字段 NULL 约束冲突
在处理 Amazon API 返回的绩效数据时，系统将 `ctr`, `cvr`, `cpc`, `acos`, `roas` 等计算字段在分母为 0 时赋值为 `null`。然而，在数据库的 `keywords` 等表中，这些 `decimal` 字段虽然没有显式的 `NOT NULL` 约束，但在某些 Drizzle 插入操作中，传入 `null` 会导致 SQL 执行失败。

### 1.3 SQL 语法错误 (e.getSQL is not a function)
在 `systemDefenseService.ts` 的 `ensureSystemConfigTable` 函数中，使用了错误的对象格式 `{ sql: '...', params: [] }` 来调用 `dbInstance.execute()`。Drizzle ORM 期望的是 `sql` 模板标签，这导致了 `e.getSQL is not a function` 错误，使得 `system_config` 表无法创建，进而导致后续依赖该表的防线功能（如算法熔断检查）全部失效。

### 1.4 数据库列名映射错误 (camelCase vs snake_case)
在 `systemDefenseService.ts` 的清理同步失败记录和算法健康检查功能中，直接编写的 SQL 语句使用了 `camelCase` 列名（如 `apiSyncStatus`, `actionDetail`, `changeReason`）。然而，`optimization_events` 表在数据库中的实际列名是 `snake_case`（如 `api_sync_status`, `action_detail`, `change_reason`）。这导致 SQL 查询直接报错，自动清理功能完全无法执行。

### 1.5 API 参数格式不匹配
在死亡螺旋干预和紧急优化模块中，调用 `syncCampaignStatusToAmazon` 时传入了纯 ID 数组 `(accountId, campaignIds, 'paused')`。但该函数的实际签名期望的是一个包含详细信息的对象数组 `Array<{amazonCampaignId, newStatus, campaignName, reason}>`。这导致了暂停高 ACoS 广告活动的同步操作失败。

## 2. v505 修复方案

针对上述根本原因，我们在 v505 版本中实施了以下彻底的修复：

### 2.1 引入受控并发机制
在 `syncPerformance.ts` 中，我们将无限制的 `Promise.all` 替换为受控并发。引入了 `CONCURRENCY_LIMIT = 8`，确保并发写入数量远低于连接池上限（20），彻底解决了连接池耗尽问题。

### 2.2 规范化空值处理
将所有计算字段的 `null` 降级处理修改为 `'0.00'` 或 `'0'` 字符串。这确保了与 `decimal` 字段的完美兼容，消除了因数据类型不匹配导致的插入失败。

### 2.3 修复 Drizzle ORM 调用方式
在 `ensureSystemConfigTable` 中，引入了 `import { sql } from 'drizzle-orm'`，并使用标准的 `sql` 模板标签重写了建表语句，解决了 `e.getSQL is not a function` 错误。同时增加了对 "表已存在" 错误的优雅处理。

### 2.4 统一 SQL 列名规范
全面审查并修改了 `systemDefenseService.ts` 中的所有原生 SQL 查询，将 `optimization_events` 表的查询条件从 `camelCase` 修正为 `snake_case`，确保与底层数据库结构完全一致。这使得同步失败清理和算法健康检查功能得以正常运行。

### 2.5 修正 API 调用签名
在死亡螺旋干预和紧急优化模块中，重构了传递给 `syncCampaignStatusToAmazon` 的参数，将其转换为符合函数签名的对象数组，并添加了详细的 `reason` 字段（如 `[SystemDefense] 死亡螺旋干预: ACoS=150.5%`），确保状态变更能够成功同步到 Amazon 端。

## 3. 预期影响与监控建议

v505 部署后，系统将恢复正常的自动优化和防线运作：

1. **同步失败记录将开始下降**：随着 `cleanupSyncFailures` 模块的正常运行，历史的无效同步记录（如已删除的实体）将被标记为 `not_applicable`。
2. **系统稳定性显著提升**：受控并发机制将彻底消除连接池耗尽导致的随机性 500 错误和级联故障。
3. **防线功能全面生效**：死亡螺旋干预和紧急优化将能够正确地将暂停指令同步到 Amazon，真正起到止血作用。

**监控建议**：
建议在接下来的 24 小时内，重点关注系统监控面板中的 "同步日志" 和 "系统健康" 模块，确认同步失败数量是否呈下降趋势，以及是否还有新的数据库连接错误产生。
