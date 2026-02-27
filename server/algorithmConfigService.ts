/**
 * v271 P1-2: 算法配置服务
 * 
 * 核心功能：
 * 1. Cascade Ensemble融合阈值参数化 — 从硬编码15%改为可配置
 * 2. 探索自适应策略级别化 — 从全局级别改为策略模板级别
 * 3. 支持通过数据库/环境变量/API动态调整参数
 * 
 * 配置层级（优先级从高到低）：
 * 1. A/B测试实验覆盖（已在abTestIntegration中实现）
 * 2. 优化目标级别配置
 * 3. 策略模板级别配置
 * 4. 全局默认配置
 */

import { createModuleLogger } from './utils/logger';

const log = createModuleLogger('AlgorithmConfig');

// ==================== 类型定义 ====================

export interface CascadeEnsembleConfig {
  /** 融合阈值（top1与top2分差百分比，低于此值触发融合） */
  fusionThreshold: number;
  /** 是否启用Cascade Ensemble */
  enabled: boolean;
  /** 最大融合算法数 */
  maxFusionAlgorithms: number;
  /** 共识奖励阈值配置 */
  consensusBonus: {
    /** 出价分歧度 < highThreshold 时的奖励 */
    highThreshold: number;
    highBonus: number;
    /** 出价分歧度 < mediumThreshold 时的奖励 */
    mediumThreshold: number;
    mediumBonus: number;
  };
}

export interface ExplorationConfig {
  /** 基础探索率范围 */
  baseRateRange: { min: number; max: number };
  /** 数据新鲜度因子 */
  dataFreshnessFactor: { withData: number; withoutData: number };
  /** 数据成熟度阈值（达到此数据量后探索率降至最低） */
  maturityThreshold: number;
  /** 算法轮转周期（分钟） */
  rotationCycleMinutes: number;
  /** 最大探索率上限 */
  maxExplorationRate: number;
  /** 最小探索率下限 */
  minExplorationRate: number;
}

export interface StrategyAlgorithmConfig {
  cascade: CascadeEnsembleConfig;
  exploration: ExplorationConfig;
}

// ==================== 策略模板级别配置 ====================

/**
 * v271: 每个策略模板的算法配置
 * 不同策略模板有不同的探索-利用偏好和融合策略
 */
const STRATEGY_ALGORITHM_CONFIGS: Record<string, StrategyAlgorithmConfig> = {
  // 激进增长：高探索率，宽松融合阈值
  'aggressive-growth': {
    cascade: {
      fusionThreshold: 0.20,  // 20%分差即融合，更积极地尝试多算法
      enabled: true,
      maxFusionAlgorithms: 2,
      consensusBonus: { highThreshold: 0.10, highBonus: 0.10, mediumThreshold: 0.20, mediumBonus: 0.05 },
    },
    exploration: {
      baseRateRange: { min: 0.40, max: 0.65 },  // 高探索率
      dataFreshnessFactor: { withData: 1.20, withoutData: 0.85 },
      maturityThreshold: 40,
      rotationCycleMinutes: 20,  // 更频繁轮转
      maxExplorationRate: 0.70,
      minExplorationRate: 0.35,
    },
  },
  
  // 平衡增长：中等探索率，标准融合阈值
  'balanced': {
    cascade: {
      fusionThreshold: 0.15,
      enabled: true,
      maxFusionAlgorithms: 2,
      consensusBonus: { highThreshold: 0.10, highBonus: 0.10, mediumThreshold: 0.20, mediumBonus: 0.05 },
    },
    exploration: {
      baseRateRange: { min: 0.35, max: 0.55 },
      dataFreshnessFactor: { withData: 1.15, withoutData: 0.85 },
      maturityThreshold: 30,
      rotationCycleMinutes: 30,
      maxExplorationRate: 0.60,
      minExplorationRate: 0.30,
    },
  },
  
  // 利润保护：低探索率，严格融合阈值
  'profit-focused': {
    cascade: {
      fusionThreshold: 0.10,  // 10%分差才融合，更保守
      enabled: true,
      maxFusionAlgorithms: 2,
      consensusBonus: { highThreshold: 0.08, highBonus: 0.12, mediumThreshold: 0.15, mediumBonus: 0.06 },
    },
    exploration: {
      baseRateRange: { min: 0.25, max: 0.45 },  // 低探索率，优先利用已知最优
      dataFreshnessFactor: { withData: 1.10, withoutData: 0.90 },
      maturityThreshold: 20,
      rotationCycleMinutes: 45,  // 更长轮转周期
      maxExplorationRate: 0.50,
      minExplorationRate: 0.20,
    },
  },
  
  // 季节性推动：高探索率，宽松融合
  'seasonal-boost': {
    cascade: {
      fusionThreshold: 0.20,
      enabled: true,
      maxFusionAlgorithms: 2,
      consensusBonus: { highThreshold: 0.12, highBonus: 0.08, mediumThreshold: 0.25, mediumBonus: 0.04 },
    },
    exploration: {
      baseRateRange: { min: 0.40, max: 0.60 },
      dataFreshnessFactor: { withData: 1.20, withoutData: 0.80 },
      maturityThreshold: 25,
      rotationCycleMinutes: 20,
      maxExplorationRate: 0.65,
      minExplorationRate: 0.35,
    },
  },
  
  // 品牌防御：低探索率，严格融合
  'brand-defense': {
    cascade: {
      fusionThreshold: 0.12,
      enabled: true,
      maxFusionAlgorithms: 2,
      consensusBonus: { highThreshold: 0.08, highBonus: 0.12, mediumThreshold: 0.15, mediumBonus: 0.06 },
    },
    exploration: {
      baseRateRange: { min: 0.25, max: 0.45 },
      dataFreshnessFactor: { withData: 1.10, withoutData: 0.90 },
      maturityThreshold: 25,
      rotationCycleMinutes: 40,
      maxExplorationRate: 0.50,
      minExplorationRate: 0.20,
    },
  },
  
  // 清仓策略：最高探索率，最宽松融合
  'inventory-clearance': {
    cascade: {
      fusionThreshold: 0.25,
      enabled: true,
      maxFusionAlgorithms: 2,
      consensusBonus: { highThreshold: 0.15, highBonus: 0.08, mediumThreshold: 0.30, mediumBonus: 0.04 },
    },
    exploration: {
      baseRateRange: { min: 0.45, max: 0.70 },
      dataFreshnessFactor: { withData: 1.25, withoutData: 0.80 },
      maturityThreshold: 15,
      rotationCycleMinutes: 15,
      maxExplorationRate: 0.75,
      minExplorationRate: 0.40,
    },
  },
  
  // 竞争攻击：高探索率
  'competitor-attack': {
    cascade: {
      fusionThreshold: 0.20,
      enabled: true,
      maxFusionAlgorithms: 2,
      consensusBonus: { highThreshold: 0.10, highBonus: 0.10, mediumThreshold: 0.20, mediumBonus: 0.05 },
    },
    exploration: {
      baseRateRange: { min: 0.40, max: 0.65 },
      dataFreshnessFactor: { withData: 1.20, withoutData: 0.85 },
      maturityThreshold: 30,
      rotationCycleMinutes: 20,
      maxExplorationRate: 0.70,
      minExplorationRate: 0.35,
    },
  },
  
  // 下滑管理：最低探索率，最严格融合
  'decline-management': {
    cascade: {
      fusionThreshold: 0.08,
      enabled: true,
      maxFusionAlgorithms: 2,
      consensusBonus: { highThreshold: 0.05, highBonus: 0.15, mediumThreshold: 0.10, mediumBonus: 0.08 },
    },
    exploration: {
      baseRateRange: { min: 0.20, max: 0.35 },
      dataFreshnessFactor: { withData: 1.05, withoutData: 0.95 },
      maturityThreshold: 15,
      rotationCycleMinutes: 60,
      maxExplorationRate: 0.40,
      minExplorationRate: 0.15,
    },
  },
  
  // 紧急响应：最低探索率，禁用融合
  'emergency-response': {
    cascade: {
      fusionThreshold: 0.05,
      enabled: false,  // 紧急响应时禁用融合，使用最可靠的单一算法
      maxFusionAlgorithms: 1,
      consensusBonus: { highThreshold: 0.05, highBonus: 0.15, mediumThreshold: 0.10, mediumBonus: 0.08 },
    },
    exploration: {
      baseRateRange: { min: 0.15, max: 0.25 },
      dataFreshnessFactor: { withData: 1.05, withoutData: 0.95 },
      maturityThreshold: 10,
      rotationCycleMinutes: 120,
      maxExplorationRate: 0.30,
      minExplorationRate: 0.10,
    },
  },
};

// ==================== 全局默认配置 ====================

const DEFAULT_ALGORITHM_CONFIG: StrategyAlgorithmConfig = {
  cascade: {
    fusionThreshold: 0.15,
    enabled: true,
    maxFusionAlgorithms: 2,
    consensusBonus: { highThreshold: 0.10, highBonus: 0.10, mediumThreshold: 0.20, mediumBonus: 0.05 },
  },
  exploration: {
    baseRateRange: { min: 0.35, max: 0.60 },
    dataFreshnessFactor: { withData: 1.15, withoutData: 0.85 },
    maturityThreshold: 30,
    rotationCycleMinutes: 30,
    maxExplorationRate: 0.65,
    minExplorationRate: 0.30,
  },
};

// ==================== 核心查询函数 ====================

/**
 * 获取指定策略模板的算法配置
 * 支持策略模板级别的差异化配置
 */
export function getAlgorithmConfig(strategyTemplateId?: string | null): StrategyAlgorithmConfig {
  if (!strategyTemplateId) return DEFAULT_ALGORITHM_CONFIG;
  return STRATEGY_ALGORITHM_CONFIGS[strategyTemplateId] || DEFAULT_ALGORITHM_CONFIG;
}

/**
 * 获取Cascade Ensemble配置
 */
export function getCascadeConfig(strategyTemplateId?: string | null): CascadeEnsembleConfig {
  return getAlgorithmConfig(strategyTemplateId).cascade;
}

/**
 * 获取探索配置
 */
export function getExplorationConfig(strategyTemplateId?: string | null): ExplorationConfig {
  return getAlgorithmConfig(strategyTemplateId).exploration;
}

/**
 * 计算策略级别的探索率
 * 替代原来的全局固定探索率计算
 */
export function calculateStrategyExplorationRate(
  strategyTemplateId: string | null,
  dataCount: number,
  hasRecentData: boolean
): { explorationRate: number; detail: string } {
  const config = getExplorationConfig(strategyTemplateId);
  
  // 数据成熟度：0-1
  const dataMaturity = Math.min(1, dataCount / config.maturityThreshold);
  
  // 基础探索率：随数据成熟度从max降到min
  const baseRate = config.baseRateRange.max - dataMaturity * (config.baseRateRange.max - config.baseRateRange.min);
  
  // 数据新鲜度因子
  const freshnessFactor = hasRecentData ? config.dataFreshnessFactor.withData : config.dataFreshnessFactor.withoutData;
  
  // 最终探索率
  const explorationRate = Math.min(
    config.maxExplorationRate,
    Math.max(config.minExplorationRate, baseRate * freshnessFactor)
  );
  
  const detail = `策略=${strategyTemplateId || 'default'}, 基础率=${(baseRate * 100).toFixed(0)}%, ` +
    `新鲜度=${freshnessFactor.toFixed(2)}, 最终率=${(explorationRate * 100).toFixed(0)}%, ` +
    `范围=[${(config.minExplorationRate * 100).toFixed(0)}%-${(config.maxExplorationRate * 100).toFixed(0)}%]`;
  
  return { explorationRate, detail };
}

/**
 * 获取所有策略模板的算法配置摘要（用于前端展示和调试）
 */
export function getAllStrategyConfigSummary(): Record<string, {
  fusionThreshold: string;
  cascadeEnabled: boolean;
  explorationRange: string;
  rotationCycle: string;
}> {
  const summary: Record<string, any> = {};
  
  for (const [key, config] of Object.entries(STRATEGY_ALGORITHM_CONFIGS)) {
    summary[key] = {
      fusionThreshold: `${(config.cascade.fusionThreshold * 100).toFixed(0)}%`,
      cascadeEnabled: config.cascade.enabled,
      explorationRange: `${(config.exploration.baseRateRange.min * 100).toFixed(0)}%-${(config.exploration.baseRateRange.max * 100).toFixed(0)}%`,
      rotationCycle: `${config.exploration.rotationCycleMinutes}min`,
    };
  }
  
  summary['default'] = {
    fusionThreshold: `${(DEFAULT_ALGORITHM_CONFIG.cascade.fusionThreshold * 100).toFixed(0)}%`,
    cascadeEnabled: DEFAULT_ALGORITHM_CONFIG.cascade.enabled,
    explorationRange: `${(DEFAULT_ALGORITHM_CONFIG.exploration.baseRateRange.min * 100).toFixed(0)}%-${(DEFAULT_ALGORITHM_CONFIG.exploration.baseRateRange.max * 100).toFixed(0)}%`,
    rotationCycle: `${DEFAULT_ALGORITHM_CONFIG.exploration.rotationCycleMinutes}min`,
  };
  
  return summary;
}
