# 生产环境端到端审计关键发现

## 日期: 2026-03-19

## 关键发现总结

### 1. 优化引擎 IS WORKING - 出价调整确实在执行
- optimization_events表中有大量 `bid_adjustment` 事件，`api_sync_status=synced`
- 分时竞价(dayparting_bid)正在正常工作
- 示例：pilates ring $1.19 → $0.95, pilates workout equipment $1.70 → $1.36
- 这些都是"普拉提套装产品优化"目标下的真实关键词

### 2. 部分关键词同步失败 - entityNotFoundError
- 原因：本地数据库中的keyword ID在Amazon端已不存在
- 表现：SP关键词出价批量同步 发送=50, 成功=0, 失败=50（某些批次100%失败）
- 但其他批次有成功的（从optimization_events中可以看到synced状态的bid_adjustment）
- 根本原因：这些keyword可能已在Amazon Seller Central中被手动删除，但本地DB未同步

### 3. system_alerts表不存在
- 告警写入失败：INSERT INTO system_alerts ... 表不存在
- 影响：系统告警无法持久化到数据库

### 4. audit_logs写入失败
- userId和accountId为NOT NULL但系统级操作没有这些值
- 已修复：为系统级操作提供默认值(userId=0, accountId=0)

## v454修复清单
1. ✅ bidOptimizationExecutor: 添加amazon_deleted关键词过滤
2. ✅ keywords.ts: DB查询层面过滤amazon_deleted关键词
3. ✅ amazonApiHelper: syncBidAdjustmentsToAmazon中检测entityNotFoundError并自动标记
4. ✅ auditLogService: 为NOT NULL字段提供默认值
5. ✅ performanceGroup: batchUpdateCampaignStatus记录optimization_events
6. ✅ amazonAdsApi: 报告超时从5分钟增加到10分钟
7. ✅ performanceGroup: batchRemoveCampaignsFromGroup添加访问控制
