/**
 * Bid Optimizer 类型定义和常量
 * v417: 从 bidOptimizer.ts 拆分
 */

import { type BidChangeRecord, type UCBBidSuggestion, type HolidayConfig } from "../../algorithm/algorithmUtils";

// ==================== 算法常量定义 ====================

/** 默认CPC最高出价限制 ($) — 优化目标的max_bid为绝对红线 */
export const DEFAULT_MAX_BID_CPC = 2.00;

/** 默认最低出价限制 ($) */
export const DEFAULT_MIN_BID = 0.02;

/** 默认组平均CVR回退值 (当无数据时使用) */
export const DEFAULT_GROUP_AVG_CVR = 0.05;

/** 默认组平均AOV回退值 ($) */
export const DEFAULT_GROUP_AVG_AOV = 30;

/** 默认组平均CPC回退值 ($) */
export const DEFAULT_GROUP_AVG_CPC = 0.75;

/** 单次出价调整最大变动百分比 (防止剧烈波动) */
export const MAX_BID_CHANGE_PERCENT = 0.25;

/** 探索上限绝对值 ($) */
export const EXPLORATION_CEILING_ABSOLUTE = 3.00;

/** CPC到出价的估算系数 (estimatedCpc = bidLevel * 此值) */
export const CPC_BID_RATIO = 0.7;

/** 默认CTR回退值 (当无展示量数据时) */
export const DEFAULT_CTR_FALLBACK = 0.01;

/** 流量天花板乘数 */
export const TRAFFIC_CEILING_MULTIPLIER = 1.5;

// ==================== 类型定义 ====================

export interface OptimizationTarget {
  id: number;
  type: "keyword" | "product_target";
  currentBid: number;
  impressions: number;
  clicks: number;
  spend: number;
  sales: number;
  orders: number;
  matchType?: string;
  campaignStartDate?: Date;
  historicalAvgImpressions?: number;
  currentASP?: number;
  historicalASP?: number;
  inventoryLevel?: 'normal' | 'low' | 'critical' | 'out_of_stock';
  inventoryDays?: number;
  organicRank?: number;
  isStockout?: boolean;
  bidChangeHistory?: BidChangeRecord[];
  category?: string;
}

export interface OptimizationResult {
  targetId: number;
  targetType: "keyword" | "product_target";
  previousBid: number;
  newBid: number;
  actionType: "increase" | "decrease" | "set";
  bidChangePercent: number;
  reason: string;
}

export interface MarketCurvePoint {
  bidLevel: number;
  estimatedImpressions: number;
  estimatedClicks: number;
  estimatedConversions: number;
  estimatedSpend: number;
  estimatedSales: number;
  marginalRevenue: number;
  marginalCost: number;
}

export interface PerformanceGroupConfig {
  optimizationGoal: string;
  strategyTemplate?: string;
  targetAcos?: number;
  targetRoas?: number;
  dailySpendLimit?: number;
  dailyCostTarget?: number;
  dailyBudget?: number;
  maxBid?: number;
  groupAvgCvr?: number;
  groupAvgCpc?: number;
  groupAvgAov?: number;
  productCategory?: string;
  _evolvedMaxChangePercent?: number;
  _evolvedMaxDecreasePercent?: number;
  _confidenceMultiplier?: number;
  _suggestedBid?: number;
  _suggestedBidRangeStart?: number;
  _suggestedBidRangeEnd?: number;
  _cvrSource?: string;
}

// ==================== ASP 感知类型 ====================

export const ASP_SENSITIVITY_CONFIG = {
  significantDropPercent: 0.10,
  significantRisePercent: 0.10,
  acosRelaxMultiplier: 1.3,
  acosStricterMultiplier: 0.85,
};

export interface ASPSensitivityResult {
  aspChangePercent: number;
  priceAction: 'price_drop' | 'price_rise' | 'stable';
  acosAdjustmentMultiplier: number;
  reason: string;
}

// ==================== 库存保护类型 ====================

export const INVENTORY_PROTECTION_CONFIG = {
  lowInventoryThreshold: 7,
  criticalInventoryThreshold: 3,
  lowInventoryBidMultiplier: 0.7,
  criticalInventoryBidMultiplier: 0.5,
  outOfStockBidMultiplier: 0,
  organicRankThreshold: 10,
  organicRankBidReduction: 0.3,
};

export interface InventoryProtectionResult {
  originalBid: number;
  adjustedBid: number;
  bidMultiplier: number;
  inventoryLevel: string;
  inventoryDays?: number;
  action: 'normal' | 'reduce' | 'pause';
  reason: string;
}

export interface OrganicRankStrategyResult {
  originalBid: number;
  adjustedBid: number;
  bidReduction: number;
  organicRank: number;
  shouldReduceBid: boolean;
  reason: string;
}

// ==================== 增强版类型 ====================

export interface EnhancedOptimizationTarget extends OptimizationTarget {
  dailyData?: Array<{ date: Date; spend: number; sales: number; clicks: number; orders: number }>;
  marketplace?: string;
  campaignId?: number;
  adGroupId?: number;
  localCampaignId?: number;
  amazonCampaignId?: string;
}

export interface EnhancedOptimizationResult extends OptimizationResult {
  algorithmUsed: 'time_decay' | 'ucb' | 'holiday' | 'bayesian' | 'market_curve' | 'combined';
  timeDecayROAS?: number;
  ucbSuggestion?: UCBBidSuggestion;
  holidayConfig?: HolidayConfig | null;
  holidayMultiplier?: number;
  confidenceScore: number;
}

export interface AlgorithmEffectRecord {
  targetId: number;
  targetType: 'keyword' | 'product_target';
  algorithmUsed: string;
  previousBid: number;
  newBid: number;
  previousROAS: number;
  previousACoS: number;
  optimizationDate: Date;
  postROAS?: number;
  postACoS?: number;
  roasChange?: number;
  acosChange?: number;
  effectScore?: number;
}

// ==================== 内部常量 ====================

export const BAYESIAN_CONFIDENCE = 20;

export const DATA_SUFFICIENCY_THRESHOLDS = {
  minClicks: 15,
  minOrders: 3,
};

export const STRATEGY_DATA_THRESHOLDS: Record<string, { minClicks: number; minOrders: number }> = {
  'aggressive-growth': { minClicks: 8, minOrders: 1 },
  'seasonal-boost': { minClicks: 8, minOrders: 1 },
  'market-expansion': { minClicks: 8, minOrders: 1 },
  'balanced': { minClicks: 15, minOrders: 3 },
  'maximize_sales': { minClicks: 12, minOrders: 2 },
  'target_acos': { minClicks: 15, minOrders: 3 },
  'target_roas': { minClicks: 15, minOrders: 3 },
  'profit-focused': { minClicks: 20, minOrders: 5 },
  'brand-defense': { minClicks: 20, minOrders: 5 },
  'decline-management': { minClicks: 20, minOrders: 5 },
  'inventory-clearance': { minClicks: 10, minOrders: 1 },
  'competitor-attack': { minClicks: 10, minOrders: 2 },
  'emergency-response': { minClicks: 10, minOrders: 2 },
  'seasonal-pattern': { minClicks: 12, minOrders: 2 },
};

export const ZERO_IMPRESSION_PROBING_CONFIG = {
  newCampaignDays: 7,
  probingBidIncrementPercent: 0.10,
  probingBidIncrementFixed: 0.05,
  probingImpressionThreshold: 500,
  oosHistoricalAvgThreshold: 1000,
  explorationMaxBidPercent: 0.15,
  explorationMinImpressions: 200,
};
