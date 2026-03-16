# 广告优化系统ID管理策略 (v421)

## 1. 核心原则

为确保系统数据一致性、可维护性和性能，所有模块在处理ID时必须遵循以下核心原则：

1.  **明确区分内部ID和Amazon ID**：任何时候都要清楚当前使用的ID是系统内部生成的自增ID还是从Amazon API获取的外部ID。
2.  **数据库存储一致性**：数据库表结构设计必须明确ID类型，并在字段命名上体现其来源。
3.  **类型安全**：在代码中，尤其是数据库查询和API交互时，必须确保ID的数据类型正确，避免隐式类型转换和不安全的比较。

## 2. ID类型定义

| ID类型 | 命名约定 | 数据库类型 | 描述 |
| :--- | :--- | :--- | :--- |
| **内部ID** | `id` (主键), `internal...Id` (外键) | `INT`, `BIGINT` (Auto-increment) | 系统内部使用的唯一标识符，用于表关联和内部逻辑处理。**严禁**暴露给前端URL或用于与Amazon API交互。 |
| **Amazon ID** | `...Id` (如 `campaignId`, `adGroupId`, `keywordId`) | `VARCHAR`, `BIGINT` (存储为字符串) | 从Amazon Ads API获取的实体ID。用于与Amazon API进行数据同步和操作指令。 |

### 示例

-   `campaigns` 表:
    -   `id`: `INT` (内部主键)
    -   `campaignId`: `VARCHAR` (Amazon Campaign ID)
-   `adGroups` 表:
    -   `id`: `INT` (内部主键)
    -   `adGroupId`: `VARCHAR` (Amazon Ad Group ID)
    -   `internalCampaignId`: `INT` (外键，关联 `campaigns.id`)
-   `keywords` 表:
    -   `id`: `INT` (内部主键)
    -   `keywordId`: `VARCHAR` (Amazon Keyword ID)
    -   `internalAdGroupId`: `INT` (外键，关联 `adGroups.id`)

## 3. 使用规范

### 3.1 数据库层 (Drizzle Schema & Queries)

-   **Schema定义**: 所有ID字段必须明确类型。Amazon ID统一使用 `varchar` 或 `bigint` 存储为字符串，内部ID使用 `int` 或 `bigint`。
-   **外键关联**: 内部表之间的关联**必须**使用内部ID (`internal...Id`)。
-   **查询参数**: 执行数据库查询时，传入的参数类型必须与字段类型严格匹配。严禁在查询中对ID字段进行 `CAST` 或其他类型转换操作，这会导致索引失效和性能问题。
    -   **正确**: `eq(keywords.internalAdGroupId, 42)` (number vs INT)
    -   **错误**: `eq(keywords.internalAdGroupId, "42")` (string vs INT)

### 3.2 后端API层 (tRPC Routers)

-   **内部API**: 后端模块间调用，优先使用内部ID进行实体定位。
-   **前端API**: 
    -   URL参数和请求体中，应优先使用内部ID，避免将Amazon ID暴露在URL中。
    -   从前端接收到内部ID后，后端应使用该ID查询数据库获取完整的实体信息（包括Amazon ID）。
-   **ID传递**: 在函数调用和逻辑处理中，必须确保传递的ID类型正确。例如，需要Amazon Ad Group ID的函数，必须传入 `adGroup.adGroupId` (varchar)，而不是 `adGroup.id` (int)。

### 3.3 数据同步层 (Sync Services)

-   **字段映射**: 从Amazon API获取数据后，必须正确映射到数据库表的对应字段。Amazon ID存入 `...Id` 字段，同时通过查询或预加载的Map找到关联的内部ID，存入 `internal...Id` 字段。
-   **关联查询**: 在同步过程中需要跨表查询时，必须使用内部ID进行JOIN，避免使用Amazon ID进行JOIN，除非两个表都为Amazon ID建立了索引。

### 3.4 Amazon API交互层

-   所有向Amazon API发出的请求（如更新竞价、创建关键词），**必须**使用Amazon ID (`campaignId`, `adGroupId`, `keywordId` 等)。

## 4. 代码审查清单 (Checklist)

在进行代码审查时，必须检查以下几点：

1.  `drizzle/schema.ts` 中ID字段的类型是否符合规范？
2.  数据库查询 (`db.select()...`) 中 `where` 条件的ID类型是否与Schema匹配？
3.  是否存在 `CAST(..)` 或 `String(..)` / `Number(..)` 对ID进行不必要的类型转换？
4.  API路由的输入 (`z.object(...)`) 和输出是否明确了ID的类型？
5.  函数参数中的ID命名是否清晰（例如 `adGroupId` vs `internalAdGroupId`）？
6.  调用与Amazon API交互的函数时，传入的是否是Amazon ID？
7.  内部模块间调用时，是否优先使用内部ID？

## 5. v421端到端测试

为确保此策略得到遵守，已在 `server/__tests__/v421IdConsistency.test.ts` 中添加了33个自动化测试用例，覆盖了从数据库到API的全链路ID一致性验证。所有代码提交前必须通过这些测试。
