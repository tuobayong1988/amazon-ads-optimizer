# 集成审查发现

## 关键调用链路
1. `_core/index.ts` → `startDataSyncScheduler()` + `startOptimizationScheduler()`
2. `dataSyncScheduler.ts` → `daily_bid_optimization` case → `optimizationTargetEngine.executeOptimizationTarget()`
3. `optimizationTargetEngine.ts` → `executeBidOptimization()` → `bidOptimizer.optimizePerformanceGroupEnhanced()`
4. `routers.ts` → 所有tRPC API路由（导入了bidOptimizer等，但没有导入任何新模块）

## 缺失的集成点

### 1. optimizationTargetEngine.ts — 核心出价流程
- 第1055行：`bidOptimizer.optimizePerformanceGroupEnhanced()` 是实际执行出价优化的入口
- **需要在此处集成nextGenBidOrchestrator**：在调用现有算法前，先尝试使用下一代算法

### 2. dataSyncScheduler.ts — 定时任务
- 没有注册任何新算法的维护任务（特征缓存、Sigmoid拟合、RL Reward回填、因果分析、CQL训练）
- **需要添加新的定时任务case**

### 3. routers.ts — API路由
- 没有导入任何新模块
- **需要添加API端点**：预算组合优化、关键词图谱、因果分析结果查询等

### 4. bidOptimizer.ts — 出价算法
- 现有的`calculateEnhancedBidAdjustment`完全没有调用新算法
- nextGenBidOrchestrator已经设计了与bidOptimizer的接口，但没有被任何地方调用
