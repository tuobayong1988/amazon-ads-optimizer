# v401 优化任务清单

## 1. 修复SP自动定向同步N+1查询 (amazonSyncService.ts:1065-1147)
- 问题：循环内逐行查adGroups和productTargets
- 方案：预加载adGroups Map + 批量UPSERT替代逐行INSERT/UPDATE

## 2. 优化广告活动页面加载 (campaign.ts + campaigns.ts)
- 问题：getCampaignsWithPerformance一次加载所有campaigns无后端分页
- 方案：添加后端分页支持，前端传page/pageSize参数

## 3. 优化数据库连接池配置 (connection.ts)
- 问题：默认25连接可能不足以支撑200-500租户
- 方案：优化连接池参数，添加连接复用策略

## 4. 增强同步超时处理 (unifiedSyncEngine.ts)
- 问题：超大账户(6114广告组)同步超时
- 方案：分解full层同步步骤为更细粒度的子任务，支持断点续传

## 5. 基础设施升级建议
- EC2: t3.small(2GB) → t3.medium(4GB) 或 t3.large(8GB)
- RDS: db.t4g.small(2GB) → db.t4g.medium(4GB)
