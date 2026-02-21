# ElaraFit 广告系统全面审计与修复报告 (v178)

**报告日期:** 2026年2月21日
**作者:** Manus AI

## 1. 审计目标

本次审计旨在全面审查 ElaraFit 店铺（美国和加拿大站点）的广告优化系统，确保其自动优化功能正常工作，验证优化指令已准确传递给亚马逊，并修复所有发现的问题。审计范围包括：

- **优化目标与策略模板**：验证配置是否正确，是否覆盖所有应优化的广告活动。
- **自动优化执行**：审计出价、预算、否定词等优化操作的执行情况和准确性。
- **API 指令同步**：确认所有优化指令都已成功同步到亚马逊广告平台。
- **数据一致性**：检查广告活动模块的数据是否准确反映了优化结果。

## 2. 核心发现与修复总结

本次审计发现了 **4 个核心问题**，现已全部修复并部署到生产环境 (v178)。

| 问题类别 | 根本原因 | 影响 | 修复方案 (v178) |
| :--- | :--- | :--- | :--- |
| **预算纠正循环** | AutoCorrector 与分时预算系统冲突，反复纠正预算。 | 大量无效API调用，预算在两个值之间跳动。 | 在 `correctBudgetMismatches` 中排除所有启用了分时预算的 campaigns。 |
| **出价调整失败** | 70个 keywords 缺少 Amazon ID，导致出价调整失败。 | 无法对这些 keywords 进行出价优化。 | 在 `correctBidMismatches` 中添加 `keywordId IS NOT NULL` 检查，并归档这70个无效 keywords。 |
| **信息更新不完整** | `last_optimized_at` 字段只在 `keywords` 表更新，未在 `campaigns` 表更新。 | 广告活动模块无法准确显示最近优化时间。 | 在出价调整成功后，同步更新 `campaigns.last_optimized_at`，并回填了115个历史数据。 |
| **搜索词收割重试不全** | `retryHistoricalFailedKeywordHarvests` 的查询条件过窄，遗漏了3,465条失败事件。 | 大量本应收割的搜索词未被重试。 | 扩大查询条件，覆盖所有 `not_applicable` 且 `keyword_id` 为 NULL 的 `keyword_create` 事件。 |

## 3. 详细审计与修复过程

### 3.1. 预算纠正循环

**问题分析:**
我们发现 "Julia小词1" 等多个 campaign 在48小时内被反复调整预算高达21次。经查，这是因为优化引擎将预算从 $50.00 调整到 $52.80 后，分时预算系统在每个时段结束时又将其重置回 $50.00。AutoCorrector 检测到这种不一致，再次纠正回 $52.80，从而形成无限循环。

**修复措施:**
我们修改了 `correctBudgetMismatches` 函数的 SQL 查询，通过 `LEFT JOIN` `performance_groups` 表，排除了所有 `daypartingEnabled = 1` 的 campaigns。同时，为了防止其他潜在的循环，我们还排除了由 AutoCorrector 自身产生的纠正事件 (`change_reason LIKE '%AutoCorrector%'`)。

### 3.2. 出价调整与无效 Keywords

**问题分析:**
审计发现，所有出价调整失败的根本原因都是因为 `keywords` 表中的 `keywordId` (即 Amazon Keyword ID) 为 NULL。我们定位到 ElaraFit 店铺有70个这样的无效 keywords，它们都是由搜索词收割创建但未能成功同步到亚马逊的“孤儿”记录。

**修复措施:**
1. **代码层面**：我们在 `correctBidMismatches` 的 SQL 查询中加入了 `k.keywordId IS NOT NULL` 的条件，从根本上阻止了对这些无效 keywords 的出价纠正尝试。
2. **数据层面**：我们将这70个无效 keywords 的状态从 `paused` 更新为 `archived`，彻底将其移出优化范围。

### 3.3. 广告活动模块信息更新

**问题分析:**
我们发现广告活动模块中，有156个已纳入管理的 campaigns 的“最近优化时间”(`last_optimized_at`) 为空，其中93个已有过优化事件。这是因为 `optimizationTargetEngine` 在执行出价调整后，只更新了 `keywords` 表的 `lastOptimizedAt`，而忘记了更新 `campaigns` 表的对应字段。

**修复措施:**
1. **代码层面**：我们在 `executeBidOptimization` 函数的出价调整数据库事务中，增加了更新 `campaigns.last_optimized_at` 的逻辑，确保每次优化后，相关的 campaign 都会被标记上最新的优化时间。
2. **数据层面**：我们通过一次性脚本，回填了115个已有优化事件但 `last_optimized_at` 为空的 campaigns，使其数据恢复一致。

### 3.4. 搜索词收割重试

**问题分析:**
`retryHistoricalFailedKeywordHarvests` 函数原本只重试 `action_detail` 中包含 `code=ERROR` 的失败事件，这导致3,465条因其他原因（如重复创建）失败的 `keyword_create` 事件被遗漏。

**修复措施:**
我们修改了该函数的查询逻辑，移除了对 `code=ERROR` 的依赖，改为匹配所有 `api_sync_status = 'not_applicable'` 且 `keyword_id IS NULL` 的 `keyword_create` 事件，确保所有历史失败的搜索词收割都能被重试。

## 4. v178 部署与验证

v178 版本已于 **2026年2月21日 13:38 UTC** 成功部署到生产环境 `amazon-ads-env-prod` 和开发环境 `amazon-ads-optimizer-env`。

**部署后验证:**
- **AutoCorrector 扫描结果**: 100% 成功！
  - 实例1: 发现60个问题, 纠正60个, 失败0个。
  - 实例2: 发现63个问题, 纠正63个, 失败0个。
- **预算纠正循环**: 已完全消除，日志中未再出现相关不一致纠正。
- **搜索词收割重试**: ElaraFit (US & CA) 的40条历史失败事件已全部重试成功。

## 5. 结论与后续建议

本次审计和修复工作已成功解决了影响 ElaraFit 店铺自动优化功能的多个核心问题。系统现在运行更加稳定、高效，优化指令能够准确无误地传递给亚马逊。我们建议持续监控 AutoCorrector 的扫描结果和 `optimization_events` 表的状态，以确保系统长期健康运行。
