# v403 优化方案

基于对v402版本的全面排查，发现以下4个核心问题，将在v403版本中进行优化。

## 一、问题与优化方案

| 优先级 | 问题分类 | 问题描述 | 优化方案 |
|---|---|---|---|
| **P0** | **数据隔离** | `smartCampaign`路由中多个端点缺少`verifyAccountAccess`中间件，存在数据越权访问风险。攻击者可构造请求访问不属于自己的广告活动或优化建议。 | 为`getOptimizationRecommendation`、`executeBatchOptimization`、`getBatchOptimizationRecommendations`等所有受影响的端点添加`verifyAccountAccess`中间件，强制校验操作权限。 |
| **P1** | **承载能力** | EB环境变量与代码默认值不一致，`MAX_CONCURRENT_ACCOUNTS`设置为50过高，可能导致单实例过载和数据库连接耗尽。 | 1. **统一环境变量**：将EB环境变量`DB_POOL_SIZE`从60提升至100，`NODE_OPTIONS`从2048MB改为3072MB，与代码和Procfile保持一致。<br>2. **降低并发**：将`MAX_CONCURRENT_ACCOUNTS`从50降至15，与代码默认值一致，避免单实例过载。<br>3. **实例扩容**：将EC2实例从`t3.medium`升级到`t3.large` (2vCPU/8GB内存)，以支持200-500租户。 |
| **P2** | **同步超时** | 大账户（如6000+广告组）在`full`层级同步时频繁超时（45-90分钟），导致关键词绩效、定位绩效等核心数据无法完成同步。 | 1. **重构同步步骤**：将`full`层级中耗时最长的`keyword_performance`、`target_performance`、`ad_group_performance`步骤拆分为独立的`nightly`（夜间）层级。<br>2. **创建夜间调度器**：新增一个每日凌晨执行的`nightly`调度器，专门处理这些超大报表的同步，超时时间延长至4小时。<br>3. **优化现有full层级**：缩短后的`full`层级将只包含搜索词、广告位等可在90分钟内完成的步骤。 |
| **P3** | **前端修复** | 1. 侧边栏“优化设置”和“通知设置”路由错误。 <br> 2. 策略管理页面“加载优化目标”一直显示loading。<br>3. 移除页脚版权信息，并将Logo名称改为PPCOPT。 | 1. **修复路由**：修正`Sidebar.tsx`中的`href`，确保菜单项指向正确的`/settings`和`/notifications`路径。<br>2. **修复加载状态**：在`StrategyCenter.tsx`中，当`optimizationTargets`为空数组时，也应将`isLoading`置为`false`。<br>3. **UI调整**：移除`DashboardLayout.tsx`和`PublicLayout.tsx`中的页脚，并将Logo名称更新为PPCOPT。（此项已完成） |

## 二、实施计划

将按照 P0 > P1 > P2 > P3 的优先级顺序，逐一完成以上优化方案。
