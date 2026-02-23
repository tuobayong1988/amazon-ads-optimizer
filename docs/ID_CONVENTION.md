# Amazon Ads Optimizer — ID 字段规范

> **版本：** v209  
> **最后更新：** 2026-02-23  
> **状态：** 强制执行

## 核心原则

**所有数据库表的 `campaignId` 字段存储的是 Amazon Campaign ID（varchar），不是本地自增ID（int）。**

## ID 字典

| 表名 | 字段 | 类型 | 存储内容 | 示例值 |
|------|------|------|---------|--------|
| campaigns | id | int | 本地自增PK | 42 |
| campaigns | campaignId | varchar(64) | Amazon Campaign ID | "283746591038" |
| adGroups | id | int | 本地自增PK | 156 |
| adGroups | campaignId | varchar(64) | Amazon Campaign ID | "283746591038" |
| adGroups | adGroupId | varchar(64) | Amazon AdGroup ID | "192837465012" |
| keywords | id | int | 本地自增PK | 1024 |
| keywords | keywordId | varchar(64) | Amazon Keyword ID | "374859201638" |
| keywords | adGroupId | int | 本地AdGroup PK | 156 |
| dailyPerformance | campaignId | varchar(64) | Amazon Campaign ID | "283746591038" |
| searchTerms | campaignId | varchar(64) | Amazon Campaign ID | "283746591038" |
| biddingLogs | campaignId | varchar(64) | Amazon Campaign ID | "283746591038" |
| negativeKeywords | campaignId | varchar(64) | Amazon Campaign ID | "283746591038" |
| placementPerformance | campaignId | varchar(64) | Amazon Campaign ID | "283746591038" |

## JOIN 规则

### ✅ 正确

```typescript
// adGroups → campaigns: Amazon ID 对 Amazon ID
.innerJoin(campaigns, eq(adGroups.campaignId, campaigns.campaignId))

// keywords → adGroups: 本地ID 对 本地ID
.innerJoin(adGroups, eq(keywords.adGroupId, adGroups.id))
```

### ❌ 错误

```typescript
// NEVER: Amazon ID vs 本地 int
.innerJoin(campaigns, eq(adGroups.campaignId, campaigns.id))

// NEVER: CAST hack
.innerJoin(campaigns, sql`${adGroups.campaignId} = CAST(${campaigns.id} AS CHAR)`)
```

## 查询函数参数规则

| 函数 | campaignId 参数类型 | 应传入 |
|------|-------------------|--------|
| getKeywordsByCampaignId | string | campaign.campaignId |
| getAdGroupsByCampaignId | string | campaign.campaignId |
| getDailyPerformanceByDateRange | string | campaign.campaignId |
| getSearchTermsByCampaignId | string | campaign.campaignId |
| getCampaignById | number | campaign.id (本地PK) |
| getCampaignByAmazonCampaignId | string | campaign.campaignId |
| updateCampaign | number | campaign.id (本地PK) |

## Campaign 循环标准模式

```typescript
for (const campaign of campaigns) {
  // ✅ 标准：在循环开头提取双ID
  const { amazonId: campaignAmazonId, localId: campaignLocalId } = extractCampaignIds(campaign);
  
  // 查询函数 → 用 Amazon ID
  const keywords = await getKeywordsByCampaignId(accountId, campaignAmazonId);
  const adGroups = await getAdGroupsByCampaignId(accountId, campaignAmazonId);
  
  // DB 更新 → 用本地 ID
  await updateCampaign(campaignLocalId, { ... });
  
  // INSERT 其他表的 campaignId → 用 Amazon ID
  await insert(biddingLogs).values({ campaignId: campaignAmazonId, ... });
}
```

## 从 adGroup 反查 Campaign

```typescript
// ✅ 正确：adGroup.campaignId 是 Amazon ID
const campaign = await getCampaignByAmazonCampaignId(adGroup.campaignId);

// ❌ 错误：getCampaignById 期望本地 int
const campaign = await getCampaignById(adGroup.campaignId);
```

## 防护机制

### 1. 运行时守卫（自动）

`db.ts` 中的关键查询函数内置 `guardCampaignIdParam()` 守卫。如果检测到传入的是小整数（可能是本地ID），会打印 `[ID-GUARD]` 警告日志。

### 2. 静态分析（CI/CD）

```bash
# 本地检查
node scripts/check-id-safety.js

# CI/CD 严格模式（有错误则退出码非0）
node scripts/check-id-safety.js --strict
```

8条检查规则：
- ID-001: JOIN条件中campaigns.id与campaignId比较
- ID-002: 查询函数传入campaign.id
- ID-003: INSERT中campaignId使用本地ID
- ID-004: 回退逻辑 campaign.campaignId || campaign.id
- ID-005: eq条件中campaign.id与varchar字段比较
- ID-006: 原生SQL中campaign_id使用本地ID
- ID-007: CAST(campaigns.id AS CHAR) JOIN条件
- ID-008: getCampaignById传入Amazon ID

### 3. Pre-commit Hook（本地）

```bash
# 安装
bash scripts/install-hooks.sh
```

每次 `git commit` 前自动运行静态分析。

### 4. 数据迁移（启动时）

应用启动时自动运行 `migrateCampaignIds()`，扫描并修复历史数据中的本地int campaignId。

## 新表设计清单

创建新表时，如果包含 `campaignId` 字段：

- [ ] 字段类型必须是 `varchar(64)`
- [ ] INSERT 处必须使用 `campaign.campaignId`（Amazon ID）
- [ ] INSERT 处添加 `guardCampaignIdInsert()` 守卫
- [ ] 在 `check-id-safety.js` 的 ID-005 规则中添加新表名
- [ ] 在 `ID_SYSTEM_AUDIT.md` 中更新表清单
