// Extracted from production dist/index.js
// Original module: server/optimization/suggestedBidColdStartEngine.ts
// Lines: 437

function isInColdStartPeriod(target) {
  const clicks = target.clicks || 0;
  const impressions = target.impressions || 0;
  if (clicks < COLD_START_CONFIG.DATA_SPARSE_CLICKS_THRESHOLD) {
    return true;
  }
  if (impressions < COLD_START_CONFIG.DATA_SPARSE_IMPRESSIONS_THRESHOLD) {
    return true;
  }
  if (target.createdAt) {
    const createdDate = new Date(target.createdAt);
    const daysSinceCreation = (Date.now() - createdDate.getTime()) / (1e3 * 60 * 60 * 24);
    if (daysSinceCreation <= COLD_START_CONFIG.COLD_START_PERIOD_DAYS) {
      return true;
    }
  }
  return false;
}
async function getColdStartBidOverride(accountId, target, targetAcos) {
  try {
    if (!isInColdStartPeriod(target)) {
      return null;
    }
    log56.info(`[ColdStart] \u76EE\u6807${target.id}(${target.type})\u8FDB\u5165\u51B7\u542F\u52A8\u51FA\u4EF7\u5F15\u64CE, currentBid=$${target.currentBid.toFixed(2)}, clicks=${target.clicks || 0}, impressions=${target.impressions || 0}, matchType=${target.matchType || "unknown"}`);
    const coefficients = calculateDynamicCoefficients(target, targetAcos);
    if (target.adGroupId) {
      const adGroupAnchor = await getAdGroupAnchorCpc(
        accountId,
        target.adGroupId,
        target.type,
        targetAcos
      );
      if (adGroupAnchor && adGroupAnchor.sampleCount >= COLD_START_CONFIG.MIN_ANCHOR_SAMPLES_ADGROUP) {
        const anchorBid = calculateAnchorBid(adGroupAnchor, coefficients, target);
        const confidence = calculateConfidence(adGroupAnchor, "adgroup");
        log56.info(`[ColdStart] Level 1\u547D\u4E2D: \u540CAdGroup\u951A\u70B9CPC=$${adGroupAnchor.weightedAvgCpc.toFixed(2)}, \u6837\u672C=${adGroupAnchor.sampleCount}, \u63A8\u8350\u51FA\u4EF7=$${anchorBid.toFixed(2)}, \u7F6E\u4FE1\u5EA6=${confidence.toFixed(2)}`);
        return buildResult(
          anchorBid,
          "adgroup_anchor",
          confidence,
          adGroupAnchor,
          coefficients,
          target,
          `\u540C\u5E7F\u544A\u7EC4\u5185${adGroupAnchor.sampleCount}\u4E2A\u4F18\u8D28\u8BCD\u7684\u52A0\u6743CPC=$${adGroupAnchor.weightedAvgCpc.toFixed(2)}\u4F5C\u4E3A\u951A\u70B9`
        );
      }
    }
    if (target.campaignId) {
      const campaignAnchor = await getCampaignAnchorCpc(
        accountId,
        target.campaignId,
        target.type,
        targetAcos
      );
      if (campaignAnchor && campaignAnchor.sampleCount >= COLD_START_CONFIG.MIN_ANCHOR_SAMPLES_CAMPAIGN) {
        const anchorBid = calculateAnchorBid(campaignAnchor, coefficients, target);
        const confidence = calculateConfidence(campaignAnchor, "campaign");
        log56.info(`[ColdStart] Level 2\u547D\u4E2D: \u540CCampaign\u951A\u70B9CPC=$${campaignAnchor.weightedAvgCpc.toFixed(2)}, \u6837\u672C=${campaignAnchor.sampleCount}, \u63A8\u8350\u51FA\u4EF7=$${anchorBid.toFixed(2)}, \u7F6E\u4FE1\u5EA6=${confidence.toFixed(2)}`);
        return buildResult(
          anchorBid,
          "campaign_anchor",
          confidence,
          campaignAnchor,
          coefficients,
          target,
          `\u540C\u5E7F\u544A\u6D3B\u52A8\u5185${campaignAnchor.sampleCount}\u4E2A\u4F18\u8D28\u8BCD\u7684\u52A0\u6743CPC=$${campaignAnchor.weightedAvgCpc.toFixed(2)}\u4F5C\u4E3A\u951A\u70B9`
        );
      }
    }
    {
      const bayesianResult = await getBayesianSmoothedBid(accountId, target, targetAcos, coefficients);
      if (bayesianResult) {
        return bayesianResult;
      }
    }
    if (target.suggestedBid && target.suggestedBid > 0) {
      const enhancedBid = target.suggestedBid * coefficients.combined;
      const safeBid = Math.max(
        COLD_START_CONFIG.ANCHOR_BID_MIN,
        Math.min(enhancedBid, target.suggestedBid * 1.3)
        // 不超过建议竞价的130%
      );
      const confidence = 0.6;
      log56.info(`[ColdStart] Level 4\u547D\u4E2D: Amazon\u5EFA\u8BAE\u7ADE\u4EF7\u589E\u5F3A, suggestedBid=$${target.suggestedBid.toFixed(2)}, \u52A8\u6001\u7CFB\u6570=${coefficients.combined.toFixed(2)}, \u63A8\u8350\u51FA\u4EF7=$${safeBid.toFixed(2)}`);
      return {
        recommendedBid: Math.round(safeBid * 100) / 100,
        strategy: "suggested_bid_enhanced",
        priorWeight: 0.7,
        confidence,
        reason: `Amazon\u5EFA\u8BAE\u7ADE\u4EF7$${target.suggestedBid.toFixed(2)} \xD7 \u52A8\u6001\u7CFB\u6570${coefficients.combined.toFixed(2)}`,
        suggestedBidInfo: {
          suggestedBid: target.suggestedBid,
          rangeStart: target.suggestedBidRangeStart || target.suggestedBid * 0.7,
          rangeEnd: target.suggestedBidRangeEnd || target.suggestedBid * 1.3,
          source: "amazon_suggested_enhanced"
        },
        coefficients
      };
    }
    log56.info(`[ColdStart] \u6240\u6709Level\u5747\u672A\u547D\u4E2D, target=${target.id}, \u5C06\u7531\u89C4\u5219\u5F15\u64CE\u5904\u7406`);
    return null;
  } catch (err) {
    log56.warn(`[ColdStart] \u51B7\u542F\u52A8\u5F15\u64CE\u5F02\u5E38(target=${target.id}): ${err.message}`);
    return null;
  }
}
async function getAdGroupAnchorCpc(accountId, internalAdGroupId, entityType, targetAcos) {
  try {
    const db = await getDb();
    if (!db) return null;
    const maxAcos = targetAcos * COLD_START_CONFIG.QUALITY_ACOS_MULTIPLIER;
    if (entityType === "keyword") {
      const [stats4] = await db.select({
        count: sql`COUNT(*)`,
        // 加权平均CPC：使用订单数作为权重
        weightedAvgCpc: sql`
          COALESCE(
            SUM(CAST(${keywords.spend} AS DECIMAL(12,4))) / NULLIF(SUM(${keywords.clicks}), 0),
            AVG(CAST(${keywords.bid} AS DECIMAL(10,4)))
          )`,
        avgBid: sql`AVG(CAST(${keywords.bid} AS DECIMAL(10,4)))`,
        totalOrders: sql`COALESCE(SUM(${keywords.orders}), 0)`,
        totalSpend: sql`COALESCE(SUM(CAST(${keywords.spend} AS DECIMAL(12,2))), 0)`,
        totalSales: sql`COALESCE(SUM(CAST(${keywords.sales} AS DECIMAL(12,2))), 0)`
      }).from(keywords).where(and(
        eq(keywords.accountId, accountId),
        eq(keywords.internalAdGroupId, internalAdGroupId),
        eq(keywords.keywordStatus, "enabled"),
        gte(keywords.orders, COLD_START_CONFIG.QUALITY_MIN_ORDERS),
        gt(keywords.clicks, 0)
      ));
      if (!stats4 || Number(stats4.count) === 0) return null;
      const totalSpend = Number(stats4.totalSpend || 0);
      const totalSales = Number(stats4.totalSales || 0);
      const actualAcos = totalSales > 0 ? totalSpend / totalSales : 999;
      if (actualAcos > maxAcos * 2) return null;
      return {
        weightedAvgCpc: Math.max(0.02, Number(stats4.weightedAvgCpc || 0)),
        avgBid: Math.max(0.02, Number(stats4.avgBid || 0)),
        sampleCount: Number(stats4.count),
        totalOrders: Number(stats4.totalOrders),
        avgAcos: actualAcos,
        source: "adgroup"
      };
    } else {
      const [stats4] = await db.select({
        count: sql`COUNT(*)`,
        weightedAvgCpc: sql`
          COALESCE(
            SUM(CAST(${productTargets.spend} AS DECIMAL(12,4))) / NULLIF(SUM(${productTargets.clicks}), 0),
            AVG(CAST(${productTargets.bid} AS DECIMAL(10,4)))
          )`,
        avgBid: sql`AVG(CAST(${productTargets.bid} AS DECIMAL(10,4)))`,
        totalOrders: sql`COALESCE(SUM(${productTargets.orders}), 0)`,
        totalSpend: sql`COALESCE(SUM(CAST(${productTargets.spend} AS DECIMAL(12,2))), 0)`,
        totalSales: sql`COALESCE(SUM(CAST(${productTargets.sales} AS DECIMAL(12,2))), 0)`
      }).from(productTargets).where(and(
        eq(productTargets.accountId, accountId),
        eq(productTargets.internalAdGroupId, internalAdGroupId),
        gte(productTargets.orders, COLD_START_CONFIG.QUALITY_MIN_ORDERS),
        gt(productTargets.clicks, 0)
      ));
      if (!stats4 || Number(stats4.count) === 0) return null;
      const totalSpend = Number(stats4.totalSpend || 0);
      const totalSales = Number(stats4.totalSales || 0);
      const actualAcos = totalSales > 0 ? totalSpend / totalSales : 999;
      if (actualAcos > maxAcos * 2) return null;
      return {
        weightedAvgCpc: Math.max(0.02, Number(stats4.weightedAvgCpc || 0)),
        avgBid: Math.max(0.02, Number(stats4.avgBid || 0)),
        sampleCount: Number(stats4.count),
        totalOrders: Number(stats4.totalOrders),
        avgAcos: actualAcos,
        source: "adgroup"
      };
    }
  } catch (err) {
    log56.warn(`[ColdStart] AdGroup\u951A\u70B9\u67E5\u8BE2\u5F02\u5E38: ${err.message}`);
    return null;
  }
}
async function getCampaignAnchorCpc(accountId, amazonCampaignId, entityType, targetAcos) {
  try {
    const db = await getDb();
    if (!db) return null;
    const maxAcos = targetAcos * COLD_START_CONFIG.QUALITY_ACOS_MULTIPLIER;
    const campaignIdStr = String(amazonCampaignId);
    if (entityType === "keyword") {
      const [stats4] = await db.select({
        count: sql`COUNT(*)`,
        weightedAvgCpc: sql`
          COALESCE(
            SUM(CAST(${keywords.spend} AS DECIMAL(12,4))) / NULLIF(SUM(${keywords.clicks}), 0),
            AVG(CAST(${keywords.bid} AS DECIMAL(10,4)))
          )`,
        avgBid: sql`AVG(CAST(${keywords.bid} AS DECIMAL(10,4)))`,
        totalOrders: sql`COALESCE(SUM(${keywords.orders}), 0)`,
        totalSpend: sql`COALESCE(SUM(CAST(${keywords.spend} AS DECIMAL(12,2))), 0)`,
        totalSales: sql`COALESCE(SUM(CAST(${keywords.sales} AS DECIMAL(12,2))), 0)`
      }).from(keywords).where(and(
        eq(keywords.accountId, accountId),
        eq(keywords.campaignId, campaignIdStr),
        eq(keywords.keywordStatus, "enabled"),
        gte(keywords.orders, COLD_START_CONFIG.QUALITY_MIN_ORDERS),
        gt(keywords.clicks, 0)
      ));
      if (!stats4 || Number(stats4.count) === 0) return null;
      const totalSpend = Number(stats4.totalSpend || 0);
      const totalSales = Number(stats4.totalSales || 0);
      const actualAcos = totalSales > 0 ? totalSpend / totalSales : 999;
      if (actualAcos > maxAcos * 2) return null;
      return {
        weightedAvgCpc: Math.max(0.02, Number(stats4.weightedAvgCpc || 0)),
        avgBid: Math.max(0.02, Number(stats4.avgBid || 0)),
        sampleCount: Number(stats4.count),
        totalOrders: Number(stats4.totalOrders),
        avgAcos: actualAcos,
        source: "campaign"
      };
    } else {
      const [stats4] = await db.select({
        count: sql`COUNT(*)`,
        weightedAvgCpc: sql`
          COALESCE(
            SUM(CAST(${productTargets.spend} AS DECIMAL(12,4))) / NULLIF(SUM(${productTargets.clicks}), 0),
            AVG(CAST(${productTargets.bid} AS DECIMAL(10,4)))
          )`,
        avgBid: sql`AVG(CAST(${productTargets.bid} AS DECIMAL(10,4)))`,
        totalOrders: sql`COALESCE(SUM(${productTargets.orders}), 0)`,
        totalSpend: sql`COALESCE(SUM(CAST(${productTargets.spend} AS DECIMAL(12,2))), 0)`,
        totalSales: sql`COALESCE(SUM(CAST(${productTargets.sales} AS DECIMAL(12,2))), 0)`
      }).from(productTargets).where(and(
        eq(productTargets.accountId, accountId),
        eq(productTargets.campaignId, campaignIdStr),
        gte(productTargets.orders, COLD_START_CONFIG.QUALITY_MIN_ORDERS),
        gt(productTargets.clicks, 0)
      ));
      if (!stats4 || Number(stats4.count) === 0) return null;
      const totalSpend = Number(stats4.totalSpend || 0);
      const totalSales = Number(stats4.totalSales || 0);
      const actualAcos = totalSales > 0 ? totalSpend / totalSales : 999;
      if (actualAcos > maxAcos * 2) return null;
      return {
        weightedAvgCpc: Math.max(0.02, Number(stats4.weightedAvgCpc || 0)),
        avgBid: Math.max(0.02, Number(stats4.avgBid || 0)),
        sampleCount: Number(stats4.count),
        totalOrders: Number(stats4.totalOrders),
        avgAcos: actualAcos,
        source: "campaign"
      };
    }
  } catch (err) {
    log56.warn(`[ColdStart] Campaign\u951A\u70B9\u67E5\u8BE2\u5F02\u5E38: ${err.message}`);
    return null;
  }
}
async function getBayesianSmoothedBid(accountId, target, targetAcos, coefficients) {
  try {
    const entityType = target.type === "keyword" ? "keyword" : "product_target";
    const subType = target.matchType || void 0;
    const entityPerformance = {
      impressions: target.impressions || 0,
      clicks: target.clicks || 0,
      spend: target.spend || 0,
      sales: target.sales || 0,
      orders: target.orders || 0
    };
    const bayesianEstimate = await estimateBid(
      accountId,
      entityType,
      target.currentBid,
      subType,
      entityPerformance
    );
    let transferPrior = null;
    if (target.campaignId) {
      try {
        transferPrior = await getTransferPriorForCampaign(accountId, target.campaignId);
      } catch {
      }
    }
    if (bayesianEstimate.success) {
      let finalBid = bayesianEstimate.estimatedBid;
      let source = bayesianEstimate.method;
      let confidence = bayesianEstimate.confidence;
      if (transferPrior && transferPrior.transferBid > 0) {
        const transferWeight = Math.min(0.35, transferPrior.transferWeight || 0.2);
        finalBid = blendTransferWithOwn(transferPrior.transferBid, finalBid, transferWeight);
        source += ` + \u8DE8\u54C1\u8FC1\u79FB(\u6743\u91CD${(transferWeight * 100).toFixed(0)}%)`;
        confidence = Math.min(0.7, confidence + 0.05);
        log56.info(`[ColdStart] Level 3\u878D\u5408\u8DE8\u54C1\u8FC1\u79FB: transferBid=$${transferPrior.transferBid.toFixed(2)}, weight=${(transferWeight * 100).toFixed(0)}%, blended=$${finalBid.toFixed(2)}`);
      }
      finalBid = finalBid * coefficients.combined;
      finalBid = Math.max(COLD_START_CONFIG.ANCHOR_BID_MIN, finalBid);
      finalBid = Math.round(finalBid * 100) / 100;
      log56.info(`[ColdStart] Level 3\u547D\u4E2D: \u8D1D\u53F6\u65AF\u5E73\u6ED1\u63A8\u65AD=$${bayesianEstimate.estimatedBid.toFixed(2)}, \u52A8\u6001\u7CFB\u6570=${coefficients.combined.toFixed(2)}, \u6700\u7EC8\u63A8\u8350=$${finalBid.toFixed(2)}`);
      return {
        recommendedBid: finalBid,
        strategy: transferPrior ? "transfer_prior" : "bayesian_smoothing",
        priorWeight: bayesianEstimate.priorWeight,
        confidence,
        reason: `\u8D1D\u53F6\u65AF\u5E73\u6ED1\u63A8\u65AD: ${source}`,
        suggestedBidInfo: {
          suggestedBid: bayesianEstimate.estimatedBid,
          rangeStart: bayesianEstimate.bidRangeLow,
          rangeEnd: bayesianEstimate.bidRangeHigh,
          source: "bayesian_smoothing"
        },
        coefficients
      };
    }
    return null;
  } catch (err) {
    log56.warn(`[ColdStart] \u8D1D\u53F6\u65AF\u5E73\u6ED1\u63A8\u65AD\u5F02\u5E38: ${err.message}`);
    return null;
  }
}
function calculateDynamicCoefficients(target, targetAcos) {
  const matchType = target.matchType?.toLowerCase() || "default";
  const matchTypeCoeff = MATCH_TYPE_COEFFICIENTS[matchType] || MATCH_TYPE_COEFFICIENTS["default"];
  let competitionCoeff;
  if (targetAcos < 0.15) {
    competitionCoeff = 0.85;
  } else if (targetAcos < 0.3) {
    competitionCoeff = 0.85 + (targetAcos - 0.15) / 0.15 * 0.15;
  } else if (targetAcos < 0.5) {
    competitionCoeff = 1 + (targetAcos - 0.3) / 0.2 * 0.1;
  } else {
    competitionCoeff = 1.15;
  }
  let explorationCoeff = 1;
  if (target.createdAt) {
    const createdDate = new Date(target.createdAt);
    const daysSinceCreation = (Date.now() - createdDate.getTime()) / (1e3 * 60 * 60 * 24);
    if (daysSinceCreation <= COLD_START_CONFIG.EXPLORATION_BOOST_DAYS) {
      explorationCoeff = 1 + COLD_START_CONFIG.EXPLORATION_BOOST;
    }
  }
  const combined = matchTypeCoeff * competitionCoeff * explorationCoeff;
  return {
    matchType: Math.round(matchTypeCoeff * 100) / 100,
    competition: Math.round(competitionCoeff * 100) / 100,
    exploration: Math.round(explorationCoeff * 100) / 100,
    combined: Math.round(combined * 100) / 100
  };
}
function calculateAnchorBid(anchor, coefficients, target) {
  let bid = anchor.weightedAvgCpc * coefficients.combined;
  bid = Math.max(COLD_START_CONFIG.ANCHOR_BID_MIN, bid);
  if (target.currentBid > 0.05) {
    bid = Math.min(bid, target.currentBid * 2);
  }
  return Math.round(bid * 100) / 100;
}
function calculateConfidence(anchor, source) {
  const sourceBase = source === "adgroup" ? 0.75 : 0.6;
  const sampleBonus = Math.min(0.1, anchor.sampleCount * 0.02);
  const orderBonus = Math.min(0.05, anchor.totalOrders * 5e-3);
  return Math.min(0.85, sourceBase + sampleBonus + orderBonus);
}
function buildResult(recommendedBid, strategy, confidence, anchor, coefficients, target, reason) {
  return {
    recommendedBid,
    strategy,
    priorWeight: anchor.source === "adgroup" ? 0.8 : 0.65,
    confidence,
    reason,
    suggestedBidInfo: {
      suggestedBid: anchor.weightedAvgCpc,
      rangeStart: anchor.weightedAvgCpc * 0.7,
      rangeEnd: anchor.weightedAvgCpc * 1.3,
      source: `${anchor.source}_anchor`
    },
    coefficients
  };
}
var log56, COLD_START_CONFIG, MATCH_TYPE_COEFFICIENTS;
var init_suggestedBidColdStartEngine = __esm({
  "server/optimization/suggestedBidColdStartEngine.ts"() {
    "use strict";
    init_db2();
    init_schema2();
    init_drizzle_orm();
    init_logger();
    init_bayesianBidSmoothingEngine();
    init_crossProductTransferEngine();
    log56 = createModuleLogger("ColdStartBid");
    COLD_START_CONFIG = {
      /** 冷启动期定义：创建后多少天内视为冷启动 */
      COLD_START_PERIOD_DAYS: 14,
      /** 数据稀疏阈值：点击数低于此值视为数据不足 */
      DATA_SPARSE_CLICKS_THRESHOLD: 5,
      /** 数据稀疏阈值：曝光数低于此值视为零数据 */
      DATA_SPARSE_IMPRESSIONS_THRESHOLD: 50,
      /** 同组优质词最少需要多少个才构成有效锚点 */
      MIN_ANCHOR_SAMPLES_ADGROUP: 1,
      /** 同活动优质词最少需要多少个才构成有效锚点 */
      MIN_ANCHOR_SAMPLES_CAMPAIGN: 2,
      /** 优质词定义：近30天至少出多少单 */
      QUALITY_MIN_ORDERS: 2,
      /** 优质词定义：ACoS不超过目标ACoS的多少倍 */
      QUALITY_ACOS_MULTIPLIER: 1.5,
      /** 锚点CPC的安全上限：不超过maxBid的多少 */
      ANCHOR_BID_MAX_RATIO: 0.7,
      /** 锚点CPC的安全下限 */
      ANCHOR_BID_MIN: 0.1,
      /** 新词探索加成（冷启动前7天） */
      EXPLORATION_BOOST: 0.05,
      /** 探索加成的天数 */
      EXPLORATION_BOOST_DAYS: 7
    };
    MATCH_TYPE_COEFFICIENTS = {
      "exact": 1.1,
      // 精确匹配：竞争更激烈，需要稍高出价
      "phrase": 1,
      // 词组匹配：基准系数
      "broad": 0.85,
      // 广泛匹配：流量更泛，出价可以更低
      "auto": 0.8,
      // 自动广告：系统匹配，保守出价
      "targeting": 0.9,
      // 商品定向：介于精确和广泛之间
      "default": 0.9
      // 默认
    };
    __name(isInColdStartPeriod, "isInColdStartPeriod");
    __name(getColdStartBidOverride, "getColdStartBidOverride");
    __name(getAdGroupAnchorCpc, "getAdGroupAnchorCpc");
    __name(getCampaignAnchorCpc, "getCampaignAnchorCpc");
    __name(getBayesianSmoothedBid, "getBayesianSmoothedBid");
    __name(calculateDynamicCoefficients, "calculateDynamicCoefficients");
    __name(calculateAnchorBid, "calculateAnchorBid");
    __name(calculateConfidence, "calculateConfidence");
    __name(buildResult, "buildResult");
  }
});

