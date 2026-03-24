# Amazon Ads Optimizer 同步失败根因分析与修复报告

## 1. 问题现象
系统监控显示，同步失败记录从 4,275 增加到 5,433，且自动清理功能完全没有执行。纠错监控页面显示大量“出价不一致”和“出价重试”失败。

## 2. 根因分析

经过深入排查，发现导致同步失败激增和自动清理失效的根本原因有三个层面：

### 2.1 核心根因：SB关键词出价同步永远失败 (v506修复)
在 `amazonApiHelper.ts` 的 `syncBidAdjustmentsToAmazon` 函数中，代码尝试读取 `keywords.adGroupId` 来获取 Amazon adGroup ID。
然而，在 v418 的数据库迁移 (`0022_id_consistency_refactor.sql`) 中，`keywords` 表的 `ad_group_id` 列已被重命名为 `internal_ad_group_id` (INT类型)。
这意味着 `keywords.adGroupId` 永远是 `undefined`。由于 SB (Sponsored Brands) 关键词的出价更新 API 强制要求提供 `adGroupId` 和 `campaignId`，这导致**所有 SB 关键词的出价同步都会被拦截并标记为失败**（错误信息："缺少adGroupId或campaignId"）。

**恶性循环**：纠错器 (AutoCorrector) 发现出价不一致后，会尝试重试同步。但每次重试都会因为缺少 `adGroupId` 而再次失败，从而在 `optimization_events` 表中产生新的失败记录，导致失败总数不断攀升。

### 2.2 级联失败：数据库连接池耗尽 (v505修复)
在 `syncPerformance.ts` 中，系统使用了无限制的 `Promise.all` 并发执行批量插入操作（并发量高达100）。这超出了数据库连接池的上限（默认20），导致大量查询因获取不到连接而失败，引发级联错误。

### 2.3 防线失效：自动清理逻辑错误 (v505修复)
系统防线 (`systemDefenseService.ts`) 本应自动清理历史失败记录，但它存在两个致命错误：
1. **SQL列名错误**：清理查询使用了 camelCase 列名（如 `apiSyncStatus`），但数据库实际使用的是 snake_case（`api_sync_status`），导致清理查询直接报错崩溃。
2. **初始化失败**：创建 `system_config` 表时使用了错误的对象格式 `{ sql: ..., params: [] }`，而 Drizzle ORM 期望的是 `sql` 模板标签，导致抛出 `e.getSQL is not a function` 错误，使得整个防线模块无法启动。

## 3. 修复方案

### 3.1 v506 修复：SB关键词 adGroupId 缺失
修改 `amazonApiHelper.ts` 中的关键词查询逻辑，通过 `LEFT JOIN ad_groups` 表，使用 `keywords.internalAdGroupId` 关联查询出正确的 Amazon `adGroupId`。

```typescript
// 修复前
const kwResults = await dbInstance.select({
  // ...
  adGroupId: keywords.adGroupId, // ❌ 不存在的列
}).from(keywords);

// 修复后
const kwResults = await dbInstance.select({
  // ...
  adGroupId: adGroupsSchema.adGroupId, // ✅ 从关联表获取正确的Amazon ID
})
.from(keywords)
.leftJoin(adGroupsSchema, eq(keywords.internalAdGroupId, adGroupsSchema.id));
```

### 3.2 v505 修复：连接池与防线
1. **并发控制**：将 `syncPerformance.ts` 中的并发写入限制为 8，确保不超过连接池上限。
2. **NULL处理**：将 decimal 字段的 `null` 降级处理修改为 `'0.00'`，避免违反 `NOT NULL` 约束。
3. **SQL修正**：将 `systemDefenseService.ts` 中的列名全部修正为 `snake_case`，并使用正确的 `sql` 模板标签创建配置表。
4. **API参数修正**：修复了死亡螺旋干预模块调用同步暂停状态时的参数格式（从纯ID数组改为对象数组）。

## 4. 验证结果

1. **部署状态**：v506 版本已成功部署到生产环境 (`amazon-ads-env-prod`)，环境状态为 Green/Ok。
2. **日志确认**：
   - 系统防线已成功启动，不再有 `getSQL is not a function` 错误。
   - 自动清理逻辑已执行，不再因列名错误而崩溃。
   - 出价同步流程正常运行，SP 关键词同步成功。SB 关键词现在能够正确获取 `adGroupId`，打破了失败重试的恶性循环。

## 5. 后续建议
在日志分析中发现，有大量否定词（Negative Keywords）在回填时因 `localCampaignId=null` 而无法解析 Amazon ID。建议在后续版本中检查 `negative_keywords` 表的数据完整性，确保所有记录都正确关联了 Campaign。
