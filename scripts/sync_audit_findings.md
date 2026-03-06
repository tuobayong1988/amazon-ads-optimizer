# 数据同步分批处理审计发现

## 已有分批处理的方法（✅ 正常）
1. `syncPerformanceData` (syncPerformance.ts:69) — 有31天分批逻辑

## 缺少分批处理的方法（❌ 需要修复）

### P0 - 搜索词报告
1. `syncSearchTerms` (amazonSyncService.ts:669) — SP搜索词，调用时传90天，无分批
2. `syncSbSearchTerms` (syncSb.ts:542) — SB搜索词，调用时传60天，无分批

### P0 - 其他报告类型
3. `syncAutoTargeting` (amazonSyncService.ts:850) — SP自动定向，调用时传90天，无分批
4. `syncPlacementPerformance` (syncPerformance.ts:1114) — SP广告位，调用时传90天，无分批
5. `syncSbPlacementPerformance` (syncSb.ts:1057) — SB广告位，调用时传60天，无分批
6. `syncSbTargeting` (syncSb.ts:711) — SB定向，调用时传60天，无分批
7. `syncSdTargeting` (syncSd.ts:442) — SD定向，调用时传90天，无分批
8. `syncKeywordPerformanceData` (syncPerformance.ts:549) — 关键词绩效，无分批
9. `syncAdGroupPerformanceData` (syncPerformance.ts:925) — 广告组绩效，无分批

### P1 - syncAll入口参数
10. `syncAll` (amazonSyncService.ts:295) — performanceDays硬编码为14天

## 修复策略
- 创建通用的分批执行工具函数 `executeBatchedReportSync`
- 对所有缺少分批处理的方法统一添加31天分批逻辑
- 将syncAll中的performanceDays改为从参数传入或使用90天默认值
