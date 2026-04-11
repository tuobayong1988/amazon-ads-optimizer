// Extracted from production dist/index.js
// Original module: server/optimization/localBidRecommendationEngine.ts
// Lines: 363

async function getLocalKeywordBidRecommendation(accountId, adGroupId, campaignId, campaignType = "sponsoredProducts", targetAcos = 0.3) {
  const db = await getDb();
  if (!db) {
    log99.warn("[v520] getDb() returned null, returning minimum_default");
    return { suggestedBid: 0.75, rangeStart: 0.3, rangeEnd: 1.5, confidence: 0.1, source: "minimum_default", sampleSize: 0, reasoning: "\u6570\u636E\u5E93\u4E0D\u53EF\u7528" };
  }
  try {
    const adGroupPerf = await db.select({
      totalClicks: sql`COALESCE(SUM(${keywords.clicks}), 0)`,
      totalSpend: sql`COALESCE(SUM(CAST(${keywords.spend} AS DECIMAL(12,2))), 0)`,
      totalSales: sql`COALESCE(SUM(CAST(${keywords.sales} AS DECIMAL(12,2))), 0)`,
      totalOrders: sql`COALESCE(SUM(${keywords.orders}), 0)`,
      totalImpressions: sql`COALESCE(SUM(${keywords.impressions}), 0)`,
      sampleCount: sql`COUNT(*)`,
      avgBid: sql`COALESCE(AVG(CAST(${keywords.bid} AS DECIMAL(10,2))), 0)`
    }).from(keywords).innerJoin(adGroups, eq(keywords.internalAdGroupId, adGroups.id)).where(
      and(
        eq(adGroups.adGroupId, adGroupId),
        eq(keywords.accountId, accountId),
        eq(keywords.keywordStatus, "enabled"),
        gt(keywords.clicks, 0)
      )
    );
    const perf = adGroupPerf[0];
    if (perf && perf.totalClicks >= 10) {
      const rec = calculateBidFromPerformance(perf, targetAcos, "adgroup");
      log99.info(`[v457] \u672C\u5730\u63A8\u8350(AdGroup\u7EA7): adGroupId=${adGroupId}, bid=$${rec.suggestedBid.toFixed(2)}, confidence=${rec.confidence.toFixed(2)}, samples=${rec.sampleSize}`);
      return rec;
    }
  } catch (err) {
    log99.debug(`[v457] AdGroup\u7EA7\u67E5\u8BE2\u5931\u8D25: ${err.message}`);
  }
  if (campaignId) {
    try {
      const campaignPerf = await db.select({
        totalClicks: sql`COALESCE(SUM(${keywords.clicks}), 0)`,
        totalSpend: sql`COALESCE(SUM(CAST(${keywords.spend} AS DECIMAL(12,2))), 0)`,
        totalSales: sql`COALESCE(SUM(CAST(${keywords.sales} AS DECIMAL(12,2))), 0)`,
        totalOrders: sql`COALESCE(SUM(${keywords.orders}), 0)`,
        totalImpressions: sql`COALESCE(SUM(${keywords.impressions}), 0)`,
        sampleCount: sql`COUNT(*)`,
        avgBid: sql`COALESCE(AVG(CAST(${keywords.bid} AS DECIMAL(10,2))), 0)`
      }).from(keywords).where(
        and(
          eq(keywords.campaignId, campaignId),
          eq(keywords.accountId, accountId),
          eq(keywords.keywordStatus, "enabled"),
          gt(keywords.clicks, 0)
        )
      );
      const perf = campaignPerf[0];
      if (perf && perf.totalClicks >= 5) {
        const rec = calculateBidFromPerformance(perf, targetAcos, "campaign");
        log99.info(`[v457] \u672C\u5730\u63A8\u8350(Campaign\u7EA7): campaignId=${campaignId}, bid=$${rec.suggestedBid.toFixed(2)}, confidence=${rec.confidence.toFixed(2)}, samples=${rec.sampleCount}`);
        return rec;
      }
    } catch (err) {
      log99.debug(`[v457] Campaign\u7EA7\u67E5\u8BE2\u5931\u8D25: ${err.message}`);
    }
  }
  try {
    const accountPerf = await db.select({
      totalClicks: sql`COALESCE(SUM(${keywords.clicks}), 0)`,
      totalSpend: sql`COALESCE(SUM(CAST(${keywords.spend} AS DECIMAL(12,2))), 0)`,
      totalSales: sql`COALESCE(SUM(CAST(${keywords.sales} AS DECIMAL(12,2))), 0)`,
      totalOrders: sql`COALESCE(SUM(${keywords.orders}), 0)`,
      totalImpressions: sql`COALESCE(SUM(${keywords.impressions}), 0)`,
      sampleCount: sql`COUNT(*)`,
      avgBid: sql`COALESCE(AVG(CAST(${keywords.bid} AS DECIMAL(10,2))), 0)`
    }).from(keywords).innerJoin(campaigns, eq(keywords.campaignId, campaigns.campaignId)).where(
      and(
        eq(keywords.accountId, accountId),
        eq(campaigns.campaignType, campaignType),
        eq(keywords.keywordStatus, "enabled"),
        gt(keywords.clicks, 0)
      )
    );
    const perf = accountPerf[0];
    if (perf && perf.totalClicks >= 3) {
      const rec = calculateBidFromPerformance(perf, targetAcos, "account");
      log99.info(`[v457] \u672C\u5730\u63A8\u8350(Account\u7EA7): accountId=${accountId}, type=${campaignType}, bid=$${rec.suggestedBid.toFixed(2)}, confidence=${rec.confidence.toFixed(2)}, samples=${rec.sampleCount}`);
      return rec;
    }
  } catch (err) {
    log99.debug(`[v457] Account\u7EA7\u67E5\u8BE2\u5931\u8D25: ${err.message}`);
  }
  if (campaignType !== "sp_manual" && campaignType !== "sp_auto" && campaignType !== "sponsoredProducts") {
    try {
      const crossTypePerf = await db.select({
        totalClicks: sql`COALESCE(SUM(${keywords.clicks}), 0)`,
        totalSpend: sql`COALESCE(SUM(CAST(${keywords.spend} AS DECIMAL(12,2))), 0)`,
        totalSales: sql`COALESCE(SUM(CAST(${keywords.sales} AS DECIMAL(12,2))), 0)`,
        totalOrders: sql`COALESCE(SUM(${keywords.orders}), 0)`,
        totalImpressions: sql`COALESCE(SUM(${keywords.impressions}), 0)`,
        sampleCount: sql`COUNT(*)`,
        avgBid: sql`COALESCE(AVG(CAST(${keywords.bid} AS DECIMAL(10,2))), 0)`
      }).from(keywords).innerJoin(campaigns, eq(keywords.campaignId, campaigns.campaignId)).where(
        and(
          eq(keywords.accountId, accountId),
          // 使用SP关键词数据作为跨类型参考
          sql`${campaigns.campaignType} IN ('sp_manual', 'sp_auto')`,
          eq(keywords.keywordStatus, "enabled"),
          gt(keywords.clicks, 0)
        )
      );
      const perf = crossTypePerf[0];
      if (perf && perf.totalClicks >= 3) {
        const rec = calculateBidFromPerformance(perf, targetAcos, "account");
        log99.info(`[v515] \u5173\u952E\u8BCD\u672C\u5730\u63A8\u8350(\u8DE8\u7C7B\u578BSP\u56DE\u9000): accountId=${accountId}, type=${campaignType}, bid=$${rec.suggestedBid.toFixed(2)}, confidence=${(rec.confidence * 0.7).toFixed(2)}`);
        return {
          ...rec,
          confidence: Math.round(rec.confidence * 0.7 * 100) / 100,
          reasoning: `\u8DE8\u7C7B\u578B\u56DE\u9000(SP\u2192${campaignType}): ${rec.reasoning}`
        };
      }
    } catch (err) {
      log99.debug(`[v515] \u5173\u952E\u8BCD\u8DE8\u7C7B\u578B\u56DE\u9000\u67E5\u8BE2\u5931\u8D25: ${err.message}`);
    }
  }
  log99.warn(`[v515] \u6240\u6709\u672C\u5730\u63A8\u8350\u7B56\u7565\u5747\u65E0\u8DB3\u591F\u6570\u636E, accountId=${accountId}, adGroupId=${adGroupId}, type=${campaignType}, \u8FD4\u56DE\u6700\u4F4E\u9ED8\u8BA4\u503C`);
  return {
    suggestedBid: 0.75,
    rangeStart: 0.3,
    rangeEnd: 1.5,
    confidence: 0.1,
    source: "minimum_default",
    sampleSize: 0,
    reasoning: "\u672C\u5730\u65E0\u5386\u53F2\u6570\u636E\uFF0C\u4F7F\u7528\u6700\u4F4E\u9ED8\u8BA4\u51FA\u4EF7"
  };
}
async function getLocalTargetBidRecommendation(accountId, adGroupId, campaignId, campaignType = "sponsoredProducts", targetAcos = 0.3) {
  const db = await getDb();
  if (!db) {
    log99.warn("[v520] getDb() returned null for target recommendation, returning minimum_default");
    return { suggestedBid: 0.75, rangeStart: 0.3, rangeEnd: 1.5, confidence: 0.1, source: "minimum_default", sampleSize: 0, reasoning: "\u6570\u636E\u5E93\u4E0D\u53EF\u7528" };
  }
  try {
    const adGroupPerf = await db.select({
      totalClicks: sql`COALESCE(SUM(${productTargets.clicks}), 0)`,
      totalSpend: sql`COALESCE(SUM(CAST(${productTargets.spend} AS DECIMAL(12,2))), 0)`,
      totalSales: sql`COALESCE(SUM(CAST(${productTargets.sales} AS DECIMAL(12,2))), 0)`,
      totalOrders: sql`COALESCE(SUM(${productTargets.orders}), 0)`,
      totalImpressions: sql`COALESCE(SUM(${productTargets.impressions}), 0)`,
      sampleCount: sql`COUNT(*)`,
      avgBid: sql`COALESCE(AVG(CAST(${productTargets.bid} AS DECIMAL(10,2))), 0)`
    }).from(productTargets).innerJoin(adGroups, eq(productTargets.internalAdGroupId, adGroups.id)).where(
      and(
        eq(adGroups.adGroupId, adGroupId),
        eq(productTargets.accountId, accountId),
        // @ts-ignore
        or(
          // @ts-ignore
          eq(productTargets.targetStatus, "enabled"),
          isNull(productTargets.targetStatus)
        ),
        gt(productTargets.clicks, 0),
        or(
          // @ts-ignore
          eq(productTargets.amazonDeleted, 0),
          // @ts-ignore
          isNull(productTargets.amazonDeleted)
        )
      )
    );
    const perf = adGroupPerf[0];
    if (perf && perf.totalClicks >= 10) {
      const rec = calculateBidFromPerformance(perf, targetAcos, "adgroup");
      log99.info(`[v457] Target\u672C\u5730\u63A8\u8350(AdGroup\u7EA7): adGroupId=${adGroupId}, bid=$${rec.suggestedBid.toFixed(2)}, confidence=${rec.confidence.toFixed(2)}`);
      return rec;
    }
  } catch (err) {
    log99.debug(`[v457] Target AdGroup\u7EA7\u67E5\u8BE2\u5931\u8D25: ${err.message}`);
  }
  if (campaignId) {
    try {
      const campaignPerf = await db.select({
        totalClicks: sql`COALESCE(SUM(${productTargets.clicks}), 0)`,
        totalSpend: sql`COALESCE(SUM(CAST(${productTargets.spend} AS DECIMAL(12,2))), 0)`,
        totalSales: sql`COALESCE(SUM(CAST(${productTargets.sales} AS DECIMAL(12,2))), 0)`,
        totalOrders: sql`COALESCE(SUM(${productTargets.orders}), 0)`,
        totalImpressions: sql`COALESCE(SUM(${productTargets.impressions}), 0)`,
        sampleCount: sql`COUNT(*)`,
        avgBid: sql`COALESCE(AVG(CAST(${productTargets.bid} AS DECIMAL(10,2))), 0)`
      }).from(productTargets).where(
        // @ts-ignore
        and(
          // @ts-ignore
          eq(productTargets.campaignId, campaignId),
          eq(productTargets.accountId, accountId),
          or(
            eq(productTargets.targetStatus, "enabled"),
            isNull(productTargets.targetStatus)
          ),
          gt(productTargets.clicks, 0),
          or(
            // @ts-ignore
            eq(productTargets.amazonDeleted, 0),
            // @ts-ignore
            isNull(productTargets.amazonDeleted)
          )
        )
      );
      const perf = campaignPerf[0];
      if (perf && perf.totalClicks >= 5) {
        const rec = calculateBidFromPerformance(perf, targetAcos, "campaign");
        log99.info(`[v457] Target\u672C\u5730\u63A8\u8350(Campaign\u7EA7): campaignId=${campaignId}, bid=$${rec.suggestedBid.toFixed(2)}, confidence=${rec.confidence.toFixed(2)}`);
        return rec;
      }
    } catch (err) {
      log99.debug(`[v457] Target Campaign\u7EA7\u67E5\u8BE2\u5931\u8D25: ${err.message}`);
    }
  }
  try {
    const accountPerf = await db.select({
      totalClicks: sql`COALESCE(SUM(${productTargets.clicks}), 0)`,
      totalSpend: sql`COALESCE(SUM(CAST(${productTargets.spend} AS DECIMAL(12,2))), 0)`,
      totalSales: sql`COALESCE(SUM(CAST(${productTargets.sales} AS DECIMAL(12,2))), 0)`,
      totalOrders: sql`COALESCE(SUM(${productTargets.orders}), 0)`,
      totalImpressions: sql`COALESCE(SUM(${productTargets.impressions}), 0)`,
      sampleCount: sql`COUNT(*)`,
      avgBid: sql`COALESCE(AVG(CAST(${productTargets.bid} AS DECIMAL(10,2))), 0)`
    }).from(productTargets).innerJoin(campaigns, eq(productTargets.campaignId, campaigns.campaignId)).where(
      and(
        eq(productTargets.accountId, accountId),
        eq(campaigns.campaignType, campaignType),
        or(
          eq(productTargets.targetStatus, "enabled"),
          isNull(productTargets.targetStatus)
        ),
        gt(productTargets.clicks, 0),
        or(
          // @ts-ignore
          eq(productTargets.amazonDeleted, 0),
          // @ts-ignore
          isNull(productTargets.amazonDeleted)
        )
      )
    );
    const perf = accountPerf[0];
    if (perf && perf.totalClicks >= 3) {
      const rec = calculateBidFromPerformance(perf, targetAcos, "account");
      log99.info(`[v457] Target\u672C\u5730\u63A8\u8350(Account\u7EA7): accountId=${accountId}, bid=$${rec.suggestedBid.toFixed(2)}, confidence=${rec.confidence.toFixed(2)}`);
      return rec;
    }
  } catch (err) {
    log99.debug(`[v457] Target Account\u7EA7\u67E5\u8BE2\u5931\u8D25: ${err.message}`);
  }
  if (campaignType !== "sp_manual" && campaignType !== "sp_auto" && campaignType !== "sponsoredProducts") {
    try {
      const crossTypePerf = await db.select({
        totalClicks: sql`COALESCE(SUM(${productTargets.clicks}), 0)`,
        totalSpend: sql`COALESCE(SUM(CAST(${productTargets.spend} AS DECIMAL(12,2))), 0)`,
        totalSales: sql`COALESCE(SUM(CAST(${productTargets.sales} AS DECIMAL(12,2))), 0)`,
        totalOrders: sql`COALESCE(SUM(${productTargets.orders}), 0)`,
        totalImpressions: sql`COALESCE(SUM(${productTargets.impressions}), 0)`,
        sampleCount: sql`COUNT(*)`,
        avgBid: sql`COALESCE(AVG(CAST(${productTargets.bid} AS DECIMAL(10,2))), 0)`
      }).from(productTargets).innerJoin(campaigns, eq(productTargets.campaignId, campaigns.campaignId)).where(
        and(
          eq(productTargets.accountId, accountId),
          // 使用SP数据作为跨类型参考
          sql`${campaigns.campaignType} IN ('sp_manual', 'sp_auto')`,
          or(
            eq(productTargets.targetStatus, "enabled"),
            isNull(productTargets.targetStatus)
          ),
          gt(productTargets.clicks, 0),
          or(
            // @ts-ignore
            eq(productTargets.amazonDeleted, 0),
            // @ts-ignore
            isNull(productTargets.amazonDeleted)
          )
        )
      );
      const perf = crossTypePerf[0];
      if (perf && perf.totalClicks >= 3) {
        const rec = calculateBidFromPerformance(perf, targetAcos, "account");
        log99.info(`[v515] Target\u672C\u5730\u63A8\u8350(\u8DE8\u7C7B\u578BSP\u56DE\u9000): accountId=${accountId}, type=${campaignType}, bid=$${rec.suggestedBid.toFixed(2)}, confidence=${(rec.confidence * 0.7).toFixed(2)}`);
        return {
          ...rec,
          confidence: Math.round(rec.confidence * 0.7 * 100) / 100,
          reasoning: `\u8DE8\u7C7B\u578B\u56DE\u9000(SP\u2192${campaignType}): ${rec.reasoning}`
        };
      }
    } catch (err) {
      log99.debug(`[v515] Target\u8DE8\u7C7B\u578B\u56DE\u9000\u67E5\u8BE2\u5931\u8D25: ${err.message}`);
    }
  }
  log99.warn(`[v515] Target\u6240\u6709\u672C\u5730\u63A8\u8350\u7B56\u7565\u5747\u65E0\u8DB3\u591F\u6570\u636E, accountId=${accountId}, adGroupId=${adGroupId}, type=${campaignType}`);
  return {
    suggestedBid: 0.75,
    rangeStart: 0.3,
    rangeEnd: 1.5,
    confidence: 0.1,
    source: "minimum_default",
    sampleSize: 0,
    reasoning: "\u672C\u5730\u65E0\u5386\u53F2\u6570\u636E\uFF0C\u4F7F\u7528\u6700\u4F4E\u9ED8\u8BA4\u51FA\u4EF7"
  };
}
function calculateBidFromPerformance(perf, targetAcos, source) {
  const { totalClicks, totalSpend, totalSales, totalOrders, totalImpressions, sampleCount, avgBid } = perf;
  const avgCpc = totalClicks > 0 ? totalSpend / totalClicks : 0;
  const actualAcos = totalSales > 0 ? totalSpend / totalSales : 1;
  const cvr = totalClicks > 0 ? totalOrders / totalClicks : 0;
  const avgOrderValue = totalOrders > 0 ? totalSales / totalOrders : 0;
  let suggestedBid;
  if (totalSales > 0 && actualAcos > 0) {
    const acosRatio = Math.min(Math.max(targetAcos / actualAcos, 0.3), 3);
    suggestedBid = avgCpc * acosRatio;
  } else if (cvr > 0 && avgOrderValue > 0) {
    suggestedBid = targetAcos * avgOrderValue * cvr;
  } else {
    suggestedBid = avgBid > 0 ? avgBid * 0.8 : 0.75;
  }
  suggestedBid = Math.max(0.1, Math.min(suggestedBid, 100));
  const rangeStart = Math.max(0.1, suggestedBid * 0.5);
  const rangeEnd = Math.min(100, suggestedBid * 1.5);
  let confidence;
  const sourceMultiplier = source === "adgroup" ? 1 : source === "campaign" ? 0.8 : 0.6;
  if (totalClicks >= 100 && totalOrders >= 5) {
    confidence = 0.85 * sourceMultiplier;
  } else if (totalClicks >= 50 && totalOrders >= 2) {
    confidence = 0.7 * sourceMultiplier;
  } else if (totalClicks >= 20) {
    confidence = 0.55 * sourceMultiplier;
  } else if (totalClicks >= 10) {
    confidence = 0.4 * sourceMultiplier;
  } else {
    confidence = 0.25 * sourceMultiplier;
  }
  const reasoning = [
    `\u6765\u6E90: ${source}\u7EA7\u5386\u53F2\u6570\u636E`,
    `\u6837\u672C: ${sampleCount}\u4E2A\u5B9E\u4F53, ${totalClicks}\u6B21\u70B9\u51FB, ${totalOrders}\u6B21\u8F6C\u5316`,
    `avgCPC=$${avgCpc.toFixed(2)}, actualACoS=${(actualAcos * 100).toFixed(1)}%, targetACoS=${(targetAcos * 100).toFixed(1)}%`,
    `CVR=${(cvr * 100).toFixed(2)}%, AOV=$${avgOrderValue.toFixed(2)}`
  ].join("; ");
  return {
    suggestedBid: Math.round(suggestedBid * 100) / 100,
    // 保留2位小数
    rangeStart: Math.round(rangeStart * 100) / 100,
    rangeEnd: Math.round(rangeEnd * 100) / 100,
    confidence: Math.round(confidence * 100) / 100,
    source,
    sampleSize: sampleCount,
    reasoning
  };
}
var log99;
var init_localBidRecommendationEngine = __esm({
  "server/optimization/localBidRecommendationEngine.ts"() {
    "use strict";
    init_db2();
    init_schema2();
    init_drizzle_orm();
    init_logger();
    log99 = createModuleLogger("LocalBidRec");
    __name(getLocalKeywordBidRecommendation, "getLocalKeywordBidRecommendation");
    __name(getLocalTargetBidRecommendation, "getLocalTargetBidRecommendation");
    __name(calculateBidFromPerformance, "calculateBidFromPerformance");
  }
});

