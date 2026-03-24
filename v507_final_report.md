# Amazon Ads Optimizer 修复报告 (v507 & v507.1)

## 1. 核心问题一：SB关键词出价同步失败 (KEYWORD_CANNOT_FIND_AD_GROUP)

### 现象与根因
在 v506 修复了 `adGroupId` 缺失的问题后，日志显示大量 SB (Sponsored Brands) 关键词出价同步仍然失败，Amazon API 返回 `KEYWORD_CANNOT_FIND_AD_GROUP` 错误。
这说明虽然代码成功获取了 `adGroupId`，但这些广告组在 Amazon 端实际上**已被删除或归档**。由于旧代码没有正确处理这个特定的错误码，导致纠错器不断重试这些已经不存在的关键词，产生大量同步失败记录。

### 修复方案 (v507.1)
修改了 `amazonApiHelper.ts` 中的错误处理逻辑：
- 扩展了 `entityNotFound` 的检测范围，加入了对 `keyword_cannot_find_ad_group` 和 `invalid_argument` 的识别。
- 当 Amazon 返回这些错误时，系统会自动将本地数据库中对应的关键词状态更新为 `amazon_archived`。
- 这样可以彻底切断纠错器的无限重试循环，防止无效的 API 调用。

---

## 2. 核心问题二：否定词回填失败 (campaignId=null)

### 现象与根因
日志中发现大量否定词在尝试回填 Amazon ID 时失败，原因是 `localCampaignId=null`。
深入分析发现：
1. `negative_keywords` 表中的 `campaignId` 字段在某些历史数据中为空（NULL）。
2. 回填 SQL 查询没有过滤掉这些 NULL 记录。
3. 在代码中，`campaignIdToAmazonIdMap.get(String(null))` 导致匹配失败。

### 修复方案 (v507.1)
修改了 `optimizationAutoCorrector.ts` 中的 `backfillNegativeKeywordIds` 函数：
1. **过滤无效数据**：在主查询中增加了 `AND campaignId IS NOT NULL AND campaignId != ''`，防止 NULL 数据进入回填流程。
2. **自动修复数据**：增加了一个新的数据修复逻辑。对于 `campaignId` 为 NULL 但有 `internal_ad_group_id` 的否定词，系统会自动通过 `ad_groups` 表关联查询出正确的 Amazon Campaign ID，并更新到 `negative_keywords` 表中。

---

## 3. 部署状态
- **版本号**: v507.1 (app-v507-3d70368d)
- **环境状态**: Green / Ok
- **运行情况**: 部署已完成，系统防线和纠错器现在能够正确处理已删除的 SB 关键词，并能自动修复缺失 campaignId 的否定词数据。

## 4. 后续建议
1. **数据一致性监控**：建议定期运行脚本检查数据库中各表的外键关联是否完整，特别是 `campaignId` 和 `adGroupId`。
2. **API 错误分类**：Amazon API 的错误码经常变化，建议建立一个统一的错误码映射表，将各种 "实体不存在" 的错误统一归类处理，避免遗漏。
