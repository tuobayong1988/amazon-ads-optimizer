# 源码升级分析报告

## 版本差距

| 维度 | GitHub 仓库 | 生产环境 |
|------|------------|---------|
| SYSTEM_VERSION | 529 | 621147 |
| package.json version | 5.2.8 | 5.79.4 |
| dist/index.js 行数 | ~180K (估计) | 206,629 |
| 服务器端模块数 | 384 (.ts) | 340 (bundle中) |

## 模块差异

### 生产环境独有的 21 个新模块（v529 之后新增）
这些模块需要从 dist/index.js 中反编译回 TypeScript 源码：

1. `server/_debug/debug-sync.ts` - 调试同步工具
2. `server/automation/optimizationHealthAlert.ts` - 优化健康告警
3. `server/automation/smartAutoEnrollService.ts` - 智能自动注册
4. `server/db/v550-patch/pendingEventProcessor.ts` - 待处理事件处理器
5. `server/services/adaptiveRateLimiter.ts` - 自适应限流器
6. `server/services/budgetRulesCoordinator.ts` - 预算规则协调器
7. `server/services/dataAnomalyDetector.ts` - 数据异常检测器
8. `server/services/dataRetentionService.ts` - 数据保留服务
9. `server/sync/checkpointManager.ts` - 检查点管理器
10. `server/sync/dateGapBackfillService.ts` - 日期缺口回填
11. `server/sync/distributedQueue.ts` - 分布式队列
12. `server/sync/nightlySyncMonitor.ts` - 夜间同步监控
13. `server/sync/performanceIntegrityChecker.ts` - 性能完整性检查
14. `server/sync/reportSemaphore.ts` - 报告信号量
15. `server/sync/startupTasks.ts` - 启动任务
16. `server/sync/syncSchedulerAdapter.ts` - 同步调度适配器
17. `server/sync/syncTaskConsumer.ts` - 同步任务消费者
18. `server/sync/tokenHealthChecker.ts` - Token健康检查
19. `server/sync/v534_upgrade_reconciliation.ts` - v534对账升级
20. `server/sync/v534_upgrade_syncEngine.ts` - v534同步引擎升级
21. `server/utils/dynamicLogLevel.ts` - 动态日志级别

### 仓库中有但生产环境不使用的 65 个模块
这些模块可能已被重构/合并/移除，需要逐一确认。

## 关键功能差异（v529 → v621147）

### P0-P5e 优化清单
1. **P0: Node.js 内存限制** - --max-old-space-size=6144
2. **P0: 流式报告处理** - 大报告分批处理
3. **P1: 并发控制** - XL账户串行化
4. **P1: 超时阈值调整** - Medium账户15-20分钟
5. **P2: Redis分布式队列** - 任务持久化
6. **P2: 空账户优化** - 跳过无活跃广告账户
7. **P3: 连接池优化** - 泄漏检测和健康检查
8. **P3: v550 PendingEventProcessor** - 待处理事件处理
9. **P4: 读写分离** - Read Replica路由
10. **P4: Redis任务队列持久化** - 低优先级异步执行
11. **P5: Async Report API** - 异步轮询替代同步等待
12. **P5: 微服务拆分** - Worker进程独立
13. **P5e: Worker进程启用** - P5_WORKER_ENABLED
14. **P5e: Redis队列深度监控** - CloudWatch指标
15. **P5e: 过期任务清理** - 自动清理失败任务

### 核心架构变更
- v534: Reconciliation对账系统
- v550: PendingEventProcessor事件驱动
- v595: AsyncReportService异步报告
- v596: ReportJobScheduler报告调度
- v612: Redis分布式队列集成
- v620: SQL列名修复和数据完整性
- v621: P0-P5e全部优化

## 构建工具链
- 前端: Vite + React + TailwindCSS → dist/public/
- 后端: esbuild bundle → dist/index.js
- 入口: server/_core/index.ts
- 构建命令: `pnpm build` = `vite build + node build-server.js`
