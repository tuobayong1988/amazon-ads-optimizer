// Extracted from production dist/index.js
// Original module: server/services/entityIdResolverDbProvider.ts
// Lines: 102

function createEntityIdResolverDbProvider() {
  return {
    async getCampaignByInternalId(id) {
      const db = await getDb();
      if (!db) return null;
      const results = await db.select({
        id: campaigns.id,
        campaignId: campaigns.campaignId,
        campaignName: campaigns.campaignName
      }).from(campaigns).where(eq(campaigns.id, id)).limit(1);
      return results[0] || null;
    },
    async getCampaignByAmazonId(amazonId) {
      const db = await getDb();
      if (!db) return null;
      const results = await db.select({
        id: campaigns.id,
        campaignId: campaigns.campaignId,
        campaignName: campaigns.campaignName
      }).from(campaigns).where(eq(campaigns.campaignId, amazonId)).limit(1);
      return results[0] || null;
    },
    async getAdGroupByInternalId(id) {
      const db = await getDb();
      if (!db) return null;
      const results = await db.select({
        id: adGroups.id,
        adGroupId: adGroups.adGroupId,
        campaignId: adGroups.campaignId
      }).from(adGroups).where(eq(adGroups.id, id)).limit(1);
      return results[0] || null;
    },
    async getAdGroupByAmazonId(amazonId) {
      const db = await getDb();
      if (!db) return null;
      const results = await db.select({
        id: adGroups.id,
        adGroupId: adGroups.adGroupId,
        campaignId: adGroups.campaignId
      }).from(adGroups).where(eq(adGroups.adGroupId, amazonId)).limit(1);
      return results[0] || null;
    },
    // @ts-ignore
    async getKeywordByInternalId(id) {
      const db = await getDb();
      if (!db) return null;
      const results = await db.select({
        id: keywords.id,
        keywordId: keywords.keywordId,
        internalAdGroupId: keywords.internalAdGroupId
      }).from(keywords).where(eq(keywords.id, id)).limit(1);
      return results[0] || null;
    },
    // @ts-ignore
    async getProductTargetByInternalId(id) {
      const db = await getDb();
      if (!db) return null;
      const results = await db.select({
        id: productTargets.id,
        targetId: productTargets.targetId,
        internalAdGroupId: productTargets.internalAdGroupId
      }).from(productTargets).where(eq(productTargets.id, id)).limit(1);
      return results[0] || null;
    },
    // @ts-ignore
    async getKeywordsByInternalIds(ids) {
      if (ids.length === 0) return [];
      const db = await getDb();
      if (!db) return [];
      return db.select({
        id: keywords.id,
        keywordId: keywords.keywordId,
        internalAdGroupId: keywords.internalAdGroupId
        // @ts-ignore
      }).from(keywords).where(inArray(keywords.id, ids));
    },
    // @ts-ignore
    async getProductTargetsByInternalIds(ids) {
      if (ids.length === 0) return [];
      const db = await getDb();
      if (!db) return [];
      return db.select({
        id: productTargets.id,
        targetId: productTargets.targetId,
        internalAdGroupId: productTargets.internalAdGroupId
      }).from(productTargets).where(inArray(productTargets.id, ids));
    }
  };
}
var log213;
var init_entityIdResolverDbProvider = __esm({
  "server/services/entityIdResolverDbProvider.ts"() {
    "use strict";
    init_drizzle_orm();
    init_connection();
    init_schema2();
    init_logger();
    log213 = createModuleLogger("EntityIdResolverDb");
    __name(createEntityIdResolverDbProvider, "createEntityIdResolverDbProvider");
  }
});

