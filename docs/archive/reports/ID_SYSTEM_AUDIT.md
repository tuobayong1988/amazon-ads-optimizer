# Amazon Ads Optimizer — ID System Complete Audit & Standard (v206)

## 1. Amazon Ads API ID Standard

Amazon Ads API v3 uses **string-type numeric IDs** for all entity identifiers.
These IDs are typically 10-15 digit numbers represented as strings (e.g., `"283746591038"`).

| Amazon Entity     | Amazon API Field     | Format              | Example                |
|-------------------|----------------------|---------------------|------------------------|
| Campaign          | `campaignId`         | string (numeric)    | `"283746591038"`       |
| Ad Group          | `adGroupId`          | string (numeric)    | `"194827365019"`       |
| Keyword           | `keywordId`          | string (numeric)    | `"382910475628"`       |
| Product Target    | `targetId`           | string (numeric)    | `"472839105647"`       |
| Negative Keyword  | `keywordId`          | string (numeric)    | `"592817364052"`       |
| Profile           | `profileId`          | string (numeric)    | `"1029384756"`         |

**Critical Rule:** These IDs MUST always be treated as **strings**, never as JavaScript `number`,
because they exceed `Number.MAX_SAFE_INTEGER` (2^53 - 1 = 9007199254740991) and will lose precision.

---

## 2. Database Schema ID Mapping

### 2.1 Core Entity Tables

| Table (SQL)         | Local PK     | Amazon ID Field          | Amazon ID Type   | Parent Reference                          |
|---------------------|--------------|--------------------------|------------------|-------------------------------------------|
| `campaigns`         | `id` (int)   | `campaignId` (varchar64) | Amazon campaignId| `accountId` (int) → accounts.id           |
| `ad_groups`         | `id` (int)   | `adGroupId` (varchar64)  | Amazon adGroupId | `campaignId` (varchar64) → **campaigns.campaignId** |
| `keywords`          | `id` (int)   | `keywordId` (varchar64)  | Amazon keywordId | `adGroupId` (int) → **adGroups.id**       |
| `product_targets`   | `id` (int)   | `targetId` (varchar64)   | Amazon targetId  | `adGroupId` (int) → **adGroups.id**       |
| `negative_keywords` | `id` (int)   | `amazonNegativeKeywordId`| Amazon keywordId | `campaignId` (varchar64), `adGroupId` (int)|

### 2.2 Cross-Reference Rules (THE LAW)

```
campaigns.id              = LOCAL int PK (for local DB operations ONLY)
campaigns.campaignId      = AMAZON varchar (for Amazon API calls AND cross-table joins)

adGroups.id               = LOCAL int PK
adGroups.adGroupId        = AMAZON varchar
adGroups.campaignId       = AMAZON varchar → MUST join with campaigns.campaignId

keywords.id               = LOCAL int PK
keywords.keywordId        = AMAZON varchar (for Amazon API calls)
keywords.adGroupId        = LOCAL int → joins with adGroups.id

productTargets.id         = LOCAL int PK
productTargets.targetId   = AMAZON varchar (for Amazon API calls)
productTargets.adGroupId  = LOCAL int → joins with adGroups.id
```

### 2.3 Reporting/Log Tables — campaignId Storage Convention

| Table (SQL)                          | `campaignId` Type | Stores What?         |
|--------------------------------------|-------------------|----------------------|
| `daily_performance`                  | varchar(64)       | Amazon campaignId    |
| `search_terms`                       | varchar(64)       | Amazon campaignId    |
| `bidding_logs`                       | varchar(64)       | **MUST be Amazon campaignId** |
| `negative_keywords`                  | varchar(64)       | **Mixed (bug): some local, some Amazon** |
| `optimization_events`                | int               | Local campaign.id    |
| `marginal_benefit_applications`      | varchar(64)       | Amazon campaignId    |
| `placement_performance`              | varchar(64)       | Amazon campaignId    |
| `sb_campaign_settings`               | varchar(50)       | Amazon campaignId    |
| `sd_campaign_settings`               | varchar(50)       | Amazon campaignId    |

---

## 3. Identified Bugs (Root Cause: ID Confusion)

### Bug Category A: Wrong JOIN condition (varchar Amazon ID compared with int local ID)

| File                            | Line(s)       | Bug                                                      | Status   |
|---------------------------------|---------------|----------------------------------------------------------|----------|
| `amazonIdResolver.ts`           | 78,85,128,244,400,538,670 | `ag.campaignId = c.id` should be `c.campaignId` | **FIXED** |
| `optimizationAutoCorrector.ts`  | 560,1352,2086,2157,2227,3108 | Same JOIN bug                                  | **FIXED** |
| `amazonSyncService.ts`          | 1792,1923     | `eq(campaigns.id, adGroup.campaignId)`                   | **FIXED** |
| `amazonSyncService.ts`          | 3364,3421     | `eq(campaigns.id, ag.campaignId)` in applyBidAdjustment  | **FIXED** |

### Bug Category B: Passing local int ID where Amazon varchar ID is expected

| File                            | Line(s)       | Bug                                                      | Status   |
|---------------------------------|---------------|----------------------------------------------------------|----------|
| `optimizationTargetEngine.ts`   | 1021          | `getKeywordsByCampaignId(campaign.id)` — local int       | **TODO** |
| `optimizationTargetEngine.ts`   | 1096          | `getAdGroupsByCampaignId(campaign.id)` — local int       | **TODO** |
| `optimizationTargetEngine.ts`   | 1042,1056     | `id: keyword.id` / `campaignId: campaign.id` in targets  | **TODO** |
| `optimizationTargetEngine.ts`   | 1078,1080     | `keywordId: nextGenResult.targetId` — local int to API   | **TODO** |
| `optimizationTargetEngine.ts`   | 1219,1229     | DB update uses `detail.keywordId` — needs local int      | **TODO** |
| `optimizationTargetEngine.ts`   | many more     | `campaign.id` passed to various query functions           | **TODO** |
| `amazonApiHelper.ts`            | 127           | `keywordId: number` should accept string                  | **TODO** |

### Bug Category C: Inconsistent storage in negative_keywords.campaignId

Some code stores `campaign.id` (local int as string), some stores Amazon campaignId.
Data migration needed but deferred to avoid breaking existing records.

---

## 4. The Unified ID System Design

### 4.1 ID Type Definitions (`server/utils/idTypes.ts`)

TypeScript branded types to make ID confusion a **compile-time error**:

```typescript
type LocalCampaignId = number & { __brand: 'LocalCampaignId' };
type AmazonCampaignId = string & { __brand: 'AmazonCampaignId' };
// ... etc for all entities
```

### 4.2 ID Resolution Service (`server/utils/idResolver.ts`)

Central bidirectional resolver with caching:

```typescript
// Amazon ID → Local ID
resolveLocalCampaignId(amazonCampaignId: string, accountId: number): Promise<number>

// Local ID → Amazon ID  
resolveAmazonCampaignId(localCampaignId: number): Promise<string>

// Campaign object → guaranteed Amazon campaignId
getCampaignAmazonId(campaign: Campaign): string  // returns campaign.campaignId

// Keyword object → guaranteed Amazon keywordId (with validation)
getKeywordAmazonId(keyword: Keyword): string | null  // returns keyword.keywordId
```

### 4.3 Safe Query Functions (`server/db.ts` updates)

All query functions that accept campaignId MUST:
1. Accept `string | number` for backward compatibility
2. Internally resolve to the correct type
3. Log a deprecation warning if wrong type is passed

---

## 5. Function-by-Function Fix Plan

### `getKeywordsByCampaignId(campaignId)` — Already handles String() conversion ✅
### `getAdGroupsByCampaignId(campaignId)` — Already handles String() conversion ✅
### `getDailyPerformanceByDateRange(accountId, start, end, campaignId)` — Already handles String() ✅
### `getSearchTermsByCampaignId(campaignId)` — Already handles String() ✅

**The real fix is at the CALLER side:**
- Pass `campaign.campaignId` (Amazon varchar) instead of `campaign.id` (local int)
- This ensures String() conversion produces the correct Amazon ID string
