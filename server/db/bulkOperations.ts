/**
 * v361: 批量操作
 * 从db.ts拆分的子模块
 */

import { not, sql } from 'drizzle-orm';
import { InsertAdGroup, InsertCampaign, InsertDailyPerformance, InsertKeyword, InsertProductTarget, adGroups, campaigns, dailyPerformance, keywords, productTargets } from '../../drizzle/schema';
import { getDb } from './connection';

// ==================== Bulk Operations ====================
/**
 * v361: UPSERT模式 - 基于accountId+campaignId自然唯一键，避免重复插入
 */
export async function bulkCreateCampaigns(campaignsData: InsertCampaign[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  if (campaignsData.length === 0) return;
  // v361: 改为UPSERT，基于accountId+campaignId去重，更新关键字段
  await db.insert(campaigns).values(campaignsData).onDuplicateKeyUpdate({
    set: {
      campaignName: sql`VALUES(campaign_name)`,
      campaignStatus: sql`VALUES(campaign_status)`,
      dailyBudget: sql`VALUES(daily_budget)`,
      updatedAt: sql`NOW()`,
    },
  });
}

/**
 * v361: UPSERT模式 - 基于adGroupId自然唯一键
 */

/**
 * v361: UPSERT模式 - 基于adGroupId自然唯一键
 */
export async function bulkCreateAdGroups(adGroupsData: InsertAdGroup[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  if (adGroupsData.length === 0) return;
  await db.insert(adGroups).values(adGroupsData).onDuplicateKeyUpdate({
    set: {
      adGroupName: sql`VALUES(ad_group_name)`,
      adGroupStatus: sql`VALUES(ad_group_status)`,
      defaultBid: sql`VALUES(default_bid)`,
      updatedAt: sql`NOW()`,
    },
  });
}

/**
 * v361: UPSERT模式 - 基于keywordId自然唯一键
 */

/**
 * v361: UPSERT模式 - 基于keywordId自然唯一键
 */
export async function bulkCreateKeywords(keywordsData: InsertKeyword[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  if (keywordsData.length === 0) return;
  await db.insert(keywords).values(keywordsData).onDuplicateKeyUpdate({
    set: {
      keywordText: sql`VALUES(keyword_text)`,
      matchType: sql`VALUES(match_type)`,
      bid: sql`VALUES(bid)`,
      keywordStatus: sql`VALUES(keyword_status)`,
      updatedAt: sql`NOW()`,
    },
  });
}

/**
 * v361: UPSERT模式 - 基于targetId自然唯一键
 */

/**
 * v361: UPSERT模式 - 基于targetId自然唯一键
 */
export async function bulkCreateProductTargets(targetsData: InsertProductTarget[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  if (targetsData.length === 0) return;
  await db.insert(productTargets).values(targetsData).onDuplicateKeyUpdate({
    set: {
      bid: sql`VALUES(bid)`,
      targetStatus: sql`VALUES(target_status)`,
      updatedAt: sql`NOW()`,
    },
  });
}

/**
 * v361: UPSERT模式 - 基于campaignId+adGroupId+date+targetingType唯一约束
 */

/**
 * v361: UPSERT模式 - 基于campaignId+adGroupId+date+targetingType唯一约束
 */
export async function bulkCreateDailyPerformance(perfData: InsertDailyPerformance[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  if (perfData.length === 0) return;
  await db.insert(dailyPerformance).values(perfData).onDuplicateKeyUpdate({
    set: {
      impressions: sql`VALUES(impressions)`,
      clicks: sql`VALUES(clicks)`,
      spend: sql`VALUES(spend)`,
      sales: sql`VALUES(sales)`,
      orders: sql`VALUES(orders)`,
    },
  });
}


// ==================== Amazon API Credentials Functions ====================
import { amazonApiCredentials, InsertAmazonApiCredential, AmazonApiCredential } from "../../drizzle/schema";
