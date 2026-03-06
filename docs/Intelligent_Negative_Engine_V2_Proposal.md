# 智能否定引擎V2：技术方案与架构升级提案

**版本：** 2.0
**作者：** Manus AI
**日期：** 2026年03月06日

---

## 1. 背景与目标

在初步的智能否定引擎开发过程中，我们收到了至关重要的反馈：当前“一刀切”的否定逻辑未能充分考虑亚马逊广告平台不同广告类型（Sponsored Products, Sponsored Brands, Sponsored Display）在否定功能上的显著差异。例如，某些广告活动仅支持广告组层级的否定，而另一些则完全不支持否定关键词。这种忽略平台原生限制的设计，将导致系统在生产环境中执行API调用时产生大量错误，并使否定策略的有效性大打折扣。

为了构建一个**精确、健壮且符合亚马逊广告API规范**的智能否定引擎，我们暂停了原有的开发工作，并进行了深入的研究与重新设计。本提案旨在详细阐述V2版本的全新系统架构、技术实现方案以及预期的收益，并恳请您的审阅与批准。

## 2. 核心问题分析与研究发现

经过对亚马逊广告官方文档的梳理和对现有代码库的审查，我们确认了当前方案存在的核心问题，并总结了各广告类型的否定功能矩阵。

### 2.1. 现有系统逻辑缺陷

1.  **错误的否定类型映射**：在处理表现差的ASIN搜索词时，系统错误地将其判定为`CREATE_NEGATIVE_KEYWORD`（创建否定关键词），而正确的操作应为`CREATE_NEGATIVE_PRODUCT_TARGET`（创建否定产品投放）。
2.  **缺少广告类型区分**：系统没有根据广告活动类型（SP, SB, SD）来选择合适的否定策略，导致向不支持的层级或类型提交否定请求。
3.  **API能力缺失**：现有`amazonAdsApi.ts`文件中，完全缺失创建SB（Sponsored Brands）和SD（Sponsored Display）否定项的API函数实现。
4.  **数据模型不完善**：虽然`negative_keywords`表已包含`negativeType`字段，但缺乏明确的`negativeScope`（否定范围：广告活动/广告组）字段，并且现有逻辑未能有效利用这些字段。

### 2.2. 亚马逊广告否定功能支持矩阵

为了直观地展示各广告类型的差异，我们整理了以下支持矩阵：

| 广告类型 | 子类型/定向方式 | 否定关键词 | 否定产品 (ASIN) | 支持层级 | API 端点 (部分) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **SP** | Auto (自动) | ✅ | ✅ | Campaign & Ad Group | `/sp/negativeKeywords`, `/sp/campaignNegativeKeywords`, `/sp/negativeTargets`, `/sp/campaignNegativeTargets` |
| **SP** | Manual (手动) | ✅ | ✅ | Campaign & Ad Group | 同上 |
| **SB** | 所有 | ✅ | ✅ | **仅 Ad Group** | `/sb/negativeKeywords`, `/sb/negativeTargets` |
| **SD** | Contextual (上下文) | ❌ | ✅ | **仅 Ad Group** | `/sd/negativeTargets` |
| **SD** | Audience (受众) | ❌ | ❌ | N/A | N/A |

此矩阵清晰地揭示了不同广告产品在否定功能上的限制，这是新架构设计的核心依据。

## 3. V2版系统架构设计

基于以上研究，我们设计了全新的智能否定决策流程，该流程以广告活动类型作为核心的分支判断依据，确保每一个决策都符合API的限制。

### 3.1. 架构流程图

我们绘制了新的系统架构图，以可视化地呈现决策逻辑：

![智能否定引擎V2架构图](negation_architecture.png)

### 3.2. 决策流程说明

1.  **效果分析**：流程的起点依然是对搜索词报告的分析。当一个搜索词被判定为“高花费、零订单”的低效流量时，启动否定决策流程。
2.  **广告类型分发**：系统首先检查该搜索词来源的广告活动类型（`campaignType`）。这是新架构的核心分发器，它会将决策任务分派给专门处理该类型的子模块（SP, SB, 或 SD）。
3.  **搜索词类型判断**：在各自的子模块中，系统会判断搜索词是普通关键词（Keyword）还是一个ASIN。
4.  **执行精确否定**：最后，系统根据广告类型、搜索词类型和支持的层级，调用正确的API接口执行精确的否定操作。例如：
    *   对于来自**SP-Auto**的无效**ASIN**，系统将在**广告组层级**创建一个**否定产品投放**。
    *   对于来自**SB**广告的无效**关键词**，系统将在**广告组层级**创建一个**否定关键词**（因为SB不支持广告活动层级否定）。
    *   对于来自**SD**广告的无效**关键词**，系统将**跳过**操作，因为SD不支持否定关键词。

## 4. 技术实现方案

为实现上述架构，我们需要对数据库、后端决策逻辑和API层进行一系列升级。

### 4.1. 数据库Schema修改 (`drizzle/schema.ts`)

我们将对`negative_keywords`表进行扩展，以更精确地记录否定操作的上下文：

```typescript
// file: drizzle/schema.ts

export const negativeKeywords = mysqlTable("negative_keywords", {
  id: int().autoincrement().notNull(),
  accountId: int().notNull(),
  campaignId: varchar({ length: 64 }).notNull(),
  adGroupId: int(),
  
  // --- 新增与修改 ---
  campaignType: mysqlEnum(["sp", "sb", "sd"]).notNull(), // 新增: 记录来源广告活动类型
  negativeScope: mysqlEnum(["campaign", "ad_group"]).notNull(), // 新增: 明确否定层级
  negativeType: mysqlEnum(["keyword", "product"]).notNull(), // 保持不变: 区分否定关键词还是产品
  // ------------------

  negativeText: varchar({ length: 500 }).notNull(),
  negativeMatchType: mysqlEnum(["negative_exact", "negative_phrase"]).notNull(),
  amazonNegativeKeywordId: varchar('amazon_negative_keyword_id', { length: 64 }),
  negativeSource: mysqlEnum([/*...*/]).default('auto_optimization'),
  // ... 其他字段保持不变
});
```

### 4.2. 核心决策逻辑重构 (`server/services/targetingAlgorithm.ts`)

1.  **扩展`TargetingDecision`接口**：
    *   新增一个`action`类型：`CREATE_NEGATIVE_PRODUCT_TARGET`。
    *   新增`negativeScope`字段，用于指定`campaign`或`ad_group`。

2.  **重构`decideTargeting`函数**：
    *   该函数将作为总调度器，根据传入的`campaignType`调用不同的处理函数，如`decideSpTargeting`, `decideSbTargeting`, `decideSdTargeting`。

3.  **修正`decideAsinTargeting`逻辑**：
    *   当判断一个ASIN需要被否定时，返回的`action`将是`CREATE_NEGATIVE_PRODUCT_TARGET`，`negativeType`为`product`。

### 4.3. API客户端能力补全 (`server/amazonAdsApi.ts`)

我们将实现当前缺失的API端点，以支持完整的否定操作：

*   `createSbNegativeKeywords(negatives: Array<...>)`
*   `createSbNegativeTargets(negatives: Array<...>)`
*   `createSdNegativeTargets(negatives: Array<...>)`
*   `listSdNegativeTargets(adGroupId?: number)`

### 4.4. 上层执行引擎改造

负责执行决策的上层服务（如`optimizationTargetEngine.ts`）将被改造，以处理新的`CREATE_NEGATIVE_PRODUCT_TARGET`动作，并根据决策结果中的`campaignType`和`negativeScope`调用正确的`amazonAdsApi.ts`函数。

## 5. 实施计划与风险

我们建议分阶段实施此项重构，以确保平稳过渡：

1.  **第一阶段：数据库与API层**：完成数据库表结构迁移和`amazonAdsApi.ts`中缺失API的实现与单元测试。
2.  **第二阶段：核心算法重构**：重构`targetingAlgorithm.ts`中的决策逻辑，并编写充分的单元测试用例覆盖所有广告类型和场景。
3.  **第三阶段：端到端集成与测试**：改造上层执行引擎，进行完整的端到端集成测试，确保从搜索词分析到API调用的整个流程准确无误。

**潜在风险**：亚马逊广告API可能会在未来更新其功能。新架构通过将不同广告类型的逻辑解耦，能够更好地适应未来的变化，降低了维护成本和风险。

## 6. 结论与审批请求

智能否定引擎V2方案通过引入基于广告类型的决策分发机制，从根本上解决了V1设计中的核心缺陷。新架构不仅保证了操作的**准确性**和**稳定性**，还为未来扩展更精细化的否定策略（如基于SB视频广告、SD受众定向的特殊逻辑）奠定了坚实的基础。

我们坚信，这次架构升级是保障项目长期成功的关键一步。我们恳请您批准此V2技术方案，以便我们立即启动开发工作。
