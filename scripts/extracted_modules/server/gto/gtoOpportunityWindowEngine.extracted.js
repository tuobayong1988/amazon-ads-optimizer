// Extracted from production dist/index.js
// Original module: server/gto/gtoOpportunityWindowEngine.ts
// Lines: 102

function detectOpportunityWindow(currentHour, currentCpc, currentImpressions, historicalSignals, competitionProfile) {
  const sameHourSignals = historicalSignals.filter((s) => s.hour === currentHour);
  if (sameHourSignals.length < 3) {
    return buildNoWindow("\u5386\u53F2\u6570\u636E\u4E0D\u8DB3\uFF0C\u65E0\u6CD5\u68C0\u6D4B\u673A\u4F1A\u7A97\u53E3");
  }
  const avgHistCpc = sameHourSignals.reduce((s, h) => s + h.avgCpc, 0) / sameHourSignals.length;
  const avgHistImpressions = sameHourSignals.reduce((s, h) => s + h.avgImpressions, 0) / sameHourSignals.length;
  const avgHistCompetition = sameHourSignals.reduce((s, h) => s + h.avgCompetition, 0) / sameHourSignals.length;
  const cpcDropRatio = avgHistCpc > 0 ? (avgHistCpc - currentCpc) / avgHistCpc : 0;
  const impressionSurgeRatio = avgHistImpressions > 0 ? currentImpressions / avgHistImpressions : 1;
  const competitionDrop = avgHistCompetition > 0 ? (avgHistCompetition - (competitionProfile?.competitionIntensity || avgHistCompetition)) / avgHistCompetition : 0;
  if (cpcDropRatio >= CPC_DROP_THRESHOLD && impressionSurgeRatio >= IMPRESSION_SURGE_THRESHOLD) {
    const confidence = Math.min(0.9, (cpcDropRatio + (impressionSurgeRatio - 1)) / 2);
    return {
      isOpen: true,
      windowType: "competitor_exhausted",
      strikeModifier: Math.min(MAX_STRIKE_MODIFIER, STRIKE_MODIFIER_EXHAUSTED),
      estimatedDurationHours: estimateWindowDuration(currentHour, competitionProfile),
      confidence,
      reasoning: `[\u7ADE\u54C1\u8017\u5C3D] CPC\u4E0B\u964D${(cpcDropRatio * 100).toFixed(0)}%(${avgHistCpc.toFixed(2)}\u2192${currentCpc.toFixed(2)})\uFF0C\u66DD\u5149\u4E0A\u5347${((impressionSurgeRatio - 1) * 100).toFixed(0)}%\uFF0C\u5224\u5B9A\u7ADE\u54C1\u9884\u7B97\u8017\u5C3D\uFF0C\u89E6\u53D1\u653B\u51FB\u6A21\u5F0F(+${((STRIKE_MODIFIER_EXHAUSTED - 1) * 100).toFixed(0)}%)`
    };
  }
  if (competitionDrop >= COMPETITION_DROP_THRESHOLD) {
    const confidence = Math.min(0.8, competitionDrop);
    return {
      isOpen: true,
      windowType: "low_competition_period",
      strikeModifier: Math.min(MAX_STRIKE_MODIFIER, STRIKE_MODIFIER_LOW_COMP),
      estimatedDurationHours: estimateWindowDuration(currentHour, competitionProfile),
      confidence,
      reasoning: `[\u4F4E\u7ADE\u4E89\u65F6\u6BB5] \u7ADE\u4E89\u6307\u6570\u4E0B\u964D${(competitionDrop * 100).toFixed(0)}%\uFF0C\u5F53\u524D\u4E3A\u4F4E\u7ADE\u4E89\u7A97\u53E3\uFF0C\u89E6\u53D1\u52A0\u6CE8(+${((STRIKE_MODIFIER_LOW_COMP - 1) * 100).toFixed(0)}%)`
    };
  }
  if (cpcDropRatio >= CPC_DROP_THRESHOLD) {
    const confidence = Math.min(0.6, cpcDropRatio);
    return {
      isOpen: true,
      windowType: "cpc_dip",
      strikeModifier: Math.min(MAX_STRIKE_MODIFIER, STRIKE_MODIFIER_CPC_DIP),
      estimatedDurationHours: 1,
      // CPC下降可能是短暂的
      confidence,
      reasoning: `[CPC\u4E0B\u964D] CPC\u4E0B\u964D${(cpcDropRatio * 100).toFixed(0)}%\uFF0C\u53EF\u80FD\u6709\u7ADE\u54C1\u9000\u51FA\uFF0C\u5C0F\u5E45\u52A0\u6CE8(+${((STRIKE_MODIFIER_CPC_DIP - 1) * 100).toFixed(0)}%)`
    };
  }
  if (competitionProfile && competitionProfile.confidence > 0.3) {
    const isWeakHour = competitionProfile.weakCompetitionHours.includes(currentHour);
    if (isWeakHour) {
      return {
        isOpen: true,
        windowType: "low_competition_period",
        strikeModifier: 1.1,
        // 基于历史模式的温和加注
        estimatedDurationHours: 2,
        confidence: competitionProfile.confidence * 0.7,
        reasoning: `[\u5386\u53F2\u5F31\u7ADE\u4E89\u65F6\u6BB5] \u5F53\u524D${currentHour}\u65F6\u4E3A\u5386\u53F2\u4F4E\u7ADE\u4E89\u65F6\u6BB5(${competitionProfile.dominantCompetitorType}\u578B\u7ADE\u54C1\u6A21\u5F0F)\uFF0C\u6E29\u548C\u52A0\u6CE8(+10%)`
      };
    }
  }
  return buildNoWindow("\u5F53\u524D\u65F6\u6BB5\u7ADE\u4E89\u6B63\u5E38\uFF0C\u65E0\u673A\u4F1A\u7A97\u53E3");
}
function estimateWindowDuration(currentHour, profile) {
  if (!profile || profile.confidence < 0.2) return 2;
  switch (profile.dominantCompetitorType) {
    case "nit":
      return 4;
    case "maniac":
      const hoursUntilMidnight = 24 - currentHour;
      return Math.min(8, hoursUntilMidnight);
    case "calling_station":
      return 1;
    default:
      return 2;
  }
}
function buildNoWindow(reason) {
  return {
    isOpen: false,
    windowType: "none",
    strikeModifier: 1,
    estimatedDurationHours: 0,
    confidence: 0,
    reasoning: reason
  };
}
var CPC_DROP_THRESHOLD, IMPRESSION_SURGE_THRESHOLD, COMPETITION_DROP_THRESHOLD, STRIKE_MODIFIER_EXHAUSTED, STRIKE_MODIFIER_LOW_COMP, STRIKE_MODIFIER_CPC_DIP, MAX_STRIKE_MODIFIER;
var init_gtoOpportunityWindowEngine = __esm({
  "server/gto/gtoOpportunityWindowEngine.ts"() {
    "use strict";
    CPC_DROP_THRESHOLD = 0.25;
    IMPRESSION_SURGE_THRESHOLD = 1.5;
    COMPETITION_DROP_THRESHOLD = 0.3;
    STRIKE_MODIFIER_EXHAUSTED = 1.35;
    STRIKE_MODIFIER_LOW_COMP = 1.2;
    STRIKE_MODIFIER_CPC_DIP = 1.15;
    MAX_STRIKE_MODIFIER = 1.4;
    __name(detectOpportunityWindow, "detectOpportunityWindow");
    __name(estimateWindowDuration, "estimateWindowDuration");
    __name(buildNoWindow, "buildNoWindow");
  }
});

