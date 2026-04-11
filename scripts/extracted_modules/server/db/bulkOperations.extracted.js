// Extracted from production dist/index.js
// Original module: server/db/bulkOperations.ts
// Lines: 80

async function bulkCreateCampaigns(campaignsData) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (campaignsData.length === 0) return;
  await db.insert(campaigns).values(campaignsData).onDuplicateKeyUpdate({
    set: {
      campaignName: sql`VALUES(campaign_name)`,
      campaignStatus: sql`VALUES(campaign_status)`,
      dailyBudget: sql`VALUES(daily_budget)`,
      updatedAt: sql`NOW()`
    }
  });
}
async function bulkCreateAdGroups(adGroupsData) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (adGroupsData.length === 0) return;
  await db.insert(adGroups).values(adGroupsData).onDuplicateKeyUpdate({
    set: {
      adGroupName: sql`VALUES(ad_group_name)`,
      adGroupStatus: sql`VALUES(ad_group_status)`,
      defaultBid: sql`VALUES(default_bid)`,
      updatedAt: sql`NOW()`
    }
  });
}
async function bulkCreateKeywords(keywordsData) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (keywordsData.length === 0) return;
  await db.insert(keywords).values(keywordsData).onDuplicateKeyUpdate({
    set: {
      keywordText: sql`VALUES(keyword_text)`,
      matchType: sql`VALUES(match_type)`,
      bid: sql`VALUES(bid)`,
      keywordStatus: sql`VALUES(keyword_status)`,
      updatedAt: sql`NOW()`
    }
  });
}
async function bulkCreateProductTargets(targetsData) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (targetsData.length === 0) return;
  await db.insert(productTargets).values(targetsData).onDuplicateKeyUpdate({
    set: {
      bid: sql`VALUES(bid)`,
      targetStatus: sql`VALUES(target_status)`,
      updatedAt: sql`NOW()`
    }
  });
}
async function bulkCreateDailyPerformance(perfData) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (perfData.length === 0) return;
  await db.insert(dailyPerformance).values(perfData).onDuplicateKeyUpdate({
    set: {
      impressions: sql`VALUES(impressions)`,
      clicks: sql`VALUES(clicks)`,
      spend: sql`VALUES(spend)`,
      sales: sql`VALUES(sales)`,
      orders: sql`VALUES(orders)`
    }
  });
}
var init_bulkOperations = __esm({
  "server/db/bulkOperations.ts"() {
    "use strict";
    init_drizzle_orm();
    init_schema2();
    init_connection();
    __name(bulkCreateCampaigns, "bulkCreateCampaigns");
    __name(bulkCreateAdGroups, "bulkCreateAdGroups");
    __name(bulkCreateKeywords, "bulkCreateKeywords");
    __name(bulkCreateProductTargets, "bulkCreateProductTargets");
    __name(bulkCreateDailyPerformance, "bulkCreateDailyPerformance");
  }
});

