// Extracted from production dist/index.js
// Original module: server/db/campaignDetail.ts
// Lines: 148

async function getCampaignDetailWithStats(amazonCampaignId) {
  const db = await getDb();
  if (!db) return null;
  const campaign = await db.select().from(campaigns).where(eq(campaigns.campaignId, amazonCampaignId)).limit(1);
  if (!campaign[0]) return null;
  const adGroupList = await db.select().from(adGroups).where(eq(adGroups.campaignId, amazonCampaignId));
  const adGroupIds = adGroupList.map((ag) => ag.id);
  let keywordList = [];
  if (adGroupIds.length > 0) {
    keywordList = await db.select().from(keywords).where(sql`${keywords.internalAdGroupId} IN (${sql.join(adGroupIds.map((id) => sql`${id}`), sql`, `)})`);
  }
  let productTargetList = [];
  if (adGroupIds.length > 0) {
    productTargetList = await db.select().from(productTargets).where(sql`${productTargets.internalAdGroupId} IN (${sql.join(adGroupIds.map((id) => sql`${id}`), sql`, `)})`);
  }
  const searchTermList = await db.select().from(searchTerms).where(eq(searchTerms.campaignId, amazonCampaignId));
  return {
    campaign: campaign[0],
    adGroups: adGroupList,
    keywords: keywordList,
    productTargets: productTargetList,
    searchTerms: searchTermList
  };
}
async function getCampaignPlacementStats(amazonCampaignId) {
  const db = await getDb();
  if (!db) return [];
  try {
    const placementData = await db.select().from(placementPerformance).where(eq(placementPerformance.campaignId, amazonCampaignId));
    if (placementData.length > 0) {
      const placementMap = /* @__PURE__ */ new Map();
      const labelMap = {
        "top_of_search": "\u641C\u7D22\u7ED3\u679C\u9876\u90E8",
        "product_page": "\u5546\u54C1\u9875\u9762",
        "rest_of_search": "\u641C\u7D22\u7ED3\u679C\u5176\u4ED6\u4F4D\u7F6E",
        "top": "\u641C\u7D22\u7ED3\u679C\u9876\u90E8",
        "detail_page": "\u5546\u54C1\u9875\u9762",
        "other": "\u641C\u7D22\u7ED3\u679C\u5176\u4ED6\u4F4D\u7F6E"
      };
      for (const p of placementData) {
        const key = p.placement || "other";
        const existing = placementMap.get(key);
        if (existing) {
          existing.impressions += p.impressions || 0;
          existing.clicks += p.clicks || 0;
          existing.spend += parseFloat(String(p.spend || "0"));
          existing.sales += parseFloat(String(p.sales || "0"));
          existing.orders += p.orders || 0;
        } else {
          placementMap.set(key, {
            placement: key,
            placementLabel: labelMap[key] || key,
            bidAdjustment: 0,
            impressions: p.impressions || 0,
            clicks: p.clicks || 0,
            spend: parseFloat(String(p.spend || "0")),
            sales: parseFloat(String(p.sales || "0")),
            orders: p.orders || 0
          });
        }
      }
      const campaign2 = await db.select().from(campaigns).where(eq(campaigns.campaignId, amazonCampaignId)).limit(1);
      if (campaign2[0]) {
        for (const [key, data] of placementMap) {
          if (key === "top_of_search" || key === "top") {
            data.bidAdjustment = campaign2[0].placementTopSearchBidAdjustment || 0;
          } else if (key === "product_page" || key === "detail_page") {
            data.bidAdjustment = campaign2[0].placementProductPageBidAdjustment || 0;
          } else {
            data.bidAdjustment = campaign2[0].placementRestBidAdjustment || 0;
          }
        }
      }
      return Array.from(placementMap.values());
    }
  } catch (e) {
  }
  const campaign = await db.select().from(campaigns).where(eq(campaigns.campaignId, amazonCampaignId)).limit(1);
  if (!campaign[0]) return [];
  return [
    {
      placement: "top_of_search",
      placementLabel: "\u641C\u7D22\u7ED3\u679C\u9876\u90E8",
      bidAdjustment: campaign[0].placementTopSearchBidAdjustment || 0,
      impressions: 0,
      clicks: 0,
      spend: 0,
      sales: 0,
      orders: 0
    },
    {
      placement: "product_page",
      placementLabel: "\u5546\u54C1\u9875\u9762",
      bidAdjustment: campaign[0].placementProductPageBidAdjustment || 0,
      impressions: 0,
      clicks: 0,
      spend: 0,
      sales: 0,
      orders: 0
    },
    {
      placement: "rest_of_search",
      placementLabel: "\u641C\u7D22\u7ED3\u679C\u5176\u4ED6\u4F4D\u7F6E",
      bidAdjustment: campaign[0].placementRestBidAdjustment || 0,
      impressions: 0,
      clicks: 0,
      spend: 0,
      sales: 0,
      orders: 0
    }
  ];
}
async function getCampaignTargets(amazonCampaignId) {
  const db = await getDb();
  if (!db) return { keywords: [], productTargets: [] };
  const adGroupList = await db.select({ id: adGroups.id, adGroupName: adGroups.adGroupName }).from(adGroups).where(eq(adGroups.campaignId, amazonCampaignId));
  if (adGroupList.length === 0) {
    return { keywords: [], productTargets: [] };
  }
  const adGroupIds = adGroupList.map((ag) => ag.id);
  const adGroupMap = new Map(adGroupList.map((ag) => [ag.id, ag.adGroupName]));
  const keywordList = await db.select().from(keywords).where(sql`${keywords.internalAdGroupId} IN (${sql.join(adGroupIds.map((id) => sql`${id}`), sql`, `)})`);
  const productTargetList = await db.select().from(productTargets).where(sql`${productTargets.internalAdGroupId} IN (${sql.join(adGroupIds.map((id) => sql`${id}`), sql`, `)})`);
  const keywordsWithAdGroup = keywordList.map((k) => ({
    ...k,
    adGroupName: adGroupMap.get(Number(k.internalAdGroupId)) || "\u672A\u77E5\u5E7F\u544A\u7EC4"
  }));
  const productTargetsWithAdGroup = productTargetList.map((pt) => ({
    ...pt,
    adGroupName: adGroupMap.get(Number(pt.internalAdGroupId)) || "\u672A\u77E5\u5E7F\u544A\u7EC4"
  }));
  return {
    keywords: keywordsWithAdGroup,
    productTargets: productTargetsWithAdGroup
  };
}
var init_campaignDetail = __esm({
  "server/db/campaignDetail.ts"() {
    "use strict";
    init_drizzle_orm();
    init_schema2();
    init_connection();
    __name(getCampaignDetailWithStats, "getCampaignDetailWithStats");
    __name(getCampaignPlacementStats, "getCampaignPlacementStats");
    __name(getCampaignTargets, "getCampaignTargets");
  }
});

