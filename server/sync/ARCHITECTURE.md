# v361: 数据同步服务架构统一方案

## 当前状态

系统中存在5套功能高度重叠的数据同步服务：

| 服务 | 位置 | 行数 | 状态 |
|------|------|------|------|
| AmazonSyncService | server/amazonSyncService.ts | 1,341 | **主入口** - 被路由和调度器直接引用 |
| dataSyncService | server/dataSyncService.ts | 1,064 | **调度层** - 仅被dataSync路由引用 |
| unifiedSyncEngine | server/unifiedSyncEngine.ts | 1,739 | **分片层** - 仅被shardSyncOrchestrator引用 |
| services/sync/ | server/services/sync/ | 8,542 | **实现层** - prototype扩展模式 |
| sync/ | server/sync/ | 6,620 | **v358废弃** - 独立函数模式，已无外部引用 |

## v361 统一方案

### 确定的架构层次

1. **调度层**: dataSyncScheduler.ts（定时触发）
2. **编排层**: amazonSyncService.ts（DAG调度、步骤编排）
3. **实现层**: services/sync/（具体的API调用和数据处理）

### 废弃模块

以下模块在v361中正式标记为deprecated，将在v362中删除：

- `server/sync/` - 整个目录（已被services/sync/替代）
- `server/unifiedSyncEngine.ts` - 分片同步引擎（功能已被amazonSyncService覆盖）
- `server/dataSyncService.ts` - 旧同步服务（功能已被amazonSyncService覆盖）
