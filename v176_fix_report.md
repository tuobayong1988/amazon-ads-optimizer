# Amazon Ads Optimizer v176 修复报告

**版本**: v176
**日期**: 2026-02-21
**部署时间**: 10:57 UTC
**作者**: Manus AI

---

## 1. 概述

v176 是在 v175b 基础上的增量修复版本，主要解决了否定关键词同步中的 **matchType 格式不匹配** 导致幂等性检查失效的问题，并完成了数据库中历史遗留事件的全面清理。

## 2. 修复内容

### 2.1 matchType 格式标准化（核心修复）

**问题描述**：在否定关键词的幂等性去重检查中，Amazon SP API 返回的 matchType 格式为 `NEGATIVE_PHRASE`（转小写后为 `negative_phrase`），而本地代码使用的格式为 `negativePhrase`（转小写后为 `negativephrase`）。两种格式在 `.toLowerCase()` 后仍然不同，导致幂等性检查无法正确匹配已存在的否定关键词。

**影响范围**：所有通过 `syncNegativeKeywordsToAmazon` 函数同步的否定关键词都可能被重复发送到 Amazon API。

**修复方案**：在 `server/services/amazonApiHelper.ts` 中新增 `normalizeMatchTypeForComparison()` 函数，统一将所有 matchType 格式转换为 `negative_phrase` / `negative_exact` 进行比较。

| 输入格式 | 转换结果 |
|----------|----------|
| `NEGATIVE_PHRASE` | `negative_phrase` |
| `negativePhrase` | `negative_phrase` |
| `negative_phrase` | `negative_phrase` |
| `NEGATIVE_EXACT` | `negative_exact` |
| `negativeExact` | `negative_exact` |
| `negative_exact` | `negative_exact` |

### 2.2 永久失败关键词的 negative_keywords 表同步

**问题描述**：当 AutoCorrector 将否定关键词标记为永久失败（`not_applicable`）时，只更新了 `optimization_events` 表，但未同步更新 `negative_keywords` 表的状态。

**修复方案**：在 `server/optimizationAutoCorrector.ts` 的永久失败处理分支中，新增对 `negative_keywords` 表的 `negativeStatus` 更新，将无效关键词标记为 `removed`。

### 2.3 响应解析验证

**确认**：v175b 中对 `createSpCampaignNegativeKeywords` 的响应解析修复（正确解析 `{success: [], error: []}` 嵌套结构）已在 `dist/index.js` 中正确编译。之前的问题是旧进程仍在运行，新代码未生效。v176 部署后已完全替换。

## 3. 数据库清理

### 3.1 否定关键词修复

| 操作 | 关键词 | 结果 |
|------|--------|------|
| 更新 amazon_negative_keyword_id | `pilates kit cheap` | 设置为 `429917354613356`（Amazon 已成功创建） |
| 标记为 removed | `the foot company solemate vs sidekick axisboard` | PATTERN_NOT_MATCHED，Amazon 永久拒绝 |
| 标记为 removed | `latex free pilates accessories kit` | PATTERN_NOT_MATCHED，Amazon 永久拒绝 |

### 3.2 optimization_events 清理

| 清理类型 | 数量 | 说明 |
|----------|------|------|
| 空状态否定关键词事件 | 11 | 重复的 negative_keyword_add 事件 |
| 空 pending bid_auto_adjust | 1 | 无 campaign_id/keyword_id 的空事件 |
| 历史空状态事件 | 2,056 | 2026-02-20 之前的旧事件（keyword_create, bid_decrease, budget_adjustment 等） |

### 3.3 最终数据库状态

| api_sync_status | 数量 | 说明 |
|-----------------|------|------|
| `synced` | 24,343 | 已成功同步到 Amazon |
| `not_applicable` | 8,430 | 不需要同步（历史遗留/永久失败/清理） |
| `pending` | 0 | 无待处理事件 |
| `failed` | 0 | 无失败事件 |
| 空/NULL | 0 | 已全部清理 |

## 4. 部署验证

v176 部署后首次 AutoCorrector 扫描结果：

> **发现 42 个问题，纠正 42 个，失败 0 个**

对比 v175b 的扫描结果（发现 46 个问题，纠正 43 个，失败 3 个），v176 消除了所有失败项：
- 3 个否定关键词重试失败已被清理，不再出现在扫描中
- 所有出价纠正（含 max_bid 限制）正常工作
- 所有预算纠正正常工作（整数值，无 $NaN）

## 5. 版本历史总结（v167 → v176）

| 版本 | 主要修复 |
|------|----------|
| v167 | AutoCorrector 基础框架，SQL 列名修复（dailyBudget/campaignId） |
| v168 | 否定关键词重试机制，max_bid 强制执行 |
| v169 | $NaN 预算修复，预算容忍阈值（$2） |
| v170 | matchType 格式修复（negativePhrase → NEGATIVE_PHRASE） |
| v172 | 孤儿关键词清理（4,594 条），max_bid 出价纠正 |
| v174 | 否定关键词 API 415 错误修复，重试计数器 |
| v175 | state: ENABLED 字段恢复，否定关键词创建成功 |
| v175b | 响应解析修复（部分成功场景），永久失败标记 |
| **v176** | **matchType 格式标准化，negative_keywords 表同步，数据库全面清理** |

## 6. 当前系统状态

- **AutoCorrector**: 每 1 小时运行一次，所有纠正项成功同步
- **出价同步**: 正常（含 max_bid 限制）
- **预算同步**: 正常（整数值，$2 容忍阈值）
- **否定关键词**: 1 个成功创建（pilates kit cheap），2 个永久失败已标记
- **数据库**: 所有事件都有明确的 api_sync_status，无空状态/NULL 记录
- **ElaraFit US/CA**: 优化目标正常运行

## 7. 后续建议

1. **搜索词收割重试机制**：对于 `keyword_create` 类型的历史失败事件（1,658 条），可考虑实现类似否定关键词的重试逻辑
2. **监控仪表盘**：建议添加 AutoCorrector 运行状态的可视化监控
3. **GitHub 推送**：当前代码已本地提交但未推送到 GitHub（需要认证配置），建议手动推送
