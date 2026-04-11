// Extracted from production dist/index.js
// Original module: server/sync/autoBidOptimization.ts
// Lines: 124

async function runAutoBidOptimization(syncService, accountId, performanceGroupConfig) {
  const db = await getDb();
  if (!db) return { optimized: 0, skipped: 0 };
  const keywordsToOptimize = await db.select({ keyword: keywords }).from(keywords).innerJoin(adGroups, eq(keywords.internalAdGroupId, adGroups.id)).innerJoin(campaigns, eq(adGroups.campaignId, campaigns.campaignId)).where(and(
    eq(campaigns.accountId, accountId),
    eq(keywords.keywordStatus, "enabled")
  )).then((rows) => rows.map((r) => r.keyword));
  log164.debug(`v230: \u8D26\u53F7${accountId} \u5171${keywordsToOptimize.length}\u4E2A\u542F\u7528\u5173\u952E\u8BCD\u9700\u8981\u4F18\u5316`);
  const results = { optimized: 0, skipped: 0 };
  try {
    const { batchCalculateNextGenBids: batchCalculateNextGenBids2 } = await Promise.resolve().then(() => (init_nextGenBidOrchestrator(), nextGenBidOrchestrator_exports));
    const { buildContextFeatures } = await Promise.resolve().then(() => (init_contextualFeatureService(), contextualFeatureService_exports));
    const batchItems = keywordsToOptimize.map((kw) => ({
      keywordId: kw.id,
      currentBid: parseFloat(kw.bid),
      impressions: kw.impressions || 0,
      clicks: kw.clicks || 0,
      spend: parseFloat(kw.spend || "0"),
      sales: parseFloat(kw.sales || "0"),
      orders: kw.orders || 0,
      acos: parseFloat(kw.spend || "0") > 0 && parseFloat(kw.sales || "0") > 0 ? parseFloat(kw.spend || "0") / parseFloat(kw.sales || "0") : 0,
      cvr: (kw.clicks || 0) > 0 ? (kw.orders || 0) / (kw.clicks || 0) : 0,
      cpc: (kw.clicks || 0) > 0 ? parseFloat(kw.spend || "0") / (kw.clicks || 0) : 0,
      targetAcos: performanceGroupConfig.targetAcos || 0.3
    }));
    const context = await buildContextFeatures(accountId);
    const nextGenResults = await batchCalculateNextGenBids2(accountId, batchItems, context);
    for (const ngResult of nextGenResults) {
      if (ngResult.action === "hold") {
        results.skipped++;
        continue;
      }
      const kw = keywordsToOptimize.find((k) => k.id === ngResult.keywordId);
      if (!kw) {
        results.skipped++;
        continue;
      }
      const [adGroup] = await db.select().from(adGroups).where(eq(adGroups.id, kw.internalAdGroupId)).limit(1);
      if (adGroup) {
        const success2 = await syncService.applyBidAdjustment(
          // @ts-ignore
          "keyword",
          kw.id,
          ngResult.newBid,
          // @ts-ignore
          `NextGen[${ngResult.algorithm}]: ${ngResult.reason}`,
          adGroup.campaignId
        );
        if (success2) {
          results.optimized++;
        } else {
          results.skipped++;
        }
      } else {
        results.skipped++;
      }
    }
    log164.info(`v230: NextGen\u4F18\u5316\u5B8C\u6210 optimized=${results.optimized}, skipped=${results.skipped}`);
    return results;
  } catch (nextGenError) {
    log164.warn(`v230: NextGen\u7B97\u6CD5\u5931\u8D25\uFF0C\u56DE\u9000\u5230\u65E7\u7B97\u6CD5: ${nextGenError.message}`);
  }
  for (const kw of keywordsToOptimize) {
    const target = {
      // @ts-ignore
      id: kw.id,
      // @ts-ignore
      type: "keyword",
      // @ts-ignore
      currentBid: parseFloat(kw.bid),
      // @ts-ignore
      impressions: kw.impressions || 0,
      // @ts-ignore
      clicks: kw.clicks || 0,
      // @ts-ignore
      spend: parseFloat(kw.spend || "0"),
      // @ts-ignore
      sales: parseFloat(kw.sales || "0"),
      // @ts-ignore
      orders: kw.orders || 0,
      // @ts-ignore
      matchType: kw.matchType
      // @ts-ignore
    };
    const adjustment = calculateBidAdjustment(target, performanceGroupConfig, 10, 0.02);
    if (adjustment) {
      const [adGroup] = await db.select().from(adGroups).where(eq(adGroups.id, kw.internalAdGroupId)).limit(1);
      if (adGroup) {
        const success2 = await syncService.applyBidAdjustment(
          "keyword",
          // @ts-ignore
          kw.id,
          adjustment.newBid,
          adjustment.reason,
          adGroup.campaignId
        );
        if (success2) {
          results.optimized++;
        } else {
          results.skipped++;
        }
      } else {
        results.skipped++;
      }
    } else {
      results.skipped++;
    }
  }
  return results;
}
var log164;
var init_autoBidOptimization = __esm({
  "server/sync/autoBidOptimization.ts"() {
    "use strict";
    init_drizzle_orm();
    init_db2();
    init_schema2();
    init_bidOptimizer();
    init_logger();
    log164 = createModuleLogger("AutoBidOpt");
    __name(runAutoBidOptimization, "runAutoBidOptimization");
  }
});

