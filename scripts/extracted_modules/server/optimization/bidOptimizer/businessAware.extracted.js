// Extracted from production dist/index.js
// Original module: server/optimization/bidOptimizer/businessAware.ts
// Lines: 41

function calculateASPSensitivity(currentASP, historicalASP) {
  if (!currentASP || !historicalASP || historicalASP === 0) {
    return {
      aspChangePercent: 0,
      priceAction: "stable",
      acosAdjustmentMultiplier: 1,
      reason: "\u65E0ASP\u6570\u636E\uFF0C\u4FDD\u6301\u6807\u51C6ACoS\u76EE\u6807"
    };
  }
  const aspChangePercent = (currentASP - historicalASP) / historicalASP;
  if (aspChangePercent < -ASP_SENSITIVITY_CONFIG.significantDropPercent) {
    return {
      aspChangePercent: Math.round(aspChangePercent * 100) / 100,
      priceAction: "price_drop",
      acosAdjustmentMultiplier: ASP_SENSITIVITY_CONFIG.acosRelaxMultiplier,
      reason: `\u68C0\u6D4B\u5230\u964D\u4EF7/\u79D2\u6740\uFF1AASP\u4ECE$${historicalASP.toFixed(2)}\u964D\u81F3$${currentASP.toFixed(2)}(${(aspChangePercent * 100).toFixed(1)}%)\uFF0C\u4E34\u65F6\u653E\u5BBD ACoS\u76EE\u6807${Math.round((ASP_SENSITIVITY_CONFIG.acosRelaxMultiplier - 1) * 100)}%\u6293\u4F4F\u6D41\u91CF\u7EA2\u5229`
    };
  }
  if (aspChangePercent > ASP_SENSITIVITY_CONFIG.significantRisePercent) {
    return {
      aspChangePercent: Math.round(aspChangePercent * 100) / 100,
      priceAction: "price_rise",
      acosAdjustmentMultiplier: ASP_SENSITIVITY_CONFIG.acosStricterMultiplier,
      reason: `\u68C0\u6D4B\u5230\u6DA8\u4EF7\uFF1AASP\u4ECE$${historicalASP.toFixed(2)}\u5347\u81F3$${currentASP.toFixed(2)}(+${(aspChangePercent * 100).toFixed(1)}%)\uFF0C\u6536\u7D27ACoS\u76EE\u6807${Math.round((1 - ASP_SENSITIVITY_CONFIG.acosStricterMultiplier) * 100)}%\u4FDD\u62A4\u5229\u6DA6`
    };
  }
  return {
    aspChangePercent: Math.round(aspChangePercent * 100) / 100,
    priceAction: "stable",
    acosAdjustmentMultiplier: 1,
    reason: `ASP\u7A33\u5B9A($${currentASP.toFixed(2)}\uFF0C\u53D8\u52A8${(aspChangePercent * 100).toFixed(1)}%)\uFF0C\u4FDD\u6301\u6807\u51C6ACoS\u76EE\u6807`
  };
}
var init_businessAware = __esm({
  "server/optimization/bidOptimizer/businessAware.ts"() {
    "use strict";
    init_types();
    __name(calculateASPSensitivity, "calculateASPSensitivity");
  }
});

