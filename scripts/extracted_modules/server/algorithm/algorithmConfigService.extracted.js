// Extracted from production dist/index.js
// Original module: server/algorithm/algorithmConfigService.ts
// Lines: 213

function getAlgorithmConfig(strategyTemplateId) {
  if (!strategyTemplateId) return DEFAULT_ALGORITHM_CONFIG;
  return STRATEGY_ALGORITHM_CONFIGS[strategyTemplateId] || DEFAULT_ALGORITHM_CONFIG;
}
function getCascadeConfig(strategyTemplateId) {
  return getAlgorithmConfig(strategyTemplateId).cascade;
}
function getExplorationConfig(strategyTemplateId) {
  return getAlgorithmConfig(strategyTemplateId).exploration;
}
function calculateStrategyExplorationRate(strategyTemplateId, dataCount, hasRecentData) {
  const config2 = getExplorationConfig(strategyTemplateId);
  const dataMaturity = Math.min(1, dataCount / config2.maturityThreshold);
  const baseRate = config2.baseRateRange.max - dataMaturity * (config2.baseRateRange.max - config2.baseRateRange.min);
  const freshnessFactor = hasRecentData ? config2.dataFreshnessFactor.withData : config2.dataFreshnessFactor.withoutData;
  const explorationRate = Math.min(
    config2.maxExplorationRate,
    Math.max(config2.minExplorationRate, baseRate * freshnessFactor)
  );
  const detail = `\u7B56\u7565=${strategyTemplateId || "default"}, \u57FA\u7840\u7387=${(baseRate * 100).toFixed(0)}%, \u65B0\u9C9C\u5EA6=${freshnessFactor.toFixed(2)}, \u6700\u7EC8\u7387=${(explorationRate * 100).toFixed(0)}%, \u8303\u56F4=[${(config2.minExplorationRate * 100).toFixed(0)}%-${(config2.maxExplorationRate * 100).toFixed(0)}%]`;
  return { explorationRate, detail, dataMaturity };
}
var log47, STRATEGY_ALGORITHM_CONFIGS, DEFAULT_ALGORITHM_CONFIG;
var init_algorithmConfigService = __esm({
  "server/algorithm/algorithmConfigService.ts"() {
    "use strict";
    init_logger();
    log47 = createModuleLogger("AlgorithmConfig");
    STRATEGY_ALGORITHM_CONFIGS = {
      // 激进增长：高探索率，宽松融合阈值
      "aggressive-growth": {
        cascade: {
          fusionThreshold: 0.2,
          // 20%分差即融合，更积极地尝试多算法
          enabled: true,
          maxFusionAlgorithms: 2,
          consensusBonus: { highThreshold: 0.1, highBonus: 0.1, mediumThreshold: 0.2, mediumBonus: 0.05 }
        },
        exploration: {
          baseRateRange: { min: 0.4, max: 0.65 },
          // 高探索率
          dataFreshnessFactor: { withData: 1.2, withoutData: 0.85 },
          maturityThreshold: 40,
          rotationCycleMinutes: 20,
          // 更频繁轮转
          maxExplorationRate: 0.7,
          minExplorationRate: 0.35
        }
      },
      // 平衡增长：中等探索率，标准融合阈值
      "balanced": {
        cascade: {
          fusionThreshold: 0.15,
          enabled: true,
          maxFusionAlgorithms: 2,
          consensusBonus: { highThreshold: 0.1, highBonus: 0.1, mediumThreshold: 0.2, mediumBonus: 0.05 }
        },
        exploration: {
          baseRateRange: { min: 0.35, max: 0.55 },
          dataFreshnessFactor: { withData: 1.15, withoutData: 0.85 },
          maturityThreshold: 30,
          rotationCycleMinutes: 30,
          maxExplorationRate: 0.6,
          minExplorationRate: 0.3
        }
      },
      // 利润保护：低探索率，严格融合阈值
      "profit-focused": {
        cascade: {
          fusionThreshold: 0.1,
          // 10%分差才融合，更保守
          enabled: true,
          maxFusionAlgorithms: 2,
          consensusBonus: { highThreshold: 0.08, highBonus: 0.12, mediumThreshold: 0.15, mediumBonus: 0.06 }
        },
        exploration: {
          baseRateRange: { min: 0.25, max: 0.45 },
          // 低探索率，优先利用已知最优
          dataFreshnessFactor: { withData: 1.1, withoutData: 0.9 },
          maturityThreshold: 20,
          rotationCycleMinutes: 45,
          // 更长轮转周期
          maxExplorationRate: 0.5,
          minExplorationRate: 0.2
        }
      },
      // 季节性推动：高探索率，宽松融合
      "seasonal-boost": {
        cascade: {
          fusionThreshold: 0.2,
          enabled: true,
          maxFusionAlgorithms: 2,
          consensusBonus: { highThreshold: 0.12, highBonus: 0.08, mediumThreshold: 0.25, mediumBonus: 0.04 }
        },
        exploration: {
          baseRateRange: { min: 0.4, max: 0.6 },
          dataFreshnessFactor: { withData: 1.2, withoutData: 0.8 },
          maturityThreshold: 25,
          rotationCycleMinutes: 20,
          maxExplorationRate: 0.65,
          minExplorationRate: 0.35
        }
      },
      // 品牌防御：低探索率，严格融合
      "brand-defense": {
        cascade: {
          fusionThreshold: 0.12,
          enabled: true,
          maxFusionAlgorithms: 2,
          consensusBonus: { highThreshold: 0.08, highBonus: 0.12, mediumThreshold: 0.15, mediumBonus: 0.06 }
        },
        exploration: {
          baseRateRange: { min: 0.25, max: 0.45 },
          dataFreshnessFactor: { withData: 1.1, withoutData: 0.9 },
          maturityThreshold: 25,
          rotationCycleMinutes: 40,
          maxExplorationRate: 0.5,
          minExplorationRate: 0.2
        }
      },
      // 清仓策略：最高探索率，最宽松融合
      "inventory-clearance": {
        cascade: {
          fusionThreshold: 0.25,
          enabled: true,
          maxFusionAlgorithms: 2,
          consensusBonus: { highThreshold: 0.15, highBonus: 0.08, mediumThreshold: 0.3, mediumBonus: 0.04 }
        },
        exploration: {
          baseRateRange: { min: 0.45, max: 0.7 },
          dataFreshnessFactor: { withData: 1.25, withoutData: 0.8 },
          maturityThreshold: 15,
          rotationCycleMinutes: 15,
          maxExplorationRate: 0.75,
          minExplorationRate: 0.4
        }
      },
      // 竞争攻击：高探索率
      "competitor-attack": {
        cascade: {
          fusionThreshold: 0.2,
          enabled: true,
          maxFusionAlgorithms: 2,
          consensusBonus: { highThreshold: 0.1, highBonus: 0.1, mediumThreshold: 0.2, mediumBonus: 0.05 }
        },
        exploration: {
          baseRateRange: { min: 0.4, max: 0.65 },
          dataFreshnessFactor: { withData: 1.2, withoutData: 0.85 },
          maturityThreshold: 30,
          rotationCycleMinutes: 20,
          maxExplorationRate: 0.7,
          minExplorationRate: 0.35
        }
      },
      // 下滑管理：最低探索率，最严格融合
      "decline-management": {
        cascade: {
          fusionThreshold: 0.08,
          enabled: true,
          maxFusionAlgorithms: 2,
          consensusBonus: { highThreshold: 0.05, highBonus: 0.15, mediumThreshold: 0.1, mediumBonus: 0.08 }
        },
        exploration: {
          baseRateRange: { min: 0.2, max: 0.35 },
          dataFreshnessFactor: { withData: 1.05, withoutData: 0.95 },
          maturityThreshold: 15,
          rotationCycleMinutes: 60,
          maxExplorationRate: 0.4,
          minExplorationRate: 0.15
        }
      },
      // 紧急响应：最低探索率，禁用融合
      "emergency-response": {
        cascade: {
          fusionThreshold: 0.05,
          enabled: false,
          // 紧急响应时禁用融合，使用最可靠的单一算法
          maxFusionAlgorithms: 1,
          consensusBonus: { highThreshold: 0.05, highBonus: 0.15, mediumThreshold: 0.1, mediumBonus: 0.08 }
        },
        exploration: {
          baseRateRange: { min: 0.15, max: 0.25 },
          dataFreshnessFactor: { withData: 1.05, withoutData: 0.95 },
          maturityThreshold: 10,
          rotationCycleMinutes: 120,
          maxExplorationRate: 0.3,
          minExplorationRate: 0.1
        }
      }
    };
    DEFAULT_ALGORITHM_CONFIG = {
      cascade: {
        fusionThreshold: 0.15,
        enabled: true,
        maxFusionAlgorithms: 2,
        consensusBonus: { highThreshold: 0.1, highBonus: 0.1, mediumThreshold: 0.2, mediumBonus: 0.05 }
      },
      exploration: {
        baseRateRange: { min: 0.35, max: 0.6 },
        dataFreshnessFactor: { withData: 1.15, withoutData: 0.85 },
        maturityThreshold: 30,
        rotationCycleMinutes: 30,
        maxExplorationRate: 0.65,
        minExplorationRate: 0.3
      }
    };
    __name(getAlgorithmConfig, "getAlgorithmConfig");
    __name(getCascadeConfig, "getCascadeConfig");
    __name(getExplorationConfig, "getExplorationConfig");
    __name(calculateStrategyExplorationRate, "calculateStrategyExplorationRate");
  }
});

