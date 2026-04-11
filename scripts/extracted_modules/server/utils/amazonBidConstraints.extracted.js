// Extracted from production dist/index.js
// Original module: server/utils/amazonBidConstraints.ts
// Lines: 204

function getAdTypeKey(campaignType, costType = "cpc", adFormat) {
  const ct = (costType || "cpc").toLowerCase();
  if (campaignType === "sp_auto" || campaignType === "sp_manual") {
    return "sp_cpc";
  }
  if (campaignType === "sb") {
    if (ct === "vcpm") return "sb_vcpm";
    const fmt = (adFormat || "").toLowerCase();
    if (fmt === "video" || fmt === "brandvideo") {
      return "sbv_cpc";
    }
    return "sb_cpc";
  }
  if (campaignType === "sd") {
    if (ct === "vcpm") return "sd_vcpm";
    return "sd_cpc";
  }
  return "sp_cpc";
}
function getBidConstraint(campaignType, marketplace = "US", costType = "cpc", adFormat) {
  const mkt = (marketplace || "US").toUpperCase();
  const adTypeKey = getAdTypeKey(campaignType, costType, adFormat);
  const mktConstraints = BID_CONSTRAINTS[mkt];
  if (mktConstraints && mktConstraints[adTypeKey]) {
    return mktConstraints[adTypeKey];
  }
  const usConstraints = BID_CONSTRAINTS["US"];
  if (usConstraints[adTypeKey]) {
    return usConstraints[adTypeKey];
  }
  return { minBid: 0.02, maxBid: 1e3 };
}
function clampBidToConstraint(bid, campaignType, marketplace = "US", costType = "cpc", adFormat) {
  const constraint = getBidConstraint(campaignType, marketplace, costType, adFormat);
  const adTypeKey = getAdTypeKey(campaignType, costType, adFormat);
  let clampedBid = bid;
  let wasAdjusted = false;
  if (bid < constraint.minBid) {
    clampedBid = constraint.minBid;
    wasAdjusted = true;
  } else if (bid > constraint.maxBid) {
    clampedBid = constraint.maxBid;
    wasAdjusted = true;
  }
  clampedBid = Math.round(clampedBid * 100) / 100;
  return { clampedBid, wasAdjusted, constraint, adTypeKey };
}
var BID_CONSTRAINTS;
var init_amazonBidConstraints = __esm({
  "server/utils/amazonBidConstraints.ts"() {
    "use strict";
    BID_CONSTRAINTS = {
      US: {
        sp_cpc: { minBid: 0.02, maxBid: 1e3 },
        sb_cpc: { minBid: 0.1, maxBid: 49 },
        sbv_cpc: { minBid: 0.25, maxBid: 49 },
        sd_cpc: { minBid: 0.02, maxBid: 1e3 },
        sd_vcpm: { minBid: 1, maxBid: 1e3 },
        sb_vcpm: { minBid: 1, maxBid: 1e3 }
        // SB BIS vCPM
      },
      CA: {
        sp_cpc: { minBid: 0.02, maxBid: 1e3 },
        sb_cpc: { minBid: 0.1, maxBid: 49 },
        sbv_cpc: { minBid: 0.15, maxBid: 49 },
        sd_cpc: { minBid: 0.02, maxBid: 1e3 },
        sd_vcpm: { minBid: 1, maxBid: 1e3 },
        sb_vcpm: { minBid: 1, maxBid: 1e3 }
      },
      MX: {
        sp_cpc: { minBid: 0.1, maxBid: 2e4 },
        sb_cpc: { minBid: 0.1, maxBid: 2e4 },
        sbv_cpc: { minBid: 0.15, maxBid: 2e4 },
        sd_cpc: { minBid: 0.1, maxBid: 2e4 },
        sd_vcpm: { minBid: 5, maxBid: 2e4 },
        sb_vcpm: { minBid: 5, maxBid: 2e4 }
      },
      UK: {
        sp_cpc: { minBid: 0.02, maxBid: 1e3 },
        sb_cpc: { minBid: 0.1, maxBid: 31 },
        sbv_cpc: { minBid: 0.15, maxBid: 31 },
        sd_cpc: { minBid: 0.02, maxBid: 1e3 },
        sd_vcpm: { minBid: 1, maxBid: 1e3 },
        sb_vcpm: { minBid: 1, maxBid: 1e3 }
      },
      DE: {
        sp_cpc: { minBid: 0.02, maxBid: 1e3 },
        sb_cpc: { minBid: 0.1, maxBid: 39 },
        sbv_cpc: { minBid: 0.15, maxBid: 39 },
        sd_cpc: { minBid: 0.02, maxBid: 1e3 },
        sd_vcpm: { minBid: 1, maxBid: 1e3 },
        sb_vcpm: { minBid: 1, maxBid: 1e3 }
      },
      FR: {
        sp_cpc: { minBid: 0.02, maxBid: 1e3 },
        sb_cpc: { minBid: 0.1, maxBid: 39 },
        sbv_cpc: { minBid: 0.15, maxBid: 39 },
        sd_cpc: { minBid: 0.02, maxBid: 1e3 },
        sd_vcpm: { minBid: 1, maxBid: 1e3 },
        sb_vcpm: { minBid: 1, maxBid: 1e3 }
      },
      ES: {
        sp_cpc: { minBid: 0.02, maxBid: 1e3 },
        sb_cpc: { minBid: 0.1, maxBid: 39 },
        sbv_cpc: { minBid: 0.15, maxBid: 39 },
        sd_cpc: { minBid: 0.02, maxBid: 1e3 },
        sd_vcpm: { minBid: 1, maxBid: 1e3 },
        sb_vcpm: { minBid: 1, maxBid: 1e3 }
      },
      IT: {
        sp_cpc: { minBid: 0.02, maxBid: 1e3 },
        sb_cpc: { minBid: 0.1, maxBid: 39 },
        sbv_cpc: { minBid: 0.15, maxBid: 39 },
        sd_cpc: { minBid: 0.02, maxBid: 1e3 },
        sd_vcpm: { minBid: 1, maxBid: 1e3 },
        sb_vcpm: { minBid: 1, maxBid: 1e3 }
      },
      NL: {
        sp_cpc: { minBid: 0.02, maxBid: 1e3 },
        sb_cpc: { minBid: 0.1, maxBid: 39 },
        sbv_cpc: { minBid: 0.15, maxBid: 39 },
        sd_cpc: { minBid: 0.02, maxBid: 1e3 },
        sd_vcpm: { minBid: 1, maxBid: 1e3 },
        sb_vcpm: { minBid: 1, maxBid: 1e3 }
      },
      JP: {
        sp_cpc: { minBid: 2, maxBid: 1e5 },
        sb_cpc: { minBid: 10, maxBid: 7760 },
        sbv_cpc: { minBid: 15, maxBid: 7760 },
        sd_cpc: { minBid: 2, maxBid: 1e5 },
        sd_vcpm: { minBid: 100, maxBid: 1e5 },
        sb_vcpm: { minBid: 100, maxBid: 1e5 }
      },
      AU: {
        sp_cpc: { minBid: 0.02, maxBid: 1410 },
        sb_cpc: { minBid: 0.1, maxBid: 70 },
        sbv_cpc: { minBid: 0.15, maxBid: 70 },
        sd_cpc: { minBid: 0.2, maxBid: 1e3 },
        sd_vcpm: { minBid: 1, maxBid: 1e3 },
        sb_vcpm: { minBid: 1, maxBid: 1e3 }
      },
      AE: {
        sp_cpc: { minBid: 0.24, maxBid: 184 },
        sb_cpc: { minBid: 0.4, maxBid: 184 },
        sbv_cpc: { minBid: 0.6, maxBid: 184 },
        sd_cpc: { minBid: 0.2, maxBid: 3670 },
        sd_vcpm: { minBid: 1, maxBid: 3670 },
        sb_vcpm: { minBid: 1, maxBid: 3670 }
      },
      BR: {
        sp_cpc: { minBid: 0.07, maxBid: 3700 },
        sb_cpc: { minBid: 0.53, maxBid: 200 },
        sbv_cpc: { minBid: 0.8, maxBid: 25e3 },
        sd_cpc: { minBid: 0.07, maxBid: 3700 },
        sd_vcpm: { minBid: 2, maxBid: 3700 },
        sb_vcpm: { minBid: 2, maxBid: 3700 }
      },
      SG: {
        sp_cpc: { minBid: 0.02, maxBid: 1100 },
        sb_cpc: { minBid: 0.14, maxBid: 100 },
        sbv_cpc: { minBid: 0.2, maxBid: 1400 },
        sd_cpc: { minBid: 0.14, maxBid: 1410 },
        sd_vcpm: { minBid: 4, maxBid: 1410 },
        sb_vcpm: { minBid: 4, maxBid: 1410 }
      },
      SE: {
        sp_cpc: { minBid: 0.18, maxBid: 9300 },
        sb_cpc: { minBid: 0.9, maxBid: 500 },
        sbv_cpc: { minBid: 1.3, maxBid: 500 },
        sd_cpc: { minBid: 0.18, maxBid: 1e3 },
        sd_vcpm: { minBid: 1, maxBid: 1e3 },
        sb_vcpm: { minBid: 1, maxBid: 1e3 }
      },
      IN: {
        sp_cpc: { minBid: 1, maxBid: 5e3 },
        sb_cpc: { minBid: 1, maxBid: 500 },
        sbv_cpc: { minBid: 1.5, maxBid: 500 },
        sd_cpc: { minBid: 1, maxBid: 5e3 },
        sd_vcpm: { minBid: 4, maxBid: 5e3 },
        sb_vcpm: { minBid: 4, maxBid: 5e3 }
      },
      PL: {
        sp_cpc: { minBid: 0.04, maxBid: 2e3 },
        sb_cpc: { minBid: 0.2, maxBid: 200 },
        sbv_cpc: { minBid: 0.3, maxBid: 200 },
        sd_cpc: { minBid: 0.02, maxBid: 1e3 },
        sd_vcpm: { minBid: 1, maxBid: 1e3 },
        sb_vcpm: { minBid: 1, maxBid: 1e3 }
      },
      SA: {
        sp_cpc: { minBid: 0.1, maxBid: 3670 },
        sb_cpc: { minBid: 0.4, maxBid: 184 },
        sbv_cpc: { minBid: 0.6, maxBid: 184 },
        sd_cpc: { minBid: 0.1, maxBid: 3670 },
        sd_vcpm: { minBid: 4, maxBid: 3670 },
        sb_vcpm: { minBid: 4, maxBid: 3670 }
      }
    };
    __name(getAdTypeKey, "getAdTypeKey");
    __name(getBidConstraint, "getBidConstraint");
    __name(clampBidToConstraint, "clampBidToConstraint");
  }
});

