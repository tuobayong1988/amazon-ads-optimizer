# 广告优化系统 ID 体系标准规范 (v1.0)

## 1. 核心设计原则

为了确保广告系统的数据同步、数据存储、数据分析、自动优化及 API 指令输出的绝对一致性，系统采用**双轨 ID 映射但单轨对外**的设计原则：

- **内部 ID (Local ID)**：系统数据库生成的自增 INT 主键（如 `campaigns.id`），**仅限**在系统内部表与表之间的外键关联时使用。
- **Amazon 原始 ID (Amazon ID)**：亚马逊 API 返回的 15-20 位纯数字字符串（如 `campaigns.campaignId`），**必须**在所有与亚马逊相关的业务逻辑、性能数据查询、优化分析和 API 交互中使用。

## 2. 字段类型与存储标准

| 实体 | 字段名 | 数据库类型 | TypeScript 类型 | 描述与限制 |
|------|--------|------------|-----------------|------------|
| 广告活动 | `campaignId` | `VARCHAR(64)` | `string` | **绝对禁止使用 INT 存储**。Amazon ID 长度超过 INT 最大值，会导致溢出。 |
| 广告组 | `adGroupId` | `VARCHAR(64)` | `string` | 同上。 |
| 关键词/定位 | `keywordId` / `targetId` | `VARCHAR(64)` | `string` | 同上。 |
| 本地主键 | `id` | `INT AUTO_INCREMENT` | `number` | 仅作为内部表主键。 |
| 本地外键 | `internalCampaignId` | `INT` | `number` | 用于明确指代本地关联的字段，需加 `internal` 前缀以示区分。 |

## 3. 各模块 ID 使用规范

### 3.1 数据同步模块 (Sync Engine)
- **拉取数据**：解析 API 响应时，必须将 Amazon ID 视为 `string` 处理。
- **写入基础表**：写入 `campaigns`, `ad_groups`, `keywords` 等表时，`campaignId` 必须写入原始字符串。
- **写入绩效表**：写入 `daily_performance`, `hourly_performance`, `placement_performance` 时，**必须使用 Amazon ID (string)**，禁止使用本地 ID。

### 3.2 数据分析与查询模块 (Data Analysis)
- **绩效查询**：查询任何 performance 表时，必须使用 Amazon ID。
  ```typescript
  // ❌ 错误：使用本地 ID 查询
  where(eq(hourlyPerformance.campaignId, String(campaign.id)))
  
  // ✅ 正确：使用 Amazon ID 查询
  where(eq(hourlyPerformance.campaignId, String(campaign.campaignId)))
  ```
- **ID 转换**：如果调用方只有本地 ID，必须先通过 `campaigns` 表查询出对应的 Amazon ID，然后再查询绩效数据。

### 3.3 自动优化模块 (Optimization Engine)
- **优化分析**：在进行分时竞价、位置倾斜、边际效益分析时，输入的数据源必须基于 Amazon ID 聚合的完整数据。
- **事件记录**：写入 `optimization_events`, `optimization_logs`, `bidding_logs`, `dayparting_strategies` 时，`campaignId` 必须写入 Amazon ID 字符串，**禁止使用 `Number(campaignId)` 强制转换**。

### 3.4 API 指令输出模块 (API Execution)
- **发送指令**：向 Amazon API 发送竞价调整、预算修改等指令时，必须使用 Amazon ID。虽然 Amazon API 接受数字类型，但为了避免 JavaScript 的大数精度问题，建议在组装 Payload 的最后一刻才转换为 Number（如果 API 严格要求），或者保持 String（如果 API 兼容）。

## 4. 防护机制与最佳实践

1. **类型断言防护**：禁止在业务代码中随意使用 `Number(campaignId)` 或 `String(campaignId)` 进行转换。应使用统一的 `amazonIdResolver.ts` 服务进行转换。
2. **统一转换函数**：
   ```typescript
   // 获取 Amazon ID 的标准方法
   async function resolveAmazonCampaignId(localCampaignId: number): Promise<string> { ... }
   ```
3. **代码审查清单**：
   - 检查是否有新的表使用了 `INT` 存储 `campaignId`。
   - 检查是否有新的查询使用了 `campaign.id` 去匹配 `performance.campaignId`。
   - 检查是否有事件日志写入时发生了 `Number()` 转换导致溢出。

## 5. 历史数据清理原则
- 所有绩效表（daily/hourly/placement）中混入的本地 ID，必须通过 `campaigns` 表的映射关系，统一 UPDATE 为 Amazon 原始 ID。
- 所有事件表（events/logs）中溢出为 `2147483647` 的脏数据，如果无法恢复原始 ID，应标记为失效或进行软删除，避免影响后续的复盘分析。
