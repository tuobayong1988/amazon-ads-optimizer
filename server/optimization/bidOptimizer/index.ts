/**
 * Bid Optimizer 统一导出
 * v417: 拆分为 types / marketCurve / bidAdjustment / businessAware / enhanced 子模块
 * 
 * 本文件保持与原 bidOptimizer.ts 完全相同的导出接口，确保向后兼容
 */

// === 类型和常量 ===
export {
  // 常量
  DEFAULT_MAX_BID_CPC,
  DEFAULT_MIN_BID,
  DEFAULT_GROUP_AVG_CVR,
  DEFAULT_GROUP_AVG_AOV,
  DEFAULT_GROUP_AVG_CPC,
  MAX_BID_CHANGE_PERCENT,
  EXPLORATION_CEILING_ABSOLUTE,
  CPC_BID_RATIO,
  DEFAULT_CTR_FALLBACK,
  TRAFFIC_CEILING_MULTIPLIER,
  ASP_SENSITIVITY_CONFIG,
  INVENTORY_PROTECTION_CONFIG,
  // 类型
  type OptimizationTarget,
  type OptimizationResult,
  type MarketCurvePoint,
  type PerformanceGroupConfig,
  type ASPSensitivityResult,
  type InventoryProtectionResult,
  type OrganicRankStrategyResult,
  type EnhancedOptimizationTarget,
  type EnhancedOptimizationResult,
  type AlgorithmEffectRecord,
} from './types';

// === 市场曲线建模 ===
export {
  calculateMetrics,
  estimateTrafficCeiling,
  calculateMarginalValues,
  generateMarketCurve,
  findOptimalBid,
} from './marketCurve';

// === 核心竞价调整 ===
export {
  calculateBayesianSmoothedCvr,
  isDataSufficient,
  calculateBidAdjustment,
  optimizePerformanceGroup,
  calculatePlacementAdjustments,
  calculateIntradayAdjustment,
  getAdjustmentReason,
} from './bidAdjustment';

// === 业务感知调整 ===
export {
  calculateASPSensitivity,
  calculateInventoryProtection,
  calculateOrganicRankStrategy,
  applyBusinessAwareAdjustments,
} from './businessAware';

// === 增强版算法 ===
export {
  calculateEnhancedBidAdjustment,
  optimizePerformanceGroupEnhanced,
  createAlgorithmEffectRecord,
  updateAlgorithmEffectRecord,
  calculateAlgorithmEffectStats,
} from './enhanced';
