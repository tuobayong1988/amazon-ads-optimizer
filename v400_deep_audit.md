# v400 深度审计 - 数据同步覆盖式回填验证

## 1. dailyPerformance表 UPSERT验证

唯一键定义: `uk_daily_perf(accountId, campaignId, date, adType)`

这意味着同一个账户、同一个广告活动、同一天、同一个广告类型的数据只会有一条记录。当同步新数据时，如果已存在相同唯一键的记录，会通过 `onDuplicateKeyUpdate` 覆盖所有绩效字段（impressions, clicks, spend, sales等），而不是累加。

**结论: 覆盖式回填实现正确**，不会出现同一日期多次同步导致数据累计的问题。

## 2. 需要进一步检查的问题

### 2.1 各表的唯一键和UPSERT验证

| 表名 | 唯一键 | UPSERT方式 | 覆盖式回填 | 状态 |
|------|--------|------------|----------|------|
| daily_performance | uk_daily_perf(accountId, campaignId, date, adType) | onDuplicateKeyUpdate | ✅ 正确 | 正常 |
| hourly_performance | uk_hourly_perf(accountId, campaignId, date, hour) | onDuplicateKeyUpdate | ✅ 正确 | 正常 |
| placement_performance | uk_placement_perf(campaignId, accountId, placement, date) | onDuplicateKeyUpdate | ✅ 正确 | 正常 |
| search_terms | uk_search_term(accountId, campaignId, adGroupId, searchTerm, reportStartDate) | UNIQUE约束 | ✅ 正确 | 正常 |
| keyword_placement_hourly_performance | idx_kph_unique_combo (INDEX而非UNIQUE!) | SELECT+UPDATE/INSERT | ⚠️ 潜在问题 | **需修复** |

### 2.2 关键问题：keyword_placement_hourly_performance表缺少UNIQUE约束

`idx_kph_unique_combo` 被定义为普通 INDEX 而非 UNIQUE 索引。这意味着：

1. 如果并发写入，可能产生重复记录（两个进程同时SELECT发现不存在，然后同时INSERT）
2. 无法使用onDuplicateKeyUpdate进行真正的UPSERT
3. 当前使用SELECT+UPDATE/INSERT模式，在高并发下有竞态条件风险

**修复方案：** 将 `idx_kph_unique_combo` 从 INDEX 改为 UNIQUE，并将写入逻辑改为 onDuplicateKeyUpdate

### 2.3 广告位绩效的UPSERT
广告位绩效数据有正确的UNIQUE约束 `uk_placement_perf`，且使用 `onDuplicateKeyUpdate` 进行覆盖式回填。状态正常。

## 3. 目标达成度计算逻辑不一致

### 3.1 Dashboard页面的简单计算（前端）
Dashboard中的目标达成度使用**简单的比值计算**：
- ACoS目标：`targetValue / actualAcos * 100`
- ROAS目标：`actualRoas / targetValue * 100`
- 预算目标：`actualSpend / targetValue * 100`

### 3.2 OptimizationTargets页面的七维度评分（后端）
OptimizationTargets页面调用后端的`goalProgressAlgorithm.ts`，使用**七维度加权评分**：
1. 核心指标达成度（时间衰减加权）
2. 趋势改善度（多时间窗口）
3. 预算效率
4. 转化效率
5. 渐进优化进度
6. NextGen算法效能
7. 广告效率

**问题：** 两个页面展示的"目标达成度"数值可能差异很大，用户会感到困惑。

**建议：** 统一使用后端七维度评分算法，Dashboard页面也应调用后端API获取评分。

## 4. 智能优化指令API调用验证

### 4.1 API调用链路
优化指令通过以下链路传递给亚马逊：
1. `optimizationTargetEngine.ts` → 各执行器（dayparting/bid/budget/searchTerm/placement）
2. 执行器 → `amazonApiHelper.ts` 中的批量同步方法
3. `amazonApiHelper.ts` → `syncService.client.updateKeywordBids()` 等实际API调用
4. API调用包装了 `withRetry` 重试逻辑（最多4次重试，指数退避）

### 4.2 API限流处理
- 全局TPS限制：list=30, mutate=15, report=5, snapshot=3
- Per-account退避：429错误触发指数退避（最低降到30%TPS）
- 重试策略：最大退避30秒

### 4.3 潜在问题
- 500租户规模下，全局TPS限制可能不够（30 TPS list × 500账户 = 需要更长的同步窗口）
- 分布式锁使用MySQL GET_LOCK，锁持有期间占用连接池连接

## 5. 多租户数据隔离验证

### 5.1 数据隔离实现
- 所有数据查询都通过 `accountId` 过滤
- 同步服务实例绑定到特定 `accountId`
- 优化引擎通过 `accountId` 隔离不同账户的优化任务

### 5.2 锁隔离
- 内存锁按 `account_{accountId}_{module}` 分组
- 数据库锁按 `ppcopt_{lockName}` 分组
- 不同账户的优化任务不会互相阻塞

## 6. 系统承载能力评估（200-500租户）

### 6.1 当前配置
- EC2: t3.small (2vCPU, 2GB RAM)
- RDS: db.t4g.small (2vCPU, 2GB RAM, 20GB)
- 连接池: 25连接
- 并发同步: 最多15个账户

### 6.2 瓶颈分析
- **内存瓶颈**: 2GB RAM严重不足，Node.js进程+数据库连接+缓存可能超过限制
- **数据库瓶颈**: 25连接池在500租户并发同步时可能不够
- **存储瓶颈**: 20GB存储在500租户规模下很快会满
- **同步时间**: 每周期最多100个账号，500租户需要5个周期（约10小时）才能完成一轮完整同步

### 6.3 建议
1. EC2升级到 t3.medium 或 t3.large
2. RDS升级到 db.t4g.medium，存储扩容到100GB+
3. 连接池增加到50-100
4. 考虑引入Redis缓存层
5. 考虑多实例部署+负载均衡

## 7. 基础设施实际配置（更新）

### 7.1 实际配置
- **EC2**: t3.medium (2vCPU, 4GB RAM) - 已从t3.small升级
- **RDS**: db.t4g.small (2vCPU, 2GB RAM, 20GB) - 仍需升级
- **连接池**: DB_POOL_SIZE=60 (环境变量设置)
- **并发同步**: MAX_CONCURRENT_ACCOUNTS=50
- **Node.js内存**: --max-old-space-size=2048

### 7.2 需要调整的配置
1. **RDS升级**: db.t4g.small → db.t4g.medium (需要AWS控制台操作)
2. **RDS存储扩容**: 20GB → 100GB (需要AWS控制台操作)
3. **Node.js内存**: 2048MB → 3072MB (EC2已是t3.medium=4GB RAM)

### 7.3 环境变量优化建议
- NODE_OPTIONS: `--max-old-space-size=3072` (当前2048，EC2已升级到4GB)
