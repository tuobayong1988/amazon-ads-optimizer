// Extracted from production dist/index.js
// Original module: server/optimization/bidOptimizer/types.ts
// Lines: 39

var DEFAULT_MAX_BID_CPC, DEFAULT_MIN_BID, MAX_BID_CHANGE_PERCENT, CPC_BID_RATIO, DEFAULT_CTR_FALLBACK, ASP_SENSITIVITY_CONFIG, BAYESIAN_CONFIDENCE, DATA_SUFFICIENCY_THRESHOLDS, STRATEGY_DATA_THRESHOLDS;
var init_types = __esm({
  "server/optimization/bidOptimizer/types.ts"() {
    "use strict";
    DEFAULT_MAX_BID_CPC = 2;
    DEFAULT_MIN_BID = 0.02;
    MAX_BID_CHANGE_PERCENT = 0.15;
    CPC_BID_RATIO = 0.7;
    DEFAULT_CTR_FALLBACK = 0.01;
    ASP_SENSITIVITY_CONFIG = {
      significantDropPercent: 0.1,
      significantRisePercent: 0.1,
      acosRelaxMultiplier: 1.3,
      acosStricterMultiplier: 0.85
    };
    BAYESIAN_CONFIDENCE = 20;
    DATA_SUFFICIENCY_THRESHOLDS = {
      minClicks: 15,
      minOrders: 3
    };
    STRATEGY_DATA_THRESHOLDS = {
      "aggressive-growth": { minClicks: 8, minOrders: 1 },
      "seasonal-boost": { minClicks: 8, minOrders: 1 },
      "market-expansion": { minClicks: 8, minOrders: 1 },
      "balanced": { minClicks: 15, minOrders: 3 },
      "maximize_sales": { minClicks: 12, minOrders: 2 },
      "target_acos": { minClicks: 15, minOrders: 3 },
      "target_roas": { minClicks: 15, minOrders: 3 },
      "profit-focused": { minClicks: 20, minOrders: 5 },
      "brand-defense": { minClicks: 20, minOrders: 5 },
      "decline-management": { minClicks: 20, minOrders: 5 },
      "inventory-clearance": { minClicks: 10, minOrders: 1 },
      "competitor-attack": { minClicks: 10, minOrders: 2 },
      "emergency-response": { minClicks: 10, minOrders: 2 },
      "seasonal-pattern": { minClicks: 12, minOrders: 2 }
    };
  }
});

