// Extracted from production dist/index.js
// Original module: server/algorithm/algorithmUtils.ts
// Lines: 294

function calculateDynamicElasticity(historicalData, category, halfLifeDays = 14, marketplace) {
  const sanitizedData = historicalData.filter((record2) => {
    const mkt = record2.marketplace || marketplace || "US";
    const holidayConfig = getHolidayConfig(record2.timestamp, mkt);
    if (holidayConfig && holidayConfig.priority === "high") {
      return false;
    }
    if (record2.impressions !== void 0 && record2.dailyAvgImpressions !== void 0) {
      if (record2.dailyAvgImpressions > 0 && record2.impressions < record2.dailyAvgImpressions * 0.1) {
        return false;
      }
    }
    return true;
  });
  const validRecords = sanitizedData.filter((record2) => {
    const bidChangePercent = Math.abs((record2.newBid - record2.oldBid) / record2.oldBid);
    return bidChangePercent >= 0.05 && record2.oldClicks > 0;
  });
  if (validRecords.length < 5) {
    const categoryElasticity = category ? CATEGORY_ELASTICITY[category] || CATEGORY_ELASTICITY["default"] : CATEGORY_ELASTICITY["default"];
    return {
      elasticity: categoryElasticity,
      confidence: 0.3,
      sampleSize: validRecords.length,
      method: category ? "category_default" : "global_default"
    };
  }
  const now = /* @__PURE__ */ new Date();
  const regressionData = [];
  for (const record2 of validRecords) {
    const bidChangePercent = (record2.newBid - record2.oldBid) / record2.oldBid;
    const clickChangePercent = (record2.newClicks - record2.oldClicks) / record2.oldClicks;
    if (bidChangePercent === 0) continue;
    const daysDiff = (now.getTime() - record2.timestamp.getTime()) / (1e3 * 60 * 60 * 24);
    const timeWeight = Math.pow(0.5, daysDiff / halfLifeDays);
    const pointElasticity = clickChangePercent / bidChangePercent;
    if (pointElasticity >= 0 && pointElasticity <= 3) {
      regressionData.push({ x: bidChangePercent, y: clickChangePercent, weight: timeWeight });
    }
  }
  if (regressionData.length < 3) {
    const categoryElasticity = category ? CATEGORY_ELASTICITY[category] || CATEGORY_ELASTICITY["default"] : CATEGORY_ELASTICITY["default"];
    return {
      elasticity: categoryElasticity,
      confidence: 0.4,
      sampleSize: regressionData.length,
      method: "category_default"
    };
  }
  let sumWXY = 0;
  let sumWXX = 0;
  let totalWeight = 0;
  for (const point of regressionData) {
    sumWXY += point.weight * point.x * point.y;
    sumWXX += point.weight * point.x * point.x;
    totalWeight += point.weight;
  }
  const olsElasticity = sumWXX > 0 ? sumWXY / sumWXX : CATEGORY_ELASTICITY["default"];
  const clampedElasticity = Math.max(0.1, Math.min(2.5, olsElasticity));
  const sampleConfidence = Math.min(1, regressionData.length / 20);
  let ssRes = 0;
  let ssTot = 0;
  const weightedMeanY = regressionData.reduce((sum2, p) => sum2 + p.weight * p.y, 0) / totalWeight;
  for (const point of regressionData) {
    const predicted = clampedElasticity * point.x;
    ssRes += point.weight * Math.pow(point.y - predicted, 2);
    ssTot += point.weight * Math.pow(point.y - weightedMeanY, 2);
  }
  const rSquared = ssTot > 0 ? Math.max(0, 1 - ssRes / ssTot) : 0;
  if (rSquared < 0.3) {
    const categoryElasticity = category ? CATEGORY_ELASTICITY[category] || CATEGORY_ELASTICITY["default"] : CATEGORY_ELASTICITY["default"];
    return {
      elasticity: categoryElasticity,
      confidence: Math.round(rSquared * 100) / 100,
      sampleSize: regressionData.length,
      method: "category_default"
    };
  }
  const confidence = sampleConfidence * 0.4 + rSquared * 0.6;
  return {
    elasticity: Math.round(clampedElasticity * 100) / 100,
    confidence: Math.round(confidence * 100) / 100,
    sampleSize: regressionData.length,
    method: "historical"
  };
}
function getElasticity(historicalData, category, minConfidence = 0.5) {
  const result = calculateDynamicElasticity(historicalData, category);
  if (result.confidence < minConfidence && result.method === "historical") {
    const categoryElasticity = category ? CATEGORY_ELASTICITY[category] || CATEGORY_ELASTICITY["default"] : CATEGORY_ELASTICITY["default"];
    const weight = result.confidence / minConfidence;
    return Math.round((result.elasticity * weight + categoryElasticity * (1 - weight)) * 100) / 100;
  }
  return result.elasticity;
}
function getLocalHour(utcTime, marketplace) {
  const timezone = MARKETPLACE_TIMEZONES2[marketplace] || "UTC";
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", hour12: false });
  return parseInt(formatter.format(utcTime));
}
function getLocalDayOfWeek(utcTime, marketplace) {
  const timezone = MARKETPLACE_TIMEZONES2[marketplace] || "UTC";
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" });
  const dayMap = { "Sun": 0, "Mon": 1, "Tue": 2, "Wed": 3, "Thu": 4, "Fri": 5, "Sat": 6 };
  return dayMap[formatter.format(utcTime)] ?? 0;
}
function isNewKeyword(createdAt, totalClicks, totalImpressions, explorationDays = 7) {
  const daysSinceCreation = ((/* @__PURE__ */ new Date()).getTime() - createdAt.getTime()) / (1e3 * 60 * 60 * 24);
  return daysSinceCreation <= explorationDays || totalClicks < 10 && totalImpressions < 500;
}
function getExplorationStrategy(createdAt, totalClicks, totalImpressions, currentBid, suggestedBidRange, explorationDays = 7) {
  const daysSinceCreation = ((/* @__PURE__ */ new Date()).getTime() - createdAt.getTime()) / (1e3 * 60 * 60 * 24);
  const isNew = isNewKeyword(createdAt, totalClicks, totalImpressions, explorationDays);
  if (!isNew) return { isNewKeyword: false, explorationDaysRemaining: 0, suggestedBid: currentBid, strategy: "exploit" };
  const daysRemaining = Math.max(0, explorationDays - daysSinceCreation);
  let suggestedBid = currentBid;
  let strategy = "explore";
  if (suggestedBidRange) {
    const bidFloor = suggestedBidRange.low * 0.5;
    const bidCeiling = suggestedBidRange.high * 1.5;
    if (daysSinceCreation <= explorationDays * 0.3) {
      suggestedBid = suggestedBidRange.high;
    } else if (daysSinceCreation <= explorationDays * 0.5) {
      suggestedBid = suggestedBidRange.median;
    } else if (totalClicks >= 5) {
      strategy = "transition";
      const ctr = totalImpressions > 0 ? totalClicks / totalImpressions : 0;
      if (ctr > 0.01) {
        suggestedBid = suggestedBidRange.median * 1.1;
      } else if (ctr > 5e-3) {
        suggestedBid = suggestedBidRange.median;
      } else {
        suggestedBid = suggestedBidRange.low;
      }
    } else {
      suggestedBid = suggestedBidRange.median;
    }
    suggestedBid = Math.max(bidFloor, Math.min(bidCeiling, suggestedBid));
  } else {
    suggestedBid = currentBid * 1.2;
  }
  return { isNewKeyword: true, explorationDaysRemaining: Math.round(daysRemaining * 10) / 10, suggestedBid: Math.round(suggestedBid * 100) / 100, strategy };
}
function isProtectedKeyword(keyword, brandTerms, coreProductTerms = []) {
  const normalizedKeyword = keyword.toLowerCase().trim();
  for (const brand of brandTerms) if (normalizedKeyword.includes(brand.toLowerCase())) return true;
  for (const term of coreProductTerms) if (normalizedKeyword.includes(term.toLowerCase())) return true;
  return false;
}
function getHolidayConfig(date6, marketplace) {
  const holidays = MARKETPLACE_HOLIDAYS[marketplace] || MARKETPLACE_HOLIDAYS["US"];
  const dateStr = date6.toISOString().split("T")[0];
  for (const holiday of holidays) {
    if (holiday.date.includes("~")) {
      const [startStr, endStr] = holiday.date.split("~");
      if (dateStr >= startStr && dateStr <= endStr) {
        return holiday;
      }
    } else if (holiday.date === dateStr) {
      return holiday;
    }
  }
  return null;
}
async function getAccountMarketplace(accountId) {
  const cached2 = marketplaceCache.get(accountId);
  if (cached2 && Date.now() < cached2.expiresAt) return cached2.value;
  const db = await Promise.resolve().then(() => (init_db2(), db_exports));
  const account = await db.getAdAccountById(accountId);
  const marketplace = account?.marketplace || "US";
  marketplaceCache.set(accountId, { value: marketplace, expiresAt: Date.now() + MARKETPLACE_CACHE_TTL_MS });
  return marketplace;
}
var MARKETPLACE_TIMEZONES2, CATEGORY_ELASTICITY, MARKETPLACE_HOLIDAYS, MARKETPLACE_CACHE_TTL_MS, MARKETPLACE_CACHE_MAX_SIZE, marketplaceCache, _marketplaceCacheCleanupTimer;
var init_algorithmUtils = __esm({
  "server/algorithm/algorithmUtils.ts"() {
    "use strict";
    MARKETPLACE_TIMEZONES2 = {
      "US": "America/Los_Angeles",
      "CA": "America/Toronto",
      "MX": "America/Mexico_City",
      "BR": "America/Sao_Paulo",
      "UK": "Europe/London",
      "DE": "Europe/Berlin",
      "FR": "Europe/Paris",
      "IT": "Europe/Rome",
      "ES": "Europe/Madrid",
      "JP": "Asia/Tokyo",
      "AU": "Australia/Sydney",
      "SG": "Asia/Singapore",
      "IN": "Asia/Kolkata",
      "AE": "Asia/Dubai"
    };
    CATEGORY_ELASTICITY = {
      "electronics": 1.2,
      "computers": 1.1,
      "cell_phones": 1.15,
      "video_games": 1,
      "home_kitchen": 0.85,
      "sports_outdoors": 0.8,
      "toys_games": 0.9,
      "clothing": 0.75,
      "beauty": 0.7,
      "health": 0.65,
      "baby": 0.5,
      "pet_supplies": 0.55,
      "grocery": 0.4,
      "luxury": 0.3,
      "default": 0.8
    };
    __name(calculateDynamicElasticity, "calculateDynamicElasticity");
    __name(getElasticity, "getElasticity");
    __name(getLocalHour, "getLocalHour");
    __name(getLocalDayOfWeek, "getLocalDayOfWeek");
    __name(isNewKeyword, "isNewKeyword");
    __name(getExplorationStrategy, "getExplorationStrategy");
    __name(isProtectedKeyword, "isProtectedKeyword");
    MARKETPLACE_HOLIDAYS = {
      "US": [
        { name: "Prime Day", date: "2026-07-15~2026-07-16", bidMultiplier: 1.5, budgetMultiplier: 2, priority: "high" },
        { name: "Black Friday", date: "2026-11-27", bidMultiplier: 1.8, budgetMultiplier: 2.5, priority: "high" },
        { name: "Cyber Monday", date: "2026-11-30", bidMultiplier: 1.8, budgetMultiplier: 2.5, priority: "high" },
        { name: "Thanksgiving", date: "2026-11-26", bidMultiplier: 1.3, budgetMultiplier: 1.5, priority: "medium" },
        { name: "Christmas Eve", date: "2026-12-24", bidMultiplier: 1.2, budgetMultiplier: 1.3, priority: "medium" },
        { name: "Christmas", date: "2026-12-25", bidMultiplier: 0.8, budgetMultiplier: 0.8, priority: "low" },
        { name: "New Year Eve", date: "2026-12-31", bidMultiplier: 1.1, budgetMultiplier: 1.2, priority: "medium" },
        { name: "New Year", date: "2026-01-01", bidMultiplier: 0.9, budgetMultiplier: 1, priority: "low" },
        { name: "Valentine Day", date: "2026-02-14", bidMultiplier: 1.3, budgetMultiplier: 1.5, priority: "medium" },
        { name: "Easter", date: "2026-04-05", bidMultiplier: 1.2, budgetMultiplier: 1.3, priority: "medium" },
        { name: "Mother Day", date: "2026-05-10", bidMultiplier: 1.3, budgetMultiplier: 1.5, priority: "medium" },
        { name: "Father Day", date: "2026-06-21", bidMultiplier: 1.2, budgetMultiplier: 1.3, priority: "medium" },
        { name: "Independence Day", date: "2026-07-04", bidMultiplier: 1.2, budgetMultiplier: 1.3, priority: "medium" },
        { name: "Labor Day", date: "2026-09-07", bidMultiplier: 1.2, budgetMultiplier: 1.3, priority: "medium" },
        { name: "Halloween", date: "2026-10-31", bidMultiplier: 1.2, budgetMultiplier: 1.3, priority: "medium" }
      ],
      "UK": [
        { name: "Prime Day", date: "2026-07-15~2026-07-16", bidMultiplier: 1.5, budgetMultiplier: 2, priority: "high" },
        { name: "Black Friday", date: "2026-11-27", bidMultiplier: 1.8, budgetMultiplier: 2.5, priority: "high" },
        { name: "Boxing Day", date: "2026-12-26", bidMultiplier: 1.5, budgetMultiplier: 1.8, priority: "high" },
        { name: "Christmas", date: "2026-12-25", bidMultiplier: 0.7, budgetMultiplier: 0.7, priority: "low" }
      ],
      "DE": [
        { name: "Prime Day", date: "2026-07-15~2026-07-16", bidMultiplier: 1.5, budgetMultiplier: 2, priority: "high" },
        { name: "Black Friday", date: "2026-11-27", bidMultiplier: 1.8, budgetMultiplier: 2.5, priority: "high" },
        { name: "Christmas", date: "2026-12-25~2026-12-26", bidMultiplier: 0.7, budgetMultiplier: 0.7, priority: "low" }
      ],
      "JP": [
        { name: "Prime Day", date: "2026-07-15~2026-07-16", bidMultiplier: 1.5, budgetMultiplier: 2, priority: "high" },
        { name: "Black Friday", date: "2026-11-27", bidMultiplier: 1.5, budgetMultiplier: 2, priority: "high" },
        { name: "New Year", date: "2026-01-01~2026-01-03", bidMultiplier: 0.8, budgetMultiplier: 0.8, priority: "low" },
        { name: "Golden Week", date: "2026-04-29~2026-05-05", bidMultiplier: 1.3, budgetMultiplier: 1.5, priority: "medium" }
      ],
      "CA": [
        { name: "Prime Day", date: "2026-07-15~2026-07-16", bidMultiplier: 1.5, budgetMultiplier: 2, priority: "high" },
        { name: "Black Friday", date: "2026-11-27", bidMultiplier: 1.8, budgetMultiplier: 2.5, priority: "high" },
        { name: "Boxing Day", date: "2026-12-26", bidMultiplier: 1.5, budgetMultiplier: 1.8, priority: "high" }
      ],
      "MX": [
        { name: "Prime Day", date: "2026-07-15~2026-07-16", bidMultiplier: 1.5, budgetMultiplier: 2, priority: "high" },
        { name: "Buen Fin", date: "2026-11-13~2026-11-16", bidMultiplier: 1.8, budgetMultiplier: 2.5, priority: "high" },
        { name: "Hot Sale", date: "2026-05-25~2026-06-02", bidMultiplier: 1.5, budgetMultiplier: 2, priority: "high" }
      ],
      "AU": [
        { name: "Prime Day", date: "2026-07-15~2026-07-16", bidMultiplier: 1.5, budgetMultiplier: 2, priority: "high" },
        { name: "Black Friday", date: "2026-11-27", bidMultiplier: 1.8, budgetMultiplier: 2.5, priority: "high" },
        { name: "Boxing Day", date: "2026-12-26", bidMultiplier: 1.5, budgetMultiplier: 1.8, priority: "high" },
        { name: "Click Frenzy", date: "2026-11-10~2026-11-12", bidMultiplier: 1.5, budgetMultiplier: 1.8, priority: "high" }
      ]
    };
    __name(getHolidayConfig, "getHolidayConfig");
    MARKETPLACE_CACHE_TTL_MS = 30 * 60 * 1e3;
    MARKETPLACE_CACHE_MAX_SIZE = 500;
    marketplaceCache = /* @__PURE__ */ new Map();
    _marketplaceCacheCleanupTimer = setInterval(() => {
      const now = Date.now();
      let cleaned = 0;
      for (const [key, entry] of marketplaceCache.entries()) {
        if (now > entry.expiresAt) {
          marketplaceCache.delete(key);
          cleaned++;
        }
      }
      if (marketplaceCache.size > MARKETPLACE_CACHE_MAX_SIZE) {
        const entries = Array.from(marketplaceCache.entries()).sort((a, b) => a[1].expiresAt - b[1].expiresAt);
        const toRemove = entries.slice(0, marketplaceCache.size - MARKETPLACE_CACHE_MAX_SIZE);
        for (const [key] of toRemove) {
          marketplaceCache.delete(key);
        }
      }
    }, 10 * 60 * 1e3);
    __name(getAccountMarketplace, "getAccountMarketplace");
  }
});

