# Amazon Marketing Stream (AMS) 本地ID写入错误深度剖析与修复报告

**日期**: 2026-03-18
**作者**: Manus AI
**系统版本**: v439

## 1. 错误现象与问题背景

在Amazon Ads Optimizer系统中，我们发现了一个“理论上不应该存在”的严重错误：**系统中的 `daily_performance` 和 `keyword_placement_hourly_performance` 表中，部分记录的 `campaignId` 字段被错误地写入了本地数据库的自增ID（例如：73, 104），而不是Amazon原始的字符串ID（例如：116237412843019）。**

这个错误导致了以下连锁反应：
1. **数据断层**：前端查询和优化算法依赖Amazon ID进行关联，这些带有本地ID的绩效数据无法被正确匹配到对应的广告活动。
2. **重复数据**：由于ID不匹配，系统可能认为某些天/小时没有数据，从而重复拉取或生成错误的统计。
3. **外键逻辑破坏**：系统设计上，所有跨系统的业务表（如performance）都应该使用Amazon原始ID作为关联键。

## 2. 核心根因深度剖析

经过对系统源码的全面审计，我们定位到了导致这个问题的**三个核心根因**，它们共同作用导致了这个“不可能”的错误发生并持续存在。

### 根因一：ORM对象属性混淆 (sqsConsumerService.ts)

这是最直接的导火索。在处理AMS实时数据流的 `sqsConsumerService.ts` 中，代码需要将接收到的Amazon ID转换为本地的campaign记录：

```typescript
// 错误的代码逻辑
const campaign = await getCampaignByAmazonId(accountId, data.campaign_id);
if (campaign) {
  // 致命错误：这里使用了 campaign.id (本地自增int)
  // 而不是 campaign.campaignId (Amazon原始字符串ID)
  const localCampaignId = campaign.id; 
  
  await db.upsertDailyPerformanceFromAms({
    accountId,
    campaignId: localCampaignId, // 错误地将本地ID传给了需要Amazon ID的函数
    // ...
  });
}
```

在Drizzle ORM定义的 `campaigns` 表结构中：
- `id`: `int().autoincrement().primaryKey()` （本地ID）
- `campaignId`: `varchar(64)` （Amazon原始ID）

开发者在编写AMS消费逻辑时，**混淆了这两个字段**，错误地提取了 `campaign.id` 并将其作为 `campaignId` 传递给了底层写入函数。

### 根因二：TypeScript类型定义不严谨 (performance.ts)

为什么TypeScript编译器没有拦截这个错误？因为底层写入函数的参数类型定义过于宽泛：

```typescript
// 错误的方法签名
export async function upsertDailyPerformanceFromAms(data: {
  accountId: number;
  campaignId: number | null; // 致命漏洞：允许传入number类型
  date: string;
  // ...
})
```

由于 `daily_performance.campaignId` 在数据库中是 `varchar(64)`，这里的参数类型本应该是 `string | null`。但由于定义成了 `number | null`，TypeScript不仅没有报错，还在运行时将本地的 `number` ID隐式转换为了字符串写入数据库。

### 根因三：防御机制的“旁路”漏洞 (idTypes.ts)

系统其实已经意识到了ID混淆的风险，并在 `server/utils/idTypes.ts` 中提供了防御函数 `guardCampaignIdInsert` 和 `guardCampaignIdParam`。

**但为什么防御机制失效了？**
1. **未被调用**：`sqsConsumerService.ts` 和 `performance.ts` 的AMS写入路径**完全没有调用**这些守卫函数，形成了一个“旁路”漏洞。
2. **仅记录不拦截**：旧版的 `guardCampaignIdInsert` 即使检测到了本地ID，也仅仅是打印一条错误日志，**并没有抛出异常阻断写入**。在海量的日志中，这些警告被淹没了。

## 3. 修复方案与架构级防御

为了从根本上解决这个问题，我们在 **v439** 版本中实施了彻底的修复和架构级防御。

### 3.1 修复数据流链路 (Data Flow Fix)

1. **修正 sqsConsumerService.ts**：
   - 彻底移除了 `localCampaignId` 变量。
   - 流量消息和转化消息处理中，直接使用AMS传来的原始 `data.campaign_id`。
   - 修正了 `upsertKeywordPlacementHourlyData` 的参数类型。

2. **收紧 TypeScript 类型约束**：
   - `performance.ts` 中的所有AMS写入函数，`campaignId` 参数类型严格限制为 `string | null`，从编译期杜绝 `number`（本地ID）的传入。

### 3.2 建立“铁壁”防御机制 (Iron-Wall Defense)

我们对 `idTypes.ts` 中的 `guardCampaignIdInsert` 进行了重大升级——**从“观察者”模式升级为“拦截者”模式**：

```typescript
export function guardCampaignIdInsert(
  value: string | number,
  tableName: string
): string {
  const classification = classifyCampaignId(value);
  
  if (classification === 'local') {
    const msg = `⛔ v439拦截: 尝试将本地campaignId(${value})写入${tableName}.campaignId! 该字段应存储Amazon Campaign ID`;
    log.error(`[IdTypes] ${msg}`);
    // v439: 升级为拦截模式 - 拒绝写入本地ID，防止脏数据产生
    throw new Error(`[IdTypes] 拦截本地ID写入: ${tableName}.campaignId = ${value}`);
  }
  return String(value).trim();
}
```

并且，在 `performance.ts` 的所有底层写入入口，**强制添加**了此守卫调用。现在，任何尝试将长度小于8或纯数字小于100,000的值写入 `campaignId` 的行为，都会直接触发系统异常，事务回滚，**物理上断绝了脏数据产生的可能**。

## 4. 历史脏数据清理与审计

在修复代码并成功部署到生产环境（v439）后，我们对数据库进行了全面清理：

1. **daily_performance 表**：
   - 发现并删除了 **104** 条带有本地ID的脏数据（数据源均为AMS）。
2. **keyword_placement_hourly_performance 表**：
   - 发现并删除了 **2,665** 条带有本地ID的脏数据（时间跨度：2026-03-12 至 2026-03-17）。
3. **product_targets 表审计**：
   - 审计过程中发现 `product_targets` 存在32条 `accountId` 为 NULL 的历史遗留数据。
   - 已通过关联 `ad_groups` 表成功将这32条记录的 `accountId` 回填修复。

## 5. 总结与未来建议

这个“理论上不应该存在”的错误，实际上是**“变量命名相似性 + 类型系统宽松 + 防御机制未全覆盖”**三个因素叠加导致的经典工程问题。

**未来预防建议：**
1. **命名规范的物理隔离**：在系统架构设计时，建议在所有Drizzle Schema中，将本地自增ID统一命名为 `internalId` 或 `id`，将Amazon的ID统一命名为 `amazonCampaignId` 而非 `campaignId`，从视觉和语义上进行物理隔离。
2. **全面启用拦截模式**：建议将系统中所有的 `guardXxxId` 函数全部从日志记录升级为异常抛出（Fail-Fast），宁可同步失败重试，也绝不让脏数据污染数据库。
3. **定期数据健康巡检**：建议在系统中增加一个定时任务（如每日凌晨），运行SQL脚本检查核心表（campaigns, ad_groups, keywords, performance）中ID字段的长度和格式规范，一旦发现异常立即告警。
