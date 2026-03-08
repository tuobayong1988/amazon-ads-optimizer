# 竞价与预算服务架构指南

## 当前状态 (v361.0)

### 竞价服务层次

系统中存在3套竞价服务，各有不同的职责和适用场景：

| 服务 | 文件 | 行数 | 职责 | 状态 |
|------|------|------|------|------|
| `bidOptimizer` | `server/bidOptimizer.ts` | 1867 | 基础竞价算法：贝叶斯CVR平滑、边际价值计算、市场曲线、最优竞价搜索 | **基础层 - 保留** |
| `nextGenBidOrchestrator` | `server/nextGenBidOrchestrator.ts` | 1767 | 新一代竞价编排：LinUCB探索、模型训练、批量竞价计算 | **主入口 - 保留** |
| `bidCoordinator` | `server/services/bidCoordinator.ts` | 405 | 竞价协调：多来源竞价提案的冲突解决和安全限制 | **协调层 - 保留** |

**架构关系**: `nextGenBidOrchestrator` → 调用 `bidOptimizer` 的基础算法 → 通过 `bidCoordinator` 协调最终竞价

### 预算服务层次

| 服务 | 文件 | 行数 | 状态 |
|------|------|------|------|
| `budgetPortfolioOptimizer` | `server/budgetPortfolioOptimizer.ts` | 343 | **主入口 - 保留** |
| `budgetAllocationService` | `server/budgetAllocationService.ts` | 850 | **@deprecated - 待移除** |
| `intelligentBudgetAllocationService` | `server/intelligentBudgetAllocationService.ts` | 1066 | **@deprecated - 待移除** |

## 统一调用规范

### 竞价调用

所有竞价操作应通过 `nextGenBidOrchestrator` 作为唯一入口：

```typescript
// 正确 ✓
import { calculateNextGenBid, batchCalculateNextGenBids } from './nextGenBidOrchestrator';

// 错误 ✗ - 不应直接调用基础层
import { calculateBidAdjustment } from './bidOptimizer';
```

### 预算调用

所有预算分配操作应通过 `budgetPortfolioOptimizer` 作为唯一入口：

```typescript
// 正确 ✓
import { optimizeBudgetPortfolio } from './budgetPortfolioOptimizer';

// 错误 ✗ - 已废弃
import { allocateBudget } from './budgetAllocationService';
```

## 迁移计划

1. **Phase 1** (v361.0): 标记废弃服务，创建架构文档
2. **Phase 2** (v362.0): 将所有直接调用 `bidOptimizer.calculateBidAdjustment` 的代码迁移到 `nextGenBidOrchestrator`
3. **Phase 3** (v363.0): 删除废弃的预算服务文件
