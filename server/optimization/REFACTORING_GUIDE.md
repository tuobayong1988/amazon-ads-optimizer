# optimizationTargetEngine.ts 拆分重构指南

## 背景

原始 `optimizationTargetEngine.ts` 文件包含 5318 行代码，承载了从出价优化到搜索词分析的全部优化执行逻辑。v359 版本开始按优化类型逐步拆分。

## 职责分析

| 函数 | 行数范围 | 职责 |
| :--- | :--- | :--- |
| `executeOptimizationTarget` | 303-1087 | 主入口，协调所有优化子任务 |
| `executeBidOptimization` | 1088-1766 | 出价优化（678行） |
| `executePlacementOptimization` | 1767-1946 | 位置优化（179行） |
| `executeDaypartingOptimization` | 1947-2405 | 分时调价（458行） |
| `executeDaypartingBudgetOptimization` | 2406-2565 | 分时预算（159行） |
| `executeSearchTermAnalysis` | 2566-3642 | 搜索词分析（1076行） |
| `executeBudgetAllocation` | 3643-3776 | 预算分配（133行） |
| `executeKeywordStatusChanges` | 3777-4105 | 关键词状态管理（328行） |
| `executeCampaignStatusChanges` | 4106-4322 | 广告活动状态管理（216行） |
| `executeAdGroupStatusChanges` | 4323-4515 | 广告组状态管理（192行） |
| `executeBidCoordination` | 4516-4652 | 出价协调（136行） |
| `executeAutoNgramNegation` | 5166-5318 | 自动N-gram否定（152行） |

## 拆分策略

按优化类型拆分为独立模块，主入口保留在 `optimizationTargetEngine.ts` 中作为协调器。

| 子模块 | 包含函数 |
| :--- | :--- |
| `bidOptimizationExecutor.ts` | `executeBidOptimization`, `executeBidCoordination` |
| `placementOptimizationExecutor.ts` | `executePlacementOptimization` |
| `daypartingExecutor.ts` | `executeDaypartingOptimization`, `executeDaypartingBudgetOptimization` |
| `searchTermExecutor.ts` | `executeSearchTermAnalysis`, `executeAutoNgramNegation` |
| `budgetExecutor.ts` | `executeBudgetAllocation` |
| `statusManagementExecutor.ts` | `executeKeywordStatusChanges`, `executeCampaignStatusChanges`, `executeAdGroupStatusChanges` |

## 当前状态

v359.0 完成了拆分规划，实际函数迁移将在后续版本中逐步进行，以避免引入回归风险。
