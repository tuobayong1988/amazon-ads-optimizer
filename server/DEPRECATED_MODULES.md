# 废弃模块清理追踪

## v361 废弃模块清单

### 已完成清理（零引用，已归档）

| 模块 | 废弃版本 | 状态 |
| :--- | :--- | :--- |
| `idResolver.ts` | v360 | 已移至 `_archived/` |
| `searchAdsOptimizationEngine.ts` | v360 | 已移至 `_archived/` |

### 仍有引用（需迁移后删除）

| 模块 | 行数 | 废弃版本 | 引用数 | 替代方案 | 迁移计划 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `budgetAllocationService.ts` | 850 | v360 | 9处 | `budgetPortfolioOptimizer.ts` | v362: 重写budget路由 |
| `dataSyncService.ts` | 1,061 | v361 | 3处 | `amazonSyncService.ts` | v362: 重写dataSync路由 |
| `unifiedSyncEngine.ts` | 1,743 | v361 | 13处 | `amazonSyncService.ts` | v362: 重构分片同步 |
| `intelligentBudgetAllocationService.ts` | 1,066 | v360 | 6处 | `budgetPortfolioOptimizer.ts` | v362: 统一预算服务 |

**合计**: 4,720行废弃代码待清理，31处引用待迁移

### 废弃函数（保留文件，已添加运行时警告）

| 函数 | 所在文件 | 废弃版本 | 替代方案 | 状态 |
| :--- | :--- | :--- | :--- | :--- |
| `generateMockPerformanceData` | `syncPerformance.ts`, `performanceSync.ts` | v148 | 已返回空结果 | 已添加警告 |
| `getAdAccounts()` (无参数版) | `db/accounts.ts` | v361 | `getAdAccountsByUserId()` | 已标记 |
| `getAllCampaigns()` (无参数版) | `db/campaigns.ts` | v361 | 使用带accountId过滤的查询 | 已标记 |
| `executeLayeredSync` | `dataSyncScheduler.ts` | v219 | `executeUnifiedSync` | 已添加警告 |
| `createSyncJob` | `dataSyncService.ts` | v361 | `amazonSyncService` | 已添加警告 |
| `executeSyncJob` | `dataSyncService.ts` | v361 | `amazonSyncService` | 已添加警告 |
| `getCampaignAmazonId` | `utils/idTypes.ts` | v361 | `extractCampaignIds()` | 待迁移(21处引用) |
| `getCampaignLocalId` | `utils/idTypes.ts` | v361 | `extractCampaignIds()` | 待迁移 |
| `getAdGroupAmazonId` | `utils/idTypes.ts` | v361 | `extractAdGroupIds()` | 待迁移 |
| `ensureAmazonCampaignId` | `utils/idTypes.ts` | v361 | `guardCampaignIdParam()` | 待迁移 |

## 清理原则

1. 只有零引用的模块才能安全删除
2. 有引用的模块先标记 `@deprecated`，在下一个版本完成迁移后删除
3. 废弃函数保留但添加运行时警告日志
4. 所有废弃模块的 `@deprecated` 标记必须包含：废弃版本号、替代方案、计划删除版本

## v362 清理路线图

1. 迁移 `routes/budget.ts` 中的所有 `budgetAllocationService` 和 `intelligentBudgetAllocationService` 引用
2. 迁移 `routes/dataSync.ts` 中的 `dataSyncService` 引用
3. 重构 `dataSyncScheduler.ts` 中的 `unifiedSyncEngine` 引用
4. 迁移 `optimizationTargetEngine.ts` 中的废弃函数调用
5. 删除所有零引用的废弃文件
6. 预计可清理 ~4,720 行废弃代码
