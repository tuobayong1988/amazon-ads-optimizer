# v272 自动优化停滞问题调查发现

## 调度架构

### 两个调度器
1. **dataSyncScheduler** - 数据同步 + 优化触发
2. **dataSyncScheduler.startOptimizationScheduler()** - 模块化优化调度

### 优化执行链路
dataSyncScheduler → executeOptimizationTask('daily_bid_optimization') 
→ shouldExecuteModuleForTarget() → executeOptimizationTarget()
→ nextGenOrchestrator.batchCalculateNextGenBids()
→ calculateNextGenBid() → selectBestAlgorithm() → evaluateAlgorithms()

## 关键发现

### 问题1: rule_engine占75%的根因
- cooldown_hold (冷却保护) 被标记为 tier='rule_engine'
- direction_hold (方向保护) 被标记为 tier='rule_engine'  
- 高级算法confidence不足时降级到规则引擎
- parseAlgorithmFromDetail() 默认归类为 'rule_engine'
- hold操作(维持出价不变)被计入优化操作统计

### 问题2: 自动优化可能停滞的原因
- 生命周期检查可能阻止执行
- 冷却期可能导致频繁跳过
- 执行锁竞争可能导致跳过
- hold操作不产生新的optimization_events记录
